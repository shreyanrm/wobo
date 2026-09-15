"""The say names what it draws.

THE FAILURE THIS CLOSES. ``docs/INK-FREEZE-PLAN-TRACE.md`` §3 has said it since the law was
written — *"The say names what it draws: never a label read back, never a pronoun with no mark
under it"* — and nothing enforced it. Wave 41's walk of the 59 turns measured the gap: the say
named what it drew on 3 of 12 live turns and on none of the keyless ones. The recorded plans say
why in one line each. A plant cell drew seven labelled parts, an outline and seven pointers under

    "Read the labels as they land, and say which one is missing."

A Punnett square drew a table, four genotypes and two counts under the same sentence. A ray diagram
drew an object, an image, a focal length and a magnification under

    "Watch what happens to each piece as it moves."

Every one of those lines is about the ACT of drawing. A learner who is listening rather than
looking gets nothing; a learner who is looking is told to read labels that the voice never says.
That is a caption for a picture, and the board is the opposite of a caption.

WHAT THIS DOES INSTEAD. It takes the say and the objects together, finds every drawn thing the
say does not name, and gives each one a sentence built from **the thing's own words** — the plan's
own ``words`` for a mark, the label's own text for a part of a figure, the number's own label and
value. It invents nothing: where a thing carries no words, there is nothing honest to say about it
and nothing is said. The sentences it writes are in the register (``docs/copy/voice.md`` 10a) and
never narrate (10c): they name the subject, they do not announce that Wobo is about to draw it.

WHAT COUNTS AS "DRAWN". Two things, and only two.

* **A mark** — a ring, an underline, an arrow, a note, a tick: Wobo pointing at something. A mark
  is the one object whose whole meaning is the thing it is about, so a mark nobody names is a
  finger pointing at nothing. Its subject is its ``words``, or the words of what it is anchored to.
  A pointer drawn from a label to the part it names carries neither, and asks for no sentence: it
  is the figure's own construction, drawn by the pen, spoken by the label at its end.
* **The parts a figure gives its own names** — a ``label``'s text, a ``number``'s label, a
  ``region``'s or a ``polygon``'s title. Not the working: reading "TT, Tt, Tt, tt" back at a
  learner is precisely the label read back that the law forbids, and not the construction strokes,
  which the figure's own name covers. Not the GROUND either — a shape the figure marks
  ``meta.ground``, such as the seven states the map of India draws Maharashtra among, is there so
  the subject has somewhere to be; it is spoken when a mark lands on it and never read out as an
  inventory (:func:`is_ground`).

THE TURN'S SHAPE. A sentence that goes in shifts every beat after it, on both spellings of a beat
(``beat`` and the glass planner's ``meta.beat``), so a mark still lands on the word that names it.
A mark that named no beat is spread across the whole utterance by ``stream._ink_clock``, so the
line AS A WHOLE is the sentence it is beaten to, and its naming goes on the end.

AND A MARK ON THE LEARNER'S OWN PAGE IS POINTED AT, NEVER READ AS A CLAIM. A photograph of an
exercise book is the one board Wobo did not draw. The mark is about a line the learner wrote, and
that line is what the mark is called (``doubt.DoubtShaper._about_the_line``), so the sentence it is
owed when nothing names it is the teacher's finger on the page — "This line, 3x = 20 + 5." — and
not the line read out as a statement ("3x = 20 + 5." asserts the very line the cross is on) and
not the model's tag ("Wrong sign.") spoken as prose. Wave 58 went further and exempted the page
mark from the law altogether, and the adversary measured what that costs: live at 390 the whole
caption was "Not quite. What is 20 - 5?" over a ring on one of six lines, and nothing said which.
:func:`sentence_for` is the one builder for the sentence any unnamed mark is owed.

AND NOTHING SPEAKS MACHINERY. Live on 2026-09-08 a fallback read ``{"path":"visualization",
"viz":{...`` out loud and printed it in the transcript. ``wobo.is_jsonish`` catches that on the
chat path; :func:`refuse_machinery` is the same law at the board, applied last, after everything
else has had its say — a line with a brace in it has never been something to read to a child.
"""

from __future__ import annotations

import copy
import json
import re
from typing import Any

#: A mark is about something. Its whole meaning is the thing it points at, so it must be named.
MARK_KINDS = frozenset(
    {"ring", "circle", "underline", "tick", "cross", "strike", "note", "arrow", "bracket", "point"}
)

#: How many sentences the naming pass may add. A plan is two to four sentences and at most ten
#: marks (INK-FREEZE §3, Plan); naming may not turn a turn into a monologue.
MAX_ADDED = 10

#: The most parts one sentence names before it stops being a sentence and becomes an inventory.
#: A figure with more than this many names is said in even mouthfuls, never truncated: the board
#: wrote every one of those labels, and a learner who cannot see them is owed all of them.
MAX_PARTS = 6

_SENTENCE_SPLIT = re.compile(r"(?<=[.?!])\s+")
_WORD = re.compile(r"[a-z0-9]+")

#: Words that carry no subject, so a sentence naming "the hypotenuse" also names "hypotenuse".
_STOPWORDS = frozenset(
    """a an the this that these those it its is are was were be am of on in to at by for from with
    and or but so then than there here what which who whose how why when we you your i my me our us
    do does did done has have had will would can could shall should may might must not no yes if as
    into over under about again just now one""".split()
)

#: Where a subject stops. "the hypotenuse, opposite the right angle" is about the hypotenuse.
_SUBJECT_TAIL = re.compile(
    r"\s*(?:,|;|:|\.|\bwhich\b|\bthat\b|\bbecause\b|\bso\b|\bwhere\b|\bwhen\b|\bis\b|\bare\b|\bwas\b)",
    re.IGNORECASE,
)

#: Wobo does; Wobo does not announce (voice.md 10c). A model that wrote its words as narration has
#: its narration taken off the front rather than its meaning thrown away.
_NARRATION = re.compile(
    r"^\s*(?:so\s+|now\s+|ok(?:ay)?,?\s+)?"
    r"(?:i(?:'ll| will| am going to| can| have)?\s+|let(?:'s| me)\s+|we(?:'ll| will)\s+|"
    r"here(?:'s| is| are)\s+|watch\s+(?:me\s+)?|notice\s+(?:how\s+)?(?:i\s+)?)"
    r"(?:just\s+|quickly\s+)?"
    r"(?:draw(?:n|ing)?|circl(?:e|ing)|ring(?:ing)?|mark(?:ing|ed)?|underlin(?:e|ing)|"
    r"point(?:ing)?\s+(?:at|to)|highlight(?:ing)?|show(?:ing)?|put(?:ting)?)\s+"
    r"(?:out\s+|up\s+)?",
    re.IGNORECASE,
)

#: The four sentence-enders a learner reads. An exclamation mark is never one of them (voice.md §3).
_TERMINALS = ".?"

#: Working, rather than words: an equals sign, a power (written either way — the board's caret or
#: the say's raised digit), or a number with an operator against it.
_EXPRESSION = re.compile(r"[=^⁰¹²³⁴⁵⁶⁷⁸⁹]|\d\s*[+*/]|[+*/]\s*\d")




#: A POWER IS THE SAME POWER IN BOTH HANDS. The board writes ``x^2`` — the handwriting layer
#: raises the caret as a superscript — and the say writes ``x²``, because a voice reading "x caret
#: 2" to a child is not reading mathematics. They are one line, and the pass that matches a mark
#: to the sentence naming it has to see them as one: until it did, the quadratic's given line was
#: quoted word for word in Wobo's own opening sentence and the ``write`` that drew it still kept
#: time with the ANSWER, three and a half seconds later (measured 2026-09-10).
_SUPERSCRIPTS = {c: f" {i}" for i, c in enumerate("⁰¹²³⁴⁵⁶⁷⁸⁹")}
_SUPERSCRIPT_RE = re.compile("[⁰¹²³⁴⁵⁶⁷⁸⁹]")


def words_in(text: str) -> list[str]:
    """The words and numbers of a line, however its powers are spelt.

    A raised digit is a word of its own, exactly as ``^2`` is: ``x²`` and ``x^2`` both read as
    "x", "2", so the two spellings of one line match.
    """
    body = _SUPERSCRIPT_RE.sub(lambda m: _SUPERSCRIPTS[m.group(0)], (text or "").lower())
    return _WORD.findall(body)


def flat(text: str) -> str:
    """The same sentence whatever the stream did to its spacing, case or punctuation."""
    return " ".join(words_in(text))


def split(say: str) -> list[str]:
    """Wobo's line, split the way Wobo speaks it."""
    return [s.strip() for s in _SENTENCE_SPLIT.split((say or "").strip()) if s.strip()]


def _content(text: str) -> list[str]:
    return [w for w in words_in(text) if w not in _STOPWORDS]


def names(sentence: str, subject: str) -> bool:
    """Does this sentence name that subject? Every content word of the subject has to be in it.

    Articles and pointing words do not count either way, so "Hypotenuse, then." names "the
    hypotenuse" and "opposite the right angle" does not.

    A LINE OF WORKING IS NAMED BY QUOTING IT. Its operators are its words: "3x = 20 - 5" carries
    every content word of "3x + 5 = 20" and is a different line, and live on 2026-09-15 that
    left the ring on the learner's given equation un-pointed at both widths. So a subject that
    is working is named when the sentence quotes it, or one side of it, in order
    (:func:`names_working`).
    """
    if _EXPRESSION.search(subject):
        return names_working(sentence, subject)
    wanted = _content(subject)
    if not wanted:
        return False
    have = set(_content(sentence))
    return all(w in have for w in wanted)


#: The tokens of a line of working: a symbol or a number, or one operator. A raised digit is a
#: caret and a digit, so both hands spell a power the same way.
_WORKING_TOKEN = re.compile(r"[a-z][a-z0-9]*|[0-9]+(?:\.[0-9]+)?|[=+\-−*/^×÷]")
_OPERATOR = frozenset("=+-−*/^×÷")


def _working_tokens(text: str) -> list[str]:
    body = _SUPERSCRIPT_RE.sub(
        lambda m: "^" + _SUPERSCRIPTS[m.group(0)].strip(), (text or "").lower()
    )
    return [t.replace("−", "-") for t in _WORKING_TOKEN.findall(body)]


def _quoted(have: list[str], want: list[str]) -> bool:
    """Is ``want`` in ``have`` contiguously, and not as the front of a longer expression?"""
    n = len(want)
    for i in range(len(have) - n + 1):
        if have[i : i + n] != want:
            continue
        before = have[i - 1] if i > 0 else ""
        after = have[i + n] if i + n < len(have) else ""
        if before not in _OPERATOR and after not in _OPERATOR:
            return True
    return False


def names_working(sentence: str, line: str) -> bool:
    """Does this sentence quote that line of working, whole or one side of it?

    A side has to be two tokens or more: "not 20 + 5" names "3x = 20 + 5", and the "20" in
    "What is 20 - 5?" names nothing.
    """
    want = _working_tokens(line)
    have = _working_tokens(sentence)
    if not want or not have:
        return False
    if _quoted(have, want):
        return True
    sides: list[list[str]] = [[]]
    for token in want:
        if token == "=":
            sides.append([])
        else:
            sides[-1].append(token)
    return any(len(side) >= 2 and _quoted(have, side) for side in sides)


# --- what a thing is called, in its own words -----------------------------------------------------


def _own_words(obj: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = obj.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _anchored_to(obj: dict[str, Any], by_id: dict[str, dict[str, Any]] | None) -> str:
    """The words of the thing this mark hangs off, one hop only.

    A bare board coordinate deliberately returns nothing: "at 660 by 210" is a fact about the paper
    and tells a learner nothing about the lesson.
    """
    anchor = obj.get("anchor")
    if not isinstance(anchor, dict):
        return ""
    if "object" in anchor and by_id:
        other = by_id.get(str(anchor["object"]))
        if isinstance(other, dict):
            return _own_words(other, "words", "text", "label", "title", "alt")
    # A ``target`` is deliberately not read: it is a glass id (a content hash plus an index), not
    # words, and reading "l ceilpw 0" to a learner is worse than saying nothing. A mark on the
    # glass carries ``words`` by grammar; one that does not has nothing honest to be called.
    return ""


def _subject_head(words: str) -> str:
    """The head of a phrase: what the mark is ABOUT, without the clause that explains it."""
    body = _NARRATION.sub("", (words or "").strip())
    cut = _SUBJECT_TAIL.search(body)
    head = body[: cut.start()] if cut and cut.start() > 0 else body
    return head.strip(" ,.;:")


def mark_subject(
    obj: dict[str, Any], by_id: dict[str, dict[str, Any]] | None = None
) -> str | None:
    """What this mark is about, in the mark's own words, or None when it names nothing.

    ``words`` is the plan's own phrase for the mark (INK-FREEZE §3: *a mark is ``{kind, target,
    words}``*), so it leads. Failing that, the thing the mark hangs off says what it is. Failing
    both, the mark has nothing a learner could be told, and the say owes it no sentence.
    """
    if obj.get("kind") not in MARK_KINDS:
        return None
    words = _own_words(obj, "words")
    # A LINE OF THE PAGE IS THE SUBJECT WHOLE. The tail cut below is for a phrase the model wrote
    # ("the hypotenuse, opposite the right angle" is about the hypotenuse); a line the learner
    # wrote is about all of itself. The same reading for any mark whose words are a line of
    # working: the client's instant mark reaches this pass without its ``meta`` (``stream``
    # rebuilds it), and "Solve: 3x + 5 = 20" cut at the colon was called "Solve".
    if on_a_line(obj) or _EXPRESSION.search(words):
        return line_subject(words) or None
    if on_the_page(obj) and not words:
        # The page's own construction between two marks — the doubt plan's arrow from its note
        # to its ring — carries no words, and the marks it joins are named already. The one-hop
        # anchor rule below is for a leader on Wobo's own figure; through a page mark it would
        # read the learner's line as "This is the find the perimeter of the rectangle.".
        return None
    head = _subject_head(words)
    if not head:
        head = _subject_head(_own_words(obj, "text", "label"))
    if not head:
        head = _subject_head(_anchored_to(obj, by_id))
    return head or None


def on_the_page(obj: dict[str, Any]) -> bool:
    """Is this mark on the LEARNER'S OWN PAGE, rather than on something Wobo drew?

    THE PAGE IS NOT WOBO'S TO READ BACK (the adversary, wave 57; docs/INK-FOUR.md, experience).
    On a board Wobo drew, a mark the say never names gets a sentence from the mark's own words:
    nobody but Wobo knows what that ring is around. On a photograph of the learner's exercise
    book the model writes a TAG on the mark — "Starting equation", "Wrong sign", "Correct first
    step" — and live at 390 on 2026-09-10 all three were spliced into the teaching line as though
    they were sentences. ``doubt.DoubtShaper._about_the_line`` gives the mark its line's own words
    instead and sets this flag; nothing else in the product does.

    AND THE LINE IS STILL OWED ITS SENTENCE (the adversary, wave 58, finding 1). Wave 58 read the
    flag as "owed no sentence", because the line is under the mark in the learner's own hand. A
    learner who is listening, or reading the caption, is not looking at the mark: live at 390 the
    whole caption was "Not quite. What is 20 - 5?" over a ring on one of six lines. So a page mark
    the say never names is pointed at, in :func:`pointed_at`'s form, and the flag decides the FORM
    of the sentence, never whether there is one.
    """
    meta = obj.get("meta")
    return isinstance(meta, dict) and meta.get("page") is True


def on_a_line(obj: dict[str, Any]) -> bool:
    """Is this a mark on the page that SITS ON A LINE of it, so its words are that line?

    ``doubt.DoubtShaper._about_the_line`` swaps the words for the line's text only for a mark
    anchored to a line by ``target``. An arrow between two marks is on the page too, but keeps
    the model's own words, and those are pointed at the way any mark's words are, never as a line.
    """
    anchor = obj.get("anchor")
    return on_the_page(obj) and isinstance(anchor, dict) and isinstance(anchor.get("target"), str)


#: A heading in front of the working on a line of the page: "Solve: ", "Step 2: ", "Q4: ".
_HEADING = re.compile(r"^[A-Za-z][A-Za-z0-9 .]{0,30}:\s*(?=\S)")
#: What a learner leaves at the end of their own line: the "?" of a doubt, a stray full stop.
_LEARNERS_TAIL = " ?.;:,"


def line_subject(words: str) -> str:
    """A line of the learner's page as the thing a mark on it is ABOUT.

    The learner's own doubt mark comes off the end ("3x = 20 + 5 ?" is about 3x = 20 + 5, and a
    "?" read out makes Wobo's sentence a question about the wrong line), and a heading comes off
    the front of working ("Solve: 3x + 5 = 20" is about the equation). Nothing else is touched:
    the line is theirs, and it is said as they wrote it.
    """
    body = re.sub(r"\s+", " ", (words or "").strip())
    if _EXPRESSION.search(body):
        body = _HEADING.sub("", body)
    return body.strip(_LEARNERS_TAIL)


def pointed_at(*lines: str) -> str:
    """The teacher's finger on a line of the learner's page: "This line, 3x = 20 + 5."

    Never the line as a statement — "3x = 20 + 5." over a cross asserts the very thing the cross
    denies — and never the model's tag as prose. A line of prose is pointed at in sentence case;
    a line of working keeps its case, because ``x`` and ``X`` are two symbols. Two lines pointed
    at in one breath are one sentence: "This line, 3x = 20 + 5, and this line, 3x + 5 = 20."
    """
    bodies: list[str] = []
    for line in lines:
        body = line_subject(line)
        if not body:
            continue
        if not _EXPRESSION.search(body):
            head = body.split(" ", 1)[0]
            if head[:1].isupper() and head[1:].islower():
                body = body[0].lower() + body[1:]
        bodies.append(f"this line, {body}")
    if not bodies:
        return ""
    said = bodies[0] if len(bodies) == 1 else ", ".join(bodies[:-1]) + ", and " + bodies[-1]
    return said[0].upper() + said[1:] + "."


def sentence_for(obj: dict[str, Any], by_id: dict[str, dict[str, Any]] | None = None) -> str:
    """The one sentence a mark is owed when nothing in the say names it.

    On the learner's page, the line pointed at (:func:`pointed_at`). On a board Wobo drew, the
    mark's own words: in register first (a model that narrated has its narration taken off), then
    as a thing said rather than a caption read out (:func:`as_a_sentence`), then terminated. One
    builder, so a mark the client laid and a mark the model planned are owed the same sentence.
    """
    if on_a_line(obj):
        return pointed_at(_own_words(obj, "words"))
    subject = mark_subject(obj, by_id)
    if subject is None:
        return ""
    return in_register(as_a_sentence(in_register(_own_words(obj, "words") or subject)))


def is_ground(obj: dict[str, Any]) -> bool:
    """Is this shape the GROUND the figure stands on, rather than a part of the figure?

    THE COUNTRY IS NOT AN INVENTORY (the adversary, wave 60). The map of India draws all eight
    bundled states so the one the question names has somewhere to be, and each carries its
    ``title`` because ``spoken.ts`` reads that title to a learner who asks what is on the board.
    :func:`part_name` read all eight as parts the figure names of itself, so the say ran through
    every one of them: "Rajasthan, gujarat, maharashtra, madhya pradesh. Uttar pradesh, karnataka,
    kerala, tamil nadu." over a board that writes ONE name.

    A figure says which of its shapes is ground, on the shape itself, exactly as the doubt shaper
    says which mark is on the learner's page (:func:`on_the_page`); nothing is inferred from the
    ink, because the pythagoras board's three squares are drawn faint and ARE the teaching. Ground
    is spoken when a mark lands on it — a ring on Gujarat still says Gujarat, through
    :func:`mark_subject` — and it keeps time with a sentence that names it (``_timing_name``). It
    is only never READ OUT as one of the figure's parts.
    """
    meta = obj.get("meta")
    return isinstance(meta, dict) and meta.get("ground") is True


def part_name(obj: dict[str, Any]) -> str | None:
    """The name a figure gives one of its own parts, or None when this object is not a part.

    A ``label`` is the figure naming a part of itself. A ``number`` with a label is a measured part
    with its measurement ("dominant 3"). A ``region`` or a ``polygon`` with a title is a named
    shape. Everything else on a from-scratch board — the working, the construction strokes, the
    pointers — is drawn, not named, and is covered by the parts it points at. Nor is the GROUND a
    figure stands on (:func:`is_ground`).
    """
    if is_ground(obj):
        return None
    kind = obj.get("kind")
    if kind == "label":
        return _sayable_name(_own_words(obj, "text"))
    if kind == "number":
        label = _sayable_name(_own_words(obj, "label"))
        if not label:
            return None
        value = obj.get("value")
        said = _amount(value, obj.get("precision"))
        unit = _own_words(obj, "unit")
        if said and said not in label:
            return f"{label} {said}{f' {unit}' if unit else ''}".strip()
        return label
    if kind in ("region", "polygon"):
        return _sayable_name(_own_words(obj, "title"))
    return None


#: A NAME IS A WORD, NOT A STROKE. The balance board writes a "+" between the reagents, and the
#: pass read it out as a sentence of its own: the whole spoken turn was "+. Each part goes on in
#: the order you'd draw it yourself." (the adversary, 2026-09-09, finding 3). An operator, an
#: arrow or a bare numeral is a mark the hand makes on the page; it carries no name a learner
#: could be told, so the say owes it nothing and stays silent about it.
_HAS_A_WORD = re.compile(r"[A-Za-z]")


def _sayable_name(text: str) -> str | None:
    return text if text and _HAS_A_WORD.search(text) else None


def _amount(value: Any, precision: Any) -> str:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return ""
    if isinstance(precision, int):
        return f"{value:.{precision}f}"
    return str(int(value)) if float(value).is_integer() else str(value)


# --- the words a figure that carries none gives itself -------------------------------------------

#: A power a learner reads as a power. Anything taller is left in the notation the ask used.
_POWERS = {"2": "²", "3": "³"}


def readable(expr: str) -> str:
    """``x**2`` as a learner writes it. Programming notation is not mathematics (finding 7)."""
    out = re.sub(r"\*\*(\d)", lambda m: _POWERS.get(m.group(1), f"^{m.group(1)}"), expr)
    return out.replace("*", "").strip()


def number(value: Any) -> str:
    """A number as a teacher writes it on a board: 3, not 3.0."""
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return str(value)
    return str(int(amount)) if amount.is_integer() else f"{amount:g}"


def _from_the_ask(ask: str, *values: Any) -> bool:
    """Is every one of these numbers in the learner's own question?

    ``board_intents`` fills in a sensible default domain when the ask names none, so a sentence
    written from the intent can carry a number nobody gave — "The number line, -5 to 5." over an
    ask that said only "show me a number line". The spoken-number law (``wobo_gateway.spoken``)
    rightly refuses that and the turn goes silent, which is worse than the generic line it
    replaced. So the clause is only written when the numbers in it are the learner's.
    """
    said = set(_NUMERAL_IN_ASK.findall(ask or ""))
    if not said:
        return False
    for value in values:
        forms = {number(value), str(value)}
        try:
            amount = float(value)
        except (TypeError, ValueError):
            return False
        forms.add(f"{amount:g}")
        if not (forms & said):
            return False
    return True


_NUMERAL_IN_ASK = re.compile(r"-?\d+(?:\.\d+)?")


def opening(intent: dict[str, Any], ask: str = "") -> str:
    """The first true sentence about a drawing whose own marks carry no words.

    Step 3 of docs/INK-FOUR.md: *the words come from the core, not from the wire*. Most figures
    name themselves — this file writes "Square on the base, square on the height" out of the marks
    — but a grid, an axis and a curve carry no words at all, so the graph, the number line, the
    circuit and the balanced equation are drawn in silence until something says what they are.
    Every number here came out of the learner's own question, which is the only place a number
    Wobo says is allowed to come from, and ``ask`` is how that is kept rather than asserted.

    IT LIVES HERE, NOT IN THE SCAFFOLD, BECAUSE THE KEYLESS TURN NEEDS IT TOO (the adversary, wave
    42, finding 8). It was written for the live two-phase turn, so live the graph said "The curve
    of y = x², from -3 to 3." and keyless the same turn said "Read it a piece at a time, and say
    which part looks off." — a line that names nothing it drew, on the path all 59 turns are
    judged on. One figure, one sentence, whoever is asking.
    """
    op = str(intent.get("op") or "")
    domain = intent.get("domain")
    bounds = domain if isinstance(domain, list) and len(domain) == 2 else None
    if op == "graph":
        expr = readable(str(intent.get("expr") or ""))
        if not expr:
            return ""
        if bounds and _from_the_ask(ask, *bounds):
            return f"The curve of y = {expr}, from {number(bounds[0])} to {number(bounds[1])}."
        return f"The curve of y = {expr}."
    if op == "number_line":
        if bounds and _from_the_ask(ask, *bounds):
            return f"The number line, {number(bounds[0])} to {number(bounds[1])}."
        return "The number line."
    if op == "circuit":
        arrangement = str(intent.get("arrangement") or "series")
        emf = intent.get("emf")
        return (
            f"A {arrangement} circuit, {number(emf)} volts."
            if emf and _from_the_ask(ask, emf)
            else f"A {arrangement} circuit."
        )
    if op == "balance":
        left = " + ".join(str(f) for f in (intent.get("reactants") or []) if f)
        right = " + ".join(str(f) for f in (intent.get("products") or []) if f)
        if left and right:
            return f"{left} to {right}, counted on both sides."
        return ""
    if op == "map":
        # A MAP MAKES ITS OWN SENTENCE, OR IT BORROWS A DIAGRAM'S (the adversary, wave 60). With
        # nothing here the map fell through to the bio_social family's line — "Read the labels as
        # they land, and say which one is missing." — over a board that writes exactly one label,
        # keyless and live. The true thing to say about this drawing is the state the question
        # named and the country it is drawn among; the other states are the ground it stands on
        # (``pipelines.bio_social._map``), and a ground read out is an inventory, not a lesson.
        from wobo_gateway.plexus.maps import region_name

        # The bundle's own name or nothing: "madhya-pradesh, with the states around it." would be
        # the catalog's id spoken aloud, which is the slug law broken in the voice instead of on
        # the glass. A map whose region the bundle does not hold is refused before it is drawn.
        named = region_name(str(intent.get("mark") or "").strip().lower())
        if named:
            return f"{named}, with the states around it."
        if intent.get("values"):
            return "The states, shaded by the numbers on them."
        return ""
    if op == "derivation":
        # THE GIVEN, AS THE LEARNER WROTE IT. A derivation's own marks are ``write`` objects, and
        # the naming pass deliberately does not read working back (that is the label read back the
        # law forbids), so the board opened on the family's line — "Read it a piece at a time" —
        # which names nothing it drew. The line it starts FROM is the one true thing to say about
        # it, and every numeral in it is the learner's own or it is not said.
        equation = readable(str(intent.get("equation") or ""))
        numbers = _NUMERAL_IN_ASK.findall(equation)
        if not equation or not _from_the_ask(ask, *numbers):
            return ""
        return f"{equation}, line by line."
    return ""


# --- the register --------------------------------------------------------------------------------


#: THE CARET IS THE BOARD'S, NOT THE VOICE'S. ``pretty_algebra`` leaves ``x^2`` in a ``write``
#: because the handwriting layer raises the caret as a real superscript. The SAY is read out loud
#: and printed in the transcript, and "x caret 2" is not how anybody says x squared: live at 1440
#: the quadratic's second sentence was "x^2 + bx/a + c/a = 0." (measured 2026-09-10). One line,
#: two hands, each spelling it the way its own reader reads it.
_SAID_POWER = re.compile(r"\^(\d)")


def in_register(words: str) -> str:
    """One sentence, in Wobo's voice, from words a thing carries about itself.

    Never narration (voice.md 10c): "I'll circle the hypotenuse" becomes "The hypotenuse". No em
    dash and no exclamation mark, because a learner reads this (voice.md §3, 10a). Sentence case,
    a capital at the front and a full stop at the back, because it is a sentence.
    """
    body = _NARRATION.sub("", (words or "").strip())
    body = _SAID_POWER.sub(lambda m: _POWERS.get(m.group(1), m.group(0)), body)
    body = body.replace("—", ",").replace("–", ",").replace("!", ".")
    body = re.sub(r"\s*,\s*,+", ",", body).strip(" ,;:")
    body = re.sub(r"\s+", " ", body)
    if not body:
        return ""
    # A LINE OF ALGEBRA IS NOT A SENTENCE TO SENTENCE-CASE. `x` and `X` are two different symbols,
    # so capitalising the front of the working changed what the board was claiming: the live
    # quadratic said "X^2 + bx/a + c/a = 0." and the derivation said "X = 2." (the adversary,
    # 2026-09-09, finding 3). Working keeps the case the pipeline computed it in.
    if not _EXPRESSION.search(body):
        body = body[0].upper() + body[1:]
    return body if body[-1] in _TERMINALS else f"{body}."


#: A word that makes the words a CLAUSE — something Wobo can say as it is. Without one, the words
#: are a label: the caption a teacher writes beside their ink, not a thing they say out loud.
#: Only the forms that can ONLY be a verb here: the copulas, the auxiliaries, and third-person
#: singular endings. The bare forms are left out on purpose — "the sign flip", "the step count",
#: "the end point" and "the cross section" are all labels, and a verb list that claimed them would
#: read a noun phrase as a clause and leave it read out as a caption.
_FINITE_VERB = re.compile(
    r"\b(?:is|are|was|were|be|been|being|am|has|have|had|does|did|can|could|will|would|shall|"
    r"should|must|may|might|means|gives|shows|makes|keeps|holds|leaves|moves|goes|comes|stays|"
    r"adds|cancels|equals|becomes|needs|takes|turns|starts|ends|flips|swaps|drops|falls|rises|"
    r"points|counts|carries|sits|lands|runs|works|happens|changes|grows|splits|joins|meets|"
    r"crosses|divides|multiplies)\b",
    re.IGNORECASE,
)
#: The longest run of words still read as a label rather than as a line of its own.
_LABEL_WORDS = 6
_HAS_ARTICLE = ("the ", "a ", "an ", "this ", "that ", "these ", "those ", "your ", "my ", "its ")

#: A BARE VERB AT THE HEAD OF A LABEL THAT IS A THING TO DO. Every card in this product is titled
#: with an instruction — "predict, then check", "feel the rule", "make a move", "meet a new
#: course" — and an instruction takes no article. Only the bare forms are here, and only the
#: FIRST word is read against them, because "the sign flip", "the step count" and "the end point"
#: are things, not commands, and a verb list that claimed them would stop articling a noun.
_INSTRUCTION_HEAD = re.compile(
    r"^(?:predict|check|feel|make|meet|find|solve|try|draw|write|read|watch|listen|explain|"
    r"compare|choose|pick|name|spot|measure|match|sort|fill|complete|review|practise|practice|"
    r"apply|describe|calculate|estimate|arrange|identify|prove|show|tell|notice|imagine|decide|"
    r"simplify|expand|factorise|factorize|subtract|multiply|divide|connect|trace)\b",
    re.IGNORECASE,
)
#: The next instruction in a sequence: "predict, THEN check".
_AND_THEN = re.compile(r"\bthen\b", re.IGNORECASE)
#: The word a command acts on, right after the verb: "feel THE rule", "make A move".
_ACTED_ON = ("a", "an", "the")


def _an_instruction(body: str) -> bool:
    """Is this label a thing to DO rather than a thing to point at?

    A head verb ALONE decides nothing: "check" and "move" and "plan" are all nouns as readily as
    verbs, and "this is the check" is the right sentence about a tick. What makes the phrase a
    command is what follows the verb — the thing it acts on ("feel the rule", "make a move") or
    the next instruction in the sequence ("predict, then check").
    """
    words = body.split()
    if len(words) < 2 or not _INSTRUCTION_HEAD.match(words[0]):
        return False
    return words[1].lower() in _ACTED_ON or bool(_AND_THEN.search(body))


def _plural(label: str) -> bool:
    """Is the thing this label names more than one? "The numbered steps" are, "the axis" is not."""
    last = label.split()[-1].lower() if label.split() else ""
    return last.endswith("s") and not last.endswith(("ss", "us", "is", "as", "os"))


def as_a_sentence(words: str) -> str:
    """A mark's words as something SAID, not as a caption read out (the adversary, wave 47, finding 7).

    Live at 390 the doubt caption carried "Starting equation.", "Wrong sign." and "Correct first
    step." in the middle of the teaching — the marks' own labels, spoken as if they were sentences.
    The law that puts them there is right: nothing stands on the glass unspoken. What was wrong is
    the grammar. A teacher pointing at their ink says "this is the wrong sign"; they do not read
    the caption out.

    Words that already say something are left exactly as they are, and so is a line of working: a
    mark on ``3x = 20 - 5`` is read, not pointed at.
    """
    body = (words or "").strip().strip(" .;:,")
    if not body:
        return ""
    if _EXPRESSION.search(body) or _FINITE_VERB.search(body):
        return body
    if len(body.split()) > _LABEL_WORDS:
        return body
    head = body.split(" ", 1)[0]
    # "TT" and "DNA" keep their case; an ordinary capital at the front of a label does not, because
    # it is going into the middle of a sentence now.
    if head[:1].isupper() and head[1:].islower():
        body = body[0].lower() + body[1:]
    # AN INSTRUCTION TAKES NO ARTICLE, and this is the form Wobo already says it in: keyless at
    # 390 on the "predict, then check" card, ``glass.absent_line`` answers "There's no effect
    # circle on this card. This one is predict, then check." The same card ringed by the client's
    # instant pen was owed a sentence here, and got "This is the predict, then check."
    if _an_instruction(body):
        return f"This one is {body}"
    if not body.lower().startswith(_HAS_ARTICLE):
        body = f"the {body}"
    return f"These are {body}" if _plural(body) else f"This is {body}"


def narrates(text: str) -> bool:
    """Does this line announce what Wobo is about to do, instead of doing it (voice.md 10c)?

    :func:`in_register` takes narration OFF a line it is building. A line already written and
    stored has to be REFUSED instead: rewriting it at serve time would hand a learner a sentence
    no judge ever saw. So the same pattern is asked as a question here.
    """
    return bool(_NARRATION.match((text or "").strip()))


#: A spoken line is prose. Anything with a brace or an envelope key in it is machinery.
_JSONISH = re.compile(r'[{}]|"\s*(say|path|viz|actions|kind|concept|intent|objects)\s*"\s*:')


def refuse_machinery(say: str) -> str:
    """The line, or nothing at all when it is machinery rather than words.

    Live on 2026-09-08 the spoken fallback for "Prove Pythagoras theorem" was
    ``{"path":"visualization", "viz":{"kind":"diagram"...``: the voice read it out and the
    transcript printed it. Any line that carries a brace, a bracket or an envelope key is refused,
    whatever produced it, and the turn goes on with what it can honestly say.
    """
    body = (say or "").strip()
    if not body:
        return ""
    if _JSONISH.search(body):
        return ""
    try:
        parsed = json.loads(body)
    except (ValueError, TypeError):
        return body
    # A bare numeral is an answer ("32"); anything else that parses is a fragment of an envelope.
    return body if isinstance(parsed, (int, float)) and not isinstance(parsed, bool) else ""


def already_asked(say: str, prompt: str) -> bool:
    """Is this question already one of the sentences said? Then the ask frame does not say it again.

    A plan's last sentence usually IS its question, and the ask frame names it a second time so the
    wire can pause the turn on it. Printed as it arrives, every turn with a question said it twice
    (the lab, 2026-09-08, finding 12).
    """
    wanted = flat(prompt)
    return bool(wanted) and any(flat(part) == wanted for part in split(say))


# --- the pass ---------------------------------------------------------------------------------------


def _beat_of(obj: dict[str, Any]) -> int | None:
    for holder in (obj, obj.get("meta") if isinstance(obj.get("meta"), dict) else {}):
        beat = holder.get("beat") if isinstance(holder, dict) else None
        if isinstance(beat, dict) and isinstance(beat.get("with"), int):
            return max(0, int(beat["with"]))
    return None


def _beat_dict(obj: dict[str, Any]) -> dict[str, Any] | None:
    """The beat as it is written on this object, wherever it is written — ``with`` or ``after``."""
    for holder in (obj, obj.get("meta") if isinstance(obj.get("meta"), dict) else {}):
        beat = holder.get("beat") if isinstance(holder, dict) else None
        if not isinstance(beat, dict):
            continue
        for key in ("with", "after"):
            if isinstance(beat.get(key), int) and not isinstance(beat.get(key), bool):
                return beat
    return None


def chosen(obj: dict[str, Any]) -> bool:
    """Was this beat CHOSEN — by the plan, or by the glass planner — rather than derived?

    The same reading as ``stream._authored``: a beat this file worked out carries ``words``, so a
    beat without it is choreography somebody meant, and neither pass may overrule it.
    """
    beat = _beat_dict(obj)
    return beat is not None and not isinstance(beat.get("words"), int)


def _place_of(obj: dict[str, Any]) -> tuple[int, int] | None:
    """``(sentence, word)`` this object keeps time with, or None when it keeps time with none.

    The word is the ordering INSIDE a sentence, so two marks of one sentence are still ordered
    against each other; a beat that names no word counts as the first word of its sentence.
    """
    beat = _beat_dict(obj)
    if beat is None:
        return None
    where = beat.get("with")
    if not isinstance(where, int) or isinstance(where, bool):
        where = beat.get("after")
    if not isinstance(where, int) or isinstance(where, bool):
        return None
    word = beat.get("word")
    return max(0, int(where)), int(word) if isinstance(word, int) else 0


def anchor_ids(obj: dict[str, Any]) -> list[str]:
    """The ids of the board objects this one hangs off — its anchor, and an arrow's two ends."""
    out: list[str] = []
    for field_name in ("anchor", "to", "from"):
        anchor = obj.get(field_name)
        if isinstance(anchor, dict) and isinstance(anchor.get("object"), str):
            out.append(anchor["object"])
    return out


def _set_place(obj: dict[str, Any], place: tuple[int, int], words: int) -> None:
    """Write a derived beat. Derived, not authored: it carries ``words``, which is how
    ``stream._authored`` tells a beat somebody CHOSE from one this pass worked out."""
    beat: dict[str, Any] = {"with": place[0], "word": max(0, place[1]), "words": max(1, words)}
    existing = _beat_dict(obj)
    if existing is not None:
        existing.clear()
        existing.update(beat)
        return
    meta = obj.get("meta")
    if not isinstance(meta, dict):
        meta = {}
        obj["meta"] = meta
    meta["beat"] = beat


#: EVERY DRAWN THING KEEPS TIME WITH A SENTENCE, AND A THING IS BEATEN BEFORE WHAT HANGS OFF IT
#: (the adversary, wave 42, findings (a) and (b); measured live at 390 and 1440).
#:
#: The beat is not a hint to the stream's clock — it is the CLIENT's clock.
#: ``apps/web-pwa/src/wobo/beat.ts`` holds every ink frame until the voice reaches the sentence the
#: beat names, and a frame with NO beat falls back to ``planned - 1``: the last sentence queued so
#: far, which on a fast wire is the last sentence of the whole turn. So on the plant cell the five
#: labels (named by sentence 0) were released at 4 538 ms and the leaders they hang off (unbeaten,
#: and therefore sentence 1) at 10 323 ms. A label drawn five seconds before its own leader
#: resolves its anchor box to null, and ``renderer.tsx`` caches that emptiness under a signature
#: that can never change: the mark is lost for good, not merely late. Three of five labels, and
#: two arrows pointing at nothing.
#:
#: The fix is one invariant, kept here because this is the only place a turn's words and its ink
#: are both in hand: **nothing reaches the wire without a beat, and the thing a mark hangs off is
#: beaten no later than the mark.** A construction stroke rides with the label it leads to; the
#: pen's own order settles the rest.
def settle_beats(said: str, objects: list[dict[str, Any]]) -> None:
    """Give every object a beat, with anchors never later than what hangs off them. In place."""
    parts = split(said)
    if not parts or not objects:
        return
    lengths = [max(1, len(words_in(part))) for part in parts]
    places: list[tuple[int, int] | None] = [_place_of(o) for o in objects]
    if all(place is None for place in places):
        return
    index_of = {str(o.get("id")): i for i, o in enumerate(objects) if o.get("id")}

    # 1. BACKWARDS ALONG THE ANCHORS, taking the earliest. A stroke that several marks hang off
    #    is drawn before the first of them, never before the last. Relaxed to a fixed point
    #    because a plan may anchor forwards as well as back.
    for _ in range(len(objects)):
        moved = False
        for i, obj in enumerate(objects):
            mine = places[i]
            if mine is None:
                continue
            for other in anchor_ids(obj):
                j = index_of.get(other)
                if j is None or j == i:
                    continue
                if places[j] is None or places[j] > mine:
                    places[j] = mine
                    moved = True
        if not moved:
            break

    # 2. WHAT IS STILL FREE RIDES WITH WHAT COMES NEXT. A stroke nothing names and nothing hangs
    #    off belongs with the mark the pen reaches after it — the timeline's rule before its first
    #    tick — and, when nothing follows, with the last thing that was named.
    later: tuple[int, int] | None = None
    for i in range(len(objects) - 1, -1, -1):
        if places[i] is None:
            places[i] = later
        elif later is None or places[i] < later:
            later = places[i]
    earlier: tuple[int, int] | None = None
    for i, place in enumerate(places):
        if place is None:
            places[i] = earlier
        else:
            earlier = place

    # 3. AND THE INVARIANT, ENFORCED RATHER THAN HOPED FOR. Filling the free ink from what comes
    #    NEXT can hand a mark a beat earlier than the stroke it hangs off, so every dependent is
    #    raised to its anchor, to a fixed point. This is the one rule the wire may not break.
    for _ in range(len(objects) + 1):
        moved = False
        for i, obj in enumerate(objects):
            for other in anchor_ids(obj):
                j = index_of.get(other)
                if j is None or j == i or places[j] is None:
                    continue
                if places[i] is None or places[i] < places[j]:
                    places[i] = places[j]
                    moved = True
        if not moved:
            break

    for obj, place in zip(objects, places, strict=True):
        # A BEAT SOMEBODY CHOSE IS NEVER REWRITTEN. `{"with": n}`, `{"after": n}` and `lag` are
        # choreography a plan meant; this pass reads them to order the free ink around them and
        # leaves them exactly as written.
        if place is None or chosen(obj):
            continue
        sentence = max(0, min(place[0], len(parts) - 1))
        _set_place(obj, (sentence, place[1]), lengths[sentence])


def _rebeat(obj: dict[str, Any], to: int) -> None:
    """Move this object's beat to sentence ``to``, on whichever spelling it is written in.

    ``{"after": n}`` is a beat somebody chose as much as ``{"with": n}`` is, and a sentence going
    in ahead of it moves the sentence it names just the same: the doubt plan's ``write`` was
    beaten ``after`` the teaching sentence and, once the pointing sentence went in before it,
    kept time with the pointing sentence instead.
    """
    for holder in (obj, obj.get("meta") if isinstance(obj.get("meta"), dict) else None):
        if not isinstance(holder, dict):
            continue
        beat = holder.get("beat")
        if not isinstance(beat, dict):
            continue
        for key in ("with", "after"):
            if isinstance(beat.get(key), int) and not isinstance(beat.get(key), bool):
                beat[key] = to
                return


#: A NAME IS A PLACE IN A SENTENCE, NOT ONLY A SENTENCE (the adversary, 2026-09-09, finding 5).
#: A from-scratch board carries no beats at all — the pipelines compute geometry, not choreography
#: — so every one of its objects was "unbeaten", and ``stream._ink_clock`` spread the unbeaten
#: evenly from the lead-in to Wobo's LAST full stop. Pythagoras came out at 120, 1184, 2249 ...
#: 9700 ms with a 1064 ms stroke each: a slideshow that outlived the words, with the square on the
#: longest side drawn 700 ms after the sentence that named it had ended.
#:
#: This pass is the one place a turn's words and its ink are both in hand, so it is where the beat
#: is set: every drawn thing whose name is in a sentence keeps time with THAT sentence, and with
#: the word inside it. ``word``/``words`` are a position in the sentence, not a duration, because
#: the speaking pace lives in ``board.stream`` and nowhere else.
def _word_place(sentence: str, name: str, after: int = 0) -> tuple[int, int] | None:
    """``(word index, word count)`` where this name starts in that sentence, at or after ``after``.

    A sentence that names several parts repeats their shared words — "square on the base, square
    on the height, square on the longest side" says "square" three times — so a search that stops
    at the first head word puts all three squares on the same syllable. ``after`` is the caller's
    reading cursor: each name is found past the one before it, which is the order the sentence
    says them in and the order the pen draws them.
    """
    words = words_in(sentence)
    wanted = _content(name)
    if not words or not wanted:
        return None
    for index in range(max(0, after), len(words)):
        if words[index] != wanted[0]:
            continue
        cursor = index + 1
        for word in wanted[1:]:
            while cursor < len(words) and words[cursor] != word:
                cursor += 1
            if cursor >= len(words):
                break
            cursor += 1
        else:
            return index, len(words)
    return (after, len(words)) if after < len(words) else (0, len(words))


#: A NAME FOR KEEPING TIME IS NOT A NAME TO SAY. ``part_name`` deliberately refuses to read
#: working back to a learner — "TT, Tt, Tt, tt" is the label read back the law forbids — but when
#: the say ALREADY carries that line, the mark that writes it has to keep time with it. The
#: derivation's given was the case: the say opens on "x² + 5x + 6 = 0, line by line." and the
#: ``write`` that draws it was left free, inherited the sentence of the ANSWER, and the board sat
#: on one line for 3.7 s (measured 2026-09-10). This is used for the beat and never for the say.
def _timing_name(obj: dict[str, Any]) -> str | None:
    return _sayable_name(_own_words(obj, "text", "tex", "label", "title"))


def keep_time(said: str, objects: list[dict[str, Any]]) -> None:
    """Beat every drawn thing to the sentence that names it. In place, on the objects given.

    An object that already carries a beat keeps it: the plan and the glass planner choreograph
    their own marks, and this pass never overrules them. Everything else — the whole of a
    from-scratch board — is beaten here or stays free, and free ink is what
    ``stream._ink_clock`` fills the gaps with.
    """
    parts = split(said)
    if not parts:
        return
    by_id = {str(o.get("id")): o for o in objects if isinstance(o, dict) and o.get("id")}
    read: dict[int, int] = {}
    for obj in objects:
        if not isinstance(obj, dict) or _beat_of(obj) is not None:
            continue
        name = part_name(obj) or mark_subject(obj, by_id) or _timing_name(obj)
        if not name:
            continue
        where = next((i for i, part in enumerate(parts) if names(part, name)), None)
        if where is None:
            continue
        place = _word_place(parts[where], name, read.get(where, 0))
        if place is not None:
            read[where] = place[0] + 1
        beat: dict[str, Any] = {"with": where}
        if place is not None:
            beat["word"], beat["words"] = place
        # Under ``meta``, which is where the grammar keeps a beat (``board.schema._COMMON``) and
        # where ``stream._beat_slot`` reads one.
        meta = obj.get("meta")
        if not isinstance(meta, dict):
            meta = {}
            obj["meta"] = meta
        meta["beat"] = beat
    # Nothing reaches the wire without a sentence to keep time with, and nothing is beaten before
    # the thing it hangs off (:func:`settle_beats`).
    settle_beats(said, [o for o in objects if isinstance(o, dict)])


def unnamed(say: str, objects: list[dict[str, Any]]) -> list[str]:
    """Everything drawn that the say never names, in drawing order. Empty is the law kept.

    A beaten mark is judged against the one sentence it is beaten to; an unbeaten one, and every
    part of a figure, against the whole line, because unbeaten ink is spread across the whole
    utterance (``stream._ink_clock``).
    """
    parts = split(say)
    by_id = {str(o.get("id")): o for o in objects if isinstance(o, dict) and o.get("id")}
    out: list[str] = []
    for obj in objects:
        if not isinstance(obj, dict):
            continue
        subject = mark_subject(obj, by_id)
        if subject is not None:
            beat = _beat_of(obj)
            where = parts[beat] if beat is not None and beat < len(parts) else say
            if names(where, subject):
                continue
            # A page mark keeps the beat the shaper chose and is named by whichever sentence
            # names its line (:func:`name_what_is_drawn`); its ink holds for the whole turn.
            if on_the_page(obj) and any(names(part, subject) for part in parts):
                continue
            out.append(subject)
            continue
        name = part_name(obj)
        if name and not names(say, name):
            out.append(name)
    return out


#: NOTHING IS SPOKEN THAT WAS NOT DRAWN (INK-FOUR, correctness at 4; the adversary, wave 42,
#: finding (b)). The say and the ledger were both built from the PLAN, and nothing reconciled them
#: against what actually went out: a plan whose ring was refused kept the sentence that named it,
#: so a learner heard "The hypotenuse" over a board with no hypotenuse marked on it. This is the
#: say's half of the reconciliation — the ledger's half is in ``stream.build_events``.
def only_what_is_drawn(
    say: str, drawn: list[dict[str, Any]], missing: list[dict[str, Any]]
) -> tuple[str, tuple[int, ...]]:
    """The line with every sentence about a mark that never reached the wire taken out.

    A sentence goes only when it is ABOUT something that is not there: it names a missing mark and
    names nothing that IS on the board. A sentence that teaches, or that names both, is kept —
    the law is against speaking what was not drawn, not against speaking at all.

    Returns the line and the indices of the sentences that went, so the beats choreographed to
    later sentences can be moved up with them.
    """
    parts = split(say)
    if not parts or not missing:
        return say, ()
    by_id = {str(o.get("id")): o for o in [*drawn, *missing] if o.get("id")}
    # A MARK ON THE LEARNER'S PAGE THAT WAS REFUSED LEAVES THE LINE WHERE IT WAS. The sentence
    # about that line is about something the learner is looking at, in their own hand; only a
    # mark on a board Wobo drew takes its subject off the glass with it.
    gone = [n for n in (_own_name(o, by_id) for o in missing if not on_the_page(o)) if n]
    if not gone:
        return say, ()
    here = [n for n in (_own_name(o, by_id) for o in drawn) if n]
    kept: list[str] = []
    dropped: list[int] = []
    for index, part in enumerate(parts):
        if any(names(part, n) for n in gone) and not any(names(part, n) for n in here):
            dropped.append(index)
            continue
        kept.append(part)
    return " ".join(kept), tuple(dropped)


def _own_name(obj: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> str | None:
    return part_name(obj) or mark_subject(obj, by_id)


def rebeat_after_dropping(
    objects: list[dict[str, Any]], dropped: tuple[int, ...], total: int
) -> None:
    """Move every beat that named a later sentence up by the sentences taken out before it.

    The same rule ``spoken.reanchor`` keeps when the spoken-number law drops a sentence: a beat on
    a sentence that went lands on the sentence that took its place, so no mark is left keeping
    time with silence.
    """
    if not dropped:
        return
    remaining = max(0, total - len(dropped))
    for obj in objects:
        beat = _beat_dict(obj) if isinstance(obj, dict) else None
        if beat is None:
            continue
        for key in ("with", "after"):
            index = beat.get(key)
            if not isinstance(index, int) or isinstance(index, bool):
                continue
            shift = sum(1 for d in dropped if d < index)
            beat[key] = max(0, min(max(remaining - 1, 0), index - shift))


def _chunks(items: list[str], size: int) -> list[list[str]]:
    """Split a run of names into even mouthfuls. Nine parts read as five and four, never eight and
    a one-word sentence on its own."""
    if not items:
        return []
    groups = (len(items) + size - 1) // size
    per = (len(items) + groups - 1) // groups
    return [items[i : i + per] for i in range(0, len(items), per)]


def name_what_is_drawn(
    say: str,
    objects: list[dict[str, Any]],
    *,
    ask: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """The say, naming every mark it draws, and the objects re-beaten to the sentences that name them.

    Additive by construction: a sentence the plan wrote is never rewritten, only followed. The
    objects come back as copies, so a caller that hands in a cached plan gets its plan back intact.
    The order of the two passes is the whole of the second bug the real screen found: the figure's
    parts are named FIRST, and a mark is only owed a sentence of its own if that naming did not
    already give it one, or a pointer into a labelled diagram earned a second "Plant cell." after
    the sentence that had just said it.
    """
    kept = refuse_machinery(say)
    parts = split(kept)
    drawn = [copy.deepcopy(o) for o in objects if isinstance(o, dict)]
    by_id = {str(o.get("id")): o for o in drawn if o.get("id")}

    # Where the question lives, if the plan ended on one. Naming goes in FRONT of the question: a
    # turn hands the next move back on its last sentence, and nothing follows that.
    question = len(parts) - 1 if (ask and parts and flat(parts[-1]) == flat(ask)) else len(parts)

    # 1. The figure's own parts, in the order the pen writes them, in mouthfuls a person could say:
    #    a teacher labelling a diagram out loud, not a caption and not an inventory. Every name the
    #    board writes is said, because a learner who is listening rather than looking is owed the
    #    same labels as one who is looking (the argument spoken.ts settled for the screen reader).
    seen: list[str] = []
    seen_all: list[str] = []
    for obj in drawn:
        name = part_name(obj) or mark_subject(obj, by_id)
        if name and name not in seen_all:
            seen_all.append(name)
        name = part_name(obj)
        if name and name not in seen and not names(kept, name):
            seen.append(name)
    lead = [in_register(", ".join(group)) for group in _chunks(seen, MAX_PARTS)]
    so_far = " ".join([kept, *lead]).strip()

    # 2. A sentence for every mark that sentence still does not name, from the mark's own words.
    #    A beaten mark is judged against the ONE sentence it keeps time with; an unbeaten one is
    #    spread across the whole utterance, so the whole line is what has to name it.
    # ONE SUBJECT IS ONE SENTENCE, HOWEVER MANY MARKS POINT AT IT. Two marks that carry the same
    # words used to earn one sentence each, so live at 390 "which step is wrong here?" said "...
    # The numbered steps. The numbered steps. Which numbered step..." (the adversary, 2026-09-09,
    # finding 3). The second mark is not owed a sentence; it is owed the SAME sentence, and the
    # rebeat below puts it there, because a mark keeps time with the words that name it.
    added: dict[int, list[str]] = {}
    #: The lines of the learner's page pointed at, by the sentence they follow: one sentence per
    #: place, however many lines (:func:`pointed_at`). The placeholder in ``added`` keeps its
    #: turn in the order the marks were met, and is filled once every mark has been read.
    pointed: dict[int, list[str]] = {}
    marks: list[tuple[dict[str, Any], int, str]] = []
    written: set[str] = {flat(line) for line in lead}
    for obj in drawn:
        subject = mark_subject(obj, by_id)
        if subject is None:
            continue
        beat = _beat_of(obj)
        where = parts[beat] if beat is not None and beat < len(parts) else so_far
        if names(where, subject):
            continue
        # A MARK ON THE LEARNER'S PAGE IS NAMED BY ANY SENTENCE THAT NAMES ITS LINE. Its ink
        # holds on the page for the whole turn, and the shaper spreads unbeaten marks evenly
        # across the sentences (``doubt.DoubtShaper.shape_plan``), so the cross on "P = 8 + 3 =
        # 11 cm" keeps time with the opening sentence while the SECOND sentence is the one that
        # teaches about it. Pointing at the line one breath before the sentence that names it
        # is the splice again. The pointing sentence is owed only when no sentence names it.
        if on_the_page(obj) and any(names(part, subject) for part in split(so_far)):
            continue
        at = beat if beat is not None and beat < question else question - 1
        at = max(at, -1)
        if on_a_line(obj):
            # A page mark keeps the beat it was given and is never re-beaten here: a beaten one
            # holds the shaper's choreography, an unbeaten one is beaten by :func:`keep_time`
            # to the pointing sentence, the only sentence that names it.
            key = flat(line_subject(_own_words(obj, "words")))
            if not key or key in written or len(written) - len(lead) >= MAX_ADDED:
                continue
            written.add(key)
            if at not in pointed:
                pointed[at] = []
                added.setdefault(at, []).append("")
            pointed[at].append(_own_words(obj, "words"))
            continue
        sentence = sentence_for(obj, by_id)
        if not sentence:
            continue
        key = flat(sentence)
        if key in written:
            marks.append((obj, at, sentence))
            continue
        if len(written) - len(lead) >= MAX_ADDED:
            continue
        written.add(key)
        added.setdefault(at, []).append(sentence)
        marks.append((obj, at, sentence))
    for at, lines in pointed.items():
        added[at][added[at].index("")] = pointed_at(*lines)

    if not lead and not added:
        keep_time(kept, drawn)
        return kept, drawn

    # WHERE THE PARTS GO: AFTER THE FIGURE HAS BEEN NAMED (measured on a real screen at 1440,
    # 2026-09-09). The lead used to open the line unconditionally, so the plant cell said "Cell
    # wall, cell membrane, nucleus, chloroplast, vacuole." and only then "A plant cell, part by
    # part." — the parts named before the thing they are parts OF. Once each mark keeps time with
    # the sentence naming it (:func:`keep_time`), that order is not only odd to listen to, it is
    # impossible to draw: every label was streamed ahead of the leader it hangs off and the
    # outline it sits on, and not one of them painted.
    #
    # A sentence the plan wrote that names something drawn has to be spoken WHILE that thing is
    # drawn. So the parts follow the last such sentence. A plan whose line names nothing on the
    # board holds nothing back, and the parts open the turn exactly as before.
    named_here = -1
    for index, part in enumerate(parts[: max(0, question)]):
        if any(name and names(part, name) for name in seen_all):
            named_here = index

    # Rebuild the line, and move every beat by however many sentences went in before it.
    out: list[str] = ([] if named_here >= 0 else list(lead)) + list(added.get(-1, []))
    shift = [0] * (len(parts) + 1)
    for index in range(len(parts)):
        shift[index] = len(out)
        out.append(parts[index])
        if index == named_here:
            out.extend(lead)
        out.extend(added.get(index, []))
    shift[len(parts)] = len(out)

    for obj in drawn:
        place = _place_of(obj)
        if place is None:
            continue
        _rebeat(obj, min(shift[min(place[0], len(parts))], len(out) - 1))

    # A mark that got its own sentence keeps time with it, not with the one that failed to name it.
    # A MARK ON THE LEARNER'S PAGE IS NOT IN THIS LIST: it keeps the beat the shaper chose
    # (``doubt.DoubtShaper``, law 5: the first stroke is on the first sentence) and its pointing
    # sentence goes in directly after that sentence, so the pen lands on "Look at the first line"
    # and the voice then says which line, the ink holding under it. Moved to the pointing
    # sentence, the pen would wait a whole sentence in the air.
    for obj, _at, sentence in marks:
        if sentence in out:
            _rebeat(obj, out.index(sentence))

    said = " ".join(out)
    keep_time(said, drawn)
    return said, drawn
