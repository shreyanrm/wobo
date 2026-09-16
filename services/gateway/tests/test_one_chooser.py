"""ONE CHOOSER, AND IT IS THE FREE ONE: the gateway has no door that picks a learner's next module.

docs/LEARNING-MODEL.md, "Who chooses" (2026-09-16): the group that teaches a topic is chosen on the
device by ``groupFor`` (``apps/web-pwa/src/curriculum/blueprint.ts``), out of the pool
``curriculum.blueprint`` served once per cell per session. The gateway's own chooser,
``curriculum.climb`` (``climb.py``, wave 54), is retired. The law has the full reasons. Two of
them are measured by this file.

* **Every call to it was metered.** Anything under ``curriculum.`` draws on the learner's turn
  counter (``budget.CAPABILITY_CLASS``), and the money meter refuses a spent day
  (``allowance.check``). Played on 2026-09-16 before the retirement: an anonymous learner
  (six turns a day) was refused with a 429 on the SEVENTH call, still inside the first topic of
  Force and Pressure, holding two of its six ideas. The climb ended at the meter, not at mastery,
  which breaks rules 2 and 5. A free learner walking the same chapter spent 19 of their 40 day
  turns on being told what comes next, and those turns are also their questions to Wobo.
* **Nothing called it.** No screen and no SDK caller used it. A door that keeps nothing can't be
  the parent's view or the cross-device record either.

This file does not test what the chooser picks. The client chooses, and that is played in
``apps/web-pwa/test/one-chooser.test.ts``. This file proves three things: the gateway has no
second chooser, a stale client that asks for one is refused without losing a turn, and the law
still names the capability so the ledger can find it.
"""

from __future__ import annotations

import importlib.util
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from blueprint_fixture import blueprint as good_blueprint
from blueprint_fixture import brief as good_brief
from fastapi.testclient import TestClient
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

RETIRED = "curriculum.climb"
CELL: dict[str, Any] = good_brief()
LAW = Path(__file__).resolve().parents[3] / "docs" / "LEARNING-MODEL.md"

#: The anonymous learner of the played run: the walk that was refused on this call, in topic t1.
REFUSED_ON_CALL = 7
#: How many calls the free learner's walk of the whole chapter took through the retired door.
CHAPTER_WALK_CALLS = 19


@pytest.fixture(autouse=True)
def _stored_pool(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """The real pool, in the real artifact store, so the one read that remains is a real read."""
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


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def _turns_left(response: Any) -> int:
    return int(response.headers["X-Wobo-Budget-Remaining"])


# =================================================================================================
# 1. There is no second chooser on the gateway
# =================================================================================================


def test_the_gateway_offers_no_door_that_chooses_a_learners_next_module() -> None:
    from wobo_gateway.curriculum import api as curriculum_api
    from wobo_gateway.registry import EXPECTED_CAPABILITIES, capabilities

    assert RETIRED not in capabilities()
    assert RETIRED not in EXPECTED_CAPABILITIES
    assert RETIRED not in curriculum_api.CAPABILITIES
    assert RETIRED not in curriculum_api._HANDLERS


def test_the_gateway_keeps_no_second_chooser_that_nothing_calls() -> None:
    """``climb.py`` served the retired door and nothing else. Its logic is recoverable from
    commit 39548ee9, and the two readings the client does not do yet are named in the law."""
    assert importlib.util.find_spec("wobo_gateway.climb") is None


def test_the_capability_listing_offers_no_chooser(client: TestClient, auth: Any) -> None:
    listing = client.get("/v1/capabilities", headers=auth())
    assert listing.status_code == 200
    assert RETIRED not in {row["capability"] for row in listing.json()}


# =================================================================================================
# 2. The played walk: what a stale client asking the old door costs the learner now
# =================================================================================================


def test_an_anonymous_learner_walking_a_whole_chapter_never_spends_a_turn_on_choosing(
    client: TestClient, auth: Callable[..., dict[str, str]]
) -> None:
    """The played run, replayed against the gateway as it now stands.

    The learner reads the chapter's pool once. That is the one counted read a session makes per
    cell (on its own counter, never the learner's questions), and it is the whole of the
    gateway's part in choosing. Then they walk the chapter, and a
    stale client asks the retired door at every module boundary, as many times as the real walk
    took. In the played run before the retirement, which made no pool read first, call 7 was a
    429 and the walk stopped there. Now each of those calls is refused before the meter, as a door
    that does not exist, and the learner's day stays exactly where the pool read left it.
    """
    headers = auth("anonymous-walker", anonymous=True)
    read = client.post(
        "/v1/capability/curriculum.blueprint", json={"payload": CELL}, headers=headers
    )
    assert read.status_code == 200, read.text
    assert read.json()["output"]["blueprint"] is not None, "the pool the walk chooses from"
    left_after_the_read = _turns_left(read)

    for call in range(1, CHAPTER_WALK_CALLS + 1):
        asked = client.post(
            f"/v1/capability/{RETIRED}",
            json={"payload": {**CELL, "topic": "t1", "evidence": {}}},
            headers=headers,
        )
        assert asked.status_code != 429, (
            f"call {call} was refused by the meter: choosing spent the learner's day "
            f"(the played run was refused on call {REFUSED_ON_CALL})"
        )
        assert asked.status_code == 404, (
            f"call {call} was served ({asked.status_code}): the gateway still chooses"
        )

    again = client.post(
        "/v1/capability/curriculum.blueprint", json={"payload": CELL}, headers=headers
    )
    assert again.status_code == 200, again.text
    # The second read is counted like the first one, on the pool-read counter the header reports
    # for it, and nothing else in between was counted. Neither read spent one of the learner's
    # questions (``test_pool_read_costs_no_turn.py``).
    assert _turns_left(again) == left_after_the_read - 1


def test_a_signed_in_learner_asking_the_retired_door_is_charged_nothing(
    client: TestClient, auth: Callable[..., dict[str, str]]
) -> None:
    from wobo_gateway import budget

    before = budget.snapshot("sub:free-walker", "free").turns_remaining
    asked = client.post(
        f"/v1/capability/{RETIRED}",
        json={"payload": {**CELL, "topic": "t4"}},
        headers=auth("free-walker"),
    )
    assert asked.status_code == 404
    assert budget.snapshot("sub:free-walker", "free").turns_remaining == before


# =================================================================================================
# 3. The law names it, so the ledger can find it
# =================================================================================================


def test_the_law_names_the_retired_capability_and_the_one_chooser() -> None:
    """A capability no law mentions is invisible to the ledger, and that is as true of one that
    was retired as of one that ships. The law has to say which chooser is the authority, name
    the retired door, and say why it went, so nobody rebuilds it."""
    law = LAW.read_text(encoding="utf-8")
    assert "## Who chooses" in law
    section = law.split("## Who chooses", 1)[1]
    assert "`curriculum.climb`" in section
    assert "`groupFor`" in section
    assert "retired" in section.lower()
    for reason in ("metered", "offline", "39548ee9"):
        assert reason in section, f"the law does not say {reason!r}"
