"""What one free day actually costs us — derived from the ledger, never from an assumption.

The owner's question, in his words: "usage pacing based on how much of the 1x uses the video
minutes and messages and content". Underneath it is a pricing question with a number at the end
of it: **what does one free allowance cost, and what consumed it?** He will set a price on the
answer, so the rule that governs this whole module is that every figure is arithmetic over rows
that were actually written, and every figure that CANNOT be computed is said out loud instead of
being filled in.

THE DERIVATION, in the order it runs.

1. **Cost per unit.** For each unit kind in the window, ``Σ cost_usd / Σ unit_count`` over the
   rollup. A unit with no priced calls behind it gets ``None`` and a sentence saying why, not a
   zero. ``video_second`` is the interesting case: no provider bills us per second of finished
   video, so its rows are deliveries carrying seconds and no money, and the honest reading is
   "a video costs its scene plan plus its narration", which is exactly what this reports.

2. **The attach rate.** A generation does not arrive alone. Asking for an explainer buys a plan
   call AND a narration line per scene, and the narration is a separate capability on a separate
   row. So the ratio of spoken seconds to generations, and of video seconds to generations, is
   MEASURED over the window rather than assumed, and the free-day cost carries those riders.

3. **The free day.** ``budget.limits_for("free")`` is the allowance — the same numbers the meter
   enforces, read from the same function, so this can never drift from what a learner is actually
   given. A full free day is every turn plus every generation plus the narration and video those
   generations drag along with them.

WHAT IT REFUSES TO DO. It does not price an unpriced model (litellm has no entry, so we do not
know, and a guess entered here would become a number in a deck). It does not extrapolate from one
call. It does not return zero for "no data" — :class:`FreeDayCost` carries ``usd=None`` and a list
of gaps, and a console rendering it must show the gaps. An empty ledger produces an empty answer,
which on the day this ships is the correct one.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from wobo_gateway import budget, ledger

#: How many priced calls a per-unit cost needs behind it before it is worth reporting as a rate.
#: One call is an anecdote: a single expensive retry, a single cache miss, a single fallback to a
#: frontier model would set the price of the product. Five is not statistics either, but it is
#: enough that the number stops moving by a factor on the next call, and the gap is reported until
#: it is met so nobody mistakes silence for a small number.
MIN_CALLS_FOR_A_RATE = 5


def _f(row: dict[str, Any], key: str) -> float:
    try:
        value = row.get(key)
        return 0.0 if value is None else float(value)
    except (TypeError, ValueError):
        return 0.0


@dataclass(frozen=True)
class UnitCost:
    """What one of something costs, and how much we should trust the figure."""

    unit_kind: str
    calls: int
    units: float
    cost_usd: float
    unpriced_calls: int
    configured_calls: int
    #: ``None`` whenever the number would be invented — no units, no priced calls, or too few
    #: calls to be a rate. The gap says which.
    usd_per_unit: float | None
    gap: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "unit_kind": self.unit_kind,
            "calls": self.calls,
            "units": round(self.units, 3),
            "cost_usd": round(self.cost_usd, 6),
            "unpriced_calls": self.unpriced_calls,
            "configured_calls": self.configured_calls,
            "usd_per_unit": None if self.usd_per_unit is None else round(self.usd_per_unit, 8),
            "gap": self.gap,
        }


@dataclass(frozen=True)
class Component:
    """One line of the free-day bill: how many of a thing, at what rate, coming to what."""

    label: str
    unit_kind: str
    units: float
    usd_per_unit: float | None
    usd: float | None
    gap: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "unit_kind": self.unit_kind,
            "units": round(self.units, 3),
            "usd_per_unit": None if self.usd_per_unit is None else round(self.usd_per_unit, 8),
            "usd": None if self.usd is None else round(self.usd, 6),
            "gap": self.gap,
        }


@dataclass(frozen=True)
class FreeDayCost:
    """What one 1x day comes to, split by what consumed it.

    ``usd`` is the sum of the components that could be computed. ``complete`` is False whenever
    any component could not be, and then ``usd`` is a FLOOR — the part of the bill we can see —
    never the bill. A console must render the two together or not at all.
    """

    usd: float | None
    complete: bool
    components: tuple[Component, ...]
    gaps: tuple[str, ...]
    #: How many calls under this figure were priced from a number an OPERATOR TYPED rather than a
    #: vendor's price table. Gemini's text-to-speech publishes no per-second rate, so
    #: ``plexus/media.py`` multiplies ``LEDGER_PRICE_SPOKEN_SECOND_USD`` by the seconds produced —
    #: and a per-unit rate derived back out of that is a restatement of the typed figure, not a
    #: measurement of anything. ``complete`` stays true (nothing is missing) and this says the
    #: figure is only as good as the number in the environment. The two are different facts and
    #: folding them together is how a console starts quietly pricing a plan off its own guess.
    configured_calls: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "usd": None if self.usd is None else round(self.usd, 6),
            "complete": self.complete,
            "components": [c.as_dict() for c in self.components],
            "gaps": list(self.gaps),
            "configured_calls": self.configured_calls,
        }


@dataclass(frozen=True)
class Derivation:
    """Everything the pricing question needs, and the honest holes in it."""

    days: int
    rows: int
    #: The dial set the free-day figure was actually built from (``budget.resolve_plan``). An
    #: unknown plan name falls to ``free``, and the caller has to be told that rather than handed
    #: a free-plan figure wearing the label it asked for.
    plan: str
    per_unit: tuple[UnitCost, ...]
    #: Riders measured over the window: how many spoken seconds and video seconds one generation
    #: actually brought with it.
    attach: dict[str, float]
    free_day: FreeDayCost
    gaps: tuple[str, ...]

    def cost_of(self, unit_kind: str) -> float | None:
        for unit in self.per_unit:
            if unit.unit_kind == unit_kind:
                return unit.usd_per_unit
        return None

    def as_dict(self) -> dict[str, Any]:
        return {
            "days": self.days,
            "rows": self.rows,
            "plan": self.plan,
            "per_unit": [u.as_dict() for u in self.per_unit],
            "attach": {k: round(v, 4) for k, v in self.attach.items()},
            "free_day": self.free_day.as_dict(),
            "gaps": list(self.gaps),
        }


def _unit_costs(rows: list[dict[str, Any]]) -> tuple[UnitCost, ...]:
    totals: dict[str, dict[str, float]] = {}
    for row in rows:
        kind = str(row.get("unit_kind") or "")
        if not kind:
            continue
        bucket = totals.setdefault(
            kind, {"calls": 0.0, "units": 0.0, "cost": 0.0, "unpriced": 0.0, "configured": 0.0}
        )
        bucket["calls"] += _f(row, "calls")
        bucket["units"] += _f(row, "unit_count")
        bucket["cost"] += _f(row, "cost_usd")
        bucket["unpriced"] += _f(row, "unpriced_calls")
        bucket["configured"] += _f(row, "configured_calls")

    out: list[UnitCost] = []
    for kind, bucket in sorted(totals.items()):
        calls = int(bucket["calls"])
        units = bucket["units"]
        cost = bucket["cost"]
        unpriced = int(bucket["unpriced"])
        rate: float | None = None
        gap: str | None = None
        if calls == 0:
            # Delivery-only: seconds of video the learner received, which no provider bills for.
            # The money is on the plan call and the narration rows, and saying "0.00 per second"
            # here would read as "video is free", which is the opposite of true.
            gap = (
                f"no provider charges per {kind}: the cost of it sits on the calls that produced "
                f"it, not on the unit itself"
            )
        elif units <= 0:
            gap = f"{calls} calls recorded against {kind} but no units measured on them"
        elif unpriced >= calls:
            gap = f"none of the {calls} {kind} calls could be priced, so there is no rate to give"
        elif calls < MIN_CALLS_FOR_A_RATE:
            gap = (
                f"only {calls} {kind} call(s) so far — too few to call a rate "
                f"(a rate is reported from {MIN_CALLS_FOR_A_RATE})"
            )
        else:
            rate = cost / units
            if unpriced:
                gap = (
                    f"{unpriced} of {calls} {kind} calls could not be priced, so this rate is a "
                    f"floor rather than the full cost"
                )
            configured = int(bucket["configured"])
            if configured:
                # A rate derived from a configured price is a restatement of that price, not a
                # measurement. The Spend desk already prints "N priced from a figure we entered";
                # the PACING desk is the one an owner will price a plan from, and it said nothing.
                typed = (
                    f"{configured} of {calls} {kind} calls were priced from a figure we entered "
                    f"(no vendor price table covers this unit), so this rate is only as good as "
                    f"that number"
                )
                gap = f"{gap} · {typed}" if gap else typed
        out.append(
            UnitCost(
                unit_kind=kind,
                calls=calls,
                units=units,
                cost_usd=cost,
                unpriced_calls=unpriced,
                configured_calls=int(bucket["configured"]),
                usd_per_unit=rate,
                gap=gap,
            )
        )
    return tuple(out)


def _attach_rates(per_unit: tuple[UnitCost, ...]) -> dict[str, float]:
    """Spoken seconds and video seconds observed PER GENERATION over the window.

    Measured, not assumed. A narrated explainer's audio is billed on its own capability, so
    without this the free-day figure would quietly leave the narration off the bill.
    """
    units = {u.unit_kind: u.units for u in per_unit}
    generations = units.get(ledger.GENERATION, 0.0)
    if generations <= 0:
        return {}
    rates: dict[str, float] = {}
    for kind in (ledger.SPOKEN_SECOND, ledger.VIDEO_SECOND):
        seconds = units.get(kind, 0.0)
        if seconds > 0:
            rates[kind] = seconds / generations
    return rates


def _free_day(
    per_unit: tuple[UnitCost, ...], attach: dict[str, float], limits: dict[str, int]
) -> FreeDayCost:
    by_kind = {u.unit_kind: u for u in per_unit}
    turns = float(limits.get(budget.TURN, 0))
    generations = float(limits.get(budget.GENERATION, 0))

    plan: list[tuple[str, str, float]] = [
        ("turns", ledger.TURN, turns),
        ("generations", ledger.GENERATION, generations),
    ]
    for kind, rider in attach.items():
        label = "narration seconds" if kind == ledger.SPOKEN_SECOND else "video seconds"
        plan.append((f"{label} riding on those generations", kind, generations * rider))

    components: list[Component] = []
    gaps: list[str] = []
    running = 0.0
    complete = True
    for label, kind, count in plan:
        unit = by_kind.get(kind)
        if unit is None:
            complete = False
            gaps.append(
                f"nothing recorded against {kind} yet, so its share of a free day is unknown"
            )
            components.append(Component(label, kind, count, None, None, "no rows yet"))
            continue
        if unit.usd_per_unit is None:
            complete = False
            if unit.gap:
                gaps.append(unit.gap)
            components.append(Component(label, kind, count, None, None, unit.gap))
            continue
        usd = count * unit.usd_per_unit
        running += usd
        components.append(Component(label, kind, count, unit.usd_per_unit, usd, unit.gap))
        if unit.gap:
            gaps.append(unit.gap)

    priced = [c for c in components if c.usd is not None]
    # Only the components that actually went INTO the figure: a kind with no rows contributed
    # nothing, so its (zero) configured calls are not a caveat on this number.
    configured = sum(
        by_kind[c.unit_kind].configured_calls
        for c in components
        if c.usd is not None and c.unit_kind in by_kind
    )
    return FreeDayCost(
        usd=running if priced else None,
        complete=complete and bool(priced),
        components=tuple(components),
        gaps=tuple(dict.fromkeys(gaps)),
        configured_calls=configured,
    )


def derive(rows: list[dict[str, Any]] | None, *, plan: str = "free") -> Derivation:
    """The whole derivation over a window of ``ops.usage_daily`` rows.

    ``rows`` of ``None`` means the ledger could not be READ, which is a different answer from an
    empty ledger and is reported as its own gap. ``[]`` means nothing has been recorded yet, which
    on the day this ships is the true state of the world and the only correct thing to show.
    """
    resolved = budget.resolve_plan(plan)
    limits = budget.limits_for(resolved)
    asked = (plan or "free").strip().lower()
    # The route echoed whatever string it was handed, so a request for a plan nobody has configured
    # came back as a FREE-plan figure wearing that plan's name. Said once, here, so it is said on
    # every path out of this function including the one where the ledger could not be read at all.
    plan_gaps: tuple[str, ...] = (
        (
            f"there are no allowance dials for a plan called {asked!r}, so this is the {resolved} "
            f"plan's day priced at the rates measured, not that plan's",
        )
        if resolved != asked
        else ()
    )
    if rows is None:
        unread = "the usage ledger could not be read, so nothing here is a number"
        empty = FreeDayCost(usd=None, complete=False, components=(), gaps=(unread,))
        return Derivation(
            days=0,
            rows=0,
            plan=resolved,
            per_unit=(),
            attach={},
            free_day=empty,
            gaps=(*plan_gaps, unread),
        )

    per_unit = _unit_costs(rows)
    attach = _attach_rates(per_unit)
    free_day = _free_day(per_unit, attach, limits)
    days = len({str(r.get("day")) for r in rows if r.get("day")})

    gaps: list[str] = list(plan_gaps)
    if not rows:
        gaps.append(
            "the usage ledger is empty: no model call has been recorded yet, so there is nothing "
            "to derive a cost from"
        )
    elif days < 2:
        gaps.append(
            "only one day of usage has been recorded, so every rate here is one day's weather "
            "rather than a climate"
        )
    if not attach and any(u.unit_kind == ledger.GENERATION for u in per_unit):
        gaps.append(
            "no narration or video seconds have been recorded against a generation yet, so a free "
            "day's bill carries no rider for them"
        )
    gaps.extend(free_day.gaps)

    return Derivation(
        days=days,
        rows=len(rows),
        plan=resolved,
        per_unit=per_unit,
        attach=attach,
        free_day=free_day,
        gaps=tuple(dict.fromkeys(gaps)),
    )


def derive_window(*, since: date, until: date, plan: str = "free") -> Derivation:
    """The derivation over a live window, read straight from the ledger."""
    return derive(ledger.read_daily(since=since, until=until), plan=plan)


__all__ = [
    "MIN_CALLS_FOR_A_RATE",
    "Component",
    "Derivation",
    "FreeDayCost",
    "UnitCost",
    "derive",
    "derive_window",
]
