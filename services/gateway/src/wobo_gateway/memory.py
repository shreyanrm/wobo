"""What the brain remembers of a learner, and how it forgets — ``POST /v1/me/erase``.

The memory page has always been able to clear the device: ``forget_all`` calls ``clearMind()``
and the dossier is gone from that phone. Nothing propagated. The brain kept its own copy — Wobo's
own mind of the learner (``learner.wobo_mind``, migration 0020: the facts they were told, what was
noticed about them, and everything the twin summary is derived from), the older mind snapshot the
same devices reconciled through before that table existed (``learner.learner_state.mind``), the
conversation it caches per learner (``learner.learner_threads``), the generations it holds keyed
to that learner (the board turns still inside the resume window), and — since the hospitality wave
— the family's mail dials (``learner.mail_preferences``) and the parent link with the parent's
address on it (``learner.parent_links``). A memory a learner cannot reach is not their memory, so
this module is the other half of the promise Wobo makes in their own words: "the app purges the
real memory and confirms exactly what left; never claim to have forgotten something you did not."

Three rules follow from that last clause:

* **Every store is attempted**, so one unreachable table cannot leave the rest behind.
* **The answer is the truth**, not the intent: what came back is counted and reported, and a store
  that refused is named. The route turns a partial erasure into a 502 rather than a reassurance.
* **Progress is not memory.** XP, streak and mastery are the learner's record of their own work;
  the mind snapshot is what Wobo was told about them. Forgetting empties the second and leaves the
  first, which is why the state row is patched rather than deleted. Deleting the whole account is
  a different control with a different warning ("erase and start over").

Transport is PostgREST with the service-role key, exactly as :mod:`wobo_gateway.consent` reads the
profile: server-side only, never in a client bundle, ``learner`` schema selected by header. With no
project configured (dev, tests, the keyless path) there is no durable store to erase — the answer
says so rather than pretending, and the in-process stores are still cleared.
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("wobo.gateway.memory")

_HTTP_TIMEOUT_S = 5.0

#: The schema the learner plane lives in, and the tables this route may touch. Named explicitly:
#: an erase route that takes a table name from anywhere but this file is a delete primitive.
_SCHEMA = "learner"
_STATE_TABLE = "learner_state"
_THREADS_TABLE = "learner_threads"
#: Wobo's mind, since migration 0020. Reached through its own store (:mod:`wobo_gateway.mind`)
#: rather than a second PostgREST call written out here: one table, one seam, and the erase
#: works the same whether the mind lives in the project or in this process.
_MIND_TABLE = "wobo_mind"
_ID_COLUMN = "subject_id"
#: The hospitality tables (migrations 0010 and 0011) name the learner ``learner_id``. Both are
#: deleted outright: the family's mail dials and chosen calendars, and the parent link with the
#: address on it — a learner who asks to be forgotten takes their parent's address with them.
_PREFERENCES_TABLE = "mail_preferences"
_PARENT_LINKS_TABLE = "parent_links"
_LEARNER_COLUMN = "learner_id"

#: A subject reaches a PostgREST filter, so it is checked before it is interpolated. Supabase
#: subjects are uuids; the dev seam's are short slugs. Anything else is refused outright rather
#: than escaped and hoped for — a filter value is not a place to be clever.
_SUBJECT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


@dataclass
class Erasure:
    """What actually left. Counts, not promises."""

    #: Durable facts dropped from the mind — the concierge's notepad. Counted across both
    #: stores: Wobo's mind (0020) and the older ``learner_state.mind`` snapshot beside it.
    facts: int = 0
    #: Wobo's mind of this learner: 1 when a row was there and is not any more.
    mind: int = 0
    #: Whether the twin summary went with them (it is derived from the same snapshot).
    twin_summary: bool = False
    #: Conversations the brain had cached for this learner.
    threads: int = 0
    #: Cached generations keyed to this learner: board turns still inside the resume window.
    boards: int = 0
    #: The family's mail dials, chosen calendars and locality (``learner.mail_preferences``).
    mail_preferences: int = 0
    #: The parent link, with the parent's address on it (``learner.parent_links``).
    parent_links: int = 0
    #: The parent plane (migration 0019): the bindings between a parent account and this learner,
    #: any selection pointing at them, the parent's conversation about them, and every parent's
    #: remembered picture of them. A learner asking to be forgotten is forgotten by the people who
    #: were allowed to ask about them too.
    parent_plane: int = 0
    #: True when a durable store was configured and answered. False means device-side only.
    durable: bool = False
    #: Stores that refused. Non-empty means the learner has NOT been fully forgotten.
    failed: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "erased": {
                "facts": self.facts,
                "mind": self.mind,
                "twin_summary": self.twin_summary,
                "threads": self.threads,
                "boards": self.boards,
                "mail_preferences": self.mail_preferences,
                "parent_links": self.parent_links,
                "parent_plane": self.parent_plane,
            },
            "durable": self.durable,
            "failed": list(self.failed),
        }


def configured() -> tuple[str, str] | None:
    """``(base url, service key)`` when the brain has a durable store, else None."""
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if not base or not key:
        return None
    return base.rstrip("/"), key


def _url(
    base: str, table: str, subject: str, *, select: str | None = None, column: str = _ID_COLUMN
) -> str:
    query: dict[str, str] = {column: f"eq.{subject}"}
    if select:
        query["select"] = select
        query["limit"] = "1"
    encoded = urllib.parse.urlencode(query, quote_via=urllib.parse.quote)
    return f"{base}/rest/v1/{urllib.parse.quote(table)}?{encoded}"


def _request(
    url: str, key: str, method: str, *, body: dict[str, Any] | None = None, want_rows: bool
) -> Any:
    """One PostgREST call. Split out so tests can substitute it without a database."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        # PostgREST picks the schema by header. Reads use Accept-Profile, writes Content-Profile;
        # sending both is harmless and means one code path for all three verbs.
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


def _mind(rows: Any) -> dict[str, Any]:
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        mind = rows[0].get("mind")
        if isinstance(mind, dict):
            return mind
    return {}


def holds_learner_data(subject: str) -> bool:
    """Has this account done ANYTHING as a learner? Read before it can become a parent account.

    The two kinds are mutually exclusive for life (migration 0019, ruling 1), and 0019's trigger
    looked at ``learner.learner_state`` alone — so a signed-in learner who had not yet written a
    state row could sign up as a parent and be refused learner state forever afterwards, with no
    route that deletes a parent account. This is the same question asked of the tables a learner
    actually touches first: Wobo's mind, their conversation, their state.

    Never raises. A store we cannot read answers ``True``, because refusing a sign-up that might
    be a mistake costs somebody one message to support@heywobo.com, and allowing one that is a
    mistake costs them their account.
    """
    if not subject or not _SUBJECT_RE.match(subject):
        return False
    from wobo_gateway import mind as mind_store

    try:
        held = mind_store.get_store().get(subject)
    except Exception:
        return True
    if held is not None:
        return True
    project = configured()
    if project is None:
        return False
    base, key = project
    for table in (_STATE_TABLE, _THREADS_TABLE):
        try:
            rows = _request(
                _url(base, table, subject, select=_ID_COLUMN), key, "GET", want_rows=True
            )
        except Exception as exc:
            logger.warning(
                "memory: learner footprint unreadable", extra={"fields": {"error": str(exc)}}
            )
            return True
        if isinstance(rows, list) and rows:
            return True
    return False


def erase_durable(subject: str) -> Erasure:
    """Forget this learner in the brain's own store. Never raises; a refusal is reported."""
    out = Erasure()
    store = configured()
    if store is None or not _SUBJECT_RE.match(subject or ""):
        return out
    base, key = store
    out.durable = True

    # The mind snapshot: read what is there so the learner can be told exactly what left, then
    # empty it. Patched, never deleted — the same row carries their XP and their streak.
    try:
        rows = _request(
            _url(base, _STATE_TABLE, subject, select="mind"), key, "GET", want_rows=True
        )
        mind = _mind(rows)
        facts = mind.get("facts")
        out.facts = len(facts) if isinstance(facts, list) else 0
        # The twin summary is not stored; it is derived from this snapshot every time it is built,
        # so it exists exactly as long as the snapshot has anything in it — and goes with it.
        out.twin_summary = bool(mind)
        if mind:
            _request(
                _url(base, _STATE_TABLE, subject),
                key,
                "PATCH",
                body={"mind": {}},
                want_rows=False,
            )
    except _NETWORK_ERRORS as exc:
        logger.warning("memory: mind erase failed", extra={"fields": {"error": str(exc)}})
        out.failed.append(_STATE_TABLE)
        out.facts, out.twin_summary = 0, False

    # Wobo's cached conversation with this learner.
    try:
        rows = _request(_url(base, _THREADS_TABLE, subject), key, "DELETE", want_rows=True)
        out.threads = len(rows) if isinstance(rows, list) else 0
    except _NETWORK_ERRORS as exc:
        logger.warning("memory: thread erase failed", extra={"fields": {"error": str(exc)}})
        out.failed.append(_THREADS_TABLE)

    # The hospitality rows: the mail dials and the parent link. Deleted, not patched — there is
    # no progress on these rows to keep, and the parent's address must not outlive the learner
    # who typed it.
    hospitality = ((_PREFERENCES_TABLE, "mail_preferences"), (_PARENT_LINKS_TABLE, "parent_links"))
    for table, attr in hospitality:
        try:
            rows = _request(
                _url(base, table, subject, column=_LEARNER_COLUMN), key, "DELETE", want_rows=True
            )
            setattr(out, attr, len(rows) if isinstance(rows, list) else 0)
        except _NETWORK_ERRORS as exc:
            logger.warning(f"memory: {attr} erase failed", extra={"fields": {"error": str(exc)}})
            out.failed.append(table)

    return out


def _forget_in_process(subject: str) -> tuple[int, int]:
    """The in-memory hospitality stores (a run without a project, or ``…_STORE=memory``): the
    same rows, held in this process instead of the project, forgotten here. Counts, so the
    answer is still the truth when there is no durable store at all."""
    from wobo_gateway import parents
    from wobo_gateway.hospitality import preferences as prefs_mod

    dials = prefs_mod.get_store()
    links = parents.get_store()
    prefs_gone = (
        dials.forget(subject) if isinstance(dials, prefs_mod.InMemoryPreferencesStore) else 0
    )
    links_gone = (
        links.forget(subject) if isinstance(links, parents.InMemoryParentLinkStore) else 0
    )
    return prefs_gone, links_gone


def erase(subject: str, *, board_key: str) -> Erasure:
    """Everything the brain holds about one learner, gone — durable store and process alike.

    ``board_key`` is what a remembered board turn is owned by (:func:`wobo_gateway.app.board_key`
    — an anonymous learner's turns hang off their device address AND their subject, not their
    subject alone), and it comes from the door, never from a body. It is deliberately not the
    meter key: keyed on the address alone, one anonymous child pressing "forget me" erased the
    turns of every other anonymous child on the same home or school connection.
    """
    from wobo_gateway import mind as mind_store
    from wobo_gateway import voice
    from wobo_gateway.board import stream as board_stream

    out = erase_durable(subject)

    # Wobo's own mind of this learner (``learner.wobo_mind``, migration 0020): the facts they were
    # told, what was noticed, and the snapshot the twin summary is derived from. Through the mind's
    # own store, so this is one delete whether the mind lives in the project or in this process —
    # and read first, so the learner is told how many facts actually left rather than a guess.
    try:
        store = mind_store.get_store()
        held = store.get(subject)
        if held is not None:
            out.facts += len(held.facts)
            out.twin_summary = out.twin_summary or not held.empty
        out.mind = store.forget_all(subject)
    except mind_store.StoreUnavailable as exc:
        logger.warning("memory: mind erase failed", extra={"fields": {"error": str(exc)}})
        out.failed.append(_MIND_TABLE)

    # The parent plane (0019). The consent rows in ``learner.parent_links`` go above, so a
    # parent's ACCESS stopped there; this is what is left of them on this learner. Erasure reaches
    # every store (docs/MEMORY-LAW.md), and a plane that refused is named rather than glossed
    # over — this route's whole point is that the answer is the truth and not the intent.
    try:
        from wobo_gateway import parent_account

        out.parent_plane = parent_account.revoke_everything_about(
            parent_account.get_store(), subject
        )
    except Exception as exc:
        logger.warning("memory: parent plane erase failed", extra={"fields": {"error": str(exc)}})
        out.failed.append("parent_plane")

    prefs_gone, links_gone = _forget_in_process(subject)
    out.mail_preferences += prefs_gone
    out.parent_links += links_gone
    # Cached generations keyed to this learner: the board turns still replayable in the resume
    # window carry the learner's own words and Wobo's answer to them.
    out.boards = board_stream.forget(board_key)
    # An outstanding voice token is a session about to be opened as them; forgetting a learner
    # must not leave one of those lying around.
    voice.forget(subject)
    logger.info("memory erased", extra={"fields": {"subject": subject, **out.as_dict()}})
    return out
