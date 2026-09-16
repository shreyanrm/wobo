"""A one-click stop stops exactly what the reader asked for (2026-09-16).

The adversaries proved three ways it did not:

1. Every write to the family's mail settings carried the ``learning_note`` column, which only
   migration 0035 creates. Until 0035 is applied the project answers "no such column", so Gmail's
   Unsubscribe on a welcome, "Stop all of these", and the signed-in "stop everything" all failed
   with a 503 and the mail kept coming.
2. A parent of two children pressed "Stop all of these" in one child's note and kept receiving
   the same list about the other child, from the same address.
3. A child's own welcome carried a link that switched off every note to the PARENT.

Nothing here reaches a network: the project is a fake PostgREST that knows only the columns of
0010 and 0033 and answers an unknown column the way PostgREST does.
"""

from __future__ import annotations

import io
import json
import urllib.error
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import parents
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.email_templates import NUDGE_KINDS, render
from wobo_gateway.hospitality import festivals, jobs, tokens
from wobo_gateway.hospitality import preferences as prefs_mod
from wobo_gateway.hospitality.nudges import Learner, Nudge, send_nudge
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

STOP = "/v1/mail/stop"
PATH = "/v1/me/mail-preferences"
SUBJECT = "learner-under-test"
PARENT = "parent@example.test"
#: What the project holds before 0035: the columns of 0010 and of 0033.
BEFORE_0035 = frozenset(
    {
        "learner_id",
        "sunday_note",
        "wins",
        "festivals",
        "festival_calendar",
        "country",
        "region",
        "timezone",
        "unsubscribed_at",
        "created_at",
        "updated_at",
        "quick_one",
        "mid_chapter",
        "streak",
        "bonus_level",
        "doubt",
    }
)


class FakePostgrest:
    """``learner.mail_preferences`` as PostgREST serves it, with a fixed set of columns."""

    def __init__(self, columns: frozenset[str]) -> None:
        self.columns = columns
        self.rows: dict[str, dict[str, Any]] = {}
        self.refused = 0

    def __call__(
        self, url: str, key: str, method: str, *, body: Any = None, want_rows: bool
    ) -> Any:
        if method == "GET":
            learner = url.split("learner_id=eq.", 1)[1].split("&", 1)[0]
            row = self.rows.get(learner)
            return [dict(row)] if row else []
        (sent,) = body
        unknown = sorted(set(sent) - self.columns)
        if unknown:
            self.refused += 1
            detail = json.dumps(
                {
                    "code": "PGRST204",
                    "details": None,
                    "hint": None,
                    "message": f"Could not find the '{unknown[0]}' column of 'mail_preferences' "
                    "in the schema cache",
                }
            ).encode()
            raise urllib.error.HTTPError(url, 400, "Bad Request", {}, io.BytesIO(detail))  # type: ignore[arg-type]
        defaults = {c: True for c in self.columns if c in prefs_mod.MAIL_KINDS}
        row = {**defaults, "festival_calendar": [], **self.rows.get(sent["learner_id"], {}), **sent}
        self.rows[sent["learner_id"]] = row
        return [dict(row)] if want_rows else []


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "test-mail-secret")
    monkeypatch.setenv("PARENT_LINKS_STORE", "memory")
    monkeypatch.delenv("MAIL_STOP_URL", raising=False)
    links = parents.InMemoryParentLinkStore()
    parents.set_store(links)
    festivals.set_calendar(None)
    yield links
    parents.set_store(None)
    prefs_mod.set_store(None)
    festivals.set_calendar(None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def project(columns: frozenset[str] = BEFORE_0035) -> FakePostgrest:
    fake = FakePostgrest(columns)
    prefs_mod.set_store(
        prefs_mod.PostgrestPreferencesStore("https://project.example", "service", request=fake)
    )
    return fake


def link(links: parents.InMemoryParentLinkStore, learner_id: str, address: str = PARENT) -> None:
    links.insert(
        parents.ParentLink(
            id=str(uuid.uuid4()),
            learner_id=learner_id,
            parent_email_hash=f"{abs(hash(address.lower())):064x}"[-64:],
            parent_email=address,
            learner_name="Learner",
            timezone="Asia/Kolkata",
            status="linked",
            invited_at=datetime(2026, 9, 1, tzinfo=UTC),
            linked_at=datetime(2026, 9, 1, tzinfo=UTC),
        )
    )


# === 1. before 0035 is applied ===================================================================
@pytest.mark.parametrize(
    "audience", ["sunday_note", "streak", "learner", "parent", "learning_note", "learner_all"]
)
def test_every_stop_link_works_before_0035_is_applied(
    world: Any, client: TestClient, audience: str
) -> None:
    fake = project()
    res = client.post(STOP, params={"token": tokens.stop_token(SUBJECT, audience)})
    assert res.status_code == 200, res.text
    held = prefs_mod.get_store().get(SUBJECT)
    assert held is not None
    claim = tokens.parse_stop_token(tokens.stop_token(SUBJECT, audience))
    assert claim is not None
    for kind in tokens.kinds_to_stop(claim):
        assert not held.allows(kind), (audience, kind, fake.rows)


def test_a_stop_that_cannot_store_the_good_news_dial_still_stops_the_good_news(
    world: Any, client: TestClient
) -> None:
    project()
    client.post(STOP, params={"token": tokens.stop_token(SUBJECT, "learning_note")})
    held = prefs_mod.get_store().get(SUBJECT)
    assert held is not None and not held.allows("learning_note")
    # The other dials are the family's and are left exactly as they were.
    assert held.allows("sunday_note") and held.allows("streak") and held.allows("wins")


def test_the_signed_in_stop_everything_works_before_0035_is_applied(
    world: Any, client: TestClient, auth: Any
) -> None:
    project()
    res = client.put(PATH, json={"unsubscribed": True}, headers=auth())
    assert res.status_code == 200, res.text
    assert res.json()["preferences"]["unsubscribed"] is True
    res = client.put(PATH, json={"festivals": False}, headers=auth())
    assert res.status_code == 200, res.text
    assert res.json()["preferences"]["festivals"] is False


def test_after_0035_the_good_news_dial_is_stored_like_any_other(
    world: Any, client: TestClient, auth: Any
) -> None:
    fake = project(BEFORE_0035 | {"learning_note"})
    client.post(STOP, params={"token": tokens.stop_token(SUBJECT, "learning_note")})
    assert fake.rows[SUBJECT]["learning_note"] is False and fake.refused == 0
    back = client.put(PATH, json={"learning_note": True}, headers=auth()).json()["preferences"]
    assert back["learning_note"] is True


# === 2. one address, two children ================================================================
@pytest.mark.parametrize("audience", ["parent", "learning_note", "sunday_note"])
def test_a_parent_of_two_who_stops_a_list_stops_it_for_both(
    world: Any, client: TestClient, audience: str
) -> None:
    prefs_mod.set_store(prefs_mod.InMemoryPreferencesStore())
    asha, ravi, other = (str(uuid.uuid4()) for _ in range(3))
    link(world, asha)
    link(world, ravi)
    link(world, other, "someone-else@example.test")
    token = tokens.stop_token(asha, audience, to_parent=True)
    assert client.post(STOP, params={"token": token}).status_code == 200
    for learner in (asha, ravi):
        held = prefs_mod.get_store().get(learner)
        assert held is not None
        claim = tokens.parse_stop_token(token)
        assert claim is not None
        assert all(not held.allows(kind) for kind in tokens.kinds_to_stop(claim)), learner
    assert prefs_mod.get_store().get(other) is None


def test_every_parent_addressed_note_carries_a_link_that_reaches_the_siblings(world: Any) -> None:
    prefs_mod.set_store(prefs_mod.InMemoryPreferencesStore())
    sent: list[dict[str, Any]] = []
    child = Learner(learner_id="L-1", name="Learner", parent_email=PARENT, timezone="Asia/Kolkata")
    send_nudge(
        Nudge(kind="learning_note", learner=child, once_key="k", data={"angle": "waiting"}),
        now=datetime(2026, 9, 21, 11, 0, tzinfo=UTC),
        send=lambda *a, **k: sent.append({"data": a[2]}) or {"ok": True},
    )
    (only,) = sent
    for field in ("unsubscribe_url", "stop_all_url"):
        claim = tokens.parse_stop_token(only["data"][field].split("token=")[1])
        assert claim is not None and claim.to_parent, field


# === 3. a child's click is the child's ==========================================================
def test_a_childs_welcome_link_never_stops_the_parents_notes(
    world: Any, client: TestClient
) -> None:
    prefs_mod.set_store(prefs_mod.InMemoryPreferencesStore())
    link(world, SUBJECT)
    sent: list[dict[str, Any]] = []
    jobs.send_welcome(
        learner_id=SUBJECT,
        to="child@example.test",
        send=lambda kind, to, data, **kw: sent.append(data) or {"ok": True},
    )
    token = sent[0]["unsubscribe_url"].split("token=")[1]
    page = client.get(STOP, params={"token": token}).text
    assert "learning notes" not in page.lower()
    assert client.post(STOP, params={"token": token}).status_code == 200
    held = prefs_mod.get_store().get(SUBJECT)
    assert held is not None and held.wins is False
    # The wishes go to the parent while the account holds no address of the child's own, so the
    # child's click leaves them, and every note to the parent, exactly as they were.
    for kind in ("sunday_note", "festivals", *NUDGE_KINDS):
        assert held.allows(kind), kind


def test_a_wish_to_the_parents_address_carries_the_parents_link(
    world: Any, monkeypatch: Any
) -> None:
    prefs_mod.set_store(prefs_mod.InMemoryPreferencesStore())
    family = jobs.Family(
        learner_id=SUBJECT, learner_name="Learner", parent_email=PARENT, timezone="Asia/Kolkata"
    )
    prefs_mod.get_store().put(
        SUBJECT, prefs_mod.MailPreferences(country="IN", timezone="Asia/Kolkata")
    )
    sent: list[dict[str, Any]] = []
    jobs.run_wishes(
        datetime(2026, 10, 2, 4, 0, tzinfo=UTC),
        families=jobs.InMemoryFamilies([family]),
        send=lambda kind, to, data, **kw: sent.append({"to": to, **data}) or {"ok": True},
    )
    (wish,) = sent
    assert wish["to"] == PARENT
    claim = tokens.parse_stop_token(wish["unsubscribe_url"].split("token=")[1])
    assert claim is not None and claim.audience == "parent" and claim.to_parent


def test_a_learner_addressed_note_offers_the_learner_a_stop_for_all_of_their_notes(
    world: Any,
) -> None:
    prefs_mod.set_store(prefs_mod.InMemoryPreferencesStore())
    sent: list[dict[str, Any]] = []
    teen = Learner(
        learner_id="L-2",
        name="Learner",
        email="teen@example.test",
        parent_email=PARENT,
        under_13=False,
        timezone="Asia/Kolkata",
    )
    send_nudge(
        Nudge(kind="learning_note", learner=teen, once_key="k", data={"angle": "waiting"}),
        now=datetime(2026, 9, 21, 11, 0, tzinfo=UTC),
        send=lambda *a, **k: sent.append({"to": a[1], "data": a[2]}) or {"ok": True},
    )
    (only,) = sent
    assert only["to"] == "teen@example.test"
    claim = tokens.parse_stop_token(only["data"]["stop_all_url"].split("token=")[1])
    assert claim is not None and claim.audience == "learner_all" and not claim.to_parent
    assert "Stop all of these" in render("learning_note", only["data"])["html"]


def test_the_stop_token_says_whether_it_went_to_a_parent_and_old_tokens_still_parse(
    world: Any,
) -> None:
    fresh = tokens.parse_stop_token(tokens.stop_token(SUBJECT, "streak", to_parent=True))
    assert fresh is not None and fresh.to_parent
    plain = tokens.parse_stop_token(tokens.stop_token(SUBJECT, "streak"))
    assert plain is not None and not plain.to_parent
    # The Sunday note and "Stop all of these" only ever go to a parent.
    for audience in ("sunday_note", "parent"):
        claim = tokens.parse_stop_token(tokens.stop_token(SUBJECT, audience))
        assert claim is not None and claim.to_parent
