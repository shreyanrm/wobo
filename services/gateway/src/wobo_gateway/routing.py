"""Model routing: the owner's tiers, the chains behind them, and the two tracks.

**Tiers (owner directive, WOBO-PLAN §9, re-cut 2026-09-05).** In product the brain routes by
*tier*, never by name. A feature names a job; :mod:`registry` maps the job to a tier; the tier
resolves to a provider id here and nowhere else.

**The table, by the owner's word (2026-09-05).** "Use the openai and gemini keys if anthropic
isn't working, we should have fallbacks everywhere"; "use openai's terra luna sol; they are
pretty good for generations, and gemini is good for audio and cheaper". Said on the day every
Claude call was refused with "credit balance is too low" and the fallback carried the product.
So every text tier goes to OpenAI first, Anthropic second (the cross-provider second opinion,
back in play the day the credit is topped up) and Gemini Flash last; voice and imagery stay on
Gemini with an OpenAI rung behind them.

==========  ==========================  ============================  =========================
tier        first                       second                        last
==========  ==========================  ============================  =========================
tiny        openai/gpt-5.6-luna         anthropic/claude-haiku-4-5    gemini/gemini-2.5-flash
turn        openai/gpt-5.6-terra        anthropic/claude-sonnet-5     gemini/gemini-2.5-flash
generate    openai/gpt-5.6-terra        anthropic/claude-opus-5       gemini/gemini-2.5-flash
reason      openai/gpt-5.6-sol          anthropic/claude-opus-5       gemini/gemini-2.5-flash
verify      openai/gpt-5.6-sol          anthropic/claude-opus-5       gemini/gemini-2.5-flash
voice       Gemini TTS                  openai/gpt-4o-mini-tts        the device's own voice
image       Gemini Flash Image          openai/gpt-image-2
vision      gemini/gemini-2.5-flash     openai/gpt-5.6-terra
safety      openai/gpt-5.6-luna         gemini/gemini-2.5-flash       the rule layer
==========  ==========================  ============================  =========================

Two rows are chains of exactly the shape named for them rather than the text ladder. ``vision``
reads a photographed page (``doubt.read``): Gemini Flash's eyes first, Terra's behind them, and
the reading shape is the same whichever read it. ``safety`` is the child-safety classifier
(``safety.classify``): OpenAI, then Gemini, and when both are out the rule layer answers
(``safety_model.fail_safe``), which never reaches the crisis script on an outage. The media rows
are not litellm chains at all: ``plexus/media.py`` and ``plexus/image.py`` pin the Gemini primary
and read the OpenAI rung from here, and when neither voice speaks the client reads the same words
with the device's own voice.

The ids and the prices in :data:`CATALOGUE` are copied from the vendors' own pages on
2026-09-05 and read again on 2026-09-07 (``docs/OPERATIONS.md`` §11 names the pages). Nothing in
this module is guessed.

**Overridable without a deploy.** Every tier's primary and chain can be set by environment:
``WOBO_TIER_TURN=openai/gpt-5.6-luna`` moves the primary, ``WOBO_TIER_TURN_CHAIN=a,b`` replaces the
fallbacks. The table above is the default. An id the router does not know refuses at startup
with a line that names the variable, so a typo in a Railway variable is a failed boot and not a
quiet outage on every turn. Read once at import (:func:`configure`); a restart is the reload.

**The cost rule (owner, 2026-09-02) is unchanged.** Generation goes to the cheapest model that
passes verification and escalates ONE rung per judge rejection (:func:`escalate`, logged with
its reason on the telemetry stream); the spend ceiling degrades one rung the other way
(:func:`wobo_gateway.spend.cheaper_tier`). Both walk this table, so an override moves them too.

**Who is carrying a tier right now** is :func:`carrier`: the first model in the chain whose
provider is not marked out. The router does not know who is out (that is
:mod:`wobo_gateway.health`, which imports this module and not the other way round), so the
caller hands in the predicate.

**Tracks.** Track 1 and Track 2 live in two separate structures and are never merged:

- **Track 1** is the external market LLMs (OpenAI / Anthropic / Gemini). Every tier is Track 1.
- **Track 2** is proprietary fine-tuned models and edge SLMs. The slots are declared but
  unfilled, so nothing routes there: a placeholder id is not a model, and routing a live learner
  at one bought an error and a failover on every call.

Because the two tables are disjoint (:func:`track_separation_holds`), a logical model name
resolves to exactly one track.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum

logger = logging.getLogger("wobo.gateway.routing")
# An escalation is a COST event, so it is logged on the telemetry logger, the same JSON stream the
# cost lines land in, not a second place to look. (Importing the telemetry MODULE here would be a
# cycle: telemetry -> registry -> routing.)
_telemetry = logging.getLogger("wobo.gateway.telemetry")


class Track(StrEnum):
    """The two model tracks. Never conflated at the gateway."""

    TRACK_1 = "track_1"
    TRACK_2 = "track_2"


class Tier(StrEnum):
    """The owner's routing tiers. A capability declares one; the ids live in this module."""

    TINY = "tiny"
    TURN = "turn"
    GENERATE = "generate"
    REASON = "reason"
    VERIFY = "verify"
    VOICE = "voice"
    IMAGE = "image"
    VISION = "vision"
    SAFETY = "safety"


@dataclass(frozen=True)
class ModelSpec:
    name: str
    provider_model: str
    track: Track


# =================================================================================================
# The catalogue: every id this router may use, with the vendor's own price
# =================================================================================================
@dataclass(frozen=True)
class Price:
    """USD per million tokens, from the vendor's page. ``None`` where the unit is not a token."""

    per_million_in: float | None
    per_million_out: float | None
    page: str
    note: str = ""


_OPENAI_PRICING = "https://developers.openai.com/api/docs/pricing"
_OPENAI_MODELS = "https://developers.openai.com/api/docs/models"
_ANTHROPIC_PRICING = "https://platform.claude.com/docs/en/about-claude/pricing"
_GEMINI_PRICING = "https://ai.google.dev/gemini-api/docs/pricing"

#: Read from the official pages on 2026-09-05, read again on 2026-09-07. Short-context (standard)
#: rates; cached-input and long-context rates are on the pages and in ``docs/OPERATIONS.md`` §11.
#: An id is here so an override may name it; only :data:`DEFAULT_TABLE` says what is routed.
CATALOGUE: dict[str, Price] = {
    # OpenAI, the GPT-5.6 family: sol is the flagship, terra the balance, luna the cheap one.
    "openai/gpt-5.6-sol": Price(4.00, 20.00, _OPENAI_PRICING, "flagship; cached input 0.40"),
    "openai/gpt-5.6-terra": Price(2.00, 12.00, _OPENAI_PRICING, "balance; cached input 0.20"),
    "openai/gpt-5.6-luna": Price(0.20, 1.20, _OPENAI_PRICING, "cost-sensitive; cached input 0.02"),
    # The two media rungs are priced per token on the page (tts: 0.60 text in, 12.00 audio out;
    # image: 5.00 text in, 8.00 image in, 30.00 image out), but the seams that call them price the
    # UNIT the learner received (a spoken second, an image) from the operator's configured price
    # and never from a token table (``plexus/media.py``, ``ledger.configured_price``), so the
    # token figures are left out here rather than carried where nothing reads them.
    "openai/gpt-4o-mini-tts": Price(None, None, _OPENAI_PRICING, "text to speech; unit-priced"),
    "openai/gpt-image-2": Price(None, None, _OPENAI_PRICING, "image generation; unit-priced"),
    # Anthropic, the second opinion.
    "anthropic/claude-opus-5": Price(5.00, 25.00, _ANTHROPIC_PRICING),
    "anthropic/claude-sonnet-5": Price(2.00, 10.00, _ANTHROPIC_PRICING, "launch price kept"),
    "anthropic/claude-haiku-4-5": Price(1.00, 5.00, _ANTHROPIC_PRICING),
    # Gemini, the last rung on every text chain and the first for audio and imagery.
    "gemini/gemini-2.5-flash": Price(0.30, 2.50, _GEMINI_PRICING),
    # Newer Flash ids on the same page, for an override to name; dearer or equal, so not default.
    "gemini/gemini-3.8-flash": Price(0.75, 3.75, _GEMINI_PRICING, "standard rate through 2026"),
    "gemini/gemini-3.5-flash-lite": Price(0.30, 2.50, _GEMINI_PRICING),
    "gemini/gemini-2.5-flash-preview-tts": Price(0.50, 10.00, _GEMINI_PRICING, "text in, audio"),
    "gemini/gemini-2.5-flash-image": Price(None, None, _GEMINI_PRICING, "0.039 USD per image"),
    # The live microphone (``voice.py``, both websockets). Not a chain: Gemini Live has no OpenAI
    # rung, and the device's own voice is what stands behind it. Priced per AUDIO token on the
    # page (0.50 text / 3.00 audio in, 2.00 text / 12.00 audio out per million, read 2026-09-07;
    # the tokens page: 32 tokens per second of audio), which ``voice.LiveMeter`` turns into one
    # ledger row and one spend line per socket. The models page lists the id as
    # gemini-2.5-flash-native-audio-preview-12-2025; ``-latest`` is Google's alias for it.
    "gemini/gemini-2.5-flash-native-audio-latest": Price(
        None, None, _GEMINI_PRICING, "the live microphone, native-audio; audio-token priced"
    ),
}


def provider_of(model_id: str) -> str:
    """``openai/gpt-5.6-terra`` -> ``openai``. An id with no prefix has no provider we can name."""
    return model_id.split("/", 1)[0] if "/" in model_id else ""


# =================================================================================================
# The default table
# =================================================================================================
_GEMINI_TEXT = "gemini/gemini-2.5-flash"

#: tier -> the chain, primary first. Every text chain crosses all three providers.
DEFAULT_TABLE: dict[Tier, tuple[str, ...]] = {
    Tier.TINY: ("openai/gpt-5.6-luna", "anthropic/claude-haiku-4-5", _GEMINI_TEXT),
    Tier.TURN: ("openai/gpt-5.6-terra", "anthropic/claude-sonnet-5", _GEMINI_TEXT),
    Tier.GENERATE: ("openai/gpt-5.6-terra", "anthropic/claude-opus-5", _GEMINI_TEXT),
    Tier.REASON: ("openai/gpt-5.6-sol", "anthropic/claude-opus-5", _GEMINI_TEXT),
    Tier.VERIFY: ("openai/gpt-5.6-sol", "anthropic/claude-opus-5", _GEMINI_TEXT),
    # The live seams pin their own Gemini ids (voice.VOICE_MODEL, plexus.media.TTS_MODEL,
    # plexus.image.MODEL); these two rows are the routing law those seams answer to, and the
    # OpenAI rung is the fallback they are to reach for.
    Tier.VOICE: ("gemini/gemini-2.5-flash-preview-tts", "openai/gpt-4o-mini-tts"),
    Tier.IMAGE: ("gemini/gemini-2.5-flash-image", "openai/gpt-image-2"),
    # Reading a photograph of a page: Gemini Flash's eyes first, Terra's behind them.
    Tier.VISION: (_GEMINI_TEXT, "openai/gpt-5.6-terra"),
    # The child-safety classifier: openai -> gemini -> the rule layer. No Anthropic rung.
    Tier.SAFETY: ("openai/gpt-5.6-luna", _GEMINI_TEXT),
}

ENV_PREFIX = "WOBO_TIER_"

# --- Track 2: proprietary fine-tuned + edge SLMs (the margin and the moat) -----------------------
# Placeholder identifiers; the trained models route through a LiteLLM custom provider once they
# exist. Nothing routes here today (see the module docstring).
_TRACK_2: dict[str, str] = {
    "slm.tutor": "wobo/tutor-slm",
    "slm.grade": "wobo/grade-slm",
    "slm.companion": "wobo/parent-companion-slm",
    "edge.opener": "wobo/opener-edge-slm",
    "slm.classify": "wobo/archetype-slm",
    "slm.safety": "wobo/safety-slm",
}

# The cost rule's ladder: one rung per rejection, cheapest first. ``verify`` is the top; the
# verifier itself has nothing above it to appeal to. Voice and imagery do not escalate.
_ESCALATION: dict[Tier, Tier] = {
    Tier.TINY: Tier.TURN,
    Tier.TURN: Tier.GENERATE,
    Tier.GENERATE: Tier.REASON,
    Tier.REASON: Tier.VERIFY,
}


def _primary_name(tier: Tier) -> str:
    return f"tier.{tier.value}"


def _rung_name(tier: Tier, index: int) -> str:
    return f"tier.{tier.value}.fallback.{index}"


def _read_table(environ: Mapping[str, str]) -> dict[Tier, tuple[str, ...]]:
    """The default table with the environment's overrides applied, or a RuntimeError that names
    the variable at fault. Pure: reads its argument, touches no module state."""
    known = ", ".join(sorted(CATALOGUE))
    table: dict[Tier, tuple[str, ...]] = {}
    for tier, default in DEFAULT_TABLE.items():
        primary_var = f"{ENV_PREFIX}{tier.value.upper()}"
        chain_var = f"{primary_var}_CHAIN"
        primary = (environ.get(primary_var) or "").strip() or default[0]
        if primary not in CATALOGUE:
            raise RuntimeError(
                f"{primary_var}={primary!r} is not a model this router knows. Known: {known}"
            )
        raw_chain = (environ.get(chain_var) or "").strip()
        if raw_chain:
            chain = tuple(m.strip() for m in raw_chain.split(",") if m.strip())
            for model in chain:
                if model not in CATALOGUE:
                    raise RuntimeError(
                        f"{chain_var} names {model!r}, which is not a model this router knows. "
                        f"Known: {known}"
                    )
        else:
            # A moved primary drops out of the default chain rather than appearing twice.
            chain = tuple(m for m in default[1:] if m != primary)
        full = (primary, *chain)
        if len(set(full)) != len(full):
            raise RuntimeError(
                f"{chain_var} repeats a model: {', '.join(full)}. A chain is one attempt per model"
            )
        if raw_chain and len({provider_of(m) for m in full}) < 2:
            logger.warning(
                "%s keeps tier %s on one provider; a fallback on one account is not a fallback",
                chain_var,
                tier.value,
            )
        table[tier] = full
    return table


# --- module state: built at import from the environment, rebuilt by configure() ------------------
_TABLE: dict[Tier, tuple[str, ...]] = {}
_TRACK_1: dict[str, str] = {}
_TIER_CHAIN: dict[Tier, tuple[str, tuple[str, ...]]] = {}
_REGISTRY: dict[Track, dict[str, ModelSpec]] = {}


def configure(environ: Mapping[str, str] | None = None) -> None:
    """Build the routing table from ``environ`` (``os.environ`` when None).

    Called once at import, which is startup: a bad override refuses the boot with a clear line
    and leaves the previous table untouched. Tests call it with a mapping and again with ``{}``.
    """
    global _TABLE, _TRACK_1, _TIER_CHAIN, _REGISTRY
    table = _read_table(os.environ if environ is None else environ)
    track_1: dict[str, str] = {}
    chains: dict[Tier, tuple[str, tuple[str, ...]]] = {}
    for tier, chain in table.items():
        track_1[_primary_name(tier)] = chain[0]
        rungs = tuple(_rung_name(tier, i) for i in range(1, len(chain)))
        for name, model in zip(rungs, chain[1:], strict=True):
            track_1[name] = model
        chains[tier] = (_primary_name(tier), rungs)
    # Legacy logical names, kept as ALIASES so the plexus engines keep resolving. They are not a
    # second opinion about routing: the JUDGE of a generated artifact is the verify tier, and the
    # REBUILD target of a judge rejection is one rung up from generate, which is the reason tier.
    track_1["frontier.reason"] = table[Tier.VERIFY][0]
    track_1["openai.frontier"] = table[Tier.REASON][0]
    _TABLE, _TRACK_1, _TIER_CHAIN = table, track_1, chains
    _REGISTRY = {
        Track.TRACK_1: {n: ModelSpec(n, m, Track.TRACK_1) for n, m in track_1.items()},
        Track.TRACK_2: {n: ModelSpec(n, m, Track.TRACK_2) for n, m in _TRACK_2.items()},
    }
    overridden = [t.value for t in table if table[t] != DEFAULT_TABLE[t]]
    if overridden:
        logger.info("routing: tiers set by environment: %s", ", ".join(overridden))


configure()


def models_for(track: Track) -> dict[str, ModelSpec]:
    return dict(_REGISTRY[track])


def resolve(name: str, track: Track) -> ModelSpec:
    """Resolve a logical model name within a single track. Raises if it is not there."""
    try:
        return _REGISTRY[track][name]
    except KeyError as exc:
        raise KeyError(f"model {name!r} is not registered on {track.value}") from exc


def resolve_any(name: str) -> ModelSpec:
    """Resolve a logical model name on whichever track holds it.

    Unambiguous because the two tracks are disjoint. Used for fallback chains, which may
    escalate from Track 2 to a Track 1 frontier model on a hard moment.
    """
    for track in (Track.TRACK_1, Track.TRACK_2):
        spec = _REGISTRY[track].get(name)
        if spec is not None:
            return spec
    raise KeyError(f"model {name!r} is not registered on any track")


# --- the tiers -----------------------------------------------------------------------------------
def tier_primary(tier: Tier) -> str:
    """The logical name of a tier's primary model."""
    return _TIER_CHAIN[tier][0]


def tier_fallbacks(tier: Tier) -> tuple[str, ...]:
    """The logical names of a tier's fallback chain, in order, always cross-provider by default."""
    return _TIER_CHAIN[tier][1]


def tier_model(tier: Tier) -> ModelSpec:
    """The provider model a tier resolves to right now."""
    return resolve(tier_primary(tier), Track.TRACK_1)


def tier_chain(tier: Tier) -> tuple[str, ...]:
    """The provider ids of the whole chain, primary first."""
    return _TABLE[tier]


def carrier(tier: Tier, *, available: Callable[[str], bool]) -> ModelSpec | None:
    """The model carrying a tier right now: the first in the chain whose provider is not out.

    ``available`` is :func:`wobo_gateway.health.provider_available` in the product; ``None``
    means every rung is out and a call on this tier would not be served.
    """
    for name in (tier_primary(tier), *tier_fallbacks(tier)):
        spec = resolve(name, Track.TRACK_1)
        if available(spec.provider_model):
            return spec
    return None


def escalation_tier(tier: Tier) -> Tier | None:
    """One rung up the cost ladder, or ``None`` at the top."""
    return _ESCALATION.get(tier)


def escalate(tier: Tier, *, capability: str, reason: str) -> ModelSpec | None:
    """The cost rule: a verifier or second-opinion REJECTION escalates one tier.

    Returns the escalated tier's model, or ``None`` when the caller is already at the top of the
    ladder (nothing above the verifier to appeal to); the caller then keeps what it has. Every
    escalation is logged with its reason so the hard list stays honest.
    """
    nxt = escalation_tier(tier)
    fields = {"capability": capability, "from_tier": tier.value, "reason": reason}
    if nxt is None:
        _telemetry.info("gateway.escalation declined (top of the ladder)", extra={"fields": fields})
        return None
    spec = tier_model(nxt)
    _telemetry.info(
        "gateway.escalation",
        extra={"fields": {**fields, "to_tier": nxt.value, "model": spec.provider_model}},
    )
    return spec


def track_separation_holds() -> bool:
    """No logical name and no provider model string may appear on both tracks."""
    if set(_TRACK_1) & set(_TRACK_2):
        return False
    return not (set(_TRACK_1.values()) & set(_TRACK_2.values()))
