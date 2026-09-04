"""The child-safety seam (WOBO.md §11). Mock mode only — no model is ever called.

The screen's own probe set — every phrasing the 2026-09-04 conformance register found it missing
and every piece of schoolwork it found it refusing — lives in ``test_safety_probes.py``.

Inbound: a crisis message never reaches a provider; Wobo answers with the calm supportive
line that routes to a responsible adult and real helplines. A moderation hit gets a warm
redirect. Outbound: a flagged model reply is replaced, never served. The classifier is a
seam — anything implementing SafetyClassifier drops in.
"""

from __future__ import annotations

from typing import Any

from wobo_gateway.app import CapabilityRequest, Gateway
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider, ProviderResponse
from wobo_gateway.registry import ConsentTier
from wobo_gateway.safety import (
    CRISIS_SAY,
    MODERATION_SAY,
    OUTBOUND_REPLACEMENT_SAY,
    RuleClassifier,
    SafetyVerdict,
    moderate,
    screen_wobo_inbound,
    screen_wobo_outbound,
)
from wobo_gateway.telemetry import MetricsSink


def make_gateway(provider: Any | None = None, classifier: Any | None = None) -> Gateway:
    kwargs: dict[str, Any] = {}
    if classifier is not None:
        kwargs["classifier"] = classifier
    return Gateway(provider or MockProvider(), InMemoryCache(), MetricsSink(), **kwargs)


def wobo_req(text: str) -> CapabilityRequest:
    return CapabilityRequest(
        consent_tier=ConsentTier.UN_ELEVATED,
        payload={"context": {"turn": {"lastUserInput": text, "recentTurns": []}}},
    )


# --- the classifier ---------------------------------------------------------------------


def test_classifier_detects_crisis_language() -> None:
    v = RuleClassifier().classify("sometimes I just want to die")
    assert v.category == "crisis"
    assert v.severity == "high"
    assert v.flagged


def test_classifier_detects_moderation_terms_on_word_boundaries() -> None:
    assert RuleClassifier().classify("this is fucking hard").category == "moderation"
    # "assess" must never trip a substring match
    assert RuleClassifier().classify("please assess my work").category == "ok"


def test_classifier_passes_ordinary_learning_talk() -> None:
    v = RuleClassifier().classify("why does x move to the other side of the equation")
    assert v.category == "ok"
    assert not v.flagged


# --- inbound: crisis never reaches a model ----------------------------------------------


def test_crisis_inbound_is_met_with_support_and_helplines() -> None:
    resp = make_gateway().invoke("wobo.turn", wobo_req("I want to kill myself"))
    assert resp.model == "safety.gate"
    assert resp.tokens == 0  # no model was called
    assert resp.output["say"] == CRISIS_SAY
    assert "1098" in resp.output["say"] and "14416" in resp.output["say"]
    assert resp.output["handed_answer"] is False
    safety = resp.output["safety"]
    assert safety["flagged"] is True
    assert safety["category"] == "crisis"
    assert safety["severity"] == "high"
    assert safety["action"] == "supported"
    # A real route to a real adult travels WITH the verdict, as data a surface can render.
    assert [e["number"] for e in safety["support"]] == ["1098", "14416"]
    # And nothing claims a guardian was told, because nothing tells one. See _safety_block.
    assert "escalated_to" not in safety


def test_moderation_inbound_is_redirected_warmly() -> None:
    resp = make_gateway().invoke("wobo.turn", wobo_req("you are a stupid bitch"))
    assert resp.model == "safety.gate"
    assert resp.output["say"] == MODERATION_SAY
    assert resp.output["safety"]["category"] == "moderation"
    assert resp.output["safety"]["action"] == "blocked"


def test_clean_turn_reaches_the_provider() -> None:
    resp = make_gateway().invoke("wobo.turn", wobo_req("can you check my working"))
    assert resp.model != "safety.gate"
    assert "safety" not in resp.output
    assert resp.tokens > 0


def test_inbound_screen_reads_the_recent_window_too() -> None:
    payload = {
        "context": {
            "turn": {
                "lastUserInput": "and my maths homework",
                "recentTurns": [{"role": "user", "text": "I keep thinking about self harm"}],
            }
        }
    }
    gated = screen_wobo_inbound(payload)
    assert gated is not None
    assert gated["safety"]["category"] == "crisis"


# --- outbound: a flagged reply is replaced, never served --------------------------------


class _FoulProvider:
    def complete(
        self,
        *,
        provider_model: str,
        capability: str,
        payload: dict[str, Any],
        fallbacks: tuple[str, ...] = (),
        **_: Any,
    ) -> ProviderResponse:
        return ProviderResponse(
            output={"say": "that answer is shit", "actions": [{"type": "point", "targetId": "x"}]},
            tokens=7,
        )


def test_outbound_flagged_say_is_replaced() -> None:
    resp = make_gateway(provider=_FoulProvider()).invoke("wobo.turn", wobo_req("help me"))
    assert resp.output["say"] == OUTBOUND_REPLACEMENT_SAY
    assert resp.output["actions"] == []
    assert resp.output["safety"]["action"] == "blocked"


def test_outbound_clean_say_passes_untouched() -> None:
    out = {"say": "look at the step where you moved the 3", "actions": []}
    assert screen_wobo_outbound(out) is out


# --- the safety.moderate capability ------------------------------------------------------


def test_safety_moderate_runs_the_real_classifier() -> None:
    gw = make_gateway()
    bad = gw.invoke(
        "safety.moderate",
        CapabilityRequest(consent_tier=ConsentTier.UN_ELEVATED, payload={"text": "send nudes"}),
    )
    assert bad.model == "safety.screen"
    assert bad.output["allow"] is False
    assert bad.output["categories"] == ["moderation"]

    ok = gw.invoke(
        "safety.moderate",
        CapabilityRequest(
            consent_tier=ConsentTier.UN_ELEVATED, payload={"text": "teach me fractions"}
        ),
    )
    assert ok.output["allow"] is True
    assert ok.output["categories"] == []


def test_moderate_marks_crisis() -> None:
    out = moderate("I want to hurt myself")
    assert out["allow"] is False
    assert out["crisis"] is True
    assert out["categories"] == ["crisis"]


# --- the seam: any classifier drops in ---------------------------------------------------


class _FlagEverything:
    def classify(self, text: str) -> SafetyVerdict:
        return SafetyVerdict(category="moderation", severity="low")


def test_classifier_seam_is_injectable() -> None:
    resp = make_gateway(classifier=_FlagEverything()).invoke(
        "wobo.turn", wobo_req("a perfectly innocent question")
    )
    assert resp.model == "safety.gate"
    assert resp.output["safety"]["category"] == "moderation"


# --- the boundary: the screen belongs to the SURFACE, not to one capability ---------------


def test_the_crisis_screen_covers_every_learner_facing_capability() -> None:
    """Sweep regression: the screen used to be a ``capability == "wobo.turn"`` special case, so
    the very same sentence typed into a tutor turn, a course request or an engine concept
    reached a frontier model unscreened. Every learner-facing capability now gates."""
    from wobo_gateway.safety import LEARNER_FACING_CAPABILITIES

    gw = make_gateway()
    resp = gw.invoke("tutor.turn", wobo_req("I want to kill myself"))
    assert resp.model == "safety.gate"
    assert resp.output["say"] == CRISIS_SAY
    assert resp.output["safety"]["category"] == "crisis"
    assert "escalated_to" not in resp.output["safety"]

    # the flat-payload capabilities: the learner's words are the concept, not a context block
    course = gw.invoke(
        "generate.course",
        CapabilityRequest(
            consent_tier=ConsentTier.UN_ELEVATED,
            payload={"topic": "how to end my life", "difficulty": "core"},
        ),
    )
    assert course.model == "safety.gate"
    assert course.output["safety"]["category"] == "crisis"

    # and the set is stated, not assumed
    assert "wobo.turn" in LEARNER_FACING_CAPABILITIES
    assert "tutor.turn" in LEARNER_FACING_CAPABILITIES
    assert "engine.compose" in LEARNER_FACING_CAPABILITIES
    # a guardian is not the child: gating an adult with the child's crisis copy would be wrong
    assert "parent.companion.turn" not in LEARNER_FACING_CAPABILITIES


def test_a_non_learner_facing_capability_is_not_gated() -> None:
    """The boundary cuts both ways: safety.moderate must classify the text, never refuse it."""
    resp = make_gateway().invoke(
        "safety.moderate",
        CapabilityRequest(
            consent_tier=ConsentTier.UN_ELEVATED, payload={"text": "I want to kill myself"}
        ),
    )
    assert resp.model == "safety.screen"
    assert resp.output["crisis"] is True


def test_inbound_screen_reads_every_field_the_prompt_builder_reads() -> None:
    """Sweep regression: ``inbound_text`` enumerated two keys by hand while
    ``_build_user_prompt`` interpolated a dozen, so a crisis line typed into a canvas step, a
    target label or a remembered fact walked straight past the screen."""
    from wobo_gateway.safety import screen_inbound

    for context in (
        {"canvas": {"equation": "I want to die", "steps": []}},
        {"canvas": {"steps": ["2x = 4", "no reason to live"]}},
        {"targets": [{"id": "t1", "kind": "step", "label": "I want to hurt myself"}]},
        {"page": {"state": {"note": "she said she wants to end my life"}}},
        {"lifetime": {"facts": ["told me they think about self harm"]}},
    ):
        gated = screen_inbound({"context": context})
        assert gated is not None, context
        assert gated["safety"]["category"] == "crisis", context


def test_outbound_screen_covers_action_text_and_the_viz_caption() -> None:
    """Sweep regression: only ``say`` was screened, so the model could put anything it liked on
    the page itself — a written note, a spoken line, a diagram caption."""
    from wobo_gateway.safety import screen_outbound

    clean_say = "look at the step where you moved the 3"
    for output in (
        {"say": clean_say, "actions": [{"type": "write", "targetId": "x", "text": "you are shit"}]},
        {"say": clean_say, "actions": [{"type": "speak", "text": "send nudes"}]},
        {
            "say": clean_say,
            "actions": [],
            "viz": {"kind": "diagram", "spec": {"svg": "<svg/>", "caption": "porn"}},
        },
    ):
        screened = screen_outbound(output)
        assert screened["say"] == OUTBOUND_REPLACEMENT_SAY, output
        assert screened["actions"] == []
        assert screened["safety"]["action"] == "blocked"
