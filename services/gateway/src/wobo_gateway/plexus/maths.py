"""Machine-checking the ANSWERS — the layer that never existed.

:mod:`lint` proves an artifact is not BROKEN: the SVG parses, the enum is in the client's
vocabulary, the evaluated expression is readable. Nothing anywhere proved an artifact was not
WRONG. A quiz key, a worked line, a stated answer — every one of them shipped on the content
model's word alone, and a key that is confidently wrong is the one defect a child cannot catch
themselves: they mark their own correct working wrong and learn the false thing instead.

So this module verifies the mathematics, with the CAS the verifier service already hardened
(``wobo_verifier.cas``: an emptied ``__builtins__``, a token guard, a character allowlist, and
every parse inside a wall-clock-bounded worker process). Nothing here evaluates artifact text in
this process; only already-parsed, already-bounded SymPy objects are manipulated locally, and
only when they are small polynomials.

**It refuses only what it can PROVE wrong, and declines everything else.** That posture is the
whole design: a false refusal routes an expensive Opus rebuild of good content and teaches the
pipeline to distrust the truth, so every family below either produces a proof of falsehood or
says nothing at all. What it can prove:

  • ``equation key`` — the prompt states ONE equation in ONE unknown and the key is a number: the
    key must satisfy the equation, no distractor may also satisfy it, and the key must name EVERY
    real root unless the prompt asks for a particular one.
  • ``parameter key`` — the prompt states a quadratic with one parameter and asks for equal /
    repeated roots: the parameter values are the roots of ``discriminant = 0``, and the key must
    name all of them. (This is the ISC boss item that accepted ``10`` for ``x² + px + 25`` when
    p = ±10: an answer key must be THE answer, not one of them.)
  • ``nature of the roots`` — the prompt states a numeric quadratic and asks what its roots are
    like: the sign of the discriminant decides, and the key's phrase must agree with it.
  • ``relation options`` — an option that is a closed numeric relation (``2/3 > 3/5``) is simply
    true or false: the key must be true and every readable distractor false.
  • ``worked lines`` — a line of working that SymPy can prove false (``x = x + 1``, ``36 - 36 =
    1``) is refused, and a stated answer must satisfy every earlier line of its own working that
    is an equation in that one unknown.

What it CANNOT check is stated as plainly, because the coverage number is the honest half of this
file: a key that is a sentence ("Glucose is broken down more completely"), a word ("nucleus"), a
ratio in prose ("9:3:3:1"), or a choice between English descriptions is a matter of MEANING, and
no CAS reads meaning. Those are the judge's to score and a human's to trust; roughly one school
quiz item in nine is arithmetic enough to be proved here. This module makes that one honest
instead of lucky.
"""

from __future__ import annotations

import re
from typing import Any

import sympy as sp
from wobo_verifier.cas import MAX_EXPRESSION_CHARS, parse_equation

__all__ = ["check_compose"]

#: Bigger than any expression a school item carries, small enough that a local ``simplify`` or
#: ``solveset`` on an already-parsed tree cannot become the CPU burn the sandbox exists to stop.
_MAX_OPS = 200
#: The equation degree this module will solve locally. Beyond it, decline.
_MAX_DEGREE = 4
#: A free symbol name the artifact will not contain, used to parse a bare EXPRESSION through the
#: equation entrypoint (``zzq = <expr>``) without the equality collapsing to a boolean.
_PROBE = "zzq"

# --- reading display maths -----------------------------------------------------------------
#
# The content model writes for a child's eye: "x² + px + 25 = 0", "(-6)² - 4(1)(k)", "2/3 > 3/5",
# a unicode minus, a times sign. The CAS accepts ASCII only (its character allowlist is half of
# what keeps a hostile string away from ``eval``), so display text is translated here first and
# REFUSED — never guessed at — when a mark has no unambiguous ASCII reading.

_SUPERSCRIPTS = {
    "⁰": "0",
    "¹": "1",
    "²": "2",
    "³": "3",
    "⁴": "4",
    "⁵": "5",
    "⁶": "6",
    "⁷": "7",
    "⁸": "8",
    "⁹": "9",
}
_SIMPLE = {
    "−": "-",
    "–": "-",
    "—": "-",
    "‑": "-",
    "×": "*",
    "·": "*",
    "∙": "*",
    "⋅": "*",
    "∗": "*",
    "÷": "/",
    "⁄": "/",
    "（": "(",
    "）": ")",
}
_SUPER_RUN = re.compile("[" + "".join(_SUPERSCRIPTS) + "]+")
#: Everything :func:`_ascii` may emit. A character outside it means the reading is not certain,
#: and an uncertain reading is not a proof — so the text is declined rather than repaired.
_ASCII_MATH = frozenset("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-*/^().= ")


def _ascii(text: object) -> str | None:
    """Display maths → the ASCII the CAS accepts, or None when the reading is not certain."""
    if not isinstance(text, str):
        return None
    out = text.strip()
    if not out or len(out) > MAX_EXPRESSION_CHARS:
        return None
    out = _SUPER_RUN.sub(lambda m: "**" + "".join(_SUPERSCRIPTS[c] for c in m.group()), out)
    for src, dst in _SIMPLE.items():
        out = out.replace(src, dst)
    # A root sign only reads unambiguously when it brackets what it covers: "√(b^2-4ac)" is
    # sqrt(...), while "√25 + 1" could be either root. Bracketed form is translated; the rest
    # declines.
    out = out.replace("√(", "sqrt(")
    if set(out) - _ASCII_MATH:
        return None
    return out.strip() or None


def _expr(text: str) -> sp.Expr | None:
    """Parse ONE expression, inside the CAS sandbox. None when it will not parse."""
    if _PROBE in text:
        return None
    try:
        parsed = parse_equation(f"{_PROBE} = {text}")
    except Exception:
        return None
    if not isinstance(parsed, sp.Eq):
        return None
    rhs = parsed.rhs
    return rhs if isinstance(rhs, sp.Expr) and rhs.count_ops() <= _MAX_OPS else None


def _equation(text: str) -> sp.Eq | None:
    """Parse ONE ``lhs = rhs``. None when it will not parse or SymPy already decided it."""
    try:
        parsed = parse_equation(text)
    except Exception:
        return None
    if not isinstance(parsed, sp.Eq):
        return None  # already collapsed to true/false: there is nothing left to solve
    if (parsed.lhs - parsed.rhs).count_ops() > _MAX_OPS:
        return None
    return parsed


def _closed(expr: sp.Expr) -> bool:
    """A number, with nothing left unknown in it."""
    return not expr.free_symbols


def _satisfies(eq: sp.Eq, sym: sp.Symbol, value: sp.Expr) -> bool | None:
    """Does ``sym = value`` make both sides equal? None when SymPy will not decide."""
    try:
        residual = sp.simplify((eq.lhs - eq.rhs).subs(sym, value))
    except Exception:
        return None
    if residual.free_symbols:
        return None
    return bool(residual == 0)


def _real_roots(eq: sp.Eq, sym: sp.Symbol) -> list[sp.Expr] | None:
    """Every real solution, or None when the equation is not a small polynomial in ``sym``."""
    try:
        poly = sp.Poly(eq.lhs - eq.rhs, sym)
        if poly.degree() > _MAX_DEGREE or poly.free_symbols - {sym}:
            return None
        solutions = sp.solveset(eq, sym, domain=sp.S.Reals)
    except Exception:
        return None
    if not isinstance(solutions, sp.FiniteSet):
        return None
    return sorted(solutions, key=lambda v: sp.N(v))


# --- reading a claimed answer --------------------------------------------------------------

_PLUS_MINUS = re.compile(r"[±∓]")
_OR = re.compile(r"\s+or\s+", re.I)


def _claimed_values(answer: object, sym: sp.Symbol | None = None) -> list[sp.Expr] | None:
    """The number (or numbers) an answer claims: ``7``, ``x = 7``, ``±10``, ``10 or -10``.

    None means "this key is not a number" — a sentence, a word, a ratio — which is a DECLINE and
    never a defect. A key that names several values (``±10``) returns all of them, because
    whether it names them all is exactly what the caller has to decide.
    """
    text = _ascii(_PLUS_MINUS.sub("+-", str(answer))) if isinstance(answer, str) else None
    if text is None:
        return None
    if "=" in text:
        left, _, right = text.partition("=")
        if "=" in right:
            return None
        lhs_expr = _expr(left)
        if lhs_expr is None or not lhs_expr.free_symbols:
            return None
        if sym is not None and lhs_expr != sym:
            return None
        if len(lhs_expr.free_symbols) != 1 or not isinstance(lhs_expr, sp.Symbol):
            return None
        text = right.strip()
    parts = [p for p in _OR.split(text) if p.strip()]
    values: list[sp.Expr] = []
    for part in parts:
        body = part.strip()
        signs = ["+", "-"] if body.startswith("+-") else [""]
        body = body[2:].strip() if body.startswith("+-") else body
        if not body or "+-" in body:
            return None
        for sign in signs:
            value = _expr(sign + body if sign else body)
            if value is None or not _closed(value):
                return None
            values.append(value)
    if not values:
        return None
    # Deduplicate while keeping the order the key wrote them in.
    unique: list[sp.Expr] = []
    for value in values:
        if not any(bool(sp.simplify(value - seen) == 0) for seen in unique):
            unique.append(value)
    return unique


# --- pulling the maths out of an English prompt ---------------------------------------------
#
# "For 5x − 8 = 27, x = ________." carries one equation and one blank. Reading it wrongly is the
# only way this module can produce a false refusal, so the reader is deliberately timid: the
# prompt is cut at every clause boundary, a clause is split on spaces, and a run of neighbouring
# MATH tokens containing exactly one '=' is a candidate. A run with an English word inside it, a
# blank, a subscript, or anything that does not then parse is dropped rather than repaired. When
# a prompt does not yield EXACTLY one equation, nothing is checked.

_CLAUSE = re.compile(r"[,;:?!]|(?<=[^0-9])\.(?=\s|$)")


def _is_word(token: str) -> bool:
    """An English word (``have``, ``For``), as opposed to a variable (``x``, ``px``, ``ab``)."""
    return token.isalpha() and len(token) >= 3


def _math_runs(prompt: str) -> list[str]:
    """Every maximal run of neighbouring maths tokens in the prompt, words trimmed off the ends."""
    runs: list[str] = []
    for clause in _CLAUSE.split(prompt):
        if not clause:
            continue
        run: list[str] = []
        for raw in clause.split():
            token = _ascii(raw.rstrip("."))
            if token is None or _is_word(token) or "_" in token:
                if run:
                    runs.append(run)
                run = []
                continue
            run.append(token)
        if run:
            runs.append(run)
    trimmed: list[str] = []
    for tokens in runs:
        while tokens and tokens[0].isalpha() and len(tokens[0]) >= 2:
            tokens.pop(0)
        while tokens and tokens[-1].isalpha() and len(tokens[-1]) >= 2:
            tokens.pop()
        if tokens:
            trimmed.append(" ".join(tokens))
    return trimmed


def _equations_in(prompt: str) -> list[str]:
    """Every equation this prompt unambiguously states, in the order they appear."""
    clean: list[str] = []
    for text in _math_runs(prompt):
        if text.count("=") != 1:
            continue
        lhs, _, rhs = text.partition("=")
        if not lhs.strip() or not rhs.strip():
            continue
        clean.append(text)
    return clean


_OPERATOR = re.compile(r"[+*/^]|(?<=[0-9A-Za-z)\s])-")


def _asks_for_something_else(prompt: str, equation: str, sym: sp.Symbol) -> bool:
    """ "If 2x + 3 = 11, what is the value of x + 1?" — the key is 6, and the unknown is 4.

    An item that states an equation but asks for a DERIVED quantity would be refused by the
    equation check for being right. So whenever the prompt carries a second arithmetic
    expression built on the same unknown, the item is left alone.
    """
    name = str(sym)
    for run in _math_runs(prompt):
        if run == equation or "=" in run:
            continue
        if not _OPERATOR.search(run):
            continue
        expr = _expr(run)
        if expr is not None and sym in expr.free_symbols:
            return True
        if expr is None and re.search(rf"(?<![0-9A-Za-z]){re.escape(name)}(?![0-9A-Za-z])", run):
            return True
    return False


# --- the item families ----------------------------------------------------------------------

#: A prompt that asks for ONE of several answers ("the positive value of k") is not claiming its
#: key is the whole solution set, so completeness is not checked against it.
_SELECTS_ONE = re.compile(
    r"\b(positive|negative|greatest|greater|largest|larger|smallest|least|smaller|"
    r"non-?zero|absolute|principal|one\s+of)\b",
    re.I,
)
_EQUAL_ROOTS = re.compile(r"\b(equal|repeated|coincident|double)\s+(and\s+real\s+)?roots?\b", re.I)
_NATURE_PHRASES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bno\s+real\s+roots?\b", re.I), "none"),
    (re.compile(r"\b(two\s+)?(equal|repeated|coincident)\s+(real\s+)?roots?\b", re.I), "equal"),
    (re.compile(r"\b(two\s+)?(distinct|different|unequal)\s+(real\s+)?roots?\b", re.I), "distinct"),
)
_RELATION = re.compile(r"(<=|>=|≤|≥|<|>|=)")
_RELATIONS = {
    "<": sp.StrictLessThan,
    "<=": sp.LessThan,
    "≤": sp.LessThan,
    ">": sp.StrictGreaterThan,
    ">=": sp.GreaterThan,
    "≥": sp.GreaterThan,
}


def _nature_label(text: str) -> str | None:
    for pattern, label in _NATURE_PHRASES:
        if pattern.search(text):
            return label
    return None


def _relation_truth(text: object) -> bool | None:
    """Is this option a closed numeric relation, and is it true? None = not one."""
    if not isinstance(text, str):
        return None
    parts = _RELATION.split(text, maxsplit=1)
    if len(parts) != 3:
        return None
    left_text, op, right_text = parts
    if _RELATION.search(right_text):
        return None
    left_ascii, right_ascii = _ascii(left_text), _ascii(right_text)
    if left_ascii is None or right_ascii is None:
        return None
    left, right = _expr(left_ascii), _expr(right_ascii)
    if left is None or right is None or not (_closed(left) and _closed(right)):
        return None
    try:
        if op == "=":
            return bool(sp.simplify(left - right) == 0)
        return bool(_RELATIONS[op](left, right))
    except Exception:
        return None


def _check_item(bank: str, item: dict[str, Any]) -> list[str]:
    """Every proof available about one quiz item. Empty = nothing was disproved."""
    prompt = item.get("prompt")
    if not isinstance(prompt, str):
        return []
    where = f"{bank} item {item.get('id')!r}"
    options = [o for o in (item.get("options") or []) if isinstance(o, str)]
    out: list[str] = []

    out += _check_relation_options(where, item.get("answer"), options)

    equations = _equations_in(prompt)
    if len(equations) != 1:
        return out
    eq = _equation(equations[0])
    if eq is None:
        return out
    symbols = sorted(eq.free_symbols, key=str)
    if len(symbols) == 1:
        out += _check_single_unknown(where, prompt, equations[0], eq, symbols[0], item, options)
    elif len(symbols) == 2 and _EQUAL_ROOTS.search(prompt):
        out += _check_equal_roots(where, prompt, eq, symbols, item, options)
    return out


def _check_relation_options(where: str, answer: object, options: list[str]) -> list[str]:
    """An option like ``2/3 > 3/5`` is arithmetic, not opinion: the key is true, the rest false."""
    if not options or not isinstance(answer, str):
        return []
    key_truth = _relation_truth(answer)
    if key_truth is None:
        return []
    others = {o: _relation_truth(o) for o in options if o != answer}
    if not any(t is not None for t in others.values()):
        return []
    out: list[str] = []
    if not key_truth:
        out.append(f"{where}: the key {answer!r} is a false statement")
    for option, truth in others.items():
        if truth:
            out.append(f"{where}: option {option!r} is also true, so the key is not unique")
    return out


def _check_single_unknown(
    where: str,
    prompt: str,
    equation: str,
    eq: sp.Eq,
    sym: sp.Symbol,
    item: dict[str, Any],
    options: list[str],
) -> list[str]:
    out: list[str] = []
    nature = _check_nature_of_roots(where, prompt, eq, sym, item)
    if nature is not None:
        return nature
    # "If x = 3, what is 2x?" states a GIVEN, not a question — there is nothing to solve.
    if eq.lhs == sym and _closed(eq.rhs):
        return out
    if _asks_for_something_else(prompt, equation, sym):
        return out
    values = _claimed_values(item.get("answer"), sym)
    if values is None:
        return out  # a key that is not a number: the judge's to read, not this module's
    for value in values:
        if _satisfies(eq, sym, value) is False:
            out.append(
                f"{where}: the key claims {sym} = {value}, which does not satisfy "
                f"{equations_text(eq)}"
            )
    roots = _real_roots(eq, sym)
    if roots is None:
        return out
    missing = [r for r in roots if not any(bool(sp.simplify(r - v) == 0) for v in values)]
    if missing and not _SELECTS_ONE.search(prompt):
        out.append(
            f"{where}: {equations_text(eq)} also has {sym} = "
            f"{', '.join(str(r) for r in missing)}, which the key does not name"
        )
    for option in options:
        if option == item.get("answer"):
            continue
        other = _claimed_values(option, sym)
        if other and all(any(bool(sp.simplify(r - v) == 0) for r in roots) for v in other):
            out.append(f"{where}: option {option!r} also solves {equations_text(eq)}")
    return out


def _check_nature_of_roots(
    where: str, prompt: str, eq: sp.Eq, sym: sp.Symbol, item: dict[str, Any]
) -> list[str] | None:
    """ "What is the nature of the roots of x² + 4x + 4 = 0?" — the discriminant answers it.

    None means this is not that family. The guard is tight on purpose: the prompt must talk about
    roots, the equation must be a numeric quadratic, and the KEY itself must be one of the three
    phrases — an item whose key is anything else is left alone.
    """
    if "root" not in prompt.lower():
        return None
    answer = item.get("answer")
    if not isinstance(answer, str):
        return None
    claimed = _nature_label(answer)
    if claimed is None:
        return None
    try:
        poly = sp.Poly(eq.lhs - eq.rhs, sym)
        if poly.degree() != 2 or poly.free_symbols - {sym}:
            return None
        a, b, c = poly.all_coeffs()
        discriminant = sp.simplify(b**2 - 4 * a * c)
    except Exception:
        return None
    if discriminant.free_symbols:
        return None
    actual = "distinct" if discriminant > 0 else ("equal" if discriminant == 0 else "none")
    if actual != claimed:
        wording = {
            "distinct": "two distinct real roots",
            "equal": "two equal real roots",
            "none": "no real roots",
        }
        return [
            f"{where}: the discriminant of {equations_text(eq)} is {discriminant}, so it has "
            f"{wording[actual]} — the key says {answer!r}"
        ]
    return []


def _check_equal_roots(
    where: str,
    prompt: str,
    eq: sp.Eq,
    symbols: list[sp.Symbol],
    item: dict[str, Any],
    options: list[str],
) -> list[str]:
    """ "Which value of p makes x² + px + 25 = 0 have equal roots?" — ``discriminant = 0`` decides,
    and it decides for EVERY value at once: p = ±10 is the answer, and a key that names only 10
    is a key a child can be marked wrong against."""
    expr = eq.lhs - eq.rhs
    for unknown in symbols:
        param = symbols[0] if unknown is symbols[1] else symbols[1]
        try:
            poly = sp.Poly(expr, unknown)
            if poly.degree() != 2:
                continue
            a, b, c = poly.all_coeffs()
            if a.free_symbols:  # a parametric leading coefficient brings degenerate cases in
                continue
            values = sp.solveset(sp.Eq(b**2 - 4 * a * c, 0), param, domain=sp.S.Reals)
        except Exception:
            continue
        if not isinstance(values, sp.FiniteSet) or not values:
            continue
        expected = sorted(values, key=lambda v: sp.N(v))
        claimed = _claimed_values(item.get("answer"), param)
        if claimed is None:
            return []
        out: list[str] = []
        for value in claimed:
            if not any(bool(sp.simplify(value - e) == 0) for e in expected):
                out.append(
                    f"{where}: the key claims {param} = {value}, but equal roots of "
                    f"{equations_text(eq)} need {param} = "
                    f"{', '.join(str(e) for e in expected)}"
                )
        missing = [e for e in expected if not any(bool(sp.simplify(e - v) == 0) for v in claimed)]
        if missing and not _SELECTS_ONE.search(prompt):
            out.append(
                f"{where}: equal roots of {equations_text(eq)} also need {param} = "
                f"{', '.join(str(e) for e in missing)}, which the key does not name"
            )
        for option in options:
            if option == item.get("answer"):
                continue
            other = _claimed_values(option, param)
            if other and all(any(bool(sp.simplify(o - e) == 0) for e in expected) for o in other):
                out.append(f"{where}: option {option!r} also gives equal roots")
        return out
    return []


def equations_text(eq: sp.Eq) -> str:
    """The equation as it will read in a rejection reason."""
    return f"{eq.lhs} = {eq.rhs}"


# --- worked lines ---------------------------------------------------------------------------


def _chain_parts(text: str) -> list[str] | None:
    """``D = 36 - 4k = 0`` → the three sides of the chain, in order."""
    ascii_text = _ascii(text)
    if ascii_text is None or "=" not in ascii_text:
        return None
    parts = [p.strip() for p in ascii_text.split("=")]
    return parts if all(parts) else None


def _cross_line_contradictions(where: str, equations: list[sp.Eq]) -> list[str]:
    """One line of working disagreeing with the line before it, in the same unknown.

    ``_check_working`` split each line on ``=`` and checked only the sides of THAT ONE line
    against each other, so a line was caught only when it was self-contradictory in isolation
    (``D = 36 - 4*10 = 5``). The commonest way a worked example actually goes wrong — line 2
    contradicting line 1 (``2x + 4 = 16`` then ``2x = 11``) — was never looked at, and a
    derivation card with no stated ``answer`` got no check at all.

    Consecutive equations in ONE unknown are compared, and only a real contradiction is reported:
    a later line that NO solution of the earlier line satisfies. Narrowing is not contradiction —
    ``x**2 = 25`` followed by ``x = 5`` picks one of two roots and passes — and anything SymPy
    will not decide is left alone.
    """
    out: list[str] = []
    previous: dict[sp.Symbol, sp.Eq] = {}
    for eq in equations:
        symbols = eq.free_symbols
        if len(symbols) != 1:
            continue
        sym = next(iter(symbols))
        earlier = previous.get(sym)
        previous[sym] = eq
        if earlier is None:
            continue
        roots = _real_roots(earlier, sym)
        if not roots:
            continue
        if all(_satisfies(eq, sym, root) is False for root in roots):
            out.append(
                f"{where}: {equations_text(eq)} contradicts the earlier line "
                f"{equations_text(earlier)} ({sym} = "
                f"{', '.join(str(r) for r in roots)})"
            )
    return out


def _check_working(where: str, lines: list[Any], answer: object, find: object) -> list[str]:
    """One chain of working: no line may be provably false, no line may contradict the line
    before it, and the stated answer must survive every earlier line that is an equation in the
    answer's own unknown."""
    out: list[str] = []
    equations: list[sp.Eq] = []
    for index, line in enumerate(lines):
        expr = line.get("expr") if isinstance(line, dict) else line
        parts = _chain_parts(expr) if isinstance(expr, str) else None
        if parts is None:
            continue
        for left, right in zip(parts, parts[1:], strict=False):
            try:
                parsed = parse_equation(f"{left} = {right}")
            except Exception:
                continue
            if parsed is sp.false or parsed is False:
                out.append(f"{where} line {index + 1}: {expr!r} is false ({left} ≠ {right})")
            elif isinstance(parsed, sp.Eq):
                equations.append(parsed)
    out += _cross_line_contradictions(where, equations)
    out += _check_stated_answer(where, equations, answer, find)
    return out


def _check_stated_answer(
    where: str, equations: list[sp.Eq], answer: object, find: object
) -> list[str]:
    if not isinstance(answer, str):
        return []
    sym: sp.Symbol | None = None
    if "=" in answer:
        lhs = _ascii(answer.split("=", 1)[0])
        parsed = _expr(lhs) if lhs else None
        sym = parsed if isinstance(parsed, sp.Symbol) else None
    elif isinstance(find, str):
        named = _ascii(find)
        parsed = _expr(named) if named else None
        sym = parsed if isinstance(parsed, sp.Symbol) else None
    if sym is None:
        return []
    values = _claimed_values(answer, sym)
    if values is None or len(values) != 1:
        return []
    value = values[0]
    out: list[str] = []
    for eq in equations:
        if eq.free_symbols != {sym}:
            continue
        if _satisfies(eq, sym, value) is False:
            out.append(
                f"{where}: the stated answer {sym} = {value} does not satisfy its own working "
                f"line {equations_text(eq)}"
            )
    return out


# --- the entry point ------------------------------------------------------------------------


def check_compose(artifact: object) -> list[str]:
    """Every proof of a wrong answer in one compose artifact. Empty = nothing was disproved."""
    if not isinstance(artifact, dict):
        return []
    reasons: list[str] = []
    for bank in ("workbook", "boss"):
        for item in artifact.get(bank) or []:
            if isinstance(item, dict):
                reasons += _check_item(bank, item)
    for card in artifact.get("cards") or []:
        if not isinstance(card, dict):
            continue
        cid = card.get("id")
        derivation = card.get("derivation")
        if isinstance(derivation, dict):
            steps = [s for s in (derivation.get("steps") or []) if isinstance(s, dict)]
            reasons += _check_working(f"card {cid!r} derivation", steps, None, None)
        problem = card.get("wordProblem")
        if isinstance(problem, dict):
            solve = [s for s in (problem.get("solve") or []) if isinstance(s, dict)]
            reasons += _check_working(
                f"card {cid!r} wordProblem", solve, problem.get("answer"), problem.get("find")
            )
    return reasons
