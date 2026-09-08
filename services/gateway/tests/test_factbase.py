"""Fact base: seed integrity, agreement-promotion, contradiction-flagging (SUBJECTS.md §2)."""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest
from wobo_gateway.plexus import factcheck

REPO = Path(__file__).resolve().parents[3]


def _load_build():
    """content/factbase/build.py is a script, not an installed package — load it by path."""
    path = REPO / "content" / "factbase" / "build.py"
    spec = importlib.util.spec_from_file_location("factbase_build", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


build = _load_build()


# --- seed integrity --------------------------------------------------------------------------


def test_seed_integrity():
    facts = build.build_from_catalogs()
    assert len(facts) > 50, "the CBSE class 9-10 bio/social seed should be substantial"

    ids: set[str] = set()
    for f in facts:
        for key in ("id", "conceptId", "claim", "kind", "subject", "source", "confidence"):
            assert f.get(key), f"fact missing {key}: {f}"
        assert f["kind"] in build.KINDS, f["kind"]
        assert f["confidence"] == "verified", "catalog seed is owned ground truth"
        assert f["subject"] in build.FACTBASE_SUBJECTS, f["subject"]
        # conceptId is a normalized slug and stable under re-slugging (matches store.concept_id)
        assert re.fullmatch(r"[a-z0-9-]+", f["conceptId"]), f["conceptId"]
        assert f["conceptId"] == build.slug(f["conceptId"]) and len(f["conceptId"]) <= 60
        assert f["source"]["type"] == "catalog" and f["source"]["board"] == "CBSE"
        assert f["id"] not in ids, f"duplicate fact id {f['id']}"
        ids.add(f["id"])

    # chapters (structure) and their ordering (relation) are guaranteed across two grades x two
    # subjects; topic definitions depend on the catalog carrying per-topic blurbs.
    kinds = {f["kind"] for f in facts}
    assert {"structure", "relation"} <= kinds, kinds


def test_seed_slug_matches_runtime_keying():
    # build.slug must equal the runtime resolver so a topic's facts are findable at serve time
    from wobo_gateway.plexus import store

    assert build.slug("Nationalism in India") == store.concept_id("Nationalism in India")


# --- agreement-promotion ---------------------------------------------------------------------


def _cand(claim: str) -> dict:
    return build.make_fact(
        conceptId="c", claim=claim, kind="date", subject="social",
        source={"type": "model-generated-unverified", "model": "anthropic/claude-opus-5"},
        confidence="unverified",
    )


def test_agreement_promotes_only_cross_model_agreements():
    cands = [_cand("The Dandi March began in 1930."),
             _cand("The Quit India Movement began in 1942."),
             _cand("The Battle of Plassey was in 1657.")]  # wrong (real: 1757) -> disagreement

    def fake_verify(fact):
        wrong = "1657" in fact["claim"]
        return (not wrong, "matches NCERT" if not wrong else "wrong date, NCERT says 1757")

    promoted, review = build.verify_candidates(cands, verify=fake_verify)

    assert len(promoted) == 2 and all(p["confidence"] == "verified" for p in promoted)
    assert all(p["source"]["type"] == "model-verified" for p in promoted)
    assert all(p["source"]["models"][-1] == build.VERIFIER_MODEL for p in promoted)

    assert len(review) == 1 and review[0]["confidence"] == "unverified"
    assert review[0]["source"]["verifierVerdict"] == "disagree"
    assert "1757" in review[0]["source"]["verifierReason"]


# --- contradiction-flagging ------------------------------------------------------------------


@pytest.fixture()
def crafted_base(tmp_path, monkeypatch):
    fact = {
        "id": "a", "conceptId": "nationalism-in-india",
        "claim": "The Dandi March began in 1930.", "kind": "date", "subject": "social",
        "confidence": "verified",
        "check": {"entity": "Dandi March", "value": "1930", "kind": "year"},
    }
    unverified = {**fact, "id": "b", "claim": "noise", "confidence": "unverified", "check": None}
    (tmp_path / "facts.v1.jsonl").write_text(
        json.dumps(fact) + "\n" + json.dumps(unverified) + "\n", encoding="utf-8"
    )
    monkeypatch.setenv("FACTBASE_DIR", str(tmp_path))
    factcheck._load.cache_clear()
    yield
    factcheck._load.cache_clear()


def test_contradiction_is_flagged(crafted_base):
    bad = {"cards": [{"prose": "The Dandi March of 1929 was Gandhi's salt protest."}]}
    hits = factcheck.validate_claims(bad, "Nationalism in India")
    assert hits and "1930" in hits[0] and "1929" in hits[0]


def test_correct_and_silent_content_not_flagged(crafted_base):
    good = {"cards": [{"prose": "The Dandi March began in 1930, a salt protest led by Gandhi."}]}
    silent = {"cards": [{"prose": "The Dandi March was a famous salt satyagraha led by Gandhi."}]}
    assert factcheck.validate_claims(good, "Nationalism in India") == []
    # absence != contradiction
    assert factcheck.validate_claims(silent, "Nationalism in India") == []


def test_unknown_concept_and_unverified_fact_are_ignored(crafted_base):
    bad = {"cards": [{"prose": "The Dandi March of 1929."}]}
    assert factcheck.validate_claims(bad, "Some Math Topic") == []  # no facts for this concept
    # only the verified fact loads; the unverified 'noise' row is never queryable
    assert factcheck.facts_for("Nationalism in India") == ["The Dandi March began in 1930."]


def test_gate_subject_scoping():
    """Every subject the product teaches is fact-checked, however the board spells it.

    This test used to assert the opposite — `frozenset({"science", "social"})`, with physics and
    chemistry "left to the CAS/sim". Wave 30 measured that: the CAS accepts falsified kinematics
    (`x = v*t` -> `x = v*t**2`), so nothing checked them; and the caller compared a payload's
    "Science" / "Social Science" against the lowercase set, so the gate never fired for anything
    at all. See tests/test_factbase_gate.py.
    """
    for subject in ("Science", "Social Science", "Biology", "Physics", "Chemistry", "Mathematics"):
        assert factcheck.covers(subject)
    # a subject the base has nothing for is still a no-op, but by having no facts — never by
    # being excluded before the base is consulted
    assert not factcheck.covers("Sanskrit")
    assert not factcheck.covers(None)
