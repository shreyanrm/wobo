"""The signed one-click stop token behind ``/v1/mail/stop?token=…``.

A family stops our mail from the mail itself, with no login: the link carries a token that
names the learner AND the mail it was sent in, signed by the gateway. A click stops exactly what
the clicker was sent and nobody else's mail:

* ``sunday_note`` — the parent's "Stop the notes" in the Sunday note. Flips the family's
  ``sunday_note`` dial; the learner's wins and wishes are untouched.
* ``learner`` — "None at all" in a win, and "Stop these" in the welcome, both of which go to the
  learner's OWN address. Flips ``wins``, and ``festivals`` only while the wishes come to that same
  address (:func:`kinds_to_stop`). It never touches the learning notes: under thirteen, or at an
  age we do not know, those go to the parent, and a child's click must not silence the parent
  (2026-09-16: it did, and nobody told the parent).
* ``learner_all`` — "Stop all of these" in a learning note written to the learner's own address:
  their notes, their wins, and their wishes when those come to them.
* ``parent`` — "Stop all of these" in a note written to a parent, and "None at all" in a wish to
  a parent. Flips the Sunday note, the wishes and every learning note: everything that address is
  sent about the child. The learner's own wins are the learner's.
* one audience per learning note (``quick_one`` … ``learning_note``) — "Stop this one".
* ``waiting_list`` — "Take this address off the list" in the launch mail. The id in the token is
  the waiting list row, not a learner, and the click deletes that row.

A link minted into a PARENT's mail says so (the ``p`` claim, always on for ``sunday_note`` and
``parent``). Its click is applied to every learner linked to that same address, because a parent
of two children receives one list, under one List-Id, and "stop" means stop (2026-09-16: the
notes about the second child kept coming).

The token proves nothing about the clicker — only that the link was minted by us for that row
and that audience — which is exactly the right amount of trust for an opt-out: the worst a
stranger with the link can do is stop mail the family can switch back on when signed in.

Format: ``base64url(payload).base64url(hmac)`` with the payload
``{"l": learner_id, "k": audience, "t": issued}``. The key is ``MAIL_TOKEN_SECRET``; absent
that, a key is DERIVED from ``SUPABASE_JWT_SECRET`` under a fixed label, so the JWT secret is
never used raw for a second purpose. With neither, no token is minted (``None``) — and a live
send with no stop link is held back (``email.send_email``), never sent without an off switch.

Tokens live long on purpose (``STOP_TOKEN_DAYS``, default 400): a family may click the footer of
a mail from last spring, and that click must still work.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

_LABEL = b"wobo.mail.stop.v1"
_DEFAULT_DAYS = 400
_MAX_LEARNER_ID = 128

#: Audiences that only ever go to a parent's address.
PARENT_ONLY: frozenset[str] = frozenset({"sunday_note", "parent"})
#: Audiences minted into the learner's own mail, whose wishes are theirs only when the wishes
#: come to their address.
_LEARNERS_OWN: frozenset[str] = frozenset({"learner", "learner_all"})

#: What each link stops: the audience the mail was sent to, and the dials that click flips.
#: The learning notes, each its own dial (docs/EMAILS-AND-ANIMATIONS.md §1, and the good-news
#: note of the weekly cadence). Named here rather than imported, because the templates import
#: this module; ``tests/test_mail_cadence.py`` holds the two lists together.
_LEARNING_NOTES: tuple[str, ...] = (
    "quick_one",
    "mid_chapter",
    "streak",
    "bonus_level",
    "doubt",
    "learning_note",
)

AUDIENCES: dict[str, tuple[str, ...]] = {
    "sunday_note": ("sunday_note",),
    # "None at all" in a win, "Stop these" in the welcome: the learner's own address. The wishes
    # are in only while they come to that address (:func:`kinds_to_stop`).
    "learner": ("wins", "festivals"),
    # "Stop all of these" in a learning note to the learner's own address.
    "learner_all": ("wins", "festivals", *_LEARNING_NOTES),
    # "Stop all of these" in a note to a parent. A parent has no account to sign in to, so the
    # per-kind link alone would make stopping everything a chore of six clicks, and the reader
    # who gives up on that presses Block instead (docs/MAIL-PRIMARY.md §2).
    "parent": ("sunday_note", "festivals", *_LEARNING_NOTES),
    # The launch mail's link (docs/MAIL-PRIMARY.md, the launch mail to the list). The reader has
    # no account and no learner row: the token's id is the waiting list row, and the click takes
    # that address off the list (``waiting_list.remove``). No mail setting is touched.
    "waiting_list": ("waiting_list",),
    # One audience per note, so a click on the streak mail stops the streak mail and nothing
    # else. A stop link that took more than the reader asked for would be the same lie as a
    # dead one.
    **{kind: (kind,) for kind in _LEARNING_NOTES},
}


@dataclass(frozen=True)
class StopClaim:
    """What a valid token says: whose row, and which dials the click may flip."""

    learner_id: str
    audience: str
    #: The link was minted into a mail to a parent's address.
    to_parent: bool = False

    @property
    def kinds(self) -> tuple[str, ...]:
        return AUDIENCES[self.audience]


def wishes_come_to_learner(learner_id: str) -> bool:
    """Do this learner's festival wishes go to their own address? Only when the account holds
    one (``jobs.wish_recipient``); otherwise they go to the linked parent."""
    from wobo_gateway.email import account_email

    return bool(account_email(learner_id))


def kinds_to_stop(claim: StopClaim) -> tuple[str, ...]:
    """The dials a click flips: the audience's, less the wishes when a learner's own link would
    otherwise switch off the wishes that go to their parent."""
    kinds = claim.kinds
    if claim.audience in _LEARNERS_OWN and not wishes_come_to_learner(claim.learner_id):
        kinds = tuple(kind for kind in kinds if kind != "festivals")
    return kinds


def derived_secret(label: bytes) -> bytes | None:
    """The mail key under a label of its own, or ``None`` when the gateway has none.

    One key material, one derivation, a different key per job: the stop token's key and the card
    link's key (:mod:`.links`) are both HMAC of the same secret under different labels, so a
    token minted for one job can never be read as the other's.
    """
    base = _secret()
    return hmac.new(base, label, hashlib.sha256).digest() if base else None


def _secret() -> bytes | None:
    explicit = (os.getenv("MAIL_TOKEN_SECRET") or "").strip()
    if explicit:
        return explicit.encode()
    jwt_secret = (os.getenv("SUPABASE_JWT_SECRET") or "").strip()
    if jwt_secret:
        # Domain separation: a different key for a different job, derived one way.
        return hmac.new(jwt_secret.encode(), _LABEL, hashlib.sha256).digest()
    return None


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes | None:
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (ValueError, TypeError):
        return None


def _sign(payload: bytes, secret: bytes) -> bytes:
    return hmac.new(secret, payload, hashlib.sha256).digest()


def stop_token(
    learner_id: str,
    audience: str,
    *,
    issued: datetime | None = None,
    to_parent: bool = False,
) -> str | None:
    """A token for this learner and this audience, or ``None`` when the gateway has no signing
    key (or the audience is not one we send to). ``to_parent`` marks a link minted into a mail
    to a parent's address; the Sunday note's and "Stop all of these" always are."""
    secret = _secret()
    if not secret or not learner_id or len(learner_id) > _MAX_LEARNER_ID:
        return None
    if audience not in AUDIENCES:
        return None
    when = (issued or datetime.now(UTC)).astimezone(UTC)
    claims: dict[str, Any] = {"l": learner_id, "k": audience, "t": int(when.timestamp())}
    if to_parent or audience in PARENT_ONLY:
        claims["p"] = 1
    payload = json.dumps(claims, separators=(",", ":")).encode()
    return f"{_b64(payload)}.{_b64(_sign(payload, secret))}"


def parse_stop_token(token: str | None, *, now: datetime | None = None) -> StopClaim | None:
    """The claim the token carries, or ``None`` for anything we did not sign, that names an
    audience we do not know, or that has aged out.

    Constant-time on the signature; every other failure is a shape problem, not a secret one.
    """
    secret = _secret()
    if not secret or not token or token.count(".") != 1 or len(token) > 1024:
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
    learner_id = claims.get("l")
    audience = claims.get("k")
    issued = claims.get("t")
    if not isinstance(learner_id, str) or not learner_id or not isinstance(issued, int):
        return None
    if len(learner_id) > _MAX_LEARNER_ID or audience not in AUDIENCES:
        return None
    days = int(os.getenv("STOP_TOKEN_DAYS", str(_DEFAULT_DAYS)))
    current = (now or datetime.now(UTC)).astimezone(UTC)
    age_days = (current.timestamp() - issued) / 86400
    if age_days < -1 or age_days > days:  # a day of clock skew forwards; the window backwards
        return None
    return StopClaim(
        learner_id=learner_id,
        audience=str(audience),
        to_parent=claims.get("p") == 1 or audience in PARENT_ONLY,
    )


def stop_url() -> str:
    """Where the link points. ``MAIL_STOP_URL`` outright, else the gateway origin plus the route.

    The email templates only sign their name to links on an allow-listed host; this host is on
    that list by construction, and it is also the templates' list-wide fallback when a send
    carries no per-recipient link.
    """
    explicit = (os.getenv("MAIL_STOP_URL") or "").strip()
    if explicit:
        return explicit.rstrip("?")
    gateway = (os.getenv("GATEWAY_URL") or "https://api.heywobo.com").rstrip("/")
    return f"{gateway}/v1/mail/stop"


def stop_link(learner_id: str, audience: str, *, to_parent: bool = False) -> str | None:
    """The full one-click link for a recipient, or ``None`` when no token can be minted."""
    token = stop_token(learner_id, audience, to_parent=to_parent)
    if token is None:
        return None
    return f"{stop_url()}?token={quote(token, safe='')}"


def is_one_click(url: str) -> bool:
    """Does this link answer an RFC 8058 one-click POST? Only a tokened link on our stop route
    does; a sign-in page or a bare route is a page, not an endpoint."""
    return bool(url) and url.startswith(stop_url()) and "token=" in url
