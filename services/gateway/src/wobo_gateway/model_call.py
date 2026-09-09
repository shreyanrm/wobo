"""One place that talks to a model, and the one place that walks a fallback chain.

**Why the chain is walked here and not by litellm.** ``litellm.completion(fallbacks=[...])`` tries
each model in turn, swallows every rung's error, and when the last one fails raises a bare
``Exception("<last error>. All fallback attempts failed")``. So the gateway could never see WHICH
provider refused or WHY: on 2026-09-04 a fallback's "Unsupported value: 'temperature'" was hidden
behind the primary's billing error; on 2026-09-05 every Claude call was refused with "credit
balance is too low" and the only evidence was a Gemini authentication line from the far end of
the chain. Two workarounds grew here (a blind retry without the sampling knobs, and a rule about
what a chain's last error can be trusted to say) and both were guesses about a failure we were
not allowed to look at.

So this module makes one ``litellm.completion`` call per model, in chain order, and looks at each
answer itself:

* **a credit or quota refusal marks the provider out** (:func:`health.mark_out_of_credit`) and
  the chain moves on; the next call on any tier skips that provider without a network round
  trip until its cool-off passes, which is the difference between "well under a second" and a
  timeout per turn while an account is empty;
* **an ordinary failure** (a 5xx, a rejected key, a connection fault, a timeout) moves the chain
  on and is written down (:func:`health.record_model`). One is weather. A STREAK is not: three
  ordinary failures in a row, or two timeouts in a row, mark the provider out for a short
  cool-off, because until 2026-09-07 a 503 storm or a revoked key cost every turn on every tier
  the dead primary's round trip for the whole outage, and a hanging primary cost every turn its
  whole share of the deadline;
* **the chain shares one deadline, and a rung with a live rung behind it gets half of it.**
  Each rung gets what is left of the ``timeout`` the caller set; a rung that is not the last live
  one gets :func:`primary_share` of that, so a primary that hangs leaves the other half for the
  next provider inside the same clock. Until 2026-09-07 the primary got the whole deadline and a
  timeout stopped the walk ("a chain does not buy a second clock"), so a hanging OpenAI was a
  total outage of every text tier with Anthropic and Gemini idle. A rung is not tried at all
  with less than :func:`_floor_s` remaining, and a lone model keeps the whole deadline;
* **a sampling knob a model refuses is dropped for THAT model**, up front from a local list
  (Anthropic's deprecations page: Claude 4.7 and later answer 400 to a non-default
  ``temperature``, ``top_p`` or ``top_k``; litellm 1.90.1's table still says they take them) or
  from litellm's provider table, and failing both, on a 400 that names it; the primary keeps its
  knob, and only the rung that will not take it goes without.

The FIRST error, the primary's, is what is raised when every rung fails, because it is the one
that explains why the learner did not get the model the tier asked for; the rest are on the
telemetry stream beside it (``gateway.fallback``). It is tagged so the routes can tell a
provider failure from a bug (:func:`is_provider_failure`) and answer in Wobo's own line
(:class:`ProviderUnavailable`, :data:`OUTAGE_LINE`) rather than a bare 500.

When every provider in the chain is already marked out, :class:`ProvidersOut` is raised without a
call: three known refusals are not worth three round trips, and the cool-off will re-probe.

The raw HTTPS seams (``plexus/media.py``, ``plexus/image.py``) do not come through
:func:`complete`, but they classify and mark their failures through :func:`note_failure`, so a
quota refusal on Gemini's voice is a mark the text chain honours and the other way round.

Nothing else is retried here. A real failure is raised as it arrived, because hiding it costs
more than it saves.
"""

from __future__ import annotations

import contextlib
import logging
import os
import re
import time
from typing import Any

from wobo_gateway.routing import provider_of

logger = logging.getLogger("wobo.gateway.model")

#: Below this there is no point trying another rung on a turn-sized deadline: no model answers a
#: turn in five seconds, and the attempt would spend the last of the wait the learner is already
#: sitting through. Scaled down for a short deadline (:func:`_floor_s`): the child-safety screen
#: has 1.5 s for a one-line verdict, and a flat five-second floor made its second rung unreachable.
_MIN_RETRY_S = 5.0
#: The share of a deadline a further rung must still have. With 1.5 s that is 0.3 s, which a
#: tiny-tier verdict answers inside when its provider is up.
_MIN_RETRY_SHARE = 0.2
#: The share of what is left of the deadline a rung gets when a live rung stands behind it.
#: Half: a primary that has not answered in half the time the learner was promised is hanging,
#: and the other half is enough for a healthy second rung (a turn answers well inside 30 s).
_DEFAULT_PRIMARY_SHARE = 0.5


def primary_share() -> float:
    """``WOBO_CHAIN_PRIMARY_SHARE``, default 0.5, clamped to a range that still leaves the next
    rung a fair deadline."""
    raw = os.getenv("WOBO_CHAIN_PRIMARY_SHARE")
    try:
        value = float(raw) if raw else _DEFAULT_PRIMARY_SHARE
    except ValueError:
        return _DEFAULT_PRIMARY_SHARE
    return min(0.9, max(0.2, value))


def _floor_s(budget: float) -> float:
    """The least of the deadline a further attempt is started with."""
    return min(_MIN_RETRY_S, budget * _MIN_RETRY_SHARE)


# The knobs a provider may refuse outright. Optional every one of them: dropping a knob changes
# how the answer is sampled, never whether there is an answer.
_SAMPLING_KNOBS = ("temperature", "top_p", "top_k")

#: Anthropic's deprecations page (platform.claude.com/docs/en/about-claude/model-deprecations,
#: read 2026-09-07): "temperature, top_p, top_k ... Returns a 400 error when set to a non-default
#: value on Claude 4.7 and later models". Sonnet 5 and Opus 5 are the second rung of every text
#: tier, and litellm 1.90.1's parameter table still lists the knobs as supported for them, so a
#: turn that reached them paid the 400 and a second round trip. The version is read off the id.
_CLAUDE_VERSION = re.compile(r"claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?")
_KNOBLESS_FROM = (4, 7)

# What an empty balance or a spent quota says, per the vendors' own error pages (2026-09-05):
#   Anthropic: 400 invalid_request_error "credit balance is too low", 402 billing_error, and a
#              429 with no retry-after at the tier's monthly spend cap;
#   OpenAI:    429 with error.type insufficient_quota and error.code credit_balance_exhausted /
#              organization_spend_limit_exceeded / project_spend_limit_exceeded /
#              organization_usage_limit_exceeded;
#   Gemini:    429 RESOURCE_EXHAUSTED ("You exceeded your current quota").
_EXHAUSTION_PHRASES = (
    "credit balance",
    "insufficient_quota",
    "insufficient quota",
    "credit_balance_exhausted",
    "spend_limit_exceeded",
    "usage_limit_exceeded",
    "spend cap",
    "billing_error",
    "resource_exhausted",
    "exceeded your current quota",
    "quota exceeded",
)

#: What a learner reads when no provider could answer. Wobo's own words (docs/copy/voice.md 10a):
#: plain, warm, no vendor, no exclamation, no hour named.
OUTAGE_LINE = "I cannot get my thoughts in order just now. Ask me again in a little while."


class ProvidersOut(RuntimeError):
    """Every provider in the chain is marked out; no call was made."""


class ProviderUnavailable(RuntimeError):
    """No provider answered a learner's call, in a shape the routes can hand to the client.

    Raised by ``app.Gateway.invoke`` over the provider's own error (kept as ``__cause__`` for the
    log and the alert) when that error is a provider failure (:func:`is_provider_failure`) and
    not a bug. The capability route answers it as a 503 with ``{code, message}``, the same shape
    as the spend ceiling's refusal, so the client shows Wobo's line instead of its generic broken
    page; the board stream answers it as Wobo's line over the ordinary stream. Until 2026-09-07 a
    total outage reached the child as FastAPI's bare ``500 Internal Server Error``.
    """

    code = "providers_out"

    def __init__(self, capability: str, *, reason: str) -> None:
        self.capability = capability
        #: The exception TYPE name of the primary's failure. Never its text, which can carry a key.
        self.reason = reason
        self.message = OUTAGE_LINE
        super().__init__(f"no provider answered {capability} ({reason})")

    def body(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


_FAILURE_TAG = "wobo_provider_failure"


def is_provider_failure(exc: BaseException) -> bool:
    """Did this come out of a provider (a refusal, a timeout, a dead route, every rung marked)
    rather than out of our own code? Only the chain walker tags an error, and only when every
    rung of a chain failed."""
    return isinstance(exc, ProvidersOut) or bool(getattr(exc, _FAILURE_TAG, False))


def _tag(exc: BaseException) -> None:
    with contextlib.suppress(Exception):  # an exception that refuses attributes is still raised
        setattr(exc, _FAILURE_TAG, True)


def _objects_to(exc: Exception, knob: str) -> bool:
    """Did the provider refuse this specific knob? A 400 that names it, not any 400."""
    text = str(exc).lower()
    if knob not in text:
        return False
    return any(
        phrase in text
        for phrase in ("unsupported", "does not support", "not supported", "unrecognized")
    )


def _status(exc: Exception) -> int | None:
    # litellm's errors carry ``status_code``; urllib's HTTPError carries ``code``.
    code = getattr(exc, "status_code", None)
    if code is None:
        code = getattr(exc, "code", None)
    try:
        return int(code) if code is not None else None
    except (TypeError, ValueError):
        return None


def _is_bad_request(exc: Exception) -> bool:
    """A 400 from the provider. Not a timeout, not a 5xx, not a network fault: those are worth no
    second attempt on the same model, and retrying them would double the load on an ailing
    provider."""
    if _status(exc) in (400, 422):
        return True
    name = type(exc).__name__.lower()
    if "badrequest" in name or "unprocessable" in name:
        return True
    text = str(exc).lower()
    return "badrequest" in text or "400 bad request" in text


def _exhausted(exc: Exception, detail: str = "") -> bool:
    """Is this the provider saying the account has no money or no quota left? ``detail`` is the
    body of an HTTP refusal, for the raw seams whose error object does not carry it."""
    if _status(exc) == 402:
        return True
    text = f"{exc} {detail}".lower()
    return any(phrase in text for phrase in _EXHAUSTION_PHRASES)


def _out_of_time(exc: Exception) -> bool:
    """Did the clock run out rather than a model object to something? A timeout is the one error
    that cannot be hiding a 400: nothing came back at all."""
    name = type(exc).__name__.lower()
    if "timeout" in name or "deadline" in name:
        return True
    text = str(exc).lower()
    return "timed out" in text or "deadline exceeded" in text


def _models_in_play(kwargs: dict[str, Any]) -> list[str]:
    """The primary and every fallback, in order."""
    models = [str(kwargs.get("model") or "")]
    for fb in kwargs.get("fallbacks") or []:
        if isinstance(fb, str):
            models.append(fb)
        elif isinstance(fb, dict) and fb.get("model"):
            models.append(str(fb["model"]))
    return [m for m in models if m]


def _refuses_sampling_knobs(model: str) -> bool:
    """Is this a Claude 4.7-or-later id, which answers 400 to any non-default sampling knob?"""
    match = _CLAUDE_VERSION.search(model.split("/", 1)[-1])
    if match is None:
        return False
    version = (int(match.group(1)), int(match.group(2) or 0))
    return version >= _KNOBLESS_FROM


def _refused_up_front(model: str, kwargs: dict[str, Any]) -> list[str]:
    """Knobs THIS model will not accept: the local list first, then litellm's provider table."""
    sent = [knob for knob in _SAMPLING_KNOBS if knob in kwargs]
    if not sent:
        return []
    if _refuses_sampling_knobs(model):
        return sent
    try:
        from litellm import get_supported_openai_params
    except Exception:  # noqa: BLE001 - an older client just means we lean on the retry
        return []
    refused: list[str] = []
    for knob in sent:
        try:
            supported = get_supported_openai_params(model=model) or []
        except Exception:  # noqa: BLE001 - an unknown model is not evidence of anything
            continue
        if knob not in supported:
            refused.append(knob)
    return refused


def _timed(call: Any, kwargs: dict[str, Any]) -> Any:
    """Run the completion and leave the round trip where the usage ledger can pick it up.

    This is the only function in the service that wraps the litellm call itself, so it is the only
    one that can measure what the PROVIDER took rather than what the whole request took.
    ``telemetry.record_cost`` consumes the note a frame or two later; a call that never reaches
    here records no latency at all, which the ledger stores as NULL: "not measured", never zero.

    The measurement never affects the answer: a failure inside the note is swallowed, and the
    exception from the call itself is raised exactly as it arrived.
    """
    start = time.perf_counter()
    try:
        return call(**kwargs)
    finally:
        try:
            from wobo_gateway import ledger

            ledger.note_latency((time.perf_counter() - start) * 1000)
        except Exception:  # noqa: BLE001 - accounting must never colour a model call
            pass


#: The Google key, by the name this product gives it everywhere (``.env.example``, ``app.py``,
#: ``health.py``, the media seams). litellm's Gemini provider reads ``GEMINI_API_KEY`` instead
#: (docs.litellm.ai/docs/providers/gemini, read 2026-09-07), and on 2026-09-07 that gap was live:
#: with only the product's name set, every ``gemini/`` rung failed in 0.0 s without a network call.
_GOOGLE_KEY_ENV = "GOOGLE_AI_API_KEY"
_LITELLM_GOOGLE_KEY_ENVS = ("GEMINI_API_KEY", "GOOGLE_API_KEY")


def _with_provider_key(model: str, call: dict[str, Any]) -> dict[str, Any]:
    """Hand a Gemini rung the Google key under the product's own name, per call.

    ``litellm.completion(..., api_key=...)`` overrides the environment for that call
    (docs.litellm.ai/docs/set_keys, read 2026-09-07). Only when litellm's own names are unset and
    the caller passed no key; never to another provider's rung, which must not see it.
    """
    if "api_key" in call or provider_of(model) != "gemini":
        return call
    if any(os.getenv(name) for name in _LITELLM_GOOGLE_KEY_ENVS):
        return call
    key = os.getenv(_GOOGLE_KEY_ENV)
    return {**call, "api_key": key} if key else call


def _budget(kwargs: dict[str, Any]) -> float | None:
    raw = kwargs.get("timeout")
    if isinstance(raw, (int, float)) and not isinstance(raw, bool) and raw > 0:
        return float(raw)
    return None


def _attempt(litellm: Any, call: dict[str, Any]) -> Any:
    """One model, at most two calls: the second only without a sampling knob the first refused by
    name, or without every optional knob on a 400 that named nothing (litellm wraps some
    provider refusals in messages that do not repeat the field). Never on a timeout, never on a
    credit refusal, never with less than :data:`_MIN_RETRY_S` of the deadline left."""
    started = time.perf_counter()
    try:
        return _timed(litellm.completion, call)
    except Exception as first:  # noqa: BLE001 - re-raised unless it is the fussy-knob case
        if _exhausted(first) or _out_of_time(first):
            raise
        named = [k for k in _SAMPLING_KNOBS if k in call and _objects_to(first, k)]
        sent = [k for k in _SAMPLING_KNOBS if k in call]
        refused = named or (sent if _is_bad_request(first) else [])
        if not refused:
            raise
        retry = {k: v for k, v in call.items() if k not in refused}
        budget = _budget(call)
        if budget is not None:
            left = budget - (time.perf_counter() - started)
            if left < _floor_s(budget):
                logger.info(
                    "model call: not retrying %s without %s, %.1fs left of a %.0fs deadline",
                    call["model"],
                    ", ".join(refused),
                    left,
                    budget,
                )
                raise
            retry["timeout"] = left
        logger.info(
            "model call: retrying %s without %s (%s)",
            call["model"],
            ", ".join(refused),
            "it named them" if named else "a 400 came back",
        )
        try:
            return _timed(litellm.completion, retry)
        except Exception:  # noqa: BLE001 - the first error is the honest one to report
            raise first from None


def note_failure(model: str, error: Exception, *, detail: str = "") -> float | None:
    """One failed call to ``model`` made OUTSIDE :func:`complete` (the raw HTTPS media seams),
    classified the way the chain walker classifies its own and marked on health the same way:
    a credit or quota refusal marks the provider out at once, anything else counts toward the
    streak. ``detail`` is the HTTP body, where Google and OpenAI put the reason. Returns the
    moment the provider is re-probed when this failure marked it out, else ``None``."""
    from wobo_gateway import health, telemetry

    reason = type(error).__name__
    provider = health.provider_of(model)
    if _exhausted(error, detail):
        until = health.mark_out_of_credit(model, reason=reason)
        telemetry.note_out_of_credit(provider=provider, model=model, until=until, reason=reason)
        return until
    until = health.record_model(model, ok=False, error=reason, timed_out=_out_of_time(error))
    if until is not None:
        telemetry.note_weather_out(provider=provider, model=model, until=until, reason=reason)
    return until


def complete(**kwargs: Any) -> Any:
    """``litellm.completion`` over the chain ``model`` + ``fallbacks``, one model per call.

    Accepts exactly what every caller in the service already sends; ``fallbacks`` is consumed here
    and never handed to litellm. Returns the first response; raises the primary's error when every
    rung fails, or :class:`ProvidersOut` when every provider was already marked out.
    """
    import litellm

    from wobo_gateway import health, telemetry

    litellm.drop_params = True
    chain = _models_in_play(kwargs)
    # ``short_deadline``: the caller's deadline is a policy choice well under the provider's own
    # pace (the 1.5 s child-safety screen). A timeout under it says nothing about the provider,
    # so it is not written to the weather: live on 2026-09-08 two such timeouts marked the turn
    # tier's model out for a minute and a child's next two turns ran with no ink.
    short_deadline = bool(kwargs.get("short_deadline"))
    base = {k: v for k, v in kwargs.items() if k not in ("fallbacks", "model", "short_deadline")}
    budget = _budget(kwargs)
    share = primary_share()
    started = time.perf_counter()

    live: list[str] = []
    for model in chain:
        if health.provider_available(model):
            live.append(model)
        else:
            telemetry.note_skipped(provider=health.provider_of(model), model=model)
    if not live:
        raise ProvidersOut(f"every provider in the chain is marked out: {', '.join(chain)}")

    first_error: Exception | None = None
    previous: str | None = None
    last = len(live) - 1
    for index, model in enumerate(live):
        call = {**base, "model": model}
        if budget is not None:
            left = budget if index == 0 else budget - (time.perf_counter() - started)
            if index > 0 and left < _floor_s(budget):
                logger.info(
                    "model call: no time left for %s, %.1fs of a %.0fs deadline",
                    model,
                    left,
                    budget,
                )
                break
            # A rung with a live rung behind it gets a share of what is left, so a hang here
            # still leaves the next provider a deadline of its own; the last rung gets the rest.
            call["timeout"] = left * share if index < last else left
        pruned = _refused_up_front(model, call)
        if pruned:
            logger.info("model call: %s refuses %s, dropping it", model, ", ".join(pruned))
            call = {k: v for k, v in call.items() if k not in pruned}
        call = _with_provider_key(model, call)
        try:
            response = _attempt(litellm, call)
        except Exception as exc:  # noqa: BLE001 - classified, recorded, and the chain moves on
            first_error = first_error or exc
            previous = model
            reason = type(exc).__name__
            provider = health.provider_of(model)
            if _exhausted(exc):
                until = health.mark_out_of_credit(model, reason=reason)
                telemetry.note_out_of_credit(
                    provider=provider, model=model, until=until, reason=reason
                )
            else:
                timed_out = _out_of_time(exc)
                until = (
                    None
                    if timed_out and short_deadline
                    else health.record_model(model, ok=False, error=reason, timed_out=timed_out)
                )
                if until is not None:
                    telemetry.note_weather_out(
                        provider=provider, model=model, until=until, reason=reason
                    )
                if timed_out:
                    logger.info("model call: %s timed out; the next rung gets what is left", model)
            continue
        health.record_model(model, ok=True)
        # The full id that answered, for the ledger: litellm's ``response.model`` is the bare name
        # ("gpt-5.6-terra"), which cannot say whose bill a fallback landed on.
        with contextlib.suppress(Exception):  # a response that refuses an attribute still answers
            response.served_model = model
        if previous is not None:
            telemetry.note_fallback(
                from_model=previous, to_model=model, error=type(first_error).__name__
            )
        return response

    assert first_error is not None  # the loop ran at least once, since live is non-empty
    _tag(first_error)
    raise first_error
