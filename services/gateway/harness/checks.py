"""What can be decided without asking another model.

Everything here is deterministic: a regex, an arithmetic comparison, a set membership. That
matters because the most important question the harness asks — *did a wrong number reach a
learner* — must never itself depend on a model's opinion. A judge can be wrong about whether an
explanation was warm. It must not be the only thing standing between a child and a false fact.

Three severities, and they mean different things:

``wrong``  something false, unverified or forbidden reached the learner. The run FAILS on one of
           these, however good the rest of the report looks.
``weak``   the teaching missed something it claims to do. Scored down, reported, never fatal.
``note``   evidence worth having on the record — a refusal the gate made, a claim never asserted.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

WRONG = "wrong"
WEAK = "weak"
NOTE = "note"


@dataclass(frozen=True)
class Finding:
    severity: str
    dimension: str
    detail: str
    evidence: str = ""


@dataclass
class Scored:
    findings: list[Finding] = field(default_factory=list)
    #: dimension -> 0..4, or None for "did not apply to this question".
    scores: dict[str, int | None] = field(default_factory=dict)

    def add(self, severity: str, dimension: str, detail: str, evidence: str = "") -> None:
        self.findings.append(Finding(severity, dimension, detail, evidence[:400]))

    @property
    def wrong(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == WRONG]

    @property
    def weak(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == WEAK]


# --- 1. the answer is not false ---------------------------------------------------------------
#
# HOW A CLAIM IS MATCHED, and why it is not one regex over one blob of text.
#
# The first version of this file joined the spoken line to the board text and ran one pattern over
# the result. Every pattern was written the way prose reads -- ``jallianwala[^.\n]{0,60}?(\d{4})``,
# the name and then the number, on one line. The product does not write that. The history board
# draws the YEAR as its own ``number`` object and the EVENT as a separate label underneath, and
# ``board_text()`` joins objects with newlines, so ``[^.\n]`` could never bridge them. Eight of the
# nine claims in the bank matched nothing at all on the product's own recorded transcripts, and a
# timeline that dated the Jallianwala Bagh massacre to 1921 scored four out of four.
#
# So the match is made against what the learner actually receives, in the shape it actually has:
#
# * **Board numbers are matched by identity, not by proximity.** A ``number`` object carries the
#   verifier check it names (``board.numbers_agree:apex height``), its unit, its own label, and it
#   hangs off an anchor that other objects hang off too -- the tick that carries both the year and
#   the event, the O2 the coefficient sits in front of. Those together are what the quantity IS,
#   and the value checked against ground truth is that object's own ``value``. No window, no
#   ordering, no bridging of newlines.
# * **Words are matched inside one sentence.** The spoken line, the ask prompt and every glyph the
#   hand writes are split into sentences, and a claim's value must sit within ``window`` characters
#   of the phrase that names it, on either side. Either side, because a board writes "1919" above
#   "Jallianwala Bagh massacre" and a person writes it the other way round.


def _matches(value: float, truth: tuple[float, ...], tolerance: float) -> bool:
    return any(abs(value - t) <= tolerance for t in truth)


#: A number as it is written anywhere: on a board, in a sentence, with either minus sign.
_NUMBER = re.compile(r"[-−]?\d+(?:\.\d+)?")

#: Sentence ends, minus the one that is not: the dot inside 10.19.
_SENTENCE = re.compile(r"(?<!\d)[.!?;\n](?!\d)")

#: The kinds that put words on the board. ``number`` is deliberately absent: it goes down the
#: identity path below, where what it means is known rather than guessed at from its neighbours.
_TEXT_KINDS = frozenset({"write", "label", "tex", "table", "axis", "region", "image", "bracket"})


def _to_float(raw: str) -> float | None:
    try:
        return float(raw.replace("−", "-"))
    except ValueError:
        return None


#: Counts a person writes out. A tutor asking "which two boxes" is asserting a quantity exactly as
#: firmly as one writing "2", and a check that only reads numerals cannot see it. Opt-in per claim
#: (``Claim.words``), because widening every claim to read these would put a number in reach of a
#: phrase that was never about it.
_WORD_NUMBERS = {
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
    "seven": "7", "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12",
}  # fmt: skip
_WORD_NUMBER_RE = re.compile(r"\b(" + "|".join(_WORD_NUMBERS) + r")\b", re.IGNORECASE)


def _with_word_numbers(segment: str) -> str:
    return _WORD_NUMBER_RE.sub(lambda m: _WORD_NUMBERS[m.group(1).lower()], segment)


def text_segments(transcript: Any, *, board: bool = True) -> list[str]:
    """Every sentence the learner reads or hears, one per entry.

    A segment is the unit a claim is matched inside, so it has to be small enough that two
    unrelated numbers do not land in the same one (the timeline's 1930 and 1931 are four words
    apart) and whole enough that a quantity and the words naming it are never split.

    ``board`` false leaves the glyphs out and keeps only what Wobo says and asks, for a claim whose
    naming phrase means one thing in a sentence and something else on a board.
    """
    from wobo_gateway.board import schema

    segments: list[str] = []
    for prose in (transcript.say, transcript.ask_text()):
        segments.extend(part.strip() for part in _SENTENCE.split(prose or "") if part.strip())
    if not board:
        return segments
    for obj in transcript.objects:
        if str(obj.get("kind") or "") not in _TEXT_KINDS:
            continue
        text = schema.visible_text(obj)
        if text.strip():
            segments.append(text.strip())
    return segments


def _group_key(obj: dict[str, Any]) -> str:
    """What an object hangs off, or itself. Objects sharing one are one thing on the board."""
    anchor = obj.get("anchor") if isinstance(obj.get("anchor"), dict) else {}
    target = anchor.get("object") if isinstance(anchor, dict) else None
    if isinstance(target, str) and target.strip():
        return target
    return str(obj.get("id") or "")


def _check_words(check: str) -> str:
    """The name the verifier gave the quantity: ``board.numbers_agree:apex height`` -> apex height.

    This is the pipeline's own word for what the number is. It is written into the plan before the
    value is known, which is exactly what a claim needs in order to tell WHICH number it is
    looking at when a board draws four of them.
    """
    if not check:
        return ""
    if ":" in check:
        return check.split(":", 1)[1].replace("_", " ").strip()
    return check.split(".")[-1].replace("_", " ").strip()


def board_numbers(transcript: Any) -> list[tuple[str, float]]:
    """Every numeral the hand wrote as a ``number``, with what identifies it on the board."""
    from wobo_gateway.board import schema

    around: dict[str, list[str]] = {}
    for obj in transcript.objects:
        if str(obj.get("kind") or "") not in _TEXT_KINDS:
            continue
        text = schema.visible_text(obj)
        if text.strip():
            around.setdefault(_group_key(obj), []).append(text.strip())

    found: list[tuple[str, float]] = []
    for obj in transcript.objects:
        if str(obj.get("kind") or "") != "number":
            continue
        value = obj.get("value")
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        identity = " ".join(
            part
            for part in (
                _check_words(str(obj.get("check") or "")),
                str(obj.get("unit") or ""),
                str(obj.get("label") or ""),
                *around.get(_group_key(obj), []),
            )
            if part
        )
        found.append((identity, float(value)))
    return found


def _values_near(segment: str, about: re.Pattern[str], window: int) -> list[tuple[str, float]]:
    """Every number a phrase claims, inside one sentence: the nearest after it, else the nearest
    before it.

    Either side, because "the hypotenuse is 5" and "1919 / Jallianwala Bagh massacre" are the same
    claim written the two ways this product actually writes them.
    """
    numbers = [(m.start(), m.end(), m.group(0)) for m in _NUMBER.finditer(segment)]
    if not numbers:
        return []
    out: list[tuple[str, float]] = []
    for hit in about.finditer(segment):
        after = next((n for n in numbers if n[0] >= hit.end() and n[0] - hit.end() <= window), None)
        before = None
        for n in numbers:
            if n[1] <= hit.start() and hit.start() - n[1] <= window:
                before = n
        chosen = after or before
        if chosen is None:
            continue
        value = _to_float(chosen[2])
        if value is not None:
            out.append((segment, value))
    return out


def claimed_values(claim: Any, transcript: Any) -> list[tuple[str, float]]:
    """Every value this claim finds asserted, each with the evidence it came from."""
    about = re.compile(claim.about, re.IGNORECASE)
    found: list[tuple[str, float]] = []
    if claim.where in ("both", "board"):
        for identity, value in board_numbers(transcript):
            if about.search(identity):
                found.append((f"the board wrote {value:g} for: {identity}", value))
    if claim.where in ("both", "prose"):
        for segment in text_segments(transcript, board=claim.where == "both"):
            read = _with_word_numbers(segment) if claim.words else segment
            found.extend(_values_near(read, about, claim.window))
    return found


def check_claims(case: Any, transcript: Any, out: Scored) -> None:
    """Every quantity the answer ASSERTS, against ground truth computed a different way.

    This is the check the whole harness exists for. It reads all three halves of what the learner
    receives -- Wobo's spoken line, the question in the ask frame, and every glyph on the board --
    because a false number is just as false written as said, and just as false in the question put
    back to the child as in the answer.
    """
    text = transcript.everything_said()
    if not text.strip():
        out.scores["correct"] = None
        return
    if not case.claims:
        # No ground truth exists for this question, so nothing here knows whether the answer is
        # true. That is an UNCHECKED answer and the report says so. It used to score 4 out of 4
        # for producing non-empty text, which handed a free top mark to exactly the questions
        # nobody knows the truth of and floated them into the rollups the owner reads.
        out.add(NOTE, "correct", "nothing in this bank knows the truth of this answer: unchecked")
        out.scores["correct"] = 2
        return

    asserted = 0
    contradicted = 0
    missing: list[str] = []
    for claim in case.claims:
        found = claimed_values(claim, transcript)
        asserted += len(found)
        for evidence, value in found:
            if _matches(value, claim.truth, claim.tolerance):
                continue
            contradicted += 1
            out.add(
                WRONG,
                "correct",
                f"{claim.name}: said {value:g}, and the truth is "
                f"{', '.join(f'{t:g}' for t in claim.truth)}",
                evidence.replace("\n", " "),
            )
        for wanted in claim.must_include:
            if found and not any(_matches(v, (wanted,), claim.tolerance) for _, v in found):
                missing.append(f"{claim.name}: {wanted:g} is never stated")

    for detail in missing:
        out.add(WEAK, "correct", detail)

    if contradicted:
        out.scores["correct"] = 0
    elif not asserted:
        # Nothing the harness knows the truth about was asserted. That is not a pass and it is not
        # a failure: it is an unchecked answer, and the report says so rather than showing green.
        out.add(NOTE, "correct", "no quantity this case knows the truth about was asserted")
        out.scores["correct"] = 2
    elif missing:
        out.scores["correct"] = 2
    else:
        out.scores["correct"] = 4


def check_forbidden(case: Any, transcript: Any, out: Scored) -> None:
    """The graduated-hint law: a learner mid-working is never handed the final value."""
    if not case.forbid:
        return
    text = transcript.everything_said().lower()
    hits = [phrase for phrase in case.forbid if phrase.lower() in text]
    for phrase in hits:
        out.add(
            WRONG,
            "teaches",
            f'handed the answer: "{phrase}" appears, and this turn is a learner mid-working',
            transcript.say[:300],
        )
    if hits:
        out.scores["teaches"] = 0


# --- 2. the verified-number law actually ran ---------------------------------------------------


def check_number_law(transcript: Any, out: Scored) -> None:
    """BOARD.md section 6, proved on the wire rather than in a unit test.

    Three things have to hold at once, and each one closes a different hole:

    * an object whose glyphs carry a numeral names a check (``schema.validate_object`` refuses one
      that does not, so a violation here means the law did not run at all);
    * the check it names is in the ``done`` frame's ``verified`` list — that list is built from the
      verifier's own ledger, so a name that is not in it is a laundering token;
    * a board that drew numbers ran at least one check.
    """
    from wobo_gateway.board import schema

    if not transcript.objects:
        out.scores["verified"] = None
        return

    verified = set(transcript.verified)
    numeric = 0
    for obj in transcript.objects:
        text = schema.visible_text(obj)
        if not schema.contains_number(text):
            continue
        numeric += 1
        check = str(obj.get("check") or "")
        if not check:
            out.add(
                WRONG,
                "verified",
                f"object {obj.get('id')!r} ({obj.get('kind')}) shows a number and names no check",
                text,
            )
        elif check not in verified:
            out.add(
                WRONG,
                "verified",
                f"object {obj.get('id')!r} names the check {check!r}, which did not run this turn",
                text,
            )

    if numeric and not verified:
        out.add(WRONG, "verified", "numbers were drawn and no verifier check ran at all")

    if not numeric:
        out.scores["verified"] = None
        return
    broke_the_law = any(
        f.severity == WRONG and f.dimension == "verified" for f in out.findings
    )
    out.scores["verified"] = 0 if broke_the_law else 4


def _python_arithmetic(statement: str) -> bool | None:
    """A written-out sum, evaluated with plain Python. Deliberately NOT the product's route.

    The product confirms a spoken sum with SymPy in the verifier's sandbox. The harness confirms
    it again here with ``fractions`` and the interpreter's own arithmetic, so a sum has to be
    wrong twice, two different ways, to pass. ``None`` when this reader cannot make sense of it.
    """
    import ast
    from fractions import Fraction

    ops = {
        ast.Add: lambda a, b: a + b,
        ast.Sub: lambda a, b: a - b,
        ast.Mult: lambda a, b: a * b,
        ast.Div: lambda a, b: a / b,
        ast.Pow: lambda a, b: a**b,
    }

    def value(node: ast.AST) -> Fraction:
        # A walk over the four arithmetic node kinds and nothing else: no names, no calls, no
        # attributes, so there is no route out of arithmetic. Anything else is unreadable.
        if isinstance(node, ast.Expression):
            return value(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return Fraction(str(node.value))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            inner = value(node.operand)
            return -inner if isinstance(node.op, ast.USub) else inner
        if isinstance(node, ast.BinOp) and type(node.op) in ops:
            return ops[type(node.op)](value(node.left), value(node.right))
        raise ValueError("not arithmetic")

    text = statement
    for before, after in (
        ("−", "-"), ("×", "*"), ("÷", "/"), ("²", "**2"), ("³", "**3"), ("^", "**"),
    ):  # fmt: skip
        text = text.replace(before, after)
    try:
        values = [value(ast.parse(side.strip(), mode="eval")) for side in text.split("=")]
    except (SyntaxError, ValueError, ZeroDivisionError, TypeError, OverflowError):
        return None
    return all(values[i] == values[i + 1] for i in range(len(values) - 1))


def check_say_numbers(case: Any, transcript: Any, out: Scored) -> None:
    """The spoken-number law, proved on the wire.

    The verified-number law is enforced on board OBJECTS. Wobo's spoken line used to be
    model-authored prose that went through the safety screen and nothing else, and this check
    only counted the unverified numbers in it. ``wobo_gateway.spoken`` now holds the say to the
    law before it is spoken, and this is the check that proves it: every numeral in the say is
    one the learner gave, one the verifier drew, one inside a sum the product's ledger says it
    confirmed (and this file confirms again, a different way), or one inside a question. Anything
    else reached a learner unsigned, and that is WRONG, not a note.
    """
    from wobo_gateway import safety, spoken

    verified_names = set(transcript.verified)
    given = spoken.numerals_in(case.ask)
    # The helplines are the product's own data (``safety.SUPPORT``), written by a person and not
    # by a model. A crisis line that gives Childline's number is not a number Wobo worked out.
    for line in safety.SUPPORT:
        given.extend(spoken.numerals_in(str(line.get("number") or "")))
    canvas = (case.context or {}).get("canvas") or {}
    given.extend(spoken.numerals_in(str(canvas.get("equation") or "")))
    for step in canvas.get("steps") or []:
        given.extend(spoken.numerals_in(str(step)))
    drawn = spoken.verified_numbers(transcript.objects, verified_names)

    # The product's own confirmed sums count only when its ledger says they ran, and only when
    # this file agrees they hold. A confirmed sum the harness finds false is a contradiction.
    confirmed: set[float] = set()
    for sentence in spoken.sentences(transcript.say):
        for statement in spoken.statements_in(sentence):
            if spoken.check_name(statement) not in verified_names:
                continue
            holds = _python_arithmetic(statement)
            if holds is False:
                out.add(
                    WRONG,
                    "verified",
                    f"the spoken sum {statement!r} was signed by the product and is false",
                    sentence,
                )
                continue
            confirmed.update(spoken.numerals_in(statement))

    # ``words=True``: "three balls out of six" asserts 3 and 6 exactly as firmly as the digits
    # would, and the one turn built on the learner's world was written that way. A number spelled
    # out used to walk round the law entirely (``spoken.numerals_in`` read digits only).
    decided = spoken.audit(
        transcript.say, given=set(given) | confirmed, verified=drawn, confirm=False, words=True
    )
    said = spoken.numerals_in(transcript.say, words=True)
    for numeral, sentence in decided.unsaid:
        out.add(
            WRONG,
            "verified",
            f"{numeral!r} in the spoken line is a number nothing signed",
            sentence,
        )
    if any(f.severity == WRONG and f.dimension == "verified" for f in out.findings):
        out.scores["verified"] = 0
        return
    if said:
        out.add(
            NOTE,
            "verified",
            f"{len(said)} number(s) in the spoken line, every one licensed: "
            + ", ".join(f"{n:g}" for n in said[:8]),
        )
        if out.scores.get("verified") is None:
            out.scores["verified"] = 4


def check_live_plan(case: Any, transcript: Any, out: Scored) -> None:
    """Did a LIVE board turn quietly fall back to the keyless plan?

    ``wobo.board_plan_for`` swallows every exception from the live planner and returns
    ``mock_board_plan`` instead — the right call for a learner (a provider outage gives them a
    drawing rather than nothing) and a trap for a harness, which would mark a keyword-matched mock
    board as though a model had planned it. The keyless plan's spoken line is one of four fixed
    strings, so it is recognisable on sight.
    """
    from wobo_gateway.wobo import _BOARD_SAY

    if transcript.say.strip() in {line.strip() for line in _BOARD_SAY.values()}:
        out.add(
            NOTE,
            "reached",
            "the live board plan fell back to the keyless plan (a provider failed), so this board "
            "was drawn from keywords rather than planned by a model",
            transcript.say[:200],
        )


def check_refusals(case: Any, transcript: Any, out: Scored) -> None:
    """What the planner threw away. Evidence the gate ran, and a signal when it ate the board."""
    for refusal in transcript.refused:
        out.add(NOTE, "verified", f"the planner refused an object: {refusal}")
    if case.needs_drawing and transcript.refused and not transcript.objects:
        out.add(
            WRONG,
            "drew",
            "every object was refused, so the learner asked for a drawing and got a blank board",
            "; ".join(transcript.refused[:4]),
        )


# --- 3. it drew something, and it drew the right kind of thing ----------------------------------


def check_drew(case: Any, transcript: Any, out: Scored) -> None:
    if not case.needs_drawing:
        out.scores["drew"] = None
        return
    if not transcript.objects:
        out.add(
            WRONG,
            "drew",
            "the question asked for a drawing and nothing was drawn",
            transcript.say[:300],
        )
        out.scores["drew"] = 0
        return
    kinds = {str(o.get("kind")) for o in transcript.objects}
    if case.expect_kinds and not (kinds & set(case.expect_kinds)):
        out.add(
            WEAK,
            "drew",
            f"drew {sorted(kinds)} but this question needs one of "
            f"{sorted(case.expect_kinds)}",
        )
        out.scores["drew"] = 2
        return
    out.scores["drew"] = 4


# --- 3b. it drew where the learner was looking ---------------------------------------------------


def _anchor_targets(obj: dict[str, Any]) -> set[str]:
    """Every registry target this object hangs off — its anchor, an arrow's `from`, a line's `to`."""
    out: set[str] = set()
    for field_name in ("anchor", "from", "to"):
        anchor = obj.get(field_name)
        if isinstance(anchor, dict) and isinstance(anchor.get("target"), str):
            out.add(anchor["target"])
    return out


def check_in_place(case: Any, transcript: Any, out: Scored) -> None:
    """The surface choice, measured (the owner, 2026-09-05).

    When the thing to point at is already on the learner's screen the answer is a mark ON it, in
    place, and the board stays shut; when there is something new to build, the board opens. Both
    are read off the transcript, never asserted: the ``done`` frame's presentation is what the
    client acts on, and each object's anchor is where its ink lands. A mark on the WRONG chip is
    a pointer at the wrong fact, and it is scored like one.
    """
    if not case.expect_presentation:
        out.scores["in place"] = None
        return
    landed = {t for o in transcript.objects for t in _anchor_targets(o)}
    where = f"presentation={transcript.presentation or '?'}; marks on {sorted(landed) or 'nothing'}"
    score = 4

    if transcript.presentation != case.expect_presentation:
        if case.expect_presentation == "screen":
            detail = (
                "opened the board for something already on the screen "
                f"(wanted a mark in place, got {transcript.presentation or 'no surface'})"
            )
        else:
            detail = (
                "stayed on the screen when there was something new to build "
                f"(wanted the {case.expect_presentation}, got {transcript.presentation or 'none'})"
            )
        out.add(WEAK, "in place", detail, where)
        score = 0

    if case.must_mark:
        wanted = set(case.must_mark)
        if not landed:
            out.add(WEAK, "in place", "no mark landed on anything on the screen", where)
            score = min(score, 0)
        elif not (landed & wanted):
            out.add(
                WEAK,
                "in place",
                f"the ink landed on {sorted(landed)}, not on {sorted(wanted)}: a pointer at the "
                "wrong thing",
                where,
            )
            score = min(score, 1)
        elif landed - wanted:
            # It found the right thing and also ringed others: less a pointer than a scatter.
            out.add(NOTE, "in place", f"also marked {sorted(landed - wanted)}", where)
            score = min(score, 3)

    if case.expect_presentation == "screen" and transcript.objects:
        off_screen = [
            str(o.get("id"))
            for o in transcript.objects
            if isinstance(o.get("anchor"), dict) and "board" in o["anchor"]
        ]
        if off_screen:
            out.add(
                WEAK,
                "in place",
                f"drew from scratch ({off_screen[:4]}) when the thing was already on the screen",
                where,
            )
            score = min(score, 1)

    out.add(NOTE, "in place", where)
    out.scores["in place"] = max(0, score)


def check_on_the_page(case: Any, transcript: Any, out: Scored) -> None:
    """The doubt solver's two laws, measured on the wire (doubt.py; the owner, 2026-09-05).

    Law 3: nothing is placed by pixels from the model's guess. The gateway refuses a mark whose
    anchor is not a line of the page and counts it in the ``done`` frame ("off the page: N"); that
    N is the measurement, and anything above zero is a finding, because a refused mark is a
    sentence whose drawing never landed. Every mark that WAS drawn must anchor to a line the
    reader found, or to another such mark.

    Law 5: it explains while it draws. Every ink frame on a doubt turn lands at the timestamp of a
    say frame, the sentence it was beaten to. An ink frame at a time no sentence starts is a
    drawing with no words, and a turn with ink and no say at all is the owner's "just draw on the
    image". Scored under ``in place``, the dimension for ink landing on the right thing.
    """
    if getattr(case, "mode", "") != "doubt":
        return
    lines = {str(line.get("id")) for line in (transcript.reading or []) if line.get("id")}
    where = f"lines read {sorted(lines) or 'none'}; {len(transcript.objects)} mark(s) drawn"
    score = out.scores.get("in place")
    score = 4 if score is None else score

    if transcript.off_page:
        out.add(
            WRONG,
            "in place",
            f"{transcript.off_page} mark(s) were placed by pixels rather than on a line of the "
            "page and were not drawn (law 3)",
            where,
        )
        score = 0
    known = {str(o.get("id")) for o in transcript.objects if o.get("id")}
    astray = [
        str(o.get("id"))
        for o in transcript.objects
        if not (
            isinstance(o.get("anchor"), dict)
            and (
                o["anchor"].get("target") in lines
                or (o["anchor"].get("object") in known and "target" not in o["anchor"])
            )
        )
    ]
    if astray:
        out.add(
            WRONG,
            "in place",
            f"ink anchored to something that is not a line of the page: {astray[:4]} (law 3)",
            where,
        )
        score = 0

    say_at = {int(f["data"].get("t") or 0) for f in transcript.events if f.get("type") == "say"}
    ink_at = [
        (str((f["data"].get("object") or {}).get("id")), int(f["data"].get("t") or 0))
        for f in transcript.events
        if f.get("type") == "ink"
    ]
    orphans = [f"{oid}@{t}" for oid, t in ink_at if t not in say_at]
    if ink_at and not say_at:
        out.add(
            WRONG, "in place", "it drew on the photo and said nothing: no say frame at all (law 5)", where
        )
        score = 0
    elif orphans:
        out.add(
            WRONG,
            "in place",
            f"ink landed with no sentence starting on it: {orphans[:4]} (law 5, explain while drawing)",
            where,
        )
        score = 0
    if not transcript.objects and not transcript.error:
        out.add(WEAK, "in place", "nothing was drawn on the photo at all", where)
        score = min(score, 1)
    out.add(NOTE, "in place", f"off the page: {transcript.off_page}; {where}")
    out.scores["in place"] = max(0, score)


# --- 4. the teaching ---------------------------------------------------------------------------

#: Wobo asserting rather than explaining. A turn made only of these is a statement, not a lesson.
#:
#: What is NOT here matters as much as what is. This list used to carry ``so``, ``since``, ``if
#: you``, ``when you``, ``whenever`` and ``as soon as``, which are the connectives of ordinary
#: fluent English rather than of explanation: "so the quadratic becomes a product of two brackets"
#: explains nothing and used to pass. With those gone the check can actually fail a fluent answer
#: that only asserts, which is the whole reason it exists.
_EXPLAINS = re.compile(
    r"\b(because|so that|which means|that means|this means|the reason|think of|imagine|"
    r"notice|that is why|that's why|which is why|so that's|in other words|comes from|works like|"
    r"the same way|to see why|the idea is)\b",
    re.IGNORECASE,
)


def _phrase(word: str) -> str:
    """One expected word, bounded so it cannot hide inside another.

    ``"over"`` as a bare substring is in "moreover", "however", "discover" and "overall", and a
    generic explanation of equivalent fractions that never mentions cricket scored 4 out of 4 on
    the persona law because it contained the word "Moreover". A boundary is only added where the
    phrase actually starts or ends in a word character, so "3:1" still matches.
    """
    escaped = re.escape(word)
    left = r"\b" if word[:1].isalnum() else ""
    right = r"\b" if word[-1:].isalnum() else ""
    return f"{left}{escaped}{right}"


def mentions(text: str, words: tuple[str, ...]) -> bool:
    """Does the answer actually use one of these words, as a word?"""
    return any(re.search(_phrase(w), text, re.IGNORECASE) for w in words if w.strip())


#: The check nobody answers honestly. ``wobo.TEACHING_LAW`` bans these by name; a question made of
#: one of them is not a check, it is a tic, and it does not count as handing the move back.
_HOLLOW_CHECK = re.compile(
    r"\b(do you understand|does (?:that|this|it) make sense|make sense|got it|understand|"
    r"okay|ok|clear|with me|following)\s*\?",
    re.IGNORECASE,
)

#: A yes-or-no check. "Is one half equivalent to two fourths?" can be nodded at, and a nod is not
#: a move handed back: the learner has done no arithmetic to answer it. A question that opens on
#: an auxiliary and carries no wh-word anywhere is one of these. "Can you spot WHICH boxes" is
#: not, because the which is the work.
_YES_NO_OPENER = re.compile(
    r"^\s*(?:tiny check[:,]?\s*|quick check[:,]?\s*|check[:,]?\s*)?"
    r"(is|are|was|were|does|do|did|can|could|would|will|should|has|have)\b",
    re.IGNORECASE,
)
_WH_WORD = re.compile(r"\b(what|which|why|how|where|when|who|whose)\b", re.IGNORECASE)

#: A question whose answer the same turn already gave. "Which element would you balance first?"
#: one sentence after "Start with carbon" is a tic dressed as a check.
#: "Why do you think the Quit India call came in 1942?" shares its words with a dated label and is
#: not a lookup: a why or a how asks for reasoning, whatever the board has written beside it.
_ASKS_FOR_REASON = re.compile(
    r"\b(why|how come|how do you know|explain)\b"
    # A different case from the one on the board is work too: "if one parent were aa instead,
    # how many boxes..." is not read off the 1 written beside "recessive".
    r"|\b(if|suppose|imagine|what if)\b[^.?!]*\b(instead|were|was|changed|different)\b",
    re.IGNORECASE,
)
_TELLS_THE_ORDER = re.compile(r"\b(start with|begin with|first,?\s+(?:do|take|balance))\b", re.I)
_ASKS_THE_ORDER = re.compile(r"\b(first|start|begin)\b", re.IGNORECASE)


def _content_words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z][a-z']{2,}", text.lower()) if w not in _STOP}


_STOP = frozenset(
    ["the", "and", "you", "your", "what", "which", "where", "why", "how", "does", "did", "can", "could", "would", "should", "this", "that", "these", "those", "from", "with", "have", "has", "had", "for", "are", "was", "were", "will", "its", "it's", "here", "there", "one", "read", "see", "look", "tiny", "check", "quick", "now", "next"]
)


def hollow_reason(question: str, transcript: Any) -> str:
    """Why this question is not a real check, or an empty string when it is one.

    Three shapes, all decided by reading rather than by opinion:

    * the banned forms ("does that make sense?");
    * a yes-or-no question, which a learner nods at without doing anything;
    * a question the turn has already answered: its content word is the label beside a number
      the board just wrote (the slope, when 2 sits beside "slope here"), or it asks what to do
      first when the say has just said "start with carbon".
    """
    if _HOLLOW_CHECK.search(question):
        return "nobody answers it honestly"
    if _YES_NO_OPENER.search(question) and not _WH_WORD.search(question):
        return "a yes or no, which a learner nods at without doing any work"
    asked = _content_words(question)
    if asked and not _ASKS_FOR_REASON.search(question):
        # A word the question shares with the label beside ONE number is a lookup ("what slope",
        # when 2 sits beside "slope here"). The same word beside several numbers is a choice
        # among them ("which movement", on a timeline of nine dated movements), and choosing is
        # the work.
        shared: dict[str, list[float]] = {}
        for identity, value in board_numbers(transcript):
            for word in asked & _content_words(identity):
                shared.setdefault(word, []).append(value)
        for word, values in sorted(shared.items()):
            if len(values) == 1:
                return (
                    f"the board already writes {values[0]:g} beside "
                    f"{word!r}, so the answer is in front of them"
                )
    if _ASKS_THE_ORDER.search(question):
        for sentence in _SENTENCE.split(transcript.say or ""):
            if question.strip() in sentence:
                continue
            if _TELLS_THE_ORDER.search(sentence):
                return f"the say already answers it: {sentence.strip()[:80]!r}"
    return ""


def check_teaching(case: Any, transcript: Any, out: Scored) -> None:
    """Explains rather than asserts, hands the next move back, and SAYS what was asked for.

    Both are laws already written into ``wobo.WOBO_SYSTEM`` and ``wobo.BOARD_SYSTEM``: a graduated
    hint that asks rather than tells, and an ``ask`` that hands the next move back. Neither had a
    test until this one.

    Presence is put on the record as well as absence. The owner reads the report to see whether
    the teaching has a WHY in it, and "no finding" is not the same as "here is the because".
    """
    from wobo_gateway import spoken

    text = transcript.everything_said()
    score = 4

    explained = _EXPLAINS.search(text)
    if not explained:
        out.add(
            WEAK,
            "teaches",
            "asserts without explaining: no causal or connecting language anywhere in the answer",
            transcript.say[:300],
        )
        score -= 2
    else:
        start = max(0, explained.start() - 40)
        out.add(
            NOTE,
            "teaches",
            f'explains: "{explained.group(0)}"',
            text[start : explained.end() + 80].replace("\n", " "),
        )

    if case.expect_question:
        questions = list(
            dict.fromkeys(
                q.strip()
                for q in (transcript.ask_text(), *re.findall(r"[^.?!\n]*\?", transcript.say))
                if q.strip()
            )
        )
        judged = [(q, hollow_reason(q, transcript)) for q in questions]
        real = [q for q, why in judged if not why]
        hollow = [(q, why) for q, why in judged if why]
        if hollow and not real:
            question, why = hollow[0]
            out.add(
                WEAK,
                "teaches",
                f'a hollow check, {why}: "{question[-80:]}"',
                transcript.say[:300],
            )
            score -= 2
        elif not real:
            out.add(
                WEAK,
                "teaches",
                "never checks understanding: no question to the learner and no ask frame",
                transcript.say[:300],
            )
            score -= 2
        else:
            out.add(NOTE, "teaches", f'checks: "{real[0][-120:]}"')

    if case.expect_any:
        if not mentions(text, tuple(case.expect_any)):
            out.add(
                WEAK,
                "teaches",
                f"none of the ideas this question is about appear: {list(case.expect_any)}",
                transcript.say[:300],
            )
            score -= 1

    if getattr(case, "expect_working", False):
        # They asked Wobo to WORK IT OUT. The working is a sum written out in full in the spoken
        # line, confirmed by the product's own CAS and recorded in the ledger as
        # ``say.arithmetic:<statement>``. "The long side follows Pythagoras because the squares
        # add" restates the theorem as its own reason; it scored full marks on the word "because"
        # and never said 9 + 16 = 25. A learner who asked how to work it out was not shown.
        worked = [v for v in transcript.verified if str(v).startswith("say.arithmetic:")]
        if worked:
            out.add(NOTE, "teaches", f"works it out in the say: {worked[0].split(':', 1)[1]}")
        else:
            out.add(
                WEAK,
                "teaches",
                "asked to work it out, and the say carries no sum written out in full: the "
                "answer sits on the board and the working is never said",
                transcript.say[:300],
            )
            score -= 2

    if getattr(case, "answer_in_say", False) and case.claims:
        # They asked for a NUMBER ("work out the hypotenuse", "tell me how high it gets"). The
        # board carrying it is not the same as Wobo telling them: "the curve will show the
        # greatest height" hands the answer to a picture. Every value a claim says must be stated
        # has to be spoken or asked, to the precision it is said at ("about 10.2 m" for 10.197).
        spoken_text = "\n".join(p for p in (transcript.say, transcript.ask_text()) if p)
        said_values = spoken.numerals_in(spoken_text, words=True)
        said_raw = [m.group(0) for m in spoken._NUMERAL.finditer(spoken_text)]
        for claim in case.claims:
            for wanted in claim.must_include:
                stated = any(
                    spoken._rounds_to(raw, {wanted}) for raw in said_raw
                ) or any(abs(v - wanted) <= claim.tolerance for v in said_values)
                if not stated:
                    out.add(
                        WEAK,
                        "teaches",
                        f"asked for the number and never told it: {claim.name} ({wanted:g}) is "
                        "on the board, if anywhere, and never said or asked",
                        transcript.say[:300],
                    )
                    score -= 2
                    break

    out.scores.setdefault("teaches", max(0, score))


def check_misnamings(case: Any, transcript: Any, out: Scored) -> None:
    """A right number under the wrong name is a wrong fact.

    The recorded punnett turn taught a Class 10 learner that "the square shows the genotype ratio"
    over a board reading 3 and 1, which is the PHENOTYPE ratio (the genotype ratio of Aa x Aa is
    1:2:1). No arithmetic check could see it: every number was verified and every number was
    right. So a case may name the phrases that are easy to swap, the values that must never sit
    beside each of them, and the value that has to be somewhere on the record when the phrase is
    used at all. Read inside one sentence, and only up to the next competing phrase, so a sentence
    that names both ratios correctly is not caught for naming both.
    """
    misnamings = getattr(case, "misnamings", ())
    if not misnamings:
        return
    everything = transcript.everything_said()
    all_values = set(spoken_all_values(transcript))
    for rule in misnamings:
        phrase = re.compile(rule.phrase, re.IGNORECASE)
        stop = re.compile(rule.stop, re.IGNORECASE) if rule.stop else None
        wrong = re.compile(rule.wrong_beside, re.IGNORECASE) if rule.wrong_beside else None
        used = False
        for segment in text_segments(transcript):
            for hit in phrase.finditer(segment):
                used = True
                tail = segment[hit.end() :]
                if stop is not None:
                    nxt = stop.search(tail)
                    if nxt:
                        tail = tail[: nxt.start()]
                if wrong is not None and wrong.search(tail):
                    out.add(
                        WRONG,
                        "correct",
                        f"{rule.why}: {hit.group(0)!r} is put beside {wrong.search(tail).group(0)!r}",
                        segment,
                    )
                    out.scores["correct"] = 0
        if used and rule.needs is not None and not any(
            abs(v - rule.needs) <= 1e-6 for v in all_values
        ):
            out.add(
                WRONG,
                "correct",
                f"{rule.why}: the answer speaks of it and {rule.needs:g} is nowhere on the "
                "record, so the numbers it is pointing at are the other ratio's",
                everything[:200].replace("\n", " "),
            )
            out.scores["correct"] = 0


def spoken_all_values(transcript: Any) -> list[float]:
    """Every number the learner received, spoken, asked or drawn."""
    from wobo_gateway import spoken

    values = spoken.numerals_in(transcript.everything_said(), words=True)
    for _identity, value in board_numbers(transcript):
        values.append(value)
    return values


def check_their_world(case: Any, transcript: Any, out: Scored) -> None:
    """"Reach for THEIR world for every example and analogy" — the persona law, tested."""
    if not case.world:
        out.scores["their world"] = None
        return
    text = transcript.everything_said()
    # The world's OWN words, never the case's ``expect_any``: that list carried "over", "run" and
    # "bat" for the cricket learner, so "let us go over this again" and "I will run through it"
    # scored 4 out of 4 on the persona law with no cricket in them. A case names the words that
    # can only mean its world; the world's name alone is the fallback.
    words = tuple(getattr(case, "world_words", ()) or ()) or (case.world,)
    if mentions(text, words):
        out.scores["their world"] = 4
        return
    out.add(
        WEAK,
        "their world",
        f"the dossier says this learner is into {case.world} and the answer never reaches for it",
        transcript.say[:300],
    )
    out.scores["their world"] = 0


# --- 5. the voice laws --------------------------------------------------------------------------

#: The white-label law (WOBO-PLAN section 17), in the one place it has never been checked: what the
#: model itself says. ``scripts/gate_white_label.py`` scans source and the built bundle; nothing
#: scanned a live answer.
_VENDOR = re.compile(
    r"\b(gemini|openai|anthropic|claude|litellm|supabase|railway|vercel|gpt-?\d[\w.-]*|"
    r"language model|large language model|\bllm\b)\b",
    re.IGNORECASE,
)
_GENDERED = re.compile(r"\b(she|her|hers|herself|he|him|his|himself)\b", re.IGNORECASE)
_WOBO = re.compile(r"wobo", re.IGNORECASE)
_PRONOUN_WINDOW = 60
_EMOJI = re.compile(
    "[" "\U0001f300-\U0001faff" "\U00002600-\U000027bf" "\U0001f1e6-\U0001f1ff" "]"
)
#: The clock law, narrowed to the rows that describe WHEN A CHILD STUDIES. ``hours.test.ts``
#: deliberately keeps curriculum out of its own walk (India's independence at midnight is a date in
#: a history lesson), and a tutor answering a history question is exactly that case, so the bare
#: hour and the word "midnight" are not banned here. What is banned is Wobo picturing the child at
#: a table late, which is the reason the law exists.
_LATE_HOUR = re.compile(
    r"\btonight\b|\blate at night\b|\bwhen everyone (?:else )?is asleep\b|"
    r"\bthe night before (?:the |an )?exam\b|\bstay up\b",
    re.IGNORECASE,
)

#: THE REGISTER (docs/copy/voice.md section 10a; the owner, 2026-09-05: "good vocabulary, not too
#: professional and not too street"). Two ways to miss, and both are words, so both are checkable.
#: TOO STREET is an adult doing a teenager: slang and hype borrowed from a feed. The list is kept to
#: words with no honest classroom use, so a chemistry answer in which a candle is "lit" or a
#: probability answer with a "bet" in it is not caught by mistake.
_STREET = re.compile(
    r"\b(lowkey|highkey|no cap|fr fr|fr|bruh|bestie|slay|goated|rizz|deadass|fam|yeet|sus|"
    r"ngl|tbh|lol|omg|vibes?|lit af|af|banger|w rizz|big w|it's giving)\b",
    re.IGNORECASE,
)
#: TOO PROFESSIONAL is the textbook voice: the long word where a short one exists, the ceremonial
#: opener, the American school year. "hence" and "thus" are left alone; they are how Indian
#: mathematics is written, and a learner has seen them on every board paper.
#:
#: "quiz" is NOT here. The product ships a quiz component and ``WOBO_SYSTEM`` tells Wobo to use it
#: for "quiz me"; a law that failed the product's own noun was a contradiction, not a register.
_STIFF = re.compile(
    r"\b(it is imperative|let us\b|utili[sz](?:e|es|ed|ing|ation)|commenc(?:e|es|ed|ing)|"
    r"due to the fact that|it should be noted|the aforementioned|hereby|in conclusion|"
    r"it is worth noting|furthermore|grade \d{1,2}|semester)\b",
    re.IGNORECASE,
)

#: The lecture built of ordinary words, which no fixed phrase list can see. "I've linked the key
#: turning points because each one widened the struggle, from protest against colonial violence to
#: the demand for complete freedom. Notice how mass movements, negotiations, and sacrifice all
#: pushed Britain towards leaving India." passed the register check with full marks. It is an
#: essay's closing paragraph read to a fifteen year old: abstract nouns in a row, nobody addressed.
#: Two readings, both mechanical:
#:
#: * an ABSTRACT NOUN is a word with one of the nominalising suffixes, not capitalised (a proper
#:   noun is a name, not an abstraction) and not one of the concrete classroom words that happen to
#:   end the same way (an equation, a fraction, a solution, an experiment);
#: * a say is a LECTURE when it carries three or more of them, or lists three things of which two
#:   are abstract ("movements, negotiations, and sacrifice").
_ABSTRACT_SUFFIX = re.compile(
    r"\b[a-z]+(?:tion|sion|ment|ance|ence|ity|ism|ness|dom|hood|ship)s?\b"
)
_CONCRETE = frozenset(
    ["equation", "equations", "fraction", "fractions", "function", "functions", "solution", "solutions", "addition", "subtraction", "multiplication", "division", "direction", "directions", "position", "positions", "reaction", "reactions", "question", "questions", "section", "sections", "proportion", "proportions", "condition", "conditions", "element", "elements", "segment", "segments", "experiment", "experiments", "moment", "moments", "measurement", "measurements", "statement", "statements", "distance", "distances", "science", "sentence", "sentences", "difference", "differences", "instrument", "instruments", "document", "documents", "cement", "argument", "arguments", "gravity", "velocity", "density", "quantity", "quantities", "city", "cities", "unity", "intensity", "electricity", "capacity", "humidity", "ship", "ships", "friendship", "relationship"]
)
_LIST_OF_THREE = re.compile(r"\b([a-z]+),\s+([a-z]+),?\s+and\s+([a-z]+)\b")
LECTURE_NOUNS = 3


def abstract_nouns(say: str) -> list[str]:
    """The abstract nouns in a spoken line, in order, lower case and uncapitalised only."""
    found: list[str] = []
    for match in _ABSTRACT_SUFFIX.finditer(say):
        word = match.group(0)
        if word in _CONCRETE:
            continue
        found.append(word)
    return found


def lecture_reason(say: str) -> str:
    """Why this spoken line reads as a lecture, or an empty string when it does not."""
    nouns = abstract_nouns(say)
    if len(nouns) >= LECTURE_NOUNS:
        return f"{len(nouns)} abstract nouns in one answer ({', '.join(nouns[:4])})"
    for triple in _LIST_OF_THREE.finditer(say):
        items = [w for w in triple.groups()]
        heavy = [w for w in items if _ABSTRACT_SUFFIX.fullmatch(w) and w not in _CONCRETE]
        if len(heavy) >= 2:
            return f"a list of abstractions, an essay's closing line: {', '.join(items)}"
    return ""


def check_voice(transcript: Any, out: Scored) -> None:
    text = transcript.everything_said()
    if not text.strip():
        out.scores["voice"] = None
        return
    score = 4

    # The register, both ways of missing it.
    street = _STREET.search(text)
    if street:
        out.add(
            WEAK,
            "voice",
            f'too street, an adult doing a teenager: "{street.group(0)}"',
            text[max(0, street.start() - 80) : street.end() + 80],
        )
        score = min(score, 2)
    stiff = _STIFF.search(text)
    if stiff:
        out.add(
            WEAK,
            "voice",
            f'too professional, the textbook voice: "{stiff.group(0)}"',
            text[max(0, stiff.start() - 80) : stiff.end() + 80],
        )
        score = min(score, 2)
    lecture = lecture_reason(transcript.say or "")
    if lecture:
        out.add(
            WEAK,
            "voice",
            f"too professional, a lecture in ordinary words: {lecture}",
            (transcript.say or "")[:300],
        )
        score = min(score, 2)
    if "\u2014" in text:
        # The owner's standing law: no em dashes in anything a learner reads. A colon or a comma
        # says the same thing; the dash is the tell of prose nobody read back.
        dash = text.index("\u2014")
        out.add(
            WEAK,
            "voice",
            "an em dash, and the standing law says none",
            text[max(0, dash - 60) : dash + 60],
        )
        score = min(score, 2)

    for match in _VENDOR.finditer(text):
        out.add(
            WRONG,
            "voice",
            f'named what is underneath: "{match.group(0)}"',
            text[max(0, match.start() - 80) : match.end() + 80],
        )
        score = 0

    for match in _GENDERED.finditer(text):
        near = text[max(0, match.start() - _PRONOUN_WINDOW) : match.end() + _PRONOUN_WINDOW]
        if _WOBO.search(near):
            out.add(
                WRONG,
                "voice",
                f'gendered Wobo: "{match.group(0)}" within {_PRONOUN_WINDOW} characters of'
                " the name",
                near,
            )
            score = 0

    for match in _LATE_HOUR.finditer(text):
        out.add(
            WRONG,
            "voice",
            f'named a late hour: "{match.group(0)}"',
            text[max(0, match.start() - 80) : match.end() + 80],
        )
        score = 0

    if _EMOJI.search(text):
        out.add(WEAK, "voice", "the persona law says no emoji, and there is one", text[:200])
        score = min(score, 2)
    if "!" in text:
        out.add(
            WEAK,
            "voice",
            "the persona law says no exclamation marks, and there is one",
            text[:200],
        )
        score = min(score, 2)

    out.scores["voice"] = score


# --- the whole deterministic pass ---------------------------------------------------------------


def score_transcript(case: Any, transcript: Any) -> Scored:
    out = Scored()
    if transcript.error:
        out.add(WRONG, "reached", f"the turn never produced an answer: {transcript.error}")
        out.scores = dict.fromkeys(
            ("correct", "verified", "drew", "in place", "teaches", "their world", "voice")
        )
        out.scores["reached"] = 0
        return out
    out.scores["reached"] = 4

    check_claims(case, transcript, out)
    check_misnamings(case, transcript, out)
    check_forbidden(case, transcript, out)
    check_number_law(transcript, out)
    check_say_numbers(case, transcript, out)
    check_live_plan(case, transcript, out)
    check_refusals(case, transcript, out)
    check_drew(case, transcript, out)
    check_in_place(case, transcript, out)
    check_on_the_page(case, transcript, out)
    check_teaching(case, transcript, out)
    check_their_world(case, transcript, out)
    check_voice(transcript, out)
    return out
