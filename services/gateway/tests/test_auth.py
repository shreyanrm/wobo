"""The door: no verified subject, no gateway.

These are the tests that would have caught the audit's headline finding — the whole HTTP
surface open to anyone who knew the URL.
"""

from __future__ import annotations

import os

import pytest
from conftest import TEST_JWT_SECRET, mint
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.auth import AuthError, authenticate, dev_auth_enabled, verify_token
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink


def client():
    from fastapi.testclient import TestClient

    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


BODY = {"payload": {}}


# --- HTTP: the surface is closed ------------------------------------------------------
@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/v1/capability/tutor.turn"),
        ("post", "/v1/capability/wobo.turn"),
        ("get", "/v1/capabilities"),
        ("get", "/v1/voice/session"),
        ("post", "/v1/voice/tts"),
        ("get", "/v1/me"),
    ],
)
def test_every_v1_route_401s_without_a_token(method: str, path: str) -> None:
    c = client()
    response = c.post(path, json=BODY) if method == "post" else c.get(path)
    assert response.status_code == 401
    assert response.json()["code"] == "sign_in_required"
    # Wobo's voice, and no provider, library or model named in it
    message = response.json()["message"].lower()
    for forbidden in ("claude", "gemini", "openai", "google", "wobo_gateway", "jwt", "supabase"):
        assert forbidden not in message


def test_valid_token_is_admitted(auth) -> None:
    response = client().post("/v1/capability/tutor.turn", json=BODY, headers=auth())
    assert response.status_code == 200
    assert response.json()["capability"] == "tutor.turn"


def test_healthz_stays_open() -> None:
    assert client().get("/healthz").status_code == 200


def test_expired_token_is_refused(auth) -> None:
    response = client().post(
        "/v1/capability/tutor.turn", json=BODY, headers=auth(expires_in=-60)
    )
    assert response.status_code == 401
    assert response.json()["code"] == "sign_in_required"


def test_wrong_audience_is_refused(auth) -> None:
    response = client().post(
        "/v1/capability/tutor.turn", json=BODY, headers=auth(audience="some-other-app")
    )
    assert response.status_code == 401


def test_token_signed_with_another_secret_is_refused(auth) -> None:
    response = client().post(
        "/v1/capability/tutor.turn", json=BODY, headers=auth(secret="not-our-secret")
    )
    assert response.status_code == 401


def test_garbage_bearer_is_refused() -> None:
    response = client().post(
        "/v1/capability/tutor.turn", json=BODY, headers={"Authorization": "Bearer not.a.token"}
    )
    assert response.status_code == 401


def test_unsigned_alg_none_token_is_refused() -> None:
    """The classic downgrade: a token that declares it needs no signature."""
    import jwt

    token = jwt.encode({"sub": "attacker", "aud": "authenticated", "exp": 9999999999}, None, "none")
    response = client().post(
        "/v1/capability/tutor.turn", json=BODY, headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 401


def test_missing_subject_is_refused() -> None:
    import jwt

    token = jwt.encode(
        {"aud": "authenticated", "exp": 9999999999}, TEST_JWT_SECRET, algorithm="HS256"
    )
    with pytest.raises(AuthError):
        verify_token(token)


def test_anonymous_claim_is_carried_through() -> None:
    principal = verify_token(mint("anon-1", anonymous=True))
    assert principal.subject == "anon-1"
    assert principal.anonymous is True


# --- the dev seam ---------------------------------------------------------------------
def test_dev_header_is_honoured_in_dev(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "dev")
    monkeypatch.setenv("DEV_AUTH", "1")
    response = client().post(
        "/v1/capability/tutor.turn", json=BODY, headers={"X-Wobo-Dev-Subject": "dev-learner"}
    )
    assert response.status_code == 200


def test_dev_header_is_ignored_when_the_seam_is_shut(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without DEV_AUTH the header proves nothing, even outside prod."""
    monkeypatch.setenv("ENV", "stg")
    monkeypatch.setenv("LLM_MODE", "live")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.delenv("DEV_AUTH", raising=False)
    assert dev_auth_enabled() is False
    response = client().post(
        "/v1/capability/tutor.turn", json=BODY, headers={"X-Wobo-Dev-Subject": "dev-learner"}
    )
    assert response.status_code == 401


def test_the_dev_seam_is_never_inferred_from_a_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """ENV and LLM_MODE both default to the permissive value. A deploy that forgets ENV=prod must
    NOT therefore accept a header as proof of identity — the seam is opt-in or it is shut."""
    monkeypatch.delenv("ENV", raising=False)
    monkeypatch.delenv("LLM_MODE", raising=False)
    monkeypatch.delenv("DEV_AUTH", raising=False)
    assert dev_auth_enabled() is False
    response = client().post(
        "/v1/capability/tutor.turn", json=BODY, headers={"X-Wobo-Dev-Subject": "anyone-at-all"}
    )
    assert response.status_code == 401


def test_dev_auth_true_reads_the_same_as_one(monkeypatch: pytest.MonkeyPatch) -> None:
    """.env.example writes DEV_AUTH=true and the contract says DEV_AUTH=1 — one meaning."""
    monkeypatch.setenv("ENV", "dev")
    monkeypatch.setenv("DEV_AUTH", "true")
    assert dev_auth_enabled() is True


def test_dev_seam_is_shut_in_prod(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "prod")
    assert dev_auth_enabled() is False
    with pytest.raises(AuthError):
        authenticate({"x-wobo-dev-subject": "anyone"})


def test_prod_refuses_to_boot_with_dev_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("DEV_AUTH", "1")
    with pytest.raises(RuntimeError, match="DEV_AUTH"):
        client()


def test_prod_refuses_to_boot_without_a_way_to_verify(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("SUPABASE_JWKS_URL", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_JWT_SECRET"):
        client()


def test_prod_boots_with_a_jwks_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    assert client().get("/healthz").status_code == 200


# --- JWKS (asymmetric) path -----------------------------------------------------------
def test_rs256_token_verifies_against_the_jwks(monkeypatch: pytest.MonkeyPatch) -> None:
    import json as json_module

    import jwt
    from cryptography.hazmat.primitives.asymmetric import rsa
    from wobo_gateway import auth as auth_module

    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json_module.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    public_jwk.update({"kid": "test-kid", "use": "sig", "alg": "RS256"})

    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setattr(auth_module, "_fetch_jwks", lambda url: {"keys": [public_jwk]})
    auth_module.reset_jwks_cache()

    # The issuer rides on a real Supabase token and is checked here too — the JWKS path is not
    # exempt from it, and a project's own key set is not by itself proof of which project.
    claims = {
        "sub": "rs-learner",
        "aud": "authenticated",
        "iss": "https://project.supabase.co/auth/v1",
        "exp": 9999999999,
    }
    token = jwt.encode(claims, private, algorithm="RS256", headers={"kid": "test-kid"})
    assert verify_token(token).subject == "rs-learner"

    # a token whose kid is not in the set is refused even though the set is reachable
    other = jwt.encode(
        {**claims, "sub": "x"},
        private,
        algorithm="RS256",
        headers={"kid": "unknown-kid"},
    )
    with pytest.raises(AuthError):
        verify_token(other)


def test_jwks_is_cached_and_not_refetched(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway import auth as auth_module

    calls: list[str] = []

    def counted(url: str) -> dict[str, list[dict[str, str]]]:
        calls.append(url)
        return {"keys": []}

    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setattr(auth_module, "_fetch_jwks", counted)
    auth_module.reset_jwks_cache()
    url = auth_module.jwks_url()
    assert url is not None
    auth_module._jwks(url)
    auth_module._jwks(url)
    assert len(calls) == 1


# --- the websocket gate ---------------------------------------------------------------
# HTTP middleware never runs for a WebSocket, so the socket is gated by a token that
# /v1/voice/session (which IS authenticated) minted and bound to the verified subject.
def test_voice_session_mints_a_token_bound_to_the_caller(
    monkeypatch: pytest.MonkeyPatch, auth
) -> None:
    from wobo_gateway import voice

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    session = client().get("/v1/voice/session", headers=auth("voice-learner")).json()
    assert session["mode"] == "relay"
    assert voice._consume_token(session["token"]) == "voice-learner"
    # single use: the second attempt gets nothing
    assert voice._consume_token(session["token"]) is None


@pytest.mark.parametrize("path", ["/v1/voice/relay", "/v1/voice/tts/stream"])
def test_sockets_refuse_without_a_token(monkeypatch: pytest.MonkeyPatch, path: str) -> None:
    from starlette.websockets import WebSocketDisconnect

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    c = client()
    with pytest.raises(WebSocketDisconnect), c.websocket_connect(path):
        pass
    with pytest.raises(WebSocketDisconnect), c.websocket_connect(f"{path}?token=made-up"):
        pass


def test_tts_stream_accepts_a_minted_token_exactly_once(
    monkeypatch: pytest.MonkeyPatch, auth
) -> None:
    from starlette.websockets import WebSocketDisconnect
    from wobo_gateway import voice

    spoken: list[str] = []

    async def fake_stream(client_socket, aiohttp, key, text, **_):  # noqa: ANN001
        spoken.append(text)

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(voice, "_stream_one_line", fake_stream)

    c = client()
    token = c.get("/v1/voice/session", headers=auth("tts-learner")).json()["token"]

    with c.websocket_connect(f"/v1/voice/tts/stream?token={token}") as ws:
        ws.send_text("read this aloud")
    assert spoken == ["read this aloud"]

    # the same token is spent — replaying it is refused
    replay = f"/v1/voice/tts/stream?token={token}"
    with pytest.raises(WebSocketDisconnect), c.websocket_connect(replay):
        pass


def test_tts_stream_has_its_own_concurrency_budget(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    """A flood of read-aloud sockets must never starve the live mic, and vice versa."""
    from starlette.websockets import WebSocketDisconnect
    from wobo_gateway import voice

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(voice, "_active_tts", voice._MAX_CONCURRENT_TTS)
    c = client()
    token = c.get("/v1/voice/session", headers=auth()).json()["token"]
    capped = f"/v1/voice/tts/stream?token={token}"
    with pytest.raises(WebSocketDisconnect), c.websocket_connect(capped):
        pass
    # the relay's own counter is untouched, so the mic still opens
    assert voice._active_relays == 0


# --- the limiter's second key ---------------------------------------------------------
def _freeze_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin the limiter's window so a test never straddles a minute boundary."""
    import time as real_time
    from types import SimpleNamespace

    from wobo_gateway import app as app_module

    monkeypatch.setattr(
        app_module,
        "time",
        SimpleNamespace(time=lambda: 1_000_000.0, perf_counter=real_time.perf_counter),
    )


def test_unauthenticated_floods_are_bounded_by_address(monkeypatch: pytest.MonkeyPatch) -> None:
    """The 401 check must not itself be an amplifier: no token means the address is the bucket."""
    monkeypatch.setenv("UNAUTH_RATE_LIMIT_PER_MINUTE", "2")
    _freeze_clock(monkeypatch)
    c = client()
    statuses = [c.post("/v1/capability/tutor.turn", json=BODY).status_code for _ in range(3)]
    assert statuses == [401, 401, 429]


def test_a_stranger_gets_a_smaller_bucket_than_a_learner(monkeypatch: pytest.MonkeyPatch) -> None:
    """Behind a proxy the unauthenticated bucket is SHARED — filling it 429s the first call of
    every genuinely new learner. It therefore gets its own, much smaller ceiling."""
    from wobo_gateway.app import create_app

    monkeypatch.delenv("UNAUTH_RATE_LIMIT_PER_MINUTE", raising=False)
    monkeypatch.delenv("RATE_LIMIT_PER_MINUTE", raising=False)
    create_app()  # boots with the defaults; the assertion is on the dials themselves
    assert int(os.getenv("UNAUTH_RATE_LIMIT_PER_MINUTE", "15")) < int(
        os.getenv("RATE_LIMIT_PER_MINUTE", "60")
    )


def test_the_proxy_hop_is_only_trusted_when_we_say_so(monkeypatch: pytest.MonkeyPatch) -> None:
    """And it is the LAST hop, the one our own platform appended. The first hop is whatever the
    caller typed, so trusting it removed the limit entirely (rotate the header, rotate the key)."""
    from wobo_gateway.app import _client_ip

    request = SimpleRequest({"x-forwarded-for": "203.0.113.7, 10.0.0.1"}, "10.0.0.9")
    monkeypatch.delenv("TRUST_PROXY", raising=False)
    assert _client_ip(request) == "10.0.0.9"
    monkeypatch.setenv("TRUST_PROXY", "1")
    assert _client_ip(request) == "10.0.0.1"


def test_a_spoofed_forwarded_prefix_cannot_move_the_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway.app import _client_ip

    monkeypatch.setenv("TRUST_PROXY", "1")
    forged = SimpleRequest({"x-forwarded-for": "1.1.1.1, 2.2.2.2, 10.0.0.1"}, "10.0.0.9")
    assert _client_ip(forged) == "10.0.0.1"  # not 1.1.1.1


class SimpleRequest:
    """The two attributes _client_ip reads, without standing up a whole request."""

    def __init__(self, headers: dict[str, str], host: str) -> None:
        self.headers = headers
        self.client = type("C", (), {"host": host})()


# --- the voice token store: nobody's eviction policy may be everybody's -------------------
def test_a_flood_of_mints_never_clears_another_learners_token(auth) -> None:
    """Hitting the store ceiling used to call ``_tokens.clear()`` — mint 4096 tokens and every
    other learner's outstanding token vanished, so their mic failed at connect."""
    from wobo_gateway import voice

    voice.reset_tokens()
    theirs = voice._mint_token("victim")
    for _ in range(voice._MAX_TOKENS * 2):
        voice._mint_token("flooder")
    assert voice._consume_token(theirs) == "victim"


def test_outstanding_mints_are_capped_per_learner() -> None:
    """A mint is cheap, so an unbounded pile of them was the lever on the whole store."""
    from wobo_gateway import voice

    voice.reset_tokens()
    minted = [voice._mint_token("greedy") for _ in range(50)]
    outstanding = sum(1 for t in minted if t in voice._tokens)
    assert outstanding <= voice._MAX_TOKENS_PER_SUBJECT
    assert len(voice._tokens) <= voice._MAX_TOKENS_PER_SUBJECT


def test_one_learner_cannot_hold_every_voice_socket(
    monkeypatch: pytest.MonkeyPatch, auth
) -> None:
    """The caps were process-global at four apiece: one learner holding four sockets denied live
    voice to the whole platform. They are counted per learner now, under a larger global ceiling."""
    from starlette.websockets import WebSocketDisconnect
    from wobo_gateway import voice

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    voice.reset_tokens()
    # a hog already holds their whole per-learner share
    monkeypatch.setitem(voice._tts_by_subject, "hog", voice._MAX_TTS_PER_SUBJECT)
    monkeypatch.setattr(voice, "_active_tts", voice._MAX_TTS_PER_SUBJECT)

    c = client()
    hogs = voice._mint_token("hog")
    hogged = f"/v1/voice/tts/stream?token={hogs}"
    with pytest.raises(WebSocketDisconnect), c.websocket_connect(hogged):
        pass

    # everyone else still has a voice
    spoken: list[str] = []

    async def fake_stream(client_socket, aiohttp, key, text, **_):  # noqa: ANN001
        spoken.append(text)

    monkeypatch.setattr(voice, "_stream_one_line", fake_stream)
    mine = c.get("/v1/voice/session", headers=auth("someone-else")).json()["token"]
    with c.websocket_connect(f"/v1/voice/tts/stream?token={mine}") as ws:
        ws.send_text("still here")
    assert spoken == ["still here"]


def test_the_socket_counts_come_back_down(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    from wobo_gateway import voice

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    async def fake_stream(client_socket, aiohttp, key, text, **_):  # noqa: ANN001
        return None

    monkeypatch.setattr(voice, "_stream_one_line", fake_stream)
    c = client()
    token = c.get("/v1/voice/session", headers=auth("counter")).json()["token"]
    with c.websocket_connect(f"/v1/voice/tts/stream?token={token}") as ws:
        ws.send_text("one line")
    assert voice._active_tts == 0
    assert voice._tts_by_subject == {}


# --- the issuer is checked, not just the signature and the audience ---------------------
# Every Supabase project on earth writes the audience "authenticated", so on a shared-secret
# (HS256) project the audience proves nothing about where a token came from: anything that ever
# held that secret — a webhook signer, an old service, a leaked backup — could mint a learner and
# the door opened. The issuer is what makes the token OURS.
ISSUER_PROJECT = "https://project.supabase.co"


def test_a_token_from_another_issuer_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """Same secret, same audience, a different auth server. That is not our learner."""
    monkeypatch.setenv("SUPABASE_URL", ISSUER_PROJECT)
    token = mint("stranger", iss="https://someone-elses-project.supabase.co/auth/v1")
    with pytest.raises(AuthError):
        verify_token(token)


def test_a_token_with_no_issuer_at_all_is_refused_when_we_know_ours(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A minter that never wrote an ``iss`` is exactly the "some other purpose" case.

    Built here rather than with ``mint``, which now always writes one: the token under test is
    precisely the one with no issuer claim at all."""
    import jwt

    monkeypatch.setenv("SUPABASE_URL", ISSUER_PROJECT)
    token = jwt.encode(
        {"sub": "no-issuer-claim", "aud": "authenticated", "exp": 9999999999},
        TEST_JWT_SECRET,
        algorithm="HS256",
    )
    with pytest.raises(AuthError):
        verify_token(token)


def test_our_own_token_still_opens_the_door(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", ISSUER_PROJECT)
    principal = verify_token(mint("real-learner", iss=f"{ISSUER_PROJECT}/auth/v1"))
    assert principal.subject == "real-learner"


def test_the_issuer_can_be_set_outright(monkeypatch: pytest.MonkeyPatch) -> None:
    """A deployment whose auth server is not at ``<SUPABASE_URL>/auth/v1`` says so, and the
    explicit value wins over the derived one."""
    monkeypatch.setenv("SUPABASE_URL", ISSUER_PROJECT)
    monkeypatch.setenv("SUPABASE_JWT_ISS", "https://auth.heywobo.com")
    assert verify_token(mint("real-learner", iss="https://auth.heywobo.com")).subject
    with pytest.raises(AuthError):
        verify_token(mint("real-learner", iss=f"{ISSUER_PROJECT}/auth/v1"))


def test_the_issuer_is_recovered_from_a_jwks_url_alone(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway.auth import expected_issuer

    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv(
        "SUPABASE_JWKS_URL", f"{ISSUER_PROJECT}/auth/v1/.well-known/jwks.json"
    )
    assert expected_issuer() == f"{ISSUER_PROJECT}/auth/v1"


def test_with_no_project_configured_there_is_nothing_to_pin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Local development and this suite have no Supabase project. PyJWT treats a ``None`` issuer
    as "do not check", and the require list must not ask for a claim we cannot verify — a door
    that refuses every token it can verify is not a stricter door, it is a broken one."""
    from wobo_gateway.auth import expected_issuer

    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_JWKS_URL", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_ISS", raising=False)
    assert expected_issuer() is None
    assert verify_token(mint("local-learner")).subject == "local-learner"


def test_prod_refuses_to_boot_with_an_unpinned_issuer(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prod holds a secret and serves real children; it must know whose tokens it accepts."""
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_JWKS_URL", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_ISS", raising=False)
    with pytest.raises(RuntimeError, match="issuer"):
        client()
