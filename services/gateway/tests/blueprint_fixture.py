"""One well-formed blueprint, as a dict a test can mutate.

Kept out of the test module so every blueprint test starts from the SAME good pool and says in
one mutation what it is testing. The content is Class 8 CBSE Science, "Force and Pressure" —
the same cell the wave's real Luna run produces, so the fixture and the live artifact can be
read side by side.
"""

from __future__ import annotations

import copy
from typing import Any


def brief() -> dict[str, Any]:
    """The architect's input: the syllabus node and nothing about any person."""
    return {
        "node": "cbse-8-science-force-and-pressure",
        "chapter": "Force and Pressure",
        "board": "CBSE",
        "grade": "8",
        "subject": "Science",
        "contentVersion": "2026-27",
        "topics": [
            {"id": "t1", "name": "Force: a push or a pull"},
            {"id": "t2", "name": "What a force can do"},
            {"id": "t3", "name": "Contact and non-contact forces"},
            {"id": "t4", "name": "Pressure"},
            {"id": "t5", "name": "Pressure in liquids and gases"},
        ],
        "minutesBudget": 200,
        "archetypes": ["the one who draws it", "the one who checks the numbers"],
    }


def _mech(prefix: str, one: str, two: str) -> list[dict[str, Any]]:
    return [
        {
            "id": f"{prefix}-m1",
            "name": one,
            "primitives": ["drag", "drop", "reveal"],
            "moves": "the block along the table",
            "responds": "the arrow under it grows with the push",
            "wrongMoveTeaches": (
                "a pull towards you is still a force, so the arrow flips rather "
                "than vanishes"
            ),
        },
        {
            "id": f"{prefix}-m2",
            "name": two,
            "primitives": ["sort", "reveal"],
            "moves": "each picture into the push bin or the pull bin",
            "responds": "the bin shows the arrow the picture really needs",
            "wrongMoveTeaches": "opening a drawer is a pull even though your hand touches it",
        },
    ]


def _module(
    mid: str,
    aim: str,
    kind: str,
    role: str,
    serves: list[str],
    teaches: list[str],
    cores: list[str],
    *,
    repairs: str | None = None,
    assumes: list[str] | None = None,
    minutes: int = 7,
) -> dict[str, Any]:
    return {
        "id": mid,
        "aim": aim,
        "kind": kind,
        "role": role,
        "serves": serves,
        "teaches": teaches,
        "cores": cores,
        "repairs": repairs,
        "assumes": assumes or [],
        "minutes": minutes,
        "mechanics": _mech(mid, "push the block", "sort the pictures"),
    }


def blueprint() -> dict[str, Any]:
    """A pool that satisfies every law in docs/LEARNING-MODEL.md section 5."""
    ideas = [
        {"id": "i1", "what": "a force is a push or a pull on an object", "topics": ["t1"]},
        {
            "id": "i2",
            "what": "two forces on a line add when they agree and subtract when they oppose",
            "topics": ["t1"],
        },
        {"id": "i3", "what": "a force can change speed, direction or shape", "topics": ["t2"]},
        {"id": "i4", "what": "some forces need touch and some act across a gap", "topics": ["t3"]},
        {
            "id": "i5",
            "what": "pressure is the force spread over the area it presses on",
            "topics": ["t4"],
        },
        {
            "id": "i6",
            "what": "a liquid presses on every wall it touches, and air presses on everything",
            "topics": ["t5"],
        },
    ]
    misconceptions = [
        {
            "id": "x1",
            "what": "a moving object must have a force pushing it along",
            "topics": ["t1", "t2"],
        },
        {
            "id": "x2",
            "what": "a heavier object always presses harder, whatever it stands on",
            "topics": ["t4"],
        },
        {"id": "x3", "what": "a liquid presses only downwards", "topics": ["t5"]},
    ]
    assumptions = [
        {
            "id": "a1",
            "what": "reading a measurement off a marked scale",
            "fromChapter": "Measurement",
        },
        {"id": "a2", "what": "area of a rectangle", "fromChapter": "Mensuration, class 7"},
    ]
    modules = [
        _module(
            "p1",
            "meet a push and a pull in the same hand",
            "simulation",
            "way_in",
            ["t1"],
            ["i1"],
            ["force"],
        ),
        _module(
            "p2",
            "draw the arrow for every push you make in a morning",
            "reading",
            "way_in",
            ["t1"],
            ["i1"],
            ["force"],
        ),
        _module(
            "p3",
            "add two arrows on a rope and watch the knot move",
            "simulation",
            "way_in",
            ["t1"],
            ["i2"],
            ["net force"],
        ),
        _module(
            "p4",
            "work out the winning side of a tug of war",
            "worked",
            "way_in",
            ["t1"],
            ["i2"],
            ["net force"],
        ),
        _module(
            "p5",
            "change a ball's speed, its path and its shape",
            "simulation",
            "way_in",
            ["t2"],
            ["i3"],
            ["effects of force"],
        ),
        _module(
            "p6",
            "sort ten photographs by what the force changed",
            "items",
            "way_in",
            ["t2"],
            ["i3"],
            ["effects of force"],
        ),
        _module(
            "p7",
            "touch or no touch: try both on the same nail",
            "simulation",
            "way_in",
            ["t3"],
            ["i4"],
            ["contact force", "field force"],
        ),
        _module(
            "p8",
            "watch a magnet and a comb work across a gap",
            "film",
            "way_in",
            ["t3"],
            ["i4"],
            ["field force"],
        ),
        _module(
            "p9",
            "stand the same brick on its side, then on its end",
            "simulation",
            "way_in",
            ["t4"],
            ["i5"],
            ["pressure"],
        ),
        _module(
            "p10",
            "work out the pressure under a school bag",
            "worked",
            "way_in",
            ["t4"],
            ["i5"],
            ["pressure"],
        ),
        _module(
            "p11",
            "punch holes down a bottle and watch the jets",
            "simulation",
            "way_in",
            ["t5"],
            ["i6"],
            ["liquid pressure"],
        ),
        _module(
            "p12",
            "read the barometer and the crushed can together",
            "film",
            "way_in",
            ["t5"],
            ["i6"],
            ["atmospheric pressure"],
        ),
        _module(
            "r1",
            "let the trolley run with nothing pushing it",
            "simulation",
            "repair",
            ["t1", "t2"],
            ["i1", "i3"],
            ["force"],
            repairs="x1",
        ),
        _module(
            "r2",
            "same weight, two areas, two dents in the sand",
            "simulation",
            "repair",
            ["t4"],
            ["i5"],
            ["pressure"],
            repairs="x2",
        ),
        _module(
            "r3",
            "turn the bottle and the jet still goes sideways",
            "simulation",
            "repair",
            ["t5"],
            ["i6"],
            ["liquid pressure"],
            repairs="x3",
        ),
        _module(
            "q1",
            "read a marked scale before you read a force",
            "worked",
            "prerequisite",
            ["t1"],
            ["i1"],
            ["reading a scale"],
            assumes=["a1"],
            minutes=5,
        ),
        _module(
            "q2",
            "find the area under a block before you press it",
            "worked",
            "prerequisite",
            ["t4"],
            ["i5"],
            ["area"],
            assumes=["a2"],
            minutes=5,
        ),
        _module(
            "s1",
            "why a camel's foot and a stiletto disagree",
            "simulation",
            "stretch",
            ["t4", "t5"],
            ["i5", "i6"],
            ["pressure"],
            minutes=9,
        ),
        _module(
            "c1",
            "twelve quick calls: push, pull, or neither",
            "items",
            "check",
            ["t1", "t2", "t3"],
            ["i1", "i3", "i4"],
            ["force"],
            minutes=6,
        ),
        _module(
            "c2",
            "six pressure numbers, units and all",
            "items",
            "check",
            ["t4", "t5"],
            ["i5", "i6"],
            ["pressure"],
            minutes=6,
        ),
        _module(
            "g1",
            "beat the clock sorting contact against non-contact",
            "game",
            "side_door",
            ["t3"],
            ["i4"],
            ["contact force"],
            minutes=5,
        ),
        _module(
            "g2",
            "keep the diver alive as the depth changes",
            "game",
            "side_door",
            ["t5"],
            ["i6"],
            ["liquid pressure"],
            minutes=5,
        ),
        _module(
            "b1",
            "one chapter, one bridge: choose the shape that holds",
            "boss",
            "boss",
            ["t1", "t2", "t3", "t4", "t5"],
            ["i1", "i2", "i3", "i4", "i5", "i6"],
            ["force", "pressure"],
            minutes=10,
        ),
    ]
    order = [
        "q1",
        "p1",
        "p2",
        "p3",
        "p4",
        "r1",
        "p5",
        "p6",
        "c1",
        "p7",
        "p8",
        "q2",
        "p9",
        "p10",
        "r2",
        "p11",
        "p12",
        "r3",
        "c2",
        "s1",
        "b1",
    ]
    return {
        "node": "cbse-8-science-force-and-pressure",
        "chapter": "Force and Pressure",
        "board": "CBSE",
        "grade": "8",
        "subject": "Science",
        "contentVersion": "2026-27",
        "thread": (
            "when something pushes or pulls, what happens next depends on how hard "
            "and on how much of it is pressing"
        ),
        "topics": [
            {"id": "t1", "name": "Force: a push or a pull"},
            {"id": "t2", "name": "What a force can do"},
            {"id": "t3", "name": "Contact and non-contact forces"},
            {"id": "t4", "name": "Pressure"},
            {"id": "t5", "name": "Pressure in liquids and gases"},
        ],
        "ideas": ideas,
        "misconceptions": misconceptions,
        "assumptions": assumptions,
        "modules": modules,
        "flow": {
            "order": order,
            "why": (
                "the arrow comes before the sum, the sum before what it changes, "
                "and the area before the pressure that needs it"
            ),
            "sideDoors": [
                {
                    "after": "p8",
                    "module": "g1",
                    "rehearses": "telling touch from a gap fast enough to be sure",
                },
                {"after": "p12", "module": "g2", "rehearses": "how pressure climbs with depth"},
            ],
            "boss": "b1",
            "bossProves": (
                "the learner picks the shape that survives the load and says which "
                "force and which area decided it"
            ),
            "skippable": ["p2", "p6", "p10"],
            "neverSkip": ["p1", "p9", "b1"],
            "stuck": [
                {
                    "module": "p3",
                    "instead": "p4",
                    "why": "the same sum with numbers on it instead of arrows",
                },
                {
                    "module": "p9",
                    "instead": "q2",
                    "why": "the area under the block is what is missing, not the pressure",
                },
            ],
        },
    }


def with_change(**_unused: Any) -> dict[str, Any]:
    return copy.deepcopy(blueprint())
