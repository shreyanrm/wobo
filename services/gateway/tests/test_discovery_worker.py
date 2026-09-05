"""The discovery worker: the loop that drains ``discovery_jobs`` (CURRICULUM.md §4, §9, §12).

Every network and model seam is a fixture from ``test_discovery``: the search provider is the
mock, the fetcher reads the fixture PDF, and both tiers are scripted. What is asserted is what
the law asks of a worker: a queued job ends in the registry, the line a learner polls is the stage
the run is genuinely at, two workers cannot both run one job, the day's allowance and the spend
ceiling both stop it, and nothing runs unless the owner switched it on.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from test_discovery import (
    AGREES,
    CBSE_URL,
    DEFAULT_BODIES,
    cbse_document,
    cbse_extraction,
    opener_for,
    stub_completion,
)
from test_discovery_freshness import NEXT_YEAR_BODIES, next_year_extraction
from wobo_gateway import spend
from wobo_gateway.curriculum import api, labels
from wobo_gateway.curriculum.discovery import worker as worker_mod
from wobo_gateway.curriculum.discovery.fetch import FetchBudget, fetch_document
from wobo_gateway.curriculum.discovery.search import MockSearchProvider, SearchResult
from wobo_gateway.curriculum.discovery.worker import DiscoveryWorker
from wobo_gateway.curriculum.models import (
    Framework,
    FrameworkKind,
    JobState,
    Node,
    NodeKind,
    Provenance,
    Status,
    Version,
)
from wobo_gateway.curriculum.store import InMemoryStore, Seed, seed_id

BOARD = Framework(
    id="cbse",
    name="Central Board of Secondary Education",
    kind=FrameworkKind.NATIONAL,
    status=Status.VERIFIED,
    aliases=("CBSE",),
    country="IN",
    levels=("Class 9", "Class 10"),
    official_site="https://cbseacademic.nic.in",
)
ASK = {"framework_id": "cbse", "level": "Class 10", "subject": "Mathematics"}


def fetcher(bodies: dict[str, tuple[str, bytes]] | None = None):
    opener = opener_for(bodies or DEFAULT_BODIES)

    def fetch(url: str, *, budget: FetchBudget | None = None, **_: Any):
        return fetch_document(url, opener=opener, budget=budget)

    fetch.opener = opener  # type: ignore[attr-defined]
    return fetch


def worker_for(store: InMemoryStore, *, units: int = 4, results=None, **kw: Any) -> DiscoveryWorker:
    document = cbse_document()
    defaults: dict[str, Any] = {
        "search_provider": MockSearchProvider(
            [SearchResult(url=CBSE_URL)] if results is None else results
        ),
        "fetch_fn": fetcher(),
        "complete_generate": stub_completion(json.dumps(cbse_extraction(document, units=units))),
        "complete_verify": stub_completion(AGREES),
        "observer_pass": False,
        "rechecks": 0,
    }
    defaults.update(kw)
    return DiscoveryWorker(store, **defaults)


@pytest.fixture
def switched_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WOBO_DISCOVERY_WORKER", "1")
    monkeypatch.delenv("WOBO_RECHECK", raising=False)


@pytest.fixture
def store() -> InMemoryStore:
    return InMemoryStore(Seed(frameworks=[BOARD]))


def ask(store: InMemoryStore, subject: str = "learner-a") -> dict[str, Any]:
    return api.handle("curriculum.units", ASK, subject=subject, store=store)


# --- a job ends in the registry ----------------------------------------------------------------
def test_a_queued_job_is_drained_into_the_registry(switched_on, store: InMemoryStore) -> None:
    first = ask(store)
    assert first["status"] == "looking" and first["placeholder"]["state"] == "queued"
    job_id = first["placeholder"]["job_id"]

    report = worker_for(store).tick()
    assert report.claimed == 1 and report.stored == 1 and not report.spent

    job = store.get_job(job_id)
    assert job.state is JobState.STORED
    assert job.result["version_id"] == seed_id("version", "cbse", "2026-27")
    assert job.result["units"] == 4 and job.result["source_url"] == CBSE_URL
    assert job.message == labels.job_message(JobState.STORED)

    second = ask(store, "learner-b")
    assert second["status"] == "ready"
    assert [u["name"] for u in second["units"]] == [
        "UNIT I: NUMBER SYSTEMS",
        "UNIT II: ALGEBRA",
        "UNIT III: COORDINATE GEOMETRY",
        "UNIT IV: STATISTICS AND PROBABILITY",
    ]
    assert second["units"][0]["source"]["source_url"] == CBSE_URL
    assert second["version"]["label"] == "2026-27"
    assert "not yet" not in second["label"]


def test_a_second_tick_finds_nothing_to_do(switched_on, store: InMemoryStore) -> None:
    ask(store)
    worker = worker_for(store)
    worker.tick()
    again = worker.tick()
    assert again.claimed == 0 and again.stored == 0
    assert len(store.all_versions()) == 1


def test_the_line_a_learner_polls_is_the_stage_the_run_is_at(
    switched_on, store: InMemoryStore
) -> None:
    job_id = ask(store)["placeholder"]["job_id"]
    seen: list[tuple[str, str | None]] = []
    original = store.update_job

    def spy(job_id_: str, **kw: Any):
        job = original(job_id_, **kw)
        seen.append((job.state.value, job.message))
        return job

    store.update_job = spy  # type: ignore[method-assign]
    worker_for(store).tick()
    states = [state for state, _ in seen]
    assert (
        states.index("searching")
        < states.index("extracting")
        < states.index("checking")
        < states.index("stored")
    )
    assert ("searching", "Looking for the official syllabus now") in seen
    assert ("extracting", "Reading the official document now") in seen
    assert ("checking", "Checking what I read against the source") in seen
    assert (
        api.handle("curriculum.status", {"job_id": job_id}, subject="x", store=store)["state"]
        == "stored"
    )


def test_two_workers_cannot_both_run_one_job(switched_on, store: InMemoryStore) -> None:
    job_id = ask(store)["placeholder"]["job_id"]
    # Replica A claims it with the one conditional write.
    assert store.claim_job(job_id, state=JobState.SEARCHING) is not None
    assert store.claim_job(job_id, state=JobState.SEARCHING) is None
    # Replica B's tick finds nothing queued and runs nothing: no fetch, no model call.
    worker = worker_for(store)
    report = worker.tick()
    assert report.claimed == 0
    assert worker.fetch_fn.opener.calls == []  # type: ignore[attr-defined]
    assert store.get_job(job_id).state is JobState.SEARCHING


def test_a_lost_claim_refunds_the_days_allowance(
    switched_on, store: InMemoryStore, monkeypatch
) -> None:
    from wobo_gateway import budget

    job_id = ask(store)["placeholder"]["job_id"]
    store.claim_job(job_id, state=JobState.SEARCHING)
    # Make the queued read return the job anyway, as a second replica racing on a stale read would.
    monkeypatch.setattr(store, "queued_jobs", lambda *, limit=20: [store.get_job(job_id)])
    worker_for(store).tick()
    assert budget.snapshot(worker_mod.SYSTEM_SUBJECT).remaining(budget.GENERATION) == 8


# --- money ----------------------------------------------------------------------------------------
def test_the_worker_stops_when_the_days_allowance_is_spent(
    switched_on, store: InMemoryStore, monkeypatch
) -> None:
    monkeypatch.setenv("FREE_DAILY_GENERATIONS", "0")
    job_id = ask(store)["placeholder"]["job_id"]
    worker = worker_for(store)
    report = worker.tick()
    assert report.spent and report.claimed == 0 and report.left_queued == 1
    job = store.get_job(job_id)
    assert job.state is JobState.QUEUED
    assert job.message == worker_mod.SPENT_LINE
    assert worker.fetch_fn.opener.calls == []  # type: ignore[attr-defined]
    out = api.handle("curriculum.status", {"job_id": job_id}, subject="x", store=store)
    assert out["message"] == worker_mod.SPENT_LINE


def test_the_spend_ceiling_refuses_the_worker_in_the_stranger_lane(
    switched_on, store: InMemoryStore, monkeypatch
) -> None:
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "1")
    spend.record(0.95, capability="test")
    assert spend.verdict(spend.Priority.STRANGER) is spend.Verdict.REFUSE
    ask(store)
    report = worker_for(store).tick()
    assert report.spent and report.claimed == 0


def test_every_discovery_is_metered_against_the_system_never_a_learner(
    switched_on, store: InMemoryStore
) -> None:
    from wobo_gateway import budget

    ask(store, "learner-a")
    before = budget.snapshot("learner-a").remaining(budget.GENERATION)
    worker_for(store).tick()
    assert budget.snapshot("learner-a").remaining(budget.GENERATION) == before
    assert budget.snapshot(worker_mod.SYSTEM_SUBJECT).remaining(budget.GENERATION) == 7


# --- honest endings -------------------------------------------------------------------------------
def test_nothing_found_ends_in_one_plain_line_and_the_door(
    switched_on, store: InMemoryStore
) -> None:
    job_id = ask(store)["placeholder"]["job_id"]
    report = worker_for(store, results=[]).tick()
    assert report.refused == 1
    job = store.get_job(job_id)
    assert job.state is JobState.REFUSED
    assert "could not find an official syllabus" in job.message
    assert "Show me your syllabus" in job.message
    out = api.handle("curriculum.status", {"job_id": job_id}, subject="x", store=store)
    assert out["not_listed"]["action"] == "own_syllabus"
    assert store.all_versions() == []


def test_a_crash_never_leaves_a_job_open(switched_on, store: InMemoryStore) -> None:
    job_id = ask(store)["placeholder"]["job_id"]

    def boom(url: str, **_: Any):
        raise RuntimeError("the network fell over")

    report = worker_for(store, fetch_fn=boom).tick()
    assert report.failed == 1
    job = store.get_job(job_id)
    assert job.state is JobState.FAILED and not job.open
    assert job.message == labels.job_message(JobState.FAILED)


def test_a_stale_claim_is_requeued_and_a_worn_out_one_is_failed(
    switched_on, store: InMemoryStore
) -> None:
    stale_at = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    fresh_id = ask(store, "a")["placeholder"]["job_id"]
    store.claim_job(fresh_id, state=JobState.SEARCHING)
    store._jobs[fresh_id].updated_at = stale_at
    worn = api.handle("curriculum.units", {**ASK, "subject": "Science"}, subject="b", store=store)[
        "placeholder"
    ]["job_id"]
    store.claim_job(worn, state=JobState.EXTRACTING)
    store._jobs[worn].updated_at = stale_at
    store._jobs[worn].attempts = worker_mod.MAX_ATTEMPTS

    report = worker_for(store, max_jobs=0).tick()  # requeue only: nothing is drained this tick
    assert report.requeued == 1 and report.failed == 1
    assert store.get_job(fresh_id).state is JobState.QUEUED
    assert store.get_job(fresh_id).message == labels.job_message(JobState.QUEUED)
    assert store.get_job(worn).state is JobState.FAILED


def test_a_board_we_do_not_hold_is_refused_not_searched(switched_on, store: InMemoryStore) -> None:
    job = store.enqueue_discovery(
        query="Board of Nowhere", framework_id=None, level="Class 9", subject="Maths"
    )
    worker = worker_for(store)
    report = worker.tick()
    assert report.refused == 1
    assert store.get_job(job.id).state is JobState.REFUSED
    assert worker.fetch_fn.opener.calls == []  # type: ignore[attr-defined]


def test_the_stored_key_comes_back_as_the_boards_own_names(
    switched_on, store: InMemoryStore
) -> None:
    api.handle(
        "curriculum.units",
        {"framework_id": "cbse", "level": "class 10", "subject": "social science"},
        subject="a",
        store=store,
    )
    job = store.queued_jobs()[0]
    assert (job.level, job.subject) == ("class 10", "social science")
    request = worker_for(store).request_for(job, BOARD)
    assert (request.level, request.subject) == ("Class 10", "Social Science")
    assert request.official_site == BOARD.official_site


# --- the switch -----------------------------------------------------------------------------------
def test_nothing_runs_unless_the_owner_switched_it_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WOBO_DISCOVERY_WORKER", raising=False)
    assert worker_mod.enabled() is False
    assert worker_mod.start_if_enabled() is False
    assert api.discovery_worker_running() is False
    monkeypatch.setenv("WOBO_DISCOVERY_WORKER", "1")
    assert worker_mod.enabled() is True
    assert api.discovery_worker_running() is True


def test_the_loop_stops_when_told(switched_on, store: InMemoryStore) -> None:
    import threading

    stop = threading.Event()
    ticks: list[int] = []
    worker = worker_for(store)

    def tick():
        ticks.append(1)
        if len(ticks) == 2:
            stop.set()
        return worker_mod.TickReport()

    worker.tick = tick  # type: ignore[method-assign]
    worker.run_forever(stop, interval=0.01)
    assert len(ticks) == 2


# --- the freshness cadence reaches a published seed (§9) ------------------------------------------
def seeded_store(*, document_hash: str) -> tuple[InMemoryStore, Version, dict[str, str]]:
    """A version as `publish` writes it: provisional, published, every node with provenance."""
    document = cbse_document()
    version = Version(
        id=seed_id("version", "cbse", "2026-27"),
        framework_id="cbse",
        label="2026-27",
        status=Status.PROVISIONAL,
        published_at="2026-09-03T07:03:44Z",
        document_hash=document_hash,
        source_url=CBSE_URL,
    )
    nodes: list[Node] = []
    ids: dict[str, str] = {}

    def add(kind: NodeKind, name: str, parent: str | None, order: int, page: int | None = 2) -> str:
        ident = seed_id(version.id, kind.value, parent or "", name, str(order))
        nodes.append(
            Node(
                id=ident,
                version_id=version.id,
                kind=kind,
                name=name,
                parent_id=parent,
                order=order,
                source_ref={"document_id": document.id, "page": page} if page else None,
            )
        )
        ids[name] = ident
        return ident

    level = add(NodeKind.LEVEL, "Class 10", None, 10, None)
    maths = add(NodeKind.SUBJECT, "Mathematics", level, 0, None)
    for index, unit in enumerate(cbse_extraction(document)["units"]):
        unit_id = add(NodeKind.UNIT, unit["title"], maths, index)
        for t_index, topic in enumerate(unit["topics"]):
            add(NodeKind.TOPIC, topic["title"], unit_id, t_index)
    science = add(NodeKind.SUBJECT, "Science", level, 1, None)
    add(NodeKind.UNIT, "Chemical reactions", science, 0)
    provenance = [
        Provenance(
            version_id=version.id,
            node_id=node.id,
            source_url=CBSE_URL,
            document_hash=document_hash,
            fetched_at="2026-09-03T07:03:44Z",
            checks_passed=("seeded", "source_attached"),
        )
        for node in nodes
    ]
    store = InMemoryStore(
        Seed(frameworks=[BOARD], versions=[version], nodes=nodes, provenance=provenance)
    )
    return store, version, ids


def republished(*, version: str) -> dict[str, Any]:
    """The board republished the file in place: the same url, a fifth unit, a stated year."""
    document = fetch_document(CBSE_URL, opener=opener_for(NEXT_YEAR_BODIES))
    return {
        "fetch_fn": fetcher(NEXT_YEAR_BODIES),
        "complete_generate": stub_completion(
            json.dumps({**next_year_extraction(document), "version": version})
        ),
    }


def test_a_changed_document_becomes_a_successor_and_nothing_is_overwritten(switched_on) -> None:
    store, old, ids = seeded_store(document_hash=cbse_document().document_sha256)
    before = store.all_nodes(old.id)
    document = fetch_document(CBSE_URL, opener=opener_for(NEXT_YEAR_BODIES))
    worker = worker_for(store, rechecks=1, **republished(version="2026-27"))
    report = worker.tick()
    assert [r["outcome"] for r in report.rechecks] == ["new_version"]

    versions = store.all_versions()
    assert len(versions) == 2
    new = next(v for v in versions if v.id != old.id)
    assert new.supersedes == old.id and new.label == "2026-27 rev 2"
    assert new.document_hash == document.document_sha256 and new.published_at
    assert store.all_nodes(old.id) == before, "the old version was edited in place"
    # The re-read subject has the new reading; the other subject was carried forward intact.
    level = store.children(new.id, None, kind=NodeKind.LEVEL)[0]
    subjects = {n.name: n for n in store.children(new.id, level.id, kind=NodeKind.SUBJECT)}
    assert set(subjects) == {"Mathematics", "Science"}
    assert len(store.children(new.id, subjects["Mathematics"].id, kind=NodeKind.UNIT)) == 5
    carried = store.children(new.id, subjects["Science"].id, kind=NodeKind.UNIT)
    assert [u.name for u in carried] == ["Chemical reactions"]
    assert store.provenance_for(new.id, carried[0].id).source_url == CBSE_URL
    assert any("TRIGONOMETRY is new" in line for line in report.rechecks[0]["summary"])

    # A learner pinned to the old edition is OFFERED the diff, with their overlay intact (§6).
    store.put_pin("learner-p", "cbse", old.id)
    offer = api.handle(
        "curriculum.upgrade", {"framework_id": "cbse"}, subject="learner-p", store=store
    )
    assert offer["upgrade_available"] is True and offer["latest"]["id"] == new.id
    assert offer["changes"]


def test_an_unchanged_document_mints_nothing_and_the_reading_is_verified(switched_on) -> None:
    document = cbse_document()
    store, old, _ = seeded_store(document_hash=document.document_sha256)
    report = worker_for(store, rechecks=1).tick()
    assert [r["outcome"] for r in report.rechecks] == ["verified"]
    assert len(store.all_versions()) == 1
    job = store.latest_job(
        framework_id="cbse", query=BOARD.name, level="Class 10", subject="Mathematics"
    )
    assert job.state is JobState.STORED and job.result["outcome"] == "verified"
    assert "second_reader_agrees" in job.result["checks_passed"]


def test_the_cadence_checks_one_subject_a_tick_and_never_the_same_one_twice(switched_on) -> None:
    document = cbse_document()
    store, _, _ = seeded_store(document_hash=document.document_sha256)
    worker = worker_for(store, rechecks=1)
    first = worker.tick()
    second = worker.tick()
    third = worker.tick()
    checked = [(r["subject"]) for r in first.rechecks + second.rechecks + third.rechecks]
    assert sorted(checked) == ["Mathematics", "Science"], "each stored subject once, one per tick"


def test_a_new_year_keeps_the_documents_own_label(switched_on) -> None:
    store, old, _ = seeded_store(document_hash=cbse_document().document_sha256)
    worker = worker_for(store, rechecks=1, **republished(version="2027-28"))
    worker.tick()
    new = next(v for v in store.all_versions() if v.id != old.id)
    assert new.label == "2027-28" and new.supersedes == old.id


# --- the claim over PostgREST ---------------------------------------------------------------------
def test_the_postgrest_claim_is_one_conditional_write_and_walks_away_when_it_misses() -> None:
    """Two replicas, one row: the claim is ``id = ? and state = 'queued'`` in the database, and an
    empty answer means somebody else has it."""
    import json as json_mod

    from wobo_gateway.curriculum.store import PostgrestStore

    calls: list[tuple[str, str, dict[str, str], Any]] = []
    queued = {"id": "j1", "query": "cbse", "state": "queued", "attempts": 0, "framework_id": "cbse"}
    answers = {
        "GET": (200, [queued]),
        "PATCH": (200, [{**queued, "state": "searching", "attempts": 1}]),
    }

    def transport(method: str, url: str, headers: dict[str, str], body: bytes | None):
        calls.append((method, url, headers, json_mod.loads(body) if body else None))
        return answers[method]

    store = PostgrestStore("https://p.supabase.co", "service-role-key", transport=transport)
    won = store.claim_job(
        "j1", state=JobState.SEARCHING, message="Looking for the official syllabus now"
    )
    assert won is not None and won.state is JobState.SEARCHING and won.attempts == 1
    method, url, headers, body = calls[-1]
    assert method == "PATCH" and "id=eq.j1" in url and "state=eq.queued" in url
    assert body["state"] == "searching" and body["attempts"] == 1 and body["started_at"]
    assert headers["Content-Profile"] == "curriculum"

    answers["PATCH"] = (200, [])  # the other replica got there first
    assert store.claim_job("j1", state=JobState.SEARCHING) is None
