"""Nothing in the product ever checked an answer.

Fifty-four quiz keys shipped in the wave-30 content lab and every one of them was verified BY
HAND, with SymPy, by a judge reading the artifacts afterwards. The pipeline itself had no opinion:
``plexus/lint.py`` proved an artifact was not broken and never once proved it was not wrong. These
tests are the missing opinion — the real items from the lab, keys and all, plus the defects a
content model actually emits.

The corpus below is copied verbatim out of ``.lab/artifacts/*/*/compose.json``. Its job is the
half of this feature that is easy to get wrong: a checker that refuses good content is worse than
no checker, because its verdict routes an expensive rebuild. Fifty-three of these keys are right
and must stay untouched; ONE is the ISC boss item the judge caught, which accepts ``10`` for
``x² + px + 25 = 0`` when the answer is p = ±10.
"""

from __future__ import annotations

from typing import Any

from wobo_gateway.plexus.lint import lint_artifact
from wobo_gateway.plexus.maths import check_compose


def _compose(**parts: Any) -> dict[str, Any]:
    return {"topic": "t", "difficulty": "core", "cards": [], "workbook": [], "boss": [], **parts}


# --- the real lab corpus ---------------------------------------------------------------------

MATHS_LINEAR = _compose(
    workbook=[
        {
            "id": "w1",
            "type": "mcq",
            "prompt": "Solve 5x = 35.",
            "options": ["x = 5", "x = 7", "x = 30", "x = 40"],
            "answer": "x = 7",
        },
        {
            "id": "w2",
            "type": "fill",
            "prompt": "To keep an equation balanced, do the same operation to both ________.",
            "answer": "sides",
        },
        {
            "id": "w3",
            "type": "mcq",
            "prompt": "Solve 2x + 4 = 16.",
            "options": ["x = 4", "x = 6", "x = 8", "x = 10"],
            "answer": "x = 6",
        },
    ],
    boss=[
        {
            "id": "b1",
            "type": "mcq",
            "prompt": "Solve 7x + 5 = 47.",
            "options": ["x = 5", "x = 6", "x = 7", "x = 8"],
            "answer": "x = 6",
        },
        {"id": "b2", "type": "fill", "prompt": "For 5x − 8 = 27, x = ________.", "answer": "7"},
        {
            "id": "b3",
            "type": "mcq",
            "prompt": "How many solutions does 6x + 4 = 6x + 4 have?",
            "options": [
                "No solution",
                "One solution",
                "Infinitely many solutions",
                "Two solutions",
            ],
            "answer": "Infinitely many solutions",
        },
    ],
    cards=[
        {
            "id": "c4",
            "derivation": {
                "id": "der1",
                "formula": "x = (c - b) / a",
                "label": "solving ax + b = c",
                "steps": [
                    {"expr": "ax = c - b", "note": "subtract b from both sides"},
                    {"expr": "x = (c - b) / a", "note": "divide both sides by non-zero a"},
                ],
            },
        }
    ],
)

MATHS_QUADRATIC = _compose(
    workbook=[
        {
            "id": "w1",
            "type": "mcq",
            "prompt": "What does D > 0 tell you about a quadratic equation?",
            "options": [
                "It has two distinct real roots",
                "It has two equal real roots",
                "It has no real roots",
            ],
            "answer": "It has two distinct real roots",
        },
        {
            "id": "w2",
            "type": "fill",
            "prompt": "The expression b² − 4ac is called the ________.",
            "answer": "discriminant",
        },
        {
            "id": "w3",
            "type": "mcq",
            "prompt": "What is the nature of roots of x² + 4x + 4 = 0?",
            "options": ["Two distinct real roots", "Two equal real roots", "No real roots"],
            "answer": "Two equal real roots",
        },
    ],
    boss=[
        {
            "id": "b1",
            "type": "mcq",
            "prompt": "For 2x² − 3x + 5 = 0, what is the nature of the roots?",
            "options": [
                "Two distinct real roots",
                "Two equal real roots",
                "No real roots",
                "One root is zero",
            ],
            "answer": "No real roots",
        },
        {
            "id": "b2",
            "type": "fill",
            "prompt": "For x² + 8x + k = 0 to have equal roots, k must be ________.",
            "answer": "16",
        },
        {
            "id": "b3",
            "type": "mcq",
            "prompt": "Which value of p makes x² + px + 25 = 0 have equal roots?",
            "options": ["5", "10", "20", "25"],
            "answer": "10",
        },
    ],
    cards=[
        {
            "id": "c4",
            "derivation": {
                "id": "quadratic-formula-discriminant",
                "formula": "x = (-b ± √(b² - 4ac)) / 2a",
                "label": "the quadratic formula",
                "steps": [
                    {"expr": "ax² + bx + c = 0", "note": "start with the standard equation"},
                    {"expr": "x = (-b ± √(b² - 4ac)) / 2a", "note": "completing the square"},
                    {"expr": "D = b² - 4ac", "note": "the expression inside the square root"},
                ],
            },
        },
        {
            "id": "c5",
            "wordProblem": {
                "id": "equal-roots-k",
                "title": "Choose k for equal roots",
                "problem": "Find the value of k for which x² − 6x + k = 0 has equal roots.",
                "given": ["a = 1, b = −6, c = k", "Equal roots require D = 0"],
                "find": "k",
                "plan": ["Write the discriminant b² − 4ac.", "Set it equal to zero."],
                "solve": [
                    {"expr": "D = (-6)² - 4(1)(k) = 36 - 4k", "note": "substitute"},
                    {"expr": "36 - 4k = 0", "note": "equal roots need zero discriminant"},
                    {"expr": "k = 9", "note": "solve the linear equation"},
                ],
                "answer": "k = 9",
            },
        },
    ],
)

MATHS_FRACTIONS = _compose(
    workbook=[
        {
            "id": "w1",
            "type": "mcq",
            "prompt": "Which fraction is equivalent to 3/4?",
            "options": ["6/8", "3/8", "4/3", "7/8"],
            "answer": "6/8",
        },
        {
            "id": "w2",
            "type": "fill",
            "prompt": "Between 4/9 and 7/9, the greater fraction is ________.",
            "answer": "7/9",
        },
        {
            "id": "w3",
            "type": "mcq",
            "prompt": "Which comparison is correct?",
            "options": [
                "2/3 > 3/5",
                "2/3 < 3/5",
                "2/3 = 3/5",
                "2/3 cannot be compared with 3/5",
            ],
            "answer": "2/3 > 3/5",
        },
    ],
    boss=[
        {
            "id": "b1",
            "type": "mcq",
            "prompt": "Which fraction is equivalent to 18/24 in simplest form?",
            "options": ["3/4", "6/8", "9/12", "12/18"],
            "answer": "3/4",
        },
        {
            "id": "b2",
            "type": "fill",
            "prompt": "Write 5/6 as a fraction with denominator 24: ________.",
            "answer": "20/24",
        },
        {
            "id": "b3",
            "type": "mcq",
            "prompt": "Which fraction is the greatest?",
            "options": ["7/12", "3/5", "5/8", "2/3"],
            "answer": "2/3",
        },
    ],
    cards=[
        {
            "id": "c4",
            "derivation": {
                "id": "equivalent-rule-derivation",
                "formula": "a/b = (k×a)/(k×b)",
                "label": "the equivalent-fraction rule",
                "steps": [
                    {"expr": "(k×a)/(k×b) = (a/b)×(k/k)", "note": "the same factor k"},
                    {"expr": "(a/b)×1 = a/b", "note": "because k/k equals 1"},
                ],
            },
        }
    ],
)

# Physics, chemistry, biology and social science: keys made of MEANING, not arithmetic. Every one
# of them was verified correct by hand, and this module must have no opinion about any of them.
PROSE_KEYS = _compose(
    workbook=[
        {
            "id": "p1",
            "type": "fill",
            "prompt": "A cyclist covers 150 m in 30 s. The average speed is ________ m/s.",
            "answer": "5",
        },
        {
            "id": "p2",
            "type": "mcq",
            "prompt": "An atom has electronic configuration 2,8,7. How many electrons does it "
            "have?",
            "options": ["17", "15", "8", "27"],
            "answer": "17",
        },
        {
            "id": "p3",
            "type": "fill",
            "prompt": "The K shell can hold a maximum of ________ electrons.",
            "answer": "2",
        },
        {
            "id": "p4",
            "type": "mcq",
            "prompt": "What phenotype ratio is expected from RrYy × RrYy when the genes assort "
            "independently?",
            "options": ["3:1", "1:2:1", "9:3:3:1", "1:1:1:1"],
            "answer": "9:3:3:1",
        },
        {
            "id": "p5",
            "type": "fill",
            "prompt": "In a cross Tt × Tt, the probability of a dwarf offspring is ________.",
            "answer": "1/4",
        },
        {
            "id": "p6",
            "type": "mcq",
            "prompt": "Which ray travels almost undeviated through a thin lens?",
            "options": [
                "A ray through the optical centre",
                "A ray parallel to the principal axis",
                "A ray passing through the principal focus before the lens",
                "A ray reflected from the lens surface",
            ],
            "answer": "A ray through the optical centre",
        },
        {
            "id": "p7",
            "type": "fill",
            "prompt": "The Constitution came into force on 26 ________ 1950.",
            "answer": "January",
        },
        {
            "id": "p8",
            "type": "mcq",
            "prompt": "A horizontal line at -4 m/s on a velocity-time graph means the object is "
            "moving with",
            "options": [
                "constant velocity of 4 m/s in the opposite direction",
                "increasing speed of 4 m/s",
                "zero displacement",
                "constant speed of -4 m/s without direction",
            ],
            "answer": "constant velocity of 4 m/s in the opposite direction",
        },
    ],
)


# --- what the lab actually shipped -------------------------------------------------------------


def test_the_isc_boss_item_that_accepts_ten_for_plus_or_minus_ten() -> None:
    """The one defensible key complaint in 54 keys, and nothing in the product could see it."""
    reasons = check_compose(MATHS_QUADRATIC)
    assert len(reasons) == 1, reasons
    assert "b3" in reasons[0] and "-10" in reasons[0], reasons[0]


def test_a_wrong_key_is_refused_by_the_lint_gate_itself() -> None:
    """The gate the pipeline actually consults must fail closed on a disproved key."""
    good = lint_artifact("compose", MATHS_LINEAR)
    assert good.ok, good.reasons

    wrong = _compose(
        workbook=[
            {
                "id": "w1",
                "type": "mcq",
                "prompt": "Solve 2x + 4 = 16.",
                "options": ["x = 4", "x = 6", "x = 8", "x = 10"],
                "answer": "x = 8",
            }
        ]
    )
    verdict = lint_artifact("compose", wrong)
    assert not verdict.ok
    assert any("does not satisfy" in r for r in verdict.reasons), verdict.reasons


def test_the_keys_the_judges_verified_by_hand_are_left_alone() -> None:
    """Fifty-three correct keys across four subjects and three boards. Not one may be touched."""
    assert check_compose(MATHS_LINEAR) == []
    assert check_compose(MATHS_FRACTIONS) == []
    assert check_compose(PROSE_KEYS) == []


# --- each family, proved and declined ----------------------------------------------------------


def test_an_equation_key_must_satisfy_its_own_equation() -> None:
    item = {
        "id": "i1",
        "type": "fill",
        "prompt": "For 5x − 8 = 27, x = ________.",
        "answer": "7",
    }
    assert check_compose(_compose(boss=[item])) == []
    assert check_compose(_compose(boss=[{**item, "answer": "8"}]))


def test_an_mcq_may_not_carry_a_second_correct_option() -> None:
    twice = {
        "id": "i1",
        "type": "mcq",
        "prompt": "Solve x² = 25.",
        "options": ["5", "-5", "6", "7"],
        "answer": "5",
    }
    reasons = check_compose(_compose(boss=[twice]))
    assert any("also solves" in r for r in reasons), reasons


def test_a_key_must_name_every_root_unless_the_prompt_asks_for_one() -> None:
    both = {"id": "i1", "type": "fill", "prompt": "Solve x² = 49.", "answer": "±7"}
    assert check_compose(_compose(boss=[both])) == []

    half = {**both, "answer": "7"}
    assert any("does not name" in r for r in check_compose(_compose(boss=[half])))

    asked = {**half, "prompt": "Solve x² = 49 for the positive value of x."}
    assert check_compose(_compose(boss=[asked])) == []


def test_the_nature_of_the_roots_is_the_discriminants_to_decide() -> None:
    item = {
        "id": "i1",
        "type": "mcq",
        "prompt": "What is the nature of roots of x² + 4x + 4 = 0?",
        "options": ["Two distinct real roots", "Two equal real roots", "No real roots"],
        "answer": "Two equal real roots",
    }
    assert check_compose(_compose(workbook=[item])) == []
    wrong = check_compose(_compose(workbook=[{**item, "answer": "No real roots"}]))
    assert any("discriminant" in r for r in wrong), wrong


def test_an_option_that_is_a_numeric_relation_is_simply_true_or_false() -> None:
    item = {
        "id": "i1",
        "type": "mcq",
        "prompt": "Which comparison is correct?",
        "options": ["2/3 > 3/5", "2/3 < 3/5", "2/3 = 3/5", "2/3 cannot be compared with 3/5"],
        "answer": "2/3 < 3/5",
    }
    reasons = check_compose(_compose(workbook=[item]))
    assert any("false statement" in r for r in reasons), reasons


def test_a_line_of_working_that_is_false_is_refused() -> None:
    card = {
        "id": "c1",
        "derivation": {
            "id": "d1",
            "formula": "x",
            "steps": [{"expr": "x = x + 1", "note": "add one to one side only"}],
        },
    }
    reasons = check_compose(_compose(cards=[card]))
    assert any("is false" in r for r in reasons), reasons


def test_a_stated_answer_must_survive_its_own_working() -> None:
    assert check_compose(MATHS_QUADRATIC)[0].startswith("boss item 'b3'")

    broken = {
        "id": "c5",
        "wordProblem": {
            "id": "wp1",
            "problem": "Find k for which x² − 6x + k = 0 has equal roots.",
            "given": ["a = 1"],
            "find": "k",
            "plan": ["discriminant"],
            "solve": [{"expr": "36 - 4k = 0", "note": "zero discriminant"}],
            "answer": "k = 8",
        },
    }
    reasons = check_compose(_compose(cards=[broken]))
    assert any("does not satisfy its own working" in r for r in reasons), reasons


# --- the declines, which are the other half of the design ---------------------------------------


def test_a_given_in_the_prompt_is_not_a_question() -> None:
    """ "If x = 3, what is 2x?" states a value; reading it as an equation to solve would refuse a
    perfectly good item."""
    item = {"id": "i1", "type": "fill", "prompt": "If x = 3, what is 2x?", "answer": "6"}
    assert check_compose(_compose(boss=[item])) == []


def test_a_prompt_that_asks_for_a_derived_quantity_is_declined() -> None:
    """The unknown is 4 and the key is 6, and both are right: the item asks for x + 2, not x.
    Reading the equation as the question would refuse a perfectly good item."""
    item = {
        "id": "i1",
        "type": "fill",
        "prompt": "If 2x + 3 = 11, what is the value of x + 2?",
        "answer": "6",
    }
    assert check_compose(_compose(boss=[item])) == []


def test_a_key_made_of_meaning_is_declined_not_guessed_at() -> None:
    item = {
        "id": "i1",
        "type": "mcq",
        "prompt": "Why does aerobic respiration release more energy than anaerobic respiration?",
        "options": ["Glucose is broken down more completely", "It does not use glucose"],
        "answer": "Glucose is broken down more completely",
    }
    assert check_compose(_compose(workbook=[item])) == []


def test_prose_that_merely_contains_an_equals_sign_is_declined() -> None:
    item = {
        "id": "i1",
        "type": "fill",
        "prompt": "In the reaction C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O, the gas released is ________.",
        "answer": "carbon dioxide",
    }
    assert check_compose(_compose(workbook=[item])) == []


def test_the_seeds_stay_clean() -> None:
    """The honest floor must survive its own checker, or every offline course is refused."""
    from wobo_gateway.plexus import engines

    seed = engines._seed("compose", "linear equations in one variable", "core")
    assert check_compose(seed) == []
    assert lint_artifact("compose", seed).ok
