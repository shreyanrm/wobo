/**
 * LAW 4 — a doubt joins the climb. This is what makes it Wobo and not a scanner.
 *
 * A solved photo that leaves no trace in the learning is a missed lesson, so a placed doubt does
 * three real things, each through a seam the product already reads:
 *
 *  · it shows on the learner map: `reportProgress(topicId, DOUBT_PROGRESS)` moves the topic to
 *    'started' (an open ring on the constellation, screens/progress/evidence.ts) and never
 *    backwards, and never to 'learnt', because a doubt explained is not a topic mastered;
 *  · it comes back if it slipped: a lapse-shaped retrieval on the real scheduler
 *    (`practice.retrieval.scheduled.v1`, FSRS), so the machine room counts it as due and the
 *    practice set brings it round again;
 *  · it feeds the re-teach ladder: a doubt is a miss on that concept (`noteConceptMiss`), so the
 *    next explanation of it changes axis rather than volume.
 *
 * Nothing here is a claim of mastery: no evidence event is recorded, because a doubt carries no
 * answer from the learner to be right or wrong about.
 */

import { reviewCard } from '@wobo/sdk';
import { loadedTopics, topicById } from '../../curriculum/registry';
import type { Topic } from '../../data/model';
import { noteConceptMiss } from '../../wobo/reteach';
import { topicNodeUuid } from '../learn/mastery';

/** Far enough in to be 'started' on the map, nowhere near a finished course. */
export const DOUBT_PROGRESS = 0.05;

export interface ClimbDeps {
  nowMs: number;
  record: (
    type: 'practice.retrieval.scheduled.v1',
    payload: Record<string, unknown>,
    context?: { ontologyNodeId?: string },
  ) => void;
  reportProgress: (topicId: string, fraction: number) => void;
  /** Where the topic already stands, so the map is never pulled backwards. */
  progressNow?: number;
}

export interface Placed {
  nodeId: string;
  itemId: string;
  dueAt: string;
}

export function joinClimb(doubtId: string, topicId: string, deps: ClimbDeps): Placed {
  const nodeId = topicNodeUuid(topicId);
  deps.reportProgress(topicId, Math.max(deps.progressNow ?? 0, DOUBT_PROGRESS));
  const card = reviewCard(null, false, deps.nowMs);
  deps.record(
    'practice.retrieval.scheduled.v1',
    {
      node_id: nodeId,
      item_id: doubtId,
      due_at: card.dueAt,
      stability: card.stabilityDays,
      difficulty: card.difficulty,
      scheduler: 'fsrs',
    },
    { ontologyNodeId: nodeId },
  );
  noteConceptMiss(nodeId);
  return { nodeId, itemId: doubtId, dueAt: card.dueAt };
}

/**
 * A word in any script: letters with their marks (a Devanagari vowel sign is a mark, and splitting
 * on it would cut a Hindi word in half) and digits. Kept when it is long enough to mean something:
 * four characters in Latin, two elsewhere. Until 2026-09-05 this was `[a-z]{4,}`, so a page in
 * Hindi matched nothing and every such doubt fell to the first eight topics in load order.
 */
const WORD = /[\p{L}\p{M}\p{N}]+/gu;

export function wordsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(WORD) ?? []) {
    const ascii = /^[ -~]*$/.test(raw);
    if (raw.length >= (ascii ? 4 : 2)) out.add(raw);
  }
  return out;
}

function overlap(words: ReadonlySet<string>, name: string): number {
  let score = 0;
  for (const w of wordsOf(name)) if (words.has(w)) score += 1;
  return score;
}

/**
 * Where a doubt belongs: the gateway's hint by id, then by name, then the reading's own words
 * against the topics this learner's world has loaded. Undefined when nothing matches: the screen
 * then asks rather than guessing.
 */
export function topicForDoubt(
  reading: string,
  hint?: { id?: string; nodeId?: string | undefined; name?: string | undefined },
  topics: readonly Topic[] = loadedTopics(),
): Topic | undefined {
  // The gateway files a doubt under `topic_node_uuid(topic.id)` (doubt.py), the same id the
  // app's evidence is keyed by: the strongest hint, and an exact one.
  if (hint?.nodeId) {
    const byNode = topics.find((t) => topicNodeUuid(t.id) === hint.nodeId);
    if (byNode) return byNode;
  }
  if (hint?.id) {
    const byId = topics.find((t) => t.id === hint.id) ?? topicById(hint.id);
    if (byId) return byId;
  }
  if (hint?.name) {
    const q = hint.name.trim().toLowerCase();
    const byName = topics.find(
      (t) => t.name.toLowerCase().includes(q) || q.includes(t.name.toLowerCase()),
    );
    if (byName) return byName;
  }
  const words = wordsOf(reading);
  if (words.size === 0) return undefined;
  let best: { topic: Topic; score: number } | null = null;
  for (const topic of topics) {
    const score = overlap(words, topic.name);
    if (score > 0 && (!best || score > best.score)) best = { topic, score };
  }
  return best?.topic;
}

/**
 * When nothing matched outright, the topics worth offering, best first: the ones whose names share
 * words with the reading (any script), then the ones the learner is already on (started on the
 * map, where a doubt is likeliest), then the rest in load order. So a learner with two hundred
 * topics sees the eight that could be this doubt, not the first eight of their world.
 */
export function suggestTopics(
  reading: string,
  hintName: string | undefined,
  topics: readonly Topic[],
  progress: Readonly<Record<string, number>> = {},
  limit = 8,
): Topic[] {
  const words = wordsOf(`${reading} ${hintName ?? ''}`);
  return topics
    .map((topic, order) => ({
      topic,
      score: overlap(words, topic.name),
      started: (progress[topic.id] ?? 0) > 0 ? 1 : 0,
      order,
    }))
    .sort((a, b) => b.score - a.score || b.started - a.started || a.order - b.order)
    .slice(0, limit)
    .map((r) => r.topic);
}
