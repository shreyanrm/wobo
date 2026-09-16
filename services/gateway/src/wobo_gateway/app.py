"""FastAPI surface and the gateway engine.

The engine ties the pieces together for one invocation: consent gate -> cache lookup ->
model resolution -> provider call -> cache write -> telemetry. The HTTP surface exposes
invoke, a registry dump, and a health check.

Boot posture: :func:`validate_env` fails fast on a misconfigured environment (never serve
a request half-configured), CORS is locked to the prod origin outside dev, and logs are
structured JSON.

Door posture: every ``/v1`` route except the internal email relay is authenticated in one
middleware — a verified Supabase subject, or nothing. The consent tier is derived from that
subject (:mod:`wobo_gateway.consent`), never read from the body; the free tier is
metered against it (:mod:`wobo_gateway.budget`); the rate limiter keys on it, so one
proxy IP is no longer one bucket for every learner on the platform.

Money posture: ``budget`` caps how often a LEARNER may ask; :mod:`wobo_gateway.spend` caps how
much the PLATFORM may spend in a day, and this module is where that ceiling is enforced — once
in :meth:`Gateway.invoke` and once in :func:`stream_board_turn`, both after the cache and before
any provider is reached. Past a lane's line a caller is served on a cheaper model rather than
refused; past its refuse line it gets Wobo's honest line rather than an error.

Alarm posture: :mod:`wobo_gateway.alerts` raises one greppable line, and one webhook when the
owner has set ``ALERT_WEBHOOK_URL``, for the six things worth waking someone — a 5xx, a
safety-gate hit, a spend threshold, an auth-failure burst, a provider outage, and a start-up.
``/healthz`` answers from :mod:`wobo_gateway.health`, which reports whether the product would
actually work rather than only that the process is up.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import os
import threading
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, Protocol

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from wobo_gateway import (
    admin_auth,
    alerts,
    allowance,
    billing,
    budget,
    consent,
    doors,
    health,
    ledger,
    safety_model,
    spend,
    spoken,
)
from wobo_gateway.admin_auth import ADMIN_PREFIX, assert_admin_surface, register_admin
from wobo_gateway.ask_public import LIMITED_PATHS as ASK_LIMITED_PATHS
from wobo_gateway.ask_public import OPEN_PATHS as ASK_OPEN_PATHS
from wobo_gateway.ask_public import register_public_ask
from wobo_gateway.auth import (
    AuthError,
    Principal,
    authenticate,
    dev_auth_enabled,
    dev_auth_requested,
    expected_issuer,
    jwks_url,
)
from wobo_gateway.billing import LIMITED_PATHS as BILLING_LIMITED_PATHS
from wobo_gateway.billing import register_billing
from wobo_gateway.billing.payments import LIMITED_PATHS as PAYMENTS_LIMITED_PATHS
from wobo_gateway.billing.payments import OPEN_PATHS as PAYMENTS_OPEN_PATHS
from wobo_gateway.billing.payments import register_billing_desk, register_payments
from wobo_gateway.board_change import register_board_change
from wobo_gateway.cache import CacheBackend, CacheEntry, InMemoryCache, cache_key
from wobo_gateway.console_api import register_console
from wobo_gateway.curriculum.public import LIMITED_PATHS as SYLLABUS_LIMITED_PATHS
from wobo_gateway.curriculum.public import OPEN_PATHS as SYLLABUS_OPEN_PATHS
from wobo_gateway.curriculum.public import register_public_syllabus
from wobo_gateway.desks_api import register_desks
from wobo_gateway.doors import LIMITED_PATHS as DOORS_LIMITED_PATHS
from wobo_gateway.doors import OPEN_PATHS as DOORS_OPEN_PATHS
from wobo_gateway.doors import register_doors
from wobo_gateway.doubt import register_doubt
from wobo_gateway.email import register_email
from wobo_gateway.hospitality.api import register_mail_preferences
from wobo_gateway.hospitality.jobs import welcome_after_first_meeting
from wobo_gateway.mind import register_mind
from wobo_gateway.models_api import register_models_desk
from wobo_gateway.model_call import ProviderUnavailable, is_provider_failure
from wobo_gateway.parent_api import LIMITED_PATHS as PARENT_API_LIMITED_PATHS
from wobo_gateway.parent_api import register_parent_api
from wobo_gateway.parents import LIMITED_PATHS as PARENT_LIMITED_PATHS
from wobo_gateway.parents import OPEN_PATHS as PARENT_OPEN_PATHS
from wobo_gateway.parents import register_parent_links
from wobo_gateway.providers import Provider, build_provider
from wobo_gateway.registry import (
    ConsentTier,
    RoutingPolicy,
    canonical_capability,
    capabilities,
    platform_paid,
    policy,
)
from wobo_gateway.promo import LIMITED_PATHS as PROMO_LIMITED_PATHS
from wobo_gateway.promo import register_promo, register_promo_desk
from wobo_gateway.reports import LIMITED_PATHS as REPORT_LIMITED_PATHS
from wobo_gateway.reports import register_reports
from wobo_gateway.routing import (
    LANE_EXEMPT,
    lane_tier,
    resolve,
    resolve_any,
    tier_fallbacks,
    tier_primary,
)
from wobo_gateway.safety import (
    CATEGORY_CRISIS,
    DEFAULT_CLASSIFIER,
    LEARNER_FACING_CAPABILITIES,
    SafetyClassifier,
    moderate,
    screen_inbound,
    screen_outbound,
    screen_wobo_inbound,
    screen_wobo_outbound,
)
from wobo_gateway.telemetry import MetricsSink, TelemetryEvent, emit
from wobo_gateway.voice import register_voice
from wobo_gateway.waiting_list import LIMITED_PATHS as WAITING_LIST_LIMITED_PATHS
from wobo_gateway.waiting_list import OPEN_PATHS as WAITING_LIST_OPEN_PATHS
from wobo_gateway.waiting_list import register_waiting_list
from wobo_gateway.wobo import is_first_meeting

logger = logging.getLogger("wobo.gateway")

# Brand-neutral by config (WOBO-PLAN §8): the canonical origin is one environment variable, so
# the domain swap is a deploy change and never a code change. The default is the real origin the
# domain wave landed on (heywobo.com, 2026-09-03) and it agrees with email_templates.py — a
# service that lost APP_URL must still put a working link in a learner's mail and a reachable
# origin in the CORS allow-list, not a reserved name that can never resolve.
APP_NAME = os.getenv("APP_NAME", "Wobo")
APP_URL = os.getenv("APP_URL", "https://heywobo.com").rstrip("/")
# Our own preview builds — ephemeral per-deploy origins, pattern-matched. Also config: a
# different Vercel project or team is a different pattern.
_PREVIEW_ORIGIN_REGEX = os.getenv(
    "APP_PREVIEW_ORIGIN_REGEX", r"https://wobo-[a-z0-9]+-depl-shreyan\.vercel\.app"
)
_DEV_ORIGINS = ("http://localhost:5173", "http://localhost:5174", "http://localhost:4173")


class _JsonFormatter(logging.Formatter):
    """One JSON object per line — machine-parseable on any host's log drain."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        entry.update(getattr(record, "fields", None) or {})
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def configure_logging() -> None:
    root = logging.getLogger()
    if any(isinstance(h.formatter, _JsonFormatter) for h in root.handlers):
        return  # already configured (create_app runs once per test)
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    root.handlers = [handler]
    root.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())


def validate_env() -> None:
    """Fail fast on boot — a misconfigured gateway must never serve a single request."""
    env = os.getenv("ENV", "dev").lower()
    if env not in {"dev", "stg", "prod"}:
        raise RuntimeError(f"ENV must be one of dev|stg|prod, got {env!r}")
    mode = os.getenv("LLM_MODE", "mock").lower()
    if mode not in {"mock", "live"}:
        raise RuntimeError(f"LLM_MODE must be mock|live, got {mode!r}")
    if mode == "live":
        if not os.getenv("ANTHROPIC_API_KEY"):
            raise RuntimeError(
                "LLM_MODE=live requires ANTHROPIC_API_KEY (Track 1 primary). "
                "Set it in the environment or run with LLM_MODE=mock."
            )
        if not os.getenv("OPENAI_API_KEY"):
            logger.warning("OPENAI_API_KEY missing: cross-check fallbacks will fail over")
        if not (os.getenv("GOOGLE_AI_API_KEY") or os.getenv("GEMINI_API_KEY")):
            logger.warning("GOOGLE_AI_API_KEY missing: voice and imagery stay unavailable")
        # The child-safety screen's model layer. Off in live mode is allowed, but only by saying
        # so out loud (SAFETY_MODEL=off) — it must never be off because nobody looked.
        safety_model.assert_configured()
    if env == "prod":
        # Fail closed. Prod must be able to verify a real token, and the dev seam — a header
        # that asserts an identity with no proof — must not exist there at any setting.
        if dev_auth_requested():
            raise RuntimeError("DEV_AUTH is refused when ENV=prod: it would accept any identity")
        if not (os.getenv("SUPABASE_JWT_SECRET") or jwks_url()):
            raise RuntimeError(
                "ENV=prod requires SUPABASE_JWT_SECRET (HS256 projects) or "
                "SUPABASE_JWKS_URL/SUPABASE_URL (JWKS projects) to verify learner tokens"
            )
        # A verified signature with an unpinned issuer is not an identity: every Supabase project
        # writes the audience "authenticated", so on a shared-secret project anything that has
        # ever held the secret can mint a learner. Prod must know whose tokens it accepts.
        if not expected_issuer():
            raise RuntimeError(
                "ENV=prod requires SUPABASE_URL (or SUPABASE_JWT_ISS) so the token issuer can be "
                "checked: an unpinned issuer accepts any token minted with our secret"
            )
    # The operator console's own environment, checked HERE and not only inside build_store().
    # build_store runs lazily on the first admin request, so a gateway with ADMIN_REQUIRE_MFA=0 in
    # prod used to boot fine, serve every learner, and surface the misconfiguration as a 500 the
    # first time somebody opened the console. Fail-closed either way; told at deploy is the point.
    admin_auth.validate_admin_env()


def _cors_origins() -> list[str]:
    # Locked: localhost is a dev convenience and must never reach prod's allowlist.
    if os.getenv("ENV", "dev").lower() == "prod":
        return [APP_URL]
    return [APP_URL, *_DEV_ORIGINS]


def _preview_origin_regex() -> str | None:
    """The per-deploy preview pattern — outside prod only.

    Read at app build time (not import time) so ENV set by the host is honoured."""
    if os.getenv("ENV", "dev").lower() == "prod":
        return None
    return _PREVIEW_ORIGIN_REGEX


class ConsentDenied(Exception):
    """Raised when a capability is invoked under a consent tier it does not permit."""

    def __init__(self, capability: str, consent_tier: ConsentTier) -> None:
        self.capability = capability
        self.consent_tier = consent_tier
        super().__init__(
            f"{capability} requires an elevated consent tier; got {consent_tier.value}"
        )


class CapabilityRequest(BaseModel):
    # Accepted and IGNORED. The tier is derived from the verified subject in consent.get_tier;
    # a door the caller can open by typing a word in a body is not a door. The field stays for
    # one release so the already-deployed web bundle does not 422 on its next call — delete it,
    # and the alias in budget.CAPABILITY_CLASS, once no shipped client sends it.
    consent_tier: ConsentTier | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class CapabilityResponse(BaseModel):
    capability: str
    track: str
    # The real provider model id. Honest telemetry INSIDE the brain — it is recorded, logged and
    # asserted on in tests, but it is stripped by `served()` before the response leaves the
    # gateway. Model ids never reach a client (WOBO-PLAN 1, white-label rule).
    model: str
    cache_hit: bool
    latency_ms: float
    tokens: int
    output: dict[str, Any]

    def served(self) -> dict[str, Any]:
        """The public shape. One place where a response crosses out of the brain."""
        return self.model_dump(exclude={"model"})


class PolicyView(BaseModel):
    """What a client may know about a capability: that it exists, and whether a door guards it.

    Routing is the brain's business. The provider model id, the slot names (which carry provider
    names of their own), the latency target and the cost ceiling are all deliberately absent —
    the client holds no key, no model name and no limit (WOBO-PLAN 1).
    """

    capability: str
    track: str
    cache_tier: str
    elevated_only: bool


def _policy_view(pol: RoutingPolicy) -> PolicyView:
    return PolicyView(
        capability=pol.capability,
        track=pol.track.value,
        cache_tier=pol.cache_tier.value,
        elevated_only=pol.elevated_only,
    )


class Gateway:
    def __init__(
        self,
        provider: Provider,
        cache: CacheBackend,
        sink: MetricsSink,
        classifier: SafetyClassifier = DEFAULT_CLASSIFIER,
    ) -> None:
        self.provider = provider
        self.cache = cache
        self.sink = sink
        self.classifier = classifier

    def invoke(
        self,
        capability: str,
        request: CapabilityRequest,
        consent_tier: ConsentTier = ConsentTier.UN_ELEVATED,
        subject: str | None = None,
        priority: spend.Priority = spend.Priority.STRANGER,
        plan: str | None = None,
    ) -> CapabilityResponse:
        # subject is the VERIFIED subject from the door (never payload-supplied), and
        # consent_tier is the SERVER-DERIVED tier (consent.get_tier of the verified subject),
        # passed in as its own argument. It defaults to least privilege so a caller that forgets
        # it gets the un-elevated door, never the elevated one. request.consent_tier is ignored.
        #
        # priority is the lane the platform's daily money ceiling sheds load in (spend.py). It
        # defaults to STRANGER for the same reason consent_tier defaults to un-elevated: a
        # caller that does not name itself gets the lane that is shed FIRST, so a forgotten
        # argument costs the owner nothing and never spends a paying learner's headroom. The
        # authenticated capability route names the real lane; the public Ask box and the cron
        # jobs take this default, which is exactly what they are.
        pol = policy(capability)
        if not pol.allows(consent_tier):
            raise ConsentDenied(capability, consent_tier)

        # THE FREE LANE (docs/ALLOWANCE.md, "The free tier: five rupees a day, on Luna"). The
        # owner's ruling is that a plan buys QUANTITY and never quality: a free learner's live
        # turn runs on the tiny chain (Luna), a paid learner's on the turn chain (Terra), and
        # NOTHING else moves — ``routing.lane_tier`` steps only ``turn``, so verify, safety,
        # voice, vision and the creative tier are byte-for-byte the same on every plan, which is
        # where the quality actually lives (it is made once, judged, cached and shared).
        #
        # ``plan`` defaults to None, which ``lane_tier`` reads as free, for the same reason
        # ``consent_tier`` defaults to un-elevated and ``priority`` to stranger: a caller that
        # does not name itself gets the cheap lane, never a paying learner's. A plan name nobody
        # recognises is free as well — a billing bug must cost questions, never hand out a lane
        # nobody paid for, which is the rule ``budget`` and ``spend`` already keep.
        #
        # Resolved through the TIER rather than through ``pol.primary`` so the lane and the
        # owner's live routing table can never disagree: a dial moved on the models desk changes
        # the tier, and this reads the tier.
        #
        # …EXCEPT WHERE THERE IS NO LEARNER TO BE FREE (``routing.LANE_EXEMPT``). The default
        # above is right for a caller that forgot to name a plan and wrong for one that has none
        # to name: ``parent_mind`` reaches this door with no plan because a PARENT is asking about
        # their child, and reading that as "free" quietly dropped the parent's companion from
        # Terra to Luna for every family, on every plan, with the whole suite green.
        if canonical_capability(capability) in LANE_EXEMPT:
            lane = pol.tier
        else:
            lane = lane_tier(pol.tier, plan)
        spec = resolve(tier_primary(lane), pol.track)

        # safety.moderate runs the deterministic child-safety classifier in every mode — the
        # keyword screen today, the trained slm.safety model through the same seam tomorrow.
        if capability == "safety.moderate":
            output = moderate(str(request.payload.get("text") or ""), self.classifier)
            emit(
                self.sink,
                TelemetryEvent(capability, spec.track.value, "safety.screen", 0.0, 0, False),
            )
            return CapabilityResponse(
                capability=capability,
                track=spec.track.value,
                model="safety.screen",
                cache_hit=False,
                latency_ms=0.0,
                tokens=0,
                output=output,
            )

        # Inbound safety on EVERY learner-facing surface (WOBO.md §11): a crisis or moderation
        # hit never reaches a model — Wobo answers with the calm supportive line directly. This
        # used to be a `capability == "wobo.turn"` special case, which meant the very same
        # sentence typed into a course request, a graded attempt or an engine concept went
        # straight to a frontier model unscreened. The set lives in safety.py.
        if capability in LEARNER_FACING_CAPABILITIES:
            gated = screen_inbound(request.payload, self.classifier)
            if gated is not None:
                category = str(gated["safety"]["category"])
                logger.warning(
                    "turn gated by safety",
                    extra={"fields": {"capability": capability, "category": category}},
                )
                # The alarm, not just the log: a crisis category is a child in trouble and it is
                # the one thing in this service worth a person's attention within minutes. The
                # learner's words are NEVER carried — only the category and the capability.
                alerts.alert(
                    alerts.SAFETY_GATE,
                    f"the safety gate stopped something on the way in to {capability}",
                    severity=alerts.CRITICAL if category == CATEGORY_CRISIS else alerts.WARN,
                    capability=capability,
                    category=category,
                    direction="inbound",
                )
                emit(
                    self.sink,
                    TelemetryEvent(capability, spec.track.value, "safety.gate", 0.0, 0, False),
                )
                return CapabilityResponse(
                    capability=capability,
                    track=spec.track.value,
                    model="safety.gate",
                    cache_hit=False,
                    latency_ms=0.0,
                    tokens=0,
                    output=gated,
                )

        key = cache_key(capability, request.payload)

        cached = self.cache.get(key, pol.cache_tier)
        if cached is not None:
            emit(
                self.sink,
                TelemetryEvent(capability, spec.track.value, cached.model, 0.0, 0, True),
            )
            # A cache hit never reaches ``telemetry.record_cost``, so without this line the
            # ledger would only ever see the expensive half of the traffic and every per-turn
            # cost it derived would be too high. The turn WAS served and it cost zero — a real
            # figure, not an unpriced one — and the cache is the single biggest reason a free day
            # is affordable at all, so it has to be visible in the arithmetic that prices one.
            ledger.record(
                capability=capability,
                model_served=cached.model,
                model_requested=cached.model,
                track=spec.track.value,
                cost_usd=0.0,
                cost_source=ledger.NO_PROVIDER_CHARGE,
                latency_ms=0,
                cache_hit=True,
            )
            return CapabilityResponse(
                capability=capability,
                track=spec.track.value,
                model=cached.model,
                cache_hit=True,
                latency_ms=0.0,
                tokens=0,
                output=cached.output,
            )

        # The platform's daily money ceiling (spend.py), asked HERE and not a line earlier: a
        # cache hit above costs nothing, so it is served whatever the day looks like, and a
        # refusal never lands on a learner we could have answered for free.
        verdict = spend.verdict(priority)
        if verdict is spend.Verdict.REFUSE:
            logger.warning(
                "spend ceiling refused a call",
                extra={
                    "fields": {
                        "capability": capability,
                        "priority": priority.value,
                        **spend.state().as_dict(),
                    }
                },
            )
            raise spend.SpendCeilingReached(priority, capability=capability)
        fallback_names = tier_fallbacks(lane)
        if verdict is spend.Verdict.DEGRADE:
            # Degrade rather than break: one rung DOWN the routing ladder, same track, same
            # capability, same safety screens. A cheaper answer beats no answer.
            #
            # From the LANE, not from the policy's own tier: a free learner is already on tiny,
            # which is the floor, so there is nothing below it to fall to and the call is served
            # as it is. Degrading from ``pol.tier`` here would have stepped a free turn "down"
            # to the tier it was already on and logged a degrade that never happened.
            cheaper = spend.cheaper_tier(lane)
            if cheaper is not None:
                spec = resolve(tier_primary(cheaper), pol.track)
                fallback_names = tier_fallbacks(cheaper)
                logger.warning(
                    "spend ceiling degraded a call",
                    extra={
                        "fields": {
                            "capability": capability,
                            "priority": priority.value,
                            "from_tier": lane.value,
                            "to_tier": cheaper.value,
                            **spend.state().as_dict(),
                        }
                    },
                )

        fallbacks = tuple(resolve_any(name).provider_model for name in fallback_names)
        start = time.perf_counter()
        try:
            result = self.provider.complete(
                provider_model=spec.provider_model,
                capability=capability,
                payload=request.payload,
                fallbacks=fallbacks,
                # The VERIFIED subject, as its own argument. The engine's one-generation-at-a-time
                # slot keys on this; it used to key on payload["user"], which the caller writes.
                subject=subject,
            )
        except Exception as exc:
            # A provider that refused or timed out. Recorded so /healthz can tell a run of them
            # from a single bad minute, and alerted so somebody hears about an outage that would
            # otherwise only ever be a 500 in a log nobody reads.
            health.record_provider(False)
            alerts.alert(
                alerts.PROVIDER_OUTAGE,
                f"a model call for {capability} failed: {type(exc).__name__}",
                severity=alerts.WARN,
                capability=capability,
                model=spec.provider_model,
                error=type(exc).__name__,
            )
            if is_provider_failure(exc):
                # Every rung refused, or every provider was already marked out. That is not a
                # bug in this service, so it is not answered as one: the routes turn this into
                # Wobo's own line (a 503 in the ceiling's ``{code, message}`` shape, or the line
                # over the board stream) instead of FastAPI's bare 500. The provider's error
                # stays underneath as the cause, for the log and the alert above.
                raise ProviderUnavailable(capability, reason=type(exc).__name__) from exc
            raise
        health.record_provider(True)
        latency_ms = (time.perf_counter() - start) * 1000

        output = result.output
        # Outbound safety: whatever the model wants to put in front of the learner — the spoken
        # line, the text of every overlay action and the visualization caption — is screened
        # before serving, on every learner-facing capability rather than on wobo.turn alone.
        if capability in LEARNER_FACING_CAPABILITIES:
            output = screen_outbound(output, self.classifier)

        # The model that actually answered: a provider reports it when a fallback took over (e.g. a
        # Track-2 placeholder that failed over to the frontier), else the policy's primary. The
        # cache and telemetry record the real model, never one that never ran.
        served_model = result.model or spec.provider_model

        self.cache.set(
            key,
            CacheEntry(output=output, model=served_model, tokens=result.tokens),
            pol.cache_tier,
        )
        emit(
            self.sink,
            TelemetryEvent(
                capability, spec.track.value, served_model, latency_ms, result.tokens, False
            ),
        )
        return CapabilityResponse(
            capability=capability,
            track=spec.track.value,
            model=served_model,
            cache_hit=False,
            latency_ms=latency_ms,
            tokens=result.tokens,
            output=output,
        )


def build_gateway() -> Gateway:
    mode = os.getenv("LLM_MODE", "mock").lower()
    return Gateway(build_provider(mode), InMemoryCache(), MetricsSink())


# Routes that never need a learner identity: liveness only. The internal email relay carries
# its own shared key, but it is NOT skipped here any more — the middleware authenticates it
# when a learner token rides along (without refusing when one does not), so the endpoint's
# "you may only mail your own address" rule has a subject to check against instead of None.
# The one-click mail stop is open on purpose: it is reached from a mail footer with no session,
# and its signed token (hospitality/tokens.py) is the only authority it needs.
# The public site's Ask Wobo box is open too (ask_public.py): a visitor with no account asks,
# and its own per-client allowance is the door.
# The parent's accept and decline pages are open for the same reason as the stop link: a signed,
# single-use token from the invite mail is their only authority (parents.py).
# The payment provider's webhook is open because the provider holds no learner token; its door
# is the HMAC over the raw body (billing/payments.py), checked before a byte of it is parsed.
_OPEN_PATHS = frozenset(
    {
        "/healthz",
        "/v1/mail/stop",
        # The link that lands (docs/EMAILS-AND-ANIMATIONS.md §4). Pressed from an inbox, by
        # somebody who by definition has no session yet — the whole point of the route is to tell
        # the app where they were going before they go through the door.
        "/v1/mail/land",
        *ASK_OPEN_PATHS,
        # The syllabus read (curriculum/public.py). No learner data behind it, nothing personal
        # in it, and every public chapter page is built from it.
        *SYLLABUS_OPEN_PATHS,
        *PARENT_OPEN_PATHS,
        *PAYMENTS_OPEN_PATHS,
        # The dial the site reads so its copy follows the switch without a release, and the list
        # that stands where the door was (doors.py, waiting_list.py). Neither has a token to
        # offer: the whole point of both is that the person at them cannot get an account yet.
        *DOORS_OPEN_PATHS,
        *WAITING_LIST_OPEN_PATHS,
    }
)
# Authenticated when we can, never refused here: the route itself is the door (internal key).
# The three cron doors (hospitality/jobs.py: the Sunday note, the festival wishes;
# hospitality/nudges.py: the five nudges of docs/EMAILS-AND-ANIMATIONS.md §1) share that key and
# that posture — refused by the shared key with a 403, never by the token with a 401, because a
# cron carries no learner.
_SOFT_AUTH_PATHS = frozenset(
    {
        "/v1/email/send",
        "/v1/internal/mail/sunday",
        "/v1/internal/mail/wishes",
        "/v1/internal/mail/nudges",
    }
)

# A request body is a context packet, not a file. Past this it is either a mistake or an attempt
# to buy a frontier context window out of one metered turn (the prompt builder caps its own
# output too — this stops the bytes at the door, before anything parses them).
_MAX_BODY_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(256 * 1024)))
# The one route that legitimately carries a photograph: the doubt solver (doubt.py). Its ceiling
# is its own, on its own path prefix, so the context-packet ceiling above stays exactly where it
# is for everything else. 8 MB is the base64 of doubt.MAX_IMAGE_BYTES with a little room for the
# learner's words around it; doubt.prepare_image bounds the decoded bytes again on the inside.
_DOUBT_PATH = "/v1/doubt"
_DOUBT_MAX_BODY_BYTES = int(os.getenv("DOUBT_MAX_REQUEST_BYTES", str(8 * 1024 * 1024 + 64 * 1024)))


def _ceiling_for(path: str) -> int:
    """How big a body this path may carry. A photo route, or a context packet."""
    return _DOUBT_MAX_BODY_BYTES if path.startswith(_DOUBT_PATH) else _MAX_BODY_BYTES


def _client_ip(request: Request) -> str:
    """The caller's address, as well as we can know it.

    ``X-Forwarded-For`` is caller-controlled: a client may send any prefix it likes, and each
    proxy APPENDS the address it received the connection from. So the trustworthy entry is the
    LAST hop — the one our own platform wrote — not the first, which is whatever the attacker
    typed. Taking the first hop made the limiter a no-op behind a proxy.
    """
    if os.getenv("TRUST_PROXY") == "1":
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
            if hops:
                return hops[-1]
    return request.client.host if request.client else "unknown"


# The salt makes the log fingerprint unlinkable across deployments and un-reversible by anyone
# who merely holds the log: without it, a blake2b of an IPv4 address is a 4-billion-entry
# rainbow table away from the address itself.
_IP_LOG_SALT = os.getenv("IP_LOG_SALT", "").encode() or os.urandom(16)


def _ip_fingerprint(ip: str) -> str:
    """A stable, salted, non-reversible stand-in for a client address.

    Our learners are minors, so the raw address never lands in a log line: rate-limit forensics
    and abuse correlation only ever need "same caller or not", which a keyed digest answers.
    """
    return hashlib.blake2b(ip.encode(), key=_IP_LOG_SALT[:64], digest_size=8).hexdigest()


# The gateway is not only a JSON API: it serves real HTML to people who are not signed in —
# the parent's accept and decline pages, and the one-click mail stop reached from a mail footer.
# Those went out with no CSP, no framing refusal and no nosniff, so a parent's opt-out page could
# be framed invisibly into somebody else's and clicked through. One header block for the whole
# origin, JSON included, because the cost is a few bytes and the alternative is remembering.
#
# `default-src 'none'` is the right default for pages that load nothing: no scripts, no images,
# no fonts, no network. `style-src 'unsafe-inline'` is what the one inline <style> block in those
# pages needs, and `form-action 'self'` is what their one button needs — the page posts its token
# back to us and nowhere else.
_SECURITY_HEADERS: dict[str, str] = {
    "Content-Security-Policy": (
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; "
        "base-uri 'none'; frame-ancestors 'none'"
    ),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
}
# Two years, subdomains included. Sent only when the request actually arrived over TLS: over
# plain http the header is meaningless and browsers ignore it.
_HSTS = "max-age=63072000; includeSubDomains"


def _over_tls(request: Request) -> bool:
    """Did this request reach us over https?

    Our container runs uvicorn with ``--forwarded-allow-ips ''`` (see the Dockerfile), so uvicorn
    never rewrites the scheme from a header and ``request.url.scheme`` is the SOCKET's scheme —
    plain http behind the platform's TLS terminator. The forwarded proto is therefore read here.
    It is caller-controllable, and harmlessly so: the only thing a forged value can do is make
    the caller's own browser insist on https for our own domain.
    """
    if request.url.scheme == "https":
        return True
    forwarded = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    return forwarded == "https"


def _secured(response: Response, request: Request) -> Response:
    """Every response the gateway sends, hardened. Set, never overwritten, so a route that has
    already made a stricter decision for itself keeps it."""
    for header, value in _SECURITY_HEADERS.items():
        response.headers.setdefault(header, value)
    if _over_tls(request):
        response.headers.setdefault("Strict-Transport-Security", _HSTS)
    return response


def _declared_size(request: Request) -> int | None:
    """What the client SAYS the body weighs, or None when it declined to say.

    A ``Content-Length`` that is too big is refused on the spot, before a byte is read: the
    server's framing will not deliver more than a declared length, so an honest header is a free
    answer and a lying small one cannot smuggle a large body past it.
    """
    declared = request.headers.get("content-length")
    if not declared:
        return None
    try:
        return int(declared)
    except ValueError:
        return None


_BODY_METHODS = frozenset({"POST", "PUT", "PATCH"})


async def _over_the_ceiling(request: Request) -> bool:
    """Is this body bigger than we will ever read? Declared when it can be, COUNTED when it cannot.

    The cap used to be the ``Content-Length`` header alone, and the header is written by the
    caller: a chunked ``POST`` simply omits it, and ~400 KB of context — well past the 256 KB
    ceiling — was read, parsed and served. A ceiling a client opts out of by leaving out a header
    is not a ceiling, so when no length is declared the bytes are counted off the wire and the
    read stops the moment the total passes the cap. Nothing downstream ever sees them.

    The drained body is handed to the route through Starlette's own request cache
    (``_body``, the attribute :meth:`starlette.requests.Request.body` fills), which
    ``BaseHTTPMiddleware`` replays to the app underneath us. Without that the route would read an
    empty body: consuming the stream here consumes it for everyone.
    """
    ceiling = _ceiling_for(request.url.path)
    declared = _declared_size(request)
    if declared is not None:
        return declared > ceiling
    if request.method not in _BODY_METHODS:
        return False
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > ceiling:
            return True  # stop reading: the rest of this body is never coming into memory
        chunks.append(chunk)
    request._body = b"".join(chunks)  # noqa: SLF001 — the cache Request.body() itself fills
    return False


def meter_key(principal: Principal | None, request: Request) -> str:
    """The identity the meter and the limiter count against.

    A signed-in subject is the identity. An ANONYMOUS subject is not: Supabase anonymous
    sign-in is a public endpoint, so a fresh subject costs an attacker one HTTP call, and
    per-subject counters are then arithmetic rather than limits (verified: 30 turns from 30
    subjects under a 2-turn cap). Anonymous learners are therefore counted per DEVICE ADDRESS,
    which is the scarcest thing we can see before someone signs in. Signing in gives them their
    own counter back, which is the trade we want.
    """
    if principal is None:
        return f"ip:{_client_ip(request)}"
    if principal.anonymous:
        return f"anon:{_client_ip(request)}"
    return f"sub:{principal.subject}"


def board_key(principal: Principal | None, request: Request) -> str:
    """Who OWNS a remembered board turn — which is not the same question as who pays for it.

    :func:`meter_key` counts anonymous learners per device address on purpose (a fresh anonymous
    subject costs an attacker one HTTP call, so per-subject counters are arithmetic rather than
    limits). Ownership must not be that key. Two children behind one home or school NAT share an
    address, and keying a turn on the address alone let either of them resume or interrupt the
    other's board — demonstrated, and the reason this function exists.

    So: the meter stays on the address (the anti-abuse property is untouched) and ownership is
    the address AND the verified subject. A stranger who mints a new anonymous subject gets the
    same allowance as before and reaches nobody else's turn.
    """
    key = meter_key(principal, request)
    if principal is None or not principal.anonymous:
        return key
    return f"{key}#{principal.subject}"


class MeResponse(BaseModel):
    """What the client is allowed to know about itself: who, what tier, how much is left.

    No model, no provider, no price, no limit — only what remains today.

    ``allowance`` is the day itself (docs/ALLOWANCE.md §2): ``used`` is a fraction between 0 and
    1 and ``resets_at`` is the learner's own midnight. NO CURRENCY, on this surface or any other
    a learner or a parent can reach — the rupees are the gateway's arithmetic and the owner's
    desk, and the You page draws one bar from this fraction and the line "Resets at midnight."
    """

    subject: str
    anonymous: bool
    plan: str
    consent_tier: str
    budget: dict[str, Any]
    allowance: dict[str, Any] = Field(default_factory=dict)


class InterruptRequest(BaseModel):
    """The interrupt frame (BOARD.md §4): which turn, and where the pen came up.

    ``at`` is the client's own ``interrupted_at`` — the id of the object Wobo was drawing — and
    it is echoed back, never trusted as anything else. Both fields are bounded: an id is short,
    and this route is reachable by anyone with a token."""

    turn: str = Field(min_length=1, max_length=64)
    at: str | None = Field(default=None, max_length=64)


# --- the streaming board turn (BOARD.md §4) ---------------------------------------------------
#
# The board streams over the SAME route as a plain turn — POST /v1/capability/wobo.turn with
# ``Accept: text/event-stream``. That is deliberate and it is the whole reason it is not a socket:
# the door, the consent tier, the rate limiter and the meter all key on this path in one
# middleware, and a WebSocket runs before none of it (which is why the voice relay had to mint a
# token of its own). One route means one door and one meter for both shapes of the same turn.

_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    # Nginx and friends buffer a streamed body by default, which would hold the first stroke back
    # until the whole plan was written — exactly the failure BOARD.md §10 budgets against.
    "X-Accel-Buffering": "no",
}


def wants_event_stream(request: Request) -> bool:
    return "text/event-stream" in (request.headers.get("accept") or "").lower()


def _stream(
    turn: Any,
    after: int,
    headers: dict[str, str],
    then: Any | None = None,
) -> StreamingResponse:
    from wobo_gateway.board import stream as board_stream

    return StreamingResponse(
        board_stream.iter_sse(turn, after=after, then=then),
        media_type="text/event-stream",
        headers={**_SSE_HEADERS, **headers},
    )


def _one_shot_turn(say: str, owner: str, headers: dict[str, str]) -> StreamingResponse:
    """A turn with nothing to draw — Wobo's line and a close, in the same envelope."""
    from wobo_gateway.board import stream as board_stream
    from wobo_gateway.board.planner import Plan

    plan = Plan(say=say, presentation="screen")
    turn = board_stream.new_turn(owner, board_stream.build_events(plan))
    return _stream(turn, -1, headers)


class TurnShaper(Protocol):
    """Two hooks a caller may hang on a board turn without a second turn being built.

    The doubt solver (``doubt.py``) is the one caller today: it composes THIS turn over a photo,
    and its laws — a mark lands on a line of the page or not at all, and every stroke is paired
    with the sentence that explains it — are shaped onto the plan here, between the same planner,
    verifier and screens every other turn goes through. ``shape_model_plan`` sees the model's
    plan before the planner does; ``shape_plan`` sees the finished, screened plan before it is
    laid on the wire.
    """

    def shape_model_plan(self, plan: dict[str, Any]) -> dict[str, Any]: ...

    def shape_plan(self, plan: Any) -> Any: ...


def _scaffolded_words(
    gw: Gateway,
    request: CapabilityRequest,
    scaffold: Any,
) -> Any:
    """Phase two of a scaffolded turn: the model's words, over a drawing already on the board.

    It runs INSIDE the response body, after the scaffold's frames have gone out, so it can never
    answer with a status code — the learner is already watching Wobo draw. Everything that would
    have been an error before the first byte is therefore the same thing here: what was drawn
    stands, the question held in reserve is asked, and the turn closes honestly. A provider that
    falls over used to cost the whole turn; now it costs the words.

    THE WORDS, AND ONLY THE WORDS (the adversary, wave 42, finding 10). Until 2026-09-10 this
    asked ``board_plan_for`` for a whole board plan — the 14 428-character drawing grammar, the
    glass map, 900 tokens on the generate tier — and every object it planned was then dropped by
    ``scaffold.resume`` as a mark already on the board, on all five from-scratch boards. The
    learner sat through that for a sentence. A turn that drew from a pipeline now asks the tiny
    tier for words (``scaffold.words_brief``), which is the only part of it the model made.
    """

    # THE ACCENT, CARRIED INTO PHASE TWO BY HAND. This closure is made on the request's own
    # thread and RUN inside the response body — another thread, which inherits no contextvar. The
    # whole plan's speech is bought where the words are decided (``voice.remember_parts``), and
    # that happens down there: without this the buy has no accent to buy on and every sentence is
    # paid for again, one round trip at a time, behind the learner.
    from wobo_gateway import voice as _v

    accent_here = _v.current_accent()

    def _words(turn: Any) -> None:
        _v.mark_accent(accent_here)
        from wobo_gateway.board import scaffold as board_scaffold
        from wobo_gateway.board.planner import plan_board
        from wobo_gateway.wobo import board_words_for

        context = request.payload.get("context") or {}
        board_context = request.payload.get("board") or {}
        # The figure the scaffold drew is on the board, so it is in the surface the planner
        # resolves anchors against — the words carry none, and a later phase may.
        drawn = [*(board_context.get("drawn") or []), *scaffold.ids()]
        try:
            model_plan = board_words_for(request.payload, scaffold=scaffold)
            if model_plan is None:
                turn.extend(board_scaffold.alone(scaffold))
                return
            planned = plan_board(
                model_plan,
                context=context,
                board_context={**board_context, "drawn": drawn},
            )
            # The spoken-number law reads the WHOLE drawing, and this phase holds none of it: the
            # figure and its ledger are the scaffold's (``scaffold.say_the_drawing``).
            board_scaffold.say_the_drawing(scaffold, planned, context)
            screened = screen_wobo_outbound(
                {
                    "say": planned.say,
                    "actions": [],
                    "objects": planned.objects,
                    "ask": planned.ask,
                },
                gw.classifier,
            )
            planned.say = str(screened.get("say") or planned.say)
            planned.objects = list(screened.get("objects") or [])
            planned.ask = screened.get("ask") if isinstance(screened.get("ask"), dict) else None
            turn.extend(board_scaffold.resume(scaffold, planned))
        except Exception:
            logger.warning(
                "the model never finished a scaffolded turn; what was drawn stands",
                exc_info=True,
            )
            turn.extend(board_scaffold.alone(scaffold))

    return _words


def stream_board_turn(
    gw: Gateway,
    name: str,
    request: CapabilityRequest,
    http: Request,
    profile: Any,
    plan: str,
    *,
    shaper: TurnShaper | None = None,
) -> Response:
    """One streamed turn: say, ink, action, ask, card, done.

    Resume first (a reconnect costs nothing — the learner already paid for this turn), then the
    inbound safety screen, then the meter, then the plan.
    """
    from wobo_gateway.board import stream as board_stream
    from wobo_gateway.board.planner import Plan, TooMuchAtOnce, plan_board

    # THE BILLING PLAN, UNDER A NAME NOTHING IN THIS FUNCTION CAN SHADOW.
    #
    # ``plan`` is the parameter's meaning for the first forty lines and then stops being it: from
    # the planner onwards this function rebinds ``plan`` to a board ``Plan`` three times, which is
    # why the money lines near the top are careful to read it "before ``plan`` is rebound". Anything
    # below that point which still means "free or pro" has to say so in a different word, or it
    # silently receives a dataclass — the free lane's ``lane_tier`` did exactly that and answered
    # every board turn with ``TypeError: unhashable type: 'Plan'``.
    metered_plan = plan

    principal: Principal = http.state.principal
    meter = http.state.meter_key
    # The meter counts per address for anonymous learners; ownership does not (see board_key).
    owner = http.state.board_key

    # The lane the platform's money ceiling sheds load in, read before ``plan`` is rebound to a
    # board Plan below. Derived from the door, never from the body.
    priority = spend.priority_for(
        anonymous=principal.anonymous, signed_in=bool(principal.subject), plan=plan
    )
    # Name the caller for the usage ledger, on the same three facts the lane above is derived
    # from and from the same verified source. A board turn makes model calls in several places
    # (the planner, the five-path fallback, the narration), and every row any of them writes now
    # carries the plan, the anonymity and the learner pseudonym without an argument being threaded
    # through them. The learner reaches the ledger only as a salted digest of the meter key.
    ledger.mark(plan=plan, anonymous=principal.anonymous, meter_key=meter)
    # AND THE ACCENT THIS LEARNER'S SPOKEN LINES ARE READ IN, for the same reason and from the
    # same verified record. A turn's words are decided here, seconds before one syllable of them
    # is asked for, and that is when the whole plan's speech is bought (``voice.remember_parts``)
    # — which can only be done on the accent the client's own call will present, or the audio is
    # paid for under a key nobody ever asks for.
    from wobo_gateway import voice as _voice

    spoken_accent = _voice.learner_accent(principal.claims, http.headers.get("accept-language"))
    _voice.mark_accent(spoken_accent)

    resume = board_stream.parse_last_event_id(http.headers.get("last-event-id"))
    if resume is not None:
        turn = board_stream.recall(resume[0], owner)
        if turn is not None:
            snap = budget.snapshot(meter, plan, anonymous=principal.anonymous)
            return _stream(turn, resume[1], budget.headers(snap, budget.classify(name)))

    # The money ceiling, BEFORE the meter: a learner refused because the platform is out of
    # money must not also lose one of their own turns for it. They get Wobo's own line over the
    # ordinary stream rather than an error, because a child asking a question deserves an answer
    # in a voice they know even when the answer is "not today".
    verdict = spend.verdict(priority)
    if verdict is spend.Verdict.REFUSE:
        refused = spend.SpendCeilingReached(priority, capability=name)
        logger.warning(
            "spend ceiling refused a board turn",
            extra={"fields": {"priority": priority.value, **spend.state().as_dict()}},
        )
        snap = budget.snapshot(meter, plan, anonymous=principal.anonymous)
        return _one_shot_turn(
            refused.message, owner, budget.headers(snap, budget.classify(name))
        )

    snap = budget.charge(meter, name, plan, anonymous=principal.anonymous)
    headers = budget.headers(snap, budget.classify(name))

    # Inbound safety runs before anything reaches a model, exactly as it does inside Gateway.invoke.
    gated = screen_wobo_inbound(request.payload, gw.classifier)
    if gated is not None:
        category = str(gated["safety"]["category"])
        logger.warning("board turn gated by safety", extra={"fields": {"category": category}})
        alerts.alert(
            alerts.SAFETY_GATE,
            "the safety gate stopped something on the way in to a board turn",
            severity=alerts.CRITICAL if category == CATEGORY_CRISIS else alerts.WARN,
            capability=name,
            category=category,
            direction="inbound",
        )
        # NOTHING IS CHARGED FOR A DISCLOSURE. The meter is charged above, before the screen
        # runs, because the screen needs the payload the meter's headers are built beside — so
        # the charge is GIVEN BACK here. Until 2026-09-04 it was not, on either live path, while
        # the published line read "the turn never reaches a model. Nothing is charged, nothing is
        # counted." A child who told Wobo their father hits them paid one of their daily turns
        # for saying it, and the headers on the answer told them so.
        budget.refund(meter, name)
        snap = budget.snapshot(meter, plan, anonymous=principal.anonymous)
        return _one_shot_turn(
            str(gated.get("say") or ""), owner, budget.headers(snap, budget.classify(name))
        )

    live = os.getenv("LLM_MODE", "mock").lower() == "live"

    # THE INSTANT MARK ON A DRAWING FROM SCRATCH (docs/INK-FOUR.md, Timing at 4; board/scaffold.py).
    #
    # The geometry of a drawing built from scratch never came from the model — a plan says
    # ``open: {kind, intent}`` and a pipeline builds it — yet the ink waited on the model anyway,
    # so the first stroke of "prove Pythagoras with squares on the sides" landed 13.7 SECONDS
    # after the learner asked. When the deterministic reading resolves the ask, its ink goes on
    # the wire NOW and the model's words follow on the same turn, the same door and the same
    # meter. Keyless the turn is already deterministic and already inside the budget, so nothing
    # is drawn twice there; degraded, no plane opens at all; and a turn the doubt solver is
    # composing over a photo is its own shape and is left alone.
    scaffold = None
    if live and verdict is not spend.Verdict.DEGRADE and shaper is None:
        from wobo_gateway.board import scaffold as board_scaffold

        board_stream.mark_turn_start()
        try:
            scaffold = board_scaffold.prepare(
                request.payload,
                context=request.payload.get("context") or {},
                board_context=request.payload.get("board") or {},
            )
        except Exception:  # a scaffold that cannot be built is a turn that waits, never a 500
            logger.warning("board scaffold failed; the turn waits on the model", exc_info=True)
            scaffold = None

    if scaffold is not None:
        turn = board_stream.new_turn(owner, list(scaffold.events))
        return _stream(
            turn,
            -1,
            headers,
            _scaffolded_words(gw, request, scaffold),
        )

    try:
        from wobo_gateway.wobo import board_plan_for

        # Degrade rather than break: past this lane's degrade line the expensive half of a board
        # turn — planning what to DRAW, on the generate tier — is skipped, and the turn falls to
        # the ordinary five-path answer below, which is itself served on a cheaper tier by
        # Gateway.invoke. The learner still gets Wobo's answer; they just do not get the drawing.
        if verdict is spend.Verdict.DEGRADE:
            logger.warning(
                "spend ceiling degraded a board turn to a spoken answer",
                extra={"fields": {"priority": priority.value, **spend.state().as_dict()}},
            )
            model_plan = None
        else:
            model_plan = board_plan_for(request.payload, live=live)
            if model_plan is not None and shaper is not None:
                model_plan = shaper.shape_model_plan(model_plan)
        context = request.payload.get("context") or {}
        board_context = request.payload.get("board") or {}

        refusals: list[str] = []
        if model_plan is not None:
            plan = plan_board(model_plan, context=context, board_context=board_context)
            # THE SPOKEN-NUMBER LAW (``spoken``): the verifier has now signed every number on the
            # board, so this is the first moment the line Wobo says OVER it can be held to the
            # same standard. A number in the say that the learner did not give, the verifier did
            # not draw and no written-out sum confirms is not spoken; the ink choreographed to
            # later sentences is re-anchored so it still lands on words.
            if not plan.objects and (model_plan.get("objects") or model_plan.get("intents")):
                # EVERY STROKE WAS REFUSED. The plan's words went with its ink: a sentence
                # written over a ring that is not there is a promise over an empty board
                # (BOARD.md §11), and the plane never opens empty (INK-FREEZE-PLAN-TRACE §3).
                # The turn falls to the spoken answer below, ONE planning later, not two: the
                # dry run that used to plan every silent turn twice is gone, and the reasons
                # ride to the ``done`` frame so the harness can read what was refused.
                refusals = list(plan.refusals)
                model_plan = None
            else:
                spoken.enforce_board(plan, context)

        if model_plan is None:
            # Nothing to draw: fall back to the ordinary five-path turn, which carries its own
            # safety screens, cache and telemetry, and stream Wobo's line over the same wire.
            result = gw.invoke(
                name,
                request,
                profile.tier,
                subject=principal.subject,
                priority=priority,
                # NOT ``plan``: by this line that name is the board's Plan (see the top of this
                # function). This is the learner's free-or-paid lane.
                plan=metered_plan,
            )
            output = result.output
            plan = Plan(say=str(output.get("say") or ""), presentation="screen", refusals=refusals)
            card = output.get("component") or output.get("viz")
            actions = [a for a in (output.get("actions") or []) if isinstance(a, dict)]
        else:
            # THE WHOLE PLAN, not the spoken line. This used to hand the screen
            # ``{"say": plan.say, "actions": []}`` and pass ``plan.objects`` and ``plan.ask``
            # straight to ``build_events``, which emits every object as an ``ink`` event and the
            # ask as an ``ask`` event — so the words the model WRITES ON THE BOARD, and the
            # question it poses to the child, were the one model output nothing read. The board
            # is the primary teaching surface; it was the largest outbound hole in the product.
            screened = screen_wobo_outbound(
                {
                    "say": plan.say,
                    "actions": [],
                    "objects": plan.objects,
                    "ask": plan.ask,
                },
                gw.classifier,
            )
            plan.say = str(screened.get("say") or plan.say)
            # A screened turn draws nothing. Half of it is the harmful half.
            plan.objects = list(screened.get("objects") or [])
            plan.ask = screened.get("ask") if isinstance(screened.get("ask"), dict) else None
            card = None
            actions = []
    except ProviderUnavailable as exc:
        # Nobody could answer. The turn is given back and the child hears Wobo say so, over the
        # same stream a spend refusal arrives on; it used to be a bare 500 and the client's
        # generic broken page.
        budget.refund(meter, name)
        snap = budget.snapshot(meter, plan, anonymous=principal.anonymous)
        return _one_shot_turn(exc.message, owner, budget.headers(snap, budget.classify(name)))
    except TooMuchAtOnce as exc:
        budget.refund(meter, name)
        return JSONResponse(
            status_code=413,
            content={
                "code": "too_much_at_once",
                "message": "That is more than one board. Ask for a piece of it.",
                "objects": exc.count,
            },
            headers=headers,
        )
    except Exception:
        budget.refund(meter, name)
        raise

    if shaper is not None:
        plan = shaper.shape_plan(plan)
    # A mark may hang off something an EARLIER turn drew and the learner is still looking at
    # (``board.planner.Surface.drawn``), so those ids are on the board as far as the wire is
    # concerned — see ``stream._on_the_wire``.
    #
    # ``standing`` is the other half, and it is this turn's own: the mark the CLIENT laid from the
    # glass map before the request left (docs/INK-FOUR.md, the instant mark). It carries its words,
    # so the wire can keep the law about it — nothing stands on the glass unspoken.
    board_now = request.payload.get("board") or {}
    turn = board_stream.new_turn(
        owner,
        board_stream.build_events(
            plan,
            actions=actions,
            card=card,
            # The accent resolved at the door, carried by hand: this frame is a different context
            # from the one that marked it, and buying a whole plan's speech on the wrong accent is
            # audio paid for under a key nobody ever presents.
            accent=spoken_accent,
            on_board=[
                *(str(i) for i in (board_now.get("drawn") or []) if isinstance(i, str)),
                *(m for m in (board_now.get("standing") or []) if isinstance(m, dict)),
            ],
        ),
    )
    return _stream(turn, -1, headers)


def create_app(gateway: Gateway | None = None) -> FastAPI:
    configure_logging()
    validate_env()
    # The interactive docs publish the whole internal API shape — every route, every header,
    # the internal email relay included. Useful in dev, an unauthenticated map in prod.
    public_docs = os.getenv("ENV", "dev").lower() != "prod"
    app = FastAPI(
        title=f"{APP_NAME} model gateway",
        version="0.0.0",
        docs_url="/docs" if public_docs else None,
        redoc_url="/redoc" if public_docs else None,
        openapi_url="/openapi.json" if public_docs else None,
    )
    gw = gateway or build_gateway()
    logger.info(
        "gateway booted",
        extra={
            "fields": {
                "env": os.getenv("ENV", "dev").lower(),
                "llm_mode": os.getenv("LLM_MODE", "mock").lower(),
                "dev_auth": dev_auth_enabled(),
            }
        },
    )
    # A start-up is worth an alert for one reason: ten of them inside five minutes IS the Railway
    # restart policy giving up in slow motion, and until now that happened in total silence. It
    # also proves the sink works — the owner's first page after wiring ALERT_WEBHOOK_URL is his
    # own gateway saying hello, which is how he knows the alarm is not decorative.
    alerts.alert(
        alerts.STARTUP,
        f"{APP_NAME} gateway started",
        severity=alerts.INFO,
        env=os.getenv("ENV", "dev").lower(),
        llm_mode=os.getenv("LLM_MODE", "mock").lower(),
        spend_ceiling_usd=spend.ceiling_usd(),
    )

    # Rate limit on spend-bearing routes, keyed by the VERIFIED SUBJECT. Keying by IP put every
    # learner behind the platform proxy in one bucket — one noisy account throttled the school.
    # ponytail: in-memory fixed window, per process — move to Redis when >1 instance runs.
    limit = int(os.getenv("RATE_LIMIT_PER_MINUTE", "60"))
    # A caller with no verified identity is not a learner using the app; it is a stranger at the
    # door. It gets a much smaller window, so filling the shared bucket costs more and matters
    # less. (Anonymous learners are keyed per address by meter_key, on the full dial.)
    unauth_limit = int(os.getenv("UNAUTH_RATE_LIMIT_PER_MINUTE", "15"))
    # The memory sync's own dial. It is a debounced background write, not a learner asking for
    # anything, so it gets a generous ceiling of its own rather than a share of the one the lesson
    # is spending. Its own bucket is the point: a sync storm can starve syncs and nothing else.
    mind_limit = int(os.getenv("MIND_RATE_LIMIT_PER_MINUTE", "120"))
    hits: dict[tuple[str, int], int] = {}
    hits_lock = threading.Lock()

    def _over_limit(key: str, ceiling: int) -> bool:
        """One fixed-window bucket. The key is the verified subject when we have one, and the
        caller's address when we do not — so an unauthenticated flood is bounded too, and the
        401 check itself cannot be used as an amplifier.

        Read and increment happen under one lock: every route here is ``def``, so FastAPI runs
        them on a threadpool, and a read-then-write pair on a shared dict is a race waiting for
        the first await (or the Redis hop this moves to) to widen it."""
        window = int(time.time() // 60)
        bucket = (key, window)
        with hits_lock:
            if len(hits) > 4096:
                # Prune by EXPIRY, never wholesale. Clearing the map at the size cap handed
                # every caller in the current window a fresh counter, so a flood of distinct
                # keys was itself the way past the limit. Only buckets from a window that has
                # already closed are dropped; live counters survive the prune.
                expired = [b for b in hits if b[1] < window]
                for b in expired:
                    del hits[b]
            hits[bucket] = hits.get(bucket, 0) + 1
            return hits[bucket] > ceiling

    # A refused token is ordinary — an expired session, a stale tab. A LOT of them in one
    # minute is somebody trying keys, and it is one of the six things worth waking a person
    # for (alerts.py). Same fixed-window shape as the limiter above, per process.
    auth_burst = int(os.getenv("ALERT_AUTH_FAILURE_BURST", "25"))
    auth_fails: dict[int, int] = {}
    auth_lock = threading.Lock()

    def _note_auth_failure() -> int:
        """Count one refused token in this minute and return the minute's running total."""
        window = int(time.time() // 60)
        with auth_lock:
            for stale in [w for w in auth_fails if w < window]:
                del auth_fails[stale]
            auth_fails[window] = auth_fails.get(window, 0) + 1
            return auth_fails[window]

    @app.middleware("http")
    async def _guard_and_log(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        started = time.perf_counter()
        path = request.url.path
        ip_hash = _ip_fingerprint(_client_ip(request))
        principal: Principal | None = None
        refused: AuthError | None = None

        # One door for the whole /v1 surface. OPTIONS is the CORS preflight and carries no
        # credentials by definition, so it is answered by the CORS layer above us.
        # A soft-auth path (the internal email relay) is verified when a token rides along and
        # simply left unauthenticated when one does not — its own key is the door, and the
        # subject we learn here is what its recipient-ownership rule checks against.
        soft = path in _SOFT_AUTH_PATHS
        if path.startswith("/v1") and path not in _OPEN_PATHS and request.method != "OPTIONS":
            try:
                principal = authenticate(request.headers)
            except AuthError as exc:
                if not soft:
                    refused = exc
        request.state.principal = principal
        # Convenience mirror for routes that only need the id (the email seam reads this).
        request.state.subject = principal.subject if principal else None
        # The identity the meter and the limiter count against — one derivation, read by the
        # capability route and by both voice routes so nothing meters on a different key.
        request.state.meter_key = meter_key(principal, request)
        # WHERE THIS LEARNER IS, for the money meter's day (allowance.py, docs/ALLOWANCE.md §4.6).
        # The device sends a zone NAME and the first one of the local day stands; the boundary
        # itself is computed server-side from it, because a client that can declare its own day
        # can declare an infinite allowance. A family record's zone, when there is one, wins over
        # this (``allowance.set_zone_resolver``). Nonsense is dropped rather than believed.
        allowance.note_zone(
            request.state.meter_key, request.headers.get(allowance.ZONE_HEADER)
        )
        # Ownership of a remembered board turn is the meter key AND the subject, so two
        # anonymous children on one address are two learners (board_key).
        request.state.board_key = board_key(principal, request)

        limited = (
            path.startswith("/v1/capability/")
            # Free routes, still bounded: the interrupt frame and the erase are unmetered (a
            # learner may never be charged for stopping Wobo or for taking their memory back),
            # and unmetered without a limiter is an open tap on the board store and the database.
            or path.startswith("/v1/board/")
            or path == "/v1/me/erase"
            # The doubt solver (doubt.py): two vision calls and a board turn behind one door,
            # and a photo body on every knock. Metered inside; bounded per caller here.
            or path.startswith(_DOUBT_PATH)
            or path == "/v1/voice/session"
            or path == "/v1/voice/tts"
            # The mail dials write to the database, and the stop link is unauthenticated by
            # design — both are bounded per caller (the stop link on the stranger's dial).
            or path == "/v1/me/mail-preferences"
            or path == "/v1/mail/stop"
            # The public Ask Wobo box: open, and bounded per address on the stranger's dial before
            # its own per-browser allowance (ask_public.py) is even consulted.
            or path in ASK_LIMITED_PATHS
            # The open syllabus read: a whole curriculum behind one GET is exactly the door a
            # crawler would hammer, so it is bounded per address like every other open path.
            or path in SYLLABUS_LIMITED_PATHS
            # The parent link: an invite sends mail, the parent's pages are unauthenticated.
            or path in PARENT_LIMITED_PATHS
            # The parent account surface (parent_api.py). Every route writes to the parent plane
            # or calls a model, and the door itself must not be free to knock on: a student
            # account probing for a switcher is bounded here before it is refused there.
            or path in PARENT_API_LIMITED_PATHS
            or path.startswith("/v1/parent/mind/")
            or path.startswith("/v1/parent/offers/")
            or path.startswith("/v1/me/parent-offered")
            # The plan: two of the three write to the database, and all three are free — a
            # learner is never charged a turn for reading or ending what they pay for.
            or path in BILLING_LIMITED_PATHS
            # The checkout creates an object at the payment provider on every call, and anyone
            # holding a token can reach it (billing/payments.py). The webhook is deliberately not
            # here: the provider retries on a non-2xx, and its signature is the gate.
            or path in PAYMENTS_LIMITED_PATHS
            # The four intakes behind the console's desks — a flag, a bug, a support message, a
            # refund request. Each writes a row to ops.reports and every one of them is reachable
            # by anyone holding a token, so all four are bounded per caller (reports.py).
            or path in REPORT_LIMITED_PATHS
            # Redeeming a promo code (promo.py): a database write, reachable by anyone holding a
            # token, and the one route in the product where guessing at a string pays. Bounded
            # per caller, so a script cannot work through an alphabet at speed.
            or path in PROMO_LIMITED_PATHS
            # The operator console. Behind its own door (admin_auth.guard) and its own stricter
            # bucket, and in the shared limiter too: the door itself must not be free to knock on.
            or path.startswith(ADMIN_PREFIX)
            # The door's own two open paths: the dial the site polls, and the list it opens onto
            # (doors.py, waiting_list.py). Open, and bounded per address on the stranger's dial
            # before the list's own per-browser allowance is even consulted.
            or path in DOORS_LIMITED_PATHS
            or path in WAITING_LIST_LIMITED_PATHS
            or path in _SOFT_AUTH_PATHS
        )
        # Wobo's memory of the learner, on its OWN bucket. Free — a learner is never charged for
        # reading or steering what is remembered about them — and it writes to the database, so it
        # is bounded; but it is a debounced background sync, and sharing the one 60/minute bucket
        # with /v1/capability meant an eager sync spending the allowance the lesson needs. Its own
        # counter, its own ceiling, and a flood of syncs can only ever starve syncs.
        syncing = path.startswith("/v1/me/mind")
        # Declared when the client declares it, counted off the wire when it does not. This is
        # awaited BEFORE the limiter so a body that is refused is never also a model call.
        oversized = await _over_the_ceiling(request)
        key = request.state.meter_key

        def _over_the_dial() -> bool:
            """Which dial this call is counted against, and whether it has run out.

            A function rather than a value because counting is the side effect: a request that is
            refused for being too big must not also spend somebody's allowance.
            """
            if syncing:
                return _over_limit(f"mind:{key}", mind_limit)
            return limited and _over_limit(key, limit if (principal or soft) else unauth_limit)

        if oversized:
            response: Response = JSONResponse(
                status_code=413,
                content={
                    "code": "too_much_at_once",
                    "message": "That is more than I can take in one go. Send me a smaller piece.",
                },
            )
        # A soft-auth path carries its own shared key, so it gets the full ceiling even with
        # no learner behind it — the small one is for strangers at the front door.
        elif _over_the_dial():
            response = JSONResponse(
                status_code=429,
                content={
                    "code": "rate_limited",
                    "message": "That was a lot at once. Give me a moment and try again.",
                },
                headers={"Retry-After": str(60 - int(time.time()) % 60)},
            )
        elif refused is not None:
            failures = _note_auth_failure()
            # Once per window, at the threshold — not on every refusal past it, which would be
            # the alarm joining in the flood.
            if auth_burst > 0 and failures == auth_burst:
                alerts.alert(
                    alerts.AUTH_FAILURE_BURST,
                    f"{failures} refused tokens in one minute",
                    severity=alerts.WARN,
                    failures=failures,
                    path=path,
                    ip_hash=ip_hash,
                )
            response = JSONResponse(status_code=refused.status, content=refused.body())
        # The door (docs/DOORS-CLOSED.md). While ``doors_open`` is false no path creates an
        # account: the named account doors are refused by path, an anonymous principal is refused
        # outright, and a verified subject the product has never seen is refused on its first
        # call. Everything else is untouched, which is the half that matters: an existing account
        # signs in and works exactly as before. Placed AFTER the token check so an unverified
        # caller is still told to sign in rather than told the door is shut, and BEFORE the route
        # so no account-shaped side effect can happen on the way to the refusal.
        elif (closed := doors.refusal_for(path, principal)) is not None:
            response = doors.refuse(closed, path=path, ip_hash=ip_hash)
        else:
            try:
                response = await call_next(request)
            except Exception as exc:
                # Nothing caught this, so the learner is about to get a blank 500. Somebody is
                # told. The exception TYPE only: an exception's text can carry a child's words.
                alerts.alert(
                    alerts.SERVER_ERROR,
                    f"{request.method} {path} raised {type(exc).__name__}",
                    severity=alerts.CRITICAL,
                    method=request.method,
                    path=path,
                    error=type(exc).__name__,
                    ip_hash=ip_hash,
                )
                raise

        if response.status_code >= 500:
            alerts.alert(
                alerts.SERVER_ERROR,
                f"{request.method} {path} answered {response.status_code}",
                severity=alerts.CRITICAL,
                method=request.method,
                path=path,
                status=response.status_code,
                ip_hash=ip_hash,
            )

        if path != "/healthz":  # health probes would drown the log
            logger.info(
                "request",
                extra={
                    "fields": {
                        "method": request.method,
                        "path": path,
                        "status": response.status_code,
                        "ip_hash": ip_hash,
                        "subject": principal.subject if principal else None,
                        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                    }
                },
            )
        return _secured(response, request)

    # CORS is added LAST so it wraps the guard: a 401 still carries the allow-origin header,
    # which is the difference between the browser showing Wobo's "sign in" line and showing
    # an opaque network error.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        # Preview origins are a DEV convenience. In prod the trust boundary is exactly the one
        # origin _cors_origins() returns: a pattern that matches any ephemeral deploy host is a
        # standing invitation for anyone who can land a build on that pattern.
        allow_origin_regex=_preview_origin_regex(),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ConsentDenied)
    async def _on_consent_denied(_: Request, exc: ConsentDenied) -> JSONResponse:
        return JSONResponse(
            status_code=403,
            content={
                "code": "not_allowed",
                "message": "That one needs a grown-up to say yes first.",
                "capability": exc.capability,
            },
        )

    @app.exception_handler(budget.BudgetExhausted)
    async def _on_budget_exhausted(_: Request, exc: budget.BudgetExhausted) -> JSONResponse:
        return JSONResponse(
            status_code=429,
            content=exc.body(),
            headers={
                "X-Wobo-Budget-Remaining": "0",
                "X-Wobo-Budget-Reset": exc.reset_at.isoformat(),
            },
        )

    @app.exception_handler(spend.SpendCeilingReached)
    async def _on_spend_ceiling(_: Request, exc: spend.SpendCeilingReached) -> JSONResponse:
        """The platform's day is spent. A quota answer (429), never a 5xx.

        It is not a fault: the gateway is working exactly as designed, and calling it a server
        error would page the owner for their own ceiling doing its job. The learner gets Wobo's
        own honest line and the hour the day turns over, the same shape the free-tier meter
        already answers with.
        """
        return JSONResponse(
            status_code=429,
            content=exc.body(),
            headers={"Retry-After": "3600", "X-Wobo-Budget-Reset": exc.reset_at.isoformat()},
        )

    @app.exception_handler(ProviderUnavailable)
    async def _on_providers_out(_: Request, exc: ProviderUnavailable) -> JSONResponse:
        """No provider answered, on a route that did not catch it itself (the capability route
        and the board stream do, so they can give the meter back). Wobo's line, a 503, and a
        Retry-After: an outage upstream is not a fault in this service and is not answered as
        one. The cause is already in the log and the alert from ``Gateway.invoke``."""
        return JSONResponse(
            status_code=503, content=exc.body(), headers={"Retry-After": "60"}
        )

    @app.get("/healthz")
    def healthz(response: Response) -> dict[str, Any]:
        """Health, not liveness (:mod:`wobo_gateway.health`).

        Open, unauthenticated and polled, so it stays cheap — every check is a dictionary or an
        environment read, and nothing here opens a socket. ``503`` only when a request arriving
        now would not be served; a degraded gateway answers ``200`` and says so in the body,
        because a degraded gateway Railway keeps restarting is worse than a degraded gateway.

        ``public=True`` is the important argument: this endpoint is in ``_OPEN_PATHS``, so its
        body is world-readable, and the spend check's figures — today's model spend, the ceiling,
        how close the two are — are the console's own guarded numbers. They are kept for the
        operator console's health read, where a look costs a session and leaves an audit row.
        (This docstring is itself published in the spec, so it names no guarded path.)
        """
        snap = health.snapshot(public=True)
        response.status_code = health.status_code(snap)
        return snap

    @app.get("/v1/me")
    def me(request: Request) -> MeResponse:
        """Who the brain thinks you are, and what is left today. The client renders this and
        never computes it — the limit lives here and nowhere else."""
        principal: Principal = request.state.principal
        profile = consent.get_profile(principal.subject, anonymous=principal.anonymous)
        # The meter key, not the subject: an anonymous learner is counted per device address, so
        # showing them a per-subject number would show a full tank they do not have.
        plan = billing.metered_plan(principal, profile)
        snap = budget.snapshot(
            request.state.meter_key, plan, anonymous=principal.anonymous
        )
        # The day's allowance, as a fraction and a time (allowance.py). The limit a learner
        # actually meets is this one; the counters above are the abuse caps behind it.
        meter = allowance.state(
            request.state.meter_key,
            budget.resolve_plan(plan, anonymous=principal.anonymous),
        )
        return MeResponse(
            subject=principal.subject,
            anonymous=principal.anonymous,
            plan=plan,
            consent_tier=profile.tier.value,
            budget=snap.as_dict(),
            allowance=meter.as_dict(),
        )

    @app.post("/v1/me/erase")
    def erase_me(request: Request) -> Response:
        """Forget me. The brain's half of the memory page — erasure that actually propagates.

        Free and unmetered on purpose: a data right that costs a learner their last turn of the
        day is not a right. Authenticated like every other ``/v1`` route, and keyed on the door's
        subject, so this is only ever a learner erasing themselves.

        The body is what left, not what was attempted: a store that refused is named and the
        status is 502, because Wobo never claims to have forgotten something Wobo did not.
        """
        from wobo_gateway import memory

        principal: Principal = request.state.principal
        erased = memory.erase(principal.subject, board_key=request.state.board_key)
        if erased.failed:
            return JSONResponse(
                status_code=502,
                content={
                    "code": "erase_incomplete",
                    "message": (
                        "I cleared what I could reach, but not all of it. "
                        "Try that again in a moment."
                    ),
                    **erased.as_dict(),
                },
            )
        return JSONResponse(status_code=200, content=erased.as_dict())

    @app.post("/v1/board/interrupt")
    def interrupt_board(body: InterruptRequest, request: Request) -> Response:
        """The learner stopped Wobo mid-turn (BOARD.md §4).

        The client already lifts its own pen and stops its own voice; this is the frame it sends
        the brain. The turn stops streaming at the next frame and the reply is the acknowledgement:
        the turn, and the object Wobo was on when the pen came up. Unmetered — stopping is never
        charged — and owned by the meter key, so an interrupt is not a way into another learner's
        turn: an id that is not theirs is simply not found.
        """
        from wobo_gateway.board import stream as board_stream

        turn = board_stream.interrupt(body.turn, request.state.board_key, body.at)
        if turn is None:
            return JSONResponse(
                status_code=404,
                content={
                    "code": "turn_not_found",
                    "message": "That one is already finished.",
                },
            )
        return JSONResponse(
            status_code=200,
            content={
                "turn": turn.id,
                "interrupted": True,
                **({"at": turn.interrupted_at} if turn.interrupted_at else {}),
            },
        )

    @app.get("/v1/capabilities")
    def list_capabilities() -> list[PolicyView]:
        return [_policy_view(policy(name)) for name in capabilities()]

    @app.post("/v1/capability/{name}")
    def invoke(name: str, request: CapabilityRequest, http: Request) -> Response:
        principal: Principal = http.state.principal
        # Accept the pre-rebrand capability name from already-deployed clients.
        name = canonical_capability(name)
        if name not in set(capabilities()):
            raise HTTPException(status_code=404, detail=f"unknown capability: {name}")
        # The doubt solver's two vision capabilities exist at this door for the registry, the
        # meter and the ledger, and NOT as a text prompt anybody can post here: a photo comes in
        # through /v1/doubt, screened and bounded, or it does not come in (doubt.py).
        if name.startswith("doubt."):
            return JSONResponse(
                status_code=404,
                content={
                    "code": "use_doubt_route",
                    "message": "Send me the photo at /v1/doubt and I will read it there.",
                },
            )
        # The creative tier is the PLATFORM's (registry.PLATFORM_PAID): the concept core, the
        # architect's blueprint. Each runs once per concept or per cell, on the most expensive
        # model the product owns, out of the creative pool, and every learner of that cell is then
        # served the cached result for nothing. Being in the registry is how a capability EXISTS
        # here — it is what /v1/capabilities lists, what the consent gate reads, what the meter
        # classifies — and it is NOT permission to be invoked off a body a caller wrote. Without
        # this line any valid learner token could start an Astra call against the creative pool,
        # as many times as it liked, and the spend would never appear on that learner's allowance
        # because it is by design not theirs. Reached by the job that owns it, or not reached.
        if platform_paid(name):
            return JSONResponse(
                status_code=404,
                content={
                    "code": "not_a_learner_capability",
                    "message": "That is not something you can ask for here.",
                },
            )

        # Derived, never declared: the tier comes from the learner's stored record, and the plan
        # from their subscription — which ends by itself when the period paid for does.
        profile = consent.get_profile(principal.subject, anonymous=principal.anonymous)
        plan = billing.metered_plan(principal, profile)
        # Which lane the platform's daily money ceiling sheds this caller in (spend.py). Derived
        # from the verified door and the subscription the billing store knows about, exactly like
        # the meter — a body can no more buy itself a priority than it can buy a consent tier.
        priority = spend.priority_for(
            anonymous=principal.anonymous, signed_in=bool(principal.subject), plan=plan
        )

        # Sign-up completion (WOBO-PLAN §14.1, "confirm everything"): the learner's first meeting
        # with Wobo is the moment the account became real. The welcome goes out on a background
        # thread from here — before the turn is served, independent of how it is served — to
        # the address the verified token carries. It never blocks and never raises.
        if name == "wobo.turn" and is_first_meeting(request.payload):
            welcome_after_first_meeting(principal, request.payload)

        # THE RECORD REACHES THE PROMPT (docs/MEMORY-LAW.md). The dossier used to be built from
        # whatever the browser put in `context.lifetime`, so the account's own row reached no
        # prompt at all and a crafted payload could claim a parent had said something. Here, once,
        # before either the streaming or the plain path: the remembered facts and interests come
        # from the learner's row, and the parent-offered facts from the offers store.
        if name == "wobo.turn":
            from wobo_gateway import mind as mind_module

            mind_module.ground_lifetime(
                request.payload, subject=principal.subject, anonymous=principal.anonymous
            )
            # One turn on a topic is what makes this account a learner of that syllabus, and
            # only a learner's edits count toward correcting it (docs/CURRICULUM-OBSERVER.md §6).
            # Off the request thread, anonymous never, and it never raises.
            from wobo_gateway.curriculum import observer as syllabus_observer

            syllabus_observer.note_turn(
                principal.subject, request.payload, anonymous=principal.anonymous
            )

        # The board (BOARD.md §4). Same route, same door, same meter — only the body differs.
        if name == "wobo.turn" and wants_event_stream(http):
            return stream_board_turn(gw, name, request, http, profile, plan)
        # A generation is the expensive half, and an anonymous subject is free to mint. Building
        # a whole lesson asks for an account first; talking to Wobo does not.
        if name.startswith("engine.") and principal.anonymous:
            return JSONResponse(
                status_code=403,
                content={
                    "code": "sign_in_required",
                    "message": "Sign in first.",
                },
            )
        meter = http.state.meter_key
        # Name the caller for the usage ledger (ledger.py), from the same verified facts the lane
        # above came from — never from the body. Every ledger row written while serving this
        # request carries the plan and the anonymity, so "how fast is a free allowance actually
        # consumed" is answerable, and the learner appears only as a salted digest of the meter
        # key. Set here rather than passed down: the model call happens six frames away, inside a
        # provider, and threading an argument through would touch files other waves are editing.
        ledger.mark(plan=plan, anonymous=principal.anonymous, meter_key=meter)
        # AND THE ACCENT THIS LEARNER'S LINES ARE READ IN, for the same reason and from the same
        # verified record. A turn's words are decided here, seconds before one syllable of them is
        # asked for, and that is when the whole plan's speech is bought
        # (``voice.remember_parts``) — which can only be done on the accent the client's own call
        # will present, or the audio is paid for under a key nobody ever asks for.
        from wobo_gateway import voice as _voice

        _voice.mark_accent(
            _voice.learner_accent(principal.claims, http.headers.get("accept-language"))
        )

        # Counted ONCE, after the door and before the model. Anything that fails before the
        # provider is reached (a closed consent door, a busy queue, a provider error) is
        # refunded — a learner never pays for a call we did not serve.
        snap = budget.charge(meter, name, plan, anonymous=principal.anonymous)
        headers = budget.headers(snap, budget.classify(name))

        # THE GENERIC-TURN DOOR (docs/CACHES.md §2). A turn whose context packet carries nothing
        # personal is one question asked by many learners in the same words, and the answer to it
        # was written once. Read AFTER grounding, deliberately: `mind.ground_lifetime` above fills
        # the dossier from the learner's own row, so this is the packet as the MODEL would have
        # seen it, and a turn that grounding made personal is answered live.
        #
        # AFTER the meter and before the model: a cached turn still counts against the day's turns
        # (it is a turn the learner took), and costs the platform nothing. `content.turns` is where
        # the answer came from and `served()` strips that before it leaves the brain, exactly as it
        # strips a model id.
        #
        # THE PLAIN TURN ONLY. The streaming board turn returned above, before the meter, and it is
        # deliberately left alone this wave: its whole value is the first stroke arriving ahead of
        # the first full stop (board/stream.py), and serving a stored plan through that machinery is
        # a second design and wants its own proof. The ROW a plain turn writes already carries a
        # plan, so the store is ready for it.
        if name == "wobo.turn":
            from wobo_gateway import generic_turn

            # A CACHE MUST NEVER FAIL A TURN. Reading the store is an optimisation and a learner's
            # answer is not: anything that goes wrong in there — a malformed packet the surface
            # re-anchoring chokes on, a row that is not the shape it should be — is a miss and a
            # live turn, never a 500. The write below carries the same suppression for the same
            # reason.
            cached_turn = None
            with contextlib.suppress(Exception):
                cached_turn = generic_turn.load(request.payload)
            if cached_turn is not None:
                return JSONResponse(
                    status_code=200,
                    content=CapabilityResponse(
                        capability=name,
                        track=policy(name).track.value,
                        model="content.turns",
                        cache_hit=True,
                        latency_ms=0.0,
                        tokens=0,
                        output=cached_turn,
                    ).served(),
                    headers=headers,
                )

        # The curriculum registry (CURRICULUM.md §8). It rides this route rather than a router of
        # its own so it inherits the one door, the one limiter and the one meter — but it never
        # reaches Gateway.invoke, because these are registry reads and writes: they answer from
        # the store and, when a syllabus is missing, enqueue the discovery job that does. The one
        # exception is `curriculum.own.read`, which puts the learner's own document through the
        # generate tier; it owns its own call, which is why the model line below names what ran.
        if name.startswith("curriculum."):
            from wobo_gateway.curriculum import api as curriculum_api

            def _charge_curriculum(capability: str) -> budget.Snapshot:
                """The learner's own meter, and the platform's money ceiling, in one seam.

                The curriculum never reaches ``Gateway.invoke``, so the spend gate that lives
                there does not cover it — and one of these capabilities mints a discovery job
                that is a search, an extraction on the generate tier and a re-reading on the
                verify tier. Gating the CHARGE rather than the route covers both the call that
                came in and the job it can mint, which is the same reason this seam exists at
                all. A store read costs nothing and is never refused.
                """
                if (
                    budget.classify(capability) == budget.GENERATION
                    and spend.verdict(priority) is spend.Verdict.REFUSE
                ):
                    raise spend.SpendCeilingReached(priority, capability=capability)
                return budget.charge(meter, capability, plan, anonymous=principal.anonymous)

            try:
                # …and the capability that came in the door, which the route charged above.
                # The refund rides the `except Exception` below, so a refusal costs the
                # learner nothing.
                if (
                    budget.classify(name) == budget.GENERATION
                    and spend.verdict(priority) is spend.Verdict.REFUSE
                ):
                    raise spend.SpendCeilingReached(priority, capability=name)
                output = curriculum_api.handle(
                    name,
                    request.payload,
                    subject=principal.subject,
                    anonymous=principal.anonymous,
                    # A registry read is a turn; the discovery job one of them can mint is a
                    # search, an extraction on the generate tier and a re-reading on the verify
                    # tier. Without this seam the expensive half of the curriculum was free,
                    # and a cheap `curriculum.units` call could mint it (CURRICULUM.md §4.4).
                    charge=_charge_curriculum,
                )
            except curriculum_api.CurriculumError as exc:
                budget.refund(meter, name)
                return JSONResponse(
                    status_code=exc.status, content=exc.body(), headers=headers
                )
            except Exception:
                budget.refund(meter, name)
                raise
            return JSONResponse(
                status_code=200,
                content=CapabilityResponse(
                    capability=name,
                    track=policy(name).track.value,
                    # Honest inside the brain, and stripped by `served()` before it leaves:
                    # the store answered, unless the learner's own document went to a tier.
                    model=(
                        f"curriculum.own:{policy(name).tier.value}"
                        if name == "curriculum.own.read"
                        else "curriculum.store"
                    ),
                    cache_hit=False,
                    latency_ms=0.0,
                    tokens=0,
                    output=output,
                ).served(),
                headers=headers,
            )

        try:
            if name.startswith("engine."):
                # lazy: engine path only
                from wobo_gateway.plexus import (
                    ConceptRejected,
                    GenerationBusy,
                    GenerationUnattributed,
                )

                try:
                    result = gw.invoke(
                        name,
                        request,
                        profile.tier,
                        subject=principal.subject,
                        priority=priority,
                        plan=plan,
                    )
                except ConceptRejected as exc:
                    # The caller asked for something we will not generate. That is a bad request,
                    # not a broken brain — it must never surface as a 500.
                    budget.refund(meter, name)
                    return JSONResponse(
                        status_code=400,
                        content={"code": "topic_rejected", "message": exc.message},
                        headers=headers,
                    )
                except GenerationUnattributed:
                    # The slot key comes from the door, so this can only be a coding mistake —
                    # but an unattributed generation is refused, never run for free.
                    budget.refund(meter, name)
                    return JSONResponse(
                        status_code=401,
                        content={
                            "code": "sign_in_required",
                            "message": "Sign in and we can pick up right where you left off.",
                        },
                        headers=headers,
                    )
                except GenerationBusy as exc:
                    budget.refund(meter, name)
                    return JSONResponse(
                        status_code=429,
                        content={
                            "code": "generation_in_flight",
                            "message": "one lesson at a time — yours is still cooking, hang tight",
                        },
                        headers={"Retry-After": str(exc.retry_after), **headers},
                    )
            else:
                result = gw.invoke(
                    name,
                    request,
                    profile.tier,
                    subject=principal.subject,
                    priority=priority,
                    plan=plan,
                )
        except ProviderUnavailable as exc:
            # Nobody could answer: the turn is given back, and the answer is Wobo's line in the
            # same ``{code, message}`` shape as the spend ceiling's refusal, which the client
            # already renders as Wobo's words. Until 2026-09-07 this was FastAPI's bare 500.
            budget.refund(meter, name)
            snap = budget.snapshot(meter, plan, anonymous=principal.anonymous)
            return JSONResponse(
                status_code=503,
                content=exc.body(),
                headers={"Retry-After": "60", **budget.headers(snap, budget.classify(name))},
            )
        except Exception:
            budget.refund(meter, name)
            raise

        # A safety gate is not an exception, so the refund above never fired for it: ``invoke``
        # returns an ordinary CapabilityResponse whose model is ``safety.gate``. The result was
        # that a child who disclosed harm was charged one of their daily turns for the
        # disclosure, on a route whose published description said "nothing is charged, nothing is
        # counted". No model was reached, so nothing is owed.
        # Nor is a PLACEHOLDER. When live generation fails, the engines fall back to a
        # topic-agnostic seed (``provenance.model == "seed"``) so the learner sees something
        # rather than an error — an honest floor, but not the lesson they asked for and not
        # one of their generations. They were being charged for it: three phys/chem cells and
        # two social-science courses in the wave-30 lab are seeds, billed and served.
        if result.model in ("safety.gate", "seed"):
            budget.refund(meter, name)
            snap = budget.snapshot(meter, plan, anonymous=principal.anonymous)
            headers = budget.headers(snap, budget.classify(name))

        # THE OTHER HALF OF THE GENERIC-TURN DOOR: what was just answered live, written once for
        # everybody who asks it in the same words at the same level. The safety gate's answer and
        # the seed placeholder are excluded by the same test that refunds them — neither is an
        # answer to the question, and caching either would serve it forever.
        if name == "wobo.turn" and result.model not in ("safety.gate", "seed"):
            from wobo_gateway import generic_turn

            with contextlib.suppress(Exception):
                generic_turn.save(
                    request.payload,
                    result.output,
                    model=result.model,
                    # What this request actually paid a provider, from the one funnel every live
                    # model call passes through. None when nothing here could be priced, which the
                    # stores desk shows as an unpriced row rather than as a free one.
                    cost_usd=ledger.take_spend(),
                )

        return JSONResponse(
            status_code=200,
            content=result.served(),
            headers=headers,
        )

    register_voice(app)
    register_email(app)
    register_mind(app)
    register_mail_preferences(app)
    register_parent_links(app)
    # AFTER register_parent_links: the parent's unauthenticated accept and decline pages are
    # literal paths under /v1/parent, and they must be matched before anything else claims them.
    register_parent_api(app)
    register_billing(app)
    # Checkout and the provider's webhook (billing/payments.py). AFTER register_billing so the
    # plan routes this pair writes for already exist.
    register_payments(app)
    register_admin(app)
    # The console's own read surface. AFTER register_admin, because it hangs off the same
    # guarded router factory and the door must exist before anything is mounted behind it.
    register_console(app)
    # The console's four queues, and the four intakes that fill them (reports.py). AFTER
    # register_admin for the same reason register_console is: the desks hang off the same
    # guarded router factory, and the door must exist before anything is mounted behind it.
    register_desks(app)
    # The models desk and the pace: what answers what, at what price, and how generous the day
    # is (docs/CONSOLE-MODELS.md, docs/ALLOWANCE.md §3). Mounted after the desks so every route
    # under /v1/admin is behind the one guard.
    register_models_desk(app)
    # The subscriptions desk's ledger read (billing/payments.py), behind the same guarded router
    # factory as the other desks and for the same reason placed after register_admin.
    register_billing_desk(app)
    # The board a learner may change once, and the queue an operator clears when they ask for
    # another (docs/CONSOLE-ROLES-AND-BOARD.md §1). Two learner routes and two console ones;
    # AFTER register_admin for the same reason every other desk is.
    register_board_change(app)
    # Promo codes: the learner's redeem door and the owner's desk (promo.py). AFTER
    # register_admin, because the desk hangs off the same guarded router factory and the door has
    # to exist before anything is mounted behind it; and beside register_payments, because the
    # percentage a code takes off a first payment is applied inside that file's checkout.
    register_promo(app)
    register_promo_desk(app)
    register_reports(app)
    # The door and the list it opens onto (doors.py, waiting_list.py). The refusal itself lives
    # in the middleware above; these two are only what a visitor can still reach: the dial, so
    # the site's copy follows the switch, and the box that takes an address.
    register_doors(app)
    register_waiting_list(app)
    register_public_ask(app, gw)
    # The open syllabus read (curriculum/public.py). Registered beside the public ask because
    # they are the two doors a visitor with no account may knock on, and the chapter pages need
    # both: the tree to render, and the ask box at the bottom of it to answer.
    register_public_syllabus(app)
    # Wobo's eyes (doubt.py): the photo door, its answer over the existing board turn, and the
    # memory page's list and delete. Behind the one door and the one limiter like everything else.
    register_doubt(app, gw)

    # The console's two structural rules, checked once against the BUILT app rather than trusted:
    # every /v1/admin route is behind the guard (only the login is not, and it is named), and none
    # of them appears in /openapi.json. Both are properties of where a route was mounted, and both
    # are one careless decorator away from being untrue — so this refuses to boot instead of
    # serving a console somebody can map or reach. It is deliberately the LAST thing create_app
    # does: nothing may be mounted after the check that reads what was mounted.
    assert_admin_surface(app)

    # The discovery worker (CURRICULUM.md §4, docs/OPERATIONS.md §10). Starts nothing unless
    # WOBO_DISCOVERY_WORKER is on; a thread is not a route, so it sits after the surface check.
    from wobo_gateway.curriculum.discovery.worker import start_if_enabled

    start_if_enabled()

    return app


app = create_app()
