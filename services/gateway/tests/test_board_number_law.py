"""The verified-number law, in both places a model could get round it (docs/BOARD.md §6, §11).

"A number the model wrote instead of the code computing it" is one of the five things BOARD.md says
kills the board. Two holes were open in this wave:

1. The law read a hard-coded list of five field names. A ``table``'s numbers live in ``rows``, and
   the hand writes every cell through ``writeText``, glyph by glyph, exactly like a label — so a
   model-authored gravity table walked straight past a law that refused the identical text in a
   ``label``.
2. ``plan_board`` allowed the check name ``board.frame`` on every turn whether or not anything ran,
   which made it a universal laundering token: name it, and any numeral reached the board.
"""

from __future__ import annotations

from typing import Any

from wobo_gateway.board import schema
from wobo_gateway.board.planner import plan_board

GRAVITY_ROWS = [["body", "gravity"], ["Mercury", "3.71 m/s2"], ["Venus", "24.79 m/s2"]]


def _table(**extra: Any) -> dict[str, Any]:
    return {
        "id": "tally",
        "kind": "table",
        "anchor": {"board": [200, 300]},
        "w": 400,
        "rows": GRAVITY_ROWS,
        **extra,
    }


def test_a_table_cell_is_visible_text_like_any_other() -> None:
    assert schema.validate_object(_table()) == [
        "an object showing a number must name the check that verified it (check: ...)"
    ]
    assert schema.validate_object(_table(check="board.numbers_agree:gravity")) == []


def test_a_table_with_no_numerals_needs_no_check() -> None:
    assert (
        schema.validate_object(
            {
                "id": "t",
                "kind": "table",
                "anchor": {"board": [200, 300]},
                "w": 400,
                "rows": [["kingdom", "example"], ["fungi", "a mushroom"]],
            }
        )
        == []
    )


def test_a_grids_row_count_is_a_ruler_not_a_claim() -> None:
    """``grid.rows`` and ``table.rows`` share a name and mean different things, so the
    classification is per kind — ruling eight rows does not demand a verifier."""
    assert (
        schema.validate_object(
            {
                "id": "g",
                "kind": "grid",
                "anchor": {"board": [120, 120]},
                "cols": 10,
                "rows": 8,
                "w": 760,
                "h": 700,
            }
        )
        == []
    )


def test_a_controls_own_value_is_the_learners_hand_not_wobos_claim() -> None:
    """The third hole, and the one that made a whole kind unusable.

    ``value`` was classified once, for every kind at once. On a ``number`` or a label it is a
    quantity Wobo asserts and the law is right to demand the check that signed it. On a CONTROL
    it is where the knob sits — the state of a variable the learner is about to change with their
    thumb, which no verifier could sign and which ``geometry.ts`` never writes as glyphs. So
    every slider Wobo could draw was refused for showing a numeral it does not show, and the
    interactive board could not be streamed at all.
    """
    slider = {
        "id": "x-handle",
        "kind": "slider",
        "anchor": {"board": [290, 590]},
        "variable": "a",
        "min": 0.4,
        "max": 2.6,
        "value": 1.5,
        "step": 0.1,
        "w": 420,
        "label": "x",
    }
    assert schema.validate_object(slider) == []
    assert "1.5" not in schema.visible_text(slider)
    # a toggle's value is which end the knob rests at; a drag's is a handle offset
    assert (
        schema.validate_object(
            {
                "id": "t",
                "kind": "toggle",
                "anchor": {"board": [10, 10]},
                "variable": "b",
                "value": 1,
            }
        )
        == []
    )
    assert (
        schema.validate_object(
            {
                "id": "d",
                "kind": "drag",
                "anchor": {"board": [10, 10]},
                "variable": "c",
                "value": [12, 40],
            }
        )
        == []
    )


def test_the_law_still_holds_on_the_one_control_that_is_written_out() -> None:
    """``input.value`` is the exception that proves the rule: geometry DOES send it through
    ``writeText``, so a numeral in it is a numeral on the board and still needs its check."""
    typed = {
        "id": "answer",
        "kind": "input",
        "anchor": {"board": [10, 10]},
        "variable": "n",
        "value": "42",
    }
    assert schema.validate_object(typed) == [
        "an object showing a number must name the check that verified it (check: ...)"
    ]
    assert schema.validate_object({**typed, "check": "board.numbers_agree:the count"}) == []


def test_a_number_still_cannot_hide_in_a_sliders_label() -> None:
    """The relaxation is the control's own state and nothing else — the label beside it is
    handwriting like any other, and a numeral there is still a claim under the law."""
    problems = schema.validate_object(
        {
            "id": "x-handle",
            "kind": "slider",
            "anchor": {"board": [290, 590]},
            "variable": "a",
            "min": 0,
            "max": 3,
            "value": 1.5,
            "label": "x = 1.5",
        }
    )
    assert problems == [
        "an object showing a number must name the check that verified it (check: ...)"
    ]


def test_every_board_field_is_classified_as_visible_or_not() -> None:
    """A new field on a kind must be answered for, or the law quietly forgets it again."""
    unclassified = {
        name
        for required, optional in schema._FIELDS.values()
        for name in (*required, *optional)
        if name not in schema._VISIBLE_BY_NAME
    }
    assert unclassified == set(), f"classify these in _VISIBLE_BY_NAME: {sorted(unclassified)}"


def test_a_model_authored_table_of_numbers_never_reaches_the_board() -> None:
    plan = plan_board({"say": "here they are", "objects": [_table()]})
    assert plan.objects == []
    assert plan.refusals and "check" in plan.refusals[0]


def test_board_frame_is_not_a_standing_licence_for_a_number() -> None:
    """Nothing ran on this turn, so no check name is allowed — least of all a general one."""
    plan = plan_board(
        {
            "say": "gravity on earth",
            "objects": [
                {
                    "id": "g",
                    "kind": "label",
                    "anchor": {"board": [400, 300]},
                    "text": "g = 42.7 m/s2 on Earth",
                    "check": "board.frame",
                }
            ],
        }
    )
    assert plan.objects == []
    assert plan.ledger.checks == []
    assert any("did not run on this turn" in r for r in plan.refusals)


def test_a_check_that_actually_ran_still_signs_its_number() -> None:
    """The law refuses what nothing verified; it never blocks what a pipeline computed."""
    plan = plan_board(
        {
            "say": "the tangent",
            "intents": [{"pipeline": "math", "op": "graph", "expr": "x**2", "domain": [-3, 3]}],
        }
    )
    ran = {c.name for c in plan.ledger.checks}
    assert ran
    for obj in plan.objects:
        if obj.get("check"):
            assert obj["check"] in ran


# --- a quoted equation is not an arithmetic claim ----------------------------------------------


def test_a_fragment_of_algebra_is_not_a_sum_the_say_is_claiming() -> None:
    """``_SUM_RUN`` stops at every letter, so "2x + 3 = 7, line by line." handed the CAS the
    fragment "+ 3 = 7", the CAS said — correctly — that it is false, and ``audit`` dropped the
    whole sentence. Any line that quotes an equation with a letter in it was unspeakable, which
    is most of the mathematics on the board (measured 2026-09-10)."""
    from wobo_gateway import spoken

    assert spoken.statements_in("2x + 3 = 7, line by line.") == []
    assert spoken.statements_in("x² + 5x + 6 = 0, line by line.") == []
    assert spoken.statements_in("(x + 3)(x + 2) = 0.") == []
    assert spoken.statements_in("y = 3x - 4 is the line.") == []


def test_a_sum_written_out_in_full_is_still_read_and_confirmed() -> None:
    """And the law it exists for is untouched: a real sum beside real words is still checked."""
    from wobo_gateway import spoken

    assert spoken.statements_in("So 9 + 16 = 25.") == ["9 + 16 = 25"]
    assert spoken.statements_in("It is 5 because 5 * 5 = 25.") == ["5 * 5 = 25"]
    assert spoken.statements_in("Halves and quarters: 1/2 = 2/4.") == ["1/2 = 2/4"]


def test_a_false_sum_beside_words_is_still_refused() -> None:
    from wobo_gateway import spoken

    decided = spoken.audit("So 9 + 16 = 26.", given=set(), verified=set())
    assert decided.say == ""
    assert decided.unsaid


def test_a_quoted_equation_is_spoken_when_its_numbers_are_the_learners() -> None:
    from wobo_gateway import spoken

    decided = spoken.audit(
        "2x + 3 = 7, line by line.", given={2.0, 3.0, 7.0}, verified=set()
    )
    assert decided.say == "2x + 3 = 7, line by line."
    assert decided.unsaid == []
