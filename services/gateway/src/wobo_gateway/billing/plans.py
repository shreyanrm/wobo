"""The four plans we sell, to the paisa, and the command that creates them at the provider once.

``docs/PRICING.md`` is the canonical table and this file is its mirror in paise: Pro is ₹1,999 a
month or ₹19,992 a year, Max is ₹3,999 a month or ₹39,996 a year, and a year costs ten months.
``test_razorpay.py`` parses that document and compares every figure here to it, so a price that
moves in one place and not the other fails the build rather than a learner.

**The command.** ``uv run python -m wobo_gateway.billing.plans`` creates the four Razorpay plans
(``POST /v1/plans``) and writes their ids into ``ops.billing_config`` under
:data:`CONFIG_KEY`. It is idempotent: it lists the plans already at the provider
(``GET /v1/plans``) and reuses any whose ``notes.wobo_key`` names one of ours AND whose amount,
currency and period still match, so running it twice creates nothing twice, and changing a price
in PRICING.md then running it creates the new plan beside the old one and points the config at
the new. Razorpay plans cannot be edited or deleted, which is why the match is on the numbers and
not only on the name. ``--dry-run`` prints what would be created and touches nothing.

Nothing here ever prints a secret. The key id is printed by presence ("present") and the secret
only by length, which is how ``validate_env`` reports keys too.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from wobo_gateway.billing import razorpay, records

logger = logging.getLogger("wobo.gateway.billing.plans")

CONFIG_KEY = "razorpay_plans"
CURRENCY = "INR"
PLANS: tuple[str, ...] = ("pro", "max")
PERIODS: tuple[str, ...] = ("monthly", "yearly")
#: The billing cycles a subscription is created for (``total_count`` is mandatory at the
#: provider and there is no "until cancelled"). Five years either way; a learner who is still
#: here in five years is a learner we will happily ask to start again.
TOTAL_COUNT: dict[str, int] = {"monthly": 60, "yearly": 5}


@dataclass(frozen=True)
class PlanSpec:
    key: str
    plan: str
    period: str
    amount_paise: int
    name: str
    description: str
    interval: int = 1
    currency: str = CURRENCY

    def body(self) -> dict[str, Any]:
        """Exactly the request ``POST /v1/plans`` documents."""
        return {
            "period": self.period,
            "interval": self.interval,
            "item": {
                "name": self.name,
                "amount": self.amount_paise,
                "currency": self.currency,
                "description": self.description,
            },
            "notes": {"wobo_key": self.key, "wobo_plan": self.plan, "wobo_period": self.period},
        }


def _spec(plan: str, period: str, rupees: int) -> PlanSpec:
    label = plan.capitalize()
    every = "a month, billed monthly" if period == "monthly" else "a year, billed once a year"
    return PlanSpec(
        key=f"{plan}_{period}",
        plan=plan,
        period=period,
        amount_paise=rupees * 100,
        name=f"Wobo {label}, {period}",
        description=f"Wobo {label} for one learner, {every}.",
    )


#: docs/PRICING.md, the "Billed" column, in rupees. THE ONLY PLACE THESE FOUR NUMBERS APPEAR in
#: the gateway; the test holds them against the document.
CATALOGUE: dict[str, PlanSpec] = {
    spec.key: spec
    for spec in (
        _spec("pro", "monthly", 1_999),
        _spec("pro", "yearly", 19_992),
        _spec("max", "monthly", 3_999),
        _spec("max", "yearly", 39_996),
    )
}


def spec_for(plan: str, period: str) -> PlanSpec | None:
    return CATALOGUE.get(f"{(plan or '').strip().lower()}_{(period or '').strip().lower()}")


def amount_display(plan: str, period: str) -> str:
    """The total the learner is agreeing to, in the words PRICING.md uses at checkout."""
    spec = spec_for(plan, period)
    if spec is None:
        raise ValueError(f"not a plan we sell: {plan} {period}")
    rupees = spec.amount_paise // 100
    words = "billed annually" if spec.period == "yearly" else "billed monthly"
    return f"₹{rupees:,} {words}"


def total_count(period: str) -> int:
    return TOTAL_COUNT.get(period, TOTAL_COUNT["monthly"])


# --- the ids ------------------------------------------------------------------------------------
def plan_ids(ledger: records.BillingRecords) -> dict[str, str] | None:
    """The four ids from the config, or ``None`` when the command has not been run (or the config
    is missing one). Half a catalogue is not a catalogue: checkout answers payments_off."""
    found = ledger.get_config(CONFIG_KEY)
    if not isinstance(found, dict):
        return None
    ids = {key: str(found.get(key) or "").strip() for key in CATALOGUE}
    if not all(ids.values()):
        return None
    return ids


def key_of_plan_id(plan_id: str | None, ids: dict[str, str] | None) -> PlanSpec | None:
    """Which of ours a provider plan id is, for a webhook whose notes did not say."""
    if not plan_id or not ids:
        return None
    for key, known in ids.items():
        if known == plan_id:
            return CATALOGUE.get(key)
    return None


def _matches(item: dict[str, Any], spec: PlanSpec) -> bool:
    inner = item.get("item") if isinstance(item.get("item"), dict) else {}
    return (
        item.get("period") == spec.period
        and int(item.get("interval") or 0) == spec.interval
        and int(inner.get("amount") or -1) == spec.amount_paise
        and str(inner.get("currency") or "") == spec.currency
    )


def existing_plans(provider: razorpay.Provider) -> dict[str, str]:
    """Every plan at the provider that is one of ours, by key. Pages through ``GET /v1/plans``."""
    found: dict[str, str] = {}
    skip = 0
    while True:
        page = provider.list_plans(count=razorpay.PLAN_PAGE, skip=skip)
        items = page.get("items") if isinstance(page, dict) else None
        items = [i for i in (items or []) if isinstance(i, dict)]
        for item in items:
            notes = item.get("notes") if isinstance(item.get("notes"), dict) else {}
            key = str(notes.get("wobo_key") or "")
            spec = CATALOGUE.get(key)
            if spec is None or key in found or not item.get("id"):
                continue
            if _matches(item, spec):
                found[key] = str(item["id"])
        if len(items) < razorpay.PLAN_PAGE:
            return found
        skip += razorpay.PLAN_PAGE


def ensure_plans(provider: razorpay.Provider, ledger: records.BillingRecords) -> dict[str, str]:
    """Create what is missing, reuse what is there, write the ids down. Idempotent."""
    ids = existing_plans(provider)
    for key, spec in CATALOGUE.items():
        if key in ids:
            logger.info("razorpay plan reused", extra={"fields": {"key": key, "id": ids[key]}})
            continue
        created = provider.create_plan(spec.body())
        plan_id = str(created.get("id") or "")
        if not plan_id.startswith("plan_"):
            raise razorpay.RazorpayError(0, "bad_answer", f"no plan id came back for {key}")
        ids[key] = plan_id
        logger.info("razorpay plan created", extra={"fields": {"key": key, "id": plan_id}})
    ledger.set_config(CONFIG_KEY, ids)
    return ids


# --- the command --------------------------------------------------------------------------------
def _print_catalogue() -> None:
    print("The four plans, from docs/PRICING.md (amounts in paise):")
    for spec in CATALOGUE.values():
        print(
            f"  {spec.key:<12} {spec.period:<8} {spec.amount_paise:>9}  "
            f"({amount_display(spec.plan, spec.period)})"
        )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m wobo_gateway.billing.plans",
        description="Create the four Razorpay plans once and record their ids.",
    )
    parser.add_argument("--dry-run", action="store_true", help="print the catalogue; touch nothing")
    args = parser.parse_args(list(argv) if argv is not None else sys.argv[1:])

    _print_catalogue()
    if args.dry_run:
        print("Dry run: nothing was created and nothing was written.")
        return 0

    if not razorpay.keys_present():
        secret_len = len((os.getenv(razorpay.KEY_SECRET_ENV) or "").strip())
        print(
            f"{razorpay.KEY_ID_ENV} and {razorpay.KEY_SECRET_ENV} must both be set "
            f"(key id: {'present' if razorpay.key_id() else 'missing'}; "
            f"secret: {secret_len} characters). Nothing was created."
        )
        return 2
    provider = razorpay.get_client()
    ledger = records.get_store()
    if provider is None or isinstance(ledger, records.UnconfiguredBillingRecords):
        print(
            "No place to record the plan ids: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
            "(migration 0023 must be applied). Nothing was created."
        )
        return 2
    try:
        ids = ensure_plans(provider, ledger)
    except razorpay.RazorpayError as exc:
        print(f"The provider refused: {exc}. Nothing was written.")
        return 1
    except records.RecordsUnavailable as exc:
        print(f"The plans may exist at the provider but the ids could not be recorded: {exc}")
        return 1
    print(f"Recorded under ops.billing_config[{CONFIG_KEY!r}]:")
    for key, plan_id in ids.items():
        print(f"  {key:<12} {plan_id}")
    return 0


if __name__ == "__main__":  # pragma: no cover - the command line
    raise SystemExit(main())


__all__ = [
    "CATALOGUE",
    "CONFIG_KEY",
    "PERIODS",
    "PLANS",
    "TOTAL_COUNT",
    "PlanSpec",
    "amount_display",
    "ensure_plans",
    "existing_plans",
    "key_of_plan_id",
    "main",
    "plan_ids",
    "spec_for",
    "total_count",
]
