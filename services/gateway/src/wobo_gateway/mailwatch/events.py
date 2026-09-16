"""The mail provider's delivery events, heard on a signed route: ``POST /v1/mail/events``.

THE DOOR IS THE SIGNATURE. The provider signs every event the Svix way (docs.svix.com, "verifying
payloads"): HMAC-SHA256, keyed with the base64 after ``whsec_`` in the endpoint's signing secret,
over ``<svix-id>.<svix-timestamp>.<raw body>``, sent as one or more space-separated ``v1,<base64>``
in ``svix-signature``. Checked over the RAW bytes before a byte is parsed, in constant time,
with the timestamp inside :data:`TOLERANCE_S` either way so a captured delivery cannot be
replayed tomorrow. Anything else is a 401. With :data:`SECRET_ENV` unset the route answers 503 to
everybody: a door with no lock is a shut door, never an open one. It is open to the world (the
provider holds no learner token) and not rate limited (the provider retries a refusal, and the
signature costs one HMAC), exactly as the payments webhook is.

WHAT AN EVENT DOES:

* ``email.complained``: the address is suppressed at once for every non-transactional kind, and
  the complaint rates are read again (:func:`.respond.evaluate`).
* ``email.bounced``: a ``Permanent`` bounce suppresses the address the same way; any other bounce
  is counted and stops nothing. A bounce whose message names SPF, DKIM, DMARC or an
  authentication refusal (5.7.23 to 5.7.27, 5.7.515) is also an alert.
* ``email.suppressed``: the provider will not deliver to this address (it holds its own list of
  hard bounces and complaints), so neither do we.
* ``email.delivered``, ``email.delivery_delayed``, ``email.failed``: counted.
* ``email.opened``, ``email.clicked``: never counted. The law keeps the provider's tracking off,
  so one arriving at all means somebody switched it on, and that is an alert.

Every event is kept once (the signed ``svix-id`` is its key) and counted per day and per kind.
The kind is the ``kind`` tag the send carried (``email.send_email``), else the first field of the
message's ``Feedback-ID``, else the kind our own send log recorded against the provider's id.

NEVER AN ADDRESS: the recipient is kept as the mail log's digest, and nothing else of the
message (subject, sender, body) is kept at all.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
import re
import threading
from collections.abc import Callable, Mapping
from datetime import UTC, date, datetime, time
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from wobo_gateway import alerts
from wobo_gateway.email import mail_log, to_hash
from wobo_gateway.email_templates import KINDS
from wobo_gateway.mailwatch import respond, store

logger = logging.getLogger("wobo.gateway.mailwatch")

SECRET_ENV = "RESEND_WEBHOOK_SECRET"
EVENTS_PATH = "/v1/mail/events"
#: The provider holds no learner token. The signature is the door.
OPEN_PATHS = frozenset({EVENTS_PATH})
#: Five minutes either way, the tolerance Svix's own libraries use.
TOLERANCE_S = 300

#: The provider's event names and the word each is counted under.
COUNTED: dict[str, str] = {
    "email.delivered": "delivered",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.delivery_delayed": "delayed",
    "email.suppressed": "suppressed",
    "email.failed": "failed",
}
#: Events that exist only when the provider's tracking is on, which the law forbids.
TRACKING: frozenset[str] = frozenset({"email.opened", "email.clicked"})

_ID = re.compile(r"^[A-Za-z0-9_.:\-]{1,128}$")
_AUTH_WORDS = re.compile(
    r"\b(spf|dkim|dmarc|unauthenticated|5\.7\.2[3-7]|5\.7\.515)\b", re.IGNORECASE
)

_clock: Callable[[], datetime] | None = None
_last: datetime | None = None
_last_lock = threading.Lock()


def set_clock(clock: Callable[[], datetime] | None) -> None:
    """Test seam: the moment the route judges a signature's age against."""
    global _clock
    _clock = clock


def now() -> datetime:
    return (_clock() if _clock else datetime.now(UTC)).astimezone(UTC)


def reset() -> None:
    """Test seam: forget when the last event arrived."""
    global _last
    with _last_lock:
        _last = None


def note_received(moment: datetime) -> None:
    global _last
    with _last_lock:
        _last = moment


def last_received() -> datetime | None:
    """When a signed event last arrived at this instance, or the newest one the store holds."""
    with _last_lock:
        seen = _last
    if seen is not None:
        return seen
    rows = store.get_store().rows(store.DELIVERY)
    return rows[-1].at if rows else None


def configured() -> bool:
    return bool((os.getenv(SECRET_ENV) or "").strip())


# --- the signature --------------------------------------------------------------------------------
def verify(body: bytes, headers: Mapping[str, str], secret: str, *, now: datetime) -> str | None:
    """The signed message id when ``body`` carries a valid, fresh signature under ``secret``;
    ``None`` for anything else. Never raises."""
    lowered = {str(k).lower(): str(v) for k, v in headers.items()}
    msg_id = lowered.get("svix-id") or lowered.get("webhook-id") or ""
    stamp = lowered.get("svix-timestamp") or lowered.get("webhook-timestamp") or ""
    signatures = lowered.get("svix-signature") or lowered.get("webhook-signature") or ""
    secret = secret.strip()
    if not (msg_id and stamp and signatures) or not _ID.match(msg_id):
        return None
    if not secret.startswith("whsec_"):
        return None
    try:
        key = base64.b64decode(secret.removeprefix("whsec_"), validate=True)
        sent_at = int(stamp)
    except (binascii.Error, ValueError):
        return None
    if not key or abs(now.timestamp() - sent_at) > TOLERANCE_S:
        return None
    expected = base64.b64encode(
        hmac.new(key, f"{msg_id}.{stamp}.".encode() + body, hashlib.sha256).digest()
    )
    for part in signatures.split():
        version, _, value = part.partition(",")
        if version == "v1" and hmac.compare_digest(value.encode("utf-8", "ignore"), expected):
            return msg_id
    return None


# --- what an event says ---------------------------------------------------------------------------
def _named(value: Any) -> str:
    return value.strip().replace("-", "_") if isinstance(value, str) else ""


def kind_of(data: Mapping[str, Any]) -> str:
    """Which of our kinds this event is about, or ``"unknown"``. Only a name we send is trusted."""
    tags = data.get("tags")
    tag: Any = None
    if isinstance(tags, Mapping):
        tag = tags.get("kind")
    elif isinstance(tags, list):
        tag = next(
            (t.get("value") for t in tags if isinstance(t, Mapping) and t.get("name") == "kind"),
            None,
        )
    if _named(tag) in KINDS:
        return _named(tag)

    headers = data.get("headers")
    feedback: Any = None
    if isinstance(headers, list):
        feedback = next(
            (
                h.get("value")
                for h in headers
                if isinstance(h, Mapping) and str(h.get("name", "")).lower() == "feedback-id"
            ),
            None,
        )
    elif isinstance(headers, Mapping):
        feedback = next((v for k, v in headers.items() if str(k).lower() == "feedback-id"), None)
    if isinstance(feedback, str) and _named(feedback.split(":", 1)[0]) in KINDS:
        return _named(feedback.split(":", 1)[0])

    email_id = data.get("email_id")
    if isinstance(email_id, str) and email_id:
        for record in mail_log().records():
            if record.provider_id == email_id and record.kind in KINDS:
                return record.kind
    return "unknown"


def _when(*values: Any) -> datetime | None:
    for value in values:
        found = store._when(value) if value else None
        if found is not None:
            return found.astimezone(UTC)
    return None


def _recipients(data: Mapping[str, Any]) -> list[str]:
    raw = data.get("to")
    listed = raw if isinstance(raw, list) else [raw]
    return [to_hash(a) for a in listed if isinstance(a, str) and "@" in a]


def take(payload: Any, *, event_id: str, now: datetime) -> dict[str, Any]:
    """Apply one verified event. Idempotent on ``event_id``. Never raises."""
    if not isinstance(payload, Mapping):
        return {"outcome": "not_an_event"}
    name = payload.get("type")
    data = payload.get("data")
    if not isinstance(name, str) or not isinstance(data, Mapping):
        return {"outcome": "not_an_event"}
    moment = now.astimezone(UTC)
    note_received(moment)

    if name in TRACKING:
        respond.raise_alert(
            respond.TRACKING_ON,
            (
                f"The mail provider sent an {name.split('.', 1)[1]} event, so its open or click "
                "tracking is switched on. The mail law keeps both off, because a tracking pixel "
                "or a rewritten link has no place in a child's mail: switch them off in the "
                "provider's domain settings."
            ),
            severity=alerts.CRITICAL,
            at=moment,
            action="Nothing was counted from it.",
        )
        return {"outcome": "tracking_on"}

    short = COUNTED.get(name)
    if short is None:
        return {"outcome": "ignored"}

    at = _when(payload.get("created_at"), data.get("created_at")) or moment
    kind = kind_of(data)
    recipients = _recipients(data)
    detail: dict[str, Any] = {"email_id": str(data.get("email_id") or "")[:64]}
    # When the MAIL went, which is what a lifted pause is judged on (respond.window): a complaint
    # that arrives after the owner lifts a pause, about a note sent before it, is the old week.
    mailed = _when(data.get("created_at"))
    if mailed is not None:
        detail["sent_at"] = mailed.isoformat()
    hard = False
    bounce = data.get("bounce") if isinstance(data.get("bounce"), Mapping) else {}
    if short == "bounced":
        hard = str(bounce.get("type") or "").strip().lower() == "permanent"
        detail["bounce"] = "hard" if hard else "soft"
        detail["sub_type"] = respond.scrub(str(bounce.get("subType") or "")[:64])
    if short == "suppressed":
        told = data.get("suppressed") if isinstance(data.get("suppressed"), Mapping) else {}
        detail["sub_type"] = respond.scrub(str(told.get("type") or "")[:64])

    watch = store.get_store()
    row = store.WatchRow(
        what=store.DELIVERY,
        key=f"{store.DELIVERY}:{event_id}",
        at=at,
        kind=kind,
        event=short,
        to_hash=recipients[0] if recipients else "",
        detail=detail,
    )
    if not watch.add(row):
        return {"outcome": "already_taken"}

    reason = {"complained": "complained", "suppressed": "provider_suppressed"}.get(short)
    if hard:
        reason = "hard_bounce"
    if reason:
        for digest in recipients:
            watch.suppress(digest, reason=reason, kind=kind, at=at)

    try:
        # The server's own words name the recipient more often than not; they are scrubbed
        # before anything keeps, pages or mails them (2026-09-16).
        message = respond.scrub(str(bounce.get("message") or ""))
        if short == "bounced" and _AUTH_WORDS.search(message):
            respond.raise_alert(
                respond.AUTHENTICATION,
                (f"A receiving server refused a {kind} mail for authentication: {message[:200]}"),
                severity=alerts.CRITICAL,
                kind=kind if kind != "unknown" else "",
                at=moment,
                action="The address was suppressed if the bounce was permanent.",
            )
        if short == "complained" or hard:
            respond.evaluate(moment)
    except Exception as exc:  # noqa: BLE001 — the event is kept; the answer to it runs again hourly
        logger.warning(
            "mail watch: an event was kept but not answered",
            extra={"fields": {"event": short, "error": type(exc).__name__}},
        )
    return {"outcome": "taken", "event": short, "kind": kind}


def daily_counts(*, since: date) -> list[dict[str, Any]]:
    """Events per UTC day, per kind, per event, from ``since``: what the mail desk tabulates."""
    floor = datetime.combine(since, time.min, tzinfo=UTC)
    counts: dict[tuple[str, str, str], int] = {}
    for row in store.get_store().rows(store.DELIVERY, since=floor):
        key = (row.at.astimezone(UTC).date().isoformat(), row.kind, row.event)
        counts[key] = counts.get(key, 0) + 1
    return [
        {"day": day, "kind": kind, "event": event, "count": n}
        for (day, kind, event), n in sorted(counts.items())
    ]


# --- the route ------------------------------------------------------------------------------------
def register_mail_events(app: FastAPI) -> None:
    @app.post(EVENTS_PATH, include_in_schema=False)
    async def mail_events(request: Request) -> JSONResponse:
        """Signature first, once-only second, the answer third. Nothing before the signature."""
        raw = await request.body()
        secret = (os.getenv(SECRET_ENV) or "").strip()
        if not secret:
            logger.error("mail events received with no %s set; refused", SECRET_ENV)
            return JSONResponse(status_code=503, content={"code": "not_configured"})
        moment = now()
        event_id = verify(raw, request.headers, secret, now=moment)
        if event_id is None:
            logger.warning(
                "mail events refused: bad or missing signature",
                extra={"fields": {"bytes": len(raw)}},
            )
            return JSONResponse(status_code=401, content={"code": "bad_signature"})
        try:
            payload = json.loads(raw)
        except ValueError:
            return JSONResponse(status_code=400, content={"code": "bad_payload"})
        # The writes, the suppression and any alert mail are blocking I/O: off the event loop, so
        # a slow database round trip holds this event and not every other request (2026-09-16).
        outcome = await run_in_threadpool(take, payload, event_id=event_id, now=moment)
        if outcome["outcome"] == "not_an_event":
            return JSONResponse(status_code=400, content={"code": "bad_payload"})
        return JSONResponse(status_code=200, content={"outcome": outcome["outcome"]})


__all__ = [
    "COUNTED",
    "EVENTS_PATH",
    "OPEN_PATHS",
    "SECRET_ENV",
    "TOLERANCE_S",
    "TRACKING",
    "configured",
    "daily_counts",
    "kind_of",
    "last_received",
    "note_received",
    "register_mail_events",
    "reset",
    "set_clock",
    "take",
    "verify",
]
