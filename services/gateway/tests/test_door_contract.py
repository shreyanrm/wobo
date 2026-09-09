"""THE SEAM. The gateway's half of ``contracts/doors.json``, asserted against the real app.

Two suites were green while three contract breaks shipped: the web posted the list to a path the
gateway does not serve, sent a field the gateway forbids and a page name where the gateway wants a
path, and read the dial under a key the gateway never wrote. Each side tested itself against its
own mock and nothing anywhere asserted the two agreed.

So one file names the two addresses and the exact bodies that cross them, and BOTH suites read it
with their own real code: this one drives the routes the app actually serves, and
``apps/web-pwa/src/screens/site/door-contract.test.ts`` feeds the same bodies to the parser the
browser actually runs. A path or a key changed on one side alone now fails on both.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import doors, waiting_list
from wobo_gateway.app import create_app

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "doors.json"
_UA = {"User-Agent": "a browser under test"}


def contract() -> dict[str, Any]:
    return json.loads(CONTRACT.read_text())


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture
def list_store() -> waiting_list.WaitingListStore:
    made = waiting_list.InMemoryWaitingListStore()
    waiting_list.set_store(made)
    waiting_list.reset_meter()
    return made


def test_the_contract_file_is_where_both_suites_look() -> None:
    """A fixture nobody can find is a fixture nobody reads."""
    assert CONTRACT.is_file(), CONTRACT
    body = contract()
    assert set(body["dial"]) >= {"path", "body"}
    assert set(body["list"]) >= {"path", "body"}


# --- the dial ------------------------------------------------------------------------------------


def test_the_dial_is_served_at_the_address_the_web_asks(client: TestClient) -> None:
    dial = contract()["dial"]
    assert doors.DOORS_PATH == dial["path"]
    assert client.get(dial["path"]).status_code == 200


def test_the_dial_answers_under_the_key_the_web_reads(client: TestClient) -> None:
    """The break this test exists for: the gateway answered ``{"open": ...}`` and the browser read
    ``doors_open``, so the dial was a one-way valve. The owner could shut the door and could never
    reopen it, and it failed SILENTLY because closed is every failure."""
    dial = contract()["dial"]
    answer = client.get(dial["path"]).json()
    assert set(answer) == set(dial["body"]), answer
    for key in dial["body"]:
        assert isinstance(answer[key], bool), answer


# --- the list ------------------------------------------------------------------------------------


def test_the_list_is_served_at_the_address_the_web_posts_to(client: TestClient) -> None:
    """``/v1/list`` was a 404 on this app, and 438 pre-rendered files carried it."""
    assert waiting_list.PATH == contract()["list"]["path"]
    assert client.post(contract()["list"]["path"], json={}, headers=_UA).status_code != 404


def test_the_body_the_web_sends_is_the_body_this_door_takes(
    list_store: waiting_list.InMemoryWaitingListStore, client: TestClient
) -> None:
    """Every field, by the name the web writes it under, in the shape the web writes it in.

    ``JoinBody`` is ``extra="forbid"`` on purpose, so a field the web invented is a 422 and not a
    dropped value: this is the assertion that the two spellings are one spelling.
    """
    spec = contract()["list"]
    answer = client.post(spec["path"], json=spec["body"], headers=_UA)
    assert answer.status_code == 200, answer.text
    assert len(list_store.rows) == 1
    row = list_store.rows[0]
    assert row.email == spec["body"]["email"].lower()
    # Kept, not dropped: a class and a board the normalisers refused would leave both None here
    # while the request still answered 200, which is the silent half of the same failure.
    assert row.klass == spec["body"]["class"]
    assert row.board == spec["body"]["board"]
    assert row.source_path == spec["body"]["page"]
