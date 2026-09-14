"""Stage 1 — find the board's own document (``docs/CURRICULUM.md`` §4.1).

The brain searches; the learner never does. One interface, :class:`SearchProvider`, with a
deterministic mock for tests and one real provider chosen from the keys the deploy already has.

**Why no new search key.** A dedicated search API (Brave, Tavily, Serper) would be a fourth
credential to hold, rotate and pay for, for a job the models we already pay for do natively and
better: both providers ship a first-party web-search tool that runs inside the completion, so the
model reads the results itself and hands back the candidate documents it judged official. So the
provider is the router's own model, called with its native search tool:

===========  =========================================  ==============================
flavour      how search is asked for                    model (from the router's tiers)
===========  =========================================  ==============================
``openai``   ``/v1/responses`` with the ``web_search``  the ``generate`` tier (discovery
             tool                                       jobs are a generate-tier job,
                                                        WOBO-PLAN §9)
``anthropic````tools=[{"type": "web_search_20250305"}]`` the ``verify`` tier — the other
                                                        provider, for the same key set
===========  =========================================  ==============================

**Why the two shapes differ, and why this cost us the whole pipeline.** OpenAI's
``{"type": "web_search"}`` is a **Responses API** tool. Everything in this gateway calls through
litellm's chat-completions path, where OpenAI accepts only ``function`` and ``custom`` tool types,
so every OpenAI search this module ever attempted came back ``Invalid value: 'web_search'.
Supported values are: 'function' and 'custom'`` — and since ``openai`` is what ``auto`` resolves
to first, stage one of discovery refused on every board, always, from the day it was written.
The first end-to-end run (2026-09-11) is what found it. Chat completions also accepts a
``web_search_options`` field — and this model family **ignores it silently**: same latency, same
cost, no annotations, and urls that are the model's recollection rather than search results, one
of which was a 404. So the OpenAI flavour searches on ``/v1/responses``, where the API reports
each ``web_search_call`` it ran and a reply with none behind it can be thrown away
(:func:`_responses_search`). Anthropic's Messages API does take a server-side tool on the
chat-completions shape, so that flavour is unchanged.

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
#: How many of a board's aliases ride in the alias query. Three names is what a person would
#: type; a list of seven is a worse brief than a list of three.
MAX_ALIASES_IN_QUERY = 3


def _alias_clause(framework_name: str, aliases: Sequence[str]) -> str:
    """``"UPMSP" OR "UP board" OR "Uttar Pradesh board"`` — the names the board publishes under.

    A board's registry name is its legal one ("Board of High School and Intermediate Education
    Uttar Pradesh"), and nobody on the web writes it. Its aliases are what its own documents,
    its press and every learner call it, and the seed already holds them. An alias that is only
    the registry name again in different case adds nothing and is dropped.
    """
    folded = framework_name.strip().lower()
    kept: list[str] = []
    for alias in aliases:
        name = (alias or "").strip()
        lowered = name.lower()
        if not name or lowered == folded or lowered in {k.lower() for k in kept}:
            continue
        kept.append(name)
        if len(kept) >= MAX_ALIASES_IN_QUERY:
            break
    return " OR ".join(f'"{name}"' for name in kept)


def plan_queries(
    *,
    framework_name: str,
    level: str,
    subject: str,
    version: str | None = None,
    official_site: str | None = None,
    country: str | None = None,
    aliases: Sequence[str] = (),
) -> tuple[str, ...]:
    """The board's own site first, then its own names, then the open web (``CURRICULUM.md`` §4.1).

    Ordered cheapest-to-truest: if the registry knows the framework's official site we ask that
    host directly, because a document on the board's own domain is the only thing we would call
    official anyway. The alias query comes second because the first live run showed it is the one
    that decides: three Indian state boards were searched for under their registry names and two
    of them returned nothing at all, while the names their syllabi are actually published under
    ("UPMSP", "Samacheer Kalvi") sat unused in the request the whole time.
    """
    year = (version or "").strip()
    base = f"{framework_name} {level} {subject}".strip()
    queries: list[str] = []
    host = _site_host(official_site)
    if host:
        queries.append(f"site:{host} {level} {subject} syllabus {year}".strip())
    clause = _alias_clause(framework_name, aliases)
    if clause:
        queries.append(f"{clause} {level} {subject} syllabus {year} official pdf".strip())
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
    if not collected and getattr(provider, "searches_run", None) == 0:
        # Nothing was found AND nothing was ever looked up. "I could not find an official
        # syllabus" would be a lie about a search that never ran; this is the other line.
        raise SearchUnavailable(
            f"{provider.name} answered every query without running a web search"
        )
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
    'If you find nothing official, reply {"results":[]}. An empty list is a correct answer.'
)

#: The flavours that can search at all. The shape each one needs is :func:`search_kwargs`.
_FLAVOURS: tuple[str, ...] = ("openai", "anthropic")

#: Anthropic's server-side search tool, bound on the request. OpenAI has no equivalent TOOL on
#: chat completions; see the module docstring.
_ANTHROPIC_TOOL: dict[str, Any] = {"type": "web_search_20250305", "name": "web_search"}


def search_kwargs(flavour: str, *, max_uses: int) -> dict[str, Any]:
    """The request fields that make this flavour search. One shape per provider, in one place.

    OpenAI: ``web_search_options``, because chat completions refuses a ``web_search`` tool.
    Anthropic: a bound server tool, capped at ``max_uses`` so one query cannot become twenty.
    """
    if flavour == "anthropic":
        return {"tools": [{**_ANTHROPIC_TOOL, "max_uses": max_uses}]}
    if flavour == "openai":
        return {"web_search_options": {}}
    raise ValueError(f"unknown search flavour {flavour!r}")


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
    *, model: str, call: dict[str, Any], query: str, timeout_s: float
) -> tuple[str, int]:
    """One completion with this provider's own search bound. ``(reply text, searches run)``.

    Through ``model_call``, never ``litellm.completion`` directly. There is no litellm fallback
    list here on purpose: each provider asks for search in its own shape, so the chain across
    providers is run by :meth:`NativeToolSearchProvider.search`, one flavour at a time.

    The count is what makes the reply admissible: a model that answered without searching is
    remembering, and :meth:`NativeToolSearchProvider.search` throws that away. Anthropic reports
    each server-side search as a ``server_tool_use`` block, which is what is counted here.
    """
    from wobo_gateway.model_call import complete
    from wobo_gateway.telemetry import record_cost

    response = complete(
        model=model,
        messages=[
            {"role": "system", "content": _SEARCH_SYSTEM},
            {"role": "user", "content": f"Find the official document for: {query}"},
        ],
        max_tokens=1500,
        timeout=timeout_s,
        **call,
    )
    record_cost(capability="curriculum.discovery", model=model, response=response)
    return (response.choices[0].message.content or ""), _searches_in(response)


def _searches_in(response: Any) -> int:
    """How many web searches a chat-completions reply actually ran, as far as it will say.

    Anthropic surfaces ``server_tool_use`` blocks for its own search tool; litellm carries them
    on the message. Nothing is inferred: a reply that says nothing about searching counts zero,
    which is the strict reading and the safe one.
    """
    try:
        message = response.choices[0].message
    except Exception:  # pragma: no cover — a provider object shaped unlike any we call
        return 0
    count = 0
    for name in ("server_tool_use", "tool_calls", "provider_specific_fields"):
        blob = getattr(message, name, None)
        if isinstance(blob, list):
            count += sum(
                1
                for item in blob
                if "search" in str(getattr(item, "type", "") or (item or {})).lower()
            )
        elif isinstance(blob, dict):
            count += sum(1 for key in blob if "search" in str(key).lower() and blob[key])
    return count


def _responses_search(*, model: str, query: str, timeout_s: float) -> tuple[str, int]:
    """OpenAI's search, on ``/v1/responses``. ``(reply text, searches actually run)``.

    **Why this one call does not ride** :mod:`wobo_gateway.model_call`. OpenAI's web search is a
    Responses API tool; chat completions — the only shape ``model_call.complete`` speaks — refuses
    it outright (``Invalid value: 'web_search'``) and accepts ``web_search_options`` while
    silently ignoring it, which is the trap the first live run fell into: plausible urls, no
    search behind them, one of them a 404. So the OpenAI flavour calls ``litellm.responses``
    here, records its cost through the same funnel every other call uses, and counts the
    ``web_search_call`` items the API reports so the caller can tell a search from a memory.
    """
    import litellm

    from wobo_gateway.routing import token_cost

    response = litellm.responses(
        model=model,
        input=[
            {"role": "system", "content": _SEARCH_SYSTEM},
            {"role": "user", "content": f"Find the official document for: {query}"},
        ],
        tools=[{"type": "web_search"}],
        max_output_tokens=1500,
        timeout=timeout_s,
    )
    raw = response.model_dump() if hasattr(response, "model_dump") else dict(response)
    output = raw.get("output") or []
    searches = sum(1 for item in output if item.get("type") == "web_search_call")
    text = "".join(
        part.get("text", "")
        for item in output
        if item.get("type") == "message"
        for part in (item.get("content") or [])
    )
    # ``litellm.completion_cost`` does not price a Responses object, so the catalogue does it
    # from the usage the API reports. An unpriced search would be a hole in the day's ceiling.
    usage = raw.get("usage") or {}
    tokens_in, tokens_out = usage.get("input_tokens"), usage.get("output_tokens")
    cost = token_cost(model, tokens_in, tokens_out)
    try:
        from wobo_gateway import ledger, spend

        if cost is not None:
            spend.record(cost, capability="curriculum.discovery", model=model)
            ledger.note_spend(cost)
        # The DURABLE record, priced or not: ``telemetry.record_cost`` writes this row for every
        # chat-completions call, and a search that left no row would be the one call an operator
        # could not see. Served is the model that answered: no fallback list rides on this call.
        ledger.record(
            capability="curriculum.discovery",
            model_requested=model,
            model_served=str(raw.get("model") or "") or model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost,
            cost_source=ledger.FROM_CATALOGUE if cost is not None else ledger.UNPRICED,
        )
    except Exception:  # noqa: BLE001 — accounting must never be able to fail a search
        logger.debug("discovery.search cost not recorded", exc_info=True)
    logger.info(
        "discovery.search ran",
        extra={
            "fields": {
                "model": model,
                "searches": searches,
                "cost_usd": cost,
                "queries": [
                    (item.get("action") or {}).get("query")
                    for item in output
                    if item.get("type") == "web_search_call"
                ],
            }
        },
    )
    return text, searches


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
        respond: Callable[[str], tuple[str, int]] | None = None,
    ) -> None:
        if flavour not in _FLAVOURS:
            raise ValueError(f"unknown search flavour {flavour!r}")
        self.name = flavour
        self.max_uses = max_uses
        self.timeout_s = timeout_s
        self._model = model
        self._complete = complete
        self._respond = respond
        #: How many web searches this provider has actually run. Zero after a whole plan means
        #: nothing was looked up, whatever the replies said, and :func:`run_search` refuses.
        self.searches_run = 0

    @property
    def model(self) -> str:
        if self._model is None:
            self._model = _model_for(self.name)
        return self._model

    def search_call(self) -> dict[str, Any]:
        """The request fields this flavour searches with (:func:`search_kwargs`)."""
        return search_kwargs(self.name, max_uses=self.max_uses)

    def _others(self, env: Mapping[str, str] | None = None) -> list[NativeToolSearchProvider]:
        """The other flavours this deploy holds a key for, in table order: the chain behind us."""
        env = env if env is not None else os.environ
        return [
            NativeToolSearchProvider(flavour, max_uses=self.max_uses, timeout_s=self.timeout_s)
            for flavour in _FLAVOURS
            if flavour != self.name and env.get(_KEY_FOR[flavour])
        ]

    def _ask(self, query: str) -> tuple[str, int]:
        """One query to THIS flavour. ``(reply text, searches actually run)``."""
        if self._respond is not None:
            return self._respond(query)
        if self._complete is not None:
            # The older one-string seam: a test that scripts a reply is asserting about parsing,
            # not about whether a search happened, so its reply counts as one search.
            return self._complete(query), 1
        if self.name == "openai":
            return _responses_search(model=self.model, query=query, timeout_s=self.timeout_s)
        return _tool_search(
            model=self.model,
            call=self.search_call(),
            query=query,
            timeout_s=self.timeout_s,
        )

    def search(self, query: str, *, limit: int = 5) -> list[SearchResult]:
        # The cross-provider chain, run here because litellm cannot: OpenAI searches on the
        # Responses API and Anthropic through a bound server tool, so a fallback needs the other
        # provider's whole call shape, not just the other provider's model. The first flavour
        # that answers wins; when every one is down the LAST error is raised, honestly, and the
        # job refuses in Wobo's voice.
        failure: Exception | None = None
        for flavour in (self, *self._others()):
            try:
                text, searches = flavour._ask(query)
            except Exception as exc:  # noqa: BLE001 — the next provider gets its turn
                logger.warning(
                    "curriculum search: %s did not answer (%s); trying the next provider",
                    flavour.name,
                    type(exc).__name__,
                )
                failure = exc
                continue
            self.searches_run += searches
            if not searches:
                # A reply with no search behind it is the model REMEMBERING a url. The first law
                # of this stage is that we never return a url we did not see in a search result,
                # so it is discarded whatever it says — the run refuses, and that is honest.
                logger.warning(
                    "curriculum search: %s answered without searching; its urls are discarded",
                    flavour.name,
                )
                return []
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
