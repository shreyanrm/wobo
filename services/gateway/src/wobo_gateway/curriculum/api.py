"""The curriculum capabilities (docs/CURRICULUM.md §3, §4, §6, §8).

Nine capabilities, all mounted on the ordinary ``POST /v1/capability/{name}`` door, so they get
the same verified subject, the same rate limit and the same meter as every other call:

    curriculum.search          type-ahead over names and aliases, country hinted
    curriculum.framework       the levels of a framework, and the subjects inside one level
    curriculum.units           the chapter list, on demand — stored, or discovery is enqueued
    curriculum.topics          the topics of one unit, with their objectives
    curriculum.pin             pin the learner to a version
    curriculum.upgrade         what moved since their version, and switch to the new one
    curriculum.overlay.get     the learner's edits on their version
    curriculum.overlay.apply   add, remove, reorder, rename, not in my school, attach a textbook
    curriculum.status          how a discovery job is going, in one honest line

**Nothing here calls a model.** Every answer is a read of the registry, or a row written to
``discovery_jobs`` for the worker that does. That is the whole point of §8: the framework is
chosen for free, and the only thing that ever costs a generation is content a learner opened.

Three rules are enforced in this file rather than trusted to a caller:

* a syllabus we do not have is never invented — the answer is a job id and a plain line (§4.6);
* the label a learner reads is derived from the stored status, never passed in (§5);
* an edit is stored as an overlay op, never as a change to a canonical node (§6).
"""

from __future__ import annotations

import base64
import binascii
import contextvars
import logging
import os
from collections.abc import Callable, Sequence
from typing import Any

from wobo_gateway.curriculum import coldstart, labels
from wobo_gateway.curriculum import overlay as overlay_ops
from wobo_gateway.curriculum import own as own_syllabus
from wobo_gateway.curriculum import versions as version_rules
from wobo_gateway.curriculum.models import (
    LEVEL_MAX,
    LEVEL_MIN,
    DiscoveryJob,
    Framework,
    FrameworkKind,
    JobState,
    Node,
    NodeKind,
    Overlay,
    Provenance,
    Status,
    Version,
    in_scope,
    job_is_open,
    level_order,
)
from wobo_gateway.curriculum.store import CurriculumStore, StoreUnavailable, get_store

logger = logging.getLogger("wobo.gateway.curriculum")

CAPABILITIES: tuple[str, ...] = (
    "curriculum.search",
    "curriculum.framework",
    "curriculum.units",
    "curriculum.topics",
    "curriculum.pin",
    "curriculum.upgrade",
    "curriculum.overlay.get",
    "curriculum.overlay.apply",
    "curriculum.status",
    # THE CHAPTER'S POOL (docs/LEARNING-MODEL.md). A READ, like everything else in this file: the
    # architect builds a pool on the platform's own money, and this hands the stored one to the
    # client that walks it. Until 2026-09-10 nothing served a blueprint and nothing asked for one,
    # so ``placement.ts``'s "THE ARCHITECT FIRST" branch and ``groupFor`` were unreachable code.
    "curriculum.blueprint",
    # There is no "curriculum.climb" here. The group is chosen on the device out of the pool the
    # read above serves; the door that chose it on the gateway was retired on 2026-09-16, because
    # every call drew a turn from the learner's day (docs/LEARNING-MODEL.md, "Who chooses").
    # The own-syllabus door (§6). It is the answer to every dead end above, so it is not optional:
    # without these four the "not listed? show me yours" line the other capabilities all carry
    # would lead nowhere.
    "curriculum.own.read",
    "curriculum.own.confirm",
    "curriculum.own.publish",
    "curriculum.own.offer",
)

# The door out of every dead end (§3: "the 'not listed? tell me' path is always visible and never
# more than one tap away"). It rides on every search and every empty unit list, so the client
# never has to decide when to show it.
OWN_SYLLABUS = {
    "action": "own_syllabus",
    "message": "Not listed? Show me your syllabus and I will build it with you.",
}

_MAX_QUERY = 120

#: The line every out-of-band class gets, wherever it is asked for (§11).
OUT_OF_BAND = f"I teach classes {LEVEL_MIN} to {LEVEL_MAX}. That one is outside what I cover."


def discovery_worker_running() -> bool:
    """Is there anything that will move a queued discovery job?

    Only when the owner has switched the worker on (``WOBO_DISCOVERY_WORKER=1``, started by
    ``create_app`` through :func:`discovery.worker.start_if_enabled`; the cost is in
    ``docs/OPERATIONS.md``). With it off, a job is still recorded and still queued — a learner
    asked, and that row is both the console's queue and what the worker picks up the day the
    switch is set. What is NOT done with it off is telling the learner a search is happening,
    which is the promise §4.6 forbids and which the cold start removed entirely.
    """
    from wobo_gateway.curriculum.discovery.worker import enabled

    return enabled()


def _learner_job_state(job: DiscoveryJob) -> JobState:
    """The job's state AS A LEARNER SHOULD BE TOLD IT, which is not always the row's own.

    §4.6: a search nobody is running is never reported as running. With the worker off the row
    stays ``queued`` — it is the console's queue and the backlog the worker drains the hour the
    owner sets the switch — and an open job is presented as the honest end instead. Nothing is
    written here; this is a reading.
    """
    # Only a job still at QUEUED. Anything past it has a runner of its own that moved it — the
    # first-selection re-check (`recheck`) drives its job to CHECKING on the request thread and
    # is not the discovery worker — and a claim that then goes silent is the stale-claim path's
    # to requeue, not ours to relabel.
    if job.state is JobState.QUEUED and not discovery_worker_running():
        return JobState.REFUSED
    return job.state


def worker_switch() -> str:
    """The name of the environment variable that turns discovery on. One place, so the log line
    an operator reads and the documentation cannot drift apart."""
    from wobo_gateway.curriculum.discovery.worker import ENV

    return ENV


class CurriculumError(Exception):
    """A refusal the learner reads. Wobo's voice, one line, and never a stack trace."""

    def __init__(self, code: str, message: str, *, status: int = 400) -> None:
        self.code = code
        self.message = message
        self.status = status
        super().__init__(message)

    def body(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


#: The door's meter, handed in so a capability that mints a paid job can charge for it. A
#: discovery job is a search, an extraction on the generate tier and a re-reading on the verify
#: tier; ``curriculum.units`` itself is a cheap registry read, so without this the expensive half
#: of the curriculum is free (§4.4). Called with the capability name to charge against.
Charge = Callable[[str], None]

#: What a minted discovery job is metered as. `budget.CAPABILITY_CLASS` already puts this prefix
#: on the generation counter; naming it here keeps that agreement visible from both sides.
DISCOVERY_CAPABILITY = "curriculum.discovery"

#: A context variable rather than an argument, because the handlers all take (payload, subject,
#: store) and only one of them ever charges. A ContextVar rather than a module global because
#: every route here is a plain ``def``, so FastAPI runs them on a threadpool and two calls
#: genuinely interleave.
_charge: contextvars.ContextVar[Charge | None] = contextvars.ContextVar(
    "wobo_curriculum_charge", default=None
)


def _charge_for(capability: str) -> None:
    """Meter one paid job against the learner who caused it. Silent when nobody wired a meter."""
    meter = _charge.get()
    if meter is not None:
        meter(capability)


def handle(
    name: str,
    payload: dict[str, Any],
    *,
    subject: str,
    anonymous: bool = False,
    store: CurriculumStore | None = None,
    charge: Charge | None = None,
) -> dict[str, Any]:
    """One capability call. ``subject`` is the VERIFIED subject from the door, never the body."""
    handler = _HANDLERS.get(name)
    if handler is None:
        raise CurriculumError("unknown_capability", "I do not know how to do that.", status=404)
    if not isinstance(payload, dict):
        raise CurriculumError("bad_request", "I could not read that request.")
    token = _charge.set(charge)
    try:
        return handler(payload, subject, store or get_store())
    except StoreUnavailable as exc:
        # The registry is unreachable. We say so; we do not answer from imagination (§11).
        logger.warning("curriculum store unavailable", extra={"fields": {"error": str(exc)}})
        raise CurriculumError(
            "registry_unavailable",
            "I could not reach the syllabus list just now. Try me again in a moment.",
            status=503,
        ) from exc
    finally:
        _charge.reset(token)


# --- helpers ------------------------------------------------------------------------------------


def _text(payload: dict[str, Any], *keys: str, limit: int = _MAX_QUERY) -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:limit]
    return ""


def _flag(payload: dict[str, Any], *keys: str) -> bool:
    """One boolean off the wire, true only when it is genuinely true. A client sending the string
    "false" is not asking for the thing, and an absent key never is."""
    for key in keys:
        value = payload.get(key)
        if isinstance(value, bool):
            if value:
                return True
        elif isinstance(value, str) and value.strip().lower() in ("1", "true", "yes", "on"):
            return True
    return False


def _require(payload: dict[str, Any], *keys: str, what: str) -> str:
    value = _text(payload, *keys)
    if not value:
        raise CurriculumError("needs_more", f"Tell me {what} and I will find it.")
    return value


def _b64(value: Any, *, what: str) -> bytes:
    """A photo or a PDF arrives base64-encoded in JSON.

    Anything else is refused before a byte of it is read.
    """
    if not isinstance(value, str) or not value.strip():
        raise CurriculumError("needs_more", f"Send me the {what} and I will read it.")
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise CurriculumError(
            "bad_request", f"I could not open that {what}. Try sending it again."
        ) from exc


def _framework(store: CurriculumStore, payload: dict[str, Any], subject: str) -> Framework:
    framework_id = _require(payload, "framework_id", "framework", what="which board you follow")
    framework = store.get_framework(framework_id, subject=subject)
    if framework is None:
        raise CurriculumError(
            "unknown_framework",
            "I do not have that board yet. Show me your syllabus and I will build it.",
            status=404,
        )
    return framework


def _version(
    store: CurriculumStore, framework: Framework, payload: dict[str, Any], subject: str
) -> Version | None:
    """The version this call is about: the one asked for, the learner's pin, else the latest."""
    asked = _text(payload, "version_id")
    if asked:
        version = store.get_version(asked)
        if version is None or version.framework_id != framework.id:
            raise CurriculumError(
                "unknown_version", "I do not have that edition of the syllabus.", status=404
            )
        return version
    pinned = store.get_pin(subject, framework.id) if subject else None
    if pinned:
        version = store.get_version(pinned)
        if version is not None:
            return version
    return store.latest_version(framework.id)


def _levels(store: CurriculumStore, framework: Framework, version: Version | None) -> list[str]:
    """The levels a learner may pick: the stored syllabus's own, else the registry entry's."""
    if version is not None:
        stored = [
            node.name
            for node in store.children(version.id, None, kind=NodeKind.LEVEL)
            if in_scope(node.name)
        ]
        if stored:
            return stored
    return list(framework.levels_in_scope())


def _find_child(nodes: Sequence[Node], name: str) -> Node | None:
    """Match a level or subject by name, tolerating case, accents and punctuation."""
    needle = version_rules.normalise(name)
    for node in nodes:
        if version_rules.normalise(node.name) == needle:
            return node
    for node in nodes:
        if needle and needle in version_rules.normalise(node.name):
            return node
    return None


def _locate(
    store: CurriculumStore, version: Version, level: str, subject_name: str
) -> tuple[Node | None, Node | None]:
    level_node = _find_child(store.children(version.id, None, kind=NodeKind.LEVEL), level)
    if level_node is None:
        return None, None
    return level_node, _find_child(
        store.children(version.id, level_node.id, kind=NodeKind.SUBJECT), subject_name
    )


def _subject_topics(store: CurriculumStore, version: Version, subject_node: Node) -> list[Node]:
    """Every topic under one subject, in one read of the version rather than one per chapter.

    Concept ids live on TOPICS (``concepts.attach_concepts`` annotates topics, never units), so a
    re-anchor cannot be computed from a chapter list; this is what it is computed from.
    """
    nodes = store.all_nodes(version.id)
    by_parent: dict[str | None, list[Node]] = {}
    for node in nodes:
        by_parent.setdefault(node.parent_id, []).append(node)
    out: list[Node] = []
    stack = list(by_parent.get(subject_node.id, ()))
    while stack:
        node = stack.pop()
        if node.kind is NodeKind.TOPIC:
            out.append(node)
        stack.extend(by_parent.get(node.id, ()))
    return out


def _locate_subject(
    store: CurriculumStore, version: Version, level: str, subject_name: str
) -> Node | None:
    return _locate(store, version, level, subject_name)[1]


def _overlay(store: CurriculumStore, subject: str, version_id: str) -> Overlay:
    return store.get_overlay(subject, version_id) or Overlay(
        subject_id=subject, version_id=version_id
    )


def _with_provenance(
    store: CurriculumStore, version: Version, node: Node | None, view: dict[str, Any]
) -> dict[str, Any]:
    """Attach where this node came from. A node with no source at all is served with none —
    honestly empty, so the surface can say "no source on file" rather than imply one.

    A node the learner added themselves is one of those: it came from them, and ``own: true``
    already says so. It still carries the key, because a surface that reads ``"source" in node``
    must not see two different shapes depending on who wrote the chapter.
    """
    if node is None or view.get("own"):
        view["source"] = None
        return view
    record = store.provenance_for(version.id, node.id)
    view["source"] = record.as_dict() if record is not None else None
    return view


def _views(
    store: CurriculumStore,
    version: Version,
    nodes: Sequence[Node],
    ops: Sequence[dict[str, Any]],
    parent_id: str | None,
) -> list[dict[str, Any]]:
    by_id = {node.id: node for node in nodes}
    return [
        _with_provenance(store, version, by_id.get(str(view["id"])), view)
        for view in overlay_ops.apply(nodes, ops, parent_id=parent_id)
    ]


def _framework_block(framework: Framework, version: Version | None) -> dict[str, Any]:
    return {
        "framework": framework.as_dict(),
        "version": version.as_dict() if version is not None else None,
        "label": labels.label_for(framework, version),
    }


def _job_block(job: DiscoveryJob) -> dict[str, Any]:
    """The job AS A LEARNER IS TOLD IT — state, openness and line from one reading (§4.6).

    The row's own state, its `open` and its stored message are the console's truth and they are
    never touched. What travels to a learner is :func:`_learner_job_state`, and all three fields
    are computed from it together, because the client reads them together: the SDK takes
    `job.open` when the wire carries it (``packages/sdk/src/curriculum/parse.ts``) and
    ``useDiscoveryStatus`` polls until it is false. A block that said `open: true` about a job
    nothing will move was an endless four-second poll on all 264 cold boards, and it carried the
    stored "Looking for the official syllabus now" into an answer whose own line said the honest
    end — the promise §4.6 forbids, on the wire, beside the sentence that replaced it.
    """
    state = _learner_job_state(job)
    message = job.message if state is job.state and job.message else labels.job_message(state)
    return {**job.as_dict(), "state": state.value, "open": job_is_open(state), "message": message}


def _wait_ms(job: DiscoveryJob) -> int:
    """How long the designed wait may run for this learner (``docs/BOARD-COLD-START.md`` §2).

    The wait exists for one reason: a syllabus landing INSIDE it, so the learner walks straight
    into their own climb (§2.3). When nothing can land it buys nothing and costs everything — on a
    board whose job refused, and on every board while ``WOBO_DISCOVERY_WORKER`` is unset, which is
    production today — and §5's "every learner after them arrives instantly" becomes a sentence
    that is true only of the four boards that landed. So the ceiling rides only on an answer whose
    job is genuinely open; otherwise the learner goes to the shared plan in this instant.
    """
    return coldstart.WAIT_CEILING_MS if job_is_open(_learner_job_state(job)) else 0


# --- the capabilities ----------------------------------------------------------------------------


def _search(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    """Type-ahead over names and aliases, with the learner's country as a tie-break (§3)."""
    query = _text(payload, "q", "query", "text")
    country = _text(payload, "country", "country_code", limit=8).upper() or None
    limit = payload.get("limit")
    limit = limit if isinstance(limit, int) and 1 <= limit <= 25 else 10
    # `subject` is what makes the learner's OWN published syllabus appear in their own search and
    # in nobody else's (§6, §10). Without it a personal framework was invisible even to its owner.
    results = (
        store.search_frameworks(query, country=country, limit=limit, subject=subject or None)
        if query
        else []
    )
    # The label is a claim about a syllabus, so it is made against the syllabus we actually hold
    # (§5). One batched lookup, not one per row: this runs on every keystroke.
    held = store.latest_versions([framework.id for framework in results]) if results else {}
    return {
        "query": query,
        "country": country,
        "results": [
            {
                **framework.as_dict(),
                "label": labels.label_for(framework, held.get(framework.id)),
                "has_syllabus": framework.id in held,
            }
            for framework in results
        ],
        # Always, whether or not anything matched. One tap away, by law.
        "not_listed": OWN_SYLLABUS,
    }


def _framework_capability(
    payload: dict[str, Any], subject: str, store: CurriculumStore
) -> dict[str, Any]:
    """The levels of a framework, and the subjects inside one level when a level is named."""
    framework = _framework(store, payload, subject)
    version = _version(store, framework, payload, subject)
    level = _text(payload, "level", "grade", "class")
    block = _framework_block(framework, version)
    block["levels"] = _levels(store, framework, version)
    block["pinned_version_id"] = store.get_pin(subject, framework.id) if subject else None
    block["subjects"] = []
    if level and version is not None:
        level_node = _find_child(store.children(version.id, None, kind=NodeKind.LEVEL), level)
        if level_node is not None:
            block["subjects"] = [
                node.name
                for node in store.children(version.id, level_node.id, kind=NodeKind.SUBJECT)
            ]
    block["level"] = level or None
    if level and not block["subjects"]:
        # We know the board and the class but hold no syllabus for it yet. Say so, and open the
        # door — never list plausible subjects we have no source for.
        block["not_listed"] = OWN_SYLLABUS
    return block


def _check_level_band(
    store: CurriculumStore, framework: Framework, version: Version | None, level: str
) -> None:
    """Grades 4 to 13, school level only (§11), enforced where a level first arrives.

    ``models.in_scope`` keeps an UNNUMBERED level ("IGCSE", "MYP 1") because we cannot judge what
    we cannot read — which is right for filtering a board's own list, and wrong as the only gate
    on a level a learner typed: "Nursery" carries no number either. So a level with a number must
    be inside the band, and a level without one must be a level this framework actually publishes.
    Anything else used to open a generate-tier discovery job for pre-school or for a degree.
    """
    order = level_order(level)
    if order is not None:
        if not (LEVEL_MIN <= order <= LEVEL_MAX):
            raise CurriculumError("outside_school_band", OUT_OF_BAND)
        return
    known = {version_rules.normalise(name) for name in _levels(store, framework, version)}
    if version_rules.normalise(level) not in known:
        raise CurriculumError("outside_school_band", OUT_OF_BAND)


def _units(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    """The chapter list, on demand (§8). Stored syllabus, or a discovery job and one honest line."""
    framework = _framework(store, payload, subject)
    level = _require(payload, "level", "grade", "class", what="which class you are in")
    subject_name = _require(payload, "subject", "subject_name", what="which subject")
    version = _version(store, framework, payload, subject)
    _check_level_band(store, framework, version, level)

    level_node, subject_node = (
        _locate(store, version, level, subject_name) if version is not None else (None, None)
    )
    units = (
        store.children(version.id, subject_node.id, kind=NodeKind.UNIT)
        if version is not None and subject_node is not None
        else []
    )

    if not units:
        # The cold start (docs/BOARD-COLD-START.md). The job goes out in this instant, with the
        # learner on it so it sits at the head of the queue; the learner does not wait on it.
        # They are handed the class-and-subject plan every board shares and they begin. What the
        # job finds re-anchors their climb quietly, minutes later (coldstart.reanchor).
        job = _discovery(store, framework, level, subject_name, subject)
        plan = coldstart.shared_plan(level, subject_name)
        if not plan.concepts:
            # The one case that still needs a sentence (BOARD-COLD-START §5), and it is narrower
            # than it was: not "we hold no syllabus" but "we hold nothing anyone could be started
            # on" — no chapters from this board and no shared concepts for this class and subject
            # either, which in practice means a language. The honest end and the open door, which
            # is §4.6 unchanged.
            state = _learner_job_state(job)
            return {
                **_framework_block(framework, version),
                "level": level,
                "subject": subject_name,
                "status": "looking" if state is JobState.QUEUED else state.value,
                "units": [],
                "placeholder": _job_block(job),
                "job_id": job.id,
                "wait_ms": 0,
                "label": labels.job_message(state),
                "not_listed": OWN_SYLLABUS,
            }
        return {
            **_framework_block(framework, version),
            "level": level,
            "subject": subject_name,
            "status": "shared",
            # Still empty, and for the same reason as before: chapters come from the board and
            # there is no chapter here to serve (§12, "a syllabus with no source").
            "units": [],
            # Concepts, not chapters. Ours, board-agnostic, and labelled `shared` so no surface
            # can mistake it for this board's syllabus.
            "plan": plan.as_dict(),
            # Machine fields. The job's id for the console and for the client's quiet poll; the
            # ceiling so the designed wait counts to one number rather than two. No prose about
            # either reaches the learner — the never-narrate law (EMAILS-AND-ANIMATIONS §3).
            "job_id": job.id,
            "wait_ms": _wait_ms(job),
            "not_listed": OWN_SYLLABUS,
        }

    # Narrowed by the branch above: units are non-empty only when both were found.
    block = {
        **_framework_block(framework, version),
        "level": level,
        "subject": subject_name,
        "subject_id": subject_node.id,
        # Every learner after the first arrives instantly (docs/BOARD-COLD-START.md §5): there is
        # nothing to wait for, and the client is told so in the same field it would have counted.
        "wait_ms": 0,
    }
    # First selection verifies from the web (docs/CURRICULUM-OBSERVER.md §2). A provisional
    # subject is checked against the board's document before its chapters are shown, once, with
    # an honest line while the check runs; the next learner reads what it found. Whatever it
    # found, the chapters served are the stored ones: the check labels, it never invents.
    check = _first_selection(store, framework, version, level_node, subject_node)
    if check is not None and check.state == "checking":
        job = check.job
        return {
            **block,
            "status": "checking",
            "units": [],
            "placeholder": _job_block(job) if job is not None else None,
            "label": check.line,
            "not_listed": OWN_SYLLABUS,
        }
    ops = _overlay(store, subject, version.id).patch if subject else []
    out = {**block, "status": "ready", "units": _views(store, version, units, ops, subject_node.id)}
    if _flag(payload, "anchor", "reanchor"):
        # The quiet re-anchor (docs/BOARD-COLD-START.md §3). A learner who started on the shared
        # plan asks for this ONCE, the first time their board's own syllabus answers: it says
        # which of the concepts they climbed is which chapter here, in the board's order and under
        # the board's names, so their progress moves without a word being said about it. Off the
        # hot path by design — it walks the version's topics, which the chapter list does not.
        out["anchors"] = [
            anchor.as_dict()
            for anchor in coldstart.reanchor(
                coldstart.shared_plan(level, subject_name),
                _subject_topics(store, version, subject_node),
            ).anchors
        ]
    if check is not None:
        out["label"] = check.line
        out["check"] = {
            "state": check.state,
            "line": check.line,
            "verified_at": check.verified_at,
            "checks_passed": list(check.checks_passed),
            "new_version_id": check.new_version_id,
        }
        if check.state == "provisional":
            out["not_listed"] = OWN_SYLLABUS
    return out


def _first_selection(
    store: CurriculumStore,
    framework: Framework,
    version: Version,
    level_node: Node | None,
    subject_node: Node | None,
) -> Any:
    """The re-check's verdict for this subject, or None when there is nothing to check: a version
    already verified, a personal framework, or the check switched off (``recheck.enabled``)."""
    from wobo_gateway.curriculum import recheck

    if (
        level_node is None
        or subject_node is None
        or framework.personal
        or version.status is Status.VERIFIED
        or not recheck.enabled()
    ):
        return None
    try:
        return recheck.on_selection(store, framework, version, level_node, subject_node)
    except StoreUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 — a check that cannot start must not hide the chapters
        logger.warning(
            "first selection check did not start", extra={"fields": {"error": type(exc).__name__}}
        )
        return None


def _discovery(
    store: CurriculumStore,
    framework: Framework,
    level: str,
    subject_name: str,
    requester: str,
) -> DiscoveryJob:
    """Record that a learner asked for a syllabus we do not hold, and answer honestly.

    The job is METERED when it is genuinely new (§4.4: a search, an extraction and a second
    reading is a generation, whoever asked).

    It used to be REFUSED in the same breath whenever no worker was running, because a job that
    says "Looking for the official syllabus now" while nothing is looking is the promise §4.6
    forbids. The cold start (``docs/BOARD-COLD-START.md``) removes the promise instead of the
    job: the learner is never told a search is happening, so there is nothing to lie about, and
    the row is left QUEUED where it belongs — the console queue a person picks up, and the backlog
    the worker drains the hour the owner sets ``WOBO_DISCOVERY_WORKER``. Refusing it instead threw
    away the only record that a real learner wanted that board.
    """
    before = store.find_recent_job(
        framework_id=framework.id, query=framework.name, level=level, subject=subject_name
    )
    job = store.enqueue_discovery(
        query=framework.name,
        framework_id=framework.id,
        level=level,
        subject=subject_name,
        requested_by=requester or None,
    )
    minted = before is None or before.id != job.id
    if minted:
        _charge_for(DISCOVERY_CAPABILITY)
        if not discovery_worker_running():
            # Nobody will move it until the owner flips the switch. That is a fact for the console
            # and for the log, and it is never a sentence a learner reads.
            logger.info(
                "curriculum.discovery queued with no worker: set %s to drain it",
                worker_switch(),
                extra={"job_id": job.id, "framework_id": framework.id},
            )
    return job


def _topics(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    """The topics of one unit, with the framework's own objectives underneath each (§2)."""
    framework = _framework(store, payload, subject)
    version = _version(store, framework, payload, subject)
    unit_id = _require(payload, "unit_id", "unit", what="which chapter to open")
    if version is None:
        raise CurriculumError(
            "unknown_version", "I do not have that edition of the syllabus.", status=404
        )
    unit = store.get_node(unit_id)
    if unit is None or unit.version_id != version.id or unit.kind is not NodeKind.UNIT:
        raise CurriculumError("unknown_unit", "I could not find that chapter.", status=404)

    ops = _overlay(store, subject, version.id).patch if subject else []
    topics = store.children(version.id, unit.id, kind=NodeKind.TOPIC)
    views = _views(store, version, topics, ops, unit.id)
    for view in views:
        if view.get("own"):
            view["objectives"] = []
            continue
        view["objectives"] = [
            objective.name
            for objective in store.children(version.id, str(view["id"]), kind=NodeKind.OBJECTIVE)
        ]
    return {
        **_framework_block(framework, version),
        "unit": {"id": unit.id, "name": unit.name, "order": unit.order},
        "topics": views,
    }


def _pin(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    """Pin the learner to a version. Everything they see afterwards is that version (§2)."""
    if not subject:
        raise CurriculumError(
            "sign_in_required", "Sign in and I will keep your syllabus.", status=401
        )
    framework = _framework(store, payload, subject)
    version = _version(store, framework, payload, subject)
    if version is None:
        raise CurriculumError(
            "unknown_version",
            "I do not have a syllabus for that board yet. Show me yours and I will build it.",
            status=404,
        )
    store.put_pin(subject, framework.id, version.id)
    return {**_framework_block(framework, version), "pinned": True}


def _edited_version(
    store: CurriculumStore, subject: str, framework: Framework, latest: Version
) -> Version | None:
    """The newest edition of this framework, other than the latest, that this learner has edited.

    An overlay is a statement that the learner studies THAT edition, whether or not they ever
    pinned it. It is read here so an upgrade can carry those edits across (§6, §12).
    """
    for version in store.versions_for(framework.id):
        if version.id == latest.id:
            continue
        overlay = store.get_overlay(subject, version.id)
        if overlay is not None and overlay.patch:
            return version
    return None


def _upgrade(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    """What moved since the learner's version, and — with ``apply`` — the switch (§2, §6).

    Without ``apply`` this changes nothing: it is the offer. With it, the pin moves and the
    overlay is carried across, and whatever could not be carried is reported in plain lines.
    """
    if not subject:
        raise CurriculumError(
            "sign_in_required", "Sign in and I will keep your syllabus.", status=401
        )
    framework = _framework(store, payload, subject)
    pinned_id = store.get_pin(subject, framework.id)
    current = store.get_version(pinned_id) if pinned_id else None
    latest = store.latest_version(framework.id)
    if current is None and latest is not None:
        # No pin, but the learner has edits on an older edition of this framework — which is what
        # happens when they edited without ever tapping "keep me on this edition", because nothing
        # in the capability set obliges them to. Their overlay is the pin: without this the answer
        # was "you are on the current edition", `remap`/`reapply` were never reached, and every
        # edit they had made was silently gone (§12, the killer).
        current = _edited_version(store, subject, framework, latest)
    if latest is None:
        raise CurriculumError(
            "unknown_version", "I do not have a syllabus for that board yet.", status=404
        )
    if current is None or current.id == latest.id:
        return {
            **_framework_block(framework, current or latest),
            "upgrade_available": False,
            "changes": [],
            "summary": "You are on the current edition",
        }

    changes = version_rules.diff(store.all_nodes(current.id), store.all_nodes(latest.id))
    block = {
        **_framework_block(framework, current),
        "upgrade_available": True,
        "latest": latest.as_dict(),
        "latest_label": labels.label_for(framework, latest),
        "changes": [change.as_dict() for change in changes],
        "summary": version_rules.summarise(changes),
    }
    if not payload.get("apply"):
        return block

    existing = _overlay(store, subject, current.id)
    # Re-key by node identity, not by id: a new version is a new extraction, so every id changed.
    mapping = overlay_ops.remap(store.all_nodes(current.id), store.all_nodes(latest.id))
    kept, dropped, report = overlay_ops.reapply(existing.patch, mapping)
    store.put_overlay(
        Overlay(subject_id=subject, version_id=latest.id, patch=kept, last_report=report)
    )
    store.put_pin(subject, framework.id, latest.id)
    return {
        **block,
        **_framework_block(framework, latest),
        "upgraded": True,
        "upgrade_available": False,
        "overlay_kept": len(kept),
        "overlay_dropped": len(dropped),
        "overlay_report": report,
    }


def _overlay_get(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    if not subject:
        raise CurriculumError("sign_in_required", "Sign in and I will keep your edits.", status=401)
    framework = _framework(store, payload, subject)
    version = _version(store, framework, payload, subject)
    if version is None:
        raise CurriculumError(
            "unknown_version", "I do not have a syllabus for that board yet.", status=404
        )
    return {
        **_framework_block(framework, version),
        "overlay": _overlay(store, subject, version.id).as_dict(),
    }


def _overlay_apply(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    """Store the learner's edits as a patch. The canonical version is not touched (§6)."""
    if not subject:
        raise CurriculumError("sign_in_required", "Sign in and I will keep your edits.", status=401)
    framework = _framework(store, payload, subject)
    version = _version(store, framework, payload, subject)
    if version is None:
        raise CurriculumError(
            "unknown_version", "I do not have a syllabus for that board yet.", status=404
        )
    try:
        incoming = overlay_ops.validate(payload.get("ops"))
    except overlay_ops.OverlayRejected as exc:
        raise CurriculumError("overlay_rejected", exc.message) from exc

    nodes = store.all_nodes(version.id)
    names = {node.id: node.name for node in nodes}
    known = set(names)
    for op in incoming:
        unknown = {
            ident
            for ident in overlay_ops.op_node_ids([op])
            if ident not in known and not ident.startswith(overlay_ops.OWN_PREFIX)
        }
        if unknown:
            raise CurriculumError(
                "unknown_node", "I could not find the part of the syllabus that edit is about."
            )

    existing = _overlay(store, subject, version.id)
    try:
        merged = overlay_ops.merge(existing.patch, overlay_ops.annotate(incoming, names))
    except overlay_ops.OverlayRejected as exc:
        raise CurriculumError("overlay_rejected", exc.message) from exc
    stored = store.put_overlay(
        Overlay(subject_id=subject, version_id=version.id, patch=merged, last_report=[])
    )
    # The observer counts the edit, anonymously, on the canonical node it names
    # (docs/CURRICULUM-OBSERVER.md §3). The overlay is the learner's under the memory law; the
    # count is ours. It rides AFTER the write and never raises: an observer that cannot count
    # must not cost a learner their edit.
    from wobo_gateway.curriculum import observer as syllabus_observer

    syllabus_observer.note_overlay(subject, version.id, incoming, nodes=nodes)
    # An edit is a commitment to an edition. Without this the learner's chapter list silently
    # reverted to the board's the moment a new version was published — their overlay still on
    # disk under the old version id, unreachable, and `curriculum.upgrade` answering "you are on
    # the current edition" (§12: "a learner's edits lost on upgrade"). Pinning here is what makes
    # the upgrade an OFFER with a diff rather than something that happens to them.
    store.put_pin(subject, framework.id, version.id)
    return {
        **_framework_block(framework, version),
        "overlay": stored.as_dict(),
        "applied": len(incoming),
        "pinned_version_id": version.id,
    }


def _status(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    """How a discovery job is going, in the one line the learner reads (§4, §5)."""
    job_id = _text(payload, "job_id", limit=64)
    job: DiscoveryJob | None = None
    if job_id:
        job = store.get_job(job_id)
    else:
        framework_id = _text(payload, "framework_id", "framework")
        query = _text(payload, "q", "query") or framework_id
        if not query:
            raise CurriculumError("needs_more", "Tell me which syllabus and I will check.")
        job = store.find_open_job(
            framework_id=framework_id or None,
            query=query,
            level=_text(payload, "level") or None,
            subject=_text(payload, "subject") or None,
        )
    if job is None:
        return {"job": None, "state": None, "message": "I am not looking for anything right now."}
    # §4.6: a search nobody is running is never reported as running. The row stays queued — it is
    # the console's queue and the backlog the worker drains the hour the owner sets the switch —
    # but what a LEARNER is told is where they actually stand, which is the honest end and the
    # open door. Nothing is written; this is a reading, not a refusal.
    state = _learner_job_state(job)
    block = _job_block(job)
    return {
        "job": block,
        "state": state.value,
        # One line, read once: the block beside it must not disagree with it.
        "message": block["message"],
        # The honest end of §4.6: the moment a search gives up, the own-syllabus door is open.
        **({"not_listed": OWN_SYLLABUS} if state in (JobState.REFUSED, JobState.FAILED) else {}),
    }


# --- the learner's own syllabus (§6) --------------------------------------------------------------
#
# Four capabilities, one object. `read` structures a document into a personal framework and holds
# it under the learner's own subject; `confirm` records one tap; `publish` freezes the version;
# `offer` puts an anonymised copy in the review queue. Only `public_view` ever crosses the door,
# so no model id, no owner id and no page of the learner's document leaves the brain.


def _structure_model() -> own_syllabus.StructureModel | None:
    """The tier that reads a learner's document — or the rule that stands in for it offline.

    `LLM_MODE=mock` is how the suite and a keyless machine run, and the own-syllabus door is the
    one door that must never be closed (§6). None means "the live generate tier", which is what
    :func:`own.structure` defaults to.
    """
    if (os.getenv("LLM_MODE") or "mock").strip().lower() == "mock":
        return own_syllabus.OfflineStructureModel()
    return None


def _own_refusal(exc: own_syllabus.IntakeRefused) -> CurriculumError:
    """An intake that refused is not a server error — it is Wobo saying what went wrong, once."""
    return CurriculumError(getattr(exc, "reason", "refused"), str(exc))


def _own_draft(store: CurriculumStore, subject: str, payload: dict[str, Any]) -> dict[str, Any]:
    framework_id = _require(payload, "framework_id", "id", what="which syllabus")
    draft = store.get_personal(subject, framework_id)
    if draft is None:
        raise CurriculumError(
            "unknown_framework",
            "I do not have that syllabus any more. Show it to me again and I will read it.",
            status=404,
        )
    return draft


def _own_read(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    """Paste, photo or PDF in; a personal framework awaiting one tap per unit out."""
    if not subject:
        raise CurriculumError(
            "sign_in_required", "Sign in and I will keep your syllabus.", status=403
        )
    kind = _text(payload, "kind", limit=16).lower() or "paste"
    title = _text(payload, "title", limit=own_syllabus.MAX_NAME_CHARS)
    try:
        if kind in ("paste", "text", "type"):
            document = own_syllabus.read_paste(
                _text(payload, "text", limit=own_syllabus.MAX_SOURCE_CHARS), title=title
            )
        elif kind == "photo":
            document = own_syllabus.read_photo(
                _b64(payload.get("image"), what="photo"),
                media_type=_text(payload, "media_type", limit=64),
                title=title,
            )
        elif kind == "pdf":
            document = own_syllabus.read_pdf(_b64(payload.get("data"), what="PDF"), title=title)
        else:
            raise CurriculumError("bad_request", "Paste it, photograph it, or send me the PDF.")
        built = own_syllabus.structure(
            document,
            owner=subject,
            framework_name=_text(
                payload, "framework_name", "name", limit=own_syllabus.MAX_NAME_CHARS
            ),
            level=_text(payload, "level", limit=64),
            subject=_text(payload, "subject", limit=64) or "General",
            language=_text(payload, "language", limit=16) or "en",
            model=_structure_model(),
        )
    except own_syllabus.IntakeRefused as exc:
        raise _own_refusal(exc) from exc
    previous = store.get_personal(subject, built["framework"]["id"])
    if previous is not None and (previous.get("version") or {}).get("published_at"):
        # They already published a syllabus under this name and have now shown me another
        # document. Writing this over the published one would be an edit in place: same framework
        # id, same version id, `published_at` back to null and different chapters underneath every
        # learner pinned to it and every overlay keyed to it. §2 says a correction is a NEW
        # version with a `supersedes` pointer, so that is what this becomes.
        built = own_syllabus.supersede(built, previous)
    store.put_personal(subject, built)
    return own_syllabus.public_view(built)


def _own_confirm(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    """One tap, one unit (§6). The learner's confirmation is the verification of their own plan."""
    draft = _own_draft(store, subject, payload)
    unit_id = _require(payload, "unit_id", "unit", what="which chapter")
    confirmed = payload.get("confirmed")
    try:
        updated = own_syllabus.confirm_unit(
            draft, unit_id, confirmed=True if confirmed is None else bool(confirmed)
        )
    except own_syllabus.IntakeRefused as exc:
        raise _own_refusal(exc) from exc
    store.put_personal(subject, updated)
    return own_syllabus.public_view(updated)


def _personal_rows(
    subject: str, published: dict[str, Any]
) -> tuple[Framework, Version, list[Node], list[Provenance]]:
    """A published personal syllabus, as the same rows every other framework is stored in (§10).

    A personal framework IS a framework: the learner opens its chapters and its topics, pins it,
    overlays it, and upgrades it when they show me a newer document. All of that is the registry's
    machinery, and none of it could reach a personal framework while publishing only froze a dict
    in a drafts table — the own-syllabus door opened onto a room with no exit (§6, §8).

    ``owner_subject`` is what keeps it theirs: ``_visible`` mirrors the RLS policy in 0008, so it
    is served to its owner and to nobody else.
    """
    fw = published["framework"]
    version_row = published["version"]
    level = published["level"]
    subject_node = published["subject"]
    framework = Framework(
        id=fw["id"],
        name=fw["name"],
        kind=FrameworkKind.PERSONAL,
        status=Status.PERSONAL,
        languages=tuple(fw.get("languages") or ("en",)),
        levels=tuple(fw.get("levels") or ()),
        owner_subject=subject,
    )
    version = Version(
        id=version_row["id"],
        framework_id=fw["id"],
        label=version_row["label"],
        status=Status.PERSONAL,
        supersedes=version_row.get("supersedes"),
        published_at=version_row.get("published_at"),
        document_hash=(published.get("provenance") or {}).get("document_hash"),
    )

    def node(row: dict[str, Any], kind: NodeKind, parent: str | None, order: int) -> Node:
        return Node(
            id=row["id"],
            version_id=version.id,
            kind=kind,
            name=row["name"],
            parent_id=parent,
            order=order,
            source_ref=row.get("source_ref"),
        )

    nodes = [
        node(level, NodeKind.LEVEL, None, int(level.get("order") or 0)),
        node(subject_node, NodeKind.SUBJECT, level["id"], 0),
    ]
    for unit in published.get("units", []):
        nodes.append(node(unit, NodeKind.UNIT, subject_node["id"], int(unit.get("order") or 0)))
        for topic in unit.get("topics", []):
            nodes.append(node(topic, NodeKind.TOPIC, unit["id"], int(topic.get("order") or 0)))
            for index, objective in enumerate(topic.get("objectives") or []):
                nodes.append(
                    Node(
                        id=own_syllabus.node_id(topic["id"], "objective", str(index)),
                        version_id=version.id,
                        kind=NodeKind.OBJECTIVE,
                        name=str(objective),
                        parent_id=topic["id"],
                        order=index,
                        source_ref=topic.get("source_ref"),
                    )
                )
    record = published.get("provenance") or {}
    provenance = [
        Provenance(
            version_id=version.id,
            node_id=None,
            source_url=record.get("source_url"),
            source_page_or_section=record.get("source_page_or_section"),
            document_hash=record.get("document_hash"),
            fetched_at=record.get("fetched_at"),
            checks_passed=tuple(record.get("checks_passed") or ()),
            # The learner confirmed every chapter with their own tap, holding their own document.
            # That is the verification of a personal framework (§6), and it is not ours to claim.
            verified_at=version_row.get("published_at"),
            verified_by="community",
        )
    ]
    return framework, version, nodes, provenance


def _own_publish(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    """Freeze it, and put it in the registry as the learner's own (§2, §6, §10)."""
    draft = _own_draft(store, subject, payload)
    try:
        published = own_syllabus.publish(draft)
    except own_syllabus.IntakeRefused as exc:
        raise _own_refusal(exc) from exc
    store.put_personal(subject, published)
    framework, version, nodes, provenance = _personal_rows(subject, published)
    store.put_framework(framework)
    store.put_version(version)
    store.put_nodes(nodes)
    store.put_provenance(provenance)
    # Their syllabus is the one they study, so it is the one they are on — the FIRST time. A
    # publication that supersedes one they are already pinned to does not move them: that is an
    # upgrade, and §6 says an upgrade is offered with a diff, through `curriculum.upgrade`, which
    # carries their overlay across. Moving the pin here would skip both.
    pinned = store.get_pin(subject, framework.id)
    if not pinned:
        store.put_pin(subject, framework.id, version.id)
        pinned = version.id
    return {**own_syllabus.public_view(published), "pinned_version_id": pinned}


def _own_offer(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    """Offer it to the registry as `community`. Always the learner's choice, never the default."""
    draft = _own_draft(store, subject, payload)
    try:
        row = own_syllabus.offer_to_registry(draft, note=_text(payload, "note", limit=400))
    except own_syllabus.IntakeRefused as exc:
        raise _own_refusal(exc) from exc
    # "A person checks it" has to be true before it is said. The row used to be built, its status
    # read, and the row itself dropped: nothing was queued and nobody could have checked it (§6).
    stored = store.put_review_row(
        {
            "id": row["id"],
            "version_id": draft["version"]["id"],
            "reason": f"framework_offer: {row['framework_name']}",
            "state": "open",
            "kind": row["kind"],
            "framework_id": row["framework_id"],
            "offered_by_hash": row["offered_by_hash"],
            "note": row["note"],
            "payload": row["payload"],
            "created_at": row["created_at"],
        }
    )
    # The queue row itself is a moderator's object; the learner is told what happened, no more.
    # `review` is the state of the offer, not of their syllabus: theirs stays personal and theirs.
    return {
        "offered": True,
        "review": "pending" if stored.get("state", "open") == "open" else str(stored["state"]),
        "message": "Thank you. A person checks it before anyone else sees it.",
        "framework": own_syllabus.public_view(draft)["framework"],
    }


def _blueprint(payload: dict[str, Any], subject: str, store: CurriculumStore) -> dict[str, Any]:
    """The stored pool for one syllabus cell, or none — and never a build.

    Three things this is careful about:

    * **it never generates.** ``create.blueprint`` is a platform-paid job an operator runs; a
      learner opening a chapter must not be able to start one from a read.
    * **a HELD pool is not served.** ``blueprint.load`` already refuses anything the judge did not
      pass; the count of held attempts rides along so the client can say "not yet" honestly rather
      than pretending the chapter has no pool.
    * **the answer is the document the client already parses** (``curriculum/blueprint.ts``:
      ``isBlueprint``), so there is one shape and not two.
    """
    from wobo_gateway.plexus import blueprint as architect

    try:
        brief = architect.NodeBrief.from_dict(payload)
    except (ValueError, TypeError) as exc:
        raise CurriculumError(
            "bad_request",
            "I need the chapter and its topics before I can look up how it is built.",
        ) from exc
    try:
        pool = architect.load(brief)
        held_count = len(architect.held(brief))
    except Exception:  # a cache that cannot be read is a cell with no pool, never an error page
        logger.warning("curriculum: the blueprint read failed", exc_info=True)
        return {"blueprint": None, "held": 0}
    return {
        "blueprint": pool.model_dump(mode="json", exclude_none=True) if pool is not None else None,
        "held": held_count,
    }


_HANDLERS = {
    "curriculum.search": _search,
    "curriculum.blueprint": _blueprint,
    "curriculum.framework": _framework_capability,
    "curriculum.units": _units,
    "curriculum.topics": _topics,
    "curriculum.pin": _pin,
    "curriculum.upgrade": _upgrade,
    "curriculum.overlay.get": _overlay_get,
    "curriculum.overlay.apply": _overlay_apply,
    "curriculum.status": _status,
    "curriculum.own.read": _own_read,
    "curriculum.own.confirm": _own_confirm,
    "curriculum.own.publish": _own_publish,
    "curriculum.own.offer": _own_offer,
}
