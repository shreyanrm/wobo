"""The mail-preference routes (WOBO-PLAN §14.1: preferences, unsubscribe, every message has an
off switch).

* ``GET /v1/me/mail-preferences`` — the family's dials, the calendars they chose, the locality
  on file, and the closed list of calendars they may choose from. Authenticated like every
  ``/v1`` route; an anonymous learner sees the defaults and has nothing stored.
* ``PUT /v1/me/mail-preferences`` — a partial update, every field validated server-side
  (:func:`wobo_gateway.hospitality.preferences.normalise`). Signed-in only: this is where the
  family chooses "Festivals we can wish you on", and that choice is theirs alone to make.
* ``GET /v1/mail/stop?token=…`` — the one-click opt-out from a mail footer. No login: the signed
  token names the learner and the mail it came from (:mod:`.tokens`). The GET shows one button;
  the ``POST`` behind it (and the RFC 8058 one-click POST a mail client sends) flips only the
  dial for that mail — the parent's link stops the Sunday note, the learner's stops wins and
  wishes — and a plain page confirms. A GET never changes anything, so a mail-security link
  prefetcher cannot unsubscribe a family.

Registered by :func:`register_mail_preferences`, the way ``email.register_email`` is. The stop
route is unauthenticated by design and app.py lists it as an open path; the preferences routes
sit behind the door like everything else.
"""

from __future__ import annotations

import html
import logging
import os
from typing import Any
from urllib.parse import parse_qs

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict

from wobo_gateway import waiting_list
from wobo_gateway.hospitality import preferences as prefs_mod
from wobo_gateway.hospitality.festivals import get_calendar
from wobo_gateway.hospitality.links import parse_card_link, redeem_sign_in
from wobo_gateway.hospitality.preferences import (
    DEFAULT_PREFERENCES,
    MailPreferences,
    PreferenceError,
    StoreUnavailable,
)
from wobo_gateway.hospitality.tokens import StopClaim, kinds_to_stop, parse_stop_token, stop_url

logger = logging.getLogger("wobo.gateway.hospitality")


def _note(event: str, *, kind: str, learner_id: str, detail: dict[str, Any] | None = None) -> None:
    """Record a click or an unsubscribe on the mail log, and never fail the press.

    The reader has already pressed the button and the dial is already flipped by the time this
    runs. Losing the record of either is a warning; raising here would lose the thing itself.

    The import is local because the mail log is the sender's, and the sender imports the
    templates, which import this package's tokens: a module-level import here would close that
    ring at start-up for no gain.
    """
    try:
        from wobo_gateway.email import mail_log

        mail_log().note_event(event, kind=kind, learner_id=learner_id, detail=detail or {})
    except Exception as exc:  # the press stands whatever the log does
        logger.warning(
            "mail log: could not record an event",
            extra={"fields": {"error": str(exc), "event": event, "kind": kind}},
        )

APP_NAME = os.getenv("APP_NAME", "Wobo")
APP_URL = os.getenv("APP_URL", "https://heywobo.com").rstrip("/")

# What each link stops, in the words the page uses: (the question the GET asks, the button, the
# title once done, the line once done). Plain English; no other person's mail is mentioned as
# stopped, because it is not.
_STOP_COPY: dict[str, tuple[str, str, str, str]] = {
    "sunday_note": (
        "Stop the Sunday notes?",
        "Stop the notes",
        "Done. No more Sunday notes.",
        "The Sunday note will not come to this address again. Nothing else changes.",
    ),
    # The learner's own link, when their wishes come to them too, and when they do not (then the
    # wishes are the parent's, and this click leaves them alone).
    "learner": (
        "Stop the wins and wishes?",
        "Stop them",
        "Done. No more wins or wishes.",
        "Neither will come to this address again. Account mail still comes when something about "
        "the account needs saying.",
    ),
    "learner:wins": (
        "Stop the notes about your wins?",
        "Stop them",
        "Done. No more notes about wins.",
        "They will not come to this address again. Account mail still comes when something about "
        "the account needs saying.",
    ),
    # "Stop all of these", from a learning note to the learner's own address.
    "learner_all": (
        "Stop every note I send you?",
        "Stop them all",
        "Done. No more notes from me.",
        "The learning notes, the wins and the wishes will not come to this address again. Account "
        "mail still comes when something about the account needs saying.",
    ),
    "learner_all:wins": (
        "Stop every note I send you?",
        "Stop them all",
        "Done. No more notes from me.",
        "The learning notes and the wins will not come to this address again. Account mail still "
        "comes when something about the account needs saying.",
    ),
    # "Stop all of these", from a note to a parent about an under-13.
    "parent": (
        "Stop every note about your child?",
        "Stop them all",
        "Done. No more notes from me.",
        "The Sunday note, the learning notes and the wishes about your child will not come again.",
    ),
    # One page per nudge. Each says the name of the one thing it stops, because a reader who
    # clicked the streak mail wants the streak mail stopped and would be right to distrust a
    # page that answered about "emails" in general.
    # The launch mail to the waiting list. The reader has no account, so nothing here may point
    # them at a sign-in.
    "waiting_list": (
        "Take this address off the list?",
        "Take it off",
        "Done. This address is off the list.",
        "I will not write to it about the day Wobo opens. If you want to hear after all, join the "
        "list again on the site.",
    ),
    # No time in its name: nothing measures how long a card takes (the closer's run, 2026-09-17).
    "quick_one": (
        "Stop the note about a waiting card?",
        "Stop it",
        "Done. No more notes about a waiting card.",
        "That one will not come again. The rest of your mail is unchanged.",
    ),
    "mid_chapter": (
        "Stop the half-finished chapter note?",
        "Stop it",
        "Done. No more chapter notes.",
        "That one will not come again. The rest of your mail is unchanged.",
    ),
    "streak": (
        "Stop the streak note?",
        "Stop it",
        "Done. No more streak notes.",
        "That one will not come again. The rest of your mail is unchanged.",
    ),
    "bonus_level": (
        "Stop the side door note?",
        "Stop it",
        "Done. No more side door notes.",
        "That one will not come again. The rest of your mail is unchanged.",
    ),
    "doubt": (
        "Stop the note when a doubt is answered?",
        "Stop it",
        "Done. No more notes about answered doubts.",
        "That one will not come again. The rest of your mail is unchanged.",
    ),
    "learning_note": (
        "Stop the notes about learning?",
        "Stop it",
        "Done. No more notes about learning.",
        "That one will not come again. The rest of your mail is unchanged.",
    ),
}


class MailLanding(BaseModel):
    """The pressed link, handed back to us by the app that it landed on."""

    model_config = ConfigDict(extra="forbid")

    token: str | None = None


class MailPreferencesUpdate(BaseModel):
    """A partial update. Every field optional; a field that is absent is left as it is."""

    model_config = ConfigDict(extra="forbid")

    sunday_note: bool | None = None
    wins: bool | None = None
    festivals: bool | None = None
    quick_one: bool | None = None
    mid_chapter: bool | None = None
    streak: bool | None = None
    bonus_level: bool | None = None
    doubt: bool | None = None
    learning_note: bool | None = None
    festival_calendar: list[str] | None = None
    country: str | None = None
    region: str | None = None
    timezone: str | None = None
    unsubscribed: bool | None = None


def _calendars_view() -> list[dict[str, Any]]:
    calendar = get_calendar()
    return [
        {"id": cid, "name": name, "community": cid in calendar.community_ids}
        for cid, name in calendar.calendar_names.items()
    ]


def _view(prefs: MailPreferences) -> dict[str, Any]:
    return {
        "preferences": prefs.as_dict(),
        "calendars": _calendars_view(),
        # What the chosen list is used for, in plain words, beside the choice itself (§14.1 rule 3).
        "about_calendars": (
            "The calendars you choose are used for one thing: a one-line wish on those days. "
            "They are never guessed and never used for anything else. Clear the list any time."
        ),
    }


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "code": "store_unavailable",
            "message": "I could not reach your mail settings just now. Try that again in a moment.",
        },
    )


def _page(
    title: str, line: str, *, status: int = 200, form: str = "", signed_in: bool = True
) -> HTMLResponse:
    """A plain confirmation page. Self-contained: no remote fonts, scripts or images.

    ``signed_in=False`` is a reader with no account (the waiting list), who is never told to sign
    in to change anything."""
    safe_title = html.escape(title)
    safe_line = html.escape(line)
    app = html.escape(APP_NAME)
    body = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="robots" content="noindex">'
        f"<title>{safe_title}</title>"
        "<style>body{margin:0;background:#FAF7F0;color:#14142B;font-family:Poppins,"
        "'Helvetica Neue',Arial,sans-serif}main{max-width:560px;margin:0 auto;padding:64px 24px}"
        ".mark{font-weight:700;font-size:26px;letter-spacing:-1px}h1{font-size:28px;line-height:1.2;"
        "letter-spacing:-.5px;margin:40px 0 12px}p{font-size:17px;line-height:1.5;margin:0 0 12px}"
        "a{color:#2B45FF}.quiet{color:#8A8A9E;font-size:14px;margin-top:40px}"
        "button{margin-top:16px;padding:14px 22px;border:0;border-radius:12px;background:#14142B;"
        "color:#FAF7F0;font:500 15px/1 inherit;cursor:pointer}</style></head>"
        f'<body><main><div class="mark">{app.lower()}</div><h1>{safe_title}</h1>'
        f"<p>{safe_line}</p>{form}"
        + (
            f'<p class="quiet">Changed your mind? Sign in to {app} and switch any of it back on '
            "under mail settings.</p>"
            if signed_in
            else ""
        )
        + "</main></body></html>"
    )
    return HTMLResponse(content=body, status_code=status)


async def _token_from_body(request: Request) -> str | None:
    """The ``token`` field of a urlencoded form body (the page's button), read with the
    standard library so the route needs no multipart parser. Anything else is no token."""
    if "application/x-www-form-urlencoded" not in request.headers.get("content-type", ""):
        return None
    try:
        raw = (await request.body())[:8192].decode("utf-8", "ignore")
    except Exception:  # a body that could not be read is simply not a token
        return None
    values = parse_qs(raw, keep_blank_values=False).get("token") or []
    return values[0] if values and isinstance(values[0], str) else None


def _copy_for(claim: StopClaim, kinds: tuple[str, ...]) -> tuple[str, str, str, str]:
    """The page's words for what this click stops, which for a learner's own link depends on
    whether their wishes come to them."""
    if claim.audience in {"learner", "learner_all"} and "festivals" not in kinds:
        return _STOP_COPY[f"{claim.audience}:wins"]
    return _STOP_COPY[claim.audience]


class Unreachable(Exception):
    """The parent links could not be read, so the other children at the address are unknown."""


def same_address(claim: StopClaim) -> list[str]:
    """Every learner whose mail this click is about: the one named, and, for a link that went to a
    parent, every other learner linked to that same parent address. A parent of two children
    receives one list, and stopping it from a note about one child stops it (2026-09-16)."""
    if not claim.to_parent:
        return [claim.learner_id]
    from wobo_gateway import parents

    try:
        store = parents.get_store()
        link = store.active(claim.learner_id)
        if link is None or not link.parent_email_hash:
            return [claim.learner_id]
        linked = store.by_email_hash(link.parent_email_hash)
    except parents.StoreUnavailable as exc:
        raise Unreachable(str(exc)) from exc
    others = sorted({row.learner_id for row in linked if row.learner_id} - {claim.learner_id})
    return [claim.learner_id, *others]


def _bad_link() -> HTMLResponse:
    return _page(
        "That link did not work",
        "It may have expired, or it is not one of ours. Sign in and you can change "
        "your mail settings there.",
        status=400,
    )


def register_mail_preferences(app: FastAPI) -> None:
    @app.get("/v1/me/mail-preferences")
    def read_mail_preferences(request: Request) -> dict[str, Any]:
        principal = request.state.principal
        if principal is None or principal.anonymous:
            return _view(DEFAULT_PREFERENCES)
        try:
            stored = prefs_mod.get_store().get(principal.subject)
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        return _view(stored or DEFAULT_PREFERENCES)

    @app.put("/v1/me/mail-preferences")
    def write_mail_preferences(body: MailPreferencesUpdate, request: Request) -> dict[str, Any]:
        principal = request.state.principal
        if principal is None or principal.anonymous:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "sign_in_required",
                    "message": "Sign in first, and then these settings are yours to keep.",
                },
            )
        calendar = get_calendar()
        store = prefs_mod.get_store()
        try:
            current = store.get(principal.subject) or DEFAULT_PREFERENCES
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        raw = body.model_dump(exclude_unset=True)
        try:
            updated = prefs_mod.normalise(
                raw,
                calendars=calendar.calendar_ids,
                region_aliases=calendar.region_aliases,
                base=current,
            )
        except PreferenceError as exc:
            raise HTTPException(
                status_code=422,
                detail={"code": "not_kept", "field": exc.field, "message": exc.message},
            ) from exc
        try:
            stored = store.put(principal.subject, updated)
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        logger.info(
            "mail preferences updated",
            extra={
                "fields": {
                    "subject": principal.subject,
                    "changed": sorted(raw),
                    "calendars": len(stored.festival_calendar),
                }
            },
        )
        return _view(stored)

    def _stop(claim: StopClaim) -> HTMLResponse:
        not_yet = _page(
            "Not yet",
            "I could not save that just now. Try the link again in a moment.",
            status=503,
        )
        if claim.audience == waiting_list.STOP_AUDIENCE:
            # A list row, not a learner: nothing in anybody's mail settings changes. A second
            # click finds no row and says the same thing, because the address is off the list.
            try:
                removed = waiting_list.remove(claim.learner_id)
            except waiting_list.ListUnavailable:
                return not_yet
            logger.info("waiting list: taken off by link", extra={"fields": {"removed": removed}})
            _, _, title, line = _STOP_COPY[claim.audience]
            return _page(title, line, signed_in=False)
        kinds = kinds_to_stop(claim)
        try:
            learners = same_address(claim)
        except Unreachable:
            return not_yet
        try:
            for learner_id in learners:
                prefs_mod.get_store().stop(learner_id, kinds)
        except StoreUnavailable:
            return not_yet
        logger.info(
            "mail stopped by link",
            extra={
                "fields": {
                    "subject": claim.learner_id,
                    "audience": claim.audience,
                    "learners": len(learners),
                }
            },
        )
        for learner_id in learners:
            _note("unsubscribe", kind=claim.audience, learner_id=learner_id)
        _, _, title, line = _copy_for(claim, kinds)
        return _page(title, line)

    @app.get("/v1/mail/stop", response_class=HTMLResponse)
    def stop_by_link(token: str | None = None) -> HTMLResponse:
        """The link from the footer. Nothing changes on a GET: link prefetchers and mail-security
        scanners open every URL in a mail, and none of them may opt a family out. One button."""
        claim = parse_stop_token(token)
        if claim is None:
            return _bad_link()
        question, button, _, _ = _copy_for(claim, kinds_to_stop(claim))
        listed = claim.audience == waiting_list.STOP_AUDIENCE
        form = (
            f'<form method="post" action="{html.escape(stop_url(), quote=True)}">'
            f'<input type="hidden" name="token" value="{html.escape(token or "", quote=True)}">'
            f'<button type="submit">{html.escape(button)}</button></form>'
        )
        line = (
            "One tap and this address comes off the list."
            if listed
            else "One tap and I stop sending these to this address."
        )
        return _page(question, line, form=form, signed_in=not listed)

    @app.post("/v1/mail/stop", response_class=HTMLResponse)
    async def stop_by_post(request: Request, token: str | None = None) -> HTMLResponse:
        """The button above, and RFC 8058 one-click: a mail client POSTs the same URL. The token
        rides in the query string of the List-Unsubscribe link, or in the form body."""
        if token is None:
            token = await _token_from_body(request)
        claim = parse_stop_token(token)
        if claim is None:
            return _bad_link()
        return _stop(claim)

    @app.post("/v1/mail/land")
    def land_from_mail(body: MailLanding) -> dict[str, Any]:
        """THE LINK THAT LANDS (docs/EMAILS-AND-ANIMATIONS.md §4).

        The app reads the token out of the address a mail link opened, hands it here, and gets
        back where to land and whether this press may open the door. POST, not GET, for the same
        reason the stop route's GET changes nothing: a mail-security scanner and a link prefetcher
        open every URL in a mail before a person ever sees it, and neither may spend a learner's
        one sign-in.

        The destination comes back on every press; the sign-in on the first only
        (:mod:`.arrival` says why at length). A learner already signed in on the device never
        needs this route at all — the address IS the destination.
        """
        claim = parse_card_link(body.token)
        if claim is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "link_not_live",
                    # The register (voice.md 10a): what to do next, no exclamation, and nothing
                    # about links, tokens or signatures, which are ours to worry about.
                    "message": (
                        "That one has expired. Open Wobo and your place is where you left it."
                    ),
                },
            )
        sign_in = redeem_sign_in(claim)
        logger.info(
            "mail link landed",
            extra={
                "fields": {
                    "subject": claim.learner_id,
                    "course": claim.course_id,
                    "card": claim.card_id,
                    "sign_in": sign_in,
                }
            },
        )
        _note(
            "click",
            kind="card_link",
            learner_id=claim.learner_id,
            detail={"path": claim.path},
        )
        return {"destination": claim.path, "sign_in": sign_in}


__all__ = ["register_mail_preferences", "stop_url"]
