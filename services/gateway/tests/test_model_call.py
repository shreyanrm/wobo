"""The one place that talks to a model, and the fussiness it forgives.

A provider that refuses a sampling knob answers 400. On the PRIMARY that 400 sends the call
down the fallback chain, where the next model refuses the same field, and the learner is told
nothing at all. Proved in production on 2026-09-04. These tests hold the forgiveness narrow:
the refused knob is dropped and the call retried once; every other error is raised as it came.
"""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest
from wobo_gateway import model_call


class _Fake:
    """A stand-in for the litellm module: records calls, answers from a script."""

    def __init__(self, script: list[Any]) -> None:
        self.script = script
        self.calls: list[dict[str, Any]] = []
        self.drop_params = False

    def completion(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch):
    def _install(script: list[Any]) -> _Fake:
        f = _Fake(script)
        module = types.ModuleType("litellm")
        module.completion = f.completion  # type: ignore[attr-defined]
        module.drop_params = False  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "litellm", module)
        return f

    return _install


def test_a_call_the_provider_accepts_goes_once(fake) -> None:
    f = fake(["answered"])
    assert model_call.complete(model="m", temperature=0.2) == "answered"
    assert len(f.calls) == 1
    assert f.calls[0]["temperature"] == 0.2


def test_a_refused_temperature_is_dropped_and_the_call_retried(fake) -> None:
    """The exact production message, and the exact recovery a learner needed."""
    refusal = Exception(
        "litellm.BadRequestError: OpenAIException - Unsupported value: 'temperature' does not "
        "support 0.2 with this model. Only the default (1) value is supported."
    )
    f = fake([refusal, "answered without it"])
    assert model_call.complete(model="m", temperature=0.2, max_tokens=220) == "answered without it"
    assert len(f.calls) == 2
    assert "temperature" not in f.calls[1]
    assert f.calls[1]["max_tokens"] == 220, "only the refused knob goes; the rest is untouched"


def test_a_refused_top_p_is_dropped_too(fake) -> None:
    f = fake([Exception("400: top_p is not supported with this model"), "ok"])
    assert model_call.complete(model="m", top_p=0.9) == "ok"
    assert "top_p" not in f.calls[1]


def test_a_failure_that_is_not_a_bad_request_is_raised_as_it_came(fake) -> None:
    """A timeout or a 5xx is the truth, and retrying it would lean on an ailing provider."""
    down = TimeoutError("Request timed out after 30s")
    f = fake([down])
    with pytest.raises(TimeoutError):
        model_call.complete(model="m", temperature=0.2)
    assert len(f.calls) == 1, "a real failure is never retried here"


def test_a_bad_request_gets_one_try_without_the_optional_knobs(fake) -> None:
    """The production shape again: litellm raises the LAST fallback's error, so the refusal that
    actually broke the chain is invisible. One cheap attempt without the knobs tells them apart."""

    class BadRequestError(Exception):
        pass

    f = fake([BadRequestError("AnthropicException - credit balance is too low"), "answered"])
    assert model_call.complete(model="m", fallbacks=["n"], temperature=0.2) == "answered"
    assert len(f.calls) == 2 and "temperature" not in f.calls[1]


def test_when_the_second_try_fails_too_the_first_error_is_what_we_report(fake) -> None:
    """The learner's log should name the real problem, not the shadow of our own retry."""

    class BadRequestError(Exception):
        pass

    f = fake([BadRequestError("credit balance is too low"), BadRequestError("still no credit")])
    with pytest.raises(Exception, match="credit balance is too low"):
        model_call.complete(model="m", temperature=0.2)
    assert len(f.calls) == 2


def test_a_400_that_merely_mentions_temperature_in_passing_is_not_swallowed(fake) -> None:
    """The word alone is not consent to retry: the provider has to be refusing the field."""
    f = fake([Exception("the prompt discusses temperature in a physics lesson")])
    with pytest.raises(Exception, match="physics lesson"):
        model_call.complete(model="m", temperature=0.2)
    assert len(f.calls) == 1


def test_a_second_refusal_is_not_retried_again(fake) -> None:
    """One retry, never a loop: a provider that refuses twice is telling us something else."""
    refusal = Exception("Unsupported value: 'temperature' does not support 0.2 with this model")
    f = fake([refusal, refusal])
    with pytest.raises(Exception, match="Unsupported value"):
        model_call.complete(model="m", temperature=0.2)
    assert len(f.calls) == 2

def test_a_knob_the_chain_refuses_is_dropped_before_the_call(fake, monkeypatch) -> None:
    """The production shape: the PRIMARY takes temperature, a FALLBACK does not, and litellm
    reuses one set of kwargs for both. Checked up front, the call never fails at all."""
    f = fake(["answered"])
    import litellm as installed  # the fake the fixture just put in sys.modules

    monkeypatch.setattr(
        installed,
        "get_supported_openai_params",
        lambda model: ["max_tokens"] if "fussy" in model else ["max_tokens", "temperature"],
        raising=False,
    )
    out = model_call.complete(
        model="openai/willing", fallbacks=["openai/fussy"], temperature=0.2, max_tokens=220
    )
    assert out == "answered"
    assert len(f.calls) == 1, "no failure, so no retry"
    assert "temperature" not in f.calls[0]
    assert f.calls[0]["max_tokens"] == 220


def test_a_chain_that_all_accepts_the_knob_keeps_it(fake, monkeypatch) -> None:
    f = fake(["answered"])
    import litellm as installed

    monkeypatch.setattr(
        installed, "get_supported_openai_params", lambda model: ["temperature"], raising=False
    )
    model_call.complete(model="a", fallbacks=["b"], temperature=0.2)
    assert f.calls[0]["temperature"] == 0.2


def test_a_chain_whose_last_error_hides_a_middle_refusal_still_retries(fake) -> None:
    """The third-provider case, found live on 2026-09-05.

    The chain is three models deep now (``routing``: "A THIRD provider on every text chain"). The
    middle one refuses ``temperature``; the LAST one fails for an unrelated reason — a bad key, an
    empty balance — and litellm raises only that one. So the error we are handed is an
    ``APIConnectionError`` about a provider that never had an opinion about the knob, and the
    heuristics above see nothing to act on.

    What it cost: every live board plan in the gateway failed, ``board_plan_for`` swallowed the
    failure exactly as it is designed to, and the learner got the KEYLESS keyword board with one of
    four canned sentences over it. A board nobody planned, served as though somebody had.

    The rule this test fixes in place: when the call carried an optional knob AND there was a
    fallback chain, the error we were handed provably does not speak for the models it did not come
    from, so one attempt without the knobs is owed before the failure is reported.
    """
    hidden = Exception(
        "litellm.APIConnectionError: litellm.AuthenticationError: GeminiException - "
        '{"error": {"code": 401, "message": "Request had invalid authentication credentials."}}'
    )
    f = fake([hidden, "answered without it"])
    out = model_call.complete(
        model="openai/terra",
        fallbacks=["anthropic/opus", "gemini/flash"],
        temperature=0.2,
        max_tokens=900,
    )
    assert out == "answered without it"
    assert len(f.calls) == 2
    assert "temperature" not in f.calls[1]
    assert f.calls[1]["max_tokens"] == 900


def test_a_timeout_in_a_chain_is_still_a_timeout(fake) -> None:
    """The clock is not a hidden knob refusal, and a second pass down the chain doubles it.

    ``timeout=timeout_for(...)`` bounds each call at 60s for a turn; the client's own deadline
    (``packages/sdk/src/gateway.ts``) is 65s. Retrying a timed-out chain made the worst case 120s,
    so the learner was shown "that one is taking longer than it should" while the gateway was
    still working, and the owner paid for the second call anyway.
    """
    f = fake([TimeoutError("Request timed out after 60s")])
    with pytest.raises(TimeoutError):
        model_call.complete(
            model="openai/terra", fallbacks=["anthropic/opus", "gemini/flash"], temperature=0.7
        )
    assert len(f.calls) == 1, "a chain does not buy a timeout a second pass"


def test_the_blind_retry_only_uses_time_left_inside_the_deadline(fake) -> None:
    """A retry that outlives the caller's ceiling is worse than no retry at all."""

    class Hidden(Exception):
        pass

    f = fake([Hidden("APIConnectionError: authentication"), "answered without it"])
    with pytest.raises(Hidden):
        model_call.complete(
            model="openai/terra", fallbacks=["anthropic/opus"], temperature=0.2, timeout=1.0
        )
    assert len(f.calls) == 1, "there was no room left in the deadline for a second attempt"

    f = fake([Hidden("APIConnectionError: authentication"), "answered without it"])
    assert (
        model_call.complete(
            model="openai/terra", fallbacks=["anthropic/opus"], temperature=0.2, timeout=60.0
        )
        == "answered without it"
    )
    assert len(f.calls) == 2 and "temperature" not in f.calls[1]
    assert f.calls[1]["timeout"] < 60.0, "the retry inherits what is left, not a fresh 60 seconds"


def test_a_single_model_that_simply_fell_over_is_still_raised_as_it_came(fake) -> None:
    """The broadening above is bounded by the fallback chain, and only by it.

    With ONE model in play, the error we were handed IS the whole story, so a timeout stays a
    timeout and an ailing provider is not asked twice.
    """
    f = fake([TimeoutError("Request timed out after 30s")])
    with pytest.raises(TimeoutError):
        model_call.complete(model="openai/terra", temperature=0.2)
    assert len(f.calls) == 1
