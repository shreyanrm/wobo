"""The architect (``create.blueprint``): the schema, the refusals, the judge, the hold, the store.

**What this file holds the architect to.** docs/CONTENT-INTERACTION.md section 9 and, where the
two differ, docs/LEARNING-MODEL.md, which wins: the architect's output is a CHAPTER'S POOL of
modules plus the map of which module can teach which topic, not a linear list of levels inside a
topic. A group of modules teaches a topic, the group is chosen per learner from the pool, and a
pool that cannot serve a learner who missed the prerequisite is an incomplete pool.

Every test here is keyless and offline: the create tier is a fake caller, exactly as the wave's
rule says (the mock or Luna under the local ceiling; never Astra).
"""

from __future__ import annotations

import copy
import json
from typing import Any

import pytest
from blueprint_fixture import blueprint as good_blueprint
from blueprint_fixture import brief as good_brief
from wobo_gateway.plexus import blueprint as bp

# --- helpers ------------------------------------------------------------------------------------


def brief() -> bp.NodeBrief:
    return bp.NodeBrief.from_dict(good_brief())


def draft(**changes: Any) -> dict[str, Any]:
    """The good blueprint with top-level fields replaced."""
    out = copy.deepcopy(good_blueprint())
    out.update(changes)
    return out


def module(raw: dict[str, Any], mid: str) -> dict[str, Any]:
    for m in raw["modules"]:
        if m["id"] == mid:
            return m
    raise KeyError(mid)


def refusals(raw: dict[str, Any]) -> list[str]:
    parsed = bp.parse(raw)
    assert parsed is not None, "the fixture must parse before its refusals mean anything"
    return bp.refusals(parsed, brief())


class FakeCaller:
    """A create-tier stand-in that answers a queue of drafts and records who was asked."""

    def __init__(self, *answers: Any) -> None:
        self.answers = list(answers)
        self.models: list[str] = []
        self.prompts: list[str] = []

    def __call__(self, *, model: str, system: str, user: str, max_tokens: int) -> str:
        self.models.append(model)
        self.prompts.append(user)
        if not self.answers:
            raise AssertionError("the architect was called more times than the wave allows")
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer if isinstance(answer, str) else json.dumps(answer, ensure_ascii=False)


def verdict(score: float, critical: bool = False, weak: list[str] | None = None) -> dict[str, Any]:
    return {"score": score, "critical": critical, "weak": weak or [], "notes": "a note"}


# --- 1. the schema ------------------------------------------------------------------------------


def test_the_good_blueprint_parses_and_is_refused_for_nothing() -> None:
    parsed = bp.parse(good_blueprint())
    assert parsed is not None
    assert bp.refusals(parsed, brief()) == []


def test_the_schema_refuses_a_field_it_does_not_declare() -> None:
    """Nothing generated ever executes on a learner's device, so a key the contract does not
    declare is refused rather than carried: an unmodelled ``script`` or ``code`` field is how
    executable content would arrive."""
    raw = draft()
    module(raw, "p1")["script"] = "alert(1)"
    assert bp.parse(raw) is None


def test_a_mechanic_is_a_composition_of_declared_primitives_only() -> None:
    raw = draft()
    module(raw, "p1")["mechanics"][0]["primitives"] = ["eval"]
    assert bp.parse(raw) is None


def test_every_level_carries_the_six_things_the_architect_owes() -> None:
    """aim, kind, the concept cores it needs, the misconception it targets, its minutes, and what
    it assumes (docs/CONTENT-INTERACTION.md section 9)."""
    parsed = bp.parse(good_blueprint())
    assert parsed is not None
    for m in parsed.modules:
        assert m.aim and m.kind and m.minutes
        assert isinstance(m.cores, list) and m.cores
        assert isinstance(m.assumes, list)
        assert 2 <= len(m.mechanics) <= 3


# --- 2. the refusals ----------------------------------------------------------------------------


def test_refuses_a_level_outside_the_syllabus_node() -> None:
    raw = draft()
    module(raw, "p1")["serves"] = ["t9"]
    assert any("t9" in r for r in refusals(raw))


def test_refuses_a_topic_the_board_did_not_put_in_this_chapter() -> None:
    raw = draft()
    raw["topics"] = [*raw["topics"], {"id": "t6", "name": "Gravitation"}]
    assert any("outside the node" in r for r in refusals(raw))


def test_refuses_a_missing_chapter_part() -> None:
    """Nothing missing from the node: a topic of the board's own outline that no module teaches."""
    raw = draft()
    raw["topics"] = [t for t in raw["topics"] if t["id"] != "t3"]
    assert any("t3" in r and "missing" in r for r in refusals(raw))


def test_refuses_a_topic_no_module_serves() -> None:
    raw = draft()
    for m in raw["modules"]:
        m["serves"] = [s for s in m["serves"] if s != "t5"]
    assert any("t5" in r for r in refusals(raw))


def test_refuses_a_narrating_word() -> None:
    """DESIGN.md section 0.x: the product does not announce what it is about to do."""
    raw = draft()
    module(raw, "p1")["aim"] = "let me show you how a push works"
    assert any("narrat" in r for r in refusals(raw))


def test_refuses_an_em_dash_in_a_line_a_learner_reads() -> None:
    raw = draft()
    module(raw, "p2")["aim"] = "draw the arrow — then name it"
    assert any("em dash" in r for r in refusals(raw))


def test_refuses_a_late_hour() -> None:
    """The hours law: never a late hour, in any form (docs/copy/voice.md section 10)."""
    raw = draft()
    module(raw, "p5")["aim"] = "run the ball trial again at 11 pm"
    assert any("late hour" in r for r in refusals(raw))


def test_refuses_a_module_longer_than_one_sitting() -> None:
    """A module is one sitting: five to ten minutes (docs/LEARNING-MODEL.md section 1)."""
    raw = draft()
    module(raw, "p1")["minutes"] = 45
    assert any("minutes" in r for r in refusals(raw))


def test_refuses_a_pool_that_overruns_the_chapter_s_hours() -> None:
    raw = draft()
    for m in raw["modules"]:
        m["minutes"] = 10
    assert any("budget" in r for r in refusals(raw))


def test_refuses_hype_and_an_exclamation_mark() -> None:
    raw = draft()
    module(raw, "p1")["aim"] = "unlock your potential"
    assert any("register" in r for r in refusals(raw))


# --- 3. the pool laws (docs/LEARNING-MODEL.md section 5) ------------------------------------------


def test_refuses_a_pool_with_one_way_into_an_idea() -> None:
    raw = draft()
    raw["modules"] = [m for m in raw["modules"] if m["id"] != "p2"]
    raw["flow"]["order"] = [m for m in raw["flow"]["order"] if m != "p2"]
    raw["flow"]["skippable"] = [m for m in raw["flow"]["skippable"] if m != "p2"]
    assert any("i1" in r and "two ways in" in r for r in refusals(raw))


def test_refuses_a_pool_with_a_misconception_nothing_repairs() -> None:
    raw = draft()
    raw["modules"] = [m for m in raw["modules"] if m["id"] != "r2"]
    raw["flow"]["order"] = [m for m in raw["flow"]["order"] if m != "r2"]
    assert any("x2" in r and "repair" in r for r in refusals(raw))


def test_refuses_a_pool_that_cannot_serve_a_learner_who_missed_the_prerequisite() -> None:
    """The named fault in docs/LEARNING-MODEL.md section 5."""
    raw = draft()
    raw["modules"] = [m for m in raw["modules"] if m["id"] != "q2"]
    raw["flow"]["order"] = [m for m in raw["flow"]["order"] if m != "q2"]
    raw["flow"]["stuck"] = [s for s in raw["flow"]["stuck"] if s["instead"] != "q2"]
    assert any("a2" in r and "prerequisite" in r for r in refusals(raw))


def test_refuses_a_pool_with_nothing_for_the_learner_who_already_holds_it() -> None:
    raw = draft()
    raw["modules"] = [m for m in raw["modules"] if m["id"] != "s1"]
    raw["flow"]["order"] = [m for m in raw["flow"]["order"] if m != "s1"]
    assert any("stretch" in r for r in refusals(raw))


def test_refuses_an_assumption_a_module_names_but_the_blueprint_never_declared() -> None:
    raw = draft()
    module(raw, "p1")["assumes"] = ["a9"]
    assert any("a9" in r for r in refusals(raw))


# --- 4. the flow --------------------------------------------------------------------------------


def test_refuses_an_order_that_drops_a_module() -> None:
    raw = draft()
    raw["flow"]["order"] = raw["flow"]["order"][:-1]
    assert any("order" in r for r in refusals(raw))


def test_refuses_a_boss_that_is_not_the_summit() -> None:
    raw = draft()
    raw["flow"]["boss"] = "p1"
    assert any("boss" in r for r in refusals(raw))


def test_refuses_a_boss_that_does_not_test_across_every_topic() -> None:
    """The boss is the only thing that tests more than one topic at a time, which is the point of
    it (docs/LEARNING-MODEL.md section 3). A boss that skips a topic leaves the chapter untested."""
    raw = draft()
    module(raw, "b1")["serves"] = ["t1", "t2"]
    assert any("boss" in r and "t5" in r for r in refusals(raw))


def test_refuses_a_pool_that_reaches_for_one_mechanic_over_and_over() -> None:
    """A pool whose every module is the same act is a quiz with a skin, whatever it is called."""
    raw = draft()
    for m in raw["modules"]:
        for mech in m["mechanics"]:
            mech["primitives"] = ["tap"]
    assert any("mechanic" in r for r in refusals(raw))


def test_refuses_a_side_door_that_sits_in_the_path() -> None:
    """Optional, never in the path, never a nag (docs/CONTENT-INTERACTION.md section 7)."""
    raw = draft()
    raw["flow"]["order"] = [*raw["flow"]["order"], "g1"]
    assert any("side door" in r for r in refusals(raw))


def test_refuses_a_side_door_at_the_end_of_the_climb() -> None:
    """In the middle, not the end: the boss stays the summit."""
    raw = draft()
    raw["flow"]["sideDoors"][0]["after"] = "b1"
    assert any("side door" in r for r in refusals(raw))


def test_refuses_a_skip_of_something_that_may_never_be_skipped() -> None:
    raw = draft()
    raw["flow"]["skippable"] = [*raw["flow"]["skippable"], "b1"]
    assert any("skip" in r for r in refusals(raw))


def test_refuses_a_blueprint_that_says_nothing_about_a_stuck_learner() -> None:
    raw = draft()
    raw["flow"]["stuck"] = []
    assert any("stuck" in r for r in refusals(raw))


def test_refuses_a_stuck_route_that_leads_back_to_the_same_module() -> None:
    raw = draft()
    raw["flow"]["stuck"][0]["instead"] = raw["flow"]["stuck"][0]["module"]
    assert any("stuck" in r for r in refusals(raw))


# --- 5. the judge -------------------------------------------------------------------------------


def test_the_judge_passes_a_clean_blueprint() -> None:
    scored = bp.judge(
        good_blueprint(), brief(), caller=FakeCaller(verdict(88)), judge_model="fake/verify"
    )
    assert scored is not None
    assert bp.judge_passes(scored)


def test_the_judge_fails_a_blueprint_under_the_bar() -> None:
    scored = bp.judge(
        good_blueprint(), brief(), caller=FakeCaller(verdict(41)), judge_model="fake/verify"
    )
    assert scored is not None and not bp.judge_passes(scored)


def test_a_critical_verdict_never_passes_whatever_the_score() -> None:
    scored = bp.judge(
        good_blueprint(),
        brief(),
        caller=FakeCaller(verdict(99, critical=True)),
        judge_model="fake/verify",
    )
    assert scored is not None and not bp.judge_passes(scored)


def test_an_unreachable_judge_is_not_a_pass() -> None:
    """An unknown is not a pass: the same law validate.py learned the hard way."""
    scored = bp.judge(
        good_blueprint(),
        brief(),
        caller=FakeCaller(RuntimeError("verify tier is out")),
        judge_model="fake/verify",
    )
    assert scored is None
    assert not bp.judge_passes(scored)


def test_the_judge_reads_the_syllabus_node_it_is_scoring_against() -> None:
    caller = FakeCaller(verdict(80))
    bp.judge(good_blueprint(), brief(), caller=caller, judge_model="fake/verify")
    asked = caller.prompts[0]
    assert "Force and Pressure" in asked and "CBSE" in asked and "class 8" in asked


# --- 6. build: one regeneration on the second rung, then the hold --------------------------------


def test_a_clean_first_draft_is_stored_canonical_and_costs_one_create_call(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    caller = FakeCaller(good_blueprint())
    result = bp.build(
        brief(),
        caller=caller,
        judge_caller=FakeCaller(verdict(86)),
        judge_model="fake/verify",
    )
    assert result.status == bp.CANONICAL
    assert len(caller.models) == 1
    assert caller.models[0] == bp.create_primary()


def test_a_refused_draft_is_regenerated_once_on_the_create_tier_s_second_rung(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    bad = draft()
    module(bad, "p1")["serves"] = ["t9"]  # a level outside the node
    caller = FakeCaller(bad, good_blueprint())
    result = bp.build(
        brief(),
        caller=caller,
        judge_caller=FakeCaller(verdict(84)),
        judge_model="fake/verify",
    )
    assert result.status == bp.CANONICAL
    assert caller.models == [bp.create_primary(), bp.create_second_rung()]


def test_the_second_draft_is_told_what_the_first_was_refused_for(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    bad = draft()
    module(bad, "p1")["serves"] = ["t9"]
    caller = FakeCaller(bad, good_blueprint())
    bp.build(
        brief(), caller=caller, judge_caller=FakeCaller(verdict(84)), judge_model="fake/verify"
    )
    second = caller.prompts[1]
    assert "t9" in second
    # ON TOP, not appended. The first live Luna run came back with the same twelve refusals
    # unchanged when the list sat after the brief; a cheap model reads the head of a long message.
    assert second.index("t9") < second.index('"topics"')


def test_a_draft_the_schema_refuses_is_told_which_field_broke_it(tmp_path, monkeypatch) -> None:
    """A refusal the next attempt cannot read is a refusal that buys nothing. The first live Luna
    run spent a whole second rung on "the draft is not a blueprint" and learned nothing from it."""
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    broken = draft()
    module(broken, "p1")["minutes"] = "seven"
    caller = FakeCaller(broken, good_blueprint())
    bp.build(
        brief(), caller=caller, judge_caller=FakeCaller(verdict(88)), judge_model="fake/verify"
    )
    second = caller.prompts[1]
    assert "minutes" in second.split('"topics"')[0]


def test_a_second_refusal_is_held_for_the_superadmin_and_never_served(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    bad = draft()
    module(bad, "p1")["serves"] = ["t9"]
    caller = FakeCaller(bad, copy.deepcopy(bad))
    result = bp.build(
        brief(), caller=caller, judge_caller=FakeCaller(verdict(84)), judge_model="fake/verify"
    )
    assert result.status == bp.HELD
    assert result.blueprint is None
    assert bp.load(brief()) is None, "a held blueprint is never served"
    assert len(caller.models) == 2, "the hold costs exactly two create calls, never a third"


def test_a_judge_failure_buys_exactly_one_rebuild_then_holds(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    caller = FakeCaller(good_blueprint(), good_blueprint())
    result = bp.build(
        brief(),
        caller=caller,
        judge_caller=FakeCaller(verdict(30), verdict(35)),
        judge_model="fake/verify",
    )
    assert result.status == bp.HELD
    assert len(caller.models) == 2


def test_an_unreachable_judge_holds_rather_than_promoting_unscored(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    caller = FakeCaller(good_blueprint(), good_blueprint())
    result = bp.build(
        brief(),
        caller=caller,
        judge_caller=FakeCaller(RuntimeError("out"), RuntimeError("out")),
        judge_model="fake/verify",
    )
    assert result.status == bp.HELD


def test_a_held_blueprint_is_kept_forever_with_its_reasons(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    bad = draft()
    module(bad, "p1")["serves"] = ["t9"]
    bp.build(
        brief(),
        caller=FakeCaller(bad, copy.deepcopy(bad)),
        judge_caller=FakeCaller(verdict(84)),
        judge_model="fake/verify",
    )
    held = bp.held(brief())
    assert len(held) == 2
    assert all(any("t9" in r for r in row["reasons"]) for row in held)


# --- 7. the store round trip --------------------------------------------------------------------


def test_the_store_round_trips_a_blueprint(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    bp.build(
        brief(),
        caller=FakeCaller(good_blueprint()),
        judge_caller=FakeCaller(verdict(90)),
        judge_model="fake/verify",
    )
    loaded = bp.load(brief())
    assert loaded is not None
    assert loaded.chapter == "Force and Pressure"
    assert [m.id for m in loaded.modules] == [m["id"] for m in good_blueprint()["modules"]]


def test_the_key_is_node_by_board_by_class_by_version(tmp_path, monkeypatch) -> None:
    """A CBSE class 8 blueprint is not an ICSE class 8 blueprint, and a syllabus revision misses."""
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    base = good_brief()
    keys = set()
    for change in (
        {},
        {"board": "ICSE"},
        {"grade": "9"},
        {"contentVersion": "2027-28"},
        {"chapter": "Sound"},
    ):
        keys.add(str(bp.path(bp.NodeBrief.from_dict({**base, **change}))))
    assert len(keys) == 5


def test_a_second_build_is_served_from_the_store_and_pays_nothing(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    bp.build(
        brief(),
        caller=FakeCaller(good_blueprint()),
        judge_caller=FakeCaller(verdict(90)),
        judge_model="fake/verify",
    )
    again = bp.build(brief(), caller=FakeCaller(), judge_caller=FakeCaller(), judge_model="x")
    assert again.status == bp.CANONICAL
    assert again.cached is True


# --- 8. the group: choosing costs nothing --------------------------------------------------------


def test_a_group_of_modules_teaches_a_topic_and_the_group_is_a_selection() -> None:
    """docs/LEARNING-MODEL.md section 2: the pool is fixed, the group is chosen per learner."""
    parsed = bp.parse(good_blueprint())
    assert parsed is not None
    plain = bp.group_for(parsed, "t4", bp.LearnerState())
    assert [m.id for m in plain], "a topic with no group is a topic nobody can learn"
    assert all("t4" in m.serves for m in plain)
    assert plain[-1].role != "side_door"


def test_a_learner_who_missed_the_prerequisite_gets_the_repair_module_in_their_group() -> None:
    parsed = bp.parse(good_blueprint())
    assert parsed is not None
    behind = bp.group_for(parsed, "t4", bp.LearnerState(unmet_assumptions=("a2",)))
    assert "q2" in [m.id for m in behind]


def test_a_learner_who_shows_a_misconception_gets_its_repair_and_nobody_else_does() -> None:
    parsed = bp.parse(good_blueprint())
    assert parsed is not None
    shown = bp.group_for(parsed, "t4", bp.LearnerState(misconceptions=("x2",)))
    clean = bp.group_for(parsed, "t4", bp.LearnerState())
    assert "r2" in [m.id for m in shown]
    assert "r2" not in [m.id for m in clean]


def test_a_learner_who_already_holds_the_topic_is_taken_to_the_stretch_not_the_confirmations() -> (
    None
):
    parsed = bp.parse(good_blueprint())
    assert parsed is not None
    fast = bp.group_for(parsed, "t4", bp.LearnerState(held_ideas=("i5",)))
    ids = [m.id for m in fast]
    assert "s1" in ids
    assert "p10" not in ids, "a module that only confirms what is held is not shown again"


def test_two_learners_walk_two_paths_and_both_can_reach_mastery() -> None:
    parsed = bp.parse(good_blueprint())
    assert parsed is not None
    one = bp.group_for(parsed, "t4", bp.LearnerState(style=("simulation",)))
    two = bp.group_for(parsed, "t4", bp.LearnerState(style=("worked",)))
    assert [m.id for m in one] != [m.id for m in two]
    for group in (one, two):
        taught = {idea for m in group for idea in m.teaches}
        needed = {i.id for i in parsed.ideas if "t4" in i.topics}
        assert needed <= taught, "a group that cannot teach the topic's ideas is not a group"


# --- 9. the money -------------------------------------------------------------------------------


def test_the_architect_is_platform_paid_and_never_a_learner_s_allowance() -> None:
    from wobo_gateway import registry

    assert registry.platform_paid("create.blueprint")
    assert registry.policy("create.blueprint").tier.value == "create"


def test_the_architect_never_takes_a_learner() -> None:
    """Input is never a person (docs/CONTENT-INTERACTION.md section 9)."""
    fields = set(bp.NodeBrief.__dataclass_fields__)
    for personal in ("learner", "subject_id", "user", "name", "archetype_of"):
        assert personal not in fields
    text = json.dumps(bp.brief_payload(brief()))
    assert "learner-" not in text


def test_the_brief_carries_the_archetypes_we_teach_never_a_person() -> None:
    payload = bp.brief_payload(brief())
    assert payload["archetypes"] == ["the one who draws it", "the one who checks the numbers"]


@pytest.mark.parametrize("bad", ["", "   "])
def test_a_node_with_no_name_is_refused_before_a_model_is_paid(bad: str) -> None:
    with pytest.raises(ValueError):
        bp.NodeBrief.from_dict({**good_brief(), "chapter": bad})


# --- 10. the seam: a cell's course is built from the blueprint, not from a mechanical split -------


def test_a_module_renders_through_the_ordinary_generate_tier_and_carries_its_cell() -> None:
    """The blueprint is the platform's; RENDERING each module for the cell stays on generate and is
    the learner's, exactly as it was (docs/LEARNING-MODEL.md section 4)."""
    parsed = bp.parse(good_blueprint())
    assert parsed is not None
    payload = bp.compose_brief(parsed, parsed.modules[0], brief())
    for key, value in (
        ("board", "CBSE"),
        ("grade", "8"),
        ("subject", "Science"),
        ("chapter", "Force and Pressure"),
        ("contentVersion", "2026-27"),
    ):
        assert payload[key] == value


def test_a_module_s_brief_carries_the_thread_the_idea_and_the_mechanic_it_must_embody() -> None:
    parsed = bp.parse(good_blueprint())
    assert parsed is not None
    module_ = parsed.module_by_id("r2")
    assert module_ is not None
    payload = bp.compose_brief(parsed, module_, brief())
    assert payload["thread"] == parsed.thread
    assert "pressure is the force spread over the area it presses on" in payload["ideas"]
    assert (
        payload["misconception"] == "a heavier object always presses harder, whatever it stands on"
    )
    assert payload["mechanic"]["primitives"]
    assert payload["cores"] == ["pressure"]


def test_the_mechanic_rotates_through_the_stored_candidates_and_never_off_the_end() -> None:
    """The ninety-day variety comes from the stored candidates, never from paying the create tier
    again (docs/CONTENT-INTERACTION.md section 8)."""
    parsed = bp.parse(good_blueprint())
    assert parsed is not None
    module_ = parsed.modules[0]
    picks = [bp.mechanic_for(module_, i)["id"] for i in range(5)]
    assert picks[0] != picks[1]
    assert picks[2] == picks[0], "two candidates rotate with period two"
    assert bp.mechanic_for(module_, -1)["id"] == picks[1]


def test_the_free_text_goal_course_is_untouched_by_any_of_this() -> None:
    """`generate.course` is a learner's own ask and stays theirs to pay for: a different tier, a
    different capability, and nothing in this module reaches it."""
    import inspect

    from wobo_gateway import registry

    assert registry.policy("generate.course").tier.value == "generate"
    assert not registry.platform_paid("generate.course")
    assert "generate.course" not in inspect.getsource(bp)


# --- 11. the judge must see the whole blueprint --------------------------------------------------


def test_the_judge_is_handed_the_whole_blueprint() -> None:
    """Found live: the judge's payload was capped at 24,000 characters, so sol was scoring a
    document cut off partway through and reported, correctly, that the blueprint was "truncated".
    A judge that scores half an artifact is worse than no judge, because its verdict is believed."""
    caller = FakeCaller(verdict(80))
    whole = good_blueprint()
    bp.judge(whole, brief(), caller=caller, judge_model="fake/verify")
    asked = caller.prompts[0]
    assert json.dumps(whole, ensure_ascii=False) in asked
    for module_ in whole["modules"]:
        assert f'"{module_["id"]}"' in asked, module_["id"]


def test_a_blueprint_too_big_even_for_the_judge_says_so_out_loud() -> None:
    """A cut can still happen on a monstrous pool. It is never silent: the prompt says the document
    was shortened, so the verdict is read as a verdict on part of it."""
    caller = FakeCaller(verdict(80))
    huge = good_blueprint()
    huge["modules"] = huge["modules"] * 60
    bp.judge(huge, brief(), caller=caller, judge_model="fake/verify")
    assert "shortened" in caller.prompts[0]


def test_refuses_two_ways_in_that_are_the_same_way_twice() -> None:
    """Two ways in "taught differently" (docs/LEARNING-MODEL.md section 5).

    Two simulations of the same thing are one way in written out twice, and a learner the first one
    lost is lost by the second for exactly the same reason."""
    raw = draft()
    module(raw, "p2")["kind"] = module(raw, "p1")["kind"]
    assert any("i1" in r and "same way" in r for r in refusals(raw))


def test_refuses_ground_laid_after_what_stands_on_it() -> None:
    """The judge caught this twice on live Luna drafts: a prerequisite module sitting AFTER the
    modules that need it. A pool can hold every prerequisite it owes and still be useless if the
    learner meets them last, so the order carries the rule and not just the pool."""
    raw = draft()
    order = [m for m in raw["flow"]["order"] if m != "q2"]
    raw["flow"]["order"] = [*order, "q2"] if order[-1] != "b1" else [*order[:-1], "q2", "b1"]
    assert any("q2" in r and "before" in r for r in refusals(raw))
