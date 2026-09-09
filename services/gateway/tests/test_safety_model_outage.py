"""What a provider outage costs a child, and what the moderation call is allowed to cost a turn.

FAIL-CLOSED IS RIGHT AND ITS PRICE WAS UNDERSTATED. ``fail_safe`` returns the family the rule
layer named, so during ANY provider wobble "what is the suicide rate in india, for civics" came
back ``category=crisis severity=high`` and the child got the full Childline script and a stopped
lesson. There was no circuit breaker and no cap: a one-hour outage meant every concern-adjacent
turn was answered that way, and at ``SAFETY_MODEL_SCOPE=all`` nearly every turn.

A single wobble still fails closed at the named family — that is the safe reading of one missing
answer. A SUSTAINED outage is a different fact about the world, and the product should say so
softly rather than tell a hundred children in a row that it is worried about them.

Separately: the policy says ``max_latency_ms=1500`` for ``safety.classify`` and the call used a
hardcoded 4.0 s default, so a safety adjudication could add two and a half seconds beyond its own
policy to the critical path of a child's question.
"""

from __future__ import annotations

from typing import Any

import pytest
from wobo_gateway import safety, safety_model
from wobo_gateway.safety_signals import CATEGORY_CRISIS, CATEGORY_MODERATION, screen

CIVICS = "what is the suicide rate in india, for civics"


@pytest.fixture(autouse=True)
def _breaker_reset() -> Any:
    """The breaker is process-global on purpose — one provider, one verdict about it. So it is
    reset on the way OUT as well as on the way in, or this file leaves the screen degraded for
    whatever runs next."""
    safety_model.reset_breaker()
    yield
    safety_model.reset_breaker()


class _Down:
    """A provider that is not answering, in every way a provider fails."""

    def __init__(self, exc: type[BaseException] = TimeoutError) -> None:
        self.calls = 0
        self._exc = exc

    def __call__(self, *_: Any, **__: Any) -> Any:
        self.calls += 1
        raise self._exc("down")


def _classifier(down: _Down) -> safety.LayeredClassifier:
    model = safety_model.ModelClassifier()
    model._call = down  # type: ignore[method-assign]
    return safety.LayeredClassifier(model=model, model_enabled=lambda: True)


def test_one_wobble_still_fails_closed() -> None:
    """A single missing answer means screen it. That has not changed and must not."""
    verdict = _classifier(_Down()).classify(CIVICS)
    assert verdict.flagged
    assert verdict.source == "fail_safe"


@pytest.mark.parametrize(
    "exc", [TimeoutError, ConnectionError, ValueError, RuntimeError, OSError]
)
def test_it_fails_closed_on_every_kind_of_failure(exc: type[BaseException]) -> None:
    assert _classifier(_Down(exc)).classify(CIVICS).flagged


def test_a_sustained_outage_stops_handing_out_the_crisis_script() -> None:
    """Past the breaker's threshold the answer is a soft one, not a helpline script."""
    down = _Down()
    clf = _classifier(down)
    for _ in range(safety_model.BREAKER_THRESHOLD):
        clf.classify(CIVICS)
    verdict = clf.classify(CIVICS)
    assert verdict.source == safety_model.SOURCE_OUTAGE
    assert verdict.category == CATEGORY_MODERATION, "a civics question got the crisis script"
    say = safety.screen_inbound(
        {"context": {"turn": {"lastUserInput": CIVICS}}},
        clf,
    )
    assert say is not None
    assert "Childline" not in say["say"]
    assert "1098" not in say["say"]
    assert say["say"] == safety.OUTAGE_SAY
    assert say["say"] != safety.MODERATION_SAY, "a civics question was told to keep it kind"


def test_an_open_breaker_stops_calling_the_provider_at_all() -> None:
    """A dead provider must not be called once per turn for an hour."""
    down = _Down()
    clf = _classifier(down)
    for _ in range(safety_model.BREAKER_THRESHOLD):
        clf.classify(CIVICS)
    calls = down.calls
    for i in range(10):
        clf.classify(f"{CIVICS} number {i}")
    assert down.calls == calls, "the provider was called while the breaker was open"


def test_the_rules_own_verdict_survives_an_outage() -> None:
    """The breaker softens only what the RULES did not settle. A disclosure is still a crisis."""
    down = _Down()
    clf = _classifier(down)
    for _ in range(safety_model.BREAKER_THRESHOLD + 2):
        clf.classify(CIVICS)
    assert clf.classify("my dad hits me").category == CATEGORY_CRISIS


def test_the_breaker_closes_again_when_the_provider_answers() -> None:
    model = safety_model.ModelClassifier()
    down = _Down()
    model._call = down  # type: ignore[method-assign]
    clf = safety.LayeredClassifier(model=model, model_enabled=lambda: True)
    for _ in range(safety_model.BREAKER_THRESHOLD):
        clf.classify(CIVICS)
    assert safety_model.breaker_open() is True

    safety_model.reset_breaker()
    model._call = lambda text: ("ok", "low")  # type: ignore[method-assign]
    assert clf.classify("a fresh civics question about suicide rates").category == "ok"
    assert safety_model.breaker_open() is False


# --- the latency policy the call is supposed to obey ------------------------------------------


def test_the_moderation_call_is_never_open_ended() -> None:
    """It has a deadline, and the deadline is bounded: past :data:`MAX_BUDGET_S` the offline layer
    is the better answer, because it is instant and it is already the floor under every verdict."""
    assert 0 < safety_model.timeout_s() <= safety_model.MAX_BUDGET_S


def test_an_explicit_timeout_still_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SAFETY_MODEL_TIMEOUT_S", "0.8")
    assert safety_model.timeout_s() == 0.8


# --- the fixer, wave 40: the screen's budget is the pace of the model that serves it ------------


def test_the_budget_fits_the_model_that_serves_the_screen() -> None:
    """Live on 2026-09-08 the policy's 1500 ms ran out on a model that answers in about four
    seconds, EVERY time: three doubt turns were screened as moderation, nothing was explained,
    and the child waited the full budget to be told "I couldn't check that one just now"."""
    primary, _fallbacks = safety_model._chain()
    assert safety_model.timeout_s() >= safety_model.pace_of(primary), (
        f"the screen has {safety_model.timeout_s()}s for a model that takes "
        f"{safety_model.pace_of(primary)}s: it can only ever fail closed"
    )
    # and it is still the policy's number when the policy asks for MORE than the model needs
    assert safety_model.timeout_s() >= safety_model._policy_timeout_s()


def test_a_model_slower_than_its_own_budget_still_screens_the_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The budget is not a promise the model keeps. One that overruns it is still fail-closed,
    still not written to the weather, and never the crisis script."""
    import litellm
    from wobo_gateway import health

    class Timeout(Exception):
        pass

    Timeout.__name__ = "Timeout"
    slept: list[float] = []

    def too_slow(**kw: Any) -> Any:
        slept.append(float(kw.get("timeout") or 0))
        raise Timeout("deadline")

    monkeypatch.setattr(litellm, "completion", too_slow)
    monkeypatch.setattr(health, "hang_streak", lambda: 1)
    primary, _fallbacks = safety_model._chain()
    verdict = safety_model.ModelClassifier().adjudicate(CIVICS, screen(CIVICS))
    assert verdict.category == CATEGORY_MODERATION
    assert verdict.source == safety_model.SOURCE_FAIL_SAFE
    assert health.provider_available(primary)
    assert slept and slept[0] >= safety_model.pace_of(primary) * 0.5, slept


def test_the_civics_question_is_a_candidate_and_not_a_rule_flag() -> None:
    """The premise of every test above: the rules do not settle it, so the model layer is asked."""
    outcome = screen(CIVICS)
    assert outcome.needs_model is True
    assert outcome.certain is False


# --- the fixer, wave 34: a short deadline is not the provider's weather ----------------------------


def test_a_moderation_timeout_under_its_own_short_deadline_never_marks_the_provider_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Live, the 1.5 s safety deadline ran out on a model that answers in about four seconds. The
    turn was screened (fail-closed, right) AND the provider was marked out for a minute, so the
    next two turns of a child's doubt ran on another model with no ink. A deadline the policy set
    below the model's own pace is a fact about the policy, never about the provider."""
    import litellm
    from wobo_gateway import health

    class Timeout(Exception):
        pass

    Timeout.__name__ = "Timeout"

    def slow(**_kw: Any) -> Any:
        raise Timeout("deadline")

    monkeypatch.setattr(litellm, "completion", slow)
    monkeypatch.setattr(health, "hang_streak", lambda: 1)
    health.reset() if hasattr(health, "reset") else None
    model = safety_model.ModelClassifier()
    primary, _fallbacks = safety_model._chain()
    outcome = screen(CIVICS)
    for _ in range(3):
        verdict = model.adjudicate(f"{CIVICS} {_}", outcome)
        assert verdict.category != safety.CATEGORY_OK  # still screened, fail-closed
    assert health.provider_available(primary), "a safety deadline marked the provider out"
