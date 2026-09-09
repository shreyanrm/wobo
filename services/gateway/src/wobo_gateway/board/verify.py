"""The gate every number crosses before it becomes ink.

BOARD.md §6: "The verifier (CAS, dimensional analysis, balance checks, fact base) runs before any
number is drawn. A failed check redraws or refuses; it never serves." This module is that gate.

Three rules it exists to enforce:

- **Code computes, the model does not.** A pipeline asks for ``f(1)``; it never accepts ``2`` from
  a plan. Every value here is produced by SymPy inside the verifier's spawned, wall-clock-bounded
  sandbox (:mod:`wobo_verifier.sandbox`) — the same process boundary that guards learner text,
  for the same reason: an expression is an evaluation and an evaluation is a CPU-burn door.
- **Parsing is the verifier's public job.** Nothing here parses a string itself. Text becomes a
  SymPy object through :func:`wobo_verifier.cas.parse_equation`, which carries the namespace
  guard, the token guard, the shape guard and the budget. What crosses back is an already-safe
  expression object, and only that is evaluated.
- **A failed check redraws once, then refuses.** :func:`redraw_once` is the whole policy: build,
  and if a check fails, build the simpler thing once; if that fails too, the object is refused and
  the board says nothing rather than something wrong.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from wobo_verifier import sandbox
from wobo_verifier.cas import CasError, parse_equation
from wobo_verifier.gate import CheckResult

#: How close two independently computed values must be to count as the same number. Board numbers
#: are drawn to a few significant figures; agreement below this is agreement.
TOLERANCE = 1e-6

MAX_SAMPLES = 400


class Unverified(Exception):
    """A quantity did not pass its check. Nothing built from it may be drawn.

    Carries the failed checks so a refusal can be honest about which one broke.
    """

    def __init__(self, reason: str, checks: Sequence[CheckResult] = ()) -> None:
        self.reason = reason
        self.checks = list(checks)
        super().__init__(reason)


@dataclass
class Ledger:
    """Every check a board turn ran, in order. Attached to the plan so a refusal is explainable
    and a served board can prove which verifier signed each number."""

    checks: list[CheckResult] = field(default_factory=list)

    def record(self, check: CheckResult) -> CheckResult:
        self.checks.append(check)
        if not check.passed:
            raise Unverified(check.detail or check.name, [check])
        return check

    def note(self, check: CheckResult) -> CheckResult:
        """Record without raising — for checks whose failure the caller handles itself."""
        self.checks.append(check)
        return check

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)

    def names(self) -> list[str]:
        return [c.name for c in self.checks]


# --- sandboxed SymPy: the only place a number is computed -----------------------------------
# These four run INSIDE the spawned sandbox worker, so they must stay importable module-level
# functions with picklable arguments (see wobo_verifier.sandbox).


def _eval_worker(expr: Any, var: str, xs: list[float]) -> list[float | None]:
    import sympy as sp

    symbol = sp.Symbol(var)
    out: list[float | None] = []
    for x in xs:
        try:
            value = expr.subs(symbol, sp.Float(x)).evalf()
            out.append(float(value) if value.is_real and value.is_finite else None)
        except (TypeError, ValueError, ArithmeticError, AttributeError):
            out.append(None)
    return out


def _diff_worker(expr: Any, var: str) -> Any:
    import sympy as sp

    return sp.simplify(sp.diff(expr, sp.Symbol(var)))


def _solve_worker(rows: list[list[float]], width: int) -> list[float] | None:
    """Smallest positive integer solution of a homogeneous system — chemical balancing."""
    import sympy as sp

    matrix = sp.Matrix(rows) if rows else sp.zeros(1, width)
    basis = matrix.nullspace()
    if len(basis) != 1:
        return None
    vector = basis[0]
    denominators = [sp.nsimplify(v).q for v in vector]
    scale = sp.ilcm(*denominators) if len(denominators) > 1 else denominators[0]
    scaled = [sp.nsimplify(v) * scale for v in vector]
    if any(v <= 0 for v in scaled):
        scaled = [-v for v in scaled]
    if any(v <= 0 or v != int(v) for v in scaled):
        return None
    divisor = sp.igcd(*[int(v) for v in scaled]) if len(scaled) > 1 else int(scaled[0])
    return [int(v) / int(divisor or 1) for v in scaled]


def _solve_equation_worker(equation: Any, var: str) -> list[str] | None:
    import sympy as sp

    roots = sp.solve(sp.Eq(equation.lhs, equation.rhs), sp.Symbol(var), dict=False)
    if not roots or len(roots) > 4:
        return None
    return [str(sp.nsimplify(r)) for r in roots]


def _monic_worker(equation: Any, var: str) -> str | None:
    """Both sides divided by the leading coefficient, as text. None when there is nothing to do."""
    import sympy as sp

    symbol = sp.Symbol(var)
    expression = sp.expand(equation.lhs - equation.rhs)
    try:
        polynomial = sp.Poly(expression, symbol)
    except sp.PolynomialError:
        return None
    lead = polynomial.LC()
    if lead == 0 or lead == 1 or lead.free_symbols == set():
        return None
    return str(sp.Poly(sp.expand(expression / lead), symbol).as_expr())


def _equal_worker(a: Any, b: Any) -> bool:
    import sympy as sp

    return bool(sp.simplify(a - b) == 0)


def _expression(text: str) -> Any:
    """One expression, parsed by the verifier's guarded parser. Raises :class:`Unverified`."""
    try:
        return parse_equation(f"y = {text}").rhs
    except (CasError, sandbox.SandboxError) as exc:
        raise Unverified(f"could not read the expression {text!r}: {exc}") from exc


def _bounded(func: Callable[..., Any], args: Sequence[Any], what: str) -> Any:
    try:
        return sandbox.run_bounded(func, args)
    except sandbox.SandboxError as exc:
        raise Unverified(f"{what} could not be computed: {exc}") from exc


def sample(expr_text: str, var: str, xs: Iterable[float]) -> list[tuple[float, float]]:
    """``[(x, f(x))]`` for the sample points where ``f`` is real and finite.

    The expression is parsed by the verifier and evaluated in its sandbox; nothing is computed
    in this process. Points where the function is undefined are dropped, not guessed.
    """
    points = [float(x) for x in xs]
    if not points:
        raise Unverified("no sample points")
    if len(points) > MAX_SAMPLES:
        raise Unverified(f"{len(points)} sample points (limit {MAX_SAMPLES})")
    expr = _expression(expr_text)
    values = _bounded(_eval_worker, (expr, var, points), f"the values of {expr_text!r}")
    return [(x, y) for x, y in zip(points, values, strict=True) if y is not None]


def value_at(expr_text: str, var: str, x: float) -> float:
    """One computed value. Raises when the function is undefined there."""
    got = sample(expr_text, var, [x])
    if not got:
        raise Unverified(f"{expr_text!r} is not defined at {var} = {x:g}")
    return got[0][1]


def derivative(expr_text: str, var: str) -> str:
    """``d/dvar`` of the expression, as text, computed symbolically in the sandbox."""
    expr = _expression(expr_text)
    return str(_bounded(_diff_worker, (expr, var), f"the derivative of {expr_text!r}"))


def solve_equation(equation: str, var: str = "x") -> list[str]:
    """The real solutions of an equation, computed by SymPy in the sandbox.

    The derivation pipeline uses this rather than accepting a final line from the model: the last
    step of a worked example is the one place a wrong number does the most damage.
    """
    try:
        parsed = parse_equation(equation)
    except (CasError, sandbox.SandboxError) as exc:
        raise Unverified(f"could not read the equation {equation!r}: {exc}") from exc
    roots = _bounded(_solve_equation_worker, (parsed, var), f"the solution of {equation!r}")
    if not roots:
        raise Unverified(f"{equation!r} has no single solution I can write down")
    return list(roots)


def monic(equation: str, var: str = "x") -> str:
    """The equation with its leading coefficient divided out — the first line of a derivation whose
    coefficients are letters.

    "Derive the first step of the quadratic formula from ax^2 + bx + c = 0" has no numbers in it, so
    there is nothing to solve and the whole board was refused (the evidence lab, 2026-09-09,
    ``turns/scratch/maths-quadratic-1440``). But the first step of that derivation is exactly this
    and it is provable: divide by a, and the chain check proves the solution set survived. Computed
    by SymPy in the sandbox like every other value here — never a rearrangement written by hand.
    """
    try:
        parsed = parse_equation(equation)
    except (CasError, sandbox.SandboxError) as exc:
        raise Unverified(f"could not read the equation {equation!r}: {exc}") from exc
    line = _bounded(_monic_worker, (parsed, var), f"the first step of {equation!r}")
    if not line:
        raise Unverified(f"{equation!r} has no leading coefficient to divide out")
    return f"{line} = 0"


def readable(label: str, text: str) -> CheckResult:
    """The expression was parsed by the verifier's guarded parser, so the numerals inside it are
    an expression rather than an assertion. This is what earns a formula or a function label the
    right to be written."""
    try:
        _expression(text)
    except Unverified as exc:
        return CheckResult(name=f"board.readable:{label}", passed=False, detail=exc.reason)
    return CheckResult(name=f"board.readable:{label}", passed=True, detail=text)


def expressions_agree(a: str, b: str) -> CheckResult:
    """Symbolic equality of two expressions, both parsed by the verifier."""
    try:
        left, right = _expression(a), _expression(b)
    except Unverified as exc:
        return CheckResult(name="board.expressions_agree", passed=False, detail=exc.reason)
    same = bool(_bounded(_equal_worker, (left, right), "the comparison"))
    return CheckResult(
        name="board.expressions_agree",
        passed=same,
        detail=f"{a} {'==' if same else '!='} {b}",
    )


def numbers_agree(label: str, first: float, second: float, tol: float = TOLERANCE) -> CheckResult:
    """Two independent computations of the same quantity must land on the same number.

    This is the board's cross-check: a projectile's apex from kinematics and from energy
    conservation are different routes to one height, and only agreement earns the ink.
    """
    scale = max(1.0, abs(first), abs(second))
    close = abs(first - second) <= tol * scale
    return CheckResult(
        name=f"board.numbers_agree:{label}",
        passed=close,
        detail=f"{label}: {first:.6g} vs {second:.6g}",
    )


def in_bounds(label: str, value: float, low: float, high: float) -> CheckResult:
    """A quantity a physical situation cannot leave — a probability, a ratio, a positive mass."""
    ok = low <= value <= high and value == value and abs(value) != float("inf")
    return CheckResult(
        name=f"board.in_bounds:{label}",
        passed=ok,
        detail=f"{label} = {value:.6g} in [{low:g}, {high:g}]",
    )


# --- the domain verifiers already in the brain ----------------------------------------------


def units_agree(expr: str, declared_unit: str, param_units: dict[str, str]) -> CheckResult:
    """Dimensional analysis through the brain's existing checker (plexus.dimensions)."""
    from wobo_gateway.plexus.dimensions import units_consistent

    ok = bool(units_consistent(expr, declared_unit, param_units))
    return CheckResult(
        name="board.units_agree",
        passed=ok,
        detail=f"{expr} carries {declared_unit}",
    )


def equation_balances(
    reactants: list[tuple[int, str]], products: list[tuple[int, str]]
) -> CheckResult:
    """Conservation of atoms, through the brain's existing balance checker (plexus.chem)."""
    from wobo_gateway.plexus.chem import is_balanced

    ok = bool(is_balanced(reactants, products))
    left = " + ".join(f"{n} {f}" for n, f in reactants)
    right = " + ".join(f"{n} {f}" for n, f in products)
    return CheckResult(name="board.equation_balances", passed=ok, detail=f"{left} -> {right}")


def balance(reactants: list[str], products: list[str]) -> list[int]:
    """Smallest whole-number coefficients that balance the equation. Raises if there are none.

    The coefficients are SOLVED, never asserted: one column per species, one row per element,
    the nullspace taken in the sandbox, then the result put back through the brain's independent
    balance checker so the answer is proved by a second route before a coefficient is drawn.
    """
    from wobo_gateway.plexus.chem import parse_formula

    species = [*reactants, *products]
    if not reactants or not products or len(species) > 12:
        raise Unverified("an equation needs both sides, and at most twelve species")
    counts = []
    for formula in species:
        parsed = parse_formula(formula)
        if parsed is None:
            raise Unverified(f"{formula!r} is not a formula I can read")
        counts.append(parsed)
    elements = sorted({el for c in counts for el in c})
    rows = [
        [
            float(counts[i].get(el, 0)) * (1.0 if i < len(reactants) else -1.0)
            for i in range(len(species))
        ]
        for el in elements
    ]
    solution = _bounded(_solve_worker, (rows, len(species)), "the balancing")
    if solution is None:
        raise Unverified("this equation does not balance with whole numbers")
    coefficients = [int(round(v)) for v in solution]
    if any(c <= 0 or c > 999 for c in coefficients):
        raise Unverified("the balancing coefficients are out of range")
    check = equation_balances(
        list(zip(coefficients[: len(reactants)], reactants, strict=True)),
        list(zip(coefficients[len(reactants) :], products, strict=True)),
    )
    if not check.passed:
        raise Unverified("the balancing did not survive the balance checker", [check])
    return coefficients


def fact_supported(concept_id: str, claims: Iterable[str]) -> CheckResult:
    """Labels on a biology or social board come from the fact base, never from imagination.

    When the fact base knows the concept, every claim must appear in it. When it does not know
    the concept at all the check does not pass silently — it fails, and the caller falls back to
    a curated table rather than drawing an unsupported label.
    """
    from wobo_gateway.plexus.factcheck import facts_for

    wanted = [c.strip().lower() for c in claims if str(c).strip()]
    if not wanted:
        return CheckResult(name="board.fact_supported", passed=False, detail="no claims")
    known = " ".join(facts_for(concept_id)).lower()
    if not known:
        return CheckResult(
            name="board.fact_supported",
            passed=False,
            detail=f"the fact base does not cover {concept_id!r}",
        )
    missing = [c for c in wanted if c not in known]
    return CheckResult(
        name="board.fact_supported",
        passed=not missing,
        detail="all supported" if not missing else f"unsupported: {missing[:4]}",
    )


# --- the redraw-once policy -------------------------------------------------------------------


def redraw_once[T](
    build: Callable[[], T],
    simpler: Callable[[], T] | None = None,
    *,
    what: str = "this",
) -> T:
    """BOARD.md §6: a failed check redraws once, then refuses.

    ``build`` is the board Wobo wanted to draw. ``simpler`` is the same idea with the unverifiable
    part removed — the curve without the tangent, the diagram without the computed label. If the
    first fails a check the simpler one is drawn instead; if that fails too, :class:`Unverified`
    propagates and nothing is drawn. It never serves.
    """
    try:
        return build()
    except Unverified as first:
        if simpler is None:
            raise
        try:
            return simpler()
        except Unverified as second:
            raise Unverified(
                f"{what} failed its check twice: {first.reason}; then {second.reason}",
                [*first.checks, *second.checks],
            ) from second


# --- the learner's own numbers ----------------------------------------------------------------
#
# THE ASK IS THE SOURCE OF EVERY GIVEN. A pipeline computes; it does not choose what it is
# computing about. "a convex lens of focal length 15 cm with the object 30 cm away" was drawn as a
# lens of focal length 10 with the image at 15 and a magnification of -0.5, every number signed
# `verified` by a CAS that had genuinely proved them — of the wrong lens. The verifier had proved
# an equation nobody asked about (the evidence lab, 2026-09-09, `turns/scratch/physics-lens-1440`).
#
# So the givens are read out of the learner's own sentence here, once, and a pipeline takes its
# quantity from this module rather than from whatever wrote the intent. The check that comes back
# names the words it read them from, so a board can prove that the number it drew is the number
# that was asked about — which is a different claim from "the arithmetic is right", and the one
# that was missing.

#: A number as a learner writes one, and the unit glued to it. `1,200` and `1.5` both read.
_NUMBER_RE = re.compile(
    r"(?<![\w.])(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*"
    r"(cm|mm|km|m/s|m|s|kg|g|n|v|a|ohms?|Ω|hz|°|degrees?|deg)?(?![\w])",
    re.IGNORECASE,
)
#: The number words a Class 6 to 12 learner types instead of a numeral ("with five labels").
_NUMBER_WORDS: dict[str, float] = {
    "zero": 0.0,
    "one": 1.0,
    "two": 2.0,
    "three": 3.0,
    "four": 4.0,
    "five": 5.0,
    "six": 6.0,
    "seven": 7.0,
    "eight": 8.0,
    "nine": 9.0,
    "ten": 10.0,
    "eleven": 11.0,
    "twelve": 12.0,
}
_WORD_RE = re.compile(r"\b([a-z]+)\b", re.IGNORECASE)
#: A cue further from its number than this is not naming it. About a clause.
_CUE_REACH = 40
_UNITS = {"degrees": "deg", "degree": "deg", "\u00b0": "deg", "ohms": "ohm", "\u03a9": "ohm"}


@dataclass(frozen=True)
class Given:
    """One number in the learner's own words, with where in the sentence they wrote it."""

    value: float
    unit: str | None
    #: Where the numeral sits in the ask, so a cue's distance from it can be measured.
    start: int
    end: int

    def distance(self, text: str, cues: Sequence[str]) -> int | None:
        """Characters from this number to the nearest of these cues, or None when none is near.

        Measured on the sentence itself rather than in words, which is the whole of the fix for
        "focal length 15 cm with the object 30 cm away" and for "20 m/s at 45 degrees": both
        numbers can see both cues, and only the distance says which cue is about which number.
        """
        low = text.lower()
        best: int | None = None
        for cue in cues:
            phrase = cue.strip().lower()
            if not phrase:
                continue
            at = low.find(phrase)
            while at >= 0:
                gap = (
                    0
                    if at < self.end and at + len(phrase) > self.start
                    else (self.start - (at + len(phrase)) if at < self.start else at - self.end)
                )
                if gap <= _CUE_REACH and (best is None or gap < best):
                    best = gap
                at = low.find(phrase, at + 1)
        return best


def given_numbers(ask: str) -> list[Given]:
    """Every number the learner wrote, in the order they wrote them.

    Numerals with their units, and the number WORDS ("five labels") a learner types as often —
    a count asked for in words is still a given, and a board that ignores it draws seven.
    """
    text = str(ask or "")
    if not text.strip():
        return []
    out: list[Given] = []
    for match in _NUMBER_RE.finditer(text):
        raw = match.group(1).replace(",", "")
        try:
            value = float(raw)
        except ValueError:  # pragma: no cover - the pattern only matches numerals
            continue
        unit = (match.group(2) or "").strip().lower() or None
        out.append(Given(value, _UNITS.get(unit, unit), match.start(1), match.end(1)))
    for match in _WORD_RE.finditer(text):
        word = match.group(1).lower()
        if word in _NUMBER_WORDS:
            out.append(Given(_NUMBER_WORDS[word], None, match.start(), match.end()))
    out.sort(key=lambda g: g.start)
    return out


def read_given(ask: str, *cues: str, unit: str | None = None) -> Given | None:
    """The number the learner attached to one of these words, or None when they named none.

    ``unit`` narrows it to the numbers carrying that unit, which is how a speed is told from an
    angle in "thrown at 20 m/s at 45 degrees" — the cue for one sits inside the other's reach.
    """
    text = str(ask or "")
    best: tuple[int, int, Given] | None = None
    for order, given in enumerate(given_numbers(text)):
        if unit is not None and given.unit != unit:
            continue
        distance = given.distance(text, cues)
        if distance is None:
            continue
        if best is None or (distance, order) < (best[0], best[1]):
            best = (distance, order, given)
    return best[2] if best else None


def all_given(ask: str, *cues: str, unit: str | None = None) -> list[Given]:
    """Every number within reach of one of these cues, in the order the learner wrote them —
    "legs 3 cm and 4 cm" is two givens for one cue, and a triangle needs both."""
    text = str(ask or "")
    return [
        g
        for g in given_numbers(text)
        if (unit is None or g.unit == unit) and g.distance(text, cues) is not None
    ]


def from_the_ask(
    label: str, ask: str, *cues: str, fallback: float | None = None, unit: str | None = None
) -> tuple[float | None, CheckResult | None]:
    """The learner's own number for this quantity, and the check that says where it came from.

    Returns ``(None, None)`` when the ask names nothing - the intent's value stands and no claim
    is made about it. Otherwise the learner's number is what gets drawn, and the check records
    both it and the value that was about to be drawn instead, so a board that had the wrong lens
    on it says so in its own ledger.
    """
    given = read_given(ask, *cues, unit=unit)
    if given is None:
        return None, None
    detail = f"{label}: the ask says {given.value:g}{' ' + given.unit if given.unit else ''}"
    if fallback is not None and abs(fallback - given.value) > TOLERANCE * max(
        1.0, abs(given.value)
    ):
        detail += f", not the {fallback:g} the plan carried"
    return given.value, CheckResult(name=f"board.from_the_ask:{label}", passed=True, detail=detail)


def unit_from_the_ask(ask: str, *cues: str) -> str | None:
    """The unit the learner wrote beside one of these words. ``cm`` is not ``m``: the board writes
    the learner's unit or none at all (the 2026-09-05 live run wrote 15.0 m for a 15 cm answer)."""
    given = read_given(ask, *cues)
    return given.unit if given and given.unit not in (None, "deg") else None
