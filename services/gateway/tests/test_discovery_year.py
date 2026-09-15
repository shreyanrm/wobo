"""The document's year against the academic year (``docs/BOARD-COLD-START.md`` §5).

**The fault this exists for, measured.** On 2026-09-15 a two-minds run read Maharashtra's Class 10
Mathematics off the board's own site and would have published it. The transcription was faithful:
every one of the thirteen names is on pages 158 and 159 of ``mahahsscboard.in/sscsyllabus.pdf``,
the document's sha256 re-fetches identical, and the second reader agreed. The document is the
syllabus sanctioned by the Government of Maharashtra letter of **12/03/2012** — its own first page
says so, its ``/CreationDate`` is ``D:20130524160248+05'30'``, and the extractor answered
``"version": "2013"`` when it was asked what year the document states. Maharashtra revised Std X
Mathematics for 2018-19: the withdrawn reading is missing Financial Planning and Pythagoras
Theorem and carries Geometric Progression, Cramer's rule, normal distribution and Euler's formula,
none of which the board sets at Std X any more.

Nine structural checks passed. ``would_publish`` was ``True``. **No stage — search, fetch,
extract, verify, persist — asked what year the document was.** A fourteen-year-old in Pune would
have been taught a thirteen-year-old syllabus under "Found on the board's site, still checking".

Every number in this file is that run's own evidence, so the fixture is the fault.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import pytest
from test_discovery import (
    AGREES,
    SECOND_READER_MODEL,
    minimal_pdf,
    opener_for,
    stub_completion,
)
from wobo_gateway.curriculum.discovery import dating, job, verify
from wobo_gateway.curriculum.discovery.extract import SyllabusRequest, parse_syllabus
from wobo_gateway.curriculum.discovery.fetch import fetch_document, reset_robots_cache
from wobo_gateway.curriculum.discovery.job import (
    InMemoryJobStore,
    JobState,
    run_discovery,
)
from wobo_gateway.curriculum.discovery.search import MockSearchProvider, SearchResult

# --- the run's own evidence ------------------------------------------------------------------

#: ``/CreationDate`` and ``/ModDate`` of ``mahahsscboard.in/sscsyllabus.pdf``, read off the file.
MSBSHSE_CREATED = "D:20130524160248+05'30'"
MSBSHSE_MODIFIED = "D:20130524161849+05'30'"
MSBSHSE_URL = "https://mahahsscboard.in/sscsyllabus.pdf"

#: The moment of the run the fault was found in. Fixed, so this suite does not rot in April.
NOW = datetime(2026, 9, 15, 17, 6, 30, tzinfo=UTC)

#: Page 1 and pages 158-159 of that pdf, verbatim enough to be the same document to every stage.
MSBSHSE_PAGES = [
    "SYLLABI\n"
    "FOR\n"
    "STANDARDS IX AND X\n"
    "(As sanctioned under Government of Maharashtra\n"
    "Letter No. SSC-210/(195/10)/ 12/03/2012\n"
    "Maharashtra State Board of Secondary\n"
    "And Higher Secondary Education,\n"
    "Pune - 411 004.",
    "137\n"
    "Std. X\n"
    "Mathematics\n"
    "Algebra\n"
    "1. Arithmetic Progression :\n"
    "Introduction to Sequence\n"
    "Arithmetic Progression (A.P.) and Geometric Progression (G.P.)\n"
    "2. Quadratic Equations\n"
    "Nature of roots based on discriminant\n"
    "3. Linear equations in two variables\n"
    "Determinant of order two\n"
    "Cramer's rule\n"
    "4. Probability :\n"
    "Classical definition of probability\n"
    "5. Statistics :\n"
    "Introduction to normal distribution",
]


def msbshse_request(**overrides: Any) -> SyllabusRequest:
    fields: dict[str, Any] = {
        "framework_id": "msbshse",
        "framework_name": "Maharashtra State Board of Secondary and Higher Secondary Education",
        "level": "Class 10",
        "subject": "Mathematics",
        "country": "IN",
        "official_site": "https://www.mahahsscboard.in",
    }
    fields.update(overrides)
    return SyllabusRequest(**fields)


def msbshse_bytes(*, dated: bool = True) -> bytes:
    info = (
        {"CreationDate": MSBSHSE_CREATED, "ModDate": MSBSHSE_MODIFIED, "Creator": "PageMaker 7.0"}
        if dated
        else None
    )
    return minimal_pdf(MSBSHSE_PAGES, info=info)


def msbshse_document(*, dated: bool = True):
    bodies = {MSBSHSE_URL: ("application/pdf", msbshse_bytes(dated=dated))}
    return fetch_document(MSBSHSE_URL, opener=opener_for(bodies))


def msbshse_extraction(document, *, version: str = "2013") -> dict[str, Any]:
    """What the generate tier actually returned on 2026-09-15, trimmed to the fixture's pages."""
    return {
        "version": version,
        "note": "This document covers the Std. X Mathematics syllabus in Algebra and Geometry.",
        "units": [
            {
                "title": "Algebra",
                "source_ref": {"document_id": document.id, "page": 2},
                "topics": [
                    {
                        "title": "Arithmetic Progression",
                        "contents": ["Introduction to Sequence"],
                        "source_ref": {"document_id": document.id, "page": 2},
                    },
                    {
                        "title": "Quadratic Equations",
                        "contents": ["Nature of roots based on discriminant"],
                        "source_ref": {"document_id": document.id, "page": 2},
                    },
                ],
            }
        ],
    }


def msbshse_syllabus(document, *, version: str = "2013"):
    return parse_syllabus(
        msbshse_extraction(document, version=version),
        request=msbshse_request(),
        document=document,
    )


@pytest.fixture(autouse=True)
def _no_robots_memory():
    reset_robots_cache()
    yield
    reset_robots_cache()


# --- the academic year ------------------------------------------------------------------------


def test_the_indian_academic_year_turns_in_april_not_in_january():
    assert dating.academic_year(datetime(2026, 3, 31, tzinfo=UTC), "IN") == 2025
    assert dating.academic_year(datetime(2026, 4, 1, tzinfo=UTC), "IN") == 2026
    assert dating.academic_year(NOW, "IN") == 2026


def test_a_board_outside_india_turns_on_its_own_month():
    assert dating.academic_year(datetime(2026, 7, 1, tzinfo=UTC), "GB") == 2025
    assert dating.academic_year(datetime(2026, 9, 1, tzinfo=UTC), "GB") == 2026
    # A country we have no month for still gets an answer rather than an exception.
    assert dating.academic_year(NOW, "ZZ") in {2025, 2026}
    assert dating.academic_year(NOW, None) in {2025, 2026}


def test_the_academic_year_reads_back_as_a_label_a_person_would_write():
    assert dating.academic_year_label(2026, "IN") == "2026-27"
    assert dating.academic_year_label(2009, "IN") == "2009-10"


# --- reading a year off a label ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("2013", 2013),
        ("2026-27", 2026),
        ("2026-2027", 2026),
        ("AY 2018-19", 2018),
        ("2026-27 rev 2", 2026),
        ("undated", None),
        ("", None),
        (None, None),
        ("rev 2", None),
        ("Class 10", None),
        ("1899", None),
        ("2199", None),
    ],
)
def test_a_version_label_yields_the_year_it_states_or_nothing(label, expected):
    assert dating.year_of_label(label) == expected


# --- the pdf says when it was made --------------------------------------------------------------


@pytest.mark.parametrize(
    ("stamp", "expected"),
    [
        (MSBSHSE_CREATED, 2013),
        ("D:20250401120000Z", 2025),
        ("D:2013", 2013),
        ("2013-05-24T16:02:48+05:30", 2013),
        ("", None),
        (None, None),
        ("D:notadate", None),
    ],
)
def test_a_pdf_date_stamp_yields_its_year(stamp, expected):
    assert dating.year_of_pdf_date(stamp) == expected


def test_the_fetched_document_carries_the_date_the_file_itself_was_made():
    document = msbshse_document()
    assert document.created_at == "2013-05-24"
    assert document.modified_at == "2013-05-24"
    assert document.as_provenance()["created_at"] == "2013-05-24"


def test_a_pdf_with_no_information_dictionary_carries_no_date_and_claims_none():
    document = msbshse_document(dated=False)
    assert document.created_at is None
    assert document.modified_at is None
    assert dating.edition_year(document) is None


# --- which witness is believed ------------------------------------------------------------------


def test_the_file_is_a_ceiling_no_reading_can_lift():
    """A hallucinated "2026-27" must not talk the gate out of a verdict.

    Ranking the reading above the file was the first cut of this module and it was wrong: the
    one thing a model can do to defeat the check is state the year we want to hear, and the
    2013 file it is reading cannot hold a 2026-27 syllabus whatever it says.
    """
    document = msbshse_document()  # /CreationDate 2013-05-24
    assert dating.edition_year(document, reading_version="2026-27") == 2014, (
        "the file's year plus the one year of grace a board typesets ahead by"
    )
    witness = dating.edition_evidence(document, reading_version="2026-27")
    assert "the file cannot hold" in witness.detail


def test_a_reading_may_lower_the_year_because_an_old_syllabus_can_be_exported_today():
    bodies = {
        MSBSHSE_URL: (
            "application/pdf",
            minimal_pdf(
                MSBSHSE_PAGES,
                info={
                    "CreationDate": "D:20240101000000Z",
                },
            ),
        )
    }
    document = fetch_document(MSBSHSE_URL, opener=opener_for(bodies))
    assert dating.edition_year(document) == 2024
    assert dating.edition_year(document, reading_version="2013") == 2013
    assert dating.staleness(2013, now=NOW, country="IN").stale is True


def test_years_printed_in_the_text_are_never_a_witness():
    """A compilation's pages carry every year but this subject's edition.

    Maharashtra's pdf names 1954, 1986, 2005, 2010, 2012, 2013, 2014 and 2020 across two hundred
    pages of nineteen subjects, and the sixty-eight pages the reader was given for Mathematics
    are mostly other subjects'. A witness that can be any year in the document is not evidence
    about this document's edition, so the text is not asked.
    """
    pages = [*MSBSHSE_PAGES, "Revised syllabus w.e.f. 2024-25 for Social Sciences"]
    bodies = {
        MSBSHSE_URL: (
            "application/pdf",
            minimal_pdf(
                pages,
                info={
                    "CreationDate": MSBSHSE_CREATED,
                },
            ),
        )
    }
    document = fetch_document(MSBSHSE_URL, opener=opener_for(bodies))
    assert dating.edition_year(document) == 2013


def test_the_evidence_says_which_witness_answered_so_a_person_can_check_it():
    document = msbshse_document()
    witness = dating.edition_evidence(document, reading_version="2013")
    assert witness is not None
    assert witness.year == 2013
    assert "reading" in witness.witness
    assert dating.edition_evidence(document).witness.startswith("the document")


# --- the verdict --------------------------------------------------------------------------------


def test_a_document_thirteen_years_older_than_the_learners_year_is_out_of_date():
    verdict = dating.staleness(2013, now=NOW, country="IN")
    assert verdict.stale is True
    assert "2013" in verdict.detail and "2026-27" in verdict.detail


def test_a_document_inside_the_window_is_not_out_of_date():
    # NIOS's published syllabus is 2023 and it is the oldest thing the product serves today.
    assert dating.staleness(2023, now=NOW, country="IN").stale is False
    assert dating.staleness(2026, now=NOW, country="IN").stale is False


def test_a_document_published_ahead_of_the_year_is_never_out_of_date():
    assert dating.staleness(2027, now=NOW, country="IN").stale is False


def test_no_year_at_all_is_not_a_verdict_either_way():
    assert dating.staleness(None, now=NOW, country="IN").stale is None


def test_the_owner_can_widen_the_window_from_the_console_without_a_deploy(monkeypatch):
    monkeypatch.setattr(dating, "_dial", lambda key: 20 if key == dating.MAX_AGE_KEY else None)
    assert dating.max_age_years() == 20
    assert dating.staleness(2013, now=NOW, country="IN").stale is False


def test_a_dial_that_will_not_answer_never_stops_a_run(monkeypatch):
    def _boom(key: str):
        raise RuntimeError("ops.settings is down")

    monkeypatch.setattr(dating, "_dial", _boom)
    assert dating.max_age_years() == dating.DEFAULT_MAX_AGE_YEARS


# --- the gate before a model is paid --------------------------------------------------------------


def test_the_document_is_refused_for_its_year_before_a_model_reads_it():
    document = msbshse_document()
    wrong = verify.document_is_current(document, msbshse_request(), now=NOW)
    assert wrong is not None
    assert "2013" in wrong


def test_a_document_that_does_not_date_itself_passes_the_gate():
    assert (
        verify.document_is_current(msbshse_document(dated=False), msbshse_request(), now=NOW)
        is None
    )


# --- the check in the report ----------------------------------------------------------------------


def test_the_year_is_one_of_the_structural_checks_and_it_fails_on_the_withdrawn_document():
    document = msbshse_document()
    checks = verify.structural_checks(
        msbshse_syllabus(document), document, msbshse_request(), now=NOW
    )
    year = next(check for check in checks if check.name == verify.CHECK_DOCUMENT_YEAR)
    assert year.passed is False
    assert "2013" in year.detail


def test_the_check_passes_when_the_reading_states_this_year():
    document = msbshse_document(dated=False)
    checks = verify.structural_checks(
        msbshse_syllabus(document, version="2026-27"), document, msbshse_request(), now=NOW
    )
    year = next(check for check in checks if check.name == verify.CHECK_DOCUMENT_YEAR)
    assert year.passed is True


def test_a_document_that_dates_itself_nowhere_leaves_the_check_unable_to_run():
    document = msbshse_document(dated=False)
    report = verify.verify_extraction(
        msbshse_syllabus(document, version="undated"),
        document,
        msbshse_request(),
        complete=stub_completion(AGREES, model=SECOND_READER_MODEL),
        other_than="test-model-1",
        now=NOW,
    )
    year = next(check for check in report.checks if check.name == verify.CHECK_DOCUMENT_YEAR)
    assert year.passed is None
    assert report.ok is True, "an undated document is still readable"
    assert report.promotable is False, "and it can never be promoted to verified on its own"


def test_a_failed_year_takes_the_whole_report_down():
    document = msbshse_document()
    report = verify.verify_extraction(
        msbshse_syllabus(document),
        document,
        msbshse_request(),
        second_reader=False,
        now=NOW,
    )
    assert report.ok is False
    assert verify.CHECK_DOCUMENT_YEAR in {check.name for check in report.failures}


def test_an_out_of_date_document_is_never_redrawn_because_a_redraw_cannot_change_its_year():
    document = msbshse_document()
    report = verify.verify_extraction(
        msbshse_syllabus(document), document, msbshse_request(), second_reader=False, now=NOW
    )
    assert verify.redrawable(report) is False
    fresh = verify.verify_extraction(
        msbshse_syllabus(document, version="2026-27"),
        document,
        msbshse_request(),
        second_reader=False,
        now=NOW,
    )
    assert fresh.ok is False, "the file is still from 2013"


# --- the pipeline ---------------------------------------------------------------------------------


def run_msbshse_job(**overrides: Any):
    document = msbshse_document()
    bodies = {MSBSHSE_URL: ("application/pdf", msbshse_bytes())}
    defaults: dict[str, Any] = {
        "store": InMemoryJobStore(),
        "search_provider": MockSearchProvider([SearchResult(url=MSBSHSE_URL)]),
        "fetch_fn": lambda url, **kwargs: fetch_document(url, opener=opener_for(bodies)),
        "complete_generate": stub_completion(json.dumps(msbshse_extraction(document))),
        "complete_verify": stub_completion(AGREES, model=SECOND_READER_MODEL),
        "now": NOW,
    }
    defaults.update(overrides)
    return run_discovery(msbshse_request(), **defaults)


def test_the_withdrawn_maharashtra_syllabus_is_refused_and_nothing_is_published():
    record = run_msbshse_job()
    assert record.state is JobState.REFUSED
    assert record.reason == "document_out_of_date"
    assert record.syllabus is None, "a withdrawn syllabus never reaches a learner"
    assert "2013" in record.detail


def test_no_model_is_paid_to_read_a_document_that_is_already_out_of_date():
    generate = stub_completion(json.dumps({"units": []}))
    verify_stub = stub_completion(AGREES, model=SECOND_READER_MODEL)
    record = run_msbshse_job(complete_generate=generate, complete_verify=verify_stub)
    assert record.state is JobState.REFUSED
    assert generate.calls == [], "the file's own date is free to read"
    assert verify_stub.calls == []


def test_the_refusal_says_the_honest_thing_and_opens_the_own_syllabus_door():
    record = run_msbshse_job()
    assert record.message.endswith("Show me your syllabus and I will build it with you.")
    assert "!" not in record.message
    assert "2013" not in record.message, "a learner is never shown our machinery"


def test_the_refusal_reason_has_words_for_the_console():
    from wobo_gateway.curriculum import desk

    assert "document_out_of_date" in desk._REASONS
    assert "document_out_of_date" in job._REFUSAL_LINES


def test_the_same_document_published_this_year_is_read_and_stored():
    """The gate is about the year, not about Maharashtra."""
    bodies = {
        MSBSHSE_URL: (
            "application/pdf",
            minimal_pdf(MSBSHSE_PAGES, info={"CreationDate": "D:20260401090000+05'30'"}),
        )
    }
    document = fetch_document(MSBSHSE_URL, opener=opener_for(bodies))
    record = run_msbshse_job(
        fetch_fn=lambda url, **kwargs: fetch_document(url, opener=opener_for(bodies)),
        complete_generate=stub_completion(
            json.dumps(msbshse_extraction(document, version="2026-27"))
        ),
    )
    assert record.state is JobState.PROVISIONAL
    assert record.syllabus is not None
    assert record.report is not None
    assert verify.CHECK_DOCUMENT_YEAR in record.report["checks_passed"]


def test_a_pdf_edited_incrementally_is_dated_by_its_later_stamp():
    """A 2009 template rewritten in 2026 keeps its 2009 /CreationDate.

    Taking the creation date alone would refuse a current syllabus for being what it is not, so
    the ceiling is the later of the two stamps the producer wrote INSIDE the file. A trivial
    re-save that lifts it is still caught by the other witness: the reading's stated year.
    """
    bodies = {
        MSBSHSE_URL: (
            "application/pdf",
            minimal_pdf(
                MSBSHSE_PAGES,
                info={"CreationDate": "D:20090101000000Z", "ModDate": "D:20260401000000Z"},
            ),
        )
    }
    document = fetch_document(MSBSHSE_URL, opener=opener_for(bodies))
    assert document.created_at == "2009-01-01"
    assert document.modified_at == "2026-04-01"
    assert dating.edition_year(document) == 2026
    assert verify.document_is_current(document, msbshse_request(), now=NOW) is None
    # And the reading still settles it downward when it says the document is old.
    assert dating.edition_year(document, reading_version="2013") == 2013
