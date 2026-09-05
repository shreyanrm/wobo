"""The question bank, and the truth each question is judged against.

Two rules govern this file.

**The truth is computed here, a different way round from the product.** ``board/pipelines`` asks
SymPy inside the verifier's sandbox; the numbers below are worked out with the standard library
and plain arithmetic, deliberately by a different route, so a mistake would have to be made twice
in two places to survive. That is the same doctrine ``tests/test_board_golden.py`` applies to the
twelve recorded boards, applied here to a live model's answer.

**A claim names the quantity, never the number.** ``"the answer is 5"`` is not checkable by
looking for ``"5"``: a step number, a page reference and a year are all fives. A claim gives a
regex that finds the QUANTITY being talked about and lists every value that would be right (a root
set has two, a rounded figure has a tolerance). Anything found that is not in the set is a
contradiction against ground truth, and a contradiction is the worst thing this product can do, so
it fails the run rather than lowering a score.

**And the claim is matched against the board the product really draws.** Every claim here fires on
this case's own recorded transcript in ``harness/fixtures/``, and ``test_teaching_harness.py``
holds them to it, because the version of this file that came before matched prose written to suit
the regex and matched nothing at all on the product: eight of nine claims never fired on a real
run, and a timeline dating the Jallianwala Bagh massacre to 1921 scored four out of four.
``checks.claimed_values`` says how the matching works now.

Questions are drawn from the boards this product actually serves (``content/catalogs``) and from
the subjects ``SUBJECTS.md`` names. Nothing here invents a syllabus: each case says which board
and class it belongs to so a weak subject can be read off the report by board.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

# --- ground truth, computed here and nowhere else ---------------------------------------------
#
# Standard gravity as the physics boards use it (``tests/test_board_golden.py`` uses the same
# figure, which is the point: two independent recomputations have to agree on the constant or
# they are not checking the same world).
G = 9.81


def _quadratic_roots(a: float, b: float, c: float) -> tuple[float, ...]:
    """Roots of ax^2 + bx + c, from the formula, not from a solver."""
    disc = b * b - 4 * a * c
    if disc < 0:
        return ()
    root = math.sqrt(disc)
    return tuple(sorted({(-b + root) / (2 * a), (-b - root) / (2 * a)}))


def _projectile_apex(v0: float, angle_deg: float) -> dict[str, float]:
    """Apex height, time and horizontal speed, from the kinematics."""
    vy = v0 * math.sin(math.radians(angle_deg))
    vx = v0 * math.cos(math.radians(angle_deg))
    return {
        "height": vy * vy / (2 * G),
        "time": vy / G,
        "speed": vx,
        "range": 2 * vx * vy / G,
    }


def _thin_lens(focal: float, object_distance: float) -> dict[str, float]:
    """Image distance and magnification for a thin lens, real-is-positive convention.

    1/v - 1/u = 1/f with u negative for an object in front of the lens (the convention
    ``board/pipelines/physics.py`` documents), written here as the school form 1/v = 1/f - 1/u
    with u taken positive, so the two derivations do not share an algebraic step.
    """
    v = 1.0 / (1.0 / focal - 1.0 / object_distance)
    return {"image_distance": v, "magnification": -v / object_distance}


QUADRATIC_ROOTS = _quadratic_roots(1, -5, 6)
PROJECTILE = _projectile_apex(20.0, 45.0)
LENS = _thin_lens(10.0, 30.0)
#: The tangent to y = x^2 at x = 1: the derivative is 2x, so the slope is 2 and the point is (1, 1).
TANGENT_SLOPE = 2 * 1.0
#: 3-4-5, from the theorem itself rather than from the well known triple.
HYPOTENUSE = math.sqrt(3.0**2 + 4.0**2)


@dataclass(frozen=True)
class Claim:
    """One quantity the answer may assert, and every value that would be right.

    ``about`` is a regex that names the QUANTITY, never the number. It is matched two ways, and
    ``checks.claimed_values`` is where both live:

    * against every board ``number``'s identity — the verifier check it names, its unit, its label
      and the words on the objects sharing its anchor. The value checked is that object's own
      ``value``, so nothing depends on how the board's text happens to be joined together.
    * against every sentence of the spoken line, the ask prompt and the glyphs the hand writes,
      where the value is the nearest number within ``window`` characters, after the phrase for
      preference and before it otherwise.

    Anything found that is not in ``truth`` is a contradiction against ground truth, and a
    contradiction fails the run rather than lowering a score. Anything in ``must_include`` that is
    never stated, when something was, is a weakness rather than a contradiction.
    """

    name: str
    about: str
    truth: tuple[float, ...]
    tolerance: float = 1e-6
    #: ``board`` when the only place this quantity is identifiable is the hand's own labelling,
    #: ``prose`` when the phrase is a sentence's and would be ambiguous on a board.
    where: str = "both"
    #: How far from the naming phrase a value may sit, in characters, inside one sentence.
    window: int = 24
    #: Values that must be among those asserted, when the claim asserted anything at all.
    must_include: tuple[float, ...] = ()
    #: Read counts written as words ("two boxes") as numbers. Off by default: it widens what a
    #: phrase can reach, so it is turned on only where a tutor would say the quantity out loud.
    words: bool = False


@dataclass(frozen=True)
class Case:
    id: str
    board: str
    grade: str
    subject: str
    ask: str
    #: ``board`` streams over SSE and may draw; ``prose`` is the ordinary five-path turn.
    mode: str = "board"
    #: Extra context blocks merged into ``payload.context`` — the dossier, the canvas, the route.
    context: dict[str, Any] = field(default_factory=dict)
    #: Does the question ask for a drawing? An empty board then is a failure, not a style choice.
    needs_drawing: bool = False
    #: At least one object of one of these kinds must be drawn when ``needs_drawing``.
    expect_kinds: frozenset[str] = frozenset()
    claims: tuple[Claim, ...] = ()
    #: Words that must appear somewhere in what the learner receives (any one of them).
    #:
    #: These are matched as WORDS, not as substrings: "over" is inside "moreover", "however",
    #: "discover" and "overall", and a generic fractions explanation containing "Moreover" used to
    #: score 4 out of 4 on the cricket learner's persona law. So write the words out, inflections
    #: and all, rather than a stem — a stem is a substring test wearing a word's clothes.
    expect_any: tuple[str, ...] = ()
    #: Words that must NOT appear. Used for the law that a hint never hands the final value.
    forbid: tuple[str, ...] = ()
    #: The learner's own world, when the dossier carries one — the analogy rung is judged on it.
    world: str | None = None
    #: Wobo must hand the next move back rather than closing the problem out.
    expect_question: bool = True
    #: What the words say is on the board, for the judge's drawing check.
    drawing_brief: str = ""


#: A root of a quadratic, as this product actually writes one. Two shapes, and the board uses the
#: second: "x = 2" in a sentence, and the factor "(x - 2)" on the board's own working. The opening
#: bracket is what keeps it off the given equation, where "5*x + 6" is not a root of anything.
_A_ROOT = r"\bx\s*=|\(\s*x\s*[-−]"


CASES: tuple[Case, ...] = (
    # --- mathematics ------------------------------------------------------------------------
    Case(
        id="math.cbse.10.quadratic",
        board="CBSE",
        grade="Class 10",
        subject="mathematics",
        ask="solve x^2 - 5x + 6 = 0 and show me on the board how the factors work",
        needs_drawing=True,
        expect_kinds=frozenset({"write", "label", "number", "tex"}),
        claims=(
            Claim(
                name="roots of x^2 - 5x + 6",
                about=_A_ROOT,
                truth=QUADRATIC_ROOTS,
                must_include=QUADRATIC_ROOTS,
            ),
        ),
        expect_any=("factor", "factorise", "factorize", "product", "sum"),
        drawing_brief="the factorisation of x squared minus five x plus six, worked on the board",
    ),
    Case(
        id="math.cbse.11.tangent",
        board="CBSE",
        grade="Class 11",
        subject="mathematics",
        ask="graph y = x^2 and draw the tangent at x = 1",
        needs_drawing=True,
        expect_kinds=frozenset({"curve", "axis", "line"}),
        claims=(
            Claim(
                # The board hangs the value off the point where the tangent touches, beside a note
                # reading "slope here", and names the check ``board.numbers_agree:tangent slope``.
                name="slope of the tangent to y = x^2 at x = 1",
                about=r"slope|gradient",
                truth=(TANGENT_SLOPE,),
                tolerance=1e-3,
                must_include=(TANGENT_SLOPE,),
            ),
        ),
        drawing_brief="the parabola y = x squared with a tangent line touching it at x = 1",
    ),
    Case(
        id="math.icse.9.pythagoras",
        board="ICSE",
        grade="Class 9",
        subject="mathematics",
        ask="a right triangle has legs of 3 cm and 4 cm. draw it and work out the hypotenuse",
        needs_drawing=True,
        expect_kinds=frozenset({"polygon", "polyline", "line", "curve"}),
        claims=(
            Claim(
                # Every length this board draws names the same check, ``numbers_agree:hypotenuse``,
                # so the claim is the whole triple rather than the one side: the three centimetre
                # figures on a 3-4 right triangle are 3, 4 and 5, and the 5 has to be among them.
                # A board that drew 6 for the hypotenuse contradicts; one that never drew it at
                # all is a weakness, which is the honest difference between the two.
                name="the three sides of a 3-4 right triangle, in centimetres",
                about=r"hypotenuse",
                truth=(3.0, 4.0, HYPOTENUSE),
                tolerance=1e-3,
                must_include=(HYPOTENUSE,),
            ),
        ),
        expect_any=("square", "squares", "squared", "pythagoras", "theorem"),
        drawing_brief="a right-angled triangle with legs of three and four and its hypotenuse",
    ),
    Case(
        # The graduated-hint law (``wobo.WOBO_SYSTEM``): when the learner is WORKING a problem,
        # Wobo nudges and never hands the final value of x. The canvas below is what makes this
        # a working turn rather than a question.
        id="math.ib.hint.no-final-answer",
        board="IB Diploma Programme",
        grade="MYP 4",
        subject="mathematics",
        ask="i am stuck, what do i do next",
        mode="prose",
        context={
            "canvas": {"equation": "2*x + 3 = 7", "steps": ["2*x + 3 = 7", "2*x = 4"]},
            "curriculum": {"nodeName": "linear equations in one variable"},
        },
        claims=(),
        forbid=("x = 2", "x=2", "x is 2"),
        expect_question=True,
        drawing_brief="",
    ),
    # --- physics ----------------------------------------------------------------------------
    Case(
        id="physics.cbse.11.projectile",
        board="CBSE",
        grade="Class 11",
        subject="physics",
        ask="a ball is thrown at 20 m/s at 45 degrees. draw its path and tell me how high it gets",
        needs_drawing=True,
        expect_kinds=frozenset({"curve", "polyline", "axis"}),
        claims=(
            Claim(
                name="apex height of a 20 m/s 45 degree throw",
                about=r"apex height|maximum height|highest point|greatest height",
                truth=(PROJECTILE["height"],),
                tolerance=0.6,
                must_include=(PROJECTILE["height"],),
            ),
            Claim(
                name="range of a 20 m/s 45 degree throw",
                about=r"\brange\b",
                truth=(PROJECTILE["range"],),
                tolerance=0.6,
            ),
        ),
        drawing_brief="the parabolic flight path of a ball thrown at forty five degrees",
    ),
    Case(
        id="physics.icse.10.lens",
        board="ICSE",
        grade="Class 10",
        subject="physics",
        ask=(
            "draw the ray diagram for an object 30 cm in front of a converging lens "
            "of focal length 10 cm"
        ),
        needs_drawing=True,
        expect_kinds=frozenset({"line", "polyline", "arrow", "curve", "ellipse"}),
        claims=(
            Claim(
                # Both numbers on this board name the same CAS check, so what tells them apart is
                # the unit: the centimetre figure is a distance, and the only distances on a ray
                # diagram for u = 30 and f = 10 are those two and the image at 15.
                name="the distances on a lens board with f = 10 cm and u = 30 cm",
                about=r"\bcm\b",
                truth=(10.0, 30.0, LENS["image_distance"]),
                tolerance=0.05,
                where="board",
                must_include=(LENS["image_distance"],),
            ),
            Claim(
                # The other number hangs off the image arrow, beside the label "image".
                name="magnification for f = 10 cm, u = 30 cm",
                about=r"\bimage\b",
                truth=(LENS["magnification"],),
                tolerance=0.01,
                where="board",
            ),
        ),
        drawing_brief="a converging lens with two rays from the object meeting to form the image",
    ),
    # --- chemistry --------------------------------------------------------------------------
    Case(
        id="chem.cbse.10.balance",
        board="CBSE",
        grade="Class 10",
        subject="chemistry",
        ask="balance the equation for methane burning in oxygen and show me the coefficients",
        needs_drawing=True,
        expect_kinds=frozenset({"write", "label", "number", "tex"}),
        claims=(
            Claim(
                # The one coefficient a wrong balance always gets wrong. CH4 + 2 O2 -> CO2 + 2 H2O:
                # counted here by hand (4 H on the left needs 2 H2O; 4 O on the right needs 2 O2).
                name="oxygen coefficient in the combustion of methane",
                about=r"\bO2\b|\bO₂\b",
                truth=(2.0,),
                must_include=(2.0,),
            ),
        ),
        expect_any=("ch4", "methane"),
        drawing_brief="the balanced equation for methane burning, with its coefficients",
    ),
    # --- biology ----------------------------------------------------------------------------
    Case(
        id="bio.cbse.10.punnett",
        board="CBSE",
        grade="Class 10",
        subject="biology",
        ask="cross Aa with Aa and draw me the punnett square, then tell me the ratio",
        needs_drawing=True,
        expect_kinds=frozenset({"grid", "table", "label", "write"}),
        claims=(
            Claim(
                # 3:1 phenotype, counted by hand off the four boxes AA, Aa, aA, aa. The board draws
                # both halves of the ratio and names the check ``numbers_agree:punnett cells``.
                name="the phenotypic ratio of an Aa x Aa cross",
                about=r"punnett cells",
                truth=(3.0, 1.0),
                must_include=(3.0, 1.0),
            ),
            Claim(
                # The boxes showing the dominant phenotype: AA, Aa and aA is three of four. A
                # live run asked a Class 10 learner "which TWO boxes show the dominant
                # phenotype?" in the ask frame, which is a wrong fact taught to a child in the
                # one place no check used to read.
                name="boxes showing the dominant phenotype in an Aa x Aa cross",
                about=r"\bboxes\b|\bcells\b|\bsquares\b",
                truth=(3.0,),
                where="prose",
                window=12,
                words=True,
            ),
        ),
        # 1:2:1 genotype, 3:1 phenotype. Counted by hand off the four boxes: AA, Aa, aA, aa.
        # The ratio, however a tutor writes it: "3:1", "3 : 1", or spelled into the sentence as
        # "3 dominant : 1 recessive", which is the form the recorded turn actually used.
        expect_any=(
            "3:1",
            "3 : 1",
            "3 dominant",
            "1:2:1",
            "1 : 2 : 1",
            "three to one",
        ),
        drawing_brief="a two by two punnett square with the four genotypes in its cells",
    ),
    Case(
        id="bio.icse.9.plant-cell",
        board="ICSE",
        grade="Class 9",
        subject="biology",
        ask="draw a plant cell and label the parts",
        needs_drawing=True,
        expect_kinds=frozenset({"polygon", "ellipse", "curve", "label", "write"}),
        claims=(),
        expect_any=("cell wall", "chloroplast", "vacuole", "nucleus"),
        drawing_brief="a plant cell with its wall, nucleus, vacuole and chloroplasts labelled",
    ),
    # --- social science ---------------------------------------------------------------------
    Case(
        id="social.cbse.10.timeline",
        board="CBSE",
        grade="Class 10",
        subject="social science",
        ask=(
            "draw me a timeline of the national movement from the Jallianwala Bagh massacre "
            "to independence"
        ),
        needs_drawing=True,
        expect_kinds=frozenset({"line", "polyline", "label", "write", "number"}),
        claims=(
            # The board draws each year as its own object above the event it belongs to, sharing
            # the tick they both hang off, so the year and its name are one thing here. In a
            # sentence the same fact is said the long way round ("the Jallianwala Bagh massacre
            # happened in 1919"), which is why these three carry a wider window than the default.
            Claim(
                name="year of the Jallianwala Bagh massacre",
                about=r"jallianwala",
                truth=(1919.0,),
                window=60,
                must_include=(1919.0,),
            ),
            Claim(
                name="year of the Dandi salt march",
                about=r"dandi|salt march",
                truth=(1930.0,),
                window=60,
                must_include=(1930.0,),
            ),
            Claim(
                name="year of independence",
                about=r"independen\w*",
                truth=(1947.0,),
                window=60,
                must_include=(1947.0,),
            ),
        ),
        drawing_brief="a horizontal timeline with dated events along it",
    ),
    # --- the teaching itself ----------------------------------------------------------------
    Case(
        # The dossier carries the learner's world. The persona law is explicit: "Reach for THEIR
        # world for every example and analogy rather than a generic one."
        id="teach.their-world.cricket",
        board="CBSE",
        grade="Class 7",
        subject="mathematics",
        ask="i do not get equivalent fractions, can you explain them",
        mode="prose",
        world="cricket",
        context={
            "curriculum": {"nodeName": "equivalent fractions"},
            "lifetime": {
                "learner": {"name": "the learner", "age": 12, "grade": "Class 7", "board": "CBSE"},
                "facts": ["plays cricket every evening", "opens the batting for the school team"],
                "twinSummary": "into cricket; learns best from a worked example before the rule",
            },
        },
        expect_any=(
            "cricket",
            "bat",
            "bats",
            "batting",
            "over",
            "overs",
            "run",
            "runs",
            "wicket",
            "wickets",
            "bowl",
            "bowler",
            "bowling",
            "innings",
        ),
        drawing_brief="",
    ),
    Case(
        # The prerequisite case. The learner's own words say the ground beneath is missing; a tutor
        # that ploughs on with the topic has failed the claim the product makes about itself.
        id="teach.prerequisite.integers",
        board="CBSE",
        grade="Class 7",
        subject="mathematics",
        ask=(
            "we are on rational numbers but i keep getting the minus signs wrong when i add "
            "them, i do not really get negative numbers"
        ),
        mode="prose",
        context={"curriculum": {"nodeName": "rational numbers"}},
        expect_any=(
            "integer",
            "integers",
            "negative",
            "negatives",
            "number line",
            "minus",
            "below zero",
        ),
        drawing_brief="",
    ),
)


def by_id(case_id: str) -> Case:
    for case in CASES:
        if case.id == case_id:
            return case
    raise KeyError(case_id)


def subjects() -> tuple[str, ...]:
    return tuple(sorted({c.subject for c in CASES}))


def boards() -> tuple[str, ...]:
    return tuple(sorted({c.board for c in CASES}))
