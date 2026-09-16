"""The Growth page on the console, the three passes, and the arrival that writes a campaign once."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from growth_world import good_piece
from wobo_gateway import admin_auth, consent, doors
from wobo_gateway.admin_auth import ADMIN_PREFIX, OPERATOR, OWNER, VIEWER, InMemoryAdminStore
from wobo_gateway.growth import api, outbox, piece, posters, settings, shapes
from wobo_gateway.growth import store as store_mod

DESK = f"{ADMIN_PREFIX}/growth"
SUBJECT = "72222222-2222-4222-8222-222222222222"
LEARNER = "73333333-3333-4333-8333-333333333333"
INTERNAL = {"X-Wobo-Internal": "internal-test-key"}
NOW = datetime(2026, 9, 16, 6, 0, tzinfo=UTC)


class Site:
    """The live site, recorded: no test here reads heywobo.com."""

    def __init__(self) -> None:
        self.up = True

    def __call__(self, url: str) -> tuple[int, str]:
        if not self.up:
            return 404, ""
        return 200, f'<link rel="canonical" href="{url}">'


@pytest.fixture(autouse=True)
def _desk(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "internal-test-key")
    monkeypatch.setenv("CURRICULUM_STORE", "memory")
    monkeypatch.delenv("ENV", raising=False)
    admins = InMemoryAdminStore()
    admin_auth.set_store(admins)
    admin_auth.reset_limiter()
    settings_store = doors.InMemorySettingsStore()
    doors.set_store(settings_store)
    settings.forget()
    growth = store_mod.InMemoryGrowthStore()
    store_mod.set_store(growth)
    api.forget()
    site = Site()
    outbox.set_page_reader(site)
    yield {"admins": admins, "settings": settings_store, "growth": growth, "site": site}
    outbox.set_page_reader(None)
    admin_auth.set_store(None)
    doors.set_store(None)
    store_mod.set_store(None)
    posters.reset()
    settings.forget()
    api.forget()


@pytest.fixture()
def client() -> TestClient:
    from wobo_gateway.app import create_app

    return TestClient(create_app())


def _bearer(subject: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET)}"}


def seat(client: TestClient, admins: InMemoryAdminStore, role: str) -> dict[str, str]:
    admins.upsert_admin(
        subject_id=SUBJECT, email="ops@example.com", role=role, granted_by=None, mfa_required=False
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(SUBJECT))
    assert opened.status_code == 200, opened.text
    return {**_bearer(SUBJECT), admin_auth.SESSION_HEADER: opened.json()["session_token"]}


def _stage() -> None:
    made = good_piece()
    outbox.stage(
        made,
        piece.check(made),
        shapes.posts_for(made, when=NOW),
        now=NOW,
        dials=settings.Settings(running=True),
    )


def test_a_stranger_and_a_learner_get_nothing(client: TestClient) -> None:
    assert client.get(DESK).status_code in {401, 403}
    assert client.get(DESK, headers=_bearer(LEARNER)).status_code in {401, 403, 404}


@pytest.mark.parametrize("role", [VIEWER, OPERATOR, OWNER])
def test_every_seat_that_reads_growth_sees_the_desk(
    client: TestClient, _desk: dict[str, Any], role: str
) -> None:
    _stage()
    got = client.get(DESK, headers=seat(client, _desk["admins"], role))
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["dials"]["running"] is False
    assert body["dials"]["approval"] == "every"
    never = [c for c in body["channels"] if c["tier"] == "never"]
    assert {c["key"] for c in never} == {"reddit", "quora"}
    assert all(c["because"] for c in never)
    assert body["topics"]["rows"], "the desk ranks from the harvest before any gather"
    assert body["pieces"][0]["slug"] == "probability"
    statuses = {p["channel"]: p["status"] for p in body["posts"]}
    assert statuses["blog"] == "awaiting_approval" and statuses["x"] == "held"
    assert body["report"]["pieces_publishable"] == 1
    assert "cost_per_signup" in body["report"]["absent"]


@pytest.mark.parametrize("role", [VIEWER, OPERATOR])
def test_only_the_owner_turns_a_dial_or_moves_a_post(
    client: TestClient, _desk: dict[str, Any], role: str
) -> None:
    _stage()
    headers = seat(client, _desk["admins"], role)
    for path, body in (
        ("/dials", {"running": True}),
        ("/approve", {"campaign_id": "blog-202609-probability-01"}),
        ("/withdraw", {"campaign_id": "blog-202609-probability-01"}),
        ("/indexed", {"slug": "probability", "note": "seen it in the results"}),
        ("/repost", {"slug": "probability"}),
        ("/notes", {"text": "why does ice float?"}),
    ):
        got = client.post(f"{DESK}{path}", json=body, headers=headers)
        assert got.status_code in {403, 404}, (path, got.status_code, got.text)
    assert _desk["settings"].values.get(settings.RUNNING_KEY) is None


def test_the_owner_turns_the_dials_and_the_trail_says_so(
    client: TestClient, _desk: dict[str, Any]
) -> None:
    headers = seat(client, _desk["admins"], OWNER)
    got = client.post(
        f"{DESK}/dials",
        json={
            "running": True,
            "cadence": {"x": 2, "blog": 1},
            "topics_off": ["energy"],
            "approval": "person",
            "note": "first week",
        },
        headers=headers,
    )
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["dials"]["running"] is True
    assert body["dials"]["cadence"]["x"] == 2
    assert body["dials"]["topics_off"] == ["energy"]
    stored = _desk["settings"].values
    assert stored[settings.RUNNING_KEY] is True
    assert stored[settings.TOPICS_OFF_KEY] == ["energy"]
    assert any(c.get("note") == "first week" for c in _desk["settings"].changes)
    actions = [row.get("action") for row in _desk["admins"].audit]
    assert "growth.dials" in actions


@pytest.mark.parametrize(
    "bad",
    [
        {"cadence": {"reddit": 1}},
        {"cadence": {"quora": 0}},
        {"cadence": {"blog": 9}},
        {"cadence": {"nowhere": 1}},
        {"approval": "never"},
        {"pieces_daily": 50},
        {"topics_off": ["Not A Slug"]},
        {},
    ],
)
def test_a_bad_dial_is_refused_and_nothing_is_written(
    client: TestClient, _desk: dict[str, Any], bad: dict[str, Any]
) -> None:
    headers = seat(client, _desk["admins"], OWNER)
    got = client.post(f"{DESK}/dials", json=bad, headers=headers)
    assert got.status_code == 422, got.text
    assert not any(k.startswith("growth.") for k in _desk["settings"].values)


def test_the_owner_approves_and_the_origin_rule_still_holds(
    client: TestClient, _desk: dict[str, Any]
) -> None:
    _stage()
    headers = seat(client, _desk["admins"], OWNER)
    held = client.post(
        f"{DESK}/approve", json={"campaign_id": "x-202609-probability-01"}, headers=headers
    )
    assert held.status_code == 409
    assert "indexed" in held.json()["detail"]["message"]
    ok = client.post(
        f"{DESK}/approve", json={"campaign_id": "blog-202609-probability-01"}, headers=headers
    )
    assert ok.status_code == 200, ok.text
    status = {p["channel"]: p["status"] for p in ok.json()["posts"]}
    assert status["blog"] == "approved"
    early = client.post(
        f"{DESK}/indexed", json={"slug": "probability", "note": "seen in results"}, headers=headers
    )
    assert early.status_code == 409


def test_the_owner_posts_a_gone_page_again(client: TestClient, _desk: dict[str, Any]) -> None:
    _stage()
    on = settings.Settings(running=True, approval=settings.APPROVE_PERSON_TIER)
    posters.set_poster("blog", _Blog())
    outbox.approve("blog-202609-probability-01", actor="owner", now=NOW)
    outbox.run(now=NOW, dials=on)
    headers = seat(client, _desk["admins"], OWNER)
    alive = client.post(f"{DESK}/repost", json={"slug": "probability"}, headers=headers)
    assert alive.status_code == 409 and "answering" in alive.json()["detail"]["message"]
    _desk["site"].up = False
    gone = client.post(f"{DESK}/repost", json={"slug": "probability"}, headers=headers)
    assert gone.status_code == 200, gone.text
    ids = {p["id"]: p["status"] for p in gone.json()["posts"]}
    assert ids["blog-202609-probability-01"] == "posted"
    assert ids["blog-202609-probability-02"] == "awaiting_approval"
    actions = [row.get("action") for row in _desk["admins"].audit]
    assert "growth.repost" in actions


class _Blog:
    channel = "blog"

    def post(self, post: Any) -> str:
        return "07-probability.md"


def test_the_notes_door_keeps_questions(client: TestClient, _desk: dict[str, Any]) -> None:
    headers = seat(client, _desk["admins"], OWNER)
    got = client.post(
        f"{DESK}/notes", json={"text": "Why does ice float?\nWhat is inertia?"}, headers=headers
    )
    assert got.status_code == 200, got.text
    assert got.json()["questions"] == 2
    assert len(_desk["growth"].signals(since="2000-01-01")) == 2


# --- the passes -----------------------------------------------------------------------------------
@pytest.mark.parametrize("path", [api.GATHER_PATH, api.MAKE_PATH, api.POST_PATH])
def test_the_passes_need_the_internal_key(client: TestClient, path: str) -> None:
    assert client.post(path, json={}).status_code == 403
    assert client.post(path, json={}, headers={"X-Wobo-Internal": "wrong"}).status_code == 403


def test_the_passes_do_nothing_while_the_switch_is_off(client: TestClient) -> None:
    made = client.post(api.MAKE_PATH, json={"now": NOW.isoformat()}, headers=INTERNAL)
    assert made.status_code == 200 and made.json()["because"] == "the kill switch is off"
    posted = client.post(api.POST_PATH, json={"now": NOW.isoformat()}, headers=INTERNAL)
    assert posted.json()["running"] is False


def test_the_gather_pass_runs_keyless(client: TestClient) -> None:
    got = client.post(api.GATHER_PATH, json={"now": NOW.isoformat()}, headers=INTERNAL)
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["sources"]["search-console"]["read"] is False
    assert body["topics"]


def test_make_stages_a_piece_when_one_can_be_made(
    monkeypatch: pytest.MonkeyPatch, _desk: dict[str, Any]
) -> None:
    world = good_piece()
    from wobo_gateway.growth import make

    monkeypatch.setattr(make, "core_for", lambda topic: {"idea": "x"})
    monkeypatch.setattr(make, "figure_for", lambda topic: world.figure)
    monkeypatch.setattr(make, "film_for", lambda topic: world.film)
    monkeypatch.setattr(make, "provenance_for", lambda topic, tree=None: world.provenance)

    def writer(core: Any, topic: Any) -> dict[str, Any]:
        return {
            "title": world.title,
            "summary": world.summary,
            "lead": world.lead,
            "sections": [
                {"heading": s.heading, "body": f"{s.body} This page is about {topic.name.lower()}."}
                for s in world.sections
            ],
        }

    dials = settings.Settings(running=True, pieces_daily=1)
    report = api.run_make(NOW, dials=dials, writer=writer)
    assert len(report["made"]) == 1, report
    slug = report["made"][0]["slug"]
    assert _desk["growth"].piece(slug) is not None
    again = api.run_make(NOW, dials=dials, writer=writer)
    assert again["made"] == [], "one piece a day is the pace"


# --- the arrival ----------------------------------------------------------------------------------
def test_the_arrival_writes_a_new_account_once(
    client: TestClient, _desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(consent, "account_created_at", lambda s: datetime.now(UTC))
    _desk["growth"].accounts[LEARNER] = None
    first = client.post(
        api.ARRIVAL_PATH, json={"utm_id": "x-202609-probability-01"}, headers=_bearer(LEARNER)
    )
    assert first.status_code == 200 and first.json() == {"written": True}
    second = client.post(
        api.ARRIVAL_PATH, json={"utm_id": "blog-202609-motion-01"}, headers=_bearer(LEARNER)
    )
    assert second.json() == {"written": False}
    assert _desk["growth"].accounts[LEARNER] == "x-202609-probability-01"
    assert _desk["growth"].signups() == {"x-202609-probability-01": 1}


def test_the_arrival_refuses_an_old_account_junk_and_tier_three(
    client: TestClient, _desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    _desk["growth"].accounts[LEARNER] = None
    monkeypatch.setattr(
        consent, "account_created_at", lambda s: datetime.now(UTC) - timedelta(days=3)
    )
    old = client.post(
        api.ARRIVAL_PATH, json={"utm_id": "x-202609-probability-01"}, headers=_bearer(LEARNER)
    )
    assert old.json() == {"written": False}
    monkeypatch.setattr(consent, "account_created_at", lambda s: datetime.now(UTC))
    for junk in ("reddit-202609-probability-01", "<script>", "x-202699-probability-01"):
        got = client.post(api.ARRIVAL_PATH, json={"utm_id": junk}, headers=_bearer(LEARNER))
        assert got.json() == {"written": False}, junk
    monkeypatch.setattr(consent, "account_created_at", lambda s: None)
    unknown = client.post(
        api.ARRIVAL_PATH, json={"utm_id": "x-202609-probability-01"}, headers=_bearer(LEARNER)
    )
    assert unknown.json() == {"written": False}
    assert _desk["growth"].accounts[LEARNER] is None


def test_the_arrival_needs_a_signed_in_learner(client: TestClient) -> None:
    got = client.post(api.ARRIVAL_PATH, json={"utm_id": "x-202609-probability-01"})
    assert got.status_code == 401


def test_the_growth_routes_are_not_in_the_published_spec(client: TestClient) -> None:
    spec = client.get("/openapi.json")
    if spec.status_code == 200:
        text = spec.text
        assert "/growth" not in text
