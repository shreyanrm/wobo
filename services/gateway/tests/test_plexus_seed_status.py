"""FIX 9 — the topic-agnostic seed is a placeholder, and it must never claim otherwise.

Wave-30 evidence (`wave30-content-reports/SCORECARD.md` §3.2 (c) 48/55, `physchem-*.md`,
`social-eng.md`): when live generation fails verification the gateway falls back to
`_seed(...)`, then writes the record `verified: true`, `status: "canonical"` and charges the
learner's daily generation for it. In physics and chemistry all three cells served three
generic scenes narrated *"Watch how one thing reaches the next."* as the real lesson; in social
science the served Class 7 Geography and Class 10 History courses are the same hard-coded
algebra seed, canonical and verified.

A seed is an honest FLOOR. It stays provisional, it says so in the provenance the client reads,
and it does not cost the learner one of their generations.
"""

from __future__ import annotations

import json

import pytest
from wobo_gateway.app import create_app
from wobo_gateway.plexus import engines, store


@pytest.fixture(autouse=True)
def cache_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_AI_API_KEY", raising=False)
    return tmp_path


@pytest.fixture()
def every_model_refuses(monkeypatch):
    """The provider-outage shape the judges ran: every live generation fails, so every
    modality lands on `_seed`."""

    def _boom(*_a, **_k):
        raise RuntimeError("every rung refused")

    monkeypatch.setattr(engines, "_complete", _boom)
    monkeypatch.setattr(engines, "_generate_video_live", _boom)
    monkeypatch.setattr(engines, "_generate_sim_live", _boom)


def _serve(modality: str, concept: str = "photosynthesis"):
    return engines.run_engine(
        capability=f"engine.{modality}",
        payload={"concept": concept},
        provider_model="anthropic/claude-opus-5",
        live=True,
    )


@pytest.mark.parametrize("modality", ["compose", "simulate", "diagram", "video"])
def test_a_seed_is_never_served_as_canonical_or_verified(
    every_model_refuses, modality: str
) -> None:
    out = _serve(modality).output

    assert out["seeded"] is True
    assert out["verified"] is False, "a placeholder was never verified — do not claim it was"
    assert out["status"] == store.PROVISIONAL, "a placeholder is not the canonical lesson"


@pytest.mark.parametrize("modality", ["compose", "simulate", "diagram", "video"])
def test_a_seed_is_labelled_in_the_provenance_the_client_reads(
    every_model_refuses, modality: str
) -> None:
    """`source: "seed"` already existed; nothing downstream could trust it while the same
    envelope said `verified: true, status: canonical`. `placeholder` is the unambiguous flag."""
    prov = _serve(modality).output["provenance"]
    assert prov["source"] == "seed"
    assert prov["placeholder"] is True
    assert "model" not in prov  # model ids still never leave the brain


def test_the_stored_record_is_provisional_too(every_model_refuses) -> None:
    _serve("compose")
    record = json.loads(store.artifact_path("photosynthesis", "compose", "core").read_text())
    assert record["seeded"] is True
    assert record["verified"] is False
    assert record["status"] == store.PROVISIONAL


def test_a_generated_artifact_is_untouched(monkeypatch) -> None:
    """The floor moves; the real thing does not. A live artifact that PASSES verification is
    still provisional-then-canonical with `source: "generated"` and `verified: true`."""
    good = {"cards": [{"kind": "text", "title": "t", "idea": "i"}]}
    monkeypatch.setattr(engines, "_generate_live", lambda *a, **k: (good, "some/model", 7, False))
    monkeypatch.setattr(engines, "_spawn_validation", lambda *a, **k: None)
    out = _serve("compose").output
    assert out["verified"] is True
    assert out["seeded"] is False
    assert out["provenance"]["source"] == "generated"
    assert "placeholder" not in out["provenance"]


def test_a_recorded_lint_refusal_still_serves_without_regenerating(monkeypatch) -> None:
    """REGRESSION GUARD. `validate._promote_after_lint_failure` records a seed with `refusedAt`
    precisely so a concept two frontier models already failed does not buy two fresh
    generations on every single request. Making seeds unverified must not reopen that."""
    path = store.artifact_path("pressure", "compose", "core")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "concept": "pressure",
                "modality": "compose",
                "difficulty": "core",
                "verified": False,
                "seeded": True,
                "status": store.PROVISIONAL,
                "refusedAt": "2026-09-05T00:00:00+00:00",
                "artifact": engines._seed("compose", "pressure", "core"),
                "provenance": {
                    "engine": "engine.compose",
                    "model": "seed",
                    "prompt_version": store.PROMPT_VERSION,
                },
            }
        )
    )

    def _never(*_a, **_k):
        raise AssertionError("a recorded refusal must not buy another generation")

    monkeypatch.setattr(engines, "_generate_live", _never)
    out = _serve("compose", concept="pressure")
    assert out.tokens == 0
    assert out.output["seeded"] is True


# --- and the learner does not pay for it -------------------------------------------------


def test_a_placeholder_does_not_cost_the_learner_a_generation(tmp_path, monkeypatch, auth):
    from fastapi.testclient import TestClient
    from wobo_gateway import budget
    from wobo_gateway.app import Gateway
    from wobo_gateway.cache import InMemoryCache
    from wobo_gateway.providers import build_provider
    from wobo_gateway.telemetry import MetricsSink

    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    monkeypatch.setenv("FREE_DAILY_GENERATIONS", "5")
    budget.reset()

    # The LIVE provider, so `run_engine` takes the live branch — but no model is ever reached:
    # `_generate_live` is stubbed, first with a real artifact and then with the seed floor.
    client = TestClient(create_app(Gateway(build_provider("live"), InMemoryCache(), MetricsSink())))
    headers = auth("seed-payer")

    # A real generation costs one.
    good = {"cards": [{"kind": "text", "title": "t", "idea": "i"}]}
    monkeypatch.setattr(engines, "_generate_live", lambda *a, **k: (good, "some/model", 7, False))
    monkeypatch.setattr(engines, "_spawn_validation", lambda *a, **k: None)
    ok = client.post(
        "/v1/capability/engine.compose",
        json={"payload": {"concept": "fractions"}},
        headers=headers,
    )
    assert ok.status_code == 200, ok.text
    assert ok.headers["X-Wobo-Budget-Remaining"] == "4"

    # A placeholder costs none: the learner did not receive the lesson they asked for.
    def _seeded(*_a, **_k):
        return engines._seed("compose", "osmosis", "core"), "seed", 0, True

    monkeypatch.setattr(engines, "_generate_live", _seeded)
    floor = client.post(
        "/v1/capability/engine.compose",
        json={"payload": {"concept": "osmosis"}},
        headers=headers,
    )
    assert floor.status_code == 200, floor.text
    assert floor.json()["output"]["provenance"]["source"] == "seed"
    assert floor.headers["X-Wobo-Budget-Remaining"] == "4", "a placeholder was billed as a lesson"
