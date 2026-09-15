"""The nine curriculum capabilities (CURRICULUM.md §3, §4, §6, §8).

Driven through :func:`api.handle` against the in-memory store, which is the same code path the
HTTP route takes once the door has verified the subject.
"""

from __future__ import annotations

from typing import Any

import pytest
from wobo_gateway.curriculum import api
from wobo_gateway.curriculum.models import (
    Framework,
    FrameworkKind,
    JobState,
    Node,
    NodeKind,
    Status,
    Version,
)
from wobo_gateway.curriculum.store import InMemoryStore, Seed, StoreUnavailable

SUBJECT = "learner-1"

BOARD = Framework(
    id="cbse",
    name="Central Board of Secondary Education",
    kind=FrameworkKind.NATIONAL,
    status=Status.VERIFIED,
    aliases=("CBSE",),
    country="IN",
    levels=("Class 9", "Class 10"),
)
V1 = Version(
    id="v1",
    framework_id="cbse",
    label="2026-27",
    status=Status.VERIFIED,
    published_at="2026-01-01T00:00:00Z",
)


def nodes(version_id: str = "v1", prefix: str = "") -> list[Node]:
    def n(ident: str, kind: NodeKind, name: str, parent: str | None, order: int = 0) -> Node:
        return Node(
            id=prefix + ident,
            version_id=version_id,
            kind=kind,
            name=name,
            parent_id=(prefix + parent) if parent else None,
            order=order,
            source_ref={"page": 4, "section": name},
        )

    return [
        n("lvl", NodeKind.LEVEL, "Class 9", None, 9),
        n("sub", NodeKind.SUBJECT, "Science", "lvl"),
        n("u1", NodeKind.UNIT, "Matter", "sub", 0),
        n("u2", NodeKind.UNIT, "Motion", "sub", 1),
        n("t1", NodeKind.TOPIC, "Atoms", "u1", 0),
        n("t2", NodeKind.TOPIC, "Molecules", "u1", 1),
        n("o1", NodeKind.OBJECTIVE, "Describe an atom", "t1", 0),
    ]


@pytest.fixture
def store() -> InMemoryStore:
    return InMemoryStore(Seed(frameworks=[BOARD], versions=[V1], nodes=nodes()))


def call(name: str, payload: dict[str, Any], store: InMemoryStore, subject: str = SUBJECT) -> Any:
    return api.handle(name, payload, subject=subject, store=store)


# --- search (§3) -------------------------------------------------------------------------------
def test_search_finds_a_board_by_alias_and_labels_it(store: InMemoryStore) -> None:
    out = call("curriculum.search", {"q": "cbse", "country": "IN"}, store)
    assert [r["id"] for r in out["results"]] == ["cbse"]
    # §5's sentence names the edition, because that is the claim that has to be falsifiable.
    assert (
        out["results"][0]["label"]
        == "Official Central Board of Secondary Education 2026-27, verified"
    )
    assert out["results"][0]["has_syllabus"] is True


def test_search_does_not_call_a_board_verified_when_no_syllabus_is_stored(
    store: InMemoryStore,
) -> None:
    """§5, §12: every one of the four labels is a claim about a SYLLABUS. A board we hold no
    chapters for makes no claim about one — it claims only what §3 corroborated, that the board is
    the board it says it is. It used to add "no syllabus stored yet"; that sentence left the
    product with the cold start (docs/BOARD-COLD-START.md), because picking this board now starts
    both the reading of its syllabus and the learner, so there is nothing to warn them about."""
    store.put_framework(
        Framework(id="tel", name="Telangana Board", status=Status.VERIFIED, levels=("Class 9",))
    )
    out = call("curriculum.search", {"q": "telangana"}, store)
    assert [r["id"] for r in out["results"]] == ["tel"]
    assert out["results"][0]["label"] == "Official Telangana Board"
    assert "verified" not in out["results"][0]["label"]
    assert "syllabus" not in out["results"][0]["label"].casefold()
    # What we hold of its syllabus is a machine fact, not a sentence a child reads.
    assert out["results"][0]["has_syllabus"] is False


def test_search_always_shows_the_not_listed_door(store: InMemoryStore) -> None:
    for query in ("cbse", "a board that does not exist", ""):
        out = call("curriculum.search", {"q": query}, store)
        assert out["not_listed"]["action"] == "own_syllabus"


def test_search_returns_nothing_rather_than_something_plausible(store: InMemoryStore) -> None:
    assert call("curriculum.search", {"q": "hogwarts"}, store)["results"] == []


def test_search_serves_only_levels_in_scope(store: InMemoryStore) -> None:
    store.put_framework(
        Framework(id="wide", name="Wide board", levels=("Class 1", "Class 9", "Class 14"))
    )
    out = call("curriculum.search", {"q": "wide"}, store)
    assert out["results"][0]["levels"] == ["Class 9"]


def test_search_caps_the_query_length(store: InMemoryStore) -> None:
    out = call("curriculum.search", {"q": "x" * 5000}, store)
    assert len(out["query"]) <= 120


# --- framework (§3, §8) --------------------------------------------------------------------------
def test_framework_lists_the_levels_of_the_stored_syllabus(store: InMemoryStore) -> None:
    out = call("curriculum.framework", {"framework_id": "cbse"}, store)
    assert out["levels"] == ["Class 9"]
    assert out["version"]["label"] == "2026-27"
    assert out["label"] == "Official Central Board of Secondary Education 2026-27, verified"


def test_framework_lists_subjects_for_a_level(store: InMemoryStore) -> None:
    out = call("curriculum.framework", {"framework_id": "cbse", "level": "class 9"}, store)
    assert out["subjects"] == ["Science"]


def test_framework_falls_back_to_the_registry_levels_when_nothing_is_stored(
    store: InMemoryStore,
) -> None:
    store.put_framework(Framework(id="new", name="New board", levels=("Class 9", "Class 10")))
    out = call("curriculum.framework", {"framework_id": "new"}, store)
    assert out["levels"] == ["Class 9", "Class 10"]
    assert out["version"] is None


def test_an_unknown_framework_opens_the_own_syllabus_door(store: InMemoryStore) -> None:
    with pytest.raises(api.CurriculumError) as exc:
        call("curriculum.framework", {"framework_id": "nope"}, store)
    assert exc.value.status == 404
    assert "Show me your syllabus" in exc.value.message


def test_a_missing_framework_id_asks_for_it(store: InMemoryStore) -> None:
    with pytest.raises(api.CurriculumError) as exc:
        call("curriculum.framework", {}, store)
    assert exc.value.code == "needs_more"


# --- units on demand (§4, §8) ---------------------------------------------------------------------
def test_units_come_from_the_stored_syllabus_with_their_source(store: InMemoryStore) -> None:
    out = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Science"},
        store,
    )
    assert out["status"] == "ready"
    assert [u["name"] for u in out["units"]] == ["Matter", "Motion"]
    assert out["units"][0]["source_ref"]["page"] == 4


def test_a_missing_syllabus_enqueues_discovery_and_invents_nothing(store: InMemoryStore) -> None:
    out = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Mathematics"},
        store,
    )
    # The cold start (docs/BOARD-COLD-START.md): the job goes out, the learner does not wait on
    # it, and they start on the plan every board shares. Never a chapter we do not hold.
    assert out["status"] == "shared"
    assert out["units"] == []  # §12: never a syllabus with no source
    assert out["plan"]["source"] == "shared"
    assert out["not_listed"]["action"] == "own_syllabus"
    # The row exists, for the worker and for the console.
    assert store.find_open_job(
        framework_id="cbse", query="Central Board of Secondary Education",
        level="Class 9", subject="Mathematics",
    ) is not None


def test_a_missing_syllabus_never_says_it_is_looking(
    store: InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Not even when something genuinely IS looking. A learner is never told that a search is
    happening — the never-narrate law, and the reason the cold start replaced the status card
    with a designed wait (docs/EMAILS-AND-ANIMATIONS.md §3)."""
    monkeypatch.setenv("WOBO_DISCOVERY_WORKER", "1")
    out = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Mathematics"},
        store,
    )
    assert out["status"] == "shared"
    assert "placeholder" not in out
    assert "looking" not in str(out).casefold()


def test_a_subject_nobody_can_be_started_on_still_reaches_an_honest_end(
    store: InMemoryStore,
) -> None:
    """The narrow case BOARD-COLD-START §5 keeps a sentence for, narrower than it was: not "we
    hold no syllabus for your board" but "we hold nothing at all anyone could be started on" —
    no chapters from this board and no shared concepts for this class and subject either, which
    in practice means a language. The honest end, and the own-syllabus door in the same place."""
    out = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Sanskrit"},
        store,
    )
    assert out["units"] == []
    assert out.get("plan") is None
    assert out["status"] == "refused"  # nothing is draining the queue in this process
    assert out["not_listed"]["action"] == "own_syllabus"
    assert "syllabus" in out["label"].casefold()


def test_two_learners_asking_for_the_same_missing_syllabus_share_one_job(
    store: InMemoryStore,
) -> None:
    payload = {"framework_id": "cbse", "level": "Class 9", "subject": "Sanskrit"}
    first = call("curriculum.units", payload, store, subject="a")
    second = call("curriculum.units", payload, store, subject="b")
    assert first["job_id"] == second["job_id"]


def test_units_needs_a_level_and_a_subject(store: InMemoryStore) -> None:
    with pytest.raises(api.CurriculumError):
        call("curriculum.units", {"framework_id": "cbse"}, store)
    with pytest.raises(api.CurriculumError):
        call("curriculum.units", {"framework_id": "cbse", "level": "Class 9"}, store)


# --- topics (§2, §8) ------------------------------------------------------------------------------
def test_topics_carry_the_frameworks_own_objectives(store: InMemoryStore) -> None:
    out = call("curriculum.topics", {"framework_id": "cbse", "unit_id": "u1"}, store)
    assert [t["name"] for t in out["topics"]] == ["Atoms", "Molecules"]
    assert out["topics"][0]["objectives"] == ["Describe an atom"]
    assert out["unit"]["name"] == "Matter"


def test_topics_refuses_a_node_that_is_not_a_unit(store: InMemoryStore) -> None:
    for unit_id in ("t1", "lvl", "nonsense"):
        with pytest.raises(api.CurriculumError) as exc:
            call("curriculum.topics", {"framework_id": "cbse", "unit_id": unit_id}, store)
        assert exc.value.status == 404


# --- the overlay (§6) -----------------------------------------------------------------------------
def test_an_edit_is_stored_as_a_patch_and_shows_up_on_the_next_read(store: InMemoryStore) -> None:
    call(
        "curriculum.overlay.apply",
        {
            "framework_id": "cbse",
            "ops": [{"op": "rename", "node_id": "u1", "name": "Matter around us"}],
        },
        store,
    )
    out = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Science"},
        store,
    )
    assert [u["name"] for u in out["units"]] == ["Matter around us", "Motion"]
    assert store.get_node("u1").name == "Matter"  # the canonical node never moved


def test_another_learner_never_sees_my_overlay(store: InMemoryStore) -> None:
    call(
        "curriculum.overlay.apply",
        {"framework_id": "cbse", "ops": [{"op": "remove", "node_id": "u2"}]},
        store,
        subject="a",
    )
    mine = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Science"},
        store,
        subject="a",
    )
    theirs = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Science"},
        store,
        subject="b",
    )
    assert [u["name"] for u in mine["units"]] == ["Matter"]
    assert [u["name"] for u in theirs["units"]] == ["Matter", "Motion"]


def test_an_edit_naming_a_node_we_do_not_have_is_refused(store: InMemoryStore) -> None:
    with pytest.raises(api.CurriculumError) as exc:
        call(
            "curriculum.overlay.apply",
            {"framework_id": "cbse", "ops": [{"op": "remove", "node_id": "not-here"}]},
            store,
        )
    assert exc.value.code == "unknown_node"


def test_a_malformed_edit_is_refused_in_the_learners_language(store: InMemoryStore) -> None:
    with pytest.raises(api.CurriculumError) as exc:
        call(
            "curriculum.overlay.apply",
            {"framework_id": "cbse", "ops": [{"op": "detonate", "node_id": "u1"}]},
            store,
        )
    assert exc.value.code == "overlay_rejected"
    assert "!" not in exc.value.message


def test_overlay_get_returns_what_was_stored(store: InMemoryStore) -> None:
    call(
        "curriculum.overlay.apply",
        {"framework_id": "cbse", "ops": [{"op": "not_in_my_school", "node_id": "u2"}]},
        store,
    )
    out = call("curriculum.overlay.get", {"framework_id": "cbse"}, store)
    assert len(out["overlay"]["ops"]) == 1
    assert out["overlay"]["ops"][0]["node_name"] == "Motion"


def test_the_overlay_needs_a_signed_in_learner(store: InMemoryStore) -> None:
    with pytest.raises(api.CurriculumError) as exc:
        call("curriculum.overlay.get", {"framework_id": "cbse"}, store, subject="")
    assert exc.value.status == 401


# --- pin and upgrade (§2, §6) ---------------------------------------------------------------------
def _second_version(store: InMemoryStore) -> Version:
    """A 2027-28 edition where Motion is gone, Sound is new, and every id is different."""
    version = Version(
        id="v2",
        framework_id="cbse",
        label="2027-28",
        status=Status.VERIFIED,
        published_at="2027-01-01T00:00:00Z",
    )
    store.put_version(version)
    fresh = [n for n in nodes("v2", prefix="b-") if n.name != "Motion"]
    fresh.append(
        Node(
            id="b-u9",
            version_id="v2",
            kind=NodeKind.UNIT,
            name="Sound",
            parent_id="b-sub",
            order=1,
        )
    )
    store.put_nodes(fresh)
    return version


def test_pin_holds_the_learner_on_their_version(store: InMemoryStore) -> None:
    call("curriculum.pin", {"framework_id": "cbse", "version_id": "v1"}, store)
    _second_version(store)
    out = call("curriculum.framework", {"framework_id": "cbse"}, store)
    assert out["version"]["id"] == "v1"  # the new edition does not move them by itself
    assert out["pinned_version_id"] == "v1"


def test_upgrade_offers_the_diff_without_changing_anything(store: InMemoryStore) -> None:
    call("curriculum.pin", {"framework_id": "cbse", "version_id": "v1"}, store)
    _second_version(store)
    out = call("curriculum.upgrade", {"framework_id": "cbse"}, store)
    assert out["upgrade_available"] is True
    lines = [c["line"] for c in out["changes"]]
    assert "Sound is new, in Science" in lines
    assert "Motion is gone, from Science" in lines
    assert store.get_pin(SUBJECT, "cbse") == "v1"  # the offer changed nothing


def test_upgrade_carries_the_overlay_across_and_reports_what_it_could_not(
    store: InMemoryStore,
) -> None:
    call("curriculum.pin", {"framework_id": "cbse", "version_id": "v1"}, store)
    call(
        "curriculum.overlay.apply",
        {
            "framework_id": "cbse",
            "ops": [
                {"op": "rename", "node_id": "u1", "name": "Matter around us"},
                {"op": "not_in_my_school", "node_id": "u2"},
            ],
        },
        store,
    )
    _second_version(store)
    out = call("curriculum.upgrade", {"framework_id": "cbse", "apply": True}, store)
    assert out["upgraded"] is True
    assert store.get_pin(SUBJECT, "cbse") == "v2"
    # Matter is still there under a brand new id, so the rename is carried across and re-keyed.
    # Motion is gone from the edition, so its edit is dropped — and SAID, never guessed at.
    assert out["overlay_kept"] == 1
    assert out["overlay_dropped"] == 1
    assert out["overlay_report"] == [
        "I could not carry across your note that Motion is not in your school."
    ]
    carried = store.get_overlay(SUBJECT, "v2")
    assert carried is not None and carried.patch[0]["node_id"] == "b-u1"
    after = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Science"},
        store,
    )
    assert [u["name"] for u in after["units"]] == ["Matter around us", "Sound"]


def test_upgrade_says_so_when_there_is_nothing_to_upgrade_to(store: InMemoryStore) -> None:
    call("curriculum.pin", {"framework_id": "cbse", "version_id": "v1"}, store)
    out = call("curriculum.upgrade", {"framework_id": "cbse"}, store)
    assert out["upgrade_available"] is False
    assert out["changes"] == []


def test_pin_refuses_a_version_from_another_framework(store: InMemoryStore) -> None:
    store.put_framework(Framework(id="other", name="Other board"))
    with pytest.raises(api.CurriculumError) as exc:
        call("curriculum.pin", {"framework_id": "other", "version_id": "v1"}, store)
    assert exc.value.code == "unknown_version"


# --- status (§4, §5) ------------------------------------------------------------------------------
def test_status_reports_an_open_job_in_one_honest_line(
    store: InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("WOBO_DISCOVERY_WORKER", "1")
    started = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Sanskrit"},
        store,
    )
    out = call("curriculum.status", {"job_id": started["job_id"]}, store)
    assert out["state"] == "queued"
    assert out["message"] == "Looking for the official syllabus now"
    assert "not_listed" not in out


def test_status_never_says_it_is_looking_when_nothing_is(store: InMemoryStore) -> None:
    """§4.6: a search nobody is running is not reported as running."""
    started = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Sanskrit"},
        store,
    )
    out = call("curriculum.status", {"job_id": started["job_id"]}, store)
    assert out["state"] == "refused"
    # The ROW is untouched: it is the console's queue and the worker's backlog. What changed is
    # only what the learner is told (docs/BOARD-COLD-START.md §5).
    assert store.get_job(started["job_id"]).state is JobState.QUEUED
    assert out["not_listed"]["action"] == "own_syllabus"


def test_status_opens_the_other_door_the_moment_a_search_gives_up(store: InMemoryStore) -> None:
    started = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Sanskrit"},
        store,
    )
    job_id = started["job_id"]
    store.update_job(job_id, state=JobState.REFUSED)
    out = call("curriculum.status", {"job_id": job_id}, store)
    assert "could not find an official syllabus" in out["message"]
    assert out["not_listed"]["action"] == "own_syllabus"


def test_status_of_nothing_is_not_an_error(store: InMemoryStore) -> None:
    out = call("curriculum.status", {"job_id": "no-such-job"}, store)
    assert out["job"] is None


# --- the surface itself ---------------------------------------------------------------------------
def test_every_declared_capability_has_a_handler(store: InMemoryStore) -> None:
    assert set(api.CAPABILITIES) == set(api._HANDLERS)


def test_an_unknown_capability_is_a_404(store: InMemoryStore) -> None:
    with pytest.raises(api.CurriculumError) as exc:
        call("curriculum.detonate", {}, store)
    assert exc.value.status == 404


def test_an_unreachable_registry_refuses_rather_than_invents() -> None:
    class Broken(InMemoryStore):
        def search_frameworks(self, *args: Any, **kwargs: Any) -> list[Framework]:
            raise StoreUnavailable("no route to host")

    with pytest.raises(api.CurriculumError) as exc:
        api.handle("curriculum.search", {"q": "cbse"}, subject=SUBJECT, store=Broken(Seed()))
    assert exc.value.status == 503
    assert exc.value.code == "registry_unavailable"


def test_no_learner_facing_payload_names_a_model(store: InMemoryStore) -> None:
    """WOBO-PLAN §1: the client never holds a key, a model id, or a provider name."""
    out = call(
        "curriculum.units",
        {"framework_id": "cbse", "level": "Class 9", "subject": "Science"},
        store,
    )
    blob = repr(out).lower()
    for banned in ("gpt", "claude", "anthropic", "openai", "gemini", "sonnet", "opus", "terra"):
        assert banned not in blob
