"""The list that stands where the door was — ``POST /v1/waiting-list`` and ``growth.waiting_list``.

``docs/DOORS-CLOSED.md`` §3. A visitor is asked for one thing, an email address, and optionally
their class and board, and is told plainly that Wobo is not open yet. Nothing else is asked,
nothing is promised beyond one mail, and no waiting number, queue position or invented scarcity
is ever shown.

Open, so it needs no account; screened for shape and abuse exactly as the public ask box is; and
de-duplicated on a one-way digest so the same address twice is one person, not two.

Under 13 the address is a parent's, and no child's address is stored. The endpoint holds that
structurally rather than by promising it: there is no date of birth, no name and no age anywhere
in the body it accepts, and an unknown field is refused rather than kept.
"""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import waiting_list
from wobo_gateway.app import create_app

PATH = "/v1/waiting-list"
_UA = {"User-Agent": "a browser under test"}

VENDOR = re.compile(
    r"\b(gemini|openai|anthropic|claude|gpt|litellm|supabase|railway|vercel|resend|google|"
    r"apple|microsoft|stripe|razorpay)\b",
    re.I,
)
PRONOUN = re.compile(r"\b(she|her|hers|herself|he|him|his|himself)\b", re.I)


@pytest.fixture
def store() -> waiting_list.WaitingListStore:
    made = waiting_list.InMemoryWaitingListStore()
    waiting_list.set_store(made)
    waiting_list.reset_meter()
    return made


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def _join(client: TestClient, **body: object) -> object:
    return client.post(PATH, json=body, headers=_UA)


# --- it takes an address, and only an address ----------------------------------------------------


def test_an_address_joins_the_list(
    store: waiting_list.WaitingListStore, client: TestClient
) -> None:
    answer = _join(client, email="Someone@Example.com")
    assert answer.status_code == 200
    assert answer.json()["code"] == "on_the_list"
    assert len(store.rows) == 1
    # Lower-cased on the way in, because two capitalisations of one address are one person.
    assert store.rows[0].email == "someone@example.com"


def test_the_class_and_the_board_are_optional_and_kept(
    store: waiting_list.WaitingListStore, client: TestClient
) -> None:
    """They are worth having: they say which boards to read first, which is the queue in
    docs/BOARD-COLD-START.md."""
    assert _join(client, email="a@example.com").status_code == 200
    assert store.rows[0].klass is None and store.rows[0].board is None
    second = _join(client, email="b@example.com", **{"class": "9", "board": "CBSE"})
    assert second.status_code == 200
    assert store.rows[1].klass == "9"
    assert store.rows[1].board == "CBSE"


def test_the_page_they_came_from_is_kept(
    store: waiting_list.WaitingListStore, client: TestClient
) -> None:
    assert _join(client, email="a@example.com", page="/cbse/class-9/maths").status_code == 200
    assert store.rows[0].source_path == "/cbse/class-9/maths"


@pytest.mark.parametrize(
    "value",
    ["", "   ", "not-an-address", "a@b", "a@.b.com", "a@b..com", "two@addresses@example.com",
     "someone@example.com, other@example.com", "a" * 400 + "@example.com"],
)
def test_anything_that_is_not_an_address_is_refused(
    store: waiting_list.WaitingListStore, client: TestClient, value: str
) -> None:
    answer = _join(client, email=value)
    assert answer.status_code == 422
    assert answer.json()["detail"]["code"] == "not_an_address"
    assert store.rows == []


def test_a_field_we_did_not_ask_for_is_refused(
    store: waiting_list.WaitingListStore, client: TestClient
) -> None:
    """Two fields at most, and the second is optional. There is nowhere in this door for a name,
    a date of birth or an age to land, so no child's details can arrive through it."""
    answer = _join(client, email="a@example.com", date_of_birth="2015-01-01")
    assert answer.status_code == 422
    assert store.rows == []


def test_a_class_or_board_that_is_not_one_is_dropped_not_stored(
    store: waiting_list.WaitingListStore, client: TestClient
) -> None:
    answer = _join(
        client, email="a@example.com", **{"class": "<script>x</script>", "board": "x" * 200}
    )
    assert answer.status_code == 200
    assert store.rows[0].klass is None
    assert store.rows[0].board is None


# --- de-duplication ------------------------------------------------------------------------------


def test_the_same_address_twice_is_one_row(
    store: waiting_list.WaitingListStore, client: TestClient
) -> None:
    assert _join(client, email="someone@example.com").status_code == 200
    assert _join(client, email="SOMEONE@example.com").status_code == 200
    assert len(store.rows) == 1


def test_a_repeat_is_answered_exactly_like_a_first_time(
    store: waiting_list.WaitingListStore, client: TestClient
) -> None:
    """The answer must not tell a stranger whether an address is already on the list. That is an
    enumeration oracle over other people's addresses, and it is free to build."""
    first = _join(client, email="someone@example.com").json()
    again = _join(client, email="someone@example.com").json()
    assert first == again


def test_the_digest_is_one_way(store: waiting_list.WaitingListStore, client: TestClient) -> None:
    _join(client, email="someone@example.com")
    row = store.rows[0]
    assert row.email_hash and row.email_hash != row.email
    assert "someone" not in row.email_hash
    assert row.email_hash == waiting_list.digest("someone@example.com")
    assert row.email_hash != waiting_list.digest("someone.else@example.com")


# --- the allowance -------------------------------------------------------------------------------


def test_one_browser_may_not_fill_the_list(
    store: waiting_list.WaitingListStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("WAITING_LIST_HOURLY_PER_CLIENT", "2")
    waiting_list.reset_meter()
    assert _join(client, email="a@example.com").status_code == 200
    assert _join(client, email="b@example.com").status_code == 200
    refused = _join(client, email="c@example.com")
    assert refused.status_code == 429
    assert refused.json()["detail"]["code"] == "enough_for_now"
    assert len(store.rows) == 2


def test_a_rotating_browser_still_meets_a_ceiling(
    store: waiting_list.WaitingListStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A bot that changes what it calls itself must still meet a limit that does not care."""
    monkeypatch.setenv("WAITING_LIST_DAILY_GLOBAL", "2")
    waiting_list.reset_meter()
    for i in range(2):
        assert client.post(
            PATH, json={"email": f"a{i}@example.com"}, headers={"User-Agent": f"browser {i}"}
        ).status_code == 200
    refused = client.post(
        PATH, json={"email": "z@example.com"}, headers={"User-Agent": "browser 9"}
    )
    assert refused.status_code == 429
    assert len(store.rows) == 2


def test_a_repeat_does_not_spend_the_allowance(
    store: waiting_list.WaitingListStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Somebody pressing the button twice because nothing seemed to happen has not abused
    anything, and must not be refused the third time they try a different address."""
    monkeypatch.setenv("WAITING_LIST_HOURLY_PER_CLIENT", "2")
    waiting_list.reset_meter()
    for _ in range(4):
        assert _join(client, email="a@example.com").status_code == 200
    assert _join(client, email="b@example.com").status_code == 200
    assert len(store.rows) == 2


# --- what it says --------------------------------------------------------------------------------


def test_the_answer_promises_only_what_is_true(
    store: waiting_list.WaitingListStore, client: TestClient
) -> None:
    line = _join(client, email="a@example.com").json()["message"]
    assert "!" not in line
    assert "—" not in line and "--" not in line
    assert not VENDOR.search(line)
    assert not PRONOUN.search(line)
    # No waiting number, no queue position, no invented scarcity (DOORS-CLOSED §3).
    assert not re.search(r"\b\d+(st|nd|rd|th)?\b", line)
    for word in ("queue", "position", "spot", "hurry", "limited", "soon"):
        assert word not in line.lower(), word


def test_nothing_in_the_answer_counts_the_list(
    store: waiting_list.WaitingListStore, client: TestClient
) -> None:
    """The console shows the size of the list. A visitor never does."""
    body = _join(client, email="a@example.com").json()
    assert set(body) == {"code", "message"}


# --- the store seam ------------------------------------------------------------------------------


def test_an_unconfigured_gateway_refuses_rather_than_dropping_an_address(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An address we said we had kept and did not is worse than an honest refusal."""
    monkeypatch.delenv("WAITING_LIST_STORE", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    waiting_list.set_store(None)
    waiting_list.reset_meter()
    answer = _join(client, email="a@example.com")
    assert answer.status_code == 503
    assert answer.json()["detail"]["code"] == "list_unavailable"


def test_the_list_needs_no_account(
    store: waiting_list.WaitingListStore, client: TestClient
) -> None:
    """It is the door 438 public pages open onto, and none of their visitors has a token."""
    assert PATH in waiting_list.OPEN_PATHS
    assert _join(client, email="a@example.com").status_code == 200
