"""The voice sockets: the token gate, the concurrency caps, and the relay frame filter.

HTTP middleware does not run for a WebSocket, so neither ``/v1/voice/relay`` nor
``/v1/voice/tts/stream`` can read a bearer token. The whole door is therefore the short-lived,
single-use token ``/v1/voice/session`` mints for a verified subject — and the caps that bound
worst-case spend on a paid key. That door was covered only indirectly before this file; here it
is exercised end to end, including the two ways in that must close with a 1008.

Nothing here reaches Gemini: every test either stops at the gate (before ``accept()``) or calls
a pure function, so no key and no network is involved.
"""

from __future__ import annotations

import json
import time
from typing import Any

import pytest
from conftest import mint
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from wobo_gateway import voice
from wobo_gateway.app import create_app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """An app whose voice surface is available: a key present means session mints a token."""
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-a-real-one")
    return TestClient(create_app())


# --- the token itself: mint, consume, expire ---------------------------------------------


def test_a_token_is_single_use_and_carries_its_subject() -> None:
    token = voice._mint_token("learner-a")
    assert voice._consume_token(token) == "learner-a"
    # spent: the second use is worthless, which is what stops a captured URL being replayed
    assert voice._consume_token(token) is None


def test_an_unknown_or_missing_token_is_refused() -> None:
    assert voice._consume_token(None) is None
    assert voice._consume_token("") is None
    assert voice._consume_token("not-a-token-anyone-minted") is None


def test_an_expired_token_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    token = voice._mint_token("learner-b")
    # step the clock past the TTL rather than sleeping through it
    later = time.monotonic() + voice._TOKEN_TTL_S + 1
    monkeypatch.setattr(voice.time, "monotonic", lambda: later)
    assert voice._consume_token(token) is None


def test_one_learners_mints_never_evict_anothers() -> None:
    """Nobody's eviction policy may be everybody's: the per-subject cap trims only the minter."""
    theirs = voice._mint_token("learner-c")
    for _ in range(voice._MAX_TOKENS_PER_SUBJECT + 4):
        voice._mint_token("noisy-learner")
    assert voice._consume_token(theirs) == "learner-c"


# --- the socket gate ----------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/v1/voice/relay", "/v1/voice/tts/stream"])
def test_a_socket_with_no_token_is_closed(client: TestClient, path: str) -> None:
    """Without this the sockets were an open, unmetered mouth on a paid API."""
    with pytest.raises(WebSocketDisconnect) as caught, client.websocket_connect(path) as ws:
        ws.receive_text()
    assert caught.value.code == 1008


@pytest.mark.parametrize("path", ["/v1/voice/relay", "/v1/voice/tts/stream"])
def test_a_socket_with_a_spent_token_is_closed(client: TestClient, path: str) -> None:
    token = voice._mint_token("learner-d")
    assert voice._consume_token(token) == "learner-d"
    with (
        pytest.raises(WebSocketDisconnect) as caught,
        client.websocket_connect(f"{path}?token={token}") as ws,
    ):
        ws.receive_text()
    assert caught.value.code == 1008


@pytest.mark.parametrize(
    ("path", "kind"), [("/v1/voice/relay", "relay"), ("/v1/voice/tts/stream", "tts")]
)
def test_a_socket_is_closed_once_the_cap_is_saturated(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, path: str, kind: str
) -> None:
    """A saturated cap must refuse at the door, not open a socket it cannot pay for."""
    monkeypatch.setattr(
        voice, "_MAX_CONCURRENT_RELAYS" if kind == "relay" else "_MAX_CONCURRENT_TTS", 1
    )

    # hold the only slot, then try to open a second socket with a perfectly valid token
    with voice._socket_slot("holder", kind=kind) as claimed:
        assert claimed
        # the close below must be the CAP refusing, not the token gate: prove the global cap is
        # genuinely saturated for a subject that holds nothing.
        probe = voice._socket_slot("someone-new", kind=kind)
        assert probe.__enter__() is False
        probe.__exit__(None, None, None)

        token = voice._mint_token("learner-e")
        with (
            pytest.raises(WebSocketDisconnect) as caught,
            client.websocket_connect(f"{path}?token={token}") as ws,
        ):
            ws.receive_text()
        assert caught.value.code == 1008


def test_the_slot_is_released_when_the_socket_ends() -> None:
    """A cap that only ever counts up is a cap that closes the product after N calls."""
    with voice._socket_slot("learner-f", kind="relay") as claimed:
        assert claimed
    with voice._socket_slot("learner-f", kind="relay") as again:
        assert again


def test_one_learner_cannot_hold_every_relay_slot() -> None:
    held: list[Any] = []
    try:
        for _ in range(voice._MAX_RELAYS_PER_SUBJECT):
            slot = voice._socket_slot("greedy", kind="relay")
            assert slot.__enter__() is True
            held.append(slot)
        refused = voice._socket_slot("greedy", kind="relay")
        assert refused.__enter__() is False
        refused.__exit__(None, None, None)
        # everybody else still gets in
        with voice._socket_slot("someone-else", kind="relay") as claimed:
            assert claimed
    finally:
        for slot in held:
            slot.__exit__(None, None, None)


# --- the relay frame filter ---------------------------------------------------------------


def test_only_microphone_frames_reach_gemini() -> None:
    assert voice.relay_frame_allowed('{"realtimeInput":{"audio":{"data":"AAAA"}}}')
    assert voice.relay_frame_allowed('{"clientContent":{"turns":[]}}')
    assert voice.relay_frame_allowed('{"toolResponse":{"functionResponses":[]}}')


def test_a_client_setup_frame_is_never_forwarded() -> None:
    """The gateway sends the setup itself — model, Wobo's persona, transcription config. A
    client ``setup`` frame re-opens the session with any model and any system instruction the
    caller likes, on OUR key: a persona escape for a child over audio, and a general-purpose
    model nobody is metering."""
    assert not voice.relay_frame_allowed('{"setup":{"model":"models/anything"}}')
    # smuggled alongside a legitimate frame is still smuggled
    assert not voice.relay_frame_allowed('{"realtimeInput":{},"setup":{"model":"models/x"}}')


def test_junk_and_oversized_frames_are_dropped() -> None:
    assert not voice.relay_frame_allowed("")
    assert not voice.relay_frame_allowed("not json at all")
    assert not voice.relay_frame_allowed("[1,2,3]")  # a list is not a frame
    assert not voice.relay_frame_allowed("{}")  # an empty object says nothing
    assert not voice.relay_frame_allowed('{"unknownKind":{}}')
    huge = '{"realtimeInput":"' + "a" * (voice._MAX_RELAY_FRAME_BYTES + 64) + '"}'
    assert not voice.relay_frame_allowed(huge)


# --- accent by country (WOBO-PLAN §3) ------------------------------------------------------
#
# A learner hears the English spoken around them, and American English when we know nothing.
# Before this, no accent, locale or voice selection existed anywhere in the brain or the client:
# every learner on every continent got one accent, and there was no fallback to fall back to.


def test_the_accent_follows_the_country_and_falls_back_to_american_english() -> None:
    assert voice.accent_for("IN") == "en-IN"
    assert voice.accent_for("GB") == "en-GB"
    assert voice.accent_for("AU") == "en-AU"
    assert voice.accent_for("us") == "en-US"
    # a country we ship no voice for is never handed a tag nobody speaks
    assert voice.accent_for("ZA") == voice.AMERICAN_ENGLISH
    assert voice.accent_for(None) == voice.AMERICAN_ENGLISH
    assert voice.accent_for("") == voice.AMERICAN_ENGLISH


def test_a_locale_answers_when_the_record_names_no_country() -> None:
    assert voice.accent_for(None, "en-IN") == "en-IN"
    assert voice.accent_for(None, "en_GB") == "en-GB"
    # a browser's full header, weights and all
    assert voice.accent_for(None, "en-AU,en;q=0.9") == "en-AU"
    # the region half is read as a country, so an unspoken tag still lands somewhere honest
    assert voice.accent_for(None, "hi-IN") == "en-IN"
    assert voice.accent_for(None, "fr-FR") == voice.AMERICAN_ENGLISH


def test_the_learners_own_record_beats_the_device_hint() -> None:
    """The profile is proof; the header is a guess. A learner whose account says India hears
    Indian English on a borrowed laptop set to British English."""
    claims = {"user_metadata": {"country": "IN"}}
    assert voice.learner_accent(claims, "en-GB") == "en-IN"
    # nothing on the record: the device's own language is better than nothing
    assert voice.learner_accent({}, "en-GB") == "en-GB"
    assert voice.learner_accent(None, None) == voice.AMERICAN_ENGLISH


def test_the_session_answers_with_the_accent_and_the_token_carries_it(
    client: TestClient,
) -> None:
    """A socket has no door of its own, so the accent rides the grant. It used to ride nothing:
    ``voice.py`` had no accent at all."""
    headers = {"Authorization": f"Bearer {mint('accent-learner', user_metadata={'country': 'IN'})}"}
    body = client.get("/v1/voice/session", headers=headers).json()
    assert body["accent"] == "en-IN"
    grant = voice._consume_grant(body["token"])
    assert grant is not None
    assert grant.subject == "accent-learner"
    assert grant.accent == "en-IN"


def test_a_header_only_learner_still_gets_their_own_english(client: TestClient) -> None:
    headers = {
        "Authorization": f"Bearer {mint('header-learner')}",
        "Accept-Language": "en-GB,en;q=0.8",
    }
    assert client.get("/v1/voice/session", headers=headers).json()["accent"] == "en-GB"


def test_both_sockets_ask_for_the_same_accent_in_words() -> None:
    """The accent travels as an instruction, never as a setup field: an unknown field is
    rejected upstream and the socket closes, which is how the microphone died once before."""
    live = voice._setup_message("en-IN")["setup"]
    read_aloud = voice._tts_setup_message("en-IN")["setup"]
    for setup in (live, read_aloud):
        text = setup["systemInstruction"]["parts"][0]["text"]
        assert "Indian English" in text
        assert "speechConfig" not in json.dumps(setup)
    # the persona and the read-verbatim instruction both survive the accent line
    assert "Wobo" in live["systemInstruction"]["parts"][0]["text"]
    assert "verbatim" in read_aloud["systemInstruction"]["parts"][0]["text"]
    # and the default is the fallback, spelled out
    default = voice._setup_message()["setup"]["systemInstruction"]["parts"][0]["text"]
    assert "American English" in default


def test_the_one_shot_spoken_line_is_in_the_learners_own_english(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``POST /v1/voice/tts`` is the third way a learner hears Wobo, and it used to be the one
    that spoke American English to everybody: it took the typed text and nothing about the
    learner, so a learner in India heard Indian English through the microphone and an American
    reading the very same sentence back."""
    asked: dict[str, Any] = {}

    def fake(text: str, *, instruction: str | None = None, **_: object) -> dict[str, str]:
        asked["text"], asked["instruction"] = text, instruction
        return {"mime": "audio/wav", "b64": "AAAA"}

    monkeypatch.setattr("wobo_gateway.plexus.media.synthesize_narration", fake)
    headers = {"Authorization": f"Bearer {mint('tts-learner', user_metadata={'country': 'IN'})}"}
    res = client.post("/v1/voice/tts", json={"text": "Two x equals ten."}, headers=headers)

    assert res.status_code == 200
    assert res.json()["accent"] == "en-IN", "the learner is told which English they just heard"
    assert asked["text"] == "Two x equals ten.", "the line itself is never rewritten"
    assert asked["instruction"] == voice.spoken_instruction("en-IN", "step")
    assert "Indian English" in asked["instruction"]


def test_a_learner_we_know_nothing_about_still_hears_american_english(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked: dict[str, Any] = {}

    def fake(text: str, *, instruction: str | None = None, **_: object) -> dict[str, str]:
        asked["instruction"] = instruction
        return {"mime": "audio/wav", "b64": "AAAA"}

    monkeypatch.setattr("wobo_gateway.plexus.media.synthesize_narration", fake)
    headers = {"Authorization": f"Bearer {mint('plain-learner')}"}
    res = client.post("/v1/voice/tts", json={"text": "Here."}, headers=headers)
    assert res.json()["accent"] == voice.AMERICAN_ENGLISH
    assert "American English" in asked["instruction"]


def test_the_accent_reaches_the_upstream_in_the_prompt_never_as_a_system_instruction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The one-shot line is a plain generateContent call, so the accent has to survive the
    journey into the request body — in the PROMPT, ahead of the line. It used to travel as a
    ``systemInstruction``, and the text-to-speech model answers that field with 500 INTERNAL on
    every call (verified against the production key, 2026-09-05): every one-shot line failed
    upstream and the client fell back to the device voice. Never that field, never a
    ``speechConfig`` key beyond the voice, and the line itself is the last thing in the prompt,
    exactly as given."""
    import base64
    import urllib.request

    from wobo_gateway.plexus.media import spoken_prompt, synthesize_narration

    sent: dict[str, Any] = {}

    class _Resp:
        def __init__(self) -> None:
            audio = base64.b64encode(b"\x00\x01" * 8).decode()
            self._body = json.dumps(
                {
                    "candidates": [
                        {
                            "content": {
                                "parts": [{"inlineData": {"mimeType": "audio/wav", "data": audio}}]
                            }
                        }
                    ]
                }
            ).encode()

        def read(self) -> bytes:
            return self._body

        def __enter__(self) -> _Resp:
            return self

        def __exit__(self, *exc: Any) -> None:
            return None

    def fake_urlopen(req: Any, timeout: float = 0) -> _Resp:
        sent["body"] = json.loads(req.data.decode())
        return _Resp()

    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-a-real-one")
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    out = synthesize_narration("Two x equals ten.", instruction=voice.accent_instruction("en-GB"))
    assert out is not None
    assert "systemInstruction" not in sent["body"], "the TTS model answers this field with 500"
    prompt = sent["body"]["contents"][0]["parts"][0]["text"]
    assert "British English" in prompt
    assert prompt.endswith("\n\nTwo x equals ten."), "the line is last, verbatim, after the marker"
    # The marker points at a position, never at a punctuation mark: the instruction ahead of it
    # carries colons of its own, and so may a line ("Look here: the sign"), so "after the colon"
    # named two places to start reading.
    marker = prompt.split("\n\n")[-2]
    assert ":" not in marker and "colon" not in marker, marker
    colon_line = spoken_prompt(
        "Look here: the sign is the part.", voice.accent_instruction("en-IN")
    )
    assert colon_line.endswith("\n\nLook here: the sign is the part.")
    assert prompt == spoken_prompt("Two x equals ten.", voice.accent_instruction("en-GB"))
    assert set(sent["body"]["generationConfig"]["speechConfig"]) == {"voiceConfig"}
    # a narration that asks for nothing is unchanged — the video sidecar's prompt is its text
    sent.clear()
    synthesize_narration("A quiet line.")
    assert "systemInstruction" not in sent["body"]
    assert sent["body"]["contents"][0]["parts"][0]["text"] == "A quiet line."
    # deterministic: the same line under the same beat is the same prompt, twice
    softer = voice.spoken_instruction("en-IN", "miss")
    assert spoken_prompt("Not quite.", softer) == spoken_prompt("Not quite.", softer)
    assert spoken_prompt("Not quite.", "   ") == "Not quite."


def test_a_200_with_no_audio_is_asked_once_more_and_an_http_error_is_not(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """On the listening pass of 2026-09-05 one read in eight came back 200 with no audio part,
    and the same prompt answered on the next call. So a silent 200 is asked once more; an HTTP
    error is a reason and is not."""
    import base64
    import urllib.error
    import urllib.request

    from wobo_gateway.plexus import media

    calls: list[dict[str, Any]] = []

    class _Resp:
        def __init__(self, body: dict[str, Any]) -> None:
            self._body = json.dumps(body).encode()

        def read(self) -> bytes:
            return self._body

        def __enter__(self) -> _Resp:
            return self

        def __exit__(self, *exc: Any) -> None:
            return None

    audio = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": "audio/wav",
                                "data": base64.b64encode(b"\x00\x01" * 8).decode(),
                            }
                        }
                    ]
                }
            }
        ]
    }
    silent = {"candidates": [{"content": {"parts": [{"text": "Look at the second term."}]}}]}
    answers: list[Any] = []

    def fake_urlopen(req: Any, timeout: float = 0) -> _Resp:
        calls.append(json.loads(req.data.decode()))
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return _Resp(answer)

    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-a-real-one")
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    # A DIFFERENT line each time on purpose: a line already spoken is served from the spoken-line
    # cache and never reaches the vendor, which is what this test is about.

    # silent once, audio on the second ask: the line is spoken, and the prompt was the same twice
    answers[:] = [silent, audio]
    assert media.synthesize_narration("Look at the second term.") is not None
    assert len(calls) == 2 and calls[0] == calls[1]

    # silent twice: given up, honestly, after exactly two asks
    calls.clear()
    answers[:] = [silent, silent, audio]
    assert media.synthesize_narration("Look at the third term.") is None
    assert len(calls) == 2

    # an HTTP error is not retried: one ask, then the client's fallback
    calls.clear()
    answers[:] = [urllib.error.HTTPError("u", 500, "INTERNAL", {}, None), audio]  # type: ignore[arg-type]
    assert media.synthesize_narration("Look at the fourth term.") is None
    assert len(calls) == 1


def test_a_refusal_dressed_as_a_silent_200_is_logged_as_a_refusal_and_not_asked_again(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A 200 with no audio part is also what a block looks like: ``promptFeedback.blockReason``,
    or a candidate stopped with ``finishReason: SAFETY`` and no parts. Asking again is a second
    paid call that refuses the same words, so a refusal is one call, logged as a refusal; the
    genuinely silent 200 is still asked once more."""
    import urllib.request

    from wobo_gateway.plexus import media

    calls: list[dict[str, Any]] = []

    class _Resp:
        def __init__(self, body: dict[str, Any]) -> None:
            self._body = json.dumps(body).encode()

        def read(self) -> bytes:
            return self._body

        def __enter__(self) -> _Resp:
            return self

        def __exit__(self, *exc: Any) -> None:
            return None

    answers: list[dict[str, Any]] = []

    def fake_urlopen(req: Any, timeout: float = 0) -> _Resp:
        calls.append(json.loads(req.data.decode()))
        return _Resp(answers.pop(0))

    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-a-real-one")
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    blocked = {"promptFeedback": {"blockReason": "SAFETY"}, "candidates": []}
    stopped = {"candidates": [{"finishReason": "SAFETY", "content": {"parts": []}}]}
    silent = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "x"}]}}]}

    for refusal, why in (
        (blocked, "prompt blocked: SAFETY"),
        (stopped, "candidate stopped: SAFETY"),
    ):
        calls.clear()
        caplog.clear()
        answers[:] = [refusal, silent]
        with caplog.at_level("WARNING", logger="wobo.gateway"):
            assert media.synthesize_narration("A line the model will not say.") is None
        assert len(calls) == 1, "a refusal is never asked twice"
        assert any("refused" in r.getMessage() and why in r.getMessage() for r in caplog.records)
        assert media.refusal_in(refusal) == why
    # a finished candidate with no audio is the silent 200, and is asked once more
    calls.clear()
    answers[:] = [silent, silent]
    assert media.synthesize_narration("A line.") is None
    assert len(calls) == 2
    assert media.refusal_in(silent) is None


# --- the beat (docs/copy/voice.md 10b): the emotion follows the beat, and it is small -----------


def test_the_five_beats_are_five_instructions_and_each_reads_the_same_twice() -> None:
    """One flat "warm, natural voice" for a win and a miss alike was the screen-reader failure
    10b names. Five beats, five short instructions, and the same beat asks for the same thing
    every time, so the same line read twice sounds the same twice."""
    assert voice.BEATS == ("win", "miss", "ask", "step", "crisis")
    assert voice.DEFAULT_BEAT == "step"
    said = {beat: voice.beat_instruction(beat) for beat in voice.BEATS}
    assert len(set(said.values())) == 5, "each beat leans its own way"
    for beat in voice.BEATS:
        assert voice.beat_instruction(beat) == said[beat], "deterministic per beat"
        assert voice.spoken_instruction("en-IN", beat) == voice.spoken_instruction("en-IN", beat)
        # the lean is by a degree: nothing is read as an exclamation, nothing is performed
        assert "!" not in said[beat]
        assert "never perform" in voice.spoken_instruction("en-IN", beat)
    # the words of 10b, beat by beat
    assert "brighter" in said["win"] and "quicker" in said["win"]
    assert "softer" in said["miss"] and "slower" in said["miss"]
    assert "curious" in said["ask"] and "lift" in said["ask"]
    assert "calm" in said["step"] and "even" in said["step"]
    assert "softest" in said["crisis"] and "no urgency" in said["crisis"]
    # a beat the tutor never sent is not guessed at: it is the default, never an error
    assert voice.beat_of("celebrating") == "step"
    assert voice.beat_of(None) == "step"
    assert voice.beat_of(" WIN ") == "win"


def test_the_beat_rides_beside_the_accent_in_both_spoken_paths() -> None:
    """The accent line and the beat line travel together as ONE instruction, never as a setup
    field, for the same reason the accent never did: an unsupported field closes the socket."""
    read_aloud = voice._tts_setup_message("en-IN", "crisis")["setup"]
    text = read_aloud["systemInstruction"]["parts"][0]["text"]
    assert "Indian English" in text and "softest" in text and "verbatim" in text
    assert "speechConfig" not in json.dumps(read_aloud)
    # the default setup is the default beat: calm and even, the step
    default = voice._tts_setup_message("en-GB")["setup"]["systemInstruction"]["parts"][0]["text"]
    assert "British English" in default and "calm" in default
    one_shot = voice.spoken_instruction("en-AU", "win")
    assert "Australian English" in one_shot and "brighter" in one_shot


def test_the_one_shot_line_carries_its_beat_and_says_which_it_read(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked: dict[str, Any] = {}

    def fake(text: str, *, instruction: str | None = None, **_: object) -> dict[str, str]:
        asked["text"], asked["instruction"] = text, instruction
        return {"mime": "audio/wav", "b64": "AAAA"}

    monkeypatch.setattr("wobo_gateway.plexus.media.synthesize_narration", fake)
    headers = {"Authorization": f"Bearer {mint('beat-learner', user_metadata={'country': 'IN'})}"}
    res = client.post("/v1/voice/tts", json={"text": "Not quite.", "beat": "miss"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["beat"] == "miss"
    assert asked["text"] == "Not quite.", "the line itself is never rewritten"
    assert asked["instruction"] == voice.spoken_instruction("en-IN", "miss")
    assert "softer" in asked["instruction"] and "Indian English" in asked["instruction"]
    # no beat given: the step, calm and even, and the caller is told so
    res = client.post("/v1/voice/tts", json={"text": "Here."}, headers=headers)
    assert res.json()["beat"] == "step"
    assert "calm" in asked["instruction"]
    # a beat that is not one of the five is refused rather than guessed at
    res = client.post("/v1/voice/tts", json={"text": "Here.", "beat": "thrilled"}, headers=headers)
    assert res.status_code == 422


def test_the_read_aloud_socket_takes_its_beat_from_the_url_beside_the_token(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The socket's first frame is the line itself, so the beat rides the URL beside the token.
    A gateway that predates the beat ignores the parameter and a client ahead of it never has
    Wobo read a JSON frame aloud. The beat chooses only a lean; it cannot pick a voice, a model
    or a cost, so a query parameter is a fine place for it."""
    heard: list[tuple[str, str]] = []

    async def fake_stream(client_socket, aiohttp, key, text, *, accent, beat):  # noqa: ANN001
        heard.append((text, beat))

    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-a-real-one")
    monkeypatch.setattr(voice, "_stream_one_line", fake_stream)
    headers = {"Authorization": f"Bearer {mint('beat-socket')}"}
    token = client.get("/v1/voice/session", headers=headers).json()["token"]
    with client.websocket_connect(f"/v1/voice/tts/stream?token={token}&beat=win") as ws:
        ws.send_text("You got it.")
    token = client.get("/v1/voice/session", headers=headers).json()["token"]
    with client.websocket_connect(f"/v1/voice/tts/stream?token={token}&beat=gasp") as ws:
        ws.send_text("Two x is four.")
    token = client.get("/v1/voice/session", headers=headers).json()["token"]
    with client.websocket_connect(f"/v1/voice/tts/stream?token={token}") as ws:
        ws.send_text("Two x is four.")
    assert heard == [
        ("You got it.", "win"),
        ("Two x is four.", "step"),
        ("Two x is four.", "step"),
    ]
