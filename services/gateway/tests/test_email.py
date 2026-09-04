"""Email tests. Console mode only — the provider is never called and no network is touched."""

from __future__ import annotations

import io
import json
import urllib.error
from typing import Any

import pytest
from wobo_gateway import email as email_mod
from wobo_gateway import email_templates as templates
from wobo_gateway.app import create_app
from wobo_gateway.email import MailLog, idempotency_key, mail_log, send_email
from wobo_gateway.email_templates import HAND_KINDS, KINDS, PAPER_KINDS, render
from wobo_gateway.hospitality.tokens import stop_link

SHELL_KINDS = tuple(k for k in KINDS if k not in PAPER_KINDS)

INTERNAL_HEADER = {"X-Wobo-Internal": "test-internal-key"}


# --- every template renders to a brand-correct email ----------------------------------
@pytest.mark.parametrize("kind", SHELL_KINDS)
def test_every_template_renders(kind: str) -> None:
    out = render(kind)
    assert set(out) == {"subject", "html", "text"}
    assert out["subject"].strip()
    assert out["text"].strip()
    html = out["html"]
    assert "Wobo" in html  # the wordmark
    assert "#1F35E0" in html  # the one ultramarine button
    assert "href=" in html  # the button is a real link
    assert "made for curious minds" in html  # the quiet footer
    assert "unsubscribe" in html
    assert "&mdash; Wobo" in html  # the sign-off


@pytest.mark.parametrize("kind", sorted(HAND_KINDS))
def test_every_hand_drawn_template_renders(kind: str) -> None:
    """The three from design/email-v1.html and the wish on the same paper: cream paper, navy
    ink, a preheader, a text twin and the List-Unsubscribe header — no ultramarine shell, no
    remote image, no exclamation mark. The one-click promise is made only with a signed link."""
    out = render(kind)
    assert set(out) == {"subject", "html", "text", "preheader", "headers"}
    assert out["subject"].strip() and out["text"].strip() and out["preheader"].strip()
    assert "\n" not in out["preheader"]
    html = out["html"]
    assert "background:#FAF7F0;border-radius:24px" in html  # the paper card
    assert ">wobo<" in html  # the lowercase wordmark
    assert "<img" not in html and "http://" not in html
    assert "#1F35E0" not in html  # not the shell
    assert out["headers"]["List-Unsubscribe"] == "<https://api.heywobo.com/v1/mail/stop>"
    assert "List-Unsubscribe-Post" not in out["headers"]
    signed = render(kind, {"unsubscribe_url": stop_link("L1", "learner")})["headers"]
    assert signed["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"


@pytest.mark.parametrize("kind", KINDS)
def test_the_footer_carries_a_real_opt_out_and_postal_address(
    kind: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A transactional shell that renders a dead ``{{placeholder}}`` opt-out is a compliance bug
    that looks fine in review. Both come from the send path, both are configurable."""
    import importlib

    monkeypatch.setenv("APP_URL", "https://example.test")
    monkeypatch.setenv("GATEWAY_URL", "https://api.example.test")
    monkeypatch.setenv("EMAIL_POSTAL_ADDRESS", "12 Example Road, Bengaluru 560001, India")
    monkeypatch.delenv("EMAIL_UNSUBSCRIBE_URL", raising=False)
    monkeypatch.delenv("MAIL_STOP_URL", raising=False)
    templates = importlib.reload(importlib.import_module("wobo_gateway.email_templates"))
    try:
        html = templates.render(kind)["html"]
        if kind == "welcome":
            # account mail is not switchable (docs/copy/emails): it links the settings instead
            assert 'href="https://example.test/you"' in html
        elif kind == "parent_invite":
            # sent once, to a parent with no account: "Not me" is the way out, on our own route
            assert 'href="https://api.example.test/v1/parent/decline"' in html
        else:
            # the list-wide fallback is our own stop route — a page, never a 404
            assert 'href="https://api.example.test/v1/mail/stop"' in html
        assert "12 Example Road, Bengaluru 560001, India" in html
        assert "{{" not in html and "placeholder" not in html
        # a per-recipient token overrides the list-wide URL
        one = templates.render(
            kind,
            {
                "unsubscribe_url": "https://example.test/u/tok3n",
                "preferences_url": "https://example.test/p/tok3n",
                "decline_url": "https://example.test/d/tok3n",
            },
        )["html"]
        assert (
            'href="https://example.test/u/tok3n"' in one
            or 'href="https://example.test/p/tok3n"' in one
            or 'href="https://example.test/d/tok3n"' in one
        )
    finally:
        monkeypatch.undo()  # the reload below must see the ORIGINAL environment
        importlib.reload(templates)


def test_every_link_follows_APP_URL(monkeypatch: pytest.MonkeyPatch) -> None:
    """The domain swap is one environment variable (WOBO-PLAN §8) — no CTA is hardcoded."""
    import importlib

    monkeypatch.setenv("APP_URL", "https://example.test/")
    templates = importlib.reload(importlib.import_module("wobo_gateway.email_templates"))
    try:
        for kind in templates.KINDS:
            out = templates.render(kind)
            assert "wobo.invalid" not in out["html"], kind
            assert "wobo.invalid" not in out["text"], kind
            assert "https://example.test/" in out["html"], kind
    finally:
        monkeypatch.undo()
        importlib.reload(templates)


def test_there_are_fifteen_templates() -> None:
    """Ten on the shell, three drawn by hand, the wish on the same paper, and the parent invite
    on that paper too — account mail, so not one of the hand kinds that need a stop link."""
    assert len(KINDS) == 15
    assert {"sunday_note", "welcome", "win", "wish"} == HAND_KINDS
    assert HAND_KINDS | {"parent_invite"} == PAPER_KINDS


def test_copy_stays_in_voice_no_emoji_no_exclamation() -> None:
    for kind in KINDS:
        out = render(kind)
        assert "!" not in out["text"], f"{kind} text has an exclamation mark"
        # subjects and headings are sentence case / calm — no shouting punctuation
        assert "!" not in out["subject"], f"{kind} subject has an exclamation mark"


def test_templates_interpolate_data() -> None:
    out = render("boss_victory", {"topic": "titration", "xp": 999})
    assert "titration" in out["html"]
    assert "999" in out["html"]
    assert "titration" in out["text"] and "999" in out["text"]


def test_render_unknown_kind_raises() -> None:
    with pytest.raises(KeyError):
        render("does_not_exist")


# --- console mode never calls the network ---------------------------------------------
def test_console_mode_never_sends(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMAIL_MODE", "console")

    def _boom(*_a: object, **_k: object) -> None:
        raise AssertionError("console mode must never open a network connection")

    monkeypatch.setattr(email_mod.urllib.request, "urlopen", _boom)
    result = send_email("account_created", "learner@example.com", {"name": "Learner"})
    assert result == {"ok": True, "mode": "console", "subject": "welcome to Wobo"}


def test_send_unknown_kind_is_graceful(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMAIL_MODE", "console")
    result = send_email("nope", "learner@example.com")
    assert result["ok"] is False and result["error"] == "unknown_kind"


def test_live_mode_without_key_is_a_queued_would_send(monkeypatch: pytest.MonkeyPatch) -> None:
    """No provider key: the render is proven, the send is held as a would-send, nothing raises."""
    monkeypatch.setenv("EMAIL_MODE", "live")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)

    def _boom(*_a: object, **_k: object) -> None:
        raise AssertionError("no key means no network")

    monkeypatch.setattr(email_mod.urllib.request, "urlopen", _boom)
    result = send_email("account_created", "learner@example.com")
    assert result == {
        "ok": False,
        "queued": True,
        "mode": "live",
        "error": "no_api_key",
        "subject": "welcome to Wobo",
    }


# --- the internal endpoint is never an open relay -------------------------------------
def test_endpoint_403s_without_internal_header(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "test-internal-key")
    client = TestClient(create_app())
    body = {"kind": "account_created", "to": "a@b.com", "consent_tier": "elevated", "data": {}}
    assert client.post("/v1/email/send", json=body).status_code == 403


def test_endpoint_403s_with_wrong_internal_header(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "test-internal-key")
    client = TestClient(create_app())
    body = {"kind": "account_created", "to": "a@b.com", "consent_tier": "elevated", "data": {}}
    r = client.post("/v1/email/send", json=body, headers={"X-Wobo-Internal": "wrong"})
    assert r.status_code == 403


def test_a_non_ascii_internal_header_is_a_403_not_a_500(monkeypatch: pytest.MonkeyPatch) -> None:
    """secrets.compare_digest raises TypeError on a non-ASCII str, so the comparison happens on
    BYTES. An unauthenticated caller must never be able to choose the error class: one accented
    character used to turn a refusal into a 500, which is a probe, not a mistake."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "test-internal-key")
    client = TestClient(create_app())
    body = {"kind": "account_created", "to": "a@b.com", "data": {}}
    # Header bytes on the wire; starlette decodes them latin-1, so the handler sees a str that
    # str.encode("ascii") — and therefore compare_digest — would refuse.
    for header in ("tëst-internal-key", "test-internal-key\u00ff", "ÿÿÿ"):
        raw = {"X-Wobo-Internal": header.encode("latin-1")}
        r = client.post("/v1/email/send", json=body, headers=raw)
        assert r.status_code == 403, header
        assert r.json()["detail"]["code"] == "not_allowed"


def test_endpoint_403s_when_the_internal_key_is_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail closed: an unconfigured key refuses every call, even one carrying a header."""
    from fastapi.testclient import TestClient

    monkeypatch.delenv("INTERNAL_EMAIL_KEY", raising=False)
    client = TestClient(create_app())
    body = {"kind": "account_created", "to": "a@b.com", "data": {}}
    assert client.post("/v1/email/send", json=body, headers=INTERNAL_HEADER).status_code == 403
    assert client.post("/v1/email/send", json=body, headers={}).status_code == 403


def test_endpoint_ignores_a_client_declared_consent_tier(monkeypatch: pytest.MonkeyPatch) -> None:
    """The tier is never read from the body. A spoofed low tier neither blocks nor grants —
    the internal key is the authority for an internal lifecycle send."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "test-internal-key")
    monkeypatch.setenv("EMAIL_MODE", "console")
    client = TestClient(create_app())
    body = {"kind": "account_created", "to": "a@b.com", "consent_tier": "un_elevated", "data": {}}
    r = client.post("/v1/email/send", json=body, headers=INTERNAL_HEADER)
    assert r.status_code == 200


# --- a send made on behalf of a learner may only reach that learner ---------------------
def test_send_on_behalf_of_a_subject_refuses_a_foreign_address() -> None:
    """No profile lookup is wired yet, so a subject-scoped send FAILS CLOSED."""
    result = send_email("account_created", "someone-else@example.com", subject="sub-123")
    assert result["ok"] is False and result["error"] == "not_allowed"


def test_send_on_behalf_of_a_subject_allows_their_own_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EMAIL_MODE", "console")
    monkeypatch.setattr(email_mod, "account_email", lambda sub: "learner@example.com")
    result = send_email("account_created", "Learner@Example.com ", subject="sub-123")
    assert result["ok"] is True


def test_internal_send_without_a_subject_is_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMAIL_MODE", "console")
    assert send_email("account_created", "anyone@example.com")["ok"] is True


def test_endpoint_sends_in_console_with_header_and_consent(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "test-internal-key")
    monkeypatch.setenv("EMAIL_MODE", "console")
    client = TestClient(create_app())
    body = {
        "kind": "account_created",
        "to": "a@b.com",
        "consent_tier": "elevated",
        "data": {"name": "Learner"},
    }
    r = client.post("/v1/email/send", json=body, headers=INTERNAL_HEADER)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "mode": "console", "subject": "welcome to Wobo"}


def test_endpoint_404s_on_unknown_kind(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "test-internal-key")
    monkeypatch.setenv("EMAIL_MODE", "console")
    client = TestClient(create_app())
    body = {"kind": "made_up", "to": "a@b.com", "consent_tier": "elevated", "data": {}}
    r = client.post("/v1/email/send", json=body, headers=INTERNAL_HEADER)
    assert r.status_code == 404


# --- the recipient-ownership rule is reachable code now ---------------------------------
def test_the_endpoint_refuses_a_foreign_address_for_a_verified_learner(
    monkeypatch: pytest.MonkeyPatch, auth
) -> None:
    """The route sat in the middleware's open list, so ``request.state.subject`` was always None
    and ``may_send_to(None, …)`` returned True unconditionally: the "a learner may only mail
    their own address" rule could never fire on the HTTP route. It fires now."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "test-internal-key")
    monkeypatch.setenv("EMAIL_MODE", "console")
    monkeypatch.setattr(email_mod, "account_email", lambda sub: "learner@example.com")
    client = TestClient(create_app())
    body = {"kind": "account_created", "to": "attacker@evil.example", "data": {}}
    r = client.post("/v1/email/send", json=body, headers={**INTERNAL_HEADER, **auth("sub-123")})
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "not_allowed"

    body["to"] = "learner@example.com"
    ok = client.post("/v1/email/send", json=body, headers={**INTERNAL_HEADER, **auth("sub-123")})
    assert ok.status_code == 200


def test_a_bare_internal_key_may_only_send_lifecycle_mail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Anyone holding the internal key could send ANY template to ANY address with attacker-chosen
    data from our verified sending domain. A key with no learner behind it is a service: it sends
    the unattended lifecycle set and nothing about a particular child."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "test-internal-key")
    monkeypatch.setenv("EMAIL_MODE", "console")
    client = TestClient(create_app())
    parent = {"kind": "parent_report", "to": "attacker@evil.example", "data": {}}
    r = client.post("/v1/email/send", json=parent, headers=INTERNAL_HEADER)
    assert r.status_code == 403
    lifecycle = {"kind": "account_created", "to": "new@example.com", "data": {}}
    assert client.post("/v1/email/send", json=lifecycle, headers=INTERNAL_HEADER).status_code == 200


def test_a_bad_token_never_turns_the_endpoint_into_a_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """Soft auth: an unreadable Authorization header leaves the internal key as the only door,
    exactly as before — the endpoint must not start 401ing its own callers."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "test-internal-key")
    monkeypatch.setenv("EMAIL_MODE", "console")
    client = TestClient(create_app())
    body = {"kind": "account_created", "to": "a@b.com", "data": {}}
    r = client.post(
        "/v1/email/send",
        json=body,
        headers={**INTERNAL_HEADER, "Authorization": "Bearer not-a-real-token"},
    )
    assert r.status_code == 200


# --- sweep: the internal relay must not be a phishing primitive -------------------------


def test_a_caller_supplied_cta_cannot_point_off_our_domain() -> None:
    """``/v1/email/send`` carries our domain, our brand and our sending reputation. A caller who
    can set ``cta_url`` would otherwise get a button to anywhere they like, in HTML and in the
    plain-text body alike."""
    from wobo_gateway import email_templates as t

    for hostile in (
        "https://evil.example/collect",
        "http://evil.example/collect",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "//evil.example/collect",
    ):
        out = t.render("course_ready", {"cta_url": hostile})
        assert "evil.example" not in out["html"], hostile
        assert "evil.example" not in out["text"], hostile
        assert "javascript:" not in out["html"].lower(), hostile
        assert "data:text/html" not in out["html"].lower(), hostile
        # it falls back to us rather than erroring — mail still goes out
        assert t.APP_URL in out["html"]


def test_a_hostile_unsubscribe_url_falls_back_to_the_configured_one() -> None:
    from wobo_gateway import email_templates as t

    out = t.render("course_ready", {"unsubscribe_url": "https://evil.example/u"})
    assert "evil.example" not in out["html"]
    assert t.UNSUBSCRIBE_URL in out["html"]


def test_the_button_re_checks_its_url_even_when_a_template_bypasses_link() -> None:
    """Last line of defence: a future template that builds a CTA by hand still cannot emit a
    javascript: href."""
    from wobo_gateway import email_templates as t

    assert "javascript:" not in t._button("go", "javascript:alert(1)").lower()
    assert t.APP_URL in t._button("go", "javascript:alert(1)")


def test_an_on_domain_cta_is_still_honoured() -> None:
    """The allowlist is a filter, not a ban: our own links must survive it."""
    import html

    from wobo_gateway import email_templates as t

    mine = f"{t.APP_URL}/learn/photosynthesis?utm=abc"
    out = t.render("course_ready", {"cta_url": mine})
    assert html.escape(mine, quote=True) in out["html"]
    assert mine in out["text"]


def test_recipient_addresses_are_hashed_in_the_log(caplog) -> None:
    """Our recipients are children and their guardians: the address never lands in a log line."""
    import logging

    from wobo_gateway.email import send_email, to_hash

    with caplog.at_level(logging.INFO, logger="wobo.gateway.email"):
        result = send_email("course_ready", "kid@example.test", {})
    assert result["ok"] is True

    lines = [r for r in caplog.records if hasattr(r, "fields")]
    assert lines
    for record in lines:
        assert "to" not in record.fields
        assert record.fields.get("to_hash") == to_hash("kid@example.test")
    # normalised and non-reversible
    assert to_hash("KID@Example.Test ") == to_hash("kid@example.test")
    assert "kid@example.test" not in to_hash("kid@example.test")


# --- the provider hop: idempotent, retried, degraded — never doubled --------------------------


class _Resp:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> _Resp:
        return self

    def __exit__(self, *_a: object) -> bool:
        return False


def _http_error(code: int, body: bytes = b"{}") -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://api.example.invalid", code, "x", {}, io.BytesIO(body))


def _scripted(monkeypatch: pytest.MonkeyPatch, script: list[Any]) -> list[Any]:
    """A provider that answers from a script: an exception is raised, bytes are the body."""
    calls: list[Any] = []

    def _open(req: Any, timeout: float | None = None) -> _Resp:
        calls.append(req)
        step = script.pop(0)
        if isinstance(step, Exception):
            raise step
        return _Resp(step)

    monkeypatch.setattr(email_mod.urllib.request, "urlopen", _open)
    return calls


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Live mode with a key and a postal line, and a sleep that only records."""
    monkeypatch.setenv("EMAIL_MODE", "live")
    monkeypatch.setenv("RESEND_API_KEY", "test-key-never-logged")
    monkeypatch.setenv("EMAIL_POSTAL_ADDRESS", "12 Example Road, Bengaluru 560001, India")
    slept: list[float] = []
    monkeypatch.setattr(email_mod, "_sleep", slept.append)
    return slept


def test_nothing_leaves_live_without_a_postal_line_or_an_off_switch(
    live: list[float], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A reader is owed a real postal address (CAN-SPAM, DPDP) and a one-click off switch
    (RFC 8058, §14.1) on every hospitality mail. Missing either, the send is a would-send."""

    def _boom(*_a: object, **_k: object) -> None:
        raise AssertionError("a held send must never reach the provider")

    monkeypatch.setattr(email_mod.urllib.request, "urlopen", _boom)
    # The company's own address is the default, so an unset variable still mails lawfully;
    # the guard is what stands between us and a send with NO address at all.
    monkeypatch.delenv("EMAIL_POSTAL_ADDRESS", raising=False)
    assert "Dot eVentures Pvt Ltd" in templates.postal_address()
    assert "Hyderabad" in templates.postal_address()
    monkeypatch.setattr(templates, "_POSTAL_DEFAULT", "")
    held = send_email("account_created", "kid@example.test", learner_id="L1", period="once")
    assert held["queued"] is True and held["error"] == "no_postal_address"
    monkeypatch.setattr(templates, "_POSTAL_DEFAULT", "Dot eVentures Pvt Ltd, Hyderabad, India")
    monkeypatch.setenv("EMAIL_POSTAL_ADDRESS", "12 Example Road, Bengaluru 560001, India")
    # a hospitality mail with no signed stop link (no signing key in this process)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("MAIL_TOKEN_SECRET", raising=False)
    held = send_email("win", "kid@example.test", {"chapter": "Triangles"}, period="chapter:t")
    assert held["queued"] is True and held["error"] == "no_stop_link"
    # the render was proven and recorded, so the same period does not go twice once it can
    assert [r.provider_id for r in mail_log().records()] == ["queued", "queued"]


def test_every_live_send_carries_a_name(
    live: list[float], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The provider's edge refuses urllib's default signature with a 403 before the API sees the
    request (proved live, 2026-09-04). Every send names itself, and the name says nothing about
    what is underneath it (§17)."""
    calls = _scripted(monkeypatch, [b'{"id": "prov-ua"}'])
    sent = send_email("win", "kid@example.test", {"chapter": "Triangles"}, period="w40",
                      headers={"List-Unsubscribe": "<https://x.test/s?token=t>",
                               "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"})
    assert sent["ok"] is True
    agent = calls[0].get_header("User-agent") or calls[0].get_header("User-Agent")
    assert agent and "Python-urllib" not in agent
    assert "wobo" in agent.lower()
    for banned in ("resend", "claude", "anthropic", "openai", "gpt", "gemini", "supabase"):
        assert banned not in agent.lower()


def test_a_period_makes_the_send_idempotent() -> None:
    """The same (kind, recipient, period) goes out once, ever — the second call is a no-op."""
    first = send_email(
        "win", "kid@example.test", {"chapter": "Triangles"}, learner_id="L1", period="w36"
    )
    assert first["ok"] is True
    assert first["key"] == idempotency_key("win", "kid@example.test", "w36", learner_id="L1")
    second = send_email(
        "win", "KID@example.test ", {"chapter": "Triangles"}, learner_id="L1", period="w36"
    )
    assert second == {"ok": True, "mode": "console", "duplicate": True, "id": "console"}
    assert len(mail_log().records()) == 1
    record = mail_log().records()[0]
    assert (record.learner_id, record.kind, record.period, record.provider_id) == (
        "L1",
        "win",
        "w36",
        "console",
    )
    assert "kid@example.test" not in record.key and "kid@example.test" not in record.to_hash
    # a different period is a different send
    assert send_email("win", "kid@example.test", learner_id="L1", period="w37")["ok"] is True
    assert len(mail_log().records()) == 2


def test_the_log_survives_a_restart(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "mail.jsonl"
    email_mod.set_mail_log(MailLog(path))
    send_email("welcome", "kid@example.test", learner_id="L1", period="once")
    assert path.exists()
    email_mod.set_mail_log(MailLog(path))  # a new process reads the same file
    again = send_email("welcome", "kid@example.test", learner_id="L1", period="once")
    assert again["duplicate"] is True
    assert len(mail_log().records()) == 1


def test_a_5xx_is_retried_with_backoff_and_a_4xx_is_not(
    live: list[float], monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _scripted(monkeypatch, [_http_error(503), _http_error(500), b'{"id": "em_1"}'])
    result = send_email("account_created", "kid@example.test", learner_id="L1", period="once")
    assert result == {"ok": True, "mode": "live", "id": "em_1"}
    assert len(calls) == 3
    assert live == [0.5, 2.0]
    assert mail_log().records()[0].provider_id == "em_1"

    calls = _scripted(monkeypatch, [_http_error(400, b'{"message": "bad recipient"}')])
    result = send_email("account_created", "kid@example.test")
    assert result == {"ok": False, "mode": "live", "error": "send_failed", "status": 400}
    assert len(calls) == 1 and live == [0.5, 2.0]  # no retry, no extra sleep


def test_retries_give_up_after_three_attempts(
    live: list[float], monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _scripted(
        monkeypatch, [_http_error(502), urllib.error.URLError("down"), _http_error(504)]
    )
    result = send_email("account_created", "kid@example.test", learner_id="L1", period="once")
    assert result == {"ok": False, "mode": "live", "error": "send_failed", "status": 504}
    assert len(calls) == 3
    # a failed send is NOT remembered: the next honest attempt may still go out
    assert mail_log().records() == []


def test_an_unverified_sending_domain_degrades_to_queued(
    live: list[float], monkeypatch: pytest.MonkeyPatch, caplog: Any
) -> None:
    """Until heywobo.com is verified with the provider, every live send is a logged would-send:
    recorded (so the same period never goes twice once the domain is), never raised."""
    import logging

    refusal = (
        b'{"statusCode":403,"name":"validation_error",'
        b'"message":"The heywobo.com domain is not verified."}'
    )
    calls = _scripted(monkeypatch, [_http_error(403, refusal)])
    stop = stop_link("L1", "sunday_note")
    with caplog.at_level(logging.WARNING, logger="wobo.gateway.email"):
        result = send_email(
            "sunday_note",
            "parent@example.test",
            {"learner_name": "Learner", "days_active": 4, "unsubscribe_url": stop},
            learner_id="L1",
            period="2026-W36",
        )
    assert (
        result["queued"] is True
        and result["error"] == "domain_unverified"
        and result["ok"] is False
    )
    assert len(calls) == 1 and live == []  # a config state is not retried
    assert [r.provider_id for r in mail_log().records()] == ["queued"]
    assert any("would send" in r.getMessage() for r in caplog.records)
    # the second run of the same period does not even try
    calls = _scripted(monkeypatch, [])
    again = send_email(
        "sunday_note",
        "parent@example.test",
        {"unsubscribe_url": stop},
        learner_id="L1",
        period="2026-W36",
    )
    assert again["duplicate"] is True and calls == []


def test_headers_and_the_idempotency_key_ride_to_the_provider(
    live: list[float], monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _scripted(monkeypatch, [b'{"id": "em_2"}'])
    stop = stop_link("L1", "learner")
    assert stop
    send_email(
        "win",
        "kid@example.test",
        {"chapter": "Triangles", "unsubscribe_url": stop},
        learner_id="L1",
        period="chapter:triangles",
        headers={"X-Wobo-Kind": "win"},
    )
    req = calls[0]
    body = json.loads(req.data.decode())
    assert body["to"] == ["kid@example.test"]
    assert body["reply_to"] == email_mod._REPLY_TO
    assert body["headers"]["List-Unsubscribe"] == f"<{stop}>"
    assert body["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert body["headers"]["X-Wobo-Kind"] == "win"
    assert req.get_header("Idempotency-key") == idempotency_key(
        "win", "kid@example.test", "chapter:triangles", learner_id="L1"
    )
    assert req.get_header("Authorization") == "Bearer test-key-never-logged"


def test_the_provider_is_named_nowhere_a_reader_can_see() -> None:
    """White-label (WOBO-PLAN §17): not in copy, not in a mail header, not in a result."""
    for kind in KINDS:
        out = render(kind)
        blob = (
            out["subject"] + out["html"] + out["text"] + json.dumps(out.get("headers", {}))
        ).lower()
        assert "resend" not in blob, kind
    result = send_email("welcome", "kid@example.test")
    assert "resend" not in json.dumps(result).lower()


def test_the_key_never_lands_in_a_log_line(
    live: list[float], monkeypatch: pytest.MonkeyPatch, caplog: Any
) -> None:
    import logging

    _scripted(monkeypatch, [_http_error(500), _http_error(500), _http_error(500)])
    with caplog.at_level(logging.DEBUG):
        send_email("account_created", "kid@example.test")
    for record in caplog.records:
        assert "test-key-never-logged" not in record.getMessage()
        assert "test-key-never-logged" not in json.dumps(getattr(record, "fields", {}))
