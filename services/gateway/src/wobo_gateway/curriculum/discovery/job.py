"""The discovery job: one state machine, one budget, one syllabus per framework and level.

``queued → searching → fetching → extracting → checking → provisional | refused``
(``docs/CURRICULUM.md`` §4). Every transition is checked, every refusal has a machine reason and
one plain line in Wobo's voice, and the whole run is metered as a generation, because that is
what it costs.

**Idempotency is the point.** The key is framework, version, level and subject, normalised. The
first learner's job creates the record; every later learner — arriving a second later or a month
later — reads it. A second discovery for a framework that is already stored is one of the things
``CURRICULUM.md`` §12 says kills this, so the claim is atomic in the store rather than a
check-then-write in the caller, and a lost race refunds the meter instead of running twice.

**One redraw, then refusal.** A failed structural check or a disagreeing second reader sends the
extraction back once, with the failures named. A second failure refuses. Wobo never invents a
syllabus, and never serves one it could not check.

**Promotion** is not part of the run. A stored syllabus becomes ``verified`` when its checks all
passed and two different learners have used it without structurally editing it, or when the owner
approves it in the review queue. A learner who restructures it flags the record, and a flagged
record stays provisional until the owner looks (``CURRICULUM.md`` §4.5).
"""

from __future__ import annotations

import hashlib
import logging
import re
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Protocol

from wobo_gateway.curriculum.discovery import ceiling
from wobo_gateway.curriculum.discovery import search as search_stage
from wobo_gateway.curriculum.discovery import verify as verify_stage
from wobo_gateway.curriculum.discovery.extract import (
    CAPABILITY,
    Completion,
    ExtractionRefused,
    Syllabus,
    SyllabusRequest,
    extract_syllabus,
)
from wobo_gateway.curriculum.discovery.fetch import (
    Document,
    FetchBudget,
    FetchRefused,
    fetch_document,
)
from wobo_gateway.curriculum.discovery.search import (
    SearchBudget,
    SearchProvider,
    SearchUnavailable,
)
from wobo_gateway.curriculum.discovery.verify import (
    VerificationReport,
    document_is_current,
    document_is_plausible,
    problems_for_redraw,
    redrawable,
    verify_extraction,
)

logger = logging.getLogger("wobo.gateway.curriculum.discovery.job")

_KEY_PUNCT = re.compile(r"[^a-z0-9]+")

#: How much of one candidate's verdict rides in the trail. The refusal's ``detail`` carries the
#: whole sentence; the trail is the list a person scans down, and a paragraph per row is not one.
_TRAIL_CHARS = 140


class JobState(StrEnum):
    QUEUED = "queued"
    SEARCHING = "searching"
    FETCHING = "fetching"
    EXTRACTING = "extracting"
    CHECKING = "checking"
    PROVISIONAL = "provisional"
    REFUSED = "refused"


TERMINAL_STATES = frozenset({JobState.PROVISIONAL, JobState.REFUSED})

# The only moves the machine allows. ``fetching → fetching`` and ``extracting → fetching`` are the
# next-candidate path: the first document found is often the wrong one, and trying the second is
# not a new job (a candidate can be abandoned at any reading stage, so fetching is reachable from
# both). ``checking → extracting`` is the single redraw.
_TRANSITIONS: dict[JobState, frozenset[JobState]] = {
    JobState.QUEUED: frozenset({JobState.SEARCHING, JobState.FETCHING, JobState.REFUSED}),
    JobState.SEARCHING: frozenset({JobState.FETCHING, JobState.REFUSED}),
    JobState.FETCHING: frozenset({JobState.EXTRACTING, JobState.FETCHING, JobState.REFUSED}),
    JobState.EXTRACTING: frozenset({JobState.CHECKING, JobState.FETCHING, JobState.REFUSED}),
    JobState.CHECKING: frozenset(
        {JobState.PROVISIONAL, JobState.EXTRACTING, JobState.FETCHING, JobState.REFUSED}
    ),
    JobState.PROVISIONAL: frozenset(),
    JobState.REFUSED: frozenset(),
}

# Every refusal a learner can see, in Wobo's voice: what happened, then the door that is open.
# Sentence case, no emoji, no exclamation marks (WOBO-PLAN §0).
_OWN_SYLLABUS = "Show me your syllabus and I will build it with you."
_REFUSAL_LINES: dict[str, str] = {
    "search_unavailable": "I could not go looking for {what} just now. " + _OWN_SYLLABUS,
    "not_found": "I could not find an official syllabus for {what}. " + _OWN_SYLLABUS,
    "not_fetchable": (
        "I found pages for {what} but could not open the document itself. " + _OWN_SYLLABUS
    ),
    "no_syllabus_in_document": (
        "What I found for {what} is not the syllabus itself. " + _OWN_SYLLABUS
    ),
    # The document IS on the board's own site under a name that says what it is, and its text
    # layer is a legacy font we cannot match (``verify.text_layer_is_unreadable``, and Uttar
    # Pradesh on 2026-09-15). This sentence used to be the one above it, which told a learner the
    # opposite of what happened: their board's syllabus refused as not being a syllabus. What we
    # may claim is only that we could not read it, and the other door.
    "document_unreadable": (
        "I found a document for {what} on the board's site and could not read what is written in "
        "it. " + _OWN_SYLLABUS
    ),
    # The document IS the board's syllabus, and it is an old one. The learner is told the shape
    # of that and never the year we read off the file: what they can act on is the other door.
    "document_out_of_date": (
        "The syllabus I can find for {what} on the board's site is an older one, not this "
        "year's. " + _OWN_SYLLABUS
    ),
    "checks_failed": (
        "I read a syllabus for {what}, and it did not match the document closely enough for me to "
        "trust it. " + _OWN_SYLLABUS
    ),
    "out_of_time": "Looking for {what} took longer than I can spend on it. " + _OWN_SYLLABUS,
    "out_of_scope": (
        "I teach school, classes four to thirteen, so {what} is outside what I can build."
    ),
    # The four the guard raises (``ceiling.py``): the hard stop, the two money ceilings and a
    # board that has been left alone. None of them is the learner's fault and none of them says
    # the word budget — what they need to know is that it is not happening now, and that the
    # other door is open.
    "discovery_stopped": ("I am not looking up new syllabuses at the moment. " + _OWN_SYLLABUS),
    "day_budget_spent": (
        "I have done as much looking as I can manage today, so {what} will have to be tomorrow. "
        + _OWN_SYLLABUS
    ),
    "board_budget_spent": (
        "I have done as much looking as I can manage today, so {what} will have to be tomorrow. "
        + _OWN_SYLLABUS
    ),
    "board_resting": (
        "I have tried this board's site more than once today and it will not open for me. "
        + _OWN_SYLLABUS
    ),
}
_DEFAULT_REFUSAL = "I could not put together a syllabus for {what}. " + _OWN_SYLLABUS


# Grades 4 to 13 wherever a framework has them, school level only (CURRICULUM.md §11). Year 14
# is included because Northern Ireland's upper sixth is a school year — the same boundary the
# registry seed uses (content/curriculum/build.py).
SCHOOL_LEVELS = range(4, 15)

# A refusal is what we knew that day, not a verdict for all time: a board's site was down, or the
# syllabus had not been published yet. After this long the same learner's question is allowed to
# cost another look. Anything sooner is served the stored refusal, so a reload is never a retry.
#: The default. The live value is the dial ``discovery.refusal.retry_days``
#: (``ceiling.retry_refused_after_days``), so the owner can widen the window from the console on a
#: day when every board's host is slow, without a deploy.
RETRY_REFUSED_AFTER_DAYS = 7

#: The refusals that are facts about US on this day, never about the board or its document: the
#: hard stop, the two money ceilings and a board being rested. They are written down like any
#: other refusal, so the console can see them, and they are reopened the moment they are asked
#: again — a board refused at five to midnight for a spent day must not be refused for the week
#: that follows. The guard itself is what refuses again if the money is still gone.
TRANSIENT_REASONS = frozenset(
    {"discovery_stopped", "day_budget_spent", "board_budget_spent", "board_resting"}
)


def in_scope(request: SyllabusRequest) -> bool:
    """School only. A level with no number in it (``IGCSE``, ``Foundation``) is left alone."""
    order = request.level_order
    return order is None or order in SCHOOL_LEVELS


class IllegalTransition(Exception):
    """A state moved somewhere the machine does not allow. A bug, never a learner's fault."""


class _Refusal(Exception):
    """Internal: end the run honestly at whatever stage noticed."""

    def __init__(self, reason: str, detail: str = "") -> None:
        self.reason = reason
        self.detail = detail
        super().__init__(reason)


@dataclass(frozen=True)
class DiscoveryBudget:
    """What one discovery may spend before it refuses. A learner is waiting on all of it."""

    search: SearchBudget = field(default_factory=SearchBudget)
    fetch: FetchBudget = field(default_factory=FetchBudget)
    max_documents: int = 3
    wall_clock_s: float = 120.0
    redraws: int = 1


def discovery_key(request: SyllabusRequest) -> str:
    """framework + version + level + subject, normalised. The idempotency key, and the row id."""
    parts = [
        request.framework_id or request.framework_name,
        request.version or "any",
        request.level,
        request.subject,
    ]
    slug = "|".join(_KEY_PUNCT.sub("-", part.strip().lower()).strip("-") for part in parts)
    return f"{slug[:120]}:{hashlib.sha256(slug.encode()).hexdigest()[:10]}"


@dataclass
class JobRecord:
    """One discovery, its state, its result and everything the review queue needs."""

    key: str
    request: SyllabusRequest
    state: JobState = JobState.QUEUED
    created_at: str = ""
    updated_at: str = ""
    history: tuple[tuple[str, str], ...] = ()
    reason: str | None = None
    message: str | None = None
    syllabus: dict[str, Any] | None = None
    provenance: dict[str, Any] | None = None
    report: dict[str, Any] | None = None
    status: str = "pending"
    #: Why the refusal happened, in our words rather than the learner's: the url, the checks that
    #: failed, the exception. It is for the console queue and the log, and :attr:`served` drops it.
    detail: str = ""
    #: Every candidate this run opened, the title the search gave it, and what became of it. The
    #: refusal reason is the LAST thing that happened; a person looking at the row needs the
    #: whole of it. Tamil Nadu refused ``not_fetchable`` on one candidate from the exam
    #: directorate titled "SSLC Public Examination – Scheme of Examination", and the row said
    #: only that a document would not open — which reads as a TLS fault worth retrying rather
    #: than as a board whose syllabus is published by somebody else entirely.
    tried: tuple[str, ...] = ()
    used_by: tuple[str, ...] = ()
    flagged: bool = False
    owner_note: str = ""
    supersedes: str | None = None

    @property
    def terminal(self) -> bool:
        return self.state in TERMINAL_STATES

    @property
    def served(self) -> dict[str, Any]:
        """What crosses out of the brain: never a model id, never a provider name."""
        provenance = dict(self.provenance or {})
        provenance.pop("extractor_model", None)
        provenance.pop("verifier_model", None)
        return {
            "state": self.state.value,
            "status": self.status,
            "message": self.message,
            "reason": self.reason,
            "syllabus": self.syllabus,
            "provenance": provenance or None,
            "label": label_for(self.status, self.request),
        }


def label_for(status: str, request: SyllabusRequest) -> str:
    """The honest label a learner reads (``CURRICULUM.md`` §5). Never a badge with a number."""
    version = f" {request.version}" if request.version else ""
    if status == "verified":
        return f"Official {request.framework_name}{version}, verified"
    if status == "provisional":
        return "Found on the board's site, still checking"
    if status == "community":
        return "Shared by another learner, not yet checked"
    if status == "personal":
        return "Drafted from your syllabus, check it"
    return "Not found yet"


class JobStore(Protocol):
    def get(self, key: str) -> JobRecord | None: ...

    def claim(self, key: str, request: SyllabusRequest) -> tuple[JobRecord, bool]: ...

    def save(self, record: JobRecord) -> None: ...


class InMemoryJobStore:
    """The process-local store. The durable one is ``curriculum.discovery_jobs`` in Supabase,
    written by the service role; this implements the same three methods, and ``claim`` is
    atomic here for the same reason it must be a single upsert there."""

    def __init__(self) -> None:
        self._records: dict[str, JobRecord] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> JobRecord | None:
        with self._lock:
            return self._records.get(key)

    def claim(self, key: str, request: SyllabusRequest) -> tuple[JobRecord, bool]:
        """(record, created). ``created`` is False when someone already owns this discovery."""
        with self._lock:
            existing = self._records.get(key)
            if existing is not None:
                return existing, False
            record = JobRecord(key=key, request=request)
            _stamp(record, JobState.QUEUED)
            self._records[key] = record
            return record, True

    def save(self, record: JobRecord) -> None:
        with self._lock:
            self._records[record.key] = record

    def all(self) -> tuple[JobRecord, ...]:
        with self._lock:
            return tuple(self._records.values())

    def review_queue(self) -> tuple[JobRecord, ...]:
        """Everything a person should look at: flagged, or provisional and checkable."""
        return tuple(
            record
            for record in self.all()
            if record.status == "provisional" and (record.flagged or record.report)
        )


def _worth_reopening(record: JobRecord, *, force: bool = False) -> bool:
    """Only a refusal is ever reopened, and only once it has gone stale (or the owner asks)."""
    if record.state is not JobState.REFUSED:
        return False
    if force or record.reason in TRANSIENT_REASONS:
        return True
    when = record.updated_at
    if not when:
        return False
    try:
        refused_at = datetime.fromisoformat(when.replace("Z", "+00:00"))
    except ValueError:  # pragma: no cover — a stamp we wrote ourselves
        return False
    if refused_at.tzinfo is None:
        refused_at = refused_at.replace(tzinfo=UTC)
    return (datetime.now(UTC) - refused_at) >= timedelta(days=ceiling.retry_refused_after_days())


def _reopen(record: JobRecord) -> JobRecord:
    """Start a fresh run on the same key. Terminal states have no outgoing transition by design,
    so this is deliberate and explicit rather than a move the machine allows."""
    record.state = JobState.QUEUED
    record.reason = None
    record.message = None
    record.status = "pending"
    # The last run's evidence goes with the last run's reason. A retry that kept the trail would
    # show a person the candidates of a run that is over beside the verdict of one that has not
    # started, and the two would read as one.
    record.detail = ""
    record.tried = ()
    record.history = (*record.history, ("reopened", _now()))
    _stamp(record, JobState.QUEUED)
    return record


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _stamp(record: JobRecord, state: JobState, *, at: str | None = None) -> None:
    moment = at or _now()
    record.created_at = record.created_at or moment
    record.state = state
    record.updated_at = moment
    record.history = (*record.history, (state.value, moment))


def advance(record: JobRecord, state: JobState, *, at: str | None = None) -> JobRecord:
    """Move the machine, or raise. An illegal move is a bug we want loudly, not a silent state."""
    if state not in _TRANSITIONS[record.state]:
        raise IllegalTransition(f"{record.state.value} → {state.value}")
    _stamp(record, state, at=at)
    return record


# --- the run ------------------------------------------------------------------------------
def _charge(subject: str | None, capability: str = CAPABILITY) -> None:
    """Meter one discovery as a generation. ``None`` is an internal run (freshness, the owner)."""
    if subject is None:
        return
    from wobo_gateway import budget as budget_meter

    budget_meter.charge(subject, capability)


def _refund(subject: str | None, capability: str = CAPABILITY) -> None:
    if subject is None:
        return
    from wobo_gateway import budget as budget_meter

    budget_meter.refund(subject, capability)


def refusal_line(reason: str, request: SyllabusRequest) -> str:
    """The one line a learner reads for one refusal reason, in Wobo's voice.

    Public because the worker refuses some jobs before a run exists to refuse (a board resting
    behind three closed doors, a board that has spent its own day), and "I could not find an
    official syllabus for that" would be the wrong sentence for both: we did not look.
    """
    return _REFUSAL_LINES.get(reason, _DEFAULT_REFUSAL).format(what=request.describe())


def _refuse(record: JobRecord, reason: str, detail: str, store: JobStore) -> JobRecord:
    record.reason = reason
    record.message = refusal_line(reason, record.request)
    record.detail = detail
    record.status = "refused"
    advance(record, JobState.REFUSED)
    store.save(record)
    # A refusal about the BOARD is remembered, so the next learner who picks it is not the next
    # learner to pay for the same closed door (docs/BOARD-COLD-START.md §5).
    ceiling.remember_refusal(record.request.framework_id, reason)
    logger.info(
        "discovery.refused",
        extra={"fields": {"key": record.key, "reason": reason, "detail": detail[:200]}},
    )
    return record


def _provenance(
    document: Document,
    syllabus: Syllabus,
    report: VerificationReport,
    *,
    extractor_model: str,
) -> dict[str, Any]:
    """Everything ``CURRICULUM.md`` §5 requires on every node's source."""
    first = syllabus.units[0].source_ref if syllabus.units else None
    return {
        "source_url": document.url,
        "source_page_or_section": (
            f"page {first.page}" if first and first.page else (first.section if first else None)
        ),
        "document_hash": document.document_sha256,
        "fetched_at": document.fetched_at,
        "extractor_model": extractor_model,
        "verifier_model": report.verifier_model,
        "checks_passed": list(report.passed_names),
        "verified_at": None,
        "verified_by": None,
    }


def run_discovery(
    request: SyllabusRequest,
    *,
    store: JobStore,
    meter_subject: str | None = None,
    search_provider: SearchProvider | None = None,
    seed_urls: Sequence[str] = (),
    fetch_fn: Callable[..., Document] = fetch_document,
    complete_generate: Completion | None = None,
    complete_verify: Completion | None = None,
    budget: DiscoveryBudget | None = None,
    first_extraction: bool = False,
    second_reader: bool = True,
    supersedes: str | None = None,
    force: bool = False,
    clock: Callable[[], float] = time.monotonic,
    now: datetime | None = None,
) -> JobRecord:
    """Run one discovery to ``provisional`` or ``refused``, or return the one already stored.

    ``seed_urls`` skips the search stage: the freshness job already knows the document's URL, and
    re-searching for a page we have been reading for a year would be spend for nothing.
    ``force`` reopens a stored record — the owner's way of asking for another look now. It does
    exactly that and nothing else: **it does not lift the ceiling.** It used to, and since the
    discovery worker sets it on every job it drains, the hard stop, the resting board and both
    money ceilings were guards over every path in the system except the one that runs in
    production. The owner's ways past each guard are the guard's own: ``discovery.running``,
    ``ceiling.wake()``, and the two ``max_usd`` dials.
    """
    budget = budget or DiscoveryBudget()
    key = discovery_key(request)

    stored = store.get(key)
    if stored is not None and not _worth_reopening(stored, force=force):
        logger.info("discovery.reused", extra={"fields": {"key": key, "state": stored.state.value}})
        return stored

    if not in_scope(request):
        record, created = store.claim(key, request)
        if not created and record.terminal:  # a stale refusal we were asked to look at again
            _reopen(record)
        return _refuse(record, "out_of_scope", f"level {request.level}", store)

    # The money guard and the hard stop, before a generation is charged and before a job is
    # claimed, so a discovery that may not run costs nothing at all (``ceiling.py``).
    stop = ceiling.verdict(request.framework_id)
    if stop:
        record, created = store.claim(key, request)
        if not created and record.terminal:
            _reopen(record)
        day = ceiling.state()
        return _refuse(
            record,
            stop,
            f"{request.framework_id}: {day.by_board.get(request.framework_id or '', 0.0):.4f} of "
            f"{ceiling.board_ceiling_usd()} USD on this board, {day.total_usd:.4f} of "
            f"{ceiling.daily_ceiling_usd()} USD on {day.day}",
            store,
        )

    _charge(meter_subject)
    record, created = store.claim(key, request)
    if not created and not _worth_reopening(record, force=force):
        # someone else won the race between the read and the claim
        _refund(meter_subject)
        return record
    if not created:
        _reopen(record)
    record.supersedes = supersedes
    deadline = clock() + budget.wall_clock_s

    # Everything that can cost money happens inside the meter: what the run spends is the
    # difference across the platform's own ledger, and it is billed to this board whichever way
    # the run ends (``ceiling.meter``).
    # The class and the subject are handed over so the run is billed under the key its own row
    # carries (``ceiling.run_key``): a process that dies and comes back reads the day off those
    # rows, and a run it cannot recognise is a run it charges the board for twice.
    with ceiling.meter(request.framework_id, level=request.level, subject=request.subject) as run:

        def _check_clock(stage: str) -> None:
            if clock() >= deadline:
                raise _Refusal("out_of_time", stage)
            spent = run.exceeded()
            if spent:
                raise _Refusal(spent, f"{stage}: {run.so_far():.4f} USD so far")

        try:
            candidates: list[_Candidate] = [_Candidate(url=url) for url in seed_urls if url]
            if not candidates:
                advance(record, JobState.SEARCHING)
                store.save(record)
                _check_clock("search")
                candidates = _search(request, search_provider, budget)

            document, extraction, report = _read_and_check(
                record=record,
                request=request,
                candidates=candidates,
                store=store,
                budget=budget,
                fetch_fn=fetch_fn,
                complete_generate=complete_generate,
                complete_verify=complete_verify,
                first_extraction=first_extraction,
                second_reader=second_reader,
                check_clock=_check_clock,
                now=now,
            )
        except _Refusal as refusal:
            return _refuse(record, refusal.reason, refusal.detail, store)

    syllabus = extraction.syllabus
    if supersedes:
        syllabus = Syllabus(
            request=syllabus.request,
            units=syllabus.units,
            documents=syllabus.documents,
            version=syllabus.version,
            status=syllabus.status,
            note=syllabus.note,
            supersedes=supersedes,
        )
    record.syllabus = syllabus.as_dict()
    record.provenance = _provenance(document, syllabus, report, extractor_model=extraction.model)
    record.report = report.as_dict()
    record.status = "provisional"
    record.message = label_for("provisional", request)
    advance(record, JobState.PROVISIONAL)
    store.save(record)
    logger.info(
        "discovery.provisional",
        extra={
            "fields": {
                "key": key,
                "units": len(syllabus.units),
                "topics": syllabus.topic_count,
                "source": document.url,
                "checks_passed": list(report.passed_names),
            }
        },
    )
    return record


@dataclass(frozen=True)
class _Candidate:
    """One document to try, and the title whoever offered it gave it.

    The title is never evidence — :func:`verify.text_layer_is_unreadable` reads the file's own
    name and not this — but it is the difference between a console row that says "a document
    would not open" and one that says WHICH document, called what, from whose host.
    """

    url: str
    title: str = ""

    def describe(self) -> str:
        return f"{self.url} — {self.title}" if self.title else self.url


def _search(
    request: SyllabusRequest, provider: SearchProvider | None, budget: DiscoveryBudget
) -> list[_Candidate]:
    if provider is None:
        try:
            provider = search_stage.build_search_provider()
        except SearchUnavailable as exc:
            raise _Refusal("search_unavailable", str(exc)) from exc
    queries = search_stage.plan_queries(
        framework_name=request.framework_name,
        level=request.level,
        subject=request.subject,
        version=request.version,
        official_site=request.official_site,
        country=request.country,
        aliases=request.aliases,
    )
    try:
        results = search_stage.run_search(
            provider, queries, budget=budget.search, official_site=request.official_site
        )
    except SearchUnavailable as exc:
        raise _Refusal("search_unavailable", str(exc)) from exc
    if not results:
        raise _Refusal("not_found", "no candidate document")
    return [_Candidate(url=result.url, title=result.title) for result in results]


def _document_reason(report: VerificationReport) -> str:
    """The refusal a report earns when every failure is about the document, not the reading."""
    failed = {check.name for check in report.failures}
    if failed == {verify_stage.CHECK_DOCUMENT_YEAR}:
        return "document_out_of_date"
    return "checks_failed"


def _checks_detail(url: str, report: VerificationReport) -> str:
    """The refusal's detail: every check that failed, named, not the first three problems.

    A ``checks_failed`` row in the console queue is only actionable if it says what failed. The
    second reader's problems are what it objected to; the code-side checks are what did not hold.
    """
    failed = [check.name for check in report.failures]
    problems = list(report.problems)
    parts = [url]
    if failed:
        parts.append("failed: " + ", ".join(failed))
    if problems:
        parts.append("; ".join(problems[:5]))
    return " — ".join(parts)


def _keep_rejected(
    record: JobRecord, url: str, extraction: Any, report: VerificationReport
) -> None:
    """Attach the reading that failed and the report that refused it, for a person to look at.

    It goes on ``report``, never on ``syllabus``: a refused job must not carry a reading a
    learner could be served, and :attr:`JobRecord.served` never crosses ``report`` out.
    """
    rejected = report.as_dict()
    rejected["source_url"] = url
    try:
        rejected["syllabus"] = extraction.syllabus.as_dict()
    except Exception:  # pragma: no cover — a reading we could not even serialise
        rejected["syllabus"] = None
    record.report = rejected


def _read_and_check(
    *,
    record: JobRecord,
    request: SyllabusRequest,
    candidates: Sequence[_Candidate],
    store: JobStore,
    budget: DiscoveryBudget,
    fetch_fn: Callable[..., Document],
    complete_generate: Completion | None,
    complete_verify: Completion | None,
    first_extraction: bool,
    second_reader: bool,
    check_clock: Callable[[str], None],
    now: datetime | None = None,
) -> tuple[Document, Any, VerificationReport]:
    """Fetch, extract and check each candidate in turn until one survives, or refuse.

    The last failure wins the refusal reason, because it is the most specific thing we learned:
    "what I found is not the syllabus" is a better line than "I could not open it" when we did
    open the second one. **What each candidate cost us is written down as we go**
    (:attr:`JobRecord.tried`), because the last failure is not the whole run and a refusal
    carrying only its last line is a console row nobody can act on.
    """
    fetch_failures = 0
    last_reason = "not_found"
    last_detail = ""

    def _note(candidate: _Candidate, verdict: str) -> None:
        """One line per candidate, terse. The whole sentence is the refusal's ``detail``; this is
        the list a person scans, and a paragraph per row would not be one."""
        short = " ".join(verdict.split())
        if len(short) > _TRAIL_CHARS:
            short = short[: _TRAIL_CHARS - 1].rstrip() + "…"
        record.tried = (*record.tried, f"{candidate.describe()} — {short}")

    for candidate in list(candidates)[: budget.max_documents]:
        url = candidate.url
        check_clock("fetch")
        advance(record, JobState.FETCHING)
        store.save(record)
        try:
            document = fetch_fn(url, budget=budget.fetch)
        except FetchRefused as exc:
            fetch_failures += 1
            last_reason, last_detail = "not_fetchable", f"{url}: {exc.reason}"
            _note(candidate, f"not_fetchable ({exc.reason})")
            logger.info(
                "discovery.fetch refused",
                extra={"fields": {"url": url, "reason": exc.reason}},
            )
            continue

        # Before a model is paid to read it: could this document be this subject's syllabus at
        # all? The first live run paid four extractions across two Uttar Pradesh pdfs to be told
        # what the document itself could have said for nothing (``verify.document_is_plausible``).
        wrong = document_is_plausible(document, request)
        if wrong:
            # Two different facts used to share one sentence. A document that names neither the
            # level nor the subject is EITHER the wrong document OR the right one in a text
            # layer we cannot match — Uttar Pradesh's Class 10 Mathematics pdf is the second,
            # and "what I found is not the syllabus itself" was the opposite of what happened to
            # it (``verify.text_layer_is_unreadable``).
            unreadable = verify_stage.text_layer_is_unreadable(document, request)
            if unreadable:
                last_reason, last_detail = "document_unreadable", f"{url}: {unreadable}"
            else:
                last_reason, last_detail = "no_syllabus_in_document", f"{url}: {wrong}"
            _note(candidate, f"{last_reason} ({unreadable or wrong})")
            logger.info(
                "discovery.document refused",
                extra={"fields": {"url": url, "reason": last_reason, "detail": last_detail[:200]}},
            )
            continue

        # And the same question about the YEAR, for the same reason and at the same price:
        # the file's own /CreationDate is free to read, and on 2026-09-15 it was the difference
        # between refusing Maharashtra's 2012-sanctioned pdf and paying two models to transcribe
        # a withdrawn syllabus faithfully (``verify.document_is_current``, ``dating.py``).
        old = document_is_current(document, request, now=now)
        if old:
            last_reason, last_detail = "document_out_of_date", f"{url}: {old}"
            _note(candidate, f"document_out_of_date ({old})")
            logger.info(
                "discovery.document out of date",
                extra={"fields": {"url": url, "reason": old[:200]}},
            )
            continue

        check_clock("extract")
        advance(record, JobState.EXTRACTING)
        store.save(record)
        try:
            extraction = extract_syllabus(
                document,
                request,
                complete=complete_generate,
                first_extraction=first_extraction,
            )
        except ExtractionRefused as exc:
            last_reason, last_detail = "no_syllabus_in_document", f"{url}: {exc}"
            _note(candidate, f"no_syllabus_in_document ({exc.reason})")
            logger.info(
                "discovery.extract refused",
                extra={"fields": {"url": url, "reason": exc.reason}},
            )
            continue

        check_clock("check")
        advance(record, JobState.CHECKING)
        store.save(record)
        report = verify_extraction(
            extraction.syllabus,
            document,
            request,
            complete=complete_verify,
            second_reader=second_reader,
            other_than=extraction.model,
            now=now,
        )
        if report.ok:
            return document, extraction, report

        # A failure a redraw cannot fix is a fact about the DOCUMENT — its year — and reading the
        # same file again will not change it. Keep the reading for a person, refuse for what it
        # is, and go to the next candidate rather than buy one more generation.
        if not redrawable(report):
            last_reason = _document_reason(report)
            last_detail = _checks_detail(url, report)
            _keep_rejected(record, url, extraction, report)
            _note(candidate, f"{last_reason} (no redraw could fix it)")
            continue

        # One redraw, with every failure named, then we stop. Two readings that disagree with the
        # document are not a third reading away from being right.
        for _ in range(max(0, budget.redraws)):
            check_clock("redraw")
            advance(record, JobState.EXTRACTING)
            store.save(record)
            try:
                extraction = extract_syllabus(
                    document,
                    request,
                    complete=complete_generate,
                    first_extraction=first_extraction,
                    problems=problems_for_redraw(report),
                )
            except ExtractionRefused as exc:
                last_reason, last_detail = "checks_failed", f"{url}: redraw refused ({exc})"
                break
            advance(record, JobState.CHECKING)
            store.save(record)
            report = verify_extraction(
                extraction.syllabus,
                document,
                request,
                complete=complete_verify,
                second_reader=second_reader,
                other_than=extraction.model,
                now=now,
            )
            if report.ok:
                return document, extraction, report
            last_reason = "checks_failed"
            last_detail = _checks_detail(url, report)
            _keep_rejected(record, url, extraction, report)
        else:
            last_reason = "checks_failed"
            last_detail = _checks_detail(url, report)
            _keep_rejected(record, url, extraction, report)
        _note(candidate, f"{last_reason} after {budget.redraws} redraw(s)")

    if fetch_failures and last_reason == "not_found":  # pragma: no cover — defensive
        last_reason = "not_fetchable"
    raise _Refusal(last_reason, last_detail)


# --- promotion (``CURRICULUM.md`` §4.5) -----------------------------------------------------
PROMOTION_USES = 2


def record_use(
    store: JobStore,
    key: str,
    subject: str,
    *,
    structural_edits: bool = False,
) -> JobRecord | None:
    """One learner used this syllabus. Structural edits flag it instead of counting toward trust.

    "Structural" means the learner changed the shape we extracted — added, removed or reordered a
    unit. Renaming a topic or marking one "not in my school" is an overlay, not a correction to
    the document, and does not flag anything.
    """
    record = store.get(key)
    if record is None or record.status not in {"provisional", "verified"}:
        return record
    if structural_edits:
        record.flagged = True
        record.used_by = tuple(name for name in record.used_by if name != subject)
    elif subject not in record.used_by:
        record.used_by = (*record.used_by, subject)
    record.updated_at = _now()
    store.save(record)
    maybe_promote(store, record)
    return store.get(key)


def maybe_promote(store: JobStore, record: JobRecord) -> bool:
    """Automatic promotion: checks all passed, nothing flagged, two clean learners."""
    if record.status != "provisional" or record.flagged:
        return False
    report = record.report or {}
    checks = report.get("checks") or []
    if not checks or any(check.get("passed") is not True for check in checks):
        return False
    if len(record.used_by) < PROMOTION_USES:
        return False
    return _promote(store, record, by="system")


def owner_review(store: JobStore, key: str, *, approve: bool, note: str = "") -> JobRecord | None:
    """The owner's verdict from the review queue. Approval promotes; a rejection refuses."""
    record = store.get(key)
    if record is None:
        return None
    record.owner_note = note
    if approve:
        _promote(store, record, by="owner")
    else:
        record.status = "refused"
        record.flagged = True
        record.updated_at = _now()
        store.save(record)
    return store.get(key)


def _promote(store: JobStore, record: JobRecord, *, by: str) -> bool:
    if record.syllabus is None:
        # There is nothing here to call verified. A refusal the owner approves stays a refusal.
        return False
    record.status = "verified"
    record.flagged = False
    record.message = label_for("verified", record.request)
    provenance = dict(record.provenance or {})
    provenance["verified_at"] = _now()
    provenance["verified_by"] = by
    record.provenance = provenance
    if record.syllabus is not None:
        record.syllabus = {**record.syllabus, "status": "verified"}
    record.updated_at = provenance["verified_at"]
    store.save(record)
    logger.info("discovery.promoted", extra={"fields": {"key": record.key, "by": by}})
    return True
