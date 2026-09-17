"""The parent surface: four actions, one switch, and a door in front of all of them.

:mod:`wobo_gateway.parent_account` is the model and the reasoning; :mod:`wobo_gateway.parent_mind`
is the boundary between the two minds; this file is where both become HTTP, and where the limits
are actually enforced. A UI-only limit is not a limit, so every refusal below is at the endpoint.

THE DOOR. :func:`wobo_gateway.parent_account.require_parent` runs first on every route here. A
student account has no row in ``parent.accounts`` and gets a 403 that says so, never an empty list
of children: the owner's ruling is that a student account has no switching at all, and answering
"you have no children" would describe a chooser that does not exist and leave a seam for one.

THE FOUR ACTIONS. Ask Wobo about that child's academics, pay, refer, donate. Only ``ask`` is built
here, because the other three already have a home: paying is :mod:`wobo_gateway.billing`, and
referring and donating are surfaces the site wave owns. What this file adds for those three is the
SCOPE — which child they are for — and the audit row, so that when they arrive they arrive already
inside the same selection and the same trail.

WHAT IS NOT HERE, AND CANNOT BE ADDED BY A CLIENT. There is no route that returns the child's
conversation, mind, boards, answers or handwriting, and no route that takes a turn as the child.
Those are not hidden behind a permission flag; there is no handler for them at all, which is a
stronger statement than a flag would be.

THE ADDRESS COMES FROM THE TOKEN, AND THE TOKEN HAS TO HAVE PROVED IT. :func:`sign_up` matches a
parent to the families already linked to their address by its keyed digest, so the address is the
key to somebody else's children and has to be earned rather than typed. Reading it from the body
would let any signed-in stranger inherit a family; reading it from a signed token is not enough
either, because a signature proves who minted the token and says nothing about the address inside
it. :func:`_address_is_confirmed` is the actual check, and an unconfirmed address is refused.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from wobo_gateway import parent_account as accounts
from wobo_gateway import parent_mind as mind
from wobo_gateway.parent_account import (
    Child,
    NoChildSelected,
    NoSuchChild,
    NotAParentAccount,
    ParentAccount,
    StoreUnavailable,
)

logger = logging.getLogger("wobo.gateway.parent.api")

#: Everything here writes to the store or calls a model, so all of it sits on the per-caller
#: limiter alongside the parent link's own routes (app.py reads this).
LIMITED_PATHS = frozenset(
    {
        "/v1/parent/sign-up",
        "/v1/parent/me",
        "/v1/parent/children",
        "/v1/parent/switch",
        "/v1/parent/child",
        "/v1/parent/ask",
        "/v1/parent/mind",
        "/v1/parent/offers",
        "/v1/me/parent-offered",
        "/v1/parent/plan",
        "/v1/parent/plan/cancel",
    }
)

#: The one refusal the pay action adds. A plan the child, or anybody else, paid for is not this
#: parent's to end; the person who paid ends it from their own account.
NOT_THE_PAYER = (
    "This plan was paid for from another account, so it can only be ended from that account. "
    "Nothing has changed."
)

_STORE_LINE = "I could not reach that just now. Try again in a moment."


def _refuse(exc: Any) -> HTTPException:
    return HTTPException(status_code=exc.status, detail={"code": exc.code, "message": exc.message})


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=503, detail={"code": "store_unavailable", "message": _STORE_LINE}
    )


def _ip_hash(request: Request) -> str | None:
    from wobo_gateway.app import _client_ip, _ip_fingerprint

    try:
        return _ip_fingerprint(_client_ip(request))
    except Exception:
        return None


def _door(request: Request, action: str) -> ParentAccount:
    """The parent behind this token, with the refusal itself recorded.

    A denial is audited too. A wall of ``denied`` rows against one account is somebody trying
    doors, and that is the reason denials are kept at all (migration 0019, ruling 6).
    """
    store = accounts.get_store()
    try:
        return accounts.require_parent(request.state.principal, store)
    except NotAParentAccount as exc:
        subject = str(getattr(request.state.principal, "subject", "") or "")
        if subject:
            accounts.audit(
                store,
                parent_account_id=subject,
                action=action,
                decision="denied",
                method=request.method,
                path=request.url.path,
                status_code=exc.status,
                ip_hash=_ip_hash(request),
            )
        raise _refuse(exc) from exc


def _selected(store: Any, account: ParentAccount) -> Child:
    try:
        child, _ = accounts.selected(store, account)
    except NoChildSelected as exc:
        raise _refuse(exc) from exc
    except StoreUnavailable as exc:
        raise _unavailable() from exc
    return child


def _token_email(principal: Any) -> str:
    """The address on the token, and nothing a client typed. Not yet proof of anything."""
    claims = getattr(principal, "claims", None) or {}
    return str(claims.get("email") or "").strip().lower()


def _address_is_confirmed(principal: Any) -> bool:
    """Has this address actually been PROVEN to belong to whoever is holding the token?

    Refusing an ``email`` field in the body moved the attack one inch and did not close it. The
    signature on a token is not a claim about the address inside it: on a project with email
    confirmations off, or through any flow that mints a token before confirmation, the address
    claim is chosen by whoever signs up. A stranger typing a parent's address into their own
    sign-up would then inherit that family — every invite, expiry and replay check in
    :mod:`wobo_gateway.parents` bypassed, because the claim is matched on its digest alone.

    So the family is only handed over when the identity provider says the address was confirmed.
    Supabase writes that as ``email_confirmed_at`` on the user and mirrors ``email_verified`` into
    the token's metadata; either one, at the top level or in ``user_metadata``, is proof. Nothing
    else is.
    """
    claims = getattr(principal, "claims", None) or {}
    meta = claims.get("user_metadata")
    meta = meta if isinstance(meta, dict) else {}
    if claims.get("email_verified") is True or meta.get("email_verified") is True:
        return True
    return bool(
        str(claims.get("email_confirmed_at") or meta.get("email_confirmed_at") or "").strip()
    )


def _as_the_parent_sees_it(row: Any) -> dict[str, Any]:
    """An offer as its parent may read it. What the child did with it afterwards is not here.

    A row the child removed is still, from the parent's side, a sentence that was passed on: the
    same answer :func:`wobo_gateway.parent_mind._already_line` gives, for the same reason.
    """
    out = row.as_dict()
    if out.get("status") == "removed_by_child":
        out["status"] = "accepted"
    return out


# --- the bodies -----------------------------------------------------------------------------------
class SignUpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: What Wobo calls them. Not an identity: the identity is the verified token.
    display_name: str | None = Field(default=None, max_length=80)


class SwitchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    learner_id: str = Field(min_length=1, max_length=128)


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=1000)


class RememberRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=500)
    #: ``child`` is about the selected child; ``family`` is the household layer. There is no
    #: ``source`` field on purpose: a client may only ever write the parent's own knowledge, and
    #: a report-level fact is written by the gateway from the report and by nothing else.
    scope: str = Field(default="child", pattern="^(child|family)$")


class OfferRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=500)


class DecideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accept: bool


# --- the routes -----------------------------------------------------------------------------------
def register_parent_api(app: FastAPI) -> None:
    # The pay action's two reads of the child's plan live below, mounted with the rest so the
    # parent surface is registered in one call.
    register_parent_pay(app)

    @app.post("/v1/parent/sign-up")
    def parent_sign_up(body: SignUpRequest, request: Request) -> dict[str, Any]:
        """Make this account a parent account, and pick up the families already linked to it.

        Which kind an account is, is settled here and on the server. The address comes from the
        verified token, never from the body, so nobody can inherit another family by typing their
        address.

        The two kinds are kept mutually exclusive in the DATABASE rather than here: migration
        0019's triggers refuse a parent row for an account that already holds learner state, and
        refuse learner state for an account that is a parent. That is stated plainly because it
        is where the guarantee actually lives; a check in this handler would be a second opinion
        that could drift from it, and a learner with no state row yet would walk past it.
        """
        principal = request.state.principal
        if principal is None or principal.anonymous:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "sign_in_required",
                    "message": "Sign in first, and I will set the account up.",
                },
            )
        email = _token_email(principal)
        if not email:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "no_address",
                    "message": "I need the email address you signed in with to find your family.",
                },
            )
        if not _address_is_confirmed(principal):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "address_not_confirmed",
                    "message": (
                        "Confirm your email address first, and then I can find your family. "
                        "The link is in the message we sent when you signed up."
                    ),
                },
            )
        # Which kind an account is, is settled once and for life, so it must not be settled by
        # accident. A learner who has done anything at all in this product is not a parent
        # account waiting to happen, and 0019's trigger would refuse them learner data forever.
        if accounts.holds_learner_data(principal.subject):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "already_a_learner",
                    "message": (
                        "This account is already learning with me, so it cannot also be a "
                        "parent account. Sign up with a different address and I will link them."
                    ),
                },
            )
        store = accounts.get_store()
        try:
            account, claimed = accounts.sign_up(
                store,
                account_id=principal.subject,
                email=email,
                display_name=body.display_name,
            )
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        accounts.audit(
            store,
            parent_account_id=account.account_id,
            action="account.sign_up",
            method=request.method,
            path=request.url.path,
            status_code=200,
            ip_hash=_ip_hash(request),
            claimed=len(claimed),
        )
        return {
            "account": {"display_name": account.display_name, "kind": "parent"},
            "children": [c.as_dict() for c in claimed],
        }

    @app.get("/v1/parent/me")
    def parent_me(request: Request) -> dict[str, Any]:
        """Who this parent is, and what they may do. The list of actions is the ceiling."""
        account = _door(request, "account.read")
        store = accounts.get_store()
        try:
            held = accounts.children(store, account)
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        return {
            "kind": "parent",
            "display_name": account.display_name,
            "children": len(held),
            "actions": list(accounts.PARENT_ACTIONS),
        }

    @app.get("/v1/parent/children")
    def parent_children(request: Request) -> dict[str, Any]:
        """Every child whose link is live RIGHT NOW. Re-read on every call, never cached.

        A parent with none gets an empty list, which is a true answer about a parent account. A
        student account never reaches this handler at all.
        """
        account = _door(request, "children.list")
        store = accounts.get_store()
        try:
            held = accounts.children(store, account)
            selection = store.selection(account.account_id)
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        accounts.audit(
            store,
            parent_account_id=account.account_id,
            action="children.list",
            method=request.method,
            path=request.url.path,
            status_code=200,
            ip_hash=_ip_hash(request),
            children=len(held),
        )
        chosen = selection.learner_id if selection else None
        return {
            "children": [c.as_dict() for c in held],
            "selected": chosen if any(c.learner_id == chosen for c in held) else None,
        }

    @app.post("/v1/parent/switch")
    def parent_switch(body: SwitchRequest, request: Request) -> dict[str, Any]:
        """Choose which child everything after this is about.

        The id in the body is a candidate and nothing more: it is checked against the live list
        and then written to the server, and every scoped read afterwards re-derives the child from
        that row. The fresh ``scope`` is the client's instruction to drop everything it was
        holding for the last child, which is the memory law where it bites hardest — a parent
        switching children puts two learners on one device by design.
        """
        account = _door(request, "child.switch")
        store = accounts.get_store()
        try:
            child, selection = accounts.switch(store, account, body.learner_id.strip())
        except NoSuchChild as exc:
            accounts.audit(
                store,
                parent_account_id=account.account_id,
                action="child.switch",
                decision="denied",
                method=request.method,
                path=request.url.path,
                status_code=exc.status,
                ip_hash=_ip_hash(request),
            )
            raise _refuse(exc) from exc
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        accounts.audit(
            store,
            parent_account_id=account.account_id,
            action="child.switch",
            learner_id=child.learner_id,
            method=request.method,
            path=request.url.path,
            status_code=200,
            ip_hash=_ip_hash(request),
        )
        return {"child": child.as_dict(), "scope": selection.scope}

    @app.get("/v1/parent/child")
    def parent_child(request: Request) -> dict[str, Any]:
        """The selected child, and exactly what a parent is allowed to know about their week.

        ``readable`` is the allow-list itself, sent to the client so a screen can be built from
        the ceiling rather than from a designer's guess at it.
        """
        account = _door(request, "child.report.read")
        store = accounts.get_store()
        child = _selected(store, account)
        week = mind.child_week(child.learner_id)
        accounts.audit(
            store,
            parent_account_id=account.account_id,
            action="child.report.read",
            learner_id=child.learner_id,
            method=request.method,
            path=request.url.path,
            status_code=200,
            ip_hash=_ip_hash(request),
        )
        return {
            "child": child.as_dict(),
            "week": week,
            "readable": list(accounts.readable_for(child.relationship)),
        }

    @app.post("/v1/parent/ask")
    def parent_ask(body: AskRequest, request: Request) -> dict[str, Any]:
        """Ask Wobo about this child's academics. The first of the four actions.

        This is NOT the child's conversation and it never touches it. The context is assembled
        behind :data:`wobo_gateway.parent_mind.ALLOWED_CONTEXT_KEYS`, and a question that asks for
        the child's own words is answered warmly without a model being called at all.
        """
        account = _door(request, "child.ask")
        store = accounts.get_store()
        child = _selected(store, account)
        try:
            answer = mind.ask(store, account, child, body.question)
        except mind.Refused as exc:
            raise _refuse(exc) from exc
        except mind.ContextLeak:
            # Never the leaking value, and never to the caller: a 500 with Wobo's own line, and
            # the alarm that the middleware raises on any 5xx.
            logger.error("parent ask: the context screen refused the assembled context")
            raise HTTPException(
                status_code=500,
                detail={"code": "not_ready", "message": _STORE_LINE},
            ) from None
        accounts.audit(
            store,
            parent_account_id=account.account_id,
            action="child.ask",
            learner_id=child.learner_id,
            method=request.method,
            path=request.url.path,
            status_code=200,
            ip_hash=_ip_hash(request),
            refused=bool(answer.get("refused")),
        )
        return answer

    @app.get("/v1/parent/ask")
    def parent_ask_thread(request: Request) -> dict[str, Any]:
        """This parent's own conversation about the selected child, read back from the record.

        The memory law puts the thread in the database against the account, and ``ask`` wrote it
        after every turn; without this route the parent's own screen could only keep it in the
        browser, which is the thing the law forbids. Every line in it was typed by this parent or
        written by Wobo from the allow-list, and a revoked link deletes it, so it carries nothing
        the parent was not already allowed to see.
        """
        account = _door(request, "child.ask.read")
        store = accounts.get_store()
        child = _selected(store, account)
        try:
            thread = store.thread(account.account_id, child.learner_id)
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        turns = [
            {
                "role": str(t.get("role")),
                "text": str(t.get("text") or ""),
                "at": str(t.get("at") or ""),
            }
            for t in thread
            if isinstance(t, dict) and t.get("role") in ("parent", "wobo") and t.get("text")
        ]
        return {"thread": turns}

    @app.get("/v1/parent/mind")
    def parent_mind_read(request: Request) -> dict[str, Any]:
        """What Wobo remembers on the parent's side: this child, and the household.

        Steerable and never hidden, the same promise the child's memory page makes. The two
        sources are labelled on every item so a parent can see which came from the report and
        which they told Wobo themselves.
        """
        account = _door(request, "mind.read")
        store = accounts.get_store()
        child = _selected(store, account)
        try:
            about_child = store.mind_facts(account.account_id, child.learner_id)
            family = store.mind_facts(account.account_id, None)
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        accounts.audit(
            store,
            parent_account_id=account.account_id,
            action="mind.read",
            learner_id=child.learner_id,
            method=request.method,
            path=request.url.path,
            status_code=200,
            ip_hash=_ip_hash(request),
            facts=len(about_child) + len(family),
        )
        return {
            "child": [f.as_dict() for f in about_child],
            "family": [f.as_dict() for f in family],
            "sources": list(mind.MIND_SOURCES),
        }

    @app.post("/v1/parent/mind")
    def parent_mind_write(body: RememberRequest, request: Request) -> dict[str, Any]:
        """The parent tells Wobo something. Their own knowledge only.

        There is no ``source`` on the body: a client may write ``parent`` and nothing else, and a
        report-level fact is written by the gateway from the report. An instruction dressed as a
        fact is refused here rather than remembered as one.
        """
        account = _door(request, "mind.write")
        store = accounts.get_store()
        learner_id: str | None = None
        if body.scope == "child":
            learner_id = _selected(store, account).learner_id
        elif not accounts.children(store, account):
            # The household layer needed no selected child, so a parent whose every link had been
            # revoked was still a live writer on our store. A parent with no live child has
            # nobody to be a parent of here.
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "no_children",
                    "message": (
                        "There is no linked child on this account just now, so there is nothing "
                        "for me to remember about your household."
                    ),
                },
            )
        try:
            fact = mind.remember(
                store, account, body=body.body, source="parent", learner_id=learner_id
            )
        except mind.Refused as exc:
            raise _refuse(exc) from exc
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        accounts.audit(
            store,
            parent_account_id=account.account_id,
            action="mind.write",
            learner_id=learner_id,
            method=request.method,
            path=request.url.path,
            status_code=200,
            ip_hash=_ip_hash(request),
            length=len(fact.body),
        )
        return {"fact": fact.as_dict()}

    @app.delete("/v1/parent/mind/{fact_id}")
    def parent_mind_forget(fact_id: str, request: Request) -> dict[str, Any]:
        """A parent clearing their own memory. Retired, and retirement is one-way."""
        account = _door(request, "mind.forget")
        store = accounts.get_store()
        try:
            gone = mind.forget(store, account, fact_id.strip())
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        accounts.audit(
            store,
            parent_account_id=account.account_id,
            action="mind.forget",
            method=request.method,
            path=request.url.path,
            status_code=200,
            ip_hash=_ip_hash(request),
            removed=gone,
        )
        return {"forgotten": gone}

    @app.get("/v1/parent/offers")
    def parent_offers(request: Request) -> dict[str, Any]:
        """What this parent has offered to this child's mind, and what became of it."""
        account = _door(request, "offer.list")
        store = accounts.get_store()
        child = _selected(store, account)
        try:
            rows = [
                o
                for o in store.offers(parent_account_id=account.account_id)
                if o.learner_id == child.learner_id
            ]
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        return {"offers": [_as_the_parent_sees_it(o) for o in rows]}

    @app.post("/v1/parent/offers")
    def parent_offer(body: OfferRequest, request: Request) -> dict[str, Any]:
        """A parent offers a fact to the CHILD's mind. Pending until the parent says yes.

        It is offered and never injected: it lands in the child's mind only after
        ``POST /v1/parent/offers/{id}/decide``, it is marked as having come from their parent, it
        appears on their memory page beside every other fact, and they can remove it for good.
        """
        account = _door(request, "offer.create")
        store = accounts.get_store()
        child = _selected(store, account)
        try:
            row = mind.offer(store, account, child, body.body)
        except mind.Refused as exc:
            raise _refuse(exc) from exc
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        accounts.audit(
            store,
            parent_account_id=account.account_id,
            action="offer.create",
            learner_id=child.learner_id,
            method=request.method,
            path=request.url.path,
            status_code=200,
            ip_hash=_ip_hash(request),
        )
        return {
            "offer": row.as_dict(),
            # Said at the moment of offering, so nothing is a surprise later: the child can remove
            # it, and a parent who knows that up front is not misled when it happens quietly.
            "note": (
                "If you pass this on, it goes into their own memory page marked as coming from "
                "you, and they can remove it whenever they like."
            ),
        }

    @app.post("/v1/parent/offers/{offer_id}/decide")
    def parent_offer_decide(offer_id: str, body: DecideRequest, request: Request) -> dict[str, Any]:
        """The parent's yes or no. Refused outright once the child has ended the link.

        This was the one parent route that never re-read the consent: every other one calls
        ``children()`` or ``_selected()`` and stops the moment a link is revoked, and this one
        checked only that the offer belonged to the caller. A parent could create an offer, be
        cut off by the child, and then accept — putting one permanent sentence into the mind of a
        child who had just removed them, on a route the child could not see. The live child is
        derived here and the store's own trigger refuses it a second time.
        """
        account = _door(request, "offer.decide")
        store = accounts.get_store()
        try:
            row = mind.decide_offer(
                store,
                account,
                offer_id.strip(),
                accept=body.accept,
                live=[c.learner_id for c in accounts.children(store, account)],
            )
        except mind.Refused as exc:
            raise _refuse(exc) from exc
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        accounts.audit(
            store,
            parent_account_id=account.account_id,
            action="offer.accept" if body.accept else "offer.withdraw",
            learner_id=row.learner_id,
            method=request.method,
            path=request.url.path,
            status_code=200,
            ip_hash=_ip_hash(request),
        )
        return {"offer": row.as_dict()}

    # --- the child's side of the same fact -------------------------------------------------------
    @app.get("/v1/me/parent-offered")
    def child_sees_offered(request: Request) -> dict[str, Any]:
        """The facts a parent put into this learner's mind, on the learner's own memory page.

        In the same list as everything else Wobo remembers, marked as having come from their
        parent, never disguised as something Wobo worked out.
        """
        principal = request.state.principal
        # An anonymous subject is derived from an ADDRESS, so every device behind one home
        # connection shares it. This route is about one child's memory page, and the delete on
        # the same resource has always asked for a sign-in; the read asking for less was how the
        # next person would conclude it was meant to be open.
        if principal is None or principal.anonymous or not principal.subject:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "sign_in_required",
                    "message": "Sign in first, and your memory page is yours to see.",
                },
            )
        store = accounts.get_store()
        try:
            rows = mind.offered_to(store, principal.subject)
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        return {"facts": [o.as_dict() for o in rows]}

    @app.delete("/v1/me/parent-offered/{offer_id}")
    def child_removes_offered(offer_id: str, request: Request) -> dict[str, Any]:
        """The learner removes one, for good.

        The row stays holding its key, so the same sentence cannot be offered again. That is what
        makes the memory page's promise true for parent-sourced facts as well as Wobo's own.
        """
        principal = request.state.principal
        if principal is None or not principal.subject:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "sign_in_required",
                    "message": "Sign in first, and your memory page is yours to change.",
                },
            )
        store = accounts.get_store()
        try:
            gone = mind.remove_as_child(store, principal.subject, offer_id.strip())
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        return {"removed": gone, "final": True}


# --- pay: the child's plan, on the parent's side ------------------------------------------------
def _payer_of(sub: Any) -> str | None:
    """Who paid for this row, as the provider's own notes say (``wobo_payer_id``, written by the
    checkout when a parent opened it). ``None`` when nobody but the learner paid, when there is no
    provider behind the row, or when the provider cannot be asked right now: an answer we cannot
    get is never read as "you paid"."""
    from wobo_gateway.billing import razorpay

    if not getattr(sub, "provider_managed", False) or not sub.razorpay_subscription_id:
        return None
    provider = razorpay.get_client()
    if provider is None:
        return None
    try:
        found = provider.fetch_subscription(sub.razorpay_subscription_id)
    except razorpay.RazorpayError:
        return None
    raw = found.get("notes")
    notes: dict[str, Any] = raw if isinstance(raw, dict) else {}
    payer = str(notes.get("wobo_payer_id") or "").strip()
    return payer or None


def _plan_body(child: Child, sub: Any, *, paid_by_you: bool) -> dict[str, Any]:
    """The child's plan in the gateway's own state words, minus the sentences.

    :func:`wobo_gateway.billing.plan_view` speaks to the learner ("Your plan is running"), so its
    ``line`` and ``confirm`` never reach a parent; the parent's screen says its own. ``can_cancel``
    is narrowed to a plan this parent paid for, because the cancel route refuses the rest.
    """
    from wobo_gateway import billing
    from wobo_gateway.billing import razorpay

    view = billing.plan_view(sub, profile_plan=billing._profile_plan(child.learner_id))
    view.pop("line", None)
    view.pop("confirm", None)
    view["can_cancel"] = bool(view.get("can_cancel")) and paid_by_you
    # A parent cannot resume a plan either: a provider-backed cancel is final (billing.resume).
    view["can_resume"] = False
    return {
        "child": child.as_dict(),
        "plan": view,
        "paid_by_you": paid_by_you,
        "payments": "on" if razorpay.configured() else "off",
    }


def register_parent_pay(app: FastAPI) -> None:
    """The second of the four actions, on the parent's side: read the selected child's plan, and
    end one this parent paid for. Opening a plan is the checkout (``for_learner``)."""
    from wobo_gateway import billing
    from wobo_gateway.billing import razorpay

    @app.get("/v1/parent/plan")
    def parent_plan(request: Request) -> dict[str, Any]:
        account = _door(request, "pay.plan.read")
        store = accounts.get_store()
        child = _selected(store, account)
        try:
            sub = billing.read(billing.get_store(), child.learner_id)
        except billing.StoreUnavailable as exc:
            raise _unavailable() from exc
        paid = sub is not None and _payer_of(sub) == account.account_id
        accounts.audit(
            store,
            parent_account_id=account.account_id,
            action="pay.plan.read",
            learner_id=child.learner_id,
            method=request.method,
            path=request.url.path,
            status_code=200,
            ip_hash=_ip_hash(request),
        )
        return _plan_body(child, sub, paid_by_you=paid)

    @app.post("/v1/parent/plan/cancel")
    def parent_plan_cancel(request: Request) -> dict[str, Any]:
        """The two-tap cancel, for a plan this parent paid for. The same promise as the learner's:
        the provider is told to stop at cycle end first, and the plan runs to the day paid for."""
        account = _door(request, "pay.cancel")
        store = accounts.get_store()
        child = _selected(store, account)

        def refused(status: int, code: str, message: str) -> HTTPException:
            accounts.audit(
                store,
                parent_account_id=account.account_id,
                action="pay.cancel",
                learner_id=child.learner_id,
                decision="denied",
                method=request.method,
                path=request.url.path,
                status_code=status,
                ip_hash=_ip_hash(request),
            )
            return HTTPException(status_code=status, detail={"code": code, "message": message})

        try:
            sub = billing.read(billing.get_store(), child.learner_id)
        except billing.StoreUnavailable as exc:
            raise _unavailable() from exc
        if sub is None:
            raise refused(404, "no_subscription", billing._NO_PLAN)
        # The payer check holds for a plan already ending too: a plan the child paid for and ended
        # is still not this parent's, and answering "paid_by_you" for it would be untrue.
        if _payer_of(sub) != account.account_id:
            if sub.provider_managed and razorpay.get_client() is None:
                # Payments are off: nothing can be ended here by anybody, and saying "not yours"
                # would be a guess. The learner's route says the same thing in the same words.
                raise refused(503, "payments_off", billing._CANCEL_NEEDS_PAYMENTS)
            raise refused(403, "not_the_payer", NOT_THE_PAYER)
        try:
            ended = billing.cancel(
                billing.get_store(),
                child.learner_id,
                profile_plan=billing._profile_plan(child.learner_id),
                provider=razorpay.get_client(),
            )
        except billing.Refused as exc:
            raise refused(exc.status, exc.code, exc.message) from exc
        except billing.ProviderRefused as exc:
            raise refused(503, "provider_unavailable", billing._PROVIDER_REFUSED) from exc
        except billing.StoreUnavailable as exc:
            raise _unavailable() from exc
        billing._record_cancel(ended)
        accounts.audit(
            store,
            parent_account_id=account.account_id,
            action="pay.cancel",
            learner_id=child.learner_id,
            method=request.method,
            path=request.url.path,
            status_code=200,
            ip_hash=_ip_hash(request),
        )
        return {**_plan_body(child, ended, paid_by_you=True), "cancelled": True}


__all__ = ["LIMITED_PATHS", "NOT_THE_PAYER", "register_parent_api", "register_parent_pay"]
