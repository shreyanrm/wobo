"""The blueprint contract: the architect's output as Pydantic, and the JSON Schema it emits.

**What a blueprint is.** docs/CONTENT-INTERACTION.md section 9 (the owner: *"Astra should be like
a designer, an architect, a visionary; how a topic could be split and taught in the best possible
ways, how the flow should be, what types and sub-modules or levels there should be"*), amended by
docs/LEARNING-MODEL.md, which wins where the two differ: the architect's output is a **chapter's
pool of modules** plus the map of which module can teach which topic, never a linear list of levels
living inside a topic. A module is one sitting; a GROUP of modules teaches a topic; a module may
serve several topics, which is exactly why it sits at the chapter and not inside a topic.

**Why these models are strict and the card specs are not.** ``specs.Spec`` lets an unmodelled key
through, because ``engines.py`` is the gate that decides which activity fields survive. A blueprint
has no such second gate: it is written by the most expensive model we own, cached for every learner
of a cell, and read by the client. So every model here forbids what it does not declare, and a
``script``, a ``code`` or an ``onClick`` refuses the whole document at the door. Nothing generated
ever executes on a learner's device: a mechanic is a composition of the primitives
``specs.PRIMITIVE_MODELS`` declares, named by kind, and the schema is the contract.

The emitted schema is ``packages/contracts/schemas/blueprint.schema.json``, checked in and
drift-gated by ``tests/test_plexus_blueprint_schema.py``. Regenerate with:
``uv run python -m wobo_gateway.plexus.blueprint_spec``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.json_schema import models_json_schema

from wobo_gateway.plexus.specs import PRIMITIVE_MODELS

#: The mechanic vocabulary, by kind. It IS the primitive table the interaction schema declares
#: (``specs.PRIMITIVE_MODELS``), so the architect can never propose a mechanic the client has no
#: renderer for, and a primitive added there is available here the same day.
PRIMITIVES: tuple[str, ...] = tuple(sorted(PRIMITIVE_MODELS))

#: What a module IS — section 9's "kind".
KINDS: tuple[str, ...] = ("reading", "worked", "simulation", "film", "items", "game", "boss")

#: What a module is FOR. This is the half of the pool laws a per-learner selection can read
#: WITHOUT opening the content, which is what makes choosing a group free
#: (docs/LEARNING-MODEL.md section 4: "it is a selection, not a generation").
ROLES: tuple[str, ...] = (
    "way_in",
    "check",
    "repair",
    "stretch",
    "prerequisite",
    "side_door",
    "boss",
)

PrimitiveKind = Literal[
    "branch",
    "drag",
    "drop",
    "mark",
    "match",
    "score",
    "sequence",
    "slide",
    "sort",
    "tap",
    "timer",
    "reveal",
]
ModuleKind = Literal["reading", "worked", "simulation", "film", "items", "game", "boss"]
ModuleRole = Literal["way_in", "check", "repair", "stretch", "prerequisite", "side_door", "boss"]

#: One sitting (docs/LEARNING-MODEL.md section 1: "five to ten minutes").
MIN_MINUTES = 5
MAX_MINUTES = 10


class BlueprintModel(BaseModel):
    """Base for every blueprint model. Declares what it declares, and refuses the rest."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class MechanicCandidate(BlueprintModel):
    """One candidate interaction for a module: a composition of primitives, never code.

    Two or three of these ride on every module, so the ninety-day rotation of
    docs/CONTENT-INTERACTION.md section 3 is a pick from what is already stored and never a second
    bill on the create tier. ``wrongMoveTeaches`` is the judge's first question: a wrong move must
    teach something about the IDEA, not about the game.
    """

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    primitives: list[PrimitiveKind] = Field(min_length=1, max_length=5)
    moves: str = Field(min_length=1)
    responds: str = Field(min_length=1)
    wrongMoveTeaches: str = Field(min_length=1)


class BlueprintTopic(BlueprintModel):
    """A topic of the BOARD's own syllabus: what must be learned. Never ours, never invented."""

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)


class BlueprintIdea(BlueprintModel):
    """One idea a topic is held by. Mastery is evidence these are held, never a module count."""

    id: str = Field(min_length=1)
    what: str = Field(min_length=1)
    topics: list[str] = Field(min_length=1)


class BlueprintMisconception(BlueprintModel):
    """A wrong idea the topic is known to produce. Mastery is evidence it is gone."""

    id: str = Field(min_length=1)
    what: str = Field(min_length=1)
    topics: list[str] = Field(min_length=1)


class BlueprintAssumption(BlueprintModel):
    """Something the chapter assumes and the board does not re-teach."""

    id: str = Field(min_length=1)
    what: str = Field(min_length=1)
    fromChapter: str | None = None


class BlueprintModule(BlueprintModel):
    """One module of the chapter's pool: one idea, one mechanic, one sitting.

    Every field here exists so the planner can choose a group WITHOUT reading the content
    (docs/LEARNING-MODEL.md section 5, last bullet).
    """

    id: str = Field(min_length=1)
    aim: str = Field(min_length=1)
    kind: ModuleKind
    role: ModuleRole
    #: topic ids this module can teach — the map that lets one module serve several topics
    #: an empty list is a real fault with a named refusal, not a parse failure
    serves: list[str] = Field(default_factory=list)
    #: idea ids it carries
    teaches: list[str] = Field(default_factory=list)
    #: the concept cores ``create.core`` must then make for it
    cores: list[str] = Field(min_length=1)
    #: the misconception id it repairs, when repairing is what it is for
    repairs: str | None = None
    #: assumption ids it leans on
    assumes: list[str] = Field(default_factory=list)
    minutes: int = Field(ge=1, le=240)
    mechanics: list[MechanicCandidate] = Field(min_length=2, max_length=3)


class BlueprintSideDoor(BlueprintModel):
    """A bonus level off the climb: optional, mid-chapter, never in the path, never a nag."""

    after: str = Field(min_length=1)
    module: str = Field(min_length=1)
    rehearses: str = Field(min_length=1)


class BlueprintStuckRoute(BlueprintModel):
    """What a stuck learner is shown INSTEAD. Never the same module said louder."""

    module: str = Field(min_length=1)
    instead: str = Field(min_length=1)
    why: str = Field(min_length=1)


class BlueprintFlow(BlueprintModel):
    """The order and why, where the side doors and the boss go, where a skip is allowed."""

    order: list[str] = Field(min_length=1)
    why: str = Field(min_length=1)
    sideDoors: list[BlueprintSideDoor] = Field(default_factory=list)
    boss: str = Field(min_length=1)
    bossProves: str = Field(min_length=1)
    skippable: list[str] = Field(default_factory=list)
    neverSkip: list[str] = Field(default_factory=list)
    #: empty is a named refusal (a flow that says nothing about a stuck learner), not a parse error
    stuck: list[BlueprintStuckRoute] = Field(default_factory=list)


class Blueprint(BlueprintModel):
    """``create.blueprint`` output: one chapter's pool, keyed node x board x class x version."""

    node: str = Field(min_length=1)
    chapter: str = Field(min_length=1)
    board: str = Field(min_length=1)
    grade: str = Field(min_length=1)
    subject: str = Field(min_length=1)
    contentVersion: str = Field(min_length=1)
    #: the one idea the chapter is really about, in a sentence a learner of that class would say
    thread: str = Field(min_length=1)
    topics: list[BlueprintTopic] = Field(min_length=1)
    ideas: list[BlueprintIdea] = Field(min_length=1)
    misconceptions: list[BlueprintMisconception] = Field(min_length=1)
    assumptions: list[BlueprintAssumption] = Field(default_factory=list)
    modules: list[BlueprintModule] = Field(min_length=1)
    flow: BlueprintFlow

    def module_by_id(self, mid: str) -> BlueprintModule | None:
        for m in self.modules:
            if m.id == mid:
                return m
        return None


EXPORTED: tuple[type[BaseModel], ...] = (
    MechanicCandidate,
    BlueprintTopic,
    BlueprintIdea,
    BlueprintMisconception,
    BlueprintAssumption,
    BlueprintModule,
    BlueprintSideDoor,
    BlueprintStuckRoute,
    BlueprintFlow,
    Blueprint,
)

_HEADER = "generated by wobo_gateway.plexus.blueprint_spec — do not edit by hand"

SCHEMA_PATH = (
    Path(__file__).resolve().parents[5]
    / "packages"
    / "contracts"
    / "schemas"
    / "blueprint.schema.json"
)


def build_schema() -> dict:
    _, defs = models_json_schema(
        [(m, "serialization") for m in EXPORTED], by_alias=True, ref_template="#/$defs/{model}"
    )
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$comment": _HEADER,
        "$defs": defs["$defs"],
    }


def render() -> str:
    return json.dumps(build_schema(), indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    text = render()
    if "--check" in sys.argv[1:]:
        current = SCHEMA_PATH.read_text(encoding="utf-8") if SCHEMA_PATH.exists() else ""
        if current != text:
            print(f"DRIFT: {SCHEMA_PATH} is stale — rerun this module")
            return 1
        print(f"ok: {SCHEMA_PATH} matches blueprint_spec.py")
        return 0
    SCHEMA_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_PATH.write_text(text, encoding="utf-8")
    print(f"wrote {SCHEMA_PATH} ({len(EXPORTED)} models)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
