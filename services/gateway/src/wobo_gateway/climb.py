"""THE CLIMB — the group re-chosen after every module, and an ending that is the topic's own.

**The owner, 2026-09-15** (docs/LEARNING-MODEL.md, "The tutor never leaves"): *"Is the content and
teaching plan continuously optimising and personalising to the learner's needs until they master or
understand that topic? It should be motivating, continuous support, understanding and guiding where
they went wrong, and so on."*

The pool and the selection already existed (``plexus/blueprint.py``: the chapter's pool, and
``group_for``, which chooses a group out of it for one learner). What did not exist was anything
that RAN a learner along it. A group chosen once at the start of a topic is a list, and a list is
what this module replaces: here the group is chosen again after EVERY module, out of what just
happened, and the climb ends at the topic's own evidence rather than at a count or a clock.

**The five things this file is answerable for**, each proved by a played learner in
``tests/test_climb_played.py`` rather than by anything written here:

1. **The group changes with the learner, every time.** :func:`next_step` re-runs the chooser on
   every call, against evidence that carries what just happened: right, wrong, how wrong (which
   misconception the answer showed), how slow (against the module's own minutes), and what the
   learner said. A module that beat them twice is barred for good (:func:`Evidence.struggled`), and
   what comes next is never harder than what beat them (:func:`harder_than`).
2. **It stops only when the topic is understood.** :func:`mastered` reads the ideas the topic is
   held by and the misconceptions that must be gone, and nothing else. No module count, no minutes,
   no score. A learner who evidences the idea on their first module is finished on their first
   module; one who does not is given more, out of the pool.
3. **Where they went wrong is said in this concept's words.** Every :class:`Step` carries a ``why``
   that is one of the ARCHITECT'S OWN sentences: the idea, the misconception, the ground, or the
   route out they wrote for a stuck learner. Nothing here composes a line of its own, so "incorrect,
   try again" is not expressible.
4. **A miss costs nothing.** An idea once evidenced stays held, whatever happens afterwards
   (docs/LEVELS.md section 4: nothing is deducted, ever).
5. **The learner is never left.** Every step names the next thing. When the topic's own modules are
   spent the chapter's pool is swept for anything that teaches the idea still open, because a module
   lives at the CHAPTER and may serve several topics. Only when that is spent too does the climb say
   so, and even then it says which idea is still open rather than showing nothing.

**It costs nothing, and that is structural.** There is no model call in this file, no store read and
no network: every function is a pure selection over a pool that already exists, which is what makes
"it does not stop until the topic is yours" affordable (docs/LEARNING-MODEL.md section 4).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Any

from wobo_gateway.plexus import blueprint as architect
from wobo_gateway.plexus.blueprint_spec import Blueprint, BlueprintModule

# =================================================================================================
# What just happened
# =================================================================================================


@dataclass(frozen=True)
class Attempt:
    """One module, answered. The four things the re-choice reads, and nothing that names a person.

    ``showed`` is the misconception the answer itself revealed, classified where the content lives
    (docs/CONTENT-INTERACTION.md section 4: the concept core's own misconceptions). ``said`` is what
    the learner said in their own words, read here only against the chapter's OWN declarations
    (:func:`said_shows`) and never guessed at, because a guessed misconception is exactly the
    generic hint the law forbids.
    """

    module_id: str
    right: bool
    showed: tuple[str, ...] = ()
    seconds: float | None = None
    said: str = ""


@dataclass(frozen=True)
class Evidence:
    """Everything one learner has shown on one chapter, and nothing else.

    Tuples of ids and nothing more: no name, no age, no score. It is :class:`Attempt` folded in one
    at a time by :func:`after`, and it is what :func:`state_of` turns into the chooser's own
    ``LearnerState``.
    """

    #: module ids finished right
    done: tuple[str, ...] = ()
    #: one entry per WRONG attempt, so a module that appears twice is one that beat them twice
    wrong: tuple[str, ...] = ()
    #: idea ids this learner has evidenced
    held_ideas: tuple[str, ...] = ()
    #: misconception ids currently standing
    misconceptions: tuple[str, ...] = ()
    #: assumption ids the placement check found missing
    unmet_assumptions: tuple[str, ...] = ()
    #: module kinds that have landed for this learner, best first
    style: tuple[str, ...] = ()
    #: module ids that ran over their own minutes
    slow: tuple[str, ...] = ()
    #: module ids finished well inside their own minutes
    quick: tuple[str, ...] = ()
    #: the words the learner used, kept so the next module can answer what they actually said
    said: tuple[str, ...] = ()
    last_module: str = ""
    last_right: bool = True

    @property
    def struggled(self) -> tuple[str, ...]:
        """The modules that beat this learner twice. Never chosen again, for anything."""
        return tuple(sorted({mid for mid in self.wrong if self.wrong.count(mid) >= 2}))


@dataclass(frozen=True)
class Step:
    """What the learner meets next, and why, in the pool's own words.

    ``module`` is ``None`` only at the two ends: the topic is held (``mastered``), or the chapter's
    pool has nothing left that this learner has not already been beaten by (``pool_spent``). Both
    still carry a ``why``, because a screen with nothing on it is the dead end rule 5 forbids.
    """

    module: BlueprintModule | None
    why: str
    kind: str


# =================================================================================================
# Reading what just happened
# =================================================================================================

#: Words that carry no meaning on their own, so a learner's sentence is matched on what it says.
_EMPTY_WORD_LIST = """a an the is are was were be been being of on in at to it its that this
    these those and or but for with as by from than then so if not no do does did my your their
    our i you we they what when how why which"""
_EMPTY_WORDS = frozenset(_EMPTY_WORD_LIST.split())
_WORD = re.compile(r"[a-z]+")
#: How much of a word has to agree for two forms of it to count as one ("press", "presses").
_STEM = 5
#: Below this many distinctive words, a match would be a coincidence rather than a restatement.
_MIN_WORDS_TO_MATCH = 2


def _words(line: str) -> list[str]:
    return [w for w in _WORD.findall(line.lower()) if w not in _EMPTY_WORDS]


def _echoes(said: list[str], word: str) -> bool:
    stem = word[:_STEM]
    return any(spoken.startswith(stem) or word.startswith(spoken[:_STEM]) for spoken in said)


def said_shows(bp: Blueprint, said: str) -> tuple[str, ...]:
    """The misconceptions the learner's OWN words restate, read against the chapter's declarations.

    Deliberately conservative: every distinctive word of the misconception has to be in what they
    said. A learner who restates it is heard; a learner who says something else is not misread into
    a misconception nobody showed, which would teach a mistake they never made.
    """
    spoken = _words(said)
    if not spoken:
        return ()
    out: list[str] = []
    for mis in bp.misconceptions:
        wanted = _words(mis.what)
        if len(wanted) < _MIN_WORDS_TO_MATCH:
            continue
        if all(_echoes(spoken, word) for word in wanted):
            out.append(mis.id)
    return tuple(out)


def _add(existing: tuple[str, ...], more: tuple[str, ...] | list[str]) -> tuple[str, ...]:
    out = list(existing)
    for item in more:
        if item not in out:
            out.append(item)
    return tuple(out)


def _front(style: tuple[str, ...], kind: str) -> tuple[str, ...]:
    return (kind, *(k for k in style if k != kind))


def _back(style: tuple[str, ...], kind: str) -> tuple[str, ...]:
    return (*(k for k in style if k != kind), kind)


def after(bp: Blueprint, evidence: Evidence, attempt: Attempt) -> Evidence:
    """Fold one answered module into what this learner has shown.

    What a right answer buys: the ideas that module declares it teaches are now evidenced, and its
    kind moves to the front of this learner's style. A repair answered right takes its misconception
    off the board, which is the half of mastery that is about what must be GONE.

    What a wrong answer costs: nothing at all (docs/LEVELS.md section 4). It records the attempt,
    the misconception the answer or the learner's own words showed, and the kind that did not land.
    """
    module = bp.module_by_id(attempt.module_id)
    held = evidence.held_ideas
    misconceptions = evidence.misconceptions
    done = evidence.done
    wrong = evidence.wrong
    style = evidence.style
    slow = evidence.slow
    quick = evidence.quick

    if attempt.right:
        done = _add(done, [attempt.module_id])
        if module is not None:
            held = _add(held, module.teaches)
            style = _front(style, module.kind)
            if module.role == "repair" and module.repairs:
                misconceptions = tuple(m for m in misconceptions if m != module.repairs)
    else:
        wrong = (*wrong, attempt.module_id)
        # A misconception is read off a WRONG answer and never off a right one: a learner who got it
        # right did not just show us the mistake.
        misconceptions = _add(misconceptions, attempt.showed)
        misconceptions = _add(misconceptions, said_shows(bp, attempt.said))
        if module is not None and wrong.count(attempt.module_id) >= 2:
            style = _back(style, module.kind)

    if module is not None and attempt.seconds is not None:
        sitting = module.minutes * 60.0
        if attempt.seconds > sitting:
            slow = _add(slow, [attempt.module_id])
        elif attempt.seconds <= sitting / 2:
            quick = _add(quick, [attempt.module_id])

    return replace(
        evidence,
        done=done,
        wrong=wrong,
        held_ideas=held,
        misconceptions=misconceptions,
        style=style,
        slow=slow,
        quick=quick,
        said=_add(evidence.said, [attempt.said.strip()] if attempt.said.strip() else []),
        last_module=attempt.module_id,
        last_right=attempt.right,
    )


def pace_of(evidence: Evidence) -> str:
    """How this learner is moving, against the pool's own minutes. Never against a target."""
    if len(evidence.slow) > len(evidence.quick):
        return "slow"
    if len(evidence.quick) > len(evidence.slow):
        return "fast"
    return "steady"


def state_of(evidence: Evidence) -> architect.LearnerState:
    """The evidence in the shape the chooser reads (``plexus/blueprint.LearnerState``)."""
    return architect.LearnerState(
        unmet_assumptions=evidence.unmet_assumptions,
        misconceptions=evidence.misconceptions,
        held_ideas=evidence.held_ideas,
        style=evidence.style,
        done=evidence.done,
        struggled=evidence.struggled,
        pace=pace_of(evidence),
    )


def group_now(bp: Blueprint, topic_id: str, evidence: Evidence) -> list[str]:
    """The group that teaches this topic to this learner AS THINGS STAND. Re-read, never cached."""
    return architect.walk(bp, topic_id, state_of(evidence))


def mastered(bp: Blueprint, topic_id: str, evidence: Evidence) -> bool:
    """Is the topic held? The ideas understood and the misconceptions gone, and nothing else."""
    return architect.mastered(bp, topic_id, state_of(evidence))


# =================================================================================================
# Harder, in the pool's own terms
# =================================================================================================

#: What a module is FOR, from the ground up. A repair is not a harder thing than the way in it
#: repairs: it is a different way in, aimed at the mistake. A stretch is the top of it by design.
_ROLE_WEIGHT: dict[str, int] = {
    "prerequisite": 0,
    "repair": 1,
    "way_in": 2,
    "check": 3,
    "boss": 4,
    "stretch": 4,
    "side_door": 2,
}


def _hardness(module: BlueprintModule) -> tuple[int, int]:
    return (_ROLE_WEIGHT.get(module.role, 2), module.minutes)


def harder_than(module: BlueprintModule, other: BlueprintModule) -> bool:
    """Is this the harder of the two? What it is FOR first, then how long a sitting it asks for."""
    return _hardness(module) > _hardness(other)


# =================================================================================================
# The chooser, run again after every module
# =================================================================================================


def _available(module: BlueprintModule, evidence: Evidence) -> bool:
    if module.role in ("side_door", "boss"):
        return False
    if module.id in evidence.struggled:
        return False
    if module.id in evidence.done:
        # A repair is not finished with while the misconception it undoes is standing again.
        return module.role == "repair" and module.repairs in evidence.misconceptions
    return True


def _just_barred(bp: Blueprint, evidence: Evidence) -> BlueprintModule | None:
    """The module the LAST answer just barred, if the last answer barred one.

    "A learner who gets a module wrong twice gets a different module next, never the same one again,
    and never a harder one." The harder rule is about the next step out of that miss; once they get
    something right the pool is open to them again at its own difficulty.
    """
    if evidence.last_right or not evidence.last_module:
        return None
    if evidence.wrong.count(evidence.last_module) < 2:
        return None
    return bp.module_by_id(evidence.last_module)


def _needed(bp: Blueprint, topic_id: str, evidence: Evidence) -> list[str]:
    held = set(evidence.held_ideas)
    return [i.id for i in bp.ideas if topic_id in i.topics and i.id not in held]


def _idea_words(bp: Blueprint, idea_id: str) -> str:
    for idea in bp.ideas:
        if idea.id == idea_id:
            return idea.what
    return bp.thread


def _why(bp: Blueprint, topic_id: str, module: BlueprintModule, evidence: Evidence) -> str:
    """The reason this module follows, in the ARCHITECT'S own sentence. Never a line of ours."""
    if module.role == "prerequisite":
        wanted = [a for a in module.assumes if a in evidence.unmet_assumptions] or list(
            module.assumes
        )
        for assumption in bp.assumptions:
            if wanted and assumption.id == wanted[0]:
                return assumption.what
    if module.role == "repair" and module.repairs:
        for mis in bp.misconceptions:
            if mis.id == module.repairs:
                return mis.what
    needed = set(_needed(bp, topic_id, evidence))
    carries = [i for i in module.teaches if i in needed] or list(module.teaches)
    return _idea_words(bp, carries[0]) if carries else bp.thread


def _kind(module: BlueprintModule) -> str:
    if module.role == "prerequisite":
        return "ground"
    if module.role in ("repair", "check", "stretch"):
        return module.role
    return "next"


def _allowed(module: BlueprintModule, evidence: Evidence, beaten: BlueprintModule | None) -> bool:
    if not _available(module, evidence):
        return False
    return beaten is None or not harder_than(module, beaten)


def _in_flow(bp: Blueprint, module: BlueprintModule) -> int:
    order = bp.flow.order
    return order.index(module.id) if module.id in order else len(order)


def _way_back(
    bp: Blueprint, topic_id: str, evidence: Evidence, beaten: BlueprintModule
) -> Step | None:
    """Out of a module that beat them twice, and never back into it.

    The architect's own stuck route first, because they wrote, for the modules learners really do
    get stuck on, a DIFFERENT module to show instead and why. Failing that, another way into the
    same idea, of a different kind, because two ways in taught the same way are one way in.
    """
    named = architect.instead_of(bp, beaten.id)
    if named:
        route = bp.module_by_id(named)
        if route is not None and _allowed(route, evidence, beaten):
            for stuck in bp.flow.stuck:
                if stuck.module == beaten.id:
                    return Step(route, stuck.why, "way_back")
    needed = set(_needed(bp, topic_id, evidence))
    others = [
        m
        for m in bp.modules
        if m.role == "way_in"
        and topic_id in m.serves
        and m.kind != beaten.kind
        and needed.intersection(m.teaches)
        and _allowed(m, evidence, beaten)
    ]
    if not others:
        return None
    best = sorted(others, key=lambda m: _in_flow(bp, m))[0]
    return Step(best, _why(bp, topic_id, best, evidence), "way_back")


def _repair_now(
    bp: Blueprint, topic_id: str, evidence: Evidence, beaten: BlueprintModule | None
) -> Step | None:
    """The module that undoes what they just showed. This is "guiding where they went wrong"."""
    for mis in bp.misconceptions:
        if mis.id not in evidence.misconceptions:
            continue
        for module in bp.modules:
            if module.role != "repair" or module.repairs != mis.id:
                continue
            if topic_id not in module.serves and not set(module.teaches) & set(
                _needed(bp, topic_id, evidence)
            ):
                continue
            if _allowed(module, evidence, beaten):
                return Step(module, mis.what, "repair")
    return None


def _across_the_chapter(
    bp: Blueprint, topic_id: str, evidence: Evidence, beaten: BlueprintModule | None
) -> Step | None:
    """The pool is the CHAPTER'S, so a module filed under another topic still counts when it
    teaches the idea this learner is still missing (docs/LEARNING-MODEL.md section 1)."""
    needed = set(_needed(bp, topic_id, evidence))
    if not needed:
        return None
    reachable = [
        m for m in bp.modules if needed.intersection(m.teaches) and _allowed(m, evidence, beaten)
    ]
    if not reachable:
        return None
    best = sorted(reachable, key=lambda m: (_hardness(m), _in_flow(bp, m)))[0]
    return Step(best, _why(bp, topic_id, best, evidence), "next")


def next_step(bp: Blueprint, topic_id: str, evidence: Evidence) -> Step:
    """What this learner meets next on this topic, chosen again out of everything they have shown.

    This is the whole of rule 1 in one function, and it is called after EVERY module rather than
    once at the start. In the order it tries:

        the way back    when the last answer was the second miss on a module, out of it and never
                        into it again, by the architect's own route or by another way in
        the repair      when they have just shown a misconception this chapter declares
        the group       ``group_for``, re-chosen right now, in the flow's own order
        the chapter     anything left in the pool that teaches the idea still open
        the honest end  the topic is held, or the pool is spent and it says which idea is open
    """
    if mastered(bp, topic_id, evidence):
        return Step(None, bp.thread, "mastered")

    beaten = _just_barred(bp, evidence)
    if beaten is not None:
        route = _way_back(bp, topic_id, evidence, beaten)
        if route is not None:
            return route
    if not evidence.last_right:
        repair = _repair_now(bp, topic_id, evidence, beaten)
        if repair is not None:
            return repair

    for module in architect.group_for(bp, topic_id, state_of(evidence)):
        if _allowed(module, evidence, beaten):
            return Step(module, _why(bp, topic_id, module, evidence), _kind(module))

    wider = _across_the_chapter(bp, topic_id, evidence, beaten)
    if wider is not None:
        return wider

    open_ideas = _needed(bp, topic_id, evidence)
    return Step(None, _idea_words(bp, open_ideas[0]) if open_ideas else bp.thread, "pool_spent")


# =================================================================================================
# The door's own shape: what a screen sends, and what it comes back with
# =================================================================================================
#
# For a whole wave everything above this line was true and unreachable: ``climb.py`` was imported
# by its own test and by NOTHING else, so rule 1 held in a library and was false in the product.
# These five functions are the wire, and they live here rather than in the route on purpose — the
# shapes a learner's state travels in belong with the law that reads it, so a screen and the
# chooser can never drift into two ideas of what "what just happened" means.
#
# THE DOOR KEEPS NOTHING. The evidence travels in with the request and goes home with the answer.
# There is no learner state stored anywhere to serve a climb, which is both the privacy answer
# (:class:`Evidence` is ids off the pool: no name, no age, no score) and the reason it stays free.

#: Caps on one request. The evidence a screen hands back is small by nature, so a body far past
#: these is a client fault or an attempt to make a free selection expensive. Trimmed, not refused:
#: a learner is never shown an error because their own history grew.
_MAX_IDS = 200
_MAX_SAID = 40
_MAX_SAID_CHARS = 600
_MAX_ID_CHARS = 120


def _ids(raw: Any, *, limit: int = _MAX_IDS) -> tuple[str, ...]:
    """Ids off the wire. Order and repeats are kept: a module twice in ``wrong`` is a module that
    beat this learner twice, and de-duplicating it here would quietly unbar it."""
    if not isinstance(raw, (list, tuple)):
        return ()
    out = [
        str(value).strip()[:_MAX_ID_CHARS]
        for value in raw
        if isinstance(value, (str, int)) and not isinstance(value, bool) and str(value).strip()
    ]
    return tuple(out[:limit])


def evidence_of(raw: Any) -> Evidence:
    """What this learner has shown, as a screen hands it back. Read defensively, never trusted.

    Anything missing or malformed is simply absent, because the honest answer to "I cannot read
    what you sent" is to teach them from the beginning of the pool rather than to refuse them.
    """
    if not isinstance(raw, dict):
        return Evidence()
    said = tuple(
        line.strip()[:_MAX_SAID_CHARS]
        for line in (raw.get("said") or [])
        if isinstance(line, str) and line.strip()
    )[:_MAX_SAID]
    return Evidence(
        done=_ids(raw.get("done")),
        wrong=_ids(raw.get("wrong")),
        held_ideas=_ids(raw.get("heldIdeas")),
        misconceptions=_ids(raw.get("misconceptions")),
        unmet_assumptions=_ids(raw.get("unmetAssumptions")),
        style=_ids(raw.get("style")),
        slow=_ids(raw.get("slow")),
        quick=_ids(raw.get("quick")),
        said=said,
        last_module=str(raw.get("lastModule") or "").strip()[:_MAX_ID_CHARS],
        # Absent means nothing has gone wrong yet, which is what a fresh climb is.
        last_right=raw.get("lastRight") is not False,
    )


def evidence_payload(evidence: Evidence) -> dict[str, Any]:
    """The evidence in the shape it is handed back in. Ids and their own words, and nothing else:
    there is deliberately no field here that could carry a person."""
    return {
        "done": list(evidence.done),
        "wrong": list(evidence.wrong),
        "heldIdeas": list(evidence.held_ideas),
        "misconceptions": list(evidence.misconceptions),
        "unmetAssumptions": list(evidence.unmet_assumptions),
        "style": list(evidence.style),
        "slow": list(evidence.slow),
        "quick": list(evidence.quick),
        "said": list(evidence.said),
        "lastModule": evidence.last_module,
        "lastRight": evidence.last_right,
    }


def attempt_of(raw: Any) -> Attempt | None:
    """The module just answered, or ``None`` when the learner has not answered anything yet.

    A first call has no attempt and is not a special case anywhere: it is simply a learner who has
    shown nothing, and the chooser starts them where the pool starts.
    """
    if not isinstance(raw, dict):
        return None
    module_id = str(raw.get("module") or raw.get("moduleId") or "").strip()[:_MAX_ID_CHARS]
    if not module_id:
        return None
    seconds = raw.get("seconds")
    said = raw.get("said")
    return Attempt(
        module_id=module_id,
        right=bool(raw.get("right")),
        showed=_ids(raw.get("showed")),
        seconds=(
            float(seconds)
            if isinstance(seconds, (int, float)) and not isinstance(seconds, bool)
            else None
        ),
        said=said.strip()[:_MAX_SAID_CHARS] if isinstance(said, str) else "",
    )


def step_payload(step: Step) -> dict[str, Any]:
    """One step, as a screen reads it: the module they meet, and WHY, in the pool's own words.

    The module is flattened to what a screen actually shows and chooses by; the mechanics and the
    cores stay behind, because a learner sees what they are learning and never the machinery that
    chose it (docs/LEARNING-MODEL.md section 6).
    """
    module = step.module
    return {
        "module": (
            None
            if module is None
            else {
                "id": module.id,
                "aim": module.aim,
                "kind": module.kind,
                "role": module.role,
                "minutes": module.minutes,
            }
        ),
        "why": step.why,
        "kind": step.kind,
    }


def next_payload(bp: Blueprint, topic_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """ONE MODULE ANSWERED, AND THE NEXT ONE CHOSEN. The whole of the door, still a pure selection.

    This is rule 1 made reachable. The attempt is folded into what the learner has shown and the
    group is re-chosen out of the result IN THE SAME CALL, so a screen that asks after every module
    gets the re-choice by construction and cannot accidentally hold a list chosen once at the start.

    The group rides along beside the step because a screen showing "what we are doing about this
    topic" must show it as it stands NOW, not as it stood when the topic opened.
    """
    evidence = evidence_of(payload.get("evidence"))
    attempt = attempt_of(payload.get("answered"))
    if attempt is not None:
        evidence = after(bp, evidence, attempt)
    step = next_step(bp, topic_id, evidence)
    return {
        "step": step_payload(step),
        "group": group_now(bp, topic_id, evidence),
        "mastered": step.kind == "mastered",
        "evidence": evidence_payload(evidence),
    }


__all__ = [
    "Attempt",
    "Evidence",
    "Step",
    "after",
    "attempt_of",
    "evidence_of",
    "evidence_payload",
    "group_now",
    "harder_than",
    "mastered",
    "next_payload",
    "next_step",
    "pace_of",
    "said_shows",
    "state_of",
    "step_payload",
]
