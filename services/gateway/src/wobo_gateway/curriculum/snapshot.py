"""The public syllabus tree, frozen to one JSON file the website can be BUILT from.

``curriculum/public.py`` opens the door a visitor's browser reads (``GET /v1/syllabus``). This
module writes the same tree to a file, and the reason is the build rather than the browser.

The site pre-renders one real HTML file per public address by rendering the real app in a real
browser (``apps/web-pwa/scripts/prerender.ts``), and the sitemap is generated from the same route
table. If the 1,111 syllabus pages read their content over the network, then the build of a static
site depends on a live service being up and answering 1,111 times, and a gateway that is briefly
unreachable becomes a site that ships 1,111 empty pages. It also means the count we publish is
whatever the network happened to return, which is exactly what the honest-count law forbids
(WOBO-TASKS §10.21).

So the tree is frozen here, from the committed seed under ``content/curriculum/``, through
:func:`public.build_tree` — the same function the open door uses, so the file and the door can
never describe different syllabi. ``tests/test_syllabus_snapshot.py`` re-derives it from the seed
and fails if the committed file has drifted, which makes the file a checked artefact rather than a
copy somebody has to remember to update.

Run: ``uv run python -m wobo_gateway.curriculum.snapshot`` (writes the default path below).

**Shape.** Sources are interned and the lists of check names are interned again inside them,
because 1,044 nodes carry 635 distinct provenance records which between them name only a handful
of distinct check lists. Written out flat the file is several megabytes of repeated strings; with
both tables it is a file a browser can be handed. Nothing is summarised or rounded on the way: every
node keeps its own name, its own address and its own provenance.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from wobo_gateway.curriculum import public
from wobo_gateway.curriculum.public import Entry, Tree

#: Where the website reads it. One file, committed, imported by the syllabus page family.
DEFAULT_OUT = (
    Path(__file__).resolve().parents[5]
    / "apps"
    / "web-pwa"
    / "src"
    / "screens"
    / "syllabus"
    / "syllabus.json"
)

#: Bumped when the SHAPE below changes, so a website built against an older shape says so loudly
#: rather than rendering a page with holes in it.
SHAPE = 1


class _Pool:
    """An intern table: the same value written once, referred to by index everywhere after."""

    def __init__(self) -> None:
        self.values: list[Any] = []
        self._index: dict[str, int] = {}

    def put(self, value: Any) -> int:
        key = json.dumps(value, sort_keys=True, separators=(",", ":"))
        found = self._index.get(key)
        if found is not None:
            return found
        self._index[key] = len(self.values)
        self.values.append(value)
        return len(self.values) - 1


def _source(pool: _Pool, checks: _Pool, entry: Entry) -> int | None:
    """This node's provenance, interned. ``None`` where there is no record at all, which the page
    family reads as "no source on file" rather than as a source it may imply."""
    record = entry.source
    if not record:
        return None
    named = [str(name) for name in record.get("checks_passed") or []]
    return pool.put(
        {
            "url": record.get("url") or None,
            "section": record.get("section") or None,
            "hash": record.get("document_hash") or None,
            "fetched": record.get("fetched_at") or None,
            "verified": record.get("verified_at") or None,
            "checks": checks.put(named) if named else None,
        }
    )


def _node(pool: _Pool, checks: _Pool, entry: Entry, kids: str | None) -> dict[str, Any]:
    out: dict[str, Any] = {"slug": entry.slug, "name": entry.name}
    source = _source(pool, checks, entry)
    if source is not None:
        out["src"] = source
    if kids:
        out[kids] = [
            _node(pool, checks, child, _CHILDREN.get(child.kind)) for child in entry.children
        ]
    return out


#: What each layer calls the layer under it, in the file.
_CHILDREN: dict[str, str] = {
    "board": "classes",
    "class": "subjects",
    "subject": "chapters",
    "chapter": "topics",
}


def snapshot(tree: Tree | None = None) -> dict[str, Any]:
    """The whole publishable tree as one plain dictionary, ready to be written."""
    tree = tree or public.build_tree()
    pool, checks = _Pool(), _Pool()
    boards: list[dict[str, Any]] = []
    for board in tree.boards:
        node = _node(pool, checks, board, "classes")
        meta = board.meta
        node.update(
            {
                "id": meta.get("id"),
                "short": meta.get("short"),
                "label": meta.get("label"),
                "edition": meta.get("version"),
                "status": meta.get("status"),
                "site": meta.get("official_site"),
                "country": meta.get("country"),
            }
        )
        boards.append(node)
    return {
        "shape": SHAPE,
        "stamp": tree.stamp,
        "checks": checks.values,
        "sources": pool.values,
        "boards": boards,
    }


def counts(data: dict[str, Any]) -> dict[str, int]:
    """What the file holds, layer by layer. The number the site is allowed to publish."""
    out = {"boards": 0, "classes": 0, "subjects": 0, "chapters": 0, "topics": 0}
    for board in data.get("boards") or []:
        out["boards"] += 1
        for klass in board.get("classes") or []:
            out["classes"] += 1
            for subject in klass.get("subjects") or []:
                out["subjects"] += 1
                for chapter in subject.get("chapters") or []:
                    out["chapters"] += 1
                    out["topics"] += len(chapter.get("topics") or [])
    return out


def render(data: dict[str, Any]) -> str:
    """The file's bytes. Stable key order and one trailing newline, so a run that changed nothing
    produces a file that changed nothing and the diff is only ever the syllabus moving."""
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"


def write(out: Path | None = None, tree: Tree | None = None) -> Path:
    path = out or DEFAULT_OUT
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render(snapshot(tree)), encoding="utf-8")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Freeze the public syllabus tree for the website.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)
    path = write(args.out)
    data = json.loads(path.read_text(encoding="utf-8"))
    tally = counts(data)
    size = path.stat().st_size
    print(f"syllabus snapshot: {path}")
    print("  " + ", ".join(f"{key} {value}" for key, value in tally.items()))
    print(f"  sources {len(data['sources'])}, check lists {len(data['checks'])}, {size:,} bytes")
    return 0


if __name__ == "__main__":  # pragma: no cover - a command, not a code path
    raise SystemExit(main())
