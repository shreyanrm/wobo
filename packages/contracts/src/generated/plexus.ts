/**
 * @wobo/contracts — the Plexus card-spec contract (SUBJECTS.md §7).
 *
 * GENERATED — do not edit by hand. Source of truth: the Pydantic models in
 * services/gateway/src/wobo_gateway/plexus/specs.py.
 * Regenerate: `uv run python -m wobo_gateway.plexus.codegen` then
 * `bun run --filter @wobo/contracts codegen:plexus`.
 */
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
  perturbation?: { [key: string]: unknown } | null;
  whatIf?: { [key: string]: unknown } | null;
  compare?: { [key: string]: unknown } | null;
  conceptMap?: { [key: string]: unknown } | null;
  workbook?: { [key: string]: unknown } | null;
  flashcards?: { [key: string]: unknown } | null;
  derivation?: { [key: string]: unknown } | null;
  wordProblem?: { [key: string]: unknown } | null;
  podcast?: { [key: string]: unknown } | null;
  arcade?: { [key: string]: unknown } | null;
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
}

export interface DragTo {
  x: number;
  y: number;
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
}

export interface TapInteraction {
  kind: 'tap';
  prompt: string;
  targets: string[];
  need: number;
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
