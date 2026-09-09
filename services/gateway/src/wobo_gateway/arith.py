"""Arithmetic the keyless twin can actually do.

THE ANSWER TO A SUM IS THE SUM (the adversary, 2026-09-09, finding 12). Wave 39 made "what is 2 to
the power 5?" a drawing turn and rang the learner's own bubble. Wave 40 stopped it being a drawing
turn — and then answered it, at both widths and in both themes, with "Which step feels shaky?
Start there.", a sentence that belongs to a different question entirely. The arithmetic was never
done.

There is no model here and there does not need to be one: a child asking for 2 to the power 5 is
asking for 32. This reads the handful of shapes a child actually types, works them out exactly
(``Fraction``, so 1 divided by 3 is not 0.3333333333333333), and says the answer in words a
learner reads. Anything it cannot read with certainty answers None and the turn goes on as before:
a wrong number said with confidence is worse than no number at all.

Nothing here evaluates a string. There is no ``eval``, no ``sympy``, no operator precedence engine
-- one operation, named in words or in a symbol, between two numbers it actually found.
"""

from __future__ import annotations

import re
from fractions import Fraction

__all__ = ["answer_in_words", "solve"]

#: A number a child types: 12, 1.5, -3, 1/2.
_N = r"-?\d+(?:\.\d+)?"
_NUM_RE = re.compile(_N)

_STRIP_RE = re.compile(
    r"^\s*(?:hey\s+wobo[,\s]*|wobo[,\s]*)?"
    r"(?:what(?:'s| is| are)|how much is|calculate|compute|evaluate|work out|solve)\s*",
    re.IGNORECASE,
)


def _number(text: str) -> Fraction | None:
    text = text.strip()
    if not _NUM_RE.fullmatch(text):
        return None
    return Fraction(text)


def _say(value: Fraction) -> str:
    """The value as a learner reads it: a whole number plain, a fraction as a decimal when it is
    exact and as a fraction when it is not (1/3 is 1/3, never 0.3333333333333333)."""
    if value.denominator == 1:
        return str(value.numerator)
    as_decimal = value * 10**6
    if as_decimal.denominator == 1:
        text = f"{float(value):.6f}".rstrip("0").rstrip(".")
        return text
    return f"{value.numerator}/{value.denominator}"


#: One operation between two numbers, named in words or written as a symbol. Ordered: the longest
#: phrasing is tried first so "to the power of" is not read as "of".
_FORMS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(rf"({_N})\s*(?:to the power(?:\s+of)?|\^|\*\*)\s*({_N})"), "power"),
    (re.compile(rf"(?:the\s+)?square root of\s*({_N})"), "root"),
    (re.compile(rf"({_N})\s*squared"), "squared"),
    (re.compile(rf"({_N})\s*cubed"), "cubed"),
    (re.compile(rf"({_N})\s*(?:%|per\s?cent)\s*of\s*({_N})"), "percent"),
    (re.compile(rf"({_N})\s*(?:plus|\+)\s*({_N})"), "plus"),
    (re.compile(rf"({_N})\s*(?:minus|-|−)\s*({_N})"), "minus"),
    (re.compile(rf"({_N})\s*(?:times|multiplied by|\*|x|×)\s*({_N})"), "times"),
    (re.compile(rf"({_N})\s*(?:divided by|/|÷)\s*({_N})"), "divided"),
)


def solve(question: str) -> tuple[Fraction, str] | None:
    """The value the question asks for and how it was worked, or None when it is not a sum.

    None is the answer to anything with two operations in it, anything with a letter standing for
    a number, and anything whose numbers do not parse: this says only what it is sure of.
    """
    text = _STRIP_RE.sub("", (question or "").strip()).strip(" ?.!")
    if not text:
        return None
    for pattern, op in _FORMS:
        m = pattern.search(text)
        if m is None:
            continue
        # Two operations in one line is not this function's business.
        if sum(1 for p, _ in _FORMS if p.search(text)) > 1 and op not in {"squared", "cubed"}:
            others = [o for p, o in _FORMS if p.search(text) and o != op]
            if any(o not in {"times", "minus"} for o in others):
                return None
        try:
            first = _number(m.group(1))
            second = _number(m.group(2)) if m.re.groups > 1 else None
        except (ValueError, ZeroDivisionError):
            return None
        if first is None or (m.re.groups > 1 and second is None):
            return None
        return _apply(op, first, second)
    return None


def _apply(op: str, a: Fraction, b: Fraction | None) -> tuple[Fraction, str] | None:
    try:
        if op == "power":
            assert b is not None
            if b.denominator != 1 or abs(b) > 32:
                return None  # a root or a number too big to be a child's question
            return a**int(b), f"{_say(a)} to the power {_say(b)}"
        if op == "squared":
            return a * a, f"{_say(a)} squared"
        if op == "cubed":
            return a * a * a, f"{_say(a)} cubed"
        if op == "root":
            if a < 0:
                return None
            root = Fraction(int(round(float(a) ** 0.5)))
            if root * root != a:
                return None  # not exact: a decimal Wobo would have to round is not certain
            return root, f"the square root of {_say(a)}"
        assert b is not None
        if op == "percent":
            return a * b / 100, f"{_say(a)} percent of {_say(b)}"
        if op == "plus":
            return a + b, f"{_say(a)} plus {_say(b)}"
        if op == "minus":
            return a - b, f"{_say(a)} minus {_say(b)}"
        if op == "times":
            return a * b, f"{_say(a)} times {_say(b)}"
        if op == "divided":
            if b == 0:
                return None
            return a / b, f"{_say(a)} divided by {_say(b)}"
    except (ArithmeticError, OverflowError, ValueError):
        return None
    return None


def answer_in_words(question: str) -> str | None:
    """Wobo's line for a sum, or None when it is not one Wobo is sure of.

    It says the working as well as the answer, because the point is never the number: a learner
    who reads "2 to the power 5 is 32, which is 2 multiplied by itself five times" has something
    to carry to the next one.
    """
    found = solve(question)
    if found is None:
        return None
    value, working = found
    line = f"{working[0].upper()}{working[1:]} is {_say(value)}."
    if "to the power" in working:
        base = working.split(" to the power ")[0]
        times = working.rsplit(" ", 1)[-1]
        line += f" That is {base} multiplied by itself {times} times."
    return line
