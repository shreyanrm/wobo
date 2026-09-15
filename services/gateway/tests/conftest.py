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
from pathlib import Path
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
def _gateway_test_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """A verifiable identity and empty meters for every test."""
    from wobo_gateway import (
        alerts,
        allowance,
        auth,
        billing,
        budget,
        consent,
        health,
        ledger,
        spend,
        voice,
    )

    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    # The content cache is per-test for the same reason the meters are. Twenty test modules
    # already point it at their own tmp_path; the ones that do not were writing into the repo's
    # own ``content/cache`` and reading each other's leavings — which became visible the day the
    # spoken-line cache landed (``plexus/media.py``), because one test's cached audio is another
    # test's vendor call that never happened. A test that wants a warm cache still sets this
    # itself: its own setenv runs after this fixture and wins.
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path / "plexus-cache"))
    # THE BACKGROUND DESIGNER IS A MODEL CALL IN A THREAD (engines._spawn_designer). In production
    # it is what makes §3's designed interaction real: the learner is served the floor at once and
    # the model's design lands in the store for the next one. In a suite it is a thread outliving
    # the test that started it, reaching for a stub that has been torn down and writing into
    # another test's cache — which is exactly how two unrelated tests started failing in a full run
    # and passing alone. Off for every test; the one test that is ABOUT the designer turns it on.
    monkeypatch.setenv("PLEXUS_DESIGNER", "off")
    # The platform's money ledger, the alarm's cooldowns and the provider health window are all
    # per-process, exactly like the meters: one test's spend must never be another test's
    # refusal, and one test's alert must never be another test's suppressed page.
    monkeypatch.delenv("ALERT_WEBHOOK_URL", raising=False)
    spend.reset()
    alerts.reset()
    health.reset()
    # Discovery's own day: what each board has cost today and which boards are resting after a
    # closed door. Per-process, for the same reason as the meters above — and one test's three
    # refusals must never be the next test's "this board is resting".
    from wobo_gateway.curriculum.discovery import ceiling as discovery_ceiling

    discovery_ceiling.reset()
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
    # The money meter (allowance.py) is per-process exactly like the counters above: one test's
    # spent day must never be another test's refusal, and a zone one test noted must never
    # decide when another test's day turns over.
    allowance.reset()
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
    # Payments: no provider keys unless a test sets test-shaped ones, no client but a test's fake,
    # a fresh in-memory ledger, and no "last webhook" carried over. A developer's own shell keys
    # must never reach the suite, because the suite must never reach the provider.
    from wobo_gateway.billing import razorpay, records

    for key in ("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"):
        monkeypatch.delenv(key, raising=False)
    razorpay.set_client(None)
    razorpay.reset()
    records.set_store(None)
    # Wobo's mind: a fresh in-process store per test, and never a project one. It is the most
    # personal row we hold, so the suite must not be able to reach a real one even by accident,
    # and one test's remembered facts must never be another test's.
    from wobo_gateway import mind as mind_mod

    monkeypatch.setenv("WOBO_MIND_STORE", "memory")
    mind_mod.set_store(None)
    # The doubt solver's record (doubt.py): a photograph of a child's page and what was read from
    # it. In process, fresh per test, and never a project one, for the same reason the mind is not.
    from wobo_gateway import doubt as doubt_mod

    monkeypatch.setenv("DOUBT_STORE", "memory")
    doubt_mod.set_store(None)
    doubt_mod.set_eyes(None)
    doubt_mod.OFF_PAGE["count"] = 0
    # The door (doors.py). Its own dial per test, and never a project one: one test closing the
    # door must never be another test's 403. The memory store starts OPEN, which is what every
    # other test in this suite is written against; test_doors.py is the one that shuts it, and it
    # also holds the property that matters in production — an UNCONFIGURED gateway is closed.
    from wobo_gateway import doors, waiting_list

    monkeypatch.setenv("DOORS_STORE", "memory")
    doors.set_clock(None)
    doors.set_store(None)
    # The list the closed door opens onto. In process, fresh per test, and its allowance zeroed
    # for the same reason the meters above are.
    monkeypatch.setenv("WAITING_LIST_STORE", "memory")
    waiting_list.set_clock(None)
    waiting_list.set_store(None)
    waiting_list.reset_meter()
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
