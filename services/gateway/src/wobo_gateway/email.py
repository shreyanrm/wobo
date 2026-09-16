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
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Collection
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from wobo_gateway.email_templates import (
    APP_NAME,
    HAND_KINDS,
    KINDS,
    SUBSCRIBED_KINDS,
    TRANSACTIONAL_KINDS,
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

# --- two streams (docs/MAIL-PRIMARY.md, "What the global senders do, adopted") -------------------
#: The transactional stream's sender: sign-in codes, receipts, account mail and the owner's own
#: alerts. Its own sending subdomain, set up once and warmed, so a bad week for learning notes
#: never stops a family signing in. Read at every send, so setting it is a variable and a
#: restart. UNSET (today), every mail keeps ``EMAIL_FROM`` byte for byte. It is never switched in
#: response to spam: nothing in this gateway writes it.
TRANSACTIONAL_FROM_ENV = "EMAIL_FROM_TRANSACTIONAL"
_BARE_ADDRESS = re.compile(r"^[^@\s<>,\"]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$")


def _address_of(value: str) -> str | None:
    """The one address in ``value`` ("Name <a@b.c>", "<a@b.c>" or "a@b.c"), or ``None``.

    Anything else (two addresses, an empty bracket, a word) is not an address, and a sender we
    cannot read falls back to the one that works rather than breaking every sign-in code.
    """
    raw = value.strip()
    if not raw:
        return None
    if "<" in raw or ">" in raw:
        found = re.fullmatch(r"[^<>]*<([^<>]*)>", raw)
        if not found:
            return None
        raw = found.group(1).strip()
    return raw if _BARE_ADDRESS.match(raw) else None


def _display_name() -> str:
    """The name the reader sees on both streams: the learning stream's own, so the two can never
    disagree. "Wobo" on both, whatever a variable says."""
    name = _FROM.split("<", 1)[0].strip().strip('"') if "<" in _FROM else ""
    return name or APP_NAME


def sender_for(kind: str) -> str:
    """The From for a mail of ``kind``. Learning notes keep ``EMAIL_FROM`` forever; transactional
    mail takes ``EMAIL_FROM_TRANSACTIONAL`` when it names one readable address."""
    if kind in TRANSACTIONAL_KINDS:
        address = _address_of(os.getenv(TRANSACTIONAL_FROM_ENV) or "")
        if address:
            return f"{_display_name()} <{address}>"
    return _FROM

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


#: The ``provider_id`` value that means THE MAIL WAS NEVER ATTEMPTED. A ``queued`` row is a
#: would-send held by config: a missing provider key, an unverified sending domain, the day's
#: cap, a kind the superadmin switched off. Every rule that asks "has this person already had
#: this" must exclude it, or a temporary condition becomes a permanent silence — the mail is
#: never retried once the condition clears, and the inbox is muted for a day on behalf of a
#: message nobody ever received.
#:
#: ``console`` is deliberately NOT here, though :meth:`sent_today` excludes it from the daily
#: cap. The two questions are different. The cap asks "what has this domain's reputation spent
#: today", and a console render spends nothing. Idempotency and the inbox gap ask "have we
#: already done this one", and in console mode the answer is yes: the render is the send, that
#: is the whole point of the mode, and a cron replayed against a console log must still be a
#: no-op. Treating a console row as never-happened would make every local run and every suite
#: send the same mail twice.
NOT_A_SEND: frozenset[str] = frozenset({"queued"})


class MailLog:
    """The send record beside the sender: in memory, thread-safe, and mirrored to a JSONL file
    when ``MAIL_LOG_PATH`` is set so a restart does not forget what went out.

    One instance today (``numReplicas: 1``). The upgrade path when a second replica arrives is a
    table with a unique index on ``key`` behind this same interface.
    """

    #: The digest written when we know WHO a thing happened to but not the address it happened
    #: at: a click and an unsubscribe are measured at routes that hold a signed learner id and
    #: never an inbox. Sixteen zeroes is a valid digest by shape and obviously not one by value,
    #: which is what stops it being counted as a recipient by anything reading this column.
    NO_ADDRESS = "0" * 16

    def __init__(self, path: str | os.PathLike[str] | None = None) -> None:
        self._lock = threading.Lock()
        self._by_key: dict[str, MailRecord] = {}
        self._events: list[dict[str, Any]] = []
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
                # Two shapes share this file: a send, which is keyed, and an event, which is
                # not. A click and an unsubscribe carry no idempotency key by design, so the
                # key is what tells them apart on the way back in.
                if row.get("event") and not row.get("key"):
                    self._events.append(row)
                    continue
                record = MailRecord(**{k: row.get(k) for k in MailRecord.__dataclass_fields__})
                self._by_key[record.key] = record
        except (OSError, ValueError, TypeError) as exc:
            # A torn line must not take the whole log with it — what parsed is kept.
            logger.warning(
                "mail log: could not read every line", extra={"fields": {"error": str(exc)}}
            )

    def seen(self, key: str) -> MailRecord | None:
        """The send this key already made, or ``None`` — and a would-send is not a send.

        ``queued`` rows are held mail: the render was proven and the provider hop was withheld
        because a key was missing, the domain was unverified, the cap was reached or the
        superadmin had the kind switched off. Reading one back as a send turned every one of
        those temporary conditions into a PERMANENT silence: the mail was never retried when the
        condition cleared, and the reader never got a message that was never sent.

        :meth:`sent_today` already excluded ``queued`` from the daily cap, which is the same
        rule stated once and then not carried here or in :meth:`latest_to`. It is carried now.
        """
        with self._lock:
            record = self._by_key.get(key)
        return None if record is not None and record.provider_id in NOT_A_SEND else record

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
                if r.to_hash == digest and r.provider_id not in NOT_A_SEND
            ]
        return max(times) if times else None

    def sent_to_since(
        self, to: str, since: datetime, *, kinds: Collection[str] | None = None
    ) -> int:
        """How many mails this address has actually received since ``since``.

        The inbox law counts a day; a cadence counts a week, and nothing could count one before
        this. ``kinds`` narrows it to a family of mail (the nudges), because the Sunday note and
        the account mail are not what makes an inbox feel hunted.
        """
        digest = to_hash(to)
        floor = since.astimezone(UTC)
        with self._lock:
            return sum(
                1
                for r in self._by_key.values()
                if r.to_hash == digest
                and r.provider_id not in NOT_A_SEND
                and (kinds is None or r.kind in kinds)
                and datetime.fromisoformat(r.sent_at).astimezone(UTC) >= floor
            )

    def sent_to(self, to: str, *, since: datetime) -> list[MailRecord]:
        """Every mail this address actually received at or after ``since``, oldest first.

        What the weekly cadence reads (``hospitality/cadence.py``): the floor and the step are
        promises about an inbox, so they are counted by address, whoever the mail was about.
        """
        digest = to_hash(to)
        floor = since.astimezone(UTC)
        with self._lock:
            found = [
                r
                for r in self._by_key.values()
                if r.to_hash == digest
                and r.provider_id not in NOT_A_SEND
                and datetime.fromisoformat(r.sent_at).astimezone(UTC) >= floor
            ]
        return sorted(found, key=lambda r: r.sent_at)

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

    def note_event(
        self,
        event: str,
        *,
        kind: str,
        to: str = "",
        at: datetime | None = None,
        detail: dict[str, Any] | None = None,
        learner_id: str | None = None,
    ) -> None:
        """A click at our own deep-link landing, or an unsubscribe honoured.

        No idempotency key, ever: two clicks on one mail are two facts and not a duplicate, and
        a key would silently collapse them into one. Never an address and never the token that
        was pressed — the row says that something happened to a mail of this kind, and no more.
        """
        row: dict[str, Any] = {
            "event": event,
            "kind": kind,
            "key": None,
            "learner_id": learner_id,
            "to_hash": to_hash(to) if to else self.NO_ADDRESS,
            "sent_at": (at or datetime.now(UTC)).astimezone(UTC).isoformat(),
            "detail": detail or {},
        }
        with self._lock:
            self._events.append(row)
            if self._path is not None:
                try:
                    self._path.parent.mkdir(parents=True, exist_ok=True)
                    with self._path.open("a", encoding="utf-8") as fh:
                        fh.write(json.dumps(row) + "\n")
                except OSError as exc:
                    logger.warning(
                        "mail log: could not persist an event",
                        extra={"fields": {"error": str(exc)}},
                    )

    def events(self) -> list[dict[str, Any]]:
        """Every click and unsubscribe this log holds, oldest first. What the mail desk reads."""
        with self._lock:
            return list(self._events)

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
        to: str = "",
        at: datetime | None = None,
        detail: dict[str, Any] | None = None,
        learner_id: str | None = None,
    ) -> None:
        """A click at our own deep-link landing, an unsubscribe honoured, a seed's tab placement.

        The row is built once, by the base log, and then written through, so the table and the
        memory behind it can never disagree about what happened.
        """
        super().note_event(
            event, kind=kind, to=to, at=at, detail=detail, learner_id=learner_id
        )
        self._write(self.events()[-1])

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


#: The deliverability watch's own switch (``mailwatch/respond.py``), in ``ops.settings``: kinds it
#: paused because their complaint rate crossed the line, each with why and since when. Separate
#: from :data:`KINDS_OFF_DIAL` on purpose: that one is the superadmin's decision, this one is the
#: watch's, and only the owner lifts it (``POST /v1/admin/mail/unpause``). Seeded by 0036.
KINDS_PAUSED_DIAL = "mail.kinds_paused"


def kind_is_paused(kind: str) -> bool:
    """Has the watch paused this kind? Never for a sign-in code, a receipt or an alert, whatever
    the dial says. A dial we cannot read is not a pause, for the reason :func:`kind_is_off`
    gives."""
    if kind in TRANSACTIONAL_KINDS:
        return False
    try:
        from wobo_gateway import doors

        value = doors.get_store().read(KINDS_PAUSED_DIAL)
    except Exception:
        return False
    if not isinstance(value, dict):
        return False
    entry = value.get(kind)
    return isinstance(entry, dict) and entry.get("paused") is True


def address_is_suppressed(to: str) -> bool:
    """Has this address complained or hard-bounced? Read from the watch's store by digest.

    A store we cannot read is not a suppression: the watch primes every suppression at start, so
    the only way to get here unanswered is a project that never answered at all, and silencing
    every family then would be the across-the-board slowdown the owner ruled out.
    """
    try:
        from wobo_gateway.mailwatch import store as watch_store

        return watch_store.get_store().is_suppressed(to_hash(to))
    except Exception:
        return False


def suppression_list_unreadable(at: datetime | None = None) -> bool:
    """Can nobody say right now who complained? Then the owner is told, once an hour.

    The watch reads every suppression at start and again every half minute while that read
    fails (``mailwatch/store.py``). Until it answers, a learning note could reach a parent who
    reported us, which is the one thing the law and Gmail do not forgive; so the send path holds
    everything but sign-in codes, receipts and this alert, and the hold clears by itself the
    moment the list is read (2026-09-16: one failed read at start used to forget every
    complainer until the next restart, and nobody heard).
    """
    try:
        from wobo_gateway.mailwatch import store as watch_store

        if watch_store.get_store().ensure_readable():
            return False
    except Exception:  # noqa: BLE001 — a store that cannot even be built has nothing to read
        logger.warning("email: the suppression list could not be consulted")
    try:
        from wobo_gateway import alerts
        from wobo_gateway.mailwatch import respond

        respond.raise_alert(
            respond.WATCH_UNREADABLE,
            (
                "The list of addresses that complained or bounced could not be read, so nobody "
                "can say who must not be written to."
            ),
            severity=alerts.CRITICAL,
            at=at or datetime.now(UTC),
            action=(
                "Learning mail is held until the list is read, which is tried again every half "
                "minute. Sign-in codes and receipts still go."
            ),
        )
    except Exception:  # noqa: BLE001 — the hold stands whatever the alarm does
        logger.warning("email: the unreadable suppression list could not be raised")
    return True


#: Mail the day's cap never holds: sign-in codes, receipts, account mail and the owner's own alert
#: (the transactional stream). The cap guards the learning stream's volume; a family that cannot
#: sign in or get a receipt because the day's learning notes and seed checks used the allowance
#: is the across-the-board slowdown the owner ruled out (2026-09-16: verify_email was held).
UNCAPPED_KINDS: frozenset[str] = frozenset(TRANSACTIONAL_KINDS)


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


#: The inboxes we own, that the seed test sends to (docs/MAIL-PRIMARY.md §3, "Then, the proof").
SEED_INBOXES: tuple[str, ...] = ("gmail", "outlook", "yahoo", "apple")
#: Where a seeded message landed. "unknown" is a real answer and is recorded as one.
#: Gmail's five tabs; ``inbox`` where a provider shows no tab over IMAP (Outlook, Yahoo, Apple);
#: ``missing`` for a mail that never arrived within the watch's wait (``mailwatch/placement.py``).
SEED_TABS: tuple[str, ...] = (
    "primary",
    "updates",
    "promotions",
    "social",
    "forums",
    "spam",
    "inbox",
    "missing",
    "unknown",
)


def record_seed_placement(
    *,
    kind: str,
    inbox: str,
    tab: str,
    at: datetime | None = None,
    learner_id: str | None = None,
    detail: dict[str, Any] | None = None,
) -> bool:
    """Record which tab a seeded message landed in. The gate on ever shipping the orb image.

    MAIL-PRIMARY is blunt about this: nothing has ever been delivered from our domain, so we
    have zero placement data of our own, and the orb GIF "takes every template from zero remote
    fetches to one and is the single largest planned change to our promotional profile. Measure
    the same five mails before and after, same sending identity, one variable, or ship nothing."

    The measurement is a human act — a person opens the seeded inbox and reads which tab it is
    in — so this is the place that act is WRITTEN DOWN, on the same append-only log as the sends,
    where the mail desk reads it. It carries no address: which of our own inboxes it was is the
    whole fact, and ``note_event`` stamps the no-address digest.

    Returns ``False`` for an inbox or a tab that is not one of the named ones, so a typo becomes
    a refusal rather than a row nobody can compare against next month's.
    """
    if inbox not in SEED_INBOXES or tab not in SEED_TABS:
        logger.warning(
            "mail seed: not a placement we can compare",
            extra={"fields": {"inbox": inbox, "tab": tab}},
        )
        return False
    mail_log().note_event(
        "seed",
        kind=kind,
        at=at,
        learner_id=learner_id,
        detail={**(detail or {}), "inbox": inbox, "tab": tab},
    )
    return True


# --- the envelope (docs/MAIL-PRIMARY.md, "The envelope") --------------------------------------
#: A constant 5 to 15 characters across EVERY mail stream. Feedback loops attribute a complaint
#: to the sender by this string, so a value that moved per kind would scatter our own complaint
#: data across as many senders as we have kinds and tell us nothing about any of them.
SENDER_ID = os.getenv("MAIL_SENDER_ID", "wobomail")


def _list_domain() -> str:
    """The domain the lists are named under: the From's own, read off it rather than repeated.

    One name in three places (the address, the List-Id, the DKIM signature) is the whole of what
    a reader is being asked to recognise, and a second constant here is how those drift apart.
    """
    address = _FROM.split("<")[-1].rstrip(">").strip()
    return address.split("@")[-1] or "mail.heywobo.com"


def _envelope_headers(kind: str, period: str | None, headers: dict[str, str]) -> dict[str, str]:
    """``List-Id`` and ``Feedback-ID``, added to whatever the template and the caller already set.

    ``List-Id`` is asked for by name in Google's subscription guidelines, one per kind and human
    readable. It goes on SUBSCRIBED kinds only: a verification code is not a list and must never
    look like one. The honest caveat, recorded here so nobody promises more than it does: Gmail's
    Manage subscriptions is documented as unsubscribing a reader from everything related to a
    sender, so per-kind granularity there is not proven. We set it because it is asked for and
    costs nothing, and we never tell anyone it protects the other kinds.

    ``Feedback-ID`` is monitoring only, with no documented classification effect. It is what
    turns "a kind nobody engages with is switched off by the superadmin" into a measurement
    rather than a guess, because the complaint data arrives already split by kind.

    Neither ever overwrites a header a caller set: the caller is closer to the send than we are.
    """
    out = dict(headers)
    if kind in SUBSCRIBED_KINDS and "List-Id" not in out:
        label = kind.replace("_", "-")
        out["List-Id"] = f"{APP_NAME} {kind.replace('_', ' ')} <{label}.{_list_domain()}>"
    if "Feedback-ID" not in out:
        # The colon is the separator, so nothing that rides in a segment may contain one.
        stream = "subscribed" if kind in SUBSCRIBED_KINDS else "transactional"
        campaign = re.sub(r"[^A-Za-z0-9._-]", "-", period or "none")[:64] or "none"
        out["Feedback-ID"] = f"{kind}:{stream}:{campaign}:{SENDER_ID}"
    return out


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

    # An address that complained or hard-bounced hears nothing more but a sign-in code or a
    # receipt (docs/MAIL-PRIMARY.md, "Watching where we land"). Not a would-send: nothing is
    # recorded, because a suppression is not a condition that clears and a queued row would be
    # retried for ever.
    if kind not in TRANSACTIONAL_KINDS and address_is_suppressed(to):
        logger.info(
            "email held: the address is suppressed",
            extra={"fields": {"kind": kind, "to_hash": to_hash(to)}},
        )
        return {"ok": False, "mode": mode, "error": "suppressed", "held": True}

    try:
        email = render(kind, data or {})
    except KeyError:
        logger.warning("email render skipped: unknown kind", extra={"fields": {"kind": kind}})
        return {"ok": False, "mode": mode, "error": "unknown_kind"}
    mail_headers = {**(email.get("headers") or {}), **(headers or {})}
    mail_headers = _envelope_headers(kind, period, mail_headers)

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

    # The superadmin's switch and the day's ceiling are read BEFORE the console branch, not
    # after it. They used to sit below both early returns, which meant neither was ever
    # consulted in the mode the whole suite and every local run use: the cap was correct code
    # that nothing could reach, and a kind the superadmin had switched off still rendered and
    # still wrote its idempotency key. Held here, both rules hold in every mode, and a held
    # mail is retried when the condition clears because a would-send is no longer a send.
    if kind_is_off(kind):
        return queued("kind_switched_off")
    # The watch's pause: this kind only, while every other kind carries on.
    if kind not in TRANSACTIONAL_KINDS and kind_is_paused(kind):
        return queued("kind_paused")
    if kind not in TRANSACTIONAL_KINDS and suppression_list_unreadable(at):
        return queued("suppression_unreadable")
    over = None if kind in UNCAPPED_KINDS else over_the_daily_cap(at=at)
    if over is not None:
        return queued(over)

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

    envelope: dict[str, Any] = {
        "from": sender_for(kind),
        "to": [to],
        "reply_to": _REPLY_TO,
        "subject": email["subject"],
        "html": email["html"],
        "text": email["text"],
        # Provider metadata, never a header in the message: the kind rides back on every
        # delivery event, so a complaint finds its kind without parsing anything
        # (``mailwatch/events.py``). Kind names are the provider's allowed characters already.
        "tags": [{"name": "kind", "value": kind}],
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
