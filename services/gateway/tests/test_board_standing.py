"""NOTHING STANDS ON THE GLASS UNSPOKEN — the other half of "nothing spoken that was not drawn".

The adversary, wave 42, on the half that was still open:

    Live at 1440, 'circle the hypotenuse' rings the square on the hypotenuse at 158 ms; the model
    then plans objects: 0, so BOTH of its sentences are refused ('sentence 1 has no mark and the
    question asked to be shown: not said', same for sentence 2), and the only line the learner
    receives is 'Which side of the triangle is opposite the right angle?'. The refusal is
    evaluated against the model's own empty plan and is blind to the instant mark the client
    already laid, so a ring stands on the glass for the whole turn with no sentence attached to
    it.

    Record: turns54live/course/1440-live-c0/03-circle-the-hypotenuse/turn.json.

INK-FOUR, correctness at 4: *"Nothing is spoken that was not drawn, and nothing drawn contradicts
what was said."* Experience at 4: *"The say names what it draws, every turn."* The first half was
built in wave 42 and holds. This file is the second: a mark the learner is looking at is a mark
this turn has to have words for, whether the plan drew it or the client did.

The channel is ``board.standing`` on the turn's payload — what the client put on the glass for
THIS ask, in the client's own words (``apps/web-pwa/src/wobo/board-turn.ts``, the instant mark).
Ids alone (``board.drawn``, and the scaffold's own first phase) are the older contract and stay
exactly as they were: they anchor a mark, and they are never narrated, because the sentence that
named them was said on the turn — or the phase — that drew them.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.board import stream
from wobo_gateway.board.planner import Plan
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

SSE = {"Accept": "text/event-stream"}

#: The ring the client laid at 158 ms on the live record, exactly as it reached the store.
RING: dict[str, Any] = {
    "id": "instant-1",
    "kind": "ring",
    "anchor": {"target": "course-intro-mathematics.square-on-the-hypotenuse"},
    "words": "square on the hypotenuse",
}

#: The plan the model came back with on that turn: two sentences refused for want of a mark, one
#: question, and nothing to draw.
THE_LIVE_TURN = dict(
    say="Which side of the triangle is opposite the right angle?",
    presentation="screen",
    objects=[],
    ask={"prompt": "Which side of the triangle is opposite the right angle?", "targets": []},
    refusals=[
        "sentence 1 has no mark and the question asked to be shown: not said",
        "sentence 2 has no mark and the question asked to be shown: not said",
    ],
)


def said_of(events: list[stream.Event]) -> str:
    return " ".join(str(e.data["text"]) for e in events if e.type == "say")


def ink_ids(events: list[stream.Event]) -> list[str]:
    return [str(e.data["object"]["id"]) for e in events if e.type == "ink"]


# --- the law -------------------------------------------------------------------------------------


def test_a_mark_the_client_already_laid_is_named_by_the_turn() -> None:
    """The live defect, in one assertion: the ring is on the glass, so the turn says what it is."""
    events = stream.build_events(Plan(**THE_LIVE_TURN), on_board=[RING])
    said = said_of(events).lower()
    assert "square on the hypotenuse" in said, said
    # And the learner's question is still asked, last, exactly as the plan wrote it.
    assert said.strip().endswith("opposite the right angle?"), said


def test_a_mark_already_on_the_glass_is_never_drawn_a_second_time() -> None:
    """It is spoken, not re-streamed: a second ring beside the first is not a correction."""
    events = stream.build_events(Plan(**THE_LIVE_TURN), on_board=[RING])
    assert ink_ids(events) == []
    assert events[-1].type == "done"
    assert events[-1].data["objects"] == 0


def test_a_standing_mark_the_line_already_names_earns_no_second_sentence() -> None:
    """The law is against silence, not against the plan. A line that already names the thing the
    client ringed is left alone."""
    plan = Plan(
        say="The square on the hypotenuse is the big one. What is its area?",
        presentation="screen",
        objects=[],
        ask={"prompt": "What is its area?", "targets": []},
    )
    said = said_of(stream.build_events(plan, on_board=[RING]))
    assert said.lower().count("square on the hypotenuse") == 1, said


def test_the_standing_mark_is_named_by_the_turn_s_first_sentence() -> None:
    """IT IS THE FIRST INK OF THE TURN, SO IT KEEPS TIME WITH THE FIRST SENTENCE.

    Measured live at 1440 on "circle the hypotenuse": the ring lands on the square on the
    hypotenuse at 155 ms and the model's own mark moves it to the right angle at 4 567 ms. A
    sentence about the square spoken third — eight seconds in — describes a ring that is no
    longer there, which is the word/ink contradiction the standard forbids from the other side.
    """
    plan = Plan(
        say="It is the side opposite the right angle. The right angle locates it.",
        presentation="screen",
        objects=[],
        ask={"prompt": "Which side is it?", "targets": []},
    )
    said = said_of(stream.build_events(plan, on_board=[RING]))
    # ... and SAID, in the form the plan's own ring would earn (``naming.sentence_for``), not the
    # client's label read out.
    assert said.startswith("This is the square on the hypotenuse. It is the side"), said


def test_a_sentence_the_plan_beat_still_keeps_time_with_its_own_words() -> None:
    """Putting a sentence at the front moves every sentence after it, so the beats move too — or
    the model's second mark would keep time with a sentence it has nothing to do with."""
    plan = Plan(
        say="It is the side opposite the right angle. The right angle locates it.",
        presentation="screen",
        objects=[
            {
                "id": "s0m1",
                "kind": "ring",
                "words": "the right angle",
                "anchor": {"target": "course-intro-mathematics.right-angle"},
                "meta": {"beat": {"with": 1}},
                "t": {"start": 0, "dur": 420},
            }
        ],
    )
    events = stream.build_events(plan, on_board=[RING])
    parts = [str(e.data["text"]) for e in events if e.type == "say"]
    mark = next(e.data["object"] for e in events if e.type == "ink")
    assert parts[0] == "This is the square on the hypotenuse.", parts
    beat = mark["meta"]["beat"]["with"]
    assert "right angle" in parts[beat].lower(), (beat, parts)


def test_the_plan_ringing_what_the_client_ringed_is_one_ring_and_one_sentence() -> None:
    """"The model refines, it does not gate": the client swallows a second frame on the same
    target, so one ring stands. The say must name that one ring once, not once in the plan's
    words and again in the client's."""
    plan = Plan(
        say="",
        presentation="screen",
        objects=[
            {
                "id": "s0m0",
                "kind": "ring",
                "words": "the square on the hypotenuse",
                "anchor": {"target": "course-intro-mathematics.square-on-the-hypotenuse"},
                "t": {"start": 0, "dur": 420},
            }
        ],
    )
    said = said_of(stream.build_events(plan, on_board=[RING])).lower()
    assert said.count("square on the hypotenuse") == 1, said


def test_a_mark_standing_with_no_words_is_not_given_any() -> None:
    """A mark that carries nothing a learner could be told earns no sentence — the say never
    invents one, and never reads a glass id out loud."""
    bare = {"id": "instant-1", "kind": "ring", "anchor": {"target": "l-4834uo0-0"}}
    events = stream.build_events(Plan(**THE_LIVE_TURN), on_board=[bare])
    said = said_of(events)
    assert "4834uo0" not in said, said
    assert said == "Which side of the triangle is opposite the right angle?", said


def test_the_client_cannot_write_a_monologue_or_smuggle_a_field() -> None:
    """The standing mark is the only thing on the wire a client writes and Wobo then SAYS, so it
    is read as strictly as the model's own plan: a handful of marks, words of a sane length, and
    nothing but the fields the grammar names."""
    flood = [
        {
            "id": f"m{i}",
            "kind": "ring",
            "anchor": {"target": f"t{i}"},
            "words": "wall " * 200,
            "check": "board.fact_supported",
            "text": "and this too",
        }
        for i in range(12)
    ]
    events = stream.build_events(Plan(**THE_LIVE_TURN), on_board=flood)
    said = said_of(events)
    assert said.lower().count("wall") <= stream.MAX_STANDING * 40, said
    assert len(said) < 1200, len(said)
    assert "and this too" not in said, said
    # A check a client named is not a check that ran, so nothing of it is signed.
    assert events[-1].data["verified"] == []


def test_an_id_on_the_board_is_never_narrated() -> None:
    """The older contract, unchanged. ``board.drawn`` and the scaffold's own first phase hand up
    ids: they anchor a mark, and the sentence that named them was said when they were drawn. The
    scaffold's phase two would otherwise say its whole figure over again."""
    events = stream.build_events(Plan(**THE_LIVE_TURN), on_board=["instant-1", "b0_1outline"])
    assert said_of(events) == "Which side of the triangle is opposite the right angle?"


def test_a_sentence_about_a_refused_mark_survives_when_that_thing_stands_on_the_glass() -> None:
    """``only_what_is_drawn`` takes out a sentence about a mark that never reached the wire. A
    mark the CLIENT laid is on the glass, so the sentence about it is true and is kept."""
    plan = Plan(
        say="The square on the hypotenuse.",
        presentation="screen",
        objects=[
            {
                "id": "r1",
                "kind": "ring",
                "words": "the square on the hypotenuse",
                "anchor": {"object": "gone"},
                "t": {"start": 0, "dur": 240},
            }
        ],
    )
    assert "hypotenuse" not in said_of(stream.build_events(plan)).lower()
    kept = said_of(stream.build_events(plan, on_board=[RING])).lower()
    assert "square on the hypotenuse" in kept, kept


def test_a_plan_mark_may_hang_off_a_mark_the_client_laid() -> None:
    """The anchor half of the older contract, kept for the new shape: a note on the instant ring
    is a note on something that is there."""
    plan = Plan(
        say="Look at the big square.",
        presentation="screen",
        objects=[
            {
                "id": "n1",
                "kind": "note",
                "words": "the biggest of the three",
                "anchor": {"object": "instant-1"},
                "t": {"start": 0, "dur": 240},
            }
        ],
    )
    events = stream.build_events(plan, on_board=[RING])
    assert ink_ids(events) == ["n1"]
    assert not (events[-1].data.get("refused") or [])


#: The underline the client laid on the learner's own equation before the doubt's answer left
#: (``instant.ts``, ``resolveDoubtInstant``), exactly as ``doubt.turn_payload`` hands it up: the
#: line's own words, and the page flag that says whose page the line is on.
PAGE_LINE: dict[str, Any] = {
    "id": "instant-1",
    "kind": "underline",
    "anchor": {"target": "r0"},
    "words": "3x + 5 = 20",
    "meta": {"page": True},
}


def test_a_standing_mark_on_the_learner_s_page_is_pointed_at_never_read_as_a_claim() -> None:
    """Live at 390 (wave 60, doubt) the caption opened "3x + 5 = 20. Not quite: the +5 moves by
    subtracting 5." — the standing underline's line read out as a statement over the learner's
    own page, because the page flag the doubt door set was dropped on the way to the say. A mark
    on the page is the teacher's finger on a line: "This line, 3x + 5 = 20."."""
    plan = Plan(
        say="Not quite: the +5 moves by subtracting 5. What is 20 - 5?",
        presentation="screen",
        objects=[],
        ask={"prompt": "What is 20 - 5?", "targets": []},
    )
    said = said_of(stream.build_events(plan, on_board=[PAGE_LINE]))
    assert said.startswith("This line, 3x + 5 = 20. Not quite"), said
    # ... and the line is never ALSO asserted somewhere else in the same caption.
    pointed = "This line, 3x + 5 = 20. Not quite"
    assert "3x + 5 = 20. Not quite" not in said.replace(pointed, ""), said


def test_the_page_flag_survives_the_rebuild_and_nothing_else_of_meta_does() -> None:
    """``_standing`` rebuilds the client's mark field by field; ``meta.page`` is one of the fields,
    because it decides the FORM of the sentence the mark is owed. Nothing else under ``meta`` is
    a client's to write."""
    smuggled = {**PAGE_LINE, "meta": {"page": True, "beat": {"with": 3}, "check": "x"}}
    [mark] = stream._standing([smuggled])
    assert mark["meta"] == {"page": True}
    [plain] = stream._standing([{**PAGE_LINE, "meta": {"page": "yes"}}])
    assert "meta" not in plain


def test_two_standing_lines_of_the_page_are_pointed_at_in_one_breath() -> None:
    """A lasso across two lines lays two underlines (``instant.ts``, ``also``); a teacher points at
    both in one sentence, not in two."""
    second = {**PAGE_LINE, "id": "instant-2", "anchor": {"target": "r1"}, "words": "3x = 20 + 5"}
    said = said_of(stream.build_events(Plan(**THE_LIVE_TURN), on_board=[PAGE_LINE, second]))
    assert said.startswith("This line, 3x + 5 = 20, and this line, 3x = 20 + 5. "), said


def test_a_standing_mark_s_label_is_said_not_read_out() -> None:
    """Keyless at 1440 on "show me why" the caption opened "The idea. Which part…" and at 390
    "Predict. Which part…": the client's label for its mark, read out as prose. The plan's own
    marks go through :func:`naming.sentence_for`; the client's are owed the same sentence."""
    idea = {
        "id": "instant-1",
        "kind": "underline",
        "anchor": {"target": "l-1lqhuwx-0"},
        "words": "the idea",
    }
    said = said_of(stream.build_events(Plan(**THE_LIVE_TURN), on_board=[idea]))
    assert said.startswith("This is the idea. "), said
    # ... and the card the ring is around is titled with an INSTRUCTION, which takes no article:
    # neither "Predict." nor "This is the predict, then check.", but the sentence Wobo already
    # says about this very card when nothing on it is named (``glass.absent_line``).
    card = {**idea, "kind": "ring", "anchor": {"target": "card-c4"}, "words": "predict, then check"}
    said = said_of(stream.build_events(Plan(**THE_LIVE_TURN), on_board=[card]))
    assert said.startswith("This one is predict, then check. "), said


# --- the wire ------------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    stream.reset()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def frames(body: str) -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    for block in body.split("\n\n"):
        if not block.strip() or block.startswith(":"):
            continue
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append((fields["event"], json.loads(fields["data"])))
    return out


def test_the_route_carries_the_standing_mark_to_the_wire(client: TestClient, auth) -> None:
    """End to end: the client says what it put on the glass, and the turn speaks about it."""
    res = client.post(
        "/v1/capability/wobo.turn",
        json={
            "payload": {
                "context": {"turn": {"lastUserInput": "circle the hypotenuse"}},
                "board": {"lesson": True, "standing": [RING]},
            }
        },
        headers={**auth(), **SSE},
    )
    assert res.status_code == 200
    said = " ".join(
        str(data["text"]) for kind, data in frames(res.text) if kind == "say"
    ).lower()
    assert "square on the hypotenuse" in said, said
