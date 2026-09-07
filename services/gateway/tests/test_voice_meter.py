"""The live microphone is metered: every second that crosses the relay is written down.

``/v1/voice/relay`` and ``/v1/voice/tts/stream`` open Gemini Live on the product's key. Until
2026-09-07 neither wrote a ledger row nor charged the day's spend ceiling: the ceiling was asked
once when the session token was minted and never charged for the minutes that followed, on the
dearest per-minute seam in the product (Gemini pricing page, read 2026-09-07: 3.00 USD per
million audio tokens in, 12.00 out; the tokens page: 32 tokens per second of audio).

:class:`voice.LiveMeter` counts the PCM that actually passed in each direction, off the frames
themselves (the ``mimeType`` on each audio blob carries its sample rate, per the Live API guide),
prices it from those figures, and at close writes one ledger row and one ``spend.record``. The
socket tests below drive the real relay against a fake ``aiohttp`` so the wiring is proved, not
assumed. Nothing here touches a network or a key.
"""

from __future__ import annotations

import asyncio
import base64
import json
import sys
import types
from typing import Any

import chain_fakes as fakes
import pytest
from conftest import mint
from fastapi.testclient import TestClient
from wobo_gateway import spend, voice
from wobo_gateway.app import create_app

AUDIO_IN, AUDIO_OUT = 3.00, 12.00  # USD per million audio tokens, the Gemini pricing page
TOKENS_PER_SECOND = 32  # the Gemini tokens page


def _pcm(seconds: float, rate: int) -> str:
    return base64.b64encode(b"\x00\x00" * int(seconds * rate)).decode()


def _blob(seconds: float, rate: int) -> dict[str, str]:
    return {"mimeType": f"audio/pcm;rate={rate}", "data": _pcm(seconds, rate)}


def _up_frame(seconds: float, rate: int = 16000) -> str:
    return json.dumps({"realtimeInput": {"audio": _blob(seconds, rate)}})


def _down_frame(seconds: float, rate: int = 24000) -> str:
    return json.dumps(
        {"serverContent": {"modelTurn": {"parts": [{"inlineData": _blob(seconds, rate)}]}}}
    )


def test_the_meter_prices_what_crossed_the_socket_and_charges_the_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sink = fakes.ledger_sink(monkeypatch)
    meter = voice.LiveMeter("voice.relay")
    meter.up(_up_frame(2.0))
    meter.up(json.dumps({"clientContent": {"turns": [{"parts": [{"text": "hello there"}]}]}}))
    meter.down(_down_frame(3.0))
    meter.down(json.dumps({"serverContent": {"turnComplete": True}}))
    meter.close()

    row = sink.rows[-1]
    assert row["capability"] == "voice.relay"
    assert row["model_served"] == row["model_requested"] == voice.VOICE_ID
    assert row["provider"] == "gemini"
    assert row["unit_kind"] == "live_second" and row["unit_count"] == pytest.approx(5.0)
    assert row["tokens_in"] == 2 * TOKENS_PER_SECOND + 3, "audio seconds at 32 a second, plus text"
    assert row["tokens_out"] == 3 * TOKENS_PER_SECOND
    expected = (2 * TOKENS_PER_SECOND * AUDIO_IN + 3 * TOKENS_PER_SECOND * AUDIO_OUT) / 1e6
    expected += 3 * 0.50 / 1e6
    assert row["cost_usd"] == pytest.approx(expected, abs=1e-6), "the row keeps six decimals"
    assert row["cost_source"] == "catalogue", "the vendor's page, not litellm and not an operator"
    assert spend.state().spent_usd == pytest.approx(expected, rel=1e-6)
    assert spend.state().calls == 1


def test_a_socket_that_carried_nothing_writes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    sink = fakes.ledger_sink(monkeypatch)
    meter = voice.LiveMeter("voice.relay")
    meter.up("not json")
    meter.down(json.dumps({"setupComplete": {}}))
    meter.close()
    assert sink.rows == [] and spend.state().calls == 0


def test_the_rate_on_the_frame_is_believed(monkeypatch: pytest.MonkeyPatch) -> None:
    """The Live API resamples whatever rate the client sends; the mimeType says which."""
    sink = fakes.ledger_sink(monkeypatch)
    meter = voice.LiveMeter("voice.relay")
    meter.up(_up_frame(1.0, rate=48000))
    meter.close()
    assert sink.rows[-1]["unit_count"] == pytest.approx(1.0)


# --- the sockets themselves, against a fake aiohttp ------------------------------------------


class _Msg:
    def __init__(self, kind: int, data: Any) -> None:
        self.type = kind
        self.data = data


class _FakeGemini:
    """Speaks one audio frame after the client's first microphone frame, then hangs up."""

    def __init__(self, replies: list[str], *, after_sends: int) -> None:
        self.sent: list[str] = []
        self.replies = list(replies)
        self.after_sends = after_sends
        self._ready = asyncio.Event()

    async def send_str(self, raw: str) -> None:
        self.sent.append(raw)
        if len(self.sent) >= self.after_sends:
            self._ready.set()

    def __aiter__(self) -> _FakeGemini:
        return self

    async def __anext__(self) -> _Msg:
        await self._ready.wait()
        if not self.replies:
            raise StopAsyncIteration
        return _Msg(1, self.replies.pop(0))


class _WsConnect:
    def __init__(self, socket: _FakeGemini) -> None:
        self.socket = socket

    async def __aenter__(self) -> _FakeGemini:
        return self.socket

    async def __aexit__(self, *_: object) -> None:
        return None


def _fake_aiohttp(monkeypatch: pytest.MonkeyPatch, socket: _FakeGemini) -> None:
    module = types.ModuleType("aiohttp")

    class ClientSession:
        async def __aenter__(self) -> ClientSession:
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        def ws_connect(self, url: str) -> _WsConnect:
            return _WsConnect(socket)

    module.ClientSession = ClientSession  # type: ignore[attr-defined]
    module.WSMsgType = types.SimpleNamespace(TEXT=1, BINARY=2)  # type: ignore[attr-defined]
    module.ClientError = Exception  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "aiohttp", module)


def test_the_relay_writes_its_minutes_down_when_the_socket_closes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-a-real-one")
    sink = fakes.ledger_sink(monkeypatch)
    gemini = _FakeGemini([_down_frame(3.0)], after_sends=2)  # the setup, then one mic frame
    _fake_aiohttp(monkeypatch, gemini)
    client = TestClient(create_app())
    token = voice._mint_token("learner-metered")

    with client.websocket_connect(f"/v1/voice/relay?token={token}") as ws:
        ws.send_text(_up_frame(2.0))
        heard = json.loads(ws.receive_text())
    assert heard["serverContent"]["modelTurn"]["parts"], "the frame reached the browser"
    assert json.loads(gemini.sent[0])["setup"]["model"] == f"models/{voice.VOICE_MODEL}"

    row = sink.rows[-1]
    assert row["capability"] == "voice.relay" and row["model_served"] == voice.VOICE_ID
    assert row["unit_kind"] == "live_second" and row["unit_count"] == pytest.approx(5.0)
    expected = (2 * TOKENS_PER_SECOND * AUDIO_IN + 3 * TOKENS_PER_SECOND * AUDIO_OUT) / 1e6
    assert row["cost_usd"] == pytest.approx(expected, abs=1e-6)
    assert spend.state().spent_usd == pytest.approx(expected, rel=1e-6)


def test_the_read_aloud_socket_is_metered_the_same_way(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-a-real-one")
    sink = fakes.ledger_sink(monkeypatch)
    done = json.dumps({"serverContent": {"turnComplete": True}})
    gemini = _FakeGemini([_down_frame(1.5), done], after_sends=2)  # the setup, then the line
    _fake_aiohttp(monkeypatch, gemini)
    client = TestClient(create_app())
    token = voice._mint_token("learner-read-to")

    with client.websocket_connect(f"/v1/voice/tts/stream?token={token}") as ws:
        ws.send_text("Two x equals ten.")
        frames = [ws.receive_text(), ws.receive_text()]
    assert '"turnComplete"' in frames[-1]

    row = sink.rows[-1]
    assert row["capability"] == "voice.tts" and row["model_served"] == voice.VOICE_ID
    assert row["unit_kind"] == "spoken_second" and row["unit_count"] == pytest.approx(1.5)
    text_tokens = -(-len("Two x equals ten.") // 4)
    expected = (1.5 * TOKENS_PER_SECOND * AUDIO_OUT + text_tokens * 0.50) / 1e6
    assert row["cost_usd"] == pytest.approx(expected, abs=1e-6)
    assert row["tokens_in"] == text_tokens and row["tokens_out"] == 48
    assert spend.state().calls == 1


def test_the_session_token_still_costs_nothing_by_itself(
    monkeypatch: pytest.MonkeyPatch, auth: Any
) -> None:
    """Minting is the door, not the spend: the minutes are charged where they happen."""
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-a-real-one")
    sink = fakes.ledger_sink(monkeypatch)
    client = TestClient(create_app())
    resp = client.get("/v1/voice/session", headers=auth())
    assert resp.status_code == 200 and resp.json()["mode"] == "relay"
    assert sink.rows == [] and spend.state().calls == 0


_ = mint  # the conftest import keeps the shared token seam in scope for the fixtures above
