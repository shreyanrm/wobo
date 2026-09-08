"""The platform's daily money ceiling — the one thing standing between an open box and a bill.

``budget.py`` caps how many times a LEARNER may ask. Nothing capped how much the PLATFORM may
spend, and this product puts frontier models behind a box a stranger with no account can type
into. ``telemetry.record_cost`` already computed the dollars for every call and then wrote a
log line and returned. This module is where those dollars now land, and where a call is refused
once the day is gone.

**What it does.** One accumulator in USD per UTC day. Every model call's cost is added by
:func:`record` (called from :func:`wobo_gateway.telemetry.record_cost`, the single funnel every
live call already passes through). Before a call reaches a provider, :func:`verdict` says
whether to serve it, serve it on a cheaper model, or refuse it.

**Degrade before you break.** The ladder is SERVE, then DEGRADE, then REFUSE, and the middle
rung is the point of it: past its degrade line a caller is still answered, on the tier one rung
DOWN the routing ladder (:func:`cheaper_tier`), which is the same ladder ``routing.escalate``
climbs on a rejection. A cheaper answer beats no answer. Only past the refuse line does anyone
get nothing, and then they get a kind, honest line in Wobo's voice (:class:`SpendCeilingReached`)
rather than a stack trace.

**Who is shed first, and why.** Three lanes, refused in this order:

===========  ============================  ========  =======
lane         who                           degrade   refuse
===========  ============================  ========  =======
``stranger`` anonymous, or no account:     50 %      90 %
             the public Ask box and the
             internal cron jobs
``member``   a signed-in learner on free   80 %      100 %
``paid``     a signed-in learner who paid  100 %     125 %
===========  ============================  ========  =======

The order is deliberate: **a paying learner must never be cut off by a stranger's spending.**
Strangers are refused at 90 % of the ceiling, so no unauthenticated traffic can ever consume the
last tenth; members stop at 100 %; and the headroom from there to 125 % is a reserve only a
paying learner can reach. The shape of the reserve is the thresholds themselves, which is why
they are fractions of one ceiling rather than three separate pots: three pots would let the paid
pot sit unspent while a member was refused, and a learner refused beside an unused budget is a
worse outcome than a slightly larger bill.

The lanes also match how easily an identity is minted. An anonymous Supabase subject costs an
attacker one public HTTP call (see ``app.meter_key``), so the stranger lane is the one that can
be flooded, and it is the one that goes first. A paying subscriber is the hardest identity to
forge and the most expensive to disappoint.

**Restart survival: it does not.** The accumulator is an in-process dict guarded by one lock,
exactly like ``app.py``'s per-minute rate limiter, ``budget.py``'s daily meter and
``ask_public.AskMeter``: one dict, one lock, one process. Two consequences, written here
rather than discovered later:

1. **A restart forgets the day.** A crash loop, or a deploy at 90 % of the ceiling, resets the
   accumulator to zero and the ceiling starts again. The real ceiling is therefore
   ``DAILY_SPEND_CEILING_USD × (restarts that day + 1)`` in the worst case. That is a bound, not
   a guarantee. The provider dashboards remain the only authority on what was actually spent,
   and ``docs/OPERATIONS.md`` says to set a hard billing limit on each provider account as the
   backstop this cannot be.
2. **It is ONE ceiling only while one replica runs.** ``railway.json`` pins ``numReplicas: 1``.
   Raise that to N and each replica grants itself a full ``DAILY_SPEND_CEILING_USD``, so the
   platform's true ceiling silently multiplies by N. Anyone raising ``numReplicas`` must move
   this accumulator to Redis first: :func:`record`, :func:`state` and :func:`verdict` are the
   only three functions that touch the store, and no caller changes.

**Seeing the money.** Every call logs one ``gateway.spend`` line carrying the running total, the
ceiling and the fraction, so the day's spend is greppable without a dashboard the owner does not
have. Crossing 50 %, 80 % and 100 % raises an alert (:mod:`wobo_gateway.alerts`), which reaches
his phone when ``ALERT_WEBHOOK_URL`` is set.
"""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum

from wobo_gateway import alerts
from wobo_gateway.budget import reset_at
from wobo_gateway.routing import Tier

logger = logging.getLogger("wobo.gateway.spend")


class Priority(StrEnum):
    """The three lanes load is shed in, cheapest-to-disappoint first."""

    STRANGER = "stranger"
    MEMBER = "member"
    PAID = "paid"


class Verdict(StrEnum):
    """What the ceiling says about the next model call."""

    SERVE = "serve"
    DEGRADE = "degrade"  # answer them, on the tier one rung down
    REFUSE = "refuse"


#: Plan names that mean somebody paid. Mirrors ``budget._MULTIPLIER`` minus ``free``; a plan
#: name nobody recognises is treated as free, never as paid, for the same reason ``budget``
#: does it: a billing bug must never hand out an allowance nobody paid for.
PAID_PLANS = frozenset({"pro", "max", "plus"})

_DEFAULT_CEILING_USD = 25.0

# (lane, line) -> (env var, default fraction of the ceiling). Same shape as ``budget._DIALS``,
# so there is one way to read a dial in this gateway rather than two.
_DIALS: dict[tuple[Priority, str], tuple[str, float]] = {
    (Priority.STRANGER, "degrade"): ("SPEND_DEGRADE_STRANGER", 0.50),
    (Priority.STRANGER, "refuse"): ("SPEND_REFUSE_STRANGER", 0.90),
    (Priority.MEMBER, "degrade"): ("SPEND_DEGRADE_MEMBER", 0.80),
    (Priority.MEMBER, "refuse"): ("SPEND_REFUSE_MEMBER", 1.00),
    (Priority.PAID, "degrade"): ("SPEND_DEGRADE_PAID", 1.00),
    (Priority.PAID, "refuse"): ("SPEND_REFUSE_PAID", 1.25),
}

_DEFAULT_WARN_FRACTIONS = (0.5, 0.8, 1.0)

# The cost ladder, downwards. ``routing._ESCALATION`` climbs it one rung per verifier rejection;
# this is the same ladder read the other way, so "cheaper" means exactly what "escalate" means
# and there is no second opinion about model cost anywhere in the gateway. ``tiny`` is the floor
# (there is nothing below it) and voice and imagery do not move: they are single-model seams.
# By PRICE, not by tier order: since 2026-09-08 generate sits on luna, the floor, so there is nothing
# cheaper to fall to and a degraded generation is served as it is (both callers treat None so).
_CHEAPER: dict[Tier, Tier] = {
    Tier.CREATE: Tier.GENERATE,
    Tier.VERIFY: Tier.TURN,
    Tier.REASON: Tier.TURN,
    Tier.TURN: Tier.TINY,
}


class SpendCeilingReached(Exception):
    """The platform's day is spent. Wobo-voiced, honest, and no price is ever named.

    The learner is told the truth in a way a child can hold: Wobo has done as much as it can
    today and will be ready again tomorrow. It never blames them and never asks for anything.
    """

    def __init__(self, priority: Priority, *, capability: str | None = None) -> None:
        self.priority = priority
        self.capability = capability
        self.reset_at = reset_at()
        self.message = (
            "I have done as much thinking as I can manage today. I will be ready again tomorrow."
        )
        super().__init__(self.message)

    def body(self) -> dict[str, str]:
        return {"code": "spend_ceiling", "message": self.message}


@dataclass(frozen=True)
class Ledger:
    """The day so far. What the log line and ``/healthz`` both read."""

    day: str
    spent_usd: float
    ceiling_usd: float
    calls: int

    @property
    def fraction(self) -> float:
        """How much of the day's ceiling is gone. ``0.0`` when no ceiling is configured."""
        return (self.spent_usd / self.ceiling_usd) if self.ceiling_usd > 0 else 0.0

    def as_dict(self) -> dict[str, object]:
        return {
            "day": self.day,
            "spent_usd": round(self.spent_usd, 6),
            "ceiling_usd": self.ceiling_usd,
            "fraction": round(self.fraction, 4),
            "calls": self.calls,
        }


# --- the dials -----------------------------------------------------------------------------------
def ceiling_usd() -> float:
    """The day's ceiling in USD. ``0`` or less means no ceiling — the wallet is open."""
    raw = os.getenv("DAILY_SPEND_CEILING_USD")
    if raw is None:
        return _DEFAULT_CEILING_USD
    try:
        return max(0.0, float(raw))
    except ValueError:
        return _DEFAULT_CEILING_USD


def line_for(priority: Priority, line: str) -> float:
    """The fraction of the ceiling at which this lane degrades or is refused."""
    name, default = _DIALS[(priority, line)]
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(0.0, float(raw))
    except ValueError:
        return default


def warn_fractions() -> tuple[float, ...]:
    """The thresholds an alert is raised at, as fractions of the ceiling."""
    raw = os.getenv("SPEND_WARN_FRACTIONS")
    if not raw:
        return _DEFAULT_WARN_FRACTIONS
    out: list[float] = []
    for piece in raw.split(","):
        piece = piece.strip()
        if not piece:
            continue
        try:
            out.append(max(0.0, float(piece)))
        except ValueError:
            continue
    return tuple(sorted(set(out))) or _DEFAULT_WARN_FRACTIONS


# --- the accumulator ------------------------------------------------------------------------------
_lock = threading.Lock()
_day: str = ""
_spent: float = 0.0
_calls: int = 0
_warned: set[float] = set()


def _today(now: datetime | None = None) -> str:
    return (now or datetime.now(UTC)).strftime("%Y-%m-%d")


def _roll_locked(day: str) -> None:
    """A new UTC day is a new ceiling. Called under the lock by every reader and writer."""
    global _day, _spent, _calls
    if day != _day:
        _day, _spent, _calls = day, 0.0, 0
        _warned.clear()


def state(now: datetime | None = None) -> Ledger:
    """Today's ledger. Cheap enough for ``/healthz`` to call on every probe."""
    day = _today(now)
    with _lock:
        _roll_locked(day)
        return Ledger(day=_day, spent_usd=_spent, ceiling_usd=ceiling_usd(), calls=_calls)


def spent_usd(now: datetime | None = None) -> float:
    return state(now).spent_usd


def reset() -> None:
    """Test seam — the day back to zero."""
    global _day, _spent, _calls
    with _lock:
        _day, _spent, _calls = "", 0.0, 0
        _warned.clear()


def record(
    cost: float, *, capability: str = "", model: str = "", now: datetime | None = None
) -> Ledger:
    """Add one model call's cost to the day, log the running total, alert on a crossing.

    Called from :func:`wobo_gateway.telemetry.record_cost`, which is the one place in this
    service that knows what a call cost. Never raises: accounting must not be able to fail a
    learner's turn, which is the same rule ``record_cost`` already lives by.
    """
    global _spent, _calls

    day = _today(now)
    try:
        amount = max(0.0, float(cost))
    except (TypeError, ValueError):
        amount = 0.0
    crossed: list[float] = []
    with _lock:
        _roll_locked(day)
        _spent += amount
        _calls += 1
        ledger = Ledger(day=_day, spent_usd=_spent, ceiling_usd=ceiling_usd(), calls=_calls)
        if ledger.ceiling_usd > 0:
            for fraction in warn_fractions():
                if ledger.fraction >= fraction and fraction not in _warned:
                    _warned.add(fraction)
                    crossed.append(fraction)
    fields = {"capability": capability, "model": model, "cost_usd": round(amount, 6)}
    logger.info("gateway.spend", extra={"fields": {**fields, **ledger.as_dict()}})
    for fraction in crossed:
        alerts.alert(
            alerts.SPEND_THRESHOLD,
            (
                f"the day's model spend has passed {fraction:.0%} of the "
                f"{ledger.ceiling_usd:.2f} USD ceiling"
            ),
            severity=alerts.CRITICAL if fraction >= 1.0 else alerts.WARN,
            threshold=fraction,
            **ledger.as_dict(),
        )
    return ledger


# --- the gate -------------------------------------------------------------------------------------
def priority_for(*, anonymous: bool, signed_in: bool, plan: str | None) -> Priority:
    """Which lane a caller is in. Derived from the door, never from a request body."""
    if anonymous or not signed_in:
        return Priority.STRANGER
    if (plan or "free").strip().lower() in PAID_PLANS:
        return Priority.PAID
    return Priority.MEMBER


def verdict(priority: Priority, *, now: datetime | None = None) -> Verdict:
    """Serve, serve cheaply, or refuse — for this lane, at this moment in the day.

    A ceiling of zero or less means no ceiling is configured, and everything is served: an
    unconfigured limit must never become an accidental outage.
    """
    ledger = state(now)
    if ledger.ceiling_usd <= 0:
        return Verdict.SERVE
    used = ledger.fraction
    if used >= line_for(priority, "refuse"):
        return Verdict.REFUSE
    if used >= line_for(priority, "degrade"):
        return Verdict.DEGRADE
    return Verdict.SERVE


def cheaper_tier(tier: Tier) -> Tier | None:
    """One rung DOWN the cost ladder, or ``None`` when there is nothing cheaper to fall to."""
    return _CHEAPER.get(tier)


__all__ = [
    "PAID_PLANS",
    "Ledger",
    "Priority",
    "SpendCeilingReached",
    "Verdict",
    "ceiling_usd",
    "cheaper_tier",
    "line_for",
    "priority_for",
    "record",
    "reset",
    "spent_usd",
    "state",
    "verdict",
    "warn_fractions",
]
