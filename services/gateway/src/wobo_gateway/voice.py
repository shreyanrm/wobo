"""Wobo's voice — Gemini Live through the gateway, the key never reaching the client.

``GET /v1/voice/session`` tells the client which voice mode it may use. With a
``GEMINI_API_KEY`` in the environment the answer is ``relay`` plus a short-lived,
single-use token: the browser connects to ``/v1/voice/relay?token=...`` and the gateway
proxies frames bidirectionally to Gemini Live, sending the setup (model + Wobo's persona
as the system instruction) itself so neither the key nor the persona ever leave the
server. Without a key: ``unavailable``.

The token gate exists so the sockets are never an open proxy to a paid API. HTTP middleware
does not run for a WebSocket, so the socket cannot check a bearer token itself: instead
``/v1/voice/session`` — which IS authenticated, like every other ``/v1`` route — mints a
short-lived, single-use token BOUND TO THE VERIFIED SUBJECT, and both sockets
(``/v1/voice/relay`` and ``/v1/voice/tts/stream``) require and consume one. Each socket has
its own concurrency cap, so a flood of read-aloud sockets can never starve the live mic.

**Accent by country (the voice contract, WOBO-PLAN §3).** A learner hears the English spoken
around them; American English is the fallback. The accent is resolved HERE, in the brain, from
the learner's own record — the verified token's profile claims (``country`` / ``locale``, plain
or under ``user_metadata``), and the request's ``Accept-Language`` as the device's own hint when
the record carries neither. It is never taken from a request body. ``GET /v1/voice/session``
returns it as ``accent`` (a BCP-47 tag, e.g. ``en-IN``) for two reasons: the browser's own
speech fallback can pick a matching local voice, and it is the honest statement of what the
learner is about to hear. The socket learns it from the TOKEN, not from a query parameter —
the token is the only thing a socket can trust, so the grant carries the accent with the subject.

All three spoken paths carry it: the live microphone (``/v1/voice/relay``), the read-aloud
socket (``/v1/voice/tts/stream``) — both from the grant — and the one-shot line
(``POST /v1/voice/tts``), which resolves it from the same verified record the session route
reads and returns it as ``accent`` beside the audio.

Every one of them carries the accent as a line in the system instruction rather than as
``generationConfig.speechConfig.languageCode``. That is deliberate: the native-audio model
detects the spoken language itself, and an unknown or unsupported setup field is rejected by
the upstream, which closes the socket instantly and takes the microphone with it — exactly how
voice died once before on a retired model id. An instruction in the system field cannot fail
that way on the sockets. It can on the one-shot line: the REST text-to-speech model answers 500
to a ``systemInstruction``, so there the same words ride in the prompt ahead of the line
(``plexus.media.spoken_prompt``). Wobo's voice is one voice everywhere; only the accent moves,
and it is chosen for clarity and warmth and never to signal a gender (WOBO-PLAN §19).

**The beat (docs/copy/voice.md 10b).** The style instruction used to be one flat "warm, natural
voice" for every line, so "you got it" and "not quite" were read identically: the screen-reader
failure 10b names. Now the tutor, who already knows what a line is, tells the voice as one small
enum (:data:`BEATS`: ``win``, ``miss``, ``ask``, ``step``, ``crisis``), and the instruction leans
that way by a degree (:func:`beat_instruction`). The voice never infers the beat from the words;
it is told, and a beat it was not told is the step. It rides the one-shot body (``beat``) and the
read-aloud socket's URL beside the token, and like the accent it is only ever an instruction.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import os
import re
import secrets
import threading
import time
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from wobo_gateway.wobo import WOBO_PERSONA

logger = logging.getLogger("wobo.gateway.voice")

# The typed-turn streaming voice reads Wobo's EXACT line aloud (verified verbatim against Gemini
# Live),
# so playback starts at the first ~200ms chunk instead of waiting on the whole clip — ~4s faster to
# first sound than the buffered /v1/voice/tts. This instruction keeps it reading, never replying.
_READ_VERBATIM = (
    "You are Wobo's text-to-speech voice. Read the user's message aloud EXACTLY as written — word "
    "for word, verbatim, in a warm, natural voice. Do NOT answer it, add to it, or rephrase it. "
    "Speak only the given text."
)

# ponytail: google-genai is not a gateway dep, so no ephemeral tokens; the relay keeps the
# key server-side instead. Switch session to token mode if the SDK ever lands in deps.
# The -latest alias survives Google's preview retirements — the pinned 2025 preview id died
# and took the mic with it (relay closed instantly on upstream rejection).
VOICE_MODEL = "gemini-2.5-flash-native-audio-latest"
#: The id the ledger and the spend line carry, provider first (``routing.CATALOGUE`` has the row).
VOICE_ID = f"gemini/{VOICE_MODEL}"

# --- what a minute of the live microphone costs ------------------------------------------------
#
# Gemini pricing page, "Gemini 2.5 Flash Native Audio (Live API)", read 2026-09-07: input 0.50
# USD per million tokens of text and 3.00 of audio; output 2.00 of text and 12.00 of audio. The
# tokens page: audio is 32 tokens per second. Until that day neither socket wrote a ledger row or
# charged the day's spend ceiling: the ceiling was asked once when the session token was minted
# and never charged for the minutes that followed, on the dearest per-minute seam in the product.
_LIVE_TEXT_IN_USD_PER_M = 0.50
_LIVE_AUDIO_IN_USD_PER_M = 3.00
_LIVE_AUDIO_OUT_USD_PER_M = 12.00
_AUDIO_TOKENS_PER_SECOND = 32
#: The rough tokenisation of the one text a socket sends (a read-aloud line): four characters a
#: token, the rule of thumb the vendors publish. Cents on a day, stated as an estimate.
_CHARS_PER_TEXT_TOKEN = 4
_PCM_BYTES_PER_SAMPLE = 2  # the Live API guide: raw little-endian 16-bit PCM, both directions
#: The Live API guide's native rates, used only when a frame's mimeType names none.
_DEFAULT_IN_RATE, _DEFAULT_OUT_RATE = 16000, 24000
_RATE = re.compile(r"rate=(\d+)")


def _pcm_seconds(blob: dict[str, Any], default_rate: int) -> float:
    """Seconds of audio in one inline blob, from its bytes and the rate its mimeType names."""
    mime = str(blob.get("mimeType") or blob.get("mime_type") or "")
    if not mime.startswith("audio/"):
        return 0.0
    data = blob.get("data")
    if not isinstance(data, str) or not data:
        return 0.0
    try:
        raw = base64.b64decode(data, validate=False)
    except (ValueError, TypeError):
        return 0.0
    match = _RATE.search(mime)
    rate = int(match.group(1)) if match else default_rate
    return len(raw) / (_PCM_BYTES_PER_SAMPLE * rate) if rate > 0 else 0.0


class LiveMeter:
    """What crossed one socket to Gemini Live, and the row that says so.

    Counted off the frames themselves as they are relayed: the PCM the browser sends up
    (``realtimeInput.audio`` or the older ``realtimeInput.mediaChunks``), the text a read-aloud
    socket sends, and the PCM in every ``serverContent.modelTurn`` part that comes down. Priced
    from the vendor's own figures above (``cost_source`` says ``catalogue``, not litellm and not
    an operator), written once at :meth:`close` as one ledger row and one ``spend.record``, and
    never raises: an accounting line is worth less than the child's voice. The frames' own
    ``usageMetadata`` is not relied on, because the reference does not say whether its counts are
    per message or running totals, and a figure derived from the bytes can be checked.
    """

    def __init__(self, capability: str) -> None:
        self.capability = capability
        self.audio_in_s = 0.0
        self.audio_out_s = 0.0
        self.text_in_chars = 0
        self._closed = False

    # -- what the browser sent ---------------------------------------------------------------
    def up(self, raw: str) -> None:
        frame = _frame(raw)
        if frame is None:
            return
        realtime = frame.get("realtimeInput")
        if isinstance(realtime, dict):
            blobs = []
            if isinstance(realtime.get("audio"), dict):
                blobs.append(realtime["audio"])
            chunks = realtime.get("mediaChunks")
            if isinstance(chunks, list):
                blobs.extend(c for c in chunks if isinstance(c, dict))
            for blob in blobs:
                self.audio_in_s += _pcm_seconds(blob, _DEFAULT_IN_RATE)
        content = frame.get("clientContent")
        if isinstance(content, dict):
            for turn in content.get("turns") or []:
                if not isinstance(turn, dict):
                    continue
                for part in turn.get("parts") or []:
                    if isinstance(part, dict) and isinstance(part.get("text"), str):
                        self.text_in_chars += len(part["text"])

    def text(self, line: str) -> None:
        """A line the gateway itself sends up (the read-aloud socket)."""
        self.text_in_chars += len(line)

    # -- what Gemini sent back ---------------------------------------------------------------
    def down(self, raw: str) -> None:
        frame = _frame(raw)
        if frame is None:
            return
        server = frame.get("serverContent")
        if not isinstance(server, dict):
            return
        turn = server.get("modelTurn")
        if not isinstance(turn, dict):
            return
        for part in turn.get("parts") or []:
            if not isinstance(part, dict):
                continue
            inline = part.get("inlineData") or part.get("inline_data")
            if isinstance(inline, dict):
                self.audio_out_s += _pcm_seconds(inline, _DEFAULT_OUT_RATE)

    # -- the figures ---------------------------------------------------------------------------
    @property
    def tokens_in(self) -> int:
        audio = round(self.audio_in_s * _AUDIO_TOKENS_PER_SECOND)
        text = -(-self.text_in_chars // _CHARS_PER_TEXT_TOKEN)
        return audio + text

    @property
    def tokens_out(self) -> int:
        return round(self.audio_out_s * _AUDIO_TOKENS_PER_SECOND)

    @property
    def cost_usd(self) -> float:
        audio_in = self.audio_in_s * _AUDIO_TOKENS_PER_SECOND * _LIVE_AUDIO_IN_USD_PER_M
        text_in = -(-self.text_in_chars // _CHARS_PER_TEXT_TOKEN) * _LIVE_TEXT_IN_USD_PER_M
        audio_out = self.audio_out_s * _AUDIO_TOKENS_PER_SECOND * _LIVE_AUDIO_OUT_USD_PER_M
        return (audio_in + text_in + audio_out) / 1e6

    def close(self) -> None:
        """Write the row, once. A socket that carried nothing writes nothing."""
        if self._closed:
            return
        self._closed = True
        if self.tokens_in == 0 and self.tokens_out == 0:
            return
        try:
            from wobo_gateway import ledger, spend

            unit_kind = ledger.unit_for(self.capability)
            seconds = (
                self.audio_out_s
                if unit_kind == ledger.SPOKEN_SECOND
                else self.audio_in_s + self.audio_out_s
            )
            cost = self.cost_usd
            ledger.record(
                capability=self.capability,
                model_requested=VOICE_ID,
                model_served=VOICE_ID,
                tokens_in=self.tokens_in,
                tokens_out=self.tokens_out,
                cost_usd=cost,
                cost_source=ledger.FROM_CATALOGUE,
                unit_kind=unit_kind,
                unit_count=seconds,
            )
            if cost:
                spend.record(cost, capability=self.capability, model=VOICE_ID)
        except Exception as exc:  # noqa: BLE001 — accounting must never break a voice
            logger.debug("voice: minutes not recorded (%s: %s)", type(exc).__name__, exc)


def _frame(raw: str) -> dict[str, Any] | None:
    try:
        frame = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return frame if isinstance(frame, dict) else None


_GEMINI_LIVE_URL = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
)

# Generous window: the client mints this only after the mic permission is granted, but a slow
# getUserMedia prompt (user deliberating) must never outlive the token before the relay connects.
_TOKEN_TTL_S = 300.0

# Concurrency is capped twice: once per learner, so one socket-holder cannot deny live voice to
# everybody, and once globally, so worst-case spend on the key stays bounded. The global caps used
# to be 4 apiece — four sockets held open by one person shut the platform's mic.
_MAX_RELAYS_PER_SUBJECT = int(os.getenv("VOICE_MAX_RELAYS_PER_LEARNER", "2"))
_MAX_TTS_PER_SUBJECT = int(os.getenv("VOICE_MAX_TTS_PER_LEARNER", "2"))
_MAX_CONCURRENT_RELAYS = int(os.getenv("VOICE_MAX_RELAYS", "24"))
# The read-aloud socket gets its OWN budget: it is short-lived and far more frequent than the
# live mic, and sharing one counter let typed turns lock a learner out of push-to-talk.
_MAX_CONCURRENT_TTS = int(os.getenv("VOICE_MAX_TTS", "24"))

_MAX_TOKENS = 4096
# Outstanding mints per learner. A mint is cheap for us and cheap for them, but an unbounded pile
# of them was the lever that emptied the whole store (see _mint_token).
_MAX_TOKENS_PER_SUBJECT = 8

# --- accent by country (WOBO-PLAN §3) ---------------------------------------------------------
#
# The fallback, named rather than implied: a learner we know nothing about hears American English.
AMERICAN_ENGLISH = "en-US"

# The accents Wobo can actually speak. Small on purpose: an accent we cannot produce is a promise
# we break, so a country that is not here falls back to American English rather than being handed
# a tag nobody voices. Keyed by ISO-3166 alpha-2, which is what a profile stores.
ACCENT_BY_COUNTRY: dict[str, str] = {
    "US": "en-US",
    "IN": "en-IN",
    "LK": "en-IN",
    "BD": "en-IN",
    "NP": "en-IN",
    "PK": "en-IN",
    "GB": "en-GB",
    "IE": "en-GB",
    "AU": "en-AU",
    "NZ": "en-AU",
}

#: Every accent the table above can produce — the closed set the sockets and the client agree on.
ACCENTS = frozenset(ACCENT_BY_COUNTRY.values())

#: How each one is asked for in words, because the accent travels as an instruction and not as a
#: setup field (see the module docstring). Wobo stays one voice; only the accent moves.
_ACCENT_IN_WORDS = {
    "en-US": "American English",
    "en-IN": "Indian English",
    "en-GB": "British English",
    "en-AU": "Australian English",
}

# The claim names a profile may carry the learner's country and locale under, plain or nested in
# the token's ``user_metadata``. Read, never asserted: a request body may not choose an accent.
_COUNTRY_CLAIMS = ("country", "country_code", "region")
_LOCALE_CLAIMS = ("locale", "language", "lang")


def accent_for(country: str | None = None, locale: str | None = None) -> str:
    """The accent this learner hears. Country first, then locale, then American English.

    A locale is honoured only when it names an accent we can actually speak (``en-GB``,
    ``en_IN``, ``en-IN,en;q=0.9`` all resolve); its region half is read as a country, so a
    learner whose device says ``en-ZA`` is not handed a tag with no voice behind it.
    """
    code = (country or "").strip().upper()
    if code in ACCENT_BY_COUNTRY:
        return ACCENT_BY_COUNTRY[code]
    tag = (locale or "").strip().replace("_", "-").split(",")[0].split(";")[0].strip()
    if tag:
        lowered = tag.lower()
        for accent in ACCENTS:
            if lowered == accent.lower():
                return accent
        region = tag.partition("-")[2].strip().upper()
        if region in ACCENT_BY_COUNTRY:
            return ACCENT_BY_COUNTRY[region]
    return AMERICAN_ENGLISH


def _claim(claims: Mapping[str, Any], names: tuple[str, ...]) -> str | None:
    """One profile field off the verified token, plain or under ``user_metadata``."""
    pools: list[Mapping[str, Any]] = [claims]
    for nest in ("user_metadata", "app_metadata", "profile"):
        nested = claims.get(nest)
        if isinstance(nested, Mapping):
            pools.append(nested)
    for pool in pools:
        for name in names:
            value = pool.get(name)
            if isinstance(value, str) and value.strip():
                return value
    return None


def learner_accent(
    claims: Mapping[str, Any] | None = None, accept_language: str | None = None
) -> str:
    """The accent for a verified learner: their own record first, their device second.

    ``claims`` is the verified token — the learner's profile as the brain proved it. The
    ``Accept-Language`` header is a hint from the device and is consulted only when the record
    says nothing, because an accent is a courtesy and not a privilege: the worst a wrong hint
    can do is give somebody the wrong English, and the fallback is American English regardless.
    """
    country = _claim(claims, _COUNTRY_CLAIMS) if claims else None
    locale = _claim(claims, _LOCALE_CLAIMS) if claims else None
    resolved = accent_for(country, locale)
    if resolved == AMERICAN_ENGLISH and not country and not locale:
        return accent_for(None, accept_language)
    return resolved


def accent_instruction(accent: str) -> str:
    """The one line that puts the accent in Wobo's mouth, for either socket's setup."""
    spoken = _ACCENT_IN_WORDS.get(accent, _ACCENT_IN_WORDS[AMERICAN_ENGLISH])
    return (
        f"Speak in {spoken}, in the accent a learner there would hear from a teacher — "
        "the same voice and the same warmth wherever you are, only the accent moves."
    )


# --- the beat (docs/copy/voice.md 10b) -------------------------------------------------------
#
# "The emotion follows the beat, and it is small." Five kinds of line, named by the tutor and
# carried to the voice; the voice is told, it never guesses from the words. Kept to five on purpose:
# a sixth beat is a taste call for the owner, not a default anyone adds in passing.
Beat = Literal["win", "miss", "ask", "step", "crisis"]
BEATS: tuple[Beat, ...] = ("win", "miss", "ask", "step", "crisis")
#: The default: calm, even, unhurried. A line whose beat nobody named is a step.
DEFAULT_BEAT: Beat = "step"

# The lean, in the words of 10b, one short instruction per beat. Each says HOW, never WHAT: the
# verbatim rule is restated once below and holds for all five. "Than your usual" is the degree.
_BEAT_IN_WORDS: dict[str, str] = {
    "win": (
        "The learner just got it. Read this a little brighter and a little quicker than your "
        "usual: pleased, not thrilled."
    ),
    "miss": (
        "The learner just missed. Read this gently, a little softer and a little slower than "
        "your usual: steady, never disappointed, never a sigh."
    ),
    "ask": (
        "Wobo is asking the learner a question. Read this curious and open, with a slight lift "
        "at the end."
    ),
    "step": "Wobo is explaining a step. Read this calm, even and unhurried: your usual voice.",
    "crisis": (
        "The learner may be in trouble. Read this quietly and slowly, the softest of all: warm, "
        "close, low, with no urgency in your voice at all."
    ),
}
# Tuned by measurement on 2026-09-05 (harness/listen.py, three clips per wording of one line, 27
# A/B clips in all, re-measured the same day). What separates cleanly is PACE: the win reads
# 3.9 to 4.2 s, the miss 4.6 to 5.2 s, the crisis 4.9 to 5.8 s, and the old crisis wording 4.6 s
# against 5.2 s for this one. Level and pitch do not separate: the ranges overlap by more than
# the lean (crisis old wording -14.5 dB, -16.3 to -12.2, against new -16.6 dB, -18.7 to -14.2;
# miss old pitch 216 Hz, 195 to 235, against new 199 Hz, 168 to 216), and on the listening set
# the step clip was the quietest of the five (-19.7 dB against the crisis's -18.1) with the two
# step clips 5.1 dB apart. So "the softest of all" is the instruction, not yet a measured fact;
# "the slowest" is. The step is NOT the pre-beat voice: the control (accent only) read 3.67 s and
# the step 4.2 to 4.6 s, 14 to 24 percent slower on the same line; "calm, even and unhurried" is a
# real lean, and whether a slower default is wanted is the owner's ear. The ask's "slight lift at
# the end" has not been heard: every clip so far was a statement and every one ended lower than
# it ran (end delta -54 to -113 Hz). A stronger win ("a smile in your voice") read SLOWER than
# this one and a stronger ask ended lower, n=3 inside a 40 Hz spread, so those stayed.

# What does not change, whatever the beat. Said once so five leans cannot drift into five voices.
_HELD_STEADY = (
    "Lean that way by a degree, never by a mile. Read exactly the words as written: never add a "
    "word, never perform them. Nothing is read as an exclamation. No laugh, no gasp, no sound "
    "effect."
)


def beat_of(value: object) -> Beat:
    """The beat a caller named, or the step when it named none or one we do not have.

    A beat only chooses a lean, never a voice, a model or a cost, so an unknown one is not an
    error at a socket: it is the default. The typed HTTP body refuses instead (:class:`TtsBody`),
    because there the caller can be told.
    """
    if isinstance(value, str):
        named = value.strip().lower()
        if named in _BEAT_IN_WORDS:
            return named  # type: ignore[return-value]
    return DEFAULT_BEAT


def beat_instruction(beat: Beat = DEFAULT_BEAT) -> str:
    """The one line that tells the voice what kind of line it is reading. Deterministic per beat:
    the same beat asks for the same thing every time, so the same line read twice sounds the same
    twice."""
    return _BEAT_IN_WORDS[beat_of(beat)]


def spoken_instruction(accent: str, beat: Beat = DEFAULT_BEAT) -> str:
    """How a line is to be said aloud: the accent, the beat, and what never changes. One
    instruction for every spoken path, never a setup field (see the module docstring)."""
    return f"{accent_instruction(accent)}\n\n{beat_instruction(beat)} {_HELD_STEADY}"


@dataclass(frozen=True)
class Grant:
    """What one minted token buys: whose session it is, and in which accent."""

    subject: str
    accent: str = AMERICAN_ENGLISH
    expiry: float = 0.0


_lock = threading.Lock()
# token -> grant; single-use. Insertion-ordered, so "oldest" is free.
_tokens: dict[str, Grant] = {}
_active_relays = 0
_active_tts = 0
# subject -> live socket count, so one learner's share is bounded independently of everyone's.
_relays_by_subject: dict[str, int] = {}
_tts_by_subject: dict[str, int] = {}


def _mint_token(subject: str, accent: str = AMERICAN_ENGLISH) -> str:
    """One short-lived, single-use token bound to ``subject``, carrying their accent.

    The accent rides the token because a WebSocket has no door of its own: the session route is
    where the learner's profile was read, so the grant is the only place the socket can learn the
    accent from without trusting a query parameter.

    Eviction is per learner and then oldest-first. It used to be ``_tokens.clear()`` on a full
    store: minting 4096 tokens threw away every OTHER learner's outstanding token, and their mic
    failed at connect. Nobody's eviction policy may be everybody's.
    """
    now = time.monotonic()
    with _lock:
        for stale in [t for t, grant in _tokens.items() if grant.expiry < now]:
            del _tokens[stale]
        mine = [t for t, grant in _tokens.items() if grant.subject == subject]
        for stale in mine[: max(0, len(mine) - _MAX_TOKENS_PER_SUBJECT + 1)]:
            del _tokens[stale]  # this learner's own oldest, never anyone else's
        while len(_tokens) >= _MAX_TOKENS:
            # Global ceiling. The biggest holder pays: evict their oldest, so a learner sitting
            # on one token keeps it. Never a wipe — a full store used to cost everybody theirs.
            counts: dict[str, int] = {}
            for grant in _tokens.values():
                counts[grant.subject] = counts.get(grant.subject, 0) + 1
            biggest = max(counts, key=lambda sub: counts[sub])
            del _tokens[next(t for t, g in _tokens.items() if g.subject == biggest)]
        token = secrets.token_urlsafe(24)
        _tokens[token] = Grant(subject=subject, accent=accent, expiry=now + _TOKEN_TTL_S)
    return token


def _consume_grant(token: str | None) -> Grant | None:
    """Spend a token and return the grant it carries, or None if it is no good."""
    if not token:
        return None
    with _lock:
        grant = _tokens.pop(token, None)
    if grant is None:
        return None
    return grant if grant.expiry >= time.monotonic() else None


def _consume_token(token: str | None) -> str | None:
    """Spend a token and return the subject it was minted for, or None if it is no good."""
    grant = _consume_grant(token)
    return grant.subject if grant is not None else None


@contextlib.contextmanager
def _socket_slot(subject: str, *, kind: str) -> Iterator[bool]:
    """Claim one live socket for ``subject``, or refuse. Claimed under the lock and released on
    the way out, so two sockets racing the cap cannot both read the old count and both get in."""
    global _active_relays, _active_tts
    per_subject = _relays_by_subject if kind == "relay" else _tts_by_subject
    subject_cap = _MAX_RELAYS_PER_SUBJECT if kind == "relay" else _MAX_TTS_PER_SUBJECT
    global_cap = _MAX_CONCURRENT_RELAYS if kind == "relay" else _MAX_CONCURRENT_TTS
    with _lock:
        active = _active_relays if kind == "relay" else _active_tts
        claimed = active < global_cap and per_subject.get(subject, 0) < subject_cap
        if claimed:
            per_subject[subject] = per_subject.get(subject, 0) + 1
            if kind == "relay":
                _active_relays += 1
            else:
                _active_tts += 1
    if not claimed:
        # Refused OUTSIDE the lock: the caller closes a socket here, and an await must never
        # happen while a threading lock the mint path needs is held.
        yield False
        return
    try:
        yield True
    finally:
        with _lock:
            remaining = per_subject.get(subject, 1) - 1
            if remaining > 0:
                per_subject[subject] = remaining
            else:
                per_subject.pop(subject, None)
            if kind == "relay":
                _active_relays -= 1
            else:
                _active_tts -= 1


def voice_session(subject: str, accent: str = AMERICAN_ENGLISH) -> dict[str, str]:
    """The voice handshake: which mode this learner may use right now, their one token, and the
    accent they are about to hear.

    No model id. It named the provider's model to every caller — the white-label rule says model
    ids never leave the brain (WOBO-PLAN 1), and the client has never read the field: the setup
    message holds the model server-side, where it belongs. ``accent`` is a BCP-47 tag and not a
    voice name, so nothing about the provider's voice catalogue leaves either.
    """
    if os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY"):
        return {"mode": "relay", "token": _mint_token(subject, accent), "accent": accent}
    # No session, no accent to promise: the client's own fallback picks whatever the device has.
    return {"mode": "unavailable"}


def forget(subject: str) -> int:
    """Drop every outstanding token minted for one learner, and say how many.

    The erase route calls this: a token is a session waiting to be opened as them, and forgetting
    a learner must not leave one behind. Only theirs — nobody's eviction is everybody's."""
    with _lock:
        mine = [t for t, grant in _tokens.items() if grant.subject == subject]
        for token in mine:
            del _tokens[token]
    return len(mine)


def reset_tokens() -> None:
    """Test seam — drop every outstanding token and every socket count."""
    global _active_relays, _active_tts
    with _lock:
        _tokens.clear()
        _relays_by_subject.clear()
        _tts_by_subject.clear()
        _active_relays = 0
        _active_tts = 0


# The only frame kinds a browser may put on the wire to Gemini Live. The gateway sends the
# setup itself — model, persona, transcription config — and a client-sent `setup` would replace
# ours: a different model, a different system instruction, our key. Anything not in this set is
# dropped rather than forwarded.
_RELAY_FRAME_KEYS = frozenset({"realtimeInput", "clientContent", "toolResponse"})

# One upstream frame is a mic chunk, not a file. Past this it is either a mistake or an attempt
# to spend the key by the megabyte.
_MAX_RELAY_FRAME_BYTES = int(os.getenv("VOICE_MAX_FRAME_BYTES", str(256 * 1024)))


def relay_frame_allowed(raw: str) -> bool:
    """May this client frame be forwarded to Gemini Live?

    The relay used to pipe ``client.receive_text()`` straight upstream. That handed the browser
    the whole BidiGenerateContent surface on OUR key: a second ``{"setup": …}`` frame re-opens
    the session with any model and any system instruction the caller likes, which is both a
    persona escape (Wobo's guardrails replaced mid-call, for a child, over audio) and an
    unmetered general-purpose model. Only the three frame kinds a microphone actually needs
    travel, and a frame carrying anything else — ``setup`` above all — is dropped.
    """
    if len(raw.encode("utf-8", "ignore")) > _MAX_RELAY_FRAME_BYTES:
        return False
    try:
        frame = json.loads(raw)
    except (ValueError, TypeError):
        return False
    if not isinstance(frame, dict) or not frame:
        return False
    return frame.keys() <= _RELAY_FRAME_KEYS


def _setup_message(accent: str = AMERICAN_ENGLISH) -> dict[str, Any]:
    return {
        "setup": {
            "model": f"models/{VOICE_MODEL}",
            "generationConfig": {"responseModalities": ["AUDIO"]},
            "systemInstruction": {
                "parts": [{"text": f"{WOBO_PERSONA}\n\n{accent_instruction(accent)}"}]
            },
            # Transcribe both sides so a spoken turn can land in the one chat archive
            # (same thread law) — the browser reads these off serverContent, never the audio.
            "inputAudioTranscription": {},
            "outputAudioTranscription": {},
        }
    }


def _tts_setup_message(accent: str = AMERICAN_ENGLISH, beat: Beat = DEFAULT_BEAT) -> dict[str, Any]:
    """Setup for the read-aloud streaming voice — verbatim persona, audio out only.

    Same accent as the live mic: a learner who hears Indian English when they speak to Wobo must
    not hear American English when Wobo reads a typed line back. One voice, one accent, both
    sockets. And the beat (10b): the same line leans the way the tutor said it should."""
    return {
        "setup": {
            "model": f"models/{VOICE_MODEL}",
            "generationConfig": {"responseModalities": ["AUDIO"]},
            "systemInstruction": {
                "parts": [{"text": f"{_READ_VERBATIM}\n\n{spoken_instruction(accent, beat)}"}]
            },
        }
    }


class TtsBody(BaseModel):
    """One spoken line — capped so the TTS bill is bounded per call.

    ``beat`` is what kind of line this is, named by the tutor (10b). Typed as the closed set so
    a beat we do not have is refused with a 422 rather than guessed at; omitted, it is the step."""

    text: str = Field(min_length=1, max_length=600)
    beat: Beat = DEFAULT_BEAT


def _charge_voice(request: Request, capability: str) -> None:
    """Meter one voice call against the learner's day AND against the platform's.

    Voice is a PAID API, and until now the meter was charged in exactly one place — the capability
    route — so a learner with a fully spent day still minted relay tokens and still reached the
    TTS API. Both routes go through the same meter as every other turn (``budget.CAPABILITY_CLASS``
    keeps the classification in one dict), keyed on the same meter key the door derived.

    **AND THE PLATFORM'S CEILING, which voice was outside.** ``spend.py`` is the daily USD limit
    described as covering the platform, and voice reached neither half of it: no cost was recorded
    into the accumulator, and nothing here ever asked :func:`spend.verdict`, so the only cap on the
    three most expensive seams in the product was a per-learner CALL count. Verified on 2026-09-04
    with the day at 200 % of the ceiling: ``POST /v1/voice/tts`` still ran to the key check.

    The ceiling is asked BEFORE the learner's meter, exactly as ``stream_board_turn`` does it: a
    learner refused because the platform is out of money must not also lose one of their own turns
    for it. There is no DEGRADE rung here — there is no cheaper voice — so degrade serves.

    Gating this route is what puts the two WEBSOCKETS inside the ceiling too. Neither has HTTP
    middleware of its own, and both refuse to open without a single-use token minted by
    ``/v1/voice/session``, which comes through here.
    """
    from wobo_gateway import billing, budget, consent, spend

    principal = request.state.principal
    profile = consent.get_profile(principal.subject, anonymous=principal.anonymous)
    # The subscription, not the profile: the same derivation the capability route uses, so a paid
    # learner is not cut off mid-sentence and a lapsed one does not keep the paid voice allowance.
    plan = billing.metered_plan(principal, profile)
    priority = spend.priority_for(
        anonymous=principal.anonymous, signed_in=bool(principal.subject), plan=plan
    )
    if spend.verdict(priority) is spend.Verdict.REFUSE:
        logger.warning(
            "spend ceiling refused a voice call",
            extra={"fields": {"capability": capability, **spend.state().as_dict()}},
        )
        raise spend.SpendCeilingReached(priority, capability=capability)
    budget.charge(request.state.meter_key, capability, plan, anonymous=principal.anonymous)


def _refund_voice(request: Request, capability: str) -> Any:
    """Give one voice call back to the learner's day (nothing was spoken) and say where the
    meter stands now, for the headers the client reads."""
    from wobo_gateway import billing, budget, consent

    principal = request.state.principal
    profile = consent.get_profile(principal.subject, anonymous=principal.anonymous)
    plan = billing.metered_plan(principal, profile)
    budget.refund(request.state.meter_key, capability)
    return budget.snapshot(request.state.meter_key, plan, anonymous=principal.anonymous)


def register_voice(app: FastAPI) -> None:
    @app.get("/v1/voice/session")
    def session(request: Request) -> dict[str, str]:
        # Authenticated by the gateway middleware; the token it mints carries that identity —
        # and the accent read from that same verified record — onto the sockets, which have no
        # middleware of their own. Metered here, because the token IS the spend: whatever it
        # opens, it opens on our key.
        _charge_voice(request, "voice.session")
        principal = request.state.principal
        accent = learner_accent(principal.claims, request.headers.get("accept-language"))
        return voice_session(principal.subject, accent)

    @app.post("/v1/voice/tts")
    def tts(body: TtsBody, request: Request) -> dict[str, str]:
        """Wobo's spoken line for a typed turn — same voice as the live relay, key server-side.

        Same ACCENT, too. This is the third way a learner hears Wobo (the live microphone, the
        read-aloud socket, and this one-shot line), and it is the one that used to speak American
        English to everybody: it took the learner's text and nothing about the learner. One voice,
        one accent, every path — so it is resolved from the same verified record the session route
        reads, and reported back beside the audio the way ``/v1/voice/session`` reports it.
        """
        from wobo_gateway import budget
        from wobo_gateway.plexus.media import speakers_configured, synthesize_narration

        # 503 only when NO voice has a key: Gemini speaks first and OpenAI's text-to-speech
        # stands behind it (media.py), so one missing key is not "voice unavailable".
        if not speakers_configured():
            raise HTTPException(status_code=503, detail="voice unavailable")
        _charge_voice(request, "voice.tts")

        accent = learner_accent(
            request.state.principal.claims, request.headers.get("accept-language")
        )
        audio = synthesize_narration(body.text, instruction=spoken_instruction(accent, body.beat))
        if audio is None:
            # Both voices failed: the client reads the same words with the device's own voice,
            # and the call is GIVEN BACK. A learner never pays for a call we did not serve; until
            # 2026-09-07 this route kept the charge for a line the device read for free.
            snap = _refund_voice(request, "voice.tts")
            raise HTTPException(
                status_code=502,
                detail="tts failed",
                headers=budget.headers(snap, budget.classify("voice.tts")),
            )
        # The accent and the beat are reported beside the audio: the honest statement of what
        # the learner is about to hear. Never which vendor spoke: that is the ledger's to know.
        return {"mime": audio["mime"], "b64": audio["b64"], "accent": accent, "beat": body.beat}

    @app.websocket("/v1/voice/relay")
    async def relay(client: WebSocket) -> None:
        key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
        # Gate BEFORE accept: a session-minted, unexpired, single-use token bound to a verified
        # subject is required, and the caps bound worst-case spend on the key.
        grant = _consume_grant(client.query_params.get("token"))
        if not key or grant is None:
            await client.close(code=1008, reason="voice unavailable")
            return
        subject = grant.subject

        import aiohttp  # lazy: already installed via litellm; mock-mode tests never need it

        # The subject the token was minted for is what the slot counts — the socket used to
        # consume it and throw it away, which is why the caps were everybody's and nobody's.
        with _socket_slot(subject, kind="relay") as claimed:
            if not claimed:
                await client.close(code=1008, reason="voice unavailable")
                return
            await client.accept()
            # Every frame in either direction is counted, and the minutes are written down when
            # the socket ends, whichever way it ends.
            meter = LiveMeter("voice.relay")
            try:
                async with (
                    aiohttp.ClientSession() as http,
                    http.ws_connect(f"{_GEMINI_LIVE_URL}?key={key}") as gemini,
                ):
                    await gemini.send_str(json.dumps(_setup_message(grant.accent)))

                    async def pump_up() -> None:
                        while True:  # ends via WebSocketDisconnect when the client hangs up
                            raw = await client.receive_text()
                            # Validate before forwarding: the socket is a microphone, not an
                            # open console on our key. A refused frame is dropped silently — a
                            # real client never sends one, and telling a prober which frame we
                            # rejected is free reconnaissance.
                            if relay_frame_allowed(raw):
                                meter.up(raw)
                                await gemini.send_str(raw)

                    async def pump_down() -> None:
                        async for msg in gemini:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                frame = msg.data
                            elif msg.type == aiohttp.WSMsgType.BINARY:
                                # Gemini Live frames JSON as binary; the browser wants text.
                                frame = msg.data.decode()
                            else:
                                break
                            meter.down(frame)
                            await client.send_text(frame)

                    up = asyncio.create_task(pump_up())
                    down = asyncio.create_task(pump_down())
                    try:
                        await asyncio.wait({up, down}, return_when=asyncio.FIRST_COMPLETED)
                    finally:
                        up.cancel()
                        down.cancel()
            finally:
                meter.close()
        # suppress RuntimeError: already closed by the disconnect that ended the pumps
        with contextlib.suppress(RuntimeError):
            await client.close()

    @app.websocket("/v1/voice/tts/stream")
    async def tts_stream(client: WebSocket) -> None:
        """Stream a typed line's audio: the client sends one text, the gateway opens Gemini Live
        with the read-verbatim persona and pipes audio chunks straight back, so playback starts at
        the first chunk (~4s sooner than the buffered clip). Key stays server-side; one line per
        socket, token-gated and capped like the relay. Any upstream failure just closes — the
        client falls back to the buffered /v1/voice/tts, so voice can never regress."""
        key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
        # Same gate as the relay: a session-minted, unexpired, single-use token bound to a
        # verified subject. Without it this socket was an open, unmetered mouth on a paid API.
        grant = _consume_grant(client.query_params.get("token"))
        if not key or grant is None:
            await client.close(code=1008, reason="voice unavailable")
            return
        subject = grant.subject

        import aiohttp  # lazy: already installed via litellm; mock-mode tests never touch it

        with _socket_slot(subject, kind="tts") as claimed:
            if not claimed:
                await client.close(code=1008, reason="voice unavailable")
                return
            await client.accept()
            try:
                text = (await client.receive_text())[:600]
            except (WebSocketDisconnect, RuntimeError):
                return
            if text.strip():
                # The beat rides the URL beside the token, not the first frame: the frame is the
                # line itself, and a gateway older than the beat would have read a JSON frame
                # aloud. A beat chooses only a lean, so an unknown one is the step, never a close.
                beat = beat_of(client.query_params.get("beat"))
                await _stream_one_line(client, aiohttp, key, text, accent=grant.accent, beat=beat)
        with contextlib.suppress(RuntimeError):
            await client.close()


async def _stream_one_line(
    client: WebSocket,
    aiohttp: Any,
    key: str,
    text: str,
    *,
    accent: str = AMERICAN_ENGLISH,
    beat: Beat = DEFAULT_BEAT,
) -> None:
    """Open Gemini Live for one read-aloud turn and pipe its frames to the browser. Metered the
    same way as the relay: the line up, every audio part down, one row at the end."""
    meter = LiveMeter("voice.tts")
    meter.text(text)
    try:
        async with (
            aiohttp.ClientSession() as http,
            http.ws_connect(f"{_GEMINI_LIVE_URL}?key={key}") as gemini,
        ):
            await gemini.send_str(json.dumps(_tts_setup_message(accent, beat)))
            await gemini.send_str(
                json.dumps(
                    {
                        "clientContent": {
                            "turns": [{"role": "user", "parts": [{"text": text}]}],
                            "turnComplete": True,
                        }
                    }
                )
            )
            async for msg in gemini:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    frame = msg.data
                elif msg.type == aiohttp.WSMsgType.BINARY:
                    # Gemini frames JSON as binary; the browser wants text.
                    frame = msg.data.decode()
                else:
                    break
                meter.down(frame)
                await client.send_text(frame)
                if '"turnComplete"' in frame or '"turn_complete"' in frame:
                    break
    except (aiohttp.ClientError, WebSocketDisconnect, RuntimeError, OSError):
        pass  # upstream/socket failure — client falls back to buffered TTS on a chunkless close
    finally:
        meter.close()
