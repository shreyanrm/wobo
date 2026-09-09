"""THE INSTANT MARK ON A DRAWING FROM SCRATCH (docs/INK-FOUR.md, "the one thing we do not have").

Wave 42 gave the client an instant mark for anything the glass map already declares: the target is
a lookup, so the pen starts inside 200 ms while the request is in flight. A drawing built FROM
SCRATCH had no such path — and it is the class that waited longest. Live, the evidence lab
measured the first stroke of "prove Pythagoras with squares on the sides, legs 3 cm and 4 cm" at
13 729 ms, the graph at 15 064 ms. The law says one second.

The waiting was never for the drawing. **The geometry does not come from the model.** A plan says
``open: {kind, intent}`` and the plane's pipelines build it (docs/INK-FREEZE-PLAN-TRACE.md §3,
Plan), and ``wobo.board_intents`` reads the intent straight out of the learner's words —
deterministically, in well under a millisecond, and with better numbers than the model manages
(the 15 cm lens the model drew as f = 10, wave 47's finding 1). The model was gating ink it did
not make.

So the turn is streamed in two phases, on one route, one door, one meter:

1. **The scaffold.** The deterministic reading resolves the intent, the pipeline draws it, and its
   ink is on the wire before the model has finished reading the question. Wobo says what the
   drawing itself names — ``board.naming`` writes that sentence from the marks, not from a model —
   so nothing is drawn in silence.
2. **The words.** The model's plan arrives a second or several later and CONTINUES the turn: its
   teaching sentences, its question, and any mark it makes on the glass. It refines; it does not
   gate. A mark the scaffold already put down is not laid twice unless the model drew it
   differently, in which case the ink moves once, visibly, exactly as INK-FOUR asks. If the model
   never answers at all, the scaffold has still taught, and the question held in reserve here is
   asked in its place.

Nothing in this file calls a model, and nothing in it is new policy: the scaffold is exactly what
the keyless turn would have drawn, so the fast path and the free path can never disagree.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from typing import Any

from wobo_gateway import spoken
from wobo_gateway.board import naming
from wobo_gateway.board import stream as board_stream
from wobo_gateway.board.planner import Plan, plan_board

#: A power a learner reads as a power. Anything taller is left in the notation the ask used.
_POWERS = {"2": "²", "3": "³"}


def _readable(expr: str) -> str:
    """``x**2`` as a learner writes it. Programming notation is not mathematics (finding 7)."""
    out = re.sub(r"\*\*(\d)", lambda m: _POWERS.get(m.group(1), f"^{m.group(1)}"), expr)
    return out.replace("*", "").strip()


def _number(value: Any) -> str:
    """A number as a teacher writes it on a board: 3, not 3.0."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    return str(int(number)) if number.is_integer() else f"{number:g}"


def opening(intent: dict[str, Any]) -> str:
    """The first true sentence about a drawing whose own marks carry no words.

    Step 3 of docs/INK-FOUR.md: *the words come from the core, not from the wire*. Most figures
    name themselves — ``board.naming`` writes "Square on the base, square on the height" out of
    the marks — but a grid, an axis and a curve carry no words at all, so the graph, the number
    line, the circuit and the balanced equation used to be drawn in silence until the model
    spoke. Every number here came out of the learner's own question, which is the only place a
    number Wobo says is allowed to come from.
    """
    op = str(intent.get("op") or "")
    if op == "graph":
        expr = _readable(str(intent.get("expr") or ""))
        if not expr:
            return ""
        domain = intent.get("domain")
        if isinstance(domain, list) and len(domain) == 2:
            return f"The curve of y = {expr}, from {_number(domain[0])} to {_number(domain[1])}."
        return f"The curve of y = {expr}."
    if op == "number_line":
        domain = intent.get("domain")
        if isinstance(domain, list) and len(domain) == 2:
            return f"The number line, {_number(domain[0])} to {_number(domain[1])}."
        return "The number line."
    if op == "circuit":
        arrangement = str(intent.get("arrangement") or "series")
        emf = intent.get("emf")
        return (
            f"A {arrangement} circuit, {_number(emf)} volts."
            if emf
            else f"A {arrangement} circuit."
        )
    if op == "balance":
        left = " + ".join(str(f) for f in (intent.get("reactants") or []) if f)
        right = " + ".join(str(f) for f in (intent.get("products") or []) if f)
        if left and right:
            return f"{left} to {right}, counted on both sides."
        return ""
    return ""


@dataclass
class Scaffold:
    """What was drawn before the model spoke, and everything phase two needs to continue it."""

    plan: Plan
    events: list[board_stream.Event]
    #: How many sentences Wobo has already said. The model's beats are counted across the whole
    #: turn on the client, so its own sentence 0 is really sentence ``said`` — see :func:`resume`.
    said: int
    #: Where the scaffold's clock ends, in ms. Phase two is laid out after it.
    tail: int
    #: The deterministic question, asked only if the model asks none.
    ask: dict[str, Any] | None
    #: What Wobo has already said, so the model's plan cannot say it a second time.
    lines: list[str] = field(default_factory=list)
    #: Every mark on the board, by id, as it was drawn — so phase two can tell a redraw from a
    #: correction.
    drawn: dict[str, dict[str, Any]] = field(default_factory=dict)

    def ids(self) -> list[str]:
        return list(self.drawn)


def _shape_of(obj: dict[str, Any]) -> dict[str, Any]:
    """One mark without its timing: two marks with the same shape are the same mark.

    A BEAT IS TIMING TOO. ``board.naming.keep_time`` stamps ``meta.beat`` on every mark the say
    names, so the scaffold's copy of a figure carries a beat the planner's fresh copy does not,
    and the whole of pythagoras was drawn a second time (wave 46, finding 5). What a mark IS is
    its kind, its anchor, its words and its style; when it is drawn is not part of that.
    """
    out = {k: v for k, v in obj.items() if k != "t"}
    meta = out.get("meta")
    if isinstance(meta, dict) and "beat" in meta:
        rest = {k: v for k, v in meta.items() if k != "beat"}
        if rest:
            out["meta"] = rest
        else:
            out.pop("meta", None)
    return out


def prepare(
    payload: dict[str, Any],
    *,
    context: dict[str, Any],
    board_context: dict[str, Any],
) -> Scaffold | None:
    """The drawing this ask resolves to with no model call, or None when it resolves to none.

    None is the answer for every ask that is not a drawing built from scratch — a question about
    the page, a mark on the glass, a chat turn. Those already have their instant mark on the
    client, and a plane the learner did not ask for is worse than a wait.
    """
    from wobo_gateway.wobo import board_from_scratch_plan

    model_plan = board_from_scratch_plan(payload)
    if model_plan is None:
        return None
    # The words are the drawing's own (``board.naming`` names every unnamed mark from its own
    # words); the keyless line and the keyless question are held back for the model to better.
    held_ask = model_plan.get("ask") if isinstance(model_plan.get("ask"), dict) else None
    scratch = {**model_plan, "say": "", "ask": None}
    try:
        plan = plan_board(scratch, context=context, board_context=board_context)
    except Exception:
        # A pipeline that cannot build this ask is not an error the learner should wait through:
        # the turn simply runs as it always did, on the model.
        return None
    if not plan.objects:
        return None
    # The same law the keyless turn keeps: a number Wobo says that nobody gave and no verifier
    # drew is not said. The scaffold speaks BEFORE the model does, so it is held to it first.
    spoken.enforce_board(plan, context)
    events = board_stream.build_events(plan)
    if not any(e.type == "say" for e in events):
        # NOTHING IS DRAWN IN SILENCE. A grid, an axis and a curve carry no words for
        # ``board.naming`` to say, so this figure gets the sentence its INTENT can make.
        intents = [i for i in (model_plan.get("intents") or []) if isinstance(i, dict)]
        plan.say = naming.in_register(opening(intents[0])) if intents else ""
        if plan.say:
            spoken.enforce_board(plan, context)
            events = board_stream.build_events(plan)
    body = [e for e in events if e.type != "done"]
    lines = [str(e.data.get("text") or "") for e in body if e.type == "say"]
    tail = max([e.t for e in body] + [0])
    drawn = {str(e.data["object"].get("id")): e.data["object"] for e in body if e.type == "ink"}
    return Scaffold(
        plan=plan,
        events=body,
        said=len(lines),
        lines=lines,
        tail=tail,
        ask=held_ask,
        drawn={k: v for k, v in drawn.items() if k},
    )


def _shift_beat(obj: dict[str, Any], by: int) -> dict[str, Any]:
    """A beat is counted across the TURN's sentences on the client, and phase two's sentence 0 is
    the turn's sentence ``by``. Without this every mark the model choreographs would bind to a
    sentence Wobo finished before the model answered, and land at once instead of on its word."""
    meta = obj.get("meta")
    if not isinstance(meta, dict):
        return obj
    beat = meta.get("beat")
    if not isinstance(beat, dict):
        return obj
    moved = dict(beat)
    for key in ("with", "after"):
        if isinstance(moved.get(key), int) and not isinstance(moved.get(key), bool):
            moved[key] = int(moved[key]) + by
    return {**obj, "meta": {**meta, "beat": moved}}


def resume(
    scaffold: Scaffold,
    plan: Plan,
    *,
    actions: list[dict[str, Any]] | None = None,
    card: dict[str, Any] | None = None,
) -> list[board_stream.Event]:
    """Phase two: the model's turn, laid on the wire after the scaffold's.

    Its clock continues the scaffold's, its beats are counted from the sentences Wobo has already
    said, and a mark identical to one already on the board is dropped — the same figure is never
    drawn twice. A mark the model drew DIFFERENTLY keeps its id and goes out again, so the one
    shape on the board changes once, visibly, the way a teacher corrects a stroke.
    """
    if plan.ask is None and scaffold.ask is not None:
        # The model asked nothing (or never answered). The turn still ends on a question.
        plan.ask = scaffold.ask
    # ONE VOICE, ONE TRANSCRIPT. A sentence Wobo has already said is not said again because the
    # model happened to write the same one — the keyless plan IS the fallback the model falls
    # back to, so on a bad day the two halves of a turn would have agreed word for word. A beat
    # that named a dropped sentence moves with it (``spoken.reanchor``), so no mark is orphaned.
    already = {naming.flat(line) for line in scaffold.lines}
    parts = board_stream.sentences(plan.say)
    dropped = tuple(i for i, part in enumerate(parts) if naming.flat(part) in already)
    if dropped:
        spoken.reanchor(plan.objects, dropped, len(parts))
        plan.say = " ".join(part for i, part in enumerate(parts) if i not in set(dropped))
    kept: list[dict[str, Any]] = []
    for obj in plan.objects:
        before = scaffold.drawn.get(str(obj.get("id")))
        if before is not None and _shape_of(before) == _shape_of(obj):
            continue
        kept.append(obj)
    plan.objects = kept
    events = board_stream.build_events(plan, actions=actions, card=card)
    out: list[board_stream.Event] = []
    for event in events:
        data = copy.deepcopy(event.data)
        if event.type == "ink":
            data["object"] = _shift_beat(data["object"], scaffold.said)
        elif event.type == "done":
            # ONE TURN, ONE ACCOUNT OF ITSELF. The `done` frame is what the client, the harness
            # and QA read to know what was drawn and what was checked, and half of both happened
            # in the phase before this one.
            data = _closing(scaffold, plan, data)
        out.append(board_stream.Event(seq=0, type=event.type, t=event.t + scaffold.tail, data=data))
    return out


def _closing(scaffold: Scaffold, plan: Plan, data: dict[str, Any]) -> dict[str, Any]:
    """The `done` frame for a two-phase turn: both phases' marks and both phases' checks."""
    checks = [c.name for c in scaffold.plan.ledger.checks]
    for name in data.get("verified") or []:
        if name not in checks:
            checks.append(str(name))
    refused = [*scaffold.plan.refusals, *(data.get("refused") or [])]
    return {
        **data,
        "objects": len(scaffold.drawn) + len(plan.objects),
        "verified": checks,
        **({"refused": refused} if refused else {}),
    }


def alone(scaffold: Scaffold) -> list[board_stream.Event]:
    """The model never answered. What the scaffold drew stands, with its question, and the turn
    closes honestly rather than hanging on a provider that fell over."""
    plan = Plan(
        say="",
        presentation=scaffold.plan.presentation,
        objects=[],
        ask=scaffold.ask,
        refusals=list(scaffold.plan.refusals),
        ledger=scaffold.plan.ledger,
    )
    return [
        board_stream.Event(
            seq=0,
            type=e.type,
            t=e.t + scaffold.tail,
            data=_closing(scaffold, plan, e.data) if e.type == "done" else e.data,
        )
        for e in board_stream.build_events(plan)
    ]
