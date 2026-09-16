"""The console invitation link: signed, single-use, expiring, and for one address.

THE LAW (docs/CONSOLE-ROLES-AND-BOARD.md, "Accepting a seat proves the address twice"): *"the
invitation itself carries a signed, single-use, expiring link sent to the invited address, and a
seat binds only when the person arrives THROUGH that link with a token whose verified address
matches. A token alone, however verified, never binds a seat."*

Each word of that sentence is one mechanism here, and none of them stands in for another:

* **signed** — ``base64url(payload).base64url(hmac)``, the same shape as the parent invite and the
  stop link, under this module's own key. A link we did not sign is not read past its signature.
* **expiring** — the payload carries its deadline (``ADMIN_INVITE_HOURS``, 72 by default), and the
  row carries the same deadline, so either clock running out is enough.
* **for one address** — the payload carries a KEYED digest of the invited address, never the
  address, so a link forwarded to somebody else is dead for their account, and a link read over a
  shoulder says nothing about who it was for.
* **single-use** — the register row keeps only the SHA-256 of the token, and binding the seat is a
  write conditioned on that digest that also clears it (``admin_auth.PostgrestAdminStore.
  bind_subject``). The second arrival matches no row. A fresh link replaces the digest, so the old
  one dies the moment the owner sends another.

NOTHING HERE SENDS MAIL. :func:`invitation_mail` renders the message and the owner's screen hands
it, with the link, to a person who sends it. The key is ``ADMIN_INVITE_SECRET``; without one it is
derived from ``SUPABASE_JWT_SECRET`` under a label no other token uses; with neither, no link is
minted and nobody is added (``admin_auth.grant_admin`` refuses before it writes).

WHERE THE LINK POINTS. The console is its own build with no public host (vite.admin.config.ts), so
its address is configuration: ``CONSOLE_URL``, the full address the console opens at. In
production it must be https, and without it no link is minted. Off production a local console is
assumed so a developer can walk the whole flow.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlparse

_LABEL = b"wobo.console.invite.v1"
_ADDRESS_LABEL = b"wobo.console.invite.address.v1"
_DEFAULT_HOURS = 72
_MAX_HOURS = 24 * 14
_MAX_TOKEN = 512
_LOCAL_CONSOLE = "http://localhost:5173/admin.html"
#: The query parameter the console reads the token from. The console removes it from the address
#: bar the moment it has read it, so the token does not sit in history or in a screenshot.
PARAM = "invite"


def _is_prod() -> bool:
    return (os.getenv("ENV") or "").strip().lower() in {"prod", "production"}


def _secret(label: bytes = _LABEL) -> bytes | None:
    explicit = (os.getenv("ADMIN_INVITE_SECRET") or "").strip()
    if explicit:
        return hmac.new(explicit.encode(), label, hashlib.sha256).digest()
    jwt_secret = (os.getenv("SUPABASE_JWT_SECRET") or "").strip()
    if jwt_secret:
        return hmac.new(jwt_secret.encode(), label, hashlib.sha256).digest()
    return None


def signing_available() -> bool:
    return _secret() is not None


def invite_hours() -> int:
    try:
        hours = int(os.getenv("ADMIN_INVITE_HOURS") or _DEFAULT_HOURS)
    except ValueError:
        return _DEFAULT_HOURS
    return max(1, min(hours, _MAX_HOURS))


def console_url() -> str | None:
    """Where the console opens, or ``None`` when no link to it should be minted."""
    configured = (os.getenv("CONSOLE_URL") or "").strip()
    if not configured:
        return None if _is_prod() else _LOCAL_CONSOLE
    parsed = urlparse(configured)
    if not parsed.hostname or parsed.scheme not in {"https", "http"}:
        return None
    if _is_prod() and parsed.scheme != "https":
        return None
    return configured


def _normal(address: str | None) -> str:
    return (address or "").strip().lower()


def _address_digest(address: str) -> str | None:
    secret = _secret(_ADDRESS_LABEL)
    wanted = _normal(address)
    if secret is None or "@" not in wanted:
        return None
    return hmac.new(secret, wanted.encode(), hashlib.sha256).hexdigest()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes | None:
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (ValueError, TypeError):
        return None


def token_hash(token: str) -> str:
    """What the register row keeps of an outstanding link."""
    return hashlib.sha256(token.encode()).hexdigest()


def link_for(token: str) -> str | None:
    base = console_url()
    if base is None:
        return None
    joiner = "&" if urlparse(base).query else "?"
    return f"{base}{joiner}{PARAM}={quote(token, safe='')}"


@dataclass(frozen=True)
class Invitation:
    token: str
    token_hash: str
    expires_at: datetime
    link: str


def mint(address: str, *, now: datetime | None = None) -> Invitation | None:
    """A fresh link for this address, or ``None`` when one cannot honestly be made."""
    secret = _secret()
    digest = _address_digest(address)
    if secret is None or digest is None:
        return None
    issued = (now or datetime.now(UTC)).astimezone(UTC)
    expires = issued + timedelta(hours=invite_hours())
    payload = json.dumps(
        {"e": digest, "n": _b64(secrets.token_bytes(18)), "x": int(expires.timestamp())},
        separators=(",", ":"),
    ).encode()
    token = f"{_b64(payload)}.{_b64(hmac.new(secret, payload, hashlib.sha256).digest())}"
    link = link_for(token)
    if link is None:
        return None
    return Invitation(
        token=token,
        token_hash=token_hash(token),
        # The deadline as the token carries it, to the second, so the row and the link agree.
        expires_at=datetime.fromtimestamp(int(expires.timestamp()), tz=UTC),
        link=link,
    )


def verify(token: str | None, address: str | None, *, now: datetime | None = None) -> str | None:
    """The token's digest when it is ours, unexpired, and minted for this address; else ``None``.

    The caller still has to find that digest on the row (the single-use half), and still has to
    have got ``address`` from a token that says it was verified (``admin_auth._claim_email``).
    """
    secret = _secret()
    if not secret or not isinstance(token, str) or not token or len(token) > _MAX_TOKEN:
        return None
    if token.count(".") != 1:
        return None
    encoded_payload, encoded_signature = token.split(".", 1)
    payload, signature = _unb64(encoded_payload), _unb64(encoded_signature)
    if payload is None or signature is None:
        return None
    if not hmac.compare_digest(signature, hmac.new(secret, payload, hashlib.sha256).digest()):
        return None
    try:
        claims: Any = json.loads(payload.decode())
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(claims, dict):
        return None
    digest, expires = claims.get("e"), claims.get("x")
    if not isinstance(digest, str) or not isinstance(expires, int):
        return None
    current = (now or datetime.now(UTC)).timestamp()
    if current >= expires:
        return None
    wanted = _address_digest(address or "")
    if wanted is None or not hmac.compare_digest(digest, wanted):
        return None
    return token_hash(token)


# --- the message a person sends -------------------------------------------------------------------
_ROLE_WORDS = {
    "viewer": "a viewer",
    "operator": "an operator",
}

_FONT = "'Poppins', 'Helvetica Neue', Arial, sans-serif"
_PAGE = "#F4F4F7"
_CARD = "#FFFFFF"
_INK = "#121316"
_BODY = "#43444B"
_QUIET = "#5C5E66"
_ULTRA = "#1F35E0"


def _when(value: Any) -> str | None:
    if isinstance(value, datetime):
        moment = value.astimezone(UTC)
    elif isinstance(value, str) and value:
        try:
            moment = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
        except ValueError:
            return None
    else:
        return None
    return f"{moment.day} {moment:%B %Y}, {moment:%H:%M} UTC"


def invitation_mail(data: dict[str, Any]) -> dict[str, str]:
    """The invitation, as a subject, an HTML body and a plain-text body. Sends nothing.

    Staff mail, not family mail: no list headers, no footer about a learner's account, and nothing
    about money. It says what the link is, that it works once for this address, when it stops, and
    that the second factor comes first.
    """
    link = str(data.get("link") or "")
    role = _ROLE_WORDS.get(str(data.get("role") or ""), "a member of the team")
    deadline = _when(data.get("expires_at"))

    subject = "Your seat on the Wobo console"
    lines = [
        f"You have been given a seat on the Wobo console as {role}.",
        (
            "Open the link below to take it. It works once, only when you sign in with this "
            "address, and it stops working on " + deadline + "."
            if deadline
            else "Open the link below to take it. It works once, and only when you sign in "
            "with this address."
        ),
        (
            "The console opens only after you sign in with a second factor, so set one up on "
            "your account before you open the link."
        ),
        (
            "If you were not expecting this, you can ignore it. Nobody can take the seat "
            "without signing in to this address."
        ),
    ]
    text = "\n\n".join([lines[0], lines[1], link, lines[2], lines[3]]) + "\n"

    esc = html.escape
    paragraphs = "".join(
        f'<p style="margin:0 0 16px 0;font-family:{_FONT};font-size:15px;line-height:1.6;'
        f'color:{_BODY};">{esc(line)}</p>'
        for line in lines[:3]
    )
    button = (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td align="center" bgcolor="{_ULTRA}" style="border-radius:3px;">'
        f'<a href="{esc(link, quote=True)}" style="display:inline-block;padding:14px 32px;'
        f"font-family:{_FONT};font-size:15px;font-weight:700;color:#ffffff;"
        f'text-decoration:none;border-radius:3px;background-color:{_ULTRA};">Take the seat</a>'
        "</td></tr></table>"
    )
    body = (
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="color-scheme" content="light only">'
        f"<title>{esc(subject)}</title></head>"
        f'<body style="margin:0;padding:0;background-color:{_PAGE};">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="background-color:{_PAGE};"><tr><td align="center" style="padding:32px 12px;">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
        f'style="width:100%;max-width:600px;background-color:{_CARD};border-radius:3px;">'
        '<tr><td style="padding:36px 40px 0 40px;">'
        f'<span style="font-family:{_FONT};font-size:20px;font-weight:700;color:{_INK};">'
        "Wobo console</span></td></tr>"
        '<tr><td style="padding:24px 40px 0 40px;">'
        f'<h1 style="margin:0 0 18px 0;font-family:{_FONT};font-size:22px;line-height:1.3;'
        f'color:{_INK};">{esc(subject)}</h1>{paragraphs}</td></tr>'
        f'<tr><td style="padding:4px 40px 20px 40px;">{button}</td></tr>'
        '<tr><td style="padding:0 40px 32px 40px;">'
        f'<p style="margin:0 0 8px 0;font-family:{_FONT};font-size:13px;line-height:1.5;'
        f'color:{_QUIET};word-break:break-all;">{esc(link)}</p>'
        f'<p style="margin:0;font-family:{_FONT};font-size:13px;line-height:1.5;'
        f'color:{_QUIET};">{esc(lines[3])}</p>'
        "</td></tr></table></td></tr></table></body></html>"
    )
    return {"subject": subject, "html": body, "text": text}


__all__ = [
    "PARAM",
    "Invitation",
    "console_url",
    "invitation_mail",
    "invite_hours",
    "link_for",
    "mint",
    "signing_available",
    "token_hash",
    "verify",
]
