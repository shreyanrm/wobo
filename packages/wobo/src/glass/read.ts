/**
 * The glass reader: the DOM half of the glass map (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze).
 *
 * We render the page, so we read it, never photograph it. A TreeWalker visits every text node in
 * the viewport; each node's client rects are split at its line boxes and the words assigned to
 * their lines, so a line entry is the words actually on that line with the box actually around
 * them. Every meaningful element is read beside the lines: a labelled one (`data-glass`, from the
 * content model), a registry target (the photo's lines, a video frame's parts, anything a screen
 * still registers) or a plain one the markup makes obvious (a button, an input, a table cell, a
 * figure, a heading, a list step). Figures give up their parts: an SVG element with an id, a
 * `data-glass-part`, or a `<text>` naming what it sits on.
 *
 * The read keeps a handle per entry, so the same id is re-measured on a resize or a theme flip
 * without walking again, and a plan's "the exact words" can be found inside a line as a range.
 */

import {
  assignGlassIds,
  type ChooseOptions,
  chooseGlass,
  type GlassBox,
  type GlassCandidate,
  type GlassMap,
  type GlassRole,
  type GlassViewport,
  normaliseGlassText,
  questionWords,
} from './map';

// --- What a reader is told -----------------------------------------------------------------------

/** A thing the screen registered by hand, read beside the DOM so its id and rect are kept. */
export interface GlassRegistered {
  id: string;
  kind: string;
  label: string;
  text?: string;
  meaning?: string;
  rect: () => { x: number; y: number; width: number; height: number } | null;
  element?: () => Element | null;
}

export interface ReadGlassOptions extends ChooseOptions {
  /** Where to read. `document.body` by default. */
  root?: Element | null;
  /** Selectors for subtrees that are Wobo's own, never the learner's page. */
  ignore?: readonly string[];
  /** Selectors for things that sit over the page: what they cover is not on the glass. */
  occluders?: readonly string[];
  registered?: readonly GlassRegistered[];
  /** Selectors for app furniture a question is rarely about (a header, Wobo's own controls). */
  chrome?: readonly string[];
  route?: string;
  theme?: 'light' | 'dark';
  reduced?: boolean;
  viewport?: { w: number; h: number };
  /**
   * The freeze may scroll the thing the question names onto the glass before it reads (the law's
   * Freeze: the glass is held STILL, not held wrong). True by default when there is a question;
   * false on the second pass, so a read scrolls at most once.
   */
  scroll?: boolean;
}

/**
 * WOBO'S OWN SURFACES ARE NEVER ON THE GLASS, and by construction rather than by a word list.
 *
 * Wobo marks the ROOT of every surface Wobo owns — the companion sheet with its transcript, the
 * chat panel, the ask input, the docked orb, the plane and the full board, the ink, the gesture
 * layer, Wobo's own chips and toasts — with `data-wobo-surface`, and the reader skips that whole
 * subtree. No aria-label is matched, no copy is spelled out here, so a renamed button or a new
 * panel cannot leak back onto the map. A live region is spoken and never shown, so it is skipped
 * too: the lasso's announcement is a 1 px element whose text range still reports a 411x23 box, and
 * wave 39 ringed it in the corner of the page.
 *
 * The adversary's lab, 2026-09-08: the map carried the learner's own bubbles, and 15 of 23 course
 * turns and 14 of 18 world turns rang Wobo's own transcript back at the learner.
 */
export const WOBO_OWN: readonly string[] = [
  '[data-wobo-surface]',
  // The older spelling of the same mark, kept so a surface that carries it is still Wobo's own.
  '[data-glass-ignore]',
  '[data-wobo-inspect]',
  '.wobo-board',
  '[aria-live]',
];

/** Wobo's own layers, plus what a browser never renders. */
export const DEFAULT_IGNORE: readonly string[] = [
  ...WOBO_OWN,
  'script',
  'style',
  'noscript',
  'template',
];

export const DEFAULT_OCCLUDERS: readonly string[] = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[data-glass-occludes]',
];

// --- Handles: how an entry is measured again ---------------------------------------------------

type Handle =
  | { kind: 'range'; pieces: { node: Text; start: number; end: number }[] }
  | { kind: 'element'; element: Element }
  /** Two elements measured as one box: a figure part is its shape AND the label that names it. */
  | { kind: 'union'; elements: readonly Element[] }
  | { kind: 'registered'; rect: GlassRegistered['rect'] };

export type GlassHandle = Handle;

/**
 * THE HANDLE A FIGURE PART IS RE-MEASURED BY (the adversary, wave 47, finding 5).
 *
 * A `<text>` inside a figure names the shape it sits on, and the map advertises the part as the
 * UNION of the two — that is the thing the learner points at when they say "the effect". The
 * handle used to be the `<text>` node alone, so `rectOf` came back with the words' box and the
 * instant ring landed INSIDE the circle, 7 to 9 px in on every side. Both elements are kept, and
 * both are read again every time, so the ring still travels with a scroll.
 */
export function figurePartHandle(label: Element, host: Element | null): GlassHandle {
  return { kind: 'union', elements: host ? [host, label] : [label] };
}

export interface GlassRead {
  map: GlassMap;
  /** True when the freeze scrolled the thing the question named onto the glass before reading. */
  scrolled: boolean;
  /** Re-measure the chosen ids in place; an entry whose thing is gone is dropped. */
  remeasure(): GlassMap;
  /** The live box of one entry, or null once it has left the glass. */
  rectOf(id: string): GlassBox | null;
  /** The box of exact words inside an entry (a line, a step, a card), or null when not there. */
  find(id: string, words: string): GlassBox | null;
  /** The element an entry belongs to, where there is one. */
  elementOf(id: string): Element | null;
}

// --- Small geometry ------------------------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function union(a: Box | null, b: Box): Box {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function toBox(r: { x: number; y: number; width: number; height: number }): Box {
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

function tuple(b: Box): GlassBox {
  return [b.x, b.y, b.w, b.h];
}

function visibleShare(b: Box, vp: { w: number; h: number }): number {
  if (b.w <= 0 || b.h <= 0) return 0;
  const ix = Math.max(0, Math.min(b.x + b.w, vp.w) - Math.max(b.x, 0));
  const iy = Math.max(0, Math.min(b.y + b.h, vp.h) - Math.max(b.y, 0));
  return (ix * iy) / (b.w * b.h);
}

function finite(b: Box): boolean {
  return [b.x, b.y, b.w, b.h].every((n) => Number.isFinite(n));
}

// --- Roles from markup ----------------------------------------------------------------------------

const ROLES: ReadonlySet<string> = new Set([
  'line',
  'heading',
  'card',
  'step',
  'figure',
  'figure-part',
  'chip',
  'input',
  'cell',
  'photo-line',
  'target',
]);

function declaredRole(el: Element): GlassRole | null {
  const role = el.getAttribute('data-glass');
  return role && ROLES.has(role) ? (role as GlassRole) : null;
}

/** The role the markup makes obvious, when nothing labelled it. */
function impliedRole(el: Element): GlassRole | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input';
  if (el.getAttribute('contenteditable') === 'true') return 'input';
  if (tag === 'button' || el.getAttribute('role') === 'button') return 'chip';
  if (tag === 'a' && el.hasAttribute('href')) return 'chip';
  if (tag === 'td' || tag === 'th') return 'cell';
  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') return 'heading';
  if (tag === 'figure') return 'figure';
  if (tag === 'svg') return 'figure';
  if (tag === 'li') return 'step';
  return null;
}

/** The registry's kinds, read as roles. */
export function roleOfKind(kind: string): GlassRole {
  switch (kind) {
    case 'photo-region':
      return 'photo-line';
    case 'step':
      return 'step';
    case 'diagram':
    case 'frame':
      return 'figure';
    case 'frame-part':
      return 'figure-part';
    case 'equation':
    case 'working':
    case 'workbook':
      return 'card';
    default:
      return 'target';
  }
}

/**
 * The attributes a registered target is labelled with, so the reader finds it by walking and the
 * registry is a label on the glass, never a precondition (docs/INK-FREEZE-PLAN-TRACE.md §3). The
 * role is the registry kind read as a glass role; the label is the entry's text where the element
 * has no words of its own (a figure, a card).
 */
export function glassAttributesOfTarget(target: {
  id: string;
  kind: string;
  label?: string;
  meaning?: string | undefined;
}): Record<string, string> {
  const role = roleOfKind(target.kind);
  const out: Record<string, string> = { 'data-glass': role, 'data-glass-id': target.id };
  if (target.meaning) out['data-glass-meaning'] = target.meaning;
  if (target.label && (role === 'figure' || role === 'card' || role === 'target')) {
    out['data-glass-text'] = target.label;
  }
  return out;
}

/** Put the label on the element; returns the function that takes it off again. */
export function labelElement(
  el: { setAttribute(n: string, v: string): void; removeAttribute(n: string): void },
  target: { id: string; kind: string; label?: string; meaning?: string | undefined },
): () => void {
  const attributes = glassAttributesOfTarget(target);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  return () => {
    for (const name of Object.keys(attributes)) el.removeAttribute(name);
  };
}

export const DEFAULT_CHROME: readonly string[] = [
  'header',
  'nav',
  'footer',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
];

/** Smaller than this in either direction is not on the glass: a visually hidden heading, a file input. */
const MIN_PX = 3;

/** Elements whose own text is the entry's text: their text nodes are not lines as well. */
const OWNS_TEXT: ReadonlySet<GlassRole> = new Set([
  'chip',
  'input',
  'cell',
  'heading',
  'figure-part',
  'step',
]);

/** Elements that are a block of their own, for merging line pieces. */
const BLOCK =
  'p, li, div, td, th, h1, h2, h3, h4, h5, h6, figcaption, label, button, section, article';

// --- The freeze scrolls what the question names onto the glass ------------------------------------

/** The roles a question is usually ABOUT, as opposed to the furniture it is asked from. */
const SUBJECT_ROLES: ReadonlySet<GlassRole> = new Set([
  'figure-part',
  'figure',
  'step',
  'photo-line',
  'heading',
  'card',
  'cell',
]);

/**
 * How strongly a thing answers the question: a shared content word counts most, a meaning from the
 * content model next, then the kind of thing it is. Nothing here looks at where it is.
 */
function namedScore(candidate: GlassCandidate, q: { words: string[]; numbers: string[] }): number {
  const hay = `${candidate.text} ${candidate.meaning ?? ''}`.toLowerCase();
  let hits = 0;
  for (const word of q.words) {
    if (hay.includes(word)) hits += 1;
  }
  if (hits === 0) return 0;
  let score = hits * 4;
  if (candidate.meaning) score += 3;
  for (const n of q.numbers) {
    if (hay.includes(n)) score += 2;
  }
  if (SUBJECT_ROLES.has(candidate.role)) score += 2;
  if (candidate.chrome) score -= 4;
  return score;
}

/** Below this nothing is worth scrolling to: one shared word on an ordinary line is not a subject. */
const SCROLL_BAR = 6;

/**
 * Which candidate the freeze should bring onto the glass, if any: the thing the question names
 * best, when NOTHING it names is on the glass already. The index is into the array as given, so a
 * caller can reach its own handle. Pure: it decides, it never moves the page.
 */
export function scrollTarget<T extends { candidate: GlassCandidate }>(
  pending: readonly T[],
  question: string,
): number {
  const q = questionWords(question);
  if (q.words.length === 0 && q.numbers.length === 0) return -1;
  let best = -1;
  let bestScore = SCROLL_BAR;
  for (let i = 0; i < pending.length; i += 1) {
    const candidate = (pending[i] as T).candidate;
    const score = namedScore(candidate, q);
    if (score <= 0) continue;
    // Something the question names is already in front of the learner: the glass is held as it is.
    if ((candidate.visible ?? 1) > 0 && score > SCROLL_BAR) return -1;
    if ((candidate.visible ?? 1) > 0) continue;
    if (candidate.occluded) continue;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Put a box in the middle of the viewport, now. True when the thing is ON THE GLASS afterwards,
 * which is the only success that matters: the page may scroll, or a pane may, or neither, and a
 * page with `scroll-behavior: smooth` would otherwise report a move that has not happened yet
 * (which is why the scroll is `instant`, never `auto`).
 */
function scrollOntoGlass(
  handle: Handle,
  element: Element | null,
  vp: { w: number; h: number },
): boolean {
  if (typeof window === 'undefined') return false;
  const before = measure(handle);
  if (!before) return false;
  const scroller = element as
    | (Element & { scrollIntoView?: (o: ScrollIntoViewOptions) => void })
    | null;
  if (scroller && typeof scroller.scrollIntoView === 'function') {
    scroller.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  } else if (typeof window.scrollBy === 'function') {
    window.scrollBy({ top: before.y + before.h / 2 - vp.h / 2, behavior: 'instant' });
  } else {
    return false;
  }
  const after = measure(handle);
  return after !== null && visibleShare(after, vp) > 0;
}

// --- The read ------------------------------------------------------------------------------------

interface Pending {
  candidate: GlassCandidate;
  handle: Handle;
  element: Element | null;
}

function isVisible(el: Element): boolean {
  const check = (el as Element & { checkVisibility?: () => boolean }).checkVisibility;
  if (typeof check === 'function') return check.call(el);
  return true;
}

/**
 * One run of text as the page lays it out: the characters, and the box they occupy.
 */
export interface GlassTextRun {
  text: string;
  /** Null when the run has no layout to read (a test DOM, a detached node). */
  box: { left: number; right: number; top: number; bottom: number } | null;
  /** True when this run and the one before it sit inside different elements. */
  breaks: boolean;
}

/**
 * THE WORDS AS A PERSON READS THEM, NOT AS `textContent` CONCATENATES THEM (the adversary,
 * 2026-09-09, finding 10).
 *
 * The course outline renders its number in its own span — `<span>1</span>meet a square and a
 * cube` — and `textContent` glues those two runs with nothing between them. So the glass carried
 * "1meet a square and a cube" and "2feel the rule", and every one of the fourteen world lasso
 * turns printed the learner's own words back as `explain this: "2feel the rule"`.
 *
 * A space belongs wherever the page put one: between two runs in different elements that do not
 * touch, and at every line wrap. Two runs in different elements that DO touch are one word split
 * by markup (`<b>hyp</b>otenuse`), and nothing goes between them.
 */
export function joinTextRuns(runs: readonly GlassTextRun[]): string {
  let out = '';
  let previous: GlassTextRun | null = null;
  for (const run of runs) {
    if (!run.text.trim()) continue;
    if (previous !== null) {
      const before = previous.box;
      const now = run.box;
      const wrapped = before !== null && now !== null && now.top >= before.bottom - 1;
      // No layout to read: the markup boundary is all we have, and a boundary is a word break more
      // often than it is a split word.
      const apart =
        before === null || now === null ? run.breaks : run.breaks && now.left - before.right > 0.5;
      if (wrapped || apart) out += ' ';
    }
    out += run.text;
    previous = run;
  }
  return out;
}

/** Every text run inside an element, in reading order, with the box the page gave it. */
export function textRunsOf(el: Element): GlassTextRun[] {
  const doc = el.ownerDocument;
  if (!doc || typeof doc.createTreeWalker !== 'function') return [];
  const runs: GlassTextRun[] = [];
  let walker: TreeWalker;
  try {
    walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  } catch {
    return [];
  }
  let previousParent: Node | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    const parent = node.parentNode;
    if (!text.trim()) {
      previousParent = parent;
      continue;
    }
    let box: GlassTextRun['box'] = null;
    try {
      const range = doc.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r && finiteRect(r) && (r.width > 0 || r.height > 0)) {
        box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }
    } catch {
      box = null;
    }
    runs.push({ text, box, breaks: previousParent !== null && previousParent !== parent });
    previousParent = parent;
  }
  return runs;
}

const finiteRect = (r: { left: number; right: number; top: number; bottom: number }): boolean =>
  Number.isFinite(r.left) && Number.isFinite(r.right) && Number.isFinite(r.top) && Number.isFinite(r.bottom);

function textOf(el: Element): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value || el.placeholder || el.getAttribute('aria-label') || '';
  }
  const label = el.getAttribute('aria-label');
  if (label !== null) return label;
  const runs = textRunsOf(el);
  if (runs.length === 0) return el.textContent ?? '';
  return joinTextRuns(runs);
}

function bbox(el: Element): Box | null {
  const r = el.getBoundingClientRect();
  const b = toBox(r);
  if (!finite(b) || b.w <= 0 || b.h <= 0) return null;
  return b;
}

/**
 * Visually hidden text (a 1 px clipped box, an sr-only span) is not on the glass, though its
 * text range still measures a full line. The nearest few ancestors are checked; past the block
 * the page's own layout is trusted.
 */
function clippedAway(el: Element): boolean {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 6; depth += 1) {
    if (node.tagName === 'BODY') break;
    const r = node.getBoundingClientRect();
    // A box with size in both directions but under three pixels in one is a hiding place, not a
    // line: `clip: rect(0,0,0,0)`, `clip-path: inset(50%)`, the 1x1 sr-only span. Its text range
    // still measures a full 411x23 line, which is how the lasso's announcement was ringed in the
    // corner of the page (the adversary's lab, 2026-09-08).
    if (r.width > 0 && r.height > 0 && (r.width < MIN_PX || r.height < MIN_PX)) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * The line pieces of one text node: each visual line, its words, and their box. One rect means
 * one line and no per-word work; more rects mean every word is placed on its line by its own box.
 */
function linePieces(
  node: Text,
  doc: Document,
): { text: string; box: Box; start: number; end: number }[] {
  const data = node.data;
  if (!data.trim()) return [];
  const range = doc.createRange();
  range.selectNodeContents(node);
  const rects = Array.from(range.getClientRects())
    .map(toBox)
    .filter((b) => b.w > 0 && b.h > 0 && finite(b));
  if (rects.length === 0) return [];
  // Group the rects into line boxes by their vertical centre.
  const lines: Box[] = [];
  for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = lines[lines.length - 1];
    const cy = r.y + r.h / 2;
    if (last && Math.abs(last.y + last.h / 2 - cy) < Math.max(4, last.h * 0.5)) {
      lines[lines.length - 1] = union(last, r);
    } else {
      lines.push({ ...r });
    }
  }
  if (lines.length === 1) {
    const box = lines[0] as Box;
    return [{ text: normaliseGlassText(data), box, start: 0, end: data.length }];
  }
  // Several lines: place each word on the line whose band holds its centre.
  const out: { text: string; box: Box | null; start: number; end: number; words: string[] }[] =
    lines.map(() => ({ text: '', box: null, start: -1, end: -1, words: [] }));
  const re = /\S+/g;
  let m: RegExpExecArray | null = re.exec(data);
  while (m !== null) {
    const start = m.index;
    const end = start + m[0].length;
    range.setStart(node, start);
    range.setEnd(node, end);
    const wr = toBox(range.getBoundingClientRect());
    if (wr.w > 0 && wr.h > 0) {
      const cy = wr.y + wr.h / 2;
      let index = lines.findIndex((l) => cy >= l.y && cy <= l.y + l.h);
      if (index < 0) {
        // Between bands (a wrapped word at a tab stop): the nearest line takes it.
        let best = Number.POSITIVE_INFINITY;
        lines.forEach((l, i) => {
          const d = Math.abs(l.y + l.h / 2 - cy);
          if (d < best) {
            best = d;
            index = i;
          }
        });
      }
      const line = out[index] as (typeof out)[number];
      line.words.push(m[0]);
      line.box = union(line.box, wr);
      if (line.start < 0) line.start = start;
      line.end = end;
    }
    m = re.exec(data);
  }
  return out
    .filter((l) => l.box !== null && l.words.length > 0)
    .map((l) => ({ text: l.words.join(' '), box: l.box as Box, start: l.start, end: l.end }));
}

/** Parts of a figure: elements with an id or a part label, and `<text>` naming what it sits on. */
function figureParts(
  figure: Element,
  figureId: string,
  order: () => number,
  vp: { w: number; h: number },
): Pending[] {
  const out: Pending[] = [];
  const seen = new Set<Element>();
  /** One part per name: the shape with the id comes first in document order, its label rides with it. */
  const named = new Set<string>();
  const push = (el: Element, name: string, box: Box, handle?: Handle) => {
    if (seen.has(el)) return;
    seen.add(el);
    const slug = normaliseGlassText(name)
      .toLowerCase()
      .replace(/[^a-z0-9²³]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (!slug || named.has(slug)) return;
    named.add(slug);
    out.push({
      candidate: {
        role: 'figure-part',
        text: normaliseGlassText(name),
        box: tuple(box),
        order: order(),
        id: `${figureId}.${slug}`,
        meaning: `part:${slug}`,
        visible: visibleShare(box, vp),
      },
      handle: handle ?? { kind: 'element', element: el },
      element: el,
    });
  };
  const shapes = Array.from(
    figure.querySelectorAll('circle, ellipse, rect, polygon, path, g'),
  ).filter((s) => !s.hasAttribute('data-glass-part') && !s.id);
  const shapeBoxes = shapes.map((s) => ({ el: s, box: bbox(s) }));
  for (const el of Array.from(figure.querySelectorAll('[data-glass-part], [id], text'))) {
    if (el === figure) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'defs' || tag === 'lineargradient' || tag === 'radialgradient' || tag === 'stop') {
      continue;
    }
    if (el.closest('defs')) continue;
    const box = bbox(el);
    if (!box) continue;
    const part = el.getAttribute('data-glass-part');
    if (part) {
      push(el, part, box);
      continue;
    }
    if (tag === 'text') {
      const name = normaliseGlassText(el.textContent ?? '');
      if (!name) continue;
      // The shape this label sits on: the smallest shape whose box holds the text's centre.
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      let host: Box | null = null;
      let hostEl: Element | null = null;
      for (const s of shapeBoxes) {
        const b = s.box;
        if (!b || s.el.tagName.toLowerCase() === 'g') continue;
        if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
          if (!host || b.w * b.h < host.w * host.h) {
            host = b;
            hostEl = s.el;
          }
        }
      }
      // The map advertises the union; the handle has to measure the union too, or the ring lands
      // inside the shape the learner named (the adversary, wave 47, finding 5).
      push(el, name, host ? union(host, box) : box, figurePartHandle(el, hostEl));
      continue;
    }
    if (el.id && el.closest('svg')) {
      const name = el.getAttribute('aria-label') ?? el.id;
      push(el, name, box);
    }
  }
  return out;
}

/**
 * Read the glass. Pure of any app: the caller says what to ignore, what occludes, what the
 * screen registered, and the question; the reader walks, measures, and hands the pure half the
 * candidates.
 */
export function readGlass(options: ReadGlassOptions = {}): GlassRead {
  const doc = typeof document === 'undefined' ? null : document;
  const vp = options.viewport ?? {
    w: typeof window === 'undefined' ? 0 : window.innerWidth,
    h: typeof window === 'undefined' ? 0 : window.innerHeight,
  };
  const viewport: GlassViewport = {
    w: vp.w,
    h: vp.h,
    scrollY: typeof window === 'undefined' ? 0 : Math.round(window.scrollY),
    ...(options.theme ? { theme: options.theme } : {}),
    ...(options.reduced ? { reduced: true } : {}),
    ...(options.route ? { route: options.route } : {}),
  };
  const root = options.root ?? doc?.body ?? null;
  const pending: Pending[] = [];
  let n = 0;
  const order = () => n++;
  if (!doc || !root) return live({ v: 1, viewport, entries: [] }, new Map());

  const ignore = (options.ignore ?? DEFAULT_IGNORE).join(', ');
  const chrome = (options.chrome ?? DEFAULT_CHROME).join(', ');
  const isChrome = (el: Element | null): boolean => Boolean(el && chrome && el.closest(chrome));
  const occluders = Array.from(
    doc.querySelectorAll((options.occluders ?? DEFAULT_OCCLUDERS).join(', ')),
  )
    .filter((el) => isVisible(el))
    .map((el) => ({ el, box: bbox(el) }))
    .filter((o): o is { el: Element; box: Box } => o.box !== null);
  const ignored = (el: Element | null): boolean => Boolean(el && ignore && el.closest(ignore));

  // Registered things first: their elements are known by identity, so a walked element that is
  // one of them keeps the registered id.
  const byElement = new Map<Element, GlassRegistered>();
  const registered = options.registered ?? [];
  for (const r of registered) {
    const el = r.element?.() ?? null;
    if (el) byElement.set(el, r);
  }

  // --- elements ---
  const walkedElements = new Set<Element>();
  /** Ids the walk declared (`data-glass-id`), so the registry's mirror of the same thing is not read twice. */
  const declaredIds = new Set<string>();
  const figureOf = new Map<Element, string>();
  const all = root.querySelectorAll('*');
  for (const el of Array.from(all)) {
    if (ignored(el)) continue;
    const reg = byElement.get(el);
    const declared = declaredRole(el);
    // An SVG's inner elements are read as parts of their figure, never as elements of their own.
    const svg = el.closest('svg');
    if (svg && svg !== el) continue;
    const role = declared ?? (reg ? roleOfKind(reg.kind) : impliedRole(el));
    if (!role) continue;
    // A button or an input inside a labelled step or cell is that step's words, not a thing of its own.
    if (
      !declared &&
      !reg &&
      el.parentElement?.closest('[data-glass="step"], [data-glass="cell"]')
    ) {
      continue;
    }
    // One figure per drawing: an svg inside a figure already read is that figure's drawing, and a
    // <figure> wrapped around a labelled figure is that figure's frame, never a second figure.
    if (role === 'figure' && !declared && !reg) {
      const outer = el.parentElement?.closest('[data-glass="figure"], figure');
      if (outer && walkedElements.has(outer)) continue;
      if (el.querySelector('[data-glass="figure"]')) continue;
    }
    if (el.getAttribute('aria-hidden') === 'true' && !declared && !reg) continue;
    const box = bbox(el);
    if (!box) continue;
    if (box.w < MIN_PX || box.h < MIN_PX) continue;
    if (role === 'figure' && (box.w < 40 || box.h < 40) && !declared) continue;
    if (!isVisible(el)) continue;
    const id = el.getAttribute('data-glass-id') ?? reg?.id ?? undefined;
    if (id) declaredIds.add(id);
    const meaning = el.getAttribute('data-glass-meaning') ?? reg?.meaning ?? undefined;
    const label = el.getAttribute('data-glass-text') ?? reg?.label;
    // The words: a declared text, the registry's own text for the thing (a photo line's reading),
    // then what the element says for itself.
    const text =
      role === 'figure' || role === 'card'
        ? (label ?? el.getAttribute('aria-label') ?? '')
        : (el.getAttribute('data-glass-text') ?? reg?.text ?? textOf(el) ?? reg?.label ?? '');
    walkedElements.add(el);
    const candidate: GlassCandidate = {
      role,
      text: normaliseGlassText(text || label || ''),
      box: tuple(box),
      order: order(),
      ...(id ? { id } : {}),
      ...(meaning ? { meaning } : {}),
      visible: visibleShare(box, vp),
      chrome: isChrome(el),
    };
    pending.push({ candidate, handle: { kind: 'element', element: el }, element: el });
    if (role === 'figure') {
      // A figure with no declared id takes the hash id once ids are assigned; parts need it now.
      const fid = id ?? `f-${n}`;
      figureOf.set(el, fid);
      candidate.id = fid;
      const parts = figureParts(el, fid, order, vp);
      // An svg nobody labelled, with no words and no parts, is an icon, not a figure.
      if (!declared && !reg && parts.length === 0 && !candidate.text) {
        pending.pop();
        walkedElements.delete(el);
        continue;
      }
      pending.push(...parts);
      // A figure is where its drawing is: a part that overflows the wrapper (an SVG drawn past
      // its viewBox) widens the figure's box, so every part sits inside it.
      let whole: Box = box;
      for (const part of parts) {
        const [px, py, pw, ph] = part.candidate.box;
        whole = union(whole, { x: px, y: py, w: pw, h: ph });
      }
      candidate.box = tuple(whole);
      candidate.visible = visibleShare(whole, vp);
    }
  }

  // --- lines ---
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pieces: {
    node: Text;
    text: string;
    box: Box;
    start: number;
    end: number;
    block: Element | null;
    el: Element;
  }[] = [];
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    current = walker.nextNode();
    const parent = node.parentElement;
    if (!parent || ignored(parent)) continue;
    if (parent.closest('svg')) continue;
    if (parent.closest('[aria-hidden="true"]')) continue;
    if (clippedAway(parent)) continue;
    // An element whose text IS its entry (the nearest walked ancestor: a chip, a step, a heading):
    // its words are not lines as well.
    let owner: Element | null = parent;
    while (owner && !walkedElements.has(owner)) owner = owner.parentElement;
    if (owner) {
      const reg = byElement.get(owner);
      const ownerRole = declaredRole(owner) ?? (reg ? roleOfKind(reg.kind) : impliedRole(owner));
      if (ownerRole && OWNS_TEXT.has(ownerRole)) continue;
    }
    for (const piece of linePieces(node, doc)) {
      pieces.push({ node, ...piece, block: parent.closest(BLOCK), el: parent });
    }
  }
  // Merge pieces that sit on one visual line inside one block (a bold word, then its sentence).
  pieces.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const merged: {
    text: string;
    box: Box;
    parts: { node: Text; start: number; end: number }[];
    el: Element;
  }[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    const sameLine =
      last &&
      last.el.closest(BLOCK) === p.block &&
      Math.abs(last.box.y + last.box.h / 2 - (p.box.y + p.box.h / 2)) <
        Math.max(4, p.box.h * 0.5) &&
      p.box.x >= last.box.x + last.box.w - 2 &&
      p.box.x - (last.box.x + last.box.w) <= p.box.h * 1.5;
    if (last && sameLine) {
      last.text = `${last.text} ${p.text}`.replace(/\s+/g, ' ');
      last.box = union(last.box, p.box);
      last.parts.push({ node: p.node, start: p.start, end: p.end });
    } else {
      merged.push({
        text: p.text,
        box: p.box,
        parts: [{ node: p.node, start: p.start, end: p.end }],
        el: p.el,
      });
    }
  }
  for (const line of merged) {
    if (!line.text.trim()) continue;
    pending.push({
      candidate: {
        role: 'line',
        text: line.text,
        box: tuple(line.box),
        order: order(),
        visible: visibleShare(line.box, vp),
        chrome: isChrome(line.el),
      },
      handle: { kind: 'range', pieces: line.parts },
      element: line.el,
    });
  }

  // --- registered things with no element on the glass (a photo's lines, a frame's parts) ---
  for (const r of registered) {
    const el = r.element?.() ?? null;
    if (el && walkedElements.has(el)) continue;
    if (declaredIds.has(r.id)) continue;
    let rect: ReturnType<GlassRegistered['rect']> = null;
    try {
      rect = r.rect();
    } catch {
      rect = null;
    }
    if (!rect) continue;
    const box = toBox(rect);
    if (!finite(box) || box.w <= 0 || box.h <= 0) continue;
    pending.push({
      candidate: {
        role: roleOfKind(r.kind),
        text: normaliseGlassText(r.text || r.label),
        box: tuple(box),
        order: order(),
        id: r.id,
        ...(r.meaning ? { meaning: r.meaning } : {}),
        visible: visibleShare(box, vp),
      },
      handle: { kind: 'registered', rect: r.rect },
      element: el,
    });
  }

  // --- occlusion: a thing under a sheet or a dialog is not on the glass ---
  for (const p of pending) {
    const [x, y, w, h] = p.candidate.box;
    const cx = x + w / 2;
    const cy = y + h / 2;
    for (const o of occluders) {
      if (p.element && o.el.contains(p.element)) continue;
      if (cx >= o.box.x && cx <= o.box.x + o.box.w && cy >= o.box.y && cy <= o.box.y + o.box.h) {
        p.candidate.occluded = true;
        break;
      }
    }
  }

  // THE FREEZE SCROLLS IT IN, THEN READS. Nothing off the glass is on the map (map.ts), so a
  // question about a thing above the fold would otherwise reach the brain with its subject
  // missing. The glass is held STILL, not held wrong: the thing the words name is brought into
  // view once, before the read and before the pen, and the page is walked again on the settled
  // layout (the adversary's lab, 2026-09-08: diagram-c4.effect ringed at y=-143).
  if (options.scroll !== false && options.question) {
    const index = scrollTarget(pending, options.question);
    const chosen = index >= 0 ? pending[index] : undefined;
    if (chosen && scrollOntoGlass(chosen.handle, chosen.element, vp)) {
      // The read is a fresh walk on the settled page, and it is the live one: its map getter and
      // its handles are what the hand traces from. Never a spread of it, which would freeze the
      // map at this instant and leave `remeasure` writing to an object nobody reads.
      const again = readGlass({ ...options, scroll: false });
      again.scrolled = true;
      return again;
    }
  }

  const map = chooseGlass(
    pending.map((p) => p.candidate),
    viewport,
    options,
  );
  // Handles are keyed by the id the pure half settled on; match back by candidate identity.
  const handles = new Map<string, Pending>();
  const byOrder = new Map<number, Pending>();
  for (const p of pending) byOrder.set(p.candidate.order, p);
  // chooseGlass keeps the candidate's declared id and assigns hashed ones in document order;
  // re-run the assignment to learn which pending got which id.
  const assigned = assignGlassIds(pending.map((p) => p.candidate));
  for (const a of assigned) {
    const p = byOrder.get(a.order);
    if (p) handles.set(a.id, p);
  }
  return live(map, handles);
}

function measure(handle: Handle): Box | null {
  if (handle.kind === 'element') return bbox(handle.element);
  if (handle.kind === 'union') {
    let box: Box | null = null;
    for (const el of handle.elements) {
      const b = bbox(el);
      if (b) box = union(box, b);
    }
    return box;
  }
  if (handle.kind === 'registered') {
    try {
      const r = handle.rect();
      if (!r) return null;
      const b = toBox(r);
      return finite(b) && b.w > 0 && b.h > 0 ? b : null;
    } catch {
      return null;
    }
  }
  const doc = handle.pieces[0]?.node.ownerDocument;
  if (!doc) return null;
  const range = doc.createRange();
  let box: Box | null = null;
  for (const piece of handle.pieces) {
    if (!piece.node.isConnected) continue;
    const len = piece.node.data.length;
    range.setStart(piece.node, Math.min(piece.start, len));
    range.setEnd(piece.node, Math.min(piece.end, len));
    for (const r of Array.from(range.getClientRects())) {
      const b = toBox(r);
      if (b.w > 0 && b.h > 0 && finite(b)) box = union(box, b);
    }
  }
  return box;
}

function findWords(handle: Handle, element: Element | null, words: string): Box | null {
  const wanted = normaliseGlassText(words).toLowerCase();
  if (!wanted) return null;
  const nodes: Text[] = [];
  if (handle.kind === 'range') {
    for (const p of handle.pieces) nodes.push(p.node);
  } else if (element) {
    const doc = element.ownerDocument;
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let cur = walker.nextNode();
    while (cur) {
      nodes.push(cur as Text);
      cur = walker.nextNode();
    }
  }
  for (const node of nodes) {
    if (!node.isConnected) continue;
    const hay = node.data.toLowerCase();
    const at = hay.indexOf(wanted);
    if (at < 0) continue;
    const range = node.ownerDocument.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + wanted.length);
    let box: Box | null = null;
    for (const r of Array.from(range.getClientRects())) {
      const b = toBox(r);
      if (b.w > 0 && b.h > 0) box = union(box, b);
    }
    if (box) return box;
  }
  return null;
}

function live(map: GlassMap, handles: Map<string, Pending>): GlassRead {
  let current = map;
  const read: GlassRead = {
    get map() {
      return current;
    },
    scrolled: false,
    remeasure() {
      const entries = [];
      for (const entry of current.entries) {
        const h = handles.get(entry.id);
        if (!h) continue;
        const box = measure(h.handle);
        if (!box) continue;
        entries.push({
          ...entry,
          box: [
            Math.round(box.x),
            Math.round(box.y),
            Math.round(box.w),
            Math.round(box.h),
          ] as GlassBox,
        });
      }
      current = {
        ...current,
        viewport: {
          ...current.viewport,
          w: typeof window === 'undefined' ? current.viewport.w : window.innerWidth,
          h: typeof window === 'undefined' ? current.viewport.h : window.innerHeight,
          scrollY:
            typeof window === 'undefined' ? current.viewport.scrollY : Math.round(window.scrollY),
        },
        entries,
      };
      return current;
    },
    rectOf(id) {
      const h = handles.get(id);
      if (!h) return null;
      const box = measure(h.handle);
      return box ? tuple(box) : null;
    },
    find(id, words) {
      const h = handles.get(id);
      if (!h) return null;
      const box = findWords(h.handle, h.element, words);
      return box ? tuple(box) : null;
    },
    elementOf(id) {
      return handles.get(id)?.element ?? null;
    },
  };
  return read;
}

/** One handle's live box, as the pen reads it. Exported so a test can hold the map to it. */
export function measureHandle(handle: GlassHandle): GlassBox | null {
  const box = measure(handle);
  return box ? tuple(box) : null;
}
