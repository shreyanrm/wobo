"""Drift gate for the blueprint contract.

The Pydantic models in ``plexus/blueprint_spec.py`` are the source of truth. The committed
``packages/contracts/schemas/blueprint.schema.json`` is what the client reads, and this fails if
they part company. Regenerate with ``uv run python -m wobo_gateway.plexus.blueprint_spec``.

The second test is the one that matters for safety: a blueprint model must FORBID what it does not
declare. The card specs deliberately do not (``engines.py`` is their gate); a blueprint has no
second gate, so a key nobody modelled is how executable content would arrive.
"""

from __future__ import annotations

from wobo_gateway.plexus import blueprint_spec
from wobo_gateway.plexus.specs import PRIMITIVE_MODELS


def test_the_committed_schema_is_current() -> None:
    assert blueprint_spec.SCHEMA_PATH.exists(), (
        "run `uv run python -m wobo_gateway.plexus.blueprint_spec`"
    )
    assert blueprint_spec.SCHEMA_PATH.read_text(encoding="utf-8") == blueprint_spec.render(), (
        "blueprint.schema.json is stale — regenerate it"
    )


def test_every_exported_model_reaches_the_schema() -> None:
    defs = blueprint_spec.build_schema()["$defs"]
    for model in blueprint_spec.EXPORTED:
        assert model.__name__ in defs, f"{model.__name__} missing from the blueprint schema"


def test_every_blueprint_model_forbids_what_it_does_not_declare() -> None:
    for model in blueprint_spec.EXPORTED:
        assert model.model_config.get("extra") == "forbid", model.__name__
        schema = model.model_json_schema()
        assert schema.get("additionalProperties") is False, model.__name__


def test_the_mechanic_vocabulary_is_the_client_s_own_primitive_table() -> None:
    """The architect can never propose a mechanic the client has no renderer for: the vocabulary
    IS ``specs.PRIMITIVE_MODELS``, so a primitive added there is available here the same day and a
    primitive removed there refuses every blueprint that still names it."""
    from typing import get_args

    assert set(blueprint_spec.PRIMITIVES) == set(PRIMITIVE_MODELS)
    assert set(get_args(blueprint_spec.PrimitiveKind)) == set(PRIMITIVE_MODELS)
