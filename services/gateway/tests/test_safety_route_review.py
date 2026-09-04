"""What a child actually gets on a crisis hit, on the wire, on both live paths.

Two claims were published about this and neither was true on 2026-09-04.

1. "The turn never reaches a model. Nothing is charged, nothing is counted." It was charged. The
   board route charged the meter and THEN screened, and the capability route charged and then
   returned a normal response for a safety gate, so the ``except Exception: budget.refund``
   underneath it never fired. A child who disclosed harm paid one of their daily turns for the
   disclosure.
2. The board turn "is screened". Only ``plan.say`` was: the objects the model writes on the board
   and the question it poses to the child were passed to ``build_events`` untouched, and the board
   is the primary teaching surface.

Both are behaviours of the ROUTE rather than of the classifier, so they are tested here on the
wire rather than against ``safety.py``.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import budget
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.board import stream
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

SSE = {"Accept": "text/event-stream"}
DISCLOSURE = "my dad hits me"


@pytest.fixture(autouse=True)
def _clean(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    stream.reset()
    budget.reset()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def _turn(text: str) -> dict[str, Any]:
    return {"payload": {"context": {"turn": {"lastUserInput": text}}}}


def _remaining(res: Any) -> int:
    return int(res.headers["X-Wobo-Budget-Remaining"])


# --- 1. a disclosure costs a child nothing --------------------------------------------------


def test_a_crisis_on_the_capability_route_is_not_charged(client: TestClient, auth) -> None:
    """A child in trouble does not spend one of their turns on saying so."""
    warm = client.post("/v1/capability/wobo.turn", json=_turn("teach me fractions"),
                       headers=auth())
    assert warm.status_code == 200
    before = _remaining(warm)

    gated = client.post("/v1/capability/wobo.turn", json=_turn(DISCLOSURE), headers=auth())
    assert gated.status_code == 200
    assert gated.json()["output"]["safety"]["category"] == "crisis"
    assert _remaining(gated) == before, "the disclosure was charged to the child"

    after = client.post("/v1/capability/wobo.turn", json=_turn("teach me fractions"),
                        headers=auth())
    assert _remaining(after) == before - 1


def test_a_crisis_on_the_board_route_is_not_charged(client: TestClient, auth) -> None:
    """Same claim, the other live path — the one a learner on the board actually takes."""
    warm = client.post("/v1/capability/wobo.turn", json=_turn("graph y = x^2"),
                       headers={**auth(), **SSE})
    assert warm.status_code == 200
    before = _remaining(warm)

    gated = client.post("/v1/capability/wobo.turn", json=_turn(DISCLOSURE),
                        headers={**auth(), **SSE})
    assert gated.status_code == 200
    assert "Childline" in gated.text
    assert _remaining(gated) == before, "the disclosure was charged to the child"


# --- 2. the board's own words are screened ---------------------------------------------------


def test_the_board_screens_the_words_it_writes_and_the_question_it_asks() -> None:
    """``build_events`` turns every object into an ``ink`` event and ``plan.ask`` into an ``ask``
    event. Both are model output and both must go through the outbound screen."""
    from wobo_gateway import safety

    plan_like = {
        "say": "here is the working",
        "actions": [],
        "objects": [
            {"kind": "write", "text": "step one"},
            {"kind": "label", "text": "you should kill yourself"},
        ],
        "ask": {"prompt": "which step is wrong", "targets": []},
    }
    screened = safety.screen_outbound(plan_like)
    assert screened["say"] != "here is the working"
    assert screened["objects"] == []
    assert screened["ask"] is None
    assert screened["safety"]["action"] == "blocked"


def test_the_board_screen_leaves_an_ordinary_lesson_alone() -> None:
    from wobo_gateway import safety

    plan_like = {
        "say": "in Act 1 Macbeth resolves to kill him",
        "actions": [],
        "objects": [{"kind": "label", "text": "Act 1, scene 7"}],
        "ask": {"prompt": "what does Lady Macbeth want", "targets": []},
    }
    assert safety.screen_outbound(plan_like) is plan_like


def test_a_board_stream_never_inks_a_screened_object(client: TestClient, auth, monkeypatch) -> None:
    """End to end: a plan whose OBJECT carries the harm, over the real wire."""
    from wobo_gateway import wobo

    def _poisoned(payload: dict[str, Any], *, live: bool = False) -> dict[str, Any]:
        return {
            "say": "here is the working",
            "presentation": "plane",
            "objects": [
                {
                    "id": "n1",
                    "kind": "write",
                    "anchor": {"board": [10, 10]},
                    "text": "you should kill yourself",
                }
            ],
            "ask": {"prompt": "which step is wrong", "targets": []},
        }

    monkeypatch.setattr(wobo, "board_plan_for", _poisoned)
    res = client.post("/v1/capability/wobo.turn", json=_turn("graph y = x^2"),
                      headers={**auth(), **SSE})
    assert res.status_code == 200
    assert "kill yourself" not in res.text
    inked = [b for b in res.text.split("\n\n") if "event: ink" in b]
    assert inked == []
    assert [b for b in res.text.split("\n\n") if "event: ask" in b] == []


def _frames(body: str) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for block in body.split("\n\n"):
        if not block.strip() or block.startswith(":"):
            continue
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        if "event" in fields:
            out.append((fields["event"], json.loads(fields["data"])))
    return out


def test_an_ordinary_board_turn_still_draws(client: TestClient, auth) -> None:
    res = client.post("/v1/capability/wobo.turn",
                      json=_turn("graph y = x^2 with the tangent at x = 1"),
                      headers={**auth(), **SSE})
    assert res.status_code == 200
    kinds = {kind for kind, _ in _frames(res.text)}
    assert "say" in kinds
    assert "done" in kinds
