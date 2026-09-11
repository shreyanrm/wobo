"""THE GATE ON THE ONE STORE THAT CARRIES FREE PROSE TO EVERY CHILD.

docs/CACHES.md §2: *"a cached row is re-sanitised and re-linted on every read (wave 31), so a
poisoned row is refused."* The level store honours that — ``engines._cache_read_refusals`` runs on
every cache read. The TURN store, the only one of the five wired end to end, did not: ``save`` was
called with no score and no status, ``db.LIVE`` serves a provisional row, and ``load`` stitched the
name, re-anchored the plan and served whatever a model said that minute. The first learner to ask
"why is the sky blue" at CBSE class 6 wrote the answer every later learner reads, em dash,
narration and all, and nothing ever looked at it again.

And the key. The docstring justified keeping the child's AGE in the packet with *"age, grade and
board are the LEVEL, which is in the key already: every learner who reaches this row shares them."*
Grade and board were in the key. Age was not, and it was not taken out of the say either, so an
answer written for an eleven-year-old ("at eleven you have probably noticed...") was served to a
thirteen-year-old in the same class.

Both halves are asserted here on the ROW and on what ``load`` hands back, never on a boolean.
"""

from __future__ import annotations

from typing import Any

import pytest
from store_fakes import FakePostgrest
from wobo_gateway import generic_turn
from wobo_gateway.plexus import db


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakePostgrest:
    monkeypatch.delenv("PLEXUS_STORES", raising=False)
    transport = FakePostgrest()
    db.reset()
    db.configure(base_url="https://db.test", service_key="service-role", transport=transport)
    yield transport
    db.reset()


def packet(*, age: Any = None, question: str = "Why is the sky blue?") -> dict[str, Any]:
    context: dict[str, Any] = {
        "turn": {"lastUserInput": question},
        "curriculum": {
            "board": "CBSE",
            "grade": "Class 6",
            "subject": "Science",
            "nodeName": "Light and colour",
        },
        "page": {"route": "course"},
    }
    if age is not None:
        context["lifetime"] = {"learner": {"name": "Learner-A", "age": age, "grade": "Class 6"}}
    return {"context": context}


CLEAN = {"say": "Blue light bounces around the air more than red does.", "actions": []}


# --- 1. the age, which is not the level -------------------------------------------------------


def test_two_ages_in_one_class_are_two_rows() -> None:
    """The docstring's own justification, made true: what is not in the key is not shared."""
    eleven = generic_turn.key_for(packet(age=11))
    thirteen = generic_turn.key_for(packet(age=13))
    assert eleven and thirteen
    assert eleven != thirteen


def test_an_answer_written_at_eleven_is_never_served_at_thirteen(fake: FakePostgrest) -> None:
    at_eleven = {
        "say": "At eleven you have probably noticed the sky changes colour.",
        "actions": [],
    }
    assert generic_turn.save(packet(age=11), at_eleven) is True
    assert generic_turn.load(packet(age=11)) is not None
    assert generic_turn.load(packet(age=13)) is None


def test_the_level_is_still_shared_by_everyone_who_shares_it(fake: FakePostgrest) -> None:
    """Age fragments the key; board, grade and the question do not. The saving survives."""
    assert generic_turn.save(packet(age=11), CLEAN) is True
    other_child = packet(age=11)
    other_child["context"]["lifetime"]["learner"]["name"] = "Learner-B"
    served = generic_turn.load(other_child)
    assert served is not None and served["cached"] is True


# --- 2. the gate, at both doors ---------------------------------------------------------------

BROKEN = [
    ("an em dash a learner reads", "The sky is blue — the air scatters blue light."),
    ("an exclamation mark", "The sky is blue because the air scatters it!"),
    ("narration", "I'll draw the sunlight for you and circle the blue part."),
    ("machinery", '{"path":"visualization","say":"the sky is blue"}'),
]


@pytest.mark.parametrize(("why", "say"), BROKEN, ids=[w for w, _ in BROKEN])
def test_a_line_that_breaks_the_law_is_never_written(
    fake: FakePostgrest, why: str, say: str
) -> None:
    """Written once and served forever is exactly why the check belongs BEFORE the write."""
    assert generic_turn.refusals({"say": say}), why
    assert generic_turn.save(packet(age=11), {"say": say, "actions": []}) is False
    assert fake.rows.get("turns", []) == []


def test_a_poisoned_row_already_in_the_store_is_refused_on_the_read(fake: FakePostgrest) -> None:
    """The row was written before this gate existed, or by a hand at the database. Same answer."""
    assert generic_turn.save(packet(age=11), CLEAN) is True
    fake.rows["turns"][0]["body"]["say"] = "The sky scatters blue — and that is why!"
    assert generic_turn.load(packet(age=11)) is None


def test_a_script_in_a_stored_answer_is_refused(fake: FakePostgrest) -> None:
    """The say reaches a screen. A row carrying markup is a row somebody tampered with."""
    assert generic_turn.save(packet(age=11), CLEAN) is True
    fake.rows["turns"][0]["body"]["say"] = "Blue light bounces <script>fetch('/steal')</script>"
    assert generic_turn.load(packet(age=11)) is None


def test_a_rejected_row_is_not_served(fake: FakePostgrest) -> None:
    """``db.LIVE`` serves provisional rows, so the status a caller passes has to mean something."""
    assert generic_turn.save(packet(age=11), CLEAN, status=db.REJECTED) is False
    assert fake.rows.get("turns", []) == []


def test_a_clean_answer_still_goes_through_both_doors(fake: FakePostgrest) -> None:
    assert generic_turn.refusals(CLEAN) == []
    assert generic_turn.save(packet(age=11), CLEAN, model="luna", cost_usd=0.0012) is True
    served = generic_turn.load(packet(age=11))
    assert served is not None
    assert served["say"] == CLEAN["say"]
    assert fake.rows["turns"][0]["cost_usd"] == 0.0012
