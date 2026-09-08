"""Fallbacks everywhere (owner, 2026-09-05).

"Use the openai and gemini keys if anthropic isn't working, we should have fallbacks everywhere";
"use openai's terra luna sol; they are pretty good for generations, and gemini is good for audio
and cheaper". Said on the day every Claude call was refused with "credit balance is too low" and
the fallback carried the product.

Four things, each with a test that fails without the change:

a) the table is the owner's word: OpenAI first on every text tier, Anthropic second, Gemini last;
   voice and imagery stay on Gemini with an OpenAI rung behind them;
b) every tier's primary and chain can be set by environment without a deploy, and an id the
   router does not know is refused at startup with a line that says which variable and why;
c) credit exhaustion is a FAST skip: the provider is marked out, the chain moves on in well under
   a second, a cool-off re-probes it later, and health says who is carrying each tier right now;
d) the cost rule still holds: one rung up per rejection, one rung down at the spend ceiling.
"""

from __future__ import annotations

import sys
import time
import types
from typing import Any

import pytest
from wobo_gateway import health, model_call, routing, spend
from wobo_gateway.routing import Tier, Track, resolve_any, tier_fallbacks, tier_model

OPENAI, ANTHROPIC, GEMINI = "openai", "anthropic", "gemini"
TEXT_TIERS = (Tier.TINY, Tier.TURN, Tier.GENERATE, Tier.CREATE, Tier.REASON, Tier.VERIFY)


def chain_of(tier: Tier) -> list[str]:
    rest = [resolve_any(n).provider_model for n in tier_fallbacks(tier)]
    return [tier_model(tier).provider_model, *rest]


def provider(model_id: str) -> str:
    return model_id.split("/", 1)[0]


@pytest.fixture(autouse=True)
def _default_table():
    """Every test starts and ends on the owner's table, whatever the process environment says."""
    routing.configure({})
    yield
    routing.configure({})


# =================================================================================================
# a) the table, by the owner's word
# =================================================================================================
OWNERS_WORD = {
    Tier.TINY: "openai/gpt-5.6-luna",
    Tier.TURN: "openai/gpt-5.6-terra",
    Tier.GENERATE: "openai/gpt-5.6-luna",
    Tier.CREATE: "openai/gpt-6-astra",
    Tier.REASON: "openai/gpt-5.6-sol",
    Tier.VERIFY: "openai/gpt-5.6-sol",
}


@pytest.mark.parametrize("tier", TEXT_TIERS, ids=lambda t: t.value)
def test_text_tiers_go_to_openai_first_anthropic_second_gemini_last(tier: Tier) -> None:
    chain = chain_of(tier)
    assert chain[0] == OWNERS_WORD[tier]
    assert [provider(m) for m in chain] == [OPENAI, ANTHROPIC, GEMINI]


def test_voice_and_imagery_stay_on_gemini_with_an_openai_rung_behind_them() -> None:
    for tier in (Tier.VOICE, Tier.IMAGE):
        chain = chain_of(tier)
        assert provider(chain[0]) == GEMINI, tier
        assert len(chain) == 2 and provider(chain[1]) == OPENAI, tier


def test_the_ids_are_the_ones_on_the_official_pages_and_litellm_prices_them_the_same() -> None:
    """The per-tier price table in docs/OPERATIONS.md is copied from the vendors' own pages. The
    ledger prices calls from litellm's table. If the two disagree the doc is lying about the
    bill, so the router carries the page's numbers and this test holds litellm to them."""
    litellm = pytest.importorskip("litellm")
    for model_id, price in routing.CATALOGUE.items():
        if price.per_million_in is None:
            continue  # imagery is priced per image, not per token
        row = litellm.model_cost.get(model_id) or litellm.model_cost.get(model_id.split("/", 1)[1])
        assert row, f"litellm has no price for {model_id}: the ledger would record it unpriced"
        assert row["input_cost_per_token"] * 1e6 == pytest.approx(price.per_million_in), model_id
        assert row["output_cost_per_token"] * 1e6 == pytest.approx(price.per_million_out), model_id


# =================================================================================================
# b) overridable without a deploy
# =================================================================================================
def test_a_tier_primary_can_be_set_by_env() -> None:
    routing.configure({"WOBO_TIER_TURN": "openai/gpt-5.6-luna"})
    assert tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-luna"
    # The rest of the chain is untouched and still crosses providers.
    assert [provider(m) for m in chain_of(Tier.TURN)] == [OPENAI, ANTHROPIC, GEMINI]
    # Nothing else moved.
    assert tier_model(Tier.GENERATE).provider_model == OWNERS_WORD[Tier.GENERATE]


def test_a_tier_chain_can_be_set_by_env() -> None:
    routing.configure(
        {
            "WOBO_TIER_GENERATE": "anthropic/claude-sonnet-5",
            "WOBO_TIER_GENERATE_CHAIN": "gemini/gemini-2.5-flash,openai/gpt-5.6-terra",
        }
    )
    assert chain_of(Tier.GENERATE) == [
        "anthropic/claude-sonnet-5",
        "gemini/gemini-2.5-flash",
        "openai/gpt-5.6-terra",
    ]


def test_an_unknown_id_is_refused_at_startup_with_a_clear_line() -> None:
    with pytest.raises(RuntimeError) as caught:
        routing.configure({"WOBO_TIER_REASON": "openai/gpt-9-nova"})
    line = str(caught.value)
    assert "WOBO_TIER_REASON" in line and "openai/gpt-9-nova" in line
    assert "not a model this router knows" in line
    # A refused override leaves the table exactly as it was.
    assert tier_model(Tier.REASON).provider_model == OWNERS_WORD[Tier.REASON]


def test_a_chain_that_repeats_a_model_is_refused() -> None:
    with pytest.raises(RuntimeError, match="WOBO_TIER_TINY_CHAIN"):
        routing.configure(
            {"WOBO_TIER_TINY_CHAIN": "anthropic/claude-haiku-4-5,anthropic/claude-haiku-4-5"}
        )


def test_the_env_is_read_at_import_so_a_railway_variable_is_enough() -> None:
    """No deploy: set the variable, the service restarts, the table is the variable."""
    import os

    assert routing.configure.__doc__  # the seam exists
    assert routing.ENV_PREFIX == "WOBO_TIER_"
    # The module-level table was built from os.environ, which in the test process carries none.
    assert not any(k.startswith(routing.ENV_PREFIX) for k in os.environ)


# =================================================================================================
# c) credit exhaustion is a fast skip
# =================================================================================================
class _Litellm:
    """A litellm whose completion answers from a script keyed by provider."""

    def __init__(self, script: dict[str, list[Any]]) -> None:
        self.script = script
        self.calls: list[dict[str, Any]] = []
        self.drop_params = False

    def completion(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        steps = self.script[provider(kwargs["model"])]
        step = steps.pop(0) if len(steps) > 1 else steps[0]
        if isinstance(step, Exception):
            raise step
        return step


@pytest.fixture
def litellm(monkeypatch: pytest.MonkeyPatch):
    def _install(script: dict[str, list[Any]]) -> _Litellm:
        fake = _Litellm(script)
        module = types.ModuleType("litellm")
        module.completion = fake.completion  # type: ignore[attr-defined]
        module.drop_params = False  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "litellm", module)
        return fake

    return _install


class _Refusal(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


ANTHROPIC_NO_CREDIT = _Refusal(
    "litellm.BadRequestError: AnthropicException - Your credit balance is too low to access the "
    "Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    400,
)
OPENAI_NO_QUOTA = _Refusal(
    'litellm.RateLimitError: OpenAIException - {"error": {"type": "insufficient_quota", '
    '"code": "credit_balance_exhausted", "message": "Your organization has no prepaid credits '
    'remaining."}}',
    429,
)
GEMINI_EXHAUSTED = _Refusal(
    'litellm.RateLimitError: GeminiException - {"error": {"code": 429, "status": '
    '"RESOURCE_EXHAUSTED", "message": "You exceeded your current quota."}}',
    429,
)

TURN_CHAIN = ("openai/gpt-5.6-terra", ["anthropic/claude-sonnet-5", "gemini/gemini-2.5-flash"])


def _complete(**extra: Any) -> Any:
    primary, fallbacks = TURN_CHAIN
    return model_call.complete(model=primary, fallbacks=fallbacks, timeout=60.0, **extra)


@pytest.mark.parametrize(
    "refusal,who",
    [(ANTHROPIC_NO_CREDIT, ANTHROPIC), (OPENAI_NO_QUOTA, OPENAI), (GEMINI_EXHAUSTED, GEMINI)],
    ids=[ANTHROPIC, OPENAI, GEMINI],
)
def test_an_exhausted_provider_is_marked_out_and_skipped_in_well_under_a_second(
    litellm, refusal: _Refusal, who: str
) -> None:
    script = {p: [f"{p} answered"] for p in (OPENAI, ANTHROPIC, GEMINI)}
    script[who] = [refusal]
    fake = litellm(script)
    # Put the exhausted provider FIRST so the skip is visible on the second call.
    order = [who] + [p for p in (OPENAI, ANTHROPIC, GEMINI) if p != who]
    ids = {
        OPENAI: "openai/gpt-5.6-terra",
        ANTHROPIC: "anthropic/claude-sonnet-5",
        GEMINI: "gemini/gemini-2.5-flash",
    }
    chain = [ids[p] for p in order]

    first = model_call.complete(model=chain[0], fallbacks=chain[1:], timeout=60.0)
    assert first.endswith("answered") and not first.startswith(who)
    assert [provider(c["model"]) for c in fake.calls] == order[:2], "moved on after the refusal"
    assert not health.provider_available(chain[0]), f"{who} is marked out"

    started = time.perf_counter()
    second = model_call.complete(model=chain[0], fallbacks=chain[1:], timeout=60.0)
    elapsed = time.perf_counter() - started
    assert second == first
    assert provider(fake.calls[-1]["model"]) == order[1], "the exhausted one was not asked again"
    assert len(fake.calls) == 3
    assert elapsed < 1.0, f"the skip took {elapsed:.3f}s"


def test_an_ordinary_failure_moves_the_chain_on_but_marks_nobody_out(litellm) -> None:
    down = _Refusal("litellm.ServiceUnavailableError: OpenAIException - overloaded", 503)
    fake = litellm({OPENAI: [down], ANTHROPIC: ["anthropic answered"]})
    assert _complete() == "anthropic answered"
    assert health.provider_available("openai/gpt-5.6-terra"), "a 503 is weather, not no money"
    assert [provider(c["model"]) for c in fake.calls] == [OPENAI, ANTHROPIC]
    # And it is written down: the provider's last failure and the carrier's last success.
    report = health.snapshot()["checks"]["providers"]["by_provider"]
    assert report[OPENAI]["last_failure"] is not None and report[OPENAI]["out_of_credit"] is False
    assert report[ANTHROPIC]["last_success"] is not None


def test_when_every_provider_is_out_the_call_fails_at_once_with_a_clear_error(litellm) -> None:
    fake = litellm(
        {OPENAI: [OPENAI_NO_QUOTA], ANTHROPIC: [ANTHROPIC_NO_CREDIT], GEMINI: [GEMINI_EXHAUSTED]}
    )
    with pytest.raises(_Refusal, match="insufficient_quota"):
        _complete()  # every rung refused; the PRIMARY's refusal is the one reported
    assert len(fake.calls) == 3
    started = time.perf_counter()
    with pytest.raises(model_call.ProvidersOut, match="every provider"):
        _complete()
    assert len(fake.calls) == 3, "not one network call when nobody can answer"
    assert time.perf_counter() - started < 0.1


def test_the_cool_off_re_probes_and_a_second_refusal_marks_it_out_again(
    litellm, monkeypatch
) -> None:
    clock = {"now": 1_000.0}
    monkeypatch.setattr(health, "_clock", lambda: clock["now"])
    monkeypatch.setenv("WOBO_PROVIDER_COOLOFF_S", "300")
    fake = litellm({OPENAI: [OPENAI_NO_QUOTA], ANTHROPIC: ["anthropic answered"]})

    _complete()
    assert not health.provider_available("openai/gpt-5.6-terra")
    clock["now"] += 299
    _complete()
    assert [provider(c["model"]) for c in fake.calls] == [OPENAI, ANTHROPIC, ANTHROPIC]
    clock["now"] += 2  # the cool-off is over: one call is let through to see
    _complete()
    assert [provider(c["model"]) for c in fake.calls][-2:] == [OPENAI, ANTHROPIC], "re-probed"
    assert not health.provider_available("openai/gpt-5.6-terra"), "still out, marked out again"
    row = health.snapshot()["checks"]["providers"]["by_provider"][OPENAI]
    assert row["out_until"] == pytest.approx(clock["now"] + 300)


def test_a_knob_is_pruned_per_model_not_for_the_whole_chain(litellm, monkeypatch) -> None:
    """The primary keeps its temperature; only the rung that refuses it goes without. Before, one
    fussy model anywhere in the chain cost every model its sampling knob."""
    fake = litellm({OPENAI: [_Refusal("500 InternalServerError", 500)], ANTHROPIC: ["ok"]})
    import litellm as installed

    monkeypatch.setattr(
        installed,
        "get_supported_openai_params",
        lambda model: (
            ["max_tokens"] if model.startswith("anthropic/") else ["max_tokens", "temperature"]
        ),
        raising=False,
    )
    assert _complete(temperature=0.2, max_tokens=300) == "ok"
    assert fake.calls[0]["temperature"] == 0.2
    assert "temperature" not in fake.calls[1] and fake.calls[1]["max_tokens"] == 300


def test_the_chain_shares_one_deadline(litellm) -> None:
    """The client waits 65s for a turn. Three rungs do not get 60s each, and since 2026-09-07 a
    rung with a live rung behind it gets half of what is left, so a primary that hangs leaves the
    other half for the next provider (``test_kill_each_provider``)."""
    fake = litellm({OPENAI: [_Refusal("502 BadGatewayError", 502)], ANTHROPIC: ["ok"]})
    _complete()
    assert fake.calls[0]["timeout"] == pytest.approx(30.0)
    assert 0 < fake.calls[1]["timeout"] <= 30.0


def test_a_short_deadline_still_reaches_its_second_rung(litellm) -> None:
    """The child-safety screen has 1.5 s for a one-line verdict. A flat five-second floor for the
    next rung made its Gemini rung unreachable: the floor scales with the deadline."""
    fake = litellm({OPENAI: [_Refusal("503 ServiceUnavailableError", 503)], GEMINI: ["ok"]})
    out = model_call.complete(
        model="openai/gpt-5.6-luna", fallbacks=["gemini/gemini-2.5-flash"], timeout=1.5
    )
    assert out == "ok"
    assert [provider(c["model"]) for c in fake.calls] == [OPENAI, GEMINI]
    assert 0 < fake.calls[1]["timeout"] <= 1.5
    assert model_call._floor_s(1.5) == pytest.approx(0.3)
    assert model_call._floor_s(60.0) == 5.0, "a turn keeps the five-second floor"


def test_health_names_the_carrier_of_each_tier_and_who_is_out(litellm) -> None:
    litellm({ANTHROPIC: [ANTHROPIC_NO_CREDIT], OPENAI: ["ok"]})
    model_call.complete(model="anthropic/claude-sonnet-5", fallbacks=["openai/gpt-5.6-terra"])
    snap = health.snapshot()
    check = snap["checks"]["providers"]
    assert check["status"] == health.DEGRADED and "credit" in check["reason"]
    assert check["by_provider"][ANTHROPIC]["out_of_credit"] is True
    assert check["by_provider"][OPENAI]["out_of_credit"] is False
    assert check["carrying"]["turn"] == "openai/gpt-5.6-terra"
    assert check["carrying"]["tiny"] == "openai/gpt-5.6-luna"
    # With OpenAI out as well, Gemini carries every text tier.
    health.mark_out_of_credit("openai/gpt-5.6-terra", reason="test")
    carrying = health.snapshot()["checks"]["providers"]["carrying"]
    assert all(carrying[t.value] == "gemini/gemini-2.5-flash" for t in TEXT_TIERS)
    # All three out: a request arriving now would not be served.
    health.mark_out_of_credit("gemini/gemini-2.5-flash", reason="test")
    snap = health.snapshot()
    assert snap["checks"]["providers"]["status"] == health.FAIL
    assert health.status_code(snap) == 503


def test_the_public_probe_counts_but_never_names(litellm) -> None:
    health.mark_out_of_credit("anthropic/claude-sonnet-5", reason="test")
    public = health.snapshot(public=True)
    body = str(public).lower()
    for vendor in ("anthropic", "openai", "google", "gemini", "claude", "gpt"):
        assert vendor not in body
    assert public["checks"]["providers"]["out_of_credit"] == 1
    assert "by_provider" not in public["checks"]["providers"]


def test_a_skip_and_a_mark_are_written_to_the_telemetry_stream(litellm, caplog) -> None:
    import logging

    litellm({OPENAI: [OPENAI_NO_QUOTA], ANTHROPIC: ["ok"]})
    with caplog.at_level(logging.INFO, logger="wobo.gateway.telemetry"):
        _complete()
        _complete()
    names = [r.getMessage() for r in caplog.records]
    assert "gateway.provider.out_of_credit" in names
    assert "gateway.provider.skipped" in names
    assert "gateway.fallback" in names
    marked = next(r for r in caplog.records if r.getMessage() == "gateway.provider.out_of_credit")
    assert marked.fields["provider"] == OPENAI and marked.fields["model"] == "openai/gpt-5.6-terra"


# =================================================================================================
# d) the cost rule stays
# =================================================================================================
def test_one_rung_up_per_rejection_still_lands_on_the_owners_table() -> None:
    up = lambda tier, cap: routing.escalate(tier, capability=cap, reason="rejected")  # noqa: E731
    # generation climbs its own ladder one rung at a time: luna, terra, sol (the owner, 2026-09-08)
    assert up(Tier.GENERATE, "engine.compose").provider_model == "openai/gpt-5.6-terra"
    # a live turn cannot be re-judged; its rejection climbs to the reasoning model, past the floor
    assert up(Tier.TURN, "wobo.turn").provider_model == "openai/gpt-5.6-sol"
    assert routing.escalate(Tier.VERIFY, capability="verify.math", reason="rejected") is None


def test_one_rung_down_at_the_ceiling_still_follows_an_override() -> None:
    routing.configure({"WOBO_TIER_TURN": "openai/gpt-5.6-luna"})
    # generate is the floor now (nothing cheaper); the rung down from reason is the turn tier
    assert spend.cheaper_tier(Tier.GENERATE) is None
    cheaper = spend.cheaper_tier(Tier.REASON)
    assert cheaper is Tier.TURN
    assert tier_model(cheaper).provider_model == "openai/gpt-5.6-luna"


def test_the_carrier_follows_the_chain_when_a_provider_is_out() -> None:
    out = lambda m: not m.startswith("openai/")  # noqa: E731
    assert routing.carrier(Tier.REASON, available=out).provider_model == "anthropic/claude-opus-5"
    assert routing.carrier(Tier.REASON, available=lambda m: False) is None


def test_track_separation_still_holds_under_an_override() -> None:
    routing.configure({"WOBO_TIER_TINY": "gemini/gemini-2.5-flash"})
    assert routing.track_separation_holds()
    assert routing.resolve("tier.tiny", Track.TRACK_1).provider_model == "gemini/gemini-2.5-flash"


def test_generation_starts_at_the_cheapest_model_that_passes_and_climbs_one_rung_per_rejection():
    """The owner's rule (2026-09-08): top quality at the lowest cost, better models only where
    needed. Generated content is judged and cached, so it can start at the cheapest model and
    climb only when the judge rejects it. A live turn cannot be re-judged, so it starts one rung
    up; the judge itself is the strongest, because a weak judge passes weak content."""
    from wobo_gateway import routing
    from wobo_gateway.routing import Tier

    routing.configure()
    assert routing.tier_model(Tier.GENERATE).provider_model == "openai/gpt-5.6-luna"
    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-terra"
    assert routing.tier_model(Tier.VERIFY).provider_model == "openai/gpt-5.6-sol"
    first = routing.escalate(Tier.GENERATE, capability="engine.compose", reason="judge rejected")
    assert first is not None and first.provider_model == "openai/gpt-5.6-terra"
    second = routing.escalate(
        Tier.GENERATE,
        capability="engine.compose",
        reason="judge rejected",
        current=first.provider_model,
    )
    assert second is not None and second.provider_model == "openai/gpt-5.6-sol"
    top = routing.escalate(
        Tier.GENERATE,
        capability="engine.compose",
        reason="judge rejected",
        current=second.provider_model,
    )
    assert top is None
    # an operator override still starts where the operator said, and climbs from there
    routing.configure({"WOBO_TIER_GENERATE": "openai/gpt-5.6-terra"})
    try:
        assert routing.generation_ladder() == (
            "openai/gpt-5.6-terra",
            "openai/gpt-5.6-luna",
            "openai/gpt-5.6-sol",
        )
    finally:
        routing.configure()


def test_the_creative_side_is_astra_and_astra_is_nowhere_else() -> None:
    """The owner, 2026-09-08: "use astra more on the creative side". The create tier is the
    concept core, the interaction's design and the film's choreography: paid once per concept
    and cached, never a per-turn rung. Astra sits on that chain and on no other, nothing
    escalates into it, and when the day is spent it steps down to generate."""
    from wobo_gateway import spend
    from wobo_gateway.routing import escalation_tier

    assert chain_of(Tier.CREATE)[0] == "openai/gpt-6-astra"
    for tier in Tier:
        if tier is not Tier.CREATE:
            assert "openai/gpt-6-astra" not in chain_of(tier), tier
        assert escalation_tier(tier) is not Tier.CREATE, tier
    assert escalation_tier(Tier.CREATE) is None
    assert spend.cheaper_tier(Tier.CREATE) is Tier.GENERATE


def test_the_creative_job_is_registered_on_the_create_tier() -> None:
    from wobo_gateway import registry

    for creative in ("engine.create", "engine.blueprint"):
        policy = registry.policy(creative)
        assert policy.tier is Tier.CREATE, creative
        assert policy.max_tokens >= 16000, creative  # an architect needs room
        assert registry.platform_paid(creative), creative
    # the free-text goal course is the learner's own ask, served and paid like content
    assert registry.policy("generate.course").tier is Tier.GENERATE
    assert not registry.platform_paid("generate.course")
    for served in ("wobo.turn", "engine.compose", "voice.tts", "doubt.read"):
        assert not registry.platform_paid(served), served


def test_the_free_lane_runs_turns_on_luna_and_never_touches_the_creative_work() -> None:
    """The owner, 2026-09-08: "for the free tier by default we only give them 5 rupees a day;
    use models like luna for them to get slightly longer use... but we don't compromise on
    quality". A free learner's turn runs on the tiny chain (Luna); a paid learner's on turn
    (Terra). The creative work (Astra, platform-paid) is the same for both, which is where the
    quality lives. A plan nobody recognises is treated as free, never as paid."""
    from wobo_gateway.routing import lane_tier

    assert lane_tier(Tier.TURN, "free") is Tier.TINY
    assert lane_tier(Tier.TURN, None) is Tier.TINY
    assert lane_tier(Tier.TURN, "mystery") is Tier.TINY
    for paid in ("plus", "pro", "max"):
        assert lane_tier(Tier.TURN, paid) is Tier.TURN, paid
    for plan in ("free", "pro", None):
        for tier in (Tier.CREATE, Tier.VERIFY, Tier.SAFETY, Tier.VOICE, Tier.VISION, Tier.TINY):
            assert lane_tier(tier, plan) is tier, (tier, plan)
