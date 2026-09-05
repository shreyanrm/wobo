"""The seed verification pass: re-read every stored syllabus against its own source.

``content/curriculum/syllabi/**`` was extracted from the boards' documents with no model in the
loop, which is the honest half of a syllabus. Nobody then read a single file back against its
source, so every file sat at ``provisional`` with ``verifier: null`` and the question "is it
accurate" had no answer. This module is the answer, and the rules it answers by are the ones in
``docs/CURRICULUM.md`` §4.3 and §4.5:

1. **Fetch the recorded source and hash it.** The bytes must equal the ``document_sha256`` the
   build recorded. A source that cannot be fetched is a fact about the host, and the file says
   so; it is never a mark against the syllabus, and never a pass either.
2. **Look for every unit and topic name in the source, at the place it cites.** In code, with
   no model: verbatim on the cited page first, verbatim elsewhere in the document second (page
   splitters disagree more often than an extractor invents a chapter), then as an ordered run of
   words across a table column break, then as a composite of parts that each sit on the cited
   page (``"Civics: The Union Legislature"`` against a booklet that prints ``CIVICS`` as a
   section heading and ``The Union Legislature`` under it), then the same composite within a
   page of the citation, then every word of the name within a page of it (two table columns
   interleaved), and last a unit whose own name is nowhere but whose every chapter is verbatim
   on the cited page (a container the build named after the book). Only the first two are proof;
   the weaker grades are evidence a second reader must confirm. A name found nowhere fails the
   file and is named in ``status_reason``.
3. **Coverage against the document's own numbering.** The cited pages' numbered runs ("1. Sets,
   2. Relations, 3. Trigonometric Functions" under one unit, "1. Complex Numbers ..." under the
   next) are compared unit by unit with the topics the file holds; a run longer than its unit's
   topics is a missing chapter, named. Numbering that fits the file exactly passes; numbering
   that lines up with nothing, or no numbering at all, is handed to the second reader.
4. **The second reader only where code could not decide**, on the verify tier, budget-capped,
   with every call's tokens and cost recorded so the pass can say what it cost.
5. **Promote or flag, never guess, never edit a node.** A file that holds becomes ``verified``
   with the verifier, the time and every check recorded in its provenance. One that does not
   stays ``provisional`` and carries a ``status_reason`` naming exactly what could not be found
   or decided. ``units[]`` is never touched by this module, and a test holds it to that.

The whole pass is testable without a network or a model: sources come in as
:class:`~wobo_gateway.curriculum.discovery.fetch.Document` objects and the second reader is a
``(system, user) -> (text, model)`` seam, the same seam :mod:`verify` uses.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from wobo_gateway.curriculum.discovery.extract import (
    Completion,
    SourceRef,
    Syllabus,
    SyllabusRequest,
    Topic,
    Unit,
)
from wobo_gateway.curriculum.discovery.fetch import Document, FetchBudget, Page, pdf_to_pages
from wobo_gateway.curriculum.discovery.verify import (
    CHECK_SECOND_READER,
    MIN_TITLE_CHARS,
    Check,
    cross_check,
    document_unit_count,
)

logger = logging.getLogger("wobo.gateway.curriculum.discovery.audit")

# Check names. Stored in ``provenance.checks_passed`` / ``checks_failed``, so they are stable.
CHECK_SOURCE_FETCHED = "source_fetched"
CHECK_SOURCE_HASH = "source_bytes_match_the_build"
CHECK_NAMES_IN_SOURCE = "every_name_is_in_the_source"
CHECK_NAMES_ON_PAGE = "every_name_is_on_its_cited_page"
CHECK_COVERAGE = "coverage_matches_the_documents_numbering"
CHECK_TOPIC_LAYER = "every_unit_has_a_topic_layer"
CHECK_ORDER = "orders_run_1_to_n"
CHECK_EMPTIES = "no_empty_name"
CHECK_DUPLICATES = "no_duplicate_name_within_a_unit"

#: Every check this pass can write. What :func:`apply` owns in ``checks_passed`` and
#: ``checks_failed``; the build's own check names are never among them.
PASS_CHECKS: tuple[str, ...] = (
    CHECK_ORDER,
    CHECK_EMPTIES,
    CHECK_DUPLICATES,
    CHECK_TOPIC_LAYER,
    CHECK_SOURCE_FETCHED,
    CHECK_SOURCE_HASH,
    CHECK_NAMES_IN_SOURCE,
    CHECK_NAMES_ON_PAGE,
    CHECK_COVERAGE,
    CHECK_SECOND_READER,
)

VERIFIED_BY = "system"
CODE_VERIFIER = "wobo_gateway.curriculum.discovery.audit: structural checks in code, no model"

#: The evidence grades :func:`locate` can return, strongest first.
VERBATIM_ON_PAGE = "verbatim_on_cited_page"
VERBATIM_ELSEWHERE = "verbatim_elsewhere_in_document"
ORDERED_ON_PAGE = "ordered_words_on_cited_page"
COMPOSED_ON_PAGE = "composed_of_parts_on_cited_page"
#: The parts each sit on the cited page or the one before or after it: a booklet that prints
#: ``HISTORY`` as a section heading on page 6 and lists the units under it on to page 7.
COMPOSED_NEAR_PAGE = "composed_of_parts_within_a_page_of_the_citation"
#: Every word of the name is within a page of the citation, in no particular order: a table
#: whose two columns interleave in the extracted text ("Cyclones and Tsunamis" in one column,
#: "early warning systems" pushed a line down by the outcomes column beside it).
WORDS_NEAR_PAGE = "every_word_within_a_page_of_the_citation"
#: The unit's name is nowhere in the document but every chapter under it is verbatim on the
#: cited page: the build named a container after the book ("Ganita Prakash, Grade 8, Part 1")
#: rather than after a heading the document prints. The chapters are the document's; the label
#: is ours, and only a reader can say whether that is a faithful outline.
CONTAINER_LABEL = "container_named_by_the_build_its_chapters_verbatim"
TOO_SHORT = "too_short_to_search"
NOT_FOUND = "not_found"

PROOF = frozenset({VERBATIM_ON_PAGE, VERBATIM_ELSEWHERE})
NEEDS_SECOND_READER = frozenset(
    {
        ORDERED_ON_PAGE,
        COMPOSED_ON_PAGE,
        COMPOSED_NEAR_PAGE,
        WORDS_NEAR_PAGE,
        CONTAINER_LABEL,
        TOO_SHORT,
    }
)
#: Every grade, strongest first: the order the table lists them in.
GRADES = (
    VERBATIM_ON_PAGE,
    VERBATIM_ELSEWHERE,
    ORDERED_ON_PAGE,
    COMPOSED_ON_PAGE,
    COMPOSED_NEAR_PAGE,
    WORDS_NEAR_PAGE,
    CONTAINER_LABEL,
    TOO_SHORT,
    NOT_FOUND,
)

#: How much of a document the second reader is shown. Roughly 50k tokens at the top.
READER_MAX_CHARS = 200_000
#: How many stray words a table column may push between two words of one name.
MAX_WORD_GAP = 12
#: An ordered-words match on fewer words than this proves nothing.
MIN_ORDERED_WORDS = 3
#: A scattered-words match needs at least this many words of at least this many letters:
#: "the", "and" and "of" are on every page, "cyclones", "tsunamis" and "warning" are not.
MIN_SCATTERED_WORDS = 3
MIN_WORD_CHARS = 4

_NONALNUM = re.compile(r"[^a-z0-9]+")
_PART_SPLIT = re.compile(r"\s*(?::|-|–|—|\(|\))\s*")


# --- normalisation -----------------------------------------------------------------------
def loose(text: str) -> str:
    """Lower-case, ``&`` as ``and``, every run of punctuation or space as one space.

    :mod:`verify` strips punctuation to nothing, which turns the document's ``d- and f- Block``
    and the file's ``d-and f- Block`` into ``d and f block`` and ``dand f block``: two strings
    for one heading. Treating punctuation as a separator is what a reader does.
    """
    return _NONALNUM.sub(" ", text.lower().replace("&", " and ")).strip()


def _ordered_words(words: Sequence[str], haystack: Sequence[str], gap: int = MAX_WORD_GAP) -> bool:
    """Whether ``words`` occur in ``haystack`` in order, each within ``gap`` words of the last."""
    position = 0
    for index, word in enumerate(words):
        window = haystack[position : position + (gap if index else len(haystack))]
        try:
            offset = window.index(word)
        except ValueError:
            return False
        position += offset + 1
    return True


# --- one name against the pages -------------------------------------------------------------
@dataclass(frozen=True)
class Finding:
    """Where one node's name was found, and how strong that evidence is."""

    label: str
    name: str
    document_id: str
    cited_page: int | None
    how: str
    page: int | None = None

    @property
    def found(self) -> bool:
        return self.how not in {NOT_FOUND, TOO_SHORT}


def locate(name: str, pages: Mapping[int, str], cited_page: int | None) -> tuple[str, int | None]:
    """``(how, page)`` for one name against a document's pages (already :func:`loose`)."""
    needle = loose(name)
    cited = pages.get(cited_page, "") if cited_page is not None else ""
    if needle and needle in cited:
        return VERBATIM_ON_PAGE, cited_page
    if len(needle) < MIN_TITLE_CHARS:
        return TOO_SHORT, None
    order = sorted(pages, key=lambda number: (abs(number - (cited_page or number)), number))
    for number in order:
        if needle in pages[number]:
            return VERBATIM_ELSEWHERE, number
    words = needle.split()
    page_words = cited.split()
    if len(words) >= MIN_ORDERED_WORDS and _ordered_words(words, page_words):
        return ORDERED_ON_PAGE, cited_page
    parts = [loose(part) for part in _PART_SPLIT.split(name)]
    parts = [part for part in parts if len(part) >= MIN_TITLE_CHARS]

    def composed(haystack: str, haystack_words: Sequence[str]) -> bool:
        return len(parts) >= 2 and all(
            part in haystack
            or (
                len(part.split()) >= MIN_ORDERED_WORDS
                and _ordered_words(part.split(), haystack_words)
            )
            for part in parts
        )

    if composed(cited, page_words):
        return COMPOSED_ON_PAGE, cited_page
    if cited_page is None:
        return NOT_FOUND, None
    # Within a page of the citation: the page before and the page after, because a heading
    # opened on one page runs on to the next and two page splitters disagree by one.
    near = " ".join(
        pages.get(number, "") for number in (cited_page - 1, cited_page, cited_page + 1)
    )
    near_words = near.split()
    if composed(near, near_words):
        return COMPOSED_NEAR_PAGE, cited_page
    long_words = {word for word in words if len(word) >= MIN_WORD_CHARS}
    if len(long_words) >= MIN_SCATTERED_WORDS and long_words <= set(near_words):
        return WORDS_NEAR_PAGE, cited_page
    return NOT_FOUND, None


# --- the source ---------------------------------------------------------------------------
def _pdftotext_pages(data: bytes) -> list[str]:
    """``pdftotext -layout`` page texts, or ``[]`` when the binary is not on this machine.

    pypdf interleaves the columns of a two-column table; ``-layout`` keeps them apart. Reading a
    page both ways loses nothing and finds the headings a single extractor splits in two.
    """
    try:
        run = subprocess.run(
            ["pdftotext", "-layout", "-", "-"],
            input=data,
            capture_output=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if run.returncode != 0:
        return []
    return run.stdout.decode("utf-8", "replace").split("\f")


def read_source(
    document_id: str,
    data: bytes,
    *,
    url: str = "",
    fetched_at: str = "",
    budget: FetchBudget | None = None,
    with_pdftotext: bool = True,
) -> tuple[Document, Document]:
    """``(for matching, for the second reader)`` from PDF bytes.

    The matching view carries every page as pypdf read it AND as ``pdftotext -layout`` read it,
    so a heading one extractor splits across a column the other keeps whole. That doubles the
    text, which is fine for a substring search and wrong for a model: the reader view is one
    clean rendering per page, the layout text when pdftotext is here and pypdf's otherwise.
    """
    import hashlib

    budget = budget or FetchBudget(max_bytes=64 * 1024 * 1024)
    title, pages = pdf_to_pages(data, budget=budget)
    layout = _pdftotext_pages(data) if with_pdftotext else []
    merged: list[Page] = []
    clean: list[Page] = []
    for page in pages:
        extra = layout[page.number - 1] if page.number - 1 < len(layout) else ""
        text = f"{page.text}\n{extra}".strip() if extra.strip() else page.text
        merged.append(Page(number=page.number, text=text, section=page.section))
        clean.append(
            Page(number=page.number, text=extra.strip() or page.text, section=page.section)
        )
    sha = hashlib.sha256(data).hexdigest()

    def build(view: list[Page], extraction: str) -> Document:
        text = "\n\n".join(page.text for page in view)
        return Document(
            id=document_id,
            url=url,
            media_type="application/pdf",
            title=title,
            bytes=len(data),
            document_sha256=sha,
            extracted_text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
            fetched_at=fetched_at,
            pages=tuple(view),
            extraction=extraction,
        )

    has_layout = bool(layout)
    both = "pypdf and pdftotext -layout" if has_layout else "pypdf"
    one = "pdftotext -layout" if has_layout else "pypdf"
    return build(merged, f"{both}, page-anchored"), build(clean, f"{one}, page-anchored")


@dataclass(frozen=True)
class Source:
    """One cited document as this pass could get at it: a Document, or the reason it has none."""

    document_id: str
    document: Document | None
    transport: str = ""
    error: str | None = None
    #: The one-rendering view the second reader is shown; ``document`` when absent.
    reader: Document | None = None


# --- the report for one file ----------------------------------------------------------------
@dataclass
class FileReport:
    path: str
    framework_id: str
    level: str
    subject: str
    status_before: str
    blocked: bool = False
    blocker: str | None = None
    units: int = 0
    topics: int = 0
    units_without_topics: int = 0
    checks: list[Check] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    sources: dict[str, dict[str, Any]] = field(default_factory=dict)
    coverage: dict[str, dict[str, Any]] = field(default_factory=dict)
    decision: str = ""
    reasons: list[str] = field(default_factory=list)
    second_reader: dict[str, Any] | None = None
    verifier: str | None = None
    status_after: str = ""

    @property
    def failures(self) -> list[Check]:
        return [check for check in self.checks if check.failed]

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for finding in self.findings:
            out[finding.how] = out.get(finding.how, 0) + 1
        return out

    def as_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "framework_id": self.framework_id,
            "level": self.level,
            "subject": self.subject,
            "status_before": self.status_before,
            "status_after": self.status_after,
            "decision": self.decision,
            "reasons": list(self.reasons),
            "units": self.units,
            "topics": self.topics,
            "units_without_topics": self.units_without_topics,
            "checks": [check.as_dict() for check in self.checks],
            "names": self.counts(),
            "not_found": [f.label for f in self.findings if f.how == NOT_FOUND],
            "weak": [f"{f.label} ({f.how})" for f in self.findings if f.how in NEEDS_SECOND_READER],
            "sources": self.sources,
            "coverage": self.coverage,
            "second_reader": self.second_reader,
            "verifier": self.verifier,
        }


def _nodes(document: dict[str, Any]) -> list[tuple[str, dict[str, Any], dict[str, Any] | None]]:
    """``(label, node, parent_unit)`` for every unit and topic, in file order."""
    out: list[tuple[str, dict[str, Any], dict[str, Any] | None]] = []
    for unit in document.get("units") or []:
        unit_label = f"unit {unit.get('order')}: {unit.get('name', '')}"
        out.append((unit_label, unit, None))
        for topic in unit.get("topics") or []:
            out.append(
                (f"{unit_label} / topic {topic.get('order')}: {topic.get('name', '')}", topic, unit)
            )
    return out


def _ref(node: dict[str, Any]) -> tuple[str, int | None]:
    ref = node.get("source_ref") or {}
    page = ref.get("page")
    return str(ref.get("document_id") or ""), int(page) if isinstance(page, int) else None


def _structural(document: dict[str, Any]) -> list[Check]:
    units = document.get("units") or []
    problems: list[str] = []
    orders = [unit.get("order") for unit in units]
    if orders != list(range(1, len(orders) + 1)):
        problems.append(f"unit order is {orders}")
    for unit in units:
        topics = unit.get("topics")
        if isinstance(topics, list):
            topic_orders = [topic.get("order") for topic in topics]
            if topic_orders != list(range(1, len(topic_orders) + 1)):
                problems.append(f"{unit.get('name')}: topic order is {topic_orders}")
    order = Check(CHECK_ORDER, not problems, "; ".join(problems[:3]) or "orders run 1..n")

    empty = [
        label for label, node, _ in _nodes(document) if not str(node.get("name") or "").strip()
    ]
    empties = Check(CHECK_EMPTIES, not empty, "; ".join(empty[:3]) or "every node has a name")

    duplicated: list[str] = []
    unit_names = [loose(str(unit.get("name") or "")) for unit in units]
    duplicated += sorted({name for name in unit_names if unit_names.count(name) > 1})
    for unit in units:
        names = [loose(str(topic.get("name") or "")) for topic in unit.get("topics") or []]
        duplicated += sorted({f"{unit.get('name')} / {n}" for n in names if names.count(n) > 1})
    duplicates = Check(
        CHECK_DUPLICATES,
        not duplicated,
        ("repeated: " + "; ".join(duplicated[:3])) if duplicated else "no unit repeats a name",
    )

    without = [unit.get("name") for unit in units if not isinstance(unit.get("topics"), list)]
    layer = Check(
        CHECK_TOPIC_LAYER,
        not without,
        (f"{len(without)} of {len(units)} units have topics: null (withdrawn)")
        if without
        else "every unit carries its topics",
    )
    return [order, empties, duplicates, layer]


#: A line that numbers a chapter, unit or lesson: "1.  Sets", "Chapter 3 Power Play", "2) Algebra".
_NUMBERED_LINE = re.compile(
    r"^[^\S\n]*(?:chapter|unit|lesson|module|theme)?[^\S\n]*[-\u2013\u2014.:]?[^\S\n]*"
    r"(\d{1,2})[^\S\n]*[.:)\-\u2013\u2014]?[^\S\n]+[A-Za-z(]",
    re.IGNORECASE | re.MULTILINE,
)


def numbered_runs(text: str) -> list[int]:
    """The lengths of the document's own numbering runs, in order: ``[3, 5, 3, 1, 2]`` for a
    syllabus that numbers three chapters under its first unit, five under the second, and so on.

    A run starts at 1 and grows by one per line; a number that fits neither is noise (a marks
    column, a page number) and is skipped. Reading runs rather than one grand total is what
    catches a chapter missing from the middle of a unit: CBSE XI mathematics numbers
    3 + 5 + 3 + 1 + 2 chapters, and a file holding 3 + 5 + 2 + 1 + 2 still has five units.
    """
    runs: list[int] = []
    for match in _NUMBERED_LINE.finditer(text):
        number = int(match.group(1))
        if number == 1:
            runs.append(1)
        elif runs and number == runs[-1] + 1:
            runs[-1] += 1
    return runs


def _coverage(
    document: dict[str, Any], document_id: str, source: Document
) -> tuple[Check | None, dict[str, Any]]:
    """The document's own numbering on the cited pages against the file's counts for it.

    Decided in code only when the numbering and the file agree exactly, or when they line up
    unit by unit and a unit's run is longer than the topics the file holds for it (a missing
    chapter, named). Anything less regular is handed to the second reader, never guessed.
    """
    cited = sorted(
        {
            page
            for _, node, _ in _nodes(document)
            for did, page in [_ref(node)]
            if did == document_id and page is not None
        }
    )
    by_number = {page.number: page for page in source.pages}
    pages = tuple(by_number[page] for page in cited if page in by_number)
    subset = Document(
        id=source.id,
        url=source.url,
        media_type=source.media_type,
        title=source.title,
        bytes=source.bytes,
        document_sha256=source.document_sha256,
        extracted_text_sha256=source.extracted_text_sha256,
        fetched_at=source.fetched_at,
        pages=pages,
        extraction=source.extraction,
    )
    units = [u for u in document.get("units") or [] if _ref(u)[0] == document_id]
    per_unit = [
        len([t for t in (u.get("topics") or []) if _ref(t)[0] == document_id]) for u in units
    ]
    topics = sum(per_unit)
    runs = numbered_runs(subset.text) if pages else []
    markers = document_unit_count(subset) if pages else None
    info: dict[str, Any] = {
        "cited_pages": cited,
        "numbered_runs": runs,
        "unit_markers": markers,
        "units": len(units),
        "topics": topics,
    }

    def passed(verdict: str) -> tuple[Check, dict[str, Any]]:
        info["verdict"] = verdict
        return Check(CHECK_COVERAGE, True, verdict), info

    if runs and len(runs) == len(units):
        if runs == per_unit:
            return passed(
                f"the document numbers {'+'.join(map(str, runs))} chapters under {len(units)} "
                f"units; the file holds the same"
            )
        short = [
            f"{units[i].get('name')}: the document numbers {runs[i]}, the file has {per_unit[i]}"
            for i in range(len(units))
            if runs[i] > per_unit[i]
        ]
        if short:
            info["verdict"] = "chapters missing: " + "; ".join(short)
            return Check(CHECK_COVERAGE, False, info["verdict"]), info
    if len(runs) == 1 and runs[0] == topics:
        return passed(f"the document numbers {topics} chapters; the file has {topics} topics")
    if len(runs) == 1 and runs[0] == len(units) and len(units) > 1:
        return passed(f"the document numbers {len(units)} units; the file has {len(units)} units")
    if runs and sum(runs) == topics:
        return passed(
            f"the document numbers {topics} chapters in all; the file has {topics} topics"
        )
    if markers is not None and markers == len(units):
        return passed(f"the document numbers {markers} units; the file has {markers} units")
    if markers is not None and markers == topics and not runs:
        return passed(f"the document numbers {markers}; the file has {markers} topics")
    if runs or markers is not None:
        info["verdict"] = (
            f"the document's numbering on the cited pages ({'+'.join(map(str, runs)) or markers}) "
            f"does not line up with the file's {len(units)} units and {topics} topics"
        )
        return None, info
    info["verdict"] = "the cited pages number nothing code can count"
    return None, info


def _misquotes_the_page(finding: Finding, pages_by_doc: Mapping[str, Mapping[int, str]]) -> bool:
    """Every long word of the name is on its cited page, yet the name is not.

    Then the page prints a heading the file misquotes ("Human Environment" for the document's
    "Human and Environment"), and code can say so: that is a not-found name, never a container
    label. A label carrying words the page does not have is not a quotation of the page at all,
    and whether it is a fair name for the chapters under it is a reading question.
    """
    if finding.cited_page is None:
        return False
    page_words = set(pages_by_doc.get(finding.document_id, {}).get(finding.cited_page, "").split())
    long_words = {word for word in loose(finding.name).split() if len(word) >= MIN_WORD_CHARS}
    return bool(long_words) and long_words <= page_words


def check_file(path: str, document: dict[str, Any], sources: Mapping[str, Source]) -> FileReport:
    """Every check code can make, no network and no model. The decision says what is left."""
    report = FileReport(
        path=path,
        framework_id=str(document.get("framework_id") or ""),
        level=str(document.get("level") or ""),
        subject=str(document.get("subject") or ""),
        status_before=str(document.get("status") or ""),
    )
    units = document.get("units")
    if not isinstance(units, list):
        report.blocked = True
        report.blocker = str(document.get("blocker") or "") or None
        report.decision = "blocked"
        report.reasons.append(
            f"not checked: the file holds no units (blocker: {report.blocker or 'unnamed'})"
        )
        report.status_after = report.status_before
        return report

    report.units = len(units)
    report.topics = sum(len(u.get("topics") or []) for u in units)
    report.units_without_topics = sum(1 for u in units if not isinstance(u.get("topics"), list))
    report.checks.extend(_structural(document))

    recorded = {d.get("id"): d for d in document.get("documents") or [] if isinstance(d, dict)}
    cited_ids = sorted({_ref(node)[0] for _, node, _ in _nodes(document)})
    fetched_all = True
    hash_all = True
    for document_id in cited_ids:
        source = sources.get(document_id)
        entry = recorded.get(document_id) or {}
        row: dict[str, Any] = {"url": entry.get("url"), "title": entry.get("title")}
        if source is None or source.document is None:
            fetched_all = False
            row["fetched"] = False
            row["error"] = (source.error if source else None) or "no source was supplied"
            report.sources[document_id] = row
            continue
        row["fetched"] = True
        row["transport"] = source.transport
        row["fetched_at"] = source.document.fetched_at
        row["extraction"] = source.document.extraction
        row["pages"] = len(source.document.pages)
        same = source.document.document_sha256 == entry.get("document_sha256")
        row["sha256_matches_build"] = same
        hash_all = hash_all and same
        report.sources[document_id] = row

    report.checks.append(
        Check(
            CHECK_SOURCE_FETCHED,
            True if fetched_all else None,
            "every cited document was fetched"
            if fetched_all
            else "a cited document could not be fetched: "
            + "; ".join(
                f"{did}: {row.get('error')}"
                for did, row in report.sources.items()
                if not row.get("fetched")
            ),
        )
    )
    if not fetched_all:
        report.decision = "unverifiable"
        report.reasons.append(
            "the source could not be fetched, so nothing was checked against it: "
            + "; ".join(
                f"{did} ({row.get('error')})"
                for did, row in report.sources.items()
                if not row.get("fetched")
            )
        )
        report.status_after = report.status_before
        return report
    report.checks.append(
        Check(
            CHECK_SOURCE_HASH,
            hash_all,
            "the bytes fetched today hash to what the build recorded"
            if hash_all
            else "the document on the host is not the one the build read: "
            + ", ".join(
                did for did, row in report.sources.items() if not row.get("sha256_matches_build")
            ),
        )
    )

    pages_by_doc = {
        did: {page.number: loose(page.text) for page in sources[did].document.pages}  # type: ignore[union-attr]
        for did in cited_ids
    }

    def find(label: str, node: dict[str, Any]) -> Finding:
        did, page = _ref(node)
        name = str(node.get("name") or "")
        how, where = locate(name, pages_by_doc[did], page)
        return Finding(label, name, did, page, how, where)

    for unit in units:
        unit_label = f"unit {unit.get('order')}: {unit.get('name', '')}"
        unit_finding = find(unit_label, unit)
        topic_findings = [
            find(f"{unit_label} / topic {topic.get('order')}: {topic.get('name', '')}", topic)
            for topic in unit.get("topics") or []
        ]
        if (
            unit_finding.how == NOT_FOUND
            and topic_findings
            and all(finding.how == VERBATIM_ON_PAGE for finding in topic_findings)
            and not _misquotes_the_page(unit_finding, pages_by_doc)
        ):
            # Not proof, and not a fabrication either: the document's own chapter list under a
            # label the build chose. Graded as evidence for the second reader, never as found.
            unit_finding = replace(unit_finding, how=CONTAINER_LABEL, page=unit_finding.cited_page)
        report.findings.append(unit_finding)
        report.findings.extend(topic_findings)
    missing = [f.label for f in report.findings if f.how == NOT_FOUND]
    on_page = sum(1 for f in report.findings if f.how == VERBATIM_ON_PAGE)
    searched = sum(1 for f in report.findings if f.how != TOO_SHORT)
    report.checks.append(
        Check(
            CHECK_NAMES_IN_SOURCE,
            not missing,
            f"{searched} names found in the source"
            if not missing
            else "not in the source: " + "; ".join(missing[:6]),
        )
    )
    # A name one page off its citation is where two page splitters disagree; further than that
    # the citation is wrong. Either way the name IS in the document, so this check is recorded
    # and shown, never a bar to promotion: it grades the source_ref, not the syllabus.
    far = [
        f"{f.label} (cites page {f.cited_page}, found on page {f.page})"
        for f in report.findings
        if f.how == VERBATIM_ELSEWHERE
        and f.page is not None
        and f.cited_page is not None
        and abs(f.page - f.cited_page) > 1
    ]
    report.checks.append(
        Check(
            CHECK_NAMES_ON_PAGE,
            not far,
            f"{on_page} of {len(report.findings)} names verbatim on the page they cite"
            + (
                f"; {len(far)} more than one page away: " + "; ".join(far[:4])
                if far
                else "; the rest within one page"
                if on_page < len(report.findings)
                else ""
            ),
        )
    )

    undecided = False
    for did in cited_ids:
        # Numbering is counted on the one-rendering reader view: the merged matching view carries
        # every line twice, and a chapter list counted twice is a coverage verdict that lies.
        view = sources[did].reader or sources[did].document
        check, info = _coverage(document, did, view)  # type: ignore[arg-type]
        report.coverage[did] = info
        if check is None:
            undecided = True
        else:
            report.checks.append(check)
    if undecided and not any(c.name == CHECK_COVERAGE for c in report.checks):
        report.checks.append(
            Check(CHECK_COVERAGE, None, "the cited pages number nothing code can count")
        )

    # --- the decision -------------------------------------------------------------------
    hard = [
        c
        for c in report.checks
        if c.failed and c.name not in {CHECK_TOPIC_LAYER, CHECK_NAMES_ON_PAGE}
    ]
    if hard:
        report.decision = "flag"
        report.reasons.extend(f"{c.name}: {c.detail}" for c in hard)
    elif report.units_without_topics:
        report.decision = "incomplete"
        report.reasons.append(
            f"the unit list holds against the source, but {report.units_without_topics} of "
            f"{report.units} units have no topic layer (topics: null), so the syllabus is "
            "incomplete and cannot be called verified"
        )
    else:
        weak = [f for f in report.findings if f.how in NEEDS_SECOND_READER]
        coverage_open = any(c.name == CHECK_COVERAGE and c.passed is None for c in report.checks)
        if weak or coverage_open:
            report.decision = "ask"
            if coverage_open:
                report.reasons.append("coverage: the cited pages number nothing code can count")
            if weak:
                report.reasons.append(
                    f"{len(weak)} names matched only weakly: "
                    + "; ".join(f"{f.label} ({f.how})" for f in weak[:6])
                )
        else:
            report.decision = "hold"
            report.verifier = CODE_VERIFIER
    report.status_after = "verified" if report.decision == "hold" else report.status_before
    return report


# --- the second reader ---------------------------------------------------------------------
@dataclass
class CostLedger:
    """What the pass spent, call by call. ``None`` cost means the provider reported no price."""

    budget_usd: float
    calls: list[dict[str, Any]] = field(default_factory=list)

    @property
    def spent_usd(self) -> float:
        return sum(float(call.get("cost_usd") or 0.0) for call in self.calls)

    @property
    def unpriced(self) -> int:
        return sum(1 for call in self.calls if call.get("cost_usd") is None)

    @property
    def exhausted(self) -> bool:
        return self.spent_usd >= self.budget_usd

    def add(self, **call: Any) -> None:
        self.calls.append(call)


def live_completion(ledger: CostLedger, *, timeout_s: float = 180.0) -> Completion:
    """The verify tier through the router, with every call's usage written to ``ledger``.

    Deliberately not :func:`extract.tier_complete`: that funnel records into the gateway's spend
    accumulator and durable ledger, which belong to learners' turns. This pass is an operator
    job that must say what it cost, so it prices each call itself and keeps its own ledger.
    """

    def complete(system: str, user: str) -> tuple[str, str]:
        from wobo_gateway.model_call import complete as model_complete
        from wobo_gateway.routing import Tier, resolve_any, tier_fallbacks, tier_model

        spec = tier_model(Tier.VERIFY)
        fallbacks = [resolve_any(name).provider_model for name in tier_fallbacks(Tier.VERIFY)]
        # Through ``model_call``, never ``litellm.completion`` directly: a model in the chain
        # that refuses ``temperature`` answers 400 and litellm raises the LAST failure, so the
        # whole chain reads as unreachable and every file is left "unread" for a knob. That is
        # exactly what the first live run of this pass did on 2026-09-05.
        response = model_complete(
            model=spec.provider_model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            fallbacks=fallbacks or None,
            max_tokens=2000,
            temperature=0.0,
            timeout=timeout_s,
        )
        text = response.choices[0].message.content or ""
        actual = str(getattr(response, "model", "") or "") or spec.provider_model
        usage = getattr(response, "usage", None)
        prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
        ledger.add(
            model=actual,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=_price(actual, prompt_tokens, completion_tokens, response),
        )
        return text, actual

    return complete


def _price(model: str, prompt_tokens: int, completion_tokens: int, response: Any) -> float | None:
    import litellm

    try:
        cost = litellm.completion_cost(completion_response=response)
        if cost:
            return float(cost)
    except Exception:  # noqa: BLE001 — unpriced is a recorded outcome, not a crash
        pass
    name = model.split("/", 1)[-1]
    row = litellm.model_cost.get(name) or litellm.model_cost.get(model)
    if not row:
        return None
    return prompt_tokens * float(row.get("input_cost_per_token") or 0) + completion_tokens * float(
        row.get("output_cost_per_token") or 0
    )


def _sub_syllabus(document: dict[str, Any], document_id: str) -> Syllabus:
    """The file's nodes that cite one document, in the shape :func:`verify.cross_check` reads."""
    request = SyllabusRequest(
        framework_id=str(document.get("framework_id") or ""),
        framework_name=str(document.get("framework_name") or ""),
        level=str(document.get("level") or ""),
        subject=str(document.get("subject") or ""),
        version=document.get("version"),
    )
    units: list[Unit] = []
    for unit in document.get("units") or []:
        did, page = _ref(unit)
        if did != document_id:
            continue
        topics = tuple(
            Topic(
                title=str(topic.get("name") or ""),
                order=int(topic.get("order") or 0),
                source_ref=SourceRef(
                    document_id, _ref(topic)[1], (topic.get("source_ref") or {}).get("section")
                ),
            )
            for topic in unit.get("topics") or []
        )
        units.append(
            Unit(
                title=str(unit.get("name") or ""),
                order=int(unit.get("order") or 0),
                source_ref=SourceRef(
                    document_id, page, (unit.get("source_ref") or {}).get("section")
                ),
                topics=topics,
            )
        )
    return Syllabus(
        request=request,
        units=tuple(units),
        documents=(),
        version=str(document.get("version") or ""),
    )


def second_read(
    document: dict[str, Any],
    report: FileReport,
    sources: Mapping[str, Source],
    *,
    complete: Completion,
    ledger: CostLedger,
) -> FileReport:
    """Ask the other mind about a file code could not decide. One call per cited document."""
    if report.decision != "ask":
        return report
    verdicts: list[dict[str, Any]] = []
    for document_id in sorted(report.sources):
        if ledger.exhausted:
            verdicts.append(
                {"document_id": document_id, "asked": False, "why": "budget cap reached"}
            )
            continue
        source = sources[document_id].reader or sources[document_id].document
        assert source is not None
        before = len(ledger.calls)
        # A syllabus booklet runs to 100k characters once every page is in; the contents page
        # of a textbook sits near its end. The default 60k clip would hide exactly the page the
        # verdict turns on, so the reader gets the whole document, at the price it costs.
        check, model, problems = cross_check(
            _sub_syllabus(document, document_id),
            source,
            complete=complete,
            max_document_chars=READER_MAX_CHARS,
        )
        call = ledger.calls[before] if len(ledger.calls) > before else {}
        verdicts.append(
            {
                "document_id": document_id,
                "asked": True,
                "model": model,
                "passed": check.passed,
                "detail": check.detail,
                "problems": list(problems),
                "cost_usd": call.get("cost_usd"),
                "prompt_tokens": call.get("prompt_tokens"),
                "completion_tokens": call.get("completion_tokens"),
            }
        )
    report.second_reader = {"verdicts": verdicts}
    asked = [v for v in verdicts if v.get("asked")]
    if not asked:
        report.checks.append(
            Check(CHECK_SECOND_READER, None, "not asked: the budget cap was reached")
        )
        report.decision = "unread"
        report.reasons.append("the second reader was not asked: the budget cap was reached")
    elif all(v.get("passed") is True for v in asked) and len(asked) == len(verdicts):
        report.checks.append(
            Check(CHECK_SECOND_READER, True, "the second reader read the source and agrees")
        )
        report.decision = "hold"
        report.verifier = ", ".join(sorted({str(v.get("model")) for v in asked}))
    elif any(v.get("passed") is False for v in asked):
        named = [p for v in asked if v.get("passed") is False for p in v.get("problems") or []]
        detail = "; ".join(named) or "the second reader does not agree with the file"
        report.checks.append(Check(CHECK_SECOND_READER, False, detail))
        report.decision = "flag"
        report.reasons.append("the second reader does not agree: " + detail)
    else:
        detail = (
            "; ".join(str(v.get("detail")) for v in asked if v.get("passed") is None)
            or "no verdict"
        )
        report.checks.append(Check(CHECK_SECOND_READER, None, detail))
        report.decision = "unread"
        report.reasons.append("the second reader gave no verdict: " + detail)
    report.status_after = "verified" if report.decision == "hold" else report.status_before
    return report


# --- writing the verdict into the file --------------------------------------------------------
def _with_key_after(document: dict[str, Any], anchor: str, key: str, value: Any) -> dict[str, Any]:
    """A copy of ``document`` with ``key`` placed right after ``anchor`` (or updated in place)."""
    out: dict[str, Any] = {}
    placed = False
    for existing, existing_value in document.items():
        if existing == key:
            continue
        out[existing] = existing_value
        if existing == anchor:
            out[key] = value
            placed = True
    if not placed:
        out[key] = value
    return out


def _without_key(document: dict[str, Any], key: str) -> dict[str, Any]:
    return {k: v for k, v in document.items() if k != key}


def apply(document: dict[str, Any], report: FileReport, *, now: str) -> dict[str, Any]:
    """The file after the verdict. ``units`` is returned untouched, whatever the verdict.

    A hold writes ``status: verified`` and the verifier, time and checks into ``provenance``.
    Anything else leaves ``status`` alone and writes a ``status_reason`` naming exactly what
    stood in the way. Every outcome records ``provenance.verification`` so a reader can see
    what this pass did to the file, and when.
    """
    provenance = dict(document.get("provenance") or {})
    # This pass's checks replace this pass's earlier verdicts, name by name: a check that failed
    # on the last run and passed on this one leaves ``checks_failed``, and one this run did not
    # make (the second reader, when code decided) is not carried as if it had. Only the build's
    # own checks, which this pass never runs, are kept as the build wrote them. Appending alone
    # left cbse/class-10-science.json ``verified`` with a failed citation check from a run before
    # its citations were corrected: a label that overstated what was known (CURRICULUM.md §12).
    ours = set(PASS_CHECKS)
    passed = [name for name in provenance.get("checks_passed") or [] if name not in ours]
    failed = [name for name in provenance.get("checks_failed") or [] if name not in ours]
    for check in report.checks:
        if check.passed is True and check.name not in passed:
            passed.append(check.name)
        if check.failed and check.name not in failed:
            failed.append(check.name)
    provenance["checks_passed"] = passed
    provenance["checks_failed"] = failed
    provenance["verification"] = {
        "checked_at": now,
        "decision": report.decision,
        "checks": [check.as_dict() for check in report.checks],
        "names": report.counts(),
        "sources": report.sources,
        "coverage": report.coverage,
        "second_reader": report.second_reader,
        "reasons": list(report.reasons),
    }
    if report.decision == "hold":
        provenance["verifier"] = report.verifier
        provenance["verified_at"] = now
        provenance["verified_by"] = VERIFIED_BY
        out = dict(document)
        out["status"] = "verified"
        out = _without_key(out, "status_reason")
    else:
        out = _with_key_after(document, "status", "status_reason", "; ".join(report.reasons))
    out["provenance"] = provenance
    return out


def dump(document: dict[str, Any]) -> str:
    """The on-disk format of ``content/curriculum/syllabi``: two-space JSON, UTF-8, newline."""
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


# --- the owner's table -------------------------------------------------------------------------
GENERATED_START = "<!-- generated by wobo_gateway.curriculum.discovery.audit: start -->"
GENERATED_END = "<!-- generated by wobo_gateway.curriculum.discovery.audit: end -->"

_DECISION_WORDS = {
    "hold": "verified",
    "flag": "provisional, failed",
    "ask": "provisional, second reader pending",
    "unread": "provisional, second reader not run",
    "incomplete": "provisional, incomplete",
    "unverifiable": "provisional, source unreachable",
    "blocked": "provisional, no units to check",
}


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def render_table(
    reports: Sequence[FileReport], ledger: CostLedger | None, *, checked_at: str
) -> str:
    """The generated section of ``docs/curriculum/VERIFICATION.md``. Every file, one row."""
    lines: list[str] = [GENERATED_START, ""]
    by_decision: dict[str, int] = {}
    for report in reports:
        by_decision[report.decision] = by_decision.get(report.decision, 0) + 1
    lines.append(f"Checked at {checked_at}. {len(reports)} files.")
    lines.append("")
    for decision, word in _DECISION_WORDS.items():
        if by_decision.get(decision):
            lines.append(f"- {by_decision[decision]} {word}")
    if ledger is not None:
        priced = f"USD {ledger.spent_usd:.4f}"
        if ledger.unpriced:
            priced += f" plus {ledger.unpriced} unpriced calls"
        tokens_in = sum(int(c.get("prompt_tokens") or 0) for c in ledger.calls)
        tokens_out = sum(int(c.get("completion_tokens") or 0) for c in ledger.calls)
        lines.append(
            f"- second reader: {len(ledger.calls)} calls, {tokens_in} prompt tokens, "
            f"{tokens_out} completion tokens, {priced} of a USD {ledger.budget_usd:.2f} cap"
        )
    lines.append("")
    boards: dict[str, list[FileReport]] = {}
    for report in reports:
        boards.setdefault(report.framework_id, []).append(report)
    for framework_id, rows in boards.items():
        lines.append(f"### {framework_id}")
        lines.append("")
        lines.append("| File | Level | Subject | Status | Source | Checked | Failed or open |")
        lines.append("|---|---|---|---|---|---|---|")
        for report in rows:
            source = (
                "; ".join(
                    f"{row.get('title') or did}"
                    + (
                        " (fetched, sha256 matches the build)"
                        if row.get("fetched") and row.get("sha256_matches_build")
                        else " (fetched, sha256 DIFFERS from the build)"
                        if row.get("fetched")
                        else f" (not fetched: {row.get('error')})"
                    )
                    for did, row in report.sources.items()
                )
                or "no units, nothing fetched"
            )
            counts = report.counts()
            checked = []
            if report.findings:
                checked.append(
                    f"{counts.get(VERBATIM_ON_PAGE, 0)} of {len(report.findings)} names "
                    "verbatim on the cited page"
                )
                for how in GRADES[1:]:
                    if counts.get(how):
                        checked.append(f"{counts[how]} {how.replace('_', ' ')}")
            for did, info in report.coverage.items():
                checked.append(f"coverage {did}: {info.get('verdict')}")
            if report.second_reader:
                for verdict in report.second_reader.get("verdicts", []):
                    if verdict.get("asked"):
                        word = (
                            "agrees"
                            if verdict.get("passed")
                            else "disagrees"
                            if verdict.get("passed") is False
                            else "no verdict"
                        )
                        checked.append(f"second reader {verdict.get('model')}: {word}")
                    else:
                        checked.append(f"second reader not asked: {verdict.get('why')}")
            if report.decision == "hold":
                # A verified row still shows a check that failed without blocking it: the page
                # citations. Hiding it would make the row claim more than the file does.
                open_items = "; ".join(f"{c.name}: {c.detail}" for c in report.failures) or "none"
            else:
                open_items = "; ".join(report.reasons)
            lines.append(
                "| `{}` | {} | {} | {} | {} | {} | {} |".format(
                    report.path,
                    _cell(report.level),
                    _cell(report.subject),
                    _cell(_DECISION_WORDS.get(report.decision, report.decision)),
                    _cell(source),
                    _cell("; ".join(checked) or "nothing: no units"),
                    _cell(open_items),
                )
            )
        lines.append("")
    lines.append(GENERATED_END)
    return "\n".join(lines) + "\n"


def merge_generated(existing: str | None, generated: str) -> str:
    """Replace the generated section of a document, keeping whatever a person wrote around it."""
    if existing and GENERATED_START in existing and GENERATED_END in existing:
        head, _, rest = existing.partition(GENERATED_START)
        _, _, tail = rest.partition(GENERATED_END)
        return head + generated.rstrip("\n") + tail
    return (existing.rstrip("\n") + "\n\n" if existing else "") + generated


# --- the pass ----------------------------------------------------------------------------------
Acquire = Callable[[str, dict[str, Any]], Source]


def run_pass(
    root: Path,
    *,
    acquire: Acquire,
    complete: Completion | None,
    ledger: CostLedger,
    now: str,
    write: bool = False,
) -> list[FileReport]:
    """Every file under ``root``, checked, optionally rewritten. Sources are fetched once each."""
    paths = sorted(p for p in root.rglob("*.json") if "tools" not in p.parts)
    documents = {path: json.loads(path.read_text(encoding="utf-8")) for path in paths}
    sources: dict[str, Source] = {}
    for document in documents.values():
        if not isinstance(document.get("units"), list):
            continue
        for entry in document.get("documents") or []:
            document_id = str(entry.get("id") or "")
            if document_id and document_id not in sources:
                sources[document_id] = acquire(document_id, entry)
    reports: list[FileReport] = []
    for path in paths:
        document = documents[path]
        relative = str(path.relative_to(root))
        report = check_file(relative, document, sources)
        if report.decision == "ask" and complete is not None:
            report = second_read(document, report, sources, complete=complete, ledger=ledger)
        elif report.decision == "ask":
            report.checks.append(
                Check(CHECK_SECOND_READER, None, "the second reader was not asked")
            )
            report.decision = "unread"
            report.reasons.append("the second reader was not asked (run without a model)")
        reports.append(report)
        if write:
            path.write_text(dump(apply(document, report, now=now)), encoding="utf-8")
    return reports


def network_acquire(cache: Path | None, *, offline: bool = False) -> Acquire:
    """Fetch each cited document with the discovery fetcher; fall back to a local copy, and say so.

    The fallback exists for one reason seen on 2026-09-05: ``nios.ac.in`` serves a certificate
    chain this machine's Python cannot build, while curl (the system trust store) can. A copy
    fetched that way sits in ``cache/<document_id>.pdf``; it is still hashed against the build's
    record, and the transport is written into the file so nobody mistakes it for a urllib fetch.
    """
    from wobo_gateway.curriculum.discovery.fetch import FetchRefused, default_opener

    budget = FetchBudget(max_bytes=64 * 1024 * 1024, timeout_s=180.0)

    def acquire(document_id: str, entry: dict[str, Any]) -> Source:
        url = str(entry.get("url") or "")
        local = cache / f"{document_id}.pdf" if cache else None
        stamp = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        error: str | None = None
        if not offline:
            try:
                response = default_opener(url, budget=budget)
                if response.status < 400:
                    document, reader = read_source(
                        document_id, response.body, url=url, fetched_at=stamp
                    )
                    if local:
                        local.write_bytes(response.body)
                    return Source(document_id, document, transport="urllib GET", reader=reader)
                error = f"http {response.status}"
            except FetchRefused as exc:
                error = f"{exc.reason}: {exc.detail}"
            except Exception as exc:  # noqa: BLE001 — recorded, never raised past a file
                error = f"{type(exc).__name__}: {exc}"
        if local and local.is_file():
            document, reader = read_source(
                document_id, local.read_bytes(), url=url, fetched_at=stamp
            )
            why = "offline run" if offline else f"urllib refused ({error})"
            return Source(
                document_id,
                document,
                transport=f"local copy {local.name} ({why}), hashed against the build",
                reader=reader,
            )
        return Source(document_id, None, error=error or "no local copy and no network")

    return acquire


def main(argv: Sequence[str] | None = None) -> int:
    """``python -m wobo_gateway.curriculum.discovery.audit --root content/curriculum/syllabi``."""
    import argparse

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", type=Path, required=True, help="content/curriculum/syllabi")
    parser.add_argument("--cache", type=Path, default=None, help="where fetched bytes are kept")
    parser.add_argument("--offline", action="store_true", help="read sources from --cache only")
    parser.add_argument("--no-model", action="store_true", help="never call the second reader")
    parser.add_argument("--budget-usd", type=float, default=10.0)
    parser.add_argument("--write", action="store_true", help="rewrite the seed files with verdicts")
    parser.add_argument("--report", type=Path, default=None, help="docs/curriculum/VERIFICATION.md")
    parser.add_argument(
        "--json", type=Path, default=None, help="machine-readable ledger of the pass"
    )
    args = parser.parse_args(argv)

    now = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    ledger = CostLedger(budget_usd=args.budget_usd)
    if args.cache:
        args.cache.mkdir(parents=True, exist_ok=True)
    reports = run_pass(
        args.root,
        acquire=network_acquire(args.cache, offline=args.offline),
        complete=None if args.no_model else live_completion(ledger),
        ledger=ledger,
        now=now,
        write=args.write,
    )
    if args.report:
        existing = args.report.read_text(encoding="utf-8") if args.report.is_file() else None
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            merge_generated(existing, render_table(reports, ledger, checked_at=now)),
            encoding="utf-8",
        )
    if args.json:
        args.json.write_text(
            json.dumps(
                {
                    "checked_at": now,
                    "ledger": ledger.calls,
                    "spent_usd": ledger.spent_usd,
                    "reports": [r.as_dict() for r in reports],
                },
                indent=1,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    for report in reports:
        print(f"{report.decision:12} {report.path}  {'; '.join(report.reasons)[:160]}")
    print(f"second reader: {len(ledger.calls)} calls, USD {ledger.spent_usd:.4f}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
