"""The growth desk's doors: three cron passes, the console's Growth page, and the arrival.

* ``POST /v1/internal/growth/gather`` — the daily gather (:mod:`.gather`). Internal key.
* ``POST /v1/internal/growth/make``   — up to the day's pieces from the top of the ranking
  (:mod:`.make`), gated (:mod:`.piece`) and staged (:mod:`.outbox`). Internal key.
* ``POST /v1/internal/growth/post``   — indexing, release, and posting at the pace allowed. Key.
* ``GET  /v1/admin/growth``           — the desk, on the growth panel's read.
* ``POST /v1/admin/growth/...``       — the dials, approve, sent, withdraw, indexed, repost,
  notes. Every one is ``admin.manage`` (the owner, with a step-up) and a line in the console
  trail; the dials also land in ``ops.settings_audit`` by trigger.
* ``POST /v1/growth/arrival``         — the signed-in app hands over the ``utm_id`` it carried
  from the public site, once, right after sign-up. The gateway writes it on the account if the
  account is new and has none, and the app forgets it either way.

There is no route here, or anywhere, that names Reddit or Quora. The desk lists them with the
reason and nothing to press.
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from wobo_gateway.admin_auth import ADMIN_MANAGE, AdminContext, CanRead, admin_router, requires
from wobo_gateway.email import require_internal_key
from wobo_gateway.growth import (
    campaigns,
    channels,
    demand,
    gather,
    make,
    outbox,
    piece,
    posters,
    settings,
    shapes,
)
from wobo_gateway.growth import store as store_mod

logger = logging.getLogger("wobo.gateway.growth.api")

GATHER_PATH = "/v1/internal/growth/gather"
MAKE_PATH = "/v1/internal/growth/make"
POST_PATH = "/v1/internal/growth/post"
ARRIVAL_PATH = "/v1/growth/arrival"
SOFT_AUTH_PATHS = frozenset({GATHER_PATH, MAKE_PATH, POST_PATH})
#: An account older than this is not "at sign-up", and its attribution is not written.
ARRIVAL_WINDOW = timedelta(hours=24)
TOPICS_SHOWN = 25
POSTS_SHOWN = 200

#: Every write on the desk: the owner, with a step-up, and a line in the console trail.
Owner = Annotated[AdminContext, Depends(requires(ADMIN_MANAGE))]

_last_gather: dict[str, Any] | None = None
_gather_lock = threading.Lock()


def forget() -> None:
    global _last_gather
    with _gather_lock:
        _last_gather = None


def _moment(raw: str | None) -> datetime:
    if not raw:
        return datetime.now(UTC)
    try:
        found = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "bad_now"}) from exc
    if found.tzinfo is None:
        raise HTTPException(status_code=400, detail={"code": "bad_now"})
    return found.astimezone(UTC)


def _unavailable(exc: Exception) -> HTTPException:
    logger.warning("growth: store unavailable (%s)", exc)
    return HTTPException(
        status_code=503,
        detail={"code": "not_saved", "message": "The growth store could not be reached."},
    )


# --- the jobs -------------------------------------------------------------------------------------
def run_gather(now: datetime, *, notes: str = "") -> dict[str, Any]:
    global _last_gather
    result = gather.run(today=now.date(), person_notes=notes)
    with _gather_lock:
        _last_gather = {**result, "at": now.isoformat()}
    return result


def ranked_topics(limit: int) -> tuple[list[dict[str, Any]], str]:
    """The last gather's ranking, or the harvest's own when nothing has gathered yet."""
    with _gather_lock:
        last = _last_gather
    if last is not None:
        return list(last.get("topics") or [])[:limit], "the last gather"
    try:
        return [t.as_dict() for t in demand.rank(limit)], "the harvest alone, before any gather"
    except demand.DataUnavailable:
        return [], "no demand data is on disk"


def _topic_from(row: dict[str, Any]) -> demand.Topic:
    topic = demand.Topic(slug=str(row["slug"]), name=str(row["name"]))
    topic.placements = [
        demand.Node(
            board=p["board"],
            level=p["level"],
            subject=p["subject"],
            unit=p["unit"],
            name=p["name"],
            kind=p["kind"],
        )
        for p in row.get("placements") or []
    ]
    topic.demand = float(row.get("demand") or 0.0)
    return topic


def _published_of(row: store_mod.PieceRow) -> piece.Published:
    """A kept piece as the gate compares against it: its address and its paragraphs."""
    kept = piece.Piece(
        slug=row.slug,
        title=row.title,
        summary="",
        lead=str(row.body.get("lead") or ""),
        sections=[
            piece.Section(heading=str(s.get("heading") or ""), body=str(s.get("body") or ""))
            for s in row.body.get("sections") or []
            if isinstance(s, dict)
        ],
    )
    return piece.Published(slug=row.slug, fingerprints=kept.fingerprints())


#: The writer's calls in a day, per piece the day may make. A refused piece spends one as surely
#: as a passed one: it was paid for. With the pieces dial at its ceiling that is six calls a day.
WRITES_PER_PIECE = 2
#: A topic whose piece the gate refused is tried again after this many days, not used up for good.
RETRY_AFTER_DAYS = 7
ALLOWANCE_USED = "the day's writer allowance is used"


def _days_between(earlier: str, later: date) -> int:
    try:
        return (later - date.fromisoformat(earlier)).days
    except ValueError:
        return 0


def run_make(
    now: datetime, *, dials: settings.Settings | None = None, writer: Any = None
) -> dict[str, Any]:
    dials = dials or settings.current(fresh=True)
    report: dict[str, Any] = {"made": [], "owed": {}, "refused": {}}
    if not dials.running:
        report["because"] = (
            "the kill switch is off" if dials.readable else "the dials could not be read"
        )
        return report
    store = store_mod.get_store()
    existing = store.pieces()
    day = now.date()
    today = day.isoformat()
    pace = max(0, min(dials.pieces_daily, settings.PIECES_CEILING))
    made_today = sum(1 for p in existing if p.drafted_on == today and p.publishable)
    written_today = sum(1 for p in existing if p.drafted_on == today)
    budget = max(0, pace - made_today)
    writes_left = max(0, pace * WRITES_PER_PIECE - written_today)
    published = tuple(_published_of(p) for p in existing if p.publishable)
    # A passed piece is done. A refused one waits RETRY_AFTER_DAYS and is then written again, so a
    # topic is never spent for good on one bad draft, and never redrawn every day either.
    taken = {
        p.slug
        for p in existing
        if p.publishable or _days_between(p.drafted_on, day) < RETRY_AFTER_DAYS
    }
    calls = 0

    def counted(core: dict[str, Any], topic: demand.Topic) -> dict[str, Any] | None:
        # A live call that failed may still have been billed, so it counts; a keyless one did not.
        nonlocal calls
        words = (writer or make.write_words)(core, topic)
        if words or make.is_live():
            calls += 1
        return words

    rows, _source = ranked_topics(10_000)
    for row in rows:
        if budget <= 0:
            break
        if calls >= writes_left:
            report["because"] = ALLOWANCE_USED
            break
        slug = str(row.get("slug") or "")
        if not slug or slug in taken or slug in dials.topics_off:
            continue
        if any(piece.too_alike(slug, p.slug) for p in published):
            continue
        made = make.make(_topic_from(row), today=day, writer=counted)
        if made.piece is None:
            report["owed"][slug] = list(made.owed)
            if len(report["owed"]) >= 5:
                break
            continue
        verdict = piece.check(made.piece, published=published)
        built = shapes.posts_for(made.piece, when=now)
        outbox.stage(made.piece, verdict, built, now=now, dials=dials)
        taken.add(slug)
        if verdict.publishable:
            budget -= 1
            report["made"].append({"slug": slug, "posts": len(built.posts), "owed": built.owed})
        else:
            report["refused"][slug] = list(verdict.because)
    return report


# --- the desk -------------------------------------------------------------------------------------
def _family(path: str) -> str:
    parts = [p for p in (path or "/").split("/") if p]
    return f"/{parts[0]}" if parts else "/"


def desk_view(now: datetime) -> dict[str, Any]:
    dials = settings.current()
    view: dict[str, Any] = {
        "at": now.isoformat(),
        "dials": dials.as_dict(),
        "channels": [
            {
                "key": c.key,
                "name": c.name,
                "tier": c.tier.value,
                "because": c.because,
                "link_in_last_reply": c.link_in_last_reply,
                "canonical_back": c.canonical_back,
                "origin": c.is_origin,
            }
            for c in channels.CHANNELS
        ],
        "wiring": posters.wiring(),
        "sources": demand.sources(),
        "shapes": {k: list(v) for k, v in shapes.DESTINATIONS.items()},
        "gate": {
            "words": piece.WORD_FLOOR,
            "sections": piece.SECTION_FLOOR,
            "summary": [piece.SUMMARY_MIN, piece.SUMMARY_MAX],
        },
    }
    with _gather_lock:
        last = dict(_last_gather) if _last_gather else None
    view["gather"] = (
        {k: last[k] for k in ("at", "sources", "kept", "syllabus", "cores_known")} if last else None
    )
    topics, source = ranked_topics(TOPICS_SHOWN)
    view["topics"] = {"from": source, "rows": topics}
    try:
        view["demand"] = demand.counts()
    except demand.DataUnavailable as exc:
        view["demand"] = {"unavailable": str(exc)}
    store = store_mod.get_store()
    try:
        pieces = store.pieces()
        posts = store.posts()
        signups = store.signups()
        signals = store.signals(since=(now.date() - timedelta(days=gather.WINDOW_DAYS)).isoformat())
    except store_mod.StoreUnavailable as exc:
        view["store"] = {"readable": False, "because": str(exc)}
        return view
    view["store"] = {"readable": True}
    view["pieces"] = [
        {
            "slug": p.slug,
            "title": p.title,
            "drafted_on": p.drafted_on,
            "publishable": p.publishable,
            "because": list(p.verdict.get("because") or []),
            "owed": dict(p.verdict.get("owed") or {}),
            "origin_url": p.origin_url,
            "published_at": p.published_at.isoformat() if p.published_at else None,
            "indexed_at": p.indexed_at.isoformat() if p.indexed_at else None,
            "live": outbox.origin_is_live(p),
        }
        for p in sorted(pieces, key=lambda p: (p.drafted_on, p.slug), reverse=True)
    ]
    view["posts"] = [
        {
            "id": r.id,
            "piece": r.piece_slug,
            "shape": r.shape,
            "channel": r.channel,
            "tier": r.tier,
            "status": r.status,
            "error": r.error,
            "posted_at": r.posted_at.isoformat() if r.posted_at else None,
            "reference": r.external_ref,
            "title": str(r.body.get("title") or ""),
            "units": list(r.body.get("units") or []),
            "link": str(r.body.get("link") or ""),
        }
        for r in sorted(posts, key=lambda r: (r.created_at or now, r.id), reverse=True)[
            :POSTS_SHOWN
        ]
    ]
    counts: dict[str, int] = {}
    for r in posts:
        counts[r.status] = counts.get(r.status, 0) + 1
    families: dict[str, dict[str, int]] = {}
    for s in signals:
        if s.source != gather.SEARCH_CONSOLE:
            continue
        fam = families.setdefault(_family(s.page), {"impressions": 0, "clicks": 0})
        fam["impressions"] += s.impressions
        fam["clicks"] += s.clicks
    view["report"] = {
        "pieces_publishable": sum(1 for p in pieces if p.publishable),
        "origins_indexed": sum(1 for p in pieces if p.indexed_at is not None),
        "posts_by_status": counts,
        "search_by_family": families,
        "signups_by_campaign": dict(sorted(signups.items(), key=lambda kv: (-kv[1], kv[0]))),
        "signups": sum(signups.values()),
        "absent": {
            "cost_per_signup": (
                "not measured: the writer's spend is on the day's ledger under growth.write, "
                "and no piece carries its own cost yet"
            ),
            "answer_engines": (
                "not measured: nothing asks the answer engines whether they name us, and a "
                "person checking by hand is the honest way until something does"
            ),
        },
    }
    return view


# --- request bodies -------------------------------------------------------------------------------
class JobBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    now: str | None = Field(default=None, max_length=40)


class DialsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    running: bool | None = None
    cadence: dict[str, int] | None = None
    topics_off: list[str] | None = Field(default=None, max_length=2000)
    approval: str | None = Field(default=None, max_length=16)
    pieces_daily: int | None = None
    note: str | None = Field(default=None, max_length=280)


class CampaignBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    campaign_id: str = Field(min_length=10, max_length=campaigns.MAX_LENGTH)
    reference: str | None = Field(default=None, max_length=300)


class IndexedBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    note: str = Field(min_length=8, max_length=280)


class SlugBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class NotesBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=6, max_length=12_000)


class ArrivalBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    utm_id: str = Field(min_length=1, max_length=campaigns.MAX_LENGTH)


def _refused(exc: Exception) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": "refused", "message": str(exc)})


# --- mounting -------------------------------------------------------------------------------------
def register_growth_jobs(app: FastAPI) -> None:
    @app.post(GATHER_PATH, include_in_schema=False)
    def gather_job(request: Request, body: JobBody | None = None) -> dict[str, Any]:
        require_internal_key(request)
        now = _moment((body or JobBody()).now)
        return {"ok": True, **run_gather(now)}

    @app.post(MAKE_PATH, include_in_schema=False)
    def make_job(request: Request, body: JobBody | None = None) -> dict[str, Any]:
        require_internal_key(request)
        now = _moment((body or JobBody()).now)
        try:
            return {"ok": True, **run_make(now)}
        except store_mod.StoreUnavailable as exc:
            return {"ok": False, "error": "store_unavailable", "because": str(exc)}

    @app.post(POST_PATH, include_in_schema=False)
    def post_job(request: Request, body: JobBody | None = None) -> dict[str, Any]:
        require_internal_key(request)
        now = _moment((body or JobBody()).now)
        try:
            return {"ok": True, **outbox.run(now=now)}
        except store_mod.StoreUnavailable as exc:
            return {"ok": False, "error": "store_unavailable", "because": str(exc)}

    @app.post(ARRIVAL_PATH, include_in_schema=False)
    def arrival(request: Request, body: ArrivalBody) -> dict[str, Any]:
        """Once, at sign-up. Always answers 200 with whether it wrote: the app forgets the id
        either way, so there is nothing for it to retry and nothing for a stranger to learn."""
        principal = getattr(request.state, "principal", None)
        if principal is None or principal.anonymous or not principal.subject:
            raise HTTPException(status_code=401, detail={"code": "sign_in_required"})
        campaign = body.utm_id.strip()
        if not campaigns.is_well_formed(campaign):
            return {"written": False}
        from wobo_gateway import consent

        created = consent.account_created_at(str(principal.subject))
        if created is None or datetime.now(UTC) - created > ARRIVAL_WINDOW:
            return {"written": False}
        try:
            written = store_mod.get_store().attribute(str(principal.subject), campaign)
        except store_mod.StoreUnavailable:
            return {"written": False}
        return {"written": bool(written)}


def register_growth_desk(app: FastAPI) -> None:
    """AFTER ``register_admin``, behind the same guarded router as every desk."""
    router = admin_router(tags=["admin", "growth"])

    @router.get("/growth")
    def growth_desk(ctx: CanRead) -> dict[str, Any]:
        ctx.audit("console.growth.read", resource_type="growth")
        return desk_view(datetime.now(UTC))

    @router.post("/growth/dials")
    def growth_dials(body: DialsBody, ctx: Owner) -> dict[str, Any]:
        changes = {
            key: value
            for key, value in (
                (settings.RUNNING_KEY, body.running),
                (settings.CADENCE_KEY, body.cadence),
                (settings.TOPICS_OFF_KEY, body.topics_off),
                (settings.APPROVAL_KEY, body.approval),
                (settings.PIECES_KEY, body.pieces_daily),
            )
            if value is not None
        }
        try:
            settings.write(changes, actor=ctx.admin.subject_id, note=body.note)
        except (settings.BadSetting, channels.UnknownChannel, channels.NeverAutomated) as exc:
            raise HTTPException(
                status_code=422, detail={"code": "bad_dial", "message": str(exc)}
            ) from exc
        except Exception as exc:  # noqa: BLE001 — the dial could not be written; say so
            raise HTTPException(
                status_code=503,
                detail={"code": "not_saved", "message": "The dial could not be written."},
            ) from exc
        ctx.audit(
            "growth.dials",
            resource_type="ops.settings",
            resource_id=",".join(sorted(changes)),
            detail={"changes": changes, "note": body.note},
        )
        return {"saved": True, **desk_view(datetime.now(UTC))}

    def _move(action: str, body: CampaignBody, ctx: AdminContext) -> dict[str, Any]:
        actor = ctx.admin.subject_id
        try:
            if action == "approve":
                outbox.approve(body.campaign_id, actor=actor)
            elif action == "sent":
                outbox.mark_sent(body.campaign_id, actor=actor, reference=body.reference or "")
            else:
                outbox.withdraw(body.campaign_id, actor=actor)
        except outbox.Refused as exc:
            raise _refused(exc) from exc
        except store_mod.StoreUnavailable as exc:
            raise _unavailable(exc) from exc
        ctx.audit(
            f"growth.{action}",
            resource_type="growth.campaigns",
            resource_id=body.campaign_id,
            detail={"reference": body.reference} if body.reference else None,
        )
        return {"saved": True, **desk_view(datetime.now(UTC))}

    @router.post("/growth/approve")
    def growth_approve(body: CampaignBody, ctx: Owner) -> dict[str, Any]:
        return _move("approve", body, ctx)

    @router.post("/growth/sent")
    def growth_sent(body: CampaignBody, ctx: Owner) -> dict[str, Any]:
        return _move("sent", body, ctx)

    @router.post("/growth/withdraw")
    def growth_withdraw(body: CampaignBody, ctx: Owner) -> dict[str, Any]:
        return _move("withdraw", body, ctx)

    @router.post("/growth/indexed")
    def growth_indexed(body: IndexedBody, ctx: Owner) -> dict[str, Any]:
        try:
            outbox.record_indexed(
                body.slug, {"source": "person", "note": body.note, "by": ctx.admin.subject_id}
            )
        except outbox.Refused as exc:
            raise _refused(exc) from exc
        except store_mod.StoreUnavailable as exc:
            raise _unavailable(exc) from exc
        ctx.audit(
            "growth.indexed",
            resource_type="growth.pieces",
            resource_id=body.slug,
            detail={"note": body.note},
        )
        return {"saved": True, **desk_view(datetime.now(UTC))}

    @router.post("/growth/repost")
    def growth_repost(body: SlugBody, ctx: Owner) -> dict[str, Any]:
        """A blog post whose page has gone (a redeploy wiped the file) is posted again, under the
        next attempt. Refused while the page still answers."""
        try:
            row = outbox.repost_origin(body.slug, actor=ctx.admin.subject_id)
        except outbox.Refused as exc:
            raise _refused(exc) from exc
        except store_mod.StoreUnavailable as exc:
            raise _unavailable(exc) from exc
        ctx.audit(
            "growth.repost",
            resource_type="growth.campaigns",
            resource_id=row.id,
            detail={"slug": body.slug},
        )
        return {"saved": True, **desk_view(datetime.now(UTC))}

    @router.post("/growth/notes")
    def growth_notes(body: NotesBody, ctx: Owner) -> dict[str, Any]:
        found = gather.notes(body.text, day=date.today().isoformat())
        try:
            kept = store_mod.get_store().add_signals(found)
        except store_mod.StoreUnavailable as exc:
            raise _unavailable(exc) from exc
        ctx.audit("growth.notes", resource_type="growth.signals", detail={"questions": len(found)})
        return {"saved": True, "questions": len(found), "kept": kept}

    app.include_router(router)


__all__ = [
    "ARRIVAL_PATH",
    "ARRIVAL_WINDOW",
    "GATHER_PATH",
    "MAKE_PATH",
    "POST_PATH",
    "SOFT_AUTH_PATHS",
    "desk_view",
    "forget",
    "ranked_topics",
    "register_growth_desk",
    "register_growth_jobs",
    "run_gather",
    "run_make",
]
