"""The pace: today's use against today's allowance, across learners.

``docs/ALLOWANCE.md`` §3: "today's spend against today's allowance across all learners; how many
hit the bar and at what hour of their day; the median fraction used. This is how the owner watches
the pace."

What this file holds the arithmetic to, and the one thing it holds the SILENCE to:

* a learner's fraction is their day's cost in USD, converted at the owner's rate, over the daily
  allowance their plan buys — and an unknown plan is the free day, never a paid one;
* "hit the bar" is a fraction at or past 1.0, counted per learner and never per call;
* the median is the middle learner, not the mean, because one heavy account must not read as
  everybody being busy;
* the LOCAL HOUR is not in the ledger. ``ops.model_calls`` carries a UTC day and a salted
  pseudonym and deliberately carries no time zone, so the desk says it does not know rather than
  printing a UTC hour under a heading that says the learner's own.
"""

from __future__ import annotations

from wobo_gateway import pace


def _row(ref: str, plan: str, cost_usd: float, calls: int = 1) -> dict[str, object]:
    return {"learner_ref": ref, "plan": plan, "cost_usd": cost_usd, "calls": calls}


def _allowance(plan: str) -> int:
    """A free day of ₹5 and a Pro day of ₹13.88, in paise, at a fixed rate for the arithmetic."""
    return {"pro": 1388, "max": 2777}.get(plan, 500)


def summarise(rows: list[dict[str, object]]) -> dict[str, object]:
    return pace.summarise(rows, allowance_paise=_allowance, inr_per_usd=100.0)


# --- the fraction ---------------------------------------------------------------------------------
def test_a_learners_fraction_is_their_day_over_their_allowance() -> None:
    # 0.05 USD at 100 to the dollar is ₹5.00 = 500 paise: exactly a free day.
    summary = summarise([_row("a", "free", 0.05)])

    assert summary["learners"] == 1
    assert summary["at_the_bar"] == 1
    assert summary["median_fraction"] == 1.0


def test_an_unknown_plan_is_the_free_day_and_never_a_paid_one() -> None:
    summary = summarise([_row("a", "gold", 0.05)])

    assert summary["at_the_bar"] == 1


def test_the_median_is_the_middle_learner_not_the_mean() -> None:
    rows = [
        _row("a", "free", 0.001),  # 0.2 of a free day
        _row("b", "free", 0.005),  # 1.0
        _row("c", "free", 0.05),  # 10.0, clipped at 1 for the bar count
    ]

    summary = summarise(rows)

    assert summary["learners"] == 3
    assert summary["median_fraction"] == 0.1
    assert summary["at_the_bar"] == 1


def test_one_learners_calls_are_one_learner() -> None:
    """The rollup is per (learner, plan); a learner with two plan strings in one day is still one
    person, and counting the rows would have said two."""
    summary = summarise([_row("a", "free", 0.002), _row("a", "pro", 0.002)])

    assert summary["learners"] == 1


def test_no_rows_is_a_quiet_day_and_not_a_blind_console() -> None:
    summary = summarise([])

    assert summary["learners"] == 0
    assert summary["median_fraction"] is None
    assert summary["at_the_bar"] == 0


def test_an_unreadable_ledger_is_not_a_quiet_day() -> None:
    view = pace.view(None, allowance_paise=_allowance, inr_per_usd=100.0)

    assert view["readable"] is False
    assert "learners" not in view


def test_the_desk_never_claims_a_local_hour() -> None:
    view = pace.view([_row("a", "free", 0.05)], allowance_paise=_allowance, inr_per_usd=100.0)

    assert view["readable"] is True
    assert view["by_hour"] is None
    assert "local hour" in view["not_known"].lower()


def test_the_spend_is_reported_in_both_currencies_for_the_operator() -> None:
    summary = summarise([_row("a", "free", 0.05), _row("b", "pro", 0.10)])

    assert summary["spent_usd"] == 0.15
    assert summary["spent_paise"] == 1500
