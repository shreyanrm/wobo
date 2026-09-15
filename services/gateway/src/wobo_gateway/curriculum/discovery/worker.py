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
5. **The prewarm** (:mod:`prewarm`): the boards with the most students, read AHEAD of demand, so
   that a learner from Maharashtra rarely turns out to be the first one (``docs/BOARD-COLD-START``
   §4). It only ever ENQUEUES: the drain above is oldest-first over ``queued``, so a prewarmed
   board is picked up on a later tick and never ahead of a learner who is waiting right now.

**The hard stop.** ``discovery.running`` (:mod:`ceiling`) is asked at the top of every tick and
again for each board before its row is claimed, so ``false`` stops every pass of this loop within
one interval, with no deploy — which is what ``docs/OPERATIONS.md`` §9.2.1 tells an operator to
reach for first. What is queued stays queued and only stops claiming that someone is looking at
it. The same question carries the two money ceilings and the board resting behind three closed
doors, and it is asked before a generation is charged, so a board that may not be read costs
nothing at all.

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

from wobo_gateway import ledger
from wobo_gateway.curriculum import labels
from wobo_gateway.curriculum import recheck as recheck_mod
from wobo_gateway.curriculum import versions as version_rules
from wobo_gateway.curriculum.discovery import ceiling, prewarm
from wobo_gateway.curriculum.discovery.extract import Completion, SyllabusRequest
from wobo_gateway.curriculum.discovery.fetch import Document, fetch_document
from wobo_gateway.curriculum.discovery.job import (
    DiscoveryBudget,
    InMemoryJobStore,
    JobRecord,
    JobStore,
    refusal_line,
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
#: What a queued row says while ``discovery.running`` is false. The stored line for a queued job
#: is "Looking for the official syllabus now", which with the stop on is a promise about a search
#: nobody is running — the one thing §4.6 forbids a row to say.
STOPPED_LINE = "I am not looking for syllabuses just now. Your place in the queue is kept."

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
    #: ``discovery.running`` was false: nothing ran at all this tick, and nothing was lost.
    stopped: bool = False
    rechecks: list[dict[str, Any]] = field(default_factory=list)
    observer_actions: int = 0
    #: Boards put in the queue ahead of demand this tick. They are RUN on a later tick.
    prewarmed: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "claimed": self.claimed,
            "stored": self.stored,
            "refused": self.refused,
            "failed": self.failed,
            "requeued": self.requeued,
            "left_queued": self.left_queued,
            "spent": self.spent,
            "stopped": self.stopped,
            "rechecks": list(self.rechecks),
            "observer_actions": self.observer_actions,
            "prewarmed": self.prewarmed,
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
        prewarm_pass: bool = True,
        prewarm_per_tick: int | None = None,
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
        self.prewarm_pass = prewarm_pass
        self.prewarm_per_tick = prewarm_per_tick
        self._now = now or (lambda: datetime.now(UTC))

    # -- money
    def has_money(self) -> bool:
        """Is there anything left in the day, WITHOUT spending it?

        Read-only, and separate from :meth:`afford` for one reason: reading a board ahead of demand
        costs nothing at the moment it is queued and everything at the moment it is drained, so the
        prewarm must be able to ask the question without taking the answer.
        """
        from wobo_gateway import budget, spend

        if spend.verdict(spend.Priority.STRANGER) is spend.Verdict.REFUSE:
            return False
        snap = budget.snapshot(SYSTEM_SUBJECT)
        remaining = getattr(snap, budget.classify(CAPABILITY) + "s_remaining", None)
        return True if remaining is None else remaining > 0

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

    #: What the ceiling's verdicts mean to a JOB ROW. A fact about the BOARD ends the row, and it
    #: goes to the console with its reason on it (docs/BOARD-COLD-START.md §5): a board resting
    #: behind three closed doors, or a board that has spent its own day. A fact about US leaves the
    #: row exactly where it stands — the switch will be flipped back and the day will turn over,
    #: and a row refused for either would have lost a learner their place in the queue for a reason
    #: that was never about their board.
    _HELD_BACK: dict[str, str] = {"discovery_stopped": "stopped", "day_budget_spent": "spent"}

    def held_back(self, job: DiscoveryJob, framework: Framework, stop: str) -> str:
        """What to do with a row the ceiling will not let us read. Costs nothing either way."""
        outcome = self._HELD_BACK.get(stop)
        if outcome is not None:
            return outcome
        # The same conditional write the run itself claims with, so two replicas reading a stale
        # queue cannot both end one row. ``cost_usd`` is 0.0 rather than ``None`` and the
        # difference is load-bearing on the desk: None means nothing on the run could be priced,
        # and this run never started, so nothing about the board is unknown — it was free.
        ended = self.store.claim_job(
            job.id,
            state=JobState.REFUSED,
            # The reason's OWN sentence, not the generic refusal: a board we chose not to open
            # today did not fail to be found, and a row that said so would be the console reading
            # a sentence about the board when the fact is about us.
            message=refusal_line(stop, self.request_for(job, framework)),
            result={"reason": stop, "cost_usd": 0.0},
        )
        return "refused" if ended is not None else "skipped"

    def run_job(self, job: DiscoveryJob) -> str:
        """Claim, run, persist.

        Returns ``stored``, ``refused``, ``failed``, ``skipped``, ``spent`` or ``stopped``.
        """
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
        # The hard stop and the two money ceilings, asked BEFORE a generation is charged and
        # before the row is claimed, so a board that may not be read costs nothing at all
        # (``ceiling.verdict``). ``run_discovery`` asks the same question — but this runner hands
        # it ``force=True``, which it needs so that a person's retry from the console reopens a
        # remembered refusal, and until 2026-09-15 ``force`` skipped the ceiling with it. The
        # switch, the resting board and the day were guards over every path except this one, which
        # is the only one that runs in production.
        stop = ceiling.verdict(framework.id)
        if stop is not None:
            return self.held_back(job, framework, stop)
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
        # Drain whatever the last run left on this thread's note before the money starts, so one
        # board's reading can never be billed to the next board's row (``ledger.take_spend``).
        ledger.take_spend()
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
                # Reopen a record this process already holds — a refusal a person retried from
                # the console is the reason this is here. It lifts nothing else: the ceiling was
                # asked above, and ``run_discovery`` asks it again on its own account.
                force=True,
            )
            if record.status != "provisional" or record.syllabus is None:
                self.store.update_job(
                    job.id,
                    state=JobState.REFUSED,
                    message=record.message or labels.job_message(JobState.REFUSED),
                    # What a refusal COST is the number §5's per-board budget is unanswerable
                    # without: a board that refuses after three searches and a 200-page fetch is
                    # not free, and a console that showed nothing beside it would imply it was.
                    # And what HAPPENED, which used to stop at the in-memory record: the reason
                    # is a category ("not the syllabus"), the detail is the sentence that says
                    # what we actually saw, and the trail is every candidate the run opened.
                    # §5 sends a refusal "to the console instead"; a row carrying only the
                    # category is a row nobody can act on, and on Uttar Pradesh the category was
                    # the opposite of the fact.
                    result={
                        "reason": record.reason,
                        "cost_usd": ledger.take_spend(),
                        "detail": record.detail or None,
                        "tried": list(record.tried),
                    },
                )
                return "refused"
            written = persist_discovery(self.store, framework, record)
            self.store.update_job(
                job.id,
                state=JobState.STORED,
                message=labels.job_message(JobState.STORED),
                result={
                    "kind": "discovery",
                    # None, never 0.0, when nothing on the run could be priced: a model with no
                    # price table must not read as a board that was free to read.
                    "cost_usd": ledger.take_spend(),
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
            if outcome == "stopped":  # the dial went to false between the tick and this job
                report.stopped = True
                break
            if outcome == "spent":
                report.spent = True
                break
            if outcome == "skipped":
                continue
            report.claimed += 1
            setattr(report, outcome, getattr(report, outcome) + 1)
        if report.spent:
            self.leave_queued(report, SPENT_LINE)
        elif report.stopped:
            self.leave_queued(report, STOPPED_LINE)

    def leave_queued(self, report: TickReport, line: str) -> None:
        """Put the honest line on what is still queued, and leave it queued.

        A row that is already carrying the line is left untouched rather than rewritten: a stop
        that lasts a week is one write per row, not one write per row every thirty seconds.
        """
        for job in self.store.queued_jobs(limit=50):
            if job.message == line:
                continue
            self.store.update_job(job.id, state=JobState.QUEUED, message=line)
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

    def prewarm_tick(self, report: TickReport) -> None:
        """Put the next boards in the queue, ahead of anyone asking for them.

        LAST in the tick and ENQUEUE ONLY, which together are the whole guarantee: the drain has
        already run, so nothing queued here can take a slot from a learner who was waiting when
        this tick began, and the drain is oldest-first, so nothing queued here can overtake a
        learner who arrives before the next one.
        """
        if not self.prewarm_pass or report.spent or not self.has_money():
            return
        try:
            plan = prewarm.plan(
                self.store,
                limit=(
                    self.prewarm_per_tick
                    if self.prewarm_per_tick is not None
                    else prewarm.per_tick()
                ),
            )
            report.prewarmed = len(prewarm.enqueue(self.store, plan))
        except StoreUnavailable:
            logger.warning("worker: prewarm could not reach the registry")
        except Exception as exc:  # noqa: BLE001, reading ahead must not take the worker down
            logger.warning(
                "worker: prewarm pass failed", extra={"fields": {"error": type(exc).__name__}}
            )

    def tick(self) -> TickReport:
        report = TickReport()
        try:
            if ceiling.running():
                self.requeue_stale(report)
                self.drain(report)
                self.recheck_tick(report)
                self.observer_tick(report)
                self.prewarm_tick(report)
            else:
                # The hard stop (``docs/OPERATIONS.md`` §9.2.1, "how to stop it", step 1):
                # everything stops, within one interval, with no deploy and no restart. Every
                # pass, not only the drain — a re-check and the observer's reconciliation are
                # both discoveries that cost money, and the prewarm queues boards for a drain
                # that is not running. Nothing queued is lost.
                report.stopped = True
                self.leave_queued(report, STOPPED_LINE)
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
    "SPENT_LINE",
    "STOPPED_LINE",
    "SYSTEM_SUBJECT",
    "DiscoveryWorker",
    "TickReport",
    "enabled",
    "start_if_enabled",
    "stop",
]
