"""The four intakes: a flag, a bug, a support message, a refund request.

This module is the WRITE half of the console's four desks (the read half is
:mod:`wobo_gateway.desks_api`). It owns ``ops.reports`` (migration 0017) and the four routes the
product calls to put a row in it. Nothing here is behind the admin door: these are the routes a
learner's app and a subscriber's screen call, and they are the reason the desks have anything to
show.

**The flag is the point of this module.** ``docs/legal/community-and-flags.md`` §2 says, honestly,
that there is no flag control in Wobo and that the mailbox is the whole route, because the promise
of a flag had been made on a help page and not kept. With ``POST /v1/flags`` it can be kept: a
control on a lesson, a board or a diagram sends a reason from a closed list and, if the learner
typed anything, their words. Two reasons — ``upsetting`` and ``unsafe`` — mark the row urgent,
page the moment they arrive, and sit at the top of the queue until somebody closes them. **The
control itself belongs to the learner app**; what it must call is written down at the foot of
this docstring, and nothing else about it is decided here.

**The bug route is an intake, not a tracker.** The owner has GitHub and it is better than anything
this file would grow into. ``POST /v1/report/bug`` records that somebody inside the product said a
thing was broken; the desk reads it and opens an issue. There is no assignee and no thread.

**The support route is a desk, not a chat.** One mailbox, ``support@heywobo.com``, by the owner's
ruling. ``POST /v1/support/message`` records a message raised from inside the product so nothing is
missed. The public contact page is still a ``mailto:`` (``screens/contact/Contact.tsx`` says so in
its own header) and this module does not pretend otherwise.

**The refund route accepts only what the law gives.**
``docs/legal/refund-and-cancellation.md`` §5: we do not refund as a gesture of goodwill, and
cancelling is the answer to a change of mind. So :data:`REASONS` carries exactly five refund
reasons, every one of them owed by law, and the route's own answer points back at cancelling.
There is no value here a learner could pick that would imply a policy we do not have.

**Two stores behind one seam**, as :mod:`wobo_gateway.parents` and :mod:`wobo_gateway.billing`: in
memory for the suite and a local run, PostgREST with the service-role key for the project. Asked
for BY NAME — a deployment that lost its project configuration gets a store that REFUSES rather
than one that answers from an empty dictionary, because an empty desk is a claim ("nothing has come
in") and an unconfigured gateway has no right to make it.

**The intake contract for the learner app**::

    POST /v1/flags            {reason, note?, about?}   signed in OR anonymous
    POST /v1/report/bug       {reason, note?, about?}   signed in OR anonymous
    POST /v1/support/message  {reason, note, reply_to?} signed in
    POST /v1/refund-request   {reason, note, reply_to?} signed in

``reason`` is one of the codes in :data:`REASONS` for that kind; the app sends a code, never free
text. ``note`` is the person's own words — optional on a flag, because a child who taps "this
upset me" and types nothing has made a complete report and the control must not demand more;
required on the two a person has to answer. ``about`` names what was on screen (``{"surface": …,
"content_id": …, "subject": …}``) and is filtered against :data:`ABOUT_KEYS`, which is what
keeps a learner's work out of the operator plane.
"""

from __future__ import annotations

import hashlib
import hmac
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

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from wobo_gateway import alerts

logger = logging.getLogger("wobo.gateway.reports")

SCHEMA = "ops"
TABLE = "reports"
_HTTP_TIMEOUT_S = 5.0

KINDS: tuple[str, ...] = ("flag", "bug", "support", "refund")
STATES: tuple[str, ...] = ("new", "looked_at", "acted_on", "closed")
#: The two states that mean somebody still has to do something. A desk is worked from the top, so
#: these sort above everything settled — a CLOSED urgent flag used to outrank live open work and
#: could fill the whole visible page while open rows sat below the cut.
OPEN_STATES: tuple[str, ...] = ("new", "looked_at")
SOURCES: tuple[str, ...] = ("app", "contact", "email", "api")

#: The closed list per kind, and it is the same list migration 0017 checks in the database. Both
#: copies exist on purpose: the route refuses a bad code with a sentence a person can act on, and
#: the constraint means a future route with a bug in it still cannot write one.
REASONS: dict[str, tuple[str, ...]] = {
    "flag": ("wrong", "confusing", "upsetting", "unsafe", "not_my_syllabus", "other"),
    "bug": ("broken", "slow", "lost_work", "wont_load", "other"),
    "support": ("account", "plan", "parent_link", "privacy", "other"),
    # Exactly docs/legal/refund-and-cancellation.md §5. Nothing may be added without that
    # document changing first.
    "refund": (
        "charged_after_cancelling",
        "charged_twice",
        "not_authorised",
        "not_supplied",
        "cooling_off",
    ),
}

#: The two reasons that mean a child may be upset or at risk. They page, and they jump the queue.
URGENT_REASONS: frozenset[str] = frozenset({"upsetting", "unsafe"})

#: Alarm event name. Deliberately not added to :data:`wobo_gateway.alerts.EVENTS`, whose exact
#: contents the suite asserts as "the six things app.py pages for"; ``alert()`` takes any event
#: name and writes the same greppable line either way.
URGENT_FLAG_ALERT = "ops_urgent_flag"

MAX_NOTE = 2000
MAX_ABOUT_KEYS = 8
MAX_ABOUT_VALUE = 200
#: How many reports one learner may raise in a day. High enough that nobody honest meets it, low
#: enough that a script cannot fill the queue and bury a real flag under noise.
REPORTS_PER_DAY = 20

#: ``about`` is a small, closed set of pointers. A key that is not here is DROPPED rather than
#: stored — the one rule keeping a learner's work out of ``ops.reports``.
ABOUT_KEYS: frozenset[str] = frozenset(
    {
        "surface", "content_id", "subject", "board", "grade", "capability", "route", "build",
        # A ``not_my_syllabus`` flag points at the exact chapter, so the syllabus observer can
        # count it with the removes on that node (docs/CURRICULUM-OBSERVER.md §3). Two opaque ids,
        # never a name and never the learner's edits.
        "version_id", "node_id",
    }
)  # fmt: skip
_ABOUT_VALUE_RE = re.compile(r"^[\w .:@/#+-]{1,200}$")
_EMAIL_RE = re.compile(r'^[^@\s"]+@[^@\s.]+(?:\.[^@\s.]+)+$')

#: Every one of these writes a row to the database and is reachable by anyone holding a token, so
#: all four ride the per-caller limiter in ``app.py``.
LIMITED_PATHS = frozenset(
    {"/v1/flags", "/v1/report/bug", "/v1/support/message", "/v1/refund-request"}
)


# --- the row -------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Report:
    """One row of ``ops.reports`` as the gateway reads and writes it."""

    id: str
    kind: str
    reason: str
    state: str = "new"
    note: str | None = None
    learner_id: str | None = None
    contact_email: str | None = None
    about: dict[str, Any] | None = None
    source: str = "app"
    urgent: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
    acted_by: str | None = None
    acted_by_email: str | None = None
    acted_at: datetime | None = None
    resolution: str | None = None


def _when(value: Any) -> datetime | None:
    if value in (None, ""):
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


def from_row(row: dict[str, Any]) -> Report:
    """A database row, read tolerantly: a column we do not know is ignored."""
    kind = str(row.get("kind") or "flag")
    state = str(row.get("state") or "new")
    about = row.get("about")
    return Report(
        id=str(row.get("id") or ""),
        kind=kind if kind in KINDS else "flag",
        reason=str(row.get("reason") or "other"),
        state=state if state in STATES else "new",
        note=str(row["note"]) if row.get("note") else None,
        learner_id=str(row["learner_id"]) if row.get("learner_id") else None,
        contact_email=str(row["contact_email"]) if row.get("contact_email") else None,
        about=about if isinstance(about, dict) else {},
        source=str(row.get("source") or "app"),
        urgent=row.get("urgent") is True,
        created_at=_when(row.get("created_at")),
        updated_at=_when(row.get("updated_at")),
        acted_by=str(row["acted_by"]) if row.get("acted_by") else None,
        acted_by_email=str(row["acted_by_email"]) if row.get("acted_by_email") else None,
        acted_at=_when(row.get("acted_at")),
        resolution=str(row["resolution"]) if row.get("resolution") else None,
    )


def to_row(report: Report) -> dict[str, Any]:
    return {
        "id": report.id,
        "kind": report.kind,
        "reason": report.reason,
        "state": report.state,
        "note": report.note,
        "learner_id": report.learner_id,
        "contact_email": report.contact_email,
        "about": report.about or {},
        "source": report.source,
        "urgent": report.urgent,
        "created_at": _iso(report.created_at),
        "acted_by": report.acted_by,
        "acted_by_email": report.acted_by_email,
        "acted_at": _iso(report.acted_at),
        "resolution": report.resolution,
    }


# --- what somebody typed -------------------------------------------------------------------------
class NotKept(ValueError):
    """A field we cannot keep. ``field`` names it; ``message`` is what the person is told."""

    def __init__(self, field_name: str, message: str) -> None:
        self.field = field_name
        self.message = message
        super().__init__(f"{field_name}: {message}")


def normalise_reason(kind: str, raw: Any) -> str:
    code = str(raw or "").strip().lower()
    if code not in REASONS.get(kind, ()):
        raise NotKept("reason", "I do not know that reason.")
    return code


def normalise_note(raw: Any, *, required: bool, field_name: str = "note") -> str | None:
    """The person's own words. Bounded and trimmed, and otherwise kept exactly as typed.

    Nothing is stripped out: a report is evidence, and a sanitiser that quietly edits what a child
    wrote is a sanitiser that loses the sentence somebody needed to read. It is stored as text and
    the desk renders it as text, never as markup.
    """
    text = str(raw or "").strip()
    if not text:
        if required:
            raise NotKept(field_name, "Tell me what happened, in your own words.")
        return None
    if len(text) > MAX_NOTE:
        raise NotKept(field_name, "That is longer than I can take. Send me the short version.")
    return text


def normalise_email(raw: Any) -> str | None:
    address = str(raw or "").strip().lower()
    if not address:
        return None
    if len(address) > 320 or not _EMAIL_RE.match(address):
        raise NotKept("reply_to", "I need an email address I can write back to.")
    return address


def normalise_about(raw: Any) -> dict[str, str]:
    """The pointers, and only the pointers — an allow-list rather than a filter.

    This is the one place a client could otherwise post a learner's homework into the operator
    plane, and the answer is that there is nowhere in the row for it to land.
    """
    if not isinstance(raw, dict):
        return {}
    kept: dict[str, str] = {}
    for key, value in raw.items():
        name = str(key).strip().lower()
        if name not in ABOUT_KEYS or len(kept) >= MAX_ABOUT_KEYS:
            continue
        text = str(value).strip()[:MAX_ABOUT_VALUE]
        if text and _ABOUT_VALUE_RE.match(text):
            kept[name] = text
    return kept


def is_urgent(kind: str, reason: str) -> bool:
    return kind == "flag" and reason in URGENT_REASONS


#: The key the queue handle is derived under. ``REPORTS_HANDLE_PEPPER`` when set, otherwise the
#: service-role key, which is already the most guarded secret in this process and is stable across
#: restarts and replicas — the two properties a handle actually needs. Exactly the reasoning in
#: ``ledger._pepper``, and the domain string below keeps the two digests from ever being the same
#: value for the same learner.
_HANDLE_DOMAIN = b"wobo.reports.handle.v1"


def _handle_pepper() -> bytes | None:
    raw = (
        os.getenv("REPORTS_HANDLE_PEPPER")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_SERVICE_KEY")
        or ""
    ).strip()
    return raw.encode() if raw else None


def handle(learner_id: str | None) -> str:
    """A short, stable, ONE-WAY stand-in for a learner on a queue row.

    Enough to notice the same person twice in one morning, which is what a desk actually needs;
    not enough to look them up, which it usually does not.

    IT IS A KEYED DIGEST, AND IT USED TO BE ``learner_id[:8]``. That slice was not a pseudonym: it
    was eight characters of the child's real Supabase subject id, in plain text, on every row of
    every desk. The flag desk refuses ``/reports/who`` outright so a child's safety flag stays
    unattributed — and a raw prefix defeated that refusal by simple matching, because the same
    child's refund or support row DOES answer that route with the full id, and a full id starts
    with its own first eight characters. ``ledger.pseudonym`` already did this correctly with an
    HMAC under a server-side pepper; this is the same construction, under its own domain.

    Returns ``"—"`` when no pepper is configured. That is the honest answer rather than a fallback
    to the raw id: an unkeyed digest of a uuid is one rainbow table away from being the uuid, and a
    desk with no handle is a desk that has simply lost a convenience.
    """
    if not learner_id:
        return "—"
    pepper = _handle_pepper()
    if not pepper:
        return "—"
    digest = hmac.new(pepper, _HANDLE_DOMAIN + learner_id.encode(), hashlib.sha256).hexdigest()
    return digest[:8]


# --- the store seam ------------------------------------------------------------------------------
class StoreUnavailable(Exception):
    """The queue could not be reached. Callers say so; they never show an empty desk instead."""


class BadIdentifier(StoreUnavailable):
    """The VALUE was not an id. The desk is fine; the input was not, and those are different facts.

    Subclassed from :class:`StoreUnavailable` so every existing ``except`` keeps failing closed,
    and caught FIRST by the routes that take an id from an operator, which answer 400 rather than
    "the desk is unreachable". A console built so somebody can tell "we could not ask" from "it is
    fine" must not report a typo as an outage.
    """


#: How many rows one count page asks the database for, and the most it will ever scan. The table
#: only ever GROWS — migration 0017 grants select, insert and update on ``ops.reports`` and no
#: delete, because closing a report is a STATE and not a removal — so a single fixed page was
#: always going to become a silent floor, and, ordered newest-first, the rows it dropped were the
#: OLDEST: an old, still-open, urgent safety flag quietly stops being counted while the tile above
#: the desk says "none open" in mint. Paging fixes the common case; the cap keeps an operator
#: screen from scanning an unbounded table, and :attr:`Counts.complete` says which happened.
COUNT_PAGE = 1000
COUNT_MAX_ROWS = 50_000


@dataclass(frozen=True)
class Counts:
    """Every (kind, state, urgent) tally, and whether they are the whole table.

    ``complete`` is the honesty bit, and it is the same bit ``readable`` is on every other desk
    read: a count that had to stop early is a FLOOR, and a console must be able to say so rather
    than print a truncated number in the same type as a true one.
    """

    tally: tuple[tuple[str, str, bool, int], ...]
    complete: bool
    scanned: int


class ReportStore(Protocol):
    def insert(self, report: Report) -> Report: ...

    def get(self, report_id: str) -> Report | None: ...

    def update(self, report_id: str, fields: dict[str, Any]) -> Report | None: ...

    def queue(self, *, kind: str | None, state: str | None, limit: int) -> list[Report]: ...

    def counts(self) -> Counts: ...

    def raised_since(self, learner_id: str, since: datetime) -> int: ...


class InMemoryReportStore:
    """The suite's store and a local run's."""

    def __init__(self) -> None:
        self.rows: dict[str, Report] = {}
        self._lock = threading.Lock()

    def insert(self, report: Report) -> Report:
        with self._lock:
            now = datetime.now(UTC)
            stamped = replace(
                report, created_at=report.created_at or now, updated_at=report.updated_at or now
            )
            self.rows[stamped.id] = stamped
            return stamped

    def get(self, report_id: str) -> Report | None:
        with self._lock:
            return self.rows.get(report_id)

    def update(self, report_id: str, fields: dict[str, Any]) -> Report | None:
        with self._lock:
            found = self.rows.get(report_id)
            if found is None:
                return None
            merged = {**to_row(found), **fields, "updated_at": _iso(datetime.now(UTC))}
            moved = from_row(merged)
            self.rows[report_id] = moved
            return moved

    def queue(self, *, kind: str | None, state: str | None, limit: int) -> list[Report]:
        with self._lock:
            rows = list(self.rows.values())
        rows = [r for r in rows if kind is None or r.kind == kind]
        rows = [r for r in rows if state is None or r.state == state]
        # Urgent first, then newest — the same order the PostgREST store asks the database for, so
        # a desk reads the same on a laptop and on the project.
        rows.sort(
            key=lambda r: (
                r.state not in OPEN_STATES,
                not r.urgent,
                -(r.created_at or datetime.now(UTC)).timestamp(),
            )
        )
        return rows[:limit]

    def counts(self) -> Counts:
        tally: dict[tuple[str, str, bool], int] = {}
        with self._lock:
            for row in self.rows.values():
                key = (row.kind, row.state, row.urgent)
                tally[key] = tally.get(key, 0) + 1
        # A dictionary in this process is never truncated: it counted everything it holds.
        return Counts(
            tally=tuple((k, st, u, n) for (k, st, u), n in tally.items()),
            complete=True,
            scanned=sum(tally.values()),
        )

    def raised_since(self, learner_id: str, since: datetime) -> int:
        with self._lock:
            return sum(
                1
                for r in self.rows.values()
                if r.learner_id == learner_id and (r.created_at or datetime.now(UTC)) >= since
            )


class UnconfiguredReportStore:
    """No project and no explicit memory store: every call refuses.

    The alternative — an empty in-process dictionary — would let a production gateway that lost
    ``SUPABASE_URL`` answer "nothing has come in" to a desk, and silently swallow a child's flag on
    the way in. Both are worse than being unavailable and saying so.
    """

    def _no(self) -> Any:
        raise StoreUnavailable("no project is configured, so there is no queue to read or write")

    def insert(self, report: Report) -> Report:
        return self._no()

    def get(self, report_id: str) -> Report | None:
        return self._no()

    def update(self, report_id: str, fields: dict[str, Any]) -> Report | None:
        return self._no()

    def queue(self, *, kind: str | None, state: str | None, limit: int) -> list[Report]:
        return self._no()

    def counts(self) -> Counts:
        return self._no()

    def raised_since(self, learner_id: str, since: datetime) -> int:
        return self._no()


Request_ = Callable[..., Any]


def _request(url: str, key: str, method: str, *, body: Any = None, want_rows: bool) -> Any:
    """One PostgREST call against the ``ops`` schema. Split out so tests need no database."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": SCHEMA,
        "Content-Profile": SCHEMA,
        "Prefer": "return=representation" if want_rows else "return=minimal",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    prepared = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(prepared, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode() or ""
    if not want_rows or not raw.strip():
        return []
    return json.loads(raw)


_NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, ValueError, OSError)


class PostgrestReportStore:
    """``ops.reports`` over PostgREST with the service-role key (never a client's).

    A publishable key cannot reach the ``ops`` schema at all — migration 0017 revokes it — so a
    store built with one would fail in a way that looked like "no reports" rather than "no access".
    That is why the key is not a parameter with a fallback.
    """

    def __init__(self, base_url: str, service_key: str, *, request: Request_ | None = None) -> None:
        if not base_url or not service_key:
            raise ValueError("PostgrestReportStore needs a project URL and a service-role key")
        self.base = base_url.rstrip("/")
        self._key = service_key
        self._request = request or _request

    def _url(self, params: dict[str, str]) -> str:
        encoded = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        return f"{self.base}/rest/v1/{TABLE}?{encoded}"

    def _call(
        self, method: str, params: dict[str, str], *, body: Any = None
    ) -> list[dict[str, Any]]:
        try:
            rows = self._request(self._url(params), self._key, method, body=body, want_rows=True)
        except _NETWORK_ERRORS as exc:
            # The query string is not logged: a PostgREST filter can carry a learner's id.
            logger.warning(
                "reports: store call failed",
                extra={"fields": {"method": method, "error": str(exc)}},
            )
            raise StoreUnavailable(str(exc)) from exc
        if not isinstance(rows, list):
            return []
        return [row for row in rows if isinstance(row, dict)]

    @staticmethod
    def _uuid(value: str) -> str:
        """Checked before it reaches a filter, and a uuid is the only shape either column takes."""
        try:
            return str(uuid.UUID(str(value)))
        except (ValueError, AttributeError, TypeError) as exc:
            raise BadIdentifier("that is not something I can look up") from exc

    def insert(self, report: Report) -> Report:
        rows = self._call("POST", {"select": "*"}, body=[to_row(report)])
        return from_row(rows[0]) if rows else report

    def get(self, report_id: str) -> Report | None:
        rows = self._call(
            "GET", {"select": "*", "id": f"eq.{self._uuid(report_id)}", "limit": "1"}
        )
        return from_row(rows[0]) if rows else None

    def update(self, report_id: str, fields: dict[str, Any]) -> Report | None:
        rows = self._call(
            "PATCH", {"id": f"eq.{self._uuid(report_id)}", "select": "*"}, body=fields
        )
        return from_row(rows[0]) if rows else None

    def queue(self, *, kind: str | None, state: str | None, limit: int) -> list[Report]:
        """One desk's page: OPEN WORK FIRST, then urgent, then newest.

        The order used to be urgent-then-newest across every state, which sorted a CLOSED urgent
        flag above live open work — on a busy desk the visible page filled with things somebody had
        already settled while open rows sat below the cut, and the page said nothing about it.

        It is two reads rather than one ``order by`` because ``state`` is TEXT with a check
        constraint (migration 0017), not an enum, so the database would sort it alphabetically:
        acted_on, closed, looked_at, new — exactly backwards. Two filtered reads give the right
        order with no schema change and no ordering expression to keep in step with the constraint,
        and the second one is skipped entirely whenever the open work already fills the page, which
        is the case on every desk that is being worked.
        """
        base = {"select": "*", "order": "urgent.desc,created_at.desc"}
        if kind in KINDS:
            base["kind"] = f"eq.{kind}"
        if state in STATES:
            return [
                from_row(row)
                for row in self._call("GET", {**base, "state": f"eq.{state}", "limit": str(limit)})
            ]
        open_rows = self._call(
            "GET",
            {**base, "state": f"in.({','.join(OPEN_STATES)})", "limit": str(limit)},
        )
        rows = list(open_rows)
        if len(rows) < limit:
            settled = [s for s in STATES if s not in OPEN_STATES]
            rows.extend(
                self._call(
                    "GET",
                    {
                        **base,
                        "state": f"in.({','.join(settled)})",
                        "limit": str(limit - len(rows)),
                    },
                )
            )
        return [from_row(row) for row in rows]

    def counts(self) -> Counts:
        # No aggregate: a desk's three columns are cheap, and a PostgREST group-by costs a database
        # function somebody would have to remember to migrate. But this PAGES, where it used to ask
        # for one fixed 5000 and tally whatever came back.
        #
        # Paging by offset is also what makes this robust to PostgREST's own ``db-max-rows``, which
        # silently caps a page below whatever we asked for and reports nothing: the loop advances by
        # the number of rows it actually received, so a server-side cap makes it slower and never
        # makes it wrong. It stops on a short page (the end of the table) or at COUNT_MAX_ROWS, and
        # only the second sets ``complete`` false.
        tally: dict[tuple[str, str, bool], int] = {}
        offset = 0
        complete = True
        while True:
            page = self._call(
                "GET",
                {
                    "select": "kind,state,urgent",
                    "limit": str(COUNT_PAGE),
                    "offset": str(offset),
                    # Stable and cheap: ``id`` is the primary key, so paging cannot skip or repeat
                    # a row the way an unstable sort on a busy table can.
                    "order": "id.asc",
                },
            )
            for row in page:
                key = (str(row.get("kind")), str(row.get("state")), row.get("urgent") is True)
                tally[key] = tally.get(key, 0) + 1
            offset += len(page)
            if not page:
                break
            if offset >= COUNT_MAX_ROWS:
                complete = False
                break
        return Counts(
            tally=tuple((k, st, u, n) for (k, st, u), n in tally.items()),
            complete=complete,
            scanned=offset,
        )

    def raised_since(self, learner_id: str, since: datetime) -> int:
        rows = self._call(
            "GET",
            {
                "select": "id",
                "learner_id": f"eq.{self._uuid(learner_id)}",
                "created_at": f"gte.{_iso(since)}",
                "limit": str(REPORTS_PER_DAY + 1),
            },
        )
        return len(rows)


_store: ReportStore | None = None
_store_lock = threading.Lock()


def build_store() -> ReportStore:
    """The project store when configured, the memory store when it is asked for BY NAME.

    ``REPORTS_STORE=memory`` is the only way to the in-memory one, exactly as ``billing.py``
    requires ``SUBSCRIPTIONS_STORE=memory`` and for the same reason.
    """
    if (os.getenv("REPORTS_STORE") or "").strip().lower() == "memory":
        return InMemoryReportStore()
    base = (os.getenv("SUPABASE_URL") or "").strip()
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or ""
    ).strip()
    if base and key:
        return PostgrestReportStore(base, key)
    logger.warning(
        "reports: no project configured — the desks refuse rather than showing nothing"
    )
    return UnconfiguredReportStore()


def get_store() -> ReportStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: ReportStore | None) -> None:
    """Test seam. ``None`` drops the singleton so the next call rebuilds from the environment."""
    global _store
    with _store_lock:
        _store = store


# --- raising one ---------------------------------------------------------------------------------
class Refused(Exception):
    def __init__(self, code: str, message: str, *, status: int = 429) -> None:
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def raise_report(
    store: ReportStore,
    *,
    kind: str,
    reason: str,
    note: str | None,
    learner_id: str | None,
    contact_email: str | None = None,
    about: dict[str, Any] | None = None,
    source: str = "app",
) -> Report:
    """Write one row, page if it is a safety flag, and refuse a learner flooding the queue."""
    if learner_id:
        since = datetime.now(UTC) - timedelta(hours=24)
        if store.raised_since(learner_id, since) >= REPORTS_PER_DAY:
            raise Refused(
                "enough_for_today",
                "You have sent me a lot today and I have all of them. If something is urgent, "
                "write to support@heywobo.com.",
            )
    urgent = is_urgent(kind, reason)
    written = store.insert(
        Report(
            id=str(uuid.uuid4()),
            kind=kind,
            reason=reason,
            state="new",
            note=note,
            learner_id=learner_id,
            contact_email=contact_email,
            about=about or {},
            source=source if source in SOURCES else "app",
            urgent=urgent,
            created_at=datetime.now(UTC),
        )
    )
    if urgent:
        # A child said something upset them, or that it should not have been said to them. That is
        # the one thing in this module worth waking somebody for, and it pages the moment it
        # arrives rather than when a desk is next opened. The alarm carries the reason and nothing
        # else: not the note, not the id, not the learner. The queue is where it is read.
        alerts.alert(
            URGENT_FLAG_ALERT,
            "A learner flagged something as upsetting or unsafe. It is top of the flag desk.",
            severity=alerts.CRITICAL,
            reason=reason,
        )
    logger.info(
        "reports: raised",
        extra={"fields": {"kind": kind, "reason": reason, "urgent": urgent, "source": source}},
    )
    return written


# --- the bodies ----------------------------------------------------------------------------------
class IntakeBody(BaseModel):
    reason: str = Field(max_length=64)
    note: str | None = Field(default=None, max_length=MAX_NOTE + 200)
    about: dict[str, Any] | None = None


class ContactableBody(IntakeBody):
    """A message somebody expects an answer to."""

    reply_to: str | None = Field(default=None, max_length=320)


def not_kept(exc: NotKept) -> HTTPException:
    return HTTPException(
        status_code=422, detail={"code": "not_kept", "field": exc.field, "message": exc.message}
    )


def unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "code": "desk_unavailable",
            "message": "I could not save that just now. Try me again in a moment.",
        },
    )


def not_an_id() -> HTTPException:
    """A malformed report id. 400, because the desk is fine and the value was not one."""
    return HTTPException(
        status_code=422,
        detail={
            "code": "not_a_report_id",
            "field": "id",
            "message": "That is not a report id, so there is nothing to look up.",
        },
    )


def _learner_of(request: Request, *, allow_anonymous: bool) -> str | None:
    """The learner id to file the report under, or a 401.

    A flag and a bug accept an anonymous session on purpose: a child who has not signed in and
    meets something that upsets them must be able to say so, and a sign-in wall in front of a
    safety control is a safety control nobody uses. Support and refund do not, because both are
    answered against an account.
    """
    principal = getattr(request.state, "principal", None)
    if principal is None or (principal.anonymous and not allow_anonymous):
        raise HTTPException(
            status_code=401,
            detail={
                "code": "sign_in_required",
                "message": "Sign in and I can put this against your account.",
            },
        )
    return str(principal.subject) if principal.subject else None


def _intake(request: Request, kind: str, body: IntakeBody, *, allow_anonymous: bool) -> Report:
    learner_id = _learner_of(request, allow_anonymous=allow_anonymous)
    try:
        reason = normalise_reason(kind, body.reason)
        # A flag with no note is a complete report. The two a person answers need something to
        # answer.
        note = normalise_note(body.note, required=kind in ("support", "refund"))
        reply_to = normalise_email(getattr(body, "reply_to", None))
    except NotKept as exc:
        raise not_kept(exc) from exc
    about = normalise_about(body.about)
    try:
        report = raise_report(
            get_store(),
            kind=kind,
            reason=reason,
            note=note,
            learner_id=learner_id,
            contact_email=reply_to,
            about=about,
            source="app",
        )
    except Refused as exc:
        raise HTTPException(
            status_code=exc.status, detail={"code": exc.code, "message": exc.message}
        ) from exc
    except StoreUnavailable as exc:
        raise unavailable() from exc
    if kind == "flag" and reason == "not_my_syllabus":
        # The syllabus observer counts this flag with the removes on the chapter it points at
        # (docs/CURRICULUM-OBSERVER.md §3). After the row is written, never before it, and never
        # raising: the flag is kept whether or not anybody is counting. An anonymous session is
        # a report but not a vote, because a subject you can mint is not a learner (§6).
        principal = getattr(request.state, "principal", None)
        if principal is not None and not principal.anonymous:
            from wobo_gateway.curriculum import observer as syllabus_observer

            syllabus_observer.note_flag(learner_id, about)
    return report


def register_reports(app: FastAPI) -> None:
    """The four intakes. Called once from ``app.create_app``."""

    @app.post("/v1/flags")
    def raise_flag(body: IntakeBody, request: Request) -> dict[str, Any]:
        """The quiet flag. The control in the learner app calls this and nothing else."""
        report = _intake(request, "flag", body, allow_anonymous=True)
        return {
            "id": report.id,
            "urgent": report.urgent,
            # Wobo's own words, promising only what is true: a person reads it. No case number, no
            # turnaround time and no message back when it is settled, because none of those is
            # built — docs/legal/community-and-flags.md §2 says so and this must agree with it.
            "message": "Thank you for telling me. A person reads these.",
        }

    @app.post("/v1/report/bug")
    def report_bug(body: IntakeBody, request: Request) -> dict[str, Any]:
        report = _intake(request, "bug", body, allow_anonymous=True)
        return {
            "id": report.id,
            "message": "Thank you. I have written down what went wrong and somebody will look.",
        }

    @app.post("/v1/support/message")
    def support_message(body: ContactableBody, request: Request) -> dict[str, Any]:
        report = _intake(request, "support", body, allow_anonymous=False)
        return {
            "id": report.id,
            "message": (
                "I have this. A person answers these, and you can write to support@heywobo.com "
                "if you would rather."
            ),
        }

    @app.post("/v1/refund-request")
    def refund_request(body: ContactableBody, request: Request) -> dict[str, Any]:
        """The statutory cases. The answer says what this is, and never implies a sixth reason.

        Every word is checked against docs/legal/refund-and-cancellation.md §5: five reasons, all
        owed by law, and cancelling named as the door out of everything else.
        """
        report = _intake(request, "refund", body, allow_anonymous=False)
        return {
            "id": report.id,
            "message": (
                "I have your request and a person will look at it. If you would rather stop the "
                "next charge, cancelling does that on its own: you keep the plan until the period "
                "you have paid for ends, and nothing renews."
            ),
        }


__all__ = [
    "ABOUT_KEYS",
    "COUNT_MAX_ROWS",
    "COUNT_PAGE",
    "KINDS",
    "LIMITED_PATHS",
    "REASONS",
    "REPORTS_PER_DAY",
    "STATES",
    "URGENT_REASONS",
    "BadIdentifier",
    "Counts",
    "InMemoryReportStore",
    "OPEN_STATES",
    "PostgrestReportStore",
    "Report",
    "ReportStore",
    "StoreUnavailable",
    "UnconfiguredReportStore",
    "build_store",
    "get_store",
    "handle",
    "not_an_id",
    "raise_report",
    "register_reports",
    "set_store",
]
