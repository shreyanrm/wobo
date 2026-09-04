/**
 * The live syllabus registry on the client.
 *
 * Everything the brain has served this session, held in memory in the shapes the screens read.
 * It is filled by the hooks as a learner opens a level, a subject, a chapter — never ahead of
 * them, and never from a file. Two rules make the audit's "invented CBSE Class 8" impossible:
 *
 *   1. Nothing is written here that did not come from the brain or from the offline cache of a
 *      version the learner is pinned to.
 *   2. A lookup that does not know the answer returns undefined or an empty list. There is no
 *      fallback board, no seed grade, and no dev learner.
 *
 * The `Chapter` and `Topic` shapes are the app's own (data/model.ts); a curriculum unit becomes a
 * chapter and a curriculum topic becomes a topic, keeping the brain's opaque node ids so progress,
 * downloads and deep links survive a version upgrade.
 */

import type { CurriculumNode, CurriculumTopicsView, CurriculumUnitsView } from '@wobo/sdk';
import type { Chapter, Subject, Topic } from '../data/model';
import { applyPrereqs, type PrereqReason, prereqReason, resetPrereqs } from './prereq';
import { subjectFamily, subjectLine } from './subjects';
import { loadWorld, subscribeWorld, type World } from './world';

/** How much a topic's boss battle pays. One number, not a per-topic invention. */
export const TOPIC_XP = 120;

// --- the stores -----------------------------------------------------------------------------------

/** Chapters for the world in front of the learner right now, keyed by the subject's own name. */
let bySubject: Record<string, Chapter[]> = {};
/** Every node seen this session, so a deep link into a topic still resolves after a navigation. */
const topics = new Map<string, Topic>();
const chapters = new Map<string, Chapter>();

let worldKey = keyOf(loadWorld());

/**
 * The subjects of the learner's level, in the framework's own words and order. Empty when they have
 * not chosen a world yet — which is the honest empty state every screen is built for.
 *
 * A live array (mutated in place) so callers can keep importing it as a value.
 */
export const subjects: Subject[] = [];

function refreshSubjects(): Subject[] {
  const world = loadWorld();
  const names = world?.subjects ?? [];
  const same = subjects.length === names.length && subjects.every((s, i) => s.id === names[i]);
  if (!same) {
    subjects.length = 0;
    for (const name of names) subjects.push({ id: name, name, line: subjectLine(name) });
  }
  return subjects;
}

subscribeWorld(() => {
  refreshSubjects();
});
refreshSubjects();

function keyOf(world: World | null): string {
  return world ? `${world.frameworkId}:${world.versionId ?? 'pinned'}:${world.level ?? ''}` : '';
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to "the syllabus in memory changed" — what `useSyncExternalStore` binds to. */
export function subscribeRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A version of the store's contents; changes whenever anything is ingested. */
let revision = 0;
export function registryRevision(): number {
  return revision;
}

/** Drop the current level's chapters — a new framework, version or level is a new world. */
export function resetRegistry(): void {
  bySubject = {};
  topics.clear();
  chapters.clear();
  resetPrereqs();
  worldKey = keyOf(loadWorld());
  refreshSubjects();
  revision++;
  notify();
}

subscribeWorld((world) => {
  const next = keyOf(world);
  if (next !== worldKey) {
    worldKey = next;
    resetRegistry();
  }
});

/** Called before every read: a world switched underneath us clears the previous world's chapters. */
function syncWorld(): void {
  const next = keyOf(loadWorld());
  if (next !== worldKey) {
    worldKey = next;
    bySubject = {};
    topics.clear();
    chapters.clear();
    resetPrereqs();
    refreshSubjects();
    revision++;
  }
}

// --- shaping --------------------------------------------------------------------------------------

/**
 * A curriculum topic node, in the app's topic shape. Its blurb is its first objective, verbatim.
 *
 * THE KIND IS READ, NOT ASSUMED. This used to hardcode `'syllabus'` on every node the brain served,
 * which quietly made three of the four `TopicKind`s unreachable and with them everything downstream
 * that keys off one: the climb's reward node (`screens/learn/climb-map.ts`) and the home's
 * out-of-syllabus quest (`screens/home/stops.ts`) were both dead code on every real chapter.
 *
 * The wire does say. `own` is true for a node the LEARNER put there themselves
 * (`packages/sdk/src/curriculum/overlay.ts` stamps it on every `add` op;
 * `curriculum/OverlayEditor.tsx` is where they do it). But `own` alone is not the distinction
 * wanted: on a PERSONAL framework — a syllabus the learner wrote from scratch — every node is
 * theirs, and a climb where every stop is "something extra" says nothing at all. So the rule is
 * `own` AGAINST a board that is not: a topic they added to a syllabus somebody else set is
 * `custom`; on their own syllabus, everything is ordinary. Nothing is invented, and no other kind
 * is claimed until something real produces one.
 */
export function topicOf(node: CurriculumNode, chapterId: string): Topic {
  // Their own syllabus, either way it is recorded: `personal` is the flag `adoptOwnSyllabus` sets,
  // and `status` is the brain's own label for the same fact (CURRICULUM.md §5). A world written by
  // an older build carries only the second, so both are read.
  const world = loadWorld();
  const ownBoard = world?.personal === true || world?.status === 'personal';
  const topic: Topic = {
    id: node.id,
    chapterId,
    name: node.name,
    blurb: node.objectives[0]?.name ?? '',
    // Empty as it arrives: a node says nothing about what sits under it. The edges are derived
    // from the whole subject once it is in memory, by `applyPrereqs` below (curriculum/prereq.ts).
    prereqTopicIds: [],
    kind: node.own && !ownBoard ? 'custom' : 'syllabus',
    xp: TOPIC_XP,
  };
  const concept = node.conceptIds[0];
  if (concept) topic.nodeId = concept;
  return topic;
}

/** A curriculum unit node, in the app's chapter shape. Topics arrive later, on open. */
export function chapterOf(node: CurriculumNode, subject: string, index: number): Chapter {
  return { id: node.id, subjectId: subject, index, name: node.name, topics: [] };
}

// --- ingestion ------------------------------------------------------------------------------------

/** Take a units answer into memory. A "looking" answer is a status, not a syllabus — it is ignored. */
export function ingestUnits(view: CurriculumUnitsView): void {
  syncWorld();
  if (view.status !== 'ready') return;
  const built = view.units.map((node, i) => {
    const existing = chapters.get(node.id);
    const chapter = chapterOf(node, view.subject, i + 1);
    // Keep topics already fetched for this chapter — reordering a unit must not empty it.
    if (existing) chapter.topics = existing.topics;
    chapters.set(chapter.id, chapter);
    return chapter;
  });
  bySubject = { ...bySubject, [view.subject]: built };
  applyPrereqs(built);
  revision++;
  notify();
}

/** Take a topics answer into memory, under the chapter it belongs to. */
export function ingestTopics(view: CurriculumTopicsView): void {
  syncWorld();
  const chapter = chapters.get(view.unit.id);
  if (!chapter) return;
  chapter.topics = view.topics.map((node) => {
    const topic = topicOf(node, chapter.id);
    topics.set(topic.id, topic);
    return topic;
  });
  // Re-key the subject list so React sees a new array identity for the chapter that changed.
  const list = bySubject[chapter.subjectId];
  if (list) bySubject = { ...bySubject, [chapter.subjectId]: [...list] };
  // The graph is derived over the WHOLE subject, not this unit: a chapter opened now can be the
  // ground under one opened an hour ago, and an edge only exists once both ends are in memory.
  applyPrereqs(bySubject[chapter.subjectId] ?? [chapter]);
  revision++;
  notify();
}

// --- the lookups the screens use ------------------------------------------------------------------

/**
 * Chapters by subject, live. A Proxy so every read resolves the current world without the caller
 * holding a stale object. An unknown subject is undefined — not an empty syllabus, not a seeded one.
 */
export const chaptersBySubject: Record<string, Chapter[]> = new Proxy(
  {},
  {
    get(_t, prop: string) {
      syncWorld();
      return bySubject[prop];
    },
    has(_t, prop: string) {
      syncWorld();
      return prop in bySubject;
    },
    ownKeys() {
      syncWorld();
      return Reflect.ownKeys(bySubject);
    },
    getOwnPropertyDescriptor(_t, prop) {
      syncWorld();
      if (!(prop in bySubject)) return undefined;
      return { enumerable: true, configurable: true, value: bySubject[prop as string] };
    },
  },
) as Record<string, Chapter[]>;

export function topicById(id: string): Topic | undefined {
  syncWorld();
  return topics.get(id);
}

export function chapterById(id: string): Chapter | undefined {
  syncWorld();
  return chapters.get(id);
}

export function subjectById(id: string): Subject | undefined {
  return refreshSubjects().find((s) => s.id === id);
}

/**
 * A subject door. The framework does its own clubbing — if a board teaches one "Science", the
 * registry says "Science" and that is the door. The client never splits or merges a board's
 * subjects on its behalf.
 */
export interface DisplaySubject {
  id: string;
  name: string;
  line: string;
  /** Kept for the screens that ask which canonical families sit behind a door. */
  subjectIds: string[];
}

export function displaySubjects(): DisplaySubject[] {
  return refreshSubjects().map((s) => ({
    id: s.id,
    name: s.name,
    line: s.line,
    subjectIds: [subjectFamily(s.name)],
  }));
}

export function displaySubjectById(id: string): DisplaySubject | undefined {
  return displaySubjects().find((d) => d.id === id);
}

/**
 * The ground directly under a topic that the learner has not covered yet.
 *
 * The edges come from `curriculum/prereq.ts`, derived over the syllabus the brain served for this
 * learner and labelled with where each one came from, so a suggestion still has a source
 * (CURRICULUM.md §12), it is just this client's own reading of the board's order rather than a
 * claim the board made. An edge to a topic that is not in memory resolves to nothing rather than
 * to a guess.
 */
export function unmetPrereqs(topic: Topic, completed: ReadonlySet<string>): Topic[] {
  return topic.prereqTopicIds
    .map((id) => topicById(id))
    .filter((p): p is Topic => Boolean(p) && !completed.has((p as Topic).id));
}

/** One step of the ground under a topic, with the reason the graph put it there. */
export interface GroundStep {
  topic: Topic;
  reason: PrereqReason;
  /** 1 for a direct prerequisite, 2 for the ground under that, and so on. */
  depth: number;
}

/** How far under a topic the walk goes. Deeper than this is an archaeology dig, not a check. */
export const MAX_GROUND_DEPTH = 3;

/**
 * Walk down from a topic and collect the prerequisites the learner has NOT covered, nearest first.
 *
 * A covered prerequisite stops the walk on that branch, the same rule the tutor's `masteredGround`
 * uses in the other direction: standing on solid ground means what is under it is solid too. The
 * walk is breadth-first so "nearest first" is the order a teacher would shore the ground up in.
 */
export function groundBeneath(
  topic: Topic,
  completed: ReadonlySet<string>,
  maxDepth: number = MAX_GROUND_DEPTH,
): GroundStep[] {
  const out: GroundStep[] = [];
  const seen = new Set<string>([topic.id]);
  let frontier: Topic[] = [topic];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: Topic[] = [];
    for (const here of frontier) {
      for (const prereq of unmetPrereqs(here, completed)) {
        if (seen.has(prereq.id)) continue;
        seen.add(prereq.id);
        out.push({ topic: prereq, reason: prereqReason(here.id, prereq.id) ?? 'sequence', depth });
        next.push(prereq);
      }
    }
    frontier = next;
  }
  return out;
}

/** Every topic of the learner's world that has been loaded, in subject then chapter order. */
export function loadedTopics(): Topic[] {
  syncWorld();
  const out: Topic[] = [];
  for (const subject of refreshSubjects()) {
    for (const chapter of bySubject[subject.id] ?? []) out.push(...chapter.topics);
  }
  return out;
}
