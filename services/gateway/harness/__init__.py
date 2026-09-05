"""The teaching harness — the one test that asks whether the teaching is any good.

Every other suite in this repo tests the plumbing AROUND the teaching: that a turn is metered,
that a board event is well formed, that a chunk streams. Not one of them asks the question the
product exists to answer, which is whether what Wobo says, draws and explains is RIGHT.

This package is that question, asked against the real path: real questions, through the real
gateway door, the real safety screen, the real meter, the real planner, the real verifier and the
real wire, with the real models behind them. Nothing here is mocked except when you ask for the
recorded-fixture mode, and the report says plainly which mode produced it.

It is NOT wired into ``pytest``: it calls real models and the owner pays. Run it on demand:

    uv run python -m harness --live            # from services/gateway
    uv run python -m harness --replay          # recorded fixtures, free, for CI

``services/gateway/tests/test_teaching_harness.py`` is the harness's own test: it drives every
check in :mod:`harness.checks` and :mod:`harness.drawing` over hand-built transcripts and proves
each one FAILS on the failure it exists to catch.
"""

from __future__ import annotations

__all__ = ["cases", "checks", "drawing", "judge", "report", "runner"]
