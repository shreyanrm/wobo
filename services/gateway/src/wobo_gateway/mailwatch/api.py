"""The watch's doors: the provider's webhook, the cron pass, and the console's mail desk.

* ``POST /v1/mail/events`` (:mod:`.events`): open, and signed.
* ``POST /v1/internal/mail/watch``: the cron pass, behind the internal key every mail door shares.
  The seed check, the Postmaster read and the complaint rates, with the clock handed in. Hourly
  from the same cron as the Sunday note, the wishes and the nudges; each check decides for itself
  whether anything is due, so a second call in the hour is a no-op.
* ``GET /v1/admin/mail``: the mail desk, on the mail panel's read. Counts only: no address, no
  digest, no name.
* ``POST /v1/admin/mail/unpause``: the desk's one control. ``admin.manage``, which only the owner
  holds and which the guard asks a step-up for; a line in the console's trail, and the dial's own
  line in ``ops.settings_audit`` with the owner as its actor and the note beside it.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from wobo_gateway.admin_auth import ADMIN_MANAGE, AdminContext, CanRead, admin_router, requires
from wobo_gateway.email import (
    _FROM,
    TRANSACTIONAL_FROM_ENV,
    require_internal_key,
    sender_for,
    suppression_list_unreadable,
)
from wobo_gateway.email_templates import KINDS
from wobo_gateway.mailwatch import events, placement, postmaster, respond, store

WATCH_PATH = "/v1/internal/mail/watch"
#: Authenticated when a token rides along, never refused for want of one: the key is the door.
SOFT_AUTH_PATHS = frozenset({WATCH_PATH})
ALERTS_SHOWN = 20


class WatchRequest(BaseModel):
    #: The moment to evaluate against, ISO 8601 with offset. Absent: now.
    now: str | None = Field(default=None, max_length=40)


def _moment(body: WatchRequest) -> datetime | None:
    if not body.now:
        return datetime.now(UTC)
    try:
        moment = datetime.fromisoformat(body.now.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else None


def run_watch(now: datetime) -> dict[str, Any]:
    """One pass of everything the watch checks on a clock. Never raises past a check.

    It also reads the suppression list again if it could not be read (and tells the owner while
    it cannot), and mails every recent alert whose mail has not gone yet.
    """
    readable = not suppression_list_unreadable(now)
    return {
        "store": {"readable": readable},
        "placement": placement.run_placement(now),
        "postmaster": postmaster.run_postmaster(now),
        "rates": respond.evaluate(now),
        "alerts_mailed": respond.retry_unmailed(now),
    }


def _state(stat: respond.KindStat) -> str:
    rate = stat.rate
    if rate is None:
        return "no_mail"
    if rate > respond.CLIFF:
        return "over_cliff"
    if rate > respond.PAUSE_AT:
        return "over_pause"
    return "ok"


def desk_view(now: datetime) -> dict[str, Any]:
    """Everything the mail desk shows, in counts."""
    moment = now.astimezone(UTC)
    watch = store.get_store()
    window = respond.window(moment)
    paused = respond.paused()
    kinds = [
        {
            "kind": kind,
            "delivered": stat.delivered,
            "complained": stat.complained,
            "rate": stat.rate,
            "state": _state(stat),
            "paused": kind in paused,
        }
        for kind, stat in sorted(window.kinds.items())
    ]
    overall = window.overall
    alerts = sorted(watch.rows(store.ALERT), key=lambda r: (r.at, r.key), reverse=True)
    last = events.last_received()
    transactional = sender_for("verify_email")
    return {
        "at": moment.isoformat(),
        "readable": bool(watch.readable),
        "thresholds": {
            "pause": respond.PAUSE_AT,
            "cliff": respond.CLIFF,
            "window_days": respond.WINDOW_DAYS,
            "min_complaints": respond.MIN_COMPLAINTS,
        },
        "complaints": {
            "overall": {**overall.view(), "state": _state(overall)},
            "kinds": kinds,
        },
        "bounces": {
            "hard": overall.hard,
            "soft": overall.soft,
            "delayed": overall.delayed,
            "suppressed_by_provider": overall.suppressed,
            "failed": overall.failed,
        },
        "days": events.daily_counts(
            since=(moment - timedelta(days=respond.WINDOW_DAYS - 1)).date()
        ),
        "suppressed": {"count": watch.suppressed_count()},
        "paused": [
            {
                "kind": kind,
                "since": entry.get("since"),
                "reason": entry.get("reason"),
                "source": entry.get("source"),
                "rate": entry.get("rate"),
                "threshold": entry.get("threshold"),
            }
            for kind, entry in sorted(paused.items())
        ],
        "never_paused": sorted(respond.NEVER_PAUSED),
        "placement": placement.desk_view(),
        "postmaster": postmaster.desk_view(),
        "webhook": {
            "configured": events.configured(),
            "path": events.EVENTS_PATH,
            "last_event_at": last.isoformat() if last else None,
        },
        "alerts": [
            {
                "at": row.at.isoformat(),
                "cause": row.event,
                "kind": row.kind or None,
                "severity": row.detail.get("severity"),
                # Scrubbed again on the way out: a row kept before the scrub existed must not
                # show an address to the lowest seat.
                "message": respond.scrub(row.detail.get("message")),
                "action": respond.scrub(row.detail.get("action")),
                "mailed": respond.alert_mailed(row),
            }
            for row in alerts[:ALERTS_SHOWN]
        ],
        "alert_to_set": bool((os.getenv(respond.ALERT_TO_ENV) or "").strip()),
        "streams": {
            "learning": _FROM,
            "transactional": transactional,
            "separate": transactional != _FROM,
            "variable": TRANSACTIONAL_FROM_ENV,
        },
    }


class UnpauseBody(BaseModel):
    kind: str = Field(min_length=1, max_length=64, pattern=r"^[a-z_]+$")
    note: str | None = Field(default=None, max_length=280)


def register_mail_watch(app: FastAPI) -> None:
    """The webhook and the cron door. Mounted beside the other mail doors."""
    events.register_mail_events(app)

    @app.post(WATCH_PATH, include_in_schema=False)
    def watch(request: Request, body: WatchRequest | None = None) -> dict[str, Any]:
        require_internal_key(request)
        moment = _moment(body or WatchRequest())
        if moment is None:
            return {"ok": False, "error": "bad_now"}
        return {"ok": True, "at": moment.astimezone(UTC).isoformat(), **run_watch(moment)}


def register_mail_desk(app: FastAPI) -> None:
    """The console's mail desk. AFTER ``register_admin``, behind the same guarded router."""
    router = admin_router(tags=["admin", "mail"])

    @router.get("/mail")
    def mail_desk(ctx: CanRead) -> dict[str, Any]:
        ctx.audit("console.mail.read", resource_type="mail_watch")
        return desk_view(datetime.now(UTC))

    @router.post("/mail/unpause")
    def unpause(
        body: UnpauseBody, ctx: Annotated[AdminContext, Depends(requires(ADMIN_MANAGE))]
    ) -> dict[str, Any]:
        """Lift the watch's pause on one kind. Owner only, audited, applied on the next send."""
        if body.kind not in KINDS:
            raise HTTPException(
                status_code=404,
                detail={"code": "not_a_kind", "message": "There is no mail of that kind."},
            )
        moment = datetime.now(UTC)
        try:
            lifted = respond.unpause(
                body.kind, actor=ctx.admin.subject_id, note=body.note, at=moment
            )
        except Exception as exc:  # noqa: BLE001 — the dial could not be written; say so plainly
            raise HTTPException(
                status_code=503,
                detail={"code": "not_saved", "message": "The dial could not be written."},
            ) from exc
        if not lifted:
            raise HTTPException(
                status_code=409,
                detail={"code": "not_paused", "message": "That kind is not paused."},
            )
        ctx.audit(
            "mail.unpause",
            resource_type="ops.settings",
            resource_id=body.kind,
            detail={"note": body.note},
        )
        return {"saved": True, **desk_view(moment)}

    app.include_router(router)


__all__ = [
    "SOFT_AUTH_PATHS",
    "WATCH_PATH",
    "desk_view",
    "register_mail_desk",
    "register_mail_watch",
    "run_watch",
]
