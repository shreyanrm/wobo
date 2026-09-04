"""Gateway telemetry: latency, tokens, cache hits, track, capability.

This is separate from the learner event store and does not emit contract events. It is
structured logging plus an in-memory metrics sink for dev and tests.

:func:`record_cost` is the one funnel every live model call in this service passes through, which
is why three different records are fed from here rather than from nine call sites:

* the structured ``gateway.cost`` log line, with the capability's ceiling beside the figure;
* :mod:`wobo_gateway.spend`, the platform's per-process daily USD ceiling, which is a GATE;
* :mod:`wobo_gateway.ledger`, the DURABLE per-call record in Postgres, which is a RECORD — it
  survives a restart, it is correct with a second replica, and it is where every question about
  the past is answered from. The sink above still forgets everything when the process does.
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import asdict, dataclass
from typing import Any

logger = logging.getLogger("wobo.gateway.telemetry")


@dataclass(frozen=True)
class TelemetryEvent:
    capability: str
    track: str
    model: str
    latency_ms: float
    tokens: int
    cache_hit: bool
    # The two onsets a board turn is judged on (BOARD.md §10): when the learner hears Wobo's first
    # syllable and when they see the first stroke. Optional because a model call is not a turn —
    # only the board's own measurement (board.stream.record_onsets) fills them in, and None means
    # "not measured here", never "zero milliseconds".
    first_syllable_ms: float | None = None
    first_stroke_ms: float | None = None


# One process serves every learner for as long as it lives, so an unbounded list here is a slow
# leak: the sink exists for dev inspection and test assertions, and a window of the most recent
# events answers both. The durable record is the structured log line emit() writes.
MAX_RETAINED_EVENTS = 1000


class MetricsSink:
    """In-memory sink. Holds the last :data:`MAX_RETAINED_EVENTS` events for inspection in dev
    and assertions in tests; older ones fall off the back rather than accumulating forever."""

    def __init__(self, maxlen: int = MAX_RETAINED_EVENTS) -> None:
        self.events: deque[TelemetryEvent] = deque(maxlen=maxlen)

    def record(self, event: TelemetryEvent) -> None:
        self.events.append(event)


def emit(sink: MetricsSink, event: TelemetryEvent) -> None:
    sink.record(event)
    # The JSON log formatter (app._JsonFormatter) merges ``record.fields`` into the line; anything
    # under another key is dropped on the floor, so telemetry emits under "fields" like every other
    # structured log in the gateway.
    logger.info("gateway.telemetry", extra={"fields": asdict(event)})


def _token_counts(response: Any) -> tuple[int | None, int | None]:
    """Prompt and completion tokens off a provider response, or ``(None, None)``.

    None is not zero. A provider that reports no usage has told us nothing, and writing zero into
    the ledger for it would make a chart of tokens quietly wrong in the direction of "we are
    cheaper than we are".
    """
    usage = getattr(response, "usage", None)
    if usage is None and isinstance(response, dict):
        usage = response.get("usage")

    def _read(*names: str) -> int | None:
        for name in names:
            value = (
                usage.get(name)
                if isinstance(usage, dict)
                else getattr(usage, name, None)
                if usage is not None
                else None
            )
            if value is not None:
                try:
                    return max(0, int(value))
                except (TypeError, ValueError):
                    return None
        return None

    return _read("prompt_tokens", "input_tokens"), _read("completion_tokens", "output_tokens")


def record_cost(
    *,
    capability: str,
    model: str,
    response: Any,
    cost_ceiling: float | None = None,
    model_served: str | None = None,
    track: str | None = None,
    latency_ms: float | None = None,
    cache_hit: bool = False,
    unit_kind: str | None = None,
    unit_count: float = 1.0,
) -> float | None:
    """Log what one model call actually cost, against the capability's ``cost_ceiling``.

    Returns the cost in USD, or ``None`` when it cannot be computed (a provider that reports no
    usage, or a model litellm has no price for). Never raises: cost accounting must not be able
    to fail a learner's turn. A call over its ceiling logs a warning — that line is the signal
    the cost dashboard and the budget dials are tuned from.

    Every cost also lands in :mod:`wobo_gateway.spend`, the platform's daily USD accumulator, and
    in :mod:`wobo_gateway.ledger`, the DURABLE record. This function is the one funnel every live
    model call in the service already passes through, which is why all three are fed from here
    rather than from nine call sites. Recording is what happens AFTER a call; the refusal happens
    BEFORE one, in ``app.Gateway.invoke`` and ``app.stream_board_turn``, which ask
    :func:`wobo_gateway.spend.verdict` on the way in.

    **An unpriced call is still recorded.** This function used to return the moment litellm could
    not price a response, which meant a model with no price table left no trace at all — the worst
    possible outcome, because the calls we cannot cost are exactly the ones an operator most needs
    to know about. The ledger row is now written either way, carrying ``cost_usd = NULL`` and
    ``cost_source = 'unpriced'``, and the console shows those beside the money rather than folding
    them into it. The ``spend`` accumulator and the ``gateway.cost`` line are unchanged: a ceiling
    cannot be charged for a number nobody has.

    ``model_served`` is who ACTUALLY answered when a fallback took over; ``model`` stays what the
    policy asked for. The rest of the optional arguments are what only the caller can know — the
    track, the latency, the cache, and the UNIT the learner received — and every one of them
    defaults to the value that means "not measured here", never to a zero that would read as a
    measurement.
    """
    if cost_ceiling is None:
        try:
            from wobo_gateway.registry import policy

            cost_ceiling = policy(capability).cost_ceiling
        except (KeyError, ImportError):
            cost_ceiling = None

    cost: float | None
    try:
        import litellm

        cost = float(litellm.completion_cost(completion_response=response))
    except Exception:  # no price table, no usage, provider quirk — accounting is best-effort
        logger.debug("cost unavailable", extra={"fields": {"capability": capability}})
        cost = None

    if cost is not None:
        fields = {
            "capability": capability,
            "model": model,
            "cost_usd": round(cost, 6),
            "cost_ceiling": cost_ceiling,
        }
        if cost_ceiling is not None and cost > cost_ceiling:
            logger.warning("gateway.cost over ceiling", extra={"fields": fields})
        else:
            logger.info("gateway.cost", extra={"fields": fields})
        try:
            from wobo_gateway import spend

            spend.record(cost, capability=capability, model=model)
        except Exception:  # noqa: BLE001 — the ledger must never be able to fail a learner's turn
            logger.debug("spend not recorded", extra={"fields": {"capability": capability}})

    try:
        from wobo_gateway import ledger

        tokens_in, tokens_out = _token_counts(response)
        # Who ACTUALLY answered. litellm reports the model on the response, and when a fallback
        # took over that is a different name from the one the policy asked for — which is the
        # difference between a chart of our bill and a chart of our intentions. An explicit
        # argument still wins; a response that says nothing falls back to the requested model.
        served = model_served or str(getattr(response, "model", "") or "") or model
        ledger.record(
            capability=capability,
            model_requested=model,
            model_served=served,
            track=track,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost,
            cost_source=ledger.FROM_LITELLM if cost is not None else ledger.UNPRICED,
            # The provider round trip, measured by ``model_call._timed`` and consumed here. A call
            # that did not go through that wrapper leaves None, which the ledger stores as NULL:
            # "not measured", never "instant".
            latency_ms=latency_ms if latency_ms is not None else ledger.take_latency(),
            cache_hit=cache_hit,
            unit_kind=unit_kind,
            unit_count=unit_count,
        )
    except Exception:  # noqa: BLE001 — same rule: a child's answer outranks an accounting line
        logger.debug("ledger row not recorded", extra={"fields": {"capability": capability}})

    return cost
