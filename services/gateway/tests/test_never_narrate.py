"""NEVER NARRATE, the gateway half (DESIGN.md §0.x, ``docs/copy/voice.md`` §10c; owner 2026-09-08).

Wobo does; Wobo does not announce. The gateway's canned lines are the words a learner reads on a
keyless build and the floor under every live board turn, so they are held to the same test as a
screen: if the line were removed, would the learner lose anything about the SUBJECT? A line that
only says what Wobo is, or what Wobo is about to do, or that a thing is not there yet, fails.

What is scanned:

- every string literal in ``wobo.py`` and ``board/*.py`` that is (or is joined into) a value under
  a ``say`` or ``why`` key, or one of the canned tables (``_MOCK_SAY``, ``_BOARD_SAY``,
  ``SILENT_BOARD_SAY``, ``WOBO_NO_GENDER``), found by walking the AST so comments, docstrings and
  the prompts, where the law is explained by quoting what it forbids, are never the place it is
  enforced;
- the persona and system prompts, for a self-introduction Wobo would be told to say verbatim.

Every allowance carries a reason. An entry without one is the law being repealed quietly.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from wobo_gateway import wobo

SRC = Path(wobo.__file__).resolve().parent
FILES = [
    SRC / "wobo.py",
    *sorted((SRC / "board").glob("*.py")),
    # The other places a learner reads the gateway's words: an error's message, a spent
    # allowance's line, and the account emails.
    SRC / "app.py",
    SRC / "budget.py",
    SRC / "email_templates.py",
]
#: Files where every string literal is copy a learner reads (an email is nothing but).
ALL_STRINGS = {"email_templates.py"}

#: (name, pattern). Deliberately narrow: a copy gate that cries wolf gets deleted.
SHAPES: list[tuple[str, re.Pattern[str]]] = [
    ("Wobo introducing itself", re.compile(r"\bI(?:'m| am) Wobo\b", re.IGNORECASE)),
    ("Wobo describing what it is", re.compile(r"\byour AI wobot\b", re.IGNORECASE)),
    ("Wobo describing its senses", re.compile(r"\bI can see\b")),
    ("Wobo describing its senses", re.compile(r"\bI am watching\b")),
    ("Wobo describing what it will be", re.compile(r"\bi'll be the one\b", re.IGNORECASE)),
    ("the seed of a conversation", re.compile(r"\bAsk me anything\.")),
    ("Wobo announcing that an action is coming", re.compile(r"\bSay the word and it's done\b")),
    (
        "Wobo narrating what it is doing",
        re.compile(r"\bWobo is (?:drawing|thinking|writing|composing|animating|reading|still)\b"),
    ),
    (
        "announcing an action",
        re.compile(r"\b[Ll]et me (?:draw|show|build|put this|come back|take you|walk you)\b"),
    ),
    (
        "promising an action",
        re.compile(r"\bI(?:'ll| will) (?:draw|show|help|take you|build|label|compose|walk you)\b"),
    ),
    ("a caption about the drawing, not the idea", re.compile(r"\b[Dd]rawn for you\b")),
    ("made for you", re.compile(r"\bmade this just for you\b", re.IGNORECASE)),
    ("a placeholder concept", re.compile(r"^this idea$")),
    ("Wobo claiming the drawing", re.compile(r"\bwhat I have put on the board\b")),
    ("a mode narrating itself", re.compile(r"\b\w[\w-]* mode · ")),
]

#: (file name, exact matched text, reason).
ALLOWED: list[tuple[str, str, str]] = [
    (
        "email_templates.py",
        "I'm Wobo",
        "the account-created email is the first meeting, like the sign-up door: said once, to "
        "someone who has not met Wobo, in a message whose subject is the account itself. The "
        "capital I is docs/MAIL-PRIMARY.md: a lowercase i for Wobo reads as a mail-merge artefact",
    ),
]


SPOKEN_TABLES = {
    "_MOCK_SAY",
    "_BOARD_SAY",
    "SILENT_BOARD_SAY",
    "WOBO_NO_GENDER",
    "_EXHAUSTED",
    # wave 46, finding 3: the honest keyless answers are read by a learner like any other line.
    "_KEYLESS_INLINE",
}
SPOKEN_KEYS = {"say", "why", "message"}


def _strings_under(node: ast.AST) -> list[tuple[int, str]]:
    """Every string constant inside a node, f-string pieces included."""
    return [
        (n.lineno, n.value)
        for n in ast.walk(node)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
    ]


def _spoken_literals(path: Path) -> list[tuple[int, str]]:
    """The literals a learner can read: the canned tables, and every value under a ``say`` or
    ``why`` key in any dict the file builds. Found by walking the AST, so a docstring, a comment or
    a prompt that quotes a banned phrase in order to ban it is never scanned."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: list[tuple[int, str]] = []
    if path.name in ALL_STRINGS:
        return [
            (n.lineno, n.value)
            for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and len(n.value) > 12
        ]
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign)) and any(
            isinstance(t, ast.Name) and t.id in SPOKEN_TABLES
            for t in ([node.target] if isinstance(node, ast.AnnAssign) else node.targets)
        ):
            out.extend(_strings_under(node.value))
        elif isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values, strict=True):
                if isinstance(key, ast.Constant) and key.value in SPOKEN_KEYS:
                    out.extend(_strings_under(value))
    return out


def _hits() -> list[str]:
    hits: list[str] = []
    for path in FILES:
        for lineno, text in _spoken_literals(path):
            for name, pattern in SHAPES:
                m = pattern.search(text)
                if not m:
                    continue
                if any(a[0] == path.name and a[1] in m.group(0) for a in ALLOWED):
                    continue
                hits.append(f"{path.name}:{lineno}: [{name}] {text!r}")
    return hits


def test_every_allowance_carries_a_reason() -> None:
    for file, text, reason in ALLOWED:
        assert len(reason.strip()) > 20, (file, text)


def test_no_canned_line_narrates() -> None:
    assert _hits() == []


def test_wobo_is_never_told_to_introduce_itself() -> None:
    """The first words in a conversation are the learner's, and the answer is to those words. No
    prompt carries a self-introduction to say verbatim, and no keyless turn opens with one."""
    for prompt in (wobo.WOBO_PERSONA, wobo.WOBO_SYSTEM):
        assert "I'm Wobo" not in prompt
        assert "AI wobot. I'll" not in prompt
    assert not hasattr(wobo, "WOBO_INTRO")
    first = wobo.mock_wobo_turn(
        {"first_meeting": True, "context": {"turn": {"lastUserInput": "quiz me"}}}
    )
    assert "Wobo" not in first["say"]
    assert first["path"] == "component"


def test_the_mock_tables_say_nothing_about_wobo() -> None:
    for line in [*wobo._MOCK_SAY.values(), *wobo._BOARD_SAY.values()]:
        assert not re.search(r"\bI(?:'ll| will|'m| am| can)\b", line), line
        assert not re.search(r"\b[Ll]et me\b", line), line


def _keyless(text: str, node: str = "") -> dict:
    return wobo.mock_wobo_turn(
        {"context": {"turn": {"lastUserInput": text}, "curriculum": {"nodeName": node}}}
    )


def test_a_drawing_that_cannot_be_drawn_is_not_captioned(monkeypatch) -> None:
    """When the drawing does not arrive the turn is prose, and the words must not read a drawing
    that is not there ("start at the left and follow it across" with nothing on the board)."""
    monkeypatch.setattr(wobo, "_hydrate_viz", lambda *_a, **_k: None)
    out = _keyless("draw a triangle for me")
    assert out["path"] == "inline"
    assert "viz" not in out
    assert out["say"] != wobo._MOCK_SAY["visualization"]
    assert "follow" not in out["say"].lower()
    assert "triangle" in out["say"]


def test_a_drawing_that_is_there_is_read_by_its_subject() -> None:
    """"draw a triangle for me" used to split on "for" and draw, then caption, the concept "me"."""
    out = _keyless("draw a triangle for me")
    assert out["path"] == "visualization"
    assert out["viz"]["spec"]["caption"] == "triangle"
    assert "triangle" in out["say"].lower()
    assert " me " not in f" {out['say']} "


def test_an_action_turn_speaks_about_the_subject_not_the_action() -> None:
    out = _keyless("teach me fractions")
    assert out["path"] == "action"
    assert out["action"]["why"] == "You asked to learn fractions"
    assert "Say the word" not in out["say"]
    assert "fractions" in out["say"].lower()
    assert not re.search(r"\bI(?:'ll| will)\b", out["say"])


def test_a_keyless_inline_turn_is_about_the_topic_on_screen() -> None:
    """The one canned line used to be about algebra ("the step where you moved a term across")
    on every course. The words name the node the learner is on, or nothing in particular."""
    out = _keyless("hello", node="Photosynthesis")
    assert out["path"] == "inline"
    assert "photosynthesis" in out["say"].lower()
    assert "moved a term" not in out["say"]
    bare = _keyless("hello")
    assert "moved a term" not in bare["say"]
    assert "—" not in bare["say"]
