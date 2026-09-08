"""The adversary: kill each provider, then two, then all three, and watch what the learner gets.

Every test here runs the REAL seams (``model_call``, the safety screen, the doubt reader, the
text-to-speech and image seams, the board planner, the capability route) against a fake litellm
and a fake ``urlopen`` that kill a provider the way the vendors actually kill one:

* ``credit``  the account is empty (Anthropic's 400 "credit balance is too low", OpenAI's 429
              ``insufficient_quota``, Gemini's 429 ``RESOURCE_EXHAUSTED``);
* ``5xx``     the provider is falling over (a 503);
* ``auth``    the key is rejected (a 401), which is the live state of the Google key on this
              machine on 2026-09-07;
* ``hang``    the provider never answers and the client's deadline fires;
* ``conn``    the network is gone.

The fake adds a configurable round trip per provider so the latency a fallback costs can be
MEASURED rather than asserted from the docstring. Nothing here touches a network or a key.

The defects this pass found on 2026-09-07 were fixed the same day. The tests that recorded
"today's shape" now assert the fixed shape, each proven to fail without its change: a hanging
primary hands the rest of the deadline to the next rung and is marked out after two hangs; a 503
storm, a revoked key or a dead route marks a provider out after a short streak; the media seams
consult and feed the same marks; a Claude 4.7-or-later rung is never sent a sampling knob; a
total outage answers in Wobo's own line; a spoken line nobody spoke is given back; the spend
figures name who answered; the content scripts ride the funnel.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import chain_fakes as fakes
import pytest
from wobo_gateway import health, model_call
from wobo_gateway.routing import CATALOGUE, Tier, provider_of, tier_chain

SRC = Path(__file__).resolve().parents[1] / "src" / "wobo_gateway"
TEXT_TIERS = (Tier.TINY, Tier.TURN, Tier.GENERATE, Tier.REASON, Tier.VERIFY)
PROVIDERS = ("openai", "anthropic", "gemini")
GOOGLE_HOST = "generativelanguage.googleapis.com"
OPENAI_HOST = "api.openai.com"
CIVICS = "what is the suicide rate in india, for civics"
SAFETY_OK = '{"category": "ok", "severity": "low"}'
PAGE = json.dumps(
    {
        "subject": "maths",
        "topic": "fractions",
        "question": "",
        "lines": [{"text": "1/2 + 1/4", "box": [0.1, 0.1, 0.9, 0.3]}],
    }
)


# --- the ways a provider dies ---------------------------------------------------------------------


class _Refusal(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


class Timeout(Exception):
    """litellm's ``Timeout``: ``model_call._out_of_time`` reads the type NAME."""


class APIConnectionError(Exception):
    """litellm's connection fault."""


def _failure(how: str, provider: str, call: dict[str, Any]) -> Exception:
    if how == "credit":
        return {
            "openai": _Refusal(
                "RateLimitError: OpenAIException - insufficient_quota: You exceeded your current "
                "quota (credit_balance_exhausted)",
                429,
            ),
            "anthropic": _Refusal(
                "BadRequestError: AnthropicException - Your credit balance is too low to access "
                "the Anthropic API. Please go to Plans & Billing",
                400,
            ),
            "gemini": _Refusal(
                "RateLimitError: RESOURCE_EXHAUSTED: You exceeded your current quota", 429
            ),
        }[provider]
    if how == "5xx":
        return _Refusal(f"ServiceUnavailableError: {provider} 503 overloaded", 503)
    if how == "auth":
        return _Refusal(f"AuthenticationError: {provider} 401 UNAUTHENTICATED", 401)
    if how == "hang":
        return Timeout(f"Timeout: {provider} request timed out")
    if how == "conn":
        return APIConnectionError(f"APIConnectionError: connection to {provider} refused")
    raise AssertionError(how)


class Kill:
    """A litellm whose providers are dead in a named way, with a round trip per provider."""

    def __init__(
        self,
        *,
        dead: dict[str, str],
        answer: str | Callable[[str], str] = "ok",
        rtt: dict[str, float] | None = None,
        knob_refusers: tuple[str, ...] = (),
    ) -> None:
        self.dead = dict(dead)
        self.answer = answer
        self.rtt = rtt or {}
        #: Providers whose models answer 400 to a non-default ``temperature`` and only then
        #: answer without it (Anthropic's deprecations page, read 2026-09-07: Claude 4.7 and
        #: later return 400 to a non-default temperature/top_p/top_k).
        self.knob_refusers = knob_refusers
        self.calls: list[dict[str, Any]] = []
        self.drop_params = False

    def completion(self, **kwargs: Any) -> Any:
        model = str(kwargs["model"])
        provider = provider_of(model)
        self.calls.append(kwargs)
        wait = self.rtt.get(provider, 0.0)
        if wait:
            time.sleep(wait)
        how = self.dead.get(provider)
        if how is not None:
            raise _failure(how, provider, kwargs)
        if provider in self.knob_refusers and "temperature" in kwargs:
            raise _Refusal(
                "BadRequestError: AnthropicException - temperature: Unsupported value; this model "
                "does not support a non-default temperature",
                400,
            )
        text = self.answer(model) if callable(self.answer) else self.answer
        return fakes.Response(text, model)

    @staticmethod
    def completion_cost(**_: Any) -> float:
        return 0.001

    def install(self, monkeypatch: pytest.MonkeyPatch) -> Kill:
        import sys
        import types

        module = types.ModuleType("litellm")
        module.completion = self.completion  # type: ignore[attr-defined]
        module.completion_cost = self.completion_cost  # type: ignore[attr-defined]
        module.drop_params = False  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "litellm", module)
        return self

    def calls_to(self, provider: str) -> list[dict[str, Any]]:
        return [c for c in self.calls if provider_of(str(c["model"])) == provider]

    @property
    def served(self) -> str | None:
        return str(self.calls[-1]["model"]) if self.calls else None


def kill(monkeypatch: pytest.MonkeyPatch, *providers: str, how: str = "credit", **kw: Any) -> Kill:
    return Kill(dead=dict.fromkeys(providers, how), **kw).install(monkeypatch)


def _keys(monkeypatch: pytest.MonkeyPatch, *, google: bool = True, openai: bool = True) -> None:
    for name in ("GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    if google:
        monkeypatch.setenv("GOOGLE_AI_API_KEY", "not-a-real-google-key")
    if openai:
        monkeypatch.setenv("OPENAI_API_KEY", "not-a-real-openai-key")


#: What each vendor's HTTP refusal says in its body, per the error pages ``model_call`` reads.
_HTTP_BODIES = {
    ("google", 429): "RESOURCE_EXHAUSTED: You exceeded your current quota",
    ("openai", 429): '{"error": {"type": "insufficient_quota", "code": "credit_balance_exhausted"}}'
    "",
    ("google", 401): "UNAUTHENTICATED: API key not valid",
    ("openai", 401): "Incorrect API key provided",
}


def _dead(url: str, vendor: str, how: str) -> Exception:
    if how == "hang":
        return TimeoutError("timed out")
    if how == "conn":
        import urllib.error

        return urllib.error.URLError("connection refused")
    code = int(how)
    return fakes.http_error(url, code, _HTTP_BODIES.get((vendor, code), "dead"))


def _http(monkeypatch: pytest.MonkeyPatch, *, google: str, openai: str) -> fakes.HttpFake:
    """The raw HTTPS seams (voice, image), each vendor ``up`` | ``hang`` | ``conn`` | a status."""
    http = fakes.HttpFake().install(monkeypatch)

    def google_handler(req: Any) -> Any:
        if google == "up":
            return (
                fakes.gemini_image(fakes.png_bytes())
                if ":generateContent" in req.full_url and "image" in req.full_url
                else fakes.gemini_audio(1.0)
            )
        raise _dead(req.full_url, "google", google)

    def openai_handler(req: Any) -> Any:
        if openai == "up":
            if "/images/" in req.full_url:
                import base64

                return {"data": [{"b64_json": base64.b64encode(fakes.png_bytes()).decode()}]}
            return fakes.wav_bytes(1.0, streamed=True)
        raise _dead(req.full_url, "openai", openai)

    http.on(GOOGLE_HOST, google_handler)
    http.on(OPENAI_HOST, openai_handler)
    return http


def _screen() -> Any:
    from wobo_gateway import safety, safety_model

    return safety.LayeredClassifier(
        model=safety_model.ModelClassifier(), model_enabled=lambda: True
    )


def _complete_tier(tier: Tier, **extra: Any) -> Any:
    primary, *rest = tier_chain(tier)
    return model_call.complete(
        model=primary, fallbacks=rest or None, messages=[], timeout=60.0, **extra
    )


def _survivor(tier: Tier, dead: set[str]) -> str:
    return next(m for m in tier_chain(tier) if provider_of(m) not in dead)


# =================================================================================================
# 1. Kill OpenAI: the primary of every text tier and of the safety screen
# =================================================================================================


@pytest.mark.parametrize("how", ["credit", "5xx", "auth", "conn"])
def test_kill_openai_every_text_tier_answers_on_anthropic_then_gemini(
    monkeypatch: pytest.MonkeyPatch, how: str
) -> None:
    lite = kill(monkeypatch, "openai", how=how)
    for tier in TEXT_TIERS:
        out = _complete_tier(tier)
        assert provider_of(out.served_model) == "anthropic", (tier, how)
    # The real state today: Anthropic is out of credit too. Gemini is the floor and it holds.
    lite.dead["anthropic"] = "credit"
    for tier in TEXT_TIERS:
        out = _complete_tier(tier)
        assert out.served_model == "gemini/gemini-2.5-flash", (tier, how)


def test_kill_openai_a_credit_refusal_is_paid_for_once_then_skipped_for_the_cool_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The latency a dead-for-money primary adds: ONE round trip, then nothing for 300 s."""
    lite = kill(monkeypatch, "openai", how="credit", rtt={"openai": 0.05})
    t0 = time.perf_counter()
    first = _complete_tier(Tier.TURN)
    first_s = time.perf_counter() - t0
    t0 = time.perf_counter()
    second = _complete_tier(Tier.TURN)
    second_s = time.perf_counter() - t0
    assert provider_of(first.served_model) == provider_of(second.served_model) == "anthropic"
    assert first_s >= 0.05, "the first call pays the refusing primary's round trip"
    assert second_s < 0.02, f"the second call must skip the marked provider: took {second_s:.3f}s"
    assert len(lite.calls_to("openai")) == 1
    assert not health.provider_available("openai/gpt-5.6-terra")
    # After the cool-off, exactly one probe is let through.
    monkeypatch.setattr(health, "_clock", lambda: time.time() + health.cooloff_s() + 1)
    _complete_tier(Tier.TURN)
    assert len(lite.calls_to("openai")) == 2


@pytest.mark.parametrize("how", ["5xx", "auth", "conn"])
def test_kill_openai_by_weather_and_the_dead_primary_is_marked_out_after_a_short_streak(
    monkeypatch: pytest.MonkeyPatch, how: str
) -> None:
    """A 503 storm, a revoked key or a dead route used to be "weather" that marked nobody out,
    so for the whole outage every turn on every tier paid the dead primary's round trip before
    the fallback answered. Now three consecutive ordinary failures mark the provider out for a
    short cool-off (``WOBO_PROVIDER_WEATHER_COOLOFF_S``); one probe is let through when it
    passes, a fourth failure marks it again at once, and the first success clears it."""
    monkeypatch.setenv("WOBO_PROVIDER_WEATHER_COOLOFF_S", "60")
    lite = kill(monkeypatch, "openai", how=how, rtt={"openai": 0.04})
    t0 = time.perf_counter()
    for _ in range(5):
        assert provider_of(_complete_tier(Tier.TURN).served_model) == "anthropic"
    elapsed = time.perf_counter() - t0
    assert len(lite.calls_to("openai")) == health.weather_streak() == 3, "asked until the streak"
    assert elapsed < 5 * 0.04, f"5 turns cost {elapsed:.3f}s; the last two paid no dead trip"
    assert not health.provider_available("openai/gpt-5.6-terra"), "marked out for weather"
    row = health.snapshot()["checks"]["providers"]["by_provider"]["openai"]
    assert row["out"] is True and row["out_kind"] == "weather"
    assert row["out_of_credit"] is False, "weather is not an empty balance"
    assert health.snapshot(public=True)["status"] == "degraded"
    assert health.snapshot(public=True)["checks"]["providers"]["out"] == 1

    monkeypatch.setattr(health, "_clock", lambda: time.time() + 61)
    _complete_tier(Tier.TURN)
    assert len(lite.calls_to("openai")) == 4, "one probe after the cool-off"
    assert not health.provider_available("openai/gpt-5.6-terra"), "still failing: marked again"

    monkeypatch.setattr(health, "_clock", lambda: time.time() + 122)
    del lite.dead["openai"]
    assert provider_of(_complete_tier(Tier.TURN).served_model) == "openai"
    assert health.provider_available("openai/gpt-5.6-terra"), "one success clears the mark"


def test_kill_openai_by_a_hang_and_the_two_healthy_providers_still_teach(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A primary that hung used to be a total outage of every text tier with two healthy
    providers idle: the whole 60 s went to the dead rung and the chain stopped there. Now a rung
    with a live rung behind it gets half of what is left of the deadline, and the next rung gets
    the rest inside the same clock."""
    lite = kill(monkeypatch, "openai", how="hang")
    out = _complete_tier(Tier.TURN)
    assert provider_of(out.served_model) == "anthropic"
    first, second = lite.calls[0], lite.calls[1]
    assert first["timeout"] == pytest.approx(60.0 * model_call.primary_share())
    assert first["timeout"] == pytest.approx(30.0), "half of the 60 s turn"
    assert 0 < second["timeout"] <= 30.0, "what is left, never a second clock"

    # The child-safety screen's 1.5 s: the same share, and the Gemini rung is still reachable.
    # This hang really waits (0.8 s, past its 0.75 s share), so "what is left" is measured.
    lite = kill(monkeypatch, "openai", how="hang", answer=SAFETY_OK, rtt={"openai": 0.8})
    out = model_call.complete(
        model="openai/gpt-5.6-luna", fallbacks=["gemini/gemini-2.5-flash"], messages=[], timeout=1.5
    )
    assert out.served_model == "gemini/gemini-2.5-flash"
    assert lite.calls[0]["timeout"] == pytest.approx(0.75, abs=1e-3)
    assert model_call._floor_s(1.5) <= lite.calls[1]["timeout"] <= 0.75, "the rest, measured"

    # A rung with nothing live behind it keeps the whole deadline: a lone model is not hurried.
    health.reset()  # the two hangs above marked OpenAI out; this is about the share, not the mark
    lite = kill(monkeypatch, "anthropic", how="credit")
    model_call.complete(model="openai/gpt-5.6-terra", messages=[], timeout=60.0)
    assert lite.calls[-1]["timeout"] == 60.0


def test_kill_openai_by_a_hang_is_marked_out_after_two_turns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two consecutive timeouts mark a provider out. A hang is the dearest failure there is (it
    costs its whole share of the deadline before anything else is tried), so it is not given the
    three chances a 503 gets; the third turn never waits on it at all."""
    monkeypatch.setenv("WOBO_PROVIDER_WEATHER_COOLOFF_S", "60")
    lite = kill(monkeypatch, "openai", how="hang")
    for _ in range(3):
        assert provider_of(_complete_tier(Tier.TURN).served_model) == "anthropic"
    assert len(lite.calls_to("openai")) == health.hang_streak() == 2
    assert not health.provider_available("openai/gpt-5.6-terra")
    row = health.snapshot()["checks"]["providers"]["by_provider"]["openai"]
    assert row["out_kind"] == "weather" and row["last_error"] == "Timeout"


def test_kill_openai_the_safety_screen_answers_on_gemini_and_a_hang_never_reaches_the_script(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway import safety, safety_model

    lite = kill(monkeypatch, "openai", how="credit", answer=SAFETY_OK)
    verdict = _screen().classify(CIVICS)
    assert verdict.category == "ok" and verdict.source == "model"
    assert lite.served == "gemini/gemini-2.5-flash"

    # A hanging OpenAI: it gets half of the 1.5 s, Gemini gets the other half and answers, and
    # the lesson goes on. The hang used to eat the whole deadline and hold the child on the
    # plain line with Gemini never asked; the breaker then opened on a provider that was fine.
    health.reset()  # forget the credit mark: this is a fresh outage, OpenAI answering nothing
    lite = kill(monkeypatch, "openai", how="hang", answer=SAFETY_OK)
    clf = _screen()
    gated = safety.screen_inbound({"context": {"turn": {"lastUserInput": CIVICS}}}, clf)
    assert gated is None, "Gemini's verdict was ok inside the deadline; nothing to hold"
    assert len(lite.calls_to("gemini")) == 1
    assert lite.calls_to("openai")[0]["timeout"] == pytest.approx(0.75, abs=1e-3)
    assert model_call._floor_s(1.5) <= lite.calls_to("gemini")[0]["timeout"] <= 1.5
    assert safety_model.breaker_open() is False
    # And with Gemini hanging too, the child is HELD with the plain line, never the crisis
    # script (the wave-22 law holds), and the breaker opens on a real outage.
    # (The classifier caches verdicts by normalised text, so each ask below is a new sentence.)
    lite.dead["gemini"] = "hang"
    gated = safety.screen_inbound(
        {"context": {"turn": {"lastUserInput": CIVICS + " and its causes"}}}, clf
    )
    assert gated is not None and gated["say"] == safety.UNCHECKED_SAY
    assert "1098" not in gated["say"] and "Childline" not in gated["say"]
    for i in range(safety_model.BREAKER_THRESHOLD):
        clf.classify(f"{CIVICS} in the year {2000 + i}")
    gated = safety.screen_inbound(
        {"context": {"turn": {"lastUserInput": CIVICS + " by state"}}}, clf
    )
    assert gated is not None and gated["say"] == safety.OUTAGE_SAY


def test_kill_openai_voice_and_imagery_are_untouched_because_gemini_speaks_first(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from wobo_gateway.plexus import image, media

    monkeypatch.setenv("WOBO_IMAGE_CACHE_DIR", str(tmp_path))
    _keys(monkeypatch)
    http = _http(monkeypatch, google="up", openai="500")
    assert media.synthesize_narration("A line.") is not None
    assert image.generate_image("plant cell")["status"] == "ready"
    assert http.sent_to(OPENAI_HOST) == []


# =================================================================================================
# 2. Kill Gemini: voice, image and vision fall back; text is untouched
# =================================================================================================


@pytest.mark.parametrize("how", ["credit", "auth", "5xx", "hang"])
def test_kill_gemini_text_is_untouched_and_gemini_is_never_asked(
    monkeypatch: pytest.MonkeyPatch, how: str
) -> None:
    lite = kill(monkeypatch, "gemini", how=how)
    for tier in TEXT_TIERS:
        assert provider_of(_complete_tier(tier).served_model) == "openai"
    assert lite.calls_to("gemini") == []
    verdict_fake = kill(monkeypatch, "gemini", how=how, answer=SAFETY_OK)
    assert _screen().classify(CIVICS).source == "model"
    assert verdict_fake.calls_to("gemini") == []


@pytest.mark.parametrize("google", ["429", "401", "500"])
def test_kill_gemini_voice_and_imagery_fall_to_openai_and_the_ledger_says_so(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, google: str
) -> None:
    from wobo_gateway.plexus import image, media

    monkeypatch.setenv("WOBO_IMAGE_CACHE_DIR", str(tmp_path))
    _keys(monkeypatch)
    sink = fakes.ledger_sink(monkeypatch)
    _http(monkeypatch, google=google, openai="up")
    audio = media.synthesize_narration("Two x equals ten.")
    assert audio is not None and media.wav_duration_ms(audio["b64"]) == 1000
    drawn = image.generate_image("plant cell")
    assert drawn["status"] == "ready" and drawn["provenance"]["model"] == "openai/gpt-image-2"
    served = {r["capability"]: r["model_served"] for r in sink.rows}
    assert served["voice.tts"] == "openai/gpt-4o-mini-tts"
    assert served["engine.image"] == "openai/gpt-image-2"
    assert all(r["fallback_used"] for r in sink.rows if r["capability"] in served)


def test_kill_gemini_the_media_seams_remember_a_quota_refusal_and_the_funnel_learns_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The voice and image seams used to consult nothing and mark nobody: a Google 429 was asked
    again on every spoken line (five lines, five dead round trips, measured), and nothing they
    learned reached the text funnel. Now they ask ``health`` before a vendor and feed it after:
    a quota refusal marks Gemini out once, the next four lines go straight to OpenAI, the
    painter skips Google without a call, and the text chain skips its Gemini rung too."""
    from wobo_gateway.plexus import image, media

    monkeypatch.setenv("WOBO_IMAGE_CACHE_DIR", str(tmp_path))
    _keys(monkeypatch)
    http = _http(monkeypatch, google="429", openai="up")
    slow = http.handlers[GOOGLE_HOST]

    def slow_google(req: Any) -> Any:
        time.sleep(0.03)
        return slow(req)

    http.on(GOOGLE_HOST, slow_google)
    t0 = time.perf_counter()
    for _ in range(5):
        assert media.synthesize_narration("A line.") is not None
    elapsed = time.perf_counter() - t0
    google_calls = [r for r in http.requests if r.full_url.split("/")[2] == GOOGLE_HOST]
    assert len(google_calls) == 1, "a quota refusal is remembered between lines"
    assert elapsed < 0.15, f"five lines cost {elapsed:.3f}s; four of them never asked Google"
    assert not health.provider_available("gemini/gemini-2.5-flash-preview-tts")
    gemini = health.snapshot()["checks"]["providers"]["by_provider"]["gemini"]
    assert gemini["out_kind"] == "credit"

    drawn = image.generate_image("plant cell")
    assert drawn["status"] == "ready" and drawn["provenance"]["model"] == "openai/gpt-image-2"
    assert len([r for r in http.requests if GOOGLE_HOST in r.full_url]) == 1, "no call to Google"

    lite = kill(monkeypatch, "openai", "anthropic", how="5xx")
    with pytest.raises(_Refusal):
        _complete_tier(Tier.TURN)
    assert lite.calls_to("gemini") == [], "the text funnel skipped the rung the voice marked"


def test_kill_gemini_by_a_hang_and_a_spoken_line_waits_a_share_and_then_not_at_all(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A hanging Google used to cost the seam's own 60 s HTTP timeout on EVERY line before OpenAI
    was tried. The Gemini rung now gets a short primary deadline when OpenAI stands behind it,
    a timeout is recorded as one, and two of them mark Gemini out."""
    from wobo_gateway.plexus import media

    monkeypatch.setenv("WOBO_PROVIDER_WEATHER_COOLOFF_S", "60")
    _keys(monkeypatch)
    http = _http(monkeypatch, google="hang", openai="up")
    for _ in range(3):
        assert media.synthesize_narration("A line.") is not None
    google_calls = [r for r in http.requests if GOOGLE_HOST in r.full_url]
    assert len(google_calls) == health.hang_streak() == 2, "asked twice, then marked"
    assert http.timeouts[0] == media._PRIMARY_TIMEOUT_S
    assert media._PRIMARY_TIMEOUT_S < media._HTTP_TIMEOUT_S
    assert not health.provider_available("gemini/gemini-2.5-flash-preview-tts")
    gemini = health.snapshot()["checks"]["providers"]["by_provider"]["gemini"]
    assert gemini["out_kind"] == "weather"


def test_kill_gemini_the_doubt_reader_falls_to_terra(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway import doubt

    lite = kill(monkeypatch, "gemini", how="auth", answer=PAGE)
    reading = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    assert [line.text for line in reading.lines] == ["1/2 + 1/4"]
    assert lite.served == "openai/gpt-5.6-terra"


# =================================================================================================
# 3. Kill Anthropic: the real state today. Nothing may wait on it.
# =================================================================================================


def test_kill_anthropic_nothing_waits_on_it_and_the_probe_counts_without_naming(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway import doubt

    lite = kill(
        monkeypatch,
        "anthropic",
        how="credit",
        rtt={"anthropic": 0.5},
        answer=lambda m: PAGE if "context" in m else SAFETY_OK,
    )
    t0 = time.perf_counter()
    for tier in TEXT_TIERS:
        assert provider_of(_complete_tier(tier).served_model) == "openai"
    _screen().classify(CIVICS)
    doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    assert time.perf_counter() - t0 < 0.2, "no seam waited on the dead provider"
    assert lite.calls_to("anthropic") == []

    # Once a turn has actually reached Anthropic (OpenAI blinked), the mark is set and the public
    # probe says "one provider out", degraded, without a vendor's name.
    lite.dead["openai"] = "5xx"
    lite.rtt = {}
    assert _complete_tier(Tier.TURN).served_model == "gemini/gemini-2.5-flash"
    public = health.snapshot(public=True)
    assert public["status"] == "degraded"
    assert public["checks"]["providers"]["out_of_credit"] == 1
    assert "anthropic" not in json.dumps(public).lower()
    operator = health.snapshot()
    assert operator["checks"]["providers"]["by_provider"]["anthropic"]["out_of_credit"] is True
    assert operator["checks"]["providers"]["carrying"]["turn"] == "openai/gpt-5.6-terra"


def test_kill_anthropic_topped_up_the_fallback_is_asked_once_without_the_temperature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Anthropic's deprecations page (read 2026-09-07): ``temperature``, ``top_p`` and ``top_k``
    "return a 400 error when set to a non-default value on Claude 4.7 and later models". Sonnet 5
    and Opus 5 are the second rung of every text tier and litellm 1.90.1's parameter table still
    says they take the knobs, so the funnel keeps its own list: the knob is dropped up front and
    the rung is asked once. It used to be asked twice (the 400, then the answer), three round
    trips for one turn on the day the credit is topped up."""
    assert model_call._refused_up_front("anthropic/claude-sonnet-5", {"temperature": 0.3}) == [
        "temperature"
    ]
    assert model_call._refused_up_front(
        "anthropic/claude-opus-5", {"top_p": 0.9, "top_k": 4, "max_tokens": 9}
    ) == ["top_p", "top_k"]
    for older in ("anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-6", "claude-opus-4-6"):
        assert model_call._refuses_sampling_knobs(older) is False, older
    for newer in (
        "anthropic/claude-opus-4-7",
        "anthropic/claude-opus-4-8",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-fable-5-1",
        "claude-opus-5",
    ):
        assert model_call._refuses_sampling_knobs(newer) is True, newer
    assert model_call._refuses_sampling_knobs("openai/gpt-5.6-terra") is False

    lite = kill(monkeypatch, "openai", how="5xx", knob_refusers=("anthropic",))
    out = _complete_tier(Tier.TURN, temperature=0.3)
    assert out.served_model == "anthropic/claude-sonnet-5"
    anthropic = lite.calls_to("anthropic")
    assert len(anthropic) == 1, "asked once, without the knob"
    assert "temperature" not in anthropic[0]
    assert "temperature" in lite.calls_to("openai")[0], "the primary keeps its knob"


# =================================================================================================
# 4. Kill two of three: the third still teaches
# =================================================================================================


@pytest.mark.parametrize(
    "dead",
    [("openai", "anthropic"), ("openai", "gemini"), ("anthropic", "gemini")],
    ids=lambda d: "+".join(d) + "-dead",
)
def test_kill_two_of_three_and_the_third_carries_every_text_tier(
    monkeypatch: pytest.MonkeyPatch, dead: tuple[str, str]
) -> None:
    from wobo_gateway import safety, safety_model

    lite = kill(monkeypatch, *dead, how="credit", answer=SAFETY_OK)
    survivor = next(p for p in PROVIDERS if p not in dead)
    for tier in TEXT_TIERS:
        out = _complete_tier(tier)
        assert out.served_model == _survivor(tier, set(dead)), tier
        assert provider_of(out.served_model) == survivor
    # Second pass: the dead ones are skipped without a call.
    before = len(lite.calls)
    for tier in TEXT_TIERS:
        _complete_tier(tier)
    assert all(provider_of(str(c["model"])) == survivor for c in lite.calls[before:])
    assert health.carriers()["turn"] == _survivor(Tier.TURN, set(dead))
    # Health knows only what a call taught it (no probe ever opens a socket): a dead provider
    # BEHIND a healthy primary is never asked, so it is never marked and the probe says ok.
    asked = {provider_of(str(c["model"])) for c in lite.calls}
    expected = "degraded" if asked & set(dead) else "ok"
    assert health.snapshot(public=True)["status"] == expected, (dead, asked)

    gated = safety.screen_inbound({"context": {"turn": {"lastUserInput": CIVICS}}}, _screen())
    if survivor in ("openai", "gemini"):
        assert gated is None, "the survivor's verdict was 'ok'; the lesson goes on"
    else:
        # Only Anthropic left: the safety chain has no Anthropic rung, so the rule layer answers
        # with the plain hold, never the crisis script.
        assert gated is not None and gated["say"] == safety.UNCHECKED_SAY
        assert "1098" not in gated["say"]
        assert gated["safety"]["category"] != "crisis"
    assert safety_model.breaker_open() is False


@pytest.mark.parametrize(
    "dead",
    [("openai", "anthropic"), ("openai", "gemini"), ("anthropic", "gemini")],
    ids=lambda d: "+".join(d) + "-dead",
)
def test_kill_two_of_three_voice_imagery_and_vision(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, dead: tuple[str, str]
) -> None:
    from wobo_gateway import doubt
    from wobo_gateway.plexus import image, media

    monkeypatch.setenv("WOBO_IMAGE_CACHE_DIR", str(tmp_path))
    _keys(monkeypatch)
    _http(
        monkeypatch,
        google="429" if "gemini" in dead else "up",
        openai="429" if "openai" in dead else "up",
    )
    lite = kill(monkeypatch, *dead, how="credit", answer=PAGE)
    survivor = next(p for p in PROVIDERS if p not in dead)

    audio = media.synthesize_narration("A line.")
    drawn = image.generate_image("plant cell")
    if survivor == "anthropic":
        # Anthropic has no voice and no painter: the device reads, the seed illustration serves.
        assert audio is None and drawn == {"status": "unavailable"}
        # The voice seam marked both dead vendors, so the painter asked neither and the page
        # reader pays no round trip at all: ProvidersOut at once, with no call.
        with pytest.raises(model_call.ProvidersOut):
            doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
        assert lite.calls == [], "both eyes were already marked by the voice seam"
    else:
        assert audio is not None and drawn["status"] == "ready"
        reading = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
        assert reading.lines and provider_of(lite.served) == survivor


# =================================================================================================
# 5. Kill all three: honest lines, never the crisis script, never a blank board, never a trace
# =================================================================================================


def test_kill_all_three_the_funnel_fails_at_once_without_a_network_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lite = kill(monkeypatch, *PROVIDERS, how="credit", rtt=dict.fromkeys(PROVIDERS, 0.02))
    with pytest.raises(_Refusal):
        _complete_tier(Tier.TURN)  # the first turn pays three round trips and learns
    assert len(lite.calls) == 3
    t0 = time.perf_counter()
    for tier in TEXT_TIERS:
        with pytest.raises(model_call.ProvidersOut):
            _complete_tier(tier)
    assert time.perf_counter() - t0 < 0.05
    assert len(lite.calls) == 3, "no further call while every provider is marked"
    snap = health.snapshot()
    assert snap["status"] == "unhealthy" and health.status_code(snap) == 503
    assert all(
        v is None
        for k, v in snap["checks"]["providers"]["carrying"].items()
        if k in {t.value for t in TEXT_TIERS}
    )


def test_kill_all_three_the_safety_screen_holds_and_never_reaches_the_crisis_script(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway import safety, safety_model

    kill(monkeypatch, *PROVIDERS, how="credit")
    clf = _screen()
    lines = []
    for i in range(safety_model.BREAKER_THRESHOLD + 2):
        gated = safety.screen_inbound(
            {"context": {"turn": {"lastUserInput": f"{CIVICS} {i}"}}}, clf
        )
        assert gated is not None
        lines.append(gated["say"])
        assert "1098" not in gated["say"] and "Childline" not in gated["say"]
        assert gated["safety"]["category"] != "crisis"
    assert safety.UNCHECKED_SAY in lines and lines[-1] == safety.OUTAGE_SAY
    # A DISCLOSURE the rules can read is still a crisis with every model dead.
    gated = safety.screen_inbound(
        {"context": {"turn": {"lastUserInput": "my father hits me and i want to die"}}}, clf
    )
    assert gated is not None and gated["safety"]["category"] == "crisis"
    assert "1098" in gated["say"]


def test_kill_all_three_the_board_is_never_blank(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway.wobo import board_plan_for

    kill(monkeypatch, *PROVIDERS, how="credit")
    payload = {"context": {"turn": {"lastUserInput": "graph y = 2x + 1 from -3 to 3"}}}
    plan = board_plan_for(payload, live=True)
    assert plan is not None
    assert plan["say"].strip(), "words over the board"
    assert plan.get("intents") or plan.get("objects"), "something to draw"
    assert "Traceback" not in json.dumps(plan)
    # The keyless plan is a keyword table (graph, number line, bisector, projectile...). A board
    # turn in words it does not know gets ``None`` from the planner and falls to the five-path
    # answer; with every provider out that is Wobo's own line over the stream (the next tests).
    payload = {"context": {"turn": {"lastUserInput": "draw a triangle with sides 3, 4 and 5"}}}
    assert board_plan_for(payload, live=True) is None


def _live_app(monkeypatch: pytest.MonkeyPatch) -> Any:
    from fastapi.testclient import TestClient
    from wobo_gateway.app import create_app

    monkeypatch.setenv("LLM_MODE", "live")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")
    monkeypatch.setenv("OPENAI_API_KEY", "not-a-real-key")
    monkeypatch.setenv("GOOGLE_AI_API_KEY", "not-a-real-key")
    return TestClient(create_app(), raise_server_exceptions=False)


def _frames(body: str) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for block in body.split("\n\n"):
        if not block.strip() or block.startswith(":"):
            continue
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append((fields["event"], json.loads(fields["data"])))
    return out


def test_kill_all_three_the_capability_route_answers_in_wobos_own_line(
    monkeypatch: pytest.MonkeyPatch, auth: Any
) -> None:
    """What the child's typed turn gets when nobody can answer. It used to be FastAPI's bare 500
    ("Internal Server Error"), which the client rendered as its generic broken page. Now it is a
    503 in the same ``{code, message}`` shape as the spend ceiling's refusal, so the client shows
    Wobo's line; the turn is given back to the learner's meter; no trace, no vendor, no crisis
    script. Both on the first turn (three refusals paid for) and once every provider is marked."""
    lite = kill(monkeypatch, *PROVIDERS, how="credit")
    client = _live_app(monkeypatch)
    body = {"payload": {"context": {"turn": {"lastUserInput": "what is 12 times 12"}}}}
    first = client.post("/v1/capability/wobo.turn", json=body, headers=auth())
    assert len(lite.calls) == 3, "the first turn learns that every provider is out"
    second = client.post("/v1/capability/wobo.turn", json=body, headers=auth())
    assert len(lite.calls) == 3, "the second makes no call at all"
    for resp in (first, second):
        text = resp.text
        assert resp.status_code == 503, text
        assert resp.json() == {"code": "providers_out", "message": model_call.OUTAGE_LINE}
        assert resp.headers["Retry-After"] == "60"
        assert "Traceback" not in text and "ProvidersOut" not in text
        assert not re.search(r"openai|anthropic|gemini|claude|gpt", text, re.I), text
        assert "1098" not in text
    assert first.headers["X-Wobo-Budget-Remaining"] == second.headers["X-Wobo-Budget-Remaining"], (
        "a turn nobody served is given back"
    )
    assert not re.search(r"[—]", model_call.OUTAGE_LINE), "no em dash where a learner reads"
    assert "!" not in model_call.OUTAGE_LINE


def test_kill_all_three_a_board_turn_in_unknown_words_gets_wobos_line_over_the_stream(
    monkeypatch: pytest.MonkeyPatch, auth: Any
) -> None:
    """The board path: words the keyword planner does not know fall to the five-path answer, and
    with every provider out that used to be the same bare 500. Now it is Wobo's line over the
    ordinary stream, the way the spend ceiling's refusal already arrived."""
    kill(monkeypatch, *PROVIDERS, how="credit")
    client = _live_app(monkeypatch)
    words = "draw a triangle with sides 3, 4 and 5"
    body = {"payload": {"context": {"turn": {"lastUserInput": words}}}}
    resp = client.post(
        "/v1/capability/wobo.turn",
        json=body,
        headers={**auth(), "Accept": "text/event-stream"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = _frames(resp.text)
    kinds = [kind for kind, _ in events]
    assert kinds[0] == "say" and kinds[-1] == "done" and "ink" not in kinds
    said = " ".join(data["text"] for kind, data in events if kind == "say")
    assert said == model_call.OUTAGE_LINE
    assert not re.search(r"openai|anthropic|gemini|claude|gpt|Traceback", resp.text, re.I)
    assert "1098" not in resp.text


def test_kill_all_three_the_public_ask_box_answers_in_its_own_words(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from fastapi.testclient import TestClient
    from wobo_gateway import ask_public
    from wobo_gateway.app import create_app

    monkeypatch.setenv("LLM_MODE", "live")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")
    monkeypatch.setenv("OPENAI_API_KEY", "not-a-real-key")
    monkeypatch.setenv("GOOGLE_AI_API_KEY", "not-a-real-key")
    kill(monkeypatch, *PROVIDERS, how="credit")
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.post("/v1/ask", json={"question": "how much does a year cost"})
    assert resp.status_code in (200, 503), resp.text
    assert "Traceback" not in resp.text
    if resp.status_code == 503:
        assert resp.json()["message"] == ask_public.UNAVAILABLE_LINE


def test_kill_all_three_voice_imagery_and_the_page_reader(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, auth: Any
) -> None:
    from fastapi.testclient import TestClient
    from wobo_gateway import doubt
    from wobo_gateway.app import create_app
    from wobo_gateway.plexus import image, media

    monkeypatch.setenv("WOBO_IMAGE_CACHE_DIR", str(tmp_path))
    _keys(monkeypatch)
    _http(monkeypatch, google="429", openai="429")
    kill(monkeypatch, *PROVIDERS, how="credit")
    assert media.synthesize_narration("A line.") is None
    assert image.generate_image("plant cell") == {"status": "unavailable"}
    with pytest.raises(Exception):  # noqa: B017 - the route turns any reader error into one line
        doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.post("/v1/voice/tts", json={"text": "A line."}, headers=auth())
    assert resp.status_code == 502 and "tts failed" in resp.text
    assert not re.search(r"openai|gemini|google", resp.text, re.I)


def test_kill_all_three_a_failed_spoken_line_is_given_back_to_the_learner(
    monkeypatch: pytest.MonkeyPatch, auth: Any
) -> None:
    """ "A learner never pays for a call we did not serve." ``POST /v1/voice/tts`` used to charge
    the meter, answer 502 when neither voice spoke, and refund nothing: one of the day's voice
    calls paid for a line the device read for free. Now the charge is given back before the 502,
    and the answer says so in the budget headers the client already reads."""
    from fastapi.testclient import TestClient
    from wobo_gateway import budget
    from wobo_gateway.app import create_app

    _keys(monkeypatch)
    _http(monkeypatch, google="429", openai="429")
    client = TestClient(create_app(), raise_server_exceptions=False)
    meter = f"sub:{__import__('conftest').TEST_SUBJECT}"
    before = budget.snapshot(meter, "free")
    resp = client.post("/v1/voice/tts", json={"text": "A line."}, headers=auth())
    assert resp.status_code == 502 and "tts failed" in resp.text
    after = budget.snapshot(meter, "free")
    assert after == before, "the meter holds no charge for a line nobody spoke"
    # The VOICE counter, which is the one a spoken line draws on: hearing an answer is not asking
    # one, and the client synthesises a call per sentence (``budget.VOICE``).
    assert resp.headers["X-Wobo-Budget-Remaining"] == str(before.voice_remaining)
    assert after.turns_remaining == before.turns_remaining


# =================================================================================================
# 6. What each path costs, from the ledger and from the price table
# =================================================================================================


def test_the_ledger_prices_a_fallback_turn_at_the_model_that_answered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The row on a fallback path is priced at the rung that answered, not the one asked for,
    using litellm's own price table (the one the bill is derived from)."""
    from litellm import cost_per_token  # the real table, read BEFORE the fake replaces litellm
    from wobo_gateway.telemetry import record_cost

    prices = {
        m.split("/", 1)[1]: sum(
            cost_per_token(model=m.split("/", 1)[1], prompt_tokens=20, completion_tokens=10)
        )
        for m in tier_chain(Tier.TURN)
    }
    sink = fakes.ledger_sink(monkeypatch)
    lite = kill(monkeypatch, "openai", how="credit")

    def priced(completion_response: Any) -> float:
        return prices[completion_response.model.split("/", 1)[-1]]

    import sys

    sys.modules["litellm"].completion_cost = priced  # type: ignore[attr-defined]
    out = _complete_tier(Tier.TURN)
    record_cost(capability="wobo.turn", model=tier_chain(Tier.TURN)[0], response=out)
    row = [r for r in sink.rows if r["capability"] == "wobo.turn"][-1]
    assert row["model_requested"] == "openai/gpt-5.6-terra"
    assert row["model_served"] == "anthropic/claude-sonnet-5"
    sonnet = 20 * 2e-6 + 10 * 10e-6
    terra = 20 * 2e-6 + 10 * 12e-6
    assert row["cost_usd"] == pytest.approx(sonnet, rel=1e-6)
    assert row["cost_usd"] != pytest.approx(terra, rel=1e-6)
    assert lite.served == "anthropic/claude-sonnet-5"


def test_the_cost_line_and_the_days_spend_name_the_model_that_answered(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The ledger row was already right. The ``gateway.cost`` line and ``spend.record`` carried
    the REQUESTED model, so the per-model figures on the telemetry stream and in the day's spend
    attributed a fallback's cost to the provider that refused. Both now name who answered, with
    the requested model beside it."""
    from wobo_gateway.telemetry import record_cost

    fakes.ledger_sink(monkeypatch)
    kill(monkeypatch, "openai", how="credit")
    out = _complete_tier(Tier.TURN)
    with caplog.at_level(logging.INFO, logger="wobo.gateway"):
        record_cost(capability="wobo.turn", model="openai/gpt-5.6-terra", response=out)
    cost = next(r for r in caplog.records if r.getMessage() == "gateway.cost")
    assert cost.fields["model"] == "anthropic/claude-sonnet-5"
    assert cost.fields["model_requested"] == "openai/gpt-5.6-terra"
    spent = next(r for r in caplog.records if r.getMessage() == "gateway.spend")
    assert spent.fields["model"] == "anthropic/claude-sonnet-5"


def test_the_per_turn_figures_in_operations_11_3_match_litellms_table() -> None:
    """OPERATIONS.md §11.3, re-derived from litellm 1.90.1's price table (bare ids: litellm has
    no ``openai/`` or ``anthropic/`` prefixed rows for these, and the funnel's responses carry
    the bare name)."""
    from litellm import cost_per_token

    def usd(model: str, tokens_in: int, tokens_out: int) -> float:
        p, c = cost_per_token(model=model, prompt_tokens=tokens_in, completion_tokens=tokens_out)
        return p + c

    turn = (1500, 400)
    tiny = (600, 60)
    lesson = (4000, 3000)
    verify = (3000, 800)
    table = {
        ("gpt-5.6-terra", turn): 0.0078,
        ("claude-sonnet-5", turn): 0.0070,
        ("gemini-2.5-flash", turn): 0.0014,
        ("gpt-5.6-luna", tiny): 0.0002,
        ("claude-haiku-4-5", tiny): 0.0009,
        ("gemini-2.5-flash", tiny): 0.0003,
        ("gpt-5.6-terra", lesson): 0.044,
        ("claude-opus-5", lesson): 0.095,
        ("gemini-2.5-flash", lesson): 0.0087,
        ("gpt-5.6-sol", verify): 0.028,
        ("claude-opus-5", verify): 0.035,
        ("gemini-2.5-flash", verify): 0.0029,
    }
    for (model, shape), documented in table.items():
        assert usd(model, *shape) == pytest.approx(documented, abs=0.0001), (model, shape)
    # And every catalogue price matches litellm's table for the text ids.
    for model_id, price in CATALOGUE.items():
        if price.per_million_in is None:
            continue
        # litellm keys OpenAI and Anthropic by the bare name and Gemini by the prefixed one.
        bare = model_id if model_id.startswith("gemini/") else model_id.split("/", 1)[1]
        # 1,000 tokens, scaled: a million-token prompt is OpenAI's long-context rate (double).
        p, c = cost_per_token(model=bare, prompt_tokens=1_000, completion_tokens=1_000)
        assert p * 1_000 == pytest.approx(price.per_million_in, rel=1e-6), model_id
        assert c * 1_000 == pytest.approx(price.per_million_out, rel=1e-6), model_id


# =================================================================================================
# 7. Every id the gateway can call is in the table
# =================================================================================================

_ID = re.compile(r"\b(?:openai|anthropic|gemini)/[A-Za-z0-9._-]+")
_BARE = re.compile(r"\bgemini-[0-9]\.[0-9]-[a-z0-9.-]+|\bgpt-[a-z0-9.-]+|\bclaude-[a-z0-9.-]+")


def _ids_in_src() -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for path in SRC.rglob("*.py"):
        text = path.read_text()
        for line in text.splitlines():
            code = line.split("#", 1)[0]
            if not code.strip() or '"""' in line:
                continue
            for m in (*_ID.findall(code), *_BARE.findall(code)):
                if m.endswith(("-", ".")) or "..." in m:
                    continue
                found.setdefault(m, set()).add(str(path.relative_to(SRC)))
    return found


def test_every_model_id_in_the_gateway_source_is_a_catalogue_row() -> None:
    """The live microphone's model (``voice.VOICE_MODEL``) used to be the one id in the source
    with no CATALOGUE row: called on the product's key, priced nowhere, metered nowhere. It has
    a row now (and ``test_voice_meter.py`` proves the socket writes its minutes down)."""
    catalogued = set(CATALOGUE) | {m.split("/", 1)[1] for m in CATALOGUE}
    strays = {
        m: sorted(files)
        for m, files in _ids_in_src().items()
        if m not in catalogued and not m.startswith(("gpt-fallback", "gpt-9-nova"))
    }
    assert not strays, strays
    from wobo_gateway import voice

    assert voice.VOICE_ID in CATALOGUE
    assert CATALOGUE[voice.VOICE_ID].per_million_in is None, "priced per audio token in voice.py"
    assert "native-audio" in CATALOGUE[voice.VOICE_ID].note


def test_the_content_scripts_ride_the_funnel_on_the_routers_ids() -> None:
    """``content/atom`` (a uv workspace member) and ``content/factbase/build.py`` used to call
    ``litellm.completion`` directly, with no chain, no health mark and no ledger row, on ids the
    router retired (owner, 2026-09-02: Opus 4.8, GPT-5.5) or never carried (Sonnet 4.6, fifty
    percent dearer than Sonnet 5). They ride ``model_call.complete`` on the router's tiers now."""
    from wobo_atom import grade as atom_grade

    root = SRC.parents[3]
    grade = (root / "content/atom/src/wobo_atom/grade.py").read_text()
    build = (root / "content/factbase/build.py").read_text()
    validate = (SRC / "plexus/validate.py").read_text()
    for text in (grade, build, validate):
        assert "litellm.completion(" not in text
        for retired in ("claude-sonnet-4-6", "claude-opus-4-8", "gpt-5.5", "gpt-4.1"):
            assert retired not in text, retired
    assert "wobo_gateway.model_call" in grade and "wobo_gateway.model_call" in build
    assert tier_chain(Tier.TURN)[0] == atom_grade.GRADER_MODEL, "grading one attempt is a turn"


def test_the_atom_grader_answers_from_the_fallback_and_the_ledger_says_so(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_atom.grade import grounded_grade, verifier_ground

    sink = fakes.ledger_sink(monkeypatch)
    lite = kill(
        monkeypatch,
        "openai",
        how="credit",
        answer=(
            '{"misconception": "sign", "diagnosis": "the sign flipped", "hint": "check the sign"}'
        ),
    )
    findings = verifier_ground("2x + 3 = 7", ["2x = 4", "x = 2"])
    graded = grounded_grade("2x + 3 = 7", ["2x = 4", "x = 2"], findings)
    assert graded.correct is True and graded.hint == "check the sign"
    assert lite.served == "anthropic/claude-sonnet-5"
    row = [r for r in sink.rows if r["capability"] == "atom.grade"][-1]
    assert row["model_requested"] == "openai/gpt-5.6-terra"
    assert row["model_served"] == "anthropic/claude-sonnet-5" and row["fallback_used"] is True


def test_the_factbase_builder_answers_from_the_fallback_on_the_generate_and_verify_tiers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import importlib.util

    root = SRC.parents[3]
    spec = importlib.util.spec_from_file_location(
        "factbase_build", root / "content/factbase/build.py"
    )
    assert spec is not None and spec.loader is not None
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    assert tier_chain(Tier.GENERATE)[0] == build.CANDIDATE_MODEL
    assert tier_chain(Tier.VERIFY)[0] == build.VERIFIER_MODEL

    sink = fakes.ledger_sink(monkeypatch)
    # Opus 5 is the second rung of BOTH tiers, so the replies are keyed by call order, not id.
    replies = [
        '[{"claim": "Cells were named by Hooke", "kind": "definition"}]',
        '{"verdict": "agree", "reason": "NCERT says so"}',
        '{"verdict": "agree", "reason": "NCERT says so"}',
    ]
    lite = kill(monkeypatch, "openai", how="credit", answer=lambda m: replies.pop(0))
    candidates = build.generate_candidates("biology", "10", "cell structure")
    assert [c["claim"] for c in candidates] == ["Cells were named by Hooke"]
    assert candidates[0]["source"]["model"] == tier_chain(Tier.GENERATE)[1], "who actually wrote it"
    agree, reason, verifier = build.verify_candidate(candidates[0])
    assert agree and reason == "NCERT says so"
    assert verifier == tier_chain(Tier.VERIFY)[1], "who actually verified"
    promoted, review = build.verify_candidates(candidates)
    assert review == [] and promoted[0]["source"]["models"] == [
        tier_chain(Tier.GENERATE)[1],
        tier_chain(Tier.VERIFY)[1],
    ]
    assert [str(c["model"]) for c in lite.calls][:3] == [
        tier_chain(Tier.GENERATE)[0],
        tier_chain(Tier.GENERATE)[1],
        tier_chain(Tier.VERIFY)[1],
    ], "the primary refused once; every later call skipped it"
    served = {r["capability"]: r["model_served"] for r in sink.rows}
    assert served["factbase.candidate"] == tier_chain(Tier.GENERATE)[1]
    assert served["factbase.verify"] == tier_chain(Tier.VERIFY)[1]
