"""NCERT fact-base validator seam (SUBJECTS.md §2).

For biology and social science the fact base IS the solver — there is no CAS to prove a date or a
name right, and measurement showed the CAS does not cover physics or chemistry either (the sim
verifier proves only that a formula parses and solves). This module reads the versioned fact base
(``content/factbase/facts.v*.jsonl``, verified facts only) and offers two things to the post-serve
gate (:mod:`validate`), for every subject the product teaches (:func:`covers`):

  • :func:`validate_claims` — a DETERMINISTIC contradiction check. It fires only on facts that carry
    a machine-checkable atom (a ``check`` with a year/number ``value`` for an ``entity``): if the
    generated content names that entity AND states a *different* value beside it, that is a proven
    contradiction against verified NCERT ground truth. Like the technical lint it fails CLOSED on a
    proven conflict and OPEN on everything it cannot prove — mere absence of a restated year is
    never
    a contradiction, so a correct artifact is never falsely flagged.
  • :func:`facts_for` — the verified claims for a concept, handed to the LLM judge as ground truth
    so
    the judge can catch the looser factual errors (a wrong definition, a wrong sequence) the
    deterministic check deliberately does not attempt in v1.

Keying: facts are stored under the catalog's chapter/topic slug; the runtime resolves a learner's
request to the longer topic LABEL they were shown, so the two are rarely equal and an exact lookup
found nothing in production. :func:`resolve_concept` matches exactly, else on the longest
fact-base key that is a hyphen-boundary prefix of the concept. No network, pure stdlib + the
JSONL on disk.

Honest limit, measured 2026-09-07: 0 of the 532 shipped rows carry a ``check`` block, and only 2
of them state a year at all, so ``validate_claims`` can prove a contradiction against exactly two
facts (``_derive_check`` reads those two atoms out of the claims' own verified text — nothing is
invented). The other 530 rows are structural (chapter, topic, ordering, blurb) and reach the judge
through :func:`facts_for`, which is where their value is. A fact base that can prove a date wrong
needs dated facts in it; that is ``build.py --live``, an operator run with keys, not this module.
"""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

# Which subjects the gate FIRES for.
#
# It used to be `{"science", "social"}`, tested with `scope["subject"] not in FACTBASE_SUBJECTS`
# against a payload carrying "Science" and "Social Science" — a case-and-wording mismatch that
# meant the gate fired for NOTHING, ever. And the exclusion of physics/chemistry/biology was
# justified by "the CAS/sim already covers the rest", which measurement disproved: `_verify_sim`
# proves only that a formula parses and solves, so falsifying kinematics from `x = v*t` to
# `x = v*t**2` is accepted, and no accuracy gate of any kind ran on physics or chemistry.
#
# So: every subject the product teaches, matched through `covers()` rather than raw membership.
# This is not a widening of what gets FLAGGED — the check is fail-open and a subject with no
# facts for the concept is still a no-op (`_load()` returns nothing, `validate_claims` returns
# []). It only stops a subject being excluded before the base is even consulted.
FACTBASE_SUBJECTS = frozenset({
    "science", "social", "biology", "physics", "chemistry", "mathematics",
})

# Board wording -> the id above. "Social Science" and "Social Studies" are the same subject the
# fact base calls "social"; "maths"/"math" are the same one it calls "mathematics".
_SUBJECT_ALIASES = {
    "social science": "social",
    "social studies": "social",
    "social-science": "social",
    "maths": "mathematics",
    "math": "mathematics",
    "bio": "biology",
    "phy": "physics",
    "chem": "chemistry",
}


def covers(subject: str | None) -> bool:
    """Does the fact-base gate fire for this subject, however the board spells it?"""
    key = re.sub(r"\s+", " ", str(subject or "")).strip().lower()
    return _SUBJECT_ALIASES.get(key, key) in FACTBASE_SUBJECTS

# A 4-digit year an NCERT date fact would assert (history sits ~1500-2099). Deliberately narrow so a
# stray "12" or "100" in prose is never read as a year.
_YEAR_RE = re.compile(r"\b(1[5-9]\d{2}|20\d{2})\b")
_WINDOW = 90  # chars either side of an entity mention to scan for a conflicting year


def _slug(text: str) -> str:
    """Idempotent; mirrors ``store._slug`` so factcheck keys align with build.py's."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "concept"


def _factbase_dir() -> Path | None:
    env = os.getenv("FACTBASE_DIR")
    if env:
        return Path(env)
    for parent in Path(__file__).resolve().parents:
        cand = parent / "content" / "factbase"
        if cand.is_dir():
            return cand
    return None


# The quoted name a catalog-seeded claim is ABOUT: build.py writes every one of them as
# "In CBSE Class 10 History, 'The Russian Revolution' is a chapter." / "'X' covers: ...".
_CLAIM_ENTITY_RE = re.compile(r"'([^']{3,80})'")


def _derive_check(fact: dict[str, Any]) -> dict[str, Any] | None:
    """A machine-checkable atom read out of a verified claim's OWN text. Never an invention.

    0 of the 532 shipped rows carry a ``check`` block, so ``validate_claims`` — which fires only
    on a ``check`` — could not fire on anything. Rather than write facts into the file that no
    NCERT source verified, this derives the atom the claim already states, and only when the
    claim is unambiguous: exactly one year in it, and a quoted entity that is not itself a year.
    Anything looser (two years, no named entity) yields nothing, because a guessed atom would
    flag correct content.
    """
    existing = fact.get("check")
    if isinstance(existing, dict):
        return existing
    claim = str(fact.get("claim") or "")
    years = set(_YEAR_RE.findall(claim))
    if len(years) != 1:
        return None
    match = _CLAIM_ENTITY_RE.search(claim)
    if not match:
        return None
    entity = match.group(1).strip()
    if not entity or _YEAR_RE.search(entity):
        return None
    return {"kind": "year", "entity": entity, "value": years.pop(), "derived": True}


@lru_cache(maxsize=1)
def _load() -> dict[str, list[dict[str, Any]]]:
    """conceptId -> [verified fact, ...] from the latest facts.v*.jsonl. Empty when none exists
    (the gate then no-ops — a missing fact base never blocks a serve)."""
    idx: dict[str, list[dict[str, Any]]] = {}
    d = _factbase_dir()
    if not d or not d.is_dir():
        return idx
    files = sorted(d.glob("facts.v*.jsonl"))  # ponytail: v1..v9 sort lexically; revisit at v10
    if not files:
        return idx
    for line in files[-1].read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            fact = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(fact, dict) or fact.get("confidence") != "verified":
            continue
        cid = fact.get("conceptId")
        if isinstance(cid, str) and cid:
            check = _derive_check(fact)
            if check is not None:
                fact["check"] = check
            idx.setdefault(cid, []).append(fact)
    return idx


def resolve_concept(conceptId: str) -> str | None:
    """The fact-base key for a runtime concept-id, or ``None`` when the base holds none.

    The base is keyed by the catalog's chapter and topic NAMES (``motion``,
    ``constitutional-design``); the runtime resolves a learner's request to the topic label they
    were shown, which is longer (``motion-distance-displacement-speed-velocity-and-their-graphs``,
    ``constitutional-design-how-the-indian-constitution-was-made``). The two were never equal, so
    every lookup returned nothing however the subject gate was spelled.

    The rule is an exact match, else the LONGEST fact-base key that is a hyphen-boundary prefix
    of the concept — a boundary, not a substring, so ``emotions-in-poetry`` can never resolve to
    a key ``emotion``. Longest wins so a topic beats the chapter that contains it.
    """
    slug = _slug(conceptId)
    idx = _load()
    if slug in idx:
        return slug
    prefixes = [key for key in idx if slug.startswith(f"{key}-")]
    return max(prefixes, key=len) if prefixes else None


def _facts(conceptId: str) -> list[dict[str, Any]]:
    key = resolve_concept(conceptId)
    return _load().get(key, []) if key else []


def _all_text(obj: Any) -> str:
    """Every string anywhere in the artifact, joined — the surface the content asserts to a
    learner."""
    out: list[str] = []

    def walk(o: Any) -> None:
        if isinstance(o, str):
            out.append(o)
        elif isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(obj)
    return " ".join(out)


def validate_claims(artifact: Any, conceptId: str) -> list[str]:
    """Deterministic contradictions between ``artifact`` and the verified fact base for this
    concept.
    Empty list = nothing proven wrong (the common case). Each string is a human-readable
    contradiction the gate hands to the judge and records on provenance."""
    facts = _facts(conceptId)
    if not facts:
        return []
    text = _all_text(artifact)
    low = text.lower()
    out: list[str] = []
    for fact in facts:
        check = fact.get("check")
        if not isinstance(check, dict) or (check.get("kind") or "year") != "year":
            continue
        entity = str(check.get("entity") or "").strip()
        value = str(check.get("value") or "").strip()
        if not entity or not value:
            continue
        el = entity.lower()
        start = 0
        while True:
            i = low.find(el, start)
            if i < 0:
                break
            start = i + len(el)
            window = text[max(0, i - _WINDOW) : i + len(entity) + _WINDOW]
            years = set(_YEAR_RE.findall(window))
            if years and value not in years:
                out.append(
                    f"fact-base contradiction: NCERT records {entity} -> {value}, but the content "
                    f"states {sorted(years)} beside it (verified claim: {fact.get('claim')})"
                )
                break  # one contradiction per fact is enough to fail correctness
    return out


def facts_for(conceptId: str) -> list[str]:
    """The verified claims for a concept — ground truth for the LLM judge. Empty when none exist."""
    return [f.get("claim", "") for f in _facts(conceptId) if f.get("claim")]


if __name__ == "__main__":  # runnable self-check — no framework, no network
    import tempfile

    _d = tempfile.mkdtemp()
    os.environ["FACTBASE_DIR"] = _d
    Path(_d, "facts.v1.jsonl").write_text(
        json.dumps({
            "id": "a", "conceptId": "nationalism-in-india",
            "claim": "The Dandi March began in 1930.", "kind": "date", "subject": "social",
            "confidence": "verified",
            "check": {"entity": "Dandi March", "value": "1930", "kind": "year"},
        }) + "\n"
        # an unverified fact must never load into the queryable base
        + json.dumps({
            "id": "b", "conceptId": "nationalism-in-india", "claim": "unverified noise",
            "kind": "date", "subject": "social", "confidence": "unverified",
        }) + "\n",
        encoding="utf-8",
    )
    _load.cache_clear()

    _bad = {"cards": [{"prose": "The Dandi March of 1929 was led by Gandhi."}]}
    _good = {"cards": [{"prose": "The Dandi March began in 1930."}]}
    _silent = {"cards": [{"prose": "The Dandi March was a famous salt protest led by Gandhi."}]}
    assert validate_claims(_bad, "Nationalism in India"), "wrong year must flag"
    assert not validate_claims(_good, "Nationalism in India"), "correct year must not flag"
    assert not validate_claims(
        _silent, "nationalism-in-india"
    ), "absent year must not flag (fail-open)"
    assert not validate_claims(_bad, "some math topic"), "unknown concept must no-op"
    assert facts_for("Nationalism in India") == [
        "The Dandi March began in 1930."
    ], facts_for("Nationalism in India")

    # the runtime concept-id is longer than the key the base holds — it must still resolve
    _runtime = "nationalism in India: from non-cooperation to civil disobedience"
    assert resolve_concept(_slug(_runtime)) == "nationalism-in-india"
    assert facts_for(_runtime) == ["The Dandi March began in 1930."]
    assert resolve_concept("nationalism-in-indian-cinema-and-its-critics") is None

    # every subject the product teaches, however the board spells it
    assert covers("Science") and covers("Social Science") and covers("Biology")
    assert covers("Physics") and covers("Chemistry") and covers("Mathematics")
    assert not covers("") and not covers(None)
    print("factcheck self-check ok")
