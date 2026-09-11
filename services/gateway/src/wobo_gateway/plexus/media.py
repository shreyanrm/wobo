"""Spoken lines: Gemini text-to-speech first, OpenAI text-to-speech behind it.

Gemini's native audio speaks first, with the beat instruction as it is. When Google does not
answer (an HTTP error, a dead network, a refusal, a silent 200 twice) the same line goes to
OpenAI's text-to-speech with the same instruction in that API's own ``instructions`` field, and
the usage ledger row names whichever model actually spoke. When neither speaks the answer is
``None``: the read-aloud route answers 502 and the client reads the same words with the device's
own voice (``apps/web-pwa/src/wobo/device-voice.ts``); the video engine serves
``narrationAudio: null``. A learner never sees an error either way.

**The same marks as the text funnel, since 2026-09-07.** Each voice is asked only when
``health.provider_available`` says its provider is not marked out, and what it answers is fed
back through ``model_call.note_failure``: a quota refusal marks the provider out at once, a
streak of ordinary failures or two timeouts marks it for a minute, a success clears it. Until
then a Google 429 was asked again on every spoken line and a Google hang was waited on for the
whole HTTP timeout on every line. The Gemini rung also gets a short deadline of its own
(:data:`_PRIMARY_TIMEOUT_S`) whenever OpenAI stands behind it, so a hang costs seconds, not a
minute, before the fallback speaks.

**ONE VOICE PER TURN, since 2026-09-11.** Everything above describes a choice made per SENTENCE,
and a sentence is not what a learner hears: an answer is. Measured live on 2026-09-10, 63 percent
of the voice spend went to the voice standing behind, after four timeouts marked Google out
mid-battery — so answers arrived in two mouths, the swap landing wherever Google happened to hang.
A turn's voice is therefore decided ONCE, above this file (``wobo_gateway.voice``, the turn
registry), and handed down as ``voice=``: a pinned line is asked of that voice and no other, and a
pinned line it cannot speak comes back ``None`` so the client holds it in silence rather than
finishing somebody else's answer. The two-voice ladder below still serves everything nobody decided
in advance — a card's narration, a video's line, anything with no turn behind it.

stdlib urllib only — neither path runs keyless, so tests and CI never touch the network.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import logging
import os
import re
import struct
import threading
from typing import Any

from wobo_gateway.routing import Tier, provider_of, tier_chain

logger = logging.getLogger("wobo.gateway")


def _openai_rung(tier: Tier, *, default: str) -> str:
    """The OpenAI id on a media tier's chain: the fallback the router says this seam reaches for."""
    for model in tier_chain(tier):
        if provider_of(model) == "openai":
            return model
    return default


TTS_MODEL = "gemini-2.5-flash-preview-tts"
_TTS_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{TTS_MODEL}:generateContent"
_HTTP_TIMEOUT_S = 60.0
#: The Gemini rung's deadline when OpenAI stands behind it. A line is at most 600 characters and
#: Gemini's text-to-speech answers it in a few seconds; without an answer by then it is a hang, and
#: the learner is better served by the other voice than by more seconds of waiting.
#:
#: TWELVE, NOT TWENTY (the adversary, wave 42, the spoken line). Measured live on 2026-09-10 off
#: the wire, every browser muted: when Google answered it answered in 4.3, 4.7, 4.8, 5.2, 5.5, 6.1,
#: 6.6, 8.0, 9.4 and 10.3 seconds; when it hung, the learner waited the whole twenty and THEN the
#: 2.5 to 4 seconds OpenAI needed — 22.5, 22.6, 22.9, 23.4 and 24.2 seconds for ONE SENTENCE, five
#: times in a four-minute battery. Twelve is above every answer Google actually gave, so no line
#: that would have been spoken in Wobo's first voice is handed to the second one, and a hang now
#: costs a learner about fifteen seconds instead of twenty-five. The four-to-ten seconds Google
#: takes when it does answer is not a timeout's to fix: it is the desk's, and it is written up in
#: the wave report.
_PRIMARY_TIMEOUT_S = 12.0
#: The deadline on a turn NOBODY HAS HEARD A SYLLABLE OF. Shorter than the one above on purpose:
#: while a turn is unheard its voice can still be re-decided whole, silently, so the cost of
#: waiting is the learner's whole first sentence rather than one gap inside an answer. Six seconds
#: covers the middle of the range Google actually answers in (4.3 to 10.3 s, measured 2026-09-10)
#: and leaves the second voice's own two-to-four seconds inside the patience the client has.
_UNHEARD_TIMEOUT_S = 6.0
_VOICE = "Kore"

#: The voice behind Gemini's, read from the router's ``voice`` row (``routing.DEFAULT_TABLE``,
#: overridable by ``WOBO_TIER_VOICE_CHAIN``). ``gpt-4o-mini-tts`` is the one OpenAI
#: text-to-speech model that takes an ``instructions`` field (``tts-1`` and ``tts-1-hd`` do not,
#: per the createSpeech reference), which is what lets the beat instruction ride whole. WAV out,
#: so the client's decoder and the ledger's second-counter see the container Gemini's PCM is
#: wrapped in.
OPENAI_TTS_ID = _openai_rung(Tier.VOICE, default="openai/gpt-4o-mini-tts")
OPENAI_TTS_MODEL = OPENAI_TTS_ID.split("/", 1)[1]
_OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"
_OPENAI_VOICE = "sage"
#: OpenAI's ``input`` ceiling is 4096 characters; the routes cap a line at 600 long before this.
_OPENAI_INPUT_MAX = 4096

#: The Gemini id the ledger carries, provider first, so the ``provider`` column is honest.
GEMINI_TTS_ID = f"gemini/{TTS_MODEL}"
#: How many times one line is asked for when the answer is 200 with no audio in it. Two: the
#: second ask has answered every time it was tried, and a third would only delay the fallback.
_SILENT_200_TRIES = 2


def _google_key() -> tuple[str | None, str]:
    """(the Google key, which variable it came from). Read to use, never printed."""
    if os.getenv("GEMINI_API_KEY"):
        return os.getenv("GEMINI_API_KEY"), "GEMINI_API_KEY"
    return os.getenv("GOOGLE_AI_API_KEY"), "GOOGLE_AI_API_KEY"


def speakers_configured() -> bool:
    """Is there any voice to speak with? One key of either vendor is enough."""
    return bool(_google_key()[0] or os.getenv("OPENAI_API_KEY"))


def pick_voice() -> str | None:
    """The ONE voice a whole turn is to be read in, decided from live health and the keys present.

    Called once per turn, before a syllable of it is heard (``voice.pin_turn_voice``), and never
    again inside it. Until 2026-09-11 there was no such moment: :func:`_buy` asked Gemini for THIS
    sentence and, when Gemini did not answer, asked OpenAI for THIS sentence — so a turn whose
    first sentence Google spoke and whose second it hung on reached the learner in two voices.
    Measured live on 2026-09-10, that was the majority case: 63 percent of the voice spend went to
    the fallback, in the middle of answers whose first sentence was Wobo's own voice.

    ``None`` only when there is no key at all, which the routes refuse long before this.
    """
    from wobo_gateway import health

    google, _ = _google_key()
    openai_key = os.getenv("OPENAI_API_KEY")
    for candidate, keyed in ((GEMINI_TTS_ID, bool(google)), (OPENAI_TTS_ID, bool(openai_key))):
        if keyed and health.provider_available(candidate):
            return candidate
    # Every voice is marked out: the turn still needs ONE of them rather than two, so it takes the
    # first one that has a key and the whole turn lives or dies with it.
    if google:
        return GEMINI_TTS_ID
    return OPENAI_TTS_ID if openai_key else None


def other_voice(voice_id: str | None) -> str | None:
    """The voice that is not this one, when it has a key. Used only to re-decide a turn that has
    not yet spoken a syllable — never inside an answer a learner is already hearing."""
    google, _ = _google_key()
    openai_key = os.getenv("OPENAI_API_KEY")
    if voice_id == GEMINI_TTS_ID:
        return OPENAI_TTS_ID if openai_key else None
    if voice_id == OPENAI_TTS_ID:
        return GEMINI_TTS_ID if google else None
    return None


def synthesize_narration(
    text: str,
    *,
    instruction: str | None = None,
    capability: str = "voice.tts",
    voice: str | None = None,
    deadline_s: float | None = None,
) -> dict[str, str] | None:
    """One spoken line: Gemini first, OpenAI behind it. ``{"mime", "b64"}`` or ``None``.

    ``instruction`` is how the line is to be spoken (the accent and the beat, never what is
    said); it reaches both voices whole. ``capability`` is which seam asked, for the usage
    ledger only: the default names the read-aloud route and the video engine passes
    ``voice.narration``, so a learner asking to be read to and a narrated explainer's audio can be
    told apart in the bill. These are paid raw HTTPS calls that never pass through
    ``telemetry.record_cost``, so the row is written here, and it says which one answered
    (``model_served``) against the one asked first (``model_requested``): a day when every line
    came from the fallback reads as exactly that.

    **The same line is bought once** (:func:`_cached`). A narration line is deterministic — the
    same words, the same instruction and the same voice produce the same audio — and the content
    lab paid twice for identical lines, about eighteen seconds of synthesis each. A hit returns
    the audio already on disk, records the seconds the learner received with ``cache_hit`` set and
    no provider charge, and never touches a vendor or the day's ceiling.
    """
    if not text.strip():
        return None
    google, key_name = _google_key()
    openai_key = os.getenv("OPENAI_API_KEY")
    if not google and not openai_key:
        logger.warning(
            "tts: no key present (checked GEMINI_API_KEY, GOOGLE_AI_API_KEY, OPENAI_API_KEY)"
        )
        return None

    key = _cache_key(text, instruction, voice)
    remembered = _cached(key)
    if remembered is not None:
        audio, spoke = remembered
        _record_cached(capability, audio, served=spoke)
        return audio

    # ONE LINE, ONE BUY, HOWEVER MANY ASK AT ONCE. The disk above only catches a line already
    # bought; two callers a moment apart both missed it and both paid, and the read-aloud path now
    # buys the sentences behind the one being read while it reads it (``voice.buy_line_ahead``), so
    # the client's own call for the next sentence lands squarely on a buy already in flight. The
    # second caller waits on the first's answer instead of paying the vendor again — and if nothing
    # comes of it, buys it themselves rather than leaving a learner in silence.
    mine, waiting = _claim_buy(key)
    if mine is None and waiting is not None:
        waiting.wait(_INFLIGHT_WAIT_S)
        remembered = _cached(key)
        if remembered is not None:
            audio, spoke = remembered
            _record_cached(capability, audio, served=spoke)
            return audio
    try:
        return _buy(
            text,
            instruction,
            capability=capability,
            key=key,
            google=google,
            key_name=key_name,
            openai_key=openai_key,
            pinned=voice,
            deadline_s=deadline_s,
        )
    finally:
        _release_buy(key, mine)


#: How long a caller waits on somebody else's buy of the same line before buying it themselves:
#: the longest a buy can honestly take (the first voice's deadline, then the second voice's own
#: few seconds) and no longer. A minute would pin a worker on a line whose listener left — the
#: client gives a sentence eight seconds and then reads it in the device's voice (``speech.tsx``).
_INFLIGHT_WAIT_S = _PRIMARY_TIMEOUT_S + 5.0
_inflight: dict[str, threading.Event] = {}
_inflight_lock = threading.Lock()


def _claim_buy(key: str) -> tuple[threading.Event | None, threading.Event | None]:
    """``(mine, waiting)``: the event to set when this caller's buy ends, or somebody else's."""
    with _inflight_lock:
        waiting = _inflight.get(key)
        if waiting is not None:
            return None, waiting
        mine = _inflight[key] = threading.Event()
        return mine, None


def _release_buy(key: str, mine: threading.Event | None) -> None:
    """Let go of a claimed buy, whichever way it ended, and wake everyone waiting on it."""
    if mine is None:
        return
    with _inflight_lock:
        if _inflight.get(key) is mine:
            del _inflight[key]
    mine.set()


def reset_inflight() -> None:
    """Test seam — forget every buy in flight."""
    with _inflight_lock:
        for event in _inflight.values():
            event.set()
        _inflight.clear()


def _buy(
    text: str,
    instruction: str | None,
    *,
    capability: str,
    key: str,
    google: str | None,
    key_name: str,
    openai_key: str | None,
    pinned: str | None = None,
    deadline_s: float | None = None,
) -> dict[str, str] | None:
    """The paid half of :func:`synthesize_narration`.

    Unpinned (a one-off line nobody decided in advance): Gemini first, OpenAI behind it.

    PINNED — every sentence of a turn, which is every sentence a learner hears in an answer — that
    one voice and no other. A pinned sentence the voice cannot speak comes back ``None`` and the
    route says 502: the client holds the sentence on its reading clock, in silence, in the one
    voice the turn has. Silence inside an answer is a pause; a second voice inside an answer is a
    different tutor finishing somebody else's sentence.
    """
    from wobo_gateway import health, telemetry

    if pinned is not None:
        return _buy_in_one_voice(
            text,
            instruction,
            capability=capability,
            key=key,
            google=google,
            key_name=key_name,
            openai_key=openai_key,
            pinned=pinned,
            deadline_s=deadline_s,
        )

    requested = GEMINI_TTS_ID if google else OPENAI_TTS_ID
    audio = None
    if google:
        if health.provider_available(GEMINI_TTS_ID):
            audio = _gemini_speak(
                text,
                instruction,
                google,
                key_name,
                timeout_s=_PRIMARY_TIMEOUT_S if openai_key else _HTTP_TIMEOUT_S,
            )
            if audio is not None:
                _record_spoken(capability, audio, served=GEMINI_TTS_ID, requested=requested)
                _remember(key, audio, served=GEMINI_TTS_ID)
                return audio
        else:
            telemetry.note_skipped(provider="gemini", model=GEMINI_TTS_ID)
    if openai_key:
        if health.provider_available(OPENAI_TTS_ID):
            audio = _openai_speak(text, instruction, openai_key)
            if audio is not None:
                _record_spoken(capability, audio, served=OPENAI_TTS_ID, requested=requested)
                _remember(key, audio, served=OPENAI_TTS_ID)
                return audio
        else:
            telemetry.note_skipped(provider="openai", model=OPENAI_TTS_ID)
    return None


def _buy_in_one_voice(
    text: str,
    instruction: str | None,
    *,
    capability: str,
    key: str,
    google: str | None,
    key_name: str,
    openai_key: str | None,
    pinned: str,
    deadline_s: float | None = None,
) -> dict[str, str] | None:
    """One sentence of a turn, in the turn's own voice. No other voice is asked, ever.

    ``deadline_s`` is how long that voice may take. The default is the primary's own short one:
    there is nothing standing behind a pinned voice, so a hang has nothing to hand over to and
    waiting a minute on it only widens the gap in an answer the learner is already hearing.

    A turn NOBODY HAS HEARD YET passes :data:`_UNHEARD_TIMEOUT_S`, which is shorter still, because
    the only thing that can be done about a hang at that point is to re-decide the whole turn's
    voice — and that is free, silent and invisible until the moment a syllable is served. Measured
    live on 2026-09-11, Google's text-to-speech hung on a majority of calls on this network: with
    twelve seconds of patience the re-decision landed after the client had already given up on the
    sentence and read it in the phone's own voice.
    """
    if pinned == GEMINI_TTS_ID:
        if not google:
            return None
        audio = _gemini_speak(
            text, instruction, google, key_name, timeout_s=deadline_s or _PRIMARY_TIMEOUT_S
        )
    elif pinned == OPENAI_TTS_ID:
        if not openai_key:
            return None
        audio = _openai_speak(text, instruction, openai_key)
    else:
        return None
    if audio is None:
        return None
    _record_spoken(capability, audio, served=pinned, requested=pinned)
    _remember(key, audio, served=pinned)
    return audio


# --- the spoken-line cache ---------------------------------------------------------------------
#
# Tier 1 of the content economy already keeps every generated artifact on disk (``plexus/store``);
# the audio those artifacts are read with was the one paid thing that was bought again every time.
# It is keyed on everything that changes the SOUND — the words, the beat instruction, and the two
# voices' identities — so a voice change or a re-worded line is a different file rather than a
# stale one. Nothing here may ever cost a child their audio: every failure is a miss.

#: Bump to invalidate every remembered line at once (a voice change, a container format change).
_CACHE_VERSION = "tts-v1"


def _cache_key(text: str, instruction: str | None, voice: str | None = None) -> str:
    """Everything that changes the SOUND, the turn's own voice included.

    A pinned line is kept under a key that names the voice that spoke it, so a clip bought in the
    OTHER voice — the same words, the same instruction, a different mouth — can never be served
    into a turn that has already been heard in this one. An unpinned line keeps exactly the key it
    has always had, so nothing already on the disk is orphaned by this.
    """
    identity = "\x00".join(
        [
            _CACHE_VERSION,
            TTS_MODEL,
            _VOICE,
            OPENAI_TTS_ID,
            _OPENAI_VOICE,
            *([voice] if voice else []),
            text.strip(),
            (instruction or "").strip(),
        ]
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _cache_path(key: str) -> Any:
    from wobo_gateway.plexus import store

    return store.cache_dir() / "voice" / f"{key}.json"


def _cached(key: str) -> tuple[dict[str, str], str] | None:
    """The audio already bought for this line, with the voice that spoke it. None on any miss."""
    try:
        raw = _cache_path(key).read_text(encoding="utf-8")
        entry = json.loads(raw)
        mime, b64 = str(entry["mime"]), str(entry["b64"])
        if not b64:
            return None
        return {"mime": mime, "b64": b64}, str(entry.get("model") or GEMINI_TTS_ID)
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _remember(key: str, audio: dict[str, str], *, served: str) -> None:
    """Keep this line's audio for the next learner who asks for it. Never raises."""
    try:
        from wobo_gateway.plexus import store

        store.write_atomic(
            _cache_path(key),
            json.dumps(
                {"mime": audio.get("mime"), "b64": audio.get("b64"), "model": served},
                ensure_ascii=False,
            ),
        )
    except Exception as exc:  # noqa: BLE001 — a cache that cannot be written is a cache miss
        logger.debug("tts: line not cached (%s: %s)", type(exc).__name__, exc)


def _record_cached(capability: str, audio: dict[str, str], *, served: str) -> None:
    """A cache hit is still a spoken line the learner received — the seconds are recorded, the
    money is not. Without the row, the ledger would only ever see the expensive half of the
    traffic and every per-minute figure drawn from it would be wrong."""
    logger.info("voice: %s spoke a line (%s, from the disk)", served, capability)
    try:
        from wobo_gateway import ledger

        ms = wav_duration_ms(audio.get("b64") or "")
        if not ms:
            return
        ledger.record(
            capability=capability,
            model_requested=served,
            model_served=served,
            cost_usd=0.0,
            cost_source=ledger.NO_PROVIDER_CHARGE,
            unit_kind=ledger.SPOKEN_SECOND,
            unit_count=ms / 1000.0,
            cache_hit=True,
        )
    except Exception as exc:  # noqa: BLE001 — accounting must never break a spoken line
        logger.debug("tts: cache hit not recorded (%s: %s)", type(exc).__name__, exc)


def _openai_speak(text: str, instruction: str | None, key: str) -> dict[str, str] | None:
    """The same line through OpenAI's text-to-speech, the beat instruction in its own field.

    ``POST /v1/audio/speech`` (the createSpeech reference, read 2026-09-05 and again 2026-09-07,
    when it listed ``gpt-4o-mini-tts`` and a dated snapshot of it beside the two
    ``tts-1`` models): ``model``,
    ``input``, ``voice``, an optional ``instructions`` string that ``gpt-4o-mini-tts`` honours,
    and ``response_format`` from mp3, opus, aac, flac, wav, pcm. The body of the answer is the
    audio itself, not JSON. The line goes in ``input`` alone: the instruction has its own field
    here, so the marker sentence Gemini needs (:func:`spoken_prompt`) is not sent.
    """
    import urllib.error
    import urllib.request

    body: dict[str, object] = {
        "model": OPENAI_TTS_MODEL,
        "input": text[:_OPENAI_INPUT_MAX],
        "voice": _OPENAI_VOICE,
        "response_format": "wav",
    }
    how = (instruction or "").strip()
    if how:
        body["instructions"] = how
    req = urllib.request.Request(
        _OPENAI_TTS_URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    from wobo_gateway import health
    from wobo_gateway.model_call import note_failure

    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        detail = ""
        with contextlib.suppress(OSError):
            detail = exc.read().decode(errors="replace")[:300]
        logger.warning("tts: OpenAI HTTP %s — %s", exc.code, detail)
        note_failure(OPENAI_TTS_ID, exc, detail=detail)
        return None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        logger.warning("tts: OpenAI request failed — %s: %s", type(exc).__name__, exc)
        note_failure(OPENAI_TTS_ID, exc)
        return None
    if not raw or not raw.startswith(b"RIFF"):
        logger.warning("tts: OpenAI answered with no WAV audio")
        return None
    health.record_model(OPENAI_TTS_ID, ok=True)
    return _rewrap_wav(raw)


def _rewrap_wav(raw: bytes) -> dict[str, str] | None:
    """A WAV with an honest header. OpenAI streams its WAV, so the RIFF and data sizes in the
    header are placeholders (0xFFFFFFFF) rather than the real lengths; the standard library's
    reader takes them at their word and measures a two-second line at twenty-four hours, which
    the ledger would bill and the video renderer would wait for (proved live, 2026-09-05). So the
    samples are lifted out and wrapped again with the sizes that are true, in the same container
    Gemini's PCM gets. ``None`` when the bytes are not a WAV with a fmt and a data chunk."""
    try:
        if raw[8:12] != b"WAVE":
            return None
        pos = 12
        channels, rate, bits = 1, 24000, 16
        data: bytes | None = None
        while pos + 8 <= len(raw):
            chunk, size = raw[pos : pos + 4], struct.unpack("<I", raw[pos + 4 : pos + 8])[0]
            body = raw[pos + 8 :]
            if chunk == b"fmt " and size >= 16:
                _fmt, channels, rate, _byte_rate, _align, bits = struct.unpack("<HHIIHH", body[:16])
            elif chunk == b"data":
                data = body if size == 0xFFFFFFFF or size > len(body) else body[:size]
                break
            pos += 8 + size + (size & 1)
        if data is None or not rate:
            return None
    except (struct.error, IndexError):
        return None
    align = max(1, channels * bits // 8)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(data),
        b"WAVE",
        b"fmt ",
        16,
        1,
        channels,
        rate,
        rate * align,
        align,
        bits,
        b"data",
        len(data),
    )
    return {"mime": "audio/wav", "b64": base64.b64encode(header + data).decode("ascii")}


def _gemini_speak(
    text: str,
    instruction: str | None,
    key: str,
    key_name: str,
    *,
    timeout_s: float = _HTTP_TIMEOUT_S,
) -> dict[str, str] | None:
    """The line through Gemini's text-to-speech. ``{"mime", "b64"}`` or ``None``.

    ``instruction`` is an optional instruction carried with the line — how it is to be spoken,
    never what is said. The read-aloud path uses it for the learner's accent and for the beat
    (``wobo_gateway.voice.spoken_instruction``: a win, a miss, a question, a step or the crisis
    line, docs/copy/voice.md 10b), so a one-shot spoken line lands in the same English as the
    live microphone and leans the way the tutor said it should; a narration that asks for nothing
    is unchanged. The instruction changes how the line is read and nothing about what is recorded
    for it: the ledger below measures the audio that came back, not the words sent.

    **It rides in the prompt, never as ``systemInstruction``.** The live sockets put their
    instruction in the setup's system field and the native-audio model honours it. This REST
    text-to-speech model does not: with a ``systemInstruction`` in the body it answers
    ``500 INTERNAL`` to every call, and with the same words in front of the line it answers with
    audio. Verified on 2026-09-05 against the production key, which means every one-shot line
    since the accent was added here had failed upstream and fallen back to the device's own
    voice. So the instruction is written ahead of the text, the way the vendor's own examples
    steer a reading, with one plain sentence between them that says where the words to read
    begin (:func:`spoken_prompt`). The listening pass transcribes what came back and the
    transcript is the line and only the line.

    Nothing is recorded here: the caller writes the ledger row once it knows who spoke.
    """
    import urllib.error
    import urllib.request

    from wobo_gateway import health
    from wobo_gateway.model_call import note_failure

    body: dict[str, object] = {
        # The instruction, when there is one, is in the prompt ahead of the line: this model
        # returns 500 to a systemInstruction field (see the docstring), and asked for in words
        # here it is honoured. Never a speechConfig field beyond the voice: an unsupported config
        # key is rejected by the upstream and the line comes back silent.
        "contents": [{"parts": [{"text": spoken_prompt(text, instruction)}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": _VOICE}}},
        },
    }
    # Once, and once more only when Google said 200 and sent no audio part: on the listening pass
    # of 2026-09-05 one read in eight came back that way, and the same prompt answered with audio
    # on the next call every time. An HTTP error or a dead network is not retried: that is a
    # reason, not a shrug, and the client falls back to the device voice at once.
    for attempt in range(_SILENT_200_TRIES):
        req = urllib.request.Request(
            _TTS_URL,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": key},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                payload = json.loads(resp.read().decode())
        except (
            urllib.error.HTTPError
        ) as exc:  # Google rejected it — surface WHY (key/billing/model)
            detail = ""
            with contextlib.suppress(OSError):
                detail = exc.read().decode(errors="replace")[:300]
            logger.warning("tts: Google HTTP %s via %s — %s", exc.code, key_name, detail)
            note_failure(GEMINI_TTS_ID, exc, detail=detail)
            return None
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            # a fast failure here (before a real round-trip) means the container cannot reach Google
            logger.warning("tts: request failed via %s — %s: %s", key_name, type(exc).__name__, exc)
            note_failure(GEMINI_TTS_ID, exc)
            return None

        for cand in payload.get("candidates") or []:
            for part in (cand.get("content") or {}).get("parts") or []:
                inline = part.get("inlineData") or part.get("inline_data")
                if inline and inline.get("data"):
                    mime = (
                        inline.get("mimeType") or inline.get("mime_type") or "audio/pcm;rate=24000"
                    )
                    health.record_model(GEMINI_TTS_ID, ok=True)
                    return _as_playable(str(mime), str(inline["data"]))
        refused = refusal_in(payload)
        if refused:
            # A 200 with no audio is also what a refusal looks like, and a refusal asked again
            # is a second paid call that refuses the same words. Logged as what it is, once.
            logger.warning("tts: Google refused the line via %s — %s", key_name, refused)
            return None
        logger.warning(
            "tts: Google 200 but no audio in response via %s (try %d of %d)",
            key_name,
            attempt + 1,
            _SILENT_200_TRIES,
        )
    return None


def refusal_in(payload: dict[str, Any]) -> str | None:
    """Why a 200 carried no audio, when the answer says so: the prompt was blocked
    (``promptFeedback.blockReason``) or a candidate was stopped for a reason other than finishing
    (``finishReason`` of SAFETY, RECITATION, BLOCKLIST, PROHIBITED_CONTENT, SPII ...). ``None``
    for the silent 200 that answers on the next ask, which is the only case worth a retry."""
    feedback = payload.get("promptFeedback") or payload.get("prompt_feedback") or {}
    reason = feedback.get("blockReason") or feedback.get("block_reason")
    if reason:
        return f"prompt blocked: {reason}"
    for cand in payload.get("candidates") or []:
        finish = str(cand.get("finishReason") or cand.get("finish_reason") or "")
        if finish and finish.upper() not in _FINISHED:
            return f"candidate stopped: {finish}"
    return None


#: The finish reasons that mean the model finished, not refused. Anything else is a refusal.
_FINISHED = frozenset({"STOP", "MAX_TOKENS", "FINISH_REASON_UNSPECIFIED"})


#: The one sentence between the instruction and the line. It says where the words to read begin,
#: so the model reads the line and not the instruction; it never describes the line itself. It
#: points at a position (everything after this sentence) and not at a punctuation mark: the marker
#: used to say "after the colon", and the instruction ahead of it carries two or three colons of
#: its own ("than your usual: pleased, not thrilled", "as written: never add a word"), so a line
#: that carried a colon too ("Look here: the sign") had two candidate starts. Every listened clip
#: had used a colon-free line, so that ambiguity had never been read; now there is none to read.
_READ_ONLY_THIS = (
    "Everything after this sentence is the text to read aloud, exactly as written, and "
    "nothing else."
)


def spoken_prompt(text: str, instruction: str | None = None) -> str:
    """What is sent to the text-to-speech model: the line alone, or the instruction, one plain
    sentence marking where the line starts, a blank line, and then the line, exactly as given.

    Deterministic: the same line under the same instruction is the same prompt, so the same line
    read twice sounds the same twice (docs/copy/voice.md 10b)."""
    how = (instruction or "").strip()
    if not how:
        return text
    return f"{how}\n\n{_READ_ONLY_THIS}\n\n{text}"


def _record_spoken(
    capability: str,
    audio: dict[str, str],
    *,
    served: str = GEMINI_TTS_ID,
    requested: str | None = None,
) -> None:
    """Put one spoken line in the usage ledger, measured in SECONDS of audio.

    ``served`` is the model that actually spoke and ``requested`` the one asked first; when they
    differ the row is marked as a fallback, the same way a text call's row is.

    Seconds, not calls: "how much of the free allowance did the spoken answers use" is one of the
    owner's questions, and a call count cannot answer it — one line is three seconds and another
    is ninety. The length is MEASURED off the WAV that is about to be played, never estimated from
    the character count.

    litellm has no price for this model, so the number comes from ``ledger.unit_price``: the
    operator's entry (``LEDGER_PRICE_SPOKEN_SECOND_USD``) when there is one, otherwise the vendor's
    own per-second rate from the ledger's catalogue, and the row says which. Until that catalogue
    existed every spoken row in this product was unpriced, and — because the ceiling below is fed
    from the same figure — every spoken second was outside the day's money ceiling as well.

    Never raises. An accounting line is worth less than the audio a child is waiting for.
    """
    # WHICH MOUTH SPOKE, in the operator's log and nowhere else. A learner is never told which
    # vendor read their answer (the route returns the accent and the beat and no vendor name), but
    # "did this whole answer come back in one voice" is not answerable from a spend total, and it
    # is the thing INK-FOUR's experience lens asks for. One line per spoken line, no words in it.
    logger.info("voice: %s spoke a line (%s, on the wire)", served, capability)
    try:
        from wobo_gateway import ledger

        ms = wav_duration_ms(audio.get("b64") or "")
        if not ms:
            return
        seconds = ms / 1000.0
        price, source = ledger.unit_price(ledger.SPOKEN_SECOND, served)
        cost = None if price is None else price * seconds
        ledger.record(
            capability=capability,
            model_requested=requested or served,
            model_served=served,
            cost_usd=cost,
            cost_source=source,
            unit_kind=ledger.SPOKEN_SECOND,
            unit_count=seconds,
        )
        # AND THE DAILY MONEY CEILING. ``spend.py`` is fed from ``telemetry.record_cost``, which
        # only sees litellm completions — this is a raw HTTPS POST to a paid API, so every spoken
        # second the ledger recorded was a dollar the ceiling never counted. A ceiling that cannot
        # see the most expensive per-minute thing in the product is not the platform's ceiling.
        # With the vendor's own per-second rate in the ledger's catalogue there is now always a
        # number for the two voices we actually call; a voice with no published unit price is
        # still honestly unpriced, and ``LEDGER_PRICE_SPOKEN_SECOND_USD`` closes that.
        if cost:
            from wobo_gateway import spend

            spend.record(cost, capability=capability, model=served)
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
