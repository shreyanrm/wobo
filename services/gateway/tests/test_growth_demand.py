"""The harvested demand: the files agree with their manifest, and the ranking is honest.

``content/growth/README.md`` promises this file: a number printed downstream is a number
somebody can check.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from wobo_gateway.growth import demand

DATA = Path(__file__).resolve().parents[3] / "content" / "growth"


def test_the_files_match_their_manifest() -> None:
    manifest = json.loads((DATA / "manifest.json").read_text())
    for part in ("harvest", "curriculum"):
        row = manifest[part]
        raw = (DATA / row["file"]).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == row["sha256"], part
    harvest = json.loads((DATA / "harvest.json").read_text())
    both = sum(1 for engines in harvest.values() if sorted(engines) == ["b", "g"])
    assert len(harvest) == manifest["harvest"]["queries"]
    assert both == manifest["harvest"]["both_engines"]
    rows = json.loads((DATA / "curriculum.json").read_text())
    assert len(rows) == manifest["curriculum"]["rows"]


def test_counts_are_counted_not_typed() -> None:
    counts = demand.counts()
    assert counts["queries"] == len(demand.harvest())
    assert set(counts["live_sources"]) == {"autocomplete", "syllabus"}
    assert "search-console" in counts["absent_sources"]


def test_every_absent_source_says_why_and_what_would_fill_it() -> None:
    for source in demand.SOURCES:
        if not source.live:
            assert source.because and source.would_fill, source.key


def test_intent_puts_an_app_download_below_an_idea() -> None:
    assert demand.intent_of("probability class 10") == "concept"
    assert demand.intent_of("ai tutor app download") == "navigational"
    assert demand.intent_of("best tutor for maths") == "product"
    assert demand.demand_of(("g", "b"), "concept") > demand.demand_of(("g",), "concept")
    assert demand.demand_of(("g",), "concept") > demand.demand_of(("g", "b"), "navigational")


def test_the_real_ranking_is_one_topic_per_concept() -> None:
    top = demand.rank(20)
    assert top, "the harvest ranked nothing"
    slugs = [t.slug for t in top]
    assert len(slugs) == len(set(slugs))
    probability = next(t for t in top if t.slug == "probability")
    assert len(probability.boards) > 1, "one concept on four boards is one topic, not four"
    assert probability.answerability == 1.0


def test_a_query_counts_once_however_many_placements_it_lands_on() -> None:
    pool = [demand.Query("probability", ("g", "b"), "concept", 2.0)]
    (topic,) = demand.rank(5, pool=pool)
    assert topic.demand == 2.0
    assert len(topic.placements) > 1


def test_a_handed_in_syllabus_is_the_one_matched() -> None:
    only = (demand.Node("CBSE", "Class 9", "Science", "Motion", "Motion", "unit"),)
    pool = [
        demand.Query("motion class 9", ("g",), "concept", 1.0),
        demand.Query("probability", ("g",), "concept", 1.0),
    ]
    ranked = demand.rank(5, pool=pool, syllabus=only)
    assert [t.slug for t in ranked] == ["motion"]
