"""ONE HIT RULE, AND ONE PASS-THROUGH THAT REALLY STRIPS.

Two small things, both of the same kind: a gate that says one thing and does another.

1. **The gateway and the client refused different designs.** ``validate._hit_reasons`` checked
   HitBox against HitBox and nothing else; the client (``engines/composition/parse.ts``) refuses a
   TAP whose target mark sits within ``MIN_HIT_UNITS`` of any other mark, measured centre to
   centre. So a design the gateway paid a model for, judged, cached and served could be dropped to
   the template floor by the client, silently, on the learner's screen. The bar that costs money
   has to be the bar that renders.

2. **``_ok_perturbation`` validated a draft and returned the caller's own dict.** Every other gate
   in ``_CARD_ACTIVITIES`` builds a clean value; that one checked the shape and then handed back
   ``raw``, so any unmodelled key a model invented rode into the served course verbatim — under a
   comment claiming the verifier decides which fields survive.
"""

from __future__ import annotations

from typing import Any

from wobo_gateway.plexus import engines, specs, validate

STAGE = specs.MIN_HIT_UNITS


def _design(marks: list[dict[str, Any]], targets: list[str]) -> specs.InteractionDesign:
    return specs.InteractionDesign.model_validate(
        {
            "id": "d1",
            "concept": "the parts of a plant cell",
            "kind": "discriminate",
            "mechanic": "tap the part that holds the shape",
            "why": "the wall is the one that is stiff, and the tap is on the wall",
            "marks": marks,
            "steps": [
                {
                    "id": "s1",
                    "beat": "check",
                    "primitive": {
                        "kind": "tap",
                        "prompt": "tap the stiff boundary",
                        "targets": targets,
                        "need": 1,
                        "feedback": {
                            "right": "that is the wall",
                            "wrong": "the membrane is soft, the wall is the stiff one",
                        },
                    },
                }
            ],
        }
    )


def _mark(mark_id: str, x: float, y: float) -> dict[str, Any]:
    return {"id": mark_id, "shape": "circle", "x": x, "y": y, "r": 6}


def test_two_marks_a_finger_cannot_tell_apart_are_refused_here_too() -> None:
    """The client's own rule, on the side that pays for the design."""
    design = _design([_mark("wall", 20, 20), _mark("membrane", 20 + STAGE / 2, 20)], ["wall"])
    reasons = validate._finger_reasons(design)
    assert reasons, "the gateway accepted a design the client will drop"
    assert "wall" in " ".join(reasons) and "membrane" in " ".join(reasons)


def test_marks_a_finger_can_tell_apart_are_accepted() -> None:
    design = _design([_mark("wall", 10, 20), _mark("membrane", 10 + STAGE * 1.5, 20)], ["wall"])
    assert validate._finger_reasons(design) == []


def test_a_mark_that_is_not_a_target_is_still_measured_against_the_target() -> None:
    """It is the TARGET that must be tappable, so every other mark near it is the problem."""
    close = _design(
        [_mark("wall", 30, 30), _mark("label", 30, 30 + STAGE / 3), _mark("far", 80, 50)],
        ["wall"],
    )
    assert validate._finger_reasons(close)


def test_the_perturbation_gate_strips_what_it_does_not_model() -> None:
    """It returned the caller's dict. A key nobody modelled reached the client verbatim."""
    spec = {
        "id": "p1",
        "title": "break ohm",
        "law": "I = V / R",
        "param": {
            "id": "R",
            "label": "resistance",
            "min": 0,
            "max": 50,
            "from": 25,
            "unit": "Ω",
        },
        "output": {"label": "current", "expr": "12 / R", "unit": "A"},
        "breakpoint": {
            "at": 0,
            "approach": "below",
            "assumption": "wires are ideal",
            "revelation": "real wires carry internal resistance",
        },
        "onLoad": "fetch('/steal')",
        "extraNobodyModelled": {"deep": [1, 2, 3]},
    }
    out = engines._ok_perturbation(spec)
    assert out is not None
    assert "onLoad" not in out
    assert "extraNobodyModelled" not in out
    assert out["law"] == "I = V / R"
    assert out["param"]["id"] == "R"
    assert out["breakpoint"]["revelation"] == "real wires carry internal resistance"
    assert out is not spec, "the gate handed back the caller's own object"
