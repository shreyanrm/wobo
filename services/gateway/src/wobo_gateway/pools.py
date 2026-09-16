"""The two pools the platform pays for out of its own pocket, and the caps on them.

``docs/ALLOWANCE.md`` ("Creative work is never on the allowance", and "Best of both worlds"
point 4) and ``docs/CONSOLE-MODELS.md`` ("The creative pool"). Three sentences of the owner's
are the whole specification:

* *"I don't want to charge the users; bill them only for content and usage."* — the creative
  layer is the platform's cost, with its own daily cap (default 40 USD).
* *"I can't keep giving free service out of goodwill and pay from my pocket."* — the free lane
  is bounded in TOTAL as well as per learner, so growth cannot outrun the money.
* *"When the day is spent, Wobo says one kind line."* — a cap is met with the same sentence the
  counters already say, and never with a number.

**WHY THIS MODULE HAD TO EXIST.** Migration 0030 seeded both dials and wrote "alerts at 50/80/100
percent" into its own comments; :mod:`dials` read them; the models desk printed both caps on the
screen. Nothing accumulated either pool, nothing compared a day against a cap, and
``alerts.EVENTS`` had no pool event in it at all. Both ceilings were therefore decoration: a free
lane could have run all night against a cap that was never once read, which is precisely the
exposure the owner asked to be closed.

**THE TWO POOLS, AND WHY THEY ARE NOT ONE.**

============  ===================================  ==========================================
creative      ``registry.platform_paid`` work      made ONCE per concept and cached for every
              (``create.core``, ``create.blueprint``)  learner who ever opens that cell
free          a free learner's metered calls       spent again for every learner, every day
============  ===================================  ==========================================

They are never added together and never shown in one figure. The creative pool is an investment
whose per-learner cost falls every day the cache is warm; the free pool is recurring goodwill.
An operator who saw one number would draw exactly the wrong conclusion about both.

**WHOSE CALL LANDS WHERE.** ``platform_paid`` is asked FIRST, whatever plan the learner who
triggered it is on — that is the ruling itself, not a rounding: a Pro learner opening a cell
nobody has opened before triggers a concept core, and the pool pays for it because everyone who
follows gets it free. A PAID learner's ordinary turn is on neither pool: they are spending the
allowance they bought, and counting it as goodwill would make the goodwill figure meaningless.

**A CAP IS NOT A DEFAULT.** ``free.pool.daily_paise`` is seeded ``null`` and this module reads
that as NO CAP SET — not zero. Zero is a legal value the owner may type, and it closes the free
lane for everybody; inventing it here would have been a ceiling nobody chose, discovered by a
child meeting it.

**ONE PROCESS, LIKE EVERY OTHER METER HERE.** The day is an in-process dict, exactly as
``spend.py`` holds the platform ceiling and ``budget.py`` its counters, and it carries the same
two consequences in the same words: a restart forgets the day, and a second replica gives each
its own pool, so the true ceiling multiplies by N. ``railway.json`` pins ``numReplicas: 1``. The
durable figures are already in ``ops.model_calls``; the upgrade path is to read today's sums from
it behind :func:`creative_state` and :func:`free_state`, and no caller changes.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from wobo_gateway import alerts, dials, registry

logger = logging.getLogger("wobo.gateway.pools")

#: The two pool names, as they appear in an alert field and on the desk.
CREATIVE = "creative"
FREE = "free"

#: Plan names that mean somebody paid. The same set ``spend`` and ``budget`` keep, and for the
#: same reason: a plan nobody recognises is free, never paid.
PAID_PLANS = frozenset({"pro", "max", "plus"})

#: Meter keys that belong to a learner. Mirrors ``allowance.LEARNER_PREFIXES``; kept as its own
#: constant so this module imports nothing from the meter it is about to be called beside.
LEARNER_PREFIXES: tuple[str, ...] = ("sub:", "anon:", "ip:")


@dataclass(frozen=True)
class Pool:
    """One pool's day, in both currencies, against whatever cap is set for it.

    ``fraction`` is ``None`` when no cap is set — never ``0.0``, which an operator reads as
    "none of it used" rather than "there is nothing to use it against".
    """

    name: str
    day: str
    spent_usd: float
    inr_per_usd: float
    cap_usd: float | None = None
    cap_paise: int | None = None

    @property
    def spent_paise(self) -> float:
        return self.spent_usd * self.inr_per_usd * 100.0

    @property
    def fraction(self) -> float | None:
        if self.cap_usd is not None:
            return (self.spent_usd / self.cap_usd) if self.cap_usd > 0 else 1.0
        if self.cap_paise is not None:
            return (self.spent_paise / self.cap_paise) if self.cap_paise > 0 else 1.0
        return None

    @property
    def spent(self) -> bool:
        """Is this pool's day gone? A pool with no cap is never spent."""
        fraction = self.fraction
        return fraction is not None and fraction >= 1.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "pool": self.name,
            "day": self.day,
            "spent_usd": round(self.spent_usd, 6),
            "spent_paise": round(self.spent_paise, 2),
            "cap_usd": self.cap_usd,
            "cap_paise": self.cap_paise,
            "fraction": None if self.fraction is None else round(self.fraction, 4),
            "spent": self.spent,
            "inr_per_usd": self.inr_per_usd,
        }


# --- what this module holds -------------------------------------------------------------------
#: (pool, UTC day) -> USD spent. USD rather than paise because a Luna turn is 0.0007 USD — six
#: hundredths of a paisa — and rounding each call would round a whole day of them down to nothing.
#: The rate is applied once, at read time, so a rate changed at noon prices the day consistently.
_spent: dict[tuple[str, str], float] = {}
#: (pool, UTC day) -> the thresholds already paged for, so each one wakes somebody exactly once.
_warned: dict[tuple[str, str], set[float]] = {}
_lock = threading.Lock()


def reset() -> None:
    """Test seam — both pools back to an empty day, and nothing paged yet."""
    with _lock:
        _spent.clear()
        _warned.clear()


def _day(now: datetime | None = None) -> str:
    return (now or datetime.now(UTC)).astimezone(UTC).date().isoformat()


def _is_learner(meter_key: str | None) -> bool:
    return bool(meter_key) and str(meter_key).startswith(LEARNER_PREFIXES)


def pool_for(*, capability: str, plan: str | None, meter_key: str | None) -> str | None:
    """Which pool this call is the platform's cost on, or ``None`` when it is nobody's.

    Asked in exactly this order, because the order IS the ruling (docs/ALLOWANCE.md, "Who pays
    for what"): platform-paid work is the creative pool's whatever plan triggered it; a free
    learner's metered call is the free pool's; everything else — a paying learner's turn, the
    platform's own system jobs, which ``spend.py``'s ceiling bounds — is on neither.
    """
    try:
        if registry.platform_paid(registry.canonical_capability(capability)):
            return CREATIVE
    except Exception:  # noqa: BLE001 — a capability the registry has never heard of is not ours
        return None
    if not _is_learner(meter_key):
        return None
    return FREE if (plan or "free").strip().lower() not in PAID_PLANS else None


def note(
    *,
    capability: str,
    plan: str | None,
    cost_usd: float | None,
    meter_key: str | None = None,
    occurred_at: datetime | None = None,
) -> None:
    """Add one call's cost to whichever pool pays for it, and page on a crossing.

    Called from :func:`ledger.record`, beside ``allowance.debit`` and for the same reason: that
    is the one funnel every priced model call in this service already passes through, so a
    capability added tomorrow is inside the platform's caps the day it costs money rather than
    the day somebody remembers to add it. Never raises — an accounting line is worth less than a
    child's answer, and a pool that cannot be counted must not be able to fail a turn.
    """
    try:
        if cost_usd is None or cost_usd <= 0:
            return  # a cache hit, or a call nobody was billed for
        name = pool_for(capability=capability, plan=plan, meter_key=meter_key)
        if name is None:
            return
        day = _day(occurred_at)
        with _lock:
            _spent[(name, day)] = _spent.get((name, day), 0.0) + float(cost_usd)
        _page(name, day)
    except Exception as exc:  # noqa: BLE001
        logger.debug("pools: not counted (%s: %s)", type(exc).__name__, exc)


def _page(name: str, day: str) -> None:
    """Raise the alarm for any threshold this call has just carried the pool past."""
    pool = _state(name, day)
    fraction = pool.fraction
    if fraction is None:
        return  # no cap set: there is no line to cross
    crossed: list[float] = []
    with _lock:
        already = _warned.setdefault((name, day), set())
        for threshold in dials.ALERT_FRACTIONS:
            if fraction >= threshold and threshold not in already:
                already.add(threshold)
                crossed.append(threshold)
    for threshold in crossed:
        alerts.alert(
            alerts.POOL_THRESHOLD,
            (
                f"the {name} pool has passed {threshold:.0%} of the day's cap"
                if name == CREATIVE
                else f"the day's spend on free learners has passed {threshold:.0%} of the cap"
            ),
            severity=alerts.CRITICAL if threshold >= 1.0 else alerts.WARN,
            # ``pool`` is NOT passed separately: :meth:`Pool.as_dict` already carries it, and
            # naming it twice is a duplicate keyword argument — a TypeError that :func:`note`'s
            # own guard swallows, which is exactly how this alarm managed to look wired while
            # never once firing.
            threshold=threshold,
            **pool.as_dict(),
        )


def _state(name: str, day: str) -> Pool:
    with _lock:
        spent_usd = _spent.get((name, day), 0.0)
    rate = dials.inr_per_usd()
    if name == CREATIVE:
        return Pool(
            name=name, day=day, spent_usd=spent_usd, inr_per_usd=rate,
            cap_usd=dials.creative_pool_usd(),
        )
    return Pool(
        name=name, day=day, spent_usd=spent_usd, inr_per_usd=rate,
        cap_paise=dials.free_pool_paise(),
    )


def creative_state(now: datetime | None = None) -> Pool:
    """What the platform has spent today on work that is made once and shared with everyone."""
    return _state(CREATIVE, _day(now))


def free_state(now: datetime | None = None) -> Pool:
    """What the platform has spent today on free learners — the goodwill, in rupees."""
    return _state(FREE, _day(now))


def free_pool_spent(now: datetime | None = None) -> bool:
    """Has the day's goodwill run out? ``False`` whenever no cap has been set."""
    return free_state(now).spent


def creative_pool_spent(now: datetime | None = None) -> bool:
    return creative_state(now).spent


def view(now: datetime | None = None) -> dict[str, Any]:
    """Both pools for the models desk, side by side and never added together."""
    return {
        "creative": creative_state(now).as_dict(),
        "free": free_state(now).as_dict(),
        "alert_fractions": list(dials.ALERT_FRACTIONS),
        "platform_paid_capabilities": sorted(registry.PLATFORM_PAID),
    }


__all__ = [
    "CREATIVE",
    "FREE",
    "LEARNER_PREFIXES",
    "PAID_PLANS",
    "Pool",
    "creative_pool_spent",
    "creative_state",
    "free_pool_spent",
    "free_state",
    "note",
    "pool_for",
    "reset",
    "view",
]
