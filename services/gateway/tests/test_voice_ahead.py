"""THE LINE AHEAD: the sentences after the first are bought while the first is being spoken.

Measured live on 2026-09-10 (the adversary's battery, every browser muted, timings off the wire
and the synthesis call): ``POST /v1/voice/tts`` answered in 4.3, 4.7, 4.8, 5.2, 5.5, 6.1, 6.6,
8.0, 9.4 and 10.3 seconds when Google's text-to-speech spoke, 22.5 to 24.2 seconds when it hung
and OpenAI's spoke behind it, and 2 to 21 MILLISECONDS when the same line had been bought before.
The client asks for one sentence at a time and asks for the next only once it holds the audio for
this one (``speech.tsx`` ``startUtterance``), so a three-sentence answer paid three of those round
trips end to end, the voice fell further behind the written line with every sentence, and the ink —
which is paced to the sentence that names it (``wobo/beat.ts``) — stalled with it.

The gateway wrote the whole line before the first sentence was ever asked for. So the sentences
that follow are bought AT THE SAME TIME as the one being asked for, on the same accent and the same
beat, which is the same cache key the client's next call will present. Two things make that safe
and they are tested here: the line Wobo is about to say is remembered when it is decided
(``wobo.py``), and one line is never bought twice at once (``plexus.media``).
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
from wobo_gateway import voice
from wobo_gateway.app import create_app
from wobo_gateway.plexus import media


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """An app with a voice: a key present is what makes the spoken routes answer at all."""
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    return TestClient(create_app())


def _wav(seconds: float = 0.4) -> str:
    """A real, tiny WAV, so the ledger's second-counter and the client's decoder both read it."""
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
    """A text-to-speech vendor with a real one's latency, and a count of what it was asked."""

    def __init__(self, latency_s: float = 0.4) -> None:
        self.latency_s = latency_s
        self.asked: list[str] = []
        self.lock = threading.Lock()

    def speak(self, text: str, instruction: str | None, key: str, key_name: str, **_: Any) -> dict:
        with self.lock:
            self.asked.append(text)
        time.sleep(self.latency_s)
        return {"mime": "audio/wav", "b64": _wav()}


@pytest.fixture
def vendor(monkeypatch: pytest.MonkeyPatch) -> Vendor:
    """One voice, keyed, with nothing standing behind it — so a test measures one buy."""
    spoke = Vendor()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GOOGLE_AI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(media, "_gemini_speak", spoke.speak)
    voice.forget_lines()
    media.reset_inflight()
    return spoke


LINE = "The curve of y = x squared. Watch what it does near zero. What do you notice about it?"
FIRST, SECOND, THIRD = (
    "The curve of y = x squared.",
    "Watch what it does near zero.",
    "What do you notice about it?",
)


def _ask(client: TestClient, text: str) -> float:
    """Ask for one spoken sentence the way the client does, and time it off the wire."""
    headers = {"Authorization": f"Bearer {mint('ahead-learner')}"}
    started = time.monotonic()
    res = client.post("/v1/voice/tts", json={"text": text}, headers=headers)
    elapsed = (time.monotonic() - started) * 1000.0
    assert res.status_code == 200, res.text
    assert res.json()["b64"]
    return elapsed


def test_the_sentence_after_the_one_being_read_is_already_bought(
    client: TestClient, vendor: Vendor
) -> None:
    """The defect, in the shape a learner meets it: sentence two costs a whole second round trip.

    Wobo's line is decided before a syllable of it is asked for, so asking for the first sentence
    buys the ones behind it at the same time. Sentence two then answers off the disk in
    milliseconds instead of paying the vendor again.
    """
    voice.remember_line(LINE)

    first_ms = _ask(client, FIRST)
    second_ms = _ask(client, SECOND)
    third_ms = _ask(client, THIRD)

    assert first_ms >= 300, "the first sentence still pays for its own synthesis"
    assert second_ms < 150, f"the second sentence waited {second_ms:.0f} ms on the vendor again"
    assert third_ms < 150, f"the third sentence waited {third_ms:.0f} ms on the vendor again"
    assert sorted(vendor.asked) == sorted([FIRST, SECOND, THIRD]), (
        "every sentence is bought exactly once, and only the sentences Wobo said"
    )


def test_a_line_wobo_never_said_buys_nothing_ahead(client: TestClient, vendor: Vendor) -> None:
    """Only what Wobo is about to say is bought ahead. A sentence off the street buys one line."""
    _ask(client, "Read this one thing.")
    time.sleep(0.2)
    assert vendor.asked == ["Read this one thing."]


def test_one_line_is_never_bought_twice_at_once(client: TestClient, vendor: Vendor) -> None:
    """Two callers on the same line at the same moment — the warm and the client's own ask are
    exactly that — buy it once between them, and both get the audio."""
    instruction = voice.spoken_instruction(voice.AMERICAN_ENGLISH, "step")
    got: list[dict | None] = []

    def buy() -> None:
        got.append(media.synthesize_narration(FIRST, instruction=instruction))

    threads = [threading.Thread(target=buy) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert vendor.asked == [FIRST], "one line, one buy, however many asked at once"
    assert all(audio and audio.get("b64") for audio in got), "and everyone who asked was answered"


def test_the_words_wobo_decides_are_the_words_the_voice_is_told_about() -> None:
    """``wobo.py`` decides what Wobo says; the voice is told, so it can buy ahead. A board plan
    and a five-path turn both count, because both are read aloud one sentence at a time."""
    from wobo_gateway import wobo

    voice.forget_lines()
    plan = wobo.board_plan_for(
        {"context": {"turn": {"lastUserInput": "graph y = x^2 from -3 to 3"}}}, live=False
    )
    assert plan is not None and plan.get("say")
    said = voice.sentences_of(str(plan["say"]))
    prompt = str((plan.get("ask") or {}).get("prompt") or "")
    spoken = [(s, None) for s in said] + ([(prompt, "ask")] if prompt else [])
    assert len(spoken) > 1, "a board turn says a line and then asks a question"
    assert voice.line_ahead(spoken[0][0]) == tuple(spoken[1:3]), (
        "the question the client reads LAST is part of what is spoken, and it is read as a question"
    )

    voice.forget_lines()
    voice.remember_line(LINE)
    assert voice.line_ahead(FIRST) == ((SECOND, None), (THIRD, None))
    assert voice.line_ahead(THIRD) == (), "nothing follows the last sentence"
    assert voice.line_ahead("a sentence nobody said") == ()


def test_a_hanging_first_voice_never_costs_a_learner_a_whole_minute_of_one_sentence() -> None:
    """The tail of the same defect. When Google hangs, the learner waits the primary's deadline
    and THEN the seconds the other voice needs — measured live on 2026-09-10 at 22.5, 22.6, 22.9,
    23.4 and 24.2 seconds for ONE SENTENCE, five times in a four-minute battery, against a
    first-syllable budget of 1.5 seconds. The deadline has to sit above every answer Google
    actually gave (10.3 s was the slowest) so that no line is handed to the second voice that the
    first would have spoken, and well under the seam's own HTTP timeout."""
    assert media._PRIMARY_TIMEOUT_S <= 12.0, "a hang may not cost twenty seconds"
    assert media._PRIMARY_TIMEOUT_S > 10.3, "nor may a slow answer be cut off in Wobo's own voice"
    assert media._PRIMARY_TIMEOUT_S < media._HTTP_TIMEOUT_S


def test_the_question_at_the_end_is_bought_as_a_question(
    client: TestClient, vendor: Vendor
) -> None:
    """A board turn says a line and then asks a question, and the client reads that question on
    the ``ask`` beat (``board-turn.ts``). A question bought on the step beat is audio under a key
    nobody presents: paid for, never heard, and the learner still waits the whole round trip."""
    voice.remember_line("The curve of y = x squared.", ask="What do you notice about it?")

    headers = {"Authorization": f"Bearer {mint('ahead-learner')}"}
    client.post("/v1/voice/tts", json={"text": "The curve of y = x squared."}, headers=headers)
    started = time.monotonic()
    res = client.post(
        "/v1/voice/tts",
        json={"text": "What do you notice about it?", "beat": "ask"},
        headers=headers,
    )
    waited = (time.monotonic() - started) * 1000.0

    assert res.status_code == 200
    assert waited < 150, f"the closing question waited {waited:.0f} ms on the vendor again"
    assert vendor.asked.count("What do you notice about it?") == 1, "and it was bought once"


def test_the_wire_tells_the_voice_its_own_sentences_not_the_plans() -> None:
    """The sentences the client asks to have spoken are the ones on the WIRE, and the naming law
    writes some of them: live, "prove pythagoras with squares on the sides" opened with "Square on
    the base, square on the height, square on the longest side, hypotenuse 5.00 cm." — a sentence
    the plan never held. Told only what the plan said, the voice knew every sentence but the first
    and bought nothing while the first was being read (measured at 390 and 1440, both themes, on
    2026-09-10). So the wire tells it, where the list is final."""
    from wobo_gateway.board import stream
    from wobo_gateway.board.planner import Plan

    voice.forget_lines()
    plan = Plan(
        say="Look at this. The curve turns here.",
        presentation="plane",
        objects=[],
        ask={"prompt": "What do you notice about it?", "targets": []},
    )
    events = stream.build_events(plan)
    spoken = [str(e.data["text"]) for e in events if e.type == "say"]

    assert spoken[:2] == ["Look at this.", "The curve turns here."]
    assert voice.line_ahead(spoken[0]) == (
        (spoken[1], None),
        ("What do you notice about it?", "ask"),
    )


def test_nothing_is_bought_ahead_on_a_day_the_platform_is_trimming(
    client: TestClient, vendor: Vendor, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Buying ahead is anticipation, not the answer: past the day's first line the money goes to
    what a learner asked for. Every sentence is still spoken — each one just pays for itself."""
    from wobo_gateway import spend

    voice.remember_line(LINE)
    monkeypatch.setattr(spend, "verdict", lambda *_a, **_k: spend.Verdict.DEGRADE)

    _ask(client, FIRST)
    time.sleep(0.2)
    assert vendor.asked == [FIRST], "nothing was bought ahead"
