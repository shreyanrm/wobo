"""Every seam that talks to a model outside the router, and what happens when its primary dies.

Until this wave, five text seams called ``litellm.completion`` on their own (the concept proposer,
the plexus engines, the plexus judge, both own-syllabus readers and the discovery search), which
put them outside ``model_call`` and its one lesson: a model in a chain that refuses a knob answers
400, litellm raises the LAST error, and the learner gets nothing. And every media seam pinned one
vendor with nothing behind it: a Google outage was no spoken line, no diagram, and no read of a
photographed page.

Each test below kills the primary with a fake that runs the chain the way litellm does, and asserts
three things: the fallback answered, the output shape held, and the usage ledger named the model
that actually served. ``tests/chain_fakes.py`` holds the fakes.
"""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

import chain_fakes as fakes
import pytest

SRC = Path(__file__).resolve().parents[1] / "src" / "wobo_gateway"

TERRA = "openai/gpt-5.6-terra"
OPUS = "anthropic/claude-opus-5"
SOL = "openai/gpt-5.6-sol"
LUNA = "openai/gpt-5.6-luna"
HAIKU = "anthropic/claude-haiku-4-5"
GEMINI = "gemini/gemini-2.5-flash"


# --- a) one funnel ------------------------------------------------------------------------------


_DIRECT_CALL = re.compile(
    r"\blitellm\.a?completion\s*\(|from\s+litellm\s+import\s+[^\n]*\ba?completion\b"
)


#: Everything on the product's keys: the gateway, the atom (a uv workspace member) and the
#: fact-base build script. The scan used to cover the gateway alone, and the two content
#: callers rode litellm directly on retired ids with no chain, no health mark and no ledger row.
_ROOT = SRC.parents[3]
_SCANNED = (SRC, _ROOT / "content" / "atom" / "src", _ROOT / "content" / "factbase")


def test_no_seam_calls_litellm_directly_outside_model_call() -> None:
    """The funnel is the whole point: a direct call is a seam with none of the protection."""
    offenders: list[str] = []
    for root in _SCANNED:
        for path in root.rglob("*.py"):
            if path.name == "model_call.py":
                continue
            text = path.read_text()
            for i, line in enumerate(text.splitlines(), start=1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if _DIRECT_CALL.search(line):
                    offenders.append(f"{path.relative_to(_ROOT)}:{i}: {stripped}")
    assert not offenders, "direct litellm calls outside model_call.py:\n" + "\n".join(offenders)


# --- the Google key, by the name this product gives it -----------------------------------------


def test_the_gemini_rung_is_handed_the_google_key_under_the_products_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Every Google key in this product is ``GOOGLE_AI_API_KEY`` (``.env.example``, ``app.py``,
    ``health.py``, the media seams). litellm's Gemini provider reads ``GEMINI_API_KEY``
    (docs.litellm.ai/docs/providers/gemini, read 2026-09-07). Proved live the same day: with only
    the product's name set, every ``gemini/`` text rung failed in 0.0 s with no network call, so
    the last rung of every text chain, the safety screen's second rung and the vision primary were
    dead. The funnel hands the key in by the name the product uses, per call, and only to that
    rung; another provider's rung never sees it."""
    from wobo_gateway import model_call

    for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GOOGLE_AI_API_KEY", "not-a-real-google-key")
    lite = fakes.chain(monkeypatch, {TERRA: fakes.Down("terra: 503"), GEMINI: "ok"})
    out = model_call.complete(model=TERRA, fallbacks=[GEMINI], messages=[])
    assert out.choices[0].message.content == "ok"
    assert "api_key" not in lite.calls[0], "OpenAI's rung is not handed Google's key"
    assert lite.calls[1]["api_key"] == "not-a-real-google-key"

    # When litellm's own name is set, it is left to litellm.
    monkeypatch.setenv("GEMINI_API_KEY", "litellms-own-name")
    model_call.complete(model=GEMINI, messages=[])
    assert "api_key" not in lite.calls[2]


# --- the text seams, one by one -----------------------------------------------------------------


def test_the_concept_proposer_answers_from_the_fallback_and_the_ledger_says_so(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway.curriculum.concepts import ConceptEntry, LiveProposer, Topic

    sink = fakes.ledger_sink(monkeypatch)
    lite = fakes.chain(
        monkeypatch, {LUNA: fakes.Down("luna: no credit"), HAIKU: '{"concept_id": "c-1"}'}
    )
    topic = Topic(
        id="t-1",
        name="Fractions",
        objectives=("add unlike fractions",),
        level="Class 6",
        subject="maths",
    )
    entry = ConceptEntry(
        concept_id="c-1", canonical_name="Fractions", subjects=("maths",), occurrences=3
    )
    assert LiveProposer().choose(topic=topic, candidates=[entry]) == "c-1"
    assert lite.tried == [LUNA, HAIKU]
    row = sink.rows[-1]
    assert row["model_requested"] == LUNA
    assert row["model_served"] == HAIKU
    assert row["fallback_used"] is True
    assert row["provider"] == "anthropic"


def test_the_own_syllabus_readers_answer_from_the_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway.curriculum.own import LiveStructureModel, LiveVisionReader

    sink = fakes.ledger_sink(monkeypatch)
    lite = fakes.chain(
        monkeypatch,
        {
            LUNA: fakes.Down("luna: 503"),
            HAIKU: '{"units": [{"title": "Unit 1", "quote": "Unit 1 Numbers", "page": 1}]}',
        },
    )
    structured = LiveStructureModel().structure(text="Unit 1 Numbers", hint={"level": "Class 6"})
    assert structured["units"][0]["title"] == "Unit 1"
    assert lite.served == HAIKU

    lite.answers[HAIKU] = "Unit 1 Numbers\nUnit 2 Shapes"
    text = LiveVisionReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg")
    assert text == "Unit 1 Numbers\nUnit 2 Shapes"
    assert lite.served == HAIKU
    rows = [r for r in sink.rows if r["capability"] == "curriculum.own.read"]
    assert len(rows) == 2
    assert {r["model_served"] for r in rows} == {HAIKU}
    assert all(r["fallback_used"] for r in rows)


def test_a_plexus_engine_answers_from_the_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway.plexus import engines

    sink = fakes.ledger_sink(monkeypatch)
    lite = fakes.chain(monkeypatch, {TERRA: fakes.Down("terra: timeout"), OPUS: '{"cards": []}'})
    text, tokens = engines._complete(TERRA, "compose", "{}", (OPUS, GEMINI))
    assert text == '{"cards": []}' and tokens == 30
    assert lite.served == OPUS
    row = [r for r in sink.rows if r["capability"] == "engine.compose"][-1]
    assert row["model_served"] == OPUS and row["fallback_used"] is True


def test_the_plexus_judge_has_a_chain_and_answers_from_it(monkeypatch: pytest.MonkeyPatch) -> None:
    """The judge used to call ONE model with no fallback: a verify-tier outage meant every artifact
    was promoted unscored. Now it carries the verify tier's chain, minus itself."""
    from wobo_gateway.plexus import validate
    from wobo_gateway.routing import Tier, tier_chain

    judge, *behind = tier_chain(Tier.VERIFY)
    sink = fakes.ledger_sink(monkeypatch)
    lite = fakes.chain(
        monkeypatch,
        {
            judge: fakes.Down("the judge: overloaded"),
            behind[0]: '{"score": 91, "critical": false, "weak": [], "notes": "fine"}',
        },
    )
    verdict = validate._judge(judge, "compose", "fractions", {"cards": []})
    assert verdict == {"score": 91.0, "critical": False, "weak": [], "notes": "fine"}
    assert validate._judge_chain(judge) == behind
    assert [c["model"] for c in lite.calls] == [judge, behind[0]]
    assert lite.served == behind[0]
    assert len({m.split("/")[0] for m in (judge, *behind)}) == 3, "three providers on the bench"
    row = [r for r in sink.rows if r["capability"] == "engine.compose"][-1]
    assert row["model_requested"] == judge and row["model_served"] == behind[0]


def test_the_discovery_search_crosses_to_the_other_providers_own_search_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Each provider's web-search tool has its own shape, so litellm cannot run this chain: the
    seam runs it, one provider's tool at a time.

    Law (docs/CURRICULUM.md section 4.1 and the search module's own docstring, from the first
    end-to-end run of 2026-09-11): OpenAI's ``web_search`` is a Responses API tool, so that
    flavour searches on ``litellm.responses`` and not on chat completions, which refuses the tool
    and silently ignores ``web_search_options``; and a reply with no search behind it is the model
    remembering a url, so it is discarded whatever it says. The fake litellm therefore answers
    the Responses API too, and a reply to a request that bound a search tool carries the search
    the vendor would report, which is what makes the anthropic answer admissible here.
    """
    from wobo_gateway.curriculum.discovery import search

    monkeypatch.setenv("OPENAI_API_KEY", "not-a-real-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")
    sink = fakes.ledger_sink(monkeypatch)
    reply = json.dumps(
        {
            "results": [
                {
                    "url": "https://cbseacademic.nic.in/web_material/CurriculumMain26/maths.pdf",
                    "title": "Maths",
                }
            ]
        }
    )
    lite = fakes.chain(monkeypatch, {LUNA: fakes.Down("openai: 429"), HAIKU: reply})
    results = search.NativeToolSearchProvider("openai").search("cbse class 9 maths")
    assert [r.url for r in results] == [
        "https://cbseacademic.nic.in/web_material/CurriculumMain26/maths.pdf"
    ]
    assert results[0].provider == "anthropic"
    assert lite.tried == [LUNA, HAIKU]
    assert lite.calls[0]["tools"] == [{"type": "web_search"}]
    assert lite.calls[1]["tools"][0]["type"] == "web_search_20250305"
    served = [r["model_served"] for r in sink.rows if r["capability"] == "curriculum.discovery"]
    assert served[-1] == HAIKU


def test_the_discovery_search_raises_when_every_provider_is_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway.curriculum.discovery import search

    monkeypatch.setenv("OPENAI_API_KEY", "not-a-real-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")
    fakes.chain(monkeypatch, {})
    with pytest.raises(Exception, match="down"):
        search.NativeToolSearchProvider("openai").search("cbse class 9 maths")


# --- b) text to speech --------------------------------------------------------------------------

GOOGLE = "generativelanguage.googleapis.com"
OPENAI = "api.openai.com"


def _keys(monkeypatch: pytest.MonkeyPatch, *, google: bool = True, openai: bool = True) -> None:
    for name in ("GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    if google:
        monkeypatch.setenv("GEMINI_API_KEY", "not-a-real-google-key")
    if openai:
        monkeypatch.setenv("OPENAI_API_KEY", "not-a-real-openai-key")


def test_a_spoken_line_falls_to_openai_with_the_same_instruction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway import voice
    from wobo_gateway.plexus import media
    from wobo_gateway.routing import Tier, tier_chain

    _keys(monkeypatch)
    sink = fakes.ledger_sink(monkeypatch)
    http = fakes.HttpFake().install(monkeypatch)
    http.on(GOOGLE, lambda req: (_ for _ in ()).throw(fakes.http_error(req.full_url, 503, "down")))
    http.on(OPENAI, lambda req: fakes.wav_bytes(1.5, streamed=True))

    how = voice.spoken_instruction("en-IN", "win")
    out = media.synthesize_narration("Two x equals ten.", instruction=how)
    assert out is not None and out["mime"] == "audio/wav"
    assert media.wav_duration_ms(out["b64"]) == 1500, "the streamed header's sizes are rewritten"

    sent = http.sent_to(OPENAI)[0]
    assert sent["model"] == media.OPENAI_TTS_MODEL == "gpt-4o-mini-tts", (
        "the one that takes instructions"
    )
    assert media.OPENAI_TTS_ID in tier_chain(Tier.VOICE), "the router's own rung"
    assert sent["input"] == "Two x equals ten.", "the line alone: the instruction has its own field"
    assert sent["instructions"] == how, "the beat instruction, whole, as the vendor's own field"
    assert sent["response_format"] == "wav"
    auth = [r for r in http.requests if r.full_url.split("/")[2] == OPENAI][0]
    assert auth.get_header("Authorization", "").startswith("Bearer ")
    assert [r.full_url.split("/")[2] for r in http.requests] == [GOOGLE, OPENAI], "Gemini first"

    row = [r for r in sink.rows if r["capability"] == "voice.tts"][-1]
    assert row["model_served"] == f"openai/{media.OPENAI_TTS_MODEL}"
    assert row["model_requested"] == f"gemini/{media.TTS_MODEL}"
    assert row["fallback_used"] is True and row["provider"] == "openai"
    assert row["unit_kind"] == "spoken_second" and row["unit_count"] == pytest.approx(1.5, abs=0.01)


def test_gemini_still_speaks_first_and_the_row_names_it(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway.plexus import media

    _keys(monkeypatch)
    sink = fakes.ledger_sink(monkeypatch)
    http = fakes.HttpFake().install(monkeypatch)
    http.on(GOOGLE, lambda req: fakes.gemini_audio(2.0))
    http.on(OPENAI, lambda req: (_ for _ in ()).throw(AssertionError("OpenAI must not be asked")))
    out = media.synthesize_narration("A line.")
    assert out is not None and out["mime"] == "audio/wav"
    assert http.sent_to(OPENAI) == []
    row = [r for r in sink.rows if r["capability"] == "voice.tts"][-1]
    assert row["model_served"] == f"gemini/{media.TTS_MODEL}" and row["provider"] == "gemini"
    assert row["fallback_used"] is False


def test_with_both_voices_down_the_line_is_none_for_the_device_voice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway.plexus import media

    _keys(monkeypatch)
    http = fakes.HttpFake().install(monkeypatch)
    http.on(GOOGLE, lambda req: (_ for _ in ()).throw(fakes.http_error(req.full_url, 500)))
    http.on(OPENAI, lambda req: (_ for _ in ()).throw(fakes.http_error(req.full_url, 429)))
    assert media.synthesize_narration("A line.") is None


def test_an_openai_key_alone_is_enough_to_speak(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway.plexus import media

    _keys(monkeypatch, google=False)
    http = fakes.HttpFake().install(monkeypatch)
    http.on(OPENAI, lambda req: fakes.wav_bytes(0.5))
    out = media.synthesize_narration("A line.")
    assert out is not None and http.sent_to(OPENAI)[0]["input"] == "A line."


def test_the_tts_route_answers_503_only_when_no_voice_has_a_key(
    monkeypatch: pytest.MonkeyPatch, auth: Any
) -> None:
    from fastapi.testclient import TestClient
    from wobo_gateway.app import create_app

    client = TestClient(create_app())
    _keys(monkeypatch, google=False, openai=False)
    resp = client.post("/v1/voice/tts", json={"text": "A line."}, headers=auth())
    assert resp.status_code == 503

    _keys(monkeypatch, google=False, openai=True)
    monkeypatch.setattr(
        "wobo_gateway.plexus.media.synthesize_narration",
        lambda text, *, instruction=None, **_: {"mime": "audio/wav", "b64": "AAAA"},
    )
    resp = client.post("/v1/voice/tts", json={"text": "A line."}, headers=auth())
    assert resp.status_code == 200
    assert set(resp.json()) == {"mime", "b64", "accent", "beat"}, "no vendor name reaches a learner"


# --- c) vision ----------------------------------------------------------------------------------


def test_the_doubt_read_runs_gemini_first_and_terra_behind_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway import doubt

    sink = fakes.ledger_sink(monkeypatch)
    page = json.dumps(
        {
            "subject": "maths",
            "topic": "fractions",
            "question": "",
            "lines": [{"text": "1/2 + 1/4", "box": [0.1, 0.1, 0.9, 0.3]}],
        }
    )
    lite = fakes.chain(monkeypatch, {GEMINI: page})
    assert doubt._chain("doubt.read") == (GEMINI, [TERRA])
    first = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    assert [c["model"] for c in lite.calls] == [GEMINI]

    lite.answers = {GEMINI: fakes.Down("gemini: 503"), TERRA: page}
    second = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    assert lite.served == TERRA
    assert second == first, "the reading shape is identical whichever eyes read the page"
    assert [line.text for line in second.lines] == ["1/2 + 1/4"]
    rows = [r for r in sink.rows if r["capability"] == "doubt.read"]
    assert [r["model_served"] for r in rows] == [GEMINI, TERRA]
    assert rows[1]["fallback_used"] is True and rows[1]["unit_kind"] == "doubt"


def test_a_fallback_that_reports_a_bare_name_still_names_its_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """litellm's ``response.model`` is the bare name ("gpt-5.6-terra"). Proved live 2026-09-05: the
    row for a Terra read behind a dead Gemini said ``gpt-5.6-terra`` and no provider at all, so
    the bill could not say whose it was. The chain walker now marks the full id it called."""
    from wobo_gateway import doubt

    sink = fakes.ledger_sink(monkeypatch)
    page = json.dumps({"subject": "maths", "topic": "", "question": "", "lines": []})
    fakes.chain(monkeypatch, {GEMINI: fakes.Down("gemini: 401"), TERRA: page}, bare=True)
    doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    row = [r for r in sink.rows if r["capability"] == "doubt.read"][-1]
    assert row["model_served"] == TERRA and row["provider"] == "openai"
    assert row["fallback_used"] is True


# --- d) imagery ---------------------------------------------------------------------------------


def test_a_diagram_falls_to_openai_and_the_contract_holds(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from wobo_gateway.plexus import image
    from wobo_gateway.routing import Tier, tier_chain

    monkeypatch.setenv("WOBO_IMAGE_CACHE_DIR", str(tmp_path))
    _keys(monkeypatch)
    sink = fakes.ledger_sink(monkeypatch)
    http = fakes.HttpFake().install(monkeypatch)
    http.on(GOOGLE, lambda req: (_ for _ in ()).throw(fakes.http_error(req.full_url, 503)))
    png = fakes.png_bytes()
    http.on(OPENAI, lambda req: {"data": [{"b64_json": base64.b64encode(png).decode()}]})

    out = image.generate_image("plant cell", difficulty="core")
    assert out["status"] == "ready" and out["mime"] == "image/png"
    assert base64.b64decode(out["b64"]) == png
    assert out["provenance"]["engine"] == "engine.image"
    assert out["provenance"]["model"] == f"openai/{image.OPENAI_IMAGE_MODEL}"
    sent = http.sent_to(OPENAI)[0]
    assert sent["model"] == image.OPENAI_IMAGE_MODEL
    assert f"openai/{sent['model']}" in tier_chain(Tier.IMAGE), "the router's own rung"
    assert sent["n"] == 1 and sent["size"] == "1024x1024"
    assert sent["prompt"] == image._compose_prompt("plant cell")
    assert [r.full_url.split("/")[2] for r in http.requests] == [GOOGLE, OPENAI], "Gemini first"
    row = [r for r in sink.rows if r["capability"] == "engine.image"][-1]
    assert row["model_served"] == f"openai/{image.OPENAI_IMAGE_MODEL}"
    assert row["model_requested"] == f"gemini/{image.MODEL}"
    assert row["fallback_used"] is True and row["unit_kind"] == "image"
    # cached under the same key: the next learner pays nothing and the provenance says who drew it
    assert image.generate_image("plant cell", difficulty="core")["provenance"]["model"].startswith(
        "openai/"
    )


def test_gemini_still_draws_first_and_the_row_names_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from wobo_gateway.plexus import image

    monkeypatch.setenv("WOBO_IMAGE_CACHE_DIR", str(tmp_path))
    _keys(monkeypatch)
    sink = fakes.ledger_sink(monkeypatch)
    http = fakes.HttpFake().install(monkeypatch)
    http.on(GOOGLE, lambda req: fakes.gemini_image(fakes.png_bytes()))
    http.on(OPENAI, lambda req: (_ for _ in ()).throw(AssertionError("OpenAI must not be asked")))
    out = image.generate_image("human heart")
    assert out["status"] == "ready"
    assert out["provenance"]["model"] == f"gemini/{image.MODEL}"
    row = [r for r in sink.rows if r["capability"] == "engine.image"][-1]
    assert row["model_served"] == f"gemini/{image.MODEL}" and row["fallback_used"] is False


def test_with_both_painters_down_the_engine_is_unavailable_and_caches_nothing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from wobo_gateway.plexus import image

    monkeypatch.setenv("WOBO_IMAGE_CACHE_DIR", str(tmp_path))
    _keys(monkeypatch)
    http = fakes.HttpFake().install(monkeypatch)
    http.on(GOOGLE, lambda req: (_ for _ in ()).throw(fakes.http_error(req.full_url, 500)))
    http.on(OPENAI, lambda req: (_ for _ in ()).throw(fakes.http_error(req.full_url, 500)))
    assert image.generate_image("plant cell") == {"status": "unavailable"}
    assert list(tmp_path.iterdir()) == []


# --- e) safety ----------------------------------------------------------------------------------

CIVICS = "what is the suicide rate in india, for civics"


def _screen() -> Any:
    from wobo_gateway import safety, safety_model

    return safety.LayeredClassifier(
        model=safety_model.ModelClassifier(), model_enabled=lambda: True
    )


def test_the_safety_chain_is_openai_then_gemini_then_the_rules(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway import safety_model

    sink = fakes.ledger_sink(monkeypatch)
    lite = fakes.chain(
        monkeypatch,
        {LUNA: fakes.Down("openai: 401"), GEMINI: '{"category": "ok", "severity": "low"}'},
    )
    verdict = _screen().classify(CIVICS)
    assert safety_model._chain() == (LUNA, [GEMINI])
    assert [c["model"] for c in lite.calls] == [LUNA, GEMINI]
    assert verdict.category == "ok" and verdict.source == "model"
    row = [r for r in sink.rows if r["capability"] == safety_model.CAPABILITY][-1]
    assert row["model_served"] == GEMINI and row["fallback_used"] is True

    lite.answers = {}
    verdict = _screen().classify(CIVICS + " please")
    assert verdict.source == safety_model.SOURCE_FAIL_SAFE, "both down: the rule layer answers"
    assert (
        verdict.category != "crisis" or verdict.flagged
    )  # held at the rules' family, never invented


def test_an_outage_on_every_provider_never_reaches_the_crisis_script(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The law from wave 22, kept: a sustained outage is a soft hold, not Childline."""
    from wobo_gateway import safety, safety_model

    fakes.chain(monkeypatch, {})
    clf = _screen()
    for _ in range(safety_model.BREAKER_THRESHOLD + 1):
        clf.classify(CIVICS)
    say = safety.screen_inbound({"context": {"turn": {"lastUserInput": CIVICS}}}, clf)
    assert say is not None
    assert "Childline" not in say["say"] and "1098" not in say["say"]
    assert say["say"] == safety.OUTAGE_SAY
