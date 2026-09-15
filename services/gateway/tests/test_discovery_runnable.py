"""The faults the first end-to-end run of discovery found, each with the test that names it.

The pipeline was built in September 2026 and never run: ``WOBO_DISCOVERY_WORKER`` has never been
set on Railway. On 2026-09-11 it was run for the first time, offline, against an in-memory store,
for three Indian state boards. Everything here is a fault that run turned up, or a guard the run
showed was missing. Nothing here needs a key or a network.
"""

from __future__ import annotations

import pytest
from wobo_gateway.curriculum.discovery import extract, search, verify
from wobo_gateway.curriculum.discovery.extract import SyllabusRequest
from wobo_gateway.curriculum.discovery.fetch import Document, Page


# --- fault 1: the OpenAI search branch could never have run --------------------------------
# ``{"type": "web_search"}`` is a Responses API tool. Everything in this gateway goes through
# litellm's chat-completions path, where OpenAI accepts only ``function`` and ``custom`` tools,
# so every OpenAI search call came back:
#     OpenAIException - Invalid value: 'web_search'. Supported values are: 'function' and 'custom'.
# Chat completions asks for search through the ``web_search_options`` request field instead.
def test_the_openai_flavour_asks_for_search_the_way_chat_completions_takes_it():
    call = search.search_kwargs("openai", max_uses=5)
    assert "web_search_options" in call, "chat completions takes web_search_options, not a tool"
    assert not call.get("tools"), "a web_search TOOL is refused by /v1/chat/completions"


def test_the_anthropic_flavour_still_binds_its_own_server_tool():
    call = search.search_kwargs("anthropic", max_uses=3)
    tools = call["tools"]
    assert tools[0]["type"] == "web_search_20250305"
    assert tools[0]["max_uses"] == 3
    assert "web_search_options" not in call


def test_an_unknown_flavour_has_no_way_to_search():
    with pytest.raises(ValueError):
        search.search_kwargs("gemini", max_uses=1)


def test_the_provider_carries_the_call_its_flavour_needs():
    openai = search.NativeToolSearchProvider("openai", model="test/model")
    anthropic = search.NativeToolSearchProvider("anthropic", model="test/model", max_uses=2)
    assert "web_search_options" in openai.search_call()
    assert anthropic.search_call()["tools"][0]["max_uses"] == 2


# --- fault 2: the board's own name is the one nobody publishes under -----------------------
# The registry carries every board's aliases ("UPMSP", "UP board", "Samacheer Kalvi") and the
# request carries them into the search stage, where ``plan_queries`` threw them away and asked
# the web for "Board of High School and Intermediate Education Uttar Pradesh". The live run
# found nothing at all for Tamil Nadu and one dead link for Uttar Pradesh.
def test_the_query_plan_asks_for_the_board_by_the_name_it_publishes_under():
    queries = search.plan_queries(
        framework_name="Board of High School and Intermediate Education Uttar Pradesh",
        level="Class 10",
        subject="Mathematics",
        official_site="https://upmsp.edu.in",
        country="IN",
        aliases=("UPMSP", "UP board", "Uttar Pradesh board"),
    )
    joined = " || ".join(queries)
    assert "UPMSP" in joined, "the board's own short name never reached the web"
    assert any("UPMSP" in q and "syllabus" in q.lower() for q in queries)


def test_a_board_with_no_alias_plans_exactly_what_it_planned_before():
    without = search.plan_queries(
        framework_name="Some Board", level="Class 9", subject="Physics", aliases=()
    )
    assert all("Some Board" in q or "some board" in q.lower() for q in without)


# --- fault 3: a state board publishes ONE pdf for every subject of a standard ---------------
# Maharashtra's own document is 200 pages of every subject in Standards IX and X. The extractor
# read ``MAX_DOCUMENT_CHARS`` from the FRONT of it, which is the cover, the copyright page and
# the table of contents, and refused honestly: "the supplied pages do not include the Class 10
# Mathematics section". Mathematics is on the document's pages 133 to 142. Reading the front of
# a compilation is reading the wrong document.
def _compilation(subject_page: int = 40, pages: int = 60) -> Document:
    """One board pdf: contents, then a long run of other subjects, then Mathematics."""
    made: list[Page] = []
    for number in range(1, pages + 1):
        if number == 1:
            text = "SYLLABI FOR STANDARDS IX AND X\nCONTENTS\n5. MATHEMATICS 133 to 142"
        elif number == subject_page:
            text = (
                "MATHEMATICS\nStandard X\nUnit 1: Arithmetic Progression\n"
                "Unit 2: Quadratic Equations\nUnit 3: Linear Equations in Two Variables"
            )
        elif number == subject_page + 1:
            text = "MATHEMATICS\nStandard X\nUnit 4: Probability\nUnit 5: Statistics"
        else:
            text = f"HISTORY AND POLITICAL SCIENCE\nStandard IX\nChapter {number}: filler " + (
                "lorem ipsum dolor sit amet " * 120
            )
        made.append(Page(number=number, text=text))
    return Document(
        id="compilation",
        url="https://board.example.gov.in/syllabus.pdf",
        media_type="application/pdf",
        title="SYLLABI",
        bytes=1,
        document_sha256="a" * 64,
        extracted_text_sha256="b" * 64,
        fetched_at="2026-09-11T00:00:00Z",
        pages=tuple(made),
        extraction="pypdf text extraction, page-anchored",
    )


def _maths(level: str = "Class 10") -> SyllabusRequest:
    return SyllabusRequest(
        framework_id="board",
        framework_name="A State Board",
        level=level,
        subject="Mathematics",
        country="IN",
    )


def test_the_subjects_own_pages_are_what_the_extractor_reads():
    document = _compilation()
    chosen = extract.select_pages(document, _maths(), max_chars=8_000)
    numbers = [page.number for page in chosen]
    assert 40 in numbers and 41 in numbers, (
        "the subject's own pages were clipped off the front of the compilation"
    )


def test_the_selection_never_invents_a_page_number():
    document = _compilation()
    chosen = extract.select_pages(document, _maths(), max_chars=8_000)
    assert set(p.number for p in chosen) <= set(document.page_numbers)
    assert [p.number for p in chosen] == sorted(p.number for p in chosen)


def test_a_document_that_already_fits_is_read_whole_and_unchanged():
    document = _compilation(pages=3, subject_page=2)
    chosen = extract.select_pages(document, _maths(), max_chars=1_000_000)
    assert chosen == document.pages


def test_a_document_that_never_names_the_subject_falls_back_to_the_front():
    document = _compilation()
    other = SyllabusRequest(
        framework_id="board", framework_name="A State Board", level="Class 10", subject="Sanskrit"
    )
    chosen = extract.select_pages(document, other, max_chars=8_000)
    assert chosen[0].number == 1, "with nothing to aim at, read from the start as before"


def test_both_readers_are_handed_the_same_pages():
    document = _compilation()
    request = _maths()
    fenced = extract.fenced_document(document, 8_000, request=request)
    assert "[[page 40]]" in fenced and "Arithmetic Progression" in fenced
    second = verify.reader_document(document, request, max_chars=8_000)
    assert second == fenced, "the second reader must check the pages the first one read"


# --- fault 4: the search stage never searched ----------------------------------------------
# With the tool shape corrected, the OpenAI branch answered — and its answers were RECOLLECTION.
# ``web_search_options`` on chat completions is accepted by the API and silently ignored by this
# model family: the reply carries no annotations, takes the same time and costs the same as the
# same question asked with no search at all, and the urls it names are remembered rather than
# found. One of them (Maharashtra's) happened to be real; another (``upmsp.edu.in/Syllabus.html``)
# was a 404. A pipeline whose first law is "never return a URL you did not see in a search result"
# may not build a syllabus on either. The Responses API does search — three ``web_search_call``
# items with real queries — so that is where the OpenAI flavour goes, and a reply with no search
# behind it is discarded whatever it says.
class _ScriptedResponses:
    def __init__(self, text: str, searches: int) -> None:
        self.text = text
        self.searches = searches
        self.asked: list[str] = []

    def __call__(self, query: str) -> tuple[str, int]:
        self.asked.append(query)
        return self.text, self.searches


CBSE_PDF = "https://cbseacademic.nic.in/web_material/Curriculum/Maths.pdf"
_ONE_RESULT = '{"results":[{"url":"%s","title":"Maths","why":"on the board\'s own site"}]}' % (
    CBSE_PDF
)


def test_a_reply_with_a_search_behind_it_is_used():
    provider = search.NativeToolSearchProvider(
        "openai", model="test/model", respond=_ScriptedResponses(_ONE_RESULT, searches=2)
    )
    assert [r.url for r in provider.search("cbse maths")] == [CBSE_PDF]
    assert provider.searches_run == 2


def test_a_reply_with_no_search_behind_it_is_thrown_away():
    provider = search.NativeToolSearchProvider(
        "openai", model="test/model", respond=_ScriptedResponses(_ONE_RESULT, searches=0)
    )
    assert provider.search("cbse maths") == [], "an unsearched url is the model remembering"
    assert provider.searches_run == 0


def test_a_provider_that_never_searched_refuses_rather_than_reporting_nothing_found():
    provider = search.NativeToolSearchProvider(
        "openai", model="test/model", respond=_ScriptedResponses(_ONE_RESULT, searches=0)
    )
    with pytest.raises(search.SearchUnavailable):
        search.run_search(provider, ["a", "b"], budget=search.SearchBudget(max_queries=2))


def test_a_provider_that_searched_and_found_nothing_is_simply_empty():
    provider = search.NativeToolSearchProvider(
        "openai", model="test/model", respond=_ScriptedResponses('{"results":[]}', searches=3)
    )
    assert search.run_search(provider, ["a"], budget=search.SearchBudget(max_queries=1)) == []


# --- fault 5: pinning the ladder to one model refused the router ----------------------------
# The lab pins every tier a discovery can reach to the cheap rung so a run cannot climb to a
# frontier model by losing one call. It pinned ``WOBO_GENERATION_LADDER`` to Luna alone, and
# ``routing._read_ladder`` refuses that in its own words: "a ladder of one is not a ladder".
# The first live run died at configure() before it searched for anything. A pinned ladder has to
# be a real ladder whose every rung is still on the floor.
def test_the_pinned_ladder_is_a_ladder_the_router_accepts():
    from wobo_gateway import routing
    from wobo_gateway.curriculum.discovery import lab

    pinned = lab.pinned_environment(lab.LUNA)
    rungs = pinned["WOBO_GENERATION_LADDER"].split(",")
    assert len(rungs) >= 2, "routing refuses a one-rung ladder"
    routing.configure({**pinned})  # would raise if the router disagreed


# A pinned run must not be able to climb by losing a call. "The floor" cannot mean one absolute
# price, because a fallback on one account is not a fallback and the cheapest Anthropic text model
# costs four times the cheapest OpenAI one. It means: every rung this run can reach is the
# CHEAPEST TEXT MODEL ITS PROVIDER SELLS. Nothing a discovery does can reach a frontier model.
def test_no_rung_of_a_pinned_discovery_run_is_dearer_than_its_providers_cheapest():
    from wobo_gateway.curriculum.discovery import lab
    from wobo_gateway.routing import CATALOGUE, provider_of

    cheapest: dict[str, float] = {}
    for model, price in CATALOGUE.items():
        if price.per_million_out is None:  # not priced per token: tts, images
            continue
        provider = provider_of(model)
        out = price.per_million_out
        cheapest[provider] = min(cheapest.get(provider, out), out)

    pinned = lab.pinned_environment(lab.LUNA)
    named = {
        model.strip()
        for key, value in pinned.items()
        if key.startswith("WOBO_")
        for model in value.split(",")
        if model.strip()
    }
    assert named, "a pinned run names no model at all"
    for model in named:
        assert model in CATALOGUE, f"{model} is not a model this router knows"
        out = CATALOGUE[model].per_million_out
        assert out is not None and out <= cheapest[provider_of(model)], (
            f"{model} is not {provider_of(model)}'s cheapest; a pinned run could climb to it"
        )


# --- fault 6: a refusal nobody can act on ---------------------------------------------------
# The live Maharashtra run ended ``checks_failed`` after two readings of the board's own 200-page
# document. The record it left carried the reason word and the learner's line and NOTHING ELSE:
# ``report`` was null, the failed checks were gone, and the reading that failed was gone with
# them. The problems existed — ``_read_and_check`` puts them in the refusal's detail — and that
# detail was passed to the logger and dropped. docs/BOARD-COLD-START.md §5 says a refusal "goes
# to the console instead"; a console row with no report is a row a person cannot act on, and
# finding out what failed would mean paying for the whole run again.
def test_a_refusal_after_checking_keeps_the_report_that_refused_it(monkeypatch):
    import json as _json

    import test_discovery as base
    from wobo_gateway.curriculum.discovery.job import InMemoryJobStore, JobState

    document = base.cbse_document()
    reading = base.cbse_extraction(document)
    reading["units"][0]["title"] = "A Chapter That Is Not In The Document At All"
    store = InMemoryJobStore()
    record = base.run_cbse_job(
        store,
        complete_generate=base.stub_completion(_json.dumps(reading)),
        complete_verify=base.stub_completion(
            _json.dumps({"agrees": False, "problems": ["unit 1 is not in the document"]})
        ),
    )
    assert record.state is JobState.REFUSED and record.reason == "checks_failed"
    assert record.report, "a checks_failed refusal left no report for the console"
    assert record.report.get("problems") or record.report.get("checks"), (
        "the report names nothing that failed"
    )
    assert record.detail, "the refusal's detail was written to the log and dropped"
    assert record.syllabus is None, "a refused job must never carry a syllabus a learner could read"
    assert "syllabus" in record.report, "the reading that failed is what a person has to look at"


def test_the_detail_of_a_refusal_never_crosses_out_to_a_learner():
    import json as _json

    import test_discovery as base
    from wobo_gateway.curriculum.discovery.job import InMemoryJobStore

    document = base.cbse_document()
    reading = base.cbse_extraction(document)
    reading["units"][0]["title"] = "Invented"
    record = base.run_cbse_job(
        InMemoryJobStore(),
        complete_generate=base.stub_completion(_json.dumps(reading)),
        complete_verify=base.stub_completion(
            _json.dumps({"agrees": False, "problems": ["unit 1 is not in the document"]})
        ),
    )
    served = record.served
    assert served["syllabus"] is None
    assert "detail" not in served and "report" not in served
    assert "gpt" not in _json.dumps(served).lower()


# --- fault 7: the checks judged a reading of one subject against every subject --------------
# The live Maharashtra run refused its own correct reading. ``select_pages`` (fault 3) narrows
# the EXTRACTION to the subject's own pages, and ``reader_document`` hands the second reader the
# same pages — but every structural check still read ``document.text``, the whole 200-page
# compilation of both standards and every subject. So ``unit_count_vs_document`` counted the
# units of Science and History and Geography too, said "the document numbers 9 units, the
# extraction has 11", and threw away a reading whose 22 chapter names had just been read back off
# the board's own pages. The cut goes the other way as well: a chapter name found only on a
# History page must not count as "in the document" for Mathematics.
def _two_subject_compilation(*, quiet_margin: bool = False) -> Document:
    """A board pdf whose OTHER subject numbers nine units and whose Mathematics numbers three.

    ``quiet_margin`` makes the page immediately before Mathematics carry no unit number, which
    is the clean case; without it the margin page selection takes carries another subject's
    ninth unit, which is the ordinary case on a real compilation.
    """
    made = [Page(number=1, text="SYLLABI FOR STANDARDS IX AND X\nCONTENTS\n5. MATHEMATICS 20")]
    for index in range(1, 10):
        numbered = f"Unit {index}: " if not (quiet_margin and index == 9) else ""
        made.append(
            Page(
                number=1 + index,
                text=(
                    f"HISTORY AND POLITICAL SCIENCE\nStandard IX\n{numbered}"
                    f"The Nineteenth Century World Part {index}\n"
                    + "lorem ipsum dolor sit amet " * 200
                ),
            )
        )
    made.append(
        Page(
            number=20,
            text=(
                "MATHEMATICS\nStandard X\n"
                "Unit 1: Arithmetic Progression\nUnit 2: Quadratic Equations\n"
                "Unit 3: Linear Equations in Two Variables"
            ),
        )
    )
    return Document(
        id="two-subject",
        url="https://board.example.gov.in/syllabus.pdf",
        media_type="application/pdf",
        title="SYLLABI",
        bytes=1,
        document_sha256="c" * 64,
        extracted_text_sha256="d" * 64,
        fetched_at="2026-09-11T00:00:00Z",
        pages=tuple(made),
        extraction="pypdf text extraction, page-anchored",
    )


def test_the_unit_count_is_counted_on_the_pages_the_reading_was_made_from():
    document = _two_subject_compilation()
    request = _maths()
    assert verify.document_unit_count(document) == 9, (
        "the fixture's other subject is what a whole-document count sees"
    )
    counted = verify.document_unit_count(document, request=request, max_chars=8_000)
    assert counted is None, (
        "a document that holds more than one subject numbers nobody's units; it cannot be counted"
    )


def test_the_check_says_why_a_compilation_cannot_be_counted():
    from wobo_gateway.curriculum.discovery.extract import parse_syllabus

    document = _two_subject_compilation()
    request = _maths()
    syllabus = parse_syllabus(
        {
            "units": [
                {
                    "title": "Arithmetic Progression",
                    "source_ref": {"page": 20},
                    "topics": [{"title": "Arithmetic Progression", "source_ref": {"page": 20}}],
                }
            ]
        },
        request=request,
        document=document,
    )
    check = {
        c.name: c for c in verify.structural_checks(syllabus, document, request, max_chars=8_000)
    }[verify.CHECK_UNIT_COUNT]
    assert check.passed is None and "more than this subject" in check.detail


def test_a_single_subject_document_is_still_counted_exactly():
    document = _compilation(pages=3, subject_page=2)
    counted = verify.document_unit_count(document, request=_maths(), max_chars=1_000_000)
    assert counted == 5, "a document read whole is counted exactly as it always was"


def test_a_reading_of_the_subjects_own_pages_passes_the_structural_checks():
    from wobo_gateway.curriculum.discovery.extract import parse_syllabus

    document = _two_subject_compilation()
    request = _maths()
    reading = {
        "units": [
            {
                "title": title,
                "source_ref": {"page": 20},
                "topics": [{"title": title, "source_ref": {"page": 20}}],
            }
            for title in (
                "Arithmetic Progression",
                "Quadratic Equations",
                "Linear Equations in Two Variables",
            )
        ]
    }
    syllabus = parse_syllabus(reading, request=request, document=document)
    checks = {
        c.name: c for c in verify.structural_checks(syllabus, document, request, max_chars=8_000)
    }
    assert checks[verify.CHECK_UNIT_COUNT].passed is not False, (
        checks[verify.CHECK_UNIT_COUNT].detail
    )
    assert not [c for c in checks.values() if c.failed], (
        "a correct reading of the subject's pages was refused: "
        + "; ".join(c.detail for c in checks.values() if c.failed)
    )


def test_a_title_that_lives_only_on_another_subjects_page_is_not_read_back():
    from wobo_gateway.curriculum.discovery.extract import parse_syllabus

    document = _two_subject_compilation()
    request = _maths()
    reading = {
        "units": [
            {
                "title": "The Nineteenth Century World Part 3",
                "source_ref": {"page": 20},
                "topics": [
                    {"title": "The Nineteenth Century World Part 3", "source_ref": {"page": 20}}
                ],
            }
        ]
    }
    syllabus = parse_syllabus(reading, request=request, document=document)
    checks = {
        c.name: c for c in verify.structural_checks(syllabus, document, request, max_chars=8_000)
    }
    assert checks[verify.CHECK_TITLES_IN_DOCUMENT].passed is not True, (
        "a History chapter passed as read back off the Mathematics pages"
    )


# --- fault 8: "Standard X" is not a level this check had heard of ---------------------------
# Maharashtra's Mathematics pages say "Std. X" and "Standard X" and never "Class 10". The level
# check knew "class x" and "grade x" and not the two spellings most Indian state boards actually
# use, so a reading of the right pages of the right document failed level_coverage.
@pytest.mark.parametrize(
    "written", ["Standard X", "Std. X", "STD X", "Class X", "Class 10", "Grade 10"]
)
def test_the_level_check_knows_how_indian_boards_write_a_standard(written):
    document = Document(
        id="d",
        url="https://board.example.gov.in/s.pdf",
        media_type="application/pdf",
        title="s",
        bytes=1,
        document_sha256="e" * 64,
        extracted_text_sha256="f" * 64,
        fetched_at="2026-09-11T00:00:00Z",
        pages=(Page(number=1, text=f"MATHEMATICS\n{written}\nUnit 1: Arithmetic Progression"),),
        extraction="pypdf text extraction, page-anchored",
    )
    from wobo_gateway.curriculum.discovery.extract import parse_syllabus

    request = _maths()
    syllabus = parse_syllabus(
        {
            "units": [
                {
                    "title": "Arithmetic Progression",
                    "source_ref": {"page": 1},
                    "topics": [{"title": "Arithmetic Progression", "source_ref": {"page": 1}}],
                }
            ]
        },
        request=request,
        document=document,
    )
    checks = {c.name: c for c in verify.structural_checks(syllabus, document, request)}
    assert checks[verify.CHECK_LEVEL].passed is True, checks[verify.CHECK_LEVEL].detail


# --- fault 9: the board's layout punctuation became part of the chapter's name --------------
# Maharashtra's pages read "1. Arithmetic Progression :" and "4. Geometric Constructions :" —
# the colon introduces the bullet list under the heading and is layout, not name. The live run
# stored eleven chapters whose names ended in " :", which is what a learner would then have read
# on their own climb. Leading bullets and numbering were already taken off; the trailing colon
# was not. Nothing else about the name is touched: what the document calls a chapter is what we
# call it, misprints included.
@pytest.mark.parametrize(
    ("written", "expected"),
    [
        ("Arithmetic Progression :", "Arithmetic Progression"),
        ("Geometric Constructions:", "Geometric Constructions"),
        ("1. Similarity :", "1. Similarity"),  # the numbering is the document's own ordering
        ("Ratio and Proportion", "Ratio and Proportion"),
        ("Menstruation :", "Menstruation"),  # the board's own misprint for Mensuration, kept
        ("Sets, Relations: an introduction", "Sets, Relations: an introduction"),
    ],
)
def test_a_trailing_colon_is_layout_and_never_part_of_a_chapters_name(written, expected):
    assert extract.clean_title(written) == expected


# --- fault 10: a board's site that cannot be trusted read as a board's site that is down -----
# Tamil Nadu's own host serves its SSLC syllabus over TLS with an INCOMPLETE CERTIFICATE CHAIN:
# the leaf only, no intermediate. curl and a browser recover by fetching the missing certificate
# from the leaf's AIA extension; Python's ssl does not, and refuses. The live run recorded that
# as "unreachable: URLError" — the same words a board whose server is switched off gets. They are
# not the same fact and they do not have the same answer: one is the board's site being down, the
# other is the board's own misconfiguration, and only a person can decide what to do about it.
# Nothing here loosens verification. It tells the truth about why the door did not open.
def test_a_certificate_that_cannot_be_verified_is_not_called_unreachable():
    import ssl
    import urllib.error

    from wobo_gateway.curriculum.discovery import fetch as fetch_mod

    error = urllib.error.URLError(
        ssl.SSLCertVerificationError(
            1, "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local "
            "issuer certificate (_ssl.c:1032)"
        )
    )
    reason, detail = fetch_mod.classify_transport_error(error)
    assert reason == "tls_untrusted"
    assert "issuer" in detail or "certificate" in detail


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (__import__("socket").timeout("timed out"), "timeout"),
        (__import__("socket").gaierror(8, "nodename nor servname provided"), "dns"),
        (ConnectionRefusedError(61, "Connection refused"), "unreachable"),
        (OSError("something else entirely"), "unreachable"),
    ],
)
def test_every_other_way_a_fetch_can_fail_still_says_which_one_it_was(exc, expected):
    import urllib.error

    from wobo_gateway.curriculum.discovery import fetch as fetch_mod

    reason, _ = fetch_mod.classify_transport_error(urllib.error.URLError(exc))
    assert reason == expected


def test_the_detail_of_a_transport_failure_is_the_message_not_the_class_name():
    import urllib.error

    from wobo_gateway.curriculum.discovery import fetch as fetch_mod

    _, detail = fetch_mod.classify_transport_error(urllib.error.URLError(OSError("no route")))
    assert "no route" in detail and detail != "URLError"


# --- fault 11: two models read a document before anything checked it was the right one -------
# Uttar Pradesh's class 10 Mathematics pdf has a text layer in a LEGACY DEVANAGARI FONT: pypdf
# reads "bdkbZ&1 % la[;k i)fr&" where the page shows "इकाई-1 : संख्या पद्धति". The live run paid
# for four extractions across two such documents and then refused, because the checks that say
# "this document never names Class 10 and never names Mathematics" only ran AFTER the reading.
# Those two checks need the document and the request and nothing else. Asking them first costs
# nothing, refuses the wrong document before a model is paid to read it, and moves on to the next
# candidate. A redraw cannot make a document name a subject it does not name.
def test_the_document_is_checked_before_a_model_is_paid_to_read_it():
    document = _compilation(pages=2, subject_page=1)
    sanskrit = SyllabusRequest(
        framework_id="board", framework_name="A State Board", level="Class 10", subject="Sanskrit"
    )
    verdict = verify.document_is_plausible(document, sanskrit)
    assert verdict is not None, "a document that never names the subject should be refused early"
    assert "Sanskrit" in verdict


def test_a_document_that_names_the_subject_and_the_level_passes_the_gate():
    document = _compilation(pages=2, subject_page=1)
    assert verify.document_is_plausible(document, _maths()) is None


def test_the_gate_refuses_a_legacy_font_document_the_way_the_live_run_should_have():
    document = Document(
        id="upmsp",
        url="https://upmsp.edu.in/Downloads/Syllabus/Class10/928-Maths-Class-10.pdf",
        media_type="application/pdf",
        title="",
        bytes=1,
        document_sha256="1" * 64,
        extracted_text_sha256="2" * 64,
        fetched_at="2026-09-15T00:00:00Z",
        pages=(
            Page(
                number=1,
                text="bdkbZ&1 % la[;k i)fr&\n¼1½ okLrfod la[;k,¡\n2- nks pj okys jSf[kd lehdj.k",
            ),
        ),
        extraction="pypdf text extraction, page-anchored",
    )
    assert verify.document_is_plausible(document, _maths()) is not None


def test_the_job_never_extracts_from_a_document_that_fails_the_gate():
    import json as _json

    import test_discovery as base
    from wobo_gateway.curriculum.discovery.job import InMemoryJobStore, JobState

    calls: list[str] = []

    def _count(system: str, user: str) -> tuple[str, str]:
        calls.append(user)
        return _json.dumps(base.cbse_extraction(base.cbse_document())), "test/model"

    record = base.run_cbse_job(
        InMemoryJobStore(),
        request_level="Class 4",  # the CBSE fixture document is a Class X curriculum
        complete_generate=_count,
    )
    assert record.state is JobState.REFUSED
    assert record.reason == "no_syllabus_in_document"
    assert calls == [], "a model was paid to read a document that could not have been the right one"


# --- fault 12: the second reader was the first reader --------------------------------------
# The law is that nothing is published that A SECOND READER did not verify against the same
# document. In production the generate tier is Luna and the verify tier is Sol, so that is two
# minds. The live run was pinned to the cheap rung on every tier under the spend cap — and the
# provenance it wrote says `extractor_model: gpt-5.6-luna, verifier_model: gpt-5.6-luna`. One
# model agreeing with itself is not a second reading, it is the same reading paid for twice, and
# nothing in the code noticed. A dial on the console could do the same thing to production in one
# write. So: when the verify tier resolves to the model that did the extraction, the second
# reader is not asked, the check is recorded as one that could not run, and the reading can reach
# `provisional` on its structural evidence but can never be promoted to `verified`.
def test_a_verify_tier_pinned_to_the_extractors_own_model_is_not_a_second_reader():
    import json as _json

    import test_discovery as base

    document = base.cbse_document()
    request = base.cbse_request()
    from wobo_gateway.curriculum.discovery.extract import parse_syllabus

    syllabus = parse_syllabus(base.cbse_extraction(document), request=request, document=document)

    def _same_model(system: str, user: str) -> tuple[str, str]:
        return _json.dumps({"agrees": True, "problems": []}), "gpt-5.6-luna"

    report = verify.verify_extraction(
        syllabus, document, request, complete=_same_model, other_than="openai/gpt-5.6-luna"
    )
    check = {c.name: c for c in report.checks}[verify.CHECK_SECOND_READER]
    assert check.passed is None and "same model" in check.detail
    assert report.verifier_model is None, "provenance must not name a second reader there was not"
    assert report.ok, "the structural evidence still stands"
    assert not report.promotable, "and it can never become verified on one mind's word"


def test_the_same_model_is_never_even_asked_when_the_router_is_what_chooses_it():
    """With no stub, the verify tier's own id is known before the call, so it is not made."""
    import test_discovery as base
    from wobo_gateway.curriculum.discovery.extract import parse_syllabus
    from wobo_gateway.routing import Tier, tier_model

    document = base.cbse_document()
    request = base.cbse_request()
    syllabus = parse_syllabus(base.cbse_extraction(document), request=request, document=document)
    verifier = tier_model(Tier.VERIFY).provider_model
    check, model, problems = verify.cross_check(syllabus, document, other_than=verifier)
    assert check.passed is None and check.detail == verify.SAME_MIND
    assert model is None and problems == ()


def test_a_different_model_reading_second_is_a_second_reader():
    import json as _json

    import test_discovery as base

    document = base.cbse_document()
    request = base.cbse_request()
    from wobo_gateway.curriculum.discovery.extract import parse_syllabus

    syllabus = parse_syllabus(base.cbse_extraction(document), request=request, document=document)
    report = verify.verify_extraction(
        syllabus,
        document,
        request,
        complete=lambda s, u: (_json.dumps({"agrees": True, "problems": []}), "gpt-5.6-sol"),
        other_than="gpt-5.6-luna",
    )
    assert report.promotable


def test_a_model_that_will_not_stand_behind_its_own_reading_still_fails_it():
    """One mind agreeing with itself proves nothing; one mind contradicting itself proves a lot."""
    import json as _json

    import test_discovery as base
    from wobo_gateway.curriculum.discovery.extract import parse_syllabus

    document = base.cbse_document()
    request = base.cbse_request()
    syllabus = parse_syllabus(base.cbse_extraction(document), request=request, document=document)
    report = verify.verify_extraction(
        syllabus,
        document,
        request,
        complete=lambda s, u: (
            _json.dumps({"agrees": False, "problems": ["unit 3 is not in the document"]}),
            "gpt-5.6-luna",
        ),
        other_than="openai/gpt-5.6-luna",
    )
    assert not report.ok
    assert "unit 3 is not in the document" in report.problems


def test_a_lab_run_reads_with_one_mind_and_checks_with_another():
    from wobo_gateway.curriculum.discovery import lab

    pinned = lab.pinned_environment()
    assert pinned["WOBO_TIER_GENERATE"] != pinned["WOBO_TIER_VERIFY"], (
        "the lab's second reader is the lab's first reader"
    )
    assert pinned["WOBO_TIER_VERIFY"] not in pinned["WOBO_TIER_VERIFY_CHAIN"].split(","), (
        "a chain is one attempt per model"
    )
