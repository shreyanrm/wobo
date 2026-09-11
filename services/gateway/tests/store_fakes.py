"""A PostgREST that lives in a dict, for the content stores.

WHY A FAKE AND NOT A MOCK. The stores' whole value is a behaviour across TIME — a row written
before a deploy is readable after one — and a mock that returns a canned row cannot express that.
This keeps its rows in a plain dict that outlives whatever the test does to the container's disk,
which is exactly the property under test.

It implements the four requests ``plexus/db.py`` actually makes and nothing else, and it enforces
the three schema rules the gateway depends on rather than assuming them:

* the live pointer — one row per key that is neither superseded nor rejected (409 otherwise);
* the supersession stamp — an insert naming ``supersedes`` retires the row it names, unless the
  new row is itself rejected;
* the serve counter — bumped in the database, never read-then-written by the caller.

It is deliberately NOT a Postgres. It cannot prove a grant, a policy or the arithmetic of a view;
``test_content_stores_schema.py`` says so at length and lists what must be checked against a real
branch instead.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import uuid
from typing import Any

LIVE = ("provisional", "canonical")


class FakePostgrest:
    """The rows, and the latency of asking for them."""

    def __init__(self, *, latency_s: float = 0.0) -> None:
        #: store name -> list of rows, oldest first. A list and not a dict keyed by id, because
        #: superseded rows stay and the order they were written in is part of the record.
        self.rows: dict[str, list[dict[str, Any]]] = {}
        #: Every request, so a test can assert what did and did not reach the wire.
        self.calls: list[tuple[str, str]] = []
        #: What one round trip costs. Tens of milliseconds is what a real one costs, and the
        #: timing test is about the DIFFERENCE between that and a file read.
        self.latency_s = latency_s

    # -- the transport plexus.db calls
    def __call__(
        self, method: str, url: str, headers: dict[str, str], body: bytes | None
    ) -> tuple[int, Any]:
        assert headers.get("Accept-Profile") == "content", headers
        if self.latency_s:
            time.sleep(self.latency_s)
        path, _, query = url.partition("?")
        self.calls.append((method, path))
        parsed = json.loads(body.decode()) if body else None
        if path.endswith("/rpc/note_serves"):
            return self._note_serves(parsed)
        table = path.rsplit("/", 1)[-1]
        if method == "GET" and table == "store_savings":
            return 200, self._savings()
        if method == "GET":
            return 200, self._select(table, query)
        if method == "POST":
            return self._insert(table, parsed)
        raise AssertionError(f"the fake was asked for {method} {path}")

    # -- reads
    def _select(self, table: str, query: str) -> list[dict[str, Any]]:
        wanted = urllib.parse.parse_qs(query)
        key = (wanted.get("key") or [""])[0].removeprefix("eq.")
        found = [
            row
            for row in self.rows.get(table, [])
            if row.get("key") == key
            and row.get("status") in LIVE
            and row.get("superseded_by") is None
        ]
        # canonical before provisional, newest first — the order db.read asks for.
        found.sort(key=lambda r: (r.get("status") != "canonical", -r["_seq"]))
        return found[:1]

    def _savings(self) -> list[dict[str, Any]]:
        out = []
        for store, rows in sorted(self.rows.items()):
            priced = [r for r in rows if r.get("cost_usd") is not None]
            out.append(
                {
                    "store": store,
                    "rows_held": len(rows),
                    "rows_unpriced": len(rows) - len(priced),
                    "serves": sum(r.get("served_count", 0) for r in rows),
                    "saved_usd": sum(
                        max(r.get("served_count", 0) - 1, 0) * float(r["cost_usd"])
                        for r in priced
                    ),
                }
            )
        return out

    # -- writes
    def _insert(self, table: str, rows: Any) -> tuple[int, Any]:
        assert isinstance(rows, list) and len(rows) == 1, rows
        row = dict(rows[0])
        held = self.rows.setdefault(table, [])
        status = row.get("status") or "provisional"
        row["id"] = str(uuid.uuid4())

        # The BEFORE INSERT supersession trigger, and it runs before the unique index below for
        # the same reason it does in Postgres: a successor arriving while its predecessor is still
        # live would otherwise be a unique violation, and a regeneration could never be stored.
        # A rejected row stamps nothing — a loser does not retire the winner — and does not need
        # the key freed, because it never holds the live pointer.
        target = row.get("supersedes")
        if target and status in LIVE:
            for other in held:
                if other["id"] == target and other.get("superseded_by") is None:
                    other["superseded_by"] = row["id"]
                    other["status"] = "superseded"

        # The partial unique index. The loser of a race gets this, reads the winner's row and
        # serves it.
        if status in LIVE and any(
            r.get("key") == row.get("key")
            and r.get("status") in LIVE
            and r.get("superseded_by") is None
            for r in held
        ):
            return 409, "duplicate key value violates unique constraint"

        row.setdefault("status", status)
        row.setdefault("served_count", 0)
        row.setdefault("cost_usd", None)
        row["superseded_by"] = None
        row["_seq"] = len(held)
        held.append(row)
        return 201, [row]

    def _note_serves(self, body: Any) -> tuple[int, Any]:
        store = body["p_store"]
        counts = dict(zip(body["p_ids"], body["p_counts"], strict=True))
        touched = 0
        for row in self.rows.get(store, []):
            if row["id"] in counts:
                row["served_count"] = row.get("served_count", 0) + counts[row["id"]]
                touched += 1
        return 200, touched

    # -- what a test asks it
    def live(self, store: str, key: str) -> dict[str, Any] | None:
        found = self._select(store, urllib.parse.urlencode({"key": f"eq.{key}"}))
        return found[0] if found else None

    def all_rows(self, store: str) -> list[dict[str, Any]]:
        return list(self.rows.get(store, []))
