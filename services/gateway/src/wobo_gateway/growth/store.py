"""What the growth desk keeps: pieces, posts under their campaign ids, the day's signals, and the
one column on an account. Migration 0038.

=====================  ===================================================================
``growth.pieces``      one source piece per slug: its body, its verdict, when the origin
                       went up and when it was seen indexed
``growth.campaigns``   one row per post, keyed on its campaign id, which is minted once and
                       never renamed, re-pointed or deleted; only its status moves
``growth.signals``     what the gather step read that is not a file: Search Console's near
                       misses, how often our learners were served a concept, a person's notes
``growth.signups``     a view: sign-ups per campaign id, counted from the accounts
``learner.profiles_cache.campaign_id``  written by the gateway, once, and never by a learner
=====================  ===================================================================

**No person is in any of it.** A signal is a query, a page or a concept with a count beside it; a
campaign is a piece of ours on a channel; the account column names a piece, not a visitor. The
sign-up view returns counts and nothing that could be joined back to a child.

A project store that cannot be reached raises :class:`StoreUnavailable`, and every caller turns
that into "not saved" or "could not be read" on the desk, never into zeroes.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Protocol

logger = logging.getLogger("wobo.gateway.growth.store")

SCHEMA = "growth"
PIECES = "pieces"
CAMPAIGNS = "campaigns"
SIGNALS = "signals"
SIGNUPS = "signups"

# The life of a post. Migration 0038 checks the same list.
DRAFTED = "drafted"
AWAITING = "awaiting_approval"
APPROVED = "approved"
POSTED = "posted"
QUEUED_FOR_PERSON = "queued_for_person"
SENT_BY_PERSON = "sent_by_person"
HELD = "held"
FAILED = "failed"
WITHDRAWN = "withdrawn"
STATUSES: tuple[str, ...] = (
    DRAFTED,
    AWAITING,
    APPROVED,
    POSTED,
    QUEUED_FOR_PERSON,
    SENT_BY_PERSON,
    HELD,
    FAILED,
    WITHDRAWN,
)
#: A post in one of these is finished and never moves again.
FINAL: frozenset[str] = frozenset({POSTED, SENT_BY_PERSON, WITHDRAWN})

SIGNAL_SOURCES: tuple[str, ...] = ("search-console", "our-learners", "person")

#: Every column the store writes on a post. The table adds nothing but its timestamps.
CAMPAIGN_COLUMNS: tuple[str, ...] = (
    "id",
    "piece_slug",
    "shape",
    "channel",
    "tier",
    "month",
    "attempt",
    "status",
    "body",
    "approved_by",
    "approved_at",
    "released_at",
    "posted_at",
    "external_ref",
    "error",
)
PIECE_COLUMNS: tuple[str, ...] = (
    "slug",
    "topic_slug",
    "title",
    "drafted_on",
    "publishable",
    "verdict",
    "body",
    "origin_url",
    "published_at",
    "indexed_at",
    "index_evidence",
)
SIGNAL_COLUMNS: tuple[str, ...] = (
    "day",
    "source",
    "query",
    "page",
    "concept",
    "impressions",
    "clicks",
    "position",
    "count",
)

_HTTP_TIMEOUT_S = 10.0


class StoreUnavailable(Exception):
    """The project could not be read or written. Never read as "nothing there"."""


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def when(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


@dataclass
class PieceRow:
    slug: str
    topic_slug: str
    title: str
    drafted_on: str
    publishable: bool
    verdict: dict[str, Any] = field(default_factory=dict)
    body: dict[str, Any] = field(default_factory=dict)
    origin_url: str = ""
    published_at: datetime | None = None
    indexed_at: datetime | None = None
    index_evidence: dict[str, Any] = field(default_factory=dict)

    def wire(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "topic_slug": self.topic_slug,
            "title": self.title,
            "drafted_on": self.drafted_on,
            "publishable": self.publishable,
            "verdict": self.verdict,
            "body": self.body,
            "origin_url": self.origin_url or None,
            "published_at": _iso(self.published_at),
            "indexed_at": _iso(self.indexed_at),
            "index_evidence": self.index_evidence,
        }

    @classmethod
    def from_wire(cls, row: dict[str, Any]) -> PieceRow:
        return cls(
            slug=str(row.get("slug") or ""),
            topic_slug=str(row.get("topic_slug") or ""),
            title=str(row.get("title") or ""),
            drafted_on=str(row.get("drafted_on") or ""),
            publishable=bool(row.get("publishable")),
            verdict=row.get("verdict") if isinstance(row.get("verdict"), dict) else {},
            body=row.get("body") if isinstance(row.get("body"), dict) else {},
            origin_url=str(row.get("origin_url") or ""),
            published_at=when(row.get("published_at")) if row.get("published_at") else None,
            indexed_at=when(row.get("indexed_at")) if row.get("indexed_at") else None,
            index_evidence=(
                row.get("index_evidence") if isinstance(row.get("index_evidence"), dict) else {}
            ),
        )


@dataclass
class PostRow:
    id: str
    piece_slug: str
    shape: str
    channel: str
    tier: str
    month: str
    attempt: int
    status: str
    body: dict[str, Any] = field(default_factory=dict)
    approved_by: str | None = None
    approved_at: datetime | None = None
    released_at: datetime | None = None
    posted_at: datetime | None = None
    external_ref: str | None = None
    error: str | None = None
    created_at: datetime | None = None

    def wire(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "piece_slug": self.piece_slug,
            "shape": self.shape,
            "channel": self.channel,
            "tier": self.tier,
            "month": self.month,
            "attempt": self.attempt,
            "status": self.status,
            "body": self.body,
            "approved_by": self.approved_by,
            "approved_at": _iso(self.approved_at),
            "released_at": _iso(self.released_at),
            "posted_at": _iso(self.posted_at),
            "external_ref": self.external_ref,
            "error": self.error,
        }

    @classmethod
    def from_wire(cls, row: dict[str, Any]) -> PostRow:
        def moment(key: str) -> datetime | None:
            return when(row.get(key)) if row.get(key) else None

        return cls(
            id=str(row.get("id") or ""),
            piece_slug=str(row.get("piece_slug") or ""),
            shape=str(row.get("shape") or ""),
            channel=str(row.get("channel") or ""),
            tier=str(row.get("tier") or ""),
            month=str(row.get("month") or ""),
            attempt=int(row.get("attempt") or 1),
            status=str(row.get("status") or DRAFTED),
            body=row.get("body") if isinstance(row.get("body"), dict) else {},
            approved_by=row.get("approved_by"),
            approved_at=moment("approved_at"),
            released_at=moment("released_at"),
            posted_at=moment("posted_at"),
            external_ref=row.get("external_ref"),
            error=row.get("error"),
            created_at=moment("created_at"),
        )


@dataclass(frozen=True)
class Signal:
    """One thing the gather step read. A query, a page or a concept, and counts. No person."""

    day: str
    source: str
    query: str = ""
    page: str = ""
    concept: str = ""
    impressions: int = 0
    clicks: int = 0
    position: float | None = None
    count: int = 0

    def wire(self) -> dict[str, Any]:
        return {
            "day": self.day,
            "source": self.source,
            "query": self.query,
            "page": self.page,
            "concept": self.concept,
            "impressions": self.impressions,
            "clicks": self.clicks,
            "position": self.position,
            "count": self.count,
        }

    @classmethod
    def from_wire(cls, row: dict[str, Any]) -> Signal:
        position = row.get("position")
        return cls(
            day=str(row.get("day") or ""),
            source=str(row.get("source") or ""),
            query=str(row.get("query") or ""),
            page=str(row.get("page") or ""),
            concept=str(row.get("concept") or ""),
            impressions=int(row.get("impressions") or 0),
            clicks=int(row.get("clicks") or 0),
            position=float(position) if position is not None else None,
            count=int(row.get("count") or 0),
        )

    @property
    def natural_key(self) -> tuple[str, str, str, str, str]:
        return (self.day, self.source, self.query, self.page, self.concept)


class GrowthStore(Protocol):
    def upsert_piece(self, piece: PieceRow) -> None: ...
    def piece(self, slug: str) -> PieceRow | None: ...
    def pieces(self) -> list[PieceRow]: ...
    def add_posts(self, posts: Iterable[PostRow]) -> int: ...
    def update_post(self, campaign_id: str, changes: dict[str, Any]) -> PostRow | None: ...
    def posts(self, *, piece_slug: str | None = None) -> list[PostRow]: ...
    def add_signals(self, signals: Iterable[Signal]) -> int: ...
    def signals(self, *, since: str) -> list[Signal]: ...
    def signups(self) -> dict[str, int]: ...
    def attribute(self, subject_id: str, campaign_id: str) -> bool: ...


class InMemoryGrowthStore:
    """The suite's store and a local run's (``GROWTH_STORE=memory``)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pieces: dict[str, PieceRow] = {}
        self._posts: dict[str, PostRow] = {}
        self._signals: dict[tuple[str, str, str, str, str], Signal] = {}
        #: subject -> campaign id. What the account column holds.
        self.accounts: dict[str, str | None] = {}
        self._clock: Callable[[], datetime] = lambda: datetime.now(UTC)

    def upsert_piece(self, piece: PieceRow) -> None:
        with self._lock:
            self._pieces[piece.slug] = PieceRow.from_wire(piece.wire())

    def piece(self, slug: str) -> PieceRow | None:
        with self._lock:
            found = self._pieces.get(slug)
            return PieceRow.from_wire(found.wire()) if found else None

    def pieces(self) -> list[PieceRow]:
        with self._lock:
            return [PieceRow.from_wire(p.wire()) for p in self._pieces.values()]

    def add_posts(self, posts: Iterable[PostRow]) -> int:
        added = 0
        with self._lock:
            for post in posts:
                if post.id in self._posts:
                    continue  # a campaign id is minted once
                row = PostRow.from_wire(post.wire())
                row.created_at = self._clock()
                self._posts[post.id] = row
                added += 1
        return added

    def update_post(self, campaign_id: str, changes: dict[str, Any]) -> PostRow | None:
        immutable = {"id", "piece_slug", "shape", "channel", "month", "attempt"}
        if immutable & set(changes):
            raise StoreUnavailable("a campaign id, its piece and its channel never change")
        with self._lock:
            found = self._posts.get(campaign_id)
            if found is None:
                return None
            wire = found.wire()
            wire.update({k: _iso(v) if isinstance(v, datetime) else v for k, v in changes.items()})
            row = PostRow.from_wire(wire)
            row.created_at = found.created_at
            self._posts[campaign_id] = row
            return PostRow.from_wire({**row.wire(), "created_at": _iso(row.created_at)})

    def posts(self, *, piece_slug: str | None = None) -> list[PostRow]:
        with self._lock:
            rows = [
                PostRow.from_wire({**p.wire(), "created_at": _iso(p.created_at)})
                for p in self._posts.values()
                if piece_slug is None or p.piece_slug == piece_slug
            ]
        return rows

    def add_signals(self, signals: Iterable[Signal]) -> int:
        added = 0
        with self._lock:
            for signal in signals:
                if signal.natural_key in self._signals:
                    continue
                self._signals[signal.natural_key] = signal
                added += 1
        return added

    def signals(self, *, since: str) -> list[Signal]:
        with self._lock:
            return [s for s in self._signals.values() if s.day >= since]

    def signups(self) -> dict[str, int]:
        out: dict[str, int] = {}
        with self._lock:
            for campaign in self.accounts.values():
                if campaign:
                    out[campaign] = out.get(campaign, 0) + 1
        return out

    def attribute(self, subject_id: str, campaign_id: str) -> bool:
        with self._lock:
            if subject_id not in self.accounts or self.accounts[subject_id]:
                return False
            self.accounts[subject_id] = campaign_id
            return True


class UnconfiguredGrowthStore:
    """No project. Reads and writes refuse, and the desk says so."""

    def _refuse(self, *_: Any, **__: Any) -> Any:
        raise StoreUnavailable("no project is configured")

    upsert_piece = piece = pieces = add_posts = update_post = posts = _refuse
    add_signals = signals = signups = attribute = _refuse


Transport = Callable[..., tuple[int, Any]]


def _urllib(
    url: str, key: str, method: str, *, profile: str, body: Any = None, prefer: str = ""
) -> tuple[int, Any]:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Accept-Profile": profile,
        "Content-Profile": profile,
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode()
        return response.status, (json.loads(raw) if raw.strip() else [])


class PostgrestGrowthStore:
    """The project's tables over PostgREST with the service-role key. Server-side only."""

    PAGE = 1000

    def __init__(
        self, base_url: str, service_key: str, *, request: Transport | None = None
    ) -> None:
        self.base = base_url.rstrip("/")
        self.key = service_key
        self._request = request or _urllib

    def _call(
        self,
        table: str,
        method: str,
        params: dict[str, str] | None = None,
        *,
        body: Any = None,
        prefer: str = "",
        profile: str = SCHEMA,
    ) -> Any:
        query = f"?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}" if params else ""
        url = f"{self.base}/rest/v1/{table}{query}"
        try:
            _status, rows = self._request(
                url, self.key, method, profile=profile, body=body, prefer=prefer
            )
        except Exception as exc:  # noqa: BLE001 — one failure, told plainly
            raise StoreUnavailable(str(exc)) from exc
        return rows

    def _all(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        offset = 0
        while True:
            page = self._call(
                table, "GET", {**params, "limit": str(self.PAGE), "offset": str(offset)}
            )
            rows = page if isinstance(page, list) else []
            out.extend(r for r in rows if isinstance(r, dict))
            if len(rows) < self.PAGE:
                return out
            offset += self.PAGE

    def upsert_piece(self, piece: PieceRow) -> None:
        self._call(
            PIECES,
            "POST",
            {"on_conflict": "slug"},
            body=[piece.wire()],
            prefer="resolution=merge-duplicates,return=minimal",
        )

    def piece(self, slug: str) -> PieceRow | None:
        rows = self._call(PIECES, "GET", {"slug": f"eq.{slug}", "select": "*"})
        return PieceRow.from_wire(rows[0]) if isinstance(rows, list) and rows else None

    def pieces(self) -> list[PieceRow]:
        return [PieceRow.from_wire(r) for r in self._all(PIECES, {"select": "*", "order": "slug"})]

    def add_posts(self, posts: Iterable[PostRow]) -> int:
        body = [p.wire() for p in posts]
        if not body:
            return 0
        rows = self._call(
            CAMPAIGNS,
            "POST",
            {"on_conflict": "id"},
            body=body,
            prefer="resolution=ignore-duplicates,return=representation",
        )
        return len(rows) if isinstance(rows, list) else 0

    def update_post(self, campaign_id: str, changes: dict[str, Any]) -> PostRow | None:
        body = {k: _iso(v) if isinstance(v, datetime) else v for k, v in changes.items()}
        rows = self._call(
            CAMPAIGNS,
            "PATCH",
            {"id": f"eq.{campaign_id}"},
            body=body,
            prefer="return=representation",
        )
        return PostRow.from_wire(rows[0]) if isinstance(rows, list) and rows else None

    def posts(self, *, piece_slug: str | None = None) -> list[PostRow]:
        params = {"select": "*", "order": "created_at.asc"}
        if piece_slug:
            params["piece_slug"] = f"eq.{piece_slug}"
        return [PostRow.from_wire(r) for r in self._all(CAMPAIGNS, params)]

    def add_signals(self, signals: Iterable[Signal]) -> int:
        body = [s.wire() for s in signals]
        if not body:
            return 0
        rows = self._call(
            SIGNALS,
            "POST",
            {"on_conflict": "day,source,query,page,concept"},
            body=body,
            prefer="resolution=ignore-duplicates,return=representation",
        )
        return len(rows) if isinstance(rows, list) else 0

    def signals(self, *, since: str) -> list[Signal]:
        rows = self._all(SIGNALS, {"select": "*", "day": f"gte.{since}", "order": "day.asc"})
        return [Signal.from_wire(r) for r in rows]

    def signups(self) -> dict[str, int]:
        rows = self._all(SIGNUPS, {"select": "campaign_id,signups"})
        return {
            str(r["campaign_id"]): int(r.get("signups") or 0) for r in rows if r.get("campaign_id")
        }

    def attribute(self, subject_id: str, campaign_id: str) -> bool:
        """Write the account's campaign, only where it is empty. The trigger refuses a second
        value too, so a race between two requests still leaves the first one standing."""
        rows = self._call(
            "profiles_cache",
            "PATCH",
            {"subject_id": f"eq.{subject_id}", "campaign_id": "is.null"},
            body={"campaign_id": campaign_id},
            prefer="return=representation",
            profile="learner",
        )
        return bool(isinstance(rows, list) and rows)


_store: GrowthStore | None = None
_store_lock = threading.Lock()


def build_store() -> GrowthStore:
    if (os.getenv("GROWTH_STORE") or "").strip().lower() == "memory":
        return InMemoryGrowthStore()
    base = (os.getenv("SUPABASE_URL") or "").strip()
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or ""
    ).strip()
    if base and key:
        return PostgrestGrowthStore(base, key)
    logger.info("growth: no project configured; the desk reads as unavailable")
    return UnconfiguredGrowthStore()  # type: ignore[return-value]


def get_store() -> GrowthStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: GrowthStore | None) -> None:
    global _store
    with _store_lock:
        _store = store


__all__ = [
    "AWAITING",
    "APPROVED",
    "CAMPAIGN_COLUMNS",
    "DRAFTED",
    "FAILED",
    "FINAL",
    "HELD",
    "PIECE_COLUMNS",
    "POSTED",
    "QUEUED_FOR_PERSON",
    "SENT_BY_PERSON",
    "SIGNAL_COLUMNS",
    "SIGNAL_SOURCES",
    "STATUSES",
    "WITHDRAWN",
    "GrowthStore",
    "InMemoryGrowthStore",
    "PieceRow",
    "PostRow",
    "PostgrestGrowthStore",
    "Signal",
    "StoreUnavailable",
    "build_store",
    "get_store",
    "set_store",
    "when",
]
