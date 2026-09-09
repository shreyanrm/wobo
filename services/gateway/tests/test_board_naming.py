"""THE SAY NAMES WHAT IT DRAWS (docs/INK-FOUR.md, Experience; INK-FREEZE-PLAN-TRACE §3, Plan).

The law is one sentence: *"The say names what it draws: never a label read back, never a pronoun
with no mark under it."* Wave 41's walk of the same 59 turns measured how far off we were: the say
named what it drew on 3 of 12 live turns and on none of the keyless ones. The recorded plans in
``fixtures/board_plans_wave41.json`` are that walk, kept verbatim, and they show why: a plant cell
drew seven labelled parts under "Read the labels as they land, and say which one is missing", a
Punnett square drew the same line, and a ray diagram drew an object and an image under "Watch what
happens to each piece as it moves". Every one of those lines is about the ACT of drawing and none
of them names a single thing on the board.

These tests hold ``board/naming.py`` to the law on made-up plans first (so a failure says which
rule broke) and then walk every recorded plan and assert the same thing on all of them at once.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from wobo_gateway.board import naming

FIXTURE = Path(__file__).parent / "fixtures" / "board_plans_wave41.json"


def _plans() -> list[dict[str, Any]]:
    return json.loads(FIXTURE.read_text())


def ring(**kw: Any) -> dict[str, Any]:
    obj: dict[str, Any] = {"id": kw.pop("id", "m1"), "kind": "ring", "anchor": {"target": "w2"}}
    obj.update(kw)
    return obj


# --- the subject of a mark ----------------------------------------------------------------------


def test_a_marks_subject_is_its_own_words() -> None:
    assert naming.mark_subject(ring(words="the hypotenuse, opposite the right angle")) == (
        "the hypotenuse"
    )


def test_a_marks_subject_falls_back_to_what_it_is_anchored_to() -> None:
    label = {"id": "p1", "kind": "label", "text": "nucleus", "anchor": {"board": [1, 1]}}
    mark = {"id": "m1", "kind": "ring", "anchor": {"object": "p1"}}
    assert naming.mark_subject(mark, {"p1": label}) == "nucleus"


def test_a_leader_arrow_on_a_bare_coordinate_has_no_subject() -> None:
    """The pipelines draw a pointer from a label to the part it names. It is the figure's own
    construction, not Wobo pointing at something a learner can name, and it asks for no sentence."""
    assert naming.mark_subject({"id": "a1", "kind": "arrow", "anchor": {"board": [667, 639]}}) is (
        None
    )


# --- does a sentence name it --------------------------------------------------------------------


def test_a_sentence_names_a_subject_by_its_content_words() -> None:
    assert naming.names("The longest side is the hypotenuse.", "the hypotenuse")
    assert not naming.names("The longest side is opposite the right angle.", "the hypotenuse")


def test_naming_ignores_case_punctuation_and_articles() -> None:
    assert naming.names("Hypotenuse, then. Which one is it?", "the hypotenuse")


# --- the sentence a mark gets when nothing named it ----------------------------------------------


def test_a_mark_the_say_never_names_gets_a_sentence_from_its_own_words() -> None:
    say, objects = naming.name_what_is_drawn(
        "Look again at that line.",
        [ring(words="the hypotenuse is the longest side", beat={"with": 0})],
    )
    assert say == "Look again at that line. The hypotenuse is the longest side."
    assert objects[0]["beat"]["with"] == 1


def test_a_mark_the_say_already_names_gets_no_extra_sentence() -> None:
    before = "The hypotenuse is the one opposite the right angle."
    say, objects = naming.name_what_is_drawn(
        before, [ring(words="the hypotenuse", beat={"with": 0})]
    )
    assert say == before
    assert objects[0]["beat"]["with"] == 0


def test_the_inserted_sentence_shifts_every_later_beat() -> None:
    say, objects = naming.name_what_is_drawn(
        "Start here. Now this bit.",
        [
            ring(id="m1", words="the sign flip", beat={"with": 0}),
            ring(id="m2", words="the second step", beat={"with": 1}),
        ],
    )
    parts = naming.split(say)
    assert parts == [
        "Start here.",
        "The sign flip.",
        "Now this bit.",
        "The second step.",
    ]
    assert [o["beat"]["with"] for o in objects] == [1, 3]


def test_a_mark_keeps_a_beat_the_plan_nested_under_meta() -> None:
    """The glass planner writes ``meta.beat``; the hand reads ``beat`` then ``meta.beat``."""
    mark = ring(words="the second step", meta={"beat": {"with": 1, "lag": 0}, "mark": "ring"})
    _say, objects = naming.name_what_is_drawn("One. Two.", [mark])
    assert objects[0]["meta"]["beat"]["with"] == 2
    assert objects[0]["meta"]["beat"]["lag"] == 0


def test_an_unbeaten_mark_is_named_by_the_line_as_a_whole() -> None:
    """Unbeaten ink is spread across the whole utterance (``stream._ink_clock``), so the line as a
    whole is the sentence it is beaten to, and the naming goes on the end of it."""
    say, _objects = naming.name_what_is_drawn(
        "Read it through once.", [ring(words="the missing minus sign")]
    )
    assert say.endswith("The missing minus sign.")


# --- the register (docs/copy/voice.md 10a, 10c) ---------------------------------------------------


def test_the_naming_sentence_never_narrates() -> None:
    say, _ = naming.name_what_is_drawn(
        "Have a look.", [ring(words="I'll circle the hypotenuse for you")]
    )
    assert "I'll" not in say and "circle" not in say
    assert say.endswith("The hypotenuse for you.") or say.endswith("The hypotenuse.")


def test_the_naming_sentence_carries_no_em_dash_and_no_exclamation() -> None:
    say, _ = naming.name_what_is_drawn("Look.", [ring(words="the sign flip — watch it!")])
    assert "—" not in say and "!" not in say


def test_a_naming_sentence_ends_on_a_full_stop() -> None:
    say, _ = naming.name_what_is_drawn("Look.", [ring(words="the sign flip")])
    assert say.endswith("The sign flip.")


# --- a figure names its own parts ------------------------------------------------------------------


def test_a_figure_names_the_parts_it_labels() -> None:
    objects = [
        {"id": "c", "kind": "ellipse", "anchor": {"board": [1, 1]}, "rx": 4, "ry": 4},
        {"id": "a1", "kind": "arrow", "anchor": {"board": [2, 2]}},
        {"id": "l1", "kind": "label", "text": "cell wall", "anchor": {"object": "a1"}},
        {"id": "a2", "kind": "arrow", "anchor": {"board": [3, 3]}},
        {"id": "l2", "kind": "label", "text": "nucleus", "anchor": {"object": "a2"}},
    ]
    say, _ = naming.name_what_is_drawn("Read the labels as they land.", objects)
    assert say.startswith("Cell wall, nucleus.")


def test_a_figure_whose_parts_the_say_already_names_gets_nothing_added() -> None:
    objects = [
        {"id": "l1", "kind": "label", "text": "cell wall", "anchor": {"board": [1, 1]}},
        {"id": "l2", "kind": "label", "text": "nucleus", "anchor": {"board": [2, 2]}},
    ]
    before = "The cell wall on the outside, the nucleus in the middle."
    say, _ = naming.name_what_is_drawn(before, objects)
    assert say == before


def test_a_number_names_itself_with_its_label() -> None:
    objects = [
        {
            "id": "n1",
            "kind": "number",
            "value": 3,
            "label": "dominant",
            "verified": True,
            "anchor": {"board": [1, 1]},
        },
        {
            "id": "n2",
            "kind": "number",
            "value": 1,
            "label": "recessive",
            "verified": True,
            "anchor": {"board": [2, 2]},
        },
    ]
    say, _ = naming.name_what_is_drawn("Count them up.", objects)
    assert say.startswith("Dominant 3, recessive 1.")


def test_a_pointer_into_a_labelled_figure_is_not_named_twice() -> None:
    """The first bug the real screen found (2026-09-09, keyless, 390). The plant-cell pipeline
    anchors each pointer to the part it points at, so every pointer HAS a subject; judged against
    the say before the figure's own naming went in, each one earned a sentence of its own and the
    turn said "Plant cell." again straight after the sentence that had just said it. The figure is
    named first, and a mark is only owed a sentence the naming did not already give it."""
    objects = [
        {"id": "p1", "kind": "polygon", "title": "plant cell", "points": [[0, 0], [1, 0], [1, 1]]},
        {"id": "a1", "kind": "arrow", "anchor": {"object": "p1"}},
        {"id": "l1", "kind": "label", "text": "cell wall", "anchor": {"object": "a1"}},
    ]
    say, _ = naming.name_what_is_drawn("Read the labels as they land.", objects)
    assert naming.split(say).count("Plant cell.") == 0
    assert say.startswith("Plant cell, cell wall.")


def test_a_figure_with_more_parts_than_one_breath_says_all_of_them() -> None:
    """The second bug the real screen found. Nine names were cut to the first eight and the ninth
    part was drawn, labelled, and never said. Every name the board writes is said; the run is split
    into even mouthfuls instead of being truncated."""
    parts = "wall membrane cytoplasm nucleus chloroplast vacuole mitochondrion ribosome plastid"
    objects = [
        {"id": f"l{i}", "kind": "label", "text": word, "anchor": {"board": [i, i]}}
        for i, word in enumerate(parts.split())
    ]
    say, drawn = naming.name_what_is_drawn("Read them as they land.", objects)
    assert not naming.unnamed(say, drawn)
    assert len(naming.split(say)) == 3, say
    for word in parts.split():
        assert word in say.lower()


def test_working_written_out_is_not_a_part_to_name() -> None:
    """A `write` is Wobo's working, not the name of a part: reading "TT, Tt, Tt, tt" back at a
    learner is the label-read-back the law forbids."""
    objects = [
        {"id": "w1", "kind": "write", "text": "TT", "anchor": {"board": [1, 1]}},
        {"id": "w2", "kind": "write", "text": "Tt", "anchor": {"board": [2, 2]}},
    ]
    say, _ = naming.name_what_is_drawn("Count them up.", objects)
    assert say == "Count them up."


# --- machinery is never spoken ---------------------------------------------------------------------


def test_a_say_that_parses_as_json_is_refused() -> None:
    assert naming.refuse_machinery('{"path":"visualization","viz":{"kind":"diagram"}}') == ""


def test_a_say_that_merely_carries_a_brace_is_refused() -> None:
    assert naming.refuse_machinery('Here it is {"kind": "ring"} for you') == ""


def test_a_bare_json_fragment_is_refused_and_a_bare_numeral_is_not() -> None:
    """"32" is an answer a learner asked for; ""just a string"" is half an envelope."""
    assert naming.refuse_machinery('"just a string"') == ""
    assert naming.refuse_machinery("[1, 2, 3]") == ""
    assert naming.refuse_machinery("32") == "32"


def test_ordinary_prose_survives_the_refusal() -> None:
    line = "The hypotenuse is the longest side. Which one is it?"
    assert naming.refuse_machinery(line) == line


def test_a_plan_whose_say_is_machinery_says_nothing_and_still_draws() -> None:
    say, objects = naming.name_what_is_drawn(
        '{"say":"the hypotenuse"}', [ring(words="the hypotenuse", beat={"with": 0})]
    )
    assert "{" not in say and '"say"' not in say
    assert say == "The hypotenuse."
    assert len(objects) == 1


# --- the ask is printed once ----------------------------------------------------------------------


def test_an_ask_the_line_already_ends_on_is_not_said_again() -> None:
    assert naming.already_asked("Look here. What do you notice about it?", "What do you notice about it?")


def test_an_ask_nobody_said_is_still_owed() -> None:
    assert not naming.already_asked("Look here.", "What do you notice about it?")


def test_the_ask_survives_a_naming_sentence_going_in_after_it() -> None:
    """The naming goes in before the question, never between the question and the ask frame."""
    say, _ = naming.name_what_is_drawn(
        "Look here. What do you notice about it?",
        [ring(words="the sign flip")],
        ask="What do you notice about it?",
    )
    assert say.endswith("What do you notice about it?")
    assert "The sign flip." in say
    assert naming.already_asked(say, "What do you notice about it?")


# --- the walk: all 59 turns' recorded plans ---------------------------------------------------------


def test_the_fixture_is_the_wave_41_walk() -> None:
    plans = _plans()
    assert len(plans) == 77, "the 59 turns, recorded at both widths and both themes"
    assert sum(len(p["objects"]) for p in plans) == 116


def test_the_recorded_walk_is_the_failure_this_closes() -> None:
    """Red on purpose: this is the number the owner was shown. If it ever reaches zero on its own,
    the corpus has been re-recorded and this whole file needs re-basing on the new one."""
    unnamed = [p["turn"] for p in _plans() if naming.unnamed(p["say"], p["objects"])]
    assert len(unnamed) >= 11, unnamed


@pytest.mark.parametrize("plan", _plans(), ids=lambda p: p["turn"])
def test_every_drawn_mark_is_named_in_the_sentence_it_is_beaten_to(plan: dict[str, Any]) -> None:
    say, objects = naming.name_what_is_drawn(
        plan["say"], plan["objects"], ask=plan.get("ask") or None
    )
    left = naming.unnamed(say, objects)
    assert not left, f"{plan['turn']}: {left} not named in {say!r}"


@pytest.mark.parametrize("plan", _plans(), ids=lambda p: p["turn"])
def test_no_turn_speaks_machinery(plan: dict[str, Any]) -> None:
    say, _ = naming.name_what_is_drawn(plan["say"], plan["objects"])
    assert "{" not in say and "}" not in say
    assert "—" not in say and "!" not in say


@pytest.mark.parametrize("plan", _plans(), ids=lambda p: p["turn"])
def test_no_turn_asks_its_question_twice(plan: dict[str, Any]) -> None:
    ask = plan.get("ask")
    if not ask:
        pytest.skip("this turn asked nothing")
    say, _ = naming.name_what_is_drawn(plan["say"], plan["objects"], ask=ask)
    parts = [p for p in naming.split(say) if naming.flat(p) == naming.flat(ask)]
    assert len(parts) <= 1, f"{plan['turn']} said its question {len(parts)} times"


def test_the_naming_pass_adds_no_more_than_it_owes() -> None:
    """A plan is two to four sentences (INK-FREEZE §3, Plan). Naming may not turn it into a
    monologue: one sentence for a mark nobody named, and the figure's parts in mouthfuls of at most
    ``MAX_PARTS``. On the recorded walk that is at most two added sentences on the biggest board
    (a plant cell's seven parts read as four and three) and one or none everywhere else.
    """
    for plan in _plans():
        owed = naming.unnamed(plan["say"], plan["objects"])
        by_id = {str(x.get("id")): x for x in plan["objects"]}
        marks = [o for o in plan["objects"] if naming.mark_subject(o, by_id) is not None]
        figure = {n for o in plan["objects"] if (n := naming.part_name(o))}
        ceiling = len(marks) + -(-len(figure) // naming.MAX_PARTS)
        before = len(naming.split(plan["say"]))
        say, _ = naming.name_what_is_drawn(plan["say"], plan["objects"])
        added = len(naming.split(say)) - before
        assert added <= ceiling, f"{plan['turn']} grew by {added}, ceiling {ceiling}"
        assert (added > 0) == bool(owed), plan["turn"]
        assert added <= 2, f"{plan['turn']} grew by {added} sentences"


# --- wave 45, finding 3: three things the pass said out loud that no teacher says -----------------


def test_two_marks_that_share_words_are_named_once() -> None:
    """Live at 390, "which step is wrong here?" said: "... The numbered steps. The numbered steps.
    Which numbered step..." (the adversary, 2026-09-09, finding 3). Two marks on one subject are
    one thing to say; both marks keep time with the one sentence that names them."""
    say, objects = naming.name_what_is_drawn(
        "No wrong step is visible yet.",
        [
            ring(id="m1", words="the numbered steps", meta={"beat": {"with": 0}}),
            ring(id="m2", words="the numbered steps", meta={"beat": {"with": 0}}),
        ],
    )
    assert say.count("The numbered steps.") == 1, say
    beats = [o["meta"]["beat"]["with"] for o in objects]
    assert beats[0] == beats[1], objects
    assert not naming.unnamed(say, objects)


def test_a_line_of_algebra_keeps_its_own_case() -> None:
    """The pass sentence-cased the working into speech: "X^2 + bx/a + c/a = 0." and "X = 2." on
    the live quadratic and derivation boards. `x` is not a word and a capital changes what it is.
    """
    assert naming.in_register("x^2 + bx/a + c/a = 0") == "x^2 + bx/a + c/a = 0."
    assert naming.in_register("x = 2") == "x = 2."
    # ordinary prose still gets its capital
    assert naming.in_register("the hypotenuse") == "The hypotenuse."
    assert naming.in_register("nucleus") == "Nucleus."


def test_a_mark_written_as_an_operator_is_not_a_sentence() -> None:
    """The balance board's whole say was "+. Each part goes on in the order you'd draw it
    yourself." A "+" written on the board is a stroke, not a name a learner can be told."""
    assert naming.part_name({"id": "p1", "kind": "label", "text": "+"}) is None
    assert naming.part_name({"id": "p2", "kind": "label", "text": "->"}) is None
    assert naming.part_name({"id": "p3", "kind": "label", "text": "H2O"}) == "H2O"
    say, _ = naming.name_what_is_drawn(
        "Each part goes on in the order you'd draw it yourself.",
        [{"id": "p1", "kind": "label", "text": "+"}],
    )
    assert say == "Each part goes on in the order you'd draw it yourself."
