"""The signed link a mail's button carries: the exact card, and the way back in.

``docs/EMAILS-AND-ANIMATIONS.md`` §4. A nudge is only worth sending if the button lands on the
one thing the mail is about, so every nudge carries

    {APP_URL}/course/<course>/card/<card>?k=<token>

and the token is signed by the gateway. Two halves, and they expire differently on purpose:

* **The destination** is the path itself and it is reusable. A learner who opens the mail on the
  bus, closes it, and opens it again at home reaches the same card both times.
* **The sign-in** is the token's nonce and it is SINGLE USE (:func:`redeem_sign_in`). A link that
  signs you in is a bearer credential: a forwarded mail, a shared screenshot or a proxy that logs
  query strings must not be able to open somebody's account twice. Spent, the link still names
  the card; the reader is asked for the door instead.

The token proves the gateway minted this link for that learner and that card, and nothing else.
It is not a session and it is not authority over anything but "open this card, and offer the way
in once". The key is the mail key (:mod:`.tokens`) under its own label, so a stop token and a
card link can never be used for each other's job.

**The shape is a contract with the router** (``apps/web-pwa/src/shell/router.tsx``): the app gains
the ``/course/<topic>/card/<card>`` address, reads ``?k=`` and hands it to the gateway to redeem.
This module mints and reads; it mounts no route, because the redemption is the door's business
and not the mail's.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlparse

from wobo_gateway.hospitality.tokens import derived_secret

#: Its own label, so this key is not the stop link's key (domain separation, one derivation).
_LABEL = b"wobo.mail.card.v1"

#: The query parameter the app reads. Short, because it rides in a mail body a person may see.
QUERY_KEY = "k"

#: How long a card link lives. A mail from last month should still open the card it names; a
#: bearer credential should not live forever. Thirty days is the compromise, and it is config.
DEFAULT_DAYS = 30

_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$")
_MAX_LEARNER_ID = 128
#: A spent nonce is remembered for as long as a link can live, and no longer.
_NONCE_BYTES = 9


def _app_url() -> str:
    return (os.getenv("APP_URL") or "https://heywobo.com").rstrip("/")


def link_days() -> int:
    try:
        days = int(os.getenv("MAIL_CARD_LINK_DAYS") or DEFAULT_DAYS)
    except ValueError:
        return DEFAULT_DAYS
    return days if 1 <= days <= 400 else DEFAULT_DAYS


@dataclass(frozen=True)
class CardClaim:
    """What a valid card link says: whose it is, where it lands, and the one-time sign-in."""

    learner_id: str
    course_id: str
    card_id: str
    nonce: str
    issued: datetime

    @property
    def path(self) -> str:
        return card_path(self.course_id, self.card_id)


def card_path(course_id: str, card_id: str) -> str:
    """The address, with no token on it. The router's own shape."""
    return f"/course/{quote(course_id, safe='')}/card/{quote(card_id, safe='')}"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes | None:
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (ValueError, TypeError):
        return None


def _sign(payload: bytes, secret: bytes) -> bytes:
    return hmac.new(secret, payload, hashlib.sha256).digest()


def _ids_are_ours(learner_id: str, course_id: str, card_id: str) -> bool:
    """Ids we are willing to put in a signed link: short, and a path segment on their own.

    A slash, a dot pair or a percent in an id is not a naming style we use, and a link is the
    worst place to find out otherwise: the path is built by concatenation on the other side.
    """
    if not learner_id or len(learner_id) > _MAX_LEARNER_ID:
        return False
    return bool(_ID.match(course_id or "") and _ID.match(card_id or ""))


def card_token(
    learner_id: str, course_id: str, card_id: str, *, issued: datetime | None = None
) -> str | None:
    """The signed half, or ``None`` when the gateway has no signing key or the ids are not ours."""
    secret = derived_secret(_LABEL)
    if secret is None or not _ids_are_ours(learner_id, course_id, card_id):
        return None
    when = (issued or datetime.now(UTC)).astimezone(UTC)
    payload = json.dumps(
        {
            "l": learner_id,
            "c": course_id,
            "d": card_id,
            "t": int(when.timestamp()),
            "n": _b64(secrets.token_bytes(_NONCE_BYTES)),
        },
        separators=(",", ":"),
    ).encode()
    return f"{_b64(payload)}.{_b64(_sign(payload, secret))}"


def card_link(
    learner_id: str, course_id: str, card_id: str, *, issued: datetime | None = None
) -> str | None:
    """The whole link for a mail's button, or ``None`` when one cannot be minted.

    A caller that gets ``None`` sends the reader to the course, or does not send at all; it never
    puts an unsigned link in a mail, because the whole promise of the button is that it works.
    """
    token = card_token(learner_id, course_id, card_id, issued=issued)
    if token is None:
        return None
    return f"{_app_url()}{card_path(course_id, card_id)}?{QUERY_KEY}={quote(token, safe='')}"


def token_of(url: str) -> str | None:
    """The token on a link we made, for the route that redeems it (and for the suite)."""
    from urllib.parse import parse_qs, unquote

    query = parse_qs(urlparse(url or "").query)
    values = query.get(QUERY_KEY) or []
    return unquote(values[0]) if values else None


def parse_card_link(token: str | None, *, now: datetime | None = None) -> CardClaim | None:
    """The claim the token carries, or ``None`` for anything we did not sign or that has aged out.

    Constant-time on the signature. Every other refusal is a shape problem, not a secret one.
    """
    secret = derived_secret(_LABEL)
    if secret is None or not token or token.count(".") != 1 or len(token) > 1024:
        return None
    encoded_payload, encoded_sig = token.split(".", 1)
    payload = _unb64(encoded_payload)
    signature = _unb64(encoded_sig)
    if payload is None or signature is None:
        return None
    if not hmac.compare_digest(signature, _sign(payload, secret)):
        return None
    try:
        claims: Any = json.loads(payload.decode())
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(claims, dict):
        return None
    learner_id, course_id, card_id = claims.get("l"), claims.get("c"), claims.get("d")
    issued, nonce = claims.get("t"), claims.get("n")
    if not isinstance(issued, int) or not isinstance(nonce, str) or not nonce:
        return None
    if not all(isinstance(v, str) for v in (learner_id, course_id, card_id)):
        return None
    if not _ids_are_ours(str(learner_id), str(course_id), str(card_id)):
        return None
    current = (now or datetime.now(UTC)).astimezone(UTC)
    age_days = (current.timestamp() - issued) / 86400
    if age_days < -1 or age_days > link_days():  # a day of skew forwards; the window backwards
        return None
    return CardClaim(
        learner_id=str(learner_id),
        course_id=str(course_id),
        card_id=str(card_id),
        nonce=nonce,
        issued=datetime.fromtimestamp(issued, UTC),
    )


# --- the single-use half ------------------------------------------------------------------
_spent: dict[str, datetime] = {}
_spent_lock = threading.Lock()


def redeem_sign_in(claim: CardClaim, *, now: datetime | None = None) -> bool:
    """Spend the sign-in half of this link. ``True`` the first time, ``False`` ever after.

    In memory today, which is honest for one instance and is the same shape the mail log had
    before it moved into the database: a second replica, or a restart mid-flight, means a link
    could be spent twice, and the cost of that is one extra sign-in for the person holding the
    mail. A durable table replaces this function's body and nothing else.
    """
    current = (now or datetime.now(UTC)).astimezone(UTC)
    floor = current - timedelta(days=link_days())
    with _spent_lock:
        for nonce in [n for n, w in _spent.items() if w < floor]:
            _spent.pop(nonce, None)
        if claim.nonce in _spent:
            return False
        _spent[claim.nonce] = current
        return True


def reset_redemptions() -> None:
    """Test seam."""
    with _spent_lock:
        _spent.clear()
