"""The board a learner may change once, then a person handles it.

``docs/CONSOLE-ROLES-AND-BOARD.md`` §1 is the law and the owner's sentence is the whole of it:
*"If the user wants to change their board in settings, they can, but only for the first time it
lets them reselect. The next time onwards when they want to change again, show them a button to
contact support and we will handle it from there."*

Seven things are held here, and every one of them fails without ``board_change.py``:

1. **The first change just works**, and it is stamped on the account: when, from what, to what,
   and who made it.
2. **The first change is confirmed first.** The cost is three facts the learner reads before
   anything moves, and the route refuses without the confirmation rather than taking it.
3. **The second change is not offered.** The route answers ``needs_a_person`` with one line and
   the two facts the request carries, and it never says limit, policy, allowance or money.
4. **The request lands in a queue** an operator can read, carrying the current board, the board
   asked for, and when they last changed. Two requests from one learner are one row.
5. **Granting resets the allowance of one**, writes the audit row, and the learner may change
   again on their next read. An operator's own change never counts against them.
6. **The dials are live.** How many free changes, whether a parent's counts, and whether the rule
   is off for a cohort, all from ``ops.settings`` with no deploy.
7. **The words obey the copy law.** No vendor, no gendered pronoun for Wobo, no exclamation mark,
   no em dash, and not one mention of a limit or a policy anywhere a learner reads.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from wobo_gateway import admin_auth, board_change, doors
from wobo_gateway.admin_auth import (
    ADMIN_PREFIX,
    OPERATOR,
    VIEWER,
    InMemoryAdminStore,
)
from wobo_gateway.app import create_app

LEARNER = "51111111-1111-4111-8111-111111111111"
OTHER = "52222222-2222-4222-8222-222222222222"
OPERATOR_SUBJECT = "53333333-3333-4333-8333-333333333333"

STANDING = "/v1/board/change"
ASK = "/v1/board/change/request"
QUEUE = f"{ADMIN_PREFIX}/board-changes"
GRANT = f"{ADMIN_PREFIX}/board-changes/grant"

#: The four the copy law forbids anywhere a learner reads (``docs/copy/voice.md`` §3, §7, §10a).
VENDOR = re.compile(
    r"\b(gemini|openai|anthropic|claude|gpt|litellm|supabase|railway|vercel|resend|google|"
    r"apple|microsoft|stripe|razorpay)\b",
    re.I,
)
PRONOUN = re.compile(r"\b(she|her|hers|herself|he|him|his|himself)\b", re.I)
#: §1's last line: *"Nothing about this ever mentions money, a limit, or a policy."*
NEVER_SAID = re.compile(r"\b(limit|policy|quota|allowance|rupee|free change|only once|once only)\b", re.I)


# --- the world every test runs in -------------------------------------------------------------
@pytest.fixture(autouse=True)
def _store() -> board_change.InMemoryBoardChangeStore:
    store = board_change.InMemoryBoardChangeStore()
    board_change.set_store(store)
    doors.set_store(doors.InMemorySettingsStore(open_default=True))
    # The dials are cached for up to thirty seconds; one test's turned dial is not the next one's.
    board_change.reset_dials()
    yield store
    board_change.set_store(None)
    doors.set_store(None)
    board_change.reset_dials()


@pytest.fixture(autouse=True)
def _admin_env(monkeypatch: pytest.MonkeyPatch) -> InMemoryAdminStore:
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.delenv("ENV", raising=False)
    store = InMemoryAdminStore()
    admin_auth.set_store(store)
    admin_auth.reset_limiter()
    yield store
    admin_auth.set_store(None)


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app())


def _bearer(subject: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET)}"}


def _console(
    client: TestClient, store: InMemoryAdminStore, role: str = OPERATOR
) -> dict[str, str]:
    store.upsert_admin(
        subject_id=OPERATOR_SUBJECT,
        email="ops@example.com",
        role=role,
        granted_by=None,
        mfa_required=False,
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(OPERATOR_SUBJECT))
    assert opened.status_code == 200, opened.text
    return {**_bearer(OPERATOR_SUBJECT), admin_auth.SESSION_HEADER: opened.json()["session_token"]}


def _change(
    client: TestClient,
    subject: str,
    board: str,
    level: str = "9",
    *,
    coming_from: str | None = None,
    from_level: str | None = None,
    **extra: object,
):
    """One change through the real route.

    ``coming_from`` is the board the app says they are on, and the gateway reads it ONLY while it
    holds no trail of its own — a learner's first board is pinned in onboarding, which never comes
    through here, so the first call from Settings has to say where it is starting from.
    """
    body: dict[str, object] = {
        "framework_id": board,
        "level": level,
        "confirm": True,
        **extra,
    }
    if coming_from is not None:
        body["current_framework_id"] = coming_from
        body["current_level"] = from_level if from_level is not None else level
    return client.post(STANDING, json=body, headers=_bearer(subject))


def _onboarded(client: TestClient, subject: str, board: str, level: str = "9") -> None:
    """Where a learner starts: a board and no history, exactly as onboarding leaves them."""
    first = _change(client, subject, board, level)
    assert first.status_code == 200, first.text
    # Setting a first board is not a change, so it spends nothing.
    assert first.json()["used"] == 0


def _words(payload: object) -> str:
    """Every string in an answer, joined, so one scan covers the whole of it."""
    if isinstance(payload, str):
        return payload
    if isinstance(payload, dict):
        return " ".join(_words(value) for value in payload.values())
    if isinstance(payload, list):
        return " ".join(_words(value) for value in payload)
    return ""


# --- 1. the first change just works, and it is stamped ------------------------------------------
def test_the_first_change_is_taken_and_stamped_on_the_account(
    client: TestClient, _store: board_change.InMemoryBoardChangeStore
) -> None:
    answer = _change(client, LEARNER, "icse", "9", coming_from="cbse")
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["board"] == {"framework_id": "icse", "level": "9"}
    assert body["may_change"] is False

    stamped = _store.changes(LEARNER)
    assert len(stamped) == 1
    assert stamped[0].from_framework_id == "cbse"
    assert stamped[0].to_framework_id == "icse"
    assert stamped[0].by == "learner"
    assert stamped[0].at is not None


def test_setting_a_first_board_is_not_a_change_and_spends_nothing(
    client: TestClient, _store: board_change.InMemoryBoardChangeStore
) -> None:
    """Onboarding pins a board. A learner arriving at Settings still has their one change."""
    _onboarded(client, LEARNER, "cbse", "9")
    assert client.get(STANDING, headers=_bearer(LEARNER)).json()["may_change"] is True
    assert _store.changes(LEARNER)[0].from_framework_id is None


def test_the_board_the_gateway_holds_beats_anything_the_app_says_later(
    client: TestClient, _store: board_change.InMemoryBoardChangeStore
) -> None:
    """The stated board is read once, while there is no trail, and never again."""
    _onboarded(client, LEARNER, "cbse", "9")
    moved = _change(client, LEARNER, "icse", "9", coming_from="icse")
    assert moved.status_code == 200, moved.text
    # It was told "you are already on icse"; the trail said cbse, and the trail won.
    assert _store.changes(LEARNER)[-1].from_framework_id == "cbse"
    assert moved.json()["used"] == 1


def test_the_standing_before_anything_offers_the_change_and_says_what_it_costs(
    client: TestClient,
) -> None:
    answer = client.get(STANDING, headers=_bearer(LEARNER))
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["may_change"] is True
    assert body["used"] == 0
    # The three facts of §1: the climb re-anchors, progress re-maps, and what the new board does
    # not teach is KEPT and marked. Never deleted, and the word has to be there.
    assert len(body["cost"]) == 3
    joined = " ".join(body["cost"]).lower()
    assert "keep" in joined or "kept" in joined
    assert "delete" not in joined


def test_the_cost_claims_only_what_the_product_does() -> None:
    """Copy is a contract (voice.md §6). Completion is filed under each board's own topic ids
    (apps/web-pwa/src/screens/learn/mastery.ts), so nothing a learner finished on one board is
    counted as finished on another. A sentence promising their work is re-mapped onto the new
    syllabus was a promise the product did not keep. What IS kept, and marked with the board it
    came from, is the record the You screen shows (apps/web-pwa/src/screens/you/kept.ts)."""
    joined = " ".join(board_change.COST).lower()
    assert "re-map" not in joined and "remap" not in joined
    assert "marked with the board" in joined


def test_a_signed_out_visitor_has_no_standing_to_read(client: TestClient) -> None:
    assert client.get(STANDING).status_code in (401, 403)


# --- 2. the cost is confirmed before anything moves ---------------------------------------------
def test_a_change_without_the_confirmation_is_refused_and_nothing_moves(
    client: TestClient, _store: board_change.InMemoryBoardChangeStore
) -> None:
    answer = client.post(
        STANDING, json={"framework_id": "icse", "level": "9"}, headers=_bearer(LEARNER)
    )
    assert answer.status_code == 409
    assert answer.json()["detail"]["code"] == "confirm_required"
    assert _store.changes(LEARNER) == []


def test_a_change_to_the_board_they_are_already_on_is_not_a_change(client: TestClient) -> None:
    _onboarded(client, LEARNER, "cbse", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    again = _change(client, LEARNER, "icse", "9")
    assert again.status_code == 200
    # It answered, and it did not spend a second change on a board they already have.
    assert again.json()["used"] == 1


def test_a_class_change_on_the_same_board_is_not_a_board_change(
    client: TestClient, _store: board_change.InMemoryBoardChangeStore
) -> None:
    """A learner goes up a class every year. The rule is about boards, not about growing up."""
    _onboarded(client, LEARNER, "cbse", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    moved_up = _change(client, LEARNER, "icse", "10")
    assert moved_up.status_code == 200
    assert moved_up.json()["board"] == {"framework_id": "icse", "level": "10"}
    assert moved_up.json()["used"] == 1


# --- 3. the second change is not offered --------------------------------------------------------
def test_the_second_change_asks_for_a_person_and_never_names_a_rule(client: TestClient) -> None:
    _onboarded(client, LEARNER, "cbse", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    second = _change(client, LEARNER, "cbse", "9")
    assert second.status_code == 409
    detail = second.json()["detail"]
    assert detail["code"] == "needs_a_person"
    said = _words(detail)
    assert NEVER_SAID.search(said) is None, said
    assert "person" in said.lower()


def test_the_standing_after_one_change_carries_the_line_and_the_button(
    client: TestClient,
) -> None:
    _onboarded(client, LEARNER, "cbse", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    body = client.get(STANDING, headers=_bearer(LEARNER)).json()
    assert body["may_change"] is False
    assert body["line"]
    assert body["button"] == "Ask us to change it"
    assert NEVER_SAID.search(_words(body)) is None, _words(body)


def test_one_learner_out_of_changes_never_touches_another_learners_standing(
    client: TestClient,
) -> None:
    _onboarded(client, LEARNER, "cbse", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    assert client.get(STANDING, headers=_bearer(OTHER)).json()["may_change"] is True


# --- 4. the request lands in a queue -------------------------------------------------------------
def test_the_request_carries_the_two_boards_and_nothing_else(
    client: TestClient, _store: board_change.InMemoryBoardChangeStore
) -> None:
    _onboarded(client, LEARNER, "cbse", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    asked = client.post(
        ASK, json={"framework_id": "cbse", "level": "9"}, headers=_bearer(LEARNER)
    )
    assert asked.status_code == 200, asked.text
    row = _store.open_request(LEARNER)
    assert row is not None
    assert row.current_framework_id == "icse"
    assert row.wanted_framework_id == "cbse"
    assert row.state == "new"
    # Nothing else. No note, no free text, no address.
    assert not hasattr(row, "note")


def test_asking_twice_is_one_row_and_the_second_moves_the_board_asked_for(
    client: TestClient, _store: board_change.InMemoryBoardChangeStore
) -> None:
    _onboarded(client, LEARNER, "cbse", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    client.post(ASK, json={"framework_id": "cbse", "level": "9"}, headers=_bearer(LEARNER))
    client.post(ASK, json={"framework_id": "ib", "level": "9"}, headers=_bearer(LEARNER))
    assert len(_store.all_requests()) == 1
    assert _store.open_request(LEARNER).wanted_framework_id == "ib"


def test_the_queue_shows_an_operator_the_three_facts_and_a_handle_not_a_name(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _onboarded(client, LEARNER, "cbse", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    client.post(ASK, json={"framework_id": "cbse", "level": "9"}, headers=_bearer(LEARNER))

    seat = _console(client, _admin_env)
    queue = client.get(QUEUE, headers=seat)
    assert queue.status_code == 200, queue.text
    body = queue.json()
    assert body["readable"] is True
    row = body["requests"][0]
    assert row["current"] == {"framework_id": "icse", "level": "9"}
    assert row["wanted"] == {"framework_id": "cbse", "level": "9"}
    assert row["last_changed_at"]
    assert row["handle"]
    assert "learner_id" not in row and "subject_id" not in row


def test_a_learner_cannot_read_the_queue(client: TestClient) -> None:
    assert client.get(QUEUE, headers=_bearer(LEARNER)).status_code in (401, 403, 404)


# --- 5. granting resets the allowance of one ------------------------------------------------------
def test_granting_lets_them_change_again_and_writes_the_audit_row(
    client: TestClient, _admin_env: InMemoryAdminStore, _store: board_change.InMemoryBoardChangeStore
) -> None:
    _onboarded(client, LEARNER, "cbse", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    client.post(ASK, json={"framework_id": "cbse", "level": "9"}, headers=_bearer(LEARNER))
    request_id = _store.open_request(LEARNER).id

    seat = _console(client, _admin_env)
    granted = client.post(GRANT, json={"id": request_id}, headers=seat)
    assert granted.status_code == 200, granted.text
    assert granted.json()["state"] == "granted"

    # The learner may change again, and the product tells them it was done.
    standing = client.get(STANDING, headers=_bearer(LEARNER)).json()
    assert standing["may_change"] is True
    assert standing["granted"] is True
    assert _change(client, LEARNER, "cbse", "9").status_code == 200

    actions = [row.get("action") for row in _admin_env.audit]
    assert "board.change.grant" in actions


def test_a_viewer_seat_may_read_the_queue_and_may_not_grant(
    client: TestClient, _admin_env: InMemoryAdminStore, _store: board_change.InMemoryBoardChangeStore
) -> None:
    _onboarded(client, LEARNER, "cbse", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    client.post(ASK, json={"framework_id": "cbse", "level": "9"}, headers=_bearer(LEARNER))
    request_id = _store.open_request(LEARNER).id

    seat = _console(client, _admin_env, role=VIEWER)
    assert client.get(QUEUE, headers=seat).status_code == 200
    assert client.post(GRANT, json={"id": request_id}, headers=seat).status_code in (403, 404)


def test_an_operators_own_change_never_counts_against_the_learner(
    _store: board_change.InMemoryBoardChangeStore,
) -> None:
    trail = [
        board_change.Change(
            at=datetime.now(UTC) - timedelta(days=2),
            from_framework_id="cbse",
            from_level="9",
            to_framework_id="icse",
            to_level="9",
            by="operator",
        )
    ]
    standing = board_change.standing(trail, free_changes=1, granted_at=None, parent_counts=True)
    assert standing.used == 0
    assert standing.may_change is True


# --- 6. the dials are live -----------------------------------------------------------------------
def test_the_free_changes_dial_moves_without_a_deploy(client: TestClient) -> None:
    store = doors.get_store()
    store.write(board_change.FREE_CHANGES_KEY, 2, actor=None, note="a cohort that moved school")
    board_change.reset_dials()

    _onboarded(client, LEARNER, "state", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    assert _change(client, LEARNER, "cbse", "9").status_code == 200
    assert _change(client, LEARNER, "ib", "9").status_code == 409


def test_a_parents_change_counts_only_while_the_dial_says_it_does() -> None:
    trail = [
        board_change.Change(
            at=datetime.now(UTC),
            from_framework_id="cbse",
            from_level="9",
            to_framework_id="icse",
            to_level="9",
            by="parent",
        )
    ]
    counted = board_change.standing(trail, free_changes=1, granted_at=None, parent_counts=True)
    assert counted.may_change is False
    free = board_change.standing(trail, free_changes=1, granted_at=None, parent_counts=False)
    assert free.may_change is True


def test_the_rule_can_be_switched_off_for_a_cohort(client: TestClient) -> None:
    store = doors.get_store()
    store.write(board_change.RULE_OFF_KEY, ["board:icse"], actor=None, note="a pilot school")
    board_change.reset_dials()

    _onboarded(client, LEARNER, "cbse", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    # They are on icse now, which is the cohort the rule is off for.
    second = _change(client, LEARNER, "cbse", "9")
    assert second.status_code == 200, second.text


def test_a_dial_nobody_has_set_is_the_law_s_own_default() -> None:
    board_change.reset_dials()
    assert board_change.free_changes() == 1
    assert board_change.parent_change_counts() is True
    assert board_change.rule_off_for() == ()


# --- 7. the words -------------------------------------------------------------------------------
def test_nothing_a_learner_reads_breaks_the_copy_law(client: TestClient) -> None:
    _onboarded(client, LEARNER, "cbse", "9")
    said = [_words(client.get(STANDING, headers=_bearer(LEARNER)).json())]
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    said.append(_words(client.get(STANDING, headers=_bearer(LEARNER)).json()))
    said.append(_words(_change(client, LEARNER, "cbse", "9").json()))
    said.append(
        _words(
            client.post(
                ASK, json={"framework_id": "cbse", "level": "9"}, headers=_bearer(LEARNER)
            ).json()
        )
    )
    whole = " ".join(said)
    assert VENDOR.search(whole) is None, whole
    assert PRONOUN.search(whole) is None, whole
    assert "!" not in whole
    assert "—" not in whole
    assert NEVER_SAID.search(whole) is None, whole


def test_a_store_that_cannot_be_reached_refuses_rather_than_answering_from_nothing(
    client: TestClient,
) -> None:
    """An empty trail from an unreachable store would read as "you have never changed"."""
    board_change.set_store(board_change.UnconfiguredBoardChangeStore())
    answer = client.get(STANDING, headers=_bearer(LEARNER))
    assert answer.status_code == 503
    assert answer.json()["detail"]["code"] == "board_change_unavailable"


# --- the queue is reached through the service role and nothing else ------------------------------
def test_the_queue_is_reached_with_the_service_key_and_the_ops_profile() -> None:
    """``docs/CONSOLE-ROLES-AND-BOARD.md`` §1: the queue is a person's work, reachable by the
    service role alone. Migration 0031 puts no policy on ``ops.board_change_requests``, so every
    call this store makes to it must carry the service key and the ``ops`` schema profile, and the
    learner's trail must be asked for in ``learner``. A call with a client key or no profile would
    be refused by the database, and this proves the gateway never makes one."""
    calls: list[tuple[str, str, str, str]] = []

    def fake(url: str, key: str, method: str, schema: str, *, body: object = None) -> list[dict]:
        calls.append((url, key, method, schema))
        return []

    store = board_change.PostgrestBoardChangeStore(
        "https://db.example.test", "the-service-key", request=fake
    )
    now = datetime.now(UTC)
    store.queue(state="new", limit=10)
    store.open_request(LEARNER)
    store.get_request("abc123")
    store.granted_at(LEARNER)
    store.put_request(
        board_change.ChangeRequest(
            id="abc123",
            subject_id=LEARNER,
            at=now,
            current_framework_id="cbse",
            current_level="9",
            wanted_framework_id="icse",
            wanted_level="9",
            last_changed_at=now,
        )
    )
    store.changes(LEARNER)

    queue_calls = [call for call in calls if "/rest/v1/board_change_requests" in call[0]]
    assert len(queue_calls) == 5
    assert all(key == "the-service-key" for _, key, _, _ in calls)
    assert all(schema == board_change.OPS_SCHEMA for _, _, _, schema in queue_calls)
    trail = [call for call in calls if "/rest/v1/board_changes" in call[0]]
    assert trail and all(schema == board_change.LEARNER_SCHEMA for _, _, _, schema in trail)


# --- 8. the console holds the dials (§1: "the dials the console holds") -------------------------
DIALS = f"{ADMIN_PREFIX}/board-changes/dials"


def test_the_queue_shows_the_three_dials_as_they_stand(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    seat = _console(client, _admin_env)
    desk = client.get(QUEUE, headers=seat).json()
    assert desk["dials"] == {
        "free_changes": 1,
        "parent_change_counts": True,
        "rule_off_for": [],
    }


def test_the_owner_turns_a_dial_and_the_next_learner_meets_it(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    seat = _console(client, _admin_env, role=admin_auth.OWNER)
    turned = client.post(
        DIALS,
        json={"free_changes": 2, "rule_off_for": ["board:icse"], "note": "a school moved"},
        headers=seat,
    )
    assert turned.status_code == 200, turned.text
    assert turned.json()["dials"]["free_changes"] == 2
    assert turned.json()["dials"]["rule_off_for"] == ["board:icse"]
    # Written to ops.settings, where the audit trigger sees it, and to the console's own trail.
    assert doors.get_store().read(board_change.FREE_CHANGES_KEY) == 2
    assert "board.dials.set" in [row.get("action") for row in _admin_env.audit]

    # Live: no deploy and no wait. Two changes are now free.
    _onboarded(client, LEARNER, "state", "9")
    assert _change(client, LEARNER, "cbse", "9").status_code == 200
    assert _change(client, LEARNER, "ib", "9").status_code == 200
    assert _change(client, LEARNER, "state", "9").status_code == 409


def test_a_dial_left_out_of_the_body_is_left_alone(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    doors.get_store().write(board_change.PARENT_COUNTS_KEY, False, actor=None, note=None)
    board_change.reset_dials()
    seat = _console(client, _admin_env, role=admin_auth.OWNER)
    turned = client.post(DIALS, json={"free_changes": 3}, headers=seat)
    assert turned.status_code == 200, turned.text
    assert turned.json()["dials"]["parent_change_counts"] is False


@pytest.mark.parametrize(
    "body",
    [
        {"free_changes": -1},
        {"free_changes": 101},
        {"free_changes": True},
        {"rule_off_for": ["somebody"]},
        {"rule_off_for": ["board:"]},
        {},
    ],
)
def test_a_dial_the_gateway_cannot_obey_is_refused_and_nothing_is_written(
    client: TestClient, _admin_env: InMemoryAdminStore, body: dict
) -> None:
    seat = _console(client, _admin_env, role=admin_auth.OWNER)
    refused = client.post(DIALS, json=body, headers=seat)
    assert refused.status_code == 422, refused.text
    assert doors.get_store().read(board_change.FREE_CHANGES_KEY) is None
    assert doors.get_store().read(board_change.RULE_OFF_KEY) is None


def test_an_operator_clears_the_queue_but_does_not_turn_the_dials(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    seat = _console(client, _admin_env, role=OPERATOR)
    assert client.post(DIALS, json={"free_changes": 5}, headers=seat).status_code == 403
    assert doors.get_store().read(board_change.FREE_CHANGES_KEY) is None


# --- the owner's grant is the whole answer (closer, 2026-09-17) -----------------------------------
# docs/CONSOLE-ROLES-AND-BOARD.md §2: a person's capabilities are the role's defaults plus the
# owner's grants. The grant route used to demand the role's `support.act` as well as the panel's
# act, so a viewer the owner had given `panel.boards.act` was still refused: the grant did nothing.
def _asked(client: TestClient, store: board_change.InMemoryBoardChangeStore) -> str:
    _onboarded(client, LEARNER, "cbse", "9")
    assert _change(client, LEARNER, "icse", "9").status_code == 200
    client.post(ASK, json={"framework_id": "cbse", "level": "9"}, headers=_bearer(LEARNER))
    return store.open_request(LEARNER).id


def _set(store: InMemoryAdminStore, capability: str, effect: str) -> None:
    admin = store.admin_by_subject(OPERATOR_SUBJECT)
    assert admin is not None
    store.set_capability(admin_id=admin.id, capability=capability, effect=effect, granted_by=None)


def test_a_viewer_the_owner_gave_the_board_act_may_grant(
    client: TestClient, _admin_env: InMemoryAdminStore, _store: board_change.InMemoryBoardChangeStore
) -> None:
    request_id = _asked(client, _store)
    seat = _console(client, _admin_env, role=VIEWER)
    _set(_admin_env, "panel.boards.act", "grant")
    granted = client.post(GRANT, json={"id": request_id}, headers=seat)
    assert granted.status_code == 200, granted.text
    assert granted.json()["state"] == "granted"


def test_the_board_act_opens_the_board_desk_and_nothing_else(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    seat = _console(client, _admin_env, role=VIEWER)
    _set(_admin_env, "panel.boards.act", "grant")
    other = client.post(
        f"{ADMIN_PREFIX}/reports/state", json={"id": "x", "state": "closed"}, headers=seat
    )
    assert other.status_code == 403, other.text


def test_an_operator_without_the_board_act_may_not_grant(
    client: TestClient, _admin_env: InMemoryAdminStore, _store: board_change.InMemoryBoardChangeStore
) -> None:
    request_id = _asked(client, _store)
    seat = _console(client, _admin_env)
    _set(_admin_env, "panel.boards.act", "revoke")
    assert client.post(GRANT, json={"id": request_id}, headers=seat).status_code == 403
    assert _store.open_request(LEARNER) is not None


def test_owner_work_is_never_widened_by_a_panel_grant(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """The dials and the router are the owner's (`admin.manage`); a panel grant does not reach them."""
    seat = _console(client, _admin_env)
    _set(_admin_env, "panel.models.act", "grant")
    moved = client.post(f"{ADMIN_PREFIX}/models", json={"reset": True}, headers=seat)
    assert moved.status_code == 403, moved.text
    dials = client.post(f"{QUEUE}/dials", json={"free_changes": 3}, headers=seat)
    assert dials.status_code == 403, dials.text


# --- where they came from, when the gateway has no trail (closer, 2026-09-17) ---------------------
# With no trail, the gateway used to take the app's word for the board a learner was on. An app
# that left the field out, or named the board it was moving to, had its first real move recorded
# as an anchor, which is never counted: one free board change. The learner's syllabus pins are the
# gateway's own record of a board they committed to (a pin is written only on a choice, an upgrade,
# an edit or their own syllabus), so they decide it now whenever the app's word cannot.
@pytest.fixture()
def _pins():
    from wobo_gateway.curriculum import store as curriculum_store

    store = curriculum_store.InMemoryStore()
    curriculum_store.set_store(store)
    yield store
    curriculum_store.set_store(None)


def test_a_move_with_no_stated_origin_counts_when_they_already_had_a_pinned_board(
    client: TestClient, _pins, _store: board_change.InMemoryBoardChangeStore
) -> None:
    _pins.put_pin(LEARNER, "cbse", "v-cbse")
    moved = _change(client, LEARNER, "icse", "9")
    assert moved.status_code == 200, moved.text
    assert moved.json()["used"] == 1
    assert _store.changes(LEARNER)[-1].from_framework_id == "cbse"
    # And the next one needs a person.
    again = _change(client, LEARNER, "ib", "9")
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "needs_a_person"


def test_claiming_to_be_on_the_board_they_are_moving_to_does_not_hide_the_move(
    client: TestClient, _pins
) -> None:
    _pins.put_pin(LEARNER, "cbse", "v-cbse")
    moved = _change(client, LEARNER, "icse", "9", coming_from="icse")
    assert moved.status_code == 200, moved.text
    assert moved.json()["used"] == 1


def test_a_learner_with_no_pinned_board_still_sets_their_first_one_for_nothing(
    client: TestClient, _pins
) -> None:
    first = _change(client, LEARNER, "icse", "9")
    assert first.status_code == 200, first.text
    assert first.json()["used"] == 0


def test_a_pin_on_the_board_they_are_moving_to_is_not_a_second_board(
    client: TestClient, _pins
) -> None:
    _pins.put_pin(LEARNER, "icse", "v-icse")
    first = _change(client, LEARNER, "icse", "9")
    assert first.status_code == 200, first.text
    assert first.json()["used"] == 0


def test_pins_that_cannot_be_read_refuse_rather_than_hand_out_a_move(client: TestClient) -> None:
    from wobo_gateway.curriculum import store as curriculum_store

    class Down(curriculum_store.InMemoryStore):
        def pinned_frameworks(self, subject: str) -> list[str]:
            raise curriculum_store.StoreUnavailable("down")

    curriculum_store.set_store(Down())
    try:
        assert _change(client, LEARNER, "icse", "9").status_code == 503
    finally:
        curriculum_store.set_store(None)


# --- the dials are written whole, and the trail follows the write (closer, 2026-09-17) ------------
class _FailingSettings(doors.InMemorySettingsStore):
    """Refuses any write that names the cohort dial, after the others would have gone in."""

    def write(self, key, value, *, actor, note):  # noqa: ANN001
        if key == board_change.RULE_OFF_KEY:
            raise doors.DoorsUnavailable("down")
        super().write(key, value, actor=actor, note=note)

    def write_many(self, values, *, actor, note):  # noqa: ANN001
        if board_change.RULE_OFF_KEY in values:
            raise doors.DoorsUnavailable("down")
        super().write_many(values, actor=actor, note=note)


def test_a_dial_write_that_fails_turns_nothing_and_writes_no_dial_row(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    doors.set_store(_FailingSettings(open_default=True))
    seat = _console(client, _admin_env, role=admin_auth.OWNER)
    failed = client.post(
        DIALS, json={"free_changes": 4, "rule_off_for": ["everyone"]}, headers=seat
    )
    assert failed.status_code == 503, failed.text
    # Half a turn is not a turn: the dial that would have gone in first did not.
    assert doors.get_store().read(board_change.FREE_CHANGES_KEY) is None
    # And the trail does not record a change that never happened.
    assert "board.dials.set" not in [row.get("action") for row in _admin_env.audit]


def test_the_dial_row_carries_what_the_dials_were_before(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    doors.get_store().write(board_change.FREE_CHANGES_KEY, 2, actor=None, note=None)
    seat = _console(client, _admin_env, role=admin_auth.OWNER)
    assert client.post(DIALS, json={"free_changes": 3}, headers=seat).status_code == 200
    row = next(r for r in _admin_env.audit if r.get("action") == "board.dials.set")
    assert row["detail"]["before"] == {board_change.FREE_CHANGES_KEY: 2}
    assert row["detail"]["after"] == {board_change.FREE_CHANGES_KEY: 3}


def test_the_project_store_writes_every_dial_in_one_request() -> None:
    """One upsert of several rows is one statement: all of them or none."""
    calls: list[tuple[str, str, object]] = []

    def fake(url, key, method, *, body=None):  # noqa: ANN001
        calls.append((url, method, body))
        return []

    store = doors.PostgrestSettingsStore("https://example.supabase.co", "k", request=fake)
    store.write_many({"a": 1, "b": [2]}, actor="x", note="n")
    assert len(calls) == 1
    assert calls[0][1] == "POST"
    assert {row["key"] for row in calls[0][2]} == {"a", "b"}


def test_the_queue_says_no_parent_can_change_a_board_yet(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """§1's parent path is not built (no age signal, and the parent plane holds four actions).

    Until it is, the "a parent's change counts" dial governs nothing, and the owner turning it
    must be told so rather than believe it moved something.
    """
    seat = _console(client, _admin_env)
    desk = client.get(QUEUE, headers=seat).json()
    assert desk["parent_changes_possible"] is False
    assert "parent" not in board_change.MAKERS_WRITTEN
