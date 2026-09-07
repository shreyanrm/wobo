"""The one place that talks to a model, and the fussiness it forgives.

A provider that refuses a sampling knob answers 400. On the PRIMARY that 400 sends the call
down the fallback chain, where the next model refuses the same field, and the learner is told
nothing at all. Proved in production on 2026-09-04. These tests hold the forgiveness narrow:
the refused knob is dropped and the call retried once, for THAT model; every other error is
raised as it came.

Since 2026-09-05 ``model_call`` walks the chain itself, one model per litellm call, so a rung's
refusal is seen rather than hidden behind the last rung's error. The tests that used to encode
the workarounds for litellm's opacity (a blind retry on any error from a chain) were rewritten
to the behaviour that replaced them; ``test_router_fallbacks.py`` holds the credit-skip half.
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
        if callable(step) and not isinstance(step, Exception):
            step = step()  # a step that takes time before it answers or fails
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


def test_a_400_that_names_nothing_gets_one_try_without_the_optional_knobs(fake) -> None:
    """litellm wraps some provider refusals in a message that does not repeat the field. One cheap
    attempt without the knobs, on the SAME model, tells a fussy model from a broken request."""

    class BadRequestError(Exception):
        pass

    f = fake([BadRequestError("OpenAIException - invalid request"), "answered"])
    assert model_call.complete(model="m", fallbacks=["n"], temperature=0.2) == "answered"
    assert len(f.calls) == 2 and "temperature" not in f.calls[1]
    assert f.calls[1]["model"] == "m", "the retry is on the model that objected, not the next rung"


def test_when_the_second_try_fails_too_the_first_error_is_what_we_report(fake) -> None:
    """The learner's log should name the real problem, not the shadow of our own retry."""

    class BadRequestError(Exception):
        pass

    f = fake([BadRequestError("invalid request shape"), BadRequestError("still invalid")])
    with pytest.raises(Exception, match="invalid request shape"):
        model_call.complete(model="m", temperature=0.2)
    assert len(f.calls) == 2


def test_a_credit_refusal_is_never_retried_on_the_same_model(fake) -> None:
    """An empty balance is not a fussy knob. Asking again costs a round trip and answers nothing."""

    class BadRequestError(Exception):
        pass

    f = fake([BadRequestError("AnthropicException - Your credit balance is too low")])
    with pytest.raises(BadRequestError):
        model_call.complete(model="m", temperature=0.2)
    assert len(f.calls) == 1


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


def test_a_knob_is_pruned_for_the_model_that_refuses_it_and_kept_for_the_rest(
    fake, monkeypatch
) -> None:
    """The PRIMARY takes temperature, a FALLBACK does not. Each rung gets its own kwargs now, so
    the primary keeps its sampling and only the fussy rung goes without, checked up front."""
    f = fake([Exception("503 ServiceUnavailableError"), "answered"])
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
    assert len(f.calls) == 2
    assert f.calls[0]["temperature"] == 0.2, "the willing primary keeps its knob"
    assert "temperature" not in f.calls[1] and f.calls[1]["max_tokens"] == 220


def test_a_chain_that_all_accepts_the_knob_keeps_it(fake, monkeypatch) -> None:
    f = fake(["answered"])
    import litellm as installed

    monkeypatch.setattr(
        installed, "get_supported_openai_params", lambda model: ["temperature"], raising=False
    )
    model_call.complete(model="a", fallbacks=["b"], temperature=0.2)
    assert f.calls[0]["temperature"] == 0.2


def test_a_middle_rungs_refusal_is_seen_not_hidden(fake) -> None:
    """The third-provider case, found live on 2026-09-05.

    The chain is three models deep. The middle one refuses ``temperature``; under litellm's own
    fallback runner that refusal was swallowed and only the LAST rung's error (a Gemini
    authentication line) ever reached us, so nothing could act on it. Every live board plan in the
    gateway failed that way, ``board_plan_for`` swallowed the failure exactly as designed, and the
    learner got the KEYLESS keyword board with one of four canned sentences over it.

    Walking the chain ourselves, the middle rung's refusal is the error in hand: that rung is
    retried once without the knob, and the last rung is never needed.
    """
    refusal = Exception("Unsupported value: 'temperature' does not support 0.2 with this model")
    f = fake([Exception("500 InternalServerError: terra is having a day"), refusal, "answered"])
    out = model_call.complete(
        model="openai/terra",
        fallbacks=["anthropic/opus", "gemini/flash"],
        temperature=0.2,
        max_tokens=900,
    )
    assert out == "answered"
    assert [c["model"] for c in f.calls] == ["openai/terra", "anthropic/opus", "anthropic/opus"]
    assert "temperature" not in f.calls[2] and f.calls[2]["max_tokens"] == 900


def test_a_timeout_on_the_primary_moves_the_chain_on_inside_the_one_deadline(fake) -> None:
    """The clock is not a hidden knob refusal: the timed-out rung is never retried. But it is
    not the end of the chain either (it was, until 2026-09-07: "a chain does not buy a second
    clock" stopped the walk, and a hanging primary was a total outage with two healthy providers
    idle). The primary gets half of the deadline, the next rung gets what is left, and the whole
    walk stays inside the ``timeout`` the caller set; the client's own deadline
    (``packages/sdk/src/gateway.ts``) is 65s for a 60s turn."""
    f = fake([TimeoutError("Request timed out after 30s"), "answered by the next rung"])
    out = model_call.complete(
        model="openai/terra",
        fallbacks=["anthropic/opus", "gemini/flash"],
        temperature=0.7,
        timeout=60.0,
    )
    assert out == "answered by the next rung"
    assert [c["model"] for c in f.calls] == ["openai/terra", "anthropic/opus"]
    assert f.calls[0]["timeout"] == pytest.approx(30.0), "half, with two rungs behind it"
    assert 0 < f.calls[1]["timeout"] <= 30.0, "the rest, never a fresh clock"


def test_the_next_rung_only_gets_time_left_inside_the_deadline(fake) -> None:
    """A fallback that outlives the caller's ceiling is worse than no fallback at all."""

    import time

    class Down(Exception):
        pass

    def slow() -> Exception:
        """The primary spends most of the deadline before it falls over."""
        time.sleep(0.85)
        return Down("APIConnectionError: authentication")

    f = fake([slow, "answered by the next rung"])
    with pytest.raises(Down):
        model_call.complete(
            model="openai/terra", fallbacks=["anthropic/opus"], temperature=0.2, timeout=1.0
        )
    assert len(f.calls) == 1, "there was no room left in the deadline for a second rung"

    f = fake([Down("APIConnectionError: authentication"), "answered by the next rung"])
    assert (
        model_call.complete(
            model="openai/terra", fallbacks=["anthropic/opus"], temperature=0.2, timeout=60.0
        )
        == "answered by the next rung"
    )
    assert len(f.calls) == 2 and f.calls[1]["model"] == "anthropic/opus"
    assert f.calls[1]["temperature"] == 0.2, "a rung that takes the knob keeps it"
    assert f.calls[1]["timeout"] < 60.0, "the next rung inherits what is left, not a fresh 60s"


def test_a_single_model_that_simply_fell_over_is_still_raised_as_it_came(fake) -> None:
    """The broadening above is bounded by the fallback chain, and only by it.

    With ONE model in play, the error we were handed IS the whole story, so a timeout stays a
    timeout and an ailing provider is not asked twice.
    """
    f = fake([TimeoutError("Request timed out after 30s")])
    with pytest.raises(TimeoutError):
        model_call.complete(model="openai/terra", temperature=0.2)
    assert len(f.calls) == 1
