"""Transactional email templates — every one a pure function returning {subject, html, text}.

A single shared shell (`_shell`) carries the brand law so no template drifts: a 600px
white card, ink text on a hairline grid, the Wobo wordmark as text, exactly one
ultramarine bulletproof button (with a VML fallback so Outlook draws it too), a cursive
"— Wobo" sign-off, and a quiet footer. No remote images anywhere — every visual is built
from nested tables and inline styles, so Gmail, Outlook, and Apple Mail render it clean.

Voice is Wobo's: warm, playful, sentence case, no emoji, no exclamation marks. Templates
take a plain `data` dict and fall back to sensible copy for any missing field, so a render
never raises and the visual proof needs no live data.
"""

from __future__ import annotations

import html
import os
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

from wobo_gateway.hospitality.tokens import is_one_click, stop_url

# --- brand-neutral config (WOBO-PLAN §8) ----------------------------------------------
# Every user-facing name, link base and legal footer is one environment variable, so the
# domain swap is a deploy change and never a code change. The defaults below name the real
# domain (heywobo.com); they are still only defaults — the host sets each one.
APP_NAME = os.getenv("APP_NAME", "Wobo")
# The real origin as of 2026-09-03; the host still overrides it, and every link below is built
# from it, so a second domain is one variable and no code change.
APP_URL = os.getenv("APP_URL", "https://heywobo.com").rstrip("/")
# CAN-SPAM and India's DPDP both want a working opt-out and a real postal address on
# commercial mail. The list-wide opt-out is the gateway's own stop route (hospitality/tokens.py):
# without a token it is a page that says so and points at sign-in, never a 404. A send path
# puts the recipient's signed link in ``data`` and that one wins.
UNSUBSCRIBE_URL = os.getenv("EMAIL_UNSUBSCRIBE_URL") or stop_url()
# The notification preferences page — the "you" screen carries the switches (help centre,
# settings §Notifications). The learner's mail links it as "Email settings" / "Fewer emails".
PREFERENCES_URL = os.getenv("EMAIL_PREFERENCES_URL") or f"{APP_URL}/you"
# Read here too (email.py reads the same variable for the envelope) so the "Reply to Wobo" link
# in the Sunday note and the address on the envelope can never disagree.
REPLY_TO = os.getenv("EMAIL_REPLY_TO", "support@heywobo.com")
# The sender's postal identity. Anti-spam law (CAN-SPAM §5, and the same expectation under
# India's consumer rules) requires a real address in every commercial mail; the mail providers
# check for it too. The company default ships so a missing variable can never send a placeholder.
_POSTAL_DEFAULT = "Dot eVentures Pvt Ltd, 141 Prashasan Nagar, Jubilee Hills, Hyderabad, Telangana 500033, India"


def postal_address_is_set() -> bool:
    return bool(postal_address())


def postal_address() -> str:
    return (os.getenv("EMAIL_POSTAL_ADDRESS") or "").strip() or _POSTAL_DEFAULT


# The fallback as it stood at import, for the tests that pin it; the footer reads the live value.
POSTAL_ADDRESS = postal_address()


# Where a link in our mail may point. /v1/email/send is an INTERNAL relay, but its shared key is
# one leak away from being a phishing primitive: a caller who can set `cta_url` gets our domain,
# our brand and our sending reputation carrying a button to anywhere they like. So the CTA host is
# allowlisted at the one place every link is built. Extra hosts (a docs site, a payments partner)
# are config, never code.
_APP_HOST = urlparse(APP_URL).hostname or ""
_ALLOWED_LINK_HOSTS: frozenset[str] = frozenset(
    h
    for h in {
        _APP_HOST.lower(),
        (urlparse(UNSUBSCRIBE_URL).hostname or "").lower(),
        (urlparse(PREFERENCES_URL).hostname or "").lower(),
        # the signed one-click stop link lives on the gateway origin (hospitality/tokens.py)
        (urlparse(stop_url()).hostname or "").lower(),
        # so do the parent's accept and decline pages (parents.py), whatever MAIL_STOP_URL says
        (urlparse(os.getenv("GATEWAY_URL") or "https://api.heywobo.com").hostname or "").lower(),
        *(
            h.strip().lower()
            for h in os.getenv("EMAIL_LINK_HOSTS", "").split(",")
            if h.strip()
        ),
    }
    if h
)
# https, plus whatever scheme APP_URL itself uses, so a local http dev host still renders.
_ALLOWED_LINK_SCHEMES: frozenset[str] = frozenset({"https", urlparse(APP_URL).scheme or "https"})


def _safe_url(candidate: Any, fallback: str) -> str:
    """``candidate`` if it is a link we are willing to sign our name to, else ``fallback``.

    Rejects every non-http(s) scheme — ``javascript:``, ``data:``, ``mailto:`` — and every host
    outside the allowlist. A caller-supplied link that fails silently becomes the safe default
    rather than an error: mail must still go out, it just goes out pointing at us.
    """
    url = str(candidate or "").strip()
    if not url:
        return fallback
    parsed = urlparse(url)
    if parsed.scheme.lower() not in _ALLOWED_LINK_SCHEMES:
        return fallback
    if (parsed.hostname or "").lower() not in _ALLOWED_LINK_HOSTS:
        return fallback
    return url


def _link(data: dict[str, Any], key: str, path: str) -> str:
    """A link the caller may override, otherwise built from ``APP_URL``.

    The one place every CTA — HTML button and plain-text body alike — is assembled, so the host
    check lives here and no template can route around it.
    """
    return _safe_url(data.get(key), f"{APP_URL}{path}")


def _unsubscribe(data: dict[str, Any]) -> str:
    """The recipient's own opt-out link. A per-subscriber token belongs in ``data``; the
    configured list-wide URL is the fallback."""
    return _safe_url(data.get("unsubscribe_url"), UNSUBSCRIBE_URL)


def _postal(data: dict[str, Any]) -> str:
    return str(data.get("postal_address") or postal_address())


def _preferences(data: dict[str, Any]) -> str:
    """The recipient's notification settings. A per-recipient token belongs in ``data``."""
    return _safe_url(data.get("preferences_url"), PREFERENCES_URL)


def _list_unsubscribe(data: dict[str, Any]) -> dict[str, str]:
    """RFC 8058 headers. Mail clients show their own "unsubscribe" affordance from these, so a
    reader never has to hunt the footer. The target is the recipient's signed stop link when the
    send path minted one, else the list-wide opt-out. ``List-Unsubscribe-Post`` — the promise
    that a bare POST to the target unsubscribes — is made only when the target can keep it: a
    tokened link on the stop route. A sign-in page or an untokened route is not a one-click
    endpoint, and Gmail's and Yahoo's bulk-sender checks POST to whatever we name here."""
    target = _unsubscribe(data)
    headers = {"List-Unsubscribe": f"<{target}>"}
    if is_one_click(target):
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    return headers

# --- brand tokens (locked spec) -------------------------------------------------------
FONT = "'Poppins', 'Helvetica Neue', Arial, sans-serif"
CURSIVE = "'Caveat', 'Segoe Script', cursive"
PAGE = "#F4F4F7"       # the light gray behind the card
CANVAS = "#FFFFFF"     # the card itself
INK = "#121316"        # primary text
BODY = "#43444B"       # comfortable reading body
SECONDARY = "#5C5E66"  # supporting text
FOOTER = "#9A9BA2"     # quiet footer
HAIRLINE = "#E9E9EE"   # dividers
TRACK = "#F1F1F5"      # empty bar track
ULTRA = "#1F35E0"      # signature pigment: brand + mastery, and the one button
MOLTEN = "#FF5A1F"     # earned accent — a streak flame, an XP number
MAGENTA = "#CC1E7A"    # earned accent — the gift
ACID = "#66B300"       # earned accent — growth

_esc = html.escape


# --- shell fragments ------------------------------------------------------------------
def _hairline() -> str:
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0"><tr><td style="border-top:1px solid {HAIRLINE};font-size:0;'
        'line-height:0;">&nbsp;</td></tr></table>'
    )


def _button(label: str, url: str) -> str:
    """The one ultramarine call to action — bulletproof, with a VML fallback for Outlook.

    Last line of defence: the URL is re-checked here (scheme + host) before it is escaped, so a
    future template that builds a CTA without going through ``_link`` still cannot emit a
    ``javascript:`` href or a button pointing off our domain.
    """
    label, url = _esc(label), _esc(_safe_url(url, APP_URL), quote=True)
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td align="center" bgcolor="{ULTRA}" style="border-radius:3px;">'
        f'<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:w="urn:schemas-microsoft-com:office:word" '
        f'href="{url}" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="8%" '
        f'strokecolor="{ULTRA}" fillcolor="{ULTRA}"><w:anchorlock/>'
        f'<center style="color:#ffffff;font-family:{FONT};font-size:15px;font-weight:bold;">'
        f'{label}</center></v:roundrect><![endif]-->'
        '<!--[if !mso]><!-->'
        f'<a href="{url}" style="display:inline-block;padding:14px 32px;font-family:{FONT};'
        'font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:3px;'
        f'background-color:{ULTRA};">{label}</a>'
        '<!--<![endif]--></td></tr></table>'
    )


def _p(text: str, color: str = BODY) -> str:
    return (
        f'<p style="margin:0 0 16px 0;font-family:{FONT};font-size:15px;line-height:1.6;'
        f'color:{color};">{text}</p>'
    )


def _bullets(items: list[str]) -> str:
    rows = "".join(
        '<tr>'
        f'<td valign="top" width="16" style="padding:4px 0;font-family:{FONT};font-size:15px;'
        f'line-height:1.5;color:{ULTRA};">&middot;</td>'
        f'<td style="padding:4px 0;font-family:{FONT};font-size:15px;line-height:1.5;'
        f'color:{BODY};">{_esc(str(it))}</td></tr>'
        for it in items
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:4px 0 20px 0;">{rows}</table>'
    )


def _stats(cells: list[tuple[str, str, str]]) -> str:
    """A row of headline numbers — (value, label, color) each. Table cells, never flex."""
    tds = "".join(
        f'<td width="33%" valign="top" style="padding:0 8px;">'
        f'<div style="font-family:{FONT};font-size:26px;font-weight:700;color:{color};'
        f'line-height:1.1;">{_esc(value)}</div>'
        f'<div style="font-family:{FONT};font-size:12px;color:{SECONDARY};'
        f'padding-top:4px;">{_esc(label)}</div></td>'
        for value, label, color in cells
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:4px 0 22px 0;"><tr>{tds}</tr></table>'
    )


def _bar(label: str, value: str, pct: int, color: str = ULTRA) -> str:
    """One horizontal bar built from two colored table cells — no image, glanceable."""
    pct = max(2, min(100, int(pct)))
    rest = 100 - pct
    fill = (
        f'<td width="{pct}%" style="background-color:{color};height:10px;border-radius:3px;'
        'font-size:0;line-height:0;">&nbsp;</td>'
    )
    gap = (
        f'<td width="{rest}%" style="font-size:0;line-height:0;">&nbsp;</td>' if rest > 0 else ""
    )
    return (
        '<tr>'
        f'<td width="128" valign="middle" style="padding:7px 12px 7px 0;font-family:{FONT};'
        f'font-size:13px;color:{SECONDARY};">{_esc(label)}</td>'
        '<td valign="middle" style="padding:7px 0;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="background-color:{TRACK};border-radius:3px;"><tr>{fill}{gap}</tr></table></td>'
        f'<td width="48" align="right" valign="middle" style="padding:7px 0 7px 12px;'
        f'font-family:{FONT};font-size:13px;font-weight:600;color:{INK};">{_esc(value)}</td>'
        '</tr>'
    )


def _bars(rows: list[str]) -> str:
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:2px 0 20px 0;">{"".join(rows)}</table>'
    )


def _chips(items: list[str]) -> str:
    """Soft gray pills for focus areas — table cells, wrap via inline-block spans."""
    pills = "".join(
        f'<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 12px;'
        f'font-family:{FONT};font-size:13px;color:{SECONDARY};background-color:{TRACK};'
        f'border-radius:3px;">{_esc(str(it))}</span>'
        for it in items
    )
    return f'<div style="margin:2px 0 20px 0;">{pills}</div>'


def _shell(
    *,
    preheader: str,
    heading: str,
    body: str,
    cta_label: str,
    cta_url: str,
    unsubscribe_url: str,
    postal_address: str,
) -> str:
    """Every email is this: wordmark, heading, body blocks, the one button, sign-off, footer.

    ``unsubscribe_url`` and ``postal_address`` are required, not defaulted: a transactional
    shell that renders a dead ``{{placeholder}}`` opt-out is a compliance bug that looks fine
    in review. Every template threads them from the send path (see :func:`_unsubscribe`).
    """
    return (
        "<!DOCTYPE html>"
        '<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">'
        '<head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="x-apple-disable-message-reformatting">'
        f"<title>{_esc(APP_NAME)}</title></head>"
        f'<body style="margin:0;padding:0;background-color:{PAGE};">'
        f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:{PAGE};'
        f'font-size:1px;line-height:1px;">{_esc(preheader)}</div>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="background-color:{PAGE};"><tr>'
        '<td align="center" style="padding:32px 12px;">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
        f'style="width:100%;max-width:600px;background-color:{CANVAS};border-radius:3px;">'
        # wordmark
        '<tr><td style="padding:38px 44px 0 44px;">'
        f'<span style="font-family:{FONT};font-size:20px;font-weight:700;letter-spacing:-0.6px;'
        f'color:{INK};">{_esc(APP_NAME)}</span></td></tr>'
        '<tr><td style="padding:22px 44px 0 44px;">' + _hairline() + "</td></tr>"
        # heading + body
        '<tr><td style="padding:30px 44px 0 44px;">'
        f'<h1 style="margin:0 0 18px 0;font-family:{FONT};font-size:24px;font-weight:700;'
        f'line-height:1.28;letter-spacing:-0.3px;color:{INK};">{heading}</h1>'
        f"{body}</td></tr>"
        # the one button
        '<tr><td style="padding:8px 44px 4px 44px;">' + _button(cta_label, cta_url) + "</td></tr>"
        # sign-off
        '<tr><td style="padding:26px 44px 34px 44px;">'
        f'<div style="font-family:{CURSIVE};font-size:27px;color:{INK};line-height:1;">'
        f"&mdash; {_esc(APP_NAME)}</div></td></tr>"
        '<tr><td style="padding:0 44px;">' + _hairline() + "</td></tr>"
        # footer
        '<tr><td style="padding:22px 44px 36px 44px;">'
        f'<p style="margin:0 0 6px 0;font-family:{FONT};font-size:12px;color:{FOOTER};">'
        f"{_esc(APP_NAME)} &middot; made for curious minds</p>"
        f'<p style="margin:0 0 6px 0;font-family:{FONT};font-size:12px;color:{FOOTER};">'
        f"{_esc(postal_address)}</p>"
        f'<p style="margin:0;font-family:{FONT};font-size:12px;color:{FOOTER};">'
        f'<a href="{_esc(_safe_url(unsubscribe_url, UNSUBSCRIBE_URL), quote=True)}" style="color:{FOOTER};'
        'text-decoration:underline;">unsubscribe</a></p>'
        "</td></tr></table></td></tr></table></body></html>"
    )


def _name(data: dict[str, Any], key: str = "name", default: str = "there") -> str:
    return _esc(str(data.get(key) or default))


# --- the ten templates ----------------------------------------------------------------
def account_created(data: dict[str, Any]) -> dict[str, str]:
    name = _name(data)
    body = (
        _p("i'm Wobo. there's nothing to set up: pick something you're curious about and "
           "we'll start there. your first course is on me, written the moment you open it.")
    )
    html_out = _shell(
        preheader="your account is ready, and so am i.",
        heading=f"welcome, {name}",
        body=body,
        cta_label="start your first course",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"welcome, {data.get('name') or 'there'}\n\n"
        "i'm Wobo. there's nothing to set up: pick something you're curious about and we'll "
        "start there. your first course is on me.\n\n"
        f"start your first course: {_link(data, 'cta_url', '/learn')}\n\n"
        "— Wobo\nWobo · made for curious minds"
    )
    return {"subject": "welcome to Wobo", "html": html_out, "text": text}


def verify_email(data: dict[str, Any]) -> dict[str, str]:
    link = _link(data, "link", "/verify")
    code = _esc(str(data.get("code", "482913")))
    body = (
        _p("tap the button below to confirm your email and open your account. the link works "
           "once and expires shortly.")
        + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
          'style="margin:0 0 20px 0;"><tr>'
          f'<td style="padding:12px 20px;background-color:{TRACK};border-radius:3px;'
          f'font-family:{FONT};font-size:22px;font-weight:700;letter-spacing:4px;'
          f'color:{ULTRA};">{code}</td></tr></table>'
        + _p("or enter that code if you'd rather. if you didn't ask for this, you can ignore "
             "it, nothing happens until the link is used.", color=SECONDARY)
    )
    html_out = _shell(
        preheader="confirm your email to finish signing in.",
        heading="let's confirm it's you",
        body=body,
        cta_label="verify email",
        cta_url=link,
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        "let's confirm it's you\n\n"
        "tap the link below to confirm your email and open your account. it works once and "
        f"expires shortly.\n\nverify: {link}\n\nor enter this code: {data.get('code', '482913')}"
        "\n\nif you didn't ask for this, you can ignore it.\n\n— Wobo"
    )
    return {"subject": "confirm your email", "html": html_out, "text": text}


def course_ready(data: dict[str, Any]) -> dict[str, str]:
    topic = _esc(str(data.get("topic", "your topic")))
    inside = data.get("inside") or [
        "one idea per screen, nothing rushed",
        "things to drag, tap, and try for yourself",
        "a boss battle waiting at the end",
    ]
    body = (
        _p("i built it for you just now, grounded on the real syllabus and shaped to how "
           "you learn. here's what's inside:")
        + _bullets(inside)
        + _p("come in when you have ten quiet minutes. we'll take it one screen at a time.")
    )
    html_out = _shell(
        preheader=f"your course on {data.get('topic', 'your topic')} is ready to open.",
        heading=f"your course on {topic} is ready",
        body=body,
        cta_label="open your course",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"your course on {data.get('topic', 'your topic')} is ready\n\n"
        "i built it for you just now. inside:\n"
        + "".join(f"- {i}\n" for i in inside)
        + "\ncome in when you have ten quiet minutes.\n\n"
        f"open your course: {_link(data, 'cta_url', '/learn')}\n\n— Wobo"
    )
    return {"subject": f"your course on {data.get('topic', 'your topic')} is ready",
            "html": html_out, "text": text}


def boss_victory(data: dict[str, Any]) -> dict[str, str]:
    # heading reads "you beat the {topic} boss" — pass a bare noun phrase, no leading article
    raw_topic = str(data.get("topic", "topic")).removeprefix("the ")
    topic = _esc(raw_topic)
    xp = _esc(str(data.get("xp", 250)))
    body = (
        f'<div style="margin:0 0 18px 0;font-family:{FONT};font-size:34px;font-weight:700;'
        f'color:{MOLTEN};line-height:1;">+{xp} XP</div>'
        + _p("that wasn't a quiz, it was the real thing, and you worked it out yourself. "
             "that's the part that stays with you.")
        + _p("i've marked what you're solid on and what's worth a revisit later, so nothing "
             "you earned quietly slips away.")
    )
    html_out = _shell(
        preheader=f"you beat the {raw_topic} boss.",
        heading=f"you beat the {topic} boss",
        body=body,
        cta_label="see what's next",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"you beat the {raw_topic} boss\n\n+{data.get('xp', 250)} XP\n\n"
        "that wasn't a quiz, it was the real thing, and you worked it out yourself.\n\n"
        "i've marked what you're solid on and what's worth a revisit later.\n\n"
        f"see what's next: {_link(data, 'cta_url', '/learn')}\n\n— Wobo"
    )
    return {"subject": f"you beat the {raw_topic} boss", "html": html_out, "text": text}


def level_up(data: dict[str, Any]) -> dict[str, str]:
    level = _esc(str(data.get("level", 4)))
    unlocked = data.get("unlocked") or [
        "synthesis boss battles across everything you know",
        "a sanctioned rabbit hole from where you stand",
        "the perturbation sandbox, where you break a law to understand it",
    ]
    body = (
        f'<div style="margin:0 0 18px 0;font-family:{FONT};font-size:14px;font-weight:600;'
        f'letter-spacing:1px;text-transform:uppercase;color:{ACID};">level {level}</div>'
        + _p("you've been showing up, and it shows. here's what just opened up for you:")
        + _bullets(unlocked)
        + _p("no rush to use all of it today. it'll be here when you're curious.")
    )
    html_out = _shell(
        preheader=f"you reached level {data.get('level', 4)}.",
        heading=f"level {level}",
        body=body,
        cta_label="keep going",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"level {data.get('level', 4)}\n\nyou've been showing up, and it shows. what just "
        "opened up:\n" + "".join(f"- {u}\n" for u in unlocked)
        + "\nno rush to use all of it today.\n\n"
        f"keep going: {_link(data, 'cta_url', '/learn')}\n\n— Wobo"
    )
    return {"subject": f"you reached level {data.get('level', 4)}", "html": html_out, "text": text}


def streak_milestone(data: dict[str, Any]) -> dict[str, str]:
    days = _esc(str(data.get("days", 24)))
    body = (
        f'<div style="margin:0 0 18px 0;font-family:{FONT};font-size:34px;font-weight:700;'
        f'color:{MOLTEN};line-height:1;">&#9650; {days} days</div>'
        + _p(f"that's {days} days you chose to think a little harder than you had to. that "
             "isn't a number, it's who you're becoming.")
        + _p("if you need a rest day, take it. a planned pause keeps this honest, and i'll "
             "hold your place. the streak is the habit, not the pressure.")
    )
    html_out = _shell(
        preheader=f"{data.get('days', 24)} days of being a learner.",
        heading=f"{days} days of being a learner",
        body=body,
        cta_label="continue your streak",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"{data.get('days', 24)} days of being a learner\n\n"
        f"that's {data.get('days', 24)} days you chose to think a little harder than you had "
        "to.\n\nif you need a rest day, take it. i'll hold your place.\n\n"
        f"continue: {_link(data, 'cta_url', '/learn')}\n\n— Wobo"
    )
    return {"subject": f"{data.get('days', 24)} days of being a learner",
            "html": html_out, "text": text}


def weekly_digest(data: dict[str, Any]) -> dict[str, str]:
    name = _name(data)
    xp = _esc(str(data.get("xp", 640)))
    minutes = _esc(str(data.get("minutes", 82)))
    topics = data.get("topics") or ["acids and bases", "the mole concept", "electric circuits"]
    bars = data.get("bars") or [
        ("acids and bases", "solid", 88),
        ("the mole concept", "growing", 61),
        ("electric circuits", "started", 34),
    ]
    line = _esc(str(data.get("line",
        "the circuits work is the one to keep warm this week, you're closer than it feels.")))
    bar_rows = [_bar(lbl, val, pct, ULTRA) for lbl, val, pct in bars]
    body = (
        _p(f"here's your week in one glance, {name}. you touched {len(topics)} topics and "
           "kept the habit alive.")
        + _stats([(f"+{xp}", "xp earned", MOLTEN),
                  (str(len(topics)), "topics touched", INK),
                  (f"{minutes}m", "time thinking", INK)])
        + _bars(bar_rows)
        + _p(line, color=SECONDARY)
    )
    html_out = _shell(
        preheader="your week of learning, in one glance.",
        heading=f"your week, {name}",
        body=body,
        cta_label="pick up where you left off",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"your week, {data.get('name') or 'there'}\n\n"
        f"+{data.get('xp', 640)} xp · {len(topics)} topics · {data.get('minutes', 82)}m\n\n"
        + "".join(f"- {lbl}: {val} ({pct}%)\n" for lbl, val, pct in bars)
        + f"\n{data.get('line', '')}\n\n"
        f"pick up: {_link(data, 'cta_url', '/learn')}\n\n— Wobo"
    )
    return {"subject": f"your week, {data.get('name') or 'there'}", "html": html_out, "text": text}


def parent_report(data: dict[str, Any]) -> dict[str, str]:
    parent = _name(data, "parent_name", "there")
    learner = _esc(str(data.get("learner_name", "your child")))
    strengths = data.get("strengths") or [
        ("independent problem-solving", "strong", 86),
        ("sticking with hard problems", "strong", 79),
        ("connecting ideas across topics", "growing", 64),
    ]
    focus = data.get("focus") or ["speed under time pressure", "revising older topics"]
    trajectory = _esc(str(data.get("trajectory",
        "on track to master this term's core science ahead of the exam window")))
    strength_rows = [_bar(lbl, val, pct, ACID) for lbl, val, pct in strengths]
    body = (
        _p(f"a quiet look at {learner}'s week, {parent}, drawn from their own work, not a "
           "test. this is who they're becoming.")
        + f'<p style="margin:0 0 8px 0;font-family:{FONT};font-size:13px;font-weight:600;'
          f'letter-spacing:0.5px;text-transform:uppercase;color:{SECONDARY};">strengths</p>'
        + _bars(strength_rows)
        + f'<p style="margin:0 0 8px 0;font-family:{FONT};font-size:13px;font-weight:600;'
          f'letter-spacing:0.5px;text-transform:uppercase;color:{SECONDARY};">worth a nudge</p>'
        + _chips(focus)
        + f'<div style="margin:0 0 20px 0;padding:16px 18px;background-color:{TRACK};'
          f'border-radius:3px;font-family:{FONT};font-size:15px;line-height:1.5;color:{INK};">'
          f'<span style="color:{ULTRA};font-weight:700;">trajectory &nbsp;</span>{trajectory}'
          "</div>"
    )
    # THE LINK THAT WENT NOWHERE. This used to close with "see the full picture" pointing at
    # ``/parent``, and ``ParentView`` renders from ``loadProfile()`` and ``useProgress()`` — both
    # localStorage on the VIEWER's own device. A parent opening it on their own phone reached a
    # page that drew their own empty storage: the product emailed a parent a link to a blank page
    # about their child. Until a parent has a session of their own and a server-backed read (a
    # product AND legal decision, not a template's), THIS EMAIL IS THE REPORT. It carries the
    # week itself, and the only route to a person is the one that actually answers.
    body += _p(
        "this note is the whole report for now. a parent does not have a login yet, so there is "
        f"no fuller view to open. reply to this, or write to {REPLY_TO}, and a person answers."
    )
    html_out = _shell(
        preheader=f"{data.get('learner_name', 'your child')}'s week, in one calm view.",
        heading=f"{learner}'s week",
        body=body,
        cta_label="write to us",
        cta_url=_link(data, "cta_url", "/contact"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"{data.get('learner_name', 'your child')}'s week\n\nstrengths:\n"
        + "".join(f"- {lbl}: {val} ({pct}%)\n" for lbl, val, pct in strengths)
        + "\nworth a nudge: " + ", ".join(focus) + "\n\n"
        f"trajectory: {data.get('trajectory', '')}\n\n"
        "this note is the whole report for now: a parent does not have a login yet. "
        f"reply to this, or write to {REPLY_TO}, and a person answers.\n\n"
        "— Wobo"
    )
    return {"subject": f"{data.get('learner_name', 'your child')}'s week at Wobo",
            "html": html_out, "text": text}


def reengage(data: dict[str, Any]) -> dict[str, str]:
    name = _name(data)
    hook = _esc(str(data.get("hook",
        "you were one screen away from cracking why the missing 2ab rectangles complete the square")))
    body = (
        _p("no guilt here, life gets loud. but you left something half-finished, and it's "
           "the good kind of half-finished.")
        + f'<div style="margin:0 0 20px 0;padding:16px 18px;border-left:3px solid {ULTRA};'
          f'background-color:{TRACK};border-radius:3px;font-family:{FONT};font-size:15px;'
          f'line-height:1.5;color:{INK};">{hook}</div>'
        + _p("give it ten minutes. i'll pick up exactly where we stopped, nothing to retrace.")
    )
    html_out = _shell(
        preheader="you left something half-finished, the good kind.",
        heading=f"it's been a minute, {name}",
        body=body,
        cta_label="come back to it",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"it's been a minute, {data.get('name') or 'there'}\n\n"
        "no guilt here. but you left something half-finished, the good kind.\n\n"
        f"{data.get('hook', '')}\n\ngive it ten minutes. i'll pick up where we stopped.\n\n"
        f"come back: {_link(data, 'cta_url', '/learn')}\n\n— Wobo"
    )
    return {"subject": f"it's been a minute, {data.get('name') or 'there'}",
            "html": html_out, "text": text}


def premium_surprise(data: dict[str, Any]) -> dict[str, str]:
    name = _name(data)
    days = _esc(str(data.get("days", 14)))
    reason = _esc(str(data.get("reason",
        "you've shown up with real curiosity and earned mastery the honest way")))
    body = (
        f'<div style="margin:0 0 18px 0;font-family:{FONT};font-size:34px;font-weight:700;'
        f'color:{MAGENTA};line-height:1;">{days} days of premium</div>'
        + _p(f"this one's a gift, {name}. {reason}, so i've unlocked {days} days of premium "
             "for you, no strings and nothing to enter.")
        + _p("go deeper, follow a rabbit hole, build something out of syllabus. see how far "
             "it goes while it's yours.")
    )
    html_out = _shell(
        preheader=f"a gift: {data.get('days', 14)} days of premium, on us.",
        heading=f"a gift for you, {name}",
        body=body,
        cta_label="enjoy premium",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"a gift for you, {data.get('name') or 'there'}\n\n{data.get('days', 14)} days of "
        f"premium\n\n{data.get('reason', '')}, so i've unlocked {data.get('days', 14)} days "
        "of premium for you, no strings.\n\ngo deeper, follow a rabbit hole, build something "
        "out of syllabus.\n\n"
        f"enjoy premium: {_link(data, 'cta_url', '/learn')}\n\n— Wobo"
    )
    return {"subject": f"a gift: {data.get('days', 14)} days of premium",
            "html": html_out, "text": text}


# --- the hand-drawn three (design/email-v1.html, ported verbatim), and the wish -----------
# The Sunday note, the welcome and the win are the owner's design: cream paper, navy ink, the
# Caveat hand for what Wobo says, marigold and coral for the earned moments, tonal tiles and no
# border lines (DESIGN.md law v3). The markup below is that file's, table for table and style
# for style; only the words that belong to one family are swapped in. Every sentence that needs
# a number the caller did not give is dropped, never filled with a guess (docs/copy/emails).
_HAND = "Poppins,Arial,sans-serif"
_HAND_CURSIVE = "Caveat,'Comic Sans MS',cursive"
_PAPER = "#FAF7F0"
_PAPER_EDGE = "#E7E1D3"
_NAVY = "#14142B"
_WOBO_BLUE = "#2B45FF"
_MARIGOLD = "#FFB629"
_CORAL = "#FF6B57"
_MUTED = "#4E4E66"
_QUIET = "#8A8A9E"
_TONAL = "#F1EDE3"

_HAND_FOOT_LINK = 'style="color:#4E4E66"'


def _privacy_url() -> str:
    return f"{APP_URL}/legal/privacy"


def _trust_url() -> str:
    return f"{APP_URL}/legal"


def _hand_doc(*, preheader: str, rows: str) -> str:
    """The document around one hand-drawn card: paper edge, a 640px card, the hidden preheader."""
    return (
        "<!DOCTYPE html>"
        '<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="x-apple-disable-message-reformatting">'
        f"<title>{_esc(APP_NAME)}</title></head>"
        f'<body style="margin:0;padding:0;background:{_PAPER_EDGE};font-family:{_HAND}">'
        f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:{_PAPER_EDGE};font-size:1px;line-height:1px;">{_esc(preheader)}</div>'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        f'style="background:{_PAPER_EDGE}"><tr><td align="center" style="padding:32px 0">'
        '<table role="presentation" width="640" cellspacing="0" cellpadding="0" '
        f'style="width:100%;max-width:640px;background:{_PAPER};border-radius:24px;overflow:hidden;font-family:{_HAND};color:{_NAVY}">'
        f"{rows}"
        "</table></td></tr></table></body></html>"
    )


def _hand_head(stamp: str) -> str:
    """The wordmark and the moment it was written ("Sunday, 6 pm")."""
    return (
        '<tr><td style="padding:28px 32px 0">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
        f'<td style="font:700 26px/1 {_HAND};letter-spacing:-1px;color:{_NAVY}">{_esc(APP_NAME.lower())}</td>'
        f'<td align="right" style="font:400 13px/1 {_HAND};color:{_QUIET}">{_esc(stamp)}</td>'
        "</tr></table></td></tr>"
    )


def _hand_foot(first_line: str, links: str, postal: str) -> str:
    """The quiet footer: why you got this, the switches, the legal line, the postal address."""
    return (
        f'<tr><td style="padding:28px 32px 26px;font:400 12px/1.6 {_HAND};color:{_QUIET}">'
        f"{first_line}<br>"
        f"{_esc(APP_NAME)} &middot; {_esc(_APP_HOST)} &middot; {links}<br>"
        f"{_esc(postal)}"
        "</td></tr>"
    )


_ONES = (
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
    "nineteen",
)
_TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")


def _words(n: int) -> str:
    """A small number the way the design writes it in a sentence ("All five lessons", "Fourteen
    days"). Past ninety-nine the digits are clearer, and the tiles keep digits.

    Never used for a daily allowance: the copy law (DESIGN.md §0, docs/copy/voice.md §8) forbids a
    count of questions a day in digits or in words, so the free line says what it feels like."""
    if n < 0 or n > 99:
        return str(n)
    if n < 20:
        return _ONES[n]
    tens, ones = divmod(n, 10)
    return _TENS[tens] + (f"-{_ONES[ones]}" if ones else "")


def _count(data: dict[str, Any], key: str) -> int | None:
    """A whole number the caller actually gave, or None. Never coerces a missing field to 0 —
    a zero dressed as an achievement is the one thing these emails must never say."""
    value = data.get(key)
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _tile(bg: str, label: str, value: str, note: str, width: str) -> str:
    return (
        f'<td width="{width}" style="background:{bg};border-radius:16px;padding:16px 18px;vertical-align:top">'
        f'<div style="font:500 11px/1 {_HAND};letter-spacing:1.5px;text-transform:uppercase;color:{_MUTED}">{_esc(label)}</div>'
        f'<div style="font:700 30px/1 {_HAND};margin-top:8px">{_esc(value)}</div>'
        + (f'<div style="font:400 12px/1.4 {_HAND};color:{_MUTED};margin-top:6px">{_esc(note)}</div>' if note else "")
        + "</td>"
    )


def sunday_note(data: dict[str, Any]) -> dict[str, Any]:
    """01 · The Sunday note, to a linked parent, at 6 pm in the family's own time.

    Numbers come only from ``data`` (lessons, problems, days_active): a tile whose number was not
    given is not drawn. The words Wobo says (``headline``, ``note``, ``worth_saying``) come from the
    weekly summary capability; a missing one is left out, the layout closes up around it.
    """
    learner = str(data.get("learner_name") or "your child").strip()
    learner_html = _esc(learner)
    stamp = str(data.get("stamp") or "Sunday, 6 pm")
    headline = str(data.get("headline") or "Here is how the week went.")
    page_url = _link(data, "page_url", "/you")
    unsub = _unsubscribe(data)
    # The parent has no account of their own to sign in to, so "Change when it arrives" is
    # drawn only when the send path gave a page the parent can actually open (a tokened one).
    prefs = _safe_url(data.get("preferences_url"), "")
    reply_url = f"mailto:{REPLY_TO}"

    rows = _hand_head(stamp)
    rows += (
        '<tr><td style="padding:28px 32px 0">'
        f'<div style="font:500 12px/1 {_HAND};letter-spacing:2px;text-transform:uppercase;color:{_WOBO_BLUE}">{learner_html}&#8217;s week</div>'
        f'<div style="font:700 30px/1.1 {_HAND};letter-spacing:-1px;margin-top:10px">{_esc(headline)}</div>'
        "</td></tr>"
    )

    # what Wobo says, in Wobo's hand — only when the summary gave it something true to say
    note = str(data.get("note") or "").strip()
    accent = str(data.get("note_accent") or "").strip()
    after = str(data.get("note_after") or "").strip()
    note_text = ""
    if note:
        note_html = _esc(note)
        if accent:
            note_html += f' <span style="color:{_CORAL}">{_esc(accent)}</span>'
        if after:
            note_html += f" {_esc(after)}"
        note_text = " ".join(part for part in (note, accent, after) if part)
        rows += (
            '<tr><td style="padding:22px 32px 0">'
            f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FFF1D6;border-radius:18px"><tr><td style="padding:22px 24px">'
            f'<div style="font:600 27px/1.2 {_HAND_CURSIVE};color:{_NAVY}">{note_html}</div>'
            '<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:14px"><tr>'
            f'<td style="width:36px;height:36px;border-radius:18px;background:{_NAVY};text-align:center;vertical-align:middle">'
            f'<span style="display:inline-block;width:24px;height:11px;border-radius:6px;background:{_PAPER};position:relative;top:1px;text-align:center">'
            f'<span style="display:inline-block;width:5px;height:5px;border-radius:3px;background:{_WOBO_BLUE};margin:3px 2px 0"></span>'
            f'<span style="display:inline-block;width:5px;height:5px;border-radius:3px;background:{_WOBO_BLUE};margin:3px 2px 0"></span>'
            '</span></td>'
            + f'<td style="padding-left:10px;font:700 22px/1 {_HAND_CURSIVE};color:{_NAVY}">&mdash; {_esc(APP_NAME)}</td>'
            "</tr></table></td></tr></table></td></tr>"
        )

    # the tiles — each drawn only when its number was given
    tiles: list[tuple[str, str, str, str]] = []
    lessons = _count(data, "lessons")
    if lessons is not None:
        tiles.append(("#E6EAFF", "Lessons", str(lessons), str(data.get("lessons_note") or "")))
    problems = _count(data, "problems")
    if problems is not None:
        tiles.append(("#DDF6EC", "Problems", str(problems), str(data.get("problems_note") or "")))
    days = _count(data, "days_active")
    if days is not None:
        days_of = _count(data, "days_of") or 7
        tiles.append(("#FFE7E2", "Days", f"{days} of {days_of}", str(data.get("days_note") or "")))
    if tiles:
        width = {1: "100%", 2: "49%", 3: "32%"}[len(tiles)]
        cells = '<td width="2%"></td>'.join(_tile(bg, label, value, note_, width) for bg, label, value, note_ in tiles)
        rows += (
            '<tr><td style="padding:18px 32px 0">'
            f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>{cells}</tr></table>'
            "</td></tr>"
        )

    worth = str(data.get("worth_saying") or "").strip()
    if worth:
        rows += (
            '<tr><td style="padding:22px 32px 0">'
            f'<div style="font:500 12px/1 {_HAND};letter-spacing:2px;text-transform:uppercase;color:{_QUIET}">Something worth saying</div>'
            f'<div style="font:400 15px/1.55 {_HAND};color:{_MUTED};margin-top:8px">{_esc(worth)}</div>'
            "</td></tr>"
        )

    rows += (
        '<tr><td style="padding:24px 32px 0">'
        '<table role="presentation" cellspacing="0" cellpadding="0"><tr>'
        f'<td style="background:{_NAVY};border-radius:12px"><a href="{_esc(page_url, quote=True)}" style="display:inline-block;padding:14px 20px;font:500 15px/1 {_HAND};color:{_PAPER};text-decoration:none">See the week</a></td>'
        f'<td style="padding-left:10px;background:transparent"><a href="{_esc(reply_url, quote=True)}" style="display:inline-block;padding:14px 20px;font:500 15px/1 {_HAND};color:{_NAVY};text-decoration:none;background:{_TONAL};border-radius:12px">Reply to {_esc(APP_NAME)}</a></td>'
        "</tr></table></td></tr>"
    )
    rows += _hand_foot(
        f"You get this note because {learner_html} linked you as a parent. It comes once a week, on Sunday. "
        + (f'<a href="{_esc(prefs, quote=True)}" {_HAND_FOOT_LINK}>Change when it arrives</a> &middot; ' if prefs else "")
        + f'<a href="{_esc(unsub, quote=True)}" {_HAND_FOOT_LINK}>Stop the notes</a>',
        f'<a href="{_esc(_privacy_url(), quote=True)}" {_HAND_FOOT_LINK}>Privacy</a> &middot; '
        f'<a href="{_esc(_trust_url(), quote=True)}" {_HAND_FOOT_LINK}>Security and trust</a>',
        _postal(data),
    )

    preheader = str(data.get("one_line_summary") or headline)
    topic = str(data.get("headline_topic") or "").strip()
    subject = f"{learner}'s week" + (f": {topic}" if topic else "")

    text_lines = [f"{learner}'s week", "", headline, ""]
    if note_text:
        text_lines += [note_text, f"— {APP_NAME}", ""]
    for _bg, label, value, note_ in tiles:
        text_lines.append(f"{label}: {value}" + (f" ({note_})" if note_ else ""))
    if tiles:
        text_lines.append("")
    if worth:
        text_lines += ["Something worth saying", worth, ""]
    text_lines += [
        f"See the week: {page_url}",
        f"Reply to {APP_NAME}: {REPLY_TO}",
        "",
        f"You get this note because {learner} linked you as a parent. It comes once a week, on Sunday.",
        *([f"Change when it arrives: {prefs}"] if prefs else []),
        f"Stop the notes: {unsub}",
        f"{APP_NAME} · {_APP_HOST} · Privacy: {_privacy_url()}",
        _postal(data),
    ]
    return {
        "subject": subject,
        "preheader": preheader,
        "html": _hand_doc(preheader=preheader, rows=rows),
        "text": "\n".join(text_lines),
        "headers": _list_unsubscribe(data),
    }


_WELCOME_THINGS: tuple[tuple[str, str], ...] = (
    ("Ask the basic thing.", "“What even is a hypotenuse” counts. I never keep score of what you should already know."),
    ("Hold space and just talk.", "Half a sentence is fine. Or paste question 7 straight from the worksheet."),
    ("Try one.", "If you’re close, I’ll ring the gap on your own working and wait. I don’t say wrong."),
)


def welcome(data: dict[str, Any]) -> dict[str, Any]:
    """02 · Welcome, to the learner, minutes after sign-up.

    ``board_short`` and ``class_name`` name the syllabus Wobo loaded; when either is missing the
    first line becomes the spec's honest fallback ("Tell me what you are studying...") and no
    chapter is claimed. No plan pitch, no price, no referral ask — this email makes day one work.
    """
    name = str(data.get("name") or "").strip()
    board = str(data.get("board_short") or "").strip()
    klass = str(data.get("class_name") or "").strip()
    subject_first = str(data.get("subject") or "").strip()
    chapter = data.get("chapter")
    stamp = str(data.get("stamp") or "Just now")
    cta = _link(data, "cta_url", "/")
    prefs = _preferences(data)

    greeting = f"Hi {name}. I’m {APP_NAME}." if name else f"Hi. I’m {APP_NAME}."
    if board and klass:
        setup = f"Class {klass}, {board}" + (f", {subject_first} first." if subject_first else ".")
        if chapter:
            setup += " I’ve already found this week’s chapter."
            if isinstance(chapter, str) and chapter.strip():
                setup = setup[:-1] + f": {chapter.strip()}."
        setup += (
            " Ask me anything from it, any time. I draw it, film it, build it to drag, or say it,"
            " whichever the idea needs, then set the practice after."
        )
    else:
        setup = (
            "Tell me what you are studying and I will load your syllabus. "
            "Then ask me anything from it, any time. I draw it, film it, build it to drag, or say "
            "it, whichever the idea needs, then set the practice after."
        )
    # The copy law forbids a count of questions a day, in digits or in words: the allowance is
    # described by how it feels, never measured. Free carries no multiplier at all.
    free_line = "Free every day, a fresh allowance each morning, no card and no trial that ends."

    rows = _hand_head(stamp)
    rows += (
        '<tr><td style="padding:32px 32px 0">'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:{_NAVY};border-radius:22px"><tr><td style="padding:30px 28px">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
        '<td style="vertical-align:middle">'
        f'<div style="font:600 34px/1.05 {_HAND_CURSIVE};color:{_MARIGOLD}">{_esc(greeting)}</div>'
        f'<div style="font:400 15px/1.55 {_HAND};color:rgba(250,247,240,.78);margin-top:12px">{_esc(setup)}</div>'
        "</td>"
        '<td width="110" align="right" style="vertical-align:middle">'
        '<table role="presentation" cellspacing="0" cellpadding="0"><tr>'
        '<td style="width:96px;height:96px;border-radius:48px;background:#F3F0E8;text-align:center;vertical-align:middle">'
        '<span style="display:inline-block;width:64px;height:28px;border-radius:14px;background:#0F1226;position:relative;top:2px;text-align:center">'
        '<span style="display:inline-block;width:14px;height:14px;border-radius:7px;background:#7C8CFF;margin:7px 5px 0"></span>'
        '<span style="display:inline-block;width:14px;height:14px;border-radius:7px;background:#7C8CFF;margin:7px 5px 0"></span>'
        "</span></td></tr></table>"
        "</td></tr></table></td></tr></table></td></tr>"
    )
    things = "".join(
        f'<tr><td style="padding:12px 0;border-top:2px solid {_TONAL}"><table role="presentation" cellspacing="0" cellpadding="0"><tr>'
        f'<td style="width:34px;height:34px;border-radius:17px;background:{_MARIGOLD};text-align:center;font:700 18px/34px {_HAND_CURSIVE};color:{_NAVY}">{i}</td>'
        f'<td style="padding-left:14px"><div style="font:600 15px/1.3 {_HAND}">{_esc(title)}</div>'
        f'<div style="font:400 14px/1.5 {_HAND};color:{_MUTED}">{_esc(line)}</div></td>'
        "</tr></table></td></tr>"
        for i, (title, line) in enumerate(_WELCOME_THINGS, start=1)
    )
    rows += (
        '<tr><td style="padding:26px 32px 0">'
        f'<div style="font:700 24px/1.15 {_HAND};letter-spacing:-.5px">Three things to try first</div>'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px">{things}</table>'
        "</td></tr>"
    )
    rows += (
        '<tr><td style="padding:22px 32px 0">'
        '<table role="presentation" cellspacing="0" cellpadding="0"><tr>'
        f'<td style="background:{_WOBO_BLUE};border-radius:12px"><a href="{_esc(cta, quote=True)}" style="display:inline-block;padding:14px 22px;font:500 15px/1 {_HAND};color:#FFFFFF;text-decoration:none">Ask your first question</a></td>'
        "</tr></table>"
        f'<div style="font:400 13px/1.5 {_HAND};color:{_QUIET};margin-top:12px">{_esc(free_line)}</div>'
        "</td></tr>"
    )
    rows += _hand_foot(
        f"You’re getting this because you just made a {_esc(APP_NAME)} account. We’ll email you only when it’s useful: your Sunday note, and account things. "
        f'<a href="{_esc(prefs, quote=True)}" {_HAND_FOOT_LINK}>Email settings</a>',
        f'<a href="{_esc(_privacy_url(), quote=True)}" {_HAND_FOOT_LINK}>Privacy</a> &middot; '
        f'<a href="{_esc(_trust_url(), quote=True)}" {_HAND_FOOT_LINK}>Security and trust</a>',
        _postal(data),
    )

    if board and klass:
        subject = f"{APP_NAME} is set up for {board} class {klass}"
    elif name:
        subject = f"You are in, {name}"
    else:
        subject = f"Welcome to {APP_NAME}"
    preheader = "Everything is on your syllabus now. Here is where to start."
    text = "\n".join(
        [
            greeting,
            "",
            setup,
            "",
            "Three things to try first",
            *(f"{i}. {title} {line}" for i, (title, line) in enumerate(_WELCOME_THINGS, start=1)),
            "",
            f"Ask your first question: {cta}",
            free_line,
            "",
            f"You’re getting this because you just made a {APP_NAME} account. We’ll email you only when it’s useful: your Sunday note, and account things.",
            f"Email settings: {prefs}",
            f"{APP_NAME} · {_APP_HOST} · Privacy: {_privacy_url()}",
            _postal(data),
        ]
    )
    return {
        "subject": subject,
        "preheader": preheader,
        "html": _hand_doc(preheader=preheader, rows=rows),
        "text": text,
        "headers": _list_unsubscribe(data),
    }


# The only moments a win email exists for (WOBO-PLAN §14.1, "celebrate along the way"). A streak
# on its own under fourteen days is not one of them — hospitality/jobs enforces that and the
# once-a-week cap; the template only knows how to draw each kind.
WIN_MILESTONES: dict[str, tuple[str, str]] = {
    # kind: (badge, headline when the caller gave none)
    "chapter_mastered": ("chapter done", "{chapter}. Done."),
    "first_week": ("first week", "One week with {app}. Done."),
    "streak_14": ("14 days", "Fourteen days, rest days included."),
}


def win(data: dict[str, Any]) -> dict[str, Any]:
    """03 · A win worth a line, to the learner. Only real milestones, never more than one a week."""
    milestone = str(data.get("milestone") or "chapter_mastered")
    badge_default, headline_default = WIN_MILESTONES.get(milestone, WIN_MILESTONES["chapter_mastered"])
    chapter = str(data.get("chapter") or "").strip()
    lessons = _count(data, "lessons")
    stamp = str(data.get("stamp") or "Just now")
    badge = str(data.get("badge") or badge_default)
    headline = str(data.get("headline") or "").strip()
    if not headline:
        if milestone == "chapter_mastered":
            if chapter and lessons:
                headline = f"{chapter}. All {_words(lessons)} lessons. Done."
            elif chapter:
                headline = f"{chapter}. Done."
            else:
                headline = "A whole chapter. Done."
        else:
            headline = headline_default.format(chapter=chapter, app=APP_NAME)
    then_line = str(data.get("then_line") or "").strip()
    note = str(data.get("note") or "").strip()
    next_label = str(data.get("next_label") or "").strip()
    next_url = _link(data, "next_url", "/learn")
    rest_label = str(data.get("rest_label") or "Take the weekend")
    rest_url = _link(data, "rest_url", "/")
    prefs, unsub = _preferences(data), _unsubscribe(data)

    rows = _hand_head(stamp)
    rows += (
        '<tr><td style="padding:30px 32px 0" align="center">'
        '<table role="presentation" cellspacing="0" cellpadding="0"><tr>'
        f'<td style="background:{_MARIGOLD};border-radius:14px;padding:10px 18px;font:700 26px/1 {_HAND_CURSIVE};color:{_NAVY};transform:rotate(-4deg)">{_esc(badge)}</td>'
        "</tr></table>"
        f'<div style="font:700 32px/1.1 {_HAND};letter-spacing:-1px;margin-top:18px">{_esc(headline)}</div>'
        + (f'<div style="font:600 26px/1.2 {_HAND_CURSIVE};color:{_WOBO_BLUE};margin-top:10px">{_esc(then_line)}</div>' if then_line else "")
        + "</td></tr>"
    )
    if note:
        rows += (
            '<tr><td style="padding:24px 32px 0">'
            f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:{_TONAL};border-radius:18px"><tr>'
            f'<td style="padding:20px 22px;font:400 15px/1.55 {_HAND};color:{_MUTED}">{_esc(note)}</td>'
            "</tr></table></td></tr>"
        )
    buttons = ""
    if next_label:
        buttons += f'<td style="background:{_NAVY};border-radius:12px"><a href="{_esc(next_url, quote=True)}" style="display:inline-block;padding:14px 22px;font:500 15px/1 {_HAND};color:{_PAPER};text-decoration:none">{_esc(next_label)}</a></td>'
    buttons += (
        f'<td style="{"padding-left:10px" if next_label else ""}"><a href="{_esc(rest_url, quote=True)}" style="display:inline-block;padding:14px 20px;font:500 15px/1 {_HAND};color:{_NAVY};text-decoration:none;background:{_TONAL};border-radius:12px">{_esc(rest_label)}</a></td>'
    )
    rows += (
        '<tr><td style="padding:22px 32px 0" align="center">'
        f'<table role="presentation" cellspacing="0" cellpadding="0"><tr>{buttons}</tr></table>'
        "</td></tr>"
    )
    rows += _hand_foot(
        f"{_esc(APP_NAME)} writes when something real happens, never more than once a week. "
        f'<a href="{_esc(prefs, quote=True)}" {_HAND_FOOT_LINK}>Fewer emails</a> &middot; '
        f'<a href="{_esc(unsub, quote=True)}" {_HAND_FOOT_LINK}>None at all</a>',
        f'<a href="{_esc(_privacy_url(), quote=True)}" {_HAND_FOOT_LINK}>Privacy</a>',
        _postal(data),
    )

    if milestone == "first_week":
        subject = "Your first week with me"
    elif milestone == "streak_14":
        subject = "Fourteen days, rest days included"
    else:
        subject = f"{chapter} is finished" if chapter else "A whole chapter, finished"
    preheader = then_line or headline
    text_lines = [badge, headline]
    if then_line:
        text_lines.append(then_line)
    text_lines.append("")
    if note:
        text_lines += [note, ""]
    if next_label:
        text_lines.append(f"{next_label}: {next_url}")
    text_lines += [
        f"{rest_label}: {rest_url}",
        "",
        f"{APP_NAME} writes when something real happens, never more than once a week.",
        f"Fewer emails: {prefs}",
        f"None at all: {unsub}",
        f"{APP_NAME} · {_APP_HOST} · Privacy: {_privacy_url()}",
        _postal(data),
    ]
    return {
        "subject": subject,
        "preheader": preheader,
        "html": _hand_doc(preheader=preheader, rows=rows),
        "text": "\n".join(text_lines),
        "headers": _list_unsubscribe(data),
    }


def wish(data: dict[str, Any]) -> dict[str, Any]:
    """04 · A festival wish, to the family, in the morning of the day (WOBO-PLAN §14.1, §20).

    One line in Wobo's hand that names the day and wishes well — ``line`` is the calendar's
    gated copy with the learner's name already in (hospitality/festivals.py) — and nothing
    attached to it: no lesson, no streak, no plan, no drawing of anything the law forbids. The
    footer says why it came (the family chose the calendar, or the day is kept where they are)
    and carries the same two switches as a win. Drawn on the Sunday note's marigold card.
    """
    line = str(data.get("line") or "I hope the day is a good one.").strip()
    festival = str(data.get("festival_name") or "").strip()
    stamp = str(data.get("stamp") or "This morning")
    chosen = bool(data.get("chosen_calendar"))
    prefs, unsub = _preferences(data), _unsubscribe(data)

    rows = _hand_head(stamp)
    rows += (
        '<tr><td style="padding:32px 32px 0">'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FFF1D6;border-radius:18px"><tr><td style="padding:26px 24px">'
        f'<div style="font:600 30px/1.2 {_HAND_CURSIVE};color:{_NAVY}">{_esc(line)}</div>'
        '<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:16px"><tr>'
        f'<td style="width:36px;height:36px;border-radius:18px;background:{_NAVY};text-align:center;vertical-align:middle">'
        f'<span style="display:inline-block;width:24px;height:11px;border-radius:6px;background:{_PAPER};position:relative;top:1px;text-align:center">'
        f'<span style="display:inline-block;width:5px;height:5px;border-radius:3px;background:{_WOBO_BLUE};margin:3px 2px 0"></span>'
        f'<span style="display:inline-block;width:5px;height:5px;border-radius:3px;background:{_WOBO_BLUE};margin:3px 2px 0"></span>'
        "</span></td>"
        f'<td style="padding-left:10px;font:700 22px/1 {_HAND_CURSIVE};color:{_NAVY}">&mdash; {_esc(APP_NAME)}</td>'
        "</tr></table></td></tr></table></td></tr>"
    )
    rows += (
        '<tr><td style="padding:22px 32px 0">'
        f'<div style="font:400 15px/1.55 {_HAND};color:{_MUTED}">Nothing to do today. Come back when you come back.</div>'
        "</td></tr>"
    )
    why = (
        "You get this because your family chose to be wished on these days."
        if chosen
        else "You get this because today is a holiday where your family told me you are."
    )
    rows += _hand_foot(
        f"{_esc(why)} "
        f'<a href="{_esc(prefs, quote=True)}" {_HAND_FOOT_LINK}>Fewer emails</a> &middot; '
        f'<a href="{_esc(unsub, quote=True)}" {_HAND_FOOT_LINK}>None at all</a>',
        f'<a href="{_esc(_privacy_url(), quote=True)}" {_HAND_FOOT_LINK}>Privacy</a>',
        _postal(data),
    )

    subject = str(data.get("subject") or "").strip() or (
        f"Happy {festival}" if festival else "A small wish from me"
    )
    preheader = line
    text = "\n".join(
        [
            line,
            f"— {APP_NAME}",
            "",
            "Nothing to do today. Come back when you come back.",
            "",
            why,
            f"Fewer emails: {prefs}",
            f"None at all: {unsub}",
            f"{APP_NAME} · {_APP_HOST} · Privacy: {_privacy_url()}",
            _postal(data),
        ]
    )
    return {
        "subject": subject,
        "preheader": preheader,
        "html": _hand_doc(preheader=preheader, rows=rows),
        "text": text,
        "headers": _list_unsubscribe(data),
    }


# --- the parent invite, on the same paper (docs/copy/emails/parent-link-invite.md) -------------
def parent_route_url(action: str) -> str:
    """Where the parent's own links point: the gateway's accept and decline pages, which need no
    login (parents.py). Without a token either one is a plain page that says the link did not
    work and never a 404 — the same posture as the stop route."""
    gateway = (os.getenv("GATEWAY_URL") or "https://api.heywobo.com").rstrip("/")
    return f"{gateway}/v1/parent/{action}"


_NOT_GIVEN: tuple[str, ...] = (
    "Their conversations with me.",
    "A list of their wrong answers.",
    "A note when they are online.",
    "Anything that lets you set targets for them.",
)


def parent_invite(data: dict[str, Any]) -> dict[str, Any]:
    """05 · The parent invite, to the parent, the moment a learner types their address.

    Account mail, sent once: no dial and no List-Unsubscribe header, because there is no list —
    nothing else ever comes unless the parent says yes on the accept page, and "Not me" is the
    parent's way out with no login (``decline_url``, signed and single-use, parents.py). No plan
    pitch, nothing that implies the learner is behind (the spec's rules). The learner is named,
    and where a pronoun is unavoidable it is "they": we do not know, and §20's plain English is
    everyone's rule.
    """
    given = str(data.get("learner_name") or "").strip()
    # The fallback is capitalised only where it opens a sentence or the subject line.
    name = given or "A learner"
    named = given or "a learner"
    stamp = str(data.get("stamp") or "Just now")
    accept = _safe_url(data.get("accept_url"), parent_route_url("accept"))
    decline = _safe_url(data.get("decline_url"), parent_route_url("decline"))

    greeting = f"Hello. I’m {APP_NAME}."
    asked = (
        f"{name} learns with me, on their own school syllabus, and asked me to send you their "
        "Sunday notes."
    )
    what = (
        f"Once a week you get one page: what {named} studied, what they cracked, and one thing "
        "they drew. It takes about a minute to read."
    )
    window = "It is a window into the work, not a monitor."
    why = (
        f"You got this once because {named} typed your address. Nothing else comes unless you "
        "say yes on the next page, and every Sunday note carries a link that stops them."
    )

    rows = _hand_head(stamp)
    rows += (
        '<tr><td style="padding:32px 32px 0">'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:{_NAVY};border-radius:22px"><tr><td style="padding:30px 28px">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
        '<td style="vertical-align:middle">'
        f'<div style="font:600 34px/1.05 {_HAND_CURSIVE};color:{_MARIGOLD}">{_esc(greeting)}</div>'
        f'<div style="font:400 15px/1.55 {_HAND};color:rgba(250,247,240,.78);margin-top:12px">{_esc(asked)}</div>'
        "</td>"
        '<td width="110" align="right" style="vertical-align:middle">'
        '<table role="presentation" cellspacing="0" cellpadding="0"><tr>'
        '<td style="width:96px;height:96px;border-radius:48px;background:#F3F0E8;text-align:center;vertical-align:middle">'
        '<span style="display:inline-block;width:64px;height:28px;border-radius:14px;background:#0F1226;position:relative;top:2px;text-align:center">'
        '<span style="display:inline-block;width:14px;height:14px;border-radius:7px;background:#7C8CFF;margin:7px 5px 0"></span>'
        '<span style="display:inline-block;width:14px;height:14px;border-radius:7px;background:#7C8CFF;margin:7px 5px 0"></span>'
        "</span></td></tr></table>"
        "</td></tr></table></td></tr></table></td></tr>"
    )
    rows += (
        '<tr><td style="padding:26px 32px 0">'
        f'<div style="font:400 16px/1.55 {_HAND};color:{_NAVY}">{_esc(what)}</div>'
        "</td></tr>"
    )
    not_given = "".join(
        f'<tr><td style="padding:6px 0;font:400 14px/1.5 {_HAND};color:{_MUTED}">{_esc(line)}</td></tr>'
        for line in _NOT_GIVEN
    )
    rows += (
        '<tr><td style="padding:22px 32px 0">'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:{_TONAL};border-radius:18px"><tr><td style="padding:20px 22px">'
        f'<div style="font:500 12px/1 {_HAND};letter-spacing:2px;text-transform:uppercase;color:{_QUIET}">What you will not get</div>'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px">{not_given}</table>'
        f'<div style="font:600 15px/1.5 {_HAND};color:{_NAVY};margin-top:10px">{_esc(window)}</div>'
        "</td></tr></table></td></tr>"
    )
    rows += (
        '<tr><td style="padding:24px 32px 0">'
        '<table role="presentation" cellspacing="0" cellpadding="0"><tr>'
        f'<td style="background:{_NAVY};border-radius:12px"><a href="{_esc(accept, quote=True)}" style="display:inline-block;padding:14px 22px;font:500 15px/1 {_HAND};color:{_PAPER};text-decoration:none">See how it works</a></td>'
        f'<td style="padding-left:10px"><a href="{_esc(decline, quote=True)}" style="display:inline-block;padding:14px 20px;font:500 15px/1 {_HAND};color:{_NAVY};text-decoration:none;background:{_TONAL};border-radius:12px">Not me</a></td>'
        "</tr></table></td></tr>"
    )
    rows += _hand_foot(
        f"{_esc(why)} " f'<a href="{_esc(decline, quote=True)}" {_HAND_FOOT_LINK}>Not me</a>',
        f'<a href="{_esc(_privacy_url(), quote=True)}" {_HAND_FOOT_LINK}>Privacy</a> &middot; '
        f'<a href="{_esc(_trust_url(), quote=True)}" {_HAND_FOOT_LINK}>Security and trust</a>',
        _postal(data),
    )

    subject = f"{name} asked me to send you their Sunday notes"
    preheader = "One page a week. No dashboard, nothing to check daily."
    text = "\n".join(
        [
            greeting,
            "",
            asked,
            "",
            what,
            "",
            "What you will not get",
            *(f"- {line}" for line in _NOT_GIVEN),
            window,
            "",
            f"See how it works: {accept}",
            f"Not me: {decline}",
            "",
            why,
            f"{APP_NAME} · {_APP_HOST} · Privacy: {_privacy_url()}",
            _postal(data),
        ]
    )
    return {
        "subject": subject,
        "preheader": preheader,
        "html": _hand_doc(preheader=preheader, rows=rows),
        "text": text,
        "headers": {},
    }


# --- registry -------------------------------------------------------------------------
TEMPLATES: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "account_created": account_created,
    "verify_email": verify_email,
    "course_ready": course_ready,
    "boss_victory": boss_victory,
    "level_up": level_up,
    "streak_milestone": streak_milestone,
    "weekly_digest": weekly_digest,
    "parent_report": parent_report,
    "reengage": reengage,
    "premium_surprise": premium_surprise,
    "sunday_note": sunday_note,
    "welcome": welcome,
    "win": win,
    "wish": wish,
    "parent_invite": parent_invite,
}

KINDS = tuple(TEMPLATES)

# The three drawn by hand (design/email-v1.html) and the wish drawn on the same paper: the
# hospitality mail, every one of which carries an off switch (email.py holds a live send of these
# until a signed stop link rides along). The rest share the ultramarine shell.
HAND_KINDS = frozenset({"sunday_note", "welcome", "win", "wish"})
# Everything drawn on the paper — the four above and the parent invite, which is account mail
# sent once with "Not me" as its way out rather than a list to unsubscribe from.
PAPER_KINDS = HAND_KINDS | {"parent_invite"}


def render(kind: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Render one template to {subject, html, text[, preheader, headers]}. Raises KeyError on an
    unknown kind. ``headers`` (List-Unsubscribe) and ``preheader`` are present on the hand-drawn
    kinds; the send path forwards ``headers`` to the provider verbatim."""
    return TEMPLATES[kind](data or {})
