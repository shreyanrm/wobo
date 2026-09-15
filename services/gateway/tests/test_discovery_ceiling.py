"""The money and the switch on discovery: per board, per day, a hard stop, a remembered refusal.

docs/BOARD-COLD-START.md §5: *"A budget per board and per day, on the console with an alert, so a
bad day cannot become a bill"*, and *"a refusal is remembered, so a board whose document cannot be
read is not re-fetched on every learner who picks it"*. Before this, one discovery was metered as
one GENERATION against a system subject — a count of runs, not an amount of money — and the only
thing that could stop the worker was a redeploy.

Nothing here touches a network, a key or a model.
"""

from __future__ import annotations

import json

import pytest
from wobo_gateway import dials
from wobo_gateway.curriculum.discovery import ceiling
from wobo_gateway.curriculum.discovery.job import InMemoryJobStore, JobState


@pytest.fixture(autouse=True)
def _clean():
    ceiling.reset()
    yield
    ceiling.reset()


class _Dials:
    """The dials, as the console would have written them, with no store behind them."""

    def __init__(self, **values):
        self.values = values

    def __enter__(self):
        self._before = dials.values
        dials.values = lambda: dict(self.values)  # type: ignore[assignment]
        return self

    def __exit__(self, *exc):
        dials.values = self._before  # type: ignore[assignment]


# --- the dials are dials, not constants -----------------------------------------------------
def test_the_defaults_are_the_documented_ones():
    assert ceiling.board_ceiling_usd() == ceiling.DEFAULT_BOARD_USD
    assert ceiling.daily_ceiling_usd() == ceiling.DEFAULT_DAILY_USD
    assert ceiling.retry_refused_after_days() == ceiling.DEFAULT_RETRY_DAYS
    assert ceiling.running() is True


def test_every_dial_is_read_live_from_ops_settings():
    with _Dials(
        **{
            ceiling.BOARD_KEY: 0.25,
            ceiling.DAY_KEY: 1.0,
            ceiling.RETRY_KEY: 3,
            ceiling.RUNNING_KEY: False,
        }
    ):
        assert ceiling.board_ceiling_usd() == 0.25
        assert ceiling.daily_ceiling_usd() == 1.0
        assert ceiling.retry_refused_after_days() == 3
        assert ceiling.running() is False


def test_a_nonsense_dial_is_ignored_rather_than_taking_discovery_down():
    with _Dials(**{ceiling.BOARD_KEY: "a lot", ceiling.DAY_KEY: -1, ceiling.RETRY_KEY: 0}):
        assert ceiling.board_ceiling_usd() == ceiling.DEFAULT_BOARD_USD
        assert ceiling.daily_ceiling_usd() == ceiling.DEFAULT_DAILY_USD
        assert ceiling.retry_refused_after_days() == ceiling.DEFAULT_RETRY_DAYS


def test_the_dials_are_registered_with_the_console_so_they_are_read_and_audited():
    for key in (ceiling.RUNNING_KEY, ceiling.BOARD_KEY, ceiling.DAY_KEY, ceiling.RETRY_KEY):
        assert key in dials.keys(), f"{key} is never read from ops.settings"  # noqa: SIM118


# --- the three ceilings ---------------------------------------------------------------------
def test_a_board_that_has_spent_its_own_ceiling_is_refused_before_it_costs_anything():
    with _Dials(**{ceiling.BOARD_KEY: 0.20, ceiling.DAY_KEY: 10.0}):
        assert ceiling.verdict("msbshse") is None
        ceiling.record("msbshse", 0.21)
        assert ceiling.verdict("msbshse") == "board_budget_spent"
        assert ceiling.verdict("upmsp") is None, "one board's bill is not another board's"


def test_a_day_that_is_spent_refuses_every_board():
    with _Dials(**{ceiling.BOARD_KEY: 10.0, ceiling.DAY_KEY: 0.50}):
        ceiling.record("msbshse", 0.30)
        ceiling.record("upmsp", 0.25)
        assert ceiling.verdict("tn-dge") == "day_budget_spent"


def test_the_hard_stop_stops_everything_without_a_deploy():
    with _Dials(**{ceiling.RUNNING_KEY: False}):
        assert ceiling.verdict("msbshse") == "discovery_stopped"


def test_the_day_rolls_at_midnight_utc():
    ceiling.record("msbshse", 1.0, day="2026-09-15")
    assert ceiling.state("2026-09-15").total_usd == 1.0
    assert ceiling.state("2026-09-16").total_usd == 0.0


def test_what_a_board_has_spent_is_visible_for_the_console():
    ceiling.record("msbshse", 0.03)
    ceiling.record("msbshse", 0.02)
    ceiling.record("upmsp", 0.01)
    state = ceiling.state()
    assert round(state.by_board["msbshse"], 6) == 0.05
    assert state.runs == 3
    assert round(state.total_usd, 6) == 0.06
    assert json.loads(json.dumps(state.as_dict()))["by_board"]["upmsp"] == 0.01


# --- a run that costs more than its board's ceiling is stopped in flight ---------------------
def test_a_run_is_stopped_the_moment_it_crosses_its_boards_ceiling():
    with _Dials(**{ceiling.BOARD_KEY: 0.10, ceiling.DAY_KEY: 10.0}):
        assert ceiling.would_exceed("msbshse", 0.05) is None
        assert ceiling.would_exceed("msbshse", 0.11) == "board_budget_spent"
        ceiling.record("msbshse", 0.06)
        assert ceiling.would_exceed("msbshse", 0.05) == "board_budget_spent"


def test_the_meter_records_what_a_run_actually_cost():
    from wobo_gateway import spend

    spend.reset()
    with ceiling.meter("msbshse") as run:
        spend.record(0.0123, capability="curriculum.discovery", model="test/model")
    assert round(run.spent_usd, 6) == 0.0123
    assert round(ceiling.state().by_board["msbshse"], 6) == 0.0123
    spend.reset()


# --- a refusal is remembered ----------------------------------------------------------------
def test_a_board_whose_site_cannot_be_reached_rests_instead_of_being_asked_again():
    for _ in range(ceiling.REFUSALS_BEFORE_REST):
        assert ceiling.resting("upmsp") is None
        ceiling.remember_refusal("upmsp", "not_fetchable")
    assert ceiling.resting("upmsp") == "not_fetchable"
    assert ceiling.verdict("upmsp") == "board_resting"


def test_only_a_refusal_about_the_board_itself_rests_the_board():
    for _ in range(ceiling.REFUSALS_BEFORE_REST * 2):
        ceiling.remember_refusal("upmsp", "checks_failed")
    assert ceiling.resting("upmsp") is None, (
        "a reading we could not trust is about one subject, never about the board"
    )


def test_a_rested_board_wakes_when_the_owner_asks():
    for _ in range(ceiling.REFUSALS_BEFORE_REST):
        ceiling.remember_refusal("upmsp", "tls_untrusted")
    assert ceiling.resting("upmsp")
    ceiling.wake("upmsp")
    assert ceiling.resting("upmsp") is None


# --- and the job refuses on all of it, in Wobo's voice ---------------------------------------
def _run(store, framework_id="cbse"):
    import test_discovery as base

    return base.run_cbse_job(store)


def test_a_stopped_discovery_refuses_the_learner_in_one_plain_line():
    with _Dials(**{ceiling.RUNNING_KEY: False}):
        record = _run(InMemoryJobStore())
    assert record.state is JobState.REFUSED
    assert record.reason == "discovery_stopped"
    assert record.message and record.message[0].isupper() and "!" not in record.message
    assert "syllabus" in record.message.lower(), "the own-syllabus door stays open"


def test_a_stopped_discovery_costs_nothing_at_all():
    from wobo_gateway import spend

    spend.reset()
    with _Dials(**{ceiling.RUNNING_KEY: False}):
        _run(InMemoryJobStore())
    assert spend.spent_usd() == 0.0
    assert ceiling.state().runs == 0


def test_a_run_that_completes_is_billed_to_its_board():
    record = _run(InMemoryJobStore())
    assert record.state is JobState.PROVISIONAL
    assert "cbse" in ceiling.state().by_board


def test_a_board_level_refusal_is_remembered_by_the_job_itself():
    import test_discovery as base
    from wobo_gateway.curriculum.discovery.fetch import FetchRefused

    def _door_shut(url, **kwargs):
        raise FetchRefused("tls_untrusted", "certificate verify failed")

    for _ in range(ceiling.REFUSALS_BEFORE_REST):
        record = base.run_cbse_job(InMemoryJobStore(), fetch_fn=_door_shut)
        assert record.state is JobState.REFUSED
    assert ceiling.resting("cbse") == "not_fetchable"


def test_a_subject_we_could_not_find_never_rests_the_whole_board():
    import test_discovery as base
    from wobo_gateway.curriculum.discovery.search import MockSearchProvider

    for _ in range(ceiling.REFUSALS_BEFORE_REST * 2):
        base.run_cbse_job(InMemoryJobStore(), search_provider=MockSearchProvider([]))
    assert ceiling.resting("cbse") is None, (
        "no candidate for one subject is not a board whose site is shut"
    )


# --- a refusal about US is not a refusal about the board -------------------------------------
# The guard refuses before a job is claimed, and a refusal is written down and remembered for a
# week (``job.RETRY_REFUSED_AFTER_DAYS``). That memory is right for "this board's document cannot
# be read" and catastrophic for "the day's budget is spent": a board refused at five to midnight
# would have been refused for the following week, on a day whose budget was untouched. What is
# remembered has to be a fact about the board, and the money and the switch are facts about us.
def test_a_board_refused_for_money_is_asked_again_the_moment_the_money_is_there():
    import test_discovery as base

    store = InMemoryJobStore()
    with _Dials(**{ceiling.DAY_KEY: 0.0000001}):
        ceiling.record("cbse", 1.0)
        refused = base.run_cbse_job(store)
    assert refused.state is JobState.REFUSED and refused.reason == "day_budget_spent"

    ceiling.reset()
    again = base.run_cbse_job(store)
    assert again.state is JobState.PROVISIONAL, (
        "a board refused for a full day's budget was locked out for a week"
    )


@pytest.mark.parametrize(
    "reason",
    ["discovery_stopped", "day_budget_spent", "board_budget_spent", "board_resting"],
)
def test_every_refusal_the_guard_raises_is_transient(reason):
    from wobo_gateway.curriculum.discovery import job as job_mod

    assert reason in job_mod.TRANSIENT_REASONS


def test_a_document_we_could_not_read_is_still_remembered_for_the_week():
    from wobo_gateway.curriculum.discovery import job as job_mod

    for reason in ("not_fetchable", "no_syllabus_in_document", "checks_failed", "not_found"):
        assert reason not in job_mod.TRANSIENT_REASONS


# --- nothing lifts the hard stop, not even the owner's "look again now" ----------------------
# ``force`` is documented as one thing — *"reopens a stored record, the owner's way of asking for
# another look now"* — and did two: it also skipped this whole guard. The only caller that sets
# it is the discovery WORKER, which sets it on every job it drains, so the switch, the resting
# board and both money ceilings were guards over every path in the system except the one that
# runs in production.
def test_the_owners_another_look_never_lifts_the_hard_stop():
    import test_discovery as base

    with _Dials(**{ceiling.RUNNING_KEY: False}):
        record = base.run_cbse_job(InMemoryJobStore(), force=True)
    assert record.state is JobState.REFUSED and record.reason == "discovery_stopped"


def test_a_forced_look_at_a_resting_board_still_leaves_it_alone():
    import test_discovery as base

    for _ in range(ceiling.REFUSALS_BEFORE_REST):
        ceiling.remember_refusal("cbse", "tls_untrusted")
    record = base.run_cbse_job(InMemoryJobStore(), force=True)
    assert record.state is JobState.REFUSED and record.reason == "board_resting"


def test_a_forced_look_over_the_days_ceiling_still_refuses():
    import test_discovery as base

    # Another board spent the day, and this board's own ceiling is nowhere near: the only thing
    # that can refuse cbse here is the day.
    with _Dials(**{ceiling.DAY_KEY: 0.50, ceiling.BOARD_KEY: 10.0}):
        ceiling.record("upmsp", 0.60)
        record = base.run_cbse_job(InMemoryJobStore(), force=True)
    assert record.state is JobState.REFUSED and record.reason == "day_budget_spent"


# --- the day has to survive the process that counted it ---------------------------------------
# What was built stopped a bad day inside ONE process. The day's tally, every board's total and
# the resting list all lived in module globals, so a redeploy, a crash loop or a second replica
# started the day again at zero: bounded per process, unbounded across restarts. The prewarm's
# 14 rungs are about 0.48 USD per readable board per pass, so a loop that restarts every few
# minutes could have spent the day's ceiling many times over and every tally would have read
# nothing. The durable rows the console already reads — one per (board, class, subject), carrying
# ``result.cost_usd`` and ``result.reason`` — are what the day is rebuilt from.
def _rows(monkeypatch, *rows, fail: bool = False):
    """Install the durable memory, the way the job rows would remember today."""

    def read(day: str):
        if fail:
            raise RuntimeError("the store will not answer")
        return list(rows)

    monkeypatch.setattr(ceiling, "durable_rows", read)


def test_the_days_money_is_read_back_after_a_redeploy(monkeypatch):
    _rows(
        monkeypatch,
        ceiling.Row("msbshse", "Class 10", "Mathematics", 0.34),
        ceiling.Row("upmsp", "Class 10", "Mathematics", 0.09),
    )
    ceiling.reset()  # the redeploy
    with _Dials(**{ceiling.DAY_KEY: 5.0, ceiling.BOARD_KEY: 0.30}):
        assert round(ceiling.state().total_usd, 6) == 0.43
        assert round(ceiling.state().by_board["msbshse"], 6) == 0.34
        assert ceiling.verdict("msbshse") == "board_budget_spent"
        assert ceiling.verdict("upmsp") is None


def test_a_day_spent_before_the_restart_still_refuses_every_board(monkeypatch):
    _rows(monkeypatch, ceiling.Row("msbshse", "Class 10", "Mathematics", 0.60))
    ceiling.reset()
    with _Dials(**{ceiling.DAY_KEY: 0.50, ceiling.BOARD_KEY: 10.0}):
        assert ceiling.verdict("tn-dge") == "day_budget_spent"


def test_a_crash_loop_cannot_start_the_day_again(monkeypatch):
    _rows(monkeypatch, ceiling.Row("msbshse", "Class 10", "Mathematics", 0.48))
    for _ in range(5):
        ceiling.reset()
        assert round(ceiling.state().total_usd, 6) == 0.48


def test_a_run_this_process_counted_is_never_counted_twice_when_its_row_lands(monkeypatch):
    key = ceiling.run_key("msbshse", "Class 10", "Mathematics")
    _rows(monkeypatch, ceiling.Row("msbshse", "Class 10", "Mathematics", 0.0342))
    ceiling.record("msbshse", 0.0342, key=key)
    assert round(ceiling.state().total_usd, 6) == 0.0342
    ceiling.recover(force=True)
    assert round(ceiling.state().total_usd, 6) == 0.0342
    assert ceiling.state().runs == 1


def test_another_replicas_board_is_added_rather_than_replacing_this_ones(monkeypatch):
    _rows(monkeypatch, ceiling.Row("upmsp", "Class 10", "Science", 0.20))
    ceiling.record("msbshse", 0.10, key=ceiling.run_key("msbshse", "Class 10", "Mathematics"))
    state = ceiling.state()
    assert round(state.total_usd, 6) == 0.30
    assert sorted(state.by_board) == ["msbshse", "upmsp"]


def test_a_run_nothing_could_be_priced_on_is_a_run_and_not_a_zero_pound_note(monkeypatch):
    _rows(monkeypatch, ceiling.Row("msbshse", "Class 10", "Mathematics", None))
    assert ceiling.state().runs == 1
    assert ceiling.state().total_usd == 0.0


def test_a_board_whose_door_was_shut_is_still_resting_after_the_restart(monkeypatch):
    _rows(
        monkeypatch,
        *[
            ceiling.Row("upmsp", "Class 10", subject, 0.0, "not_fetchable")
            for subject in ("Mathematics", "Science", "Social Science")
        ],
    )
    ceiling.reset()
    assert ceiling.resting("upmsp") == "not_fetchable"
    assert ceiling.verdict("upmsp") == "board_resting"


def test_a_refusal_about_us_never_rests_a_board_across_a_restart(monkeypatch):
    _rows(
        monkeypatch,
        *[
            ceiling.Row("upmsp", "Class 10", f"Subject {n}", 0.0, reason)
            for n, reason in enumerate(
                ["day_budget_spent", "board_budget_spent", "checks_failed", "not_found"] * 2
            )
        ],
    )
    ceiling.reset()
    assert ceiling.resting("upmsp") is None


def test_the_owners_wake_is_not_undone_by_the_next_read(monkeypatch):
    _rows(
        monkeypatch,
        *[
            ceiling.Row("upmsp", "Class 10", subject, 0.0, "tls_untrusted")
            for subject in ("Mathematics", "Science", "Social Science")
        ],
    )
    assert ceiling.resting("upmsp") == "tls_untrusted"
    ceiling.wake("upmsp")
    ceiling.recover(force=True)
    assert ceiling.resting("upmsp") is None, "the console's retry was overwritten by the rows"


def test_a_store_that_will_not_answer_never_stops_a_discovery(monkeypatch):
    _rows(monkeypatch, fail=True)
    ceiling.reset()
    assert ceiling.verdict("msbshse") is None
    assert ceiling.state().total_usd == 0.0


def test_the_recovery_is_read_once_and_not_on_every_question(monkeypatch):
    reads = []

    def read(day: str):
        reads.append(day)
        return []

    monkeypatch.setattr(ceiling, "durable_rows", read)
    ceiling.reset()
    for _ in range(10):
        ceiling.verdict("msbshse")
        ceiling.state()
    assert len(reads) == 1, f"the guard asked the store {len(reads)} times"


# --- and the durable memory is the job rows themselves, not a new table ------------------------
def test_the_rows_the_day_is_rebuilt_from_are_the_discovery_jobs(monkeypatch):
    from wobo_gateway.curriculum import store as store_mod
    from wobo_gateway.curriculum.models import JobState as RowState

    store = store_mod.InMemoryStore()
    landed = store.enqueue_discovery(
        query="maharashtra", framework_id="msbshse", level="Class 10", subject="Mathematics"
    )
    store.update_job(
        landed.id, state=RowState.STORED, result={"kind": "discovery", "cost_usd": 0.0342}
    )
    shut = store.enqueue_discovery(
        query="uttar pradesh", framework_id="upmsp", level="Class 10", subject="Mathematics"
    )
    store.update_job(
        shut.id, state=RowState.REFUSED, result={"reason": "not_fetchable", "cost_usd": 0.0089}
    )
    yesterday = store.enqueue_discovery(
        query="bihar", framework_id="bseb", level="Class 10", subject="Mathematics"
    )
    store.update_job(yesterday.id, state=RowState.STORED, result={"cost_usd": 4.0})
    store._jobs[yesterday.id].updated_at = "2020-01-01T00:00:00+00:00"
    monkeypatch.setattr(store_mod, "get_store", lambda: store)

    ceiling.reset()
    state = ceiling.state()
    assert round(state.total_usd, 6) == 0.0431
    assert round(state.by_board["upmsp"], 6) == 0.0089
    assert "bseb" not in state.by_board, "yesterday's money was charged to today"


def test_a_queued_row_is_not_money_yet(monkeypatch):
    from wobo_gateway.curriculum import store as store_mod

    store = store_mod.InMemoryStore()
    store.enqueue_discovery(
        query="maharashtra", framework_id="msbshse", level="Class 10", subject="Mathematics"
    )
    monkeypatch.setattr(store_mod, "get_store", lambda: store)
    ceiling.reset()
    assert ceiling.state().runs == 0 and ceiling.state().total_usd == 0.0


def test_what_a_run_costs_lands_under_the_key_its_row_will_carry():
    """The in-process meter and the durable row have to agree on what one run IS, or the
    recovery counts the same discovery twice."""
    from wobo_gateway.curriculum.discovery.extract import SyllabusRequest

    request = SyllabusRequest(
        framework_id="msbshse",
        framework_name="Maharashtra State Board",
        level="Class 10",
        subject="Mathematics",
    )
    assert ceiling.key_for(request) == ceiling.run_key("msbshse", "class 10", " mathematics ")


def test_a_morning_of_queued_rows_cannot_push_the_mornings_money_off_the_page(monkeypatch):
    """The recovery asks for the day's FINISHED rows, not a page of the newest of everything."""
    from wobo_gateway.curriculum import store as store_mod
    from wobo_gateway.curriculum.models import JobState as RowState

    store = store_mod.InMemoryStore()
    paid = store.enqueue_discovery(
        query="maharashtra", framework_id="msbshse", level="Class 10", subject="Mathematics"
    )
    store.update_job(paid.id, state=RowState.STORED, result={"cost_usd": 0.42})
    for n in range(6):  # the prewarm's queue, every row of it newer than the money
        store.enqueue_discovery(
            query=f"board {n}", framework_id=f"board-{n}", level="Class 10", subject="Science"
        )
    monkeypatch.setattr(store_mod, "get_store", lambda: store)
    monkeypatch.setattr(ceiling, "RECOVERY_LIMIT", 3)

    ceiling.reset()
    assert round(ceiling.state().total_usd, 6) == 0.42
