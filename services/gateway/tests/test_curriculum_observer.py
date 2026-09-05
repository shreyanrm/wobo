"""The syllabus observer (docs/CURRICULUM-OBSERVER.md), section by section.

Every test here fails without ``curriculum/observer.py``. The fixture documents and the scripted
model come from ``test_discovery`` and ``test_discovery_freshness`` so the observer cannot drift
from what a document or a job record looks like.

The order of this file is the order of the spec, except that the poisoning tests (§6) were
written first and the counting was made to pass them: one account with a hundred edits is one
vote, twenty accounts that never used the syllabus are none, and thirty real accounts removing a
chapter the document plainly lists cannot remove it: the document wins.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from test_discovery import (
    AGREES,
    CBSE_URL,
    cbse_document,
    cbse_extraction,
    stub_completion,
)
from test_discovery_freshness import fetch_next, fetch_same
from wobo_gateway.curriculum import observer as obs
from wobo_gateway.curriculum.discovery.fetch import FetchRefused
from wobo_gateway.curriculum.discovery.job import InMemoryJobStore
from wobo_gateway.curriculum.models import (
    Framework,
    FrameworkKind,
    Node,
    NodeKind,
    Provenance,
    Status,
    Version,
)
from wobo_gateway.curriculum.store import InMemoryStore, Seed

PEPPER = b"a-test-pepper-for-the-observer"

BOARD = Framework(
    id="cbse",
    name="Central Board of Secondary Education",
    kind=FrameworkKind.NATIONAL,
    status=Status.VERIFIED,
    aliases=("CBSE",),
    country="IN",
    levels=("Class 10",),
    official_site="https://cbseacademic.nic.in",
)

# The same four units the CBSE fixture document lists on page 2 (test_discovery.CBSE_PAGES), so
# a re-read of that document agrees with this reading, unit for unit.
REAL_UNITS: list[tuple[str, list[str]]] = [
    ("UNIT I: NUMBER SYSTEMS", ["REAL NUMBERS"]),
    ("UNIT II: ALGEBRA", ["POLYNOMIALS", "PAIR OF LINEAR EQUATIONS IN TWO VARIABLES"]),
    ("UNIT III: COORDINATE GEOMETRY", ["COORDINATE GEOMETRY"]),
    ("UNIT IV: STATISTICS AND PROBABILITY", ["STATISTICS"]),
]
# A fifth unit the document does NOT list: a mis-reading a wrong extraction would have stored.
PHANTOM_UNIT = ("UNIT V: MENSURATION", ["SURFACE AREAS AND VOLUMES"])


def build_world(
    *,
    units: list[tuple[str, list[str]]] | None = None,
    label: str = "2026-27",
    version_id: str = "v1",
) -> tuple[InMemoryStore, Version, dict[str, str]]:
    """One board, one published version, one Class 10 Mathematics subtree. Returns the store,
    the version, and a name -> node id map so tests can speak in chapter names."""
    document = cbse_document()
    version = Version(
        id=version_id,
        framework_id="cbse",
        label=label,
        status=Status.PROVISIONAL,
        published_at="2026-04-01T00:00:00Z",
        document_hash=document.document_sha256,
        source_url=CBSE_URL,
    )
    ids: dict[str, str] = {}
    nodes: list[Node] = []
    provenance: list[Provenance] = []

    def add(kind: NodeKind, name: str, parent: str | None, order: int) -> str:
        ident = f"{version_id}:{kind.value}:{len(nodes)}"
        ids[name] = ident
        nodes.append(
            Node(
                id=ident,
                version_id=version_id,
                kind=kind,
                name=name,
                parent_id=parent,
                order=order,
                source_ref={"document_id": document.id, "page": 2},
            )
        )
        provenance.append(
            Provenance(
                version_id=version_id,
                node_id=ident,
                source_url=CBSE_URL,
                source_page_or_section="page 2",
                document_hash=document.document_sha256,
                fetched_at="2026-04-01T00:00:00Z",
            )
        )
        return ident

    level = add(NodeKind.LEVEL, "Class 10", None, 10)
    subject = add(NodeKind.SUBJECT, "Mathematics", level, 0)
    for order, (unit, topics) in enumerate(units or REAL_UNITS):
        unit_id = add(NodeKind.UNIT, unit, subject, order)
        for topic_order, topic in enumerate(topics):
            add(NodeKind.TOPIC, topic, unit_id, topic_order)
    store = InMemoryStore(
        Seed(frameworks=[BOARD], versions=[version], nodes=nodes, provenance=provenance)
    )
    return store, version, ids


@pytest.fixture
def world() -> tuple[InMemoryStore, Version, dict[str, str], obs.Observer]:
    store, version, ids = build_world()
    return store, version, ids, obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)


def learners(n: int, start: int = 1) -> list[str]:
    return [f"learner-{i}" for i in range(start, start + n)]


def use(observer: obs.Observer, store: InMemoryStore, subject: str, node_id: str) -> bool:
    """One turn on a topic of the syllabus: the thing that makes an account a learner."""
    return observer.observe_use(subject, node_id, resolve_node=store.get_node)


def edit(
    observer: obs.Observer,
    store: InMemoryStore,
    subject: str,
    version: Version,
    *ops: dict[str, Any],
) -> int:
    return observer.observe_overlay(
        subject, version.id, list(ops), nodes=store.all_nodes(version.id)
    )


def remove(node_id: str) -> dict[str, Any]:
    return {"op": "remove", "node_id": node_id}


def signal_for(observer: obs.Observer, version: Version, node_id: str, op: str = "remove"):
    found = [s for s in observer.signals(version.id) if s.node_id == node_id and s.op == op]
    return found[0] if found else None


def reconcile_stub(proposed: dict[str, Any] | None, *differences: dict[str, Any], **extra: Any):
    """A scripted reconciler: a proposed reading with cited differences, or cannot conclude."""
    body: dict[str, Any] = {"differences": list(differences), **extra}
    if proposed is not None:
        body["proposed"] = proposed
    return stub_completion(json.dumps(body), model="reconciler-under-test")


def run(store: InMemoryStore, observer: obs.Observer, jobs: InMemoryJobStore, **kw: Any):
    defaults: dict[str, Any] = {
        "fetch_fn": fetch_same,
        "complete_reconcile": reconcile_stub(None, cannot_conclude="not asked"),
        "complete_generate": stub_completion(json.dumps(cbse_extraction(cbse_document()))),
        "complete_verify": stub_completion(AGREES),
        "force": True,
    }
    defaults.update(kw)
    return obs.run_pass(curriculum_store=store, observer=observer, job_store=jobs, **defaults)


# --- §6 poisoning, written first ---------------------------------------------------------------


def test_one_account_with_a_hundred_edits_is_one_vote(world) -> None:
    store, version, ids, observer = world
    target = ids["UNIT IV: STATISTICS AND PROBABILITY"]
    use(observer, store, "learner-1", ids["STATISTICS"])
    for _ in range(100):
        edit(observer, store, "learner-1", version, remove(target))
    signal = signal_for(observer, version, target)
    assert signal is not None
    assert signal.votes == 1
    assert signal.learners == 1
    assert not signal.triggers


def test_twenty_accounts_that_never_used_the_syllabus_are_no_votes(world) -> None:
    store, version, ids, observer = world
    target = ids["UNIT IV: STATISTICS AND PROBABILITY"]
    for subject in learners(20):
        edit(observer, store, subject, version, remove(target))
    signal = signal_for(observer, version, target)
    # Nothing to show and nothing to trigger: an account made to vote does not count.
    assert signal is None or signal.votes == 0
    assert observer.signals(version.id) == [] or all(
        s.votes == 0 for s in observer.signals(version.id)
    )


def test_thirty_real_accounts_cannot_remove_a_chapter_the_document_lists(world) -> None:
    """The document wins. Consensus can only trigger a re-read; the re-read finds UNIT IV on
    page 2, the reconciler keeps it, the reading does not match the consensus, and a person
    decides. Nothing changes for learners."""
    store, version, ids, observer = world
    target = ids["UNIT IV: STATISTICS AND PROBABILITY"]
    for subject in learners(30):
        use(observer, store, subject, ids["STATISTICS"])
        edit(observer, store, subject, version, remove(target))
    signal = signal_for(observer, version, target)
    assert signal is not None and signal.triggers and signal.votes == 30

    jobs = InMemoryJobStore()
    document = cbse_document()
    faithful = cbse_extraction(document)  # keeps all four units, cited to page 2
    outcomes = run(
        store,
        observer,
        jobs,
        complete_reconcile=reconcile_stub(
            faithful, {"what": "Unit IV is listed on the course structure", "page": 2}
        ),
    )
    assert [o.action for o in outcomes] == ["queued"]
    assert "consensus" in outcomes[0].reason
    # A person decides: the dossier is in the review queue with the signal and the reading.
    queued = store.review_queue(state="open")
    assert len(queued) == 1 and queued[0]["kind"] == "consensus"
    assert queued[0]["payload"]["signals"][0]["votes"] == 30
    # And nothing was minted: the job store holds no successor.
    assert jobs.all() == ()


def test_a_model_that_sides_with_the_learners_against_the_document_is_still_refused(world) -> None:
    """The model never decides alone. A proposed reading that drops UNIT IV cannot be cited into
    a document that numbers four units, so the code check refuses it and a person decides."""
    store, version, ids, observer = world
    target = ids["UNIT IV: STATISTICS AND PROBABILITY"]
    for subject in learners(30):
        use(observer, store, subject, ids["STATISTICS"])
        edit(observer, store, subject, version, remove(target))
    document = cbse_document()
    sided = cbse_extraction(document, units=3)  # UNIT IV gone, as the learners wanted
    outcomes = run(
        store,
        observer,
        InMemoryJobStore(),
        complete_reconcile=reconcile_stub(sided, {"what": "Unit IV dropped", "page": 2}),
    )
    assert [o.action for o in outcomes] == ["queued"]
    assert "unit_count_vs_document" in outcomes[0].reason


# --- §3 the counts -----------------------------------------------------------------------------


def test_a_vote_is_a_keyed_digest_and_never_the_subject(world) -> None:
    store, version, ids, observer = world
    target = ids["UNIT II: ALGEBRA"]
    use(observer, store, "learner-1", ids["POLYNOMIALS"])
    edit(observer, store, "learner-1", version, remove(target))
    rows = observer.store.dump()
    assert rows, "the edit was not recorded"
    flat = json.dumps(rows)
    assert "learner-1" not in flat
    assert obs.voter_hash("learner-1", PEPPER) in flat
    # And a different pepper gives a different hash, so the digest is not a plain sha of the id.
    assert obs.voter_hash("learner-1", b"other") != obs.voter_hash("learner-1", PEPPER)


def test_a_learner_counts_once_per_node_and_op_and_last_value_wins(world) -> None:
    store, version, ids, observer = world
    target = ids["UNIT II: ALGEBRA"]
    use(observer, store, "learner-1", ids["POLYNOMIALS"])
    edit(
        observer,
        store,
        "learner-1",
        version,
        {"op": "rename", "node_id": target, "name": "Algebra one"},
    )
    edit(
        observer,
        store,
        "learner-1",
        version,
        {"op": "rename", "node_id": target, "name": "Algebra two"},
    )
    renames = [s for s in observer.signals(version.id) if s.op == "rename" and s.node_id == target]
    assert [(s.value_key, s.votes) for s in renames] == [("algebra two", 1)]


def test_a_vote_counts_only_after_real_use_and_use_may_come_later(world) -> None:
    store, version, ids, observer = world
    target = ids["UNIT II: ALGEBRA"]
    edit(observer, store, "learner-1", version, remove(target))
    assert signal_for(observer, version, target) is None
    use(observer, store, "learner-1", ids["POLYNOMIALS"])
    signal = signal_for(observer, version, target)
    assert signal is not None and signal.votes == 1


def test_not_in_my_school_and_a_flag_count_with_remove_but_are_told_apart(world) -> None:
    store, version, ids, observer = world
    target = ids["UNIT II: ALGEBRA"]
    for subject in learners(3):
        use(observer, store, subject, ids["POLYNOMIALS"])
    edit(observer, store, "learner-1", version, remove(target))
    edit(
        observer,
        store,
        "learner-2",
        version,
        {"op": "not_in_my_school", "node_id": target, "value": True},
    )
    assert observer.observe_flag("learner-3", version.id, target, resolve_node=store.get_node)
    signal = signal_for(observer, version, target)
    assert signal is not None
    assert signal.votes == 3
    assert signal.breakdown == {"remove": 1, "not_in_my_school": 1, "flag": 1}


def test_unmarking_not_in_my_school_withdraws_the_vote(world) -> None:
    store, version, ids, observer = world
    target = ids["UNIT II: ALGEBRA"]
    use(observer, store, "learner-1", ids["POLYNOMIALS"])
    edit(
        observer,
        store,
        "learner-1",
        version,
        {"op": "not_in_my_school", "node_id": target, "value": True},
    )
    assert signal_for(observer, version, target).votes == 1
    edit(
        observer,
        store,
        "learner-1",
        version,
        {"op": "not_in_my_school", "node_id": target, "value": False},
    )
    assert signal_for(observer, version, target) is None


def test_an_add_is_keyed_by_parent_and_normalised_name(world) -> None:
    store, version, ids, observer = world
    parent = ids["Mathematics"]
    for subject, name in zip(
        learners(3), ("Trigonometry", "trigonometry", "TRIGONOMETRY."), strict=True
    ):
        use(observer, store, subject, ids["POLYNOMIALS"])
        edit(
            observer,
            store,
            subject,
            version,
            {"op": "add", "parent_id": parent, "kind": "unit", "name": name},
        )
    adds = [s for s in observer.signals(version.id) if s.op == "add"]
    assert len(adds) == 1
    assert adds[0].node_id == parent and adds[0].value_key == "unit:trigonometry"
    assert adds[0].votes == 3


def test_a_learners_own_node_is_never_observed(world) -> None:
    store, version, ids, observer = world
    use(observer, store, "learner-1", ids["POLYNOMIALS"])
    recorded = edit(observer, store, "learner-1", version, remove("own:1234"))
    assert recorded == 0
    assert observer.signals(version.id) == []


def test_a_flag_with_no_node_counts_for_the_version_and_never_triggers(world) -> None:
    store, version, ids, observer = world
    for subject in learners(40):
        use(observer, store, subject, ids["POLYNOMIALS"])
        assert observer.observe_flag(subject, version.id, None, resolve_node=store.get_node)
    version_level = [s for s in observer.signals(version.id) if s.node_id is None]
    assert len(version_level) == 1 and version_level[0].votes == 40
    assert not version_level[0].triggers


# --- §4 the thresholds -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("learner_count", "removers", "expected"),
    [
        (11, 11, False),  # everybody, but below the minimum: nothing happens, ever
        (12, 4, False),  # 33%: under the share
        (12, 5, True),  # 41%: over the share, at the minimum
        (100, 34, False),  # 34%
        (100, 35, True),  # 35%: the boundary, inclusive
    ],
)
def test_remove_is_relative_with_a_minimum_in_learners(
    world, learner_count: int, removers: int, expected: bool
) -> None:
    store, version, ids, observer = world
    target = ids["UNIT IV: STATISTICS AND PROBABILITY"]
    for index, subject in enumerate(learners(learner_count)):
        use(observer, store, subject, ids["STATISTICS"])
        if index < removers:
            edit(observer, store, subject, version, remove(target))
    signal = signal_for(observer, version, target)
    assert signal is not None
    assert signal.learners == learner_count and signal.votes == removers
    assert signal.triggers is expected


@pytest.mark.parametrize(("renamers", "expected"), [(5, False), (6, True)])
def test_rename_and_reorder_need_half(world, renamers: int, expected: bool) -> None:
    store, version, ids, observer = world
    target = ids["UNIT II: ALGEBRA"]
    for index, subject in enumerate(learners(12)):
        use(observer, store, subject, ids["POLYNOMIALS"])
        if index < renamers:
            edit(
                observer,
                store,
                subject,
                version,
                {"op": "rename", "node_id": target, "name": "Algebra"},
            )
    signal = signal_for(observer, version, target, op="rename")
    assert signal is not None and signal.triggers is expected


def test_below_the_minimum_the_run_does_nothing(world) -> None:
    store, version, ids, observer = world
    target = ids["UNIT IV: STATISTICS AND PROBABILITY"]
    for subject in learners(11):
        use(observer, store, subject, ids["STATISTICS"])
        edit(observer, store, subject, version, remove(target))
    fetches: list[str] = []

    def counting_fetch(url, **kw):
        fetches.append(url)
        return fetch_same(url, **kw)

    outcomes = run(store, observer, InMemoryJobStore(), fetch_fn=counting_fetch)
    assert outcomes == []
    assert fetches == [], "below the minimum the document is not even fetched"


# --- §5 at the threshold: the four outcomes ----------------------------------------------------


def _consensus_to_drop(store, version, ids, observer, unit: str, topic: str, n: int = 30) -> str:
    target = ids[unit]
    for subject in learners(n):
        use(observer, store, subject, ids[topic])
        edit(observer, store, subject, version, remove(target))
    return target


def test_hash_changed_is_the_freshness_path_and_a_new_version_supersedes(world) -> None:
    """The board dropped a chapter and republished in place. Consensus was right because the
    world changed: the freshness path mints the successor, and the observer only records it."""
    store, version, ids, observer = world
    _consensus_to_drop(
        store, version, ids, observer, "UNIT IV: STATISTICS AND PROBABILITY", "STATISTICS"
    )
    jobs = InMemoryJobStore()
    from test_discovery_freshness import next_year_extraction

    def generate(system: str, user: str) -> tuple[str, str]:
        return json.dumps(next_year_extraction(fetch_next(CBSE_URL))), "generate-under-test"

    outcomes = run(store, observer, jobs, fetch_fn=fetch_next, complete_generate=generate)
    assert [o.action for o in outcomes] == ["reread_minted"]
    minted = jobs.get(outcomes[0].new_key)
    assert minted is not None
    assert minted.supersedes is not None
    assert minted.status == "provisional"
    # The document is the witness that decided; the reading came from it, not from the learners.
    assert minted.provenance["document_hash"] != version.document_hash
    assert outcomes[0].summary, "the learner is told what moved"
    # The observer's own record says what it did and on what signal.
    actions = observer.store.actions(version.id)
    assert actions[0].action == "reread_minted" and actions[0].signal["votes"] == 30


def test_hash_same_and_the_reconciler_agrees_mints_a_verified_successor(world) -> None:
    """Our reading carried a chapter the document does not list. Thirty learners removed it. The
    document has not changed, the reconciler proposes the four real units with page citations,
    the proposal matches the consensus, and a verified successor is minted through the same
    path the freshness job uses, provenance naming all three witnesses."""
    store, version, ids = build_world(units=[*REAL_UNITS, PHANTOM_UNIT])
    observer = obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)
    observer.set_require_review(False, by="owner@test")
    _consensus_to_drop(store, version, ids, observer, PHANTOM_UNIT[0], PHANTOM_UNIT[1][0])
    jobs = InMemoryJobStore()
    document = cbse_document()
    proposal = cbse_extraction(document)
    outcomes = run(
        store,
        observer,
        jobs,
        complete_reconcile=reconcile_stub(
            proposal,
            {"what": "The course structure lists four units; there is no unit V", "page": 2},
        ),
    )
    assert [o.action for o in outcomes] == ["reconciled_minted"]
    minted = jobs.get(outcomes[0].new_key)
    assert minted is not None and minted.supersedes is not None
    assert minted.status == "verified"
    assert [unit["title"] for unit in minted.syllabus["units"]] == [u for u, _ in REAL_UNITS]
    provenance = minted.provenance
    assert provenance["source_url"] == CBSE_URL
    assert provenance["verified_by"] == "system"
    assert provenance["consensus"]["op"] == "remove" and provenance["consensus"]["votes"] == 30
    assert provenance["reconciler_model"] == "reconciler-under-test"
    assert provenance["differences"][0]["page"] == 2
    # The diff a learner reads, in their own terms.
    assert any("UNIT V: MENSURATION" in line for line in outcomes[0].summary)


def test_the_reconciler_cannot_conclude_goes_to_a_person(world) -> None:
    store, version, ids = build_world(units=[*REAL_UNITS, PHANTOM_UNIT])
    observer = obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)
    _consensus_to_drop(store, version, ids, observer, PHANTOM_UNIT[0], PHANTOM_UNIT[1][0])
    outcomes = run(
        store,
        observer,
        InMemoryJobStore(),
        complete_reconcile=reconcile_stub(None, cannot_conclude="the scan is unreadable"),
    )
    assert [o.action for o in outcomes] == ["queued"]
    assert "cannot conclude" in outcomes[0].reason
    assert store.review_queue(state="open")[0]["payload"]["reconciliation"]["cannot_conclude"]


def test_a_difference_without_a_page_is_not_a_citation(world) -> None:
    store, version, ids = build_world(units=[*REAL_UNITS, PHANTOM_UNIT])
    observer = obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)
    observer.set_require_review(False, by="owner@test")
    _consensus_to_drop(store, version, ids, observer, PHANTOM_UNIT[0], PHANTOM_UNIT[1][0])
    outcomes = run(
        store,
        observer,
        InMemoryJobStore(),
        complete_reconcile=reconcile_stub(cbse_extraction(cbse_document()), {"what": "no unit V"}),
    )
    assert [o.action for o in outcomes] == ["queued"]
    assert "cite" in outcomes[0].reason


def test_unreachable_and_strong_consensus_mints_a_labelled_community_version(world) -> None:
    store, version, ids = build_world(units=[*REAL_UNITS, PHANTOM_UNIT])
    observer = obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)
    observer.set_require_review(False, by="owner@test")
    _consensus_to_drop(store, version, ids, observer, PHANTOM_UNIT[0], PHANTOM_UNIT[1][0], n=30)

    def gone(url, **kw):
        raise FetchRefused("http_error", "503")

    jobs = InMemoryJobStore()
    outcomes = run(store, observer, jobs, fetch_fn=gone)
    assert [o.action for o in outcomes] == ["community_minted"]
    minted = jobs.get(outcomes[0].new_key)
    assert minted is not None and minted.supersedes is not None
    assert minted.status == "community"
    assert minted.message == "Shared by another learner, not yet checked"
    assert [unit["title"] for unit in minted.syllabus["units"]] == [u for u, _ in REAL_UNITS]
    assert minted.provenance["verified_by"] == "community"
    assert minted.provenance["document_unreachable"].startswith("http_error")
    assert minted.provenance["reread_pending"] is True


def test_unreachable_and_ordinary_consensus_waits_for_a_person(world) -> None:
    """35% of twenty learners is a signal; it is not enough to publish without the document."""
    store, version, ids = build_world(units=[*REAL_UNITS, PHANTOM_UNIT])
    observer = obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)
    observer.set_require_review(False, by="owner@test")
    target = ids[PHANTOM_UNIT[0]]
    for index, subject in enumerate(learners(20)):
        use(observer, store, subject, ids[PHANTOM_UNIT[1][0]])
        if index < 8:
            edit(observer, store, subject, version, remove(target))

    def gone(url, **kw):
        raise FetchRefused("http_error", "503")

    jobs = InMemoryJobStore()
    outcomes = run(store, observer, jobs, fetch_fn=gone)
    assert [o.action for o in outcomes] == ["queued"]
    assert jobs.all() == ()


@pytest.mark.parametrize(
    ("learner_count", "expected"),
    [(29, "queued"), (30, "community_minted")],
)
def test_community_needs_thirty_learners_however_unanimous(
    learner_count: int, expected: str
) -> None:
    """Every learner agreeing is still not enough below the community minimum (§5.3)."""
    store, version, ids = build_world(units=[*REAL_UNITS, PHANTOM_UNIT])
    observer = obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)
    observer.set_require_review(False, by="owner@test")
    _consensus_to_drop(
        store, version, ids, observer, PHANTOM_UNIT[0], PHANTOM_UNIT[1][0], n=learner_count
    )

    def gone(url, **kw):
        raise FetchRefused("http_error", "503")

    outcomes = run(store, observer, InMemoryJobStore(), fetch_fn=gone)
    assert [o.action for o in outcomes] == [expected]


def test_a_correction_is_never_in_place(world) -> None:
    store, version, ids = build_world(units=[*REAL_UNITS, PHANTOM_UNIT])
    observer = obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)
    observer.set_require_review(False, by="owner@test")
    _consensus_to_drop(store, version, ids, observer, PHANTOM_UNIT[0], PHANTOM_UNIT[1][0])
    run(
        store,
        observer,
        InMemoryJobStore(),
        complete_reconcile=reconcile_stub(
            cbse_extraction(cbse_document()), {"what": "no unit V", "page": 2}
        ),
    )
    # The old version and its nodes are exactly as they were.
    assert store.get_version(version.id) == version
    assert ids[PHANTOM_UNIT[0]] in {node.id for node in store.all_nodes(version.id)}


# --- §8 the switch -----------------------------------------------------------------------------


def test_review_is_required_by_default_and_queues_a_correction_the_reconciler_agreed_with(
    world,
) -> None:
    store, version, ids = build_world(units=[*REAL_UNITS, PHANTOM_UNIT])
    observer = obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)
    assert observer.require_review() is True
    _consensus_to_drop(store, version, ids, observer, PHANTOM_UNIT[0], PHANTOM_UNIT[1][0])
    jobs = InMemoryJobStore()
    outcomes = run(
        store,
        observer,
        jobs,
        complete_reconcile=reconcile_stub(
            cbse_extraction(cbse_document()), {"what": "no unit V", "page": 2}
        ),
    )
    assert [o.action for o in outcomes] == ["queued_for_review"]
    assert jobs.all() == ()
    row = store.review_queue(state="open")[0]
    assert row["payload"]["reconciliation"]["proposed_units"] == [u for u, _ in REAL_UNITS]


# --- §7 the year -------------------------------------------------------------------------------


def test_consensus_does_not_cross_a_year_boundary() -> None:
    store_a, v_a, ids_a = build_world(label="2026-27", version_id="v-2026")
    store_b, v_b, ids_b = build_world(label="2027-28", version_id="v-2027")
    store = InMemoryStore(
        Seed(
            frameworks=[BOARD],
            versions=[v_a, v_b],
            nodes=[*store_a.all_nodes(v_a.id), *store_b.all_nodes(v_b.id)],
        )
    )
    observer = obs.Observer(obs.InMemoryObserverStore(), pepper=PEPPER)
    target = ids_a["UNIT IV: STATISTICS AND PROBABILITY"]
    for subject in learners(30):
        use(observer, store, subject, ids_a["STATISTICS"])
        edit(observer, store, subject, v_a, remove(target))
    assert signal_for(observer, v_a, target).triggers
    # The same chapter, under the same path, in next year's version: no votes at all.
    assert observer.signals(v_b.id) == []
    # And a learner of the new year who has not edited it is not counted against it either.
    use(observer, store, "learner-1", ids_b["STATISTICS"])
    assert observer.signals(v_b.id) == []


# --- the scheduler -----------------------------------------------------------------------------


def test_the_observer_is_behind_the_discovery_workers_switch(world, monkeypatch) -> None:
    store, version, ids, observer = world
    monkeypatch.delenv("WOBO_DISCOVERY_WORKER", raising=False)
    assert obs.enabled() is False
    _consensus_to_drop(
        store, version, ids, observer, "UNIT IV: STATISTICS AND PROBABILITY", "STATISTICS"
    )
    assert (
        obs.run_pass(curriculum_store=store, observer=observer, job_store=InMemoryJobStore()) == []
    )
    monkeypatch.setenv("WOBO_DISCOVERY_WORKER", "1")
    assert obs.enabled() is True


def test_a_pass_stops_at_its_own_budget(world) -> None:
    store, version, ids, observer = world
    _consensus_to_drop(
        store, version, ids, observer, "UNIT IV: STATISTICS AND PROBABILITY", "STATISTICS"
    )
    fetches: list[str] = []

    def counting_fetch(url, **kw):
        fetches.append(url)
        return fetch_same(url, **kw)

    outcomes = run(store, observer, InMemoryJobStore(), fetch_fn=counting_fetch, max_subjects=0)
    assert outcomes == [] and fetches == []


def test_the_worker_has_one_call_and_it_uses_the_apps_own_stores(world, monkeypatch) -> None:
    """The scheduler seam: the discovery worker calls ``tick`` on its cadence with its own job
    store and budget, and the observer reads the registry and the counts the app serves."""
    from wobo_gateway.curriculum import store as curriculum_store

    store, version, ids, observer = world
    curriculum_store.set_store(store)
    obs.set_observer(observer)
    try:
        _consensus_to_drop(
            store, version, ids, observer, "UNIT IV: STATISTICS AND PROBABILITY", "STATISTICS"
        )
        fetches: list[str] = []

        def counting_fetch(url, **kw):
            fetches.append(url)
            return fetch_same(url, **kw)

        monkeypatch.delenv("WOBO_DISCOVERY_WORKER", raising=False)
        assert obs.tick(InMemoryJobStore(), fetch_fn=counting_fetch) == []
        assert fetches == [], "with the worker off the observer does not even fetch"
        monkeypatch.setenv("WOBO_DISCOVERY_WORKER", "1")
        outcomes = obs.tick(
            InMemoryJobStore(),
            fetch_fn=counting_fetch,
            complete_reconcile=reconcile_stub(None, cannot_conclude="not asked"),
        )
        assert fetches, "with the worker on the document is re-read"
        assert [o.version_id for o in outcomes] == [version.id]
        assert outcomes[0].action == "queued"
        assert observer.store.actions(version.id)[0].action == "queued"
    finally:
        curriculum_store.set_store(None)
        obs.set_observer(None)
