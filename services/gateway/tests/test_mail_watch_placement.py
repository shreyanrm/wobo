"""Seeing the inbox (wave 56, the deliverability watch).

docs/MAIL-PRIMARY.md, "Watching where we land": *"a daily placement check that sends one real
mail per Primary-relevant kind to inboxes we own on Gmail, Outlook, Yahoo and Apple Mail and reads
which folder it landed in"*.

What is proved, with the clock handed in, the send replaced by a recorder and every mailbox a
fake one:

1. **Configuration or nothing.** The addresses and app passwords come only from the environment.
   With none set the job does nothing and says "not configured". A provider with only half of
   its pair is not configured either.
2. **Only to our own inboxes.** Every send goes to a configured seed address and nowhere else,
   one per Primary-relevant kind per inbox per day, once, at the family's hour.
3. **The read.** A while after the send, each seed inbox is asked where the mail went: which Gmail
   tab, the inbox or the spam folder elsewhere, and what the receiving server said about SPF,
   DKIM and DMARC. A mail in spam, a mail that never arrived, and a failed authentication each
   raise an alert naming the cause.
4. **Nothing leaves in console mode**, because a render that went nowhere cannot land anywhere.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from wobo_gateway import doors
from wobo_gateway import email as email_mod
from wobo_gateway.email import MailLog
from wobo_gateway.email_templates import render
from wobo_gateway.mailwatch import placement, store

#: 2026-09-16, 16:30 in Kolkata: the hour the seed goes.
SEND_AT = datetime(2026, 9, 16, 11, 0, tzinfo=UTC)
DAY = date(2026, 9, 16)
GOOD_AUTH = (
    "mx.google.com; dkim=pass header.i=@mail.heywobo.com header.s=resend; "
    "spf=pass (google.com: domain of bounces@send.mail.heywobo.com designates 1.2.3.4) "
    "smtp.mailfrom=send.mail.heywobo.com; dmarc=pass (p=NONE sp=NONE dis=NONE) "
    "header.from=mail.heywobo.com"
)
SEEDS = {
    "gmail": ("seed.gmail@example.test", "gmail-app-password"),
    "outlook": ("seed.outlook@example.test", "outlook-app-password"),
    "yahoo": ("seed.yahoo@example.test", "yahoo-app-password"),
    "apple": ("seed.apple@example.test", "apple-app-password"),
}


def configure(monkeypatch: pytest.MonkeyPatch, *providers: str) -> None:
    for name in providers:
        address, password = SEEDS[name]
        monkeypatch.setenv(f"MAIL_SEED_{name.upper()}_ADDRESS", address)
        monkeypatch.setenv(f"MAIL_SEED_{name.upper()}_PASSWORD", password)


@dataclass
class FakeMailbox:
    """One seed inbox. ``where`` maps a subject to (folder, tab, auth header)."""

    provider: str
    where: dict[str, tuple[str, str | None, str]] = field(default_factory=dict)
    asked: list[tuple[str, str]] = field(default_factory=list)
    closed: bool = False

    def find(self, folder: str, subject: str, since: datetime) -> str | None:
        self.asked.append((folder, subject))
        landed = self.where.get(subject)
        if landed and landed[0] == folder:
            return f"uid-{len(self.asked)}"
        return None

    def category(self, uid: str, subject: str, since: datetime) -> str | None:
        landed = self.where.get(subject)
        return landed[1] if landed else None

    def authentication(self, folder: str, uid: str, subject: str) -> str:
        landed = self.where.get(subject)
        return landed[2] if landed else ""

    def close(self) -> None:
        self.closed = True


class Boxes:
    """The mailbox factory: every open is recorded, and every mail lands where it is told to."""

    def __init__(self, landing: dict[str, tuple[str, str | None, str]] | None = None) -> None:
        self.landing = landing or {}
        self.opened: list[placement.Seed] = []
        self.boxes: list[FakeMailbox] = []

    def __call__(self, seed: placement.Seed) -> FakeMailbox:
        self.opened.append(seed)
        where: dict[str, tuple[str, str | None, str]] = {}
        for kind in placement.PRIMARY_KINDS:
            subject = render(kind, placement.seed_data(kind))["subject"]
            default = ("INBOX", "primary" if seed.provider == "gmail" else None, GOOD_AUTH)
            where[subject] = self.landing.get(f"{seed.provider}:{kind}", default)
        box = FakeMailbox(seed.provider, where)
        self.boxes.append(box)
        return box


class Sends:
    def __init__(self, ok: bool = True) -> None:
        self.sent: list[dict[str, Any]] = []
        self.ok = ok

    def __call__(
        self, kind: str, to: str, data: dict[str, Any] | None = None, **kw: Any
    ) -> dict[str, Any]:
        self.sent.append({"kind": kind, "to": to, "data": data or {}, **kw})
        if not self.ok:
            return {"ok": False, "queued": True, "error": "daily_cap"}
        return {"ok": True, "mode": "live", "id": f"em_{len(self.sent)}"}


@pytest.fixture(autouse=True)
def _watch(monkeypatch: pytest.MonkeyPatch) -> Any:
    for name in SEEDS:
        monkeypatch.delenv(f"MAIL_SEED_{name.upper()}_ADDRESS", raising=False)
        monkeypatch.delenv(f"MAIL_SEED_{name.upper()}_PASSWORD", raising=False)
    monkeypatch.setenv("EMAIL_MODE", "live")
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "a-test-secret")
    # Live mode, so the provider hop is refused outright: no key, and a transport that raises. The
    # alerts these tests raise go through the real send path and must never leave this machine.
    monkeypatch.delenv("RESEND_API_KEY", raising=False)

    def no_wire(body: bytes, key: str, idem: str | None) -> Any:
        raise AssertionError("nothing may reach the provider from this file")

    monkeypatch.setattr(email_mod, "_post", no_wire)
    watch = store.WatchStore()
    store.set_store(watch)
    doors.set_store(doors.InMemorySettingsStore())
    email_mod.set_mail_log(MailLog())
    yield watch
    store.set_store(None)
    doors.set_store(None)
    email_mod.reset_mail_log()


def never_open(seed: placement.Seed) -> Any:
    raise AssertionError(f"no inbox may be opened here: {seed.provider}")


# === 1. configuration =============================================================================
def test_with_nothing_set_the_job_does_nothing_and_says_so() -> None:
    sends = Sends()
    report = placement.run_placement(SEND_AT, send=sends, open_mailbox=never_open)
    assert report["configured"] is False
    assert sends.sent == []
    assert placement.seeds() == {}
    assert placement.desk_view()["configured"] is False


def test_half_a_pair_is_not_a_seed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAIL_SEED_GMAIL_ADDRESS", "seed.gmail@example.test")
    monkeypatch.setenv("MAIL_SEED_OUTLOOK_PASSWORD", "orphan")
    assert placement.seeds() == {}
    report = placement.run_placement(SEND_AT, send=Sends(), open_mailbox=never_open)
    assert report["configured"] is False


def test_the_four_providers_and_the_primary_kinds_are_the_laws() -> None:
    assert (
        set(placement.PROVIDERS)
        == set(email_mod.SEED_INBOXES)
        == {"gmail", "outlook", "yahoo", "apple"}
    )
    assert set(placement.PRIMARY_KINDS) >= {
        "welcome",
        "quick_one",
        "mid_chapter",
        "doubt",
        "sunday_note",
    }
    # The good-news note is most of what a family now receives, so its placement is measured too.
    assert "learning_note" in placement.PRIMARY_KINDS


def test_a_seed_mail_is_a_real_render_with_no_empty_placeholder() -> None:
    for kind in placement.PRIMARY_KINDS:
        mail = render(kind, placement.seed_data(kind))
        assert mail["subject"].strip(), kind
        assert "{{" not in mail["text"], kind


# === 2. only our own inboxes ======================================================================
def test_one_mail_per_kind_per_inbox_goes_only_to_the_configured_seeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure(monkeypatch, "gmail", "outlook", "yahoo", "apple")
    sends = Sends()
    report = placement.run_placement(SEND_AT, send=sends, open_mailbox=never_open)

    addresses = {address for address, _ in SEEDS.values()}
    assert {s["to"] for s in sends.sent} == addresses
    assert len(sends.sent) == len(SEEDS) * len(placement.PRIMARY_KINDS)
    assert report["sent"] == len(sends.sent)
    for record in sends.sent:
        assert record["to"] in addresses
        assert record["kind"] in placement.PRIMARY_KINDS
        # The seed is not a learner: no learner id, and its own period so it never collides.
        assert record.get("learner_id") is None
        assert record["period"].startswith("seed-20260916-")
        # Nothing about a seed may leak a password into a mail.
        assert "app-password" not in str(record["data"])

    # A second call the same day sends nothing more.
    again = Sends()
    placement.run_placement(SEND_AT + timedelta(minutes=1), send=again, open_mailbox=Boxes())
    assert again.sent == []


def test_nothing_goes_before_the_hour_or_in_console_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    configure(monkeypatch, "gmail")
    early = datetime(2026, 9, 16, 3, 0, tzinfo=UTC)  # 08:30 in Kolkata
    sends = Sends()
    placement.run_placement(early, send=sends, open_mailbox=never_open)
    assert sends.sent == []

    monkeypatch.setenv("EMAIL_MODE", "console")
    report = placement.run_placement(SEND_AT, send=sends, open_mailbox=never_open)
    assert sends.sent == []
    assert report["live"] is False


def test_a_held_send_is_tried_again_and_never_read(monkeypatch: pytest.MonkeyPatch) -> None:
    configure(monkeypatch, "gmail")
    held = Sends(ok=False)
    report = placement.run_placement(SEND_AT, send=held, open_mailbox=never_open)
    assert report["sent"] == 0
    assert report["held"] == {"daily_cap": len(placement.PRIMARY_KINDS)}
    later = SEND_AT + timedelta(hours=1)
    retried = Sends()
    placement.run_placement(later, send=retried, open_mailbox=never_open)
    assert len(retried.sent) == len(placement.PRIMARY_KINDS)


def test_the_real_send_path_carries_the_seed_to_the_wire(monkeypatch: pytest.MonkeyPatch) -> None:
    """Through ``send_email`` itself, with the provider hop captured: the same envelope, the same
    sender and the same headers a family's mail carries, so what is measured is what is sent."""
    import json

    configure(monkeypatch, "outlook")
    monkeypatch.setenv("RESEND_API_KEY", "test-key-never-logged")
    wire: list[dict[str, Any]] = []

    def fake_post(body: bytes, key: str, idem: str | None) -> Any:
        wire.append(json.loads(body.decode()))
        return email_mod._Reply(ok=True, status=200, result={"id": f"em_{len(wire)}"})

    monkeypatch.setattr(email_mod, "_post", fake_post)
    placement.run_placement(SEND_AT, open_mailbox=never_open)
    assert len(wire) == len(placement.PRIMARY_KINDS)
    assert {tuple(e["to"]) for e in wire} == {("seed.outlook@example.test",)}
    assert {e["from"] for e in wire} == {email_mod._FROM}
    for envelope in wire:
        assert "List-Unsubscribe" in envelope["headers"]


# === 3. the read ==================================================================================
def _sent_then(monkeypatch: pytest.MonkeyPatch, *providers: str) -> None:
    configure(monkeypatch, *providers)
    placement.run_placement(SEND_AT, send=Sends(), open_mailbox=never_open)


def test_nothing_is_read_before_the_mail_has_had_time_to_land(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _sent_then(monkeypatch, "gmail")
    placement.run_placement(SEND_AT + timedelta(minutes=2), send=Sends(), open_mailbox=never_open)


def test_the_read_records_the_gmail_tab_and_the_folder_elsewhere(
    monkeypatch: pytest.MonkeyPatch, _watch: store.WatchStore
) -> None:
    _sent_then(monkeypatch, "gmail", "outlook")
    boxes = Boxes({"gmail:quick_one": ("INBOX", "promotions", GOOD_AUTH)})
    report = placement.run_placement(
        SEND_AT + placement.READ_AFTER, send=Sends(), open_mailbox=boxes
    )

    assert report["read"] == 2 * len(placement.PRIMARY_KINDS)
    assert all(box.closed for box in boxes.boxes)
    assert {seed.provider for seed in boxes.opened} == {"gmail", "outlook"}
    landed = {(r["provider"], r["kind"]): r for r in placement.desk_view()["results"]}
    assert landed[("gmail", "quick_one")]["tab"] == "promotions"
    assert landed[("gmail", "welcome")]["tab"] == "primary"
    assert landed[("outlook", "welcome")]["tab"] == "inbox"
    assert landed[("outlook", "welcome")]["auth"] == {
        "spf": "pass",
        "dkim": "pass",
        "dmarc": "pass",
    }
    # The same measurement lands on the mail log, where the law's seed record has always lived.
    seeds = [e for e in email_mod.mail_log().events() if e["event"] == "seed"]
    assert len(seeds) == 2 * len(placement.PRIMARY_KINDS)
    # A promotions tab is shown, not alarmed.
    assert _watch.rows(store.ALERT) == []

    # Read once: a second pass opens nothing.
    placement.run_placement(SEND_AT + timedelta(hours=1), send=Sends(), open_mailbox=never_open)


def test_a_seed_in_spam_raises_an_alert_naming_the_inbox_and_the_kind(
    monkeypatch: pytest.MonkeyPatch, _watch: store.WatchStore
) -> None:
    _sent_then(monkeypatch, "yahoo")
    boxes = Boxes({"yahoo:learning_note": ("Bulk", None, GOOD_AUTH)})
    placement.run_placement(SEND_AT + placement.READ_AFTER, send=Sends(), open_mailbox=boxes)
    landed = {(r["provider"], r["kind"]): r for r in placement.desk_view()["results"]}
    assert landed[("yahoo", "learning_note")]["tab"] == "spam"
    alerts = _watch.rows(store.ALERT)
    assert [(a.event, a.kind) for a in alerts] == [("seed_in_spam", "learning_note")]
    assert "yahoo" in alerts[0].detail["message"]


def test_a_failed_authentication_raises_its_own_alert(
    monkeypatch: pytest.MonkeyPatch, _watch: store.WatchStore
) -> None:
    _sent_then(monkeypatch, "apple")
    bad = "mx.icloud.com; spf=pass smtp.mailfrom=send.mail.heywobo.com; dkim=fail; dmarc=fail"
    boxes = Boxes({"apple:welcome": ("INBOX", None, bad)})
    placement.run_placement(SEND_AT + placement.READ_AFTER, send=Sends(), open_mailbox=boxes)
    causes = [(a.event, a.kind) for a in _watch.rows(store.ALERT)]
    assert ("authentication", "welcome") in causes
    message = next(a for a in _watch.rows(store.ALERT) if a.event == "authentication").detail[
        "message"
    ]
    assert "dkim" in message.lower() and "dmarc" in message.lower()


def test_a_mail_that_never_arrives_waits_then_says_so(
    monkeypatch: pytest.MonkeyPatch, _watch: store.WatchStore
) -> None:
    _sent_then(monkeypatch, "gmail")
    nowhere = Boxes({f"gmail:{kind}": ("Nowhere", None, "") for kind in placement.PRIMARY_KINDS})
    placement.run_placement(SEND_AT + placement.READ_AFTER, send=Sends(), open_mailbox=nowhere)
    assert placement.desk_view()["results"] == []
    assert _watch.rows(store.ALERT) == []

    placement.run_placement(SEND_AT + placement.GIVE_UP, send=Sends(), open_mailbox=nowhere)
    tabs = {r["tab"] for r in placement.desk_view()["results"]}
    assert tabs == {"missing"}
    causes = {a.event for a in _watch.rows(store.ALERT)}
    assert causes == {"seed_missing"}


def test_an_inbox_that_cannot_be_opened_is_a_reason_not_a_crash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _sent_then(monkeypatch, "gmail")

    def refuses(seed: placement.Seed) -> Any:
        raise OSError("login refused")

    report = placement.run_placement(
        SEND_AT + placement.READ_AFTER, send=Sends(), open_mailbox=refuses
    )
    assert report["unreadable"] == ["gmail"]
    assert "login refused" not in str(report)


def test_the_authentication_header_is_read_mechanism_by_mechanism() -> None:
    assert placement.parse_auth(GOOD_AUTH) == {"spf": "pass", "dkim": "pass", "dmarc": "pass"}
    # Two DKIM signatures, one of them the provider's own: a pass on either is a pass.
    two = "x; dkim=neutral header.i=@amazonses.com; dkim=pass header.i=@mail.heywobo.com; spf=pass"
    assert placement.parse_auth(two) == {"spf": "pass", "dkim": "pass"}
    assert placement.failed(placement.parse_auth(two)) == []
    assert placement.failed({"spf": "softfail", "dkim": "pass", "dmarc": "fail"}) == [
        "spf",
        "dmarc",
    ]
    assert placement.parse_auth("") == {}


def test_the_desk_names_the_providers_and_never_an_address_or_a_password(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure(monkeypatch, "gmail")
    view = placement.desk_view()
    assert view["configured"] is True
    assert {p["provider"]: p["configured"] for p in view["providers"]} == {
        "gmail": True,
        "outlook": False,
        "yahoo": False,
        "apple": False,
    }
    assert "@" not in str(view)
    assert "password" not in str(view).lower()
