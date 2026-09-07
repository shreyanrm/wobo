"""What ``/healthz`` actually knows, rather than only that the process answered.

``/healthz`` used to return ``{"status": "ok", "mode": ...}`` unconditionally. A gateway that
could not verify a single token, had no provider key, or had spent its whole day still said
``ok``, and Railway happily kept routing to it. This module is the difference between liveness
(the process is up) and health (the product would work if someone asked it something).

**The four checks, and why each one is here.** Each answers a question of the form "if this is
broken, is the product useless?"; nothing else earns a place, because this endpoint is polled.

``config``     ``ENV`` and ``LLM_MODE`` are values the gateway understands, and in live mode a
               provider key exists. Without one every turn fails at the model.
``auth``       in prod, a token can actually be verified (a JWT secret or a JWKS source). Without
               it every ``/v1`` route answers 401 and the product is a login screen.
``spend``      the day's money ceiling has not shut the door on everyone
               (:mod:`wobo_gateway.spend`).
``providers``  recent live model calls are not all failing (:func:`record_provider`), no
               provider is out of credit (:func:`mark_out_of_credit`), and somebody can carry
               every text tier (:func:`carriers`).

**Per provider, since 2026-09-05.** Every model call in the service goes through
:mod:`wobo_gateway.model_call`, which walks the fallback chain one model at a time and reports
each attempt here: :func:`record_model` for a success or an ordinary failure,
:func:`mark_out_of_credit` when a provider's balance or quota refused. A provider marked out is
skipped without a network call (:func:`provider_available`) until its cool-off passes, at which
point one call is let through to see whether it is back; a second refusal marks it out again.
The raw HTTPS media seams feed the same marks through ``model_call.note_failure``.

**Two kinds of mark, since 2026-09-07.** A credit or quota refusal marks a provider out at once
for :func:`cooloff_s` (five minutes): the account is empty and nothing changes that but money.
Ordinary failures ("weather": a 5xx, a rejected key, a dead route, a timeout) mark it out only in
a STREAK, :func:`weather_streak` of them in a row (three) or :func:`hang_streak` timeouts in a row
(two, because a hang costs its whole share of the deadline), for the shorter
:func:`weather_cooloff_s` (one minute). Until then a single bad minute was weather that marked
nobody, and for a whole 503 storm every turn on every tier paid the dead primary's round trip.
The first success clears any mark and every streak. The operator's snapshot names, per provider,
the last success, the last failure, whether it is out and for which kind, and per tier the model
carrying it right now. The public probe carries only counts.

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
from dataclasses import dataclass
from typing import Any

from wobo_gateway import spend
from wobo_gateway.auth import jwks_url
from wobo_gateway.billing import razorpay
from wobo_gateway.routing import DEFAULT_TABLE, Tier, carrier, provider_of

OK, DEGRADED, FAIL = "ok", "degraded", "fail"
#: The overall words, and the HTTP code each is served with.
HEALTHY, UNHEALTHY = "ok", "unhealthy"

_DEFAULT_WINDOW_S = 120.0
_DEFAULT_STREAK = 5
_MAX_RETAINED = 50
#: How long a provider that refused for credit stays out before one call is let through to see.
_DEFAULT_COOLOFF_S = 300.0
#: Ordinary failures in a row before a provider is marked out for weather, timeouts in a row
#: before the same, and how long that mark lasts. A minute: weather passes; an empty balance does
#: not, which is why the credit cool-off is five.
_DEFAULT_WEATHER_STREAK = 3
_DEFAULT_HANG_STREAK = 2
_DEFAULT_WEATHER_COOLOFF_S = 60.0
#: The two kinds of mark, as the snapshot names them.
CREDIT, WEATHER = "credit", "weather"
#: The text tiers: the ones a learner's answer rides on. Voice and imagery have their own seams.
_TEXT_TIERS = (Tier.TINY, Tier.TURN, Tier.GENERATE, Tier.REASON, Tier.VERIFY)

#: The clock, as a seam. Tests move it to walk a cool-off; nothing else should touch it.
_clock = time.time


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


def cooloff_s() -> float:
    """Seconds a provider stays marked out for credit. ``WOBO_PROVIDER_COOLOFF_S``, default five
    minutes."""
    raw = os.getenv("WOBO_PROVIDER_COOLOFF_S")
    try:
        return max(1.0, float(raw)) if raw else _DEFAULT_COOLOFF_S
    except ValueError:
        return _DEFAULT_COOLOFF_S


def weather_cooloff_s() -> float:
    """Seconds a provider stays marked out for weather. ``WOBO_PROVIDER_WEATHER_COOLOFF_S``,
    default one minute."""
    raw = os.getenv("WOBO_PROVIDER_WEATHER_COOLOFF_S")
    try:
        return max(1.0, float(raw)) if raw else _DEFAULT_WEATHER_COOLOFF_S
    except ValueError:
        return _DEFAULT_WEATHER_COOLOFF_S


def _streak_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        return max(1, int(raw)) if raw else default
    except ValueError:
        return default


def weather_streak() -> int:
    """Ordinary failures in a row that mark a provider out. ``WOBO_PROVIDER_WEATHER_STREAK``,
    default three."""
    return _streak_env("WOBO_PROVIDER_WEATHER_STREAK", _DEFAULT_WEATHER_STREAK)


def hang_streak() -> int:
    """Timeouts in a row that mark a provider out. ``WOBO_PROVIDER_HANG_STREAK``, default two."""
    return _streak_env("WOBO_PROVIDER_HANG_STREAK", _DEFAULT_HANG_STREAK)


# --- what the providers have been doing lately ----------------------------------------------------
# A bounded window, in one process, guarded by one lock, the same shape as every other counter in
# this gateway (``app.py`` rate limiter, ``budget.py``, ``ask_public.AskMeter``). A restart forgets
# it, which is the harmless direction: a freshly started gateway reports healthy until a call
# proves otherwise, and the first failure after a restart puts it back in the window.
_results: deque[tuple[float, bool]] = deque(maxlen=_MAX_RETAINED)
_lock = threading.Lock()


@dataclass
class _ProviderState:
    last_success: float | None = None
    last_failure: float | None = None
    #: Exception TYPE name of the last failure. Never the message: a message can carry a key.
    last_error: str | None = None
    #: Marked out until this moment (``_clock`` seconds). Zero means not marked.
    out_until: float = 0.0
    out_reason: str | None = None
    #: ``CREDIT`` or ``WEATHER`` while marked; None otherwise.
    out_kind: str | None = None
    #: Ordinary failures since the last success, and timeouts since the last non-timeout.
    failures_in_a_row: int = 0
    hangs_in_a_row: int = 0

    def out(self, now: float) -> bool:
        return now < self.out_until

    def clear(self) -> None:
        self.out_until = 0.0
        self.out_reason = None
        self.out_kind = None
        self.failures_in_a_row = 0
        self.hangs_in_a_row = 0


_providers: dict[str, _ProviderState] = {}


def record_provider(ok: bool, *, now: float | None = None) -> None:
    """Remember whether one live model call worked, capability-level. Called from the gateway's
    provider seam (``app.Gateway.invoke``)."""
    with _lock:
        _results.append((now if now is not None else _clock(), bool(ok)))


def _state(provider: str) -> _ProviderState:
    state = _providers.get(provider)
    if state is None:
        state = _providers[provider] = _ProviderState()
    return state


def record_model(
    model_id: str, *, ok: bool, error: str | None = None, timed_out: bool = False
) -> float | None:
    """One attempt at one model, from :mod:`wobo_gateway.model_call` (or, through
    ``model_call.note_failure``, from a raw HTTPS seam). A success clears any mark on the
    provider and every streak: it is answering, whatever it said a minute ago. A failure counts
    toward the weather streak (and the hang streak when it was a timeout), and when a streak is
    reached the provider is marked out for :func:`weather_cooloff_s`. Returns the moment it will
    be re-probed when this call marked it, else ``None``."""
    provider = provider_of(model_id)
    if not provider:
        return None
    now = _clock()
    with _lock:
        state = _state(provider)
        if ok:
            state.last_success = now
            state.clear()
            return None
        state.last_failure = now
        state.last_error = error
        state.failures_in_a_row += 1
        state.hangs_in_a_row = state.hangs_in_a_row + 1 if timed_out else 0
        streak = (
            state.failures_in_a_row >= weather_streak() or state.hangs_in_a_row >= hang_streak()
        )
        if not streak:
            return None
        state.out_until = now + weather_cooloff_s()
        state.out_reason = error
        state.out_kind = WEATHER
        return state.out_until


def mark_out_of_credit(model_id: str, *, reason: str) -> float:
    """The provider behind ``model_id`` refused for credit or quota. Out for :func:`cooloff_s`
    seconds, then one call is let through to see. Returns the moment it will be re-probed."""
    provider = provider_of(model_id)
    now = _clock()
    until = now + cooloff_s()
    if not provider:
        return until
    with _lock:
        state = _state(provider)
        state.last_failure = now
        state.last_error = reason
        state.out_until = until
        state.out_reason = reason
        state.out_kind = CREDIT
    return until


def provider_available(model_id: str) -> bool:
    """Should a call to this model be made right now? False only while its provider is marked
    out; a model with no provider prefix is always tried."""
    provider = provider_of(model_id)
    if not provider:
        return True
    with _lock:
        state = _providers.get(provider)
        return state is None or not state.out(_clock())


def carriers() -> dict[str, str | None]:
    """Per tier, the provider model carrying it right now (``None`` when nobody can)."""
    out: dict[str, str | None] = {}
    for tier in DEFAULT_TABLE:
        spec = carrier(tier, available=provider_available)
        out[tier.value] = spec.provider_model if spec is not None else None
    return out


def reset() -> None:
    """Test seam: forget what the providers have been doing."""
    with _lock:
        _results.clear()
        _providers.clear()


def _provider_check(now: float, *, public: bool = False) -> tuple[str, dict[str, Any]]:
    floor = now - _window_s()
    with _lock:
        recent = [ok for stamp, ok in _results if stamp >= floor]
        by_provider = {
            name: {
                "last_success": state.last_success,
                "last_failure": state.last_failure,
                "last_error": state.last_error,
                "out": state.out(now),
                "out_kind": state.out_kind if state.out(now) else None,
                "out_of_credit": state.out(now) and state.out_kind == CREDIT,
                "out_until": state.out_until if state.out(now) else None,
                "reason": state.out_reason if state.out(now) else None,
            }
            for name, state in sorted(_providers.items())
        }
    failures = sum(1 for ok in recent if not ok)
    streak = 0
    for ok in reversed(recent):
        if ok:
            break
        streak += 1
    out = [name for name, row in by_provider.items() if row["out"]]
    no_credit = [name for name, row in by_provider.items() if row["out_of_credit"]]
    carrying = carriers()
    detail: dict[str, Any] = {
        "calls": len(recent),
        "failures": failures,
        "consecutive_failures": streak,
        # COUNTS on the open probe (the white-label law: nothing a client can see names a vendor);
        # the names, the timestamps and the carrier per tier go to the operator's snapshot.
        "out": len(out),
        "out_of_credit": len(no_credit),
    }
    if not public:
        detail["by_provider"] = by_provider
        detail["carrying"] = carrying
    if streak >= _streak():
        return FAIL, detail
    if any(carrying[tier.value] is None for tier in _TEXT_TIERS):
        # A learner's answer rides on the text tiers. Voice and imagery have their own seams and
        # the device's own voice behind them, so an empty media chain degrades rather than fails.
        return FAIL, {**detail, "reason": "every provider on a text tier is marked out"}
    if out:
        return DEGRADED, {
            **detail,
            "reason": (
                f"{len(out)} provider(s) marked out ({len(no_credit)} for credit or quota, "
                f"{len(out) - len(no_credit)} for weather); the chain is carrying"
            ),
        }
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
#: whole operator console exists to protect (what has been spent today, what the ceiling is, how
#: close the two are, and how much traffic there was) so they go to ``/v1/admin/health``, behind
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


def _payments_check() -> tuple[str, dict[str, Any]]:
    """Payments on or off (the three RAZORPAY_* keys present, by presence only), and when the
    provider last spoke to us. Off is not an outage: the free plan serves. Off IN PROD is a thing
    a person should read, because every checkout is answering 503 and the cancel of a
    provider-backed row is refused."""
    on = razorpay.configured()
    last = razorpay.last_webhook()
    detail: dict[str, Any] = {
        "payments": "on" if on else "off",
        "last_webhook_at": last.isoformat() if last else None,
    }
    if not on and os.getenv("ENV", "dev").lower() == "prod":
        return DEGRADED, {**detail, "reason": "no payment keys, so checkout answers 503"}
    return OK, detail


_WORST = {OK: 0, DEGRADED: 1, FAIL: 2}


def snapshot(now: float | None = None, *, public: bool = False) -> dict[str, Any]:
    """The whole picture. No network, no model, no database.

    ``public=True`` is what ``/healthz`` serves, and it is a SMALLER answer on purpose. ``/healthz``
    is in the app's unauthenticated allowlist, so anybody on the internet can read whatever it
    returns, and it used to return ``spend.state()`` verbatim: the day's model spend, the daily
    ceiling, the fraction between them and the call volume. That is precisely the set of figures
    the console guards behind a register, a TOTP factor, a thirty-minute revocable session and an
    audit row per look, published to strangers by a liveness probe. A monitor needs the status
    word and the reason; the money, and the names of the providers, belong to
    ``GET /v1/admin/health``, which serves the full snapshot to an operator and writes down that
    they looked.
    """
    moment = now if now is not None else _clock()
    checks: dict[str, dict[str, Any]] = {}
    for name, (status, detail) in {
        "config": _config_check(),
        "auth": _auth_check(),
        "spend": _spend_check(public=public),
        "providers": _provider_check(moment, public=public),
        "payments": _payments_check(),
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
    "CREDIT",
    "DEGRADED",
    "FAIL",
    "HEALTHY",
    "OK",
    "UNHEALTHY",
    "WEATHER",
    "carriers",
    "cooloff_s",
    "hang_streak",
    "mark_out_of_credit",
    "provider_available",
    "record_model",
    "record_provider",
    "reset",
    "snapshot",
    "status_code",
    "weather_cooloff_s",
    "weather_streak",
]
