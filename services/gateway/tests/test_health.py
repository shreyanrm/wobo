"""``/healthz`` reflects health, not only that the process answered.

Every test here fails without ``wobo_gateway/health.py`` and the route change in ``app.py``.
Before them ``/healthz`` returned ``{"status": "ok", "mode": ...}`` unconditionally: a gateway
that could not verify a single token, had no provider key, or had spent its whole day still
said ``ok``, and Railway happily kept routing to it.
"""

from __future__ import annotations

import socket

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import health, spend
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink


def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def probe() -> tuple[int, dict]:
    answer = client().get("/healthz")
    return answer.status_code, answer.json()


# --- the ordinary case ---------------------------------------------------------------------------
def test_a_working_gateway_answers_ok_and_names_its_checks() -> None:
    status, body = probe()
    assert status == 200
    assert body["status"] == "ok"
    assert set(body["checks"]) == {"config", "auth", "spend", "providers"}
    assert all(check["status"] == "ok" for check in body["checks"].values())


def test_it_says_which_code_is_running(monkeypatch: pytest.MonkeyPatch) -> None:
    """ "Is this the code I deployed?" is a 2am question, and it needed an answer."""
    assert probe()[1]["version"] == "unknown"  # honest when nothing was baked in
    monkeypatch.setenv("GIT_SHA", "abc1234")
    assert probe()[1]["version"] == "abc1234"


def test_the_probe_never_opens_a_socket(monkeypatch: pytest.MonkeyPatch) -> None:
    """Cheap enough to poll every minute: a health check that makes a network call is a health
    check that invents its own outages, and bills for the privilege."""

    def refuse(*args, **kwargs):  # pragma: no cover — the point is that it never runs
        raise AssertionError("/healthz must not touch the network")

    monkeypatch.setattr(socket, "socket", refuse)
    snap = health.snapshot()
    assert snap["status"] == "ok"


# --- the things whose failure makes the product useless ------------------------------------------
def test_a_run_of_provider_failures_is_unhealthy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PROVIDER_OUTAGE_STREAK", "3")
    for _ in range(3):
        health.record_provider(False)
    status, body = probe()
    assert status == 503
    assert body["status"] == "unhealthy"
    assert body["checks"]["providers"]["consecutive_failures"] == 3


def test_one_bad_minute_is_not_an_outage(monkeypatch: pytest.MonkeyPatch) -> None:
    """A single failure is weather. Only a run of them is an outage."""
    health.record_provider(False)
    health.record_provider(True)
    status, body = probe()
    assert status == 200
    assert body["checks"]["providers"]["status"] == "ok"


def test_old_failures_fall_out_of_the_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PROVIDER_HEALTH_WINDOW_SECONDS", "60")
    long_ago = __import__("time").time() - 600
    for _ in range(10):
        health.record_provider(False, now=long_ago)
    assert health.snapshot()["checks"]["providers"]["status"] == "ok"


def test_a_spend_ceiling_that_refuses_everyone_is_unhealthy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Past the last lane's refuse line nobody at all is served, whatever the process is doing."""
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "10")
    spend.record(20.0)
    status, body = probe()
    assert status == 503
    assert body["status"] == "unhealthy"
    # The STATUS is public; the money is not. /healthz is unauthenticated, so the figures live in
    # health.snapshot() for the console's own read and never in the open probe.
    assert body["checks"]["spend"]["status"] == "fail"
    assert "spent_usd" not in body["checks"]["spend"]
    assert health.snapshot()["checks"]["spend"]["spent_usd"] == 20.0


def test_a_gateway_shedding_load_says_so_and_still_answers_200(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A degraded gateway that Railway keeps restarting is worse than a degraded gateway."""
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "10")
    spend.record(8.5)
    status, body = probe()
    assert status == 200
    assert body["status"] == "degraded"
    assert body["checks"]["spend"]["status"] == "degraded"


def test_a_prod_gateway_that_cannot_verify_a_token_is_unhealthy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Without it every /v1 route answers 401 and the product is a login screen.

    Read through :func:`health.snapshot` rather than the route, because ``create_app`` refuses
    to boot in that state at all — which is the other half of the same rule.
    """
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("SUPABASE_JWKS_URL", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    snap = health.snapshot()
    assert snap["status"] == "unhealthy"
    assert snap["checks"]["auth"]["status"] == "fail"
    assert health.status_code(snap) == 503


def test_live_mode_with_no_provider_key_at_all_is_unhealthy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_MODE", "live")
    for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    snap = health.snapshot()
    assert snap["checks"]["config"]["status"] == "fail"
    assert health.status_code(snap) == 503


def test_live_mode_missing_one_provider_is_degraded_not_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Every tier's chain crosses providers, so a missing key is a shorter chain, not an outage."""
    monkeypatch.setenv("LLM_MODE", "live")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    for key in ("GOOGLE_AI_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    snap = health.snapshot()
    assert snap["status"] == "degraded"
    assert snap["checks"]["config"]["providers_configured"] == 2
    assert snap["checks"]["config"]["providers_expected"] == 3
    assert health.status_code(snap) == 200


def test_the_probe_never_names_a_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    """The white-label law (WOBO-PLAN section 17): nothing a client can see may name a vendor.

    /healthz is open and unauthenticated, so "which keys are configured" has to be a COUNT. The
    boot log names the missing one, where only the owner reads it.
    """
    monkeypatch.setenv("LLM_MODE", "live")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    for key in ("OPENAI_API_KEY", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    body = str(health.snapshot()).lower()
    for vendor in ("anthropic", "openai", "google", "gemini", "claude", "gpt"):
        assert vendor not in body


def test_the_probe_never_prints_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """It is open and unauthenticated: it may name a provider, never a secret."""
    monkeypatch.setenv("LLM_MODE", "live")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-do-not-leak-me")
    assert "sk-do-not-leak-me" not in str(health.snapshot())
