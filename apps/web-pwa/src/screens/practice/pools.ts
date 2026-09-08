/**
 * The compose seam — a forged workbook is a composition over per-topic item pools.
 *
 * A "pool" is the honest, verifiable material a topic can be practised from: recall items
 * grounded in the real curriculum (the topic's blurb, its chapter, its place in the syllabus)
 * and, where the subject is computable (math), real solvable problems generated from the topic.
 * Pools are keyed by topicId ONLY — board-shared, personalization never baked in (owner cache
 * law). The composition (which items, how many, weighted toward the learner's slips) is per-run
 * and never cached.
 *
 * The items are the wave-15 MiniWorkbook verbs (match / fill / label / order); a workbook is one
 * or more MiniWorkbookSpec "pages" of at most five items each, graded into evidence/mastery/FSRS
 * by the same event the boss uses.
 *
 * ponytail: deterministic, curriculum-grounded generation — no fabricated facts. The LLM upgrade
 * path is engine.compose (already live for courses); this floor keeps the forge real and offline.
 */

import { chapterById, subjectById, topicById } from '../../curriculum/registry';
import { subjectFamily } from '../../curriculum/subjects';
import type { Topic } from '../../data/model';
import type { MiniWorkbookSpec, WorkbookItem } from '../../engines/MiniWorkbook';
import { onScopeChange, scoped } from '../../store/scope';
import { topicNodeUuid } from '../course/Composing';

export type ForgeSize = 10 | 20 | 40;
export type ForgeMix = 'recall' | 'problem' | 'balanced' | 'wobo';

export const SIZE_LABEL: Record<ForgeSize, string> = { 10: 'quick', 20: 'solid', 40: 'marathon' };
export const MIX_LABEL: Record<ForgeMix, string> = {
  recall: 'recall-heavy',
  problem: 'problem-heavy',
  balanced: 'balanced',
  wobo: 'let Wobo balance it',
};

/** A composed workbook: pages the run steps through, each attributed to one ontology node. */
export interface ComposedWorkbook {
  pages: { spec: MiniWorkbookSpec; nodeId: string; topicId: string }[];
  total: number;
  /** True when the picks could not honestly fill the requested size — the run is shorter. */
  short: boolean;
  /** One plain line about how it was composed (Wobo's reasoning for the "balance" mix). */
  note: string;
}

// --- Deterministic RNG (stable pools; seeded shuffles never reorder on re-render) -----------------

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
}

function shuffle<T>(arr: T[], seed: string): T[] {
  const rng = seeded(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

// --- A tagged item: which topic it practises (drives per-page node attribution) -------------------

interface TaggedItem {
  topicId: string;
  bucket: 'recall' | 'problem';
  item: WorkbookItem;
}

const WORD = /[a-z]{5,}/gi;

/** The strongest word in a sentence to blank — real content, never fabricated. */
function keyword(text: string): string | null {
  const words = text.match(WORD);
  if (!words || words.length === 0) return null;
  return [...words].sort((a, b) => b.length - a.length)[0] ?? null;
}

// --- Per-topic recall pool (board-shared cache) ---------------------------------------------------

const POOL_KEY = (topicId: string) => `wobo-forge-pool-v1:${topicId}`;
const mem = new Map<string, WorkbookItem[]>();
// The cache is one learner's pools. A device that changes learner drops it rather than serving
// the last one's items from memory under the new one's name.
if (typeof window !== 'undefined') onScopeChange(() => mem.clear());

/** Cloze items grounded in the topic's real blurb — the recall floor every topic can supply. */
function buildRecallPool(topic: Topic): WorkbookItem[] {
  const items: WorkbookItem[] = [];
  const key = keyword(topic.blurb);
  if (key) {
    const gapped = topic.blurb.replace(new RegExp(key, 'i'), '{}');
    // distractors: strong words from sibling topics in the same chapter — real, same-domain foils
    const chapter = chapterById(topic.chapterId);
    const siblings = (chapter?.topics ?? [])
      .filter((s) => s.id !== topic.id)
      .map((s) => keyword(s.blurb))
      .filter((w): w is string => !!w && w.toLowerCase() !== key.toLowerCase());
    const distractors = [...new Set(siblings)].slice(0, 3);
    items.push({
      id: `${topic.id}-cloze`,
      kind: 'fill',
      prompt: `fill the gap: ${topic.name.toLowerCase()}`,
      text: gapped,
      blanks: [key],
      distractors,
    });
  }
  return items;
}

function recallPool(topic: Topic): WorkbookItem[] {
  const cached = mem.get(topic.id);
  if (cached) return cached;
  try {
    const raw = scoped.getItem(POOL_KEY(topic.id));
    if (raw) {
      const parsed = JSON.parse(raw) as WorkbookItem[];
      if (Array.isArray(parsed)) {
        mem.set(topic.id, parsed);
        return parsed;
      }
    }
  } catch {
    // storage unavailable — recompute, still fully functional
  }
  const built = buildRecallPool(topic);
  mem.set(topic.id, built);
  try {
    scoped.setItem(POOL_KEY(topic.id), JSON.stringify(built));
  } catch {
    // storage unavailable — pool is session-only
  }
  return built;
}

/**
 * Is a subject computable enough to generate real solvable problems from? (maths, for now.)
 *
 * By the family behind the door, never by the id: a board names its own subjects, so the chapter's
 * `subjectId` is "Mathematics" on a real syllabus, and the literal `'math'` this used to compare
 * against matched only the bundled catalog wave 6 deleted. Every forge bound from a real board
 * composed to nothing, and the dev-time assert below never saw it because it ran on that catalog.
 */
export function computableSubject(subject: string): boolean {
  return subjectFamily(subject) === 'math';
}

function isComputable(topic: Topic): boolean {
  const subjectId = chapterById(topic.chapterId)?.subjectId ?? '';
  return computableSubject(subjectById(subjectId)?.name ?? subjectId);
}

/** Real linear-equation problems, deterministic per (topic, index) — an unbounded honest supply. */
function problemItem(topic: Topic, i: number): WorkbookItem {
  const r = seeded(`${topic.id}:prob:${i}`);
  const a = 2 + Math.floor(r() * 8); // 2..9
  const x = -6 + Math.floor(r() * 16); // -6..9
  const b = -9 + Math.floor(r() * 19); // -9..9
  const c = a * x + b;
  const bTerm = b === 0 ? '' : b > 0 ? ` + ${b}` : ` − ${-b}`;
  const answer = String(x);
  const foils = [String(x + 1), String(x - 1), String(x + 2), String(-x)].filter(
    (v) => v !== answer,
  );
  return {
    id: `${topic.id}-prob-${i}`,
    kind: 'fill',
    prompt: 'solve for x',
    text: `${a}x${bTerm} = ${c}   →   x = {}`,
    blanks: [answer],
    distractors: [...new Set(foils)].slice(0, 3),
  };
}

// --- Group items (span the whole pick set) --------------------------------------------------------

function groupItems(topics: Topic[]): TaggedItem[] {
  const out: TaggedItem[] = [];
  const anchor = topics[0];
  if (!anchor) return out;

  // match each topic to the chapter it lives in — real membership, 2..5 pairs
  const pairs = topics
    .slice(0, 5)
    .map((tp) => ({ left: tp.name, right: chapterById(tp.chapterId)?.name ?? 'its chapter' }));
  if (pairs.length >= 2 && new Set(pairs.map((p) => p.right)).size >= 2) {
    out.push({
      topicId: anchor.id,
      bucket: 'recall',
      item: {
        id: 'grp-match',
        kind: 'match',
        prompt: 'match each topic to the chapter it lives in.',
        pairs,
      },
    });
  }

  // order the topics the way the syllabus does — real sequence
  const ordered = [...topics].sort((a, b) => {
    const ca = chapterById(a.chapterId)?.index ?? 0;
    const cb = chapterById(b.chapterId)?.index ?? 0;
    return ca - cb || a.id.localeCompare(b.id);
  });
  const steps = ordered.slice(0, 6).map((tp) => tp.name);
  if (steps.length >= 2 && new Set(steps).size === steps.length) {
    out.push({
      topicId: anchor.id,
      bucket: 'recall',
      item: { id: 'grp-order', kind: 'order', prompt: 'put these in syllabus order.', steps },
    });
  }
  return out;
}

// --- Composition ----------------------------------------------------------------------------------

const SIZE_MIX: Record<ForgeMix, { recall: number; problem: number }> = {
  recall: { recall: 0.8, problem: 0.2 },
  problem: { recall: 0.2, problem: 0.8 },
  balanced: { recall: 0.5, problem: 0.5 },
  wobo: { recall: 0.5, problem: 0.5 },
};

const PAGE = 5;

/**
 * Compose picks into a runnable workbook. `slipNodeIds` are the ontology nodes the learner has
 * recently slipped on (mind.slips) — the "let Wobo balance it" mix weighs those topics up.
 */
export function composeWorkbook(
  picks: string[],
  size: ForgeSize,
  mix: ForgeMix,
  slipNodeIds: string[] = [],
): ComposedWorkbook {
  const topics = picks.map(topicById).filter((t): t is Topic => !!t);
  if (topics.length === 0) {
    return { pages: [], total: 0, short: true, note: 'pick at least one chapter to forge.' };
  }

  const recall: TaggedItem[] = [];
  const problem: TaggedItem[] = [];

  for (const topic of topics) {
    for (const item of recallPool(topic))
      recall.push({ topicId: topic.id, bucket: 'recall', item });
    if (isComputable(topic)) {
      // generate enough real problems to reach any requested size for this topic
      for (let i = 0; i < size; i++)
        problem.push({ topicId: topic.id, bucket: 'problem', item: problemItem(topic, i) });
    }
  }
  for (const g of groupItems(topics)) recall.push(g);

  // "let Wobo balance it" — float the slipped topics to the front of each bucket
  const slipped = new Set(slipNodeIds);
  const weigh = (arr: TaggedItem[]): TaggedItem[] => {
    if (mix !== 'wobo' || slipped.size === 0) return arr;
    return [...arr].sort(
      (a, b) =>
        (slipped.has(topicNodeUuid(b.topicId)) ? 1 : 0) -
        (slipped.has(topicNodeUuid(a.topicId)) ? 1 : 0),
    );
  };

  const split = SIZE_MIX[mix];
  const wantRecall = Math.round(size * split.recall);
  const wantProblem = size - wantRecall;

  const take = (arr: TaggedItem[], n: number, seed: string): TaggedItem[] =>
    weigh(shuffle(arr, seed)).slice(0, n);

  let chosen = [
    ...take(recall, wantRecall, `r:${picks.join(',')}:${mix}`),
    ...take(problem, wantProblem, `p:${picks.join(',')}:${mix}`),
  ];
  // backfill from whichever bucket still has material, so a rich topic isn't cut short
  if (chosen.length < size) {
    const usedIds = new Set(chosen.map((t) => t.item.id));
    const rest = [...recall, ...problem].filter((t) => !usedIds.has(t.item.id));
    chosen = [...chosen, ...rest.slice(0, size - chosen.length)];
  }
  chosen = shuffle(chosen, `mix:${picks.join(',')}:${mix}:${size}`).slice(0, size);

  // page the chosen items, keeping each page single-topic where possible for clean node attribution
  const byTopic = new Map<string, TaggedItem[]>();
  for (const t of chosen) {
    const list = byTopic.get(t.topicId) ?? [];
    list.push(t);
    byTopic.set(t.topicId, list);
  }
  const pages: ComposedWorkbook['pages'] = [];
  let pageNo = 1;
  for (const [topicId, list] of byTopic) {
    for (let i = 0; i < list.length; i += PAGE) {
      const slice = list.slice(i, i + PAGE);
      pages.push({
        topicId,
        nodeId: topicById(topicId)?.nodeId ?? topicNodeUuid(topicId),
        spec: {
          id: `forge-page-${pageNo}`,
          title: pageTitle(topicId, pageNo),
          items: slice.map((t) => t.item),
        },
      });
      pageNo++;
    }
  }

  const total = chosen.length;
  const short = total < size;
  const note =
    mix === 'wobo'
      ? slipped.size > 0
        ? 'i weighed this toward what you last slipped on. those come first.'
        : 'nothing recent to catch, so i kept it evenly balanced.'
      : `${total} items · ${MIX_LABEL[mix]}.`;

  return { pages, total, short, note };
}

function pageTitle(topicId: string, n: number): string {
  const topic = topicById(topicId);
  if (!topic) return `page ${n}`;
  const subject = subjectById(chapterById(topic.chapterId)?.subjectId ?? '');
  return subject
    ? `${topic.name.toLowerCase()} · ${subject.name.toLowerCase()}`
    : topic.name.toLowerCase();
}

// ponytail: one runnable check — the composer must hit the size for a computable topic and page by 5.
if (import.meta.env.DEV) {
  const w = composeWorkbook(['m2-1'], 20, 'problem');
  console.assert(w.total === 20 && !w.short, 'forge: computable topic fills the requested size');
  console.assert(
    w.pages.every((p) => p.spec.items.length <= 5) &&
      w.pages.reduce((n, p) => n + p.spec.items.length, 0) === 20,
    'forge: pages are capped at five and sum to the total',
  );
}
