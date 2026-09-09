"""Consent tier and plan, derived server-side from the learner's own record.

A consent tier is a capability door (DPDP, and the plan's "consent and age are capability
doors"). A door the caller can open by putting a word in a JSON body is not a door, so the
tier is NEVER read from a request. It is looked up here, keyed by the verified subject, and
handed to the gateway as its own argument.

Source of truth is Supabase, read over PostgREST with the service-role key (server-side
only, never in a client bundle). The row is ``learner.profiles_cache`` keyed by ``subject_id``
(migration 0002, with ``plan`` added by 0006) — the live project has no ``public.profiles``
table, and a lookup pointed at one that does not exist is a silent downgrade of every learner
to the default. The ``learner`` schema is reached with PostgREST's ``Accept-Profile`` header;
migration 0005 exposes it (``pgrst.db_schemas``). Unknown subject, unreachable database, no
configuration at all: the answer is the least-privilege default — un-elevated, free plan.
Anonymous learners skip the lookup entirely; they have no stored record and no elevated
capabilities.

``profiles_cache`` carries no address column (canonical identity lives in ``pii_vault`` on the
platform plane), so :func:`account_email` returns ``None`` until a governed address view
exists — and every caller that passes a subject fails CLOSED on that, which is the right way
round for mail.

ponytail: a five-minute in-process cache with a hard entry ceiling. One instance today; the
upgrade path is the same Redis that takes the budget meter.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from wobo_gateway.registry import ConsentTier

logger = logging.getLogger("wobo.gateway.consent")

_CACHE_TTL_S = 300.0
_CACHE_MAX = 4096
_HTTP_TIMEOUT_S = 5.0

# The database constrains consent_tier to ('un_elevated','elevated') and plan to
# ('free','plus','pro','max') since migration 0014, so those are the values that actually
# arrive. The wider sets are read tolerance, not policy: anything else — "un_elevated",
# "basic", empty, missing, a typo, a value we have never seen — falls to the least-privilege
# side.
_ELEVATED_VALUES = frozenset({"elevated", "full", "parental", "verified"})
_PLUS_VALUES = frozenset({"plus", "pro", "paid", "premium"})
# The larger paid tier. budget.py prices free, pro and max; without this a stored "max" read
# back as the smaller allowance, which is a learner paying for one thing and metered at another.
_MAX_VALUES = frozenset({"max"})

# The row may name these columns differently across the consent table and the profiles cache;
# read whichever is present rather than forcing one schema on the database.
_TIER_COLUMNS = ("consent_tier", "tier", "consent")
_PLAN_COLUMNS = ("plan", "subscription", "tier_plan")
_EMAIL_COLUMNS = ("email", "email_address", "contact_email")
#: WHEN THE PRODUCT FIRST HELD A RECORD FOR THIS SUBJECT, and the one column on this row a
#: learner cannot write. `profiles_cache_own` is `for all`, and migration 0014 re-granted INSERT
#: on exactly the columns the profile sync sends; `created_at` is not among them, so it is always
#: the database's own `now()`. The door reads it to tell an account the product already had from
#: a row a stranger wrote for themselves a moment ago (:func:`wobo_gateway.doors.refusal_for`).
_CREATED_COLUMNS = ("created_at", "inserted_at")

# The live schema (infra/supabase/migrations/0002 + 0006). Overridable, because a deploy that
# moves the profile behind a governed view should not need a code change.
_DEFAULT_SCHEMA = "learner"
_DEFAULT_TABLE = "profiles_cache"
_DEFAULT_ID_COLUMN = "subject_id"

_cache: dict[str, tuple[float, Profile]] = {}
#: Does a record for this subject EXIST? Kept apart from ``_cache`` because the profile cache
#: cannot answer it: a subject with no row and a subject we could not look up both fall to
#: ``DEFAULT_PROFILE`` there, and the door (:mod:`wobo_gateway.doors`) has to tell those two
#: apart. Only a definite answer is ever cached; "could not tell" is asked again.
_exists_cache: dict[str, tuple[float, tuple[bool, datetime | None]]] = {}


@dataclass(frozen=True)
class Profile:
    """What the brain is allowed to know about a subject before it decides anything."""

    tier: ConsentTier
    # The plan STORED on the profile. It is the fallback the meter uses when a learner has no
    # subscription row; the record itself is learner.subscriptions (billing.py), which is what
    # ends by itself when the paid period does.
    plan: str  # "free" | "plus" | "max"
    # The address on file. Read here so the email seam can refuse to write to any other one.
    email: str | None = None


DEFAULT_PROFILE = Profile(tier=ConsentTier.UN_ELEVATED, plan="free")


def _coerce_tier(value: Any) -> ConsentTier:
    if isinstance(value, str) and value.strip().lower() in _ELEVATED_VALUES:
        return ConsentTier.ELEVATED
    return ConsentTier.UN_ELEVATED


def _coerce_plan(value: Any) -> str:
    name = value.strip().lower() if isinstance(value, str) else ""
    if name in _MAX_VALUES:
        return "max"
    if name in _PLUS_VALUES:
        return "plus"
    return "free"


def _first(row: dict[str, Any], columns: tuple[str, ...]) -> Any:
    for column in columns:
        if row.get(column) is not None:
            return row[column]
    return None


def _rest_url(subject: str) -> str | None:
    base = os.getenv("SUPABASE_URL")
    if not base:
        return None
    table = os.getenv("SUPABASE_CONSENT_TABLE", _DEFAULT_TABLE)
    column = os.getenv("SUPABASE_CONSENT_ID_COLUMN", _DEFAULT_ID_COLUMN)
    query = urllib.parse.urlencode(
        {"select": "*", column: f"eq.{subject}", "limit": "1"}, quote_via=urllib.parse.quote
    )
    return f"{base.rstrip('/')}/rest/v1/{urllib.parse.quote(table)}?{query}"


def _fetch_rows(subject: str) -> list[dict[str, Any]] | None:
    """One PostgREST read, with the two failures kept apart.

    ``[]`` means the question was asked and this subject has no record. ``None`` means it could
    not be asked at all — no project, no key, a timeout, a shape we do not recognise. Collapsing
    those two into one answer is what made :func:`account_exists` impossible to write, and it is
    the difference between "you are new" and "we cannot tell", which the door turns on.
    """
    url = _rest_url(subject)
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    # PostgREST selects the schema by header, not by a dotted table name. Without this every
    # read lands in `public`, where the profile does not live.
    headers["Accept-Profile"] = os.getenv("SUPABASE_CONSENT_SCHEMA", _DEFAULT_SCHEMA)
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
            rows = json.loads(response.read().decode())
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        logger.warning("consent lookup failed", extra={"fields": {"error": str(exc)}})
        return None
    if not isinstance(rows, list):
        return None
    return [row for row in rows if isinstance(row, dict)]


def fetch_profile(subject: str) -> Profile | None:
    """One PostgREST read. Split out so tests can substitute it without a database."""
    rows = _fetch_rows(subject)
    if not rows:
        return None
    row = rows[0]
    email = _first(row, _EMAIL_COLUMNS)
    return Profile(
        tier=_coerce_tier(_first(row, _TIER_COLUMNS)),
        plan=_coerce_plan(_first(row, _PLAN_COLUMNS)),
        email=str(email) if email else None,
    )


def get_profile(subject: str, *, anonymous: bool = False) -> Profile:
    """The learner's tier and plan. Never raises — a failed lookup is least privilege."""
    if anonymous or not subject:
        return DEFAULT_PROFILE
    cached = _cache.get(subject)
    if cached is not None and (time.monotonic() - cached[0]) < _CACHE_TTL_S:
        return cached[1]
    profile = fetch_profile(subject) or DEFAULT_PROFILE
    if len(_cache) >= _CACHE_MAX:
        _cache.clear()  # ponytail: cheap prune; worst case one extra lookup per subject
    _cache[subject] = (time.monotonic(), profile)
    return profile


def get_tier(subject: str, *, anonymous: bool = False) -> ConsentTier:
    """The tier the brain enforces for this subject, whatever the request body claimed."""
    return get_profile(subject, anonymous=anonymous).tier


def get_plan(subject: str, *, anonymous: bool = False) -> str:
    return get_profile(subject, anonymous=anonymous).plan


def _as_moment(value: Any) -> datetime | None:
    """A timestamp as PostgREST hands it back, or ``None`` for anything we cannot read as one."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _record(subject: str) -> tuple[bool, datetime | None] | None:
    """One lookup, answering both questions the door asks: is there a record, and since when.

    ``None`` means the question could not be asked at all. Kept as one cached read because the
    two answers come off the same row and asking twice would double every door's database work.
    """
    if not subject:
        return None
    cached = _exists_cache.get(subject)
    if cached is not None and (time.monotonic() - cached[0]) < _CACHE_TTL_S:
        return cached[1]
    rows = _fetch_rows(subject)
    if rows is None:
        return None
    found: tuple[bool, datetime | None] = (
        len(rows) > 0,
        _as_moment(_first(rows[0], _CREATED_COLUMNS)) if rows else None,
    )
    if len(_exists_cache) >= _CACHE_MAX:
        _exists_cache.clear()  # ponytail: cheap prune; worst case one extra lookup per subject
    _exists_cache[subject] = (time.monotonic(), found)
    return found


def account_exists(subject: str) -> bool | None:
    """Does the product hold a record for this subject? ``None`` when we could not find out.

    The door (:mod:`wobo_gateway.doors`) is the caller, and the three answers mean three
    different things to it: ``True`` is an existing account and works exactly as before;
    ``False`` is a sign-up that happened at the auth server while the door was shut and is
    refused; ``None`` is a database we could not reach, and nobody is locked out by that.

    Anonymous subjects never come here — they are refused on their own account, before this.

    THIS ANSWER IS NOT PROOF ON ITS OWN. The row it reads is one a learner may write with their
    own token (``profiles_cache_own`` is ``for all``), so "there is a record" is a thing a
    stranger can arrange. :func:`account_created_at` is the half they cannot forge.
    """
    record = _record(subject)
    return None if record is None else record[0]


def account_created_at(subject: str) -> datetime | None:
    """When the product's record for this subject was written, as the DATABASE wrote it.

    ``None`` when there is no record, when the lookup could not be made, or when the row does not
    carry the column. The door treats all three the same way and leaves its extra rule off, which
    fails towards the learner exactly as the lookup itself does.
    """
    record = _record(subject)
    return None if record is None else record[1]


def account_email(subject: str) -> str | None:
    """The address on file for a verified subject, or None. The email seam calls this to refuse
    a send to any address the learner does not own."""
    return get_profile(subject).email


def reset_cache() -> None:
    """Test seam, and the hook a future "my consent changed" webhook calls."""
    _cache.clear()
    _exists_cache.clear()
