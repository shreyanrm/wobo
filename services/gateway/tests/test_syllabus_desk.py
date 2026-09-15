"""The console's syllabus desk: the queue, what landed, what refused and why, and what it cost.

``docs/BOARD-COLD-START.md`` §4 asks for it in one line — *"the console shows the queue, what has
landed, what refused and why"* — and §5 for the money beside it: *"a budget per board and per day,
on the console with an alert"*, and *"a refusal is remembered … and it goes to the console
instead"*. The two buttons are §5's other half: retry a refusal, and promote a provisional version
to verified **after a person has read it** ("it is labelled provisional until a person confirms it.
That gate already exists and does not move.").

The one rule about labels: they are DERIVED (``curriculum/labels.py``) and this desk shows which
one each board is showing and WHY. It never invents a sentence and never passes one in.
"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from wobo_gateway import admin_auth, doors
from wobo_gateway.admin_auth import (
    ADMIN_PREFIX,
    OPERATOR,
    OWNER,
    VIEWER,
    InMemoryAdminStore,
)
from wobo_gateway.curriculum import labels
from wobo_gateway.curriculum import store as curriculum_store
from wobo_gateway.curriculum.desk import syllabus_desk
from wobo_gateway.curriculum.discovery import prewarm
from wobo_gateway.curriculum.models import (
    Framework,
    FrameworkKind,
    JobState,
    Node,
    NodeKind,
    Status,
    Version,
)
from wobo_gateway.curriculum.store import InMemoryStore, Seed

VIEWER_SUBJECT = "cccccccc-3333-4333-8333-333333333333"
OPERATOR_SUBJECT = "dddddddd-4444-4444-8444-444444444444"
OWNER_SUBJECT = "eeeeeeee-5555-4555-8555-555555555555"

CBSE = Framework(
    id="cbse",
    name="Central Board of Secondary Education",
    kind=FrameworkKind.NATIONAL,
    status=Status.VERIFIED,
    country="IN",
    levels=("Class 9", "Class 10"),
)
UPMSP = Framework(
    id="upmsp",
    name="Board of High School and Intermediate Education Uttar Pradesh",
    kind=FrameworkKind.STATE,
    status=Status.VERIFIED,
    country="IN",
    levels=("Class 9", "Class 10"),
    official_site="https://upmsp.edu.in",
)
MSBSHSE = Framework(
    id="msbshse",
    name="Maharashtra State Board",
    kind=FrameworkKind.STATE,
    status=Status.VERIFIED,
    country="IN",
    levels=("Class 9", "Class 10"),
)


def world() -> InMemoryStore:
    """CBSE with a provisional 2026-27 reading; Uttar Pradesh and Maharashtra with nothing."""
    store = InMemoryStore(Seed(frameworks=[CBSE, UPMSP, MSBSHSE]))
    version = Version(
        id="cbse-2026",
        framework_id="cbse",
        label="2026-27",
        status=Status.PROVISIONAL,
        published_at="2026-09-01T00:00:00Z",
        source_url="https://cbseacademic.nic.in/maths.pdf",
        document_hash="c" * 64,
    )
    store.put_version(version)
    level = Node(id="cbse-l", version_id=version.id, kind=NodeKind.LEVEL, name="Class 10")
    subject = Node(
        id="cbse-s",
        version_id=version.id,
        kind=NodeKind.SUBJECT,
        parent_id=level.id,
        name="Mathematics",
    )
    unit = Node(
        id="cbse-u",
        version_id=version.id,
        kind=NodeKind.UNIT,
        parent_id=subject.id,
        name="UNIT I: NUMBER SYSTEMS",
    )
    store.put_nodes([level, subject, unit])
    return store


@pytest.fixture
def dials(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DOORS_STORE", "memory")
    store = doors.InMemorySettingsStore()
    doors.set_store(store)
    yield store
    doors.set_store(None)


@pytest.fixture
def store(dials) -> InMemoryStore:
    made = world()
    curriculum_store.set_store(made)
    yield made
    curriculum_store.set_store(None)


# --- the reading -----------------------------------------------------------------------------
def test_the_desk_says_whether_the_worker_is_even_running(store, monkeypatch) -> None:
    monkeypatch.delenv("WOBO_DISCOVERY_WORKER", raising=False)
    view = syllabus_desk(store)
    assert view["worker"]["enabled"] is False
    assert view["worker"]["env"] == "WOBO_DISCOVERY_WORKER"
    monkeypatch.setenv("WOBO_DISCOVERY_WORKER", "1")
    assert syllabus_desk(store)["worker"]["enabled"] is True


def test_every_board_carries_the_label_it_shows_and_the_reason_it_shows_it(store) -> None:
    boards = {row["framework_id"]: row for row in syllabus_desk(store)["boards"]}
    cbse, up = boards["cbse"], boards["upmsp"]

    assert cbse["label"] == labels.label_for(CBSE, store.get_version("cbse-2026"))
    assert cbse["status"] == "provisional" and cbse["has_syllabus"] is True
    assert "second reader" in cbse["why"] or "person" in cbse["why"]

    assert up["label"] == labels.board_label(UPMSP)
    assert up["has_syllabus"] is False
    assert up["why"], "a board with nothing read still says why it reads the way it does"


def test_the_label_is_derived_and_never_handed_in(store) -> None:
    """Every label on the desk comes back out of ``labels``, so a desk cannot show a syllabus as
    verified that nothing verified."""
    for row in syllabus_desk(store)["boards"]:
        framework = store.get_framework(row["framework_id"])
        version = store.get_version(row["version_id"]) if row["version_id"] else None
        assert row["label"] == labels.label_for(framework, version)


def test_the_queue_is_what_is_waiting_and_says_who_is_waiting_on_it(store) -> None:
    learner = store.enqueue_discovery(
        query="upmsp",
        framework_id="upmsp",
        level="Class 10",
        subject="Mathematics",
        requested_by="learner-a",
    )
    prewarm.enqueue(store, prewarm.plan(store, limit=1))
    queue = syllabus_desk(store)["queue"]
    assert queue[0]["job_id"] == learner.id
    assert queue[0]["waiting_on"] == "a learner"
    assert any(row["waiting_on"] == "the prewarm" for row in queue)
    assert all("requested_by" not in row for row in queue), "never a learner id on a console row"


def test_a_refusal_carries_its_reason_its_line_and_what_it_cost(store) -> None:
    job = store.enqueue_discovery(
        query="upmsp", framework_id="upmsp", level="Class 10", subject="Mathematics"
    )
    store.update_job(
        job.id,
        state=JobState.REFUSED,
        message="I could not find an official syllabus for that.",
        result={"reason": "not_found", "cost_usd": 0.04},
    )
    refused = syllabus_desk(store)["refused"]
    assert len(refused) == 1
    assert refused[0]["reason"] == "not_found"
    assert refused[0]["message"].startswith("I could not find")
    assert refused[0]["cost_usd"] == pytest.approx(0.04)
    assert refused[0]["framework_name"] == UPMSP.name


def test_what_a_board_cost_is_summed_from_its_own_jobs(store) -> None:
    for subject, cost in (("Mathematics", 0.12), ("Science", 0.08)):
        job = store.enqueue_discovery(
            query="upmsp", framework_id="upmsp", level="Class 10", subject=subject
        )
        store.update_job(job.id, state=JobState.STORED, result={"cost_usd": cost})
    spend = {row["framework_id"]: row for row in syllabus_desk(store)["cost"]}
    assert spend["upmsp"]["usd"] == pytest.approx(0.20)
    assert spend["upmsp"]["jobs"] == 2


def test_an_unpriced_job_is_counted_and_never_added_as_a_zero(store) -> None:
    job = store.enqueue_discovery(
        query="upmsp", framework_id="upmsp", level="Class 10", subject="Mathematics"
    )
    store.update_job(job.id, state=JobState.STORED, result={"kind": "discovery"})
    row = next(r for r in syllabus_desk(store)["cost"] if r["framework_id"] == "upmsp")
    assert row["usd"] is None and row["unpriced"] == 1


def test_the_day_is_shown_against_its_ceiling(store) -> None:
    from wobo_gateway import spend as spend_mod

    spend_mod.reset()
    spend_mod.record(0.42, capability="curriculum.discovery")
    day = syllabus_desk(store)["day"]
    assert day["spent_usd"] == pytest.approx(0.42)
    assert day["ceiling_usd"] == pytest.approx(spend_mod.ceiling_usd())
    spend_mod.reset()


def test_the_prewarm_queue_is_shown_in_its_order_with_what_puts_it_there(store) -> None:
    view = syllabus_desk(store)["prewarm"]
    assert view["enabled"] is True and view["source"] == "seed"
    ids = [row["framework_id"] for row in view["order"]]
    assert ids[0] == "upmsp" and "msbshse" in ids
    assert "million school students" in view["order"][0]["note"]
    assert view["editable_key"] == prewarm.ORDER_KEY
    assert [row["framework_id"] for row in view["next"]][:1] == ["upmsp"]


def test_a_registry_that_cannot_be_reached_says_so_rather_than_showing_an_empty_desk() -> None:
    class Down:
        def __getattr__(self, name: str):
            def raise_it(*a: Any, **k: Any):
                raise curriculum_store.StoreUnavailable("no registry")

            return raise_it

    view = syllabus_desk(Down())
    assert view["readable"] is False and view["boards"] == []


# --- the door --------------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _door(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.delenv("ENV", raising=False)
    register = InMemoryAdminStore()
    admin_auth.set_store(register)
    admin_auth.reset_limiter()
    yield register
    admin_auth.set_store(None)


@pytest.fixture
def client() -> TestClient:
    from wobo_gateway.app import create_app

    return TestClient(create_app())


def seat(
    client: TestClient, register: InMemoryAdminStore, subject: str, role: str
) -> dict[str, str]:
    register.upsert_admin(
        subject_id=subject,
        email=f"{role}@heywobo.com",
        role=role,
        granted_by=None,
        mfa_required=False,
    )
    bearer = {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET)}"}
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=bearer)
    assert opened.status_code == 200, opened.text
    return {**bearer, admin_auth.SESSION_HEADER: opened.json()["session_token"]}


def test_a_viewer_reads_the_desk(client, _door, store) -> None:
    headers = seat(client, _door, VIEWER_SUBJECT, VIEWER)
    answer = client.get(f"{ADMIN_PREFIX}/syllabus", headers=headers)
    assert answer.status_code == 200
    body = answer.json()
    assert body["readable"] is True and body["boards"]


def test_a_stranger_reads_nothing(client, store) -> None:
    assert client.get(f"{ADMIN_PREFIX}/syllabus").status_code in (401, 403, 404)


def test_an_operator_retries_a_refusal_and_it_goes_back_in_the_queue(client, _door, store) -> None:
    job = store.enqueue_discovery(
        query="upmsp", framework_id="upmsp", level="Class 10", subject="Mathematics"
    )
    store.update_job(job.id, state=JobState.REFUSED, message="nothing found")
    headers = seat(client, _door, OPERATOR_SUBJECT, OPERATOR)
    answer = client.post(f"{ADMIN_PREFIX}/syllabus/retry", headers=headers, json={"job_id": job.id})
    assert answer.status_code == 200, answer.text
    assert store.get_job(job.id).state is JobState.QUEUED


def test_a_viewer_may_not_retry(client, _door, store) -> None:
    job = store.enqueue_discovery(
        query="upmsp", framework_id="upmsp", level="Class 10", subject="Mathematics"
    )
    store.update_job(job.id, state=JobState.REFUSED, message="nothing found")
    headers = seat(client, _door, VIEWER_SUBJECT, VIEWER)
    answer = client.post(f"{ADMIN_PREFIX}/syllabus/retry", headers=headers, json={"job_id": job.id})
    assert answer.status_code in (401, 403)
    assert store.get_job(job.id).state is JobState.REFUSED


def test_a_job_that_is_still_running_is_not_retried(client, _door, store) -> None:
    job = store.enqueue_discovery(
        query="upmsp", framework_id="upmsp", level="Class 10", subject="Mathematics"
    )
    headers = seat(client, _door, OPERATOR_SUBJECT, OPERATOR)
    answer = client.post(f"{ADMIN_PREFIX}/syllabus/retry", headers=headers, json={"job_id": job.id})
    assert answer.status_code == 409


# --- promotion is a person's act -------------------------------------------------------------
def test_the_owner_promotes_a_provisional_version_after_reading_it(client, _door, store) -> None:
    headers = seat(client, _door, OWNER_SUBJECT, OWNER)
    answer = client.post(
        f"{ADMIN_PREFIX}/syllabus/promote",
        headers=headers,
        json={"version_id": "cbse-2026", "read": True},
    )
    assert answer.status_code == 200, answer.text
    assert store.get_version("cbse-2026").status is Status.VERIFIED
    assert answer.json()["label"] == labels.label_for(CBSE, store.get_version("cbse-2026"))


def test_promotion_without_saying_a_person_read_it_is_refused(client, _door, store) -> None:
    headers = seat(client, _door, OWNER_SUBJECT, OWNER)
    answer = client.post(
        f"{ADMIN_PREFIX}/syllabus/promote", headers=headers, json={"version_id": "cbse-2026"}
    )
    assert answer.status_code == 409
    assert store.get_version("cbse-2026").status is Status.PROVISIONAL


def test_an_operator_may_not_promote(client, _door, store) -> None:
    headers = seat(client, _door, OPERATOR_SUBJECT, OPERATOR)
    answer = client.post(
        f"{ADMIN_PREFIX}/syllabus/promote",
        headers=headers,
        json={"version_id": "cbse-2026", "read": True},
    )
    assert answer.status_code in (401, 403)
    assert store.get_version("cbse-2026").status is Status.PROVISIONAL


def test_a_version_with_no_chapters_can_never_be_promoted(client, _door, store) -> None:
    store.put_version(
        Version(
            id="upmsp-empty",
            framework_id="upmsp",
            label="2026-27",
            status=Status.PROVISIONAL,
            published_at="2026-09-01T00:00:00Z",
        )
    )
    headers = seat(client, _door, OWNER_SUBJECT, OWNER)
    answer = client.post(
        f"{ADMIN_PREFIX}/syllabus/promote",
        headers=headers,
        json={"version_id": "upmsp-empty", "read": True},
    )
    assert answer.status_code == 409
    assert store.get_version("upmsp-empty").status is Status.PROVISIONAL


# --- the order is the owner's ------------------------------------------------------------------
def test_the_owner_reorders_the_prewarm_queue(client, _door, store, dials) -> None:
    headers = seat(client, _door, OWNER_SUBJECT, OWNER)
    answer = client.post(
        f"{ADMIN_PREFIX}/syllabus/prewarm",
        headers=headers,
        json={"order": ["msbshse", "upmsp"]},
    )
    assert answer.status_code == 200, answer.text
    assert dials.read(prewarm.ORDER_KEY) == ["msbshse", "upmsp"]
    assert answer.json()["order"] == ["msbshse", "upmsp"]


def test_an_order_naming_a_board_we_do_not_hold_is_refused_with_the_name(
    client, _door, store, dials
) -> None:
    headers = seat(client, _door, OWNER_SUBJECT, OWNER)
    answer = client.post(
        f"{ADMIN_PREFIX}/syllabus/prewarm", headers=headers, json={"order": ["atlantis-board"]}
    )
    assert answer.status_code == 422
    assert "atlantis-board" in answer.text
    assert dials.read(prewarm.ORDER_KEY) is None


def test_the_owner_switches_the_prewarm_off(client, _door, store, dials) -> None:
    headers = seat(client, _door, OWNER_SUBJECT, OWNER)
    answer = client.post(
        f"{ADMIN_PREFIX}/syllabus/prewarm", headers=headers, json={"enabled": False}
    )
    assert answer.status_code == 200
    assert prewarm.enabled() is False


def test_an_operator_may_not_turn_the_queue(client, _door, store, dials) -> None:
    headers = seat(client, _door, OPERATOR_SUBJECT, OPERATOR)
    answer = client.post(
        f"{ADMIN_PREFIX}/syllabus/prewarm", headers=headers, json={"order": ["msbshse"]}
    )
    assert answer.status_code in (401, 403)
    assert dials.read(prewarm.ORDER_KEY) is None


# --- the production read ------------------------------------------------------------------------
def test_the_desk_reads_the_real_store_the_way_the_console_will() -> None:
    """The console desk runs against PostgREST in production, so the one read it added there is
    proved here rather than only against the in-memory store: newest first, every state, one page.

    The in-memory store is what every other test in this file drives. A desk that worked there and
    asked PostgREST for the wrong order would show an operator the oldest refusals and call them
    the latest, which is the failure mode this asserts away.
    """
    from test_curriculum_store import FakeRest
    from wobo_gateway.curriculum.store import PostgrestStore

    rows = [
        {
            "id": "old",
            "query": "upmsp",
            "state": "refused",
            "framework_id": "upmsp",
            "updated_at": "2026-09-01T00:00:00Z",
        },
        {
            "id": "new",
            "query": "bseb",
            "state": "stored",
            "framework_id": "bseb",
            "updated_at": "2026-09-14T00:00:00Z",
        },
    ]
    fake = FakeRest({"discovery_jobs": rows})
    store = PostgrestStore("https://project.invalid", "key", transport=fake)
    assert [job.id for job in store.recent_jobs(limit=50)] == ["old", "new"]
    # PostgREST does the ordering; what this pins is the QUERY the store sends it.
    assert "order=updated_at.desc.nullslast%2Ccreated_at.desc" in fake.last_url
    assert "limit=50" in fake.last_url
    assert "state=eq." not in fake.last_url, "the console reads every state, not just the open ones"
