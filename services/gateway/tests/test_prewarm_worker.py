"""The worker reads ahead of demand, and says what each board cost.

Two things the discovery worker did not do before this wave, both named in
``docs/BOARD-COLD-START.md``: §4, prewarm, *"the discovery worker runs ahead of demand against the
boards with the most students"*; and §5, *"a budget per board and per day, on the console with an
alert"*, which is unanswerable while nothing records what a board cost.

The rule the first half turns on: **a prewarmed board is only ever ENQUEUED.** The worker's drain
is oldest-first over ``queued``, so a learner who asked a second ago is still served before a board
nobody has asked for. Every seam is the one ``test_discovery_worker`` already fixtures; nothing here
touches a network or a model.
"""

from __future__ import annotations

import pytest
from test_discovery_worker import ASK, BOARD, worker_for  # noqa: F401
from wobo_gateway import doors, ledger
from wobo_gateway.curriculum import api
from wobo_gateway.curriculum.discovery import prewarm
from wobo_gateway.curriculum.models import Framework, FrameworkKind, JobState, Status
from wobo_gateway.curriculum.store import InMemoryStore, Seed

SECOND = Framework(
    id="msbshse",
    name="Maharashtra State Board",
    kind=FrameworkKind.STATE,
    status=Status.VERIFIED,
    country="IN",
    levels=("Class 9", "Class 10"),
    official_site="https://www.mahahsscboard.in",
)


@pytest.fixture
def dials(monkeypatch: pytest.MonkeyPatch):
    """``ops.settings`` in memory, so the prewarm's order dial is real and writable."""
    monkeypatch.setenv("DOORS_STORE", "memory")
    store = doors.InMemorySettingsStore()
    doors.set_store(store)
    yield store
    doors.set_store(None)


@pytest.fixture
def two_boards() -> InMemoryStore:
    return InMemoryStore(Seed(frameworks=[BOARD, SECOND]))


@pytest.fixture(autouse=True)
def _switched_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WOBO_DISCOVERY_WORKER", "1")
    monkeypatch.delenv("WOBO_RECHECK", raising=False)


def _order(dials, *ids: str) -> None:
    dials.write(prewarm.ORDER_KEY, list(ids), actor="test", note=None)


# --- the queue runs ahead of demand ---------------------------------------------------------------
def test_an_idle_tick_puts_the_biggest_boards_in_the_queue(dials, two_boards) -> None:
    _order(dials, "msbshse", "cbse")
    report = worker_for(two_boards).tick()
    assert report.prewarmed == 2, "nothing was waiting, so the worker read ahead of demand"
    queued = two_boards.queued_jobs(limit=10)
    assert [job.framework_id for job in queued] == ["msbshse", "cbse"]
    assert all(job.requested_by == prewarm.REQUESTED_BY for job in queued)
    assert report.claimed == 0, "a board is queued this tick and run on the next one, never both"


def test_the_next_tick_drains_what_the_last_one_queued(dials, two_boards) -> None:
    _order(dials, "cbse")
    worker_for(two_boards).tick()
    report = worker_for(two_boards).tick()
    assert report.stored + report.refused == 1


def test_a_learner_waiting_is_drained_before_a_board_nobody_asked_for(dials, two_boards) -> None:
    _order(dials, "msbshse", "cbse")
    asked = api.handle("curriculum.units", ASK, subject="learner-a", store=two_boards)
    job_id = asked["job_id"]
    worker = worker_for(two_boards, max_jobs=1)
    worker.tick()  # the learner's job is claimed; the prewarm is only queued behind it
    assert two_boards.get_job(job_id).state is JobState.STORED
    queued = two_boards.queued_jobs(limit=10)
    assert queued and all(prewarm.is_prewarm(job) for job in queued)


def test_a_spent_day_reads_no_board_ahead_of_demand(dials, two_boards, monkeypatch) -> None:
    _order(dials, "cbse", "msbshse")
    worker = worker_for(two_boards)
    monkeypatch.setattr(worker, "has_money", lambda: False)
    report = worker.tick()
    assert report.prewarmed == 0, "a spent day queues no board it cannot pay to read"
    assert two_boards.queued_jobs(limit=10) == []


def test_the_owner_can_switch_the_prewarm_off_without_stopping_the_worker(
    dials, two_boards
) -> None:
    _order(dials, "cbse")
    dials.write(prewarm.ENABLED_KEY, False, actor="owner@heywobo.com", note=None)
    report = worker_for(two_boards).tick()
    assert report.prewarmed == 0
    assert two_boards.queued_jobs(limit=10) == []


def test_a_worker_built_without_the_prewarm_never_reads_ahead(dials, two_boards) -> None:
    _order(dials, "cbse")
    assert worker_for(two_boards, prewarm_pass=False).tick().prewarmed == 0


# --- what a board cost ---------------------------------------------------------------------------
def costing(inner, *usd: float):
    """A completion seam that notes what it cost, exactly where ``telemetry.record_cost`` does.

    Every priced model call in this gateway lands on ``ledger.note_spend`` on its way out. This
    wrapper stands in that place, so the test exercises the real accounting path rather than a
    number handed to the worker.
    """
    prices = list(usd)

    def call(system: str, user: str):
        ledger.note_spend(prices[min(len(call.seen), len(prices) - 1)])  # type: ignore[attr-defined]
        call.seen.append(user)  # type: ignore[attr-defined]
        return inner(system, user)

    call.seen = []  # type: ignore[attr-defined]
    return call


def test_the_job_records_what_the_board_cost_to_read(dials, two_boards) -> None:
    """§5 asks for a budget per board. The number that makes one possible is written on the job."""
    asked = api.handle("curriculum.units", ASK, subject="learner-a", store=two_boards)
    plain = worker_for(two_boards, prewarm_pass=False)
    worker = worker_for(
        two_boards,
        prewarm_pass=False,
        complete_generate=costing(plain.complete_generate, 0.0125),
        complete_verify=costing(plain.complete_verify, 0.0075),
    )
    worker.tick()
    job = two_boards.get_job(asked["job_id"])
    assert job.state is JobState.STORED
    assert job.result["cost_usd"] == pytest.approx(0.02)


def test_a_run_nothing_priced_records_no_cost_rather_than_a_zero(dials, two_boards) -> None:
    """A model with no price table must never read as a board that was free to read."""
    asked = api.handle("curriculum.units", ASK, subject="learner-a", store=two_boards)
    worker_for(two_boards, prewarm_pass=False).tick()
    job = two_boards.get_job(asked["job_id"])
    assert job.result.get("cost_usd") is None


def test_one_boards_money_never_lands_on_the_next(dials, two_boards) -> None:
    first = api.handle("curriculum.units", ASK, subject="learner-a", store=two_boards)
    second = api.handle(
        "curriculum.units",
        {"framework_id": "msbshse", "level": "Class 10", "subject": "Mathematics"},
        subject="learner-b",
        store=two_boards,
    )
    plain = worker_for(two_boards, prewarm_pass=False)
    # The first board's two reads cost money; every read after them is free.
    worker = worker_for(
        two_boards,
        prewarm_pass=False,
        complete_generate=costing(plain.complete_generate, 0.09, 0.0),
        complete_verify=costing(plain.complete_verify, 0.10, 0.0),
    )
    worker.tick()
    assert two_boards.get_job(first["job_id"]).result["cost_usd"] == pytest.approx(0.19)
    assert two_boards.get_job(second["job_id"]).result["cost_usd"] == pytest.approx(0.0)
