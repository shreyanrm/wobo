/**
 * The door an interaction design comes through on the client.
 *
 * The contract is the GENERATED one (`@wobo/contracts/plexus`, emitted from
 * `plexus/specs.py`): `InteractionDesign` is a composition of primitives, never code, and
 * "nothing generated ever executes on a learner's device" is kept by there being no other way in.
 * The gateway's Pydantic gate already refused a malformed design at insert; this re-checks the same
 * rules at render, because docs/CACHES.md §2 says a cached row is re-validated on every read and
 * because a design also reaches this renderer from a bench, a test and a floor.
 *
 * The refusal is SILENT (DESIGN.md §0.x): a design that fails here renders nothing and the caller
 * falls to the concept's template floor. `Refusal[]` exists for the bench and the tests, never for
 * the learner.
 *
 * The numbers below are the Python module's numbers, not new ones: STAGE_W/STAGE_H are its stage,
 * MIN_HIT_UNITS is 44 css px at the 3.3 px-per-unit a 390-wide phone gives. If specs.py moves them,
 * `parse.test.ts` fails on the constants before anything renders wrong.
 */

import type {
  BranchInteraction,
  CanvasMarkInteraction,
  DragInteraction,
  DropInteraction,
  Feedback,
  HitBox,
  InteractionDesign,
  Mark,
  MatchInteraction,
  RevealSpec,
  ScoreSpec,
  SequenceInteraction,
  SlideInteraction,
  SortInteraction,
  TapInteraction,
  TimerSpec,
} from '@wobo/contracts/plexus';

// --- the stage, and the finger's law (specs.py) ----------------------------------------------------

export const STAGE_W = 100;
export const STAGE_H = 62;
/** What one stage unit measures on a 390-wide phone (Discovery.tsx's PHONE_PX_PER_UNIT). */
export const PHONE_PX_PER_UNIT = 3.3;
/** 44 css px is the smallest thing a finger may be asked to land on. */
export const MIN_HIT_PX = 44;
export const MIN_HIT_UNITS = MIN_HIT_PX / PHONE_PX_PER_UNIT;

// --- the vocabulary --------------------------------------------------------------------------------

export type Primitive =
  | TapInteraction
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
  | RevealSpec;

export type PrimitiveKind = Primitive['kind'];

/** The primitives in which the learner MOVES something. A design of only the rest is a quiz. */
export const MANIPULATIVE: ReadonlySet<PrimitiveKind> = new Set<PrimitiveKind>([
  'drag',
  'slide',
  'drop',
  'sort',
  'match',
  'sequence',
  'mark',
]);

/** The modifiers. Real primitives, but none of them carries a beat on its own. */
export const MODIFIERS: ReadonlySet<PrimitiveKind> = new Set<PrimitiveKind>([
  'timer',
  'score',
  'reveal',
]);

/** One beat of a design, with its primitive narrowed off `unknown`. */
export interface Beat {
  id: string;
  beat: 'build' | 'check' | 'fun';
  primitive: Primitive;
  surprise?: string;
}

/** A design that has been through the door: every field narrowed, every reference resolved. */
export interface Design
  extends Omit<InteractionDesign, 'steps' | 'marks' | 'coreVersion' | 'designedAt'> {
  steps: Beat[];
  marks: Mark[];
}

export interface Refusal {
  where: string;
  why: string;
}

// --- the small checks -------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const text = (v: unknown): string => (str(v) ? v.trim() : '');
const ids = <T extends { id: string }>(xs: T[]) => new Set(xs.map((x) => x.id));

const MARK_SHAPES: ReadonlySet<string> = new Set(['circle', 'rect', 'line', 'ring', 'text']);
const BEATS: ReadonlySet<string> = new Set(['build', 'check', 'fun']);
const KINDS: ReadonlySet<string> = new Set([
  'classify',
  'order',
  'match',
  'vary',
  'construct',
  'discriminate',
  'drill',
  'watch',
]);

function feedback(raw: unknown): Feedback | null {
  if (!isRecord(raw)) return null;
  const right = text(raw.right);
  const wrong = text(raw.wrong);
  // `wrong` is the load-bearing half: it must say something about the concept. An empty one is the
  // "try again" that taught nothing, so it is refused rather than defaulted.
  if (!right || !wrong) return null;
  return { right, wrong, ...(str(raw.hint) ? { hint: raw.hint.trim() } : {}) };
}

/** A touchable rectangle: on the stage, and never smaller than a finger. */
function hitBox(raw: unknown): HitBox | null {
  if (!isRecord(raw) || !num(raw.x) || !num(raw.y) || !num(raw.w) || !num(raw.h)) return null;
  const { x, y, w, h } = raw;
  if (x < 0 || y < 0 || x > STAGE_W || y > STAGE_H) return null;
  if (w < MIN_HIT_UNITS - 1e-9 || h < MIN_HIT_UNITS - 1e-9) return null;
  if (x + w > STAGE_W + 1e-9 || y + h > STAGE_H + 1e-9) return null;
  return { x, y, w, h };
}

function mark(raw: unknown): Mark | null {
  if (!isRecord(raw) || !str(raw.id)) return null;
  if (typeof raw.shape !== 'string' || !MARK_SHAPES.has(raw.shape)) return null;
  if (!num(raw.x) || !num(raw.y)) return null;
  return {
    id: raw.id,
    shape: raw.shape as Mark['shape'],
    x: raw.x,
    y: raw.y,
    tone: raw.tone === 'hue' ? 'hue' : raw.tone === 'muted' ? 'muted' : 'ink',
    ...(num(raw.x2) ? { x2: raw.x2 } : {}),
    ...(num(raw.y2) ? { y2: raw.y2 } : {}),
    ...(num(raw.r) ? { r: raw.r } : {}),
    ...(num(raw.w) ? { w: raw.w } : {}),
    ...(num(raw.h) ? { h: raw.h } : {}),
    ...(str(raw.text) ? { text: raw.text.trim() } : {}),
    ...(raw.fill === 'solid' || raw.fill === 'soft' ? { fill: raw.fill } : {}),
  };
}

// --- the primitives ---------------------------------------------------------------------------------

/**
 * Each case mirrors one Pydantic validator in `plexus/specs.py`. Where the Python raises, this
 * returns null and pushes the same sentence, so a refusal reads the same on both sides of the wire.
 */
function primitive(raw: unknown, out: Refusal[], where: string): Primitive | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    out.push({ where, why: 'no primitive' });
    return null;
  }
  const kind = raw.kind;
  const no = (why: string): null => {
    out.push({ where: `${where}.${kind}`, why });
    return null;
  };
  const prompt = text(raw.prompt);
  const fb = feedback(raw.feedback);

  switch (kind) {
    case 'drop': {
      if (!prompt) return no('no prompt');
      if (!fb) return no('no feedback, or a wrong line that teaches nothing');
      const tokens: DropInteraction['tokens'] = [];
      for (const t of Array.isArray(raw.tokens) ? raw.tokens : []) {
        if (!isRecord(t) || !str(t.id) || !str(t.label) || !str(t.belongs) || !str(t.why)) continue;
        const box = hitBox(t.box);
        if (!box) return no(`token ${t.id} has no hit area a finger can use`);
        tokens.push({
          id: t.id,
          label: t.label.trim(),
          box,
          belongs: t.belongs,
          why: t.why.trim(),
        });
      }
      if (tokens.length < 2 || tokens.length > 8) return no('two to eight tokens');
      const zones: DropInteraction['zones'] = [];
      for (const z of Array.isArray(raw.zones) ? raw.zones : []) {
        if (!isRecord(z) || !str(z.id) || !str(z.label)) continue;
        const box = hitBox(z.box);
        const zfb = feedback(z.feedback);
        if (!box) return no(`zone ${z.id} has no hit area a finger can use`);
        if (!zfb) return no(`zone ${z.id} refuses a token without saying why`);
        const accepts = (Array.isArray(z.accepts) ? z.accepts : []).filter(
          (a): a is string => typeof a === 'string',
        );
        if (accepts.length === 0) return no(`zone ${z.id} accepts nothing`);
        zones.push({
          id: z.id,
          label: z.label.trim(),
          box,
          accepts,
          ...(num(z.capacity) && z.capacity >= 1 ? { capacity: Math.round(z.capacity) } : {}),
          feedback: zfb,
        });
      }
      if (zones.length < 2 || zones.length > 4) return no('two to four zones');
      const tokenIds = ids(tokens);
      const zoneIds = ids(zones);
      for (const z of zones) {
        const unknown = z.accepts.filter((a) => !tokenIds.has(a));
        if (unknown.length) return no(`zone ${z.id} accepts tokens that do not exist: ${unknown}`);
      }
      for (const t of tokens) {
        if (!zoneIds.has(t.belongs)) return no(`token ${t.id} belongs to no zone (${t.belongs})`);
      }
      return { kind: 'drop', prompt, tokens, zones, feedback: fb };
    }

    case 'sort': {
      if (!prompt) return no('no prompt');
      if (!fb) return no('no feedback, or a wrong line that teaches nothing');
      const items: SortInteraction['items'] = [];
      for (const i of Array.isArray(raw.items) ? raw.items : []) {
        if (!isRecord(i) || !str(i.id) || !str(i.label) || !str(i.why)) continue;
        const box = hitBox(i.box);
        if (!box) return no(`item ${i.id} has no hit area a finger can use`);
        if (!num(i.rank) || i.rank < 1) return no(`item ${i.id} has no rank`);
        items.push({
          id: i.id,
          label: i.label.trim(),
          box,
          rank: Math.round(i.rank),
          why: i.why.trim(),
        });
      }
      if (items.length < 3 || items.length > 7) return no('three to seven items');
      const ranks = items.map((i) => i.rank).sort((a, b) => a - b);
      const wanted = items.map((_, n) => n + 1);
      if (ranks.join() !== wanted.join())
        return no(`ranks must be 1..${items.length} with no gaps or ties: ${ranks}`);
      return {
        kind: 'sort',
        prompt,
        items,
        axis: raw.axis === 'horizontal' ? 'horizontal' : 'vertical',
        feedback: fb,
      };
    }

    case 'match': {
      if (!prompt) return no('no prompt');
      if (!fb) return no('no feedback, or a wrong line that teaches nothing');
      const card = hitBox(raw.card);
      if (!card) return no('the card is smaller than a finger, or off the stage');
      const pairs: MatchInteraction['pairs'] = [];
      for (const p of Array.isArray(raw.pairs) ? raw.pairs : []) {
        if (!isRecord(p) || !str(p.id) || !str(p.left) || !str(p.right) || !str(p.why)) continue;
        pairs.push({
          id: p.id,
          left: p.left.trim(),
          right: p.right.trim(),
          why: p.why.trim(),
        });
      }
      if (pairs.length < 2 || pairs.length > 6) return no('two to six pairs');
      for (const side of ['left', 'right'] as const) {
        const vals = pairs.map((p) => p[side]);
        if (new Set(vals).size !== vals.length)
          return no(`two pairs share a ${side}, so the match has no one answer`);
      }
      return { kind: 'match', prompt, pairs, card, feedback: fb };
    }

    case 'sequence': {
      if (!prompt) return no('no prompt');
      if (!fb) return no('no feedback, or a wrong line that teaches nothing');
      const steps: SequenceInteraction['steps'] = [];
      for (const s of Array.isArray(raw.steps) ? raw.steps : []) {
        if (!isRecord(s) || !str(s.id) || !str(s.label) || !str(s.check)) continue;
        const box = hitBox(s.box);
        const sfb = feedback(s.feedback);
        if (!box) return no(`step ${s.id} has no hit area a finger can use`);
        if (!sfb) return no(`step ${s.id} says nothing when it is picked out of turn`);
        steps.push({
          id: s.id,
          label: s.label.trim(),
          box,
          check: s.check.trim(),
          feedback: sfb,
        });
      }
      if (steps.length < 2 || steps.length > 6) return no('two to six steps');
      return { kind: 'sequence', prompt, steps, feedback: fb };
    }

    case 'branch': {
      if (!prompt) return no('no prompt');
      if (!fb) return no('no feedback, or a wrong line that teaches nothing');
      const options: BranchInteraction['options'] = [];
      for (const o of Array.isArray(raw.options) ? raw.options : []) {
        if (!isRecord(o) || !str(o.id) || !str(o.label) || typeof o.correct !== 'boolean') continue;
        const box = hitBox(o.box);
        if (!box) return no(`option ${o.id} has no hit area a finger can use`);
        options.push({
          id: o.id,
          label: o.label.trim(),
          box,
          correct: o.correct,
          teaches: text(o.teaches),
          ...(str(o.goto) ? { goto: o.goto.trim() } : {}),
        });
      }
      if (options.length < 2 || options.length > 5) return no('two to five options');
      const right = options.filter((o) => o.correct);
      const wrong = options.filter((o) => !o.correct);
      if (!right.length || !wrong.length)
        return no('a branch needs at least one right answer and at least one wrong one');
      for (const o of wrong) {
        if (!o.teaches)
          return no(
            `wrong option ${o.id} teaches nothing; a distractor must be a real misconception with the counter-example in \`teaches\``,
          );
      }
      return { kind: 'branch', prompt, options, feedback: fb };
    }

    case 'mark': {
      if (!prompt) return no('no prompt');
      if (!fb) return no('no feedback, or a wrong line that teaches nothing');
      const tool = raw.tool;
      if (tool !== 'point' && tool !== 'line' && tool !== 'circle' && tool !== 'path')
        return no('no tool');
      const targets: CanvasMarkInteraction['targets'] = [];
      for (const t of Array.isArray(raw.targets) ? raw.targets : []) {
        if (!isRecord(t) || !str(t.id) || !num(t.x) || !num(t.y) || !str(t.why)) continue;
        if (t.x < 0 || t.x > STAGE_W || t.y < 0 || t.y > STAGE_H) continue;
        const r = num(t.r) ? t.r : MIN_HIT_UNITS / 2;
        if (r < MIN_HIT_UNITS / 2 - 1e-9) return no(`target ${t.id} is smaller than a finger`);
        targets.push({ id: t.id, x: t.x, y: t.y, r, why: t.why.trim() });
      }
      if (targets.length < 1 || targets.length > 6) return no('one to six targets');
      const need = num(raw.need) ? Math.round(raw.need) : targets.length;
      if (need < 1) return no('need is under one');
      if (need > targets.length)
        return no(`need ${need} of ${targets.length} targets is unreachable`);
      return { kind: 'mark', prompt, tool, targets, need, feedback: fb };
    }

    case 'slide': {
      if (!prompt) return no('no prompt');
      if (!num(raw.min) || !num(raw.max) || !num(raw.from) || !num(raw.at))
        return no('min, max, from and at must all be finite numbers');
      if (raw.max <= raw.min) return no('max is not above min');
      if (raw.from < raw.min || raw.from > raw.max) return no('from is outside the range');
      if (raw.at < raw.min || raw.at > raw.max) return no('at is outside the range');
      if (raw.at === raw.from) return no('the threshold is where the slider already starts');
      let bind: SlideInteraction['bind'];
      if (isRecord(raw.bind)) {
        const b = raw.bind;
        const at = Array.isArray(b.at) ? b.at : [];
        const prop = b.prop === 'x' || b.prop === 'y' || b.prop === 'r' ? b.prop : null;
        if (!str(b.mark) || !prop || at.length !== 2 || !num(at[0]) || !num(at[1]))
          return no('the bind is malformed');
        bind = { mark: b.mark, prop, at: [at[0], at[1]] };
      }
      return {
        kind: 'slide',
        prompt,
        min: raw.min,
        max: raw.max,
        from: raw.from,
        at: raw.at,
        ...(str(raw.unit) ? { unit: raw.unit.trim() } : {}),
        ...(str(raw.valueLabel) ? { valueLabel: raw.valueLabel.trim() } : {}),
        ...(bind ? { bind } : {}),
        ...(fb ? { feedback: fb } : {}),
      };
    }

    case 'tap': {
      if (!prompt) return no('no prompt');
      const targets = (Array.isArray(raw.targets) ? raw.targets : []).filter(
        (t): t is string => typeof t === 'string' && t.trim() !== '',
      );
      if (targets.length === 0) return no('nothing to tap');
      const need = num(raw.need) ? Math.round(raw.need) : targets.length;
      if (need < 1 || need > targets.length) return no('need is unreachable');
      return { kind: 'tap', prompt, targets, need, ...(fb ? { feedback: fb } : {}) };
    }

    case 'drag': {
      if (!prompt) return no('no prompt');
      if (!str(raw.handle)) return no('no handle');
      const to = isRecord(raw.to) ? raw.to : null;
      if (!to || !num(to.x) || !num(to.y)) return no('no drop zone');
      const radius = num(raw.radius) && raw.radius > 0 ? raw.radius : MIN_HIT_UNITS / 2;
      if (radius < MIN_HIT_UNITS / 2 - 1e-9) return no('the drop zone is smaller than a finger');
      return {
        kind: 'drag',
        prompt,
        handle: raw.handle,
        to: { x: to.x, y: to.y },
        radius,
        ...(fb ? { feedback: fb } : {}),
      };
    }

    case 'timer': {
      if (!fb) return no('no feedback');
      if (!num(raw.seconds) || raw.seconds < 10 || raw.seconds > 300)
        return no('a clock runs ten to three hundred seconds');
      const onExpire = raw.onExpire;
      if (onExpire !== 'reveal' && onExpire !== 'end' && onExpire !== 'again')
        return no('no onExpire');
      return {
        kind: 'timer',
        seconds: Math.round(raw.seconds),
        onExpire,
        visible: raw.visible !== false,
        feedback: fb,
      };
    }

    case 'score': {
      if (!fb) return no('no feedback');
      if (!num(raw.perRight) || raw.perRight < 1) return no('a right move must pay at least one');
      const perWrong = num(raw.perWrong) ? Math.round(raw.perWrong) : 0;
      if (perWrong > 0) return no('a wrong move costs, never pays');
      const show =
        raw.show === 'bar' || raw.show === 'none' || raw.show === 'number' ? raw.show : 'number';
      return {
        kind: 'score',
        perRight: Math.round(raw.perRight),
        perWrong,
        ...(num(raw.target) && raw.target >= 1 ? { target: Math.round(raw.target) } : {}),
        show,
        feedback: fb,
      };
    }

    case 'reveal': {
      if (!fb) return no('no feedback');
      const what = text(raw.what);
      if (!what) return no('a reveal that reveals nothing');
      const trigger = raw.trigger;
      if (
        trigger !== 'onRight' &&
        trigger !== 'onWrong' &&
        trigger !== 'onDone' &&
        trigger !== 'onTap'
      )
        return no('no trigger');
      const marks = (Array.isArray(raw.marks) ? raw.marks : []).filter(
        (m): m is string => typeof m === 'string' && m.trim() !== '',
      );
      return { kind: 'reveal', trigger, what, marks, feedback: fb };
    }

    default:
      out.push({ where, why: `${kind} is not a primitive` });
      return null;
  }
}

// --- the design --------------------------------------------------------------------------------------

/** The gate. Null on refusal, with every reason in `out` for the bench and the tests. */
export function parseDesign(raw: unknown, out: Refusal[] = []): Design | null {
  if (!isRecord(raw)) {
    out.push({ where: 'design', why: 'not an object' });
    return null;
  }
  const concept = text(raw.concept);
  const mechanic = text(raw.mechanic);
  const whyLine = text(raw.why);
  if (!concept) {
    out.push({ where: 'design', why: 'no concept' });
    return null;
  }
  if (!mechanic || !whyLine) {
    out.push({ where: 'design', why: 'a design must say what its mechanic is and why' });
    return null;
  }
  if (typeof raw.kind !== 'string' || !KINDS.has(raw.kind)) {
    out.push({ where: 'design', why: 'no row of section 2' });
    return null;
  }

  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  if (rawSteps.length < 1 || rawSteps.length > 5) {
    out.push({ where: 'design', why: `one to five beats, not ${rawSteps.length}` });
    return null;
  }
  const steps: Beat[] = [];
  for (const [i, s] of rawSteps.entries()) {
    const where = `beat ${i + 1}`;
    if (!isRecord(s) || typeof s.beat !== 'string' || !BEATS.has(s.beat)) {
      out.push({ where, why: 'a beat is one of build, check, fun' });
      return null;
    }
    const p = primitive(s.primitive, out, where);
    if (!p) return null;
    const id = str(s.id) ? s.id.trim() : `b${i + 1}`;
    if (steps.some((b) => b.id === id)) {
      out.push({ where, why: `two beats share the id ${id}` });
      return null;
    }
    steps.push({
      id,
      beat: s.beat as Beat['beat'],
      primitive: p,
      ...(str(s.surprise) ? { surprise: s.surprise.trim() } : {}),
    });
  }

  // A design of nothing but timers, scores and reveals asks for no act (specs.py's own words).
  if (steps.every((s) => MODIFIERS.has(s.primitive.kind))) {
    out.push({
      where: 'design',
      why: 'a design of nothing but timers, scores and reveals asks for no act',
    });
    return null;
  }

  const marks = (Array.isArray(raw.marks) ? raw.marks : [])
    .map(mark)
    .filter((m): m is Mark => m !== null);
  const markIds = new Set(marks.map((m) => m.id));

  // Every reference resolves, or the drawing is wrong rather than absent: a slide bound to a mark
  // that is not there moves nothing, and a tap whose target is not there can never be completed.
  for (const s of steps) {
    const p = s.primitive;
    if (p.kind === 'slide' && p.bind && !markIds.has(p.bind.mark)) {
      out.push({ where: s.id, why: `the slide drives ${p.bind.mark}, which is not on the stage` });
      return null;
    }
    if (p.kind === 'tap') {
      const missing = p.targets.filter((t) => !markIds.has(t));
      if (missing.length) {
        out.push({ where: s.id, why: `taps a mark that is not on the stage: ${missing}` });
        return null;
      }
      // Two hit areas closer than a finger is wide are one hit area, and the one underneath can
      // never be tapped at all. It looks like a design that works and behaves like a dead target,
      // so it is refused here rather than found by a child who cannot finish the beat.
      for (const id of p.targets) {
        const mine = marks.find((m) => m.id === id);
        if (!mine) continue;
        const a = hitCentre(mine);
        for (const other of marks) {
          if (other.id === id) continue;
          const b = hitCentre(other);
          if (Math.hypot(a.x - b.x, a.y - b.y) < MIN_HIT_UNITS) {
            out.push({
              where: s.id,
              why: `the hit areas of ${id} and ${other.id} overlap; a finger cannot tell them apart`,
            });
            return null;
          }
        }
      }
    }
    if (p.kind === 'drag' && !markIds.has(p.handle)) {
      out.push({ where: s.id, why: `drags ${p.handle}, which is not on the stage` });
      return null;
    }
    if (p.kind === 'branch') {
      const beats = new Set(steps.map((b) => b.id));
      for (const o of p.options) {
        if (o.goto && !beats.has(o.goto)) {
          out.push({
            where: s.id,
            why: `option ${o.id} branches to ${o.goto}, which is not a beat`,
          });
          return null;
        }
      }
    }
  }

  const refreshDays = num(raw.refreshDays) ? Math.round(raw.refreshDays) : 90;
  return {
    id: str(raw.id) ? raw.id.trim() : `design-${concept.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    concept,
    kind: raw.kind as Design['kind'],
    mechanic,
    why: whyLine,
    steps,
    marks,
    source: raw.source === 'floor' ? 'floor' : 'model',
    refreshDays: refreshDays >= 1 && refreshDays <= 365 ? refreshDays : 90,
  };
}

// --- what the renderer asks of a beat -----------------------------------------------------------------

/** How many right moves this primitive needs before the beat is done. */
export function movesNeeded(p: Primitive): number {
  switch (p.kind) {
    case 'drop':
      return p.tokens.length;
    case 'sort':
      return 1;
    case 'match':
      return p.pairs.length;
    case 'sequence':
      return p.steps.length;
    case 'branch':
      return 1;
    case 'mark':
      return p.need;
    case 'tap':
      return p.need;
    case 'slide':
    case 'drag':
      return 1;
    default:
      return 0;
  }
}

/**
 * ONE MISTAKE: the piece the learner moved, and WHERE THEY PUT IT when the move had a where.
 *
 * The second half is the one that was missing. A drop is wrong as a PAIR — this token, that bin —
 * and the bin's own refusal is the only line that says why the placement was wrong rather than why
 * the piece is what it is. `DropPlay` passed the token alone, so the zone branch below was
 * unreachable and every refusal a designer wrote went unread.
 */
export interface Mistake {
  piece?: string | undefined;
  /** The drop zone the token was put into. Only a drop has one. */
  into?: string | undefined;
}

/** What a piece is called, for a question that names it rather than pointing vaguely. */
function labelOf(p: Primitive, id: string): string {
  switch (p.kind) {
    case 'drop':
      return p.tokens.find((t) => t.id === id)?.label ?? '';
    case 'branch':
      return p.options.find((o) => o.id === id)?.label ?? '';
    case 'sequence':
      return p.steps.find((s) => s.id === id)?.label ?? '';
    case 'sort':
      return p.items.find((i) => i.id === id)?.label ?? '';
    case 'match':
      return p.pairs.find((x) => x.id === id)?.left ?? '';
    default:
      return '';
  }
}

/**
 * Every reason THIS mistake could earn, best first: the refusal of the place they put it, then the
 * piece's own reason, then the primitive's line, then its hint. Each one is about the IDEA.
 */
function reasonsFor(p: Primitive, mistake: Mistake): string[] {
  const out: string[] = [];
  const { piece, into } = mistake;

  // 1. THE PLACE THEY PUT IT. A bin refuses for a reason, and that reason is the mistake itself.
  if (p.kind === 'drop' && into) {
    const zone = p.zones.find((z) => z.id === into);
    if (zone?.feedback.wrong) out.push(zone.feedback.wrong);
  }

  // 2. the piece's own reason.
  if (piece) {
    switch (p.kind) {
      case 'drop': {
        const token = p.tokens.find((t) => t.id === piece);
        if (token?.why) out.push(token.why);
        // A zone id arriving as the piece (a learner tapping the bin itself) is still a real move.
        const zone = p.zones.find((z) => z.id === piece);
        if (zone?.feedback.wrong) out.push(zone.feedback.wrong);
        break;
      }
      case 'branch': {
        const option = p.options.find((o) => o.id === piece);
        if (option?.teaches) out.push(option.teaches);
        break;
      }
      case 'sequence': {
        const step = p.steps.find((s) => s.id === piece);
        if (step?.feedback.wrong) out.push(step.feedback.wrong);
        break;
      }
      case 'match': {
        const pair = p.pairs.find((x) => x.id === piece);
        if (pair?.why) out.push(pair.why);
        break;
      }
      case 'sort': {
        const item = p.items.find((i) => i.id === piece);
        if (item?.why) out.push(item.why);
        break;
      }
      case 'mark': {
        const target = p.targets.find((t) => t.id === piece);
        if (target?.why) out.push(target.why);
        break;
      }
      default:
        break;
    }
  }

  // 3. the primitive's own line, and the hint behind it.
  const own = 'feedback' in p ? p.feedback : null;
  if (own?.wrong) out.push(own.wrong);
  if (own?.hint) out.push(own.hint);

  return out.map((s) => s.trim()).filter((s, i, all) => s !== '' && all.indexOf(s) === i);
}

/** A name short enough to sit inside a question. A label that runs on is cut at its first clause. */
function shortLabel(label: string): string {
  const s = label.trim();
  if (s.length <= 32) return s;
  const cut = s.search(/[:;,]/);
  return (cut > 0 ? s.slice(0, cut) : s).trim();
}

/** The alternatives this act puts in front of the learner, in the designer's own words. */
function alternatives(p: Primitive): string[] {
  switch (p.kind) {
    case 'drop':
      return p.zones.map((z) => z.label);
    case 'branch':
      return p.options.map((o) => o.label);
    case 'sort':
      return p.items.map((i) => i.label);
    case 'sequence':
      return p.steps.map((s) => s.label);
    case 'match':
      return p.pairs.map((x) => x.left);
    default:
      return [];
  }
}

/**
 * The last rung: what to ask after reading the act's OWN ask back, in the terms it is played in.
 *
 * The tail alone would be about anything; carried on this act's prompt it can only be about this
 * concept, which is the whole point. A modifier has no ask and so has no rung here.
 */
const ASK_BACK: Readonly<Record<PrimitiveKind, string>> = {
  drop: 'Which of them takes it, and what puts it there?',
  sort: 'What has to be true of the one that comes first?',
  match: 'What are you matching on?',
  sequence: 'What has to happen before anything else can?',
  branch: 'Which one can you rule out?',
  mark: 'Which one are you sure of?',
  tap: 'Which one are you sure of?',
  drag: 'Where does it have to end up?',
  slide: 'What should stay the same as you move it?',
  timer: '',
  score: '',
  reveal: '',
};

/** The ask as a sentence, so a question can be hung off the end of it. */
const asSentence = (s: string): string => (/[.?!]$/.test(s) ? s : `${s}.`);

/**
 * What Wobo ASKS once the concept's own words for this mistake are spent.
 *
 * docs/LEARNING-MODEL.md rule 3: where the core carries nothing for this mistake, the tutor asks
 * one question rather than asserting. A question is not a generic hint: it hands the thinking back
 * instead of repeating a sentence that has already failed twice (docs/REWARDS.md §4).
 *
 * AND RULE 3 EXEMPTS NO RUNG, LEAST OF ALL THIS ONE. The bottom of the ladder is reached exactly
 * when the concept has nothing left, which is where a struggling learner arrives after repeated
 * misses: the learner who needs this concept's own words most is the one this rung answers. So
 * every question here is built out of the act's own material — the piece, the place they put it,
 * the alternatives it offers, and finally its own ask read back — and there is no rung underneath
 * that could be about fractions, marble or pressure equally. An act with no material worth naming
 * asks nothing rather than asking about nothing, and `reasonFor` spends the concept's own reasons
 * instead (`asking.test.ts` plays every act in the vocabulary to the bottom and proves it).
 */
function questionsFor(p: Primitive, mistake: Mistake): string[] {
  const out: string[] = [];
  const piece = mistake.piece ? shortLabel(labelOf(p, mistake.piece)) : '';
  const place =
    p.kind === 'drop' && mistake.into
      ? shortLabel(p.zones.find((z) => z.id === mistake.into)?.label ?? '')
      : '';

  // 1. the piece and the place they put it, both named.
  if (piece && place)
    out.push(`What would have to be true of ${piece} for it to belong with ${place}?`);

  // 2. the piece, asked the way this act is played.
  if (piece) {
    switch (p.kind) {
      case 'drop':
      case 'sort':
        out.push(`What is it about ${piece} that decides where it goes?`);
        break;
      case 'branch':
        out.push(`What would have to be true for ${piece} to be the answer?`);
        break;
      case 'match':
        out.push(`What does ${piece} need from the one it joins?`);
        break;
      case 'sequence':
        out.push(`What has to be true before ${piece} can happen?`);
        break;
      default:
        break;
    }
  }

  // 3. two of this act's own alternatives, held against each other.
  const [a, b] = alternatives(p)
    .map(shortLabel)
    .filter((l) => l !== '' && l !== piece);
  if (a && b) {
    switch (p.kind) {
      case 'drop':
        out.push(`What does ${a} ask of a piece that ${b} does not?`);
        break;
      case 'branch':
        out.push(`What would rule out ${a} but leave ${b} standing?`);
        break;
      case 'sort':
        out.push(`What decides whether ${a} comes before ${b}?`);
        break;
      case 'sequence':
        out.push(`What has to be true before ${b} can follow ${a}?`);
        break;
      case 'match':
        out.push(`What does ${a} need that ${b} does not?`);
        break;
      default:
        break;
    }
  }

  // 4. the act's own ask, read back, which is this concept's words whatever the concept is.
  const ask = 'prompt' in p ? p.prompt.trim() : '';
  const tail = ASK_BACK[p.kind];
  if (ask && tail) out.push(`Read it again: ${asSentence(ask)} ${tail}`);

  return out.map((s) => s.trim()).filter((s, i, all) => s !== '' && all.indexOf(s) === i);
}

/**
 * THE LINE A WRONG MOVE EARNS, and never the one just said.
 *
 * Drawn where the mistake is (`reasonsFor`), spent one at a time, and once this concept has
 * nothing left for this mistake the tutor asks (`questionsFor`). `said` is what this beat has
 * already told the learner, so a repeated mistake is never answered with a repeated sentence:
 * docs/LEARNING-MODEL.md, "the tutor never leaves", rules 3 and 4.
 */
export function reasonFor(
  p: Primitive,
  mistake: Mistake = {},
  said: readonly string[] = [],
): string {
  const candidates = [...reasonsFor(p, mistake), ...questionsFor(p, mistake)];
  const last = said.length > 0 ? said[said.length - 1] : '';
  // Something they have not been told yet, in order of how well it fits the mistake.
  const fresh = candidates.find((c) => !said.includes(c));
  if (fresh) return fresh;
  // All spent: come back round, but never land on the sentence that is still on the screen.
  return candidates.find((c) => c !== last) ?? candidates[0] ?? '';
}

/**
 * The line a wrong move earns, for a caller that knows only the piece.
 *
 * One policy, not two: this is `reasonFor` with no memory and no destination, kept because the
 * piece-only shape is what the older call sites and their tests speak.
 */
export function teachFor(p: Primitive, pieceId?: string): string {
  return reasonFor(p, { piece: pieceId });
}

/** The line a right move earns, when the primitive has one worth saying. */
export function praiseFor(p: Primitive): string {
  return 'feedback' in p && p.feedback ? p.feedback.right : '';
}

/** The modifier of `kind` riding on this design, if any. Modifiers are beats of their own. */
export function modifier<K extends 'timer' | 'score' | 'reveal'>(
  design: Design,
  kind: K,
): Extract<Primitive, { kind: K }> | undefined {
  for (const s of design.steps) {
    if (s.primitive.kind === kind) return s.primitive as Extract<Primitive, { kind: K }>;
  }
  return undefined;
}

/** The beats a learner actually plays: the acts, in order, with the modifiers lifted off. */
export function acts(design: Design): Beat[] {
  return design.steps.filter((s) => !MODIFIERS.has(s.primitive.kind));
}

/** Where the learner goes after this beat. A branch's `goto` wins; otherwise the next act. */
export function nextBeat(design: Design, at: number, chosen?: string): number {
  const list = acts(design);
  const here = list[at];
  if (here?.primitive.kind === 'branch' && chosen) {
    const option = here.primitive.options.find((o) => o.id === chosen);
    if (option?.goto) {
      const to = list.findIndex((b) => b.id === option.goto);
      if (to >= 0) return to;
    }
  }
  return at + 1;
}

/**
 * Where a mark is TOUCHED, which is not always where it is drawn. A rect is usually a boundary (a
 * cell wall, a bar, a box) and its middle belongs to whatever is inside it, so its hit sits on the
 * middle of its own top edge. Everything else is hit at its centre.
 */
export function hitCentre(m: Mark): { x: number; y: number } {
  return m.shape === 'rect' ? { x: m.x + (m.w ?? 10) / 2, y: m.y } : { x: m.x, y: m.y };
}

/**
 * A box's height in css pixels at a given stage width, floored at the finger's law. The renderer
 * flows these controls rather than placing them by hand (a 100x62 stage at 390 leaves eleven px of
 * type), so the box survives as the SIZE it guaranteed, which is the half that a finger cares about.
 */
export function boxHeightPx(box: HitBox, stageWidthPx: number): number {
  return Math.max(MIN_HIT_PX, (box.h / STAGE_W) * stageWidthPx);
}
