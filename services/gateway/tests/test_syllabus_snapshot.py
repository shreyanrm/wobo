"""The syllabus the website is BUILT from cannot drift from the syllabus the door serves.

``apps/web-pwa/src/screens/syllabus/syllabus.json`` is a committed artefact: the whole publishable
tree, written by :mod:`wobo_gateway.curriculum.snapshot` from the seed under ``content/curriculum``
through the same :func:`public.build_tree` the open door uses. The site's 1,111 syllabus pages read
it, the sitemap is generated from it, and the pre-renderer writes one real HTML file per address in
it. So the one thing that must never happen is the file saying something the seed does not.

This file is what makes it a checked artefact rather than a copy somebody has to remember to
update: it re-derives the snapshot here and fails if the committed bytes differ. When a board
publishes a new edition, the fix is one command:

    uv run python -m wobo_gateway.curriculum.snapshot

It also holds the honest count (WOBO-TASKS §10.21). docs/GROWTH-SEARCH.md §3 prints 4 boards, 13
classes, 50 subjects, 333 chapters and 711 topics. If those numbers move, the document moves with
them, deliberately, rather than the site quietly publishing a number nobody counted.
"""

from __future__ import annotations

import json

import pytest
from wobo_gateway.curriculum import public, snapshot


@pytest.fixture(autouse=True)
def _fresh_tree() -> None:
    public.reset()


def test_the_committed_file_is_what_the_seed_produces() -> None:
    path = snapshot.DEFAULT_OUT
    assert path.exists(), f"the website's syllabus is missing: {path}"
    assert path.read_text(encoding="utf-8") == snapshot.render(snapshot.snapshot()), (
        "apps/web-pwa/src/screens/syllabus/syllabus.json has drifted from the seed. "
        "Regenerate it: uv run python -m wobo_gateway.curriculum.snapshot"
    )


def test_the_counts_are_the_ones_we_publish() -> None:
    data = json.loads(snapshot.DEFAULT_OUT.read_text(encoding="utf-8"))
    assert snapshot.counts(data) == {
        "boards": 4,
        "classes": 13,
        "subjects": 50,
        "chapters": 333,
        "topics": 711,
    }


def test_icse_and_isc_carry_no_topic_list_at_all() -> None:
    """The negative half of the honest count: nothing is invented under a board that gave us
    units and no topics. A test that only counted totals would pass on a tree that had quietly
    grown 152 chapter lists out of nowhere."""
    data = json.loads(snapshot.DEFAULT_OUT.read_text(encoding="utf-8"))
    for board in data["boards"]:
        if board["slug"] not in {"icse", "isc"}:
            continue
        for klass in board.get("classes") or []:
            for subject in klass.get("subjects") or []:
                for chapter in subject.get("chapters") or []:
                    assert not chapter.get("topics"), f"{board['slug']}/{chapter['slug']}"


def test_every_chapter_and_topic_names_a_document_and_its_hash() -> None:
    """The bar the page family's own gate reads. A page whose chapter cannot say which official
    document it came from carries nothing a content farm does not already carry, and does not
    ship (docs/GROWTH-SEARCH.md §3)."""
    data = json.loads(snapshot.DEFAULT_OUT.read_text(encoding="utf-8"))
    sources = data["sources"]
    naked: list[str] = []
    for board in data["boards"]:
        for klass in board.get("classes") or []:
            for subject in klass.get("subjects") or []:
                for chapter in subject.get("chapters") or []:
                    for node in [chapter, *(chapter.get("topics") or [])]:
                        record = sources[node["src"]] if "src" in node else None
                        if not record or not record.get("url") or not record.get("hash"):
                            naked.append(f"{board['slug']}/{node['slug']}")
    assert naked == []


def test_the_file_stays_small_enough_to_hand_a_browser() -> None:
    """It travels in the syllabus pages' own chunk and nothing else on the site pays for it, but a
    reader on a cheap phone still does. The intern tables are what keep it at this size; a change
    that flattened them would push it past a megabyte without failing anything else."""
    assert snapshot.DEFAULT_OUT.stat().st_size < 400_000


def test_a_source_record_is_interned_once_and_never_repeated() -> None:
    data = json.loads(snapshot.DEFAULT_OUT.read_text(encoding="utf-8"))
    keys = [json.dumps(record, sort_keys=True) for record in data["sources"]]
    assert len(keys) == len(set(keys))
    check_keys = [json.dumps(names) for names in data["checks"]]
    assert len(check_keys) == len(set(check_keys))


def test_the_snapshot_is_deterministic() -> None:
    """Two runs over the same seed produce the same bytes, so a regeneration that changed nothing
    leaves the diff empty and a real change is visible on its own."""
    first = snapshot.render(snapshot.snapshot())
    public.reset()
    assert snapshot.render(snapshot.snapshot()) == first


def test_it_never_names_a_board_we_may_not_publish() -> None:
    """Only ``verified`` and ``provisional``. A learner's own uploaded syllabus and a donated one
    live in the same table and are neither of ours to put on a public page."""
    data = json.loads(snapshot.DEFAULT_OUT.read_text(encoding="utf-8"))
    assert {board["status"] for board in data["boards"]} <= {"verified", "provisional"}
    assert [board["slug"] for board in data["boards"]] == ["cbse", "icse", "isc", "nios"]
