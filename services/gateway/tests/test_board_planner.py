"""The board grammar and the planner — the four laws BOARD.md §11 says kill the board.

Nothing placed by pixels. No number the model wrote. Nothing that floats. Not more than one board.
"""

from __future__ import annotations

import pytest
from wobo_gateway.board import schema
from wobo_gateway.board.planner import (
    MAX_OBJECTS,
    Surface,
    TooMuchAtOnce,
    choose_presentation,
    is_lesson,
    plan_board,
)

TARGETS = {"targets": [{"id": "step-2", "kind": "text", "label": "2x = 4"}]}


def mark(obj_id: str, **over: object) -> dict:
    return {"id": obj_id, "kind": "circle", "anchor": {"target": "step-2"}, **over}


# --- the grammar ------------------------------------------------------------------------
def test_an_anchor_is_one_of_the_four_forms() -> None:
    assert not schema.validate_anchor({"target": "step-2"})
    assert not schema.validate_anchor({"object": "v1", "at": "top"})
    assert not schema.validate_anchor({"focus": "f1"})
    assert not schema.validate_anchor({"board": [500, 500]})
    assert schema.validate_anchor({"target": "a", "board": [1, 1]})  # never two forms
    assert schema.validate_anchor({})


def test_pixels_are_not_an_anchor() -> None:
    assert schema.validate_anchor({"x": 120, "y": 240})
    assert schema.validate_anchor({"board": [1200, 40]})  # outside the 1000-unit square
    assert schema.validate_object({"id": "v1", "kind": "circle", "anchor": {"px": [10, 10]}})


def test_a_number_must_name_the_check_that_verified_it() -> None:
    unsigned = {"id": "n1", "kind": "write", "anchor": {"board": [10, 10]}, "text": "x = 4.9"}
    problems = schema.validate_object(unsigned)
    assert any("check" in p for p in problems)
    assert not schema.validate_object({**unsigned, "check": "cas.step_chain"})
    # Text with no numeral in it needs nothing.
    assert not schema.validate_object(
        {"id": "n2", "kind": "write", "anchor": {"board": [10, 10]}, "text": "undo the plus"}
    )


def test_an_unknown_kind_is_not_in_the_grammar() -> None:
    assert schema.validate_object({"id": "v1", "kind": "sparkle", "anchor": {"board": [1, 1]}})


def test_the_json_schema_view_matches_the_vocabulary() -> None:
    view = schema.json_schema()
    assert set(view["properties"]["kind"]["enum"]) == set(schema.OBJECT_KINDS)
    assert set(view["$defs"]["kinds"]) == set(schema.OBJECT_KINDS)


# --- anchoring against the registry snapshot ---------------------------------------------
def test_a_mark_pointing_at_a_target_that_is_not_there_is_refused() -> None:
    plan = plan_board({"objects": [mark("m1", anchor={"target": "gone"})]}, context=TARGETS)
    assert plan.objects == []
    assert any("no target" in r for r in plan.refusals)


def test_a_mark_pointing_at_a_real_target_is_kept() -> None:
    plan = plan_board({"objects": [mark("m1")]}, context=TARGETS)
    assert [o["id"] for o in plan.objects] == ["m1"]


def test_a_shape_whose_target_vanished_is_re_anchored_to_board_space_never_floated() -> None:
    shape = {"id": "s1", "kind": "ellipse", "anchor": {"target": "gone"}, "rx": 10, "ry": 10}
    plan = plan_board({"objects": [shape]}, context=TARGETS)
    assert len(plan.objects) == 1
    assert "board" in plan.objects[0]["anchor"]
    assert any("re-anchored" in r for r in plan.refusals)


def test_an_object_anchor_may_name_something_already_on_the_board() -> None:
    obj = {"id": "m1", "kind": "underline", "anchor": {"object": "v1"}}
    assert plan_board({"objects": [obj]}, context=TARGETS).objects == []
    kept = plan_board({"objects": [obj]}, context=TARGETS, board_context={"drawn": ["v1"]}).objects
    assert [o["id"] for o in kept] == ["m1"]


# --- no number the model wrote ------------------------------------------------------------
def test_a_model_object_naming_a_check_that_did_not_run_is_refused() -> None:
    forged = {
        "id": "n1",
        "kind": "write",
        "anchor": {"target": "step-2"},
        "text": "x = 4.9",
        "check": "cas.step_chain",
    }
    plan = plan_board({"objects": [forged]}, context=TARGETS)
    assert plan.objects == []
    assert any("did not run" in r for r in plan.refusals)


def test_a_pipeline_number_carries_a_check_that_really_ran() -> None:
    plan = plan_board(
        {"intents": [{"pipeline": "math", "op": "graph", "expr": "x**2", "tangent_at": 1}]}
    )
    numbers = [o for o in plan.objects if o["kind"] == "number"]
    assert numbers
    ran = {c.name for c in plan.ledger.checks}
    assert all(o["check"] in ran for o in numbers)


# --- redraw once, then refuse --------------------------------------------------------------
def test_a_failed_check_redraws_the_simpler_board_once() -> None:
    # The tangent is off the graph, so the tangent cannot be drawn — but the curve still can.
    plan = plan_board(
        {
            "intents": [
                {
                    "pipeline": "math",
                    "op": "graph",
                    "expr": "x**2",
                    "domain": [-1, 1],
                    "tangent_at": 40,
                }
            ]
        }
    )
    kinds = {o["kind"] for o in plan.objects}
    assert "curve" in kinds
    assert "line" not in kinds  # the unverifiable part is gone, the board is not


def test_a_board_that_fails_twice_is_refused_and_never_served() -> None:
    plan = plan_board({"intents": [{"pipeline": "chemistry", "op": "molecule", "smiles": "C1CCC"}]})
    assert plan.objects == []
    assert plan.refusals


# --- one board at a time ---------------------------------------------------------------------
def test_more_than_one_board_is_refused_as_too_much_at_once() -> None:
    objects = [mark(f"m{i}") for i in range(MAX_OBJECTS + 1)]
    with pytest.raises(TooMuchAtOnce):
        plan_board({"objects": objects}, context=TARGETS)


def test_two_objects_may_not_claim_one_id() -> None:
    plan = plan_board({"objects": [mark("m1"), mark("m1")]}, context=TARGETS)
    assert len(plan.objects) == 1
    assert any("claim this id" in r for r in plan.refusals)


# --- the three presentations -----------------------------------------------------------------
def test_a_pointer_stays_on_the_screen() -> None:
    plan = plan_board({"objects": [mark("m1")]}, context=TARGETS)
    assert plan.presentation == "screen"


def test_a_diagram_from_scratch_gets_the_plane() -> None:
    plan = plan_board({"intents": [{"pipeline": "math", "op": "graph", "expr": "x**2"}]})
    assert plan.presentation == "plane"


def test_a_lesson_gets_the_full_board() -> None:
    plan = plan_board(
        {"objects": [mark("m1")]},
        context={**TARGETS, "page": {"route": "/course/atoms"}},
    )
    assert plan.presentation == "full"


def test_the_bare_route_the_client_publishes_is_a_lesson() -> None:
    """`context-bus.tsx` publishes `page.route` as a bare word — "course", not "/course/atoms" —
    and the web app's own `isLessonRoute` reads exactly that. Matching only on "/course" meant no
    route the client actually sends was ever a lesson."""
    plan = plan_board(
        {"objects": [mark("m1")]},
        context={**TARGETS, "page": {"route": "course"}},
    )
    assert plan.presentation == "full"

    assert is_lesson({"page": {"route": "course"}}, {}) is True
    assert is_lesson({"page": {"route": "sandbox"}}, {}) is True
    assert is_lesson({"page": {"route": "Course"}}, {}) is True
    assert is_lesson({"page": {"route": "/course/atoms"}}, {}) is True
    assert is_lesson({"page": {"route": "home"}}, {}) is False
    assert is_lesson({}, {}) is False
    # The conductor's own flag still wins, whatever the route says.
    assert is_lesson({"page": {"route": "home"}}, {"lesson": True}) is True


def test_the_learner_word_overrides_wobos_rule() -> None:
    plan = plan_board(
        {"objects": [mark("m1")], "presentation": "screen"},
        context={**TARGETS, "page": {"route": "/course/atoms"}},
        board_context={"presentation": "plane"},
    )
    assert plan.presentation == "plane"
    assert choose_presentation([], Surface(lesson=True), None) == "full"


# --- order and timing --------------------------------------------------------------------------
def test_the_computed_geometry_is_drawn_before_wobos_marks_over_it() -> None:
    plan = plan_board(
        {
            "intents": [{"pipeline": "math", "op": "graph", "expr": "x**2"}],
            "objects": [mark("m1")],
        },
        context=TARGETS,
    )
    assert plan.objects[-1]["id"] == "m1"
    starts = [o["t"]["start"] for o in plan.objects]
    assert starts == sorted(starts)
    assert starts[0] == 0


def test_an_interrupted_turn_is_carried_into_the_next_plan() -> None:
    plan = plan_board(
        {"objects": [mark("m1")]},
        context=TARGETS,
        board_context={"interrupted_at": "v3", "drawn": ["v1", "v2", "v3"]},
    )
    assert plan.resumes_from == "v3"
    assert plan.as_dict()["resumes_from"] == "v3"


def test_an_ask_only_names_targets_that_exist() -> None:
    plan = plan_board(
        {
            "objects": [mark("m1")],
            "ask": {"prompt": "Which side does it move to?", "targets": ["m1", "ghost"]},
        },
        context=TARGETS,
    )
    assert plan.ask == {"prompt": "Which side does it move to?", "targets": ["m1"]}


# --- reconciliation with the hand's grammar -----------------------------------------------
def test_the_brain_validates_against_the_generated_mirror() -> None:
    """`packages/wobo/src/board/schema.ts` is the source of truth; the generated Python mirror is
    what this module validates against. If the two ever drift, this fails rather than a learner
    seeing an object the hand cannot draw."""
    from wobo_gateway import board_schema

    assert list(schema.OBJECT_KINDS) == list(board_schema.OBJECT_KINDS)
    assert list(schema.PATCH_KINDS) == list(board_schema.PATCH_KINDS)
    assert list(schema.INK_STYLES) == list(board_schema.INK_ROLES)
    assert list(schema.PRESENTATIONS) == list(board_schema.PRESENTATIONS)
    assert schema.BOARD_UNITS == board_schema.BOARD_UNITS

    generated = schema._fields_from(board_schema.BOARD_OBJECT_SCHEMA)
    assert set(generated) == set(schema.OBJECT_KINDS)
    for kind, (required, _optional) in generated.items():
        assert set(schema._FIELDS[kind][0]) == set(required), kind


def test_a_patch_changes_something_that_is_already_drawn() -> None:
    assert not schema.validate_patch({"id": "v1", "kind": "fade"})
    assert not schema.validate_patch({"id": "v1", "kind": "move", "anchor": {"board": [10, 10]}})
    assert schema.validate_patch({"id": "v1", "kind": "move"})  # a move with nowhere to move to
    assert schema.validate_patch({"kind": "fade"})  # a patch with nothing to change
    assert schema.validate_patch({"id": "v1", "kind": "circle"})  # not a patch kind


def test_a_number_is_drawn_only_when_it_is_verified() -> None:
    signed = {
        "id": "n1",
        "kind": "number",
        "anchor": {"board": [10, 10]},
        "value": 4.9,
        "verified": True,
        "check": "cas.solution_satisfies",
    }
    assert not schema.validate_object(signed)
    assert schema.validate_object({**signed, "verified": False})
    assert schema.validate_object({k: v for k, v in signed.items() if k != "check"})


def test_an_arrow_points_at_its_anchor() -> None:
    arrow = {
        "id": "a1",
        "kind": "arrow",
        "anchor": {"target": "step-2"},
        "from": {"board": [10, 10]},
    }
    assert not schema.validate_object(arrow)
    # The tail may vanish; the head may not — the head is what the arrow is about.
    plan = plan_board({"objects": [{**arrow, "from": {"target": "gone"}}]}, context=TARGETS)
    assert plan.objects == []


# --- the senses' packet is where the screen and the focus actually live ------------------
def test_the_surface_reads_the_focus_out_of_the_senses_packet() -> None:
    """The gesture layer mints a focus object and the client sends it at ``context.packet.focus``
    (``packages/wobo/src/packet.ts``). Reading only ``context.focus`` meant the brain never saw a
    gesture at all, so every mark anchored to the thing the learner circled was refused — which is
    the whole video case in BOARD.md §5.
    """
    surface = Surface.from_context(
        {"packet": {"v": 1, "focus": {"id": "f3", "kind": "lasso", "text": "the paused frame"}}},
        {},
    )
    assert "f3" in surface.focuses


def test_the_surface_reads_the_registry_snapshot_as_well_as_the_bus_list() -> None:
    """Two lists describe the same screen: the scene bus's ``context.targets`` and the surface
    registry's snapshot inside the packet. An anchor may name a target from either."""
    surface = Surface.from_context(
        {
            "targets": [{"id": "bus-target", "kind": "card", "label": "a card"}],
            "packet": {
                "v": 1,
                "screen": {
                    "v": 1,
                    "surfaces": [
                        {
                            "id": "video",
                            "title": "a paused film",
                            "targets": [{"id": "video:frame", "kind": "frame", "label": "frame"}],
                        }
                    ],
                },
            },
        },
        {},
    )
    assert {"bus-target", "video:frame"} <= surface.targets


def test_a_mark_on_the_circled_region_is_drawn_when_the_packet_carries_that_focus() -> None:
    plan = plan_board(
        {
            "say": "This part.",
            "objects": [
                {"id": "f1ring", "kind": "circle", "anchor": {"focus": "f9"}, "pad": 10},
            ],
        },
        context={"packet": {"v": 1, "focus": {"id": "f9", "kind": "lasso", "text": "the frame"}}},
        board_context={},
    )
    assert [o["id"] for o in plan.objects] == ["f1ring"]
    assert not plan.refusals


def test_a_mark_on_a_region_nobody_circled_is_still_refused() -> None:
    plan = plan_board(
        {"say": "", "objects": [{"id": "f1ring", "kind": "circle", "anchor": {"focus": "ghost"}}]},
        context={"packet": {"v": 1, "focus": {"id": "f9"}}},
        board_context={},
    )
    assert plan.objects == []
    assert plan.refusals


# --- the ink decides the surface (the owner, 2026-09-05: "wobo doesn't have to draw every
# single time on the board") ------------------------------------------------------------------
def test_a_model_that_asks_for_the_plane_is_overruled_when_every_mark_is_on_the_screen() -> None:
    """The failure this exists to catch: every drawn answer opened the board, because the model
    wrote "plane" out of habit and the planner took its word. A mark about something already on
    the learner's screen is drawn there, whatever the model called the surface."""
    plan = plan_board(
        {"objects": [mark("m1"), mark("m2", kind="underline")], "presentation": "plane"},
        context=TARGETS,
    )
    assert plan.presentation == "screen"


def test_an_empty_plan_never_opens_an_empty_board() -> None:
    plan = plan_board({"objects": [], "presentation": "plane"})
    assert plan.objects == []
    assert plan.presentation == "screen"


def test_a_mark_hung_off_a_screen_mark_stays_on_the_screen_with_it() -> None:
    """`{object: m1}` where m1 is on a chip: the note lives where the ring lives."""
    plan = plan_board(
        {
            "objects": [
                mark("m1"),
                {"id": "m2", "kind": "write", "anchor": {"object": "m1", "at": "bottom"}, "text": "here"},
            ]
        },
        context=TARGETS,
    )
    assert plan.presentation == "screen"


def test_more_than_three_marks_on_the_screen_is_still_the_screen() -> None:
    """A mark about something on the page cannot leave the page (presentation.ts, `staysOnScreen`):
    on a board it would point at nothing. So there is no count past which they move."""
    plan = plan_board({"objects": [mark(f"m{i}") for i in range(6)]}, context=TARGETS)
    assert plan.presentation == "screen"


def test_something_new_to_build_opens_the_plane_whatever_the_model_called_it() -> None:
    plan = plan_board(
        {"intents": [{"pipeline": "math", "op": "graph", "expr": "x**2"}], "presentation": "screen"},
        context=TARGETS,
    )
    assert plan.presentation == "plane"


def test_a_mark_on_a_previous_board_object_belongs_to_the_board() -> None:
    plan = plan_board(
        {"objects": [{"id": "m1", "kind": "circle", "anchor": {"object": "curve-1"}}]},
        context=TARGETS,
        board_context={"drawn": ["curve-1"]},
    )
    assert plan.presentation == "plane"


def test_a_label_hung_on_a_chip_is_on_the_screen_with_the_chip() -> None:
    """The anchor decides, not the kind: the live harness drew a ring plus a label on the
    hypotenuse chip and the planner sent the pair to the plane because `label` is a shape."""
    plan = plan_board(
        {
            "objects": [
                mark("m1"),
                {"id": "m2", "kind": "label", "anchor": {"target": "step-2"}, "text": "here"},
            ]
        },
        context=TARGETS,
    )
    assert plan.presentation == "screen"
