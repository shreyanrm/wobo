"""The board a learner may change once, and the person who handles it after that.

``docs/CONSOLE-ROLES-AND-BOARD.md`` §1 is the law. The owner's sentence is the whole of it:
*"If the user wants to change their board in settings, they can, but only for the first time it
lets them reselect. The next time onwards when they want to change again, show them a button to
contact support and we will handle it from there."*

**Why the rule is right, so nobody softens it later.** A syllabus is the spine of everything a
learner has: their climb, their progress, their cached levels, the parent's view. Changing a board
throws all of that away and re-anchors the plan, and a child who switches boards weekly to see
what is behind each one wrecks their own record and costs a re-render of every level. A genuine
change happens when a family moves city or a school changes affiliation, which is roughly once.

**Why this lives in the gateway and not in the app.** The learner app can be rebuilt by anybody
with a browser. A rule enforced in a bundle is a suggestion. So the count, the refusal and the
queue are here, and the app's job is to draw what this module answers.

**A BOARD change, not a class change.** The rule counts a move from one board to another. A
learner goes up a class every September and a rule that spent their one change on growing up would
be a defect wearing a law's clothes. The trail records the class on every row either way, so a
class move is still stamped on the account and still readable in the console; it simply does not
count. §1's own reasons are all about boards, and this file says so out loud rather than leaving
the next reader to guess which way it went.

**What the learner ever reads.** Three facts before they confirm (the climb re-anchors, their
record stays, and the old board's topics are KEPT and marked with where they came from), and
after that one line and one button. §1's last sentence is a hard rule and :data:`NEVER_SAID` in
the suite enforces it: nothing here mentions money, a limit, a policy, an allowance or a count.
It says a person will look at it, because a person will.

**The dials, live and audited** (``ops.settings``, migration 0024, no deploy):

=================================  =============================================================
``board.free_changes``             how many changes before a person is needed. Default 1.
``board.parent_change_counts``     whether a change made from a parent's account counts against
                                   the learner's. Default true.
``board.rule_off_for``             the cohorts the rule is off for. Default none.
=================================  =============================================================

A cohort is a name this gateway can actually evaluate today, and there are three of them:
``everyone``, ``board:<framework_id>`` (the board they are on now, which is what a school changing
affiliation looks like), and ``plan:<plan>``. A name outside that set matches nobody, which is the
safe direction: an unrecognised cohort leaves the rule ON.

**Two tables, migration 0031.** ``learner.board_changes`` is the stamp on the account, append
only, one row per change. ``ops.board_change_requests`` is the console's queue, one open row per
learner. There is no third table for the grant: granting is a state on the request, and the
allowance of one is reset by counting only the changes made SINCE the newest granted request. A
grant that were its own row would be a second place to look for the same fact.

**Nothing is invented when the store cannot be reached.** An empty trail from an unreachable store
reads as "you have never changed your board", which would hand out a change nobody is owed. So a
store that cannot answer refuses (503) rather than answering from nothing, exactly as
:mod:`wobo_gateway.reports` does and for the same reason.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field, StrictBool, StrictInt

from wobo_gateway import doors
from wobo_gateway.admin_auth import (
    ADMIN_MANAGE,
    CONSOLE_READ,
    SUPPORT_ACT,
    AdminContext,
    admin_router,
    requires,
)
from wobo_gateway.reports import handle

logger = logging.getLogger("wobo.gateway.board_change")

LEARNER_SCHEMA = "learner"
CHANGES_TABLE = "board_changes"
OPS_SCHEMA = "ops"
REQUESTS_TABLE = "board_change_requests"
_HTTP_TIMEOUT_S = 5.0

#: Who made a change. An operator's own change is a correction and never counts against anybody.
MAKERS: tuple[str, ...] = ("learner", "parent", "operator")
#: Who this gateway ACTUALLY writes today. ``parent`` is in the schema and in the counting rule, and
#: nothing writes it: §1's "under 13, the parent does it" needs an age signal on the server (there
#: is none; ``under_13`` is unknown almost everywhere) and a fifth parent action, which the parent
#: plane refuses (``parent_account.PARENT_ACTIONS`` holds four, and ``boards`` is on its forbidden
#: list). Both are the owner's to rule on. Until then the parent dial governs nothing, and the
#: console is told so by :data:`PARENT_CHANGES_POSSIBLE` rather than left to believe otherwise.
MAKERS_WRITTEN: tuple[str, ...] = ("learner",)
PARENT_CHANGES_POSSIBLE = "parent" in MAKERS_WRITTEN
#: Where a request stands. ``granted`` is the only state that hands back a change.
REQUEST_STATES: tuple[str, ...] = ("new", "granted", "declined")

MAX_FRAMEWORK_ID = 120
MAX_LEVEL = 60


# --- the dials ------------------------------------------------------------------------------------
FREE_CHANGES_KEY = "board.free_changes"
PARENT_COUNTS_KEY = "board.parent_change_counts"
RULE_OFF_KEY = "board.rule_off_for"

#: §1: "how many free changes a learner gets before support is needed (default 1)".
DEFAULT_FREE_CHANGES = 1
#: §1: "whether a parent's change counts against the learner's". It does, unless turned off.
DEFAULT_PARENT_COUNTS = True
#: The widest a dial may be set. A hundred changes is not a rule any more, and a negative number
#: would be a rule nobody could ever satisfy.
MAX_FREE_CHANGES = 100

COHORT_EVERYONE = "everyone"

#: How long the gateway serves what it last read before asking again. Same shape and the same cap
#: as the door's, because they are the same table and an operator turning one expects both to
#: follow within under a minute.
DEFAULT_REFRESH_S = 30.0
MAX_REFRESH_S = 60.0

_dial_lock = threading.Lock()
_dials: dict[str, Any] = {}
_dials_read_at: float | None = None


def reset_dials() -> None:
    """Drop what was last read. The next read asks ``ops.settings`` again."""
    global _dials, _dials_read_at
    with _dial_lock:
        _dials = {}
        _dials_read_at = None


def refresh_interval_s() -> float:
    raw = os.getenv("BOARD_DIALS_REFRESH_S") or os.getenv("DIALS_REFRESH_S")
    try:
        wanted = float(raw) if raw is not None else DEFAULT_REFRESH_S
    except ValueError:
        wanted = DEFAULT_REFRESH_S
    return max(0.0, min(wanted, MAX_REFRESH_S))


def dial_keys() -> tuple[str, ...]:
    return (FREE_CHANGES_KEY, PARENT_COUNTS_KEY, RULE_OFF_KEY)


def _dial_values() -> dict[str, Any]:
    """The three dials as last read. Never raises: a dial we cannot read is a dial nobody set."""
    global _dials, _dials_read_at
    import time

    now = time.monotonic()
    with _dial_lock:
        fresh = _dials_read_at is not None and (now - _dials_read_at) < refresh_interval_s()
        if fresh:
            return dict(_dials)
    try:
        store = doors.get_store()
        bulk = getattr(store, "read_many", None)
        found = (
            dict(bulk(dial_keys()))
            if callable(bulk)
            else {key: store.read(key) for key in dial_keys()}
        )
    except Exception as exc:  # noqa: BLE001 — a dial we cannot read is a dial that is not set
        logger.warning("board dials: could not read ops.settings (%s: %s)", type(exc).__name__, exc)
        found = {}
    with _dial_lock:
        _dials = {key: value for key, value in found.items() if value is not None}
        _dials_read_at = now
        return dict(_dials)


def free_changes() -> int:
    """How many changes a learner makes before a person is needed. §1's default is 1."""
    held = _dial_values().get(FREE_CHANGES_KEY)
    if isinstance(held, bool) or not isinstance(held, int | float):
        return DEFAULT_FREE_CHANGES
    return max(0, min(int(held), MAX_FREE_CHANGES))


def parent_change_counts() -> bool:
    held = _dial_values().get(PARENT_COUNTS_KEY)
    return DEFAULT_PARENT_COUNTS if not isinstance(held, bool) else held


def rule_off_for() -> tuple[str, ...]:
    """The cohorts the rule is off for. A name this gateway cannot evaluate matches nobody."""
    held = _dial_values().get(RULE_OFF_KEY)
    if isinstance(held, str):
        held = [part.strip() for part in held.split(",")]
    if not isinstance(held, list | tuple):
        return ()
    return tuple(str(name).strip().lower() for name in held if str(name).strip())


def valid_cohort(name: str) -> bool:
    """True for a cohort name this gateway can evaluate. The console refuses any other.

    Reading is forgiving (an unknown name matches nobody, which leaves the rule ON); writing is
    not, because an owner who types a cohort the gateway cannot evaluate would believe the rule
    is off for somebody when it is off for nobody.
    """
    text = name.strip().lower()
    if text == COHORT_EVERYONE:
        return True
    kind, _, value = text.partition(":")
    return kind in ("board", "plan") and bool(value.strip()) and len(text) <= MAX_FRAMEWORK_ID


def dials_view() -> dict[str, Any]:
    """The three dials as the gateway is obeying them right now, defaults included."""
    return {
        "free_changes": free_changes(),
        "parent_change_counts": parent_change_counts(),
        "rule_off_for": list(rule_off_for()),
    }


def cohorts_of(*, framework_id: str | None, plan: str | None) -> frozenset[str]:
    """The cohort names this learner is in. Three, and every one of them computable today."""
    names = {COHORT_EVERYONE}
    if framework_id:
        names.add(f"board:{framework_id.strip().lower()}")
    if plan:
        names.add(f"plan:{plan.strip().lower()}")
    return frozenset(names)


# --- the words a learner reads --------------------------------------------------------------------
#: The three facts of §1, shown BEFORE the change and never after it. Every one is true of what
#: the product actually does, and the third one carries the word that matters: kept.
#:
#: The second line used to say progress was "re-mapped onto the new syllabus". It was not:
#: completion is filed under each board's own topic ids (``screens/learn/mastery.ts``), so a
#: topic finished on one board is not finished on another. The lines now say what happens, and
#: the third is backed by the kept record the You screen draws (``screens/you/kept.ts``).
COST: tuple[str, ...] = (
    "Your climb starts again from where the new board puts you.",
    "Everything you have done stays in your record.",
    "Topics from your old board are kept, marked with the board they came from.",
)

#: §1: "one line saying a board change needs a person". Never a wall of text, never a rule.
NEEDS_A_PERSON = "A board change from here needs a person. Ask us and somebody will look at it."
#: The one button, in the owner's own words.
BUTTON = "Ask us to change it"
#: What the product says the moment the request is in. It promises a person and nothing else.
ASKED = "I have this. A person will look at it."
#: What it says once an operator has granted one. The product tells them it is done.
GRANTED_LINE = "Somebody looked at this. Your board is yours to change again."
#: Under 13 the parent does it, from the parent's account (§1).
PARENT_DOES_IT = "A parent changes this from their account."


# --- what a change and a request are --------------------------------------------------------------
@dataclass(frozen=True)
class Change:
    """One row of ``learner.board_changes``: the stamp on the account."""

    at: datetime
    from_framework_id: str | None
    from_level: str | None
    to_framework_id: str
    to_level: str | None
    by: str = "learner"
    id: int | None = None
    subject_id: str | None = None
    granted_by: str | None = None

    @property
    def moved_board(self) -> bool:
        """True when this row moved from one BOARD to another, which is what the rule counts."""
        return bool(self.from_framework_id) and self.from_framework_id != self.to_framework_id

    def as_row(self) -> dict[str, Any]:
        return {
            "subject_id": self.subject_id,
            "at": _iso(self.at),
            "from_framework_id": self.from_framework_id,
            "from_level": self.from_level,
            "to_framework_id": self.to_framework_id,
            "to_level": self.to_level,
            "by": self.by,
            "granted_by": self.granted_by,
        }


@dataclass(frozen=True)
class ChangeRequest:
    """One row of ``ops.board_change_requests``: what an operator works.

    It carries the two boards and when they last changed, and nothing else. There is no note
    field, no reply address and no free text on purpose: §1 says the form carries "their current
    board and the one they want and nothing else", so there is nowhere here for anything else to
    be put.
    """

    id: str
    subject_id: str
    at: datetime
    current_framework_id: str | None
    current_level: str | None
    wanted_framework_id: str
    wanted_level: str | None
    raised_by: str = "learner"
    state: str = "new"
    last_changed_at: datetime | None = None
    decided_at: datetime | None = None
    decided_by: str | None = None

    def as_row(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "subject_id": self.subject_id,
            "at": _iso(self.at),
            "current_framework_id": self.current_framework_id,
            "current_level": self.current_level,
            "wanted_framework_id": self.wanted_framework_id,
            "wanted_level": self.wanted_level,
            "raised_by": self.raised_by,
            "state": self.state,
            "last_changed_at": _iso(self.last_changed_at),
            "decided_at": _iso(self.decided_at),
            "decided_by": self.decided_by,
        }

    def as_desk_view(self) -> dict[str, Any]:
        """What the console sees. A keyed handle, never the learner's id and never a name.

        The same digest ``ops.reports`` uses, so one person shows as one handle across every desk
        an operator works, and it is still not matchable against an id learned anywhere else.
        """
        return {
            "id": self.id,
            "raised_at": _iso(self.at),
            "current": {
                "framework_id": self.current_framework_id,
                "level": self.current_level,
            },
            "wanted": {"framework_id": self.wanted_framework_id, "level": self.wanted_level},
            "last_changed_at": _iso(self.last_changed_at),
            "raised_by": self.raised_by,
            "state": self.state,
            "decided_at": _iso(self.decided_at),
            "handle": handle(self.subject_id),
        }


@dataclass(frozen=True)
class Standing:
    """Where a learner stands: what they are on, and whether the picker is theirs to use."""

    board: dict[str, str | None]
    used: int
    free_changes: int
    may_change: bool
    last_changed_at: datetime | None
    granted: bool
    rule_off: bool

    @property
    def left(self) -> int:
        return max(0, self.free_changes - self.used)


def standing(
    changes: Sequence[Change],
    *,
    free_changes: int,
    granted_at: datetime | None,
    parent_counts: bool,
    rule_off: bool = False,
) -> Standing:
    """The whole rule, as one pure function over the trail. Everything else is plumbing.

    ``granted_at`` is when an operator last granted a request, and it is what "resets their
    allowance of one" means: changes made before it are spent history and count against nobody.
    """
    ordered = sorted(changes, key=lambda change: change.at)
    counted = [
        change
        for change in ordered
        if change.moved_board
        and change.by != "operator"
        and (change.by != "parent" or parent_counts)
        and (granted_at is None or change.at > granted_at)
    ]
    latest = ordered[-1] if ordered else None
    return Standing(
        board={
            "framework_id": latest.to_framework_id if latest else None,
            "level": latest.to_level if latest else None,
        },
        used=len(counted),
        free_changes=free_changes,
        may_change=rule_off or len(counted) < free_changes,
        last_changed_at=latest.at if latest else None,
        granted=granted_at is not None and not counted,
        rule_off=rule_off,
    )


# --- the store seam -------------------------------------------------------------------------------
class Unavailable(Exception):
    """The trail could not be reached. Never answered from nothing; see the module note."""


class BoardChangeStore(Protocol):
    def changes(self, subject: str) -> list[Change]: ...

    def record(self, change: Change) -> Change: ...

    def open_request(self, subject: str) -> ChangeRequest | None: ...

    def put_request(self, request: ChangeRequest) -> ChangeRequest: ...

    def get_request(self, request_id: str) -> ChangeRequest | None: ...

    def queue(self, *, state: str | None, limit: int) -> list[ChangeRequest]: ...

    def granted_at(self, subject: str) -> datetime | None: ...


class InMemoryBoardChangeStore:
    """The suite's store and a local run's. Never reached in production."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._changes: list[Change] = []
        self._requests: dict[str, ChangeRequest] = {}

    def changes(self, subject: str) -> list[Change]:
        with self._lock:
            return [row for row in self._changes if row.subject_id == subject]

    def record(self, change: Change) -> Change:
        with self._lock:
            stored = Change(**{**change.__dict__, "id": len(self._changes) + 1})
            self._changes.append(stored)
            return stored

    def open_request(self, subject: str) -> ChangeRequest | None:
        with self._lock:
            open_rows = [
                row
                for row in self._requests.values()
                if row.subject_id == subject and row.state == "new"
            ]
            return max(open_rows, key=lambda row: row.at) if open_rows else None

    def put_request(self, request: ChangeRequest) -> ChangeRequest:
        with self._lock:
            self._requests[request.id] = request
            return request

    def get_request(self, request_id: str) -> ChangeRequest | None:
        with self._lock:
            return self._requests.get(request_id)

    def queue(self, *, state: str | None, limit: int) -> list[ChangeRequest]:
        with self._lock:
            rows = list(self._requests.values())
        if state:
            rows = [row for row in rows if row.state == state]
        # Open work first, then newest: a queue is worked from the top.
        rows.sort(key=lambda row: (row.state != "new", -row.at.timestamp()))
        return rows[:limit]

    def granted_at(self, subject: str) -> datetime | None:
        with self._lock:
            stamps = [
                row.decided_at
                for row in self._requests.values()
                if row.subject_id == subject and row.state == "granted" and row.decided_at
            ]
        return max(stamps) if stamps else None

    # test convenience, never called by a route
    def all_requests(self) -> list[ChangeRequest]:
        with self._lock:
            return list(self._requests.values())


class UnconfiguredBoardChangeStore:
    """No project, and therefore no trail. Every read refuses; nothing is answered from nothing."""

    _WHY = "no project is configured, so there is no record of anybody's board"

    def changes(self, subject: str) -> list[Change]:
        raise Unavailable(self._WHY)

    def record(self, change: Change) -> Change:
        raise Unavailable(self._WHY)

    def open_request(self, subject: str) -> ChangeRequest | None:
        raise Unavailable(self._WHY)

    def put_request(self, request: ChangeRequest) -> ChangeRequest:
        raise Unavailable(self._WHY)

    def get_request(self, request_id: str) -> ChangeRequest | None:
        raise Unavailable(self._WHY)

    def queue(self, *, state: str | None, limit: int) -> list[ChangeRequest]:
        raise Unavailable(self._WHY)

    def granted_at(self, subject: str) -> datetime | None:
        raise Unavailable(self._WHY)


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat() if value else None


def _when(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return None


def change_from_row(row: dict[str, Any]) -> Change:
    return Change(
        id=row.get("id"),
        subject_id=str(row.get("subject_id") or "") or None,
        at=_when(row.get("at")) or datetime.now(UTC),
        from_framework_id=row.get("from_framework_id"),
        from_level=row.get("from_level"),
        to_framework_id=str(row.get("to_framework_id") or ""),
        to_level=row.get("to_level"),
        by=str(row.get("by") or "learner"),
        granted_by=row.get("granted_by"),
    )


def request_from_row(row: dict[str, Any]) -> ChangeRequest:
    return ChangeRequest(
        id=str(row.get("id") or ""),
        subject_id=str(row.get("subject_id") or ""),
        at=_when(row.get("at")) or datetime.now(UTC),
        current_framework_id=row.get("current_framework_id"),
        current_level=row.get("current_level"),
        wanted_framework_id=str(row.get("wanted_framework_id") or ""),
        wanted_level=row.get("wanted_level"),
        raised_by=str(row.get("raised_by") or "learner"),
        state=str(row.get("state") or "new"),
        last_changed_at=_when(row.get("last_changed_at")),
        decided_at=_when(row.get("decided_at")),
        decided_by=row.get("decided_by"),
    )


_NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, ValueError, OSError)


def _request(url: str, key: str, method: str, schema: str, *, body: Any = None) -> Any:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Accept-Profile": schema,
        "Content-Profile": schema,
        "Prefer": "return=representation",
    }
    data = json.dumps(body).encode() if body is not None else None
    call = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(call, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode()
    return json.loads(raw) if raw.strip() else []


class PostgrestBoardChangeStore:
    """``learner.board_changes`` and ``ops.board_change_requests`` with the service-role key.

    Server side only. The queue has row level security on and forced with no policy at all
    (migration 0031), and ``ops`` is closed to every client role (migration 0015), so the service
    key in ``Authorization`` and the ``ops`` profile on every queue call are the only way in. The
    learner's own trail is readable by the learner and writable by nobody but this key (0031).
    """

    def __init__(self, base_url: str, service_key: str, *, request: Any = None) -> None:
        self.base = base_url.rstrip("/")
        self.key = service_key
        self._request = request or _request

    def _url(self, table: str, params: dict[str, str] | None = None) -> str:
        query = f"?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}" if params else ""
        return f"{self.base}/rest/v1/{urllib.parse.quote(table)}{query}"

    def _call(self, table: str, schema: str, method: str, params: dict[str, str], body: Any = None):
        try:
            return self._request(self._url(table, params), self.key, method, schema, body=body)
        except _NETWORK_ERRORS as exc:
            raise Unavailable(f"the board trail did not answer ({type(exc).__name__})") from exc

    def changes(self, subject: str) -> list[Change]:
        rows = self._call(
            CHANGES_TABLE,
            LEARNER_SCHEMA,
            "GET",
            {"select": "*", "subject_id": f"eq.{subject}", "order": "at.asc", "limit": "200"},
        )
        return [change_from_row(row) for row in rows if isinstance(row, dict)]

    def record(self, change: Change) -> Change:
        rows = self._call(CHANGES_TABLE, LEARNER_SCHEMA, "POST", {}, body=change.as_row())
        return change_from_row(rows[0]) if rows and isinstance(rows[0], dict) else change

    def open_request(self, subject: str) -> ChangeRequest | None:
        rows = self._call(
            REQUESTS_TABLE,
            OPS_SCHEMA,
            "GET",
            {
                "select": "*",
                "subject_id": f"eq.{subject}",
                "state": "eq.new",
                "order": "at.desc",
                "limit": "1",
            },
        )
        return request_from_row(rows[0]) if rows and isinstance(rows[0], dict) else None

    def put_request(self, request: ChangeRequest) -> ChangeRequest:
        rows = self._call(
            REQUESTS_TABLE,
            OPS_SCHEMA,
            "POST",
            {"on_conflict": "id"},
            body={**request.as_row(), "id": request.id},
        )
        return request_from_row(rows[0]) if rows and isinstance(rows[0], dict) else request

    def get_request(self, request_id: str) -> ChangeRequest | None:
        rows = self._call(
            REQUESTS_TABLE,
            OPS_SCHEMA,
            "GET",
            {"select": "*", "id": f"eq.{request_id}", "limit": "1"},
        )
        return request_from_row(rows[0]) if rows and isinstance(rows[0], dict) else None

    def queue(self, *, state: str | None, limit: int) -> list[ChangeRequest]:
        params = {"select": "*", "order": "at.desc", "limit": str(limit)}
        if state:
            params["state"] = f"eq.{state}"
        rows = self._call(REQUESTS_TABLE, OPS_SCHEMA, "GET", params)
        found = [request_from_row(row) for row in rows if isinstance(row, dict)]
        found.sort(key=lambda row: (row.state != "new", -row.at.timestamp()))
        return found

    def granted_at(self, subject: str) -> datetime | None:
        rows = self._call(
            REQUESTS_TABLE,
            OPS_SCHEMA,
            "GET",
            {
                "select": "decided_at",
                "subject_id": f"eq.{subject}",
                "state": "eq.granted",
                "order": "decided_at.desc",
                "limit": "1",
            },
        )
        if not rows or not isinstance(rows[0], dict):
            return None
        return _when(rows[0].get("decided_at"))


_store: BoardChangeStore | None = None
_store_lock = threading.Lock()


def build_store() -> BoardChangeStore:
    """Asked for BY NAME, exactly as ``reports.build_store`` is, and for the same reason."""
    wanted = (os.getenv("BOARD_CHANGE_STORE") or "").strip().lower()
    base = os.getenv("SUPABASE_URL") or ""
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or ""
    if wanted == "memory":
        return InMemoryBoardChangeStore()
    if base and key:
        return PostgrestBoardChangeStore(base, key)
    return UnconfiguredBoardChangeStore()


def get_store() -> BoardChangeStore:
    global _store
    with _store_lock:
        if _store is None:
            _store = build_store()
        return _store


def set_store(store: BoardChangeStore | None) -> None:
    global _store
    with _store_lock:
        _store = store


# --- the HTTP seam --------------------------------------------------------------------------------
class ChangeBody(BaseModel):
    framework_id: str = Field(default="", max_length=MAX_FRAMEWORK_ID)
    level: str | None = Field(default=None, max_length=MAX_LEVEL)
    #: §1: the learner confirms what it costs BEFORE it happens. Never defaulted to true.
    confirm: bool = False
    #: WHERE THEY ARE COMING FROM, and it is read ONLY when this gateway holds no trail for them.
    #:
    #: A learner picks their first board in onboarding, which pins a syllabus and does not come
    #: through here, so the first time Settings calls this route the trail is empty and the
    #: gateway has no way of its own to know whether it is watching somebody set a board for the
    #: first time or change one they have had for a year. The app knows, so the app says, once.
    #: Every call after that reads the board off the trail and ignores this field entirely.
    #:
    #: A caller who lies here gains nothing worth having: claiming they already follow the board
    #: they are asking for writes an anchor rather than a change, which leaves them on that board
    #: with their one change unspent and the next real move still counted. Claiming a board they
    #: do not follow writes a change and SPENDS it.
    current_framework_id: str | None = Field(default=None, max_length=MAX_FRAMEWORK_ID)
    current_level: str | None = Field(default=None, max_length=MAX_LEVEL)


class AskBody(BaseModel):
    framework_id: str = Field(default="", max_length=MAX_FRAMEWORK_ID)
    level: str | None = Field(default=None, max_length=MAX_LEVEL)
    #: The same one-time anchor as above, for a learner who asks before they have ever changed.
    current_framework_id: str | None = Field(default=None, max_length=MAX_FRAMEWORK_ID)
    current_level: str | None = Field(default=None, max_length=MAX_LEVEL)


class DialsBody(BaseModel):
    """The three dials. A field left out is left alone; a body with none of them is refused."""

    free_changes: StrictInt | None = Field(default=None, ge=0, le=MAX_FREE_CHANGES)
    parent_change_counts: StrictBool | None = None
    rule_off_for: list[str] | None = Field(default=None, max_length=50)
    note: str | None = Field(default=None, max_length=280)


class GrantBody(BaseModel):
    id: str = Field(default="", max_length=64)


def _clean(value: str | None, *, cap: int) -> str | None:
    text = (value or "").strip()
    return text[:cap] or None


def _learner_of(request: Request) -> str:
    principal = getattr(request.state, "principal", None)
    if principal is None or principal.anonymous or not principal.subject:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "sign_in_required",
                "message": "Sign in and I can show you the board you are on.",
            },
        )
    return str(principal.subject)


def _plan_of(request: Request) -> str | None:
    principal = getattr(request.state, "principal", None)
    return getattr(principal, "plan", None) if principal is not None else None


def unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "code": "board_change_unavailable",
            "message": "I cannot reach your board right now. Try again in a moment.",
        },
    )


def _standing_for(subject: str, *, plan: str | None) -> tuple[Standing, BoardChangeStore]:
    store = get_store()
    try:
        trail = store.changes(subject)
        granted = store.granted_at(subject)
    except Unavailable as exc:
        raise unavailable() from exc
    on_board = trail[-1].to_framework_id if trail else None
    off = bool(set(rule_off_for()) & cohorts_of(framework_id=on_board, plan=plan))
    return (
        standing(
            trail,
            free_changes=free_changes(),
            granted_at=granted,
            parent_counts=parent_change_counts(),
            rule_off=off,
        ),
        store,
    )


def _standing_view(
    where: Standing, *, board: dict[str, str | None] | None = None, pending: ChangeRequest | None
) -> dict[str, Any]:
    """What the app draws. Two shapes, and the app never has to decide which rule applies."""
    view: dict[str, Any] = {
        "board": board if board is not None else where.board,
        "may_change": where.may_change,
        "used": where.used,
        "last_changed_at": _iso(where.last_changed_at),
        "granted": where.granted,
    }
    if where.may_change:
        # Before the change: the three facts, and nothing about what happens afterwards. A
        # learner confirming a move does not need to be told what the next one will cost.
        view["cost"] = list(COST)
        view["line"] = None
        view["button"] = None
    else:
        view["cost"] = []
        view["line"] = NEEDS_A_PERSON
        view["button"] = BUTTON
    view["request"] = (
        {
            "at": _iso(pending.at),
            "wanted": {
                "framework_id": pending.wanted_framework_id,
                "level": pending.wanted_level,
            },
            "message": ASKED,
        }
        if pending is not None
        else None
    )
    if where.granted:
        view["message"] = GRANTED_LINE
    return view


def _pinned_elsewhere(subject: str, wanted: str) -> list[str]:
    """The boards this learner has a syllabus pinned on, other than the one they are asking for.

    A pin is written only when a learner commits to a board (a choice in onboarding, an upgrade,
    an edit, their own syllabus), so it is the gateway's own evidence that they already had one.
    Unreadable pins refuse: answering "none" would hand out an uncounted move.
    """
    from wobo_gateway.curriculum import store as curriculum_store

    try:
        pinned = curriculum_store.get_store().pinned_frameworks(subject)
    except curriculum_store.StoreUnavailable as exc:
        raise Unavailable(f"the syllabus pins did not answer ({exc})") from exc
    return sorted(board for board in pinned if board and board != wanted)


def _where_they_are(
    where: Standing,
    stated_board: str | None,
    stated_level: str | None,
    *,
    subject: str,
    wanted: str,
) -> tuple[str | None, str | None]:
    """The board they are on: this gateway's trail, or, only when it has none, the best evidence.

    See :class:`ChangeBody`. The trail wins the moment there is one, so the stated board can be
    read at most once in an account's life and can never overwrite a recorded change.

    WITH NO TRAIL, THE APP'S WORD IS TAKEN ONLY WHEN IT NAMES A MOVE. A stated board other than
    the one asked for is a change and is counted, so a lie there costs the liar. A missing board,
    or the board they are asking for, would record an anchor, which is never counted; so in those
    two cases the learner's syllabus pins decide. A pin on any other board means they were on a
    board already, and this is their change. No such pin is a learner setting their first board.
    """
    held = where.board.get("framework_id")
    if held:
        return held, where.board.get("level")
    stated = _clean(stated_board, cap=MAX_FRAMEWORK_ID)
    level = _clean(stated_level, cap=MAX_LEVEL)
    if stated and stated != wanted:
        return stated, level
    elsewhere = _pinned_elsewhere(subject, wanted)
    if elsewhere:
        return elsewhere[0], level
    return stated, level


def _pending(store: BoardChangeStore, subject: str) -> ChangeRequest | None:
    try:
        return store.open_request(subject)
    except Unavailable:
        return None


def register_board_change(app: FastAPI) -> None:
    """The learner's three routes and the console's two. Called once from ``app.create_app``."""

    @app.get("/v1/board/change")
    def read_standing(request: Request) -> dict[str, Any]:
        """What board they are on, and whether the picker is theirs to use."""
        subject = _learner_of(request)
        where, store = _standing_for(subject, plan=_plan_of(request))
        return _standing_view(where, pending=_pending(store, subject))

    @app.post("/v1/board/change")
    def change_board(body: ChangeBody, request: Request) -> dict[str, Any]:
        """Take the change, once. The cost is confirmed first and the change is stamped."""
        subject = _learner_of(request)
        wanted = _clean(body.framework_id, cap=MAX_FRAMEWORK_ID)
        level = _clean(body.level, cap=MAX_LEVEL)
        if not wanted:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "needs_a_board",
                    "message": "Tell me which board you follow and I will move you to it.",
                },
            )
        where, store = _standing_for(subject, plan=_plan_of(request))
        try:
            on_board, on_level = _where_they_are(
                where,
                body.current_framework_id,
                body.current_level,
                subject=subject,
                wanted=wanted,
            )
        except Unavailable as exc:
            raise unavailable() from exc
        moving_board = bool(on_board) and on_board != wanted

        # A class move on the same board is not a board change, and neither is choosing the board
        # they are already on. Both are taken whatever the standing says.
        if moving_board and not where.may_change:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "needs_a_person",
                    "message": NEEDS_A_PERSON,
                    "button": BUTTON,
                    "current": where.board,
                    "wanted": {"framework_id": wanted, "level": level},
                },
            )
        if not body.confirm:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "confirm_required",
                    "message": "Read what changes, then confirm and I will move you.",
                    "cost": list(COST),
                },
            )
        if on_board == wanted and on_level == level:
            # Nothing to record. Answering the standing is the honest reply to a no-op.
            return _standing_view(
                where, board={"framework_id": on_board, "level": on_level},
                pending=_pending(store, subject),
            )

        try:
            store.record(
                Change(
                    subject_id=subject,
                    at=datetime.now(UTC),
                    from_framework_id=on_board,
                    from_level=on_level,
                    to_framework_id=wanted,
                    to_level=level,
                    by="learner",
                )
            )
        except Unavailable as exc:
            raise unavailable() from exc
        after, store = _standing_for(subject, plan=_plan_of(request))
        return _standing_view(after, pending=_pending(store, subject))

    @app.post("/v1/board/change/request")
    def ask_a_person(body: AskBody, request: Request) -> dict[str, Any]:
        """The form behind the one button. Two boards, and nothing else on the row."""
        subject = _learner_of(request)
        wanted = _clean(body.framework_id, cap=MAX_FRAMEWORK_ID)
        level = _clean(body.level, cap=MAX_LEVEL)
        if not wanted:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "needs_a_board",
                    "message": "Tell me which board you want and I will pass it on.",
                },
            )
        where, store = _standing_for(subject, plan=_plan_of(request))
        try:
            on_board, on_level = _where_they_are(
                where,
                body.current_framework_id,
                body.current_level,
                subject=subject,
                wanted=wanted,
            )
        except Unavailable as exc:
            raise unavailable() from exc
        standing_open = _pending(store, subject)
        now = datetime.now(UTC)
        row = ChangeRequest(
            # One open row per learner: asking twice moves the board asked for rather than filling
            # an operator's queue with the same person three times.
            id=standing_open.id if standing_open else uuid.uuid4().hex,
            subject_id=subject,
            at=standing_open.at if standing_open else now,
            current_framework_id=on_board,
            current_level=on_level,
            wanted_framework_id=wanted,
            wanted_level=level,
            raised_by="learner",
            state="new",
            last_changed_at=where.last_changed_at,
        )
        try:
            store.put_request(row)
        except Unavailable as exc:
            raise unavailable() from exc
        return {
            "message": ASKED,
            "current": {"framework_id": on_board, "level": on_level},
            "wanted": {"framework_id": wanted, "level": level},
        }

    # --- the console's queue -------------------------------------------------------------------
    router = admin_router()
    _STATE = Query(None, max_length=16)
    _LIMIT = Query(50, ge=1, le=200)

    @router.get("/board-changes")
    def board_change_queue(
        state: str | None = _STATE,
        limit: int = _LIMIT,
        ctx: AdminContext = Depends(requires(CONSOLE_READ)),  # noqa: B008
    ) -> dict[str, Any]:
        """The queue, open work first. A handle per learner, never an id and never a name."""
        wanted = state if state in REQUEST_STATES else None
        try:
            rows = get_store().queue(state=wanted, limit=limit)
        except Unavailable:
            # `readable: false` is the honesty bit every desk shares: we could not ask, which is
            # not the same fact as nobody having asked.
            return {"readable": False, "requests": [], "state": wanted}
        ctx.audit("board.change.queue.read", detail={"state": wanted, "shown": len(rows)})
        return {
            "readable": True,
            "requests": [row.as_desk_view() for row in rows],
            "state": wanted,
            "limit": limit,
            "shown": len(rows),
            "more": len(rows) >= limit,
            "dials": dials_view(),
            "parent_changes_possible": PARENT_CHANGES_POSSIBLE,
        }

    @router.post("/board-changes/dials")
    def turn_board_dials(
        body: DialsBody,
        ctx: AdminContext = Depends(requires(ADMIN_MANAGE)),  # noqa: B008
    ) -> dict[str, Any]:
        """Turn the three dials. Owner work, like every dial that decides who may do what.

        Written to ``ops.settings`` (whose trigger keeps the before and after) and to the
        console's own trail, then read back at once so the answer is what the gateway obeys.
        """
        writes: dict[str, Any] = {}
        if body.free_changes is not None:
            writes[FREE_CHANGES_KEY] = body.free_changes
        if body.parent_change_counts is not None:
            writes[PARENT_COUNTS_KEY] = body.parent_change_counts
        if body.rule_off_for is not None:
            names = [name.strip().lower() for name in body.rule_off_for if name.strip()]
            wrong = [name for name in names if not valid_cohort(name)]
            if wrong:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "code": "not_a_cohort",
                        "message": "A cohort is everyone, board:<id> or plan:<plan>.",
                        "refused": wrong,
                    },
                )
            writes[RULE_OFF_KEY] = sorted(set(names))
        if not writes:
            raise HTTPException(
                status_code=422,
                detail={"code": "nothing_to_turn", "message": "Name at least one dial."},
            )
        # WRITE FIRST, THEN SAY SO. The row below used to be written before the dials were, so a
        # write that failed left the trail describing a turn that never happened. And the dials go
        # in as ONE write, so a failure part-way cannot leave the rule half turned.
        store = doors.get_store()
        try:
            before = store.read_many(list(writes))
            store.write_many(writes, actor=ctx.admin.subject_id, note=body.note)
        except Exception as exc:  # noqa: BLE001 — the settings store names its own failures
            logger.warning("board dials: write failed (%s)", type(exc).__name__)
            raise unavailable() from exc
        reset_dials()
        # ops.settings keeps its own before and after by trigger, so even if this row cannot be
        # written the turn is not unrecorded; the guard has also already written the request row.
        ctx.audit(
            "board.dials.set",
            resource_type="ops.settings",
            detail={"before": before, "after": writes, "note": body.note},
        )
        return {"saved": True, "dials": dials_view()}

    @router.post("/board-changes/grant")
    def grant_board_change(
        body: GrantBody,
        ctx: AdminContext = Depends(requires(SUPPORT_ACT)),  # noqa: B008
    ) -> dict[str, Any]:
        """One button. It hands the change back and writes the row that says who did.

        Support work, not owner work (§1), so ``support.act`` and the step-up the guard already
        demands of every write.
        """
        request_id = (body.id or "").strip()
        store = get_store()
        try:
            found = store.get_request(request_id) if request_id else None
        except Unavailable as exc:
            raise unavailable() from exc
        if found is None:
            raise HTTPException(
                status_code=404,
                detail={"code": "no_such_request", "message": "There is no request by that id."},
            )
        if found.state != "new":
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "already_decided",
                    "message": f"That request was already {found.state}.",
                },
            )
        granted = ChangeRequest(
            **{
                **found.__dict__,
                "state": "granted",
                "decided_at": datetime.now(UTC),
                "decided_by": ctx.admin.id,
            }
        )
        try:
            store.put_request(granted)
        except Unavailable as exc:
            raise unavailable() from exc
        ctx.audit(
            "board.change.grant",
            resource_type="board_change_request",
            resource_id=granted.id,
            detail={
                "current": granted.current_framework_id,
                "wanted": granted.wanted_framework_id,
            },
        )
        return granted.as_desk_view()

    app.include_router(router)


__all__ = [
    "ASKED",
    "BUTTON",
    "COST",
    "COHORT_EVERYONE",
    "DEFAULT_FREE_CHANGES",
    "DEFAULT_PARENT_COUNTS",
    "FREE_CHANGES_KEY",
    "GRANTED_LINE",
    "MAKERS",
    "MAKERS_WRITTEN",
    "PARENT_CHANGES_POSSIBLE",
    "NEEDS_A_PERSON",
    "PARENT_COUNTS_KEY",
    "PARENT_DOES_IT",
    "REQUEST_STATES",
    "RULE_OFF_KEY",
    "Change",
    "ChangeRequest",
    "InMemoryBoardChangeStore",
    "PostgrestBoardChangeStore",
    "Standing",
    "Unavailable",
    "UnconfiguredBoardChangeStore",
    "build_store",
    "cohorts_of",
    "dial_keys",
    "dials_view",
    "free_changes",
    "get_store",
    "parent_change_counts",
    "register_board_change",
    "reset_dials",
    "rule_off_for",
    "set_store",
    "standing",
    "valid_cohort",
]
