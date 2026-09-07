"""engine.image — Gemini imagery first, OpenAI imagery behind it, for what SVG cannot express.

A Plexus content engine. Most diagrams are SVG (glanceable, annotatable by Wobo); this
engine is reserved for the complex biological / structural imagery SVG cannot express —
a plant cell, the human body. It composes an educational-diagram prompt from a concept,
moderates it, generates a labeled diagram on a white background via ``gemini-2.5-flash-image``
(the "Nano Banana" image model) using ``GEMINI_API_KEY``, falls to OpenAI's
``gpt-image-2`` on ``OPENAI_API_KEY`` when Google does not answer, and caches the base64
PNG with provenance (which painter drew it) under ``content/cache/images/``. The usage ledger
row names the model that served.

The artifact is verified before serving (a valid non-empty image passed the moderation gate);
a refusal or any error on both painters is invisible — the engine returns
``{"status": "unavailable"}`` and the app falls back to its seed illustration. Keyless behaves
identically, so dev and CI never touch the network.

Since 2026-09-07 each painter is asked only when ``health.provider_available`` says its provider
is not marked out, and what it answers is fed back through ``model_call.note_failure``, the same
marks the text funnel and the voice seam keep: a quota refusal on Google's painter is a mark the
Gemini rung of every text chain honours, and the other way round.

Cache key = (concept x modality x difficulty); provenance = {engine, model, prompt_version}.
The first learner pays for generation; every learner after reuses the cached artifact — tier 1
of the cost economy (CONTEXT.md 6).
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any

from wobo_gateway.routing import Tier, provider_of, tier_chain


def _openai_rung(tier: Tier, *, default: str) -> str:
    """The OpenAI id on a media tier's chain: the fallback the router says this seam reaches for."""
    for model in tier_chain(tier):
        if provider_of(model) == "openai":
            return model
    return default


ENGINE_NAME = "engine.image"
MODEL = "gemini-2.5-flash-image"
PROMPT_VERSION = "v1"
MODALITY = "image"

#: The painter behind Gemini's, read from the router's ``image`` row (``routing.DEFAULT_TABLE``,
#: overridable by ``WOBO_TIER_IMAGE_CHAIN``). The image-generation guide (read 2026-09-05, again
#: 2026-09-07) lists
#: gpt-image-2, gpt-image-1.5, gpt-image-1 and gpt-image-1-mini; the Images API answers base64 by
#: default (``data[].b64_json``), PNG.
OPENAI_IMAGE_ID = _openai_rung(Tier.IMAGE, default="openai/gpt-image-2")
OPENAI_IMAGE_MODEL = OPENAI_IMAGE_ID.split("/", 1)[1]
_OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations"
_OPENAI_SIZE = "1024x1024"

#: The Gemini id the ledger and the provenance carry, provider first.
GEMINI_IMAGE_ID = f"gemini/{MODEL}"

# Composed onto the concept — the house style for every generated diagram.
_PROMPT_STYLE = "clean educational diagram, white background, labeled"

_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{MODEL}:generateContent"
)
_HTTP_TIMEOUT_S = 30.0

# Repo-root content cache; override for tests / alternate deployments.
_DEFAULT_CACHE_DIR = Path(__file__).resolve().parents[5] / "content" / "cache" / "images"

logger = logging.getLogger("wobo.gateway.plexus.image")

# Read for one release after the §17 rename, then deleted (see ``_cache_dir``).
_LEGACY_CACHE_DIR_ENV = "CLASSESS_IMAGE_CACHE_DIR"
_legacy_env_announced = False

_UNAVAILABLE = {"status": "unavailable"}


def _cache_dir() -> Path:
    """``WOBO_IMAGE_CACHE_DIR``, else the repo-root default.

    Deprecation shim (WOBO-PLAN §17): the variable was ``CLASSESS_IMAGE_CACHE_DIR``
    before the rename. A host still setting only the old name keeps working for one
    release and says so once. Drop the fallback once every host sets the new name.
    """
    global _legacy_env_announced
    override = os.getenv("WOBO_IMAGE_CACHE_DIR")
    if not override:
        override = os.getenv(_LEGACY_CACHE_DIR_ENV)
        if override and not _legacy_env_announced:
            _legacy_env_announced = True
            logger.warning(
                "%s is deprecated and is read for one release only; set "
                "WOBO_IMAGE_CACHE_DIR instead",
                _LEGACY_CACHE_DIR_ENV,
            )
    return Path(override) if override else _DEFAULT_CACHE_DIR


def _cache_key(concept: str, difficulty: str) -> str:
    body = json.dumps(
        {"concept": concept, "modality": MODALITY, "difficulty": difficulty},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(body.encode()).hexdigest()


def _compose_prompt(concept: str) -> str:
    return f"{concept}, {_PROMPT_STYLE}"


def _moderation_ok(concept: str, prompt: str) -> bool:
    """Moderation gate, run before generating and before serving.

    An image is the one artifact a learner can ask for in their own words and get back whole,
    so the concept goes through the SAME deterministic child-safety classifier every other
    learner-facing surface uses. A flagged verdict of any category refuses: nothing is
    generated, nothing is cached, and the caller serves ``unavailable``.
    """
    if not concept.strip() or not prompt.strip():
        return False
    from wobo_gateway.safety import moderate

    # The composed prompt as well as the raw concept: the style suffix is ours, but screening
    # exactly the string that would be sent is the honest check.
    return bool(moderate(concept)["allow"]) and bool(moderate(prompt)["allow"])


def _gemini_image(prompt: str, key: str) -> tuple[str, str] | None:
    """Call Nano Banana; return (base64_png, mime) or None on refusal / error.

    stdlib urllib only — this path never runs in tests (keyless short-circuits first), so no
    extra dependency is warranted. A refusal returns no inline image part -> None -> unavailable.
    """
    import urllib.error
    import urllib.request

    from wobo_gateway import health
    from wobo_gateway.model_call import note_failure

    req = urllib.request.Request(
        f"{_GENERATE_URL}?key={key}",
        data=json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = ""
        with contextlib.suppress(OSError):
            detail = exc.read().decode(errors="replace")[:300]
        logger.warning("image: Google HTTP %s", exc.code)
        note_failure(GEMINI_IMAGE_ID, exc, detail=detail)
        return None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        logger.warning("image: Google request failed — %s", type(exc).__name__)
        note_failure(GEMINI_IMAGE_ID, exc)
        return None

    for cand in body.get("candidates") or []:
        for part in (cand.get("content") or {}).get("parts") or []:
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                data = inline["data"]
                if _valid_b64_png(data):
                    mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
                    health.record_model(GEMINI_IMAGE_ID, ok=True)
                    return data, str(mime)
    return None


def _openai_image(prompt: str, key: str) -> tuple[str, str] | None:
    """Call OpenAI's Images API; return (base64_png, mime) or None on refusal / error.

    ``POST /v1/images/generations`` with ``model``, ``prompt``, ``n`` and ``size``; the answer is
    JSON with ``data[].b64_json`` (base64 is the default for the GPT Image models, and the default
    output format is PNG). Same shape out as the Gemini painter, so the caller cannot tell them
    apart except by the provenance it writes.
    """
    import urllib.error
    import urllib.request

    req = urllib.request.Request(
        _OPENAI_IMAGES_URL,
        data=json.dumps(
            {"model": OPENAI_IMAGE_MODEL, "prompt": prompt, "n": 1, "size": _OPENAI_SIZE}
        ).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    from wobo_gateway import health
    from wobo_gateway.model_call import note_failure

    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = ""
        with contextlib.suppress(OSError):
            detail = exc.read().decode(errors="replace")[:300]
        logger.warning("image: OpenAI HTTP %s", exc.code)
        note_failure(OPENAI_IMAGE_ID, exc, detail=detail)
        return None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        logger.warning("image: OpenAI request failed — %s", type(exc).__name__)
        note_failure(OPENAI_IMAGE_ID, exc)
        return None

    for item in body.get("data") or []:
        data = item.get("b64_json") if isinstance(item, dict) else None
        if data and _valid_b64_png(str(data)):
            health.record_model(OPENAI_IMAGE_ID, ok=True)
            return str(data), "image/png"
    return None


def _record_image(served: str, requested: str) -> None:
    """One drawn diagram in the usage ledger, naming the painter that actually drew it.

    A raw HTTPS call never passes through ``telemetry.record_cost``, so the row is written here.
    No vendor price table covers these models, so the cost is the operator's entry
    (``LEDGER_PRICE_IMAGE_USD``) or honestly unpriced. Never raises: a diagram outranks a line
    of accounting.
    """
    try:
        from wobo_gateway import ledger

        price = ledger.configured_price(ledger.IMAGE)
        ledger.record(
            capability=ENGINE_NAME,
            model_requested=requested,
            model_served=served,
            cost_usd=price,
            cost_source=ledger.UNPRICED if price is None else ledger.FROM_CONFIGURED,
            unit_kind=ledger.IMAGE,
            unit_count=1.0,
        )
        if price:
            from wobo_gateway import spend

            spend.record(price, capability=ENGINE_NAME, model=served)
    except Exception as exc:  # noqa: BLE001 — accounting must never break a diagram
        logger.debug("image: not recorded in the ledger (%s: %s)", type(exc).__name__, exc)


def _valid_b64_png(data: str) -> bool:
    """Verify the artifact is a real, non-trivial image before we cache and serve it."""
    try:
        raw = base64.b64decode(data, validate=True)
    except (ValueError, TypeError):
        return False
    return len(raw) > 256  # a refusal / error rarely yields a byte payload this size


def _served(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "ready",
        "mime": entry["mime"],
        "b64": entry["b64"],
        "provenance": entry["provenance"],
    }


def _read_cache(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def generate_image(concept: str, *, difficulty: str = "core") -> dict[str, Any]:
    """Serve a cached-or-generated educational image for ``concept``.

    Returns ``{"status": "ready", "mime", "b64", "provenance"}`` on success, else
    ``{"status": "unavailable"}`` — the app renders its seed illustration on unavailable.
    """
    concept = (concept or "").strip()
    if not concept:
        return dict(_UNAVAILABLE)

    difficulty = (difficulty or "core").strip() or "core"
    path = _cache_dir() / f"{_cache_key(concept, difficulty)}.json"

    cached = _read_cache(path)
    if cached is not None:
        return _served(cached)

    prompt = _compose_prompt(concept)
    if not _moderation_ok(concept, prompt):
        return dict(_UNAVAILABLE)

    google = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    if not google and not openai_key:
        return dict(_UNAVAILABLE)

    # Gemini first, OpenAI behind it, each only while its provider is not marked out. Whichever
    # answers is named in the provenance and in the ledger; a refusal or an error on both is
    # invisible and the app keeps its seed illustration.
    from wobo_gateway import health, telemetry

    requested = GEMINI_IMAGE_ID if google else OPENAI_IMAGE_ID
    served = ""
    result = None
    if google:
        if health.provider_available(GEMINI_IMAGE_ID):
            result = _gemini_image(prompt, google)
        else:
            telemetry.note_skipped(provider="gemini", model=GEMINI_IMAGE_ID)
    if result is not None:
        served = GEMINI_IMAGE_ID
    elif openai_key:
        if health.provider_available(OPENAI_IMAGE_ID):
            result = _openai_image(prompt, openai_key)
        else:
            telemetry.note_skipped(provider="openai", model=OPENAI_IMAGE_ID)
        if result is not None:
            served = OPENAI_IMAGE_ID
    if result is None:
        return dict(_UNAVAILABLE)
    _record_image(served, requested)

    b64, mime = result
    entry = {
        "b64": b64,
        "mime": mime,
        "provenance": {
            "engine": ENGINE_NAME,
            "model": served,
            "prompt_version": PROMPT_VERSION,
            "concept": concept,
            "difficulty": difficulty,
            "prompt": prompt,
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entry))
    return _served(entry)


# There is no ENGINE descriptor and no register() here. There never was a Plexus engine registry
# for them to land in: the one live caller is engines._raster_diagram, which imports
# generate_image directly, and the two "defensive, whatever shape the registry lands as" hooks
# had no caller in four waves. Wiring that anticipates an integration that never arrived is
# indistinguishable from wiring that broke.
