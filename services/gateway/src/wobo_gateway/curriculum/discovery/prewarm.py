"""The prewarm queue: read the biggest boards before anybody asks for them.

``docs/BOARD-COLD-START.md`` §4, in the owner's own frame: *"Waiting for a first learner is the
fallback, not the plan. The discovery worker runs ahead of demand against the boards with the most
students, so that by the time anyone picks Maharashtra or Uttar Pradesh it is already there. The
order is by student population, not alphabetical, and the console shows the queue, what has landed,
what refused and why."*

**What this module is.** A plan, not a loop. It answers one question — *which (board, class,
subject) should the discovery worker read next, if it has money and nobody is waiting?* — and the
worker's existing tick does the rest. Everything here is a read against the registry and one dial;
nothing here calls a model, opens a socket, or claims a job.

**The order.** :data:`SEED_ORDER` is India's school population by state, biggest first, mapped onto
the framework ids the registry already names. The numbers are **approximate total school enrolment
per state**, of the order UDISE+ publishes, and they are here to SET A RANK and nothing else: no
screen shows them to a learner, no claim is made from them, and a state's enrolment is a proxy for
its board's roll rather than a count of it (CBSE and ICSE schools sit inside every state). If a
number is out by a million the rank barely moves, and the rank is the whole product of this list.
The owner may reorder it from the console at any time, and then the dial wins outright — this list
is a starting point, not a policy (§4 asks for exactly that: "a console-editable list").

**Why breadth first.** The plan walks RUNGS, not boards: every board's first subject before any
board's second. Uttar Pradesh class 10 mathematics, then Bihar's, then Maharashtra's, and only
after the whole order has one subject does the second subject begin. A depth-first plan would
spend a week finishing Uttar Pradesh while a learner in Bihar still found nothing.

**What it will not do.**

* **It never delays a learner.** A prewarm job is ENQUEUED and never claimed here. The worker
  drains ``queued`` oldest-first, so a learner who asked a second ago is still drained before a
  board nobody has asked for.
* **One job per board at a time** (§5). A board with anything in flight is skipped whole.
* **A refusal is remembered** (§5). A board whose document could not be read is not re-fetched on
  the next tick; it waits :data:`REFUSAL_COOLDOWN_S` and goes to the console in the meantime.
* **Nothing personal.** A learner's own drafted framework is not a board, and prewarming one would
  be the product reading a child's uploaded syllabus on a cron.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from wobo_gateway.curriculum.discovery.persist import subject_nodes
from wobo_gateway.curriculum.models import DiscoveryJob, Framework, JobState, Status
from wobo_gateway.curriculum.store import (
    PREWARM_REQUESTER,
    CurriculumStore,
    StoreUnavailable,
)

logger = logging.getLogger("wobo.gateway.curriculum.discovery.prewarm")

#: The dials, beside every other console dial in ``ops.settings`` (migration 0024, the header of
#: which asks new keys to land there rather than in a table of their own).
ORDER_KEY = "curriculum.prewarm.order"
ENABLED_KEY = "curriculum.prewarm.enabled"
TARGETS_KEY = "curriculum.prewarm.targets"
PER_TICK_KEY = "curriculum.prewarm.per_tick"

#: What ``discovery_jobs.requested_by`` carries for a job nobody asked for. Not a learner id, and
#: deliberately not null: the console has to be able to tell the board we chose to read from the
#: board a child is waiting on, and a null would read as "we lost the learner" — an anonymous
#: learner's job carries a null already. Defined in :mod:`..store` because ``_queue_order`` is what
#: has to tell a marker from a person, and it puts this one at the BACK of the queue.
REQUESTED_BY = PREWARM_REQUESTER

#: How long a refused board is left alone. A day: long enough that a dead link does not cost a
#: search every thirty seconds, short enough that a board which fixes its website on Monday is
#: read on Tuesday. A person may retry one immediately from the console, which is the point of
#: the retry button — this cooldown governs only the automatic pass.
REFUSAL_COOLDOWN_S = 24 * 60 * 60.0

#: How many boards one tick puts in the queue when it has room. Small on purpose: each is a paid
#: read, the day's ceiling is shared with every learner, and a queue that outruns the drain is a
#: list of promises rather than a plan.
DEFAULT_PER_TICK = 2


@dataclass(frozen=True)
class SeedBoard:
    """One board in the starting order: its registry id and the roll that puts it there.

    ``learners`` is approximate total school enrolment in that state, to the nearest hundred
    thousand. It is never rendered as a fact about the board; :attr:`note` is what the console
    prints beside it so nobody reads it as one.
    """

    framework_id: str
    region: str
    learners: int

    @property
    def note(self) -> str:
        return f"about {self.learners / 1_000_000:.0f} million school students in {self.region}"


#: India's largest school populations, biggest first, and the board each state's schools sit in.
#: Where a state runs a separate council for classes 11 and 12 (Andhra, Telangana, Odisha, West
#: Bengal, Assam) the secondary board leads and the higher-secondary council follows it, because
#: a learner arrives at class 9 or 10 far more often than at 11.
SEED_ORDER: tuple[SeedBoard, ...] = (
    SeedBoard("upmsp", "Uttar Pradesh", 44_000_000),
    SeedBoard("bseb", "Bihar", 25_000_000),
    SeedBoard("msbshse", "Maharashtra", 22_000_000),
    SeedBoard("mpbse", "Madhya Pradesh", 15_000_000),
    SeedBoard("wbbse", "West Bengal", 15_000_000),
    SeedBoard("rbse", "Rajasthan", 14_000_000),
    SeedBoard("kseab", "Karnataka", 12_000_000),
    SeedBoard("tn-dge", "Tamil Nadu", 12_000_000),
    SeedBoard("gseb", "Gujarat", 11_000_000),
    SeedBoard("bse-odisha", "Odisha", 7_000_000),
    SeedBoard("jac", "Jharkhand", 7_000_000),
    SeedBoard("bseap", "Andhra Pradesh", 7_000_000),
    SeedBoard("seba", "Assam", 6_000_000),
    SeedBoard("cgbse", "Chhattisgarh", 6_000_000),
    SeedBoard("kerala-state-board", "Kerala", 6_000_000),
    SeedBoard("bse-telangana", "Telangana", 6_000_000),
    SeedBoard("pseb", "Punjab", 5_000_000),
    SeedBoard("bseh", "Haryana", 5_000_000),
    SeedBoard("delhi-directorate-of-education", "Delhi", 4_000_000),
    SeedBoard("wbchse", "West Bengal, classes 11 and 12", 3_000_000),
    SeedBoard("tgbie", "Telangana, classes 11 and 12", 3_000_000),
    SeedBoard("bieap", "Andhra Pradesh, classes 11 and 12", 3_000_000),
    SeedBoard("chse-odisha", "Odisha, classes 11 and 12", 2_000_000),
    SeedBoard("jkbose", "Jammu and Kashmir", 2_000_000),
    SeedBoard("ubse", "Uttarakhand", 2_000_000),
    SeedBoard("asseb", "Assam, classes 11 and 12", 2_000_000),
    SeedBoard("hpbose", "Himachal Pradesh", 1_000_000),
)

#: The rungs, in the order a board is read. Class 10 first because it is the board-exam class every
#: state publishes a syllabus for and the one a learner most often arrives on; then class 9, which
#: shares that document on most state boards; then 12 and 11. Mathematics and science lead each
#: class because they are what this product teaches best and what a learner asks for first.
SEED_TARGETS: tuple[tuple[str, str], ...] = (
    ("Class 10", "Mathematics"),
    ("Class 10", "Science"),
    ("Class 9", "Mathematics"),
    ("Class 9", "Science"),
    ("Class 10", "Social Science"),
    ("Class 9", "Social Science"),
    ("Class 12", "Mathematics"),
    ("Class 12", "Physics"),
    ("Class 12", "Chemistry"),
    ("Class 12", "Biology"),
    ("Class 11", "Mathematics"),
    ("Class 11", "Physics"),
    ("Class 11", "Chemistry"),
    ("Class 11", "Biology"),
)


class UnknownBoard(ValueError):
    """An edited order naming nothing this registry holds. Refused at the write, never stored."""


class Settings(Protocol):
    def read(self, key: str) -> Any | None: ...

    def write(self, key: str, value: Any, *, actor: str | None, note: str | None) -> None: ...


def _settings(settings: Settings | None) -> Settings:
    if settings is not None:
        return settings
    from wobo_gateway import doors

    return doors.get_store()


def _read(settings: Settings | None, key: str) -> Any | None:
    try:
        return _settings(settings).read(key)
    except Exception:  # noqa: BLE001, a dial that cannot be read is a dial nobody set
        logger.warning("prewarm: dial unreadable", extra={"fields": {"key": key}})
        return None


def enabled(*, settings: Settings | None = None) -> bool:
    """On unless somebody turned it off. The switch that actually gates everything is still
    ``WOBO_DISCOVERY_WORKER``; this one only says whether the worker reads ahead of demand."""
    value = _read(settings, ENABLED_KEY)
    if value is None:
        return True
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def per_tick(*, settings: Settings | None = None) -> int:
    value = _read(settings, PER_TICK_KEY)
    try:
        return max(0, min(10, int(value)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return DEFAULT_PER_TICK


def targets(*, settings: Settings | None = None) -> tuple[tuple[str, str], ...]:
    """The (class, subject) rungs, editable as ``["Class 10|Mathematics", ...]``."""
    value = _read(settings, TARGETS_KEY)
    if not isinstance(value, (list, tuple)) or not value:
        return SEED_TARGETS
    out: list[tuple[str, str]] = []
    for item in value:
        text = str(item)
        level, _, subject = text.partition("|")
        if level.strip() and subject.strip():
            out.append((level.strip(), subject.strip()))
    return tuple(out) or SEED_TARGETS


@dataclass(frozen=True)
class Order:
    """The queue as it stands: the board ids in order, where it came from, and what was dropped."""

    ids: tuple[str, ...]
    source: str
    rejected: tuple[str, ...] = ()
    boards: tuple[Framework, ...] = ()

    def board(self, framework_id: str) -> Framework | None:
        return next((f for f in self.boards if f.id == framework_id), None)


def _prewarmable(framework: Framework | None) -> bool:
    """A board we may read ahead of demand: public, and not somebody's own drafted syllabus."""
    return (
        framework is not None and not framework.personal and framework.status is not Status.PERSONAL
    )


def order(store: CurriculumStore, *, settings: Settings | None = None) -> Order:
    """The order the console has set, or the seeded one. Unknown ids are dropped, never guessed."""
    written = _read(settings, ORDER_KEY)
    wanted: list[str]
    source = "seed"
    if isinstance(written, (list, tuple)) and written:
        wanted = [str(item).strip() for item in written if str(item).strip()]
        source = "console"
    else:
        wanted = [entry.framework_id for entry in SEED_ORDER]

    kept: list[str] = []
    rejected: list[str] = []
    boards: list[Framework] = []
    for framework_id in wanted:
        if framework_id in kept or framework_id in rejected:
            continue
        try:
            framework = store.get_framework(framework_id)
        except StoreUnavailable:
            raise
        if not _prewarmable(framework):
            rejected.append(framework_id)
            continue
        kept.append(framework_id)
        boards.append(framework)  # type: ignore[arg-type]
    return Order(tuple(kept), source, tuple(rejected), tuple(boards))


def set_order(
    ids: Sequence[str],
    *,
    settings: Settings | None = None,
    actor: str | None,
    store: CurriculumStore,
    note: str | None = None,
) -> tuple[str, ...]:
    """Write the console's order. Every id is checked against the registry BEFORE anything is
    stored, so a typo cannot quietly empty the queue that reads India's boards."""
    wanted = [str(item).strip() for item in ids if str(item).strip()]
    unknown = [
        framework_id
        for framework_id in wanted
        if not _prewarmable(store.get_framework(framework_id))
    ]
    if unknown or not wanted:
        raise UnknownBoard(
            "not a board in the registry: " + ", ".join(unknown)
            if unknown
            else "an empty order would stop the queue; turn it off instead"
        )
    _settings(settings).write(
        ORDER_KEY, wanted, actor=actor, note=note or "the prewarm queue's order"
    )
    return tuple(wanted)


@dataclass(frozen=True)
class Target:
    """One (board, class, subject) the queue would read next, and why it is next."""

    framework_id: str
    framework_name: str
    level: str
    subject: str
    rank: int
    rung: int

    @property
    def query(self) -> str:
        return f"{self.framework_name} {self.level} {self.subject}"

    def as_dict(self) -> dict[str, Any]:
        return {
            "framework_id": self.framework_id,
            "framework_name": self.framework_name,
            "level": self.level,
            "subject": self.subject,
            "rank": self.rank,
            "rung": self.rung,
        }


def _age_s(stamp: str | None, *, now: datetime) -> float | None:
    if not stamp:
        return None
    try:
        moment = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return (now - moment).total_seconds()


def _held(store: CurriculumStore, framework_id: str) -> set[tuple[str, str]]:
    """Every (class, subject) this board already publishes, normalised for comparison."""
    from wobo_gateway.curriculum import versions as version_rules

    version = store.latest_version(framework_id)
    if version is None:
        return set()
    return {
        (version_rules.normalise(level.name), version_rules.normalise(subject.name))
        for level, subject in subject_nodes(store, version)
    }


def _busy(store: CurriculumStore, framework_id: str) -> bool:
    """Is anything in flight for this board? §5: one job per board, ever, at a time."""
    if any(job.framework_id == framework_id for job in store.queued_jobs(limit=200)):
        return True
    return any(
        job.framework_id == framework_id for job in store.stale_open_jobs(older_than_s=0.0)
    )


def _recently_refused(
    store: CurriculumStore, framework_id: str, level: str, subject: str, *, now: datetime
) -> bool:
    job = store.latest_job(
        framework_id=framework_id, query=framework_id, level=level, subject=subject
    )
    if job is None or job.state not in (JobState.REFUSED, JobState.FAILED):
        return False
    age = _age_s(job.updated_at or job.created_at, now=now)
    return age is None or age < REFUSAL_COOLDOWN_S


def plan(
    store: CurriculumStore,
    *,
    settings: Settings | None = None,
    limit: int = DEFAULT_PER_TICK,
    now: datetime | None = None,
) -> list[Target]:
    """The next targets, breadth first across the order, biggest board first on every rung."""
    if limit <= 0 or not enabled(settings=settings):
        return []
    moment = now or datetime.now(UTC)
    resolved = order(store, settings=settings)
    if not resolved.ids:
        return []
    rungs = targets(settings=settings)

    held = {framework_id: _held(store, framework_id) for framework_id in resolved.ids}
    busy = {framework_id: _busy(store, framework_id) for framework_id in resolved.ids}
    from wobo_gateway.curriculum import versions as version_rules

    out: list[Target] = []
    for rung, (level, subject) in enumerate(rungs):
        key = (version_rules.normalise(level), version_rules.normalise(subject))
        for rank, framework_id in enumerate(resolved.ids):
            if len(out) >= limit:
                return out
            if busy.get(framework_id) or key in held.get(framework_id, set()):
                continue
            if any(target.framework_id == framework_id for target in out):
                continue  # one job per board per plan, so a board never queues two at once
            if _recently_refused(store, framework_id, level, subject, now=moment):
                continue
            framework = resolved.board(framework_id)
            if framework is None:
                continue
            out.append(
                Target(
                    framework_id=framework_id,
                    framework_name=framework.name,
                    level=level,
                    subject=subject,
                    rank=rank,
                    rung=rung,
                )
            )
    return out


def enqueue(store: CurriculumStore, plan_: Sequence[Target]) -> list[DiscoveryJob]:
    """Put the plan in the queue. ``enqueue_discovery`` is idempotent per (board, class, subject),
    so a second pass over the same plan returns the same rows rather than paying twice."""
    made: list[DiscoveryJob] = []
    for target in plan_:
        try:
            made.append(
                store.enqueue_discovery(
                    query=target.query,
                    framework_id=target.framework_id,
                    level=target.level,
                    subject=target.subject,
                    requested_by=REQUESTED_BY,
                )
            )
        except StoreUnavailable:
            logger.warning(
                "prewarm: registry unavailable", extra={"fields": {"board": target.framework_id}}
            )
            break
    return made


def is_prewarm(job: DiscoveryJob) -> bool:
    """Was this board read because we chose to, or because somebody was waiting on it?"""
    return (job.requested_by or "") == REQUESTED_BY


__all__ = [
    "DEFAULT_PER_TICK",
    "ENABLED_KEY",
    "ORDER_KEY",
    "PER_TICK_KEY",
    "REFUSAL_COOLDOWN_S",
    "REQUESTED_BY",
    "SEED_ORDER",
    "SEED_TARGETS",
    "TARGETS_KEY",
    "Order",
    "SeedBoard",
    "Target",
    "UnknownBoard",
    "enabled",
    "enqueue",
    "is_prewarm",
    "order",
    "per_tick",
    "plan",
    "set_order",
    "targets",
]
