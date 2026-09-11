/**
 * Wobo's hand (docs/BOARD.md §7) — Caveat glyph outlines turned into strokes so `write` is genuinely
 * written rather than typed on.
 *
 * How it works. opentype.js gives us each glyph's outline. We flatten every contour to a dense
 * polyline, order the contours the way a hand moves (top to bottom, left to right within a band),
 * and rotate each contour to start at the point nearest its own top-left. The renderer then draws
 * the filled glyph through a **pen mask**: a fat round-capped stroke travelling that contour, so
 * the letter appears under a moving nib instead of fading in. When the font cannot be loaded the
 * caller falls back to a progressive text reveal — the same pacing, plain type.
 *
 * TeX. We deliberately do not ship a TeX engine. KaTeX would add a dependency and put HTML inside a
 * foreignObject, which cannot be written stroke by stroke and does not survive PNG export — so
 * `tex` is a small offline layouter over the subset a school board actually needs (fractions,
 * powers, indices, roots, Greek, relations, sums and integrals). Symbols Caveat does not carry
 * (π θ α β γ Δ Σ √ ∫ → ∞) are drawn as hand strokes here, in Wobo's own hand. Anything outside the
 * subset degrades to written text rather than failing.
 */

/// <reference path="./opentype.d.ts" />

import type { BoardRect } from './anchors';
import { linePath, polylineLength, type Stroke } from './pen';
import type { BoardPoint } from './schema';

// --- The font ---------------------------------------------------------------------------------------

interface OpenTypeGlyph {
  index: number;
  advanceWidth?: number;
  getPath: (x: number, y: number, size: number) => OpenTypePath;
}
interface OpenTypePath {
  commands: {
    type: 'M' | 'L' | 'C' | 'Q' | 'Z';
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }[];
  toPathData: (decimals?: number) => string;
}
export interface HandFont {
  unitsPerEm: number;
  charToGlyph: (ch: string) => OpenTypeGlyph;
}

/** Where the app serves Caveat from. Overridable so the bench and tests can point elsewhere. */
export const HAND_FONT_URL = '/fonts/Caveat-Regular.ttf';

let cached: HandFont | null = null;
let loading: Promise<HandFont | null> | null = null;

/** Parse a font from bytes. Returns null on anything unexpected — Wobo's hand degrades, never throws. */
export async function parseHandFont(bytes: ArrayBuffer): Promise<HandFont | null> {
  try {
    const mod = (await import('opentype.js')) as unknown as {
      default?: { parse: (b: ArrayBuffer) => HandFont };
      parse?: (b: ArrayBuffer) => HandFont;
    };
    const parse = mod.parse ?? mod.default?.parse;
    if (!parse) return null;
    const font = parse(bytes);
    return font.unitsPerEm > 0 ? font : null;
  } catch {
    return null;
  }
}

/**
 * Load Caveat once per session. A failure is remembered as "no font" so the fallback path is taken
 * immediately rather than re-fetching on every letter.
 */
export function loadHandFont(url: string = HAND_FONT_URL): Promise<HandFont | null> {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const font = await parseHandFont(await res.arrayBuffer());
      cached = font;
      return font;
    } catch {
      return null;
    }
  })();
  return loading;
}

/** The font if it is already in hand — synchronous, for the render loop. */
export function handFont(): HandFont | null {
  return cached;
}

/** Test/bench seam: install a font directly (or clear it to exercise the fallback). */
export function setHandFont(font: HandFont | null): void {
  cached = font;
  loading = null;
}

// --- Glyph outlines to strokes ------------------------------------------------------------------------

/** One written glyph: a filled outline plus the pen's path around it, in writing order. */
export interface HandGlyph {
  /** The glyph outline, filled. Absent for a symbol drawn as bare strokes. */
  fill?: string;
  /** The pen's path(s), in the order a hand makes them. */
  trace: { d: string; length: number }[];
  /** True when `trace` IS the ink (a hand-drawn symbol) rather than a mask over `fill`. */
  drawn?: boolean;
  box: BoardRect;
}

/** A written phrase, laid out and ready to draw. */
export interface HandText {
  glyphs: HandGlyph[];
  width: number;
  height: number;
  /** Type size in board units — the renderer sizes the pen mask from it. */
  size: number;
  /** Total pen travel, so a phrase can be paced to the sentence that carries it. */
  length: number;
}

/** Pen-mask width as a fraction of type size: fat enough to cover a Caveat stroke in one pass. */
export const HAND_MASK_FACTOR = 0.5;

function sampleQuadratic(a: BoardPoint, c: BoardPoint, b: BoardPoint, steps: number): BoardPoint[] {
  const out: BoardPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
    ]);
  }
  return out;
}

function sampleCubic(
  a: BoardPoint,
  c1: BoardPoint,
  c2: BoardPoint,
  b: BoardPoint,
  steps: number,
): BoardPoint[] {
  const out: BoardPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u ** 3 * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * b[0],
      u ** 3 * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * b[1],
    ]);
  }
  return out;
}

/** Flatten an outline into closed contours of dense points. */
export function flattenContours(path: OpenTypePath, size: number): BoardPoint[][] {
  const contours: BoardPoint[][] = [];
  let current: BoardPoint[] = [];
  let start: BoardPoint = [0, 0];
  let pos: BoardPoint = [0, 0];
  const detail = Math.max(size * 0.09, 0.4);
  const steps = (a: BoardPoint, b: BoardPoint): number =>
    Math.max(3, Math.min(24, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / detail)));
  const flush = () => {
    if (current.length > 2) contours.push(current);
    current = [];
  };
  for (const cmd of path.commands) {
    const x = cmd.x ?? 0;
    const y = cmd.y ?? 0;
    switch (cmd.type) {
      case 'M':
        flush();
        start = [x, y];
        pos = start;
        current = [start];
        break;
      case 'L':
        current.push([x, y]);
        pos = [x, y];
        break;
      case 'Q': {
        const c: BoardPoint = [cmd.x1 ?? x, cmd.y1 ?? y];
        for (const p of sampleQuadratic(pos, c, [x, y], steps(pos, [x, y]))) current.push(p);
        pos = [x, y];
        break;
      }
      case 'C': {
        const c1: BoardPoint = [cmd.x1 ?? x, cmd.y1 ?? y];
        const c2: BoardPoint = [cmd.x2 ?? x, cmd.y2 ?? y];
        for (const p of sampleCubic(pos, c1, c2, [x, y], steps(pos, [x, y]))) current.push(p);
        pos = [x, y];
        break;
      }
      case 'Z':
        current.push(start);
        flush();
        pos = start;
        break;
    }
  }
  flush();
  return contours;
}

function bboxOf(points: BoardPoint[]): BoardRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Order the contours of one glyph the way a hand writes: top band first, left to right inside a
 * band. The band is a quarter of the type size, so the crossbar of a `t` and its stem are not
 * separated by a pixel of rounding.
 */
export function orderContours(contours: BoardPoint[][], size: number): BoardPoint[][] {
  const band = Math.max(size * 0.25, 0.001);
  return contours
    .map((points, index) => ({ points, box: bboxOf(points), index }))
    .sort((a, b) => {
      const ba = Math.round(a.box.y / band);
      const bb = Math.round(b.box.y / band);
      if (ba !== bb) return ba - bb;
      if (a.box.x !== b.box.x) return a.box.x - b.box.x;
      return a.index - b.index;
    })
    .map((c) => c.points);
}

/** Rotate a closed contour so the pen starts at the point nearest its own top-left corner. */
export function startNearTopLeft(points: BoardPoint[]): BoardPoint[] {
  if (points.length < 3) return points.slice();
  const first = points[0] as BoardPoint;
  const last = points[points.length - 1] as BoardPoint;
  const closed = first[0] === last[0] && first[1] === last[1];
  const ring = closed ? points.slice(0, -1) : points.slice();
  const box = bboxOf(ring);
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as BoardPoint;
    const d = Math.hypot(p[0] - box.x, p[1] - box.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const rotated = [...ring.slice(best), ...ring.slice(0, best)];
  rotated.push(rotated[0] as BoardPoint);
  return rotated;
}

/** One glyph, written at `origin` (the baseline's left end), in board units. */
export function glyphAt(
  font: HandFont,
  ch: string,
  size: number,
  origin: BoardPoint,
): { glyph: HandGlyph | null; advance: number } {
  const drawn = SYMBOL_GLYPHS[ch];
  if (drawn) return drawn(size, origin);
  const g = font.charToGlyph(ch);
  const advance = ((g?.advanceWidth ?? font.unitsPerEm * 0.5) / font.unitsPerEm) * size;
  if (ch === ' ') return { glyph: null, advance };
  // Caveat has no outline for it and no hand here draws it: fall back to a drawn placeholder so
  // the character is written as SOMETHING. A missing relation in an equation is not a small loss.
  if (!g || g.index === 0) return MISSING_GLYPH(size, origin);
  const path = g.getPath(origin[0], origin[1], size);
  const contours = orderContours(flattenContours(path, size), size);
  const trace = contours.map((c) => {
    const points = startNearTopLeft(c);
    return { d: linePath(points), length: polylineLength(points) };
  });
  const all = contours.flat();
  return {
    glyph: { fill: path.toPathData(2), trace, box: bboxOf(all) },
    advance,
  };
}

// --- Symbols Caveat does not carry, drawn by hand -------------------------------------------------------

type SymbolBuilder = (size: number, origin: BoardPoint) => { glyph: HandGlyph; advance: number };

/**
 * Unit strokes in a hand's own space: x to the right from the baseline's left end, y **up** from
 * the baseline, both in multiples of the type size. 1.0 is roughly a capital's height.
 */
function symbol(width: number, strokes: BoardPoint[][]): SymbolBuilder {
  return (size, origin) => {
    const place = (p: BoardPoint): BoardPoint => [origin[0] + p[0] * size, origin[1] - p[1] * size];
    const trace = strokes.map((s) => {
      const points = s.map(place);
      return { d: linePath(points), length: polylineLength(points) };
    });
    const all = strokes.flat().map(place);
    return {
      glyph: { trace, drawn: true, box: bboxOf(all) },
      advance: width * size,
    };
  };
}

/** Sample an ellipse as a closed unit stroke, starting at the top (where a hand starts an o). */
function ellipseStroke(cx: number, cy: number, rx: number, ry: number, steps = 22): BoardPoint[] {
  const pts: BoardPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

const SYMBOL_GLYPHS: Record<string, SymbolBuilder> = {
  π: symbol(0.78, [
    [
      [0.02, 0.6],
      [0.76, 0.62],
    ],
    [
      [0.24, 0.6],
      [0.19, 0.3],
      [0.18, 0.0],
    ],
    [
      [0.58, 0.6],
      [0.6, 0.24],
      [0.7, 0.04],
      [0.78, 0.1],
    ],
  ]),
  θ: symbol(0.66, [
    ellipseStroke(0.32, 0.32, 0.26, 0.36),
    [
      [0.08, 0.32],
      [0.56, 0.32],
    ],
  ]),
  α: symbol(0.74, [
    [
      [0.66, 0.56],
      [0.4, 0.6],
      [0.14, 0.46],
      [0.08, 0.22],
      [0.2, 0.02],
      [0.42, 0.08],
      [0.54, 0.32],
      [0.6, 0.52],
      [0.66, 0.2],
      [0.74, 0.0],
    ],
  ]),
  β: symbol(0.64, [
    [
      [0.14, -0.32],
      [0.16, 0.4],
      [0.28, 0.74],
      [0.5, 0.72],
      [0.54, 0.5],
      [0.34, 0.38],
      [0.56, 0.3],
      [0.56, 0.08],
      [0.34, 0.02],
      [0.18, 0.14],
    ],
  ]),
  γ: symbol(0.66, [
    [
      [0.04, 0.58],
      [0.24, 0.1],
      [0.34, 0.36],
      [0.44, 0.58],
    ],
    [
      [0.24, 0.1],
      [0.2, -0.2],
      [0.08, -0.3],
    ],
  ]),
  Δ: symbol(0.86, [
    [
      [0.43, 0.94],
      [0.02, 0.0],
      [0.84, 0.0],
      [0.43, 0.94],
    ],
  ]),
  Σ: symbol(0.82, [
    [
      [0.78, 0.9],
      [0.06, 0.92],
      [0.44, 0.48],
      [0.06, 0.02],
      [0.8, 0.04],
    ],
  ]),
  '√': symbol(0.7, [
    [
      [0.02, 0.4],
      [0.16, 0.32],
      [0.34, -0.04],
      [0.52, 0.92],
      [0.7, 0.92],
    ],
  ]),
  '∫': symbol(0.44, [
    [
      [0.32, 0.98],
      [0.22, 0.94],
      [0.2, 0.5],
      [0.18, 0.04],
      [0.08, -0.24],
      [0.0, -0.2],
    ],
  ]),
  '→': symbol(1.0, [
    [
      [0.02, 0.34],
      [0.92, 0.34],
    ],
    [
      [0.7, 0.52],
      [0.94, 0.34],
      [0.7, 0.16],
    ],
  ]),
  '∞': symbol(1.0, [
    [
      [0.48, 0.32],
      [0.3, 0.52],
      [0.08, 0.4],
      [0.14, 0.16],
      [0.36, 0.16],
      [0.62, 0.5],
      [0.86, 0.5],
      [0.94, 0.28],
      [0.76, 0.14],
      [0.5, 0.3],
    ],
  ]),
  // The relations, the operators and the units a school board actually writes. Caveat carries none
  // of them, and a glyph Caveat does not carry used to render as NOTHING — an equation quietly
  // missing its own relation, which is worse than a refusal because it still looks like an answer.
  Ω: symbol(0.9, [
    [
      [0.04, 0.02],
      [0.26, 0.04],
      [0.16, 0.24],
      [0.08, 0.52],
      [0.22, 0.8],
      [0.46, 0.88],
      [0.7, 0.8],
      [0.82, 0.52],
      [0.74, 0.24],
      [0.64, 0.04],
      [0.86, 0.02],
    ],
  ]),
  '×': symbol(0.66, [
    [
      [0.08, 0.6],
      [0.58, 0.12],
    ],
    [
      [0.58, 0.6],
      [0.08, 0.12],
    ],
  ]),
  '÷': symbol(0.72, [
    [
      [0.06, 0.34],
      [0.66, 0.34],
    ],
    ellipseStroke(0.36, 0.56, 0.055, 0.055, 10),
    ellipseStroke(0.36, 0.12, 0.055, 0.055, 10),
  ]),
  '·': symbol(0.32, [ellipseStroke(0.16, 0.3, 0.055, 0.055, 10)]),
  '±': symbol(0.7, [
    [
      [0.34, 0.72],
      [0.34, 0.26],
    ],
    [
      [0.08, 0.49],
      [0.6, 0.49],
    ],
    [
      [0.06, 0.06],
      [0.62, 0.06],
    ],
  ]),
  '≤': symbol(0.76, [
    [
      [0.64, 0.72],
      [0.08, 0.42],
      [0.64, 0.12],
    ],
    [
      [0.08, 0.02],
      [0.66, 0.02],
    ],
  ]),
  '≥': symbol(0.76, [
    [
      [0.1, 0.72],
      [0.66, 0.42],
      [0.1, 0.12],
    ],
    [
      [0.08, 0.02],
      [0.66, 0.02],
    ],
  ]),
  '≠': symbol(0.74, [
    [
      [0.06, 0.46],
      [0.66, 0.46],
    ],
    [
      [0.06, 0.22],
      [0.66, 0.22],
    ],
    [
      [0.52, 0.66],
      [0.2, 0.02],
    ],
  ]),
  '≈': symbol(0.7, [
    [
      [0.06, 0.5],
      [0.2, 0.6],
      [0.36, 0.4],
      [0.52, 0.5],
    ],
    [
      [0.06, 0.24],
      [0.2, 0.34],
      [0.36, 0.14],
      [0.52, 0.24],
    ],
  ]),
  '°': symbol(0.4, [ellipseStroke(0.2, 0.74, 0.13, 0.13, 14)]),
};

/**
 * Every symbol Wobo draws by hand rather than reading out of Caveat — the vocabulary the domain
 * pipelines and the TeX subset can put on a board. A test walks this list, so a symbol added to
 * `TEX_SYMBOLS` without a hand to draw it fails there rather than on a learner's board.
 */
export const HAND_SYMBOLS: string[] = Object.keys(SYMBOL_GLYPHS);

/**
 * The last resort: a character Caveat has no glyph for and this file has no hand for.
 *
 * BOARD.md §11 — ink that never lands is a board that lies. Rather than drop such a character
 * silently, the pen draws a small hollow box in its place at x-height: visibly a symbol Wobo could
 * not write, which is honest, and which the vocabulary test above exists to keep rare.
 */
const MISSING_GLYPH: SymbolBuilder = symbol(0.6, [
  [
    [0.08, 0.06],
    [0.5, 0.06],
    [0.5, 0.6],
    [0.08, 0.6],
    [0.08, 0.06],
  ],
]);

/** True when this character is one Wobo draws by hand rather than one Caveat carries. */
export function isDrawnSymbol(ch: string): boolean {
  return ch in SYMBOL_GLYPHS;
}

// --- Writing a phrase ------------------------------------------------------------------------------------

export interface WriteOptions {
  size: number;
  maxWidth?: number;
  lineHeight?: number;
}

function advanceOf(font: HandFont, ch: string, size: number): number {
  const drawn = SYMBOL_GLYPHS[ch];
  if (drawn) return drawn(size, [0, 0]).advance;
  const g = font.charToGlyph(ch);
  if (ch !== ' ' && (!g || g.index === 0)) return MISSING_GLYPH(size, [0, 0]).advance;
  return ((g?.advanceWidth ?? font.unitsPerEm * 0.5) / font.unitsPerEm) * size;
}

/** Measure a phrase without building any geometry — used by the layout engine for label margins. */
export function measureText(font: HandFont, text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += advanceOf(font, ch, size);
  return w;
}

/**
 * THE TALLEST GLYPH IN A PHRASE, AS A FRACTION OF THE TYPE SIZE (wave 58, finding 2).
 *
 * The twelve-pixel law is stated of the tallest glyph a mark actually writes, and that is not a
 * fixed fraction of the size: 'recessive' has no ascender and no cap, 'greatest height' has both,
 * and in Caveat they differ by about a third. A placement solver choosing between legible sizes
 * has to know which is which, and it has to know without laying the glyphs — so the ratio is
 * measured off the font's own outlines and cached per character.
 *
 * A phrase with nothing measurable in it (all spaces) reports zero, and the caller keeps whatever
 * size it asked for.
 */
const HEIGHT_RATIOS = new WeakMap<HandFont, Map<string, number>>();

export function tallestGlyphRatio(font: HandFont, text: string): number {
  let byChar = HEIGHT_RATIOS.get(font);
  if (!byChar) {
    byChar = new Map();
    HEIGHT_RATIOS.set(font, byChar);
  }
  let tall = 0;
  for (const ch of text) {
    if (ch === ' ' || ch === '\n') continue;
    let ratio = byChar.get(ch);
    if (ratio === undefined) {
      // Measured at a large size and divided out: one lay per character, for the life of the font.
      const { glyph } = glyphAt(font, ch, 100, [0, 0]);
      ratio = glyph ? glyph.box.h / 100 : 0;
      byChar.set(ch, ratio);
    }
    if (ratio > tall) tall = ratio;
  }
  return tall;
}

/** Break a phrase into lines that fit `maxWidth`, never splitting a word that fits on its own. */
export function wrapText(
  font: HandFont,
  text: string,
  size: number,
  maxWidth: number | undefined,
): string[] {
  if (!maxWidth || maxWidth <= 0) return text.split('\n');
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measureText(font, candidate, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [''];
}

/**
 * Lay out a phrase as written glyphs. `origin` is the top-left of the text block; the first
 * baseline sits one ascent below it, so a written note lines up with the box it was placed in.
 */
export function writeText(
  font: HandFont,
  text: string,
  origin: BoardPoint,
  opts: WriteOptions,
): HandText {
  const size = opts.size;
  const lineHeight = opts.lineHeight ?? size * 1.22;
  const lines = wrapText(font, text, size, opts.maxWidth);
  const glyphs: HandGlyph[] = [];
  let widest = 0;
  let length = 0;
  lines.forEach((line, row) => {
    let x = origin[0];
    const baseline = origin[1] + size * 0.78 + row * lineHeight;
    for (const ch of line) {
      const { glyph, advance } = glyphAt(font, ch, size, [x, baseline]);
      if (glyph) {
        glyphs.push(glyph);
        for (const t of glyph.trace) length += t.length;
      }
      x += advance;
    }
    widest = Math.max(widest, x - origin[0]);
  });
  return { glyphs, width: widest, height: lines.length * lineHeight, size, length };
}

// --- TeX, the school subset ---------------------------------------------------------------------------------

type TexNode =
  | { kind: 'char'; ch: string }
  | { kind: 'row'; nodes: TexNode[] }
  | { kind: 'frac'; num: TexNode; den: TexNode }
  | { kind: 'sqrt'; body: TexNode; index?: TexNode }
  | { kind: 'matrix'; rows: TexNode[][]; fence: Fence }
  | { kind: 'script'; base: TexNode; sup?: TexNode; sub?: TexNode };

/** What a matrix environment is written inside. `none` is a bare array of rows. */
type Fence = 'paren' | 'bracket' | 'brace' | 'bar' | 'double-bar' | 'none';

/**
 * The `\begin{...}` environments a school board actually writes. Anything else still draws as rows
 * — never as the word: a learner must never see "pmatrix" written on their board (BOARD.md §11).
 */
const MATRIX_FENCES: Record<string, Fence> = {
  matrix: 'none',
  pmatrix: 'paren',
  bmatrix: 'bracket',
  Bmatrix: 'brace',
  vmatrix: 'bar',
  Vmatrix: 'double-bar',
  cases: 'brace',
  array: 'none',
  aligned: 'none',
  align: 'none',
};

const TEX_SYMBOLS: Record<string, string> = {
  pi: 'π',
  theta: 'θ',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  Delta: 'Δ',
  Omega: 'Ω',
  ohm: 'Ω',
  Sigma: 'Σ',
  sum: 'Σ',
  int: '∫',
  infty: '∞',
  to: '→',
  rightarrow: '→',
  times: '×',
  div: '÷',
  cdot: '·',
  pm: '±',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  degree: '°',
  quad: '  ',
  ',': ' ',
};
const TEX_WORDS = new Set([
  'sin',
  'cos',
  'tan',
  'log',
  'ln',
  'max',
  'min',
  'lim',
  'text',
  'mathrm',
]);

interface Cursor {
  s: string;
  i: number;
}

function parseGroup(c: Cursor, stopAtBrace: boolean): TexNode {
  const nodes: TexNode[] = [];
  while (c.i < c.s.length) {
    const ch = c.s[c.i] as string;
    if (ch === '}' && stopAtBrace) {
      c.i++;
      break;
    }
    if (ch === '{') {
      c.i++;
      nodes.push(parseGroup(c, true));
      continue;
    }
    if (ch === '\\') {
      c.i++;
      let name = '';
      while (c.i < c.s.length && /[a-zA-Z]/.test(c.s[c.i] as string)) name += c.s[c.i++];
      if (name === '') {
        // An escaped punctuation such as `\,` — a thin space.
        const punct = c.s[c.i++] ?? '';
        const mapped = TEX_SYMBOLS[punct];
        if (mapped) for (const m of mapped) nodes.push({ kind: 'char', ch: m });
        continue;
      }
      if (name === 'frac') {
        const num = parseArg(c);
        const den = parseArg(c);
        nodes.push({ kind: 'frac', num, den });
        continue;
      }
      if (name === 'sqrt') {
        // `\sqrt[3]{x}` — the index is part of the radical, never characters beside it. Without
        // this the brackets and the 3 leaked into the line as ordinary text.
        const index = parseOptional(c);
        const body = parseArg(c);
        nodes.push(index ? { kind: 'sqrt', body, index } : { kind: 'sqrt', body });
        continue;
      }
      if (name === 'begin') {
        const env = readBraceWord(c);
        const matrix = matrixNode(env, takeUntilEnd(c, env));
        if (matrix) nodes.push(matrix);
        continue;
      }
      if (name === 'end') {
        // A stray `\end` with no opening: swallow its argument. Writing the environment's name on
        // a learner's board is the one thing that must never happen (BOARD.md §11).
        readBraceWord(c);
        continue;
      }
      if (TEX_WORDS.has(name)) {
        if (name === 'text' || name === 'mathrm') {
          nodes.push(parseArg(c));
        } else {
          for (const m of name) nodes.push({ kind: 'char', ch: m });
        }
        continue;
      }
      const mapped = TEX_SYMBOLS[name];
      if (mapped) for (const m of mapped) nodes.push({ kind: 'char', ch: m });
      continue;
    }
    if (ch === '^' || ch === '_') {
      c.i++;
      const arg = parseArg(c);
      const base = nodes.pop() ?? { kind: 'row', nodes: [] as TexNode[] };
      const prev =
        base.kind === 'script'
          ? base
          : ({ kind: 'script', base } as Extract<TexNode, { kind: 'script' }>);
      if (ch === '^') prev.sup = arg;
      else prev.sub = arg;
      nodes.push(prev);
      continue;
    }
    c.i++;
    if (ch === ' ') {
      nodes.push({ kind: 'char', ch: ' ' });
      continue;
    }
    nodes.push({ kind: 'char', ch });
  }
  return { kind: 'row', nodes };
}

function parseArg(c: Cursor): TexNode {
  while (c.s[c.i] === ' ') c.i++;
  if (c.s[c.i] === '{') {
    c.i++;
    return parseGroup(c, true);
  }
  if (c.s[c.i] === '\\') {
    const save = c.i;
    c.i++;
    let name = '';
    while (c.i < c.s.length && /[a-zA-Z]/.test(c.s[c.i] as string)) name += c.s[c.i++];
    const mapped = TEX_SYMBOLS[name];
    if (mapped) return { kind: 'row', nodes: [...mapped].map((m) => ({ kind: 'char', ch: m })) };
    c.i = save + 1 + name.length;
    return { kind: 'row', nodes: [] };
  }
  const ch = c.s[c.i];
  if (ch === undefined) return { kind: 'row', nodes: [] };
  c.i++;
  return { kind: 'char', ch };
}

/** An optional `[...]` argument (the root's index). Null when there is none. */
function parseOptional(c: Cursor): TexNode | null {
  if (c.s[c.i] !== '[') return null;
  const close = c.s.indexOf(']', c.i);
  if (close < 0) return null;
  const inner = c.s.slice(c.i + 1, close);
  c.i = close + 1;
  return parseTex(inner);
}

/** Read `{word}` at the cursor — the environment name after `\begin`. Empty when it is not there. */
function readBraceWord(c: Cursor): string {
  while (c.s[c.i] === ' ') c.i++;
  if (c.s[c.i] !== '{') return '';
  const close = c.s.indexOf('}', c.i);
  if (close < 0) {
    c.i = c.s.length;
    return '';
  }
  const word = c.s.slice(c.i + 1, close).trim();
  c.i = close + 1;
  return word;
}

/** Everything up to the matching `\end`, which is consumed with it. Nested environments count. */
function takeUntilEnd(c: Cursor, _env: string): string {
  const start = c.i;
  let depth = 1;
  let i = c.i;
  while (i < c.s.length) {
    if (c.s.startsWith('\\begin', i)) {
      depth += 1;
      i += 6;
      continue;
    }
    if (c.s.startsWith('\\end', i)) {
      depth -= 1;
      if (depth === 0) {
        const body = c.s.slice(start, i);
        c.i = i + 4;
        readBraceWord(c);
        return body;
      }
      i += 4;
      continue;
    }
    i += 1;
  }
  c.i = c.s.length;
  return c.s.slice(start);
}

/** Split an environment body into rows on `\\` and cells on `&`, at brace depth zero. */
function splitCells(body: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && ch === '&') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (depth === 0 && ch === '\\' && body[i + 1] === '\\') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((text) => text.trim() !== ''));
}

/** One `\begin{...} … \end{...}` as a matrix. Null when there is nothing in it to draw. */
function matrixNode(env: string, body: string): TexNode | null {
  const cells = splitCells(body);
  if (cells.length === 0) return null;
  return {
    kind: 'matrix',
    rows: cells.map((row) => row.map((text) => parseTex(text))),
    // An environment we do not know still draws as rows, with no fence — never as its own name.
    fence: MATRIX_FENCES[env] ?? 'none',
  };
}

/** Parse the TeX subset. Anything unrecognised is simply dropped, never thrown. */
export function parseTex(tex: string): TexNode {
  return parseGroup({ s: tex, i: 0 }, false);
}

interface TexBox {
  width: number;
  /** Height above the baseline. */
  ascent: number;
  /** Depth below the baseline. */
  descent: number;
  /** Draw this box with its baseline's left end at (x, y). */
  draw: (x: number, y: number, out: TexOutput) => void;
}

interface TexOutput {
  glyphs: HandGlyph[];
  rules: Stroke[];
}

const SCRIPT_SCALE = 0.68;

/** A ruled stroke through these points — the same rule a fraction bar is drawn with. */
function rule(points: BoardPoint[]): Stroke {
  return { d: linePath(points), length: polylineLength(points) };
}

/**
 * The brackets a matrix is written inside, drawn as real strokes (BOARD.md §7): round for
 * `pmatrix`, square for `bmatrix`, curly for `Bmatrix` and `cases`, and rules for a determinant.
 * `x` is the left edge of this fence's own column, `w` its width.
 */
function fenceStrokes(
  fence: Fence,
  side: 'left' | 'right',
  x: number,
  top: number,
  height: number,
  w: number,
): Stroke[] {
  const bottom = top + height;
  const mid = top + height / 2;
  // For the right-hand fence every horizontal offset is mirrored inside its own column.
  const at = (fraction: number): number => x + (side === 'left' ? fraction : 1 - fraction) * w;
  switch (fence) {
    case 'bracket':
      return [
        rule([
          [at(0.95), top],
          [at(0.25), top],
          [at(0.25), bottom],
          [at(0.95), bottom],
        ]),
      ];
    case 'bar':
      return [
        rule([
          [at(0.5), top],
          [at(0.5), bottom],
        ]),
      ];
    case 'double-bar':
      return [
        rule([
          [at(0.3), top],
          [at(0.3), bottom],
        ]),
        rule([
          [at(0.7), top],
          [at(0.7), bottom],
        ]),
      ];
    case 'brace':
      return [
        rule([
          [at(0.95), top],
          [at(0.5), top + height * 0.14],
          [at(0.5), mid - height * 0.06],
          [at(0.06), mid],
          [at(0.5), mid + height * 0.06],
          [at(0.5), bottom - height * 0.14],
          [at(0.95), bottom],
        ]),
      ];
    default: {
      // A round bracket: sampled so it bows out at the middle the way a hand draws one.
      const points: BoardPoint[] = [];
      const steps = 14;
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        points.push([at(0.9 - 0.75 * Math.sin(Math.PI * t)), top + t * height]);
      }
      return [rule(points)];
    }
  }
}

function measureNode(font: HandFont, node: TexNode, size: number): TexBox {
  switch (node.kind) {
    case 'char': {
      const advance = advanceOf(font, node.ch, size);
      return {
        width: advance,
        ascent: size * 0.74,
        descent: size * 0.2,
        draw: (x, y, out) => {
          const { glyph } = glyphAt(font, node.ch, size, [x, y]);
          if (glyph) out.glyphs.push(glyph);
        },
      };
    }
    case 'row': {
      const boxes = node.nodes.map((n) => measureNode(font, n, size));
      const width = boxes.reduce((s, b) => s + b.width, 0);
      const ascent = boxes.reduce((m, b) => Math.max(m, b.ascent), size * 0.74);
      const descent = boxes.reduce((m, b) => Math.max(m, b.descent), size * 0.2);
      return {
        width,
        ascent,
        descent,
        draw: (x, y, out) => {
          let cx = x;
          for (const b of boxes) {
            b.draw(cx, y, out);
            cx += b.width;
          }
        },
      };
    }
    case 'frac': {
      const num = measureNode(font, node.num, size * 0.92);
      const den = measureNode(font, node.den, size * 0.92);
      const pad = size * 0.18;
      const width = Math.max(num.width, den.width) + pad * 2;
      const axis = size * 0.3;
      const gap = size * 0.16;
      const ascent = axis + gap + num.ascent + num.descent;
      const descent = -axis + gap + den.ascent + den.descent;
      return {
        width,
        ascent,
        descent,
        draw: (x, y, out) => {
          const barY = y - axis;
          const left = x + pad * 0.4;
          const right = x + width - pad * 0.4;
          const bar: BoardPoint[] = [
            [left, barY],
            [right, barY],
          ];
          out.rules.push({ d: linePath(bar), length: polylineLength(bar) });
          num.draw(x + (width - num.width) / 2, barY - gap - num.descent, out);
          den.draw(x + (width - den.width) / 2, barY + gap + den.ascent, out);
        },
      };
    }
    case 'sqrt': {
      const body = measureNode(font, node.body, size);
      const radical = size * 0.62;
      // A cube root wears its index in the crook of the radical, small — never as a `[3]` in the line.
      const index = node.index ? measureNode(font, node.index, size * 0.5) : null;
      const lead = index ? Math.max(0, index.width - radical * 0.35) : 0;
      const width = lead + radical + body.width + size * 0.14;
      return {
        width,
        ascent: Math.max(body.ascent + size * 0.22, index ? body.ascent + index.ascent * 0.6 : 0),
        descent: body.descent,
        draw: (x, y, out) => {
          const stem = x + lead;
          const { glyph } = glyphAt(font, '√', size, [stem, y]);
          if (glyph) out.glyphs.push(glyph);
          const top = y - body.ascent - size * 0.18;
          const bar: BoardPoint[] = [
            [stem + radical * 0.98, top],
            [x + width, top],
          ];
          out.rules.push({ d: linePath(bar), length: polylineLength(bar) });
          if (index) index.draw(x, y - body.ascent * 0.62, out);
          body.draw(stem + radical + size * 0.06, y, out);
        },
      };
    }
    case 'matrix': {
      const gap = size * 0.55;
      const lead = size * 0.34;
      const boxes = node.rows.map((row) => row.map((cell) => measureNode(font, cell, size)));
      const columns = Math.max(...boxes.map((row) => row.length), 1);
      const widths: number[] = [];
      for (let col = 0; col < columns; col += 1) {
        widths.push(Math.max(...boxes.map((row) => row[col]?.width ?? 0), 0));
      }
      const rowAscent = boxes.map((row) => Math.max(...row.map((b) => b.ascent), size * 0.74));
      const rowDescent = boxes.map((row) => Math.max(...row.map((b) => b.descent), size * 0.2));
      const rowGap = size * 0.42;
      const inner = rowAscent.reduce((sum, a, i) => sum + a + (rowDescent[i] ?? 0), 0);
      const height = inner + rowGap * Math.max(0, boxes.length - 1);
      const fenceW = node.fence === 'none' ? 0 : size * 0.42;
      const width =
        fenceW * 2 +
        lead * 2 +
        widths.reduce((sum, w) => sum + w, 0) +
        gap * Math.max(0, columns - 1);
      // The block sits on the maths axis, so `Ax = b` lines up either side of the matrix.
      const axis = size * 0.3;
      return {
        width,
        ascent: height / 2 + axis,
        descent: height / 2 - axis,
        draw: (x, y, out) => {
          const top = y - (height / 2 + axis);
          let cy = top;
          boxes.forEach((row, r) => {
            const baseline = cy + (rowAscent[r] ?? 0);
            let cx = x + fenceW + lead;
            row.forEach((cell, col) => {
              const column = widths[col] ?? 0;
              cell.draw(cx + (column - cell.width) / 2, baseline, out);
              cx += column + gap;
            });
            cy = baseline + (rowDescent[r] ?? 0) + rowGap;
          });
          if (node.fence === 'none') return;
          out.rules.push(...fenceStrokes(node.fence, 'left', x, top, height, fenceW));
          out.rules.push(
            ...fenceStrokes(node.fence, 'right', x + width - fenceW, top, height, fenceW),
          );
        },
      };
    }
    default: {
      const base = measureNode(font, node.base, size);
      const small = size * SCRIPT_SCALE;
      const sup = node.sup ? measureNode(font, node.sup, small) : null;
      const sub = node.sub ? measureNode(font, node.sub, small) : null;
      const scriptWidth = Math.max(sup?.width ?? 0, sub?.width ?? 0);
      const rise = size * 0.44;
      const drop = size * 0.22;
      return {
        width: base.width + scriptWidth + (scriptWidth > 0 ? size * 0.06 : 0),
        ascent: Math.max(base.ascent, sup ? rise + sup.ascent : 0),
        descent: Math.max(base.descent, sub ? drop + sub.descent : 0),
        draw: (x, y, out) => {
          base.draw(x, y, out);
          const sx = x + base.width + size * 0.04;
          if (sup) sup.draw(sx, y - rise, out);
          if (sub) sub.draw(sx, y + drop, out);
        },
      };
    }
  }
}

export interface TexLayout {
  glyphs: HandGlyph[];
  /** Fraction bars and radical overbars — ruled, not wobbled. */
  rules: Stroke[];
  width: number;
  height: number;
  size: number;
  length: number;
}

/**
 * Lay out an equation as written glyphs and ruled bars. `origin` is the top-left of the block, the
 * same convention as `writeText`, so `tex` and `write` sit together in a derivation.
 */
export function layoutTex(
  font: HandFont,
  tex: string,
  origin: BoardPoint,
  size: number,
): TexLayout {
  const box = measureNode(font, parseTex(tex), size);
  const out: TexOutput = { glyphs: [], rules: [] };
  box.draw(origin[0], origin[1] + box.ascent, out);
  let length = 0;
  for (const g of out.glyphs) for (const t of g.trace) length += t.length;
  for (const r of out.rules) length += r.length;
  return {
    glyphs: out.glyphs,
    rules: out.rules,
    width: box.width,
    height: box.ascent + box.descent,
    size,
    length,
  };
}

// --- Powers and indices in a plain written line ---------------------------------------------------

/**
 * A written line may carry TeX's own shorthand for a power or an index — `a^2`, `x_1`, and whole
 * equations like `a^2 + b^2 = c^2`. Wobo writes those as a mathematician does: the 2 raised and
 * small, the 1 dropped and small. A board that writes the caret instead has written the SOURCE of
 * the maths rather than the maths, which is the "slideshow, not a teacher" of BOARD.md §11.
 */
const SCRIPT_MARKS = /[\^_]/;

/** True when this line has a power or an index in it and belongs in the script layout. */
export function hasScripts(text: string): boolean {
  return SCRIPT_MARKS.test(text);
}

const SUPERSCRIPTS: Record<string, string> = {
  '0': '\u2070',
  '1': '\u00B9',
  '2': '\u00B2',
  '3': '\u00B3',
  '4': '\u2074',
  '5': '\u2075',
  '6': '\u2076',
  '7': '\u2077',
  '8': '\u2078',
  '9': '\u2079',
  '+': '\u207A',
  '-': '\u207B',
  '=': '\u207C',
  '(': '\u207D',
  ')': '\u207E',
  n: '\u207F',
  i: '\u2071',
};

const SUBSCRIPTS: Record<string, string> = {
  '0': '\u2080',
  '1': '\u2081',
  '2': '\u2082',
  '3': '\u2083',
  '4': '\u2084',
  '5': '\u2085',
  '6': '\u2086',
  '7': '\u2087',
  '8': '\u2088',
  '9': '\u2089',
  '+': '\u208A',
  '-': '\u208B',
  '=': '\u208C',
  '(': '\u208D',
  ')': '\u208E',
  a: '\u2090',
  e: '\u2091',
  i: '\u1D62',
  j: '\u2C7C',
  o: '\u2092',
  x: '\u2093',
  n: '\u2099',
  m: '\u2098',
  t: '\u209C',
  r: '\u1D63',
};

const SCRIPT_GROUP = /([\^_])(?:\{([^}]*)\}|(\S))/g;

/**
 * The same line with its powers and indices as real characters — `a^2` becomes `a\u00B2`,
 * `x_1` becomes `x\u2081`. This is the NO-FONT path: when Caveat never arrived the renderer reveals
 * plain type, and plain type must still read as maths. A group with any character that has no
 * raised or dropped form is left exactly as it was written rather than half-converted.
 */
export function scriptText(text: string): string {
  return text.replace(SCRIPT_GROUP, (whole, mark: string, braced?: string, bare?: string) => {
    const body = braced ?? bare ?? '';
    const table = mark === '^' ? SUPERSCRIPTS : SUBSCRIPTS;
    let out = '';
    for (const ch of body) {
      const mapped = table[ch];
      if (mapped === undefined) return whole;
      out += mapped;
    }
    return out || whole;
  });
}

/**
 * An equation as the plain line it degrades to when there is no font: `\\frac`\u2019s braces gone, every
 * `\\name` replaced by the symbol it means, powers and indices raised and dropped. This is what the
 * header of a golden board shows when Caveat has not loaded, and it must never show carets.
 */
export function texPlainText(tex: string): string {
  const flattened = tex
    // An environment is structure, not a word. Left alone, `\\begin` was dropped as unknown while
    // `{pmatrix}` survived as characters — so the fallback line wrote "pmatrix" on the board.
    .replace(/\\(?:begin|end)\s*\{[^}]*\}/g, ' ')
    .replace(/\\\\/g, '; ') // a row break reads as a pause
    .replace(/&/g, ' ') // a cell break is a space
    .replace(/\\sqrt\s*\[([^\]]*)\]/g, '$1\u221A')
    .replace(/\\sqrt/g, '\u221A');
  const named = flattened.replace(/\\([a-zA-Z]+)/g, (_whole, name: string) => {
    const mapped = TEX_SYMBOLS[name];
    if (mapped !== undefined) return mapped;
    return TEX_WORDS.has(name) ? name : '';
  });
  return scriptText(named.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim());
}

/**
 * A written line laid out with its powers and indices raised and dropped, in Wobo's own hand. The TeX
 * subset is already the machinery for that, and `write` text is a legal member of it: plain
 * characters pass straight through, `^` and `_` become real scripts.
 */
export function writeScripted(
  font: HandFont,
  text: string,
  origin: BoardPoint,
  size: number,
): HandText & { rules: Stroke[] } {
  const laid = layoutTex(font, text, origin, size);
  return {
    glyphs: laid.glyphs,
    rules: laid.rules,
    width: laid.width,
    height: laid.height,
    size,
    length: laid.length,
  };
}

/**
 * The fallback when the font never arrives: the phrase, its lines, and how the renderer should
 * reveal it — progressively, left to right, at the same pace the pen would have written it.
 */
export function fallbackLines(text: string, maxChars = 32): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && candidate.length > maxChars) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [''];
}
