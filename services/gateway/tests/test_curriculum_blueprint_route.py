"""THE POOL HAS TO REACH THE CLIENT, OR THE LEARNING MODEL IS A DOCUMENT.

docs/LEARNING-MODEL.md is what this wave was told governs it: chapters and topics come from the
board and say WHAT must be learned; MODULES are ours, they live in the CHAPTER'S POOL, and a GROUP
of them teaches a topic, chosen per learner and costing nothing because it is a selection.

The architect that builds a pool was built (``plexus/blueprint.py``), and the client that walks one
was built (``curriculum/blueprint.ts``: ``groupFor``, ``blueprintWalk``, ``groundUnder``). Nothing
joined them: no route served a blueprint, no client asked for one, and ``placement.ts``'s whole
"THE ARCHITECT FIRST" branch sat behind a ``sources.assumptions`` parameter that no caller passed.

So this is the seam, with the two rules the curriculum file already lives by:

* **nothing here calls a model.** A blueprint is READ. A cell that has none answers "none", and
  the client falls back to the derived prerequisite graph exactly as it does today.
* **a HELD blueprint is never served.** A refused pool exists so a person can read what the judge
  refused, not so a learner can be handed it.
"""

from __future__ import annotations

from typing import Any

import pytest
from wobo_gateway.curriculum import api as curriculum_api
from wobo_gateway.plexus import blueprint as bp_mod

BRIEF: dict[str, Any] = {
    "node": "node-fractions",
    "chapter": "Fractions",
    "board": "CBSE",
    "grade": "6",
    "subject": "Mathematics",
    "contentVersion": "2026-27",
    "topics": [{"id": "t1", "name": "Equivalent fractions"}],
}


@pytest.fixture(autouse=True)
def _cache(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))


def _call(payload: dict[str, Any]) -> dict[str, Any]:
    return curriculum_api.handle("curriculum.blueprint", payload, subject="learner-1")


def test_the_capability_is_one_of_the_curriculum_doors() -> None:
    assert "curriculum.blueprint" in curriculum_api.CAPABILITIES


def test_a_cell_with_no_pool_answers_none_and_never_builds_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A missing pool is an ordinary answer. The client's derived ground still stands."""

    def never(*a: Any, **k: Any) -> None:
        raise AssertionError("a read asked the architect to build a pool")

    monkeypatch.setattr(bp_mod, "build", never)
    out = _call(BRIEF)
    assert out["blueprint"] is None
    assert out["held"] == 0


def test_a_stored_pool_is_served_with_the_ground_under_each_topic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from blueprint_fixture import blueprint

    stored = blueprint()
    monkeypatch.setattr(bp_mod, "load", lambda brief: bp_mod.parse(stored))
    out = _call(BRIEF)
    assert out["blueprint"] is not None
    assert out["blueprint"]["modules"], "a pool with no modules is not a pool"


def test_a_brief_that_is_not_a_cell_is_refused_in_wobos_voice() -> None:
    with pytest.raises(curriculum_api.CurriculumError) as caught:
        _call({**BRIEF, "topics": []})
    assert caught.value.status == 400
    assert caught.value.message
