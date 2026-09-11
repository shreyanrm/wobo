"""THE INSTANT MARK ON A DRAWING FROM SCRATCH (docs/INK-FOUR.md, Timing at 4).

The standard: *the first stroke is on the glass within one second of the learner asking*, not of
Wobo's first word. Wave 42 built that for asks that name something already on the glass — the
client resolves the target from the glass map and the pen starts while the request is in flight.

A drawing built from scratch had no such path. "Prove Pythagoras with squares on the sides, legs
3 cm and 4 cm" waited on a model that thinks for seconds, and the evidence lab measured the first
stroke live at 13 729 ms, the graph at 15 064 ms. Yet the geometry never came from the model in
the first place: ``board_intents`` reads the ask deterministically in well under a millisecond and
a pipeline draws it. The model was gating ink it did not make.

``board/scaffold.py`` puts that ink on the wire first and lets the model's words follow on the
same turn. These tests hold three things: the wire really does hand the scaffold over before the
model is asked (``iter_sse``), the reading itself is fast and true (``prepare``), and the two
phases add up to one well-formed turn (the route).

The wall clock is measured elsewhere, in a browser against a real server: Starlette's test client
collects a streamed body before handing it back, so a timestamp taken here would measure the test
client, not the wire.
"""

from __future__ import annotations

import json
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.board import scaffold as board_scaffold
from wobo_gateway.board import stream
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

SSE = {"Accept": "text/event-stream"}

#: How long the pretend model thinks. Longer than the law's whole budget, so nothing that lands
#: inside the budget can have come from it.
SLOW_MODEL_S = 2.0

PYTHAGORAS = (
    "Prove Pythagoras theorem with squares on the sides of a right triangle with legs 3 cm and 4 cm"
)
FROM_SCRATCH = [
    PYTHAGORAS,
    "graph y = x^2 from -3 to 3",
    "Draw a Punnett square for Tt x Tt",
    "Draw a ray diagram of a ray through a convex lens of focal length 15 cm "
    "with the object 30 cm away",
    "Draw a labelled plant cell",
]


@pytest.fixture(autouse=True)
def _clean(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    stream.reset()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def ask(text: str, **context: Any) -> dict[str, Any]:
    return {"payload": {"context": {"turn": {"lastUserInput": text}, **context}}}


def payload_of(text: str) -> dict[str, Any]:
    return ask(text)["payload"]


def slow_brain(
    monkeypatch: pytest.MonkeyPatch, seconds: float = SLOW_MODEL_S, fails: bool = False
) -> dict[str, Any]:
    """Live mode with a model that thinks for `seconds`. Returns the call's own record.

    Phase two asks for WORDS, not for a board plan (``board.scaffold``, the words cut): the model
    is handed a figure a pipeline already drew and gives back the sentences that teach it.
    """
    import wobo_gateway.wobo as wobo

    monkeypatch.setenv("LLM_MODE", "live")
    seen: dict[str, Any] = {"calls": 0}

    def _slow(payload: dict[str, Any], *, scaffold: Any) -> dict[str, Any] | None:
        seen["calls"] += 1
        time.sleep(seconds)
        if fails:
            raise RuntimeError("every provider fell over")
        # The model's own words, over the drawing the scaffold already made.
        return {"say": "The squares make the proof visible.", "objects": []}

    monkeypatch.setattr(wobo, "board_words_for", _slow)
    return seen


def frames(body: str) -> list[tuple[str, str, dict[str, Any]]]:
    out = []
    for block in body.split("\n\n"):
        if not block.strip() or block.lstrip().startswith(":"):
            continue
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append((fields["id"], fields["event"], json.loads(fields["data"])))
    return out


def turn_of(client: TestClient, text: str, headers: dict[str, str]) -> list[tuple[str, str, dict]]:
    res = client.post("/v1/capability/wobo.turn", json=ask(text), headers=headers)
    assert res.status_code == 200, res.text
    return frames(res.text)


# --- 1. the wire hands the scaffold over before the model is asked --------------------------------


def test_every_scaffold_frame_is_on_the_wire_before_the_model_is_asked() -> None:
    """The whole claim, at the one place it can be seen: ``iter_sse`` yields the ink, and only
    then calls the second phase. Before this, the first byte waited for the model."""
    scaffold = board_scaffold.prepare(
        payload_of(PYTHAGORAS), context=payload_of(PYTHAGORAS)["context"], board_context={}
    )
    assert scaffold is not None
    turn = stream.new_turn("owner", list(scaffold.events))
    order: list[str] = []

    def then(t: stream.Turn) -> None:
        order.append("the model was asked")
        t.extend(board_scaffold.alone(scaffold))

    for chunk in stream.iter_sse(turn, then=then):
        for line in chunk.splitlines():
            if line.startswith("event: "):
                order.append(line.removeprefix("event: "))
    assert "ink" in order
    assert order.index("ink") < order.index("the model was asked")
    assert order.index("say") < order.index("the model was asked")
    assert order[-1] == "done"


def test_a_learner_who_stops_wobo_is_never_charged_for_the_second_phase() -> None:
    """An interrupt during the scaffold means the model is never asked at all."""
    scaffold = board_scaffold.prepare(
        payload_of(PYTHAGORAS), context=payload_of(PYTHAGORAS)["context"], board_context={}
    )
    assert scaffold is not None
    turn = stream.new_turn("owner", list(scaffold.events))
    asked: list[int] = []
    body = []
    stream_it = stream.iter_sse(turn, then=lambda t: asked.append(1))
    for i, chunk in enumerate(stream_it):
        body.append(chunk)
        if i == 2:
            stream.interrupt(turn.id, "owner", at="m0_1triangle")
    assert asked == []
    assert "event: interrupted" in "".join(body)


# --- 2. the reading is fast, and it is true -------------------------------------------------------


@pytest.mark.parametrize("question", FROM_SCRATCH)
def test_the_scaffold_resolves_a_drawing_from_scratch_in_milliseconds(question: str) -> None:
    payload = payload_of(question)
    began = time.monotonic()
    scaffold = board_scaffold.prepare(payload, context=payload["context"], board_context={})
    elapsed = (time.monotonic() - began) * 1000.0
    assert scaffold is not None, question
    assert elapsed < stream.FIRST_STROKE_BUDGET_MS / 2, f"{question}: {elapsed:.0f} ms"
    assert scaffold.drawn, question
    # Nothing is drawn in silence: the say comes from the marks themselves (board.naming).
    assert scaffold.said >= 1
    assert any(e.type == "say" and e.data["text"].strip() for e in scaffold.events)
    assert all(e.type != "done" for e in scaffold.events)


def test_a_question_about_the_page_is_never_scaffolded() -> None:
    """A mark on the glass is the client's own instant mark: no plane is opened for it here."""
    for question in ("which step is wrong here?", "circle the hypotenuse", "why does this work?"):
        payload = payload_of(question)
        assert (
            board_scaffold.prepare(payload, context=payload["context"], board_context={}) is None
        ), question


# --- 3. two phases, one turn ----------------------------------------------------------------------


def test_the_turn_is_one_well_formed_turn(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = slow_brain(monkeypatch)
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    assert seen["calls"] == 1
    kinds = [e[1] for e in events]
    assert kinds[0] == "say"
    assert kinds[-1] == "done"
    assert kinds.count("done") == 1
    assert "ink" in kinds
    assert kinds.index("ink") < kinds.index("ask")
    seqs = [int(e[0].rsplit(":", 1)[1]) for e in events]
    assert seqs == sorted(seqs) == list(range(len(seqs)))
    ids = [e[2]["object"]["id"] for e in events if e[1] == "ink"]
    assert ids and len(ids) == len(set(ids)), ids
    # The model's words are Wobo's, after the drawing's own.
    said = [e[2]["text"] for e in events if e[1] == "say"]
    assert "square" in said[0].lower()
    assert "The squares make the proof visible." in said


def test_the_done_frame_accounts_for_both_phases(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """What was drawn and what was checked happened in the phase before the last one."""
    slow_brain(monkeypatch)
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    done = events[-1][2]
    drawn = sum(1 for e in events if e[1] == "ink")
    assert done["objects"] == drawn
    assert "board.numbers_agree:hypotenuse" in done["verified"]


def test_the_clock_never_runs_backwards_across_the_seam(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    slow_brain(monkeypatch)
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    times = [e[2]["t"] for e in events]
    assert times == sorted(times), times


def test_a_provider_that_falls_over_costs_the_words_not_the_turn(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The scaffold has already taught. The turn closes on the question held in reserve."""
    slow_brain(monkeypatch, seconds=0.0, fails=True)
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    kinds = [e[1] for e in events]
    assert "ink" in kinds
    assert kinds[-1] == "done"
    assert "ask" in kinds
    assert events[-1][2]["objects"] > 0


def test_the_keyless_turn_is_unchanged(client: TestClient, auth) -> None:
    """Keyless the deterministic plan IS the whole turn, in one phase, as it always was."""
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    kinds = [e[1] for e in events]
    assert kinds[0] == "say"
    assert kinds[-1] == "done"
    assert kinds.count("done") == 1
    assert kinds.count("ask") == 1
