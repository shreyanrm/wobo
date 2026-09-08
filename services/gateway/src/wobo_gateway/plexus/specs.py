"""The one card-spec contract, as Pydantic models.

These model the **served** (verified/clean) shapes the four Plexus engines emit — the exact
JSON a learner's client receives. They are the single source of truth for the spec contract
(SUBJECTS.md §7): Pydantic here → JSON Schema → generated TypeScript in
``packages/contracts/src/generated/plexus.ts``. Backend and frontend cannot drift because both
are generated from this file.

Scope note (deliberate): these mirror what the gateway *constructs and owns* in
``engines._verify_*`` — the compose ``CourseSpec`` (cards / workbook / boss / discovery /
imageSpec), ``SimSpec``, and ``VideoSpec``. The ten optional rich-activity fields a card may
carry (perturbation, whatIf, …) are **preserved verbatim** by the verifier — the client parser
is their authoritative shape — so they ride here as pass-through objects, not re-encoded (that
would duplicate client logic and invite drift). Runtime parsing in ``engines.py`` stays as-is;
this module only formalizes the contract for codegen and typed client adoption.

Regenerate with: ``uv run python -m wobo_gateway.plexus.codegen`` (schema) then the bun
wiring (``bun run --filter @wobo/contracts codegen``) for the TypeScript.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# --- shared primitives ------------------------------------------------------------------

CardKind = Literal["sim", "diagram", "text"]
ActKind = Literal["tap", "drag", "slide", "type"]
ItemType = Literal["mcq", "fill"]
MarkShape = Literal["circle", "rect", "line", "ring", "text"]
Tone = Literal["ink", "muted", "hue"]


class Spec(BaseModel):
    """Base for every card-spec model.

    The docstring used to claim it forbade unmodelled fields. It never did — no ``extra`` was
    set, so Pydantic's default (``ignore``) applied and an unmodelled key was silently dropped
    rather than refused. The claim is removed rather than enforced: engines.py is the gate that
    decides which activity fields survive (``_CARD_ACTIVITIES``), and turning these models into
    a second, stricter gate would reject drafts that gate already accepted.
    """

    model_config = ConfigDict(populate_by_name=True)


# --- compose: the guided-discovery micro-course (engine.compose) ------------------------


class Interaction(Spec):
    """The single act a card asks for before it reveals anything."""

    kind: ActKind
    prompt: str


class Mark(Spec):
    """One shape on a discovery stage's reactive canvas (0..100 by 0..62)."""

    id: str
    shape: MarkShape
    x: float
    y: float
    tone: Tone = "ink"
    x2: float | None = None
    y2: float | None = None
    r: float | None = None
    w: float | None = None
    h: float | None = None
    text: str | None = None
    # A tactile filled body at rest (CONTENT-VISUALS.md 3.1): "solid" is a chunky object, "soft" a
    # roomy tinted container. Absent is an outline: axes, rays, leaders. Discovery.tsx has read
    # this field all along and the compose prompt asks for it; the schema never declared it.
    fill: Literal["soft", "solid"] | None = None


class TapInteraction(Spec):
    kind: Literal["tap"]
    prompt: str
    targets: list[str]
    need: int


class DragTo(Spec):
    x: float
    y: float


class DragInteraction(Spec):
    kind: Literal["drag"]
    prompt: str
    handle: str
    to: DragTo
    radius: float


class SlideBind(Spec):
    mark: str
    prop: Literal["x", "y", "r"]
    at: list[float]


class SlideInteraction(Spec):
    kind: Literal["slide"]
    prompt: str
    min: float
    max: float
    # ``from`` is a Python keyword; the wire/schema property name stays "from".
    from_: float = Field(alias="from")
    at: float
    unit: str | None = None
    valueLabel: str | None = None
    bind: SlideBind | None = None


DiscoveryInteraction = TapInteraction | DragInteraction | SlideInteraction


class DiscoveryVisual(Spec):
    marks: list[Mark]


class DiscoveryStage(Spec):
    visual: DiscoveryVisual
    interaction: DiscoveryInteraction
    reveal: str
    caption: str


class DiscoverySpec(Spec):
    """A card's embedded guided-discovery: 1..6 stages, one idea each."""

    id: str
    title: str
    stages: list[DiscoveryStage]


class ImageSpec(Spec):
    """Marks a card whose visual is organic/complex — hydrated through the raster seam."""

    subject: str
    caption: str | None = None


class Card(Spec):
    """One teaching card. Owned fields are strict; rich activities pass through verbatim."""

    id: str
    kind: CardKind
    title: str
    idea: str
    interaction: Interaction
    reveal: str
    discovery: DiscoverySpec | None = None
    imageSpec: ImageSpec | None = None
    # At most one rich-activity field rides alongside a card. The verifier preserves each
    # verbatim and the client parser owns its shape, so they are typed as pass-through objects
    # (not re-encoded here). See module docstring.
    perturbation: dict[str, Any] | None = None
    whatIf: dict[str, Any] | None = None
    compare: dict[str, Any] | None = None
    conceptMap: dict[str, Any] | None = None
    workbook: dict[str, Any] | None = None
    flashcards: dict[str, Any] | None = None
    derivation: dict[str, Any] | None = None
    wordProblem: dict[str, Any] | None = None
    podcast: dict[str, Any] | None = None
    arcade: dict[str, Any] | None = None
    # The subject scenes. These are rich activities exactly like the ten above — engines.py
    # accepts and preserves each through _CARD_ACTIVITIES, and the client parses each off a
    # card — but they were missing here, so the generated contract described a card that could
    # not carry any of them and every scene travelled outside the schema.
    mathScene: dict[str, Any] | None = None
    physicsScene: dict[str, Any] | None = None
    chemScene: dict[str, Any] | None = None
    bioScene: dict[str, Any] | None = None
    socialScene: dict[str, Any] | None = None
    mapScene: dict[str, Any] | None = None
    anatomyScene: dict[str, Any] | None = None


class Item(Spec):
    """A workbook / boss recall item with a structurally verified answer."""

    id: str
    type: ItemType
    prompt: str
    options: list[str] | None = None  # mcq only
    answer: str


class CourseSpec(Spec):
    """engine.compose output — the primary card-spec contract."""

    topic: str
    difficulty: str
    cards: list[Card]
    workbook: list[Item]
    boss: list[Item]


# --- simulate: the CAS-verified interactive law (engine.simulate) -----------------------


class SimParam(Spec):
    name: str
    min: float
    max: float
    default: float
    unit: str


class SimBreakpoint(Spec):
    param: str
    at: float
    why: str


class SimSpec(Spec):
    """engine.simulate output — every formula CAS-verified before it lands here."""

    params: list[SimParam]
    formula: str
    outputs: list[str]
    breakpoints: list[SimBreakpoint]
    layout: str


# --- video: the self-animating motion piece (engine.video) ------------------------------


class SceneVisual(Spec):
    kind: Literal["svg", "diagram", "sim"]
    payload: str | SimSpec


class SceneAudio(Spec):
    b64: str
    mime: str
    durationMs: int | None = None


class Scene(Spec):
    id: str
    durationMs: int
    narration: str
    visual: SceneVisual
    title: str | None = None
    audio: SceneAudio | None = None


class VideoSpec(Spec):
    """engine.video output. ``narrationAudio`` is null at verify; per-scene audio attaches live."""

    scenes: list[Scene]
    narrationAudio: Any | None = None


# engine.diagram emits a sanitized inline SVG **string** (no wrapper object), so it has no model;
# the generated TS declares it as a string alias. See codegen.

# The four served artifact shapes, in one union — the whole card-spec surface.
PlexusArtifact = CourseSpec | SimSpec | VideoSpec

# Every model exported as a named TypeScript type (order = emission order).
EXPORTED: tuple[type[BaseModel], ...] = (
    Interaction,
    Mark,
    TapInteraction,
    DragTo,
    DragInteraction,
    SlideBind,
    SlideInteraction,
    DiscoveryVisual,
    DiscoveryStage,
    DiscoverySpec,
    ImageSpec,
    Card,
    Item,
    CourseSpec,
    SimParam,
    SimBreakpoint,
    SimSpec,
    SceneVisual,
    SceneAudio,
    Scene,
    VideoSpec,
)
