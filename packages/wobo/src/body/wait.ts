/**
 * The wait — the orb doing the subject's thing while the thing arrives.
 *
 * docs/EMAILS-AND-ANIMATIONS.md §3 and §8, docs/THE-WAIT.md §1. A spinner says we are sorry; this
 * says the wait is ours to make pleasant. For maths the orb draws a number line and marks it; for
 * physics a pendulum swings under it; for biology a cell divides; for chemistry two beakers pour;
 * for the social sciences a map fills in; for computing a line is typed; for a photographed doubt a
 * page turns and a pencil underlines. Ten seconds, looped, calm, both themes.
 *
 * ONE SOURCE. This file is the whole vocabulary of those scenes: pure geometry, one function of one
 * number, no React, no clock, no colour. `WaitScene.tsx` draws it in the product; the GIF renderer
 * for mail drives the same component; a still is the same function at one chosen moment. A scene
 * drawn a second time by hand is a bug (§8, rule 1).
 *
 * Two rules make a scene cheap enough to run on a phone while a lesson is being fetched:
 *  - a scene has the SAME marks at every moment of its loop, so the renderer creates its elements
 *    once and writes attributes after that — no allocation, no React render, one rAF;
 *  - a scene ends where it began, so the loop has no jump in it. Anything that cannot return to its
 *    start (a line that was drawn, a beaker that emptied) fades out before the loop closes, and the
 *    marks that hold the stage — the axis, the glass, the page, the coastline — never fade at all,
 *    so the screen is never blank.
 *
 * Nothing here says anything. There is no text in a scene, and there is no percentage in one.
 */

// --- the three lengths of a wait ------------------------------------------------------------------

/** A wait shorter than this gets nothing but the orb's own breath (THE-WAIT §1). */
export const WAIT_SCENE_AT_MS = 2_000;

/** Past this a wait is long enough that a game is worth offering, and never imposing (§1). */
export const WAIT_GAME_AT_MS = 10_000;

/** One turn of any scene. Ten seconds, looped (EMAILS-AND-ANIMATIONS §3). */
export const WAIT_LOOP_MS = 10_000;

export type WaitLength = 'breath' | 'scene' | 'game';

/**
 * What a wait of this expected length is owed. Decided when the wait STARTS, because we know what
 * we asked for: a game during a two second wait is over before it begins, and an animation during a
 * two minute wait is an insult.
 */
export function waitLength(expectedMs: number): WaitLength {
  if (!Number.isFinite(expectedMs)) return 'scene';
  if (expectedMs < WAIT_SCENE_AT_MS) return 'breath';
  if (expectedMs < WAIT_GAME_AT_MS) return 'scene';
  return 'game';
}

// --- which scene a subject gets --------------------------------------------------------------------

export const WAIT_SCENE_NAMES = [
  'numberLine',
  'pendulum',
  'beakers',
  'cell',
  'caret',
  'map',
  'page',
] as const;

export type WaitSceneName = (typeof WAIT_SCENE_NAMES)[number];

/**
 * A board names its subjects whatever it likes — `physical_science`, `history_civics`, `computer` —
 * and the product's own families are six. Both land on a scene here, and an unknown one lands on
 * the number line rather than on nothing, exactly as an unknown subject takes maths' pigment
 * (`ui/hues.ts`).
 */
const SCENE_BY_SUBJECT: Record<string, WaitSceneName> = {
  math: 'numberLine',
  maths: 'numberLine',
  mathematics: 'numberLine',
  algebra: 'numberLine',
  geometry: 'numberLine',
  statistics: 'numberLine',
  physics: 'pendulum',
  physical_science: 'pendulum',
  mechanics: 'pendulum',
  chemistry: 'beakers',
  chem: 'beakers',
  science: 'beakers',
  general_science: 'beakers',
  biology: 'cell',
  bio: 'cell',
  life_science: 'cell',
  botany: 'cell',
  zoology: 'cell',
  cs: 'caret',
  computer: 'caret',
  computers: 'caret',
  computer_science: 'caret',
  computing: 'caret',
  coding: 'caret',
  it: 'caret',
  social: 'map',
  social_science: 'map',
  social_studies: 'map',
  sst: 'map',
  history: 'map',
  civics: 'map',
  history_civics: 'map',
  geography: 'map',
  economics: 'map',
  doubt: 'page',
  reading: 'page',
  page: 'page',
};

/** The scene for a subject id, a board's own name for one, or the doubt. Never fails. */
export function waitSceneFor(subject: string): WaitSceneName {
  const key = subject.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const direct = SCENE_BY_SUBJECT[key];
  if (direct) return direct;
  const head = key.split('_')[0] ?? '';
  return SCENE_BY_SUBJECT[head] ?? 'numberLine';
}

// --- what a scene is made of -----------------------------------------------------------------------

/** The box every scene is drawn in. Wide and short: the orb sits above it. */
export const WAIT_VIEW = { width: 120, height: 56 } as const;

interface MarkBase {
  /** 0..1. A mark at 0 is not drawn; nothing is ever hidden by moving it off the page. */
  o: number;
  /** Carries the subject's pigment rather than Wobo's ink. Two marks at most, ever. */
  pigment?: boolean;
}

export interface WaitLine extends MarkBase {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
}

export interface WaitDot extends MarkBase {
  kind: 'dot';
  cx: number;
  cy: number;
  r: number;
  /** Solid, or an outline at `w`. */
  fill: boolean;
  w?: number;
}

export interface WaitRect extends MarkBase {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
}

export interface WaitPath extends MarkBase {
  kind: 'path';
  d: string;
  w: number;
  fill?: boolean;
  /** 0..1 of the path's length, drawn from its start. Left out, the whole path is drawn. */
  draw?: number;
}

export type WaitMark = WaitLine | WaitDot | WaitRect | WaitPath;

// --- the small maths a scene is written in ---------------------------------------------------------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Where `p` sits inside the window [a, b], clamped. */
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
/** Smoothstep — everything in a scene starts and stops gently, nothing arrives on a straight line. */
const ease = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const round = (v: number) => Math.round(v * 100) / 100;

/**
 * The closing fade for anything that cannot return to where it started. It is zero at both ends of
 * the loop, so the frame at 1 is the frame at 0 and the loop has no jump in it.
 */
const cycle = (p: number, inAt = 0.06, outAt = 0.9) =>
  ease(seg(p, 0, inAt)) * (1 - ease(seg(p, outAt, 1)));

// --- the seven scenes -------------------------------------------------------------------------------

const NL = { y: 36, x0: 10, x1: 110, ticks: 5 } as const;

/** Maths: the orb draws a number line, marks the ticks, and hops a point along it. */
function numberLine(p: number): WaitMark[] {
  const marks: WaitMark[] = [
    { kind: 'line', x1: NL.x0, y1: NL.y, x2: NL.x1, y2: NL.y, w: 1, o: 0.45 },
  ];
  const gap = (NL.x1 - NL.x0) / (NL.ticks - 1);
  const close = 1 - ease(seg(p, 0.9, 1));
  for (let i = 0; i < NL.ticks; i++) {
    const x = NL.x0 + i * gap;
    marks.push({
      kind: 'line',
      x1: x,
      y1: NL.y - 4,
      x2: x,
      y2: NL.y + 4,
      w: 1,
      o: round(0.5 * ease(seg(p, 0.1 + i * 0.06, 0.28 + i * 0.06)) * close),
    });
  }
  // the point hops tick to tick, the way a hand counts along one
  const walk = ease(seg(p, 0.46, 0.88)) * (NL.ticks - 1);
  const k = Math.min(NL.ticks - 2, Math.floor(walk));
  const f = clamp01(walk - k);
  marks.push({
    kind: 'dot',
    cx: round(NL.x0 + gap * (k + f)),
    cy: round(NL.y - 3 - 9 * Math.sin(Math.PI * f)),
    r: 3,
    fill: true,
    pigment: true,
    o: round(cycle(p, 0.48, 0.9)),
  });
  return marks;
}

const PEN = { px: 60, py: 6, len: 38, swing: 0.46, cycles: 3 } as const;

/** Physics: a pendulum swings under the orb, at its own pace, forever. */
function pendulum(p: number): WaitMark[] {
  const a = PEN.swing * Math.cos(2 * Math.PI * PEN.cycles * p);
  const bx = round(PEN.px + PEN.len * Math.sin(a));
  const by = round(PEN.py + PEN.len * Math.cos(a));
  return [
    { kind: 'path', d: 'M33 43 Q60 53 87 43', w: 1, o: 0.16 },
    { kind: 'line', x1: PEN.px, y1: PEN.py, x2: bx, y2: by, w: 1, o: 0.5 },
    { kind: 'dot', cx: PEN.px, cy: PEN.py, r: 1.8, fill: true, o: 0.5 },
    { kind: 'dot', cx: bx, cy: by, r: 5, fill: true, pigment: true, o: 0.9 },
  ];
}

const BK = {
  left: { x: 18, y: 16, w: 28, floor: 44 },
  right: { x: 74, y: 20, w: 28, floor: 46 },
  full: 22,
} as const;

/** Chemistry: one beaker pours into the other and the level comes up. */
function beakers(p: number): WaitMark[] {
  const pour = ease(seg(p, 0.16, 0.78));
  const held = cycle(p, 0.08, 0.9);
  const lh = BK.full * (1 - pour);
  const rh = 2 + (BK.full - 2) * pour;
  return [
    { kind: 'path', d: 'M18 16 L18 44 L46 44 L46 16', w: 1, o: 0.45 },
    { kind: 'path', d: 'M74 20 L74 46 L102 46 L102 20', w: 1, o: 0.45 },
    {
      kind: 'rect',
      x: BK.left.x + 1,
      y: round(BK.left.floor - lh),
      w: BK.left.w - 2,
      h: round(lh),
      o: round(0.7 * held),
      pigment: true,
    },
    {
      kind: 'rect',
      x: BK.right.x + 1,
      y: round(BK.right.floor - rh),
      w: BK.right.w - 2,
      h: round(rh),
      o: round(0.7 * held),
      pigment: true,
    },
    {
      kind: 'path',
      d: 'M46 19 Q62 15 84 26',
      w: 1.4,
      o: round(0.55 * ease(seg(p, 0.18, 0.3)) * (1 - ease(seg(p, 0.7, 0.8)))),
    },
    {
      kind: 'dot',
      cx: 84,
      cy: round(BK.right.floor - rh),
      r: 1.6,
      fill: false,
      w: 1,
      o: round(0.5 * ease(seg(p, 0.25, 0.35)) * (1 - ease(seg(p, 0.72, 0.82)))),
    },
  ];
}

const CELL = { cx: 60, cy: 28, r: 15, apart: 17 } as const;

/** Biology: a cell divides, and one of the two settles into the middle to begin again. */
function cell(p: number): WaitMark[] {
  const split = ease(seg(p, 0.32, 0.78));
  const back = ease(seg(p, 0.84, 1));
  const d = CELL.apart * split * (1 - back);
  const r = round(mix(CELL.r, CELL.r - 4, split * (1 - back)));
  const ax = round(CELL.cx - d);
  const bx = round(CELL.cx + d);
  const waist = ease(seg(p, 0.3, 0.6)) * (1 - ease(seg(p, 0.6, 0.78)));
  return [
    { kind: 'dot', cx: ax, cy: CELL.cy, r, fill: false, w: 1, o: 0.6 },
    {
      kind: 'dot',
      cx: bx,
      cy: CELL.cy,
      r,
      fill: false,
      w: 1,
      o: round(0.6 * ease(seg(p, 0.3, 0.42)) * (1 - back)),
    },
    {
      kind: 'path',
      d: `M${CELL.cx} ${CELL.cy - r} Q${round(CELL.cx - 5 * waist)} ${CELL.cy} ${CELL.cx} ${CELL.cy + r}`,
      w: 1,
      o: round(0.5 * waist),
    },
    { kind: 'dot', cx: ax, cy: CELL.cy, r: 3, fill: true, pigment: true, o: 0.85 },
    {
      kind: 'dot',
      cx: bx,
      cy: CELL.cy,
      r: 3,
      fill: true,
      pigment: true,
      o: round(0.85 * ease(seg(p, 0.3, 0.42)) * (1 - back)),
    },
  ];
}

const CARET = { x: 22, top: 16, gap: 12, h: 5, widths: [62, 48, 56] } as const;

/** Computing: three lines are typed, and the caret keeps its own time. */
function caret(p: number): WaitMark[] {
  const marks: WaitMark[] = [];
  const close = 1 - ease(seg(p, 0.86, 0.98));
  // before the first line exists the caret sits at the head of it, which is where it returns to
  let head: { x: number; y: number } = { x: CARET.x - 2, y: CARET.top };
  for (let i = 0; i < CARET.widths.length; i++) {
    const from = 0.05 + i * 0.24;
    const grown = ease(seg(p, from, from + 0.2));
    const w = round((CARET.widths[i] as number) * grown);
    const y = CARET.top + i * CARET.gap;
    marks.push({
      kind: 'rect',
      x: CARET.x,
      y,
      w,
      h: CARET.h,
      r: 2,
      o: round(0.32 * (grown > 0 ? 1 : 0) * close),
    });
    if (grown > 0) head = { x: CARET.x + w, y };
  }
  // the caret returns to the head of the first line as the loop closes, so nothing jumps
  const home = ease(seg(p, 0.86, 1));
  const blink = (Math.cos(2 * Math.PI * 8 * p) + 1) / 2;
  marks.push({
    kind: 'rect',
    x: round(mix(head.x + 2, CARET.x, home)),
    y: round(mix(head.y - 1, CARET.top - 1, home)),
    w: 2,
    h: CARET.h + 2,
    o: round(0.35 + 0.55 * blink),
    pigment: true,
  });
  return marks;
}

const PLACES: readonly [number, number][] = [
  [38, 20],
  [56, 17],
  [70, 26],
  [60, 36],
  [45, 32],
];

/** The social sciences: a map, and the places on it coming in one at a time. */
function map(p: number): WaitMark[] {
  const close = 1 - ease(seg(p, 0.9, 1));
  const marks: WaitMark[] = [
    { kind: 'path', d: 'M22 14 L52 8 L78 15 L96 29 L84 45 L52 48 L28 38 Z', w: 1, o: 0.4 },
  ];
  PLACES.forEach(([x, y], i) => {
    const last = i === PLACES.length - 1;
    const from = 0.16 + i * 0.13;
    marks.push({
      kind: 'dot',
      cx: x,
      cy: y,
      r: last ? 3.2 : 2.4,
      fill: true,
      ...(last ? { pigment: true } : {}),
      o: round((last ? 0.9 : 0.5) * ease(seg(p, from, from + 0.1)) * close),
    });
  });
  return marks;
}

const PAGE = { x: 34, y: 8, w: 52, h: 40 } as const;

/** The doubt: the page turns, and a pencil underlines the line that matters. */
function page(p: number): WaitMark[] {
  const fold = ease(seg(p, 0.12, 0.62)) * (1 - ease(seg(p, 0.88, 1)));
  const c = round(30 * fold);
  const marks: WaitMark[] = [
    { kind: 'path', d: 'M34 8 L86 8 L86 48 L34 48 Z', w: 1, o: 0.45 },
  ];
  for (let i = 0; i < 3; i++) {
    const y = 19 + i * 9;
    marks.push({
      kind: 'line',
      x1: 40,
      y1: y,
      x2: [78, 70, 74][i] as number,
      y2: y,
      w: 1,
      o: 0.3,
    });
  }
  marks.push({
    kind: 'path',
    d: `M${round(86 - c)} 8 L86 ${round(8 + c)} L86 8 Z`,
    w: 1,
    fill: true,
    o: round(0.85 * (fold > 0.02 ? 1 : 0)),
  });
  const under = ease(seg(p, 0.6, 0.86));
  marks.push({
    kind: 'line',
    x1: 40,
    y1: 31,
    x2: round(mix(40, 70, under)),
    y2: 31,
    w: 1.6,
    pigment: true,
    o: round(cycle(p, 0.62, 0.9)),
  });
  return marks;
}

const SCENES: Record<WaitSceneName, (p: number) => WaitMark[]> = {
  numberLine,
  pendulum,
  beakers,
  cell,
  caret,
  map,
  page,
};

/**
 * One frame of a scene. `p` runs 0..1 across `WAIT_LOOP_MS`; anything outside wraps, so a caller
 * can hand it a raw elapsed fraction without thinking about the loop.
 */
export function waitFrame(name: WaitSceneName, p: number): readonly WaitMark[] {
  const t = Number.isFinite(p) ? ((p % 1) + 1) % 1 || (p >= 1 ? 1 : 0) : 0;
  return (SCENES[name] ?? numberLine)(t);
}

/**
 * The moment of each scene a still is taken at — the one a person would recognise the scene from.
 * Reduced motion gets this and the orb's spark, never a frozen empty first frame.
 */
export const WAIT_STILL_AT: Record<WaitSceneName, number> = {
  numberLine: 0.72,
  pendulum: 0.5,
  beakers: 0.55,
  cell: 0.7,
  caret: 0.6,
  map: 0.78,
  page: 0.72,
};

/** The still of a scene: the same function, at its most legible moment. */
export function waitStill(name: WaitSceneName): readonly WaitMark[] {
  return waitFrame(name, WAIT_STILL_AT[name] ?? 0.6);
}
