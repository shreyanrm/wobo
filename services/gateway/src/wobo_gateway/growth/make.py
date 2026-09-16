"""MAKE: one answer-first source piece per topic, from the concept core, or an honest "owed".

``docs/GROWTH-DESK.md`` section 4.2: *"one source piece per topic from the concept core, answer
first, with a drawn figure from the board pipeline and a short film from the film pipeline, in the
register, never narrating, and only claims that docs/CLAIMS.md has cleared."*

Four inputs, each read from where it already lives and never invented here:

============  =================================================================================
core          ``plexus.store.load_core``: the idea, why it matters, two misconceptions, the
              check and the words. READ ONLY. A core costs real money at the verify tier, and
              this desk does not buy one: a topic with no core on file is owed, by name.
figure        ``plexus.store.load(concept, "diagram", ...)``: a drawn figure the verifier passed
              and a real model made. A mock or a seeded figure is not one.
film          ``plexus.store.load(concept, "video", ...)`` with a script and an asset. Optional:
              without one the piece is still publishable and the Short is owed.
provenance    the curriculum store's public tree: the official document each placement came
              from, its page, the hash of the bytes and the day they were read.
============  =================================================================================

The words are written by :func:`write_words` on the tiny tier, only when the gateway runs live, and
only while every learner lane is still served in full: the writer stands down at the stranger
lane's degrade line (``spend.py``), so marketing copy never takes money a learner would have had.
It is never called for a piece the gate must refuse anyway (no figure, no sources): that topic is
owed, by name, and nothing is paid for. Keyless, it returns nothing and the piece is owed
"no writer": the desk never fills the gap with a template, because a template with the concept's
name swapped in is exactly the page section 3 forbids.

Whatever the writer returns is checked by :func:`.piece.check`, every rule of it, before anything
is staged.
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from wobo_gateway.growth import demand
from wobo_gateway.growth.piece import Figure, Film, Piece, Provenance, Section

logger = logging.getLogger("wobo.gateway.growth.make")

CAPABILITY = "growth.write"
WRITER_MAX_TOKENS = 2400
WRITER_TIMEOUT_S = 60.0
#: The model names a figure made in a lab or seeded by hand carries. Not a drawn explanation.
_NOT_A_REAL_MODEL = frozenset({"", "mock", "seed", "seeded", "stub", "fake"})

WRITER_SYSTEM = (
    "You write one explainer page for the Wobo blog, for a school learner and the parent beside "
    "them. You are given a concept core: the idea, why it matters, two misconceptions with their "
    "counter-examples, the one check, and the words. Write ONLY from it. Add no fact that is not "
    "in it.\n\n"
    "Rules, all of them:\n"
    "- The lead is ONE sentence that answers the question on its own, at least ten words.\n"
    "- Four sections: what the idea is, the first misconception and what kills it, the second "
    "misconception and what kills it, and how to check you hold it. Each section is at least 90 "
    "words of plain prose in short paragraphs. At least 600 words in all.\n"
    "- A summary of 60 to 160 characters a search result can show.\n"
    "- Calm sentence case. No exclamation marks, no emoji, no dashes standing in for "
    "punctuation, no hype, no superlatives, no promise about marks or scores or ranks.\n"
    "- Never announce what you are doing: no 'let me', no 'in this article', no 'as you can "
    "see'. Say the thing.\n"
    "- No people's names, no named products or companies, no class ranges, no mention of "
    "teachers, schools or tuition.\n\n"
    'Reply with strict JSON only: {"title":"...","summary":"...","lead":"...",'
    '"sections":[{"heading":"...","body":"..."}]}'
)

Writer = Callable[[dict[str, Any], "demand.Topic"], dict[str, Any] | None]


@dataclass(frozen=True)
class Made:
    piece: Piece | None
    owed: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "piece": self.piece.as_dict() if self.piece else None,
            "owed": list(self.owed),
        }


def _grade(level: str) -> str:
    found = re.search(r"(\d+)", level or "")
    return found.group(1) if found else ""


def scope_of(node: demand.Node) -> dict[str, str]:
    return {
        "board": node.board,
        "grade": _grade(node.level),
        "subject": node.subject,
        "chapter": node.unit,
    }


def core_for(topic: demand.Topic) -> dict[str, Any] | None:
    from wobo_gateway.plexus import store as plexus_store

    for node in topic.placements:
        try:
            core = plexus_store.load_core(topic.name, scope_of(node))
        except Exception as exc:  # noqa: BLE001 — a store we cannot read has no core for us
            logger.info("growth: core read failed for %s (%s)", topic.slug, exc)
            continue
        if core:
            return core
    return None


def _real(record: dict[str, Any] | None) -> bool:
    if not record or not record.get("verified") or record.get("seeded"):
        return False
    model = str((record.get("provenance") or {}).get("model") or "").strip().lower()
    return model not in _NOT_A_REAL_MODEL and str(record.get("status") or "") != "rejected"


def figure_for(topic: demand.Topic) -> Figure | None:
    from wobo_gateway.plexus import store as plexus_store

    for node in topic.placements:
        try:
            record = plexus_store.load(topic.name, "diagram", "core", scope_of(node))
        except Exception:  # noqa: BLE001
            record = None
        if not _real(record):
            continue
        assert record is not None
        svg = str(record.get("artifact") or "")
        label = re.search(r'aria-label="([^"]+)"', svg)
        alt = label.group(1).strip() if label else ""
        turn = str((record.get("provenance") or {}).get("turn_id") or record.get("createdAt") or "")
        return Figure(concept=topic.name, alt=alt, turn_id=turn, verified=True)
    return None


def film_for(topic: demand.Topic) -> Film | None:
    from wobo_gateway.plexus import store as plexus_store

    for node in topic.placements:
        try:
            record = plexus_store.load(topic.name, "video", "core", scope_of(node))
        except Exception:  # noqa: BLE001
            record = None
        if not _real(record):
            continue
        assert record is not None
        artifact = record.get("artifact") if isinstance(record.get("artifact"), dict) else {}
        script = str(artifact.get("script") or "").strip()
        asset = str(artifact.get("asset_id") or artifact.get("url") or "").strip()
        seconds = int(artifact.get("seconds") or 0)
        if script and asset and 0 < seconds <= 90:
            return Film(concept=topic.name, seconds=seconds, script=script, asset_id=asset)
    return None


def provenance_for(topic: demand.Topic, tree: Any = None) -> list[Provenance]:
    """The documents behind each placement, from the curriculum store's public tree."""
    if tree is None:
        try:
            from wobo_gateway.curriculum import public

            tree = public.get_tree()
        except Exception as exc:  # noqa: BLE001
            logger.info("growth: the syllabus tree could not be read (%s)", exc)
            return []
    wanted = {(p.board, p.level, p.subject, p.unit, p.name, p.kind) for p in topic.placements}
    out: list[Provenance] = []
    seen: set[str] = set()
    for board in getattr(tree, "boards", ()) or ():
        short = str((board.meta or {}).get("short") or board.name)
        for klass in board.children:
            for subject in klass.children:
                for chapter in subject.children:
                    hits = [(chapter, "unit")] + [(t, "topic") for t in chapter.children]
                    for entry, kind in hits:
                        key = (short, klass.name, subject.name, chapter.name, entry.name, kind)
                        if key not in wanted:
                            continue
                        source = entry.source or chapter.source or {}
                        url = str(source.get("url") or "")
                        digest = str(source.get("document_hash") or "")
                        read_on = str(source.get("fetched_at") or "")[:10]
                        if not url or digest in seen:
                            continue
                        record = Provenance(
                            document=f"{short} {klass.name} {subject.name}, {chapter.name}",
                            publisher=urllib.parse.urlsplit(url).hostname or "",
                            url=url,
                            sha256=digest,
                            read_on=read_on,
                            page=str(source.get("section") or ""),
                        )
                        if record.complete():
                            seen.add(digest)
                            out.append(record)
    return out


def is_live() -> bool:
    return (os.getenv("LLM_MODE") or "mock").strip().lower() == "live"


def write_words(core: dict[str, Any], topic: demand.Topic) -> dict[str, Any] | None:
    """The tiny tier writes the page from the core. ``None`` when keyless or over the ceiling."""
    if not is_live():
        return None
    from wobo_gateway import routing, spend
    from wobo_gateway.model_call import complete
    from wobo_gateway.routing import Tier
    from wobo_gateway.telemetry import record_cost

    # The cheapest lane to disappoint is the stranger's, and it starts to feel the day at its
    # degrade line. Copy for the blog is worth less than any learner's answer, so it stops there.
    if spend.verdict(spend.Priority.STRANGER) is not spend.Verdict.SERVE:
        return None
    model = routing.tier_model(Tier.TINY).provider_model
    brief = {
        "concept": topic.name,
        "subjects": topic.subjects,
        "core": {k: core.get(k) for k in ("idea", "why", "misconceptions", "check", "vocabulary")},
    }
    try:
        response = complete(
            model=model,
            messages=[
                {"role": "system", "content": WRITER_SYSTEM},
                {"role": "user", "content": json.dumps(brief, ensure_ascii=False)},
            ],
            fallbacks=list(routing.tier_fallbacks(Tier.TINY)) or None,
            max_tokens=WRITER_MAX_TOKENS,
            temperature=0.3,
            timeout=WRITER_TIMEOUT_S,
        )
    except Exception as exc:  # noqa: BLE001 — a writer that failed wrote nothing
        logger.warning("growth: the writer failed for %s (%s)", topic.slug, exc)
        return None
    record_cost(capability=CAPABILITY, model=model, response=response)
    text = response.choices[0].message.content or ""
    found = re.search(r"\{.*\}", text, re.S)
    try:
        data = json.loads(found.group(0)) if found else None
    except ValueError:
        data = None
    return data if isinstance(data, dict) else None


def _clean(text: Any) -> str:
    return re.sub(r"[ \t]+", " ", str(text or "")).strip()


def make(
    topic: demand.Topic,
    *,
    today: date | None = None,
    writer: Writer | None = None,
    tree: Any = None,
) -> Made:
    """One piece for one topic, or every reason there is not one yet."""
    owed: list[str] = []
    core = core_for(topic)
    if core is None:
        return Made(piece=None, owed=("no concept core is on file for this topic yet",))
    figure = figure_for(topic)
    if figure is None:
        owed.append("no drawn figure the verifier passed is on file for this topic")
    film = film_for(topic)
    if film is None:
        owed.append("no film for the Short")
    sources = provenance_for(topic, tree)
    if not sources:
        owed.append("no official document with a hash and a date is on file for this topic")
    if figure is None or not sources:
        # The gate refuses a piece with either missing, so the writer is not paid to find out.
        return Made(piece=None, owed=tuple(owed))
    words = (writer or write_words)(core, topic)
    if not words:
        owed.append("no writer ran: the gateway is keyless here, or the day's ceiling is spent")
        return Made(piece=None, owed=tuple(owed))
    sections = [
        Section(heading=_clean(s.get("heading")), body=str(s.get("body") or "").strip())
        for s in words.get("sections") or []
        if isinstance(s, dict)
    ]
    day = (today or datetime.now(UTC).date()).isoformat()
    made = Piece(
        slug=topic.slug,
        title=_clean(words.get("title")),
        summary=_clean(words.get("summary")),
        lead=_clean(words.get("lead")),
        sections=sections,
        provenance=sources,
        figure=figure,
        film=film,
        topic_slug=topic.slug,
        topic_name=topic.name,
        boards=topic.boards,
        drafted_on=day,
    )
    return Made(piece=made, owed=tuple(owed))


__all__ = [
    "CAPABILITY",
    "WRITER_SYSTEM",
    "Made",
    "core_for",
    "figure_for",
    "film_for",
    "is_live",
    "make",
    "provenance_for",
    "scope_of",
    "write_words",
]
