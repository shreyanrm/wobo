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
        "This is the sign flip.",
        "Now this bit.",
        "This is the second step.",
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
    # A label is pointed at rather than read out (the adversary, wave 47, finding 7).
    assert say.endswith("This is the missing minus sign.")


# --- the register (docs/copy/voice.md 10a, 10c) ---------------------------------------------------


def test_the_naming_sentence_never_narrates() -> None:
    say, _ = naming.name_what_is_drawn(
        "Have a look.", [ring(words="I'll circle the hypotenuse for you")]
    )
    assert "I'll" not in say and "circle" not in say
    assert say.endswith("This is the hypotenuse for you.") or say.endswith(
        "This is the hypotenuse."
    )


def test_the_naming_sentence_carries_no_em_dash_and_no_exclamation() -> None:
    say, _ = naming.name_what_is_drawn("Look.", [ring(words="the sign flip — watch it!")])
    assert "—" not in say and "!" not in say


def test_a_naming_sentence_ends_on_a_full_stop() -> None:
    say, _ = naming.name_what_is_drawn("Look.", [ring(words="the sign flip")])
    assert say.endswith("This is the sign flip.")


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
    assert say == "This is the hypotenuse."
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
    assert "This is the sign flip." in say
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
    assert say.count("These are the numbered steps.") == 1, say
    beats = [o["meta"]["beat"]["with"] for o in objects]
    assert beats[0] == beats[1], objects
    assert not naming.unnamed(say, objects)


def test_a_line_of_algebra_keeps_its_own_case() -> None:
    """The pass sentence-cased the working into speech: "X^2 + bx/a + c/a = 0." and "X = 2." on
    the live quadratic and derivation boards. `x` is not a word and a capital changes what it is.
    """
    assert naming.in_register("x^2 + bx/a + c/a = 0") == "x² + bx/a + c/a = 0."
    assert naming.in_register("x = 2") == "x = 2."
    # ordinary prose still gets its capital
    assert naming.in_register("the hypotenuse") == "The hypotenuse."
    assert naming.in_register("nucleus") == "Nucleus."


def test_a_power_is_spoken_as_a_power_even_though_the_board_writes_a_caret() -> None:
    """``pretty_algebra`` leaves ``x^2`` in a ``write`` because the handwriting layer raises the
    caret as a real superscript. The say is read out loud and printed in the transcript, and
    "x caret 2" is not how anybody says x squared: live at 1440 the quadratic's second sentence
    was "x^2 + bx/a + c/a = 0." (the adversary, wave 42; measured 2026-09-10)."""
    assert naming.in_register("x^2 + 5x + 6 = 0") == "x² + 5x + 6 = 0."
    assert naming.in_register("a^3") == "a³."
    # a power the alphabet cannot raise is left exactly as the board wrote it
    assert naming.in_register("x^4 + 1 = 0") == "x^4 + 1 = 0."
    # and the two spellings are one line as far as naming is concerned
    assert naming.names("x² + 5x + 6 = 0, line by line.", "x^2 + 5x + 6 = 0")


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


# --- a label is not a sentence (the adversary, wave 47, finding 7) --------------------------------


def test_a_marks_label_is_spoken_as_a_sentence_not_read_out() -> None:
    """Live at 390, the doubt caption read: "Start with the equation, because we keep both sides
    balanced while removing the extra 5. STARTING EQUATION. The first step is 3x = 20 - 5, not
    20 + 5, because subtracting 5 cancels the +5 on the left. WRONG SIGN. CORRECT FIRST STEP.
    Then divide both sides by 3..." Three of those sentences are the marks' own labels, read out
    as prose in the middle of the teaching. The law stands — nothing stands on the glass unspoken —
    but what is said about a mark is a thing a teacher says, not a caption spoken aloud.
    """
    say, _ = naming.name_what_is_drawn(
        "Start with the equation, because we keep both sides balanced.",
        [ring(words="starting equation", beat={"with": 0})],
    )
    assert "This is the starting equation." in say, say
    assert " Starting equation." not in say


def test_a_card_s_own_title_is_a_thing_to_do_and_is_never_articled() -> None:
    """Keyless at 390, "show me why" on the "predict, then check" card opened "Predict. Which
    part is the one that isn't landing?" — the client's label for its own ring, read out as prose
    (the adversary, wave 60, finding 1). Said as a thing rather than read out, it became "This is
    the predict, then check.", which is not a sentence a person says either: EVERY card in this
    product is titled with an instruction, and an instruction takes no article. Wobo already has
    the form, in its own voice, for exactly this phrase — ``glass.absent_line`` says "There's no
    effect circle on this card. This one is predict, then check."
    """
    for title in ("predict, then check", "feel the rule", "make a move", "meet a new course"):
        said = naming.as_a_sentence(title)
        assert said == f"This one is {title}", said
        assert "the " + title not in said, said


def test_a_noun_phrase_label_still_gets_its_article() -> None:
    """The rule above reads an INSTRUCTION, not any short label: what a figure calls a part of
    itself is a thing, and a thing is pointed at with "This is the ..." as it always was."""
    assert naming.as_a_sentence("sign flip") == "This is the sign flip"
    assert naming.as_a_sentence("right angle") == "This is the right angle"
    assert naming.as_a_sentence("greatest height") == "This is the greatest height"
    assert naming.as_a_sentence("the idea") == "This is the idea"
    assert naming.as_a_sentence("numbered steps") == "These are the numbered steps"


def test_the_label_keeps_its_own_article_when_it_has_one() -> None:
    say, _ = naming.name_what_is_drawn("Look.", [ring(words="the wrong sign", beat={"with": 0})])
    assert say == "Look. This is the wrong sign."


def test_words_that_already_say_something_are_left_exactly_as_they_are() -> None:
    say, _ = naming.name_what_is_drawn(
        "Look again at that line.",
        [ring(words="the hypotenuse is the longest side", beat={"with": 0})],
    )
    assert say == "Look again at that line. The hypotenuse is the longest side."


def test_a_line_of_working_is_read_as_working_not_pointed_at() -> None:
    say, _ = naming.name_what_is_drawn("Watch.", [ring(words="3x = 20 - 5", beat={"with": 0})])
    assert say == "Watch. 3x = 20 - 5."


def test_the_pointing_sentence_still_names_the_mark() -> None:
    objects = [ring(words="wrong sign", beat={"with": 0})]
    say, drawn = naming.name_what_is_drawn("Start here.", objects)
    assert not naming.unnamed(say, drawn)


# --- a mark on the learner's own page (the adversary, wave 58, finding 1) -------------------------


def on_page(**kw: Any) -> dict[str, Any]:
    """A mark as ``doubt.DoubtShaper`` hands it on: its words are the line it sits on."""
    obj = ring(**kw)
    obj.setdefault("meta", {})["page"] = True
    return obj


def test_a_page_mark_the_say_never_names_is_pointed_at_not_read_back() -> None:
    """Live at 390 (w58j) the whole caption was "Not quite. What is 20 - 5?" over a ring on the
    learner's own line, and nothing said which of their six lines the ring was on. A mark on the
    page is owed the line it sits on, said the way a teacher points at a line: never as a claim
    ("3x = 20 + 5." asserts the wrong line), never with the learner's own "?" read out."""
    say, drawn = naming.name_what_is_drawn(
        "Not quite. What is 20 - 5?",
        [on_page(words="3x = 20 + 5 ?", meta={"beat": {"with": 0}})],
        ask="What is 20 - 5?",
    )
    assert say == "Not quite. This line, 3x = 20 + 5. What is 20 - 5?", say
    # The beat the shaper chose stands (law 5: the first stroke is on the first sentence); the
    # pointing sentence follows it while the ink holds, the way a teacher rings as they say
    # "look here" and then reads the line.
    assert drawn[0]["meta"]["beat"]["with"] == 0
    assert not naming.unnamed(say, drawn)


def test_a_page_line_with_a_heading_is_named_by_its_working() -> None:
    """"Solve: 3x + 5 = 20" is a heading and an equation. The subject used to be cut at the
    colon, so the mark on it was called "Solve" and spoken as "Solve."."""
    assert naming.mark_subject(on_page(words="Solve: 3x + 5 = 20")) == "3x + 5 = 20"
    say, _ = naming.name_what_is_drawn(
        "Not quite.", [on_page(words="Solve: 3x + 5 = 20", meta={"beat": {"with": 0}})]
    )
    assert say == "Not quite. This line, 3x + 5 = 20."


def test_a_page_mark_the_teaching_already_names_gets_nothing_added() -> None:
    """The wave-57 teaching line names the line it marks ("... 3x = 20 - 5, not 20 + 5 ..."), so
    the mark on that line is owed nothing more, and the say is exactly the model's."""
    say = (
        "Start with the equation, because we keep both sides balanced. The first step is "
        "3x = 20 - 5, not 20 + 5, because subtracting 5 cancels the +5 on the left."
    )
    said, _ = naming.name_what_is_drawn(
        say, [on_page(words="3x = 20 + 5 ?", meta={"beat": {"with": 1}})]
    )
    assert said == say


def test_a_page_mark_is_unnamed_when_nothing_says_its_line() -> None:
    """The exemption hid it: ``unnamed`` reported nothing for a page mark no sentence named."""
    marks = [on_page(words="3x = 20 + 5 ?", meta={"beat": {"with": 0}})]
    assert naming.unnamed("Not quite. What is 20 - 5?", marks) == ["3x = 20 + 5"]


def test_a_prose_line_of_the_page_is_pointed_at_in_sentence_case() -> None:
    say, _ = naming.name_what_is_drawn(
        "Start with the perimeter.",
        [on_page(words="Find the perimeter of the rectangle", meta={"beat": {"with": 0}})],
    )
    assert say == "Start with the perimeter. This line, find the perimeter of the rectangle."


def test_a_standing_mark_on_a_line_of_working_keeps_the_learners_question_mark_out() -> None:
    """``stream._standing`` rebuilds the client's mark without its ``meta``, so the instant mark
    on the learner's "3x = 20 + 5 ?" reaches the pass as a plain mark. Its subject is still the
    line, not the line plus the learner's own "?"."""
    assert naming.mark_subject(ring(words="3x = 20 + 5 ?")) == "3x = 20 + 5"
    assert naming.mark_subject(ring(words="Solve: 3x + 5 = 20")) == "3x + 5 = 20"


def test_a_refused_page_mark_does_not_take_the_teaching_with_it() -> None:
    """A sentence about the learner's own line is about something that IS on the glass, whether
    or not the mark on it reached the wire."""
    say = "Not quite. The first step is 3x = 20 - 5, not 20 + 5. What is 20 - 5?"
    missing = [on_page(id="m9", words="3x = 20 + 5 ?", meta={"beat": {"with": 1}})]
    line, cut = naming.only_what_is_drawn(say, [], missing)
    assert line == say and cut == ()


def test_the_pointing_sentence_is_the_one_a_standing_mark_is_owed_too() -> None:
    """One builder for every mark the say never names, so the wire's front sentence for a mark
    the client laid can be the same sentence, not the raw line."""
    assert naming.sentence_for(on_page(words="3x = 20 + 5 ?")) == "This line, 3x = 20 + 5."
    assert naming.sentence_for(ring(words="the wrong sign")) == "This is the wrong sign."
    assert naming.sentence_for(ring(words="3x = 20 - 5")) == "3x = 20 - 5."


def test_a_page_mark_with_no_beat_keeps_time_with_the_pointing_sentence() -> None:
    say, drawn = naming.name_what_is_drawn(
        "Not quite. What is 20 - 5?", [on_page(words="3x = 20 + 5 ?")]
    )
    assert say == "Not quite. What is 20 - 5? This line, 3x = 20 + 5."
    assert drawn[0]["meta"]["beat"]["with"] == 2


def test_a_page_mark_is_named_by_any_one_sentence_that_names_its_line() -> None:
    """Its ink holds on the page for the whole turn, so the sentence that names it need not be
    the one it is beaten to; but ONE sentence has to, and "3x" in one sentence with "20 + 5" in
    another is not that sentence."""
    marks = [on_page(words="3x = 20 + 5 ?", meta={"beat": {"with": 0}})]
    assert naming.unnamed("Not quite. This line, 3x = 25. What is 20 - 5?", marks) == [
        "3x = 20 + 5"
    ]
    assert naming.unnamed("Not quite. This line, 3x = 20 + 5. What is 20 - 5?", marks) == []
    say, drawn = naming.name_what_is_drawn(
        "Not quite. Your line 3x = 20 + 5 adds the 5, so undo it. What is 20 - 5?", marks
    )
    assert say == "Not quite. Your line 3x = 20 + 5 adds the 5, so undo it. What is 20 - 5?"
    assert drawn[0]["meta"]["beat"]["with"] == 0


# --- an inserted sentence moves every later beat by the number inserted, and no more ------------


def test_an_already_named_mark_after_an_insertion_moves_by_exactly_the_sentences_inserted() -> None:
    """``beat + shift[beat]`` counted the beat's own index twice: a mark named by sentence 1, with
    one sentence inserted before it, kept time with sentence 3. Hidden until now because every
    mark under test was given a fresh sentence of its own and re-beaten to that."""
    say, objects = naming.name_what_is_drawn(
        "Start here. The second step is next. Then this. Then that.",
        [
            ring(id="m1", words="the sign flip", beat={"with": 0}),
            ring(id="m2", words="the second step", beat={"with": 1}),
        ],
    )
    assert naming.split(say)[2] == "The second step is next."
    assert [o["beat"]["with"] for o in objects] == [1, 2]


def test_a_chosen_after_beat_moves_with_its_sentence() -> None:
    say, objects = naming.name_what_is_drawn(
        "Start here. The second step is next.",
        [
            ring(id="m1", words="the sign flip", beat={"with": 0}),
            {
                "id": "w1",
                "kind": "write",
                "text": "x = 2",
                "anchor": {"target": "w2"},
                "meta": {"beat": {"after": 1}},
            },
        ],
    )
    assert naming.split(say)[2] == "The second step is next."
    assert objects[1]["meta"]["beat"] == {"after": 2}


def test_only_a_mark_that_sits_on_a_line_is_pointed_at() -> None:
    """``doubt.DoubtShaper._about_the_line`` swaps a mark's words for its line only when the mark
    anchors to a line by ``target``. An arrow between two marks keeps the model's own words and
    the page flag, and "This line, it goes here." would be a tag spoken as a line."""
    arrow = {
        "id": "a1",
        "kind": "arrow",
        "anchor": {"object": "m1"},
        "from": {"object": "m2"},
        "words": "it goes here",
        "meta": {"page": True, "beat": {"with": 0}},
    }
    assert naming.sentence_for(arrow) == "It goes here."
    say, _ = naming.name_what_is_drawn("Look.", [arrow])
    assert say == "Look. It goes here."


def test_a_wordless_arrow_between_two_page_marks_is_owed_nothing() -> None:
    """The doubt plan's arrow from its note to its ring carries no words. It is the page's own
    construction between two marks that are named already, and the one-hop anchor rule (right for
    a leader on Wobo's own figure) would read the ring's LINE through it: "This is the find the
    perimeter of the rectangle."."""
    ring_on_page = on_page(id="m1", words="Find the perimeter of the rectangle")
    arrow = {
        "id": "a1",
        "kind": "arrow",
        "anchor": {"object": "m1"},
        "from": {"object": "m2"},
        "meta": {"page": True, "beat": {"with": 0}},
    }
    assert naming.mark_subject(arrow, {"m1": ring_on_page}) is None
    assert naming.sentence_for(arrow, {"m1": ring_on_page}) == ""
    say, _ = naming.name_what_is_drawn(
        "Look. This line, find the perimeter of the rectangle.", [ring_on_page, arrow]
    )
    assert say == "Look. This line, find the perimeter of the rectangle."


# --- a line of working is named by quoting it, not by carrying the same numbers ------------------


def test_a_line_of_working_is_named_only_when_a_sentence_quotes_it_or_a_side_of_it() -> None:
    """Live at 390 and 1440 (w60): the ring on the learner's "Solve: 3x + 5 = 20" got no pointing
    sentence because "Subtract 5 from both sides ... : 3x = 20 - 5." carries the same three
    tokens. Content words are the right test for a name; for working the operators ARE the
    words, and a sentence names a line by quoting it, or one side of it, in order."""
    line = "3x + 5 = 20"
    assert not naming.names("Subtract 5 from both sides, so 3x = 20 - 5.", line)
    assert naming.names("Start with 3x + 5 = 20, the line you were given.", line)
    assert naming.names("Start with 3x+5=20.", line)
    # the wave-57 teaching quotes the right-hand side of the learner's line, and names it
    assert naming.names(
        "The first step is 3x = 20 - 5, not 20 + 5, because it cancels.", "3x = 20 + 5"
    )
    # a bare number is not a side worth the name, and a quote that runs on is not a quote
    assert not naming.names("What is 20 - 5?", "3x = 20 + 5")
    assert not naming.names("x = 25/3 is the next line.", "3x = 25")
    assert not naming.names("So 3x = 25/3.", "3x = 25")
    # both spellings of a power are one line
    assert naming.names("x² + 5x + 6 = 0, line by line.", "x^2 + 5x + 6 = 0")


def test_a_page_mark_is_pointed_at_when_the_teaching_only_shares_its_numbers() -> None:
    say, _ = naming.name_what_is_drawn(
        "Not quite. Subtract 5 from both sides, so 3x = 20 - 5. What is 20 - 5?",
        [on_page(words="Solve: 3x + 5 = 20", meta={"beat": {"with": 1}})],
        ask="What is 20 - 5?",
    )
    assert say == (
        "Not quite. Subtract 5 from both sides, so 3x = 20 - 5. This line, 3x + 5 = 20. "
        "What is 20 - 5?"
    )


def test_two_page_marks_of_one_sentence_are_pointed_at_together() -> None:
    """Live at 390 (w60): "This line, 3x = 20 + 5. This line, 3x + 5 = 20." is an inventory.
    Two lines pointed at in one breath are one sentence."""
    say, drawn = naming.name_what_is_drawn(
        "Step 2 is not right. What is 20 - 5?",
        [
            on_page(id="m0", words="3x = 20 + 5 ?", meta={"beat": {"with": 0}}),
            on_page(id="m1", words="Solve: 3x + 5 = 20", meta={"beat": {"with": 0}}),
        ],
        ask="What is 20 - 5?",
    )
    assert say == (
        "Step 2 is not right. This line, 3x = 20 + 5, and this line, 3x + 5 = 20. What is 20 - 5?"
    )
    assert not naming.unnamed(say, drawn)
    assert [o["meta"]["beat"]["with"] for o in drawn] == [0, 0]
