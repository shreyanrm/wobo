"""ONE VOICE, ONE TURN: which voice a learner hears is decided once, and never mid-answer.

Measured live on 2026-09-10 across twelve turns, every browser muted, timings off the synthesis
call and the wire: 63 percent of the voice spend went to the FALLBACK voice
(``openai/gpt-4o-mini-tts``) against 37 percent to the primary (Gemini's text-to-speech), after
four ``tts: request failed … TimeoutError`` warnings marked Google out mid-battery. On two of six
live boards the answer fell through to the DEVICE's own voice in the MIDDLE of the answer, at 21.4
and 25.3 seconds. So a learner heard one voice say the first sentence of an answer and a different
one say the second — and which two depended on whether Google hung. INK-FOUR experience: one voice.

The cause is that the voice was chosen PER SENTENCE. ``plexus.media._buy`` asked Gemini, and when
Gemini did not answer it asked OpenAI — for that sentence, on its own, with no memory of what the
sentence before it was read in. A turn is one performance, so the choice belongs to the turn:

1. the sentences of a turn are known the moment its words are decided (``voice.remember_parts``);
2. the voice for those sentences is decided ONCE, there, from live provider health;
3. every sentence of that turn is read in that voice, and a sentence that fails is NEVER handed
   to the other voice while the turn is being heard — silence on the reading clock instead;
4. the whole plan is synthesised at that moment, not one sentence at a time behind the learner.

The re-decision that IS allowed is the one nobody hears: a turn that has not yet spoken a syllable
may change its voice, because that is a choice made before the answer rather than inside it.
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

LINE = "The curve of y = x squared. Watch what it does near zero. It never dips below the axis."
FIRST, SECOND, THIRD = (
    "The curve of y = x squared.",
    "Watch what it does near zero.",
    "It never dips below the axis.",
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
        self.hangs = False
        self.lock = threading.Lock()

    def speak(self, text: str, *_a: Any, **_k: Any) -> dict[str, str] | None:
        with self.lock:
            self.asked.append(text)
        time.sleep(self.latency_s)
        if self.hangs or text in self.silent:
            return None
        return {"mime": "audio/wav", "b64": _wav()}


@pytest.fixture
def voices(monkeypatch: pytest.MonkeyPatch) -> tuple[Vendor, Vendor]:
    """Both voices keyed and mocked, so a test can see WHICH ONE was asked for each sentence."""
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
def one_at_a_time(monkeypatch: pytest.MonkeyPatch) -> None:
    """The anticipation off, so a test sees the CHOICE rather than yesterday's disk.

    Buying the plan ahead is a kindness the day's ceiling can withdraw (``voice.buy_turn_ahead``
    asks ``spend.verdict`` in the strictest lane there is), and on such a day every sentence is
    bought on its own ask — which is exactly the condition under which the voice used to change
    mid-answer. These tests run there, so nothing is answered from a buy that happened to be warm.
    """
    from wobo_gateway import spend

    monkeypatch.setattr(spend, "verdict", lambda *_a, **_k: spend.Verdict.DEGRADE)


def _say(client: TestClient, text: str, beat: str = "step") -> tuple[int, float]:
    """Ask for one spoken sentence the way the client does, and time it off the wire."""
    headers = {"Authorization": f"Bearer {mint('one-voice-learner')}"}
    started = time.monotonic()
    res = client.post("/v1/voice/tts", json={"text": text, "beat": beat}, headers=headers)
    return res.status_code, (time.monotonic() - started) * 1000.0


def test_a_turn_keeps_one_voice_when_the_first_voice_goes_out_mid_answer(
    client: TestClient, voices: tuple[Vendor, Vendor], one_at_a_time: None
) -> None:
    """THE DEFECT, in the shape a learner meets it.

    Google answers the first sentence and is then marked out — four timeouts in a live battery is
    exactly how that happened. Every sentence after it used to go to OpenAI, so the learner heard
    the answer change voice halfway through. The turn's voice was decided once; it holds.
    """
    google, openai = voices
    voice.remember_line(LINE)

    assert _say(client, FIRST)[0] == 200
    health.mark_out_of_credit(media.GEMINI_TTS_ID, reason="quota")
    assert _say(client, SECOND)[0] == 200
    assert _say(client, THIRD)[0] == 200

    assert openai.asked == [], "the answer changed voice in the middle of itself"
    assert sorted(google.asked) == sorted([FIRST, SECOND, THIRD])


def test_the_voice_is_decided_once_from_live_health_before_the_turn_is_heard(
    client: TestClient, voices: tuple[Vendor, Vendor], one_at_a_time: None
) -> None:
    """Marked out BEFORE the turn: the whole turn is read in the other voice, including the
    sentences Google would have been healthy enough to speak by the time they were asked for."""
    google, openai = voices
    health.mark_out_of_credit(media.GEMINI_TTS_ID, reason="quota")
    voice.remember_line(LINE)

    assert _say(client, FIRST)[0] == 200
    health.reset()  # Google comes back mid-answer; the turn does not change voice for it
    assert _say(client, SECOND)[0] == 200
    assert _say(client, THIRD)[0] == 200

    assert google.asked == [], "a turn that started in one voice finished in another"
    assert sorted(openai.asked) == sorted([FIRST, SECOND, THIRD])


def test_a_sentence_that_fails_mid_turn_is_silence_not_the_other_voice(
    client: TestClient, voices: tuple[Vendor, Vendor], one_at_a_time: None
) -> None:
    """A turn already being heard whose next sentence fails: the learner is NOT handed a second
    voice for one sentence. The route says so honestly (502) and the client holds the sentence on
    its reading clock, in the one voice the turn has."""
    google, openai = voices
    google.silent.add(SECOND)
    voice.remember_line(LINE)

    assert _say(client, FIRST)[0] == 200
    assert _say(client, SECOND)[0] == 502, "a failed sentence was spoken by the other voice"
    assert openai.asked == [], "the other voice spoke one sentence of somebody else's turn"


def test_a_turn_that_has_not_spoken_yet_may_still_change_its_voice(
    client: TestClient, voices: tuple[Vendor, Vendor], one_at_a_time: None
) -> None:
    """The one re-decision nobody hears. Google is healthy when the turn is decided and then does
    not answer the FIRST sentence — no syllable has been heard, so the turn is re-decided whole
    and every sentence of it, this one included, comes back in the other voice."""
    google, openai = voices
    google.silent.update({FIRST, SECOND, THIRD})
    voice.remember_line(LINE)

    assert _say(client, FIRST)[0] == 200
    assert _say(client, SECOND)[0] == 200
    assert openai.asked[0] == FIRST, "the turn was not re-decided before it was heard"


def test_the_whole_plan_is_bought_when_the_sentences_are_known(
    client: TestClient, voices: tuple[Vendor, Vendor]
) -> None:
    """The scope fix. The buy-ahead worked and only for the sentence behind the one being read,
    started at the moment that one was asked for — so when the first sentence came off the disk in
    milliseconds (it did, on five of six live boards) the second was still a whole round trip
    away: 4.6 to 7.8 seconds, live, muted, off the wire. The sentences are known when the turn's
    words are decided, seconds earlier, so that is when all of them are bought."""
    google, _openai = voices
    voice.mark_accent(voice.AMERICAN_ENGLISH)
    try:
        voice.remember_line(LINE)
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline and len(google.asked) < 3:
            time.sleep(0.02)
        assert sorted(google.asked) == sorted([FIRST, SECOND, THIRD]), (
            "the plan's sentences were not bought when they were known"
        )
        time.sleep(google.latency_s * 2)  # the buys land on the disk
    finally:
        voice.mark_accent(None)  # the accent is a request's, never a test file's

    for part in (FIRST, SECOND, THIRD):
        status, waited = _say(client, part)
        assert status == 200
        assert waited < 150, f"{part!r} waited {waited:.0f} ms on a voice that already had it"


def test_the_turn_a_sentence_belongs_to_is_forgotten_with_the_line(
    voices: tuple[Vendor, Vendor],
) -> None:
    """The registry is the turn in flight, not a history: a sentence nobody said belongs to no
    turn, and forgetting the lines forgets the voices they were to be read in."""
    voice.forget_lines()
    assert voice.turn_voice_for("a sentence nobody said") is None
    voice.remember_line(LINE)
    pinned = voice.turn_voice_for(FIRST)
    assert pinned is not None
    assert voice.turn_voice_for(SECOND) == pinned, "one turn, one voice, every sentence"
    assert voice.turn_voice_for(THIRD) == pinned
    voice.forget_lines()
    assert voice.turn_voice_for(FIRST) is None


def test_one_answer_remembered_twice_still_has_one_voice(voices: tuple[Vendor, Vendor]) -> None:
    """An answer reaches the voice twice — once as the model decided it (``wobo.py``) and once as
    the wire finally carried it, after the naming and number laws rewrote the list
    (``board.stream.build_events``). Two records, one answer. If the second record pinned its own
    voice, the sentence only the first one holds would be read in one mouth and the rest in
    another, and each record would look innocent. The second inherits the first's voice."""
    voice.forget_lines()
    voice.remember_line(LINE)
    first = voice.turn_voice_for(FIRST)
    assert first is not None

    # The wire's own list: the opening sentence is rewritten, the rest survive.
    rewritten = "Squares on the sides, hypotenuse 5.00 cm."
    voice.remember_parts([rewritten, SECOND, THIRD])

    assert voice.turn_voice_for(rewritten) == first, "the same answer took a second voice"
    assert voice.turn_voice_for(SECOND) == first
    assert voice.turn_voice_for(FIRST) == first, "and the sentence only the first record holds"
