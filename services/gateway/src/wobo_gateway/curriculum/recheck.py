"""The re-check: a stored syllabus read again against the board's own document.

Two callers, one routine. **First selection** (``docs/CURRICULUM-OBSERVER.md`` §2): the first time
any learner opens a provisional (board, class, subject), the check runs before the chapter list is
shown, with an honest line while it runs, and the second learner is served what it found. **The
freshness cadence** (``docs/CURRICULUM.md`` §9): the discovery worker runs the same check on every
stored subject monthly and inside the board's release window, so a syllabus that changed next year
becomes a new version with a diff rather than a stale list with our name on it.

What one check does, in order, and what each ending means to the learner:

1. Fetch the document the stored reading cites and compare the bytes to the stored hash. This is
   :func:`freshness.run_freshness_check`, unchanged.
   * unreachable -> the provisional reading is served, marked so in one plain line, with the
     own-syllabus door beside it. Tried again after the discovery cooldown.
   * changed -> discovery re-reads the new document into a **successor version** with
     ``supersedes``, the framework's other subjects carried forward. Learners pinned to the old
     version are offered the diff; nobody's chapter list is overwritten.
2. Same bytes: the reading itself is checked against the document, in code and by the second
   reader (:func:`verify.verify_extraction`, the pass every discovery goes through).
   * passed -> the subject is served as verified, and the label says so.
   * failed -> the provisional reading is served, marked so, and the review queue gets the report.
     A person decides; nothing changes for learners.

**What is recorded, and where.** The result lives on the ``discovery_jobs`` row for the (framework,
level, subject) key, under ``result.kind = "recheck"``. A version covers a whole board year and
provenance rows are immutable once published (0008), so the per-subject verdict has exactly one
honest home: the job that produced it. :func:`decide` reads that row and says what to show.

**Budget.** Every run is metered as a generation against the system's own subject, never a
learner's day, and refused outright when the platform's spend ceiling is shedding load. A check
that cannot afford to run says so in the same plain line as one that could not reach the document.
"""

from __future__ import annotations

import logging
import os
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from wobo_gateway.curriculum import labels
from wobo_gateway.curriculum.discovery import freshness
from wobo_gateway.curriculum.discovery.extract import (
    Completion,
    SourceRef,
    Syllabus,
    SyllabusRequest,
    Topic,
    Unit,
)
from wobo_gateway.curriculum.discovery.fetch import Document, fetch_document
from wobo_gateway.curriculum.discovery.job import DiscoveryBudget, InMemoryJobStore, JobStore
from wobo_gateway.curriculum.discovery.persist import Persisted, persist_successor
from wobo_gateway.curriculum.discovery.verify import verify_extraction
from wobo_gateway.curriculum.models import (
    DiscoveryJob,
    Framework,
    JobState,
    Node,
    Status,
    Version,
)
from wobo_gateway.curriculum.store import DISCOVERY_COOLDOWN_S, CurriculumStore, StoreUnavailable

logger = logging.getLogger("wobo.gateway.curriculum.recheck")

#: Metered as a generation: one fetch and up to three model calls. Same class as discovery.
CAPABILITY = "curriculum.discovery"
#: The system's meter subject. Housekeeping is metered, and it is never a learner's day.
SYSTEM_SUBJECT = "system:curriculum-recheck"
#: How a re-check is told apart from a discovery on the same ``discovery_jobs`` key.
KIND = "recheck"

ENV = "WOBO_RECHECK"

#: The lines a learner reads. Sentence case, no emoji, no exclamation marks, no em dashes.
CHECKING_LINE = "Checking this against the board's document now"
PROVISIONAL = labels.label(Status.PROVISIONAL)
UNREACHABLE_LINE = f"{PROVISIONAL}. I could not reach the board's document just now."
MISMATCH_LINE = (
    f"{PROVISIONAL}. What I read did not match the board's document closely enough, "
    "so a person will look at it."
)
SPENT_LINE = f"{PROVISIONAL}. I have done as much checking as I can manage today."
MOVED_LINE = "The board's document has changed since this was read, and a newer edition is ready."

#: After a mismatch a person is looking; the document is not asked again for this long.
RETRY_MISMATCH_AFTER_S = 7 * 24 * 60 * 60
#: A run that has been silent this long belonged to a process that is gone.
STALE_AFTER_S = 3 * DiscoveryBudget().wall_clock_s

OUTCOMES = ("verified", "unreachable", "mismatch", "new_version", "refused", "nothing_stored")


def enabled() -> bool:
    """On by default when a live model is configured; off in mock mode unless asked for by name.

    A mock verify tier would "agree" with anything, and a label that says verified on the
    strength of a canned reply is exactly the label §5 forbids.
    """
    raw = (os.getenv(ENV) or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return (os.getenv("LLM_MODE") or "mock").strip().lower() != "mock"


@dataclass(frozen=True)
class Outcome:
    """What one check found. ``line`` is the sentence a learner reads about it."""

    outcome: str
    line: str
    checks_passed: tuple[str, ...] = ()
    problems: tuple[str, ...] = ()
    document_hash: str | None = None
    verifier_model: str | None = None
    new_version_id: str | None = None
    summary: tuple[str, ...] = ()
    checked_at: str = field(default_factory=lambda: _now())

    @property
    def verified(self) -> bool:
        return self.outcome == "verified"

    def as_result(self, version: Version, subject: Node) -> dict[str, Any]:
        """The ``discovery_jobs.result`` row. The model id stays inside the brain: this row is
        read back by :func:`decide`, which never serves it."""
        return {
            "kind": KIND,
            "outcome": self.outcome,
            "version_id": version.id,
            "subject_node_id": subject.id,
            "checks_passed": list(self.checks_passed),
            "problems": list(self.problems)[:6],
            "document_hash": self.document_hash,
            "verifier_model": self.verifier_model,
            "new_version_id": self.new_version_id,
            "summary": list(self.summary),
            "checked_at": self.checked_at,
            "verified_at": self.checked_at if self.verified else None,
            "verified_by": "system" if self.verified else None,
        }


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# --- the check itself -----------------------------------------------------------------------------
def _as_syllabus(stored: dict[str, Any], request: SyllabusRequest, document: Document) -> Syllabus:
    """The registry's reading of one subject as the object the verify stage checks.

    A stored ``source_ref`` names the document by the id its own file gave it; the fetched
    document is keyed by its URL. The reading is being checked against the document it cites,
    so the primary document's id (the first unit's) is mapped onto the fetched one. A node that
    cites a SECOND document (the two-part NCERT textbooks) keeps its id, and the citation check
    says so honestly: the registry holds one source per version, and what it cannot check it
    does not call verified.
    """
    units_raw = [u for u in (stored.get("units") or []) if isinstance(u, dict)]
    first_ref = units_raw[0].get("source_ref") if units_raw else None
    primary = str(first_ref.get("document_id") or "") if isinstance(first_ref, dict) else ""

    def ref(raw: Any) -> SourceRef:
        raw = raw if isinstance(raw, dict) else {}
        page = raw.get("page")
        cited = str(raw.get("document_id") or "")
        return SourceRef(
            document_id=document.id if (not cited or cited == primary) else cited,
            page=int(page)
            if isinstance(page, int) or (isinstance(page, str) and page.isdigit())
            else None,
            section=str(raw["section"]) if raw.get("section") else None,
        )

    units: list[Unit] = []
    for u_index, unit in enumerate(units_raw, start=1):
        topics = tuple(
            Topic(
                title=str(topic.get("title") or topic.get("name") or ""),
                order=t_index,
                source_ref=ref(topic.get("source_ref")),
                objectives=tuple(str(o) for o in (topic.get("objectives") or []) if str(o).strip()),
            )
            for t_index, topic in enumerate(unit.get("topics") or [], start=1)
            if isinstance(topic, dict)
        )
        units.append(
            Unit(
                title=str(unit.get("title") or unit.get("name") or ""),
                order=u_index,
                source_ref=ref(unit.get("source_ref")),
                topics=topics,
            )
        )
    return Syllabus(
        request=request,
        units=tuple(units),
        documents=(document.as_provenance(),),
        version=str(stored.get("version") or request.version or "undated"),
        status=str(stored.get("status") or "provisional"),
    )


def check_subject(
    store: CurriculumStore,
    framework: Framework,
    version: Version,
    subject: Node,
    *,
    job_store: JobStore | None = None,
    fetch_fn: Callable[..., Document] = fetch_document,
    complete_generate: Completion | None = None,
    complete_verify: Completion | None = None,
    budget: DiscoveryBudget | None = None,
    second_reader: bool = True,
) -> Outcome:
    """One stored (version, subject) against the board's document. Never raises for a reason the
    learner should hear about: every ending is an :class:`Outcome` with its line."""
    from wobo_gateway.curriculum import observer as syllabus_observer

    budget = budget or DiscoveryBudget()
    jobs = job_store or InMemoryJobStore()
    # The projection the observer already builds: the registry rows as a JobRecord, with the
    # request carrying the label that makes the freshness path mint the right successor.
    ctx = syllabus_observer._gather(store, jobs, version, subject.id)
    if ctx is None:
        return Outcome("nothing_stored", UNREACHABLE_LINE)
    fresh = freshness.run_freshness_check(
        ctx.record,
        store=jobs,
        fetch_fn=fetch_fn,
        complete_generate=complete_generate,
        complete_verify=complete_verify,
        budget=budget,
        meter_subject=None,  # metered by the caller, once, against the system subject
        second_reader=second_reader,
    )
    if fresh.reason == "nothing_stored":
        return Outcome("nothing_stored", UNREACHABLE_LINE)
    if fresh.reason.startswith("unreachable:"):
        return Outcome("unreachable", UNREACHABLE_LINE, problems=(fresh.reason[12:],))
    if fresh.reason == "new_version" and fresh.new_record is not None:
        written: Persisted = persist_successor(store, framework, version, subject, fresh.new_record)
        return Outcome(
            "new_version",
            MOVED_LINE,
            document_hash=fresh.document.document_sha256 if fresh.document else None,
            new_version_id=written.version.id,
            summary=fresh.summary,
        )
    if fresh.reason.startswith("refused:") or fresh.document is None:
        # The document changed and the new one could not be read. The old reading keeps serving,
        # marked provisional, and a person is told (the freshness path already logged why).
        return Outcome(
            "refused",
            f"{PROVISIONAL}. The board's document has changed and I could not read the new "
            "one yet.",
            problems=(fresh.reason,),
        )
    # Same bytes. Now the reading itself, against the document, in code and by the second reader.
    syllabus = _as_syllabus(ctx.record.syllabus or {}, ctx.request, fresh.document)
    report = verify_extraction(
        syllabus, fresh.document, ctx.request, complete=complete_verify, second_reader=second_reader
    )
    if report.ok:
        return Outcome(
            "verified",
            labels.label(
                Status.VERIFIED, framework_name=framework.name, version_label=version.label
            ),
            checks_passed=report.passed_names,
            document_hash=fresh.document.document_sha256,
            verifier_model=report.verifier_model,
        )
    try:
        store.put_review_row(
            {
                "id": str(uuid.uuid4()),
                "version_id": version.id,
                "node_id": subject.id,
                "reason": ("recheck: " + "; ".join(report.problems[:3]))[:400],
                "state": "open",
                "kind": KIND,
                "framework_id": framework.id,
                "payload": {"report": report.as_dict(), "document": fresh.document.as_provenance()},
                "created_at": _now(),
            }
        )
    except StoreUnavailable:
        logger.warning("recheck: review row not written", extra={"fields": {"subject": subject.id}})
    return Outcome(
        "mismatch",
        MISMATCH_LINE,
        checks_passed=report.passed_names,
        problems=report.problems,
        document_hash=fresh.document.document_sha256,
        verifier_model=report.verifier_model,
    )


# --- the record on the job row -------------------------------------------------------------------
def _age_s(job: DiscoveryJob) -> float:
    from wobo_gateway.curriculum.store import _age_seconds

    return _age_seconds(job.updated_at or job.created_at) or 0.0


def _is_recheck(job: DiscoveryJob) -> bool:
    return bool(job.result) and job.result.get("kind") == KIND


@dataclass(frozen=True)
class Decision:
    """What ``curriculum.units`` shows for a stored subject, and whether to run a check first.

    ``state`` is one of ``run`` (start a check now), ``checking`` (one is running), ``verified``,
    ``provisional`` (serve the reading, marked so) and ``moved`` (a successor exists).
    """

    state: str
    line: str
    job: DiscoveryJob | None = None
    verified_at: str | None = None
    new_version_id: str | None = None
    checks_passed: tuple[str, ...] = ()

    @property
    def verified(self) -> bool:
        return self.state == "verified"


def _line_for(job: DiscoveryJob, framework: Framework, version: Version) -> Decision:
    result = job.result or {}
    outcome = str(result.get("outcome") or "")
    if outcome == "verified":
        return Decision(
            "verified",
            labels.label(
                Status.VERIFIED, framework_name=framework.name, version_label=version.label
            ),
            job,
            verified_at=result.get("verified_at"),
            checks_passed=tuple(result.get("checks_passed") or ()),
        )
    if outcome == "new_version":
        return Decision("moved", MOVED_LINE, job, new_version_id=result.get("new_version_id"))
    return Decision("provisional", job.message or UNREACHABLE_LINE, job)


def due_again(
    job: DiscoveryJob, *, now: datetime | None = None, country: str | None = None
) -> bool:
    """Is the last check old enough to run again: the freshness calendar for a passed one, the
    cooldown for an unreachable document, a week for a mismatch a person is reading."""
    result = job.result or {}
    outcome = str(result.get("outcome") or "")
    age = _age_s(job)
    if outcome == "unreachable" or outcome == "nothing_stored":
        return age > DISCOVERY_COOLDOWN_S
    if outcome in ("mismatch", "refused"):
        return age > RETRY_MISMATCH_AFTER_S
    last = freshness._parse_time(job.updated_at or job.created_at)
    return freshness.due(last_checked=last, now=now or datetime.now(UTC), country=country)


def decide(
    store: CurriculumStore,
    framework: Framework,
    version: Version,
    level: Node,
    subject: Node,
    *,
    now: datetime | None = None,
) -> Decision:
    """Read the job row for this subject and say what to show, without running anything."""
    job = store.latest_job(
        framework_id=framework.id, query=framework.name, level=level.name, subject=subject.name
    )
    if job is None:
        return Decision("run", CHECKING_LINE)
    if job.open:
        if job.state is JobState.QUEUED or _age_s(job) > STALE_AFTER_S:
            # Queued by nobody, or claimed by a process that is gone: this selection runs it.
            return Decision("run", CHECKING_LINE, job)
        return Decision("checking", job.message or CHECKING_LINE, job)
    if not _is_recheck(job):
        # The discovery that stored this syllabus. Its own verify pass ran on the document it
        # read, so it counts as checked on that day, and comes round again on the calendar.
        if job.state is JobState.STORED and not due_again(job, now=now, country=framework.country):
            return Decision("provisional", PROVISIONAL, job)
        return Decision("run", CHECKING_LINE, job)
    about = str((job.result or {}).get("version_id") or "")
    if about and about != version.id:
        if (job.result or {}).get("new_version_id") == version.id:
            # This version was minted by that check, and discovery's own verify pass read it on
            # the day. Checked, then, and it comes round again on the calendar like any other.
            if due_again(job, now=now, country=framework.country):
                return Decision("run", CHECKING_LINE, job)
            return Decision("provisional", PROVISIONAL, job)
        return Decision("run", CHECKING_LINE, job)
    if due_again(job, now=now, country=framework.country):
        return Decision("run", CHECKING_LINE, job)
    return _line_for(job, framework, version)


# --- running one, and recording it ----------------------------------------------------------------
class NotAffordable(Exception):
    """The day's allowance for housekeeping is spent, or the platform is shedding load."""


def afford() -> None:
    """Charge one generation to the system subject, or raise :class:`NotAffordable`.

    The spend ceiling is consulted in the stranger lane, which is where the cron jobs live
    (``docs/OPERATIONS.md`` §2): a re-check is never allowed to spend a paying learner's headroom.
    """
    from wobo_gateway import budget, spend

    if spend.verdict(spend.Priority.STRANGER) is spend.Verdict.REFUSE:
        raise NotAffordable("spend ceiling")
    try:
        budget.charge(SYSTEM_SUBJECT, CAPABILITY)
    except budget.BudgetExhausted as exc:
        raise NotAffordable("daily allowance") from exc


def claim(
    store: CurriculumStore, framework: Framework, version: Version, level: Node, subject: Node
) -> DiscoveryJob | None:
    """The job row this check will write to, moved to ``checking`` atomically, or None when
    another process has it. A stale claim is taken over: the process that held it is gone."""
    seed_result = {"kind": KIND, "version_id": version.id, "subject_node_id": subject.id}
    job = store.enqueue_discovery(
        query=framework.name, framework_id=framework.id, level=level.name, subject=subject.name
    )
    if job.state is JobState.QUEUED:
        return store.claim_job(
            job.id, state=JobState.CHECKING, message=CHECKING_LINE, result=seed_result
        )
    if job.open:
        if _age_s(job) <= STALE_AFTER_S:
            return None
        return store.update_job(
            job.id, state=JobState.CHECKING, message=CHECKING_LINE, result=seed_result
        )
    # A finished job inside the discovery cooldown: reopen it for this run rather than mint a
    # second row for the same key while the first still answers.
    return store.update_job(
        job.id, state=JobState.CHECKING, message=CHECKING_LINE, result=seed_result
    )


def record(
    store: CurriculumStore, job: DiscoveryJob, outcome: Outcome, version: Version, subject: Node
) -> None:
    state = JobState.STORED if outcome.outcome in ("verified", "new_version") else JobState.FAILED
    store.update_job(
        job.id, state=state, message=outcome.line, result=outcome.as_result(version, subject)
    )


def run(
    store: CurriculumStore,
    framework: Framework,
    version: Version,
    level: Node,
    subject: Node,
    *,
    job: DiscoveryJob,
    **kwargs: Any,
) -> Outcome:
    """Check one subject and write the verdict on its job row. Every exception becomes an
    honest ``unreachable`` rather than a job left at ``checking`` for ever."""
    try:
        outcome = check_subject(store, framework, version, subject, **kwargs)
    except Exception as exc:  # noqa: BLE001, the row must not be left open
        logger.warning(
            "recheck failed", extra={"fields": {"subject": subject.id, "error": type(exc).__name__}}
        )
        outcome = Outcome("unreachable", UNREACHABLE_LINE, problems=(type(exc).__name__,))
    try:
        record(store, job, outcome, version, subject)
    except StoreUnavailable:
        logger.warning("recheck: verdict not written", extra={"fields": {"job": job.id}})
    logger.info(
        "recheck.done",
        extra={
            "fields": {
                "framework": framework.id,
                "level": level.name,
                "subject": subject.name,
                "outcome": outcome.outcome,
                "checks_passed": list(outcome.checks_passed),
            }
        },
    )
    return outcome


# --- first selection (§2) -------------------------------------------------------------------------
Runner = Callable[[Callable[[], None]], None]


def _in_background(fn: Callable[[], None]) -> None:
    threading.Thread(target=fn, daemon=True, name="wobo-recheck").start()


_runner: Runner = _in_background
_check_kwargs: dict[str, Any] = {}


def set_runner(runner: Runner | None, **check_kwargs: Any) -> None:
    """Test seam: run the check inline, with injected fetch and completions."""
    global _runner, _check_kwargs
    _runner = runner or _in_background
    _check_kwargs = dict(check_kwargs)


def on_selection(
    store: CurriculumStore, framework: Framework, version: Version, level: Node, subject: Node
) -> Decision:
    """What ``curriculum.units`` does before showing a provisional subject's chapters.

    Reads the record; when there is none, pays for one check, claims the row and starts the
    check off the request thread, answering ``checking`` with the honest line. A check that
    cannot be afforded answers ``provisional`` with the reason in the line, and costs nothing.
    """
    decision = decide(store, framework, version, level, subject)
    if decision.state != "run":
        return decision
    try:
        afford()
    except NotAffordable:
        return Decision("provisional", SPENT_LINE, decision.job)
    job = claim(store, framework, version, level, subject)
    if job is None:
        return Decision("checking", CHECKING_LINE, decision.job)
    kwargs = dict(_check_kwargs)

    def go() -> None:
        run(store, framework, version, level, subject, job=job, **kwargs)

    _runner(go)
    return Decision("checking", CHECKING_LINE, job)


__all__ = [
    "CAPABILITY",
    "CHECKING_LINE",
    "KIND",
    "SYSTEM_SUBJECT",
    "Decision",
    "NotAffordable",
    "Outcome",
    "afford",
    "check_subject",
    "claim",
    "decide",
    "due_again",
    "enabled",
    "on_selection",
    "record",
    "run",
    "set_runner",
]
