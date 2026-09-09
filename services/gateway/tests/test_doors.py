"""The door, closed. What the gateway refuses while ``doors_open`` is off in ``ops.settings``.

``docs/DOORS-CLOSED.md`` is the law. Its one operative sentence is section 4's: *refusing at the
gateway is what actually closes the door; the web copy is only what a person sees.* So this file
drives the real app through the real door and proves the refusal, not the copy.

Four things are held here, and they are the four the wave was asked for:

1. **No path creates an account while the dial is off.** One test per path named in section 1 —
   the sign-up door (a subject the product has never seen), the anonymous path the SDK uses, a
   deep link (the parent's accept page), the checkout, a parent invitation, and the gift that is
   not built yet but whose path is already shut.
2. **Flipping the dial re-opens it within the read interval**, with no deploy: the store changes
   underneath a running gateway and the next read past the interval sees it.
3. **An existing account is unaffected.** This is the half that matters most, because a door that
   locks out the people who are already inside is not a door, it is an outage.
4. **The refusal is one honest code and one sentence**, in Wobo's voice, and every refused
   attempt leaves an audit row.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

import pytest
from conftest import TEST_SUBJECT, mint
from fastapi.testclient import TestClient
from wobo_gateway import consent, doors
from wobo_gateway.app import create_app

ME = "/v1/me"
DOORS = "/v1/doors"

#: A person reading a refusal must not meet a vendor, a gendered pronoun for Wobo, an exclamation
#: mark or an em dash (``docs/copy/voice.md`` §3, §7, §10a).
VENDOR = re.compile(
    r"\b(gemini|openai|anthropic|claude|gpt|litellm|supabase|railway|vercel|resend|google|"
    r"apple|microsoft|stripe|razorpay)\b",
    re.I,
)
PRONOUN = re.compile(r"\b(she|her|hers|herself|he|him|his|himself)\b", re.I)


@pytest.fixture
def closed(monkeypatch: pytest.MonkeyPatch) -> doors.SettingsStore:
    """A gateway with the dial off, and the store that turns it back on."""
    store = doors.InMemorySettingsStore(open_default=False)
    doors.set_store(store)
    consent.reset_cache()
    return store


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def _known(monkeypatch: pytest.MonkeyPatch, *subjects: str) -> None:
    """These subjects have an account in the product; nobody else does, and the lookup works."""
    known = set(subjects)
    monkeypatch.setattr(
        consent, "_fetch_rows", lambda sub: [{"subject_id": sub}] if sub in known else []
    )
    consent.reset_cache()


def _unknowable(monkeypatch: pytest.MonkeyPatch) -> None:
    """The lookup itself could not be made. Nobody may be locked out by that."""
    monkeypatch.setattr(consent, "_fetch_rows", lambda sub: None)
    consent.reset_cache()


# --- the dial ------------------------------------------------------------------------------------


def test_an_unconfigured_gateway_is_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    """No project, no dial, no way to read one: the door is shut. A door that opens itself when
    the database blinks is not a door."""
    monkeypatch.delenv("DOORS_STORE", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    doors.set_store(None)
    assert doors.is_open() is False


def test_a_missing_row_is_closed(closed: doors.SettingsStore) -> None:
    """The dial has never been written. Least privilege, exactly as the consent tier is."""
    closed.write(doors.DIAL, None, actor=None, note=None)
    doors.reset()
    assert doors.is_open() is False


def test_flipping_the_dial_reopens_it_within_the_read_interval(
    closed: doors.SettingsStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A dial, not a deploy. The store changes underneath a running process and the next read
    past the interval sees it, with nothing restarted and nothing released."""
    assert doors.is_open() is False
    now = [1000.0]
    doors.set_clock(lambda: now[0])
    doors.reset()
    assert doors.is_open() is False

    closed.write(doors.DIAL, True, actor="the owner", note="walked the web version")

    # Within the interval the gateway is still serving what it last read. That is the point of an
    # interval; it is bounded, and the bound is under a minute.
    now[0] += doors.refresh_interval_s() / 2
    assert doors.is_open() is False
    assert doors.refresh_interval_s() <= 60

    now[0] += doors.refresh_interval_s()
    assert doors.is_open() is True
    doors.set_clock(None)


def test_the_gateway_reads_it_live_on_the_public_route(
    closed: doors.SettingsStore, client: TestClient
) -> None:
    """The web app follows the switch without a release (DOORS-CLOSED §4). No token needed: this
    is what a stranger's browser asks before it draws the door."""
    assert client.get(DOORS).json() == {doors.DIAL_KEY: False}
    doors.set_open(True, actor="the owner")
    assert client.get(DOORS).json() == {doors.DIAL_KEY: True}
    # The key is the browser's, not ours to pick: `contracts/doors.json` holds it and
    # `test_door_contract.py` is what makes the two spellings one spelling.
    assert doors.DIAL_KEY == "doors_open"


# --- one path at a time --------------------------------------------------------------------------


def test_the_sign_up_door_creates_nothing(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Somebody signed up at the auth server while the door was shut. The product refuses them,
    so no account exists anywhere it matters."""
    _known(monkeypatch, TEST_SUBJECT)
    fresh = {"Authorization": f"Bearer {mint('a-subject-nobody-has-seen')}"}
    answer = client.get(ME, headers=fresh)
    assert answer.status_code == 403
    assert answer.json()["code"] == doors.CODE


def test_the_anonymous_path_creates_nothing(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The one the SDK uses on its own. An anonymous subject IS a freshly minted account, always,
    so it is refused whatever the profile lookup says."""
    _unknowable(monkeypatch)
    anon = {"Authorization": f"Bearer {mint('anon-someone', anonymous=True)}"}
    answer = client.get(ME, headers=anon)
    assert answer.status_code == 403
    assert answer.json()["code"] == doors.CODE


def test_a_deep_link_creates_nothing(closed: doors.SettingsStore, client: TestClient) -> None:
    """The parent's accept page: an open path whose only authority is a signed token in a mail.
    Accepting an invitation is how a parent account starts, so it is shut."""
    answer = client.get("/v1/parent/accept?token=whatever")
    assert answer.status_code == 403
    assert answer.json()["code"] == doors.CODE


def test_the_checkout_creates_nothing(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _known(monkeypatch, TEST_SUBJECT)
    answer = client.post(
        "/v1/billing/checkout",
        json={"plan": "pro", "period": "monthly"},
        headers={"Authorization": f"Bearer {mint(TEST_SUBJECT)}"},
    )
    assert answer.status_code == 403
    assert answer.json()["code"] == doors.CODE


def test_a_parent_invitation_creates_nothing(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An existing learner, in good standing, may not invite a new person in either."""
    _known(monkeypatch, TEST_SUBJECT)
    answer = client.post(
        "/v1/me/parent-invite",
        json={"email": "a.parent@example.com"},
        headers={"Authorization": f"Bearer {mint(TEST_SUBJECT)}"},
    )
    assert answer.status_code == 403
    assert answer.json()["code"] == doors.CODE


def test_the_parent_sign_up_creates_nothing(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _known(monkeypatch, TEST_SUBJECT)
    answer = client.post(
        "/v1/parent/sign-up",
        json={"display_name": "A parent"},
        headers={"Authorization": f"Bearer {mint(TEST_SUBJECT)}"},
    )
    assert answer.status_code == 403
    assert answer.json()["code"] == doors.CODE


def test_the_gift_is_shut_before_it_is_built() -> None:
    """Section 1 names a gift among the paths that may not create an account. Nothing serves it
    today, and the path is in the closed set already so the day it is written it is already shut."""
    assert doors.GIFT_PATH in doors.ACCOUNT_PATHS


def test_every_path_the_law_names_is_in_the_closed_set() -> None:
    for path in (
        "/v1/parent/sign-up",
        "/v1/me/parent-invite",
        "/v1/parent/accept",
        "/v1/billing/checkout",
        doors.GIFT_PATH,
    ):
        assert path in doors.ACCOUNT_PATHS, path


# --- and what stays open -------------------------------------------------------------------------


def test_an_existing_account_is_unaffected(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole point of the switch. Everyone who already has an account signs in and works
    exactly as before, and closing the door locks nobody out."""
    _known(monkeypatch, TEST_SUBJECT)
    answer = client.get(ME, headers={"Authorization": f"Bearer {mint(TEST_SUBJECT)}"})
    assert answer.status_code == 200
    assert answer.json()["subject"] == TEST_SUBJECT


def _seen(monkeypatch: pytest.MonkeyPatch, when: dict[str, datetime]) -> None:
    """These subjects have a record, and the database wrote it at these moments."""
    monkeypatch.setattr(
        consent,
        "_fetch_rows",
        lambda sub: (
            [{"subject_id": sub, "created_at": when[sub].isoformat()}] if sub in when else []
        ),
    )
    consent.reset_cache()


def test_a_record_written_after_the_door_shut_is_not_an_existing_account(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """THE WAY IN THIS RULE EXISTS FOR.

    `learner.profiles_cache` carries one policy, `profiles_cache_own ... for all`, and 0014
    re-granted INSERT on the columns the app's profile sync sends. So a stranger could sign in
    with a provider (an account minted at the auth server, which the gateway never sees), let the
    app write their own profile row with their own token, and the door's third rule then read
    them as an account the product had always held. Every refusal after that turned off.

    One column on that row is not in the grant and never was: `created_at`. A record younger than
    the closure is the sign-up this door refuses, wearing a row.
    """
    shut_at = datetime(2026, 9, 9, 12, 0, tzinfo=UTC)
    doors.set_store(doors.InMemorySettingsStore(open_default=False, changed_at=shut_at))
    _seen(monkeypatch, {"a-stranger-with-a-row": shut_at + timedelta(minutes=5)})
    answer = client.get(ME, headers={"Authorization": f"Bearer {mint('a-stranger-with-a-row')}"})
    assert answer.status_code == 403
    assert answer.json()["code"] == doors.CODE


def test_a_record_the_product_already_held_still_works(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The other half, and the one that matters more: closing the door locks nobody out."""
    shut_at = datetime(2026, 9, 9, 12, 0, tzinfo=UTC)
    doors.set_store(doors.InMemorySettingsStore(open_default=False, changed_at=shut_at))
    _seen(monkeypatch, {TEST_SUBJECT: shut_at - timedelta(days=30)})
    answer = client.get(ME, headers={"Authorization": f"Bearer {mint(TEST_SUBJECT)}"})
    assert answer.status_code == 200


def test_a_dial_that_cannot_say_when_it_moved_lets_a_learner_through(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The rule is off rather than wrong when the store cannot answer, exactly as the lookup
    itself fails towards the learner."""
    monkeypatch.setattr(doors, "closed_since", lambda: None)
    _seen(monkeypatch, {TEST_SUBJECT: datetime.now(UTC)})
    assert client.get(ME, headers={"Authorization": f"Bearer {mint(TEST_SUBJECT)}"}).status_code == 200


def test_a_lookup_that_could_not_be_made_lets_a_learner_through(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A database blip must never read as "this person is new". The door fails towards the
    learner here, because the three refusals that cannot be got wrong (anonymous, and the named
    account paths) do not depend on this lookup at all."""
    _unknowable(monkeypatch)
    answer = client.get(ME, headers={"Authorization": f"Bearer {mint(TEST_SUBJECT)}"})
    assert answer.status_code == 200


def test_erasing_yourself_is_never_behind_the_door(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A data right is not a feature, and a closed door may not stand in front of one."""
    _known(monkeypatch)  # nobody is known: every caller looks new
    answer = client.post(
        "/v1/me/erase", headers={"Authorization": f"Bearer {mint('someone-leaving')}"}
    )
    assert answer.status_code != 403


def test_the_console_is_untouched(closed: doors.SettingsStore, client: TestClient) -> None:
    """An operator has no learner profile, so a first-touch rule would lock the console out of
    its own product on the day it is needed most. The admin surface is exempt by prefix."""
    answer = client.get("/v1/admin/session")
    assert answer.status_code != 403 or answer.json().get("code") != doors.CODE


def test_the_public_pages_are_untouched(closed: doors.SettingsStore, client: TestClient) -> None:
    """438 pages are the reason for all of this. The open syllabus read and the ask box need no
    account and are not behind the dial."""
    assert client.get("/v1/ask/suggestions").status_code == 200


# --- the refusal itself --------------------------------------------------------------------------


def test_the_refusal_is_one_code_and_one_sentence(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _known(monkeypatch, TEST_SUBJECT)
    body = client.get(ME, headers={"Authorization": f"Bearer {mint('brand-new')}"}).json()
    assert set(body) == {"code", "message"}
    assert body["code"] == doors.CODE
    line = body["message"]
    assert line.count(".") == 1 and line.endswith(".")
    assert "!" not in line
    assert "—" not in line and "--" not in line
    assert not VENDOR.search(line)
    assert not PRONOUN.search(line)
    # It says what stands in its place rather than only what is shut.
    assert "list" in line.lower()


def test_every_refused_attempt_leaves_an_audit_row(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _known(monkeypatch, TEST_SUBJECT)
    client.get(ME, headers={"Authorization": f"Bearer {mint('brand-new')}"})
    rows = closed.refusals
    assert len(rows) == 1
    assert rows[0]["reason"] == "new_account"
    assert rows[0]["path"] == ME
    # Never the subject, never an address: a refusal is a count and a shape, not a dossier.
    assert "subject" not in rows[0] and "email" not in rows[0]


def test_a_retrying_client_does_not_become_the_audit(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An SDK that retries anonymously in a loop would otherwise write the audit table full. One
    row per shape per minute; the rest are counted on the row that is already there."""
    _unknowable(monkeypatch)
    anon = {"Authorization": f"Bearer {mint('anon-loop', anonymous=True)}"}
    for _ in range(5):
        client.get(ME, headers=anon)
    assert len(closed.refusals) == 1


def test_the_ones_held_back_are_still_counted(
    closed: doors.SettingsStore, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Coalescing must not turn four attempts into one. The first is written at once and the rest
    of the minute is held; when the window closes, they arrive as a row of their own carrying
    their true count, so nothing is summarised into a number nobody wrote down."""
    _unknowable(monkeypatch)
    now = [1000.0]
    doors.set_clock(lambda: now[0])
    anon = {"Authorization": f"Bearer {mint('anon-loop', anonymous=True)}"}
    for _ in range(4):
        client.get(ME, headers=anon)
    assert [row["count"] for row in closed.refusals] == [1]

    now[0] += doors.REFUSAL_COALESCE_S + 1
    client.get(ME, headers=anon)
    # The three that were held, then the one that closed the window.
    assert [row["count"] for row in closed.refusals] == [1, 3, 1]
    assert sum(row["count"] for row in closed.refusals) == 5
    doors.set_clock(None)


def test_a_change_to_the_dial_is_recorded(closed: doors.SettingsStore) -> None:
    """The gateway's half. The database's half is the trigger in migration 0024, which catches a
    change made in the SQL editor as well as one made here."""
    doors.set_open(True, actor="the owner", note="walked the web version")
    assert closed.changes[-1]["key"] == doors.DIAL
    assert closed.changes[-1]["value"] is True
    assert closed.changes[-1]["actor"] == "the owner"
