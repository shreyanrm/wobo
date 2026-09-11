"""What Wobo says and what Wobo signs are reconciled against what actually landed.

The adversary, wave 42, finding (b) — "WOBO SPEAKS WHAT IT NEVER DREW, AND SIGNS IT VERIFIED":

    The plant cell says "Plant cell, cell wall, cell membrane, nucleus, chloroplast, vacuole" and
    signs board.from_the_ask:labels verified while three of those are never on the glass. The
    timeline says "Chauri Chaura, called off" and signs board.in_bounds:year 1922 verified while
    that event is never drawn. Both at 390 and 1440. The spoken line and the verify ledger are
    built from the PLAN, and nothing checks them against what the client actually laid.

INK-FOUR, correctness at 4: *"Nothing carries ``verified`` unless a check ran and passed. Nothing
is spoken that was not drawn."* Two halves, and this file holds both:

* THE LEDGER. ``done.verified`` is the turn's signature. It listed every check the ledger held,
  passed or FAILED, and every check that was signed for an object the turn then refused. The
  keyless plant cell signed ``board.fact_supported`` — a check that came back False — on every
  single run.
* THE SAY. A sentence naming a mark that is not on the wire is a promise over an empty board.

The gateway can only reconcile against what it PUT ON THE WIRE; what the client then paints is the
client's half (renderer.tsx). So the law here is exactly that: the say and the ledger are built
from the events, never from the plan.
"""

from __future__ import annotations

from typing import Any

import pytest
from wobo_gateway.board import planner, stream
from wobo_gateway.board.planner import Plan
from wobo_gateway.board.verify import Ledger
from wobo_gateway.wobo import mock_board_plan
from wobo_verifier.gate import CheckResult


def _events(plan: Plan) -> list[stream.Event]:
    return stream.build_events(plan)


def _done(plan: Plan) -> dict[str, Any]:
    done = _events(plan)[-1]
    assert done.type == "done"
    return done.data


def _plant_cell() -> Plan:
    return planner.plan_board(
        {
            "say": "",
            "intents": [{"pipeline": "bio_social", "op": "cell", "subject": "plant cell"}],
        },
        context={"turn": {"lastUserInput": "Draw a plant cell with five labels"}},
    )


# --- the ledger ---------------------------------------------------------------------------------


def test_a_check_that_failed_is_never_signed_verified() -> None:
    """The keyless plant cell's own ledger, measured 2026-09-10: two checks ran and one of them
    came back False. ``done.verified`` named both."""
    plan = _plant_cell()
    failed = [c.name for c in plan.ledger.checks if not c.passed]
    assert failed, "the plant cell's fact check is the fixture; it must still be running"
    done = _done(plan)
    for name in failed:
        assert name not in done["verified"], (
            f"{name} came back False and was signed verified: {done['verified']}"
        )


def test_a_failed_check_is_named_in_the_refusals_rather_than_swallowed() -> None:
    """Dropping it from ``verified`` must not make it invisible: a check that ran and failed is
    a fact about this turn, and the harness reads ``refused`` for it."""
    plan = _plant_cell()
    failed = [c.name for c in plan.ledger.checks if not c.passed]
    done = _done(plan)
    for name in failed:
        assert any(name in str(r) for r in done.get("refused") or []), done


def _timeline() -> Plan:
    payload = {
        "context": {"turn": {"lastUserInput": "Draw a timeline of the non-cooperation movement"}},
        "board": {},
    }
    model_plan = mock_board_plan(payload)
    assert model_plan is not None
    return planner.plan_board(model_plan, context=payload["context"], board_context={})


def test_a_check_signed_for_an_object_that_never_reached_the_wire_is_not_signed() -> None:
    """The timeline's ``board.in_bounds:year 1922`` belongs to one number on the board. Take that
    number off the wire — here by breaking the tick it hangs off, which is exactly how a refused
    mark leaves — and the signature goes with it. A check is signed FOR a thing, and the thing is
    not there."""
    plan = _timeline()
    bound = [o for o in plan.objects if o.get("check")]
    assert bound, "the timeline's years are the fixture"
    victim = bound[-1]
    name = str(victim["check"])
    assert name in _done(plan)["verified"]
    victim["anchor"] = {"object": "a-tick-nobody-drew"}
    done = _done(plan)
    assert name not in done["verified"], done["verified"]
    assert any(name in str(r) for r in done["refused"]), done["refused"]
    # every other year is still signed: one missing mark does not unsign the board
    for other in plan.objects:
        if other.get("check") and other is not victim:
            assert str(other["check"]) in done["verified"]


def test_a_check_name_that_failed_anywhere_is_never_signed_for_the_board(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ONE NAME IS THE WHOLE SIGNATURE, SO ONE FAILURE UNSIGNS IT.

    ``done.verified`` is a list of check NAMES, and most names carry no subject: every cell on a
    board runs ``board.fact_supported``, every formula runs ``board.formula_readable``. Two
    intents of the same family on one board is an ordinary ask — "draw a plant cell and an animal
    cell" — and the two run the same check under the same name. Where the fact base covers one
    subject and not the other, one comes back True and the other False, and the turn signed the
    NAME verified off the back of the one that passed while the other's labels went on the glass
    unsupported. A learner reading ``verified: ['board.fact_supported']`` cannot tell which half
    it was signed for, so the honest answer is neither: the name is refused, once, with its
    reason (the adversary, wave 42, finding (b), the residue).

    The fact base is empty keyless, so both cells fail there and the two paths never cross. This
    stands the base up for one subject, which is what LIVE looks like.
    """
    from wobo_gateway.plexus import factcheck

    monkeypatch.setattr(
        factcheck,
        "facts_for",
        lambda concept: (
            ["cell wall cell membrane nucleus chloroplast vacuole cytoplasm mitochondrion"]
            if "plant" in str(concept)
            else []
        ),
    )
    plan = planner.plan_board(
        {
            "say": "A plant cell, and an animal cell beside it.",
            "intents": [
                {"pipeline": "bio_social", "op": "cell", "subject": "plant cell"},
                {"pipeline": "bio_social", "op": "cell", "subject": "animal cell"},
            ],
        },
        context={"turn": {"lastUserInput": "Draw a plant cell and an animal cell"}},
    )
    ran = [(c.name, c.passed) for c in plan.ledger.checks if c.name == "board.fact_supported"]
    assert (("board.fact_supported", True) in ran) and (("board.fact_supported", False) in ran), (
        f"the fixture is one pass and one failure under one name; got {ran}"
    )
    done = _done(plan)
    assert "board.fact_supported" not in done["verified"], (
        f"a check by that name ran and did not pass, and the board signed it: {done['verified']}"
    )
    assert any("board.fact_supported" in str(r) for r in done.get("refused") or []), done


def test_a_check_that_ran_and_passed_everywhere_is_still_signed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other side of the same guard: it must refuse a name, never mute one. Stand the fact
    base up for the one cell on the board and ``board.fact_supported`` is signed, because a check
    by that name ran once and passed."""
    from wobo_gateway.plexus import factcheck

    monkeypatch.setattr(
        factcheck,
        "facts_for",
        lambda _concept: [
            "cell wall cell membrane nucleus chloroplast vacuole cytoplasm mitochondrion"
        ],
    )
    plan = _plant_cell()
    ran = [(c.name, c.passed) for c in plan.ledger.checks if c.name == "board.fact_supported"]
    assert ran == [("board.fact_supported", True)], ran
    done = _done(plan)
    assert "board.fact_supported" in done["verified"], done["verified"]


def test_a_check_no_object_names_is_still_signed() -> None:
    """``board.from_the_ask:labels`` is a check about the ASK, not about one mark. It is signed
    for the board as a whole and stays signed."""
    plan = _plant_cell()
    loose = [
        c.name
        for c in plan.ledger.checks
        if c.passed and c.name not in {str(o.get("check") or "") for o in plan.objects}
    ]
    assert loose, "the plant cell reads its labels out of the ask; that check is the fixture"
    done = _done(plan)
    for name in loose:
        assert name in done["verified"], done["verified"]


# --- the say ------------------------------------------------------------------------------------


def test_a_sentence_naming_a_mark_that_never_reached_the_wire_is_not_spoken() -> None:
    """A plan whose ring was refused kept the sentence that named it: a learner heard "The
    hypotenuse" over a board with no hypotenuse marked on it."""
    plan = Plan(
        say="The triangle. The hypotenuse, the long side.",
        presentation="plane",
        objects=[
            {
                "id": "t1",
                "kind": "polygon",
                "title": "the triangle",
                "anchor": {"board": [400, 400]},
                "t": {"start": 0, "dur": 240},
            },
            {
                "id": "r1",
                "kind": "ring",
                "words": "the hypotenuse",
                "anchor": {"object": "gone"},
                "t": {"start": 300, "dur": 240},
            },
        ],
    )
    said = " ".join(e.data["text"] for e in _events(plan) if e.type == "say")
    assert "triangle" in said.lower()
    assert "hypotenuse" not in said.lower(), said


def test_a_mark_hung_off_something_that_is_not_on_the_wire_is_refused() -> None:
    """The mark itself goes too — an arrow pointing at an id nobody streamed is an arrow pointing
    at empty space, which is what the plant cell's frame showed."""
    plan = Plan(
        say="The triangle.",
        presentation="plane",
        objects=[
            {
                "id": "t1",
                "kind": "polygon",
                "title": "the triangle",
                "anchor": {"board": [400, 400]},
                "t": {"start": 0, "dur": 240},
            },
            {
                "id": "l1",
                "kind": "label",
                "text": "hypotenuse",
                "anchor": {"object": "gone"},
                "t": {"start": 300, "dur": 240},
            },
        ],
    )
    events = _events(plan)
    ids = [str(e.data["object"]["id"]) for e in events if e.type == "ink"]
    assert ids == ["t1"], ids
    assert any("gone" in str(r) for r in events[-1].data.get("refused") or []), events[-1].data


def test_a_turn_whose_every_mark_is_unanchored_says_nothing_it_cannot_show() -> None:
    """Nothing left on the wire, so nothing about it is spoken and the turn is honest about it."""
    plan = Plan(
        say="The hypotenuse, the long side.",
        presentation="plane",
        objects=[
            {
                "id": "r1",
                "kind": "ring",
                "words": "the hypotenuse",
                "anchor": {"object": "gone"},
                "t": {"start": 0, "dur": 240},
            }
        ],
    )
    events = _events(plan)
    assert [e for e in events if e.type == "ink"] == []
    said = " ".join(e.data["text"] for e in events if e.type == "say")
    assert "hypotenuse" not in said.lower(), said


# --- the wire's own order -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("ask", "intent"),
    [
        (
            "Draw a plant cell with five labels",
            {"pipeline": "bio_social", "op": "cell", "subject": "plant cell"},
        ),
        (
            "Draw a timeline of the non-cooperation movement",
            {"pipeline": "bio_social", "op": "timeline", "subject": "non-cooperation movement"},
        ),
    ],
)
def test_a_mark_is_never_beaten_before_the_thing_it_hangs_off(ask: str, intent: dict) -> None:
    """THE BEAT IS THE CLIENT'S CLOCK, NOT THE STREAM'S ``t``.

    ``apps/web-pwa/src/wobo/beat.ts`` holds every ink frame until the VOICE reaches the sentence
    its beat names, and an unbeaten frame falls back to ``planned - 1`` — the last sentence said
    so far, which on a fast wire is the LAST sentence of the turn. So the plant cell's labels
    (beaten to sentence 0) were released at 4 538 ms and the leaders they hang off (unbeaten, and
    therefore sentence 1) at 10 323 ms: the label was drawn five seconds before its own anchor,
    the anchor box resolved to null, and the mark was lost for good (renderer.tsx, finding (a)).

    So every drawn thing carries a beat, and the thing a mark hangs off is beaten no later than
    the mark — same sentence, at or before the same word.
    """
    plan = planner.plan_board(
        {"say": "", "intents": [intent]}, context={"turn": {"lastUserInput": ask}}
    )
    events = [e for e in stream.build_events(plan) if e.type == "ink"]
    beats: dict[str, tuple[int, int]] = {}
    order: list[str] = []
    for event in events:
        obj = event.data["object"]
        beat = (obj.get("meta") or {}).get("beat")
        assert isinstance(beat, dict) and isinstance(beat.get("with"), int), (
            f"{obj['id']} reaches the client with no sentence to keep time with: {beat}"
        )
        word = beat.get("word")
        beats[str(obj["id"])] = (int(beat["with"]), int(word) if isinstance(word, int) else 0)
        order.append(str(obj["id"]))
    for event in events:
        obj = event.data["object"]
        anchor = obj.get("anchor")
        owner = anchor.get("object") if isinstance(anchor, dict) else None
        if not isinstance(owner, str) or owner not in beats:
            continue
        assert beats[owner] <= beats[str(obj["id"])], (
            f"{obj['id']} is beaten to {beats[str(obj['id'])]} and hangs off {owner}, "
            f"beaten to {beats[owner]}"
        )
        assert order.index(owner) < order.index(str(obj["id"]))


@pytest.mark.parametrize(
    ("ask", "intent"),
    [
        (
            "Draw a plant cell with five labels",
            {"pipeline": "bio_social", "op": "cell", "subject": "plant cell"},
        ),
        (
            "Draw a timeline of the non-cooperation movement",
            {"pipeline": "bio_social", "op": "timeline", "subject": "non-cooperation movement"},
        ),
        (
            "Prove Pythagoras theorem with squares on the sides of a right triangle"
            " with legs 3 cm and 4 cm",
            {"pipeline": "math", "op": "right_triangle", "legs": [3, 4], "squares": True},
        ),
    ],
)
def test_a_mark_starts_only_once_the_thing_it_hangs_off_is_finished(ask: str, intent: dict) -> None:
    """A reference points backwards at something FINISHED. Starting a label on the frame its
    leader begins is a label anchored to a box that is still one point wide."""
    plan = planner.plan_board(
        {"say": "", "intents": [intent]}, context={"turn": {"lastUserInput": ask}}
    )
    events = [e for e in stream.build_events(plan) if e.type == "ink"]
    ends = {
        str(e.data["object"]["id"]): e.data["object"]["t"]["start"] + e.data["object"]["t"]["dur"]
        for e in events
    }
    for event in events:
        obj = event.data["object"]
        for field in ("anchor", "to", "from"):
            anchor = obj.get(field)
            owner = anchor.get("object") if isinstance(anchor, dict) else None
            if isinstance(owner, str) and owner in ends:
                assert obj["t"]["start"] >= ends[owner], (
                    f"{obj['id']} starts at {obj['t']['start']} but {owner} is still being "
                    f"drawn until {ends[owner]}"
                )


def test_the_ledger_of_a_ledgerless_plan_is_empty_rather_than_invented() -> None:
    plan = Plan(say="Here.", presentation="plane", objects=[], ledger=Ledger())
    plan.ledger.note(CheckResult(name="x.passed", passed=True, detail="ok"))
    plan.ledger.note(CheckResult(name="x.failed", passed=False, detail="no"))
    done = _done(plan)
    assert done["verified"] == ["x.passed"]


# --- the figures that carry no words ---------------------------------------------------------


@pytest.mark.parametrize(
    ("ask", "wanted"),
    [
        ("graph y = x^2 from -3 to 3", "The curve of y = x², from -3 to 3."),
        ("show me a number line", "The number line."),
    ],
)
def test_a_wordless_figure_names_itself_on_the_keyless_path_too(ask: str, wanted: str) -> None:
    """The adversary, wave 42, finding 8: *"True live, false keyless, and the 59 are judged
    keyless."* ``scaffold.opening`` was written for the live two-phase turn, so live the graph
    said "The curve of y = x², from -3 to 3." and keyless the same turn answered "Read it a piece
    at a time, and say which part looks off." — a line that names nothing it drew. One figure, one
    sentence, whoever is asking."""
    plan = mock_board_plan({"context": {"turn": {"lastUserInput": ask}}, "board": {}})
    assert plan is not None
    assert plan["say"] == wanted, plan["say"]


def test_a_derivation_opens_on_the_line_it_starts_from() -> None:
    """The ask "solve 2x + 3 = 7 step by step" answered with the family's line and nothing about the
    equation on the board in front of the learner."""
    plan = mock_board_plan(
        {"context": {"turn": {"lastUserInput": "solve 2x + 3 = 7 step by step"}}, "board": {}}
    )
    assert plan is not None
    assert plan["say"] == "2x + 3 = 7, line by line.", plan["say"]


def test_the_opening_never_states_a_number_the_learner_did_not_give() -> None:
    """``board_intents`` fills a default domain in when the ask names none. Saying it out loud
    would be Wobo asserting a range nobody asked for — and the spoken-number law would then drop
    the whole sentence, leaving the board silent, which is worse than the line it replaced."""
    from wobo_gateway.board import naming

    intent = {"op": "number_line", "domain": [-5, 5]}
    assert naming.opening(intent, "show me a number line") == "The number line."
    assert naming.opening(intent, "a number line from -5 to 5") == "The number line, -5 to 5."


def test_the_whole_line_of_a_keyless_from_scratch_turn_survives_the_number_law() -> None:
    """The opening only earns its place if it is actually SPOKEN. Every from-scratch keyless turn
    must come through ``spoken.enforce_board`` with its words intact."""
    from wobo_gateway import spoken

    for ask in (
        "graph y = x^2 from -3 to 3",
        "show me a number line",
        "solve 2x + 3 = 7 step by step",
        "solve x^2 + 5x + 6 = 0 with the quadratic formula",
    ):
        payload = {"context": {"turn": {"lastUserInput": ask}}, "board": {}}
        model_plan = mock_board_plan(payload)
        assert model_plan is not None, ask
        plan = planner.plan_board(model_plan, context=payload["context"], board_context={})
        decided = spoken.enforce_board(plan, payload["context"])
        assert decided.unsaid == [], (ask, decided.unsaid)
        assert plan.say, ask


# --- the whole from-scratch class, on one law -------------------------------------------------

#: The eight boards docs/INK-FOUR.md's own table is written about, plus the four wordless figures.
FROM_SCRATCH = [
    "Prove Pythagoras theorem with squares on the sides of a right triangle"
    " with legs 3 cm and 4 cm",
    "Derive the first step of the quadratic formula from ax^2 + bx + c = 0 on the board",
    "Draw the path of a ball thrown at 20 m/s at 45 degrees and label the apex",
    "Draw a ray diagram of a ray through a convex lens of focal length 15 cm"
    " with the object 30 cm away",
    "Draw a plant cell with five labels",
    "Draw a Punnett square for Tt x Tt",
    "Draw a timeline of the non-cooperation movement",
    "Draw a labelled map of India and mark Maharashtra",
    "graph y = x^2 from -3 to 3",
    "show me a number line",
    "balance H2 + O2 -> H2O",
    "draw a series circuit with a 6 volt battery",
    "solve 2x + 3 = 7 step by step",
]


def _board(ask: str) -> tuple[Plan, list[stream.Event]]:
    from wobo_gateway import spoken

    payload = {"context": {"turn": {"lastUserInput": ask}}, "board": {}}
    model_plan = mock_board_plan(payload)
    assert model_plan is not None and model_plan.get("intents"), ask
    plan = planner.plan_board(model_plan, context=payload["context"], board_context={})
    spoken.enforce_board(plan, payload["context"])
    return plan, stream.build_events(plan)


@pytest.mark.parametrize("ask", FROM_SCRATCH)
def test_no_from_scratch_board_signs_a_check_that_did_not_pass(ask: str) -> None:
    plan, events = _board(ask)
    signed = set(events[-1].data["verified"])
    for check in plan.ledger.checks:
        if not check.passed:
            assert check.name not in signed, f"{ask}: {check.name} failed and was signed"


@pytest.mark.parametrize("ask", FROM_SCRATCH)
def test_no_from_scratch_board_signs_a_check_for_a_mark_it_did_not_stream(ask: str) -> None:
    _plan, events = _board(ask)
    signed = set(events[-1].data["verified"])
    streamed = {
        str(e.data["object"]["check"])
        for e in events
        if e.type == "ink" and e.data["object"].get("check")
    }
    ledger_named = set(signed)
    # every check an object on the wire names is signed; the reverse (a signed check with no
    # object) is legal — a check about the ask itself.
    assert streamed <= ledger_named, (ask, sorted(streamed - ledger_named))


@pytest.mark.parametrize("ask", FROM_SCRATCH)
def test_no_from_scratch_board_beats_a_mark_before_the_thing_it_hangs_off(ask: str) -> None:
    _plan, events = _board(ask)
    ink = [e for e in events if e.type == "ink"]
    said = [e for e in events if e.type == "say"]
    if not said:
        return
    place: dict[str, tuple[int, int]] = {}
    for event in ink:
        obj = event.data["object"]
        beat = (obj.get("meta") or {}).get("beat") or obj.get("beat")
        assert isinstance(beat, dict) and isinstance(beat.get("with"), int), (
            f"{ask}: {obj['id']} reaches the client with no sentence to keep time with"
        )
        word = beat.get("word")
        place[str(obj["id"])] = (int(beat["with"]), int(word) if isinstance(word, int) else 0)
    for event in ink:
        obj = event.data["object"]
        for field in ("anchor", "to", "from"):
            anchor = obj.get(field)
            owner = anchor.get("object") if isinstance(anchor, dict) else None
            if isinstance(owner, str) and owner in place:
                assert place[owner] <= place[str(obj["id"])], (
                    f"{ask}: {obj['id']} is beaten to {place[str(obj['id'])]} and hangs off "
                    f"{owner}, beaten to {place[owner]}"
                )


@pytest.mark.parametrize("ask", FROM_SCRATCH)
def test_no_from_scratch_board_draws_a_mark_before_its_anchor_is_finished(ask: str) -> None:
    _plan, events = _board(ask)
    ink = [e for e in events if e.type == "ink"]
    ends = {
        str(e.data["object"]["id"]): e.data["object"]["t"]["start"] + e.data["object"]["t"]["dur"]
        for e in ink
    }
    for event in ink:
        obj = event.data["object"]
        for field in ("anchor", "to", "from"):
            anchor = obj.get(field)
            owner = anchor.get("object") if isinstance(anchor, dict) else None
            if isinstance(owner, str) and owner in ends:
                assert obj["t"]["start"] >= ends[owner], (
                    f"{ask}: {obj['id']} starts at {obj['t']['start']}, {owner} runs to "
                    f"{ends[owner]}"
                )


@pytest.mark.parametrize("ask", FROM_SCRATCH)
def test_every_from_scratch_board_puts_a_stroke_down_inside_the_budget(ask: str) -> None:
    """BOARD.md §10: the first stroke inside one second of the ask. This is the BRAIN's half —
    the beat the first mark is scheduled on — and a turn that misses it here can never make it
    on a real screen."""
    _plan, events = _board(ask)
    first = next((e.t for e in events if e.type == "ink"), None)
    assert first is not None, ask
    assert first <= stream.INK_LEAD_MS, f"{ask}: first stroke scheduled at {first} ms"


@pytest.mark.parametrize("ask", FROM_SCRATCH)
def test_every_from_scratch_board_says_something_that_names_what_it_drew(ask: str) -> None:
    """INK-FOUR experience at 4: *the say names what it draws, every turn*. Four figures carry no
    words of their own — the graph, the number line, the circuit, the balanced equation — and used
    to answer with the family's line instead (finding 8)."""
    from wobo_gateway.board import naming

    _plan, events = _board(ask)
    said = " ".join(e.data["text"] for e in events if e.type == "say")
    assert said.strip(), ask
    objects = [e.data["object"] for e in events if e.type == "ink"]
    assert naming.unnamed(said, objects) == [], (ask, naming.unnamed(said, objects))
