"""Two streams, as the large senders keep them (docs/MAIL-PRIMARY.md, "What the global senders do").

Transactional mail (sign-in codes, receipts, account mail, and the owner's own alerts) reads its
sender from ``EMAIL_FROM_TRANSACTIONAL``, so a bad week for learning notes never stops a family
signing in or getting a receipt. Until the owner's DNS for that stream exists the variable is
unset and the code falls back to today's sender: every mail's From stays byte-identical to what
it is now. Learning notes keep ``EMAIL_FROM`` forever. The display name is "Wobo" on both.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from wobo_gateway import email as email_mod
from wobo_gateway.email import send_email
from wobo_gateway.email_templates import SUBSCRIBED_KINDS, TEMPLATES, TRANSACTIONAL_KINDS
from wobo_gateway.hospitality.tokens import stop_link

#: What every mail said on the day this was written, before the second stream existed.
TODAY = "Wobo <hello@mail.heywobo.com>"


@pytest.fixture()
def wire(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    monkeypatch.setenv("EMAIL_MODE", "live")
    monkeypatch.setenv("RESEND_API_KEY", "test-key-never-logged")
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "a-test-secret")
    monkeypatch.delenv("EMAIL_FROM_TRANSACTIONAL", raising=False)
    email_mod.reset_mail_log()
    sent: list[dict[str, Any]] = []

    def fake_post(body: bytes, key: str, idem: str | None) -> Any:
        sent.append(json.loads(body.decode()))
        return email_mod._Reply(ok=True, status=200, result={"id": "em_stream"})

    monkeypatch.setattr(email_mod, "_post", fake_post)
    yield sent
    email_mod.reset_mail_log()


def _from(kind: str, wire: list[dict[str, Any]], n: int = 0) -> str:
    data: dict[str, Any] = {"name": "Learner", "learner_name": "Learner"}
    if kind in SUBSCRIBED_KINDS:
        data["unsubscribe_url"] = stop_link("L1", "learner")
    before = len(wire)
    send_email(kind, "reader@example.test", data, learner_id="L1", period=f"stream-{kind}-{n}")
    assert len(wire) == before + 1, kind
    return str(wire[-1]["from"])


def test_with_the_new_variable_unset_every_from_is_byte_identical_to_today(
    wire: list[dict[str, Any]],
) -> None:
    assert email_mod._FROM == TODAY  # the default the suite runs with
    for kind in sorted(TEMPLATES):
        assert _from(kind, wire).encode() == TODAY.encode(), kind


def test_an_empty_variable_is_the_same_as_an_unset_one(
    wire: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EMAIL_FROM_TRANSACTIONAL", "   ")
    for kind in sorted(TRANSACTIONAL_KINDS):
        assert _from(kind, wire) == TODAY, kind


def test_with_it_set_only_transactional_mail_moves(
    wire: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EMAIL_FROM_TRANSACTIONAL", "Wobo <hello@account.heywobo.com>")
    for kind in sorted(TEMPLATES):
        expected = "Wobo <hello@account.heywobo.com>" if kind in TRANSACTIONAL_KINDS else TODAY
        assert _from(kind, wire, 1) == expected, kind
    assert {"verify_email", "plan_opened", "account_created", "mail_alert"} <= TRANSACTIONAL_KINDS


def test_the_display_name_is_wobo_on_both_whatever_the_variable_says(
    wire: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    for given in (
        "Wobo Accounts <codes@account.heywobo.com>",
        "codes@account.heywobo.com",
        "<codes@account.heywobo.com>",
    ):
        monkeypatch.setenv("EMAIL_FROM_TRANSACTIONAL", given)
        assert email_mod.sender_for("verify_email") == "Wobo <codes@account.heywobo.com>", given
    assert email_mod.sender_for("learning_note") == TODAY


def test_a_variable_that_is_not_an_address_falls_back_rather_than_breaking_sign_in(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for broken in ("Wobo <>", "not an address", "a@b@c", "Wobo <x@y.com>, Other <z@w.com>"):
        monkeypatch.setenv("EMAIL_FROM_TRANSACTIONAL", broken)
        assert email_mod.sender_for("verify_email") == TODAY, broken


def test_the_list_domain_stays_on_the_learning_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    """List-Id names the learning stream's domain; moving the transactional sender must not move
    it, because only subscribed mail carries a List-Id at all."""
    monkeypatch.setenv("EMAIL_FROM_TRANSACTIONAL", "Wobo <hello@account.heywobo.com>")
    assert email_mod._list_domain() == "mail.heywobo.com"
