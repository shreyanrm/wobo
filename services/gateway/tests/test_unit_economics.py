"""What one free day costs — the derivation, and every hole it refuses to fill.

The owner will price a product on this number, so the tests that matter most are the ones that
prove it does NOT produce a number when it has no business producing one: an empty ledger, an
unpriced model, a unit nobody bills per, one call's worth of evidence. Each of those returns
``None`` and a sentence, never a zero and a chart.
"""

from __future__ import annotations

from typing import Any

import pytest
from wobo_gateway import budget, ledger, unit_economics


def row(
    *,
    day: str = "2026-09-04",
    capability: str = "wobo.turn",
    model: str = "anthropic/claude-x",
    plan: str = "free",
    unit_kind: str = ledger.TURN,
    calls: int = 10,
    cost: float = 0.10,
    units: float = 10,
    unpriced: int = 0,
    configured: int = 0,
) -> dict[str, Any]:
    """One ``ops.usage_daily`` row, in the shape PostgREST returns it."""
    return {
        "day": day,
        "capability": capability,
        "model_served": model,
        "plan": plan,
        "unit_kind": unit_kind,
        "calls": calls,
        "cache_hits": 0,
        "fallback_calls": 0,
        "anonymous_calls": 0,
        "unpriced_calls": unpriced,
        "configured_calls": configured,
        "tokens_in": 100,
        "tokens_out": 50,
        "cost_usd": cost,
        "unit_count": units,
        "latency_ms_total": 1000,
    }


# --- the refusals ---------------------------------------------------------------------------------
def test_an_empty_ledger_derives_nothing_and_says_why() -> None:
    """The state of the world on the day this ships. A zero here would be a lie a decision is
    made on."""
    out = unit_economics.derive([])
    assert out.rows == 0
    assert out.free_day.usd is None
    assert out.free_day.complete is False
    assert any("empty" in gap for gap in out.gaps)


def test_a_ledger_that_could_not_be_read_is_not_an_empty_one() -> None:
    out = unit_economics.derive(None)
    assert out.free_day.usd is None
    assert any("could not be read" in gap for gap in out.gaps)


def test_a_unit_nobody_could_price_gets_no_rate(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [row(unit_kind=ledger.SPOKEN_SECOND, calls=20, unpriced=20, cost=0.0, units=600)]
    out = unit_economics.derive(rows)
    spoken = next(u for u in out.per_unit if u.unit_kind == ledger.SPOKEN_SECOND)
    assert spoken.usd_per_unit is None
    assert "no rate to give" in (spoken.gap or "")


def test_one_call_is_an_anecdote_and_not_a_rate() -> None:
    out = unit_economics.derive([row(calls=1, units=1, cost=0.9)])
    turn = next(u for u in out.per_unit if u.unit_kind == ledger.TURN)
    assert turn.usd_per_unit is None
    assert "too few" in (turn.gap or "")


def test_a_delivery_only_unit_is_not_reported_as_free() -> None:
    """No provider bills per second of finished video. ``0.00 per second`` would read as "video
    costs nothing", which is the opposite of the truth: it costs its plan plus its narration."""
    rows = [row(unit_kind=ledger.VIDEO_SECOND, calls=0, cost=0.0, units=480)]
    out = unit_economics.derive(rows)
    video = next(u for u in out.per_unit if u.unit_kind == ledger.VIDEO_SECOND)
    assert video.usd_per_unit is None
    assert "no provider charges per video_second" in (video.gap or "")


def test_a_partly_unpriced_unit_reports_its_rate_as_a_floor() -> None:
    out = unit_economics.derive([row(calls=20, unpriced=5, cost=1.5, units=20)])
    turn = next(u for u in out.per_unit if u.unit_kind == ledger.TURN)
    assert turn.usd_per_unit == pytest.approx(0.075)
    assert "floor" in (turn.gap or "")


# --- the arithmetic -------------------------------------------------------------------------------
def test_cost_per_unit_is_money_over_units_not_money_over_calls() -> None:
    """A spoken answer is billed by the second, not by the request: ten calls carrying 600
    seconds cost 0.001 a second, not 0.06 a call."""
    rows = [row(unit_kind=ledger.SPOKEN_SECOND, calls=10, cost=0.60, units=600)]
    out = unit_economics.derive(rows)
    assert out.cost_of(ledger.SPOKEN_SECOND) == pytest.approx(0.001)


def test_the_free_day_is_the_meters_own_allowance_priced_from_the_ledger() -> None:
    """The allowance comes from ``budget.limits_for``, the same function the meter enforces, so
    this can never drift from what a learner is actually given."""
    limits = budget.limits_for("free")
    rows = [
        row(unit_kind=ledger.TURN, calls=100, cost=1.00, units=100),          # 0.01 a turn
        row(capability="engine.explain", unit_kind=ledger.GENERATION,
            calls=20, cost=4.00, units=20),                                    # 0.20 a generation
    ]
    out = unit_economics.derive(rows)
    expected = limits[budget.TURN] * 0.01 + limits[budget.GENERATION] * 0.20
    assert out.free_day.usd == pytest.approx(expected)
    assert [c.unit_kind for c in out.free_day.components] == [ledger.TURN, ledger.GENERATION]


def test_the_narration_that_rides_on_a_generation_is_measured_and_billed_with_it() -> None:
    """A narrated explainer's audio is a separate capability on a separate row. Without the
    attach rate, a free day's bill would silently leave the narration off it."""
    limits = budget.limits_for("free")
    rows = [
        row(unit_kind=ledger.TURN, calls=100, cost=1.00, units=100),
        row(capability="engine.video", unit_kind=ledger.GENERATION,
            calls=20, cost=4.00, units=20),
        # 20 generations brought 1200 spoken seconds with them: 60 seconds each.
        row(capability="voice.narration", unit_kind=ledger.SPOKEN_SECOND,
            calls=200, cost=1.20, units=1200),
    ]
    out = unit_economics.derive(rows)
    assert out.attach[ledger.SPOKEN_SECOND] == pytest.approx(60.0)

    spoken_rate = 1.20 / 1200
    expected = (
        limits[budget.TURN] * 0.01
        + limits[budget.GENERATION] * 0.20
        + limits[budget.GENERATION] * 60.0 * spoken_rate
    )
    assert out.free_day.usd == pytest.approx(expected)
    narration = next(
        c for c in out.free_day.components if c.unit_kind == ledger.SPOKEN_SECOND
    )
    assert narration.units == pytest.approx(limits[budget.GENERATION] * 60.0)


def test_a_free_day_missing_a_component_is_a_floor_and_says_so() -> None:
    """Turns are priced, generations are not. The sum that CAN be computed is still worth
    showing — but never as though it were the bill."""
    rows = [
        row(unit_kind=ledger.TURN, calls=100, cost=1.00, units=100),
        row(capability="engine.explain", unit_kind=ledger.GENERATION,
            calls=20, unpriced=20, cost=0.0, units=20),
    ]
    out = unit_economics.derive(rows)
    assert out.free_day.usd == pytest.approx(budget.limits_for("free")[budget.TURN] * 0.01)
    assert out.free_day.complete is False
    assert out.free_day.gaps


def test_a_paid_plan_prices_its_own_larger_allowance() -> None:
    rows = [row(unit_kind=ledger.TURN, calls=100, cost=1.00, units=100)]
    free = unit_economics.derive(rows, plan="free")
    pro = unit_economics.derive(rows, plan="pro")
    assert pro.free_day.usd is not None and free.free_day.usd is not None
    assert pro.free_day.usd > free.free_day.usd


def test_one_day_of_evidence_is_flagged_as_one_day_of_weather() -> None:
    out = unit_economics.derive([row(day="2026-09-04", calls=50, cost=0.5, units=50)])
    assert out.days == 1
    assert any("one day" in gap for gap in out.gaps)
    two = unit_economics.derive(
        [
            row(day="2026-09-03", calls=50, cost=0.5, units=50),
            row(day="2026-09-04", calls=50, cost=0.5, units=50),
        ]
    )
    assert two.days == 2
    assert not any("one day" in gap for gap in two.gaps)


def test_operator_entered_money_is_carried_through_to_the_console() -> None:
    """A figure resting partly on somebody's typed-in price must never be shown as a quote."""
    rows = [row(unit_kind=ledger.SPOKEN_SECOND, calls=10, cost=0.6, units=600, configured=10)]
    out = unit_economics.derive(rows)
    spoken = next(u for u in out.per_unit if u.unit_kind == ledger.SPOKEN_SECOND)
    assert spoken.configured_calls == 10
    assert spoken.as_dict()["configured_calls"] == 10


def test_the_whole_derivation_serialises_for_a_screen() -> None:
    out = unit_economics.derive([row(calls=50, cost=0.5, units=50)])
    body = out.as_dict()
    assert set(body) == {"days", "rows", "plan", "per_unit", "attach", "free_day", "gaps"}
    # The plan the figure was BUILT from, not the string somebody asked for.
    assert body["plan"] == "free"
    assert set(body["free_day"]) == {
        "usd",
        "complete",
        "components",
        "gaps",
        # How much of this figure rests on a price an operator TYPED rather than a vendor's table.
        "configured_calls",
    }
