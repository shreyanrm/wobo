/**
 * @wobo/contracts — the Plexus card-spec contract (SUBJECTS.md §7).
 *
 * GENERATED — do not edit by hand. Source of truth: the Pydantic models in
 * services/gateway/src/wobo_gateway/plexus/specs.py.
 * Regenerate: `uv run python -m wobo_gateway.plexus.codegen` then
 * `bun run --filter @wobo/contracts codegen:plexus`.
 */
/** catch — the answers rain down and one of them is right. */
export interface ArcadeCatchRound {
  id: string;
  prompt: string;
  why?: string | null;
  answer: string;
  distractors: string[];
}

/** defend the number line — where does this value sit, within a tolerance a finger can hit.

The gate holds ``tolerance`` under a quarter of the line: a tolerance that swallows the line
means no tap can be wrong, which is the exact failure the wave 30 judges scored 1.12 for. */
export interface ArcadeLineRound {
  id: string;
  prompt: string;
  why?: string | null;
  target: number;
  min: number;
  max: number;
  tolerance: number;
  unit?: string | null;
}

export interface ArcadeMatchPair {
  left: string;
  right: string;
}

/** match pairs — two to six pairs, laid out shuffled. */
export interface ArcadeMatchRound {
  id: string;
  prompt: string;
  why?: string | null;
  pairs: ArcadeMatchPair[];
}

/** the running quiz with lives — the answer must be among the options, or no tap can win. */
export interface ArcadeQuizRound {
  id: string;
  prompt: string;
  why?: string | null;
  answer: string;
  options: string[];
}

/** build the sequence — ``steps`` in their right order, plus any step that does not belong. */
export interface ArcadeSequenceRound {
  id: string;
  prompt: string;
  why?: string | null;
  steps: string[];
  distractors?: string[] | null;
}

/** sort against the clock — ``order`` is the CORRECT order; the client shuffles it. */
export interface ArcadeSortRound {
  id: string;
  prompt: string;
  why?: string | null;
  order: string[];
  by?: string | null;
}

/** One bonus level: a side door in the middle of a chapter, never in the path.

``seconds`` is the clock where the mechanic has one. Catch falls at its own pace and the
sequence teaches rather than races, so neither carries it. */
export interface ArcadeSpec {
  id: string;
  title: string;
  game?: 'catch' | 'sort' | 'match' | 'numberline' | 'sequence' | 'quiz';
  skill?: 'speed' | 'recall';
  seconds?: number | null;
  rounds: (ArcadeCatchRound | ArcadeQuizRound | ArcadeSortRound | ArcadeMatchRound | ArcadeLineRound | ArcadeSequenceRound)[];
}

/** Branch on the answer: a wrong choice routes to the beat that repairs it. §2's
discrimination row, and the only recognition primitive in the vocabulary. */
export interface BranchInteraction {
  kind: 'branch';
  prompt: string;
  options: BranchOption[];
  feedback: Feedback;
}

/** One answer. A wrong one must be a REAL misconception and must say what it teaches. */
export interface BranchOption {
  id: string;
  label: string;
  box: HitBox;
  correct: boolean;
  teaches?: string;
  goto?: string | null;
}

/** Mark the stage itself: a point, a line, a circle, a path. The learner draws the answer
rather than choosing it, and the drawing is checked against targets, never rendered as code. */
export interface CanvasMarkInteraction {
  kind: 'mark';
  prompt: string;
  tool: 'point' | 'line' | 'circle' | 'path';
  targets: CanvasTarget[];
  need: number;
  feedback: Feedback;
}

/** A place on the stage a mark must land, with the finger's radius around it. */
export interface CanvasTarget {
  id: string;
  x: number;
  y: number;
  r?: number;
  why: string;
}

/** One teaching card. Owned fields are strict; rich activities pass through verbatim. */
export interface Card {
  id: string;
  kind: 'sim' | 'diagram' | 'text';
  title: string;
  idea: string;
  interaction: Interaction;
  reveal: string;
  discovery?: DiscoverySpec | null;
  imageSpec?: ImageSpec | null;
  design?: InteractionDesign | null;
  interactionKind?: 'classify' | 'order' | 'match' | 'vary' | 'construct' | 'discriminate' | 'drill' | 'watch' | null;
  perturbation?: { [key: string]: unknown } | null;
  whatIf?: { [key: string]: unknown } | null;
  compare?: { [key: string]: unknown } | null;
  conceptMap?: { [key: string]: unknown } | null;
  workbook?: { [key: string]: unknown } | null;
  flashcards?: { [key: string]: unknown } | null;
  derivation?: { [key: string]: unknown } | null;
  wordProblem?: { [key: string]: unknown } | null;
  podcast?: { [key: string]: unknown } | null;
  arcade?: ArcadeSpec | null;
  mathScene?: { [key: string]: unknown } | null;
  physicsScene?: { [key: string]: unknown } | null;
  chemScene?: { [key: string]: unknown } | null;
  bioScene?: { [key: string]: unknown } | null;
  socialScene?: { [key: string]: unknown } | null;
  mapScene?: { [key: string]: unknown } | null;
  anatomyScene?: { [key: string]: unknown } | null;
}

/** engine.compose output — the primary card-spec contract. */
export interface CourseSpec {
  topic: string;
  difficulty: string;
  cards: Card[];
  workbook: Item[];
  boss: Item[];
}

/** A card's embedded guided-discovery: 1..6 stages, one idea each. */
export interface DiscoverySpec {
  id: string;
  title: string;
  stages: DiscoveryStage[];
}

export interface DiscoveryStage {
  visual: DiscoveryVisual;
  interaction: TapInteraction | DragInteraction | SlideInteraction;
  reveal: string;
  caption: string;
}

export interface DiscoveryVisual {
  marks: Mark[];
}

export interface DragInteraction {
  kind: 'drag';
  prompt: string;
  handle: string;
  to: DragTo;
  radius: number;
  feedback?: Feedback | null;
}

export interface DragTo {
  x: number;
  y: number;
}

/** Drop each token into the bin its rule admits. The classification row of §2. */
export interface DropInteraction {
  kind: 'drop';
  prompt: string;
  tokens: DropToken[];
  zones: DropZone[];
  feedback: Feedback;
}

/** A thing the learner picks up. ``why`` is the reason it belongs where it belongs — the
wrong-drop line is written from it, so a wrong drop teaches the idea rather than the game. */
export interface DropToken {
  id: string;
  label: string;
  box: HitBox;
  belongs: string;
  why: string;
}

/** A bin with a rule.

The rule, in its simplest honest form, is ``accepts``: the tokens this zone is for. A token
outside it is refused with this zone's own ``feedback`` — "a third is a smaller share than a
half", not "wrong". ``capacity`` caps a zone that must hold exactly n. */
export interface DropZone {
  id: string;
  label: string;
  box: HitBox;
  accepts: string[];
  capacity?: number | null;
  feedback: Feedback;
}

/** What a move teaches. Every primitive carries one.

``wrong`` is the load-bearing half: it must say something about the concept ("a third is a
smaller share than a half"), never about the game ("try again"). The gate reads it. */
export interface Feedback {
  right: string;
  wrong: string;
  hint?: string | null;
}

/** A touchable rectangle on the stage, never smaller than a finger and never off the edge. */
export interface HitBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Marks a card whose visual is organic/complex — hydrated through the raster seam. */
export interface ImageSpec {
  subject: string;
  caption?: string | null;
}

/** The single act a card asks for before it reveals anything. */
export interface Interaction {
  kind: 'tap' | 'drag' | 'slide' | 'type';
  prompt: string;
}

/** The model's design for one concept's interaction — a composition, never code.

``source`` says whether the model wrote it or the template floor of §2 took over after two
refusals. ``refreshDays`` is the cadence a superadmin sets (ninety by default); a change to
the concept core supersedes it at once, which is what ``coreVersion`` is for. */
export interface InteractionDesign {
  id: string;
  concept: string;
  kind: 'classify' | 'order' | 'match' | 'vary' | 'construct' | 'discriminate' | 'drill' | 'watch';
  mechanic: string;
  why: string;
  steps: InteractionStep[];
  marks?: Mark[];
  source?: 'model' | 'floor';
  refreshDays?: number;
  coreVersion?: string | null;
  designedAt?: string | null;
}

/** One beat of a design: a primitive, what it is for, and the surprise it lands. */
export interface InteractionStep {
  id: string;
  beat: 'build' | 'check' | 'fun';
  primitive: unknown;
  surprise?: string | null;
}

/** A workbook / boss recall item with a structurally verified answer. */
export interface Item {
  id: string;
  type: 'mcq' | 'fill';
  prompt: string;
  options?: string[] | null;
  answer: string;
}

/** One shape on a discovery stage's reactive canvas (0..100 by 0..62). */
export interface Mark {
  id: string;
  shape: 'circle' | 'rect' | 'line' | 'ring' | 'text';
  x: number;
  y: number;
  tone?: 'ink' | 'muted' | 'hue';
  x2?: number | null;
  y2?: number | null;
  r?: number | null;
  w?: number | null;
  h?: number | null;
  text?: string | null;
  fill?: 'soft' | 'solid' | null;
}

/** Join each left to its right. The correspondence row of §2.

``card`` is the size of ONE card; the client lays two columns of that size out, which is how
a finger's law is expressed for a layout the spec does not place by hand. */
export interface MatchInteraction {
  kind: 'match';
  prompt: string;
  pairs: MatchPair[];
  card: HitBox;
  feedback: Feedback;
}

export interface MatchPair {
  id: string;
  left: string;
  right: string;
  why: string;
}

/** The moment: what the learner sees that they did not before. ``what`` is that sentence and
``marks`` are the stage's own marks that light when it happens. */
export interface RevealSpec {
  kind: 'reveal';
  trigger: 'onRight' | 'onWrong' | 'onDone' | 'onTap';
  what: string;
  marks?: string[];
  feedback: Feedback;
}

export interface Scene {
  id: string;
  durationMs: number;
  narration: string;
  visual: SceneVisual;
  title?: string | null;
  audio?: SceneAudio | null;
}

export interface SceneAudio {
  b64: string;
  mime: string;
  durationMs?: number | null;
}

export interface SceneVisual {
  kind: 'svg' | 'diagram' | 'sim';
  payload: string | SimSpec;
}

/** A score over a beat. ``perWrong`` is zero or negative: a wrong move costs, never pays. */
export interface ScoreSpec {
  kind: 'score';
  perRight: number;
  perWrong?: number;
  target?: number | null;
  show?: 'bar' | 'number' | 'none';
  feedback: Feedback;
}

/** Build it step by step, with a check at each step. The construction row of §2.

Not a sort: a sort ranks a set that is already on the table, a sequence makes the next thing
only once the last one holds. */
export interface SequenceInteraction {
  kind: 'sequence';
  prompt: string;
  steps: SequenceStep[];
  feedback: Feedback;
}

/** One step of a construction, and the check that opens the next one. */
export interface SequenceStep {
  id: string;
  label: string;
  box: HitBox;
  check: string;
  feedback: Feedback;
}

export interface SimBreakpoint {
  param: string;
  at: number;
  why: string;
}

export interface SimParam {
  name: string;
  min: number;
  max: number;
  default: number;
  unit: string;
}

/** engine.simulate output — every formula CAS-verified before it lands here. */
export interface SimSpec {
  params: SimParam[];
  formula: string;
  outputs: string[];
  breakpoints: SimBreakpoint[];
  layout: string;
}

export interface SlideBind {
  mark: string;
  prop: 'x' | 'y' | 'r';
  at: number[];
}

export interface SlideInteraction {
  kind: 'slide';
  prompt: string;
  min: number;
  max: number;
  from: number;
  at: number;
  unit?: string | null;
  valueLabel?: string | null;
  bind?: SlideBind | null;
  feedback?: Feedback | null;
}

/** Put a set into its order, all at once. The ordering row of §2. */
export interface SortInteraction {
  kind: 'sort';
  prompt: string;
  items: SortItem[];
  axis?: 'vertical' | 'horizontal';
  feedback: Feedback;
}

/** One card in an ordering, with its true place and why it sits there. */
export interface SortItem {
  id: string;
  label: string;
  box: HitBox;
  rank: number;
  why: string;
}

export interface TapInteraction {
  kind: 'tap';
  prompt: string;
  targets: string[];
  need: number;
  feedback?: Feedback | null;
}

/** A clock over a beat. A modifier, not an act: it never stands alone in a design. */
export interface TimerSpec {
  kind: 'timer';
  seconds: number;
  onExpire: 'reveal' | 'end' | 'again';
  visible?: boolean;
  feedback: Feedback;
}

/** engine.video output. ``narrationAudio`` is null at verify; per-scene audio attaches live. */
export interface VideoSpec {
  scenes: Scene[];
  narrationAudio?: unknown | null;
}

/** engine.diagram output — a sanitized inline SVG string (no wrapper object). */
export type DiagramSpec = string;

/** The served artifact of any of the four Plexus engines. */
export type PlexusArtifact = CourseSpec | SimSpec | VideoSpec | DiagramSpec;
