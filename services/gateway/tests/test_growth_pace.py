"""The make pass's pace: what the writer may cost in a day, and whose money it may never touch.

Two findings from the 2026-09-17 close, each held here:

* The day's allowance only went down when a piece PASSED. A refused piece moved the loop on to the
  next of up to 10,000 ranked topics, so one pass with cores on file and no figures called the
  writer 349 times. The writer is now never called for a piece the gate must refuse (no figure,
  no sources), the writer's calls in a day are capped whatever they return, and a refused topic is
  tried again later rather than used up for good.
* The writer stopped only at 100 % of the shared ceiling, past the lines where strangers are
  refused (90 %) and members are downgraded (80 %). Marketing copy now stops where the first
  learner would start to feel the day's spend: the stranger lane's degrade line.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from growth_world import good_piece
from wobo_gateway import doors, spend
from wobo_gateway.growth import api, demand, make, posters, settings
from wobo_gateway.growth import store as store_mod

NOW = datetime(2026, 9, 16, 6, 0, tzinfo=UTC)
WORLD = good_piece()


def _rows(count: int) -> list[dict[str, Any]]:
    placement = {
        "board": "CBSE",
        "level": "Class 10",
        "subject": "Mathematics",
        "unit": "Probability",
        "name": "Probability",
        "kind": "unit",
    }
    return [
        {"slug": f"topic-{i:04d}", "name": f"Topic {i}", "placements": [placement], "demand": 1.0}
        for i in range(count)
    ]


class Writer:
    """Counts its calls. ``good`` decides whether what it writes clears the gate."""

    def __init__(self, *, good: bool) -> None:
        self.good = good
        self.calls = 0

    def __call__(self, core: Any, topic: demand.Topic) -> dict[str, Any]:
        self.calls += 1
        sections = [
            {"heading": s.heading, "body": f"{s.body} This page is about {topic.name.lower()}."}
            for s in WORLD.sections
        ]
        if not self.good:
            sections = sections[:1]
        return {
            "title": WORLD.title,
            "summary": WORLD.summary,
            "lead": WORLD.lead,
            "sections": sections,
        }


@pytest.fixture(autouse=True)
def _world(monkeypatch: pytest.MonkeyPatch) -> Any:
    growth = store_mod.InMemoryGrowthStore()
    store_mod.set_store(growth)
    doors.set_store(doors.InMemorySettingsStore())
    settings.forget()
    api.forget()
    monkeypatch.setattr(api, "ranked_topics", lambda limit: (_rows(1000)[:limit], "a test"))
    monkeypatch.setattr(make, "core_for", lambda topic: {"idea": "x"})
    monkeypatch.setattr(make, "figure_for", lambda topic: WORLD.figure)
    monkeypatch.setattr(make, "film_for", lambda topic: WORLD.film)
    monkeypatch.setattr(make, "provenance_for", lambda topic, tree=None: WORLD.provenance)
    yield growth
    store_mod.set_store(None)
    doors.set_store(None)
    posters.reset()
    settings.forget()
    api.forget()


DIALS = settings.Settings(running=True, pieces_daily=1)


def test_no_writer_call_for_a_piece_the_gate_must_refuse(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(make, "figure_for", lambda topic: None)
    writer = Writer(good=True)
    report = api.run_make(NOW, dials=DIALS, writer=writer)
    assert writer.calls == 0, "the writer ran for a piece with no figure"
    assert report["made"] == [] and report["refused"] == {}
    assert len(report["owed"]) == 5
    assert all(any("figure" in why for why in owed) for owed in report["owed"].values())


def test_no_writer_call_for_a_piece_with_no_sources(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(make, "provenance_for", lambda topic, tree=None: [])
    writer = Writer(good=True)
    made = make.make(demand.Topic(slug="probability", name="Probability"), writer=writer)
    assert made.piece is None and writer.calls == 0
    assert any("official document" in why for why in made.owed)


def test_refusals_spend_the_days_writer_allowance(_world: store_mod.InMemoryGrowthStore) -> None:
    writer = Writer(good=False)
    report = api.run_make(NOW, dials=DIALS, writer=writer)
    assert writer.calls == api.WRITES_PER_PIECE * DIALS.pieces_daily, report
    assert report["made"] == [] and len(report["refused"]) == writer.calls
    assert report["because"] == api.ALLOWANCE_USED
    # A second pass the same day writes nothing more: the allowance is the day's, not the pass's.
    again = api.run_make(NOW + timedelta(hours=3), dials=DIALS, writer=writer)
    assert writer.calls == api.WRITES_PER_PIECE * DIALS.pieces_daily
    assert again["because"] == api.ALLOWANCE_USED


def test_the_allowance_never_passes_the_ceiling_of_three() -> None:
    writer = Writer(good=False)
    dials = settings.Settings(running=True, pieces_daily=99)
    api.run_make(NOW, dials=dials, writer=writer)
    assert writer.calls == api.WRITES_PER_PIECE * settings.PIECES_CEILING


def test_a_refused_topic_is_tried_again_later_not_used_up(
    _world: store_mod.InMemoryGrowthStore,
) -> None:
    api.run_make(NOW, dials=DIALS, writer=Writer(good=False))
    refused = {p.slug for p in _world.pieces() if not p.publishable}
    assert refused
    later = api.run_make(
        NOW + timedelta(days=api.RETRY_AFTER_DAYS), dials=DIALS, writer=Writer(good=True)
    )
    assert [m["slug"] for m in later["made"]] == ["topic-0000"]
    kept = _world.piece("topic-0000")
    assert kept is not None and kept.publishable


def test_a_refused_topic_is_not_retried_the_next_day(_world: store_mod.InMemoryGrowthStore) -> None:
    api.run_make(NOW, dials=DIALS, writer=Writer(good=False))
    next_day = api.run_make(NOW + timedelta(days=1), dials=DIALS, writer=Writer(good=True))
    assert [m["slug"] for m in next_day["made"]] == ["topic-0002"]


def test_a_made_piece_stops_the_pass_at_the_pace() -> None:
    writer = Writer(good=True)
    report = api.run_make(NOW, dials=settings.Settings(running=True, pieces_daily=2), writer=writer)
    assert writer.calls == 2 and len(report["made"]) == 2


# --- the writer's lane ----------------------------------------------------------------------------
@pytest.fixture()
def _live(monkeypatch: pytest.MonkeyPatch) -> Any:
    from wobo_gateway import model_call

    monkeypatch.setenv("LLM_MODE", "live")
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "3")
    for name in ("SPEND_DEGRADE_STRANGER", "SPEND_REFUSE_STRANGER"):
        monkeypatch.delenv(name, raising=False)
    spend.reset()
    calls: list[dict[str, Any]] = []

    def complete(**kwargs: Any) -> Any:
        calls.append(kwargs)
        raise ConnectionError("no network in a test")

    monkeypatch.setattr(model_call, "complete", complete)
    yield calls
    spend.reset()


TOPIC = demand.Topic(slug="probability", name="Probability")


@pytest.mark.parametrize("fraction", [0.5, 0.8, 0.9, 0.99])
def test_the_writer_stands_down_before_any_learner_feels_the_day(
    _live: Any, fraction: float
) -> None:
    spend.record(3 * fraction, capability="turn", model="test-model", now=datetime.now(UTC))
    assert spend.verdict(spend.Priority.STRANGER) is not spend.Verdict.SERVE
    assert make.write_words({"idea": "x"}, TOPIC) is None
    assert _live == [], "the writer reached a model past the stranger lane's degrade line"


def test_the_writer_runs_while_every_lane_is_served(_live: Any) -> None:
    spend.record(3 * 0.2, capability="turn", model="test-model", now=datetime.now(UTC))
    assert make.write_words({"idea": "x"}, TOPIC) is None
    assert len(_live) == 1
