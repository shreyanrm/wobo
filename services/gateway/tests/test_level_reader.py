"""TWO READERS, MEASURED — the level's length is cut for the class, by code, not by hope.

``_LEVEL_RULE``: *"A class 6 child and a class 11 student must read two visibly different lessons
off this one core."* The half of that a machine can enforce for nothing is the LENGTH, and until
this file it was enforced on the no-model fallback only: ``_level_words`` (26 words a card at class
6, 38 at 7-9, 55 above) was read by ``_level_from_core`` and by nothing on the live path, where
``_verify_compose`` cut every card to the grade-agnostic ``_CARD_WORD_CAP`` of 60.

The measured consequence, from the wave's own headline report (three-layers-20260910-062054.json):
the class-6 renderings ran 1183, 1468, 1068, 1195, 1310 words and the class-11 renderings 1263,
1111, 1109, 1443, 1106 — the ten-year-olds read MORE than the seventeen-year-olds. A brief key the
prompt never named was the whole of the enforcement, and a model that ignored it was never cut.

So the tests below give the model a rendering that ignores the cap, exactly as the live one did,
and require the pipeline to cut it anyway.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from wobo_gateway.plexus import engines

CBSE_6 = {"board": "CBSE", "grade": "6", "subject": "Science", "contentVersion": "2026-27"}
ISC_11 = {"board": "ISC", "grade": "11", "subject": "Biology", "contentVersion": "2026-27"}

CORE = {
    "shape": "structure",
    "idea": "A leaf is built from tiny cells, each one a room with its own walls and its own work.",
    "why": "Every part of a plant is made of them, so the cell is where the plant's life happens.",
    "misconceptions": [
        {"belief": "a cell is a hollow bubble", "counter": "it is full of working parts"},
        {"belief": "cells are visible", "counter": "a leaf's cells need a microscope"},
    ],
    "check": {"question": "What is a leaf built from?", "answer": "cells"},
    "vocabulary": [
        {"term": "cell", "meaning": "the smallest living unit"},
        {"term": "wall", "meaning": "the stiff boundary of a plant cell"},
    ],
}

#: A hundred words of prose. What the live models actually returned: a paragraph, at every class.
LONG = " ".join(f"word{i}" for i in range(100))


def _rendering() -> dict[str, Any]:
    """A level rendering that IGNORES the brief's cap, the way the measured one did."""
    cards = [
        {
            "id": f"c{i}",
            "kind": "text",
            "title": f"card {i}",
            "idea": LONG,
            "interaction": {"kind": "tap", "prompt": "tap the wall"},
            "reveal": LONG,
        }
        for i in range(1, 5)
    ]
    items = [
        {"id": "w1", "type": "fill", "prompt": "a leaf is built from ________.", "answer": "cells"},
        {
            "id": "w2",
            "type": "fill",
            "prompt": "the stiff boundary is the ________.",
            "answer": "wall",
        },
        {
            "id": "w3",
            "type": "mcq",
            "prompt": "what is inside a cell?",
            "options": ["working parts", "nothing at all"],
            "answer": "working parts",
        },
    ]
    return {"topic": "the plant cell", "cards": cards, "workbook": items, "boss": items}


def _words(text: str) -> int:
    return len(str(text).split())


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        engines,
        "_complete",
        lambda *a, **k: (json.dumps(_rendering()), 400),
    )


def _render(scope: dict[str, str]) -> dict[str, Any]:
    out, _model, _tokens, _seeded = engines._render_level_live(
        "the plant cell",
        "core",
        "stub/model",
        (),
        {"board": scope["board"], "class": scope["grade"]},
        scope,
        {"core": CORE, "version": "1"},
    )
    return out


def test_a_class_six_card_is_cut_to_a_class_six_length() -> None:
    """26 words a card at class 6, whatever the model wrote. The cap is code, not a request."""
    course = _render(CBSE_6)
    cap = engines._level_words("6")
    assert cap == 26
    for card in course["cards"]:
        assert _words(card["idea"]) <= cap, card["idea"]
        assert _words(card["reveal"]) <= cap


def test_the_ten_year_old_never_reads_more_than_the_seventeen_year_old() -> None:
    """The measured failure, as an assertion: class 6 < class 11, off one core and one model."""
    six = _render(CBSE_6)
    eleven = _render(ISC_11)

    def total(course: dict[str, Any]) -> int:
        return sum(_words(c["idea"]) + _words(c["reveal"]) for c in course["cards"])

    assert total(six) < total(eleven)
    assert all(_words(c["idea"]) <= 55 for c in eleven["cards"])


def test_the_rule_names_the_cap_the_brief_carries() -> None:
    """A key in the JSON brief that no sentence of the prompt names is a key a model ignores."""
    assert "cardWordCap" in engines._LEVEL_RULE


def test_a_full_generation_is_still_cut_to_the_grade() -> None:
    """The fallback path is a lesson too. A class 6 child gets class 6 lengths there as well."""
    out = engines._verify_artifact("compose", _rendering(), "the plant cell", "core", word_cap=26)
    assert out is not None
    assert all(_words(c["idea"]) <= 26 for c in out["cards"])
    wide = engines._verify_artifact("compose", _rendering(), "the plant cell", "core")
    assert wide is not None
    assert _words(wide["cards"][0]["idea"]) == engines._CARD_WORD_CAP
