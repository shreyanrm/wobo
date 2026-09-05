"""The golden boards — twelve prompts across the domains, asserted on structure, not pixels.

BOARD.md §6 asks for "a regression suite of prompts with expected board outcomes (structure, not
pixels) for every pipeline". These tests assert the things that would make the board a slideshow
if they broke: the object kinds Wobo draws, what they anchor to, the order they are drawn in, and
that every number on the board names a verifier check that actually ran.
"""

from __future__ import annotations

import pytest
from wobo_gateway.board import schema
from wobo_gateway.board.pipelines import run_intent
from wobo_gateway.board.verify import Unverified
from wobo_gateway.wobo import board_intents

# prompt -> the intent the keyless brain reads out of it, and what the board must contain.
GOLDEN: list[tuple[str, dict, dict]] = [
    (
        "graph y = x^2 with the tangent at x = 1",
        {"pipeline": "math", "op": "graph", "expr": "x**2", "tangent_at": 1.0},
        {
            "kinds": {"axis", "curve", "line", "point", "number"},
            "checks": {"board.numbers_agree:tangent slope"},
        },
    ),
    (
        "draw a number line",
        {"pipeline": "math", "op": "number_line"},
        {"kinds": {"line", "axis"}, "checks": set()},
    ),
    (
        "construct the perpendicular bisector",
        {"pipeline": "math", "op": "construction"},
        {
            "kinds": {"line", "ellipse", "point"},
            "checks": {"board.numbers_agree:bisector right angle"},
        },
    ),
    (
        "solve 2*x + 3 = 7 step by step",
        {"pipeline": "math", "op": "derivation"},
        {"kinds": {"write", "underline"}, "checks": {"cas.step_chain"}},
    ),
    (
        "a ball is launched at 20 m/s at 30 degrees, draw the projectile",
        {"pipeline": "physics", "op": "projectile", "v0": 20.0, "angle_deg": 30.0},
        {
            "kinds": {"curve", "arrow", "number", "axis"},
            "checks": {"board.numbers_agree:apex height"},
        },
    ),
    (
        "show me the free body diagram for the block",
        {"pipeline": "physics", "op": "free_body"},
        {"kinds": {"arrow", "ellipse", "number"}, "checks": {"board.numbers_agree:net force"}},
    ),
    (
        "draw the circuit with the resistors",
        {"pipeline": "physics", "op": "circuit"},
        {"kinds": {"polyline", "number"}, "checks": {"board.numbers_agree:loop voltages"}},
    ),
    (
        "draw the ray diagram through the lens",
        {"pipeline": "physics", "op": "ray"},
        {"kinds": {"arrow", "ellipse", "number"}, "checks": {"cas.solution_satisfies"}},
    ),
    (
        "draw a wave and mark the wavelength",
        {"pipeline": "physics", "op": "wave"},
        {"kinds": {"curve", "bracket", "number"}, "checks": {"board.numbers_agree:wave speed"}},
    ),
    (
        "draw benzene",
        {"pipeline": "chemistry", "op": "molecule", "smiles": "c1ccccc1"},
        {"kinds": {"atom", "bond"}, "checks": {"board.smiles_valid"}},
    ),
    (
        "balance H2 + O2 -> H2O",
        {"pipeline": "chemistry", "op": "balance"},
        {"kinds": {"write", "arrow", "number"}, "checks": {"board.formula_readable"}},
    ),
    (
        "label a plant cell",
        {"pipeline": "bio_social", "op": "cell", "subject": "plant cell"},
        {"kinds": {"ellipse", "arrow", "label", "polygon"}, "checks": set()},
    ),
]


@pytest.mark.parametrize(("prompt", "expected_intent", "expected_board"), GOLDEN)
def test_golden_board(prompt: str, expected_intent: dict, expected_board: dict) -> None:
    intents = board_intents(prompt)
    assert intents, f"no intent read out of {prompt!r}"
    intent = intents[0]
    for key, value in expected_intent.items():
        assert intent.get(key) == value, f"{prompt!r}: {key} was {intent.get(key)!r}"

    draft = run_intent(intent)
    kinds = {o["kind"] for o in draft.objects}
    assert expected_board["kinds"] <= kinds, f"{prompt!r} drew {sorted(kinds)}"
    ran = {c.name for c in draft.ledger.checks}
    assert expected_board["checks"] <= ran, f"{prompt!r} ran {sorted(ran)}"

    for obj in draft.objects:
        assert not schema.validate_object(obj), (obj["id"], schema.validate_object(obj))
    # Every number on the board names a check, and that check actually ran on this board. There is
    # no standing token: `board.frame` used to be allowed unconditionally and was a way to launder
    # an unverified number onto a board, so a check earns its place by running or not at all.
    for obj in draft.objects:
        if obj.get("check"):
            assert obj["check"] in ran, obj


def test_food_web_arrows_point_up_the_levels() -> None:
    draft = run_intent(
        {
            "pipeline": "bio_social",
            "op": "food_web",
            "links": [
                {"from": "grass", "to": "grasshopper"},
                {"from": "grasshopper", "to": "frog"},
            ],
        }
    )
    regions = [o for o in draft.objects if o["kind"] == "region"]
    arrows = [o for o in draft.objects if o["kind"] == "arrow"]
    assert len(regions) == 3
    assert len(arrows) == 2
    # Structure, not pixels: every arrow joins two drawn nodes by object anchor, never a
    # coordinate — and it points AT the eater, which is where the energy goes.
    ids = {o["id"] for o in regions}
    by_title = {o["title"]: o["id"] for o in regions}
    for arrow in arrows:
        assert arrow["anchor"]["object"] in ids
        assert arrow["from"]["object"] in ids
    heads = {a["anchor"]["object"] for a in arrows}
    assert by_title["grass"] not in heads  # nothing eats the producer
    assert "board.energy_flows_one_way" in {c.name for c in draft.ledger.checks}


def test_a_web_that_eats_itself_is_refused() -> None:
    with pytest.raises(Unverified):
        run_intent(
            {
                "pipeline": "bio_social",
                "op": "food_web",
                "links": [{"from": "a", "to": "b"}, {"from": "b", "to": "a"}],
            }
        )


def test_punnett_ratio_comes_from_the_verifier() -> None:
    draft = run_intent(
        {"pipeline": "bio_social", "op": "punnett", "parent_a": "Aa", "parent_b": "Aa"}
    )
    cells = [o for o in draft.objects if o["kind"] == "write" and o.get("check") is None]
    assert [o["text"] for o in cells] == ["AA", "Aa", "Aa", "aa"]
    numbers = [o for o in draft.objects if o["kind"] == "number"]
    assert [o["value"] for o in numbers] == [3.0, 1.0]
    # Both ratios, each under its own name: the phenotype numbers are labelled, and the
    # genotype ratio is written beside them with its own check, so no sentence can call the
    # 3 and the 1 "the genotype ratio" over a board that carries nothing else.
    assert [o.get("label") for o in numbers] == ["dominant", "recessive"]
    genotypes = [o for o in draft.objects if o.get("hint") == "genotypes" or o["id"].endswith("genotypes")]
    assert genotypes and genotypes[0]["text"] == "genotypes 1 AA : 2 Aa : 1 aa"
    assert genotypes[0]["check"] == "board.numbers_agree:genotype counts"
    assert any(c.name == "board.numbers_agree:genotype counts" and c.passed for c in draft.ledger.checks)


def test_timeline_refuses_two_events_in_one_year() -> None:
    with pytest.raises(Unverified):
        run_intent(
            {
                "pipeline": "bio_social",
                "op": "timeline",
                "events": [{"year": 1947, "label": "one"}, {"year": 1947, "label": "two"}],
            }
        )


def test_an_equation_that_cannot_balance_is_refused() -> None:
    with pytest.raises(Unverified):
        run_intent(
            {"pipeline": "chemistry", "op": "balance", "reactants": ["H2"], "products": ["O2"]}
        )


def test_balancing_is_solved_not_asserted() -> None:
    draft = run_intent(
        {
            "pipeline": "chemistry",
            "op": "balance",
            "reactants": ["H2", "O2"],
            "products": ["H2O"],
        }
    )
    coefficients = [o["value"] for o in draft.objects if o["kind"] == "number"]
    assert coefficients == [2.0, 2.0]  # 2 H2 + O2 -> 2 H2O; the 1 on O2 is never written
    # The coefficients tick in, one after another, rather than landing together.
    starts = [o["t"]["start"] for o in draft.objects if o["kind"] == "number"]
    assert starts == sorted(starts) and len(set(starts)) == len(starts)


def test_benzene_alternates_and_is_drawn_ring_first() -> None:
    draft = run_intent({"pipeline": "chemistry", "op": "molecule", "smiles": "c1ccccc1"})
    kinds = [o["kind"] for o in draft.objects]
    assert kinds[: len(kinds) - kinds.count("bond")].count("atom") == 6
    assert kinds.index("atom") < kinds.index("bond"), "the skeleton is drawn before the bonds"
    bonds = [o for o in draft.objects if o["kind"] == "bond"]
    assert len(bonds) == 6
    assert sorted(b["order"] for b in bonds) == [1, 1, 1, 2, 2, 2]
    assert all(len(b["to"]) == 2 for b in bonds)  # the other atom's point, not a floating id


def test_a_structure_the_checker_refuses_never_reaches_the_board() -> None:
    with pytest.raises(Unverified):
        run_intent({"pipeline": "chemistry", "op": "molecule", "smiles": "C1CCC"})


def test_the_tangent_is_refused_outside_the_graph() -> None:
    with pytest.raises(Unverified):
        run_intent(
            {
                "pipeline": "math",
                "op": "graph",
                "expr": "x**2",
                "domain": [-1, 1],
                "tangent_at": 40,
            }
        )


def test_a_derivation_with_a_broken_step_is_refused() -> None:
    with pytest.raises(Unverified):
        run_intent(
            {
                "pipeline": "math",
                "op": "derivation",
                "equation": "2*x + 3 = 7",
                "steps": ["2*x = 5", "x = 2.5"],
            }
        )


def test_cell_labels_come_from_the_curated_parts_list() -> None:
    with pytest.raises(Unverified):
        run_intent(
            {
                "pipeline": "bio_social",
                "op": "cell",
                "subject": "animal cell",
                "parts": ["chloroplast"],
            }
        )


def test_an_axis_is_anchored_at_its_origin_and_grows_toward_its_max() -> None:
    """The hand draws a vertical axis from its anchor to ``y - length`` and puts the arrowhead
    at the far end (``packages/wobo/src/board/geometry.ts``, axis case), so ``min`` sits at the
    anchor and ``max`` at the arrow. Board y grows downward, which makes the anchor the BOTTOM of
    the frame — the same row the x-axis and the grid's last line sit on.

    Anchoring a y-axis at the top instead drew the whole thing upward off the frame: on a real
    plane the axis floated above the grid it was meant to belong to, unattached to any of the ink.
    """
    draft = run_intent({"pipeline": "math", "op": "graph", "expr": "x**2"})
    by_hint = {o["id"].split("_")[-1]: o for o in draft.objects}
    grid = next(o for o in draft.objects if o["kind"] == "grid")
    axes = [o for o in draft.objects if o["kind"] == "axis"]
    assert len(axes) == 2
    horizontal = next(a for a in axes if a["orientation"] == "x")
    vertical = next(a for a in axes if a["orientation"] == "y")

    grid_top = grid["anchor"]["board"][1]
    grid_bottom = grid_top + grid["h"]

    # The y-axis starts on the grid's bottom row and reaches exactly its top row.
    assert vertical["anchor"]["board"][1] == pytest.approx(grid_bottom, abs=0.01)
    assert vertical["anchor"]["board"][1] - vertical["length"] == pytest.approx(grid_top, abs=0.01)
    # And it sits inside the grid horizontally, not off beside it.
    grid_left = grid["anchor"]["board"][0]
    assert grid_left <= vertical["anchor"]["board"][0] <= grid_left + grid["w"]

    # The x-axis shares that same baseline, so the two axes actually meet.
    assert horizontal["anchor"]["board"][1] <= grid_bottom + 0.01
    assert by_hint  # the ids carry their hints, which is what makes a plan readable
