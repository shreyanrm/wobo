"""The domain the gateway falls back to when the host forgot a variable.

Wave 6 gave the product a real domain (heywobo.com, 2026-09-03). Every one of these values is
still read from the environment — that is `test_hardening.test_the_env_defaults_are_all_overridable`
— so what these tests pin is the *fallback*: a Railway service that lost `EMAIL_FROM` must not
start sending as a reserved name that can never receive a reply.

Pure module reads plus a render; no network.
"""

from __future__ import annotations

import importlib
import re
from pathlib import Path

import pytest

DOMAIN = "heywobo.com"
REPO = Path(__file__).resolve().parents[3]


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch):
    """Import the mail modules with no host overrides at all — the fallback path."""
    for name in ("APP_URL", "APP_NAME", "EMAIL_FROM", "EMAIL_REPLY_TO", "EMAIL_UNSUBSCRIBE_URL",
                 "EMAIL_POSTAL_ADDRESS"):
        monkeypatch.delenv(name, raising=False)
    modules = ["wobo_gateway.email", "wobo_gateway.email_templates"]
    reloaded = [importlib.reload(importlib.import_module(name)) for name in modules]
    yield reloaded
    for name in modules:
        importlib.reload(importlib.import_module(name))


def test_the_sender_and_reply_to_default_to_real_addresses(clean_env) -> None:
    email_mod, _ = clean_env
    sender, reply_to = email_mod._FROM, email_mod._REPLY_TO
    # The sender lives on the SENDING SUBDOMAIN and the reply-to on the root (docs/MAIL-PRIMARY.md,
    # revised 2026-09-10). The split is the point: the launch mail to the waiting list is a batch to
    # people who signed up months earlier, which is how a domain's reputation is burned, and
    # support@ must stay reachable whatever happens to the address that sends.
    assert sender == f"Wobo <hello@mail.{DOMAIN}>"
    assert reply_to == f"support@{DOMAIN}"


def test_every_link_defaults_under_our_domain(clean_env) -> None:
    _, templates = clean_env
    # Read through locals: `templates.APP_URL` is CONSTANT_CASE, and a comparison starting there
    # reads to the linter as a Yoda condition however it is written.
    app_url, unsubscribe_url = templates.APP_URL, templates.UNSUBSCRIBE_URL
    assert app_url == f"https://{DOMAIN}"
    # the list-wide opt-out is the gateway's own stop route (hospitality/tokens.py): a page that
    # says so and points at sign-in, never a 404 — and still under our domain
    assert unsubscribe_url == f"https://api.{DOMAIN}/v1/mail/stop"
    html = templates.render("account_created")["html"]
    assert f"https://{DOMAIN}/" in html
    # No host from a platform we merely rent may appear in mail we send.
    for banned in ("up.railway.app", "vercel.app", "supabase.co", "wobo.invalid"):
        assert banned not in html, banned


def test_the_gateway_falls_back_to_the_same_origin_as_the_mail(clean_env) -> None:
    """One origin, two modules. `app.APP_URL` is the CORS allow-list entry and
    `email_templates.APP_URL` is the base of every link we send; a service that lost the variable
    must not end up allowing one origin and linking to another.

    Read out of the source rather than by reloading `wobo_gateway.app`: a reload rebinds that
    module's exception classes, and every suite that imported `ConsentDenied` from it would stop
    recognising the exception the gateway raises.
    """
    _, templates = clean_env
    source = (REPO / "services/gateway/src/wobo_gateway/app.py").read_text(encoding="utf-8")
    found = re.search(r'APP_URL = os\.getenv\("APP_URL", "([^"]+)"\)', source)
    assert found, "app.py no longer reads APP_URL from the environment with a default"
    gateway_default = found.group(1).rstrip("/")
    assert gateway_default == f"https://{DOMAIN}"
    assert gateway_default == templates.APP_URL


def test_the_postal_address_default_is_the_company_the_mail_is_actually_from(clean_env) -> None:
    """Anti-spam law wants a real postal address on every commercial mail, so the company's own
    is the default: a forgotten variable can never strip the footer or ship a placeholder."""
    _, templates = clean_env
    assert "Dot eVentures Pvt Ltd" in templates.POSTAL_ADDRESS
    assert "Hyderabad" in templates.POSTAL_ADDRESS
    assert "PLACEHOLDER" not in templates.POSTAL_ADDRESS


def test_shipped_code_names_no_hosting_provider() -> None:
    """The two hostnames §17 said the domain wave would close. Tests may name them; code may not."""
    offenders: list[str] = []
    for root in ("apps", "packages", "services", "vercel.json"):
        base = REPO / root
        paths = [base] if base.is_file() else sorted(base.rglob("*"))
        for path in paths:
            if not path.is_file() or any(
                part in {"node_modules", "dist", ".venv", "__pycache__", "test", "tests"}
                for part in path.parts
            ):
                continue
            if path.suffix in {".png", ".jpg", ".svg", ".wasm", ".woff2", ".lock"}:
                continue
            try:
                body = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for number, line in enumerate(body.splitlines(), 1):
                if re.search(r"up\.railway\.app|vercel\.app", line):
                    offenders.append(f"{path.relative_to(REPO)}:{number}: {line.strip()[:90]}")
    assert not offenders, "a hosting-provider hostname is in shipped code:\n" + "\n".join(offenders)
