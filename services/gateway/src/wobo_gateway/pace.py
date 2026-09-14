"""The pace: today's use against today's allowance, across learners.

``docs/ALLOWANCE.md`` §3 — *"today's spend against today's allowance across all learners; how many
hit the bar and at what hour of their day; the median fraction used. This is how the owner watches
the pace."*

**Where the numbers come from.** ``ops.learner_day`` (migration 0027) is one row per (day,
learner_ref, plan): the sum of ``ops.model_calls.cost_usd`` and the count of calls. ``learner_ref``
is the ledger's salted one-way pseudonym of the meter key — enough to count people and to notice a
heavy account, and deliberately not enough to name anybody. Nothing on this desk is a learner.

**The three numbers, and why each is the shape it is.**

* *how many hit the bar* is counted per LEARNER, never per call: one account that spent its day is
  one person out of questions, whatever it took to get there.
* *the median fraction* is the middle learner, not the mean. One heavy account must not read as
  everybody being busy, which is exactly what a mean would say on a product this young.
* *the spend* is carried in both currencies, because the ledger bills in dollars and the allowance
  is set in rupees, and an operator reconciling a provider bill needs the dollars unconverted.

**What this desk does not know, and says so.** ``ops.model_calls`` carries a UTC day and no time
zone. "At what local hour did they hit the bar" therefore has no honest answer here, and
:func:`view` returns ``by_hour: None`` with the reason in words rather than printing a UTC hour
under a heading that says the learner's own. The allowance meter is the thing that knows the
learner's midnight (``docs/ALLOWANCE.md`` §4.6), and when it records the moment a learner meets the
bar, this desk reads it. Until then the honest answer is that we do not know.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.parse
import urllib.request
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime
from typing import Any

logger = logging.getLogger("wobo.gateway.pace")

SCHEMA = "ops"
VIEW = "learner_day"
_HTTP_TIMEOUT_S = 5.0

#: The most learners one read brings back. A floor is printed as a floor: past this the desk says
#: the number is the first N rather than pretending it counted everybody.
MAX_LEARNERS = 5000

#: The one thing this desk cannot see, in the words that go on the screen.
NOT_KNOWN = (
    "The hour is the learner's own local hour, and the usage ledger carries a UTC day and no "
    "time zone, so nothing here can say it. The allowance meter is what knows a learner's "
    "midnight; when it records the moment a learner meets the bar, this line becomes a number."
)


def _fraction(cost_usd: float, allowance_paise: int, inr_per_usd: float) -> float | None:
    if allowance_paise <= 0:
        return None
    spent_paise = cost_usd * inr_per_usd * 100.0
    return round(spent_paise / allowance_paise, 4)


def _median(values: Sequence[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return round((ordered[middle - 1] + ordered[middle]) / 2, 4)


def summarise(
    rows: Sequence[dict[str, Any]],
    *,
    allowance_paise: Callable[[str], int],
    inr_per_usd: float,
) -> dict[str, Any]:
    """The pace from ``ops.learner_day`` rows. Pure: no store, no clock, no environment.

    A learner with two plan strings in one day (they upgraded) is ONE person, and the allowance
    used is the more generous of the two — the day they bought is the day they have.
    """
    per_learner: dict[str, dict[str, Any]] = {}
    spent_usd = 0.0
    calls = 0
    for row in rows:
        ref = str(row.get("learner_ref") or "").strip()
        if not ref:
            continue
        cost = float(row.get("cost_usd") or 0.0)
        spent_usd += cost
        calls += int(row.get("calls") or 0)
        plan = str(row.get("plan") or "free").strip().lower()
        allowance = allowance_paise(plan)
        held = per_learner.setdefault(ref, {"cost_usd": 0.0, "allowance_paise": allowance})
        held["cost_usd"] += cost
        held["allowance_paise"] = max(int(held["allowance_paise"]), int(allowance))

    fractions: list[float] = []
    at_the_bar = 0
    for held in per_learner.values():
        fraction = _fraction(held["cost_usd"], int(held["allowance_paise"]), inr_per_usd)
        if fraction is None:
            continue
        fractions.append(fraction)
        if fraction >= 1.0:
            at_the_bar += 1
    spent_usd = round(spent_usd, 6)
    return {
        "learners": len(per_learner),
        "calls": calls,
        "spent_usd": spent_usd,
        "spent_paise": int(round(spent_usd * inr_per_usd * 100.0)),
        "at_the_bar": at_the_bar,
        "median_fraction": _median(fractions),
        # The shape of the day, so the owner can see whether the bar is close for many or far for
        # all. Buckets rather than a list: a per-learner list is a per-learner disclosure.
        "bands": _bands(fractions),
    }


def _bands(fractions: Sequence[float]) -> dict[str, int]:
    bands = {"under_quarter": 0, "under_half": 0, "under_all": 0, "at_the_bar": 0}
    for fraction in fractions:
        if fraction >= 1.0:
            bands["at_the_bar"] += 1
        elif fraction >= 0.5:
            bands["under_all"] += 1
        elif fraction >= 0.25:
            bands["under_half"] += 1
        else:
            bands["under_quarter"] += 1
    return bands


def view(
    rows: Sequence[dict[str, Any]] | None,
    *,
    allowance_paise: Callable[[str], int],
    inr_per_usd: float,
    day: date | None = None,
) -> dict[str, Any]:
    """The envelope the desk renders. ``readable: false`` is "we could not ask", never a zero.

    A console that drew an empty pace for both would tell the owner the product was quiet on a day
    the console was blind, and those are opposite facts.
    """
    envelope: dict[str, Any] = {
        "day": (day or datetime.now(UTC).date()).isoformat(),
        "readable": rows is not None,
        "not_known": NOT_KNOWN,
        "by_hour": None,
        "inr_per_usd": inr_per_usd,
    }
    if rows is None:
        return envelope
    envelope.update(summarise(rows, allowance_paise=allowance_paise, inr_per_usd=inr_per_usd))
    envelope["complete"] = len(rows) < MAX_LEARNERS
    return envelope


# --- the read ------------------------------------------------------------------------------------
def _project() -> tuple[str, str] | None:
    base = (os.getenv("SUPABASE_URL") or "").strip()
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or ""
    ).strip()
    return (base.rstrip("/"), key) if base and key else None


def read_day(day: date | None = None) -> list[dict[str, Any]] | None:
    """``ops.learner_day`` for one day, or ``None`` when we could not ask.

    ``None`` and ``[]`` are different answers and stay different all the way to the screen. A
    gateway with no project configured, a view that has not been migrated yet and a database that
    refused all answer ``None``: in none of those three did anybody tell us the day was quiet.
    """
    project = _project()
    if project is None:
        return None
    base, key = project
    when = (day or datetime.now(UTC).date()).isoformat()
    query = urllib.parse.urlencode(
        [
            ("select", "learner_ref,plan,cost_usd,calls"),
            ("day", f"eq.{when}"),
            ("limit", str(MAX_LEARNERS)),
        ],
        quote_via=urllib.parse.quote,
    )
    request = urllib.request.Request(  # noqa: S310 — the URL is built here, never from a caller
        f"{base}/rest/v1/{VIEW}?{query}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
            "Accept-Profile": SCHEMA,
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
            body = json.loads(response.read().decode() or "[]")
    except Exception as exc:  # noqa: BLE001 — an unreachable desk is a fact, not a stack trace
        logger.warning("pace: could not read %s (%s: %s)", VIEW, type(exc).__name__, exc)
        return None
    return body if isinstance(body, list) else None


__all__ = ["MAX_LEARNERS", "NOT_KNOWN", "read_day", "summarise", "view"]
