"""The two holes in the platform's daily money ceiling, both disclosed and neither closed.

1. **VOICE IS OUTSIDE THE CEILING, IN BOTH DIRECTIONS.** ``spend.py`` is described as "the
   platform's daily money ceiling — the one thing standing between an open box and a bill", fed
   from "the one funnel every live model call already passes through". Voice is a paid Gemini API
   and it goes through neither half: nothing in ``voice.py`` records a cost into the accumulator,
   and ``_charge_voice`` charges only the learner's per-day CALL count without ever asking
   ``spend.verdict``. Verified live on 2026-09-04: with the day driven to 200 % of the ceiling,
   ``POST /v1/voice/tts`` still ran to the key check. Voice is plausibly the most expensive
   per-minute thing in the product. The two websockets are covered by the same gate, because both
   require a token minted by ``/v1/voice/session``, which is metered here.

2. **A SPEND REFUSAL AT THE PUBLIC BOX BECOMES A 503 AND PAGES THE OWNER.** ``ask_public`` wraps
   ``gateway.invoke`` in a bare ``except Exception``, so ``SpendCeilingReached`` is swallowed and
   answered 503 ``ask_unavailable`` — which trips the SERVER_ERROR alarm at severity CRITICAL. The
   owner is paged with a server error every time his own limiter does its job, on the one open box
   a child can reach. An alarm that cries wolf on correct behaviour is the alarm that gets muted.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import alerts, spend
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def _spend_the_day(monkeypatch: pytest.MonkeyPatch, fraction: float = 2.0) -> None:
    """Drive the accumulator past every lane's refuse line."""
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "1.0")
    spend.reset()
    spend.record(fraction, capability="test", model="test")


# --- 1. voice is inside the ceiling -----------------------------------------------------------


def test_voice_is_refused_when_the_platform_day_is_spent(
    client: TestClient, auth: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    _spend_the_day(monkeypatch)
    res = client.post("/v1/voice/tts", json={"text": "hello"}, headers=auth())
    assert res.status_code == 429, res.text
    assert res.json()["code"] == "spend_ceiling"


def test_the_voice_session_token_is_refused_when_the_day_is_spent(
    client: TestClient, auth: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The two sockets have no HTTP middleware of their own; both need a token from this route,
    so gating it is what puts the relay and the read-aloud stream inside the ceiling."""
    _spend_the_day(monkeypatch)
    res = client.get("/v1/voice/session", headers=auth())
    assert res.status_code == 429, res.text


def test_voice_still_works_below_the_ceiling(
    client: TestClient, auth: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "100.0")
    spend.reset()
    res = client.get("/v1/voice/session", headers=auth())
    assert res.status_code == 200, res.text


def test_a_spoken_line_lands_in_the_daily_accumulator(monkeypatch: pytest.MonkeyPatch) -> None:
    """A cost the ledger records and the ceiling never sees is a ceiling with a hole in it."""
    from wobo_gateway import ledger
    from wobo_gateway.plexus import media

    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "100.0")
    monkeypatch.setenv(f"LEDGER_PRICE_{ledger.SPOKEN_SECOND.upper()}_USD", "0.002")
    spend.reset()
    before = spend.state().spent_usd
    media._record_spoken("voice.tts", {"mime": "audio/wav", "b64": _one_second_wav()})
    assert spend.state().spent_usd > before, "spoken seconds never reached the money ceiling"


def _one_second_wav() -> str:
    import base64
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00\x00" * 24000)
    return base64.b64encode(buf.getvalue()).decode()


# --- 2. a spend refusal at the public box is a 429, not a page ---------------------------------


def test_the_public_box_answers_a_spend_refusal_with_429_and_no_alarm(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from wobo_gateway import ask_public

    _spend_the_day(monkeypatch)
    alerts.reset()
    raised: list[str] = []
    monkeypatch.setattr(alerts, "_sender", lambda url, payload: raised.append(payload["event"]))

    ask_public.reset()
    res = client.post(
        "/v1/ask",
        json={"question": "how do I change my settings please", "page": "/help"},
    )
    assert res.status_code == 429, res.text
    assert res.json()["code"] != "ask_unavailable"
    assert "server_error" not in raised
