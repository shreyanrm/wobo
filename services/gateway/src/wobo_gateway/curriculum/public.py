"""The syllabus, open to a visitor with no account — ``GET /v1/syllabus``.

Every public chapter page on the site is built from this one route (docs/GROWTH-SEARCH.md §3),
and the thing that makes those pages legitimate rather than spam is what this route carries with
every node: **the provenance**. The official document the syllabus was read from, the page or
section inside it, the hash of the bytes we read, when we read them, and the honest label from
:mod:`wobo_gateway.curriculum.labels` that says how well we know it. No competitor publishes any
of that, and a page that would carry none of it does not ship.

The shape of the door, and why each part of it is the way it is:

* **One path, four depths.** ``/v1/syllabus`` with no query is the boards we can publish; with
  ``board`` it is that board's classes; with ``class`` its subjects; with ``subject`` its
  chapters; with ``chapter`` its topics. One path rather than five keeps ``app._OPEN_PATHS`` an
  exact-match set, which is what makes "is this door open" a question with a literal answer.
* **Read only, and no learner anywhere.** Nothing here takes a subject, reads an overlay, reads a
  pin, or writes. A learner's own syllabus lives in the same table as the boards and is filtered
  out by :data:`PUBLISHABLE` and by ``framework.personal`` before anything is built, because this
  is the one door where a stranger could otherwise read one out.
* **Cached hard, in two places.** The tree is built once per process and held for
  ``SYLLABUS_TREE_TTL_S``; the answer carries a long ``Cache-Control`` and an ``ETag`` so a CDN
  and a browser both keep it. A syllabus changes when a version is published, which is rare.
* **Open is not free.** :data:`LIMITED_PATHS` puts the path on the door's stranger dial, per
  address, exactly like the public ask box.

The corpus the public ask box grounds on is built from the same tree (:func:`corpus_entries`), so
the tutor door at the bottom of a chapter page can answer about that chapter.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from wobo_gateway.curriculum import labels
from wobo_gateway.curriculum import store as store_mod
from wobo_gateway.curriculum.models import (
    Framework,
    NodeKind,
    Provenance,
    Status,
    Version,
    in_scope,
)

if TYPE_CHECKING:
    from wobo_gateway.curriculum.models import Node
    from wobo_gateway.curriculum.store import CurriculumStore

logger = logging.getLogger("wobo.gateway.syllabus")

#: The one open path. Listed in ``app._OPEN_PATHS`` so the door lets it through without a token.
OPEN_PATHS: frozenset[str] = frozenset({"/v1/syllabus"})
#: And bounded there too, on the stranger's dial: an open read of the whole curriculum is exactly
#: the door a crawler would hammer.
LIMITED_PATHS: frozenset[str] = OPEN_PATHS

#: What may be published. ``community`` is another learner's donation and ``personal`` is one
#: learner's own document: neither is ours to put on a public page, whatever it says inside.
#: This is the honest-count law at the level of a whole board (WOBO-TASKS §10.21).
PUBLISHABLE: frozenset[Status] = frozenset({Status.VERIFIED, Status.PROVISIONAL})

#: The layers that become pages. An objective is a sentence out of a syllabus document, not a
#: place a person navigates to, and it is never served.
_LAYERS: tuple[tuple[str, NodeKind], ...] = (
    ("class", NodeKind.LEVEL),
    ("subject", NodeKind.SUBJECT),
    ("chapter", NodeKind.UNIT),
    ("topic", NodeKind.TOPIC),
)
#: The query keys, in the order they nest. Each one needs the one above it.
_STEPS: tuple[str, ...] = ("board", "class", "subject", "chapter")


def _dial(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


# --- the lines a person reads ---------------------------------------------------------------------
NOT_HELD = "I do not have that syllabus. Ask me for a board, a class and a subject I do hold."
OUT_OF_ORDER = "Ask me for a board first, then a class, then a subject, then a chapter."
UNAVAILABLE = "I could not read the syllabus just now. Try once more in a moment."

#: Every line this module puts in front of a reader, for the copy gates in the tests.
PUBLIC_STRINGS: tuple[str, ...] = (NOT_HELD, OUT_OF_ORDER, UNAVAILABLE)


class NotHeld(Exception):
    """Nothing at that path. A real 404, because a crawler probing a typo must be told so."""


class OutOfOrder(Exception):
    """A deeper part named without the part above it."""


# =================================================================================================
# Slugs
# =================================================================================================

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    """A board's own words to a URL segment. Deterministic, so a page keeps its address."""
    folded = _SLUG_STRIP.sub("-", name.strip().lower()).strip("-")
    return folded[:80].strip("-") or "x"


def _unique(name: str, taken: set[str]) -> str:
    """Two chapters in one subject may share a name; two pages may not share an address."""
    base = slugify(name)
    slug, n = base, 1
    while slug in taken:
        n += 1
        slug = f"{base}-{n}"
    taken.add(slug)
    return slug


# =================================================================================================
# The tree
# =================================================================================================


@dataclass(frozen=True)
class Entry:
    """One node of the public tree: a board, a class, a subject, a chapter or a topic."""

    kind: str
    slug: str
    name: str
    source: dict[str, Any] | None = None
    children: tuple[Entry, ...] = ()
    #: What only this kind carries — a board's label, its edition, its official site.
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def publishable(self) -> bool:
        """Does this node clear the bar for a page of its own?

        The bar is the provenance: the official document and the hash of the bytes we read. A
        page that would carry none of it is a page with nothing on it a content farm does not
        already have, and it does not ship (docs/GROWTH-SEARCH.md §3). This door does not decide
        what the site builds; it says, per node, whether the evidence is there, so the page
        family's own quality gate has one field to read rather than a rule of its own.
        """
        source = self.source or {}
        return bool(source.get("url")) and bool(source.get("document_hash"))

    def row(self) -> dict[str, Any]:
        """This entry as one row in a parent's ``children`` list. Never its own children: a
        subject page lists its chapters, not the whole subtree under each of them."""
        return {
            "kind": self.kind,
            "slug": self.slug,
            "name": self.name,
            "source": self.source,
            "publishable": self.publishable,
            **self.meta,
        }


@dataclass(frozen=True)
class Tree:
    boards: tuple[Entry, ...]
    stamp: str
    built_at: float


def _source(record: Provenance | None, version: Version) -> dict[str, Any] | None:
    """What a reader may know about where a node came from.

    The extractor and the verifier stay inside the brain (WOBO-PLAN §17); everything else is the
    point of the page. A node with no record at all is served with ``None`` so the surface can
    say "no source on file" rather than imply one.
    """
    url = (record.source_url if record else None) or version.source_url
    doc_hash = (record.document_hash if record else None) or version.document_hash
    if record is None and not url and not doc_hash:
        return None
    return {
        "url": url,
        "section": record.source_page_or_section if record else None,
        "document_hash": doc_hash,
        "fetched_at": record.fetched_at if record else None,
        "checks_passed": list(record.checks_passed) if record else [],
        "verified_at": record.verified_at if record else None,
    }


def _short(framework: Framework) -> str:
    """What a person calls this board. The first alias is the acronym on the document."""
    for alias in framework.aliases:
        if alias and len(alias) <= 12:
            return alias
    return framework.name


def _publishable(framework: Framework, version: Version) -> bool:
    return (
        not framework.personal
        and framework.owner_subject is None
        and framework.status in PUBLISHABLE
        and version.status in PUBLISHABLE
    )


def _branch(
    kind: str,
    node: Node,
    slug: str,
    by_parent: dict[str | None, list[Node]],
    provenance: dict[str | None, Provenance],
    version: Version,
    depth: int,
) -> Entry:
    children: list[Entry] = []
    if depth + 1 < len(_LAYERS):
        child_kind, child_node_kind = _LAYERS[depth + 1]
        taken: set[str] = set()
        for child in by_parent.get(node.id, []):
            if child.kind is not child_node_kind:
                continue
            children.append(
                _branch(
                    child_kind,
                    child,
                    _unique(child.name, taken),
                    by_parent,
                    provenance,
                    version,
                    depth + 1,
                )
            )
    return Entry(
        kind=kind,
        slug=slug,
        name=node.name,
        source=_source(provenance.get(node.id), version),
        children=tuple(children),
    )


def _board(store: CurriculumStore, framework: Framework, version: Version) -> Entry | None:
    """One board's whole tree, or ``None`` when there is no syllabus under it to publish."""
    nodes = store.all_nodes(version.id)
    if not nodes:
        return None
    by_parent: dict[str | None, list[Node]] = {}
    for node in nodes:
        by_parent.setdefault(node.parent_id, []).append(node)
    provenance = {
        record.node_id: record for record in store.all_provenance(version.id) if record.node_id
    }
    classes: list[Entry] = []
    taken: set[str] = set()
    for node in by_parent.get(None, []):
        if node.kind is not NodeKind.LEVEL or not in_scope(node.name):
            continue
        classes.append(
            _branch("class", node, _unique(node.name, taken), by_parent, provenance, version, 0)
        )
    # A board with no chapter under any subject has nothing a page could carry.
    if not any(subject.children for klass in classes for subject in klass.children):
        return None
    return Entry(
        kind="board",
        slug=slugify(framework.id),
        name=framework.name,
        source=_source(None, version),
        children=tuple(classes),
        meta={
            "id": framework.id,
            "short": _short(framework),
            "label": labels.label_for(framework, version),
            "version": version.label,
            "status": version.status.value,
            "official_site": framework.official_site,
            "country": framework.country,
        },
    )


def build_tree(store: CurriculumStore | None = None) -> Tree:
    """Read the whole publishable curriculum out of the store, once."""
    store = store or store_mod.get_store()
    seen: set[str] = set()
    boards: list[Entry] = []
    marks: list[str] = []
    for version in store.all_versions():
        if version.framework_id in seen:
            continue  # all_versions is newest first: the first one we meet is the edition we serve
        seen.add(version.framework_id)
        framework = store.get_framework(version.framework_id)
        if framework is None or not _publishable(framework, version):
            continue
        entry = _board(store, framework, version)
        if entry is None:
            continue
        boards.append(entry)
        marks.append(f"{framework.id}|{version.id}|{version.published_at}|{version.document_hash}")
    boards.sort(key=lambda entry: entry.slug)
    stamp = hashlib.sha256("\n".join(sorted(marks)).encode()).hexdigest()[:16]
    logger.info(
        "syllabus: public tree built",
        extra={"fields": {"boards": len(boards), "stamp": stamp}},
    )
    return Tree(boards=tuple(boards), stamp=stamp, built_at=time.monotonic())


_tree: Tree | None = None
_tree_lock = threading.Lock()


def get_tree() -> Tree:
    """The process-wide tree, rebuilt when it has gone stale. A syllabus version is published
    rarely, so the default hold is long and the cost of a visitor is a dictionary lookup."""
    global _tree
    ttl = _dial("SYLLABUS_TREE_TTL_S", 900)
    with _tree_lock:
        if _tree is not None and (time.monotonic() - _tree.built_at) < ttl:
            return _tree
        _tree = build_tree()
        return _tree


def set_tree(tree: Tree | None) -> None:
    """Test seam: install a tree, or ``None`` to rebuild from the store on the next read."""
    global _tree
    with _tree_lock:
        _tree = tree


def reset() -> None:
    """Test seam — the tree and the corpus both forgotten."""
    set_tree(None)


# =================================================================================================
# The read
# =================================================================================================


def _find(entries: tuple[Entry, ...], slug: str) -> Entry:
    for entry in entries:
        if entry.slug == slug:
            return entry
    raise NotHeld(slug)


def read(
    *,
    board: str | None = None,
    level: str | None = None,
    subject: str | None = None,
    chapter: str | None = None,
    tree: Tree | None = None,
) -> dict[str, Any]:
    """One node of the tree, its children, and the provenance of both."""
    asked = {"board": board, "class": level, "subject": subject, "chapter": chapter}
    given = [step for step in _STEPS if asked[step]]
    # "subject=science" with no board names a page that cannot exist; so does a chapter with no
    # subject. Refusing is honest and it keeps the cache key a path rather than a guess.
    if given != list(_STEPS[: len(given)]):
        raise OutOfOrder(",".join(given))

    tree = tree or get_tree()
    if not given:
        return {
            "kind": "index",
            "path": {},
            "board": None,
            "label": None,
            "node": None,
            "source": None,
            "children": [entry.row() for entry in tree.boards],
        }

    entry = _find(tree.boards, str(board))
    board_entry = entry
    for step in _STEPS[1:]:
        value = asked[step]
        if not value:
            break
        entry = _find(entry.children, str(value))
    return {
        "kind": entry.kind,
        "path": {step: asked[step] for step in given},
        "board": {"slug": board_entry.slug, "name": board_entry.name, **board_entry.meta},
        "label": board_entry.meta.get("label"),
        "node": {
            "kind": entry.kind,
            "slug": entry.slug,
            "name": entry.name,
            "publishable": entry.publishable,
        },
        "source": entry.source,
        "children": [child.row() for child in entry.children],
    }


# =================================================================================================
# The corpus the public ask box grounds on
# =================================================================================================


@dataclass(frozen=True)
class CorpusEntry:
    """One chapter or topic, as something Wobo may answer from. Names and provenance only: the
    syllabus says what is taught, not what it says, and Wobo may not invent the difference."""

    slug: str
    title: str
    lead: str
    body: tuple[str, ...]


_MAX_LISTED = 24


def _listed(names: list[str]) -> str:
    if len(names) > _MAX_LISTED:
        names = names[:_MAX_LISTED]
    return ", ".join(names)


def corpus_entries(tree: Tree | None = None) -> list[CorpusEntry]:
    """Every chapter and every topic we publish, as grounding for the public ask box.

    No link, no address and no page number goes in here: this text is handed to a model, and a
    reply carrying one is a reply the outbound screen refuses. The page carries the source; the
    corpus carries the fact that there is one.
    """
    tree = tree or get_tree()
    out: list[CorpusEntry] = []
    for board in tree.boards:
        short = str(board.meta.get("short") or board.name)
        edition = str(board.meta.get("version") or "")
        for klass in board.children:
            for subject in klass.children:
                for chapter in subject.children:
                    base = f"syllabus/{board.slug}/{klass.slug}/{subject.slug}/{chapter.slug}"
                    body: list[str] = []
                    if chapter.children:
                        topics = _listed([topic.name for topic in chapter.children])
                        body.append(f"It covers {topics}.")
                    fetched = _fetched(chapter.source)
                    if fetched:
                        body.append(
                            f"I read this from the official {short} document for {edition}, "
                            f"on {fetched}."
                        )
                    out.append(
                        CorpusEntry(
                            slug=base,
                            title=chapter.name,
                            lead=(
                                f"{chapter.name} is a chapter in {subject.name} for "
                                f"{klass.name} under {short}."
                            ),
                            body=tuple(body),
                        )
                    )
                    for topic in chapter.children:
                        out.append(
                            CorpusEntry(
                                slug=f"{base}/{topic.slug}",
                                title=topic.name,
                                lead=(
                                    f"{topic.name} is a topic in the {chapter.name} chapter of "
                                    f"{subject.name} for {klass.name} under {short}."
                                ),
                                body=(),
                            )
                        )
    return out


def _fetched(source: dict[str, Any] | None) -> str | None:
    """The date, without the clock. A time of day is noise in a sentence a person reads."""
    stamp = (source or {}).get("fetched_at")
    if not isinstance(stamp, str) or len(stamp) < 10:
        return None
    return stamp[:10]


# =================================================================================================
# The route
# =================================================================================================


def _cache_control() -> str:
    return (
        f"public, max-age={_dial('SYLLABUS_MAX_AGE_S', 3600)}, "
        f"s-maxage={_dial('SYLLABUS_S_MAXAGE_S', 86400)}, "
        f"stale-while-revalidate={_dial('SYLLABUS_STALE_S', 604800)}"
    )


def _etag(stamp: str, body: dict[str, Any]) -> str:
    payload = json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)
    return '"' + hashlib.sha256(f"{stamp}\x00{payload}".encode()).hexdigest()[:24] + '"'


def _refusal(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "message": message})


def register_public_syllabus(app: FastAPI) -> None:
    """Mount the one open read. The tree is built on the first visitor, not at boot: a store that
    is briefly unreachable must not be a service that will not start."""

    @app.get("/v1/syllabus")
    def syllabus(
        request: Request,
        board: str | None = None,
        subject: str | None = None,
        chapter: str | None = None,
    ) -> Response:
        # "class" is a keyword, so it cannot be a parameter name; it is read off the query.
        level = request.query_params.get("class")
        try:
            # ONE tree for the body and for the tag over it. Reading it twice would let a rebuild
            # land between them and stamp an answer with an edition it did not come from.
            tree = get_tree()
            body = read(board=board, level=level, subject=subject, chapter=chapter, tree=tree)
        except OutOfOrder:
            return _refusal(400, "out_of_order", OUT_OF_ORDER)
        except NotHeld:
            return _refusal(404, "unknown_syllabus", NOT_HELD)
        except Exception:
            logger.exception("syllabus: the public read failed")
            return _refusal(503, "syllabus_unavailable", UNAVAILABLE)

        etag = _etag(tree.stamp, body)
        headers = {"Cache-Control": _cache_control(), "ETag": etag}
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)
        return JSONResponse(status_code=200, content=body, headers=headers)


__all__ = [
    "LIMITED_PATHS",
    "OPEN_PATHS",
    "PUBLIC_STRINGS",
    "PUBLISHABLE",
    "CorpusEntry",
    "Entry",
    "NotHeld",
    "OutOfOrder",
    "Tree",
    "build_tree",
    "corpus_entries",
    "get_tree",
    "read",
    "register_public_syllabus",
    "reset",
    "set_tree",
    "slugify",
]
