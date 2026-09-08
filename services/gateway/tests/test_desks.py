"""The four desks, end to end: the intake, the queue, what a desk may see, and the trail.

Every test here fails without ``reports.py``, ``desks_api.py`` and migration 0017 — there was no
flag, no bug intake, no support queue and no refund queue anywhere in this codebase before them.
The suite mints REAL Supabase-shaped tokens and drives the real admin door
(``admin_auth.admin_router``), so what is under test is the path that runs in production.

The failures these are shaped around:

* a child cannot raise a flag (a sign-in wall, a required text box, a reason list that does not
  cover "this upset me") — because a safety control nobody can use is not a safety control;
* a queue row leaks a learner's id, address or work to somebody triaging a typo;
* an unconfigured gateway answers "nothing has come in", swallowing a flag on the way in;
* a refund queue accepts a reason that implies a goodwill policy this product does not have, or
  settles one without a second confirmation and a sentence saying what was done.
"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from wobo_gateway import admin_auth, reports
from wobo_gateway.admin_auth import (
    ADMIN_PREFIX,
    OPERATOR,
    VIEWER,
    Admin,
    InMemoryAdminStore,
)
from wobo_gateway.desks_api import FEEDS
from wobo_gateway.reports import InMemoryReportStore, StoreUnavailable, UnconfiguredReportStore

LEARNER = "aaaaaaaa-1111-4111-8111-111111111111"
OTHER_LEARNER = "bbbbbbbb-2222-4222-8222-222222222222"
VIEWER_SUBJECT = "cccccccc-3333-4333-8333-333333333333"
OPERATOR_SUBJECT = "dddddddd-4444-4444-8444-444444444444"


@pytest.fixture(autouse=True)
def _desk_env(monkeypatch: pytest.MonkeyPatch) -> InMemoryAdminStore:
    """Fresh queues and a fresh register per test. Both stores asked for BY NAME."""
    monkeypatch.setenv("REPORTS_STORE", "memory")
    # The handle is an HMAC, so the suite gives it the key production takes from the service role.
    monkeypatch.setenv("REPORTS_HANDLE_PEPPER", "a-test-pepper-for-the-queue-handle")
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.delenv("ENV", raising=False)
    register = InMemoryAdminStore()
    admin_auth.set_store(register)
    admin_auth.reset_limiter()
    reports.set_store(InMemoryReportStore())
    yield register
    admin_auth.set_store(None)
    reports.set_store(None)


@pytest.fixture
def client() -> TestClient:
    from wobo_gateway.app import create_app

    return TestClient(create_app())


def _bearer(subject: str, **claims: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET, **claims)}"}


def _register(store: InMemoryAdminStore, subject: str, role: str) -> Admin:
    return store.upsert_admin(
        subject_id=subject, email=f"{role}@heywobo.com", role=role, granted_by=None,
        mfa_required=False,
    )


def _desk(client: TestClient, store: InMemoryAdminStore, subject: str, role: str) -> dict[str, str]:
    """Register somebody, sign them into the console, and hand back the headers a desk needs."""
    _register(store, subject, role)
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(subject))
    assert opened.status_code == 200, opened.text
    return {**_bearer(subject), admin_auth.SESSION_HEADER: opened.json()["session_token"]}


def _trail(store: InMemoryAdminStore) -> list[dict[str, Any]]:
    return list(store.audit)


# --- the intake --------------------------------------------------------------------------------
def test_a_flag_is_written_and_a_child_need_not_type_anything(client: TestClient) -> None:
    """The control in the app must not demand words, so the route must not either."""
    response = client.post("/v1/flags", json={"reason": "confusing"}, headers=_bearer(LEARNER))
    assert response.status_code == 200, response.text
    rows = reports.get_store().queue(kind="flag", state=None, limit=10)
    assert len(rows) == 1
    assert rows[0].reason == "confusing" and rows[0].note is None
    assert rows[0].state == "new" and rows[0].learner_id == LEARNER


def test_a_flag_works_without_signing_in(client: TestClient) -> None:
    """A sign-in wall in front of a safety control is a safety control nobody uses."""
    response = client.post(
        "/v1/flags", json={"reason": "unsafe"}, headers=_bearer(LEARNER, is_anonymous=True)
    )
    assert response.status_code == 200, response.text


def test_an_unsafe_flag_is_urgent_and_pages_at_once(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    paged: list[tuple[str, str, dict[str, Any]]] = []
    monkeypatch.setattr(
        reports.alerts,
        "alert",
        lambda event, message, **kw: paged.append((event, message, kw)) or {},
    )
    body = client.post(
        "/v1/flags",
        json={"reason": "upsetting", "note": "it said something horrible"},
        headers=_bearer(LEARNER),
    ).json()
    assert body["urgent"] is True
    assert paged and paged[0][0] == reports.URGENT_FLAG_ALERT
    # The alarm says one exists. It never carries the child's words.
    assert "horrible" not in str(paged[0])


def test_a_wrong_answer_flag_does_not_page(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    paged: list[str] = []
    monkeypatch.setattr(
        reports.alerts, "alert", lambda event, message, **kw: paged.append(event) or {}
    )
    client.post("/v1/flags", json={"reason": "wrong"}, headers=_bearer(LEARNER))
    assert paged == []


def test_an_urgent_flag_sits_above_everything_else(client: TestClient) -> None:
    client.post("/v1/flags", json={"reason": "wrong"}, headers=_bearer(LEARNER))
    client.post("/v1/flags", json={"reason": "unsafe"}, headers=_bearer(OTHER_LEARNER))
    rows = reports.get_store().queue(kind="flag", state=None, limit=10)
    assert rows[0].reason == "unsafe"


def test_a_reason_the_route_does_not_know_is_refused(client: TestClient) -> None:
    response = client.post(
        "/v1/flags", json={"reason": "i just dont like it"}, headers=_bearer(LEARNER)
    )
    assert response.status_code == 422
    assert response.json()["detail"]["field"] == "reason"


def test_a_bug_reason_cannot_be_filed_as_a_flag(client: TestClient) -> None:
    """The reason belongs to the kind, in the route and again in the database."""
    assert (
        client.post("/v1/flags", json={"reason": "wont_load"}, headers=_bearer(LEARNER)).status_code
        == 422
    )


def test_about_keeps_the_pointers_and_drops_the_learners_work(client: TestClient) -> None:
    """The one place a client could otherwise post a child's homework into the operator plane."""
    client.post(
        "/v1/flags",
        json={
            "reason": "wrong",
            "about": {
                "surface": "board",
                "content_id": "concept-42",
                "transcript": "the whole conversation",
                "answer": "x = 4",
            },
        },
        headers=_bearer(LEARNER),
    )
    kept = reports.get_store().queue(kind="flag", state=None, limit=1)[0].about or {}
    assert kept == {"surface": "board", "content_id": "concept-42"}


def test_one_learner_cannot_bury_the_queue(client: TestClient) -> None:
    for _ in range(reports.REPORTS_PER_DAY):
        assert (
            client.post(
                "/v1/flags", json={"reason": "wrong"}, headers=_bearer(LEARNER)
            ).status_code
            == 200
        )
    refused = client.post("/v1/flags", json={"reason": "wrong"}, headers=_bearer(LEARNER))
    assert refused.status_code == 429
    assert refused.json()["detail"]["code"] == "enough_for_today"
    # And somebody else is unaffected: the cap is per learner, not per desk.
    assert (
        client.post(
            "/v1/flags", json={"reason": "wrong"}, headers=_bearer(OTHER_LEARNER)
        ).status_code
        == 200
    )


def test_support_and_refund_need_a_signed_in_account(client: TestClient) -> None:
    for path, reason in (
        ("/v1/support/message", "account"),
        ("/v1/refund-request", "charged_twice"),
    ):
        response = client.post(
            path,
            json={"reason": reason, "note": "hello"},
            headers=_bearer(LEARNER, is_anonymous=True),
        )
        assert response.status_code == 401, path


def test_support_and_refund_need_words_to_answer(client: TestClient) -> None:
    response = client.post(
        "/v1/support/message", json={"reason": "account"}, headers=_bearer(LEARNER)
    )
    assert response.status_code == 422
    assert response.json()["detail"]["field"] == "note"


@pytest.mark.parametrize(
    "reason",
    ["charged_after_cancelling", "charged_twice", "not_authorised", "not_supplied", "cooling_off"],
)
def test_the_five_refunds_the_law_gives_are_accepted(client: TestClient, reason: str) -> None:
    response = client.post(
        "/v1/refund-request",
        json={"reason": reason, "note": "It was taken on the 3rd."},
        headers=_bearer(LEARNER),
    )
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("reason", ["changed_my_mind", "goodwill", "not_using_it", "too_expensive"])
def test_a_refund_we_do_not_do_cannot_even_be_asked_for(client: TestClient, reason: str) -> None:
    """docs/legal/refund-and-cancellation.md §5: no goodwill refund. A queue that accepted one
    would imply a policy this product does not have."""
    response = client.post(
        "/v1/refund-request", json={"reason": reason, "note": "please"}, headers=_bearer(LEARNER)
    )
    assert response.status_code == 422


def test_the_refund_answer_points_at_cancelling_and_promises_nothing(client: TestClient) -> None:
    body = client.post(
        "/v1/refund-request",
        json={"reason": "charged_twice", "note": "twice in March"},
        headers=_bearer(LEARNER),
    ).json()
    said = body["message"].lower()
    assert "cancel" in said
    for never in ("refund you", "money back", "we will return", "guarantee", "sorry"):
        assert never not in said


def test_an_unconfigured_gateway_refuses_a_flag_rather_than_swallowing_it(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No project and no REPORTS_STORE=memory. An in-memory fallback would accept a child's flag,
    answer "thank you", and lose it at the next restart."""
    monkeypatch.delenv("REPORTS_STORE", raising=False)
    reports.set_store(None)
    assert isinstance(reports.get_store(), UnconfiguredReportStore)
    response = client.post("/v1/flags", json={"reason": "unsafe"}, headers=_bearer(LEARNER))
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "desk_unavailable"


# --- the door ----------------------------------------------------------------------------------
DESK_ROUTES = (
    ("GET", f"{ADMIN_PREFIX}/desks"),
    ("GET", f"{ADMIN_PREFIX}/reports"),
)


@pytest.mark.parametrize(("method", "path"), DESK_ROUTES)
def test_a_signed_in_learner_reaches_no_desk(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, headers=_bearer(LEARNER))
    assert response.status_code == 403
    assert response.json()["detail"]["message"] == admin_auth.NOT_FOR_YOU


def test_every_desk_route_is_behind_the_guard(client: TestClient) -> None:
    """Guarded by construction. If a route is ever added to this router without the door, the
    walk below finds it — the same proof ``test_admin_guard.py`` makes for the console."""
    from wobo_gateway.admin_auth import guard, iter_api_routes, route_dependencies
    from wobo_gateway.app import create_app

    app = create_app()
    desk_paths = (f"{ADMIN_PREFIX}/desks", f"{ADMIN_PREFIX}/reports")
    seen = 0
    for path, route, _added in iter_api_routes(app):
        if path.startswith(desk_paths):
            seen += 1
            assert guard in route_dependencies(route), path
    assert seen >= 4, "the desks did not mount"


# --- what a desk sees --------------------------------------------------------------------------
def test_a_queue_row_carries_no_learner_id_and_no_address(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _desk(client, _desk_env, OPERATOR_SUBJECT, OPERATOR)
    client.post(
        "/v1/support/message",
        json={"reason": "plan", "note": "cannot cancel", "reply_to": "a.parent@example.test"},
        headers=_bearer(LEARNER),
    )
    row = client.get(f"{ADMIN_PREFIX}/reports", headers=headers).json()["reports"][0]
    assert "learner_id" not in row and "reply_to" not in row
    assert LEARNER not in str(row) and "a.parent@example.test" not in str(row)
    # Enough to notice the same person twice in one morning, and no more. It is a KEYED DIGEST and
    # not a slice of the id: a raw prefix would match against the full id `/reports/who` returns
    # for the same child's refund row, which is how the flag desk's refusal to identify anybody
    # used to be defeated by looking at a different desk.
    assert row["handle"] != LEARNER[:8]
    assert not LEARNER.startswith(row["handle"])
    assert len(row["handle"]) == 8
    # The words are there: they are the substance of the report.
    assert row["note"] == "cannot cancel"


def test_identity_is_a_separate_route_a_separate_permission_and_its_own_trail_line(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _desk(client, _desk_env, OPERATOR_SUBJECT, OPERATOR)
    client.post(
        "/v1/refund-request",
        json={"reason": "charged_twice", "note": "twice in March", "reply_to": "p@example.test"},
        headers=_bearer(LEARNER),
    )
    report_id = client.get(f"{ADMIN_PREFIX}/reports", headers=headers).json()["reports"][0]["id"]
    who = client.get(f"{ADMIN_PREFIX}/reports/who", params={"id": report_id}, headers=headers)
    assert who.status_code == 200
    assert who.json() == {
        "id": report_id,
        "learner_id": LEARNER,
        "reply_to": "p@example.test",
    }
    assert any(line["action"] == "desk.report.identify" for line in _trail(_desk_env))


def test_a_flag_never_identifies_anybody(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    """A flag is fixed by changing the product, so nobody needs to know whose it was."""
    headers = _desk(client, _desk_env, OPERATOR_SUBJECT, OPERATOR)
    client.post("/v1/flags", json={"reason": "wrong"}, headers=_bearer(LEARNER))
    report_id = client.get(f"{ADMIN_PREFIX}/reports", headers=headers).json()["reports"][0]["id"]
    refused = client.get(f"{ADMIN_PREFIX}/reports/who", params={"id": report_id}, headers=headers)
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "not_needed"
    # And the refusal is in the trail too: an attempt to identify is worth knowing about.
    denied = [line for line in _trail(_desk_env) if line["action"] == "desk.report.identify"]
    assert denied and denied[-1]["decision"] == "denied"


def test_a_viewer_may_read_a_queue_and_may_not_move_a_report(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _desk(client, _desk_env, VIEWER_SUBJECT, VIEWER)
    client.post("/v1/flags", json={"reason": "wrong"}, headers=_bearer(LEARNER))
    listing = client.get(f"{ADMIN_PREFIX}/reports", headers=headers)
    assert listing.status_code == 200
    report_id = listing.json()["reports"][0]["id"]
    moved = client.post(
        f"{ADMIN_PREFIX}/reports/state", json={"id": report_id, "state": "looked_at"}, headers=headers
    )
    assert moved.status_code == 403
    assert moved.json()["detail"]["code"] == "not_permitted"


def test_moving_a_report_names_who_moved_it_and_lands_in_the_trail(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _desk(client, _desk_env, OPERATOR_SUBJECT, OPERATOR)
    client.post("/v1/flags", json={"reason": "wrong"}, headers=_bearer(LEARNER))
    report_id = client.get(f"{ADMIN_PREFIX}/reports", headers=headers).json()["reports"][0]["id"]
    moved = client.post(
        f"{ADMIN_PREFIX}/reports/state", json={"id": report_id, "state": "acted_on"}, headers=headers
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["state"] == "acted_on"
    assert moved.json()["moved_by"] == "operator@heywobo.com"
    line = next(e for e in _trail(_desk_env) if e["action"] == "desk.report.state")
    assert line["detail"]["was"] == "new" and line["detail"]["now"] == "acted_on"


def test_a_report_cannot_be_pushed_back_to_new(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    """Back to `new` would erase that somebody looked, and the row would contradict the trail."""
    headers = _desk(client, _desk_env, OPERATOR_SUBJECT, OPERATOR)
    client.post("/v1/flags", json={"reason": "wrong"}, headers=_bearer(LEARNER))
    report_id = client.get(f"{ADMIN_PREFIX}/reports", headers=headers).json()["reports"][0]["id"]
    url = f"{ADMIN_PREFIX}/reports/state"
    assert client.post(url, json={"id": report_id, "state": "looked_at"}, headers=headers).status_code == 200
    assert client.post(url, json={"id": report_id, "state": "new"}, headers=headers).status_code == 422


def test_settling_a_refund_needs_a_second_confirmation_and_a_sentence(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _desk(client, _desk_env, OPERATOR_SUBJECT, OPERATOR)
    client.post(
        "/v1/refund-request",
        json={"reason": "charged_after_cancelling", "note": "charged on the 3rd"},
        headers=_bearer(LEARNER),
    )
    report_id = client.get(f"{ADMIN_PREFIX}/reports", headers=headers).json()["reports"][0]["id"]
    url = f"{ADMIN_PREFIX}/reports/state"

    # Triage needs neither. Settling needs both.
    assert client.post(url, json={"id": report_id, "state": "looked_at"}, headers=headers).status_code == 200
    unconfirmed = client.post(url, json={"id": report_id, "state": "acted_on"}, headers=headers)
    assert unconfirmed.status_code == 409
    assert unconfirmed.json()["detail"]["code"] == "confirm_required"
    wordless = client.post(url, json={"id": report_id, "state": "acted_on", "confirm": True}, headers=headers)
    assert wordless.status_code == 422
    done = client.post(
        url,
        json={
            "id": report_id,
            "state": "acted_on",
            "confirm": True,
            "resolution": "Duplicate returned in full.",
        },
        headers=headers,
    )
    assert done.status_code == 200, done.text
    assert done.json()["resolution"] == "Duplicate returned in full."
    line = next(
        entry
        for entry in _trail(_desk_env)
        if entry["detail"].get("now") == "acted_on" and entry["decision"] == "allowed"
    )
    assert line["detail"]["confirmed"] is True


def test_a_flag_is_settled_without_the_money_ceremony(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    """The second confirmation is asked for where money is, and nowhere else — a desk that asks
    for one on every row trains a person to click through it."""
    headers = _desk(client, _desk_env, OPERATOR_SUBJECT, OPERATOR)
    client.post("/v1/flags", json={"reason": "wrong"}, headers=_bearer(LEARNER))
    report_id = client.get(f"{ADMIN_PREFIX}/reports", headers=headers).json()["reports"][0]["id"]
    closed = client.post(
        f"{ADMIN_PREFIX}/reports/state", json={"id": report_id, "state": "closed"}, headers=headers
    )
    assert closed.status_code == 200


# --- honesty -----------------------------------------------------------------------------------
def test_the_summary_counts_only_what_is_actually_there(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _desk(client, _desk_env, VIEWER_SUBJECT, VIEWER)
    empty = client.get(f"{ADMIN_PREFIX}/desks", headers=headers).json()
    assert empty["readable"] is True
    assert {k: v["total"] for k, v in empty["desks"].items()} == {
        "flag": 0,
        "bug": 0,
        "support": 0,
        "refund": 0,
    }
    client.post("/v1/flags", json={"reason": "unsafe"}, headers=_bearer(LEARNER))
    client.post("/v1/report/bug", json={"reason": "broken"}, headers=_bearer(OTHER_LEARNER))
    after = client.get(f"{ADMIN_PREFIX}/desks", headers=headers).json()["desks"]
    assert after["flag"] == {
        "states": {"new": 1, "looked_at": 0, "acted_on": 0, "closed": 0},
        "open": 1,
        "urgent": 1,
        "total": 1,
    }
    assert after["bug"]["total"] == 1 and after["bug"]["urgent"] == 0


def test_a_desk_that_cannot_be_read_shows_no_numbers_at_all(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    """`readable: false` and NO counts. A zero would say "nothing came in"; this says "I could
    not ask", and the two mean opposite things."""
    headers = _desk(client, _desk_env, VIEWER_SUBJECT, VIEWER)
    reports.set_store(UnconfiguredReportStore())
    body = client.get(f"{ADMIN_PREFIX}/desks", headers=headers).json()
    assert body["readable"] is False
    assert body["desks"] == {}
    listing = client.get(f"{ADMIN_PREFIX}/reports", headers=headers).json()
    assert listing["readable"] is False and listing["reports"] == []


def test_every_desk_says_what_actually_feeds_it(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    """The honest empty state, served by the route rather than written into a component."""
    headers = _desk(client, _desk_env, VIEWER_SUBJECT, VIEWER)
    feeds = client.get(f"{ADMIN_PREFIX}/desks", headers=headers).json()["feeds"]
    assert set(feeds) == set(reports.KINDS)
    for kind, lines in feeds.items():
        assert {"what", "feeds", "missing"} <= set(lines), kind
        assert len(lines["what"]) > 20 and len(lines["missing"]) > 20
    # The truths this repo has to keep saying out loud until they stop being true.
    assert "mailto" in FEEDS["support"]["missing"]
    assert "goodwill" in FEEDS["refund"]["missing"]
    assert "No control in the app calls it yet" in FEEDS["bug"]["missing"]


def test_the_flag_desk_no_longer_says_the_control_has_not_shipped(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    """It shipped on 5 September 2026 and this desk went on saying it had not.

    ``ui/FlagControl.tsx`` is mounted in ``shell/AppFrame.tsx`` and ``wobo/Stage.tsx`` and posts
    to /v1/flags, and ``docs/legal/community-and-flags.md`` no longer sends anybody to the
    mailbox instead. An operator reading this desk was being told the queue could not be filling
    when it can, which is the one thing an empty-state sentence must never do.
    """
    headers = _desk(client, _desk_env, VIEWER_SUBJECT, VIEWER)
    flag = client.get(f"{ADMIN_PREFIX}/desks", headers=headers).json()["feeds"]["flag"]
    for stale in ("not in the app yet", "until it ships", "the mailbox is the route"):
        assert stale not in flag["missing"].lower(), stale
    assert "/v1/flags" in flag["feeds"]
    # And what IS still missing is named, so the desk stays an honest empty state.
    assert "picture of the screen" in flag["missing"]


def test_the_unconfigured_store_refuses_rather_than_returning_an_empty_queue() -> None:
    with pytest.raises(StoreUnavailable):
        UnconfiguredReportStore().queue(kind="flag", state=None, limit=10)


def test_the_intakes_are_bounded_per_caller() -> None:
    """Each of them writes a row and each is reachable by anyone holding a token."""
    from wobo_gateway import app as app_mod

    text = open(str(app_mod.__file__)).read()  # noqa: SIM115, PTH123
    assert "REPORT_LIMITED_PATHS" in text
    assert {
        "/v1/flags",
        "/v1/report/bug",
        "/v1/support/message",
        "/v1/refund-request",
    } == reports.LIMITED_PATHS
