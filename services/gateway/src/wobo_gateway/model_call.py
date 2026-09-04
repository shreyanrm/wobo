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
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("wobo.gateway.model")

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
    try:
        return _timed(litellm.completion, kwargs)
    except Exception as first:  # noqa: BLE001 — re-raised unless it is the fussy-knob case
        named = [k for k in _SAMPLING_KNOBS if k in kwargs and _objects_to(first, k)]
        sent = [k for k in _SAMPLING_KNOBS if k in kwargs]
        refused = named or (sent if _is_bad_request(first) else [])
        if not refused:
            raise
        logger.info("model call: retrying without %s", ", ".join(refused))
        try:
            return _timed(
                litellm.completion, {k: v for k, v in kwargs.items() if k not in refused}
            )
        except Exception:  # noqa: BLE001 — the first error is the honest one to report
            raise first from None
