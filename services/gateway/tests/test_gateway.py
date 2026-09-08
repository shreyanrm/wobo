"""Gateway tests. Mock mode only — no provider is ever called and litellm is never imported.

Every HTTP call carries a real HS256 token minted by the ``auth`` fixture (conftest): the
suite goes through the same door production does.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from wobo_gateway.app import (
    CapabilityRequest,
    ConsentDenied,
    Gateway,
    create_app,
)
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.registry import (
    EXPECTED_CAPABILITIES,
    ConsentTier,
    capabilities,
    escalate_for,
    policy,
    validate_registry,
)
from wobo_gateway.routing import (
    Tier,
    Track,
    escalate,
    models_for,
    resolve,
    resolve_any,
    tier_fallbacks,
    tier_model,
    track_separation_holds,
)
from wobo_gateway.telemetry import MetricsSink

ELEVATED_ONLY = ("archetype.classify", "peakcut.evaluate")


def make_gateway(sink: MetricsSink | None = None) -> Gateway:
    return Gateway(MockProvider(), InMemoryCache(), sink or MetricsSink())


def req(tier: ConsentTier, **payload: object) -> CapabilityRequest:
    return CapabilityRequest(consent_tier=tier, payload=dict(payload))


# --- registry completeness ------------------------------------------------------------
def test_registry_is_complete_and_valid() -> None:
    validate_registry()  # raises on a malformed registry
    assert set(capabilities()) == set(EXPECTED_CAPABILITIES)
    assert len(capabilities()) == len(EXPECTED_CAPABILITIES)
    for name in capabilities():
        assert policy(name).capability == name


# --- track separation invariant -------------------------------------------------------
def test_tracks_are_never_conflated() -> None:
    assert track_separation_holds()
    t1, t2 = models_for(Track.TRACK_1), models_for(Track.TRACK_2)
    assert set(t1) & set(t2) == set()
    t1_models = {m.provider_model for m in t1.values()}
    t2_models = {m.provider_model for m in t2.values()}
    assert t1_models & t2_models == set()
    # every policy's primary lives on its own declared track
    for name in capabilities():
        pol = policy(name)
        assert resolve(pol.primary, pol.track).track is pol.track
    # Every capability routes on a Track-1 tier today: the Track-2 SLM slots are declared but
    # unfilled, and routing a live learner at a placeholder id bought an error on every call.
    for name in capabilities():
        assert policy(name).track is Track.TRACK_1
    assert policy("wobo.turn").cache_tier.value == "none"  # a live turn is never cached


# --- the owner's tiers (WOBO-PLAN §9) -------------------------------------------------
# Owner, 2026-09-05: OpenAI first on every text tier (terra, luna, sol), Anthropic second as the
# cross-provider second opinion, Gemini last. Said on the day Anthropic was out of credit.
TIER_TABLE = {
    Tier.TINY: ("openai/gpt-5.6-luna", "anthropic/claude-haiku-4-5"),
    Tier.TURN: ("openai/gpt-5.6-terra", "anthropic/claude-sonnet-5"),
    # Owner, 2026-09-08: generation starts at the CHEAPEST model that passes and climbs one rung per
    # judge rejection (luna, terra, sol); its outage chain stays cross-provider at the same class.
    Tier.GENERATE: ("openai/gpt-5.6-luna", "anthropic/claude-haiku-4-5"),
    Tier.REASON: ("openai/gpt-5.6-sol", "anthropic/claude-opus-5"),
    Tier.VERIFY: ("openai/gpt-5.6-sol", "anthropic/claude-opus-5"),
}


@pytest.mark.parametrize("tier,expected", TIER_TABLE.items(), ids=lambda v: getattr(v, "value", ""))
def test_each_tier_resolves_to_the_owners_models(tier: Tier, expected: tuple[str, str]) -> None:
    primary, fallback = expected
    assert tier_model(tier).provider_model == primary
    chain = [resolve_any(n).provider_model for n in tier_fallbacks(tier)]
    # The named fallback is still first. What follows it is a THIRD provider: two is not
    # redundancy when one account can run dry and the other can refuse a parameter, which is
    # exactly what happened on 2026-09-04 and left a learner with no answer at all.
    assert chain[:1] == [fallback]
    assert chain[-1].startswith("gemini/"), "every text chain ends at a third provider"
    assert len({m.split("/")[0] for m in [primary, *chain]}) == 3


def test_every_fallback_crosses_providers() -> None:
    """A second opinion from the same provider is not a second opinion."""
    for tier in TIER_TABLE:
        primary = tier_model(tier).provider_model.split("/")[0]
        for name in tier_fallbacks(tier):
            assert resolve_any(name).provider_model.split("/")[0] != primary


RETIRED = ("claude-opus-4-8", "gpt-5.5", "gpt-4.1")


def test_the_retired_models_are_gone_from_the_router() -> None:
    """Owner, 2026-09-02: Opus 4.8, GPT-5.5 and GPT-4.1 are retired from the router."""
    live = {m.provider_model for m in models_for(Track.TRACK_1).values()}
    live |= {m.provider_model for m in models_for(Track.TRACK_2).values()}
    for retired in RETIRED:
        assert not any(retired in model for model in live), retired
    for name in capabilities():
        pol = policy(name)
        resolved = [resolve(pol.primary, pol.track).provider_model]
        resolved += [resolve_any(n).provider_model for n in pol.fallback]
        for retired in RETIRED:
            assert not any(retired in model for model in resolved), (name, retired)


def test_every_capability_declares_a_tier_and_routes_on_it() -> None:
    from wobo_gateway.routing import DEFAULT_TABLE

    for name in capabilities():
        pol = policy(name)
        # The text tiers above, or one of the shaped chains (vision, safety) the router declares.
        # Voice and image have no capability of their own.
        assert pol.tier in TIER_TABLE or pol.tier in DEFAULT_TABLE, name
        assert resolve(pol.primary, pol.track).provider_model == tier_model(pol.tier).provider_model
        assert pol.max_tokens > 0 and pol.cost_ceiling > 0 and pol.max_latency_ms > 0


def test_the_cost_rule_escalates_one_tier_and_logs_the_reason(caplog) -> None:
    """Generation runs on the cheapest model that passes verification; a rejection escalates
    ONE rung, and the reason is logged so the hard list stays honest."""
    import logging

    with caplog.at_level(logging.INFO, logger="wobo.gateway.telemetry"):
        escalated = escalate_for("engine.compose", "verifier rejected the derivation")
    # generation climbs its own ladder one rung at a time: luna -> terra, never straight to sol
    assert escalated == "openai/gpt-5.6-terra"
    line = next(r for r in caplog.records if r.getMessage() == "gateway.escalation")
    assert line.fields["reason"] == "verifier rejected the derivation"
    assert line.fields["from_tier"] == "generate" and line.fields["model"] == "openai/gpt-5.6-terra"


def test_the_top_of_the_ladder_does_not_escalate() -> None:
    assert escalate(Tier.VERIFY, capability="verify.math", reason="rejected") is None


def test_the_plexus_engines_legacy_names_land_on_the_right_rungs() -> None:
    """plexus.engines._spawn_validation resolves these two by name (that module is not this
    wave's to edit). The JUDGE must be the verify tier — always the other provider from the
    GPT-5.6 generator — and the REBUILD target one rung above generate, the reason tier."""
    assert resolve("frontier.reason", Track.TRACK_1).provider_model == TIER_TABLE[Tier.VERIFY][0]
    assert resolve("openai.frontier", Track.TRACK_1).provider_model == TIER_TABLE[Tier.REASON][0]


# --- consent-tier gating --------------------------------------------------------------
@pytest.mark.parametrize("cap", ELEVATED_ONLY)
def test_elevated_only_denied_under_un_elevated(cap: str) -> None:
    with pytest.raises(ConsentDenied):
        make_gateway().invoke(cap, req(ConsentTier.UN_ELEVATED), ConsentTier.UN_ELEVATED)


@pytest.mark.parametrize("cap", ELEVATED_ONLY)
def test_elevated_only_allowed_when_elevated(cap: str) -> None:
    resp = make_gateway().invoke(cap, req(ConsentTier.ELEVATED), ConsentTier.ELEVATED)
    assert resp.capability == cap


def test_teaching_capabilities_work_under_both_tiers() -> None:
    gw = make_gateway()
    for tier in (ConsentTier.UN_ELEVATED, ConsentTier.ELEVATED):
        resp = gw.invoke("tutor.turn", req(tier), tier)
        assert resp.output["handed_answer"] is False


# --- mock determinism + cache ---------------------------------------------------------
def test_mock_is_deterministic_across_fresh_gateways() -> None:
    r1 = make_gateway().invoke("grade.attempt", req(ConsentTier.UN_ELEVATED, attempt="2x=4"))
    r2 = make_gateway().invoke("grade.attempt", req(ConsentTier.UN_ELEVATED, attempt="2x=4"))
    assert r1.output == r2.output
    assert r1.model == r2.model
    assert r1.track == "track_1"
    assert r1.cache_hit is False and r2.cache_hit is False
    assert r1.tokens == r2.tokens


def test_cache_returns_hit_on_repeat() -> None:
    gw = make_gateway()
    first = gw.invoke("grade.attempt", req(ConsentTier.UN_ELEVATED, node="x"))
    second = gw.invoke("grade.attempt", req(ConsentTier.UN_ELEVATED, node="x"))
    assert first.cache_hit is False
    assert second.cache_hit is True
    assert second.output == first.output
    assert second.tokens == 0  # served from cache, no model call


# --- grade.attempt: a real live handler + honest telemetry (fix, 2026-07-07) ----------
def test_grade_attempt_live_returns_correct_and_feedback(monkeypatch) -> None:
    """The live path has a DEDICATED handler returning {correct, feedback} (the mock's shape),
    not the generic {capability, message} — and it reports the model that actually answered."""
    import sys
    import types

    from wobo_gateway.providers import _grade_attempt

    fake = types.ModuleType("litellm")
    fake.drop_params = False
    resp_obj = types.SimpleNamespace(
        choices=[
            types.SimpleNamespace(
                message=types.SimpleNamespace(content='{"correct": true, "feedback": "clean work"}')
            )
        ],
        model="openai/gpt-5.6-terra",  # the fallback answered, not the primary
        usage=types.SimpleNamespace(total_tokens=42),
    )
    fake.completion = lambda **kwargs: resp_obj
    monkeypatch.setitem(sys.modules, "litellm", fake)

    out = _grade_attempt(
        provider_model="openai/gpt-5.6-terra",
        payload={"prompt": "2x = 4", "answer": "2"},
        fallbacks=("anthropic/claude-sonnet-5",),
    )
    assert out.output == {"correct": True, "feedback": "clean work"}
    assert out.tokens == 42
    assert out.model == "openai/gpt-5.6-terra"  # telemetry gets the model that answered


def test_gateway_reports_the_model_that_actually_answered_on_fallback() -> None:
    """When a provider reports a fallback model, telemetry and the response carry IT — never the
    tier primary that never ran."""
    from wobo_gateway.providers import ProviderResponse

    class FallbackProvider:
        def complete(self, *, provider_model, capability, payload, fallbacks=(), **_):  # noqa: ANN001
            return ProviderResponse(
                output={"correct": True, "feedback": "ok"},
                tokens=5,
                model="openai/gpt-5.6-terra",
            )

    sink = MetricsSink()
    gw = Gateway(FallbackProvider(), InMemoryCache(), sink)
    resp = gw.invoke("grade.attempt", req(ConsentTier.UN_ELEVATED, attempt="2x=4"))
    # the policy primary is the turn tier; the fallback rung actually answered
    assert (
        resolve(policy("grade.attempt").primary, policy("grade.attempt").track).provider_model
        == "openai/gpt-5.6-terra"
    )
    assert resp.model == "openai/gpt-5.6-terra"
    assert sink.events[-1].model == "openai/gpt-5.6-terra"


def test_peakcut_never_caches() -> None:
    gw = make_gateway()
    elevated = ConsentTier.ELEVATED
    first = gw.invoke("peakcut.evaluate", req(elevated, learner="a"), elevated)
    second = gw.invoke("peakcut.evaluate", req(elevated, learner="a"), elevated)
    assert first.cache_hit is False and second.cache_hit is False


# --- telemetry ------------------------------------------------------------------------
def test_telemetry_records_each_invocation() -> None:
    sink = MetricsSink()
    make_gateway(sink).invoke("wobo.turn", req(ConsentTier.UN_ELEVATED, t=1))
    assert len(sink.events) == 1
    ev = sink.events[0]
    assert ev.capability == "wobo.turn"
    assert ev.track == "track_1"
    assert ev.cache_hit is False
    assert ev.tokens > 0


# --- http surface ---------------------------------------------------------------------
def test_http_surface(auth) -> None:
    from fastapi.testclient import TestClient

    client = TestClient(create_app(make_gateway()))
    headers = auth()

    assert client.get("/healthz").json()["status"] == "ok"

    caps = client.get("/v1/capabilities", headers=headers).json()
    assert len(caps) == len(EXPECTED_CAPABILITIES)

    # the body says un_elevated and is ignored; the derived tier (no stored record -> the
    # least-privilege default) is what closes the elevated-only door
    denied = client.post(
        "/v1/capability/archetype.classify",
        json={"consent_tier": "elevated", "payload": {}},
        headers=headers,
    )
    assert denied.status_code == 403
    assert denied.json()["code"] == "not_allowed"

    ok = client.post(
        "/v1/capability/tutor.turn",
        json={"payload": {}},
        headers=headers,
    )
    assert ok.status_code == 200
    assert ok.json()["track"] == "track_1"

    unknown = client.post(
        "/v1/capability/nope.turn",
        json={"payload": {}},
        headers=headers,
    )
    assert unknown.status_code == 404


# --- the dossier: identity + facts ride every Wobo turn (WOBO.md §7) -----------------
def test_dossier_renders_identity_and_facts() -> None:
    from wobo_gateway.wobo import _build_user_prompt

    context = {
        "lifetime": {
            "learner": {"name": "Ravi", "age": 14, "grade": "Class 9", "board": "CBSE"},
            "facts": ["exam Friday"],
            "twinSummary": "into cricket",
        }
    }
    prompt = _build_user_prompt(context, None)
    assert "Who you are teaching" in prompt
    assert "Ravi" in prompt
    assert "exam Friday" in prompt
    assert "cricket" in prompt


def test_dossier_is_empty_when_nothing_is_known() -> None:
    from wobo_gateway.wobo import _build_user_prompt

    prompt = _build_user_prompt({}, None)
    assert "Who you are teaching" not in prompt


def test_machine_room_renders_internal_state() -> None:
    from wobo_gateway.wobo import _build_user_prompt

    context = {
        "machine": {
            "progress": {"xp": 100, "level": 2, "intoLevel": 20, "toNext": 100, "streakDays": 4},
            "masteryBands": {"developing": 3, "secure": 2},
            "reviews": {
                "dueCount": 3,
                "scheduled": 5,
                "next": [{"node": "linear-equations", "inMinutes": 0}],
            },
            "generating": {"what": "a course on photosynthesis"},
            "eventTail": ["practice.item.answered (wrong, hesitated)", "learn.node.completed"],
        }
    }
    prompt = _build_user_prompt(context, None)
    assert "Machine room" in prompt
    # how far to level N, answered exactly
    assert "level 2 (20 xp in, 100 to level 3)" in prompt
    assert "4-day streak" in prompt
    # the mastery snapshot, secure before developing (band priority)
    assert "2 secure, 3 developing" in prompt
    # the due queue with a time estimate
    assert "3 due now of 5 scheduled" in prompt
    assert "linear-equations now" in prompt
    # in-flight generation and the hesitation signal
    assert "photosynthesis" in prompt
    assert "hesitated" in prompt


def test_machine_room_is_empty_when_nothing_is_known() -> None:
    from wobo_gateway.wobo import _build_user_prompt

    prompt = _build_user_prompt({}, None)
    assert "Machine room" not in prompt


def test_mock_turn_answers_the_name_question() -> None:
    from wobo_gateway.wobo import mock_wobo_turn

    out = mock_wobo_turn(
        {
            "context": {
                "lifetime": {"learner": {"name": "Ravi"}},
                "turn": {"lastUserInput": "what's my name?"},
            }
        }
    )
    assert "Ravi" in out["say"]


def test_mock_turn_remembers_a_preferred_name() -> None:
    from wobo_gateway.wobo import mock_wobo_turn

    out = mock_wobo_turn({"context": {"turn": {"lastUserInput": "call me Ravi"}}})
    remembers = [a for a in out["actions"] if a.get("type") == "remember"]
    assert remembers and "Ravi" in remembers[0]["text"]


# --- voice ------------------------------------------------------------------------------
def test_voice_session_is_unavailable_without_a_key(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    from fastapi.testclient import TestClient

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_AI_API_KEY", raising=False)
    client = TestClient(create_app(make_gateway()))
    assert client.get("/v1/voice/session", headers=auth()).json() == {"mode": "unavailable"}


def test_cors_allows_our_vercel_preview_origins_outside_prod(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENV", "dev")
    client = TestClient(create_app(make_gateway()))
    r = client.options(
        "/v1/capability/wobo.turn",
        headers={
            "origin": "https://wobo-abc123xyz-depl-shreyan.vercel.app",
            "access-control-request-method": "POST",
        },
    )
    assert r.status_code == 200
    # arbitrary third-party vercel apps stay blocked
    r2 = client.options(
        "/v1/capability/wobo.turn",
        headers={
            "origin": "https://evil-depl-shreyan.vercel.app",
            "access-control-request-method": "POST",
        },
    )
    assert r2.status_code == 400


def test_prod_cors_is_exactly_the_one_app_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    """A per-deploy preview pattern is a dev convenience. Under ENV=prod the trust boundary is
    the single APP_URL origin — anyone who can land a build on the preview pattern would
    otherwise hold a credentialed cross-origin door into production."""
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "x" * 32)
    # Prod refuses to boot without a project to pin the token issuer to (validate_env).
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    from wobo_gateway import app as app_mod

    assert app_mod._preview_origin_regex() is None

    client = TestClient(create_app(make_gateway()))
    preview = client.options(
        "/v1/capability/wobo.turn",
        headers={
            "origin": "https://wobo-abc123xyz-depl-shreyan.vercel.app",
            "access-control-request-method": "POST",
        },
    )
    assert preview.status_code == 400
    allowed = client.options(
        "/v1/capability/wobo.turn",
        headers={
            "origin": app_mod.APP_URL,
            "access-control-request-method": "POST",
        },
    )
    assert allowed.status_code == 200


def test_voice_tts_is_503_without_a_key(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    from fastapi.testclient import TestClient

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_AI_API_KEY", raising=False)
    client = TestClient(create_app(make_gateway()))
    r = client.post("/v1/voice/tts", json={"text": "hello"}, headers=auth())
    assert r.status_code == 503


def test_voice_tts_rejects_oversized_text(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    from fastapi.testclient import TestClient

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    client = TestClient(create_app(make_gateway()))
    r = client.post("/v1/voice/tts", json={"text": "x" * 601}, headers=auth())
    assert r.status_code == 422


# --- boot posture: env validation, CORS lockdown, rate limiting ------------------------
def test_live_mode_without_anthropic_key_fails_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_MODE", "live")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        create_app(make_gateway())


def test_unknown_llm_mode_fails_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_MODE", "yolo")
    with pytest.raises(RuntimeError, match="LLM_MODE"):
        create_app(make_gateway())


def test_prod_cors_excludes_localhost(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    from wobo_gateway import app as app_mod

    client = TestClient(create_app(make_gateway()))
    preflight = {"Access-Control-Request-Method": "POST"}

    # the one allowed origin is APP_URL itself, whatever the host set it to
    allowed = client.options(
        "/v1/capabilities",
        headers={"Origin": app_mod.APP_URL, **preflight},
    )
    assert allowed.headers["access-control-allow-origin"] == app_mod.APP_URL

    denied = client.options(
        "/v1/capabilities",
        headers={"Origin": "http://localhost:5173", **preflight},
    )
    assert "access-control-allow-origin" not in denied.headers


def test_dev_cors_allows_localhost(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    monkeypatch.setenv("ENV", "dev")
    client = TestClient(create_app(make_gateway()))
    ok = client.options(
        "/v1/capabilities",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_capability_routes_are_rate_limited_per_subject(
    monkeypatch: pytest.MonkeyPatch, auth
) -> None:
    import time
    from types import SimpleNamespace

    from fastapi.testclient import TestClient

    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "3")
    # pin the wall clock so all four posts land in one rate-limit window
    monkeypatch.setattr(
        "wobo_gateway.app.time",
        SimpleNamespace(time=lambda: 1_000_000.0, perf_counter=time.perf_counter),
    )
    client = TestClient(create_app(make_gateway()))
    body = {"payload": {}}
    headers = auth()

    statuses = [
        client.post("/v1/capability/tutor.turn", json=body, headers=headers).status_code
        for _ in range(4)
    ]
    assert statuses[:3] == [200, 200, 200]
    assert statuses[3] == 429

    # a DIFFERENT learner has their own bucket — one noisy account never throttles the school
    other = client.post("/v1/capability/tutor.turn", json=body, headers=auth("someone-else"))
    assert other.status_code == 200

    # non-capability routes are never limited
    assert client.get("/healthz").status_code == 200
    assert client.get("/v1/capabilities", headers=headers).status_code == 200


def test_second_concurrent_generation_gets_429_retry_after(tmp_path, monkeypatch, auth) -> None:
    """A content engine allows one generation per learner; a second in-flight one → 429.

    The slot is keyed on the VERIFIED SUBJECT, not on ``payload["user"]`` — so the pretend
    in-flight generation is registered under the token's subject, and a body that names someone
    else changes nothing."""
    from fastapi.testclient import TestClient
    from wobo_gateway.plexus import engines

    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    client = TestClient(create_app(make_gateway()))
    body = {"payload": {"concept": "fractions", "user": "u1"}}
    headers = auth("busy-learner")

    engines._gen_in_flight.add("busy-learner")  # their first generation is still cooking
    try:
        resp = client.post("/v1/capability/engine.compose", json=body, headers=headers)
    finally:
        engines._gen_in_flight.discard("busy-learner")
    assert resp.status_code == 429
    assert resp.headers["Retry-After"]
    assert resp.json()["code"] == "generation_in_flight"

    # with the slot free, the same call succeeds
    ok = client.post("/v1/capability/engine.compose", json=body, headers=headers)
    assert ok.status_code == 200
    assert ok.json()["output"]["verified"] is True
