"""Checkout and the provider's webhook: where a plan is bought, and where we learn it was paid for.

Two routes a learner's app calls or the provider calls, and one desk behind the console door:

* ``POST /v1/billing/checkout`` ``{plan, period}`` — for the signed-in learner, creates a provider
  subscription with the learner's id in its ``notes`` and answers what the browser's checkout
  needs: ``subscription_id``, the public ``key_id``, the plan, the period and the total being
  agreed to (``amount_display``, which is where docs/PRICING.md says the annual total appears).
  **It writes nothing to the subscription row.** A checkout is an intention; the plan flips on
  evidence of money, below. **One payable subscription per learner**: before it creates one it
  reads the learner's newest ``checkout`` ledger row and asks the provider what became of that
  subscription. Still ``created`` for the same plan and period: the same id is offered again.
  ``authenticated`` / ``active`` / ``pending`` / ``halted``: money has moved or is moving and the
  webhook has not landed yet, so the answer is 409 and the honest line, never a second bill.
  Closed (``cancelled`` / ``completed`` / ``expired``) or for another plan: a new one, with
  ``expire_by`` a day out so an abandoned checkout does not stay payable for thirty years.
* ``POST /v1/billing/razorpay/webhook`` — open to the world, because the provider is not a
  learner, and safe because nothing is read from the body until the signature over the raw bytes
  has been checked (:func:`wobo_gateway.billing.razorpay.verify_webhook_signature`). A wrong or
  missing signature is 400 and a log line. Each DELIVERY is processed once, keyed on the SHA-256
  of the signed bytes (the ledger, :mod:`wobo_gateway.billing.records`): the
  ``X-Razorpay-Event-Id`` header is not covered by the signature, so it is logged and never
  trusted as the identity of anything. Then :func:`apply_event` maps the event onto the row:

  ============================ =====================================================
  ``subscription.activated``   the row: plan, period, ``active``, period end from ``current_end``
  ``subscription.charged``     the same; the period end moves forward
  ``subscription.cancelled``   ``cancelled`` with a time; the period end is NOT touched
  ``subscription.pending``     ``provider_status`` only: a card failed and is being retried
  ``subscription.halted``      ``provider_status`` only: retries exhausted. A state, not a refund
  ``subscription.paused`` / ``resumed`` / ``completed`` / ``authenticated`` / ``updated``
                               ``provider_status`` only
  anything else                recorded and ignored
  ============================ =====================================================

  ``authenticated`` deliberately flips nothing: it is the mandate, and the states page says the
  charge comes with ``active``. Nothing is granted on a promise to pay.

  Three rules on a row that already exists, because razorpay.com/docs/webhooks/validate-test/
  says in so many words "you may not always receive the webhooks in the order":

  * ``current_period_end`` only ever moves FORWARD. A late retry of an earlier cycle's charge
    cannot take back days a later charge already paid for.
  * A cancelled row is never flipped back to active by a flip event for the same subscription. A
    stale ``charged`` after the cancel moves the period end forward (the money is real) and leaves
    ``cancelled`` and ``cancelled_at`` exactly where they were (the cancel is real too).
  * A flip for a DIFFERENT provider subscription while the row's own is live and active means the
    learner has paid twice. The one that runs longer stays; the other is told to stop at the
    provider, at cycle end, so it takes nothing more. If the provider will not take that stop the
    event is refused (503, the provider retries) and the log says so at error level.
* ``GET /v1/admin/billing`` — the ledger, newest first, with payments on/off and the last webhook
  seen. Guarded by construction (``admin_router``), ``console.read``, and a keyed handle stands
  in for the learner on every row, as on the other desks.

Every line a learner can read here keeps the register (docs/copy/voice.md §10a): no em dash, no
digits, no exclamation, no provider name, and nothing about money coming back.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from wobo_gateway import billing
from wobo_gateway import promo as promo_codes
from wobo_gateway.admin_auth import CanRead, admin_router
from wobo_gateway.billing import plans, razorpay, records
from wobo_gateway.billing.records import BillingEvent, RecordsUnavailable
from wobo_gateway.reports import handle

logger = logging.getLogger("wobo.gateway.billing.payments")

CHECKOUT_PATH = "/v1/billing/checkout"
WEBHOOK_PATH = "/v1/billing/razorpay/webhook"
#: The checkout creates an object at the provider and is reachable by anyone holding a token, so
#: it rides the per-caller limiter. The webhook is NOT limited: the provider retries on a non-2xx,
#: and a burst of real events refused as "too many" would be a burst of retries; the signature is
#: the gate, and it costs one HMAC.
LIMITED_PATHS = frozenset({CHECKOUT_PATH})
#: The provider holds no learner token. The signature is the door.
OPEN_PATHS = frozenset({WEBHOOK_PATH})

#: What the learner reads. Copy law: DESIGN.md §0, voice.md §10a.
LINES: dict[str, str] = {
    "payments_off": (
        "Paying for a plan is not switched on just yet. The free plan is running, and everything "
        "you learn stays. Try again in a while."
    ),
    "already_subscribed": (
        "You are already on a paid plan, and it runs to the end of the period you have paid for. "
        "There is nothing more to buy right now."
    ),
    "provider_unavailable": (
        "I could not reach the payment side just now. Nothing has been charged and nothing has "
        "changed. Try again in a moment."
    ),
    "not_sold": "That is not a plan I sell. Pick Pro or Max, monthly or yearly.",
    "confirming": (
        "Your payment is still being confirmed. Give it a moment and your plan appears on its "
        "own. There is nothing more to pay."
    ),
}

#: ``expire_by`` on the subscription the checkout creates (the create-subscription page: optional,
#: "till when the customer can make the authorisation payment", default thirty years). A day is
#: long enough for a modal left open over dinner and short enough that an abandoned checkout is
#: not a bill waiting in somebody's provider account for years.
CHECKOUT_EXPIRES_S = 24 * 3600
#: The provider's words for a subscription that money has moved on, or is moving on. The webhook
#: for it may still be on its way; a second checkout now would be a second bill.
PAYING: frozenset[str] = frozenset({"authenticated", "active", "pending", "halted"})

#: The two events that are evidence of money. Nothing else flips a plan.
FLIPS: frozenset[str] = frozenset({"subscription.activated", "subscription.charged"})
#: What the provider is saying about the card, mapped onto ``provider_status``. ``None`` means
#: take the status word from the payload itself.
PROVIDER_STATUS: dict[str, str | None] = {
    "subscription.authenticated": "authenticated",
    "subscription.pending": "pending",
    "subscription.halted": "halted",
    "subscription.paused": "paused",
    "subscription.resumed": "active",
    "subscription.completed": "completed",
    "subscription.updated": None,
    "subscription.cancelled": "cancelled",
}
#: The provider's header, logged beside the digest so a delivery can be found in its dashboard.
_HEADER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class CheckoutBody(BaseModel):
    plan: str = Field(max_length=16)
    period: str = Field(max_length=16)
    #: An optional promo code (``docs/ALLOWANCE.md`` section 3). Only ``percent_off_first`` is
    #: used here; the other two kinds are taken on the You page and are refused with a line that
    #: says so. A code that cannot be applied REFUSES the checkout rather than quietly letting it
    #: through at the full price.
    promo: str | None = Field(default=None, max_length=promo_codes.MAX_CODE)


def _refuse(status: int, code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def _payments_off() -> HTTPException:
    return _refuse(503, "payments_off", LINES["payments_off"])


class NotApplied(Exception):
    """A verified event the gateway understood but could not apply SAFELY: the extra provider
    subscription it revealed could not be stopped. The webhook answers 503 so the provider sends
    the event again once the provider is back."""


# --- the webhook, applied -------------------------------------------------------------------------
@dataclass(frozen=True)
class Applied:
    """What one event did. ``outcome`` is the word the ledger and the answer carry."""

    outcome: str
    learner_id: str | None = None
    subscription_id: str | None = None
    plan: str | None = None
    period: str | None = None
    status: str | None = None
    amount_paise: int | None = None


def _unix(value: Any) -> datetime | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    try:
        return datetime.fromtimestamp(float(value), tz=UTC)
    except (OverflowError, OSError, ValueError):
        return None


def _entity(data: dict[str, Any], name: str) -> dict[str, Any]:
    payload = data.get("payload")
    if not isinstance(payload, dict):
        return {}
    outer = payload.get(name)
    if not isinstance(outer, dict):
        return {}
    inner = outer.get("entity")
    return inner if isinstance(inner, dict) else {}


def _resolve_plan(
    entity: dict[str, Any], notes: dict[str, Any], ids: dict[str, str] | None
) -> plans.PlanSpec | None:
    """``plan_id`` first: it is the thing actually charged, and a plan changed at the provider's
    dashboard (an upgrade, an offer) changes it. The notes were written once at checkout and never
    change, so they only stand in for a plan id that is not one of ours."""
    charged = plans.key_of_plan_id(entity.get("plan_id"), ids)
    if charged is not None:
        return charged
    return plans.spec_for(str(notes.get("wobo_plan") or ""), str(notes.get("wobo_period") or ""))


def _stop_at_provider(provider: razorpay.Provider | None, sub_id: str, *, keeping: str) -> None:
    """Tell the provider to stop the extra subscription at cycle end. Raises :class:`NotApplied`
    when it could not, and logs the alert either way: a learner paying twice is an incident."""
    logger.error(
        "a learner holds two provider subscriptions; stopping the extra at cycle end",
        extra={"fields": {"stopping": sub_id, "keeping": keeping}},
    )
    if provider is None:
        logger.error("two provider subscriptions and no provider keys to stop one; refused")
        raise NotApplied("no provider to stop the extra subscription")
    try:
        provider.cancel_subscription(sub_id, {"cancel_at_cycle_end": True})
    except razorpay.RazorpayError as exc:
        if razorpay.takes_nothing_more(exc):
            return  # already over at the provider: nothing more will be taken
        logger.error(
            "two provider subscriptions and the provider would not stop the extra; refused",
            extra={"fields": {"stopping": sub_id, "status": exc.status, "code": exc.code}},
        )
        raise NotApplied(exc.code) from exc


def apply_event(
    store: billing.SubscriptionStore,
    name: str,
    data: dict[str, Any],
    *,
    ids: dict[str, str] | None = None,
    now: datetime | None = None,
    provider: razorpay.Provider | None = None,
) -> Applied:
    """Map one verified, not-yet-seen event onto the subscription row. Raises
    :class:`billing.StoreUnavailable` when a write did not land and :class:`NotApplied` when an
    extra subscription could not be stopped; either way the caller answers 503 so the provider
    sends the event again."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    entity = _entity(data, "subscription")
    payment = _entity(data, "payment")
    amount = payment.get("amount")
    amount_paise = int(amount) if isinstance(amount, int) and not isinstance(amount, bool) else None
    sub_id = str(entity.get("id") or "") or None
    notes = entity.get("notes") if isinstance(entity.get("notes"), dict) else {}
    learner = str(notes.get("wobo_learner_id") or "").strip()

    if name not in FLIPS and name not in PROVIDER_STATUS:
        return Applied("ignored", subscription_id=sub_id, amount_paise=amount_paise)
    # The id is about to key a store read, so it is checked the way the store checks it: a value
    # that could carry a filter of its own never reaches one.
    if not learner or not billing._ID_RE.match(learner):
        return Applied("unmatched", subscription_id=sub_id, amount_paise=amount_paise)

    spec = _resolve_plan(entity, notes, ids)
    plan = spec.plan if spec else None
    period = spec.period if spec else None
    provider_status = str(entity.get("status") or "") or None

    if name in FLIPS:
        ends = _unix(entity.get("current_end"))
        if ends is None:
            logger.warning(
                "razorpay event carries no current_end; the plan is not flipped",
                extra={"fields": {"event": name, "subscription": sub_id}},
            )
            return Applied(
                "no_period_end", learner, sub_id, plan, period, amount_paise=amount_paise
            )
        if spec is None:
            logger.warning(
                "razorpay event names a plan we do not sell; the plan is not flipped",
                extra={"fields": {"event": name, "plan_id": entity.get("plan_id")}},
            )
            return Applied("unknown_plan", learner, sub_id, amount_paise=amount_paise)
        fields: dict[str, Any] = {
            "plan": spec.plan,
            "period": spec.period,
            "status": "active",
            "cancelled_at": None,
            "current_period_end": billing._iso(ends),
            "razorpay_subscription_id": sub_id,
            "razorpay_plan_id": str(entity.get("plan_id") or "") or None,
            "provider_status": provider_status or "active",
        }
        current = store.get(learner)
        if current is None:
            store.insert(
                billing.Subscription(
                    id=str(uuid.uuid4()),
                    learner_id=learner,
                    plan=spec.plan,
                    status="active",
                    origin="web",
                    current_period_end=ends,
                    started_at=moment,
                    period=spec.period,
                    razorpay_subscription_id=sub_id,
                    razorpay_plan_id=fields["razorpay_plan_id"],
                    provider_status=fields["provider_status"],
                )
            )
        else:
            # A row exists. Days already paid for are never taken back, whatever order the
            # provider's deliveries arrive in.
            kept_end = max(current.current_period_end, ends)
            fields["current_period_end"] = billing._iso(kept_end)
            own = current.razorpay_subscription_id
            if own is None or own == sub_id:
                # The same subscription (or a row with no provider yet, now adopted). A cancel
                # already written is never undone by a late or replayed flip.
                if current.status == "cancelled":
                    fields["status"] = "cancelled"
                    fields["cancelled_at"] = billing._iso(current.cancelled_at or moment)
            elif current.status == "active" and current.running(moment):
                # Two live subscriptions for one learner: the one that runs longer stays, the
                # other is stopped at the provider so it takes nothing more.
                if current.current_period_end >= ends:
                    _stop_at_provider(provider, sub_id, keeping=own)
                    return Applied(
                        "duplicate_cancelled",
                        learner,
                        sub_id,
                        spec.plan,
                        spec.period,
                        "cancelled",
                        amount_paise,
                    )
                _stop_at_provider(provider, own, keeping=sub_id)
            # Otherwise the row's own subscription is over (the period ended, or it was
            # cancelled) and this is the learner's next one: it replaces the row.
            if store.update(learner, fields) is None:
                raise billing.StoreUnavailable("the subscription write did not land")
        billing.forget(learner)
        logger.info(
            "subscription written from provider event",
            extra={
                "fields": {"event": name, "plan": spec.plan, "ends": fields["current_period_end"]}
            },
        )
        return Applied(
            "applied", learner, sub_id, spec.plan, spec.period, fields["status"], amount_paise
        )

    current = store.get(learner)
    if current is None:
        return Applied("unmatched", learner, sub_id, plan, period, amount_paise=amount_paise)
    plan, period = current.plan, current.period
    word = PROVIDER_STATUS[name] or provider_status
    fields = {"provider_status": word}
    if name == "subscription.cancelled" and current.status != "cancelled":
        # The provider's word for something we usually did ourselves (the cancel route) or that
        # the provider did (a mandate revoked at the bank). Either way: a status and a time, and
        # the period end exactly where it was.
        fields["status"] = "cancelled"
        fields["cancelled_at"] = billing._iso(_unix(data.get("created_at")) or moment)
    if store.update(learner, fields) is None:
        raise billing.StoreUnavailable("the subscription write did not land")
    billing.forget(learner)
    status = "cancelled" if name == "subscription.cancelled" else current.status
    return Applied("applied", learner, sub_id, plan, period, status, amount_paise)


# --- the routes -----------------------------------------------------------------------------------
def _checkout_answer(
    sub_id: str, spec: plans.PlanSpec, offer: promo_codes.Offer | None = None
) -> dict[str, Any]:
    answer: dict[str, Any] = {
        "subscription_id": sub_id,
        "key_id": razorpay.key_id(),
        "plan": spec.plan,
        "period": spec.period,
        "amount_paise": spec.amount_paise,
        "currency": spec.currency,
        "amount_display": plans.amount_display(spec.plan, spec.period),
    }
    if offer is not None:
        # What the browser is told to expect has to match what the provider will actually take,
        # because the alternative is a learner who reads one figure and is charged another. The
        # full price stays beside it: a discount is only a discount against something.
        first = offer.first_amount_paise(spec.amount_paise)
        answer["promo"] = {
            "code": offer.code.code,
            "percent_off": offer.percent,
            "first_amount_paise": first,
            # The same shape ``plans.amount_display`` uses, so the two figures read as one pair.
            "first_amount_display": f"₹{first // 100:,} the first time",
        }
    return answer


def _open_checkout(
    provider: razorpay.Provider, row: BillingEvent | None, spec: plans.PlanSpec
) -> str | None:
    """The subscription id to offer again, or ``None`` to create one. Asks the provider what
    became of the learner's last checkout, because the ledger row is where we wrote it down and
    the provider is where money moves. Raises the honest refusals: 409 while a payment is being
    confirmed, 503 when the provider could not say (refusing costs a retry; a second subscription
    could cost a second bill)."""
    if row is None or not row.subscription_id:
        return None
    try:
        found = provider.fetch_subscription(row.subscription_id)
    except razorpay.RazorpayError as exc:
        raise _refuse(503, "provider_unavailable", LINES["provider_unavailable"]) from exc
    status = str(found.get("status") or "")
    if status in PAYING:
        raise _refuse(409, "already_subscribed", LINES["confirming"])
    if status == "created" and row.plan == spec.plan and row.period == spec.period:
        return row.subscription_id
    return None


def register_payments(app: FastAPI) -> None:
    @app.post(CHECKOUT_PATH)
    def checkout(request: Request, body: CheckoutBody) -> dict[str, Any]:
        """Create the provider subscription the browser's checkout will open. Flips nothing."""
        principal = request.state.principal
        if principal is None or principal.anonymous:
            raise billing._sign_in_required()
        if not razorpay.configured():
            raise _payments_off()
        spec = plans.spec_for(body.plan, body.period)
        if spec is None:
            raise _refuse(400, "not_sold", LINES["not_sold"])

        moment = datetime.now(UTC)
        try:
            current = billing.read(billing.get_store(), principal.subject)
        except billing.StoreUnavailable as exc:
            raise billing._unavailable(billing._UNREADABLE) from exc
        already = current is not None and current.running(moment)
        if already or (
            current is None and billing.is_paid(billing._profile_plan(principal.subject))
        ):
            raise _refuse(409, "already_subscribed", LINES["already_subscribed"])

        # THE CODE IS CHECKED BEFORE ANYTHING IS CREATED ANYWHERE. A code that cannot be applied
        # refuses the checkout: somebody who typed one and pressed pay must never be quietly
        # charged the full price instead. Nothing is spent by checking (promo.bind_checkout, at
        # the foot of this route, is what records a use) and no provider call has happened yet.
        offer: promo_codes.Offer | None = None
        if body.promo:
            try:
                offer = promo_codes.offer_for_checkout(principal.subject, body.promo, now=moment)
            except promo_codes.Refused as refused:
                raise refused.http() from refused

        ledger = records.get_store()
        try:
            ids = plans.plan_ids(ledger)
            open_row = ledger.latest_checkout(principal.subject)
        except RecordsUnavailable as exc:
            raise billing._unavailable(LINES["provider_unavailable"]) from exc
        if ids is None:
            logger.error(
                "checkout refused: the provider plans have not been created "
                "(uv run python -m wobo_gateway.billing.plans)"
            )
            raise _payments_off()
        provider = razorpay.get_client()
        if provider is None:  # keys vanished between the check and here
            raise _payments_off()

        # A code is attached to a provider subscription when that subscription is CREATED and can
        # never be added to one that already exists. So a checkout carrying a code always makes a
        # fresh one rather than offering back an older, undiscounted subscription the learner
        # abandoned; that one was never paid for and expires within the day (CHECKOUT_EXPIRES_S).
        reused = None if offer is not None else _open_checkout(provider, open_row, spec)
        if reused is not None:
            return _checkout_answer(reused, spec)

        wanted: dict[str, Any] = {
            "plan_id": ids[spec.key],
            "total_count": plans.total_count(spec.period),
            "quantity": 1,
            "customer_notify": 1,
            "expire_by": int(moment.timestamp()) + CHECKOUT_EXPIRES_S,
            "notes": {
                "wobo_learner_id": principal.subject,
                "wobo_plan": spec.plan,
                "wobo_period": spec.period,
            },
        }
        if offer is not None:
            # The discount happens at the provider or it does not happen. There is no second path
            # here that takes money off afterwards, because taking money back is a refund and this
            # product does not do refunds (docs/legal/refund-and-cancellation.md).
            wanted["offer_id"] = offer.offer_id
            wanted["notes"]["wobo_promo"] = offer.code.code
        try:
            created = provider.create_subscription(wanted)
        except razorpay.RazorpayError as exc:
            raise _refuse(503, "provider_unavailable", LINES["provider_unavailable"]) from exc
        sub_id = str(created.get("id") or "")
        if not sub_id:
            raise _refuse(503, "provider_unavailable", LINES["provider_unavailable"])
        try:
            ledger.record(
                BillingEvent(
                    event_id=f"checkout:{sub_id}",
                    kind="checkout",
                    event="checkout",
                    learner_id=principal.subject,
                    subscription_id=sub_id,
                    plan=spec.plan,
                    period=spec.period,
                    status=str(created.get("status") or "created"),
                    amount_paise=spec.amount_paise,
                )
            )
        except RecordsUnavailable:
            # The subscription exists at the provider and the learner can still pay for it; the
            # webhook brings the row. The missing ledger line is logged, not hidden.
            logger.error("checkout created but not recorded", extra={"fields": {"sub": sub_id}})
        if offer is not None:
            # The use is recorded against the subscription the discount was attached to. The same
            # learner re-opening the same checkout reuses the row they already have, so a modal
            # closed over dinner does not burn the one code they were given.
            promo_codes.bind_checkout(offer, principal.subject, sub_id, now=moment)
        return _checkout_answer(sub_id, spec, offer)

    @app.post(WEBHOOK_PATH)
    async def webhook(request: Request) -> JSONResponse:
        """Signature first, once-only second, the row third. Nothing before the signature."""
        raw = await request.body()
        secret = razorpay.webhook_secret()
        if not secret:
            logger.error("razorpay webhook received with no RAZORPAY_WEBHOOK_SECRET set; refused")
            return JSONResponse(
                status_code=503,
                content={"code": "payments_off", "message": "payments are not configured"},
            )
        signature = request.headers.get(razorpay.SIGNATURE_HEADER)
        if not razorpay.verify_webhook_signature(raw, signature, secret):
            logger.warning(
                "razorpay webhook refused: bad or missing signature",
                extra={"fields": {"bytes": len(raw), "signed": bool(signature)}},
            )
            return JSONResponse(status_code=400, content={"code": "bad_signature"})

        try:
            data = json.loads(raw)
        except ValueError:
            data = None
        if not isinstance(data, dict):
            return JSONResponse(status_code=400, content={"code": "bad_payload"})
        name = str(data.get("event") or "")
        # The identity of a delivery is the signed bytes. The header is not signed, so a captured
        # body under a fresh header (or no header) is the same delivery and is refused as one.
        event_id = f"sha256:{hashlib.sha256(raw).hexdigest()}"
        header_id = (request.headers.get(razorpay.EVENT_ID_HEADER) or "").strip()
        header_id = header_id if _HEADER_RE.match(header_id) else ""
        razorpay.note_webhook()

        ledger = records.get_store()
        try:
            if ledger.seen(event_id):
                return JSONResponse(status_code=200, content={"outcome": "already_processed"})
            ids = plans.plan_ids(ledger)
        except RecordsUnavailable:
            logger.error(
                "razorpay webhook not taken: the ledger is unreachable; asking for a retry"
            )
            return JSONResponse(status_code=503, content={"code": "ledger_unavailable"})

        try:
            applied = apply_event(
                billing.get_store(), name, data, ids=ids, provider=razorpay.get_client()
            )
        except billing.StoreUnavailable:
            logger.error("razorpay webhook not taken: the subscription store is unreachable")
            return JSONResponse(status_code=503, content={"code": "store_unavailable"})
        except NotApplied:
            return JSONResponse(status_code=503, content={"code": "duplicate_unresolved"})
        try:
            ledger.record(
                BillingEvent(
                    event_id=event_id,
                    kind="webhook",
                    event=name or "unknown",
                    learner_id=applied.learner_id,
                    subscription_id=applied.subscription_id,
                    plan=applied.plan,
                    period=applied.period,
                    status=applied.outcome,
                    amount_paise=applied.amount_paise,
                )
            )
        except RecordsUnavailable:
            # Applied but not written down: the provider will retry, and the retry re-applies the
            # same state (every write above is idempotent) and records it then.
            logger.error("razorpay webhook applied but not recorded; asking for a retry")
            return JSONResponse(status_code=503, content={"code": "ledger_unavailable"})
        logger.info(
            "razorpay webhook processed",
            extra={"fields": {"event": name, "outcome": applied.outcome, "header": header_id}},
        )
        return JSONResponse(status_code=200, content={"outcome": applied.outcome})


def event_view(event: BillingEvent) -> dict[str, Any]:
    """One ledger row for the desk: a keyed handle, never the learner's id."""
    return {
        "id": event.id,
        "kind": event.kind,
        "event": event.event,
        "handle": handle(event.learner_id),
        "subscription_id": event.subscription_id,
        "plan": event.plan,
        "period": event.period,
        "status": event.status,
        "amount_paise": event.amount_paise,
        "received_at": records._iso(event.received_at),
    }


def register_billing_desk(app: FastAPI) -> None:
    """Mount the subscriptions desk's ledger read. Called after ``register_admin``."""
    router = admin_router(tags=["admin", "billing"])

    @router.get("/billing")
    def billing_desk(ctx: CanRead) -> dict[str, Any]:
        ctx.audit("desk.billing.read", resource_type="billing_events")
        last = razorpay.last_webhook()
        base = {
            "payments": "on" if razorpay.configured() else "off",
            "last_webhook_at": last.isoformat() if last else None,
            "plans": list(plans.CATALOGUE),
        }
        try:
            rows = records.get_store().recent(50)
        except RecordsUnavailable:
            return {**base, "readable": False, "events": []}
        return {**base, "readable": True, "events": [event_view(row) for row in rows]}

    app.include_router(router)


__all__ = [
    "CHECKOUT_EXPIRES_S",
    "CHECKOUT_PATH",
    "FLIPS",
    "LIMITED_PATHS",
    "LINES",
    "OPEN_PATHS",
    "PROVIDER_STATUS",
    "WEBHOOK_PATH",
    "PAYING",
    "Applied",
    "NotApplied",
    "apply_event",
    "event_view",
    "register_billing_desk",
    "register_payments",
]
