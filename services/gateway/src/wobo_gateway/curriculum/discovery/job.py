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

from wobo_gateway.curriculum.discovery import search as search_stage
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
    problems_for_redraw,
    verify_extraction,
)

logger = logging.getLogger("wobo.gateway.curriculum.discovery.job")

_KEY_PUNCT = re.compile(r"[^a-z0-9]+")


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
    "checks_failed": (
        "I read a syllabus for {what}, and it did not match the document closely enough for me to "
        "trust it. " + _OWN_SYLLABUS
    ),
    "out_of_time": "Looking for {what} took longer than I can spend on it. " + _OWN_SYLLABUS,
    "out_of_scope": (
        "I teach school, classes four to thirteen, so {what} is outside what I can build."
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
RETRY_REFUSED_AFTER_DAYS = 7


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
    if force:
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
    return (datetime.now(UTC) - refused_at) >= timedelta(days=RETRY_REFUSED_AFTER_DAYS)


def _reopen(record: JobRecord) -> JobRecord:
    """Start a fresh run on the same key. Terminal states have no outgoing transition by design,
    so this is deliberate and explicit rather than a move the machine allows."""
    record.state = JobState.QUEUED
    record.reason = None
    record.message = None
    record.status = "pending"
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


def _refuse(record: JobRecord, reason: str, detail: str, store: JobStore) -> JobRecord:
    line = _REFUSAL_LINES.get(reason, _DEFAULT_REFUSAL)
    record.reason = reason
    record.message = line.format(what=record.request.describe())
    record.status = "refused"
    advance(record, JobState.REFUSED)
    store.save(record)
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
) -> JobRecord:
    """Run one discovery to ``provisional`` or ``refused``, or return the one already stored.

    ``seed_urls`` skips the search stage: the freshness job already knows the document's URL, and
    re-searching for a page we have been reading for a year would be spend for nothing.
    ``force`` reopens a stored record — the owner's way of asking for another look now.
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

    def _check_clock(stage: str) -> None:
        if clock() >= deadline:
            raise _Refusal("out_of_time", stage)

    try:
        candidates: list[str] = [url for url in seed_urls if url]
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
    record.provenance = _provenance(
        document, syllabus, report, extractor_model=extraction.model
    )
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


def _search(
    request: SyllabusRequest, provider: SearchProvider | None, budget: DiscoveryBudget
) -> list[str]:
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
    return [result.url for result in results]


def _read_and_check(
    *,
    record: JobRecord,
    request: SyllabusRequest,
    candidates: Sequence[str],
    store: JobStore,
    budget: DiscoveryBudget,
    fetch_fn: Callable[..., Document],
    complete_generate: Completion | None,
    complete_verify: Completion | None,
    first_extraction: bool,
    second_reader: bool,
    check_clock: Callable[[str], None],
) -> tuple[Document, Any, VerificationReport]:
    """Fetch, extract and check each candidate in turn until one survives, or refuse.

    The last failure wins the refusal reason, because it is the most specific thing we learned:
    "what I found is not the syllabus" is a better line than "I could not open it" when we did
    open the second one.
    """
    fetch_failures = 0
    last_reason = "not_found"
    last_detail = ""
    for url in list(candidates)[: budget.max_documents]:
        check_clock("fetch")
        advance(record, JobState.FETCHING)
        store.save(record)
        try:
            document = fetch_fn(url, budget=budget.fetch)
        except FetchRefused as exc:
            fetch_failures += 1
            last_reason, last_detail = "not_fetchable", f"{url}: {exc.reason}"
            logger.info(
                "discovery.fetch refused",
                extra={"fields": {"url": url, "reason": exc.reason}},
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
        )
        if report.ok:
            return document, extraction, report

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
            )
            if report.ok:
                return document, extraction, report
            last_reason = "checks_failed"
            last_detail = f"{url}: " + "; ".join(report.problems[:3])
        else:
            last_reason = "checks_failed"
            last_detail = f"{url}: " + "; ".join(report.problems[:3])

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


def owner_review(
    store: JobStore, key: str, *, approve: bool, note: str = ""
) -> JobRecord | None:
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
