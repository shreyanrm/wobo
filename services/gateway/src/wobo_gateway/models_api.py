"""The models desk and the pace desk: what answers what, at what price, changed from one place.

``docs/CONSOLE-MODELS.md`` and ``docs/ALLOWANCE.md`` §3. The owner's two sentences are the whole
brief: *"in the superadmin make sure I see what models are being used for what, and an option to
change them from there, so I can control the content quality and the costing from one place"*, and
*"in the superadmin I decide how generous I want to be ... 500 is just a start; we watch the
pace."*

**Four routes, and the seat each one needs.**

============================================  ==============  =========================
``GET  /v1/admin/models``                     console.read    the table, the prices, the
                                                              spend, who is carrying, the ladder
``POST /v1/admin/models``                     admin.manage    move a tier, the ladder, or
                                                              back to the owner's table
``GET  /v1/admin/allowance``                  console.read    the dials, their live effect,
                                                              and the pace
``POST /v1/admin/allowance``                  admin.manage    turn the money dials
``POST /v1/admin/settings/apply``             admin.manage    re-read every dial NOW
============================================  ==============  =========================

Reading the money is the viewer seat; changing what a child is served and what it costs is the
owner's, and ``admin.manage`` is the only permission only an owner carries
(``admin_auth.PERMISSIONS``). It is also a WRITE permission, so the guard has already demanded a
step-up inside the reauth window before any of the three POSTs is reached.

**Nothing here is invented.** Every number is a sum over ``ops.usage_daily`` or a value from
``routing.CATALOGUE``; where the ledger could not be reached the answer carries ``readable:
false`` and NO figures, because a zero is a claim ("nothing was spent") and an unreachable console
is the opposite claim. The three things this desk genuinely cannot see — the judge's pass rate per
rung, a learner's local hour, and the provider's own bill — each say so in words, in the place a
number would otherwise sit.

**The desk shows what the gateway is USING, not what the desk holds.** An env variable beats a
dial (``docs/CONSOLE-MODELS.md`` §2), so every tier row carries ``source`` (``env`` | ``desk`` |
``default``) and, when they differ, the desk's own value beside the one in force. A console that
showed a saved value the gateway was ignoring would be worse than a console with no value on it.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from wobo_gateway import dials, health, ledger, pace, pools, registry, routing, spend
from wobo_gateway.admin_auth import (
    ADMIN_MANAGE,
    CONSOLE_READ,
    AdminContext,
    admin_router,
    requires,
)
from wobo_gateway.routing import CATALOGUE, Tier

#: How far back the ladder's "how often was each rung reached" looks. The document says a week.
LADDER_WINDOW_DAYS = 7
#: The window the per-tier spend table covers. Today and yesterday are called out by name
#: (CONSOLE-MODELS §1), and the rest is there so "unusual" has a normal to be unusual against.
SPEND_WINDOW_DAYS = 30

#: The rung whose pass rate nobody can read yet, in the words that go on the screen.
JUDGE_NOT_KNOWN = (
    "The judge's verdicts are written to the telemetry stream (gateway.escalation) and to no "
    "table, so the pass rate per rung cannot be counted here. A rejection count on ops.model_calls "
    "beside the rung that was rejected is what would fill it."
)

#: Where the money truly is, said on the desk rather than in a doc nobody opens beside it.
RECONCILE_NOTE = (
    "The provider dashboards remain the authority for the bill. These figures are the gateway's "
    "own ledger, they are a floor while any call is unpriced, and the rollup can be a quarter of "
    "an hour behind."
)


# --- the bodies ------------------------------------------------------------------------------------
class ModelsBody(BaseModel):
    """One change to the routing table, or a reset of every change.

    ``chain`` is the tier's FALLBACKS, in order, which is exactly what ``WOBO_TIER_<T>_CHAIN``
    means; the primary is its own field. ``preview`` computes the price difference and saves
    nothing, which is the control CONSOLE-MODELS §2 asks for ("previewed before saving").
    """

    tier: str | None = Field(default=None, max_length=32)
    primary: str | None = Field(default=None, max_length=128)
    chain: list[str] | None = Field(default=None, max_length=8)
    ladder: list[str] | None = Field(default=None, max_length=8)
    reset: bool = False
    preview: bool = False
    note: str | None = Field(default=None, max_length=280)


class AllowanceBody(BaseModel):
    """The money dials. Every one is checked against the document that gave it its range."""

    generosity: dict[str, float] | None = None
    free_daily_paise: int | None = None
    inr_per_usd: float | None = None
    creative_pool_usd: float | None = None
    free_pool_paise: int | None = None
    preview: bool = False
    note: str | None = Field(default=None, max_length=280)


def _refused(code: str, message: str, status: int = 422) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _iso(moment: datetime | None) -> str | None:
    return moment.astimezone(UTC).isoformat() if moment else None


# --- sums over the rollup ---------------------------------------------------------------------------
def tier_of(capability: str) -> str:
    """Which tier a capability rides. A name the registry does not know is said to be unknown."""
    try:
        return registry.policy(capability).tier.value
    except KeyError:
        return "unknown"


def jobs_on(tier: str) -> list[str]:
    """The capabilities that ride a tier, from ``registry.py``. The desk's "jobs on it" column."""
    return sorted(name for name in registry.capabilities() if tier_of(name) == tier)


def _blank() -> dict[str, Any]:
    return {"calls": 0, "cost_usd": 0.0, "cache_hits": 0, "unpriced_calls": 0, "tokens_in": 0, "tokens_out": 0}


def _add(into: dict[str, Any], row: dict[str, Any]) -> None:
    into["calls"] += int(row.get("calls") or 0)
    into["cost_usd"] = round(into["cost_usd"] + float(row.get("cost_usd") or 0.0), 6)
    into["cache_hits"] += int(row.get("cache_hits") or 0)
    into["unpriced_calls"] += int(row.get("unpriced_calls") or 0)
    into["tokens_in"] += int(row.get("tokens_in") or 0)
    into["tokens_out"] += int(row.get("tokens_out") or 0)


def group(rows: list[dict[str, Any]], key: str) -> dict[str, dict[str, Any]]:
    """Sum the rollup by one of its own columns, or by ``tier``, which is derived from capability."""
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = tier_of(str(row.get("capability") or "")) if key == "tier" else str(row.get(key) or "")
        _add(out.setdefault(name, _blank()), row)
    return out


def payer_of(row: dict[str, Any]) -> str:
    """Who paid for this row: the creative pool, a plan, or a stranger.

    docs/ALLOWANCE.md, "Who pays for what". A platform-paid capability is the pool's whatever plan
    the learner who triggered it is on — that is the whole point of the ruling — so this is asked
    BEFORE the plan is looked at.
    """
    if registry.platform_paid(str(row.get("capability") or "")):
        return "creative_pool"
    plan = str(row.get("plan") or "unknown").strip().lower()
    if plan in {"free", "plus", "pro", "max"}:
        return plan
    if plan in {"anon", "anonymous", "unknown", ""}:
        return "strangers"
    return plan


def by_payer(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        _add(out.setdefault(payer_of(row), _blank()), row)
    return out


def _on_day(rows: list[dict[str, Any]], day: date) -> list[dict[str, Any]]:
    stamp = day.isoformat()
    return [row for row in rows if str(row.get("day")) == stamp]


def _hit_rate(totals: dict[str, Any]) -> float | None:
    """Cache hits over calls, or None when nothing was called. Never 0.0 for "we do not know"."""
    calls = int(totals.get("calls") or 0)
    return round(int(totals.get("cache_hits") or 0) / calls, 4) if calls else None


def price_view(model: str) -> dict[str, Any] | None:
    price = CATALOGUE.get(model)
    if price is None:
        return None
    return {
        "per_million_in": price.per_million_in,
        "per_million_out": price.per_million_out,
        "page": price.page,
        "note": price.note,
    }


def price_preview(
    rows: list[dict[str, Any]] | None,
    *,
    tier: str,
    current: str,
    proposed: str,
    day: date,
) -> dict[str, Any]:
    """The price difference at yesterday's volume, per CONSOLE-MODELS §2.

    Priced from ``routing.token_cost``, which is the vendor's own per-million rate, over the tokens
    the tier ACTUALLY moved yesterday. Unreadable rather than estimated when the ledger could not
    be reached, when the tier did nothing yesterday, or when either id is not priced per token
    (voice and imagery are priced per unit received, and a token figure for them would be a guess).
    """
    view: dict[str, Any] = {
        "tier": tier,
        "from": current,
        "to": proposed,
        "day": day.isoformat(),
        "readable": False,
        "why": None,
    }
    if rows is None:
        view["why"] = "The ledger could not be reached, so there is no volume to price this on."
        return view
    on_tier = [row for row in _on_day(rows, day) if tier_of(str(row.get("capability") or "")) == tier]
    totals = _blank()
    for row in on_tier:
        _add(totals, row)
    if totals["calls"] == 0:
        view["why"] = "Nothing ran on this tier that day, so there is no volume to price it on."
        return view
    now_usd = routing.token_cost(current, totals["tokens_in"], totals["tokens_out"])
    then_usd = routing.token_cost(proposed, totals["tokens_in"], totals["tokens_out"])
    if now_usd is None or then_usd is None:
        unpriced = current if now_usd is None else proposed
        view["why"] = (
            f"{unpriced} is not priced per token — the seam that calls it prices the unit the "
            "learner received — so the two cannot be compared this way."
        )
        return view
    per_thousand = 1000.0 / totals["calls"]
    view.update(
        {
            "readable": True,
            "calls": totals["calls"],
            "tokens_in": totals["tokens_in"],
            "tokens_out": totals["tokens_out"],
            "now_usd": round(now_usd, 6),
            "then_usd": round(then_usd, 6),
            "delta_usd": round(then_usd - now_usd, 6),
            "per_thousand_calls": {
                "now_usd": round(now_usd * per_thousand, 6),
                "then_usd": round(then_usd * per_thousand, 6),
                "delta_usd": round((then_usd - now_usd) * per_thousand, 6),
            },
        }
    )
    return view


# --- the two views ---------------------------------------------------------------------------------
def models_view(rows: list[dict[str, Any]] | None, *, today: date | None = None) -> dict[str, Any]:
    """The whole table, live, with the price, the jobs, the spend and who is carrying it."""
    dials.maybe_refresh()
    now = today or datetime.now(UTC).date()
    yesterday = now - timedelta(days=1)
    readable = rows is not None
    on_hand = rows or []
    spend_today = group(_on_day(on_hand, now), "tier")
    spend_yesterday = group(_on_day(on_hand, yesterday), "tier")
    carrying = health.carriers()

    tiers: list[dict[str, Any]] = []
    for tier in Tier:
        name = tier.value
        chain = routing.tier_chain(tier)
        desk = dials.desk_value_for_tier(name)
        jobs = jobs_on(name)
        tiers.append(
            {
                "tier": name,
                "jobs": jobs,
                "platform_paid_jobs": sorted(j for j in jobs if registry.platform_paid(j)),
                "primary": chain[0],
                "fallbacks": list(chain[1:]),
                "chain": list(chain),
                "price": price_view(chain[0]),
                # Who is answering right now, with the provider marks applied (health.py). None
                # means every rung is out and a call on this tier would not be served.
                "carrying": carrying.get(name),
                "source": dials.source_for_tier(name),
                "desk_value": desk["primary"],
                "desk_chain": desk["chain"],
                "spend_today": spend_today.get(name) if readable else None,
                "spend_yesterday": spend_yesterday.get(name) if readable else None,
            }
        )

    ladder_rungs = list(dials.ladder())
    ladder_since = now - timedelta(days=LADDER_WINDOW_DAYS - 1)
    generate_rows = [
        row
        for row in on_hand
        if tier_of(str(row.get("capability") or "")) == "generate"
        and str(row.get("day")) >= ladder_since.isoformat()
    ]
    reached = group(generate_rows, "model_served") if readable else {}

    pool_rows = [row for row in _on_day(on_hand, now) if registry.platform_paid(str(row.get("capability") or ""))]
    pool_today = _blank()
    for row in pool_rows:
        _add(pool_today, row)
    cap_usd = dials.creative_pool_usd()

    return {
        "readable": readable,
        "since": (now - timedelta(days=SPEND_WINDOW_DAYS - 1)).isoformat(),
        "until": now.isoformat(),
        "tiers": tiers,
        "ladder": {
            "rungs": ladder_rungs,
            "source": "env" if routing.LADDER_ENV in _environ_names() else dials.source_for_tier("generate"),
            "since": ladder_since.isoformat(),
            "reached": (
                [
                    {"model": model, **totals}
                    for model, totals in sorted(reached.items(), key=lambda item: item[0])
                ]
                if readable
                else None
            ),
            # Nobody counts this yet, and the desk says which piece of work would make it a number.
            "judge_pass_rate": None,
            "judge_not_known": JUDGE_NOT_KNOWN,
        },
        "creative_pool": {
            "cap_usd": cap_usd,
            "spent_today_usd": pool_today["cost_usd"] if readable else None,
            "created_today": pool_today["calls"] if readable else None,
            "cache_hit_rate": _hit_rate(pool_today) if readable else None,
            "fraction": (
                round(pool_today["cost_usd"] / cap_usd, 4) if readable and cap_usd > 0 else None
            ),
            "alert_fractions": list(dials.ALERT_FRACTIONS),
            "capabilities": sorted(registry.PLATFORM_PAID),
            # THE FIGURE THE CAP IS ACTUALLY ENFORCED AGAINST (``pools.py``). Everything above
            # is the ledger's rollup, which can be a quarter of an hour behind; this is the
            # in-process accumulator that raises the 50/80/100 alarms and, for the free pool,
            # closes the lane. They disagree by design, exactly as the platform ceiling and the
            # rollup already do on the spend desk, and the desk shows both with their own names
            # rather than quietly picking one.
            "live": pools.creative_state().as_dict(),
        },
        "spend": {
            "by_tier": spend_today if readable else None,
            "by_model": group(_on_day(on_hand, now), "model_served") if readable else None,
            "by_capability": group(_on_day(on_hand, now), "capability") if readable else None,
            "by_payer": by_payer(_on_day(on_hand, now)) if readable else None,
            "window": group(on_hand, "tier") if readable else None,
            "live_ceiling": spend.state().as_dict(),
            "ceiling_usd": spend.ceiling_usd(),
        },
        # The closed list, so a screen cannot offer an id this gateway would refuse.
        "catalogue": {model: price_view(model) for model in sorted(CATALOGUE)},
        "dials": {
            "applied_at": _iso(dials.applied_at()),
            "refresh_interval_s": dials.refresh_interval_s(),
            "rejected": dials.rejected(),
        },
        "ledger": ledger.state(),
        "rolled_at": _rolled_at(on_hand),
        "rollup_interval_s": ledger.rollup_interval_s(),
        "reconcile": RECONCILE_NOTE,
    }


def _environ_names() -> set[str]:
    import os

    return {name for name in os.environ if name.startswith("WOBO_")}


def _rolled_at(rows: list[dict[str, Any]]) -> str | None:
    stamps = [str(row["rolled_at"]) for row in rows if row.get("rolled_at")]
    return max(stamps) if stamps else None


def allowance_view(*, today: date | None = None) -> dict[str, Any]:
    """The money dials, their live effect, and the pace across learners."""
    dials.maybe_refresh()
    now = today or datetime.now(UTC).date()
    rate = dials.inr_per_usd()

    def allowance_for(plan: str) -> int:
        return dials.daily_allowance_paise(plan, today=now)

    free_pool = dials.free_pool_paise()
    return {
        "day": now.isoformat(),
        "generosity": dials.generosity(),
        "free_daily_paise": dials.free_daily_paise(),
        "free_daily": dials.rupees(dials.free_daily_paise()),
        "inr_per_usd": rate,
        "inr_rate_set_at": _iso(dials.changed_at(dials.INR_RATE_KEY)),
        "creative_pool_usd": dials.creative_pool_usd(),
        "free_pool_paise": free_pool,
        "free_pool": dials.rupees(free_pool) if free_pool is not None else None,
        # The day's goodwill as it actually stands, and the line docs/ALLOWANCE.md "Best of both
        # worlds" point 4 asks for: what every free learner together has cost the platform today,
        # against the cap, with the same 50/80/100 alarms. ``fraction`` is None when no cap is
        # set — not zero, which would read as "none of it used" rather than "nothing to use it
        # against" — and the lane is never closed until the owner turns that dial.
        "free_pool_today": pools.free_state().as_dict(),
        "creative_pool_today": pools.creative_state().as_dict(),
        "alert_fractions": list(dials.ALERT_FRACTIONS),
        "days_in_month": dials.days_in(now),
        "effect": dials.allowance_effect(today=now),
        "pace": pace.view(
            pace.read_day(now), allowance_paise=allowance_for, inr_per_usd=rate, day=now
        ),
        "applied_at": _iso(dials.applied_at()),
        "refresh_interval_s": dials.refresh_interval_s(),
        # Money is INTERNAL ONLY (docs/ALLOWANCE.md §5). This is the console; nothing on this
        # object may ever be served to a learner or a parent surface.
        "internal_only": True,
        "reconcile": RECONCILE_NOTE,
    }


# --- the routes -------------------------------------------------------------------------------------
def register_models_desk(app: FastAPI) -> None:
    """Mount the models and allowance desks. Called once from ``app.create_app``."""
    router = admin_router(tags=["admin", "models"])

    def _rollup(days: int) -> list[dict[str, Any]] | None:
        """The window, or ``None`` when the ledger could not be asked.

        Nothing may escape onto an operator's request thread: a transport that throws in an
        unexpected shape has to show as "we could not ask", which is a real answer, rather than as
        a 500 with a stack trace on a page about money.
        """
        until = datetime.now(UTC).date()
        try:
            return ledger.read_daily(since=until - timedelta(days=days - 1), until=until)
        except Exception:  # noqa: BLE001 — see the docstring
            return None

    @router.get("/models")
    def models(ctx: AdminContext = Depends(requires(CONSOLE_READ))) -> dict[str, Any]:
        """The router's whole table, live, with the vendor's price beside every id."""
        ctx.audit("models.desk.read", resource_type="routing")
        return models_view(_rollup(SPEND_WINDOW_DAYS))

    @router.post("/models")
    def set_models(
        body: ModelsBody, ctx: AdminContext = Depends(requires(ADMIN_MANAGE))
    ) -> dict[str, Any]:
        """Move a tier, move the ladder, or put every override back. Owner only, audited.

        The effect is previewed before it is saved when ``preview`` is set, and the preview writes
        nothing at all: a price difference an owner reads and then walks away from must leave the
        table exactly as it was.
        """
        if body.reset:
            ctx.audit("models.reset", resource_type="routing", detail={"note": body.note})
            cleared = dials.clear_tier_overrides(actor=ctx.admin.subject_id, note=body.note)
            return {"saved": True, "cleared": cleared, **models_view(_rollup(SPEND_WINDOW_DAYS))}

        if body.ladder is not None:
            try:
                if body.preview:
                    return {"saved": False, "preview": None, **models_view(_rollup(SPEND_WINDOW_DAYS))}
                ctx.audit(
                    "models.set",
                    resource_type="routing",
                    resource_id="generation.ladder",
                    detail={"ladder": body.ladder, "note": body.note},
                )
                dials.set_ladder(body.ladder, actor=ctx.admin.subject_id, note=body.note)
            except dials.UnknownModel as exc:
                raise _refused("not_a_model", str(exc)) from exc
            return {"saved": True, **models_view(_rollup(SPEND_WINDOW_DAYS))}

        name = (body.tier or "").strip().lower()
        if name not in {tier.value for tier in Tier}:
            raise _refused("not_a_tier", f"{body.tier!r} is not a tier this router has")
        if body.primary is None and body.chain is None:
            raise _refused("nothing_to_do", "Name a primary, a chain, or both.")

        rows = _rollup(SPEND_WINDOW_DAYS)
        current = routing.tier_chain(Tier(name))[0]
        proposed = body.primary or current
        preview = price_preview(
            rows,
            tier=name,
            current=current,
            proposed=proposed,
            day=datetime.now(UTC).date() - timedelta(days=1),
        )
        if body.preview:
            # Nothing written, nothing audited as a change: a look is a read.
            ctx.audit(
                "models.preview",
                resource_type="routing",
                resource_id=name,
                detail={"from": current, "to": proposed},
            )
            return {"saved": False, "preview": preview, **models_view(rows)}

        ctx.audit(
            "models.set",
            resource_type="routing",
            resource_id=name,
            detail={
                "from": current,
                "primary": body.primary,
                "chain": body.chain,
                "note": body.note,
            },
        )
        try:
            dials.set_tier(
                name,
                primary=body.primary,
                chain=body.chain,
                actor=ctx.admin.subject_id,
                note=body.note,
            )
        except dials.UnknownModel as exc:
            raise _refused("not_a_model", str(exc)) from exc
        return {"saved": True, "preview": preview, **models_view(rows)}

    @router.get("/allowance")
    def allowance(ctx: AdminContext = Depends(requires(CONSOLE_READ))) -> dict[str, Any]:
        """Generosity, the free rupees, the rate, their live effect, and the pace."""
        ctx.audit("allowance.desk.read", resource_type="ops.settings")
        return allowance_view()

    @router.post("/allowance")
    def set_allowance(
        body: AllowanceBody, ctx: AdminContext = Depends(requires(ADMIN_MANAGE))
    ) -> dict[str, Any]:
        """Turn the money dials. Owner only, audited, applied without a deploy.

        ``preview`` computes "a Pro learner gets ₹X a day" from the PROPOSED dials and saves
        nothing, which is what docs/ALLOWANCE.md §3 means by "with the effect shown live before it
        is saved".
        """
        if body.preview:
            ctx.audit("allowance.preview", resource_type="ops.settings")
            return {"saved": False, "preview": _effect_of(body), **allowance_view()}
        try:
            ctx.audit(
                "allowance.set",
                resource_type="ops.settings",
                detail={
                    "generosity": body.generosity,
                    "free_daily_paise": body.free_daily_paise,
                    "inr_per_usd": body.inr_per_usd,
                    "creative_pool_usd": body.creative_pool_usd,
                    "free_pool_paise": body.free_pool_paise,
                    "note": body.note,
                },
            )
            dials.set_allowance(
                generosity=body.generosity,
                free_daily_paise=body.free_daily_paise,
                inr_per_usd=body.inr_per_usd,
                creative_pool_usd=body.creative_pool_usd,
                free_pool_paise=body.free_pool_paise,
                actor=ctx.admin.subject_id,
                note=body.note,
            )
        except dials.BadDial as exc:
            raise _refused("not_a_dial", str(exc)) from exc
        return {"saved": True, **allowance_view()}

    @router.post("/settings/apply")
    def apply_settings(ctx: AdminContext = Depends(requires(ADMIN_MANAGE))) -> dict[str, Any]:
        """Re-read every dial NOW rather than at the end of the interval.

        A dial turned in the SQL editor is followed within ``DIALS_REFRESH_S`` anyway; this is the
        button for the minute an operator does not want to wait, and the proof on the screen that
        the gateway's view and the table's agree.
        """
        ctx.audit("settings.apply", resource_type="ops.settings")
        dials.apply(force=True)
        return {
            "applied_at": _iso(dials.applied_at()),
            "refresh_interval_s": dials.refresh_interval_s(),
            "rejected": dials.rejected(),
            "tiers": {tier.value: routing.tier_chain(tier)[0] for tier in Tier},
            "ladder": list(dials.ladder()),
        }

    app.include_router(router)


def _effect_of(body: AllowanceBody) -> list[dict[str, Any]]:
    """"A Pro learner gets ₹X a day" for dials that have NOT been saved.

    Computed by arithmetic here rather than by writing the dials and reading them back, because a
    preview that saved first would be a save.
    """
    today = datetime.now(UTC).date()
    days = dials.days_in(today)
    generosity = {**dials.generosity(), **{k.lower(): float(v) for k, v in (body.generosity or {}).items()}}
    free = body.free_daily_paise if body.free_daily_paise is not None else dials.free_daily_paise()
    rows: list[dict[str, Any]] = [
        {
            "plan": "free",
            "period": None,
            "plan_amount_paise": 0,
            "generosity": None,
            "daily_paise": int(free),
            "a_day": dials.rupees(int(free)),
        }
    ]
    for plan in ("pro", "max"):
        for period in ("monthly", "yearly"):
            amount = dials.plan_amount_paise(plan, period)
            if amount is None:
                continue
            daily = int(round(amount * generosity.get(plan, 0.0) / days))
            rows.append(
                {
                    "plan": plan,
                    "period": period,
                    "plan_amount_paise": amount,
                    "generosity": generosity.get(plan),
                    "daily_paise": daily,
                    "a_day": dials.rupees(daily),
                }
            )
    return rows


__all__ = [
    "JUDGE_NOT_KNOWN",
    "LADDER_WINDOW_DAYS",
    "RECONCILE_NOTE",
    "SPEND_WINDOW_DAYS",
    "allowance_view",
    "by_payer",
    "group",
    "jobs_on",
    "models_view",
    "payer_of",
    "price_preview",
    "price_view",
    "register_models_desk",
    "tier_of",
]
