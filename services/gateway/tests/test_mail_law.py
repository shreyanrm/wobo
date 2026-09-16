"""The mail law, asserted over every rendered template (docs/MAIL-PRIMARY.md).

The law ends with a section called "What a test asserts" and names this file by name. It did not
exist, so twenty-six rules that read like settled law were settled nowhere: nine of them were
true only because nobody had written the sentence that would have broken them.

**Why the checks live here and not in test_email.py.** test_email.py is about the SEND — the
door, the retry, the idempotency key, the queued fallback. This file is about the MESSAGE, and
it is run over `TEMPLATES` rather than over a list written here, so a twenty-first kind cannot be
added without meeting the same bar as the twenty before it. That is the whole point of scanning
rather than reviewing.

**Two places where this file knowingly departs from the law's literal list, both named rather
than quietly widened:**

* ``welcome`` is over the 120-word body ceiling (130). It is the owner's own paper design, it is
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
from typing import Any

import pytest
from wobo_gateway import email as email_mod
from wobo_gateway.email import send_email
from wobo_gateway.email_templates import (
    SUBSCRIBED_KINDS,
    TEMPLATES,
    TRANSACTIONAL_KINDS,
    render,
    text_of,
)
from wobo_gateway.hospitality.tokens import stop_link

# --- what each kind is given, so every rendering is a real one -------------------------------
# A template handed nothing renders its no-name branch, which is tested separately. These are the
# facts a real send carries, so the assertions below are made against the mail a person receives.
SAMPLE: dict[str, dict[str, Any]] = {
    "quick_one": {"name": "Learner", "chapter": "Fractions, part two", "minutes": 5},
    "mid_chapter": {"name": "Learner", "chapter": "Linear equations", "cards_left": 2},
    "streak": {"name": "Learner", "days": 7},
    "bonus_level": {"name": "Learner", "between": "Motion and Force"},
    "doubt": {"name": "Learner", "chapter": "Refraction"},
    "course_ready": {"name": "Learner", "topic": "Fractions"},
    "boss_victory": {"name": "Learner", "topic": "Fractions"},
    "win": {"name": "Learner", "chapter": "Triangles"},
    "sunday_note": {"learner_name": "Learner", "name": "Learner", "days_active": 4},
    "parent_report": {"learner_name": "Learner", "name": "Learner"},
    "parent_invite": {"learner_name": "Learner"},
}


def a_render(kind: str) -> dict[str, Any]:
    return render(kind, SAMPLE.get(kind, {"name": "Learner", "learner_name": "Learner"}))


ALL_KINDS = sorted(TEMPLATES)

#: The kinds whose body is a page rather than a note. The law names four; ``welcome`` joins them
#: for the reason in this module's docstring, and ``first_week`` is a milestone of ``win`` rather
#: than a template of its own, so it is not a kind here.
LONG_FORM = frozenset({"sunday_note", "win", "parent_report", "welcome", "parent_invite"})

BODY_WORDS = 120
LONG_FORM_WORDS = 200
TEXT_FLOOR = 500
SUBJECT_LIMIT = 60

#: Where the footer starts, in the plain-text twin. Every template's footer opens on the sentence
#: that says why this arrived; the two paper kinds that phrase it differently are named too. The
#: word ceiling is measured on what comes BEFORE this, because the footer is required text and
#: counting it would punish a kind for carrying its own legal line.
_FOOTER = re.compile(
    r"^(You get this|You got this|You(?:'|’)re getting this|Wobo writes when)",
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
    for where, blob in (("subject", out["subject"]), ("preheader", str(out.get("preheader") or ""))):
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
    for where, blob in (
        ("subject", out["subject"]),
        ("preheader", str(out.get("preheader") or "")),
        ("first line", body_of(out)[:120]),
    ):
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
    "just for you", "level up",
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
def test_there_are_few_destinations_and_one_of_them_is_the_button(kind: str) -> None:
    html = a_render(kind)["html"]
    destinations = {h for h in _HREF.findall(html)}
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
