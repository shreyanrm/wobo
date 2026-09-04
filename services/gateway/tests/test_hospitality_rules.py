"""The festival rule engine, table-driven (WOBO-PLAN §14.1 hyperlocal, §20 neutral).

Every case is a learner, a day (or a year), and the exact wishes that may reach them. The real
calendar file drives the locality cases — a learner in Telangana with no calendar chosen, a
learner in Nairobi, a family that chose one calendar — and a tiny synthetic calendar drives the
edges the file happens not to exercise (ranking, a missing file, a suppressed entry).
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from wobo_gateway.hospitality import festivals as fest
from wobo_gateway.hospitality.festivals import Calendar, load_calendar
from wobo_gateway.hospitality.preferences import MailPreferences

CALENDAR_FILE = Path(__file__).resolve().parents[3] / "content/hospitality/festivals.json"
IST = ZoneInfo("Asia/Kolkata")


@pytest.fixture(scope="module")
def calendar() -> Calendar:
    return load_calendar(CALENDAR_FILE)


@pytest.fixture(autouse=True)
def _no_quiet_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MAIL_QUIET_HOURS", raising=False)
    fest.set_calendar(None)


def year_of(
    cal: Calendar, prefs: MailPreferences, year: int = 2026, **kw: Any
) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    day = date(year, 1, 1)
    while day.year == year:
        wish = cal.wish_for(prefs, day, **kw)
        if wish is not None:
            out.append((day.isoformat(), wish.festival_id))
        day += timedelta(days=1)
    return out


NATIONAL_IN_2026 = [
    ("2026-01-01", "new-year-gregorian"),
    ("2026-01-26", "republic-day-india"),
    ("2026-08-15", "independence-day-india"),
    ("2026-10-02", "gandhi-jayanti"),
]

HINDU_IN_2026 = {
    "makar-sankranti",
    "maha-shivratri",
    "holika-dahan",
    "holi",
    "chaitra-sukladi",
    "ram-navami",
    "raksha-bandhan",
    "janmashtami",
    "diwali",
    "bhai-dooj",
}


# --- the three cases the brief names ------------------------------------------------------------


def test_telangana_with_no_calendar_gets_republic_day_and_the_new_year_and_nothing_religious(
    calendar: Calendar,
) -> None:
    prefs = MailPreferences(country="IN", region="IN-TG")
    got = year_of(calendar, prefs)
    assert got == NATIONAL_IN_2026
    kinds = {calendar.festivals[fid].kind for _, fid in got}
    assert kinds == {"civic", "seasonal"}
    # Ugadi is Telangana's own new year and it is tagged to Telangana — and it is still not sent,
    # because it is religious and nobody chose it. A region is not a permission.
    assert ("2026-03-19", "chaitra-sukladi") not in got


def test_a_learner_in_nairobi_gets_nothing_indian(calendar: Calendar) -> None:
    prefs = MailPreferences(country="KE", festival_calendar=("hindu", "muslim", "christian"))
    assert year_of(calendar, prefs) == []


def test_a_family_that_chose_a_calendar_gets_exactly_that_calendars_days(
    calendar: Calendar,
) -> None:
    prefs = MailPreferences(country="IN", region="IN-TG", festival_calendar=("hindu",))
    got = year_of(calendar, prefs)
    religious = [(d, fid) for d, fid in got if calendar.festivals[fid].kind == "religious"]
    assert {fid for _, fid in religious} == HINDU_IN_2026
    for _, fid in religious:
        assert "hindu" in calendar.festivals[fid].calendars
        assert calendar.festivals[fid].tradition in {"hindu"}
    # and the national days still come, unchanged
    assert [row for row in got if row in NATIONAL_IN_2026] == NATIONAL_IN_2026
    # the chosen calendar is recorded on the wish, so the log can say why it went
    diwali = calendar.wish_for(prefs, date(2026, 11, 8))
    assert diwali is not None and diwali.chosen_calendar == "hindu" and diwali.kind == "religious"


# --- locality -------------------------------------------------------------------------------------


def test_a_state_day_reaches_its_state_and_nobody_else(calendar: Calendar) -> None:
    day = date(2026, 2, 19)  # Shiv Jayanti, Maharashtra, civic
    assert calendar.wish_for(MailPreferences(country="IN", region="IN-MH"), day) is not None
    assert calendar.wish_for(MailPreferences(country="IN", region="IN-TG"), day) is None
    assert calendar.wish_for(MailPreferences(country="IN"), day) is None  # region unknown: no


def test_a_regional_festival_needs_the_region_even_with_the_calendar_chosen(
    calendar: Calendar,
) -> None:
    onam = date(2026, 8, 26)
    kerala = MailPreferences(country="IN", region="IN-KL", festival_calendar=("hindu",))
    telangana = MailPreferences(country="IN", region="IN-TG", festival_calendar=("hindu",))
    assert calendar.wish_for(kerala, onam).festival_id == "onam"  # type: ignore[union-attr]
    assert calendar.wish_for(telangana, onam) is None
    pongal = date(2026, 1, 14)
    tamil_nadu = MailPreferences(country="IN", region="IN-TN", festival_calendar=("hindu",))
    assert calendar.wish_for(tamil_nadu, pongal).festival_id == "pongal"  # type: ignore[union-attr]
    # the same day is Sankranti in Telangana and Andhra Pradesh — their main festival — and it
    # is that, not Pongal, a family there is wished; Karnataka's Sankranti too, never Kerala's
    assert calendar.wish_for(telangana, pongal).festival_id == "makar-sankranti"  # type: ignore[union-attr]
    andhra = MailPreferences(country="IN", region="IN-AP", festival_calendar=("hindu",))
    assert calendar.wish_for(andhra, pongal).festival_id == "makar-sankranti"  # type: ignore[union-attr]
    kerala = MailPreferences(country="IN", region="IN-KL", festival_calendar=("hindu",))
    assert calendar.wish_for(kerala, pongal) is None


def test_a_community_calendar_reaches_the_family_wherever_the_festival_is_kept(
    calendar: Calendar,
) -> None:
    onam = date(2026, 8, 26)
    dubai = MailPreferences(country="AE", festival_calendar=("malayali",))
    assert calendar.wish_for(dubai, onam).festival_id == "onam"  # type: ignore[union-attr]
    # Onam's own country list does not include the United States, so a Malayali family there
    # gets nothing: the file decides where a festival is kept, the calendar only who it is for.
    texas = MailPreferences(
        country="US", timezone="America/Chicago", festival_calendar=("malayali",)
    )
    assert calendar.wish_for(texas, onam) is None
    # and the broad calendar alone does not reach across the region line
    dubai_hindu = MailPreferences(country="AE", festival_calendar=("hindu",))
    assert calendar.wish_for(dubai_hindu, onam) is None


def test_a_bengali_family_in_delhi_gets_the_bengali_new_year(calendar: Calendar) -> None:
    prefs = MailPreferences(country="IN", region="IN-DL", festival_calendar=("bengali",))
    wish = calendar.wish_for(prefs, date(2026, 4, 15))
    assert wish is not None and wish.festival_id == "pohela-boishakh"
    assert wish.line("Learner") == "Happy Bengali new year, Learner. I hope the year starts sweet."


def test_region_aliases_are_read_the_way_families_type_them(calendar: Calendar) -> None:
    assert calendar.normalise_region("in-ts") == "IN-TG"
    assert calendar.normalise_region("IN-OR") == "IN-OD"
    assert calendar.normalise_region(None) is None
    prefs = MailPreferences(country="IN", region="IN-TS", festival_calendar=("hindu",))
    assert calendar.wish_for(prefs, date(2026, 3, 19)).festival_id == "chaitra-sukladi"  # type: ignore[union-attr]


def test_a_region_from_another_country_is_no_region(calendar: Calendar) -> None:
    prefs = MailPreferences(country="IN", region="GB-ENG")
    assert calendar.wish_for(prefs, date(2026, 2, 19)) is None  # not Maharashtra
    assert calendar.wish_for(prefs, date(2026, 1, 26)) is not None  # still India


def test_unknown_locality_sends_nothing(calendar: Calendar) -> None:
    assert year_of(calendar, MailPreferences(festival_calendar=("hindu",))) == []
    assert year_of(calendar, MailPreferences(country="", region="IN-TG")) == []


# --- what a chosen calendar does and does not unlock ----------------------------------------------


def test_choosing_one_calendar_never_unlocks_another(calendar: Calendar) -> None:
    muslim = MailPreferences(country="IN", festival_calendar=("muslim",))
    got = {fid for _, fid in year_of(calendar, muslim)}
    assert "diwali" not in got and "christmas" not in got and "holi" not in got
    assert "hazrat-ali-birthday" in got


def test_a_festival_that_moves_with_the_moon_waits_for_the_days_confirmation(
    calendar: Calendar,
) -> None:
    muslim = MailPreferences(country="IN", festival_calendar=("muslim",))
    eid = date(2026, 3, 21)  # the stored, official, still-provisional date
    assert calendar.wish_for(muslim, eid) is None
    wish = calendar.wish_for(muslim, eid, confirmed=("eid-al-fitr",))
    assert wish is not None and wish.festival_id == "eid-al-fitr"
    assert (
        wish.line("Learner")
        == "Happy Eid, Learner. I hope the house is full and the food goes on all day."
    )


def test_christmas_goes_on_the_day_not_the_eve_and_only_to_families_who_chose_it(
    calendar: Calendar,
) -> None:
    christian = MailPreferences(country="IN", festival_calendar=("christian",))
    assert calendar.wish_for(christian, date(2026, 12, 24)) is None  # greet: false
    assert calendar.wish_for(christian, date(2026, 12, 25)).festival_id == "christmas"  # type: ignore[union-attr]
    assert calendar.wish_for(MailPreferences(country="IN"), date(2026, 12, 25)) is None


def test_a_civic_group_with_no_greeting_is_never_greeted(calendar: Calendar) -> None:
    """The US federal holidays are recorded for scheduling; every entry is greet: false."""
    us = MailPreferences(country="US", timezone="America/New_York")
    got = {fid for _, fid in year_of(calendar, us)}
    assert "us-federal-holidays" not in got
    assert got == {"new-year-gregorian", "thanksgiving"}


def test_a_date_that_could_not_be_sourced_is_never_used(calendar: Calendar) -> None:
    """Nepal's new year is `reported`, Lohri is `conventional` and unchecked: neither sends."""
    nepal = MailPreferences(country="NP")
    assert ("2026-04-14", "nepal-new-year") not in year_of(calendar, nepal)
    punjab = MailPreferences(country="IN", region="IN-PB", festival_calendar=("sikh", "punjabi"))
    assert calendar.wish_for(punjab, date(2026, 1, 13)) is None  # Lohri
    assert calendar.wish_for(punjab, date(2026, 11, 24)).festival_id == "guru-nanak-jayanti"  # type: ignore[union-attr]


def test_a_suppressed_entry_is_left_out(calendar: Calendar) -> None:
    """The umbrella Vaisakhi entry cannot name the right day for the right family yet."""
    assert "vaisakhi" in calendar.suppressed
    kerala = MailPreferences(country="IN", region="IN-KL", festival_calendar=("hindu", "malayali"))
    assert calendar.wish_for(kerala, date(2026, 4, 14)) is None
    assert calendar.wish_for(kerala, date(2026, 4, 15)) is None


# --- one a day, and the line itself ---------------------------------------------------------------


def test_never_more_than_one_wish_a_day(calendar: Calendar) -> None:
    everything = MailPreferences(
        country="IN", region="IN-WB", festival_calendar=tuple(calendar.calendar_ids)
    )
    day = date(2026, 1, 1)
    while day.year == 2026:
        found = calendar.candidates(everything, day)
        assert calendar.wish_for(everything, day) == (found[0] if found else None)
        day += timedelta(days=1)


def test_the_line_names_the_day_and_drops_the_name_cleanly(calendar: Calendar) -> None:
    wish = calendar.wish_for(MailPreferences(country="IN"), date(2026, 1, 26))
    assert wish is not None
    assert wish.line("Learner").startswith("Happy Republic Day, Learner.")
    assert (
        wish.line(None)
        == "Happy Republic Day. I hope the morning is bright and the day is an easy one."
    )
    assert wish.line("   ") == wish.line(None)
    assert "!" not in wish.line("Learner")


def test_a_line_the_gate_refuses_is_dropped_not_sent(calendar: Calendar) -> None:
    """The file's own example for Ganesh Chaturthi carries a chant; Eid's uses a transliterated
    greeting. Neither reaches the engine; Eid has a plain-English line instead."""
    assert calendar.festivals["ganesh-chaturthi"].example is None
    assert calendar.festivals["eid-al-fitr"].example is None
    assert calendar.festivals["eid-al-fitr"].wish == (
        "Happy Eid, {name}. I hope the house is full and the food goes on all day."
    )
    maharashtra = MailPreferences(country="IN", region="IN-MH", festival_calendar=("hindu",))
    assert calendar.wish_for(maharashtra, date(2026, 9, 14)) is None  # nothing sendable to say


# --- quiet days -----------------------------------------------------------------------------------


def test_quiet_days_are_scoped_to_their_country(calendar: Calendar) -> None:
    martyrs = date(2026, 1, 30)
    assert calendar.quiet_day_ids("IN", martyrs) == ["in-martyrs-day"]
    assert calendar.is_quiet_day("GB", martyrs) is False
    good_friday = date(2026, 4, 3)
    assert "good-friday" in calendar.quiet_day_ids("GB", good_friday)
    assert calendar.is_quiet_day(None, good_friday) is False


def test_a_greetable_wish_still_goes_on_a_quiet_day(calendar: Calendar) -> None:
    """24 November 2026: Guru Nanak's birthday and Guru Tegh Bahadur's martyrdom. The greeting
    goes; the quiet day is for the marketing engine to honour."""
    day = date(2026, 11, 24)
    assert calendar.is_quiet_day("IN", day)
    sikh = MailPreferences(country="IN", region="IN-PB", festival_calendar=("sikh",))
    assert calendar.wish_for(sikh, day).festival_id == "guru-nanak-jayanti"  # type: ignore[union-attr]


# --- timing: quiet hours, the twenty-four-hour gap, the family's clock ----------------------------

REPUBLIC_MORNING = datetime(2026, 1, 26, 9, 0, tzinfo=IST)


def test_a_wish_sends_in_the_morning_in_the_familys_own_time(calendar: Calendar) -> None:
    prefs = MailPreferences(country="IN", region="IN-TG")
    decision = calendar.decide(prefs, REPUBLIC_MORNING.astimezone(UTC))
    assert decision.send_now and decision.wish is not None
    assert decision.wish.festival_id == "republic-day-india"
    assert decision.local_day == date(2026, 1, 26)


def test_quiet_hours_hold_the_wish_until_the_family_is_up(calendar: Calendar) -> None:
    prefs = MailPreferences(country="IN")
    small_hours = datetime(2026, 1, 26, 1, 30, tzinfo=IST)
    decision = calendar.decide(prefs, small_hours)
    assert not decision.send_now and decision.reason == "quiet hours"
    assert decision.wish is not None and decision.wish.festival_id == "republic-day-india"
    assert decision.send_after == datetime(2026, 1, 26, 8, 0, tzinfo=IST)
    late = datetime(2026, 1, 26, 22, 0, tzinfo=IST)
    decision = calendar.decide(prefs, late)
    assert (
        not decision.send_now and "day is over" in decision.reason and decision.send_after is None
    )


def test_quiet_hours_can_be_set_in_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAIL_QUIET_HOURS", "20:00-09:30")
    cal = load_calendar(CALENDAR_FILE)
    assert cal.in_quiet_hours(datetime(2026, 1, 26, 9, 0, tzinfo=IST))
    assert not cal.in_quiet_hours(datetime(2026, 1, 26, 9, 30, tzinfo=IST))
    assert cal.in_quiet_hours(datetime(2026, 1, 26, 20, 0, tzinfo=IST))


def test_never_within_twenty_four_hours_of_another_email(calendar: Calendar) -> None:
    prefs = MailPreferences(country="IN")
    # another mail went out at 10:00 yesterday: hold until 10:00 today, still the same day
    held = calendar.decide(
        prefs, REPUBLIC_MORNING, last_email_at=datetime(2026, 1, 25, 10, 0, tzinfo=IST)
    )
    assert not held.send_now and held.send_after == datetime(2026, 1, 26, 10, 0, tzinfo=IST)
    # a mail at 08:30 yesterday is more than a day ago: send
    assert calendar.decide(
        prefs, REPUBLIC_MORNING, last_email_at=datetime(2026, 1, 25, 8, 30, tzinfo=IST)
    ).send_now
    # a mail half an hour ago at 19:30: the gap would end tomorrow, and the wish is lost, not late
    evening = datetime(2026, 1, 26, 20, 0, tzinfo=IST)
    lost = calendar.decide(prefs, evening, last_email_at=evening - timedelta(minutes=30))
    assert not lost.send_now and lost.send_after is None and "day would be over" in lost.reason
    # a naive timestamp is read as UTC, never as the family's clock
    naive = calendar.decide(prefs, REPUBLIC_MORNING, last_email_at=datetime(2026, 1, 26, 3, 0))
    assert not naive.send_now


def test_a_family_outside_a_single_zone_country_must_set_a_timezone(calendar: Calendar) -> None:
    thanksgiving_utc = datetime(2026, 11, 26, 15, 0, tzinfo=UTC)
    assert calendar.decide(MailPreferences(country="US"), thanksgiving_utc).wish is None
    with_zone = MailPreferences(country="US", timezone="America/New_York")
    decision = calendar.decide(with_zone, thanksgiving_utc)
    assert decision.send_now and decision.wish.festival_id == "thanksgiving"  # type: ignore[union-attr]
    # India has one zone, so it needs none
    assert calendar.timezone_for(MailPreferences(country="IN")) == IST
    assert calendar.timezone_for(MailPreferences(country="IN", timezone="Not/AZone")) == IST


def test_a_zone_that_disagrees_with_the_country_is_an_ambiguous_locality(
    calendar: Calendar,
) -> None:
    """§14.1 rule 5: country=IN with a New York clock is two localities, and we cannot tell
    which is the family's — so nothing is timed and nothing sends. Two names for the same clock
    agree and are fine."""
    odd = MailPreferences(country="IN", timezone="America/New_York")
    assert calendar.timezone_for(odd, at=REPUBLIC_MORNING) is None
    decision = calendar.decide(odd, REPUBLIC_MORNING)
    assert decision.wish is None and "timezone" in decision.reason
    same_clock = MailPreferences(country="IN", timezone="Asia/Calcutta")
    assert calendar.timezone_for(same_clock, at=REPUBLIC_MORNING) is not None
    assert calendar.decide(same_clock, REPUBLIC_MORNING).send_now
    # a country with many zones has no default to disagree with
    assert calendar.timezone_for(MailPreferences(country="US", timezone="Asia/Kolkata")) is not None


def test_the_switches_win_over_everything(calendar: Calendar) -> None:
    off = MailPreferences(country="IN", festivals=False)
    assert calendar.decide(off, REPUBLIC_MORNING).reason == "festival wishes are switched off"
    stopped = MailPreferences(country="IN", unsubscribed_at=datetime(2026, 1, 1, tzinfo=UTC))
    assert calendar.decide(stopped, REPUBLIC_MORNING).reason == "the family unsubscribed"
    assert year_of(calendar, stopped) == []


# --- the synthetic calendar: ranking, absence, derivation -----------------------------------------


def synthetic(**extra: Any) -> Calendar:
    data: dict[str, Any] = {
        "rule_engine": {
            "kind_by_tradition": {"civic": "civic", "secular": "seasonal", "hindu": "religious"},
            "calendars": [{"id": "hindu", "name": "Hindu festivals"}],
            "region_codes": {"Kerala": ["IN-KL"]},
            "send_confidences": ["official"],
            "default_timezones": {"IN": "Asia/Kolkata"},
            "quiet_hours": {"from": "21:00", "to": "08:00"},
            "wishes": [
                {"festival": "civic-day", "day": "Civic Day", "text": "Happy Civic Day, {name}."},
                {
                    "festival": "chosen-day",
                    "day": "Chosen Day",
                    "text": "Happy Chosen Day, {name}.",
                },
            ],
            **extra,
        },
        "quiet_days": {"days": []},
        "festivals": [
            {
                "id": "civic-day",
                "name": "Civic Day",
                "tradition": "civic",
                "countries": ["IN"],
                "regions": [],
                "greeting_style": {"example": None},
                "dates": {
                    "2026": [
                        {
                            "date": "2026-06-01",
                            "scope": "IN",
                            "greet": True,
                            "confidence": "official",
                        }
                    ]
                },
            },
            {
                "id": "chosen-day",
                "name": "Chosen Day",
                "tradition": "hindu",
                "countries": ["IN"],
                "regions": ["Kerala"],
                "greeting_style": {"example": None},
                "dates": {
                    "2026": [
                        {
                            "date": "2026-06-01",
                            "scope": "IN",
                            "greet": True,
                            "confidence": "official",
                        }
                    ]
                },
            },
        ],
    }
    return Calendar(data)


def test_the_familys_own_calendar_wins_the_day() -> None:
    cal = synthetic()
    day = date(2026, 6, 1)
    plain = MailPreferences(country="IN", region="IN-KL")
    assert [w.festival_id for w in cal.candidates(plain, day)] == ["civic-day"]
    chose = MailPreferences(country="IN", region="IN-KL", festival_calendar=("hindu",))
    assert [w.festival_id for w in cal.candidates(chose, day)] == ["chosen-day", "civic-day"]
    assert cal.wish_for(chose, day).festival_id == "chosen-day"  # type: ignore[union-attr]


def test_kind_and_opt_in_are_derived_from_the_tradition_and_the_overrides() -> None:
    cal = synthetic(kind_overrides={"civic-day": "religious"})
    assert cal.festivals["civic-day"].kind == "religious"
    assert cal.festivals["civic-day"].requires_opt_in is True
    assert cal.festivals["civic-day"].calendars == frozenset({"civic"})
    assert cal.festivals["chosen-day"].region_codes == frozenset({"IN-KL"})
    # an override to an unknown kind falls to the safe side
    odd = synthetic(kind_overrides={"civic-day": "festive"})
    assert odd.festivals["civic-day"].kind == "religious"


def test_a_missing_file_is_an_empty_calendar_that_sends_nothing(tmp_path: Path) -> None:
    cal = load_calendar(tmp_path / "absent.json")
    assert cal.present is False and cal.festivals == {}
    prefs = MailPreferences(country="IN", timezone="Asia/Kolkata", festival_calendar=("hindu",))
    decision = cal.decide(prefs, REPUBLIC_MORNING)
    assert decision.wish is None and not decision.send_now
    assert decision.reason == "nothing to wish today"
    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    assert load_calendar(broken).present is False


def test_the_process_wide_calendar_reads_the_content_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "festivals.json").write_text(
        json.dumps(json.loads(CALENDAR_FILE.read_text())), encoding="utf-8"
    )
    monkeypatch.setenv("WOBO_HOSPITALITY_CONTENT", str(tmp_path))
    fest.set_calendar(None)
    assert fest.content_dir() == tmp_path
    assert "diwali" in fest.get_calendar().festivals
    fest.set_calendar(None)


def test_every_real_festival_has_a_kind_the_engine_knows(calendar: Calendar) -> None:
    for festival in calendar.festivals.values():
        assert festival.kind in fest.KINDS, festival.id
        assert festival.requires_opt_in == (festival.kind == "religious"), festival.id
        if festival.requires_opt_in:
            assert festival.calendars, festival.id  # something a family could choose
        for code in festival.region_codes:
            assert not code.startswith("?"), f"{festival.id}: unmapped region {code[1:]}"
