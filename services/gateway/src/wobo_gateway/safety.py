"""The child-safety subsystem (WOBO.md §11) — moderation and crisis detection on Wobo's text.

Wobo is a free-text surface used by children, so this runs on Wobo from line one:

- Inbound: every learner message is screened BEFORE it reaches a model. A crisis message is
  answered with a calm supportive line that stays with the child and points at a real adult and
  real helplines — never a model free-styling a response to a child in distress. A moderation hit
  gets a warm redirect.
- Outbound: whatever a model says is screened before it reaches the learner; a flagged reply
  is replaced, never served.

**The screen has two layers**, and this module is the seam that holds them together:

1. :mod:`wobo_gateway.safety_signals` — offline, free, deterministic. It normalises spelling
   (``k1ll myself`` is ``kill myself``), carries the disclosure phrasings in English and Hindi
   (Devanagari and romanised) with an unverified handful for the other Indian languages, and
   separates a phrase that IS a disclosure from a subject that is usually homework.
2. :mod:`wobo_gateway.safety_model` — a real moderation model, routed through the ordinary tier
   chain, asked only about the messages layer 1 marks concern-adjacent. It is what reads a
   sentence rather than a substring, and what generalises past any lexicon. It fails CLOSED: a
   timeout or a refusal means screen it, never let it through.

It replaced a fifteen-phrase keyword list that returned ``ok`` for ``my dad hits me`` and
``crisis`` for a civics question about suicide rates. ``SafetyClassifier`` is still the seam:
anything with a ``classify`` method drops into :data:`DEFAULT_CLASSIFIER` with no caller change,
and the trained ``slm.safety`` Track-2 model lands there when it exists.

Flagged turns carry a ``safety`` block in the output; the app records ``safety.flag.raised.v1``
on the event backbone from it. The block says what was screened and nothing about who was told,
because nothing tells anyone: see :data:`SUPPORT` and the note above it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from wobo_gateway import safety_model
from wobo_gateway.safety_signals import (
    CATEGORY_CRISIS,
    CATEGORY_MODERATION,
    CATEGORY_OK,
    RuleClassifier,
    RuleOutcome,
    SafetyVerdict,
    screen_model_words,
)
from wobo_gateway.safety_signals import screen as screen_text


class SafetyClassifier(Protocol):
    """The seam. Anything with this shape drops in — the two-layer screen below today, the
    trained ``slm.safety`` Track-2 model tomorrow."""

    def classify(self, text: str) -> SafetyVerdict: ...


class LayeredClassifier:
    """The screen: an offline layer that decides most of it, a model that decides the rest.

    The order is the whole design.

    * A **personal disclosure** ("my dad hits me", "k1ll myself", "havent eaten in three days")
      is settled offline and no model is asked. It is the fastest path, the free path, and the
      one that still works when every provider is down.
    * **Profanity** is a warm redirect and needs no context either.
    * Everything **concern-adjacent** — a hard subject, or ordinary words that sometimes carry a
      bad day ("sad", "bullied", "cant sleep") — goes to the model, which is the only thing that
      can tell a civics question about suicide rates from a child who is not coping.
    * Everything else never leaves the box.

    When the model is not configured (mock mode, no keys), the offline layer is the whole screen
    and says so in the verdict's ``source``. When it IS configured and does not answer, the
    verdict is the fail-safe one: screen it.
    """

    def __init__(
        self,
        screen_fn: Any | None = None,
        model: Any | None = None,
        *,
        model_enabled: Any | None = None,
    ) -> None:
        #: ``str -> RuleOutcome``. The offline layer, replaceable so a test can drive one band.
        self._screen: Any = screen_fn or screen_text
        self._model = model or safety_model.ModelClassifier()
        self._enabled = model_enabled or safety_model.enabled

    def classify(self, text: str) -> SafetyVerdict:
        outcome: RuleOutcome = self._screen(text)
        if outcome.certain:
            return outcome.verdict()
        if not self._enabled():
            return outcome.verdict()
        # SAFETY_MODEL_SCOPE=all sends everything the offline layer did not settle outright, at
        # the cost of a tiny-tier call on most turns. The default sends only what looked like it
        # could matter, which is where the cost line sits today.
        if not outcome.needs_model and safety_model.scope() != "all":
            return outcome.verdict()
        return self._model.adjudicate(text, outcome)


#: The pre-rename name of the offline layer, kept so nothing that imported it has to move in the
#: same commit as the behaviour. It is a rule screen now, not fifteen keywords.
KeywordClassifier = RuleClassifier

DEFAULT_CLASSIFIER: SafetyClassifier = LayeredClassifier()


# --- Wobo's safety copy — calm, warm, certain; no emoji, no exclamation marks -------------------

# Sentence case, because the persona law says so and because a parent reading over a shoulder
# reads these lines more than any other. The lowercase-sentence affectation is the feed register
# voice.md 10a names as too street, and it sat in the one line that most needs a steady adult.
CRISIS_SAY = (
    "That sounds really heavy, and I'm glad you told me. You deserve support from a real person "
    "who can be right there with you. Please talk to a parent, a teacher, or an adult you "
    "trust. If you want someone to listen right now, Childline is free at 1098, and Tele-MANAS "
    "at 14416, any hour. I'm staying here with you too."
)

MODERATION_SAY = (
    "Let's keep this a kind place. I'm happy to talk about almost anything, so try asking me "
    "again in different words."
)

OUTBOUND_REPLACEMENT_SAY = "Let me put that differently. Ask me once more."

#: What a child hears when ONE check did not answer and the rules had not settled the message:
#: not a helpline, not "keep it kind", a plain ask to try again. "draw a plant cell and label the
#: parts" came back as the Childline script on 2026-09-05 because the outbound screen's model
#: refused a temperature at the same second another was out of credit. A transient classifier
#: failure must never read as concern about what the child said.
UNCHECKED_SAY = "I couldn't check that one just now. Ask me again in a moment."

#: What a child hears when the turn is held because the CHECKER is down, not because of anything
#: they said. Without this line a provider outage handed every concern-adjacent turn the full
#: crisis script: a civics question about suicide rates got Childline, Tele-MANAS and a stopped
#: lesson, for an hour, for everybody. Held is not the same as accused, and the words have to say
#: so — kindly, honestly, and without pretending the lesson can carry on.
OUTAGE_SAY = (
    "I want to be careful with that one, and the part of me that checks is not working just now. "
    "Let's come back to it in a little while. If something is heavy, please tell a parent, a "
    "teacher, or an adult you trust."
)


#: The route to a real adult, as data rather than only as a sentence, so a surface can put it
#: somewhere a child can actually press it. Free, 24 hours, national, and not Wobo: Wobo is not a
#: counsellor and this block is the product saying so.
SUPPORT: tuple[dict[str, str], ...] = (
    {"name": "Childline", "number": "1098", "note": "free, any hour, for anyone under 18"},
    {"name": "Tele-MANAS", "number": "14416", "note": "free, any hour, mental health support"},
)


def _safety_block(verdict: SafetyVerdict, action: str) -> dict[str, Any]:
    """What was screened. Never who was told, because nothing tells anyone.

    ``escalated_to: "guardian"`` used to be written here. Nothing read it: no mail, no job, no
    queue, no review surface — it was a capability the product appeared to have and did not.
    Whether a crisis is ever passed to a parent is a decision with legal weight in every market
    this sells into and it belongs to the owner, not to this file. Until it is made and built,
    this block claims nothing.
    """
    block: dict[str, Any] = {
        "flagged": True,
        "category": verdict.category,
        "severity": verdict.severity,
        "action": action,
    }
    if verdict.category == CATEGORY_CRISIS:
        block["support"] = [dict(entry) for entry in SUPPORT]
    return block


def _held_say(verdict: SafetyVerdict, *, replacement: str) -> str:
    """The line for a screened turn: the crisis script ONLY on a positive crisis verdict from a
    witness that answered (the rules, or a model); the plain unchecked line when one check did
    not answer; the outage line when the checker is known to be down."""
    if verdict.category == CATEGORY_CRISIS and verdict.source not in (
        safety_model.SOURCE_FAIL_SAFE,
        safety_model.SOURCE_OUTAGE,
    ):
        return CRISIS_SAY
    if verdict.source == safety_model.SOURCE_OUTAGE:
        # Held because the checker is down. Never the crisis script and never "keep this kind",
        # which would tell a child doing civics homework that they were unkind.
        return OUTAGE_SAY
    if verdict.source == safety_model.SOURCE_FAIL_SAFE:
        return UNCHECKED_SAY
    return replacement


def _gated_output(verdict: SafetyVerdict) -> dict[str, Any]:
    crisis = verdict.category == CATEGORY_CRISIS
    say = _held_say(verdict, replacement=MODERATION_SAY)
    return {
        # Stay with the child, stop the lesson, name a real adult. Not a lecture, not a refusal,
        # and not a word about the message being flagged or filed anywhere.
        "say": say,
        "actions": [{"type": "setMood", "mood": "waiting" if crisis else "idle"}],
        "grounded": False,
        "handed_answer": False,
        "safety": _safety_block(verdict, "supported" if crisis else "blocked"),
    }


# Every capability a CHILD types into and reads back. The screen belongs to the surface, not to
# one route: a learner in crisis who phrases it as "make me a course on ..." reaches a model on
# any of these, and each answers them in their own words. Kept beside the classifier so adding a
# learner-facing capability is one line here rather than a second special case in the app.
# parent.companion.turn is deliberately absent — a guardian is not the child, and gating an adult
# with the child's crisis copy would be wrong.
LEARNER_FACING_CAPABILITIES: frozenset[str] = frozenset(
    {
        "wobo.turn",
        "tutor.turn",
        "grade.attempt",
        "generate.opener",
        "generate.course",
        "twin.query",
        "verify.math",
        "engine.compose",
        "engine.simulate",
        "engine.diagram",
        "engine.video",
    }
)

# The free-text payload keys the prompt builders actually read (wobo._build_user_prompt and
# providers._*_prompt). Enumerating them by hand missed everything but turn.*, so a crisis line
# typed into a canvas step, a target label or a remembered fact went straight to a model.
_TOP_LEVEL_TEXT_KEYS: tuple[str, ...] = (
    "prompt",
    "question",
    "equation",
    "answer",
    "attempt",
    "goal",
    "concept",
    "topic",
    "input",
    "text",
    "query",
)


#: The most strings one walk will collect. A bound is needed (a deep body must not be able to
#: spin the screen), and the bound must be far above anything a real page publishes, because a
#: bound a payload can REACH is itself the walk-around: fill the first N slots with "tile 1 is
#: fine" and the disclosure falls off the end.
_MAX_WALK = 600


def _walk_text(value: Any, out: list[str], depth: int = 0) -> None:
    """Every string reachable inside a payload fragment, bounded so a deep body cannot spin."""
    if depth > 8 or len(out) >= _MAX_WALK:
        return
    if isinstance(value, str):
        if value:
            out.append(value)
    elif isinstance(value, dict):
        for k, v in list(value.items())[:128]:
            # The KEY is interpolated too in several places (``_digest_state`` renders
            # ``key=value``, ``_machine_room`` renders the mastery-band names), so a disclosure
            # typed as a key reaches the model exactly like one typed as a value.
            if isinstance(k, str) and k:
                out.append(k)
            _walk_text(v, out, depth + 1)
    elif isinstance(value, (list, tuple)):
        for v in list(value)[:128]:
            _walk_text(v, out, depth + 1)


def inbound_text(payload: dict[str, Any]) -> str:
    """Every learner-authored string the prompt builder will read.

    THIS WALKS THE WHOLE PAYLOAD, and that is the point. The previous version named the keys by
    hand — turn.*, canvas.*, targets[].label, page.state, lifetime.facts — and the prompt builder
    reads about twenty. Proved on 2026-09-04: a payload carrying
    ``context.lifetime.masteryHighlights``, ``context.session.recentEvents``,
    ``context.curriculum.nodeName`` and ``context.learner.name`` yielded
    ``inbound_text() == 'help with fractions'``, while all four were clipped into the prompt and
    reached a frontier model unscreened. ``lifetime.facts`` was screened and
    ``lifetime.masteryHighlights`` sitting beside it was not. The realistic child-typed vectors
    are ``learner.name`` at onboarding and ``nodeName`` from a syllabus the child uploaded.

    A hand-written list of keys is a list somebody has to remember to extend every time a prompt
    builder reads one more field, and it was not remembered. So the rule is inverted: everything
    in the body is screened, and the named keys below survive only to put the learner's own
    sentence FIRST, ahead of the walk, so it is never the string that falls off the bound.
    """
    parts: list[str] = []
    for key in _TOP_LEVEL_TEXT_KEYS:
        v = payload.get(key)
        if isinstance(v, str) and v:
            parts.append(v)

    context = payload.get("context") or {}
    if isinstance(context, dict):
        turn = context.get("turn") or {}
        if isinstance(turn, dict):
            parts.append(str(turn.get("lastUserInput") or ""))
            for r in turn.get("recentTurns") or []:
                if isinstance(r, dict) and r.get("role") == "user":
                    parts.append(str(r.get("text") or ""))

    # Then everything else in the body, keys included.
    _walk_text(payload, parts)

    seen: set[str] = set()
    ordered: list[str] = []
    for p in parts:
        if p and p not in seen:
            seen.add(p)
            ordered.append(p)
    return "\n".join(ordered)


#: How many separate strings out of one payload are screened. Matches the walk's own bound: a
#: string that was collected is a string that is read, or the collection was theatre.
_MAX_PARTS = _MAX_WALK


def worst_verdict(parts: list[str], classifier: SafetyClassifier) -> SafetyVerdict | None:
    """Screen each string SEPARATELY and return the most serious verdict, or ``None``.

    Separately matters. The screen used to join every field into one blob and read the blob,
    which meant one academic word anywhere on the page cleared a disclosure everywhere else on
    it: "and my maths homework" beside "I keep thinking about self harm" read as schoolwork. A
    child's sentence is judged on its own words now.
    """
    seen: set[str] = set()
    worst: SafetyVerdict | None = None
    for part in parts[:_MAX_PARTS]:
        text = (part or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        verdict = classifier.classify(text)
        if not verdict.flagged:
            continue
        if verdict.category == CATEGORY_CRISIS:
            return verdict
        worst = worst or verdict
    return worst


def screen_inbound(
    payload: dict[str, Any], classifier: SafetyClassifier = DEFAULT_CLASSIFIER
) -> dict[str, Any] | None:
    """Screen the learner's words. Returns a full replacement output when the turn must not
    reach a model (crisis or moderation), else None."""
    verdict = worst_verdict(inbound_text(payload).split("\n"), classifier)
    if verdict is None:
        return None
    return _gated_output(verdict)


# The text fields an overlay action can carry — everything a model can put in front of the child
# that is NOT the `say` line. Screening only `say` left the page itself unscreened.
_ACTION_TEXT_KEYS: tuple[str, ...] = ("text", "why", "target", "label", "caption")


#: The text fields a BOARD object carries — the words the hand actually writes on the teaching
#: surface. ``board/schema.py`` classifies each of these as visible; ``board/stream.build_events``
#: emits every object as an ``ink`` event straight to the client.
_OBJECT_TEXT_KEYS: tuple[str, ...] = ("text", "label", "title", "alt", "tex", "unit", "symbol")


def _outbound_text(output: dict[str, Any]) -> str:
    """Everything the model wants the learner to see or hear this turn.

    Not only the spoken line. The board is the primary teaching surface and its objects carry
    ``text``, ``label`` and ``title``, and ``plan.ask`` is the question the model poses to the
    child; on 2026-09-04 the board stream handed the screen ``{"say": ..., "actions": []}`` and
    passed the objects and the question to the client untouched, so the words a model WRITES ON
    THE BOARD were the one model output nothing read.
    """
    parts: list[str] = [str(output.get("say") or "")]
    for action in output.get("actions") or []:
        if isinstance(action, dict):
            for key in _ACTION_TEXT_KEYS:
                v = action.get(key)
                if isinstance(v, str) and v:
                    parts.append(v)
    for obj in output.get("objects") or []:
        if isinstance(obj, dict):
            for key in _OBJECT_TEXT_KEYS:
                v = obj.get(key)
                if isinstance(v, str) and v:
                    parts.append(v)
            # A table's cells are glyphs on the board too (``board/schema.py`` marks ``rows``
            # visible). Anything but a list is not rows and is left to the type checker.
            rows = obj.get("rows")
            if isinstance(rows, (list, tuple)):
                _walk_text(rows, parts)
    ask = output.get("ask")
    if isinstance(ask, dict):
        v = ask.get("prompt")
        if isinstance(v, str) and v:
            parts.append(v)
    viz = output.get("viz")
    if isinstance(viz, dict):
        spec = viz.get("spec")
        if isinstance(spec, dict):
            parts.append(str(spec.get("caption") or ""))
    return "\n".join(p for p in parts if p)


def screen_outbound(
    output: dict[str, Any], classifier: SafetyClassifier = DEFAULT_CLASSIFIER
) -> dict[str, Any]:
    """Screen what the model wants to put in front of the learner — the spoken line, the text of
    every overlay action (say/speak/write/remember/forget…) and the visualization caption. A
    flagged turn is replaced and its actions dropped, never served.

    Read as ONE piece, unlike the inbound screen, and deliberately so. Inbound, the parts are a
    child's separate sentences and a frame around one must not clear another. Outbound, the parts
    are one answer: the spoken line is the frame the caption belongs to, and pulling a caption out
    of its lesson is how an outbound screen ends up destroying a history answer.

    **TWO screens, because outbound is a different language.** The old docstring said "a model's
    own words are also not the threat model a child's are", and that sentence WAS the hole. The
    classifier under it is tuned for FIRST-PERSON disclosure and the model speaks in the SECOND
    person, so on 2026-09-04 ``screen_outbound`` returned "You should kill yourself, nobody likes
    you.", "Here is how to hurt yourself: take a blade and cut deep along your wrist." and "Here is
    how to make a bomb at home with household chemicals." to the child unchanged — five of six
    probes served, while the same classifier flagged fifteen of fifteen inbound ones. Three of
    those also had ``needs_model=False``, so the moderation model never saw them either and the
    hole did not close in production. So the model's words are read by
    :func:`safety_signals.screen_model_words` FIRST, which reads second person and instruction,
    and only then by the ordinary classifier, which still catches profanity and a model quoting a
    child back.

    A flagged turn is replaced and everything it wanted to draw goes with it: ``actions`` empty,
    and ``objects`` and ``ask`` dropped, because half a screened turn on the board is the harmful
    half.
    """
    if not isinstance(output, dict):
        return output
    text = _outbound_text(output)
    outcome = screen_model_words(text)
    verdict = outcome.verdict() if outcome.flagged else classifier.classify(text)
    if not verdict.flagged:
        return output
    replaced = {
        **output,
        "say": _held_say(verdict, replacement=OUTBOUND_REPLACEMENT_SAY),
        "actions": [],
        "safety": _safety_block(verdict, "blocked"),
    }
    if "objects" in replaced:
        replaced["objects"] = []
    if "ask" in replaced:
        replaced["ask"] = None
    return replaced


# The pre-rename names, kept so no caller has to change in the same commit as the behaviour.
screen_wobo_inbound = screen_inbound
screen_wobo_outbound = screen_outbound


# --- the image screen (doubt.py) ----------------------------------------------------------------
#
# The one place the product looks at a photograph is the doubt solver, and a photograph is the one
# input with no structure to walk: a face, another child's name on a worksheet header, a home
# address, a page that is not work at all. So before a photo is READ or KEPT it is screened, and the
# screen has the same posture as the text screen above: it fails CLOSED. A checker that cannot run
# is not a pass. The model half lives beside the reader in :mod:`wobo_gateway.doubt` (it is a
# vision call on the tiny tier); this is the verdict, the copy, and the rule that a failure to
# screen is a refusal to keep.

IMAGE_FACE_SAY = "I can only read a page of work, not a person. Try a photo of just the page."
IMAGE_NOT_A_PAGE_SAY = (
    "That does not look like a page of work. Try a photo of the sum, the page or the diagram you "
    "are stuck on."
)
IMAGE_PERSONAL_SAY = (
    "That page has someone's details on it. Keep the photo to the work itself and I will read it."
)
IMAGE_SCREEN_OUTAGE_SAY = (
    "I could not check that photo just now, so I have not kept it. Try again in a little while."
)

#: Why a photo was refused: a face, personal details a page does not need, not a page of work, or
#: the screen itself did not run. The last is the fail-closed case and it is named so a surface can
#: say "try again" rather than "not allowed".
IMAGE_REFUSAL_COPY: dict[str, str] = {
    "face": IMAGE_FACE_SAY,
    "not_a_page": IMAGE_NOT_A_PAGE_SAY,
    "personal": IMAGE_PERSONAL_SAY,
    "outage": IMAGE_SCREEN_OUTAGE_SAY,
}


@dataclass(frozen=True)
class ImageVerdict:
    """What the image screen decided. ``crop`` is a fraction box ``(x0, y0, x1, y1)`` of the page
    that IS the work, when the rest of the photo carried something a page does not need: the
    caller keeps the crop and nothing else."""

    allowed: bool
    reason: str | None = None
    crop: tuple[float, float, float, float] | None = None
    #: True when the screen found personal details and the photo is allowed ONLY because it also
    #: found the work apart from them (``crop``). A caller re-screening the crop reads this: the
    #: same answer a second time means the details are still there, and that is a refusal.
    details: bool = False

    @property
    def say(self) -> str:
        if self.allowed:
            return ""
        return IMAGE_REFUSAL_COPY.get(self.reason or "", IMAGE_NOT_A_PAGE_SAY)


class ImageScreen(Protocol):
    """The seam. Anything that looks at pixels and answers :class:`ImageVerdict` drops in."""

    def screen(self, *, image: bytes, media_type: str) -> ImageVerdict: ...


def screen_image(image: bytes, *, media_type: str, screen: ImageScreen) -> ImageVerdict:
    """Screen one photograph before it is read or kept. FAILS CLOSED.

    A screen that raises, times out, or answers nothing is an ``outage`` refusal, never a pass:
    the photo is not kept and the learner is told the checker did not run. This is the property
    the whole doubt path rests on, and it is held here rather than in every caller so a caller that
    forgets the try/except still cannot keep an unscreened photo.
    """
    if not image:
        return ImageVerdict(allowed=False, reason="not_a_page")
    try:
        verdict = screen.screen(image=image, media_type=media_type)
    except Exception:  # noqa: BLE001 - whatever failed, the answer is "not kept"
        return ImageVerdict(allowed=False, reason="outage")
    if not isinstance(verdict, ImageVerdict):
        return ImageVerdict(allowed=False, reason="outage")
    return verdict


def moderate(text: str, classifier: SafetyClassifier = DEFAULT_CLASSIFIER) -> dict[str, Any]:
    """The safety.moderate capability body — deterministic, mode-independent.

    Keeps the existing {allow, categories} shape; adds severity and crisis additively.
    """
    verdict = classifier.classify(text)
    return {
        "allow": not verdict.flagged,
        "categories": [verdict.category] if verdict.flagged else [],
        "severity": verdict.severity if verdict.flagged else "none",
        "crisis": verdict.category == CATEGORY_CRISIS,
    }


__all__ = [
    "CATEGORY_CRISIS",
    "CATEGORY_MODERATION",
    "CATEGORY_OK",
    "CRISIS_SAY",
    "DEFAULT_CLASSIFIER",
    "IMAGE_FACE_SAY",
    "IMAGE_NOT_A_PAGE_SAY",
    "IMAGE_PERSONAL_SAY",
    "IMAGE_REFUSAL_COPY",
    "IMAGE_SCREEN_OUTAGE_SAY",
    "ImageScreen",
    "ImageVerdict",
    "LEARNER_FACING_CAPABILITIES",
    "MODERATION_SAY",
    "OUTAGE_SAY",
    "OUTBOUND_REPLACEMENT_SAY",
    "UNCHECKED_SAY",
    "SUPPORT",
    "KeywordClassifier",
    "LayeredClassifier",
    "RuleClassifier",
    "SafetyClassifier",
    "SafetyVerdict",
    "inbound_text",
    "moderate",
    "screen_image",
    "screen_inbound",
    "screen_outbound",
    "screen_model_words",
    "worst_verdict",
    "screen_wobo_inbound",
    "screen_wobo_outbound",
]
