"""A RULE THAT READS A TITLE IS NOT A RULE ABOUT THE CHAPTER.

docs/CONTENT-INTERACTION.md §7 names "dates and order" as a place a bonus level belongs, and §2
lists "build the sequence" among the six mechanics. ``skill_of`` could not reach either of them:
it matched words in the chapter's NAME, ``_RECALL_WORDS`` carries "dates", and a chapter title
never says "dates". Probed live against fourteen real chapter names on 2026-09-10, four got a door
(equivalent fractions, multiplication tables, unit conversions, the periodic table) and "the
non-cooperation movement" and "the French Revolution" got nothing, which is precisely backwards:
the ordering chapters are the ones whose titles carry no keyword, so "build the sequence" and
"defend the number line" had no chapter that could ever reach them.

§2's rule is "rules first, and a small model where rules cannot decide". The model half is not
built, and a rule that cannot decide was answering NO. What it does now instead is read the
CHAPTER, not its name: a rendering that carries a chronology, an order to be restored, or a set of
named things to hold, IS a chapter where order or recall is the skill, whatever it is called. That
is still a rule, it still costs nothing, and it is about the thing itself.
"""

from __future__ import annotations

from typing import Any

import pytest
from wobo_gateway.plexus import arcade

# --- the titles that always worked, and must go on working -------------------------------------

BY_NAME = [
    ("multiplication tables", "speed"),
    ("unit conversions", "speed"),
    ("equivalent fractions", "speed"),
    ("the periodic table", "recall"),
]

#: A chapter where a game would be noise. No is the ordinary answer and it must stay ordinary.
QUIET = ["light reflection and refraction", "linear equations in one variable", "the human eye"]


@pytest.mark.parametrize(("name", "skill"), BY_NAME)
def test_a_title_that_says_the_skill_still_says_it(name: str, skill: str) -> None:
    assert arcade.skill_of(name) == skill


@pytest.mark.parametrize("name", QUIET)
def test_a_chapter_that_wants_no_game_still_gets_none(name: str) -> None:
    assert arcade.skill_of(name) is None
    assert arcade.skill_of(name, course={"cards": [], "workbook": []}) is None


# --- the chapters the rule could never reach ---------------------------------------------------


def _chronology() -> dict[str, Any]:
    """A history rendering: a card whose workbook asks for the order of dated events."""
    return {
        "topic": "the non-cooperation movement",
        "cards": [
            {
                "id": "c1",
                "title": "What happened, and when",
                "workbook": {
                    "items": [
                        {
                            "kind": "order",
                            "prompt": "put these back in the order they happened",
                            "steps": [
                                "the Rowlatt Act, 1919",
                                "Jallianwala Bagh, 1919",
                                "the movement is called off, 1922",
                            ],
                        }
                    ]
                },
            }
        ],
        "workbook": [
            {"type": "fill", "prompt": "the movement was called off in ________.", "answer": "1922"}
        ],
        "boss": [],
    }


def test_a_chronology_gets_its_door_however_the_chapter_is_titled() -> None:
    """ "the non-cooperation movement" carries no keyword and never will. The chapter does."""
    assert arcade.skill_of("the non-cooperation movement") is None
    assert arcade.skill_of("the non-cooperation movement", course=_chronology()) == "recall"


def test_the_sequence_mechanic_is_now_reachable() -> None:
    """Two of the six had no chapter that could reach them. This is the one that proves it."""
    course = _chronology()
    assert "sequence" in arcade.buildable_games(course)
    doors = arcade.plan_arcade(
        course,
        [f"t{i}" for i in range(1, 13)],
        chapter="the non-cooperation movement",
    )
    assert doors, "a chapter of dated events got no side door"
    assert any(d["spec"]["game"] == "sequence" for d in doors), [d["spec"]["game"] for d in doors]
    assert all(d["spec"]["skill"] in arcade.ARCADE_SKILLS for d in doors)


def test_a_rendering_with_no_order_and_no_names_still_gets_nothing() -> None:
    """The nature test is a test, not a licence: an ordinary lesson is still an ordinary lesson."""
    plain = {
        "topic": "why the sky is blue",
        "cards": [{"id": "c1", "title": "the sky", "idea": "blue light scatters more"}],
        "workbook": [{"type": "mcq", "prompt": "why?", "options": ["a", "b"], "answer": "a"}],
        "boss": [],
    }
    assert arcade.skill_of("why the sky is blue", course=plain) is None
    assert arcade.plan_arcade(plain, ["t1", "t2", "t3", "t4"], chapter="why the sky is blue") == []


def test_the_floor_reaches_the_chapters_the_doc_names() -> None:
    """``_floor_arcade`` asks the same question about the same course, so both agree."""
    from wobo_gateway.plexus import engines

    course = _chronology()
    # A card with nothing else on it, because a bonus level never displaces the teaching format
    # the model chose for a beat. This is the card the floor is allowed to land on.
    course["cards"].append(
        {
            "id": "c2",
            "kind": "text",
            "title": "What it changed",
            "idea": "one idea",
            "interaction": {"kind": "tap", "prompt": "tap it"},
            "reveal": "there it is",
        }
    )
    engines._floor_arcade(course, "the non-cooperation movement")
    assert any("arcade" in c for c in course["cards"])
