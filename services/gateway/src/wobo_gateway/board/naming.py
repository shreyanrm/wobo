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
  which the figure's own name covers.

THE TURN'S SHAPE. A sentence that goes in shifts every beat after it, on both spellings of a beat
(``beat`` and the glass planner's ``meta.beat``), so a mark still lands on the word that names it.
A mark that named no beat is spread across the whole utterance by ``stream._ink_clock``, so the
line AS A WHOLE is the sentence it is beaten to, and its naming goes on the end.

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

#: Working, rather than words: an equals sign, a power, or a number with an operator against it.
_EXPRESSION = re.compile(r"[=^]|\d\s*[+*/]|[+*/]\s*\d")


def flat(text: str) -> str:
    """The same sentence whatever the stream did to its spacing, case or punctuation."""
    return " ".join(_WORD.findall((text or "").lower()))


def split(say: str) -> list[str]:
    """Wobo's line, split the way Wobo speaks it."""
    return [s.strip() for s in _SENTENCE_SPLIT.split((say or "").strip()) if s.strip()]


def _content(text: str) -> list[str]:
    return [w for w in _WORD.findall((text or "").lower()) if w not in _STOPWORDS]


def names(sentence: str, subject: str) -> bool:
    """Does this sentence name that subject? Every content word of the subject has to be in it.

    Articles and pointing words do not count either way, so "Hypotenuse, then." names "the
    hypotenuse" and "opposite the right angle" does not.
    """
    wanted = _content(subject)
    if not wanted:
        return False
    have = set(_content(sentence))
    return all(w in have for w in wanted)


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
    head = _subject_head(_own_words(obj, "words"))
    if not head:
        head = _subject_head(_own_words(obj, "text", "label"))
    if not head:
        head = _subject_head(_anchored_to(obj, by_id))
    return head or None


def part_name(obj: dict[str, Any]) -> str | None:
    """The name a figure gives one of its own parts, or None when this object is not a part.

    A ``label`` is the figure naming a part of itself. A ``number`` with a label is a measured part
    with its measurement ("dominant 3"). A ``region`` or a ``polygon`` with a title is a named
    shape. Everything else on a from-scratch board — the working, the construction strokes, the
    pointers — is drawn, not named, and is covered by the parts it points at.
    """
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


# --- the register --------------------------------------------------------------------------------


def in_register(words: str) -> str:
    """One sentence, in Wobo's voice, from words a thing carries about itself.

    Never narration (voice.md 10c): "I'll circle the hypotenuse" becomes "The hypotenuse". No em
    dash and no exclamation mark, because a learner reads this (voice.md §3, 10a). Sentence case,
    a capital at the front and a full stop at the back, because it is a sentence.
    """
    body = _NARRATION.sub("", (words or "").strip())
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


def _rebeat(obj: dict[str, Any], to: int) -> None:
    for holder in (obj, obj.get("meta") if isinstance(obj.get("meta"), dict) else None):
        if not isinstance(holder, dict):
            continue
        beat = holder.get("beat")
        if isinstance(beat, dict) and isinstance(beat.get("with"), int):
            beat["with"] = to


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
    words = _WORD.findall((sentence or "").lower())
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
        name = part_name(obj) or mark_subject(obj, by_id)
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
            if not names(where, subject):
                out.append(subject)
            continue
        name = part_name(obj)
        if name and not names(say, name):
            out.append(name)
    return out

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
        at = beat if beat is not None and beat < question else question - 1
        at = max(at, -1)
        sentence = in_register(_own_words(obj, "words") or subject)
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
        beat = _beat_of(obj)
        if beat is None:
            continue
        _rebeat(obj, min(beat + shift[min(beat, len(parts))], len(out) - 1))

    # A mark that got its own sentence keeps time with it, not with the one that failed to name it.
    for obj, _at, sentence in marks:
        if sentence in out:
            _rebeat(obj, out.index(sentence))

    said = " ".join(out)
    keep_time(said, drawn)
    return said, drawn
