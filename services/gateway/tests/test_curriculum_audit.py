"""The seed verification pass (``curriculum/discovery/audit.py``).

Every stored syllabus was extracted with no model in the loop and never read back against its
source. The pass that reads them back has to be held to the same standard as the extraction:
no network, no model, and a verdict that says exactly what it checked. So every test here runs
on synthetic pages and a scripted second reader, and each one fails without the behaviour it
names.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from wobo_gateway.curriculum.discovery import audit
from wobo_gateway.curriculum.discovery.fetch import Document, Page
from wobo_gateway.curriculum.store import load_seed

NOW = "2026-09-05T10:00:00Z"
HASH = "a" * 64


def _document(pages: dict[int, str], *, document_id: str = "doc", sha: str = HASH) -> Document:
    return Document(
        id=document_id,
        url="https://board.example/syllabus.pdf",
        media_type="application/pdf",
        title="Syllabus",
        bytes=1,
        document_sha256=sha,
        extracted_text_sha256="b" * 64,
        fetched_at=NOW,
        pages=tuple(Page(number=n, text=t) for n, t in sorted(pages.items())),
        extraction="test",
    )


def _file(
    units: list[dict[str, Any]] | None,
    *,
    document_id: str = "doc",
    blocker: str | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "framework_id": "cbse",
        "framework_name": "Central Board of Secondary Education",
        "version": "2026-27",
        "level": "Class 9",
        "level_order": 9,
        "subject": "Mathematics",
        "status": "provisional",
        "read_off_source": True,
        "provenance": {
            "extractor": "deterministic",
            "verifier": None,
            "checks_passed": ["unit_order_is_1_to_n"],
            "checks_failed": [],
            "verified_at": None,
            "verified_by": None,
        },
        "documents": [
            {
                "id": document_id,
                "title": "Syllabus",
                "url": "https://board.example/syllabus.pdf",
                "document_sha256": HASH,
            }
        ],
        "units": units,
        "note": "",
    }
    if blocker:
        out["discovery_state"] = "blocked"
        out["blocker"] = blocker
    return out


def _unit(order: int, name: str, page: int, topics: list[tuple[str, int]] | None, doc: str = "doc"):
    return {
        "source_ref": {"document_id": doc, "page": page, "section": "Contents"},
        "topics": None
        if topics is None
        else [
            {
                "source_ref": {"document_id": doc, "page": tpage, "section": "Contents"},
                "order": index,
                "name": tname,
                "id": f"n_{order}_{index}",
                "aliases": [],
                "concept_ids": [],
            }
            for index, (tname, tpage) in enumerate(topics, start=1)
        ],
        "order": order,
        "name": name,
        "id": f"n_{order}",
        "aliases": [],
    }


CONTENTS = (
    "Contents\nChapter 1 Number Systems 1\nChapter 2 Polynomials 15\n"
    "Chapter 3 Coordinate Geometry 30\nChapter 4 Linear Equations in Two Variables 40\n"
)
CHAPTERS = [
    ("Number Systems", 3),
    ("Polynomials", 3),
    ("Coordinate Geometry", 3),
    ("Linear Equations in Two Variables", 3),
]


def _sources(document: Document, **kw: Any) -> dict[str, audit.Source]:
    return {document.id: audit.Source(document.id, document, transport="test", **kw)}


# --- matching ---------------------------------------------------------------------------------
def test_loose_treats_punctuation_as_a_separator_not_as_nothing() -> None:
    # The document prints "d- and f- Block"; the file has "d-and f- Block". One heading.
    assert audit.loose("d-and f- Block Elements") == audit.loose("d- and f- Block Elements")
    assert audit.loose("History & Civics") == audit.loose("History and Civics")


@pytest.mark.parametrize(
    ("name", "pages", "cited", "expected"),
    [
        ("Number Systems", {2: "chapter 1 number systems"}, 2, (audit.VERBATIM_ON_PAGE, 2)),
        ("Number Systems", {2: "nothing", 4: "number systems"}, 2, (audit.VERBATIM_ELSEWHERE, 4)),
        # A two-column table interleaves the columns: the words survive, in order, apart.
        (
            "Cyclones and Tsunamis - early warning systems",
            {2: "cyclones and highlight key rules tsunamis early international warning systems"},
            2,
            (audit.ORDERED_ON_PAGE, 2),
        ),
        # "Civics: The Judiciary" against a booklet that prints CIVICS as a section heading.
        (
            "Civics: The Union Legislature",
            # The section heading sits a whole paragraph above the unit: too far for an
            # ordered-words run, so only the composite rule can place it.
            {2: "section a civics " + "marks " * 20 + "1 the union legislature meaning of"},
            2,
            (audit.COMPOSED_ON_PAGE, 2),
        ),
        ("Human Environment", {2: "module vii human and environment"}, 2, (audit.NOT_FOUND, None)),
        ("Water", {2: "nothing here"}, 2, (audit.TOO_SHORT, None)),
        # ICSE History & Civics 2027, page 6 prints HISTORY as a section heading and the units
        # under it run on to page 7, where the file cites this one. The parts are a page apart.
        (
            "History: Mass Phase of the National Movement (1915-1947)",
            {
                6: "section b history " + "marks " * 20,
                7: "2 mass phase of the national movement 1915 1947 a mahatma gandhi",
            },
            7,
            (audit.COMPOSED_NEAR_PAGE, 7),
        ),
        # CBSE IX Social Science, page 12: the outcomes column pushes "early ... warning
        # systems" more than a dozen words down from "Cyclones and Tsunamis", and the file
        # cites page 11. Every long word is within a page; the order is gone.
        (
            "Cyclones and Tsunamis - early warning systems",
            {
                11: "oceans and life introduction to ocean relief",
                12: "tsunamis early international agreements governing "
                + "x " * 20
                + "warning systems ocean navigation cyclones and highlight",
            },
            11,
            (audit.WORDS_NEAR_PAGE, 11),
        ),
        # Three short words on the page prove nothing: "the", "and", "of" are everywhere.
        (
            "The Age of the Guptas",
            {5: "the age and of the empire"},
            5,
            (audit.NOT_FOUND, None),
        ),
        # Two pages away is not "within a page": the citation is wrong, and the pass says so.
        (
            "History: Mass Phase of the National Movement (1915-1947)",
            {5: "section b history", 8: "2 mass phase of the national movement 1915 1947"},
            7,
            (audit.NOT_FOUND, None),
        ),
    ],
)
def test_locate_grades_the_evidence_and_names_the_page(name, pages, cited, expected) -> None:
    assert audit.locate(name, pages, cited) == expected


def test_a_container_named_after_the_book_is_evidence_for_the_reader_not_a_fabrication() -> None:
    # NCERT Ganita Prakash prelims: the Contents page lists the chapters; the file's one unit
    # is named after the book, a string the Contents page never prints.
    contents = (
        "contents chapter 1 a square and a cube chapter 2 power play chapter 3 quadrilaterals"
    )
    document = _document({1: "GANITA PRAKASH Textbook of Mathematics Grade 8 Part-I", 15: contents})
    file = _file(
        [
            _unit(
                1,
                "Ganita Prakash, Grade 8, Part 1",
                15,
                [("A Square and A Cube", 15), ("Power Play", 15), ("Quadrilaterals", 15)],
            )
        ]
    )
    report = audit.check_file("cbse/class-8-mathematics.json", file, _sources(document))
    unit = report.findings[0]
    assert unit.how == audit.CONTAINER_LABEL
    assert report.decision == "ask", report.reasons
    assert audit.CHECK_NAMES_IN_SOURCE in [c.name for c in report.checks if c.passed]
    assert any(audit.CONTAINER_LABEL in reason for reason in report.reasons)
    # One chapter the Contents page does not list, and the label is no longer a container of
    # the document's chapters: the unit stays not found and the file is flagged, not asked.
    file["units"][0]["topics"][2]["name"] = "Fractions in Disguise"
    report = audit.check_file("cbse/class-8-mathematics.json", file, _sources(document))
    assert report.findings[0].how == audit.NOT_FOUND
    assert report.decision == "flag"
    assert any("Fractions in Disguise" in reason for reason in report.reasons)


def test_a_misquoted_heading_is_not_a_container_label() -> None:
    # NIOS 212 prints "Module VII Human and Environment"; the seed dropped the "and". Every
    # word of the file's name is on the page, so the page has the heading and the file misquotes
    # it. Code can say that, and does, without a model.
    document = _document({3: CONTENTS + "\nModule VII Human and Environment"})
    file = _file([_unit(1, "Human Environment", 3, CHAPTERS)])
    report = audit.check_file("nios/x.json", file, _sources(document))
    assert report.findings[0].how == audit.NOT_FOUND
    assert report.decision == "flag"


def test_the_table_lists_every_evidence_grade_it_counted() -> None:
    contents = (
        "contents chapter 1 a square and a cube chapter 2 power play chapter 3 quadrilaterals"
    )
    document = _document({15: contents})
    file = _file(
        [
            _unit(
                1,
                "Ganita Prakash, Grade 8, Part 1",
                15,
                [("A Square and A Cube", 15), ("Power Play", 15), ("Quadrilaterals", 15)],
            )
        ]
    )
    report = audit.check_file("cbse/class-8-mathematics.json", file, _sources(document))
    table = audit.render_table([report], None, checked_at=NOW)
    assert "1 container named by the build its chapters verbatim" in table
    assert "3 of 4 names verbatim on the cited page" in table


# --- the verdict -------------------------------------------------------------------------------
def test_a_file_that_holds_is_promoted_by_code_alone_and_its_units_are_untouched(
    tmp_path: Path,
) -> None:
    document = _document({1: "Class IX Mathematics", 3: CONTENTS})
    file = _file([_unit(1, "Contents of the book", 3, CHAPTERS)])
    # The unit name is on page 3 too, verbatim.
    document = _document({1: "Class IX Mathematics", 3: CONTENTS + "\nContents of the book"})
    before = json.loads(json.dumps(file["units"]))

    def never(system: str, user: str) -> tuple[str, str]:
        raise AssertionError("the second reader must not be asked when code can decide")

    report = audit.check_file("cbse/class-9-mathematics.json", file, _sources(document))
    assert report.decision == "hold", report.reasons
    assert report.verifier == audit.CODE_VERIFIER
    after = audit.apply(file, report, now=NOW)
    assert after["status"] == "verified"
    assert after["provenance"]["verified_by"] == "system"
    assert after["provenance"]["verified_at"] == NOW
    assert after["provenance"]["verifier"] == audit.CODE_VERIFIER
    assert audit.CHECK_NAMES_IN_SOURCE in after["provenance"]["checks_passed"]
    assert audit.CHECK_COVERAGE in after["provenance"]["checks_passed"]
    assert "unit_order_is_1_to_n" in after["provenance"]["checks_passed"]  # the build's, kept
    assert after["units"] == before
    assert "status_reason" not in after
    # The same through the whole pass, with a second reader that would have failed the test.
    root = tmp_path / "syllabi"
    (root / "cbse").mkdir(parents=True)
    path = root / "cbse" / "class-9-mathematics.json"
    path.write_text(audit.dump(file))
    ledger = audit.CostLedger(budget_usd=1.0)
    reports = audit.run_pass(
        root,
        acquire=lambda did, entry: audit.Source(did, document, transport="test"),
        complete=never,
        ledger=ledger,
        now=NOW,
        write=True,
    )
    assert [r.decision for r in reports] == ["hold"]
    assert json.loads(path.read_text())["status"] == "verified"
    assert ledger.calls == []


def test_a_name_found_nowhere_in_the_source_flags_the_file_and_is_named() -> None:
    # NIOS 212 prints "Module VII Human and Environment"; the seed dropped the "and".
    document = _document({3: CONTENTS + "\nModule VII Human and Environment"})
    file = _file([_unit(1, "Human Environment", 3, CHAPTERS)])
    report = audit.check_file("nios/x.json", file, _sources(document))
    assert report.decision == "flag"
    assert any("unit 1: Human Environment" in reason for reason in report.reasons)
    after = audit.apply(file, report, now=NOW)
    assert after["status"] == "provisional"
    assert "unit 1: Human Environment" in after["status_reason"]
    assert list(after).index("status_reason") == list(after).index("status") + 1
    assert after["provenance"]["verified_by"] is None
    assert audit.CHECK_NAMES_IN_SOURCE in after["provenance"]["checks_failed"]


def test_a_name_off_its_page_is_recorded_but_does_not_block() -> None:
    # Verbatim in the document, three pages from where the file says: the citation is wrong,
    # the syllabus is not. The check fails and stays visible; the promotion stands.
    document = _document({3: CONTENTS, 6: "Contents of the book"})
    file = _file([_unit(1, "Contents of the book", 3, CHAPTERS)])
    report = audit.check_file("x.json", file, _sources(document))
    assert report.decision == "hold"
    page_check = next(c for c in report.checks if c.name == audit.CHECK_NAMES_ON_PAGE)
    assert page_check.failed
    assert "cites page 3, found on page 6" in page_check.detail
    table = audit.render_table([report], None, checked_at=NOW)
    assert "found on page 6" in table


def test_a_check_that_passes_now_leaves_checks_failed_and_a_reader_not_asked_is_not_kept() -> None:
    """cbse/class-10-science.json cited every name two pages off; the pass recorded the failed
    citation check and promoted anyway. When the citations were corrected and the pass re-run,
    the check passed and the file STILL listed it under ``checks_failed``, and still claimed
    ``second_reader_agrees`` from a run over the uncorrected file, because apply() only ever
    appended. This pass's names are replaced by this pass's verdicts; the build's are kept."""
    document = _document({3: CONTENTS + "\nContents of the book"})
    file = _file([_unit(1, "Contents of the book", 3, CHAPTERS)])
    file["provenance"] = {
        "checks_passed": ["unit_order_is_1_to_n", audit.CHECK_SECOND_READER],
        "checks_failed": [audit.CHECK_NAMES_ON_PAGE, "every_unit_has_a_source_ref"],
    }
    report = audit.check_file("cbse/class-10-science.json", file, _sources(document))
    assert report.decision == "hold", report.reasons
    after = audit.apply(file, report, now=NOW)
    passed = after["provenance"]["checks_passed"]
    failed = after["provenance"]["checks_failed"]
    assert audit.CHECK_NAMES_ON_PAGE in passed and audit.CHECK_NAMES_ON_PAGE not in failed
    assert audit.CHECK_SECOND_READER not in passed, "code decided; the reader was not asked"
    assert "unit_order_is_1_to_n" in passed and "every_unit_has_a_source_ref" in failed


def test_weak_evidence_or_uncounted_coverage_goes_to_the_second_reader() -> None:
    # No "Chapter n" numbering on the cited page, so coverage cannot be counted in code.
    document = _document({3: "section a civics 1 the union legislature 2 the union executive"})
    file = _file(
        [
            _unit(1, "Civics: The Union Legislature", 3, [("The Union Legislature", 3)]),
            _unit(2, "Civics: The Union Executive", 3, [("The Union Executive", 3)]),
        ]
    )
    report = audit.check_file("icse/x.json", file, _sources(document))
    assert report.decision == "ask"
    assert any("weakly" in reason for reason in report.reasons)
    assert any("coverage" in reason for reason in report.reasons)

    calls: list[str] = []

    def agrees(system: str, user: str) -> tuple[str, str]:
        calls.append(user)
        return json.dumps({"agrees": True, "problems": []}), "anthropic/claude-opus-5"

    ledger = audit.CostLedger(budget_usd=5.0)
    ledger.add(model="x", prompt_tokens=1, completion_tokens=1, cost_usd=0.0)  # a prior call
    held = audit.second_read(file, report, _sources(document), complete=agrees, ledger=ledger)
    assert held.decision == "hold"
    assert held.verifier == "anthropic/claude-opus-5"
    assert held.status_after == "verified"
    assert len(calls) == 1
    assert "The Union Legislature" in calls[0] and "civics" in calls[0]


def test_the_second_reader_disagreeing_flags_the_file_with_its_reason() -> None:
    document = _document({3: "section a civics 1 the union legislature 2 the union executive"})
    file = _file([_unit(1, "Civics: The Union Legislature", 3, [("The Union Legislature", 3)])])
    report = audit.check_file("icse/x.json", file, _sources(document))
    assert report.decision == "ask"

    def disagrees(system: str, user: str) -> tuple[str, str]:
        reply = {"agrees": False, "problems": ["The Union Executive is missing from the outline"]}
        return json.dumps(reply), "anthropic/claude-opus-5"

    flagged = audit.second_read(
        file, report, _sources(document), complete=disagrees, ledger=audit.CostLedger(5.0)
    )
    assert flagged.decision == "flag"
    assert flagged.status_after == "provisional"
    assert any("The Union Executive is missing" in reason for reason in flagged.reasons)
    after = audit.apply(file, flagged, now=NOW)
    assert after["status"] == "provisional"
    assert "The Union Executive is missing" in after["status_reason"]
    assert after["units"] == file["units"]


def test_the_budget_cap_stops_the_second_reader_and_the_file_says_so() -> None:
    document = _document({3: "section a civics 1 the union legislature"})
    file = _file([_unit(1, "Civics: The Union Legislature", 3, [("The Union Legislature", 3)])])
    report = audit.check_file("icse/x.json", file, _sources(document))

    def never(system: str, user: str) -> tuple[str, str]:
        raise AssertionError("over budget: the model must not be called")

    ledger = audit.CostLedger(budget_usd=0.01)
    ledger.add(model="x", prompt_tokens=1, completion_tokens=1, cost_usd=0.02)
    unread = audit.second_read(file, report, _sources(document), complete=never, ledger=ledger)
    assert unread.decision == "unread"
    assert unread.status_after == "provisional"
    assert any("budget cap" in reason for reason in unread.reasons)
    second = next(c for c in unread.checks if c.name == "second_reader_agrees")
    assert second.passed is None  # skipped, never passed


def test_a_source_that_changed_since_the_build_is_flagged_not_reread() -> None:
    document = _document({3: CONTENTS + "\nContents of the book"}, sha="c" * 64)
    file = _file([_unit(1, "Contents of the book", 3, CHAPTERS)])
    report = audit.check_file("x.json", file, _sources(document))
    assert report.decision == "flag"
    assert any(audit.CHECK_SOURCE_HASH in reason for reason in report.reasons)
    assert report.sources["doc"]["sha256_matches_build"] is False


def test_an_unreachable_source_is_a_fact_about_the_host_not_the_syllabus() -> None:
    file = _file([_unit(1, "Contents of the book", 3, CHAPTERS)])
    sources = {"doc": audit.Source("doc", None, error="unreachable: URLError")}
    report = audit.check_file("x.json", file, sources)
    assert report.decision == "unverifiable"
    assert report.status_after == "provisional"
    fetched = next(c for c in report.checks if c.name == audit.CHECK_SOURCE_FETCHED)
    assert fetched.passed is None  # could not run: neither a pass nor a fail
    assert any("unreachable: URLError" in reason for reason in report.reasons)
    after = audit.apply(file, report, now=NOW)
    assert after["status"] == "provisional"
    assert "could not be fetched" in after["status_reason"]


def test_a_withdrawn_topic_layer_keeps_a_true_unit_list_provisional() -> None:
    # A CISCE booklet: unit headings in prose, no chapter numbering for code to count.
    document = _document({3: "Syllabus\nNumber Systems\nreal numbers\nPolynomials\nfactors"})
    file = _file([_unit(1, "Number Systems", 3, None), _unit(2, "Polynomials", 3, None)])
    report = audit.check_file("icse/x.json", file, _sources(document))
    assert report.decision == "incomplete"
    assert report.status_after == "provisional"
    assert any("topics: null" in reason for reason in report.reasons)
    # The unit names did hold, and the file records that much.
    assert audit.CHECK_NAMES_IN_SOURCE in [c.name for c in report.checks if c.passed]


def test_coverage_fails_when_the_document_numbers_more_than_the_file_holds() -> None:
    document = _document({3: CONTENTS + "\nContents of the book"})
    file = _file([_unit(1, "Contents of the book", 3, CHAPTERS[:2])])  # two of four chapters
    report = audit.check_file("x.json", file, _sources(document))
    assert report.decision == "flag"
    coverage = next(c for c in report.checks if c.name == audit.CHECK_COVERAGE)
    assert coverage.failed
    assert "Contents of the book: the document numbers 4, the file has 2" in coverage.detail


def test_a_duplicate_name_within_a_unit_is_a_failure_a_learner_would_meet() -> None:
    document = _document({3: CONTENTS + "\nContents of the book"})
    file = _file([_unit(1, "Contents of the book", 3, CHAPTERS + [("Polynomials", 3)])])
    report = audit.check_file("x.json", file, _sources(document))
    dupes = next(c for c in report.checks if c.name == audit.CHECK_DUPLICATES)
    assert dupes.failed and "polynomials" in dupes.detail


def test_a_blocked_file_gets_a_reason_and_nothing_else_changes() -> None:
    file = _file(None, blocker="browser_required")
    report = audit.check_file("telangana/x.json", file, {})
    assert report.decision == "blocked"
    after = audit.apply(file, report, now=NOW)
    assert after["status"] == "provisional"
    assert after["status_reason"] == (
        "not checked: the file holds no units (blocker: browser_required)"
    )
    assert after["units"] is None
    assert after["provenance"]["verified_by"] is None
    assert {k: v for k, v in after.items() if k not in {"status_reason", "provenance"}} == {
        k: v for k, v in file.items() if k != "provenance"
    }


def test_dump_writes_the_directorys_own_format() -> None:
    file = _file([_unit(1, "Contents of the book", 3, CHAPTERS)])
    text = audit.dump(file)
    assert text.endswith("}\n")
    assert text.startswith('{\n  "framework_id": "cbse",\n')
    assert json.loads(text) == file


# --- the owner's table -----------------------------------------------------------------------
def test_the_table_lists_every_file_and_names_what_failed_and_what_it_cost() -> None:
    good = _document({3: CONTENTS + "\nContents of the book"})
    held = audit.check_file(
        "cbse/good.json", _file([_unit(1, "Contents of the book", 3, CHAPTERS)]), _sources(good)
    )
    bad = _document({3: CONTENTS + "\nModule VII Human and Environment"})
    flagged = audit.check_file(
        "nios/bad.json", _file([_unit(1, "Human Environment", 3, CHAPTERS)]), _sources(bad)
    )
    blocked = audit.check_file("telangana/none.json", _file(None, blocker="browser_required"), {})
    ledger = audit.CostLedger(budget_usd=10.0)
    ledger.add(
        model="anthropic/claude-opus-5", prompt_tokens=1000, completion_tokens=50, cost_usd=0.00625
    )
    table = audit.render_table([held, flagged, blocked], ledger, checked_at=NOW)
    for path in ("cbse/good.json", "nios/bad.json", "telangana/none.json"):
        assert f"`{path}`" in table
    assert "| verified |" in table
    assert "unit 1: Human Environment" in table
    assert "no units to check" in table
    assert (
        "1 calls, 1000 prompt tokens, 50 completion tokens, USD 0.0063 of a USD 10.00 cap" in table
    )
    assert "sha256 matches the build" in table


def test_regenerating_the_table_keeps_what_a_person_wrote_around_it() -> None:
    generated = audit.render_table([], None, checked_at=NOW)
    first = audit.merge_generated("# Verification\n\nIntro.\n", generated)
    assert first.startswith("# Verification\n\nIntro.\n")
    with_prose = first + "\n## Coverage, read by hand\n\nCBSE class 8 maths is two book parts.\n"
    again = audit.merge_generated(with_prose, audit.render_table([], None, checked_at="later"))
    assert "CBSE class 8 maths is two book parts." in again
    assert "Intro." in again
    assert "Checked at later" in again and "Checked at 2026" not in again


# --- what the registry loads from a verified file -----------------------------------------
def test_the_registry_carries_the_files_own_verifier_not_a_hardcoded_owner(tmp_path: Path) -> None:
    (tmp_path / "frameworks.seed.json").write_text(
        json.dumps({"frameworks": [{"id": "cbse", "name": "CBSE", "aliases": []}]})
    )
    directory = tmp_path / "syllabi" / "cbse"
    directory.mkdir(parents=True)
    file = _file([_unit(1, "Contents of the book", 3, CHAPTERS)])
    file["status"] = "verified"
    file["provenance"].update(
        {
            "verifier": audit.CODE_VERIFIER,
            "verified_at": NOW,
            "verified_by": "system",
            "checks_passed": ["unit_order_is_1_to_n", audit.CHECK_NAMES_IN_SOURCE],
        }
    )
    (directory / "class-9-mathematics.json").write_text(audit.dump(file))
    seed = load_seed(tmp_path)
    unit = next(p for p in seed.provenance if p.node_id)
    assert {p.verified_by for p in seed.provenance} == {"system"}
    assert {p.verified_at for p in seed.provenance} == {NOW}
    assert {p.verifier_model for p in seed.provenance} == {audit.CODE_VERIFIER}
    assert audit.CHECK_NAMES_IN_SOURCE in unit.checks_passed


def test_the_second_reader_is_shown_the_clean_rendering_not_the_doubled_one() -> None:
    # Matching reads both extractors' text; the model reads one. A marker only the reader view
    # carries must reach the prompt, and the merged view's marker must not.
    matching = _document({3: "section a civics 1 the union legislature MERGED-ONLY"})
    reader = _document({3: "section a civics 1 the union legislature READER-ONLY"})
    file = _file([_unit(1, "Civics: The Union Legislature", 3, [("The Union Legislature", 3)])])
    sources = {"doc": audit.Source("doc", matching, transport="test", reader=reader)}
    report = audit.check_file("icse/x.json", file, sources)
    assert report.decision == "ask"
    prompts: list[str] = []

    def agrees(system: str, user: str) -> tuple[str, str]:
        prompts.append(user)
        return json.dumps({"agrees": True, "problems": []}), "m"

    audit.second_read(file, report, sources, complete=agrees, ledger=audit.CostLedger(1.0))
    assert "READER-ONLY" in prompts[0] and "MERGED-ONLY" not in prompts[0]


def test_numbered_runs_read_the_documents_own_structure() -> None:
    text = (
        "UNIT I: SETS AND FUNCTIONS\n1.  Sets\n2.  Relations & Functions\n"
        "3.  Trigonometric Functions\nUNIT II: ALGEBRA\n1.  Complex Numbers\n2.  Linear Inequalities\n"
        "   10 marks in all\n"  # a marks line: neither 1 nor next in sequence, so noise
        "Chapter 1 Power Play\nChapter 2 A Story of Numbers\n"
    )
    assert audit.numbered_runs(text) == [3, 2, 2]


def test_a_chapter_missing_from_the_middle_of_a_unit_fails_coverage_by_name() -> None:
    # CBSE XI mathematics on 2026-09-05: 3+5+3+1+2 chapters in the document, 3+5+2+1+2 in the
    # file. Five units either way, so a unit-level count says nothing; the runs do.
    page = (
        "UNIT I: SETS AND FUNCTIONS\n1. Sets\n2. Relations & Functions\n3. Trigonometric Functions\n"
        "UNIT II: ALGEBRA\n1. Complex Numbers\n2. Linear Inequalities\n"
        "UNIT III: COORDINATE GEOMETRY\n1. Straight Lines\n2. Conic Sections\n"
        "3. Introduction to Three-dimensional Geometry\n"
        "Sets and Functions\nAlgebra\nCoordinate Geometry\n"
    )
    document = _document({2: page})
    file = _file(
        [
            _unit(
                1,
                "Sets and Functions",
                2,
                [("Sets", 2), ("Relations & Functions", 2), ("Trigonometric Functions", 2)],
            ),
            _unit(2, "Algebra", 2, [("Complex Numbers", 2), ("Linear Inequalities", 2)]),
            _unit(3, "Coordinate Geometry", 2, [("Straight Lines", 2), ("Conic Sections", 2)]),
        ]
    )
    report = audit.check_file("cbse/class-11-mathematics.json", file, _sources(document))
    assert report.decision == "flag"
    coverage = next(c for c in report.checks if c.name == audit.CHECK_COVERAGE)
    assert coverage.failed
    assert "Coordinate Geometry: the document numbers 3, the file has 2" in coverage.detail
    assert "Introduction to Three-dimensional Geometry" not in coverage.detail  # never invented


def test_numbering_that_fits_nothing_is_handed_to_the_second_reader_not_guessed() -> None:
    page = "1. Sets\n2. Relations\n3. Functions\n1. Algebra\nContents of the book\n" + CONTENTS
    document = _document({3: page})
    file = _file([_unit(1, "Contents of the book", 3, CHAPTERS)])  # 1 unit, 4 topics; runs 3+1+4
    report = audit.check_file("x.json", file, _sources(document))
    assert report.decision == "ask"
    coverage = next(c for c in report.checks if c.name == audit.CHECK_COVERAGE)
    assert coverage.passed is None


# --- the live second reader ------------------------------------------------------------------
def test_the_live_second_reader_goes_through_model_call_not_litellm_directly(monkeypatch) -> None:
    """One model in the verify chain refuses ``temperature`` and answers 400; litellm raises the
    LAST model's failure, so a direct call reads the whole chain as unreachable and every file
    code could not decide is left "unread" for a knob. The first live run of this pass, 2026-09-05,
    did exactly that: 22 files, 0 verdicts. ``model_call.complete`` is the funnel that drops the
    knob and retries, and this is the test that keeps the pass inside it."""
    import litellm
    from wobo_gateway import model_call

    def direct(**kwargs):
        raise AssertionError("the second reader must not call litellm.completion directly")

    seen: dict[str, Any] = {}

    class _Usage:
        prompt_tokens = 1200
        completion_tokens = 30

    class _Message:
        content = '{"agrees": true, "problems": []}'

    class _Choice:
        message = _Message()

    class _Response:
        model = "openai/gpt-5.6-terra"
        usage = _Usage()
        choices = [_Choice()]

    def funnel(**kwargs):
        seen.update(kwargs)
        return _Response()

    monkeypatch.setattr(litellm, "completion", direct)
    monkeypatch.setattr(model_call, "complete", funnel)
    ledger = audit.CostLedger(budget_usd=1.0)
    text, model = audit.live_completion(ledger)("system", "user")
    assert text == '{"agrees": true, "problems": []}'
    assert model == "openai/gpt-5.6-terra"
    assert seen["model"] == "openai/gpt-5.6-sol" and seen["fallbacks"]  # the verify tier
    assert seen["messages"][0] == {"role": "system", "content": "system"}
    assert [call["prompt_tokens"] for call in ledger.calls] == [1200]
    assert ledger.calls[0]["model"] == "openai/gpt-5.6-terra"
