"""The alarm. One greppable line for anything worth waking someone, and one webhook sink.

Until this module existed, the only automated response to a crash was Railway restarting the
container silently ten times and then stopping. Nothing told the owner. This is the code half
of that hole; the human half (a free uptime monitor pointed at ``/healthz``) is written down in
``docs/OPERATIONS.md`` and only the owner can do it.

**The line.** Every alert writes exactly one JSON log record on the ``wobo.gateway.alert``
logger, whose message is ``ALERT <event>`` and whose fields always carry ``alert``, ``severity``
and ``event_at``. Two ways to find them in a log drain that has no query language::

    grep '"alert":'                 # every alert, machine-readable
    grep 'ALERT '                   # every alert, by eye

The log line is written EVERY time. It is free, and a rate-limited log is a log that lies.

**The sink.** ``ALERT_WEBHOOK_URL`` is one environment variable and nothing else. Unset, this
module is a logger and no more. Set to a Slack incoming webhook, a Discord webhook, an ntfy
topic or any URL that accepts a JSON POST, the owner is told on his phone within seconds. The
body carries ``text`` (Slack), ``content`` (Discord) and the structured ``fields``, so one URL
works for all three without configuration. No new dependency: :mod:`urllib.request` posts it.

**The cost of noise.** Pages are rate-limited per event name (``ALERT_COOLDOWN_SECONDS``,
default 300) so a thousand 5xx in a minute is one page, not a thousand. The logs still carry
all thousand. An event whose page is suppressed says so in its own log line
(``suppressed: true``), so nobody later concludes the page was never raised.

**Never in the way of a learner.** ``alert`` cannot raise, and by default it posts on a daemon
thread, so a slow webhook never adds a millisecond to a turn. :func:`set_runner` is the test
seam that makes it inline, and :func:`set_sender` replaces the transport entirely.

**One process.** The cooldown map is an in-process dict, like every other limiter in this
gateway (``app.py`` rate limiter, ``budget.py`` meter, ``ask_public.AskMeter``). With
``railway.json`` pinned to ``numReplicas: 1`` that is the whole platform. On two replicas each
would keep its own cooldown, so a burst could page twice per window. That is the harmless
direction for an alarm to fail, which is why this one is left in process while the spend
ceiling writes its multi-replica consequence down in bolder letters.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("wobo.gateway.alert")

# --- the events worth waking someone for ---------------------------------------------------------
#: The service came up. Cheap, and the only way to see a restart loop in a log drain: ten of
#: these in five minutes IS the Railway restart policy giving up in slow motion.
STARTUP = "startup"
#: A request answered 5xx, or a route raised and nothing caught it.
SERVER_ERROR = "server_error"
#: The child-safety gate stopped something, inbound or outbound. Not an outage; a thing a human
#: should read, because a real crisis hides in this stream.
SAFETY_GATE = "safety_gate"
#: The day's spend crossed a threshold (:mod:`wobo_gateway.spend`).
SPEND_THRESHOLD = "spend_threshold"
#: More failed authentications in one minute than a fumbled password explains.
AUTH_FAILURE_BURST = "auth_failure_burst"
#: A model provider refused or timed out. One is weather; :mod:`wobo_gateway.health` decides
#: when a run of them is an outage.
PROVIDER_OUTAGE = "provider_outage"

EVENTS = frozenset(
    {STARTUP, SERVER_ERROR, SAFETY_GATE, SPEND_THRESHOLD, AUTH_FAILURE_BURST, PROVIDER_OUTAGE}
)

INFO, WARN, CRITICAL = "info", "warn", "critical"
_LEVEL = {INFO: logging.INFO, WARN: logging.WARNING, CRITICAL: logging.ERROR}

_DEFAULT_COOLDOWN_S = 300
_DEFAULT_TIMEOUT_S = 5.0


def webhook_url() -> str | None:
    """The sink, or ``None``. Read every time so a restart is the only thing needed to add one."""
    return (os.getenv("ALERT_WEBHOOK_URL") or "").strip() or None


def _cooldown_s() -> float:
    raw = os.getenv("ALERT_COOLDOWN_SECONDS")
    if raw is None:
        return float(_DEFAULT_COOLDOWN_S)
    try:
        return max(0.0, float(raw))
    except ValueError:
        return float(_DEFAULT_COOLDOWN_S)


def _timeout_s() -> float:
    raw = os.getenv("ALERT_WEBHOOK_TIMEOUT_SECONDS")
    if raw is None:
        return _DEFAULT_TIMEOUT_S
    try:
        return max(0.5, float(raw))
    except ValueError:
        return _DEFAULT_TIMEOUT_S


# --- the seams -----------------------------------------------------------------------------------
def _post(url: str, payload: dict[str, Any]) -> None:
    """POST one JSON body. Stdlib only, short timeout, and never raises past its caller."""
    import urllib.request

    body = json.dumps(payload, default=str).encode()
    request = urllib.request.Request(  # noqa: S310 — the URL is the owner's own configuration
        url,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "wobo-gateway-alerts"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=_timeout_s()) as response:  # noqa: S310
        response.read(1)


_sender: Callable[[str, dict[str, Any]], None] = _post
_runner: Callable[[Callable[[], None]], None] = lambda go: threading.Thread(  # noqa: E731
    target=go, daemon=True, name="wobo-alert"
).start()


def set_sender(sender: Callable[[str, dict[str, Any]], None] | None) -> None:
    """Test seam: replace the transport. ``None`` restores the real HTTP POST."""
    global _sender
    _sender = sender or _post


def set_runner(runner: Callable[[Callable[[], None]], None] | None) -> None:
    """Test seam: run the send inline. ``None`` restores the daemon thread."""
    global _runner
    _runner = runner or (
        lambda go: threading.Thread(target=go, daemon=True, name="wobo-alert").start()
    )


# --- the cooldown --------------------------------------------------------------------------------
_last_paged: dict[str, float] = {}
_lock = threading.Lock()


def _may_page(event: str, now: float) -> bool:
    """One page per event per cooldown. Check and stamp are one operation under the lock."""
    cooldown = _cooldown_s()
    with _lock:
        last = _last_paged.get(event)
        if last is not None and now - last < cooldown:
            return False
        _last_paged[event] = now
        return True


def reset() -> None:
    """Test seam — forget every cooldown and restore the real transport."""
    with _lock:
        _last_paged.clear()
    set_sender(None)
    set_runner(None)


# --- the alarm -----------------------------------------------------------------------------------
def alert(event: str, message: str, *, severity: str = WARN, **fields: Any) -> dict[str, Any]:
    """Raise one alert: always a log line, and a page when the sink is set and not cooling down.

    Returns the fields it wrote, which is what the tests assert on. Never raises: an alarm that
    can break a learner's turn is worse than no alarm.
    """
    now = time.time()
    record: dict[str, Any] = {
        "alert": event,
        "severity": severity if severity in _LEVEL else WARN,
        "event_at": datetime.fromtimestamp(now, UTC).isoformat(timespec="milliseconds"),
        **fields,
    }
    url = webhook_url()
    paged = bool(url) and _may_page(event, now)
    if url and not paged:
        record["suppressed"] = True
    logger.log(_LEVEL[record["severity"]], "ALERT %s", event, extra={"fields": record})
    if url and paged:
        payload = {
            # Slack reads "text", Discord reads "content", everything else reads the body. One
            # shape, three services, no configuration.
            "text": f"[{record['severity']}] {event}: {message}",
            "content": f"[{record['severity']}] {event}: {message}",
            "event": event,
            "severity": record["severity"],
            "message": message,
            "fields": record,
        }

        def _go() -> None:
            try:
                _sender(url, payload)
            except Exception:  # noqa: BLE001 — a sink that is down must not become an outage
                logger.warning(
                    "alert webhook failed", extra={"fields": {"alert": event, "sink": "webhook"}}
                )

        try:
            _runner(_go)
        except Exception:  # noqa: BLE001 — nor may the runner
            logger.warning(
                "alert dispatch failed", extra={"fields": {"alert": event, "sink": "webhook"}}
            )
    return record


__all__ = [
    "AUTH_FAILURE_BURST",
    "CRITICAL",
    "EVENTS",
    "INFO",
    "PROVIDER_OUTAGE",
    "SAFETY_GATE",
    "SERVER_ERROR",
    "SPEND_THRESHOLD",
    "STARTUP",
    "WARN",
    "alert",
    "reset",
    "set_runner",
    "set_sender",
    "webhook_url",
]
