/**
 * The glass map (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze).
 *
 * What is on the glass right now, as the brain reads it: every rendered line of text and every
 * meaningful element in the viewport, each with a stable id, a role, its words, its box in CSS px
 * and, where the content model declares one, its meaning (`step:3`, `concept:sign-flip`,
 * `misconception:moves-term-without-sign`, `part:effect`). Nothing has to be registered to be on
 * the map: a component may LABEL a thing (a data attribute, or the target hook), never gate it.
 *
 * This file is the pure half. It knows nothing of the DOM: a reader hands it candidates (see
 * `read.ts`), and it decides ids, chooses what fits, and lays the map out for the wire. The
 * choice is by visibility and by relevance to the question, never by a trimming ladder: the map
 * is at most `GLASS_MAX_ENTRIES` entries and about `GLASS_BYTE_BUDGET` bytes, and what is left
 * out is the least visible, least relevant thing, whatever order it came in.
 */

// --- The shape on the wire -----------------------------------------------------------------------

/** What a thing on the glass is. Free enough for a new surface, fixed enough for a plan. */
export type GlassRole =
  | 'line'
  | 'heading'
  | 'card'
  | 'step'
  | 'figure'
  | 'figure-part'
  | 'chip'
  | 'input'
  | 'cell'
  | 'photo-line'
  | 'target';

/** A viewport box in CSS px: x, y, width, height. A tuple, so sixty of them stay small. */
export type GlassBox = [number, number, number, number];

export interface GlassEntry {
  /** Stable across re-measure: a declared id, or role + content hash + occurrence index. */
  id: string;
  role: GlassRole;
  /** The words, as rendered on this line or in this element, clamped. */
  text: string;
  box: GlassBox;
  /** From the content model, when we own the content. */
  meaning?: string;
}

export interface GlassViewport {
  w: number;
  h: number;
  scrollY: number;
  theme?: 'light' | 'dark';
  reduced?: boolean;
  route?: string;
}

export interface GlassMap {
  v: 1;
  viewport: GlassViewport;
  entries: GlassEntry[];
  /** How many visible things were left off, so the brain knows the map is a choice. */
  more?: number;
}

/** The hard count. */
export const GLASS_MAX_ENTRIES = 60;
/** About this many bytes of JSON. The choice fills to here; nothing is shaved afterwards. */
export const GLASS_BYTE_BUDGET = 2048;
/** A line's words on the wire. A body line at 390 px is about forty characters. */
export const GLASS_TEXT_CLAMP = 72;

// --- Candidates: what a reader hands in ----------------------------------------------------------

/**
 * One visible thing before it has an id or a place on the map. `order` is document order (a
 * reader counts as it walks), `visible` is the share of the box inside the viewport, and
 * `chrome` marks app furniture (a header, a nav) that a question is rarely about.
 */
export interface GlassCandidate {
  role: GlassRole;
  text: string;
  box: GlassBox;
  order: number;
  /** A declared id (a label from a component or the registry) wins over the hash. */
  id?: string;
  meaning?: string;
  visible?: number;
  chrome?: boolean;
  /** True when something sits over it: a sheet, a dialog. Never chosen. */
  occluded?: boolean;
}

// --- Ids ------------------------------------------------------------------------------------------

/** FNV-1a, 32 bit, in base 36: six or seven characters that change when the words change. */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const ROLE_PREFIX: Record<GlassRole, string> = {
  line: 'l',
  heading: 'h',
  card: 'c',
  step: 's',
  figure: 'f',
  'figure-part': 'p',
  chip: 'k',
  input: 'i',
  cell: 't',
  'photo-line': 'r',
  target: 'g',
};

/** Whitespace folded, trimmed: the text two measures of the same line agree on. */
export function normaliseGlassText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A clamp that never cuts a surrogate pair and always ends the same way for the same input. */
export function clampGlassText(text: string, max: number = GLASS_TEXT_CLAMP): string {
  const flat = normaliseGlassText(text);
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Give every candidate its id. A declared id is kept as it is. Otherwise the id is the role's
 * letter, the hash of the role and the normalised text, and the index of this occurrence among
 * identical ones in document order, so two lines that read the same are still two ids and the
 * same line gets the same id on every measure.
 */
export function assignGlassIds<T extends GlassCandidate>(
  candidates: readonly T[],
): (T & { id: string })[] {
  const sorted = [...candidates].sort((a, b) => a.order - b.order);
  const seen = new Map<string, number>();
  const taken = new Set<string>();
  const out: (T & { id: string })[] = [];
  for (const candidate of sorted) {
    if (candidate.id) {
      let id = candidate.id;
      if (taken.has(id)) {
        // Two components labelled one id: the second is still on the glass, under its own index.
        let n = 1;
        while (taken.has(`${candidate.id}-${n}`)) n += 1;
        id = `${candidate.id}-${n}`;
      }
      taken.add(id);
      out.push({ ...candidate, id });
      continue;
    }
    const key = `${candidate.role}|${normaliseGlassText(candidate.text)}`;
    const hash = contentHash(key);
    const n = seen.get(hash) ?? 0;
    seen.set(hash, n + 1);
    const id = `${ROLE_PREFIX[candidate.role]}-${hash}-${n}`;
    taken.add(id);
    out.push({ ...candidate, id });
  }
  return out;
}

// --- Relevance ------------------------------------------------------------------------------------

const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'is',
  'it',
  'this',
  'that',
  'what',
  'why',
  'how',
  'does',
  'do',
  'me',
  'my',
  'you',
  'i',
  'we',
  'for',
  'with',
  'here',
  'there',
  'show',
  'circle',
  'ring',
  'mark',
  'underline',
  'point',
  'at',
  'please',
  'can',
  'about',
  'part',
  'thing',
  'one',
]);

/** The content words of a question: three letters or more, not a stop word, plus its numbers. */
export function questionWords(question: string): { words: string[]; numbers: string[] } {
  const lower = question.toLowerCase();
  const words = Array.from(new Set(lower.match(/[a-z][a-z'-]{2,}/g) ?? [])).filter(
    (w) => !STOP.has(w),
  );
  const numbers = Array.from(new Set(lower.match(/-?\d+(?:\.\d+)?/g) ?? []));
  return { words, numbers };
}

const ROLE_WEIGHT: Record<GlassRole, number> = {
  'figure-part': 3,
  step: 3,
  'photo-line': 3,
  figure: 2,
  heading: 1.5,
  input: 1.5,
  card: 1,
  cell: 1,
  line: 1,
  // A chip is a thing to tap, not a thing to read: it never outranks the page's own lines.
  chip: 1,
  target: 1,
};

/** A line's weight for its size: large type is a title or a lead, and a lone digit is a bullet. */
function textWeight(entry: GlassCandidate): number {
  if (entry.role !== 'line' && entry.role !== 'heading') return 0;
  const height = entry.box[3];
  let weight = Math.min(1, Math.max(0, (height - 18) / 30));
  if (normaliseGlassText(entry.text).length < 3) weight -= 1.5;
  return weight;
}

/**
 * How much this thing is worth putting in front of the brain for this question. Meaning from the
 * content model counts most (it is what a plan anchors a misconception to), then a word the
 * question uses, then the role, then how much of it is actually in view.
 */
export function relevanceOf(
  entry: GlassCandidate,
  q: { words: string[]; numbers: string[] },
  focusId?: string | null,
): number {
  if (entry.occluded) return Number.NEGATIVE_INFINITY;
  const hay = `${entry.text} ${entry.meaning ?? ''}`.toLowerCase();
  let hits = 0;
  for (const word of q.words) {
    if (hay.includes(word)) hits += 1;
  }
  let numberHit = false;
  for (const n of q.numbers) {
    if (hay.includes(n)) {
      numberHit = true;
      break;
    }
  }
  const focused = Boolean(focusId) && entry.id === focusId;
  const visible = entry.visible ?? 1;
  // NOTHING OFF THE GLASS IS ON THE MAP. Not because the words name it, not because it carries a
  // meaning, not because the learner circled it a scroll ago: a box wholly above, below or beside
  // the viewport is not on the glass, and a mark on it lands where the learner cannot see it (the
  // adversary's lab, 2026-09-08: diagram-c4.effect offered at y=-143 and ringed there). When the
  // thing the question names is off the glass the FREEZE brings it into view before the read
  // (`readGlass`, the scroll), and it is on the map at the place it was scrolled to.
  if (visible <= 0) return Number.NEGATIVE_INFINITY;
  let score = ROLE_WEIGHT[entry.role] + textWeight(entry);
  if (entry.meaning) score += 4;
  score += Math.min(3, hits) * 3;
  if (numberHit) score += 2;
  score += visible * 2;
  if (visible >= 0.999) score += 1;
  if (entry.chrome) score -= 1.5;
  if (focused) score += 6;
  return score;
}

// --- The choice -----------------------------------------------------------------------------------

const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;

export function glassBytes(value: unknown): number {
  const json = JSON.stringify(value) ?? '';
  return encoder ? encoder.encode(json).length : json.length * 2;
}

export interface ChooseOptions {
  question?: string;
  focusId?: string | null;
  maxEntries?: number;
  maxBytes?: number;
}

function roundBox(box: GlassBox): GlassBox {
  return [Math.round(box[0]), Math.round(box[1]), Math.round(box[2]), Math.round(box[3])];
}

function toEntry(candidate: GlassCandidate & { id: string }): GlassEntry {
  const entry: GlassEntry = {
    id: candidate.id,
    role: candidate.role,
    text: clampGlassText(candidate.text),
    box: roundBox(candidate.box),
  };
  if (candidate.meaning) entry.meaning = candidate.meaning;
  return entry;
}

/**
 * Choose the map from everything visible. Candidates are scored, taken from the top while they
 * fit the count and the bytes, and then laid out in reading order (top to bottom, left to right)
 * so the brain reads the page the way the learner does. Nothing is shaved to fit: an entry is on
 * the map whole or not at all, and `more` says how many visible things did not make it.
 */
export function chooseGlass(
  candidates: readonly GlassCandidate[],
  viewport: GlassViewport,
  options: ChooseOptions = {},
): GlassMap {
  const maxEntries = options.maxEntries ?? GLASS_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? GLASS_BYTE_BUDGET;
  const q = questionWords(options.question ?? '');
  const withIds = assignGlassIds(candidates);
  const scored = withIds
    .map((c) => ({ c, score: relevanceOf(c, q, options.focusId) }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => b.score - a.score || a.c.order - b.c.order);

  const map: GlassMap = { v: 1, viewport, entries: [] };
  let bytes = glassBytes(map);
  const chosen: GlassEntry[] = [];
  let left = 0;
  for (const { c } of scored) {
    if (chosen.length >= maxEntries) {
      left += 1;
      continue;
    }
    const entry = toEntry(c);
    const cost = glassBytes(entry) + 1;
    if (bytes + cost > maxBytes) {
      left += 1;
      continue;
    }
    bytes += cost;
    chosen.push(entry);
  }
  chosen.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  map.entries = chosen;
  if (left > 0) map.more = left;
  return map;
}

// --- Labelling ----------------------------------------------------------------------------------

/** The attributes a component sets to label a thing on the glass. A label, never a precondition. */
export interface GlassLabelAttributes {
  'data-glass': GlassRole;
  'data-glass-meaning'?: string;
  'data-glass-id'?: string;
}

/**
 * `<div {...glassLabel('step', 'step:3')}>`: the map reads the role, the meaning and, when given,
 * the id straight off the element, so the content model reaches the brain without a registry.
 */
export function glassLabel(role: GlassRole, meaning?: string, id?: string): GlassLabelAttributes {
  const out: GlassLabelAttributes = { 'data-glass': role };
  if (meaning) out['data-glass-meaning'] = meaning;
  if (id) out['data-glass-id'] = id;
  return out;
}

/** A meaning slug from a title: "Feel the rule" becomes `feel-the-rule`. */
export function meaningSlug(text: string): string {
  return normaliseGlassText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// --- The registry-shaped view, for the gateway's current reader ----------------------------------

/**
 * The map as one surface in the older snapshot shape (`packet.screen`), so a brain that still
 * resolves ids through `planner.Surface.from_context` sees exactly the ids on the glass. The kind
 * is the role, the label is the text, the description is the meaning. No trimming: it is the map.
 */
export function glassAsScreen(
  map: GlassMap,
  route?: string,
): {
  v: 1;
  route?: string;
  surfaces: {
    id: string;
    title: string;
    targets: { id: string; kind: string; label: string; description?: string }[];
  }[];
} {
  const targets = map.entries.map((e) => ({
    id: e.id,
    kind: e.role,
    label: e.text,
    ...(e.meaning ? { description: e.meaning } : {}),
  }));
  return {
    v: 1,
    ...(route ? { route } : {}),
    surfaces: [{ id: 'glass', title: 'what is on the glass', targets }],
  };
}
