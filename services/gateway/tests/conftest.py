"""Shared test fixtures for the gateway suite.

Every ``/v1`` route is behind the door now, so the suite needs a real token rather than a
bypass: :func:`token` mints an HS256 JWT against a test secret set in the environment, and
:func:`auth` turns it into the header every HTTP test sends. Proving the real verification
path on every request is worth more than a shortcut that would never run in production.

The autouse fixture also resets the per-process meters between tests, so one test's spend
is never another test's 429.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import pytest

TEST_JWT_SECRET = "test-secret-not-a-real-one-and-long-enough-for-sha256"
TEST_SUBJECT = "learner-under-test"


def mint(
    subject: str = TEST_SUBJECT,
    *,
    secret: str = TEST_JWT_SECRET,
    audience: str = "authenticated",
    expires_in: int = 3600,
    anonymous: bool = False,
    **claims: Any,
) -> str:
    """One HS256 Supabase-shaped access token.

    ``iss`` rides on it because the door checks the issuer as well as the signature and the
    audience (``auth.expected_issuer``): every Supabase project writes the audience
    ``authenticated``, so the issuer is the claim that makes a token OURS. It is read at CALL
    time from whatever project the test has configured — most tests configure none, and then
    there is nothing to pin and any issuer passes — and an explicit ``iss=`` still wins.
    """
    import jwt
    from wobo_gateway.auth import expected_issuer

    now = int(time.time())
    body: dict[str, Any] = {
        "sub": subject,
        "aud": audience,
        "iss": expected_issuer() or "https://project.example/auth/v1",
        "iat": now,
        "exp": now + expires_in,
        "role": "authenticated",
    }
    if anonymous:
        body["is_anonymous"] = True
    body.update(claims)
    return jwt.encode(body, secret, algorithm="HS256")


@pytest.fixture(autouse=True)
def _gateway_test_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """A verifiable identity and empty meters for every test."""
    from wobo_gateway import alerts, auth, billing, budget, consent, health, ledger, spend, voice

    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    # The platform's money ledger, the alarm's cooldowns and the provider health window are all
    # per-process, exactly like the meters: one test's spend must never be another test's
    # refusal, and one test's alert must never be another test's suppressed page.
    monkeypatch.delenv("ALERT_WEBHOOK_URL", raising=False)
    spend.reset()
    alerts.reset()
    health.reset()
    # The child-safety screen's circuit breaker is per-process for the same reason the meters are:
    # it is one verdict about one provider. Reset it here or one test's simulated outage leaves the
    # screen degraded for whatever runs next, and a test that asserts the model WAS called fails
    # for a reason that has nothing to do with it.
    from wobo_gateway import safety_model

    safety_model.reset_breaker()
    # No Supabase project in tests: consent lookups must never touch the network.
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_JWKS_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    budget.reset()
    consent.reset_cache()
    # The usage ledger: an empty buffer, zeroed counters and NO transport, so one test's rows are
    # never another test's assertions and nothing here can reach a network. With the Supabase
    # variables deleted above, ``ledger.configured()`` is False and every row is counted as
    # dropped-unconfigured rather than sent — which is also the honest behaviour of a deployment
    # that has not been given a project.
    ledger.reset()
    # A fresh in-memory subscription store per test, and no cached plan: one test's cancel is
    # never another test's allowance. The store is asked for BY NAME — billing.build_store no
    # longer falls back to memory when a project is missing, because an unconfigured production
    # deployment answering "you are on the free plan" to somebody who paid is the trap this whole
    # module exists to close.
    monkeypatch.setenv("SUBSCRIPTIONS_STORE", "memory")
    billing.set_store(None)
    # Wobo's mind: a fresh in-process store per test, and never a project one. It is the most
    # personal row we hold, so the suite must not be able to reach a real one even by accident,
    # and one test's remembered facts must never be another test's.
    from wobo_gateway import mind as mind_mod

    monkeypatch.setenv("WOBO_MIND_STORE", "memory")
    mind_mod.set_store(None)
    auth.reset_jwks_cache()
    voice.reset_tokens()
    # Mail: console transport, an empty in-memory send log, and background sends run inline so
    # a test can assert on what went out without waiting on a thread.
    from wobo_gateway import email as email_mod
    from wobo_gateway.hospitality import jobs

    monkeypatch.delenv("MAIL_LOG_PATH", raising=False)
    monkeypatch.setenv("EMAIL_MODE", "console")
    email_mod.reset_mail_log()
    jobs.set_runner(lambda go: go())


@pytest.fixture
def token() -> Callable[..., str]:
    return mint


@pytest.fixture
def auth() -> Callable[..., dict[str, str]]:
    """``auth()`` -> the Authorization header for the default test learner."""

    def _headers(subject: str = TEST_SUBJECT, **kwargs: Any) -> dict[str, str]:
        return {"Authorization": f"Bearer {mint(subject, **kwargs)}"}

    return _headers
