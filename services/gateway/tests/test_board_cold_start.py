"""The first learner on a board never sees an empty shelf (docs/BOARD-COLD-START.md).

268 boards are named in the registry and four carry a syllabus. Today a learner from Maharashtra
finds their board named, asks for Class 9 Science, and is handed the sentence "no syllabus stored
yet" and a search that no worker will ever run. This file is the law of what happens instead, and
every test here is one clause of it:

1. picking a board we hold nothing for starts the discovery job in that instant, at the head of
   the queue, and ONE job serves every learner who picks it in the same minute;
2. the learner waits at most about eight seconds, and the wait never says what it is doing;
3. if the syllabus has not landed they start anyway, on the class-and-subject plan every board
   shares, because the concept cores are board-agnostic (docs/LEARNING-MODEL.md);
4. when their board's syllabus lands the climb re-anchors quietly — same progress, same concepts,
   the board's order and the board's names, nothing announced;
5. every learner after them arrives instantly;
6. the phrase "no syllabus" reaches no learner surface, on the gateway or in the app.

Nothing here needs a key, a network or a model call.
"""

from __future__ import annotations

import threading
from typing import Any

import pytest
from wobo_gateway.curriculum import api, coldstart, labels
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

# A board the registry names and holds nothing for. Maharashtra is the real case: the largest
# state board in the country, named in `frameworks.seed.json`, with not one chapter behind it.
COLD = Framework(
    id="msbshse",
    name="Maharashtra State Board of Secondary and Higher Secondary Education",
    kind=FrameworkKind.STATE,
    status=Status.VERIFIED,
    aliases=("MSBSHSE", "Maharashtra board"),
    country="IN",
    levels=("Class 9", "Class 10"),
)

LEVEL = "Class 9"
SUBJECT = "Science"
LEARNER = "learner-1"


@pytest.fixture
def store() -> InMemoryStore:
    return InMemoryStore(Seed(frameworks=[COLD]))


def units(store: InMemoryStore, subject: str = LEARNER) -> dict[str, Any]:
    return api.handle(
        "curriculum.units",
        {"framework_id": COLD.id, "level": LEVEL, "subject": SUBJECT},
        subject=subject,
        store=store,
    )


def strings(value: Any) -> list[str]:
    """Every string anywhere in a response — the only honest way to scan what a learner reads."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in strings(v)]
    if isinstance(value, (list, tuple)):
        return [s for v in value for s in strings(v)]
    return []


# --- 1. the wait's ceiling -----------------------------------------------------------------------


def test_the_wait_is_at_most_about_eight_seconds() -> None:
    """The law's number. A first extraction is 30 seconds to a few minutes, so the learner is
    never held to it — eight seconds is the whole budget of their patience."""
    assert coldstart.WAIT_CEILING_S <= 8.0
    assert int(coldstart.WAIT_CEILING_S * 1000) == coldstart.WAIT_CEILING_MS


def test_the_ceiling_is_on_the_wire_so_the_client_cannot_invent_its_own(
    store: InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With a worker draining the queue, which is what the wait is for: the syllabus can land
    inside the window. What happens when it cannot is section 8 below, and it is not a wait."""
    monkeypatch.setenv("WOBO_DISCOVERY_WORKER", "1")
    out = units(store)
    assert out["wait_ms"] == coldstart.WAIT_CEILING_MS
    assert 0 < out["wait_ms"] <= 8000


def test_the_app_waits_to_the_same_number_the_gateway_sends() -> None:
    """One ceiling, not two. The client owns the clock — a gateway that blocked for eight seconds
    would hold a thread per waiting learner — so the number it counts to is checked against this
    one rather than trusted."""
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[3] / "apps/web-pwa/src/curriculum/StatusCard.tsx"
    ).read_text()
    assert f"WAIT_CEILING_MS = {coldstart.WAIT_CEILING_MS}" in source


# --- 2. the fall-through to the shared plan ------------------------------------------------------


def test_a_board_we_hold_nothing_for_starts_the_learner_anyway(store: InMemoryStore) -> None:
    out = units(store)
    assert out["status"] == "shared"
    plan = out["plan"]
    assert plan["concepts"], "a learner on a cold board was handed nothing to learn"
    assert all(item["name"] for item in plan["concepts"])


def test_the_shared_plan_names_no_chapter_and_claims_no_board(store: InMemoryStore) -> None:
    """Chapters and topics come from the board (docs/LEARNING-MODEL.md §1). The shared plan is
    concepts — ours, board-agnostic — so it can never be mistaken for this board's syllabus."""
    out = units(store)
    assert out["units"] == []
    for item in out["plan"]["concepts"]:
        assert item["concept_id"]
        assert "unit" not in item and "chapter" not in item
    assert out["plan"]["source"] == "shared"
    assert COLD.name not in " ".join(strings(out["plan"]))


def test_the_shared_plan_is_the_same_plan_for_two_different_cold_boards() -> None:
    """"The class-and-subject plan EVERY board shares" — if it differed by board it would be a
    guess at that board's syllabus, which is the thing we never do."""
    one = coldstart.shared_plan(LEVEL, SUBJECT)
    two = coldstart.shared_plan(LEVEL, SUBJECT)
    assert [c.concept_id for c in one.concepts] == [c.concept_id for c in two.concepts]
    assert one.concepts


def test_every_school_class_and_the_common_subjects_have_a_plan_to_start_on() -> None:
    thin: list[str] = []
    for level in (f"Class {n}" for n in range(6, 13)):
        for subject in ("Mathematics", "Science", "Social Science"):
            plan = coldstart.shared_plan(level, subject)
            if len(plan.concepts) < coldstart.MIN_PLAN:
                thin.append(f"{level} {subject}: {len(plan.concepts)}")
    assert not thin, f"nothing to start these learners on: {thin}"


def test_the_plan_never_opens_with_a_section_heading() -> None:
    """The concept graph is built out of real syllabi, so it holds real rows that are headings
    rather than things to learn — "Applications", "Word problems". They are right in the graph and
    wrong at the top of a child's first climb, so the plan drops them and nothing else does."""
    for level in ("Class 8", "Class 10"):
        for subject in ("Mathematics", "Science"):
            names = {c.name.casefold() for c in coldstart.shared_plan(level, subject).concepts}
            found = names & coldstart._HEADINGS
            assert not found, f"{level} {subject}: {found}"


# --- 3. the job: one for everyone, at the head of the queue --------------------------------------


def test_picking_the_board_starts_the_job_in_that_instant(store: InMemoryStore) -> None:
    units(store)
    job = store.latest_job(
        framework_id=COLD.id, query=COLD.name, level=LEVEL, subject=SUBJECT
    )
    assert job is not None, "nobody went looking for this board's syllabus"
    assert job.requested_by == LEARNER


def test_ten_learners_in_the_same_minute_wait_on_one_job(store: InMemoryStore) -> None:
    seen: list[str] = []
    lock = threading.Lock()
    ready = threading.Barrier(10)

    def pick(n: int) -> None:
        ready.wait(timeout=5)
        out = units(store, subject=f"learner-{n}")
        with lock:
            seen.append(str(out["job_id"]))

    threads = [threading.Thread(target=pick, args=(n,)) for n in range(10)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
    assert len(seen) == 10
    assert len(set(seen)) == 1, f"ten learners started {len(set(seen))} paid discoveries"


def test_a_learner_waiting_on_it_puts_the_job_at_the_head_of_the_queue(
    store: InMemoryStore,
) -> None:
    """Prewarm runs ahead of demand (§4), so the queue is rarely empty. A learner sitting in front
    of an eight-second wait does not go behind Andorra."""
    store.enqueue_discovery(query="Some prewarmed board", framework_id="prewarm", level="Class 6")
    units(store)
    queued = store.queued_jobs(limit=10)
    assert queued, "the job was not queued at all"
    assert queued[0].framework_id == COLD.id, "the waiting learner queued behind a prewarm job"


# --- 4. the second learner arrives instantly -----------------------------------------------------


def published(store: InMemoryStore) -> None:
    """What the discovery job lands: the board's own version, chapters and topics, with the
    concept ids the extraction attached."""
    store.put_version(
        Version(
            id="msb-2026",
            framework_id=COLD.id,
            label="2026-27",
            status=Status.PROVISIONAL,
            published_at="2026-09-01T00:00:00Z",
        )
    )
    store.put_nodes(board_nodes())


def board_nodes() -> list[Node]:
    def n(
        ident: str,
        kind: NodeKind,
        name: str,
        parent: str | None,
        order: int = 0,
        concepts: tuple[str, ...] = (),
    ) -> Node:
        return Node(
            id=ident,
            version_id="msb-2026",
            kind=kind,
            name=name,
            parent_id=parent,
            order=order,
            concept_ids=concepts,
            source_ref={"page": 7, "section": name},
        )

    return [
        n("lvl", NodeKind.LEVEL, LEVEL, None, 9),
        n("sub", NodeKind.SUBJECT, SUBJECT, "lvl"),
        n("u1", NodeKind.UNIT, "Laws of Motion", "sub", 0),
        n("u2", NodeKind.UNIT, "Matter in Our Surroundings", "sub", 1),
    ]


def test_the_second_learner_arrives_instantly(store: InMemoryStore) -> None:
    units(store)  # the first learner pays the wait
    published(store)
    out = units(store, subject="learner-2")
    assert out["status"] == "ready"
    assert [u["name"] for u in out["units"]] == ["Laws of Motion", "Matter in Our Surroundings"]
    assert out["wait_ms"] == 0
    assert out.get("plan") is None


def test_the_board_landing_hands_back_the_anchors_for_the_climb_already_made(
    store: InMemoryStore,
) -> None:
    """The wire half of the quiet re-anchor: the learner who started on the shared plan asks once,
    when their board finally answers, which of the concepts they climbed is which chapter here."""
    units(store)
    published(store)
    store.put_nodes(
        [
            Node(
                id="t1",
                version_id="msb-2026",
                kind=NodeKind.TOPIC,
                name="Newton's Second Law",
                parent_id="u1",
                order=0,
                concept_ids=(coldstart.shared_plan(LEVEL, SUBJECT).concepts[0].concept_id,),
            )
        ]
    )
    plain = api.handle(
        "curriculum.units",
        {"framework_id": COLD.id, "level": LEVEL, "subject": SUBJECT},
        subject="learner-2",
        store=store,
    )
    assert "anchors" not in plain, "the walk over every topic is not on the hot path"

    out = api.handle(
        "curriculum.units",
        {"framework_id": COLD.id, "level": LEVEL, "subject": SUBJECT, "anchor": True},
        subject="learner-2",
        store=store,
    )
    assert out["status"] == "ready"
    assert [a["node_id"] for a in out["anchors"]] == ["t1"]
    assert out["anchors"][0]["name"] == "Newton's Second Law"
    # And still nothing is said about any of it.
    said = " ".join(strings(out)).casefold()
    assert "re-anchor" not in said and "moved" not in said


# --- 5. the quiet re-anchor ----------------------------------------------------------------------


def test_the_climb_re_anchors_to_the_board_with_every_step_of_progress_kept() -> None:
    plan = coldstart.SharedPlan(
        level=LEVEL,
        subject=SUBJECT,
        concepts=(
            coldstart.SharedConcept("laws-of-motion", "Laws of motion", boards=4, order=0),
            coldstart.SharedConcept("atoms", "Atoms", boards=3, order=1),
            coldstart.SharedConcept("sound", "Sound", boards=2, order=2),
        ),
    )
    # The board teaches them in its own order, under its own names, and does not name "sound".
    nodes = [
        Node(
            id="b-atoms",
            version_id="v",
            kind=NodeKind.TOPIC,
            name="Atoms and Molecules",
            parent_id="u2",
            order=0,
            concept_ids=("atoms",),
        ),
        Node(
            id="b-motion",
            version_id="v",
            kind=NodeKind.TOPIC,
            name="Newton's Laws",
            parent_id="u1",
            order=1,
            concept_ids=("laws-of-motion",),
        ),
    ]
    progress = {"laws-of-motion": "mastered", "sound": "started"}

    out = coldstart.reanchor(plan, nodes, progress)

    # Same progress: nothing the learner did is lost, and the board's node now carries it.
    assert out.progress["b-motion"] == "mastered"
    # Same concepts, the board's order and the board's names.
    assert [a.node_id for a in out.anchors] == ["b-atoms", "b-motion"]
    assert [a.name for a in out.anchors] == ["Atoms and Molecules", "Newton's Laws"]
    # A concept the board does not name keeps its progress under the concept it was learned as.
    assert out.kept["sound"] == "started"
    # Nothing is announced (docs/BOARD-COLD-START.md §2).
    assert out.announcements == ()


def test_nothing_the_learner_did_is_dropped_by_the_re_anchor() -> None:
    plan = coldstart.shared_plan(LEVEL, SUBJECT)
    progress = {item.concept_id: "mastered" for item in plan.concepts[:5]}
    out = coldstart.reanchor(plan, [], progress)
    assert set(out.kept) == set(progress), "a re-anchor onto a board that named nothing lost work"
    assert out.announcements == ()


# --- 6. the phrase leaves the product ------------------------------------------------------------

BANNED = ("no syllabus", "syllabus stored yet")


def test_the_cold_board_response_never_says_no_syllabus(store: InMemoryStore) -> None:
    said = " ".join(strings(units(store))).casefold()
    for phrase in BANNED:
        assert phrase not in said, f"the learner was told: {phrase!r}"


def test_the_board_search_never_says_no_syllabus(store: InMemoryStore) -> None:
    out = api.handle("curriculum.search", {"q": "maharashtra"}, subject=LEARNER, store=store)
    assert [r["id"] for r in out["results"]] == [COLD.id]
    said = " ".join(strings(out)).casefold()
    for phrase in BANNED:
        assert phrase not in said, f"the board list said: {phrase!r}"


def test_no_label_the_gateway_can_produce_contains_the_phrase() -> None:
    every = [
        *labels.all_labels().values(),
        labels.label_for(COLD, None),
        labels.label_for(COLD, Version(id="v", framework_id=COLD.id, label="2026-27")),
    ]
    for line in every:
        assert all(phrase not in line.casefold() for phrase in BANNED), line


def test_the_phrase_is_in_no_learner_facing_string_in_the_app() -> None:
    """A scan of the strings the app can render, not of its comments: a quoted string in any
    surface under `src/` that a learner can reach."""
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    offenders: list[str] = []
    files = [
        *(root / "apps/web-pwa/src").rglob("*.ts"),
        *(root / "apps/web-pwa/src").rglob("*.tsx"),
        *(root / "packages/sdk/src").rglob("*.ts"),
        *(root / "packages/wobo/src").rglob("*.tsx"),
    ]
    quoted = re.compile(r"""(['"`])((?:\\.|(?!\1)[^\\])*)\1""")
    for path in files:
        if path.name.endswith((".test.ts", ".test.tsx", ".spec.ts")):
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), 1):
            stripped = line.lstrip()
            if stripped.startswith(("*", "//", "/*")):
                continue
            for match in quoted.finditer(line):
                text = match.group(2).casefold()
                if any(phrase in text for phrase in BANNED):
                    offenders.append(f"{path.relative_to(root)}:{line_no}")
    assert not offenders, f"the phrase is still on a learner surface: {offenders}"


# --- 7. and it never narrates --------------------------------------------------------------------


def test_the_wait_never_says_what_it_is_doing(store: InMemoryStore) -> None:
    """The never-narrate law (docs/EMAILS-AND-ANIMATIONS.md §3): no percentage, no "generating",
    no sentence about what Wobo is doing. The job's own machine state may ride along for the
    console; no line of prose about it may."""
    said = " ".join(strings(units(store))).casefold()
    for narration in ("looking", "fetching", "reading the", "checking", "searching", "%"):
        assert narration not in said, f"the learner was narrated at: {narration!r}"


# --- 8. the wait is only ever for a syllabus that can actually land -------------------------------
#
# §5 says "every learner after them arrives instantly", and §7 said "what a learner is TOLD is the
# honest end, computed on read". Both were true only for a board that LANDED. On a board whose job
# refused, and on every board at all while `WOBO_DISCOVERY_WORKER` is unset — which is production
# today, 264 of the 268 — the answer still carried the full eight-second ceiling and a job block
# that said `open: true`. So the second learner waited again, and the third, forever; and the
# client's quiet poll (`useDiscoveryStatus`, which stops on `!open`) never stopped, asking a
# question every four seconds whose answer could not change, and reading back the forbidden
# promise "Looking for the official syllabus now" inside the job block while the top-level line
# said the honest end. These are that clause, made true.


def test_no_wait_when_nothing_can_land_because_no_worker_is_running(
    store: InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Production today. The row is still queued for the console and for the day the switch is
    set, but there is nothing that could arrive inside eight seconds, so nobody is held."""
    monkeypatch.delenv("WOBO_DISCOVERY_WORKER", raising=False)
    out = units(store)
    assert out["status"] == "shared"
    assert out["plan"]["concepts"], "the shared plan is still what they start on"
    assert out["wait_ms"] == 0, "a learner was held eight seconds for a search nobody is running"


def test_no_wait_on_a_board_whose_job_already_refused(
    store: InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """§5's remembered refusal, on the learner's side: a board whose document cannot be read is
    not re-fetched on every learner, so it must not be re-WAITED on by every learner either."""
    monkeypatch.setenv("WOBO_DISCOVERY_WORKER", "1")
    first = units(store)
    assert first["wait_ms"] == coldstart.WAIT_CEILING_MS
    store.update_job(first["job_id"], state=JobState.REFUSED)
    second = units(store, subject="learner-2")
    assert second["status"] == "shared"
    assert second["wait_ms"] == 0, "the second learner paid the first learner's wait again"


def test_the_wait_is_the_ceiling_while_a_job_is_genuinely_running(
    store: InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """And the other half, so the fix cannot be "never wait": with a worker draining the queue the
    syllabus really can land inside the window, and that is what the window is for."""
    monkeypatch.setenv("WOBO_DISCOVERY_WORKER", "1")
    assert units(store)["wait_ms"] == coldstart.WAIT_CEILING_MS


def test_the_status_of_an_undrainable_job_is_closed_so_the_poll_stops(
    store: InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`packages/sdk/src/curriculum/parse.ts` takes `job.open` when the wire carries it, and
    `useDiscoveryStatus` polls until it is false. A job block that says `open: true` about a job
    nothing will move is an endless poll on every cold board."""
    monkeypatch.delenv("WOBO_DISCOVERY_WORKER", raising=False)
    out = api.handle(
        "curriculum.status", {"job_id": units(store)["job_id"]}, subject=LEARNER, store=store
    )
    assert out["state"] == "refused"
    assert out["job"]["state"] == "refused"
    assert out["job"]["open"] is False, "the client polled a job nobody will ever move"


def test_the_status_of_an_undrainable_job_carries_the_promise_nowhere_in_it(
    store: InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The top-level line was already honest and the job block beside it was not. Both are read
    by the same client, so §4.6 is asserted over the whole answer."""
    monkeypatch.delenv("WOBO_DISCOVERY_WORKER", raising=False)
    out = api.handle(
        "curriculum.status", {"job_id": units(store)["job_id"]}, subject=LEARNER, store=store
    )
    said = " ".join(strings(out)).casefold()
    assert "looking for the official syllabus" not in said
    assert out["job"]["message"] == out["message"]


def test_the_row_itself_is_untouched_by_any_of_it(
    store: InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Nothing above writes. The queue is the console's and the worker's backlog, and it still
    says QUEUED the hour the owner sets the switch."""
    monkeypatch.delenv("WOBO_DISCOVERY_WORKER", raising=False)
    job_id = units(store)["job_id"]
    api.handle("curriculum.status", {"job_id": job_id}, subject=LEARNER, store=store)
    assert store.get_job(job_id).state is JobState.QUEUED
    assert store.get_job(job_id).open is True
