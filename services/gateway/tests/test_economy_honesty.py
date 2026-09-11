"""A NUMBER THE MEASUREMENT CANNOT SUPPORT IS A CLAIM WEARING A DECIMAL POINT.

docs/CONTENT-INTERACTION.md §1 says the three layers cost *"about one tenth of the money"*, and the
wave reported "break-even is ~38 levels of one concept" beside the headline three-layer run as if
it were the measured answer. It was not measurable from that run at all:

* the headline report (three-layers-20260910-062054.json) recorded ``full.made = 0``, so it has no
  baseline and its own summary correctly says ``baselineUsd: null`` and ``savedUsd: null``;
* the only run that ever recorded a baseline (…-054237.json) had ONE baseline row, and its own
  summary says ``savedUsd: -0.07198`` — the split cost more than the path it replaces;
* the 38 was computed from that superseded run's core price. On the headline run's own core price
  the same arithmetic gives 30, a 58% swing in the input;
* and the headline run's twelve level costs (0.004283 to 0.006257) STRADDLE the single 0.006359
  baseline, so the per-level saving is inside the noise and break-even could be 25 or infinity.

``economy.summary`` was already honest enough to return None where it had nothing. What it did not
do was refuse a break-even it could not stand behind, or say how many measurements were under the
figures it printed. It does both now, and the reason is a sentence rather than a silence.
"""

from __future__ import annotations

from typing import Any

from wobo_gateway.plexus import economy


def _row(layer: str, cost: float, **extra: Any) -> dict[str, Any]:
    return {"layer": layer, "costUsd": cost, "concept": "c", **extra}


def _levels(*costs: float) -> list[dict[str, Any]]:
    return [_row(economy.LEVEL, c) for c in costs]


def test_no_baseline_says_so_and_prints_no_break_even() -> None:
    out = economy.summary([_row(economy.CORE, 0.0307), *_levels(0.0053, 0.0054)])
    assert out["baselineUsd"] is None
    assert out["savedUsd"] is None
    assert out["breakEvenLevels"] is None
    assert "baseline" in out["breakEvenReason"]


def test_one_baseline_row_is_not_a_measurement() -> None:
    """The superseded run's whole evidence was n=1. A single sample names no price."""
    rows = [_row(economy.CORE, 0.0194), *_levels(0.0058, 0.0057), _row(economy.FULL, 0.0064)]
    out = economy.summary(rows)
    assert out["baselineSamples"] == 1
    assert out["breakEvenLevels"] is None
    assert "1" in out["breakEvenReason"] or "enough" in out["breakEvenReason"]


def test_level_costs_that_straddle_the_baseline_are_inside_the_noise() -> None:
    """The headline run, as data: twelve levels either side of the baseline. No break-even."""
    rows = [
        _row(economy.CORE, 0.030699),
        *_levels(0.004283, 0.005100, 0.006257, 0.005343),
        *[_row(economy.FULL, c) for c in (0.006359, 0.006100, 0.006500)],
    ]
    out = economy.summary(rows)
    assert out["baselineSamples"] == 3
    assert out["breakEvenLevels"] is None
    assert "noise" in out["breakEvenReason"] or "straddle" in out["breakEvenReason"]


def test_a_break_even_is_printed_when_every_level_beat_every_baseline() -> None:
    """The honest case: the two ranges do not overlap, so the direction is not a coin toss."""
    rows = [
        _row(economy.CORE, 0.030000),
        *_levels(0.002000, 0.002100, 0.001900),
        *[_row(economy.FULL, c) for c in (0.012000, 0.011500, 0.012500)],
    ]
    out = economy.summary(rows)
    assert out["breakEvenLevels"] == 3
    assert out["breakEvenReason"] == ""
    assert out["levelSamples"] == 3


def test_the_saving_is_still_reported_against_a_measured_baseline() -> None:
    """None of this hides the money: the saving is arithmetic on rows that were really paid."""
    rows = [
        _row(economy.CORE, 0.03),
        *_levels(0.002, 0.002),
        *[_row(economy.FULL, 0.012) for _ in range(3)],
    ]
    out = economy.summary(rows)
    assert out["baselineUsd"] == 0.024
    assert out["savedUsd"] == round(0.024 - 0.034, 6)


def test_the_module_quotes_the_run_it_names() -> None:
    """The shipped comment cited "core USD 0.0194, level USD 0.0058" and dated it 2026-09-10; the
    report of that date says 0.030699 and 0.005343. A stale citation under a fresh date is how a
    superseded measurement goes on being quoted."""
    import inspect

    source = inspect.getsource(economy)
    assert "0.030699" in source
    assert "0.0194" not in source or "superseded" in source
