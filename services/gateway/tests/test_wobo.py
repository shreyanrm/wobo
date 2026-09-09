"""Offline tests for Wobo's grounded turn (no model call — CI-safe).

The live turn is proven separately against real Claude; here we lock down the deterministic parts:
the verifier grounding that decides where the working breaks, the prompt assembly, and the mock shape.
"""

from __future__ import annotations

import re

import pytest
from wobo_gateway import wobo
from wobo_gateway.providers import MockProvider
from wobo_gateway.wobo import (
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
    spoken = (WOBO_SYSTEM, WOBO_NO_GENDER, accent_instruction("en-IN"))
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


def test_system_prompt_carries_the_guidance_loop_and_no_overlay_grammar() -> None:
    """The plain turn speaks and drives scenes; it never draws. A mark on the page is a plan by
    glass id on the board path, traced by the one hand (docs/INK-FREEZE-PLAN-TRACE.md §3, §4), so
    the overlay's verbs and its per-sentence beats are gone from the prompt."""
    from wobo_gateway.wobo import WOBO_SYSTEM

    p = WOBO_SYSTEM
    for gone in (
        "withSentence",
        "afterSentence",
        '"type":"annotate"',
        '"type":"highlight"',
        '"type":"point"',
        '"type":"write"',
        "lookHere",
        "target registry",
    ):
        assert gone not in p, gone
    # what is on the screen is the glass map, and it is named by its words, never its id
    assert "glass map" in p
    assert "never by its id" in p
    # THE GUIDANCE LOOP — one step, check, wait, react, then advance
    assert "one step at a time" in p
    assert "never dump the whole solution" in p
    assert "your turn" in p.lower()
    # a concrete worked shape the model can pattern-match against
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


# --- the first meeting (no introduction: DESIGN.md §0.x, owner 2026-09-08) ------------------------


def test_persona_calls_wobo_a_wobot_and_never_narrates() -> None:
    assert "AI wobot" in WOBO_PERSONA
    assert "NEVER NARRATE" in WOBO_PERSONA
    assert "I'm Wobo" not in WOBO_PERSONA


def test_first_meeting_flag_reads_both_signals() -> None:
    assert is_first_meeting({"first_meeting": True}) is True
    assert is_first_meeting({"context": {"turn": {"firstMeeting": True}}}) is True
    assert is_first_meeting({"context": {"session": {"firstMeeting": True}}}) is True
    assert is_first_meeting({}) is False
    assert is_first_meeting({"first_meeting": False, "context": {"turn": {}}}) is False


def test_prompt_marks_a_first_meeting_and_asks_for_no_introduction() -> None:
    ctx = {"turn": {"lastUserInput": "hello"}, "curriculum": {"nodeName": "x"}}
    first = _build_user_prompt(ctx, None, first_meeting=True)
    assert "FIRST MEETING" in first
    assert "never introduce yourself" in first
    assert "I'm Wobo" not in first

    returning = _build_user_prompt(ctx, None)
    assert "FIRST MEETING" not in returning
    assert "never introduce yourself again" in returning


def test_mock_first_meeting_answers_the_question_and_does_not_introduce() -> None:
    out = (
        MockProvider()
        .complete(
            provider_model="wobo/tutor-slm",
            capability="wobo.turn",
            payload={"first_meeting": True, "context": {"turn": {"lastUserInput": "quiz me"}}},
        )
        .output
    )
    assert "Wobo" not in out["say"]
    assert out["path"] == "component"


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
    assert [o["anchor"] for o in plan["objects"]] == [{"focus": "f7"}, {"focus": "f7"}]
    assert [o["kind"] for o in plan["objects"]] == ["ring", "underline"]
    assert plan["ask"]["targets"] == ["f7"]
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


# --- wave 29, board-5: the words after the equation are not the equation -------------------------
@pytest.mark.parametrize(
    ("ask", "equation"),
    [
        (
            "solve x^2 - 5x + 6 = 0 and show me on the board how the factors work",
            "x**2 - 5x + 6 = 0",
        ),
        ("solve 2x + 3 = 7 and draw it", "2x + 3 = 7"),
        ("solve the equation x + 2 = 5 quickly", "x + 2 = 5"),
        ("solve 2*x + 3 = 7 step by step", "2*x + 3 = 7"),
        ("can you solve sqrt(x) + 1 = 4 for me", "sqrt(x) + 1 = 4"),
        # wave 29 fixer: the learner's sentence after the equation used to ride in as maths. A
        # single letter or a SymPy constant is a name the parser reads, so "x is what", "I think"
        # and "E is what" were solved as ``2x + 3 = 7x``, ``... = 7I`` (a complex root) and
        # ``... = 5E``, and drawn as ink over "Look at this".
        ("solve 2x + 3 = 7 x is what", "2x + 3 = 7"),
        ("solve 2x + 3 = 7 I think x is 2", "2x + 3 = 7"),
        ("solve x + 2 = 5 E is what", "x + 2 = 5"),
        # and hasattr(sympy, word) read ordinary English (solve, factor, test, on...) as maths
        ("show me how to solve 2x = 10 on the board", "2x = 10"),
        ("solve x^2 - 5x + 6 = 0 factor it", "x**2 - 5x + 6 = 0"),
        ("solve 2x + 3 = 7 test me after", "2x + 3 = 7"),
        ("solve 3y + 2 = 11 ok", "3y + 2 = 11"),
    ],
)
def test_the_ask_around_an_equation_is_not_handed_to_the_cas(ask: str, equation: str) -> None:
    """``board_intents`` used to trim the tail on four literal phrases only, so "and show me on the
    board how the factors work" rode into the equation, the CAS refused it twice and the learner
    got nothing on the board (wave 29, board-5). A word the verifier knows (``sqrt``) stays."""
    from wobo_gateway.board.planner import plan_board
    from wobo_gateway.wobo import board_intents

    intents = board_intents(ask)
    assert intents and intents[0]["op"] == "derivation", ask
    assert intents[0]["equation"] == equation
    plan = plan_board({"say": "", "intents": intents})
    assert plan.objects, f"{ask!r}: refused as {plan.refusals}"
    assert not plan.refusals


@pytest.mark.parametrize(
    ("ask", "equation", "var", "last_line"),
    [
        ("please solve v_0 + 2t = 10 for t", "v_0 + 2t = 10", "t", "t = 5 - v_0/2"),
        ("solve 2y = 8", "2y = 8", "y", "y = 4"),
        ("solve 3a + 1 = 7 for a", "3a + 1 = 7", "a", "a = 2"),
        ("solve 2t + 3 = 7", "2t + 3 = 7", "t", "t = 2"),
        ("solve 3y + 2 = 11 ok", "3y + 2 = 11", "y", "y = 3"),
    ],
)
def test_an_equation_in_any_letter_is_solved_for_that_letter(
    ask: str, equation: str, var: str, last_line: str
) -> None:
    """The derivation pipeline solves for ``intent["var"]`` and defaulted to ``x``, and the keyword
    table never set it, so every equation in y, t or a refused with "no single solution I can
    write down" (wave 29 fixer, on board-5's own probe list). The letter comes from "for t" when
    the learner says it, else from the one letter in the equation."""
    from wobo_gateway.board.planner import plan_board
    from wobo_gateway.wobo import board_intents

    intents = board_intents(ask)
    assert intents and intents[0]["equation"] == equation, ask
    assert intents[0].get("var") == var
    plan = plan_board({"say": "", "intents": intents})
    assert plan.objects, f"{ask!r}: refused as {plan.refusals}"
    texts = [str(o.get("text")) for o in plan.objects if o.get("text")]
    assert texts[-1].replace(" ", "") == last_line.replace(" ", ""), texts


def test_a_trailing_constant_is_the_learner_maths_not_their_sentence() -> None:
    """ "solve 2x + 3 = 7 pi" reads as 7π: nothing English follows, so the constant stays and the
    board draws the solution of exactly that equation. "C = 2 pi r" is written the same way."""
    from wobo_gateway.wobo import board_intents

    intents = board_intents("solve 2x + 3 = 7 pi")
    assert intents and intents[0]["equation"] == "2x + 3 = 7 pi"


def test_a_keyless_plan_that_would_draw_nothing_is_not_a_board_turn(
    auth, monkeypatch, tmp_path
) -> None:
    """board-6 end to end: the keyless plan spoke "Look at this. I'll draw it a piece at a time"
    and the route streamed it over ``ink=[]`` whenever the pipelines refused every object (a
    solution set the CAS cannot write down, a name the parser does not read).

    The plan is planned ONCE (docs/INK-FREEZE-PLAN-TRACE.md section 4: the double planning of
    silent turns goes). The route runs the pipelines, sees nothing survive, and falls to the
    spoken answer with the reasons on the ``done`` frame, instead of a promise over an empty board.
    """
    import json

    from fastapi.testclient import TestClient
    from wobo_gateway.app import build_gateway, create_app
    from wobo_gateway.wobo import _BOARD_SAY, mock_board_plan

    def payload(text: str) -> dict:
        return {"context": {"turn": {"lastUserInput": text, "recentTurns": []}}}

    # the keyless plan still reads the words as a derivation; what survives is the route's to see
    assert mock_board_plan(payload("solve sin(x) = 0 between 0 and pi"))["intents"]
    monkeypatch.setenv("LLM_MODE", "mock")
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    client = TestClient(create_app(build_gateway()))
    for ask in ("solve sin(x) = 0 between 0 and pi", "solve abs(x - 2) = 3 for me"):
        response = client.post(
            "/v1/capability/wobo.turn",
            json={"payload": payload(ask)},
            headers={"Accept": "text/event-stream", **auth()},
        )
        assert response.status_code == 200, response.text
        frames = [
            json.loads(block.split("data: ", 1)[1].splitlines()[0])
            for block in response.text.split("\n\n")
            if "data: " in block
        ]
        assert not any(isinstance(f.get("object"), dict) for f in frames), ask
        done = next(f for f in frames if "verified" in f)
        assert done["objects"] == 0 and done["refused"], ask
        said = " ".join(f["text"] for f in frames if "text" in f and "dur" in f)
        assert said and said not in set(_BOARD_SAY.values()), ask
    # and a plan that draws keeps its say
    plan = mock_board_plan(payload("solve 2x + 3 = 7"))
    assert plan is not None and plan["say"] == _BOARD_SAY["math"]


def test_a_word_glued_to_a_bracket_is_left_for_the_verifier_to_refuse() -> None:
    """``abs(x - 2) = 3`` is not something the CAS reads. Cutting ``abs`` off would draw the
    solution of a DIFFERENT equation; leaving it draws nothing and says why, which is the honest
    one of the two (the content-realness law)."""
    from wobo_gateway.wobo import board_intents

    intents = board_intents("solve abs(x - 2) = 3 for me")
    assert intents and intents[0]["equation"] == "abs(x - 2) = 3"


# --- wave 29, board-6: the silent floor is spoken over ink, never over an empty board -----------
def _board_plan_with_model_json(monkeypatch, text: str, ask: str) -> dict:
    import litellm
    from wobo_gateway.wobo import run_board_plan

    monkeypatch.setattr(litellm, "completion", lambda **_kw: _FakeResponse(text))
    plan, _tokens = run_board_plan(
        provider_model="anthropic/claude-sonnet-5",
        payload={"context": {"turn": {"lastUserInput": ask, "recentTurns": []}}},
    )
    return plan


def test_a_silent_plan_is_refused_never_floored(monkeypatch) -> None:
    """A silent plan used to get a floor sentence ("what I have put on the board") whatever the
    pipelines then made of it, so on a turn where every object was refused the learner heard
    Wobo claim a drawing that never appeared (wave 29, board-6). There is no floor now: a plan
    with no words is not a board turn (docs/INK-FREEZE-PLAN-TRACE.md section 3, Plan), whether
    or not its drawing would have survived, and the keyless twin answers in its place."""
    from wobo_gateway import wobo

    assert not hasattr(wobo, "SILENT_BOARD_SAY")
    unreadable = (
        '{"open": {"kind": "derivation", "intent": {"pipeline": "math", "op": "derivation", '
        '"equation": "x**2 - 5x + 6 = 0 and show me on the board how the factors work", '
        '"steps": []}}}'
    )
    assert not _board_plan_with_model_json(monkeypatch, unreadable, "hmm")
    assert not _board_plan_with_model_json(monkeypatch, '{"sentences": []}', "hmm")
    drawable = (
        '{"open": {"kind": "graph", "intent": {"pipeline": "math", "op": "graph", "expr": "x**2", '
        '"var": "x", "domain": [-3, 3]}}}'
    )
    assert not _board_plan_with_model_json(monkeypatch, drawable, "graph y = x^2")


# --- the fixer, wave 34: a truncated envelope is never read aloud ---------------------------------


def test_a_cut_off_json_envelope_with_no_say_is_never_spoken(monkeypatch) -> None:
    """Live on Luna, the fallback spoken answer for a Pythagoras ask was the model's raw JSON,
    cut at the token cap: the say frame carried '{"path":"visualization", "viz":{...', the voice
    read it aloud and the transcript printed it. JSON is never Wobo's line."""
    raw = '{"path":"visualization",\n "viz":{"kind":"diagram","concept":"Pythag'
    out = _turn_with_model_text(monkeypatch, raw)
    assert out["say"] == CANNED
    assert "{" not in out["say"] and "path" not in out["say"]


def test_a_cut_off_envelope_that_still_carries_its_say_speaks_the_say_only(monkeypatch) -> None:
    raw = '{"path":"inline", "say": "Start with the square on the longest side.", "actions": [{"ty'
    out = _turn_with_model_text(monkeypatch, raw)
    assert out["say"] == "Start with the square on the longest side."


# --- wave 46, finding 3: the keyless learner meets the same tutor --------------------------------


def _keyless(question: str, **context: object) -> dict:
    return wobo.mock_wobo_turn(
        {"context": {"turn": {"lastUserInput": question}, "curriculum": {}, **context}}
    )


def test_one_line_does_not_answer_nine_different_questions() -> None:
    """Finding 3, 2026-09-09. `_MOCK_SAY["inline"]` — "Which step feels shaky? Start there." —
    answered nine of the twenty-three course turns keyless: "which step is wrong here?" five
    times, "why does that step work?" twice, "show me why" twice, "fresh board" twice, the same
    words at 390 and at 1440 and in dark, naming nothing on the page and answering a different
    question every time. Live the same asks are answered honestly, so the learner without a key
    met a worse tutor than the one who pays.
    """
    asks = [
        "which step is wrong here?",
        "why does that step work?",
        "show me why",
        "fresh board",
    ]
    said = [_keyless(q)["say"] for q in asks]
    assert len(set(said)) == len(asks), dict(zip(asks, said, strict=True))
    for line in said:
        assert "Which step feels shaky? Start there." != line


def test_a_keyless_turn_that_cannot_see_the_working_says_so_and_asks_for_it() -> None:
    """Honesty (voice.md §6): say what we do not know. "Which step is wrong here?" over a page
    Wobo cannot read is not answered with a nudge that pretends to have read it."""
    say = _keyless("which step is wrong here?")["say"]
    assert "can't see" in say or "cannot see" in say, say
    assert "?" in say, say
    # and it never narrates itself or reads a mark back it did not make
    assert "I'll" in say or "I will" in say or "Type" in say, say


def test_the_keyless_line_carries_the_card_it_is_on_when_there_is_one() -> None:
    """Specific beats general (voice.md §4): the node is on the context, so it is in the line."""
    say = _keyless("why does that step work?", curriculum={"nodeName": "quadratic equations"})[
        "say"
    ]
    assert "quadratic equations" in say.lower(), say


# --- wave 46, finding 1: a pointer is not a subject, and no picture is invented -------------------


def test_draw_this_names_nothing_so_nothing_is_drawn() -> None:
    """Finding 1, 2026-09-09. "draw this for me" on a course card drew no board object at all.
    It became a VISUALIZATION whose concept was the word "this", served the generic seed diagram
    — two circles reading "idea" and "effect" with an arrow between them, at font-size 11 — and
    Wobo read it out as "This, left to right. Which part is new to you?". Two turns, unchanged
    since wave 44.

    INK-FOUR, Relevance at 4: *a question that names nothing on the glass gets no ink and a useful
    sentence instead.* "this" is a pointer, and a pointer with nothing under it names nothing.
    """
    for pointer in ("draw this for me", "draw it", "diagram this", "show me this"):
        out = _keyless(pointer)
        assert out["path"] == "inline", (pointer, out)
        assert "viz" not in out, (pointer, out.get("viz"))
        assert not out["say"].lower().startswith("this,"), (pointer, out["say"])
        assert "left to right" not in out["say"].lower(), (pointer, out["say"])
        assert out["say"].endswith("?") or "?" in out["say"], (pointer, out["say"])


def test_a_pointer_is_never_the_concept_a_drawing_is_captioned_with() -> None:
    from wobo_gateway.wobo import _concept_from, classify_intent

    for pointer in ("this", "it", "that", "these", "the thing", "this thing"):
        assert _concept_from(f"draw {pointer}", "") == "", pointer
        # with a card open, the card is the subject, never the pointer
        assert _concept_from(f"draw {pointer}", "quadratic equations") == "quadratic equations"
    # a real subject still survives untouched
    assert _concept_from("draw a triangle for me", "") == "triangle"
    assert classify_intent("draw a triangle for me")["viz"]["concept"] == "triangle"


def test_the_seed_diagram_never_invents_a_relationship() -> None:
    """The seed drew a cause and an effect for every concept there is: two named circles and an
    arrow from one to the other. That is a CLAIM, and it is true of nothing. A seed knows the
    concept's name and nothing else, so the name is all it may draw."""
    from wobo_gateway.plexus.engines import _seed_diagram

    svg = _seed_diagram("photosynthesis")
    assert "photosynthesis" in svg
    for invented in (">idea<", ">effect<", ">cause<", "polygon"):
        assert invented not in svg, invented
    # and nothing a learner reads is under the 12 px floor
    import re as _re

    sizes = [float(v) for v in _re.findall(r'font-size="([\d.]+)"', svg)]
    assert sizes and min(sizes) >= 12.0, sizes
