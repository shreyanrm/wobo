"""The mail law, asserted over every rendered template (docs/MAIL-PRIMARY.md).

The law ends with a section called "What a test asserts" and names this file by name. It did not
exist, so twenty-six rules (twenty-five for CI, one checked by hand against a received message)
that read like settled law were settled nowhere: nine of them were true only because nobody had
written the sentence that would have broken them.

**Why the checks live here and not in test_email.py.** test_email.py is about the SEND — the
door, the retry, the idempotency key, the queued fallback. This file is about the MESSAGE, and
it is run over `TEMPLATES` rather than over a list written here, so a twenty-first kind cannot be
added without meeting the same bar as the twenty before it. That is the whole point of scanning
rather than reviewing.

**Two places where this file knowingly departs from the law's literal list, both named rather
than quietly widened:**

* ``welcome`` is over the 120-word body ceiling. It is the owner's own paper design, it is
  sent once in a learner's life, and it is orientation rather than a nudge. It is held to the
  long-form ceiling of 200 with the summary kinds instead of being trimmed, because trimming the
  owner's copy to satisfy a ceiling written for nudges would be the test changing the product.
* ``sunday_note`` carries a ``mailto:`` link. The law says every href is https; it also says, at
  greater length and in three separate places, that the reply is the entire point of the mail.
  The mailto is the reply, to the root-domain mailbox, so it is allowed BY NAME and only there.

Nothing here sends. The envelope block is the one exception and it captures the provider hop
rather than making it.
"""

from __future__ import annotations

import json
import re
import warnings
from typing import Any

import pytest
from wobo_gateway import email as email_mod
from wobo_gateway.email import send_email
from wobo_gateway.email_templates import (
    FOOTER_MARK,
    PAPER_KINDS,
    SUBSCRIBED_KINDS,
    TEMPLATES,
    TRANSACTIONAL_KINDS,
    render,
    text_of,
)
from wobo_gateway.hospitality.tokens import is_one_click, stop_link, stop_url

# --- what each kind is given, so every rendering is a real one -------------------------------
# A template handed nothing renders its no-name branch, which is tested separately. These are the
# facts a real send carries, so the assertions below are made against the mail a person receives.
SAMPLE: dict[str, dict[str, Any]] = {
    "quick_one": {"name": "Learner", "chapter": "Fractions, part two", "minutes": 5},
    "mid_chapter": {"name": "Learner", "chapter": "Linear equations", "cards_left": 2},
    "streak": {"name": "Learner", "days": 7},
    "bonus_level": {"name": "Learner", "between": "Motion and Force"},
    "doubt": {"name": "Learner", "chapter": "Refraction"},
    "learning_note": {"name": "Learner", "angle": "next", "title": "Fractions", "done": 4,
                      "cards_left": 6},
    "course_ready": {"name": "Learner", "topic": "Fractions"},
    "boss_victory": {"name": "Learner", "topic": "Fractions"},
    "win": {"name": "Learner", "chapter": "Triangles"},
    "sunday_note": {"learner_name": "Learner", "name": "Learner", "days_active": 4,
                    "headline": "A steady week on fractions."},
    "welcome": {"name": "Learner", "board_short": "CBSE", "class_name": "9"},
    "parent_report": {
        "learner_name": "Learner", "name": "Learner",
        "strengths": [("sticking with hard problems", "strong", 79)],
        "focus": ["revising older topics"],
        "trajectory": "Fractions are settling, and decimals are next.",
    },
    "parent_invite": {"learner_name": "Learner"},
    # The shell kinds say only what the send path gives them (the closer's run, 2026-09-17), so a
    # real rendering is one that was given the facts.
    "verify_email": {"name": "Learner", "code": "482913"},
    "level_up": {"name": "Learner", "level": 4,
                 "unlocked": ["a boss battle across the chapter", "a harder road through it"]},
    "streak_milestone": {"name": "Learner", "days": 24},
    "weekly_digest": {"name": "Learner", "minutes": 82,
                      "topics": ["acids and bases", "the mole concept"],
                      "bars": [("acids and bases", "solid", 88),
                               ("the mole concept", "growing", 61)],
                      "line": "The mole concept is the one to keep warm this week."},
    "reengage": {"name": "Learner",
                 "hook": "You were one screen from the end of Squares and square roots."},
}


def a_render(kind: str) -> dict[str, Any]:
    return render(kind, SAMPLE.get(kind, {"name": "Learner", "learner_name": "Learner"}))


ALL_KINDS = sorted(TEMPLATES)

#: The kinds whose body is a page rather than a note. The law names four; ``welcome`` joins them
#: for the reason in this module's docstring, and ``first_week`` is a milestone of ``win`` rather
#: than a template of its own, so it is not a kind here. ``parent_invite`` used to sit here too,
#: named nowhere: it measures 106 words and meets the ordinary ceiling, so the widening is gone.
LONG_FORM = frozenset({"sunday_note", "win", "parent_report", "welcome"})

BODY_WORDS = 120
LONG_FORM_WORDS = 200
TEXT_FLOOR = 500
SUBJECT_LIMIT = 60

#: Where the footer starts, in the plain-text twin. Every template's footer opens on the sentence
#: that says why this arrived; the two paper kinds that phrase it differently are named too. The
#: word ceiling is measured on what comes BEFORE this, because the footer is required text and
#: counting it would punish a kind for carrying its own legal line.
_FOOTER = re.compile(
    r"^(You get this|You got this|You(?:'|’)re getting this|Wobo writes when"
    r"|A note like this comes)",
)

_EMOJI = re.compile("[\U0001f000-\U0001faff☀-➿←-⇿⬀-⯿️]")
_CAPS_RUN = re.compile(r"[A-Z]{4,}")
_HREF = re.compile(r'href="([^"]+)"')

#: The hosts a link in our mail may point at. Anything else is a redirect, a tracker or a mistake.
ALLOWED_HOSTS = ("heywobo.com", "api.heywobo.com")


def body_of(email: dict[str, Any]) -> str:
    """The text part with the required footer removed: what the reader actually reads."""
    lines = text_of(email).split("\n")
    for index, line in enumerate(lines):
        if _FOOTER.match(line.strip()):
            return "\n".join(lines[:index])
    return "\n".join(lines)


def first_sentence(email: dict[str, Any]) -> str:
    stripped = [line for line in body_of(email).split("\n") if line.strip()]
    return stripped[0] if stripped else ""


def hosts_of(html: str) -> list[str]:
    out = []
    for href in _HREF.findall(html):
        if href.startswith("mailto:"):
            out.append("mailto")
            continue
        out.append(href.split("/")[2] if "://" in href else href)
    return out


# --- 1. the subject ----------------------------------------------------------------------------
@pytest.mark.parametrize("kind", ALL_KINDS)
def test_the_subject_fits_a_phone(kind: str) -> None:
    """At most sixty characters, because the mail is read on a phone and a clipped subject is a
    sentence the reader has to guess at."""
    subject = a_render(kind)["subject"]
    assert len(subject) <= SUBJECT_LIMIT, f"{kind}: {len(subject)} chars, {subject!r}"


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_the_subject_carries_no_promotional_punctuation(kind: str) -> None:
    out = a_render(kind)
    preheader = str(out.get("preheader") or "")
    for where, blob in (("subject", out["subject"]), ("preheader", preheader)):
        assert "!" not in blob, f"{kind} {where}"
        assert "%" not in blob, f"{kind} {where}"
        assert "—" not in blob and "–" not in blob, f"{kind} {where}: a dash"
        assert not _EMOJI.search(blob), f"{kind} {where}: an emoji"
    subject = out["subject"]
    assert not subject.lower().startswith(("re:", "fwd:")), kind
    assert subject[:1] not in {"$", "₹", "£", "€"}, kind


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_nothing_shouts_in_the_first_thing_a_reader_sees(kind: str) -> None:
    """No run of four or more capitals in the subject, the preheader, or the first 120
    characters of the body. A small-caps eyebrow deeper in the paper set is a design device and
    is drawn by CSS, never by capital letters in the copy."""
    out = a_render(kind)
    # A board's own name is a name, not shouting: the law's own welcome subject is "Wobo is set
    # up for CBSE class 9". The board the send carried is the one run of capitals allowed.
    board = str(SAMPLE.get(kind, {}).get("board_short") or "")
    for where, blob in (
        ("subject", out["subject"]),
        ("preheader", str(out.get("preheader") or "")),
        ("first line", body_of(out)[:120]),
    ):
        if board:
            blob = blob.replace(board, board.capitalize())
        assert not _CAPS_RUN.search(blob), f"{kind} {where}: {blob!r}"


# --- 2. the length -----------------------------------------------------------------------------
@pytest.mark.parametrize("kind", ALL_KINDS)
def test_the_body_is_short_enough_to_read(kind: str) -> None:
    ceiling = LONG_FORM_WORDS if kind in LONG_FORM else BODY_WORDS
    words = len(body_of(a_render(kind)).split())
    assert words <= ceiling, f"{kind}: {words} words against {ceiling}"


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_the_whole_text_part_clears_the_floor(kind: str) -> None:
    """The one structural threshold with data behind it, and it is a FLOOR: below 500 characters
    of text several filters blocked mail outright. The footer is what carries a short kind over
    it, so a failure here means the footer is incomplete, never that the copy is too short. Do
    not pad the body to fix this."""
    text = text_of(a_render(kind))
    assert len(text) >= TEXT_FLOOR, f"{kind}: {len(text)} chars, footer is incomplete"


# --- 3. the register ---------------------------------------------------------------------------
#: Forbidden in the subject, the preheader and the first sentence. 'the free plan' is a fact and
#: lives in a body sentence, which is why this is not scanned over the whole mail.
FORBIDDEN = (
    "free", "offer", "deal", "discount", "save", "gift", "unlock", "unlocked", "limited",
    "exclusive", "on us", "no strings", "act now", "last chance", "hurry", "don't miss",
    "just for you", "level up", "bonus",
)


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_no_offer_language_where_the_reader_looks_first(kind: str) -> None:
    out = a_render(kind)
    blob = " ".join(
        [out["subject"], str(out.get("preheader") or ""), first_sentence(out)]
    ).lower()
    for word in FORBIDDEN:
        assert not re.search(rf"(?<![a-z]){re.escape(word)}(?![a-z])", blob), f"{kind}: {word!r}"


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_nothing_narrates_itself(kind: str) -> None:
    """DESIGN.md §0.x, extended to mail. It also tells a reader they are being watched."""
    blob = text_of(a_render(kind)).lower()
    for narration in (
        "we noticed", "we miss you", "we hope", "just checking in", "it looks like you",
        "our ai", "your ai wobot", "this is an automated",
    ):
        assert narration not in blob, f"{kind}: {narration!r}"


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_a_missing_name_rewrites_the_sentence_rather_than_filling_it(kind: str) -> None:
    out = render(kind, {})
    blob = f"{out['subject']}\n{out.get('preheader') or ''}\n{text_of(out)}".lower()
    assert ", there" not in blob, kind
    assert not re.search(r"\b(hi|hello|hey)\s+there\b", blob), kind
    assert out["subject"].strip(), kind


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_no_percentage_and_no_raw_score(kind: str) -> None:
    """A mastery figure is a word (solid, growing, started), and praise is for the behaviour."""
    text = text_of(a_render(kind))
    assert "%" not in text, kind
    assert not re.search(r"\d+\s*XP", text, re.IGNORECASE), kind


# --- 4. what a mail is made of -----------------------------------------------------------------
@pytest.mark.parametrize("kind", ALL_KINDS)
def test_no_image_ships_today(kind: str) -> None:
    """Every template is at zero remote fetches, which is the fleet's single greatest asset in
    this law. The orb GIF is allowed to change this, once, and only under the next test."""
    assert "<img" not in a_render(kind)["html"], kind


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_if_a_picture_arrives_it_is_one_it_is_described_and_it_is_not_load_bearing(
    kind: str,
) -> None:
    """The law's own condition for the day the orb ships: at most one image, a non-empty alt, and
    the message whole with images off. Held now so the seam cannot ship without meeting it."""
    data = {**SAMPLE.get(kind, {"name": "Learner", "learner_name": "Learner"})}
    data["orb_url"] = "https://heywobo.com/brand/orb/hover.gif"
    out = render(kind, data)
    html = out["html"]
    assert html.count("<img") <= 1, kind
    if "<img" in html:
        tag = html[html.index("<img") : html.index(">", html.index("<img"))]
        assert re.search(r'alt="[^"]+"', tag), f"{kind}: an image with no alt"
    # With the picture gone the mail is still the whole message: the text part never moved.
    assert text_of(out) == text_of(a_render(kind)), kind


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_every_link_is_ours_and_none_of_them_tracks(kind: str) -> None:
    html = a_render(kind)["html"]
    for href in _HREF.findall(html):
        if href.startswith("mailto:"):
            # The reply, to the root-domain mailbox. Named in this module's docstring.
            assert kind == "sunday_note" and "support@heywobo.com" in href, f"{kind}: {href}"
            continue
        assert href.startswith("https://"), f"{kind}: {href}"
        host = href.split("/")[2]
        assert host in ALLOWED_HOSTS or host.endswith(".heywobo.com"), f"{kind}: {host}"
        assert "utm_" not in href, f"{kind}: {href}"


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_there_are_few_destinations(kind: str) -> None:
    """Five at most. The button above the footer is counted on its own, in section 8."""
    html = a_render(kind)["html"]
    destinations = set(_HREF.findall(html))
    assert len(destinations) <= 5, f"{kind}: {len(destinations)} destinations"


# --- 5. the way out ----------------------------------------------------------------------------
@pytest.mark.parametrize("kind", sorted(SUBSCRIBED_KINDS))
def test_every_subscribed_kind_is_owed_a_way_out(kind: str) -> None:
    """Without List-Unsubscribe the frustrated reader's only remaining button is Block, which is
    far worse than any tab."""
    assert "List-Unsubscribe" in a_render(kind)["headers"], kind


@pytest.mark.parametrize("kind", sorted(TRANSACTIONAL_KINDS))
def test_transactional_mail_carries_no_unsubscribe(kind: str) -> None:
    """An unsubscribe link on a verification code is a way to lock yourself out of your account."""
    assert "List-Unsubscribe" not in a_render(kind).get("headers", {}), kind


@pytest.mark.parametrize("kind", sorted(SUBSCRIBED_KINDS))
def test_one_click_is_promised_only_where_it_can_be_kept(kind: str) -> None:
    """Asserting one-click on a page that needs a sign-in is a promise we cannot keep, and Gmail
    and Yahoo actually POST the target to check."""
    plain = a_render(kind)
    assert "List-Unsubscribe-Post" not in plain["headers"], kind

    data = {**SAMPLE.get(kind, {"name": "Learner", "learner_name": "Learner"})}
    data["unsubscribe_url"] = "https://api.heywobo.com/v1/mail/stop?token=abc"
    tokened = render(kind, data)
    assert tokened["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click", kind


# --- 6. the envelope ---------------------------------------------------------------------------
@pytest.fixture()
def wire(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """The provider hop, captured rather than made. Nothing leaves this machine."""
    monkeypatch.setenv("EMAIL_MODE", "live")
    monkeypatch.setenv("RESEND_API_KEY", "test-key-never-logged")
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "a-test-secret")
    email_mod.reset_mail_log()
    sent: list[dict[str, Any]] = []

    def fake_post(body: bytes, key: str, idem: str | None) -> Any:
        sent.append(json.loads(body.decode()))
        return email_mod._Reply(ok=True, status=200, result={"id": "em_test"})

    monkeypatch.setattr(email_mod, "_post", fake_post)
    yield sent
    email_mod.reset_mail_log()


def _send(kind: str, wire: list[dict[str, Any]]) -> dict[str, Any]:
    data = {**SAMPLE.get(kind, {"name": "Learner", "learner_name": "Learner"})}
    if kind in SUBSCRIBED_KINDS:
        link = stop_link("L1", "learner")
        assert link
        data["unsubscribe_url"] = link
    send_email(kind, "reader@example.test", data, learner_id="L1", period=f"law:{kind}")
    assert wire, f"{kind}: nothing reached the wire"
    return wire[-1]


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_one_sender_and_one_reply_to_on_every_kind(
    kind: str, wire: list[dict[str, Any]]
) -> None:
    """Byte-identical on every kind, forever. The address that sent the welcome sends the streak,
    and the reply-to is a root-domain mailbox a worried parent can actually write to."""
    envelope = _send(kind, wire)
    assert envelope["from"] == email_mod._FROM
    assert "noreply" not in envelope["from"].lower()
    assert envelope["reply_to"] == email_mod._REPLY_TO
    assert envelope["to"] == ["reader@example.test"]
    assert "bcc" not in envelope


@pytest.mark.parametrize("kind", sorted(SUBSCRIBED_KINDS))
def test_every_subscribed_kind_names_its_own_list(
    kind: str, wire: list[dict[str, Any]]
) -> None:
    """Google's subscription guidelines ask for List-Id by name. One per kind, human readable."""
    headers = _send(kind, wire).get("headers") or {}
    list_id = headers.get("List-Id")
    assert list_id, f"{kind}: no List-Id"
    assert kind.replace("_", "") in list_id.replace("_", "").replace("-", "").lower()
    assert "heywobo.com" in list_id


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_every_kind_carries_a_feedback_id_so_complaints_have_a_kind(
    kind: str, wire: list[dict[str, Any]]
) -> None:
    """{kind}:{stream}:{campaign}:{SenderId}. It is the cheapest way to turn "a kind nobody
    engages with is switched off by the superadmin" into a measurement rather than a guess."""
    headers = _send(kind, wire).get("headers") or {}
    feedback = headers.get("Feedback-ID")
    assert feedback, f"{kind}: no Feedback-ID"
    parts = feedback.split(":")
    assert len(parts) == 4, feedback
    assert parts[0] == kind
    assert 5 <= len(parts[3]) <= 15, f"SenderId must be 5 to 15 characters: {parts[3]!r}"


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_the_headers_we_refuse_to_send_are_absent(
    kind: str, wire: list[dict[str, Any]]
) -> None:
    """Every header we set has a named reason; these have none, and two of them make a client
    render "via" something, which breaks the one identity the reader is asked to recognise."""
    headers = {k.lower() for k in (_send(kind, wire).get("headers") or {})}
    for refused in ("precedence", "auto-submitted", "sender", "on-behalf-of", "importance",
                    "x-priority", "x-mailer", "x-campaign", "x-entity-ref-id"):
        assert refused not in headers, f"{kind}: {refused}"


def test_the_sender_id_is_the_same_on_every_kind(wire: list[dict[str, Any]]) -> None:
    """A constant 5 to 15 characters across every mail stream, or the complaint data cannot be
    attributed to us at all."""
    seen = set()
    for kind in ALL_KINDS:
        headers = _send(kind, wire).get("headers") or {}
        seen.add((headers.get("Feedback-ID") or ":::").split(":")[3])
    assert len(seen) == 1, f"the SenderId moves between kinds: {seen}"


# --- 7. the way out a reader can SEE -----------------------------------------------------------
# The law's FOOTER COMPLETENESS rule, which this file was reported as asserting and did not.
# MAIL-PRIMARY: "every subscribed kind renders a visible stop link whose font-size is >= 13px and
# whose colour against the footer background has a contrast ratio >= 4.5 to 1. Google's word is
# 'clearly visible'; 12px at #9A9BA2 fails this and is the current state." A grep of this file for
# 'visible', 'stop link', '13px' and 'contrast' returned nothing across twenty-one test functions,
# so the one rule that names a number and a colour was settled nowhere.
_STOP = "https://api.heywobo.com/v1/mail/stop?token=abc"
#: The parent invite's way out is the signed decline route, not a list to unsubscribe from. The
#: law names that exception by name, so it is honoured here rather than quietly widened.
_DECLINE = "https://api.heywobo.com/v1/parent/decline?token=abc"
#: The two card grounds a footer is ever drawn on.
_CREAM = "#FAF7F0"
_WHITE = "#FFFFFF"


def _channel(value: float) -> float:
    return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4


def luminance(colour: str) -> float:
    """WCAG relative luminance of a #rrggbb colour."""
    raw = colour.lstrip("#")
    r, g, b = (int(raw[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def contrast(front: str, back: str) -> float:
    a, b = luminance(front), luminance(back)
    lighter, darker = max(a, b), min(a, b)
    return (lighter + 0.05) / (darker + 0.05)


def _style_of_link(html: str, href: str) -> str:
    """The style attribute of the anchor pointing at ``href``, or "" if there is no such link."""
    found = re.search(rf'<a\s+href="{re.escape(href)}"([^>]*)>', html)
    if not found:
        return ""
    style = re.search(r'style="([^"]*)"', found.group(1))
    return style.group(1) if style else ""


def _px(style: str) -> float:
    """The font size a declaration sets, by the long hand or inside the ``font`` shorthand."""
    explicit = re.search(r"font-size:\s*(\d+(?:\.\d+)?)px", style)
    if explicit:
        return float(explicit.group(1))
    shorthand = re.search(r"font:[^;]*?(\d+(?:\.\d+)?)px", style)
    return float(shorthand.group(1)) if shorthand else 0.0


def _colour(style: str) -> str:
    found = re.search(r"(?<!-)color:\s*(#[0-9A-Fa-f]{6})", style)
    return found.group(1) if found else ""


def _ground(html: str) -> str:
    """The card the footer is drawn on: the cream paper, or the white shell."""
    return _CREAM if _CREAM in html else _WHITE


def _with_a_stop_link(kind: str) -> tuple[dict[str, Any], str]:
    target = _DECLINE if kind == "parent_invite" else _STOP
    key = "decline_url" if kind == "parent_invite" else "unsubscribe_url"
    data = {**SAMPLE.get(kind, {"name": "Learner", "learner_name": "Learner"}), key: target}
    return render(kind, data), target


@pytest.mark.parametrize("kind", sorted(SUBSCRIBED_KINDS))
def test_every_subscribed_kind_renders_a_stop_link_a_reader_can_see(kind: str) -> None:
    """Not merely a header a client MIGHT surface: a link in the body, at a size and a contrast a
    person can actually find. A reader who cannot find the way out presses Block instead, which
    is worse for them and far worse for us than any tab."""
    out, target = _with_a_stop_link(kind)
    style = _style_of_link(out["html"], target)
    assert style, f"{kind}: no visible link to the stop route anywhere in the body"
    size = _px(style)
    assert size >= 13, f"{kind}: the stop link is {size}px, under the law's 13"
    colour = _colour(style)
    assert colour, f"{kind}: the stop link declares no colour of its own"
    ratio = contrast(colour, _ground(out["html"]))
    assert ratio >= 4.5, f"{kind}: the stop link measures {ratio:.2f}:1, under 4.5"


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_the_quiet_text_is_still_text(kind: str) -> None:
    """The footer is where the reader is told why this arrived and how to stop it, so "quiet" is
    a size and a weight and never an excuse for grey on cream. Two colours failed this when it
    was written: the shell's 12px #9A9BA2 at 2.77:1 on white, and the paper's 12px #8A8A9E at
    3.16:1 on the cream."""
    html = a_render(kind)["html"]
    ground = _ground(html)
    for style in re.findall(r'class="wobo-quiet"[^>]*style="([^"]*)"', html):
        colour = _colour(style)
        if not colour:
            continue
        ratio = contrast(colour, ground)
        assert ratio >= 4.5, f"{kind}: quiet text at {colour} measures {ratio:.2f}:1 on {ground}"


# --- 8. the rest of the law's list (2026-09-17) ------------------------------------------------
# Measured before this block was written: of the law's twenty-six assertions, the first twenty
# functions above covered fourteen in full, eight in part, and four not at all. What follows is
# the missing half of each partial one and the four that were missing, each named by the law's
# own heading. Four are settled elsewhere and are cited rather than written twice:
#
# * SEND-PATH HOLD, the postal address and the unverified domain:
#   test_email.py::test_nothing_leaves_live_without_a_postal_line_or_an_off_switch and
#   test_email.py::test_an_unverified_sending_domain_degrades_to_queued. The domain case makes
#   exactly one call, because the only way to learn a domain is unverified is the provider's own
#   refusal; that test asserts the one call, the hold, and that nothing is retried.
# * INBOX LAW: test_mail_nudge_jobs.py::test_never_twice_in_twenty_four_hours_to_one_address
#   (another learner's mail to the same address holds this one),
#   test_mail_cadence.py::test_on_a_day_the_learner_came_only_a_come_back_mail_is_held,
#   test_hospitality_jobs.py::test_at_most_one_win_per_learner_per_seven_days,
#   test_mail_nudge_jobs.py::test_never_after_eight_in_the_evening,
#   test_hospitality_jobs.py::test_a_win_waits_out_the_quiet_hours_when_the_zone_is_known,
#   test_hospitality_jobs.py::test_unknown_locality_means_nothing_sends and
#   test_mail_nudge_jobs.py::test_a_family_whose_locality_we_do_not_know_hears_nothing.
# * IDEMPOTENCY: test_email.py::test_a_period_makes_the_send_idempotent and
#   test_email.py::test_headers_and_the_idempotency_key_ride_to_the_provider.
# * RENDERED-MESSAGE CHECK: by hand against a received message, never in CI (the law says so).
_FOOTER_MARK = FOOTER_MARK
_SUBSCRIBED = SUBSCRIBED_KINDS
_URL = re.compile(r"(?:https?|mailto):\S+")
_WORD = re.compile(r"[a-z0-9']+")


def _url_free(line: str) -> str:
    return _URL.sub("", line).strip()


# SUBJECT LENGTH, the second half: a phone shows roughly forty characters.
def test_a_phone_shows_most_of_every_subject() -> None:
    """Not a failure: the law asks for a warning above 45, so a long subject is visible in the
    run without blocking a mail that is within the 60 a client shows before clipping."""
    long = {k: a_render(k)["subject"] for k in ALL_KINDS if len(a_render(k)["subject"]) > 45}
    for kind, subject in long.items():
        warnings.warn(f"{kind}: {len(subject)} characters, {subject!r}", stacklevel=1)


# SUBJECT CASE, the second half, and the register's sentence case (§4, voice.md "Sentence case
# everywhere ... subject lines, email preheaders").
@pytest.mark.parametrize("kind", ALL_KINDS)
def test_every_sentence_a_reader_sees_opens_with_a_capital(kind: str) -> None:
    out = a_render(kind)
    starts = [out["subject"], str(out.get("preheader") or "")]
    for line in text_of(out).split("\n"):
        plain = _url_free(line)
        if not plain:
            continue
        starts.append(plain)
        starts += [m.group(1) for m in re.finditer(r"[.?]\s+(\S+)", plain)]
    for start in starts:
        first = start.lstrip("“\"'‘(-– ")[:1]
        assert not first.islower(), f"{kind}: {start[:60]!r}"


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_one_small_caps_eyebrow_at_most(kind: str) -> None:
    """Small-caps eyebrows deeper in the paper set are a design device, capped at one per
    message. The Sunday note drew one per tile and one more over "Something worth saying"."""
    data = {**SAMPLE.get(kind, {"name": "Learner"}), "lessons": 3, "problems": 9,
            "days_active": 4, "worth_saying": "They asked why twice."}
    html = render(kind, data)["html"]
    assert html.count("text-transform:uppercase") <= 1, kind


# LINKS, the second half: one button above the footer, and few destinations below it.
#: A second destination above the footer that the law itself asks for, by name: the Sunday
#: note's reply (this module's docstring), and the invite's "Not me", which is the visible way
#: out §2 requires of a cold message.
_NAMED_SECOND = {"sunday_note": "mailto:", "parent_invite": "/v1/parent/decline"}
_LEGAL = ("/privacy", "/trust", "/security")


def _above_and_below(html: str) -> tuple[set[str], set[str]]:
    assert _FOOTER_MARK in html, "the footer is not marked, so the button cannot be told from it"
    top, bottom = html.split(_FOOTER_MARK, 1)
    return set(_HREF.findall(top)), set(_HREF.findall(bottom))


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_exactly_one_button_stands_above_the_footer(kind: str) -> None:
    data = {**SAMPLE.get(kind, {"name": "Learner"})}
    if kind == "win":
        # A real win carries the next chapter (hospitality/jobs.py), which is when it had two.
        data.update(next_label="Start Circles", next_url="https://heywobo.com/learn")
    above, _ = _above_and_below(render(kind, data)["html"])
    named = _NAMED_SECOND.get(kind)
    buttons = {h for h in above if not (named and named in h)}
    # The wish is the one kind with nothing attached, by its own law (festival-wishes.md: no
    # lesson, no streak, no plan): "Nothing to do today" is the point, so it carries no button.
    assert len(buttons) == (0 if kind == "wish" else 1), f"{kind}: {sorted(buttons)}"


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_four_destinations_at_most_besides_the_legal_links(kind: str) -> None:
    above, below = _above_and_below(a_render(kind)["html"])
    rest = {h for h in above | below if not any(h.split("?")[0].endswith(p) for p in _LEGAL)}
    assert len(rest) <= 4, f"{kind}: {sorted(rest)}"


# PLAIN TEXT TWIN.
@pytest.mark.parametrize("kind", ALL_KINDS)
def test_the_text_part_stands_on_its_own(kind: str) -> None:
    out = a_render(kind)
    text = text_of(out)
    for href in set(_HREF.findall(out["html"])):
        href = href.replace("&amp;", "&")
        target = href.removeprefix("mailto:")
        assert target in text, f"{kind}: {href} is in the html and not in the text part"
    lowered = text.lower()
    assert "click here" not in lowered and "click the button" not in lowered, kind
    sentences = [s for s in re.split(r"(?<=[.?])\s+", _URL.sub("", text)) if len(s.split()) >= 3]
    assert len(sentences) >= 3, f"{kind}: {len(sentences)} sentences"


# SUBSCRIBED HEADERS, the second half: the shape and the target.
@pytest.mark.parametrize("kind", sorted(_SUBSCRIBED))
@pytest.mark.parametrize("tokened", [False, True])
def test_the_way_out_is_one_https_link_to_our_own_stop_or_decline_route(
    kind: str, tokened: bool
) -> None:
    data = {**SAMPLE.get(kind, {"name": "Learner"})}
    if tokened:
        data.update(unsubscribe_url=_STOP, decline_url=_DECLINE)
    value = render(kind, data)["headers"]["List-Unsubscribe"]
    assert re.fullmatch(r"<https://[^>]+>", value), f"{kind}: {value!r}"
    target = value[1:-1]
    assert target.startswith(stop_url()) or target.startswith(
        "https://api.heywobo.com/v1/parent/decline"
    ), f"{kind}: {target}"


# ONE-CLICK HONESTY, the other direction: an https page that is not our tokened route.
@pytest.mark.parametrize("kind", sorted(_SUBSCRIBED))
def test_a_page_that_needs_a_sign_in_is_never_promised_as_one_click(kind: str) -> None:
    data = {**SAMPLE.get(kind, {"name": "Learner"}), "unsubscribe_url": "https://heywobo.com/you"}
    headers = render(kind, data)["headers"]
    target = headers["List-Unsubscribe"][1:-1]
    assert ("List-Unsubscribe-Post" in headers) == is_one_click(target), kind
    assert "List-Unsubscribe-Post" not in headers, kind


# A template that builds some headers of its own but forgets the way out still gets one.
def test_render_adds_the_way_out_to_headers_a_template_built_without_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway import email_templates as tpl

    original = tpl.TEMPLATES["streak"]
    monkeypatch.setitem(
        tpl.TEMPLATES, "streak", lambda d: {**original(d), "headers": {"X-Test": "1"}}
    )
    assert "List-Unsubscribe" in tpl.render("streak", {"days": 7})["headers"]


# SEND-PATH HOLD, the subscribed case: no way out in the rendered headers, no HTTP call.
def test_a_subscribed_mail_with_no_way_out_is_held_and_never_reaches_the_wire(
    wire: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_way_out(kind: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
        out = render(kind, data)
        return {**out, "headers": {}}

    monkeypatch.setattr(email_mod, "render", no_way_out)
    held = send_email("streak", "reader@example.test", {"days": 7}, learner_id="L1",
                      period="law:hold")
    assert held["queued"] is True and held["error"] == "no_stop_link"
    assert wire == []


# TRANSACTIONAL HEADERS, the second half: no List-Id either.
@pytest.mark.parametrize("kind", sorted(TRANSACTIONAL_KINDS))
def test_transactional_mail_is_not_a_list(kind: str, wire: list[dict[str, Any]]) -> None:
    headers = _send(kind, wire).get("headers") or {}
    assert "List-Id" not in headers and "List-Unsubscribe" not in headers, kind


# LIST-ID, the second half: the law's own shape, and never shared.
def test_every_list_id_has_the_laws_shape_and_no_two_kinds_share_one(
    wire: list[dict[str, Any]],
) -> None:
    seen: dict[str, str] = {}
    for kind in sorted(_SUBSCRIBED):
        list_id = (_send(kind, wire).get("headers") or {})["List-Id"]
        assert re.fullmatch(r"Wobo [a-z ]+ <[a-z-]+\.mail\.heywobo\.com>", list_id), list_id
        assert list_id not in seen, f"{kind} and {seen.get(list_id)} share {list_id}"
        seen[list_id] = kind


# FEEDBACK-ID, the second half: the law's own shape.
#
# One knowing departure: the law's pattern allows no underscore, and it also says the first field
# IS the kind name, and six kind names carry one (quick_one, mail_alert, ...). The deliverability
# watch reads the kind back out of this field byte for byte (mailwatch/events.py), so the kind
# wins and the underscore is allowed in the first field only.
@pytest.mark.parametrize("kind", ALL_KINDS)
def test_the_feedback_id_has_the_laws_shape(kind: str, wire: list[dict[str, Any]]) -> None:
    headers = _send(kind, wire).get("headers") or {}
    feedback = headers["Feedback-ID"]
    assert re.fullmatch(
        r"[a-z0-9_-]{1,20}:[a-z0-9-]{1,20}:[a-z0-9.-]{1,64}:[a-z0-9]{5,15}", feedback
    ), feedback
    assert feedback.split(":")[1] == ("subscribed" if kind in _SUBSCRIBED else "transactional")


# ENVELOPE CONSTANTS, the second half.
@pytest.mark.parametrize("kind", ALL_KINDS)
def test_the_sender_is_wobo_at_one_address_and_the_reply_reaches_the_root(
    kind: str, wire: list[dict[str, Any]]
) -> None:
    envelope = _send(kind, wire)
    sender = envelope["from"]
    assert sender.split("<", 1)[0].strip() == "Wobo", sender
    assert sender.count("@") == 1 and sender.count("<") == 1, sender
    reply = envelope["reply_to"]
    assert isinstance(reply, str) and reply.count("@") == 1, reply
    assert reply.endswith("@heywobo.com"), f"the reply-to is not on the root domain: {reply}"
    for refused in ("noreply", "no-reply", "donotreply"):
        assert refused not in reply.lower() and refused not in sender.lower()
    assert not {"cc", "bcc"} & set(envelope), kind


# FOOTER COMPLETENESS, the text half: the address is in the part a text-only client shows.
@pytest.mark.parametrize("kind", ALL_KINDS)
def test_the_postal_address_is_in_both_parts(kind: str) -> None:
    from wobo_gateway.email_templates import postal_address

    out = a_render(kind)
    assert postal_address() in text_of(out), kind
    assert postal_address() in out["html"], kind


# NO DEAD PLACEHOLDER, over every kind and both parts.
@pytest.mark.parametrize("kind", ALL_KINDS)
@pytest.mark.parametrize("bare", [False, True])
def test_no_placeholder_survives_a_render(kind: str, bare: bool) -> None:
    """``[`` is looked for in what a person reads: the html's Outlook conditional comments
    (``<!--[if mso]>``) are markup a client consumes, not a placeholder."""
    out = render(kind, {}) if bare else a_render(kind)
    body = out["html"].split("<body", 1)[-1]  # the head is CSS a client reads, not copy
    visible = re.sub(r"<!--.*?-->", " ", body, flags=re.S)
    visible = re.sub(r"<[^>]+>", " ", visible)
    for where, blob in (("text", text_of(out)), ("html", visible), ("subject", out["subject"])):
        for dead in ("{{", "}}", "[", "placeholder", "example.com", "lorem", "TODO"):
            assert dead not in blob, f"{kind} {where}: {dead!r}"


# PREHEADER.
def _overlap(a: str, b: str) -> float:
    """Shared words over all words (Jaccard), lower-cased. The law says "token overlap"; the
    symmetric measure is the one that does not reward a preheader for simply being longer."""
    left, right = set(_WORD.findall(a.lower())), set(_WORD.findall(b.lower()))
    return len(left & right) / max(1, len(left | right))


@pytest.mark.parametrize("kind", ALL_KINDS)
@pytest.mark.parametrize("bare", [False, True])
def test_the_preheader_says_something_the_subject_did_not(kind: str, bare: bool) -> None:
    out = render(kind, {}) if bare else a_render(kind)
    subject, preheader = out["subject"], str(out.get("preheader") or "")
    assert preheader.strip(), f"{kind}: no preheader"
    assert "\n" not in preheader and len(preheader) <= 90, f"{kind}: {preheader!r}"
    assert preheader.strip(" .") != subject.strip(" ."), kind
    assert not subject.lower().startswith(preheader.lower().rstrip(" .")), kind
    assert _overlap(subject, preheader) < 0.6, f"{kind}: {subject!r} / {preheader!r}"


# THE EIGHT SUBJECTS AND THE EIGHT FIRST LINES, placed on the templates they belong to.
# The data is each example the law renders; "Learner" stands in for a name, because a real
# child's name never appears in a test (test_copy_law.py).
EIGHT: list[tuple[str, dict[str, Any], str, str]] = [
    ("quick_one", {"chapter": "Fractions, part two", "minutes": 5},
     "Fractions, part two, takes about five minutes",
     "Your next card in Fractions, part two, is a short one, about five minutes."),
    ("mid_chapter", {"chapter": "Linear equations", "cards_left": 2,
                     "card_title": "Solving for x"},
     "Two cards left in Linear equations",
     "Two cards are left in Linear equations, starting with Solving for x."),
    ("streak", {"days": 7},
     "7 days in a row, rest days included",
     "7 days in a row, and rest days count too."),
    ("bonus_level", {"unit_a": "Motion", "unit_b": "Force"},
     "A side door between Motion and Force",
     "A game opened between Motion and Force, and it is optional."),
    ("doubt", {"chapter": "Refraction"},
     "The page you photographed is worked through",
     "The page you photographed is worked through, step by step."),
    ("sunday_note", {"learner_name": "Learner", "headline": "A steady week on fractions."},
     "Learner's week, in one page",
     "Here is Learner's week in one page: a steady week on fractions."),
    ("welcome", {"name": "Learner", "board_short": "CBSE", "class_name": "9",
                 "board_full": "Central Board of Secondary Education"},
     "Wobo is set up for CBSE class 9",
     "I have your syllabus: Central Board of Secondary Education, class 9, every subject it "
     "sets."),
    ("launch", {},
     "Wobo is open",
     "You asked to be told when Wobo opened, and it is open."),
]


def _first_lines(out: dict[str, Any]) -> list[str]:
    return [line for line in body_of(out).split("\n") if line.strip()][:2]


@pytest.mark.parametrize(("kind", "data", "subject", "opening"), EIGHT, ids=[e[0] for e in EIGHT])
def test_the_laws_subject_and_first_line_are_the_ones_sent(
    kind: str, data: dict[str, Any], subject: str, opening: str
) -> None:
    out = render(kind, data)
    assert out["subject"] == subject
    # The first line, or the line under a headline of two to four words: the paper's big hand
    # line and the note's headline are a title, and the sentence under them is the opening.
    lines = [_curly(line) for line in _first_lines(out)]
    assert any(line.startswith(opening) for line in lines), lines
    # The html draws the Sunday note's headline as its own display line under the lead, where it
    # keeps its capital; the words are the same.
    assert opening.lower() in _seen(out["html"]).lower(), f"{kind}: the opening is not in the html"


def _curly(text: str) -> str:
    return text.replace("’", "'")


def _seen(page: str) -> str:
    """What a reader of the html sees, as one line of text."""
    import html as html_lib

    body = page.split("<body", 1)[-1]
    body = re.sub(r"<div[^>]*display:none[^>]*>.*?</div>", " ", body, flags=re.S)
    words = html_lib.unescape(re.sub(r"<[^>]+>", " ", body))
    return _curly(re.sub(r"\s+", " ", words))


def test_the_launch_mail_is_subscribed_mail(wire: list[dict[str, Any]]) -> None:
    """The law lists it with the subscribed kinds: both headers, its own List-Id, a way out.

    Until 2026-09-17 this checked only that the kind was listed, and the launch mail rendered a
    List-Unsubscribe to the stop route with no token, which answers 400 and sends a list reader,
    who has no account, to sign in. The way out is now a signed link that names the list row,
    minted by the list itself, and the send path holds a launch mail without one."""
    from wobo_gateway import waiting_list

    assert "launch" in TEMPLATES and "launch" in _SUBSCRIBED and "launch" not in PAPER_KINDS
    link = waiting_list.stop_link("5d1b0a52-1111-4222-8333-944455556666")
    assert link and is_one_click(link)
    out = render("launch", {"unsubscribe_url": link})
    assert out["headers"]["List-Unsubscribe"] == f"<{link}>"
    assert out["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert f'href="{link}"' in out["html"] and link in text_of(out)
    send_email("launch", "reader@example.test", {"unsubscribe_url": link}, period="law:launch")
    headers = wire[-1]["headers"]
    assert headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert re.fullmatch(r"Wobo launch <launch\.mail\.heywobo\.com>", headers["List-Id"])


def test_a_launch_mail_with_no_signed_way_out_is_held(wire: list[dict[str, Any]]) -> None:
    """A list reader has no account, so no page behind a sign-in is a way out for them, and a
    bare stop route is a dead link. Without a signed link the launch mail never reaches the wire."""
    for data in ({}, {"unsubscribe_url": "https://heywobo.com/you"},
                 {"unsubscribe_url": stop_url()}):
        held = send_email("launch", "reader@example.test", data, period="law:launch-held")
        assert held["queued"] is True and held["error"] == "no_stop_link", data
    assert wire == []


@pytest.mark.parametrize("kind", sorted(TRANSACTIONAL_KINDS))
def test_account_mail_draws_no_unsubscribe_link_either(kind: str) -> None:
    """The header was already absent; the shell footer still drew an "Unsubscribe" link, to the
    stop route with no token, which is a dead link on a mail nobody can unsubscribe from."""
    out = a_render(kind)
    assert ">Unsubscribe<" not in out["html"], kind
    assert "Unsubscribe:" not in text_of(out), kind
    assert stop_url() not in out["html"] and stop_url() not in text_of(out), kind


# NO EM DASH (voice.md 10a: "No em dashes in anything a learner reads."). The sign-off used to be
# exempt as "a mark, not a sentence", and a reader still reads it: eighteen kinds drew one in the
# html and ten wrote one into the text part (the closer's run, 2026-09-17).
_DASHES = ("\u2014", "&mdash;", "&#8212;", "&#x2014;")


@pytest.mark.parametrize("kind", ALL_KINDS)
@pytest.mark.parametrize("bare", [False, True])
def test_no_em_dash_anywhere_a_person_reads(kind: str, bare: bool) -> None:
    out = render(kind, {}) if bare else a_render(kind)
    body = out["html"].split("<body", 1)[-1]
    visible = re.sub(r"<[^>]+>", " ", re.sub(r"<!--.*?-->", " ", body, flags=re.S))
    for where, blob in (
        ("subject", out["subject"]),
        ("preheader", str(out.get("preheader") or "")),
        ("text", text_of(out)),
        ("html", visible),
    ):
        for dash in _DASHES:
            at = blob.lower().find(dash)
            assert at < 0, f"{kind} {where}: {blob[max(0, at - 40):at + 20]!r}"


def test_the_register_scan_no_longer_forgives_a_dashed_sign_off() -> None:
    from wobo_gateway.email_templates import promotional_problems

    signed = {
        "subject": "A note",
        "text": "Well done.\n\n\u2014 Wobo",
        "html": "<p>&mdash; Wobo</p>",
    }
    assert "text: an em dash" in promotional_problems(signed)


# NOTHING INVENTED (the closer's run, 2026-09-17). A send that gave no number is told no number.
# The quick one printed "about five minutes" in every subject though nothing measures a card, and
# the shell kinds printed a level four, a run of twenty-four days, eighty-two minutes, a sign-in
# code, three features and a parent's "on track to master" whenever the send path left them out.
_INVENTED: dict[str, tuple[str, ...]] = {
    "quick_one": ("minute",),
    "streak": ("3 days", "three days"),
    "verify_email": ("482913", "enter this code"),
    "boss_victory": ("topic boss",),
    "level_up": ("level 4", "perturbation", "rabbit hole", "three roads"),
    "streak_milestone": ("24",),
    "weekly_digest": ("82", "minutes", "circuits", "mole", "acids", "three topics"),
    "parent_report": ("on track", "problem-solving", "time pressure", "strengths"),
    "reengage": ("2ab", "ten minutes", "square"),
}


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_a_send_that_gave_no_number_is_told_no_number(kind: str) -> None:
    """The welcome's numbered steps and its example ("question 7") are not counts of anything the
    reader did, so the welcome is read with those removed; nothing else is excused."""
    out = render(kind, {})
    body = re.sub(r"https?://\S+", " ", body_of(out))
    if kind == "welcome":
        body = re.sub(r"^\d\. |question 7", " ", body, flags=re.M)
    for where, blob in (("subject", out["subject"]),
                        ("preheader", str(out.get("preheader") or "")), ("body", body)):
        assert not re.search(r"\d", blob), f"{kind} {where}: {blob[:120]!r}"
    seen = " ".join([out["subject"], str(out.get("preheader") or ""), text_of(out),
                     _seen(out["html"])]).lower()
    for invented in _INVENTED.get(kind, ()):
        assert invented not in seen, f"{kind}: {invented!r}"


@pytest.mark.parametrize("audience", ["learner", "parent"])
def test_the_quick_one_the_cadence_sends_claims_no_time(audience: str) -> None:
    """hospitality/cadence.py sends the chapter, the course and the card, and no minutes."""
    data = {"chapter": "Fractions, part two", "course_id": "c1", "card_id": "3",
            "audience": audience, "learner_name": "Learner"}
    out = render("quick_one", data)
    seen = " ".join([out["subject"], out["preheader"], text_of(out), _seen(out["html"])])
    assert "minute" not in seen.lower(), seen[:200]
    assert "Fractions, part two" in out["subject"] and "waiting" in out["subject"]
    if audience == "learner":
        assert out["subject"] == "Fractions, part two, is waiting"
    else:
        assert out["subject"].startswith("Learner’s next card in Fractions, part two,")
    timed = render("quick_one", {**data, "minutes": 5})
    assert "about five minutes" in timed["subject"], timed["subject"]


# A CAPITAL AFTER A COLON, and a small letter at the start (the closer's run, 2026-09-17). The
# capital test above renders the defaults only, so a real headline got through both ways.
@pytest.mark.parametrize(
    "headline",
    ["A seed mail landed in spam", "a seed mail landed in spam", "Something needs a look",
     "Quick one paused after complaints"],
)
def test_the_mail_alert_reads_as_sentences_whatever_headline_it_is_given(headline: str) -> None:
    out = render("mail_alert", {"headline": headline, "line": "a seed landed in spam.",
                                "action": "nothing was paused."})
    after_colon = out["subject"].split(": ", 1)[1]
    assert after_colon[:1].islower(), out["subject"]
    lines = [line for line in text_of(out).split("\n") if line.strip()]
    assert all(line[:1].isupper() for line in lines[:3]), lines[:3]
    assert f">{headline[:1].upper()}{headline[1:]}</h1>" in out["html"]


def test_a_proper_name_after_the_colon_keeps_its_capital() -> None:
    assert render("mail_alert", {"headline": "Gmail spam rate is over the line"})[
        "subject"
    ] == "Mail watch: Gmail spam rate is over the line"
    out = render(
        "sunday_note", {"learner_name": "Learner", "headline": "Learner had a steady week."}
    )
    assert "Here is Learner’s week in one page: Learner had a steady week." in text_of(out)
    out = render("sunday_note", {"learner_name": "Learner", "headline": "CBSE fractions, done."})
    assert "in one page: CBSE fractions, done." in text_of(out)


def test_the_sunday_note_does_not_capitalise_after_its_colon() -> None:
    out = render("sunday_note", {"learner_name": "Learner", "headline": "A steady week."})
    assert "Here is Learner’s week in one page: a steady week." in text_of(out)


# THE DARK CLIENT, measured (2026-09-17). `apps/web-pwa/scripts/mail-contrast.ts` measures it
# again: every kind, 390 and 1440, both schemes, every visible text node. The first run found the
# Sunday note's and the win's headlines and the welcome's three things navy on the dark card,
# and the shell's footer links at 2.70:1. What a browser showed is pinned here as the two things
# that fixed it.
_LIGHT_GROUNDS = ("#FFF1D6", "#F1EDE3", "#E6EAFF", "#DDF6EC", "#FFE7E2", "#F1F1F5")


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_the_dark_card_repaints_the_ink_the_lines_were_written_in(kind: str) -> None:
    html = a_render(kind)["html"]
    styles = "".join(part.split("</style>", 1)[0] for part in html.split("<style>")[1:])
    assert ".wobo-card{color:" in styles, kind
    for ink in ("#14142B", "#4E4E66", "#2B45FF"):
        assert f'.wobo-card [style*="color:{ink}"]' in styles, f"{kind}: {ink}"
    for ink in ("#5C5E66", "#1F35E0"):
        if f"color:{ink}" in html.split("</head>", 1)[-1]:
            assert f'.wobo-card [style*="color:{ink}"]' in styles, f"{kind}: {ink}"


@pytest.mark.parametrize("kind", ["sunday_note", "win", "wish", "parent_invite", "parent_report"])
def test_a_light_tile_on_the_dark_card_keeps_its_light_ink(kind: str) -> None:
    """Every light block drawn inside a card says so, or the dark rules repaint its words pale."""
    data = {**SAMPLE.get(kind, {"name": "Learner", "learner_name": "Learner"}),
            "lessons": 3, "note": "They asked why twice.", "note_accent": "Good."}
    html = render(kind, data)["html"]
    for tag in re.findall(r"<(?:table|td|div)[^>]*>", html):
        if any(f"background:{g}" in tag or f"background-color:{g}" in tag for g in _LIGHT_GROUNDS):
            if "<a " in tag or "border-radius:12px" in tag:
                continue
            assert 'class="wobo-tonal"' in tag, f"{kind}: {tag[:90]}"
    assert 'class="wobo-tonal"' in html, kind
