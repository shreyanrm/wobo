"""Drawing where the learner is looking (the owner, 2026-09-05).

"wobo doesn't have to draw every single time on the board, it can draw onto the screen as well
cause it knows the context anyways." It does know: every screen registers its parts as targets
with stable ids, and a mark anchored to one lands on it and follows it. What was missing was the
CHOICE. These tests hold both branches of it, keyless and through the real door.
"""

from __future__ import annotations

import json

from wobo_gateway.wobo import mock_board_plan, target_named_by

TRIANGLE = [
    {"id": "tri-leg-a", "kind": "side", "label": "the base, 3 cm"},
    {"id": "tri-leg-b", "kind": "side", "label": "the height, 4 cm"},
    {"id": "tri-hyp", "kind": "side", "label": "the hypotenuse"},
    {"id": "tri-right", "kind": "angle", "label": "the right angle"},
]


def _payload(text: str, targets: list[dict] | None = TRIANGLE, route: str = "practice") -> dict:
    context: dict = {
        "page": {"route": route, "state": {}},
        "turn": {"lastUserInput": text},
    }
    if targets is not None:
        context["targets"] = targets
    return {"context": context}


def test_a_question_about_something_on_the_screen_is_answered_on_the_screen() -> None:
    plan = mock_board_plan(_payload("which side is the hypotenuse?"))
    assert plan is not None
    assert plan["intents"] == []
    anchors = [o["anchor"] for o in plan["objects"]]
    assert all(a.get("target") == "tri-hyp" for a in anchors), anchors
    assert plan["ask"]["targets"] == ["tri-hyp"]


def test_the_ring_lands_on_the_target_the_words_name_not_the_first_one() -> None:
    assert target_named_by("what is the right angle for?", TRIANGLE)["id"] == "tri-right"
    assert target_named_by("why is the height 4 cm", TRIANGLE)["id"] == "tri-leg-b"


def test_a_question_that_names_nothing_on_the_screen_marks_nothing() -> None:
    """A ring round the nearest chip because the sentence had the word "the" in it would be a
    pointer at nothing — the failure BOARD.md §11 names. Stopwords never name a target."""
    assert target_named_by("what is this about?", TRIANGLE) is None
    assert mock_board_plan(_payload("what is this about?")) is None


def test_a_screen_with_no_targets_registered_cannot_be_annotated() -> None:
    assert mock_board_plan(_payload("which side is the hypotenuse?", targets=None)) is None


def test_something_new_to_build_still_gets_the_board_even_with_the_chip_on_screen() -> None:
    """The other branch: the hypotenuse chip is on the screen, but the ask is for the squares on
    the sides, which are not. That is something to build, so it is a pipeline intent, not a mark."""
    plan = mock_board_plan(
        _payload("draw the right triangle with legs 3 and 4 and construct the squares on each side")
    )
    assert plan is not None
    assert plan["intents"], plan
    assert plan["intents"][0]["pipeline"] == "math"


def test_through_the_real_door_the_board_never_opens_for_a_mark_on_the_screen(
    auth, monkeypatch, tmp_path
) -> None:
    """The whole path: the request, the planner, the stream, the ``done`` frame the client reads."""
    from fastapi.testclient import TestClient
    from wobo_gateway.app import build_gateway, create_app

    monkeypatch.setenv("LLM_MODE", "mock")
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    client = TestClient(create_app(build_gateway()))
    response = client.post(
        "/v1/capability/wobo.turn",
        json={"payload": _payload("which side is the hypotenuse?")},
        headers={"Accept": "text/event-stream", **auth()},
    )
    assert response.status_code == 200, response.text
    frames = [
        json.loads(block.split("data: ", 1)[1].splitlines()[0])
        for block in response.text.split("\n\n")
        if "data: " in block
    ]
    inked = [f["object"] for f in frames if isinstance(f.get("object"), dict)]
    done = next(f for f in frames if f.get("presentation") is not None and "verified" in f)
    assert done["presentation"] == "screen"
    assert done["objects"] == len(inked) == 2
    assert {o["anchor"]["target"] for o in inked} == {"tri-hyp"}
