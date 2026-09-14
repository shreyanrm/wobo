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
