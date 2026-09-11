"""The generic-turn door: what may be written once and served to everybody (docs/CACHES.md).

THE ONE SENTENCE THIS FILE EXISTS FOR. *"A generic turn is generic only when its context packet
carries nothing personal."* Everything below is that sentence made checkable.

Turns are the most frequent model call in the product and the generic ones repeat across every
learner at a level: "what is a prime number", "why is the sky blue", "how do I balance this". One
answer, made once, served to all of them, is the largest single saving available — and it is also
the single place where a caching mistake would leak one child's life to another. So the door is
built to refuse rather than to serve:

* :func:`why_not_generic` returns REASONS, not a boolean, and a turn is generic only when that list
  is empty. Every new field a context packet grows is personal until somebody adds it to
  :data:`IMPERSONAL` deliberately, with a test. A default of "assume it is fine" would mean the
  next person to add a field to the packet silently widens what we cache.
* Nothing is written when there is a reason. Nothing is READ when there is a reason either — the
  same check gates both directions, because a learner whose packet carries their own working must
  get an answer about THEIR working, not the stock one.
* ``content.turns`` has no column a person could live in, and refuses a body carrying one
  (migration 0026, ruling 5). The schema and this file say the same thing twice on purpose.

RE-ANCHORING, AND WHY A CACHED PLAN IS SAFE. A stored turn may carry an ink PLAN: what Wobo draws
while it talks, named by SEMANTIC TARGET from the surface registry ("the effect circle", "step 2"),
never by pixel. At serve time :func:`reanchor` resolves every one of those names against the screen
the learner is actually looking at. If a single target is absent the whole plan is DECLINED and the
turn goes live — a pointer at nothing is worse than silence (BOARD.md §11), and a plan that half
lands is a pointer at nothing wearing a plan's clothes.

WHAT IS DELIBERATELY NOT CACHED. A first meeting. A turn inside a lesson the learner has their own
working on. Anything with a mind item, an interest, a parent-offered fact, a twin summary, a
machine-room reading, a focus region they circled, or a session history. Each of those is a reason
in :data:`REASONS`, each has a test, and each of them costs a model call every time — correctly.
"""

from __future__ import annotations

import hashlib
import logging
import re
from typing import Any

logger = logging.getLogger("wobo.gateway.generic_turn")

#: The store these rows live in.
STORE = "turns"

#: How many characters of a question can still be "the thing many learners ask in the same words".
#: The migration refuses a longer one; the same number is here so a caller is told before the
#: round trip rather than by a constraint violation. Three at the bottom: "why", "how" and their
#: kind are real questions, and anything shorter is not one.
MIN_QUESTION = 3
MAX_QUESTION = 300


# --- what makes a packet personal -----------------------------------------------------------------
#
# THE LIST IS AN ALLOW-LIST, AND THAT IS THE WHOLE DESIGN. `IMPERSONAL` names the context blocks
# that are the same for every learner at a level; anything else in the packet, present and
# non-empty, is a reason not to cache. A deny-list would have to be updated every time the client
# adds a field, and the failure mode of forgetting is a leak. The failure mode of forgetting HERE
# is a cache miss.

#: Context blocks that carry no person. ``curriculum`` is the board's own syllabus coordinate;
#: ``page`` is which route the learner is on (a route is not a person); ``turn`` carries the
#: question itself, which is screened separately below; ``glass``/``targets``/``packet`` describe
#: the SCREEN, which is the same lesson page for everybody at that level and is never keyed on —
#: a plan re-anchors to it instead.
IMPERSONAL: frozenset[str] = frozenset(
    {"curriculum", "page", "turn", "glass", "targets", "packet", "board", "locale", "lifetime"}
)

#: The ONLY fields a learner's dossier may carry and still leave the turn generic.
#:
#: ``name`` is here on the strength of one ruling: *"A learner's name is stitched in at serve time
#: by the cheapest model or by a template, never stored"* (docs/CACHES.md §2). So a name in the
#: PACKET is fine and a name in the STORED ANSWER is not, and :func:`body_for` is where that is
#: made true — the name comes out of the say and a placeholder goes in, and the serving learner's
#: own name goes back at read.
#:
#: ``grade`` and ``board`` are the LEVEL and they are in the key, so every learner who reaches a
#: row shares them. ``age`` is allowed through the door on the same footing ONLY because it is
#: now a key term too (:func:`age_of`, 2026-09-10): it used to be waved through on the claim that
#: it was already in the key, which it was not, and an answer written for an eleven-year-old was
#: served to a thirteen-year-old in the same class. Everything else a dossier can hold —
#: interests, remembered facts, what a parent passed on, the twin summary, mastery highlights,
#: access needs, the language to teach in — changes the answer for one child, and a turn carrying
#: any of them is answered live.
#:
#: The two names match the two levels of the dossier ``mind.ground_lifetime`` builds and
#: ``wobo._dossier`` renders: ``lifetime.learner`` holds the person, and ``lifetime`` itself holds
#: everything that was learned ABOUT them.
LIFETIME_ALLOWED: frozenset[str] = frozenset({"learner"})
DOSSIER_ALLOWED: frozenset[str] = frozenset({"name", "age", "grade", "board"})

#: Blocks that are personal by name, listed so the reason a turn was refused is a sentence an
#: operator can read rather than "an unknown key".
REASONS: dict[str, str] = {
    "machine": "the packet carries the machine room, which is this learner's own progress",
    "mind": "the packet carries mind items",
    "learner": "the packet names the learner",
    "session": "the packet carries this learner's session",
    "history": "the packet carries this conversation's history",
    "canvas": "the packet carries the learner's own working",
    "focuses": "the packet carries a region this learner circled",
}

#: Fields inside ``context.turn`` that make even a stock question personal.
_PERSONAL_TURN_FIELDS = ("firstMeeting", "lastWoboReply", "history", "transcript")


def _nonempty(value: Any) -> bool:
    """Is there anything actually in this block? An empty dict the client always sends is not
    personal context; it is the client always sending an empty dict."""
    if value is None or value is False:
        return False
    if isinstance(value, str | list | tuple | dict | set):
        return len(value) > 0
    return True


def why_not_generic(payload: dict[str, Any]) -> list[str]:
    """Every reason this turn may not be written once and served to everybody. Empty means it may.

    Reasons, not a boolean, because "why did this never cache" is the first question anybody asks
    of a cache that is not saving money, and a door that can only say no is a door nobody can tune.
    """
    reasons: list[str] = []
    if not isinstance(payload, dict):
        return ["the payload is not an object"]

    # The client marks a first meeting on the payload as well as in the context, and a welcome is
    # by definition about one person arriving.
    if payload.get("first_meeting") is True:
        reasons.append("this is the learner's first meeting")

    context = payload.get("context")
    if not isinstance(context, dict):
        return ["the turn carries no context to judge"]

    for name, reason in REASONS.items():
        if _nonempty(context.get(name)):
            reasons.append(reason)

    # THE DOSSIER, FIELD BY FIELD, AND AFTER GROUNDING. This check is deliberately made on the
    # packet as the MODEL will see it, not as the browser sent it: ``mind.ground_lifetime`` fills
    # ``context.lifetime`` from the learner's own row in place, at the door, before the turn is
    # served. A door that judged the browser's version would happily cache a turn that had the
    # child's remembered facts in it by the time it was answered.
    lifetime = context.get("lifetime")
    if isinstance(lifetime, dict):
        for field_name, value in lifetime.items():
            if field_name in LIFETIME_ALLOWED or not _nonempty(value):
                continue
            reasons.append(f"the dossier carries {field_name!r}, which belongs to one learner")
        learner = lifetime.get("learner")
        if isinstance(learner, dict):
            for field_name, value in learner.items():
                if field_name in DOSSIER_ALLOWED or not _nonempty(value):
                    continue
                reasons.append(f"the learner record carries {field_name!r}")
        elif _nonempty(learner):
            reasons.append("the packet carries a learner that is not a record")
    elif _nonempty(lifetime):
        reasons.append("the packet carries a dossier that is not a record")

    # Anything the packet grew that nobody has classified. Unknown is personal.
    for name, value in context.items():
        if name in IMPERSONAL or name in REASONS:
            continue
        if _nonempty(value):
            reasons.append(f"the packet carries {name!r}, which nothing has declared impersonal")

    turn = context.get("turn")
    if isinstance(turn, dict):
        for name in _PERSONAL_TURN_FIELDS:
            if _nonempty(turn.get(name)):
                reasons.append(f"the turn carries {name!r}")

    # The surface registry's own snapshot may carry a focus — the region the learner circled —
    # even when `context.focuses` is empty. A turn about the thing THIS learner pointed at is not
    # a turn about a concept.
    packet = context.get("packet")
    if isinstance(packet, dict) and _nonempty(packet.get("focus")):
        reasons.append("the packet carries a region this learner circled")

    question = question_of(payload)
    if not question:
        reasons.append("there is no question to key on")
    elif len(question) > MAX_QUESTION:
        reasons.append("the question is longer than a question many learners ask in the same words")

    return reasons


def is_generic(payload: dict[str, Any]) -> bool:
    """True when this turn may be written once and served to every learner at its level."""
    return not why_not_generic(payload)


# --- the key --------------------------------------------------------------------------------------

_PUNCTUATION = re.compile(r"[^\w\s]+", re.UNICODE)
_SPACES = re.compile(r"\s+")


def normalise_question(text: str) -> str:
    """The question as the key spells it: lowercased, punctuation dropped, whitespace collapsed.

    "What is a prime number?", "what is a prime number" and "  What   is a Prime Number ?? " are
    one question asked by three children, and keying them apart would mean paying three times for
    one answer. Nothing cleverer than that: no stemming, no synonym table, no embedding. A
    near-miss costs one generation, and a wrong merge serves a child an answer to a question they
    did not ask, so the normalisation stops exactly where certainty does.
    """
    folded = _PUNCTUATION.sub(" ", str(text or "").lower())
    return _SPACES.sub(" ", folded).strip()


def question_of(payload: dict[str, Any]) -> str:
    """The normalised question this turn is about, or "" when there is not one."""
    context = payload.get("context") if isinstance(payload, dict) else None
    turn = (context or {}).get("turn") if isinstance(context, dict) else None
    if not isinstance(turn, dict):
        return ""
    return normalise_question(turn.get("lastUserInput") or "")


def coordinates_of(payload: dict[str, Any]) -> dict[str, str]:
    """The level this question was asked at: board, class, subject, concept.

    Read from the curriculum block, which is the board's own coordinate and carries no person.
    A missing coordinate is "" and keys distinctly from every real one, so an unscoped question
    never collides with a class 6 one.
    """
    context = payload.get("context") if isinstance(payload, dict) else None
    curriculum = (context or {}).get("curriculum") if isinstance(context, dict) else None
    curriculum = curriculum if isinstance(curriculum, dict) else {}

    from wobo_gateway.plexus import store as plexus_store

    concept = str(curriculum.get("nodeName") or curriculum.get("concept") or "").strip()
    return {
        "board": str(curriculum.get("board") or "").strip().lower(),
        "grade": str(curriculum.get("grade") or curriculum.get("class") or "").strip().lower(),
        "subject": str(curriculum.get("subject") or "").strip().lower(),
        "concept_id": plexus_store.concept_id(concept) if concept else "",
    }


def age_of(payload: dict[str, Any]) -> str:
    """The learner's age as the key spells it, or "" when the packet does not carry one.

    WHY THE AGE IS A KEY TERM AND NOT A FREE RIDE. ``DOSSIER_ALLOWED`` lets a packet carry
    ``age`` through the generic door, and the justification written beside it was *"age, grade and
    board are the LEVEL, which is in the key already: every learner who reaches this row shares
    them."* That was true of grade and board and false of age: an eleven-year-old and a
    thirteen-year-old are both Class 6, the persona is handed the age, and a say that used it
    ("at eleven you have probably noticed…") was stored verbatim and served to the other child,
    who was told they were eleven. Nothing strips an age from prose the way ``_unname`` strips a
    name — an age is a fact IN the sentence, not a token beside it — so the fix is the key: two
    ages are two rows, and the sentence a row holds is true for everybody it reaches.

    A number, a numeral in a string and "11 years" all key alike; anything else keys as itself.
    """
    context = payload.get("context") if isinstance(payload, dict) else None
    lifetime = (context or {}).get("lifetime") if isinstance(context, dict) else None
    learner = (lifetime or {}).get("learner") if isinstance(lifetime, dict) else None
    if not isinstance(learner, dict):
        return ""
    raw = learner.get("age")
    if raw is None or raw is False or raw == "":
        return ""
    if isinstance(raw, bool):
        return ""
    if isinstance(raw, int | float):
        return str(int(raw))
    digits = re.findall(r"\d+", str(raw))
    return digits[0] if len(digits) == 1 else str(raw).strip().lower()


def key_for(payload: dict[str, Any]) -> str | None:
    """The store key for this turn, or None when the turn is not generic.

    The normalised question x board x grade x subject x concept x age, digested — with NO personal
    context in it, which is the rule this key exists to keep. The readable head is the first words
    of the question, because an operator reading the stores desk should be able to see what a
    popular row IS without opening it.
    """
    if not is_generic(payload):
        return None
    question = question_of(payload)
    if len(question) < MIN_QUESTION:
        return None
    coords = coordinates_of(payload)
    body = "\x00".join(
        [
            question,
            coords["board"],
            coords["grade"],
            coords["subject"],
            coords["concept_id"],
            age_of(payload),
        ]
    )
    digest = hashlib.sha256(body.encode()).hexdigest()[:16]
    head = re.sub(r"[^a-z0-9]+", "-", question)[:48].strip("-") or "question"
    return f"{head}--{digest}"


# --- re-anchoring ---------------------------------------------------------------------------------


def _targets_named_by(plan: Any) -> list[str]:
    """Every semantic target a stored plan names, in the order it names them.

    A plan is the model's own grammar, stored as it was planned:
    ``{"sentences": [{"say", "marks": [{"kind", "target", "words"}]}], "ask": {"targets"}}``.

    An ``open`` intent names no target: it draws from scratch onto board space, so there is
    nothing on the learner's screen for it to miss.
    """
    if not isinstance(plan, dict):
        return []
    named: list[str] = []
    for sentence in plan.get("sentences") or []:
        if not isinstance(sentence, dict):
            continue
        for mark in sentence.get("marks") or []:
            if isinstance(mark, dict) and str(mark.get("target") or "").strip():
                named.append(str(mark["target"]).strip())
    ask = plan.get("ask")
    if isinstance(ask, dict):
        for target in ask.get("targets") or []:
            if str(target or "").strip():
                named.append(str(target).strip())
    return named


def reanchor(plan: Any, payload: dict[str, Any]) -> dict[str, Any] | None:
    """The stored plan if every target it names is on THIS learner's screen, else None.

    ALL OR NOTHING, and that is the ruling. A stored plan was composed as one explanation: three
    sentences, each with a mark, each mark carrying the words that make the sentence mean
    something. Dropping the marks whose targets are absent leaves sentences saying "this one" over
    nothing, which is the failure BOARD.md §11 names and the reason the planner already refuses an
    unanchored mark outright. So a plan that cannot land completely is declined completely and the
    turn goes live, which costs one model call and is always right.

    A plan naming NO targets (a spoken answer with nothing drawn) always lands: there is nothing
    to miss.
    """
    if not isinstance(plan, dict):
        return None
    named = _targets_named_by(plan)
    if not named:
        return plan

    from wobo_gateway.board.planner import Surface

    context = payload.get("context") if isinstance(payload, dict) else {}
    context = context if isinstance(context, dict) else {}
    board_context = payload.get("board") if isinstance(payload, dict) else {}
    board_context = board_context if isinstance(board_context, dict) else {}
    surface = Surface.from_context(context, board_context)
    on_screen = surface.targets | surface.focuses
    missing = [target for target in named if target not in on_screen]
    if missing:
        logger.info(
            "generic turn: a cached plan was declined, its target is not on this screen",
            extra={"fields": {"missing": missing[:4]}},
        )
        return None
    return plan


# --- reading and writing --------------------------------------------------------------------------


def load(payload: dict[str, Any]) -> dict[str, Any] | None:
    """The stored answer to this question at this level, ready to serve, or None.

    None means "ask a model", and it means that for every one of: a personal packet, an
    unconfigured database, an unreachable one, a row that is not there, and a stored plan whose
    targets are not on this learner's screen. The caller has one branch and it is the right one.
    """
    key = key_for(payload)
    if not key:
        return None

    from wobo_gateway.plexus import db

    if not db.configured():
        return None
    row = db.read(STORE, key)
    if not isinstance(row, dict):
        db.note_miss(STORE)
        return None
    body = row.get("body")
    if not isinstance(body, dict) or not str(body.get("say") or "").strip():
        db.note_miss(STORE)
        return None
    why = refusals(body)
    if why:
        # A row can be older than this gate, or put there by a hand at the database. Either way it
        # is refused rather than laundered: cleaning it here would serve a learner a sentence
        # nothing ever judged, and the turn going live costs one model call and is always right.
        logger.warning(
            "generic turn: a stored answer was refused on the read",
            extra={"fields": {"reasons": why[:4], "key": key}},
        )
        db.note_miss(STORE)
        return None

    out: dict[str, Any] = {k: v for k, v in body.items() if k != "plan"}
    out["say"] = stitch_name(str(body.get("say") or ""), name_in(payload))
    plan = body.get("plan")
    if plan is not None:
        landed = reanchor(plan, payload)
        if landed is None:
            # The words alone would be a different answer from the one that was judged: the
            # sentences were written to be said WITH those marks. Decline the whole row.
            db.note_miss(STORE)
            return None
        out["plan"] = landed

    db.note_database_hit(STORE, row.get("cost_usd"))
    db.note_serve(STORE, row.get("id"))
    out["cached"] = True
    return out


# --- the name, which is stitched and never stored -------------------------------------------------
#
# docs/CACHES.md §2: *"A learner's name is stitched in at serve time by the cheapest model or by a
# template, never stored."* A template is what this is — no model call, no cost, and no way for one
# child's name to end up in another child's answer, because the name never enters the row.
#
# The persona addresses a learner by name, so without this almost every turn would carry one and
# almost nothing would be cacheable. With it, "Good question, Arjun." is stored as
# "Good question, {learner}." and served to Meera as "Good question, Meera." and to a signed-out
# visitor as "Good question."

NAME_SLOT = "{learner}"

#: Shorter than this and a name is a substring of ordinary words, and replacing
#: it would mangle the sentence. A turn whose learner has a two-letter name is answered live.
_MIN_NAME = 3


def name_in(payload: dict[str, Any]) -> str:
    """The learner's own name from the dossier, or "" — never stored, only stitched with."""
    context = payload.get("context") if isinstance(payload, dict) else None
    lifetime = (context or {}).get("lifetime") if isinstance(context, dict) else None
    learner = (lifetime or {}).get("learner") if isinstance(lifetime, dict) else None
    if not isinstance(learner, dict):
        return ""
    return str(learner.get("name") or "").strip()


def _unname(text: str, name: str) -> str:
    """The say with this learner's name replaced by the slot. Whole words only."""
    if not name or len(name) < _MIN_NAME:
        return text
    return re.sub(rf"\b{re.escape(name)}\b", NAME_SLOT, text)


def stitch_name(text: str, name: str) -> str:
    """The stored say with the slot filled by the learner in front of us.

    With no name to fill, the slot AND the punctuation that was holding it are removed, so
    "Good question, {learner}." becomes "Good question." and never "Good question, ." — a
    stray comma is the tell that would make a cached line feel machine-made.
    """
    if NAME_SLOT not in text:
        return text
    if name and len(name) >= _MIN_NAME:
        return text.replace(NAME_SLOT, name)
    without = re.sub(rf"[,:;]?\s*{re.escape(NAME_SLOT)}", "", text)
    return _SPACES.sub(" ", without).strip()


def body_for(
    output: dict[str, Any], plan: dict[str, Any] | None = None, *, learner_name: str = ""
) -> dict[str, Any]:
    """What of a served turn is stored: the say, the actions, and the plan. Nothing else.

    An allow-list and not a copy of the output, for the same reason ``ledger.FIELDS`` is one: the
    turn output grows fields, and a body built by copying would store whichever of them happened
    to be personal that week. ``grounded`` and ``verified`` ride along because they are properties
    of the ANSWER (was it grounded in working, which sums were proved), not of the asker.
    """
    body: dict[str, Any] = {"say": _unname(str(output.get("say") or ""), learner_name)}
    for name in ("actions", "path", "grounded", "handed_answer", "verified"):
        if name in output:
            body[name] = output[name]
    if plan:
        body["plan"] = plan
    return body


# --- the gate, at both doors ----------------------------------------------------------------------
#
# docs/CACHES.md §2: *"a cached row is re-sanitised and re-linted on every read (wave 31), so a
# poisoned row is refused."* The level store honours that (``engines._cache_read_refusals`` runs on
# every cache read); this store did not, and it is the one carrying free-form model prose to every
# child who asks the same question. A turn has no judge — there is no scored verdict on an
# answer — so what stands in for one is the part of the law a machine can decide alone: the
# register, and the markup. Both run BEFORE a write, because a bad row is served forever, and
# again on every READ, because a row can be older than the gate or written by a hand at the
# database.

#: The dash a learner never reads (docs/copy/voice.md 10a). A comma, a colon or a full stop does
#: the job, and a model that reached for one wrote a line we do not serve.
_LONG_DASH = re.compile(r"[—–]")

#: Markup in prose. The say is read aloud and printed; a tag in it is a row somebody tampered with.
_MARKUP = re.compile(r"<\s*/?\s*[a-zA-Z!]|javascript:", re.IGNORECASE)


def _says_in(body: dict[str, Any]) -> list[str]:
    """Every line of this row a learner would hear: the answer, and the plan's own sentences."""
    lines = [str(body.get("say") or "")]
    plan = body.get("plan")
    if isinstance(plan, dict):
        for sentence in plan.get("sentences") or []:
            if isinstance(sentence, dict):
                lines.append(str(sentence.get("say") or ""))
        ask = plan.get("ask")
        if isinstance(ask, dict):
            lines.append(str(ask.get("prompt") or ""))
    return [line for line in lines if line.strip()]


def refusals(body: Any) -> list[str]:
    """Why this row must not be served. Empty means serve it.

    Reasons and not a boolean, for the same reason :func:`why_not_generic` returns reasons: the
    stores desk has to be able to say WHAT was wrong with a row it refused.
    """
    if not isinstance(body, dict):
        return ["the row carries no body"]
    lines = _says_in(body)
    if not lines:
        return ["the row carries no words"]
    from wobo_gateway.board import naming
    from wobo_gateway.plexus.lint import _find_svg_strings
    from wobo_gateway.plexus.sanitize import svg_violations

    out: list[str] = []
    for line in lines:
        # The name slot is ours and it has braces in it, so the machinery check reads the line the
        # way a learner with no name would: the slot out, the sentence intact.
        spoken = stitch_name(line, "")
        if _LONG_DASH.search(spoken):
            out.append("a long dash a learner reads")
        if "!" in spoken:
            out.append("an exclamation mark")
        if _MARKUP.search(spoken):
            out.append("markup in a spoken line")
        if not naming.refuse_machinery(spoken):
            out.append("machinery rather than words")
        if naming.narrates(spoken):
            out.append("the line narrates instead of doing it")
    out += [f"sanitize: {r}" for svg in _find_svg_strings(body) for r in svg_violations(svg)]
    # Dedupe, keeping the order an operator would read them in.
    seen: set[str] = set()
    return [r for r in out if not (r in seen or seen.add(r))]


def save(
    payload: dict[str, Any],
    output: dict[str, Any],
    *,
    plan: dict[str, Any] | None = None,
    model: str | None = None,
    cost_usd: float | None = None,
    judge_score: float | None = None,
    status: str = "provisional",
) -> bool:
    """Write this answer for every learner who asks the same question at the same level.

    Returns whether a row was written, which is what the tests assert on: "a mind item in the
    packet means no store" is exactly ``save(...) is False``.

    The generic check runs AGAIN here rather than trusting the caller's earlier one. It is cheap,
    it is the last frame before a row is written, and a payload is a mutable dict that other code
    has had its hands on since the door.
    """
    key = key_for(payload)
    if not key:
        return False
    say = str(output.get("say") or "").strip()
    if not say:
        return False
    # The name never enters the row (see NAME_SLOT). A name too short to replace safely means the
    # turn is not stored at all rather than stored with a child's name in it.
    learner_name = name_in(payload)
    if learner_name and len(learner_name) < _MIN_NAME and learner_name in say:
        return False

    from wobo_gateway.plexus import db

    if not db.configured():
        return False

    if status not in db.LIVE:
        # A row written straight to a status the live pointer does not serve is a row nobody will
        # ever read, and writing one is how a store fills with rubbish that still costs money to
        # scan. The caller is told no rather than given a receipt.
        logger.info("generic turn: refusing to write a %s row", status)
        return False

    coords = coordinates_of(payload)
    body = body_for(output, plan, learner_name=learner_name)
    why = refusals(body)
    if why:
        # WRITTEN ONCE AND SERVED FOREVER is the whole reason this check is before the write and
        # not after it. The turn the learner in front of us already got is theirs; what is refused
        # is its second life as everybody else's answer.
        logger.info(
            "generic turn: the answer was not stored, it breaks the law",
            extra={"fields": {"reasons": why[:4], "key": key}},
        )
        return False
    row = {
        "key": key,
        "question_norm": question_of(payload)[:MAX_QUESTION],
        "board": coords["board"] or None,
        "grade": coords["grade"] or None,
        "subject": coords["subject"] or None,
        "concept_id": coords["concept_id"] or None,
        "body": body,
        "status": status,
        "judge_score": judge_score,
        "model": model,
        "cost_usd": cost_usd,
        "provenance": {"capability": "wobo.turn", "model": model},
    }
    return db.write(STORE, row) is not None
