"""The console's read surface: the three desks the owner asked for, and nothing invented.

This module OWNS NO DATA. Every figure it serves comes from a module that is already the single
authority on it, and this file's whole job is to put those authorities behind the guard so an
operator screen can read them:

* :func:`wobo_gateway.ledger.read_daily` — ``ops.usage_daily``, the permanent rollup. The console
  never touches ``ops.model_calls``: the migration says the rollup is what a console reads, and a
  second aggregation here would be a second answer to the same question.
* :func:`wobo_gateway.unit_economics.derive_window` — what a 1x day actually costs, split by what
  consumed it. That derivation already exists, already knows the plan's limits, and already
  reports its own holes; deriving it again here would be the same mistake in a second place.
* :func:`wobo_gateway.spend.state` — the day's in-process accumulator the CEILING itself reads.
* :func:`wobo_gateway.health.snapshot` — what ``/healthz`` serves.
* :func:`wobo_gateway.ledger.state` — how many rows the ledger has dropped, so "the numbers are
  incomplete" is something an operator can SEE rather than something they have to assume.

WHY THE ROUTES ARE HERE AND NOT IN ``admin_auth`` OR ``ledger``. ``admin_auth`` is the door and
should not know what is behind it; ``ledger`` is a writer and a store and should not grow an HTTP
surface. This is the seam between them, it is small, and it is the console's own.

**Guarded by construction.** Every route hangs off :func:`wobo_gateway.admin_auth.admin_router`,
whose dependencies already contain the guard, so nothing here can be added unprotected — and each
one additionally names :data:`~wobo_gateway.admin_auth.CONSOLE_READ`, so a seat that may work a
support queue cannot read the money. ``test_admin_guard.py`` walks the built app and fails if a
``/v1/admin`` path ever appears without the guard in its tree.

**Read-only, all of it.** There is no POST in this file. Nothing here changes a learner's data or
their money, so nothing here needs the step-up — and the day something does, it belongs behind
``requires(LEARNER_ACT)`` and a second confirmation, not beside these.

**NOTHING IS INVENTED WHEN THERE IS NOTHING.** ``ledger.read_daily`` returns ``None`` when the
ledger cannot be reached and ``[]`` when nothing has been recorded, and those are different
answers: the first is "we could not ask", the second is "nothing happened yet". They are carried
through as ``readable: false`` and an empty list, and the console renders them differently. No
route in this file substitutes a zero, a sample or an estimate for either.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import FastAPI, Query

from wobo_gateway import health, ledger, spend, unit_economics

# ``CanRead`` is admin_auth's own annotated dependency for the console.read permission. Using it
# rather than spelling ``Depends(requires(CONSOLE_READ))`` out again means there is one definition
# of what reading the console requires, and these routes cannot drift from it.
from wobo_gateway.admin_auth import CanRead, admin_router

#: The widest window a desk may ask for. ``ops.usage_daily`` is small enough to scan, but an
#: unbounded range is still an unbounded query on somebody else's database, and no operator
#: question needs more than a quarter at a time.
MAX_WINDOW_DAYS = 92
DEFAULT_WINDOW_DAYS = 30

#: Module-level singletons: a ``Query(...)`` built in an argument default is evaluated once at
#: import anyway, and naming it here is what keeps that explicit (and ruff's B008 quiet).
_DAYS = Query(DEFAULT_WINDOW_DAYS, ge=1, le=MAX_WINDOW_DAYS)
_PLAN = Query("free", max_length=32)


def window(days: int, *, today: date | None = None) -> tuple[date, date]:
    """The inclusive date range a desk read covers. UTC, because the ledger's day is UTC.

    Clamped rather than rejected: an operator who types a large number gets the largest honest
    window and the response says what it actually covered, which beats a 422 in the middle of an
    incident.
    """
    until = today or datetime.now(UTC).date()
    span = max(1, min(int(days), MAX_WINDOW_DAYS))
    return until - timedelta(days=span - 1), until


def rolled_at(rows: list[dict[str, Any]] | None) -> str | None:
    """The newest ``rolled_at`` in a window, or None when no row carries one.

    ``ops.usage_daily`` IS NOT LIVE. It is rebuilt by ``ops.roll_up_usage`` every
    ``LEDGER_ROLLUP_INTERVAL_S`` seconds — a quarter of an hour by default — on top of a five
    second flush, so today's row can be fifteen minutes behind what the platform has actually
    spent. Every panel drawn from it printed the moment of the FETCH, which reads as live.

    The rollup stamps ``rolled_at`` on every row it writes (migration 0018) and ``read_daily``
    selects ``*``, so the truth was already on the wire and the envelope simply threw it away.
    This carries it, and the console prints "rolled up HH:MM UTC" beside "as of HH:MM UTC".
    """
    if not rows:
        return None
    stamps = [str(row["rolled_at"]) for row in rows if row.get("rolled_at")]
    return max(stamps) if stamps else None


def _window_view(since: date, until: date, rows: list[dict[str, Any]] | None) -> dict[str, Any]:
    """The envelope every rollup read shares. ``readable`` is the honesty bit.

    ``readable: false`` means the ledger could not be reached, and then ``days`` is empty because
    there is nothing to report — NOT because nothing happened. A console that showed an empty
    chart for both would be telling the operator the platform was idle when in fact the console
    was blind, which is the exact failure this envelope exists to prevent.
    """
    return {
        "since": since.isoformat(),
        "until": until.isoformat(),
        "readable": rows is not None,
        "days": rows or [],
        # What the ledger itself knows about its own losses: buffered rows, dropped rows, whether
        # a database is configured at all. A total computed from a ledger that dropped rows is a
        # floor, and an operator has to be able to see that it is one.
        "ledger": ledger.state(),
        # HOW OLD THE ROWS THEMSELVES ARE, and how old they are allowed to get before that is worth
        # saying out loud. Without these two the console prints a cached figure under a fresh
        # timestamp, which is the politest possible way to show somebody the wrong number.
        "rolled_at": rolled_at(rows),
        "rollup_interval_s": ledger.rollup_interval_s(),
    }


def register_console(app: FastAPI) -> None:
    """Mount the console's read surface. Called once from ``app.create_app``."""
    router = admin_router(tags=["admin", "console"])

    @router.get("/usage")
    def usage(ctx: CanRead, days: int = _DAYS) -> dict[str, Any]:
        """The rollup, as rows. Spend, models and pacing are three readings of this one table.

        The rows are served UNGROUPED on purpose. ``ops.usage_daily`` is already the aggregate —
        one row per (day, capability, model, plan, unit kind) — and grouping it here would mean
        this file deciding what "by model" means, while the console decided what "by capability"
        means, and the two would drift. One table, one shape on the wire, and the grouping happens
        once, in the screen that draws it.

        ``spend`` rides along because it answers a question the rollup cannot: what has been spent
        SINCE THIS PROCESS STARTED, which is what the ceiling is actually enforcing right now. The
        two numbers disagree by design and the console shows both with their own labels.
        """
        since, until = window(days)
        rows = ledger.read_daily(since=since, until=until)
        ctx.audit(
            "console.usage.read",
            resource_type="usage_daily",
            detail={"since": since.isoformat(), "until": until.isoformat()},
        )
        return {
            **_window_view(since, until, rows),
            # The live ceiling, from the accumulator that enforces it. Process-local and reset by
            # any restart — ``spend.py`` says so in its own header, and the console repeats it on
            # screen beside the figure rather than leaving it in a docstring.
            "spend_now": spend.state().as_dict(),
            "ceiling_usd": spend.ceiling_usd(),
        }

    @router.get("/economics")
    def economics(ctx: CanRead, days: int = _DAYS, plan: str = _PLAN) -> dict[str, Any]:
        """What a 1x day costs, split by what consumed it — the owner's pacing question.

        Straight from :mod:`wobo_gateway.unit_economics`, which already carries its own ``gaps``
        list: every reason the derivation is incomplete, in words. Those go to the screen intact.
        A derivation with gaps is a floor, never a bill, and both halves travel together.
        """
        since, until = window(days)
        rows = ledger.read_daily(since=since, until=until)
        derivation = unit_economics.derive(rows, plan=plan)
        ctx.audit(
            "console.economics.read",
            resource_type="usage_daily",
            detail={"since": since.isoformat(), "until": until.isoformat(), "plan": plan},
        )
        return {
            "since": since.isoformat(),
            "until": until.isoformat(),
            # THE DERIVATION'S OWN PLAN, not the string the caller typed. ``budget.limits_for``
            # falls back to the free plan's dials for a name it does not know, so echoing the
            # request meant a free-plan figure could go out labelled "plus". The derivation
            # resolves the name and adds a gap saying so; this echoes what was actually priced.
            "plan": derivation.plan,
            "asked_plan": plan,
            **derivation.as_dict(),
            # The same two honesty fields the usage envelope carries. ``derive_window`` read the
            # ledger without them, so the pricing desk — the one an owner prices a plan from — had
            # no way to know a batch of rows never landed, or how stale the rollup behind it is.
            "ledger": ledger.state(),
            "rolled_at": rolled_at(rows),
            "rollup_interval_s": ledger.rollup_interval_s(),
        }

    @router.get("/stores")
    def stores(ctx: CanRead) -> dict[str, Any]:
        """The stores desk (docs/CACHES.md §4): hit rates, rows, and the spend a serve saved.

        TWO READINGS OF THE SAME THING, AND THEY DISAGREE BY DESIGN, exactly as ``/usage`` shows
        the rollup beside the live ceiling:

        * ``process`` is what THIS container has seen since it started — how often the file front
          answered, how often Postgres did, how often neither did and somebody paid for a
          generation. It is per-process and a deploy resets it, which is the point: it is the
          answer to "is the cache working right now".
        * ``stored`` is ``content.store_savings``, which survives everything: how many rows each
          store holds, how many times they have been served, and the money the serves after the
          first did not spend.

        A ``stored`` of ``null`` means the view could not be read at all, and the screen must say
        "we cannot see" rather than draw a table of zeroes — a cache reported as empty and a cache
        reported as unreachable are different facts and only one of them is an emergency.
        """
        from wobo_gateway.plexus import db as stores_db

        ctx.audit("console.stores.read", resource_type="content_stores")
        return {"process": stores_db.state(), "stored": stores_db.savings()}

    @router.get("/health")
    def gateway_health(ctx: CanRead) -> dict[str, Any]:
        """The same snapshot ``/healthz`` serves, read through the door so the look is audited.

        ``/healthz`` is public and the console could read it directly. It does not, for two
        reasons: a request through the guard proves the console's own session still works (an
        expired session shows as a locked console, not as a health panel that keeps refreshing),
        and every operator read leaves a trail, including the harmless ones.
        """
        ctx.audit("console.health.read", resource_type="health")
        return health.snapshot()

    app.include_router(router)


__all__ = [
    "DEFAULT_WINDOW_DAYS",
    "MAX_WINDOW_DAYS",
    "register_console",
    "rolled_at",
    "window",
]
