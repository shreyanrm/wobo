"""Stage 1 — find the board's own document (``docs/CURRICULUM.md`` §4.1).

The brain searches; the learner never does. One interface, :class:`SearchProvider`, with a
deterministic mock for tests and one real provider chosen from the keys the deploy already has.

**Why no new search key.** A dedicated search API (Brave, Tavily, Serper) would be a fourth
credential to hold, rotate and pay for, for a job the models we already pay for do natively and
better: both providers ship a first-party web-search tool that runs inside the completion, so the
model reads the results itself and hands back the candidate documents it judged official. So the
provider is the router's own model, called with its native search tool:

===========  =========================================  ==============================
flavour      tool                                       model (from the router's tiers)
===========  =========================================  ==============================
``openai``   ``{"type": "web_search"}``                 the ``generate`` tier (discovery
                                                        jobs are a generate-tier job,
                                                        WOBO-PLAN §9)
``anthropic````{"type": "web_search_20250305"}``        the ``verify`` tier — the other
                                                        provider, for the same key set
===========  =========================================  ==============================

Neither branch names a model here: both ask :mod:`wobo_gateway.routing` for the tier's model, so
a routing change moves discovery with it and no model id is written twice.

**Env-switchable.** ``CURRICULUM_SEARCH_PROVIDER`` is one of ``auto`` (default), ``mock``,
``openai``, ``anthropic``. ``auto`` resolves to ``mock`` unless ``LLM_MODE=live``, then to
whichever provider key is present, OpenAI first. A configured provider whose key is missing
raises :class:`SearchUnavailable` — the job refuses honestly rather than pretending it looked.

The budget is small on purpose: a handful of queries and a wall clock. A learner is waiting, and
a search that has not found the board's site in four queries is not going to.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlparse

logger = logging.getLogger("wobo.gateway.curriculum.discovery.search")

# Hosts that answer for a government, a board or a university are what "official" means in
# practice; a syllabus PDF on one of these outranks the same title on an aggregator.
_OFFICIAL_SUFFIXES: tuple[str, ...] = (
    ".gov",
    ".gov.in",
    ".nic.in",
    ".edu",
    ".ac.in",
    ".ac.uk",
    ".edu.au",
    ".gov.uk",
    ".gov.au",
    ".gc.ca",
    ".edu.sg",
    ".gov.sg",
)
# Result pages, mirrors and content farms: never the source of truth for a syllabus.
_JUNK_HOST_MARKERS: tuple[str, ...] = (
    "google.",
    "bing.",
    "duckduckgo.",
    "search.yahoo.",
    "webcache.",
    "translate.goog",
    "scribd.",
    "slideshare.",
    "pinterest.",
    "facebook.",
    "youtube.",
)
_MAX_URL_CHARS = 2000


class SearchUnavailable(Exception):
    """No search provider is configured or reachable. The job refuses; it never guesses."""


@dataclass(frozen=True)
class SearchResult:
    """One candidate document. ``url`` is the only field the next stage trusts."""

    url: str
    title: str = ""
    snippet: str = ""
    provider: str = ""

    @property
    def host(self) -> str:
        return (urlparse(self.url).hostname or "").lower()

    @property
    def is_pdf(self) -> bool:
        return urlparse(self.url).path.lower().endswith(".pdf")


@dataclass(frozen=True)
class SearchBudget:
    """A learner is waiting. Four queries and twenty-five seconds, then we stop looking."""

    max_queries: int = 4
    max_results: int = 8
    wall_clock_s: float = 25.0


class SearchProvider(Protocol):
    name: str

    def search(self, query: str, *, limit: int = 5) -> list[SearchResult]: ...


# --- query planning --------------------------------------------------------------------
def plan_queries(
    *,
    framework_name: str,
    level: str,
    subject: str,
    version: str | None = None,
    official_site: str | None = None,
    country: str | None = None,
) -> tuple[str, ...]:
    """The board's own site first, then the open web (``docs/CURRICULUM.md`` §4.1).

    Ordered cheapest-to-truest: if the registry knows the framework's official site we ask that
    host directly, because a document on the board's own domain is the only thing we would call
    official anyway.
    """
    year = (version or "").strip()
    base = f"{framework_name} {level} {subject}".strip()
    queries: list[str] = []
    host = _site_host(official_site)
    if host:
        queries.append(f"site:{host} {level} {subject} syllabus {year}".strip())
    queries.append(f'"{framework_name}" {level} {subject} syllabus {year} official pdf'.strip())
    queries.append(f'"{framework_name}" {level} {subject} curriculum document {year}'.strip())
    tail = f"{base} syllabus"
    if country:
        tail = f"{tail} {country}"
    queries.append(tail.strip())
    # dict.fromkeys keeps first-seen order while dropping the duplicate a missing year creates
    return tuple(dict.fromkeys(q for q in queries if q))


def _site_host(official_site: str | None) -> str:
    if not official_site:
        return ""
    site = official_site.strip()
    if "://" not in site:
        site = f"https://{site}"
    return (urlparse(site).hostname or "").lower()


# --- result hygiene and ranking --------------------------------------------------------
def _usable(url: str) -> bool:
    if not url or len(url) > _MAX_URL_CHARS:
        return False
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    return not any(marker in host for marker in _JUNK_HOST_MARKERS)


def _canonical(url: str) -> str:
    """Fragment-free, lowercase-host form, for dropping the same document found twice."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    port = f":{parsed.port}" if parsed.port else ""
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{parsed.scheme}://{host}{port}{parsed.path.rstrip('/')}{query}"


def _score(result: SearchResult, official_host: str) -> tuple[int, int, int]:
    """Sort key, highest first: the board's own host, then an official-looking suffix, then PDF."""
    host = result.host
    on_own_host = host == official_host or host.endswith(f".{official_host}")
    own = 1 if official_host and on_own_host else 0
    official = 1 if any(host.endswith(suffix) for suffix in _OFFICIAL_SUFFIXES) else 0
    return (own, official, 1 if result.is_pdf else 0)


def rank_results(
    results: Iterable[SearchResult], *, official_site: str | None = None
) -> list[SearchResult]:
    """Dedupe, drop the unusable, and put the most official-looking document first."""
    official_host = _site_host(official_site)
    seen: set[str] = set()
    kept: list[SearchResult] = []
    for result in results:
        if not _usable(result.url):
            continue
        key = _canonical(result.url)
        if key in seen:
            continue
        seen.add(key)
        kept.append(result)
    return sorted(kept, key=lambda r: _score(r, official_host), reverse=True)


def run_search(
    provider: SearchProvider,
    queries: Sequence[str],
    *,
    budget: SearchBudget | None = None,
    official_site: str | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> list[SearchResult]:
    """Run the plan inside the budget and return the ranked candidates.

    Stops at the first of: the query ceiling, the wall clock, or enough results. A provider that
    raises on one query is logged and the next query still runs — one flaky call is not a failed
    search — but a provider that raises on every query yields nothing, and the job refuses.
    """
    budget = budget or SearchBudget()
    deadline = clock() + budget.wall_clock_s
    collected: list[SearchResult] = []
    for query in list(queries)[: budget.max_queries]:
        if clock() >= deadline:
            logger.info(
                "discovery.search stopped on the clock",
                extra={"fields": {"queries_run": len(collected), "provider": provider.name}},
            )
            break
        try:
            found = provider.search(query, limit=budget.max_results)
        except SearchUnavailable:
            raise
        except Exception:
            logger.warning(
                "discovery.search query failed",
                extra={"fields": {"provider": provider.name}},
                exc_info=True,
            )
            continue
        collected.extend(found)
        if len({_canonical(r.url) for r in collected if _usable(r.url)}) >= budget.max_results:
            break
    return rank_results(collected, official_site=official_site)[: budget.max_results]


# --- providers -------------------------------------------------------------------------
class MockSearchProvider:
    """Deterministic, keyless, offline. The only provider the test suite ever uses.

    ``results`` is either a list (returned for every query) or a mapping whose key is matched
    as a case-insensitive substring of the query, so a fixture can answer the ``site:`` query
    differently from the open-web one.
    """

    name = "mock"

    def __init__(
        self,
        results: Sequence[SearchResult] | Mapping[str, Sequence[SearchResult]] | None = None,
        *,
        raises: Exception | None = None,
    ) -> None:
        self._results = results if results is not None else ()
        self._raises = raises
        self.queries: list[str] = []

    def search(self, query: str, *, limit: int = 5) -> list[SearchResult]:
        self.queries.append(query)
        if self._raises is not None:
            raise self._raises
        if isinstance(self._results, Mapping):
            lowered = query.lower()
            for needle, results in self._results.items():
                if needle.lower() in lowered:
                    return list(results)[:limit]
            return []
        return list(self._results)[:limit]


_SEARCH_SYSTEM = (
    "You find the OFFICIAL syllabus or curriculum document for one school framework, using the "
    "web search tool. Prefer the board's or ministry's own site; a PDF or a syllabus page on the "
    "official domain is what we want. Never invent a URL, never return a URL you did not see in "
    "a search result, and never return an aggregator, a coaching site, a file locker or a "
    "search-results page.\n"
    "Reply with strict JSON only, no prose outside it:\n"
    '{"results":[{"url":"<exact url>","title":"<document title>","why":"<one short reason it '
    'is official>"}]}\n'
    "If you find nothing official, reply {\"results\":[]}. An empty list is a correct answer."
)

# The native web-search tool for each provider. Nothing else in the gateway knows these shapes.
_TOOL_SPECS: dict[str, dict[str, Any]] = {
    "openai": {"type": "web_search"},
    "anthropic": {"type": "web_search_20250305", "name": "web_search"},
}


def _model_for(flavour: str) -> str:
    """The router's model for this flavour: the first id of that provider on the generate tier's
    chain, then the verify tier's. Never a model id written here, and never the wrong vendor's
    model under this vendor's search tool, whichever way the owner orders the tiers."""
    from wobo_gateway.routing import Tier, provider_of, tier_chain

    for tier in (Tier.GENERATE, Tier.VERIFY, Tier.REASON, Tier.TURN):
        for model in tier_chain(tier):
            if provider_of(model) == flavour:
                return model
    raise SearchUnavailable(f"the router has no {flavour} model for curriculum search")


#: The key each flavour searches on. Read to decide whether a flavour CAN be tried, never printed.
_KEY_FOR: dict[str, str] = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}


def _tool_search(
    *, model: str, tools: list[dict[str, Any]], query: str, timeout_s: float
) -> str:
    """One completion with the provider's own search tool bound. Returns the raw reply text.

    Through ``model_call``, never ``litellm.completion`` directly. There is no litellm fallback
    list here on purpose: each provider's search tool has its own shape, so the chain across
    providers is run by :meth:`NativeToolSearchProvider.search`, one flavour at a time.
    """
    from wobo_gateway.model_call import complete
    from wobo_gateway.telemetry import record_cost

    response = complete(
        model=model,
        messages=[
            {"role": "system", "content": _SEARCH_SYSTEM},
            {"role": "user", "content": f"Find the official document for: {query}"},
        ],
        tools=tools,
        max_tokens=1500,
        timeout=timeout_s,
    )
    record_cost(capability="curriculum.discovery", model=model, response=response)
    return response.choices[0].message.content or ""


class NativeToolSearchProvider:
    """A router-tier model calling its provider's own web-search tool.

    ``complete`` is the seam: it takes the query and returns the model's raw reply, so a test can
    exercise the parsing and the budget without a key or a network.
    """

    def __init__(
        self,
        flavour: str,
        *,
        model: str | None = None,
        max_uses: int = 5,
        timeout_s: float = 40.0,
        complete: Callable[[str], str] | None = None,
    ) -> None:
        if flavour not in _TOOL_SPECS:
            raise ValueError(f"unknown search flavour {flavour!r}")
        self.name = flavour
        self.max_uses = max_uses
        self.timeout_s = timeout_s
        self._model = model
        self._complete = complete

    @property
    def model(self) -> str:
        if self._model is None:
            self._model = _model_for(self.name)
        return self._model

    def _tools(self) -> list[dict[str, Any]]:
        spec = dict(_TOOL_SPECS[self.name])
        if self.name == "anthropic":
            spec["max_uses"] = self.max_uses
        return [spec]

    def _others(self, env: Mapping[str, str] | None = None) -> list[NativeToolSearchProvider]:
        """The other flavours this deploy holds a key for, in table order: the chain behind us."""
        env = env if env is not None else os.environ
        return [
            NativeToolSearchProvider(
                flavour, max_uses=self.max_uses, timeout_s=self.timeout_s
            )
            for flavour in _TOOL_SPECS
            if flavour != self.name and env.get(_KEY_FOR[flavour])
        ]

    def search(self, query: str, *, limit: int = 5) -> list[SearchResult]:
        if self._complete is not None:
            text = self._complete(query)
            return parse_results(text, provider=self.name)[:limit]
        # The cross-provider chain, run here because litellm cannot: OpenAI's search tool and
        # Anthropic's are different objects, so a fallback needs the other provider's tool bound,
        # not just the other provider's model. The first flavour that answers wins; when every
        # one is down the LAST error is raised, honestly, and the job refuses in Wobo's voice.
        failure: Exception | None = None
        for flavour in (self, *self._others()):
            try:
                text = _tool_search(
                    model=flavour.model,
                    tools=flavour._tools(),
                    query=query,
                    timeout_s=flavour.timeout_s,
                )
            except Exception as exc:  # noqa: BLE001 — the next provider gets its turn
                logger.warning(
                    "curriculum search: %s did not answer (%s); trying the next provider",
                    flavour.name,
                    type(exc).__name__,
                )
                failure = exc
                continue
            return parse_results(text, provider=flavour.name)[:limit]
        assert failure is not None  # the loop always runs at least once
        raise failure


def parse_results(text: str, *, provider: str = "") -> list[SearchResult]:
    """The model's reply into results. Unparseable is an empty list, never an exception."""
    from wobo_gateway.wobo import _extract_json  # the same code-fence tolerant JSON reader

    try:
        parsed = _extract_json(text)
    except json.JSONDecodeError:  # pragma: no cover — _extract_json already swallows this
        return []
    raw = parsed.get("results")
    if not isinstance(raw, list):
        return []
    results: list[SearchResult] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not _usable(url):
            continue
        results.append(
            SearchResult(
                url=url,
                title=str(item.get("title") or "").strip()[:300],
                snippet=str(item.get("why") or item.get("snippet") or "").strip()[:500],
                provider=provider,
            )
        )
    return results


def configured_flavour(env: Mapping[str, str] | None = None) -> str:
    """Which provider this deploy searches with: ``mock``, ``openai`` or ``anthropic``."""
    env = env if env is not None else os.environ
    choice = (env.get("CURRICULUM_SEARCH_PROVIDER") or "auto").strip().lower()
    if choice in {"mock", "openai", "anthropic"}:
        return choice
    if choice not in {"auto", ""}:
        raise SearchUnavailable(f"unknown CURRICULUM_SEARCH_PROVIDER {choice!r}")
    if (env.get("LLM_MODE") or "mock").strip().lower() != "live":
        return "mock"
    if env.get("OPENAI_API_KEY"):
        return "openai"
    if env.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    raise SearchUnavailable("no provider key is configured for curriculum search")


def build_search_provider(env: Mapping[str, str] | None = None) -> SearchProvider:
    """The configured provider, or :class:`SearchUnavailable` — never a silent fallback.

    A deploy that means to search and cannot must say so: the job then refuses in Wobo's voice
    and offers the own-syllabus path, which is honest. Quietly returning the mock would put a
    fabricated syllabus in the global registry, which is the one thing that kills this.
    """
    env = env if env is not None else os.environ
    flavour = configured_flavour(env)
    if flavour == "mock":
        return MockSearchProvider()
    key = "OPENAI_API_KEY" if flavour == "openai" else "ANTHROPIC_API_KEY"
    if not env.get(key):
        raise SearchUnavailable(f"CURRICULUM_SEARCH_PROVIDER={flavour} but {key} is not set")
    return NativeToolSearchProvider(flavour)
