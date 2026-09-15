"""The money meter — a quarter of the plan, a day at a time, in the learner's own midnight.

WHAT THIS IS, AND WHY IT STANDS BESIDE ``budget.py`` RATHER THAN INSIDE IT. ``budget`` counts
ACTS: forty turns, eight generations, three hundred and twenty spoken lines. Those numbers were
never the real limit — a turn on Terra costs about 0.0078 USD and a turn on Luna about 0.0007,
so forty turns is somewhere between half a rupee and twenty-six rupees depending on which model
answered, and the counter cannot tell the difference. This module counts MONEY: the ledger's
actual cost of every metered call the learner made today, against an allowance derived from what
they pay (docs/ALLOWANCE.md §1).

    daily allowance (paise) = plan amount x generosity / the days in the learner's month

The owner's numbers: generosity is 0.25 by default (a ₹1,999 plan gives ₹499.75 of model spend a
month), and the free plan is its own dial, ₹5 a day, which is about three hundred short turns on
Luna. Both are live dials in ``ops.settings`` (migration 0028) with an audit row.

THE DIALS ARE READ IN ONE PLACE, AND IT IS NOT HERE. ``dials.py`` owns every live setting in this
gateway — one cache, one "applied at", one set of defaults — and this module asks it. That is not
tidiness: the console writes a generosity and calls ``dials.apply()``, and a meter holding its own
copy of the same rows would go on charging the old number for up to a minute after the desk had
already told the owner the new one was in force. One reader means the desk and the meter cannot
disagree, and the arithmetic below is the desk's own (``dials.daily_allowance_paise``) so the
figure a learner is metered on is the figure the owner was shown when he turned the dial.

THE LEARNER MEETS THIS FIRST. ``budget.charge`` asks this module before it touches a counter, so
the counters become what they should always have been — abuse caps far above an honest day (a
hundred turns a day is a bot, not a child). When the day is spent the learner gets the SAME line
the counters give, ``budget.BudgetExhausted``, because there is only one honest refusal and a
child must never be told a price.

NO MONEY REACHES THE LEARNER. ``/v1/me`` carries ``{allowance: {used: 0..1, resets_at}}`` and
nothing else: a fraction and a time. The rupees exist here, in the ledger, and on the owner's
desk. Not on the You page, and not on the parent's page either (the owner, 2026-09-08: "it's not
money based at the users' end; that is only for internal purposes").

THE DAY IS THE LEARNER'S DAY. Midnight to midnight in the learner's zone: the family record's
zone when there is one (:func:`set_zone_resolver`, which the family path hands in), else the
device's zone sent on the first request of the day (``X-Wobo-Timezone``), else UTC. The BOUNDARY
is always computed here from that zone and the server's clock — a client says where it is, never
what day it is, or a learner with a clock and a will has an infinite allowance.

WHAT IS NEVER COUNTED HERE:

* anything ``registry.platform_paid`` claims (``create.core``, ``create.blueprint``): the
  creative pool pays for the work made once and shared with everyone, and it is never subtracted
  from a child's day (docs/ALLOWANCE.md, "Creative work is never on the allowance");
* a cache hit, because it has no cost to record — the second learner to open a cell pays nothing
  for what the first one's ask rendered;
* the platform's own jobs (``system:`` meter keys), which are bounded by ``spend.py``'s ceiling
  and belong to no learner.

ponytail: the day's spend is an in-process dict, exactly like ``budget``'s counters and
``spend``'s float, so with two replicas a learner could be granted up to two days. The durable
figure is already in ``ops.model_calls`` (``ledger.py``) and the upgrade path is to read today's
sum from it behind :func:`state`; no caller changes.
"""

from __future__ import annotations

import calendar as _calendar
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from wobo_gateway import budget, dials, registry

logger = logging.getLogger("wobo.gateway.allowance")

# --- the dials this meter runs on (ops.settings, migration 0028) ----------------------------------
#
# The names and the defaults live in ``dials.py``, which reads the table. They are re-exported here
# because a reader who arrives at the meter should be able to see WHICH dials move it without
# opening another file — but there is exactly one definition of each, over there.
#
#: The fraction of the plan amount given as model spend, per plan (default 0.25).
DIAL_GENEROSITY = dials.GENEROSITY_KEY
#: The free plan's day, in paise. Not a fraction of anything — free pays nothing to take a quarter
#: of (docs/ALLOWANCE.md, "The free tier: five rupees a day").
DIAL_FREE_DAILY_PAISE = dials.FREE_PAISE_KEY
#: What one dollar of the ledger's USD is worth in rupees, with the date it was set (the audit row).
DIAL_INR_PER_USD = dials.INR_RATE_KEY

DIALS: tuple[str, ...] = (DIAL_GENEROSITY, DIAL_FREE_DAILY_PAISE, DIAL_INR_PER_USD)

#: ₹5 a day, and 83 to the dollar (docs/OPERATIONS.md §11.3). Aliases, not second copies.
DEFAULT_FREE_DAILY_PAISE = dials.DEFAULT_FREE_PAISE
DEFAULT_INR_PER_USD = dials.DEFAULT_INR_PER_USD

#: How long a dial is served from cache before it is read again. The law is "within a minute".
MAX_REFRESH_S = dials.MAX_REFRESH_S

#: The header a device sends its zone in. A NAME (``Asia/Kolkata``), never an offset and never a
#: date: the offset moves with daylight saving and the date is the thing we refuse to be told.
ZONE_HEADER = "x-wobo-timezone"

#: Meter keys that belong to a learner (``app.meter_key``). Everything else — a ``system:`` key
#: from the curriculum's own jobs — is the platform's spend and is bounded by ``spend.py``.
LEARNER_PREFIXES: tuple[str, ...] = ("sub:", "anon:", "ip:")

#: Plan names that resolve to Pro's amount. ``plus`` is what the first paid tier shipped under.
_PRO_NAMES = frozenset({"pro", "plus"})
_MAX_NAMES = frozenset({"max"})
PERIODS: tuple[str, ...] = ("monthly", "yearly")

_STORE_MAX = 20_000


# --- what this module holds ----------------------------------------------------------------------
#: The day's spend per learner, in USD, keyed by (meter key, the learner's own local day). USD
#: rather than paise because a Luna turn is 0.0007 USD — six hundredths of a paisa — and rounding
#: each call to a paisa would round a whole free day down to nothing. The rate is applied once,
#: at read time, so a rate changed at noon prices the whole of that day consistently.
_spent_usd: dict[tuple[str, str], float] = {}
#: The zone a device told us, with the UTC instant that zone's own day ends: the FIRST one of the
#: day stands, and it stands until midnight IN IT — not until midnight in whatever zone the next
#: request happens to claim. Holding the boundary as an instant is what makes the rule independent
#: of the hour the server is asked at, and makes the steady-state check one comparison.
_zones: dict[str, tuple[str, datetime]] = {}
_lock = threading.Lock()

_zone_resolver: Callable[[str], str | None] | None = None
_period_resolver: Callable[[str], str | None] | None = None

#: The family's zone, remembered per subject so the row behind it is read at most this often. A
#: family does not move countries between two questions, and a database round trip on every
#: metered call to answer "which midnight" would be a round trip on every turn.
FAMILY_ZONE_TTL_S = 900.0
_family_zones: dict[str, tuple[float, str | None]] = {}


def set_clock(clock: Callable[[], float] | None) -> None:
    """Test seam for the dial cache's interval. The cache is ``dials``', so the clock is too."""
    dials.set_clock(clock)


def set_zone_resolver(resolver: Callable[[str], str | None] | None) -> None:
    """Where the FAMILY's zone comes from, when there is a family record.

    Handed in rather than reached for: this module must not import the hospitality store to
    answer a question asked on every metered call, and the family path already knows the zone
    (``hospitality.jobs.family_local``). A resolver that raises or answers nonsense is ignored.
    """
    global _zone_resolver
    _zone_resolver = resolver


def set_period_resolver(resolver: Callable[[str], str | None] | None) -> None:
    """Which period a subject's live subscription was bought for. ``None`` restores the default
    (``billing.period_for``), which answers from the same cached subscription row the plan does."""
    global _period_resolver
    _period_resolver = resolver


def apply() -> None:
    """Read the dials again now. What ``POST /v1/admin/settings/apply`` reaches through."""
    dials.apply(force=True)


def reset() -> None:
    """Test seam — an empty day, no remembered zones, no cached dials, no resolvers."""
    global _zone_resolver, _period_resolver
    with _lock:
        _spent_usd.clear()
        _zones.clear()
        _family_zones.clear()
    _zone_resolver = None
    _period_resolver = None
    dials.reset()


def refresh_interval_s() -> float:
    """How long a dial is served from cache. Capped at a minute, which is the law."""
    return dials.refresh_interval_s()


# --- the arithmetic ------------------------------------------------------------------------------
def _plan_key(plan: str | None) -> str:
    name = (plan or "free").strip().lower()
    if name in _PRO_NAMES:
        return "pro"
    if name in _MAX_NAMES:
        return "max"
    return "free"


def _period_key(period: str | None) -> str:
    name = (period or "monthly").strip().lower()
    return name if name in PERIODS else "monthly"


def plan_monthly_paise(plan: str, period: str = "monthly") -> int | None:
    """What the learner pays A MONTH, in paise; a yearly plan's monthly equivalent.

    ``dials`` reads it from ``billing.plans.CATALOGUE``, which is docs/PRICING.md's mirror and the
    gateway's only copy of those four numbers: an allowance computed from a price this file kept
    its own copy of would be a second price, and the day one of them moved would be the day a
    learner was given an allowance nobody sold them. ``None`` for free, which has no amount.
    """
    if _plan_key(plan) == "free":
        return None
    return dials.plan_amount_paise(_plan_key(plan), _period_key(period))


def daily_paise(plan: str, *, period: str | None = "monthly", days_in_month: int = 30) -> int:
    """The day's allowance in paise: plan amount x generosity / the days in THIS month.

    The desk's own function (docs/ALLOWANCE.md §1's arithmetic, ``dials``), called through here so
    that the meter has ONE named place a reader can start from — and so that the number a learner
    is charged against is by construction the number the console showed the owner. A plan name
    nobody recognises gets the FREE day, never a paid one.
    """
    return dials.daily_allowance_paise(
        _plan_key(plan), period=_period_key(period), days_in_month=days_in_month
    )


# --- the learner's day ---------------------------------------------------------------------------
def _zone(name: str | None) -> ZoneInfo | None:
    if not name or not isinstance(name, str):
        return None
    try:
        return ZoneInfo(name.strip())
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return None


def note_zone(meter_key: str, name: str | None) -> None:
    """Remember where this device says it is. THE FIRST ONE OF THE DAY STANDS.

    A learner whose device changes zone mid-day (a flight, or a client sending whatever it likes)
    must not get a second midnight out of it: the zone is fixed for the day it was first sent on,
    and a new one is taken at the next local midnight. Nonsense is dropped, not believed.

    THE DAY BELONGS TO THE ZONE THAT WAS HELD. Asking whether the held day is over in the zone
    being offered is not the same question and does not have the same answer: Kolkata and New York
    agree on today's date only between 04:00 and 18:30 UTC, so a rule written that way retires the
    held zone every night and keeps it every afternoon. Two zones more than 24 hours apart —
    Kiritimati and Midway — never agree at all, and it retires the held zone always. The boundary
    is therefore taken once, as an instant, in the zone that won.
    """
    if not meter_key or not _is_learner(meter_key):
        return
    zone = _zone(name)
    if zone is None:
        return
    now = datetime.now(UTC)
    with _lock:
        held = _zones.get(meter_key)
        if held is not None and now < held[1]:
            return
        if len(_zones) >= _STORE_MAX:
            _zones.clear()
        _zones[meter_key] = (name.strip(), _next_local_midnight(zone, now).astimezone(UTC))


def _family_zone(meter_key: str) -> str | None:
    """The zone on the family's own record (``hospitality.preferences``), or None.

    This is the zone docs/ALLOWANCE.md §4.6 puts first, and it is the only one a person actually
    told us — the device's is inferred from whatever the browser was set to. Cached for
    :data:`FAMILY_ZONE_TTL_S`; a store that cannot answer is a None and never an exception, so a
    learner whose family row is unreachable falls to their device's zone rather than to an error.
    """
    if not meter_key.startswith("sub:"):
        return None
    subject = meter_key[len("sub:") :]
    now = time.monotonic()
    with _lock:
        held = _family_zones.get(meter_key)
        if held is not None and now - held[0] < FAMILY_ZONE_TTL_S:
            return held[1]
    found: str | None = None
    try:
        from wobo_gateway.hospitality import preferences

        prefs = preferences.preferences_for(subject)
        found = prefs.timezone if prefs is not None else None
    except Exception as exc:  # noqa: BLE001 — a family row we cannot read is a row we do not have
        logger.debug("allowance: family zone unreadable (%s)", type(exc).__name__)
        found = None
    with _lock:
        if len(_family_zones) >= _STORE_MAX:
            _family_zones.clear()
        _family_zones[meter_key] = (now, found)
    return found


def zone_name(meter_key: str) -> str:
    """The zone this learner's day is measured in: the family's, else the device's, else UTC."""
    resolver = _zone_resolver or _family_zone
    try:
        found = resolver(meter_key)
    except Exception:  # noqa: BLE001 — a resolver bug must never take a turn down with it
        logger.exception("allowance: the zone resolver failed")
        found = None
    if _zone(found) is not None:
        return str(found).strip()
    with _lock:
        held = _zones.get(meter_key)
    if held is not None and _zone(held[0]) is not None:
        return held[0]
    return "UTC"


def _tz(meter_key: str) -> ZoneInfo:
    return _zone(zone_name(meter_key)) or ZoneInfo("UTC")


def local_day(meter_key: str, now: datetime | None = None) -> date:
    """The learner's own calendar day, computed HERE from their zone and the server's clock."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    return moment.astimezone(_tz(meter_key)).date()


def _next_local_midnight(zone: ZoneInfo, moment: datetime) -> datetime:
    """The first instant of the next day in ``zone``. The one place a day boundary is computed."""
    local = moment.astimezone(zone)
    return datetime.combine(local.date() + timedelta(days=1), datetime.min.time(), tzinfo=zone)


def resets_at(meter_key: str, now: datetime | None = None) -> datetime:
    """The next local midnight — when the day starts again. No carry-forward, ever."""
    return _next_local_midnight(_tz(meter_key), (now or datetime.now(UTC)).astimezone(UTC))


def _is_learner(meter_key: str) -> bool:
    return bool(meter_key) and meter_key.startswith(LEARNER_PREFIXES)


# --- the meter -----------------------------------------------------------------------------------
@dataclass(frozen=True)
class Meter:
    """One learner's day. ``used`` is the only field that may ever leave the gateway."""

    #: 0..1, what today's allowance has been spent on. Clamped: a learner cannot be 140% spent.
    used: float
    #: The next local midnight.
    resets_at: datetime
    #: The learner's own calendar day, for the desk and the tests.
    day: date
    #: INTERNAL. The day's allowance in paise. Never leaves the gateway (docs/ALLOWANCE.md §2).
    allowance_paise: int
    #: INTERNAL. What has been spent of it, in paise, at today's rate. Never leaves the gateway.
    used_paise: float
    #: The zone the two above were computed in.
    zone: str

    @property
    def spent(self) -> bool:
        return self.allowance_paise <= 0 or self.used_paise >= self.allowance_paise

    def as_dict(self) -> dict[str, Any]:
        """What ``/v1/me`` carries: a fraction and a time. NOTHING IN CURRENCY."""
        return {"used": self.used, "resets_at": self.resets_at.isoformat()}


def _period_for(meter_key: str, plan: str) -> str:
    """Monthly unless the learner's live subscription says otherwise.

    Monthly is the safe default, not the common one: it is the LARGER amount, so a learner whose
    period we cannot read is given the bigger day rather than being quietly cut to five sixths of
    what they bought.
    """
    if _plan_key(plan) == "free" or not meter_key.startswith("sub:"):
        return "monthly"
    subject = meter_key[len("sub:") :]
    resolver = _period_resolver
    if resolver is None:
        from wobo_gateway import billing

        resolver = billing.period_for
    try:
        return _period_key(resolver(subject))
    except Exception:  # noqa: BLE001 — a store blink must never change what a learner paid for
        logger.debug("allowance: could not read the period; monthly assumed")
        return "monthly"


def state(
    meter_key: str,
    plan: str = "free",
    *,
    period: str | None = None,
    now: datetime | None = None,
) -> Meter:
    """Today's meter for one learner. Never raises; never touches the network on the hot path."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    zone = zone_name(meter_key)
    day = local_day(meter_key, moment)
    days = _calendar.monthrange(day.year, day.month)[1]
    allowed = daily_paise(plan, period=period or _period_for(meter_key, plan), days_in_month=days)
    with _lock:
        usd = _spent_usd.get((meter_key, day.isoformat()), 0.0)
    paise = float(usd) * dials.inr_per_usd() * 100.0
    used = 0.0 if allowed <= 0 else min(1.0, paise / allowed)
    return Meter(
        used=round(used, 4),
        resets_at=resets_at(meter_key, moment),
        day=day,
        allowance_paise=allowed,
        used_paise=paise,
        zone=zone,
    )


def debit(
    meter_key: str | None,
    *,
    cost_usd: float | None,
    capability: str,
    occurred_at: datetime | None = None,
) -> None:
    """Take what a call actually cost off the learner's day, as the ledger row lands.

    Called from :func:`ledger.record`, which is the one funnel every priced model call in this
    service passes through — so a route added tomorrow is metered the day it ships, rather than
    the day somebody remembers to meter it. Never raises: an accounting line is worth less than
    a child's answer.
    """
    try:
        if not meter_key or not _is_learner(meter_key):
            return  # the platform's own jobs are bounded by spend.py, not by anyone's day
        if cost_usd is None or cost_usd <= 0:
            return  # a cache hit, or a call nobody was billed for
        if registry.platform_paid(registry.canonical_capability(capability)):
            return  # the creative pool pays for what is made once and shared with everyone
        day = local_day(meter_key, occurred_at).isoformat()
        with _lock:
            if len(_spent_usd) >= _STORE_MAX:
                for stale in [k for k in _spent_usd if k[1] != day]:
                    del _spent_usd[stale]
                if len(_spent_usd) >= _STORE_MAX:
                    _spent_usd.clear()
            _spent_usd[(meter_key, day)] = _spent_usd.get((meter_key, day), 0.0) + float(cost_usd)
    except Exception as exc:  # noqa: BLE001
        logger.debug("allowance: not debited (%s: %s)", type(exc).__name__, exc)


def check(
    meter_key: str,
    capability: str,
    plan: str = "free",
    *,
    now: datetime | None = None,
) -> Meter | None:
    """The gate. Raises :class:`budget.BudgetExhausted` when today's allowance is spent.

    The same exception the counters raise, carrying the same Wobo line and the learner's own
    midnight — there is one honest refusal in this product and a child is never told a price.
    A platform-paid capability is served on a spent day, because nobody's day paid for it.
    """
    if not _is_learner(meter_key):
        return None
    if registry.platform_paid(registry.canonical_capability(capability)):
        return None
    meter = state(meter_key, plan, now=now)
    if meter.spent:
        raise budget.BudgetExhausted(budget.classify(capability), meter.resets_at)
    return meter


__all__ = [
    "DEFAULT_FREE_DAILY_PAISE",
    "DEFAULT_INR_PER_USD",
    "DIALS",
    "DIAL_FREE_DAILY_PAISE",
    "DIAL_GENEROSITY",
    "DIAL_INR_PER_USD",
    "MAX_REFRESH_S",
    "ZONE_HEADER",
    "Meter",
    "apply",
    "check",
    "daily_paise",
    "debit",
    "local_day",
    "note_zone",
    "plan_monthly_paise",
    "reset",
    "refresh_interval_s",
    "resets_at",
    "set_clock",
    "set_period_resolver",
    "set_zone_resolver",
    "state",
    "zone_name",
]
