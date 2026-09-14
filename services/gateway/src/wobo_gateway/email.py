"""Transactional email — the provider's REST API over stdlib urllib, console by default.

``send_email(kind, to, data)`` renders a template (see ``email_templates``) and, per
``EMAIL_MODE``, either logs the render (``console``, the default, so dev and CI never touch
the network) or sends it through the provider (``live``). It never raises into a caller's flow:
a lifecycle trigger that fails to email must not break the learner's action, so every failure
returns a structured result and a warning log instead.

Hardening, in the order a send meets it:

* **Idempotency.** A send that names a ``period`` gets a key ``kind:recipient-hash:period`` and
  is recorded in the :class:`MailLog`. The same key is never sent twice — not by a cron that
  fires again, not by a client that replays its first turn. The key also rides to the provider
  as its own idempotency header, so a retry after a dropped response cannot double-send either.
* **Retry with backoff** on a 5xx or a network fault; a 4xx is final.
* **The queued fallback.** With the provider key missing, or the sending domain not yet verified
  by the provider, the send degrades to a logged, recorded ``queued`` result ("would send") —
  nothing raises, nothing is lost from the log, and nothing goes out twice once the domain is.
* **Headers** a template returns (List-Unsubscribe) are forwarded verbatim.

* **Nothing live without an off switch.** In live mode a hospitality mail whose stop link
  could not be signed, or any mail whose postal line is still the placeholder, is held as a
  would-send too: a reader is owed both on every one of these.

``register_email(app)`` mounts the internal endpoints — ``POST /v1/email/send`` and, via
:mod:`wobo_gateway.hospitality.jobs`, the two cron doors — gated by an internal shared-key
header that FAILS CLOSED (an unset key refuses every call, so a misconfigured deploy is a dead
endpoint, never an open relay). The recipient is checked too: a call made on behalf of an
authenticated subject may only mail that subject's own address, and a call with no subject at
all (a bare internal key) may only send the fixed lifecycle set. The consent tier is NEVER read
from the request body — it is derived server-side from the subject.

The provider is named nowhere a reader can see (WOBO-PLAN §17): not in copy, not in a header
on the mail, not in a result body. It is one URL and one environment variable here.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from wobo_gateway.email_templates import (
    HAND_KINDS,
    KINDS,
    SUBSCRIBED_KINDS,
    postal_address_is_set,
    render,
)

logger = logging.getLogger("wobo.gateway.email")


def to_hash(address: str) -> str:
    """A stable, non-reversible stand-in for a recipient address, for logs.

    Our recipients are children and their guardians, so the address itself never lands in a log
    line: every question a log answers about a send — did this one go twice, which recipient did
    these three failures share — is answered by "same address or not", which a digest gives.
    """
    return hashlib.sha256(address.strip().lower().encode()).hexdigest()[:16]


def idempotency_key(kind: str, to: str, period: str, *, learner_id: str | None = None) -> str:
    """One key per (kind, recipient, learner, period). The recipient is hashed, so the key is
    loggable; the learner is named so one address linked to two children gets each child's
    mail — a parent of siblings is owed two Sunday notes, not one."""
    who = f"{learner_id}:" if learner_id else ""
    return f"{kind}:{to_hash(to)}:{who}{period}"


# Brand-neutral by config (WOBO-PLAN §8): the sender is one environment variable, so the domain
# swap is a deploy change, not a code change. The defaults are the real domain now that it exists
# (heywobo.com, bought 2026-09-03); the host still sets them, and until the sending domain is
# verified with the provider EMAIL_MODE=console means nothing leaves on any of these.
_FROM = os.getenv("EMAIL_FROM", "Wobo <hello@mail.heywobo.com>")
_REPLY_TO = os.getenv("EMAIL_REPLY_TO", "support@heywobo.com")
_API_URL = os.getenv("EMAIL_API_URL", "https://api.resend.com/emails")
_HTTP_TIMEOUT_S = 20.0
# Three tries: the first, then two more after 0.5 s and 2 s. A provider blip is seconds long; a
# provider outage is not something a lifecycle email should wait out inside a request.
_ATTEMPTS = 3
_BACKOFF_S: tuple[float, ...] = (0.5, 2.0)
_sleep = time.sleep  # seam: tests replace it so a retry costs no wall clock


# --- the mail log: every send, so nothing is ever sent twice ------------------------------
@dataclass(frozen=True)
class MailRecord:
    """One send as the log remembers it. ``provider_id`` is the provider's id, ``console`` for a
    render that was only logged, or ``queued`` for a would-send held back by config."""

    key: str
    learner_id: str | None
    kind: str
    to_hash: str
    period: str
    sent_at: str  # ISO 8601, UTC
    provider_id: str


class MailLog:
    """The send record beside the sender: in memory, thread-safe, and mirrored to a JSONL file
    when ``MAIL_LOG_PATH`` is set so a restart does not forget what went out.

    One instance today (``numReplicas: 1``). The upgrade path when a second replica arrives is a
    table with a unique index on ``key`` behind this same interface.
    """

    def __init__(self, path: str | os.PathLike[str] | None = None) -> None:
        self._lock = threading.Lock()
        self._by_key: dict[str, MailRecord] = {}
        self._path = Path(path) if path else None
        if self._path and self._path.exists():
            self._load()

    def _load(self) -> None:
        assert self._path is not None
        try:
            for line in self._path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                record = MailRecord(**{k: row.get(k) for k in MailRecord.__dataclass_fields__})
                self._by_key[record.key] = record
        except (OSError, ValueError, TypeError) as exc:
            # A torn line must not take the whole log with it — what parsed is kept.
            logger.warning(
                "mail log: could not read every line", extra={"fields": {"error": str(exc)}}
            )

    def seen(self, key: str) -> MailRecord | None:
        with self._lock:
            return self._by_key.get(key)

    def record(self, record: MailRecord) -> None:
        with self._lock:
            self._by_key[record.key] = record
            if self._path is not None:
                try:
                    self._path.parent.mkdir(parents=True, exist_ok=True)
                    with self._path.open("a", encoding="utf-8") as fh:
                        fh.write(json.dumps(asdict(record)) + "\n")
                except OSError as exc:
                    logger.warning(
                        "mail log: could not persist", extra={"fields": {"error": str(exc)}}
                    )

    def recent(self, learner_id: str, kind: str, *, since: datetime) -> list[MailRecord]:
        """Every send of ``kind`` to this learner at or after ``since`` (the frequency rule)."""
        floor = since.astimezone(UTC)
        with self._lock:
            return [
                r
                for r in self._by_key.values()
                if r.learner_id == learner_id
                and r.kind == kind
                and datetime.fromisoformat(r.sent_at) >= floor
            ]

    def latest_to(self, to: str) -> datetime | None:
        """When this address last heard from us, whatever the kind and whoever it was about —
        the twenty-four-hour gap (§14.1) is about an inbox, not a learner. ``None`` if never."""
        digest = to_hash(to)
        with self._lock:
            times = [
                datetime.fromisoformat(r.sent_at)
                for r in self._by_key.values()
                if r.to_hash == digest
            ]
        return max(times) if times else None

    def sent_today(self, moment: datetime) -> int:
        """How many mails have actually LEFT on the UTC day of ``moment``.

        A queued would-send and a console render are not sends: they cost the day's allowance
        nothing, because nothing reached an inbox.
        """
        day = moment.astimezone(UTC).date()
        with self._lock:
            return sum(
                1
                for r in self._by_key.values()
                if r.provider_id not in {"queued", "console"}
                and datetime.fromisoformat(r.sent_at).astimezone(UTC).date() == day
            )

    def records(self) -> list[MailRecord]:
        with self._lock:
            return list(self._by_key.values())


# --- the log in the database (migration 0032_mail_log.sql) --------------------------------------
_SCHEMA = "ops"
_TABLE = "mail_log"
#: How much of the table an instance reads into memory when it starts. Every rule that reads the
#: log looks backwards by hours or days (the inbox gap is one day, the win gap seven), so forty
#: covers all of them with room for a clock that disagrees, and bounds the read.
PRIME_DAYS = 40


def _rest(url: str, key: str, method: str, *, body: Any = None) -> Any:
    """One PostgREST call with the service-role key. Split out so tests need no database."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Accept-Profile": _SCHEMA,
        "Content-Profile": _SCHEMA,
        "Prefer": "return=minimal",
    }
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode()
    return json.loads(raw) if raw.strip() else []


class DatabaseMailLog(MailLog):
    """The mail log with ``ops.mail_log`` behind it: the same interface, and it survives a deploy.

    The file this replaces lived on an instance with no volume, so every record of a send and
    every would-send held back by a missing DNS record died on each redeploy — and with them the
    inbox law, idempotency and the daily cap, all three of which are read from this log.

    Reads stay in memory: the instance primes itself with the last :data:`PRIME_DAYS` of rows at
    startup and keeps what it writes, so no rule costs a network hop. Writes go both places, and
    a write that fails is a warning, never an exception into a learner's turn: the send already
    happened, and losing the record of it must not also lose the mail.
    """

    def __init__(
        self,
        base_url: str,
        service_key: str,
        *,
        request: Callable[..., Any] | None = None,
        path: str | os.PathLike[str] | None = None,
        now: datetime | None = None,
    ) -> None:
        super().__init__(path)
        self.base = base_url.rstrip("/")
        self._key = service_key
        self._request = request or _rest
        self._prime(now or datetime.now(UTC))

    def _url(self, params: dict[str, str] | None = None) -> str:
        query = f"?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}" if params else ""
        return f"{self.base}/rest/v1/{_TABLE}{query}"

    def _prime(self, now: datetime) -> None:
        floor = (now.astimezone(UTC) - timedelta(days=PRIME_DAYS)).isoformat()
        try:
            rows = self._request(
                self._url(
                    {
                        "select": "key,learner_id,kind,to_hash,period,sent_at,provider_id",
                        "sent_at": f"gte.{floor}",
                        "event": "in.(sent,console,queued)",
                        "order": "sent_at.desc",
                        "limit": "5000",
                    }
                ),
                self._key,
                "GET",
            )
        except Exception as exc:  # an unreachable table is an empty memory, never a dead gateway
            logger.warning("mail log: could not prime", extra={"fields": {"error": str(exc)}})
            return
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict) or not row.get("key"):
                continue
            try:
                record = MailRecord(
                    key=str(row["key"]),
                    learner_id=row.get("learner_id"),
                    kind=str(row.get("kind") or ""),
                    to_hash=str(row.get("to_hash") or ""),
                    period=str(row.get("period") or ""),
                    sent_at=str(row.get("sent_at") or ""),
                    provider_id=str(row.get("provider_id") or ""),
                )
            except (TypeError, ValueError):
                continue
            self._by_key.setdefault(record.key, record)

    @staticmethod
    def _event_of(provider_id: str) -> str:
        if provider_id == "queued":
            return "queued"
        return "console" if provider_id == "console" else "sent"

    def record(self, record: MailRecord) -> None:
        super().record(record)
        self._write(
            {
                "event": self._event_of(record.provider_id),
                "kind": record.kind,
                "key": record.key,
                "learner_id": record.learner_id,
                "to_hash": record.to_hash,
                "period": record.period,
                "sent_at": record.sent_at,
                "provider_id": record.provider_id,
            }
        )

    def note_event(
        self,
        event: str,
        *,
        kind: str,
        to: str,
        at: datetime | None = None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        """A click at our own deep-link landing, an unsubscribe honoured, a seed's tab placement.

        These carry no idempotency key: two clicks on one mail are two facts, not a duplicate.
        """
        self._write(
            {
                "event": event,
                "kind": kind,
                "to_hash": to_hash(to),
                "sent_at": (at or datetime.now(UTC)).astimezone(UTC).isoformat(),
                "detail": detail or {},
            }
        )

    def _write(self, row: dict[str, Any]) -> None:
        try:
            self._request(self._url(), self._key, "POST", body=[row])
        except Exception as exc:  # the send happened; the record of it must not raise
            logger.warning(
                "mail log: could not write through",
                extra={"fields": {"error": str(exc), "kind": row.get("kind")}},
            )


def build_mail_log() -> MailLog:
    """The database log when a project is configured, the file (or memory) otherwise.

    ``MAIL_LOG_STORE=file`` asks for the file BY NAME, which is what the suite and a local run
    use. The default is the database precisely because the default is what production gets, and
    production is where a forgotten send costs somebody a second mail about their child.
    """
    if (os.getenv("MAIL_LOG_STORE") or "").strip().lower() == "file":
        return MailLog(os.getenv("MAIL_LOG_PATH") or None)
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if base and key:
        return DatabaseMailLog(base, key, path=os.getenv("MAIL_LOG_PATH") or None)
    return MailLog(os.getenv("MAIL_LOG_PATH") or None)


_mail_log: MailLog | None = None
_mail_log_lock = threading.Lock()


def mail_log() -> MailLog:
    """The process's one mail log, built on first use: ``ops.mail_log`` when a project is
    configured, the JSONL file when ``MAIL_LOG_PATH`` is set, memory otherwise."""
    global _mail_log
    with _mail_log_lock:
        if _mail_log is None:
            _mail_log = build_mail_log()
        return _mail_log


def set_mail_log(log: MailLog | None) -> None:
    """Test seam, and the hook a durable backend plugs into."""
    global _mail_log
    with _mail_log_lock:
        _mail_log = log


def reset_mail_log() -> None:
    set_mail_log(None)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


# --- who may be written to --------------------------------------------------------------
def account_email(subject: str) -> str | None:
    """The address on file for a verified subject, or ``None`` when it cannot be established.

    ponytail: the profile lookup lives in one place for the whole gateway (``consent``). The
    profile row carries no address column yet — canonical identity lives in the platform
    plane's vault — so this returns ``None`` today and every caller that passes a subject FAILS
    CLOSED. An unknown address is never mailed on a learner's behalf.
    """
    if not subject:
        return None
    try:
        from wobo_gateway.consent import account_email as _lookup  # type: ignore[attr-defined]
    except (ImportError, AttributeError):
        return None
    try:
        found = _lookup(subject)
    except Exception:  # a profile-store outage must not turn into a wrong-recipient send
        logger.warning("email: profile lookup failed", extra={"fields": {"subject": subject}})
        return None
    return str(found) if found else None


def may_send_to(subject: str | None, to: str) -> bool:
    """Is this send allowed? ``subject is None`` means a trusted internal call (the shared key is
    the authority). With a subject, the address must be that subject's own — a learner may mail
    themselves and nobody else."""
    if subject is None:
        return True
    owned = account_email(subject)
    return bool(owned) and owned.strip().lower() == to.strip().lower()


# --- the provider hop -------------------------------------------------------------------
@dataclass(frozen=True)
class _Reply:
    ok: bool
    status: int | None = None
    detail: str = ""
    result: dict[str, Any] | None = None


def _domain_refused(status: int | None, detail: str) -> bool:
    """Did the provider refuse because our sending domain is not verified with it yet? That is a
    configuration state, not a fault: the mail is held as a would-send rather than failed."""
    if status not in (401, 403, 422):
        return False
    lowered = detail.lower()
    return "domain" in lowered and ("verif" in lowered or "not found" in lowered)


_USER_AGENT = "wobo-mailer/1.0 (+https://heywobo.com)"


def _post(body: bytes, key: str, idem: str | None) -> _Reply:
    """One POST to the provider with retry on 5xx and network faults. A 4xx is final."""
    # A User-Agent is not optional here. urllib sends "Python-urllib/3.x" by default, and the
    # provider's edge answers that signature with a 403 before the request ever reaches their
    # API — proved live on 2026-09-04: the same body sends fine with a name on it. Without this
    # line every live send fails, so the name is ours and it never says what is underneath.
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {key}",
        "User-Agent": _USER_AGENT,
    }
    if idem:
        headers["Idempotency-Key"] = idem
    last = _Reply(ok=False)
    for attempt in range(_ATTEMPTS):
        req = urllib.request.Request(_API_URL, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as resp:
                parsed = json.loads(resp.read().decode() or "{}")
            return _Reply(ok=True, status=200, result=parsed if isinstance(parsed, dict) else {})
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:300]
            last = _Reply(ok=False, status=exc.code, detail=detail)
            if exc.code < 500:
                return last
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            last = _Reply(ok=False, detail=str(exc)[:300])
        if attempt < _ATTEMPTS - 1:
            _sleep(_BACKOFF_S[min(attempt, len(_BACKOFF_S) - 1)])
    return last


# --- the daily cap (docs/MAIL-PRIMARY.md §5, docs/EMAILS-AND-ANIMATIONS.md §6) ----------------
#: The dial's name in ``ops.settings``. The owner raises it in one statement, with nothing
#: released and nothing restarted, which is the whole point: warm-up is a schedule, and a
#: schedule that needs a deploy is a schedule nobody keeps.
DAILY_CAP_DIAL = "mail_daily_cap"
#: What the gateway does before anybody has set the dial. Small on purpose. A domain with no
#: sending history is judged on its first week, and the one day this law can be undone is the day
#: the waiting list is mailed: a burst from a cold domain is the documented way a domain is
#: burned. A hundred is enough for every real day we have and far too few for an accident.
DEFAULT_DAILY_CAP = 100


def daily_cap() -> int:
    """The live cap: the dial when the project can answer, the warm-up default when it cannot.

    A store that cannot be reached is NOT an excuse to send without a ceiling — it is the same
    posture as the door (``doors.py``): the safe answer to a question you cannot ask is the
    careful one.
    """
    raw = os.getenv("MAIL_DAILY_CAP")
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            return DEFAULT_DAILY_CAP
    try:
        from wobo_gateway import doors

        value = doors.get_store().read(DAILY_CAP_DIAL)
    except Exception:  # a dial we cannot read is the default, never "no ceiling"
        return DEFAULT_DAILY_CAP
    if isinstance(value, bool) or value is None:
        return DEFAULT_DAILY_CAP
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return DEFAULT_DAILY_CAP


#: The superadmin's switch per kind, in ``ops.settings``: a list of kind names that are off.
#: §1's last law — "a kind that nobody opens in a month is switched off by the superadmin, not by
#: a guess" — and the switch the mail desk offers.
KINDS_OFF_DIAL = "mail_kinds_off"


def kind_is_off(kind: str) -> bool:
    """Has the superadmin switched this kind off? A dial we cannot read is not a switch: mail of
    a kind nobody turned off still goes, because failing closed here would silence the product
    every time the database blinked."""
    try:
        from wobo_gateway import doors

        value = doors.get_store().read(KINDS_OFF_DIAL)
    except Exception:
        return False
    if not isinstance(value, list):
        return False
    return kind in {str(v) for v in value}


def over_the_daily_cap(*, at: datetime | None = None) -> str | None:
    """``"daily_cap"`` when today's sends have reached the ceiling, else ``None``.

    Counted on the log, by the day the send is stamped with, so a pass replayed at a fixed moment
    counts against that day and not against the container's. Only sends that actually left are
    counted: a would-send never used any of the day's allowance.
    """
    cap = daily_cap()
    if mail_log().sent_today(at or datetime.now(UTC)) >= cap:
        return "daily_cap"
    return None


def send_email(
    kind: str,
    to: str,
    data: dict[str, Any] | None = None,
    *,
    subject: str | None = None,
    learner_id: str | None = None,
    period: str | None = None,
    headers: dict[str, str] | None = None,
    at: datetime | None = None,
) -> dict[str, Any]:
    """Render ``kind`` and send or log it. Returns a structured result; never raises.

    ``subject`` is the verified learner this send is made on behalf of. When given, the recipient
    must be that learner's own address; omitted, the call is trusted internal lifecycle mail.
    ``period`` makes the send idempotent: the same (kind, recipient, period) goes out once, ever,
    and is remembered in the mail log against ``learner_id``. ``headers`` are extra mail headers
    on top of the template's own (List-Unsubscribe).
    """
    mode = os.getenv("EMAIL_MODE", "console").lower()
    if not may_send_to(subject, to):
        logger.warning(
            "email refused: recipient does not belong to the subject",
            extra={"fields": {"kind": kind, "subject": subject}},
        )
        return {"ok": False, "mode": mode, "error": "not_allowed"}

    key = idempotency_key(kind, to, period, learner_id=learner_id) if period else None
    if key:
        before = mail_log().seen(key)
        if before is not None:
            logger.info(
                "email skipped: already sent for this period",
                extra={"fields": {"kind": kind, "to_hash": to_hash(to), "key": key}},
            )
            return {"ok": True, "mode": mode, "duplicate": True, "id": before.provider_id}

    try:
        email = render(kind, data or {})
    except KeyError:
        logger.warning("email render skipped: unknown kind", extra={"fields": {"kind": kind}})
        return {"ok": False, "mode": mode, "error": "unknown_kind"}
    mail_headers = {**(email.get("headers") or {}), **(headers or {})}

    def remember(provider_id: str) -> None:
        if key:
            mail_log().record(
                MailRecord(
                    key=key,
                    learner_id=learner_id,
                    kind=kind,
                    to_hash=to_hash(to),
                    period=period or "",
                    # Stamped with the clock the JOB runs on when it hands one in, so a pass that
                    # is replayed or tested at a fixed moment and the inbox gap it reads agree.
                    # The wall clock and a handed-in moment mixed once and a parent of two got one
                    # Sunday note (2026-09-07).
                    sent_at=(at.astimezone(UTC) if at else datetime.now(UTC)).isoformat(),
                    provider_id=provider_id,
                )
            )

    def queued(reason: str) -> dict[str, Any]:
        # "would send": the render is proven and recorded; only the provider hop was withheld.
        logger.warning(
            "email queued (would send)",
            extra={
                "fields": {
                    "kind": kind,
                    "to_hash": to_hash(to),
                    "subject": email["subject"],
                    "reason": reason,
                    "headers": sorted(mail_headers),
                }
            },
        )
        remember("queued")
        return {
            "ok": False,
            "queued": True,
            "mode": mode,
            "error": reason,
            "subject": email["subject"],
        }

    if mode != "live":
        # console (default): render is proven, nothing sent — the structured line is the proof.
        logger.info(
            "email rendered (console mode, not sent)",
            extra={
                "fields": {
                    "kind": kind,
                    "to_hash": to_hash(to),
                    "subject": email["subject"],
                    "mode": mode,
                    "headers": sorted(mail_headers),
                }
            },
        )
        remember("console")
        result: dict[str, Any] = {"ok": True, "mode": mode, "subject": email["subject"]}
        if key:
            result["key"] = key
        return result

    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        return queued("no_api_key")
    # Nothing leaves without the two things a reader is owed on every one of these: a real
    # postal line (CAN-SPAM, DPDP) and a working one-click off switch (RFC 8058, and §14.1's
    # "opt-out in one tap"). A footer that says PLACEHOLDER, or a stop link that could not be
    # signed, is a would-send until the deploy is finished.
    if not postal_address_is_set():
        return queued("no_postal_address")
    # Every SUBSCRIBED kind is owed a way out that a client can act on, not just the paper set
    # (docs/MAIL-PRIMARY.md §2: the hold used to cover HAND_KINDS alone, so seven subscribed
    # messages could go out with no unsubscribe header and nothing stopped them). A missing
    # ``List-Unsubscribe`` holds the send; a missing one-click POST holds the hand-drawn kinds,
    # whose footers promise a single tap.
    if kind in SUBSCRIBED_KINDS and "List-Unsubscribe" not in mail_headers:
        return queued("no_stop_link")
    if kind in HAND_KINDS and "List-Unsubscribe-Post" not in mail_headers:
        return queued("no_stop_link")
    if kind_is_off(kind):
        return queued("kind_switched_off")
    over = over_the_daily_cap(at=at)
    if over is not None:
        return queued(over)

    envelope: dict[str, Any] = {
        "from": _FROM,
        "to": [to],
        "reply_to": _REPLY_TO,
        "subject": email["subject"],
        "html": email["html"],
        "text": email["text"],
    }
    if mail_headers:
        envelope["headers"] = mail_headers
    reply = _post(json.dumps(envelope).encode(), api_key, key)
    if not reply.ok:
        if _domain_refused(reply.status, reply.detail):
            return queued("domain_unverified")
        logger.warning(
            "email send failed",
            extra={
                "fields": {
                    "kind": kind,
                    "to_hash": to_hash(to),
                    "status": reply.status,
                    "detail": reply.detail,
                }
            },
        )
        failed: dict[str, Any] = {"ok": False, "mode": mode, "error": "send_failed"}
        if reply.status is not None:
            failed["status"] = reply.status
        return failed

    email_id = (reply.result or {}).get("id")
    logger.info(
        "email sent",
        extra={"fields": {"kind": kind, "to_hash": to_hash(to), "id": email_id, "mode": mode}},
    )
    remember(str(email_id or "sent"))
    return {"ok": True, "mode": mode, "id": email_id}


# --- the internal door ------------------------------------------------------------------
def _not_allowed(message: str = "this is not something you can do here") -> HTTPException:
    return HTTPException(status_code=403, detail={"code": "not_allowed", "message": message})


def require_internal_key(request: Request) -> None:
    """Fail closed: the internal shared key must be configured AND match, in constant time.

    An unset ``INTERNAL_EMAIL_KEY`` refuses everything — a misconfigured deploy is a dead
    endpoint, never an open relay. Compared as BYTES: ``secrets.compare_digest`` raises TypeError
    on a str that is not pure ASCII, so a header with one accented character used to turn a
    refusal into a 500 — an unauthenticated caller choosing the error class is a probe, not a
    mistake. Encoding with ``errors="ignore"`` keeps the comparison constant-time and the answer
    a plain 403. Shared by every internal door (the relay, the Sunday cron).
    """
    expected = os.getenv("INTERNAL_EMAIL_KEY")
    provided = request.headers.get("X-Wobo-Internal")
    if (
        not expected
        or not provided
        or not secrets.compare_digest(provided.encode("utf-8", "ignore"), expected.encode())
    ):
        raise _not_allowed()


class EmailSendRequest(BaseModel):
    kind: str
    to: str = Field(min_length=3, max_length=320)
    data: dict[str, Any] = Field(default_factory=dict)
    # Deprecated and IGNORED. The tier is derived server-side from the verified subject — a
    # client-declared tier is a request to be trusted, not evidence. Still accepted (unvalidated)
    # for one release so the already-deployed web bundle does not 422 on it.
    consent_tier: str | None = None


# What a BARE internal key may send — the unattended lifecycle mail a backend job legitimately
# triggers for a learner who has no session open. Everything else (a report about a child, a
# premium surprise, a digest of somebody's week) must be attributed: it needs a verified subject
# on the request, and then it may only go to that subject's own address.
LIFECYCLE_KINDS = frozenset(
    {"account_created", "welcome", "verify_email", "reengage", "course_ready"}
)


def register_email(app: FastAPI) -> None:
    @app.post("/v1/email/send")
    def send(body: EmailSendRequest, request: Request) -> dict[str, Any]:
        require_internal_key(request)
        if body.kind not in KINDS:
            raise HTTPException(
                status_code=404,
                detail={"code": "unknown_kind", "message": "I do not have an email of that kind"},
            )
        # The verified subject, when the auth middleware established one. The route used to sit in
        # the middleware's open list, so this was ALWAYS None — and ``may_send_to(None, …)`` is
        # unconditionally True, which made the "a learner may only mail their own address" rule
        # unreachable code. The middleware now authenticates this path when a learner token rides
        # along (without refusing when one does not), so the rule has something to check.
        subject = getattr(request.state, "subject", None)
        if subject is None and body.kind not in LIFECYCLE_KINDS:
            # A bare internal key is a service, not a person. It may send the unattended lifecycle
            # mail and nothing else; anything about a particular learner must carry that learner.
            raise _not_allowed("I can only send that one on a learner's own behalf")
        result = send_email(body.kind, body.to, body.data, subject=subject)
        if result.get("error") == "not_allowed":
            raise _not_allowed("that is not your address to write to")
        return result

    # The hospitality doors share this module's key and its fail-closed check.
    from wobo_gateway.hospitality.jobs import register_hospitality

    register_hospitality(app)
