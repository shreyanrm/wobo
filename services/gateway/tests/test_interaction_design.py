"""The interaction designer and its gate (docs/CONTENT-INTERACTION.md §2 and §3).

Three things are proved here, on three concepts that sit on three different rows of §2:

1. **The vocabulary is a contract.** Every primitive is a Pydantic model with a feedback slot
   and a hit area a finger can use at 390, and the schema refuses a target smaller than the
   44 css px law. Nothing generated executes: a design is a composition, and a composition the
   schema refuses never ships.
2. **The designer writes the mechanic, on the ladder.** It starts at luna, climbs ONE rung when
   the gate refuses, and after two refusals the concept's template floor takes over — so quality
   never falls under the floor and the bill never climbs past two rungs.
3. **The gate is not a formality.** It refuses a quiz with a skin (all recognition, no move), a
   repeat of the chapter's last three, and a target a finger cannot land on — deterministically,
   before a judge is ever paid.

Mock mode only: the designer's model call and the design judge are monkeypatched, so no network
and no keys.
"""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError
from wobo_gateway.plexus import engines, specs, validate
from wobo_gateway.routing import generation_ladder

# --- small builders -------------------------------------------------------------------------

MIN = specs.MIN_HIT_UNITS


def box(x: float = 0.0, y: float = 0.0, w: float = MIN, h: float = MIN) -> specs.HitBox:
    return specs.HitBox(x=x, y=y, w=w, h=h)


def fb(
    right: str = "the two shares are the same size",
    wrong: str = "count the pieces again: eight of sixteen is still half the bar",
) -> specs.Feedback:
    return specs.Feedback(right=right, wrong=wrong)


def drop_design(concept: str = "equivalent fractions") -> specs.InteractionDesign:
    """A classification design: two bins, four tokens, a reveal. Genuinely a move."""
    return specs.InteractionDesign(
        id="d-drop",
        concept=concept,
        kind="classify",
        mechanic="drop each fraction onto the bar it covers",
        why="the learner must decide which fractions name the same share, which is the idea",
        steps=[
            specs.InteractionStep(
                id="s1",
                beat="build",
                primitive=specs.DropInteraction(
                    kind="drop",
                    prompt="drop each card onto the bar it covers",
                    tokens=[
                        specs.DropToken(
                            id=f"t{i}",
                            label=lbl,
                            box=box(x=2 + 15 * i, y=45),
                            belongs=zone,
                            why="it covers the same share",
                        )
                        for i, (lbl, zone) in enumerate(
                            [("1/2", "z1"), ("2/4", "z1"), ("1/3", "z2"), ("2/6", "z2")]
                        )
                    ],
                    zones=[
                        specs.DropZone(
                            id="z1",
                            label="half the bar",
                            box=box(x=5, y=5, w=40, h=25),
                            accepts=["t0", "t1"],
                            feedback=fb(),
                        ),
                        specs.DropZone(
                            id="z2",
                            label="a third of the bar",
                            box=box(x=55, y=5, w=40, h=25),
                            accepts=["t2", "t3"],
                            feedback=fb(),
                        ),
                    ],
                    feedback=fb(),
                ),
                surprise="the two cards settle to exactly the same width",
            ),
            specs.InteractionStep(
                id="s2",
                beat="check",
                primitive=specs.RevealSpec(
                    kind="reveal",
                    trigger="onDone",
                    what="both bars shade to the same length",
                    feedback=fb(),
                ),
            ),
        ],
    )


def sort_design(concept: str = "the non-cooperation movement") -> specs.InteractionDesign:
    return specs.InteractionDesign(
        id="d-sort",
        concept=concept,
        kind="order",
        mechanic="drag the four events into the year they happened",
        why="the movement only makes sense in its order: each event answers the one before it",
        steps=[
            specs.InteractionStep(
                id="s1",
                beat="build",
                primitive=specs.SortInteraction(
                    kind="sort",
                    prompt="put the four events in order",
                    items=[
                        specs.SortItem(
                            id=f"i{i}",
                            label=lbl,
                            box=box(x=5, y=2 + 14 * i, w=80, h=13.5),
                            rank=i + 1,
                            why="it answers the event before it",
                        )
                        for i, lbl in enumerate(
                            [
                                "Rowlatt Act",
                                "Jallianwala Bagh",
                                "the call to boycott",
                                "Chauri Chaura",
                            ]
                        )
                    ],
                    feedback=fb(
                        wrong="Chauri Chaura is why the movement stopped, so it cannot come first"
                    ),
                ),
            ),
            specs.InteractionStep(
                id="s2",
                beat="fun",
                primitive=specs.TimerSpec(
                    kind="timer", seconds=60, onExpire="reveal", feedback=fb()
                ),
            ),
        ],
    )


def slide_design(concept: str = "nature of roots") -> specs.InteractionDesign:
    return specs.InteractionDesign(
        id="d-slide",
        concept=concept,
        kind="vary",
        mechanic="slide the discriminant and watch the parabola cross the axis",
        why="the number of roots IS where the curve meets the axis, and only moving it shows that",
        steps=[
            specs.InteractionStep(
                id="s1",
                beat="build",
                primitive=specs.SlideInteraction(
                    kind="slide",
                    prompt="slide c and watch the curve",
                    min=-8,
                    max=8,
                    **{"from": -8},
                    at=0,
                    feedback=fb(
                        wrong="the curve left the axis, so there is nothing real to solve for"
                    ),
                ),
            ),
            specs.InteractionStep(
                id="s2",
                beat="check",
                primitive=specs.CanvasMarkInteraction(
                    kind="mark",
                    prompt="mark every point where the curve meets the axis",
                    tool="point",
                    targets=[
                        specs.CanvasTarget(id="r1", x=32, y=40, why="one root"),
                        specs.CanvasTarget(id="r2", x=68, y=40, why="the other root"),
                    ],
                    need=2,
                    feedback=fb(),
                ),
            ),
        ],
    )


def quiz_with_a_skin() -> specs.InteractionDesign:
    """Four options and a tap. No tap can be wrong in a way that teaches; nothing moves."""
    return specs.InteractionDesign(
        id="d-quiz",
        concept="equivalent fractions",
        kind="discriminate",
        mechanic="pick the right one",
        why="the learner picks the equivalent fraction",
        steps=[
            specs.InteractionStep(
                id="s1",
                beat="check",
                primitive=specs.BranchInteraction(
                    kind="branch",
                    prompt="which fraction equals one half",
                    options=[
                        specs.BranchOption(
                            id="a",
                            label="2/4",
                            box=box(x=2, y=2, w=40, h=20),
                            correct=True,
                            teaches="",
                        ),
                        specs.BranchOption(
                            id="b",
                            label="1/3",
                            box=box(x=55, y=2, w=40, h=20),
                            correct=False,
                            teaches="a third is a smaller share than a half",
                        ),
                    ],
                    feedback=fb(),
                ),
            ),
            specs.InteractionStep(
                id="s2",
                beat="check",
                primitive=specs.TapInteraction(
                    kind="tap", prompt="tap the bar that matches", targets=["m1"], need=1
                ),
            ),
        ],
    )


CORE = {
    "concept": "equivalent fractions",
    "idea": "two fractions can name the same share of one whole",
    "why": "so a learner can compare and add unlike fractions",
    "misconceptions": [
        {"wrong": "a bigger denominator means a bigger fraction", "counter": "1/3 is less than 1/2"}
    ],
    "check": "given 3/4, name one fraction that covers the same share",
    "kind": "classify",
    "material": {
        "bins": [
            {"id": "z1", "label": "half the bar"},
            {"id": "z2", "label": "a third of the bar"},
        ],
        "tokens": [
            {"id": "t1", "label": "1/2", "bin": "z1", "why": "it is half"},
            {"id": "t2", "label": "2/4", "bin": "z1", "why": "two of four is half"},
            {"id": "t3", "label": "1/3", "bin": "z2", "why": "it is a third"},
            {"id": "t4", "label": "2/6", "bin": "z2", "why": "two of six is a third"},
        ],
        "items": [
            {"id": "q1", "label": "1/2", "why": "the smallest name for this share"},
            {"id": "q2", "label": "2/4", "why": "the same share, twice the pieces"},
            {"id": "q3", "label": "3/6", "why": "the same share again"},
        ],
        "options": [
            {"id": "o1", "label": "2/4", "correct": True, "teaches": "the same share, cut twice"},
            {
                "id": "o2",
                "label": "1/3",
                "correct": False,
                "teaches": "a third is a smaller share than a half",
            },
        ],
    },
}


# =============================================================================================
# 1. The vocabulary is a contract
# =============================================================================================


def test_every_primitive_of_section_three_exists_as_a_model() -> None:
    """Drop zones with rules, sort, match, sequence, timer, score, reveal, branch, canvas mark."""
    for kind in ("drop", "sort", "match", "sequence", "timer", "score", "reveal", "branch", "mark"):
        assert kind in specs.PRIMITIVE_MODELS, f"{kind} is not in the vocabulary"


def test_every_primitive_is_exported_to_the_generated_contract() -> None:
    from wobo_gateway.plexus import codegen

    defs = codegen.build_schema()["$defs"]
    for model in specs.PRIMITIVE_MODELS.values():
        assert model in specs.EXPORTED, f"{model.__name__} is not exported"
        assert model.__name__ in defs, f"{model.__name__} missing from the schema"


def test_every_primitive_carries_a_feedback_slot() -> None:
    """A wrong move must teach; a primitive with nowhere to say so cannot."""
    for kind, model in specs.PRIMITIVE_MODELS.items():
        assert "feedback" in model.model_fields, f"{kind} has no feedback slot"


def test_the_hit_floor_is_the_44_css_px_law_at_390() -> None:
    """13.33 viewBox units, from Discovery.tsx's own 3.3 px per unit at 390 wide."""
    assert specs.MIN_HIT_PX == 44.0
    assert pytest.approx(44.0 / 3.3, abs=1e-9) == specs.MIN_HIT_UNITS


def test_a_target_smaller_than_a_finger_is_refused_by_the_schema() -> None:
    with pytest.raises(ValidationError):
        specs.HitBox(x=0, y=0, w=8, h=MIN)
    with pytest.raises(ValidationError):
        specs.HitBox(x=0, y=0, w=MIN, h=6)
    assert specs.HitBox(x=0, y=0, w=MIN, h=MIN).w == MIN


def test_a_target_off_the_stage_is_refused() -> None:
    with pytest.raises(ValidationError):
        specs.HitBox(x=95, y=0, w=MIN, h=MIN)


def test_a_branch_needs_a_right_a_wrong_and_a_wrong_that_teaches() -> None:
    ok = specs.BranchInteraction(
        kind="branch",
        prompt="which one",
        options=[
            specs.BranchOption(
                id="a", label="2/4", box=box(2, 2, 40, 20), correct=True, teaches=""
            ),
            specs.BranchOption(
                id="b",
                label="1/3",
                box=box(55, 2, 40, 20),
                correct=False,
                teaches="a third is smaller",
            ),
        ],
        feedback=fb(),
    )
    assert len(ok.options) == 2
    with pytest.raises(ValidationError):  # every option correct: nothing to discriminate
        specs.BranchInteraction(
            kind="branch",
            prompt="which one",
            options=[
                specs.BranchOption(
                    id="a", label="2/4", box=box(2, 2, 40, 20), correct=True, teaches=""
                ),
                specs.BranchOption(
                    id="b", label="3/6", box=box(55, 2, 40, 20), correct=True, teaches=""
                ),
            ],
            feedback=fb(),
        )
    with pytest.raises(ValidationError):  # a wrong option that teaches nothing
        specs.BranchInteraction(
            kind="branch",
            prompt="which one",
            options=[
                specs.BranchOption(
                    id="a", label="2/4", box=box(2, 2, 40, 20), correct=True, teaches=""
                ),
                specs.BranchOption(
                    id="b", label="1/3", box=box(55, 2, 40, 20), correct=False, teaches="  "
                ),
            ],
            feedback=fb(),
        )


def test_a_drop_zone_rule_must_name_tokens_that_exist() -> None:
    with pytest.raises(ValidationError):
        specs.DropInteraction(
            kind="drop",
            prompt="drop them",
            tokens=[
                specs.DropToken(id="t1", label="1/2", box=box(2, 45), belongs="z1", why="half"),
                specs.DropToken(id="t2", label="2/4", box=box(20, 45), belongs="z1", why="half"),
            ],
            zones=[
                specs.DropZone(
                    id="z1",
                    label="half",
                    box=box(5, 5, 40, 25),
                    accepts=["t1", "ghost"],
                    feedback=fb(),
                ),
                specs.DropZone(
                    id="z2", label="third", box=box(55, 5, 40, 25), accepts=["t2"], feedback=fb()
                ),
            ],
            feedback=fb(),
        )


# =============================================================================================
# 2. The gate
# =============================================================================================


def test_the_gate_refuses_a_quiz_with_a_skin_without_paying_a_judge() -> None:
    calls: list[str] = []

    def judge(*a, **k):  # pragma: no cover - must never run
        calls.append("judged")
        return {"score": 100, "critical": False}

    verdict = validate.judge_interaction_design(
        quiz_with_a_skin(), core=CORE, recent=(), judge_model="anthropic/claude-opus-5", judge=judge
    )
    assert verdict.ok is False
    assert any("recognition" in r or "skin" in r for r in verdict.reasons), verdict.reasons
    assert calls == [], "the deterministic bar refused it, so no judge was paid"


def test_the_gate_refuses_a_repeat_of_the_chapters_last_three() -> None:
    repeat = drop_design()
    recent = [validate.design_signature(drop_design()), ("sort", "timer"), ("branch",)]
    verdict = validate.judge_interaction_design(
        repeat,
        core=CORE,
        recent=recent,
        judge_model="m",
        judge=lambda *a, **k: {"score": 95, "critical": False},
    )
    assert verdict.ok is False
    assert any("last three" in r for r in verdict.reasons), verdict.reasons


def test_the_gate_refuses_targets_that_overlap_under_a_finger() -> None:
    d = drop_design()
    step = d.steps[0].primitive
    assert isinstance(step, specs.DropInteraction)
    step.zones[1].box = specs.HitBox(x=10, y=5, w=40, h=25)  # now sitting on top of z1
    verdict = validate.judge_interaction_design(
        d,
        core=CORE,
        recent=(),
        judge_model="m",
        judge=lambda *a, **k: {"score": 95, "critical": False},
    )
    assert verdict.ok is False
    assert any("overlap" in r for r in verdict.reasons), verdict.reasons


def test_the_gate_passes_a_design_that_moves_and_teaches() -> None:
    verdict = validate.judge_interaction_design(
        drop_design(),
        core=CORE,
        recent=[("branch",), ("sort", "timer")],
        judge_model="m",
        judge=lambda *a, **k: {
            "score": 88,
            "critical": False,
            "weak": [],
            "notes": "the wrong drop teaches the share",
        },
    )
    assert verdict.ok is True
    assert verdict.score == 88
    assert verdict.judged is True


def test_the_gate_refuses_when_the_judge_scores_below_the_bar() -> None:
    verdict = validate.judge_interaction_design(
        drop_design(),
        core=CORE,
        recent=(),
        judge_model="m",
        judge=lambda *a, **k: {
            "score": 41,
            "critical": False,
            "weak": ["template"],
            "notes": "a fourteen-year-old would feel the template",
        },
    )
    assert verdict.ok is False
    assert verdict.score == 41


def test_an_unreachable_judge_leaves_the_deterministic_verdict_standing() -> None:
    verdict = validate.judge_interaction_design(
        drop_design(), core=CORE, recent=(), judge_model="m", judge=lambda *a, **k: None
    )
    assert verdict.ok is True
    assert verdict.judged is False, "an unjudged design is recorded as unjudged, never as scored"


# =============================================================================================
# 3. The designer, on the ladder
# =============================================================================================


def _as_payload(d: specs.InteractionDesign) -> str:
    return json.dumps(d.model_dump(by_alias=True, exclude_none=True), ensure_ascii=False)


def test_the_designer_starts_at_luna_and_returns_a_composition(monkeypatch) -> None:
    seen: list[str] = []

    def fake(provider_model, user, fallbacks, **kw):
        seen.append(provider_model)
        return _as_payload(drop_design()), 900

    monkeypatch.setattr(engines, "_complete_design", fake)
    out = engines.design_interaction(
        CORE, recent=(), judge=lambda *a, **k: {"score": 90, "critical": False}
    )
    assert seen[0] == generation_ladder()[0], "the ladder starts at the floor (luna)"
    assert out.source == "model"
    assert isinstance(out.design, specs.InteractionDesign)
    assert out.attempts[0]["model"] == generation_ladder()[0]


def test_below_the_bar_once_climbs_exactly_one_rung(monkeypatch) -> None:
    seen: list[str] = []
    scores = iter([40, 91])

    def fake(provider_model, user, fallbacks, **kw):
        seen.append(provider_model)
        return _as_payload(drop_design() if not seen[:-1] else sort_design()), 900

    monkeypatch.setattr(engines, "_complete_design", fake)
    out = engines.design_interaction(
        CORE, recent=(), judge=lambda *a, **k: {"score": next(scores), "critical": False}
    )
    ladder = generation_ladder()
    assert seen == [ladder[0], ladder[1]], seen
    assert out.source == "model"
    assert len(out.attempts) == 2


def test_below_the_bar_twice_takes_the_template_floor(monkeypatch) -> None:
    seen: list[str] = []

    def fake(provider_model, user, fallbacks, **kw):
        seen.append(provider_model)
        return _as_payload(quiz_with_a_skin()), 900

    monkeypatch.setattr(engines, "_complete_design", fake)
    out = engines.design_interaction(
        CORE, recent=(), judge=lambda *a, **k: {"score": 99, "critical": False}
    )
    ladder = generation_ladder()
    assert seen == [ladder[0], ladder[1]], "two tries, never a third"
    assert out.source == "floor"
    assert out.design.kind == "classify", "the floor is the row of §2 the concept sits on"
    # The floor is a real composition, not a stub: it moves, and the schema accepts it.
    assert validate.judge_interaction_design(
        out.design, core=CORE, recent=(), judge_model="m", judge=lambda *a, **k: None
    ).ok


def test_a_draft_the_schema_refuses_never_ships(monkeypatch) -> None:
    """Nothing generated executes: a composition the schema refuses is dropped, not repaired."""
    monkeypatch.setattr(
        engines, "_complete_design", lambda *a, **k: ('{"id":"x","steps":[{"beat":"build"}]}', 12)
    )
    out = engines.design_interaction(
        CORE, recent=(), judge=lambda *a, **k: {"score": 99, "critical": False}
    )
    assert out.source == "floor"
    assert all(a.get("refused") for a in out.attempts)


def test_the_floor_is_available_for_every_row_of_section_two() -> None:
    for kind in specs.INTERACTION_KINDS:
        floor = engines.interaction_floor(kind, CORE)
        assert floor.source == "floor"
        assert floor.kind == kind
        assert floor.steps, f"the {kind} floor is empty"


# =============================================================================================
# 4. The refresh cadence
# =============================================================================================


def test_the_cadence_defaults_to_ninety_days() -> None:
    assert validate.DESIGN_REFRESH_DAYS == 90
    assert specs.InteractionDesign.model_fields["refreshDays"].default == 90


def test_a_design_goes_stale_on_the_cadence(monkeypatch) -> None:
    record = {"designedAt": "2026-01-01T00:00:00+00:00", "refreshDays": 90, "coreVersion": "v1"}
    assert (
        validate.design_is_stale(record, now="2026-02-01T00:00:00+00:00", core_version="v1")
        is False
    )
    assert (
        validate.design_is_stale(record, now="2026-06-01T00:00:00+00:00", core_version="v1") is True
    )


def test_a_core_change_makes_a_design_stale_at_once() -> None:
    record = {"designedAt": "2026-01-01T00:00:00+00:00", "refreshDays": 90, "coreVersion": "v1"}
    assert (
        validate.design_is_stale(record, now="2026-01-02T00:00:00+00:00", core_version="v2") is True
    )


def test_the_cadence_is_a_superadmin_setting(monkeypatch) -> None:
    monkeypatch.setenv("WOBO_DESIGN_REFRESH_DAYS", "30")
    assert validate.design_refresh_days() == 30
    monkeypatch.setenv("WOBO_DESIGN_REFRESH_DAYS", "nonsense")
    assert validate.design_refresh_days() == 90


# =============================================================================================
# 5. The proof: three concepts, three genuinely different mechanics
# =============================================================================================


def test_three_concepts_get_three_genuinely_different_mechanics() -> None:
    designs = [drop_design(), sort_design(), slide_design()]
    signatures = [validate.design_signature(d) for d in designs]
    assert len(set(signatures)) == 3, signatures
    recent: list[tuple[str, ...]] = []
    for d in designs:
        verdict = validate.judge_interaction_design(
            d,
            core=CORE,
            recent=recent,
            judge_model="m",
            judge=lambda *a, **k: {"score": 86, "critical": False},
        )
        assert verdict.ok, (d.concept, verdict.reasons)
        recent.append(validate.design_signature(d))
    # And the fourth, a repeat of the first, is refused by the same gate.
    again = validate.judge_interaction_design(
        drop_design("adding unlike fractions"),
        core=CORE,
        recent=recent,
        judge_model="m",
        judge=lambda *a, **k: {"score": 86, "critical": False},
    )
    assert again.ok is False
    assert any("last three" in r for r in again.reasons), again.reasons


# =============================================================================================
# 6. What the live proof found (2026-09-10) — regression guards for three real defects
# =============================================================================================

THIN_CORE = {
    "concept": "the parts of a plant cell",
    "shape": "classification",
    "idea": "a plant cell is a set of parts, each doing one job",
    "why": "a plant does everything a body does without any organs",
    "misconceptions": [
        {
            "belief": "the wall and the membrane are the same thing",
            "counter": "an animal cell has a membrane and no wall",
        }
    ],
    "check": {
        "question": "what would you remove to make it an animal cell?",
        "answer": "the cell wall",
    },
    "vocabulary": [
        {"term": "chloroplast", "meaning": "where light is turned into food"},
        {"term": "vacuole", "meaning": "the store of water that keeps the cell firm"},
        {"term": "nucleus", "meaning": "where the cell's instructions are kept"},
    ],
}


def test_a_floor_never_misdescribes_what_it_built() -> None:
    """The bug the live proof found: a classification with no bins fell through to a sort and was
    still labelled 'drop each one into the group it belongs to'. A floor that lies about itself is
    the placeholder video of wave 30 with better prose."""
    for kind in specs.INTERACTION_KINDS:
        for core in (CORE, THIN_CORE):
            floor = engines.interaction_floor(kind, core)
            built = [s.primitive.kind for s in floor.steps]
            lead = next((k for k in built if k in specs.MANIPULATIVE_KINDS), built[0])
            assert floor.mechanic.startswith(engines._MECHANIC_OF[lead]), (
                kind,
                floor.mechanic,
                built,
            )


def test_a_classification_with_no_bins_becomes_part_to_its_job() -> None:
    floor = engines.interaction_floor("classify", THIN_CORE)
    assert [s.primitive.kind for s in floor.steps] == ["match"]
    assert floor.mechanic == "join each one to what it means"
    assert floor.kind == "classify", "it is still that row of the table; only the act degraded"


def test_an_order_of_two_is_a_match_and_never_a_padded_order() -> None:
    """Three of the same card is not an order, and a learner sees through it in one move."""
    two = {**THIN_CORE, "vocabulary": THIN_CORE["vocabulary"][:2]}
    floor = engines.interaction_floor("order", two)
    assert [s.primitive.kind for s in floor.steps] == ["match"]


def test_the_stage_holds_six_bins_so_the_schema_allows_six() -> None:
    """Four was a guess; luna wrote five honest bins for the plant cell and the schema refused."""
    caps = specs.DropInteraction.model_fields["zones"].metadata
    assert any(getattr(c, "max_length", None) == 6 for c in caps), caps
    boxes, _ = engines._grid(6, top=1, height=28)
    assert len(boxes) == 6 and all(b.w >= specs.MIN_HIT_UNITS for b in boxes)


def test_a_bin_nothing_goes_into_is_never_given_a_token_that_belongs_elsewhere() -> None:
    """A zone whose rule accepts a token whose own answer is another zone leaves the learner wrong
    whichever way they move. The empty bin is dropped instead."""
    core = {
        **CORE,
        "material": {
            **CORE["material"],
            "bins": [*CORE["material"]["bins"], {"id": "z3", "label": "a quarter of the bar"}],
        },
    }
    floor = engines.interaction_floor("classify", core)
    drop = floor.steps[0].primitive
    assert isinstance(drop, specs.DropInteraction)
    assert [z.id for z in drop.zones] == ["z1", "z2"], "the empty third bin is gone"
    for zone in drop.zones:
        for token_id in zone.accepts:
            token = next(t for t in drop.tokens if t.id == token_id)
            assert token.belongs == zone.id, "a zone's rule never contradicts its token's answer"
