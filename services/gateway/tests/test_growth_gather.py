"""GATHER: every source read from a recording, or reported absent; then MAKE from the ranking."""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest
from growth_world import Recorder, fixture, good_piece
from wobo_gateway.growth import demand, gather, make
from wobo_gateway.growth import store as store_mod

DAY = date(2026, 9, 16)


@pytest.fixture(autouse=True)
def _world(monkeypatch: pytest.MonkeyPatch) -> Any:
    for name in (
        gather.TOKEN_ENV,
        gather.PROPERTY_ENV,
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_KEY",
        "LLM_MODE",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CURRICULUM_STORE", "memory")
    world = store_mod.InMemoryGrowthStore()
    store_mod.set_store(world)
    yield world
    store_mod.set_store(None)


def test_near_misses_keep_positions_worth_writing_for() -> None:
    found = gather.near_misses(fixture("search_analytics.json"), day="2026-09-16")
    assert [(s.query, s.page, s.position) for s in found] == [
        ("probability class 10 notes", "/syllabus/cbse/class-10/mathematics/probability", 8.4),
        ("what is probability", "/blog/probability", 14.2),
    ]
    assert all(s.source == gather.SEARCH_CONSOLE for s in found)
    assert gather.near_misses(None, day="x") == []


def test_search_console_is_asked_for_query_and_page(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(gather.TOKEN_ENV, "token")
    monkeypatch.setenv(gather.PROPERTY_ENV, "sc-domain:heywobo.com")
    recorder = Recorder((200, fixture("search_analytics.json")))
    found = gather.read_search_console(DAY, transport=recorder)
    assert len(found) == 2
    (call,) = recorder.calls
    assert call["url"].endswith("/sites/sc-domain%3Aheywobo.com/searchAnalytics/query")
    assert call["body"]["dimensions"] == ["query", "page"]
    assert call["headers"]["Authorization"] == "Bearer token"


def test_served_counts_are_summed_per_concept_and_nothing_else() -> None:
    found = gather.served_counts(fixture("content_levels_served.json"), day="2026-09-16")
    assert {(s.concept, s.count) for s in found} == {("probability", 52), ("motion", 7)}
    assert all(not s.query and not s.page for s in found)


def test_a_persons_notes_are_questions_not_addresses() -> None:
    text = (
        "1. What is the difference between speed and velocity?\n"
        "- what is the difference between speed and velocity?\n"
        "https://example.com/thread\n"
        "ok\n"
        "* Why does ice float on water?\n"
    )
    found = gather.notes(text, day="2026-09-16")
    assert [s.query for s in found] == [
        "what is the difference between speed and velocity?",
        "why does ice float on water?",
    ]


def test_the_pass_reports_every_source_and_keeps_what_it_read(
    monkeypatch: pytest.MonkeyPatch, _world: store_mod.InMemoryGrowthStore
) -> None:
    monkeypatch.setenv(gather.TOKEN_ENV, "token")
    monkeypatch.setenv(gather.PROPERTY_ENV, "sc-domain:heywobo.com")

    def content(url: str, method: str, headers: dict[str, str], body: Any) -> tuple[int, Any]:
        assert headers["Accept-Profile"] == "content"
        if "/levels?" in url:
            return 200, fixture("content_levels_served.json")
        return 200, fixture("content_cores.json")

    result = gather.run(
        today=DAY,
        person_notes="What is the probability of rolling a six?",
        sc_transport=Recorder((200, fixture("search_analytics.json"))),
        content_transport=content,
        limit=10,
    )
    assert result["sources"]["search-console"] == {"read": True, "rows": 2}
    assert result["sources"]["our-learners"] == {"read": True, "rows": 2}
    assert result["sources"]["person"] == {"read": True, "rows": 1}
    assert result["sources"]["exam-dates"]["read"] is False
    assert result["kept"] == 5
    assert result["syllabus"]["from"] == "the curriculum store"
    top = {row["slug"]: row for row in result["topics"]}
    assert top["probability"]["core_on_file"] is True
    assert top["probability"]["served_to_learners"] == 52
    assert top["probability"]["signal_queries"] >= 1
    assert result["topics"][0]["slug"] == "probability"


def test_an_unconfigured_source_is_absent_with_its_reason() -> None:
    result = gather.run(today=DAY, limit=3)
    assert result["sources"]["search-console"]["read"] is False
    assert "not set" in result["sources"]["search-console"]["because"]
    assert result["sources"]["our-learners"]["read"] is False
    assert result["topics"], "the harvest still ranks with no signals"


def test_the_live_tree_becomes_nodes() -> None:
    from wobo_gateway.curriculum import public, store

    store.set_store(None)
    public.reset()
    nodes = gather.nodes_from_tree(public.build_tree())
    assert {n.board for n in nodes} >= {"CBSE", "NIOS"}
    assert any(n.kind == "topic" for n in nodes) and any(n.kind == "unit" for n in nodes)


def test_provenance_comes_from_the_curriculum_store() -> None:
    from wobo_gateway.curriculum import public

    tree = public.build_tree()
    topic = demand.rank(
        1,
        pool=[demand.Query("probability", ("g",), "concept", 1.0)],
        syllabus=gather.nodes_from_tree(tree),
    )[0]
    sources = make.provenance_for(topic, tree)
    assert sources, "a CBSE placement has a document with a hash and a date"
    for source in sources:
        assert source.complete()
        assert source.url.startswith("https://")


def test_make_owes_a_topic_with_no_core_and_buys_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Any] = []
    monkeypatch.setattr(make, "core_for", lambda topic: None)
    topic = demand.Topic(slug="probability", name="Probability")
    made = make.make(topic, writer=lambda core, t: calls.append(core))
    assert made.piece is None
    assert made.owed == ("no concept core is on file for this topic yet",)
    assert calls == []


def test_make_is_keyless_by_default_and_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    # Everything but the words is on file, so the writer is reached, and keyless it writes nothing.
    world = good_piece()
    monkeypatch.delenv("LLM_MODE", raising=False)
    monkeypatch.setattr(make, "core_for", lambda topic: {"idea": "x"})
    monkeypatch.setattr(make, "figure_for", lambda topic: world.figure)
    monkeypatch.setattr(make, "provenance_for", lambda topic, tree=None: world.provenance)
    topic = demand.Topic(slug="probability", name="Probability")
    made = make.make(topic)
    assert made.piece is None
    assert any("keyless" in o for o in made.owed)


def test_make_never_pays_the_writer_for_a_piece_with_no_figure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(make, "core_for", lambda topic: {"idea": "x"})
    monkeypatch.setattr(make, "figure_for", lambda topic: None)
    called: list[str] = []
    topic = demand.Topic(slug="probability", name="Probability")
    made = make.make(topic, writer=lambda core, t: called.append(t.slug) or {})
    assert made.piece is None and called == []
    assert not any("keyless" in o for o in made.owed)


def test_make_builds_a_piece_the_gate_can_judge(monkeypatch: pytest.MonkeyPatch) -> None:
    world = good_piece()
    monkeypatch.setattr(make, "core_for", lambda topic: {"idea": "x"})
    monkeypatch.setattr(make, "figure_for", lambda topic: world.figure)
    monkeypatch.setattr(make, "film_for", lambda topic: None)
    monkeypatch.setattr(make, "provenance_for", lambda topic, tree=None: world.provenance)
    words = {
        "title": world.title,
        "summary": world.summary,
        "lead": world.lead,
        "sections": [{"heading": s.heading, "body": s.body} for s in world.sections],
    }
    topic = demand.Topic(slug="probability", name="Probability")
    made = make.make(topic, today=DAY, writer=lambda core, t: words)
    assert made.piece is not None
    assert made.owed == ("no film for the Short",)
    from wobo_gateway.growth import piece

    assert piece.check(made.piece).publishable


def test_a_mock_figure_is_not_a_drawn_figure() -> None:
    assert not make._real({"verified": True, "provenance": {"model": "mock"}})
    assert not make._real({"verified": True, "seeded": True, "provenance": {"model": "m"}})
    assert not make._real({"verified": False, "provenance": {"model": "m"}})
    assert make._real({"verified": True, "provenance": {"model": "m"}, "status": "canonical"})
