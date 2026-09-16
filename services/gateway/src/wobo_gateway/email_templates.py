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
import re
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
# The stop link is the one footer element the law sizes and colours by hand: Google asks for
# "clearly visible" and docs/MAIL-PRIMARY.md turns that into 13px and 4.5:1. #9A9BA2 at 12px,
# which every footer used to draw, measures 2.8:1 on white and was the named defect.
FOOT_INK = "#5C5E66"   # the stop link: 6.5:1 on the white card, 6.0:1 on the cream paper
TRACK = "#F1F1F5"      # empty bar track
ULTRA = "#1F35E0"      # signature pigment: brand + mastery, and the one button
MOLTEN = "#FF5A1F"     # earned accent — a streak flame, an XP number
ACID = "#66B300"       # earned accent — growth

_esc = html.escape

# --- the dark, declared once ------------------------------------------------------------------
# _note_doc's own docstring had the diagnosis exactly right: "Gmail, Outlook and Apple all darken
# a mail that does not declare a scheme, and what they do to a cream card with navy ink on it is
# not a choice anybody made." It was written on the newest shell and applied to fifteen of the
# twenty mails, including every one the owner has seen. Measured in a real browser at 390 in
# dark: the five nudges flipped to rgb(15,16,32) and the other fifteen sat on their light ground
# unchanged, which is precisely the cream-card-with-navy-ink case the newest shell escaped. The
# fix already existed three functions away from the mails that needed it, so it is lifted out
# here and all three documents declare the same thing.
_DARK_GROUND = "#0F1020"
_DARK_CARD = "#17182C"
_DARK_INK = "#F4F2EC"
_DARK_QUIET = "#A9A9BC"
#: The fifth thing, which is the character. The nudge shell repainted the ground, the card, the
#: ink and the quiet text and stopped there, so _orb_signature's inline navy disc and navy
#: sign-off survived onto the dark card at 1.03:1 for both: the sign-off vanished and the orb
#: became a smudge. It is the one place a mail draws Wobo, in the one shell that had bothered
#: with dark mode at all.
_DARK_VISOR = "#0F1020"
_DARK_EYE = "#7C8CFF"

_SCHEME_META = (
    '<meta name="color-scheme" content="light dark">'
    '<meta name="supported-color-schemes" content="light dark">'
)

_DARK_STYLE = (
    "<style>:root{color-scheme:light dark;supported-color-schemes:light dark}"
    "@media (prefers-color-scheme: dark){"
    f".wobo-paper{{background:{_DARK_GROUND}!important;"
    f"background-color:{_DARK_GROUND}!important}}"
    f".wobo-card{{background:{_DARK_CARD}!important;background-color:{_DARK_CARD}!important}}"
    f".wobo-ink{{color:{_DARK_INK}!important}}"
    f".wobo-quiet{{color:{_DARK_QUIET}!important}}"
    f".wobo-quiet a{{color:{_DARK_QUIET}!important}}"
    f".wobo-orb-disc{{background:{_DARK_INK}!important}}"
    f".wobo-orb-visor{{background:{_DARK_VISOR}!important}}"
    f".wobo-orb-eye{{background:{_DARK_EYE}!important}}"
    "}</style>"
)

#: Declared by every document in the fleet, so a client never has to guess.
_DARK_HEAD = _SCHEME_META + _DARK_STYLE

#: The footer's PROSE, which is where a reader is told why a mail arrived and how to stop it.
#: 12px #9A9BA2 measures 2.77:1 on the white card and 12px #8A8A9E measures 3.16:1 on the cream.
#: Both sit under the 4.5:1 the law sets for the footer, and the law's own assertion for it was
#: never written (docs/MAIL-PRIMARY.md, FOOTER COMPLETENESS); it is written now, in
#: test_mail_law.py, and these are the two colours that make it pass.
FOOT_PROSE = "#5C5E66"  # 6.5:1 on the white card
_FOOT_PROSE_PAPER = "#4E4E66"  # 7.0:1 on the cream paper


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
        f'<p class="wobo-ink" style="margin:0 0 16px 0;font-family:{FONT};font-size:15px;'
        f'line-height:1.6;color:{color};">{text}</p>'
    )


def _bullets(items: list[str]) -> str:
    rows = "".join(
        '<tr>'
        f'<td valign="top" width="16" style="padding:4px 0;font-family:{FONT};font-size:15px;'
        f'line-height:1.5;color:{ULTRA};">&middot;</td>'
        f'<td class="wobo-ink" style="padding:4px 0;font-family:{FONT};font-size:15px;'
        f'line-height:1.5;color:{BODY};">{_esc(str(it))}</td></tr>'
        for it in items
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:4px 0 20px 0;">{rows}</table>'
    )


# The stat row, the progress bars and the chip row used to live here. They are gone rather than
# unused: docs/MAIL-PRIMARY.md names them as the visual grammar of a newsletter, and the
# percentages they carried broke our own rule that a mastery figure is never a percentage. A
# summary is sentences, and the two templates that drew them now write the word the number stood
# for (solid, growing, started).


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
        + _DARK_HEAD
        + f"<title>{_esc(APP_NAME)}</title></head>"
        f'<body class="wobo-paper" style="margin:0;padding:0;background-color:{PAGE};">'
        f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:{PAGE};'
        f'font-size:1px;line-height:1px;">{_esc(preheader)}</div>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'class="wobo-paper" style="background-color:{PAGE};"><tr>'
        '<td align="center" style="padding:32px 12px;">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
        f'class="wobo-card" style="width:100%;max-width:600px;background-color:{CANVAS};'
        'border-radius:3px;">'
        # wordmark
        '<tr><td style="padding:38px 44px 0 44px;">'
        f'<span class="wobo-ink" style="font-family:{FONT};font-size:20px;font-weight:700;'
        f'letter-spacing:-0.6px;color:{INK};">{_esc(APP_NAME)}</span></td></tr>'
        '<tr><td style="padding:22px 44px 0 44px;">' + _hairline() + "</td></tr>"
        # heading + body
        '<tr><td style="padding:30px 44px 0 44px;">'
        f'<h1 class="wobo-ink" style="margin:0 0 18px 0;font-family:{FONT};font-size:24px;'
        f'font-weight:700;line-height:1.28;letter-spacing:-0.3px;color:{INK};">{heading}</h1>'
        f"{body}</td></tr>"
        # the one button
        '<tr><td style="padding:8px 44px 4px 44px;">' + _button(cta_label, cta_url) + "</td></tr>"
        # sign-off
        '<tr><td style="padding:26px 44px 34px 44px;">'
        f'<div class="wobo-ink" style="font-family:{CURSIVE};font-size:27px;color:{INK};'
        'line-height:1;">'
        f"&mdash; {_esc(APP_NAME)}</div></td></tr>"
        '<tr><td style="padding:0 44px;">' + _hairline() + "</td></tr>"
        # footer
        '<tr><td style="padding:22px 44px 36px 44px;">'
        f'<p class="wobo-quiet" style="margin:0 0 6px 0;font-family:{FONT};font-size:12px;'
        f'color:{FOOT_PROSE};">'
        f"You get this because you have a {_esc(APP_NAME)} account. "
        f"Reply to it and a person answers.</p>"
        f'<p class="wobo-quiet" style="margin:0 0 6px 0;font-family:{FONT};font-size:12px;'
        f'color:{FOOT_PROSE};">'
        f"{_esc(postal_address)}</p>"
        f'<p style="margin:0;font-family:{FONT};font-size:13px;color:{FOOT_INK};">'
        f'<a href="{_esc(_safe_url(unsubscribe_url, UNSUBSCRIBE_URL), quote=True)}" '
        f'style="font-size:13px;color:{FOOT_INK};text-decoration:underline;">unsubscribe</a>'
        f' &middot; <a href="{_esc(_privacy_url(), quote=True)}" '
        f'style="font-size:13px;color:{FOOT_INK};text-decoration:underline;">Privacy</a></p>'
        "</td></tr></table></td></tr></table></body></html>"
    )


def _name(data: dict[str, Any], key: str = "name", default: str = "") -> str:
    """The reader's own name, escaped, or "" when we were not given one.

    The default used to be "there", which produced "your week, there" and "welcome, there".
    docs/copy/voice.md:219 names that as the anti-pattern and docs/MAIL-PRIMARY.md §4 repeats it:
    a missing name means the sentence is REWRITTEN without a name, never filled with a word that
    tells the reader a template ran. Every caller now goes through :func:`_comma_name`.
    """
    return _esc(str(data.get(key) or default))


def _comma_name(data: dict[str, Any], key: str = "name") -> str:
    """", {name}" when there is a name, and nothing at all when there is not."""
    name = _name(data, key)
    return f", {name}" if name else ""


#: The first words of every footer in the fleet. :func:`body_text` cuts here, because the word
#: count law is measured on the body and the character floor is measured on the whole thing.
FOOTER_OPENERS: tuple[str, ...] = (
    "You get this",
    "You are getting this",
    "You’re getting this",
    "You got this",
    f"{APP_NAME} writes when",
)


def _shell_foot_text(data: dict[str, Any]) -> str:
    """The shell footer, in the plain-text twin, link for link with the html.

    The html footer has carried the reason, the postal line and the stop link since the shell was
    written and the text part carried none of it. That failed two of the law's assertions at once
    (docs/MAIL-PRIMARY.md: the 500-character floor, which is the one length threshold with data
    behind it, and the twin that must contain every destination in full) and it left a reader of
    the text part with no way out at all.
    """
    return "\n".join(
        [
            "",
            f"You get this because you have a {APP_NAME} account.",
            "Reply to this note and a person answers.",
            f"Email settings: {_preferences(data)}",
            f"unsubscribe: {_unsubscribe(data)}",
            f"{APP_NAME} · {_APP_HOST} · Privacy: {_privacy_url()}",
            _postal(data),
        ]
    )


#: A subject a phone can show whole. docs/MAIL-PRIMARY.md: at most 60 characters, and a phone
#: shows roughly 40, so a subject built from a learner's own words falls back rather than clips.
SUBJECT_LIMIT = 60


def _fits(subject: str, fallback: str) -> str:
    """``subject`` when it fits the law's 60 characters, else the short form of the same fact."""
    return subject if len(subject) <= SUBJECT_LIMIT else fallback


# --- the ten templates ----------------------------------------------------------------
def account_created(data: dict[str, Any]) -> dict[str, str]:
    body = (
        _p("I'm Wobo. there's nothing to set up: pick something you're curious about and "
           "we'll start there. your first course is on me, written the moment you open it.")
    )
    preheader = "your account is ready, and so am I."
    html_out = _shell(
        preheader=preheader,
        heading=f"welcome{_comma_name(data)}",
        body=body,
        cta_label="start your first course",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"welcome{_comma_name(data)}\n\n"
        "I'm Wobo. there's nothing to set up: pick something you're curious about and we'll "
        "start there. your first course is on me.\n\n"
        f"start your first course: {_link(data, 'cta_url', '/learn')}\n\n"
        "— Wobo"
    ) + _shell_foot_text(data)
    return {
        "subject": "welcome to Wobo",
        "preheader": preheader,
        "html": html_out,
        "text": text,
    }


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
    # Not a restatement of the subject: the preheader says the one thing the subject cannot,
    # which is that there is a code as well as a link and that both die quickly.
    preheader = "the link works once, and there is a code if you would rather type it."
    html_out = _shell(
        preheader=preheader,
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
    ) + _shell_foot_text(data)
    return {
        "subject": "confirm your email",
        "preheader": preheader,
        "html": html_out,
        "text": text,
    }


def course_ready(data: dict[str, Any]) -> dict[str, Any]:
    """A course is built, in the shape the movie-poster law names (design, owner 2026-09-15).

    What this was, and why none of it survived: the old ultramarine shell, a bulleted list of
    three, ninety-three words of lowercase sentence fragments ("I built it for you just now...
    here's what's inside:"), no conceit, no figure, and a cursive em-dash sign-off. Rendered at
    390 it was the worst mail in the fleet, and it sat beside five nudges that are genuinely
    good, which made it read as a different product rather than merely an unstyled one.

    The law it is written to: ONE CONCEIT carried all the way and drawn from the thing the mail
    is about; the joke is honest (a poster is plainly a joke about a poster, so there is no
    invented reviewer and no invented rating — nothing docs/CLAIMS.md would refuse); under
    eighty words; one button that says what happens; and our own register rather than
    Brilliant's arch one. The turning sentence is the third: the list becomes the poster, and
    then the poster becomes the fact that the course is built.

    What is NOT here, named rather than quietly skipped: the law asks for one drawn figure from
    the board pipeline (docs/BOARD.md), in our own hand. That pipeline does not hand this
    template a figure yet, and a stock illustration is refused by the same law, so the mail
    carries the still mark and no picture. It reads whole without one.
    """
    audience = _audience(data)
    learner = _learner_name(data)
    name = "" if audience == "parent" else str(data.get("name") or "").strip().split(" ")[0][:40]
    topic = str(data.get("topic") or "").strip()
    named = topic or "it"
    headline = "If it had a poster"
    if audience == "parent":
        line = (
            f"One idea a screen, something to try on each, a boss at the end. That is the "
            f"poster for {named}, and {learner or 'your child'} can open it now."
        )
        cta_label = "See the course"
        subject_rest = f"has a course on {topic} ready" if topic else "has a course ready"
    else:
        line = (
            f"One idea a screen, something to try on each, a boss at the end. That is the "
            f"poster for {named}, and the course behind it is built."
        )
        cta_label = "Open the course"
        subject_rest = f"your course on {topic} is ready" if topic else "your course is ready"
    subject = _subject_with(name, learner, subject_rest)
    return _note(
        kind="course_ready",
        data=data,
        headline=headline,
        line=line,
        cta_label=cta_label,
        cta_url=_link(data, "cta_url", "/learn"),
        subject=_fits(subject, "Your course is ready"),
        why=_why(
            "a course you started is built.",
            audience,
            learner,
            cadence="It comes once, when a course is ready.",
        ),
    )


def boss_victory(data: dict[str, Any]) -> dict[str, str]:
    # heading reads "you beat the {topic} boss" — pass a bare noun phrase, no leading article
    raw_topic = str(data.get("topic", "topic")).removeprefix("the ")
    topic = _esc(raw_topic)
    # "+250 XP" at 34px in molten orange used to open this mail. docs/MAIL-PRIMARY.md names it
    # twice: a large coloured numeral above the fold is the most reliable promotional tell in a
    # rendered preview, and the register praises the behaviour, not the score. The score is still
    # the learner's; it lives on the screen where they earned it, not in the first thing they see
    # in an inbox.
    body = (
        _p("that wasn't a quiz, it was the real thing, and you worked it out yourself. "
             "that's the part that stays with you.")
        + _p("I've marked what you're solid on and what's worth a revisit later, so nothing "
             "you earned quietly slips away.")
    )
    preheader = "you worked it out yourself, and that is the part that stays."
    html_out = _shell(
        preheader=preheader,
        heading=f"you beat the {topic} boss",
        body=body,
        cta_label="see what's next",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"you beat the {raw_topic} boss\n\n"
        "that wasn't a quiz, it was the real thing, and you worked it out yourself.\n\n"
        "I've marked what you're solid on and what's worth a revisit later.\n\n"
        f"see what's next: {_link(data, 'cta_url', '/learn')}\n\n— Wobo"
    ) + _shell_foot_text(data)
    return {
        "subject": _fits(f"you beat the {raw_topic} boss", "you beat the boss"),
        "preheader": preheader,
        "html": html_out,
        "text": text,
    }


def level_up(data: dict[str, Any]) -> dict[str, str]:
    level = _esc(str(data.get("level", 4)))
    unlocked = data.get("unlocked") or [
        "synthesis boss battles across everything you know",
        "a sanctioned rabbit hole from where you stand",
        "the perturbation sandbox, where you break a law to understand it",
    ]
    body = (
        # Sentence case, and no uppercase transform: ALL CAPS above the fold is on the law's
        # never list (docs/MAIL-PRIMARY.md "What must never appear"), rendered or typed.
        f'<div style="margin:0 0 18px 0;font-family:{FONT};font-size:14px;font-weight:600;'
        f'letter-spacing:0.4px;color:{ACID};">Level {level}</div>'
        + _p("you've been showing up, and it shows. here's what just opened up for you:")
        + _bullets(unlocked)
        + _p("no rush to use all of it today. it'll be here when you're curious.")
    )
    preheader = "three roads opened from exactly where you are standing."
    html_out = _shell(
        preheader=preheader,
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
    ) + _shell_foot_text(data)
    return {
        "subject": f"you reached level {data.get('level', 4)}",
        "preheader": preheader,
        "html": html_out,
        "text": text,
    }


def streak_milestone(data: dict[str, Any]) -> dict[str, str]:
    days = _esc(str(data.get("days", 24)))
    # The heading already says the number in the reader's own sentence. The 34px molten repeat
    # above it was a large coloured numeral above the fold, which the law forbids for the same
    # reason as boss_victory's.
    body = (
        _p(f"that's {days} days you chose to think a little harder than you had to. that "
             "isn't a number, it's who you're becoming.")
        + _p("if you need a rest day, take it. a planned pause keeps this honest, and I'll "
             "hold your place. the streak is the habit, not the pressure.")
    )
    preheader = "a rest day is part of it, and I hold your place while you take it."
    html_out = _shell(
        preheader=preheader,
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
        "to.\n\nif you need a rest day, take it. I'll hold your place.\n\n"
        f"continue: {_link(data, 'cta_url', '/learn')}\n\n— Wobo"
    ) + _shell_foot_text(data)
    return {
        "subject": f"{data.get('days', 24)} days of being a learner",
        "preheader": preheader,
        "html": html_out,
        "text": text,
    }


def weekly_digest(data: dict[str, Any]) -> dict[str, str]:
    # No XP here. docs/MAIL-PRIMARY.md: the text part of every kind carries no percent sign and
    # no digit-plus-XP token, because a raw score in a summary is the newsletter's stat row in
    # another font. What a week was is said in topics and in minutes of thinking.
    minutes = _esc(str(data.get("minutes", 82)))
    topics = data.get("topics") or ["acids and bases", "the mole concept", "electric circuits"]
    bars = data.get("bars") or [
        ("acids and bases", "solid", 88),
        ("the mole concept", "growing", 61),
        ("electric circuits", "started", 34),
    ]
    line = _esc(str(data.get("line",
        "the circuits work is the one to keep warm this week, you're closer than it feels.")))
    # A summary is sentences. The stat row and the progress bars that used to stand here are the
    # visual grammar of a newsletter, and the percentages under them broke our own rule that a
    # mastery figure is never a percentage (docs/MAIL-PRIMARY.md §4). Each number is now the word
    # it stood for: solid, growing, started.
    body = (
        _p(f"here's your week{_comma_name(data)}. {_words(len(topics))} topics, and "
           f"{minutes} minutes of thinking.")
        + _bullets([f"{lbl}: {val}" for lbl, val, _pct in bars])
        + _p(line, color=SECONDARY)
    )
    preheader = "three topics, and the one worth keeping warm."
    html_out = _shell(
        preheader=preheader,
        heading=f"your week{_comma_name(data)}",
        body=body,
        cta_label="pick up where you left off",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"your week{_comma_name(data)}\n\n"
        f"{_words(len(topics))} topics, and {data.get('minutes', 82)} minutes of thinking.\n\n"
        + "".join(f"- {lbl}: {val}\n" for lbl, val, _pct in bars)
        + f"\n{data.get('line', '')}\n\n"
        f"pick up: {_link(data, 'cta_url', '/learn')}\n\n— Wobo"
    ) + _shell_foot_text(data)
    return {
        "subject": _fits(f"your week{_comma_name(data)}", "your week"),
        "preheader": preheader,
        "html": html_out,
        "text": text,
    }


def parent_report(data: dict[str, Any]) -> dict[str, str]:
    learner = _esc(str(data.get("learner_name", "your child")))
    strengths = data.get("strengths") or [
        ("independent problem-solving", "strong", 86),
        ("sticking with hard problems", "strong", 79),
        ("connecting ideas across topics", "growing", 64),
    ]
    focus = data.get("focus") or ["speed under time pressure", "revising older topics"]
    trajectory = _esc(str(data.get("trajectory",
        "on track to master this term's core science ahead of the exam window")))
    # Sentences and sentence case. The bars, the chips and the percentages are gone for the
    # reason docs/MAIL-PRIMARY.md gives: a bar chart is the grammar of a newsletter, and a
    # mastery figure written as a percentage is forbidden by our own voice law (§6).
    body = (
        _p(f"a quiet look at {learner}'s week{_comma_name(data, 'parent_name')}, drawn from "
           "their own work, not a test. this is who they're becoming.")
        + f'<p style="margin:0 0 8px 0;font-family:{FONT};font-size:13px;font-weight:600;'
          f'letter-spacing:0.4px;color:{SECONDARY};">Strengths</p>'
        + _bullets([f"{lbl}: {val}" for lbl, val, _pct in strengths])
        + f'<p style="margin:0 0 8px 0;font-family:{FONT};font-size:13px;font-weight:600;'
          f'letter-spacing:0.4px;color:{SECONDARY};">Worth a nudge</p>'
        + _bullets(list(focus))
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
    preheader = "drawn from their own work, not from a test."
    html_out = _shell(
        preheader=preheader,
        heading=f"{learner}'s week",
        body=body,
        cta_label="write to us",
        cta_url=_link(data, "cta_url", "/contact"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"{data.get('learner_name', 'your child')}'s week\n\nstrengths:\n"
        + "".join(f"- {lbl}: {val}\n" for lbl, val, _pct in strengths)
        + "\nworth a nudge: " + ", ".join(focus) + "\n\n"
        f"trajectory: {data.get('trajectory', '')}\n\n"
        "this note is the whole report for now: a parent does not have a login yet. "
        f"reply to this, or write to {REPLY_TO}, and a person answers.\n\n"
        "— Wobo"
    ) + _shell_foot_text(data)
    raw_learner = str(data.get("learner_name", "your child"))
    return {
        "subject": _fits(f"{raw_learner}'s week at {APP_NAME}", f"the week at {APP_NAME}"),
        "preheader": preheader,
        "html": html_out,
        "text": text,
    }


def reengage(data: dict[str, Any]) -> dict[str, str]:
    hook = _esc(str(data.get("hook",
        "you were one screen away from cracking why the missing 2ab rectangles complete the square")))
    body = (
        _p("no guilt here, life gets loud. but you left something half-finished, and it's "
           "the good kind of half-finished.")
        + f'<div style="margin:0 0 20px 0;padding:16px 18px;border-left:3px solid {ULTRA};'
          f'background-color:{TRACK};border-radius:3px;font-family:{FONT};font-size:15px;'
          f'line-height:1.5;color:{INK};">{hook}</div>'
        + _p("give it ten minutes. I'll pick up exactly where we stopped, nothing to retrace.")
    )
    preheader = "it picks up exactly where the two of us stopped."
    html_out = _shell(
        preheader=preheader,
        heading=f"it's been a minute{_comma_name(data)}",
        body=body,
        cta_label="come back to it",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"it's been a minute{_comma_name(data)}\n\n"
        "no guilt here. but you left something half-finished, the good kind.\n\n"
        f"{data.get('hook', '')}\n\ngive it ten minutes. I'll pick up where we stopped.\n\n"
        f"come back: {_link(data, 'cta_url', '/learn')}\n\n— Wobo"
    ) + _shell_foot_text(data)
    return {
        "subject": _fits(f"it's been a minute{_comma_name(data)}", "it's been a minute"),
        "preheader": preheader,
        "html": html_out,
        "text": text,
    }


#: THE MONEY'S VOICE, quoted (docs/copy/money.md, "plan opened mail"; the owner, 2026-09-15, and
#: docs/SELL.md "The money's voice"). The document is the source and this is a copy of it word for
#: word: ``tests/test_money_voice.py`` reads that file off disk and fails if the two ever differ,
#: so the mail and the plans page say the same sentence rather than two versions of it.
MONEY_PLAN_OPENED = "Thank you for choosing a plan. It pays for the drawings, the voice, and the next child's first lesson."  # noqa: E501


def plan_opened(data: dict[str, Any]) -> dict[str, str]:
    """The whole plan is on for a while, said as a fact. Account mail, and it belongs in Updates.

    This kind used to be ``premium_surprise``: a large magenta numeral, "a gift", "I've
    unlocked", "no strings", and a button reading "enjoy premium". docs/MAIL-PRIMARY.md §4 names
    it exactly: a coupon mail written in four registers of offer language, and no shaping saves
    it. The law offers two ways out, delete it or rewrite it as a plain account fact. This is the
    second. What the reader is owed is the date it ends and the fact that nothing is to be
    entered; everything else was salesmanship about a decision we had already made.
    """
    until = _esc(str(data.get("until", "")).strip())
    days = _count(data, "days")
    when = f"until {until}" if until else (f"for {_words(days)} more days" if days else "for now")
    body = (
        _p(f"your plan is open {when}. nothing to enter and nothing to set up: it is already on "
           "the account you are signed in to.")
        + _p("follow a rabbit hole, build something out of syllabus, take a harder road through "
             "a chapter. it is the same Wobo, with the ceiling lifted.")
        # WHERE THE MONEY GOES, once, at the end. Last rather than first because the reader opened
        # this to learn a fact about their account, and the thanks is owed after the fact, not
        # instead of it; the mail law scans the FIRST sentence for anything that sounds like an
        # offer, and this must never become that sentence.
        + _p(MONEY_PLAN_OPENED)
    )
    preheader = "nothing to enter, and nothing to set up."
    html_out = _shell(
        preheader=preheader,
        heading=f"your plan is open {when}",
        body=body,
        cta_label="open Wobo",
        cta_url=_link(data, "cta_url", "/learn"),
        unsubscribe_url=_unsubscribe(data),
        postal_address=_postal(data),
    )
    text = (
        f"your plan is open {when}\n\n"
        "nothing to enter and nothing to set up: it is already on the account you are signed "
        "in to.\n\nfollow a rabbit hole, build something out of syllabus, take a harder road "
        "through a chapter.\n\n"
        f"{MONEY_PLAN_OPENED}\n\n"
        f"open Wobo: {_link(data, 'cta_url', '/learn')}\n\n— Wobo"
    ) + _shell_foot_text(data)
    return {
        "subject": _fits(f"your plan is open {when}", "your plan is open"),
        "preheader": preheader,
        "html": html_out,
        "text": text,
    }


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

# 13px and #4E4E66: 7.0:1 on the cream paper. The size is the law's, the colour was already
# right and only the size was wrong.
_HAND_FOOT_LINK = 'style="color:#4E4E66;font-size:13px"'


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
        + _DARK_HEAD
        + f"<title>{_esc(APP_NAME)}</title></head>"
        f'<body class="wobo-paper" style="margin:0;padding:0;background:{_PAPER_EDGE};font-family:{_HAND}">'
        f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:{_PAPER_EDGE};font-size:1px;line-height:1px;">{_esc(preheader)}</div>'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        f'class="wobo-paper" style="background:{_PAPER_EDGE}"><tr><td align="center" style="padding:32px 0">'
        '<table role="presentation" width="640" cellspacing="0" cellpadding="0" class="wobo-card" '
        f'style="width:100%;max-width:640px;background:{_PAPER};border-radius:24px;overflow:hidden;font-family:{_HAND};color:{_NAVY}">'
        f"{rows}"
        "</table></td></tr></table></body></html>"
    )


def _hand_head(stamp: str) -> str:
    """The wordmark and the moment it was written ("Sunday, 6 pm")."""
    return (
        '<tr><td style="padding:28px 32px 0">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
        f'<td class="wobo-ink" style="font:700 26px/1 {_HAND};letter-spacing:-1px;color:{_NAVY}">{_esc(APP_NAME.lower())}</td>'
        f'<td align="right" class="wobo-quiet" style="font:400 13px/1 {_HAND};color:{_FOOT_PROSE_PAPER}">{_esc(stamp)}</td>'
        "</tr></table></td></tr>"
    )


def _orb_signature(margin_top: int) -> str:
    """The orb and the sign-off, drawn ONCE for every mail on the paper.

    The library's first rule (docs/EMAILS-AND-ANIMATIONS.md §8): one source, and a move drawn by
    hand a second time is a bug. The moving orb belongs to the app (`wobo/Companion.tsx`) and mail
    gets it as a GIF rendered from that component; until those frames exist this still mark is the
    orb mail has, and it exists in exactly one function so a sixth template cannot redraw it.
    """
    return (
        f'<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:{margin_top}px"><tr>'
        f'<td class="wobo-orb-disc" style="width:36px;height:36px;border-radius:18px;background:{_NAVY};text-align:center;vertical-align:middle">'
        f'<span class="wobo-orb-visor" style="display:inline-block;width:24px;height:11px;border-radius:6px;background:{_PAPER};position:relative;top:1px;text-align:center">'
        f'<span class="wobo-orb-eye" style="display:inline-block;width:5px;height:5px;border-radius:3px;background:{_WOBO_BLUE};margin:3px 2px 0"></span>'
        f'<span class="wobo-orb-eye" style="display:inline-block;width:5px;height:5px;border-radius:3px;background:{_WOBO_BLUE};margin:3px 2px 0"></span>'
        "</span></td>"
        f'<td class="wobo-ink" style="padding-left:10px;font:700 22px/1 {_HAND_CURSIVE};color:{_NAVY}">&mdash; {_esc(APP_NAME)}</td>'
        "</tr></table>"
    )


def _hand_foot(first_line: str, links: str, postal: str) -> str:
    """The quiet footer: why you got this, the switches, the legal line, the postal address."""
    return (
        f'<tr><td class="wobo-quiet" style="padding:28px 32px 26px;font:400 12px/1.6 {_HAND};color:{_FOOT_PROSE_PAPER}">'
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
            f'<div class="wobo-ink" style="font:600 27px/1.2 {_HAND_CURSIVE};color:{_NAVY}">{note_html}</div>'
            + _orb_signature(14)
            + "</td></tr></table></td></tr>"
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
        "Nothing else comes from it, and a reply reaches a person. "
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
        "Nothing else comes from it, and a reply reaches a person.",
        *([f"Change when it arrives: {prefs}"] if prefs else []),
        f"Stop the notes: {unsub}",
        f"{APP_NAME} · {_APP_HOST} · Privacy: {_privacy_url()}",
        f"Security and trust: {_trust_url()}",
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
    # The first mail a learner ever gets was the only subscribed kind with NO stop route in its
    # body at all: its four destinations were the site, the legal pages and /you, and the footer
    # offered "Email settings", which is the sign-in-gated preferences page that
    # docs/MAIL-PRIMARY.md warns by name against treating as an unsubscribe. The header was
    # honoured and the page was not, so a reader who wanted out had to sign in to get out.
    unsub = _unsubscribe(data)

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
        f'<a href="{_esc(prefs, quote=True)}" {_HAND_FOOT_LINK}>Email settings</a> &middot; '
        f'<a href="{_esc(unsub, quote=True)}" {_HAND_FOOT_LINK}>Stop these</a>',
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
            f"Stop these: {unsub}",
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
        "It comes when you finish something, never on a schedule. "
        "Reply to this note and a person answers. "
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
        "It comes when you finish something, never on a schedule.",
        "Reply to this note and a person answers.",
        f"Fewer emails: {prefs}",
        f"None at all: {unsub}",
        f"{APP_NAME} · {_APP_HOST} · Privacy: {_privacy_url()}",
        f"Security and trust: {_trust_url()}",
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
        f'<div class="wobo-ink" style="font:600 30px/1.2 {_HAND_CURSIVE};color:{_NAVY}">{_esc(line)}</div>'
        + _orb_signature(16)
        + "</td></tr></table></td></tr>"
    )
    rows += (
        '<tr><td style="padding:22px 32px 0">'
        f'<div style="font:400 15px/1.55 {_HAND};color:{_MUTED}">Nothing to do today. Come back when you come back.</div>'
        "</td></tr>"
    )
    why = (
        "You get this because your family chose to be wished on these days."
        " It comes once on the day, and never twice."
        " Reply to this note and a person answers."
        if chosen
        else "You get this because today is a holiday where your family told me you are."
        " It comes once on the day, and never twice."
        " Reply to this note and a person answers."
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
            f"Security and trust: {_trust_url()}",
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


def _decline_headers(decline: str) -> dict[str, str]:
    """RFC 8058 headers for the parent invite, keyed on the signed decline route."""
    if not decline or "token=" not in decline or not decline.startswith(parent_route_url("decline")):
        return {}
    return {
        "List-Unsubscribe": f"<{decline}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }


def parent_invite(data: dict[str, Any]) -> dict[str, Any]:
    """05 · The parent invite, to the parent, the moment a learner types their address.

    Account mail, sent once, with no dial: nothing else ever comes unless the parent says yes on
    the accept page, and "Not me" is the parent's way out with no login (``decline_url``, signed
    and single-use, parents.py). It is also a cold message to an adult who never gave us their
    address, so docs/MAIL-PRIMARY.md §2 gives it the subscribed treatment: List-Unsubscribe
    points at that same decline route, one-click (:func:`_decline_headers`). No plan
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
        f'<div class="wobo-ink" style="font:400 16px/1.55 {_HAND};color:{_NAVY}">{_esc(what)}</div>'
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
        # A cold message to an adult who never gave us their address is the one mail that most
        # needs a header the client can act on (docs/MAIL-PRIMARY.md §2 calls it the single
        # riskiest mail we send). The target is the signed decline route, which is a page under
        # GET and only declines under POST — exactly what RFC 8058 requires — so the one-click
        # promise is made only when a token is actually on the link.
        "headers": _decline_headers(decline),
    }


# --- the five nudges (docs/EMAILS-AND-ANIMATIONS.md §1, in the Brilliant shape) ---------------
# One animated character doing ONE thing, a headline of two to four words, one line, one button
# that lands on the exact card, a hairline, and a footer that says why it came. Nothing else
# above the fold, and nothing that sells: docs/MAIL-PRIMARY.md is the law these are written to.
#
# THE ORB. Each kind names its move (§8's library) and carries no other. The moving GIF is
# rendered from the app's own orb and is not in the tree yet, so these mails ship with the still
# mark from :func:`_orb_signature` and read complete with images off — which is also what
# MAIL-PRIMARY §3 requires of the day the GIF arrives: at most one image, with alt text, and the
# message whole without it. ``orb_url`` is the seam; a template never draws a move itself.

#: The five kinds, in the order §1 lists them.
NUDGE_KINDS: tuple[str, ...] = ("quick_one", "mid_chapter", "streak", "bonus_level", "doubt")

#: The one move each nudge carries (§2, §8). One thing at a time, never two.
ORB_MOVES: dict[str, str] = {
    "quick_one": "hover",
    "mid_chapter": "wave",
    "streak": "bounce",
    "bonus_level": "spark",
    "doubt": "reading",
}

#: Where the rendered moves are published. They are written by ``tools/orb/render.mjs`` from the
#: app's own orb into ``content/brand/orb`` and served with the app, so a mail client fetches the
#: same picture the product draws: one source, which is rule 1 of the library.
ORB_BASE_URL = (os.getenv("EMAIL_ORB_BASE_URL") or f"{APP_URL}/brand/orb").rstrip("/")


def orb_images_on() -> bool:
    """Is the mail allowed to carry a picture yet? Off until the seed test says so.

    This is a GATE, not a feature flag, and docs/MAIL-PRIMARY.md wrote it: the orb GIF "takes
    every template from zero remote fetches to one and is the single largest planned change to
    our promotional profile. Measure the same five mails before and after, same sending
    identity, one variable, or ship nothing." Zero remote fetches is described in the same law
    as the fleet's single greatest asset, so it is not spent on a guess.

    The measurement is :func:`wobo_gateway.email.record_seed_placement`. When it has been run
    before and after, the owner turns this on with one environment variable and no deploy.
    """
    return (os.getenv("MAIL_ORB_IMAGES") or "").strip().lower() in {"1", "on", "true", "yes"}


def brand_orb_url(move: str) -> str:
    """The published GIF for one move, or "" while the gate is shut.

    ``ORB_MOVES`` named a move for every nudge and NOTHING read it; ``orb_url`` was read by the
    template and NOTHING wrote it. So the two halves of the owner's brief — one animated
    character doing one thing — never met, and not one mail carried an orb. This is the producer
    that was missing, and it is the only one: a template never builds an image URL itself.
    """
    if not move or not orb_images_on():
        return ""
    return f"{ORB_BASE_URL}/{move}.gif"

_HAIRLINE_MARK = "<!--hairline-->"


def _note_doc(*, preheader: str, rows: str) -> str:
    """The paper, told what it is in the dark.

    Gmail, Outlook and Apple all darken a mail that does not declare a scheme, and what they do
    to a cream card with navy ink on it is not a choice anybody made. So the document declares
    both schemes and repaints the four things that must move — the ground, the card, the ink and
    the quiet text — by class, under ``prefers-color-scheme``. Everything else is a tonal tile
    with its own inline colour and reads in both.
    """
    return (
        "<!DOCTYPE html>"
        '<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="x-apple-disable-message-reformatting">'
        + _SCHEME_META
        + _DARK_STYLE
        + f"<title>{_esc(APP_NAME)}</title></head>"
        f'<body class="wobo-paper" style="margin:0;padding:0;background:{_PAPER_EDGE};font-family:{_HAND}">'
        f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:{_PAPER_EDGE};font-size:1px;line-height:1px;">{_esc(preheader)}</div>'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        f'class="wobo-paper" style="background:{_PAPER_EDGE}"><tr><td align="center" style="padding:32px 0">'
        '<table role="presentation" width="640" cellspacing="0" cellpadding="0" class="wobo-card" '
        f'style="width:100%;max-width:640px;background:{_PAPER};border-radius:24px;overflow:hidden;font-family:{_HAND};color:{_NAVY}">'
        f"{rows}"
        "</table></td></tr></table></body></html>"
    )


def _note_head(stamp: str) -> str:
    """The wordmark and the moment, in the dark-aware ink."""
    return (
        '<tr><td style="padding:28px 32px 0">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
        f'<td class="wobo-ink" style="font:700 26px/1 {_HAND};letter-spacing:-1px;color:{_NAVY}">{_esc(APP_NAME.lower())}</td>'
        f'<td align="right" class="wobo-quiet" style="font:400 13px/1 {_HAND};color:{_FOOT_PROSE_PAPER}">{_esc(stamp)}</td>'
        "</tr></table></td></tr>"
    )


def _audience(data: dict[str, Any]) -> str:
    """Who is reading: the learner, or the parent who holds an under-13's account.

    ``parent`` is not a style: it is the children's privacy law (docs/legal/childrens-privacy.md
    §2, docs/copy/childrens-privacy). Below thirteen the mail goes to the parent, about the
    child, and nothing in it addresses the child or asks the parent to push them.
    """
    return "parent" if str(data.get("audience") or "").strip().lower() == "parent" else "learner"


def _learner_name(data: dict[str, Any]) -> str:
    """The learner's first name as the copy may use it, or "" when we do not have one.

    Never "there": a missing name means the sentence is rewritten without a name
    (docs/copy/voice.md §10a, docs/MAIL-PRIMARY.md §4).
    """
    for key in ("learner_name", "name"):
        value = str(data.get(key) or "").strip()
        if value:
            return value.split()[0][:40]
    return ""


def _subject_with(name: str, learner_first: str, rest: str) -> str:
    """The subject: the name and a verb, and the sentence rewritten when there is no name."""
    if name:
        return f"{name}, {rest}"
    if learner_first:
        return f"{learner_first} {rest}"
    return rest[0].upper() + rest[1:] if rest else APP_NAME


def _note(
    *,
    kind: str,
    data: dict[str, Any],
    headline: str,
    line: str,
    cta_label: str,
    cta_url: str,
    subject: str,
    why: str,
) -> dict[str, Any]:
    """One nudge, drawn. Every kind above is this function with five different sentences."""
    stamp = str(data.get("stamp") or "Just now")
    prefs, unsub = _preferences(data), _unsubscribe(data)
    orb = _safe_url(data.get("orb_url"), "")
    # ``None`` for a kind that carries no move of its own (course_ready draws the concept, not
    # the character), and then the still mark stands in exactly as it does before a GIF exists.
    move = ORB_MOVES.get(kind)

    rows = _note_head(stamp)
    rows += (
        '<tr><td style="padding:30px 32px 0">'
        # The character, doing one thing. A rendered GIF when the library has one, the still mark
        # when it does not; the mail is whole either way.
        + (
            f'<img src="{_esc(orb, quote=True)}" width="96" height="96" alt="{_esc(APP_NAME)}" '
            f'style="display:block;border:0;outline:none;text-decoration:none;margin:0 0 18px 0" />'
            if orb
            else _orb_signature(0) + '<div style="height:18px;font-size:0;line-height:0">&nbsp;</div>'
        )
        + f'<div class="wobo-ink" style="font:700 32px/1.1 {_HAND};letter-spacing:-1px;color:{_NAVY}">{_esc(headline)}</div>'
        + f'<div class="wobo-ink" style="font:400 17px/1.55 {_HAND};color:{_MUTED};margin-top:12px">{_esc(line)}</div>'
        "</td></tr>"
    )
    rows += (
        '<tr><td style="padding:24px 32px 0">'
        '<table role="presentation" cellspacing="0" cellpadding="0"><tr>'
        f'<td style="background:{_WOBO_BLUE};border-radius:12px"><a href="{_esc(cta_url, quote=True)}" style="display:inline-block;padding:14px 22px;font:500 15px/1 {_HAND};color:#FFFFFF;text-decoration:none">{_esc(cta_label)}</a></td>'
        "</tr></table></td></tr>"
    )
    rows += (
        f'<tr><td style="padding:28px 32px 0">{_HAIRLINE_MARK}'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="border-top:1px solid {_PAPER_EDGE};font-size:0;line-height:0">&nbsp;</td></tr></table>'
        "</td></tr>"
    )
    rows += (
        f'<tr><td class="wobo-quiet" style="padding:18px 32px 26px;font:400 12px/1.6 {_HAND};color:{_FOOT_PROSE_PAPER}">'
        f"{_esc(why)} "
        f'<a href="{_esc(prefs, quote=True)}" {_HAND_FOOT_LINK}>Fewer emails</a> &middot; '
        f'<a href="{_esc(unsub, quote=True)}" {_HAND_FOOT_LINK}>Stop this one</a><br>'
        f"{_esc(APP_NAME)} &middot; {_esc(_APP_HOST)} &middot; "
        f'<a href="{_esc(_privacy_url(), quote=True)}" {_HAND_FOOT_LINK}>Privacy</a><br>'
        f"{_esc(_postal(data))}"
        "</td></tr>"
    )

    text = "\n".join(
        [
            headline,
            line,
            "",
            f"{cta_label}: {cta_url}",
            "",
            why,
            f"Fewer emails: {prefs}",
            f"Stop this one: {unsub}",
            f"{APP_NAME} · {_APP_HOST} · Privacy: {_privacy_url()}",
            _postal(data),
        ]
    )
    return {
        "subject": subject,
        "preheader": line,
        "headline": headline,
        "line": line,
        "orb_move": move,
        "html": _note_doc(preheader=line, rows=rows),
        "text": text,
        "headers": _list_unsubscribe(data),
    }


def _why(kind_line: str, audience: str, learner: str, *, cadence: str = "") -> str:
    """Why this arrived, in the reader's own register.

    Three sentences, and every one of them earns its place: why this mail exists, the cadence it
    is held to (the inbox law, said plainly rather than promised vaguely), and the way to a
    person. The third is not a courtesy: a reply is what tells a mailbox provider that this is
    correspondence, and a parent who cannot answer a mail about their child has been sent a
    leaflet. It is also what carries the rendered text part over the 500-character floor that
    docs/MAIL-PRIMARY.md §3 names, which is the one length threshold with evidence behind it.

    TWO THINGS THIS USED TO GET WRONG, both in the sentence a worried parent reads.

    The first sentence was false and the product knew it. Every mail said "you asked me to say
    when a card is waiting", and no learner ever asked: ``MailPreferences`` defaults all five
    nudge dials to ``True``, so consent is assumed at account creation. Reporting that back to
    the reader as a request they made is the kind of claim docs/CLAIMS.md refuses. What is true
    is that they have an account and the switch is on, and that is what it says now.

    The second was a broken sentence. The parent branch interpolated ``kind_line`` verbatim
    after a full stop, and every line began lower case for the learner branch's benefit, so the
    parent register read "...comes to you. you asked me to say when a card is waiting." That was
    the ONLY register a nudge ever used, because an unknown age is treated as a child. The line
    is now written audience-neutral, about the switch rather than about "you", and capitalised
    where it opens a sentence.
    """
    opener = f"{kind_line[0].upper()}{kind_line[1:]}" if kind_line else ""
    lowered = f"{kind_line[0].lower()}{kind_line[1:]}" if kind_line else ""
    if audience == "parent":
        who = learner or "your child"
        held = cadence or "It comes at most twice a week, and never on a day they came in."
        return (
            f"You get this because {who} is under thirteen, so mail about their learning comes "
            f"to you. {opener} {held} Reply to this note and a person answers."
        )
    held = cadence or "It comes at most twice a week, and never on a day you came in."
    return (
        f"You get this because you have a {APP_NAME} account and {lowered} {held} "
        f"Reply to this note and a person answers."
    )


def quick_one(data: dict[str, Any]) -> dict[str, Any]:
    """A quick one: forty-eight hours without a lesson, at the hour they usually learn."""
    audience = _audience(data)
    learner = _learner_name(data)
    name = "" if audience == "parent" else str(data.get("name") or "").strip().split(" ")[0][:40]
    chapter = str(data.get("chapter") or "").strip()
    minutes = _count(data, "minutes") or 5
    spoken = _words(minutes)
    headline = f"{spoken.capitalize()} minutes."
    if audience == "parent":
        line = (
            f"{learner or 'Your child'} left {chapter} waiting. It takes {spoken} minutes."
            if chapter
            else f"{learner or 'Your child'} has a card waiting. It takes {spoken} minutes."
        )
        subject_rest = f"left {chapter} waiting" if chapter else "has a card waiting"
        cta_label = "See the card"
    else:
        line = (
            f"{chapter} is waiting. It takes {spoken}."
            if chapter
            else f"The next card is waiting. It takes {spoken}."
        )
        subject_rest = f"pick up {chapter}" if chapter else "pick up where you stopped"
        cta_label = "Open the card"
    return _note(
        kind="quick_one",
        data=data,
        headline=headline,
        line=line,
        cta_label=cta_label,
        cta_url=_link(data, "cta_url", "/learn"),
        subject=_subject_with(name, learner, subject_rest),
        why=_why("notes about a waiting card are switched on.", audience, learner),
    )


def mid_chapter(data: dict[str, Any]) -> dict[str, Any]:
    """Mid-chapter: a chapter left half done, a day later."""
    audience = _audience(data)
    learner = _learner_name(data)
    name = "" if audience == "parent" else str(data.get("name") or "").strip().split(" ")[0][:40]
    chapter = str(data.get("chapter") or "").strip()
    left = _count(data, "cards_left")
    spoken = _words(left) if left else "a few"
    cards = "card" if left == 1 else "cards"
    where = f" in {chapter}" if chapter else ""
    if audience == "parent":
        headline = f"{spoken.capitalize()} {cards} left."
        line = f"{learner or 'Your child'} has {spoken} {cards} left{where}."
        subject_rest = f"has {spoken} {cards} left{where}"
        cta_label = "See the card"
    else:
        headline = "You were here."
        line = f"{spoken.capitalize()} {cards} are left{where}."
        subject_rest = f"{spoken} {cards} are left{where}"
        cta_label = "Finish the chapter"
    return _note(
        kind="mid_chapter",
        data=data,
        headline=headline,
        line=line,
        cta_label=cta_label,
        cta_url=_link(data, "cta_url", "/learn"),
        subject=_subject_with(name, learner, subject_rest),
        why=_why("notes about a chapter nearly done are switched on.", audience, learner),
    )


def streak(data: dict[str, Any]) -> dict[str, Any]:
    """The streak: day three, day seven, day thirty, the morning after."""
    audience = _audience(data)
    learner = _learner_name(data)
    name = "" if audience == "parent" else str(data.get("name") or "").strip().split(" ")[0][:40]
    days = _count(data, "days") or 3
    spoken = _words(days)
    headline = f"{spoken.capitalize()} days."
    if audience == "parent":
        line = f"{learner or 'Your child'} has come in {spoken} days running."
        subject_rest = f"is on {spoken} days"
        cta_label = "See the week"
    else:
        line = f"{spoken.capitalize()} days in a row. Today makes {_words(days + 1)}."
        subject_rest = f"you are on {spoken} days"
        cta_label = "Keep it going"
    return _note(
        kind="streak",
        data=data,
        headline=headline,
        line=line,
        cta_label=cta_label,
        cta_url=_link(data, "cta_url", "/"),
        subject=_subject_with(name, learner, subject_rest),
        why=_why("notes about days in a row are switched on.", audience, learner),
    )


def bonus_level(data: dict[str, Any]) -> dict[str, Any]:
    """A bonus level: a side door opened on the climb. Optional, and said to be optional."""
    audience = _audience(data)
    learner = _learner_name(data)
    name = "" if audience == "parent" else str(data.get("name") or "").strip().split(" ")[0][:40]
    between = str(data.get("between") or data.get("chapter") or "").strip()
    where = f" between {between}" if between else ""
    headline = "A side door."
    if audience == "parent":
        line = f"A game opened{where} for {learner or 'your child'}. Optional."
        subject_rest = f"has a side door open{where}"
        cta_label = "See the side door"
    else:
        line = f"There is a game{where}. Optional."
        subject_rest = f"a side door opened{where}"
        cta_label = "Open the side door"
    return _note(
        kind="bonus_level",
        data=data,
        headline=headline,
        line=line,
        cta_label=cta_label,
        cta_url=_link(data, "cta_url", "/learn"),
        subject=_subject_with(name, learner, subject_rest),
        why=_why("notes about a side door opening are switched on.", audience, learner),
    )


def doubt(data: dict[str, Any]) -> dict[str, Any]:
    """Your doubt: a photographed page is answered, and the answer was not read live."""
    audience = _audience(data)
    learner = _learner_name(data)
    name = "" if audience == "parent" else str(data.get("name") or "").strip().split(" ")[0][:40]
    chapter = str(data.get("chapter") or "").strip()
    about = f" on {chapter}" if chapter else ""
    if audience == "parent":
        headline = "The page, solved."
        line = f"The page {learner or 'your child'} photographed{about}, explained."
        subject_rest = f"has an answer waiting{about}"
        cta_label = "See the answer"
    else:
        headline = "Your page, solved."
        line = f"The page you photographed{about}, explained."
        subject_rest = f"your page{about} is explained"
        cta_label = "Read the answer"
    return _note(
        kind="doubt",
        data=data,
        headline=headline,
        line=line,
        cta_label=cta_label,
        cta_url=_link(data, "cta_url", "/doubt"),
        subject=_subject_with(name, learner, subject_rest),
        why=_why(
            "notes about a photographed page being answered are switched on.", audience, learner
        ),
    )


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
    # ``premium_surprise`` was renamed ``plan_opened`` when the coupon copy was taken out of it
    # (docs/MAIL-PRIMARY.md §4). The old key is not kept as an alias: nothing sends it, and a
    # name that says "surprise" would invite the copy back.
    "plan_opened": plan_opened,
    "sunday_note": sunday_note,
    "welcome": welcome,
    "win": win,
    "wish": wish,
    "parent_invite": parent_invite,
    # the five nudges
    "quick_one": quick_one,
    "mid_chapter": mid_chapter,
    "streak": streak,
    "bonus_level": bonus_level,
    "doubt": doubt,
}

KINDS = tuple(TEMPLATES)

# The three drawn by hand (design/email-v1.html) and the wish drawn on the same paper: the
# hospitality mail, every one of which carries an off switch (email.py holds a live send of these
# until a signed stop link rides along). The rest share the ultramarine shell.
HAND_KINDS = frozenset({"sunday_note", "welcome", "win", "wish"})
# Everything drawn on the paper — the four above and the parent invite, which is account mail
# sent once with "Not me" as its way out rather than a list to unsubscribe from.
PAPER_KINDS = HAND_KINDS | {"parent_invite"}
# Drawn on the NOTE document (:func:`_note_doc`): the five nudges in the Brilliant shape, and
# course_ready, which joined them when the movie-poster law was applied to it. What they share is
# not a mood but a construction — one conceit, a headline, one line, one button, a footer that
# says why it came — so a test that asks "is this the ultramarine shell" must exclude them by
# this name rather than by listing kinds it happens to know about.
NOTE_KINDS: frozenset[str] = frozenset(NUDGE_KINDS) | {"course_ready"}


# --- who is owed a way out (docs/MAIL-PRIMARY.md §2) -------------------------------------------
# TRANSACTIONAL mail carries no List-Unsubscribe and no List-Id: Google excludes password resets,
# receipts, confirmations and one-time codes, and an unsubscribe link on a verification code is a
# way for a person to lock themselves out of their own account.
TRANSACTIONAL_KINDS: frozenset[str] = frozenset(
    {"verify_email", "account_created", "plan_opened"}
)

# Everything else is SUBSCRIBED and carries both headers. This used to be true of the paper set
# alone, which meant seven subscribed messages went out with no unsubscribe header at all and
# nothing held them: the largest defect the mail law found in this file. :func:`render` now
# attaches the headers for every kind here, and ``email.send_email`` holds a live send whose
# rendered headers still lack one.
SUBSCRIBED_KINDS: frozenset[str] = frozenset(set(TEMPLATES) - TRANSACTIONAL_KINDS)


def render(kind: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Render one template to {subject, html, text[, preheader, headers]}. Raises KeyError on an
    unknown kind. ``headers`` (List-Unsubscribe) and ``preheader`` are present on the hand-drawn
    kinds; the send path forwards ``headers`` to the provider verbatim.

    Every SUBSCRIBED kind gets its unsubscribe headers here when its own template did not build
    them, so a template can never be the reason a reader has no way out but Block.
    """
    out = TEMPLATES[kind](data or {})
    if kind in SUBSCRIBED_KINDS and not out.get("headers"):
        out = {**out, "headers": _list_unsubscribe(data or {})}
    return out


# --- the register, scanned (docs/MAIL-PRIMARY.md "What must never appear") --------------------
# The law's own list, as a function every template is run through in the suite. Register first:
# this is not how Wobo talks. Category second: Google's model of a promotion is deals, discount
# codes and product imagery, so this vocabulary tells a classifier what the mail IS rather than
# tricking it. The list is not a spam-word blocklist and must never be defended as one.
PROMOTIONAL_WORDS: tuple[str, ...] = (
    "free",
    "offer",
    "deal",
    "deals",
    "discount",
    "save",
    "exclusive",
    "limited",
    "gift",
    "unlock",
    "unlocked",
    "on us",
    "no strings",
    "act now",
    "last chance",
    "don't miss",
    "hurry",
    "premium",
)

#: The exceptions, each a fact rather than an offer. The law names the first; the second is the
#: daily allowance, which the copy law (DESIGN.md §0, voice.md §8) forbids us to COUNT, so the
#: word is the only honest way left to say what the plan is.
_PROMO_EXCEPTIONS: tuple[str, ...] = ("the free plan", "free every day")

#: The sign-off is a mark, not a sentence: "— Wobo" under what Wobo said is the design's own
#: signature (design/email-v1.html), and the em dash law is about prose a person reads. Every
#: other em dash is still a finding.
_SIGN_OFF = re.compile(rf"(?:&mdash;|—)\s*{re.escape(APP_NAME)}")

_TAG = re.compile(r"<[^>]+>")
_ENTITY = re.compile(r"&(#\d+|[a-z]+);")
_EMOJI = re.compile(
    "[\U0001f000-\U0001faff☀-➿←-⇿⬀-⯿️]", re.UNICODE
)
_CAPS = re.compile(r"\b[A-Z]{3,}\b")


def text_of(email: dict[str, Any]) -> str:
    """The plain-text part a person reads. What every length and register rule is measured on."""
    return str(email.get("text") or "")


def _visible(html_out: str) -> str:
    """The words a reader sees, with the markup taken out."""
    stripped = _TAG.sub(" ", html_out)
    return _ENTITY.sub(" ", stripped)


def promotional_problems(email: dict[str, Any], kind: str | None = None) -> list[str]:
    """Everything in this rendered mail that the mail law forbids. Empty is the only pass.

    Run over EVERY template and every subject by the suite. A new kind cannot be added without
    meeting the same bar as the five nudges, which is the whole point of scanning rather than
    reviewing.
    """
    subject = str(email.get("subject") or "")
    text = _SIGN_OFF.sub(" ", text_of(email))
    html_out = _SIGN_OFF.sub(" ", str(email.get("html") or ""))
    visible = _visible(html_out)
    problems: list[str] = []

    def scan(where: str, blob: str) -> None:
        lowered = blob.lower()
        for exception in _PROMO_EXCEPTIONS:
            lowered = lowered.replace(exception, " ")
        for word in PROMOTIONAL_WORDS:
            if re.search(rf"(?<![a-z]){re.escape(word)}(?![a-z])", lowered):
                problems.append(f"{where}: promotional word {word!r}")
        if "!" in blob:
            problems.append(f"{where}: an exclamation mark")
        if "%" in blob:
            problems.append(f"{where}: a percent sign")
        if "—" in blob or "&mdash;" in blob.lower():
            # The sign-off "— Wobo" is the one place a dash is drawn, and it is drawn as an
            # entity inside markup rather than written in a sentence; prose is checked here.
            problems.append(f"{where}: an em dash")
        if _EMOJI.search(blob):
            problems.append(f"{where}: an emoji")
        if re.search(r"\b(hi|hello|hey)\s+there\b", lowered) or ", there" in lowered:
            problems.append(f"{where}: 'there' standing in for a name")
        if re.search(r"(?<![\w'])i(?![\w'])", blob):
            problems.append(f"{where}: a lowercase 'i' for Wobo")

    scan("subject", subject)
    scan("text", text)
    if _CAPS.search(subject) or _CAPS.search(str(email.get("preheader") or "")):
        problems.append("subject: ALL CAPS")
    # The law forbids ALL CAPS in a subject, a preheader or a first line, and keeps the
    # small-caps eyebrow deeper in the paper set, which is the owner's own design ported verbatim
    # from design/email-v1.html. So the transform is a finding everywhere but there.
    if "text-transform:uppercase" in html_out and (kind is None or kind not in PAPER_KINDS):
        problems.append("html: ALL CAPS rendered by text-transform")
    if _EMOJI.search(visible):
        problems.append("html: an emoji")
    if "%" in visible:
        problems.append("html: a percent sign")
    if "made for curious minds" in visible.lower():
        problems.append("html: a slogan in the footer")
    if re.search(r"app\s*store|google\s*play", visible, re.IGNORECASE):
        problems.append("html: an app store badge")
    return problems
