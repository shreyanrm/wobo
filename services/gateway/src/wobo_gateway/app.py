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
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from wobo_gateway import billing, budget, consent
from wobo_gateway.ask_public import LIMITED_PATHS as ASK_LIMITED_PATHS
from wobo_gateway.ask_public import OPEN_PATHS as ASK_OPEN_PATHS
from wobo_gateway.ask_public import register_public_ask
from wobo_gateway.auth import (
    AuthError,
    Principal,
    authenticate,
    dev_auth_enabled,
    dev_auth_requested,
    jwks_url,
)
from wobo_gateway.billing import LIMITED_PATHS as BILLING_LIMITED_PATHS
from wobo_gateway.billing import register_billing
from wobo_gateway.cache import CacheBackend, CacheEntry, InMemoryCache, cache_key
from wobo_gateway.email import register_email
from wobo_gateway.hospitality.api import register_mail_preferences
from wobo_gateway.hospitality.jobs import welcome_after_first_meeting
from wobo_gateway.parents import LIMITED_PATHS as PARENT_LIMITED_PATHS
from wobo_gateway.parents import OPEN_PATHS as PARENT_OPEN_PATHS
from wobo_gateway.parents import register_parent_links
from wobo_gateway.providers import Provider, build_provider
from wobo_gateway.registry import (
    ConsentTier,
    RoutingPolicy,
    canonical_capability,
    capabilities,
    policy,
)
from wobo_gateway.routing import resolve, resolve_any
from wobo_gateway.safety import (
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
    ) -> CapabilityResponse:
        # subject is the VERIFIED subject from the door (never payload-supplied), and
        # consent_tier is the SERVER-DERIVED tier (consent.get_tier of the verified subject),
        # passed in as its own argument. It defaults to least privilege so a caller that forgets
        # it gets the un-elevated door, never the elevated one. request.consent_tier is ignored.
        pol = policy(capability)
        if not pol.allows(consent_tier):
            raise ConsentDenied(capability, consent_tier)

        spec = resolve(pol.primary, pol.track)

        # safety.moderate runs the deterministic child-safety classifier in every mode — the
        # keyword screen today, the trained slm.safety model through the same seam tomorrow.
        if capability == "safety.moderate":
            output = moderate(str(request.payload.get("text") or ""), self.classifier)
            emit(
                self.sink,
                TelemetryEvent(capability, spec.track.value, "safety.keyword", 0.0, 0, False),
            )
            return CapabilityResponse(
                capability=capability,
                track=spec.track.value,
                model="safety.keyword",
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
                logger.warning(
                    "turn gated by safety",
                    extra={
                        "fields": {
                            "capability": capability,
                            "category": gated["safety"]["category"],
                        }
                    },
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
            return CapabilityResponse(
                capability=capability,
                track=spec.track.value,
                model=cached.model,
                cache_hit=True,
                latency_ms=0.0,
                tokens=0,
                output=cached.output,
            )

        fallbacks = tuple(resolve_any(name).provider_model for name in pol.fallback)
        start = time.perf_counter()
        result = self.provider.complete(
            provider_model=spec.provider_model,
            capability=capability,
            payload=request.payload,
            fallbacks=fallbacks,
            # The VERIFIED subject, as its own argument. The engine's one-generation-at-a-time
            # slot keys on this; it used to key on payload["user"], which the caller writes.
            subject=subject,
        )
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
_OPEN_PATHS = frozenset({"/healthz", "/v1/mail/stop", *ASK_OPEN_PATHS, *PARENT_OPEN_PATHS})
# Authenticated when we can, never refused here: the route itself is the door (internal key).
# The two cron doors (hospitality/jobs.py: the Sunday note, the festival wishes) share that key
# and that posture.
_SOFT_AUTH_PATHS = frozenset(
    {"/v1/email/send", "/v1/internal/mail/sunday", "/v1/internal/mail/wishes"}
)

# A request body is a context packet, not a file. Past this it is either a mistake or an attempt
# to buy a frontier context window out of one metered turn (the prompt builder caps its own
# output too — this stops the bytes at the door, before anything parses them).
_MAX_BODY_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(256 * 1024)))


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


def _too_large(request: Request) -> bool:
    """Is the declared body bigger than we will ever read? Cheap, before anything parses it."""
    declared = request.headers.get("content-length")
    if not declared:
        return False
    try:
        return int(declared) > _MAX_BODY_BYTES
    except ValueError:
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


class MeResponse(BaseModel):
    """What the client is allowed to know about itself: who, what tier, how much is left.

    No model, no provider, no price, no limit — only what remains today."""

    subject: str
    anonymous: bool
    plan: str
    consent_tier: str
    budget: dict[str, Any]


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


def _stream(turn: Any, after: int, headers: dict[str, str]) -> StreamingResponse:
    from wobo_gateway.board import stream as board_stream

    return StreamingResponse(
        board_stream.iter_sse(turn, after=after),
        media_type="text/event-stream",
        headers={**_SSE_HEADERS, **headers},
    )


def _one_shot_turn(say: str, meter: str, headers: dict[str, str]) -> StreamingResponse:
    """A turn with nothing to draw — Wobo's line and a close, in the same envelope."""
    from wobo_gateway.board import stream as board_stream
    from wobo_gateway.board.planner import Plan

    plan = Plan(say=say, presentation="screen")
    turn = board_stream.new_turn(meter, board_stream.build_events(plan))
    return _stream(turn, -1, headers)


def stream_board_turn(
    gw: Gateway,
    name: str,
    request: CapabilityRequest,
    http: Request,
    profile: Any,
    plan: str,
) -> Response:
    """One streamed turn: say, ink, action, ask, card, done.

    Resume first (a reconnect costs nothing — the learner already paid for this turn), then the
    inbound safety screen, then the meter, then the plan.
    """
    from wobo_gateway.board import stream as board_stream
    from wobo_gateway.board.planner import Plan, TooMuchAtOnce, plan_board

    principal: Principal = http.state.principal
    meter = http.state.meter_key

    resume = board_stream.parse_last_event_id(http.headers.get("last-event-id"))
    if resume is not None:
        turn = board_stream.recall(resume[0], meter)
        if turn is not None:
            snap = budget.snapshot(meter, plan, anonymous=principal.anonymous)
            return _stream(turn, resume[1], budget.headers(snap, budget.classify(name)))

    snap = budget.charge(meter, name, plan, anonymous=principal.anonymous)
    headers = budget.headers(snap, budget.classify(name))

    # Inbound safety runs before anything reaches a model, exactly as it does inside Gateway.invoke.
    gated = screen_wobo_inbound(request.payload, gw.classifier)
    if gated is not None:
        logger.warning(
            "board turn gated by safety",
            extra={"fields": {"category": gated["safety"]["category"]}},
        )
        return _one_shot_turn(str(gated.get("say") or ""), meter, headers)

    live = os.getenv("LLM_MODE", "mock").lower() == "live"
    try:
        from wobo_gateway.wobo import board_plan_for

        model_plan = board_plan_for(request.payload, live=live)
        context = request.payload.get("context") or {}
        board_context = request.payload.get("board") or {}

        if model_plan is None:
            # Nothing to draw: fall back to the ordinary five-path turn, which carries its own
            # safety screens, cache and telemetry, and stream Wobo's line over the same wire.
            result = gw.invoke(name, request, profile.tier, subject=principal.subject)
            output = result.output
            plan = Plan(say=str(output.get("say") or ""), presentation="screen")
            card = output.get("component") or output.get("viz")
            actions = [a for a in (output.get("actions") or []) if isinstance(a, dict)]
        else:
            plan = plan_board(model_plan, context=context, board_context=board_context)
            screened = screen_wobo_outbound(
                {"say": plan.say, "actions": []}, gw.classifier
            )
            plan.say = str(screened.get("say") or plan.say)
            card = None
            actions = []
    except TooMuchAtOnce as exc:
        budget.refund(meter, name)
        return JSONResponse(
            status_code=413,
            content={
                "code": "too_much_at_once",
                "message": (
                    "That is more than one board. Ask me for a piece of it and I will "
                    "draw that."
                ),
                "objects": exc.count,
            },
            headers=headers,
        )
    except Exception:
        budget.refund(meter, name)
        raise

    turn = board_stream.new_turn(
        meter, board_stream.build_events(plan, actions=actions, card=card)
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

    # Rate limit on spend-bearing routes, keyed by the VERIFIED SUBJECT. Keying by IP put every
    # learner behind the platform proxy in one bucket — one noisy account throttled the school.
    # ponytail: in-memory fixed window, per process — move to Redis when >1 instance runs.
    limit = int(os.getenv("RATE_LIMIT_PER_MINUTE", "60"))
    # A caller with no verified identity is not a learner using the app; it is a stranger at the
    # door. It gets a much smaller window, so filling the shared bucket costs more and matters
    # less. (Anonymous learners are keyed per address by meter_key, on the full dial.)
    unauth_limit = int(os.getenv("UNAUTH_RATE_LIMIT_PER_MINUTE", "15"))
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

        limited = (
            path.startswith("/v1/capability/")
            # Free routes, still bounded: the interrupt frame and the erase are unmetered (a
            # learner may never be charged for stopping Wobo or for taking their memory back),
            # and unmetered without a limiter is an open tap on the board store and the database.
            or path.startswith("/v1/board/")
            or path == "/v1/me/erase"
            or path == "/v1/voice/session"
            or path == "/v1/voice/tts"
            # The mail dials write to the database, and the stop link is unauthenticated by
            # design — both are bounded per caller (the stop link on the stranger's dial).
            or path == "/v1/me/mail-preferences"
            or path == "/v1/mail/stop"
            # The public Ask Wobo box: open, and bounded per address on the stranger's dial before
            # its own per-browser allowance (ask_public.py) is even consulted.
            or path in ASK_LIMITED_PATHS
            # The parent link: an invite sends mail, the parent's pages are unauthenticated.
            or path in PARENT_LIMITED_PATHS
            # The plan: two of the three write to the database, and all three are free — a
            # learner is never charged a turn for reading or ending what they pay for.
            or path in BILLING_LIMITED_PATHS
            or path in _SOFT_AUTH_PATHS
        )
        oversized = _too_large(request)
        key = request.state.meter_key
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
        elif limited and _over_limit(key, limit if (principal or soft) else unauth_limit):
            response = JSONResponse(
                status_code=429,
                content={
                    "code": "rate_limited",
                    "message": "That was a lot at once. Give me a moment and try again.",
                },
                headers={"Retry-After": str(60 - int(time.time()) % 60)},
            )
        elif refused is not None:
            response = JSONResponse(status_code=refused.status, content=refused.body())
        else:
            response = await call_next(request)

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
        return response

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

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "mode": os.getenv("LLM_MODE", "mock").lower()}

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
        return MeResponse(
            subject=principal.subject,
            anonymous=principal.anonymous,
            plan=plan,
            consent_tier=profile.tier.value,
            budget=snap.as_dict(),
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
        erased = memory.erase(principal.subject, meter_key=request.state.meter_key)
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

        turn = board_stream.interrupt(body.turn, request.state.meter_key, body.at)
        if turn is None:
            return JSONResponse(
                status_code=404,
                content={
                    "code": "turn_not_found",
                    "message": "That one is already finished. Ask me anything.",
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

        # Derived, never declared: the tier comes from the learner's stored record, and the plan
        # from their subscription — which ends by itself when the period paid for does.
        profile = consent.get_profile(principal.subject, anonymous=principal.anonymous)
        plan = billing.metered_plan(principal, profile)

        # Sign-up completion (WOBO-PLAN §14.1, "confirm everything"): the learner's first meeting
        # with Wobo is the moment the account became real. The welcome goes out on a background
        # thread from here — before the turn is served, independent of how it is served — to
        # the address the verified token carries. It never blocks and never raises.
        if name == "wobo.turn" and is_first_meeting(request.payload):
            welcome_after_first_meeting(principal, request.payload)

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
                    "message": "Sign in first and I will build this for you.",
                },
            )
        meter = http.state.meter_key
        # Counted ONCE, after the door and before the model. Anything that fails before the
        # provider is reached (a closed consent door, a busy queue, a provider error) is
        # refunded — a learner never pays for a call we did not serve.
        snap = budget.charge(meter, name, plan, anonymous=principal.anonymous)
        headers = budget.headers(snap, budget.classify(name))

        # The curriculum registry (CURRICULUM.md §8). It rides this route rather than a router of
        # its own so it inherits the one door, the one limiter and the one meter — but it never
        # reaches Gateway.invoke, because these are registry reads and writes: they answer from
        # the store and, when a syllabus is missing, enqueue the discovery job that does. The one
        # exception is `curriculum.own.read`, which puts the learner's own document through the
        # generate tier; it owns its own call, which is why the model line below names what ran.
        if name.startswith("curriculum."):
            from wobo_gateway.curriculum import api as curriculum_api

            try:
                output = curriculum_api.handle(
                    name,
                    request.payload,
                    subject=principal.subject,
                    anonymous=principal.anonymous,
                    # A registry read is a turn; the discovery job one of them can mint is a
                    # search, an extraction on the generate tier and a re-reading on the verify
                    # tier. Without this seam the expensive half of the curriculum was free,
                    # and a cheap `curriculum.units` call could mint it (CURRICULUM.md §4.4).
                    charge=lambda capability: budget.charge(
                        meter, capability, plan, anonymous=principal.anonymous
                    ),
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
                    result = gw.invoke(name, request, profile.tier, subject=principal.subject)
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
                result = gw.invoke(name, request, profile.tier, subject=principal.subject)
        except Exception:
            budget.refund(meter, name)
            raise

        return JSONResponse(
            status_code=200,
            content=result.served(),
            headers=headers,
        )

    register_voice(app)
    register_email(app)
    register_mail_preferences(app)
    register_parent_links(app)
    register_billing(app)
    register_public_ask(app, gw)

    return app


app = create_app()
