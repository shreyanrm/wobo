"""``POST /v1/mail/land`` — the route a pressed mail link is redeemed at.

The design (docs/EMAILS-AND-ANIMATIONS.md §4): *"The link is single-use for the sign-in part and
reusable for the destination."* The MINT lives in :mod:`wobo_gateway.hospitality.links` and is
tested there; this file holds the route that stands on it, and the two halves of that sentence as
a learner would meet them:

* press it: the card comes back, and this press may open the door,
* press the same link again (a forwarded mail, a second tap, a reload): the card still comes back,
  and no door is offered — a mail in a family group is a link to a lesson, never to somebody's
  account.

Plus the three ways a link is not a link (forged, expired, absent), and the one that matters more
than any of them: a GET never spends anything, because every mail-security scanner and link
prefetcher on the internet opens every URL in a mail before a person ever sees it.

No network and no mail: the token is arithmetic over a secret, and the ledger is in memory.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import app as app_mod
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.hospitality import links
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

LAND = "/v1/mail/land"
COURSE = "m2-1"
CARD = "scale"
PATH = f"/course/{COURSE}/card/{CARD}"
NOW = datetime(2026, 9, 11, 9, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _fresh(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "a-test-secret")
    monkeypatch.setenv("APP_URL", "https://heywobo.com")
    monkeypatch.delenv("MAIL_CARD_LINK_DAYS", raising=False)
    links.reset_redemptions()
    yield
    links.reset_redemptions()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def a_token(*, issued: datetime = NOW, card: str = CARD) -> str:
    token = links.card_token("learner-1", COURSE, card, issued=issued)
    assert token is not None
    return token


# --- the two halves --------------------------------------------------------------------------


def test_the_sign_in_is_spent_once_and_the_destination_is_not(client: TestClient) -> None:
    token = a_token()
    first = client.post(LAND, json={"token": token})
    assert first.status_code == 200
    assert first.json() == {"destination": PATH, "sign_in": True}

    for _ in range(2):
        again = client.post(LAND, json={"token": token})
        assert again.status_code == 200
        assert again.json() == {"destination": PATH, "sign_in": False}


def test_two_links_are_spent_apart(client: TestClient) -> None:
    one, two = a_token(), a_token(card="boss")
    assert client.post(LAND, json={"token": one}).json()["sign_in"] is True
    assert client.post(LAND, json={"token": two}).json() == {
        "destination": f"/course/{COURSE}/card/boss",
        "sign_in": True,
    }
    assert client.post(LAND, json={"token": one}).json()["sign_in"] is False


def test_the_destination_is_the_signature_and_not_the_address_the_link_wore(
    client: TestClient,
) -> None:
    """The app hands over a token, not a path, so a rewritten address cannot move the landing."""
    link = links.card_link("learner-1", COURSE, CARD, issued=NOW)
    assert link is not None and link.startswith(f"https://heywobo.com{PATH}?")
    token = links.token_of(link)
    assert client.post(LAND, json={"token": token}).json()["destination"] == PATH


# --- the ways a link is not a link -------------------------------------------------------------


def test_the_route_is_open_and_honest_about_a_link_that_is_not_live(client: TestClient) -> None:
    assert LAND in app_mod._OPEN_PATHS  # pressed from an inbox, by somebody with no session
    token = a_token()
    payload, sig = token.split(".")
    for body in (
        {},
        {"token": ""},
        {"token": "not-a-token"},
        {"token": f"{payload}.{'A' * len(sig)}"},  # our payload, somebody else's signature
        {"token": "x" * 4000},
    ):
        res = client.post(LAND, json=body)
        assert res.status_code == 400
        message = res.json()["detail"]["message"]
        # Wobo's register (voice.md 10a): a next step, no exclamation, and nothing about tokens,
        # links or signatures, which are ours to worry about and not the reader's.
        assert "!" not in message
        assert not any(word in message.lower() for word in ("token", "signature", "invalid"))


def test_an_old_link_opens_nothing(client: TestClient) -> None:
    stale = a_token(issued=NOW - timedelta(days=400))
    assert client.post(LAND, json={"token": stale}).status_code == 400


def test_a_get_never_spends_the_sign_in(client: TestClient) -> None:
    """A mail-security scanner and a link prefetcher both open every URL before a person does."""
    token = a_token()
    assert client.get(LAND, params={"token": token}).status_code in (404, 405)
    assert client.post(LAND, json={"token": token}).json()["sign_in"] is True


def test_the_route_takes_nothing_but_a_token(client: TestClient) -> None:
    """No destination from the caller, ever: it comes out of the signature or not at all."""
    res = client.post(LAND, json={"token": a_token(), "destination": "/you"})
    assert res.status_code == 422
