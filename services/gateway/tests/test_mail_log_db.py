"""The mail log in the database (migration 0032_mail_log.sql), and the mail desk that reads it.

No network: the PostgREST hop is one injected function, so every request is a value a test can
assert on. The file-backed log is still what the suite and a local run use.

The two ``build_mail_log`` tests read the class off the module at call time rather than the name
imported above: test_hardening.py reloads ``wobo_gateway.email`` to prove the env defaults yield,
and a reload rebinds every class in the module, so a name bound here at collection is the class
from BEFORE the reload and ``isinstance`` against it is false for a reason that has nothing to do
with which store was chosen.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from wobo_gateway import email as email_mod
from wobo_gateway.email import DatabaseMailLog, MailRecord, build_mail_log, to_hash

NOW = datetime(2026, 9, 11, 9, 0, tzinfo=UTC)


class FakeRest:
    """Every call recorded; reads answer from whatever rows the test put in."""

    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows or []
        self.calls: list[dict[str, Any]] = []

    def __call__(self, url: str, key: str, method: str, *, body: Any = None) -> Any:
        self.calls.append({"url": url, "method": method, "body": body})
        if method == "POST":
            for row in body or []:
                self.rows.append(row)
            return []
        return list(self.rows)


def a_record(**over: Any) -> MailRecord:
    base: dict[str, Any] = {
        "key": "quick_one:abc:L-1:p",
        "learner_id": "L-1",
        "kind": "quick_one",
        "to_hash": to_hash("a@example.test"),
        "period": "p",
        "sent_at": NOW.isoformat(),
        "provider_id": "id-1",
    }
    return MailRecord(**{**base, **over})


def test_a_send_is_written_through_to_the_table() -> None:
    rest = FakeRest()
    log = DatabaseMailLog("https://project.test", "service-key", request=rest)
    log.record(a_record())
    write = [c for c in rest.calls if c["method"] == "POST"][-1]
    assert "mail_log" in write["url"]
    row = write["body"][0]
    assert row["event"] == "sent" and row["kind"] == "quick_one"
    assert row["to_hash"] == to_hash("a@example.test")
    # Never an address, never a subject line, never a body.
    assert "a@example.test" not in str(row)


def test_a_would_send_is_written_as_held_not_as_sent() -> None:
    rest = FakeRest()
    log = DatabaseMailLog("https://project.test", "service-key", request=rest)
    log.record(a_record(provider_id="queued"))
    assert rest.calls[-1]["body"][0]["event"] == "queued"


def test_the_log_still_answers_from_memory_when_the_table_is_unreachable() -> None:
    def broken(*_a: Any, **_k: Any) -> Any:
        raise OSError("no route to the project")

    log = DatabaseMailLog("https://project.test", "service-key", request=broken)
    log.record(a_record())
    # The rule the inbox law needs still answers, and the send was not lost to an exception.
    assert log.seen("quick_one:abc:L-1:p") is not None
    assert log.latest_to("a@example.test") is not None


def test_it_primes_itself_from_the_table_so_a_redeploy_does_not_forget() -> None:
    rest = FakeRest(
        [
            {
                "key": "sunday_note:abc:L-1:2026-W37",
                "learner_id": "L-1",
                "kind": "sunday_note",
                "to_hash": to_hash("a@example.test"),
                "period": "2026-W37",
                "sent_at": (NOW - timedelta(hours=2)).isoformat(),
                "provider_id": "id-9",
                "event": "sent",
            }
        ]
    )
    log = DatabaseMailLog("https://project.test", "service-key", request=rest, now=NOW)
    assert log.seen("sunday_note:abc:L-1:2026-W37") is not None
    # Which is the whole point: the twenty-four-hour gap survives a deploy.
    assert log.latest_to("a@example.test") == NOW - timedelta(hours=2)


def test_the_file_is_what_a_test_and_a_local_run_use(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setenv("MAIL_LOG_STORE", "file")
    monkeypatch.setenv("MAIL_LOG_PATH", str(tmp_path / "mail.jsonl"))
    monkeypatch.setenv("SUPABASE_URL", "https://project.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    log = build_mail_log()
    assert not isinstance(log, email_mod.DatabaseMailLog)


def test_the_database_is_what_a_configured_deployment_uses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("MAIL_LOG_STORE", raising=False)
    monkeypatch.delenv("MAIL_LOG_PATH", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://project.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setattr(email_mod, "_rest", lambda *a, **k: [])
    assert isinstance(build_mail_log(), email_mod.DatabaseMailLog)


def test_a_click_and_an_unsubscribe_are_events_too() -> None:
    rest = FakeRest()
    log = DatabaseMailLog("https://project.test", "service-key", request=rest)
    log.note_event(
        "click",
        kind="quick_one",
        to="a@example.test",
        at=NOW,
        detail={"path": "/course/c/card/7"},
    )
    log.note_event("unsubscribe", kind="streak", to="a@example.test", at=NOW)
    events = [c["body"][0]["event"] for c in rest.calls if c["method"] == "POST"]
    assert events == ["click", "unsubscribe"]
    assert all(c["body"][0].get("key") is None for c in rest.calls if c["method"] == "POST")


# --- the daily cap ------------------------------------------------------------------------------
def test_the_cap_counts_only_what_left(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway.email import MailLog

    monkeypatch.setenv("MAIL_DAILY_CAP", "2")
    log = MailLog()
    email_mod.set_mail_log(log)
    try:
        log.record(a_record(key="k1", provider_id="console"))
        log.record(a_record(key="k2", provider_id="queued"))
        assert email_mod.over_the_daily_cap(at=NOW) is None
        log.record(a_record(key="k3", provider_id="id-a"))
        log.record(a_record(key="k4", provider_id="id-b"))
        assert email_mod.over_the_daily_cap(at=NOW) == "daily_cap"
        # Tomorrow is a new day's allowance.
        assert email_mod.over_the_daily_cap(at=NOW + timedelta(days=1)) is None
    finally:
        email_mod.reset_mail_log()


def test_the_cap_is_a_dial_with_a_warm_up_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MAIL_DAILY_CAP", raising=False)
    from wobo_gateway import doors

    store = doors.InMemorySettingsStore()
    doors.set_store(store)
    try:
        assert email_mod.daily_cap() == email_mod.DEFAULT_DAILY_CAP
        store.write(email_mod.DAILY_CAP_DIAL, 2500, actor=None, note=None)
        assert email_mod.daily_cap() == 2500
    finally:
        doors.set_store(None)


def test_a_kind_the_superadmin_switched_off_does_not_send(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway import doors

    store = doors.InMemorySettingsStore()
    store.write(email_mod.KINDS_OFF_DIAL, ["streak"], actor=None, note=None)
    doors.set_store(store)
    try:
        assert email_mod.kind_is_off("streak") is True
        assert email_mod.kind_is_off("quick_one") is False
    finally:
        doors.set_store(None)
