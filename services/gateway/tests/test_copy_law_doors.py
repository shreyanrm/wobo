"""THE COPY LAW AND THE DOOR LAW MAY NOT CONTRADICT EACH OTHER IN WRITING.

``docs/copy/voice.md`` calls itself law and says every writer reads it before writing a word.
``docs/DOORS-CLOSED.md`` is the owner's ruling of 2026-09-09 and it closed the door to new
accounts. For one wave both were true at once: voice.md §8 rule 6 still declared the product open
and retired the waiting-list door by name, and its §11 comparison table still gave the open door's
phrase as the CORRECT answer to a line that asks a reader to wait. Both were the exact inverse of
the law and of all 438 pages that had just been built, and nothing failed, because the copy scans
reach rules 1 to 4 only.

Two waves saw it and both declined it as somebody else's file. So it is held here instead: the
next writer who reads voice.md as law reads one that agrees with the door.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
VOICE = REPO / "docs/copy/voice.md"
DOOR_LAW = REPO / "docs/DOORS-CLOSED.md"


def voice() -> str:
    return VOICE.read_text()


def test_both_laws_are_where_this_test_says_they_are() -> None:
    assert VOICE.is_file() and DOOR_LAW.is_file()


def test_the_copy_law_does_not_declare_the_product_open() -> None:
    """Rule 6 read "We are open ... no surface may imply a waitlist". The door is shut and a
    waiting list is exactly what every public surface now carries."""
    text = voice()
    assert "We are open, and the call is" not in text
    assert not re.search(r"the promotional door is retired", text)


def test_the_copy_law_sends_a_writer_to_the_door_law() -> None:
    """A rule about which door to draw that does not name the file deciding it is a rule the next
    writer will get wrong."""
    assert "DOORS-CLOSED" in voice()


def test_the_copy_law_quotes_neither_door_by_hand() -> None:
    """Rule 6's own instruction: the phrase lives in one constant and every surface reads it
    there, so it can never drift apart across pages again. A law that quotes it has drifted."""
    text = voice()
    assert "Start free" not in text
    assert "Join the list" not in text


def test_the_comparison_table_does_not_answer_a_waitlist_with_an_open_door() -> None:
    """§11's rows are read as "write this instead". One row named asking a reader to wait as the
    mistake and the open door as the fix, which is now the wrong way round."""
    for line in voice().splitlines():
        if line.startswith("|") and re.search(r"\bwait\b|\bwaitlist\b|\bwaiting\b", line, re.I):
            assert "Start free" not in line, line
