"""HOW HARD THE MODEL THINKS ON A BOARD TURN THAT HAS NO SCAFFOLD (docs/INK-FOUR.md, Timing).

The adversary, wave 48, finding 10 (the [slow] half of it): *"the class builder 6 said he could
not close is still the class a learner sits through, and it did not move: live at 1440 'draw this
for me' puts its first word at 15 606 ms; live at 390 'which step is wrong here?' does not open
its stream until 9321 ms; and live world sync-1 lands a correct mark at 118 ms and then says
nothing about it for 7043 ms. It needs the tier decision on ``board_plan_for`` that builder 6
correctly refused to take alone."*

Every one of those three turns is the SAME call: an ask the glass map already resolved on the
client, whose ink is on the glass in a hundred milliseconds, waiting on one blocking
``run_board_plan``. Two knobs on that call had never been set: how hard the model is asked to
think, and when the learner stops waiting for it.

MEASURED ON LUNA, 2026-09-10, the real prompt of all three turns (16 000 characters of grammar and
glass map), eight calls per cell, the ladder pinned, ``DAILY_SPEND_CEILING_USD=3``:

    thinking     median wall   worst    completion tokens   plans that survived the validator
    (unset)          7.7 s     12.1 s        300-900              22 of 24, one truncated to nothing
    low              4.1 s      6.0 s        224-434              23 of 24
    minimal          6.0 s      8.8 s        298-718              21 of 24

``low`` is the answer and ``minimal`` is not, which is the opposite of the words cut two hundred
lines up this file — and the reason is visible in the token counts. A board plan IS a piece of
reasoning: which mark, on which named target, in which order. Told to think minimally the model
does not stop reasoning, it moves the reasoning into the reply, writes half as much again and
takes two seconds longer to do it. Told to think *low* it does the same job in a third less wall
clock and a third fewer output tokens than the unset default.

And the deadline: a board plan inherited the turn class's whole 60 s ceiling
(``providers.timeout_for``), which is the right deadline when the model IS the answer. It is not
the answer here — the mark is already on the glass and ``board_plan_for`` falls to the KEYLESS
plan on any failure, which resolves the same glass map deterministically in under a millisecond.
So a model that has not answered in fourteen seconds costs the learner nothing by being dropped,
and costs them everything by being waited for.
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
from wobo_gateway.providers import TURN_TIMEOUT_S, MockProvider
from wobo_gateway.routing import Tier
from wobo_gateway.telemetry import MetricsSink

SSE = {"Accept": "text/event-stream"}

#: A lesson page with a figure whose parts declare themselves — the map all three of the measured
#: turns rode on.
GLASS = [
    {"id": "course-intro-mathematics", "role": "figure", "text": "the mathematics drawing"},
    {
        "id": "course-intro-mathematics.square-on-the-hypotenuse",
        "role": "figure-part",
        "text": "square on the hypotenuse",
        "meaning": "part:square-on-the-hypotenuse",
    },
    {
        "id": "course-intro-mathematics.triangle",
        "role": "figure-part",
        "text": "triangle",
        "meaning": "part:triangle",
    },
    {"id": "l-1", "role": "line", "text": "step 1: square both sides"},
    {"id": "l-2", "role": "line", "text": "step 2: subtract 9 from both sides"},
]

#: The three turns the finding names. None of them is a drawing built from scratch, so none of
#: them is scaffolded, so every one of them is one blocking ``board_plan_for``.
UNSCAFFOLDED = ["draw this for me", "which step is wrong here?", "explain this"]


@pytest.fixture(autouse=True)
def _clean(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    stream.reset()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def ask(text: str) -> dict[str, Any]:
    return {
        "payload": {
            "context": {
                "turn": {"lastUserInput": text},
                "packet": {"glass": GLASS},
                "curriculum": {"nodeName": "Pythagoras"},
            },
            "board": {"lesson": True},
        }
    }


def frames(body: str) -> list[tuple[str, str, dict[str, Any]]]:
    out = []
    for block in body.split("\n\n"):
        if not block.strip() or block.lstrip().startswith(":"):
            continue
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append((fields["id"], fields["event"], json.loads(fields["data"])))
    return out


class FakeModel:
    """One recorded model call, answering in the board plan grammar."""

    def __init__(self, reply: dict[str, Any] | None = None, error: Exception | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.error = error
        self.reply = (
            reply
            if reply is not None
            else {
                "say": "The square on the hypotenuse is the big one.",
                "marks": [
                    {
                        "kind": "ring",
                        "target": "course-intro-mathematics.square-on-the-hypotenuse",
                    }
                ],
            }
        )

    def __call__(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error

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


def live_model(monkeypatch: pytest.MonkeyPatch, model: FakeModel) -> FakeModel:
    import wobo_gateway.wobo as wobo

    monkeypatch.setenv("LLM_MODE", "live")
    monkeypatch.setattr(wobo, "model_complete", model)
    return model


def turn_of(client: TestClient, text: str, headers: dict[str, str]) -> list:
    res = client.post("/v1/capability/wobo.turn", json=ask(text), headers=headers)
    assert res.status_code == 200, res.text
    return frames(res.text)


# --- 1. none of the three is scaffolded, so all three are one blocking model call ----------------


@pytest.mark.parametrize("question", UNSCAFFOLDED)
def test_the_three_slow_turns_are_the_turn_with_no_scaffold(question: str) -> None:
    """If any of them scaffolded, its words would already be cut and this decision would be moot.
    They do not: the ink is on the CLIENT (resolved from the glass map), and the gateway's whole
    turn is the model."""
    payload = ask(question)["payload"]
    made = board_scaffold.prepare(
        payload, context=payload["context"], board_context=payload["board"]
    )
    assert made is None, f"{question!r} scaffolds; this test is measuring the wrong class"


# --- 2. the decision ------------------------------------------------------------------------------


def test_the_board_plan_is_not_asked_to_deliberate() -> None:
    """The decision itself, written down beside the words cut it is the complement of."""
    assert board_scaffold.PLAN_REASONING == "low"


def test_low_is_the_setting_and_minimal_is_not() -> None:
    """The words job and the plan job are different jobs and take opposite settings; a later
    reader who assumes one follows the other makes this turn two seconds slower."""
    assert board_scaffold.PLAN_REASONING != board_scaffold.WORDS_REASONING
    assert board_scaffold.WORDS_REASONING == "minimal"


def test_the_board_plan_has_a_deadline_the_learner_can_sit_through() -> None:
    """Not the turn class's 60 s ceiling. The keyless plan behind it is instant and deterministic,
    so waiting is the expensive option, not the safe one."""
    assert board_scaffold.PLAN_TIMEOUT_S < TURN_TIMEOUT_S / 3
    # and still half again the worst call measured at ``low`` (6.6 s), DOUBLED because
    # ``model_call`` splits the deadline with the rung behind the primary: the primary's own
    # slot is what a healthy call has to fit inside, and a deadline that bites a healthy call
    # costs the learner a whole extra provider instead of saving them anything.
    assert board_scaffold.PLAN_TIMEOUT_S / 2 >= 6.6 * 1.3


def test_the_deadline_is_the_deadline_the_learner_gets() -> None:
    """A deadline is only honest with one attempt per rung. The provider SDK retries a timed-out
    request by itself, underneath the chain walker, so a deadline that BITES is not the deadline
    the learner waits. Measured live on luna, 2026-09-10, with the budget set below the answer's
    real cost: 2.0 s took 5718 ms and 4.0 s took 7365 ms as shipped, against 2085 ms and 4073 ms
    with this knob at zero — and on a real screen at 1440 one 'which step is wrong here?' turn
    opened its stream at 19 023 ms under a fourteen-second deadline. Retrying a rung is the
    CHAIN's job, and behind the last rung the keyless plan is instant."""
    assert board_scaffold.PLAN_RETRIES == 0


def test_the_plan_job_is_still_the_generate_tier() -> None:
    """The cut is thinking and waiting, NOT the mind. A board plan chooses a mark on a named
    target and the verifier refuses it if it chose wrong; that is the generate tier's job and
    dropping it a rung would be a correctness decision wearing a timing decision's clothes."""
    from wobo_gateway.registry import policy

    assert board_scaffold.PLAN_TIER is Tier.GENERATE
    # and the constant is not decoration: it is the tier the call actually routes on.
    assert policy("engine.compose").tier is board_scaffold.PLAN_TIER


# --- 3. the wire: the decision reaches the call ---------------------------------------------------


@pytest.mark.parametrize("question", UNSCAFFOLDED)
def test_the_thinking_setting_reaches_the_model_call(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch, question: str
) -> None:
    model = live_model(monkeypatch, FakeModel())
    turn_of(client, question, {**auth(), **SSE})
    assert model.only["reasoning_effort"] == board_scaffold.PLAN_REASONING


@pytest.mark.parametrize("question", UNSCAFFOLDED)
def test_the_deadline_reaches_the_model_call(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch, question: str
) -> None:
    model = live_model(monkeypatch, FakeModel())
    turn_of(client, question, {**auth(), **SSE})
    assert model.only["timeout"] == board_scaffold.PLAN_TIMEOUT_S
    assert model.only["timeout"] != TURN_TIMEOUT_S
    # and it is a real deadline, not one the SDK may spend two or three times over.
    assert model.only["num_retries"] == board_scaffold.PLAN_RETRIES


# --- 4. what the cut must not cost ----------------------------------------------------------------


def test_the_plan_the_model_makes_still_reaches_the_glass(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The point of the call is the mark it plans. A faster call that plans nothing is worse than
    a slow one."""
    live_model(monkeypatch, FakeModel())
    events = turn_of(client, "circle the hypotenuse", {**auth(), **SSE})
    kinds = [e[1] for e in events]
    assert "ink" in kinds, kinds
    said = " ".join(e[2].get("text") or "" for e in events if e[1] == "say")
    assert "hypotenuse" in said


def test_a_model_that_runs_past_the_deadline_costs_the_turn_nothing(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The deadline is only safe because of what is behind it: ``board_plan_for`` swallows the
    failure and the KEYLESS plan — the same glass map, resolved deterministically — answers."""
    live_model(monkeypatch, FakeModel(error=TimeoutError("the model is still thinking")))
    events = turn_of(client, "circle the hypotenuse", {**auth(), **SSE})
    assert events[-1][1] == "done"
    assert [e[1] for e in events].count("ink") >= 1
    said = " ".join(e[2].get("text") or "" for e in events if e[1] == "say")
    assert said.strip(), "a dropped model left the learner with silence"


def test_a_scaffolded_turn_still_buys_the_words_and_not_a_plan(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The two decisions are separate and stay separate: the from-scratch turn's second phase is
    still the tiny tier, thinking minimally, with the words ceiling."""
    model = live_model(
        monkeypatch,
        FakeModel({"sentences": ["The squares add up."], "ask": "Which one is largest?"}),
    )
    res = client.post(
        "/v1/capability/wobo.turn",
        json={
            "payload": {
                "context": {
                    "turn": {
                        "lastUserInput": "Draw a Punnett square for Tt x Tt",
                    }
                }
            }
        },
        headers={**auth(), **SSE},
    )
    assert res.status_code == 200, res.text
    call = model.only
    assert call["reasoning_effort"] == board_scaffold.WORDS_REASONING
    assert call["max_tokens"] == board_scaffold.WORDS_MAX_TOKENS
    assert call["timeout"] == board_scaffold.WORDS_TIMEOUT_S
