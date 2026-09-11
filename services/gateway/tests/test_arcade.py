"""THE ARCADE: bonus levels in the middle of the climb (docs/CONTENT-INTERACTION.md §7).

Six mechanics as templates, filled from the level rendering with zero model calls per play; a door
in the MIDDLE of a chapter, never at the end where the boss already stands; a bonus level only
where speed or recall is genuinely the skill.

Every test here holds one of the owner's rules in §7 or docs/LEVELS.md §1/§4. There is no model in
this file and no client: the whole arcade is code, which is the cost claim being proved.
"""

from __future__ import annotations

from typing import Any

import pytest
from wobo_gateway.plexus import arcade

# --- the material a bonus level is filled from ---------------------------------------------------


def _course() -> dict[str, Any]:
    """A level rendering the way engine.compose emits it (cards + workbook + boss)."""
    return {
        "topic": "multiplication tables",
        "difficulty": "core",
        "cards": [
            {
                "id": "c1",
                "kind": "text",
                "title": "the table of seven",
                "idea": "a table is repeated addition, written short.",
                "interaction": {"kind": "tap", "prompt": "tap the row for seven"},
                "reveal": "seven fours is twenty eight.",
                "flashcards": {
                    "id": "f1",
                    "title": "the sevens",
                    "cards": [
                        {"id": "k1", "front": "7 x 6", "back": "42"},
                        {"id": "k2", "front": "7 x 8", "back": "56"},
                        {"id": "k3", "front": "7 x 9", "back": "63"},
                    ],
                },
            },
            {
                "id": "c2",
                "kind": "text",
                "title": "the order of the steps",
                "idea": "a long multiplication runs in one order.",
                "interaction": {"kind": "tap", "prompt": "tap the first step"},
                "reveal": "units first, then tens.",
                "workbook": {
                    "id": "w1",
                    "title": "the order",
                    "items": [
                        {
                            "id": "i1",
                            "kind": "order",
                            "prompt": "put the steps of long multiplication in order",
                            "steps": ["multiply the units", "multiply the tens", "add the rows"],
                        }
                    ],
                },
            },
        ],
        "workbook": [
            {
                "id": "w1",
                "type": "mcq",
                "prompt": "what is 7 x 6",
                "options": ["42", "36", "48"],
                "answer": "42",
            },
            {
                "id": "w2",
                "type": "mcq",
                "prompt": "what is 7 x 8",
                "options": ["56", "54", "64"],
                "answer": "56",
            },
            {
                "id": "w3",
                "type": "fill",
                "prompt": "seven nines is ________",
                "answer": "63",
            },
            {
                "id": "w4",
                "type": "fill",
                "prompt": "seven sevens is ________",
                "answer": "49",
            },
        ],
        # Three, because `_verify_items` refuses fewer, and because the boss having its own words
        # is the whole reason a bonus level is never allowed to spend them.
        "boss": [
            {
                "id": "b1",
                "type": "mcq",
                "prompt": "what is 17 x 7",
                "options": ["119", "117", "129"],
                "answer": "119",
            },
            {
                "id": "b2",
                "type": "mcq",
                "prompt": "what is 23 x 7",
                "options": ["161", "151", "171"],
                "answer": "161",
            },
            {
                "id": "b3",
                "type": "fill",
                "prompt": "seven thirteens is ________",
                "answer": "91",
            },
        ],
    }


_DRILLABLE = [
    "multiplication tables",
    "unit conversion",
    "the periodic table symbols",
    "dates of the non-cooperation movement",
    "equivalent fractions",
    "balancing chemical equations",
]

_NOT_DRILLABLE = [
    "why the sky is blue",
    "the causes of the first world war",
    "writing a friendly letter",
    "the ethics of cloning",
]


# --- the menu ------------------------------------------------------------------------------------


def test_the_menu_is_the_owners_six_mechanics_and_no_others() -> None:
    """§7: catch, sort against the clock, match pairs, defend the number line, build the sequence,
    the running quiz with lives. Six, not one skin."""
    assert arcade.ARCADE_GAMES == ("catch", "sort", "match", "numberline", "sequence", "quiz")


# --- the spec gate -------------------------------------------------------------------------------


def _valid(game: str) -> dict[str, Any]:
    base: dict[str, Any] = {"id": "a1", "title": "the sevens", "game": game, "skill": "recall"}
    rounds: dict[str, list[dict[str, Any]]] = {
        "catch": [{"id": "r1", "prompt": "7 x 6", "answer": "42", "distractors": ["36", "48"]}],
        "quiz": [{"id": "r1", "prompt": "7 x 6", "answer": "42", "options": ["42", "36", "48"]}],
        "sort": [{"id": "r1", "prompt": "smallest first", "order": ["1/4", "1/3", "1/2"]}],
        "match": [
            {
                "id": "r1",
                "prompt": "pair each one with its answer",
                "pairs": [{"left": "7 x 6", "right": "42"}, {"left": "7 x 8", "right": "56"}],
            }
        ],
        "numberline": [
            {
                "id": "r1",
                "prompt": "where does three quarters sit",
                "target": 0.75,
                "min": 0.0,
                "max": 1.0,
                "tolerance": 0.06,
            }
        ],
        "sequence": [
            {
                "id": "r1",
                "prompt": "put the steps in order",
                "steps": ["multiply the units", "multiply the tens", "add the rows"],
            }
        ],
    }
    base["rounds"] = rounds[game]
    return base


@pytest.mark.parametrize("game", arcade.ARCADE_GAMES)
def test_every_mechanic_has_a_spec_the_gate_accepts(game: str) -> None:
    assert arcade.verify_arcade(_valid(game)) is not None


def test_a_spec_with_no_game_is_the_catch_that_already_shipped() -> None:
    """Wave 32's arcade carried no `game` field. It still plays, as catch."""
    old = {
        "id": "ar",
        "title": "catch it",
        "rounds": [{"id": "r1", "prompt": "2 + 2", "answer": "4", "distractors": ["3", "5"]}],
    }
    out = arcade.verify_arcade(old)
    assert out is not None and out["game"] == "catch"


@pytest.mark.parametrize(
    "game,mangle",
    [
        # a catch with nothing to dodge is not a game
        ("catch", lambda r: {**r, "distractors": []}),
        # a quiz whose answer is not on the board can never be tapped
        ("quiz", lambda r: {**r, "answer": "41"}),
        # one chip is not a sort
        ("sort", lambda r: {**r, "order": ["1/2"]}),
        # one pair is not a pairing
        ("match", lambda r: {**r, "pairs": [{"left": "7 x 6", "right": "42"}]}),
        # a target off the line cannot be defended
        ("numberline", lambda r: {**r, "target": 4.0}),
        # a tolerance that swallows the whole line means no tap can be wrong
        ("numberline", lambda r: {**r, "tolerance": 0.9}),
        # one step is not a sequence
        ("sequence", lambda r: {**r, "steps": ["multiply the units"]}),
    ],
)
def test_the_gate_refuses_a_round_that_does_not_fit_its_mechanic(game: str, mangle: Any) -> None:
    spec = _valid(game)
    spec["rounds"] = [mangle(spec["rounds"][0])]
    assert arcade.verify_arcade(spec) is None


def test_the_gate_refuses_a_mechanic_it_does_not_render() -> None:
    """Nothing generated executes on a learner's device: an unknown game is refused, not passed."""
    assert arcade.verify_arcade({**_valid("catch"), "game": "physics-platformer"}) is None


def test_a_round_may_carry_why_the_wrong_move_was_wrong() -> None:
    """§3: a wrong move must teach something about the idea, not about the game."""
    spec = _valid("sequence")
    spec["rounds"][0]["why"] = "the tens cannot be added before they are multiplied."
    out = arcade.verify_arcade(spec)
    assert out is not None and out["rounds"][0]["why"]


# --- where the door sits -------------------------------------------------------------------------


def test_the_door_sits_in_the_middle_and_never_where_the_boss_stands() -> None:
    """§7 placement: after every second or third topic, never at the end."""
    assert arcade.door_positions(9, every=3) == (3, 6)
    assert arcade.door_positions(6, every=3) == (3,)
    assert arcade.door_positions(7, every=2) == (2, 4, 6)
    # the last topic never carries a door: the boss level stays the summit
    for topics in range(1, 20):
        for every in (2, 3):
            assert all(p < topics for p in arcade.door_positions(topics, every=every))


def test_a_chapter_too_short_for_a_middle_has_no_door() -> None:
    assert arcade.door_positions(1) == ()
    assert arcade.door_positions(2) == ()
    assert arcade.door_positions(3) == ()


# --- only where speed or recall is genuinely the skill --------------------------------------------


@pytest.mark.parametrize("name", _DRILLABLE)
def test_a_bonus_level_exists_where_speed_or_recall_is_the_skill(name: str) -> None:
    assert arcade.skill_of(name) in ("speed", "recall")


@pytest.mark.parametrize("name", _NOT_DRILLABLE)
def test_and_nowhere_else(name: str) -> None:
    assert arcade.skill_of(name) is None


# --- the level, filled from the rendering ---------------------------------------------------------


def test_the_level_is_filled_from_the_rendering_and_invents_nothing() -> None:
    """Zero model calls per play: every word in a bonus level came from the course that already
    exists. A string on a chip that is not in the rendering is a generation nobody paid for."""
    course = _course()
    plan = arcade.plan_arcade(course, ["a", "b", "c", "d", "e", "f", "g"], chapter="tables")
    assert plan, "a drillable chapter with real items must produce at least one door"
    haystack = arcade.material_text(course)
    for door in plan:
        for word in arcade.spec_strings(door["spec"]):
            assert word in haystack, f"{word!r} is not in the rendering"


def test_the_boss_items_are_never_spent_on_a_game() -> None:
    """The boss is the summit and it must still be a surprise: nothing from it reaches a chip."""
    course = _course()
    plan = arcade.plan_arcade(course, ["a", "b", "c", "d", "e", "f", "g"], chapter="tables")
    boss_words = {str(i.get("prompt", "")) for i in course["boss"]}
    for door in plan:
        assert not (boss_words & set(arcade.spec_strings(door["spec"])))


def test_two_doors_in_one_chapter_are_two_different_games() -> None:
    """§7: the same game on two chapters looks and reads like two games — and so do two doors."""
    plan = arcade.plan_arcade(
        _course(), ["a", "b", "c", "d", "e", "f", "g"], chapter="multiplication tables"
    )
    games = [d["spec"]["game"] for d in plan]
    assert len(games) >= 2
    assert len(set(games)) == len(games)


def test_every_planned_level_passes_the_gate_it_will_be_served_through() -> None:
    plan = arcade.plan_arcade(_course(), ["a", "b", "c", "d", "e", "f", "g"], chapter="tables")
    for door in plan:
        assert arcade.verify_arcade(door["spec"]) is not None


def test_a_chapter_where_speed_is_not_the_skill_gets_no_door() -> None:
    """A bonus level exists only where the mechanic IS the skill. Never a nag, never filler.

    The chapter is asked through its own RENDERING as of 2026-09-10, not through its name alone
    (``skill_of(name, course)``), so the course here is the ethics chapter's own: prose, a
    discussion, no order to restore and no set of names to hold. Handing this test the tables
    rendering under the ethics title used to pass for the wrong reason — the name carried no
    keyword — and would now fail for the right one, because that rendering IS a drill.
    """
    ethics = {
        "topic": "the ethics of cloning",
        "difficulty": "core",
        "cards": [
            {
                "id": "c1",
                "kind": "text",
                "title": "who decides",
                "idea": "a technique that can be used is not a technique that should be.",
                "interaction": {"kind": "tap", "prompt": "tap the claim you disagree with"},
                "reveal": "the argument turns on consent, not on the biology.",
            }
        ],
        "workbook": [
            {
                "id": "w1",
                "type": "mcq",
                "prompt": "what does the objection rest on?",
                "options": ["consent", "the cost"],
                "answer": "consent",
            }
        ],
        "boss": [],
    }
    assert (
        arcade.plan_arcade(ethics, ["a", "b", "c", "d", "e", "f", "g"], chapter=ethics["topic"])
        == []
    )


def test_a_rendering_with_nothing_to_drill_gets_no_door() -> None:
    bare = {"topic": "tables", "cards": [], "workbook": [], "boss": []}
    assert arcade.plan_arcade(bare, ["a", "b", "c", "d"], chapter="multiplication tables") == []


# --- the register holds inside a game -------------------------------------------------------------


def test_the_register_holds_inside_a_game() -> None:
    """voice.md 10a: no em dash a learner reads, no hype, no emoji, no exclamation."""
    plan = arcade.plan_arcade(_course(), ["a", "b", "c", "d", "e", "f", "g"], chapter="tables")
    said = " ".join(
        [d["spec"]["title"] for d in plan]
        + [d["why"] for d in plan]
        + sorted(arcade.FRAMING)
        + [arcade.DOOR_LINE]
    )
    assert "—" not in said and "–" not in said
    assert "!" not in said
    assert said.isascii()


# --- the money, and the cap -----------------------------------------------------------------------


def test_bonus_xp_is_capped_and_kept_apart_from_the_climb() -> None:
    """docs/LEVELS.md §1 and §4: 15 a level, capped per chapter, capped per day, and it is never
    the XP that unlocks a level."""
    assert arcade.BONUS_XP == 15
    assert arcade.BONUS_XP_CHAPTER_CAP == 45
    assert arcade.BONUS_XP_DAILY_CAP == 60
    assert arcade.BONUS_XP_COUNTS_TOWARD_LEVEL is False


# --- the template floor, on a real course ---------------------------------------------------------


def test_the_floor_attaches_a_bonus_level_where_the_model_attached_none() -> None:
    """§3: templates are the floor, not the ceiling. A chapter where speed or recall IS the skill
    gets a bonus level from the rendering even when the model did not think to write one, and it
    costs nothing because it is a template filled from a course that was already paid for."""
    from wobo_gateway.plexus.engines import _verify_compose

    course = _course()
    spec = {
        "topic": "multiplication tables",
        "cards": [
            {
                "id": f"c{i}",
                "kind": "text",
                "title": f"card {i}",
                "idea": "an idea",
                "interaction": {"kind": "tap", "prompt": "tap it"},
                "reveal": "there it is",
            }
            for i in range(1, 4)
        ],
        "workbook": course["workbook"],
        "boss": course["boss"],
    }
    out = _verify_compose(spec, "multiplication tables", "core")
    assert out is not None
    attached = [c for c in out["cards"] if "arcade" in c]
    assert len(attached) == 1, "exactly one bonus level, on one card"
    assert arcade.verify_arcade(attached[0]["arcade"]) is not None


def test_the_floor_stays_silent_where_a_game_would_be_noise() -> None:
    from wobo_gateway.plexus.engines import _verify_compose

    course = _course()
    spec = {
        "topic": "the ethics of cloning",
        "cards": [
            {
                "id": f"c{i}",
                "kind": "text",
                "title": f"card {i}",
                "idea": "an idea",
                "interaction": {"kind": "tap", "prompt": "tap it"},
                "reveal": "there it is",
            }
            for i in range(1, 4)
        ],
        "workbook": course["workbook"],
        "boss": course["boss"],
    }
    out = _verify_compose(spec, "the ethics of cloning", "core")
    assert out is not None
    assert all("arcade" not in c for c in out["cards"])


def test_the_floor_never_overrules_the_model() -> None:
    """A course the model gave a bonus level keeps the model's one: the floor is a floor."""
    from wobo_gateway.plexus.engines import _verify_compose

    course = _course()
    cards = [
        {
            "id": f"c{i}",
            "kind": "text",
            "title": f"card {i}",
            "idea": "an idea",
            "interaction": {"kind": "tap", "prompt": "tap it"},
            "reveal": "there it is",
        }
        for i in range(1, 4)
    ]
    cards[0]["arcade"] = _valid("match")
    spec = {
        "topic": "multiplication tables",
        "cards": cards,
        "workbook": course["workbook"],
        "boss": course["boss"],
    }
    out = _verify_compose(spec, "multiplication tables", "core")
    assert out is not None
    attached = [c for c in out["cards"] if "arcade" in c]
    assert len(attached) == 1 and attached[0]["arcade"]["game"] == "match"
