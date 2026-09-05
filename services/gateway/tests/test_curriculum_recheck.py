"""First selection verifies from the web (docs/CURRICULUM-OBSERVER.md §2).

The first time any learner selects a provisional (board, class, subject), the stored reading is
checked against the board's own document before its chapters are shown, with an honest line while
that runs; the second learner is served what the check found. If the document cannot be reached,
the provisional reading is shown, marked so in one plain line, with the own-syllabus door open.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from test_discovery import (
    AGREES,
    CBSE_PAGES,
    CBSE_URL,
    cbse_document,
    cbse_extraction,
    minimal_pdf,
    opener_for,
    stub_completion,
)
from test_discovery_freshness import NEXT_YEAR_BODIES, next_year_extraction
from wobo_gateway.curriculum import api, recheck
from wobo_gateway.curriculum.discovery.fetch import FetchBudget, FetchRefused, fetch_document
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
VERIFIED_LABEL = "Official Central Board of Secondary Education 2026-27, verified"


class Collector:
    """A runner that holds the check until the test says go, so "while it runs" is observable."""

    def __init__(self) -> None:
        self.pending: list[Callable[[], None]] = []

    def __call__(self, fn: Callable[[], None]) -> None:
        self.pending.append(fn)

    def go(self) -> int:
        ran = 0
        while self.pending:
            self.pending.pop(0)()
            ran += 1
        return ran


def fetcher(bodies: dict[str, tuple[str, bytes]]):
    opener = opener_for(bodies)

    def fetch(url: str, *, budget: FetchBudget | None = None, **_: Any):
        return fetch_document(url, opener=opener, budget=budget)

    fetch.opener = opener  # type: ignore[attr-defined]
    return fetch


def build(
    *,
    status: Status = Status.PROVISIONAL,
    document_id: str | None = None,
    extra_unit: str | None = None,
    document_hash: str | None = None,
) -> tuple[InMemoryStore, Version]:
    """One provisional version whose Mathematics reading is the CBSE fixture, as the seed
    stores it: every node cites a page of the document, every node carries provenance."""
    document = cbse_document()
    cited = document_id or document.id
    version = Version(
        id=seed_id("version", "cbse", "2026-27"),
        framework_id="cbse",
        label="2026-27",
        status=status,
        published_at="2026-09-03T07:03:44Z",
        document_hash=document_hash or document.document_sha256,
        source_url=CBSE_URL,
    )
    nodes: list[Node] = []

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
                source_ref={"document_id": cited, "page": page} if page else None,
            )
        )
        return ident

    level = add(NodeKind.LEVEL, "Class 10", None, 10, None)
    maths = add(NodeKind.SUBJECT, "Mathematics", level, 0, None)
    units = cbse_extraction(document)["units"]
    if extra_unit:
        units = [*units, {"title": extra_unit, "topics": [{"title": "Wyverns"}]}]
    for index, unit in enumerate(units):
        unit_id = add(NodeKind.UNIT, unit["title"], maths, index)
        for t_index, topic in enumerate(unit["topics"]):
            add(NodeKind.TOPIC, topic["title"], unit_id, t_index)
    provenance = [
        Provenance(
            version_id=version.id,
            node_id=node.id,
            source_url=CBSE_URL,
            document_hash=version.document_hash,
            fetched_at="2026-09-03T07:03:44Z",
        )
        for node in nodes
    ]
    return InMemoryStore(
        Seed(frameworks=[BOARD], versions=[version], nodes=nodes, provenance=provenance)
    ), version


@pytest.fixture
def on(monkeypatch: pytest.MonkeyPatch) -> Collector:
    monkeypatch.setenv("WOBO_RECHECK", "1")
    monkeypatch.delenv("WOBO_DISCOVERY_WORKER", raising=False)
    collector = Collector()
    fetch = fetcher({CBSE_URL: ("application/pdf", minimal_pdf(CBSE_PAGES))})
    recheck.set_runner(collector, fetch_fn=fetch, complete_verify=stub_completion(AGREES))
    collector.fetch = fetch  # type: ignore[attr-defined]
    yield collector
    recheck.set_runner(None)


def ask(store: InMemoryStore, subject: str = "learner-a", **extra: Any) -> dict[str, Any]:
    return api.handle("curriculum.units", {**ASK, **extra}, subject=subject, store=store)


def fetches(collector: Collector) -> int:
    return sum(1 for url in collector.fetch.opener.calls if not url.endswith("robots.txt"))  # type: ignore[attr-defined]


# --- the first learner, and the second ------------------------------------------------------------
def test_the_first_selection_checks_before_showing_the_chapters_and_says_so(on: Collector) -> None:
    store, version = build()
    first = ask(store, "learner-a")
    assert first["status"] == "checking"
    assert first["units"] == [], "the chapter list waits for the check"
    assert first["label"] == recheck.CHECKING_LINE
    assert first["placeholder"]["state"] == "checking"
    assert first["not_listed"]["action"] == "own_syllabus"
    job = store.get_job(first["placeholder"]["job_id"])
    assert job.state is JobState.CHECKING and job.result["kind"] == "recheck"
    polled = api.handle("curriculum.status", {"job_id": job.id}, subject="learner-a", store=store)
    assert polled["message"] == recheck.CHECKING_LINE and polled["job"]["open"] is True

    assert on.go() == 1
    assert fetches(on) == 1

    second = ask(store, "learner-b")
    assert second["status"] == "ready"
    assert len(second["units"]) == 4
    assert second["label"] == VERIFIED_LABEL
    assert second["check"]["state"] == "verified"
    assert "second_reader_agrees" in second["check"]["checks_passed"]
    assert second["check"]["verified_at"]
    assert "not_listed" not in second

    ask(store, "learner-c")
    assert fetches(on) == 1, "the second learner is served the verified reading, not a second check"
    assert store.get_job(job.id).state is JobState.STORED


def test_the_seeds_own_document_ids_verify_against_the_fetched_document(on: Collector) -> None:
    """A stored source_ref names the document by the id its file gave it (`cbse-10-maths`); the
    fetched document is keyed by URL. The check maps one onto the other rather than calling every
    node "cites another document"."""
    store, _ = build(document_id="cbse-10-maths")
    ask(store)
    on.go()
    assert ask(store, "learner-b")["check"]["state"] == "verified"


def test_two_learners_at_once_start_one_check(on: Collector) -> None:
    store, _ = build()
    a = ask(store, "learner-a")
    b = ask(store, "learner-b")
    assert a["status"] == b["status"] == "checking"
    assert a["placeholder"]["job_id"] == b["placeholder"]["job_id"]
    assert len(on.pending) == 1


# --- the honest endings ---------------------------------------------------------------------------
def test_an_unreachable_document_serves_the_provisional_reading_marked_so(on: Collector) -> None:
    store, _ = build()

    def gone(url: str, **_: Any):
        raise FetchRefused("http_error", "503")

    recheck.set_runner(on, fetch_fn=gone, complete_verify=stub_completion(AGREES))
    ask(store)
    on.go()
    out = ask(store, "learner-b")
    assert out["status"] == "ready" and len(out["units"]) == 4
    assert out["check"]["state"] == "provisional"
    assert out["label"] == recheck.UNREACHABLE_LINE
    assert out["label"].startswith("Found on the board's site, still checking")
    assert out["not_listed"]["action"] == "own_syllabus"
    job = store.latest_job(
        framework_id="cbse", query=BOARD.name, level="Class 10", subject="Mathematics"
    )
    assert job.state is JobState.FAILED and job.result["outcome"] == "unreachable"


def test_a_reading_that_does_not_match_the_document_stays_provisional_and_is_queued(
    on: Collector,
) -> None:
    store, version = build(extra_unit="UNIT IX: DRAGONS AND WYVERNS")
    ask(store)
    on.go()
    out = ask(store, "learner-b")
    assert out["check"]["state"] == "provisional"
    assert out["label"] == recheck.MISMATCH_LINE
    assert len(out["units"]) == 5, "the stored reading is shown, marked, never silently trimmed"
    queue = store.review_queue(state="open")
    assert (
        len(queue) == 1 and queue[0]["kind"] == "recheck" and queue[0]["version_id"] == version.id
    )
    assert queue[0]["reason"].startswith("recheck: ")


def test_a_changed_document_becomes_a_successor_the_old_edition_stands(on: Collector) -> None:
    store, old = build()
    document = fetch_document(CBSE_URL, opener=opener_for(NEXT_YEAR_BODIES))
    recheck.set_runner(
        on,
        fetch_fn=fetcher(NEXT_YEAR_BODIES),  # the board republished the file in place
        complete_generate=stub_completion(
            json.dumps({**next_year_extraction(document), "version": "2026-27"})
        ),
        complete_verify=stub_completion(AGREES),
    )
    api.handle(
        "curriculum.pin",
        {"framework_id": "cbse", "version_id": old.id},
        subject="learner-p",
        store=store,
    )
    ask(store, "learner-p")
    on.go()

    pinned = ask(store, "learner-p")
    assert pinned["version"]["id"] == old.id and len(pinned["units"]) == 4
    assert pinned["check"]["state"] == "moved" and pinned["label"] == recheck.MOVED_LINE
    new_id = pinned["check"]["new_version_id"]
    assert store.get_version(new_id).supersedes == old.id
    offer = api.handle(
        "curriculum.upgrade", {"framework_id": "cbse"}, subject="learner-p", store=store
    )
    assert offer["upgrade_available"] is True and offer["latest"]["id"] == new_id

    fresh = ask(store, "learner-b")  # unpinned: the latest edition, discovery's own checks read it
    assert fresh["version"]["id"] == new_id and len(fresh["units"]) == 5
    assert store.get_version(new_id).label == "2026-27 rev 2"
    assert fresh["check"]["state"] == "provisional"
    assert len(on.pending) == 0, "the successor is not re-checked the moment it is minted"


def test_a_spent_allowance_serves_the_provisional_reading_at_once(
    on: Collector, monkeypatch
) -> None:
    monkeypatch.setenv("FREE_DAILY_GENERATIONS", "0")
    store, _ = build()
    out = ask(store)
    assert out["status"] == "ready" and len(out["units"]) == 4
    assert out["check"]["state"] == "provisional" and out["label"] == recheck.SPENT_LINE
    assert out["not_listed"]["action"] == "own_syllabus"
    assert on.pending == [] and fetches(on) == 0
    assert (
        store.latest_job(
            framework_id="cbse", query=BOARD.name, level="Class 10", subject="Mathematics"
        )
        is None
    )


def test_the_check_is_metered_against_the_system_never_the_learner(on: Collector) -> None:
    from wobo_gateway import budget

    store, _ = build()
    ask(store, "learner-a")
    assert budget.snapshot("learner-a").remaining(budget.GENERATION) == 8
    assert budget.snapshot(recheck.SYSTEM_SUBJECT).remaining(budget.GENERATION) == 7


def test_a_check_that_died_is_taken_over_by_the_next_selection(on: Collector) -> None:
    store, _ = build()
    job_id = ask(store, "learner-a")["placeholder"]["job_id"]
    on.pending.clear()  # the process that held it is gone
    store._jobs[job_id].updated_at = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    again = ask(store, "learner-b")
    assert again["status"] == "checking" and len(on.pending) == 1
    on.go()
    assert ask(store, "learner-c")["check"]["state"] == "verified"


# --- what is never checked, and what is never said ------------------------------------------------
def test_a_verified_version_is_served_without_a_check(on: Collector) -> None:
    store, _ = build(status=Status.VERIFIED)
    out = ask(store)
    assert out["status"] == "ready" and "check" not in out and on.pending == []


def test_nothing_learner_facing_names_a_model(on: Collector) -> None:
    store, _ = build()
    ask(store)
    on.go()
    out = ask(store, "learner-b")
    assert "test-model" not in json.dumps(out)
    polled = api.handle(
        "curriculum.status",
        {"framework_id": "cbse", "level": "Class 10", "subject": "Mathematics"},
        subject="x",
        store=store,
    )
    assert "test-model" not in json.dumps(polled)


def test_the_lines_keep_the_register() -> None:
    for line in (
        recheck.CHECKING_LINE,
        recheck.UNREACHABLE_LINE,
        recheck.MISMATCH_LINE,
        recheck.SPENT_LINE,
        recheck.MOVED_LINE,
    ):
        assert "!" not in line and "\u2014" not in line
        assert line[0].isupper()


@pytest.mark.parametrize(
    ("env", "mode", "expected"),
    [
        (None, None, False),
        (None, "mock", False),
        (None, "live", True),
        ("1", "mock", True),
        ("0", "live", False),
    ],
)
def test_the_check_is_off_in_mock_mode_unless_asked_for_by_name(
    monkeypatch: pytest.MonkeyPatch, env: str | None, mode: str | None, expected: bool
) -> None:
    for name, value in (("WOBO_RECHECK", env), ("LLM_MODE", mode)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    assert recheck.enabled() is expected


def test_with_the_check_off_the_chapters_are_served_as_before(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("WOBO_RECHECK", raising=False)
    monkeypatch.delenv("LLM_MODE", raising=False)
    store, _ = build()
    out = ask(store)
    assert out["status"] == "ready" and len(out["units"]) == 4 and "check" not in out
