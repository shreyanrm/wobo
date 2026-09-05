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


def _values_near(segment: str, about: "re.Pattern[str]", window: int) -> list[tuple[str, float]]:
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


def check_say_numbers(case: Any, transcript: Any, out: Scored) -> None:
    """The hole the number law does not cover, recorded on every run.

    The verified-number law is enforced on board OBJECTS. Wobo's spoken line is model-authored
    prose that goes through the safety screen and nothing else, so a number in it is a number no
    verifier ever signed. :func:`check_claims` is what actually catches a wrong one; this records
    how much unverified arithmetic is riding on the spoken line, so the report can show it.
    """
    said = re.findall(r"-?\d+(?:\.\d+)?", transcript.say)
    if said:
        out.add(
            NOTE,
            "verified",
            f"{len(said)} number(s) in the spoken line, which no verifier signs: "
            f"{', '.join(said[:8])}",
        )


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
    r"notice|that is why|which is why|in other words|comes from|works like|"
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


def check_teaching(case: Any, transcript: Any, out: Scored) -> None:
    """Explains rather than asserts, and hands the next move back.

    Both are laws already written into ``wobo.WOBO_SYSTEM`` and ``wobo.BOARD_SYSTEM``: a graduated
    hint that asks rather than tells, and an ``ask`` that hands the next move back. Neither had a
    test until this one.
    """
    text = transcript.everything_said()
    score = 4

    if not _EXPLAINS.search(text):
        out.add(
            WEAK,
            "teaches",
            "asserts without explaining: no causal or connecting language anywhere in the answer",
            transcript.say[:300],
        )
        score -= 2

    if case.expect_question:
        handed_back = bool(transcript.ask) or "?" in text
        if not handed_back:
            out.add(
                WEAK,
                "teaches",
                "never checks understanding: no question to the learner and no ask frame",
                transcript.say[:300],
            )
            score -= 2

    if case.expect_any:
        if not mentions(text, tuple(case.expect_any)):
            out.add(
                WEAK,
                "teaches",
                f"none of the ideas this question is about appear: {list(case.expect_any)}",
                transcript.say[:300],
            )
            score -= 1

    out.scores.setdefault("teaches", max(0, score))


def check_their_world(case: Any, transcript: Any, out: Scored) -> None:
    """"Reach for THEIR world for every example and analogy" — the persona law, tested."""
    if not case.world:
        out.scores["their world"] = None
        return
    text = transcript.everything_said()
    if mentions(text, (case.world, *case.expect_any)):
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


def check_voice(transcript: Any, out: Scored) -> None:
    text = transcript.everything_said()
    if not text.strip():
        out.scores["voice"] = None
        return
    score = 4

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
            ("correct", "verified", "drew", "teaches", "their world", "voice")
        )
        out.scores["reached"] = 0
        return out
    out.scores["reached"] = 4

    check_claims(case, transcript, out)
    check_forbidden(case, transcript, out)
    check_number_law(transcript, out)
    check_say_numbers(case, transcript, out)
    check_live_plan(case, transcript, out)
    check_refusals(case, transcript, out)
    check_drew(case, transcript, out)
    check_teaching(case, transcript, out)
    check_their_world(case, transcript, out)
    check_voice(transcript, out)
    return out
