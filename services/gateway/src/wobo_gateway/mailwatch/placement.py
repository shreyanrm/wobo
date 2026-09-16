"""The daily placement check: our own seed inboxes, asked where our mail landed.

docs/MAIL-PRIMARY.md: "What we measure: the tab each of the Primary-relevant mails lands in, on
Gmail, Outlook, Yahoo and Apple Mail inboxes we own". Until this, the measurement was a person
opening an inbox (``email.record_seed_placement``); now it is a job the cron runs, and the person's
seam stays for the months the job is not configured.

CONFIGURATION OR NOTHING. Each inbox is two environment variables,
``MAIL_SEED_<PROVIDER>_ADDRESS`` and ``MAIL_SEED_<PROVIDER>_PASSWORD`` (an app password, never the
account's own), for ``GMAIL``, ``OUTLOOK``, ``YAHOO`` and ``APPLE``. A provider with only one of
the two is not configured. With none, the job does nothing and the desk says "not configured".
Nothing is ever sent to an address that is not one of these, and no password leaves this module:
not in a mail, a log line, a report or the desk.

ONCE A DAY, AT THE FAMILY'S HOUR. From :data:`SEND_HOUR` in Kolkata (the nudges' own default
hour), one real mail of each :data:`PRIMARY_KINDS` goes to each configured inbox through the
ordinary send path, so the envelope, the sender and the headers are exactly what a family gets.
A send the path held (the day's cap, a pause) is tried again on the next pass. Nothing goes in
console mode: a render that went nowhere cannot land anywhere.

THE READ. From :data:`READ_AFTER` after a send, each inbox is opened over IMAP (TLS, port 993,
read-only) and asked for the mail by its subject: in the inbox, which Gmail tab (Gmail's own
``X-GM-RAW "category:..."`` search; the other three show no tab over IMAP, so the answer there is
"inbox"), or in the spam folder. The receiving server's ``Authentication-Results`` says whether
SPF, DKIM and DMARC passed. A mail in spam, a failed mechanism, and a mail still missing after
:data:`GIVE_UP` are each an alert naming the inbox and the kind. A promotions tab is shown, not
alarmed. Each result also lands on the mail log as the law's ``seed`` event.

WHAT A SEED IS NOT: a learner. It carries no learner id, its facts are fixed and fictional
(:func:`seed_data`), and its period (``seed-<day>-<inbox>``) never collides with a family's.
"""

from __future__ import annotations

import contextlib
import imaplib
import logging
import os
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from wobo_gateway import alerts
from wobo_gateway import email as email_mod
from wobo_gateway.email_templates import render
from wobo_gateway.hospitality.nudges import DEFAULT_HOUR
from wobo_gateway.hospitality.tokens import stop_link
from wobo_gateway.mailwatch import respond, store

logger = logging.getLogger("wobo.gateway.mailwatch")


@dataclass(frozen=True)
class Provider:
    name: str
    host: str
    spam: tuple[str, ...]
    tabs: bool = False


PROVIDERS: dict[str, Provider] = {
    "gmail": Provider("gmail", "imap.gmail.com", spam=("[Gmail]/Spam",), tabs=True),
    "outlook": Provider("outlook", "outlook.office365.com", spam=("Junk",)),
    "yahoo": Provider("yahoo", "imap.mail.yahoo.com", spam=("Bulk", "Bulk Mail")),
    "apple": Provider("apple", "imap.mail.me.com", spam=("Junk",)),
}
#: The five the law names, and the good-news note, which is most of what a family now receives.
PRIMARY_KINDS: tuple[str, ...] = (
    "welcome",
    "quick_one",
    "mid_chapter",
    "doubt",
    "sunday_note",
    "learning_note",
)
GMAIL_TABS: tuple[str, ...] = ("primary", "social", "promotions", "updates", "forums")
ZONE = ZoneInfo("Asia/Kolkata")
SEND_HOUR = DEFAULT_HOUR
READ_AFTER = timedelta(minutes=15)
GIVE_UP = timedelta(hours=6)
IMAP_TIMEOUT_S = 20.0
#: Whose stop link a seed carries. Not a learner: a press of it changes nobody's mail.
SEED_LEARNER = "seed-placement"
SENT, READ = "sent", "read"


@dataclass(frozen=True)
class Seed:
    provider: str
    address: str
    password: str = field(repr=False)


def seeds() -> dict[str, Seed]:
    """The configured inboxes, by provider. Both halves or nothing."""
    found: dict[str, Seed] = {}
    for name in PROVIDERS:
        address = (os.getenv(f"MAIL_SEED_{name.upper()}_ADDRESS") or "").strip()
        password = (os.getenv(f"MAIL_SEED_{name.upper()}_PASSWORD") or "").strip()
        if address and password and email_mod._address_of(address) == address:
            found[name] = Seed(name, address, password)
    return found


def configured() -> bool:
    return bool(seeds())


def _live() -> bool:
    return os.getenv("EMAIL_MODE", "console").lower() == "live"


_FACTS: dict[str, dict[str, Any]] = {
    "welcome": {
        "name": "Asha",
        "board_short": "CBSE",
        "class_name": "8",
        "subject": "science",
        "chapter": "Force and Pressure",
    },
    "quick_one": {"name": "Asha", "chapter": "Fractions, part two", "minutes": 5},
    "mid_chapter": {"name": "Asha", "chapter": "Linear equations", "cards_left": 2},
    "doubt": {"name": "Asha", "chapter": "Refraction"},
    "sunday_note": {
        "learner_name": "Asha",
        "headline": "Four days of learning, and Fractions is solid now.",
        "days_active": 4,
    },
    "learning_note": {
        "name": "Asha",
        "angle": "next",
        "title": "Fractions",
        "done": 4,
        "cards_left": 6,
    },
}
_AUDIENCE: dict[str, str] = {"welcome": "learner", "sunday_note": "sunday_note"}


def seed_data(kind: str) -> dict[str, Any]:
    """The fixed, fictional facts a seed of ``kind`` is rendered from, with a real stop link, so
    the envelope is the one a family's mail carries. The subject never changes from day to day."""
    data: dict[str, Any] = dict(_FACTS.get(kind, {"name": "Asha"}))
    if kind not in {"welcome", "sunday_note"}:
        data.setdefault("audience", "learner")
        data.setdefault("cadence", "full")
    link = stop_link(SEED_LEARNER, _AUDIENCE.get(kind, kind))
    if link:
        data["unsubscribe_url"] = link
    return data


def _period(day: date, provider: str) -> str:
    return f"seed-{day:%Y%m%d}-{provider}"


def _key(day: date, provider: str, kind: str, step: str) -> str:
    return f"{store.PLACEMENT}:{day.isoformat()}:{provider}:{kind}:{step}"


# --- the mailbox ----------------------------------------------------------------------------------
class Mailbox(Protocol):
    def find(self, folder: str, subject: str, since: datetime) -> str | None: ...

    def category(self, uid: str, subject: str, since: datetime) -> str | None: ...

    def authentication(self, folder: str, uid: str, subject: str) -> str: ...

    def close(self) -> None: ...


_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _imap_date(day: date) -> str:
    return f"{day.day:02d}-{_MONTHS[day.month - 1]}-{day.year}"


def _quoted(text: str) -> str:
    """An IMAP quoted string, ASCII only: the longest ASCII stretch of ``text`` is searched,
    which a substring search still finds."""
    stretches = re.split(r"[^\x20-\x7e]+", text)
    safe = max(stretches, key=len) if stretches else ""
    return '"' + safe.replace("\\", "\\\\").replace('"', '\\"') + '"'


class ImapMailbox:
    """One seed inbox over IMAP, read-only. Opened per pass and closed after it."""

    def __init__(
        self,
        seed: Seed,
        *,
        factory: Callable[..., Any] = imaplib.IMAP4_SSL,
        timeout: float = IMAP_TIMEOUT_S,
    ) -> None:
        self._spec = PROVIDERS[seed.provider]
        self._imap = factory(self._spec.host, 993, timeout=timeout)
        self._imap.login(seed.address, seed.password)
        self._selected: str | None = None

    def _select(self, folder: str) -> bool:
        if self._selected == folder:
            return True
        typ, _ = self._imap.select(f'"{folder}"', readonly=True)
        self._selected = folder if typ == "OK" else None
        return typ == "OK"

    def _uids(self, *criteria: str) -> list[bytes]:
        typ, data = self._imap.uid("SEARCH", *criteria)
        if typ != "OK" or not data or not data[0]:
            return []
        return list(data[0].split())

    def _arrived(self, uid: bytes) -> datetime | None:
        typ, data = self._imap.uid("FETCH", uid.decode(), "(INTERNALDATE)")
        if typ != "OK":
            return None
        for part in data or []:
            raw = part if isinstance(part, bytes) else (part[0] if isinstance(part, tuple) else b"")
            parsed = imaplib.Internaldate2tuple(raw) if raw else None
            if parsed:
                return datetime.fromtimestamp(time.mktime(parsed), UTC)
        return None

    def find(self, folder: str, subject: str, since: datetime) -> str | None:
        """The newest mail in ``folder`` with this subject that arrived after ``since``. The
        subject repeats every day, so yesterday's seed must never answer for today's."""
        if not self._select(folder):
            return None
        uids = self._uids(
            "SINCE", _imap_date(since.date() - timedelta(days=1)), "SUBJECT", _quoted(subject)
        )
        floor = since - timedelta(minutes=5)
        for uid in reversed(uids):
            arrived = self._arrived(uid)
            if arrived is not None and arrived >= floor:
                return uid.decode()
        return None

    def category(self, uid: str, subject: str, since: datetime) -> str | None:
        if not self._spec.tabs or not self._select("INBOX"):
            return None
        for tab in GMAIL_TABS:
            if uid.encode() in self._uids("UID", uid, "X-GM-RAW", f'"category:{tab}"'):
                return tab
        return None

    def authentication(self, folder: str, uid: str, subject: str) -> str:
        if not self._select(folder):
            return ""
        typ, data = self._imap.uid(
            "FETCH", uid, "(BODY.PEEK[HEADER.FIELDS (AUTHENTICATION-RESULTS)])"
        )
        if typ != "OK":
            return ""
        blob = b"".join(part[1] for part in data or [] if isinstance(part, tuple) and len(part) > 1)
        text = re.sub(r"\r?\n[ \t]+", " ", blob.decode("utf-8", "replace"))
        values = [
            line.split(":", 1)[1].strip()
            for line in text.splitlines()
            if line.lower().startswith("authentication-results:")
        ]
        # The first header is the receiving server's own; anything below it came with the mail.
        return values[0] if values else ""

    def close(self) -> None:
        for step in ("close", "logout"):
            try:
                if step == "close" and self._selected is None:
                    continue
                getattr(self._imap, step)()
            except Exception:  # noqa: BLE001, S110 — a mailbox that will not close is closed
                pass


def open_imap(seed: Seed) -> Mailbox:
    return ImapMailbox(seed)


# --- what the receiving server said ---------------------------------------------------------------
_MECHANISMS: tuple[str, ...] = ("spf", "dkim", "dmarc")
_RESULT = re.compile(r"\b(spf|dkim|dmarc)\s*=\s*([a-z]+)", re.IGNORECASE)


def parse_auth(header: str) -> dict[str, str]:
    """Each mechanism's verdict: ``pass`` when any of its results passed, else the first seen."""
    out: dict[str, str] = {}
    for mechanism, verdict in _RESULT.findall(header or ""):
        mechanism, verdict = mechanism.lower(), verdict.lower()
        if mechanism not in out or verdict == "pass":
            out[mechanism] = verdict
    return out


def failed(results: dict[str, str]) -> list[str]:
    """The mechanisms that did not pass, in the order a reader checks them."""
    return [m for m in _MECHANISMS if m in results and results[m] != "pass"]


# --- the pass ------------------------------------------------------------------------------------
def _read(box: Mailbox, row: store.WatchRow, now: datetime) -> dict[str, Any] | None:
    provider = str(row.detail.get("provider"))
    spec = PROVIDERS[provider]
    subject = str(row.detail.get("subject") or "")
    folder: str | None = None
    uid = box.find("INBOX", subject, row.at)
    tab = ""
    if uid is not None:
        folder = "INBOX"
        tab = (box.category(uid, subject, row.at) or "unknown") if spec.tabs else "inbox"
    else:
        for candidate in spec.spam:
            uid = box.find(candidate, subject, row.at)
            if uid is not None:
                folder, tab = candidate, "spam"
                break
    if uid is None:
        if now - row.at < GIVE_UP:
            return None
        return {"tab": "missing", "folder": None, "auth": {}}
    auth = parse_auth(box.authentication(folder or "INBOX", uid, subject))
    return {"tab": tab, "folder": folder, "auth": auth}


def _answer(row: store.WatchRow, result: dict[str, Any], now: datetime) -> None:
    provider = str(row.detail.get("provider"))
    day = str(row.detail.get("day"))
    kind = row.kind
    watch = store.get_store()
    watch.add(
        store.WatchRow(
            what=store.PLACEMENT,
            key=row.key.rsplit(":", 1)[0] + f":{READ}",
            at=now,
            kind=kind,
            event=result["tab"],
            detail={
                "provider": provider,
                "day": day,
                "folder": result["folder"],
                "auth": result["auth"],
                "sent_at": row.at.isoformat(),
            },
        )
    )
    email_mod.record_seed_placement(
        kind=kind,
        inbox=provider,
        tab=result["tab"],
        at=now,
        detail={"day": day, "folder": result["folder"]},
    )
    if result["tab"] == "spam":
        respond.raise_alert(
            respond.SEED_IN_SPAM,
            f"The {kind} seed sent to our {provider} inbox on {day} landed in its "
            f"{result['folder']} folder.",
            severity=alerts.WARN,
            kind=kind,
            at=now,
            action="Nothing was paused: one seed is a sign, the complaint rate is the measure.",
        )
    elif result["tab"] == "missing":
        hours = int(GIVE_UP.total_seconds() // 3600)
        respond.raise_alert(
            respond.SEED_MISSING,
            f"The {kind} seed sent to our {provider} inbox on {day} had not arrived after "
            f"{hours} hours, in the inbox or the spam folder. The provider's log says whether it "
            "bounced or was dropped.",
            severity=alerts.WARN,
            kind=kind,
            at=now,
        )
    bad = failed(result["auth"])
    if bad:
        words = ", ".join(f"{m.upper()} {result['auth'][m]}" for m in bad)
        respond.raise_alert(
            respond.AUTHENTICATION,
            f"The {kind} seed at our {provider} inbox on {day} failed authentication: {words}. "
            "Check the sending domain's DNS records.",
            severity=alerts.CRITICAL,
            kind=kind,
            at=now,
        )


def run_placement(
    now: datetime,
    *,
    send: Callable[..., dict[str, Any]] | None = None,
    open_mailbox: Callable[[Seed], Mailbox] | None = None,
) -> dict[str, Any]:
    """One pass: read what is due, then send what today still owes. Safe to run every hour."""
    found = seeds()
    report: dict[str, Any] = {
        "configured": bool(found),
        "live": _live(),
        "sent": 0,
        "held": {},
        "read": 0,
        "unreadable": [],
    }
    if not found or not report["live"]:
        return report
    sender = send or email_mod.send_email
    opener = open_mailbox or open_imap
    moment = now.astimezone(UTC)
    watch = store.get_store()

    due: dict[str, list[store.WatchRow]] = {}
    for row in watch.rows(store.PLACEMENT, since=moment - timedelta(days=2)):
        if row.event != SENT or row.detail.get("provider") not in found:
            continue
        if watch.has(row.key.rsplit(":", 1)[0] + f":{READ}") or moment - row.at < READ_AFTER:
            continue
        due.setdefault(str(row.detail["provider"]), []).append(row)
    for provider, rows in due.items():
        try:
            box = opener(found[provider])
        except Exception as exc:  # noqa: BLE001 — a login that fails is a reason, never a crash
            logger.warning(
                "mail watch: a seed inbox could not be opened",
                extra={"fields": {"provider": provider, "error": type(exc).__name__}},
            )
            report["unreadable"].append(provider)
            continue
        try:
            for row in rows:
                result = _read(box, row, moment)
                if result is not None:
                    _answer(row, result, moment)
                    report["read"] += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "mail watch: a seed inbox could not be read",
                extra={"fields": {"provider": provider, "error": type(exc).__name__}},
            )
            report["unreadable"].append(provider)
        finally:
            with contextlib.suppress(Exception):
                box.close()

    local = moment.astimezone(ZONE)
    if local.hour < SEND_HOUR:
        return report
    day = local.date()
    for provider, seed in found.items():
        for kind in PRIMARY_KINDS:
            key = _key(day, provider, kind, SENT)
            if watch.has(key):
                continue
            data = seed_data(kind)
            subject = render(kind, data)["subject"]
            result = sender(kind, seed.address, data, period=_period(day, provider), at=moment)
            if not result.get("ok"):
                reason = str(result.get("error") or "held")
                report["held"][reason] = report["held"].get(reason, 0) + 1
                continue
            watch.add(
                store.WatchRow(
                    what=store.PLACEMENT,
                    key=key,
                    at=moment,
                    kind=kind,
                    event=SENT,
                    detail={
                        "provider": provider,
                        "day": day.isoformat(),
                        "subject": subject,
                        "email_id": str(result.get("id") or "")[:64],
                    },
                )
            )
            report["sent"] += 1
    return report


def desk_view() -> dict[str, Any]:
    """Which inboxes are configured and where each kind last landed in each. Never an address."""
    found = seeds()
    latest: dict[tuple[str, str], store.WatchRow] = {}
    for row in store.get_store().rows(store.PLACEMENT):
        if row.key.endswith(f":{READ}"):
            latest[(str(row.detail.get("provider")), row.kind)] = row
    return {
        "configured": bool(found),
        "live": _live(),
        "providers": [{"provider": p, "configured": p in found} for p in PROVIDERS],
        "kinds": list(PRIMARY_KINDS),
        "send_hour": SEND_HOUR,
        "zone": "Asia/Kolkata",
        "results": [
            {
                "provider": provider,
                "kind": kind,
                "tab": row.event,
                "folder": row.detail.get("folder"),
                "day": row.detail.get("day"),
                "auth": row.detail.get("auth") or {},
                "at": row.at.isoformat(),
            }
            for (provider, kind), row in sorted(latest.items())
        ],
    }


__all__ = [
    "GIVE_UP",
    "GMAIL_TABS",
    "PRIMARY_KINDS",
    "PROVIDERS",
    "READ_AFTER",
    "SEND_HOUR",
    "ImapMailbox",
    "Mailbox",
    "Provider",
    "Seed",
    "configured",
    "desk_view",
    "failed",
    "open_imap",
    "parse_auth",
    "run_placement",
    "seed_data",
    "seeds",
]
