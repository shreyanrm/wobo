/**
 * The board grammar (docs/BOARD.md §2–§4) — the single source of truth for what Wobo may draw.
 *
 * The brain composes objects; the hand renders them; both sides keep the same list so either can
 * refer to any object later by id. This file is generated into the Python mirror the brain
 * validates against (`bun run --cwd packages/wobo board:codegen`), so the grammar can never drift
 * between the two halves of Wobo.
 *
 * Three laws are encoded here rather than left to convention:
 *  1. Nothing is placed by pixels. Every object carries an `anchor`, and the only coordinate form
 *     is board space — a 1000-unit logical width — used solely for shapes Wobo draws from scratch.
 *  2. Every number on a board is computed by code. A `number` object carries `verified`; the hand
 *     refuses to draw one that is false (see `renderer.tsx`).
 *  3. Colour resolves through theme tokens, never literals. `style.ink` is a role, not a hex.
 */

import { z } from 'zod';

// --- Board space ---------------------------------------------------------------------------------

/** The logical width of every board. Height follows the surface's aspect. */
export const BOARD_UNITS = 1000;

const finite = z.number().finite();
/** A point in board units. x is 0..1000; y is 0..(1000 / aspect). */
export const BoardPointSchema = z.tuple([finite, finite]);
export type BoardPoint = z.infer<typeof BoardPointSchema>;

// --- Anchors (BOARD.md §3) -----------------------------------------------------------------------

/** Where on an anchored rect the mark sits. A fraction pair is [0..1, 0..1] from the top-left. */
export const AnchorAtSchema = z.union([
  z.enum([
    'center',
    'top',
    'bottom',
    'left',
    'right',
    'topLeft',
    'topRight',
    'bottomLeft',
    'bottomRight',
  ]),
  z.tuple([finite, finite]),
]);
export type AnchorAt = z.infer<typeof AnchorAtSchema>;

/** Nudge in board units applied after the anchor resolves — never a substitute for anchoring. */
const offset = z.tuple([finite, finite]).optional();

export const AnchorSchema = z.union([
  z.object({ target: z.string().min(1), at: AnchorAtSchema.optional(), offset }),
  z.object({ object: z.string().min(1), at: AnchorAtSchema.optional(), offset }),
  z.object({ focus: z.string().min(1), at: AnchorAtSchema.optional(), offset }),
  z.object({ board: BoardPointSchema, offset }),
]);
export type Anchor = z.infer<typeof AnchorSchema>;

export type TargetAnchor = Extract<Anchor, { target: string }>;
export type ObjectAnchor = Extract<Anchor, { object: string }>;
export type FocusAnchor = Extract<Anchor, { focus: string }>;
export type BoardAnchor = Extract<Anchor, { board: BoardPoint }>;

// --- Style ---------------------------------------------------------------------------------------

/**
 * Ink roles, resolved through the theme (marker on paper in light, chalk on slate in dark):
 * `wobo` is Wobo's hand, `accent` is the one hit of pigment (ultramarine — Wobo's pen tip), `learner`
 * is the child's own stroke, `faint` is structure that must not compete.
 */
export const INK_ROLES = ['wobo', 'accent', 'learner', 'faint'] as const;
export const InkRoleSchema = z.enum(INK_ROLES);
export type InkRole = (typeof INK_ROLES)[number];

export const StyleSchema = z.object({
  ink: InkRoleSchema.optional(),
  /** Nib weight 1..4; multiplied by the surface's base nib width. */
  weight: z.number().int().min(1).max(4).optional(),
  /** true = a default dash; an array is an explicit dash pattern in board units. */
  dash: z.union([z.boolean(), z.array(z.number().positive()).min(2).max(6)]).optional(),
  /** `wash` is a translucent tint of the ink role; `solid` is the ink itself. */
  fill: z.enum(['none', 'wash', 'solid']).optional(),
  opacity: z.number().min(0).max(1).optional(),
});
export type BoardStyle = z.infer<typeof StyleSchema>;

// --- Timing --------------------------------------------------------------------------------------

/** Milliseconds relative to the start of the current utterance. */
export const TimingSchema = z.object({
  start: z.number().min(0).optional(),
  /** Drawing time. Omitted = the pen decides from the stroke's own length. */
  dur: z.number().positive().optional(),
  /** How long the ink lives after it lands. Omitted = the presentation's default. */
  ttl: z.number().positive().optional(),
});
export type Timing = z.infer<typeof TimingSchema>;

// --- Common fields -------------------------------------------------------------------------------

const common = {
  id: z.string().min(1).max(64),
  anchor: AnchorSchema,
  style: StyleSchema.optional(),
  t: TimingSchema.optional(),
  /** Variable names; when a bound control moves, the brain recomputes these objects. */
  depends: z.array(z.string().min(1)).max(16).optional(),
};

const text = z.string().min(1).max(400);
const points = z.array(BoardPointSchema).min(2).max(400);

// --- Marks (about something) ---------------------------------------------------------------------

export const PointMarkSchema = z.object({ ...common, kind: z.literal('point') });
export const CircleMarkSchema = z.object({
  ...common,
  kind: z.literal('circle'),
  /** Extra room around the anchored rect, in board units. */
  pad: finite.optional(),
});
export const UnderlineMarkSchema = z.object({ ...common, kind: z.literal('underline') });
export const ArrowMarkSchema = z.object({
  ...common,
  kind: z.literal('arrow'),
  /** Where the arrow starts. Omitted = a hand's natural approach from the upper left. */
  from: AnchorSchema.optional(),
  curve: finite.optional(),
});
export const BracketMarkSchema = z.object({
  ...common,
  kind: z.literal('bracket'),
  side: z.enum(['left', 'right', 'top', 'bottom']).optional(),
  label: text.optional(),
});
export const StrikeMarkSchema = z.object({ ...common, kind: z.literal('strike') });
/**
 * A computed quantity. `verified` is set by the brain only after the verifier (CAS, dimensional
 * analysis, balance checks) has passed it; the hand refuses to draw it otherwise.
 */
export const NumberMarkSchema = z.object({
  ...common,
  kind: z.literal('number'),
  value: finite,
  unit: z.string().max(16).optional(),
  label: z.string().max(80).optional(),
  /** Decimal places to show. Omitted = the value as given. */
  precision: z.number().int().min(0).max(8).optional(),
  verified: z.boolean(),
  /** Which check passed, e.g. `cas.solution_satisfies` — the provenance of a verified quantity. */
  check: z.string().max(60).optional(),
});
export const WriteMarkSchema = z.object({
  ...common,
  kind: z.literal('write'),
  text,
  /** Cap height in board units. */
  size: z.number().positive().optional(),
  maxWidth: z.number().positive().optional(),
});
export const EraseMarkSchema = z.object({
  ...common,
  kind: z.literal('erase'),
  /** The object id the swipe takes off the board. */
  object: z.string().min(1),
});
export const WipeMarkSchema = z.object({
  id: common.id,
  kind: z.literal('wipe'),
  anchor: AnchorSchema.optional(),
  style: StyleSchema.optional(),
  t: TimingSchema.optional(),
});

// --- Shapes (something new) ----------------------------------------------------------------------

export const LineShapeSchema = z.object({ ...common, kind: z.literal('line'), to: AnchorSchema });
export const PolylineShapeSchema = z.object({ ...common, kind: z.literal('polyline'), points });
export const CurveShapeSchema = z.object({
  ...common,
  kind: z.literal('curve'),
  points,
  closed: z.boolean().optional(),
});
export const PolygonShapeSchema = z.object({
  ...common,
  kind: z.literal('polygon'),
  points,
  /**
   * What Wobo calls this shape, for a learner who is listening rather than looking.
   *
   * A polygon says what it IS from its own points — "a square", "a right-angled triangle" — and on
   * the Pythagoras board that is three identical sentences for the three squares that ARE the
   * proof. Nothing in the points says which one sits on the hypotenuse. A title is the board naming
   * its own shape, spoken and never drawn, exactly as `alt` names an image and `label` names a
   * number. Nothing here is a claim about a quantity, so nothing here is under the number law.
   */
  title: z.string().max(80).optional(),
});
export const EllipseShapeSchema = z.object({
  ...common,
  kind: z.literal('ellipse'),
  rx: z.number().positive(),
  ry: z.number().positive(),
});
export const AxisShapeSchema = z.object({
  ...common,
  kind: z.literal('axis'),
  orientation: z.enum(['x', 'y']),
  min: finite,
  max: finite,
  step: z.number().positive(),
  /** Axis length in board units. */
  length: z.number().positive(),
  label: z.string().max(40).optional(),
  ticks: z.boolean().optional(),
});
export const GridShapeSchema = z.object({
  ...common,
  kind: z.literal('grid'),
  cols: z.number().int().min(1).max(60),
  rows: z.number().int().min(1).max(60),
  w: z.number().positive(),
  h: z.number().positive(),
});
export const TableShapeSchema = z.object({
  ...common,
  kind: z.literal('table'),
  rows: z
    .array(z.array(z.string().max(40)).min(1).max(12))
    .min(1)
    .max(24),
  w: z.number().positive(),
  rowHeight: z.number().positive().optional(),
});
export const LabelShapeSchema = z.object({
  ...common,
  kind: z.literal('label'),
  text,
  size: z.number().positive().optional(),
});
export const TexShapeSchema = z.object({
  ...common,
  kind: z.literal('tex'),
  tex: z.string().min(1).max(400),
  size: z.number().positive().optional(),
});
export const BondShapeSchema = z.object({
  ...common,
  kind: z.literal('bond'),
  to: BoardPointSchema,
  order: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  wedge: z.enum(['none', 'up', 'down']).optional(),
});
export const AtomShapeSchema = z.object({
  ...common,
  kind: z.literal('atom'),
  symbol: z.string().min(1).max(3),
  charge: z.number().int().min(-4).max(4).optional(),
  lonePairs: z.number().int().min(0).max(4).optional(),
  size: z.number().positive().optional(),
});
export const RegionShapeSchema = z.object({
  ...common,
  kind: z.literal('region'),
  w: z.number().positive(),
  h: z.number().positive(),
  title: z.string().max(80).optional(),
});
export const ImageShapeSchema = z.object({
  ...common,
  kind: z.literal('image'),
  href: z.string().min(1).max(2048),
  w: z.number().positive(),
  h: z.number().positive(),
  alt: z.string().max(160),
});

// --- Controls (a shape that reacts) --------------------------------------------------------------

const variable = z.string().min(1).max(40);

export const SliderControlSchema = z.object({
  ...common,
  kind: z.literal('slider'),
  variable,
  min: finite,
  max: finite,
  value: finite,
  step: z.number().positive().optional(),
  w: z.number().positive().optional(),
  label: z.string().max(40).optional(),
});
export const ToggleControlSchema = z.object({
  ...common,
  kind: z.literal('toggle'),
  variable,
  value: z.boolean(),
  label: z.string().max(40).optional(),
});
export const InputControlSchema = z.object({
  ...common,
  kind: z.literal('input'),
  variable,
  value: z.string().max(80),
  w: z.number().positive().optional(),
  label: z.string().max(40).optional(),
});
export const DragControlSchema = z.object({
  ...common,
  kind: z.literal('drag'),
  variable,
  value: BoardPointSchema,
  bounds: z.tuple([BoardPointSchema, BoardPointSchema]).optional(),
  label: z.string().max(40).optional(),
});

// --- The object union ----------------------------------------------------------------------------

export const MARK_KINDS = [
  'point',
  'circle',
  'underline',
  'arrow',
  'bracket',
  'strike',
  'number',
  'write',
  'erase',
  'wipe',
] as const;

export const SHAPE_KINDS = [
  'line',
  'polyline',
  'curve',
  'polygon',
  'ellipse',
  'axis',
  'grid',
  'table',
  'label',
  'tex',
  'bond',
  'atom',
  'region',
  'image',
] as const;

export const CONTROL_KINDS = ['slider', 'toggle', 'input', 'drag'] as const;

export const BoardObjectSchema = z.discriminatedUnion('kind', [
  PointMarkSchema,
  CircleMarkSchema,
  UnderlineMarkSchema,
  ArrowMarkSchema,
  BracketMarkSchema,
  StrikeMarkSchema,
  NumberMarkSchema,
  WriteMarkSchema,
  EraseMarkSchema,
  WipeMarkSchema,
  LineShapeSchema,
  PolylineShapeSchema,
  CurveShapeSchema,
  PolygonShapeSchema,
  EllipseShapeSchema,
  AxisShapeSchema,
  GridShapeSchema,
  TableShapeSchema,
  LabelShapeSchema,
  TexShapeSchema,
  BondShapeSchema,
  AtomShapeSchema,
  RegionShapeSchema,
  ImageShapeSchema,
  SliderControlSchema,
  ToggleControlSchema,
  InputControlSchema,
  DragControlSchema,
]);

export type BoardObject = z.infer<typeof BoardObjectSchema>;
export type BoardObjectKind = BoardObject['kind'];
export type MarkKind = (typeof MARK_KINDS)[number];
export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type ControlKind = (typeof CONTROL_KINDS)[number];

export type ObjectOfKind<K extends BoardObjectKind> = Extract<BoardObject, { kind: K }>;

const MARK_SET = new Set<string>(MARK_KINDS);
const SHAPE_SET = new Set<string>(SHAPE_KINDS);
const CONTROL_SET = new Set<string>(CONTROL_KINDS);

export const isMarkKind = (k: string): k is MarkKind => MARK_SET.has(k);
export const isShapeKind = (k: string): k is ShapeKind => SHAPE_SET.has(k);
export const isControlKind = (k: string): k is ControlKind => CONTROL_SET.has(k);

// --- Object memory: patches on objects already drawn ---------------------------------------------

/**
 * Wobo can come back to anything Wobo drew. A patch names an existing id and says what happens to it,
 * so "this one" is a real reference rather than a redraw from scratch.
 */
export const BoardPatchSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string().min(1), kind: z.literal('fade'), t: TimingSchema.optional() }),
  z.object({ id: z.string().min(1), kind: z.literal('remove'), t: TimingSchema.optional() }),
  z.object({ id: z.string().min(1), kind: z.literal('redraw'), t: TimingSchema.optional() }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('repoint'),
    anchor: AnchorSchema,
    t: TimingSchema.optional(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('move'),
    anchor: AnchorSchema,
    t: TimingSchema.optional(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('restyle'),
    style: StyleSchema,
    t: TimingSchema.optional(),
  }),
]);
export type BoardPatch = z.infer<typeof BoardPatchSchema>;

export const PATCH_KINDS = ['fade', 'remove', 'redraw', 'repoint', 'move', 'restyle'] as const;
const PATCH_SET = new Set<string>(PATCH_KINDS);
export const isPatchKind = (k: string): k is BoardPatch['kind'] => PATCH_SET.has(k);

export const InkPayloadSchema = z.union([BoardObjectSchema, BoardPatchSchema]);
export type InkPayload = z.infer<typeof InkPayloadSchema>;

export function isPatch(payload: InkPayload): payload is BoardPatch {
  return isPatchKind(payload.kind);
}

// --- The streaming protocol (BOARD.md §4) ---------------------------------------------------------

/** Which surface an event's ink lands on. Wobo picks; the learner may override. */
export const PRESENTATIONS = ['screen', 'plane', 'full'] as const;
export const PresentationSchema = z.enum(PRESENTATIONS);
export type Presentation = (typeof PRESENTATIONS)[number];

export const SayEventSchema = z.object({
  type: z.literal('say'),
  text: z.string().min(1).max(2000),
  t: z.number().min(0).optional(),
});
export const InkEventSchema = z.object({
  type: z.literal('ink'),
  object: InkPayloadSchema,
  t: z.number().min(0).optional(),
  on: PresentationSchema.optional(),
});
export const ActionEventSchema = z.object({
  type: z.literal('action'),
  name: z.string().min(1).max(60),
  args: z.record(z.string(), z.unknown()).optional(),
  needs: z.enum(['none', 'permission']).optional(),
  t: z.number().min(0).optional(),
});
export const AskEventSchema = z.object({
  type: z.literal('ask'),
  prompt: z.string().min(1).max(400),
  targets: z.array(z.string().min(1)).max(24).optional(),
  t: z.number().min(0).optional(),
});
export const CardEventSchema = z.object({
  type: z.literal('card'),
  id: z.string().min(1).max(64),
  title: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
  t: z.number().min(0).optional(),
});
export const DoneEventSchema = z.object({
  type: z.literal('done'),
  /** Set when the learner stopped Wobo: the object the pen was on when it lifted. */
  interruptedAt: z.string().min(1).optional(),
  t: z.number().min(0).optional(),
});

export const BoardEventSchema = z.discriminatedUnion('type', [
  SayEventSchema,
  InkEventSchema,
  ActionEventSchema,
  AskEventSchema,
  CardEventSchema,
  DoneEventSchema,
]);
export type BoardEvent = z.infer<typeof BoardEventSchema>;
export type SayEvent = z.infer<typeof SayEventSchema>;
export type InkEvent = z.infer<typeof InkEventSchema>;
export type ActionEvent = z.infer<typeof ActionEventSchema>;
export type AskEvent = z.infer<typeof AskEventSchema>;
export type CardEvent = z.infer<typeof CardEventSchema>;
export type DoneEvent = z.infer<typeof DoneEventSchema>;

/** A whole turn, for golden boards and replay. Streaming never waits for the array to close. */
export const BoardPlanSchema = z.array(BoardEventSchema).max(600);
export type BoardPlan = z.infer<typeof BoardPlanSchema>;

// --- Parsing: never let one malformed object kill a turn -------------------------------------------

/** Validate one streamed event; returns null (never throws) so a bad frame is dropped, not fatal. */
export function parseBoardEvent(raw: unknown): BoardEvent | null {
  const result = BoardEventSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Validate a whole plan, dropping only the frames that fail. */
export function parseBoardPlan(raw: unknown): BoardEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: BoardEvent[] = [];
  for (const item of raw) {
    const event = parseBoardEvent(item);
    if (event) events.push(event);
  }
  return events;
}

/** Validate one object outside the event envelope (golden boards, the bench, learner ink). */
export function parseBoardObject(raw: unknown): BoardObject | null {
  const result = BoardObjectSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Law 2, at the edge of the hand: a quantity the verifier has not passed is not drawable.
 * The renderer calls this before it inks anything, so an unverified number can never reach a child.
 */
export function isDrawable(object: BoardObject): boolean {
  return object.kind !== 'number' || object.verified === true;
}
