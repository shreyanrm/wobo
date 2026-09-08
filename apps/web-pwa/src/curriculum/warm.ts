/**
 * Bring the pinned version's offline cache into memory without asking the network.
 *
 * The registry fills as the learner opens things (CURRICULUM.md §8), which is right for fetching:
 * nothing is pulled ahead of them. But what they have already opened is sitting in the cache of
 * the version they are pinned to, and a screen that opens cold — the home, the learn map — should
 * be able to say "Triangles, lesson 3 of 5" from it rather than pretending the day is empty until
 * a subject screen happens to mount. This reads that cache, applies the learner's own overlay the
 * way the hooks do, and ingests. No request is made; a chapter never opened stays unknown.
 */

import { applyOverlayOps } from '@wobo/sdk';
import type { Topic } from '../data/model';
import { cache } from './cache';
import { curriculum, curriculumReady } from './client';
import { chaptersBySubject, ingestTopics, ingestUnits, loadedTopics, topicById } from './registry';
import { loadWorld } from './world';

export function warmFromCache(): void {
  const world = loadWorld();
  if (!world?.level) return;
  const { frameworkId, versionId, level } = world;
  const ops = cache.overlay(frameworkId, versionId) ?? [];
  for (const subject of world.subjects) {
    if (!chaptersBySubject[subject]) {
      const units = cache.units(frameworkId, versionId, level, subject);
      if (units) {
        ingestUnits(
          ops.length > 0 ? { ...units, units: applyOverlayOps(units.units, ops).nodes } : units,
        );
      }
    }
    for (const chapter of chaptersBySubject[subject] ?? []) {
      if (chapter.topics.length > 0) continue;
      const topics = cache.topics(frameworkId, versionId, chapter.id);
      if (!topics) continue;
      ingestTopics(
        ops.length > 0 ? { ...topics, topics: applyOverlayOps(topics.topics, ops).nodes } : topics,
      );
    }
  }
}

/**
 * Resolve a topic the registry does not know — a course opened by its address, cold. Walks the
 * pinned world the way the subject screens do (the units of each subject, then the topics of each
 * unit), cache first and the brain second, ingesting as it goes, and stops at the first unit that
 * carries the id. Resolves to the topic, or to nothing when no unit in the world answers for it —
 * the caller then treats the address as a course to compose, as before.
 */
export async function ensureTopic(topicId: string): Promise<Topic | undefined> {
  const known = topicById(topicId);
  if (known) return known;
  return (await ensureTopicMatching((t) => t.id === topicId)) ?? topicById(topicId);
}

/**
 * The same walk, for a topic named by something other than its id — the doubt solver arrives with
 * the gateway's own syllabus node (`climb.node_id`, `topic_node_uuid(topic.id)`) and no id to look
 * it up by, on a tab where nothing has been opened yet and the registry is therefore empty. Cache
 * first, the brain second, stopping at the first topic the predicate accepts; nothing is fetched
 * once one has been found.
 */
export async function ensureTopicMatching(
  match: (topic: Topic) => boolean,
): Promise<Topic | undefined> {
  const here = loadedTopics().find(match);
  if (here) return here;
  const world = loadWorld();
  if (!world?.level) return undefined;
  const { frameworkId, versionId, level } = world;
  const ops = cache.overlay(frameworkId, versionId) ?? [];
  const opts = versionId ? { versionId } : {};
  for (const subject of world.subjects) {
    if ((chaptersBySubject[subject] ?? []).length === 0) {
      let units = cache.units(frameworkId, versionId, level, subject);
      if (!units && curriculumReady()) {
        try {
          units = await curriculum().units(frameworkId, level, subject, opts);
          cache.putUnits(versionId, units);
        } catch {
          units = null;
        }
      }
      if (units && units.units.length > 0) {
        ingestUnits(
          ops.length > 0 ? { ...units, units: applyOverlayOps(units.units, ops).nodes } : units,
        );
      }
    }
    for (const chapter of chaptersBySubject[subject] ?? []) {
      if (chapter.topics.length > 0) {
        const already = chapter.topics.find(match);
        if (already) return already;
        continue;
      }
      let topics = cache.topics(frameworkId, versionId, chapter.id);
      if (!topics && curriculumReady()) {
        try {
          topics = await curriculum().topics(frameworkId, chapter.id, opts);
          cache.putTopics(versionId, topics);
        } catch {
          topics = null;
        }
      }
      if (topics) {
        ingestTopics(
          ops.length > 0
            ? { ...topics, topics: applyOverlayOps(topics.topics, ops).nodes }
            : topics,
        );
      }
      const hit = loadedTopics().find(match);
      if (hit) return hit;
    }
  }
  return loadedTopics().find(match);
}
