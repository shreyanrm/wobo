"""The curriculum capabilities through the real door: POST /v1/capability/curriculum.*.

Same middleware, same verified token, same meter as every other capability. Mock mode only —
nothing here reaches a provider, because nothing here calls a model.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_curriculum_api import BOARD, V1, nodes
from wobo_gateway import budget
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.curriculum import store as store_mod
from wobo_gateway.curriculum.store import InMemoryStore, Seed
from wobo_gateway.providers import MockProvider
from wobo_gateway.registry import capabilities, policy
from wobo_gateway.routing import Tier
from wobo_gateway.telemetry import MetricsSink

CURRICULUM = tuple(name for name in capabilities() if name.startswith("curriculum."))


@pytest.fixture(autouse=True)
def _seeded_store() -> Iterator[InMemoryStore]:
    """The route reads the process-wide store; give it a small deterministic one."""
    store = InMemoryStore(Seed(frameworks=[BOARD], versions=[V1], nodes=nodes()))
    store_mod.set_store(store)
    yield store
    store_mod.set_store(None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def post(client: TestClient, name: str, payload: dict[str, Any], headers: dict[str, str]):
    return client.post(f"/v1/capability/{name}", json={"payload": payload}, headers=headers)


# --- the registry knows them ----------------------------------------------------------------------
def test_every_curriculum_capability_is_registered() -> None:
    from wobo_gateway.curriculum.api import CAPABILITIES

    assert set(CURRICULUM) == set(CAPABILITIES)


def test_they_all_sit_on_the_tiny_tier() -> None:
    """§9's tier for alias and catalog matching. Nothing here may buy a frontier context.

    The one exception is `curriculum.own.read`, which is not matching at all: it puts a learner's
    own document through the generate tier and is the only curriculum capability that calls a
    model. Everything else answers out of the registry.
    """
    for name in CURRICULUM:
        expected = Tier.GENERATE if name == "curriculum.own.read" else Tier.TINY
        assert policy(name).tier is expected, name
        assert not policy(name).elevated_only


def test_only_the_own_syllabus_intake_may_reach_a_model() -> None:
    """A tier above tiny is a cost. Exactly one capability here is allowed to spend it."""
    above_tiny = {name for name in CURRICULUM if policy(name).tier is not Tier.TINY}
    assert above_tiny == {"curriculum.own.read"}


def test_they_are_metered_on_the_cheap_counter() -> None:
    """A registry read is a database read, so it costs a turn — but it is still counted."""
    for name in CURRICULUM:
        if name == "curriculum.own.read":
            continue  # a model reads the learner's document; see the test below
        if name == "curriculum.blueprint":
            continue  # the pool the device chooses from; see the test below
        assert budget.classify(name) == budget.TURN, name


def test_the_pool_read_is_counted_but_never_spends_a_question() -> None:
    """The device chooses every module out of this one read (docs/LEARNING-MODEL.md, "Who
    chooses"), so it is counted on its own counter and never on the learner's turns
    (``tests/test_pool_read_costs_no_turn.py`` plays it)."""
    assert budget.classify("curriculum.blueprint") == budget.READ


def test_the_own_syllabus_intake_is_metered_as_a_generation() -> None:
    """It is the one curriculum call that puts a document through a model, so it costs like one."""
    assert budget.classify("curriculum.own.read") == budget.GENERATION
    # The taps after it only move an object the learner already owns.
    for name in ("curriculum.own.confirm", "curriculum.own.publish", "curriculum.own.offer"):
        assert budget.classify(name) == budget.TURN, name


def test_the_capability_list_never_leaks_a_model(client: TestClient, auth) -> None:
    listing = client.get("/v1/capabilities", headers=auth())
    listed = {row["capability"] for row in listing.json()}
    assert set(CURRICULUM) <= listed
    body = listing.text.lower()
    for banned in ("gpt", "claude", "luna", "terra"):
        assert banned not in body


# --- the door -------------------------------------------------------------------------------------
def test_an_unauthenticated_search_is_refused(client: TestClient) -> None:
    assert post(client, "curriculum.search", {"q": "cbse"}, {}).status_code == 401


def test_a_verified_learner_gets_the_registry(client: TestClient, auth) -> None:
    response = post(client, "curriculum.search", {"q": "cbse"}, auth())
    assert response.status_code == 200
    body = response.json()
    assert body["capability"] == "curriculum.search"
    assert body["output"]["results"][0]["id"] == "cbse"
    assert body["output"]["not_listed"]["action"] == "own_syllabus"


def test_the_response_never_carries_a_model_id(client: TestClient, auth) -> None:
    body = post(client, "curriculum.search", {"q": "cbse"}, auth()).json()
    assert "model" not in body  # served() strips it — the client holds no model name


# --- the meter ------------------------------------------------------------------------------------
def test_a_call_is_counted_and_reported(client: TestClient, auth) -> None:
    response = post(client, "curriculum.search", {"q": "cbse"}, auth())
    remaining = int(response.headers["X-Wobo-Budget-Remaining"])
    again = post(client, "curriculum.search", {"q": "cbse"}, auth())
    assert int(again.headers["X-Wobo-Budget-Remaining"]) == remaining - 1


def test_a_refusal_is_refunded(client: TestClient, auth) -> None:
    """A learner never pays for a call we did not serve."""
    before = client.get("/v1/me", headers=auth()).json()["budget"]["turns_remaining"]
    bad = post(client, "curriculum.framework", {"framework_id": "nope"}, auth())
    assert bad.status_code == 404
    after = client.get("/v1/me", headers=auth()).json()["budget"]["turns_remaining"]
    assert after == before


def test_the_day_can_run_out(client: TestClient, auth, monkeypatch) -> None:
    monkeypatch.setenv("FREE_DAILY_TURNS", "2")
    budget.reset()
    assert post(client, "curriculum.search", {"q": "a"}, auth()).status_code == 200
    assert post(client, "curriculum.search", {"q": "b"}, auth()).status_code == 200
    spent = post(client, "curriculum.search", {"q": "c"}, auth())
    assert spent.status_code == 429
    assert spent.json()["code"] == "budget_exhausted"


# --- the flows a learner actually walks -----------------------------------------------------------
def test_search_then_framework_then_units_then_topics(client: TestClient, auth) -> None:
    headers = auth()
    found = post(client, "curriculum.search", {"q": "cbse", "country": "IN"}, headers).json()
    framework_id = found["output"]["results"][0]["id"]

    framework = post(
        client, "curriculum.framework", {"framework_id": framework_id}, headers
    ).json()["output"]
    assert framework["levels"] == ["Class 9"]

    units = post(
        client,
        "curriculum.units",
        {"framework_id": framework_id, "level": "Class 9", "subject": "Science"},
        headers,
    ).json()["output"]
    assert units["status"] == "ready"
    assert units["label"].startswith("Official ")

    topics = post(
        client,
        "curriculum.topics",
        {"framework_id": framework_id, "unit_id": units["units"][0]["id"]},
        headers,
    ).json()["output"]
    assert [t["name"] for t in topics["topics"]] == ["Atoms", "Molecules"]


def test_a_missing_syllabus_returns_a_placeholder_and_never_a_chapter(
    client: TestClient, auth
) -> None:
    out = post(
        client,
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Mathematics"},
        auth(),
    ).json()["output"]
    assert out["units"] == []
    # The cold start: no chapters we do not hold, and no dead end either — the plan every board
    # shares, and the job queued behind it (docs/BOARD-COLD-START.md).
    assert out["status"] == "shared"
    assert out["plan"]["concepts"]
    assert out["not_listed"]["action"] == "own_syllabus"
    # Nothing drains `discovery_jobs` until the owner sets WOBO_DISCOVERY_WORKER, so a learner who
    # asks after the job is told the honest end and shown the door rather than "still looking"
    # (§4.6, api.discovery_worker_running). The row itself stays queued for the worker.
    job_id = out["job_id"]
    status = post(client, "curriculum.status", {"job_id": job_id}, auth()).json()["output"]
    assert status["state"] == "refused"
    assert status["not_listed"]["action"] == "own_syllabus"


def test_one_learners_overlay_is_invisible_to_another(client: TestClient, auth) -> None:
    mine, theirs = auth("learner-a"), auth("learner-b")
    applied = post(
        client,
        "curriculum.overlay.apply",
        {"framework_id": "cbse", "ops": [{"op": "remove", "node_id": "u2"}]},
        mine,
    )
    assert applied.status_code == 200
    payload = {"framework_id": "cbse", "level": "Class 9", "subject": "Science"}
    assert [
        u["name"] for u in post(client, "curriculum.units", payload, mine).json()["output"]["units"]
    ] == ["Matter"]
    assert [
        u["name"]
        for u in post(client, "curriculum.units", payload, theirs).json()["output"]["units"]
    ] == ["Matter", "Motion"]


def test_a_rejected_edit_is_a_400_in_wobos_voice(client: TestClient, auth) -> None:
    response = post(
        client,
        "curriculum.overlay.apply",
        {"framework_id": "cbse", "ops": [{"op": "detonate"}]},
        auth(),
    )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "overlay_rejected"
    assert "!" not in body["message"]


def test_an_oversized_patch_is_refused_at_the_capability(client: TestClient, auth) -> None:
    ops = [{"op": "not_in_my_school", "node_id": "u1"}] * 500
    response = post(
        client, "curriculum.overlay.apply", {"framework_id": "cbse", "ops": ops}, auth()
    )
    assert response.status_code == 400


def test_an_unknown_curriculum_capability_is_a_404(client: TestClient, auth) -> None:
    assert post(client, "curriculum.detonate", {}, auth()).status_code == 404


# --- the own-syllabus door (§6) ------------------------------------------------------------------
#
# The four capabilities behind "not listed? show me yours". Every other capability above offers
# that door on its dead ends, so a broken door here makes all of them lie.

PASTED = "\n".join(
    [
        "Class 9 Mathematics — scheme of study, St Xavier High School",
        "1. Number systems and surds",
        "2. Algebraic identities",
        "3. Coordinate geometry",
        "not a chapter, just a sentence about how we assess the year",
        "4. Triangles and congruence",
    ]
)

ABOUT = {
    "framework_name": "St Xavier scheme of work",
    "level": "Class 9",
    "subject": "Mathematics",
}


def read_own(client: TestClient, headers: dict[str, str], text: str = PASTED):
    return post(client, "curriculum.own.read", {"kind": "paste", "text": text, **ABOUT}, headers)


def test_a_pasted_syllabus_becomes_a_personal_framework(client: TestClient, auth) -> None:
    out = read_own(client, auth()).json()["output"]
    assert out["framework"]["kind"] == "personal"
    assert out["framework"]["status"] == "personal"
    assert out["label"] == "Drafted from your syllabus, check it"
    assert [u["name"] for u in out["units"]] == [
        "Number systems and surds",
        "Algebraic identities",
        "Coordinate geometry",
        "Triangles and congruence",
    ]
    assert all(not u["confirmed"] for u in out["units"])


def test_the_intake_reads_no_chapter_the_learner_did_not_write(client: TestClient, auth) -> None:
    """§12: a syllabus with no source is what kills this. A prose line is not a chapter."""
    names = [u["name"] for u in read_own(client, auth()).json()["output"]["units"]]
    assert not any("assess" in name for name in names)


def test_a_personal_framework_never_carries_an_owner_or_a_model(client: TestClient, auth) -> None:
    body = read_own(client, auth()).text
    assert "owner" not in body
    for banned in ("gpt", "claude", "luna", "terra", "model_id"):
        assert banned not in body.lower()


def test_nothing_that_is_not_a_syllabus_is_turned_into_one(client: TestClient, auth) -> None:
    response = read_own(client, auth(), "hello, are you there? I was wondering about school")
    assert response.status_code == 400
    assert "!" not in response.json()["message"]


def test_one_tap_per_unit_then_publish(client: TestClient, auth) -> None:
    headers = auth()
    draft = read_own(client, headers).json()["output"]
    framework_id = draft["framework"]["id"]

    early = post(client, "curriculum.own.publish", {"framework_id": framework_id}, headers)
    assert early.status_code == 400, "a syllabus nobody checked must not be publishable"

    for unit in draft["units"]:
        confirmed = post(
            client,
            "curriculum.own.confirm",
            {"framework_id": framework_id, "unit_id": unit["id"], "confirmed": True},
            headers,
        ).json()["output"]
    assert confirmed["unconfirmed"] == []

    published = post(
        client, "curriculum.own.publish", {"framework_id": framework_id}, headers
    ).json()["output"]
    assert published["version"]["published_at"]
    assert published["label"] == "Drafted from your syllabus, check it"

    # §2: nothing is edited in place after publication.
    again = post(
        client,
        "curriculum.own.confirm",
        {"framework_id": framework_id, "unit_id": draft["units"][0]["id"], "confirmed": False},
        headers,
    )
    assert again.status_code == 400


def test_another_learner_cannot_touch_my_syllabus(client: TestClient, auth) -> None:
    """A personal framework belongs to its owner (§6), and the id is not a capability."""
    mine, theirs = auth("learner-a"), auth("learner-b")
    framework_id = read_own(client, mine).json()["output"]["framework"]["id"]
    stolen = post(client, "curriculum.own.publish", {"framework_id": framework_id}, theirs)
    assert stolen.status_code == 404


def test_offering_it_to_the_registry_is_the_learners_choice(client: TestClient, auth) -> None:
    headers = auth()
    draft = read_own(client, headers).json()["output"]
    framework_id = draft["framework"]["id"]
    for unit in draft["units"]:
        post(
            client,
            "curriculum.own.confirm",
            {"framework_id": framework_id, "unit_id": unit["id"], "confirmed": True},
            headers,
        )
    unpublished = post(client, "curriculum.own.offer", {"framework_id": framework_id}, headers)
    assert unpublished.status_code == 400, "an unpublished draft is not offerable"

    post(client, "curriculum.own.publish", {"framework_id": framework_id}, headers)
    offered = post(client, "curriculum.own.offer", {"framework_id": framework_id}, headers).json()[
        "output"
    ]
    assert offered["offered"] is True
    assert offered["review"] == "pending"
    # Offering it does not change what it is to them: it stays their own, personal plan.
    assert offered["framework"]["status"] == "personal"
    # Moderation first: the offer is a queue row, never a live registry entry. It is theirs to
    # open, so it is in THEIR search — and in nobody else's until a person has looked at it (§6).
    mine = post(client, "curriculum.search", {"q": "St Xavier"}, headers)
    assert [r["id"] for r in mine.json()["output"]["results"]] == [framework_id]
    still_private = post(client, "curriculum.search", {"q": "St Xavier"}, auth("someone-else"))
    assert still_private.json()["output"]["results"] == []


def test_an_unreadable_photo_is_refused_before_it_is_read(client: TestClient, auth) -> None:
    response = post(
        client,
        "curriculum.own.read",
        {"kind": "photo", "image": "not base64 at all", "media_type": "image/png", **ABOUT},
        auth(),
    )
    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"
