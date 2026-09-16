"""QUEUE AND POST: the order posts leave in, and the two rules no dial can turn off.

``docs/GROWTH-DESK.md`` sections 3 and 4.3.

**Rule one: publish, then syndicate.** A piece's posts are staged together, but only the origin
may move. Every other post is :data:`~.store.HELD` until the origin has been posted AND seen
indexed (:mod:`.indexing`), and the check is made again at the moment of posting, not only at
release, so a post that was released by any other route still cannot leave early.
:func:`origin_is_live` is the one question, and nothing in this file posts a copy without asking it.

**The stamps follow the page, not the file.** The blog poster writes a file, and the file goes live
only with the next deploy of the site (and a redeploy of a disk that is wiped can lose it again).
So a written file is a posted campaign and nothing more: the piece is stamped published only when
:func:`page_is_up` has seen its address answer with its own canonical, an indexed mark is refused
while the address does not answer, and every release and every copy asks the address again. A page
that has gone is posted again under a fresh attempt (:func:`repost_origin`); the finished row
stays as it was.

**Rule two: a measured pace behind the quality gate.** A piece that did not pass
:func:`.piece.check` is never staged at all. A staged post leaves only while the kill switch is on,
only under its channel's daily cadence, and never for a topic that has been switched off. The
origin's cadence has a ceiling no dial can raise (:data:`.settings.BLOG_CEILING`).

**Who sends.** Tier 1 posts itself once approved (and approval is required for every post until
the owner turns the dial). Tier 2 is released into the person's queue and waits for a person to
say it was sent. Tier 3 never reaches this file: :func:`stage` refuses a post naming Reddit or
Quora before it writes anything.
"""

from __future__ import annotations

import dataclasses
import logging
import re
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from wobo_gateway.growth import campaigns, channels, posters, settings
from wobo_gateway.growth import store as store_mod
from wobo_gateway.growth.piece import Piece, Verdict
from wobo_gateway.growth.shapes import Built, Post, origin_url
from wobo_gateway.growth.store import (
    APPROVED,
    AWAITING,
    FAILED,
    FINAL,
    HELD,
    POSTED,
    QUEUED_FOR_PERSON,
    SENT_BY_PERSON,
    WITHDRAWN,
    PieceRow,
    PostRow,
)

logger = logging.getLogger("wobo.gateway.growth.outbox")

WAITING_FOR_ORIGIN = "waiting for the blog post to be published and indexed first"
ORIGIN_GONE = "waiting: the blog post does not answer at its address"
_PAGE_TIMEOUT_S = 15.0
_PAGE_BYTES = 256_000

#: GET an address and hand back its status and the start of its HTML. A test hands in a recording.
PageReader = Callable[[str], tuple[int, str]]
_page_reader: PageReader | None = None


class Refused(ValueError):
    """A move this file will not make, in words for the desk."""


def _now(now: datetime | None) -> datetime:
    return (now or datetime.now(UTC)).astimezone(UTC)


def _store() -> store_mod.GrowthStore:
    return store_mod.get_store()


# --- the live page -------------------------------------------------------------------------------
def _read_page(url: str) -> tuple[int, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "wobo-growth-desk"})
    try:
        with urllib.request.urlopen(request, timeout=_PAGE_TIMEOUT_S) as response:  # noqa: S310
            return response.status, response.read(_PAGE_BYTES).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, ""


def set_page_reader(reader: PageReader | None) -> None:
    """Test seam: how the outbox reads the site. ``None`` puts the network back."""
    global _page_reader
    _page_reader = reader


_LINK = re.compile(r"<link\b[^>]*>", re.I)


def page_is_up(url: str) -> bool:
    """The address answers 200 with this post's own canonical on it.

    The canonical is the proof it is this post and not a fallback page: a site that answers every
    address with its shell would otherwise read as live for a file that was never deployed.
    """
    try:
        status, html = (_page_reader or _read_page)(url)
    except Exception as exc:  # noqa: BLE001 — an address we cannot reach is not live
        logger.info("growth: the page %s could not be read (%s)", url, exc)
        return False
    if status != 200:
        return False
    for tag in _LINK.findall(html or ""):
        rel = re.search(r"""\brel\s*=\s*["']?canonical\b""", tag, re.I)
        href = re.search(r"""\bhref\s*=\s*["']([^"']+)["']""", tag, re.I)
        if rel and href and href.group(1).strip() == url:
            return True
    return False


class _Seen:
    """One pass asks each address once."""

    def __init__(self) -> None:
        self._known: dict[str, bool] = {}

    def up(self, piece: PieceRow | None) -> bool:
        if piece is None or not piece.origin_url:
            return False
        if piece.origin_url not in self._known:
            self._known[piece.origin_url] = page_is_up(piece.origin_url)
        return self._known[piece.origin_url]


def _origin_posted(slug: str) -> bool:
    return any(
        p.channel == channels.ORIGIN and p.status == POSTED for p in _store().posts(piece_slug=slug)
    )


def confirm_published(*, now: datetime | None = None, seen: _Seen | None = None) -> list[str]:
    """Stamp published every piece whose blog file was posted and whose page now answers."""
    moment = _now(now)
    seen = seen or _Seen()
    stamped: list[str] = []
    for piece in _store().pieces():
        if not piece.publishable or piece.published_at is not None:
            continue
        if not _origin_posted(piece.slug) or not seen.up(piece):
            continue
        piece.published_at = moment
        _store().upsert_piece(piece)
        stamped.append(piece.slug)
    return stamped


# --- staging -------------------------------------------------------------------------------------
def stage(
    piece: Piece,
    verdict: Verdict,
    built: Built,
    *,
    now: datetime | None = None,
    dials: settings.Settings | None = None,
) -> dict[str, Any]:
    """Keep the piece, and stage its posts if and only if it passed the gate."""
    moment = _now(now)
    dials = dials or settings.current()
    for post in built.posts:
        channels.refuse(post.channel)
    row = PieceRow(
        slug=piece.slug,
        topic_slug=piece.topic_slug,
        title=piece.title,
        drafted_on=piece.drafted_on,
        publishable=verdict.publishable,
        verdict={**verdict.as_dict(), "owed": dict(built.owed)},
        body=piece.as_dict(),
        origin_url=origin_url(piece.slug),
    )
    existing = _store().piece(piece.slug)
    if existing is not None:
        row.published_at = existing.published_at
        row.indexed_at = existing.indexed_at
        row.index_evidence = existing.index_evidence
    _store().upsert_piece(row)
    if not verdict.publishable:
        return {"slug": piece.slug, "staged": 0, "publishable": False}
    rows: list[PostRow] = []
    for post in built.posts:
        parsed = campaigns.parse(post.campaign_id)
        if post.channel == channels.ORIGIN:
            status = AWAITING if dials.needs_approval(post.channel) else APPROVED
            error = None
        else:
            status, error = HELD, WAITING_FOR_ORIGIN
        rows.append(
            PostRow(
                id=post.campaign_id,
                piece_slug=piece.slug,
                shape=post.kind,
                channel=post.channel,
                tier=channels.tier_of(post.channel).value,
                month=parsed.month,
                attempt=parsed.attempt,
                status=status,
                body=post.as_dict(),
                error=error,
                created_at=moment,
            )
        )
    added = _store().add_posts(rows)
    return {"slug": piece.slug, "staged": added, "publishable": True}


# --- the origin rule -----------------------------------------------------------------------------
def origin_is_live(piece: PieceRow | None) -> bool:
    """Posted, and seen indexed. Both, and in that order."""
    return bool(
        piece is not None
        and piece.published_at is not None
        and piece.indexed_at is not None
        and piece.indexed_at >= piece.published_at
    )


def record_indexed(slug: str, evidence: dict[str, Any], *, now: datetime | None = None) -> PieceRow:
    found = _store().piece(slug)
    if found is None:
        raise Refused("there is no such piece")
    if found.published_at is None:
        raise Refused("the blog post has not been published, so it cannot be indexed")
    if not evidence:
        raise Refused("an indexed page needs evidence of how it was seen")
    if not page_is_up(found.origin_url or origin_url(found.slug)):
        raise Refused(
            "the blog post is not live at its address, so it cannot be indexed: deploy the site, "
            "or post it again"
        )
    found.indexed_at = _now(now)
    found.index_evidence = dict(evidence)
    _store().upsert_piece(found)
    return found


def repost_origin(
    slug: str,
    *,
    actor: str | None,
    now: datetime | None = None,
    dials: settings.Settings | None = None,
) -> PostRow:
    """Post a blog file again, under the next attempt, when its page no longer answers.

    The first campaign row is finished and stays as it was; the new row carries the same words.
    """
    found = _store().piece(slug)
    if found is None:
        raise Refused("there is no such piece")
    if not found.publishable:
        raise Refused("this piece did not pass the gate, so it has no blog post")
    origins = sorted(
        (p for p in _store().posts(piece_slug=slug) if p.channel == channels.ORIGIN),
        key=lambda p: p.attempt,
    )
    if any(p.status in (AWAITING, APPROVED) for p in origins):
        raise Refused("a blog post for this piece is already waiting to go")
    last = next((p for p in reversed(origins) if p.status in (POSTED, FAILED)), None)
    if last is None:
        raise Refused("the blog post has not been posted, so there is nothing to post again")
    if page_is_up(found.origin_url or origin_url(slug)):
        raise Refused("the blog post is answering at its address, so it stays as it is")
    moment = _now(now)
    dials = dials or settings.current()
    status = AWAITING if dials.needs_approval(channels.ORIGIN) else APPROVED
    attempt = max(p.attempt for p in origins) + 1
    campaign = campaigns.build(channels.ORIGIN, slug, attempt=attempt, when=moment)
    body = Post.from_dict(last.body)
    post = dataclasses.replace(body, campaign_id=campaign)
    parsed = campaigns.parse(campaign)
    row = PostRow(
        id=campaign,
        piece_slug=slug,
        shape=last.shape,
        channel=channels.ORIGIN,
        tier=last.tier,
        month=parsed.month,
        attempt=parsed.attempt,
        status=status,
        body=post.as_dict(),
        approved_by=actor if status == APPROVED else None,
        approved_at=moment if status == APPROVED else None,
        created_at=moment,
    )
    if _store().add_posts([row]) != 1:
        raise Refused("that attempt already exists")
    return row


def check_indexing(*, now: datetime | None = None, transport: Any = None) -> dict[str, Any]:
    """Ask Search Console about every published origin not yet seen indexed."""
    from wobo_gateway.growth import indexing

    if not indexing.configured():
        return {"checked": 0, "indexed": 0, "because": "Search Console is not configured"}
    checked = indexed = 0
    for piece in _store().pieces():
        if piece.published_at is None or piece.indexed_at is not None:
            continue
        checked += 1
        try:
            found = indexing.inspect(piece.origin_url, transport=transport)
        except Exception as exc:  # noqa: BLE001 — one page failing is not the pass failing
            logger.warning("growth: inspection failed for %s (%s)", piece.slug, exc)
            continue
        if found.indexed:
            record_indexed(piece.slug, found.evidence(), now=now)
            indexed += 1
    return {"checked": checked, "indexed": indexed}


def release(
    *,
    now: datetime | None = None,
    dials: settings.Settings | None = None,
    seen: _Seen | None = None,
) -> int:
    """Move every held copy of a live origin onward. Returns how many moved."""
    dials = dials or settings.current()
    seen = seen or _Seen()
    moved = 0
    by_slug = {p.slug: p for p in _store().pieces()}
    for post in _store().posts():
        if post.status != HELD or post.channel == channels.ORIGIN:
            continue
        origin = by_slug.get(post.piece_slug)
        if not origin_is_live(origin) or not seen.up(origin):
            continue
        if channels.needs_a_person(post.channel):
            status = QUEUED_FOR_PERSON
        else:
            status = AWAITING if dials.needs_approval(post.channel) else APPROVED
        _store().update_post(post.id, {"status": status, "released_at": _now(now), "error": None})
        moved += 1
    return moved


# --- a person's moves ----------------------------------------------------------------------------
def _post(campaign_id: str) -> PostRow:
    if not campaigns.is_well_formed(campaign_id):
        raise Refused("that is not a campaign id")
    for post in _store().posts():
        if post.id == campaign_id:
            return post
    raise Refused("there is no such post")


def approve(campaign_id: str, *, actor: str | None, now: datetime | None = None) -> PostRow:
    post = _post(campaign_id)
    if post.status != AWAITING:
        raise Refused(
            WAITING_FOR_ORIGIN
            if post.status == HELD
            else f"this post is {post.status}, not waiting"
        )
    if not channels.may_a_script_post(post.channel):
        raise Refused("a person sends this one; mark it sent instead")
    updated = _store().update_post(
        campaign_id, {"status": APPROVED, "approved_by": actor, "approved_at": _now(now)}
    )
    assert updated is not None
    return updated


def mark_sent(
    campaign_id: str, *, actor: str | None, reference: str, now: datetime | None = None
) -> PostRow:
    post = _post(campaign_id)
    if post.status != QUEUED_FOR_PERSON:
        raise Refused(
            WAITING_FOR_ORIGIN
            if post.status == HELD
            else "only a post in the person's queue is marked sent"
        )
    updated = _store().update_post(
        campaign_id,
        {
            "status": SENT_BY_PERSON,
            "approved_by": actor,
            "posted_at": _now(now),
            "external_ref": reference.strip()[:300] or None,
        },
    )
    assert updated is not None
    return updated


def withdraw(campaign_id: str, *, actor: str | None, now: datetime | None = None) -> PostRow:
    post = _post(campaign_id)
    if post.status in FINAL:
        raise Refused(f"this post is already {post.status}")
    updated = _store().update_post(
        campaign_id, {"status": WITHDRAWN, "approved_by": actor, "approved_at": _now(now)}
    )
    assert updated is not None
    return updated


# --- posting -------------------------------------------------------------------------------------
def _posted_today(rows: list[PostRow], channel_key: str, moment: datetime) -> int:
    day = moment.date()
    return sum(
        1
        for r in rows
        if r.channel == channel_key
        and r.status == POSTED
        and r.posted_at is not None
        and r.posted_at.astimezone(UTC).date() == day
    )


def run(*, now: datetime | None = None, dials: settings.Settings | None = None) -> dict[str, Any]:
    """One pass: check indexing, release, then post what is approved, at the pace allowed."""
    moment = _now(now)
    dials = dials or settings.current(fresh=True)
    report: dict[str, Any] = {"running": dials.running, "posted": [], "waiting": [], "failed": []}
    if not dials.running:
        report["because"] = (
            "the kill switch is off" if dials.readable else "the dials could not be read"
        )
        return report
    seen = _Seen()
    report["published"] = confirm_published(now=moment, seen=seen)
    report["indexing"] = check_indexing(now=moment)
    report["released"] = release(now=moment, dials=dials, seen=seen)
    rows = _store().posts()
    by_slug = {p.slug: p for p in _store().pieces()}
    for post in sorted(rows, key=lambda r: (r.created_at or moment, r.id)):
        if post.status != APPROVED or not channels.may_a_script_post(post.channel):
            continue
        piece = by_slug.get(post.piece_slug)
        if piece is None or not piece.publishable:
            continue
        if piece.topic_slug in dials.topics_off:
            report["waiting"].append({"id": post.id, "because": "its topic is switched off"})
            continue
        if post.channel != channels.ORIGIN and not origin_is_live(piece):
            report["waiting"].append({"id": post.id, "because": WAITING_FOR_ORIGIN})
            continue
        if post.channel != channels.ORIGIN and not seen.up(piece):
            report["waiting"].append({"id": post.id, "because": ORIGIN_GONE})
            continue
        allowed = min(
            dials.per_day(post.channel),
            settings.BLOG_CEILING if post.channel == channels.ORIGIN else settings.CHANNEL_CEILING,
        )
        if _posted_today(rows, post.channel, moment) >= allowed:
            report["waiting"].append({"id": post.id, "because": "today's cadence is used"})
            continue
        try:
            reference = posters.poster_for(post.channel).post(Post.from_dict(post.body))
        except (posters.NotConfigured, posters.NotWired) as waiting:
            _store().update_post(post.id, {"error": str(waiting)})
            report["waiting"].append({"id": post.id, "because": str(waiting)})
            continue
        except posters.PostFailed as failed:
            _store().update_post(post.id, {"status": FAILED, "error": str(failed)})
            report["failed"].append({"id": post.id, "because": str(failed)})
            continue
        _store().update_post(
            post.id,
            {"status": POSTED, "posted_at": moment, "external_ref": reference, "error": None},
        )
        post.status, post.posted_at = POSTED, moment
        # Written is not published. The page is asked now, fresh, and again on every pass.
        if (
            post.channel == channels.ORIGIN
            and piece.published_at is None
            and page_is_up(piece.origin_url or origin_url(piece.slug))
        ):
            piece.published_at = moment
            _store().upsert_piece(piece)
            report["published"].append(piece.slug)
        report["posted"].append({"id": post.id, "reference": reference})
    return report


__all__ = [
    "ORIGIN_GONE",
    "WAITING_FOR_ORIGIN",
    "PageReader",
    "Refused",
    "approve",
    "check_indexing",
    "confirm_published",
    "mark_sent",
    "origin_is_live",
    "page_is_up",
    "record_indexed",
    "release",
    "repost_origin",
    "run",
    "set_page_reader",
    "stage",
    "withdraw",
]
