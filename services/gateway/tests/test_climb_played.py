"""THE TUTOR NEVER LEAVES — a learner played end to end against the real pool.

docs/LEARNING-MODEL.md, "The tutor never leaves" (the owner, 2026-09-15): *"Is the content and
teaching plan continuously optimising and personalising to the learner's needs until they master
or understand that topic? It should be motivating, continuous support, understanding and guiding
where they went wrong, and so on."*

Every test here PLAYS. It hands the climb a real sequence of attempts — wrong ones, slow ones, a
right one after a wrong one — against the checked-in pool for CBSE class 8 Science, "Force and
Pressure" (``blueprint_fixture``, the same cell the live architect run designs), and reads what
the climb chose next. Nothing here asserts on a docstring, and nothing reads a detail a learner
could not feel.

The five things that section says must be TRUE IN CODE, and where each is proved:

1. the group is re-chosen after EVERY module, from what just happened   sections 1 and 2
2. it stops at the topic's own evidence, never a count and never a clock section 3
3. where they went wrong is said in this concept's own words             section 4
4. the pool keeps giving, and a miss never costs the learner anything    section 5
5. the learner is never left: every step has the next thing              section 6

Keyless and offline, like the rest of the suite. Choosing a group is a SELECTION over a pool that
already exists, so a model call anywhere inside it is itself the defect, and one test asserts that
directly (:func:`test_choosing_a_group_never_reaches_a_model`).
"""

from __future__ import annotations

import copy
from collections.abc import Callable
from typing import Any

import pytest
from blueprint_fixture import blueprint as good_blueprint
from wobo_gateway import climb
from wobo_gateway.plexus import blueprint as bp
from wobo_gateway.plexus.blueprint_spec import Blueprint, BlueprintModule

# --- the pool, and a learner who answers ---------------------------------------------------------


def pool() -> Blueprint:
    parsed = bp.parse(good_blueprint())
    assert parsed is not None, "the fixture must parse before any of this means anything"
    return parsed


def altered(change: Callable[[dict[str, Any]], None]) -> Blueprint:
    """The same real pool with one thing moved, so a rule the fixture cannot exercise on its own
    is still exercised on a real pool rather than on a toy."""
    raw = copy.deepcopy(good_blueprint())
    change(raw)
    parsed = bp.parse(raw)
    assert parsed is not None
    return parsed


Answer = Callable[[BlueprintModule, "climb.Evidence"], "climb.Attempt"]


def play(
    chapter: Blueprint,
    topic_id: str,
    answer: Answer,
    *,
    limit: int = 60,
) -> tuple[list[climb.Step], climb.Evidence]:
    """Walk it the way a learner does: ask what is next, answer that, ask again.

    ``limit`` is a runaway guard for the TEST and never a rule of the climb. A climb that needs it
    is a loop rather than a climb, and the assertion says exactly that.
    """
    evidence = climb.Evidence()
    steps: list[climb.Step] = []
    for _ in range(limit):
        step = climb.next_step(chapter, topic_id, evidence)
        steps.append(step)
        if step.module is None:
            return steps, evidence
        evidence = climb.after(chapter, evidence, answer(step.module, evidence))
    raise AssertionError(f"the climb never ended for {topic_id}: it is a loop, not a climb")


def taught(steps: list[climb.Step]) -> list[str]:
    return [s.module.id for s in steps if s.module is not None]


def right(module: BlueprintModule, _evidence: climb.Evidence) -> climb.Attempt:
    return climb.Attempt(module.id, right=True)


def second_time_lucky(module: BlueprintModule, evidence: climb.Evidence) -> climb.Attempt:
    """Misses everything once, then gets it. The commonest real learner in the product."""
    return climb.Attempt(module.id, right=evidence.wrong.count(module.id) >= 1)


def always_wrong(module: BlueprintModule, _evidence: climb.Evidence) -> climb.Attempt:
    return climb.Attempt(module.id, right=False)


# =================================================================================================
# 1. The group is re-chosen after every module, from what just happened
# =================================================================================================


def test_the_group_is_re_chosen_after_every_module_and_not_once_at_the_start() -> None:
    """Rule 1. The group that teaches the topic is chosen again after each module, using what just
    happened. Proved by the group CHANGING mid-climb on nothing but the learner's own answers: a
    group decided once at the start cannot do that."""
    chapter = pool()
    seen: list[list[str]] = []

    def answer(module: BlueprintModule, evidence: climb.Evidence) -> climb.Attempt:
        seen.append(climb.group_now(chapter, "t1", evidence))
        if module.id == "p1" and not evidence.wrong:
            return climb.Attempt(module.id, right=False, showed=("x1",))
        return climb.Attempt(module.id, right=True)

    steps, _ = play(chapter, "t1", answer)
    assert len(seen) >= 3, "a single module is not a climb"
    assert len({tuple(group) for group in seen}) > 1, (
        "the group never changed across the whole climb, so it was chosen once and not re-chosen"
    )
    assert taught(steps), "a topic with no group is a topic nobody can learn"


def test_a_wrong_answer_pulls_its_repair_into_the_group_and_a_clean_run_never_sees_it() -> None:
    """A module exists for each misconception a topic can produce, and it enters a learner's group
    only when they show it (docs/LEARNING-MODEL.md section 2)."""
    chapter = pool()
    clean = climb.Evidence()
    missed = climb.after(chapter, clean, climb.Attempt("p9", right=False, showed=("x2",)))
    assert "r2" not in climb.group_now(chapter, "t4", clean)
    assert "r2" in climb.group_now(chapter, "t4", missed)


def test_the_repair_for_what_they_showed_is_the_very_next_module() -> None:
    """Rule 3, as the climb's half of it: a learner who has just shown a misconception is taken to
    the module that undoes THAT misconception, not to the next thing on a list."""
    chapter = pool()
    evidence = climb.after(chapter, climb.Evidence(), climb.Attempt("p9", False, showed=("x2",)))
    step = climb.next_step(chapter, "t4", evidence)
    assert step.module is not None and step.module.id == "r2"
    assert step.kind == "repair"


def test_how_slow_they_were_is_read_and_it_changes_which_way_in_they_meet() -> None:
    """ "How slow" is one of the four things the re-choice reads. A learner who runs over the
    module's own minutes is on the slow pace, and the pace decides between two ways into one idea
    when the style has nothing to say."""
    chapter = pool()
    unhurried = climb.Evidence()
    for module_id, seconds in (("p1", 900.0), ("p3", 1200.0)):
        unhurried = climb.after(
            chapter, unhurried, climb.Attempt(module_id, right=True, seconds=seconds)
        )
    assert climb.pace_of(unhurried) == "slow"

    quick = climb.Evidence()
    for module_id in ("p1", "p3"):
        quick = climb.after(chapter, quick, climb.Attempt(module_id, right=True, seconds=60.0))
    assert climb.pace_of(quick) == "fast"

    # The fixture's two ways into pressure are the same length, so the shorter-sitting preference
    # has nothing to choose between. Shorten one, on the real pool, and the slow learner meets it.
    def shorten(raw: dict[str, Any]) -> None:
        for module in raw["modules"]:
            if module["id"] == "p10":
                module["minutes"] = 5

    shorter = altered(shorten)
    slow = climb.Evidence(slow=("p1", "p3"))
    steady = climb.Evidence()
    assert "p10" in climb.group_now(shorter, "t4", slow)
    assert "p9" in climb.group_now(shorter, "t4", steady)


def test_what_the_learner_said_is_read_against_this_chapter_s_own_misconceptions() -> None:
    """ "What they said" is the fourth input. It is matched against the pool's OWN declarations and
    never guessed at: every distinctive word of the misconception has to be there, so a learner who
    restates it is heard and a learner who says something else is not misread."""
    chapter = pool()
    restated = climb.after(
        chapter,
        climb.Evidence(),
        climb.Attempt("p11", right=False, said="but liquids only press downwards"),
    )
    assert "x3" in restated.misconceptions
    vague = climb.after(
        chapter,
        climb.Evidence(),
        climb.Attempt("p11", right=False, said="I am really not sure about this one"),
    )
    assert vague.misconceptions == (), "a misconception nobody showed is never invented"


def test_the_style_follows_what_has_actually_landed_for_this_learner() -> None:
    """Style is what the pool calls kind, and it is learned rather than asked for: the kind of
    module a learner gets right moves to the front of their own order, and the next way in follows
    it even when the flow's own order says otherwise."""
    chapter = pool()
    evidence = climb.after(chapter, climb.Evidence(), climb.Attempt("q1", right=True))
    assert evidence.style and evidence.style[0] == "worked"
    group = climb.group_now(chapter, "t1", evidence)
    assert "p4" in group, "the worked way into the second idea is this learner's way in"
    assert "p3" not in group, "and the simulated one is not, though the flow lists it first"


# =================================================================================================
# 2. Wrong twice is a DIFFERENT module, never the same one, never a harder one
# =================================================================================================


def test_a_module_that_beat_the_learner_twice_is_never_the_next_module() -> None:
    """The named defect. A learner who gets a module wrong twice gets a DIFFERENT module next,
    never the same one again."""
    chapter = pool()
    evidence = climb.Evidence()
    for _ in range(2):
        evidence = climb.after(chapter, evidence, climb.Attempt("p9", right=False))
    step = climb.next_step(chapter, "t4", evidence)
    assert step.module is not None, "a learner who missed twice is never left on an empty screen"
    assert step.module.id != "p9"


def test_a_module_that_beat_the_learner_twice_never_comes_back_at_all() -> None:
    """Not on the next step, and not five modules later: never again."""
    chapter = pool()

    def answer(module: BlueprintModule, evidence: climb.Evidence) -> climb.Attempt:
        if module.id == "p3" and evidence.wrong.count("p3") < 2:
            return climb.Attempt(module.id, right=False)
        return climb.Attempt(module.id, right=True)

    steps, evidence = play(chapter, "t1", answer)
    walked = taught(steps)
    assert walked.count("p3") == 2, "two misses, and then it is gone"
    assert "p3" not in climb.group_now(chapter, "t1", evidence)


def test_what_comes_after_two_misses_is_never_harder_than_what_beat_them() -> None:
    """ "Never a harder one." Hardness is the pool's own: what the module is FOR, and then how long
    a sitting it asks for."""
    chapter = pool()
    for beaten_id in ("p3", "p9", "p1", "p11"):
        evidence = climb.Evidence()
        for _ in range(2):
            evidence = climb.after(chapter, evidence, climb.Attempt(beaten_id, right=False))
        beaten = chapter.module_by_id(beaten_id)
        assert beaten is not None
        step = climb.next_step(chapter, beaten.serves[0], evidence)
        assert step.module is not None, beaten_id
        assert not climb.harder_than(step.module, beaten), (
            f"after two misses on {beaten_id} the climb reached for {step.module.id}, "
            f"which is the harder of the two"
        )


def test_a_stretch_is_never_what_a_learner_meets_after_a_miss() -> None:
    chapter = pool()
    evidence = climb.Evidence()
    for _ in range(2):
        evidence = climb.after(chapter, evidence, climb.Attempt("p9", right=False))
    step = climb.next_step(chapter, "t4", evidence)
    assert step.module is not None and step.module.role != "stretch"


def test_the_architect_s_own_stuck_route_is_taken_before_anything_the_climb_would_pick() -> None:
    """The architect wrote, for the modules learners really do get stuck on, a DIFFERENT module to
    show them instead. That statement is the first thing the climb reaches for."""
    chapter = pool()
    evidence = climb.Evidence()
    for _ in range(2):
        evidence = climb.after(chapter, evidence, climb.Attempt("p9", right=False))
    step = climb.next_step(chapter, "t4", evidence)
    assert step.module is not None and step.module.id == "q2"
    assert step.kind == "way_back"


def test_one_miss_is_not_two_and_a_second_look_is_not_a_repeat_forever() -> None:
    """A tutor lets you try again once. The bar falls on the SECOND miss, not the first."""
    chapter = pool()
    once = climb.after(chapter, climb.Evidence(), climb.Attempt("p3", right=False))
    assert "p3" in climb.group_now(chapter, "t1", once)
    twice = climb.after(chapter, once, climb.Attempt("p3", right=False))
    assert "p3" not in climb.group_now(chapter, "t1", twice)


# =================================================================================================
# 3. It ends at the topic's own evidence: never a count, never a clock
# =================================================================================================


def test_a_learner_who_understands_early_moves_on_early() -> None:
    """Rule 2. The climb ends the moment the topic's evidence exists, and a right answer on the
    idea the topic is held by IS that evidence. Nothing is shown to be thorough."""
    chapter = pool()
    steps, evidence = play(chapter, "t4", right)
    assert climb.mastered(chapter, "t4", evidence)
    assert steps[-1].kind == "mastered"
    served = [m.id for m in chapter.modules if "t4" in m.serves and m.role != "boss"]
    assert len(taught(steps)) < len(served), (
        "the fast learner walked the whole pool, so the climb is a list and not a selection"
    )


def test_a_learner_who_struggles_is_given_more_and_reaches_the_same_topic() -> None:
    """Two learners, the same topic, two roads, and both arrive. "Both are mastered, both light the
    same star, and neither is told they took a different road.\""""
    chapter = pool()

    def stumbling(module: BlueprintModule, evidence: climb.Evidence) -> climb.Attempt:
        if evidence.wrong.count(module.id) < 1 and module.role in ("way_in", "check"):
            return climb.Attempt(module.id, right=False, showed=("x1",))
        return climb.Attempt(module.id, right=True)

    quick_steps, quick_evidence = play(chapter, "t1", right)
    slow_steps, slow_evidence = play(chapter, "t1", stumbling)
    assert climb.mastered(chapter, "t1", quick_evidence)
    assert climb.mastered(chapter, "t1", slow_evidence)
    assert len(taught(slow_steps)) > len(taught(quick_steps)), (
        "the learner who struggled was given no more than the one who did not"
    )


def test_the_end_is_the_evidence_and_never_a_module_count() -> None:
    """A learner can finish a pile of modules and not be done, and can be done without finishing
    them. Mastery reads the ideas and the misconceptions, and nothing else."""
    chapter = pool()
    many = climb.Evidence()
    for module_id in ("p1", "p3", "c1"):
        many = climb.after(chapter, many, climb.Attempt(module_id, right=True))
    assert not climb.mastered(chapter, "t4", many), (
        "three modules finished and this topic's own idea never evidenced is not mastery"
    )
    one = climb.after(chapter, climb.Evidence(), climb.Attempt("p9", right=True))
    assert climb.mastered(chapter, "t4", one)


def test_a_misconception_still_standing_holds_the_topic_open_however_much_was_finished() -> None:
    """ "A topic declares what must be true for it to be held: the ideas that must be understood,
    AND the misconceptions that must be gone.\""""
    chapter = pool()
    evidence = climb.after(chapter, climb.Evidence(), climb.Attempt("p9", False, showed=("x2",)))
    evidence = climb.after(chapter, evidence, climb.Attempt("p9", right=True))
    assert not climb.mastered(chapter, "t4", evidence), "the misconception is still standing"
    repaired = climb.after(chapter, evidence, climb.Attempt("r2", right=True))
    assert climb.mastered(chapter, "t4", repaired)


def test_nothing_in_the_ending_reads_a_clock() -> None:
    """ "Never at a fixed number of modules, never at a time." A learner who took an hour over one
    module and one who took a minute end in exactly the same place."""
    chapter = pool()
    slow = climb.after(chapter, climb.Evidence(), climb.Attempt("p9", True, seconds=3600.0))
    fast = climb.after(chapter, climb.Evidence(), climb.Attempt("p9", True, seconds=20.0))
    assert climb.mastered(chapter, "t4", slow) is True
    assert climb.mastered(chapter, "t4", fast) is True


def test_a_right_answer_after_a_wrong_one_still_holds_the_idea() -> None:
    """docs/REWARDS.md section 3: arriving late is still arriving."""
    chapter = pool()
    evidence = climb.Evidence()
    for attempt in (
        climb.Attempt("p9", right=False),
        climb.Attempt("p9", right=False),
        climb.Attempt("q2", right=True),
        climb.Attempt("p10", right=True),
    ):
        evidence = climb.after(chapter, evidence, attempt)
    assert "i5" in evidence.held_ideas
    assert climb.mastered(chapter, "t4", evidence)


# =================================================================================================
# 4. Where they went wrong is said, in this concept's own words
# =================================================================================================


def test_every_step_carries_a_reason_drawn_from_the_pool_s_own_declarations() -> None:
    """Never "incorrect, try again", and never a generic hint. The reason a module follows is the
    architect's own sentence for the idea, the misconception, the ground, or the route out."""
    chapter = pool()
    declared = {i.what for i in chapter.ideas}
    declared |= {m.what for m in chapter.misconceptions}
    declared |= {a.what for a in chapter.assumptions}
    declared |= {r.why for r in chapter.flow.stuck}
    declared.add(chapter.thread)

    def stumbling(module: BlueprintModule, evidence: climb.Evidence) -> climb.Attempt:
        return climb.Attempt(module.id, right=evidence.wrong.count(module.id) >= 1, showed=("x1",))

    steps, _ = play(chapter, "t1", stumbling)
    for step in steps:
        assert step.why in declared, f"{step.kind} reached for a line the pool never wrote"


def test_the_repair_s_reason_is_the_misconception_in_this_chapter_s_own_words() -> None:
    chapter = pool()
    evidence = climb.after(chapter, climb.Evidence(), climb.Attempt("p9", False, showed=("x2",)))
    step = climb.next_step(chapter, "t4", evidence)
    assert step.why == "a heavier object always presses harder, whatever it stands on"


def test_no_reason_the_climb_hands_over_would_fail_the_register() -> None:
    """The lines come out of a pool the deterministic gate has already cleared, so this holds by
    construction. It is asserted anyway, because "by construction" is how a law stops being one."""
    chapter = pool()
    for topic in ("t1", "t3", "t4", "t5"):
        steps, _ = play(chapter, topic, second_time_lucky)
        for step in steps:
            assert "—" not in step.why and "–" not in step.why
            assert "!" not in step.why
            assert step.why.strip(), f"{step.kind} had nothing to say"


# =================================================================================================
# 5. It costs nothing, and a miss costs the learner nothing
# =================================================================================================


def test_choosing_a_group_never_reaches_a_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """ "Adapting to a learner costs nothing, because it is choosing from a pool that already
    exists." A model call anywhere in the climb is the defect itself, so the seam is made to
    explode and a whole struggling climb is played through it."""
    from wobo_gateway import model_call

    def never(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("the climb reached for a model; choosing a group is a selection")

    monkeypatch.setattr(model_call, "complete", never)

    chapter = pool()
    steps, _ = play(chapter, "t1", always_wrong)
    assert steps


def test_a_miss_never_takes_anything_away_from_the_learner() -> None:
    """docs/LEVELS.md section 4: nothing is deducted, ever. An idea once evidenced stays held when
    a later module goes wrong, because a wrong answer costs nothing."""
    chapter = pool()
    evidence = climb.after(chapter, climb.Evidence(), climb.Attempt("p9", right=True))
    assert "i5" in evidence.held_ideas
    after_a_miss = climb.after(chapter, evidence, climb.Attempt("c2", right=False))
    assert "i5" in after_a_miss.held_ideas


def test_the_side_door_and_the_boss_are_never_inside_a_topic_s_climb() -> None:
    """A side door is optional and never in the path; the boss is the chapter's and is the only
    thing that tests across topics, so it is never inside one topic's climb."""
    chapter = pool()
    for topic in ("t1", "t3", "t5"):
        steps, _ = play(chapter, topic, second_time_lucky)
        for step in steps:
            if step.module is not None:
                assert step.module.role not in ("side_door", "boss")


# =================================================================================================
# 6. The learner is never left
# =================================================================================================


def test_a_learner_who_misses_everything_twice_is_still_handed_something_every_time() -> None:
    """No dead end. A learner who never gets anything right is given module after module out of
    the chapter's pool, and when the pool really is spent the climb still says which idea is open
    rather than showing an empty screen."""
    chapter = pool()
    steps, evidence = play(chapter, "t1", always_wrong)
    handed = taught(steps)
    assert len(handed) >= 6, "a learner who is struggling was given almost nothing"
    last = steps[-1]
    assert last.module is None
    assert last.kind == "pool_spent"
    assert last.why.strip(), "the last thing a struggling learner meets must still say something"
    assert not climb.mastered(chapter, "t1", evidence)


def test_when_both_ways_in_are_spent_the_climb_still_hands_something_from_the_pool() -> None:
    chapter = pool()
    evidence = climb.Evidence()
    for module_id in ("p11", "p12"):
        for _ in range(2):
            evidence = climb.after(chapter, evidence, climb.Attempt(module_id, right=False))
    step = climb.next_step(chapter, "t5", evidence)
    assert step.module is not None, "both ways in are spent and the pool still holds more"
    assert step.module.id not in ("p11", "p12")


def test_the_pool_is_reached_across_the_CHAPTER_and_not_only_inside_one_topic() -> None:
    """A module lives in the CHAPTER'S pool rather than inside a topic, which is exactly why a
    module filed under another topic can still be reached for when it teaches the idea this
    learner still needs (docs/LEARNING-MODEL.md section 1)."""

    def file_the_repair_elsewhere(raw: dict[str, Any]) -> None:
        for module in raw["modules"]:
            if module["id"] == "r3":
                module["serves"] = ["t2"]

    chapter = altered(file_the_repair_elsewhere)
    evidence = climb.Evidence()
    for module_id in ("p11", "p12", "c2"):
        for _ in range(2):
            evidence = climb.after(chapter, evidence, climb.Attempt(module_id, right=False))
    step = climb.next_step(chapter, "t5", evidence)
    assert step.module is not None and step.module.id == "r3"


def test_the_ground_is_laid_first_for_a_learner_who_has_not_shown_it() -> None:
    """A learner who has not held the earlier idea gets the module that lays it pulled into their
    group, and it comes first because everything after it leans on it."""
    chapter = pool()
    behind = climb.Evidence(unmet_assumptions=("a2",))
    step = climb.next_step(chapter, "t4", behind)
    assert step.module is not None and step.module.id == "q2"
    assert step.kind == "ground"
    assert step.why == "area of a rectangle"


def test_a_topic_the_chapter_never_had_is_an_empty_climb_and_never_a_guess() -> None:
    chapter = pool()
    step = climb.next_step(chapter, "t99", climb.Evidence())
    assert step.module is None
    assert step.kind == "pool_spent"
    assert not climb.mastered(chapter, "t99", climb.Evidence())
