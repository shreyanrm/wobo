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

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


# --- the stage, and the two things every interaction primitive needs --------------------
#
# docs/CONTENT-INTERACTION.md §3: the model DESIGNS the mechanic and writes it as a composition
# of these primitives, never as code. Two laws bind every one of them, and they are declared here
# once so a primitive cannot be added without them:
#
#   • a hit area a finger can use (DESIGN.md: 44 css px at 390 wide), and
#   • a feedback slot, because a wrong move must teach something about the IDEA.

#: The stage's coordinate space, shared verbatim with ``Discovery.tsx``: 0..100 by 0..62.
STAGE_W = 100.0
STAGE_H = 62.0

#: What one stage unit measures on a 390-wide phone — ``Discovery.tsx``'s own PHONE_PX_PER_UNIT.
PHONE_PX_PER_UNIT = 3.3

#: The law: 44 css px across is the smallest thing a finger can be asked to land on.
MIN_HIT_PX = 44.0

#: …which is 13.33 stage units. Every touchable primitive is at least this big, enforced by the
#: schema rather than by a reviewer's eye (SCORECARD §3.5 #3: 96 of 96 maths marks had no hit
#: area a real finger could land on, and nothing in the contract said they had to).
MIN_HIT_UNITS = MIN_HIT_PX / PHONE_PX_PER_UNIT


class Feedback(Spec):
    """What a move teaches. Every primitive carries one.

    ``wrong`` is the load-bearing half: it must say something about the concept ("a third is a
    smaller share than a half"), never about the game ("try again"). The gate reads it.
    """

    right: str
    wrong: str
    hint: str | None = None


class HitBox(Spec):
    """A touchable rectangle on the stage, never smaller than a finger and never off the edge."""

    x: float = Field(ge=0, le=STAGE_W)
    y: float = Field(ge=0, le=STAGE_H)
    w: float = Field(ge=MIN_HIT_UNITS)
    h: float = Field(ge=MIN_HIT_UNITS)

    @model_validator(mode="after")
    def _on_the_stage(self) -> HitBox:
        if self.x + self.w > STAGE_W + 1e-9 or self.y + self.h > STAGE_H + 1e-9:
            raise ValueError(
                f"hit box runs off the {STAGE_W:g} by {STAGE_H:g} stage: "
                f"({self.x:g},{self.y:g}) {self.w:g}x{self.h:g}"
            )
        return self


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
    # The feedback slot §3 asks of every primitive. Optional on the three that predate it, so a
    # course already in the cache still validates; the designer always fills it.
    feedback: Feedback | None = None


class DragTo(Spec):
    x: float
    y: float


class DragInteraction(Spec):
    kind: Literal["drag"]
    prompt: str
    handle: str
    to: DragTo
    radius: float
    feedback: Feedback | None = None


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
    feedback: Feedback | None = None


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


# =========================================================================================
# The interaction vocabulary (docs/CONTENT-INTERACTION.md §3)
#
# Today's three acts — tap, drag, slide — are above, where compose has always used them. These
# are the rest of the vocabulary the designer composes from: drop zones with rules, sort, match,
# sequence, timer, score, reveal, branch-on-answer and canvas mark.
#
# A design is a COMPOSITION of these, never code. Nothing generated executes on a learner's
# device: the client renders a composition the schema accepted, and a composition the schema
# refuses never ships. That is the same contract simulations have had since wave 20.
# =========================================================================================


class DropToken(Spec):
    """A thing the learner picks up. ``why`` is the reason it belongs where it belongs — the
    wrong-drop line is written from it, so a wrong drop teaches the idea rather than the game."""

    id: str
    label: str
    box: HitBox
    belongs: str
    why: str


class DropZone(Spec):
    """A bin with a rule.

    The rule, in its simplest honest form, is ``accepts``: the tokens this zone is for. A token
    outside it is refused with this zone's own ``feedback`` — "a third is a smaller share than a
    half", not "wrong". ``capacity`` caps a zone that must hold exactly n.
    """

    id: str
    label: str
    box: HitBox
    accepts: list[str] = Field(min_length=1)
    capacity: int | None = Field(default=None, ge=1)
    feedback: Feedback


class DropInteraction(Spec):
    """Drop each token into the bin its rule admits. The classification row of §2."""

    kind: Literal["drop"]
    prompt: str
    tokens: list[DropToken] = Field(min_length=2, max_length=8)
    zones: list[DropZone] = Field(min_length=2, max_length=4)
    feedback: Feedback

    @model_validator(mode="after")
    def _rules_close_over_the_tokens(self) -> DropInteraction:
        ids = {t.id for t in self.tokens}
        zone_ids = {z.id for z in self.zones}
        for zone in self.zones:
            unknown = [t for t in zone.accepts if t not in ids]
            if unknown:
                raise ValueError(f"zone {zone.id} accepts tokens that do not exist: {unknown}")
        for token in self.tokens:
            if token.belongs not in zone_ids:
                raise ValueError(f"token {token.id} belongs to no zone ({token.belongs})")
        return self


class SortItem(Spec):
    """One card in an ordering, with its true place and why it sits there."""

    id: str
    label: str
    box: HitBox
    rank: int = Field(ge=1)
    why: str


class SortInteraction(Spec):
    """Put a set into its order, all at once. The ordering row of §2."""

    kind: Literal["sort"]
    prompt: str
    items: list[SortItem] = Field(min_length=3, max_length=7)
    axis: Literal["vertical", "horizontal"] = "vertical"
    feedback: Feedback

    @model_validator(mode="after")
    def _the_order_is_a_real_order(self) -> SortInteraction:
        ranks = sorted(i.rank for i in self.items)
        if ranks != list(range(1, len(self.items) + 1)):
            raise ValueError(f"ranks must be 1..{len(self.items)} with no gaps or ties: {ranks}")
        return self


class MatchPair(Spec):
    id: str
    left: str
    right: str
    why: str


class MatchInteraction(Spec):
    """Join each left to its right. The correspondence row of §2.

    ``card`` is the size of ONE card; the client lays two columns of that size out, which is how
    a finger's law is expressed for a layout the spec does not place by hand.
    """

    kind: Literal["match"]
    prompt: str
    pairs: list[MatchPair] = Field(min_length=2, max_length=6)
    card: HitBox
    feedback: Feedback

    @model_validator(mode="after")
    def _no_pair_is_ambiguous(self) -> MatchInteraction:
        for side in ("left", "right"):
            values = [getattr(p, side) for p in self.pairs]
            if len(set(values)) != len(values):
                raise ValueError(f"two pairs share a {side}, so the match has no one answer")
        return self


class SequenceStep(Spec):
    """One step of a construction, and the check that opens the next one."""

    id: str
    label: str
    box: HitBox
    check: str
    feedback: Feedback


class SequenceInteraction(Spec):
    """Build it step by step, with a check at each step. The construction row of §2.

    Not a sort: a sort ranks a set that is already on the table, a sequence makes the next thing
    only once the last one holds.
    """

    kind: Literal["sequence"]
    prompt: str
    steps: list[SequenceStep] = Field(min_length=2, max_length=6)
    feedback: Feedback


class BranchOption(Spec):
    """One answer. A wrong one must be a REAL misconception and must say what it teaches."""

    id: str
    label: str
    box: HitBox
    correct: bool
    teaches: str = ""
    goto: str | None = None


class BranchInteraction(Spec):
    """Branch on the answer: a wrong choice routes to the beat that repairs it. §2's
    discrimination row, and the only recognition primitive in the vocabulary."""

    kind: Literal["branch"]
    prompt: str
    options: list[BranchOption] = Field(min_length=2, max_length=5)
    feedback: Feedback

    @model_validator(mode="after")
    def _something_to_discriminate(self) -> BranchInteraction:
        right = [o for o in self.options if o.correct]
        wrong = [o for o in self.options if not o.correct]
        if not right or not wrong:
            raise ValueError("a branch needs at least one right answer and at least one wrong one")
        for option in wrong:
            if not option.teaches.strip():
                raise ValueError(
                    f"wrong option {option.id} teaches nothing; a distractor must be a real "
                    "misconception with the counter-example in `teaches`"
                )
        return self


class CanvasTarget(Spec):
    """A place on the stage a mark must land, with the finger's radius around it."""

    id: str
    x: float = Field(ge=0, le=STAGE_W)
    y: float = Field(ge=0, le=STAGE_H)
    r: float = Field(default=MIN_HIT_UNITS / 2, ge=MIN_HIT_UNITS / 2)
    why: str


class CanvasMarkInteraction(Spec):
    """Mark the stage itself: a point, a line, a circle, a path. The learner draws the answer
    rather than choosing it, and the drawing is checked against targets, never rendered as code."""

    kind: Literal["mark"]
    prompt: str
    tool: Literal["point", "line", "circle", "path"]
    targets: list[CanvasTarget] = Field(min_length=1, max_length=6)
    need: int = Field(ge=1)
    feedback: Feedback

    @model_validator(mode="after")
    def _need_is_reachable(self) -> CanvasMarkInteraction:
        if self.need > len(self.targets):
            raise ValueError(f"need {self.need} of {len(self.targets)} targets is unreachable")
        return self


class TimerSpec(Spec):
    """A clock over a beat. A modifier, not an act: it never stands alone in a design."""

    kind: Literal["timer"]
    seconds: int = Field(ge=10, le=300)
    onExpire: Literal["reveal", "end", "again"]
    visible: bool = True
    feedback: Feedback


class ScoreSpec(Spec):
    """A score over a beat. ``perWrong`` is zero or negative: a wrong move costs, never pays."""

    kind: Literal["score"]
    perRight: int = Field(ge=1)
    perWrong: int = Field(default=0, le=0)
    target: int | None = Field(default=None, ge=1)
    show: Literal["bar", "number", "none"] = "number"
    feedback: Feedback


class RevealSpec(Spec):
    """The moment: what the learner sees that they did not before. ``what`` is that sentence and
    ``marks`` are the stage's own marks that light when it happens."""

    kind: Literal["reveal"]
    trigger: Literal["onRight", "onWrong", "onDone", "onTap"]
    what: str
    marks: list[str] = Field(default_factory=list)
    feedback: Feedback


#: Every primitive, discriminated on ``kind`` — the union a step's ``primitive`` field takes.
Primitive = Annotated[
    TapInteraction
    | DragInteraction
    | SlideInteraction
    | DropInteraction
    | SortInteraction
    | MatchInteraction
    | SequenceInteraction
    | BranchInteraction
    | CanvasMarkInteraction
    | TimerSpec
    | ScoreSpec
    | RevealSpec,
    Field(discriminator="kind"),
]

#: kind -> model, for anything that has to walk the vocabulary (the gate, the tests, the prompt).
PRIMITIVE_MODELS: dict[str, type[Spec]] = {
    "tap": TapInteraction,
    "drag": DragInteraction,
    "slide": SlideInteraction,
    "drop": DropInteraction,
    "sort": SortInteraction,
    "match": MatchInteraction,
    "sequence": SequenceInteraction,
    "branch": BranchInteraction,
    "mark": CanvasMarkInteraction,
    "timer": TimerSpec,
    "score": ScoreSpec,
    "reveal": RevealSpec,
}

#: The primitives in which the learner MOVES something. A design made only of the others is a
#: quiz with a skin — "no tap can be wrong", "all recognition", which the judges scored 1.12 for.
MANIPULATIVE_KINDS = frozenset({"drag", "slide", "drop", "sort", "match", "sequence", "mark"})

#: The modifiers: real primitives, but they never carry a beat on their own.
MODIFIER_KINDS = frozenset({"timer", "score", "reveal"})

#: The eight rows of §2's table — what kind of interaction the concept wants.
InteractionKindT = Literal[
    "classify", "order", "match", "vary", "construct", "discriminate", "drill", "watch"
]
INTERACTION_KINDS: tuple[str, ...] = (
    "classify",
    "order",
    "match",
    "vary",
    "construct",
    "discriminate",
    "drill",
    "watch",
)

#: The mix rule of §2: one interaction that builds the idea, one that checks it, one that makes
#: it fun, never three of the same kind.
Beat = Literal["build", "check", "fun"]


class InteractionStep(Spec):
    """One beat of a design: a primitive, what it is for, and the surprise it lands."""

    id: str
    beat: Beat
    primitive: Primitive
    surprise: str | None = None


class InteractionDesign(Spec):
    """The model's design for one concept's interaction — a composition, never code.

    ``source`` says whether the model wrote it or the template floor of §2 took over after two
    refusals. ``refreshDays`` is the cadence a superadmin sets (ninety by default); a change to
    the concept core supersedes it at once, which is what ``coreVersion`` is for.
    """

    id: str
    concept: str
    kind: InteractionKindT
    mechanic: str
    why: str
    steps: list[InteractionStep] = Field(min_length=1, max_length=5)
    marks: list[Mark] = Field(default_factory=list)
    source: Literal["model", "floor"] = "model"
    refreshDays: int = Field(default=90, ge=1, le=365)
    coreVersion: str | None = None
    designedAt: str | None = None

    @model_validator(mode="after")
    def _a_modifier_never_stands_alone(self) -> InteractionDesign:
        kinds = [s.primitive.kind for s in self.steps]
        if all(k in MODIFIER_KINDS for k in kinds):
            raise ValueError("a design of nothing but timers, scores and reveals asks for no act")
        return self


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
    # The interaction vocabulary (§3). Feedback and HitBox first: every primitive refers to them.
    Feedback,
    HitBox,
    DropToken,
    DropZone,
    DropInteraction,
    SortItem,
    SortInteraction,
    MatchPair,
    MatchInteraction,
    SequenceStep,
    SequenceInteraction,
    BranchOption,
    BranchInteraction,
    CanvasTarget,
    CanvasMarkInteraction,
    TimerSpec,
    ScoreSpec,
    RevealSpec,
    InteractionStep,
    InteractionDesign,
)
