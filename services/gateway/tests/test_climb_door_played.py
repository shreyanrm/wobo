"""THE CLIMB A LEARNER CAN ACTUALLY REACH — played end to end through the real door.

docs/LEARNING-MODEL.md, "The tutor never leaves" (the owner, 2026-09-15): *"Is the content and
teaching plan continuously optimising and personalising to the learner's needs until they master
or understand that topic?"*

``tests/test_climb_played.py`` proves the climb is right. It proves it against the module, by
importing it. That is where this file comes from: for a whole wave ``climb.py`` was imported by
that test and BY NOTHING ELSE — no route, no capability, nothing a learner could reach — so rule 1
was true in a library and false in the product. A re-chooser nobody can call has not re-chosen
anything.

So every test here goes through ``POST /v1/capability/curriculum.climb``: the real door, the real
verified token, the real meter, the real stored pool (written into the artifact store the gateway
actually reads, not handed in), and the real climb. A learner answers one module, the door folds
what happened into what they have shown, and the group that teaches the topic is chosen AGAIN out
of it. Nothing here asserts on a docstring.

What is proved here rather than in the unit suite:

1. the capability exists and a learner reaches it                       section 1
2. a whole topic is played through it, and the group moves on answers   section 2
3. a module that beat them twice never comes back through the door      section 2
4. every step says WHY, in the pool's own words, in Wobo's voice        section 3
5. it costs no model, and the door keeps nothing about the learner      section 4
6. a chapter with no pool is an ordinary answer and never a build       section 4
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from blueprint_fixture import blueprint as good_blueprint
from blueprint_fixture import brief as good_brief
from fastapi.testclient import TestClient
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

CLIMB = "curriculum.climb"

#: The syllabus cell every request here is about: CBSE class 8 Science, "Force and Pressure".
#: The same cell the blueprint suite uses, so the pool under this is the real one.
CELL: dict[str, Any] = good_brief()


@pytest.fixture(autouse=True)
def _stored_pool(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """The real pool, in the real artifact store, read by the real loader.

    Deliberately not a monkeypatched ``load``: the thing this file exists to prove is that a
    learner reaches the climb through the door, and a door that only works when the store is
    stubbed has not been proved to work.
    """
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    from wobo_gateway.plexus import blueprint as architect
    from wobo_gateway.plexus import store as plexus_store

    brief = architect.NodeBrief.from_dict(CELL)
    plexus_store.save(
        brief.concept(),
        architect.MODALITY,
        architect.DIFFICULTY,
        {"status": architect.CANONICAL, "artifact": good_blueprint()},
        brief.scope(),
    )
    yield


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


# --- a learner who answers, through the door -----------------------------------------------------

Answer = Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]


def ask(
    client: TestClient,
    headers: dict[str, str],
    *,
    topic: str,
    evidence: dict[str, Any] | None = None,
    answered: dict[str, Any] | None = None,
    cell: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """One turn of the climb, exactly as a screen would ask for it."""
    body: dict[str, Any] = {**(cell if cell is not None else CELL), "topic": topic}
    if evidence is not None:
        body["evidence"] = evidence
    if answered is not None:
        body["answered"] = answered
    response = client.post(f"/v1/capability/{CLIMB}", json={"payload": body}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["output"]


def play(
    client: TestClient,
    headers: dict[str, str],
    topic: str,
    answer: Answer,
    *,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Walk the topic the way a learner does: ask, answer that, ask again — over HTTP each time.

    ``limit`` guards THIS TEST against a loop and is never a rule of the climb; a climb that needs
    it is a list going round, and the assertion says exactly that.
    """
    evidence: dict[str, Any] = {}
    answered: dict[str, Any] | None = None
    steps: list[dict[str, Any]] = []
    for _ in range(limit):
        out = ask(client, headers, topic=topic, evidence=evidence, answered=answered)
        steps.append(out)
        evidence = out["evidence"]
        module = out["step"]["module"]
        if module is None:
            return steps
        answered = answer(module, out)
    raise AssertionError(f"the climb through the door never ended for {topic}")


def modules_met(steps: list[dict[str, Any]]) -> list[str]:
    return [s["step"]["module"]["id"] for s in steps if s["step"]["module"] is not None]


def always_right(module: dict[str, Any], _out: dict[str, Any]) -> dict[str, Any]:
    return {"module": module["id"], "right": True}


def missed_once_then_held(shows: str) -> Answer:
    """Misses everything once and then gets it. The commonest real learner in the product."""

    def answer(module: dict[str, Any], out: dict[str, Any]) -> dict[str, Any]:
        already = list(out["evidence"].get("wrong") or []).count(module["id"])
        if already >= 1:
            return {"module": module["id"], "right": True}
        return {"module": module["id"], "right": False, "showed": [shows]}

    return answer


def beaten_on(module_id: str) -> Answer:
    """Right at everything except one module, which beats them every single time."""

    def answer(module: dict[str, Any], _out: dict[str, Any]) -> dict[str, Any]:
        return {"module": module["id"], "right": module["id"] != module_id}

    return answer


# =================================================================================================
# 1. It exists, and a learner reaches it
# =================================================================================================


def test_the_climb_is_a_capability_and_not_only_a_library() -> None:
    """The named defect. ``climb.py`` was imported by its own test and by nothing else: no route,
    no capability, and therefore no learner. It is a door now, registered like every other."""
    from wobo_gateway.curriculum.api import CAPABILITIES
    from wobo_gateway.registry import EXPECTED_CAPABILITIES, capabilities

    assert CLIMB in capabilities()
    assert CLIMB in EXPECTED_CAPABILITIES
    assert CLIMB in CAPABILITIES


def test_the_re_chooser_is_reached_by_something_a_learner_can_call() -> None:
    """``next_step`` used to be called by one test file. It is called by the door now, and this
    asserts the door genuinely goes through it rather than choosing for itself."""
    from wobo_gateway import climb as climb_module
    from wobo_gateway.curriculum import api as curriculum_api

    reached: list[str] = []
    real = climb_module.next_step

    def watched(bp: Any, topic_id: str, evidence: Any) -> Any:
        reached.append(topic_id)
        return real(bp, topic_id, evidence)

    climb_module.next_step = watched  # type: ignore[assignment]
    try:
        curriculum_api.handle(CLIMB, {**CELL, "topic": "t4"}, subject="learner-1")
    finally:
        climb_module.next_step = real  # type: ignore[assignment]
    assert reached == ["t4"], "the door answered without ever asking the climb"


def test_an_unauthenticated_learner_is_refused_like_every_other_door(client: TestClient) -> None:
    response = client.post(f"/v1/capability/{CLIMB}", json={"payload": {**CELL, "topic": "t4"}})
    assert response.status_code == 401


def test_the_capability_listing_carries_it_and_still_leaks_no_model(
    client: TestClient, auth: Any
) -> None:
    listing = client.get("/v1/capabilities", headers=auth())
    assert CLIMB in {row["capability"] for row in listing.json()}
    body = listing.text.lower()
    for banned in ("gpt", "claude", "luna", "terra", "astra"):
        assert banned not in body


# =================================================================================================
# 2. A whole topic, played through the door
# =================================================================================================


def test_a_learner_plays_a_topic_through_the_door_and_reaches_mastery(
    client: TestClient, auth: Any
) -> None:
    """The one that matters. A learner who misses everything once, shows a misconception, and
    comes back to get it right, walks the topic over HTTP and arrives held."""
    steps = play(client, auth(), "t4", missed_once_then_held("x2"))
    assert modules_met(steps), "a topic that hands out no module is a topic nobody can learn"
    assert steps[-1]["step"]["module"] is None
    assert steps[-1]["step"]["kind"] == "mastered"
    assert steps[-1]["mastered"] is True
    assert all(step["pool"] is True for step in steps)


def test_the_group_is_re_chosen_through_the_door_and_changes_on_nothing_but_the_answers(
    client: TestClient, auth: Any
) -> None:
    """Rule 1, at the door. The group that teaches the topic comes back on EVERY call, and it
    changes mid-climb on the learner's own answers. A group chosen once cannot do that."""
    steps = play(client, auth(), "t1", missed_once_then_held("x1"))
    groups = [tuple(step["group"]) for step in steps]
    assert len(groups) >= 3, "a single module is not a climb"
    assert len(set(groups)) > 1, (
        "the group never changed across a whole climb through the door, "
        "so it was chosen once and handed back unchanged"
    )


def test_a_wrong_answer_pulls_its_repair_in_through_the_door(client: TestClient, auth: Any) -> None:
    """ "Guiding where they went wrong", over HTTP: the module that undoes the misconception they
    just showed is the very next thing the door hands back."""
    headers = auth()
    clean = ask(client, headers, topic="t4")
    assert "r2" not in clean["group"]

    missed = ask(
        client,
        headers,
        topic="t4",
        answered={"module": "p9", "right": False, "showed": ["x2"]},
    )
    assert missed["step"]["module"] is not None
    assert missed["step"]["module"]["id"] == "r2"
    assert missed["step"]["kind"] == "repair"
    assert "r2" in missed["group"]


def test_the_module_that_beat_them_twice_never_comes_back_through_the_door(
    client: TestClient, auth: Any
) -> None:
    """ "A learner who gets a module wrong twice gets a different module next, never the same one
    again." Played rather than asserted on a tuple: p9 beats them every time it is offered."""
    steps = play(client, auth(), "t4", beaten_on("p9"))
    met = modules_met(steps)
    assert met.count("p9") == 2, "two misses, and then it is gone for good"
    after_the_second = met[met.index("p9", met.index("p9") + 1) + 1 :]
    assert "p9" not in after_the_second
    for step in steps:
        module = step["step"]["module"]
        if module is not None:
            assert module["role"] != "stretch", "a stretch is never what follows a miss"


def test_what_follows_the_second_miss_is_the_architects_own_way_out(
    client: TestClient, auth: Any
) -> None:
    """The architect wrote, for the modules learners really do get stuck on, a DIFFERENT module to
    show instead. The door reaches for that before anything it would pick itself."""
    headers = auth()
    evidence: dict[str, Any] = {}
    for _ in range(2):
        out = ask(
            client,
            headers,
            topic="t4",
            evidence=evidence,
            answered={"module": "p9", "right": False},
        )
        evidence = out["evidence"]
    assert out["step"]["module"] is not None
    assert out["step"]["module"]["id"] == "q2"
    assert out["step"]["kind"] == "way_back"


def test_how_slow_they_were_travels_through_the_door_and_is_read(
    client: TestClient, auth: Any
) -> None:
    """ "How slow" is one of the four things the re-choice reads, so it has to survive the wire."""
    out = ask(
        client,
        auth(),
        topic="t4",
        answered={"module": "p9", "right": True, "seconds": 1800.0},
    )
    assert out["evidence"]["slow"] == ["p9"], "the sitting it ran over never reached the chooser"


def test_what_the_learner_said_is_read_through_the_door_and_never_invented(
    client: TestClient, auth: Any
) -> None:
    """Their own words are the fourth input, matched against the chapter's OWN declarations."""
    headers = auth()
    restated = ask(
        client,
        headers,
        topic="t5",
        answered={"module": "p11", "right": False, "said": "but liquids only press downwards"},
    )
    assert "x3" in restated["evidence"]["misconceptions"]

    vague = ask(
        client,
        headers,
        topic="t5",
        answered={"module": "p11", "right": False, "said": "I am really not sure about this one"},
    )
    assert vague["evidence"]["misconceptions"] == [], (
        "a misconception nobody showed was invented from a learner saying they were unsure"
    )


def test_a_learner_who_understands_early_is_finished_early(client: TestClient, auth: Any) -> None:
    """Rule 2 at the door: it ends at the topic's own evidence, never at a module count."""
    steps = play(client, auth(), "t4", always_right)
    assert steps[-1]["mastered"] is True
    served = [m["id"] for m in good_blueprint()["modules"] if "t4" in m["serves"]]
    assert len(modules_met(steps)) < len(served), (
        "the fast learner was walked through the whole pool, so the door serves a list"
    )


def test_the_struggling_learner_is_given_more_and_arrives_at_the_same_place(
    client: TestClient, auth: Any
) -> None:
    """Two learners, one topic, two roads, both arrive — over the same door."""
    quick = play(client, auth(), "t1", always_right)
    slow = play(client, auth(), "t1", missed_once_then_held("x1"))
    assert quick[-1]["mastered"] is True
    assert slow[-1]["mastered"] is True
    assert len(modules_met(slow)) > len(modules_met(quick)), (
        "the learner who struggled was given no more than the one who did not"
    )


# =================================================================================================
# 3. Every step says why, in the pool's own words and in Wobo's voice
# =================================================================================================


def test_every_step_through_the_door_says_why_in_the_pools_own_words(
    client: TestClient, auth: Any
) -> None:
    """Never "incorrect, try again", and never a generic hint: the reason is one of the
    architect's own sentences, so a line of ours is not even expressible here."""
    raw = good_blueprint()
    declared = {i["what"] for i in raw["ideas"]}
    declared |= {m["what"] for m in raw["misconceptions"]}
    declared |= {a["what"] for a in raw["assumptions"]}
    declared |= {r["why"] for r in raw["flow"]["stuck"]}
    declared.add(raw["thread"])

    for topic in ("t1", "t4", "t5"):
        for step in play(client, auth(), topic, missed_once_then_held("x1")):
            why = step["step"]["why"]
            assert why in declared, f"the door reached for a line the pool never wrote: {why!r}"


def test_no_line_a_learner_reads_breaks_the_voice(client: TestClient, auth: Any) -> None:
    """docs/copy/voice.md section 3: no exclamation marks, and no em dash where a person reads."""
    for topic in ("t1", "t4", "t5"):
        for step in play(client, auth(), topic, missed_once_then_held("x2")):
            why = step["step"]["why"]
            assert why.strip(), f"{step['step']['kind']} had nothing to say"
            assert "—" not in why and "–" not in why
            assert "!" not in why


def test_the_learner_is_never_handed_an_empty_screen(client: TestClient, auth: Any) -> None:
    """Rule 5, at the door. A learner who misses everything twice is given module after module,
    and when the pool really is spent the answer still says which idea is open."""
    steps = play(
        client,
        auth(),
        "t1",
        lambda module, _out: {"module": module["id"], "right": False},
    )
    assert len(modules_met(steps)) >= 6, "a struggling learner was given almost nothing"
    last = steps[-1]
    assert last["step"]["module"] is None
    assert last["step"]["kind"] == "pool_spent"
    assert last["step"]["why"].strip(), "the end of a hard climb still has to say something"
    assert last["mastered"] is False


# =================================================================================================
# 4. What it costs, and what it keeps
# =================================================================================================


def test_the_door_never_reaches_a_model(
    client: TestClient, auth: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ "Adapting to a learner costs nothing, because it is choosing from a pool that already
    exists." A model call anywhere behind this door is the defect itself, so the seam explodes."""
    from wobo_gateway import model_call

    def never(*_a: object, **_k: object) -> None:
        raise AssertionError("the climb reached for a model; choosing a group is a selection")

    monkeypatch.setattr(model_call, "complete", never)
    steps = play(client, auth(), "t4", missed_once_then_held("x2"))
    assert steps[-1]["mastered"] is True


def test_the_door_never_builds_a_pool(
    client: TestClient, auth: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``create.blueprint`` is a platform-paid job an operator runs. A learner asking what comes
    next must not be able to start one."""
    from wobo_gateway.plexus import blueprint as architect

    def never(*_a: object, **_k: object) -> None:
        raise AssertionError("a learner's climb asked the architect to build a pool")

    monkeypatch.setattr(architect, "build", never)
    assert ask(client, auth(), topic="t4")["step"]["module"] is not None


def test_a_chapter_with_no_pool_is_an_ordinary_answer(client: TestClient, auth: Any) -> None:
    """Most chapters have no pool today. That is not an error page: the screen carries on exactly
    as it does now, and the answer says so plainly."""
    elsewhere = {**CELL, "node": "cbse-8-science-sound", "chapter": "Sound"}
    out = ask(client, auth(), topic="t4", cell=elsewhere)
    assert out["pool"] is False
    assert out["step"] is None
    assert out["group"] == []
    assert out["mastered"] is False


def test_a_brief_that_is_not_a_cell_is_refused_in_wobos_voice(
    client: TestClient, auth: Any
) -> None:
    response = client.post(
        f"/v1/capability/{CLIMB}",
        json={"payload": {**CELL, "topics": [], "topic": "t4"}},
        headers=auth(),
    )
    assert response.status_code == 400
    body = response.json()
    assert body["message"] and "—" not in body["message"] and "!" not in body["message"]


def test_a_call_without_a_topic_says_what_is_missing(client: TestClient, auth: Any) -> None:
    response = client.post(f"/v1/capability/{CLIMB}", json={"payload": dict(CELL)}, headers=auth())
    assert response.status_code == 400
    assert response.json()["message"]


def test_the_door_keeps_nothing_about_the_learner(client: TestClient, auth: Any) -> None:
    """The evidence travels with the request and goes home with the answer, so the gateway stores
    no learner state to serve a climb. Asking the same thing twice answers the same thing twice,
    and one learner's climb is invisible to another's."""
    headers = auth()
    first = ask(client, headers, topic="t4", answered={"module": "p9", "right": False})
    again = ask(client, headers, topic="t4", answered={"module": "p9", "right": False})
    assert first["step"] == again["step"]
    assert first["evidence"] == again["evidence"]

    stranger = ask(client, auth("another-learner"), topic="t4")
    assert stranger["evidence"]["wrong"] == []
    assert stranger["step"]["module"] is not None


def test_nothing_about_a_person_is_ever_in_the_answer(client: TestClient, auth: Any) -> None:
    """:class:`climb.Evidence` is ids and nothing else: no name, no age, no score. The wire shape
    has to keep that true, because a shape is what a shape carries."""
    out = ask(
        client,
        auth(),
        topic="t4",
        answered={"module": "p9", "right": False, "showed": ["x2"], "seconds": 90.0},
    )
    for banned in ("name", "age", "score", "subject", "email", "learner_id"):
        assert banned not in out["evidence"]


def test_a_climb_step_is_metered_like_every_other_registry_read() -> None:
    """It reads the stored pool, so it costs what the other reads cost: the cheap counter, and it
    is still counted, because an uncounted route is a way around the allowance."""
    from wobo_gateway import budget
    from wobo_gateway.registry import policy
    from wobo_gateway.routing import Tier

    assert budget.classify(CLIMB) == budget.TURN
    assert policy(CLIMB).tier is Tier.TINY
    assert not policy(CLIMB).elevated_only


def test_one_learners_next_module_is_never_served_to_another() -> None:
    """A cached climb step is a learner being handed somebody else's next module, so the policy
    must carry no cache at all."""
    from wobo_gateway.cache import CacheTier
    from wobo_gateway.registry import policy

    assert policy(CLIMB).cache_tier is CacheTier.NONE
