"""The laws an audit found unasserted, each one red before the fix that makes it green.

Every test here was written against the code as it stood on 2026-09-16 and failed. They are
grouped the way the audit was ordered: spam first, because a mail that should not have gone is a
broken promise to a parent, then what is broken, then what is ugly, then what is sloppy.

Nothing here sends. ``EMAIL_MODE`` stays console, the provider hop is captured rather than made,
and every clock is handed in.
"""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from wobo_gateway import email as email_mod
from wobo_gateway.email import MailLog, MailRecord, mail_log, to_hash
from wobo_gateway.email_templates import (
    NUDGE_KINDS,
    ORB_MOVES,
    SUBSCRIBED_KINDS,
    TEMPLATES,
    render,
    text_of,
)
from wobo_gateway.hospitality import jobs
from wobo_gateway.hospitality import nudges as nudges_mod
from wobo_gateway.hospitality import preferences as prefs_mod
from wobo_gateway.hospitality.nudges import Learner, Nudge, send_nudge

# 2026-09-09 is a Wednesday; 2026-09-13 is a Sunday. 16:00 in Kolkata is 10:30 UTC.
WED_FOUR_PM_IST = datetime(2026, 9, 9, 10, 30, tzinfo=UTC)
SUN_FOUR_PM_IST = datetime(2026, 9, 13, 10, 30, tzinfo=UTC)
SUN_SIX_PM_IST = datetime(2026, 9, 13, 12, 30, tzinfo=UTC)

TEEN = Learner(
    learner_id="L-1",
    name="Learner",
    email="learner@example.test",
    parent_email="parent@example.test",
    under_13=False,
    timezone="Asia/Kolkata",
    last_seen=date(2026, 9, 6),
)
CHILD = replace(TEEN, learner_id="L-2", under_13=True)

#: What a nudge needs to land where its own sentence says it lands (design §4).
CARD = {"course_id": "m2-1", "card_id": "c7"}


class Recorder:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def __call__(
        self, kind: str, to: str, data: dict[str, Any] | None = None, **kw: Any
    ) -> dict[str, Any]:
        self.sent.append({"kind": kind, "to": to, "data": data or {}, **kw})
        return {"ok": True, "mode": "console"}


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "test-mail-secret")
    monkeypatch.delenv("MAIL_QUIET_HOURS", raising=False)
    monkeypatch.delenv("MAIL_ORB_IMAGES", raising=False)
    monkeypatch.delenv("MAIL_DAILY_CAP", raising=False)
    email_mod.set_mail_log(MailLog())
    store = prefs_mod.InMemoryPreferencesStore()
    prefs_mod.set_store(store)
    yield store
    prefs_mod.set_store(None)
    email_mod.reset_mail_log()


def a_nudge(kind: str = "quick_one", learner: Learner = TEEN, **data: Any) -> Nudge:
    facts = {**CARD, **data}
    return Nudge(kind=kind, learner=learner, once_key=facts.pop("once_key", "k1"), data=facts)


def a_send(
    to: str, *, kind: str = "quick_one", when: datetime, provider_id: str = "console"
) -> None:
    """One row in the log, as a real send leaves behind."""
    mail_log().record(
        MailRecord(
            key=f"{kind}:{to_hash(to)}:{when.isoformat()}",
            learner_id="L-1",
            kind=kind,
            to_hash=to_hash(to),
            period=when.date().isoformat(),
            sent_at=when.isoformat(),
            provider_id=provider_id,
        )
    )


# === SPAM ========================================================================================
# One per day is not a cadence, it is a licence for thirty a month, and the rules that exist today
# silence the ENGAGED learner (came_enough) while leaving the lapsed one uncapped.
def test_a_lapsed_learners_parent_does_not_hear_from_us_thirteen_days_in_a_fortnight() -> None:
    """The audit drove this: one learner who came once and never came back, every surface
    raising its nudge, and the parent got thirteen mails on thirteen of fourteen days."""
    send = Recorder()
    got = 0
    for day in range(14):
        moment = WED_FOUR_PM_IST + timedelta(days=day)
        result = send_nudge(
            a_nudge(once_key=f"day-{day}"), now=moment, send=send
        )
        if result.get("ok"):
            got += 1
            a_send(TEEN.email, when=moment)
    # Two rolling weeks, each held to the owner's weekly number: the thirteen becomes at most six.
    ceiling = 2 * nudges_mod.WEEKLY_NUDGE_CAP
    assert got <= ceiling, f"a fortnight sent {got} mails to one address (ceiling {ceiling})"


def test_the_owners_cadence_is_three_a_week() -> None:
    """The owner, 2026-09-16, ruling on a number a builder had set at two: three a week."""
    assert nudges_mod.WEEKLY_NUDGE_CAP == 3


def _earlier_this_week(count: int) -> None:
    """``count`` sends to one address on separate earlier days inside the rolling week."""
    for i in range(count):
        days_back = 2 + 2 * i  # 2, 4, 6: separate days, all inside seven
        assert days_back < nudges_mod.NUDGE_WEEK.days, "raise the cap, re-space these sends"
        a_send(TEEN.email, when=WED_FOUR_PM_IST - timedelta(days=days_back))


def test_the_last_nudge_the_week_allows_still_goes() -> None:
    send = Recorder()
    _earlier_this_week(nudges_mod.WEEKLY_NUDGE_CAP - 1)
    result = send_nudge(a_nudge(once_key="last-allowed"), now=WED_FOUR_PM_IST, send=send)
    assert result.get("ok"), result


def test_a_nudge_past_the_weekly_cap_is_held() -> None:
    send = Recorder()
    _earlier_this_week(nudges_mod.WEEKLY_NUDGE_CAP)
    result = send_nudge(a_nudge(once_key="one-too-many"), now=WED_FOUR_PM_IST, send=send)
    assert result.get("error") == "weekly_cap", result
    assert send.sent == []


def test_the_week_turns_over_and_the_address_may_hear_from_us_again() -> None:
    send = Recorder()
    a_send(TEEN.email, when=WED_FOUR_PM_IST - timedelta(days=9))
    a_send(TEEN.email, when=WED_FOUR_PM_IST - timedelta(days=8))
    assert send_nudge(a_nudge(once_key="after"), now=WED_FOUR_PM_IST, send=send)["ok"]


# === BROKEN ======================================================================================
# 1. The nudges starve the Sunday note, permanently: the window opens at 08:00 and the note is
#    pinned to 18:00, so on any Sunday with a nudge due the nudge takes the address's one slot.
def test_a_nudge_never_takes_the_sunday_notes_slot() -> None:
    send = Recorder()
    result = send_nudge(a_nudge(once_key="sun"), now=SUN_FOUR_PM_IST, send=send)
    assert result.get("error") == "sunday_note_first", result
    assert send.sent == []


def test_the_sunday_note_still_goes_at_six() -> None:
    """The one mail the design guarantees a family survives the day it is guaranteed on."""
    assert jobs.sunday_note_due(SUN_SIX_PM_IST.astimezone(jobs.get_calendar().timezone_for(
        replace(prefs_mod.DEFAULT_PREFERENCES, timezone="Asia/Kolkata"), at=SUN_SIX_PM_IST
    )))


# 3. The queued path is described as a deferral. It is a destruction: queued() writes the
#    idempotency key, so the mail is never retried and the inbox is silenced for a day.
def test_a_would_send_is_never_counted_as_already_sent() -> None:
    key = email_mod.idempotency_key("quick_one", TEEN.email, "p1", learner_id="L-1")
    mail_log().record(
        MailRecord(
            key=key,
            learner_id="L-1",
            kind="quick_one",
            to_hash=to_hash(TEEN.email),
            period="p1",
            sent_at=WED_FOUR_PM_IST.isoformat(),
            provider_id="queued",
        )
    )
    assert mail_log().seen(key) is None, "a would-send is being read back as a send"
    out = email_mod.send_email(
        "quick_one", TEEN.email, {"name": "Learner"}, learner_id="L-1", period="p1"
    )
    assert not out.get("duplicate"), "a mail nobody received was refused as a duplicate"


def test_a_would_send_does_not_silence_the_inbox_for_a_day() -> None:
    a_send(TEEN.email, when=WED_FOUR_PM_IST - timedelta(hours=3), provider_id="queued")
    assert jobs.gap_until(TEEN.email, WED_FOUR_PM_IST) is None


def test_a_real_send_still_silences_the_inbox_for_a_day() -> None:
    """The rule the one above must not break."""
    a_send(TEEN.email, when=WED_FOUR_PM_IST - timedelta(hours=3), provider_id="em_real")
    assert jobs.gap_until(TEEN.email, WED_FOUR_PM_IST) is not None


# 13. Every nudge button lands on a generic page: nothing in src produces course_id or card_id,
#     so the signed card link is never minted and design §4 is true only in the suite.
def test_a_nudge_whose_sentence_names_a_card_never_lands_on_a_generic_page() -> None:
    send = Recorder()
    bare = Nudge(kind="quick_one", learner=TEEN, once_key="k", data={})
    result = send_nudge(bare, now=WED_FOUR_PM_IST, send=send)
    assert result.get("error") == "no_destination", result
    assert send.sent == []


def test_a_nudge_with_a_card_carries_the_signed_link() -> None:
    send = Recorder()
    assert send_nudge(a_nudge(), now=WED_FOUR_PM_IST, send=send)["ok"]
    assert "/course/m2-1/card/c7?k=" in send.sent[0]["data"]["cta_url"]


def test_the_streak_still_goes_home_because_that_is_where_it_belongs() -> None:
    """The streak is about the days, not about a card; it is the one kind with no destination."""
    send = Recorder()
    streak = Nudge(kind="streak", learner=TEEN, once_key="7", data={"days": 7})
    assert send_nudge(streak, now=WED_FOUR_PM_IST, send=send)["ok"]


# 14. The daily cap and the superadmin's per-kind switch sit AFTER the console early-return, so
#     neither is ever consulted in the mode the whole suite and every local run use.
def test_a_kind_the_superadmin_switched_off_is_held_in_console_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(email_mod, "kind_is_off", lambda kind: kind == "quick_one")
    out = email_mod.send_email(
        "quick_one", TEEN.email, {"name": "Learner"}, learner_id="L-1", period="p"
    )
    assert out.get("queued") and out.get("error") == "kind_switched_off", out


def test_the_daily_cap_holds_in_console_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAIL_DAILY_CAP", "2")
    for i in range(2):
        a_send(f"other-{i}@example.test", when=WED_FOUR_PM_IST, provider_id=f"em_{i}")
    out = email_mod.send_email(
        "quick_one",
        TEEN.email,
        {"name": "Learner"},
        learner_id="L-1",
        period="p",
        at=WED_FOUR_PM_IST,
    )
    assert out.get("queued") and out.get("error") == "daily_cap", out


def test_a_seed_send_records_the_tab_it_landed_in() -> None:
    """MAIL-PRIMARY §3 makes the seed measurement the gate on ever shipping an image, and no
    'seed' event was ever written by anything."""
    email_mod.record_seed_placement(
        kind="quick_one", inbox="gmail", tab="primary", at=WED_FOUR_PM_IST
    )
    seeds = [e for e in mail_log().events() if e["event"] == "seed"]
    assert len(seeds) == 1
    assert seeds[0]["detail"] == {"inbox": "gmail", "tab": "primary"}
    assert seeds[0]["to_hash"] == MailLog.NO_ADDRESS


# 2. Not one mail carries an orb: orb_url has no producer anywhere in src, so ORB_MOVES is dead
#    on the wire and the premise of the owner's brief is absent from every mail.
def test_the_orb_has_a_producer_and_every_nudge_hands_its_move_to_the_template(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MAIL_ORB_IMAGES", "on")
    send = Recorder()
    for kind in NUDGE_KINDS:
        # One address per kind: five mails to one inbox in one day is the thing the cadence rule
        # above exists to refuse, so the fixture must not ask for it.
        learner = replace(TEEN, learner_id=f"L-{kind}", email=f"{kind}@example.test")
        send_nudge(
            a_nudge(kind, learner, days=7, cards_left=2, between="Motion and Force"),
            now=WED_FOUR_PM_IST,
            send=send,
        )
    assert len(send.sent) == len(NUDGE_KINDS)
    for record in send.sent:
        url = record["data"].get("orb_url") or ""
        assert url.endswith(f"/{ORB_MOVES[record['kind']]}.gif"), record["kind"]
        assert url.startswith("https://"), url


def test_the_orb_stays_off_until_the_seed_test_has_measured_it() -> None:
    """MAIL-PRIMARY: the GIF takes every template from zero remote fetches to one, so it is
    measured before and after or nothing ships. Off is the default, and off means no image."""
    for kind in NUDGE_KINDS:
        assert "<img" not in render(kind, {"name": "Learner"})["html"], kind


# === UGLY ========================================================================================
# 7. Only the five nudges declare a colour scheme. The other fifteen sit on their light ground in
#    a dark client, which is the cream-card-with-navy-ink case the newest shell was written to
#    escape.
@pytest.mark.parametrize("kind", sorted(TEMPLATES))
def test_every_mail_tells_the_client_what_it_is_in_the_dark(kind: str) -> None:
    html = render(kind, {"name": "Learner", "learner_name": "Learner"})["html"]
    assert 'name="color-scheme"' in html, f"{kind}: no colour scheme declared"
    assert "prefers-color-scheme: dark" in html, f"{kind}: nothing is repainted in the dark"


# 8. The nudge shell repaints four things and misses the fifth, which is the character:
#    _orb_signature carries no class, so its navy disc and navy sign-off survive onto the dark
#    card at 1.03:1.
def test_the_character_and_its_sign_off_survive_the_dark() -> None:
    from wobo_gateway.email_templates import _orb_signature

    mark = _orb_signature(0)
    assert 'class="wobo-ink"' in mark, "the sign-off is not repainted in the dark"
    assert "wobo-orb-disc" in mark, "the orb's own disc is not repainted in the dark"


# 12. course_ready is untouched by the movie-poster law and is the worst mail in the fleet at 390:
#     the old ultramarine shell, a bulleted list, lowercase sentence fragments, 93 words.
def test_course_ready_is_written_in_the_shape_the_law_names() -> None:
    out = render("course_ready", {"name": "Learner", "topic": "Fractions"})
    body = text_of(out).split("You get this")[0]
    words = len(body.split())
    assert words <= 80, f"{words} words against the law's eighty"
    # The bullet CELL, not the footer's separator, which is a legitimate middot between links.
    assert ">&middot;</td>" not in out["html"], "the bulleted list is still there"
    assert out["subject"][0].isupper(), out["subject"]
    for line in [ln for ln in body.split("\n") if ln.strip()]:
        assert line.lstrip()[0].isupper(), f"a sentence fragment in lower case: {line!r}"


# === SLOPPY ======================================================================================
# 5. Every nudge tells the reader they asked for it. No learner ever asked: every dial defaults
#    to True, so consent is assumed at account creation and reported back as a request.
@pytest.mark.parametrize("kind", sorted(TEMPLATES))
def test_no_mail_tells_the_reader_they_asked_for_something_they_never_asked_for(
    kind: str,
) -> None:
    blob = (
        text_of(render(kind, {"name": "Learner", "learner_name": "Learner"}))
        + render(kind, {"name": "Learner", "learner_name": "Learner"})["html"]
    ).lower()
    for claim in ("you asked me to", "you asked us to", "you requested"):
        assert claim not in blob, f"{kind}: {claim!r}"


# 6. Every parent-register nudge contains a sentence that starts with a lowercase letter, because
#    _why interpolates the learner branch's kind_line verbatim after a full stop.
@pytest.mark.parametrize("kind", sorted(NUDGE_KINDS))
def test_the_parents_register_is_written_in_sentences(kind: str) -> None:
    out = render(
        kind,
        {
            "audience": "parent",
            "learner_name": "Anika",
            "chapter": "Fractions",
            "days": 7,
            "cards_left": 2,
            "between": "Motion and Force",
        },
    )
    for sentence in re.findall(r"(?:^|(?<=[.!?])\s+)([A-Za-z][^.!?]*)", text_of(out)):
        first = sentence.strip()[:1]
        assert not first.islower(), f"{kind}: a sentence begins lower case: {sentence[:60]!r}"


# 11. welcome is the only subscribed kind with no stop route in its body at all: its footer offers
#     the sign-in-gated preferences page, which MAIL-PRIMARY line 120 warns against by name.
@pytest.mark.parametrize("kind", sorted(SUBSCRIBED_KINDS - {"parent_invite"}))
def test_every_subscribed_kind_can_be_stopped_from_its_own_body(kind: str) -> None:
    stop = "https://api.heywobo.com/v1/mail/stop?token=abc"
    data = {"name": "Learner", "learner_name": "Learner", "unsubscribe_url": stop}
    out = render(kind, data)
    assert stop in out["html"], f"{kind}: no stop link in the body"
    assert stop in text_of(out), f"{kind}: no stop link in the text twin"


def test_the_parent_invite_is_stopped_by_the_route_the_law_names_for_it() -> None:
    """The one exception, and it is named rather than quietly widened: the invite is a cold
    message to an adult who never gave us their address, so its way out is the signed decline
    route ("Not me") and not a list to unsubscribe from (docs/MAIL-PRIMARY.md §2)."""
    decline = "https://api.heywobo.com/v1/parent/decline?token=abc"
    out = render("parent_invite", {"learner_name": "Anika", "decline_url": decline})
    assert decline in out["html"]
    assert decline in text_of(out)
    assert out["headers"]["List-Unsubscribe"] == f"<{decline}>"
