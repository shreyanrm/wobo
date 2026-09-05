"""The parent link — invite, accept, decline, revoke (WOBO-PLAN §14 "the parent link", §14.1
"confirm everything"; docs/copy/help-centre/product-features/11-the-parent-link.md).

A learner types a parent's address on the You screen. The gateway writes one row in
``learner.parent_links`` (migration 0011) as ``invited``, mails the parent one invite in Wobo's
hand (``email_templates.parent_invite``) with two links, and nothing else ever goes to that
address until the parent taps once on the accept page. Then the row is ``linked`` and the Sunday
note job (:mod:`wobo_gateway.hospitality.jobs`) finds the family. Either side ends it: the learner
from the You screen (``DELETE /v1/me/parent-link``), the parent from "Not me" — and a revoked row
keeps no address, whoever ended it.

The routes:

* ``POST /v1/me/parent-invite`` ``{email, learner_name?, timezone?}`` — signed-in only; one
  active link per learner; the address is validated and never logged; the invite is sent once
  per link (the mail log's idempotency key names the link). The route is a mail sender that a
  signed-in stranger can point at any address, so it is bounded twice over: a few invites per
  learner per day (``PARENT_INVITES_PER_DAY``, counted on every row written in the last day,
  revoked or not), and never the same address twice in a day — revoke-and-invite-again is not a
  second mail. The learner's own address is refused outright.
* ``GET /v1/me/parent-link`` — the status for the You screen, with a line in Wobo's voice. This
  is also how the learner is told the address said it was not them: the row says ``revoked`` by
  ``parent``. An invite nobody answered within ``PARENT_INVITE_DAYS`` reads as ``expired`` here,
  and a fresh invite simply replaces it (the old row is ``revoked`` by ``expired``).
  TODO(web): the app has no in-app notice channel yet; the You screen reads this.
* ``DELETE /v1/me/parent-link`` — the learner ends it. Immediate: the invite token dies with it.
* ``GET/POST /v1/parent/accept?token=…`` and ``GET/POST /v1/parent/decline?token=…`` — no login.
  The token is signed by the gateway (the same key derivation as the stop token, under its own
  label), names the link and the learner, expires in fourteen days, and is single-use: its digest
  is on the row and emptied on first use. A GET only shows the page with one button — link
  prefetchers and mail scanners open every URL in a mail, and none of them may link a parent or
  end an invite; the POST behind the button does the thing.

Two stores behind one seam, exactly as :mod:`wobo_gateway.hospitality.preferences`: in memory for
the suite and a local run, PostgREST with the service-role key for the project. The address goes
to the store and to the provider and nowhere else: every log line carries ``email.to_hash``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import logging
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from urllib.parse import parse_qs, quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field

from wobo_gateway.email import send_email, to_hash
from wobo_gateway.email_templates import parent_route_url
from wobo_gateway.hospitality.tokens import stop_link

logger = logging.getLogger("wobo.gateway.parents")

APP_NAME = os.getenv("APP_NAME", "Wobo")

_HTTP_TIMEOUT_S = 5.0
_SCHEMA = "learner"
_TABLE = "parent_links"
_LABEL = b"wobo.parent.invite.v1"
_EMAIL_LABEL = b"wobo.parent.email.v1"
_DEFAULT_DAYS = 14
_DEFAULT_INVITES_PER_DAY = 3
_DAY = timedelta(hours=24)
_MAX_ID = 128
_MAX_NAME = 40

#: A subject or a link id reaches a PostgREST filter, so it is checked before it is interpolated
#: (the same rule as :mod:`wobo_gateway.memory`).
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
#: An address we can write to: no quoted local part, and a domain of dot-separated labels with
#: no empty label — ``a@b..com`` and ``a@.b.com`` are typos, not parents.
_EMAIL_RE = re.compile(r'^[^@\s"]+@[^@\s.]+(?:\.[^@\s.]+)+$')
#: A first name: letters, with at most one apostrophe or hyphen inside ("O'Brien", "Mary-Jane").
#: This reaches the subject line of a mail to a stranger, so it is a name and never a sentence.
_NAME_RE = re.compile(r"^[^\W\d_]+(?:['’-][^\W\d_]+)?$")
_TIMEZONE_RE = re.compile(r"^[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)*$")

STATUSES: tuple[str, ...] = ("invited", "linked", "revoked")
#: Who ended a link: the learner from the You screen, the parent from "Not me", or nobody —
#: an invite that ran out and was replaced.
ENDED_BY: tuple[str, ...] = ("learner", "parent", "expired")

#: The parent's pages need no session: the signed token is the whole authority (app.py lists
#: them as open paths, the way the stop link is). Every route here writes to the store or sends
#: mail, so all of them sit on the per-caller limiter.
OPEN_PATHS = frozenset({"/v1/parent/accept", "/v1/parent/decline"})
LIMITED_PATHS = OPEN_PATHS | {"/v1/me/parent-invite", "/v1/me/parent-link"}
Send = Callable[..., dict[str, Any]]


# --- the model ----------------------------------------------------------------------------------
@dataclass(frozen=True)
class ParentLink:
    """One row of ``learner.parent_links`` as the gateway reads and writes it."""

    id: str
    learner_id: str
    parent_email_hash: str
    parent_email: str | None
    learner_name: str | None
    timezone: str | None
    status: str
    invited_at: datetime
    linked_at: datetime | None = None
    revoked_at: datetime | None = None
    revoked_by: str | None = None
    invite_token_hash: str | None = None
    unsubscribe_url: str | None = None

    @property
    def active(self) -> bool:
        return self.status in ("invited", "linked")


def _when(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat() if value else None


def from_row(row: dict[str, Any]) -> ParentLink:
    """A database row, read tolerantly: a column we do not know is ignored."""
    status = str(row.get("status") or "invited")
    return ParentLink(
        id=str(row.get("id") or ""),
        learner_id=str(row.get("learner_id") or ""),
        parent_email_hash=str(row.get("parent_email_hash") or ""),
        parent_email=str(row["parent_email"]) if row.get("parent_email") else None,
        learner_name=str(row["learner_name"]) if row.get("learner_name") else None,
        timezone=str(row["timezone"]) if row.get("timezone") else None,
        status=status if status in STATUSES else "invited",
        invited_at=_when(row.get("invited_at")) or datetime.now(UTC),
        linked_at=_when(row.get("linked_at")),
        revoked_at=_when(row.get("revoked_at")),
        revoked_by=str(row["revoked_by"]) if row.get("revoked_by") else None,
        invite_token_hash=str(row["invite_token_hash"]) if row.get("invite_token_hash") else None,
        unsubscribe_url=str(row["unsubscribe_url"]) if row.get("unsubscribe_url") else None,
    )


def to_row(link: ParentLink) -> dict[str, Any]:
    return {
        "id": link.id,
        "learner_id": link.learner_id,
        "parent_email_hash": link.parent_email_hash,
        "parent_email": link.parent_email,
        "learner_name": link.learner_name,
        "timezone": link.timezone,
        "status": link.status,
        "invited_at": _iso(link.invited_at),
        "linked_at": _iso(link.linked_at),
        "revoked_at": _iso(link.revoked_at),
        "revoked_by": link.revoked_by,
        "invite_token_hash": link.invite_token_hash,
        "unsubscribe_url": link.unsubscribe_url,
    }


# --- what the learner typed ---------------------------------------------------------------------
class NotKept(ValueError):
    """A field we cannot keep. ``field`` names it; ``message`` is Wobo's."""

    def __init__(self, field_name: str, message: str) -> None:
        self.field = field_name
        self.message = message
        super().__init__(f"{field_name}: {message}")


def normalise_email(raw: Any) -> str:
    address = str(raw or "").strip().lower()
    if len(address) > 320 or not _EMAIL_RE.match(address):
        raise NotKept("email", "I need an email address I can write to")
    return address


def normalise_name(raw: Any) -> str | None:
    """A first name for the note ("Aanya's week"): the first word, short, letters only."""
    text = str(raw or "").strip()
    if not text:
        return None
    first = text.split()[0][:_MAX_NAME]
    if not _NAME_RE.match(first):
        raise NotKept("learner_name", "a first name is all I need here")
    return first


_zones: dict[str, str] | None = None
_zones_lock = threading.Lock()


def _canonical_zones() -> dict[str, str]:
    """Lower-cased zone name to the IANA spelling, built once. The zone is stored and read back
    by the Sunday job's calendar on a different host: macOS resolves ``asia/kolkata``, Linux does
    not, so what the row keeps is always the canonical key."""
    global _zones
    if _zones is None:
        with _zones_lock:
            if _zones is None:
                _zones = {name.lower(): name for name in available_timezones()}
    return _zones


def normalise_timezone(raw: Any) -> str | None:
    name = str(raw or "").strip()
    if not name:
        return None
    if not _TIMEZONE_RE.match(name):
        raise NotKept("timezone", "I need the timezone by its name, like Asia/Kolkata")
    canonical = _canonical_zones().get(name.lower())
    if canonical is None:
        # No zone database to canonicalise against (a slim image): the name must resolve as typed.
        try:
            ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise NotKept("timezone", "I do not know that timezone") from exc
        return name
    return canonical


def mask_email(address: str) -> str:
    """``a***@example.test`` — enough for the learner to recognise what they typed, not enough
    for a shared screen to read it back."""
    local, _, domain = address.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


# --- the signed invite token -------------------------------------------------------------------
def _secret(label: bytes = _LABEL) -> bytes | None:
    """The signing key: ``MAIL_TOKEN_SECRET`` outright, else derived from ``SUPABASE_JWT_SECRET``
    under this module's own label — a different key for a different job, exactly as the stop
    token derives its own (hospitality/tokens.py). With neither, no invite can be minted."""
    explicit = (os.getenv("MAIL_TOKEN_SECRET") or "").strip()
    if explicit:
        return hmac.new(explicit.encode(), label, hashlib.sha256).digest()
    jwt_secret = (os.getenv("SUPABASE_JWT_SECRET") or "").strip()
    if jwt_secret:
        return hmac.new(jwt_secret.encode(), label, hashlib.sha256).digest()
    return None


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes | None:
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (ValueError, TypeError):
        return None


def _sign(payload: bytes, secret: bytes) -> bytes:
    return hmac.new(secret, payload, hashlib.sha256).digest()


def signing_available() -> bool:
    return _secret() is not None


def email_hash(address: str) -> str | None:
    """A keyed one-way digest of the address for the row: unlinkable by a reader of the table,
    stable for the gateway. ``None`` without a key — and then no invite is sent either."""
    secret = _secret(_EMAIL_LABEL)
    if secret is None:
        return None
    return hmac.new(secret, address.strip().lower().encode(), hashlib.sha256).hexdigest()


def token_hash(token: str) -> str:
    """What the row keeps of an outstanding token: its SHA-256, compared in constant time."""
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True)
class InviteClaim:
    link_id: str
    learner_id: str


def invite_token(link_id: str, learner_id: str, *, issued: datetime | None = None) -> str | None:
    secret = _secret()
    if not secret or not link_id or not learner_id:
        return None
    if len(link_id) > _MAX_ID or len(learner_id) > _MAX_ID:
        return None
    when = (issued or datetime.now(UTC)).astimezone(UTC)
    payload = json.dumps(
        {"p": link_id, "l": learner_id, "t": int(when.timestamp())}, separators=(",", ":")
    ).encode()
    return f"{_b64(payload)}.{_b64(_sign(payload, secret))}"


def parse_invite_token(token: str | None, *, now: datetime | None = None) -> InviteClaim | None:
    """The claim a token carries, or ``None`` for anything we did not sign or that has aged out.
    Constant-time on the signature; every other failure is a shape problem."""
    secret = _secret()
    if not secret or not token or token.count(".") != 1 or len(token) > 1024:
        return None
    encoded_payload, encoded_sig = token.split(".", 1)
    payload, signature = _unb64(encoded_payload), _unb64(encoded_sig)
    if payload is None or signature is None:
        return None
    if not hmac.compare_digest(signature, _sign(payload, secret)):
        return None
    try:
        claims: Any = json.loads(payload.decode())
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(claims, dict):
        return None
    link_id, learner_id, issued = claims.get("p"), claims.get("l"), claims.get("t")
    if not isinstance(link_id, str) or not isinstance(learner_id, str):
        return None
    if not isinstance(issued, int) or not _ID_RE.match(link_id) or not _ID_RE.match(learner_id):
        return None
    current = (now or datetime.now(UTC)).astimezone(UTC)
    age_days = (current.timestamp() - issued) / 86400
    if age_days < -1 or age_days > invite_days():  # a day of skew forwards; the window backwards
        return None
    return InviteClaim(link_id=link_id, learner_id=learner_id)


def invite_days() -> int:
    """How long an invite stays open: the token's window and the row's, one number."""
    try:
        return max(1, int(os.getenv("PARENT_INVITE_DAYS") or _DEFAULT_DAYS))
    except ValueError:
        return _DEFAULT_DAYS


def invites_per_day() -> int:
    try:
        return max(1, int(os.getenv("PARENT_INVITES_PER_DAY") or _DEFAULT_INVITES_PER_DAY))
    except ValueError:
        return _DEFAULT_INVITES_PER_DAY


def expired(link: ParentLink, now: datetime) -> bool:
    """An invite nobody answered inside the window. Its token is already dead
    (:func:`parse_invite_token` uses the same number); this is the row catching up."""
    return link.status == "invited" and now - link.invited_at > timedelta(days=invite_days())


def accept_url(token: str) -> str:
    return f"{parent_route_url('accept')}?token={quote(token, safe='')}"


def decline_url(token: str) -> str:
    return f"{parent_route_url('decline')}?token={quote(token, safe='')}"


# --- the store seam -----------------------------------------------------------------------------
class StoreUnavailable(Exception):
    """The links could not be reached. Callers say so; they never invent a family."""


class ParentLinkStore(Protocol):
    def active(self, learner_id: str) -> ParentLink | None: ...

    def latest(self, learner_id: str) -> ParentLink | None: ...

    def recent(self, learner_id: str, *, since: datetime) -> list[ParentLink]: ...

    def get(self, link_id: str) -> ParentLink | None: ...

    def insert(self, link: ParentLink) -> ParentLink: ...

    def update(self, link_id: str, fields: dict[str, Any]) -> ParentLink | None: ...

    def delete(self, link_id: str) -> bool: ...

    def linked(self) -> list[ParentLink]: ...

    def by_email_hash(self, digest: str) -> list[ParentLink]: ...


class InMemoryParentLinkStore:
    """The suite's store, and a local run without a project."""

    def __init__(self) -> None:
        self.rows: dict[str, ParentLink] = {}
        self._lock = threading.Lock()

    def _of(self, learner_id: str) -> list[ParentLink]:
        mine = [r for r in self.rows.values() if r.learner_id == learner_id]
        return sorted(mine, key=lambda r: r.invited_at, reverse=True)

    def active(self, learner_id: str) -> ParentLink | None:
        with self._lock:
            return next((r for r in self._of(learner_id) if r.active), None)

    def latest(self, learner_id: str) -> ParentLink | None:
        with self._lock:
            mine = self._of(learner_id)
            return mine[0] if mine else None

    def recent(self, learner_id: str, *, since: datetime) -> list[ParentLink]:
        floor = since.astimezone(UTC)
        with self._lock:
            return [r for r in self._of(learner_id) if r.invited_at >= floor]

    def get(self, link_id: str) -> ParentLink | None:
        with self._lock:
            return self.rows.get(link_id)

    def insert(self, link: ParentLink) -> ParentLink:
        with self._lock:
            if any(r.active for r in self._of(link.learner_id)) and link.active:
                raise StoreUnavailable("one active link per learner")  # the unique index
            self.rows[link.id] = link
            return link

    def update(self, link_id: str, fields: dict[str, Any]) -> ParentLink | None:
        with self._lock:
            current = self.rows.get(link_id)
            if current is None:
                return None
            updated = from_row({**to_row(current), **fields})
            self.rows[link_id] = updated
            return updated

    def delete(self, link_id: str) -> bool:
        with self._lock:
            return self.rows.pop(link_id, None) is not None

    def linked(self) -> list[ParentLink]:
        with self._lock:
            return [r for r in self.rows.values() if r.status == "linked"]

    def by_email_hash(self, digest: str) -> list[ParentLink]:
        with self._lock:
            return [r for r in self.rows.values() if r.parent_email_hash == digest and r.active]

    def forget(self, learner_id: str) -> int:
        """The erase path: every row of this learner's, gone. Returns how many."""
        with self._lock:
            mine = [k for k, r in self.rows.items() if r.learner_id == learner_id]
            for key in mine:
                del self.rows[key]
            return len(mine)


Request_ = Callable[..., Any]


def _request(url: str, key: str, method: str, *, body: Any = None, want_rows: bool) -> Any:
    """One PostgREST call. Split out so tests can substitute it without a database."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": _SCHEMA,
        "Content-Profile": _SCHEMA,
        "Prefer": "return=representation" if want_rows else "return=minimal",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode() or ""
    if not want_rows or not raw.strip():
        return []
    return json.loads(raw)


_NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, ValueError, OSError)


class PostgrestParentLinkStore:
    """``learner.parent_links`` over PostgREST with the service-role key (never a client's)."""

    def __init__(self, base_url: str, service_key: str, *, request: Request_ | None = None) -> None:
        if not base_url or not service_key:
            raise ValueError("PostgrestParentLinkStore needs a project URL and a service key")
        self.base = base_url.rstrip("/")
        self._key = service_key
        self._request = request or _request

    def _url(self, params: dict[str, str]) -> str:
        encoded = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        return f"{self.base}/rest/v1/{_TABLE}?{encoded}"

    def _call(self, method: str, params: dict[str, str], *, body: Any = None) -> list[Any]:
        try:
            rows = self._request(self._url(params), self._key, method, body=body, want_rows=True)
        except _NETWORK_ERRORS as exc:
            logger.warning(
                "parent links: store call failed",
                extra={"fields": {"method": method, "error": str(exc)}},
            )
            raise StoreUnavailable(str(exc)) from exc
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    @staticmethod
    def _checked(value: str, what: str) -> str:
        if not _ID_RE.match(value or ""):
            raise StoreUnavailable(f"{what} is not something I can look up")
        return value

    def active(self, learner_id: str) -> ParentLink | None:
        rows = self._call(
            "GET",
            {
                "select": "*",
                "learner_id": f"eq.{self._checked(learner_id, 'learner')}",
                "status": "in.(invited,linked)",
                "limit": "1",
            },
        )
        return from_row(rows[0]) if rows else None

    def latest(self, learner_id: str) -> ParentLink | None:
        rows = self._call(
            "GET",
            {
                "select": "*",
                "learner_id": f"eq.{self._checked(learner_id, 'learner')}",
                "order": "invited_at.desc",
                "limit": "1",
            },
        )
        return from_row(rows[0]) if rows else None

    def recent(self, learner_id: str, *, since: datetime) -> list[ParentLink]:
        rows = self._call(
            "GET",
            {
                "select": "*",
                "learner_id": f"eq.{self._checked(learner_id, 'learner')}",
                "invited_at": f"gte.{_iso(since)}",
                "order": "invited_at.desc",
                "limit": "50",
            },
        )
        return [from_row(row) for row in rows]

    def get(self, link_id: str) -> ParentLink | None:
        rows = self._call(
            "GET", {"select": "*", "id": f"eq.{self._checked(link_id, 'link')}", "limit": "1"}
        )
        return from_row(rows[0]) if rows else None

    def insert(self, link: ParentLink) -> ParentLink:
        rows = self._call("POST", {"select": "*"}, body=[to_row(link)])
        return from_row(rows[0]) if rows else link

    def update(self, link_id: str, fields: dict[str, Any]) -> ParentLink | None:
        rows = self._call(
            "PATCH", {"id": f"eq.{self._checked(link_id, 'link')}", "select": "*"}, body=fields
        )
        return from_row(rows[0]) if rows else None

    def delete(self, link_id: str) -> bool:
        rows = self._call("DELETE", {"id": f"eq.{self._checked(link_id, 'link')}", "select": "id"})
        return bool(rows)

    def linked(self) -> list[ParentLink]:
        rows = self._call("GET", {"select": "*", "status": "eq.linked", "limit": "5000"})
        return [from_row(row) for row in rows]

    def by_email_hash(self, digest: str) -> list[ParentLink]:
        """Every ACTIVE link naming this address, by its keyed digest.

        This is how a family linked before parent accounts existed is picked up: the parent signs
        up with the same address, the digest matches, and
        :func:`wobo_gateway.parent_account.claim_links` turns the row into a real relationship
        between two accounts. Nobody is stranded and nobody is re-invited. The digest is checked
        for shape before it reaches the filter, the same rule as every other id here.
        """
        if not re.match(r"^[0-9a-f]{64}$", digest or ""):
            return []
        rows = self._call(
            "GET",
            {
                "select": "*",
                "parent_email_hash": f"eq.{digest}",
                "status": "in.(invited,linked)",
                "limit": "50",
            },
        )
        return [from_row(row) for row in rows]


_store: ParentLinkStore | None = None
_store_lock = threading.Lock()


def build_store() -> ParentLinkStore:
    """The project store when configured, else the in-memory one. ``PARENT_LINKS_STORE=memory``
    forces the latter — what the suite and a local run use."""
    if (os.getenv("PARENT_LINKS_STORE") or "").strip().lower() == "memory":
        return InMemoryParentLinkStore()
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if base and key:
        return PostgrestParentLinkStore(base, key)
    logger.info("parent links: no project configured, keeping links in memory")
    return InMemoryParentLinkStore()


def get_store() -> ParentLinkStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: ParentLinkStore | None) -> None:
    """Test seam."""
    global _store
    with _store_lock:
        _store = store


# --- the lifecycle ------------------------------------------------------------------------------
class Refused(Exception):
    """An invite the gateway will not send. ``status`` is the HTTP answer, ``code`` the reason,
    and ``retry_after`` the seconds until a 429 lifts (the route puts it on the header)."""

    def __init__(
        self, status: int, code: str, message: str, *, retry_after: int | None = None
    ) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.retry_after = retry_after
        super().__init__(message)


_NOT_READY = "I cannot send invites just now. Try again a little later."
_TOO_MANY = "That is a few invites in one day. Give it a day and try again."
_SAME_ADDRESS = (
    "I wrote to that address in the last day. If they did not see it, try again tomorrow."
)


def _allowance(store: ParentLinkStore, learner_id: str, digest: str, moment: datetime) -> None:
    """The two bounds on a mail sender a stranger can aim: a handful of invites per learner per
    day, every row counted whatever became of it, and never the same address twice in a day —
    a revoke followed by the same address again is not a second mail. Raises :class:`Refused`."""
    window = store.recent(learner_id, since=moment - _DAY)
    if not window:
        return
    oldest = min(link.invited_at for link in window)
    lifts = max(1, int((oldest + _DAY - moment).total_seconds()))
    if len(window) >= invites_per_day():
        raise Refused(429, "invite_limit", _TOO_MANY, retry_after=lifts)
    same = [link for link in window if link.parent_email_hash == digest]
    if same:
        last = max(link.invited_at for link in same)
        raise Refused(
            429,
            "invite_recent",
            _SAME_ADDRESS,
            retry_after=max(1, int((last + _DAY - moment).total_seconds())),
        )


def _stamp(learner_id: str, timezone: str | None, now: datetime) -> str | None:
    """The learner's local moment for the head of the mail, when a zone is known."""
    from wobo_gateway.hospitality.festivals import get_calendar
    from wobo_gateway.hospitality.jobs import dials, family_local, stamp_for

    prefs = dials(learner_id)
    if prefs is None:
        return None
    local = family_local(prefs, now, fallback_zone=timezone or "", calendar=get_calendar())
    return stamp_for(local) if local is not None else None


def invite(
    store: ParentLinkStore,
    *,
    learner_id: str,
    email: str,
    learner_name: str | None = None,
    timezone: str | None = None,
    now: datetime | None = None,
    send: Send | None = None,
) -> tuple[ParentLink, dict[str, Any]]:
    """One invite: the row, the signed single-use token, the mail. Raises :class:`Refused`.

    The mail is sent as trusted internal lifecycle mail (no ``subject`` — the recipient is the
    parent, not the learner, so the "a learner may only mail their own address" rule does not
    apply; the door already verified the learner who asked). It is idempotent per link.
    """
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    if not signing_available():
        raise Refused(503, "not_ready", _NOT_READY)
    digest = email_hash(email)
    assert digest is not None  # signing_available() said so
    try:
        current = store.active(learner_id)
        if current is not None and expired(current, moment):
            # Nobody answered inside the window: the row catches up with its dead token and
            # makes way for this one, rather than blocking it until the learner finds DELETE.
            store.update(current.id, _revocation(moment, "expired"))
            logger.info(
                "parent link: expired invite replaced", extra={"fields": {"learner": learner_id}}
            )
            current = None
        if current is not None:
            raise Refused(
                409,
                "link_active",
                "A parent is already linked. End that link first if you want to invite someone "
                "else."
                if current.status == "linked"
                else "An invite is already out. End it first if you want to send another.",
            )
        _allowance(store, learner_id, digest, moment)
    except StoreUnavailable as exc:
        raise Refused(503, "store_unavailable", _STORE_LINE) from exc
    link_id = str(uuid.uuid4())
    token = invite_token(link_id, learner_id, issued=moment)
    if token is None:
        raise Refused(503, "not_ready", _NOT_READY)
    link = ParentLink(
        id=link_id,
        learner_id=learner_id,
        parent_email_hash=digest,
        parent_email=email,
        learner_name=learner_name,
        timezone=timezone,
        status="invited",
        invited_at=moment,
        invite_token_hash=token_hash(token),
    )
    try:
        stored = store.insert(link)
    except StoreUnavailable as exc:
        raise Refused(503, "store_unavailable", _STORE_LINE) from exc
    data: dict[str, Any] = {
        "learner_name": learner_name or "",
        "accept_url": accept_url(token),
        "decline_url": decline_url(token),
    }
    stamp = _stamp(learner_id, timezone, moment)
    if stamp:
        data["stamp"] = stamp
    # Looked up at call time, not bound at definition: the suite swaps the sender on the module.
    sender = send or send_email
    result = sender("parent_invite", email, data, learner_id=learner_id, period=f"invite:{link_id}")
    if not result.get("ok") and not result.get("queued"):
        # The row must not outlive a mail that never went: a learner told "invite sent" while
        # the parent heard nothing is the one thing this route must never do.
        try:
            store.delete(link_id)
        except StoreUnavailable:
            logger.warning(
                "parent links: unsent invite could not be removed",
                extra={"fields": {"learner": learner_id, "to_hash": to_hash(email)}},
            )
        raise Refused(
            502, "invite_not_sent", "I could not send that just now. Try again in a moment."
        )
    logger.info(
        "parent link: invited",
        extra={
            "fields": {
                "learner": learner_id,
                "to_hash": to_hash(email),
                "link": link_id,
                "sent": bool(result.get("ok")),
            }
        },
    )
    return stored, result


_STORE_LINE = "I could not reach the parent link just now. Try that again in a moment."


@dataclass(frozen=True)
class Outcome:
    """What a parent's tap did: ``done``, ``already_linked``, ``ended``, ``bad_link`` or
    ``unavailable`` — and the link when one was found, for the name on the page."""

    kind: str
    link: ParentLink | None = None


def _find(store: ParentLinkStore, token: str | None, now: datetime) -> Outcome:
    """The link an outstanding token names, checked the whole way: our signature, our row, the
    learner it names, and the digest on the row (single use)."""
    claim = parse_invite_token(token, now=now)
    if claim is None:
        return Outcome("bad_link")
    try:
        link = store.get(claim.link_id)
    except StoreUnavailable:
        return Outcome("unavailable")
    if link is None or link.learner_id != claim.learner_id:
        return Outcome("bad_link")
    if link.status == "linked":
        return Outcome("already_linked", link)
    if link.status == "revoked":
        return Outcome("ended", link)
    assert token is not None
    if not link.invite_token_hash or not hmac.compare_digest(
        link.invite_token_hash, token_hash(token)
    ):
        return Outcome("bad_link")
    return Outcome("done", link)


def look(store: ParentLinkStore, token: str | None, *, now: datetime | None = None) -> Outcome:
    """A GET: what the token is, and nothing changed."""
    return _find(store, token, (now or datetime.now(UTC)).astimezone(UTC))


def accept(store: ParentLinkStore, token: str | None, *, now: datetime | None = None) -> Outcome:
    """The parent's tap: the row becomes ``linked``, the token is spent, and the parent's own
    stop link for the Sunday note is minted onto the row."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    found = _find(store, token, moment)
    if found.kind != "done" or found.link is None:
        return found
    fields = {
        "status": "linked",
        "linked_at": _iso(moment),
        "invite_token_hash": None,
        "unsubscribe_url": stop_link(found.link.learner_id, "sunday_note"),
    }
    try:
        updated = store.update(found.link.id, fields)
    except StoreUnavailable:
        return Outcome("unavailable")
    logger.info(
        "parent link: linked",
        extra={"fields": {"learner": found.link.learner_id, "link": found.link.id}},
    )
    return Outcome("done", updated or replace(found.link, status="linked", linked_at=moment))


def decline(store: ParentLinkStore, token: str | None, *, now: datetime | None = None) -> Outcome:
    """ "Not me": the row is ``revoked`` by the parent and keeps no address."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    found = _find(store, token, moment)
    if found.kind != "done" or found.link is None:
        return found
    try:
        updated = store.update(found.link.id, _revocation(moment, "parent"))
    except StoreUnavailable:
        return Outcome("unavailable")
    logger.info(
        "parent link: declined",
        extra={"fields": {"learner": found.link.learner_id, "link": found.link.id}},
    )
    _stop_the_parent_account(found.link)
    return Outcome("done", updated or replace(found.link, status="revoked", revoked_at=moment))


def _stop_the_parent_account(link: ParentLink) -> None:
    """A link ended: the parent account that held it stops at once, and its mind of this child is
    retired for good (docs/TWO-MINDS.md, "what happens when the link ends").

    Access is already gone the moment the row says ``revoked`` — every parent read re-reads this
    table and nothing is cached (:func:`wobo_gateway.parent_account.children`). This is the
    SECOND half: the parent's remembered picture of this child is retired, and retirement is
    one-way, because consent to be talked about is not retroactive. Re-making the link does not
    bring it back. The facts the parent offered and the child ACCEPTED stay in the child's mind,
    because they are the child's now and the child can see and remove them.

    Never raises. A learner ending a link must not fail because the parent plane is unreachable;
    the link is revoked either way, which is the half that stops the reading.
    """
    try:
        from wobo_gateway import parent_account, parent_mind

        store = parent_account.get_store()
        binding = store.link_by_link_id(link.id)
        if binding is None:
            return
        parent_mind.retire_for_link_end(
            store,
            parent_account_id=binding.parent_account_id,
            learner_id=binding.learner_id,
        )
        # A pending offer is a write this parent has already staged into the child's mind. It
        # survived the revoke because nothing here touched it, and accepting it afterwards put one
        # permanent sentence into the mind of a child who had just removed them. Withdrawn here,
        # so the route's refusal is not the only thing standing between them.
        for offer in store.offers(parent_account_id=binding.parent_account_id):
            if offer.learner_id != binding.learner_id or offer.status != "pending":
                continue
            store.put_offer(replace(offer, status="withdrawn", decided_at=datetime.now(UTC)))
        selection = store.selection(binding.parent_account_id)
        if selection is not None and selection.learner_id == binding.learner_id:
            store.clear_selection(binding.parent_account_id)
        # The household layer is not about one child, so nothing learner-scoped ever retired it.
        # A parent whose every link has ended is not a live writer on our store and is not
        # somebody the household is still being described to.
        if parent_account.stands_down(store, binding.parent_account_id):
            parent_mind.retire_family_layer(store, binding.parent_account_id)
    except Exception as exc:
        logger.warning(
            "parent link: the parent account was not stood down",
            extra={"fields": {"link": link.id, "error": str(exc)}},
        )


def _revocation(moment: datetime, by: str) -> dict[str, Any]:
    return {
        "status": "revoked",
        "revoked_at": _iso(moment),
        "revoked_by": by,
        "parent_email": None,
        "invite_token_hash": None,
    }


def revoke(
    store: ParentLinkStore, learner_id: str, *, now: datetime | None = None
) -> ParentLink | None:
    """The learner ends it. The active row (invited or linked) is ``revoked`` by the learner and
    keeps no address; an outstanding invite token dies with it. ``None`` when there was none."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    current = store.active(learner_id)
    if current is None:
        return None
    updated = store.update(current.id, _revocation(moment, "learner"))
    logger.info("parent link: ended by learner", extra={"fields": {"learner": learner_id}})
    _stop_the_parent_account(current)
    return updated or replace(current, status="revoked", revoked_at=moment, parent_email=None)


# --- what the You screen reads ------------------------------------------------------------------
def status_view(link: ParentLink | None, *, now: datetime | None = None) -> dict[str, Any]:
    """The learner's own view. The line is Wobo's, and it is how the learner is told that the
    address said it was not them (there is no in-app notice channel yet — TODO(web): the You
    screen shows this line on open). An invite past its window reads as ``expired``: the parent's
    link is dead by then, and the screen must not keep saying the invite is out."""
    if link is None:
        return {
            "status": "none",
            "line": "No parent linked. Add an address and I will send them a note every Sunday.",
        }
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    masked = mask_email(link.parent_email) if link.parent_email else None
    status = "expired" if expired(link, moment) else link.status
    if status == "expired":
        line = "That invite has run out. Send a fresh one when you like."
    elif status == "invited":
        line = f"Invite sent to {masked}. Nothing goes out until they say yes."
    elif status == "linked":
        line = f"Linked. {masked} gets a note every Sunday, when there is a week to tell."
    elif link.revoked_by == "parent":
        line = (
            "The address you invited said it was not them. Check it and send the invite "
            "again, if you like."
        )
    elif link.revoked_by == "expired":
        line = "That invite ran out before it was answered. Send a fresh one when you like."
    else:
        line = "You ended the parent link. Nothing goes to that address any more."
    return {
        "status": status,
        "parent_email": masked,
        "learner_name": link.learner_name,
        "timezone": link.timezone,
        "invited_at": _iso(link.invited_at),
        "linked_at": _iso(link.linked_at),
        "revoked_at": _iso(link.revoked_at),
        "revoked_by": link.revoked_by,
        "line": line,
    }


# --- the routes ---------------------------------------------------------------------------------
class ParentInviteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)
    learner_name: str | None = Field(default=None, max_length=80)
    timezone: str | None = Field(default=None, max_length=64)


def _sign_in_required() -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={
            "code": "sign_in_required",
            "message": "Sign in first, and then the parent link is yours to keep.",
        },
    )


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=503, detail={"code": "store_unavailable", "message": _STORE_LINE}
    )


def _page(
    title: str, line: str, *, status: int = 200, form: str = "", quiet: str = ""
) -> HTMLResponse:
    """A plain page for the parent. Self-contained: no remote fonts, scripts or images, and no
    name of anything underneath (§17)."""
    app = html.escape(APP_NAME)
    body = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="robots" content="noindex">'
        f"<title>{html.escape(title)}</title>"
        "<style>body{margin:0;background:#FAF7F0;color:#14142B;font-family:Poppins,"
        "'Helvetica Neue',Arial,sans-serif}main{max-width:560px;margin:0 auto;padding:64px 24px}"
        ".mark{font-weight:700;font-size:26px;letter-spacing:-1px}h1{font-size:28px;line-height:1.2;"
        "letter-spacing:-.5px;margin:40px 0 12px}p{font-size:17px;line-height:1.5;margin:0 0 12px}"
        "a{color:#2B45FF}.quiet{color:#8A8A9E;font-size:14px;margin-top:40px}"
        "button{margin-top:16px;padding:14px 22px;border:0;border-radius:12px;background:#14142B;"
        "color:#FAF7F0;font:500 15px/1 inherit;cursor:pointer}</style></head>"
        f'<body><main><div class="mark">{app.lower()}</div><h1>{html.escape(title)}</h1>'
        f"<p>{html.escape(line)}</p>{form}"
        + (f'<p class="quiet">{quiet}</p>' if quiet else "")
        + "</main></body></html>"
    )
    return HTMLResponse(content=body, status_code=status)


def _form(action: str, token: str, button: str) -> str:
    return (
        f'<form method="post" action="{html.escape(action, quote=True)}">'
        f'<input type="hidden" name="token" value="{html.escape(token, quote=True)}">'
        f'<button type="submit">{html.escape(button)}</button></form>'
    )


async def _token_from_body(request: Request) -> str | None:
    """The ``token`` field of the page's own form body, read with the standard library."""
    if "application/x-www-form-urlencoded" not in request.headers.get("content-type", ""):
        return None
    try:
        raw = (await request.body())[:8192].decode("utf-8", "ignore")
    except Exception:  # a body that could not be read is simply not a token
        return None
    values = parse_qs(raw, keep_blank_values=False).get("token") or []
    return values[0] if values and isinstance(values[0], str) else None


def _name_of(link: ParentLink | None, *, initial: bool = True) -> str:
    """The learner's first name, or "the learner" — capitalised only where it opens a sentence."""
    name = link.learner_name if link and link.learner_name else ""
    return name or ("The learner" if initial else "the learner")


def _settled(found: Outcome) -> HTMLResponse | None:
    """The page for a token that names nothing to do — or ``None`` when there is something."""
    name = _name_of(found.link, initial=False)
    if found.kind == "unavailable":
        return _page(
            "Not yet",
            "I could not reach that just now. Try the link again in a moment.",
            status=503,
        )
    if found.kind == "already_linked":
        return _page(
            "Done already",
            f"The Sunday notes about {name} are already on their way to this address. "
            "Every note carries a link that stops them.",
        )
    if found.kind == "ended":
        return _page(
            "This invite was ended",
            "Nothing will come to this address. If you would like the notes after all, "
            f"{name} can send a fresh invite from their settings.",
        )
    if found.kind != "done":
        return _page(
            "That link did not work",
            "It may have expired, or it is not one of ours. Whoever invited you can send a "
            "fresh one from their settings.",
            status=400,
        )
    return None


def register_parent_links(app: FastAPI) -> None:
    @app.post("/v1/me/parent-invite")
    def parent_invite(body: ParentInviteRequest, request: Request) -> dict[str, Any]:
        principal = request.state.principal
        if principal is None or principal.anonymous:
            raise _sign_in_required()
        try:
            email = normalise_email(body.email)
            name = normalise_name(body.learner_name)
            zone = normalise_timezone(body.timezone)
            own = str(principal.claims.get("email") or "").strip().lower()
            if own and own == email:
                raise NotKept("email", "That is your own address. A parent's, please.")
        except NotKept as exc:
            raise HTTPException(
                status_code=422,
                detail={"code": "not_kept", "field": exc.field, "message": exc.message},
            ) from exc
        try:
            link, result = invite(
                get_store(),
                learner_id=principal.subject,
                email=email,
                learner_name=name,
                timezone=zone,
            )
        except Refused as exc:
            raise HTTPException(
                status_code=exc.status,
                detail={"code": exc.code, "message": exc.message},
                headers={"Retry-After": str(exc.retry_after)} if exc.retry_after else None,
            ) from exc
        return {**status_view(link), "sent": bool(result.get("ok"))}

    @app.get("/v1/me/parent-link")
    def parent_link(request: Request) -> dict[str, Any]:
        principal = request.state.principal
        if principal is None or principal.anonymous:
            return status_view(None)
        try:
            return status_view(get_store().latest(principal.subject))
        except StoreUnavailable as exc:
            raise _unavailable() from exc

    @app.delete("/v1/me/parent-link")
    def end_parent_link(request: Request) -> dict[str, Any]:
        principal = request.state.principal
        if principal is None or principal.anonymous:
            raise _sign_in_required()
        store = get_store()
        try:
            ended = revoke(store, principal.subject)
            return {
                **status_view(ended or store.latest(principal.subject)),
                "ended": ended is not None,
            }
        except StoreUnavailable as exc:
            raise _unavailable() from exc

    @app.get("/v1/parent/accept", response_class=HTMLResponse)
    def accept_page(token: str | None = None) -> HTMLResponse:
        """What the parent will get, and one button. Nothing changes on a GET."""
        found = look(get_store(), token)
        settled = _settled(found)
        if settled is not None:
            return settled
        name = _name_of(found.link)
        return _page(
            f"{name} asked me to send you their Sunday notes",
            f"Once a week, one page: what {_name_of(found.link, initial=False)} studied, what "
            "they cracked, and one thing they drew. Not their conversations with me, not a list "
            "of wrong answers, not a note when they are online. One tap and it starts; every "
            "note carries a link that stops them.",
            form=_form(parent_route_url("accept"), token or "", "Send me the Sunday notes"),
            quiet=(
                f'Not you? <a href="{html.escape(decline_url(token or ""), quote=True)}">'
                "Say so here</a> and I forget this address."
            ),
        )

    @app.post("/v1/parent/accept", response_class=HTMLResponse)
    async def accept_post(request: Request, token: str | None = None) -> HTMLResponse:
        if token is None:
            token = await _token_from_body(request)
        found = accept(get_store(), token)
        settled = _settled(found)
        if settled is not None:
            return settled
        name = _name_of(found.link, initial=False)
        return _page(
            "Done. The Sunday notes will come here.",
            f"The first one arrives on a Sunday evening, when {name} has had a week worth "
            "telling. Every note carries a link that stops them.",
        )

    @app.get("/v1/parent/decline", response_class=HTMLResponse)
    def decline_page(token: str | None = None) -> HTMLResponse:
        found = look(get_store(), token)
        settled = _settled(found)
        if settled is not None:
            return settled
        name = _name_of(found.link)
        return _page(
            "Not you?",
            f"One tap and I forget this address. {name} will see that the invite was not "
            "accepted, and nothing else comes.",
            form=_form(parent_route_url("decline"), token or "", "Not me"),
        )

    @app.post("/v1/parent/decline", response_class=HTMLResponse)
    async def decline_post(request: Request, token: str | None = None) -> HTMLResponse:
        if token is None:
            token = await _token_from_body(request)
        found = decline(get_store(), token)
        settled = _settled(found)
        if settled is not None:
            return settled
        return _page(
            "Done. I have forgotten this address.",
            "Nothing else will come from me.",
        )


__all__ = [
    "ENDED_BY",
    "InMemoryParentLinkStore",
    "ParentLink",
    "PostgrestParentLinkStore",
    "Refused",
    "StoreUnavailable",
    "accept",
    "decline",
    "expired",
    "get_store",
    "invite",
    "invite_days",
    "invites_per_day",
    "register_parent_links",
    "revoke",
    "set_store",
    "status_view",
]
