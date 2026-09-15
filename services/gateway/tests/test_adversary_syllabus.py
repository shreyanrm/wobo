"""The adversary of the syllabus: the proofs the review brief asked for, against the tree as it
stands (CURRICULUM.md §4, §6, §12; CURRICULUM-OBSERVER.md §5 to §7).

A child will be taught from these chapter lists in the order they say, so every test here is
written from the child's side: what is served, what is fetched, what is minted, what is left
alone. Each fails without the behaviour it names.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from test_curriculum_observer import (
    PEPPER,
    REAL_UNITS,
    build_world,
    edit,
    learners,
    reconcile_stub,
    remove,
    run,
    signal_for,
    use,
)
from test_discovery import (
    CBSE_PAGES,
    CBSE_URL,
    cbse_document,
    cbse_extraction,
    minimal_pdf,
    opener_for,
)
from test_discovery_freshness import fetch_same
from test_discovery_worker import worker_for
from wobo_gateway import spend
from wobo_gateway.curriculum import api
from wobo_gateway.curriculum import observer as obs
from wobo_gateway.curriculum.api import CurriculumError
from wobo_gateway.curriculum.discovery import worker as worker_mod
from wobo_gateway.curriculum.discovery.fetch import fetch_document
from wobo_gateway.curriculum.discovery.job import InMemoryJobStore
from wobo_gateway.curriculum.models import JobState
from wobo_gateway.curriculum.discovery import prewarm
from wobo_gateway.curriculum.store import InMemoryStore, Seed, load_seed, seed_id

CLASS_10_MATHS = {"framework_id": "cbse", "level": "Class 10", "subject": "Mathematics"}
UNIT_IV = "UNIT IV: STATISTICS AND PROBABILITY"

# Two Indian boards the seed lists but holds no syllabus for (frameworks.seed.json, no file).
LACKED = {"framework_id": "bseb", "level": "Class 10", "subject": "Mathematics"}
ANOTHER = {"framework_id": "cgbse", "level": "Class 10", "subject": "Mathematics"}


@pytest.fixture
def switched_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WOBO_DISCOVERY_WORKER", "1")
    monkeypatch.delenv("WOBO_RECHECK", raising=False)


@pytest.fixture
def registry() -> InMemoryStore:
    """The real seed: 268 frameworks, four versions, and a great many boards with nothing."""
    return InMemoryStore(load_seed())


def documents_fetched(worker) -> list[str]:
    return [u for u in worker.fetch_fn.opener.calls if not u.endswith("/robots.txt")]


def served_units(
    store: InMemoryStore, subject: str, ask: dict[str, Any] = CLASS_10_MATHS
) -> list[str]:
    out = api.handle("curriculum.units", ask, subject=subject, store=store)
    assert out["status"] == "ready", out
    return [u["name"] for u in out["units"]]


# --- a board we lack: queued, drained under budget, refused over it ------------------------------


def test_a_board_the_seed_lacks_is_queued_then_drained_into_the_registry(switched_on, registry):
    assert registry.get_framework("bseb") is not None
    assert registry.latest_version("bseb") is None

    first = api.handle("curriculum.units", LACKED, subject="learner-a", store=registry)
    assert first["status"] == "shared"
    job_id = first["job_id"]
    assert registry.get_job(job_id).state is JobState.QUEUED

    worker = worker_for(registry)
    report = worker.tick()
    assert (report.claimed, report.stored, report.spent) == (1, 1, False)
    job = registry.get_job(job_id)
    assert job.state is JobState.STORED
    assert job.result["version_id"] == seed_id("version", "bseb", "2026-27")
    # Exactly one document was read, and the next learner is served, never a second discovery.
    assert documents_fetched(worker) == [CBSE_URL]
    assert served_units(registry, "learner-b", LACKED) == [u for u, _ in REAL_UNITS]
    # Nothing a LEARNER is waiting on is left queued. The prewarm (docs/BOARD-COLD-START.md §4)
    # legitimately fills the queue behind them with boards nobody has asked for yet, and those are
    # drained on later ticks; what must never be left waiting is the person.
    assert [job for job in registry.queued_jobs() if not prewarm.is_prewarm(job)] == []
    # The seeded boards were not touched by a discovery for another board.
    assert registry.get_version(seed_id("version", "cbse", "2026-27")) is not None
    assert len(registry.all_nodes(seed_id("version", "cbse", "2026-27"))) == len(
        InMemoryStore(load_seed()).all_nodes(seed_id("version", "cbse", "2026-27"))
    )


def test_over_the_days_allowance_the_worker_refuses_and_says_so(switched_on, registry, monkeypatch):
    monkeypatch.setenv("FREE_DAILY_GENERATIONS", "1")
    first = api.handle("curriculum.units", LACKED, subject="learner-a", store=registry)
    second = api.handle("curriculum.units", ANOTHER, subject="learner-b", store=registry)
    assert first["status"] == second["status"] == "shared"

    worker = worker_for(registry)
    report = worker.tick()
    assert (report.stored, report.spent, report.left_queued) == (1, True, 1)
    assert registry.get_job(first["job_id"]).state is JobState.STORED
    left = registry.get_job(second["job_id"])
    assert left.state is JobState.QUEUED
    assert left.message == worker_mod.SPENT_LINE
    # One document for the day, not two; nothing was written for the refused board.
    assert documents_fetched(worker) == [CBSE_URL]
    assert registry.latest_version("cgbse") is None
    status = api.handle(
        "curriculum.status", {"job_id": left.id}, subject="learner-b", store=registry
    )
    assert status["message"] == worker_mod.SPENT_LINE


def test_the_spend_ceiling_refuses_the_worker_before_a_single_fetch(
    switched_on, registry, monkeypatch
):
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "1")
    spend.record(0.95, capability="test")
    asked = api.handle("curriculum.units", LACKED, subject="learner-a", store=registry)
    worker = worker_for(registry)
    report = worker.tick()
    assert report.spent and report.claimed == 0
    assert documents_fetched(worker) == []
    assert registry.get_job(asked["job_id"]).state is JobState.QUEUED


# --- poisoning the observer (CURRICULUM-OBSERVER.md §6) ------------------------------------------


def _world():
    store, version, ids = build_world()
    observer = obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)
    return store, version, ids, observer


def _quiet_readers(observer, store, ids, n: int = 12, start: int = 1000) -> None:
    """Real learners of the subject who edit nothing: the minimum-in-learners is met, so the only
    thing standing between a sockpuppet and a correction is the share."""
    for subject in learners(n, start=start):
        use(observer, store, subject, ids["STATISTICS"])


def _counting(fetches: list[str]):
    def fetch(url, **kw):
        fetches.append(url)
        return fetch_same(url, **kw)

    return fetch


def _through_the_door(store, observer, subject: str, *ops: dict[str, Any]) -> None:
    """The learner's edit as the app makes it: the overlay capability, which hands the observer
    the ops after the write (api._overlay_apply)."""
    obs.set_observer(observer)
    api.handle(
        "curriculum.overlay.apply",
        {**CLASS_10_MATHS, "ops": list(ops)},
        subject=subject,
        store=store,
    )


def test_one_account_with_a_hundred_edits_and_a_flag_is_one_vote_and_moves_nothing():
    store, version, ids, observer = _world()
    target = ids[UNIT_IV]
    _quiet_readers(observer, store, ids)
    use(observer, store, "sockpuppet", ids["STATISTICS"])
    for _ in range(50):
        edit(observer, store, "sockpuppet", version, remove(target))
        edit(
            observer,
            store,
            "sockpuppet",
            version,
            {"op": "not_in_my_school", "node_id": target, "value": True},
        )
    assert observer.observe_flag("sockpuppet", version.id, target, resolve_node=store.get_node)

    signal = signal_for(observer, version, target)
    assert signal is not None
    assert (signal.votes, signal.learners) == (1, 13)
    assert not signal.triggers
    fetches: list[str] = []
    assert run(store, observer, InMemoryJobStore(), fetch_fn=_counting(fetches)) == []
    assert fetches == [], "one account must not even cost a fetch"
    assert observer.store.actions(version.id) == []
    assert store.review_queue(state="open") == []
    assert UNIT_IV in served_units(store, "a-child")


def test_twenty_fresh_accounts_that_never_used_the_syllabus_are_no_votes_even_through_the_door():
    store, version, ids, observer = _world()
    target = ids[UNIT_IV]
    _quiet_readers(observer, store, ids)
    try:
        for subject in learners(20, start=500):
            _through_the_door(store, observer, subject, remove(target))
    finally:
        obs.set_observer(None)
    # The edits were stored for each of them (the overlay is theirs) ...
    kept = api.handle("curriculum.overlay.get", CLASS_10_MATHS, subject="learner-500", store=store)
    assert len(kept["overlay"]["ops"]) == 1
    # ... and none of them counts.
    signal = signal_for(observer, version, target)
    assert signal is None or signal.votes == 0
    fetches: list[str] = []
    assert run(store, observer, InMemoryJobStore(), fetch_fn=_counting(fetches)) == []
    assert fetches == []
    assert observer.store.actions(version.id) == []
    assert UNIT_IV in served_units(store, "a-child")


def test_an_anonymous_session_cannot_edit_and_so_cannot_vote():
    store, version, ids, observer = _world()
    with pytest.raises(CurriculumError):
        api.handle(
            "curriculum.overlay.apply",
            {**CLASS_10_MATHS, "ops": [remove(ids[UNIT_IV])]},
            subject="",
            store=store,
        )
    assert (
        observer.observe_overlay(
            "", version.id, [remove(ids[UNIT_IV])], nodes=store.all_nodes(version.id)
        )
        == 0
    )
    assert observer.observe_use("", ids["STATISTICS"], resolve_node=store.get_node) is False


def test_thirty_real_accounts_removing_a_listed_chapter_trigger_one_reread_the_document_wins():
    store, version, ids, observer = _world()
    target = ids[UNIT_IV]
    try:
        for subject in learners(30):
            use(observer, store, subject, ids["STATISTICS"])
            _through_the_door(store, observer, subject, remove(target))
    finally:
        obs.set_observer(None)
    signal = signal_for(observer, version, target)
    assert signal is not None and signal.votes == 30 and signal.triggers

    fetches: list[str] = []
    jobs = InMemoryJobStore()
    faithful = cbse_extraction(cbse_document())  # all four units, cited to page 2
    outcomes = run(
        store,
        observer,
        jobs,
        fetch_fn=_counting(fetches),
        complete_reconcile=reconcile_stub(
            faithful, {"what": "Unit IV is on the course structure", "page": 2}
        ),
    )
    # One re-read of the board's document, and the document wins: a person decides, nothing moves.
    assert fetches == [CBSE_URL]
    assert [o.action for o in outcomes] == ["queued"]
    assert jobs.all() == ()
    assert store.latest_version("cbse").id == version.id
    assert store.get_version(version.id) == version
    assert target in {n.id for n in store.all_nodes(version.id)}
    queued = store.review_queue(state="open")
    assert len(queued) == 1 and queued[0]["kind"] == "consensus"
    assert queued[0]["payload"]["signals"][0]["votes"] == 30
    assert queued[0]["payload"]["document"]["changed"] is False
    # The chapter is still taught to every new learner; a remover's own copy stays theirs (§6).
    assert UNIT_IV in served_units(store, "a-child")
    assert UNIT_IV not in served_units(store, "learner-1")


def test_a_reconciler_that_sides_with_thirty_learners_against_the_document_is_refused():
    store, version, ids, observer = _world()
    target = ids[UNIT_IV]
    for subject in learners(30):
        use(observer, store, subject, ids["STATISTICS"])
        edit(observer, store, subject, version, remove(target))
    sided = cbse_extraction(cbse_document(), units=3)  # UNIT IV gone, as the learners wanted
    jobs = InMemoryJobStore()
    outcomes = run(
        store,
        observer,
        jobs,
        complete_reconcile=reconcile_stub(sided, {"what": "Unit IV dropped", "page": 2}),
    )
    assert [o.action for o in outcomes] == ["queued"]
    assert "unit_count_vs_document" in outcomes[0].reason
    assert jobs.all() == ()
    assert UNIT_IV in served_units(store, "a-child")


# --- the opposite: a chapter the board genuinely dropped this year -------------------------------

# The same document, republished in place the same year, without unit IV.
DROPPED_PAGES = [CBSE_PAGES[0], CBSE_PAGES[1].split("UNIT IV")[0].rstrip()]
DROPPED_BODIES = {CBSE_URL: ("application/pdf", minimal_pdf(DROPPED_PAGES))}


def fetch_dropped(url, **kw):
    return fetch_document(url, opener=opener_for(DROPPED_BODIES))


def _consensus_on_a_genuine_drop(store, version, ids, observer):
    target = ids[UNIT_IV]
    for subject in learners(30):
        use(observer, store, subject, ids["STATISTICS"])
        edit(observer, store, subject, version, remove(target))

    def generate(system: str, user: str) -> tuple[str, str]:
        return json.dumps(cbse_extraction(fetch_dropped(CBSE_URL), units=3)), "generate-under-test"

    jobs = InMemoryJobStore()
    outcomes = run(store, observer, jobs, fetch_fn=fetch_dropped, complete_generate=generate)
    return jobs, outcomes


def test_consensus_plus_a_changed_hash_mints_a_successor_with_supersedes_and_a_diff():
    store, version, ids, observer = _world()
    jobs, outcomes = _consensus_on_a_genuine_drop(store, version, ids, observer)
    assert [o.action for o in outcomes] == ["reread_minted"]
    minted = jobs.get(outcomes[0].new_key)
    assert minted is not None and minted.supersedes is not None
    assert minted.provenance["document_hash"] != version.document_hash
    assert [u["title"] for u in minted.syllabus["units"]] == [u for u, _ in REAL_UNITS[:3]]
    # Same year, one revision on: never the old label, never a year the board did not state.
    assert minted.request.version == "2026-27 rev 2"
    assert any(UNIT_IV in line for line in outcomes[0].summary), outcomes[0].summary
    actions = observer.store.actions(version.id)
    assert actions[0].action == "reread_minted" and actions[0].signal["votes"] == 30
    # And the old version is byte-for-byte as it was.
    assert store.get_version(version.id) == version
    assert ids[UNIT_IV] in {n.id for n in store.all_nodes(version.id)}


def test_every_learner_overlay_re_applies_with_a_diff_after_a_consensus_mint():
    """CURRICULUM-OBSERVER.md §5.3 and §7: a consensus-minted version reaches the registry, so
    every learner overlay re-applies with a diff. Until 2026-09-05 observe_subject wrote the
    successor only into the in-memory JobStore (never persist_successor), so curriculum.upgrade
    still answered "You are on the current edition" and no overlay was re-applied; this test was
    the strict xfail that turned green when the registry write was wired in."""
    store, version, ids, observer = _world()
    try:
        _through_the_door(
            store,
            observer,
            "editor",
            {"op": "rename", "node_id": ids["UNIT II: ALGEBRA"], "name": "Algebra"},
        )
        _through_the_door(store, observer, "skipper", remove(ids[UNIT_IV]))
    finally:
        obs.set_observer(None)
    _, outcomes = _consensus_on_a_genuine_drop(store, version, ids, observer)
    assert [o.action for o in outcomes] == ["reread_minted"]

    # The registry now has a successor ...
    latest = store.latest_version("cbse")
    assert latest.id != version.id and latest.supersedes == version.id
    # ... every pinned learner is offered the diff ...
    offer = api.handle(
        "curriculum.upgrade", {"framework_id": "cbse"}, subject="editor", store=store
    )
    assert offer["upgrade_available"] is True
    assert any(UNIT_IV in json.dumps(change) for change in offer["changes"])
    # ... and their overlay re-applies, with a report of what could not carry.
    kept = api.handle(
        "curriculum.upgrade", {"framework_id": "cbse", "apply": True}, subject="editor", store=store
    )
    assert kept["overlay_kept"] == 1 and kept["overlay_dropped"] == 0
    dropped = api.handle(
        "curriculum.upgrade",
        {"framework_id": "cbse", "apply": True},
        subject="skipper",
        store=store,
    )
    assert dropped["overlay_kept"] == 0 and dropped["overlay_dropped"] == 1
    assert dropped["overlay_report"], "the learner is told the chapter they removed is gone anyway"


# --- the year boundary (§7) ----------------------------------------------------------------------


def test_last_years_consensus_counts_for_nothing_across_a_year_boundary():
    store_a, v_a, ids_a = build_world(label="2026-27", version_id="v-2026")
    store_b, v_b, ids_b = build_world(label="2027-28", version_id="v-2027")
    from test_curriculum_observer import BOARD

    store = InMemoryStore(
        Seed(
            frameworks=[BOARD],
            versions=[v_a, v_b],
            nodes=[*store_a.all_nodes(v_a.id), *store_b.all_nodes(v_b.id)],
        )
    )
    observer = obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)
    target = ids_a[UNIT_IV]
    for subject in learners(30):
        # The same thirty learners are real on BOTH years, and removed the chapter last year.
        use(observer, store, subject, ids_a["STATISTICS"])
        use(observer, store, subject, ids_b["STATISTICS"])
        edit(observer, store, subject, v_a, remove(target))
    assert signal_for(observer, v_a, target).triggers
    assert observer.signals(v_b.id) == []

    fetches: list[str] = []
    outcomes = run(
        store,
        observer,
        InMemoryJobStore(),
        fetch_fn=_counting(fetches),
        complete_reconcile=reconcile_stub(
            cbse_extraction(cbse_document()), {"what": "Unit IV is listed", "page": 2}
        ),
    )
    # One re-read, for last year only; this year is not fetched, not queued, not touched.
    assert fetches == [CBSE_URL]
    assert [(o.version_id, o.action) for o in outcomes] == [(v_a.id, "queued")]
    assert observer.store.actions(v_b.id) == []
    assert observer.signals(v_b.id) == []
    assert all(
        row["payload"]["version"]["id"] == v_a.id for row in store.review_queue(state="open")
    )
    assert ids_b[UNIT_IV] in {n.id for n in store.all_nodes(v_b.id)}
