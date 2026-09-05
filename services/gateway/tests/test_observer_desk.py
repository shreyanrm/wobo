"""The observer's console desk and its three hooks (docs/CURRICULUM-OBSERVER.md §3, §8).

Every test here fails without the observer desk in ``desks_api.py``, the hooks in
``curriculum/api.py``, ``reports.py`` and ``app.py``, or the ``about`` allow-list carrying
``version_id`` and ``node_id``. The suite drives the real admin door, as ``test_desks`` does.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from test_curriculum_observer import PEPPER, build_world, learners
from wobo_gateway import admin_auth, reports
from wobo_gateway.admin_auth import (
    ADMIN_PREFIX,
    OPERATOR,
    OWNER,
    VIEWER,
    InMemoryAdminStore,
)
from wobo_gateway.curriculum import api as curriculum_api
from wobo_gateway.curriculum import observer as obs
from wobo_gateway.curriculum import store as curriculum_store
from wobo_gateway.desks_api import OBSERVER_FEED
from wobo_gateway.reports import InMemoryReportStore

LEARNER = "aaaaaaaa-1111-4111-8111-111111111111"
VIEWER_SUBJECT = "cccccccc-3333-4333-8333-333333333333"
OPERATOR_SUBJECT = "dddddddd-4444-4444-8444-444444444444"
OWNER_SUBJECT = "eeeeeeee-5555-4555-8555-555555555555"


@pytest.fixture(autouse=True)
def _desk_env(monkeypatch: pytest.MonkeyPatch):
    """A fresh register, fresh queues, a seeded registry and a memory observer, per test."""
    monkeypatch.setenv("REPORTS_STORE", "memory")
    monkeypatch.setenv("REPORTS_HANDLE_PEPPER", "a-test-pepper-for-the-queue-handle")
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.delenv("ENV", raising=False)
    monkeypatch.delenv("WOBO_DISCOVERY_WORKER", raising=False)
    register = InMemoryAdminStore()
    admin_auth.set_store(register)
    admin_auth.reset_limiter()
    reports.set_store(InMemoryReportStore())
    store, version, ids = build_world()
    curriculum_store.set_store(store)
    observer = obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)
    obs.set_observer(observer)
    # The turn hook runs off the request thread; the suite runs it in line.
    monkeypatch.setattr(obs, "_spawn", lambda fn: fn())
    yield register, store, version, ids, observer
    admin_auth.set_store(None)
    reports.set_store(None)
    curriculum_store.set_store(None)
    obs.set_observer(None)


@pytest.fixture
def client() -> TestClient:
    from wobo_gateway.app import create_app

    return TestClient(create_app())


def _bearer(subject: str, **claims: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET, **claims)}"}


def _desk(
    client: TestClient, register: InMemoryAdminStore, subject: str, role: str
) -> dict[str, str]:
    register.upsert_admin(
        subject_id=subject,
        email=f"{role}@heywobo.com",
        role=role,
        granted_by=None,
        mfa_required=False,
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(subject))
    assert opened.status_code == 200, opened.text
    return {**_bearer(subject), admin_auth.SESSION_HEADER: opened.json()["session_token"]}


def _consensus(store, version, ids, observer, n: int = 30) -> str:
    target = ids["UNIT IV: STATISTICS AND PROBABILITY"]
    for subject in learners(n):
        observer.observe_use(subject, ids["STATISTICS"], resolve_node=store.get_node)
        observer.observe_overlay(
            subject,
            version.id,
            [{"op": "remove", "node_id": target}],
            nodes=store.all_nodes(version.id),
        )
    return target


# --- the hooks (§3) -----------------------------------------------------------------------------
def test_an_overlay_write_is_counted_on_the_canonical_node(_desk_env) -> None:
    _, store, version, ids, observer = _desk_env
    target = ids["UNIT II: ALGEBRA"]
    observer.observe_use(LEARNER, ids["POLYNOMIALS"], resolve_node=store.get_node)
    out = curriculum_api.handle(
        "curriculum.overlay.apply",
        {"framework_id": "cbse", "ops": [{"op": "remove", "node_id": target}]},
        subject=LEARNER,
        store=store,
    )
    assert out["applied"] == 1
    signal = next(s for s in observer.signals(version.id) if s.node_id == target)
    assert signal.op == "remove" and signal.votes == 1
    # The learner's overlay is theirs and untouched by the count.
    assert store.get_overlay(LEARNER, version.id).patch[0]["node_id"] == target


def test_an_observer_that_cannot_count_never_costs_a_learner_their_edit(_desk_env) -> None:
    _, store, version, ids, _ = _desk_env
    obs.set_observer(obs.Observer(obs.UnconfiguredObserverStore(), pepper=PEPPER))
    out = curriculum_api.handle(
        "curriculum.overlay.apply",
        {"framework_id": "cbse", "ops": [{"op": "remove", "node_id": ids["UNIT II: ALGEBRA"]}]},
        subject=LEARNER,
        store=store,
    )
    assert out["applied"] == 1
    assert store.get_overlay(LEARNER, version.id) is not None


def test_a_not_my_syllabus_flag_carries_its_pointer_and_is_counted(
    client: TestClient, _desk_env
) -> None:
    _, store, version, ids, observer = _desk_env
    target = ids["UNIT II: ALGEBRA"]
    observer.observe_use(LEARNER, ids["POLYNOMIALS"], resolve_node=store.get_node)
    response = client.post(
        "/v1/flags",
        json={
            "reason": "not_my_syllabus",
            "about": {
                "surface": "syllabus",
                "version_id": version.id,
                "node_id": target,
                "note": "x",
            },
        },
        headers=_bearer(LEARNER),
    )
    assert response.status_code == 200, response.text
    kept = reports.get_store().queue(kind="flag", state=None, limit=1)[0].about or {}
    assert kept == {"surface": "syllabus", "version_id": version.id, "node_id": target}
    signal = next(s for s in observer.signals(version.id) if s.node_id == target)
    assert signal.op == "remove" and signal.breakdown == {"flag": 1}


def test_an_anonymous_flag_is_kept_but_is_not_a_vote(client: TestClient, _desk_env) -> None:
    _, store, version, ids, observer = _desk_env
    target = ids["UNIT II: ALGEBRA"]
    observer.observe_use(LEARNER, ids["POLYNOMIALS"], resolve_node=store.get_node)
    response = client.post(
        "/v1/flags",
        json={"reason": "not_my_syllabus", "about": {"version_id": version.id, "node_id": target}},
        headers=_bearer(LEARNER, is_anonymous=True),
    )
    assert response.status_code == 200
    assert len(reports.get_store().queue(kind="flag", state=None, limit=5)) == 1
    assert observer.signals(version.id) == []


def test_a_wrong_flag_is_not_a_syllabus_vote(client: TestClient, _desk_env) -> None:
    _, store, version, ids, observer = _desk_env
    observer.observe_use(LEARNER, ids["POLYNOMIALS"], resolve_node=store.get_node)
    client.post(
        "/v1/flags",
        json={
            "reason": "wrong",
            "about": {"version_id": version.id, "node_id": ids["UNIT II: ALGEBRA"]},
        },
        headers=_bearer(LEARNER),
    )
    assert observer.signals(version.id) == []


def test_a_turn_on_a_topic_is_real_use_and_an_anonymous_one_is_not(_desk_env) -> None:
    _, store, version, ids, observer = _desk_env
    payload = {"context": {"curriculum": {"nodeId": ids["POLYNOMIALS"], "nodeName": "Polynomials"}}}
    assert obs.note_turn(LEARNER, payload, anonymous=True) is False
    assert observer.store.learner_counts(version.id) == {}
    assert obs.note_turn(LEARNER, payload, anonymous=False) is True
    assert observer.store.learner_counts(version.id) == {ids["Mathematics"]: 1}
    # The same learner again is still one learner.
    obs.note_turn(LEARNER, payload, anonymous=False)
    assert observer.store.learner_counts(version.id) == {ids["Mathematics"]: 1}
    # A node we do not hold is not use of anything.
    assert (
        obs.note_turn(LEARNER, {"context": {"curriculum": {"nodeId": "nope"}}}, anonymous=False)
        is True
    )
    assert observer.store.learner_counts(version.id) == {ids["Mathematics"]: 1}


def test_the_turn_route_reaches_the_hook(client: TestClient, _desk_env, monkeypatch) -> None:
    seen: list[tuple[str | None, bool]] = []
    monkeypatch.setattr(
        obs,
        "note_turn",
        lambda subject, payload, *, anonymous: seen.append((subject, anonymous)) or True,
    )
    response = client.post(
        "/v1/capability/wobo.turn",
        json={"payload": {"context": {"turn": {"lastUserInput": "hi"}}}},
        headers=_bearer(LEARNER),
    )
    assert response.status_code == 200, response.text
    assert seen == [(LEARNER, False)]


# --- the desk (§8) ------------------------------------------------------------------------------
def test_a_viewer_reads_learners_signals_and_the_switch(client: TestClient, _desk_env) -> None:
    register, store, version, ids, observer = _desk_env
    target = _consensus(store, version, ids, observer, n=30)
    headers = _desk(client, register, VIEWER_SUBJECT, VIEWER)
    response = client.get(f"{ADMIN_PREFIX}/observer", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["readable"] is True
    assert body["require_review"] is True
    assert body["enabled"] is False
    assert body["feed"] == OBSERVER_FEED
    assert body["thresholds"]["min_learners"] == obs.MIN_LEARNERS
    [edition] = body["versions"]
    assert (
        edition["label"] == "2026-27"
        and edition["framework"] == "Central Board of Secondary Education"
    )
    assert edition["learners"] == 30
    assert edition["subjects"] == [
        {"subject_node_id": ids["Mathematics"], "subject": "Mathematics", "learners": 30}
    ]
    [signal] = edition["signals"]
    assert signal["node"] == "UNIT IV: STATISTICS AND PROBABILITY"
    assert signal["node_id"] == target
    assert signal["votes"] == 30 and signal["share_pct"] == 100.0 and signal["triggers"] is True
    assert "30 of 30 learners" in signal["line"]
    assert edition["actions"] == []
    # No learner id anywhere on the desk.
    assert "learner-1" not in json.dumps(body)
    line = next(e for e in register.audit if e["action"] == "observer.desk.read")
    assert line["resource_type"] == "curriculum.observer"


def test_an_unreachable_observer_store_says_so_and_shows_no_editions(
    client: TestClient, _desk_env
) -> None:
    register, *_ = _desk_env
    obs.set_observer(obs.Observer(obs.UnconfiguredObserverStore(), pepper=PEPPER))
    headers = _desk(client, register, VIEWER_SUBJECT, VIEWER)
    body = client.get(f"{ADMIN_PREFIX}/observer", headers=headers).json()
    assert body["readable"] is False
    assert body["versions"] == [] and body["require_review"] is None
    assert body["feed"] == OBSERVER_FEED


def test_what_the_observer_did_is_on_the_desk_with_its_diff(client: TestClient, _desk_env) -> None:
    from test_curriculum_observer import run
    from wobo_gateway.curriculum.discovery.job import InMemoryJobStore

    register, store, version, ids, observer = _desk_env
    _consensus(store, version, ids, observer, n=30)
    outcomes = run(store, observer, InMemoryJobStore())
    assert [o.action for o in outcomes] == ["queued"]
    headers = _desk(client, register, VIEWER_SUBJECT, VIEWER)
    [edition] = client.get(f"{ADMIN_PREFIX}/observer", headers=headers).json()["versions"]
    [action] = edition["actions"]
    assert action["action"] == "queued"
    assert action["signal"]["node"] == "UNIT IV: STATISTICS AND PROBABILITY"
    assert "cannot conclude" in action["reason"]


def test_a_learner_and_an_admin_without_a_session_read_nothing(
    client: TestClient, _desk_env
) -> None:
    assert client.get(f"{ADMIN_PREFIX}/observer", headers=_bearer(LEARNER)).status_code in (
        401,
        403,
    )
    assert client.get(f"{ADMIN_PREFIX}/observer").status_code in (401, 403)


def test_only_an_owner_turns_review_off_and_it_lands_in_the_trail(
    client: TestClient, _desk_env
) -> None:
    register, _, _, _, observer = _desk_env
    url = f"{ADMIN_PREFIX}/observer/review-switch"
    for subject, role in ((VIEWER_SUBJECT, VIEWER), (OPERATOR_SUBJECT, OPERATOR)):
        headers = _desk(client, register, subject, role)
        refused = client.post(url, json={"require_review": False}, headers=headers)
        assert refused.status_code == 403, refused.text
        assert observer.require_review() is True
    headers = _desk(client, register, OWNER_SUBJECT, OWNER)
    switched = client.post(url, json={"require_review": False}, headers=headers)
    assert switched.status_code == 200, switched.text
    assert switched.json() == {"require_review": False, "set_by": "owner@heywobo.com"}
    assert observer.require_review() is False
    line = next(e for e in register.audit if e["action"] == "observer.review_switch")
    assert line["detail"] == {"require_review": False}
    # And the desk now says so.
    assert client.get(f"{ADMIN_PREFIX}/observer", headers=headers).json()["require_review"] is False
    # Back on is one more line, not a delete.
    assert (
        client.post(url, json={"require_review": True}, headers=headers).json()["require_review"]
        is True
    )


# --- the project store, over a fake PostgREST --------------------------------------------------
class FakeRest:
    def __init__(self, tables: dict[str, list[dict[str, Any]]] | None = None) -> None:
        self.tables = tables or {}
        self.calls: list[tuple[str, str, dict[str, str], Any]] = []

    def __call__(self, method: str, url: str, headers: dict[str, str], body: bytes | None):
        payload = json.loads(body.decode()) if body else None
        self.calls.append((method, url, headers, payload))
        table = url.split("/rest/v1/")[1].split("?")[0]
        if method == "GET":
            return 200, self.tables.get(table, [])
        return 200, []


def test_the_project_store_writes_votes_once_per_learner_and_reads_the_views() -> None:
    fake = FakeRest(
        {
            "observer_signals": [
                {
                    "subject_node_id": "s1",
                    "node_id": "n1",
                    "op": "remove",
                    "value_key": "remove",
                    "value_text": "remove",
                    "votes": 7,
                }
            ],
            "observer_learners": [{"version_id": "v1", "subject_node_id": "s1", "learners": 20}],
        }
    )
    store = obs.PostgrestObserverStore(
        "https://project.invalid", "service-role-key", transport=fake
    )
    observer = obs.Observer(store, pepper=PEPPER)
    store.put_vote(
        obs.Vote(
            "v1",
            "s1",
            "n1",
            "remove",
            "remove",
            obs.voter_hash("subject-under-test", PEPPER),
            "remove",
        )
    )
    method, url, headers, payload = fake.calls[-1]
    assert method == "POST" and headers["Content-Profile"] == "curriculum"
    assert "on_conflict=version_id%2Cnode_key%2Cop%2Cvoter_hash" in url
    assert "resolution=merge-duplicates" in headers["Prefer"]
    assert payload[0]["voter_hash"] == obs.voter_hash(
        "subject-under-test", PEPPER
    ) and "subject-under-test" not in json.dumps(payload)

    store.put_use("v1", "s1", obs.voter_hash("subject-under-test", PEPPER))
    _, url, headers, _ = fake.calls[-1]
    assert "on_conflict=version_id%2Csubject_node_id%2Clearner_hash" in url
    assert "resolution=ignore-duplicates" in headers["Prefer"]

    store.drop_vote("v1", "n1", "remove", obs.voter_hash("subject-under-test", PEPPER))
    method, url, _, _ = fake.calls[-1]
    assert method == "DELETE" and "node_key=eq.n1" in url and "voter_hash=eq." in url

    [signal] = observer.signals("v1")
    assert (
        signal.votes == 7 and signal.learners == 20 and signal.share_pct == 35.0 and signal.triggers
    )
    read_urls = [c[1] for c in fake.calls if c[0] == "GET"]
    assert any("/observer_signals?" in u and "version_id=eq.v1" in u for u in read_urls)
    assert any("/observer_learners?" in u for u in read_urls)
    assert all(c[2].get("Accept-Profile") == "curriculum" for c in fake.calls if c[0] == "GET")


def test_the_project_store_refuses_rather_than_answering_from_nothing() -> None:
    class Down:
        def __call__(self, *args: Any) -> tuple[int, Any]:
            return 503, None

    store = obs.PostgrestObserverStore("https://project.invalid", "key", transport=Down())
    with pytest.raises(curriculum_store.StoreUnavailable):
        store.learner_counts("v1")


def test_without_a_project_the_observer_refuses_and_memory_is_only_by_name(monkeypatch) -> None:
    for name in (
        "OBSERVER_STORE",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_KEY",
        "OBSERVER_PEPPER",
    ):
        monkeypatch.delenv(name, raising=False)
    assert isinstance(obs.build_observer().store, obs.UnconfiguredObserverStore)
    monkeypatch.setenv("OBSERVER_STORE", "memory")
    assert isinstance(obs.build_observer().store, obs.InMemoryObserverStore)
    monkeypatch.delenv("OBSERVER_STORE")
    monkeypatch.setenv("SUPABASE_URL", "https://project.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    assert isinstance(obs.build_observer().store, obs.PostgrestObserverStore)
