"""The prewarm queue: the boards are read ahead of demand, biggest first.

``docs/BOARD-COLD-START.md`` §4 is the law this file holds to its word:

    *"Waiting for a first learner is the fallback, not the plan. The discovery worker runs ahead
    of demand against the boards with the most students, so that by the time anyone picks
    Maharashtra or Uttar Pradesh it is already there. The order is by student population, not
    alphabetical, and the console shows the queue, what has landed, what refused and why."*

So: the order is by population and it is editable from the console; a prewarmed board never
delays a learner who is waiting; one job per board at a time; a refusal is remembered rather than
re-paid on every tick. Nothing here needs a key, a network or a model.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from wobo_gateway.curriculum.discovery import prewarm
from wobo_gateway.curriculum.models import (
    Framework,
    FrameworkKind,
    JobState,
    Node,
    NodeKind,
    Status,
    Version,
)
from wobo_gateway.curriculum.store import InMemoryStore, Seed

LEVELS = ("Class 9", "Class 10")


def board(ident: str, name: str, region: str | None = None) -> Framework:
    return Framework(
        id=ident,
        name=name,
        kind=FrameworkKind.STATE,
        status=Status.VERIFIED,
        country="IN",
        region=region,
        levels=LEVELS,
        official_site=f"https://{ident}.example.gov.in",
    )


@pytest.fixture
def store() -> InMemoryStore:
    """The four boards at the top of the seeded order, and nothing read for any of them."""
    return InMemoryStore(
        Seed(
            frameworks=[
                board("upmsp", "Board of High School and Intermediate Education Uttar Pradesh"),
                board("bseb", "Bihar School Examination Board"),
                board("msbshse", "Maharashtra State Board"),
                board("wbbse", "West Bengal Board of Secondary Education"),
            ]
        )
    )


class Dial:
    """``ops.settings`` as the prewarm reads it: one dict, one read, no network."""

    def __init__(self, **values: Any) -> None:
        self.values = dict(values)
        self.writes: list[tuple[str, Any, str | None]] = []

    def read(self, key: str) -> Any | None:
        return self.values.get(key)

    def read_many(self, keys) -> dict[str, Any]:
        return {key: self.values[key] for key in keys if key in self.values}

    def write(self, key: str, value: Any, *, actor: str | None, note: str | None) -> None:
        self.writes.append((key, value, actor))
        if value is None:
            self.values.pop(key, None)
        else:
            self.values[key] = value


# --- the order is by student population, and it is the seed's own ---------------------------------
def test_the_seeded_order_leads_with_the_boards_that_have_the_most_students() -> None:
    ids = [entry.framework_id for entry in prewarm.SEED_ORDER]
    assert ids[:3] == ["upmsp", "bseb", "msbshse"], (
        "Uttar Pradesh, then Bihar, then Maharashtra: the order is enrolment, not the alphabet"
    )
    assert ids != sorted(ids), "an alphabetical order is the bug this exists to prevent"


def test_every_seeded_board_is_a_board_the_registry_actually_names() -> None:
    from wobo_gateway.curriculum.store import load_seed

    known = {framework.id for framework in load_seed().frameworks}
    missing = [
        entry.framework_id for entry in prewarm.SEED_ORDER if entry.framework_id not in known
    ]
    assert not missing, f"the prewarm names boards the registry does not: {missing}"


def test_the_learner_counts_only_ever_fall() -> None:
    counts = [entry.learners for entry in prewarm.SEED_ORDER]
    assert counts == sorted(counts, reverse=True)
    assert all(count > 0 for count in counts)


# --- the console edits it -------------------------------------------------------------------------
def test_the_console_can_reorder_the_queue_and_the_dial_wins(store: InMemoryStore) -> None:
    dial = Dial(**{prewarm.ORDER_KEY: ["msbshse", "upmsp"]})
    assert prewarm.order(store, settings=dial).ids == ("msbshse", "upmsp")


def test_an_edited_order_naming_a_board_we_do_not_hold_drops_it_and_says_so(
    store: InMemoryStore,
) -> None:
    dial = Dial(**{prewarm.ORDER_KEY: ["msbshse", "not-a-board", "upmsp"]})
    resolved = prewarm.order(store, settings=dial)
    assert resolved.ids == ("msbshse", "upmsp")
    assert resolved.rejected == ("not-a-board",)


def test_with_no_dial_written_the_order_is_the_seeds(store: InMemoryStore) -> None:
    resolved = prewarm.order(store, settings=Dial())
    # Only the boards this registry holds, in the seeded order.
    assert resolved.ids == ("upmsp", "bseb", "msbshse", "wbbse")
    assert resolved.source == "seed"


def test_writing_the_order_records_who_turned_it(store: InMemoryStore) -> None:
    dial = Dial()
    prewarm.set_order(["msbshse", "upmsp"], settings=dial, actor="owner@heywobo.com", store=store)
    assert dial.values[prewarm.ORDER_KEY] == ["msbshse", "upmsp"]
    assert dial.writes[0][2] == "owner@heywobo.com"


def test_an_order_naming_no_board_we_hold_is_refused_rather_than_written(
    store: InMemoryStore,
) -> None:
    dial = Dial()
    with pytest.raises(prewarm.UnknownBoard):
        prewarm.set_order(["nope"], settings=dial, actor="owner@heywobo.com", store=store)
    assert not dial.writes


# --- the plan -------------------------------------------------------------------------------------
def test_the_first_pass_takes_one_subject_from_every_board_before_a_second_from_any(
    store: InMemoryStore,
) -> None:
    plan = prewarm.plan(store, settings=Dial(), limit=99)
    assert [target.framework_id for target in plan] == ["upmsp", "bseb", "msbshse", "wbbse"]
    assert {(t.level, t.subject) for t in plan} == {prewarm.SEED_TARGETS[0]}
    assert len(plan) == 4, "one board is never given two jobs in one pass (BOARD-COLD-START §5)"

    for entry in plan:
        hold(store, entry.framework_id, entry.level, entry.subject)
    second = prewarm.plan(store, settings=Dial(), limit=99)
    assert [t.framework_id for t in second] == ["upmsp", "bseb", "msbshse", "wbbse"]
    assert {(t.level, t.subject) for t in second} == {prewarm.SEED_TARGETS[1]}, (
        "the second rung starts again at the biggest board"
    )


def test_a_subject_the_board_already_has_is_never_prewarmed_again(store: InMemoryStore) -> None:
    hold(store, "upmsp", *prewarm.SEED_TARGETS[0])
    plan = prewarm.plan(store, settings=Dial(), limit=4)
    assert [t.framework_id for t in plan] == ["bseb", "msbshse", "wbbse", "upmsp"]
    assert (plan[3].level, plan[3].subject) == prewarm.SEED_TARGETS[1], (
        "the board keeps its place in the order, it just moves on to the next subject"
    )


def test_one_job_per_board_at_a_time(store: InMemoryStore) -> None:
    level, subject = prewarm.SEED_TARGETS[0]
    store.enqueue_discovery(query="upmsp", framework_id="upmsp", level=level, subject=subject)
    plan = prewarm.plan(store, settings=Dial(), limit=4)
    assert "upmsp" not in [target.framework_id for target in plan], (
        "a board with a job in flight is not given a second one (BOARD-COLD-START §5)"
    )


def test_a_refusal_is_remembered_rather_than_paid_for_again(store: InMemoryStore) -> None:
    level, subject = prewarm.SEED_TARGETS[0]
    job = store.enqueue_discovery(query="upmsp", framework_id="upmsp", level=level, subject=subject)
    store.update_job(job.id, state=JobState.REFUSED, message="nothing official found")
    plan = prewarm.plan(store, settings=Dial(), limit=6)
    refused = [t for t in plan if t.framework_id == "upmsp" and t.subject == subject]
    assert not refused, "a board whose document could not be read is not re-fetched every tick"
    # It keeps its place in the order; the rung it refused on is the one it does not repeat.
    upmsp = next(t for t in plan if t.framework_id == "upmsp")
    assert (upmsp.level, upmsp.subject) == prewarm.SEED_TARGETS[1]


def test_a_refusal_old_enough_to_be_worth_another_look_comes_back(store: InMemoryStore) -> None:
    level, subject = prewarm.SEED_TARGETS[0]
    job = store.enqueue_discovery(query="upmsp", framework_id="upmsp", level=level, subject=subject)
    store.update_job(job.id, state=JobState.REFUSED, message="nothing official found")
    long_ago = (datetime.now(UTC) - timedelta(seconds=prewarm.REFUSAL_COOLDOWN_S + 60)).isoformat()
    store._jobs[job.id].updated_at = long_ago  # noqa: SLF001, the clock is the point of the test
    plan = prewarm.plan(store, settings=Dial(), limit=1)
    assert (plan[0].framework_id, plan[0].subject) == ("upmsp", subject)


def test_a_personal_framework_is_never_prewarmed() -> None:
    mine = Framework(
        id="mine",
        name="My own syllabus",
        kind=FrameworkKind.PERSONAL,
        status=Status.PERSONAL,
        owner_subject="learner-a",
        country="IN",
        levels=LEVELS,
    )
    store = InMemoryStore(Seed(frameworks=[mine]))
    dial = Dial(**{prewarm.ORDER_KEY: ["mine"]})
    assert prewarm.order(store, settings=dial).ids == ()
    assert prewarm.plan(store, settings=dial, limit=3) == []


def test_the_switch_is_a_dial_and_off_means_no_plan_at_all(store: InMemoryStore) -> None:
    off = Dial(**{prewarm.ENABLED_KEY: False})
    assert prewarm.enabled(settings=off) is False
    assert prewarm.plan(store, settings=off, limit=3) == []
    assert prewarm.enabled(settings=Dial()) is True, "on unless somebody turns it off"


# --- enqueueing -----------------------------------------------------------------------------------
def test_enqueued_prewarm_jobs_are_marked_as_ours_and_not_as_a_learners(
    store: InMemoryStore,
) -> None:
    made = prewarm.enqueue(store, prewarm.plan(store, settings=Dial(), limit=2))
    assert len(made) == 2
    for job in made:
        assert job.state is JobState.QUEUED
        assert job.requested_by == prewarm.REQUESTED_BY
        assert prewarm.is_prewarm(job)


def test_a_learner_who_asked_first_is_still_drained_first(store: InMemoryStore) -> None:
    """A prewarm job is queued, never claimed here, so the worker's own oldest-first drain keeps a
    waiting learner ahead of a board nobody has asked for yet."""
    level, subject = prewarm.SEED_TARGETS[0]
    learner = store.enqueue_discovery(
        query="wbbse", framework_id="wbbse", level=level, subject=subject, requested_by="learner-a"
    )
    prewarm.enqueue(store, prewarm.plan(store, settings=Dial(), limit=3))
    assert [job.id for job in store.queued_jobs(limit=10)][0] == learner.id


def test_a_learner_who_asked_last_is_still_drained_first(store: InMemoryStore) -> None:
    """The queue's lanes, not its clock (``store._queue_order``). The prewarm is a long list by
    design — every Indian board by population — so a learner arriving AFTER it was queued must
    still be the next job drained, or the first learner on Bihar waits behind two hundred boards."""
    prewarm.enqueue(store, prewarm.plan(store, settings=Dial(), limit=4))
    level, subject = prewarm.SEED_TARGETS[3]
    learner = store.enqueue_discovery(
        query="wbbse", framework_id="wbbse", level=level, subject=subject, requested_by="learner-a"
    )
    assert store.queued_jobs(limit=10)[0].id == learner.id
    assert all(prewarm.is_prewarm(job) for job in store.queued_jobs(limit=10)[1:])


def test_enqueueing_the_same_target_twice_makes_one_job(store: InMemoryStore) -> None:
    plan = prewarm.plan(store, settings=Dial(), limit=1)
    first = prewarm.enqueue(store, plan)
    second = prewarm.enqueue(store, plan)
    assert [job.id for job in first] == [job.id for job in second]


def hold(store: InMemoryStore, framework_id: str, level_name: str, subject_name: str) -> None:
    """Give a board a published syllabus for one (level, subject), the way the seed does."""
    version = Version(
        id=f"{framework_id}-v1",
        framework_id=framework_id,
        label="2026-27",
        status=Status.PROVISIONAL,
        published_at="2026-09-01T00:00:00Z",
    )
    store.put_version(version)
    level = Node(
        id=f"{framework_id}-level", version_id=version.id, kind=NodeKind.LEVEL, name=level_name
    )
    subject = Node(
        id=f"{framework_id}-subject",
        version_id=version.id,
        kind=NodeKind.SUBJECT,
        parent_id=level.id,
        name=subject_name,
    )
    store.put_nodes([level, subject])
