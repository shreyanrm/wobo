"""The weekly cadence (docs/EMAILS-AND-ANIMATIONS.md, "The weekly cadence", the owner, 2026-09-16).

Three a week is a FLOOR. Every reachable address hears from Wobo at least three times in any
rolling seven days, and when behaviour has not earned a mail the gap is filled with good news
about the learner's own work. Behaviour earns more, up to the inbox law's one a day. Away, the
mail steps down with time and never falls below one a month. Only an unsubscribe stops it.

Every number here is read from the code that holds it (``activity.STEPS``, ``jobs.INBOX_GAP``,
``cadence``), so a moved constant moves the test with it. Nothing sends: every send is a
recorder or a console render, and every clock is handed in.
"""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from wobo_gateway import activity, dials
from wobo_gateway import email as email_mod
from wobo_gateway.email import MailLog, MailRecord, mail_log, to_hash
from wobo_gateway.email_templates import NUDGE_KINDS, render, text_of
from wobo_gateway.hospitality import cadence, jobs, nudges
from wobo_gateway.hospitality import preferences as prefs_mod
from wobo_gateway.hospitality.nudges import RETURN_NUDGES, Learner, Nudge, run_nudges, send_nudge
from wobo_gateway.hospitality.preferences import DEFAULT_PREFERENCES, MailPreferences
from wobo_gateway.hospitality.tokens import AUDIENCES, parse_stop_token

IST = ZoneInfo("Asia/Kolkata")
ZONE = "Asia/Kolkata"
FULL = activity.STEPS[0]
#: 2026-09-21 is a Monday.
MONDAY = date(2026, 9, 21)
PARENT = "parent@example.test"
TEEN_ADDRESS = "learner@example.test"


def local(day: date, hour: int, minute: int = 30) -> datetime:
    """A moment on the family's clock, handed to the code in UTC as the cron hands it."""
    return datetime.combine(day, time(hour, minute), tzinfo=IST).astimezone(UTC)


class Recorder:
    """Every send, kept; and written to the mail log the way a real console send is, so the
    inbox gap and the floor read what went."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def __call__(
        self, kind: str, to: str, data: dict[str, Any] | None = None, **kw: Any
    ) -> dict[str, Any]:
        self.sent.append({"kind": kind, "to": to, "data": data or {}, **kw})
        at = kw.get("at") or datetime.now(UTC)
        key = email_mod.idempotency_key(
            kind, to, kw.get("period") or "", learner_id=kw.get("learner_id")
        )
        if mail_log().seen(key):
            return {"ok": True, "duplicate": True}
        mail_log().record(
            MailRecord(
                key=key,
                learner_id=kw.get("learner_id"),
                kind=kind,
                to_hash=to_hash(to),
                period=kw.get("period") or "",
                sent_at=at.astimezone(UTC).isoformat(),
                provider_id="console",
            )
        )
        return {"ok": True, "mode": "console"}


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "test-mail-secret")
    monkeypatch.delenv("MAIL_QUIET_HOURS", raising=False)
    monkeypatch.delenv("MAIL_DAILY_CAP", raising=False)
    email_mod.set_mail_log(MailLog())
    store = prefs_mod.InMemoryPreferencesStore()
    prefs_mod.set_store(store)
    activity.set_store(activity.InMemoryActivityStore())
    yield store
    prefs_mod.set_store(None)
    activity.set_store(None)
    email_mod.reset_mail_log()


def a_family(**kw: Any) -> jobs.Family:
    fields: dict[str, Any] = {
        "learner_id": str(uuid.uuid4()),
        "learner_name": "Learner",
        "parent_email": PARENT,
        "timezone": ZONE,
        "under_13": True,
    }
    fields.update(kw)
    return jobs.Family(**fields)


def came(learner_id: str, day: date, *, hour: int = 17, **progress: Any) -> None:
    """A visit on the learner's own clock: a session, a stretch of talking, and optionally a card
    report, a finished module or a mastered topic."""
    store = activity.get_store()
    at = datetime.combine(day, time(hour, 45), tzinfo=IST)
    session = str(uuid.uuid4())
    store.note(learner_id, activity.Event("session_start", at, ZONE, session=session))
    store.note(learner_id, activity.Event("turn", at + timedelta(minutes=1), ZONE))
    if "done" in progress:
        store.note(
            learner_id,
            activity.Event(
                "progress",
                at + timedelta(minutes=5),
                ZONE,
                ref=progress.get("ref", "fractions"),
                title=progress.get("title", "Fractions"),
                done=progress["done"],
                total=progress.get("total", 10),
            ),
        )
    for kind in ("module_finished", "topic_mastered"):
        if kind in progress:
            store.note(
                learner_id,
                activity.Event(
                    kind, at + timedelta(minutes=8), ZONE, ref="triangles", title=progress[kind]
                ),
            )


def planned(family: jobs.Family, at: datetime) -> list[Nudge]:
    store = activity.get_store()
    summary = store.get(family.learner_id)
    days = store.days(family.learner_id, since=at.date() - timedelta(days=cadence.RHYTHM_DAYS))
    return cadence.plan(family, summary, days, at=at)


def sent_on(to: str, when: datetime, kind: str = "learning_note") -> None:
    mail_log().record(
        MailRecord(
            key=f"{kind}:{to_hash(to)}:{when.isoformat()}",
            learner_id="someone",
            kind=kind,
            to_hash=to_hash(to),
            period=when.isoformat(),
            sent_at=when.astimezone(UTC).isoformat(),
            provider_id="console",
        )
    )


def drive(step: activity.Step, days: int) -> list[date]:
    """Send on every day the floor says is due and the step allows, and nowhere else."""
    sent: list[date] = []
    for n in range(days):
        today = MONDAY + timedelta(days=n)
        if cadence.floor_due(step, sent, today) and not cadence.over_the_step(step, sent, today):
            sent.append(today)
    return sent


def windows(sent: list[date], length: int, days: int) -> list[int]:
    return [
        sum(
            1 for d in sent if MONDAY + timedelta(days=s) <= d < MONDAY + timedelta(days=s + length)
        )
        for s in range(days - length + 1)
    ]


# === 1. the floor =================================================================================
def test_the_floor_is_the_owners_three_in_seven_days() -> None:
    assert FULL.id == "full" and FULL.mails == 3 and FULL.per_days == 7
    assert cadence.FLOOR is FULL


def test_driven_by_the_floor_alone_every_seven_days_hold_three() -> None:
    sent = drive(FULL, 84)
    assert min(windows(sent, FULL.per_days, 84)) >= FULL.mails
    assert len(set(sent)) == len(sent), "two on one day"


def test_an_address_nobody_has_written_to_is_due_today() -> None:
    assert cadence.floor_due(FULL, [], MONDAY)


def test_an_address_that_heard_three_times_this_week_is_not_due() -> None:
    heard = [MONDAY - timedelta(days=d) for d in (1, 3, 5)]
    assert not cadence.floor_due(FULL, heard, MONDAY)


def test_on_the_full_cadence_the_floor_is_kept_a_day_before_its_last_day() -> None:
    """Three in the last seven days, the oldest six days ago: tomorrow is the last day the week
    can hold three, so the note is owed today, and tomorrow is still there if today is lost."""
    heard = [MONDAY - timedelta(days=d) for d in (2, 4, 6)]
    assert cadence.floor_deadline(FULL, heard, MONDAY) == MONDAY + timedelta(days=1)
    assert cadence.floor_due(FULL, heard, MONDAY)


def test_an_address_that_heard_today_is_not_due_again_today() -> None:
    assert not cadence.floor_due(FULL, [MONDAY], MONDAY)


def test_a_quiet_week_is_filled_with_good_news() -> None:
    """Nothing earned a mail, the address is owed one: the scheduler writes one about the
    learner's own work."""
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=1), done=4)
    plan = planned(family, local(MONDAY, 16))
    assert plan, "an address owed a mail was planned nothing"
    floor = plan[-1]
    assert floor.kind == "learning_note"
    assert floor.kind not in RETURN_NUDGES


# === 2. the ceiling ==============================================================================
def test_the_ceiling_is_the_inbox_laws_one_a_day() -> None:
    assert timedelta(hours=24) == jobs.INBOX_GAP
    assert not hasattr(nudges, "WEEKLY_NUDGE_CAP"), "three a week is a floor, not a ceiling"


def test_on_the_full_cadence_a_fourth_mail_in_a_week_still_goes() -> None:
    learner = Learner(
        learner_id="L-1",
        name="Learner",
        email=TEEN_ADDRESS,
        under_13=False,
        timezone=ZONE,
        last_seen=MONDAY - timedelta(days=1),
        days_away=1,
    )
    for back in (2, 3, 4, 5):
        sent_on(TEEN_ADDRESS, local(MONDAY, 16) - timedelta(days=back))
    result = send_nudge(
        Nudge(kind="streak", learner=learner, once_key="k", data={"days": 5}),
        now=local(MONDAY, 16),
        send=Recorder(),
    )
    assert result.get("ok"), result


def test_one_pass_sends_one_mail_per_address() -> None:
    learner = Learner(
        learner_id="L-1", name="Learner", email=TEEN_ADDRESS, under_13=False, timezone=ZONE
    )
    source = nudges.InMemoryNudges(
        [
            Nudge(kind="streak", learner=learner, once_key="a", data={"days": 3}),
            Nudge(kind="learning_note", learner=learner, once_key="b", data={"angle": "waiting"}),
        ]
    )
    send = Recorder()
    report = run_nudges(local(MONDAY, 16), source=source, send=send)
    assert report["sent"] == 1 and len(send.sent) == 1
    assert report["skipped"].get("one_a_day") == 1


# === 3. the gates =================================================================================
def test_the_come_back_kinds_are_the_two_that_ask_for_a_return() -> None:
    assert frozenset({"quick_one", "mid_chapter"}) == RETURN_NUDGES
    assert "learning_note" in NUDGE_KINDS and "learning_note" not in RETURN_NUDGES


@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_on_a_day_the_learner_came_only_a_come_back_mail_is_held(kind: str) -> None:
    learner = Learner(
        learner_id="L-1",
        name="Learner",
        email=TEEN_ADDRESS,
        under_13=False,
        timezone=ZONE,
        last_seen=MONDAY,
        days_away=0,
    )
    nudge = Nudge(
        kind=kind,
        learner=learner,
        once_key="k",
        data={"course_id": "fractions", "card_id": "3", "days": 3, "angle": "waiting"},
    )
    result = send_nudge(nudge, now=local(MONDAY, 17), send=Recorder())
    if kind in RETURN_NUDGES:
        assert result["error"] == "came_today"
    else:
        assert result.get("ok"), (kind, result)


@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_a_good_week_holds_only_the_come_back_mails(kind: str) -> None:
    keen = Learner(
        learner_id="L-1",
        name="Learner",
        email=TEEN_ADDRESS,
        under_13=False,
        timezone=ZONE,
        last_seen=MONDAY - timedelta(days=1),
        days_this_week=nudges.ENOUGH_DAYS,
        days_away=1,
    )
    nudge = Nudge(
        kind=kind,
        learner=keen,
        once_key="k",
        data={"course_id": "fractions", "card_id": "3", "days": 3, "angle": "waiting"},
    )
    result = send_nudge(nudge, now=local(MONDAY, 17), send=Recorder())
    if kind in RETURN_NUDGES:
        assert result["error"] == "came_enough"
    else:
        assert result.get("ok"), (kind, result)


def test_sunday_is_held_only_for_the_address_the_note_goes_to() -> None:
    sunday = MONDAY + timedelta(days=6)
    nudge = Nudge(
        kind="learning_note",
        learner=Learner(
            learner_id="L-1",
            name="Learner",
            email=TEEN_ADDRESS,
            parent_email=PARENT,
            under_13=False,
            timezone=ZONE,
            days_away=3,
        ),
        once_key="k",
        data={"angle": "waiting"},
    )
    # The teen's own inbox is not where the note goes.
    assert send_nudge(nudge, now=local(sunday, 16), send=Recorder()).get("ok")
    child = replace(nudge, learner=replace(nudge.learner, under_13=True, learner_id="L-2"))
    assert send_nudge(child, now=local(sunday, 16), send=Recorder())["error"] == "sunday_note_first"
    # A week with no note coming is not a day to keep empty.
    quiet = replace(child, learner=replace(child.learner, sunday_note_expected=False))
    assert send_nudge(quiet, now=local(sunday, 16), send=Recorder()).get("ok")


# === 4. the ladder ================================================================================
@pytest.mark.parametrize("step", activity.STEPS, ids=lambda s: s.id)
def test_each_step_holds_its_number_and_no_more(step: activity.Step) -> None:
    horizon = 8 * step.per_days
    sent = drive(step, horizon)
    counts = windows(sent, step.per_days, horizon)
    assert min(counts) >= step.mails, (step.id, sent)
    if step.id != FULL.id:
        assert max(counts) <= step.mails, (step.id, sent)


def test_no_step_is_ever_below_one_a_month() -> None:
    for step in activity.STEPS:
        assert step.mails >= 1 and step.per_days <= 30
    last = activity.step_for(10_000)
    assert last.through is None
    sent = drive(last, 400)
    assert min(windows(sent, 30, 400)) >= 1


def test_the_step_is_read_from_days_away_and_the_dial(monkeypatch: pytest.MonkeyPatch) -> None:
    learner = Learner(learner_id="L-1", days_away=20)
    assert cadence.step_of(learner).id == "two_a_week"
    assert cadence.step_of(replace(learner, days_away=None)).id == FULL.id
    dials.set_mail_ladder([30, 60, 90, 120], actor="owner", note="a gentler step-down")
    assert cadence.step_of(learner).id == FULL.id
    dials.set_mail_ladder(None, actor="owner")


def test_below_the_full_cadence_a_mail_over_the_step_is_held() -> None:
    away = Learner(
        learner_id="L-1",
        name="Learner",
        email=TEEN_ADDRESS,
        under_13=False,
        timezone=ZONE,
        last_seen=MONDAY - timedelta(days=20),
        days_away=20,
    )
    step = cadence.step_of(away)
    for back in range(1, step.mails + 1):
        sent_on(TEEN_ADDRESS, local(MONDAY, 16) - timedelta(days=2 * back))
    result = send_nudge(
        Nudge(kind="learning_note", learner=away, once_key="k", data={"angle": "waiting"}),
        now=local(MONDAY, 16),
        send=Recorder(),
    )
    assert result["error"] == "ladder"


def test_away_only_the_floor_is_planned_and_it_says_what_is_waiting() -> None:
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=40), done=6, title="Linear equations")
    plan = planned(family, local(MONDAY, 18))
    assert [n.kind for n in plan] == ["learning_note"]
    note = plan[0]
    assert note.data["angle"] == "waiting"
    assert note.data["title"] == "Linear equations"
    assert note.learner.days_away == 40


def test_coming_back_restores_the_full_cadence_at_once() -> None:
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=100), done=6)
    for back in (2, 4):  # two mails this week: more than the monthly step allows
        sent_on(PARENT, local(MONDAY, 16) - timedelta(days=back))
    assert planned(family, local(MONDAY, 16)) == []
    came(family.learner_id, MONDAY, hour=10, done=7)
    back = planned(family, local(MONDAY, 18))
    assert back and back[0].learner.days_away == 0
    assert cadence.step_of(back[0].learner).id == FULL.id


def test_a_learner_the_record_has_never_seen_is_placed_by_the_invite() -> None:
    invited = local(MONDAY, 10) - timedelta(days=45)
    family = a_family(invited_at=invited)
    plan = planned(family, local(MONDAY, 16))
    assert [n.kind for n in plan] == ["learning_note"]
    assert plan[0].learner.days_away == 45
    # And a family with no record and no invite yet is not guessed at.
    assert planned(a_family(), local(MONDAY, 16)) == []


# === 5. the extras ================================================================================
def test_come_back_mails_wait_until_the_latest_hour_they_start_has_passed() -> None:
    """Two hours past the latest hour they start, inside the hours law, or not at all: a learner
    who starts late, or whose hour is not known yet, is sent no come-back mail (2026-09-16)."""
    assert cadence.comeback_hour(17) == 17 + cadence.GRACE_HOURS
    assert cadence.comeback_hour(None) is None
    assert cadence.comeback_hour(19) is None
    assert cadence.comeback_hour(18) is None


def test_a_streak_about_to_break_earns_a_streak_mail_of_good_news() -> None:
    family = a_family()
    for back in range(9, 0, -1):
        came(family.learner_id, MONDAY - timedelta(days=back))
    at = local(MONDAY, cadence.comeback_hour(17))
    plan = planned(family, at)
    assert plan[0].kind == "streak"
    assert plan[0].data["days"] == 9
    assert "streak" not in RETURN_NUDGES
    # Earlier in the day the floor waits for it rather than taking the day's one slot.
    early = planned(family, local(MONDAY, 17))
    assert all(n.hour is None or n.hour >= cadence.comeback_hour(17) for n in early)


def test_a_streak_milestone_goes_the_morning_after() -> None:
    family = a_family()
    for back in (3, 2, 1):
        came(family.learner_id, MONDAY - timedelta(days=back))
    plan = planned(family, local(MONDAY, nudges.FIRST_HOUR))
    assert plan[0].kind == "streak" and plan[0].hour == nudges.FIRST_HOUR
    assert 3 in cadence.STREAK_MILESTONES


def test_a_chapter_nearly_done_earns_a_note_with_the_card() -> None:
    family = a_family()
    # Five days on the record, so the hour they start is known and the note can wait for it.
    for back in (5, 4, 3, 2):
        came(family.learner_id, MONDAY - timedelta(days=back), done=3, total=10)
    came(family.learner_id, MONDAY - timedelta(days=1), done=10 - cadence.NEARLY_LEFT + 1, total=10)
    plan = planned(family, local(MONDAY, 19))
    nearly = [n for n in plan if n.kind == "mid_chapter"]
    assert nearly, plan
    assert nearly[0].data["cards_left"] == cadence.NEARLY_LEFT - 1
    assert nudges.destination(nearly[0], at=local(MONDAY, 19)) is not None


def test_a_quiet_spell_earns_a_quick_one() -> None:
    family = a_family()
    for back in range(cadence.QUIET_DAYS + 4, cadence.QUIET_DAYS - 1, -1):
        came(family.learner_id, MONDAY - timedelta(days=back), done=3)
    plan = planned(family, local(MONDAY, 19))
    assert "quick_one" in [n.kind for n in plan]


def test_quiet_is_measured_against_the_learners_own_rhythm() -> None:
    """Monday, Wednesday, Friday is a rhythm, not a quiet spell: Friday to Monday is three days
    and the learner is not late."""
    family = a_family()
    friday = MONDAY - timedelta(days=3)
    for day in (
        friday - timedelta(days=7),
        friday - timedelta(days=5),
        friday - timedelta(days=3),
        friday,
    ):
        came(family.learner_id, day, done=3)
    assert cadence.quiet_after([friday - timedelta(days=3), friday]) == 4
    assert "quick_one" not in [n.kind for n in planned(family, local(MONDAY, 19))]
    assert cadence.quiet_after([]) == cadence.QUIET_DAYS
    assert cadence.quiet_after([MONDAY - timedelta(days=30), MONDAY]) == cadence.QUIET_CAP_DAYS


def test_extras_are_for_the_full_cadence_only() -> None:
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=20), done=9)
    kinds = [n.kind for n in planned(family, local(MONDAY, 19))]
    assert kinds == ["learning_note"]


def test_a_wish_day_belongs_to_the_wish(_clean: Any) -> None:
    family = a_family()
    _clean.put(family.learner_id, MailPreferences(country="IN", timezone=ZONE))
    gandhi_jayanti = date(2026, 10, 2)
    came(family.learner_id, gandhi_jayanti - timedelta(days=1), done=3)
    assert planned(family, local(gandhi_jayanti, 16)) == []
    assert planned(family, local(gandhi_jayanti + timedelta(days=1), 16))


# === 6. the good news =============================================================================
def test_what_they_cracked_comes_first() -> None:
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=1), module_finished="Triangles")
    note = planned(family, local(MONDAY, 16))[-1]
    assert note.data["angle"] == "cracked"
    assert note.data["title"] == "Triangles"


def test_then_what_comes_next() -> None:
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=1), done=4, title="Fractions")
    note = planned(family, local(MONDAY, 16))[-1]
    assert note.data["angle"] == "next"
    assert (note.data["done"], note.data["cards_left"]) == (4, 6)


def test_then_the_days_they_learned() -> None:
    family = a_family()
    for back in (4, 2):
        came(family.learner_id, MONDAY - timedelta(days=back))
    note = planned(family, local(MONDAY, 16))[-1]
    assert note.data["angle"] == "days"
    assert note.data["days"] == 2


def test_the_same_good_news_is_never_sent_twice() -> None:
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=1), module_finished="Triangles")
    send = Recorder()
    first = planned(family, local(MONDAY, 16))[-1]
    assert send_nudge(first, now=local(MONDAY, 16), send=send).get("ok")
    later = planned(family, local(MONDAY + timedelta(days=2), 16))[-1]
    assert later.data["angle"] != "cracked"


def test_every_good_news_note_encourages_learning_and_never_asks_for_more_use() -> None:
    angles = [
        {"angle": "cracked", "moment": "module_finished", "title": "Triangles"},
        {"angle": "cracked", "moment": "topic_mastered", "title": "Triangles"},
        {"angle": "next", "title": "Fractions", "done": 4, "cards_left": 6},
        {"angle": "days", "days": 4},
        {"angle": "waiting", "title": "Fractions", "cards_left": 6},
        {"angle": "waiting"},
    ]
    for audience in ("learner", "parent"):
        for facts in angles:
            for cadence_line in ("full", "away"):
                out = render(
                    "learning_note",
                    {
                        **facts,
                        "audience": audience,
                        "name": "Learner",
                        "learner_name": "Learner",
                        "cadence": cadence_line,
                    },
                )
                blob = f"{out['subject']}\n{text_of(out)}".lower()
                for never in (
                    "we miss",
                    "we noticed",
                    "miss you",
                    "come back",
                    "use wobo",
                    "use more",
                    "been a while",
                    "days away",
                    "haven't",
                    "have not been",
                    "streak will",
                    "lose",
                    "don't break",
                    "!",
                ):
                    assert never not in blob, (audience, facts, never)


# === 7. the way out ===============================================================================
def test_a_kind_stopped_by_its_own_link_is_not_sent_and_the_floor_still_is(_clean: Any) -> None:
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=cadence.QUIET_DAYS), done=3)
    _clean.stop(family.learner_id, AUDIENCES["quick_one"])
    send = Recorder()
    run_nudges(
        local(MONDAY, 19), source=cadence.CadenceNudges(jobs.InMemoryFamilies([family])), send=send
    )
    assert [s["kind"] for s in send.sent] == ["learning_note"]


def test_the_good_news_note_has_its_own_link(_clean: Any) -> None:
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=1), done=3)
    _clean.stop(family.learner_id, AUDIENCES["learning_note"])
    send = Recorder()
    run_nudges(
        local(MONDAY, 16), source=cadence.CadenceNudges(jobs.InMemoryFamilies([family])), send=send
    )
    assert all(s["kind"] != "learning_note" for s in send.sent)


def test_an_address_that_stopped_everything_hears_nothing(_clean: Any) -> None:
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=2), done=9)
    _clean.put(family.learner_id, replace(DEFAULT_PREFERENCES, unsubscribed_at=local(MONDAY, 9)))
    send = Recorder()
    for day in range(14):
        for hour in range(8, 21):
            run_nudges(
                local(MONDAY + timedelta(days=day), hour),
                source=cadence.CadenceNudges(jobs.InMemoryFamilies([family])),
                send=send,
            )
    assert send.sent == []


def test_a_learners_own_link_stops_their_own_mail_and_nobody_elses() -> None:
    """The learner's link in a win and the welcome goes to the learner's own address. It stops
    what that address is sent, and never the notes that go to a parent under thirteen
    (2026-09-16: a child's click silenced the parent). A note written to the learner's own
    address carries "Stop all of these", which is every note of theirs."""
    assert set(AUDIENCES["learner"]) == {"wins", "festivals"}
    assert not set(AUDIENCES["learner"]) & {"sunday_note", *NUDGE_KINDS}
    assert set(AUDIENCES["learner_all"]) == {"wins", "festivals", *NUDGE_KINDS}


def test_a_parent_can_stop_everything_they_get_in_one_tap() -> None:
    assert set(AUDIENCES["parent"]) >= {"sunday_note", "festivals", *NUDGE_KINDS}
    send = Recorder()
    child = Learner(
        learner_id="L-2", name="Learner", parent_email=PARENT, under_13=True, timezone=ZONE
    )
    send_nudge(
        Nudge(kind="learning_note", learner=child, once_key="k", data={"angle": "waiting"}),
        now=local(MONDAY, 16),
        send=send,
    )
    link = send.sent[0]["data"]["stop_all_url"]
    claim = parse_stop_token(link.split("token=")[1])
    assert claim is not None and claim.audience == "parent"
    html = render("learning_note", send.sent[0]["data"])["html"]
    assert "Stop all of these" in html


# === 8. the footer ================================================================================
@pytest.mark.parametrize("kind", NUDGE_KINDS)
@pytest.mark.parametrize("audience", ["learner", "parent"])
def test_the_footer_says_what_the_code_does(kind: str, audience: str) -> None:
    facts = {"audience": audience, "name": "Learner", "learner_name": "Learner", "angle": "waiting"}
    full = text_of(render(kind, {**facts, "cadence": "full"}))
    away = text_of(render(kind, {**facts, "cadence": "away"}))
    assert "three times a week" not in full and "three times a week" not in away
    assert cadence.FOOTER_FULL in full
    assert cadence.FOOTER_AWAY in away
    for said in (full, away):
        assert "pm" not in said.split("You get this")[-1].lower().split()


def test_the_footer_the_send_carries_follows_the_step() -> None:
    near = Learner(
        learner_id="L-1",
        name="Learner",
        email=TEEN_ADDRESS,
        under_13=False,
        timezone=ZONE,
        days_away=2,
    )
    far = replace(near, learner_id="L-3", email="far@example.test", days_away=50)
    send = Recorder()
    for learner in (near, far):
        send_nudge(
            Nudge(kind="learning_note", learner=learner, once_key="k", data={"angle": "waiting"}),
            now=local(MONDAY, 16),
            send=send,
        )
    assert [s["data"]["cadence"] for s in send.sent] == ["full", "away"]


# === 9. the source ================================================================================
def test_the_wired_source_reads_the_activity_record_and_the_links(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=1), done=3)
    monkeypatch.setattr(jobs, "PostgrestFamilies", lambda: jobs.InMemoryFamilies([family]))
    send = Recorder()
    report = run_nudges(local(MONDAY, 16), send=send)
    assert report["sent"] == 1
    assert send.sent[0]["kind"] == "learning_note" and send.sent[0]["to"] == PARENT


def test_a_record_that_cannot_be_read_plans_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    class Down(activity.InMemoryActivityStore):
        def many(self, subjects: Any) -> dict[str, activity.Summary]:
            raise activity.StoreUnavailable("down")

    activity.set_store(Down())
    family = a_family(invited_at=local(MONDAY, 10) - timedelta(days=3))
    assert (
        list(cadence.CadenceNudges(jobs.InMemoryFamilies([family])).due(at=local(MONDAY, 16))) == []
    )


def test_a_teenager_with_an_address_is_written_to_and_the_parent_is_not() -> None:
    family = a_family(under_13=False, learner_email=TEEN_ADDRESS)
    came(family.learner_id, MONDAY - timedelta(days=1), done=3)
    send = Recorder()
    run_nudges(
        local(MONDAY, 16), source=cadence.CadenceNudges(jobs.InMemoryFamilies([family])), send=send
    )
    assert [s["to"] for s in send.sent] == [TEEN_ADDRESS]
