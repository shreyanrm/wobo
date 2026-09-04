"""Gemini TTS narration — the live sidecar for ``engine.video``.

Returns ``None`` whenever ``GEMINI_API_KEY`` is absent or the call fails: the caller
serves ``narrationAudio: null`` and the learner never sees an error. stdlib urllib
only — this path never runs keyless, so tests and CI never touch the network.
"""

from __future__ import annotations

import base64
import contextlib
import json
import logging
import os
import re
import struct

logger = logging.getLogger("wobo.gateway")

TTS_MODEL = "gemini-2.5-flash-preview-tts"
_TTS_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{TTS_MODEL}:generateContent"
_HTTP_TIMEOUT_S = 60.0
_VOICE = "Kore"


def synthesize_narration(
    text: str, *, instruction: str | None = None, capability: str = "voice.tts"
) -> dict[str, str] | None:
    """Narration audio for a motion piece. ``{"mime", "b64"}`` or ``None``.

    ``instruction`` is an optional system instruction carried with the line — how it is to be
    spoken, never what is said. The read-aloud path uses it for the learner's accent
    (``wobo_gateway.voice.accent_instruction``), so a one-shot spoken line lands in the same
    English as the live microphone; a narration that asks for nothing is unchanged.

    ``capability`` is which seam asked. It exists only for the usage ledger: this call is a paid
    request to Google that does NOT pass through ``telemetry.record_cost`` (it is a raw HTTPS POST,
    not a litellm completion), so until now it has been the one class of model call in the product
    that cost money and left no accounting trace at all. The default names the read-aloud route;
    the video engine passes ``voice.narration`` so a learner asking to be read to and a narrated
    explainer's audio can be told apart in the bill.
    """
    import urllib.error
    import urllib.request

    key_name = "GEMINI_API_KEY" if os.getenv("GEMINI_API_KEY") else "GOOGLE_AI_API_KEY"
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
    if not key or not text.strip():
        logger.warning("tts: no key present (checked GEMINI_API_KEY, GOOGLE_AI_API_KEY)")
        return None

    body: dict[str, object] = {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": _VOICE}}},
        },
    }
    if instruction and instruction.strip():
        # An instruction, never a setup field: the accent is asked for in words for the same
        # reason the sockets ask for it in words (see wobo_gateway.voice) — an unsupported
        # config key is rejected by the upstream and the line comes back silent.
        body["systemInstruction"] = {"parts": [{"text": instruction.strip()}]}
    req = urllib.request.Request(
        _TTS_URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:  # Google rejected it — surface WHY (key/billing/model)
        detail = ""
        with contextlib.suppress(OSError):
            detail = exc.read().decode(errors="replace")[:300]
        logger.warning("tts: Google HTTP %s via %s — %s", exc.code, key_name, detail)
        return None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        # a fast failure here (before a real round-trip) means the container cannot reach Google
        logger.warning("tts: request failed via %s — %s: %s", key_name, type(exc).__name__, exc)
        return None

    for cand in payload.get("candidates") or []:
        for part in (cand.get("content") or {}).get("parts") or []:
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                mime = inline.get("mimeType") or inline.get("mime_type") or "audio/pcm;rate=24000"
                audio = _as_playable(str(mime), str(inline["data"]))
                _record_spoken(capability, audio)
                return audio
    logger.warning("tts: Google 200 but no audio in response via %s", key_name)
    return None


def _record_spoken(capability: str, audio: dict[str, str]) -> None:
    """Put one spoken line in the usage ledger, measured in SECONDS of audio.

    Seconds, not calls: "how much of the free allowance did the spoken answers use" is one of the
    owner's questions, and a call count cannot answer it — one line is three seconds and another
    is ninety. The length is MEASURED off the WAV that is about to be played, never estimated from
    the character count.

    litellm has no price for this model, so the cost is written only when an operator has entered
    one (``LEDGER_PRICE_SPOKEN_SECOND_USD``), and the row then says the number came from a person
    rather than from a vendor. With no price entered the row is honestly unpriced and the free-day
    derivation reports the gap in words instead of guessing at it.

    Never raises. An accounting line is worth less than the audio a child is waiting for.
    """
    try:
        from wobo_gateway import ledger

        ms = wav_duration_ms(audio.get("b64") or "")
        if not ms:
            return
        seconds = ms / 1000.0
        price = ledger.configured_price(ledger.SPOKEN_SECOND)
        cost = None if price is None else price * seconds
        ledger.record(
            capability=capability,
            model_requested=TTS_MODEL,
            model_served=TTS_MODEL,
            cost_usd=cost,
            cost_source=ledger.UNPRICED if price is None else ledger.FROM_CONFIGURED,
            unit_kind=ledger.SPOKEN_SECOND,
            unit_count=seconds,
        )
        # AND THE DAILY MONEY CEILING. ``spend.py`` is fed from ``telemetry.record_cost``, which
        # only sees litellm completions — this is a raw HTTPS POST to a paid API, so every spoken
        # second the ledger recorded was a dollar the ceiling never counted. A ceiling that cannot
        # see the most expensive per-minute thing in the product is not the platform's ceiling.
        # With no price configured there is no number to add: the row is honestly unpriced and the
        # ceiling is honestly not charged for a figure nobody has. ``docs/OPERATIONS.md`` names
        # LEDGER_PRICE_SPOKEN_SECOND_USD as the entry that closes that gap.
        if cost:
            from wobo_gateway import spend

            spend.record(cost, capability=capability, model=TTS_MODEL)
    except Exception as exc:  # noqa: BLE001 — accounting must never break a spoken line
        logger.debug("tts: not recorded in the ledger (%s: %s)", type(exc).__name__, exc)


def _as_playable(mime: str, b64: str) -> dict[str, str]:
    """Gemini TTS returns raw little-endian 16-bit PCM (``audio/L16``/``audio/pcm``), which a
    browser ``<audio>`` element cannot decode. Wrap it in a WAV container so it plays as-is.
    Anything already in a container (wav/mp3/ogg) passes through untouched."""
    low = mime.lower()
    if "pcm" not in low and "l16" not in low:
        return {"mime": mime, "b64": b64}
    m = re.search(r"rate=(\d+)", low)
    rate = int(m.group(1)) if m else 24000
    try:
        pcm = base64.b64decode(b64)
    except (ValueError, TypeError):
        return {"mime": mime, "b64": b64}
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(pcm),
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        1,  # mono
        rate,
        rate * 2,  # byte rate = rate * channels * bytes/sample
        2,  # block align
        16,  # bits per sample
        b"data",
        len(pcm),
    )
    return {"mime": "audio/wav", "b64": base64.b64encode(header + pcm).decode("ascii")}


def wav_duration_ms(b64: str) -> int | None:
    """Measured beat length (ms) of a base64 WAV — the authoritative length the renderer
    advances on (MOTION.md §5 sync law). ``None`` for anything not a parseable WAV (a
    pass-through container we don't decode); the renderer then falls back to authored durationMs."""
    import io
    import wave

    try:
        data = base64.b64decode(b64)
        with wave.open(io.BytesIO(data), "rb") as w:
            frames, rate = w.getnframes(), w.getframerate()
        return round(frames * 1000 / rate) if rate else None
    except (ValueError, TypeError, wave.Error, EOFError):
        return None
