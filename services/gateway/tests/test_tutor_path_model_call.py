"""The two model calls on the TEACHING path, and the knob that used to silence both of them.

``model_call.py`` exists because of one production failure on 2026-09-04: a model in the fallback
chain refuses ``temperature``, answers 400, and the learner gets nothing. Its docstring says so.
Every call in ``providers.py``, ``ask_public.py`` and ``safety_model.py`` was routed through it.

The two that were not are the two that teach: ``run_wobo_turn`` (Wobo's conversational answer) and
``run_board_plan`` (what Wobo DRAWS). Both called ``litellm.completion`` directly with a
temperature, so on a model that refuses one:

* the turn raised, and the learner got the gateway's error rather than an answer;
* the board plan raised, ``board_plan_for`` swallowed it, and the learner silently got the KEYLESS
  keyword plan with its canned line — a board nobody planned, presented as though somebody had.

Found by the teaching harness on 2026-09-05, on the first live board turn it ever ran: every
board it drew came back with one of the four fixed mock sentences.

Each test below fails with the direct call and passes through ``model_call.complete``.
"""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest


class _RefusesTemperature:
    """A provider that answers 400 to a temperature and answers properly without one.

    This is not a hypothetical: it is what ``openai/gpt-5.6-terra`` does today, verbatim.
    """

    def __init__(self, content: str) -> None:
        self.content = content
        self.calls: list[dict[str, Any]] = []

    def completion(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if "temperature" in kwargs:
            raise _BadRequestError(
                "litellm.BadRequestError: OpenAIException - Unsupported value: 'temperature' "
                "does not support 0.2 with this model. Only the default (1) value is supported."
            )
        return _Response(self.content)


class _BadRequestError(Exception):
    pass


class _Message:
    def __init__(self, content: str) -> None:
        self.content = content


class _Choice:
    def __init__(self, content: str) -> None:
        self.message = _Message(content)


class _Usage:
    total_tokens = 120
    prompt_tokens = 100
    completion_tokens = 20


class _Response:
    def __init__(self, content: str) -> None:
        self.choices = [_Choice(content)]
        self.usage = _Usage()
        self.model = "a-model"


@pytest.fixture
def fussy(monkeypatch: pytest.MonkeyPatch):
    """Install a litellm whose only complaint is the temperature."""

    def _install(content: str) -> _RefusesTemperature:
        provider = _RefusesTemperature(content)
        module = types.ModuleType("litellm")
        module.completion = provider.completion  # type: ignore[attr-defined]
        module.drop_params = False  # type: ignore[attr-defined]
        module.completion_cost = lambda **_: 0.0  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "litellm", module)
        return provider

    return _install


def test_a_turn_survives_a_model_that_refuses_the_temperature(fussy) -> None:
    from wobo_gateway.wobo import run_wobo_turn

    provider = fussy('{"path": "inline", "say": "Let us look at the first line together."}')
    output, _tokens = run_wobo_turn(
        provider_model="a-model",
        payload={"context": {"turn": {"lastUserInput": "what do i do next"}}},
    )
    assert output["say"] == "Let us look at the first line together."
    assert len(provider.calls) == 2, "the knob is dropped and the call retried exactly once"
    assert "temperature" not in provider.calls[1]


def test_a_board_plan_survives_a_model_that_refuses_the_temperature(fussy) -> None:
    from wobo_gateway.wobo import run_board_plan

    plan_json = (
        '{"say": "Here is the curve.", "presentation": "plane", '
        '"intents": [{"pipeline": "math", "op": "graph", "expr": "x**2", "var": "x", '
        '"domain": [-3, 3]}]}'
    )
    provider = fussy(plan_json)
    plan, _tokens = run_board_plan(
        provider_model="a-model",
        payload={"context": {"turn": {"lastUserInput": "graph y = x^2"}}},
    )
    assert plan["say"] == "Here is the curve.", "the model's own plan, not the keyless one"
    assert plan["intents"], "the intents the model asked for reached the planner"
    assert len(provider.calls) == 2
    assert "temperature" not in provider.calls[1]


def test_the_keyless_plan_is_not_quietly_served_in_place_of_a_live_one(fussy) -> None:
    """The consequence, at the level a learner would meet it.

    ``board_plan_for`` swallows every exception from the live planner and returns the keyless
    plan. That is the right call for a learner during a real outage and the wrong one to reach on
    a knob nobody needed, so this asserts the live plan actually arrives.
    """
    from wobo_gateway.wobo import _BOARD_SAY, board_plan_for

    fussy(
        '{"say": "Watch the curve first.", "intents": '
        '[{"pipeline": "math", "op": "graph", "expr": "x**2", "var": "x", "domain": [-3, 3]}]}'
    )
    plan = board_plan_for(
        {"context": {"turn": {"lastUserInput": "graph y = x^2 with the tangent at x = 1"}}},
        live=True,
    )
    assert plan is not None
    assert plan["say"] not in set(_BOARD_SAY.values()), (
        "a live board turn fell back to the keyless keyword plan and said nothing about it"
    )


def test_a_board_is_never_drawn_in_silence(fussy) -> None:
    """A live plan with intents and no ``say`` streamed ink and not one word.

    ``build_events`` lays the objects against Wobo's sentences, and with no sentences there are no
    ``say`` frames at all: the hand draws and the voice never speaks. The teaching harness caught a
    real live turn like that on 2026-09-05 — nine objects on the board, "(nothing)" said over them.
    BOARD.md section 4 is "say, ink, action, ask, card, done, in order"; the say is not optional.
    """
    from wobo_gateway.wobo import run_board_plan

    fussy(
        '{"presentation": "plane", "intents": '
        '[{"pipeline": "math", "op": "graph", "expr": "x**2", "var": "x", "domain": [-3, 3]}]}'
    )
    plan, _tokens = run_board_plan(
        provider_model="a-model",
        payload={"context": {"turn": {"lastUserInput": "graph y = x^2"}}},
    )
    assert plan["intents"]
    assert str(plan.get("say") or "").strip(), "ink with no words is Wobo drawing in silence"
