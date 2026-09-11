"""PHASE TWO OF A SCAFFOLDED TURN IS WORDS (docs/INK-FOUR.md, Timing at 4).

The adversary, wave 42, finding 10: *"The MODEL half is still the turn a learner actually sits
through... Nobody has cut the GENERATE tier for a turn that draws from a pipeline."*

Measured before the cut, on the five from-scratch boards the standing battery draws
(``adv-lab``, keyless, 2026-09-10):

    ask                                  scaffold drew   phase two planned   phase two KEPT
    prove pythagoras (3 cm, 4 cm)             10               10                  0
    graph y = x^2 from -3 to 3                 5                5                  0
    Punnett square for Tt x Tt                 8                8                  0
    plant cell with five labels               15               15                  0
    ray diagram, f = 15 cm, u = 30 cm         15               15                  0

Every one of them. The scaffold draws the figure from the learner's own words in under a
millisecond; the model is then handed the whole 14 428-character board grammar and the whole glass
map, asked for 900 tokens, and plans THE SAME FIGURE ALL OVER AGAIN — and ``scaffold.resume``
drops every object of it as a mark already on the board. The learner sat through twelve seconds
of a model re-drawing what a pipeline had already drawn, for words.

So the models desk takes the decision: **when a pipeline drew it, phase two asks for words only.**
No drawing grammar, no glass map, no "open", on the tiny tier rather than the generate tier, and
asked to think minimally rather than to reason a figure out. What the model is genuinely for on
this turn — the why, in the register, and the check — is exactly what it is still asked for.

These tests hold the cut and the four things it must not cost: the plane stays the turn's surface,
the number law still reads the WHOLE drawing, the turn still ends on a question, and a provider
that falls over still costs only the words.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.board import scaffold as board_scaffold
from wobo_gateway.board import stream
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider, max_tokens_for
from wobo_gateway.routing import Tier
from wobo_gateway.telemetry import MetricsSink

SSE = {"Accept": "text/event-stream"}

PYTHAGORAS = (
    "Prove Pythagoras theorem with squares on the sides of a right triangle with legs 3 cm and 4 cm"
)
PLANT_CELL = "Draw a labelled plant cell with five labels"
FROM_SCRATCH = [
    PYTHAGORAS,
    "graph y = x^2 from -3 to 3",
    "Draw a Punnett square for Tt x Tt",
    PLANT_CELL,
    "Draw a ray diagram of a ray through a convex lens of focal length 15 cm "
    "with the object 30 cm away",
]

#: A page with plenty on the glass, so a prompt that ships the map cannot hide it.
GLASS = {
    "targets": [
        {"id": f"s{i}", "role": "step", "text": f"step {i}: subtract {i} from both sides"}
        for i in range(1, 9)
    ]
}


@pytest.fixture(autouse=True)
def _clean(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    stream.reset()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def ask(text: str, **context: Any) -> dict[str, Any]:
    return {"payload": {"context": {"turn": {"lastUserInput": text}, **context}}}


def payload_of(text: str, **context: Any) -> dict[str, Any]:
    return ask(text, **context)["payload"]


def scaffold_for(text: str, **context: Any) -> Any:
    payload = payload_of(text, **context)
    made = board_scaffold.prepare(payload, context=payload["context"], board_context={})
    assert made is not None, text
    return made


def brief_for(text: str, **context: Any) -> Any:
    payload = payload_of(text, **context)
    return board_scaffold.words_brief(scaffold_for(text, **context), payload)


def frames(body: str) -> list[tuple[str, str, dict[str, Any]]]:
    out = []
    for block in body.split("\n\n"):
        if not block.strip() or block.lstrip().startswith(":"):
            continue
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append((fields["id"], fields["event"], json.loads(fields["data"])))
    return out


class FakeModel:
    """One recorded model call, answering in the words grammar."""

    def __init__(self, reply: dict[str, Any] | None = None, fails: bool = False) -> None:
        self.calls: list[dict[str, Any]] = []
        self.fails = fails
        self.reply = (
            reply
            if reply is not None
            else {
                "sentences": [
                    "The two small squares hold the big one.",
                    "That is why the long side comes out the way it does.",
                ],
                "ask": "Which square is the odd one out?",
            }
        )

    def __call__(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self.fails:
            raise RuntimeError("every provider fell over")

        class _Msg:
            content = json.dumps(self.reply)

        class _Choice:
            message = _Msg()

        class _Res:
            choices = [_Choice()]
            usage = None

        return _Res()

    @property
    def only(self) -> dict[str, Any]:
        assert len(self.calls) == 1, f"{len(self.calls)} model calls, expected 1"
        return self.calls[0]

    @property
    def prompt(self) -> str:
        return "\n".join(str(m.get("content") or "") for m in self.only["messages"])


def live_model(monkeypatch: pytest.MonkeyPatch, model: FakeModel) -> FakeModel:
    import wobo_gateway.wobo as wobo

    monkeypatch.setenv("LLM_MODE", "live")
    monkeypatch.setattr(wobo, "model_complete", model)
    return model


def turn_of(client: TestClient, text: str, headers: dict[str, str], **context: Any) -> list:
    res = client.post("/v1/capability/wobo.turn", json=ask(text, **context), headers=headers)
    assert res.status_code == 200, res.text
    return frames(res.text)


# --- 1. the cut: what phase two is asked for ------------------------------------------------------


@pytest.mark.parametrize("question", FROM_SCRATCH)
def test_phase_two_is_never_asked_to_draw_what_a_pipeline_already_drew(question: str) -> None:
    """The brief carries no drawing grammar at all: no "open", no intent shapes, no mark kinds,
    no pipeline names. The figure is on the board; there is nothing left to plan."""
    from wobo_gateway.wobo import BOARD_SYSTEM

    brief = brief_for(question)
    lowered = brief.system.lower()
    for grammar in ('"open"', '"pipeline"', '"marks"', '"target"', '"intent"', "coordinate"):
        assert grammar not in lowered, f"{grammar} is still in the words brief"
    for op in ("punnett", "free_body", "projectile", "number_line", "food_web", "smiles"):
        assert op not in lowered, f"the {op} grammar is still in the words brief"
    # The whole grammar is gone, not trimmed: nine thousand characters of it between Wobo's
    # persona and the teaching law, which the words job keeps.
    assert len(BOARD_SYSTEM) - len(brief.system) > 4000, (len(brief.system), len(BOARD_SYSTEM))


def test_the_words_brief_never_ships_the_glass_map() -> None:
    """The plane is over the page. What is under it is not what the words are about — and a map
    of the learner's screen is the largest thing the board prompt sends."""
    from wobo_gateway.board import glass
    from wobo_gateway.wobo import BOARD_SYSTEM, _build_board_prompt

    payload = payload_of(PYTHAGORAS, **GLASS)
    brief = brief_for(PYTHAGORAS, **GLASS)
    assert "the glass map" not in brief.user.lower()
    assert "subtract 8 from both sides" not in brief.user
    # And the whole brief is materially smaller than the drawing turn's, on the same payload.
    drawing = len(BOARD_SYSTEM) + len(
        _build_board_prompt(payload["context"], glass.entries_of(payload))
    )
    assert len(brief.system) + len(brief.user) < drawing * 0.75


def test_the_words_brief_names_the_figure_and_what_wobo_already_said() -> None:
    """The model cannot see the board, so the board is the prompt: what code drew, what is written
    on it, and the sentence Wobo has already spoken over it."""
    made = scaffold_for(PYTHAGORAS)
    brief = board_scaffold.words_brief(made, payload_of(PYTHAGORAS))
    assert "right_triangle" in brief.user
    assert "9 + 16 = 25" in brief.user
    assert made.lines[0] in brief.user
    assert "Prove Pythagoras" in brief.user


def test_the_words_job_is_not_the_generate_tier() -> None:
    """The decision itself, written down where the two-phase turn is decided."""
    brief = brief_for(PYTHAGORAS)
    assert brief.tier is Tier.TINY
    assert brief.tier is not Tier.GENERATE
    assert brief.max_tokens < max_tokens_for("wobo.board", 900)
    assert brief.reasoning == "minimal"
    # Its own cost line, so what the cut bought can be read off the ledger.
    assert brief.capability != "wobo.board"


def test_the_ceiling_leaves_the_model_room_to_think_before_it_writes() -> None:
    """Luna counts reasoning tokens against ``max_tokens``. Cut the ceiling to the size of two
    sentences and the reply comes back truncated, ``_extract_json`` finds nothing, and the learner
    loses the whole of phase two. Measured live on luna at 260: one reply in four truncated at
    exactly 260 completion tokens with an empty say. At 600: none in four, and 185-278 tokens
    written. The ceiling is a guard rail, not a target."""
    brief = brief_for(PYTHAGORAS)
    assert brief.max_tokens >= 500, brief.max_tokens


# --- 2. the wire: one call, no ink, the plane held ------------------------------------------------


def test_a_scaffolded_turn_makes_exactly_one_model_call_and_it_is_for_words(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = live_model(monkeypatch, FakeModel())
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE}, **GLASS)

    call = model.only
    assert call["max_tokens"] == board_scaffold.WORDS_MAX_TOKENS
    assert call["reasoning_effort"] == "minimal"
    assert '"open"' not in model.prompt
    assert "subtract 8 from both sides" not in model.prompt
    # Every stroke on the wire is the scaffold's own; phase two adds none.
    made = scaffold_for(PYTHAGORAS, **GLASS)
    ids = [e[2]["object"]["id"] for e in events if e[1] == "ink"]
    assert ids == made.ids()
    said = [e[2]["text"] for e in events if e[1] == "say"]
    assert "The two small squares hold the big one." in said
    assert [e[2]["prompt"] for e in events if e[1] == "ask"] == ["Which square is the odd one out?"]


def test_the_plane_the_scaffold_opened_is_still_the_turns_surface(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A words-only second phase presents nothing, and the `done` frame is the TURN's account of
    itself. If phase two's own presentation won, the client would be told the drawing it is
    looking at was never opened."""
    live_model(monkeypatch, FakeModel())
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    assert events[-1][2]["presentation"] == "plane"


def test_the_words_are_held_to_the_number_law_against_the_whole_drawing(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The sums the pipeline drew and the verifier signed are Wobo's to say. Phase two carries no
    objects, so the law has to be given the scaffold's drawing or it would refuse every number
    the figure itself is made of."""
    live_model(
        monkeypatch,
        FakeModel(
            {
                "sentences": [
                    "9 + 16 = 25, which is why the long side lands where it does.",
                    "The squares on the legs fill the square on the hypotenuse exactly.",
                ],
                "ask": "How many unit squares sit on the longest side?",
            }
        ),
    )
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    said = " ".join(e[2]["text"] for e in events if e[1] == "say")
    assert "9 + 16 = 25" in said
    assert "not spoken" not in json.dumps(events[-1][2].get("refused") or [])


def test_a_number_nobody_drew_is_still_refused(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The cut does not become a way round the law it replaced."""
    live_model(
        monkeypatch,
        FakeModel(
            {
                "sentences": ["The area comes to 137 square centimetres."],
                "ask": "What would change if a leg grew?",
            }
        ),
    )
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    said = " ".join(e[2]["text"] for e in events if e[1] == "say")
    assert "137" not in said
    assert any("137" in r for r in events[-1][2].get("refused") or [])


# --- 3. what the cut must not cost ----------------------------------------------------------------


def test_the_turn_still_ends_on_a_question_when_the_model_asks_none(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    live_model(monkeypatch, FakeModel({"sentences": ["The squares add up."], "ask": ""}))
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    asks = [e[2]["prompt"] for e in events if e[1] == "ask"]
    assert asks == ["What do you notice about it?"]


def test_a_provider_that_falls_over_still_costs_the_words_not_the_turn(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    live_model(monkeypatch, FakeModel(fails=True))
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    kinds = [e[1] for e in events]
    assert "ink" in kinds and "ask" in kinds and kinds[-1] == "done"
    assert events[-1][2]["objects"] == len(scaffold_for(PYTHAGORAS).ids())
    assert events[-1][2]["presentation"] == "plane"


def test_a_reply_that_ran_out_of_room_leaves_the_drawing_standing(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A reply truncated at the ceiling parses to nothing. That is not a broken turn: the figure
    and its own sentence are already on the glass, so the turn closes on them and on the question
    held in reserve, exactly as a fallen-over provider does."""
    live_model(monkeypatch, FakeModel({"sentences": [], "ask": ""}))
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    kinds = [e[1] for e in events]
    assert "ink" in kinds and kinds[-1] == "done"
    assert [e[2]["prompt"] for e in events if e[1] == "ask"] == ["What do you notice about it?"]
    assert events[-1][2]["presentation"] == "plane"


def test_both_phases_are_still_one_account_of_one_turn(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    live_model(monkeypatch, FakeModel())
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    done = events[-1][2]
    assert done["objects"] == sum(1 for e in events if e[1] == "ink")
    assert "board.numbers_agree:hypotenuse" in done["verified"]
    assert [e[2]["t"] for e in events] == sorted(e[2]["t"] for e in events)


def test_the_sentence_the_scaffold_already_said_is_never_said_twice(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    made = scaffold_for(PLANT_CELL)
    live_model(
        monkeypatch,
        FakeModel({"sentences": [made.lines[0], "Each part does one job."], "ask": "Which one?"}),
    )
    events = turn_of(client, PLANT_CELL, {**auth(), **SSE})
    said = [e[2]["text"] for e in events if e[1] == "say"]
    assert said.count(made.lines[0]) == 1


def test_the_keyless_turn_never_reaches_the_words_job(client: TestClient, auth) -> None:
    """Keyless there is no second phase at all — the deterministic plan is the whole turn."""
    events = turn_of(client, PYTHAGORAS, {**auth(), **SSE})
    kinds = [e[1] for e in events]
    assert kinds[0] == "say" and kinds[-1] == "done" and kinds.count("done") == 1
    assert events[-1][2]["presentation"] == "plane"
