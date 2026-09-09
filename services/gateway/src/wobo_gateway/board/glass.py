"""The glass map and the plan of marks on it (docs/INK-FREEZE-PLAN-TRACE.md section 3, Plan).

The client freezes the glass and sends a **map**: every visible line of text and every meaningful
element with an id, a role, its words, its box in CSS px and, when we own the content, its
meaning (``step:2``, ``misconception:moves-term-without-sign``). The brain plans **by id**.

One grammar for every mark on the learner's screen, live or keyless::

    {"sentences": [{"say": "...", "marks": [{"kind": "ring", "target": "w2", "words": "step 2"}]}],
     "ask": {"prompt": "...", "targets": ["w2"]},
     "open": {"kind": "graph", "intent": {"pipeline": "math", "op": "graph", ...}}}

- two to four sentences, at most two marks each, at most ten a turn;
- a mark is ``{kind, target, words}``: the kind one of ring, underline, arrow, bracket, tick,
  cross, note, point; the target an id on the map (or, as a fallback, the exact words of a line);
  the words what the mark means, spoken with it, and they are in the sentence;
- the say names what it draws: never a label read back, never a pointer word with no mark under it;
- a drawing from scratch is the separate verb ``open``, handed to the plane's pipelines as today;
- wrong is refused before it is drawn, with a reason: a target not on the map, a number the ask
  did not give, a mark with no words, a sentence with no mark when the question asked to be shown.

``compile`` turns a validated plan into the object list ``board.planner`` already reads, so the
verifier, the spoken-number law, the screens and the stream are exactly the ones every board turn
goes through. Nothing here writes a coordinate.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from wobo_gateway import spoken

#: The map is at most this many entries (the client chooses by visibility and relevance).
MAX_ENTRIES = 60
#: The plan's shape.
MAX_SENTENCES = 4
MAX_MARKS_PER_SENTENCE = 2
MAX_MARKS = 10
#: The kinds a plan may ask for. The hand draws each one from the element's real box.
KINDS: tuple[str, ...] = ("ring", "underline", "arrow", "bracket", "tick", "cross", "note", "point")
#: A line of the map is clamped to this many characters in the prompt.
TEXT_CLAMP = 72
#: How long the hand takes over each kind, in ms (the ring 300 to 600; the rest by their length,
#: which the hand refines from the real box; these are the plan's beats).
DURATION_MS: dict[str, int] = {
    "ring": 450,
    "underline": 350,
    "arrow": 350,
    "bracket": 350,
    "tick": 260,
    "cross": 300,
    "note": 500,
    "point": 240,
}

_FOCUS_ROLE = "focus"
_STEP_RE = re.compile(r"\bstep[:\s]*(\d{1,2})\b", re.IGNORECASE)
_SPACE_RE = re.compile(r"\s+")
_WORD_RE = re.compile(r"[a-z][a-z0-9']{2,}")
_MEANING_WORD_RE = re.compile(r"[a-z0-9]+")
#: A demonstrative with nothing under it is a pointer at nothing.
#: A name that starts with a pointer ("this triangle") cannot be spoken in a sentence with no
#: mark under it.
_POINTER_LEAD_RE = re.compile(r"^\s*(?:this|that|these|those)\s+", re.IGNORECASE)
_POINTER_RE = re.compile(
    r"\b(this|these|those|here)\b|\bthat (one|part|line|step|side|bit|sign|number|term)\b",
    re.IGNORECASE,
)
#: A leading pointer phrase before a label: "Right here: 2x = 20." is still the label read back.
_LEAD_IN_RE = re.compile(
    r"^(?:right here|here|this part|this one|this|look|see)\s*[:,]?\s*", re.IGNORECASE
)
#: The question asked to be SHOWN something: every sentence then carries a mark or is a question.
_ASKS_TO_BE_SHOWN = re.compile(
    r"\b(circle|ring|underline|mark|highlight|point (?:at|to|out)|show me|where(?:'s| is)|"
    r"which (?:step|line|part|one|side|bit))\b",
    re.IGNORECASE,
)
#: Words that name nothing on a map by themselves.
_STOPWORDS = frozenset({
    "the", "a", "an", "this", "that", "these", "those", "is", "are", "was", "were", "be", "been",
    "what", "which", "where", "why", "how", "does", "do", "did", "can", "could", "would", "should",
    "it", "its", "of", "on", "in", "at", "to", "for", "with", "and", "or", "not", "me", "my",
    "your", "you", "i", "we", "they", "tell", "show", "explain", "about", "there", "here", "one",
    "ones", "thing", "circle", "ring", "mark", "underline", "point", "highlight", "diagram",
    "figure", "picture", "image", "page", "screen", "board", "wrong", "right", "step", "line",
})  # fmt: skip
#: A question about what is on the screen, in the learner's own words.
_ABOUT_THIS = re.compile(
    r"^\s*(why|how|what|explain|tell me|i (?:don'?t|do not) (get|understand)|huh)\b|"
    r"\bwhat (is|are|does) (this|that|it)\b",
    re.IGNORECASE,
)
#: A request to mark something in place.
_MARK_IT = re.compile(
    r"\b(ring|circle|mark|highlight|underline|point (?:at|to)|show me|where is|where's)\b",
    re.IGNORECASE,
)
#: A request to BUILD something. With no marking word beside it, the answer is the plane's
#: pipelines or the spoken turn, never a ring round the nearest thing the words happen to name
#: ("draw the triangle and show me why the squares add" is not "circle the hypotenuse").
_BUILD_IT = re.compile(r"\b(draw|construct|graph|plot|build|sketch|make)\b", re.IGNORECASE)
_MARK_WORD = re.compile(
    r"\b(ring|circle|mark|highlight|underline|point (?:at|to))\b", re.IGNORECASE
)
#: A numeral in the question, as a token: "the 5" names the line the 5 is on.
_NUMERAL_TOKEN = re.compile(r"(?<![\w.])\d+(?:\.\d+)?(?![\w.])")
#: "Which step is wrong", "where is my mistake": answered from the content model or the verifier,
#: never from a guess.
_WRONG_STEP = re.compile(
    r"\b(which|what|where)\b.*\b(wrong|mistake|slip|error|off|broke|breaks)\b|"
    r"\b(mistake|slip)\b|\bgo(?:es|ne)? wrong\b",
    re.IGNORECASE,
)
_LINE_ROLES = frozenset({"line", "step", "heading", "photo-line", "text", "card", "cell", "focus"})
#: When the words name two things, the thing with a meaning of its own wins: the part before
#: the figure that holds it, the step before the prose that quotes it, a heading before a line.
_NAMED_RANK: dict[str, int] = {
    "figure-part": 4,
    "step": 4,
    "photo-line": 3,
    "cell": 3,
    "input": 3,
    "chip": 2,
    "heading": 2,
    "figure": 1,
    "card": 1,
    "line": 0,
    "text": 0,
    "target": 1,
}
#: A count names a place, not a quantity: "step 2", "line 1", "row 3" need no number given.
_COUNT_RE = re.compile(
    r"\b(step|line|row|column|col|part|sentence|question|page|term|side)\s+\d{1,2}\b",
    re.IGNORECASE,
)
#: The kind label a meaning carries ("part:effect", "step:2 concept:feel-the-rule"). It is the
#: content model's vocabulary, not the learner's, so it is stripped before the words are read:
#: otherwise every figure part answers to the word "part".
_MEANING_KIND_RE = re.compile(
    r"\b(part|step|concept|misconception|figure|photo|line|row|cell|heading|card|kind|role)\s*:",
    re.IGNORECASE,
)
#: The framing a question wraps its subject in. "Circle the effect circle in the diagram" is a
#: question about the effect; scoring it by its whole self is how wave 39 rang the learner's own
#: bubble, which repeats every framing word too.
_FRAMING_LEAD_RE = re.compile(
    r"^\s*(?:please\s+)?(?:can|could|will|would)?\s*(?:you\s+)?"
    r"(?:circle|ring|mark|highlight|underline|point\s+(?:at|to|out)|show\s+me|show|"
    r"tell\s+me\s+about|explain|what(?:'s| is| are)|which|where(?:'s| is)|"
    r"why\s+(?:is|are|does|do)|how\s+(?:is|are|does|do))\s+"
    r"(?:the|a|an|this|that|these|those|my|your)?\s*",
    re.IGNORECASE,
)
_FRAMING_TAIL_RE = re.compile(
    r"\s*\b(?:in|on|at|from|of)\s+(?:the\s+|this\s+|that\s+)?"
    r"(?:diagram|figure|picture|image|photo|page|screen|board|card|drawing|lesson|question|"
    r"problem|working|example|here|above|below)\b.*$",
    re.IGNORECASE,
)
#: A question that asks for a VALUE. "What is 2 to the power 5?" is arithmetic, not a place on the
#: glass: wave 39 made it a drawing turn and rang the learner's own words.
_COMPUTE_RE = re.compile(
    r"^\s*(?:what(?:'s| is| are)|how much|calculate|compute|evaluate|work out|solve)\b"
    r"(?=[^?]*(?:\bpower\b|\btimes\b|\bplus\b|\bminus\b|\bdivided\b|\bsquared\b|"
    r"\bcubed\b|\bsquare root\b|\bpercent\b|\bfactorial\b|[+*/^\u00d7\u00f7]|\d\s*-\s*\d))",
    re.IGNORECASE,
)
#: Wobo's OWN surfaces on the map: the companion transcript, the chat panel, the gesture layer's
#: visually hidden announcement. The glass builder is taking them off the map; the brain refuses
#: them too, because a ring round Wobo's own words teaches nothing (findings 1 and 2, wave 39).
_OWN_ROLES = frozenset({
    "status", "log", "alert", "live-region", "announcement", "transcript", "companion",
    "bubble", "chat", "message", "reply", "say",
})  # fmt: skip
_OWN_HINT_RE = re.compile(
    r"\b(wobo|companion|transcript|announcement|aria-?live|sr-?only|bubble|assistant)\b",
    re.IGNORECASE,
)
#: What the gesture layer says into the live region when a lasso closes.
_ANNOUNCEMENT_RE = re.compile(
    r"\bask wobo about this\b|^\s*(circled|selected|lassoed|highlighted)\b|"
    r"^\s*the line that says\b",
    re.IGNORECASE,
)


# --- the map ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Entry:
    """One thing on the glass. ``box`` is ``(x, y, w, h)`` in CSS px, or None when the client
    gave none (the old registry, a focus region): such an entry may still be a target, because
    the hand resolves the box by id."""

    id: str
    role: str
    text: str = ""
    box: tuple[float, float, float, float] | None = None
    meaning: str = ""


def _num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _box_of(raw: Any) -> tuple[float, float, float, float] | None:
    if isinstance(raw, (list, tuple)) and len(raw) == 4 and all(_num(v) for v in raw):
        return (float(raw[0]), float(raw[1]), float(raw[2]), float(raw[3]))
    return None


def _text(value: Any, limit: int = 400) -> str:
    return _SPACE_RE.sub(" ", str(value or "")).strip()[:limit]


def _entry(raw: dict[str, Any]) -> Entry | None:
    ident = _text(raw.get("id"), 64)
    if not ident:
        return None
    return Entry(
        id=ident,
        role=_text(raw.get("role") or raw.get("kind") or "text", 32),
        text=_text(raw.get("text") if raw.get("text") is not None else raw.get("label")),
        box=_box_of(raw.get("box")),
        meaning=_text(raw.get("meaning") or raw.get("description"), 120),
    )


def entries_of(body: dict[str, Any]) -> list[Entry]:
    """The map this turn rides on, from wherever the client put it.

    ``context.packet.glass`` (a map or its entries) is the shape the frozen glass sends;
    ``board.glass`` is the same thing on the board context. An older client still sends the
    registry snapshot (``context.targets`` and ``context.packet.screen``), and those targets are
    the map until it moves. The region the learner circled (``packet.focus``) is always on the map
    as a ``focus``, and never trimmed off it.
    """
    body = body if isinstance(body, dict) else {}
    context = body.get("context") if isinstance(body.get("context"), dict) else {}
    board = body.get("board") if isinstance(body.get("board"), dict) else {}
    packet = context.get("packet") if isinstance(context.get("packet"), dict) else {}

    raws: list[dict[str, Any]] = []
    for source in (packet.get("glass"), board.get("glass")):
        if isinstance(source, dict):
            source = source.get("entries")
        if isinstance(source, list):
            raws.extend(r for r in source if isinstance(r, dict))
    raws.extend(t for t in (context.get("targets") or []) if isinstance(t, dict))
    screen = packet.get("screen")
    if isinstance(screen, dict):
        for surface in screen.get("surfaces") or []:
            if isinstance(surface, dict):
                raws.extend(t for t in (surface.get("targets") or []) if isinstance(t, dict))

    seen: set[str] = set()
    entries: list[Entry] = []
    for raw in raws:
        entry = _entry(raw)
        if entry is None or entry.id in seen or entry.role == _FOCUS_ROLE:
            continue
        seen.add(entry.id)
        entries.append(entry)

    focuses: list[Entry] = []
    for focus in (packet.get("focus"), context.get("focus")):
        if isinstance(focus, dict):
            ident = _text(focus.get("id"), 64)
            if ident and ident not in seen:
                seen.add(ident)
                focuses.append(Entry(id=ident, role=_FOCUS_ROLE, text=_text(focus.get("text"))))
    return [*entries[: max(0, MAX_ENTRIES - len(focuses))], *focuses]


def map_lines(entries: list[Entry]) -> str:
    """The map as the model reads it: one line an entry, ``id | role | meaning | text``. No
    boxes: the plan names ids, and the hand has the boxes."""
    lines = []
    for entry in entries:
        text = entry.text if len(entry.text) <= TEXT_CLAMP else entry.text[: TEXT_CLAMP - 1] + "…"
        lines.append(f"{entry.id} | {entry.role} | {entry.meaning or '-'} | {text}")
    return "\n".join(lines)


def _norm(text: str) -> str:
    return _SPACE_RE.sub(" ", (text or "").strip().lower()).rstrip(".!?,;: ")


def _tight(text: str) -> str:
    """For matching a line of working: no spaces, no explicit multiplication."""
    return re.sub(r"[\s*]+", "", (text or "").lower())


def find(entries: list[Entry], target: str) -> Entry | None:
    """The entry an id names, or, as the fallback, the entry whose exact words the target is."""
    wanted = _text(target, 200)
    if not wanted:
        return None
    for entry in entries:
        if entry.id == wanted:
            return entry
    key = _norm(wanted)
    if key:
        for entry in entries:
            if _norm(entry.text) == key:
                return entry
    return None


def _content_words(text: str) -> set[str]:
    low = (text or "").lower()
    words = {w for w in _WORD_RE.findall(low) if w not in _STOPWORDS}
    words.update(_NUMERAL_TOKEN.findall(low))
    return words


def _meaning_words(entry: Entry) -> set[str]:
    """The content model's own words for this entry, with its kind label stripped."""
    bare = _MEANING_KIND_RE.sub(" ", entry.meaning.lower())
    return {w for w in _MEANING_WORD_RE.findall(bare) if w not in _STOPWORDS and len(w) > 2}


def _entry_words(entry: Entry) -> set[str]:
    return _content_words(entry.text) | _meaning_words(entry)


def _subject_words(question: str) -> set[str]:
    """The words of what the question is ABOUT, with its own framing stripped off.

    "Circle the effect circle in the diagram" is about the effect. Scoring an entry by its overlap
    with the whole question is what made the learner's own bubble win every time: the bubble
    repeats the framing as well as the subject.
    """
    trimmed = _FRAMING_TAIL_RE.sub("", _FRAMING_LEAD_RE.sub("", question or ""))
    return _content_words(trimmed) or _content_words(question)


def _learner_lines(context: dict[str, Any] | None) -> set[str]:
    """Everything the learner has typed or said this session, normalised. Their own words are on
    the glass as chat bubbles, and Wobo's replies quote them straight back."""
    context = context if isinstance(context, dict) else {}
    turn = context.get("turn") if isinstance(context.get("turn"), dict) else {}
    said = {_norm(str(turn.get("lastUserInput") or ""))}
    for row in turn.get("recentTurns") or []:
        if isinstance(row, dict) and str(row.get("role") or "").lower() in {"user", "learner"}:
            said.add(_norm(str(row.get("text") or "")))
    return {line for line in said if line}


def is_own_words(entry: Entry, question: str, said: set[str] | None = None) -> bool:
    """Is this entry Wobo's own surface, or the learner's own words read back?

    Wave 39's whole failure in one predicate. The glass map carried the companion transcript, the
    chat panel and a visually hidden live-region announcement, and the planner named whichever of
    them shared the most words with the question — which is always the learner's own bubble,
    because the bubble IS the question. The glass builder is taking those off the map; this is the
    second belt, because a ring round Wobo's own words is the one mark that can never teach.
    """
    if entry.role in _OWN_ROLES:
        return True
    if _OWN_HINT_RE.search(entry.id) or _OWN_HINT_RE.search(entry.meaning):
        return True
    own = _norm(entry.text)
    if not own:
        return False
    if _ANNOUNCEMENT_RE.search(entry.text):
        return True
    if entry.role not in _LINE_ROLES or entry.meaning:
        return False
    for line in {_norm(question), *(said or set())}:
        if not line:
            continue
        # The whole of what they said, or a line that carries the whole of it.
        if own == line or line in own:
            return True
        # A WRAPPED BUBBLE (the adversary, 2026-09-09, finding 1). The glass reader splits a text
        # node at its LINE BOXES, so a bubble two lines tall arrives as two entries: "draw a
        # labelled map of india and" and "mark maharashtra". The exact test above matched neither,
        # and Wobo rang the learner's own question on /chat and said "The line that says Draw a
        # labelled map of India is this one."
        #
        # A piece that BEGINS where their words begin is that first wrapped line and nothing else.
        # It is anchored at the start on purpose: a lesson line the question happens to quote
        # ("the square on the hypotenuse" inside "circle the square on the hypotenuse") starts
        # somewhere else and is a subject like any other — it is the entry the 19 turns that aimed
        # correctly rang.
        own_words, line_words = own.split(), line.split()
        if (
            len(own_words) >= 3
            and len(own_words) < len(line_words)
            and line_words[: len(own_words)] == own_words
        ):
            return True
    return False


def names_nothing(question: str) -> bool:
    """A question that asks for a VALUE names no place on the glass. "What is 2 to the power 5?"
    became a drawing turn in wave 39 and rang the learner's own bubble."""
    return bool(_COMPUTE_RE.search(question or ""))


def named_entry(
    question: str, entries: list[Entry], *, context: dict[str, Any] | None = None
) -> Entry | None:
    """The entry the question is ABOUT, or None.

    The aim, in order:

    1. **the content model's meaning.** An entry whose ``meaning`` the question names — the
       concept, the part, the step, the misconception, the photo line, the figure part, the
       heading — wins over any amount of bare word overlap. This is what we know that a screenshot
       does not, and it is the whole reason the map carries meanings at all.
    2. **the words of the SUBJECT**, with the question's own framing stripped off, never the
       overlap with the whole question.
    3. then the thing with a role of its own (the part before the figure that holds it, the step
       before the prose that quotes it), then how much of its own words were named, then the
       shorter one.

    Wobo's own surfaces and the learner's own words are never named, whatever they share
    (:func:`is_own_words`). No word in common, no entry: an ordinary sentence never gets a ring
    round the nearest thing.
    """
    if names_nothing(question):
        return None
    numbered = _STEP_RE.search(question or "")
    said = _learner_lines(context)
    if numbered is not None:
        wanted = int(numbered.group(1))
        for entry in entries:
            if _step_number(entry) == wanted and not is_own_words(entry, question, said):
                return entry
    asked = _subject_words(question)
    if not asked:
        return None
    best: tuple[tuple[int, int, int, float, int], Entry] | None = None
    for entry in entries:
        if is_own_words(entry, question, said):
            continue
        meant = len(asked & _meaning_words(entry))
        shared = len(asked & _entry_words(entry))
        if not shared:
            continue
        told = _content_words(entry.text)
        ratio = len(asked & told) / max(1, len(told)) if told else 0.0
        score = (
            1 if meant else 0,
            shared,
            _NAMED_RANK.get(entry.role, 0),
            ratio,
            -len(entry.text),
        )
        if best is None or score > best[0]:
            best = (score, entry)
    return best[1] if best else None


# --- the grammar, parsed --------------------------------------------------------------------------


@dataclass
class RawSentence:
    say: str
    marks: list[Any] = field(default_factory=list)


@dataclass
class Parsed:
    sentences: list[RawSentence] = field(default_factory=list)
    ask: dict[str, Any] | None = None
    open: dict[str, Any] | None = None


def parse(data: Any) -> Parsed:
    """The model's answer in the grammar, as written. Nothing is judged here; garbage parses to
    a plan with no sentences, which compiles to nothing."""
    if not isinstance(data, dict):
        return Parsed()
    raw = data.get("sentences")
    if not isinstance(raw, list):
        return Parsed()
    sentences: list[RawSentence] = []
    for item in raw:
        if isinstance(item, str):
            sentences.append(RawSentence(say=item))
        elif isinstance(item, dict):
            marks = item.get("marks")
            sentences.append(
                RawSentence(
                    say=str(item.get("say") or ""),
                    marks=list(marks) if isinstance(marks, list) else [],
                )
            )
    ask = data.get("ask") if isinstance(data.get("ask"), dict) else None
    opened = data.get("open") if isinstance(data.get("open"), dict) else None
    return Parsed(sentences=sentences, ask=ask, open=opened)


# --- the grammar, validated -----------------------------------------------------------------------


@dataclass(frozen=True)
class Mark:
    kind: str
    entry: Entry
    words: str

    @property
    def anchor(self) -> dict[str, Any]:
        anchor: dict[str, Any] = (
            {"focus": self.entry.id}
            if self.entry.role == _FOCUS_ROLE
            else {"target": self.entry.id}
        )
        if self.kind == "note":
            anchor["at"] = "right"  # in the margin, beside the thing
        return anchor


@dataclass
class Sentence:
    say: str
    marks: list[Mark] = field(default_factory=list)


@dataclass
class Validated:
    sentences: list[Sentence] = field(default_factory=list)
    ask: dict[str, Any] | None = None
    intent: dict[str, Any] | None = None
    refused: list[str] = field(default_factory=list)


def asked_to_be_shown(question: str) -> bool:
    return bool(_ASKS_TO_BE_SHOWN.search(question or ""))


def _reads_back(say: str, entries: list[Entry]) -> str | None:
    """The label the sentence is, when it is one, else None."""
    bare = _norm(_LEAD_IN_RE.sub("", say.strip()))
    if not bare:
        return None
    for entry in entries:
        label = _norm(entry.text)
        if label and label == bare:
            return entry.text
    return None


def _ungiven(text: str, given: set[float]) -> list[str]:
    """The numerals in ``text`` nobody gave, as written. A count ("step 2", "line 1") names a
    place on the glass, not a quantity, and is never one of them."""
    bad: list[str] = []
    for match in spoken._NUMERAL.finditer(_COUNT_RE.sub(" ", text or "")):
        value = spoken._to_float(match.group(0))
        if value is None or value in given or spoken._rounds_to(match.group(0), given):
            continue
        bad.append(match.group(0))
    return bad


def _validate_mark(
    raw: Any, question: str, entries: list[Entry], given: set[float]
) -> tuple[Mark | None, str | None]:
    """A mark, or the reason it is not one.

    THE VALIDATOR REFUSES SINS, NOT WORK (wave 39's finding 7). What is refused here is what
    cannot be drawn or must not be said: a kind the hand has no stroke for, a target that is not
    on the glass, a mark with no words at all, a number nobody gave, and a mark on Wobo's own
    surface. What is NOT refused is a sentence that words the mark differently from the mark: on
    Luna, "Look at the corner where the two shorter sides meet" lost its ring on the right angle
    because the mark said "the corner to face", and five of nine live drawing turns ended with
    every mark thrown away and Wobo asking "What is being marked?". The mark's own words are
    spoken with it; that is what the field is for.
    """
    if not isinstance(raw, dict):
        return None, "a mark that is not an object was dropped"
    kind = _text(raw.get("kind"), 20).lower()
    target = _text(raw.get("target"), 200)
    words = _text(raw.get("words"), 200)
    if kind not in KINDS:
        return None, f"mark on {target!r}: kind {kind!r} is not one of {', '.join(KINDS)}"
    entry = find(entries, target)
    if entry is None:
        return None, f"{kind} on {target!r}: not on the glass"
    if not words:
        return None, f"{kind} on {entry.id!r} has no words"
    bad = _ungiven(words, given)
    if bad:
        return None, f"{kind} on {entry.id!r} says {bad[0]!r}, a number nobody gave"
    if kind == "note" and spoken._NUMERAL.search(words):
        numeral = spoken._NUMERAL.search(words)
        assert numeral is not None
        return None, (
            f"note on {entry.id!r} writes {numeral.group(0)!r}: a number is spoken with the "
            "learner, never written by a plan"
        )
    if is_own_words(entry, question):
        return None, (
            f"{kind} on {entry.id!r}: that is Wobo's own surface, or the learner's own words"
        )
    return Mark(kind=kind, entry=entry, words=words), None


def validate(parsed: Parsed, *, entries: list[Entry], context: dict[str, Any]) -> Validated:
    """Every refusal, with its reason, before a stroke is planned."""
    context = context if isinstance(context, dict) else {}
    question = str((context.get("turn") or {}).get("lastUserInput") or "")
    shown = asked_to_be_shown(question)
    given = spoken.given_numbers(context)
    out = Validated()
    total_marks = 0
    # With something opened from scratch, "here" and "this" have the plane under them.
    opened = parsed.open is not None

    # A mark whose own sentence was refused. The words are not said; the ink is still drawn, on
    # the nearest sentence that survived. Wave 39 threw the marks out with the sentence: a "2"
    # nobody gave killed the lens plan's second sentence AND both of its rings.
    orphans: list[Mark] = []
    from wobo_gateway.wobo import is_jsonish

    def place(mark: Mark) -> bool:
        """Hang a mark on the last sentence that has room. False when there is nowhere yet."""
        nonlocal total_marks
        for held in reversed(out.sentences):
            if len(held.marks) < MAX_MARKS_PER_SENTENCE and total_marks < MAX_MARKS:
                held.marks.append(mark)
                total_marks += 1
                return True
        return False

    for index, raw in enumerate(parsed.sentences):
        n = index + 1
        say = _text(raw.say, 600)
        marks: list[Mark] = []
        extra = 0
        for raw_mark in raw.marks:
            mark, why = _validate_mark(raw_mark, question, entries, given)
            if mark is None:
                out.refused.append(f"sentence {n}: {why}")
            elif len(marks) >= MAX_MARKS_PER_SENTENCE:
                extra += 1
            else:
                marks.append(mark)
        if extra:
            out.refused.append(f"sentence {n} has more than two marks: {extra} not drawn")

        is_question = say.rstrip().endswith("?")
        unsaid: str | None = None
        if not say:
            unsaid = f"sentence {n} has no words" + (
                f": its {len(marks)} mark(s) ride the sentence before them" if marks else ""
            )
        elif len(out.sentences) >= MAX_SENTENCES:
            unsaid = f"more than four sentences: sentence {n} was not said"
        elif is_jsonish(say):
            unsaid = f"sentence {n} is machinery, not words, and was not said"
        else:
            label = _reads_back(say, entries)
            if label is not None:
                unsaid = f"sentence {n} is a label read back: {label!r}"
            elif not is_question:
                bad = _ungiven(say, given)
                if bad:
                    unsaid = (
                        f"sentence {n} says {bad[0]!r}, a number nobody gave, and was not said"
                    )
        if unsaid is not None:
            # The words are not said. The ink still is: it rides the nearest sentence that
            # survived, because a mark that passed every check of its own is WORK, not a sin.
            out.refused.append(unsaid)
            orphans.extend(marks)
            continue

        sentence = Sentence(say=say)
        for mark in marks:
            if total_marks >= MAX_MARKS:
                out.refused.append(
                    f"more than ten marks a turn: {mark.kind} on {mark.entry.id!r} not drawn"
                )
                continue
            sentence.marks.append(mark)
            total_marks += 1

        if not sentence.marks:
            pointer = None if opened else _POINTER_RE.search(say)
            if pointer is not None:
                out.refused.append(
                    f"sentence {n} has a pointer word ({pointer.group(0)!r}) and no mark under it"
                )
                continue
            if shown and not is_question:
                out.refused.append(
                    f"sentence {n} has no mark and the question asked to be shown: not said"
                )
                continue
        out.sentences.append(sentence)
        while orphans and place(orphans[0]):
            orphans.pop(0)

    for mark in orphans:
        if not place(mark):
            out.refused.append(
                f"{mark.kind} on {mark.entry.id!r}: no sentence of this turn survived to carry it"
            )

    if parsed.ask is not None and _text(parsed.ask.get("prompt"), 240):
        ids = {e.id for e in entries}
        targets = [
            str(t) for t in (parsed.ask.get("targets") or []) if isinstance(t, str) and t in ids
        ]
        out.ask = {"prompt": _text(parsed.ask.get("prompt"), 240), "targets": targets}

    if parsed.open is not None:
        from wobo_gateway.board.pipelines import PIPELINES

        intent = parsed.open.get("intent")
        kind = _text(parsed.open.get("kind"), 40)
        # ONE VERB A TURN, and the open is the second one (wave 39's finding 8). Live, "circle the
        # hypotenuse" rang the square on the hypotenuse and then a y = x**2 graph filled the card
        # and the triangle was gone; "which step is wrong here?" drew a number line over the
        # lesson. A drawing from scratch answers a question the glass cannot: it never lands on a
        # turn whose marks landed, it never answers a question whose subject is already on the
        # glass, and it never takes the lesson's own card away from the learner.
        builds = bool(_BUILD_IT.search(question)) and not _MARK_WORD.search(question)
        on_glass = named_entry(question, entries, context=context)
        lesson = any(e.role in {"card", "figure"} and e.meaning for e in entries)
        if total_marks > 0:
            out.refused.append(
                f"open {kind!r} beside {total_marks} mark(s) on the glass: a turn whose marks "
                "landed is answered on the glass; nothing opened"
            )
        elif on_glass is not None and not builds:
            out.refused.append(
                f"open {kind!r}: what the question asks about is on the glass "
                f"({on_glass.id!r}); nothing opened"
            )
        elif lesson and not builds and (shown or _WRONG_STEP.search(question)):
            # A question whose answer is a PLACE ("which step is wrong here?", "where is my
            # mistake?", "show me the...") is answered where the learner is looking. Live at 390
            # that question drew a number line over the lesson. A question the page cannot
            # answer at all ("explain photosynthesis") still opens the plane.
            out.refused.append(
                f"open {kind!r}: the question asks where on the page, and opening it would "
                "replace the lesson's own card; nothing opened"
            )
        elif (
            isinstance(intent, dict)
            and intent.get("pipeline") in PIPELINES
            and _text(intent.get("op"), 40)
        ):
            out.intent = dict(intent)
        else:
            out.refused.append(f"open {kind!r} names no pipeline: nothing opened")
    return out


# --- the grammar, compiled to what the planner reads ---------------------------------------------


def compile(plan: Validated | None) -> dict[str, Any] | None:  # noqa: A001 - the verb is the name
    """The validated plan as the object list ``board.planner`` reads. None when nothing is left:
    a plan with no words is not a board turn, and no floor is put under it."""
    if plan is None or not plan.sentences:
        return None
    objects: list[dict[str, Any]] = []
    for n, sentence in enumerate(plan.sentences):
        lag = 0
        for k, mark in enumerate(sentence.marks):
            duration = DURATION_MS[mark.kind]
            obj: dict[str, Any] = {
                "id": f"s{n}m{k}",
                "kind": mark.kind,
                "anchor": mark.anchor,
                "words": mark.words,
                "style": {"ink": "accent", "weight": 2},
                "t": {"dur": duration},
                "meta": {"beat": {"with": n, "lag": lag}, "mark": mark.kind},
            }
            if mark.kind == "ring":
                obj["pad"] = 8
            if mark.kind == "note":
                obj["text"] = mark.words
            objects.append(obj)
            lag += duration
    out: dict[str, Any] = {
        "say": " ".join(s.say for s in plan.sentences),
        "intents": [plan.intent] if plan.intent else [],
        "objects": objects,
    }
    if plan.intent is None:
        out["presentation"] = "screen"  # a plan of marks stays on the glass; the ink decides
    if plan.ask is not None:
        out["ask"] = plan.ask
    if plan.refused:
        out["refused"] = list(plan.refused)
    return out


# --- the keyless twin: the same grammar, from the map and the verifier ---------------------------


def _sentence(say: str, *marks: dict[str, Any]) -> dict[str, Any]:
    return {"say": say, "marks": list(marks)}


def _mark(kind: str, entry: Entry, words: str) -> dict[str, Any]:
    return {"kind": kind, "target": entry.id, "words": words}


def _step_number(entry: Entry) -> int | None:
    for source in (entry.meaning, entry.text):
        m = _STEP_RE.search(source)
        if m:
            return int(m.group(1))
    return None


def _wrong_step(context: dict[str, Any], entries: list[Entry]) -> Entry | None:
    """The step that is wrong, from the content model first, the verifier second, never a guess."""
    for entry in entries:
        if "misconception:" in entry.meaning:
            return entry
    canvas = context.get("canvas") if isinstance(context.get("canvas"), dict) else {}
    equation = str(canvas.get("equation") or "")
    steps = [str(s) for s in (canvas.get("steps") or [])]
    if not equation or not steps:
        return None
    from wobo_gateway.wobo import _ground_working

    grounding = _ground_working(equation, steps)
    bad = str((grounding or {}).get("first_bad_form") or "")
    if not bad:
        return None
    key = _tight(bad)
    for entry in entries:
        if key and key in _tight(entry.text):
            return entry
    return None


def _wrong_step_plan(context: dict[str, Any], entries: list[Entry]) -> dict[str, Any] | None:
    wrong = _wrong_step(context, entries)
    if wrong is None:
        return None
    given = spoken.given_numbers(context)
    n = _step_number(wrong)
    index = entries.index(wrong)
    previous: Entry | None = None
    for candidate in reversed(entries[:index]):
        if candidate.role == wrong.role:
            previous = candidate
            break
    numbered = (
        n is not None
        and previous is not None
        and _step_number(previous) == n - 1
        and float(n) in given
        and float(n - 1) in given
    )
    if numbered:
        assert n is not None and previous is not None
        sentences = [
            _sentence(
                f"Step {n} is the first line that does not follow from the one above it.",
                _mark("ring", wrong, f"step {n}"),
            ),
            _sentence(
                f"Compare it with step {n - 1}, the line just above.",
                _mark("underline", previous, f"step {n - 1}"),
            ),
            _sentence(f"What changed between step {n - 1} and step {n}?"),
        ]
        prompt = f"What changed between step {n - 1} and step {n}?"
    elif previous is not None:
        sentences = [
            _sentence(
                "This line is the first that does not follow from the one above it.",
                _mark("ring", wrong, "this line"),
            ),
            _sentence(
                "Compare it with the line just above.",
                _mark("underline", previous, "the line just above"),
            ),
            _sentence("What changed between them?"),
        ]
        prompt = "What changed between them?"
    else:
        sentences = [
            _sentence(
                "This line is where the working stops following the problem.",
                _mark("ring", wrong, "this line"),
            ),
            _sentence("What should it say instead?"),
        ]
        prompt = "What should it say instead?"
    targets = [wrong.id] + ([previous.id] if previous is not None else [])
    return {"sentences": sentences, "ask": {"prompt": prompt, "targets": targets}}


#: A step's ordinal glued to its words. The outline renders ``<i>2</i>feel the rule`` inside one
#: line box, so the entry's text arrives as "2feel the rule" — and wave 40 SPOKE it, on all
#: fourteen world lasso turns: "The line that says 2feel the rule is this one."
#: No space between them, and a real word after: "2feel the rule" is a marker glued to its step,
#: while "12 apples" is a number the page says out loud and "3x + 5 = 20" is a line of algebra.
_GLUED_ORDINAL_RE = re.compile(r"^\s*\d{1,2}(?=[A-Za-z]{3,}\b)")

#: THE SAME MARKER WITH THE SPACE THE PAGE DREW (the adversary, 2026-09-09, finding 2). Wave 45
#: fixed ``joinTextRuns`` in ``packages/wobo/src/glass/read.ts`` so two runs in different elements
#: that do not touch get the space the page put between them — which is right for a reader, and
#: which took the outline's marker out of reach of :data:`_GLUED_ORDINAL_RE`. All fourteen world
#: lasso turns went straight back to saying the number out loud: "This is the line: 2 feel the
#: rule", where wave 44 had measured "This is the line: feel the rule."
#:
#: A leading number with a space after it CANNOT be judged one line at a time: "2 feel the rule"
#: and "12 apples" are the same shape, and "5 cm" is a measurement. THE LINES AROUND IT DECIDE.
#: Two or more entries of the same role, in reading order, numbered one after another, are a
#: numbered list and their numbers are furniture the page drew. One line beginning with a digit is
#: a number the page means, and it is read exactly as it is written.
_SPACED_ORDINAL_RE = re.compile(r"^\s*(\d{1,2})\s*[.)]?\s+(?=[A-Za-z])")


def _list_numbered(entries: Sequence[Entry]) -> frozenset[str]:
    """The ids whose words open with a LIST NUMBER rather than with a number the page means."""
    heads: dict[str, list[tuple[Entry, int]]] = {}
    for entry in entries:
        m = _SPACED_ORDINAL_RE.match(entry.text or "")
        if m:
            heads.setdefault(entry.role, []).append((entry, int(m.group(1))))
    out: set[str] = set()
    for group in heads.values():
        run: list[Entry] = []
        last: int | None = None
        for entry, n in group:
            if last is not None and n == last + 1:
                run.append(entry)
            else:
                if len(run) >= 2:
                    out.update(e.id for e in run)
                run = [entry]
            last = n
        if len(run) >= 2:
            out.update(e.id for e in run)
    return frozenset(out)


def _readable(entry: Entry, entries: Sequence[Entry] | None = None) -> str:
    """An entry's words as a person would read them aloud.

    ``entries`` is the rest of the glass, and it is what tells a list number from a number: with
    no neighbours to compare against, only the glued spelling is furniture.
    """
    text = _GLUED_ORDINAL_RE.sub("", entry.text or "")
    if entries is not None and entry.id in _list_numbered(entries):
        text = _SPACED_ORDINAL_RE.sub("", text)
    return _SPACE_RE.sub(" ", text).strip()


#: A meaning's value is a SLUG. ``packages/wobo/src/glass/map.ts`` writes every one of them through
#: ``meaningSlug``, which lowercases the words and collapses ``[^a-z0-9]+`` to a single hyphen. So a
#: hyphen inside a meaning is always a space the client took out and never a word's own hyphen, and
#: reading one back verbatim reads the machine's spelling to a child: "circle the hypotenuse" was
#: answered aloud and in the transcript with "The square-on-the-hypotenuse is this one. What is the
#: square-on-the-hypotenuse for?" — at 1440, at 390 and under reduced motion (the adversary,
#: 2026-09-09, finding 1). Wave 40 had said "The square on the hypotenuse is this one." here.
_SLUG_VALUE_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _meant_words(entry: Entry) -> str:
    """The content model's name for this thing, in words a person says rather than a slug.

    The entry's own text wins when it is the same name spelled for a reader, because that is the
    spelling the board already shows and the one the ink object carries. Failing that the slug is
    unpicked, which is exact: the hyphens went in where the spaces were.
    """
    if not entry.meaning:
        return ""
    value = entry.meaning.rsplit(":", 1)[-1].strip()
    if not value:
        return ""
    slug = bool(_SLUG_VALUE_RE.match(value))
    words = value.replace("-", " ").replace("_", " ").strip() if slug else value
    text = _SPACE_RE.sub(" ", (entry.text or "").strip())
    if text and text.lower() == words.lower():
        return text
    return words


def _named_plan(
    question: str, entries: list[Entry], context: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    """The keyless twin's plan for a question that names something on the glass.

    IT HAS TO TEACH, NOT ONLY POINT (the adversary, 2026-09-09, finding 6). Wave 40's whole output
    was "<the thing> is this one. What do you notice about it?" — the same two sentences on all
    nineteen turns that aimed correctly, with the step's glued ordinal read aloud as "2feel". With
    no model there is no explanation to invent, but there is real structure on the glass to say
    out loud: where a step sits against the one above it, what the content model called this
    thing, and a question about THIS thing rather than about anything at all.
    """
    entry = named_entry(
        question, [e for e in entries if e.role != _FOCUS_ROLE], context=context
    )
    if entry is None:
        return None

    # A step among steps: the honest keyless teaching is the RELATION — the line above is where
    # this one came from, and that is a thing to look at rather than a thing to be told.
    n = _step_number(entry)
    previous: Entry | None = None
    if n is not None and n > 1 and entry in entries:
        index = entries.index(entry)
        for candidate in reversed(entries[:index]):
            if candidate.role == entry.role and _step_number(candidate) == n - 1:
                previous = candidate
                break
    if previous is not None:
        assert n is not None
        prompt = f"What changed between step {n - 1} and step {n}?"
        return {
            "sentences": [
                _sentence(f"Step {n} is this one.", _mark("ring", entry, f"step {n}")),
                _sentence(
                    f"It comes straight out of step {n - 1}, just above it.",
                    _mark("underline", previous, f"step {n - 1}"),
                ),
                _sentence(prompt),
            ],
            "ask": {"prompt": prompt, "targets": [entry.id, previous.id]},
        }

    # What to call it: the content model's own name for the thing wins over its raw words, because
    # the meaning is what we know that a screenshot does not.
    meant = _meant_words(entry)
    if entry.role in _LINE_ROLES and not meant:
        head = " ".join(_readable(entry, entries).split()[:8]).rstrip(".,;:")
        if not head:
            return None
        say = f"This is the line: {head}."
        words = "the line"
        prompt = "Say the line back in your own words. What is it claiming?"
    else:
        name = meant or _readable(entry, entries) or entry.id
        if len(name) > 40:
            name = " ".join(name.split()[:5])
        # A name that begins with a pointer is not a name: the ask below has no mark under it, and
        # the grammar refuses a sentence that points at nothing (:data:`_POINTER_RE`).
        name = _POINTER_LEAD_RE.sub("", name).strip() or entry.id
        low = name.lower()
        if not low.startswith(("the ", "a ", "an ", "your ", "my ")):
            name = f"the {name}"
        say = f"{name[0].upper()}{name[1:]} is this one."
        words = name.lower()
        prompt = f"What is {name.lower()} for?"
    return {
        "sentences": [
            _sentence(say, _mark("ring", entry, words)),
            _sentence(prompt),
        ],
        "ask": {"prompt": prompt, "targets": [entry.id]},
    }


def _focus_plan(entries: list[Entry]) -> dict[str, Any] | None:
    focus = next((e for e in entries if e.role == _FOCUS_ROLE), None)
    if focus is None:
        return None
    first = _sentence(
        "The bit you drew around is where to start.",
        _mark("ring", focus, "the bit you drew around"),
    )
    if focus.text and len(focus.text) <= 60:
        second = _sentence(
            f"Read it once more, {focus.text}, and say what it is doing.",
            _mark("underline", focus, focus.text),
        )
    else:
        second = _sentence("Read it once more and say what it is doing.")
    return {
        "sentences": [first, second, _sentence("What do you think happens next?")],
        "ask": {"prompt": "What do you think happens next?", "targets": [focus.id]},
    }


def _first_line_plan(entries: list[Entry]) -> dict[str, Any] | None:
    """A photo of the learner's page with nothing named in the words ("Explain this to me. Where
    do I start?"): the answer starts on the first line, ringed, and hands the next move back."""
    lines = [e for e in entries if e.role == "photo-line" and e.text]
    if not lines:
        return None
    first = lines[0]
    sentences = [
        _sentence(
            "Start at the first line, the one the whole page hangs on.",
            _mark("ring", first, "the first line"),
        ),
        _sentence("Read it out and say what it is asking for."),
        _sentence("What is the first thing you would do to it?"),
    ]
    return {
        "sentences": sentences,
        "ask": {"prompt": "What is the first thing you would do to it?", "targets": [first.id]},
    }


def keyless_plan(body: dict[str, Any]) -> dict[str, Any] | None:
    """A plan of marks with no key and no network, or None when the words name nothing on the
    glass. Held to the same validator as a model's plan."""
    context = body.get("context") if isinstance(body.get("context"), dict) else {}
    question = str((context.get("turn") or {}).get("lastUserInput") or "").strip()
    entries = entries_of(body)
    if not question or not entries:
        return None
    if not (_ABOUT_THIS.search(question) or question.endswith("?") or _MARK_IT.search(question)):
        return None  # a statement is not a drawing
    if _BUILD_IT.search(question) and not _MARK_WORD.search(question):
        return None  # something to build is the plane's, or the spoken answer's, never a ring
    if names_nothing(question):
        return None  # "what is 2 to the power 5?" is arithmetic, not a place on the glass
    if _WRONG_STEP.search(question):
        # "Which step is wrong" is answered from the content model or the verifier, or not at
        # all: the thing the words happen to name is never a guess at the slip.
        plan = _wrong_step_plan(context, entries)
    else:
        plan = _named_plan(question, entries, context) or _focus_plan(entries)
        # A photo of the page (the doubt door) with nothing named: the slip if the verifier can
        # find one, else the first line. The question is about the page in front of them.
        if plan is None and any(e.role == "photo-line" for e in entries):
            plan = _wrong_step_plan(context, entries) or _first_line_plan(entries)
    if plan is None:
        return None
    return compile(validate(parse(plan), entries=entries, context=context))
