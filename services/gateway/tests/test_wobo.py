"""Offline tests for Wobo's grounded turn (no model call — CI-safe).

The live turn is proven separately against real Claude; here we lock down the deterministic parts:
the verifier grounding that decides where the working breaks, the prompt assembly, and the mock shape.
"""

from __future__ import annotations

import re

import pytest
from wobo_gateway.providers import MockProvider
from wobo_gateway.wobo import (
    WOBO_INTRO,
    WOBO_PERSONA,
    _build_user_prompt,
    _ground_working,
    is_first_meeting,
)


@pytest.fixture(autouse=True)
def _isolated_content_cache(tmp_path, monkeypatch):
    """Wobo's mock component/viz turns run the real engines, which write artifacts. Point the file
    cache at a tmp dir so a test run never leaves files in the repo's content/cache."""
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))


def test_ground_working_finds_the_first_bad_form() -> None:
    g = _ground_working("2x + 3 = 7", ["2x = 10", "x = 5"])
    assert g is not None
    assert g["final_correct"] is False
    assert g["first_bad_form"] == "2x = 10"


def test_ground_working_passes_correct_working() -> None:
    g = _ground_working("2x + 3 = 7", ["2x = 4", "x = 2"])
    assert g is not None
    assert g["final_correct"] is True
    assert g["first_bad_form"] is None


def test_ground_working_is_none_without_working() -> None:
    assert _ground_working("2x + 3 = 7", []) is None
    assert _ground_working(None, ["x = 2"]) is None


def test_mock_wobo_turn_returns_say_and_actions() -> None:
    out = (
        MockProvider()
        .complete(provider_model="wobo/tutor-slm", capability="wobo.turn", payload={})
        .output
    )
    assert isinstance(out["say"], str) and out["say"]
    assert isinstance(out["actions"], list)
    assert out["handed_answer"] is False


# --- §19: Wobo has no gender ---------------------------------------------------------------------


def test_persona_instructs_the_no_gender_rule_and_the_self_description() -> None:
    """WOBO-PLAN.md §19: the model is told it has no gender, and told the exact line to give when
    a learner asks whether it is a boy or a girl."""
    from wobo_gateway.wobo import WOBO_NO_GENDER, WOBO_SYSTEM

    p = WOBO_PERSONA
    assert "You have no gender" in p
    assert "not a boy or a girl" in p
    assert "no she/her" in p and "he/him" in p
    assert WOBO_NO_GENDER in p  # the one-line self-description, verbatim
    assert WOBO_NO_GENDER in WOBO_SYSTEM  # and it survives into the assembled system prompt


def test_mock_turn_answers_the_boy_or_girl_question_with_the_wobot_line() -> None:
    from wobo_gateway.wobo import WOBO_NO_GENDER, mock_wobo_turn

    for asked in (
        "are you a boy or a girl?",
        "wait — are you a girl",
        "what gender are you",
    ):
        out = mock_wobo_turn({"context": {"turn": {"lastUserInput": asked}}})
        assert out["say"] == WOBO_NO_GENDER, asked
        assert out["path"] == "inline"
        assert out["grounded"] is True


def test_no_gender_line_obeys_the_house_style() -> None:
    from wobo_gateway.wobo import WOBO_NO_GENDER

    assert "!" not in WOBO_NO_GENDER
    assert WOBO_NO_GENDER.startswith("I'm a wobot")


def test_no_prompt_still_describes_wobo_as_the_old_jelly_orb() -> None:
    """Wave 5b: the character is the ink-visor wobot, and the words follow the rig.

    Every surface Wobo speaks through shares one persona string, so a stale body description
    there is a stale body description everywhere — and WOBO.md §12 is the prose the persona is
    written from. Both used to say "a soft, round, molten matte-jelly orb… flickering warm glow"
    long after the rig had been rebuilt as the ink visor.
    """
    from pathlib import Path

    from wobo_gateway.voice import accent_instruction
    from wobo_gateway.wobo import WOBO_NO_GENDER, WOBO_SYSTEM

    retired = ("jelly", "molten", "orange orb", "warm glow")
    spoken = (WOBO_SYSTEM, WOBO_INTRO, WOBO_NO_GENDER, accent_instruction("en-IN"))
    for text in spoken:
        lowered = text.lower()
        for word in retired:
            assert word not in lowered, f"retired body vocabulary in a prompt: {word}"

    law = (Path(__file__).resolve().parents[3] / "WOBO.md").read_text(encoding="utf-8")
    character = law.split("## 12. Wobo's body")[1].split("\n## ")[0]
    assert "ink-visor wobot" in character
    for word in ("jelly", "flickering warm glow"):
        assert word not in character.lower(), f"WOBO.md §12 still says {word}"
    # and it says so in words that obey §19: a body, not a gender, and never a gendered pronoun
    assert "not a gender" in character
    assert not re.search(r"\b(she|her|hers|he|him|his)\b", character, re.IGNORECASE)


def test_prompt_carries_the_targets_and_the_grounding() -> None:
    ctx = {
        "canvas": {"equation": "2x + 3 = 7", "steps": ["2x = 10"]},
        "targets": [{"id": "step-0", "kind": "step", "label": "2x = 10"}],
        "turn": {"lastUserInput": "I am stuck", "recentTurns": []},
        "curriculum": {"nodeName": "linear equations in one variable"},
    }
    grounding = _ground_working("2x + 3 = 7", ["2x = 10"])
    prompt = _build_user_prompt(ctx, grounding)
    assert "step-0" in prompt
    assert "2x = 10" in prompt
    assert "I am stuck" in prompt


# --- the five-path orchestrator (deterministic keyword classification, keyless) -------------------


def _mock_turn(text: str) -> dict:
    return (
        MockProvider()
        .complete(
            provider_model="wobo/tutor-slm",
            capability="wobo.turn",
            payload={"context": {"turn": {"lastUserInput": text}}},
        )
        .output
    )


def test_classify_covers_all_five_paths() -> None:
    from wobo_gateway.wobo import classify_intent

    assert classify_intent("why is the sky blue")["path"] == "inline"
    assert classify_intent("make me a sim for ohm's law")["path"] == "component"
    assert classify_intent("draw a diagram of the water cycle")["path"] == "visualization"
    assert classify_intent("start the boss battle")["path"] == "action"
    assert classify_intent("take me to my progress")["path"] == "route"


def test_mock_component_turn_carries_a_verified_spec() -> None:
    out = _mock_turn("quiz me on fractions")
    assert out["path"] == "component"
    assert out["component"]["kind"] == "quiz"
    items = out["component"]["spec"]["items"]
    assert len(items) >= 3
    assert all(item["prompt"] and item["answer"] for item in items)
    assert out["handed_answer"] is False


def test_mock_viz_turn_carries_sanitized_svg() -> None:
    out = _mock_turn("draw me a concept map of photosynthesis")
    assert out["path"] == "visualization"
    assert out["viz"]["kind"] == "conceptmap"
    assert "<svg" in out["viz"]["spec"]["svg"]


def test_mock_action_turn_is_explainable() -> None:
    out = _mock_turn("prepare a note for my parent")
    assert out["path"] == "action"
    action = out["action"]
    assert action["capability"] == "prepare_parent_note"
    assert action["why"]
    assert action["confidence"] in ("high", "medium", "low")


def test_mock_route_turn_names_a_real_surface() -> None:
    out = _mock_turn("go to practice")
    assert out["path"] == "route"
    assert out["route"]["to"] == "practice"


def test_mock_inline_turn_stays_prose() -> None:
    out = _mock_turn("I am stuck on this step")
    assert out["path"] == "inline"
    assert "component" not in out and "viz" not in out


# --- the voice-and-lines tiers (prompt-level doctrine: K guardianship, O wellbeing, G affect,
# F/L/Q/H truth & warmth) — assert the system prompt carries each tier's load-bearing line ---------


def test_system_prompt_carries_guardianship_tier() -> None:
    from wobo_gateway.wobo import WOBO_SYSTEM

    p = WOBO_SYSTEM
    assert "live exam" in p  # exam-hall hard line
    assert "what a parent can see" in p  # parent-deception refusal WITH transparency
    assert "no shame for asking" in p  # mature-topic curiosity middle band
    assert "tongue-twister" in p  # limit-testing dare → bounded redirect, never flat refusal
    assert "not a substitute for real people" in p  # attachment bid, honestly bounded
    assert "no other\n  child's data" in p or "no other child's data" in p  # peer-privacy wall


def test_system_prompt_carries_wellbeing_tier() -> None:
    from wobo_gateway.wobo import WOBO_SYSTEM

    p = WOBO_SYSTEM
    assert "The local time rides every turn" in p  # the clock rides the context
    assert "name rest as the higher-yield move" in p  # late-night school-night → sanction sleep
    assert "Sanction\n  a real break" in p or "sanction a real break" in p.lower()  # body signals


def test_system_prompt_carries_affect_tiers() -> None:
    from wobo_gateway.wobo import WOBO_SYSTEM

    p = WOBO_SYSTEM
    assert "ONE true reassurance" in p  # acute panic → one data-grounded reassurance
    assert "trusted adult" in p  # sub-crisis life disclosure → bridge to an adult
    assert "one timed micro-sprint" in p  # focus sprint
    assert "half-open" in p  # restless topic-hop response


def test_system_prompt_carries_truth_and_warmth_tier() -> None:
    from wobo_gateway.wobo import WOBO_SYSTEM

    p = WOBO_SYSTEM
    assert "Grade the CONCEPT, never the language" in p  # grade concept, not spelling
    assert "highest-yield" in p and "what to skip" in p  # cram triage
    assert "5-mark CBSE" in p  # board answer-format coaching
    assert "without undermining the teacher" in p  # teacher-conflict reconciliation
    assert "favourite" in p  # parasocial warmth, no fabricated human life
    assert "check the claim itself" in p  # secondhand claim-checking
    assert "20 questions" in p  # reciprocal play
    assert "draw me a dragon" in p  # play-and-make create widening


def test_system_prompt_carries_the_choreography() -> None:
    from wobo_gateway.wobo import WOBO_SYSTEM

    p = WOBO_SYSTEM
    # THE SYNCED HAND + THE ACTION TIMELINE — ink rides the beats of Wobo's spoken line
    assert "withSentence" in p
    assert "afterSentence" in p
    assert "Your voice and your hand are ONE performance" in p
    # a write note is Wobo's hand ON THE PAGE, never in the chat bubble (owner addendum)
    assert "your hand ON THE PAGE" in p
    # THE GUIDANCE LOOP — one step, check, wait, react, then advance
    assert "one step at a time" in p
    assert "never dump the whole solution" in p
    assert "your turn" in p.lower()
    # a concrete worked choreography the model can pattern-match against
    assert "2x + 3 = 7" in p


def test_prompt_carries_local_time_when_present() -> None:
    ctx = {
        "turn": {"lastUserInput": "one more chapter", "localTime": "Tuesday, 11:52 PM"},
        "curriculum": {"nodeName": "linear equations"},
    }
    prompt = _build_user_prompt(ctx, None)
    assert "Tuesday, 11:52 PM" in prompt
    assert "Local time for the learner" in prompt


def test_prompt_omits_clock_line_when_no_time() -> None:
    ctx = {"turn": {"lastUserInput": "help"}, "curriculum": {"nodeName": "x"}}
    prompt = _build_user_prompt(ctx, None)
    assert "Local time for the learner" not in prompt


def test_legacy_capability_name_still_reaches_the_wobo_turn() -> None:
    """The deployed web bundle POSTs the pre-rebrand name until it redeploys."""
    from wobo_gateway.registry import canonical_capability

    assert canonical_capability("vidya.turn") == "wobo.turn"
    assert canonical_capability("wobo.turn") == "wobo.turn"
    assert canonical_capability("grade.attempt") == "grade.attempt"


def test_legacy_capability_endpoint_is_not_a_404(auth) -> None:
    from fastapi.testclient import TestClient
    from wobo_gateway.app import Gateway, create_app
    from wobo_gateway.cache import InMemoryCache
    from wobo_gateway.telemetry import MetricsSink

    client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
    body = {"payload": {}}
    headers = auth()
    legacy = client.post("/v1/capability/vidya.turn", json=body, headers=headers)
    current = client.post("/v1/capability/wobo.turn", json=body, headers=headers)
    assert legacy.status_code == current.status_code == 200
    assert legacy.json()["capability"] == current.json()["capability"] == "wobo.turn"


# --- the first meeting (owner copy, 2026-09-02) ---------------------------------------------------


def test_persona_calls_wobo_a_wobot_and_carries_the_exact_intro() -> None:
    assert "AI wobot" in WOBO_PERSONA
    assert WOBO_INTRO in WOBO_PERSONA
    assert WOBO_INTRO == (
        "Hey there. I'm Wobo, your AI wobot. I'll help you learn, and I'll be with you every "
        "step of the way."
    )


def test_first_meeting_flag_reads_both_signals() -> None:
    assert is_first_meeting({"first_meeting": True}) is True
    assert is_first_meeting({"context": {"turn": {"firstMeeting": True}}}) is True
    assert is_first_meeting({"context": {"session": {"firstMeeting": True}}}) is True
    assert is_first_meeting({}) is False
    assert is_first_meeting({"first_meeting": False, "context": {"turn": {}}}) is False


def test_prompt_asks_for_the_intro_only_on_a_first_meeting() -> None:
    ctx = {"turn": {"lastUserInput": "hello"}, "curriculum": {"nodeName": "x"}}
    first = _build_user_prompt(ctx, None, first_meeting=True)
    assert "FIRST MEETING" in first
    assert WOBO_INTRO in first

    returning = _build_user_prompt(ctx, None)
    assert "FIRST MEETING" not in returning
    assert "never introduce yourself again" in returning


def test_mock_first_meeting_says_the_intro_verbatim() -> None:
    out = (
        MockProvider()
        .complete(
            provider_model="wobo/tutor-slm",
            capability="wobo.turn",
            payload={"first_meeting": True, "context": {"turn": {"lastUserInput": "quiz me"}}},
        )
        .output
    )
    assert out["say"] == WOBO_INTRO
    assert out["path"] == "inline"


# --- Wave 3: a prose-only reply is spoken, not swallowed by the canned line -------------


class _FakeChoiceMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeChoice:
    def __init__(self, content: str) -> None:
        self.message = _FakeChoiceMessage(content)


class _FakeResponse:
    def __init__(self, content: str) -> None:
        self.choices = [_FakeChoice(content)]
        self.usage = None


def _turn_with_model_text(monkeypatch, text: str) -> dict:
    import litellm
    from wobo_gateway.wobo import run_wobo_turn

    monkeypatch.setattr(litellm, "completion", lambda **_kw: _FakeResponse(text))
    out, _tokens = run_wobo_turn(
        provider_model="anthropic/claude-sonnet-5",  # the turn tier
        payload={
            "context": {
                "turn": {"lastUserInput": "I am stuck", "recentTurns": []},
                # The working the learner is stuck on. The spoken-number law (``spoken``) lets
                # Wobo repeat the 3 in it because it is theirs; a turn with no canvas would have
                # nothing to license "the 3" against.
                "canvas": {"equation": "2*x + 3 = 7", "steps": ["2*x + 3 - 3 = 7"]},
            }
        },
    )
    return out


CANNED = "Let us look at your working together."


def test_prose_reply_without_a_json_envelope_becomes_the_say_line(monkeypatch) -> None:
    prose = "Look at the line where you moved the 3 across — it kept its sign."
    out = _turn_with_model_text(monkeypatch, f"  {prose}  ")
    assert out["say"] == prose, "a real answer was thrown away for the canned line"
    assert out["actions"] == []
    assert out["path"] in ("inline", "component", "visualization", "action", "route")


def test_unparseable_json_still_speaks_the_model_text(monkeypatch) -> None:
    # a truncated envelope: _extract_json gives {}, but the words are still Wobo's
    out = _turn_with_model_text(monkeypatch, '{"say": "check the second step", "acti')
    assert out["say"] != CANNED
    assert "check the second step" in out["say"]


def test_empty_model_text_falls_back_to_the_canned_line(monkeypatch) -> None:
    assert _turn_with_model_text(monkeypatch, "   ")["say"] == CANNED


def test_a_valid_envelope_still_wins(monkeypatch) -> None:
    out = _turn_with_model_text(monkeypatch, '{"say": "Try isolating x first.", "path": "inline"}')
    assert out["say"] == "Try isolating x first."
    assert out["path"] == "inline"


# --- the keyless twin marks what the learner circled ---------------------------------------------
def test_a_question_with_a_region_in_hand_is_answered_with_a_mark_on_it() -> None:
    """A lasso plus "why?" is the commonest board turn there is, and it needs no subject pipeline:
    the answer is a ring round the thing they drew around and one written word beside it. Keyless,
    so the video case in BOARD.md §5 works with no model and no network."""
    from wobo_gateway.wobo import mock_board_plan

    plan = mock_board_plan(
        {
            "context": {
                "turn": {"lastUserInput": "why?"},
                "packet": {
                    "v": 1,
                    "focus": {"id": "f7", "kind": "lasso", "text": "the paused frame: cause"},
                },
            }
        }
    )
    assert plan is not None
    assert [o["anchor"] for o in plan["objects"]] == [
        {"focus": "f7"},
        {"focus": "f7", "at": "bottom"},
    ]
    assert {o["kind"] for o in plan["objects"]} == {"circle", "write"}
    # Every object Wobo plans has to survive the grammar Wobo is held to.
    from wobo_gateway.board import schema

    for obj in plan["objects"]:
        assert not schema.validate_object(obj), (obj["id"], schema.validate_object(obj))


def test_the_same_question_with_nothing_in_hand_is_a_conversation_not_a_drawing() -> None:
    from wobo_gateway.wobo import mock_board_plan

    assert mock_board_plan({"context": {"turn": {"lastUserInput": "why?"}}}) is None


def test_a_statement_with_a_region_in_hand_is_not_a_drawing_either() -> None:
    from wobo_gateway.wobo import mock_board_plan

    payload = {
        "context": {
            "turn": {"lastUserInput": "thanks, that helped"},
            "packet": {"v": 1, "focus": {"id": "f7"}},
        }
    }
    assert mock_board_plan(payload) is None


def test_the_turn_never_names_a_model_of_its_own() -> None:
    """Sweep regression: run_wobo_turn carried WOBO_PRIMARY/WOBO_ESCALATE and swapped them in
    whenever the resolved id looked like a Track-2 slot — a second, drifted routing table (it
    still pointed at a Claude 4 generation the registry had long moved off) that could silently
    override the tier's decision. The registry is the only place a model is named."""
    from wobo_gateway import wobo

    assert not hasattr(wobo, "WOBO_PRIMARY")
    assert not hasattr(wobo, "WOBO_ESCALATE")

    captured: dict[str, object] = {}

    class _FakeLiteLLM:
        drop_params = False

        @staticmethod
        def completion(**kwargs: object):
            captured.update(kwargs)

            class _Msg:
                content = '{"path":"inline","say":"ok","actions":[]}'

            class _Choice:
                message = _Msg()

            class _Resp:
                choices = [_Choice()]
                usage = None

            return _Resp()

    import sys

    sys.modules["litellm"] = _FakeLiteLLM  # type: ignore[assignment]
    try:
        wobo.run_wobo_turn(
            provider_model="wobo/tutor-slm",  # the shape that used to trigger the swap
            payload={"context": {}},
            fallbacks=("anthropic/claude-opus-5",),
        )
    finally:
        del sys.modules["litellm"]

    # The id reaches the provider unswapped. (model_call walks the chain itself now, one model
    # per litellm call, so litellm sees the primary alone on a call that succeeds.)
    assert captured["model"] == "wobo/tutor-slm"
    assert "fallbacks" not in captured
