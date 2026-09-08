"""FIX 13 — the fact base is dead three ways; make the gate actually run.

Wave-30 evidence (`wave30-content-reports/SCORECARD.md` §3.3, `physchem-engineering.md` §5,
`social-eng.md` §3):

  1. `validate._factcheck` tests `scope["subject"] not in FACTBASE_SUBJECTS` against the
     frozenset `{"science", "social"}`, and the payload carries `"Science"` / `"Social Science"`
     — a case (and wording) mismatch, so the gate never fires for anything.
  2. Biology, Physics and Chemistry are excluded from that frozenset by design, so two of every
     three phys/chem cells have no fact gate at all.
  3. The runtime concept-id is `motion-distance-displacement-speed-velocity-and-their-graphs`
     while the fact base is keyed `motion`, so even with 1 and 2 fixed `facts_for` returns `[]`.

These tests run against the REAL shipped `content/factbase/facts.v1.jsonl` (532 rows), because
the finding is about that file's keys and that file's content — not about a fixture.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from wobo_gateway.plexus import factcheck

REPO = Path(__file__).resolve().parents[3]
FACTS = REPO / "content" / "factbase" / "facts.v1.jsonl"


@pytest.fixture(autouse=True)
def real_factbase(monkeypatch):
    """No fixture base: this whole file is about the shipped one."""
    monkeypatch.delenv("FACTBASE_DIR", raising=False)
    factcheck._load.cache_clear()
    yield
    factcheck._load.cache_clear()


def _rows() -> list[dict]:
    return [json.loads(line) for line in FACTS.read_text().splitlines() if line.strip()]


# --- 1. the subject gate ------------------------------------------------------------------

# Exactly the subject strings the twelve wave-30 lab cells put in the engine payload
# (`.lab/artifacts/*/*/*.json`).
LAB_SUBJECTS = ("Science", "Social Science", "Biology", "Physics", "Chemistry", "Mathematics")


@pytest.mark.parametrize("subject", LAB_SUBJECTS)
def test_the_gate_covers_every_subject_the_lab_runs(subject: str) -> None:
    assert factcheck.covers(subject), f"{subject!r} is fact-checked by nobody"


def test_the_gate_is_case_and_wording_insensitive() -> None:
    assert factcheck.covers("science") and factcheck.covers("SCIENCE")
    assert factcheck.covers("social") and factcheck.covers("  Social Science ")
    assert not factcheck.covers("")
    assert not factcheck.covers(None)  # type: ignore[arg-type]


def test_validate_runs_the_gate_for_a_capitalised_subject() -> None:
    """The caller, not just the frozenset. `_factcheck` is what actually decides."""
    from wobo_gateway.plexus.validate import _factcheck

    _contradictions, facts = _factcheck(
        {"cards": [{"prose": "Motion is measured against a reference point."}]},
        "Motion: distance, displacement, speed, velocity and their graphs",
        {"board": "CBSE", "grade": "9", "subject": "Science", "chapter": "Motion"},
    )
    assert facts, "the judge was handed no NCERT ground truth for a chapter the base holds"


# --- 2. keying: the runtime concept-id must find the fact base's key -----------------------

# (runtime concept as it reaches the engine, fact-base key it must resolve to)
LAB_CONCEPTS = [
    ("Motion: distance, displacement, speed, velocity and their graphs", "motion"),
    ("Structure of the atom: Bohr model, orbitals and electronic config", "structure-of-the-atom"),
    ("life processes: respiration, aerobic and anaerobic", "life-processes"),
    ("our environment: the natural and human environment", "our-environment"),
    ("constitutional design: how the Indian constitution was made", "constitutional-design"),
    (
        "nationalism in India: from non-cooperation to civil disobedience",
        "nationalism-in-india",
    ),
]


@pytest.mark.parametrize("concept,key", LAB_CONCEPTS)
def test_a_runtime_concept_id_resolves_to_the_fact_bases_key(concept: str, key: str) -> None:
    from wobo_gateway.plexus import store

    cid = store.concept_id(concept)
    assert cid != key, "precondition: this is the mismatch the judges measured"
    assert factcheck.resolve_concept(cid) == key
    assert factcheck.facts_for(cid), "the judge is still handed nothing for this chapter"


def test_resolution_never_reaches_across_to_an_unrelated_concept() -> None:
    """The rule is a hyphen-boundary prefix, not a substring: `motion-…` may resolve to
    `motion`, but `emotions-in-poetry` must not, and a maths topic must resolve to nothing."""
    assert factcheck.resolve_concept("emotions-in-poetry") is None
    assert factcheck.resolve_concept("quadratic-equations-and-the-nature-of-roots") is None
    assert factcheck.facts_for("Quadratic equations and the nature of roots") == []


# --- 3. how many of the 532 rows can actually be checked ----------------------------------


def test_the_shipped_rows_carry_no_check_block_of_their_own() -> None:
    rows = _rows()
    assert len(rows) == 532, "the count in the report is this file's count"
    assert sum(1 for r in rows if r.get("check")) == 0


def test_a_checkable_value_is_derived_from_the_rows_own_verified_text() -> None:
    """No fact is invented. A `check` atom is derived ONLY when a verified claim already states
    exactly one year for the entity that claim is about."""
    loaded = [f for facts in factcheck._load().values() for f in facts]
    checkable = [f for f in loaded if isinstance(f.get("check"), dict)]

    # The honest number, asserted so it cannot quietly drift: 2 of 532. The catalog seed is
    # structural (chapter / topic / ordering); only two of its blurbs state a year at all.
    assert len(checkable) == 2, [f["claim"] for f in checkable]
    assert {c["check"]["value"] for c in checkable} == {"1789", "1917"}
    assert {c["check"]["entity"] for c in checkable} == {
        "The revolution and its phases",
        "The Russian Revolution",
    }
    # and nothing was invented: every derived value appears verbatim in its own claim
    for f in checkable:
        assert re.search(rf"\b{f['check']['value']}\b", f["claim"])
        assert f["check"]["entity"] in f["claim"]


def test_a_derived_check_actually_flags_a_contradiction() -> None:
    bad = {"cards": [{"prose": "The Russian Revolution swept the Tsar away in 1905."}]}
    hits = factcheck.validate_claims(bad, "The Russian Revolution")
    assert hits and "1917" in hits[0] and "1905" in hits[0]

    good = {"cards": [{"prose": "The Russian Revolution of 1917 ended Tsarist rule."}]}
    assert factcheck.validate_claims(good, "The Russian Revolution") == []

    silent = {"cards": [{"prose": "The Russian Revolution ended Tsarist rule."}]}
    assert factcheck.validate_claims(silent, "The Russian Revolution") == []
