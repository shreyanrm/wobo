"""The console's four desks: flags, bugs, support and refund requests.

The read half of :mod:`wobo_gateway.reports`, and the sibling of :mod:`wobo_gateway.console_api`
— that file puts the money authorities behind the guard, this one puts the queues behind it.
Every route hangs off :func:`wobo_gateway.admin_auth.admin_router`, so it is guarded by
construction, and each names the permission it needs so a seat that may read the money cannot
silently gain the power to close a child's flag.

**Three permissions, and the difference between them is the whole design.**

* ``console.read`` — the queues, the counts, one report's words. No identity.
* ``learner.read`` — the three fields a person cannot work without: the report's id, which account
  a refund is about, and where to reply to a support message. NOT carried by the viewer seat: this
  is the console's only route that turns an anonymous queue row into a named child. Its own route,
  its own audit line (``desk.report.identify``), so "who saw a learner's address, and when" is one
  query against ``ops.admin_audit``.
* ``support.act`` — moving a report through its states. A write, so ``AdminContext.require``
  already demands a step-up inside the reauth window before it happens.

**Show the least that does the job.** A queue row carries the reason, the state, when it came in,
the person's own words and a short handle — never the learner's id, never their address, never
their work. Every field on it is justified in :func:`queue_view`. A flag and a bug never identify
anybody at all, because both are fixed by changing the product rather than by finding a person.

**Nothing is invented when there is nothing.** ``readable`` is the honesty bit, exactly as
``console_api._window_view`` uses it: ``false`` means the queue could not be reached, and then
there are NO counts rather than zeros, because a zero is a claim ("nothing came in") and a console
that showed one for both states would be telling an operator the product was quiet when in fact the
console was blind. :data:`FEEDS` is the other half: each desk says in one plain line what actually
reaches it today, so an empty desk reads as "nothing has come in through these routes" rather than
as a panel somebody forgot to wire.
"""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from wobo_gateway import doors, reports
from wobo_gateway.admin_auth import (
    ADMIN_MANAGE,
    CONSOLE_READ,
    LEARNER_READ,
    SUPPORT_ACT,
    AdminContext,
    admin_router,
    requires,
)
from wobo_gateway.curriculum import labels as curriculum_labels
from wobo_gateway.curriculum import observer as syllabus_observer
from wobo_gateway.curriculum import store as curriculum_store
from wobo_gateway.curriculum.desk import DEFAULT_LIMIT as SYLLABUS_LIMIT
from wobo_gateway.curriculum.desk import FEED as SYLLABUS_FEED
from wobo_gateway.curriculum.desk import syllabus_desk
from wobo_gateway.curriculum.discovery import prewarm
from wobo_gateway.curriculum.models import JobState, Status
from wobo_gateway.reports import (
    KINDS,
    MAX_NOTE,
    REASONS,
    STATES,
    BadIdentifier,
    NotKept,
    Report,
    StoreUnavailable,
    handle,
    normalise_note,
)


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat() if value else None


#: The widest page a desk may ask for. A queue is worked, not scrolled.
MAX_PAGE = 200
DEFAULT_PAGE = 50

#: What actually reaches each desk TODAY, in one plain line each, and what would fill it if the
#: answer is "not much". This is served with the summary so the screen never has to invent the
#: sentence under an empty desk — and so that when a route is added, the sentence changes here
#: rather than drifting in a component nobody greps.
FEEDS: dict[str, dict[str, str]] = {
    "flag": {
        "what": "A learner telling us something Wobo produced is wrong, confusing or upsetting.",
        "feeds": (
            "POST /v1/flags, from the quiet flag control on every screen inside Wobo (the rail on "
            "a computer, above the doors on a phone, the corner of a full board)."
        ),
        "missing": (
            "A report carries the reason, the learner's words if they typed any, and pointers at "
            "what was on screen. There is no picture of the screen, no way to mark one up, and no "
            "message back to the learner when one is settled: none of those three is built. "
            "Nothing here is answered, and no turnaround time is published, because nobody is "
            "answerable for meeting one yet."
        ),
    },
    "bug": {
        "what": "Somebody inside the product saying a thing is broken.",
        "feeds": "POST /v1/report/bug, from a report control in the learner app.",
        "missing": (
            "This is an intake, not a tracker: the work is triaged into GitHub, which stays the "
            "issue tracker. No control in the app calls it yet."
        ),
    },
    "support": {
        "what": "A message from somebody who needs a person, raised from inside the product.",
        "feeds": "POST /v1/support/message.",
        "missing": (
            "The public contact page is still a mailto: to support@heywobo.com and does not reach "
            "this desk, so a message sent from there is in the mailbox and not here. There is no "
            "live chat and none is planned."
        ),
    },
    "refund": {
        "what": (
            "A request under one of the five cases the law gives: a charge after cancelling, a "
            "duplicate charge, an unauthorised charge, a service we did not supply, or the "
            "EU/EEA/UK cooling-off right."
        ),
        "feeds": "POST /v1/refund-request.",
        "missing": (
            "We do not refund as a gesture of goodwill and no route accepts a reason that would "
            "imply otherwise. Cancelling is the answer to a change of mind."
        ),
    },
}


#: The observer desk's own plain line (docs/CURRICULUM-OBSERVER.md §8), served beside its
#: numbers for the same reason :data:`FEEDS` is: an empty desk must say what would fill it.
OBSERVER_FEED: dict[str, str] = {
    "what": (
        "Per syllabus edition: how many learners really use it, which chapters a large share of "
        "them have all removed, added, renamed or reordered, and what the observer did about it."
    ),
    "feeds": (
        "curriculum.overlay.apply (every edit), POST /v1/flags with reason not_my_syllabus and "
        "about.version_id + about.node_id (a flag on a chapter), and wobo.turn with "
        "context.curriculum.nodeId (real use). Counted under a keyed digest, never a learner id."
    ),
    "missing": (
        "Nothing here moves until the discovery worker is switched on (WOBO_DISCOVERY_WORKER): "
        "the observer runs on its cadence and under its budget. With require_review on, which is "
        "the default, every correction waits in the review queue for a person."
    ),
}


class RetryBody(BaseModel):
    """One refused board, sent back to the queue. The id rides in the body because the console's
    transport calls STATIC endpoint names (``apps/web-pwa/src/admin/api.ts``)."""

    job_id: str = Field(min_length=1, max_length=200)


class PromoteBody(BaseModel):
    """Promote one provisional version to verified.

    ``read`` is not a formality and not a checkbox the screen ticks for you. BOARD-COLD-START §5:
    *"it is labelled provisional until a person confirms it. That gate already exists and does not
    move."* The flag is the person saying, in the audit trail, that they read this reading against
    the board's own document. Without it the route refuses.
    """

    version_id: str = Field(min_length=1, max_length=200)
    read: bool = False
    note: str | None = Field(default=None, max_length=500)


class PrewarmBody(BaseModel):
    """The prewarm queue's dials: its order, whether it runs, and how many boards a tick takes."""

    order: list[str] | None = None
    enabled: bool | None = None
    per_tick: int | None = Field(default=None, ge=0, le=10)


class ReviewSwitchBody(BaseModel):
    """The require-review switch (CURRICULUM-OBSERVER.md §8). Owner only: turning it off lets
    the observer publish a correction the document and the reconciler agreed on without a
    person reading it first."""

    require_review: bool


class MoveBody(BaseModel):
    """The move, id and all.

    THE ID IS IN THE BODY, AND THE OTHER TWO ROUTES TAKE IT AS A QUERY PARAMETER, because the
    console's own transport (``apps/web-pwa/src/admin/api.ts``) reads and writes STATIC endpoint
    names with an optional query — one place where every admin call gets its two proofs, its
    ``no-store``, its timeout and its refusal to retry. A path parameter would mean either
    forking that transport or building URLs at a call site, and a second way to reach the gateway
    is a second place for a proof to be forgotten. A report id is an opaque uuid either way.
    """

    id: str = Field(max_length=64)
    state: str = Field(max_length=32)
    resolution: str | None = Field(default=None, max_length=MAX_NOTE + 200)
    #: The second confirmation. Asked for on the refund desk past "looked at", because that is
    #: the one queue where the next step is somebody's money moving.
    confirm: bool = False


def queue_view(report: Report) -> dict[str, Any]:
    """One queue row. Every field justified, and the three that are absent justified too.

    ``reason``/``state``/``urgent`` — what the desk sorts and triages on.
    ``note`` — the person's own words. This is the substance of the report and the reason anybody
      opens the queue; it is text, rendered as text, never markup.
    ``handle`` — eight characters of a KEYED DIGEST of the learner id (``reports.handle``): enough
      to notice the same person twice in one morning, and not invertible, so it cannot be matched
      against an id learned anywhere else. The full id is a separate route and a separate audit
      line.
    ``about`` — the pointers the gateway kept from an allow-list: which surface, which content id.
      Never the learner's work.
    ``moved_by``/``moved_at``/``resolution`` — who is answerable for this row and what they did.

    NOT here: ``learner_id`` (see ``handle``), ``contact_email`` (a desk does not need an address
    to read a queue), and anything the learner was studying.
    """
    return {
        "id": report.id,
        "kind": report.kind,
        "state": report.state,
        "reason": report.reason,
        "urgent": report.urgent,
        "note": report.note,
        "handle": handle(report.learner_id),
        "about": report.about or {},
        "source": report.source,
        "raised_at": _iso(report.created_at),
        "moved_at": _iso(report.acted_at),
        "moved_by": report.acted_by_email,
        "resolution": report.resolution,
    }


def desk_summary(rows: reports.Counts | list[tuple[str, str, bool, int]]) -> dict[str, Any]:
    """The four desks at a glance: how many are waiting, and how many need attention first."""
    tally = rows.tally if isinstance(rows, reports.Counts) else rows
    desks: dict[str, Any] = {}
    for kind in KINDS:
        by_state = dict.fromkeys(STATES, 0)
        urgent_open = 0
        for row_kind, state, urgent, total in tally:
            if row_kind != kind:
                continue
            if state in by_state:
                by_state[state] += total
            if urgent and state in ("new", "looked_at"):
                urgent_open += total
        desks[kind] = {
            "states": by_state,
            "open": by_state["new"] + by_state["looked_at"],
            "urgent": urgent_open,
            "total": sum(by_state.values()),
        }
    return desks


def register_desks(app: FastAPI) -> None:
    """Mount the four desks. Called once from ``app.create_app``, after ``register_admin``."""
    router = admin_router(tags=["admin", "desks"])

    @router.get("/desks")
    def desks(ctx: AdminContext = Depends(requires(CONSOLE_READ))) -> dict[str, Any]:
        """The four counts, what feeds each desk, and whether the counts could be read at all."""
        ctx.audit("desk.summary.read", resource_type="reports")
        try:
            counted = reports.get_store().counts()
        except StoreUnavailable:
            # No zeros. A zero would say "nothing came in"; this says "I could not ask", and the
            # screen has to render the two differently because they mean opposite things.
            return {"readable": False, "desks": {}, "feeds": FEEDS, "reasons": REASONS}
        return {
            "readable": True,
            "desks": desk_summary(counted),
            # Did the count reach the end of the table? ``ops.reports`` only grows — closing is a
            # state, not a delete — so a count that had to stop early is a FLOOR, and every "N
            # waiting" built from it is one too. The screen prints that beside the number rather
            # than showing a truncated tally in the same type as a true one.
            "complete": counted.complete,
            "scanned": counted.scanned,
            "feeds": FEEDS,
            # The closed lists, so the screen's filters are the route's own vocabulary rather than
            # a second copy that can drift.
            "reasons": REASONS,
            "states": list(STATES),
        }

    @router.get("/reports")
    def queue(
        kind: str | None = Query(None, max_length=16),
        state: str | None = Query(None, max_length=16),
        limit: int = Query(DEFAULT_PAGE, ge=1, le=MAX_PAGE),
        ctx: AdminContext = Depends(requires(CONSOLE_READ)),
    ) -> dict[str, Any]:
        """One desk's queue: urgent first, then newest. No identity on any row."""
        picked_kind = kind if kind in KINDS else None
        picked_state = state if state in STATES else None
        ctx.audit(
            "desk.queue.read",
            resource_type="reports",
            resource_id=picked_kind,
            detail={"state": picked_state, "limit": limit},
        )
        try:
            rows = reports.get_store().queue(kind=picked_kind, state=picked_state, limit=limit)
        except StoreUnavailable:
            return {"readable": False, "reports": [], "kind": picked_kind, "state": picked_state}
        return {
            "readable": True,
            "reports": [queue_view(row) for row in rows],
            "kind": picked_kind,
            "state": picked_state,
            # THIS IS A PAGE, and it says so. A desk with 200 open reports used to look like a desk
            # with 50, under a count from a different source that disagreed with no explanation.
            # ``more`` is true when the page came back full, which is the only thing a caller can
            # know without a second query, and the console prints "showing the first N of M".
            "limit": limit,
            "shown": len(rows),
            "more": len(rows) >= limit,
        }

    @router.get("/reports/who")
    def who_raised_it(
        id: str = Query(max_length=64),
        ctx: AdminContext = Depends(requires(LEARNER_READ)),
    ) -> dict[str, Any]:
        """Who raised ONE refund or support report, for an OPERATOR or an owner. Never a viewer.

        Three fields go out — the report's own id, the learner's account id and the address to
        reply to — and they are the fields a person cannot do the work without: a refund cannot be
        checked without finding the subscription, and a support message cannot be answered without
        somewhere to send the answer. A flag and a bug are fixed by changing the product, so this
        route refuses them outright rather than leaving it to a caller to remember not to ask.

        ``learner.read`` is deliberately NOT in the viewer seat (``admin_auth.PERMISSIONS``): this
        is the console's only route that turns an anonymous queue row into a named child, and the
        seat that may do it is the seat that also carries the power to act on the case. It is its
        own route, on its own permission, with its own line in the trail, so "who saw a learner's
        address, and when" is one query against ``ops.admin_audit`` rather than an inference from
        which queue was open.
        """
        found = _find(id)
        if found.kind not in ("refund", "support"):
            ctx.audit(
                "desk.report.identify",
                resource_type="report",
                resource_id=found.id,
                decision="denied",
                detail={"kind": found.kind},
            )
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "not_needed",
                    "message": (
                        "A flag and a bug are fixed by changing the product, so this desk does "
                        "not show who raised them."
                    ),
                },
            )
        ctx.audit(
            "desk.report.identify",
            resource_type="report",
            resource_id=found.id,
            detail={"kind": found.kind},
        )
        return {"id": found.id, "learner_id": found.learner_id, "reply_to": found.contact_email}

    @router.post("/reports/state")
    def move_report(
        body: MoveBody, ctx: AdminContext = Depends(requires(SUPPORT_ACT))
    ) -> dict[str, Any]:
        """Move a report through its states. A write, so the guard already demanded a step-up."""
        state = str(body.state or "").strip().lower()
        if state not in STATES or state == "new":
            # Back to `new` is not a state change, it is erasing that somebody looked. The trail
            # would still carry the look, and the row would then contradict it.
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "not_kept",
                    "field": "state",
                    "message": "I do not know that state.",
                },
            )
        try:
            resolution = normalise_note(body.resolution, required=False, field_name="resolution")
        except NotKept as exc:
            raise reports.not_kept(exc) from exc

        found = _find(body.id)

        # The second confirmation, asked for exactly where money is. Settling a refund request
        # means somebody is about to move a charge, or has decided not to, and both are decisions
        # a person should have to make twice and write down once.
        if found.kind == "refund" and state in ("acted_on", "closed"):
            if not body.confirm:
                ctx.audit(
                    "desk.report.state",
                    resource_type="report",
                    resource_id=found.id,
                    decision="denied",
                    detail={"code": "confirm_required", "now": state},
                )
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "confirm_required",
                        "message": (
                            "Settling a refund request is a decision about somebody's money. "
                            "Confirm it, and say in one line what was done."
                        ),
                    },
                )
            if not resolution:
                raise reports.not_kept(
                    NotKept("resolution", "Say in one line what was done about the charge.")
                )

        fields: dict[str, Any] = {
            "state": state,
            "acted_by": ctx.admin.subject_id,
            "acted_by_email": ctx.admin.email,
            "acted_at": _iso(datetime.now(UTC)),
        }
        if resolution is not None:
            fields["resolution"] = resolution
        ctx.audit(
            "desk.report.state",
            resource_type="report",
            resource_id=found.id,
            detail={
                "kind": found.kind,
                "was": found.state,
                "now": state,
                "confirmed": bool(body.confirm),
            },
        )
        try:
            moved = reports.get_store().update(found.id, fields)
        except StoreUnavailable as exc:
            # A write that failed is told plainly. An operator who is shown a state change that
            # did not save will not make it again.
            raise reports.unavailable() from exc
        if moved is None:
            raise HTTPException(status_code=404, detail="Not Found")
        return queue_view(moved)

    @router.get("/observer")
    def observer_desk(
        limit: int = Query(20, ge=1, le=50),
        ctx: AdminContext = Depends(requires(CONSOLE_READ)),
    ) -> dict[str, Any]:
        """The syllabus observer, per edition (CURRICULUM-OBSERVER.md §8).

        The same honesty bit as every other desk: ``readable`` false means the counts could not
        be reached, and then there are no editions rather than an empty list that would read as
        "nobody has edited anything". Nothing on a row is a name that was not looked up or a
        number that was not counted.
        """
        ctx.audit(
            "observer.desk.read", resource_type="curriculum.observer", detail={"limit": limit}
        )
        try:
            view = syllabus_observer.desk_view(
                observer=syllabus_observer.get_observer(),
                curriculum_store=curriculum_store.get_store(),
                limit=limit,
            )
        except (curriculum_store.StoreUnavailable, StoreUnavailable):
            return {
                "readable": False,
                "enabled": syllabus_observer.enabled(),
                "require_review": None,
                "versions": [],
                "feed": OBSERVER_FEED,
            }
        return {
            "readable": True,
            **view,
            "feed": OBSERVER_FEED,
            "shown": len(view["versions"]),
            "limit": limit,
        }

    @router.post("/observer/review-switch")
    def observer_review_switch(
        body: ReviewSwitchBody, ctx: AdminContext = Depends(requires(ADMIN_MANAGE))
    ) -> dict[str, Any]:
        """Require a person for every correction, or not. On by default, and only an owner
        turns it off (§8: "for the first months, until the observer has earned trust")."""
        ctx.audit(
            "observer.review_switch",
            resource_type="curriculum.observer",
            detail={"require_review": body.require_review},
        )
        try:
            value = syllabus_observer.get_observer().set_require_review(
                body.require_review, by=ctx.admin.email
            )
        except curriculum_store.StoreUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "desk_unavailable",
                    "message": "I could not save that just now. Try me again in a moment.",
                },
            ) from exc
        return {"require_review": value, "set_by": ctx.admin.email}

    # --- the syllabus desk (docs/BOARD-COLD-START.md §4 and §5) ---------------------------------
    @router.get("/syllabus")
    def syllabus_desk_route(
        limit: int = Query(SYLLABUS_LIMIT, ge=1, le=MAX_PAGE),
        ctx: AdminContext = Depends(requires(CONSOLE_READ)),
    ) -> dict[str, Any]:
        """Every board, the label it shows and why; the queue; what landed; what refused and why;
        what each cost; and the day against its ceiling.

        ``readable`` false is the same honesty bit every other desk carries: the registry could
        not be reached, and then there are no rows rather than an empty list that would read as
        "no board has ever refused".
        """
        ctx.audit(
            "syllabus.desk.read", resource_type="curriculum.syllabus", detail={"limit": limit}
        )
        try:
            store = curriculum_store.get_store()
        except curriculum_store.StoreUnavailable:
            return {"readable": False, "boards": [], "queue": [], "feed": SYLLABUS_FEED}
        return syllabus_desk(store, limit=limit)

    @router.post("/syllabus/retry")
    def syllabus_retry(
        body: RetryBody, ctx: AdminContext = Depends(requires(SUPPORT_ACT))
    ) -> dict[str, Any]:
        """Send one refused board back to the queue.

        §5 remembers a refusal so a dead link is not re-fetched on every learner who picks that
        board; this is the person overriding that memory, which is exactly what the console queue
        is for. A job that is still running is NOT re-queued: two workers on one board is the race
        the conditional claim exists to prevent.
        """
        ctx.audit(
            "syllabus.retry", resource_type="curriculum.discovery_job", resource_id=body.job_id
        )
        store = _curriculum_store()
        job = store.get_job(body.job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Not Found")
        if job.open:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "already_running",
                    "message": "That board is being read right now. Nothing to retry.",
                },
            )
        moved = store.update_job(
            job.id, state=JobState.QUEUED, message=curriculum_labels.job_message(JobState.QUEUED)
        )
        if moved is None:
            raise HTTPException(status_code=404, detail="Not Found")
        return {
            "job_id": moved.id,
            "state": moved.state.value,
            "worker_running": _worker_running(),
        }

    @router.post("/syllabus/promote")
    def syllabus_promote(
        body: PromoteBody, ctx: AdminContext = Depends(requires(ADMIN_MANAGE))
    ) -> dict[str, Any]:
        """Promote one provisional version to verified, after a person has read it.

        THE GATE DOES NOT MOVE (BOARD-COLD-START §5). Three things must be true and each is
        checked here rather than assumed by the screen: a person says they read it, the version
        is provisional, and it actually holds chapters. Promoting an empty version would put
        "Official …, verified" on a board with nothing behind it, which is the exact claim the
        honest-label law exists to prevent.
        """
        ctx.audit(
            "syllabus.promote",
            resource_type="curriculum.version",
            resource_id=body.version_id,
            detail={"read": body.read},
        )
        if not body.read:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "confirm_required",
                    "message": (
                        "Verified means a person read this against the board's own document. "
                        "Say so, and it is your name on the trail."
                    ),
                },
            )
        store = _curriculum_store()
        version = store.get_version(body.version_id)
        if version is None:
            raise HTTPException(status_code=404, detail="Not Found")
        if version.status is Status.VERIFIED:
            raise HTTPException(
                status_code=409,
                detail={"code": "already_verified", "message": "That reading is already verified."},
            )
        if version.status is not Status.PROVISIONAL:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "not_provisional",
                    "message": (
                        "Only a provisional reading is promoted here. A community reading says "
                        "in its own label where it came from and is corrected, never promoted."
                    ),
                },
            )
        if not store.all_nodes(version.id):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "nothing_to_verify",
                    "message": (
                        "That version holds no chapters. There is nothing here a person could "
                        "have read."
                    ),
                },
            )
        # STATUS ONLY. Everything else on a published version is immutable, in this code and in
        # the database (migration 0008's `refuse_published_edit` names every column it guards and
        # deliberately leaves `status` out: promotion is the one change a published reading may
        # take, and a correction is always a new version with `supersedes`).
        promoted = store.put_version(
            replace(
                version,
                status=Status.VERIFIED,
                published_at=version.published_at or _iso(datetime.now(UTC)),
            )
        )
        framework = store.get_framework(promoted.framework_id)
        return {
            "version_id": promoted.id,
            "status": promoted.status.value,
            # Derived, like every label in this product: the sentence a learner now reads.
            "label": (curriculum_labels.label_for(framework, promoted) if framework else None),
            "confirmed_by": ctx.admin.email,
        }

    @router.post("/syllabus/prewarm")
    def syllabus_prewarm(
        body: PrewarmBody, ctx: AdminContext = Depends(requires(ADMIN_MANAGE))
    ) -> dict[str, Any]:
        """Turn the prewarm queue: its order, its switch, its pace. Owner only — it spends money.

        The order is checked against the registry BEFORE anything is written, and the refusal
        names the board it could not find, because an order that silently dropped a typo would be
        a queue quietly reading the wrong boards.
        """
        ctx.audit(
            "syllabus.prewarm",
            resource_type="curriculum.prewarm",
            detail={
                "order": len(body.order) if body.order is not None else None,
                "enabled": body.enabled,
                "per_tick": body.per_tick,
            },
        )
        store = _curriculum_store()
        settings = doors.get_store()
        written: dict[str, Any] = {}
        if body.order is not None:
            try:
                written["order"] = list(
                    prewarm.set_order(
                        body.order, settings=settings, actor=ctx.admin.email, store=store
                    )
                )
            except prewarm.UnknownBoard as exc:
                raise HTTPException(
                    status_code=422, detail={"code": "unknown_board", "message": str(exc)}
                ) from exc
        if body.enabled is not None:
            settings.write(
                prewarm.ENABLED_KEY, body.enabled, actor=ctx.admin.email, note="the prewarm switch"
            )
            written["enabled"] = body.enabled
        if body.per_tick is not None:
            settings.write(
                prewarm.PER_TICK_KEY,
                body.per_tick,
                actor=ctx.admin.email,
                note="boards queued per tick",
            )
            written["per_tick"] = body.per_tick
        if not written:
            raise HTTPException(
                status_code=422,
                detail={"code": "nothing_to_set", "message": "Say what to change."},
            )
        return {**written, "set_by": ctx.admin.email}

    app.include_router(router)


def _curriculum_store():
    try:
        return curriculum_store.get_store()
    except curriculum_store.StoreUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "desk_unavailable",
                "message": "I could not reach the syllabus registry just now.",
            },
        ) from exc


def _worker_running() -> bool:
    """Whether anything will actually pick the retried job up. A retry into a stopped worker is
    still the right row to write, and the console is told the truth about it."""
    from wobo_gateway.curriculum.discovery import worker as worker_mod

    return worker_mod.enabled()


def _find(report_id: str) -> Report:
    # Checked HERE and not only inside the PostgREST store, so the answer to a typo is the same
    # whichever store is wired: a malformed id is a 422 about the input, never a 404 that implies
    # we looked and found nothing, and never a 503 that implies the desk is down.
    try:
        uuid.UUID(str(report_id))
    except (ValueError, AttributeError, TypeError) as exc:
        raise reports.not_an_id() from exc
    try:
        found = reports.get_store().get(report_id)
    except BadIdentifier as exc:
        # Caught before StoreUnavailable, which it subclasses. A mistyped id told an operator "the
        # desk is unreachable", which during an incident is the difference between an hour spent
        # on the database and a second spent on the clipboard.
        raise reports.not_an_id() from exc
    except StoreUnavailable as exc:
        raise reports.unavailable() from exc
    if found is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return found


__all__ = [
    "DEFAULT_PAGE",
    "FEEDS",
    "MAX_PAGE",
    "OBSERVER_FEED",
    "desk_summary",
    "queue_view",
    "register_desks",
]
