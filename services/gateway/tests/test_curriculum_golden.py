"""Goldens for the first seeded boards (CURRICULUM.md §2, §3, §4, §5, §8, §11, §12).

Every other curriculum suite drives synthetic fixtures: a two-unit "Science" invented in the test
file, which proves the code and nothing about the content. This one drives the REAL seed —
``content/curriculum/frameworks.seed.json`` and every stored syllabus under
``content/curriculum/syllabi/`` — through the store and the nine capabilities, so a regression in
either half is caught by the same run.

Four kinds of assertion live here, and the split is deliberate:

* **The content law.** Every chapter came off a document that was fetched; every document carries
  a URL, a fetch time and the hash of the bytes; a file with no chapters says what blocked it and
  names the blocker. §12's list of what kills this ("a syllabus with no source", "a label that
  overstates what we know") is a test, not a paragraph.
* **The honesty of the claim.** Nothing on disk says ``verified``, and this suite holds it to
  that: §4.5 earns ``verified`` only after the verify tier has re-read the source independently
  and the owner or two learners have promoted it, and none of that has happened to any file here.
  The weaker, true claim is the file's own ``read_off_source`` flag, and every assertion below is
  written against that rather than against a status nobody has earned.
* **The coverage golden.** A frozen table of what the first boards hold. It is allowed to grow —
  a filled gap or a new board only ever raises a number — but it may never silently shrink.
* **The journeys.** Search by name and by alias, a subject opened, a board we hold nothing for,
  and an overlay carried across a version bump, each against seeded data rather than a mock.

The numbers in ``COVERAGE`` are read off the files, never guessed; when the seed grows, run
``pytest -k golden`` and it names the line to raise.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from wobo_gateway.curriculum import api, labels
from wobo_gateway.curriculum.models import (
    LEVEL_MAX,
    LEVEL_MIN,
    NodeKind,
    Status,
    Version,
    in_scope,
    level_order,
)
from wobo_gateway.curriculum.store import InMemoryStore, Seed, content_root, load_seed

SUBJECT = "learner-golden"
OTHER_SUBJECT = "learner-golden-2"

SHA256 = re.compile(r"^[0-9a-f]{64}$")
ISO_INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")

# The three ways a syllabus can be missing, from `content/curriculum/syllabi/README.md`. A blocker
# outside this set is a state nothing downstream knows how to explain to a learner.
BLOCKERS = {"browser_required", "no_official_document", "document_not_machine_readable"}


# --- the seed, read once ------------------------------------------------------------------------


@pytest.fixture(scope="session")
def seed() -> Seed:
    return load_seed()


@pytest.fixture
def store(seed: Seed) -> InMemoryStore:
    """A fresh store over the shared seed: jobs, pins and overlays must not leak between tests."""
    return InMemoryStore(seed)


def call(store: InMemoryStore, name: str, payload: dict[str, Any], *, subject: str = SUBJECT):
    return api.handle(name, payload, subject=subject, store=store)


# --- the files on disk --------------------------------------------------------------------------


def syllabi_root() -> Path:
    return content_root() / "syllabi"


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


FILES = [
    (str(path.relative_to(syllabi_root())), path) for path in sorted(syllabi_root().rglob("*.json"))
]
FILE_IDS = [name for name, _ in FILES]


def _name(node: dict[str, Any]) -> str:
    """A node's name, read the way the store's loader reads it: ``name`` or ``title``, either."""
    return str(node.get("name") or node.get("title") or "").strip()


def _units(document: dict[str, Any]) -> list[dict[str, Any]]:
    """The chapters, or none. ``null`` is a stored negative result, not an empty syllabus."""
    units = document.get("units")
    return units if isinstance(units, list) else []


def _pairs(document: dict[str, Any]):
    for unit in _units(document):
        topics = unit.get("topics")
        for topic in topics if isinstance(topics, list) else []:
            yield unit, topic


def _read_off_source(document: dict[str, Any]) -> bool:
    return document.get("read_off_source") is True


# =================================================================================================
# The content law — what may be on disk at all
# =================================================================================================


def test_there_are_syllabus_files_to_test() -> None:
    """A guard on the guard: an empty directory must fail loudly, not pass every test below."""
    assert len(FILES) >= 100, f"only {len(FILES)} syllabus files found under {syllabi_root()}"


@pytest.mark.parametrize(("name", "path"), FILES, ids=FILE_IDS)
def test_every_file_names_a_board_the_registry_lists(name: str, path: Path, seed: Seed) -> None:
    """A syllabus for a board nobody can search for is a syllabus no learner can reach."""
    document = _read(path)
    keys = {f.id.lower() for f in seed.frameworks}
    keys |= {f.name.lower() for f in seed.frameworks}
    keys |= {alias.lower() for f in seed.frameworks for alias in f.aliases}
    named = str(document.get("framework_id") or "").strip().lower()
    fallback = str(document.get("framework_name") or "").strip().lower()
    assert named in keys or fallback in keys, f"{name}: no registry entry for {named!r}"


@pytest.mark.parametrize(("name", "path"), FILES, ids=FILE_IDS)
def test_every_file_declares_one_of_the_four_statuses(name: str, path: Path) -> None:
    """§5 has four labels and no fifth. A status we cannot label is a status we cannot show."""
    document = _read(path)
    assert document.get("status") in {s.value for s in Status}, f"{name}: {document.get('status')}"


@pytest.mark.parametrize(("name", "path"), FILES, ids=FILE_IDS)
def test_nothing_calls_itself_verified_before_anything_verified_it(name: str, path: Path) -> None:
    """§4.5: ``verified`` is earned by the verify tier plus a promotion, not written by a build.

    The label the learner reads for ``verified`` is "Official CBSE 2026-27, verified" — a claim
    about the board's document that must be falsifiable. A file may only make it once the
    provenance says who verified it and when.
    """
    document = _read(path)
    if document.get("status") != Status.VERIFIED.value:
        return
    provenance = document.get("provenance") or {}
    assert provenance.get("verified_by"), f"{name}: verified with nobody named as the verifier"
    assert provenance.get("verified_at"), f"{name}: verified with no time it happened"
    assert _units(document), f"{name}: verified with no chapters to have verified"


@pytest.mark.parametrize(("name", "path"), FILES, ids=FILE_IDS)
def test_the_claim_a_file_makes_matches_what_it_holds(name: str, path: Path) -> None:
    """``read_off_source`` is the weaker, true claim, and it must be exactly true.

    True means the chapters below were read off the board's own document. False means there are
    none, and the file is a stored negative result: ``units: null`` rather than ``[]``, so nothing
    downstream can mistake "we found nothing" for "the board publishes nothing".
    """
    document = _read(path)
    units = document.get("units")
    if _read_off_source(document):
        assert isinstance(units, list) and units, f"{name}: claims a source but holds no chapters"
        assert document.get("discovery_state") != "blocked", f"{name}: blocked yet read off source"
        return
    assert units is None, f"{name}: no source read, so units must be null, not {type(units)}"
    assert document.get("discovery_state") == "blocked", f"{name}: no chapters and not blocked"
    assert document.get("blocker") in BLOCKERS, f"{name}: blocker {document.get('blocker')!r}"
    # §4.6: we fail honestly, in words a person can act on.
    assert len(str(document.get("note") or "").strip()) >= 40, f"{name}: blocked with no note"


@pytest.mark.parametrize(("name", "path"), FILES, ids=FILE_IDS)
def test_every_cited_document_carries_a_url_a_fetch_time_and_a_hash(name: str, path: Path) -> None:
    """§5's provenance, on the document rather than the claim: this is what makes it falsifiable."""
    document = _read(path)
    docs = document.get("documents")
    assert isinstance(docs, list), f"{name}: documents is not a list"
    # A blocked file may cite nothing — "we found no document" has no source to attach, and
    # inventing one to satisfy a schema is exactly the fabrication §11 bars. A file with chapters
    # has no such excuse: every chapter came off something that was fetched.
    assert docs or not _units(document), f"{name}: chapters with no document behind them"
    for entry in docs:
        ident = entry.get("id")
        assert ident, f"{name}: a document with no id"
        assert str(entry.get("url", "")).startswith("https://"), f"{name}/{ident}: no https url"
        assert ISO_INSTANT.match(str(entry.get("fetched_at", ""))), f"{name}/{ident}: fetched_at"
        assert SHA256.match(str(entry.get("document_sha256", ""))), f"{name}/{ident}: sha256"


@pytest.mark.parametrize(("name", "path"), FILES, ids=FILE_IDS)
def test_every_unit_and_topic_points_at_a_document_in_the_same_file(name: str, path: Path) -> None:
    """§12, first line: a syllabus with no source. Every node resolves to a document we fetched."""
    document = _read(path)
    known = {entry.get("id") for entry in document.get("documents") or []}
    for unit in _units(document):
        _assert_source(f"{name}: unit {_name(unit)!r}", unit.get("source_ref"), known)
    for _, topic in _pairs(document):
        _assert_source(f"{name}: topic {_name(topic)!r}", topic.get("source_ref"), known)


def _assert_source(where: str, ref: Any, known: set[Any]) -> None:
    assert isinstance(ref, dict), f"{where}: no source_ref"
    assert ref.get("document_id") in known, f"{where}: source_ref names an unfetched document"
    page, section = ref.get("page"), str(ref.get("section") or "").strip()
    assert (isinstance(page, int) and page >= 1) or section, f"{where}: no page and no section"


@pytest.mark.parametrize(("name", "path"), FILES, ids=FILE_IDS)
def test_no_file_claims_a_level_outside_school(name: str, path: Path) -> None:
    """§11: grades 4 to 13, school level only — and the file's own number must agree with ours."""
    document = _read(path)
    level = str(document.get("level") or "")
    assert in_scope(level), f"{name}: {level!r} is outside grades {LEVEL_MIN} to {LEVEL_MAX}"
    stated = document.get("level_order")
    if stated is not None:
        assert stated == level_order(level), f"{name}: level_order {stated} != {level_order(level)}"


@pytest.mark.parametrize(("name", "path"), FILES, ids=FILE_IDS)
def test_units_and_topics_are_named_ordered_and_not_duplicated(name: str, path: Path) -> None:
    """A duplicate, unnamed or misordered chapter is an extraction gone wrong, not a syllabus."""
    document = _read(path)
    names = [_name(unit) for unit in _units(document)]
    assert all(names), f"{name}: an unnamed unit"
    duplicated = [text for text, count in Counter(names).items() if count > 1]
    assert not duplicated, f"{name}: duplicate units {duplicated}"
    orders = [unit.get("order") for unit in _units(document)]
    assert orders == sorted(orders), f"{name}: units are not in the document's own order"
    for unit, topic in _pairs(document):
        assert _name(topic), f"{name}: unnamed topic in {_name(unit)!r}"


@pytest.mark.parametrize(("name", "path"), FILES, ids=FILE_IDS)
def test_a_topic_layer_we_do_not_trust_is_null_rather_than_empty(name: str, path: Path) -> None:
    """Same law as `units`, one level down: an empty list would read as "this chapter has none"."""
    document = _read(path)
    for unit in _units(document):
        topics = unit.get("topics")
        assert topics is None or isinstance(topics, list), f"{name}: {_name(unit)!r} topics"
        assert topics != [], f"{name}: {_name(unit)!r} has an empty topic list, not null"


@pytest.mark.parametrize(("name", "path"), FILES, ids=FILE_IDS)
def test_node_ids_are_present_and_unique_inside_a_file(name: str, path: Path) -> None:
    """§6 keys the learner's overlay by node id. A repeated id silently merges two chapters."""
    document = _read(path)
    ids = [unit.get("id") for unit in _units(document)]
    ids += [topic.get("id") for _, topic in _pairs(document)]
    assert all(ids), f"{name}: a node with no id"
    assert len(set(ids)) == len(ids), f"{name}: duplicate node ids"


def test_no_two_files_claim_the_same_board_level_and_subject() -> None:
    """Two files for one (board, class, subject) would seed the same subject node twice."""
    claims: dict[tuple[str, str, str], str] = {}
    for name, path in FILES:
        document = _read(path)
        key = (
            str(document.get("framework_id")),
            str(document.get("level")),
            str(document.get("subject")),
        )
        assert key not in claims, f"{name} and {claims[key]} both claim {key}"
        claims[key] = name


def test_the_readme_counts_what_is_actually_there() -> None:
    """The README is what a reader trusts this directory on. It may not drift from the files."""
    readme = (syllabi_root() / "README.md").read_text(encoding="utf-8")
    documents = [_read(path) for _, path in FILES]

    files = re.search(r"(\d+) files\.", readme)
    assert files, "README.md must open its summary with the file count"
    assert int(files.group(1)) == len(documents)

    counts = re.search(
        r"(\d+) of them carry `read_off_source: true`.*?(\d+) carry `discovery_state: \"blocked\"`",
        readme,
        re.S,
    )
    assert counts, "README.md must state how many files carry a source and how many are blocked"
    read_off, blocked = (int(g) for g in counts.groups())
    assert read_off == sum(1 for d in documents if _read_off_source(d))
    assert blocked == sum(1 for d in documents if d.get("discovery_state") == "blocked")

    totals = re.search(r"(\d+) units and (\d+) topics in total", readme)
    assert totals, "README.md must state its unit and topic totals"
    units, topics = (int(g) for g in totals.groups())
    assert units == sum(len(_units(d)) for d in documents)
    assert topics == sum(1 for d in documents for _ in _pairs(d))


# =================================================================================================
# The coverage golden — the first boards, frozen
# =================================================================================================

# What each board holds, as (syllabi read off a source, blocked syllabi, chapters). Filling a gap
# raises a number; nothing here may fall. A drop means a fixture regressed or a source stopped
# resolving, and both are things a learner would feel.
COVERAGE: dict[str, tuple[int, int, int]] = {
    "cbse": (23, 0, 133),
    "icse": (12, 9, 92),
    "isc": (8, 0, 60),
    "nios": (7, 2, 48),
    "telangana": (0, 15, 0),
    "andhra-pradesh": (0, 15, 0),
    "maharashtra": (0, 15, 0),
    "karnataka": (0, 15, 0),
}

# The classes Wave 6 promised chapters for. A board listed with an empty band is one where the
# promise is the honest blocker and the discovery door, not a chapter list — the state boards
# publish their syllabus only through a portal that a plain fetch cannot pass, and the files say so.
PROMISED: dict[str, tuple[int, ...]] = {
    "cbse": (6, 7, 8, 9, 10, 11, 12),
    "icse": (9, 10),
    "isc": (11, 12),
    "nios": (10, 12),
    "telangana": (),
    "andhra-pradesh": (),
    "maharashtra": (),
    "karnataka": (),
}


def _by_board() -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for _, path in FILES:
        document = _read(path)
        grouped.setdefault(str(document.get("framework_id")), []).append(document)
    return grouped


@pytest.mark.parametrize("board", sorted(COVERAGE), ids=sorted(COVERAGE))
def test_each_first_board_still_holds_what_it_held(board: str) -> None:
    documents = _by_board().get(board, [])
    assert documents, f"{board}: no syllabus files at all"
    sourced = [d for d in documents if _read_off_source(d)]
    blocked = [d for d in documents if d.get("discovery_state") == "blocked"]
    chapters = sum(len(_units(d)) for d in sourced)
    want_sourced, want_blocked, want_chapters = COVERAGE[board]
    assert len(sourced) >= want_sourced, f"{board}: syllabi with a source fell to {len(sourced)}"
    assert len(blocked) >= want_blocked, f"{board}: blocked syllabi fell to {len(blocked)}"
    assert chapters >= want_chapters, f"{board}: chapters fell to {chapters}"


@pytest.mark.parametrize("board", sorted(PROMISED), ids=sorted(PROMISED))
def test_each_promised_class_of_each_board_is_covered_at_the_unit_level(board: str) -> None:
    """Not "a file exists" — a file with chapters in it, which is what a learner opens."""
    covered = {level_order(str(d.get("level"))) for d in _by_board().get(board, []) if _units(d)}
    missing = [grade for grade in PROMISED[board] if grade not in covered]
    assert not missing, f"{board}: no chapters for class {missing}"


def test_a_board_with_no_chapters_anywhere_never_claims_to_have_read_a_source() -> None:
    """The state boards are the honest case: a source we could not reach, and a file saying so."""
    for board, (want_sourced, _, _) in COVERAGE.items():
        if want_sourced:
            continue
        for document in _by_board().get(board, []):
            assert not _read_off_source(document), board
            assert document.get("blocker") in BLOCKERS, board


# =================================================================================================
# The journeys — through the capabilities, against seeded data
# =================================================================================================

FIRST_BOARDS: tuple[str, ...] = (
    "cbse",
    "icse",
    "isc",
    "nios",
    "bse-telangana",
    "bseap",
    "msbshse",
    "kseab",
)


@pytest.mark.parametrize("board", FIRST_BOARDS, ids=FIRST_BOARDS)
def test_search_finds_each_first_board_by_its_name(board: str, store: InMemoryStore) -> None:
    framework = store.get_framework(board)
    assert framework is not None, f"{board} is not in the registry"
    found = call(store, "curriculum.search", {"q": framework.name, "country": "IN"})
    assert board in [row["id"] for row in found["results"]], framework.name


@pytest.mark.parametrize("board", FIRST_BOARDS, ids=FIRST_BOARDS)
def test_search_finds_each_first_board_by_every_alias_it_publishes(
    board: str, store: InMemoryStore
) -> None:
    """An alias nobody can search by is a comment. Every one of them is type-ahead, or it goes."""
    framework = store.get_framework(board)
    assert framework is not None
    assert framework.aliases, f"{board}: no aliases to search by"
    for alias in framework.aliases:
        found = call(store, "curriculum.search", {"q": alias, "country": "IN"})
        assert board in [row["id"] for row in found["results"]], f"{board}: alias {alias!r} missed"


@pytest.mark.parametrize(
    "typed", ["cbse", "CBSE", "cbs", "icse board", "nios", "telangana", "karnataka sslc"]
)
def test_type_ahead_answers_a_prefix_the_way_a_learner_types_it(
    typed: str, store: InMemoryStore
) -> None:
    found = call(store, "curriculum.search", {"q": typed, "country": "IN"})
    assert found["results"], f"nothing found for {typed!r}"
    # §3: the door is on every response, matched or not.
    assert found["not_listed"] == api.OWN_SYLLABUS


def test_search_finds_nothing_rather_than_something_plausible(store: InMemoryStore) -> None:
    found = call(store, "curriculum.search", {"q": "zzzz not a board anywhere", "country": "IN"})
    assert found["results"] == []
    assert found["not_listed"] == api.OWN_SYLLABUS


def test_every_search_result_carries_a_label_from_the_four(store: InMemoryStore) -> None:
    found = call(store, "curriculum.search", {"q": "board", "limit": 25})
    allowed = set(labels.all_labels().values())
    assert found["results"]
    for row in found["results"]:
        label = row["label"]
        # A board we hold no chapters for is simply named (`labels.board_label`): the four labels
        # are claims about a SYLLABUS, and there is no syllabus here to make one about. The
        # sentence that used to be appended, "no syllabus stored yet", left the product with the
        # cold start — picking such a board now starts both its reading and the learner.
        assert label in allowed or label.startswith("Official ") or label == row["name"], label
        if row["has_syllabus"] is False:
            assert "syllabus" not in label.casefold(), label
        # Product copy law: sentence case, no emoji, no exclamation marks.
        assert "!" not in label and label == label.strip()


# One anchor per board that holds chapters, named by (board, level, subject).
ANCHORS: tuple[tuple[str, str, str], ...] = (
    ("cbse", "Class 10", "Science"),
    ("cbse", "Class 12", "Physics"),
    ("icse", "Class 9", "Mathematics"),
    ("isc", "Class 12", "Biology"),
    ("nios", "Class 10", "Mathematics"),
)


def _find_file(board: str, level: str, subject: str) -> dict[str, Any]:
    for _, path in FILES:
        document = _read(path)
        if (
            document.get("framework_id") == board
            and document.get("level") == level
            and document.get("subject") == subject
        ):
            return document
    raise AssertionError(f"no syllabus file for {board} {level} {subject}")


@pytest.mark.parametrize(("board", "level", "subject"), ANCHORS)
def test_units_come_back_exactly_as_the_document_states_them(
    board: str, level: str, subject: str, store: InMemoryStore
) -> None:
    """The chapter list a learner sees is the file's own names, in the file's own order."""
    document = _find_file(board, level, subject)
    served = call(
        store, "curriculum.units", {"framework_id": board, "level": level, "subject": subject}
    )
    assert served["status"] == "ready"
    assert [unit["name"] for unit in served["units"]] == [_name(u) for u in _units(document)]
    for unit in served["units"]:
        assert unit["source_ref"], f"{unit['name']} served without its source"


@pytest.mark.parametrize(("board", "level", "subject"), ANCHORS)
def test_the_label_never_overstates_what_we_know(
    board: str, level: str, subject: str, store: InMemoryStore
) -> None:
    """§5 and §12: nothing here has been promoted, so nothing here may say "verified"."""
    document = _find_file(board, level, subject)
    framework = store.get_framework(board)
    version = store.latest_version(board)
    assert framework is not None and version is not None
    label = labels.label_for(framework, version)
    if document.get("status") == Status.VERIFIED.value:
        assert label == f"Official {framework.name} {version.label}, verified"
    else:
        assert label == "Found on the board's site, still checking"
        assert "verified" not in label
    assert "!" not in label


@pytest.mark.parametrize(("board", "level", "subject"), ANCHORS)
def test_topics_of_a_seeded_unit_keep_the_documents_order(
    board: str, level: str, subject: str, store: InMemoryStore
) -> None:
    """A chapter whose topic layer the build did not trust serves no topics, never invented ones."""
    document = _find_file(board, level, subject)
    served = call(
        store, "curriculum.units", {"framework_id": board, "level": level, "subject": subject}
    )
    for served_unit, stated in zip(served["units"], _units(document), strict=True):
        topics = call(
            store, "curriculum.topics", {"framework_id": board, "unit_id": served_unit["id"]}
        )
        stated_topics = stated.get("topics")
        expected = [_name(t) for t in stated_topics] if isinstance(stated_topics, list) else []
        assert [topic["name"] for topic in topics["topics"]] == expected, served_unit["name"]


# --- the board, class or subject we hold nothing for -------------------------------------------


def test_an_unseeded_subject_enqueues_one_job_and_invents_no_chapters(
    store: InMemoryStore,
) -> None:
    """§8 and §12: nothing generated in bulk, and never a second discovery for the same thing."""
    payload = {"framework_id": "cbse", "level": "Class 6", "subject": "Geography"}
    first = call(store, "curriculum.units", payload)

    # The cold start: the job is recorded and the learner starts on the shared plan. Never a
    # chapter, never a word about the search (docs/BOARD-COLD-START.md).
    assert first["status"] == "shared"
    assert first["units"] == []
    assert "placeholder" not in first, "the status card, and the narration with it, are gone"
    assert first["not_listed"] == api.OWN_SYLLABUS
    assert first["plan"]["source"] == "shared"
    assert "!" not in first["label"]

    second = call(store, "curriculum.units", payload, subject=OTHER_SUBJECT)
    job_id = first["job_id"]
    assert second["job_id"] == job_id, "two learners, two jobs"

    status = call(store, "curriculum.status", {"job_id": job_id})
    assert status["job"]["job_id"] == job_id


@pytest.mark.parametrize("board", ["bse-telangana", "bseap", "msbshse", "kseab"])
def test_a_state_board_we_could_not_read_offers_the_search_rather_than_a_syllabus(
    board: str, store: InMemoryStore
) -> None:
    """The blocked boards are the honest case end to end: a real entry, no invented chapter, and
    — since the cold start — a learner who begins anyway on the plan every board shares while the
    board's own document is queued for reading (docs/BOARD-COLD-START.md §3)."""
    framework = store.get_framework(board)
    assert framework is not None
    served = call(
        store,
        "curriculum.units",
        {"framework_id": board, "level": "Class 9", "subject": "Mathematics"},
    )
    assert served["status"] == "shared"
    assert served["units"] == [], "a board we could not read has no chapters, and we invent none"
    assert served["plan"]["concepts"], "the learner was left with nothing to do"
    assert served["not_listed"] == api.OWN_SYLLABUS


def test_an_unseeded_level_of_a_seeded_board_opens_the_door_rather_than_listing_subjects(
    store: InMemoryStore,
) -> None:
    """We hold no CBSE Class 5. Naming plausible subjects for it would be a fabrication."""
    served = call(store, "curriculum.framework", {"framework_id": "cbse", "level": "Class 5"})
    assert served["subjects"] == []
    assert served["not_listed"] == api.OWN_SYLLABUS


def test_a_board_with_no_stored_syllabus_at_all_still_answers_with_its_registry_levels(
    store: InMemoryStore,
) -> None:
    """The registry entry is enough to pick a class; the syllabus arrives on demand (§8)."""
    served = call(store, "curriculum.framework", {"framework_id": "cambridge-igcse"})
    assert served["framework"]["id"] == "cambridge-igcse"
    assert served["levels"], "a registry entry with no levels cannot be opened"


# The two entries a learner cannot get past the first screen on: with no levels there is no class
# to pick, so the framework is searchable and then a dead end with no door. Pinned rather than
# waved through — the list may shrink, never grow.
LEVELLESS = {"ib-cp", "ib-dp"}


def test_every_registry_entry_but_the_known_two_can_be_opened(seed: Seed) -> None:
    levelless = {framework.id for framework in seed.frameworks if not framework.levels}
    assert levelless <= LEVELLESS, f"new entries with no levels to pick: {levelless - LEVELLESS}"


# --- the overlay across a version bump ---------------------------------------------------------


def test_the_overlay_survives_a_version_bump_of_a_real_syllabus(store: InMemoryStore) -> None:
    """§6: the learner's edits are keyed by node identity, so a new extraction re-applies them."""
    board, level, subject = "cbse", "Class 10", "Science"
    current = store.latest_version(board)
    assert current is not None
    call(store, "curriculum.pin", {"framework_id": board, "version_id": current.id})

    served = call(
        store, "curriculum.units", {"framework_id": board, "level": level, "subject": subject}
    )
    first_unit, second_unit = served["units"][0], served["units"][1]
    subject_id = served["subject_id"]

    call(
        store,
        "curriculum.overlay.apply",
        {
            "framework_id": board,
            "version_id": current.id,
            "ops": [
                {"op": "rename", "node_id": first_unit["id"], "name": "Chemistry bit"},
                {"op": "not_in_my_school", "node_id": second_unit["id"], "value": True},
                {
                    "op": "add",
                    "parent_id": subject_id,
                    "kind": "unit",
                    "name": "My school's extra project",
                },
            ],
        },
    )

    _publish_next_edition(store, board, current)

    offer = call(store, "curriculum.upgrade", {"framework_id": board})
    assert offer["upgrade_available"] is True
    assert offer["changes"], "a new edition with no diff is not an edition"

    applied = call(store, "curriculum.upgrade", {"framework_id": board, "apply": True})
    assert applied["upgraded"] is True
    assert applied["overlay_kept"] >= 2, applied["overlay_report"]

    latest = store.latest_version(board)
    assert latest is not None
    assert store.get_pin(SUBJECT, board) == latest.id

    after = call(
        store, "curriculum.units", {"framework_id": board, "level": level, "subject": subject}
    )
    names = [unit["name"] for unit in after["units"]]
    assert "Chemistry bit" in names, "the rename did not survive"
    assert "My school's extra project" in names, "the learner's own chapter did not survive"
    hidden = [unit for unit in after["units"] if unit["name"] == second_unit["name"]]
    assert hidden and hidden[0]["not_in_my_school"] is True


def _publish_next_edition(store: InMemoryStore, board: str, current: Version) -> Version:
    """A next edition of the same syllabus, with new ids for every node.

    This is what §2 says a new academic year is — a new version, never an edit of the old one —
    and it is the only way to prove the overlay is keyed by identity rather than by id.
    """
    from dataclasses import replace

    later = Version(
        id="golden-next-edition",
        framework_id=board,
        label="2027-28",
        status=current.status,
        published_at="2027-04-01T00:00:00Z",
    )
    store.put_version(later)
    nodes = store.all_nodes(current.id)
    remap = {node.id: f"next::{node.id}" for node in nodes}
    # The board dropped its last chapter this year. That is the diff the learner is offered, and
    # it is deliberately NOT one of the chapters the overlay touches — the point of the test is
    # that edits elsewhere in the tree survive a real edition change.
    units = [node for node in nodes if node.kind is NodeKind.UNIT]
    dropped = {units[-1].id} if units else set()
    store.put_nodes(
        [
            replace(
                node,
                id=remap[node.id],
                version_id=later.id,
                parent_id=remap.get(node.parent_id) if node.parent_id else None,
            )
            for node in nodes
            if node.id not in dropped and node.parent_id not in dropped
        ]
    )
    return later


# =================================================================================================
# The boundaries — grades 4 to 13
# =================================================================================================


@pytest.mark.parametrize(
    ("level", "inside"),
    [
        ("Class 3", False),
        ("Grade 3", False),
        ("Class 4", True),
        ("Class 10", True),
        ("Class 13", True),
        ("Year 13", True),
        ("Class 14", False),
        ("Grade 14", False),
        ("Nursery", True),  # unnumbered: kept, because guessing at it would be the invention
        ("IGCSE", True),
    ],
)
def test_the_school_band_is_grades_4_to_13(level: str, inside: bool) -> None:
    assert in_scope(level) is inside, level


def test_no_seeded_level_node_falls_outside_the_band(seed: Seed) -> None:
    """The law holds over the real content, not only over the function that states it."""
    outside = [
        node.name for node in seed.nodes if node.kind is NodeKind.LEVEL and not in_scope(node.name)
    ]
    assert not outside, outside


def test_no_registry_entry_offers_a_level_outside_the_band(seed: Seed) -> None:
    for framework in seed.frameworks:
        for level in framework.levels:
            assert in_scope(level), f"{framework.id}: {level}"


def test_search_never_offers_a_level_outside_the_band(store: InMemoryStore) -> None:
    found = call(store, "curriculum.search", {"q": "board", "limit": 25})
    for row in found["results"]:
        for level in row["levels"]:
            assert in_scope(level), f"{row['id']}: {level}"


# =================================================================================================
# The seed and the files agree
# =================================================================================================


def test_the_seed_reads_every_framework_and_every_node_it_is_given(seed: Seed) -> None:
    """Nothing malformed, nothing half-read. The only thing the loader may pass over is a blocked
    file, which holds no syllabus to load — see the next test, which pins that number exactly."""
    assert seed.skipped_frameworks == 0
    assert seed.skipped_nodes == 0
    assert seed.frameworks and seed.nodes


def test_the_only_syllabi_the_loader_passes_over_are_the_blocked_ones(seed: Seed) -> None:
    """A stored negative result carries no chapters, so it seeds no nodes and the loader counts it.

    This is the seam between the fixtures and ``store.load_seed``: the count must be exactly the
    number of blocked files. Anything higher is a syllabus a learner silently cannot reach, and
    the moment the loader learns to tell a negative result apart from a malformed file this drops
    to zero — which this assertion also allows, deliberately.
    """
    blocked = sum(1 for _, path in FILES if _read(path).get("discovery_state") == "blocked")
    assert seed.skipped_syllabi in (0, blocked), (
        f"loader passed over {seed.skipped_syllabi} syllabi; {blocked} files are blocked"
    )


def test_every_seeded_unit_and_topic_carries_its_provenance(seed: Seed) -> None:
    by_node = {p.node_id: p for p in seed.provenance}
    for node in seed.nodes:
        if node.kind not in (NodeKind.UNIT, NodeKind.TOPIC):
            continue
        record = by_node.get(node.id)
        assert record is not None, node.name
        assert record.source_url, f"{node.name}: no source url"
        assert record.document_hash, f"{node.name}: no document hash"
