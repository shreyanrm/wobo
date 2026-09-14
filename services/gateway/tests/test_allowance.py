"""The money meter: a day's allowance in paise, debited by what the models actually cost.

docs/ALLOWANCE.md §1 and §4.1, §4.2, §4.6. Every number here is arithmetic the owner stated —
plan amount x generosity / the days in the learner's own month — and every assertion is to the
PAISA, because a meter that is approximately right is a meter that is wrong on some learner's
last question of the day.

Nothing in this file asserts a currency on a learner surface. That is the other half of the law
(``test_no_money_reaches_the_learner``): the rupees live in this module's arithmetic and on the
owner's desk, and ``/v1/me`` carries a fraction and a time and nothing else.
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest
from wobo_gateway import allowance, budget, dials, doors, ledger


def _dial(key: str, value: object) -> None:
    """Turn a dial the way the console does — a row in ``ops.settings``, nothing restarted."""
    doors.get_store().write(key, value, actor=None, note="a test")
    allowance.apply()


# --- the arithmetic, to the paisa -----------------------------------------------------------
@pytest.mark.parametrize(
    "plan,period,days,expected",
    [
        # Pro monthly: ₹1,999 x 0.25 = ₹499.75 a month; over 30 days, ₹16.66 a day.
        ("pro", "monthly", 30, 16_66),
        # Pro yearly: ₹19,992 a year is ₹1,666 a month (PRICING.md, a year costs ten months);
        # x 0.25 = ₹416.50; over 30 days, ₹13.88 — the figure in docs/ALLOWANCE.md §1.
        ("pro", "yearly", 30, 13_88),
        # Max monthly: ₹3,999 x 0.25 = ₹999.75; over 30 days, ₹33.32.
        ("max", "monthly", 30, 33_32),
        # Max yearly: ₹39,996 a year is ₹3,333 a month; x 0.25 = ₹833.25; over 30, ₹27.78.
        ("max", "yearly", 30, 27_78),
        # ``plus`` is the name Pro shipped under and must land on Pro's numbers.
        ("plus", "monthly", 30, 16_66),
    ],
)
def test_the_daily_allowance_is_exact(plan: str, period: str, days: int, expected: int) -> None:
    assert allowance.daily_paise(plan, period=period, days_in_month=days) == expected


def test_pro_monthly_is_sixteen_sixty_six() -> None:
    """Spelled out once, so the parametrised table above cannot drift unnoticed."""
    assert allowance.daily_paise("pro", period="monthly", days_in_month=30) == 1666


@pytest.mark.parametrize(
    "days,expected",
    [(28, 17_85), (30, 16_66), (31, 16_12)],
)
def test_a_short_month_buys_a_bigger_day(days: int, expected: int) -> None:
    """₹499.75 spread over February is more a day than over March, and the meter says so."""
    assert allowance.daily_paise("pro", period="monthly", days_in_month=days) == expected


def test_the_free_plan_is_its_own_dial_and_not_a_fraction_of_anything() -> None:
    """Five rupees a day, whatever the month is worth (docs/ALLOWANCE.md, the free tier)."""
    for days in (28, 30, 31):
        assert allowance.daily_paise("free", days_in_month=days) == 500


def test_an_unknown_plan_falls_to_free() -> None:
    assert allowance.daily_paise("enterprise", days_in_month=30) == 500


def test_generosity_is_the_only_fraction_in_it() -> None:
    """The owner doubles the fraction; the day doubles, and nothing else moves."""
    assert allowance.daily_paise("pro", period="monthly", days_in_month=30) == 1666
    _dial(allowance.DIAL_GENEROSITY, {"pro": 0.5})
    assert allowance.daily_paise("pro", period="monthly", days_in_month=30) == 3332
    assert allowance.daily_paise("free", days_in_month=30) == 500


# --- the day boundary is the learner's own ---------------------------------------------------
def test_the_day_turns_over_at_local_midnight_in_kolkata() -> None:
    allowance.note_zone("sub:k", "Asia/Kolkata")
    # 18:35 UTC is 00:05 the next day in Kolkata: a new day, and a full meter.
    late = datetime(2026, 9, 11, 18, 35, tzinfo=UTC)
    meter = allowance.state("sub:k", "free", now=late)
    assert meter.day.isoformat() == "2026-09-12"
    assert meter.resets_at == datetime(2026, 9, 13, tzinfo=ZoneInfo("Asia/Kolkata"))


def test_the_day_turns_over_at_local_midnight_west_of_utc() -> None:
    """New York is behind UTC, so its day turns over hours after the UTC one has."""
    allowance.note_zone("sub:n", "America/New_York")
    # 02:00 UTC on the 12th is 22:00 on the 11th in New York — still the 11th's allowance.
    moment = datetime(2026, 9, 12, 2, 0, tzinfo=UTC)
    meter = allowance.state("sub:n", "free", now=moment)
    assert meter.day.isoformat() == "2026-09-11"
    assert meter.resets_at == datetime(2026, 9, 12, tzinfo=ZoneInfo("America/New_York"))


def test_the_zone_is_the_first_one_sent_that_day_and_never_the_clients_day() -> None:
    """The device says WHERE it is; the server decides WHEN the day turns over."""
    allowance.note_zone("sub:z", "Asia/Kolkata")
    allowance.note_zone("sub:z", "America/New_York")  # same day: the first one stands
    assert allowance.zone_name("sub:z") == "Asia/Kolkata"


def test_a_nonsense_zone_is_ignored_rather_than_believed() -> None:
    allowance.note_zone("sub:junk", "Mars/Olympus")
    assert allowance.zone_name("sub:junk") == "UTC"


def test_the_family_record_wins_over_the_device() -> None:
    allowance.note_zone("sub:f", "America/New_York")
    allowance.set_zone_resolver(lambda key: "Asia/Kolkata" if key == "sub:f" else None)
    assert allowance.zone_name("sub:f") == "Asia/Kolkata"


def test_the_family_record_is_read_from_the_family_row() -> None:
    """Not a seam a caller has to remember to wire: the row is read, and cached, by default."""
    from dataclasses import replace

    from wobo_gateway.hospitality import preferences

    store = preferences.InMemoryPreferencesStore()
    store.put("fam", replace(preferences.DEFAULT_PREFERENCES, timezone="Asia/Kolkata"))
    preferences.set_store(store)
    try:
        allowance.note_zone("sub:fam", "America/New_York")
        assert allowance.zone_name("sub:fam") == "Asia/Kolkata"
    finally:
        preferences.set_store(None)


def test_an_unreachable_family_row_falls_back_to_the_device() -> None:
    """A database blink must move nobody's midnight, and must never raise on a turn."""

    class Broken:
        def get(self, learner_id: str):  # noqa: ANN201
            raise preferences_module.StoreUnavailable("down")

    from wobo_gateway.hospitality import preferences as preferences_module

    preferences_module.set_store(Broken())
    try:
        allowance.note_zone("sub:broken", "Asia/Kolkata")
        assert allowance.zone_name("sub:broken") == "Asia/Kolkata"
    finally:
        preferences_module.set_store(None)


# --- the debit comes from real ledger rows ---------------------------------------------------
def _row(cost: float, capability: str = "wobo.turn", **extra: object) -> None:
    with ledger.calling(plan="free", meter_key="sub:l"):
        ledger.record(capability=capability, cost_usd=cost, model_served="openai/x", **extra)


def test_a_ledger_row_debits_the_meter() -> None:
    _dial(allowance.DIAL_INR_PER_USD, 100)
    _row(0.01)  # one cent, a rupee at this rate, a hundred paise
    meter = allowance.state("sub:l", "free")
    assert round(meter.used_paise, 6) == 100.0
    assert meter.allowance_paise == 500
    assert meter.used == pytest.approx(0.2)


def test_a_cache_hit_costs_the_learner_nothing() -> None:
    _dial(allowance.DIAL_INR_PER_USD, 100)
    _row(None, cache_hit=True)  # type: ignore[arg-type]
    assert allowance.state("sub:l", "free").used_paise == 0.0


def test_the_creative_pool_is_never_on_a_learners_day() -> None:
    """``registry.platform_paid`` is asked before anything is counted (docs/ALLOWANCE.md)."""
    _dial(allowance.DIAL_INR_PER_USD, 100)
    _row(0.05, capability="create.core")
    assert allowance.state("sub:l", "free").used_paise == 0.0


def test_the_platforms_own_jobs_are_not_a_learners_day() -> None:
    with ledger.calling(plan="free", meter_key="system:curriculum-discovery"):
        ledger.record(capability="curriculum.discovery", cost_usd=1.0)
    assert allowance.state("system:curriculum-discovery", "free").used_paise == 0.0


def test_nothing_carries_forward() -> None:
    _dial(allowance.DIAL_INR_PER_USD, 100)
    monday = datetime(2026, 9, 11, 6, 0, tzinfo=UTC)
    tuesday = datetime(2026, 9, 12, 6, 0, tzinfo=UTC)
    allowance.debit("sub:c", cost_usd=0.02, capability="wobo.turn", occurred_at=monday)
    assert allowance.state("sub:c", "free", now=monday).used_paise == 200.0
    # A new day is a new meter — and an unused day is gone, not banked.
    assert allowance.state("sub:c", "free", now=tuesday).used_paise == 0.0
    assert allowance.state("sub:c", "free", now=tuesday).allowance_paise == 500


# --- what the learner meets ------------------------------------------------------------------
def test_the_money_meter_refuses_before_the_counters_do() -> None:
    """The learner meets the money first; the counters stay as abuse caps far above it."""
    _dial(allowance.DIAL_INR_PER_USD, 100)
    allowance.debit("sub:spent", cost_usd=0.05, capability="wobo.turn")  # ₹5, the whole free day
    with pytest.raises(budget.BudgetExhausted) as raised:
        budget.charge("sub:spent", "wobo.turn")
    # The same honest line the counters give, and no price anywhere in it.
    assert raised.value.message == budget._EXHAUSTED[budget.TURN]
    assert "₹" not in raised.value.message and "rupee" not in raised.value.message.lower()


def test_a_spent_day_still_leaves_the_counters_untouched() -> None:
    _dial(allowance.DIAL_INR_PER_USD, 100)
    allowance.debit("sub:spent2", cost_usd=0.05, capability="wobo.turn")
    with pytest.raises(budget.BudgetExhausted):
        budget.charge("sub:spent2", "wobo.turn")
    assert budget.snapshot("sub:spent2").turns_remaining == 40


def test_a_paid_learner_gets_a_bigger_day_from_the_same_arithmetic() -> None:
    _dial(allowance.DIAL_INR_PER_USD, 100)
    allowance.debit("sub:paid", cost_usd=0.05, capability="wobo.turn")
    # ₹5 is the free day, and a fraction of Pro's: nothing is refused.
    budget.charge("sub:paid", "wobo.turn", "pro")


def test_the_creative_pool_is_served_even_on_a_spent_day() -> None:
    _dial(allowance.DIAL_INR_PER_USD, 100)
    allowance.debit("sub:spent3", cost_usd=0.05, capability="wobo.turn")
    budget.charge("sub:spent3", "create.core")


# --- a dial moves without a restart ----------------------------------------------------------
def test_a_changed_dial_changes_the_very_next_call() -> None:
    assert allowance.state("sub:d", "free").allowance_paise == 500
    _dial(allowance.DIAL_FREE_DAILY_PAISE, 1_500)
    assert allowance.state("sub:d", "free").allowance_paise == 1500


def test_a_changed_dial_is_followed_within_a_minute_without_being_told() -> None:
    """No ``apply`` call: the gateway re-reads on its own interval (docs/CONSOLE-MODELS.md)."""
    clock = {"t": 1_000.0}
    allowance.set_clock(lambda: clock["t"])
    assert allowance.state("sub:e", "free").allowance_paise == 500
    doors.get_store().write(allowance.DIAL_FREE_DAILY_PAISE, 2_000, actor=None, note=None)
    assert allowance.state("sub:e", "free").allowance_paise == 500  # still cached
    clock["t"] += allowance.MAX_REFRESH_S + 1
    assert allowance.state("sub:e", "free").allowance_paise == 2000
    assert allowance.refresh_interval_s() <= 60.0


def test_the_meter_and_the_desk_read_one_set_of_dials() -> None:
    """Two readers of the same rows would drift for a minute after every console write."""
    _dial(allowance.DIAL_FREE_DAILY_PAISE, 700)
    assert dials.free_daily_paise() == 700
    assert allowance.state("sub:one", "free").allowance_paise == 700


def test_a_broken_dial_falls_back_to_the_default_rather_than_to_zero() -> None:
    """A meter that reads a typo as "no allowance" locks every learner out of their own day."""
    _dial(allowance.DIAL_FREE_DAILY_PAISE, "five hundred")
    assert allowance.state("sub:g", "free").allowance_paise == 500


# --- what /v1/me carries ----------------------------------------------------------------------
def test_me_carries_a_fraction_and_a_time_and_no_money(auth, monkeypatch) -> None:
    from fastapi.testclient import TestClient
    from wobo_gateway.app import Gateway, create_app
    from wobo_gateway.cache import InMemoryCache
    from wobo_gateway.providers import MockProvider
    from wobo_gateway.telemetry import MetricsSink

    _dial(allowance.DIAL_INR_PER_USD, 100)
    allowance.debit("sub:me-learner", cost_usd=0.01, capability="wobo.turn")
    client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
    body = client.get(
        "/v1/me",
        headers={**auth("me-learner"), "X-Wobo-Timezone": "Asia/Kolkata"},
    ).json()

    assert set(body["allowance"]) == {"used", "resets_at"}
    assert body["allowance"]["used"] == pytest.approx(0.2)
    assert body["allowance"]["resets_at"].startswith("20")
    flat = str(body)
    for forbidden in ("₹", "paise", "rupee", "usd", "inr", "price", "cost"):
        assert forbidden not in flat.lower()
