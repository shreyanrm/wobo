"""GATHER, daily: every source the law names, read as far as each one honestly can be, then ranked.

``docs/GROWTH-DESK.md`` section 4.1: *"Search Console queries we nearly rank for, the questions in
the study subreddits and People Also Ask, exam and board dates, and what our own learners asked
most. Ranked by demand and by how well a cached concept core already answers it."*

:mod:`.demand` holds the harvest and the ranking by query. This file adds the three signals that
are not a file in the tree, and the one fact the ranking was missing: whether a concept core is
actually on file for the topic.

=====================  =====================================================================
search-console         the Search Analytics API, pages at average position 4.5 to 20: the
                       queries we nearly rank for. Read with a token for the verified property.
                       :func:`near_misses` is the parser and the suite feeds it recordings.
our-learners           how often each concept was served to a learner, from the content stores'
                       own ``served_count``. Counts per concept and nothing else: the stores
                       never knew who was served.
person                 the questions a person read in the study subreddits and in People Also
                       Ask, pasted into the desk. Reddit is tier 3 and People Also Ask has no
                       interface a machine may read, so this source is a person by design and
                       there is no crawler for either anywhere in the repository.
exam-dates             absent, with the reason :mod:`.demand` gives. Nothing is invented.
=====================  =====================================================================

**The live syllabus.** The topics are matched against the curriculum store's public tree when it
has one (``curriculum.public``), and against the dated snapshot beside the harvest when it does
not. The desk says which one it used.
"""

from __future__ import annotations

import json
import logging
import math
import os
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable
from datetime import UTC, date, datetime, timedelta
from typing import Any

from wobo_gateway.growth import demand
from wobo_gateway.growth import store as store_mod
from wobo_gateway.growth.store import Signal

logger = logging.getLogger("wobo.gateway.growth.gather")

SEARCH_CONSOLE = "search-console"
OUR_LEARNERS = "our-learners"
PERSON = "person"

ANALYTICS_URL = (
    "https://searchconsole.googleapis.com/webmasters/v3/sites/{site}/searchAnalytics/query"
)
TOKEN_ENV = "GROWTH_SEARCH_CONSOLE_TOKEN"
PROPERTY_ENV = "GROWTH_SEARCH_CONSOLE_PROPERTY"
#: "Nearly rank": on the first two pages but not at the top of the first.
NEAR_FROM = 4.5
NEAR_TO = 20.0
#: How far back the ranking reads signals.
WINDOW_DAYS = 28
#: What one unit of each signal is worth against one autocomplete query suggested by one engine.
#: A near miss is our own page already in the results, which is worth more than a suggestion; a
#: learner served a concept is real demand from inside; a person's note is a question somebody
#: actually asked in public.
SIGNAL_WEIGHT: dict[str, float] = {SEARCH_CONSOLE: 3.0, OUR_LEARNERS: 1.0, PERSON: 2.0}
#: What having a core on file does to a topic's score. A topic with a core can be written today.
CORE_BONUS = 1.5
MAX_NOTE_LINES = 50
MAX_NOTE_CHARS = 200

Transport = Callable[[str, str, dict[str, str], Any], tuple[int, Any]]


class NotConfigured(Exception):
    pass


def _urllib(url: str, method: str, headers: dict[str, str], body: Any) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=15.0) as response:  # noqa: S310
        raw = response.read().decode()
        return response.status, (json.loads(raw) if raw.strip() else None)


# --- search console ------------------------------------------------------------------------------
def near_misses(answer: Any, *, day: str) -> list[Signal]:
    """Search Analytics rows (dimensions query, page) at positions worth writing for."""
    out: list[Signal] = []
    for row in (answer or {}).get("rows") or []:
        keys = row.get("keys") or []
        if len(keys) < 2:
            continue
        try:
            position = float(row.get("position"))
            impressions = int(row.get("impressions") or 0)
            clicks = int(row.get("clicks") or 0)
        except (TypeError, ValueError):
            continue
        if not NEAR_FROM <= position <= NEAR_TO or impressions <= 0:
            continue
        query = str(keys[0]).strip().lower()[:300]
        page = urllib.parse.urlsplit(str(keys[1])).path[:300] or "/"
        if not query:
            continue
        out.append(
            Signal(
                day=day,
                source=SEARCH_CONSOLE,
                query=query,
                page=page,
                impressions=impressions,
                clicks=clicks,
                position=round(position, 2),
            )
        )
    return out


def read_search_console(day: date, *, transport: Transport | None = None) -> list[Signal]:
    token = (os.getenv(TOKEN_ENV) or "").strip()
    site = (os.getenv(PROPERTY_ENV) or "").strip()
    if not token or not site:
        raise NotConfigured(f"{TOKEN_ENV} and {PROPERTY_ENV} are not set")
    body = {
        "startDate": (day - timedelta(days=WINDOW_DAYS)).isoformat(),
        "endDate": day.isoformat(),
        "dimensions": ["query", "page"],
        "rowLimit": 5000,
    }
    url = ANALYTICS_URL.format(site=urllib.parse.quote(site, safe=""))
    status, answer = (transport or _urllib)(
        url, "POST", {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, body
    )
    if status >= 400:
        raise NotConfigured(f"Search Console answered {status}")
    return near_misses(answer, day=day.isoformat())


# --- our learners ---------------------------------------------------------------------------------
def served_counts(rows: Any, *, day: str) -> list[Signal]:
    """``content.levels`` rows (concept_id, served_count) summed per concept. Counts only."""
    totals: dict[str, int] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        concept = str(row.get("concept_id") or "").strip()
        try:
            count = int(row.get("served_count") or 0)
        except (TypeError, ValueError):
            continue
        if concept and count > 0:
            totals[concept] = totals.get(concept, 0) + count
    return [
        Signal(day=day, source=OUR_LEARNERS, concept=concept[:200], count=count)
        for concept, count in sorted(totals.items())
    ]


def _content_get(path: str, *, transport: Transport | None) -> Any:
    base = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or ""
    ).strip()
    if not (base and key) and transport is None:
        raise NotConfigured("no project is configured")
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept-Profile": "content"}
    status, answer = (transport or _urllib)(f"{base}/rest/v1/{path}", "GET", headers, None)
    if status >= 400:
        raise NotConfigured(f"the content stores answered {status}")
    return answer


def read_our_learners(day: date, *, transport: Transport | None = None) -> list[Signal]:
    answer = _content_get(
        "levels?select=concept_id,served_count&served_count=gt.0&superseded_by=is.null"
        "&order=served_count.desc&limit=5000",
        transport=transport,
    )
    return served_counts(answer, day=day.isoformat())


def cores_on_file(*, transport: Transport | None = None) -> set[str] | None:
    """The concept ids a live core exists for, from the content stores and the file cache.
    ``None`` when neither can be read, which the ranking shows as "not known" rather than "no"."""
    found: set[str] = set()
    known = False
    try:
        rows = _content_get(
            "cores?select=concept_id&superseded_by=is.null&status=in.(canonical,provisional)"
            "&limit=10000",
            transport=transport,
        )
        found.update(str(r.get("concept_id")) for r in rows or [] if isinstance(r, dict))
        known = True
    except Exception as exc:  # noqa: BLE001 — a store we cannot read is "not known"
        logger.info("growth: cores could not be read from the store (%s)", exc)
    try:
        from wobo_gateway.plexus import store as plexus_store

        folder = plexus_store.cache_dir() / plexus_store.CORE_MODALITY
        if folder.is_dir():
            known = True
            for path in folder.glob("*.json"):
                found.add(path.name.split("--", 1)[0])
    except Exception as exc:  # noqa: BLE001
        logger.info("growth: the core cache could not be listed (%s)", exc)
    return found if known else None


# --- a person's notes -----------------------------------------------------------------------------
def notes(text: str, *, day: str) -> list[Signal]:
    """One question per line, as a person pasted them. Trimmed, de-duplicated, capped."""
    seen: set[str] = set()
    out: list[Signal] = []
    for line in (text or "").splitlines():
        question = " ".join(line.strip().lstrip("-*0123456789.) ").split())[:MAX_NOTE_CHARS]
        if len(question) < 6 or question.lower() in seen:
            continue
        if "http://" in question or "https://" in question:
            continue  # a question, never an address
        seen.add(question.lower())
        out.append(Signal(day=day, source=PERSON, query=question.lower(), count=1))
        if len(out) >= MAX_NOTE_LINES:
            break
    return out


# --- the live syllabus ----------------------------------------------------------------------------
def nodes_from_tree(tree: Any) -> tuple[demand.Node, ...]:
    """The public tree as :class:`demand.Node` rows: every chapter as a unit and every topic."""
    out: dict[str, demand.Node] = {}
    for board in getattr(tree, "boards", ()) or ():
        short = str((board.meta or {}).get("short") or board.name)
        for klass in board.children:
            for subject in klass.children:
                for chapter in subject.children:
                    unit = demand.Node(
                        short, klass.name, subject.name, chapter.name, chapter.name, "unit"
                    )
                    out.setdefault(unit.key, unit)
                    for topic in chapter.children:
                        node = demand.Node(
                            short, klass.name, subject.name, chapter.name, topic.name, "topic"
                        )
                        out.setdefault(node.key, node)
    return tuple(out.values())


def syllabus() -> tuple[tuple[demand.Node, ...], str]:
    """The live tree when it has anything in it, else the dated snapshot. And which it was."""
    try:
        from wobo_gateway.curriculum import public

        live = nodes_from_tree(public.get_tree())
        if live:
            return live, "the curriculum store"
    except Exception as exc:  # noqa: BLE001 — the snapshot stands in, and the desk says so
        logger.info("growth: the live syllabus could not be read (%s)", exc)
    return demand.nodes(), "the snapshot in content/growth, " + str(
        demand.manifest().get("curriculum", {}).get("from") or ""
    )


# --- the ranking ----------------------------------------------------------------------------------
def rank(
    signals: Iterable[Signal],
    *,
    syllabus_nodes: tuple[demand.Node, ...] | None = None,
    cores: set[str] | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """The harvest ranking, with the day's signals added and core readiness applied."""
    from wobo_gateway.plexus import store as plexus_store

    pool = list(demand.queries())
    extra: dict[str, float] = {}
    served: dict[str, int] = {}
    for signal in signals:
        if signal.source in (SEARCH_CONSOLE, PERSON) and signal.query:
            weight = SIGNAL_WEIGHT[signal.source]
            if signal.source == SEARCH_CONSOLE:
                weight *= 1.0 + math.log10(1 + signal.impressions)
            extra[signal.query] = extra.get(signal.query, 0.0) + weight
        elif signal.source == OUR_LEARNERS and signal.concept:
            served[signal.concept] = served.get(signal.concept, 0) + signal.count
    for query, weight in sorted(extra.items()):
        pool.append(
            demand.Query(text=query, engines=(), intent=demand.intent_of(query), demand=weight)
        )
    topics = demand.rank(10_000, pool=pool, syllabus=syllabus_nodes)
    out: list[dict[str, Any]] = []
    for topic in topics:
        concept = plexus_store.concept_id(topic.name)
        count = served.get(concept, 0)
        learners = SIGNAL_WEIGHT[OUR_LEARNERS] * math.log10(1 + count) * 10 if count else 0.0
        core = None if cores is None else concept in cores
        score = (topic.score + learners) * (CORE_BONUS if core else 1.0)
        row = topic.as_dict()
        row.update(
            {
                "concept_id": concept,
                "core_on_file": core,
                "served_to_learners": count,
                "signal_queries": sum(1 for q in topic.queries if q.text in extra),
                "score": round(score, 3),
            }
        )
        out.append(row)
    out.sort(key=lambda r: (-r["score"], r["slug"]))
    return out[: max(0, limit)]


def run(
    *,
    today: date | None = None,
    person_notes: str = "",
    sc_transport: Transport | None = None,
    content_transport: Transport | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """The daily pass. Every source is read or reported absent; the signals are kept; the rank is
    returned for the desk and for MAKE."""
    day = today or datetime.now(UTC).date()
    sources: dict[str, dict[str, Any]] = {}
    fresh: list[Signal] = []
    for key, reader in (
        (SEARCH_CONSOLE, lambda: read_search_console(day, transport=sc_transport)),
        (OUR_LEARNERS, lambda: read_our_learners(day, transport=content_transport)),
    ):
        try:
            got = reader()
        except NotConfigured as absent:
            sources[key] = {"read": False, "because": str(absent)}
            continue
        except Exception as exc:  # noqa: BLE001 — one source down is not the pass down
            sources[key] = {"read": False, "because": f"could not be read: {type(exc).__name__}"}
            continue
        sources[key] = {"read": True, "rows": len(got)}
        fresh.extend(got)
    pasted = notes(person_notes, day=day.isoformat())
    sources[PERSON] = {"read": True, "rows": len(pasted)}
    fresh.extend(pasted)
    sources["exam-dates"] = {
        "read": False,
        "because": next(s.because for s in demand.SOURCES if s.key == "exam-dates"),
    }
    kept: int | None
    try:
        kept = store_mod.get_store().add_signals(fresh)
        window = store_mod.get_store().signals(
            since=(day - timedelta(days=WINDOW_DAYS)).isoformat()
        )
    except store_mod.StoreUnavailable as exc:
        kept, window = None, fresh
        sources["store"] = {"read": False, "because": str(exc)}
    nodes, which = syllabus()
    cores = cores_on_file(transport=content_transport)
    return {
        "day": day.isoformat(),
        "sources": sources,
        "kept": kept,
        "syllabus": {"from": which, "nodes": len(nodes)},
        "cores_known": cores is not None,
        "topics": rank(window, syllabus_nodes=nodes, cores=cores, limit=limit),
    }


__all__ = [
    "NEAR_FROM",
    "NEAR_TO",
    "OUR_LEARNERS",
    "PERSON",
    "SEARCH_CONSOLE",
    "NotConfigured",
    "cores_on_file",
    "near_misses",
    "nodes_from_tree",
    "notes",
    "rank",
    "read_our_learners",
    "read_search_console",
    "run",
    "served_counts",
    "syllabus",
]
