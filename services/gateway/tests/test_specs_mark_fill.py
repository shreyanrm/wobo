"""SCORECARD.md 3.5 #3: the Mark schema carries the fill the discovery shell renders.

Discovery.tsx has read ``fill: 'soft' | 'solid'`` since CONTENT-VISUALS.md 3.1, and the compose
prompt asks for it, but the wire schema never declared it. Additive: an absent fill is still an
outline, an unknown fill is refused.
"""

import pytest
from pydantic import ValidationError

from wobo_gateway.plexus.specs import Mark


def _mark(**extra):
    return {"id": "m1", "shape": "circle", "x": 50.0, "y": 31.0, "r": 4.0, **extra}


def test_mark_carries_a_fill():
    assert Mark.model_validate(_mark(fill="solid")).fill == "solid"
    assert Mark.model_validate(_mark(fill="soft")).fill == "soft"
    assert Mark.model_validate(_mark(fill="solid")).model_dump()["fill"] == "solid"


def test_fill_is_optional_and_defaults_to_an_outline():
    assert Mark.model_validate(_mark()).fill is None


def test_an_unknown_fill_is_refused():
    with pytest.raises(ValidationError):
        Mark.model_validate(_mark(fill="gradient"))
