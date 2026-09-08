"""The learner the content is FOR must reach the model and the cache key.

Wave-30 finding (SCORECARD §3.5 fixes 5, 6 and 10's key half): a generation was specified by
concept alone. The prompt received ``{concept, difficulty, audience: "Indian K-12 learner"}`` and
the judge's rubric hard-coded "an Indian middle-school learner", so a class 6 fractions card and a
class 11 quadratic card were written and scored for the same imaginary reader. The artifact key
digested only (concept x modality x difficulty), so the CBSE class 8 key EQUALED the ISC class 11
key, an ICSE request was served the byte-identical CBSE artifact, a syllabus-version bump never
regenerated, and ``payload["raster"]`` collided the Nano-Banana image with the plain SVG diagram.

Mock mode only — deterministic, keyless, no network.
"""

from __future__ import annotations

import json

import pytest
from wobo_gateway.app import CapabilityRequest, Gateway
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.plexus import engines, store
from wobo_gateway.providers import MockProvider
from wobo_gateway.registry import ConsentTier
from wobo_gateway.telemetry import MetricsSink

CONCEPT = "quadratic equations and the nature of roots"

CBSE_8 = {
    "board": "CBSE",
    "grade": "8",
    "subject": "Mathematics",
    "chapter": "Linear equations",
    "contentVersion": "2026-27",
}
ISC_11 = {
    "board": "ISC",
    "grade": "11",
    "subject": "Mathematics",
    "chapter": "Quadratic equations",
    "contentVersion": "2026-27",
}


@pytest.fixture(autouse=True)
def cache_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_AI_API_KEY", raising=False)
    return tmp_path


def invoke(capability: str, subject: str = "scope-test-learner", **payload: object):
    gw = Gateway(MockProvider(), InMemoryCache(), MetricsSink())
    return gw.invoke(
        capability,
        CapabilityRequest(consent_tier=ConsentTier.UN_ELEVATED, payload=dict(payload)),
        subject=subject,
    )


def key(concept: str, modality: str, difficulty: str, payload: dict) -> str:
    """The artifact key a request with this payload resolves to, through the real seam."""
    return store.artifact_path(concept, modality, difficulty, engines._scope(payload)).name


# --- FIX 6: grade, board and contentVersion are part of the key ------------------------


def test_two_boards_two_classes_two_versions_are_four_distinct_keys() -> None:
    """The measured defect: `CBSE-8 key == ISC-11 key ? True` (mathematics-eng.md §1.2)."""
    cbse_8 = dict(CBSE_8)
    isc_11 = dict(ISC_11)
    icse_8 = {**CBSE_8, "board": "ICSE"}
    cbse_8_next = {**CBSE_8, "contentVersion": "2027-28"}

    keys = {
        "cbse-8": key(CONCEPT, "compose", "core", cbse_8),
        "isc-11": key(CONCEPT, "compose", "core", isc_11),
        "icse-8": key(CONCEPT, "compose", "core", icse_8),
        "cbse-8@2027-28": key(CONCEPT, "compose", "core", cbse_8_next),
    }
    assert len(set(keys.values())) == 4, keys


def test_a_board_change_alone_changes_the_key() -> None:
    assert key(CONCEPT, "compose", "core", CBSE_8) != key(
        CONCEPT, "compose", "core", {**CBSE_8, "board": "ICSE"}
    )


def test_a_class_change_alone_changes_the_key() -> None:
    assert key(CONCEPT, "compose", "core", CBSE_8) != key(
        CONCEPT, "compose", "core", {**CBSE_8, "grade": "11"}
    )


def test_a_syllabus_version_bump_changes_the_key() -> None:
    """`cacheMissOnVersionChange: false` in all three maths cells — the request's contentVersion
    was inert, so a board revising a chapter served the old module forever."""
    assert key(CONCEPT, "compose", "core", CBSE_8) != key(
        CONCEPT, "compose", "core", {**CBSE_8, "contentVersion": "2027-28"}
    )


def test_one_grade_spelled_two_ways_is_still_one_key() -> None:
    """Cost guard: "8" and "Class 8" are the same class, so they must not double the misses."""
    assert key(CONCEPT, "compose", "core", CBSE_8) == key(
        CONCEPT, "compose", "core", {**CBSE_8, "grade": "Class 8"}
    )
    assert key(CONCEPT, "compose", "core", CBSE_8) == key(
        CONCEPT, "compose", "core", {**CBSE_8, "board": "cbse"}
    )


def test_subject_and_chapter_stay_out_of_the_key() -> None:
    """The mapping layer is unchanged: only board, class and syllabus version were the defect."""
    assert key(CONCEPT, "compose", "core", CBSE_8) == key(
        CONCEPT, "compose", "core", {**CBSE_8, "chapter": "some other chapter"}
    )


def test_an_icse_request_does_not_serve_the_cbse_artifact(cache_dir) -> None:
    """Measured: `board ICSE→ISC, grade 9→11` returned the same sha in 3.1 ms
    (biology-eng.md §1)."""
    first = invoke("engine.compose", concept=CONCEPT, **CBSE_8)
    assert first.tokens > 0
    other = invoke("engine.compose", concept=CONCEPT, **{**CBSE_8, "board": "ICSE"})
    assert other.tokens > 0, "an ICSE learner was served the CBSE artifact for free"


# --- FIX 6, the money: the warm-hit path stays warm and stays fast ---------------------


def test_the_same_request_twice_still_hits_warm(monkeypatch, cache_dir) -> None:
    first = invoke("engine.compose", concept=CONCEPT, user="learner-a", **CBSE_8)
    assert first.tokens > 0

    def _never(*_a, **_k):  # a warm hit must not reach generation at all
        raise AssertionError("warm hit fell through to a generation")

    monkeypatch.setattr(engines, "_seed", _never)
    monkeypatch.setattr(engines, "_generate_live", _never)
    second = invoke("engine.compose", concept=CONCEPT, user="learner-b", **CBSE_8)
    assert second.tokens == 0
    assert second.output == first.output


def test_the_warm_path_is_still_fast(cache_dir) -> None:
    """Warm serving measured 2.3-6.6 ms in the lab; the wider key must not slow the read."""
    import time

    invoke("engine.compose", concept=CONCEPT, **CBSE_8)
    scope = engines._scope(CBSE_8)
    start = time.perf_counter()
    for _ in range(50):
        assert store.load(CONCEPT, "compose", "core", scope) is not None
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert elapsed_ms < 500, f"50 warm loads took {elapsed_ms:.1f} ms"


# --- FIX 10 (key half): the raster image and the plain diagram are different artifacts --


def test_the_raster_image_does_not_collide_with_the_plain_diagram() -> None:
    """Measured: plain and `raster:true` resolved to the SAME filename, which is why every
    `image.svg` in the lab is byte-identical to its `diagram.svg` (mathematics-eng.md §1.5)."""
    plain = key(CONCEPT, "diagram", "core", CBSE_8)
    raster = key(CONCEPT, "diagram", "core", {**CBSE_8, "raster": True})
    assert plain != raster


def test_raster_false_is_the_plain_diagram_key() -> None:
    assert key(CONCEPT, "diagram", "core", CBSE_8) == key(
        CONCEPT, "diagram", "core", {**CBSE_8, "raster": False}
    )


# --- FIX 5: the prompt carries the learner ---------------------------------------------


def _prompts_for(monkeypatch, payloads: list[dict]) -> list[str]:
    """Every user message the composer would send for these payloads."""
    seen: list[str] = []

    def fake(_model, _modality, user, _fallbacks, **_k):
        seen.append(user)
        raise RuntimeError("captured")  # _generate_live seeds; the prompt is what we want

    monkeypatch.setattr(engines, "_complete", fake)
    for payload in payloads:
        engines._generate_live(
            "compose",
            CONCEPT,
            "core",
            "openai/gpt-5.6-terra",
            (),
            payload,
        )
    return seen


def test_the_prompt_names_the_board_class_subject_chapter_and_version(monkeypatch) -> None:
    (prompt,) = _prompts_for(monkeypatch, [{"concept": CONCEPT, **ISC_11}])
    sent = json.loads(prompt)
    blob = json.dumps(sent).lower()
    assert "isc" in blob
    assert "11" in blob
    assert "mathematics" in blob
    assert "quadratic equations" in blob
    assert "2026-27" in blob


def test_two_boards_two_classes_two_versions_are_four_distinct_prompts(monkeypatch) -> None:
    prompts = _prompts_for(
        monkeypatch,
        [
            {"concept": CONCEPT, **CBSE_8},
            {"concept": CONCEPT, **ISC_11},
            {"concept": CONCEPT, **{**CBSE_8, "board": "ICSE"}},
            {"concept": CONCEPT, **{**CBSE_8, "contentVersion": "2027-28"}},
        ],
    )
    assert len(set(prompts)) == 4, prompts


def test_the_composer_no_longer_writes_for_an_imaginary_middle_schooler() -> None:
    system = engines._SYSTEMS["compose"]
    assert "middle-school" not in system
    assert "middle school" not in system


def test_the_audience_falls_back_when_no_curriculum_scope_is_given(monkeypatch) -> None:
    (prompt,) = _prompts_for(monkeypatch, [{"concept": CONCEPT}])
    assert json.loads(prompt)["audience"]


# --- FIX 5: the judge scores against the same learner ----------------------------------


def test_the_judge_rubric_names_the_board_and_the_class() -> None:
    from wobo_gateway.plexus import validate

    rubric = validate._judge_system(engines._scope({"concept": CONCEPT, **ISC_11}))
    assert "middle-school" not in rubric
    assert "ISC" in rubric
    assert "11" in rubric


def test_the_judge_is_told_which_learner_it_is_scoring_for(monkeypatch) -> None:
    from wobo_gateway.plexus import validate

    seen: dict = {}

    class _Msg:
        content = '{"score": 90, "critical": false, "weak": [], "notes": "ok"}'

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]
        usage = None

    def fake_complete(*, model, messages, **_k):  # noqa: ANN001
        seen["system"] = messages[0]["content"]
        return _Resp()

    monkeypatch.setattr("wobo_gateway.model_call.complete", fake_complete)
    monkeypatch.setattr("wobo_gateway.telemetry.record_cost", lambda **_k: None)
    validate._judge(
        "anthropic/claude-opus-5",
        "compose",
        CONCEPT,
        {"cards": []},
        scope=engines._scope({"concept": CONCEPT, **ISC_11}),
    )
    assert "ISC" in seen["system"]
    assert "middle-school" not in seen["system"]
