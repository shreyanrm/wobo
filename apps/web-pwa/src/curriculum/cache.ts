/**
 * The offline cache of the pinned version (CURRICULUM.md §10).
 *
 * Only what the learner is actually pinned to is kept, and only what the brain served as `ready`:
 * a "still looking" answer is never written, so a plane ride can never turn a placeholder into a
 * syllabus. Entries are keyed by framework + version, so a version upgrade simply misses and
 * refetches rather than serving last year's chapters under this year's label.
 *
 * Storage is the learner's scope, so nothing of one learner is readable by the next.
 */

import type { CurriculumTopicsView, CurriculumUnitsView, OverlayOp } from '@wobo/sdk';
import { scoped } from '../store/scope';

const PREFIX = 'wobo-curriculum-v1';
/** A version is immutable, so a cached chapter list only ages out with the pin itself. */
const MAX_ENTRIES = 240;

const versionKey = (versionId: string | null) => versionId ?? 'pinned';

function unitsKey(frameworkId: string, versionId: string | null, level: string, subject: string) {
  return `${PREFIX}:units:${frameworkId}:${versionKey(versionId)}:${level}:${subject}`;
}
function topicsKey(frameworkId: string, versionId: string | null, unitId: string) {
  return `${PREFIX}:topics:${frameworkId}:${versionKey(versionId)}:${unitId}`;
}
function overlayKey(frameworkId: string, versionId: string | null) {
  return `${PREFIX}:overlay:${frameworkId}:${versionKey(versionId)}`;
}

/** The index of everything written, so a pin change can drop the previous version's rows. */
const INDEX_KEY = `${PREFIX}:index`;

function index(): string[] {
  try {
    const raw = scoped.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function remember(key: string): void {
  const keys = index().filter((k) => k !== key);
  keys.push(key);
  // Oldest first out, so the chapter a learner opened months ago yields to today's.
  while (keys.length > MAX_ENTRIES) {
    const gone = keys.shift();
    if (gone) scoped.removeItem(gone);
  }
  scoped.setItem(INDEX_KEY, JSON.stringify(keys));
}

function read<T>(key: string): T | null {
  try {
    const raw = scoped.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    scoped.setItem(key, JSON.stringify(value));
    remember(key);
  } catch {
    // storage full or denied — this session still has the answer in memory
  }
}

export const cache = {
  units(
    frameworkId: string,
    versionId: string | null,
    level: string,
    subject: string,
  ): CurriculumUnitsView | null {
    const view = read<CurriculumUnitsView>(unitsKey(frameworkId, versionId, level, subject));
    // A cached "looking" would be a syllabus we never had. Only ready answers are served back.
    return view?.status === 'ready' && view.units.length > 0 ? view : null;
  },

  putUnits(versionId: string | null, view: CurriculumUnitsView): void {
    if (view.status !== 'ready' || view.units.length === 0) return;
    write(unitsKey(view.frameworkId, versionId, view.level, view.subject), view);
  },

  topics(
    frameworkId: string,
    versionId: string | null,
    unitId: string,
  ): CurriculumTopicsView | null {
    return read<CurriculumTopicsView>(topicsKey(frameworkId, versionId, unitId));
  },

  putTopics(versionId: string | null, view: CurriculumTopicsView): void {
    if (view.topics.length === 0) return;
    write(topicsKey(view.frameworkId, versionId, view.unit.id), view);
  },

  overlay(frameworkId: string, versionId: string | null): OverlayOp[] | null {
    return read<OverlayOp[]>(overlayKey(frameworkId, versionId));
  },

  putOverlay(frameworkId: string, versionId: string | null, ops: OverlayOp[]): void {
    write(overlayKey(frameworkId, versionId), ops);
  },

  /**
   * Every topics page cached for a framework, whatever its version. Read by the board change
   * (`screens/you/kept.ts`) BEFORE `forget` drops them, so the names of what a learner did on
   * their old board are kept in their record rather than lost with the cache.
   */
  topicsOf(frameworkId: string): CurriculumTopicsView[] {
    const lead = `${PREFIX}:topics:${frameworkId}:`;
    return index()
      .filter((key) => key.startsWith(lead))
      .map((key) => read<CurriculumTopicsView>(key))
      .filter((view): view is CurriculumTopicsView => Boolean(view && Array.isArray(view.topics)));
  },

  /** Drop everything cached for a framework — used when the learner moves off a version. */
  forget(frameworkId: string, versionId?: string | null): void {
    const match = (key: string) =>
      key.startsWith(`${PREFIX}:`) &&
      key.includes(`:${frameworkId}:`) &&
      (versionId === undefined || key.includes(`:${versionKey(versionId)}:`));
    const keys = index();
    const kept: string[] = [];
    for (const key of keys) {
      if (match(key)) scoped.removeItem(key);
      else kept.push(key);
    }
    scoped.setItem(INDEX_KEY, JSON.stringify(kept));
  },

  /** Wipe the whole cache — "start over" on this device. */
  clear(): void {
    for (const key of index()) scoped.removeItem(key);
    scoped.removeItem(INDEX_KEY);
  },
};
