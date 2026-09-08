"""The invisible spend: image and audio.

The wave-30 content lab wrote 986 ledger rows and 161 of them carried ``cost_source: unpriced`` —
EVERY ``engine.image`` row and EVERY ``voice.tts`` row. Both seams are raw HTTPS POSTs that never
pass through litellm, so nothing priced them; and because the daily money ceiling (``spend.py``) is
fed from the same numbers, image and audio spend did not count against the $40 ceiling AT ALL. The
dearest per-minute thing in the product was free, on paper.

The same lab re-synthesised identical narration lines: the same sentence, ~18 seconds of Gemini
each time, billed twice. Nothing cached a spoken line.

These tests are those two holes, in the seams that actually call the vendors.
"""

from __future__ import annotations

import base64
import io
import json
import struct
import wave
from pathlib import Path
from typing import Any

import pytest
from wobo_gateway import ledger, spend


# --- a fake store, so a row can be read back without a network ---------------------------------
class FakeStore:
    def __init__(self) -> None:
        self.calls: list[Any] = []

    def __call__(
        self, method: str, url: str, headers: dict[str, str], body: bytes | None
    ) -> tuple[int, Any]:
        self.calls.append(json.loads(body.decode()) if body else None)
        return 201, None

    @property
    def rows(self) -> list[dict[str, Any]]:
        return [row for parsed in self.calls if isinstance(parsed, list) for row in parsed]


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    monkeypatch.setenv("USAGE_LEDGER_PEPPER", "a-pepper-for-the-suite")
    fake = FakeStore()
    ledger.configure(
        base_url="https://project.example", service_key="svc", transport=fake, autoflush=False
    )
    return fake


def _wav(seconds: float, rate: int = 24000) -> str:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(struct.pack("<h", 0) * int(rate * seconds))
    return base64.b64encode(buf.getvalue()).decode()


class _GoogleSaid:
    """Google's TTS endpoint, one WAV back, no network — and it counts how often it was asked."""

    calls = 0

    def __init__(self, seconds: float) -> None:
        self.payload = {
            "candidates": [
                {
                    "content": {
                        "parts": [{"inlineData": {"mimeType": "audio/wav", "data": _wav(seconds)}}]
                    }
                }
            ]
        }

    def __enter__(self) -> _GoogleSaid:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode()


@pytest.fixture
def speaker(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Any:
    """``synthesize_narration`` with a fake upstream and a cache directory of its own."""
    import urllib.request

    from wobo_gateway.plexus import media

    monkeypatch.setenv("GEMINI_API_KEY", "not-a-real-key")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    # A cache directory of this test's own: the spoken-line cache is a real file cache, and one
    # test's remembered audio must never be another test's vendor call that never happened.
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path / "cache"))
    asked = {"n": 0}

    def fake_urlopen(*_a: object, **_k: object) -> _GoogleSaid:
        asked["n"] += 1
        return _GoogleSaid(9.0)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    def speak(text: str = "The same line, twice.", **kwargs: Any) -> Any:
        return media.synthesize_narration(text, **kwargs)

    speak.asked = asked  # type: ignore[attr-defined]
    return speak


# --- 1. the price ------------------------------------------------------------------------------


def test_a_spoken_second_carries_the_vendors_own_price(
    store: FakeStore, speaker: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Nine seconds of Gemini TTS is a real number on a real invoice, and the row must say it."""
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "100.0")
    spend.reset()
    before = spend.state().spent_usd

    assert speaker() is not None
    ledger.flush_now()

    from wobo_gateway.plexus import media

    row = store.rows[0]
    assert row["capability"] == "voice.tts"
    assert row["unit_kind"] == ledger.SPOKEN_SECOND
    assert row["cost_source"] == ledger.FROM_CATALOGUE
    per_second = ledger.catalogue_unit_price(ledger.SPOKEN_SECOND, media.GEMINI_TTS_ID)
    assert per_second is not None, "the voice this product actually calls must carry a price"
    assert row["cost_usd"] == pytest.approx(9.0 * per_second, rel=0.01)
    assert row["cost_usd"] > 0
    assert spend.state().spent_usd > before, "spoken seconds never reached the money ceiling"


def test_a_drawn_image_carries_the_vendors_own_price(
    store: FakeStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``gemini-2.5-flash-image`` is 0.039 USD an image on the page routing.CATALOGUE already
    quotes. Every one of the lab's image rows was unpriced, so the ceiling saw none of them."""
    from wobo_gateway.plexus import image

    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "100.0")
    spend.reset()
    before = spend.state().spent_usd

    image._record_image(image.GEMINI_IMAGE_ID, image.GEMINI_IMAGE_ID)
    ledger.flush_now()

    row = store.rows[0]
    assert row["capability"] == "engine.image"
    assert row["unit_kind"] == ledger.IMAGE
    assert row["cost_source"] == ledger.FROM_CATALOGUE
    assert row["cost_usd"] == pytest.approx(0.039, abs=1e-6)
    assert spend.state().spent_usd == pytest.approx(before + 0.039, abs=1e-6)


def test_an_operator_price_still_beats_the_catalogue(
    store: FakeStore, speaker: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A person who has read their own invoice knows better than a copied price list."""
    monkeypatch.setenv("LEDGER_PRICE_SPOKEN_SECOND_USD", "0.001")
    assert speaker() is not None
    ledger.flush_now()
    row = store.rows[0]
    assert row["cost_source"] == ledger.FROM_CONFIGURED
    assert row["cost_usd"] == pytest.approx(0.009, abs=1e-6)


def test_a_model_with_no_published_unit_price_stays_honestly_unpriced(
    store: FakeStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The rule the ledger has always had: a number nobody published is not invented here."""
    from wobo_gateway.plexus import image

    image._record_image("gemini/some-model-nobody-priced", image.GEMINI_IMAGE_ID)
    ledger.flush_now()
    row = store.rows[0]
    assert row["cost_usd"] is None
    assert row["cost_source"] == ledger.UNPRICED


# --- 2. the cache ------------------------------------------------------------------------------


def test_the_same_line_is_bought_once(
    store: FakeStore, speaker: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two identical lines were re-synthesised at ~18 s each in the lab, and billed twice."""
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "100.0")
    spend.reset()

    first = speaker()
    after_first = spend.state().spent_usd
    second = speaker()

    assert first == second, "the cached audio must be the same audio"
    assert speaker.asked["n"] == 1, "the second identical line went to the vendor again"
    assert spend.state().spent_usd == pytest.approx(after_first), "a cache hit was billed"

    ledger.flush_now()
    assert len(store.rows) == 2, "a served line must still be recorded"
    assert store.rows[0]["cache_hit"] is False
    assert store.rows[1]["cache_hit"] is True
    assert store.rows[1]["unit_count"] == pytest.approx(store.rows[0]["unit_count"])
    assert store.rows[1]["cost_usd"] in (None, 0.0)


def test_a_different_line_or_a_different_instruction_is_a_different_line(
    store: FakeStore, speaker: Any
) -> None:
    """The beat instruction changes how the line is SAID, so it changes the audio."""
    speaker("One line.")
    speaker("Another line.")
    assert speaker.asked["n"] == 2
    speaker("One line.", instruction="Say it slowly.")
    assert speaker.asked["n"] == 3
    speaker("One line.")
    assert speaker.asked["n"] == 3, "the first line should still be cached"


def test_a_cache_that_cannot_be_written_never_costs_a_child_their_audio(
    speaker: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The cache is an economy, not a dependency: a read-only disk must not silence Wobo."""
    from wobo_gateway.plexus import media

    monkeypatch.setattr(media, "_cache_path", lambda *_a, **_k: (_ for _ in ()).throw(OSError()))
    assert speaker("A line spoken with a broken cache.") is not None
