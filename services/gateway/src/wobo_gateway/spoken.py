"""The spoken-number law: a number Wobo says aloud is one a verifier produced, or it is not said.

BOARD.md section 6 puts every number the hand WRITES behind a check, and the teaching harness
proves it on the wire. The line Wobo SAYS over the board was never covered: model-authored prose,
screened for safety and for nothing else. The harness recorded two to five unverified numbers in
the spoken line on every turn of the live run of 2026-09-05, and the one wrong fact that reached a
learner that day was spoken, not drawn ("which two boxes show the dominant phenotype").

So the spoken line is held to the same standard, by code, before it is spoken. A numeral in the
say is LICENSED when it is one of three things:

* **theirs** — a number the learner gave: in what they just said, in their own earlier turns, in
  the working on their canvas, or the age and class in their dossier. Repeating their 3 cm back to
  them asserts nothing they did not already assert.
* **the verifier's** — a value a board pipeline computed and a check signed: the ``value`` of a
  ``number`` object, and every numeral in the glyphs of an object that names a check that ran.
* **a sum written out in full** — "9 + 16 = 25", "1/2 = 2/4", "-5 + 3 = -2": a statement made of
  numbers and operators that the CAS can read and confirm. It is confirmed here, in the verifier's
  sandbox, and the confirmation is written into the turn's ledger as ``say.arithmetic:<statement>``
  so the wire can prove it. A statement the CAS finds false is the worst thing this product can
  say, and it is not said.

A number inside a QUESTION is licensed too, for a reason worth stating: "try this tiny one, what is
-5 + 3?" asserts nothing. It hands the arithmetic to the learner, which is the check every lesson
is supposed to end with, and a law that made Wobo unable to ask it would have cost more teaching
than it saved. The harness still reads every question for a wrong embedded claim, by the claims in
its bank.

Anything else is a number Wobo worked out in its head. The sentence carrying it is not spoken:
:func:`enforce` drops it and re-anchors the ink that was choreographed to later sentences, so the
hand still lands on the words it was written for. On the five-path turn, where there is no board to
carry the value, the model is given one chance to say it again properly before the sentence goes.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from wobo_verifier.cas import CasError, expressions_equivalent
from wobo_verifier.gate import CheckResult

logger = logging.getLogger("wobo_gateway.spoken")

#: A numeral as a person writes one in a sentence. Not preceded by a letter, digit, dot, caret or
#: star, so the 2 in "CO2", "H2O", "x^2" and "x**2" is notation rather than a quantity, and not an
#: ordinal ("1st step").
_NUMERAL = re.compile(r"(?<![A-Za-z\d.^*])[-−]?\d+(?:\.\d+)?(?!\d|st\b|nd\b|rd\b|th\b)")

#: A run of characters that could be a written-out sum: digits, operators, brackets, the odd
#: superscript, and at least one equals sign. Anything with a letter in it (an ``x``) is algebra,
#: which is the verifier's job on the canvas, not a sum Wobo is claiming out loud.
_SUM_RUN = re.compile(r"[\d.\s()+\-−×÷*/^²³=]+")

_NORMALISE = (
    ("−", "-"),
    ("×", "*"),
    ("÷", "/"),
    ("²", "**2"),
    ("³", "**3"),
    ("^", "**"),
)

#: The spoken line's own sentence split, kept identical to ``board.stream.sentences`` so a dropped
#: sentence here is the same sentence the beats were numbered against.
_SENTENCE_SPLIT = re.compile(r"(?<=[.?!])\s+")

CHECK_PREFIX = "say.arithmetic:"


@dataclass(frozen=True)
class Spoken:
    """What the law decided about one spoken line."""

    #: The line as it may be spoken: the offending sentences gone.
    say: str
    #: Every sum the line wrote out in full that the CAS confirmed. Goes into the ledger.
    checks: list[CheckResult] = field(default_factory=list)
    #: Each numeral that was not licensed, with the sentence it sat in. Empty means the line was
    #: spoken exactly as written.
    unsaid: list[tuple[str, str]] = field(default_factory=list)
    #: Indices (in the original line) of the sentences that were dropped.
    dropped: tuple[int, ...] = ()

    @property
    def clean(self) -> bool:
        return not self.unsaid


# --- what is licensed ---------------------------------------------------------------------------


def _to_float(raw: str) -> float | None:
    try:
        return float(raw.replace("−", "-"))
    except ValueError:
        return None


#: A number written as a word. "three balls out of six" asserts 3 and 6 exactly as firmly as the
#: digits would, and the one live turn built on a learner's world was written that way, so the law
#: read nothing in it. "one" is deliberately absent on its own ("try this one", "one of them") and
#: counts only in front of a fraction or a scale word ("one half", "one hundred").
_WORD_VALUES: dict[str, float] = {
    "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80,
    "ninety": 90, "hundred": 100, "thousand": 1000,
}  # fmt: skip
_WORDS = "|".join(_WORD_VALUES)
_FRACTION_WORD = (
    r"half|halves|thirds?|quarters?|fourths?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?|"
    r"twelfths?|hundredths?|per ?cent|percent"
)
#: Where a word is a QUANTITY rather than a count in prose. "the other two because 9 + 16 = 25" is
#: prose; "three balls out of six", "two fourths", "six plus three", "the answer is six" are
#: numbers being asserted. Each pattern captures the word being read.
_WORD_QUANTITY = (
    re.compile(rf"\bout of\s+({_WORDS})\b", re.IGNORECASE),
    re.compile(rf"\b({_WORDS})\s+\w+(?:\s+\w+)?\s+out of\b", re.IGNORECASE),
    re.compile(rf"\b({_WORDS}|one)\s+(?:{_FRACTION_WORD})\b", re.IGNORECASE),
    re.compile(
        rf"\b({_WORDS})\s+(?:plus|minus|times|divided by|multiplied by|added to|over)\s+"
        rf"(?:{_WORDS}|\d)",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\b(?:{_WORDS}|\d+)\s+(?:plus|minus|times|divided by|multiplied by|added to|over)\s+"
        rf"({_WORDS})\b",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\b(?:plus|minus|times|divided by|multiplied by|equals|makes|gives|is)\s+({_WORDS})\b"
        r"(?=\s*(?:[.,;:?!]|$|\b(?:so|which|and|because|when|if)\b))",
        re.IGNORECASE,
    ),
)


def _word_matches(sentence: str) -> list[tuple[int, int, str]]:
    """(start, end, digits) for every number written as a word where it is doing arithmetic."""
    out: dict[int, tuple[int, int, str]] = {}
    for pattern in _WORD_QUANTITY:
        for match in pattern.finditer(sentence):
            word = match.group(1).lower()
            value = 1.0 if word == "one" else _WORD_VALUES[word]
            out[match.start(1)] = (match.start(1), match.end(1), f"{value:g}")
    return [out[k] for k in sorted(out)]


def numerals_in(text: str, *, words: bool = False) -> list[float]:
    """Every numeral in a piece of text, as numbers.

    ``words`` reads "three" and "six" too, in the sentences that are doing arithmetic with them.
    """
    out: list[float] = []
    for match in _NUMERAL.finditer(text or ""):
        value = _to_float(match.group(0))
        if value is not None:
            out.append(value)
    if words:
        for sentence in sentences(text or ""):
            for _start, _end, digits in _word_matches(sentence):
                out.append(float(digits))
    return out


def given_numbers(context: dict[str, Any]) -> set[float]:
    """The numbers the LEARNER put into this turn: theirs to repeat, not Wobo's to claim."""
    context = context if isinstance(context, dict) else {}
    turn = context.get("turn") or {}
    canvas = context.get("canvas") or {}
    learner = (context.get("lifetime") or {}).get("learner") or {}
    texts: list[str] = [str(turn.get("lastUserInput") or "")]
    for row in turn.get("recentTurns") or []:
        if isinstance(row, dict) and str(row.get("role") or "").lower() in {"user", "learner"}:
            texts.append(str(row.get("text") or ""))
    texts.append(str(canvas.get("equation") or ""))
    texts.extend(str(s) for s in (canvas.get("steps") or []))
    texts.append(str(learner.get("grade") or ""))
    texts.append(str(learner.get("age") or ""))
    # What is on the glass is in front of the learner: a number on the map (a line of the lesson,
    # a step of their working, the region they circled) is theirs to hear again.
    from wobo_gateway.board import glass

    for entry in glass.entries_of({"context": context}):
        texts.append(entry.text)
        texts.append(entry.meaning)
    found: set[float] = set()
    for text in texts:
        found.update(numerals_in(text))
    return found


def verified_numbers(objects: list[dict[str, Any]], verified: set[str] | None = None) -> set[float]:
    """The numbers the verifier drew: a ``number`` object's value, and every numeral in the glyphs
    of an object whose check actually ran."""
    from wobo_gateway.board import schema

    found: set[float] = set()
    for obj in objects or []:
        if not isinstance(obj, dict):
            continue
        check = str(obj.get("check") or "")
        if not check or (verified is not None and check not in verified):
            continue
        value = obj.get("value")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            found.add(float(value))
        found.update(numerals_in(schema.visible_text(obj)))
    return found


def _rounds_to(said: str, licensed: set[float]) -> bool:
    """Is this numeral one of the licensed values, to the precision it was said at?

    "about 10 m" for a verified 10.197 is honest rounding; "11" is not.
    """
    value = _to_float(said)
    if value is None:
        return False
    decimals = len(said.split(".")[1]) if "." in said else 0
    slack = 0.5 * 10 ** (-decimals) + 1e-9
    return any(abs(value - v) <= slack for v in licensed)


# --- sums written out in full -------------------------------------------------------------------


def _normalise(expr: str) -> str:
    for before, after in _NORMALISE:
        expr = expr.replace(before, after)
    return " ".join(expr.split())


def _side_ok(side: str) -> bool:
    """Digits, no letters, and brackets that close: "- 3) = 0" is the tail of "(x - 3) = 0", not
    a sum, and reading it as one dropped a correct factorisation from the say."""
    if not re.search(r"\d", side) or re.search(r"[A-Za-z]", side):
        return False
    depth = 0
    for ch in side:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


#: One and two letter words a person writes, so "so 9 + 16 = 25" is a sum and "2x + 3 = 7" is not.
_SHORT_WORDS = frozenset(
    (
        "a", "i", "is", "in", "of", "to", "at", "by", "or", "so", "as", "it", "we", "he",
        "up", "do", "if", "on", "no", "be", "me", "my", "us", "am", "an", "and", "the",
    )
)

_TOKEN_BEFORE = re.compile(r"([A-Za-z]+)\s*$")
_TOKEN_AFTER = re.compile(r"^\s*([A-Za-z]+)")


def _slice_of_algebra(sentence: str, start: int, end: int) -> bool:
    """Is this run a piece cut out of an expression rather than a sum the say is claiming?

    A SENTENCE THAT QUOTES THE LEARNER'S OWN EQUATION IS NOT MAKING AN ARITHMETIC CLAIM.
    ``_SUM_RUN`` stops at every letter, so "2x + 3 = 7, line by line." handed the CAS the fragment
    "+ 3 = 7", the CAS said it was false — it is — and :func:`audit` dropped the whole sentence.
    Any line that quotes an equation with a letter in it was therefore unspeakable, which is most
    of the mathematics on the board: the derivation's opening went silent on every keyless run
    (measured 2026-09-10).

    The tell is what the run touches. A run against a one or two letter word that is not an
    English one — ``x``, ``y``, ``ax``, ``pi`` — is the middle of an expression. A run against a
    real word ("it is 5 because 5 x 5 = 25") is a sum the sentence is writing out in full.
    """
    before = _TOKEN_BEFORE.search(sentence[:start])
    after = _TOKEN_AFTER.search(sentence[end:])
    for token in (before.group(1) if before else "", after.group(1) if after else ""):
        if token and len(token) <= 2 and token.lower() not in _SHORT_WORDS:
            return True
    return False


def statements_in(sentence: str) -> list[str]:
    """Every "a op b = c" the sentence writes out, verbatim, with digits on both sides of an =."""
    out: list[str] = []
    for match in _SUM_RUN.finditer(sentence):
        raw = match.group(0)
        run = raw.strip(" .,;:")
        if "=" not in run:
            continue
        sides = [s.strip(" .,;:") for s in run.split("=")]
        if len(sides) < 2 or not all(_side_ok(s) for s in sides):
            continue
        start = match.start() + raw.index(run)
        if _slice_of_algebra(sentence, start, start + len(run)):
            continue
        out.append(run)
    return out


def check_name(statement: str) -> str:
    """The ledger name a confirmed sum is recorded under: the statement, normalised."""
    return f"{CHECK_PREFIX}{_normalise(statement)}"


def check_statement(statement: str) -> CheckResult:
    """One written-out sum, confirmed or denied by the CAS in its sandbox."""
    name = check_name(statement)
    sides = [_normalise(s.strip(" .,;:")) for s in statement.split("=")]
    try:
        for left, right in zip(sides, sides[1:], strict=False):
            result = expressions_equivalent(left, right)
            if not result.passed:
                return CheckResult(name=name, passed=False, detail=result.detail)
    except CasError as exc:
        return CheckResult(name=name, passed=False, detail=f"could not be read: {exc}")
    return CheckResult(name=name, passed=True, detail=f"{statement} holds")


# --- the law, applied to one line ---------------------------------------------------------------


def sentences(say: str) -> list[str]:
    text = (say or "").strip()
    if not text:
        return []
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]


def audit(
    say: str,
    *,
    given: set[float],
    verified: set[float],
    confirm: bool = True,
    words: bool = True,
) -> Spoken:
    """Apply the law to a spoken line. Pure: decides, and returns the line that may be spoken.

    ``confirm`` false skips the CAS: a written-out sum then licenses nothing by itself, and its
    numerals stand or fall on ``given`` and ``verified`` like any other. That is the harness's
    reading, where a sum counts only if the product's own ledger says it was confirmed.

    ``words`` reads a number written as a word ("three balls out of six") in a sentence that is
    doing arithmetic, so spelling a number out is not a way round the law.
    """
    parts = sentences(say)
    checks: list[CheckResult] = []
    unsaid: list[tuple[str, str]] = []
    dropped: list[int] = []
    kept: list[str] = []

    # A sum written out in full is confirmed first, and licenses every numeral inside it for the
    # whole line: "it is 5 because 5 × 5 = 25" has proved its 5 by the time the ear reaches it.
    licensed = set(given) | set(verified)
    for index, sentence in enumerate(parts):
        confirmed_spans: list[tuple[int, int]] = []
        false_statement = False
        for statement in statements_in(sentence) if confirm else ():
            result = check_statement(statement)
            if result.passed:
                checks.append(result)
                start = sentence.find(statement)
                confirmed_spans.append((start, start + len(statement)))
                licensed.update(numerals_in(statement))
            else:
                false_statement = True
                unsaid.append((statement, sentence))
        if false_statement:
            dropped.append(index)
            continue

        is_question = sentence.rstrip().endswith("?")
        bad: list[str] = []
        found = [(m.start(), m.group(0)) for m in _NUMERAL.finditer(sentence)]
        if words:
            found.extend((start, digits) for start, _end, digits in _word_matches(sentence))
        for start, numeral in sorted(found):
            if any(a <= start < b for a, b in confirmed_spans):
                continue
            if is_question:
                continue
            if _rounds_to(numeral, licensed):
                continue
            bad.append(numeral)
        if bad:
            unsaid.extend((numeral, sentence) for numeral in bad)
            dropped.append(index)
            continue
        kept.append(sentence)

    return Spoken(
        say=" ".join(kept), checks=checks, unsaid=unsaid, dropped=tuple(dropped)
    )


def reanchor(objects: list[dict[str, Any]], dropped: tuple[int, ...], total: int) -> None:
    """Move every beat that named a later sentence up by the number of sentences dropped before
    it, in place. A beat on a dropped sentence lands on the sentence that took its place, so the
    ink still arrives with words rather than in silence."""
    if not dropped:
        return
    remaining = max(0, total - len(dropped))
    for obj in objects:
        meta = obj.get("meta") if isinstance(obj, dict) else None
        beat = meta.get("beat") if isinstance(meta, dict) else None
        if not isinstance(beat, dict):
            continue
        for key in ("with", "after"):
            index = beat.get(key)
            if not isinstance(index, int) or isinstance(index, bool):
                continue
            shift = sum(1 for d in dropped if d < index)
            beat[key] = max(0, min(max(remaining - 1, 0), index - shift))


def enforce_board(plan: Any, context: dict[str, Any]) -> Spoken:
    """The law on a board turn: the plan's say is trimmed, its ledger gains the confirmed sums,
    and its refusals name what was not spoken. Mutates the plan."""
    verified = {c.name for c in plan.ledger.checks if c.passed}
    decided = audit(
        plan.say,
        given=given_numbers(context),
        verified=verified_numbers(plan.objects, verified),
    )
    for check in decided.checks:
        plan.ledger.note(check)
    if decided.unsaid:
        total = len(sentences(plan.say))
        reanchor(plan.objects, decided.dropped, total)
        for numeral, sentence in decided.unsaid:
            plan.refusals.append(
                f"not spoken: {numeral!r} in {sentence!r} is a number no verifier produced"
            )
        logger.warning(
            "spoken-number law dropped a sentence",
            extra={"fields": {"unsaid": [n for n, _ in decided.unsaid][:6]}},
        )
    plan.say = decided.say
    return decided


def retry_note(decided: Spoken) -> str:
    """What the five-path turn tells the model when its say broke the law, once."""
    numerals = ", ".join(dict.fromkeys(n for n, _ in decided.unsaid))
    return (
        f"Your say carries numbers nothing checked: {numerals}. A number in what you say is one "
        "the learner gave you, or a small sum written out in full so code can confirm it "
        '("9 + 16 = 25", "1/2 = 2/4"), or it is theirs to work out in your question. Say it again '
        "properly, keeping the why and the check, and reply with the full JSON."
    )
