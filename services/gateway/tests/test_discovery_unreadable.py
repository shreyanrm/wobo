"""The refusal that told a learner the opposite of what happened.

**What the live run did.** On 2026-09-15 discovery was pointed at Uttar Pradesh, Class 10,
Mathematics. The search found the board's own file on the board's own host —
``prereg.upmsp.edu.in/Downloads/Syllabus/Class10/928_Class-10th%20Math.pdf``, whose pdf carries
the title "Microsoft Word - Class 10th" — and that file **is** the syllabus: an earlier run of the
same afternoon had a model transcribe it, and what came back is the UP Board Class 10 Mathematics
course, seven units, 70 marks (``harness/reports/discovery-20260915-163622-states/upmsp.json``).
Its text layer is a **legacy Devanagari font**: pypdf reads ``bdkbZ&1 % la[;k i)fr&`` where the
page shows ``इकाई-1 : संख्या पद्धति``. So ``document_is_plausible`` — which asks, for nothing, whether
the document names the level and the subject before a model is paid to read it — found neither,
and the run refused under ``no_syllabus_in_document``.

**Why that is a lie, not a rounding.** The reason's learner line is *"What I found … is not the
syllabus itself"* and the console's gloss is *"what was found is not the syllabus"*. Both are the
opposite of the fact. It **is** the syllabus, on the board's own host, and what failed is our
reading of it. A refusal that names the board's document as not-a-syllabus sends the operator
away from the one board in the queue that already has its document found, and tells a learner
something false about their own board.

**And the one true sentence was thrown away.** The record's ``detail`` — "the document never names
Class 10; the document never names Mathematics" — lives on the in-memory ``JobRecord`` and the
worker never wrote it to ``discovery_jobs.result``, so the console queue row carries the reason
word and nothing else.

**Tamil Nadu, the same run, the same hole.** One candidate, ``dge.tn.gov.in/docs/examina/sslc.pdf``,
titled "SSLC Public Examination – Scheme of Examination", refused ``tls_untrusted``. The row says
"pages were found, the document itself would not open", which reads as a TLS problem worth
retrying. It is not: that host is the exam directorate, the candidate was a scheme of examination
rather than a syllabus, and Tamil Nadu's syllabus is SCERT's. Nothing in the run recorded what was
tried, so nobody reading the console could learn any of that. A refusal has to carry the trail.

Nothing here needs a key or a network.
"""

from __future__ import annotations

import json

import pytest
from test_discovery import (
    AGREES,
    SECOND_READER_MODEL,
    cbse_document,
    cbse_request,
    stub_completion,
)
from wobo_gateway.curriculum import desk as desk_mod
from wobo_gateway.curriculum.discovery import job as job_mod
from wobo_gateway.curriculum.discovery import verify
from wobo_gateway.curriculum.discovery.extract import SyllabusRequest
from wobo_gateway.curriculum.discovery.fetch import Document, FetchRefused, Page
from wobo_gateway.curriculum.discovery.job import InMemoryJobStore, JobState, run_discovery
from wobo_gateway.curriculum.discovery.search import MockSearchProvider, SearchResult

# The real url, the real pdf title and the real first lines of the real text layer, off
# ``harness/reports/discovery-20260915-170630-twominds/upmsp.json``.
UP_URL = "https://prereg.upmsp.edu.in/Downloads/Syllabus/Class10/928_Class-10th%20Math.pdf"
UP_TITLE = "Microsoft Word - Class 10th"
UP_TEXT = (
    "bdkbZ&1 % la[;k i)fr&\n"
    "¼1½ okLrfod la[;k,¡\n"
    "bdkbZ&2 % chtxf.kr\n"
    "1- cgqin&\n"
    "2- nks pj okys jSf[kd lehdj.k ;qXe &\n"
    "bdkbZ&3 % funsZ'kkad T;kfefr\n"
)


def up_request(**overrides) -> SyllabusRequest:
    fields = {
        "framework_id": "upmsp",
        "framework_name": "Board of High School and Intermediate Education Uttar Pradesh",
        "level": "Class 10",
        "subject": "Mathematics",
        "country": "IN",
        "official_site": "https://upmsp.edu.in",
    }
    fields.update(overrides)
    return SyllabusRequest(**fields)


def up_document(*, url: str = UP_URL, title: str = UP_TITLE, text: str = UP_TEXT) -> Document:
    return Document(
        id="upmsp-class-10-maths",
        url=url,
        media_type="application/pdf",
        title=title,
        bytes=92564,
        document_sha256="d0" + "b" * 62,
        extracted_text_sha256="e0" + "c" * 62,
        fetched_at="2026-09-15T17:08:09Z",
        pages=(Page(number=1, text=text),),
        extraction="pypdf text extraction, page-anchored",
        source_pages=3,
    )


def run_up(store=None, **overrides):
    defaults = {
        "store": store or InMemoryJobStore(),
        "search_provider": MockSearchProvider(
            [SearchResult(url=UP_URL, title="Class 10 Mathematics Syllabus")]
        ),
        "fetch_fn": lambda url, **kwargs: up_document(),
        "complete_generate": stub_completion(json.dumps({"refusal": "a model should never run"})),
        "complete_verify": stub_completion(AGREES, model=SECOND_READER_MODEL),
    }
    defaults.update(overrides)
    return run_discovery(up_request(), **defaults)


# --- 1. the verdict: the text layer, not the document ----------------------------------------
def test_the_file_that_names_itself_is_a_document_we_could_not_read():
    verdict = verify.text_layer_is_unreadable(up_document(), up_request())
    assert verdict, "the url and the pdf's own title both say Class 10; the text says nothing"
    assert "Class 10" in verdict


def test_a_document_whose_text_names_the_level_is_readable_and_is_simply_the_wrong_one():
    """The Class 4 ask against a Class X document. We read it fine; it is not the right file."""
    assert verify.text_layer_is_unreadable(cbse_document(), cbse_request(level="Class 4")) is None


def test_a_file_whose_own_name_says_nothing_either_earns_no_claim():
    nameless = up_document(url="https://upmsp.edu.in/downloads/928.pdf", title="")
    assert verify.text_layer_is_unreadable(nameless, up_request()) is None


def test_the_verdict_reads_the_filename_the_way_a_filename_is_written():
    """``Class10`` and ``Class-10th`` are both "class 10"; ``_norm`` alone makes them one word."""
    squashed = up_document(url="https://upmsp.edu.in/Syllabus/Class10/Maths.pdf", title="")
    assert verify.text_layer_is_unreadable(squashed, up_request())


# --- 2. the run refuses for what actually happened --------------------------------------------
def test_the_up_run_refuses_as_a_document_it_could_not_read():
    record = run_up()
    assert record.state is JobState.REFUSED
    assert record.reason == "document_unreadable", (
        "the board's own syllabus was refused as not being a syllabus"
    )


def test_the_line_a_learner_reads_never_says_the_board_document_is_not_a_syllabus():
    record = run_up()
    line = record.message
    assert "not the syllabus" not in line
    assert "could not read" in line
    assert line.endswith("Show me your syllabus and I will build it with you.")


def test_no_model_is_paid_to_read_a_document_whose_text_cannot_be_matched():
    generate = stub_completion(json.dumps({"refusal": "never"}))
    run_up(complete_generate=generate)
    assert generate.calls == []


def test_a_document_that_genuinely_is_not_a_syllabus_keeps_the_old_reason():
    """The reason is not deleted; it is narrowed to the case it was always true of."""
    record = run_up(
        fetch_fn=lambda url, **kwargs: up_document(
            title="Class 10 Mathematics", text="Class 10 Mathematics question paper design"
        ),
        complete_generate=stub_completion(
            json.dumps({"refusal": "this is a question paper, not a syllabus"})
        ),
    )
    assert record.reason == "no_syllabus_in_document"


def test_the_refusal_detail_says_what_the_evidence_was():
    record = run_up()
    assert UP_URL.split("%20")[0] in record.detail
    assert "Class 10" in record.detail


# --- 3. the trail: what was tried, for the row nobody could act on ----------------------------
def test_the_record_carries_every_candidate_it_tried_with_its_title_and_verdict():
    """Tamil Nadu's shape: one candidate, from the exam directorate, titled a scheme of exams."""

    def _tls(url, **kwargs):
        raise FetchRefused("tls_untrusted", "certificate chain")

    record = run_discovery(
        up_request(framework_id="tn-dge", framework_name="Tamil Nadu State Board"),
        store=InMemoryJobStore(),
        search_provider=MockSearchProvider(
            [
                SearchResult(
                    url="https://www.dge.tn.gov.in/docs/examina/sslc.pdf",
                    title="SSLC Public Examination – Scheme of Examination",
                )
            ]
        ),
        fetch_fn=_tls,
    )
    assert record.reason == "not_fetchable"
    assert len(record.tried) == 1
    trail = record.tried[0]
    assert "dge.tn.gov.in" in trail
    assert "Scheme of Examination" in trail
    assert "tls_untrusted" in trail


def test_a_reopened_job_does_not_wear_the_last_runs_trail():
    """A retry's row must be about the retry. Two runs' evidence under one verdict is neither."""
    store = InMemoryJobStore()
    first = run_up(store)
    assert first.tried and first.detail
    again = run_up(store, force=True, fetch_fn=_never_opens)
    assert again.reason == "not_fetchable"
    assert len(again.tried) == 1 and "document_unreadable" not in again.tried[0]
    assert "text layer" not in again.detail


def _never_opens(url, **kwargs):
    raise FetchRefused("http_error", "404")


def test_the_trail_never_crosses_out_to_a_learner():
    record = run_up()
    assert "tried" not in record.served


# --- 4. the console gets the sentence, and the detail behind it -------------------------------
def test_the_desk_no_longer_calls_the_boards_own_syllabus_not_a_syllabus():
    plain = desk_mod._REASONS["document_unreadable"]
    assert "not the syllabus" not in plain
    assert "read" in plain


def test_the_desk_row_carries_the_detail_and_the_trail_the_worker_wrote():
    from wobo_gateway.curriculum.models import DiscoveryJob

    job = DiscoveryJob(
        id="job-1",
        query="upmsp",
        state=JobState.REFUSED,
        framework_id="upmsp",
        level="Class 10",
        subject="Mathematics",
        result={
            "reason": "document_unreadable",
            "cost_usd": 0.0,
            "detail": f"{UP_URL}: the file's own name says Class 10",
            "tried": [f"{UP_URL} — Class 10 Mathematics Syllabus — document_unreadable"],
        },
    )
    row = desk_mod._job_row(job, {"upmsp": "Uttar Pradesh"})
    assert row["detail"] and "Class 10" in row["detail"]
    assert row["tried"] and "upmsp.edu.in" in row["tried"][0]


@pytest.mark.parametrize("reason", sorted(job_mod._REFUSAL_LINES))
def test_every_refusal_reason_has_a_console_sentence_too(reason: str):
    """A reason a learner has a line for is a reason an operator has to be able to act on."""
    if reason in job_mod.TRANSIENT_REASONS:
        return  # facts about us on a day, not about the board; the desk shows the line itself
    assert reason in desk_mod._REASONS
