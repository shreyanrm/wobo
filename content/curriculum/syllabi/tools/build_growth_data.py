"""Compile the two data files the public growth pages are built from.

The growth pages (``apps/web-pwa/src/screens/growth``) are the page families that answer a search
a stranger types: the glossary, board-agnostic, one page per concept; and the exam-cycle pages,
one per board. Both are allowed to exist for exactly one reason — **we can say where every line
came from** — so both are compiled from ``content/curriculum/syllabi/**``, which is the only place
in this repo that holds an official document, the page it was read off, the hash of the bytes and
the moment they were fetched.

Nothing here invents, infers or rounds. A field that is not in the seed is not in the output, and
a board whose seed carries no chapters produces nothing at all.

Two files come out, both committed, both read at build time by the pages:

``glossary.json``   one entry per concept the seed teaches in more than one place, with every
                    placement, the board's own objectives for it, and the document behind each.
``boards.json``     one entry per board that has chapters, with every official document we have
                    read for it, and what we have and have not checked.

Run it from the repo root, then format what it wrote, because the repo formats committed JSON and
``json.dumps`` does not collapse a one-item array the way the formatter does:

    python3 content/curriculum/syllabi/tools/build_growth_data.py
    bunx biome format --write apps/web-pwa/src/screens/growth/data

``apps/web-pwa/src/screens/growth/data.test.ts`` re-runs it and fails if the
committed files have drifted from the syllabus they claim to describe.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
SYLLABI = ROOT / "content" / "curriculum" / "syllabi"
CONCEPTS = ROOT / "content" / "catalogs" / "concepts.json"
OUT = ROOT / "apps" / "web-pwa" / "src" / "screens" / "growth" / "data"


#: The registry's own derivation rule (``content/catalogs/concepts.json``, and
#: :func:`wobo_gateway.plexus.store.concept_id`): conceptId = slug(topic name). Mirrored here rather
#: than imported so this script runs with no gateway on the path; ``concepts.test.py`` upstream and
#: the shape of the registry file keep the two honest.
def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "concept"


#: How many of a board's own objective lines a glossary page may carry per placement. A syllabus is
#: someone else's document: we quote enough to be useful and link the rest.
MAX_OBJECTIVES = 3

#: A concept is a GLOSSARY page only when the seed teaches it in at least this many distinct places
#: (board + class + subject). One placement is a chapter page, not a glossary entry, and publishing
#: it twice under two addresses is the thin duplication the honest-count law exists to prevent.
MIN_PLACEMENTS = 2


def _short(board: str, name: str) -> str:
    """The name a person uses for a board. The seed's framework_name is the legal one."""
    return {
        "cbse": "CBSE",
        "nios": "NIOS",
        "icse": "ICSE",
        "isc": "ISC",
    }.get(board, name)


def _canonical_names() -> dict[str, str]:
    """slug -> the registry's canonical name, where the registry knows the concept."""
    try:
        data = json.loads(CONCEPTS.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    out: dict[str, str] = {}
    for key, value in (data.get("concepts") or {}).items():
        if isinstance(value, dict) and value.get("canonicalName"):
            out[str(key)] = str(value["canonicalName"])
    return out


def _files() -> list[dict[str, Any]]:
    return [json.loads(p.read_text()) for p in sorted(SYLLABI.glob("*/*.json"))]


def _doc_row(doc: dict[str, Any]) -> dict[str, Any]:
    """A document, reduced to what a page may print. `bytes` and the extractor stay internal."""
    row = {
        "id": doc["id"],
        "title": doc.get("title") or "",
        "publisher": doc.get("publisher") or "",
        "url": doc.get("url") or "",
        "pages": doc.get("pages"),
        "fetchedAt": doc.get("fetched_at") or "",
        "sha256": doc.get("document_sha256") or "",
    }
    return {k: v for k, v in row.items() if v not in (None, "")}


def build() -> tuple[dict[str, Any], dict[str, Any]]:
    files = _files()
    canonical = _canonical_names()

    # --- boards: only the ones whose seed actually carries chapters ------------------------------
    #
    # Every other framework in the seed (four state boards) was fetched to prove it exists and has
    # no chapter under it. A page for one of those would be a page with nothing on it, which is the
    # thing the honest-count law forbids, so they never reach either file.
    meta: dict[str, dict[str, Any]] = {}
    docs_by_board: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    used_docs: dict[str, set[str]] = defaultdict(set)
    subject_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    counts: dict[str, dict[str, int]] = defaultdict(lambda: {"chapters": 0, "topics": 0})

    for f in files:
        board = f["framework_id"]
        for doc in f.get("documents") or []:
            docs_by_board[board][doc["id"]] = doc
        units = f.get("units") or []
        if not units:
            continue
        meta.setdefault(
            board,
            {
                "id": board,
                "name": f["framework_name"],
                "short": _short(board, f["framework_name"]),
                "officialSite": f.get("official_site") or "",
                "version": f.get("version") or "",
            },
        )
        topics = sum(len(u.get("topics") or []) for u in units)
        counts[board]["chapters"] += len(units)
        counts[board]["topics"] += topics
        prov = f.get("provenance") or {}
        subject_rows[board].append(
            {
                "level": f.get("level") or "",
                "levelOrder": int(f.get("level_order") or 0),
                "subject": f["subject"],
                # The version's own status, per subject, never rolled up into one word for the
                # board. Ten of the twenty-three CBSE syllabi we hold have passed every check and
                # thirteen have not; a board-level "verified" would be a claim about the thirteen.
                "status": f.get("status") or "provisional",
                "chapters": len(units),
                "topics": topics,
                # The NAMES of the checks, never the seed's own status_reason: that field is an
                # engineer's note to an engineer, written in the extractor's vocabulary, and the
                # public page says in its own words what a failed check means.
                "checksPassed": len(prov.get("checks_passed") or []),
                "checksFailed": [str(c) for c in (prov.get("checks_failed") or [])],
                "documents": sorted(
                    {
                        (u.get("source_ref") or {}).get("document_id")
                        for u in units
                        if (u.get("source_ref") or {}).get("document_id")
                    }
                ),
            }
        )
        for unit in units:
            ref = unit.get("source_ref") or {}
            if ref.get("document_id"):
                used_docs[board].add(ref["document_id"])
            for topic in unit.get("topics") or []:
                tref = topic.get("source_ref") or {}
                if tref.get("document_id"):
                    used_docs[board].add(tref["document_id"])

    published = sorted(b for b in counts if counts[b]["chapters"])

    # One document table, shared by both files: the same PDF is cited by dozens of chapters and by
    # every concept inside them, and repeating its title, URL and hash per row tripled the bytes a
    # visitor downloads to read one glossary page.
    documents: dict[str, dict[str, Any]] = {}
    for board in published:
        for doc_id in sorted(used_docs[board]):
            doc = docs_by_board[board].get(doc_id)
            if not doc:
                continue
            row = _doc_row(doc)
            if row.get("url") and row.get("sha256") and row.get("fetchedAt"):
                documents[doc_id] = {**row, "board": board}

    out_boards = [
        {
            **meta[board],
            "chapters": counts[board]["chapters"],
            "topics": counts[board]["topics"],
            "verifiedSubjects": sum(1 for r in subject_rows[board] if r["status"] == "verified"),
            "subjects": sorted(
                (
                    {**r, "documents": [d for d in r["documents"] if d in documents]}
                    for r in subject_rows[board]
                ),
                key=lambda r: (r["levelOrder"], r["subject"]),
            ),
            "documents": [d for d in sorted(used_docs[board]) if d in documents],
        }
        for board in published
    ]

    # --- the glossary: every concept the seed teaches in more than one place ---------------------
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in files:
        board = f["framework_id"]
        if board not in published:
            continue

        def place(node: dict[str, Any], kind: str, unit_name: str | None, f=f, board=board) -> None:
            ref = node.get("source_ref") or {}
            doc_id = ref.get("document_id") or ""
            if doc_id not in documents:
                return
            objectives = [str(o).strip() for o in (node.get("objectives") or []) if str(o).strip()]
            groups[slug(node["name"])].append(
                {
                    "name": node["name"],
                    "kind": kind,
                    "board": board,
                    "level": f.get("level") or "",
                    "levelOrder": int(f.get("level_order") or 0),
                    "subject": f["subject"],
                    **({"unit": unit_name} if unit_name else {}),
                    **({"objectives": objectives[:MAX_OBJECTIVES]} if objectives else {}),
                    "doc": doc_id,
                    **({"page": ref["page"]} if ref.get("page") else {}),
                    **({"section": ref["section"]} if ref.get("section") else {}),
                }
            )

        for unit in f.get("units") or []:
            place(unit, "chapter", None)
            for topic in unit.get("topics") or []:
                place(topic, "topic", unit["name"])

    short = {b["id"]: b["short"] for b in out_boards}
    concepts = []
    for key in sorted(groups):
        places = groups[key]
        distinct = {(p["board"], p["level"], p["subject"]) for p in places}
        if len(distinct) < MIN_PLACEMENTS:
            continue
        # The name a reader sees: the registry's canonical spelling where it has one, else the
        # spelling the most boards used, with the alphabet breaking a tie so the build is stable.
        tally: dict[str, int] = defaultdict(int)
        for p in places:
            tally[p["name"]] += 1
        common = sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        concepts.append(
            {
                "slug": key,
                "name": canonical.get(key) or common,
                "subjects": sorted({p["subject"] for p in places}),
                "boards": sorted({short[p["board"]] for p in places}),
                "places": sorted(
                    places,
                    key=lambda p: (short[p["board"]], p["levelOrder"], p["subject"], p["name"]),
                ),
            }
        )

    note = (
        "Compiled from content/curriculum/syllabi by "
        "content/curriculum/syllabi/tools/build_growth_data.py. Do not edit by hand."
    )
    boards_index = {b["id"]: {"short": b["short"], "name": b["name"]} for b in out_boards}
    glossary = {
        "note": note,
        "minPlacements": MIN_PLACEMENTS,
        "boards": boards_index,
        "documents": documents,
        "concepts": concepts,
    }
    board_file = {"note": note, "documents": documents, "boards": out_boards}
    return glossary, board_file


def main() -> None:
    glossary, boards = build()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "glossary.json").write_text(json.dumps(glossary, indent=2, ensure_ascii=False) + "\n")
    (OUT / "boards.json").write_text(json.dumps(boards, indent=2, ensure_ascii=False) + "\n")
    print(f"glossary: {len(glossary['concepts'])} concepts")
    print(f"boards:   {len(boards['boards'])} boards")


if __name__ == "__main__":
    main()
