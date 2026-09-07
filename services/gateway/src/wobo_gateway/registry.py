"""Capability registry and per-capability routing policy.

Features call a capability name, never a raw model and never a tier. Each capability has
exactly one policy: the **tier** it belongs to (WOBO-PLAN §9), which fixes the primary model
and the fallback chain, plus latency and cost budgets, the output ceiling, the cache tier,
and the consent-tier rule.

The tier map (owner directive, 2026-09-02):

- ``tiny`` — intent classification, safety pre-screen, openers, titles and summaries, recall,
  and the curriculum registry (which reads a database rather than a model, but is metered and
  gated at this door like everything else): ``generate.opener``, ``safety.moderate``,
  ``twin.query``, ``generate.digest``, ``archetype.classify``, ``curriculum.*``.
- ``turn`` — Wobo's conversational turns and the judgements taken inside one:
  ``wobo.turn``, ``tutor.turn``, ``parent.companion.turn``, ``grade.attempt``,
  ``peakcut.evaluate``.
- ``generate`` — board plans, lessons, practice, diagrams, video storyboards:
  ``engine.compose``, ``engine.simulate``, ``engine.diagram``, ``engine.video``,
  ``generate.course``.
- ``reason`` — the hard list and every escalation off ``generate``: ``verify.math``, boss
  synthesis, misconception detonation, a first syllabus extraction, a grading escalation.
- ``verify`` — the second-opinion cross-check of anything generated. No capability of its
  own: it is the fallback rung above ``generate`` and ``reason``, and the model the plexus
  validation gate judges with (``routing`` aliases ``frontier.reason`` onto it), so a
  generated artifact is always judged by the other provider.

``archetype.classify`` and ``peakcut.evaluate`` are elevated-only — they refuse under the
un-elevated consent tier.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from wobo_gateway.cache import CacheTier
from wobo_gateway.routing import (
    Tier,
    Track,
    escalate,
    resolve,
    resolve_any,
    tier_fallbacks,
    tier_primary,
    track_separation_holds,
)


class ConsentTier(StrEnum):
    """Consent tier (DPDP). Travels on every invocation and gates downstream intelligence."""

    UN_ELEVATED = "un_elevated"
    ELEVATED = "elevated"


@dataclass(frozen=True)
class RoutingPolicy:
    capability: str
    tier: Tier
    track: Track
    primary: str
    fallback: tuple[str, ...]
    max_latency_ms: int
    cost_ceiling: float
    cache_tier: CacheTier
    elevated_only: bool = False
    # Gateway-owned output ceiling for this capability. The caller never sets max_tokens (a
    # client-supplied ceiling is an open cheque); providers read it from here on every model call.
    max_tokens: int = 1024

    def allows(self, consent_tier: ConsentTier) -> bool:
        return consent_tier is ConsentTier.ELEVATED or not self.elevated_only


# Sensible per-tier defaults: the latency TARGET (the timeout ceiling lives in providers), the
# cost ceiling one call may reach before telemetry warns, and the output ceiling. A capability
# overrides only what it genuinely needs — a 16k storyboard, a 200-token safety verdict.
_TIER_BUDGETS: dict[Tier, tuple[int, float, int]] = {
    Tier.TINY: (1500, 0.002, 400),
    Tier.TURN: (8000, 0.02, 800),
    Tier.GENERATE: (12000, 0.08, 4000),
    Tier.REASON: (20000, 0.20, 4000),
    Tier.VERIFY: (20000, 0.20, 2000),
    Tier.VISION: (20000, 0.05, 1500),
    Tier.SAFETY: (1500, 0.002, 120),
}


def _policy(
    capability: str,
    tier: Tier,
    cache_tier: CacheTier,
    *,
    max_latency_ms: int | None = None,
    cost_ceiling: float | None = None,
    max_tokens: int | None = None,
    elevated_only: bool = False,
) -> RoutingPolicy:
    """One capability, pinned to a tier. The models come from the tier, never from here."""
    latency, cost, tokens = _TIER_BUDGETS[tier]
    return RoutingPolicy(
        capability=capability,
        tier=tier,
        # Every tier is a Track-1 market model today; the Track-2 SLM slots are unfilled.
        track=Track.TRACK_1,
        primary=tier_primary(tier),
        fallback=tier_fallbacks(tier),
        max_latency_ms=max_latency_ms if max_latency_ms is not None else latency,
        cost_ceiling=cost_ceiling if cost_ceiling is not None else cost,
        cache_tier=cache_tier,
        elevated_only=elevated_only,
        max_tokens=max_tokens if max_tokens is not None else tokens,
    )


_POLICIES: dict[str, RoutingPolicy] = {
    p.capability: p
    for p in (
        # --- turn: Wobo is talking, and the small judgements taken mid-conversation ------
        # A live tutor turn is NEVER cached — context differs every time, and a cached reply is
        # a groundedness bug (Wobo answers a different moment).
        _policy("wobo.turn", Tier.TURN, CacheTier.NONE, max_tokens=500, cost_ceiling=0.05),
        _policy("tutor.turn", Tier.TURN, CacheTier.SEMANTIC),
        _policy("parent.companion.turn", Tier.TURN, CacheTier.SEMANTIC, max_latency_ms=6000),
        # Grading one attempt is a judgement inside a turn. A grading ESCALATION (the learner
        # says "I think I'm right", or the verifier rejects) goes up a rung to `reason` through
        # routing.escalate — never by a second policy naming a second model.
        _policy(
            "grade.attempt",
            Tier.TURN,
            CacheTier.EXACT,
            max_latency_ms=4000,
            cost_ceiling=0.01,
            max_tokens=300,
        ),
        _policy(
            "peakcut.evaluate",
            Tier.TURN,
            CacheTier.NONE,
            max_latency_ms=3000,
            max_tokens=600,
            elevated_only=True,
        ),
        # --- tiny: classification, safety, openers, titles, summaries, recall ------------
        _policy("generate.opener", Tier.TINY, CacheTier.EXACT, max_tokens=300),
        _policy("safety.moderate", Tier.TINY, CacheTier.EXACT, max_latency_ms=800, max_tokens=200),
        # The child-safety screen's model layer (safety_model.py). Tiny tier, cross-provider
        # fallbacks, a short ceiling: it answers one JSON verdict about one message and nothing
        # else. Exact-cached because the same sentence is the same verdict, and the screen runs
        # on every learner-facing turn.
        _policy(
            "safety.classify",
            Tier.SAFETY,
            CacheTier.EXACT,
            max_latency_ms=1500,
            cost_ceiling=0.002,
            max_tokens=120,
        ),
        _policy("twin.query", Tier.TINY, CacheTier.SEMANTIC, max_tokens=600),
        _policy(
            "generate.digest",
            Tier.TINY,
            CacheTier.EXACT,
            max_latency_ms=6000,
            cost_ceiling=0.01,
            max_tokens=1500,
        ),
        _policy(
            "archetype.classify",
            Tier.TINY,
            CacheTier.EXACT,
            max_latency_ms=2000,
            cost_ceiling=0.005,
            elevated_only=True,
        ),
        # The public site's Ask Wobo box (SITE.md §2; ask_public.py). Unauthenticated visitors,
        # answered from the help articles alone, so it sits on the cheapest tier with a short
        # ceiling — and it is exact-cached on purpose: the same question over the same articles
        # is the same answer for every visitor, and a cache hit costs the door nothing.
        _policy(
            "help.answer",
            Tier.TINY,
            CacheTier.EXACT,
            max_latency_ms=4000,
            cost_ceiling=0.003,
            max_tokens=220,
        ),
        # --- generate: the cheapest model that passes verification -----------------------
        # The cost rule (owner, 2026-09-02): board plans, lessons and storyboards run on the
        # generate tier by default and escalate ONE rung only on a verifier or second-opinion
        # rejection (routing.escalate, which logs the reason). The plexus validation gate does
        # exactly that: the verify tier judges the draft, the reason tier rebuilds it, best-of
        # is promoted. Warm-cached under content/cache/ so the first learner pays and the rest
        # reuse.
        _policy("generate.course", Tier.GENERATE, CacheTier.EXACT, max_tokens=1200),
        _policy("engine.compose", Tier.GENERATE, CacheTier.EXACT, max_tokens=16000),
        _policy("engine.simulate", Tier.GENERATE, CacheTier.EXACT, max_tokens=2000),
        _policy(
            "engine.diagram",
            Tier.GENERATE,
            CacheTier.EXACT,
            max_latency_ms=10000,
            cost_ceiling=0.05,
            max_tokens=6000,
        ),
        _policy(
            "engine.video",
            Tier.GENERATE,
            CacheTier.EXACT,
            max_latency_ms=30000,
            cost_ceiling=0.15,
            max_tokens=16000,
        ),
        # --- tiny: the curriculum registry (CURRICULUM.md §8) ----------------------------
        # These nine read the registry and write a discovery job; NOT ONE of them calls a
        # model. They carry a policy anyway, because a policy is how a capability exists at
        # this door: it is what /v1/capabilities lists, what the consent gate reads, and what
        # the meter classifies. They sit on `tiny` because that is the tier the plan gives
        # "alias and catalog matching", and because the day a type-ahead does need a model to
        # untangle "9th std maths" it is Luna's job, not Terra's.
        #
        # Cache tier NONE, deliberately: a syllabus that was still being discovered a minute
        # ago must not be served from a cache that predates it, and a learner's own overlay
        # must never be served to anyone else. The registry's own store is the cache.
        _policy("curriculum.search", Tier.TINY, CacheTier.NONE, max_latency_ms=800),
        _policy("curriculum.framework", Tier.TINY, CacheTier.NONE, max_latency_ms=1200),
        _policy("curriculum.units", Tier.TINY, CacheTier.NONE, max_latency_ms=2000),
        _policy("curriculum.topics", Tier.TINY, CacheTier.NONE, max_latency_ms=2000),
        _policy("curriculum.pin", Tier.TINY, CacheTier.NONE, max_latency_ms=1200),
        _policy("curriculum.upgrade", Tier.TINY, CacheTier.NONE, max_latency_ms=2000),
        _policy("curriculum.overlay.get", Tier.TINY, CacheTier.NONE, max_latency_ms=1200),
        _policy("curriculum.overlay.apply", Tier.TINY, CacheTier.NONE, max_latency_ms=1500),
        _policy("curriculum.status", Tier.TINY, CacheTier.NONE, max_latency_ms=800),
        # The own-syllabus door (§6). `read` is the one that calls a model — the generate tier
        # structures the learner's own document, and a photo goes to the image-capable rung — so
        # it gets the latency of a generation, not of a lookup. The other three only move an
        # object the learner already owns, so they answer as fast as the registry does.
        _policy("curriculum.own.read", Tier.GENERATE, CacheTier.NONE, max_latency_ms=20000),
        _policy("curriculum.own.confirm", Tier.TINY, CacheTier.NONE, max_latency_ms=1200),
        _policy("curriculum.own.publish", Tier.TINY, CacheTier.NONE, max_latency_ms=1500),
        _policy("curriculum.own.offer", Tier.TINY, CacheTier.NONE, max_latency_ms=1500),
        # --- the doubt solver (doubt.py): the one place the product needs vision --------
        # A photograph of a page of work comes in the door at POST /v1/doubt, never through
        # /v1/capability (the route refuses these two names by hand). The screen is a tiny-tier
        # vision verdict about ONE image: is it a page of work, is there a face, are there
        # details a page does not need. The read is the generate tier structuring what is on the
        # page into lines with boxes, which is the same tier the own-syllabus photo already goes
        # to. Neither is cached: two photos are never the same photo, and a cached reading of a
        # child's page served to another child is a privacy bug before it is a groundedness one.
        _policy(
            "doubt.screen",
            Tier.TINY,
            CacheTier.NONE,
            max_latency_ms=4000,
            cost_ceiling=0.005,
            max_tokens=200,
        ),
        _policy(
            "doubt.read",
            Tier.VISION,
            CacheTier.NONE,
            max_latency_ms=20000,
            cost_ceiling=0.05,
            max_tokens=1500,
        ),
        # --- reason: the hard list ------------------------------------------------------
        # Mathematics goes through the CAS verifier first; this is the model that reads the
        # result. Its fallback rung is the verify tier, so a check is never marked by the same
        # provider twice.
        _policy(
            "verify.math",
            Tier.REASON,
            CacheTier.EXACT,
            max_latency_ms=8000,
            cost_ceiling=0.10,
            max_tokens=1000,
        ),
    )
}

EXPECTED_CAPABILITIES: tuple[str, ...] = (
    "tutor.turn",
    "wobo.turn",
    "grade.attempt",
    "generate.opener",
    "verify.math",
    "twin.query",
    "safety.moderate",
    "safety.classify",
    "parent.companion.turn",
    "generate.digest",
    "generate.course",
    "engine.compose",
    "engine.simulate",
    "engine.diagram",
    "engine.video",
    "archetype.classify",
    "peakcut.evaluate",
    "curriculum.search",
    "curriculum.framework",
    "curriculum.units",
    "curriculum.topics",
    "curriculum.pin",
    "curriculum.upgrade",
    "curriculum.overlay.get",
    "curriculum.overlay.apply",
    "curriculum.status",
    "curriculum.own.read",
    "curriculum.own.confirm",
    "curriculum.own.publish",
    "curriculum.own.offer",
    "help.answer",
    "doubt.screen",
    "doubt.read",
)


def capabilities() -> tuple[str, ...]:
    return tuple(_POLICIES)


# Rebrand compatibility: the deployed web bundle still POSTs the pre-rebrand capability name
# until it redeploys. Retire this map once no client calls the legacy name.
_LEGACY_CAPABILITY_ALIASES: dict[str, str] = {"vidya.turn": "wobo.turn"}


def canonical_capability(name: str) -> str:
    """Legacy capability name -> its current name; any other name passes through unchanged."""
    return _LEGACY_CAPABILITY_ALIASES.get(name, name)


def policy(name: str) -> RoutingPolicy:
    return _POLICIES[name]


def escalate_for(capability: str, reason: str) -> str | None:
    """The cost rule, per capability: on a verifier or second-opinion REJECTION, the provider
    model one tier up — logged with its reason — or ``None`` at the top of the ladder.

    This is the only way a capability may spend more than its tier: an engine that rejects its
    own draft asks here rather than naming a bigger model itself.
    """
    spec = escalate(policy(capability).tier, capability=capability, reason=reason)
    return spec.provider_model if spec is not None else None


def validate_registry() -> None:
    """Fail fast on a malformed registry: track overlap, missing policy, or a model that
    does not resolve. The primary must live on the policy's declared track; fallbacks may
    escalate to either track."""
    if not track_separation_holds():
        raise RuntimeError("track 1 and track 2 model sets must not overlap")
    missing = set(EXPECTED_CAPABILITIES) - set(_POLICIES)
    if missing:
        raise RuntimeError(f"missing capability policies: {sorted(missing)}")
    for pol in _POLICIES.values():
        resolve(pol.primary, pol.track)
        for name in pol.fallback:
            resolve_any(name)
        if pol.primary != tier_primary(pol.tier) or pol.fallback != tier_fallbacks(pol.tier):
            raise RuntimeError(f"{pol.capability} does not route on its declared tier")


validate_registry()
