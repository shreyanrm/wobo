"""The parent account: who it is, which children it holds, and which one it is looking at.

Migration 0019 is the schema and its header is the reasoning. This module is the server half of
what the owner asked for on 2026-09-05:

    "the switching is for the parent cause they have very little actions, that too if they are
     linked only. They get to ask Wobo about their children academics, they get to pay for the
     subscriptions, refer, donate and thats pretty much it, and switch between their children in
     the same account to perform the same tasks individually."

and, on the same day, of the thing that is NOT a variation of it:

    "the student accounts are completely different, they have no switching, its only signup/login
     and logout."

So there are two kinds of account and they share no model. A student account is an account with
no row in ``parent.accounts``; there is no profile list to enumerate and no chooser to find,
because there is nothing to choose. :func:`require_parent` refuses a student account outright with
a 403 rather than handing it an empty list — an empty list is a surface an attacker pushes on, and
a 403 is a door.

FOUR THINGS A PARENT MAY DO, and only for a child who has linked them (:data:`PARENT_ACTIONS`):
ask Wobo about that child's academics, pay, refer, donate. Everything else is refused here rather
than hidden in a UI, because a UI-only limit is not a limit. In particular a parent may never read
the child's conversation, work, boards, answers, handwriting or mind, may never act as the child,
and may never reach a child who has not linked them or who has revoked them.

WHERE CONSENT LIVES. Not here. ``parent.child_links`` binds a parent account to a
``learner.parent_links`` row (0011) and carries no status of its own; whether the parent may see
anything today is read from that row every single time (:func:`children`, :func:`selected`). The
learner ending it from the You screen and the parent ending it from "not me" therefore both stop
access at the very next request, with no cached view left alive.

THE SWITCH IS A SERVER-SIDE SELECTION. ``parent.selections`` holds one row per parent, so exactly
one child is selected at a time, and every scoped read re-derives the child from that row. Nothing
downstream ever takes a learner id from a request body. Each switch mints a fresh ``scope`` id: a
parent switching children puts two learners on ONE DEVICE by design, so the client is handed a new
scope and must drop everything keyed to the old one. That is the memory law — the record is here,
the device holds a cache, and the cache is told when it is stale.

THE FAMILIES THAT PREDATE THIS FILE ARE NOT STRANDED. Before this wave a parent was an address:
``learner.parent_links.parent_email_hash``, a keyed digest under the gateway's mail key. When a
parent signs up with that same address the digest matches and :func:`claim_links` turns every
linked row into a real relationship between two accounts. Nobody has to be re-invited.

EVERY PARENT READ OF A CHILD IS AUDITED (:func:`audit`), into ``parent.access_audit`` and not into
``ops.admin_audit``: that trail is the operator's, over every learner, readable only by an active
admin. This one is about one family, and the person it protects is the child.

Two stores behind one seam, exactly as :mod:`wobo_gateway.parents`: in memory for the suite and a
local run, PostgREST with the service-role key for the project. There is no learner-role policy on
any table in the ``parent`` schema, so the gateway is the only door and the allow-list above is
the only way in.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any, Protocol

logger = logging.getLogger("wobo.gateway.parent")

_HTTP_TIMEOUT_S = 5.0
_SCHEMA = "parent"
_MAX_NAME = 40

#: The four things a parent account may do, and there is no fifth. Named here rather than left
#: implicit in the route table so a test can hold the list and a reader can see the ceiling.
PARENT_ACTIONS: tuple[str, ...] = ("ask", "pay", "refer", "donate")

#: What a parent may NEVER do, whatever the UI offers. Enforced at the endpoint: there is no code
#: path from a parent principal to any of these, and :mod:`wobo_gateway.parent_mind` proves it for
#: the one that matters most (the child's own words never reach the parent's prompt).
FORBIDDEN_OF_A_CHILD: tuple[str, ...] = (
    "conversation",
    "work",
    "boards",
    "answers",
    "handwriting",
    "mind",
    "act_as",
)

#: The two shapes a binding could have. **Only the first one is ever written today**, and that is
#: said here rather than implied, because the earlier version of this comment described the
#: under-13 case as recorded when nothing recorded it: ``claim_links`` writes ``linked_parent``
#: for every new binding, there is no age signal on the server to write anything else from
#: (``learner.profiles_cache.birthdate`` is not read by this plane), and so no guardian is
#: distinguishable from a linked parent in the data. ``account_holder`` is the column the
#: under-13 case will use (docs/legal/parental-consent.md §1) the day the age gate writes it, and
#: it is in the check constraint in 0019 so that day needs no migration. Until then it is a shape
#: and not a behaviour, and nothing may claim it answers the question "does the guardian hold the
#: account INSTEAD of the child".
RELATIONSHIPS: tuple[str, ...] = ("linked_parent", "account_holder")

#: The relationship every binding actually has. One producer, named, so a reader can check.
DEFAULT_RELATIONSHIP = "linked_parent"

#: What either relationship may READ of a child. One tuple, both relationships, on purpose — so
#: that when the second one does start being written, it grants no read the first does not.
READABLE_OF_A_CHILD: tuple[str, ...] = ("name", "week", "report_notes")

#: A subject or a link id reaches a PostgREST filter, so it is checked before it is interpolated
#: (the same rule as :mod:`wobo_gateway.memory` and :mod:`wobo_gateway.parents`).
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
#: A first name: the same shape the parent link already accepts for the learner's.
_NAME_RE = re.compile(r"^[^\W\d_]+(?:['’-][^\W\d_]+)?$")


def readable_for(relationship: str) -> tuple[str, ...]:
    """What this relationship may read of a child. The same for both, deliberately.

    A guardian who holds the account WITH a child below thirteen is not thereby a reader of that
    child's conversation, and must never become the reader of a teenager's private work by the
    account being upgraded around them. This is true and, today, vacuous: only
    :data:`DEFAULT_RELATIONSHIP` is ever written, so the second case cannot occur yet. It is kept
    because it is the shape the answer has to have when it can.
    """
    if relationship not in RELATIONSHIPS:
        raise ValueError(f"unknown relationship: {relationship}")
    return READABLE_OF_A_CHILD


# --- the model ----------------------------------------------------------------------------------
@dataclass(frozen=True)
class ParentAccount:
    """A row of ``parent.accounts``. The absence of one is what makes an account a student's."""

    account_id: str
    email_hash: str
    display_name: str | None = None
    status: str = "active"
    created_at: datetime | None = None

    @property
    def active(self) -> bool:
        return self.status == "active"


@dataclass(frozen=True)
class ChildLink:
    """A row of ``parent.child_links``: the binding, never the consent."""

    id: str
    parent_account_id: str
    link_id: str
    learner_id: str
    relationship: str = "linked_parent"
    claimed_at: datetime | None = None


@dataclass(frozen=True)
class Selection:
    """A row of ``parent.selections``. One per parent, so one child at a time."""

    parent_account_id: str
    learner_id: str
    scope: str
    selected_at: datetime | None = None


@dataclass(frozen=True)
class MindFact:
    """A row of ``parent.mind_facts``.

    ``source`` is the allow-list and it has exactly two values (migration 0019, ruling 3):
    ``parent`` is what the parent themselves said, ``report`` is a report-level fact about the
    child a parent is already allowed to see. There is no third value and no column for one, so
    the child's own words have nowhere to arrive.

    ``learner_id`` of ``None`` is the family layer: what is true of the household rather than one
    child, so a parent with two children does not have to say it twice.
    """

    id: str
    parent_account_id: str
    learner_id: str | None
    body: str
    source: str
    status: str = "active"
    created_at: datetime | None = None
    retired_at: datetime | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "body": self.body,
            "source": self.source,
            "about": self.learner_id or "family",
            "status": self.status,
            "created_at": _iso(self.created_at),
        }


@dataclass(frozen=True)
class Offer:
    """A row of ``parent.offers``: a fact a parent offered to the CHILD's mind.

    The row outlives the child removing it (``status = 'removed_by_child'``), and the unique
    index on ``(learner_id, fact_key)`` is what stops a parent re-adding what a child removed.
    """

    id: str
    parent_account_id: str
    learner_id: str
    body: str
    fact_key: str
    status: str = "pending"
    created_at: datetime | None = None
    decided_at: datetime | None = None
    removed_at: datetime | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "body": self.body,
            "status": self.status,
            "source": "parent",
            "created_at": _iso(self.created_at),
        }


@dataclass(frozen=True)
class Child:
    """One linked child as a parent is allowed to see them, and not one field more.

    There is no progress figure, no streak, no mastery and no last-seen time on this object.
    Everything a parent reads about a child's week is assembled once, behind the allow-list, in
    :mod:`wobo_gateway.parent_mind`.
    """

    learner_id: str
    link_id: str
    name: str | None
    relationship: str
    linked_at: datetime | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "learner_id": self.learner_id,
            "name": self.name,
            "relationship": self.relationship,
            "linked_at": _iso(self.linked_at),
        }


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat() if value else None


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


def normalise_display_name(raw: Any) -> str | None:
    """A first name for Wobo to use. Same shape as the learner's on the parent link."""
    text = str(raw or "").strip()
    if not text:
        return None
    first = text.split()[0][:_MAX_NAME]
    return first if _NAME_RE.match(first) else None


# --- the refusals -------------------------------------------------------------------------------
class StoreUnavailable(Exception):
    """The parent plane could not be reached. Callers say so; they never invent a family."""


class NotAParentAccount(Exception):
    """A student account, or any account with no row in ``parent.accounts``.

    A 403 and not an empty list. The owner's words are that a student account has no switching at
    all; answering "you have no children" would be describing a chooser that does not exist and
    would leave a seam for one, which is exactly the surface an attacker pushes on.
    """

    status = 403
    code = "not_a_parent_account"
    message = "This is not a parent account. Sign in with the parent account to see a child."


class NoSuchChild(Exception):
    """A child this parent does not hold, or one whose link has ended. Same answer for both.

    Deliberately indistinguishable: telling a caller "that child exists but has revoked you"
    confirms the child exists, which is a fact a stranger holding a parent token should not be
    able to fish for.
    """

    status = 404
    code = "no_such_child"
    message = "I do not have a child by that name on this account."


class NoChildSelected(Exception):
    """Nothing selected yet, or the selected child's link ended under us."""

    status = 409
    code = "no_child_selected"
    message = "Choose which child this is about, and I will pick it up from there."


# --- the store seam -----------------------------------------------------------------------------
class ParentStore(Protocol):
    def account(self, account_id: str) -> ParentAccount | None: ...

    def account_by_email_hash(self, digest: str) -> ParentAccount | None: ...

    def put_account(self, account: ParentAccount) -> ParentAccount: ...

    def links(self, parent_account_id: str) -> list[ChildLink]: ...

    def link_by_link_id(self, link_id: str) -> ChildLink | None: ...

    def put_link(self, link: ChildLink) -> ChildLink: ...

    def selection(self, parent_account_id: str) -> Selection | None: ...

    def put_selection(self, selection: Selection) -> Selection: ...

    def clear_selection(self, parent_account_id: str) -> None: ...

    def audit(self, row: dict[str, Any]) -> None: ...

    def forget_learner(self, learner_id: str) -> int: ...

    def mind_facts(
        self, parent_account_id: str, learner_id: str | None, *, include_retired: bool = False
    ) -> list[MindFact]: ...

    def put_mind_fact(self, fact: MindFact) -> MindFact: ...

    def retire_mind_facts(
        self, *, parent_account_id: str | None = None, learner_id: str | None = None
    ) -> int: ...

    def offers(
        self, *, learner_id: str | None = None, parent_account_id: str | None = None
    ) -> list[Offer]: ...

    def offer(self, offer_id: str) -> Offer | None: ...

    def put_offer(self, offer: Offer) -> Offer: ...

    def thread(self, parent_account_id: str, learner_id: str) -> list[dict[str, Any]]: ...

    def put_thread(
        self, parent_account_id: str, learner_id: str, messages: list[dict[str, Any]]
    ) -> None: ...


class InMemoryParentStore:
    """The suite's store, and a local run without a project."""

    def __init__(self) -> None:
        self.accounts: dict[str, ParentAccount] = {}
        self.child_links: dict[str, ChildLink] = {}
        self.selections: dict[str, Selection] = {}
        self.facts: dict[str, MindFact] = {}
        self.offer_rows: dict[str, Offer] = {}
        self.threads: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self.trail: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def account(self, account_id: str) -> ParentAccount | None:
        with self._lock:
            return self.accounts.get(account_id)

    def account_by_email_hash(self, digest: str) -> ParentAccount | None:
        with self._lock:
            return next((a for a in self.accounts.values() if a.email_hash == digest), None)

    def put_account(self, account: ParentAccount) -> ParentAccount:
        with self._lock:
            self.accounts[account.account_id] = account
            return account

    def links(self, parent_account_id: str) -> list[ChildLink]:
        with self._lock:
            return [
                c for c in self.child_links.values() if c.parent_account_id == parent_account_id
            ]

    def link_by_link_id(self, link_id: str) -> ChildLink | None:
        with self._lock:
            return next((c for c in self.child_links.values() if c.link_id == link_id), None)

    def put_link(self, link: ChildLink) -> ChildLink:
        with self._lock:
            claimed = next(
                (
                    c
                    for c in self.child_links.values()
                    if c.link_id == link.link_id and c.parent_account_id != link.parent_account_id
                ),
                None,
            )
            if claimed is not None:  # the unique index on link_id
                raise StoreUnavailable("that link is already held by another parent account")
            existing = next(
                (
                    c
                    for c in self.child_links.values()
                    if c.parent_account_id == link.parent_account_id
                    and c.learner_id == link.learner_id
                ),
                None,
            )
            if existing is not None:
                link = replace(link, id=existing.id)
                del self.child_links[existing.id]
            self.child_links[link.id] = link
            return link

    def selection(self, parent_account_id: str) -> Selection | None:
        with self._lock:
            return self.selections.get(parent_account_id)

    def put_selection(self, selection: Selection) -> Selection:
        with self._lock:
            self.selections[selection.parent_account_id] = selection
            return selection

    def clear_selection(self, parent_account_id: str) -> None:
        with self._lock:
            self.selections.pop(parent_account_id, None)

    def audit(self, row: dict[str, Any]) -> None:
        with self._lock:
            self.trail.append(row)

    def forget_learner(self, learner_id: str) -> int:
        """The erase path: everything the parent plane holds ABOUT this learner, gone."""
        with self._lock:
            gone = [k for k, c in self.child_links.items() if c.learner_id == learner_id]
            for key in gone:
                del self.child_links[key]
            stale = [k for k, s in self.selections.items() if s.learner_id == learner_id]
            for key in stale:
                del self.selections[key]
            for key in [k for k, f in self.facts.items() if f.learner_id == learner_id]:
                del self.facts[key]
            for key in [k for k, o in self.offer_rows.items() if o.learner_id == learner_id]:
                del self.offer_rows[key]
            for pair in [k for k in self.threads if k[1] == learner_id]:
                del self.threads[pair]
            return len(gone)

    # --- the mind ---------------------------------------------------------------------------
    def mind_facts(
        self, parent_account_id: str, learner_id: str | None, *, include_retired: bool = False
    ) -> list[MindFact]:
        with self._lock:
            out = [
                f
                for f in self.facts.values()
                if f.parent_account_id == parent_account_id
                and f.learner_id == learner_id
                and (include_retired or f.status == "active")
            ]
        return sorted(out, key=lambda f: f.created_at or datetime.min.replace(tzinfo=UTC))

    def put_mind_fact(self, fact: MindFact) -> MindFact:
        with self._lock:
            current = self.facts.get(fact.id)
            if current is not None and current.status == "retired" and fact.status != "retired":
                # Migration 0019's trigger, in the store the suite runs against.
                raise StoreUnavailable("a retired parent memory does not come back")
            self.facts[fact.id] = fact
            return fact

    def retire_mind_facts(
        self, *, parent_account_id: str | None = None, learner_id: str | None = None
    ) -> int:
        now = datetime.now(UTC)
        with self._lock:
            hit = [
                f
                for f in self.facts.values()
                if f.status == "active"
                and (parent_account_id is None or f.parent_account_id == parent_account_id)
                and (learner_id is None or f.learner_id == learner_id)
            ]
            for fact in hit:
                self.facts[fact.id] = replace(fact, status="retired", retired_at=now)
            return len(hit)

    # --- the offers -------------------------------------------------------------------------
    def offers(
        self, *, learner_id: str | None = None, parent_account_id: str | None = None
    ) -> list[Offer]:
        with self._lock:
            out = [
                o
                for o in self.offer_rows.values()
                if (learner_id is None or o.learner_id == learner_id)
                and (parent_account_id is None or o.parent_account_id == parent_account_id)
            ]
        return sorted(out, key=lambda o: o.created_at or datetime.min.replace(tzinfo=UTC))

    def offer(self, offer_id: str) -> Offer | None:
        with self._lock:
            return self.offer_rows.get(offer_id)

    def put_offer(self, offer: Offer) -> Offer:
        with self._lock:
            clash = next(
                (
                    o
                    for o in self.offer_rows.values()
                    if o.learner_id == offer.learner_id
                    and o.fact_key == offer.fact_key
                    and o.id != offer.id
                ),
                None,
            )
            if clash is not None:
                # The unique index on (learner_id, fact_key). This is the rule that makes the
                # whole parent-to-child direction safe: a parent cannot re-add what a child
                # removed, because the removed row is still sitting here holding the key.
                raise StoreUnavailable("that fact has already been offered to this learner")
            current = self.offer_rows.get(offer.id)
            if (
                current is not None
                and current.status == "removed_by_child"
                and offer.status != "removed_by_child"
            ):
                raise StoreUnavailable("a fact the child removed does not come back")
            self.offer_rows[offer.id] = offer
            return offer

    # --- the parent conversation --------------------------------------------------------------
    def thread(self, parent_account_id: str, learner_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return list(self.threads.get((parent_account_id, learner_id), []))

    def put_thread(
        self, parent_account_id: str, learner_id: str, messages: list[dict[str, Any]]
    ) -> None:
        with self._lock:
            self.threads[(parent_account_id, learner_id)] = list(messages)


_NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, ValueError, OSError)


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


class PostgrestParentStore:
    """The ``parent`` schema over PostgREST with the service-role key (never a client's).

    There is no learner-role policy on any of these tables, so this is the only reader in the
    system and the endpoint allow-list is the only way to reach them.
    """

    def __init__(self, base_url: str, service_key: str, *, request: Any = None) -> None:
        if not base_url or not service_key:
            raise ValueError("PostgrestParentStore needs a project URL and a service key")
        self.base = base_url.rstrip("/")
        self._key = service_key
        self._request = request or _request

    @staticmethod
    def _checked(value: str, what: str) -> str:
        if not _ID_RE.match(value or ""):
            raise StoreUnavailable(f"{what} is not something I can look up")
        return value

    def _call(
        self, table: str, method: str, params: dict[str, str], *, body: Any = None
    ) -> list[Any]:
        encoded = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        url = f"{self.base}/rest/v1/{urllib.parse.quote(table)}?{encoded}"
        try:
            rows = self._request(url, self._key, method, body=body, want_rows=True)
        except _NETWORK_ERRORS as exc:
            logger.warning(
                "parent store: call failed",
                extra={"fields": {"table": table, "method": method, "error": str(exc)}},
            )
            raise StoreUnavailable(str(exc)) from exc
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    # accounts
    def account(self, account_id: str) -> ParentAccount | None:
        rows = self._call(
            "accounts",
            "GET",
            {
                "select": "*",
                "account_id": f"eq.{self._checked(account_id, 'account')}",
                "limit": "1",
            },
        )
        return _account_from_row(rows[0]) if rows else None

    def account_by_email_hash(self, digest: str) -> ParentAccount | None:
        if not _DIGEST_RE.match(digest or ""):
            return None
        rows = self._call(
            "accounts", "GET", {"select": "*", "email_hash": f"eq.{digest}", "limit": "1"}
        )
        return _account_from_row(rows[0]) if rows else None

    def put_account(self, account: ParentAccount) -> ParentAccount:
        rows = self._call(
            "accounts",
            "POST",
            {"select": "*", "on_conflict": "account_id"},
            body=[_account_to_row(account)],
        )
        return _account_from_row(rows[0]) if rows else account

    # child links
    def links(self, parent_account_id: str) -> list[ChildLink]:
        rows = self._call(
            "child_links",
            "GET",
            {
                "select": "*",
                "parent_account_id": f"eq.{self._checked(parent_account_id, 'account')}",
                "limit": "200",
            },
        )
        return [_link_from_row(row) for row in rows]

    def link_by_link_id(self, link_id: str) -> ChildLink | None:
        rows = self._call(
            "child_links",
            "GET",
            {"select": "*", "link_id": f"eq.{self._checked(link_id, 'link')}", "limit": "1"},
        )
        return _link_from_row(rows[0]) if rows else None

    def put_link(self, link: ChildLink) -> ChildLink:
        rows = self._call(
            "child_links",
            "POST",
            {"select": "*", "on_conflict": "parent_account_id,learner_id"},
            body=[_link_to_row(link)],
        )
        return _link_from_row(rows[0]) if rows else link

    # selections
    def selection(self, parent_account_id: str) -> Selection | None:
        rows = self._call(
            "selections",
            "GET",
            {
                "select": "*",
                "parent_account_id": f"eq.{self._checked(parent_account_id, 'account')}",
                "limit": "1",
            },
        )
        return _selection_from_row(rows[0]) if rows else None

    def put_selection(self, selection: Selection) -> Selection:
        rows = self._call(
            "selections",
            "POST",
            {"select": "*", "on_conflict": "parent_account_id"},
            body=[
                {
                    "parent_account_id": selection.parent_account_id,
                    "learner_id": selection.learner_id,
                    "scope": selection.scope,
                    "selected_at": _iso(selection.selected_at),
                }
            ],
        )
        return _selection_from_row(rows[0]) if rows else selection

    def clear_selection(self, parent_account_id: str) -> None:
        self._call(
            "selections",
            "DELETE",
            {"parent_account_id": f"eq.{self._checked(parent_account_id, 'account')}"},
        )

    def audit(self, row: dict[str, Any]) -> None:
        """Never raises. A trail we could not write is logged loudly, but a parent's request is
        not failed because the recorder is down — and the log line is the fallback record."""
        try:
            self._call("access_audit", "POST", {}, body=[row])
        except StoreUnavailable:
            logger.warning("parent audit: trail unwritable", extra={"fields": dict(row)})

    def forget_learner(self, learner_id: str) -> int:
        checked = self._checked(learner_id, "learner")
        gone = self._call("child_links", "DELETE", {"learner_id": f"eq.{checked}", "select": "id"})
        self._call("selections", "DELETE", {"learner_id": f"eq.{checked}"})
        self._call("mind_facts", "DELETE", {"learner_id": f"eq.{checked}"})
        self._call("offers", "DELETE", {"learner_id": f"eq.{checked}"})
        self._call("threads", "DELETE", {"learner_id": f"eq.{checked}"})
        return len(gone)

    # --- the mind ---------------------------------------------------------------------------
    def mind_facts(
        self, parent_account_id: str, learner_id: str | None, *, include_retired: bool = False
    ) -> list[MindFact]:
        params = {
            "select": "*",
            "parent_account_id": f"eq.{self._checked(parent_account_id, 'account')}",
            "learner_id": (
                "is.null" if learner_id is None else f"eq.{self._checked(learner_id, 'learner')}"
            ),
            "order": "created_at.asc",
            "limit": "200",
        }
        if not include_retired:
            params["status"] = "eq.active"
        return [_fact_from_row(row) for row in self._call("mind_facts", "GET", params)]

    def put_mind_fact(self, fact: MindFact) -> MindFact:
        rows = self._call(
            "mind_facts", "POST", {"select": "*", "on_conflict": "id"}, body=[_fact_to_row(fact)]
        )
        return _fact_from_row(rows[0]) if rows else fact

    def retire_mind_facts(
        self, *, parent_account_id: str | None = None, learner_id: str | None = None
    ) -> int:
        params: dict[str, str] = {"status": "eq.active", "select": "id"}
        if parent_account_id is not None:
            params["parent_account_id"] = f"eq.{self._checked(parent_account_id, 'account')}"
        if learner_id is not None:
            params["learner_id"] = f"eq.{self._checked(learner_id, 'learner')}"
        rows = self._call(
            "mind_facts",
            "PATCH",
            params,
            body={"status": "retired", "retired_at": _iso(datetime.now(UTC))},
        )
        return len(rows)

    # --- the offers -------------------------------------------------------------------------
    def offers(
        self, *, learner_id: str | None = None, parent_account_id: str | None = None
    ) -> list[Offer]:
        params = {"select": "*", "order": "created_at.asc", "limit": "200"}
        if learner_id is not None:
            params["learner_id"] = f"eq.{self._checked(learner_id, 'learner')}"
        if parent_account_id is not None:
            params["parent_account_id"] = f"eq.{self._checked(parent_account_id, 'account')}"
        return [_offer_from_row(row) for row in self._call("offers", "GET", params)]

    def offer(self, offer_id: str) -> Offer | None:
        rows = self._call(
            "offers",
            "GET",
            {"select": "*", "id": f"eq.{self._checked(offer_id, 'offer')}", "limit": "1"},
        )
        return _offer_from_row(rows[0]) if rows else None

    def put_offer(self, offer: Offer) -> Offer:
        rows = self._call(
            "offers", "POST", {"select": "*", "on_conflict": "id"}, body=[_offer_to_row(offer)]
        )
        return _offer_from_row(rows[0]) if rows else offer

    # --- the parent conversation --------------------------------------------------------------
    def thread(self, parent_account_id: str, learner_id: str) -> list[dict[str, Any]]:
        rows = self._call(
            "threads",
            "GET",
            {
                "select": "messages",
                "parent_account_id": f"eq.{self._checked(parent_account_id, 'account')}",
                "learner_id": f"eq.{self._checked(learner_id, 'learner')}",
                "limit": "1",
            },
        )
        messages = rows[0].get("messages") if rows else None
        return [m for m in messages if isinstance(m, dict)] if isinstance(messages, list) else []

    def put_thread(
        self, parent_account_id: str, learner_id: str, messages: list[dict[str, Any]]
    ) -> None:
        self._call(
            "threads",
            "POST",
            {"on_conflict": "parent_account_id,learner_id"},
            body=[
                {
                    "parent_account_id": parent_account_id,
                    "learner_id": learner_id,
                    "messages": messages,
                }
            ],
        )


def _account_from_row(row: dict[str, Any]) -> ParentAccount:
    return ParentAccount(
        account_id=str(row.get("account_id") or ""),
        email_hash=str(row.get("email_hash") or ""),
        display_name=str(row["display_name"]) if row.get("display_name") else None,
        status=str(row.get("status") or "active"),
        created_at=_when(row.get("created_at")),
    )


def _account_to_row(account: ParentAccount) -> dict[str, Any]:
    return {
        "account_id": account.account_id,
        "email_hash": account.email_hash,
        "display_name": account.display_name,
        "status": account.status,
    }


def _link_from_row(row: dict[str, Any]) -> ChildLink:
    relationship = str(row.get("relationship") or "linked_parent")
    return ChildLink(
        id=str(row.get("id") or ""),
        parent_account_id=str(row.get("parent_account_id") or ""),
        link_id=str(row.get("link_id") or ""),
        learner_id=str(row.get("learner_id") or ""),
        relationship=relationship if relationship in RELATIONSHIPS else DEFAULT_RELATIONSHIP,
        claimed_at=_when(row.get("claimed_at")),
    )


def _link_to_row(link: ChildLink) -> dict[str, Any]:
    return {
        "id": link.id,
        "parent_account_id": link.parent_account_id,
        "link_id": link.link_id,
        "learner_id": link.learner_id,
        "relationship": link.relationship,
        "claimed_at": _iso(link.claimed_at),
    }


def _fact_from_row(row: dict[str, Any]) -> MindFact:
    source = str(row.get("source") or "")
    if source not in ("parent", "report"):
        # The check constraint says this cannot happen. If a row ever arrives saying otherwise,
        # it is read as the parent's own rather than trusted, and it never becomes a wider claim.
        source = "parent"
    return MindFact(
        id=str(row.get("id") or ""),
        parent_account_id=str(row.get("parent_account_id") or ""),
        learner_id=str(row["learner_id"]) if row.get("learner_id") else None,
        body=str(row.get("body") or ""),
        source=source,
        status=str(row.get("status") or "active"),
        created_at=_when(row.get("created_at")),
        retired_at=_when(row.get("retired_at")),
    )


def _fact_to_row(fact: MindFact) -> dict[str, Any]:
    return {
        "id": fact.id,
        "parent_account_id": fact.parent_account_id,
        "learner_id": fact.learner_id,
        "body": fact.body,
        "source": fact.source,
        "status": fact.status,
        "retired_at": _iso(fact.retired_at),
    }


def _offer_from_row(row: dict[str, Any]) -> Offer:
    return Offer(
        id=str(row.get("id") or ""),
        parent_account_id=str(row.get("parent_account_id") or ""),
        learner_id=str(row.get("learner_id") or ""),
        body=str(row.get("body") or ""),
        fact_key=str(row.get("fact_key") or ""),
        status=str(row.get("status") or "pending"),
        created_at=_when(row.get("created_at")),
        decided_at=_when(row.get("decided_at")),
        removed_at=_when(row.get("removed_at")),
    )


def _offer_to_row(offer: Offer) -> dict[str, Any]:
    return {
        "id": offer.id,
        "parent_account_id": offer.parent_account_id,
        "learner_id": offer.learner_id,
        "body": offer.body,
        "fact_key": offer.fact_key,
        "status": offer.status,
        "decided_at": _iso(offer.decided_at),
        "removed_at": _iso(offer.removed_at),
    }


def _selection_from_row(row: dict[str, Any]) -> Selection:
    return Selection(
        parent_account_id=str(row.get("parent_account_id") or ""),
        learner_id=str(row.get("learner_id") or ""),
        scope=str(row.get("scope") or ""),
        selected_at=_when(row.get("selected_at")),
    )


_store: ParentStore | None = None
_store_lock = threading.Lock()


def build_store() -> ParentStore:
    """The project store when configured, else the in-memory one. ``PARENT_ACCOUNTS_STORE=memory``
    forces the latter — what the suite and a local run use."""
    if (os.getenv("PARENT_ACCOUNTS_STORE") or "").strip().lower() == "memory":
        return InMemoryParentStore()
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if base and key:
        return PostgrestParentStore(base, key)
    logger.info("parent accounts: no project configured, keeping the parent plane in memory")
    return InMemoryParentStore()


def get_store() -> ParentStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: ParentStore | None) -> None:
    """Test seam."""
    global _store
    with _store_lock:
        _store = store


# --- the audit ----------------------------------------------------------------------------------
def audit(
    store: ParentStore,
    *,
    parent_account_id: str,
    action: str,
    learner_id: str | None = None,
    decision: str = "allowed",
    method: str | None = None,
    path: str | None = None,
    status_code: int | None = None,
    ip_hash: str | None = None,
    **detail: Any,
) -> None:
    """One row in ``parent.access_audit``: who looked, at what, when.

    ``detail`` is counts, ids and filters. It is NOT a place to copy a child's content into, and
    nothing that reaches it here is free text from a learner or from a parent — the callers pass
    lengths and kinds, never bodies. Denials are recorded too: a wall of ``denied`` rows against
    one account is somebody trying doors, and that is the reason they are kept at all.
    """
    row = {
        "parent_account_id": parent_account_id,
        "learner_id": learner_id,
        "action": action[:120],
        "decision": decision if decision in ("allowed", "denied") else "denied",
        "method": method,
        "path": path[:512] if path else None,
        "status_code": status_code,
        "ip_hash": ip_hash,
        "detail": {k: v for k, v in detail.items() if isinstance(v, (int, float, str, bool))},
    }
    try:
        store.audit(row)
    except Exception as exc:  # a recorder that is down does not fail a parent's request
        logger.warning("parent audit: not recorded", extra={"fields": {"error": str(exc)}})


# --- who is calling -----------------------------------------------------------------------------
def require_parent(principal: Any, store: ParentStore | None = None) -> ParentAccount:
    """The parent account behind this token, or :class:`NotAParentAccount`.

    Anonymous is refused first: a parent account is created at sign-up and an anonymous subject
    has never signed up for anything. Then the register is consulted, and its answer is the whole
    of the decision — nothing a client asserts about itself is read here, which is the point.
    """
    if principal is None or getattr(principal, "anonymous", False):
        raise NotAParentAccount()
    subject = str(getattr(principal, "subject", "") or "")
    if not subject:
        raise NotAParentAccount()
    account = (store or get_store()).account(subject)
    if account is None or not account.active:
        raise NotAParentAccount()
    return account


def is_parent_account(subject: str, store: ParentStore | None = None) -> bool:
    """Is this account a parent's? Used by the learner surface to refuse learner state on one."""
    if not subject:
        return False
    try:
        return (store or get_store()).account(subject) is not None
    except StoreUnavailable:
        return False


# --- sign-up, and the families that predate this file --------------------------------------------
def sign_up(
    store: ParentStore,
    *,
    account_id: str,
    email: str,
    display_name: str | None = None,
) -> tuple[ParentAccount, list[Child]]:
    """Make this account a parent account, and pick up every family already linked to its address.

    Which kind an account is, is settled here and on the server: the row is written with the
    service role from the address the verified token carries, and migration 0019's triggers make
    the two kinds mutually exclusive for life. An account that already holds learner state cannot
    become a parent account, and this one will never grow learner state.
    """
    from wobo_gateway import parents

    digest = parents.email_hash(email)
    if digest is None:
        raise StoreUnavailable("the parent plane has no signing key configured")
    existing = store.account(account_id)
    if existing is not None:
        account = existing
    else:
        account = store.put_account(
            ParentAccount(
                account_id=account_id,
                email_hash=digest,
                display_name=normalise_display_name(display_name),
                status="active",
                created_at=datetime.now(UTC),
            )
        )
    claimed = claim_links(store, account)
    logger.info(
        "parent account: signed up",
        extra={"fields": {"account": account_id, "claimed": len(claimed)}},
    )
    return account, claimed


def claim_links(store: ParentStore, account: ParentAccount) -> list[Child]:
    """Turn every email-hash link that names this parent's address into a real relationship.

    This is the migration path for (b), and it runs on every sign-in rather than once: a learner
    who invites their parent AFTER the parent already has an account is picked up the next time
    the parent looks, with nobody re-inviting anybody.
    """
    from wobo_gateway import parents

    link_store = parents.get_store()
    by_hash = getattr(link_store, "by_email_hash", None)
    if by_hash is None:
        return []
    rows: Iterable[Any] = by_hash(account.email_hash)
    claimed: list[Child] = []
    for row in rows:
        if row.status != "linked":
            continue
        held = store.link_by_link_id(row.id)
        if held is not None and held.parent_account_id != account.account_id:
            # Another parent account already holds this consent row. Not ours to take.
            continue
        link = ChildLink(
            id=held.id if held else str(uuid.uuid4()),
            parent_account_id=account.account_id,
            link_id=row.id,
            learner_id=row.learner_id,
            # Every new binding is a linked parent. The under-13 case has no producer on the
            # server yet (see RELATIONSHIPS), and inventing one here would be a guess about a
            # child's age written into a permission record.
            relationship=held.relationship if held else DEFAULT_RELATIONSHIP,
            claimed_at=held.claimed_at if held else datetime.now(UTC),
        )
        try:
            store.put_link(link)
        except StoreUnavailable:
            continue
        claimed.append(
            Child(
                learner_id=row.learner_id,
                link_id=row.id,
                name=row.learner_name,
                relationship=link.relationship,
                linked_at=row.linked_at,
            )
        )
    return claimed


# --- the children, and the switch -----------------------------------------------------------------
def children(store: ParentStore, account: ParentAccount) -> list[Child]:
    """The children this parent holds RIGHT NOW: every binding whose consent row still says linked.

    The consent is re-read on every call and never cached. A learner who ended the link a second
    ago is not in this list, which is what "revocation must stop access at once rather than
    leaving a cached view alive" means in code.
    """
    from wobo_gateway import parents

    link_store = parents.get_store()
    out: list[Child] = []
    for binding in store.links(account.account_id):
        try:
            row = link_store.get(binding.link_id)
        except Exception:
            raise StoreUnavailable("the parent link could not be read") from None
        if row is None or row.status != "linked" or row.learner_id != binding.learner_id:
            continue
        out.append(
            Child(
                learner_id=binding.learner_id,
                link_id=binding.link_id,
                name=row.learner_name,
                relationship=binding.relationship,
                linked_at=row.linked_at,
            )
        )
    return sorted(out, key=lambda c: (c.name or "", c.learner_id))


def switch(store: ParentStore, account: ParentAccount, learner_id: str) -> tuple[Child, Selection]:
    """Choose which child everything after this is about. A selection, never a claim.

    The learner id in the request is a CANDIDATE. It is checked against the live list above and
    then written to the server; every scoped read afterwards re-derives the child from that row
    rather than trusting the body again. A fresh ``scope`` is minted so the device drops whatever
    it was holding for the last child: two learners on one device is the whole point of this
    surface, and it is the one place the memory law has to be enforced against the cache.
    """
    match = next((c for c in children(store, account) if c.learner_id == learner_id), None)
    if match is None:
        raise NoSuchChild()
    selection = store.put_selection(
        Selection(
            parent_account_id=account.account_id,
            learner_id=match.learner_id,
            scope=str(uuid.uuid4()),
            selected_at=datetime.now(UTC),
        )
    )
    return match, selection


def selected(store: ParentStore, account: ParentAccount) -> tuple[Child, Selection]:
    """The child currently selected, re-checked against the live consent on every call.

    If the link ended while a selection stood, the selection is cleared and the parent is asked to
    choose again. A stale selection is exactly the cached view revocation is supposed to kill.
    """
    selection = store.selection(account.account_id)
    if selection is None:
        raise NoChildSelected()
    match = next(
        (c for c in children(store, account) if c.learner_id == selection.learner_id), None
    )
    if match is None:
        store.clear_selection(account.account_id)
        raise NoChildSelected()
    return match, selection


def holds_learner_data(subject: str) -> bool:
    """Has this account already done something as a learner? Read before it may become a parent.

    The kinds are mutually exclusive for life, so the moment of choosing is the moment to check,
    and checking one table was not checking. :mod:`wobo_gateway.memory` owns the learner tables
    and answers it there.
    """
    from wobo_gateway import memory

    try:
        return memory.holds_learner_data(subject)
    except Exception:  # a question we cannot answer is answered the safe way
        logger.warning("parent account: learner footprint unreadable")
        return True


def stands_down(store: ParentStore, parent_account_id: str) -> bool:
    """Does this parent account hold NO live child at all any more?

    Read after a revoke. The family layer of a parent's mind is not about one child, so nothing
    learner-scoped retires it — which meant "we are moving cities in July" survived a revoke, a
    re-link, and every read in between, and ``POST /v1/parent/mind {scope:"family"}`` stayed open
    to a parent whose every link was gone.
    """
    try:
        return not children(store, ParentAccount(account_id=parent_account_id, email_hash=""))
    except StoreUnavailable:
        return False


def revoke_everything_about(store: ParentStore, learner_id: str) -> int:
    """A learner is being forgotten: the parent plane lets go of them entirely.

    Called from the erase path. The bindings go, the selection goes, and
    :mod:`wobo_gateway.parent_mind` retires the parent's memory of them — retirement being
    one-way, so re-linking never brings back what the parent knew.
    """
    from wobo_gateway import parent_mind

    gone = store.forget_learner(learner_id)
    parent_mind.retire_everything_about(store, learner_id)
    return gone


__all__ = [
    "FORBIDDEN_OF_A_CHILD",
    "DEFAULT_RELATIONSHIP",
    "PARENT_ACTIONS",
    "READABLE_OF_A_CHILD",
    "RELATIONSHIPS",
    "Child",
    "ChildLink",
    "InMemoryParentStore",
    "MindFact",
    "Offer",
    "NoChildSelected",
    "NoSuchChild",
    "NotAParentAccount",
    "ParentAccount",
    "ParentStore",
    "PostgrestParentStore",
    "Selection",
    "StoreUnavailable",
    "audit",
    "children",
    "holds_learner_data",
    "claim_links",
    "get_store",
    "is_parent_account",
    "readable_for",
    "require_parent",
    "revoke_everything_about",
    "selected",
    "set_store",
    "sign_up",
    "stands_down",
    "switch",
]
