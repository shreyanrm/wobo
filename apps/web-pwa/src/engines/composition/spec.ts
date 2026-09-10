/**
 * The interaction composition — the one declarative language the designer writes and this client
 * renders (docs/CONTENT-INTERACTION.md §3, docs/CACHES.md store 3).
 *
 * The law it exists to keep: **nothing generated ever executes on a learner's device.** A designed
 * interaction is a COMPOSITION of primitives — never code, never a callback, never an expression to
 * evaluate. This file is the schema; `parseComposition` is the gate. A composition the gate refuses
 * never reaches the learner, and the refusal is invisible (never-narrate, DESIGN.md §0.x): the card
 * falls to its template floor (`floors.ts`) rather than printing a caption for an absence.
 *
 * ── The vocabulary ───────────────────────────────────────────────────────────────────────────────
 * Eight PLAYS (what the learner moves) and four MODIFIERS (how the step is scored, timed, revealed
 * and branched). §3's list — "drop zones with rules, sort, match, sequence, timer, score, reveal,
 * branch-on-answer, canvas mark" — plus the three the client already had (tap, drag, slide).
 *
 *   bins      drag chips into drop zones that have rules   a classification, a taxonomy
 *   sort      arrange the whole row into an order          an ordering, a chronology
 *   match     join the pairs                               a correspondence, cause and effect
 *   sequence  build it one step at a time, checked         a construction, a derivation
 *   select    one (or n) of several, real distractors      a discrimination among near things
 *   slide     move the value and watch the picture         a quantity that varies
 *   canvas    tap the marked things on the drawing         label the diagram, find the part
 *   drag      carry one mark onto a zone                   put the thing where it belongs
 *
 *   timer     a countdown; expiry ENDS a step, never punishes
 *   score     points per right move, an optional streak
 *   reveal    the idea, shown only once the act is done — a field on every step, never a caption
 *   branch    where a right or a wrong answer sends the learner next
 *
 * The challenge of §2's seventh row is not a ninth play: it is `select` with `timer` and `score`
 * on it. That is the point of a composition language.
 *
 * ── The gate's rules ─────────────────────────────────────────────────────────────────────────────
 * 1. One to six steps. One idea per screen; six is a lesson, seven is a lecture.
 * 2. Every step has a prompt (imperative, what to do) and a reveal (the idea, after the act).
 * 3. **A wrong move must teach.** Every step carries either a step-level `teach` or a per-option
 *    `teach` on everything that can be got wrong. A step where being wrong says nothing is refused.
 * 4. Ids are unique within their step, and every reference (an order, an answer, a bin's accepts, a
 *    branch's goto, a slide's bound mark) resolves to something that exists.
 * 5. Numbers are finite. A NaN reaches an SVG as a broken drawing, not as an error.
 */

import type { Mark } from '../Discovery';

// --- the pieces -----------------------------------------------------------------------------------

/** A movable label: the thing a learner picks up, sorts, matches or chooses. */
export interface Chip {
  id: string;
  label: string;
  /** Why this one belongs where it belongs — the line a wrong move earns. */
  teach?: string;
}

/** A drop zone WITH A RULE: it accepts exactly the chips named, and refuses the rest with a reason. */
export interface Bin {
  id: string;
  label: string;
  accepts: string[];
}

export interface SlideBind {
  mark: string;
  prop: 'x' | 'y' | 'r';
  at: [number, number];
}

export type Play =
  | { kind: 'bins'; bins: Bin[]; items: Chip[] }
  | { kind: 'sort'; items: Chip[]; order: string[]; axis?: { from: string; to: string } }
  | { kind: 'match'; pairs: Chip[]; rights: string[] }
  | { kind: 'sequence'; steps: Chip[] }
  | { kind: 'select'; options: Chip[]; answer: string[] }
  | {
      kind: 'slide';
      min: number;
      max: number;
      from: number;
      at: number;
      unit?: string;
      valueLabel?: string;
      marks?: Mark[];
      bind?: SlideBind;
    }
  | { kind: 'canvas'; marks: Mark[]; targets: string[]; need: number }
  | { kind: 'drag'; marks: Mark[]; handle: string; to: { x: number; y: number }; radius: number };

export type PlayKind = Play['kind'];

export const PLAY_KINDS = [
  'bins',
  'sort',
  'match',
  'sequence',
  'select',
  'slide',
  'canvas',
  'drag',
] as const satisfies readonly PlayKind[];

export interface Step {
  id: string;
  /** Imperative: what to do. Never a description of the software. */
  prompt: string;
  /** The idea. Shown the moment the act completes, never before. */
  reveal: string;
  /** The line a wrong move earns when the play's own pieces do not carry one. */
  teach?: string;
  play: Play;
  /** A countdown in seconds. Expiry ends the step and shows the reveal; it never takes anything away. */
  timer?: { seconds: number };
  /** Points for a right move, and an optional bonus for an unbroken run. */
  score?: { per: number; streak?: number };
  /** Where a right or a wrong answer sends the learner next. Absent: the next step in order. */
  branch?: { on: 'right' | 'wrong'; goto: string }[];
}

export interface Composition {
  id: string;
  title: string;
  steps: Step[];
  /** `floor` is the template of §2; `designed` is the model's own composition. */
  source: 'designed' | 'floor';
}

/** The longest a composition may be. One idea per screen; six is a lesson, seven is a lecture. */
export const MAX_STEPS = 6;

// --- the gate -------------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const text = (v: unknown): string => (str(v) ? v.trim() : '');

const MARK_SHAPES: ReadonlySet<string> = new Set(['circle', 'rect', 'line', 'ring', 'text']);

/** Every reason a composition was refused, in the order they were found. Tests and the bench read it. */
export interface Refusal {
  where: string;
  why: string;
}

function parseMark(raw: unknown): Mark | null {
  if (!isRecord(raw) || !str(raw.id)) return null;
  if (typeof raw.shape !== 'string' || !MARK_SHAPES.has(raw.shape)) return null;
  if (!num(raw.x) || !num(raw.y)) return null;
  const tone = raw.tone === 'hue' ? 'hue' : raw.tone === 'muted' ? 'muted' : 'ink';
  return {
    id: raw.id,
    shape: raw.shape as Mark['shape'],
    x: raw.x,
    y: raw.y,
    tone,
    x2: num(raw.x2) ? raw.x2 : undefined,
    y2: num(raw.y2) ? raw.y2 : undefined,
    r: num(raw.r) ? raw.r : undefined,
    w: num(raw.w) ? raw.w : undefined,
    h: num(raw.h) ? raw.h : undefined,
    text: str(raw.text) ? raw.text.trim() : undefined,
    fill: raw.fill === 'solid' ? 'solid' : raw.fill === 'soft' ? 'soft' : undefined,
  };
}

function parseChips(raw: unknown, min: number): Chip[] | null {
  if (!Array.isArray(raw) || raw.length < min) return null;
  const seen = new Set<string>();
  const chips: Chip[] = [];
  for (const c of raw) {
    if (!isRecord(c) || !str(c.id) || !str(c.label)) return null;
    if (seen.has(c.id)) return null;
    seen.add(c.id);
    const teach = text(c.teach);
    chips.push({ id: c.id, label: c.label.trim(), ...(teach ? { teach } : {}) });
  }
  return chips;
}

/** Do the pieces that can be got wrong carry their own line? (Rule 3, half of it.) */
function everyPieceTeaches(chips: Chip[], exempt: ReadonlySet<string>): boolean {
  return chips.every((c) => exempt.has(c.id) || Boolean(c.teach));
}

function parsePlay(raw: unknown, out: Refusal[], where: string): Play | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    out.push({ where, why: 'no play' });
    return null;
  }
  const refuse = (why: string): null => {
    out.push({ where: `${where}.${raw.kind}`, why });
    return null;
  };

  switch (raw.kind) {
    case 'bins': {
      const items = parseChips(raw.items, 3);
      if (!items) return refuse('needs three or more chips with unique ids');
      if (!Array.isArray(raw.bins) || raw.bins.length < 2) return refuse('needs two or more bins');
      const ids = new Set(items.map((i) => i.id));
      const bins: Bin[] = [];
      const placed = new Set<string>();
      for (const b of raw.bins) {
        if (!isRecord(b) || !str(b.id) || !str(b.label)) return refuse('a bin has no id or label');
        const accepts = (Array.isArray(b.accepts) ? b.accepts : []).filter(
          (a): a is string => typeof a === 'string' && ids.has(a),
        );
        if (accepts.length === 0) return refuse(`bin ${b.id} accepts nothing that exists`);
        for (const a of accepts) {
          if (placed.has(a)) return refuse(`chip ${a} belongs to two bins`);
          placed.add(a);
        }
        bins.push({ id: b.id, label: b.label.trim(), accepts });
      }
      if (placed.size !== items.length) return refuse('a chip belongs to no bin');
      return { kind: 'bins', bins, items };
    }

    case 'sort': {
      const items = parseChips(raw.items, 3);
      if (!items) return refuse('needs three or more chips with unique ids');
      const order = (Array.isArray(raw.order) ? raw.order : []).filter(
        (o): o is string => typeof o === 'string',
      );
      const ids = new Set(items.map((i) => i.id));
      if (order.length !== items.length || new Set(order).size !== order.length)
        return refuse('the order is not a permutation of the chips');
      if (!order.every((o) => ids.has(o))) return refuse('the order names a chip that is not here');
      const a = isRecord(raw.axis) ? raw.axis : null;
      const axis =
        a && str(a.from) && str(a.to) ? { from: a.from.trim(), to: a.to.trim() } : undefined;
      return { kind: 'sort', items, order, ...(axis ? { axis } : {}) };
    }

    case 'match': {
      const pairs = parseChips(raw.pairs, 3);
      if (!pairs) return refuse('needs three or more pairs with unique ids');
      const rights = (Array.isArray(raw.rights) ? raw.rights : []).filter(
        (r): r is string => typeof r === 'string' && r.trim() !== '',
      );
      if (rights.length !== pairs.length) return refuse('a left has no right');
      if (new Set(rights).size !== rights.length) return refuse('two lefts share one right');
      return { kind: 'match', pairs, rights: rights.map((r) => r.trim()) };
    }

    case 'sequence': {
      const steps = parseChips(raw.steps, 3);
      if (!steps) return refuse('needs three or more steps with unique ids');
      return { kind: 'sequence', steps };
    }

    case 'select': {
      const options = parseChips(raw.options, 3);
      if (!options) return refuse('needs three or more options with unique ids');
      const ids = new Set(options.map((o) => o.id));
      const answer = (Array.isArray(raw.answer) ? raw.answer : []).filter(
        (a): a is string => typeof a === 'string' && ids.has(a),
      );
      if (answer.length === 0) return refuse('no answer, or an answer that is not an option');
      if (answer.length === options.length) return refuse('every option is right — nothing to tell apart');
      return { kind: 'select', options, answer: [...new Set(answer)] };
    }

    case 'slide': {
      if (!num(raw.min) || !num(raw.max) || !num(raw.from) || !num(raw.at))
        return refuse('min, max, from and at must all be finite numbers');
      if (raw.max <= raw.min) return refuse('max is not above min');
      if (raw.from < raw.min || raw.from > raw.max) return refuse('from is outside the range');
      if (raw.at < raw.min || raw.at > raw.max) return refuse('at is outside the range');
      if (raw.at === raw.from) return refuse('the threshold is where it already starts');
      const marks = Array.isArray(raw.marks)
        ? raw.marks.map(parseMark).filter((m): m is Mark => m !== null)
        : [];
      let bind: SlideBind | undefined;
      if (isRecord(raw.bind)) {
        const b = raw.bind;
        const at = Array.isArray(b.at) ? b.at : [];
        const prop = b.prop === 'x' || b.prop === 'y' || b.prop === 'r' ? b.prop : null;
        if (!str(b.mark) || !prop || at.length !== 2 || !num(at[0]) || !num(at[1]))
          return refuse('the bind is malformed');
        if (!marks.some((m) => m.id === b.mark))
          return refuse(`the bind drives ${b.mark}, which is not on the canvas`);
        bind = { mark: b.mark, prop, at: [at[0], at[1]] };
      }
      return {
        kind: 'slide',
        min: raw.min,
        max: raw.max,
        from: raw.from,
        at: raw.at,
        ...(str(raw.unit) ? { unit: raw.unit.trim() } : {}),
        ...(str(raw.valueLabel) ? { valueLabel: raw.valueLabel.trim() } : {}),
        ...(marks.length ? { marks } : {}),
        ...(bind ? { bind } : {}),
      };
    }

    case 'canvas': {
      const marks = (Array.isArray(raw.marks) ? raw.marks : [])
        .map(parseMark)
        .filter((m): m is Mark => m !== null);
      if (marks.length === 0) return refuse('nothing on the canvas');
      const ids = new Set(marks.map((m) => m.id));
      const targets = [
        ...new Set(
          (Array.isArray(raw.targets) ? raw.targets : []).filter(
            (t): t is string => typeof t === 'string' && ids.has(t),
          ),
        ),
      ];
      if (targets.length === 0) return refuse('no target that exists on the canvas');
      const need = num(raw.need) ? Math.min(Math.max(1, Math.round(raw.need)), targets.length) : targets.length;
      return { kind: 'canvas', marks, targets, need };
    }

    case 'drag': {
      const marks = (Array.isArray(raw.marks) ? raw.marks : [])
        .map(parseMark)
        .filter((m): m is Mark => m !== null);
      if (marks.length === 0) return refuse('nothing on the canvas');
      if (!str(raw.handle) || !marks.some((m) => m.id === raw.handle))
        return refuse('the handle is not on the canvas');
      const to = isRecord(raw.to) ? raw.to : null;
      if (!to || !num(to.x) || !num(to.y)) return refuse('no drop zone');
      const radius = num(raw.radius) && raw.radius > 0 ? raw.radius : 12;
      return { kind: 'drag', marks, handle: raw.handle, to: { x: to.x, y: to.y }, radius };
    }

    default:
      out.push({ where, why: `${raw.kind} is not a play` });
      return null;
  }
}

/** The pieces of a play that can be got wrong — the ones rule 3 asks to carry a line. */
function wrongable(play: Play): { chips: Chip[]; exempt: ReadonlySet<string> } | null {
  switch (play.kind) {
    case 'bins':
      return { chips: play.items, exempt: new Set() };
    case 'select':
      return { chips: play.options, exempt: new Set(play.answer) };
    case 'match':
    case 'sequence':
    case 'sort':
      return null; // the whole arrangement is wrong, not one piece: the step's own line teaches
    default:
      return null;
  }
}

function parseStep(raw: unknown, i: number, out: Refusal[]): Step | null {
  const where = `step ${i + 1}`;
  if (!isRecord(raw)) {
    out.push({ where, why: 'not an object' });
    return null;
  }
  const id = str(raw.id) ? raw.id.trim() : `s${i + 1}`;
  const prompt = text(raw.prompt);
  const reveal = text(raw.reveal);
  if (!prompt) {
    out.push({ where, why: 'no prompt' });
    return null;
  }
  if (!reveal) {
    out.push({ where, why: 'no reveal — a step that reveals nothing taught nothing' });
    return null;
  }
  const play = parsePlay(raw.play, out, where);
  if (!play) return null;

  const teach = text(raw.teach);
  const w = wrongable(play);
  const pieceTeaches = w ? everyPieceTeaches(w.chips, w.exempt) : false;
  if (!teach && !pieceTeaches) {
    out.push({ where, why: 'a wrong move here says nothing (rule 3)' });
    return null;
  }

  const t = isRecord(raw.timer) ? raw.timer : null;
  const timer =
    t && num(t.seconds) && t.seconds >= 5 && t.seconds <= 600
      ? { seconds: Math.round(t.seconds) }
      : undefined;

  const s = isRecord(raw.score) ? raw.score : null;
  const score =
    s && num(s.per) && s.per > 0
      ? {
          per: Math.round(s.per),
          ...(num(s.streak) && s.streak > 0 ? { streak: Math.round(s.streak) } : {}),
        }
      : undefined;

  const branch = (Array.isArray(raw.branch) ? raw.branch : [])
    .map((b) =>
      isRecord(b) && (b.on === 'right' || b.on === 'wrong') && str(b.goto)
        ? { on: b.on, goto: b.goto.trim() }
        : null,
    )
    .filter((b): b is { on: 'right' | 'wrong'; goto: string } => b !== null);

  return {
    id,
    prompt,
    reveal,
    ...(teach ? { teach } : {}),
    play,
    ...(timer ? { timer } : {}),
    ...(score ? { score } : {}),
    ...(branch.length ? { branch } : {}),
  };
}

/**
 * The gate. Returns the composition, or null with every reason in `out` — which is for the bench and
 * the tests, never for the learner: a refusal is silent and the card falls to its floor.
 */
export function parseComposition(raw: unknown, out: Refusal[] = []): Composition | null {
  if (!isRecord(raw)) {
    out.push({ where: 'composition', why: 'not an object' });
    return null;
  }
  const title = text(raw.title);
  if (!title) {
    out.push({ where: 'composition', why: 'no title' });
    return null;
  }
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  if (rawSteps.length === 0 || rawSteps.length > MAX_STEPS) {
    out.push({ where: 'composition', why: `one to ${MAX_STEPS} steps, not ${rawSteps.length}` });
    return null;
  }
  const steps: Step[] = [];
  for (const [i, s] of rawSteps.entries()) {
    const step = parseStep(s, i, out);
    if (!step) return null;
    if (steps.some((p) => p.id === step.id)) {
      out.push({ where: `step ${i + 1}`, why: `two steps share the id ${step.id}` });
      return null;
    }
    steps.push(step);
  }
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) {
    for (const b of s.branch ?? []) {
      if (!ids.has(b.goto)) {
        out.push({ where: `step ${s.id}`, why: `branches to ${b.goto}, which is not a step` });
        return null;
      }
    }
  }
  return {
    id: str(raw.id) ? raw.id.trim() : `cx-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title,
    steps,
    source: raw.source === 'floor' ? 'floor' : 'designed',
  };
}

// --- what the renderer asks of a step -------------------------------------------------------------

/** The number of right moves a step needs before it is done. Drives the progress a learner sees. */
export function movesNeeded(play: Play): number {
  switch (play.kind) {
    case 'bins':
      return play.items.length;
    case 'sort':
      return 1;
    case 'match':
      return play.pairs.length;
    case 'sequence':
      return play.steps.length;
    case 'select':
      return play.answer.length;
    case 'slide':
    case 'drag':
      return 1;
    case 'canvas':
      return play.need;
  }
}

/** The line a wrong move earns: the piece's own if it has one, else the step's. */
export function teachFor(step: Step, pieceId?: string): string {
  if (pieceId) {
    const w = wrongable(step.play);
    const chip = w?.chips.find((c) => c.id === pieceId);
    if (chip?.teach) return chip.teach;
  }
  return step.teach ?? '';
}

/** Where the learner goes after this step. */
export function nextStep(comp: Composition, at: number, right: boolean): number {
  const step = comp.steps[at];
  const b = step?.branch?.find((x) => (x.on === 'right') === right);
  if (b) {
    const to = comp.steps.findIndex((s) => s.id === b.goto);
    if (to >= 0) return to;
  }
  return at + 1;
}
