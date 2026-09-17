"""``GET/PUT /v1/me/mail-preferences`` and the one-click ``/v1/mail/stop`` (WOBO-PLAN §14.1).

Driven through the real app with the real door: the preferences routes need a verified token,
the stop link needs none — its signed token is the whole authority, and it names the mail it
came from, so a click stops that mail and nobody else's. No network anywhere: the store is the
in-memory one and the calendar is the checked-in file.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import app as app_mod
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.hospitality import festivals as fest
from wobo_gateway.hospitality import preferences as prefs_mod
from wobo_gateway.hospitality import tokens
from wobo_gateway.hospitality.preferences import InMemoryPreferencesStore
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

PATH = "/v1/me/mail-preferences"
STOP = "/v1/mail/stop"
# WOBO-PLAN §17: nothing a reader sees names a provider, a model or a vendor.
VENDOR = re.compile(
    r"\b(gemini|openai|anthropic|claude|litellm|supabase|railway|vercel|resend)\b", re.I
)


@pytest.fixture(autouse=True)
def _fresh(monkeypatch: pytest.MonkeyPatch) -> InMemoryPreferencesStore:
    monkeypatch.setenv("MAIL_PREFERENCES_STORE", "memory")
    monkeypatch.delenv("MAIL_TOKEN_SECRET", raising=False)
    monkeypatch.delenv("MAIL_STOP_URL", raising=False)
    monkeypatch.delenv("MAIL_QUIET_HOURS", raising=False)
    store = InMemoryPreferencesStore()
    prefs_mod.set_store(store)
    fest.set_calendar(None)
    yield store
    prefs_mod.set_store(None)
    fest.set_calendar(None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


# --- the door -------------------------------------------------------------------------------------


def test_the_preferences_are_behind_the_door_and_the_stop_link_is_not(client: TestClient) -> None:
    assert client.get(PATH).status_code == 401
    assert client.put(PATH, json={"wins": False}).status_code == 401
    assert STOP in app_mod._OPEN_PATHS
    assert client.get(STOP).status_code == 400  # open, and honest about a missing token


def test_defaults_and_the_closed_list_of_calendars(client: TestClient, auth: Any) -> None:
    res = client.get(PATH, headers=auth())
    assert res.status_code == 200
    body = res.json()
    assert body["preferences"] == {
        "sunday_note": True,
        "wins": True,
        "festivals": True,
        # The five nudges, each its own dial (docs/EMAILS-AND-ANIMATIONS.md §1).
        "quick_one": True,
        "mid_chapter": True,
        "streak": True,
        "bonus_level": True,
        "doubt": True,
        # The good-news note the weekly cadence fills its floor with (wave 56), its own dial.
        "learning_note": True,
        "festival_calendar": [],
        "country": None,
        "region": None,
        "timezone": None,
        "unsubscribed": False,
        "unsubscribed_at": None,
    }
    ids = [c["id"] for c in body["calendars"]]
    assert "hindu" in ids and "muslim" in ids and "christian" in ids and "malayali" in ids
    assert {c["id"] for c in body["calendars"] if c["community"]} >= {"malayali", "bengali"}
    assert "never guessed" in body["about_calendars"]


def test_an_anonymous_learner_sees_defaults_and_may_not_write(
    client: TestClient, auth: Any
) -> None:
    anon = auth("anon-device", anonymous=True)
    assert client.get(PATH, headers=anon).json()["preferences"]["festival_calendar"] == []
    res = client.put(PATH, json={"wins": False}, headers=anon)
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "sign_in_required"


# --- writing --------------------------------------------------------------------------------------


def test_a_partial_update_round_trips_and_normalises_codes(
    client: TestClient, auth: Any, _fresh: InMemoryPreferencesStore
) -> None:
    res = client.put(
        PATH,
        json={
            "country": "in",
            "region": "in-ts",
            "timezone": "Asia/Kolkata",
            "festival_calendar": ["Hindu", "hindu", "malayali"],
            "wins": False,
        },
        headers=auth(),
    )
    assert res.status_code == 200, res.text
    prefs = res.json()["preferences"]
    assert prefs["country"] == "IN" and prefs["region"] == "IN-TG"
    assert prefs["festival_calendar"] == ["hindu", "malayali"]
    assert prefs["wins"] is False and prefs["sunday_note"] is True
    # a second partial write leaves the rest alone
    res = client.put(PATH, json={"sunday_note": False}, headers=auth())
    prefs = res.json()["preferences"]
    assert prefs["sunday_note"] is False and prefs["wins"] is False
    assert prefs["festival_calendar"] == ["hindu", "malayali"]
    assert client.get(PATH, headers=auth()).json()["preferences"] == prefs
    # stored under the verified subject, nobody else's
    assert list(_fresh.rows) == ["learner-under-test"]


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"festival_calendar": ["astrology"]}, "festival_calendar"),
        ({"festival_calendar": ["hindu; drop table"]}, "festival_calendar"),
        ({"timezone": "Mars/Olympus"}, "timezone"),
        ({"timezone": "../etc"}, "timezone"),
        ({"region": "IN-TG"}, "region"),  # no country on file
        ({"country": "India"}, "country"),
    ],
)
def test_a_value_we_cannot_keep_is_refused_by_field(
    client: TestClient, auth: Any, body: dict[str, Any], field: str
) -> None:
    res = client.put(PATH, json=body, headers=auth())
    assert res.status_code == 422, res.text
    detail = res.json()["detail"]
    assert detail["code"] == "not_kept" and detail["field"] == field
    assert not VENDOR.search(detail["message"])


def test_a_region_must_belong_to_the_country(client: TestClient, auth: Any) -> None:
    assert client.put(PATH, json={"country": "IN"}, headers=auth()).status_code == 200
    res = client.put(PATH, json={"region": "GB-ENG"}, headers=auth())
    assert res.status_code == 422 and res.json()["detail"]["field"] == "region"
    assert client.put(PATH, json={"region": "IN-KL"}, headers=auth()).status_code == 200
    # changing country drops a region that no longer fits
    prefs = client.put(PATH, json={"country": "AE"}, headers=auth()).json()["preferences"]
    assert prefs["country"] == "AE" and prefs["region"] is None


def test_unknown_fields_are_refused_not_ignored(client: TestClient, auth: Any) -> None:
    assert client.put(PATH, json={"consent_tier": "elevated"}, headers=auth()).status_code == 422


def test_clearing_the_chosen_list_is_one_write(client: TestClient, auth: Any) -> None:
    client.put(PATH, json={"festival_calendar": ["hindu", "sikh"]}, headers=auth())
    prefs = client.put(PATH, json={"festival_calendar": []}, headers=auth()).json()["preferences"]
    assert prefs["festival_calendar"] == []


# --- the one-click stop ---------------------------------------------------------------------------


def test_the_stop_token_round_trips_and_refuses_tampering(monkeypatch: pytest.MonkeyPatch) -> None:
    token = tokens.stop_token("learner-under-test", "sunday_note")
    assert token
    claim = tokens.parse_stop_token(token)
    # The Sunday note only ever goes to a parent, and its link says so.
    assert claim == tokens.StopClaim("learner-under-test", "sunday_note", to_parent=True)
    assert claim.kinds == ("sunday_note",)
    # The learner's own link is the learner's own mail: the wins, and the wishes while they come
    # to the learner. Never a learning note, which under thirteen goes to the parent (2026-09-16).
    assert tokens.parse_stop_token(tokens.stop_token("x", "learner")).kinds == (  # type: ignore[union-attr]
        "wins",
        "festivals",
    )
    # "Stop all of these" in a note to the learner's own address stops their notes too.
    assert set(tokens.AUDIENCES["learner_all"]) == {"wins", "festivals", *NUDGES}
    head, sig = token.split(".")
    assert tokens.parse_stop_token(f"{head}.{sig[:-2]}AA") is None
    assert tokens.parse_stop_token(f"{head}x.{sig}") is None
    assert tokens.parse_stop_token("") is None and tokens.parse_stop_token(None) is None
    assert tokens.parse_stop_token("a.b.c") is None
    # an audience we do not send to is not a token we mint or read
    assert tokens.stop_token("learner-under-test", "everything") is None
    # a link from long ago still works; one from beyond the window does not
    old = tokens.stop_token(
        "learner-under-test", "learner", issued=datetime.now(UTC) - timedelta(days=300)
    )
    assert tokens.parse_stop_token(old).learner_id == "learner-under-test"  # type: ignore[union-attr]
    ancient = tokens.stop_token(
        "learner-under-test", "learner", issued=datetime.now(UTC) - timedelta(days=500)
    )
    assert tokens.parse_stop_token(ancient) is None
    # a different key is a different signature
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "another-key-entirely-and-long-enough")
    assert tokens.parse_stop_token(token) is None


def test_no_signing_key_means_no_token_and_no_link(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    assert tokens.stop_token("learner-under-test", "learner") is None
    assert tokens.stop_link("learner-under-test", "learner") is None


def test_the_link_points_at_the_gateway_stop_route(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GATEWAY_URL", "https://api.example.test/")
    link = tokens.stop_link("learner-under-test", "learner")
    assert link and link.startswith("https://api.example.test/v1/mail/stop?token=")
    assert tokens.is_one_click(link)
    assert not tokens.is_one_click("https://api.example.test/v1/mail/stop")  # no token: a page
    assert not tokens.is_one_click("https://heywobo.com/you")  # a sign-in page
    monkeypatch.setenv("MAIL_STOP_URL", "https://example.test/stop")
    assert tokens.stop_link("x", "learner").startswith("https://example.test/stop?token=")  # type: ignore[union-attr]


def test_the_parents_link_stops_the_sunday_note_and_nothing_else(
    client: TestClient, auth: Any, _fresh: InMemoryPreferencesStore
) -> None:
    """The parent clicked "Stop the notes" in the Sunday note. That is the mail that stops; the
    learner's wins and wishes, and the calendars the family chose, are not the parent's to
    switch off from that link. A GET changes nothing (link prefetchers); the button's POST does."""
    client.put(PATH, json={"country": "IN", "festival_calendar": ["hindu"]}, headers=auth())
    token = tokens.stop_token("learner-under-test", "sunday_note")
    res = client.get(STOP, params={"token": token})  # no Authorization header at all
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/html")
    assert "Stop the Sunday notes?" in res.text and 'method="post"' in res.text
    assert _fresh.rows["learner-under-test"].sunday_note is True  # a GET is a question
    assert not VENDOR.search(res.text) and "<script" not in res.text
    res = client.post(STOP, data={"token": token})
    assert res.status_code == 200
    assert "No more Sunday notes" in res.text and "Nothing else changes" in res.text
    assert "wins" not in res.text and "wishes" not in res.text
    assert not VENDOR.search(res.text)
    assert "<script" not in res.text and "http" not in res.text.split("<body")[1]
    row = _fresh.rows["learner-under-test"]
    assert row.sunday_note is False and row.wins is True and row.festivals is True
    assert row.unsubscribed_at is None and row.festival_calendar == ("hindu",)
    assert row.allows("wins") and row.allows("festivals") and not row.allows("sunday_note")
    # visible to the signed-in learner, and a signed-in write brings it back
    prefs = client.get(PATH, headers=auth()).json()["preferences"]
    assert prefs["sunday_note"] is False and prefs["unsubscribed"] is False
    prefs = client.put(PATH, json={"sunday_note": True}, headers=auth()).json()["preferences"]
    assert prefs["sunday_note"] is True


NUDGES = ("quick_one", "mid_chapter", "streak", "bonus_level", "doubt", "learning_note")


def test_the_learners_link_stops_the_learners_own_mail_and_never_the_parents(
    client: TestClient, auth: Any, _fresh: InMemoryPreferencesStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The learner's link says "None at all" in a win and "Stop these" in the welcome, and both go
    to the learner's own address. It stops what that address is sent: the wins, and the wishes
    only while the wishes come to it. The notes about their learning go to the parent under
    thirteen, and a child's click never silences them (2026-09-16)."""
    client.put(PATH, json={"country": "IN", "festival_calendar": ["hindu"]}, headers=auth())
    token = tokens.stop_token("learner-under-test", "learner")
    # No address of the learner's own on file: the wishes go to the parent and stay on.
    res = client.get(STOP, params={"token": token})
    assert res.status_code == 200 and "Stop the notes about your wins?" in res.text
    res = client.post(STOP, data={"token": token})
    assert res.status_code == 200 and "No more notes about wins" in res.text
    row = _fresh.rows["learner-under-test"]
    assert row.wins is False and row.festivals is True and row.sunday_note is True
    assert all(getattr(row, kind) is True for kind in NUDGES)
    assert row.unsubscribed_at is None and row.festival_calendar == ("hindu",)
    # With the learner's own address on file, the wishes are theirs, and the link stops them too.
    monkeypatch.setattr(tokens, "wishes_come_to_learner", lambda learner_id: True)
    res = client.get(STOP, params={"token": token})
    assert "Stop the wins and wishes?" in res.text
    res = client.post(STOP, data={"token": token})
    assert res.status_code == 200 and "No more wins or wishes" in res.text
    row = _fresh.rows["learner-under-test"]
    assert row.wins is False and row.festivals is False and row.sunday_note is True
    assert all(getattr(row, kind) is True for kind in NUDGES)


def test_the_parents_stop_all_link_stops_everything_the_parent_gets(
    client: TestClient, _fresh: InMemoryPreferencesStore
) -> None:
    token = tokens.stop_token("learner-under-test", "parent")
    res = client.get(STOP, params={"token": token})
    assert res.status_code == 200 and "Stop every note about your child?" in res.text
    assert _fresh.rows.get("learner-under-test") is None  # a GET is a question
    res = client.post(STOP, data={"token": token})
    assert res.status_code == 200 and "No more notes from me" in res.text
    row = _fresh.rows["learner-under-test"]
    assert row.sunday_note is False and row.festivals is False
    assert all(getattr(row, kind) is False for kind in NUDGES)
    # The learner's own wins are the learner's mail, not the parent's to stop.
    assert row.wins is True and row.unsubscribed_at is None


def test_the_good_news_note_is_its_own_dial_and_its_own_link(
    client: TestClient, auth: Any, _fresh: InMemoryPreferencesStore
) -> None:
    token = tokens.stop_token("learner-under-test", "learning_note")
    res = client.get(STOP, params={"token": token})
    assert "Stop the notes about learning?" in res.text
    res = client.post(STOP, data={"token": token})
    assert "No more notes about learning" in res.text
    row = _fresh.rows["learner-under-test"]
    assert row.learning_note is False
    assert all(getattr(row, kind) is True for kind in NUDGES if kind != "learning_note")
    back = client.put(PATH, json={"learning_note": True}, headers=auth()).json()["preferences"]
    assert back["learning_note"] is True


def test_a_second_click_is_harmless_and_a_row_is_made_for_a_first_click(
    client: TestClient, _fresh: InMemoryPreferencesStore
) -> None:
    token = tokens.stop_token("never-seen-before", "sunday_note")
    first = client.post(STOP, data={"token": token})
    assert first.status_code == 200
    row = _fresh.rows["never-seen-before"]
    assert row.sunday_note is False and row.wins is True
    second = client.post(STOP, data={"token": token})
    assert second.status_code == 200
    assert _fresh.rows["never-seen-before"].sunday_note is False


def test_a_bad_link_is_a_plain_page_not_an_error_body(client: TestClient) -> None:
    res = client.get(STOP, params={"token": "not.ours"})
    assert res.status_code == 400
    assert "did not work" in res.text and not VENDOR.search(res.text)
    assert client.get(STOP, params={"token": "<script>alert(1)</script>"}).status_code == 400
    assert client.post(STOP, data={"token": "not.ours"}).status_code == 400
    assert client.post(STOP).status_code == 400


def test_a_one_click_post_answers_the_same_way(
    client: TestClient, _fresh: InMemoryPreferencesStore
) -> None:
    """RFC 8058: the mail client POSTs the List-Unsubscribe URL with the one-click body."""
    token = tokens.stop_token("post-click", "learner")
    res = client.post(f"{STOP}?token={token}", data={"List-Unsubscribe": "One-Click"})
    assert res.status_code == 200 and "post-click" in _fresh.rows
    assert _fresh.rows["post-click"].wins is False and _fresh.rows["post-click"].sunday_note


def test_a_store_outage_is_said_out_loud(client: TestClient, auth: Any) -> None:
    class Down:
        def get(self, learner_id: str) -> Any:
            raise prefs_mod.StoreUnavailable("no route to host")

        def put(self, learner_id: str, prefs: Any) -> Any:
            raise prefs_mod.StoreUnavailable("no route to host")

        def stop(self, learner_id: str, kinds: Any) -> Any:
            raise prefs_mod.StoreUnavailable("no route to host")

    prefs_mod.set_store(Down())
    res = client.get(PATH, headers=auth())
    assert res.status_code == 503 and res.json()["detail"]["code"] == "store_unavailable"
    assert client.put(PATH, json={"wins": False}, headers=auth()).status_code == 503
    res = client.post(STOP, data={"token": tokens.stop_token("x", "learner")})
    assert res.status_code == 503 and "Try the link again" in res.text


# --- the waiting list's way out (the closer's run, 2026-09-17) ---------------------------------
def test_the_launch_mails_link_takes_the_address_off_the_list(client: TestClient) -> None:
    """The launch mail goes to people with no account. Its link names the list row, a GET asks,
    and the POST (the button, and a mail client's one-click) takes the address off the list."""
    from wobo_gateway import waiting_list

    store = waiting_list.InMemoryWaitingListStore()
    waiting_list.set_store(store)
    try:
        waiting_list.join(store, email="reader@example.test")
        entry = store.rows[0]
        link = waiting_list.stop_link(entry.id)
        assert link and tokens.is_one_click(link)
        token = link.split("token=", 1)[1]
        asked = client.get(STOP, params={"token": token})
        assert asked.status_code == 200 and 'method="post"' in asked.text
        assert "off the list" in asked.text and store.size() == 1
        done = client.post(f"{STOP}?token={token}", data={"List-Unsubscribe": "One-Click"})
        assert done.status_code == 200, done.text
        assert store.size() == 0 and not VENDOR.search(done.text)
        assert "Sign in" not in done.text
        again = client.post(STOP, data={"token": token})
        assert again.status_code == 200
        # a list link never touches anybody's mail settings
        assert entry.id not in _fresh_rows(client)
        # and the address can join again later, as a new row
        assert waiting_list.join(store, email="reader@example.test") is True
    finally:
        waiting_list.set_store(None)


def _fresh_rows(client: TestClient) -> dict[str, Any]:
    store = prefs_mod.get_store()
    return getattr(store, "rows", {})


def test_a_list_outage_on_the_way_out_is_said_out_loud(client: TestClient) -> None:
    from wobo_gateway import waiting_list

    waiting_list.set_store(waiting_list.UnconfiguredWaitingListStore())
    try:
        token = tokens.stop_token("5d1b0a52-1111-4222-8333-944455556666", "waiting_list")
        res = client.post(STOP, data={"token": token})
        assert res.status_code == 503 and "Try the link again" in res.text
    finally:
        waiting_list.set_store(None)
