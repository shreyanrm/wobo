"""The discovery worker: the thing that finally drains ``curriculum.discovery_jobs``.

Until it existed a job sat at ``queued`` for ever (``api.discovery_worker_running`` says so in its
own words), so the door refused every discovery in the same breath it recorded one. This is the
in-process loop behind ``WOBO_DISCOVERY_WORKER=1``, on the gateway's own thread, on a cadence.
Each tick, in order:

1. **Stale claims.** A job past ``queued`` and silent for longer than a run may take belonged to a
   process that died. It is re-queued, up to :data:`MAX_ATTEMPTS`, then failed with the honest
   line.
2. **Queued jobs**, oldest first, up to :data:`MAX_JOBS_PER_TICK`. Each is CLAIMED with one
   conditional write (``state = 'queued'`` -> ``searching``), so two replicas cannot both run one;
   then :func:`job.run_discovery` runs it, its stages mirrored onto the row as it goes so
   ``curriculum.status`` tells the learner what is genuinely happening; then the result is written
   through :mod:`persist` and the row ends at ``stored`` or ``refused``.
3. **One re-check** (:mod:`recheck`): the freshness cadence, one stored subject per tick, oldest
   check first. A published seed participates from the first tick: a board that changes its
   document next year becomes a new version with ``supersedes`` and a diff.
4. **The observer's pass** (:func:`observer.run_pass`), which already refuses to run without this
   worker's switch.

**Budget.** Per job: :class:`DiscoveryBudget` (queries, bytes, documents, a wall clock). Per day:
every job and every re-check is charged as a generation to the system subject, whose allowance is
the free plan's, and nothing runs while the platform's spend ceiling is shedding load in the
stranger lane (``docs/OPERATIONS.md`` §2). When the day is spent, queued jobs are left queued with
a line that says so, and the worker looks again tomorrow.

Nothing here is enabled by setting the store or by importing this module. :func:`start_if_enabled`
is called once from ``create_app`` and starts nothing unless the switch is on.
"""

from __future__ import annotations

import contextlib
import logging
import os
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from wobo_gateway.curriculum import labels
from wobo_gateway.curriculum import recheck as recheck_mod
from wobo_gateway.curriculum import versions as version_rules
from wobo_gateway.curriculum.discovery.extract import Completion, SyllabusRequest
from wobo_gateway.curriculum.discovery.fetch import Document, fetch_document
from wobo_gateway.curriculum.discovery.job import (
    DiscoveryBudget,
    InMemoryJobStore,
    JobRecord,
    JobStore,
    run_discovery,
)
from wobo_gateway.curriculum.discovery.job import (
    JobState as RunState,
)
from wobo_gateway.curriculum.discovery.persist import persist_discovery, subject_nodes
from wobo_gateway.curriculum.discovery.search import SearchProvider
from wobo_gateway.curriculum.models import DiscoveryJob, Framework, JobState, Node, Version
from wobo_gateway.curriculum.store import CurriculumStore, StoreUnavailable, get_store

logger = logging.getLogger("wobo.gateway.curriculum.discovery.worker")

ENV = "WOBO_DISCOVERY_WORKER"
INTERVAL_ENV = "WOBO_DISCOVERY_INTERVAL_S"
DEFAULT_INTERVAL_S = 30.0
MAX_JOBS_PER_TICK = 3
RECHECKS_PER_TICK = 1
MAX_ATTEMPTS = 3
#: What one discovery is metered as. Same class as the door charges the learner who asked.
CAPABILITY = "curriculum.discovery"
#: The system's meter subject for discoveries. Never a learner's day.
SYSTEM_SUBJECT = "system:curriculum-discovery"
SPENT_LINE = "I have done as much looking as I can manage today. I will look again tomorrow."

#: ``run_discovery``'s stages onto the row's vocabulary (0008's check constraint has no
#: ``fetching``). ``provisional`` is deliberately absent: the row says ``stored`` only once the
#: chapters are in the registry, because until then nothing is ready.
_MIRROR: dict[RunState, JobState] = {
    RunState.SEARCHING: JobState.SEARCHING,
    RunState.FETCHING: JobState.EXTRACTING,
    RunState.EXTRACTING: JobState.EXTRACTING,
    RunState.CHECKING: JobState.CHECKING,
    RunState.REFUSED: JobState.REFUSED,
}

_SMALL_WORDS = frozenset({"and", "of", "the", "in", "for", "to", "a", "an"})


def enabled() -> bool:
    return (os.getenv(ENV) or "").strip().lower() in ("1", "true", "yes", "on")


def interval_s() -> float:
    try:
        return max(5.0, float(os.getenv(INTERVAL_ENV) or DEFAULT_INTERVAL_S))
    except ValueError:
        return DEFAULT_INTERVAL_S


class _Mirror:
    """A :class:`JobStore` that also writes every stage onto the registry's job row, so the line
    a learner polls is the stage the run is genuinely at."""

    def __init__(self, inner: JobStore, store: CurriculumStore, job_id: str) -> None:
        self.inner = inner
        self.store = store
        self.job_id = job_id
        self.last: JobState | None = None

    def get(self, key: str) -> JobRecord | None:
        return self.inner.get(key)

    def claim(self, key: str, request: SyllabusRequest) -> tuple[JobRecord, bool]:
        return self.inner.claim(key, request)

    def save(self, record: JobRecord) -> None:
        self.inner.save(record)
        mapped = _MIRROR.get(record.state)
        if mapped is None or mapped is self.last:
            return
        self.last = mapped
        try:
            self.store.update_job(
                self.job_id,
                state=mapped,
                message=record.message
                if mapped is JobState.REFUSED
                else labels.job_message(mapped),
            )
        except StoreUnavailable:
            logger.warning("worker: stage not mirrored", extra={"fields": {"job": self.job_id}})


def _display(name: str | None, *, known: tuple[str, ...] = ()) -> str:
    """The stored key ("class 9", "social science") back to a display name.

    The row stores the normalised key, never the learner's keystrokes. The framework's own level
    names win when one matches; otherwise words are capitalised, which is right for every subject
    name a board publishes and wrong for nothing a learner would notice.
    """
    key = version_rules.normalise(name or "")
    for candidate in known:
        if version_rules.normalise(candidate) == key:
            return candidate
    words = key.split()
    return " ".join(
        word if (index and word in _SMALL_WORDS) else word.capitalize()
        for index, word in enumerate(words)
    )


@dataclass
class TickReport:
    claimed: int = 0
    stored: int = 0
    refused: int = 0
    failed: int = 0
    requeued: int = 0
    left_queued: int = 0
    spent: bool = False
    rechecks: list[dict[str, Any]] = field(default_factory=list)
    observer_actions: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "claimed": self.claimed,
            "stored": self.stored,
            "refused": self.refused,
            "failed": self.failed,
            "requeued": self.requeued,
            "left_queued": self.left_queued,
            "spent": self.spent,
            "rechecks": list(self.rechecks),
            "observer_actions": self.observer_actions,
        }


class DiscoveryWorker:
    """One worker over one registry. Every model and network seam is injectable, so the suite
    runs a whole tick against fixture bytes and scripted replies."""

    def __init__(
        self,
        store: CurriculumStore,
        *,
        job_store: JobStore | None = None,
        search_provider: SearchProvider | None = None,
        fetch_fn: Callable[..., Document] = fetch_document,
        complete_generate: Completion | None = None,
        complete_verify: Completion | None = None,
        budget: DiscoveryBudget | None = None,
        max_jobs: int = MAX_JOBS_PER_TICK,
        rechecks: int = RECHECKS_PER_TICK,
        second_reader: bool = True,
        observer_pass: bool = True,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.store = store
        self.job_store = job_store or InMemoryJobStore()
        self.search_provider = search_provider
        self.fetch_fn = fetch_fn
        self.complete_generate = complete_generate
        self.complete_verify = complete_verify
        self.budget = budget or DiscoveryBudget()
        self.max_jobs = max(0, max_jobs)
        self.rechecks = max(0, rechecks)
        self.second_reader = second_reader
        self.observer_pass = observer_pass
        self._now = now or (lambda: datetime.now(UTC))

    # -- money
    def afford(self) -> bool:
        """One generation from the system subject's day, or False when the day is spent."""
        from wobo_gateway import budget, spend

        if spend.verdict(spend.Priority.STRANGER) is spend.Verdict.REFUSE:
            return False
        try:
            budget.charge(SYSTEM_SUBJECT, CAPABILITY)
        except budget.BudgetExhausted:
            return False
        return True

    @staticmethod
    def _refund() -> None:
        from wobo_gateway import budget

        budget.refund(SYSTEM_SUBJECT, CAPABILITY)

    # -- one job
    def request_for(self, job: DiscoveryJob, framework: Framework) -> SyllabusRequest:
        latest = self.store.latest_version(framework.id)
        return SyllabusRequest(
            framework_id=framework.id,
            framework_name=framework.name,
            level=_display(job.level, known=framework.levels),
            subject=_display(job.subject),
            # A hint for the extractor, not a claim: the document's own year wins.
            version=latest.label if latest is not None else None,
            framework_kind=framework.kind.value,
            country=framework.country,
            official_site=framework.official_site,
            aliases=framework.aliases,
        )

    def run_job(self, job: DiscoveryJob) -> str:
        """Claim, run, persist. Returns ``stored``, ``refused``, ``failed`` or ``skipped``."""
        framework = self.store.get_framework(job.framework_id) if job.framework_id else None
        if framework is None:
            # A typed board we do not hold at all is the own-syllabus path's job, not a search.
            self.store.update_job(
                job.id, state=JobState.REFUSED, message=labels.job_message(JobState.REFUSED)
            )
            return "refused"
        if job.attempts >= MAX_ATTEMPTS:
            self.store.update_job(
                job.id, state=JobState.FAILED, message=labels.job_message(JobState.FAILED)
            )
            return "failed"
        if not self.afford():
            return "spent"
        claimed = self.store.claim_job(
            job.id, state=JobState.SEARCHING, message=labels.job_message(JobState.SEARCHING)
        )
        if claimed is None:
            self._refund()
            return "skipped"
        request = self.request_for(job, framework)
        mirror = _Mirror(self.job_store, self.store, job.id)
        try:
            record = run_discovery(
                request,
                store=mirror,
                meter_subject=None,
                search_provider=self.search_provider,
                fetch_fn=self.fetch_fn,
                complete_generate=self.complete_generate,
                complete_verify=self.complete_verify,
                budget=self.budget,
                second_reader=self.second_reader,
                force=True,
            )
            if record.status != "provisional" or record.syllabus is None:
                self.store.update_job(
                    job.id,
                    state=JobState.REFUSED,
                    message=record.message or labels.job_message(JobState.REFUSED),
                    result={"reason": record.reason},
                )
                return "refused"
            written = persist_discovery(self.store, framework, record)
            self.store.update_job(
                job.id,
                state=JobState.STORED,
                message=labels.job_message(JobState.STORED),
                result={
                    "kind": "discovery",
                    **written.as_dict(),
                    "checks_passed": list((record.provenance or {}).get("checks_passed") or []),
                    "source_url": (record.provenance or {}).get("source_url"),
                    "document_hash": (record.provenance or {}).get("document_hash"),
                },
            )
            return "stored"
        except Exception as exc:  # noqa: BLE001, a job must never be left open by a crash
            logger.warning(
                "worker: job failed",
                extra={"fields": {"job": job.id, "error": type(exc).__name__}},
                exc_info=True,
            )
            with contextlib.suppress(StoreUnavailable):
                self.store.update_job(
                    job.id, state=JobState.FAILED, message=labels.job_message(JobState.FAILED)
                )
            return "failed"

    # -- the tick
    def requeue_stale(self, report: TickReport) -> None:
        for job in self.store.stale_open_jobs(older_than_s=recheck_mod.STALE_AFTER_S):
            if job.result and job.result.get("kind") == recheck_mod.KIND:
                # A re-check that died: its verdict is "could not reach", and the next selection
                # or the next tick runs it again.
                self.store.update_job(
                    job.id, state=JobState.FAILED, message=recheck_mod.UNREACHABLE_LINE
                )
                continue
            if job.attempts >= MAX_ATTEMPTS:
                self.store.update_job(
                    job.id, state=JobState.FAILED, message=labels.job_message(JobState.FAILED)
                )
                report.failed += 1
            else:
                self.store.update_job(
                    job.id, state=JobState.QUEUED, message=labels.job_message(JobState.QUEUED)
                )
                report.requeued += 1

    def drain(self, report: TickReport) -> None:
        if not self.max_jobs:
            return
        for job in self.store.queued_jobs(limit=self.max_jobs):
            outcome = self.run_job(job)
            if outcome == "spent":
                report.spent = True
                break
            if outcome == "skipped":
                continue
            report.claimed += 1
            setattr(report, outcome, getattr(report, outcome) + 1)
        if report.spent:
            for job in self.store.queued_jobs(limit=50):
                self.store.update_job(job.id, state=JobState.QUEUED, message=SPENT_LINE)
                report.left_queued += 1

    def due_rechecks(self) -> list[tuple[Framework, Version, Node, Node]]:
        """Every stored subject whose last check is due, never-checked first, then oldest."""
        due: list[tuple[str, Framework, Version, Node, Node]] = []
        frameworks: dict[str, Framework | None] = {}
        for version in self.store.all_versions():
            if version.framework_id not in frameworks:
                frameworks[version.framework_id] = self.store.get_framework(version.framework_id)
            framework = frameworks[version.framework_id]
            if framework is None or framework.personal:
                continue
            for level, subject in subject_nodes(self.store, version):
                decision = recheck_mod.decide(
                    self.store, framework, version, level, subject, now=self._now()
                )
                if decision.state != "run":
                    continue
                stamp = (
                    (decision.job.updated_at or decision.job.created_at or "")
                    if decision.job
                    else ""
                )
                due.append((stamp, framework, version, level, subject))
        due.sort(key=lambda item: item[0])
        return [(f, v, level, subject) for _, f, v, level, subject in due]

    def recheck_tick(self, report: TickReport) -> None:
        if not self.rechecks or report.spent:
            return
        done = 0
        for framework, version, level, subject in self.due_rechecks():
            if done >= self.rechecks:
                break
            if not self.afford():
                report.spent = True
                return
            job = recheck_mod.claim(self.store, framework, version, level, subject)
            if job is None:
                self._refund()
                continue
            outcome = recheck_mod.run(
                self.store,
                framework,
                version,
                level,
                subject,
                job=job,
                job_store=self.job_store,
                fetch_fn=self.fetch_fn,
                complete_generate=self.complete_generate,
                complete_verify=self.complete_verify,
                budget=self.budget,
                second_reader=self.second_reader,
            )
            done += 1
            report.rechecks.append(
                {
                    "framework": framework.id,
                    "level": level.name,
                    "subject": subject.name,
                    "outcome": outcome.outcome,
                    "new_version_id": outcome.new_version_id,
                    "summary": list(outcome.summary),
                }
            )

    def observer_tick(self, report: TickReport) -> None:
        if not self.observer_pass or report.spent:
            return
        from wobo_gateway.curriculum import observer as syllabus_observer

        try:
            outcomes = syllabus_observer.run_pass(
                curriculum_store=self.store,
                observer=syllabus_observer.get_observer(),
                job_store=self.job_store,
                fetch_fn=self.fetch_fn,
                complete_generate=self.complete_generate,
                complete_verify=self.complete_verify,
                budget=self.budget,
                second_reader=self.second_reader,
            )
        except Exception as exc:  # noqa: BLE001, the observer must not take the worker down
            logger.warning(
                "worker: observer pass failed", extra={"fields": {"error": type(exc).__name__}}
            )
            return
        report.observer_actions = len(outcomes)

    def tick(self) -> TickReport:
        report = TickReport()
        try:
            self.requeue_stale(report)
            self.drain(report)
            self.recheck_tick(report)
            self.observer_tick(report)
        except StoreUnavailable as exc:
            logger.warning("worker: registry unavailable", extra={"fields": {"error": str(exc)}})
        logger.info("discovery.worker.tick", extra={"fields": report.as_dict()})
        return report

    def run_forever(self, stop: threading.Event, *, interval: float | None = None) -> None:
        wait = interval if interval is not None else interval_s()
        while not stop.is_set():
            try:
                self.tick()
            except Exception as exc:  # noqa: BLE001, a loop that dies drains nothing ever again
                logger.warning(
                    "worker: tick raised", extra={"fields": {"error": type(exc).__name__}}
                )
            stop.wait(wait)


# --- the process's one worker ---------------------------------------------------------------------
_lock = threading.Lock()
_thread: threading.Thread | None = None
_stop = threading.Event()


def start_if_enabled(store: CurriculumStore | None = None) -> bool:
    """Start the loop on a daemon thread when ``WOBO_DISCOVERY_WORKER`` is on. Idempotent."""
    global _thread
    if not enabled():
        return False
    with _lock:
        if _thread is not None and _thread.is_alive():
            return True
        _stop.clear()
        worker = DiscoveryWorker(store or get_store())
        _thread = threading.Thread(
            target=worker.run_forever, args=(_stop,), daemon=True, name="wobo-discovery-worker"
        )
        _thread.start()
    logger.info("discovery.worker.started", extra={"fields": {"interval_s": interval_s()}})
    return True


def stop() -> None:
    _stop.set()


__all__ = [
    "CAPABILITY",
    "ENV",
    "MAX_ATTEMPTS",
    "SYSTEM_SUBJECT",
    "DiscoveryWorker",
    "TickReport",
    "enabled",
    "start_if_enabled",
    "stop",
]
