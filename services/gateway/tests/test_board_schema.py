"""The generated mirror of the board grammar.

`packages/wobo/src/board/schema.ts` is the single source of truth for what Wobo may draw;
`wobo_gateway.board_schema` is generated from it so the brain validates exactly what the hand
can render. These tests are about the mirror itself: that it carries the whole vocabulary, that its
validator actually rejects, and that the verified-number law holds on this side too.
"""

from __future__ import annotations

from typing import Any

from wobo_gateway import board_schema as mirror

CIRCLE: dict[str, Any] = {"id": "v1", "kind": "circle", "anchor": {"target": "next-button"}}


def test_the_whole_vocabulary_crossed_over() -> None:
    assert len(mirror.OBJECT_KINDS) == 32  # 28, plus ring, tick, cross and note (docs/INK-FREEZE-PLAN-TRACE.md §3)
    assert set(mirror.MARK_KINDS) >= {"point", "circle", "underline", "arrow", "write", "wipe"}
    assert set(mirror.SHAPE_KINDS) >= {"axis", "tex", "bond", "atom", "region", "image"}
    assert set(mirror.CONTROL_KINDS) == {"slider", "toggle", "input", "drag"}
    assert set(mirror.PATCH_KINDS) == {"fade", "remove", "redraw", "repoint", "move", "restyle"}
    assert list(mirror.INK_ROLES) == ["wobo", "accent", "learner", "faint"]
    assert list(mirror.PRESENTATIONS) == ["screen", "plane", "full"]
    assert mirror.BOARD_UNITS == 1000


def test_all_four_anchor_forms_are_accepted() -> None:
    for anchor in (
        {"target": "next-button"},
        {"object": "v1", "at": "top"},
        {"focus": "f3"},
        {"board": [120, 400]},
    ):
        assert mirror.is_valid_object({"id": "a", "kind": "circle", "anchor": anchor}), anchor


def test_nothing_is_placed_by_pixels() -> None:
    assert not mirror.is_valid_object({"id": "a", "kind": "circle"})
    assert not mirror.is_valid_object({"id": "a", "kind": "circle", "anchor": {"x": 4, "y": 9}})


def test_the_validator_says_what_is_wrong() -> None:
    errors = mirror.validate(
        {"id": "a", "kind": "sparkle", "anchor": {"board": [0, 0]}}, mirror.BOARD_OBJECT_SCHEMA
    )
    assert errors
    assert "matched no variant" in errors[0]


def test_a_style_is_a_role_never_a_colour() -> None:
    assert not mirror.is_valid_object({**CIRCLE, "style": {"ink": "#ff0000"}})
    assert mirror.is_valid_object({**CIRCLE, "style": {"ink": "accent", "weight": 2}})
    assert not mirror.is_valid_object({**CIRCLE, "style": {"weight": 9}})


def test_a_number_is_drawn_only_when_the_verifier_passed_it() -> None:
    number = {
        "id": "n1",
        "kind": "number",
        "anchor": {"board": [10, 10]},
        "value": 25,
        "verified": False,
    }
    assert mirror.is_valid_object(number)  # well-formed grammar...
    assert not mirror.is_drawable(number)  # ...but not drawable
    assert mirror.is_drawable({**number, "verified": True})
    assert mirror.is_drawable({**number, "verified": True, "check": "cas.solution_satisfies"})
    # A number with no verification at all is not even well-formed.
    assert not mirror.is_valid_object({k: v for k, v in number.items() if k != "verified"})


def test_an_unverified_quantity_never_reaches_the_hand() -> None:
    plan = [
        {"type": "say", "text": "Sixteen and nine make twenty-five."},
        {
            "type": "ink",
            "object": {
                "id": "n",
                "kind": "number",
                "anchor": {"board": [0, 0]},
                "value": 25,
                "verified": False,
            },
        },
        {"type": "ink", "object": CIRCLE},
        {"type": "done"},
    ]
    kept = mirror.refuse_unverified(plan)
    assert [event["type"] for event in kept] == ["say", "ink", "done"]
    assert kept[1]["object"]["id"] == "v1"


def test_the_streaming_protocol_round_trips() -> None:
    stream = [
        {"type": "say", "text": "At the top, the ball is still moving.", "t": 0},
        {
            "type": "ink",
            "object": {"id": "p3", "kind": "point", "anchor": {"target": "apex"}},
            "t": 180,
        },
        {"type": "ask", "prompt": "Where is it moving fastest?", "targets": ["p3", "p7"]},
        {"type": "action", "name": "navigate", "needs": "permission"},
        {"type": "card", "id": "c1", "title": "projectiles"},
        {"type": "done", "interruptedAt": "p3"},
    ]
    assert len(mirror.parse_board_plan(stream)) == len(stream)


def test_one_bad_frame_never_kills_the_turn() -> None:
    plan = mirror.parse_board_plan(
        [
            {"type": "say", "text": "one"},
            {"type": "ink", "object": {"id": "x", "kind": "nope", "anchor": {"board": [0, 0]}}},
            "not even an object",
            {"type": "done"},
        ]
    )
    assert [event["type"] for event in plan] == ["say", "done"]
    assert mirror.parse_board_plan(None) == []


def test_a_patch_refers_to_something_already_drawn() -> None:
    assert not mirror.validate({"id": "v1", "kind": "fade"}, mirror.BOARD_PATCH_SCHEMA)
    assert not mirror.validate(
        {"id": "v1", "kind": "move", "anchor": {"board": [10, 10]}}, mirror.BOARD_PATCH_SCHEMA
    )
    assert mirror.validate({"id": "v1", "kind": "move"}, mirror.BOARD_PATCH_SCHEMA)
    assert mirror.validate({"kind": "fade"}, mirror.BOARD_PATCH_SCHEMA)


def test_a_plan_has_a_ceiling() -> None:
    assert mirror.BOARD_PLAN_SCHEMA["maxItems"] == 600
