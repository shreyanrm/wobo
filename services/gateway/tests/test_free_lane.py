"""The free lane, in the funnel rather than only in the router.

``docs/ALLOWANCE.md``, "The free tier: five rupees a day, on Luna", and the owner's second
ruling: *"the model funnel calls routing.lane_tier(tier, plan) so a free learner's turn runs on
tiny (Luna) and a paid learner's on turn; nothing else moves per plan."*

WHY THIS FILE EXISTS. ``routing.lane_tier`` was written, documented and unit-tested on
2026-09-08, and until this wave **nothing called it**. ``test_router_fallbacks`` proved the
function returns the right tier; no test asked whether any served call ever went through it, and
none did. So every free learner's turn was running on Terra at eleven times Luna's price, the
allowance desk was showing a free lane that did not exist, and the document described a product
the funnel had never implemented. A pure function nobody calls is a comment with a test.

What is proved here is therefore the CALL PATH, not the arithmetic:

1. a free learner's turn is served by the tiny chain, and a paid learner's by the turn chain;
2. a plan nobody recognises is free, never paid — the same safe direction ``budget`` and
   ``spend`` already take, because a billing bug must cost questions and never hand out a lane
   nobody paid for;
3. NOTHING ELSE MOVES. Every other tier — create, verify, safety, vision, generate, tiny — serves
   the identical model on every plan. This is the half of the ruling that is easy to break and
   expensive to discover: the moment the lane touches the creative tier, a free learner is
   getting cheaper CONTENT, which is the one thing the owner said must never happen.
4. the content served is the same object either way: same capability, same cache key, same
   safety screens, same output. Free buys fewer turns, never a worse answer.
"""

from __future__ import annotations

import pytest
from wobo_gateway.app import CapabilityRequest, Gateway
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.registry import ConsentTier, capabilities, policy
from wobo_gateway.routing import Tier, lane_tier, tier_model
from wobo_gateway.telemetry import MetricsSink

#: Every plan name the product actually sells, and the two that mean "nobody paid".
PAID = ("plus", "pro", "max")
FREE = ("free", None, "mystery")


def _gateway(sink: MetricsSink | None = None) -> Gateway:
    return Gateway(MockProvider(), InMemoryCache(), sink or MetricsSink())


def _req(**payload: object) -> CapabilityRequest:
    return CapabilityRequest(consent_tier=ConsentTier.UN_ELEVATED, payload=dict(payload))


def _served(capability: str, plan: str | None, **payload: object) -> str:
    """The model that actually answered one call on this plan."""
    return _gateway().invoke(capability, _req(**payload), plan=plan).model


# --- 1. the turn moves, and only the turn ---------------------------------------------------
@pytest.mark.parametrize("plan", FREE)
def test_a_free_learners_turn_is_served_by_the_tiny_chain(plan: str | None) -> None:
    """Five rupees a day is three hundred short turns on Luna, or thirty on Terra. The lane is
    the whole difference, and it has to be in the path a learner's turn actually takes."""
    assert _served("wobo.turn", plan, t=1) == tier_model(Tier.TINY).provider_model


@pytest.mark.parametrize("plan", PAID)
def test_a_paid_learners_turn_is_served_by_the_turn_chain(plan: str) -> None:
    assert _served("wobo.turn", plan, t=2) == tier_model(Tier.TURN).provider_model


def test_the_two_lanes_really_are_different_models() -> None:
    """Guards the test above from passing for the wrong reason: if the two tiers ever resolve to
    the same id, every assertion in this file is vacuously true and would say so silently."""
    assert tier_model(Tier.TINY).provider_model != tier_model(Tier.TURN).provider_model


# --- 2. nothing else moves per plan ---------------------------------------------------------
def test_no_other_tier_moves_for_any_plan() -> None:
    """The ruling's second half. Verify, safety, voice, vision and the creative tier are the same
    for everyone: the quality lives in the work that is made once and shared, and a lane that
    reached it would be a free learner getting cheaper content."""
    for name in capabilities():
        tier = policy(name).tier
        if tier is Tier.TURN:
            continue
        for plan in (*PAID, *FREE):
            assert lane_tier(tier, plan) is tier, (name, tier, plan)


def test_the_creative_tier_is_identical_on_every_plan() -> None:
    """Said again at the funnel rather than at the router, because this is the one that matters:
    the blueprint and the concept cores a free learner gets are the Astra-made, judged, cached
    work a paid learner gets (docs/ALLOWANCE.md, "Best of both worlds")."""
    creative = tier_model(Tier.CREATE).provider_model
    for plan in (*PAID, *FREE):
        assert _served("create.core", plan, concept="force") == creative


# --- 3. the free lane never changes what content is served -----------------------------------
def test_the_free_lane_changes_the_model_and_not_the_answer() -> None:
    """*"A plan buys quantity, never quality."* The two calls differ in which model was asked and
    in nothing else: same capability, same payload, same output object."""
    free = _gateway().invoke("wobo.turn", _req(q="why is the sky blue"), plan="free")
    paid = _gateway().invoke("wobo.turn", _req(q="why is the sky blue"), plan="pro")
    assert free.model != paid.model
    assert free.capability == paid.capability == "wobo.turn"
    assert free.output == paid.output
    assert free.cache_hit is paid.cache_hit is False


def test_the_lane_is_told_to_the_telemetry_so_the_desk_can_see_it() -> None:
    """The models desk sums the ledger by model. A lane that moved the call but not the recorded
    model would make the desk say a free turn cost Terra money, which is the figure the owner
    prices a plan from."""
    sink = MetricsSink()
    _gateway(sink).invoke("wobo.turn", _req(t=3), plan="free")
    assert sink.events[-1].model == tier_model(Tier.TINY).provider_model


# --- 4. the default is the safe direction ----------------------------------------------------
def test_a_caller_that_names_no_plan_gets_the_free_lane() -> None:
    """The public Ask box and the cron jobs name no plan. They are strangers, and a stranger is
    served on the cheap lane rather than on a paying learner's — the same default ``invoke``
    already takes for the consent tier and the spend priority."""
    assert _gateway().invoke("wobo.turn", _req(t=4)).model == tier_model(Tier.TINY).provider_model


# --- 5. the lane is a LEARNER's, and the parent's companion is not a learner -------------------
#
# THE REGRESSION THIS SECTION EXISTS FOR. The section above proves the lane through ``invoke``'s
# ``plan`` argument and never through a CALL SITE, and there is a live call site that names no
# plan at all: ``parent_mind._invoke``, which the route ``POST /v1/parent/ask`` reaches. Its
# capability is ``parent.companion.turn``, which the registry puts on ``Tier.TURN`` — so the day
# the funnel started reading a missing plan as free, the parent's companion silently dropped from
# Terra to Luna for EVERY family, Max included, and the whole suite stayed green.
#
# The default itself is right and stays: a caller that does not name itself gets the cheap lane.
# What was wrong is the SCOPE. docs/ALLOWANCE.md, "The free tier", steps down "a free learner's
# turns"; a parent asking how their child is getting on is not a learner and has no allowance,
# and the parent account is itself something a plan buys ("Best of both worlds": a bigger day,
# Terra turns, more voice and doubts, downloads, the parent account). So the lane does not reach
# this capability, on any plan, and the exemption is a named set rather than a plan being
# threaded down a second path that the next call site can forget again.
PARENT_TURN = "parent.companion.turn"


def test_the_parents_companion_runs_on_terra_whatever_the_plan_says() -> None:
    """Including the plan nobody named, which is what its only live call site passes."""
    for plan in (*PAID, *FREE):
        assert _served(PARENT_TURN, plan, question="how is she getting on") == (
            tier_model(Tier.TURN).provider_model
        ), plan


def test_the_parent_companion_reaches_the_turn_chain_through_its_own_door() -> None:
    """The CALL PATH, not the argument: through ``parent_mind``'s own gateway seam, exactly as
    ``/v1/parent/ask`` reaches it, with no plan named anywhere."""
    from wobo_gateway import parent_mind

    sink = MetricsSink()
    parent_mind.set_gateway(_gateway(sink))
    try:
        parent_mind._invoke({"child_name": "A"}, "how is she getting on with fractions")
    finally:
        parent_mind.set_gateway(None)
    assert sink.events[-1].model == tier_model(Tier.TURN).provider_model


def test_every_exempt_capability_is_a_tier_the_lane_would_otherwise_move() -> None:
    """An exemption for a tier the lane never touches is a comment pretending to be a rule, and
    an exemption naming a capability that does not exist is a typo nobody would notice."""
    from wobo_gateway.routing import LANE_EXEMPT

    known = set(capabilities())
    for name in LANE_EXEMPT:
        assert name in known, name
        assert policy(name).tier is Tier.TURN, name
