"""What ``/healthz`` actually knows, rather than only that the process answered.

``/healthz`` used to return ``{"status": "ok", "mode": ...}`` unconditionally. A gateway that
could not verify a single token, had no provider key, or had spent its whole day still said
``ok``, and Railway happily kept routing to it. This module is the difference between liveness
(the process is up) and health (the product would work if someone asked it something).

**The four checks, and why each one is here.** Each answers a question of the form "if this is
broken, is the product useless?" — nothing else earns a place, because this endpoint is polled.

``config``     ``ENV`` and ``LLM_MODE`` are values the gateway understands, and in live mode the
               primary provider key exists. Without it every turn fails at the model.
``auth``       in prod, a token can actually be verified (a JWT secret or a JWKS source). Without
               it every ``/v1`` route answers 401 and the product is a login screen.
``spend``      the day's money ceiling has not shut the door on everyone
               (:mod:`wobo_gateway.spend`).
``providers``  recent live model calls are not all failing (:func:`record_provider`).

**Cheap enough to poll.** Every check is a dictionary or environment read. Nothing here opens a
socket, calls Supabase or touches a model: a health endpoint that makes a network call is a
health endpoint that invents its own outages, and an uptime monitor hitting it every minute
would be paying for a database round trip a minute for the privilege.

**What the status codes mean**, because an uptime monitor only reads the code:

``200 ok``         everything the gateway can see is fine.
``200 degraded``   the product still answers, but something is wrong that a person should read.
                   Deliberately NOT a failure code: a degraded gateway that Railway restarts is
                   worse than a degraded gateway that keeps serving.
``503 unhealthy``  a request arriving now would not be served. Page.

``docs/OPERATIONS.md`` says what to do about each.
"""

from __future__ import annotations

import os
import threading
import time
from collections import deque
from typing import Any

from wobo_gateway import spend
from wobo_gateway.auth import jwks_url

OK, DEGRADED, FAIL = "ok", "degraded", "fail"
#: The overall words, and the HTTP code each is served with.
HEALTHY, UNHEALTHY = "ok", "unhealthy"

_DEFAULT_WINDOW_S = 120.0
_DEFAULT_STREAK = 5
_MAX_RETAINED = 50


def _window_s() -> float:
    raw = os.getenv("PROVIDER_HEALTH_WINDOW_SECONDS")
    try:
        return max(5.0, float(raw)) if raw else _DEFAULT_WINDOW_S
    except ValueError:
        return _DEFAULT_WINDOW_S


def _streak() -> int:
    raw = os.getenv("PROVIDER_OUTAGE_STREAK")
    try:
        return max(1, int(raw)) if raw else _DEFAULT_STREAK
    except ValueError:
        return _DEFAULT_STREAK


# --- what the providers have been doing lately ----------------------------------------------------
# A bounded window, in one process, guarded by one lock — the same shape as every other counter
# in this gateway (``app.py`` rate limiter, ``budget.py``, ``ask_public.AskMeter``). A restart
# forgets it, which is the harmless direction: a freshly started gateway reports healthy until a
# call proves otherwise, and the first failure after a restart puts it back in the window.
_results: deque[tuple[float, bool]] = deque(maxlen=_MAX_RETAINED)
_lock = threading.Lock()


def record_provider(ok: bool, *, now: float | None = None) -> None:
    """Remember whether one live model call worked. Called from the gateway's provider seam."""
    with _lock:
        _results.append((now if now is not None else time.time(), bool(ok)))


def reset() -> None:
    """Test seam — forget what the providers have been doing."""
    with _lock:
        _results.clear()


def _provider_check(now: float) -> tuple[str, dict[str, Any]]:
    floor = now - _window_s()
    with _lock:
        recent = [ok for stamp, ok in _results if stamp >= floor]
    failures = sum(1 for ok in recent if not ok)
    streak = 0
    for ok in reversed(recent):
        if ok:
            break
        streak += 1
    detail = {"calls": len(recent), "failures": failures, "consecutive_failures": streak}
    if streak >= _streak():
        return FAIL, detail
    if failures >= 2:
        return DEGRADED, detail
    return OK, detail


def _config_check() -> tuple[str, dict[str, Any]]:
    env = os.getenv("ENV", "dev").lower()
    mode = os.getenv("LLM_MODE", "mock").lower()
    detail: dict[str, Any] = {"env": env, "mode": mode}
    if env not in {"dev", "stg", "prod"} or mode not in {"mock", "live"}:
        return FAIL, {**detail, "reason": "ENV or LLM_MODE is not a value the gateway knows"}
    if mode != "live":
        return OK, detail
    # How many model providers are configured, COUNTED and never named. This endpoint is open and
    # unauthenticated, and the white-label law (WOBO-PLAN §17) says no provider or model name may
    # appear in anything a client can see. A count answers "is a fallback missing" without telling
    # a stranger who is underneath; WHICH key is missing is already named in the boot log, where
    # only the owner reads it (`validate_env`).
    present = [
        bool(os.getenv("ANTHROPIC_API_KEY")),
        bool(os.getenv("OPENAI_API_KEY")),
        bool(os.getenv("GOOGLE_AI_API_KEY") or os.getenv("GEMINI_API_KEY")),
    ]
    detail["providers_configured"] = sum(present)
    detail["providers_expected"] = len(present)
    if not any(present):
        return FAIL, {**detail, "reason": "no model provider key is configured"}
    if not all(present):
        # Every tier's chain crosses providers (routing.py); a missing key means the chain is
        # shorter than it was designed to be, which is a thing to fix, not an outage.
        return DEGRADED, {**detail, "reason": "a provider key is missing, so a fallback is gone"}
    return OK, detail


def _auth_check() -> tuple[str, dict[str, Any]]:
    env = os.getenv("ENV", "dev").lower()
    verifiable = bool(os.getenv("SUPABASE_JWT_SECRET") or jwks_url())
    detail = {"verifiable": verifiable}
    if env == "prod" and not verifiable:
        return FAIL, {**detail, "reason": "no way to verify a learner token"}
    return OK, detail


#: The fields ``_spend_check`` reports that are the platform's own money. They are the figures the
#: whole operator console exists to protect — what has been spent today, what the ceiling is, how
#: close the two are, and how much traffic there was — so they go to ``/v1/admin/health``, behind
#: the register and the second factor, and NEVER to the open probe. A liveness check needs the
#: status word; it does not need the day's takings.
_MONEY_FIELDS: tuple[str, ...] = ("spent_usd", "ceiling_usd", "fraction", "calls")


def _spend_check(*, public: bool = False) -> tuple[str, dict[str, Any]]:
    ledger = spend.state()
    detail = dict(ledger.as_dict())
    if public:
        detail = {k: v for k, v in detail.items() if k not in _MONEY_FIELDS}
    if ledger.ceiling_usd <= 0:
        return DEGRADED, {**detail, "reason": "no daily spend ceiling is configured"}
    # The paid lane is the last one shed. Past its refuse line nobody at all is served, which
    # is an outage whatever the process is doing.
    if spend.verdict(spend.Priority.PAID) is spend.Verdict.REFUSE:
        return FAIL, {**detail, "reason": "the day's spend ceiling is refusing every caller"}
    if spend.verdict(spend.Priority.MEMBER) is not spend.Verdict.SERVE:
        return DEGRADED, {**detail, "reason": "the day's spend ceiling is shedding load"}
    return OK, detail


_WORST = {OK: 0, DEGRADED: 1, FAIL: 2}


def snapshot(now: float | None = None, *, public: bool = False) -> dict[str, Any]:
    """The whole picture. No network, no model, no database.

    ``public=True`` is what ``/healthz`` serves, and it is a SMALLER answer on purpose. ``/healthz``
    is in the app's unauthenticated allowlist, so anybody on the internet can read whatever it
    returns — and it used to return ``spend.state()`` verbatim: the day's model spend, the daily
    ceiling, the fraction between them and the call volume. That is precisely the set of figures
    the console guards behind a register, a TOTP factor, a thirty-minute revocable session and an
    audit row per look, published to strangers by a liveness probe. A monitor needs the status
    word and the reason; the money belongs to ``GET /v1/admin/health``, which serves the full
    snapshot to an operator and writes down that they looked.
    """
    moment = now if now is not None else time.time()
    checks: dict[str, dict[str, Any]] = {}
    for name, (status, detail) in {
        "config": _config_check(),
        "auth": _auth_check(),
        "spend": _spend_check(public=public),
        "providers": _provider_check(moment),
    }.items():
        checks[name] = {"status": status, **detail}
    worst = max((_WORST[c["status"]] for c in checks.values()), default=0)
    overall = HEALTHY if worst == 0 else (DEGRADED if worst == 1 else UNHEALTHY)
    return {
        "status": overall,
        "mode": os.getenv("LLM_MODE", "mock").lower(),
        # What is actually running, so a 2am answer to "is this the code I deployed?" exists.
        # Honest when unset: "unknown" is the truth until the image bakes a SHA in.
        "version": os.getenv("GIT_SHA") or os.getenv("RAILWAY_GIT_COMMIT_SHA") or "unknown",
        "checks": checks,
    }


def status_code(snap: dict[str, Any]) -> int:
    """``503`` only when a request arriving now would not be served."""
    return 503 if snap.get("status") == UNHEALTHY else 200


__all__ = [
    "DEGRADED",
    "FAIL",
    "HEALTHY",
    "OK",
    "UNHEALTHY",
    "record_provider",
    "reset",
    "snapshot",
    "status_code",
]
