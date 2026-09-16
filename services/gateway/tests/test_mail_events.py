"""What a person did next: the click and the unsubscribe, recorded where the desk can read them.

``ops.mail_log`` (migration 0032) has carried five event kinds since the day it was written, and
:meth:`DatabaseMailLog.note_event` has been able to write three of them. Nothing ever called it.
So the mail desk's three most useful columns — clicks, unsubscribes, and which kind earned them —
were guaranteed to read zero for ever, and the law's "clicks are measured on our side at the
deep-link landing" was true of the schema and false of the product.

Two facts this file pins:

* **A press of a mail's button is a click, and it lands in the log.** Measured at our own landing
  route, never by a redirect and never by a pixel: the law forbids both, and children's mail must
  carry neither.
* **An unsubscribe honoured is an event too.** It is the one number that decides whether a kind
  stays switched on, and a stop that changed a dial but left no trace would make that decision
  guesswork.

Neither may ever break the thing it observes. A log that cannot be written is a warning, never an
exception into a reader's press: the click already happened and the dial is already flipped, and
losing the record of either must not also lose the thing itself.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import email as email_mod
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.email import MailLog
from wobo_gateway.hospitality import links
from wobo_gateway.hospitality import preferences as prefs_mod
from wobo_gateway.hospitality.preferences import InMemoryPreferencesStore
from wobo_gateway.hospitality.tokens import stop_token
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

NOW = datetime(2026, 9, 16, 9, 0, tzinfo=UTC)
COURSE, CARD = "m2-1", "scale"


@pytest.fixture(autouse=True)
def _fresh(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "a-test-secret")
    monkeypatch.setenv("APP_URL", "https://heywobo.com")
    monkeypatch.setenv("MAIL_PREFERENCES_STORE", "memory")
    links.reset_redemptions()
    prefs_mod.set_store(InMemoryPreferencesStore())
    log = MailLog()
    email_mod.set_mail_log(log)
    yield log
    email_mod.reset_mail_log()
    prefs_mod.set_store(None)
    links.reset_redemptions()


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


# --- the click ---------------------------------------------------------------------------------
def test_a_pressed_mail_button_is_recorded_as_a_click(
    client: TestClient, _fresh: MailLog
) -> None:
    token = links.card_token("learner-1", COURSE, CARD, issued=NOW)
    assert token
    assert client.post("/v1/mail/land", json={"token": token}).status_code == 200

    events = _fresh.events()
    assert [e["event"] for e in events] == ["click"]
    assert events[0]["detail"]["path"] == f"/course/{COURSE}/card/{CARD}"
    # Never an address, and never the token: the row says a click happened, and no more.
    assert "a-test-secret" not in str(events[0])
    assert token not in str(events[0])


def test_the_second_press_of_one_link_is_a_second_click(
    client: TestClient, _fresh: MailLog
) -> None:
    """Two presses on one mail are two facts, not a duplicate, so neither carries a key."""
    token = links.card_token("learner-1", COURSE, CARD, issued=NOW)
    for _ in range(2):
        client.post("/v1/mail/land", json={"token": token})
    events = _fresh.events()
    assert len(events) == 2
    assert all(e.get("key") is None for e in events)


def test_a_link_that_is_not_ours_records_nothing(client: TestClient, _fresh: MailLog) -> None:
    """A forged or expired link is not a click; it is somebody knocking."""
    assert client.post("/v1/mail/land", json={"token": "not-a-token"}).status_code == 400
    assert _fresh.events() == []


def test_a_scanner_opening_the_link_is_not_a_click(client: TestClient, _fresh: MailLog) -> None:
    """A GET spends nothing and means nothing: every mail-security scanner opens every URL in a
    mail before a person ever sees it, and counting that as a person would make the one number we
    do measure a lie."""
    token = links.card_token("learner-1", COURSE, CARD, issued=NOW)
    client.get("/v1/mail/land", params={"token": token})
    assert _fresh.events() == []


# --- the unsubscribe ---------------------------------------------------------------------------
def test_an_unsubscribe_honoured_is_recorded_against_its_kind(
    client: TestClient, _fresh: MailLog
) -> None:
    token = stop_token("learner-1", "streak", issued=NOW)
    assert token
    assert client.post("/v1/mail/stop", params={"token": token}).status_code == 200

    events = _fresh.events()
    assert [e["event"] for e in events] == ["unsubscribe"]
    # The kind is the whole point: a kind nobody stays subscribed to is switched off by the
    # superadmin reading this column, not by a guess.
    assert events[0]["kind"] == "streak"


def test_the_one_click_post_from_a_mail_client_is_recorded_too(
    client: TestClient, _fresh: MailLog
) -> None:
    """Gmail and Yahoo POST the List-Unsubscribe target themselves. That is an unsubscribe."""
    token = stop_token("learner-1", "quick_one", issued=NOW)
    client.post("/v1/mail/stop", data={"token": token})
    assert [e["event"] for e in _fresh.events()] == ["unsubscribe"]


def test_merely_looking_at_the_stop_page_unsubscribes_nothing_and_records_nothing(
    client: TestClient, _fresh: MailLog
) -> None:
    token = stop_token("learner-1", "streak", issued=NOW)
    assert client.get("/v1/mail/stop", params={"token": token}).status_code == 200
    assert _fresh.events() == []


# --- neither may break what it observes ---------------------------------------------------------
def test_a_log_that_cannot_be_written_never_breaks_the_press(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Broken(MailLog):
        def note_event(self, *a: Any, **k: Any) -> None:
            raise OSError("the log is gone")

    email_mod.set_mail_log(Broken())
    token = links.card_token("learner-1", COURSE, CARD, issued=NOW)
    assert client.post("/v1/mail/land", json={"token": token}).status_code == 200
    stop = stop_token("learner-1", "streak", issued=NOW)
    assert client.post("/v1/mail/stop", params={"token": stop}).status_code == 200


# --- the base log can hold an event at all -------------------------------------------------------
def test_the_file_backed_log_holds_events_beside_its_sends(tmp_path: Any) -> None:
    """The suite and a local run use the file log, so events have to live there too — otherwise
    every test of the desk would be a test of a class the product does not use."""
    path = tmp_path / "mail.jsonl"
    log = MailLog(path)
    log.note_event("click", kind="doubt", to="a@example.test", at=NOW, detail={"path": "/x"})
    assert [e["event"] for e in log.events()] == ["click"]
    # It survives a restart, which is the entire reason the log moved out of memory.
    assert [e["kind"] for e in MailLog(path).events()] == ["doubt"]
