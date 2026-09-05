"""One place that talks to a model, so a provider's fussiness never becomes an outage.

Every capability sends a temperature, because a tutor's answers should not wander. Some newer
models refuse any temperature but their own default and answer 400 rather than ignoring the
field. That refusal is worse than it looks: the same kwargs are reused for every model in the
fallback chain, so ONE fussy model in the chain fails the whole call, and the caller only ever
sees the LAST failure — a different error, from a different provider, that says nothing about
the knob that actually did the damage. Proved in production on 2026-09-04: the public Ask Wobo
answered 503 while its log carried "Unsupported value: 'temperature' does not support 0.2 with
this model" from a fallback nobody was looking at.

So the knob is checked BEFORE the call, against every model in the chain, and dropped if any
of them will not take it. The error-driven retry stays as a backstop for the case the provider
table does not know about yet. Nothing else is retried here: a real failure (no credit, a bad
key, a timeout) is raised as it arrived, because hiding those costs more than it saves.

**And the retry never costs a learner more time than the caller allowed.** It is skipped outright
when the clock is what ran out, and otherwise it is given only what is left of the deadline it was
handed. Without both, a fallback chain turned every timeout into two, which put a turn past the
client's own 65s deadline: the child was told the answer was taking too long while the gateway was
still working on it, and the owner paid for the second call.
"""

from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger("wobo.gateway.model")

#: Below this there is no point trying again: no model answers in five seconds, and the attempt
#: would spend the last of the wait the learner is already sitting through.
_MIN_RETRY_S = 5.0

# The knobs a provider may refuse outright. Optional every one of them: dropping a knob changes
# how the answer is sampled, never whether there is an answer.
_SAMPLING_KNOBS = ("temperature", "top_p")


def _objects_to(exc: Exception, knob: str) -> bool:
    """Did the provider refuse this specific knob? A 400 that names it, not any 400."""
    text = str(exc).lower()
    if knob not in text:
        return False
    return any(
        phrase in text
        for phrase in ("unsupported", "does not support", "not supported", "unrecognized")
    )


def _is_bad_request(exc: Exception) -> bool:
    """A 400 from somewhere in the chain. Not a timeout, not a 5xx, not a network fault: those
    are worth no second attempt, and retrying them would double the load on an ailing provider.

    Why any 400 and not only one that names the knob: litellm runs the fallback chain itself and
    raises the LAST failure, so a middle model's "I will not take your temperature" is invisible
    from out here. Production, 2026-09-04: the refusal came from the fallback, the exception came
    from the primary's billing, and the learner got nothing. One extra attempt without the
    optional knobs is the cheapest way to tell those two apart."""
    name = type(exc).__name__.lower()
    if "badrequest" in name or "unprocessable" in name:
        return True
    text = str(exc).lower()
    return "badrequest" in text or "400 bad request" in text


def _has_a_chain(kwargs: dict[str, Any]) -> bool:
    """Was there more than one model in play?

    This is the question that decides whether the exception we were handed can be trusted to speak
    for the whole call. It cannot when there was a chain: litellm raises the LAST model's failure,
    so a middle model's refusal of a sampling knob leaves no trace in what reaches us.

    The 2026-09-04 fix read that failure for a 400 and retried on one. Then a THIRD provider was
    added to every text chain (``routing``: "no single provider's outage or empty balance can
    leave a learner with no answer at all"), and on 2026-09-05 the teaching harness found what
    that did: the middle model refused the temperature, the last one failed on a bad key, and what
    surfaced was an ``APIConnectionError`` about authentication — not a 400, naming no knob, and
    so not retried. Every live board plan in the gateway failed that way, and because
    ``wobo.board_plan_for`` degrades to the keyless keyword plan rather than erroring, no learner
    and no log ever said so.

    So the rule is the chain itself: with a fallback in play the error is one model's opinion, and
    one attempt without the optional knobs is owed before the whole call is written off. With a
    single model the error IS the whole story.

    Two things bound it, and both are in :func:`complete` rather than here, because both are about
    the clock rather than about the error. A timeout is never a hidden knob refusal, so it stays a
    timeout whether or not there is a chain; and the retry may only use time still left inside the
    deadline the caller gave, so a chain can never double the ceiling the client is waiting on.
    """
    return bool(kwargs.get("fallbacks"))


def _out_of_time(exc: Exception) -> bool:
    """Did the clock run out rather than a model object to something?

    This is the half of the chain rule that was missing, and it is the half that matters to a
    child. ``timeout=timeout_for(...)`` bounds each litellm call at 60s for a turn and 180s for a
    generation, and the client's own deadlines (``packages/sdk/src/gateway.ts``) sit just above
    those at 65s and 190s. Retrying a timed-out chain doubles the server's ceiling and puts it over
    the client's, so the learner is shown "that one is taking longer than it should" while the
    gateway is still working and the owner still pays for the second call. A timeout is also the
    one error that cannot be hiding a 400: nothing came back at all.
    """
    if "timeout" in type(exc).__name__.lower() or "deadline" in type(exc).__name__.lower():
        return True
    text = str(exc).lower()
    return "timed out" in text or "deadline exceeded" in text


def _models_in_play(kwargs: dict[str, Any]) -> list[str]:
    """The primary and every fallback: one fussy model anywhere fails the whole chain."""
    models = [str(kwargs.get("model") or "")]
    for fb in kwargs.get("fallbacks") or []:
        if isinstance(fb, str):
            models.append(fb)
        elif isinstance(fb, dict) and fb.get("model"):
            models.append(str(fb["model"]))
    return [m for m in models if m]


def _refused_up_front(kwargs: dict[str, Any]) -> list[str]:
    """Knobs at least one model in the chain will not accept, per the provider table."""
    try:
        from litellm import get_supported_openai_params
    except Exception:  # noqa: BLE001 — an older client just means we lean on the retry
        return []
    refused: list[str] = []
    for knob in _SAMPLING_KNOBS:
        if knob not in kwargs:
            continue
        for model in _models_in_play(kwargs):
            try:
                supported = get_supported_openai_params(model=model) or []
            except Exception:  # noqa: BLE001 — an unknown model is not evidence of anything
                continue
            if knob not in supported:
                refused.append(knob)
                break
    return refused


def _timed(call: Any, kwargs: dict[str, Any]) -> Any:
    """Run the completion and leave the round trip where the usage ledger can pick it up.

    This is the only function in the service that wraps the litellm call itself, so it is the only
    one that can measure what the PROVIDER took rather than what the whole request took.
    ``telemetry.record_cost`` consumes the note a frame or two later; a call that never reaches
    here records no latency at all, which the ledger stores as NULL — "not measured", never zero.

    The measurement never affects the answer: a failure inside the note is swallowed, and the
    exception from the call itself is raised exactly as it arrived.
    """
    import time

    start = time.perf_counter()
    try:
        return call(**kwargs)
    finally:
        try:
            from wobo_gateway import ledger

            ledger.note_latency((time.perf_counter() - start) * 1000)
        except Exception:  # noqa: BLE001 — accounting must never colour a model call
            pass


def complete(**kwargs: Any) -> Any:
    """``litellm.completion``, minus any sampling knob a model in the chain would refuse."""
    import litellm

    litellm.drop_params = True
    up_front = _refused_up_front(kwargs)
    if up_front:
        logger.info(
            "model call: dropping %s — a model in the chain refuses it", ", ".join(up_front)
        )
        kwargs = {k: v for k, v in kwargs.items() if k not in up_front}
    started = time.perf_counter()
    try:
        return _timed(litellm.completion, kwargs)
    except Exception as first:  # noqa: BLE001 — re-raised unless it is the fussy-knob case
        named = [k for k in _SAMPLING_KNOBS if k in kwargs and _objects_to(first, k)]
        sent = [k for k in _SAMPLING_KNOBS if k in kwargs]
        blind = _is_bad_request(first) or (_has_a_chain(kwargs) and not _out_of_time(first))
        refused = named or (sent if blind else [])
        if not refused:
            raise
        retry = {k: v for k, v in kwargs.items() if k not in refused}
        budget = kwargs.get("timeout")
        if isinstance(budget, (int, float)) and not isinstance(budget, bool):
            left = float(budget) - (time.perf_counter() - started)
            if left < _MIN_RETRY_S:
                logger.info(
                    "model call: not retrying without %s — %.1fs left of a %.0fs deadline",
                    ", ".join(refused),
                    left,
                    float(budget),
                )
                raise
            retry["timeout"] = left
        why = (
            "it named them"
            if named
            else "a 400 came back"
            if _is_bad_request(first)
            else "the error came from one model in a chain and cannot speak for the rest"
        )
        logger.info("model call: retrying without %s — %s", ", ".join(refused), why)
        try:
            return _timed(litellm.completion, retry)
        except Exception:  # noqa: BLE001 — the first error is the honest one to report
            raise first from None
