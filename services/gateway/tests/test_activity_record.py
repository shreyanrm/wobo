"""The activity record (wave 56): when each learner last came, what they did, and nothing else.

The owner: *"make sure you have a record of application activity and stuff"*. The cadence in
docs/EMAILS-AND-ANIMATIONS.md stands on it: a floor of three a week, a step-down with time away
that never falls below one a month, and "a come-back mail never goes on a day the learner came".
None of that can be true while ``learner.meter_state`` is written by nothing and the mail reads
thirty days back, so a learner gone forty-five days looked exactly like one who never came.

What is proved here, every one with the clock handed in:

1. **The fold** — one pure function decides what an event does to a learner's record, in the
   learner's own time zone: the day, the streak, the hour they usually come, the moments a mail
   speaks about, where they are in the chapter.
2. **Last seen, ever** — the record answers "when did they last come" with no horizon, for one
   learner or a batch, in one read.
3. **The ladder** — the step a learner sits on, by days away, never below one a month.
4. **The door** — ``POST /v1/me/activity``: the learner's own sessions and learning moments,
   keyed on the verified subject, free, bounded, anonymous never.
5. **The turn marks the day** — the server records a signed-in learner's turn itself, off the
   request thread, at most once per ten minutes.
6. **The project store** — one RPC per event, one read per batch, no filter a subject can inject.
7. **The console** — counts behind the mail panel; one learner's four facts behind the learner
   panel, audited, and never a title, a moment or an hour.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from wobo_gateway import activity, admin_auth, dials
from wobo_gateway.admin_auth import ADMIN_PREFIX, OPERATOR, VIEWER, InMemoryAdminStore

KOLKATA = "Asia/Kolkata"
# Mon 2026-09-21, 12:15 UTC = 17:45 in Kolkata: the hour the learner usually comes.
MONDAY = datetime(2026, 9, 21, 12, 15, tzinfo=UTC)
SUBJECT = "5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER = "5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def ev(kind: str, at: datetime, **kw: Any) -> activity.Event:
    return activity.Event(kind=kind, at=at, zone=kw.pop("zone", KOLKATA), **kw)


def folded(*events: activity.Event) -> activity.Summary:
    """Events through the in-memory store, which decides new-day and new-session the way the
    project's function does (a day row that was not there before)."""
    store = activity.InMemoryActivityStore()
    out: activity.Summary | None = None
    for event in events:
        out = store.note(SUBJECT, event)
    assert out is not None
    return out


@pytest.fixture(autouse=True)
def _fresh(monkeypatch: pytest.MonkeyPatch) -> Any:
    store = activity.InMemoryActivityStore()
    activity.set_store(store)
    activity.set_clock(None)
    activity.reset()
    yield store
    activity.set_store(None)
    activity.set_clock(None)
    activity.reset()


# --- 1. the fold ----------------------------------------------------------------------------------
def test_the_first_visit_is_dated_in_the_learners_own_zone() -> None:
    """20:00 UTC on Monday is 01:30 on Tuesday in Kolkata. The learner's day is Tuesday."""
    late = datetime(2026, 9, 21, 20, 0, tzinfo=UTC)
    got = folded(ev("session_start", late, session=str(uuid.uuid4())))
    assert got.first_came_on == date(2026, 9, 22)
    assert got.last_came_on == date(2026, 9, 22)
    assert got.last_came_at == late
    assert got.days_active == 1 and got.streak_days == 1 and got.streak_best == 1
    assert got.hours == {"1": 1}
    assert got.timezone == KOLKATA


def test_days_in_a_row_make_a_streak_and_a_gap_starts_a_new_one() -> None:
    days = [MONDAY + timedelta(days=n) for n in (0, 1, 2, 4, 5)]
    got = folded(*(ev("turn", d) for d in days))
    assert got.days_active == 5
    assert got.streak_days == 2, "Friday and Saturday, after Thursday was missed"
    assert got.streak_best == 3
    assert got.last_came_on == date(2026, 9, 26)


def test_twice_on_one_day_is_one_day_and_one_hour() -> None:
    got = folded(ev("turn", MONDAY), ev("turn", MONDAY + timedelta(hours=2)))
    assert got.days_active == 1 and got.streak_days == 1
    assert got.hours == {"17": 1}, "the hour they usually START is counted once a day"
    assert got.last_came_at == MONDAY + timedelta(hours=2)


def test_an_event_that_arrives_late_never_moves_the_last_day_back() -> None:
    """A queued offline event from last week lands today. It is a day they came, but it is not
    today, and it must not break today's streak or rewind the last visit."""
    store = activity.InMemoryActivityStore()
    store.note(SUBJECT, ev("turn", MONDAY + timedelta(days=5)))
    got = store.note(SUBJECT, ev("module_finished", MONDAY, ref="t1", title="Fractions"))
    assert got.last_came_on == date(2026, 9, 26)
    assert got.last_came_at == MONDAY + timedelta(days=5)
    assert got.days_active == 2
    assert got.streak_days == 1


def test_opening_the_app_is_coming_and_learning_is_learning() -> None:
    store = activity.InMemoryActivityStore()
    got = store.note(SUBJECT, ev("session_start", MONDAY, session=str(uuid.uuid4())))
    assert got.last_learned_on is None
    (day,) = store.days(SUBJECT, since=date(2026, 9, 1))
    assert day.units == 0 and day.win is False
    got = store.note(SUBJECT, ev("progress", MONDAY, ref="t1", title="Fractions", done=3, total=9))
    assert got.last_learned_on == date(2026, 9, 21)
    got = store.note(SUBJECT, ev("module_finished", MONDAY, ref="t1", title="Fractions"))
    (day,) = store.days(SUBJECT, since=date(2026, 9, 1))
    assert day.units == 2 and day.win is True


def test_moments_are_newest_first_bounded_and_never_doubled() -> None:
    events = [
        ev("topic_mastered", MONDAY + timedelta(minutes=n), ref=f"t{n}", title=f"Topic {n}")
        for n in range(15)
    ]
    events.append(ev("topic_mastered", MONDAY + timedelta(minutes=30), ref="t14", title="Again"))
    got = folded(*events)
    assert len(got.moments) == activity.MAX_MOMENTS
    assert got.moments[0].ref == "t14" and got.moments[0].title == "Again"
    assert [m.ref for m in got.moments].count("t14") == 1
    assert got.moments[1].ref == "t13"


def test_where_they_are_in_the_chapter_is_kept_until_the_chapter_is_done() -> None:
    at = MONDAY
    got = folded(ev("progress", at, ref="t1", title="Linear equations", done=7, total=9))
    assert got.progress is not None
    assert (got.progress.ref, got.progress.done, got.progress.total) == ("t1", 7, 9)
    assert got.progress.title == "Linear equations"

    store = activity.InMemoryActivityStore()
    store.note(SUBJECT, ev("progress", at, ref="t1", title="Linear equations", done=7, total=9))
    # an older report never overwrites a newer one
    older = store.note(SUBJECT, ev("progress", at - timedelta(hours=1), ref="t1", done=2, total=9))
    assert older.progress is not None and older.progress.done == 7
    # finishing a different module leaves this chapter where it is
    other = store.note(SUBJECT, ev("module_finished", at, ref="t2", title="Motion"))
    assert other.progress is not None and other.progress.ref == "t1"
    # finishing this one clears it: there are no cards left to mention
    done = store.note(SUBJECT, ev("module_finished", at, ref="t1", title="Linear equations"))
    assert done.progress is None


def test_progress_is_clamped_and_a_chapter_with_no_cards_is_not_progress() -> None:
    got = folded(ev("progress", MONDAY, ref="t1", title="X", done=40, total=9))
    assert got.progress is not None and got.progress.done == 9
    got = folded(ev("progress", MONDAY, ref="t1", title="X", done=0, total=0))
    assert got.progress is None


def test_the_usual_hour_follows_a_routine_and_follows_it_when_it_changes() -> None:
    evenings = [ev("turn", MONDAY + timedelta(days=n)) for n in range(40)]
    got = folded(*evenings)
    assert got.usual_hour() == 17
    # then forty mornings (07:45 Kolkata = 02:15 UTC): the old habit decays and the new one wins
    mornings = [
        ev("turn", datetime(2026, 11, 1, 2, 15, tzinfo=UTC) + timedelta(days=n)) for n in range(40)
    ]
    got = folded(*evenings, *mornings)
    assert got.usual_hour() == 7
    assert sum(got.hours.values()) <= activity.HOURS_CEILING


def test_the_usual_hour_is_not_guessed_from_two_days() -> None:
    got = folded(ev("turn", MONDAY), ev("turn", MONDAY + timedelta(days=1)))
    assert got.usual_hour() is None


def test_a_zone_that_is_not_a_zone_is_utc() -> None:
    got = folded(ev("turn", MONDAY, zone="Mars/Olympus"))
    assert got.timezone == "UTC"
    assert got.hours == {"12": 1}


# --- 2. last seen, ever ---------------------------------------------------------------------------
def test_a_learner_gone_forty_five_days_is_not_a_learner_who_never_came(
    _fresh: activity.InMemoryActivityStore,
) -> None:
    _fresh.note(SUBJECT, ev("turn", MONDAY))
    later = MONDAY + timedelta(days=45)
    held = _fresh.get(SUBJECT)
    assert held is not None
    assert held.days_away(later) == 45
    assert _fresh.get(OTHER) is None


def test_a_learner_gone_six_months_still_has_a_last_day() -> None:
    store = activity.InMemoryActivityStore()
    store.note(SUBJECT, ev("turn", MONDAY))
    far = MONDAY + timedelta(days=190)
    held = store.get(SUBJECT)
    assert held is not None and held.days_away(far) == 190
    assert activity.step_for(held.days_away(far)).id == "one_a_month"


def test_days_away_is_counted_on_the_learners_own_calendar() -> None:
    """23:00 UTC on the Monday is already Tuesday in Kolkata: that learner came 'today'."""
    store = activity.InMemoryActivityStore()
    store.note(SUBJECT, ev("turn", MONDAY))
    held = store.get(SUBJECT)
    assert held is not None
    assert held.days_away(datetime(2026, 9, 21, 18, 0, tzinfo=UTC)) == 0
    assert held.days_away(datetime(2026, 9, 21, 19, 0, tzinfo=UTC)) == 1
    assert held.came_today(datetime(2026, 9, 21, 18, 0, tzinfo=UTC)) is True
    assert held.came_today(datetime(2026, 9, 21, 19, 0, tzinfo=UTC)) is False


def test_a_whole_batch_of_families_is_one_read(_fresh: activity.InMemoryActivityStore) -> None:
    _fresh.note(SUBJECT, ev("turn", MONDAY))
    _fresh.note(OTHER, ev("turn", MONDAY - timedelta(days=100)))
    got = _fresh.many([SUBJECT, OTHER, "5ccccccc-cccc-4ccc-8ccc-cccccccccccc"])
    assert set(got) == {SUBJECT, OTHER}
    assert got[OTHER].days_away(MONDAY) == 100


# --- 3. the ladder --------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("away", "step"),
    [
        (0, "full"),
        (14, "full"),
        (15, "two_a_week"),
        (30, "two_a_week"),
        (31, "one_a_week"),
        (60, "one_a_week"),
        (61, "one_a_fortnight"),
        (90, "one_a_fortnight"),
        (91, "one_a_month"),
        (4000, "one_a_month"),
    ],
)
def test_the_step_by_days_away_is_the_owners_ladder(away: int, step: str) -> None:
    assert activity.step_for(away).id == step


def test_no_step_is_below_once_a_month() -> None:
    """The owner: 'once a month, and that is bare minimum'. The last step never ends."""
    for step in activity.STEPS:
        assert step.mails >= 1
        assert step.per_days <= 30
    assert activity.STEPS[0].mails >= 3 and activity.STEPS[0].per_days == 7
    assert activity.STEPS[-1].through is None


def test_the_ladder_is_one_dial(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dials, "value", lambda key, default=None: [7, 21, 45, 75])
    assert activity.ladder() == ((7, 21, 45, 75), "dial")
    assert activity.step_for(8).id == "two_a_week"
    assert activity.step_for(76).id == "one_a_month"


@pytest.mark.parametrize(
    "bad",
    [
        [30, 14, 60, 90],
        [14, 30, 60],
        [0, 30, 60, 90],
        [14, 30, 60, "90"],
        "14,30",
        None,
        [14, 14, 60, 90],
    ],
)
def test_a_dial_that_is_not_a_ladder_is_ignored(monkeypatch: pytest.MonkeyPatch, bad: Any) -> None:
    monkeypatch.setattr(dials, "value", lambda key, default=None: bad)
    assert activity.ladder() == (activity.LADDER_BOUNDS, "default")


def test_the_ladder_dial_is_written_only_as_a_ladder() -> None:
    """The owner turns the step-down in one place. A ladder out of order, too short, or past a
    year is refused at the write; clearing it puts the owner's own default back."""
    for bad in ([30, 14, 60, 90], [14, 30, 60], [14, 30, 60, 400], [0, 30, 60, 90]):
        with pytest.raises(dials.BadDial):
            dials.set_mail_ladder(bad, actor="owner")
    dials.set_mail_ladder([10, 20, 40, 80], actor="owner", note="a gentler step-down")
    assert activity.ladder() == ((10, 20, 40, 80), "dial")
    assert activity.step_for(21).id == "one_a_week"
    dials.set_mail_ladder(None, actor="owner")
    assert activity.ladder() == (activity.LADDER_BOUNDS, "default")


# --- 4. the door ----------------------------------------------------------------------------------
@pytest.fixture
def client() -> TestClient:
    from wobo_gateway.app import create_app

    return TestClient(create_app())


def _post(client: TestClient, headers: dict[str, str], **body: Any) -> Any:
    return client.post("/v1/me/activity", json=body, headers=headers)


def test_recording_activity_needs_a_verified_learner(client: TestClient) -> None:
    assert client.post("/v1/me/activity", json={"kind": "session_start"}).status_code == 401


def test_a_session_is_opened_and_closed_by_the_learner_it_belongs_to(
    client: TestClient, auth, _fresh: activity.InMemoryActivityStore
) -> None:
    session = str(uuid.uuid4())
    opened = _post(client, auth(SUBJECT), kind="session_start", session=session, surface="pwa")
    assert opened.status_code == 204, opened.text
    # a retry of the same start is the same session, not a second one
    _post(client, auth(SUBJECT), kind="session_start", session=session, surface="pwa")
    # somebody else cannot close it
    _post(client, auth(OTHER), kind="session_end", session=session)
    (row,) = _fresh.sessions(SUBJECT)
    assert row.ended_at is None and row.surface == "pwa"
    closed = _post(client, auth(SUBJECT), kind="session_end", session=session)
    assert closed.status_code == 204
    (row,) = _fresh.sessions(SUBJECT)
    assert row.ended_at is not None and row.ended_at >= row.started_at
    held = _fresh.get(SUBJECT)
    assert held is not None and held.sessions == 1


def test_the_zone_comes_from_the_device_header(
    client: TestClient, auth, _fresh: activity.InMemoryActivityStore
) -> None:
    _post(
        client,
        {**auth(SUBJECT), "x-wobo-timezone": KOLKATA},
        kind="session_start",
        session=str(uuid.uuid4()),
    )
    held = _fresh.get(SUBJECT)
    assert held is not None and held.timezone == KOLKATA


def test_a_learning_moment_is_recorded_with_its_name_bounded(
    client: TestClient, auth, _fresh: activity.InMemoryActivityStore
) -> None:
    res = _post(client, auth(SUBJECT), kind="topic_mastered", ref="t-frac", title="Fractions " * 40)
    assert res.status_code == 204
    held = _fresh.get(SUBJECT)
    assert held is not None
    assert held.moments[0].ref == "t-frac"
    assert len(held.moments[0].title) <= activity.TITLE_MAX


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "turn"},  # the server records turns itself; a client cannot claim them
        {"kind": "binge"},
        {"kind": "session_start", "session": "not-a-uuid"},
        {"kind": "session_start"},
        {"kind": "session_start", "session": str(uuid.uuid4()), "surface": "smartwatch"},
        {"kind": "progress", "ref": "t1", "done": -1, "total": 9},
        {"kind": "progress", "ref": "t1", "done": 1, "total": 100000},
        {"kind": "module_finished"},
        {"kind": "module_finished", "ref": "t1", "subject": OTHER},
        {"kind": "module_finished", "ref": "t1", "at": "2020-01-01T00:00:00Z"},
    ],
)
def test_what_the_door_refuses(client: TestClient, auth, body: dict[str, Any]) -> None:
    assert client.post("/v1/me/activity", json=body, headers=auth(SUBJECT)).status_code == 422


def test_an_anonymous_visitor_leaves_no_record(
    client: TestClient, auth, _fresh: activity.InMemoryActivityStore
) -> None:
    res = _post(
        client, auth(SUBJECT, anonymous=True), kind="session_start", session=str(uuid.uuid4())
    )
    assert res.status_code == 204
    assert _fresh.get(SUBJECT) is None


def test_recording_activity_never_costs_a_turn(client: TestClient, auth) -> None:
    before = client.get("/v1/me", headers=auth(SUBJECT)).json()["budget"]["turns_remaining"]
    for _ in range(5):
        _post(client, auth(SUBJECT), kind="session_start", session=str(uuid.uuid4()))
    after = client.get("/v1/me", headers=auth(SUBJECT)).json()["budget"]["turns_remaining"]
    assert after == before


def test_a_store_that_cannot_answer_is_a_503_not_a_pretence(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Down(activity.InMemoryActivityStore):
        def note(self, subject: str, event: activity.Event) -> activity.Summary:
            raise activity.StoreUnavailable("down")

    activity.set_store(Down())
    res = _post(client, auth(SUBJECT), kind="module_finished", ref="t1", title="Fractions")
    assert res.status_code == 503
    assert "supabase" not in res.text.lower()


# --- 5. the turn marks the day --------------------------------------------------------------------
SSE = {"Accept": "text/event-stream"}
TURN = {"payload": {"context": {"turn": {"lastUserInput": "what is a fraction"}}}}


def test_a_signed_in_turn_marks_the_day_at_most_once_in_ten_minutes(
    client: TestClient, auth, _fresh: activity.InMemoryActivityStore
) -> None:
    now = {"at": MONDAY}
    activity.set_clock(lambda: now["at"])
    headers = {**auth(SUBJECT), **SSE, "x-wobo-timezone": KOLKATA}
    assert client.post("/v1/capability/wobo.turn", json=TURN, headers=headers).status_code == 200
    held = _fresh.get(SUBJECT)
    assert held is not None and held.last_came_at == MONDAY and held.timezone == KOLKATA
    now["at"] = MONDAY + timedelta(minutes=9)
    client.post("/v1/capability/wobo.turn", json=TURN, headers=headers)
    (day,) = _fresh.days(SUBJECT, since=date(2026, 9, 1))
    assert day.units == 1, "a second turn inside ten minutes is the same stretch of learning"
    now["at"] = MONDAY + timedelta(minutes=11)
    client.post("/v1/capability/wobo.turn", json=TURN, headers=headers)
    (day,) = _fresh.days(SUBJECT, since=date(2026, 9, 1))
    assert day.units == 2


def test_an_anonymous_turn_is_not_recorded(
    client: TestClient, auth, _fresh: activity.InMemoryActivityStore
) -> None:
    client.post(
        "/v1/capability/wobo.turn", json=TURN, headers={**auth(SUBJECT, anonymous=True), **SSE}
    )
    assert _fresh.get(SUBJECT) is None


def test_a_record_that_fails_never_fails_the_turn(client: TestClient, auth) -> None:
    class Down(activity.InMemoryActivityStore):
        def note(self, subject: str, event: activity.Event) -> activity.Summary:
            raise RuntimeError("the store fell over")

    activity.set_store(Down())
    res = client.post("/v1/capability/wobo.turn", json=TURN, headers={**auth(SUBJECT), **SSE})
    assert res.status_code == 200


def test_the_old_rows_expire_once_a_day_on_the_way_past(
    _fresh: activity.InMemoryActivityStore,
) -> None:
    old = MONDAY - timedelta(days=activity.DAY_KEEP_DAYS + 5)
    _fresh.note(SUBJECT, ev("session_start", old, session=str(uuid.uuid4())))
    _fresh.note(
        SUBJECT, ev("session_start", MONDAY - timedelta(days=100), session=str(uuid.uuid4()))
    )
    now = {"at": MONDAY}
    activity.set_clock(lambda: now["at"])
    assert activity.note_turn(SUBJECT, anonymous=False, zone=KOLKATA) is True
    days = _fresh.days(SUBJECT, since=date(2020, 1, 1))
    assert [d.day for d in days] == [date(2026, 6, 13), date(2026, 9, 21)]
    assert len(_fresh.sessions(SUBJECT)) == 0, "sessions are kept ninety days"
    # the summary row is the learner's for the life of the account, and says when they first came
    held = _fresh.get(SUBJECT)
    assert held is not None
    assert held.first_came_on == date(2025, 8, 12)
    assert held.days_active == 3 and held.sessions == 2


# --- 6. the project store -------------------------------------------------------------------------
class Wire:
    """The PostgREST seam, recorded. Nothing here reaches a network."""

    def __init__(self, answer: Any = None, *, fail: bool = False) -> None:
        self.calls: list[tuple[str, str, Any]] = []
        self.answer = answer
        self.fail = fail

    def __call__(self, url: str, key: str, method: str, *, body: Any = None) -> Any:
        self.calls.append((method, url, body))
        if self.fail:
            raise OSError("the project is not answering")
        return self.answer


ROW = {
    "subject_id": SUBJECT,
    "first_came_on": "2026-09-01",
    "last_came_at": "2026-09-21T12:15:00+00:00",
    "last_came_on": "2026-09-21",
    "timezone": KOLKATA,
    "days_active": 9,
    "streak_days": 4,
    "streak_best": 6,
    "hours": {"17": 9},
    "last_learned_on": "2026-09-21",
    "moments": [
        {
            "kind": "topic_mastered",
            "ref": "t1",
            "title": "Fractions",
            "at": "2026-09-21T12:15:00+00:00",
        }
    ],
    "progress": {
        "ref": "t2",
        "title": "Decimals",
        "done": 2,
        "total": 9,
        "at": "2026-09-21T12:15:00+00:00",
    },
    "sessions": 11,
}


@pytest.fixture
def project(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("SUPABASE_URL", "https://project.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-not-a-real-one")

    def install(wire: Wire) -> activity.PostgrestActivityStore:
        monkeypatch.setattr(activity, "_request", wire)
        return activity.PostgrestActivityStore("https://project.example", "k")

    return install


def test_an_event_is_one_call_to_the_projects_own_function(project: Any) -> None:
    wire = Wire(ROW)
    store = project(wire)
    session = str(uuid.uuid4())
    got = store.note(SUBJECT, ev("session_start", MONDAY, session=session, surface="pwa"))
    (call,) = wire.calls
    method, url, body = call
    assert method == "POST" and url == "https://project.example/rest/v1/rpc/note_activity"
    assert body == {
        "p_subject": SUBJECT,
        "p_kind": "session_start",
        "p_at": "2026-09-21T12:15:00+00:00",
        "p_zone": KOLKATA,
        "p_ref": None,
        "p_title": None,
        "p_done": None,
        "p_total": None,
        "p_session": session,
        "p_surface": "pwa",
    }
    assert got.streak_days == 4 and got.moments[0].title == "Fractions"
    assert got.progress is not None and got.progress.done == 2
    assert got.last_came_on == date(2026, 9, 21)


def test_a_batch_is_one_read_with_no_horizon(project: Any) -> None:
    wire = Wire([ROW])
    store = project(wire)
    got = store.many([SUBJECT, OTHER])
    (call,) = wire.calls
    method, url, _ = call
    assert method == "GET"
    assert url.startswith("https://project.example/rest/v1/activity?")
    assert f"subject_id=in.%28{SUBJECT}%2C{OTHER}%29" in url
    # no date filter and no thirty-row limit: last seen is ever
    assert "date=" not in url and "limit=31" not in url and "gte" not in url
    assert set(got) == {SUBJECT}


def test_the_days_of_a_month_are_read_from_the_day_rows(project: Any) -> None:
    wire = Wire([{"date": "2026-09-20", "budget_consumed": 0, "day_had_real_win": False}])
    store = project(wire)
    (day,) = store.days(SUBJECT, since=date(2026, 9, 1))
    ((_, url, _),) = wire.calls
    assert "/rest/v1/meter_state?" in url and "date=gte.2026-09-01" in url
    assert f"subject_id=eq.{SUBJECT}" in url
    assert day.day == date(2026, 9, 20) and day.units == 0


def test_the_census_is_counted_in_the_project(project: Any) -> None:
    wire = Wire({"learners": 5, "today": 1, "week": 2, "month": 3, "steps": {"0": 3, "4": 2}})
    store = project(wire)
    got = store.census(MONDAY, (14, 30, 60, 90))
    ((method, url, body),) = wire.calls
    assert (method, url) == ("POST", "https://project.example/rest/v1/rpc/activity_census")
    assert body == {"p_bounds": [14, 30, 60, 90]}
    assert got.learners == 5 and got.steps == (3, 0, 0, 0, 2)


def test_a_subject_that_is_not_an_account_id_never_reaches_a_filter(project: Any) -> None:
    wire = Wire(ROW)
    store = project(wire)
    assert store.note("x); drop table", ev("turn", MONDAY)) is None
    assert store.get("learner-under-test") is None
    assert store.many(["a,b", SUBJECT + ")"]) == {}
    assert wire.calls == []


def test_an_unreachable_project_is_named_as_unavailable(project: Any) -> None:
    store = project(Wire(fail=True))
    with pytest.raises(activity.StoreUnavailable):
        store.note(SUBJECT, ev("turn", MONDAY))
    with pytest.raises(activity.StoreUnavailable):
        store.census(MONDAY, (14, 30, 60, 90))


def test_the_project_is_chosen_when_one_is_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ACTIVITY_STORE", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://project.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-not-a-real-one")
    assert isinstance(activity.build_store(), activity.PostgrestActivityStore)
    monkeypatch.setenv("ACTIVITY_STORE", "memory")
    assert isinstance(activity.build_store(), activity.InMemoryActivityStore)


# --- 7. the console -------------------------------------------------------------------------------
ADMIN_SUBJECT = "51111111-1111-4111-8111-111111111111"


@pytest.fixture
def admins(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.delenv("ENV", raising=False)
    store = InMemoryAdminStore()
    admin_auth.set_store(store)
    admin_auth.reset_limiter()
    yield store
    admin_auth.set_store(None)


def _bearer(subject: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET)}"}


def _console(client: TestClient, store: InMemoryAdminStore, role: str) -> dict[str, str]:
    store.upsert_admin(
        subject_id=ADMIN_SUBJECT,
        email="ops@example.com",
        role=role,
        granted_by=None,
        mfa_required=False,
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(ADMIN_SUBJECT))
    assert opened.status_code == 200, opened.text
    return {**_bearer(ADMIN_SUBJECT), admin_auth.SESSION_HEADER: opened.json()["session_token"]}


def _seed(store: activity.InMemoryActivityStore, now: datetime) -> None:
    """Five families, one on every step, the way the measurement drew them."""
    for n, away in enumerate((0, 3, 20, 45, 200)):
        subject = f"5ddddddd-dddd-4ddd-8ddd-{n:012d}"
        store.note(subject, ev("turn", now - timedelta(days=away)))


def test_the_activity_desk_counts_and_names_nobody(
    client: TestClient, admins: InMemoryAdminStore, _fresh: activity.InMemoryActivityStore
) -> None:
    now = datetime.now(UTC)
    _seed(_fresh, now)
    res = client.get(f"{ADMIN_PREFIX}/activity", headers=_console(client, admins, VIEWER))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["readable"] is True
    assert body["census"] == {"learners": 5, "today": 1, "week": 2, "month": 3}
    steps = {step["id"]: step["learners"] for step in body["ladder"]["steps"]}
    assert steps == {
        "full": 2,
        "two_a_week": 1,
        "one_a_week": 1,
        "one_a_fortnight": 0,
        "one_a_month": 1,
    }
    assert body["ladder"]["bounds"] == [14, 30, 60, 90]
    assert body["ladder"]["source"] == "default"
    text = res.text
    assert "5ddddddd" not in text
    assert any(row.get("action") == "console.activity.read" for row in admins.audit)


def test_an_unreadable_record_is_not_a_quiet_platform(
    client: TestClient, admins: InMemoryAdminStore
) -> None:
    class Down(activity.InMemoryActivityStore):
        def census(self, now: datetime, bounds: tuple[int, ...]) -> activity.Census:
            raise activity.StoreUnavailable("down")

    activity.set_store(Down())
    body = client.get(f"{ADMIN_PREFIX}/activity", headers=_console(client, admins, VIEWER)).json()
    assert body["readable"] is False
    assert body["census"] is None
    assert all(step["learners"] is None for step in body["ladder"]["steps"])


def test_a_signed_in_learner_reads_no_desk(client: TestClient, admins: InMemoryAdminStore) -> None:
    for path in ("/activity", f"/learners/activity?id={SUBJECT}"):
        res = client.get(f"{ADMIN_PREFIX}{path}", headers=_bearer(SUBJECT))
        assert res.status_code in (401, 403, 404)
        assert "census" not in res.text and "streak" not in res.text


def test_one_learners_page_is_four_facts_for_an_operator_and_is_audited(
    client: TestClient, admins: InMemoryAdminStore, _fresh: activity.InMemoryActivityStore
) -> None:
    now = datetime.now(UTC)
    for away in (40, 3, 2, 1, 0):
        _fresh.note(
            SUBJECT,
            ev("topic_mastered", now - timedelta(days=away), ref=f"t{away}", title="Secret title"),
        )
    _fresh.note(SUBJECT, ev("progress", now, ref="t9", title="Secret chapter", done=2, total=9))
    headers = _console(client, admins, OPERATOR)
    res = client.get(f"{ADMIN_PREFIX}/learners/activity", params={"id": SUBJECT}, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["found"] is True
    assert body["learner_id"] == SUBJECT
    assert body["days_away"] == 0
    assert body["streak_days"] == 4
    assert body["step"]["id"] == "full"
    local_today = now.astimezone(ZoneInfo(KOLKATA)).date()
    this_month = {
        (now - timedelta(days=away)).astimezone(ZoneInfo(KOLKATA)).date()
        for away in (40, 3, 2, 1, 0)
    }
    expected = sum(
        1 for d in this_month if (d.year, d.month) == (local_today.year, local_today.month)
    )
    assert body["days_active_this_month"] == expected
    assert body["last_came_at"]
    # the record is for teaching and for the learner's own mail: the console sees none of it
    for private in ("Secret", "moments", "progress", "hours", "title", "ref"):
        assert private not in res.text, private
    audited = [row for row in admins.audit if row.get("action") == "console.learner.activity"]
    assert audited and audited[-1].get("resource_id") == SUBJECT


def test_a_learner_with_no_record_is_said_to_have_none(
    client: TestClient, admins: InMemoryAdminStore
) -> None:
    headers = _console(client, admins, OPERATOR)
    body = client.get(
        f"{ADMIN_PREFIX}/learners/activity", params={"id": OTHER}, headers=headers
    ).json()
    assert body == {"found": False, "learner_id": OTHER}


def test_a_viewer_cannot_open_one_learners_page(
    client: TestClient, admins: InMemoryAdminStore, _fresh: activity.InMemoryActivityStore
) -> None:
    _fresh.note(SUBJECT, ev("turn", datetime.now(UTC)))
    headers = _console(client, admins, VIEWER)
    res = client.get(f"{ADMIN_PREFIX}/learners/activity", params={"id": SUBJECT}, headers=headers)
    assert res.status_code == 403
    assert "streak" not in res.text


def test_an_id_that_is_not_an_account_is_refused_before_any_read(
    client: TestClient, admins: InMemoryAdminStore
) -> None:
    headers = _console(client, admins, OPERATOR)
    res = client.get(
        f"{ADMIN_PREFIX}/learners/activity", params={"id": "x) or 1=1"}, headers=headers
    )
    assert res.status_code == 422


def test_the_desks_belong_to_the_mail_and_learner_panels() -> None:
    from wobo_gateway import console_panels

    assert console_panels.capability_for(f"{ADMIN_PREFIX}/activity", "GET") == "panel.mail.read"
    assert (
        console_panels.capability_for(f"{ADMIN_PREFIX}/learners/activity", "GET")
        == "panel.learner.read"
    )


def test_nothing_in_the_record_is_an_advertising_or_tracking_field() -> None:
    """DPDP s.9(3): the record exists to teach and to write the learner's own mail. No column
    for a campaign, a device fingerprint, an address, an open or a click."""
    names = set(activity.Summary.__dataclass_fields__) | set(json.loads(json.dumps(ROW)))
    for banned in ("utm", "campaign", "open", "click", "ip", "device", "email", "address", "ad_"):
        assert not any(banned in name for name in names if name != "sessions"), banned
