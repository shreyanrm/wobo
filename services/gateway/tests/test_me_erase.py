"""``POST /v1/me/erase`` — the brain's half of "forget me".

The memory page could always clear the device. Nothing reached the brain: the mind snapshot the
learner's devices reconcile through, the conversation cached per learner, and the board turns held
for the resume window all survived a learner asking Wobo to forget them. These tests are the
propagation, and the honesty rules around it — a partial erasure is reported as one, and one
learner's erase is never another learner's.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import memory
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.board import stream
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

SSE = {"Accept": "text/event-stream"}


@pytest.fixture(autouse=True)
def _clean(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> Any:
    from wobo_gateway import parent_account, parents
    from wobo_gateway.hospitality import preferences as prefs_mod

    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    stream.reset()
    # the hospitality stores start empty and in memory, and never leak into the next test
    prefs_mod.set_store(prefs_mod.InMemoryPreferencesStore())
    parents.set_store(parents.InMemoryParentLinkStore())
    # the parent plane (migration 0019) the same way: the erase reaches it, so it has to be here
    # and it has to be empty, or one test's family is the next test's count
    parent_account.set_store(parent_account.InMemoryParentStore())
    yield
    prefs_mod.set_store(None)
    parents.set_store(None)
    parent_account.set_store(None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


class FakeStore:
    """One learner's rows in the brain's durable store, over the same PostgREST seam."""

    def __init__(
        self,
        mind: dict[str, Any] | None = None,
        threads: int = 1,
        *,
        prefs: int = 1,
        links: int = 1,
    ) -> None:
        self.mind = mind if mind is not None else {"facts": ["plays cricket", "exam friday"]}
        self.threads = threads
        # the hospitality rows (0010, 0011): the family's mail dials and the parent link
        self.prefs = prefs
        self.links = links
        self.calls: list[tuple[str, str, Any]] = []
        self.refuse: set[str] = set()

    def install(self, monkeypatch: pytest.MonkeyPatch) -> FakeStore:
        monkeypatch.setenv("SUPABASE_URL", "https://project.example")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-not-a-real-one")
        monkeypatch.setattr(memory, "_request", self)
        return self

    def __call__(
        self,
        url: str,
        key: str,
        method: str,
        *,
        body: dict[str, Any] | None = None,
        want_rows: bool,
    ) -> Any:
        self.calls.append((method, url, body))
        table = url.split("/rest/v1/")[1].split("?")[0]
        if table in self.refuse:
            raise OSError("the store is not answering")
        if method == "GET":
            return [{"mind": self.mind}]
        if method == "PATCH":
            self.mind = dict(body or {}).get("mind", {})
            return []
        if method == "DELETE":
            attr = {
                "learner_threads": "threads",
                "mail_preferences": "prefs",
                "parent_links": "links",
            }[table]
            rows = [{"id": n} for n in range(getattr(self, attr))]
            setattr(self, attr, 0)
            return rows
        return []


def erase(client: TestClient, headers: dict[str, str]) -> Any:
    return client.post("/v1/me/erase", headers=headers)


# --- the door -----------------------------------------------------------------------------


def test_erasing_a_memory_needs_a_verified_learner(client: TestClient) -> None:
    assert client.post("/v1/me/erase").status_code == 401


# --- what actually leaves ------------------------------------------------------------------


def test_the_facts_and_the_twin_summary_leave_the_brain(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = FakeStore().install(monkeypatch)
    res = erase(client, auth())
    assert res.status_code == 200
    body = res.json()
    assert body["erased"]["facts"] == 2
    assert body["erased"]["twin_summary"] is True
    assert body["erased"]["threads"] == 1
    # the family's mail dials and the parent link — with the parent's address on it — go too
    assert body["erased"]["mail_preferences"] == 1 and body["erased"]["parent_links"] == 1
    assert body["durable"] is True and body["failed"] == []
    # the snapshot the twin summary is derived from is empty afterwards, and the row survives:
    # progress is not memory, so the erase patches the mind and never deletes the learner's record
    assert store.mind == {}
    assert store.prefs == 0 and store.links == 0
    assert [c[0] for c in store.calls] == ["GET", "PATCH", "DELETE", "DELETE", "DELETE"]
    tables = {c[1].split("/rest/v1/")[1].split("?")[0] for c in store.calls}
    assert tables == {"learner_state", "learner_threads", "mail_preferences", "parent_links"}


def test_a_learner_with_nothing_remembered_is_told_the_truth(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Nothing to forget is not a failure, and it is not a fib either: zero, and no patch."""
    store = FakeStore(mind={}, threads=0, prefs=0, links=0).install(monkeypatch)
    body = erase(client, auth()).json()
    assert body["erased"] == {
        "facts": 0,
        # Wobo's own mind (0020) is reached through its own store, which holds nothing here
        "mind": 0,
        "twin_summary": False,
        "threads": 0,
        "boards": 0,
        "mail_preferences": 0,
        "parent_links": 0,
        # the parent plane (0019): no parent account holds this learner, so nothing to let go of
        "parent_plane": 0,
        # the doubt solver (0021): no photographed page, so no row and no object in the bucket
        "doubts": 0,
        "photos": 0,
    }
    # nothing to empty, so nothing written; the deletes are still attempted, and count zero
    assert [c[0] for c in store.calls] == ["GET", "DELETE", "DELETE", "DELETE"]


def test_the_erase_only_ever_names_the_learner_who_asked(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The subject comes from the door. Every filter the route writes carries it, so this is
    never a way to erase somebody else."""
    store = FakeStore().install(monkeypatch)
    erase(client, auth("learner-alpha"))
    assert store.calls
    for _method, url, _body in store.calls:
        table = url.split("/rest/v1/")[1].split("?")[0]
        # the hospitality tables (0010, 0011) name the learner `learner_id`; the rest `subject_id`
        column = "learner_id" if table in {"mail_preferences", "parent_links"} else "subject_id"
        assert f"{column}=eq.learner-alpha" in url, url
        assert "learner-under-test" not in url


def test_the_board_turns_held_for_this_learner_go_too(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A remembered turn is a cached generation keyed to the learner: it carries their own words
    and Wobo's answer, and it stayed replayable for three minutes after they said forget me."""
    FakeStore().install(monkeypatch)
    first = client.post(
        "/v1/capability/wobo.turn",
        json={"payload": {"context": {"turn": {"lastUserInput": "draw benzene"}}}},
        headers={**auth(), **SSE},
    )
    turn_id = first.text.split("id: ", 1)[1].split(":", 1)[0]
    assert stream.recall(turn_id, "sub:learner-under-test") is not None

    body = erase(client, auth()).json()
    assert body["erased"]["boards"] == 1
    assert stream.recall(turn_id, "sub:learner-under-test") is None


def test_one_learners_erase_leaves_another_learners_board_alone(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    FakeStore().install(monkeypatch)
    ask = {"payload": {"context": {"turn": {"lastUserInput": "draw benzene"}}}}
    theirs = client.post(
        "/v1/capability/wobo.turn", json=ask, headers={**auth("someone-else"), **SSE}
    )
    their_turn = theirs.text.split("id: ", 1)[1].split(":", 1)[0]

    assert erase(client, auth("learner-under-test")).json()["erased"]["boards"] == 0
    assert stream.recall(their_turn, "sub:someone-else") is not None


def test_an_outstanding_voice_token_does_not_survive_being_forgotten(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A minted token is a session waiting to be opened as them."""
    from wobo_gateway import voice

    FakeStore().install(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-a-real-one")
    token = client.get("/v1/voice/session", headers=auth()).json()["token"]
    erase(client, auth())
    assert voice._consume_grant(token) is None


# --- honesty ------------------------------------------------------------------------------


def test_a_store_that_refused_is_named_and_the_answer_is_not_ok(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Wobo never claims to have forgotten something Wobo did not. A partial erasure is a 502
    with the failure named, not a 200 with a reassurance."""
    store = FakeStore().install(monkeypatch)
    store.refuse = {"learner_threads"}
    res = erase(client, auth())
    assert res.status_code == 502
    body = res.json()
    assert body["failed"] == ["learner_threads"]
    assert body["code"] == "erase_incomplete"
    assert body["erased"]["facts"] == 2  # what DID leave is still reported
    for provider in ("supabase", "postgrest", "claude", "gemini", "openai"):
        assert provider not in json.dumps(body).lower()
    # the same honesty for the parent link: a refused delete there is named, and the rest is
    # still reported as what it is
    store = FakeStore().install(monkeypatch)
    store.refuse = {"parent_links"}
    res = erase(client, auth())
    assert res.status_code == 502
    body = res.json()
    assert body["failed"] == ["parent_links"]
    assert body["erased"]["mail_preferences"] == 1 and body["erased"]["parent_links"] == 0


def test_the_parent_link_and_the_mail_dials_held_in_process_go_too(
    client: TestClient, auth
) -> None:
    """A run without a project keeps the hospitality rows in memory (``…_STORE=memory``). Forgetting
    a learner empties those as well, counts them, and leaves another learner's alone."""
    from datetime import UTC, datetime

    from wobo_gateway import parents
    from wobo_gateway.hospitality import preferences as prefs_mod

    dials, links = prefs_mod.get_store(), parents.get_store()
    for learner in ("learner-under-test", "someone-else"):
        dials.put(learner, prefs_mod.MailPreferences(country="IN"))
        links.insert(
            parents.ParentLink(
                id=f"link-{learner}",
                learner_id=learner,
                parent_email_hash="0" * 64,
                parent_email="parent@example.test",
                learner_name="A",
                timezone=None,
                status="linked",
                invited_at=datetime.now(UTC),
                linked_at=datetime.now(UTC),
            )
        )
    body = erase(client, auth()).json()
    assert body["durable"] is False and body["failed"] == []
    assert body["erased"]["mail_preferences"] == 1 and body["erased"]["parent_links"] == 1
    assert dials.get("learner-under-test") is None and links.latest("learner-under-test") is None
    assert dials.get("someone-else") is not None and links.latest("someone-else") is not None


def test_with_no_durable_store_the_answer_says_so(client: TestClient, auth) -> None:
    """Dev and the keyless path have no brain-side store. The route reports that rather than
    letting a learner believe a server forgot them when there was no server."""
    body = erase(client, auth()).json()
    assert body["durable"] is False
    assert body["failed"] == []


def test_erasing_never_costs_a_learner_a_turn(client: TestClient, auth) -> None:
    """A data right that spends the last turn of the day is not a right."""
    before = client.get("/v1/me", headers=auth()).json()["budget"]["turns_remaining"]
    erase(client, auth())
    erase(client, auth())
    after = client.get("/v1/me", headers=auth()).json()["budget"]["turns_remaining"]
    assert after == before


def test_erasing_is_not_a_way_to_refill_a_spent_day(client: TestClient, auth) -> None:
    """The other half of the same rule: forgetting is a data right, not a refill.

    Erasure clears what Wobo was TOLD about a learner. It must not clear what the learner has
    SPENT, or "forget me" is an unlimited-turn button one POST away — the meter is keyed on the
    same door this route reads its subject from, so the two are one line apart in the code.
    """
    spent = client.post(
        "/v1/capability/wobo.turn",
        json={"payload": {"context": {"turn": {"lastUserInput": "draw benzene"}}}},
        headers={**auth(), **SSE},
    )
    assert spent.status_code == 200
    before = client.get("/v1/me", headers=auth()).json()["budget"]["turns_remaining"]
    untouched = client.get("/v1/me", headers=auth("never-asked-anything")).json()
    assert before < untouched["budget"]["turns_remaining"], "the turn has to be charged first"

    assert erase(client, auth()).status_code == 200
    after = client.get("/v1/me", headers=auth()).json()["budget"]["turns_remaining"]
    assert after == before


def test_a_malformed_subject_never_reaches_a_filter(monkeypatch: pytest.MonkeyPatch) -> None:
    """The subject is interpolated into a PostgREST filter, so it is checked first."""
    store = FakeStore().install(monkeypatch)
    out = memory.erase_durable("not a subject; drop table")
    assert store.calls == []
    assert out.durable is False and out.facts == 0
