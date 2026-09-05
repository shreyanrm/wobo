"""The board planner — a compact plan in, a validated board out.

The model is asked for an INTENT, never for coordinates: "graph y = x**2 with the tangent at
x = 1", not a list of points. The pipelines compute the geometry, the verifier signs the numbers,
and this module is the door between the two: it validates every object against the grammar,
resolves every anchor against the registry snapshot that rode up in the context packet, chooses
the presentation, and refuses a plan that is more than one board.

Four laws are enforced here, and each of them is a way the board dies if it is not (BOARD.md §11):

- **Nothing floats.** An anchor names a registry target, a focus region, another object, or board
  space. A mark whose target is not on the screen the learner is looking at is refused outright —
  a pointer at nothing is worse than silence. A shape whose target vanished is re-anchored to
  board space, which is where a shape drawn from scratch belongs anyway.
- **No number the model wrote.** Every object showing a numeral must name a check, and that check
  must be one that actually ran on this turn (the ledger). A model cannot mint ``check`` any more
  than it can mint the number.
- **One board at a time.** Over :data:`MAX_OBJECTS` objects is refused as ``too_much_at_once``.
- **Ink before the word.** Objects come out in drawing order with cumulative timing, which is what
  lets :mod:`wobo_gateway.board.stream` put the first stroke ahead of the first full stop.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from wobo_verifier.gate import CheckResult

from wobo_gateway.board import schema
from wobo_gateway.board.pipelines import PIPELINES, Draft, run_intent
from wobo_gateway.board.verify import Ledger, Unverified

#: BOARD.md §10: 40 objects typical, 200 maximum.
MAX_OBJECTS = 200
TYPICAL_OBJECTS = 40
MAX_INTENTS = 8

#: Optional embellishments a pipeline can drop to draw the simpler thing when a check fails —
#: the "redraw once" half of BOARD.md §6.
#:
#: ``steps`` is here for the commonest board in Class 10 there is. A factorisation ends
#: "x - 2 = 0 or x - 3 = 0", the CAS cannot read a disjunction, and the whole derivation was
#: refused for it — so Wobo explained the factors over a blank board (the teaching harness,
#: 2026-09-05). Dropping the steps reaches the path ``math._derivation`` already had for a
#: derivation given NO steps: the CAS solves the equation itself and the chain check proves the
#: line it produced. The learner loses the model's middle steps and keeps a proved answer, which
#: is the right way round when the alternative is nothing at all.
_EMBELLISHMENTS = ("tangent_at", "marks", "values", "equilibrium", "parts", "name", "steps")

#: Where a re-anchored shape lands: the middle of the board, stepped down so two of them do not
#: sit on top of each other.
_REANCHOR_ORIGIN = (500.0, 300.0)
_REANCHOR_STEP = 60.0


class TooMuchAtOnce(Exception):
    """A plan bigger than one board. Metered as a refusal, never drawn in pieces."""

    def __init__(self, count: int) -> None:
        self.count = count
        super().__init__(f"{count} objects is more than one board (limit {MAX_OBJECTS})")


@dataclass
class Plan:
    """One turn's board: what Wobo says, what Wobo draws, and what Wobo refused to draw."""

    say: str = ""
    presentation: str = "plane"
    objects: list[dict[str, Any]] = field(default_factory=list)
    refusals: list[str] = field(default_factory=list)
    ledger: Ledger = field(default_factory=Ledger)
    ask: dict[str, Any] | None = None
    resumes_from: str | None = None

    @property
    def checks(self) -> list[CheckResult]:
        return self.ledger.checks

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "presentation": self.presentation,
            "objects": self.objects,
            "verified": [c.name for c in self.ledger.checks],
        }
        if self.refusals:
            out["refused"] = self.refusals
        if self.resumes_from:
            out["resumes_from"] = self.resumes_from
        return out


@dataclass(frozen=True)
class Surface:
    """What the client says is on the screen right now — the half of the packet anchors resolve
    against. Built from ``context.targets`` and the focus object the gesture layer produced."""

    targets: frozenset[str] = frozenset()
    focuses: frozenset[str] = frozenset()
    drawn: frozenset[str] = frozenset()
    lesson: bool = False

    @classmethod
    def from_context(cls, context: dict[str, Any], boardctx: dict[str, Any]) -> Surface:
        # Two lists of the same screen reach us, and an anchor may legitimately name either.
        #
        #   · `context.targets` — the scene bus's list, which every engine has published for a
        #     long time (`context-bus.tsx`);
        #   · `context.packet.screen` — the surface registry's snapshot, which is what the gesture
        #     layer actually resolves a circle against (`packet.ts`, `registry.ts`).
        #
        # The focus is the same story and it matters more: the senses put the region the learner
        # circled at `context.packet.focus`, and reading only `context.focus` meant the brain never
        # saw one — so every mark anchored to "the thing they circled" was refused as "no focus
        # region in this packet", which is the whole video case in BOARD.md §5.
        packet = context.get("packet")
        packet = packet if isinstance(packet, dict) else {}

        raw_targets = list(context.get("targets") or [])
        screen = packet.get("screen")
        if isinstance(screen, dict):
            for surface in screen.get("surfaces") or []:
                if isinstance(surface, dict):
                    raw_targets.extend(
                        t for t in (surface.get("targets") or []) if isinstance(t, dict)
                    )
        targets = {
            str(t.get("id"))
            for t in raw_targets
            if isinstance(t, dict) and str(t.get("id") or "").strip()
        }

        focuses: set[str] = set()
        for focus in (context.get("focus"), packet.get("focus")):
            if isinstance(focus, dict) and focus.get("id"):
                focuses.add(str(focus["id"]))
        for item in context.get("focuses") or []:
            if isinstance(item, dict) and item.get("id"):
                focuses.add(str(item["id"]))
        drawn = {str(o) for o in (boardctx.get("drawn") or []) if str(o).strip()}
        return cls(
            frozenset(targets),
            frozenset(focuses),
            frozenset(drawn),
            is_lesson(context, boardctx),
        )


#: Routes where the board IS the screen (BOARD.md §5). The client publishes the bare route name —
#: `page.route == "course"` — through the context bus (`context-bus.tsx`), and the web app's own
#: `isLessonRoute` reads exactly these words. Matching on "/course" instead meant no route the
#: client actually sends was ever a lesson, so every lesson turn fell through to the plane and the
#: full board never arrived.
LESSON_ROUTES = frozenset({"course", "sandbox", "lesson"})


def is_lesson(context: dict[str, Any], board_context: dict[str, Any]) -> bool:
    """True when this turn is inside a lesson, whichever way the client says so.

    The board context's own flag wins (the conductor sets it from `isLessonRoute`); otherwise the
    route is read, as a bare word first and as a path second, so a deep link like
    ``/course/algebra`` is a lesson too.
    """
    if bool(board_context.get("lesson")):
        return True
    route = str((context.get("page") or {}).get("route") or "").strip().lower()
    if not route:
        return False
    if route in LESSON_ROUTES:
        return True
    head = route.lstrip("/").split("/", 1)[0].split("?", 1)[0]
    return head in LESSON_ROUTES


def _simplify(intent: dict[str, Any]) -> dict[str, Any] | None:
    """The same intent with its optional parts removed, or None when there is nothing to drop."""
    stripped = {k: v for k, v in intent.items() if k not in _EMBELLISHMENTS}
    return stripped if len(stripped) != len(intent) else None


def _flatten_intent(intent: Any) -> dict[str, Any] | None:
    """One intent in the shape the pipelines read, or None when it is not an intent at all.

    The contract is flat — ``{"pipeline": "math", "op": "graph", ...}`` — and that is what the
    prompt now shows. It did not always: for a while the prompt printed only a TABLE of pipelines
    and their ops, so a model reasonably wrote the nesting the table implies,
    ``{"math": {"op": "graph", ...}}``. Every one of those was dropped, and because a dropped
    intent is silent the learner heard "I have drawn the parabola and its tangent" over an empty
    board. The teaching harness found it on the first live board turn it ever ran, 2026-09-05.

    So the nested form is folded into the flat one here. This is not politeness towards a model: an
    empty board under a sentence promising a drawing is the worst thing this product can do, and
    the whole insurance against it costs one dictionary. The floor is unmoved — a key that is not
    one of the four pipelines is still not an intent.
    """
    if not isinstance(intent, dict):
        return None
    if intent.get("pipeline") in PIPELINES:
        return intent
    nested = [k for k in intent if k in PIPELINES]
    if len(nested) == 1 and isinstance(intent[nested[0]], dict):
        return {"pipeline": nested[0], **intent[nested[0]]}
    return None


def _run_intents(intents: list[Any], plan: Plan) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    for index, raw in enumerate(intents[:MAX_INTENTS]):
        intent = _flatten_intent(raw)
        if intent is None:
            plan.refusals.append("an intent that names no pipeline was dropped")
            continue
        simpler = _simplify(intent)

        def build(current: dict[str, Any] = intent, i: int = index) -> Draft:
            return run_intent(current, index=i)

        def fallback(current: dict[str, Any] | None = simpler, i: int = index) -> Draft:
            if current is None:
                raise Unverified("there is no simpler version of this to draw")
            return run_intent(current, index=i)

        from wobo_gateway.board.verify import redraw_once

        try:
            draft = redraw_once(
                build,
                None if simpler is None else fallback,
                what=f"{intent.get('pipeline')}.{intent.get('op')}",
            )
        except Unverified as exc:
            # It never serves: the objects are dropped and the refusal is carried out honestly.
            plan.refusals.append(exc.reason)
            plan.ledger.checks.extend(exc.checks)
            continue
        plan.ledger.checks.extend(draft.ledger.checks)
        objects.extend(draft.objects)
    return objects


def _anchor_ok(anchor: dict[str, Any], surface: Surface, known: set[str]) -> str | None:
    """None when the anchor resolves; otherwise why it does not."""
    if "target" in anchor:
        return (
            None
            if anchor["target"] in surface.targets
            else f"no target {anchor['target']!r} on this screen"
        )
    if "focus" in anchor:
        return (
            None
            if anchor["focus"] in surface.focuses
            else f"no focus region {anchor['focus']!r} in this packet"
        )
    if "object" in anchor:
        return (
            None
            if anchor["object"] in known or anchor["object"] in surface.drawn
            else f"no object {anchor['object']!r} on this board"
        )
    return None  # board space always resolves


def _resolve_anchors(
    objects: list[dict[str, Any]], surface: Surface, plan: Plan
) -> list[dict[str, Any]]:
    known = {str(o.get("id")) for o in objects} | set(surface.drawn)
    kept: list[dict[str, Any]] = []
    reanchored = 0
    for obj in objects:
        kind = str(obj.get("kind"))
        problems: list[str] = []
        for field_name in ("anchor", "to", "from"):
            anchor = obj.get(field_name)
            if not isinstance(anchor, dict):
                continue
            why = _anchor_ok(anchor, surface, known)
            if why is None:
                continue
            if kind in schema.MARK_KINDS:
                # A mark is ABOUT something. If the something is gone, so is the mark.
                problems.append(f"{kind} {obj.get('id')}: {why}")
                continue
            obj[field_name] = {
                "board": [
                    _REANCHOR_ORIGIN[0],
                    min(940.0, _REANCHOR_ORIGIN[1] + reanchored * _REANCHOR_STEP),
                ]
            }
            reanchored += 1
            plan.refusals.append(f"{kind} {obj.get('id')} re-anchored to board space: {why}")
        if problems:
            plan.refusals.extend(problems)
            continue
        kept.append(obj)
    return kept


def _validate(objects: list[dict[str, Any]], plan: Plan, allowed_checks: set[str]) -> list[dict]:
    kept: list[dict[str, Any]] = []
    seen: set[str] = set()
    for obj in objects:
        problems = schema.validate_object(obj)
        if problems:
            plan.refusals.append(f"{obj.get('id', '?')}: {problems[0]}")
            continue
        check = str(obj.get("check") or "")
        if check and check not in allowed_checks:
            plan.refusals.append(
                f"{obj['id']}: names a check ({check}) that did not run on this turn"
            )
            continue
        if obj["id"] in seen:
            plan.refusals.append(f"{obj['id']}: two objects claim this id")
            continue
        seen.add(obj["id"])
        kept.append(obj)
    return kept


def on_the_screen(objects: list[dict[str, Any]], surface: Surface) -> set[str]:
    """The ids of the objects that are ABOUT something on the learner's screen.

    A mark anchored to a registry target or to the region they circled is on the screen by
    definition; a mark hung off one of those (``{"object": "m1"}``) is on the screen with it. A
    mark hung off something on a previous board (``surface.drawn``) belongs to that board. The
    client's ``staysOnScreen`` (presentation.ts) reads the same anchors the same way, so the two
    halves of Wobo never disagree about where a mark lives.
    """
    screen: set[str] = set()
    pending = list(objects)
    # A mark may hang off one declared after it; keep resolving until nothing new settles.
    while pending:
        rest: list[dict[str, Any]] = []
        for obj in pending:
            anchor = obj.get("anchor")
            if not isinstance(anchor, dict):
                rest.append(obj)
                continue
            if "target" in anchor or "focus" in anchor:
                screen.add(str(obj.get("id")))
            elif "object" in anchor and str(anchor["object"]) in screen:
                screen.add(str(obj.get("id")))
            else:
                rest.append(obj)
        if len(rest) == len(pending):
            break
        pending = rest
    return screen


def choose_presentation(
    objects: list[dict[str, Any]], surface: Surface, requested: str | None
) -> str:
    """BOARD.md §5. THE INK DECIDES THE SURFACE, and only the learner's word beats it.

    ``requested`` is the learner's word ("board", "here"), carried in the board context by the
    conductor. It is never the model's: the model used to write ``"presentation": "plane"`` out of
    habit and the planner took it, so every drawn answer opened the board, including a ring round
    a chip that was already on the screen (the owner, 2026-09-05). The model's own field is now a
    hint the planner ignores; what it DREW is what decides.

    - Inside a lesson the board is the screen: ``full``.
    - Nothing drawn: ``screen``. There is nothing to open a board for, and an empty plane sliding
      over the thing the learner was reading is the board at its worst.
    - Every object a mark about something already on the screen (a target, the circled region,
      or a mark hung off one of those): ``screen`` — annotate it in place, however many marks.
      A mark about the page cannot leave the page; on a board it would point at nothing.
    - Anything built from scratch, or hung off a previous board: ``plane``.
    """
    if requested in schema.PRESENTATIONS:
        return str(requested)
    if surface.lesson:
        return "full"
    if not objects:
        return "screen"
    # The anchor decides, never the kind: a written word or a label hung on a chip is on the
    # screen with the chip, exactly as the client's `staysOnScreen` reads it. Requiring a mark
    # kind here sent a ring-plus-label round the hypotenuse to the plane (the harness, 2026-09-05).
    screen = on_the_screen(objects, surface)
    return "screen" if all(str(o.get("id")) in screen for o in objects) else "plane"


def _schedule(objects: list[dict[str, Any]]) -> None:
    """Cumulative drawing time in order. The stream re-bases these against Wobo's sentences; here
    they simply say how long the hand takes and in what order."""
    cursor = 0
    for obj in objects:
        timing = obj.get("t") if isinstance(obj.get("t"), dict) else {}
        duration = int(timing.get("dur") or 240)
        start = timing.get("start")
        # A pipeline that set its own start (chemistry's ticking coefficients) keeps it.
        obj["t"] = {"start": int(start) if start else cursor, "dur": duration}
        cursor = max(cursor, obj["t"]["start"]) + duration


def plan_board(
    model_plan: dict[str, Any],
    *,
    context: dict[str, Any] | None = None,
    board_context: dict[str, Any] | None = None,
) -> Plan:
    """Turn one model plan into a board that may be drawn. Raises :class:`TooMuchAtOnce`."""
    context = context or {}
    board_context = board_context or {}
    surface = Surface.from_context(context, board_context)
    plan = Plan(say=str(model_plan.get("say") or "").strip())

    intents = model_plan.get("intents") or []
    raw_objects = model_plan.get("objects") or []
    if not isinstance(intents, list):
        intents = []
    if not isinstance(raw_objects, list):
        raw_objects = []
    if len(intents) + len(raw_objects) > MAX_OBJECTS:
        raise TooMuchAtOnce(len(intents) + len(raw_objects))

    computed = _run_intents(intents, plan)
    # The model's own marks come after the computed geometry: Wobo points at the thing Wobo drew.
    objects = [*computed, *[o for o in raw_objects if isinstance(o, dict)]]
    if len(objects) > MAX_OBJECTS:
        raise TooMuchAtOnce(len(objects))

    # The ledger and nothing but the ledger. `board.frame` used to be granted here on every turn
    # whether or not anything ran, which made it a universal laundering token: a model could write
    # `{"kind": "label", "text": "g = 42.7 m/s2", "check": "board.frame"}` and it reached the board
    # with zero checks behind it. A check is allowed because it RAN, never because it is spelled a
    # particular way.
    allowed = {c.name for c in plan.ledger.checks}
    objects = _validate(objects, plan, allowed)
    objects = _resolve_anchors(objects, surface, plan)
    _schedule(objects)

    plan.objects = objects
    # The learner's word only. `model_plan["presentation"]` is deliberately not read here: see
    # `choose_presentation` for why the model does not get to open the board.
    plan.presentation = choose_presentation(objects, surface, board_context.get("presentation"))
    interrupted = board_context.get("interrupted_at")
    if isinstance(interrupted, str) and interrupted.strip():
        plan.resumes_from = interrupted.strip()

    ask = model_plan.get("ask")
    if isinstance(ask, dict) and str(ask.get("prompt") or "").strip():
        targets = [str(t) for t in (ask.get("targets") or []) if isinstance(t, str)]
        plan.ask = {
            "prompt": str(ask["prompt"]).strip()[:240],
            "targets": [
                t for t in targets if t in {o["id"] for o in objects} or t in surface.targets
            ],
        }
    return plan
