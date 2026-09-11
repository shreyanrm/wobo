"""THE ARCADE — bonus levels in the middle of the climb.

docs/CONTENT-INTERACTION.md §7, the owner, 2026-09-08: optional study arcade games as bonus levels
for extra XP, "every now and then in the middle" of a chapter, because the boss level already sits
at the end.

Three things this module owns, and nothing else:

1. **The gate** (``verify_arcade``). Six mechanics, each with its own round shape, each checked
   before a spec is ever served. A composition the gate refuses never ships, and an unknown game is
   refused rather than passed through: nothing generated executes on a learner's device.

2. **The placement** (``skill_of``, ``door_positions``). A door sits after every second or third
   topic and NEVER after the last one, because the boss is the summit. A chapter gets a door only
   where speed or recall is genuinely the skill; everywhere else it gets none, because "no tap can
   be wrong" is what scored engagement 1.12 in wave 30 and a bonus level nobody needed is worse
   than no bonus level.

3. **The fill** (``plan_arcade``). The templates are code. A bonus level is built out of the level
   rendering that already exists — its workbook items, its flashcards, its ordered steps — so a
   play costs nothing and the words on a chip are words the learner has already met. The boss's
   own items are never spent on a game: the summit has to stay a surprise.

There is no model call anywhere in this file. That is the cost claim of §7, written as code.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

# --- the menu ------------------------------------------------------------------------------------

#: The owner's six, in his order: catch, sort against the clock, match pairs, defend the number
#: line, build the sequence, the running quiz with lives. Six mechanics, not one skin.
ARCADE_GAMES: tuple[str, ...] = ("catch", "sort", "match", "numberline", "sequence", "quiz")

ARCADE_SKILLS: tuple[str, ...] = ("speed", "recall")

# --- the money (docs/LEVELS.md §1 and §4) ---------------------------------------------------------

#: What one cleared bonus level pays.
BONUS_XP = 15
#: The most the arcade can pay inside one chapter, so nobody plays instead of learning.
BONUS_XP_CHAPTER_CAP = 45
#: The most it can pay in one day, across every chapter.
BONUS_XP_DAILY_CAP = 60
#: And it is never the XP that unlocks a level. A reward, never a shortcut past the learning.
BONUS_XP_COUNTS_TOWARD_LEVEL = False

# --- our own words -------------------------------------------------------------------------------

#: The line on the side door itself. Optional, off the path, and it says so.
DOOR_LINE = "a side door, if you want it. the climb goes on without it."

#: Every phrase the arcade says that did NOT come out of the level rendering. It is deliberately
#: tiny and it is register-checked by a test: no em dash a learner reads, no hype, no emoji.
FRAMING: frozenset[str] = frozenset(
    {
        "smallest first",
        "pair each one with what it is",
        "put them back in order",
        "where does it sit on the line",
        "speed is the skill here, so this one runs against the clock.",
        "holding these by heart is the skill here, so this one asks for them fast.",
    }
)

_SORT_PROMPT = "smallest first"
_MATCH_PROMPT = "pair each one with what it is"
_SEQUENCE_PROMPT = "put them back in order"
_LINE_PROMPT = "where does it sit on the line"

_WHY: Mapping[str, str] = {
    "speed": "speed is the skill here, so this one runs against the clock.",
    "recall": "holding these by heart is the skill here, so this one asks for them fast.",
}

# --- where speed or recall is genuinely the skill -------------------------------------------------

#: A chapter whose whole difficulty is going faster at something already understood.
_SPEED_WORDS = frozenset(
    {
        "table",
        "tables",
        "times",
        "multiplication",
        "division",
        "arithmetic",
        "mental",
        "conversion",
        "conversions",
        "convert",
        "unit",
        "units",
        "fraction",
        "fractions",
        "decimal",
        "decimals",
        "percentage",
        "percentages",
        "ratio",
        "ratios",
        "balancing",
        "rounding",
        "counting",
        "factorisation",
        "factorization",
    }
)

#: A chapter whose whole difficulty is holding a set of named things by heart.
_RECALL_WORDS = frozenset(
    {
        "symbol",
        "symbols",
        "date",
        "dates",
        "formula",
        "formulae",
        "formulas",
        "name",
        "names",
        "naming",
        "nomenclature",
        "vocabulary",
        "term",
        "terms",
        "definition",
        "definitions",
        "classification",
        "valency",
        "valencies",
        "chronology",
        "timeline",
        "spelling",
        "prefix",
        "prefixes",
        "suffix",
        "suffixes",
        "periodic",
    }
)


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z]+", str(text).lower()))


#: A year, written the way a chapter writes one. Four digits between 1000 and 2999, so a page
#: number, a count and a measurement are not mistaken for a date.
_YEAR = re.compile(r"\b(?:1[0-9]{3}|2[0-9]{3})\b")

#: How many dated things make a chronology rather than a passing mention of a year.
_DATES_FOR_A_CHRONOLOGY = 3

#: How many term-and-meaning pairs make a set worth holding by heart.
_PAIRS_FOR_A_SET = 4


def _material_of(course: Mapping[str, Any]) -> str:
    """Every word of the rendering the arcade may look at. The boss's items are not among them."""
    parts: list[str] = [_s(course.get("topic"))]
    for card in course.get("cards") or []:
        if not isinstance(card, dict):
            continue
        for key in ("title", "idea", "reveal"):
            parts.append(_s(card.get(key)))
        book = card.get("workbook")
        if isinstance(book, dict):
            for item in book.get("items") or []:
                if isinstance(item, dict):
                    parts.append(_s(item.get("prompt")))
                    parts.extend(_s(step) for step in item.get("steps") or [])
    for item in course.get("workbook") or []:
        if isinstance(item, dict):
            parts.append(f"{_s(item.get('prompt'))} {_s(item.get('answer'))}")
    return " ".join(p for p in parts if p)


def _nature_of(course: Mapping[str, Any]) -> str | None:
    """What the CHAPTER is, read off the rendering rather than off its name.

    §2's chooser is "rules first, and a small model where rules cannot decide". This is still the
    rules half, and it decides on the thing itself:

    * an ORDER the learner can be asked to restore (an ``order`` workbook item, or a handful of
      years in the words) is a chronology, and holding a sequence is recall;
    * a SET OF NAMED THINGS (four or more flashcard pairs) is a set to hold, which is recall too.

    Everything else is None, which stays the ordinary answer: a bonus level nobody needed is worse
    than no bonus level (§7), and a chapter that is neither of these gets no door.
    """
    if len(_ordered_steps(course)) >= 1:
        return "recall"
    if len(_flashcards(course)) >= _PAIRS_FOR_A_SET:
        return "recall"
    if len(set(_YEAR.findall(_material_of(course)))) >= _DATES_FOR_A_CHRONOLOGY:
        return "recall"
    return None


def skill_of(name: str, course: Mapping[str, Any] | None = None) -> str | None:
    """Is speed or recall genuinely the skill in this chapter, or is a game just noise here?

    THE NAME FIRST, THEN THE CHAPTER. Recall is asked before speed on the name: "the periodic table
    symbols" is a set of names to hold, not a sum to do faster, and the word "table" in it is a
    picture rather than a drill.

    The ``course`` is the half that was missing until 2026-09-10, and the finding that added it is
    worth keeping written down: matching words in a TITLE, "dates" among them, meant the doc's own
    example — "dates and order", "the non-cooperation movement" — could never get a door, because
    a chapter title never says "dates". Two of the six mechanics had no chapter that could reach
    them. A rendering is asked what it IS instead, which is a rule as cheap as the other one and
    about the right thing.
    """
    words = _tokens(name)
    if words & _RECALL_WORDS:
        return "recall"
    if words & _SPEED_WORDS:
        return "speed"
    return _nature_of(course) if course else None


def stride_for(skill: str | None) -> int:
    """How often a door may appear. Where speed IS the skill it earns its place more often."""
    return 2 if skill == "speed" else 3


def door_positions(topics: int, *, every: int = 3) -> tuple[int, ...]:
    """The 1-based topic positions a side door sits AFTER.

    Never after the last topic: the boss level stays the summit and a door beside it would be a
    detour from the ending rather than a rest in the middle. A chapter of three or fewer has no
    middle to speak of, so it gets nothing.
    """
    if topics < 4 or every < 2:
        return ()
    return tuple(p for p in range(every, topics, every) if p < topics)


# --- reading the level rendering ------------------------------------------------------------------


def _s(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def _items(course: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every recall item the arcade may spend. The boss's own items are NOT among them."""
    out: list[dict[str, Any]] = []
    for raw in course.get("workbook") or []:
        if isinstance(raw, dict) and _s(raw.get("prompt")) and _s(raw.get("answer")):
            out.append(raw)
    return out


def _flashcards(course: Mapping[str, Any]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for card in course.get("cards") or []:
        if not isinstance(card, dict):
            continue
        deck = card.get("flashcards")
        if not isinstance(deck, dict):
            continue
        for entry in deck.get("cards") or []:
            if isinstance(entry, dict) and _s(entry.get("front")) and _s(entry.get("back")):
                pairs.append((_s(entry["front"]), _s(entry["back"])))
    return pairs


def _ordered_steps(course: Mapping[str, Any]) -> list[tuple[str, list[str]]]:
    """Every `order` workbook item a card carries: a prompt and the steps in their right order."""
    found: list[tuple[str, list[str]]] = []
    for card in course.get("cards") or []:
        if not isinstance(card, dict):
            continue
        book = card.get("workbook")
        if not isinstance(book, dict):
            continue
        for item in book.get("items") or []:
            if not isinstance(item, dict) or item.get("kind") != "order":
                continue
            steps = [_s(s) for s in item.get("steps") or [] if _s(s)]
            if len(steps) >= 2 and _s(item.get("prompt")):
                found.append((_s(item["prompt"]), steps[:6]))
    return found


_NUMBER = re.compile(r"^-?\d+(?:\.\d+)?$")


def _as_number(text: str) -> float | None:
    t = text.strip().replace(",", "")
    if _NUMBER.match(t):
        return float(t)
    frac = re.match(r"^(-?\d+)\s*/\s*(\d+)$", t)
    if frac and int(frac.group(2)) != 0:
        return int(frac.group(1)) / int(frac.group(2))
    return None


def _mcq(course: Mapping[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in _items(course):
        options = [_s(o) for o in item.get("options") or [] if _s(o)]
        answer = _s(item.get("answer"))
        if len(options) >= 2 and answer in options:
            out.append({"prompt": _s(item["prompt"]), "answer": answer, "options": options})
    return out


def material_text(course: Mapping[str, Any]) -> str:
    """Every word of the level rendering a bonus level is allowed to be built out of.

    The boss is deliberately absent. If a string on a chip is not in here, somebody generated it,
    and a bonus level that costs a generation is not a template.
    """
    parts: list[str] = [_s(course.get("topic"))]
    for card in course.get("cards") or []:
        if isinstance(card, dict):
            parts.append(_walk_text(card))
    for item in course.get("workbook") or []:
        if isinstance(item, dict):
            parts.append(_walk_text(item))
    return "\n".join(p for p in parts if p)


def _walk_text(node: Any) -> str:
    if isinstance(node, str):
        return node
    if isinstance(node, Mapping):
        return "\n".join(_walk_text(v) for v in node.values())
    if isinstance(node, (list, tuple)):
        return "\n".join(_walk_text(v) for v in node)
    return ""


_STRUCTURAL = frozenset({"id", "game", "skill"})


def spec_strings(spec: Mapping[str, Any]) -> list[str]:
    """Every string in a spec that claims to come from the rendering.

    Structural fields and our own framing (``FRAMING``) are excluded: they are a fixed, reviewed
    vocabulary of six phrases, not content. Everything else must be traceable to the course.
    """
    found: list[str] = []

    def walk(node: Any, key: str | None) -> None:
        if isinstance(node, str):
            if key not in _STRUCTURAL and node not in FRAMING and node.strip():
                found.append(node)
        elif isinstance(node, Mapping):
            for k, v in node.items():
                walk(v, str(k))
        elif isinstance(node, (list, tuple)):
            for v in node:
                walk(v, key)

    walk(spec, None)
    return found


# --- building each mechanic from the material -----------------------------------------------------


def _rid(n: int) -> str:
    return f"r{n + 1}"


def _build_catch(course: Mapping[str, Any]) -> list[dict[str, Any]] | None:
    rounds = [
        {
            "id": _rid(i),
            "prompt": m["prompt"],
            "answer": m["answer"],
            "distractors": [o for o in m["options"] if o != m["answer"]][:3],
        }
        for i, m in enumerate(_mcq(course)[:8])
    ]
    return rounds if len(rounds) >= 2 else None


def _build_quiz(course: Mapping[str, Any]) -> list[dict[str, Any]] | None:
    rounds = [
        {"id": _rid(i), "prompt": m["prompt"], "answer": m["answer"], "options": m["options"]}
        for i, m in enumerate(_mcq(course)[:10])
    ]
    return rounds if len(rounds) >= 2 else None


def _build_match(course: Mapping[str, Any]) -> list[dict[str, Any]] | None:
    pairs = _flashcards(course)
    if len(pairs) < 2:
        pairs = [
            (_s(i["prompt"]), _s(i["answer"]))
            for i in _items(course)
            if not i.get("options") and len(_s(i["answer"])) <= 24
        ]
    if len(pairs) < 2:
        return None
    chunk = pairs[:5]
    return [
        {
            "id": _rid(0),
            "prompt": _MATCH_PROMPT,
            "pairs": [{"left": left, "right": right} for left, right in chunk],
        }
    ]


def _numbers(course: Mapping[str, Any]) -> list[tuple[str, float, str]]:
    """(the answer as written, its value, the prompt it answered) for every numeric answer."""
    seen: dict[str, tuple[str, float, str]] = {}
    for item in _items(course):
        answer = _s(item.get("answer"))
        value = _as_number(answer)
        if value is not None and answer not in seen:
            seen[answer] = (answer, value, _s(item["prompt"]))
    return list(seen.values())


def _build_sort(course: Mapping[str, Any]) -> list[dict[str, Any]] | None:
    values = _numbers(course)
    if len(values) < 3:
        return None
    chips = [text for text, _, _ in sorted(values, key=lambda v: v[1])][:5]
    return [{"id": _rid(0), "prompt": _SORT_PROMPT, "order": chips}]


def _round_up(value: float) -> float:
    """A line a learner can read: the next 1, 10 or 100 above the biggest value on it."""
    for step in (1, 5, 10, 20, 50, 100, 500, 1000):
        if value <= step:
            return float(step)
    return float(int(value) + 1)


def _build_numberline(course: Mapping[str, Any]) -> list[dict[str, Any]] | None:
    values = _numbers(course)
    if len(values) < 3:
        return None
    top = _round_up(max(v for _, v, _ in values))
    low = min(0.0, min(v for _, v, _ in values))
    span = top - low
    if span <= 0:
        return None
    # Tight enough that a careless tap misses, wide enough that a finger at 390 can land it.
    tolerance = round(span * 0.05, 6)
    return [
        {
            "id": _rid(i),
            "prompt": prompt or _LINE_PROMPT,
            "target": value,
            "min": low,
            "max": top,
            "tolerance": tolerance,
        }
        for i, (_text, value, prompt) in enumerate(values[:8])
    ]


def _build_sequence(course: Mapping[str, Any]) -> list[dict[str, Any]] | None:
    found = _ordered_steps(course)
    if not found:
        return None
    return [
        {"id": _rid(i), "prompt": prompt, "steps": steps} for i, (prompt, steps) in enumerate(found)
    ]


_BUILDERS = {
    "catch": _build_catch,
    "sort": _build_sort,
    "match": _build_match,
    "numberline": _build_numberline,
    "sequence": _build_sequence,
    "quiz": _build_quiz,
}


def buildable_games(course: Mapping[str, Any]) -> tuple[str, ...]:
    """Which of the six this rendering actually has the material for. Never a forced fit."""
    return tuple(g for g in ARCADE_GAMES if _BUILDERS[g](course))


#: The clock, where the mechanic has one. Catch falls at its own pace and the sequence teaches
#: rather than races, so neither is timed.
_SECONDS: Mapping[str, int] = {"sort": 45, "match": 60, "numberline": 40, "quiz": 60}


def _seed(text: str) -> int:
    h = 2166136261
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


def plan_arcade(
    course: Mapping[str, Any],
    topics: Sequence[str],
    *,
    chapter: str,
) -> list[dict[str, Any]]:
    """The chapter's side doors: where each one sits, which game it plays, and why it is there.

    Zero model calls. Every door is a template filled from ``course``, which the learner's first
    visit already paid for, so the second learner and the hundredth play for nothing.
    """
    skill = skill_of(chapter, course)
    if skill is None:
        return []
    spots = door_positions(len(topics), every=stride_for(skill))
    if not spots:
        return []
    games = buildable_games(course)
    if not games:
        return []
    # The same game on two chapters should read like two games, so the rotation starts at a place
    # this chapter's own name decides.
    start = _seed(chapter) % len(games)
    order = [games[(start + i) % len(games)] for i in range(len(games))]

    doors: list[dict[str, Any]] = []
    for i, after in enumerate(spots):
        if i >= len(order):
            break  # a door with no game left to play is no door at all
        game = order[i]
        rounds = _BUILDERS[game](course)
        if not rounds:
            continue
        spec: dict[str, Any] = {
            "id": f"bonus-{after}-{game}",
            "title": _s(course.get("topic")) or chapter,
            "game": game,
            "skill": skill,
            "rounds": rounds[:12],
        }
        seconds = _SECONDS.get(game)
        if seconds:
            spec["seconds"] = seconds
        verified = verify_arcade(spec)
        if verified is None:
            continue
        doors.append({"after": after, "why": _WHY[skill], "skill": skill, "spec": verified})
    return doors


# --- the gate -------------------------------------------------------------------------------------


def _nes(v: Any) -> bool:
    return isinstance(v, str) and v.strip() != ""


def _strs(v: Any, least: int = 1) -> list[str] | None:
    if not isinstance(v, list):
        return None
    out = [s for s in v if _nes(s)]
    return out if len(out) >= least else None


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    return float(v) if isinstance(v, (int, float)) else None


def _ok_catch(r: Mapping[str, Any]) -> bool:
    return bool(_nes(r.get("answer")) and _strs(r.get("distractors")))


def _ok_quiz(r: Mapping[str, Any]) -> bool:
    options = _strs(r.get("options"), 2)
    return bool(options and _nes(r.get("answer")) and r["answer"] in options)


def _ok_sort(r: Mapping[str, Any]) -> bool:
    order = _strs(r.get("order"), 2)
    return bool(order and len(set(order)) == len(order) and len(order) <= 6)


def _ok_match(r: Mapping[str, Any]) -> bool:
    raw = r.get("pairs")
    if not isinstance(raw, list) or not 2 <= len(raw) <= 6:
        return False
    return all(isinstance(p, Mapping) and _nes(p.get("left")) and _nes(p.get("right")) for p in raw)


def _ok_line(r: Mapping[str, Any]) -> bool:
    target, low, high = _num(r.get("target")), _num(r.get("min")), _num(r.get("max"))
    tolerance = _num(r.get("tolerance"))
    if target is None or low is None or high is None or tolerance is None:
        return False
    span = high - low
    if span <= 0 or not low <= target <= high:
        return False
    # A tolerance wide enough to swallow the line means no tap can be wrong, which is the exact
    # thing the judges scored 1.12 for. A quarter of the line is the ceiling.
    return 0 < tolerance <= span * 0.25


def _ok_sequence(r: Mapping[str, Any]) -> bool:
    steps = _strs(r.get("steps"), 2)
    return bool(steps and len(set(steps)) == len(steps) and len(steps) <= 6)


_ROUND_GATES = {
    "catch": _ok_catch,
    "quiz": _ok_quiz,
    "sort": _ok_sort,
    "match": _ok_match,
    "numberline": _ok_line,
    "sequence": _ok_sequence,
}


def verify_arcade(raw: Any) -> dict[str, Any] | None:
    """The served shape, or nothing. A refused spec is dropped and the card still stands.

    A spec with no ``game`` is the catch that shipped in wave 32, so an already-cached arcade keeps
    playing. A game we do not render is refused outright rather than passed to a client that would
    have to guess.
    """
    if not isinstance(raw, Mapping):
        return None
    game = raw.get("game", "catch")
    if not isinstance(game, str) or game not in ARCADE_GAMES:
        return None
    gate = _ROUND_GATES[game]
    rounds: list[dict[str, Any]] = []
    for entry in raw.get("rounds") or []:
        if not isinstance(entry, Mapping) or not _nes(entry.get("prompt")):
            return None
        if not gate(entry):
            return None
        rounds.append(dict(entry))
    if not 1 <= len(rounds) <= 12:
        return None
    skill = raw.get("skill")
    out: dict[str, Any] = {
        "id": _s(raw.get("id")) or "arcade",
        "title": _s(raw.get("title")) or _s(raw.get("topic")) or "bonus level",
        "game": game,
        "skill": skill if skill in ARCADE_SKILLS else "recall",
        "rounds": rounds,
    }
    seconds = _num(raw.get("seconds"))
    if seconds is not None and 10 <= seconds <= 180:
        out["seconds"] = int(seconds)
    return out


def floor_level(course: Mapping[str, Any], concept: str) -> dict[str, Any] | None:
    """One bonus level for this course, or nothing. The template floor of §2 and §7.

    Nothing is generated: the level is filled from the course that has already been verified, and
    the boss's own items are not among the material. `None` is the ordinary answer, because most
    concepts are not ones where going faster is the skill.
    """
    skill = skill_of(concept, course)
    if skill is None:
        return None
    games = buildable_games(course)
    if not games:
        return None
    game = games[_seed(concept) % len(games)]
    rounds = _BUILDERS[game](course)
    if not rounds:
        return None
    spec: dict[str, Any] = {
        "id": f"bonus-floor-{game}",
        "title": _s(course.get("topic")) or concept,
        "game": game,
        "skill": skill,
        "rounds": rounds[:12],
    }
    seconds = _SECONDS.get(game)
    if seconds:
        spec["seconds"] = seconds
    return verify_arcade(spec)


def games_in(plan: Iterable[Mapping[str, Any]]) -> list[str]:
    """The games a plan plays, in order. Two doors in one chapter must never be the same game."""
    return [str(d["spec"]["game"]) for d in plan]
