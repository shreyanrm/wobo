"""Answering without slowing down, and telling the owner (docs/MAIL-PRIMARY.md, "Watching where we
land").

THE RULES, each aimed at a cause and never at the whole cadence:

* **A kind over the operating target is paused on its own.** Complaints over delivered mail in
  the last :data:`WINDOW_DAYS`, per kind: over :data:`PAUSE_AT` (0.10 percent) and that kind stops
  while every other kind carries on. When the rate over everything crosses the target and no one
  kind has on its own count, the kind driving it (the worst rate among those not already paused)
  is the one paused.
* **At Gmail's cliff every kind that crossed pauses.** Over :data:`CLIFF` (0.30 percent), overall
  or for any one kind, on its own count however small, a single complaint is enough for any kind
  already over the target (2026-09-16: one complaint in three hundred crossed both lines and
  paused nothing).
* **Between the lines one complaint does not pause a kind for everybody** (:data:`MIN_COMPLAINTS`).
  The address that complained is suppressed at once (:mod:`.events`), and the law itself says one
  confused adult can report a legitimate school notice. The owner is told all the same: every
  crossing is an alert, paused or not.
* **Sign-in codes and receipts are never paused** (:data:`NEVER_PAUSED`), and neither is the
  owner's alert. The dial cannot hold one even if somebody writes it by hand.
* **A pause stays until the owner lifts it** (``POST /v1/admin/mail/unpause``), and a lifted kind
  is judged only on what happens after, so an old week cannot pause it again: a complaint that
  arrives after the lift about a mail sent before it is not counted.
* **Gmail's own numbers** (:mod:`.postmaster`) answer the same way: a Feedback-ID kind over the
  target is paused. A rate with no kind to point at is an alert and pauses nothing, because
  pausing a guess, or everything, is the across-the-board slowdown the owner ruled out.

WHAT NEVER HAPPENS HERE: the daily cap, the ladder, the floor and the sender are not touched. A
sender change is a manual setting (``EMAIL_FROM``), made by hand once the cause is fixed, and the
alert says so.

THE ALERT. Every cause is mailed to :func:`alert_to` (``DELIVERABILITY_ALERT_TO``), written as the
``mail_deliverability`` alarm, and kept as a row the mail desk shows, because an alert about mail
must not depend on mail alone. The row's key carries the cause, the kind and the hour, so one bad
hour is one alert. A mail that did not go (no provider key, a provider outage) is sent again on
every hourly pass until it does (:func:`retry_unmailed`), and the desk says which were mailed.
Nothing in an alert is ever an address: a receiving server's words are scrubbed (:func:`scrub`).
"""

from __future__ import annotations

import logging
import os
import re
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from wobo_gateway import alerts, doors
from wobo_gateway.email import (
    KINDS_PAUSED_DIAL,
    _address_of,
    idempotency_key,
    mail_log,
    send_email,
)
from wobo_gateway.email_templates import ALERT_KIND, KINDS, TRANSACTIONAL_KINDS
from wobo_gateway.mailwatch import store

logger = logging.getLogger("wobo.gateway.mailwatch")

#: The operating target: docs/MAIL-PRIMARY.md §5, "0.1 percent is the ceiling we manage to".
PAUSE_AT = 0.001
#: Gmail's cliff: above it a sender loses every delivery mitigation until seven clean days.
CLIFF = 0.003
#: How far back a complaint rate is measured.
WINDOW_DAYS = 7
#: Below the cliff, a kind is paused on its own count only from this many complaints.
MIN_COMPLAINTS = 2
#: SPF, DKIM or DMARC passing on less than this share of Gmail's mail is an alert.
AUTH_FLOOR = 0.98
#: Never paused, whatever the numbers or the dial say.
NEVER_PAUSED: frozenset[str] = frozenset(TRANSACTIONAL_KINDS)
#: Who the watch writes its own dial changes as. Nobody: ``ops.settings.updated_by`` is a person's
#: id, and the watch is not a person. The note on the change says it was the watch.
ACTOR: str | None = None

ALERT_TO_ENV = "DELIVERABILITY_ALERT_TO"
DEFAULT_ALERT_TO = "shreyan@doteventures.com"

# --- the causes an alert names --------------------------------------------------------------------
COMPLAINT_RATE = "complaint_rate"
GMAIL_SPAM_RATE = "gmail_spam_rate"
SEED_IN_SPAM = "seed_in_spam"
SEED_MISSING = "seed_missing"
AUTHENTICATION = "authentication"
REPUTATION = "reputation"
TRACKING_ON = "tracking_on"
#: A kind crossed the target on a single complaint between the lines: nothing paused, owner told.
COMPLAINT_WATCH = "complaint_watch"
#: The suppression list could not be read, and learning mail is held until it can.
WATCH_UNREADABLE = "watch_unreadable"
CAUSES: tuple[str, ...] = (
    COMPLAINT_RATE,
    COMPLAINT_WATCH,
    WATCH_UNREADABLE,
    GMAIL_SPAM_RATE,
    SEED_IN_SPAM,
    SEED_MISSING,
    AUTHENTICATION,
    REPUTATION,
    TRACKING_ON,
)
#: The headline each cause is mailed under. Lower case after the first word, no capitals run: it
#: is a subject line (docs/MAIL-PRIMARY.md, "What a test asserts").
_HEADLINES: dict[str, str] = {
    COMPLAINT_RATE: "{kind} paused after complaints",
    GMAIL_SPAM_RATE: "Gmail spam rate is over the line",
    SEED_IN_SPAM: "A seed mail landed in spam",
    SEED_MISSING: "A seed mail did not arrive",
    AUTHENTICATION: "Authentication failed",
    REPUTATION: "The Postmaster verdict needs a look",
    TRACKING_ON: "Open tracking is on at the provider",
    COMPLAINT_WATCH: "A complaint about {kind}",
    WATCH_UNREADABLE: "The suppression list cannot be read",
}
#: How far back an alert that was not mailed is mailed again.
RETRY_DAYS = 3
_AN_ADDRESS = re.compile(r"<?[^\s<>@\"'(),;:]+@[^\s<>@\"'(),;:]+>?")


def scrub(value: Any) -> Any:
    """``value`` with every address in it replaced by the words "an address", however deep.

    A receiving server's bounce text names the recipient (2026-09-16: a child's school address
    reached the alert row, the alarm, the owner's mail and the desk the lowest seat reads).
    """
    if isinstance(value, str):
        return _AN_ADDRESS.sub("an address", value)
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [scrub(v) for v in value]
    return value

_lock = threading.Lock()


def alert_to() -> str:
    """The owner's inbox for these alerts: the setting when it names one address, else the
    owner's own. An unreadable setting never means nobody hears."""
    return _address_of(os.getenv(ALERT_TO_ENV) or "") or DEFAULT_ALERT_TO


def percent(rate: float | None) -> str:
    """0.0015 -> "0.15". Two places, because the lines are 0.10 and 0.30."""
    return "unknown" if rate is None else f"{rate * 100:.2f}"


# --- the numbers ----------------------------------------------------------------------------------
@dataclass
class KindStat:
    kind: str
    delivered_events: int = 0
    sent: int = 0
    complained: int = 0
    hard: int = 0
    soft: int = 0
    delayed: int = 0
    suppressed: int = 0
    failed: int = 0
    #: The newest complaint counted, by its event's key: what a one-complaint alert is once for.
    last_complaint: str = ""

    @property
    def delivered(self) -> int:
        """The denominator: the provider's deliveries, or our own sends when those are more (a
        webhook registered mid-week has not reported the mail that went before it)."""
        return max(self.delivered_events, self.sent)

    @property
    def rate(self) -> float | None:
        return self.complained / self.delivered if self.delivered else None

    def add(self, other: KindStat) -> None:
        self.delivered_events += other.delivered_events
        self.sent += other.sent
        self.complained += other.complained
        self.hard += other.hard
        self.soft += other.soft
        self.delayed += other.delayed
        self.suppressed += other.suppressed
        self.failed += other.failed

    def view(self) -> dict[str, Any]:
        return {
            "delivered": self.delivered,
            "complained": self.complained,
            "rate": self.rate,
            "hard_bounces": self.hard,
            "soft_bounces": self.soft,
            "delayed": self.delayed,
        }


@dataclass
class Window:
    since: datetime
    kinds: dict[str, KindStat] = field(default_factory=dict)
    overall: KindStat = field(default_factory=lambda: KindStat("all"))


def _dial() -> dict[str, Any]:
    try:
        value = doors.get_store().read(KINDS_PAUSED_DIAL)
    except Exception:  # noqa: BLE001 — a dial we cannot read is a dial with nothing on it
        return {}
    return dict(value) if isinstance(value, dict) else {}


def _lifted(entry: Any) -> datetime | None:
    if not isinstance(entry, dict) or not entry.get("lifted_at"):
        return None
    return store._when(entry["lifted_at"])


def window(now: datetime) -> Window:
    """Every kind's numbers over the last :data:`WINDOW_DAYS`, each from the later of the window's
    start and the moment the owner last lifted its pause."""
    moment = now.astimezone(UTC)
    since = moment - timedelta(days=WINDOW_DAYS)
    dial = _dial()
    starts: dict[str, datetime] = {}

    def start_for(kind: str) -> datetime:
        if kind not in starts:
            lifted = _lifted(dial.get(kind))
            starts[kind] = max(since, lifted) if lifted else since
        return starts[kind]

    out = Window(since=since)

    def stat(kind: str) -> KindStat:
        return out.kinds.setdefault(kind, KindStat(kind))

    for row in store.get_store().rows(store.DELIVERY, since=since):
        if row.at < start_for(row.kind):
            continue
        lifted = _lifted(dial.get(row.kind))
        mailed = store._when(row.detail.get("sent_at")) if row.detail.get("sent_at") else None
        if lifted is not None and mailed is not None and mailed < lifted:
            # About a mail that went before the owner lifted the pause: the old week, arriving late.
            continue
        entry = stat(row.kind)
        if row.event == "delivered":
            entry.delivered_events += 1
        elif row.event == "complained":
            entry.complained += 1
            entry.last_complaint = row.key
        elif row.event == "bounced":
            if row.detail.get("bounce") == "hard":
                entry.hard += 1
            else:
                entry.soft += 1
        elif row.event == "delayed":
            entry.delayed += 1
        elif row.event == "suppressed":
            entry.suppressed += 1
        elif row.event == "failed":
            entry.failed += 1
    for record in mail_log().records():
        if record.provider_id in {"queued", "console", ""}:
            continue
        sent_at = store._when(record.sent_at)
        if sent_at is None or sent_at < start_for(record.kind):
            continue
        stat(record.kind).sent += 1
    for entry in out.kinds.values():
        out.overall.add(entry)
    return out


# --- the dial -------------------------------------------------------------------------------------
def paused() -> dict[str, dict[str, Any]]:
    """Every kind the watch has paused and not been lifted, with why and since when."""
    return {
        kind: entry
        for kind, entry in _dial().items()
        if isinstance(entry, dict) and entry.get("paused") is True and kind not in NEVER_PAUSED
    }


PAUSED, ALREADY, NEVER, UNWRITTEN = "paused", "already", "never", "unwritten"


def _pause(kind: str, *, at: datetime, reason: str, detail: dict[str, Any] | None) -> str:
    if kind in NEVER_PAUSED or kind not in KINDS:
        return NEVER
    with _lock:
        dial = _dial()
        entry = dial.get(kind) if isinstance(dial.get(kind), dict) else {}
        if entry.get("paused") is True:
            return ALREADY
        dial[kind] = {
            **(detail or {}),
            "paused": True,
            "reason": reason,
            "since": at.astimezone(UTC).isoformat(),
            "lifted_at": entry.get("lifted_at"),
        }
        try:
            doors.get_store().write(
                KINDS_PAUSED_DIAL,
                dial,
                actor=ACTOR,
                note=f"{reason}: {kind} paused by the mail watch",
            )
        except Exception as exc:  # noqa: BLE001 — told to the owner, never raised into a webhook
            logger.error(
                "mail watch: a pause could not be written",
                extra={"fields": {"kind": kind, "error": type(exc).__name__}},
            )
            return UNWRITTEN
    logger.warning(
        "mail watch: a kind is paused", extra={"fields": {"kind": kind, "reason": reason}}
    )
    return PAUSED


def pause(kind: str, *, at: datetime, reason: str, detail: dict[str, Any] | None = None) -> bool:
    """Pause one kind. ``False`` for a kind that may never be paused, is not ours, already is, or
    whose pause could not be written."""
    return _pause(kind, at=at, reason=reason, detail=detail) == PAUSED


def _unwritten_action(kind: str) -> str:
    return (
        f"The pause on {kind} could NOT be written to ops.settings, so {kind} is still going out. "
        f"Pause it by hand: add {kind} to the mail.kinds_paused dial with paused set to true."
    )


def unpause(kind: str, *, actor: str | None, note: str | None, at: datetime) -> bool:
    """Lift a pause. ``False`` when the kind is not paused. The owner's act, written as theirs."""
    with _lock:
        dial = _dial()
        entry = dial.get(kind)
        if not isinstance(entry, dict) or entry.get("paused") is not True:
            return False
        dial[kind] = {
            **entry,
            "paused": False,
            "lifted_at": at.astimezone(UTC).isoformat(),
            "lifted_by": actor,
        }
        doors.get_store().write(KINDS_PAUSED_DIAL, dial, actor=actor, note=note)
    return True


# --- the alert ------------------------------------------------------------------------------------
def raise_alert(
    cause: str,
    message: str,
    *,
    severity: str,
    at: datetime,
    kind: str = "",
    action: str = "",
    detail: dict[str, Any] | None = None,
    once: str = "",
) -> bool:
    """Mail the owner, ring the alarm, keep the row. ``False`` when this cause already rang this
    hour (or, with ``once``, already rang for that one fact). Never raises: an alert that breaks
    the webhook it came from helps nobody."""
    moment = at.astimezone(UTC)
    hour = re.sub(r"[^A-Za-z0-9_.-]", "-", once)[:96] if once else moment.strftime("%Y-%m-%dT%H")
    scope = kind or "all"
    message, action = scrub(message), scrub(action)
    row = store.WatchRow(
        what=store.ALERT,
        key=f"{store.ALERT}:{cause}:{scope}:{hour}",
        at=moment,
        kind=kind,
        event=cause,
        detail=scrub(
            {**(detail or {}), "message": message, "severity": severity, "action": action}
        ),
    )
    if not store.get_store().add(row):
        return False
    try:
        alerts.alert(
            alerts.MAIL_DELIVERABILITY,
            message,
            severity=severity,
            page_key=f"{cause}:{scope}",
            cause=cause,
            kind=kind or None,
        )
    except Exception:  # noqa: BLE001
        logger.warning(
            "mail watch: the alarm could not be raised", extra={"fields": {"cause": cause}}
        )
    _mail(row, at=moment)
    return True


def _period(row: store.WatchRow) -> str:
    """The alert mail's once-only period: the row's own key, which is one cause, one kind and one
    hour (or one fact)."""
    return re.sub(r"[^A-Za-z0-9_.-]", "-", row.key.removeprefix(f"{store.ALERT}:"))[:160]


def alert_mailed(row: store.WatchRow) -> bool:
    """Did this alert's mail actually go? Read from the send log, where a held or failed send is
    no send (2026-09-16: the desk said every alert was mailed while none had been)."""
    key = idempotency_key(ALERT_KIND, alert_to(), _period(row))
    return mail_log().seen(key) is not None


def _mail(row: store.WatchRow, *, at: datetime) -> bool:
    cause, kind = row.event, row.kind
    headline = _HEADLINES.get(cause, "Something needs a look").format(
        kind=kind.replace("_", " ") or "a kind"
    )
    try:
        result = send_email(
            ALERT_KIND,
            alert_to(),
            {
                "headline": headline[:1].upper() + headline[1:],
                "line": str(row.detail.get("message") or ""),
                "action": str(row.detail.get("action") or "") or "Nothing was paused.",
            },
            period=_period(row),
            at=at,
        )
    except Exception:  # noqa: BLE001 — send_email never raises; belt and braces
        result = {"ok": False, "error": "raised"}
    if not result.get("ok"):
        logger.warning(
            "mail watch: the alert mail did not go; it is tried again every hour",
            extra={"fields": {"cause": cause, "error": result.get("error")}},
        )
    return bool(result.get("ok"))


def retry_unmailed(now: datetime) -> list[str]:
    """Mail every recent alert whose mail has not gone. Returns the keys that went now."""
    moment = now.astimezone(UTC)
    went: list[str] = []
    for row in store.get_store().rows(store.ALERT, since=moment - timedelta(days=RETRY_DAYS)):
        if not alert_mailed(row) and _mail(row, at=moment):
            went.append(row.key)
    return went


def _paused_action(kind: str) -> str:
    return (
        f"Paused {kind} only. It stays paused until the owner lifts it on the mail desk, and "
        "every other kind carries on."
    )


# --- the provider's numbers -----------------------------------------------------------------------
def evaluate(now: datetime) -> dict[str, Any]:
    """Read the window, pause what crossed, alert on each new pause. Safe to run at any time."""
    moment = now.astimezone(UTC)
    current = paused()
    w = window(moment)
    pausable = {k: s for k, s in w.kinds.items() if k not in NEVER_PAUSED and k in KINDS}

    def over(stat: KindStat, line: float, least: int) -> bool:
        return stat.complained >= least and stat.rate is not None and stat.rate > line

    cliff = over(w.overall, CLIFF, 1) or any(over(s, CLIFF, 1) for s in w.kinds.values())
    least = 1 if cliff else MIN_COMPLAINTS
    crossed = sorted(k for k, s in pausable.items() if over(s, PAUSE_AT, least))
    if not crossed:
        # The whole crossed and no one kind did: the rest of the mail, with what is already paused
        # taken out, points at the kind driving it.
        rest = [s for k, s in pausable.items() if k not in current]
        combined = KindStat("rest")
        for entry in rest:
            combined.add(entry)
        if over(combined, PAUSE_AT, MIN_COMPLAINTS):
            candidates = [s for s in rest if s.complained > 0 and s.rate is not None]
            if candidates:
                worst = max(candidates, key=lambda s: (s.rate or 0.0, s.complained, s.kind))
                crossed = [worst.kind]
    severity = alerts.CRITICAL if cliff else alerts.WARN
    newly: list[str] = []
    for kind in crossed:
        if kind in current:
            continue
        stat = w.kinds[kind]
        outcome = _pause(
            kind,
            at=moment,
            reason=COMPLAINT_RATE,
            detail={
                "source": "provider",
                "rate": stat.rate,
                "threshold": PAUSE_AT,
                "complaints": stat.complained,
                "delivered": stat.delivered,
                "cliff": cliff,
            },
        )
        if outcome not in (PAUSED, UNWRITTEN):
            continue
        if outcome == PAUSED:
            newly.append(kind)
        raise_alert(
            COMPLAINT_RATE,
            (
                f"Complaints on {kind} reached {percent(stat.rate)} percent over the last "
                f"{WINDOW_DAYS} days ({stat.complained} of {stat.delivered} delivered), over the "
                f"{percent(PAUSE_AT)} percent line"
                + (f", with the mail at Gmail's {percent(CLIFF)} percent cliff." if cliff else ".")
            ),
            severity=severity,
            kind=kind,
            at=moment,
            action=_paused_action(kind) if outcome == PAUSED else _unwritten_action(kind),
            detail={"rate": stat.rate, "source": "provider"},
        )
    # A kind over the target on a count too small to pause it for everybody: nothing paused, and
    # the owner hears all the same (2026-09-16: "make sure i get alerted").
    for kind in sorted(pausable):
        stat = w.kinds[kind]
        if kind in crossed or kind in current or not over(stat, PAUSE_AT, 1):
            continue
        raise_alert(
            COMPLAINT_WATCH,
            (
                f"Complaints on {kind} reached {percent(stat.rate)} percent over the last "
                f"{WINDOW_DAYS} days ({stat.complained} of {stat.delivered} delivered), over the "
                f"{percent(PAUSE_AT)} percent line, on fewer than {MIN_COMPLAINTS} complaints."
            ),
            severity=alerts.WARN,
            kind=kind,
            at=moment,
            action=(
                "Nothing was paused: the address that complained no longer hears from us, and one "
                f"more complaint on {kind} this week pauses it."
            ),
            detail={"rate": stat.rate, "source": "provider"},
            once=f"{stat.complained}-{stat.last_complaint}",
        )
    return {
        "at": moment.isoformat(),
        "window_days": WINDOW_DAYS,
        "overall": w.overall.view(),
        # The state after this pass: the cliff, or a kind standing paused, or nothing wrong.
        "severity": severity if (crossed or cliff or paused()) else None,
        "paused": sorted(paused()),
        "newly_paused": newly,
    }


# --- Google's numbers -----------------------------------------------------------------------------
#: A Postmaster v2 deliverability verdict that names a problem.
PROBLEM_VERDICTS: frozenset[str] = frozenset(
    {"SMTP_ERRORS_HIGH", "SENDER_NOT_COMPLIANT", "SPAM_RATE_HIGH", "USER_FEEDBACK_NEGATIVE"}
)


def evaluate_postmaster(reading: dict[str, Any], now: datetime) -> dict[str, Any]:
    """Answer one day of Google's numbers with the same rules. Returns what it did."""
    moment = now.astimezone(UTC)
    day = str(reading.get("day") or "")
    kinds = {
        k: float(r)
        for k, r in (reading.get("kinds") or {}).items()
        if isinstance(r, int | float) and k in KINDS
    }
    overall = reading.get("spam_rate")
    overall = float(overall) if isinstance(overall, int | float) else None
    cliff = (overall is not None and overall > CLIFF) or any(
        r > CLIFF for k, r in kinds.items() if k not in NEVER_PAUSED
    )
    severity = alerts.CRITICAL if cliff else alerts.WARN
    crossed = sorted(k for k, r in kinds.items() if k not in NEVER_PAUSED and r > PAUSE_AT)
    newly: list[str] = []
    for kind in crossed:
        rate = kinds[kind]
        outcome = _pause(
            kind,
            at=moment,
            reason=COMPLAINT_RATE,
            detail={"source": "postmaster", "rate": rate, "threshold": PAUSE_AT, "day": day},
        )
        if outcome not in (PAUSED, UNWRITTEN):
            continue
        if outcome == PAUSED:
            newly.append(kind)
        raise_alert(
            COMPLAINT_RATE,
            (
                f"Gmail's user-reported spam rate for {kind} on {day} was {percent(rate)} "
                f"percent, over the {percent(PAUSE_AT)} percent line (Postmaster Tools, by "
                "Feedback-ID)."
            ),
            severity=severity,
            kind=kind,
            at=moment,
            action=_paused_action(kind) if outcome == PAUSED else _unwritten_action(kind),
            detail={"rate": rate, "source": "postmaster"},
        )
    raised: list[str] = []
    unattributed = overall is not None and overall > PAUSE_AT and not crossed
    if unattributed and raise_alert(
        GMAIL_SPAM_RATE,
        (
            f"Gmail's user-reported spam rate on {day} was {percent(overall)} percent, over the "
            f"{percent(PAUSE_AT)} percent line, and Postmaster named no Feedback-ID over it. "
            "Nothing was paused: pausing one kind here would be a guess, and pausing all of "
            "them would slow every family down."
        ),
        severity=severity,
        at=moment,
        action="Nothing was paused. The mail desk shows each kind's own numbers.",
    ):
        raised.append(GMAIL_SPAM_RATE)
    auth = reading.get("auth") or {}
    low = [
        (m, float(r))
        for m, r in auth.items()
        if isinstance(r, int | float) and float(r) < AUTH_FLOOR
    ]
    if low:
        words = ", ".join(f"{m.upper()} passed on {percent(r)} percent" for m, r in low)
        if raise_alert(
            AUTHENTICATION,
            (
                f"Postmaster Tools for {reading.get('domain')} on {day}: {words} of Gmail's mail, "
                f"under the {percent(AUTH_FLOOR)} percent floor. Check the DNS records for the "
                "sending domain."
            ),
            severity=alerts.CRITICAL,
            at=moment,
        ):
            raised.append(AUTHENTICATION)
    verdict = reading.get("verdict") or {}
    needs = [str(r) for r in reading.get("needs_work") or []]
    reason = str(verdict.get("reason") or "")
    state = str(verdict.get("state") or "")
    if reason in PROBLEM_VERDICTS or state == "NEEDS_WORK" or needs:
        parts = [
            f"The Postmaster deliverability verdict for {reading.get('domain')} on {day} is "
            f"{reason or 'unstated'} ({state or 'no state'})"
        ]
        if needs:
            parts.append(f"these requirements need work: {', '.join(needs)}")
        if raise_alert(
            REPUTATION,
            "; ".join(parts) + ".",
            severity=alerts.CRITICAL if reason in PROBLEM_VERDICTS else alerts.WARN,
            at=moment,
        ):
            raised.append(REPUTATION)
    return {"paused": sorted(paused()), "newly_paused": newly, "alerts": raised}


__all__ = [
    "ACTOR",
    "ALERT_KIND",
    "ALERT_TO_ENV",
    "AUTHENTICATION",
    "AUTH_FLOOR",
    "CAUSES",
    "CLIFF",
    "COMPLAINT_RATE",
    "COMPLAINT_WATCH",
    "DEFAULT_ALERT_TO",
    "GMAIL_SPAM_RATE",
    "MIN_COMPLAINTS",
    "NEVER_PAUSED",
    "PAUSE_AT",
    "REPUTATION",
    "SEED_IN_SPAM",
    "SEED_MISSING",
    "TRACKING_ON",
    "WATCH_UNREADABLE",
    "WINDOW_DAYS",
    "KindStat",
    "Window",
    "alert_mailed",
    "alert_to",
    "evaluate",
    "evaluate_postmaster",
    "pause",
    "paused",
    "percent",
    "raise_alert",
    "retry_unmailed",
    "scrub",
    "unpause",
    "window",
]
