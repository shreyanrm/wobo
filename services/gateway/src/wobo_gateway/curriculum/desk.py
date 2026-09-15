"""The console's syllabus desk: the reading behind ``GET /v1/admin/syllabus``.

``docs/BOARD-COLD-START.md`` §4 asks for it in one sentence — *"the console shows the queue, what
has landed, what refused and why"* — and §5 for the money and the gate beside it: *"a budget per
board and per day, on the console with an alert"*, *"a refusal is remembered … and it goes to the
console instead"*, and *"nothing is published that a second reader did not verify against the same
document, and it is labelled provisional until a person confirms it."*

So this module answers six questions and nothing else:

======================  ====================================================================
``worker``              is the thing that does any of this even switched on
``prewarm``             what is next in the queue, in what order, and who set that order
``queue``               what is waiting right now, and whether a learner is waiting on it
``boards``              every board, the LABEL it is showing a learner, and WHY that one
``refused``             what could not be read, the reason, the line, and what it cost
``cost`` / ``day``      what each board cost, and the day against the platform's ceiling
======================  ====================================================================

**Three rules it keeps.**

*The label is derived, never composed here.* Every ``label`` on this desk comes back out of
:mod:`..labels`, which is the learner's own sentence. A desk that wrote its own would be a desk
that could show "verified" beside a syllabus nothing verified. ``why`` is the console's own
explanation of the derivation and is never shown to a learner.

*A number that was not measured is ``None``, never ``0``.* A job whose model calls could not be
priced is counted under ``unpriced`` and adds nothing to the total, because a board that cost
something we cannot name must not read as a board that was free.

*No learner reaches this desk.* ``requested_by`` is read to decide whether a person is waiting and
is then thrown away; the row says "a learner" or "the prewarm" and never an id.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from wobo_gateway.curriculum import labels
from wobo_gateway.curriculum.discovery import prewarm
from wobo_gateway.curriculum.discovery import worker as worker_mod
from wobo_gateway.curriculum.discovery.persist import subject_nodes
from wobo_gateway.curriculum.models import (
    DiscoveryJob,
    Framework,
    JobState,
    Status,
    Version,
)
from wobo_gateway.curriculum.store import CurriculumStore, StoreUnavailable

logger = logging.getLogger("wobo.gateway.curriculum.desk")

#: How many rows of each list the desk hands back. A queue is worked, not scrolled.
DEFAULT_LIMIT = 50

#: The desk's own plain line, beside the feed the observer desk already carries.
FEED = {
    "what": (
        "Every board we name, the sentence each one is showing a learner and why it is that "
        "sentence, what is waiting to be read, what refused and what it cost, and the day's "
        "spend against the platform's ceiling."
    ),
    "from": (
        "curriculum.frameworks, curriculum.versions and curriculum.discovery_jobs for the boards "
        "and the queue; ledger.take_spend, written onto each job by the discovery worker, for "
        "what a board cost; wobo_gateway.spend for the day."
    ),
    "gate": (
        "Nothing is published that a second reader did not verify against the same document, and "
        "it stays provisional until a person confirms it here (docs/BOARD-COLD-START.md §5)."
    ),
}

#: Why a board is showing the sentence it is showing. The console's words, never a learner's.
_WHY: dict[Status, str] = {
    Status.VERIFIED: (
        "A person read this against the board's own document and confirmed it, so it may name "
        "the board."
    ),
    Status.PROVISIONAL: (
        "Found on the board's own site and checked by a second reader against the same document. "
        "No person has confirmed it yet, so it claims less than it might."
    ),
    Status.COMMUNITY: (
        "Minted from what learners collectively changed, with the document unreachable "
        "(docs/CURRICULUM-OBSERVER.md §5). It says so in its own label."
    ),
    Status.PERSONAL: "Somebody's own syllabus. It is theirs, and it is never shown to anyone else.",
}

_WHY_NOTHING = (
    "Nothing has been read for this board yet, so the label claims only that the board is the "
    "board it says it is. A learner picking it starts on the class-and-subject plan every board "
    "shares while this is read behind them (docs/BOARD-COLD-START.md §2)."
)

#: What the job row's ``result.reason`` means, in a person's words. Unknown reasons pass through
#: as themselves rather than being smoothed into a sentence that might be wrong.
_REASONS: dict[str, str] = {
    "search_unavailable": "the search could not run at all",
    "not_found": "nothing official was found for it",
    "not_fetchable": "pages were found, the document itself would not open",
    "no_syllabus_in_document": "what was found is not the syllabus",
    # NOT the line above it. Uttar Pradesh's Class 10 Mathematics pdf is the board's own
    # syllabus, on the board's own host, in a legacy Devanagari font whose text layer nothing can
    # match — and it was refused as "not the syllabus", which sent an operator away from the one
    # board in the queue whose document had already been found.
    "document_unreadable": (
        "the board published a file whose own name says it is this class or subject, and its "
        "text could not be read — a legacy-font pdf, almost certainly. Open it: if a person can "
        "read the page, the board's document is fine and our reading of it is not"
    ),
    "document_out_of_date": (
        "the board's document is the syllabus, and it is an older edition than this academic "
        "year — look at it and say whether the board has simply not revised"
    ),
    "checks_failed": "the reading did not match the document closely enough to trust",
    "out_of_time": "it took longer than one run is allowed",
    "out_of_scope": "it is outside classes four to thirteen",
}

_DONE = (JobState.STORED, JobState.REFUSED, JobState.FAILED)


def _cost_of(job: DiscoveryJob) -> float | None:
    """What this job's model calls cost, or ``None`` when nothing on it could be priced."""
    value = (job.result or {}).get("cost_usd")
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _waiting_on(job: DiscoveryJob) -> str:
    """Who is waiting on this job. Never who they are — only whether they are a person."""
    asked = (job.requested_by or "").strip()
    if not asked:
        return "nobody yet"
    return "the prewarm" if prewarm.is_prewarm(job) else "a learner"


def _job_row(job: DiscoveryJob, names: dict[str, str]) -> dict[str, Any]:
    result = job.result or {}
    reason = result.get("reason")
    tried = result.get("tried")
    return {
        "job_id": job.id,
        "framework_id": job.framework_id,
        "framework_name": names.get(job.framework_id or "", job.query or ""),
        "level": job.level,
        "subject": job.subject,
        "state": job.state.value,
        "message": job.message,
        "reason": reason,
        "reason_plain": _REASONS.get(str(reason), reason),
        # What actually happened, in our own words, and every candidate the run opened. The
        # reason is a category; these two are the evidence, and without them a refused row is a
        # word an operator cannot act on (docs/BOARD-COLD-START.md §5). Never a learner's: no
        # route a learner can reach serves this desk.
        "detail": result.get("detail") or None,
        "tried": [str(line) for line in tried] if isinstance(tried, list) else [],
        "attempts": job.attempts,
        "waiting_on": _waiting_on(job),
        "cost_usd": _cost_of(job),
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def _board_row(
    framework: Framework, version: Version | None, subjects: int, chapters: int
) -> dict[str, Any]:
    """One board: what a learner is shown for it, and the console's reason for that sentence."""
    has = version is not None and chapters > 0
    if framework.personal or framework.status is Status.PERSONAL:
        why = _WHY[Status.PERSONAL]
    elif not has:
        why = _WHY_NOTHING
    else:
        why = _WHY[labels.weaker(framework.status, version.status)]  # type: ignore[union-attr]
    return {
        "framework_id": framework.id,
        "framework_name": framework.name,
        "kind": framework.kind.value,
        "country": framework.country,
        "region": framework.region,
        "official_site": framework.official_site,
        # DERIVED. The learner's own sentence, asked for rather than written here.
        "label": labels.label_for(framework, version if has else None),
        "status": (
            labels.weaker(framework.status, version.status).value  # type: ignore[union-attr]
            if has
            else framework.status.value
        ),
        "why": why,
        "has_syllabus": has,
        "version_id": version.id if has else None,
        "version_label": version.label if has else None,
        "source_url": version.source_url if has else None,
        "published_at": version.published_at if has else None,
        "subjects": subjects,
        "chapters": chapters,
        "may_promote": bool(
            has and version is not None and version.status is Status.PROVISIONAL and chapters > 0
        ),
    }


def _day() -> dict[str, Any]:
    """The platform's day against its ceiling. The alert §5 asks for is a fraction, not a colour."""
    from wobo_gateway import spend

    ceiling = spend.ceiling_usd()
    spent = spend.spent_usd()
    return {
        "spent_usd": spent,
        "ceiling_usd": ceiling,
        "fraction": (spent / ceiling) if ceiling else None,
        # The lane every discovery is shed in first (docs/OPERATIONS.md §2): internal work is a
        # stranger, so the worker stops at 90% of the day and a paying learner never notices.
        "lane": spend.Priority.STRANGER.value,
        "shedding": spend.verdict(spend.Priority.STRANGER) is spend.Verdict.REFUSE,
    }


def syllabus_desk(
    store: CurriculumStore,
    *,
    limit: int = DEFAULT_LIMIT,
    settings: Any = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """The whole desk in one read. Unreachable registry answers ``readable: false``, never an
    empty list that would read as "no board has ever refused"."""
    moment = now or datetime.now(UTC)
    empty: dict[str, Any] = {
        "readable": False,
        "worker": {
            "enabled": worker_mod.enabled(),
            "env": worker_mod.ENV,
            "interval_s": worker_mod.interval_s(),
        },
        "prewarm": {"enabled": prewarm.enabled(settings=settings), "order": [], "next": []},
        "boards": [],
        "queue": [],
        "landed": [],
        "refused": [],
        "cost": [],
        "day": _day(),
        "feed": FEED,
    }
    try:
        frameworks = list(store.search_frameworks("", limit=1000))
        versions = {v.framework_id: v for v in store.all_versions(limit=1000)}
        jobs = list(store.recent_jobs(limit=max(limit * 4, 200)))
    except StoreUnavailable:
        return empty
    except Exception as exc:  # noqa: BLE001, a desk that raises tells an operator nothing
        logger.warning("syllabus desk: unreadable", extra={"fields": {"error": type(exc).__name__}})
        return empty

    names = {framework.id: framework.name for framework in frameworks}

    # -- the boards, and how much of each one we actually hold
    counts: dict[str, tuple[int, int]] = {}
    for framework in frameworks:
        version = versions.get(framework.id)
        if version is None:
            counts[framework.id] = (0, 0)
            continue
        pairs = subject_nodes(store, version)
        chapters = len(store.all_nodes(version.id)) - len(pairs) * 2 if pairs else 0
        counts[framework.id] = (len(pairs), max(0, chapters))

    boards = [
        _board_row(framework, versions.get(framework.id), *counts[framework.id])
        for framework in frameworks
        if not framework.personal
    ]
    # Boards with a syllabus first, then the biggest of the rest: an operator opens this to find
    # what is missing, and 264 empty rows above four full ones is the wrong way round.
    rank = {entry.framework_id: index for index, entry in enumerate(prewarm.SEED_ORDER)}
    boards.sort(
        key=lambda row: (
            not row["has_syllabus"],
            rank.get(row["framework_id"], len(rank)),
            row["framework_name"],
        )
    )

    # The queue in DRAIN order, which is what an operator is actually asking: what is running
    # right now, then what the worker takes next. ``recent_jobs`` is newest-first, which is the
    # right order for a history and the wrong one for a queue.
    running = [job for job in jobs if job.open and job.state is not JobState.QUEUED]
    running.sort(key=lambda job: job.updated_at or job.created_at or "")
    try:
        waiting = store.queued_jobs(limit=max(limit, 50))
    except StoreUnavailable:
        waiting = [job for job in jobs if job.state is JobState.QUEUED]
    queue = [_job_row(job, names) for job in (*running, *waiting)]
    landed = [_job_row(job, names) for job in jobs if job.state is JobState.STORED][:limit]
    refused = [
        _job_row(job, names) for job in jobs if job.state in (JobState.REFUSED, JobState.FAILED)
    ][:limit]

    # -- what each board cost. Unpriced jobs are COUNTED and never added.
    per_board: dict[str, dict[str, Any]] = {}
    for job in jobs:
        if job.state not in _DONE or not job.framework_id:
            continue
        row = per_board.setdefault(
            job.framework_id,
            {
                "framework_id": job.framework_id,
                "framework_name": names.get(job.framework_id, job.query or ""),
                "jobs": 0,
                "usd": None,
                "unpriced": 0,
            },
        )
        row["jobs"] += 1
        cost = _cost_of(job)
        if cost is None:
            row["unpriced"] += 1
        else:
            row["usd"] = (row["usd"] or 0.0) + cost
    cost_rows = sorted(
        per_board.values(), key=lambda row: (row["usd"] is None, -(row["usd"] or 0.0))
    )

    order = prewarm.order(store, settings=settings)
    seed_by_id = {entry.framework_id: entry for entry in prewarm.SEED_ORDER}
    return {
        **empty,
        "readable": True,
        "prewarm": {
            "enabled": prewarm.enabled(settings=settings),
            "source": order.source,
            "editable_key": prewarm.ORDER_KEY,
            "rejected": list(order.rejected),
            "per_tick": prewarm.per_tick(settings=settings),
            "order": [
                {
                    "rank": index,
                    "framework_id": framework_id,
                    "framework_name": names.get(framework_id, framework_id),
                    "note": (
                        seed_by_id[framework_id].note
                        if framework_id in seed_by_id
                        else "added from the console"
                    ),
                    "has_syllabus": bool(counts.get(framework_id, (0, 0))[1]),
                }
                for index, framework_id in enumerate(order.ids)
            ],
            "next": [
                target.as_dict()
                for target in prewarm.plan(store, settings=settings, limit=10, now=moment)
            ],
            "targets": ["|".join(pair) for pair in prewarm.targets(settings=settings)],
        },
        "boards": boards,
        "queue": queue[:limit],
        "landed": landed,
        "refused": refused,
        "cost": cost_rows[:limit],
        "counts": {
            "boards": len(boards),
            "with_syllabus": sum(1 for row in boards if row["has_syllabus"]),
            "queued": len(queue),
            "refused": len(refused),
        },
    }


__all__ = ["DEFAULT_LIMIT", "FEED", "syllabus_desk"]
