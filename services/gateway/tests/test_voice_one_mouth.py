"""ONE MOUTH, ONE BILL: the gateway never pays two providers to say one sentence.

Wave 60, live on Luna, every browser muted, timings off the wire and the money off the ledger:
``voice.tts`` cost $0.2306 for fourteen turns against $0.0874 for twelve in wave 57 — 4o-mini-tts
$0.1369, Gemini Live $0.0595, Gemini text-to-speech $0.0342. THREE models for one product's voice
in one battery, and across the twelve live turns Wobo still spoke in two voices.

The cause is a race the gateway serves both sides of. ``speech.tsx`` ``firstSound`` asks for a
turn's DECIDING sentence two ways at once — the buffered ladder (``POST /v1/voice/tts``) and the
voice socket (``/v1/voice/tts/stream``, Gemini Live) — and plays whichever audio lands first. The
gateway synthesises both. Then ``soundAgain`` keeps the mouth the turn was won with: once the
stream has claimed it, every LATER sentence of that turn goes to the socket and the buffered route
is never asked again — while the whole plan was already bought ahead in the turn's pinned voice at
``remember_parts``. Those clips are paid for and never played, with certainty.

Three rules close it, and none of them costs a millisecond at the ear:

1. the socket does not buy a line the gateway already holds — a clip on the disk answers the very
   same ask in milliseconds and no socket that still has to connect (1.1 to 1.4 s to its first
   chunk, measured) can beat it, so there is nothing to race and nothing to pay twice for;
2. a turn the stream has claimed the mouth of is not also bought on the ladder — the client will
   not ask for those clips, so buying them is the definition of money burned;
3. a turn nobody has heard a syllable of does not keep asking a voice its provider has marked
   OUT — that is the seven 502s of wave 60, each one a dead-end wait of seconds before the
   re-decision that was always going to happen.
"""

from __future__ import annotations

import base64
import struct
import threading
import time
from typing import Any

import pytest
from conftest import mint
from fastapi.testclient import TestClient
from wobo_gateway import health, voice
from wobo_gateway.app import create_app
from wobo_gateway.plexus import media

LINE = "A square has four equal sides. Its area is a side times itself. So nine is three squared."
FIRST, SECOND, THIRD = (
    "A square has four equal sides.",
    "Its area is a side times itself.",
    "So nine is three squared.",
)


def _wav(seconds: float = 0.4) -> str:
    rate, samples = 24000, int(24000 * seconds)
    data = b"\x00\x00" * samples
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(data),
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        rate,
        rate * 2,
        2,
        16,
        b"data",
        len(data),
    )
    return base64.b64encode(header + data).decode()


class Vendor:
    """One text-to-speech vendor, with a real one's latency and a record of what it was asked."""

    def __init__(self, latency_s: float = 0.2) -> None:
        self.latency_s = latency_s
        self.asked: list[str] = []
        self.silent: set[str] = set()
        self.lock = threading.Lock()

    def speak(self, text: str, *_a: Any, **_k: Any) -> dict[str, str] | None:
        with self.lock:
            self.asked.append(text)
        time.sleep(self.latency_s)
        if text in self.silent:
            return None
        return {"mime": "audio/wav", "b64": _wav()}


@pytest.fixture
def voices(monkeypatch: pytest.MonkeyPatch) -> tuple[Vendor, Vendor]:
    google, openai = Vendor(), Vendor()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GOOGLE_AI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(media, "_gemini_speak", google.speak)
    monkeypatch.setattr(media, "_openai_speak", openai.speak)
    voice.forget_lines()
    media.reset_inflight()
    health.reset()
    return google, openai


@pytest.fixture
def client(voices: tuple[Vendor, Vendor]) -> TestClient:
    return TestClient(create_app())


@pytest.fixture
def sockets(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Every line the gateway actually opened Gemini Live for. The socket is the second bill."""
    opened: list[str] = []

    async def fake_stream(client_socket, aiohttp, key, text, *, accent, beat):  # noqa: ANN001
        opened.append(text)

    monkeypatch.setattr(voice, "_stream_one_line", fake_stream)
    return opened


@pytest.fixture
def one_at_a_time(monkeypatch: pytest.MonkeyPatch) -> None:
    """The anticipation off, so a test sees the choice rather than yesterday's disk."""
    from wobo_gateway import spend

    monkeypatch.setattr(spend, "verdict", lambda *_a, **_k: spend.Verdict.DEGRADE)


def _headers(who: str = "one-mouth-learner") -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(who)}"}


def _say(client: TestClient, text: str, beat: str = "step") -> tuple[int, float]:
    started = time.monotonic()
    res = client.post("/v1/voice/tts", json={"text": text, "beat": beat}, headers=_headers())
    return res.status_code, (time.monotonic() - started) * 1000.0


def _stream(client: TestClient, text: str, beat: str = "step") -> None:
    token = client.get("/v1/voice/session", headers=_headers()).json()["token"]
    url = f"/v1/voice/tts/stream?token={token}&beat={beat}"
    with client.websocket_connect(url) as ws:
        ws.send_text(text)


def _settle(vendor: Vendor, count: int, timeout_s: float = 5.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline and len(vendor.asked) < count:
        time.sleep(0.02)
    time.sleep(vendor.latency_s * 2)  # whatever was in flight lands on the disk


def test_the_socket_does_not_buy_a_line_the_gateway_already_holds(
    client: TestClient, voices: tuple[Vendor, Vendor], sockets: list[str]
) -> None:
    """THE DEFECT, in the shape the bill meets it.

    The client asks for the deciding sentence two ways at once. When the clip is already on the
    disk the buffered ask answers in milliseconds (2 to 21 ms, measured live) and the socket, which
    has a mint and a connect in front of its first chunk, cannot win — so opening Gemini Live for it
    buys a second reading of a sentence that is already bought, in a second voice, to be thrown
    away. The socket looks first now, and stays shut.
    """
    google, _openai = voices
    voice.mark_accent(voice.AMERICAN_ENGLISH)
    try:
        voice.remember_line(LINE)
        _settle(google, 3)
    finally:
        voice.mark_accent(None)
    assert sorted(google.asked) == sorted([FIRST, SECOND, THIRD])

    _stream(client, FIRST)

    assert sockets == [], "the gateway paid a second provider to read a line it already held"
    # and the line the socket declined is still served, off the disk, in milliseconds
    status, waited = _say(client, FIRST)
    assert status == 200
    assert waited < 150, f"the held line waited {waited:.0f} ms"


def test_the_socket_still_speaks_a_line_nothing_holds(
    client: TestClient, voices: tuple[Vendor, Vendor], sockets: list[str], one_at_a_time: None
) -> None:
    """The saving is never silence. Nothing on the disk for this sentence means the socket is the
    only mouth that can be first, and it opens exactly as it does today."""
    voice.forget_lines()
    _stream(client, "Nothing on the disk has ever said this.")
    assert sockets == ["Nothing on the disk has ever said this."]


def test_a_turn_the_stream_is_reading_is_not_also_bought_on_the_ladder(
    client: TestClient, voices: tuple[Vendor, Vendor]
) -> None:
    """The stream took the mouth on the deciding sentence, so ``soundAgain`` keeps it: every later
    sentence of this turn goes to the socket and the buffered route is never asked for one of them
    again. Buying them ahead is money spent on audio nobody will ever ask for."""
    google, openai = voices
    voice.mark_accent(voice.AMERICAN_ENGLISH)
    try:
        voice.remember_line(LINE)
        # The socket's first chunk lands while the opening is still being synthesised: the stream
        # has the mouth for this turn, exactly as the client's own race decided it.
        assert voice.claim_mouth(FIRST, "stream") is True
        _settle(google, 1)
    finally:
        voice.mark_accent(None)

    assert google.asked == [FIRST], f"the ladder bought a stream turn's plan: {google.asked}"
    assert openai.asked == []


def test_an_unheard_turn_does_not_keep_asking_a_voice_that_is_marked_out(
    client: TestClient, voices: tuple[Vendor, Vendor], one_at_a_time: None
) -> None:
    """Wave 60's seven 502s. Google's text-to-speech was marked OUT mid-battery, and every sentence
    of every turn already pinned to it was asked of it anyway — a dead-end wait of seconds, then a
    re-decision that was always going to happen. Nothing of this turn has been heard, so its voice
    may be re-decided silently: it is, BEFORE the ask rather than after the timeout."""
    google, openai = voices
    voice.remember_line(LINE)
    assert voice.turn_voice_for(FIRST) == media.GEMINI_TTS_ID

    health.mark_out_of_credit(media.GEMINI_TTS_ID, reason="quota")
    assert _say(client, FIRST)[0] == 200

    assert google.asked == [], "a voice known to be out was asked anyway"
    assert openai.asked == [FIRST]


def test_a_turn_already_being_heard_keeps_its_voice_even_when_that_voice_goes_out(
    client: TestClient, voices: tuple[Vendor, Vendor], one_at_a_time: None
) -> None:
    """The line the rule above must not cross. Once a syllable has been served the mouth is frozen:
    a provider marked out mid-answer is silence on the reading clock, never a second voice."""
    google, openai = voices
    voice.remember_line(LINE)
    assert _say(client, FIRST)[0] == 200

    health.mark_out_of_credit(media.GEMINI_TTS_ID, reason="quota")
    assert _say(client, SECOND)[0] == 200

    assert openai.asked == [], "the answer changed voice in the middle of itself"
    assert sorted(google.asked) == sorted([FIRST, SECOND])
