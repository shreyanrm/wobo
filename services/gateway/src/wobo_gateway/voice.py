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

**One voice per turn (2026-09-11).** "Wobo's voice is one voice everywhere" was true of the
accent and false of the mouth. Which vendor read a line was decided per SENTENCE, deep inside
``plexus.media``, so an answer whose first sentence Google spoke and whose second it hung on
reached a learner in two voices — 63 percent of the live voice spend on 2026-09-10 went to the
voice standing behind, and two of six boards fell through to the PHONE's own voice mid-answer.
An answer is one performance, so the mouth is now the turn's: the sentences of a turn are known
here the moment its words are decided, the voice for all of them is decided ONCE from live
provider health, and the whole plan is synthesised then and there rather than one round trip at
a time behind the learner. See the turn registry below.

**One mouth, one bill (2026-09-15).** One voice per turn was true of the VENDOR and false of the
PATH. The client asks for a turn's deciding sentence two ways at once — the buffered ladder
(``POST /v1/voice/tts``) and this file's read-aloud socket, which is Gemini Live — and plays
whichever audio lands first (``speech.tsx`` ``firstSound``); from then on every remaining sentence
goes to the mouth that won and to no other (``soundAgain``). The gateway served both sides of that
race and paid for both: wave 60 measured ``voice.tts`` at $0.2306 across THREE models for fourteen
turns against $0.0874 for twelve in wave 57, and Wobo still reached the learner in two voices.
Three rules answer it, and none of them costs a millisecond at the ear: the socket does not buy a
line the gateway already holds (:func:`line_already_bought` — a clip on the disk answers the same
ask in milliseconds and no socket that still has to connect can beat it); a turn whose mouth the
stream has claimed is not also bought on the ladder (:func:`claim_mouth`, claimed on delivery, the
same evidence the client claims on, read by :func:`_buy_parts`); and a turn nobody has heard a
syllable of does not keep asking a voice whose provider has been marked OUT
(:func:`turn_voice_for`).
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import contextvars
import json
import logging
import os
import re
import secrets
import threading
import time
import uuid
from collections.abc import Iterator, Mapping, Sequence
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


def relay_configured() -> bool:
    """Can a SOCKET be opened at all? Gemini Live and nothing else.

    Deliberately not ``plexus.media.speakers_configured``, which is the wider question — that one
    counts the OpenAI text-to-speech fallback, which can answer a one-shot line but cannot hold a
    live socket open. The two are asked in different places for different things, and the route
    below asks this one BEFORE it charges, so a Gemini-less box refuses for free.
    """
    return bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY"))


def voice_session(subject: str, accent: str = AMERICAN_ENGLISH) -> dict[str, str]:
    """The voice handshake: which mode this learner may use right now, their one token, and the
    accent they are about to hear.

    No model id. It named the provider's model to every caller — the white-label rule says model
    ids never leave the brain (WOBO-PLAN 1), and the client has never read the field: the setup
    message holds the model server-side, where it belongs. ``accent`` is a BCP-47 tag and not a
    voice name, so nothing about the provider's voice catalogue leaves either.
    """
    if relay_configured():
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


# --- THE LINE AHEAD: the rest of what Wobo is about to say, bought while the first is read ------
#
# The client asks for ONE SENTENCE PER CALL and asks for the next one only once it holds the audio
# for this one (``speech.tsx`` ``startUtterance``, and the board's hand waits on those same
# sentences — ``wobo/beat.ts``). Each of those calls is a whole text-to-speech round trip. Measured
# live on 2026-09-10 with every browser muted, off the wire: 4.3 to 10.3 seconds when Google's
# text-to-speech spoke, 22.5 to 24.2 when it hung and OpenAI spoke behind it, and 2 to 21
# MILLISECONDS when the line had been bought before. So Wobo's written line was prompt and Wobo's
# VOICE arrived a slow round trip later, then another for the next sentence, and another — the
# voice falling further behind the ink with every sentence of the same answer.
#
# The gateway wrote the whole line before one syllable of it was asked for. So when a sentence is
# asked for, the sentences BEHIND it in that same line are bought at the same moment, with the same
# accent and the same beat the asked one is being read with — the same cache key the client's next
# call will present, so the buy is the same buy and nothing is bought twice (``plexus.media``
# refuses to buy one line twice at once). By the time the client asks, the audio is on the disk.
#
# What is remembered is Wobo's own sentence, for three minutes, and nothing a learner typed: the
# lines come from ``wobo.py`` at the moment the turn's words are decided.

#: How many sentences behind the asked one are bought. Two covers the two-to-four-sentence answer
#: the plan grammar asks for without buying a line the learner may never sit through.
AHEAD_SENTENCES = 2
#: How long a decided line is worth buying ahead for. A turn the learner walked away from is not.
_AHEAD_TTL_S = 180.0
#: How many lines are remembered at once. Small: this is the turn in flight, not a history.
_AHEAD_MAX = 64
#: At most this many lines are being bought ahead across the whole service at any moment, so a
#: burst of turns can never spawn an unbounded number of threads on a paid API.
_AHEAD_IN_FLIGHT = 8

#: sentence -> (when it was decided, the sentences behind it and the beat each is read on)
_ahead: dict[str, tuple[float, tuple[tuple[str, Beat | None], ...]]] = {}
_ahead_lock = threading.Lock()
_ahead_slots = threading.Semaphore(_AHEAD_IN_FLIGHT)


def sentences_of(say: str) -> list[str]:
    """Wobo's line split the way Wobo speaks it — the same split that cut it into ``say`` frames."""
    from wobo_gateway.board.stream import sentences

    return sentences(say)


def remember_line(say: str, *, ask: str | None = None, accent: str | None = None) -> None:
    """Remember what Wobo is about to say, so the voice can buy it ahead of the ask.

    Called from ``wobo.py`` the moment a turn's words are decided. ``ask`` is the question that
    hands the next move back: the client speaks it last and speaks it as a QUESTION
    (``board-turn.ts``: ``utterance.say(prompt, 'ask')``), so it is remembered with the beat it
    will be read on — buy it on any other beat and the key is a key nobody presents.

    Never raises and never blocks: a line that is not remembered is simply not bought ahead, and
    the learner hears exactly what they hear today.
    """
    try:
        remember_parts(sentences_of(say), ask=ask, accent=accent)
    except Exception as exc:  # noqa: BLE001 — a line we cannot split is one we do not buy ahead
        logger.debug("voice: line not remembered (%s: %s)", type(exc).__name__, exc)


def remember_parts(
    said: list[str], *, ask: str | None = None, accent: str | None = None
) -> None:
    """The same, for a caller that has already split the line — ``board.stream.build_events``
    holds the EXACT sentences the client will ask for, in order, after the naming law has had its
    say, so what it hands over is the wire's own list rather than the plan's."""
    parts: list[tuple[str, Beat | None]] = [(p.strip(), None) for p in said if p and p.strip()]
    question = (ask or "").strip()
    if question and (not parts or parts[-1][0] != question):
        parts.append((question, "ask"))
    if not parts:
        return
    # THE ANSWER IS ONE PERFORMANCE. Registered before anything is bought, so the voice every
    # sentence of it will be read in is decided once, here, rather than per sentence behind the
    # learner — and so the whole plan can be synthesised now, while the words are being drawn.
    _register_turn(parts)
    _speak_turn_ahead(parts, accent=accent)
    if len(parts) < 2:
        return
    now = time.monotonic()
    with _ahead_lock:
        for stale in [k for k, (at, _) in _ahead.items() if now - at > _AHEAD_TTL_S]:
            del _ahead[stale]
        while len(_ahead) >= _AHEAD_MAX:
            del _ahead[next(iter(_ahead))]
        for i, (part, _beat) in enumerate(parts[:-1]):
            _ahead[part] = (now, tuple(parts[i + 1 : i + 1 + AHEAD_SENTENCES]))


def line_ahead(text: str) -> tuple[tuple[str, Beat | None], ...]:
    """What follows this sentence in a line Wobo decided — each with the beat it is read on when
    that is not the beat of the sentence being asked for — or ``()`` for anything else."""
    key = (text or "").strip()
    if not key:
        return ()
    with _ahead_lock:
        found = _ahead.get(key)
        if found is None:
            return ()
        at, rest = found
        if time.monotonic() - at > _AHEAD_TTL_S:
            del _ahead[key]
            return ()
        return rest


def forget_lines() -> None:
    """Test seam — forget every remembered line, and every turn's voice with it."""
    with _ahead_lock:
        _ahead.clear()
    with _turn_lock:
        _turns.clear()
        _turn_of.clear()


# --- ONE VOICE, ONE TURN ------------------------------------------------------------------------
#
# Wobo had two voices and which one a learner heard depended on whether Google hung. Measured live
# on 2026-09-10 across twelve turns, every browser muted, off the synthesis call and the wire: 63
# percent of the voice spend went to the FALLBACK voice after four timeouts marked Google out, and
# on two of six boards the answer fell through to the DEVICE's own voice at 21.4 and 25.3 seconds —
# in the MIDDLE of the answer. INK-FOUR experience asks for one voice.
#
# The choice was being made per SENTENCE, inside ``plexus.media._buy``, which knows one line and
# nothing about the answer it belongs to. It belongs to the TURN, and the turn is known here: the
# sentences are remembered above the moment the words are decided, seconds before a syllable of
# them is asked for. So each remembered turn carries its own voice, decided once from live provider
# health, and every sentence of it is read in that voice — including the closing question.
#
# One re-decision is allowed and it is the one nobody hears: a turn that has not yet spoken may
# change voice, because that is a choice made BEFORE the answer rather than inside it. Once a
# syllable of the turn has been served the voice is frozen, and a sentence the voice cannot speak
# is silence on the client's reading clock rather than a second voice for one line.


#: The two ways a turn's audio can reach the ear: the buffered ladder, or the voice socket.
Mouth = Literal["buffered", "stream"]


@dataclass
class _Turn:
    """One answer's sentences, the one voice they are all read in, and the mouth they reach by."""

    at: float
    parts: tuple[tuple[str, Beat | None], ...]
    voice: str | None = None
    heard: bool = False
    mouth: Mouth | None = None


#: turn id -> the turn. Small and short-lived: these are the turns in flight, not a history.
_turns: dict[str, _Turn] = {}
#: a sentence -> the turn it belongs to. The client presents a sentence; this is how we know.
_turn_of: dict[str, str] = {}
_turn_lock = threading.Lock()


def _sweep_turns(now: float) -> None:
    """Drop what has gone stale. Caller holds ``_turn_lock``."""
    stale = [tid for tid, turn in _turns.items() if now - turn.at > _AHEAD_TTL_S]
    while len(_turns) - len(stale) >= _AHEAD_MAX:
        oldest = min(_turns, key=lambda tid: _turns[tid].at)
        if oldest in stale:
            break
        stale.append(oldest)
    for tid in stale:
        _turns.pop(tid, None)
    if stale:
        gone = set(stale)
        for sentence in [s for s, tid in _turn_of.items() if tid in gone]:
            del _turn_of[sentence]


def _register_turn(parts: list[tuple[str, Beat | None]]) -> str:
    """Remember these sentences as ONE answer. Returns the turn's id."""
    tid = uuid.uuid4().hex
    now = time.monotonic()
    logger.debug("voice: turn remembered (%d sentences)", len(parts))
    with _turn_lock:
        _sweep_turns(now)
        # ONE ANSWER CAN BE REMEMBERED TWICE. ``wobo.py`` tells the voice what the model decided,
        # and ``board.stream.build_events`` tells it again once the naming and number laws have
        # rewritten the list — same answer, two records. If the second one pinned its own voice,
        # a learner could hear the sentence the first record owns in one voice and the rest in
        # another, and each record would be innocent. So a new record inherits the voice of any
        # record already holding one of its sentences: the answer, not the bookkeeping, is what
        # keeps a voice.
        # THE MOUTH TRAVELS WITH THE VOICE, for the same reason: the two records are one answer,
        # and a mouth the stream has already won is not unwon by the second piece of bookkeeping.
        inherited: str | None = None
        mouth: Mouth | None = None
        for part, _beat in parts:
            prior = _turns.get(_turn_of.get(part, ""))
            if prior is None:
                continue
            if inherited is None and prior.voice is not None:
                inherited = prior.voice
            if mouth is None and prior.mouth is not None:
                mouth = prior.mouth
            if inherited is not None and mouth is not None:
                break
        _turns[tid] = _Turn(at=now, parts=tuple(parts), voice=inherited, mouth=mouth)
        for part, _beat in parts:
            _turn_of[part] = tid
    return tid


def _turn_for(text: str) -> tuple[str, _Turn] | None:
    key = (text or "").strip()
    if not key:
        return None
    with _turn_lock:
        tid = _turn_of.get(key)
        turn = _turns.get(tid) if tid else None
        if tid is None or turn is None:
            return None
        if time.monotonic() - turn.at > _AHEAD_TTL_S:
            _turns.pop(tid, None)
            del _turn_of[key]
            return None
        return tid, turn


def turn_voice_for(text: str) -> str | None:
    """The one voice the answer this sentence belongs to is read in, deciding it on first ask.

    ``None`` for a sentence that belongs to no remembered turn — a card's narration, a line off
    the street — which keeps exactly the behaviour it has today: Gemini, then OpenAI behind it.
    """
    found = _turn_for(text)
    if found is None:
        return None
    tid, turn = found
    with _turn_lock:
        if turn.voice is None:
            from wobo_gateway.plexus.media import pick_voice

            turn.voice = pick_voice()
            logger.info(
                "voice: turn %s pinned to %s (%d sentences)",
                tid[:8],
                turn.voice,
                len(turn.parts),
            )
        elif not turn.heard and not _voice_available(turn.voice):
            # A PIN DOES NOT OUTLIVE ITS PROVIDER, while nobody has heard the turn. The voice is
            # decided when the words are, and a provider can be marked out in the seconds between
            # that and the first ask — which is exactly what happened live in wave 60: Google's
            # text-to-speech timed out, ``health`` marked it out, and every sentence of every turn
            # already pinned to it was asked of it anyway, each one a dead-end wait of seconds
            # before the re-decision that was always going to happen, and the seven 502s that sent
            # those turns to a second mouth and a second bill. ``_buy_in_one_voice`` asks a pinned
            # voice whatever health says, deliberately — a turn being heard must not change mouth
            # — so the check belongs HERE, where the turn is still unheard and the re-decision is
            # the one nobody can hear.
            from wobo_gateway.plexus.media import pick_voice

            second = pick_voice()
            if second is not None and second != turn.voice:
                logger.info(
                    "voice: turn %s re-decided to %s before it was heard (%s is out)",
                    tid[:8],
                    second,
                    turn.voice,
                )
                turn.voice = second
        return turn.voice


def _voice_available(voice_id: str) -> bool:
    """Is this voice's provider not marked out? Never raises: an unknown health answer is yes."""
    try:
        from wobo_gateway import health

        return bool(health.provider_available(voice_id))
    except Exception as exc:  # noqa: BLE001 — health is a hint; a turn keeps its voice without it
        logger.debug("voice: health unknown (%s: %s)", type(exc).__name__, exc)
        return True


def turn_heard(text: str) -> bool:
    """Has a syllable of the answer this sentence belongs to reached the learner yet?"""
    found = _turn_for(text)
    return bool(found and found[1].heard)


def note_heard(text: str) -> None:
    """A syllable of this turn has been served. From here the voice is frozen: whatever else
    happens in this answer, the learner will not be handed a different mouth for one sentence."""
    found = _turn_for(text)
    if found is not None:
        with _turn_lock:
            found[1].heard = True


def claim_mouth(text: str, mouth: Mouth) -> bool:
    """This path served the first audio of the turn this sentence belongs to. First one wins.

    The client asks for a turn's DECIDING sentence two ways at once (``speech.tsx`` ``firstSound``:
    the buffered ladder and the voice socket together) and plays whichever audio lands first; every
    sentence after it goes to the mouth that won and to no other (``soundAgain``). So the gateway
    claims on exactly the evidence the client claims on — audio delivered — and the answer is the
    same on both sides of the wire. ``True`` when this path owns the turn's mouth from here.
    """
    found = _turn_for(text)
    if found is None:
        return False
    tid, turn = found
    with _turn_lock:
        if turn.mouth is None:
            turn.mouth = mouth
            logger.debug("voice: turn %s reaches the ear by the %s", tid[:8], mouth)
        return turn.mouth == mouth


def turn_mouth(text: str) -> Mouth | None:
    """Which mouth the answer this sentence belongs to is reaching the ear by, once one has won."""
    found = _turn_for(text)
    return found[1].mouth if found is not None else None


def repin_unheard_turn(text: str, *, failed: str | None) -> str | None:
    """The voice would not speak and NOTHING of this turn has been heard yet, so it may be
    re-decided whole. Returns the new voice, or ``None`` when there is no other one to try.

    This is the only place a turn's voice changes after it is set, and it is deliberately the one
    moment a learner cannot tell: no audio of this answer has reached them.
    """
    from wobo_gateway.plexus.media import other_voice

    found = _turn_for(text)
    if found is None:
        return None
    tid, turn = found
    with _turn_lock:
        if turn.heard or turn.voice != failed:
            return None
        nxt = other_voice(failed)
        if nxt is None:
            return None
        turn.voice = nxt
        logger.info("voice: turn %s re-decided to %s before it was heard", tid[:8], nxt)
        return nxt


def peek_turn_voice(text: str) -> str | None:
    """The voice this sentence's turn is pinned to, WITHOUT deciding one for a turn that has none.

    :func:`turn_voice_for` pins on first ask, which is right for a path about to buy audio and
    wrong for one only asking what has already been bought: a read must not decide a turn's voice
    for it. A turn with no pin has bought nothing, so there is nothing for the caller to find.
    """
    found = _turn_for(text)
    return found[1].voice if found is not None else None


def line_already_bought(text: str, *, accent: str, beat: Beat) -> bool:
    """Is this exact line, read the way this learner is about to hear it, already on the disk?

    The same key ``plexus.media`` keeps it under — the words, the accent and beat instruction, and
    the turn's own voice — so a clip bought for a different mouth or a different ear is a miss,
    exactly as it is for the route that would serve it.

    Never raises and never buys: the answer to a question this cheap must never cost a child their
    audio, so anything unexpected is a miss and the caller does what it does today.
    """
    line = (text or "").strip()
    if not line:
        return False
    try:
        from wobo_gateway.plexus.media import _cache_key, _cached

        key = _cache_key(line, spoken_instruction(accent, beat), peek_turn_voice(line))
        return _cached(key) is not None
    except Exception as exc:  # noqa: BLE001 — an unreadable disk is a miss, never a silence
        logger.debug("voice: held line unknown (%s: %s)", type(exc).__name__, exc)
        return False


def turn_parts(text: str) -> tuple[tuple[str, Beat | None], ...]:
    """Every sentence of the answer this one belongs to, in the order the client asks for them."""
    found = _turn_for(text)
    return found[1].parts if found is not None else ()


def _buy_ahead(text: str, instruction: str, voice: str | None = None) -> None:
    """One sentence, bought and kept, in the voice its answer is read in. Runs off the request
    thread; never raises, never speaks."""
    try:
        from wobo_gateway.plexus.media import synthesize_narration

        synthesize_narration(text, instruction=instruction, voice=voice)
    except Exception as exc:  # noqa: BLE001 — a line not bought ahead is a line bought on the ask
        logger.debug("voice: line ahead not bought (%s: %s)", type(exc).__name__, exc)
    finally:
        _ahead_slots.release()


def buy_line_ahead(text: str, *, accent: str, beat: Beat = DEFAULT_BEAT) -> int:
    """Buy the sentences behind this one, off this thread. Returns how many were started.

    The accent is the one resolved for this learner and the beat is this line's own, so the key
    each sentence is kept under is exactly the key the client's next call will present — except
    the closing question, which the client reads as a question and which is bought as one.
    """
    # NOT ON A DAY THE PLATFORM IS ALREADY TRIMMING. Buying ahead is a kindness to the ear, not the
    # answer itself: the learner still hears every sentence without it, a few seconds later. So it
    # is asked of the day's ceiling in the strictest lane there is — while even a stranger would be
    # served, the day can afford it; past that line the money goes to answers, not to anticipation.
    from wobo_gateway import spend

    if spend.verdict(spend.Priority.STRANGER) is not spend.Verdict.SERVE:
        return 0
    # In the answer's own voice: a clip bought in the other one is a clip under a key nobody
    # presents — paid for, never heard, and the learner still waits the whole round trip.
    return _buy_parts(line_ahead(text), accent=accent, beat=beat, voice=turn_voice_for(text))


# --- THE WHOLE PLAN, BOUGHT WHEN THE SENTENCES ARE KNOWN ----------------------------------------
#
# The buy-ahead above works and its SCOPE was wrong. It buys the sentences behind the one being
# asked for, at the moment it is asked for — so when the first sentence came off the disk in
# milliseconds (it did: 8 to 21 ms on five of six live boards on 2026-09-10), the client asked for
# the second one twenty milliseconds later, while that buy had only just started, and paid the
# whole round trip for it: 4.6 to 7.8 seconds, measured off the wire, muted.
#
# The sentences are known SECONDS EARLIER — at ``remember_parts``, where the turn's words are
# decided and before one frame of them is on the wire. That is when the whole plan is bought, all
# of it at once, in the turn's own voice. By the time the client asks, the audio is on the disk.
#
# The accent is the one thing this moment does not know on its own: it is the learner's, resolved
# at the door from the verified record, and buying on the wrong accent would be a second key
# nobody presents — paid for and never heard. So it rides a contextvar set at the door
# (:func:`mark_accent`), and a turn decided without one is simply not bought ahead: the read-aloud
# route still buys the rest of its plan on the first ask, which is where it happens today.

_accent_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "wobo_voice_accent", default=None
)


def mark_accent(accent: str | None) -> None:
    """Name the accent this request's spoken lines are to be read in, for the rest of it."""
    _accent_ctx.set((accent or "").strip() or None)


def current_accent() -> str | None:
    """The accent marked at the door for this request, or ``None`` outside one."""
    return _accent_ctx.get()


def _speak_turn_ahead(parts: list[tuple[str, Beat | None]], *, accent: str | None = None) -> bool:
    """Buy every sentence of this turn now, in one voice. True when the buy was started.

    THE FIRST SENTENCE DECIDES. It is bought on its own first, because a voice that will not speak
    is a thing to find out BEFORE the rest of the plan is paid for in it and before the learner has
    heard a syllable — while the turn can still be re-decided whole, silently. Then the rest go
    together, in whichever voice the first one proved.
    """
    # Told by the caller where the caller knows it (the board's own streaming frame, which is a
    # different context from the door it came through), otherwise read from the door's mark.
    accent = accent or current_accent()
    if accent is None:
        logger.debug("voice: plan not bought ahead — no accent at this seam")
        return False
    # No key, no voice, nothing to buy: a keyless box (and every test that is not about the voice)
    # must not spawn a thread to discover that again.
    if turn_voice_for(parts[0][0]) is None:
        logger.debug("voice: plan not bought ahead — no voice has a key")
        return False
    from wobo_gateway import spend

    if spend.verdict(spend.Priority.STRANGER) is not spend.Verdict.SERVE:
        logger.debug("voice: plan not bought ahead — the day is trimming")
        return False
    logger.debug("voice: buying the whole plan ahead (%d sentences)", len(parts))
    threading.Thread(
        target=_buy_the_plan, args=(list(parts), accent), name="voice-plan", daemon=True
    ).start()
    return True


def _buy_the_plan(parts: list[tuple[str, Beat | None]], accent: str) -> None:
    """Off the request thread: the opening sentence, then the rest. Never raises, never speaks."""
    try:
        from wobo_gateway.plexus.media import synthesize_narration

        opening, opening_beat = parts[0]
        pinned = turn_voice_for(opening)
        if pinned is None:
            return
        audio = synthesize_narration(
            opening,
            instruction=spoken_instruction(accent, opening_beat or DEFAULT_BEAT),
            voice=pinned,
            deadline_s=_unheard_deadline(),
        )
        if audio is None:
            # The voice would not speak and nothing of this turn has been heard: re-decide it
            # whole, here, seconds before the client asks — the one voice change nobody can hear.
            second = repin_unheard_turn(opening, failed=pinned)
            if second is None:
                return
            pinned = second
            synthesize_narration(
                opening,
                instruction=spoken_instruction(accent, opening_beat or DEFAULT_BEAT),
                voice=pinned,
                deadline_s=_unheard_deadline(),
            )
        _buy_parts(parts[1:], accent=accent, beat=DEFAULT_BEAT, voice=pinned)
    except Exception as exc:  # noqa: BLE001 — a plan not bought ahead is a plan bought on the ask
        logger.debug("voice: plan not bought ahead (%s: %s)", type(exc).__name__, exc)


def _unheard_deadline() -> float:
    from wobo_gateway.plexus.media import _UNHEARD_TIMEOUT_S

    return _UNHEARD_TIMEOUT_S


def _buy_parts(
    parts: Sequence[tuple[str, Beat | None]], *, accent: str, beat: Beat, voice: str | None
) -> int:
    """Start one buy per sentence, off this thread, bounded by the service's own slot count.

    NOT ON A DAY THE PLATFORM IS ALREADY TRIMMING — the same strict lane :func:`buy_line_ahead`
    asks in, for the same reason: anticipation is a kindness to the ear, never the answer itself.

    AND NOT FOR A TURN THE STREAM HAS THE MOUTH OF. The client asks for a turn's deciding sentence
    on the ladder and on the voice socket at once and keeps whichever spoke first; from then on
    every remaining sentence of that turn goes to that mouth and to no other (``speech.tsx``
    ``soundAgain``: on a stream turn a sentence the socket cannot speak is silence, and the
    buffered route is never asked for it). So once the stream has claimed the turn, each clip
    bought here is one nobody will ever ask for — not a race lost, a bill paid for audio that
    cannot be played. Wave 60 paid it fourteen times: ``voice.tts`` $0.2306 across three models
    against $0.0874 in wave 57. Nothing is refused by this, only anticipated: a sentence the
    client does ask for is still bought and served on the ask, exactly as it is today.
    """
    from wobo_gateway import spend

    if spend.verdict(spend.Priority.STRANGER) is not spend.Verdict.SERVE:
        return 0
    started = 0
    for part, other in parts:
        if turn_mouth(part) == "stream":
            logger.debug("voice: plan not bought ahead — the stream has this turn's mouth")
            break
        if not part.strip():
            continue
        if not _ahead_slots.acquire(blocking=False):
            break
        instruction = spoken_instruction(accent, other or beat)
        threading.Thread(
            target=_buy_ahead, args=(part, instruction, voice), name="voice-ahead", daemon=True
        ).start()
        started += 1
    return started


def buy_turn_ahead(text: str, *, accent: str, beat: Beat = DEFAULT_BEAT) -> int:
    """Buy the REST of the answer this sentence belongs to, in the answer's own voice.

    The safety net under :func:`_speak_turn_ahead` for every path that reaches the read-aloud
    route without an accent having been marked at the door, and the re-buy after a turn that had
    not been heard yet changed its voice.
    """
    parts = turn_parts(text)
    if not parts:
        return 0
    key = (text or "").strip()
    rest = [p for p in parts if p[0] != key]
    return _buy_parts(rest, accent=accent, beat=beat, voice=turn_voice_for(key))


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
    TTS API. Both routes go through the same meter as every other capability
    (``budget.CAPABILITY_CLASS`` keeps the classification in one dict), keyed on the same meter
    key the door derived.

    **ON THE VOICE COUNTER, NEVER THE QUESTION COUNTER.** ``voice.`` classifies as
    ``budget.VOICE``. The client synthesises ONE CALL PER SENTENCE (``speech.tsx``
    ``startUtterance``), so while these were turns, hearing a five-sentence answer cost five
    questions on top of the one that earned it — six of an anonymous learner's six — and the
    read-aloud path charged for a crisis disclosure that ``app.py`` had just refunded on purpose.
    Speaking is not asking; it is capped, in lines, on a purse of its own.

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
    from wobo_gateway import budget

    plan = _ceiling_check(request, capability)
    principal = request.state.principal
    budget.charge(request.state.meter_key, capability, plan, anonymous=principal.anonymous)


def _ceiling_check(request: Request, capability: str) -> str:
    """Ask the platform's daily ceiling, and answer the learner's metered plan.

    Split out of :func:`_charge_voice` so a route can ask the ceiling BEFORE it decides whether it
    can serve at all. ``/v1/voice/session`` learned on 2026-09-07 not to charge when no relay key
    exists, and in doing so it answered "unavailable" ahead of the ceiling: a learner on a spent
    day was told the voice was missing when the money was. The ceiling is the first word either
    way, because a spent day is the truer sentence, and the sockets this token opens spend real
    money the moment a key does exist.
    """
    from wobo_gateway import billing, consent, spend

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
    return plan


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
        #
        # The KEY IS CHECKED FIRST, exactly as the sibling TTS route checks it. Until 2026-09-07
        # the charge came first and the answer was a 200 saying "unavailable", so a learner on a
        # box with no Gemini key paid a call for every refusal — and the client mints a token per
        # line, so it paid five of them for one silent answer. A learner never pays for a call we
        # did not serve.
        # The ceiling first, whatever the key situation: a spent day answers 429 and never
        # "unavailable".
        _ceiling_check(request, "voice.session")
        if not relay_configured():
            # No session, no charge, and no accent to promise: the client's own fallback picks
            # whatever voice the device has.
            return voice_session(request.state.principal.subject)
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
        instruction = spoken_instruction(accent, body.beat)
        # ONE VOICE FOR THE WHOLE ANSWER. The turn this sentence belongs to was remembered when
        # its words were decided; its voice is decided once, here, on the first sentence anybody
        # asks for, and every sentence after it is read in that same voice whatever the providers
        # do in between. A sentence that belongs to no remembered turn pins nothing and keeps the
        # behaviour it has today.
        pinned = turn_voice_for(body.text)
        # A turn nobody has heard a syllable of may still be re-decided, so its voice is given the
        # shorter deadline: what a hang costs there is the learner's first sentence, not a gap.
        deadline = _unheard_deadline() if pinned and not turn_heard(body.text) else None
        # THE REST OF THE ANSWER. Every remaining sentence of the plan is bought while this one is
        # being synthesised, on this learner's own accent and in this answer's own voice, so the
        # client's next call — which it makes as soon as it holds this sentence's audio — is a disk
        # read of milliseconds rather than another four-to-ten-second round trip. Started BEFORE
        # the blocking call below, because the point is that they run together.
        if buy_turn_ahead(body.text, accent=accent, beat=body.beat) == 0:
            buy_line_ahead(body.text, accent=accent, beat=body.beat)
        audio = synthesize_narration(
            body.text, instruction=instruction, voice=pinned, deadline_s=deadline
        )
        if audio is None and pinned is not None:
            # THE ONE RE-DECISION NOBODY HEARS. Nothing of this answer has reached the learner
            # yet, so the turn may change voice whole — before the answer rather than inside it —
            # and the rest of the plan is re-bought in the new one. Once a syllable has been
            # served this returns None and the sentence is silence on the client's reading clock.
            second = repin_unheard_turn(body.text, failed=pinned)
            if second is None:
                # Somebody else re-decided it first — the buy that runs the moment the words are
                # decided does exactly this, and it usually gets there before the client asks. The
                # new voice is the turn's; take it rather than failing the sentence and making the
                # client ask a third time for audio that is already on the disk.
                current = turn_voice_for(body.text)
                if current is not None and current != pinned and not turn_heard(body.text):
                    second = current
            if second is not None:
                buy_turn_ahead(body.text, accent=accent, beat=body.beat)
                audio = synthesize_narration(
                    body.text, instruction=instruction, voice=second, deadline_s=deadline
                )
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
        # A syllable of this answer is now on its way, so the voice it is read in is frozen: from
        # here nothing can hand the learner a different mouth for one sentence of it. The ladder
        # delivered it, so the ladder claims the turn's mouth — the same claim the client makes on
        # the same evidence, and the answer to "is the stream reading this turn?" for every buy
        # this turn has left.
        note_heard(body.text)
        claim_mouth(body.text, "buffered")
        heard = _turn_for(body.text)
        if heard is not None:
            logger.info(
                "voice: turn %s spoke a sentence in %s", heard[0][:8], heard[1].voice
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
                # ONE LINE, ONE BILL. This socket and the buffered route are asked for a turn's
                # deciding sentence AT THE SAME MOMENT (``speech.tsx`` ``firstSound``), and the
                # client plays whichever audio lands first. When the gateway already holds the
                # clip there is no race to run: the buffered ask answers it off the disk in
                # milliseconds (2 to 21 ms, measured live) while this socket still has a mint and
                # a connect in front of its first chunk (1.1 to 1.4 s, measured live, on every
                # turn of wave 60). Opening Gemini Live for it would buy a second reading of a
                # bought line, in a second voice, to be dropped unheard — and dropping it unheard
                # is what handed the learner two mouths and the bill two providers. So the socket
                # looks first and stays shut; the client's own fallback for a chunkless close IS
                # the buffered clip, which is already in hand.
                if line_already_bought(text, accent=grant.accent, beat=beat):
                    logger.debug("voice: socket declined — the line is already bought")
                else:
                    await _stream_one_line(
                        client, aiohttp, key, text, accent=grant.accent, beat=beat
                    )
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
    claimed = False
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
                # THE MOUTH IS CLAIMED ON DELIVERY, the same evidence the client claims on: the
                # first audio to reach it takes the turn, and every sentence after it goes to that
                # mouth alone. Said here, the gateway stops buying the rest of this turn's plan on
                # the ladder — clips the client will never ask for once the socket has won.
                if meter.audio_out_s > 0 and not claimed:
                    claimed = claim_mouth(text, "stream")
                if '"turnComplete"' in frame or '"turn_complete"' in frame:
                    break
    except (aiohttp.ClientError, WebSocketDisconnect, RuntimeError, OSError):
        pass  # upstream/socket failure — client falls back to buffered TTS on a chunkless close
    finally:
        meter.close()
