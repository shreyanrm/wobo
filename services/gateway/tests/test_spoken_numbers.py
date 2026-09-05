"""The spoken-number law: a number Wobo says aloud is one a verifier produced, or it is not said.

BOARD.md section 6 covered every number the hand writes and nothing Wobo says over it. The teaching
harness recorded two to five unsigned numbers in the spoken line on every turn of the live run of
2026-09-05, and the one wrong fact that reached a learner that day was spoken. ``wobo_gateway.spoken``
closes that. Each test here was run against the code with the law removed and failed.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import spoken
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.board import stream
from wobo_gateway.board.planner import Plan
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

# --- what is licensed ---------------------------------------------------------------------------


def test_a_number_the_learner_gave_may_be_repeated() -> None:
    decided = spoken.audit(
        "Your triangle has legs of 3 cm and 4 cm, so the long side is the one to find. "
        "Which side sits opposite the right angle?",
        given={3.0, 4.0},
        verified=set(),
    )
    assert decided.clean
    assert decided.say.startswith("Your triangle has legs of 3 cm and 4 cm")


def test_a_number_the_verifier_drew_may_be_spoken() -> None:
    decided = spoken.audit(
        "The hypotenuse is 5 because the squares on the legs add up to the square on it. "
        "Which square is the big one?",
        given={3.0, 4.0},
        verified={5.0},
    )
    assert decided.clean


def test_a_number_worked_out_in_wobos_head_is_not_spoken() -> None:
    """The failure the law exists for: a computed value nothing signed, said as fact."""
    decided = spoken.audit(
        "The hypotenuse is 5 because the squares add up. Which square is the big one?",
        given={3.0, 4.0},
        verified=set(),
    )
    assert not decided.clean
    assert decided.unsaid[0][0] == "5"
    assert decided.say == "Which square is the big one?"
    assert decided.dropped == (0,)


def test_a_sum_written_out_in_full_is_confirmed_and_licenses_its_numbers() -> None:
    decided = spoken.audit(
        "It is 5 because 9 + 16 = 25 and 5 × 5 = 25. Try this tiny one: what is 6 × 6?",
        given=set(),
        verified=set(),
    )
    assert decided.clean, decided.unsaid
    assert [c.name for c in decided.checks] == [
        "say.arithmetic:9 + 16 = 25",
        "say.arithmetic:5 * 5 = 25",
    ]
    assert all(c.passed for c in decided.checks)


def test_a_false_sum_is_the_worst_thing_and_is_not_spoken() -> None:
    decided = spoken.audit(
        "The hypotenuse is 6 because 3² + 4² = 36. Spot the right angle?",
        given={3.0, 4.0},
        verified=set(),
    )
    assert decided.say == "Spot the right angle?"
    assert decided.unsaid[0][0] == "3² + 4² = 36"
    assert not decided.checks


def test_two_fractions_side_by_side_are_a_claim_and_a_written_equality_is_a_check() -> None:
    """"1/2 and 2/4" asserts they are equal and nothing checks it; "1/2 = 2/4" is checkable."""
    loose = spoken.audit("They are the same, like 1/2 and 2/4.", given=set(), verified=set())
    assert not loose.clean
    tight = spoken.audit("They are the same: 1/2 = 2/4.", given=set(), verified=set())
    assert tight.clean
    assert tight.checks[0].name == "say.arithmetic:1/2 = 2/4"


def test_a_question_hands_the_arithmetic_to_the_learner_and_asserts_nothing() -> None:
    decided = spoken.audit("Try this tiny one: what is -5 + 3?", given=set(), verified=set())
    assert decided.clean


def test_honest_rounding_of_a_verified_value_is_licensed_and_a_wrong_figure_is_not() -> None:
    verified = {10.197162}
    assert spoken.audit("It rises about 10.2 m.", given=set(), verified=verified).clean
    assert spoken.audit("It rises about 10 m.", given=set(), verified=verified).clean
    assert not spoken.audit("It rises about 11 m.", given=set(), verified=verified).clean


def test_notation_is_not_a_quantity() -> None:
    """The 2 in CO2, H2O and x^2 is spelling, not a claim."""
    decided = spoken.audit(
        "Carbon gives CO2 and hydrogen gives H2O, and y = x^2 is the curve.",
        given=set(),
        verified=set(),
    )
    assert decided.clean


def test_given_numbers_come_from_the_learners_words_working_and_class() -> None:
    context = {
        "turn": {
            "lastUserInput": "a ball at 20 m/s at 45 degrees",
            "recentTurns": [
                {"role": "user", "text": "it was 12 metres last time"},
                {"role": "wobo", "text": "the answer is 99"},
            ],
        },
        "canvas": {"equation": "2*x + 3 = 7", "steps": ["2*x = 4"]},
        "lifetime": {"learner": {"age": 14, "grade": "Class 9"}},
    }
    given = spoken.given_numbers(context)
    assert {20.0, 45.0, 12.0, 2.0, 3.0, 7.0, 4.0, 14.0, 9.0} <= given
    assert 99.0 not in given, "Wobo's own earlier number is not the learner's"


def test_verified_numbers_are_only_those_whose_check_ran() -> None:
    objects = [
        {"id": "a", "kind": "number", "value": 5.0, "check": "board.numbers_agree:hyp"},
        {"id": "b", "kind": "number", "value": 7.0, "check": "board.frame"},
        {"id": "c", "kind": "write", "text": "2 O2", "check": "board.equation_balances"},
    ]
    ran = {"board.numbers_agree:hyp", "board.equation_balances"}
    assert spoken.verified_numbers(objects, ran) == {5.0, 2.0}


# --- the board: ink stays on its words ---------------------------------------------------------


def test_dropping_a_sentence_reanchors_the_ink_choreographed_after_it() -> None:
    objects: list[dict[str, Any]] = [
        {"id": "m0", "kind": "circle", "meta": {"beat": {"with": 0}}},
        {"id": "m1", "kind": "arrow", "meta": {"beat": {"with": 1}}},
        {"id": "m2", "kind": "write", "meta": {"beat": {"after": 2}}},
    ]
    spoken.reanchor(objects, dropped=(1,), total=3)
    assert objects[0]["meta"]["beat"] == {"with": 0}
    assert objects[1]["meta"]["beat"] == {"with": 1}, "a beat on the dropped sentence lands on its heir"
    assert objects[2]["meta"]["beat"] == {"after": 1}, "a later beat moves up by one"


def test_enforce_board_trims_the_say_signs_the_sums_and_names_what_was_not_spoken() -> None:
    plan = Plan(
        say="Here it is. The slope is 3 because I say so. Also 2 + 2 = 4. What do you notice?",
        objects=[{"id": "n1", "kind": "number", "value": 2.0, "check": "board.numbers_agree:slope"}],
    )
    from wobo_verifier.gate import CheckResult

    plan.ledger.note(CheckResult(name="board.numbers_agree:slope", passed=True))
    decided = spoken.enforce_board(plan, {"turn": {"lastUserInput": "graph y = x^2"}})
    assert plan.say == "Here it is. Also 2 + 2 = 4. What do you notice?"
    assert "say.arithmetic:2 + 2 = 4" in plan.ledger.names()
    assert any("not spoken" in r and "'3'" in r for r in plan.refusals)
    assert decided.dropped == (1,)


@pytest.fixture
def client(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    stream.reset()
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def _frames(body: str) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for block in body.split("\n\n"):
        if not block.strip() or block.startswith(":"):
            continue
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append((fields["event"], json.loads(fields["data"])))
    return out


def test_on_the_wire_an_unsigned_number_never_reaches_the_say_frames(
    client: TestClient, auth: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole path: a plan whose say claims a number nothing drew, through the real route."""
    import wobo_gateway.wobo as wobo_module

    def planned(_payload: dict[str, Any], *, live: bool) -> dict[str, Any]:
        return {
            "say": "Here is the curve. The slope at that point is 7. "
            "Notice 1 + 1 = 2 as we go. Where does it touch?",
            "intents": [
                {"pipeline": "math", "op": "graph", "expr": "x**2", "var": "x",
                 "domain": [-3, 3], "tangent_at": 1}
            ],
            "objects": [],
            "ask": {"prompt": "Where does it touch?", "targets": []},
        }  # fmt: skip

    monkeypatch.setattr(wobo_module, "board_plan_for", planned)
    res = client.post(
        "/v1/capability/wobo.turn",
        json={"payload": {"context": {"turn": {"lastUserInput": "graph y = x^2 and its tangent"}}}},
        headers={**auth(), "Accept": "text/event-stream"},
    )
    assert res.status_code == 200
    events = _frames(res.text)
    said = " ".join(d["text"] for kind, d in events if kind == "say")
    assert "7" not in said, said
    assert "1 + 1 = 2" in said
    done = next(d for kind, d in events if kind == "done")
    assert "say.arithmetic:1 + 1 = 2" in done["verified"]
    assert any("not spoken" in r for r in done.get("refused", []))


# --- the five-path turn: one more try, then the sentence goes ----------------------------------


class _Reply:
    def __init__(self, text: str) -> None:
        self.choices = [type("C", (), {"message": type("M", (), {"content": text})()})()]
        self.usage = type("U", (), {"total_tokens": 10})()


def test_the_prose_turn_gives_the_model_one_chance_to_say_it_properly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway import wobo as wobo_module

    seen: list[list[dict[str, str]]] = []
    answers = iter(
        [
            '{"path":"inline","say":"They are the same, like 1/2 and 2/4. Which is bigger?"}',
            '{"path":"inline","say":"They are the same because 1/2 = 2/4. Which is bigger?"}',
        ]
    )

    def fake(**kwargs: Any) -> _Reply:
        seen.append(list(kwargs["messages"]))
        return _Reply(next(answers))

    monkeypatch.setattr(wobo_module, "model_complete", fake)
    monkeypatch.setattr(wobo_module, "record_cost", lambda **_: None)
    out, _tokens = wobo_module.run_wobo_turn(
        provider_model="test/model",
        payload={"context": {"turn": {"lastUserInput": "what are equivalent fractions"}}},
    )
    assert len(seen) == 2, "the second call is the one chance"
    assert seen[1][-1]["role"] == "user"
    assert "1, 2, 4" in seen[1][-1]["content"] or "1, 2" in seen[1][-1]["content"]
    assert out["say"] == "They are the same because 1/2 = 2/4. Which is bigger?"
    assert out["verified"] == ["say.arithmetic:1/2 = 2/4"]


def test_when_the_second_try_still_breaks_the_law_the_sentence_is_not_spoken(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway import wobo as wobo_module

    calls = 0

    def fake(**kwargs: Any) -> _Reply:
        nonlocal calls
        calls += 1
        return _Reply('{"path":"inline","say":"The answer is 42. What would you try next?"}')

    monkeypatch.setattr(wobo_module, "model_complete", fake)
    monkeypatch.setattr(wobo_module, "record_cost", lambda **_: None)
    out, _tokens = wobo_module.run_wobo_turn(
        provider_model="test/model",
        payload={"context": {"turn": {"lastUserInput": "what is the meaning of it"}}},
    )
    assert calls == 2
    assert out["say"] == "What would you try next?"
    assert out["verified"] == []


def test_a_clean_answer_costs_one_call(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway import wobo as wobo_module

    calls = 0

    def fake(**kwargs: Any) -> _Reply:
        nonlocal calls
        calls += 1
        return _Reply(
            '{"path":"inline","say":"Totally fixable. Think of negatives as a tug of war, '
            'because the bigger side wins. Try this tiny one: what is -5 + 3?"}'
        )

    monkeypatch.setattr(wobo_module, "model_complete", fake)
    monkeypatch.setattr(wobo_module, "record_cost", lambda **_: None)
    out, _tokens = wobo_module.run_wobo_turn(
        provider_model="test/model",
        payload={"context": {"turn": {"lastUserInput": "i do not get negative numbers"}}},
    )
    assert calls == 1
    assert out["say"].startswith("Totally fixable.")
