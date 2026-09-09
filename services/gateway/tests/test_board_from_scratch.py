"""The from-scratch drawings, one test per confirmed defect (docs/INK-FOUR.md, Correctness).

Every case here was found on a real screen by the evidence lab of 2026-09-09 and is named by the
turn it was found on. The law they enforce together is the one the plane was missing: a board
drawn from nothing answers the question that was asked, with numbers read out of the asking, every
claim signed by a check that actually checked THAT claim, at a size a learner can read — and when
it cannot be built, it is refused with a reason rather than drawn wrong.
"""

from __future__ import annotations

import pytest
from wobo_gateway.board import schema, verify
from wobo_gateway.board.pipelines import (
    FIGURE,
    FIGURE_UNION,
    MAX_NOTE_CHARS,
    TYPE_UNITS,
    Frame,
    run_intent,
)
from wobo_gateway.board.pipelines.bio_social import CELL_DIAGRAMS
from wobo_gateway.board.verify import Unverified
from wobo_gateway.wobo import board_intents

LENS_ASK = (
    "Draw a ray diagram of a ray through a convex lens of focal length 15 cm "
    "with the object 30 cm away"
)
PYTHAGORAS_ASK = (
    "Prove Pythagoras theorem with squares on the sides of a right triangle with legs 3 cm and 4 cm"
)
CELL_ASK = "Draw a plant cell with five labels"
PROJECTILE_ASK = "Draw the path of a ball thrown at 20 m/s at 45 degrees and label the apex"
TIMELINE_ASK = "Draw a timeline of the non-cooperation movement"


def numbers(draft) -> list[dict]:
    return [o for o in draft.objects if o["kind"] == "number"]


def written(draft) -> list[dict]:
    return [o for o in draft.objects if o["kind"] in ("label", "write", "tex", "note")]


# --- the learner's own numbers -----------------------------------------------------------------


def test_the_lens_is_the_lens_the_learner_asked_about() -> None:
    """`turns/scratch/physics-lens-1440`: a 15 cm ask drew f = 10, and signed the 15 and the -0.5
    it produced as verified. Both were true of a lens nobody had asked for."""
    draft = run_intent(
        {"pipeline": "physics", "op": "ray", "focal_length": 10.0, "object_distance": -30.0},
        ask=LENS_ASK,
    )
    # f = 15, u = -30 => v = 30 and m = -1. The old board drew v = 15 and m = -0.5.
    values = [o["value"] for o in numbers(draft)]
    assert values == [30.0, -1.0]
    assert [o.get("unit") for o in numbers(draft)] == ["cm", None]
    detail = " ".join(c.detail or "" for c in draft.ledger.checks)
    assert "the ask says 15 cm" in detail
    assert "not the 10 the plan carried" in detail


def test_the_keyless_reading_takes_the_focal_length_out_of_the_question() -> None:
    intent = board_intents(LENS_ASK)[0]
    assert intent["op"] == "ray"
    assert intent["focal_length"] == 15.0
    assert intent["object_distance"] == -30.0
    assert intent["unit"] == "cm"


def test_a_projectile_is_thrown_at_the_speed_the_learner_said() -> None:
    draft = run_intent(
        {"pipeline": "physics", "op": "projectile", "v0": 12.0, "angle_deg": 60.0},
        ask=PROJECTILE_ASK,
    )
    detail = " ".join(c.detail or "" for c in draft.ledger.checks)
    assert "speed: the ask says 20 m/s" in detail
    assert "angle: the ask says 45 deg" in detail
    # 20 m/s at 45 degrees: the apex is v^2 sin^2/2g = 10.19 m, not the 4.6 m of 12 m/s at 60.
    apex = next(o for o in numbers(draft) if o.get("label") == "greatest height")
    assert apex["value"] == pytest.approx(10.19, abs=0.02)


def test_a_right_triangle_is_drawn_from_the_legs_in_the_question() -> None:
    draft = run_intent(
        {
            "pipeline": "math",
            "op": "construction",
            "what": "right_triangle",
            "legs": [1.0, 1.0],
            "squares": True,
        },
        ask=PYTHAGORAS_ASK,
    )
    # 3 and 4 square to 9 and 16, and the hypotenuse of THOSE legs is 5. A triangle built from
    # the intent's own [1, 1] would have written 1, 1 and 1.41.
    values = [o["value"] for o in numbers(draft)]
    assert sorted(values) == [5.0, 9.0, 16.0, 25.0]
    proof = [o["text"] for o in draft.objects if o["kind"] == "write"]
    assert proof == ["9 + 16 = 25"]
    assert draft.given_unit(None, "legs") == "cm"


def test_a_cell_draws_the_number_of_labels_the_learner_asked_for() -> None:
    """`turns/scratch/bio-plant-cell-1440`: seven labels for a five-label ask.

    WHICH five is :attr:`Diagram.first` (wave 46, finding 6): the five that make a plant cell read
    as one, not the five that happen to sit furthest out. They are still DRAWN outside in.
    """
    plant = CELL_DIAGRAMS["plant cell"]
    draft = run_intent(
        {"pipeline": "bio_social", "op": "cell", "subject": "plant cell"}, ask=CELL_ASK
    )
    labels = [o for o in draft.objects if o.get("id", "").endswith("part")]
    assert len(labels) == 5
    chosen = set(plant.teaching_order()[:5])
    assert [o["text"] for o in labels] == [p.name for p in plant.parts if p.name in chosen]


def test_more_labels_than_the_diagram_has_parts_is_refused_with_a_reason() -> None:
    with pytest.raises(Unverified) as caught:
        run_intent(
            {"pipeline": "bio_social", "op": "cell", "subject": "plant cell"},
            ask="draw a plant cell with 12 labels",
        )
    assert "7 parts I can prove" in caught.value.reason


# --- every leader lands on its part --------------------------------------------------------------


def test_every_leader_starts_on_the_part_it_names() -> None:
    """`turns/scratch/bio-plant-cell-1440`: seven leaders all left the middle of the cell and
    none of them touched the thing it named."""
    draft = run_intent(
        {"pipeline": "bio_social", "op": "cell", "subject": "plant cell"}, ask="draw a plant cell"
    )
    by_id = {o["id"]: o for o in draft.objects}
    leaders = [o for o in draft.objects if o.get("id", "").endswith("leader")]
    assert len(leaders) == 7
    heads = [o["anchor"].get("object") for o in leaders]
    # A leader points AT its anchor, so the head is the part. Every organelle that has a shape of
    # its own is pointed at directly; nothing hangs off a shape that was never drawn.
    assert all(h is None or h in by_id for h in heads)
    named = {by_id[h].get("title") or by_id[h]["id"] for h in heads if h}
    assert len(named) == len([h for h in heads if h]), "two leaders share one target"


# --- one scale both ways -------------------------------------------------------------------------


def _scale_of(frame: Frame) -> tuple[float, float]:
    return frame.per_unit, frame.per_unit_y


def test_a_fitted_frame_uses_one_scale_for_both_axes() -> None:
    frame = Frame.fit(0.0, 42.83, 0.0, 13.76)
    across, up = _scale_of(frame)
    assert across == pytest.approx(up, rel=1e-3)


def test_the_projectile_is_not_drawn_taller_than_it_flew() -> None:
    """`turns/scratch/physics-projectile-1440`: the height was exaggerated 2.9 times."""
    draft = run_intent({"pipeline": "physics", "op": "projectile"}, ask=PROJECTILE_ASK)
    path = next(o for o in draft.objects if o["kind"] == "curve")
    points = [
        [path["anchor"]["board"][0] + dx, path["anchor"]["board"][1] + dy]
        for dx, dy in path["points"]
    ]
    across = max(p[0] for p in points) - min(p[0] for p in points)
    up = max(p[1] for p in points) - min(p[1] for p in points)
    # 20 m/s at 45 degrees flies 40.8 m and rises 10.2 m: four times as far as it is high.
    assert across / up == pytest.approx(40.79 / 10.19, rel=0.02)


def test_the_ray_diagram_is_not_drawn_taller_than_it_is_wide() -> None:
    draft = run_intent(
        {"pipeline": "physics", "op": "ray", "focal_length": 15.0, "object_distance": -30.0},
        ask=LENS_ASK,
    )
    axis = next(o for o in draft.objects if o["id"].endswith("axis"))
    obj = next(o for o in draft.objects if o["id"].endswith("object"))
    # The axis spans 2 * 37.5 cm and the object arrow is 8.25 cm tall, so the ratio of the drawn
    # lengths has to be the ratio of the real ones.
    across = abs(axis["to"]["board"][0] - axis["anchor"]["board"][0])
    up = abs(obj["anchor"]["board"][1] - obj["from"]["board"][1])
    assert across / up == pytest.approx(75.0 / 8.25, rel=0.02)


# --- the Punnett square ---------------------------------------------------------------------------


def test_the_punnett_is_a_square_with_a_blank_corner() -> None:
    """`turns/scratch/bio-punnett-1440`: a three-by-two table with two of the four offspring
    already printed into the grid, and the hand then wrote all four on top."""
    draft = run_intent(
        {"pipeline": "bio_social", "op": "punnett", "parent_a": "Tt", "parent_b": "Tt"},
        ask="Draw a Punnett square for Tt x Tt",
    )
    table = next(o for o in draft.objects if o["kind"] == "table")
    assert table["rows"] == [["", "T", "t"], ["T", "", ""], ["t", "", ""]]
    assert table["rowHeight"] * 3 == pytest.approx(table["w"], rel=1e-6), "a square, not a table"
    filled = [o for o in draft.objects if o["kind"] == "write" and o.get("check") is None]
    assert [o["text"] for o in filled] == ["TT", "Tt", "Tt", "tt"]
    # Each one lands in its own cell of the inner two by two.
    corners = {tuple(o["anchor"]["at"]) for o in filled}
    assert len(corners) == 4
    assert all(0.33 < fx < 1.0 and 0.33 < fy < 1.0 for fx, fy in corners)


# --- nothing is signed by a check that did not check it ----------------------------------------


def test_the_magnification_carries_its_own_check() -> None:
    """It used to carry `cas.solution_satisfies` — the receipt for the image distance, an
    equation the magnification does not appear in."""
    draft = run_intent(
        {"pipeline": "physics", "op": "ray", "focal_length": 15.0, "object_distance": -30.0},
        ask=LENS_ASK,
    )
    magnification = next(o for o in numbers(draft) if o.get("label") == "magnification")
    assert magnification["check"] == "board.numbers_agree:magnification"
    assert "board.numbers_agree:magnification" in {c.name for c in draft.ledger.checks}


INTENTS = [
    {"pipeline": "math", "op": "graph", "expr": "x**2", "tangent_at": 1.0},
    {"pipeline": "math", "op": "number_line", "marks": [2]},
    {"pipeline": "math", "op": "derivation", "equation": "2*x + 3 = 7"},
    {
        "pipeline": "math",
        "op": "construction",
        "what": "right_triangle",
        "legs": [3, 4],
        "squares": True,
        "unit": "cm",
    },
    {"pipeline": "math", "op": "construction"},
    {"pipeline": "physics", "op": "projectile", "v0": 20.0, "angle_deg": 45.0},
    {"pipeline": "physics", "op": "ray", "focal_length": 15.0, "object_distance": -30.0},
    {"pipeline": "physics", "op": "wave", "amplitude": 1.0, "wavelength": 2.0, "frequency": 3.0},
    {"pipeline": "physics", "op": "circuit", "emf": 12.0, "resistances": [4.0, 8.0]},
    {
        "pipeline": "physics",
        "op": "free_body",
        "body": "the block",
        "equilibrium": True,
        "forces": [
            {"name": "weight", "magnitude": 10.0, "angle_deg": 270.0, "unit": "N"},
            {"name": "normal", "magnitude": 10.0, "angle_deg": 90.0, "unit": "N"},
        ],
    },
    {"pipeline": "chemistry", "op": "molecule", "smiles": "c1ccccc1", "name": "benzene"},
    {"pipeline": "chemistry", "op": "balance", "reactants": ["H2", "O2"], "products": ["H2O"]},
    {"pipeline": "bio_social", "op": "cell", "subject": "plant cell"},
    {"pipeline": "bio_social", "op": "cell", "subject": "animal cell"},
    {"pipeline": "bio_social", "op": "cell", "subject": "neuron"},
    {"pipeline": "bio_social", "op": "cell", "subject": "leaf"},
    {"pipeline": "bio_social", "op": "punnett", "parent_a": "Aa", "parent_b": "Aa"},
    {
        "pipeline": "bio_social",
        "op": "timeline",
        "events": [
            {"year": 1919, "label": "Rowlatt Act"},
            {"year": 1920, "label": "the call"},
            {"year": 1922, "label": "Chauri Chaura"},
        ],
    },
    {
        "pipeline": "bio_social",
        "op": "food_web",
        "links": [{"from": "grass", "to": "grasshopper"}, {"from": "grasshopper", "to": "frog"}],
    },
    {
        "pipeline": "bio_social",
        "op": "map",
        "regions": ["maharashtra", "gujarat", "kerala"],
        "values": [
            {"id": "maharashtra", "value": 3},
            {"id": "gujarat", "value": 1},
            {"id": "kerala", "value": 2},
        ],
    },
]


@pytest.mark.parametrize("intent", INTENTS, ids=lambda i: f"{i['pipeline']}.{i.get('op')}")
def test_every_number_names_a_check_that_ran_on_this_turn(intent: dict) -> None:
    draft = run_intent(intent)
    ran = {c.name for c in draft.ledger.checks}
    for obj in draft.objects:
        check = obj.get("check")
        if check:
            assert check in ran, f"{obj['id']} names {check}, which did not run"
        if obj["kind"] == "number":
            assert obj.get("check"), f"{obj['id']} is a numeral with no receipt"


@pytest.mark.parametrize("intent", INTENTS, ids=lambda i: f"{i['pipeline']}.{i.get('op')}")
def test_every_written_thing_is_sized_and_short_enough_to_read(intent: dict) -> None:
    """`docs/INK-FOUR.md`, Craft: labels at least 12 px on the glass at 1440 and at 390.

    The type is a fixed size in board units and the plane's camera fits the ink, so the only way a
    label is legible is that the figure around it is small and the writing is named. Both are
    asserted here; the pixels themselves are measured on the real screens by the golden run.
    """
    draft = run_intent(intent)
    for obj in written(draft):
        assert obj.get("size") == TYPE_UNITS, f"{obj['id']} does not name its type size"
        text = str(obj.get("text") or obj.get("tex") or "")
        assert len(text) <= MAX_NOTE_CHARS, f"{obj['id']} writes {len(text)} characters"


@pytest.mark.parametrize("intent", INTENTS, ids=lambda i: f"{i['pipeline']}.{i.get('op')}")
def test_every_from_scratch_board_is_drawn_inside_the_figure_box(intent: dict) -> None:
    """The camera fits the ink, so a wide drawing is a small one once it is on a screen. Every
    board-space anchor stays inside the figure box with a margin for the labels hung off it."""
    draft = run_intent(intent)
    slack_x = (FIGURE_UNION[0] - FIGURE[2]) / 2
    slack_y = (FIGURE_UNION[1] - FIGURE[3]) / 2
    for obj in draft.objects:
        for field in ("anchor", "to", "from"):
            at = obj.get(field)
            if not isinstance(at, dict) or "board" not in at:
                continue
            x, y = at["board"]
            assert FIGURE[0] - slack_x <= x <= FIGURE[0] + FIGURE[2] + slack_x, (
                f"{obj['id']}.{field} sits at x={x:g}, outside the figure box"
            )
            assert FIGURE[1] - slack_y <= y <= FIGURE[1] + FIGURE[3] + slack_y, (
                f"{obj['id']}.{field} sits at y={y:g}, outside the figure box"
            )


@pytest.mark.parametrize("intent", INTENTS, ids=lambda i: f"{i['pipeline']}.{i.get('op')}")
def test_every_from_scratch_board_is_grammatical(intent: dict) -> None:
    draft = run_intent(intent)
    assert draft.objects
    for obj in draft.objects:
        assert schema.validate_object(obj) == [], f"{obj['id']}: {schema.validate_object(obj)}"


# --- the board writes maths, not Python --------------------------------------------------------


PROGRAMMING = ("**", "*", "sqrt(", "math.")


@pytest.mark.parametrize(
    "expr,written_as",
    [
        ("x**2", "y = x^2"),
        ("2*x + 1", "y = 2x + 1"),
        ("x**2 - 5*x + 6", "y = x^2 - 5x + 6"),
    ],
)
def test_a_curve_is_labelled_the_way_the_chapter_spells_it(expr: str, written_as: str) -> None:
    """`docs/INK-FOUR.md` defect 7: a parabola came back labelled `y = x**2`, which is the CAS's
    spelling in front of a learner who has never seen `**`."""
    draft = run_intent({"pipeline": "math", "op": "graph", "expr": expr}, ask=f"graph {expr}")
    label = next(o for o in draft.objects if o["kind"] == "tex")
    assert label["tex"] == written_as


@pytest.mark.parametrize("intent", INTENTS, ids=lambda i: f"{i['pipeline']}.{i.get('op')}")
def test_nothing_on_any_board_is_written_in_programming_syntax(intent: dict) -> None:
    draft = run_intent(intent)
    for obj in draft.objects:
        for field in ("text", "tex", "label", "title"):
            text = obj.get(field)
            if isinstance(text, str):
                assert not any(token in text for token in PROGRAMMING), (
                    f"{obj['id']}.{field} writes {text!r}"
                )


# --- a board that cannot be built is refused, never faked --------------------------------------


REFUSALS = [
    ({"pipeline": "bio_social", "op": "timeline", "events": []}, "at least two events"),
    ({"pipeline": "bio_social", "op": "map", "regions": []}, "a map needs regions"),
    ({"pipeline": "bio_social", "op": "map", "regions": ["narnia"]}, "not one I can prove"),
    ({"pipeline": "bio_social", "op": "cell", "subject": "dragon"}, "verified parts list"),
    ({"pipeline": "bio_social", "op": "food_web", "links": []}, "needs links"),
    (
        {"pipeline": "physics", "op": "ray", "focal_length": 0.0, "object_distance": -30.0},
        "f is not zero",
    ),
    (
        {"pipeline": "physics", "op": "projectile", "v0": 20.0, "angle_deg": 95.0},
        "between 0 and 90",
    ),
    (
        {"pipeline": "math", "op": "construction", "what": "right_triangle", "legs": [0, 4]},
        "positive and finite",
    ),
    ({"pipeline": "physics", "op": "orbit"}, "physics cannot draw"),
]


@pytest.mark.parametrize("intent,reason", REFUSALS, ids=lambda v: str(v)[:40])
def test_what_cannot_be_built_is_refused_with_a_reason(intent, reason) -> None:
    if isinstance(intent, str):
        return
    with pytest.raises(Unverified) as caught:
        run_intent(intent)
    assert reason in caught.value.reason


def test_a_timeline_nobody_gave_dates_for_is_refused_rather_than_invented() -> None:
    """`turns/scratch/social-timeline-1440`: the board drew nothing and Wobo said "which step
    feels shaky", which is not an answer to "draw a timeline of the non-cooperation movement".

    Wave 45 gave the syllabus's own movements their curated dates (finding 7), so the refusal is
    now proved on a timeline nobody could have dates for: the learner's own week.
    """
    ask = "Draw a timeline of my week"
    intents = board_intents(ask)
    assert intents and intents[0]["op"] == "timeline"
    with pytest.raises(Unverified) as caught:
        run_intent(intents[0], ask=ask)
    assert "years" in caught.value.reason or "events" in caught.value.reason


# --- the ask reader itself ---------------------------------------------------------------------


def test_the_nearest_cue_wins_not_the_first() -> None:
    assert verify.read_given(LENS_ASK, "focal length").value == 15.0
    assert verify.read_given(LENS_ASK, "object", "away").value == 30.0


def test_a_unit_is_the_learners_and_never_invented() -> None:
    assert verify.unit_from_the_ask(LENS_ASK, "focal length") == "cm"
    assert verify.unit_from_the_ask("draw a lens with focal length 15", "focal length") is None


def test_a_number_word_is_a_given_too() -> None:
    assert verify.read_given(CELL_ASK, "labels").value == 5.0


def test_an_ask_with_no_numbers_leaves_the_intent_alone() -> None:
    value, check = verify.from_the_ask("focal length", "draw me a lens", "focal length")
    assert value is None and check is None


# --- wave 45: the words on the board are a teacher's, and the apex is named ----------------------


def _texts(draft) -> list[str]:
    out = []
    for obj in draft.objects:
        for field in ("text", "label", "title", "tex"):
            value = obj.get(field)
            if isinstance(value, str) and value.strip():
                out.append(value.strip())
    return out


def test_the_ray_diagram_writes_physics_rather_than_the_pipelines_own_shorthand() -> None:
    """Finding 4, 2026-09-09. The lens board opened with "Object, image, F, image 30.00 cm, how
    big -1.00." read aloud: the say was honest — those are the words on the board — and no teacher
    says "how big minus one point zero zero" or reads a focus out as a letter. The labels were the
    thing to fix.
    """
    draft = run_intent(
        {"pipeline": "physics", "op": "ray", "focal_length": 10.0, "object_distance": -30.0},
        ask=LENS_ASK,
    )
    words = _texts(draft)
    assert "how big" not in words and "F" not in words
    assert "magnification" in words
    assert "image distance" in words
    # wave 46, finding 7: the two foci are named apart, so neither is the bare word any more.
    assert "near focus" in words and "far focus" in words


def test_the_projectile_writes_physics_rather_than_the_pipelines_own_shorthand() -> None:
    """Finding 4: "Across-speed 14.14 m/s, how high 10.20 m." Same board, same shorthand."""
    draft = run_intent(
        {"pipeline": "physics", "op": "projectile", "v0": 20.0, "angle_deg": 45.0},
        ask=PROJECTILE_ASK,
    )
    words = _texts(draft)
    assert "across-speed" not in words and "how high" not in words
    assert "sideways speed" in words
    assert "greatest height" in words
    # the range was drawn as a bare "40.79 m" with nothing saying what it measured
    assert "range" in words


def test_the_projectile_names_the_apex_the_ask_asked_it_to_label() -> None:
    """Finding 9, 2026-09-09: the ask says "label the apex" and no object on the board carried the
    word. The nearest was "up-speed is zero here", overlapping the height number."""
    draft = run_intent(
        {"pipeline": "physics", "op": "projectile", "v0": 20.0, "angle_deg": 45.0},
        ask=PROJECTILE_ASK,
    )
    assert "apex" in _texts(draft)


def test_the_ground_axis_is_labelled_short_enough_to_stay_on_the_board() -> None:
    """Finding 9: "metres" was written past the arrowhead at the right edge and clipped there.
    The axis under a trajectory is the ground; the metres are named on the range beside it."""
    draft = run_intent(
        {"pipeline": "physics", "op": "projectile", "v0": 20.0, "angle_deg": 45.0},
        ask=PROJECTILE_ASK,
    )
    axis = next(o for o in draft.objects if o["kind"] == "axis")
    assert axis["label"] == "ground"


def test_the_punnett_ratio_is_written_under_the_square_and_never_beside_it() -> None:
    """Finding 5, 2026-09-09: at 390 "recessive 1" was written outside the square to its right,
    annotating nothing, and "dominant 3" sat below-left of it. The 3 : 1 is a property of the
    whole square, so both halves of it are written under the square, as one ratio a learner reads
    left to right."""
    draft = run_intent(
        {"pipeline": "bio_social", "op": "punnett", "parent_a": "Tt", "parent_b": "Tt"},
        ask="Draw a Punnett square for Tt x Tt",
    )
    ratio = [o for o in numbers(draft) if o.get("label") in ("dominant", "recessive")]
    assert len(ratio) == 2
    sides = [o["anchor"].get("at") for o in ratio]
    assert sides == ["bottomLeft", "bottomRight"], sides


def test_a_leader_stops_on_the_side_of_its_part_that_faces_its_label() -> None:
    """Finding 6, 2026-09-09: on the live plant cell three leader arrows crossed the cell wall and
    ran into the interior, because a leader for a part the BODY draws — the wall, the membrane —
    tipped at the body's centre. A leader points at the edge of its part nearest its own label."""
    draft = run_intent(
        {"pipeline": "bio_social", "op": "cell", "subject": "plant cell", "label_count": 5},
        ask=CELL_ASK,
    )
    leaders = [o for o in draft.objects if o["kind"] == "arrow"]
    assert leaders
    for leader in leaders:
        anchor = leader["anchor"]
        if "object" in anchor:
            assert anchor.get("at") in ("left", "right"), leader


def test_the_nucleus_is_round_and_the_chloroplast_is_a_shape_rather_than_a_dot() -> None:
    """Finding 6: the nucleus was drawn as a tall narrow oval in the accent ink and read as a blue
    "0"; the chloroplast was a dot. Both carry the proportions of the thing they are."""
    for subject in ("plant cell", "animal cell"):
        parts = {p.name: p for p in CELL_DIAGRAMS[subject].parts}
        nucleus = parts["nucleus"]
        rx, ry = nucleus.size
        assert 0.85 <= rx / ry <= 1.18, f"{subject} nucleus is {rx} by {ry}"
    chloroplast = {p.name: p for p in CELL_DIAGRAMS["plant cell"].parts}["chloroplast"]
    assert chloroplast.size[0] >= 0.1 and chloroplast.size[0] / chloroplast.size[1] >= 1.5


def test_a_syllabus_timeline_is_drawn_rather_than_refused() -> None:
    """Finding 7, 2026-09-09: "Draw a timeline of the non-cooperation movement" was refused for
    want of dates. The refusal was honest and the gap was not rare — it is a chapter of the CBSE
    Class 10 history syllabus. The dates are the ones the product's own live board drew and a
    teaching review corrected by hand on 2026-09-05
    (``harness/fixtures/social.cbse.10.timeline.json``); nothing here is remembered by a model.
    """
    from wobo_gateway.board.pipelines.bio_social import SYLLABUS_TIMELINES, syllabus_timeline

    events = syllabus_timeline("Draw a timeline of the non-cooperation movement")
    assert [e["year"] for e in events] == [1919, 1920, 1922]
    assert syllabus_timeline("draw a timeline of my week") == []
    # every curated label fits the board, and every year is in order
    for topic, curated in SYLLABUS_TIMELINES.items():
        years = [y for y, _ in curated]
        assert years == sorted(set(years)), topic
        for _, label in curated:
            assert len(label) <= MAX_NOTE_CHARS, (topic, label)


def test_the_non_cooperation_timeline_reaches_the_pipeline_through_the_keyless_brain() -> None:
    intents = board_intents(TIMELINE_ASK)
    assert intents and intents[0]["op"] == "timeline"
    draft = run_intent(intents[0], ask=TIMELINE_ASK)
    assert [o["value"] for o in numbers(draft)] == [1919.0, 1920.0, 1922.0]


# --- wave 46, finding 6: five labels that make it a PLANT cell -----------------------------------


def test_the_five_labels_of_a_plant_cell_are_the_five_that_make_it_a_plant_cell() -> None:
    """Finding 6, 2026-09-09, confirmed unchanged from wave 45. "Draw a plant cell with five
    labels" returned cell wall, cell membrane, cytoplasm, nucleus and chloroplast — and no
    vacuole. Four of those five are on an animal cell too, so the drawing did not read as a plant
    cell at all.

    Outside in is the order a teacher LABELS a cell. It is not the order a teacher CHOOSES five
    from seven: the two organelles a learner is being shown a plant cell FOR are the chloroplast
    and the large central vacuole, and cytoplasm is the space left over when the rest are named.
    """
    draft = run_intent(
        {"pipeline": "bio_social", "op": "cell", "subject": "plant cell"}, ask=CELL_ASK
    )
    named = {o["text"] for o in draft.objects if o.get("id", "").endswith("part")}
    assert len(named) == 5, named
    assert {"cell wall", "vacuole", "chloroplast", "nucleus"} <= named, named
    # the two that tell a plant cell from an animal one are never the ones trimmed off
    for count in (2, 3, 4, 5, 6, 7):
        draft = run_intent(
            {"pipeline": "bio_social", "op": "cell", "subject": "plant cell"},
            ask=f"draw a plant cell with {count} labels",
        )
        picked = [o["text"] for o in draft.objects if o.get("id", "").endswith("part")]
        assert len(picked) == count, (count, picked)
        if count >= 4:
            assert "vacuole" in picked and "chloroplast" in picked, (count, picked)


def test_a_cell_is_still_labelled_outside_in_when_every_part_is_named() -> None:
    """The trim order is a teaching order; the DRAWING order is unchanged, outside in."""
    draft = run_intent(
        {"pipeline": "bio_social", "op": "cell", "subject": "plant cell"}, ask="draw a plant cell"
    )
    drawn = [o["text"] for o in draft.objects if o.get("id", "").endswith("part")]
    assert drawn == [p.name for p in CELL_DIAGRAMS["plant cell"].parts]


# --- wave 46, finding 7: a ray diagram is a CONSTRUCTION, not one line ---------------------------


def _ray_lines(draft) -> dict[str, list[list[float]]]:
    """Every construction ray on the board, by its id, in absolute board coordinates.

    A polyline's ``points`` are offsets from its own anchor, so the anchor goes back on."""
    out: dict[str, list[list[float]]] = {}
    for obj in draft.objects:
        ident = str(obj.get("id") or "")
        if obj.get("kind") not in ("line", "polyline"):
            continue
        origin = obj["anchor"]["board"]
        if obj.get("kind") == "polyline":
            out[ident] = [[origin[0] + p[0], origin[1] + p[1]] for p in obj["points"]]
        else:
            out[ident] = [list(origin), list(obj["to"]["board"])]
    return out


def test_a_convex_lens_draws_the_two_rays_that_locate_the_image() -> None:
    """Finding 7, 2026-09-09. The say was fixed and the numbers are right — f = 15 from the ask,
    v = 30.00, m = -1.00, four checks — and the DRAWING was still one line from the tip of the
    object to the tip of the image: the ray through the optical centre, and nothing else. One
    construction line proves nothing. A ray diagram locates the image with at least two rays, and
    the two a syllabus names are the ray that arrives parallel and leaves through the far focus,
    and the ray that arrives through the near focus and leaves parallel.
    """
    draft = run_intent(
        {"pipeline": "physics", "op": "ray", "focal_length": 15.0, "object_distance": -30.0},
        ask=LENS_ASK,
    )
    rays = {k: v for k, v in _ray_lines(draft).items() if "ray" in k}
    assert len(rays) >= 3, sorted(rays)
    assert any(k.endswith("parallelray") for k in rays), sorted(rays)
    assert any(k.endswith("focalray") for k in rays), sorted(rays)
    assert any(k.endswith("centreray") for k in rays), sorted(rays)

    obj = next(o for o in draft.objects if o["id"].endswith("object"))
    img = next(o for o in draft.objects if o["id"].endswith("image"))
    tip_of_object = obj["anchor"]["board"]
    tip_of_image = img["anchor"]["board"]
    # Every one of them starts at the tip of the object and ends at the tip of the image: that
    # meeting IS the construction, and a ray that misses it locates nothing.
    for ident, points in rays.items():
        assert points[0] == pytest.approx(tip_of_object, abs=0.02), (ident, points)
        assert points[-1] == pytest.approx(tip_of_image, abs=0.02), (ident, points)
    # The parallel ray runs flat until it reaches the lens, then bends. Three points, not two.
    parallel = next(v for k, v in rays.items() if k.endswith("parallelray"))
    assert len(parallel) == 3, parallel
    assert parallel[0][1] == pytest.approx(parallel[1][1], abs=0.02), parallel
    # and the construction is checked, not asserted
    assert "board.numbers_agree:the rays meet" in {c.name for c in draft.ledger.checks}


def test_the_two_foci_are_named_apart_so_both_of_them_paint() -> None:
    """Both were labelled "focus", one word, twice, at the same size, and one of them never
    painted at all. A learner cannot be told which side of the lens they are looking at by two
    identical words."""
    draft = run_intent(
        {"pipeline": "physics", "op": "ray", "focal_length": 15.0, "object_distance": -30.0},
        ask=LENS_ASK,
    )
    focus = [o["text"] for o in draft.objects if o.get("id", "").endswith("flabel")]
    assert len(focus) == 2, focus
    assert len(set(focus)) == 2, focus
