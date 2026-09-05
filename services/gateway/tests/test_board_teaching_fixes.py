"""Three boards the teaching harness found empty, wrong or off the edge on 2026-09-05.

Every one of them is deterministic: no model is called here, and each failed before the fix in
exactly the way the live run reported it.
"""

from __future__ import annotations

from wobo_gateway.board.planner import plan_board


def _plan(intent: dict) -> object:
    return plan_board({"say": "Here.", "intents": [intent]})


def test_a_timeline_actually_carries_its_dates() -> None:
    """The learner asked for a timeline of dated events and got a timeline with no dates on it.

    ``_timeline`` records one check per event, named after the year it checked
    (``board.in_bounds:year 1919``), and then wrote ``board.in_bounds:year`` — without the year —
    on every number object. The planner's own law refuses an object naming a check that did not
    run, and rightly: a check name that is not in the ledger is a laundering token. So all seven
    years were dropped and the line was drawn with nothing on it but labels.
    """
    plan = _plan(
        {
            "pipeline": "bio_social",
            "op": "timeline",
            "events": [
                {"year": 1919, "label": "Jallianwala Bagh"},
                {"year": 1930, "label": "the salt march"},
                {"year": 1947, "label": "independence"},
            ],
        }
    )
    assert not plan.refusals, plan.refusals
    numbers = [o for o in plan.objects if o["kind"] == "number"]
    assert len(numbers) == 3, "every event on a timeline carries its year"
    ran = {c.name for c in plan.ledger.checks}
    for obj in numbers:
        assert obj["check"] in ran, f"{obj['check']} was written and never ran"


def test_a_derivation_whose_steps_cannot_be_checked_still_draws_the_answer() -> None:
    """"x - 2 = 0 or x - 3 = 0" is how a factorisation ends, and the CAS cannot read a disjunction.

    The whole derivation was refused for it, so the commonest Class 10 board there is — solve a
    quadratic by factorising — streamed Wobo explaining the factors over a blank board. The
    fallback that already existed for a derivation with NO steps computes the last line with the
    CAS and proves it; all that was missing was reaching for it when the given steps do not check.
    """
    plan = _plan(
        {
            "pipeline": "math",
            "op": "derivation",
            "equation": "x**2 - 5*x + 6 = 0",
            "var": "x",
            "steps": ["(x - 2)*(x - 3) = 0", "x - 2 = 0 or x - 3 = 0"],
        }
    )
    assert plan.objects, f"nothing was drawn: {plan.refusals}"
    written = " ".join(o.get("text", "") for o in plan.objects if o["kind"] == "write")
    assert "x**2 - 5*x + 6 = 0" in written, "the equation the learner asked about is on the board"
    assert "x - (2)" in written and "x - (3)" in written, (
        "and so is the factored form the CAS proved, carrying BOTH roots"
    )


def test_a_derivation_whose_steps_do_check_keeps_them() -> None:
    """The fallback is a fallback. Good steps are the teaching and are never thrown away."""
    plan = _plan(
        {
            "pipeline": "math",
            "op": "derivation",
            "equation": "2*x + 3 = 7",
            "var": "x",
            "steps": ["2*x = 4", "x = 2"],
        }
    )
    written = [o.get("text", "") for o in plan.objects if o["kind"] == "write"]
    assert "2*x = 4" in written, "the learner's own middle step survived"


def test_a_lens_never_puts_a_unit_on_a_number_nobody_gave_it() -> None:
    """The board wrote "15.0 m" for an image 15 CENTIMETRES from the lens.

    The learner asked for "an object 30 cm in front of a converging lens of focal length 10 cm".
    ``_ray`` is unit-agnostic — it works in whatever the numbers arrive in — and then hard-coded
    ``unit="m"`` on the image distance it drew. So a number the CAS had genuinely verified was
    published with a unit nobody had verified and nobody had given, wrong by a factor of a hundred.
    The second opinion caught it on the live run of 2026-09-05, and it is the exact shape of
    failure this product cannot have: a child believes it.

    The verifier signs the MAGNITUDE. Only the learner's own question carries the unit, so the
    board writes one when it was told one and writes none when it was not.
    """
    bare = _plan(
        {"pipeline": "physics", "op": "ray", "focal_length": 10.0, "object_distance": -30.0}
    )
    assert bare.objects, bare.refusals
    image = next(o for o in bare.objects if o["kind"] == "number" and abs(o["value"] - 15.0) < 0.01)
    assert not image.get("unit"), f"a unit nobody gave: {image.get('unit')!r}"

    told = _plan(
        {
            "pipeline": "physics",
            "op": "ray",
            "focal_length": 10.0,
            "object_distance": -30.0,
            "unit": "cm",
        }
    )
    image = next(o for o in told.objects if o["kind"] == "number" and abs(o["value"] - 15.0) < 0.01)
    assert image["unit"] == "cm"


def test_the_board_can_draw_a_right_triangle_from_its_legs() -> None:
    """"A right triangle has legs of 3 cm and 4 cm. draw it and work out the hypotenuse."

    The commonest figure in Class 9 there is, and the board could not draw it. ``construction`` knew
    one thing, the perpendicular bisector, so the model had nowhere to send a triangle and the
    learner got an explanation over an empty board on two separate live runs (2026-09-05).

    The hypotenuse is COMPUTED here and proved twice — the closed form against the distance between
    the two vertices the triangle was actually drawn from — because the last line of this problem is
    the whole problem.
    """
    plan = _plan(
        {
            "pipeline": "math",
            "op": "construction",
            "what": "right_triangle",
            "legs": [3.0, 4.0],
            "unit": "cm",
        }
    )
    assert plan.objects, plan.refusals
    assert any(o["kind"] == "polygon" for o in plan.objects), "the triangle itself"
    numbers = {round(o["value"], 4): o for o in plan.objects if o["kind"] == "number"}
    assert 5.0 in numbers, f"the hypotenuse is not on the board: {sorted(numbers)}"
    assert numbers[5.0]["unit"] == "cm"
    ran = {c.name for c in plan.ledger.checks}
    assert numbers[5.0]["check"] in ran
    assert {3.0, 4.0} <= set(numbers), "and so are the legs it was worked out from"


def test_a_right_triangle_needs_two_positive_legs() -> None:
    plan = _plan(
        {"pipeline": "math", "op": "construction", "what": "right_triangle", "legs": [3.0, 0.0]}
    )
    assert not plan.objects
    assert plan.refusals
