"""The copy law, enforced (DESIGN.md §0, ``docs/copy/voice.md`` §8, owner 2026-09-04).

Four rules govern every word a reader can see, and three of them are mechanical enough to fail a
build on:

1. **No invented person.** Never a made-up learner, parent or teacher name. A real name reaches a
   page only as a variable the account fills, so an *example* of a name variable is a placeholder
   and never a person.
2. **No grade gate.** No class, grade, year or age range on a public surface — no floor, no
   ceiling, no span. "Every subject your board sets." Anyone may sign up and see for themselves.
3. **No raw allowance.** No count of questions a day, in digits or in words, and nothing sold as
   "unlimited". Free carries no multiplier; Pro is five times the free allowance, Max twenty.

The surfaces scanned are the ones a reader meets in words: every file in ``docs/copy/**``,
``docs/SITE.md``, the email templates, the suggestion chips the public site puts in a visitor's
mouth, the festival wish lines the hospitality engine sends, and law v5's live prototypes
(``design/prototypes/landing-v8.html`` and ``site-*.html``) — the pages every shipped surface is
ported from, so a name or a class range there reaches a screen by the next port.

Rule 1 reaches further still, into the gateway's own fixtures. That is where it broke: the same
invented child was the ``learner_name`` in every parent-link and hospitality test, the SDK's
default session display name, and a row in the dev seed. Rules 2 and 3 stop at the public
surfaces on purpose, because the catalogue's internal scope (CURRICULUM.md §11, grades 4 to 13)
has to be writable in the tests that hold it.

The patterns are deliberately narrow, because a copy gate that cries wolf gets deleted. Every one
of them is pinned in both directions by :func:`test_the_patterns_are_honest`: it asserts each
fires on the line the owner banned and stays silent on the neighbouring line that is legitimate.
No file is exempt — ``docs/copy/voice.md`` and ``docs/copy/README.md`` state these rules by
naming what they forbid rather than by quoting it, so they pass their own scan.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from wobo_gateway.ask_public import SUGGESTIONS

REPO = Path(__file__).resolve().parents[3]
COPY_DIR = REPO / "docs/copy"
SITE_MAP = REPO / "docs/SITE.md"
EMAIL_TEMPLATES = REPO / "services/gateway/src/wobo_gateway/email_templates.py"
FESTIVALS = REPO / "content/hospitality/festivals.json"
#: The gateway's own tests. A fixture is copy a reader can see the moment somebody pastes it into
#: a page, and this is exactly where the law leaked last: every parent-link and hospitality test
#: carried the same invented child as its ``learner_name``. This file is excluded because it
#: quotes the banned lines in order to ban them.
GATEWAY_TESTS = REPO / "services/gateway/tests"
#: Law v5's live reference set — the prototypes every surface is ported from. The superseded ones
#: (landing-v2 through v7, onboarding, app-v1, email-v1) are a design archive that renders nowhere
#: and are not scanned; these are the pages workers copy from, so a name here reaches a screen.
PROTOTYPES = REPO / "design/prototypes"
LIVE_PROTOTYPES = ("landing-v8.html", "site-*.html")


# --- what gets scanned ----------------------------------------------------------------------------


def _copy_files() -> list[Path]:
    return sorted(p for p in COPY_DIR.rglob("*.md") if p.is_file())


def _wish_lines() -> list[str]:
    """The lines the hospitality engine actually sends, plus every ``greeting_style`` example a
    writer would copy. The rest of the calendar is dates and sources, and scanning those would
    fire a range pattern on a festival's own two-day window."""
    data = json.loads(FESTIVALS.read_text(encoding="utf-8"))

    def examples(node: object) -> Iterator[str]:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in {"example", "greeting"} and isinstance(value, str):
                    yield value
                else:
                    yield from examples(value)
        elif isinstance(node, list):
            for value in node:
                yield from examples(value)

    return [w["text"] for w in data["rule_engine"]["wishes"]] + list(examples(data))


def _gateway_test_files() -> list[Path]:
    """Every gateway test but this one, which quotes the banned lines in order to ban them."""
    return sorted(
        p for p in GATEWAY_TESTS.rglob("test_*.py") if p.is_file() and p.name != Path(__file__).name
    )


def _live_prototype_files() -> list[Path]:
    """The prototypes law v5 points at. Superseded versions are an archive, not a surface."""
    found = {p for pattern in LIVE_PROTOTYPES for p in PROTOTYPES.glob(pattern) if p.is_file()}
    return sorted(found)


def _sources() -> list[tuple[str, str]]:
    """(label, text) for every surface under the law. The suggestions are joined into one blob so
    a chip is scanned exactly as a reader reads it."""
    out: list[tuple[str, str]] = []
    for path in _copy_files():
        out.append((str(path.relative_to(REPO)), path.read_text(encoding="utf-8")))
    for path in _live_prototype_files():
        out.append((str(path.relative_to(REPO)), path.read_text(encoding="utf-8")))
    out.append((str(SITE_MAP.relative_to(REPO)), SITE_MAP.read_text(encoding="utf-8")))
    out.append(
        (str(EMAIL_TEMPLATES.relative_to(REPO)), EMAIL_TEMPLATES.read_text(encoding="utf-8"))
    )
    chips = "\n".join(
        line
        for suggestions in SUGGESTIONS.values()
        for line in (suggestions.placeholder, *suggestions.questions)
    )
    out.append(("wobo_gateway/ask_public.py::SUGGESTIONS", chips))
    out.append(("content/hospitality/festivals.json::wishes", "\n".join(_wish_lines())))
    return out


# --- 1. no invented person ------------------------------------------------------------------------

# A denylist, not a heuristic: a heuristic over prose this dense would fire on "Poppins", "Outlook",
# "Telangana" and every other legitimate capital. These are the given names that actually reached
# the copy system, plus the ones the surrounding prototypes and fixtures use, so a paste from any
# of them fails here. Names that are also words the product legitimately says are left out on
# purpose (Ram and Krishna name festivals; Dev is a host).
INVENTED_NAMES = (
    "Aanya", "Aarav", "Aditi", "Advika", "Amit", "Ananya", "Anjali", "Anaya", "Arjun", "Asha",
    "Ayesha", "Deepak", "Diya", "Fatima", "Imran", "Isha", "Ishaan", "Kabir", "Karan", "Kavya",
    "Kiran", "Leela", "Manav", "Meera", "Myra", "Naina", "Neel", "Neha", "Nikhil", "Nisha",
    "Pooja", "Priya", "Reyansh", "Riya", "Rohan", "Saanvi", "Sanya", "Shreya", "Siya", "Sunita",
    "Tanvi", "Vihaan", "Vikram", "Varun", "Yash", "Zara", "Zoya",
)
NAME = re.compile(r"\b(?:{})\b".format("|".join(INVENTED_NAMES)))

# An example for a *person's* name variable must be a placeholder: an em dash, a parenthesised
# description, or the variable itself. Anything else is a person somebody invented. Variables that
# merely end in `_name` and name a thing — plan_name, unit_name, festival_name — are left alone,
# because "Pro" and "Quadrilaterals" are the honest examples for those.
_WHOSE = r"learner|parent|child|student|giver|recipient|payer|teacher"
_PERSON = rf"(?:(?:{_WHOSE})_)?(?:first_|last_)?name"
NAME_ROW = re.compile(rf"^\|\s*`({_PERSON})`\s*\|([^|]*)\|", re.M)
PLACEHOLDER = re.compile(r"^(?:—|-|\(.*\)|\{\{.*\}\}|\[.*\])$")


def _name_sources() -> list[tuple[str, str]]:
    """Where a *name* is banned: every reader-facing surface, plus the gateway's own fixtures.

    Rules 2 and 3 stop at the public surfaces, because a class range is only a gate when a
    visitor reads it — ``CURRICULUM.md`` §11 says in so many words that the catalogue covers
    grades 4 to 13, and the tests that hold it to that have to be able to write the number down.
    A name has no such internal use: the moment one exists in a fixture, somebody pastes it into
    a page, which is exactly how "Aanya" reached the landing copy, the SDK's default session and
    a dev seed at the same time.
    """
    return _sources() + [
        (str(path.relative_to(REPO)), path.read_text(encoding="utf-8"))
        for path in _gateway_test_files()
    ]


def test_no_invented_person_anywhere() -> None:
    hits = [
        f"{label}: {match.group(0)!r} in {line.strip()!r}"
        for label, text in _name_sources()
        for line in text.splitlines()
        if (match := NAME.search(line))
    ]
    assert not hits, "invented names in reader-facing copy (voice.md §8.1):\n" + "\n".join(hits)


def test_a_name_variable_example_is_a_placeholder() -> None:
    """The way the law broke last time: every email spec's variable table carried the same invented
    child as the sample value for ``first_name``. A sample is a shape, never a person."""
    hits = [
        f"{path.relative_to(REPO)}: `{variable}` example is {example.strip()!r}"
        for path in _copy_files()
        for variable, example in NAME_ROW.findall(path.read_text(encoding="utf-8"))
        if not PLACEHOLDER.match(example.strip())
    ]
    assert not hits, (
        "a name variable's example must be a placeholder — (from the account), {{variable}} or "
        "— and never an invented person (voice.md §8.1):\n" + "\n".join(hits)
    )


# --- 2. no grade gate -----------------------------------------------------------------------------

_LEVEL = r"class(?:es)?|grades?|years?|std|standards?"
_JOIN = r"to|through|until|up\s+to|–|—|-|\.\."

# "classes 4 to 12", "class 4 to class 12 or 13", "grades 4-12", "year 6 through year 11"
GRADE_SPAN = re.compile(
    rf"\b(?:{_LEVEL})\s*\.?\s*\d{{1,2}}\s*(?:{_JOIN})\s*(?:{_LEVEL})?\s*\d{{1,2}}\b", re.I
)
# a half-open gate is still a gate: "from around class 4", "up to class 12", "below class 4"
GRADE_BOUND = re.compile(
    rf"\b(?:from|up\s+to|below|above|under|over|beyond|starting\s+(?:at|from))\s+"
    rf"(?:about\s+|around\s+|roughly\s+)?(?:{_LEVEL})\s*\d{{1,2}}\b",
    re.I,
)
# the floor the owner named by hand: class 4 is only ever cited as the bottom of the band
GRADE_FLOOR = re.compile(r"\b(?:class(?:es)?|grades?)\s*4\b", re.I)
# "ages 9 to 18", "9 to 18 year olds"
AGE_SPAN = re.compile(
    rf"\bages?\s*\d{{1,2}}\s*(?:{_JOIN})\s*\d{{1,2}}\b"
    rf"|\b\d{{1,2}}\s*(?:{_JOIN})\s*\d{{1,2}}[\s-]*year[\s-]*olds?\b",
    re.I,
)
GRADE_GATES = (GRADE_SPAN, GRADE_BOUND, GRADE_FLOOR, AGE_SPAN)


def test_no_grade_or_age_range() -> None:
    hits = [
        f"{label}: {match.group(0)!r} in {line.strip()!r}"
        for label, text in _sources()
        for line in text.splitlines()
        for pattern in GRADE_GATES
        if (match := pattern.search(line))
    ]
    assert not hits, (
        "a class or age range gates who may sign up; say 'every subject your board sets' "
        "(voice.md §8.2):\n" + "\n".join(hits)
    )


# --- 3. no raw allowance --------------------------------------------------------------------------

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


def test_no_raw_allowance() -> None:
    hits = [
        f"{label}: {match.group(0)!r} in {line.strip()!r}"
        for label, text in _sources()
        for line in text.splitlines()
        for pattern in ALLOWANCE_RULES
        if (match := pattern.search(line))
    ]
    assert not hits, (
        "say what the allowance feels like, never how many: free carries no multiplier, Pro is "
        "five times the free allowance and Max twenty (voice.md §8.3):\n" + "\n".join(hits)
    )


# --- 4. drawing is one part -----------------------------------------------------------------------

OTHER_FORMS = ("film", "aloud", "out loud", "speak", "say it", "practice", "practise", "drag",
               "remember", "simulat")


def test_the_suggestion_chips_do_not_make_drawing_the_whole_product() -> None:
    """The chips are the only words Wobo puts in a visitor's mouth. If any of them mentions the
    board, another must name a different form, or the set sells a whiteboard (voice.md §8.5)."""
    chips = [
        line
        for suggestions in SUGGESTIONS.values()
        for line in (suggestions.placeholder, *suggestions.questions)
    ]
    blob = " ".join(chips).lower()
    if "draw" in blob:
        named = [form for form in OTHER_FORMS if form in blob]
        assert named, (
            "the suggestion chips mention drawing and nothing else Wobo does; name a film, a "
            "voice, a thing to drag or the practice that follows"
        )


# --- the gate's own honesty -----------------------------------------------------------------------


def test_the_scan_actually_reads_the_surfaces() -> None:
    """A path typo would make every test above pass on an empty corpus."""
    assert COPY_DIR.is_dir() and SITE_MAP.is_file() and EMAIL_TEMPLATES.is_file()
    assert GATEWAY_TESTS.is_dir() and PROTOTYPES.is_dir()
    labels = [label for label, _ in _name_sources()]
    assert len(_copy_files()) >= 30, labels
    assert len(_gateway_test_files()) >= 20, labels
    # landing-v8 plus the eight site pages: the whole live reference set, or the glob has rotted.
    assert len(_live_prototype_files()) >= 9, labels
    assert "wobo_gateway/ask_public.py::SUGGESTIONS" in labels
    assert "content/hospitality/festivals.json::wishes" in labels
    assert len(_wish_lines()) >= 13, "the twelve required wishes, at least"
    assert all(text.strip() for _, text in _sources())


@pytest.mark.parametrize(
    ("patterns", "banned", "allowed"),
    [
        pytest.param(
            (NAME,),
            ("Aanya has a test on Friday.", "| `first_name` | Aditi | |", "Hi Zara. I am Wobo."),
            (
                "Your child has a test on Friday.",
                "Poppins, Segoe UI, Helvetica Neue, Arial",
                "Hyderabad, Telangana. Prashasan Nagar, Jubilee Hills.",
                "Happy Ram Navami. Krishna Janmashtami.",
                "a local http dev host still renders",
                "Every subject your board sets.",
            ),
            id="invented-name",
        ),
        pytest.param(
            GRADE_GATES,
            (
                "For classes 4 to 12.",
                "from around class 4 to class 12 or 13, wherever a board has them",
                "One subject, from class 4 to 12",
                "Grades 4-12, every board.",
                "Class 4 to class 12 or 13, whatever your board calls them",
                "For ages 9 to 18.",
                "Built for 9 to 18 year olds.",
                "Below class 4 we do not pretend.",
            ),
            (
                "Every subject your board sets.",
                "class 9 CBSE, we are on quadrilaterals",
                "Wobo is set up for CBSE class 8",
                "Which chapter is my CBSE maths class on this week?",
                "COPPA under 13, GDPR-K",
                "plainly enough for a fourteen-year-old to understand it too",
                "We write to you 7 days before any renewal, and 30 days before as well",
                "Nothing at all is deleted for 30 days.",
            ),
            id="grade-gate",
        ),
        pytest.param(
            ALLOWANCE_RULES,
            (
                "Forty questions a day, every subject.",
                "40 questions a day",
                "Two hundred questions a day, and Wobo reads answers aloud.",
                "Eight hundred questions a day, so nobody counts.",
                "Pro gives you unlimited turns.",
                "twenty-five questions a day",
            ),
            (
                "A daily allowance, free, and it resets every morning.",
                "Five times the free allowance, every day.",
                "Twenty times the free allowance, every day, and a second learner.",
                "Free every day, a fresh allowance each morning, no card and no trial that ends.",
                "Ten minutes a day.",
                "One turn is one thing you ask Wobo.",
                "Never a count of questions.",
            ),
            id="raw-allowance",
        ),
    ],
)
def test_the_patterns_are_honest(
    patterns: tuple[re.Pattern[str], ...], banned: tuple[str, ...], allowed: tuple[str, ...]
) -> None:
    """Pinned in both directions: a gate that misses the violation is theatre, and a gate that
    fires on a legitimate line gets switched off by the first person it blocks."""
    for line in banned:
        assert any(p.search(line) for p in patterns), f"missed a banned line: {line!r}"
    for line in allowed:
        hit = next((p.search(line) for p in patterns if p.search(line)), None)
        assert hit is None, f"fired on a legitimate line: {line!r} matched {hit.group(0)!r}"  # type: ignore[union-attr]
