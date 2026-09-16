"""The live dials: ``ops.settings`` read on a short interval and fed into the router.

``docs/CONSOLE-MODELS.md`` §2 and §"Expenses you can see, dials that apply", and
``docs/ALLOWANCE.md`` §3. The owner's sentence is the whole specification: *"I want to be able to
track all these expenses in my dashboards and adjust them so that what I request will apply."*

**One table, one seam.** Migration 0024 created ``ops.settings`` and said in its own header that
the allowance and the models desk were to add their keys beside the door's rather than inventing
tables of their own. So this module reads and writes through :mod:`wobo_gateway.doors`' store: one
ops.settings, one HTTP client, one audit trigger behind both.

**The keys.**

============================  ================================================================
``tier.<name>.primary``       the model a tier asks first; an id from :data:`routing.CATALOGUE`
``tier.<name>.chain``         that tier's FALLBACKS, in order — exactly what
                              ``WOBO_TIER_<NAME>_CHAIN`` means, so the two can never disagree
``generation.ladder``         the rungs generation climbs, cheapest first
``allowance.generosity``      the fraction of the plan amount given as model spend, per plan
``allowance.free_daily_paise``  the free plan's day, in paise (default 500 = ₹5)
``allowance.inr_per_usd``     the rate the ledger's USD is read in rupees at
``creative.pool.daily_usd``   the platform's own cap for the create tier (docs/ALLOWANCE.md)
``free.pool.daily_paise``     the day's ceiling on all free learners together
``mail.ladder``               the mail's step-down by days away: four ascending last-days, the
                              owner's default ``[14, 30, 60, 90]`` (docs/EMAILS-AND-ANIMATIONS.md)
============================  ================================================================

**Env wins, and the desk says so.** The overrides are turned into the same ``WOBO_TIER_*``
mapping the boot already reads, and ``os.environ`` is layered ON TOP before
:func:`routing.configure` sees it. So a Railway variable beats a dial, which is the documented
rule, and :func:`source_for_tier` can tell the console which one is actually in force — a desk
that shows a value the gateway is not using is worse than a desk with no value on it.

**A bad dial never takes the gateway down.** An env override refuses the BOOT, which is right
when a deploy is watching. A dial is turned while the product is serving children, so an id this
router cannot route to is dropped with a warning, recorded in :func:`rejected` for the desk to
show, and the owner's table keeps standing. The write path refuses it up front
(:class:`UnknownModel`), so the only way to get a rejected dial is to type one into the SQL editor.

**Clearing is a write of ``null``, never a delete.** ``ops.settings_audit`` is fed by a trigger on
insert and update; a deleted row leaves the trail with no closing entry. "Back to the owner's
table" therefore writes a json ``null``, which reads here as "no override" and leaves a proper
before-and-after in the trail.
"""

from __future__ import annotations

import logging
import math
import os
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, date, datetime
from typing import Any

from wobo_gateway import doors, registry, routing
from wobo_gateway.routing import CATALOGUE, Tier

logger = logging.getLogger("wobo.gateway.dials")

# --- the keys -------------------------------------------------------------------------------------
LADDER_KEY = "generation.ladder"
GENEROSITY_KEY = "allowance.generosity"
FREE_PAISE_KEY = "allowance.free_daily_paise"
INR_RATE_KEY = "allowance.inr_per_usd"
CREATIVE_POOL_KEY = "creative.pool.daily_usd"
FREE_POOL_KEY = "free.pool.daily_paise"
#: The mail's step-down (docs/EMAILS-AND-ANIMATIONS.md, "The weekly cadence"): "The steps are one
#: console dial." Four ascending whole days, the last day away on each step but the last, which
#: never ends. ``wobo_gateway.activity`` owns the default and reads this through
#: :func:`valid_mail_ladder`, so a bad value is ignored rather than obeyed.
MAIL_LADDER_KEY = "mail.ladder"
MAIL_LADDER_STEPS = 4
MAIL_LADDER_MAX_DAYS = 365
#: The discovery dials (docs/BOARD-COLD-START.md §5). The four about money and the switch live
#: in ``curriculum/discovery/ceiling.py``; the fifth, how many academic years out of date a
#: board's document may be before it is refused, lives in ``curriculum/discovery/dating.py``
#: beside the reasoning for its default. They are named here so they are read on the same
#: interval as every other dial and audited by the same trigger.
DISCOVERY_KEYS: tuple[str, ...] = (
    "discovery.running",
    "discovery.board.max_usd",
    "discovery.daily.max_usd",
    "discovery.refusal.retry_days",
    "discovery.document.max_age_years",
)


def tier_primary_key(tier: str) -> str:
    return f"tier.{tier}.primary"


def tier_chain_key(tier: str) -> str:
    return f"tier.{tier}.chain"


def tier_keys() -> tuple[str, ...]:
    keys: list[str] = []
    for tier in Tier:
        keys.append(tier_primary_key(tier.value))
        keys.append(tier_chain_key(tier.value))
    return (*keys, LADDER_KEY)


def allowance_keys() -> tuple[str, ...]:
    return (GENEROSITY_KEY, FREE_PAISE_KEY, INR_RATE_KEY, CREATIVE_POOL_KEY, FREE_POOL_KEY)


def keys() -> tuple[str, ...]:
    return (*tier_keys(), *allowance_keys(), *DISCOVERY_KEYS, MAIL_LADDER_KEY)


# --- the defaults ------------------------------------------------------------------------------------
#: docs/ALLOWANCE.md §1: "a superadmin setting, default 0.25". Per plan, so Max can be more
#: generous than Pro later without a deploy.
DEFAULT_GENEROSITY: dict[str, float] = {"plus": 0.25, "pro": 0.25, "max": 0.25}
#: docs/ALLOWANCE.md §1: "a superadmin setting in paise per day, default ₹5".
DEFAULT_FREE_PAISE = 500
#: docs/OPERATIONS.md §11.3 reads the ledger's dollars at "83 to the dollar". A dial, with the day
#: it was set beside it on the desk, because a stale rate quietly moves every allowance.
DEFAULT_INR_PER_USD = 83.0
#: docs/CONSOLE-MODELS.md, "The creative pool": the platform's own daily cap, default 40 USD.
DEFAULT_CREATIVE_POOL_USD = 40.0
#: The fractions the console turns amber and red at, for every pool with a cap.
ALERT_FRACTIONS: tuple[float, ...] = (0.5, 0.8, 1.0)

#: How long the gateway serves what it last read before asking again. The law (docs/CONSOLE-MODELS
#: .md) says "within a minute", so the default is well under one and the cap is one.
DEFAULT_REFRESH_S = 30.0
MAX_REFRESH_S = 60.0

#: ``plus`` is the name the first paid tier shipped under and is priced as Pro
#: (``budget.py`` resolves it the same way). Nothing here may invent a plan the product sells.
_PLAN_ALIASES: dict[str, str] = {"plus": "pro"}
PAID_PLANS: tuple[str, ...] = ("plus", "pro", "max")


class UnknownModel(ValueError):
    """An id that is not in :data:`routing.CATALOGUE`. Refused at the write, never routed to."""


class BadDial(ValueError):
    """A dial outside the range the document gives it."""


# --- module state --------------------------------------------------------------------------------
_monotonic: Callable[[], float] = time.monotonic
_lock = threading.Lock()
_values: dict[str, Any] = {}
_rejected: dict[str, str] = {}
_read_at: float | None = None
_applied_at: datetime | None = None


def set_clock(clock: Callable[[], float] | None) -> None:
    """Test seam: replace the monotonic clock so a test can cross the interval at once."""
    global _monotonic
    _monotonic = clock or time.monotonic
    reset()


def reset() -> None:
    """Drop what was last read. The next :func:`maybe_refresh` asks the store."""
    global _values, _rejected, _read_at, _applied_at
    with _lock:
        _values = {}
        _rejected = {}
        _read_at = None
        _applied_at = None


def refresh_interval_s() -> float:
    raw = os.getenv("DIALS_REFRESH_S")
    try:
        wanted = float(raw) if raw is not None else DEFAULT_REFRESH_S
    except ValueError:
        wanted = DEFAULT_REFRESH_S
    return max(0.0, min(wanted, MAX_REFRESH_S))


def _store() -> doors.SettingsStore:
    return doors.get_store()


def _read_store(wanted: Sequence[str]) -> dict[str, Any]:
    store = _store()
    bulk = getattr(store, "read_many", None)
    if callable(bulk):
        found = bulk(wanted)
        return dict(found) if isinstance(found, dict) else {}
    return {key: value for key in wanted if (value := store.read(key)) is not None}


# --- reading ---------------------------------------------------------------------------------------
def values() -> dict[str, Any]:
    """Every dial as last read. Never raises and never blocks on the store."""
    maybe_refresh()
    with _lock:
        return dict(_values)


def value(key: str, default: Any = None) -> Any:
    got = values().get(key)
    return default if got is None else got


def rejected() -> dict[str, str]:
    """Dials that were read and could not be used, by tier, with the reason in words."""
    maybe_refresh()
    with _lock:
        return dict(_rejected)


def applied_at() -> datetime | None:
    """When the gateway last fed what it read into the router. The console's "applied at"."""
    with _lock:
        return _applied_at


def changed_at(key: str) -> datetime | None:
    """When this dial last moved, from ``ops.settings.updated_at``, or None when we cannot say."""
    try:
        ask = getattr(_store(), "changed_at", None)
        return ask(key) if callable(ask) else None
    except Exception as exc:  # noqa: BLE001 — a store that cannot say says nothing
        logger.warning("dials: could not read when %s moved (%s)", key, exc)
        return None


def maybe_refresh() -> None:
    """Re-read and re-apply if the interval has passed. Cheap enough for any call path."""
    now = _monotonic()
    with _lock:
        fresh = _read_at is not None and (now - _read_at) < refresh_interval_s()
    if not fresh:
        apply(force=True)


def apply(*, force: bool = False) -> None:
    """Read every dial and feed the router, now.

    Called on the interval, on every console write, and on ``POST /v1/admin/settings/apply``.
    Never raises: a store that refuses leaves the last good table standing and says so once.
    """
    if not force:
        maybe_refresh()
        return
    global _values, _rejected, _read_at, _applied_at
    try:
        found = _read_store(keys())
    except Exception as exc:  # noqa: BLE001 — a dial we cannot read is a dial that is not set
        logger.warning("dials: could not read ops.settings (%s: %s)", type(exc).__name__, exc)
        with _lock:
            _read_at = _monotonic()
        return
    environ, bad = overrides_environ(found)
    # os.environ LAST: a Railway variable beats a dial, which is the documented rule.
    layered: dict[str, str] = {**environ, **os.environ}
    try:
        routing.configure(layered)
        registry.reload()
    except RuntimeError as exc:
        # The env itself is bad, which is a boot problem and not ours to paper over. The table
        # already in place is left alone.
        logger.error("dials: the routing table was refused (%s)", exc)
        with _lock:
            _read_at = _monotonic()
        return
    with _lock:
        _values = found
        _rejected = bad
        _read_at = _monotonic()
        _applied_at = datetime.now(UTC)


def overrides_environ(found: Mapping[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
    """Dial values -> the ``WOBO_TIER_*`` mapping the boot already reads, and what was dropped.

    Pure: reads its argument, touches no module state. Everything this function refuses is
    something :func:`routing._read_table` would have refused at boot, checked here so a bad dial
    is a dropped override rather than a dead gateway.
    """
    environ: dict[str, str] = {}
    bad: dict[str, str] = {}
    for tier in Tier:
        name = tier.value
        primary = found.get(tier_primary_key(name))
        if primary is not None:
            if isinstance(primary, str) and primary in CATALOGUE:
                environ[f"{routing.ENV_PREFIX}{name.upper()}"] = primary
            else:
                bad[name] = f"{primary!r} is not a model this router knows"
        chain = _as_models(found.get(tier_chain_key(name)))
        if chain is not None:
            unknown = [model for model in chain if model not in CATALOGUE]
            if not chain:
                bad[name] = "the chain was empty; a tier with no fallback is not a chain"
            elif unknown:
                bad[name] = f"the chain names {unknown[0]!r}, which is not a model we know"
            elif len(set(chain)) != len(chain):
                bad[name] = "the chain repeats a model; a chain is one attempt per model"
            else:
                environ[f"{routing.ENV_PREFIX}{name.upper()}_CHAIN"] = ",".join(chain)
    rungs = _as_models(found.get(LADDER_KEY))
    if rungs is not None:
        unknown = [model for model in rungs if model not in CATALOGUE]
        if len(rungs) < 2:
            bad["generation.ladder"] = "a ladder with one rung is not a ladder"
        elif unknown:
            bad["generation.ladder"] = f"the ladder names {unknown[0]!r}, which we cannot route to"
        elif len(set(rungs)) != len(rungs):
            bad["generation.ladder"] = "a ladder is one rung per model"
        else:
            environ[routing.LADDER_ENV] = ",".join(rungs)
    return environ, bad


def _as_models(value: Any) -> list[str] | None:
    """A chain as a json array or as the comma-separated string an env variable would carry."""
    if value is None:
        return None
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, list | tuple):
        return [str(part).strip() for part in value if str(part).strip()]
    return []


def source_for_tier(tier: str) -> str:
    """``env``, ``desk`` or ``default`` — which of the three is in force for this tier."""
    upper = tier.upper()
    if os.getenv(f"{routing.ENV_PREFIX}{upper}") or os.getenv(f"{routing.ENV_PREFIX}{upper}_CHAIN"):
        return "env"
    held = values()
    if held.get(tier_primary_key(tier)) is not None or held.get(tier_chain_key(tier)) is not None:
        return "desk" if tier not in rejected() else "default"
    return "default"


def desk_value_for_tier(tier: str) -> dict[str, Any]:
    """What the DESK holds for this tier, whether or not it is what the gateway is using."""
    held = values()
    return {
        "primary": held.get(tier_primary_key(tier)),
        "chain": _as_models(held.get(tier_chain_key(tier))),
    }


# --- the generation ladder ---------------------------------------------------------------------------
def ladder() -> tuple[str, ...]:
    """The rungs generation climbs right now, with the dial applied if one is set."""
    return routing.generation_ladder()


# --- the allowance ------------------------------------------------------------------------------------
def generosity() -> dict[str, float]:
    """The fraction of the plan amount given as model spend, per plan. Defaults merged in."""
    held = values().get(GENEROSITY_KEY)
    out = dict(DEFAULT_GENEROSITY)
    if isinstance(held, Mapping):
        for plan, fraction in held.items():
            name = str(plan).strip().lower()
            if name in out and isinstance(fraction, int | float) and not isinstance(fraction, bool):
                out[name] = max(0.0, min(float(fraction), 1.0))
    return out


def free_daily_paise() -> int:
    held = values().get(FREE_PAISE_KEY)
    if isinstance(held, int | float) and not isinstance(held, bool) and held >= 0:
        return int(held)
    return DEFAULT_FREE_PAISE


def inr_per_usd() -> float:
    held = values().get(INR_RATE_KEY)
    if isinstance(held, int | float) and not isinstance(held, bool) and held > 0:
        return float(held)
    return DEFAULT_INR_PER_USD


def creative_pool_usd() -> float:
    held = values().get(CREATIVE_POOL_KEY)
    if isinstance(held, int | float) and not isinstance(held, bool) and held >= 0:
        return float(held)
    return DEFAULT_CREATIVE_POOL_USD


def free_pool_paise() -> int | None:
    """The day's ceiling on every free learner together, or None when the owner has set none.

    None is not zero and is not "unlimited by design": it is "no cap has been set", which the desk
    prints in those words. docs/ALLOWANCE.md gives this dial no default, so neither does this.
    """
    held = values().get(FREE_POOL_KEY)
    if isinstance(held, int | float) and not isinstance(held, bool) and held >= 0:
        return int(held)
    return None


def plan_amount_paise(plan: str, period: str = "monthly") -> int | None:
    """What the learner pays PER MONTH, in paise: a yearly plan's monthly equivalent.

    From ``billing.plans.CATALOGUE``, which is the gateway's only copy of docs/PRICING.md.
    """
    from wobo_gateway.billing import plans as billing_plans

    name = _PLAN_ALIASES.get((plan or "").strip().lower(), (plan or "").strip().lower())
    spec = billing_plans.spec_for(name, period)
    if spec is None:
        return None
    return spec.amount_paise // 12 if spec.period == "yearly" else spec.amount_paise


def days_in(month: date) -> int:
    if month.month == 12:
        return 31
    return (month.replace(month=month.month + 1, day=1) - month.replace(day=1)).days


def daily_allowance_paise(
    plan: str,
    *,
    period: str = "monthly",
    days_in_month: int | None = None,
    today: date | None = None,
) -> int:
    """The day's allowance for this plan, in paise. docs/ALLOWANCE.md §1's arithmetic exactly.

    plan amount x generosity / days in the learner's current month, to the nearest paisa. A plan
    name nobody recognises gets the FREE day, never a paid one — the same rule ``budget.py`` and
    ``spend.py`` keep, because a billing bug must cost a learner questions and never hand out an
    allowance nobody paid for.
    """
    amount = plan_amount_paise(plan, period)
    if amount is None:
        return free_daily_paise()
    fraction = generosity().get(_PLAN_ALIASES.get(plan.strip().lower(), plan.strip().lower()), 0.0)
    days = days_in_month or days_in(today or datetime.now(UTC).date())
    if days <= 0:
        return free_daily_paise()
    return int(round(amount * fraction / days))


def rupees(paise: int | float | None) -> str:
    """Paise as an operator reads them. The console is the ONE place money is written down."""
    if paise is None or not math.isfinite(float(paise)):
        return "—"
    return f"₹{float(paise) / 100:,.2f}"


def allowance_effect(
    *, days_in_month: int | None = None, today: date | None = None
) -> list[dict[str, Any]]:
    """"A Pro learner gets ₹13.88 a day" — every plan, before anything is saved.

    docs/ALLOWANCE.md §3 asks for the effect shown LIVE beside the dial. The console posts a
    proposed set of dials with ``preview`` and gets this back computed from them, so the owner
    reads the consequence and not the fraction.
    """
    days = days_in_month or days_in(today or datetime.now(UTC).date())
    rows: list[dict[str, Any]] = [
        {
            "plan": "free",
            "period": None,
            "plan_amount_paise": 0,
            "generosity": None,
            "daily_paise": free_daily_paise(),
            "a_day": rupees(free_daily_paise()),
        }
    ]
    for plan in ("pro", "max"):
        for period in ("monthly", "yearly"):
            amount = plan_amount_paise(plan, period)
            if amount is None:
                continue
            daily = daily_allowance_paise(
                plan, period=period, days_in_month=days, today=today
            )
            rows.append(
                {
                    "plan": plan,
                    "period": period,
                    "plan_amount_paise": amount,
                    "generosity": generosity().get(plan),
                    "daily_paise": daily,
                    "a_day": rupees(daily),
                }
            )
    return rows


# --- the mail ladder -----------------------------------------------------------------------------
def valid_mail_ladder(value: Any) -> tuple[int, ...] | None:
    """The ladder's bounds when ``value`` is one, else None. Never raises.

    Four whole days, each at least one, strictly ascending, the last no more than a year: a bound
    out of order would put a learner on two steps at once, and a ladder that never reaches its
    last step would silently drop the owner's once-a-month floor.
    """
    if not isinstance(value, list | tuple) or len(value) != MAIL_LADDER_STEPS:
        return None
    bounds: list[int] = []
    for item in value:
        if not isinstance(item, int) or isinstance(item, bool) or item < 1:
            return None
        if bounds and item <= bounds[-1]:
            return None
        bounds.append(item)
    if bounds[-1] > MAIL_LADDER_MAX_DAYS:
        return None
    return tuple(bounds)


def set_mail_ladder(
    bounds: Sequence[int] | None, *, actor: str | None, note: str | None = None
) -> None:
    """Move the step-down, or clear it back to the owner's default with ``None``."""
    if bounds is not None and valid_mail_ladder(list(bounds)) is None:
        raise BadDial(
            "the ladder is four whole days, each larger than the last, the last within a year"
        )
    _write(MAIL_LADDER_KEY, None if bounds is None else list(bounds), actor=actor, note=note)
    apply(force=True)


# --- writing ---------------------------------------------------------------------------------------
def _write(key: str, value: Any, *, actor: str | None, note: str | None) -> None:
    _store().write(key, value, actor=actor, note=note)


def set_tier(
    tier: str,
    *,
    primary: str | None = None,
    chain: Sequence[str] | None = None,
    actor: str | None,
    note: str | None = None,
) -> None:
    """Move a tier's primary, its chain, or both. Refuses anything the router could not route to.

    ``chain`` is the FALLBACKS in order, exactly as ``WOBO_TIER_<NAME>_CHAIN`` means it, so the
    dial and the variable can never mean two different things.
    """
    name = (tier or "").strip().lower()
    if name not in {t.value for t in Tier}:
        raise UnknownModel(f"{tier!r} is not a tier this router has")
    if primary is not None:
        if primary not in CATALOGUE:
            raise UnknownModel(f"{primary!r} is not a model this router knows")
        _write(tier_primary_key(name), primary, actor=actor, note=note)
    if chain is not None:
        models = [str(model).strip() for model in chain if str(model).strip()]
        if not models:
            raise UnknownModel("a tier with no fallback is not a chain")
        for model in models:
            if model not in CATALOGUE:
                raise UnknownModel(f"{model!r} is not a model this router knows")
        head = primary if primary is not None else _current_primary(name)
        if len(set(models)) != len(models) or head in models:
            raise UnknownModel("a chain is one attempt per model, and never the primary twice")
        _write(tier_chain_key(name), models, actor=actor, note=note)
    apply(force=True)


def _current_primary(tier: str) -> str:
    return routing.tier_chain(Tier(tier))[0]


def set_ladder(models: Sequence[str], *, actor: str | None, note: str | None = None) -> None:
    """The rungs generation climbs, cheapest first. Two or more, all from the catalogue."""
    rungs = [str(model).strip() for model in models if str(model).strip()]
    if len(rungs) < 2:
        raise UnknownModel("a ladder with one rung is not a ladder")
    if len(set(rungs)) != len(rungs):
        raise UnknownModel("a ladder is one rung per model")
    for model in rungs:
        if model not in CATALOGUE:
            raise UnknownModel(f"{model!r} is not a model this router knows")
    _write(LADDER_KEY, rungs, actor=actor, note=note)
    apply(force=True)


def clear_tier_overrides(*, actor: str | None, note: str | None = None) -> int:
    """"Back to the owner's table": every tier dial written back to ``null``. Returns how many.

    A write and not a delete, so ``ops.settings_audit`` carries the clearing too. Reverting is
    the change most worth having a trail for.
    """
    held = values()
    cleared = 0
    for key in tier_keys():
        if held.get(key) is None:
            continue
        _write(key, None, actor=actor, note=note or "back to the owner's table")
        cleared += 1
    apply(force=True)
    return cleared


def set_allowance(
    *,
    generosity: Mapping[str, float] | None = None,
    free_daily_paise: int | None = None,
    inr_per_usd: float | None = None,
    creative_pool_usd: float | None = None,
    free_pool_paise: int | None = None,
    actor: str | None,
    note: str | None = None,
) -> None:
    """Turn the money dials. Every one is range-checked against the document that gave it."""
    if generosity is not None:
        cleaned: dict[str, float] = {}
        for plan, fraction in generosity.items():
            name = str(plan).strip().lower()
            if name not in DEFAULT_GENEROSITY:
                raise BadDial(f"{plan!r} is not a plan this product sells")
            if not isinstance(fraction, int | float) or isinstance(fraction, bool):
                raise BadDial("generosity is a fraction of the plan amount")
            if not 0.0 <= float(fraction) <= 1.0:
                raise BadDial("generosity is between 0 and 1; a plan cannot give more than it takes")
            cleaned[name] = float(fraction)
        _write(GENEROSITY_KEY, cleaned, actor=actor, note=note)
    if free_daily_paise is not None:
        if free_daily_paise < 0:
            raise BadDial("a free day cannot be less than nothing")
        _write(FREE_PAISE_KEY, int(free_daily_paise), actor=actor, note=note)
    if inr_per_usd is not None:
        if inr_per_usd <= 0:
            raise BadDial("the rate is rupees per dollar and has to be above zero")
        _write(INR_RATE_KEY, float(inr_per_usd), actor=actor, note=note)
    if creative_pool_usd is not None:
        if creative_pool_usd < 0:
            raise BadDial("a cap cannot be less than nothing")
        _write(CREATIVE_POOL_KEY, float(creative_pool_usd), actor=actor, note=note)
    if free_pool_paise is not None:
        if free_pool_paise < 0:
            raise BadDial("a cap cannot be less than nothing")
        _write(FREE_POOL_KEY, int(free_pool_paise), actor=actor, note=note)
    apply(force=True)


__all__ = [
    "ALERT_FRACTIONS",
    "CREATIVE_POOL_KEY",
    "DISCOVERY_KEYS",
    "DEFAULT_CREATIVE_POOL_USD",
    "DEFAULT_FREE_PAISE",
    "DEFAULT_GENEROSITY",
    "DEFAULT_INR_PER_USD",
    "FREE_PAISE_KEY",
    "FREE_POOL_KEY",
    "GENEROSITY_KEY",
    "INR_RATE_KEY",
    "LADDER_KEY",
    "MAIL_LADDER_KEY",
    "PAID_PLANS",
    "BadDial",
    "UnknownModel",
    "allowance_effect",
    "applied_at",
    "apply",
    "changed_at",
    "clear_tier_overrides",
    "creative_pool_usd",
    "daily_allowance_paise",
    "days_in",
    "desk_value_for_tier",
    "free_daily_paise",
    "free_pool_paise",
    "generosity",
    "inr_per_usd",
    "keys",
    "ladder",
    "maybe_refresh",
    "overrides_environ",
    "plan_amount_paise",
    "rejected",
    "reset",
    "rupees",
    "set_allowance",
    "set_clock",
    "set_ladder",
    "set_mail_ladder",
    "set_tier",
    "source_for_tier",
    "tier_chain_key",
    "tier_keys",
    "tier_primary_key",
    "valid_mail_ladder",
    "value",
    "values",
]
