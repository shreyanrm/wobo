"""The settings reader: ops.settings -> routing.configure(), and who wins when both speak.

``docs/CONSOLE-MODELS.md`` §2: "the gateway reads ``ops.settings`` for tier overrides on a short
cache and calls ``routing.configure()`` with them, the same path the env variables use, so the two
never disagree (env wins if both are set, and the desk says so)."

Five things are proved here and every one of them fails without ``dials.py``:

1. A dial written to ``ops.settings`` moves the router with NO restart — and moves the registry
   with it, so a capability still routes on its declared tier afterwards.
2. The environment wins when both are set, and the reader can SAY which one is in force, because
   a console that shows a desk value the gateway is not using is worse than no console.
3. An id that is not in ``routing.CATALOGUE`` is refused at the write, exactly as the env override
   is refused at boot. A typo may not become a quiet outage on every turn.
4. "Back to the owner's table" clears every override and the default table comes back.
5. The allowance arithmetic is the document's arithmetic: plan amount x generosity / days in the
   month, to the paisa, and the free plan's five rupees.
"""

from __future__ import annotations

import pytest
from wobo_gateway import dials, doors, registry, routing
from wobo_gateway.routing import Tier


@pytest.fixture(autouse=True)
def _dial_store(monkeypatch: pytest.MonkeyPatch) -> doors.InMemorySettingsStore:
    """A clean ``ops.settings`` per test, and the router put back afterwards.

    The dials share ``doors``' store because they share the table: one ops.settings, one seam.
    """
    store = doors.InMemorySettingsStore()
    doors.set_store(store)
    dials.reset()
    yield store
    doors.set_store(None)
    dials.reset()
    routing.configure({})
    registry.reload()


def _write(store: doors.InMemorySettingsStore, key: str, value: object) -> None:
    store.write(key, value, actor=None, note=None)


# --- 1. a dial moves the router, and the registry with it ----------------------------------------
def test_a_dial_moves_the_primary_without_a_restart(
    _dial_store: doors.InMemorySettingsStore,
) -> None:
    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-terra"
    _write(_dial_store, dials.tier_primary_key("turn"), "openai/gpt-5.6-luna")

    dials.apply(force=True)

    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-luna"


def test_a_dial_moves_the_chain_and_the_registry_stays_valid(
    _dial_store: doors.InMemorySettingsStore,
) -> None:
    """A SHORTER chain renames the fallback rungs, so a stale registry would stop resolving."""
    _write(_dial_store, dials.tier_chain_key("turn"), ["anthropic/claude-sonnet-5"])

    dials.apply(force=True)

    assert routing.tier_chain(Tier.TURN) == (
        "openai/gpt-5.6-terra",
        "anthropic/claude-sonnet-5",
    )
    # Would raise if the policies still named a rung the table no longer has.
    registry.validate_registry()
    assert registry.policy("wobo.turn").fallback == routing.tier_fallbacks(Tier.TURN)


def test_the_generation_ladder_is_a_dial(_dial_store: doors.InMemorySettingsStore) -> None:
    _write(
        _dial_store,
        dials.LADDER_KEY,
        ["openai/gpt-5.6-luna", "openai/gpt-5.6-sol"],
    )

    dials.apply(force=True)

    assert routing.generation_ladder() == ("openai/gpt-5.6-luna", "openai/gpt-5.6-sol")


# --- 2. env wins, and the reader says so ----------------------------------------------------------
def test_the_environment_wins_and_the_desk_can_say_so(
    _dial_store: doors.InMemorySettingsStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("WOBO_TIER_TURN", "openai/gpt-5.6-sol")
    _write(_dial_store, dials.tier_primary_key("turn"), "openai/gpt-5.6-luna")

    dials.apply(force=True)

    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-sol"
    assert dials.source_for_tier("turn") == "env"
    assert dials.source_for_tier("tiny") == "default"
    monkeypatch.delenv("WOBO_TIER_TURN")
    dials.apply(force=True)
    assert dials.source_for_tier("turn") == "desk"


# --- 3. an id off the catalogue is refused ---------------------------------------------------------
def test_an_id_off_the_catalogue_is_refused_at_the_write(
    _dial_store: doors.InMemorySettingsStore,
) -> None:
    with pytest.raises(dials.UnknownModel):
        dials.set_tier("turn", primary="openai/gpt-9-nope", actor=None)

    assert _dial_store.read(dials.tier_primary_key("turn")) is None
    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-terra"


def test_an_unreadable_dial_leaves_the_owners_table_standing(
    _dial_store: doors.InMemorySettingsStore,
) -> None:
    """A value nobody can route to is dropped with a warning; it never refuses the boot.

    The env override refuses at startup, which is the right answer when a deploy is watching. A
    dial is turned while the product is serving children, so a bad one falls back to the table
    rather than taking the gateway down with it.
    """
    _write(_dial_store, dials.tier_primary_key("turn"), "openai/gpt-9-nope")

    dials.apply(force=True)

    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-terra"
    assert "turn" in dials.rejected()


# --- 4. back to the owner's table -------------------------------------------------------------------
def test_back_to_the_owners_table_clears_every_override(
    _dial_store: doors.InMemorySettingsStore,
) -> None:
    dials.set_tier("turn", primary="openai/gpt-5.6-luna", actor=None)
    dials.set_ladder(["openai/gpt-5.6-terra", "openai/gpt-5.6-sol"], actor=None)
    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-luna"

    cleared = dials.clear_tier_overrides(actor=None)

    assert cleared >= 2
    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-terra"
    assert routing.generation_ladder()[0] == "openai/gpt-5.6-luna"


# --- 5. the allowance arithmetic ---------------------------------------------------------------------
def test_the_daily_allowance_is_the_documents_arithmetic() -> None:
    """docs/ALLOWANCE.md §1: Pro yearly is ₹1,666 a month, a quarter of it is ₹416.50, and over a
    30-day month that is ₹13.88 a day."""
    paise = dials.daily_allowance_paise("pro", period="yearly", days_in_month=30)
    assert paise == 1388  # ₹13.88, rounded down to the paisa


def test_generosity_is_a_dial_and_moves_the_day(
    _dial_store: doors.InMemorySettingsStore,
) -> None:
    _write(_dial_store, dials.GENEROSITY_KEY, {"pro": 0.5})
    dials.apply(force=True)

    assert dials.generosity()["pro"] == 0.5
    assert dials.daily_allowance_paise("pro", period="yearly", days_in_month=30) == 2777


def test_the_free_plan_is_five_rupees_a_day_by_default_and_is_a_dial(
    _dial_store: doors.InMemorySettingsStore,
) -> None:
    assert dials.free_daily_paise() == 500

    _write(_dial_store, dials.FREE_PAISE_KEY, 200)
    dials.apply(force=True)

    assert dials.free_daily_paise() == 200
    assert dials.daily_allowance_paise("free") == 200


def test_the_inr_rate_is_a_dial_with_the_day_it_was_set(
    _dial_store: doors.InMemorySettingsStore,
) -> None:
    assert dials.inr_per_usd() == dials.DEFAULT_INR_PER_USD

    dials.set_allowance(inr_per_usd=90.0, actor=None)

    assert dials.inr_per_usd() == 90.0
    assert dials.changed_at(dials.INR_RATE_KEY) is not None


def test_an_unknown_plan_gets_the_free_day_and_never_a_paid_one() -> None:
    """The same rule budget.py and spend.py keep: a name nobody recognises is free."""
    assert dials.daily_allowance_paise("gold") == dials.free_daily_paise()


def test_the_live_effect_is_rupees_per_day_per_plan() -> None:
    effect = dials.allowance_effect(days_in_month=30)
    pro = next(row for row in effect if row["plan"] == "pro" and row["period"] == "yearly")
    assert pro["daily_paise"] == 1388
    assert pro["plan_amount_paise"] == 166_600
    free = next(row for row in effect if row["plan"] == "free")
    assert free["daily_paise"] == 500
