/**
 * The prerequisite graph, derived from what the brain already sent.
 *
 * The audit caught two halves of the same hole: `unmetPrereqs` had no callers, and it would have
 * returned nothing if it had, because every topic shipped `prereqTopicIds: []`. The graph that
 * knows the real edges lives in the platform's ontology, and most of it is not reachable from a
 * board topic yet. So this module builds the graph the client CAN honestly build, out of the
 * syllabus the brain already served, and labels every edge with where it came from.
 *
 * Four rules, strongest source first:
 *
 *   `ontology`   the platform's own confirmed prerequisite edges (`kgtopg.ontology
 *                .getPrerequisites`), matched onto the learner's loaded topics by name. Expert
 *                validated upstream; the client only resolves which of its topics they name.
 *   `editorial`  ONE table, below, of edges asserted by judgment. Every row is a judgment call.
 *   `name`       an earlier topic whose whole name is spoken inside a later topic's name
 *                ("Fractions" under "Multiplication of Fractions"). The framework's own words.
 *   `sequence`   the framework's own published order INSIDE one unit. A board that prints topic 2
 *                after topic 1 in one chapter is stating a teaching order; reading it is not
 *                inventing it.
 *
 * Three guards keep this from ever contradicting a board:
 *
 *   1. No cross-unit `sequence` edges. A syllabus's chapter order is often thematic, not a
 *      dependency chain, so the order of chapters is not read as one. Only the order inside a
 *      chapter is, because that is a chapter's own teaching sequence.
 *   2. Every edge, from every rule, must point BACKWARDS in the subject's own order. If a board
 *      teaches tissues before cells, the editorial row for it simply does not fire.
 *   3. Nothing here invents a topic. Both ends of an edge must be topics the brain served for
 *      this learner's own framework, level and subject.
 *
 * A gate built on this is advice, never a wall (DESIGN.md §8) and the placement check on top of it
 * is skippable, which is what makes a derived-not-decreed graph safe to act on.
 */

import type { Chapter, Topic } from '../data/model';

/**
 * Where an edge came from. Every edge carries one; no edge in this graph is anonymous.
 *
 * `blueprint` is the strongest, and it is the only one this module does not derive: the architect
 * STATED that the chapter assumes this and that the board does not re-teach it
 * (`curriculum/blueprint.ts`, docs/LEARNING-MODEL.md section 5). Everything else here is this
 * client reading a printed order and saying so.
 */
export type PrereqReason = 'blueprint' | 'ontology' | 'editorial' | 'name' | 'sequence';

/** Strongest source wins when two rules produce the same edge. */
const STRENGTH: Record<PrereqReason, number> = {
  blueprint: 4,
  ontology: 3,
  editorial: 2,
  name: 1,
  sequence: 0,
};

export interface PrereqEdge {
  /** The topic that needs ground under it. */
  topicId: string;
  /** The topic it rests on. */
  prereqId: string;
  reason: PrereqReason;
}

// --- names ----------------------------------------------------------------------------------------

/**
 * A topic name, flattened for comparison. Same shape the brain's concept ids are derived from
 * (`conceptId = slug(topic name)`), so two boards that name a topic identically compare equal here
 * for the same reason they share a concept upstream.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Words that name no concept. A topic called "Introduction" is under nothing. */
const GENERIC = new Set([
  'introduction',
  'overview',
  'summary',
  'revision',
  'recap',
  'review',
  'exercise',
  'exercises',
  'practice',
  'activity',
  'activities',
  'project',
  'glossary',
  'basics',
  'chapter',
  'unit',
  'topic',
  'conclusion',
]);

/** The shortest phrase that can carry a concept. Below this a match is a coincidence. */
const MIN_PHRASE = 4;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One compiled matcher per phrase. The derivation asks the same phrase about every earlier topic
 * in the subject, so this turns a few thousand regex builds per ingest into a few hundred.
 */
const matchers = new Map<string, RegExp>();

function matcher(phrase: string): RegExp {
  let re = matchers.get(phrase);
  if (!re) {
    re = new RegExp(`(?:^| )${escapeRe(phrase)}(?:$| )`);
    matchers.set(phrase, re);
  }
  return re;
}

/** True when `host` speaks `phrase` as whole words, and is not simply the same name. */
export function mentions(host: string, phrase: string): boolean {
  if (!phrase || host === phrase || phrase.length < MIN_PHRASE || GENERIC.has(phrase)) return false;
  return matcher(phrase).test(host);
}

// --- the editorial table --------------------------------------------------------------------------

/**
 * EDITORIAL. Asserted by judgment, not read off any board document.
 *
 * Every row below says "wherever both of these are taught, the first is the ground under the
 * second". No syllabus states this in these words, which is exactly why the rows are gathered here
 * in one table instead of scattered through the code: this is the list to argue with, and a row
 * nobody can defend should be deleted rather than explained.
 *
 * Two things keep the table honest. A row fires only when the learner's own loaded syllabus
 * contains BOTH topics in one subject, and only when the ground already comes first in that
 * syllabus's own order, so the table can never reorder a board or add a topic to one. Matching is
 * by spoken phrase, so "Rational Numbers" and "Rational Numbers and their Properties" both match
 * and "Irrational Numbers" does not.
 */
const EDITORIAL: readonly (readonly [ground: string, builds: string])[] = [
  ['whole numbers', 'integers'],
  ['integers', 'rational numbers'],
  ['fractions', 'decimals'],
  ['ratio and proportion', 'percentage'],
  ['algebraic expressions', 'linear equations'],
  ['linear equations in one variable', 'linear equations in two variables'],
  ['triangles', 'congruence'],
  ['motion', 'force'],
  ['atoms and molecules', 'structure of the atom'],
  ['cell', 'tissues'],
];

// --- the derivation -------------------------------------------------------------------------------

/** One topic with its place in the subject's own order. */
interface Placed {
  topic: Topic;
  chapter: number;
  /** Running position across the whole subject: chapter order, then topic order inside it. */
  at: number;
}

function place(chapters: readonly Chapter[]): Placed[] {
  const out: Placed[] = [];
  let at = 0;
  for (let c = 0; c < chapters.length; c++) {
    const chapter = chapters[c];
    if (!chapter) continue;
    for (const topic of chapter.topics) out.push({ topic, chapter: c, at: at++ });
  }
  return out;
}

/** Keep the strongest reason per (topic, prereq) pair, and never an edge to itself. */
function collect(edges: PrereqEdge[]): Map<string, Map<string, PrereqReason>> {
  const byTopic = new Map<string, Map<string, PrereqReason>>();
  for (const edge of edges) {
    if (edge.topicId === edge.prereqId) continue;
    let row = byTopic.get(edge.topicId);
    if (!row) {
      row = new Map();
      byTopic.set(edge.topicId, row);
    }
    const held = row.get(edge.prereqId);
    if (held === undefined || STRENGTH[edge.reason] > STRENGTH[held])
      row.set(edge.prereqId, edge.reason);
  }
  return byTopic;
}

/** How many name-derived grounds one topic may stand on. More than this is noise, not a graph. */
const MAX_NAME_EDGES = 2;

/**
 * Every edge the loaded chapters of one subject support. Pure: it reads the chapters and returns
 * edges, writing nothing. `applyPrereqs` is what puts them on the topics.
 */
export function deriveEdges(chapters: readonly Chapter[]): PrereqEdge[] {
  const placed = place(chapters);
  const names = placed.map((p) => normalizeName(p.topic.name));
  const edges: PrereqEdge[] = [];

  // An editorial row is spent on the FIRST topic that speaks its concept, not on every topic in
  // the chapter that repeats it. "Rational numbers" carries the edge back to integers; the four
  // lessons after it in the same chapter reach the same ground through the chapter's own chain,
  // and the graph keeps a shape a person can read.
  const entry = new Map<string, number>();
  for (const [, builds] of EDITORIAL) {
    if (entry.has(builds)) continue;
    const at = names.findIndex((name) => name === builds || mentions(name, builds));
    if (at >= 0) entry.set(builds, at);
  }

  for (let i = 0; i < placed.length; i++) {
    const here = placed[i];
    const name = names[i];
    if (!here || name === undefined) continue;

    // sequence: the chapter's own printed order, one step back, inside this chapter only.
    const before = placed[i - 1];
    if (before && before.chapter === here.chapter) {
      edges.push({ topicId: here.topic.id, prereqId: before.topic.id, reason: 'sequence' });
    }

    // name: earlier topics this one names. Longest phrase first, and a phrase already covered by
    // a longer one is dropped ("linear equations" under "linear equations in one variable").
    const spoken: { id: string; phrase: string }[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const earlier = placed[j];
      const phrase = names[j];
      if (!earlier || phrase === undefined || !mentions(name, phrase)) continue;
      spoken.push({ id: earlier.topic.id, phrase });
    }
    spoken.sort((a, b) => b.phrase.length - a.phrase.length);
    const kept: string[] = [];
    for (const candidate of spoken) {
      if (kept.length >= MAX_NAME_EDGES) break;
      if (kept.some((phrase) => mentions(phrase, candidate.phrase))) continue;
      kept.push(candidate.phrase);
      edges.push({ topicId: here.topic.id, prereqId: candidate.id, reason: 'name' });
    }

    // editorial: the asserted table, and only ever backwards in this subject's own order.
    for (const [ground, builds] of EDITORIAL) {
      if (entry.get(builds) !== i) continue;
      for (let j = i - 1; j >= 0; j--) {
        const earlier = placed[j];
        const phrase = names[j];
        if (!earlier || phrase === undefined) continue;
        if (phrase === ground || mentions(phrase, ground)) {
          edges.push({ topicId: here.topic.id, prereqId: earlier.topic.id, reason: 'editorial' });
          break; // the nearest one that is the ground; not every ancestor that mentions it
        }
      }
    }
  }
  return edges;
}

// --- the store ------------------------------------------------------------------------------------

/** topicId -> prereqId -> why. Filled by `applyPrereqs`, read by the ground list. */
const reasons = new Map<string, Map<string, PrereqReason>>();

/**
 * Derive the subject's edges and put them on its topics. Mutates `prereqTopicIds` in place, which
 * is what makes `unmetPrereqs` (registry.ts) return something at last.
 *
 * Called on every ingest, over the whole subject: a chapter opened later adds edges to chapters
 * already loaded, and the graph grows with the learner's world rather than being fixed at boot.
 */
export function applyPrereqs(chapters: readonly Chapter[]): PrereqEdge[] {
  const edges = deriveEdges(chapters);
  const byTopic = collect(edges);
  for (const chapter of chapters) {
    for (const topic of chapter.topics) {
      const row = byTopic.get(topic.id);
      // Rule order (sequence, then name, then editorial), which is nobody's teaching order. The
      // two readers that care about order impose their own: `groundBeneath` walks by depth and
      // the placement check ranks past learning first.
      const ids = row ? [...row.keys()] : [];
      topic.prereqTopicIds = ids;
      if (row) reasons.set(topic.id, row);
      else reasons.delete(topic.id);
    }
  }
  return edges;
}

/**
 * Fold the platform's own confirmed prerequisites into one topic's edges.
 *
 * `kgtopg.ontology.getPrerequisites` answers in the platform's node ids, which are a different
 * id-space from a board's syllabus nodes, so the only honest bridge is the name: a platform
 * prerequisite counts when a topic the brain served for this learner carries that name. Anything
 * it names that this learner's syllabus does not contain is dropped rather than invented.
 *
 * Returns the topic ids it added.
 */
export function addOntologyPrereqs(
  topic: Topic,
  named: readonly { name: string }[],
  candidates: readonly Topic[],
): string[] {
  const added: string[] = [];
  const row = reasons.get(topic.id) ?? new Map<string, PrereqReason>();
  for (const node of named) {
    const wanted = normalizeName(node.name);
    if (!wanted) continue;
    const hit = candidates.find((c) => c.id !== topic.id && normalizeName(c.name) === wanted);
    if (!hit) continue;
    const held = row.get(hit.id);
    if (held !== undefined && STRENGTH[held] >= STRENGTH.ontology) continue;
    row.set(hit.id, 'ontology');
    if (!topic.prereqTopicIds.includes(hit.id)) topic.prereqTopicIds.push(hit.id);
    added.push(hit.id);
  }
  if (row.size > 0) reasons.set(topic.id, row);
  return added;
}

/** Why this topic is said to rest on that one, or undefined when the graph draws no such edge. */
export function prereqReason(topicId: string, prereqId: string): PrereqReason | undefined {
  return reasons.get(topicId)?.get(prereqId);
}

/** A new world is a new graph. Called by `resetRegistry`. */
export function resetPrereqs(): void {
  reasons.clear();
}
