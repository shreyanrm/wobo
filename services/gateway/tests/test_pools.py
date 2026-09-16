"""The two pools the platform pays for itself: the creative pool, and the free pool.

``docs/ALLOWANCE.md``, "Best of both worlds" point 4 — *"the owner's exposure is bounded twice.
Per learner by the daily allowance ... and in total by a free pool cap on the console: the day's
spend on free learners, with a dial and an alert, so growth cannot outrun the money"* — and
``docs/CONSOLE-MODELS.md``, "The creative pool": *"the platform's own daily cap for it (default
40 USD, its own dial, its own alert at 50/80/100 percent)"*.

WHAT WAS ACTUALLY MISSING. Migration 0030 seeded both dials and wrote the alert thresholds into
its own comments; ``dials.py`` read them; the models desk PRINTED the creative pool's cap and the
free pool's. Nothing anywhere accumulated either pool, nothing compared a day against a cap, and
no alert had ever been wired: ``alerts.EVENTS`` had no pool event in it. So both caps were
numbers on a screen, and the sentence "growth cannot outrun the money" was false — a free lane
could have run all night against a cap that was never once read.

The three things proved here:

1. **The day accumulates, on the right pool.** A platform-paid capability goes to the creative
   pool whatever plan the learner who triggered it is on; a free learner's metered call goes to
   the free pool; a paid learner's goes to neither, because a paid learner's spend is their own
   allowance and not the platform's goodwill.
2. **The alerts fire once each at 50, 80 and 100 percent**, and carry which pool crossed.
3. **The cap refuses with the KIND LINE and never with a number.** docs/ALLOWANCE.md, point 3:
   *"When the day is spent, Wobo says one kind line and offers tomorrow or more, never a thinner
   answer."* It is the same ``budget.BudgetExhausted`` the counters and the per-learner allowance
   already raise, because there is exactly one honest refusal in this product and a child is
   never told a price.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from wobo_gateway import alerts, allowance, budget, dials, doors, ledger, pools


@pytest.fixture(autouse=True)
def _pool_env() -> None:
    doors.set_store(doors.InMemorySettingsStore())
    dials.reset()
    pools.reset()
    yield
    doors.set_store(None)
    dials.reset()
    pools.reset()


@pytest.fixture()
def paged(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """The alarm, recorded inline instead of posted (the pattern ``test_alerts`` established)."""
    sent: list[dict] = []
    monkeypatch.setenv("ALERT_WEBHOOK_URL", "https://hooks.example/wobo")
    monkeypatch.setenv("ALERT_COOLDOWN_SECONDS", "0")
    alerts.set_sender(lambda url, payload: sent.append({"url": url, **payload}))
    alerts.set_runner(lambda go: go())
    return sent


def _dial(key: str, value: object) -> None:
    doors.get_store().write(key, value, actor=None, note=None)
    dials.apply(force=True)


def _row(cost: float, *, plan: str = "free", capability: str = "wobo.turn") -> None:
    """One real ledger row, through the one funnel every priced call already passes through."""
    with ledger.calling(plan=plan, meter_key=f"sub:{plan}-learner"):
        ledger.record(capability=capability, cost_usd=cost, model_served="openai/x")


# --- 1. the day accumulates, on the right pool ------------------------------------------------
def test_a_platform_paid_call_lands_on_the_creative_pool() -> None:
    """``registry.platform_paid`` is asked FIRST: the blueprint and the concept cores are the
    platform's whatever plan the learner who triggered them is on. That is the ruling itself."""
    _row(0.40, plan="pro", capability="create.core")
    assert pools.creative_state().spent_usd == pytest.approx(0.40)
    assert pools.free_state().spent_paise == 0.0


def test_a_free_learners_call_lands_on_the_free_pool() -> None:
    _dial(dials.INR_RATE_KEY, 100)
    _row(0.01)  # a cent, a rupee at this rate
    assert pools.free_state().spent_paise == pytest.approx(100.0)
    assert pools.creative_state().spent_usd == 0.0


def test_a_paid_learners_call_is_on_neither_pool() -> None:
    """A paid learner's spend is the allowance they bought. The free pool measures GOODWILL, and
    counting a payer's turn in it would make the goodwill figure meaningless."""
    _dial(dials.INR_RATE_KEY, 100)
    _row(0.05, plan="pro")
    assert pools.free_state().spent_paise == 0.0
    assert pools.creative_state().spent_usd == 0.0


def test_a_cache_hit_costs_neither_pool() -> None:
    """The whole reason a free day is affordable: the second learner to open a cell pays nothing,
    and so does the platform."""
    with ledger.calling(plan="free", meter_key="sub:x"):
        ledger.record(capability="wobo.turn", cost_usd=None, cache_hit=True)
    assert pools.free_state().spent_paise == 0.0


def test_nothing_carries_forward_into_tomorrow() -> None:
    monday = datetime(2026, 9, 14, 6, 0, tzinfo=UTC)
    tuesday = datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
    _dial(dials.INR_RATE_KEY, 100)
    pools.note(
        capability="wobo.turn",
        plan="free",
        cost_usd=0.02,
        meter_key="sub:l",
        occurred_at=monday,
    )
    assert pools.free_state(now=monday).spent_paise == pytest.approx(200.0)
    assert pools.free_state(now=tuesday).spent_paise == 0.0


# --- 2. the alerts ----------------------------------------------------------------------------
def test_the_creative_pool_alerts_at_fifty_eighty_and_a_hundred(paged: list[dict]) -> None:
    _dial(dials.CREATIVE_POOL_KEY, 10.0)
    for _ in range(10):
        _row(1.0, plan="pro", capability="create.core")
    crossed = [
        item["fields"]["threshold"] for item in paged if item["event"] == alerts.POOL_THRESHOLD
    ]
    assert crossed == [0.5, 0.8, 1.0]
    assert {
        item["fields"]["pool"] for item in paged if item["event"] == alerts.POOL_THRESHOLD
    } == {"creative"}


def test_the_free_pool_alerts_at_the_same_three_fractions(paged: list[dict]) -> None:
    _dial(dials.INR_RATE_KEY, 100)
    _dial(dials.FREE_POOL_KEY, 1_000)  # ten rupees of goodwill for the whole day
    for _ in range(10):
        _row(0.01)  # a rupee each
    crossed = [
        item["fields"]["threshold"]
        for item in paged
        if item["event"] == alerts.POOL_THRESHOLD and item["fields"]["pool"] == "free"
    ]
    assert crossed == [0.5, 0.8, 1.0]


def test_each_threshold_pages_once_and_not_on_every_call_after_it(paged: list[dict]) -> None:
    """An alarm that repeats every call past the line is an alarm that gets muted."""
    _dial(dials.CREATIVE_POOL_KEY, 1.0)
    for _ in range(20):
        _row(1.0, plan="pro", capability="create.core")
    assert len([i for i in paged if i["event"] == alerts.POOL_THRESHOLD]) == 3


def test_an_unset_free_cap_is_not_a_cap_of_zero(paged: list[dict]) -> None:
    """docs/ALLOWANCE.md gives this dial no default and migration 0030 seeds it null. Null means
    NO CAP HAS BEEN SET — not zero, which would close the free lane on every learner at once."""
    _dial(dials.INR_RATE_KEY, 100)
    _row(5.0)
    assert pools.free_state().cap_paise is None
    assert pools.free_state().fraction is None
    assert [i for i in paged if i["event"] == alerts.POOL_THRESHOLD] == []
    assert pools.free_pool_spent() is False


# --- 3. the cap, and the kind line ------------------------------------------------------------
def test_a_spent_free_pool_refuses_a_free_learner_with_the_kind_line() -> None:
    _dial(dials.INR_RATE_KEY, 100)
    _dial(dials.FREE_POOL_KEY, 500)  # five rupees for every free learner together
    _row(0.06)  # six rupees: the pool is gone
    assert pools.free_pool_spent() is True
    with pytest.raises(budget.BudgetExhausted) as raised:
        budget.charge("sub:another-free-learner", "wobo.turn", "free")
    # ONE honest refusal, and no price anywhere in it.
    assert raised.value.message == budget._EXHAUSTED[budget.TURN]
    said = raised.value.message.lower()
    for forbidden in ("₹", "rupee", "paise", "usd", "cap", "pool", "budget"):
        assert forbidden not in said, forbidden
    assert not any(ch.isdigit() for ch in raised.value.message)


def test_a_spent_free_pool_never_touches_a_paying_learner() -> None:
    """The free pool bounds the platform's GOODWILL. A learner who paid is owed their day
    whatever the free lane has cost today, and a cap that refused them would be a refund."""
    _dial(dials.INR_RATE_KEY, 100)
    _dial(dials.FREE_POOL_KEY, 500)
    _row(0.06)
    budget.charge("sub:paid-learner", "wobo.turn", "pro")


def test_a_spent_free_pool_still_serves_the_work_the_platform_pays_for() -> None:
    """Platform-paid work is the creative pool's, and it has its own cap. A free learner meeting
    the free pool's ceiling must not stop a concept core being made for everybody."""
    _dial(dials.INR_RATE_KEY, 100)
    _dial(dials.FREE_POOL_KEY, 500)
    _row(0.06)
    budget.charge("sub:free-learner", "create.core", "free")


def test_the_per_learner_allowance_still_refuses_first_when_it_is_the_smaller_bound() -> None:
    """Two bounds, and the learner meets whichever is tighter. With a generous pool and a spent
    day it is the day; the line is the same either way, which is the point of one refusal."""
    _dial(dials.INR_RATE_KEY, 100)
    _dial(dials.FREE_POOL_KEY, 1_000_000)
    allowance.debit("sub:spent-day", cost_usd=0.05, capability="wobo.turn")
    with pytest.raises(budget.BudgetExhausted):
        budget.charge("sub:spent-day", "wobo.turn", "free")


# --- 4. what the desk reads -------------------------------------------------------------------
def test_both_pools_serialise_for_the_desk_without_inventing_a_figure() -> None:
    _dial(dials.INR_RATE_KEY, 100)
    _dial(dials.CREATIVE_POOL_KEY, 40.0)
    view = pools.view()
    assert view["creative"]["cap_usd"] == 40.0
    assert view["creative"]["spent_usd"] == 0.0
    # No cap set: the fraction is None rather than 0.0, which would read as "none of it used".
    assert view["free"]["cap_paise"] is None
    assert view["free"]["fraction"] is None
    assert view["alert_fractions"] == list(dials.ALERT_FRACTIONS)
