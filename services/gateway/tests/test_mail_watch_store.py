"""The watch's store: memory for the suite, ``ops.mail_watch`` (migration 0036) for production.

Two properties matter more than any other:

* **A suppression is forever.** The instance primes every suppression the table holds, however
  old, and everything else for the last forty days. A deploy must never make a complainer
  reachable again.
* **The table cannot be written twice for one fact.** Every row carries a unique key, and the
  write asks PostgREST to ignore a duplicate, so a retried webhook and a second cron pass are
  harmless in the table as well as in memory.

And the one that keeps the product up: a table that cannot be reached is a warning and an
honest "unreadable" on the desk, never an exception into a send.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from wobo_gateway.mailwatch import store

NOW = datetime(2026, 9, 16, 9, 0, tzinfo=UTC)
DIGEST = "ab" * 8


class Wire:
    def __init__(self, rows: list[dict[str, Any]] | None = None, fail: bool = False) -> None:
        self.rows = rows or []
        self.fail = fail
        self.calls: list[dict[str, Any]] = []

    def __call__(
        self, url: str, key: str, method: str, *, body: Any = None, prefer: str = ""
    ) -> Any:
        self.calls.append({"url": url, "method": method, "body": body, "prefer": prefer})
        if self.fail:
            raise OSError("the project is unreachable")
        if method == "GET":
            query = parse_qs(urlsplit(url).query)
            what = query.get("what", [""])[0]
            if what == "eq.suppression":
                return [r for r in self.rows if r["what"] == "suppression"]
            return [r for r in self.rows if r["what"] != "suppression"]
        return []


def a_row(what: str, key: str, at: datetime, **kw: Any) -> dict[str, Any]:
    return {
        "what": what,
        "key": key,
        "happened_at": at.isoformat(),
        "kind": kw.get("kind", ""),
        "event": kw.get("event", ""),
        "to_hash": kw.get("to_hash"),
        "detail": kw.get("detail", {}),
    }


def test_the_suite_gets_memory_and_production_gets_the_table(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MAIL_WATCH_STORE", "memory")
    assert type(store.build_store()) is store.WatchStore
    monkeypatch.delenv("MAIL_WATCH_STORE")
    monkeypatch.setenv("SUPABASE_URL", "https://project.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-not-a-real-one")
    monkeypatch.setattr(store, "_rest", Wire())
    assert isinstance(store.build_store(), store.DatabaseWatchStore)


def test_an_old_suppression_is_primed_and_so_is_the_recent_rest() -> None:
    long_ago = NOW - timedelta(days=400)
    wire = Wire(
        [
            a_row(
                "suppression", f"suppression:{DIGEST}", long_ago, to_hash=DIGEST, event="complained"
            ),
            a_row(
                "delivery", "delivery:m1", NOW, kind="welcome", event="delivered", to_hash="cd" * 8
            ),
        ]
    )
    db = store.DatabaseWatchStore("https://project.example", "k", request=wire, now=NOW)
    assert db.readable is True
    assert db.is_suppressed(DIGEST)
    assert [r.kind for r in db.rows(store.DELIVERY)] == ["welcome"]
    gets = [urlsplit(c["url"]) for c in wire.calls if c["method"] == "GET"]
    assert all(g.path.endswith("/rest/v1/mail_watch") for g in gets)
    windowed = [parse_qs(g.query) for g in gets if "happened_at" in parse_qs(g.query)]
    assert windowed and windowed[0]["happened_at"][0].startswith("gte.")


def test_a_write_goes_through_once_and_ignores_a_duplicate() -> None:
    wire = Wire()
    db = store.DatabaseWatchStore("https://project.example", "k", request=wire, now=NOW)
    row = store.WatchRow(
        store.DELIVERY, "delivery:m9", NOW, kind="streak", event="delivered", to_hash=DIGEST
    )
    assert db.add(row) is True
    assert db.add(row) is False
    posts = [c for c in wire.calls if c["method"] == "POST"]
    assert len(posts) == 1
    assert "on_conflict=key" in posts[0]["url"]
    assert "resolution=ignore-duplicates" in posts[0]["prefer"]
    sent = posts[0]["body"][0]
    assert set(sent) == set(store.COLUMNS)
    assert sent["to_hash"] == DIGEST


def test_an_unreachable_table_is_unreadable_and_never_an_exception() -> None:
    wire = Wire(fail=True)
    db = store.DatabaseWatchStore("https://project.example", "k", request=wire, now=NOW)
    assert db.readable is False
    assert db.add(store.WatchRow(store.ALERT, "alert:x", NOW, event="x")) is True
    assert db.is_suppressed(DIGEST) is False


def test_a_suppression_without_a_digest_is_refused() -> None:
    memory = store.WatchStore()
    assert memory.suppress("", reason="complained", kind="welcome", at=NOW) is False
    assert (
        memory.suppress("not-a-digest@example.test", reason="complained", kind="", at=NOW) is False
    )
    assert memory.suppressed_count() == 0
