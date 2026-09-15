"""The Wave 6 laws, one test per way the curriculum dies (docs/CURRICULUM.md §12).

    A syllabus with no source. A node edited in place. A learner's edits lost on upgrade.
    Bulk generation. A second discovery for a framework that is already stored. A label
    that overstates what we know.

Every test here was a finding first: each one describes a thing the shipped code did, and asserts
the behaviour the law asks for instead. They are deliberately written from the learner's side —
Alice renames a chapter, the board publishes a new edition, a rogue model invents one — because
that is the altitude the failures happen at, and a test at the function's altitude would have kept
passing through all of them.
"""

from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import pytest
from wobo_gateway.curriculum import api, labels, own
from wobo_gateway.curriculum.discovery import extract as dx
from wobo_gateway.curriculum.discovery import verify as dv
from wobo_gateway.curriculum.discovery.fetch import Document as FetchedDocument
from wobo_gateway.curriculum.discovery.fetch import Page
from wobo_gateway.curriculum.models import (
    Framework,
    FrameworkKind,
    Node,
    NodeKind,
    Status,
    Version,
)
from wobo_gateway.curriculum.store import (
    InMemoryStore,
    PostgrestStore,
    Seed,
    StoreUnavailable,
    get_store,
)

REPO = Path(__file__).resolve().parents[3]

BOARD = Framework(
    id="cbse",
    name="CBSE",
    kind=FrameworkKind.NATIONAL,
    status=Status.VERIFIED,
    levels=("Class 9",),
)

PASTE = "Class 9 Mathematics\n1. Number systems\n2. Polynomials\n3. Coordinate geometry\n"


def _nodes(version_id: str, prefix: str) -> list[Node]:
    def n(suffix, kind, name, parent, order=0):
        return Node(
            id=prefix + suffix,
            version_id=version_id,
            kind=kind,
            name=name,
            parent_id=(prefix + parent) if parent else None,
            order=order,
            source_ref={"page": 4},
        )

    return [
        n("lvl", NodeKind.LEVEL, "Class 9", None, 9),
        n("sub", NodeKind.SUBJECT, "Mathematics", "lvl"),
        n("u1", NodeKind.UNIT, "Number System", "sub", 1),
        n("u2", NodeKind.UNIT, "Algebra", "sub", 2),
        n("u3", NodeKind.UNIT, "Geometry", "sub", 3),
    ]


def _version(label: str, ident: str, published: str) -> Version:
    return Version(
        id=ident,
        framework_id="cbse",
        label=label,
        status=Status.PROVISIONAL,
        published_at=published,
    )


@pytest.fixture
def store() -> InMemoryStore:
    return InMemoryStore(
        Seed(
            frameworks=[BOARD],
            versions=[_version("2025-26", "v1", "2025-01-01T00:00:00Z")],
            nodes=_nodes("v1", "a-"),
        )
    )


def call(name: str, payload: dict[str, Any], store: InMemoryStore, subject: str = "ALICE") -> Any:
    return api.handle(name, payload, subject=subject, store=store)


def own_syllabus(store: InMemoryStore, subject: str, *, text: str = PASTE, name: str = "Mine"):
    """Read, confirm every chapter, publish. The whole own-syllabus door in one call."""
    read = call(
        "curriculum.own.read",
        {
            "kind": "paste",
            "text": text,
            "framework_name": name,
            "level": "Class 9",
            "subject": "Mathematics",
        },
        store,
        subject,
    )
    fid = read["framework"]["id"]
    for unit in read["units"]:
        call("curriculum.own.confirm", {"framework_id": fid, "unit_id": unit["id"]}, store, subject)
    return fid, read, call("curriculum.own.publish", {"framework_id": fid}, store, subject)


# --- §6, §12: a learner's edits survive an upgrade -----------------------------------------------
def test_an_overlay_is_not_lost_when_a_new_version_is_published(store: InMemoryStore) -> None:
    """The killer, in one scene. Alice edits her chapter list without ever calling
    `curriculum.pin` — nothing in the capability set obliges her to — and the board publishes the
    next edition. Her rename and her removal must still be hers, and the switch must be an offer
    with a diff rather than something that happened to her."""
    call(
        "curriculum.overlay.apply",
        {
            "framework_id": "cbse",
            "ops": [
                {"op": "rename", "node_id": "a-u1", "name": "Numbers (Miss Rao's order)"},
                {"op": "remove", "node_id": "a-u3"},
            ],
        },
        store,
    )
    payload = {"framework_id": "cbse", "level": "Class 9", "subject": "Mathematics"}
    assert [u["name"] for u in call("curriculum.units", payload, store)["units"]] == [
        "Numbers (Miss Rao's order)",
        "Algebra",
    ]

    store.put_version(_version("2026-27", "v2", "2026-01-01T00:00:00Z"))
    store.put_nodes(_nodes("v2", "b-"))

    offer = call("curriculum.upgrade", {"framework_id": "cbse"}, store)
    assert offer["upgrade_available"] is True
    assert offer["changes"] == [] or offer["summary"]
    # Until she accepts, she is still reading her own edition, with her own edits on it.
    assert [u["name"] for u in call("curriculum.units", payload, store)["units"]] == [
        "Numbers (Miss Rao's order)",
        "Algebra",
    ]

    moved = call("curriculum.upgrade", {"framework_id": "cbse", "apply": True}, store)
    assert moved["upgraded"] is True
    assert moved["overlay_dropped"] == 0
    # Carried across onto ids that did not exist when she made the edits.
    assert [u["name"] for u in call("curriculum.units", payload, store)["units"]] == [
        "Numbers (Miss Rao's order)",
        "Algebra",
    ]


def test_an_upgrade_is_offered_even_to_a_learner_who_never_pinned(store: InMemoryStore) -> None:
    """An overlay IS a statement that the learner studies that edition. Read straight from the
    store, with no pin at all, the offer still has to be made."""
    call(
        "curriculum.overlay.apply",
        {"framework_id": "cbse", "ops": [{"op": "remove", "node_id": "a-u3"}]},
        store,
    )
    store._pins.clear()  # a learner from before overlay.apply pinned anything
    store.put_version(_version("2026-27", "v2", "2026-01-01T00:00:00Z"))
    store.put_nodes(_nodes("v2", "b-"))
    out = call("curriculum.upgrade", {"framework_id": "cbse"}, store)
    assert out["upgrade_available"] is True
    assert out["summary"] != "You are on the current edition"


# --- §2: nothing is edited in place after publication --------------------------------------------
def test_a_published_personal_syllabus_is_superseded_and_never_overwritten() -> None:
    fresh = InMemoryStore(Seed())
    fid, _, published = own_syllabus(fresh, "ALICE")
    frozen_version = fresh.get_personal("ALICE", fid)["version"]["id"]
    frozen_units = [u["name"] for u in published["units"]]

    again = call(
        "curriculum.own.read",
        {
            "kind": "paste",
            "text": "Class 9 Mathematics\n1. Astrology\n2. Alchemy\n",
            "framework_name": "Mine",
            "level": "Class 9",
            "subject": "Mathematics",
        },
        fresh,
    )
    assert again["version"]["supersedes"] == frozen_version
    assert again["version"]["label"] != published["version"]["label"]
    # The published edition is still exactly what she published, in the registry she reads from.
    stored = fresh.get_version(frozen_version)
    assert stored is not None and stored.published_at
    units = fresh.children(frozen_version, None, kind=NodeKind.LEVEL)
    assert units, "the published version's nodes are still there"
    subject_node = fresh.children(frozen_version, units[0].id, kind=NodeKind.SUBJECT)[0]
    kept = fresh.children(frozen_version, subject_node.id, kind=NodeKind.UNIT)
    assert [n.name for n in kept] == frozen_units


# --- §11, §12: no unit without a line of the learner's own document ------------------------------
class Rogue:
    """A structuring model that returns whatever we tell it to. The point of the source checks."""

    model_id = "test/generate"

    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def structure(self, *, text: str, hint: dict[str, Any]) -> dict[str, Any]:
        return self.payload


def _built(payload: dict[str, Any], text: str = PASTE) -> dict[str, Any]:
    return own.structure(
        own.read_paste(text, title="mine"),
        owner="ALICE",
        framework_name="Mine",
        level="Class 9",
        subject="Mathematics",
        model=Rogue(payload),
    )


def test_a_chapter_name_that_is_nowhere_in_the_document_is_not_served() -> None:
    """A real line with an invented title hung on it: the failure a blurry photo produces."""
    built = _built(
        {
            "units": [
                {
                    "title": "Advanced calculus and complex analysis",
                    "quote": "Class 9 Mathematics",
                    "page": 1,
                    "topics": [],
                }
            ]
        }
    )
    names = [u["name"] for u in built["units"]]
    assert "Advanced calculus and complex analysis" not in names
    # The document's own line stands in its place, so nothing is invented and nothing is silent.
    assert names == ["Class 9 Mathematics"]


def test_a_topic_is_not_stamped_with_a_page_it_was_never_found_on() -> None:
    built = _built(
        {
            "units": [
                {
                    "title": "Number systems",
                    "quote": "1. Number systems",
                    "page": 1,
                    "topics": [{"title": "Astrology of primes", "objectives": ["Cast a chart"]}],
                }
            ]
        }
    )
    topic = built["units"][0]["topics"][0]
    assert topic["source_ref"] is None, "no source is honest; the unit's page would be a fiction"
    assert built["units"][0]["source_ref"]["page"] == 1


def test_a_topic_that_is_in_the_document_cites_its_own_page() -> None:
    built = _built(
        {
            "units": [
                {
                    "title": "Number systems",
                    "quote": "1. Number systems",
                    "page": 1,
                    "topics": [{"title": "Coordinate geometry", "objectives": []}],
                }
            ]
        }
    )
    assert built["units"][0]["topics"][0]["source_ref"]["page"] == 1


def test_checks_passed_names_only_the_checks_that_ran() -> None:
    """§5: `checks_passed` is evidence, not a claim. It used to be a hardcoded literal."""
    invented = _built(
        {
            "units": [
                {
                    "title": "Number systems",
                    "quote": "1. Number systems",
                    "page": 1,
                    "topics": [{"title": "Invented topic nobody wrote", "objectives": []}],
                }
            ]
        }
    )
    assert "source_quoted" not in invented["provenance"]["checks_passed"]
    assert "level_band" in invented["provenance"]["checks_passed"]

    honest = _built(
        {
            "units": [
                {
                    "title": "Number systems",
                    "quote": "1. Number systems",
                    "page": 1,
                    "topics": [{"title": "Polynomials", "objectives": []}],
                }
            ]
        }
    )
    assert "source_quoted" in honest["provenance"]["checks_passed"]


# --- §4.4, §12: one syllabus, one discovery job --------------------------------------------------
def test_one_syllabus_typed_four_ways_starts_one_job(store: InMemoryStore) -> None:
    store.put_framework(Framework(id="tel", name="Telangana", levels=("Class 9",)))
    jobs = {
        call(
            "curriculum.units",
            {"framework_id": "tel", "level": level, "subject": subject},
            store,
            "L1",
        )["job_id"]
        for level, subject in [
            ("Class 9", "Mathematics"),
            ("class 9", "mathematics"),
            ("CLASS 9", " Mathematics "),
            ("Class  9", "Mathematics"),
        ]
    }
    assert len(jobs) == 1


def test_eight_learners_at_once_start_one_job() -> None:
    fresh = InMemoryStore(Seed())
    fresh.put_framework(Framework(id="tel", name="Telangana", levels=("Class 9",)))
    original = fresh.find_open_job

    def slow(**kwargs):
        found = original(**kwargs)
        time.sleep(0.02)  # widens a window that exists in the code, it does not create one
        return found

    fresh.find_open_job = slow  # type: ignore[method-assign]
    seen: list[str] = []
    gate = threading.Barrier(8)

    def learner(index: int) -> None:
        gate.wait()
        seen.append(
            call(
                "curriculum.units",
                {"framework_id": "tel", "level": "Class 9", "subject": "Mathematics"},
                fresh,
                f"L{index}",
            )["job_id"]
        )

    threads = [threading.Thread(target=learner, args=(i,)) for i in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(set(seen)) == 1


def test_a_discovery_job_is_charged_to_the_learner_who_caused_it(store: InMemoryStore) -> None:
    """§4.4: a search, an extraction on the generate tier and a re-reading on the verify tier is
    a generation, whoever asked. `curriculum.units` itself stays a cheap turn."""
    store.put_framework(Framework(id="tel", name="Telangana", levels=("Class 9",)))
    charged: list[str] = []
    payload = {"framework_id": "tel", "level": "Class 9", "subject": "Mathematics"}
    api.handle("curriculum.units", payload, subject="L1", store=store, charge=charged.append)
    assert charged == ["curriculum.discovery"]
    # The second learner reads the first learner's job and pays for nothing.
    api.handle("curriculum.units", payload, subject="L2", store=store, charge=charged.append)
    assert charged == ["curriculum.discovery"]


# --- §11: grades 4 to 13, school level only ------------------------------------------------------
@pytest.mark.parametrize(
    "level", ["Class 1", "Class 2", "Class 14", "BSc Part 1", "Nursery", "Reception"]
)
def test_a_level_outside_school_is_refused_before_it_costs_anything(
    store: InMemoryStore, level: str
) -> None:
    store.put_framework(Framework(id="tel", name="Telangana", levels=("Class 9",)))
    with pytest.raises(api.CurriculumError) as caught:
        call(
            "curriculum.units",
            {"framework_id": "tel", "level": level, "subject": "Mathematics"},
            store,
            "L1",
        )
    assert "4" in caught.value.message and "13" in caught.value.message
    assert caught.value.code == "outside_school_band"


def test_a_framework_that_names_its_own_stages_still_opens(store: InMemoryStore) -> None:
    """"IGCSE" carries no number either, and it is a real level of a real board. A level with no
    number is judged against what the framework actually publishes, not guessed at."""
    store.put_framework(
        Framework(id="cie", name="Cambridge", levels=("IGCSE",), kind=FrameworkKind.INTERNATIONAL)
    )
    out = call(
        "curriculum.units",
        {"framework_id": "cie", "level": "IGCSE", "subject": "Mathematics"},
        store,
        "L1",
    )
    assert out["units"] == []
    assert out["not_listed"]["action"] == "own_syllabus"


# --- §3, §5: a label never claims more than we hold ----------------------------------------------
def test_the_seed_never_calls_a_bot_page_a_verified_official_site() -> None:
    seed = json.loads((REPO / "content/curriculum/frameworks.seed.json").read_text())
    block = re.compile(
        r"request rejected|access denied|attention required|just a moment|radware page|"
        r"bot verification|are you a robot|captcha|forbidden|security check",
        re.IGNORECASE,
    )
    bad = [
        entry["id"]
        for entry in seed["frameworks"]
        if entry.get("status") == "verified"
        and block.search((entry.get("check") or {}).get("page_title") or "")
    ]
    assert not bad, f"marked verified on a bot-protection page: {bad}"


def test_the_seed_never_calls_an_unreadable_answer_verified() -> None:
    """No title, or a redirect off the declared host, means nothing said whose site answered."""
    seed = json.loads((REPO / "content/curriculum/frameworks.seed.json").read_text())
    bad = [
        entry["id"]
        for entry in seed["frameworks"]
        if entry.get("status") == "verified"
        and not entry.get("owner_reviewed")
        and (
            not (entry.get("check") or {}).get("page_title")
            or (entry.get("check") or {}).get("redirected_to")
        )
    ]
    assert not bad, f"verified on an answer that named nobody: {bad}"


def _registry_build():
    """`content/curriculum/build.py` is standalone by design — stdlib only, no repo imports —
    so it is loaded by path rather than imported as a package."""
    import importlib.util

    path = REPO / "content/curriculum/build.py"
    spec = importlib.util.spec_from_file_location("wobo_registry_build", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


CBSE_ENTRY = {
    "id": "cbse",
    "name": "Central Board of Secondary Education",
    "aliases": ["CBSE"],
    "official_site": "https://www.cbse.gov.in",
}


@pytest.mark.parametrize(
    "record,verified",
    [
        ({"ok": True, "page_title": "CBSE - Central Board of Secondary Education"}, True),
        ({"ok": True, "page_title": "Radware Page"}, False),
        ({"ok": True, "page_title": "Request Rejected"}, False),
        ({"ok": True, "page_title": None}, False),
        ({"ok": True, "page_title": "Department of Education"}, False),
        ({"ok": True, "page_title": "CBSE home", "redirected_to": "someone-else.example"}, False),
        ({"ok": False, "error": "HTTP 403"}, False),
    ],
)
def test_reachability_alone_never_makes_an_entry_verified(
    record: dict[str, Any], verified: bool
) -> None:
    """A host answering is a fact about a host; `verified` is a claim about a board (§3, §5)."""
    build = _registry_build()
    entry = dict(CBSE_ENTRY)
    build.restatus(entry, record)
    assert entry["status"] == ("verified" if verified else "provisional")
    assert entry["site_reachable"] is bool(record.get("ok"))
    assert entry["status_reason"]


def test_an_owner_who_looked_can_say_so() -> None:
    build = _registry_build()
    entry = {**CBSE_ENTRY, "owner_reviewed": True}
    build.restatus(entry, {"ok": True, "page_title": "Request Rejected"})
    assert entry["status"] == "verified"


def test_a_verified_board_with_no_stored_syllabus_does_not_say_verified() -> None:
    """The label a learner reads first. Typing "tel" returned three boards all reading
    "Official …, verified" with not one chapter stored between them."""
    live = get_store()
    results = api.handle("curriculum.search", {"q": "telangana"}, subject="L1", store=live)[
        "results"
    ]
    assert results, "expected the seeded Telangana boards"
    claiming = [
        row["name"]
        for row in results
        if "verified" in row["label"] and live.latest_version(row["id"]) is None
    ]
    assert not claiming, f"labelled verified with no syllabus stored: {claiming}"
    # And no label mentions a syllabus we do not hold at all: the phrase "no syllabus stored yet"
    # left the product with the cold start (docs/BOARD-COLD-START.md). A board with nothing behind
    # it is named, and picking it starts both its reading and the learner.
    for row in results:
        if row["has_syllabus"] is False:
            assert "syllabus" not in row["label"].casefold(), row["label"]


# --- §4.3: the code-side checks can catch a fabrication ------------------------------------------
def _fetched_document() -> FetchedDocument:
    body = (
        "Course structure Class IX Mathematics\n"
        "Unit 1 Number Systems\nUnit 2 Algebra\nUnit 3 Coordinate Geometry\nUnit 4 Geometry\n"
    )
    return FetchedDocument(
        id="doc-1",
        url="https://board.example/syllabus.pdf",
        media_type="text/plain",
        title="Syllabus",
        bytes=len(body),
        document_sha256="0" * 64,
        extracted_text_sha256="1" * 64,
        fetched_at="2026-01-01T00:00:00Z",
        pages=(Page(number=1, text=body, section="Course structure"),),
        extraction="text",
    )


def _syllabus_of(titles: list[str], topics: list[str] | None = None):
    request = dx.SyllabusRequest(
        framework_id="cbse", framework_name="CBSE", level="Class 9", subject="Mathematics"
    )
    ref = dx.SourceRef(document_id="doc-1", page=1, section="Course structure")
    names = topics or [f"{title} basics" for title in titles]
    units = tuple(
        dx.Unit(
            title=title,
            order=index + 1,
            source_ref=ref,
            topics=(dx.Topic(title=names[index], order=1, source_ref=ref),),
        )
        for index, title in enumerate(titles)
    )
    return request, dx.Syllabus(
        request=request, units=units, documents=({"id": "doc-1"},), version="2026-27"
    )


FABRICATION = ["Astrology", "Alchemy", "Phrenology", "Numerology"]
#: The document's own four units, read back verbatim — what a faithful extraction looks like.
FAITHFUL = [
    "Unit 1 Number Systems",
    "Unit 2 Algebra",
    "Unit 3 Coordinate Geometry",
    "Unit 4 Geometry",
]
FAITHFUL_TOPICS = ["Number Systems", "Algebra", "Coordinate Geometry", "Geometry"]


def test_a_structural_check_catches_an_invented_chapter() -> None:
    """Every other check asks about the SHAPE of the extraction — how many units, in what order,
    citing which page — and a fabrication with the document's own numbering satisfies all of
    them. Only reading the cited page can tell a syllabus from a plausible list of words."""
    document = _fetched_document()
    request, syllabus = _syllabus_of(FABRICATION)
    failed = [c.name for c in dv.structural_checks(syllabus, document, request) if c.failed]
    assert dv.CHECK_TITLES_IN_DOCUMENT in failed


def test_a_faithful_extraction_still_passes_every_structural_check() -> None:
    document = _fetched_document()
    request, syllabus = _syllabus_of(FAITHFUL, FAITHFUL_TOPICS)
    checks = {c.name: c for c in dv.structural_checks(syllabus, document, request)}
    assert checks[dv.CHECK_TITLES_IN_DOCUMENT].passed is True


def test_a_syllabus_no_second_reader_saw_is_not_stored_under_a_board_name() -> None:
    """`ok` treated a skipped second reader as "nothing failed", so a fabrication was stored as
    provisional and labelled "Found on the board's site, still checking"."""
    document = _fetched_document()
    request, syllabus = _syllabus_of(FABRICATION)
    report = dv.verify_extraction(
        syllabus, document, request, complete=None, second_reader=False
    )
    assert dv.CHECK_SECOND_READER in [c.name for c in report.skipped]
    assert not report.ok


def test_a_faithful_extraction_is_storable_without_a_second_reader() -> None:
    """The gate is the title check, not the second reader: what code can prove, it proves."""
    document = _fetched_document()
    request, syllabus = _syllabus_of(FAITHFUL, FAITHFUL_TOPICS)
    report = dv.verify_extraction(syllabus, document, request, second_reader=False)
    assert report.ok
    assert not report.promotable, "promotion still waits on the second reader"


# --- §6: the own-syllabus door opens onto a room with an exit ------------------------------------
def test_a_published_own_syllabus_can_be_opened_like_any_other() -> None:
    fresh = InMemoryStore(Seed())
    fid, read, published = own_syllabus(fresh, "ALICE")
    payload = {"framework_id": fid, "level": "Class 9", "subject": "Mathematics"}
    units = call("curriculum.units", payload, fresh)
    assert [u["name"] for u in units["units"]] == [u["name"] for u in read["units"]]
    assert units["label"] == "Drafted from your syllabus, check it"
    found = call("curriculum.search", {"q": "Mine"}, fresh)["results"]
    assert [f["id"] for f in found] == [fid]
    topics = call(
        "curriculum.topics", {"framework_id": fid, "unit_id": units["units"][0]["id"]}, fresh
    )
    assert "topics" in topics


def test_a_re_read_after_publication_is_offered_as_an_upgrade_not_taken() -> None:
    """§2 and §6 meeting: the new reading is a new version, and the learner is still on theirs
    until they say otherwise — with a diff, and with their edits carried across."""
    fresh = InMemoryStore(Seed())
    fid, _, published = own_syllabus(fresh, "ALICE")
    first_version = published["version"]["label"]
    call(
        "curriculum.own.read",
        {
            "kind": "paste",
            "text": "Class 9 Mathematics\n1. Number systems\n2. Polynomials\n3. Statistics\n",
            "framework_name": "Mine",
            "level": "Class 9",
            "subject": "Mathematics",
        },
        fresh,
    )
    draft = fresh.get_personal("ALICE", fid)
    for unit in draft["units"]:
        call("curriculum.own.confirm", {"framework_id": fid, "unit_id": unit["id"]}, fresh)
    again = call("curriculum.own.publish", {"framework_id": fid}, fresh)
    assert again["version"]["label"] != first_version
    offer = call("curriculum.upgrade", {"framework_id": fid}, fresh)
    assert offer["upgrade_available"] is True
    assert any("Statistics" in change["line"] for change in offer["changes"])


def test_a_personal_framework_stays_the_learners_own() -> None:
    fresh = InMemoryStore(Seed())
    fid, read, _ = own_syllabus(fresh, "ALICE")
    assert call("curriculum.search", {"q": "Mine"}, fresh, "MALLORY")["results"] == []
    with pytest.raises(api.CurriculumError):
        call(
            "curriculum.units",
            {"framework_id": fid, "level": "Class 9", "subject": "Mathematics"},
            fresh,
            "MALLORY",
        )
    with pytest.raises(api.CurriculumError):
        call(
            "curriculum.own.confirm",
            {"framework_id": fid, "unit_id": read["units"][0]["id"]},
            fresh,
            "MALLORY",
        )


def test_an_offer_reaches_the_review_queue_before_the_learner_is_told_it_did() -> None:
    fresh = InMemoryStore(Seed())
    fid, _, _ = own_syllabus(fresh, "BOB")
    out = call("curriculum.own.offer", {"framework_id": fid, "note": "my school"}, fresh, "BOB")
    assert "A person checks it" in out["message"]
    queued = fresh.review_queue()
    assert len(queued) == 1
    row = queued[0]
    assert row["kind"] == "framework_offer"
    assert row["framework_id"] == fid
    assert row["note"] == "my school"
    assert row["state"] == "open"
    # The offer is credited anonymously and the owner's id does not travel with it (§6).
    assert "BOB" not in json.dumps(row)


def test_an_offer_credit_is_not_recomputable_from_a_subject_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A plain digest of a subject id is reversible by anyone holding the auth user table —
    which is the moderator reading the queue. The credit is keyed with the server's secret."""
    import hashlib

    monkeypatch.setenv("WOBO_CURRICULUM_SALT", "a-server-secret")
    fresh = InMemoryStore(Seed())
    fid, _, _ = own_syllabus(fresh, "BOB")
    call("curriculum.own.offer", {"framework_id": fid}, fresh, "BOB")
    credit = fresh.review_queue()[0]["offered_by_hash"]
    naive = hashlib.sha256(b"offer\x00BOB").hexdigest()
    assert credit and not naive.startswith(credit)


# --- §2, §5, §6: shapes a surface can rely on ----------------------------------------------------
def test_a_learner_cannot_mint_an_overlay_node_with_a_canonical_id(store: InMemoryStore) -> None:
    with pytest.raises(api.CurriculumError):
        call(
            "curriculum.overlay.apply",
            {
                "framework_id": "cbse",
                "ops": [
                    {
                        "op": "add",
                        "kind": "unit",
                        "parent_id": "a-sub",
                        "name": "Fake",
                        "id": "a-u1",
                    }
                ],
            },
            store,
            "B",
        )


def test_every_served_node_carries_a_source_field(store: InMemoryStore) -> None:
    call(
        "curriculum.overlay.apply",
        {
            "framework_id": "cbse",
            "ops": [{"op": "add", "kind": "unit", "parent_id": "a-sub", "name": "My extra"}],
        },
        store,
    )
    served = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Mathematics"},
        store,
    )["units"]
    assert all("source" in unit for unit in served)
    mine = [unit for unit in served if unit["own"]]
    assert mine and mine[0]["source"] is None


# --- §10: a subject can never widen its own filter -----------------------------------------------
def test_a_subject_cannot_widen_its_own_postgrest_filter() -> None:
    """A comma is a separator inside `or=(…)`. Unreachable in production, where the subject is a
    verified uuid — and one header away with DEV_AUTH=1 on a shared dev box."""
    urls: list[str] = []

    def transport(method, url, headers, body):
        urls.append(url)
        return 200, []

    postgrest = PostgrestStore("https://x.supabase.co", "service-role-key", transport=transport)
    postgrest.search_frameworks("cbse", subject="me,owner_subject_id.not.is.null")
    assert "not.is.null" not in unquote(urls[-1])
    assert "owner_subject_id=is.null" in unquote(urls[-1]), "it falls back to the public rows"


def test_a_malformed_subject_reads_nothing_of_its_own() -> None:
    calls: list[str] = []

    def transport(method, url, headers, body):
        calls.append(url)
        return 200, []

    postgrest = PostgrestStore("https://x.supabase.co", "k", transport=transport)
    assert postgrest.get_overlay("me,or=(x)", "v1") is None
    assert postgrest.get_pin("me,or=(x)", "cbse") is None
    assert calls == [], "nothing was asked of the database on that subject's behalf"


# --- §11: the honest failure, not a 500 ----------------------------------------------------------
def test_a_network_failure_is_the_line_the_learner_reads_not_a_stack_trace() -> None:
    def dead(method, url, headers, body):
        raise TimeoutError("the network went away")

    postgrest = PostgrestStore("https://x.supabase.co", "k", transport=dead)
    with pytest.raises(StoreUnavailable):
        postgrest.search_frameworks("cbse")
    with pytest.raises(api.CurriculumError) as caught:
        api.handle("curriculum.search", {"q": "cbse"}, subject="L1", store=postgrest)
    assert caught.value.status == 503
    assert "could not reach the syllabus list" in caught.value.message


# --- §4.6: a search nobody is running is not reported as running ---------------------------------
def test_a_missing_syllabus_reaches_an_honest_end(store: InMemoryStore) -> None:
    store.put_framework(Framework(id="tel", name="Telangana", levels=("Class 9",)))
    out = call(
        "curriculum.units",
        {"framework_id": "tel", "level": "Class 9", "subject": "Mathematics"},
        store,
        "L1",
    )
    state = call("curriculum.status", {"job_id": out["job_id"]}, store, "L1")
    assert state["state"] not in ("queued", "searching", "extracting", "checking")
    assert state["not_listed"]["action"] == "own_syllabus"
