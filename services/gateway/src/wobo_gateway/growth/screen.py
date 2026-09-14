"""The copy screen: every word this desk would publish, held to the law before it leaves.

``docs/copy/voice.md`` is the law and ``services/gateway/tests/test_copy_law.py`` already enforces
it over the surfaces a person wrote by hand. Those surfaces are files in the tree, so a test can
read them. **This desk writes copy at run time**, so a test cannot, and a rule that only exists in
a test is no rule at all here. So the same law is a function, it runs on every piece and on every
shape before either can leave the desk, and ``test_growth_screen.py`` pins each pattern in both
directions exactly as the copy-law test does: it fires on the line the owner banned and stays
silent on the neighbouring line that is legitimate.

**Why the patterns are duplicated from the test rather than imported from it.** A test module is
not a place production code may import from, and inverting that (the test importing these) would
mean the gate on generated copy and the gate on written copy could drift apart silently. So the
rules are stated here once, and ``test_growth_screen.py`` asserts this module and the copy-law
test agree wherever both have a rule for the same thing. When they disagree the build says so by
name, which is the only arrangement where two copies of a law stay one law.

**What this screen is not.** It is not a taste check and it cannot be. It catches the mechanical
half: a banned mark, a shape of sentence the owner ruled out, a claim nobody cleared. The other
half is a person reading the line aloud, which ``docs/copy/voice.md`` section 12 asks for and
which no function replaces. The desk's approval queue is where that happens.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any

# --- 1. no invented person --------------------------------------------------------------------------
#: The names the copy law names. A piece about a chapter has no business carrying any of them, and
#: a generated example is exactly where one would appear.
INVENTED_NAMES = (
    "Aanya", "Aarav", "Aditi", "Advika", "Amit", "Ananya", "Anjali", "Anaya", "Arjun", "Asha",
    "Ayesha", "Deepak", "Diya", "Fatima", "Imran", "Isha", "Ishaan", "Kabir", "Karan", "Kavya",
    "Kiran", "Leela", "Manav", "Meera", "Myra", "Naina", "Neel", "Neha", "Nikhil", "Nisha",
    "Pooja", "Priya", "Reyansh", "Riya", "Rohan", "Saanvi", "Sanya", "Shreya", "Siya", "Sunita",
    "Tanvi", "Vihaan", "Vikram", "Varun", "Yash", "Zara", "Zoya",
)
NAME = re.compile(r"\b(?:{})\b".format("|".join(INVENTED_NAMES)))

# --- 2. no grade gate -------------------------------------------------------------------------------
# A SINGLE class is fine and is most of what a syllabus piece says: "class 10 mathematics". A
# RANGE is the gate, in either direction, and that is what these catch.
_LEVEL = r"class(?:es)?|grades?|years?|std|standards?"
_JOIN = r"to|through|until|up\s+to|–|—|-|\.\."
GRADE_SPAN = re.compile(
    rf"\b(?:{_LEVEL})\s*\.?\s*\d{{1,2}}\s*(?:{_JOIN})\s*(?:{_LEVEL})?\s*\d{{1,2}}\b", re.I
)
GRADE_BOUND = re.compile(
    rf"\b(?:from|up\s+to|below|above|under|over|beyond|starting\s+(?:at|from))\s+"
    rf"(?:about\s+|around\s+|roughly\s+)?(?:{_LEVEL})\s*\d{{1,2}}\b",
    re.I,
)
GRADE_FLOOR = re.compile(r"\b(?:class(?:es)?|grades?)\s*4\b", re.I)
AGE_SPAN = re.compile(
    rf"\bages?\s*\d{{1,2}}\s*(?:{_JOIN})\s*\d{{1,2}}\b"
    rf"|\b\d{{1,2}}\s*(?:{_JOIN})\s*\d{{1,2}}[\s-]*year[\s-]*olds?\b",
    re.I,
)
GRADE_GATES = (GRADE_SPAN, GRADE_BOUND, GRADE_FLOOR, AGE_SPAN)

# --- 3. no raw allowance ----------------------------------------------------------------------------
_ONES = (
    "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen"
    "|sixteen|seventeen|eighteen|nineteen"
)
_TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety"
_NUMBER = rf"\d{{1,5}}|(?:{_TENS})(?:[\s-](?:{_ONES}))?|{_ONES}"
_SCALE = r"(?:\s+(?:hundred|thousand))?"
_UNIT = r"questions?|turns?|asks?|prompts?|lessons?|boards?"
ALLOWANCE = re.compile(
    rf"\b(?:{_NUMBER}){_SCALE}\s+(?:{_UNIT})\s+(?:a|per|each|every)\s+(?:day|week|month)\b", re.I
)
UNLIMITED = re.compile(rf"\bunlimited\s+(?:{_UNIT}|allowance)\b", re.I)
ALLOWANCE_RULES = (ALLOWANCE, UNLIMITED)

# --- 4. never name a vendor (voice.md section 7) ------------------------------------------------------
#: Nobody reading Wobo can tell what is underneath. A generated piece is the likeliest place a
#: model name leaks, because the thing writing it knows its own.
VENDOR = re.compile(
    r"\b(openai|chatgpt|gpt-?[0-9]|anthropic|claude|gemini|llama|mistral|deepseek|"
    r"supabase|postgres|railway|vercel|cloudflare|razorpay|stripe|twilio|elevenlabs|"
    r"firebase|langchain)\b",
    re.I,
)

# --- 5. never narrate (voice.md section 10c) ---------------------------------------------------------
#: Wobo does; Wobo does not announce. The whole family of announcements, in the register a model
#: reaches for first.
NARRATION = re.compile(
    r"\b(let me (?:draw|show|explain|walk|take)|i(?:'ll| will) (?:draw|show|explain|walk|take|now)|"
    r"i can see|as you can see|drawn for you|here(?:'s| is) (?:a|the) (?:diagram|figure) (?:i|we) "
    r"(?:drew|made)|in this (?:article|post|piece)(?:,)? (?:we|i) (?:will|shall))\b",
    re.I,
)

# --- 6. no gendered pronoun for Wobo (voice.md section 1) ---------------------------------------------
#: Within a short reach of the name, in either order, which is how one gets in.
WOBO_GENDERED = re.compile(
    r"\bWobo\b[^.?!]{0,60}?\b(?:he|him|his|she|her|hers)\b"
    r"|\b(?:he|him|his|she|her|hers)\b[^.?!]{0,60}?\bWobo\b",
    re.I,
)

# --- 7. never name a late hour (voice.md section 8.7) -------------------------------------------------
LATE_HOUR = re.compile(
    r"\b(?:1[01]|9)\s*(?:pm|p\.m\.)\b|\bmidnight\b|\blate at night\b|\bpast midnight\b"
    r"|\bwhen everyone(?:'s| is) asleep\b|\bburning the midnight oil\b",
    re.I,
)

# --- 8. never sell by running anything down (voice.md section 8.8) ------------------------------------
RUNS_DOWN = re.compile(
    r"\b(?:better|cheaper|faster|smarter|more effective)\s+than\s+(?:a\s+|an\s+|your\s+|the\s+)?"
    r"(?:teacher|tutor|school|tuition|coaching|classroom|textbook|app|competitor)"
    r"|\b(?:unlike|instead of)\s+(?:a\s+|an\s+|your\s+|the\s+)?"
    r"(?:teacher|school|tuition centre|tuition center|coaching class)"
    r"|\b(?:teachers?|schools?)\s+(?:cannot|can't|never|do not|don't)\s+",
    re.I,
)

# --- 9. the marks and the marks alone -----------------------------------------------------------------
EM_DASH = "—"
EN_DASH = "–"
#: No exclamation marks anywhere (section 3). Counted rather than matched so the message can say
#: how many.
BANG = re.compile(r"!")


def has_emoji(text: str) -> bool:
    """Any pictograph. Uses the character's own Unicode category rather than a list, so a symbol
    nobody thought of is caught too. Latin, Devanagari and ordinary punctuation pass."""
    for char in text or "":
        if char in {"™", "©", "®"}:
            return True
        code = ord(char)
        if 0x1F000 <= code <= 0x1FAFF or 0x2600 <= code <= 0x27BF or 0xFE0F == code:
            return True
        if unicodedata.category(char) == "So" and code > 0x2000:
            return True
    return False


# --- 10. only claims CLAIMS.md has cleared -------------------------------------------------------------
#: The superlative and comparative shapes that are regulated advertising. A piece that reaches for
#: one is refused unless the whole sentence is a line ``docs/CLAIMS.md`` has already cleared.
SUPERLATIVE = re.compile(
    r"\b(?:world'?s\s+(?:first|only|best|leading)|the\s+only\s+(?:ai|app|tutor|platform|product)"
    r"|the\s+best\s+(?:ai|app|tutor|platform|way)|number\s+one\b|#1\b|india'?s\s+(?:first|only|best|leading)"
    r"|most\s+(?:popular|used|trusted|advanced)|fastest\s+growing|leading\s+(?:ai|app|platform))\b",
    re.I,
)
#: A promise about a result. ``docs/CLAIMS.md`` section 2 draws this line explicitly: a feeling is
#: puffery and is safe, a mark is a factual claim requiring evidence we do not have.
PROMISES_A_RESULT = re.compile(
    r"\b(?:guarantee[ds]?|guaranteed|assured)\b[^.?!]{0,40}\b(?:marks?|score|rank|result|grade)\b"
    r"|\b(?:improve|raise|boost|increase)\s+(?:your\s+|their\s+)?(?:marks?|score|rank|percentage)\b"
    r"|\b\d{1,3}\s*(?:%|per\s?cent|percent)\s+(?:improvement|increase|better|more)\b"
    r"|\btop(?:s)?\s+the\s+(?:class|exam|board)\b",
    re.I,
)

#: The exact lines ``docs/CLAIMS.md`` has cleared, in the wording that file settled on. A piece
#: may carry one of these verbatim and nothing else that reaches for a superlative. Compared
#: case-insensitively on collapsed whitespace, so a line break inside one still matches.
CLEARED_CLAIMS: tuple[str, ...] = (
    "the world's first ai companion that shows you",
    "fall in love with learning while studying",
)


def _collapsed(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _claim_is_cleared(sentence: str) -> bool:
    flat = _collapsed(sentence)
    return any(cleared in flat for cleared in CLEARED_CLAIMS)


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.?!])\s+|\n+", text or "") if s.strip()]


# --- the screen ----------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Violation:
    """One thing wrong, in words that go in front of a person. ``rule`` is for the trail."""

    rule: str
    says: str
    where: str

    def as_dict(self) -> dict[str, Any]:
        return {"rule": self.rule, "says": self.says, "where": self.where}


def _clip(text: str, width: int = 90) -> str:
    flat = re.sub(r"\s+", " ", (text or "").strip())
    return flat if len(flat) <= width else f"{flat[:width]}..."


def screen(text: str, *, where: str = "the piece") -> list[Violation]:
    """Every way this text breaks the copy law. Empty means it may be published.

    Returns every violation rather than the first, because a writer fixing one at a time is a
    writer making four round trips, and the console shows the whole list.
    """
    body = text or ""
    found: list[Violation] = []

    def add(rule: str, says: str) -> None:
        found.append(Violation(rule=rule, says=says, where=where))

    if (match := NAME.search(body)) is not None:
        add("invented-person", f"names an invented person: {match.group(0)}")
    for pattern in GRADE_GATES:
        if (match := pattern.search(body)) is not None:
            add("grade-gate", f"gates who may sign up: {match.group(0)!r}")
            break
    for pattern in ALLOWANCE_RULES:
        if (match := pattern.search(body)) is not None:
            add("raw-allowance", f"prints the allowance as a count: {match.group(0)!r}")
            break
    if (match := VENDOR.search(body)) is not None:
        add("vendor", f"names a provider: {match.group(0)}")
    if (match := NARRATION.search(body)) is not None:
        add("narrates", f"announces itself: {match.group(0)!r}")
    if (match := WOBO_GENDERED.search(body)) is not None:
        add("wobo-pronoun", f"gives Wobo a gender: {_clip(match.group(0), 60)!r}")
    if (match := LATE_HOUR.search(body)) is not None:
        add("late-hour", f"names a late hour: {match.group(0)!r}")
    if (match := RUNS_DOWN.search(body)) is not None:
        add("runs-down", f"sells by running something down: {match.group(0)!r}")
    if EM_DASH in body:
        add("em-dash", "carries an em dash, which nothing a reader sees may")
    if (count := len(BANG.findall(body))) :
        add("exclamation", f"carries {count} exclamation mark{'s' if count > 1 else ''}")
    if has_emoji(body):
        add("emoji", "carries an emoji, and nothing we publish does")
    for sentence in _sentences(body):
        if SUPERLATIVE.search(sentence) and not _claim_is_cleared(sentence):
            add("uncleared-claim", f"makes a claim docs/CLAIMS.md has not cleared: {_clip(sentence)}")
            break
    if (match := PROMISES_A_RESULT.search(body)) is not None:
        add("promises-a-result", f"promises a result we cannot evidence: {match.group(0)!r}")

    return found


def is_clean(text: str) -> bool:
    return not screen(text)


__all__ = [
    "ALLOWANCE_RULES",
    "BANG",
    "CLEARED_CLAIMS",
    "EM_DASH",
    "EN_DASH",
    "GRADE_GATES",
    "INVENTED_NAMES",
    "LATE_HOUR",
    "NAME",
    "NARRATION",
    "PROMISES_A_RESULT",
    "RUNS_DOWN",
    "SUPERLATIVE",
    "VENDOR",
    "WOBO_GENDERED",
    "Violation",
    "has_emoji",
    "is_clean",
    "screen",
]
