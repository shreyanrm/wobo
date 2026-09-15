/**
 * The client's curriculum layer: the type-ahead, the learner's world, the in-memory registry, the
 * offline cache, and the home thread built on top of them.
 *
 * The through-line of every case here is the law that the audit caught us breaking — no syllabus
 * without a source (CURRICULUM.md §12). So most of these tests are about what does NOT appear: no
 * default board, no default class, no subject list standing in for one we have not fetched, no
 * chapter cached from a "still looking" answer, and no topic on the home thread that the brain did
 * not serve for this learner's own framework.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// A localStorage the module under test can actually use — Bun has none, and the whole point of
// several of these cases is what is and is not written to it.
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
}
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: Storage }).localStorage = storage as unknown as Storage;

const { createSearchRunner, countryHint, IDLE_SEARCH, notListedMessage } = await import(
  '../src/curriculum/search'
);
const { loadWorld, saveWorld, resetWorldCache, schoolLevels, worldFrom, gradeOf } = await import(
  '../src/curriculum/world'
);
const {
  chaptersBySubject,
  displaySubjects,
  ingestTopics,
  ingestUnits,
  loadedTopics,
  subjects,
  topicById,
  chapterById,
  resetRegistry,
} = await import('../src/curriculum/registry');
const { cache } = await import('../src/curriculum/cache');
const { subjectFamily, canonicalSubjectId } = await import('../src/curriculum/subjects');
const { deriveStops } = await import('../src/screens/home/stops');

import type { CurriculumFramework, CurriculumNode, CurriculumUnitsView } from '@wobo/sdk';

// --- a controllable clock for the debounce -------------------------------------------------------

function fakeTimer() {
  const queue = new Map<number, () => void>();
  let next = 1;
  return {
    timer: {
      set(fn: () => void, _ms: number) {
        const handle = next++;
        queue.set(handle, fn);
        return handle;
      },
      clear(handle: number) {
        queue.delete(handle);
      },
    },
    /** Fire every timer currently waiting. */
    tick() {
      const due = [...queue.entries()];
      queue.clear();
      for (const [, fn] of due) fn();
    },
    pending: () => queue.size,
  };
}

const result = (query: string, ids: string[]) => ({
  query,
  country: null,
  results: ids.map((id) => ({
    id,
    name: id.toUpperCase(),
    kind: 'national' as const,
    status: 'verified' as const,
    aliases: [],
    country: null,
    region: null,
    languages: [],
    levels: [],
    officialSite: null,
    personal: false,
    label: `Official ${id.toUpperCase()}, verified`,
  })),
  notListed: { message: 'Not listed? Tell me and I will look.', query },
});

describe('the board type-ahead', () => {
  test('waits for a pause before asking, then asks once', async () => {
    const clock = fakeTimer();
    const search = mock(async (q: string) => result(q, ['cbse']));
    const states: string[] = [];
    const runner = createSearchRunner({
      search,
      onState: (s) => states.push(s.status),
      timer: clock.timer,
    });

    runner.query('c');
    runner.query('cb');
    runner.query('cbs');
    expect(search).not.toHaveBeenCalled();
    expect(states).toEqual(['typing', 'typing', 'typing']);

    clock.tick();
    await Promise.resolve();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).toBe('cbs');
  });

  test('a slow early answer never overwrites a fast later one', async () => {
    const clock = fakeTimer();
    const gate: { release: ((v: unknown) => void) | null } = { release: null };
    const search = mock((q: string) =>
      q === 'ic'
        ? new Promise((resolve) => {
            gate.release = resolve;
          }).then(() => result(q, ['icse']))
        : Promise.resolve(result(q, ['cbse'])),
    );
    let latest = IDLE_SEARCH;
    const runner = createSearchRunner({
      search: search as (q: string) => Promise<ReturnType<typeof result>>,
      onState: (s) => {
        latest = s;
      },
      timer: clock.timer,
    });

    runner.query('ic');
    clock.tick(); // the slow one is in flight
    runner.query('cb');
    clock.tick(); // the fast one answers first
    await Promise.resolve();
    expect(latest.result?.results.map((r) => r.id)).toEqual(['cbse']);

    gate.release?.(null);
    await Promise.resolve();
    await Promise.resolve();
    // The stale answer is dropped rather than replacing what the learner is looking at.
    expect(latest.result?.results.map((r) => r.id)).toEqual(['cbse']);
  });

  test('emptying the box clears the results and asks nothing', () => {
    const clock = fakeTimer();
    const search = mock(async (q: string) => result(q, ['cbse']));
    let latest = IDLE_SEARCH;
    const runner = createSearchRunner({
      search,
      onState: (s) => {
        latest = s;
      },
      timer: clock.timer,
    });
    runner.query('cbse');
    clock.tick();
    runner.query('   ');
    expect(latest).toEqual(IDLE_SEARCH);
    expect(clock.pending()).toBe(0);
    expect(search).toHaveBeenCalledTimes(1);
  });

  test('a registry that is down still leaves the door open', async () => {
    const clock = fakeTimer();
    let latest = IDLE_SEARCH;
    const runner = createSearchRunner({
      search: () => Promise.reject(new Error('offline')),
      onState: (s) => {
        latest = s;
      },
      timer: clock.timer,
    });
    runner.query('cbse');
    clock.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(latest.status).toBe('failed');
    expect(latest.error).toBeTruthy();
    // §3: not listed? tell me — present even when nothing answered.
    expect(notListedMessage(latest).length).toBeGreaterThan(0);
  });

  test('flush asks straight away — the Enter key', async () => {
    const clock = fakeTimer();
    const search = mock(async (q: string) => result(q, ['cbse']));
    const runner = createSearchRunner({ search, onState: () => {}, timer: clock.timer });
    runner.query('cbse');
    runner.flush();
    await Promise.resolve();
    expect(search).toHaveBeenCalledTimes(1);
    expect(clock.pending()).toBe(0);
  });

  test('the country is a hint read from the locale, never a filter', () => {
    expect(countryHint(['en-IN'])).toBe('IN');
    expect(countryHint(['en_GB'])).toBe('GB');
    expect(countryHint(['xx'])).toBeNull();
    expect(countryHint([])).toBeNull();
  });
});

// --- the world ------------------------------------------------------------------------------------

const framework: CurriculumFramework = {
  id: 'cbse',
  name: 'CBSE',
  kind: 'national',
  status: 'verified',
  aliases: [],
  country: 'IN',
  region: null,
  languages: ['en'],
  levels: ['Class 3', 'Class 8', 'Class 12', 'Class 14'],
  officialSite: null,
  personal: false,
  label: 'Official CBSE 2026-27, verified',
};

describe('the learner’s world', () => {
  beforeEach(() => {
    storage.clear();
    resetWorldCache();
    resetRegistry();
  });

  test('an untouched device has no world at all — never a default board', () => {
    expect(loadWorld()).toBeNull();
  });

  test('grades 4 to 13, school level only', () => {
    expect(schoolLevels(framework.levels)).toEqual(['Class 8', 'Class 12']);
    // A stage with no number in its name is the framework's own business, and is kept.
    expect(schoolLevels(['IGCSE', 'Lower Secondary'])).toEqual(['IGCSE', 'Lower Secondary']);
    expect(gradeOf('Year 11')).toBe(11);
    expect(gradeOf('IGCSE')).toBeNull();
  });

  test('a world is built from what the brain said, and survives a reload', () => {
    saveWorld(
      worldFrom(framework, {
        version: { id: 'v1', name: '2026-27', status: 'verified', year: '2026-27' },
        level: 'Class 8',
        levels: ['Class 8'],
        subjects: ['Mathematics', 'Science'],
      }),
    );
    resetWorldCache();
    const world = loadWorld();
    expect(world).toMatchObject({
      frameworkId: 'cbse',
      frameworkName: 'CBSE',
      versionId: 'v1',
      versionYear: '2026-27',
      level: 'Class 8',
      subjects: ['Mathematics', 'Science'],
      personal: false,
    });
  });

  test('a half-written world reads as no world rather than a broken one', () => {
    storage.setItem('wobo-curriculum-world-v1', JSON.stringify({ level: 'Class 8' }));
    resetWorldCache();
    expect(loadWorld()).toBeNull();
  });

  test('a personal syllabus stays marked personal', () => {
    const own = worldFrom(
      {
        ...framework,
        id: 'own:1',
        name: 'My school',
        kind: 'personal',
        status: 'personal',
        personal: true,
        label: 'Drafted from your syllabus, check it',
      },
      { level: 'Class 8' },
    );
    expect(own.personal).toBe(true);
    expect(own.label).toBe('Drafted from your syllabus, check it');
  });
});

// --- the registry ------------------------------------------------------------------------------------

const unit = (id: string, name: string, order: number): CurriculumNode => ({
  id,
  kind: 'unit',
  name,
  parentId: 'subject-1',
  order,
  aliases: [],
  sourceRef: { url: 'https://cbse.test/syllabus.pdf', page: 4, section: null },
  conceptIds: [],
  own: false,
  notInMySchool: false,
  textbook: null,
  renamedFrom: null,
  source: null,
  checksPassed: [],
  verifiedAt: null,
  objectives: [],
});

const readyUnits: CurriculumUnitsView = {
  frameworkId: 'cbse',
  level: 'Class 8',
  subject: 'Mathematics',
  status: 'ready',
  subjectId: 'subject-1',
  units: [unit('u1', 'Rational numbers', 0), unit('u2', 'Linear equations', 1)],
  placeholder: null,
  plan: null,
  jobId: null,
  waitMs: 0,
  label: 'Official CBSE 2026-27, verified',
  notListed: null,
};

function pinWorld() {
  saveWorld(
    worldFrom(framework, {
      version: { id: 'v1', name: '2026-27', status: 'verified', year: '2026-27' },
      level: 'Class 8',
      levels: ['Class 8'],
      subjects: ['Mathematics'],
    }),
  );
}

describe('the in-memory registry invents nothing', () => {
  beforeEach(() => {
    storage.clear();
    resetWorldCache();
    resetRegistry();
  });

  test('with no world there are no subjects, no chapters and no topics', () => {
    expect(subjects.length).toBe(0);
    expect(displaySubjects()).toEqual([]);
    expect(chaptersBySubject.Mathematics).toBeUndefined();
    expect(topicById('m2-1')).toBeUndefined();
    expect(loadedTopics()).toEqual([]);
  });

  test('a world names its subjects in the framework’s own words, and nothing more', () => {
    pinWorld();
    expect(displaySubjects().map((d) => d.name)).toEqual(['Mathematics']);
    // The subjects are named, but no chapter exists until the subject is opened.
    expect(chaptersBySubject.Mathematics).toBeUndefined();
  });

  test('a "still looking" answer is a status, not a syllabus', () => {
    pinWorld();
    ingestUnits({
      ...readyUnits,
      status: 'looking',
      units: [],
      placeholder: { jobId: 'j1', state: 'searching', open: true, message: 'Looking' },
    });
    expect(chaptersBySubject.Mathematics).toBeUndefined();
    expect(loadedTopics()).toEqual([]);
  });

  test('a ready answer becomes chapters, in the board’s own order, keeping the brain’s ids', () => {
    pinWorld();
    ingestUnits(readyUnits);
    expect((chaptersBySubject.Mathematics ?? []).map((c) => c.name)).toEqual([
      'Rational numbers',
      'Linear equations',
    ]);
    expect(chapterById('u1')?.index).toBe(1);
    // Topics only exist once the chapter is opened.
    expect(chapterById('u1')?.topics).toEqual([]);
    expect(loadedTopics()).toEqual([]);
  });

  test('topics arrive on opening a chapter, and carry no prerequisites the client made up', () => {
    pinWorld();
    ingestUnits(readyUnits);
    ingestTopics({
      frameworkId: 'cbse',
      unit: { id: 'u1', name: 'Rational numbers', order: 0 },
      topics: [
        {
          ...unit('t1', 'Closure', 0),
          kind: 'topic',
          parentId: 'u1',
          conceptIds: ['c-closure'],
          objectives: [{ id: null, name: 'State the closure property' }],
        },
      ],
    });
    const topic = topicById('t1');
    expect(topic?.name).toBe('Closure');
    expect(topic?.chapterId).toBe('u1');
    // The blurb is the framework's own objective, not a sentence we wrote.
    expect(topic?.blurb).toBe('State the closure property');
    expect(topic?.prereqTopicIds).toEqual([]);
    expect(topic?.nodeId).toBe('c-closure');
    expect(loadedTopics().map((t) => t.id)).toEqual(['t1']);
  });

  test('changing world empties the previous world’s chapters', () => {
    pinWorld();
    ingestUnits(readyUnits);
    expect(chaptersBySubject.Mathematics).toBeDefined();
    saveWorld(
      worldFrom(
        { ...framework, id: 'icse', name: 'ICSE' },
        { level: 'Class 8', subjects: ['Mathematics'] },
      ),
    );
    expect(chaptersBySubject.Mathematics).toBeUndefined();
    expect(topicById('t1')).toBeUndefined();
  });
});

describe('the offline cache holds only what was actually published', () => {
  beforeEach(() => {
    storage.clear();
    resetWorldCache();
    cache.clear();
  });

  test('a ready answer round-trips', () => {
    cache.putUnits('v1', readyUnits);
    expect(cache.units('cbse', 'v1', 'Class 8', 'Mathematics')?.units).toHaveLength(2);
  });

  test('a "looking" answer is never written', () => {
    cache.putUnits('v1', { ...readyUnits, status: 'looking', units: [] });
    expect(cache.units('cbse', 'v1', 'Class 8', 'Mathematics')).toBeNull();
  });

  test('a new version misses rather than serving last year’s chapters', () => {
    cache.putUnits('v1', readyUnits);
    expect(cache.units('cbse', 'v2', 'Class 8', 'Mathematics')).toBeNull();
  });

  test('forgetting a framework clears it', () => {
    cache.putUnits('v1', readyUnits);
    cache.forget('cbse');
    expect(cache.units('cbse', 'v1', 'Class 8', 'Mathematics')).toBeNull();
  });
});

// --- the home thread --------------------------------------------------------------------------------

const progress = { completed: new Set<string>(), topicProgress: {}, streakDays: 1 };

describe('the home thread never invents a syllabus', () => {
  beforeEach(() => {
    storage.clear();
    resetWorldCache();
    resetRegistry();
  });

  test('an empty world is the warm-up plus exactly one honest door', () => {
    const { stops } = deriveStops(progress);
    expect(stops.map((s) => s.kind)).toEqual(['landing', 'empty']);
    expect(stops[1]?.title).toBe('Tell me your board');
    // The bug this replaces: a course stop for a topic nobody chose.
    expect(stops.some((s) => s.route.name === 'course')).toBe(false);
  });

  test('a chosen world with nothing opened yet points at the subjects, not at a topic', () => {
    pinWorld();
    const { stops } = deriveStops(progress);
    expect(stops.map((s) => s.kind)).toEqual(['landing', 'empty']);
    expect(stops[1]?.route).toEqual({ name: 'learn' });
    expect(stops.some((s) => s.route.name === 'course')).toBe(false);
  });

  test('once the learner’s own chapters are open, the thread is built from those and only those', () => {
    pinWorld();
    ingestUnits(readyUnits);
    ingestTopics({
      frameworkId: 'cbse',
      unit: { id: 'u1', name: 'Rational numbers', order: 0 },
      topics: [{ ...unit('t1', 'Closure', 0), kind: 'topic', parentId: 'u1' }],
    });
    const { stops } = deriveStops(progress);
    const next = stops.find((s) => s.kind === 'next');
    expect(next?.title).toBe('Closure');
    // Every course stop names a topic the brain served for this learner's own framework.
    for (const stop of stops)
      if (stop.route.name === 'course') expect(topicById(stop.route.topicId)).toBeDefined();
  });

  test('progress in a topic from another world is not resurrected as a stop', () => {
    pinWorld();
    ingestUnits(readyUnits);
    const { stops } = deriveStops({
      completed: new Set(['m2-1']),
      topicProgress: { 'm2-1': 0.5 },
      streakDays: 3,
    });
    expect(stops.some((s) => s.title === 'm2-1')).toBe(false);
    expect(stops.some((s) => s.route.name === 'course')).toBe(false);
  });
});

describe('subject families are presentation only', () => {
  test('a board’s own naming resolves to the family that draws it', () => {
    expect(subjectFamily('Mathematics')).toBe('math');
    expect(subjectFamily('Physical Science')).toBe('physics');
    expect(subjectFamily('History, Civics and Geography')).toBe('social');
    expect(subjectFamily('Science')).toBe('science');
    expect(subjectFamily('Computer Applications')).toBe('cs');
  });

  test('a subject we do not recognise keeps its own name', () => {
    expect(subjectFamily('Sanskrit')).toBe('general');
    expect(canonicalSubjectId('Sanskrit')).toBe('Sanskrit');
  });
});

// --- the learner's own edits reach the screen ------------------------------------------------------
//
// Two bugs lived here, and both looked the same from the outside: a learner taps "remove" on a
// chapter and the chapter stays on the page until they reload. §6 says the overlay is what the
// learner sees, so a stored edit that the screen does not show is the feature not working.

const { applyOverlayOps, overlayOps } = await import('@wobo/sdk');

describe('an edit the learner makes is the list the learner sees', () => {
  beforeEach(() => {
    storage.clear();
    resetWorldCache();
    resetRegistry();
  });

  test('the registry holds the overlaid list, not the board’s raw one', () => {
    pinWorld();
    // What `useUnits` now ingests: the brain's answer with the learner's overlay already on it.
    const removed = applyOverlayOps(readyUnits.units, [overlayOps.remove('u2')]).nodes;
    ingestUnits({ ...readyUnits, units: removed });
    expect(chaptersBySubject.Mathematics?.map((c) => c.name)).toEqual(['Rational numbers']);
  });

  test('ingesting the board’s raw list would put the removed chapter back', () => {
    pinWorld();
    ingestUnits(readyUnits);
    // The regression, stated: this is what the screen showed before, and why it looked broken.
    expect(chaptersBySubject.Mathematics?.map((c) => c.name)).toEqual([
      'Rational numbers',
      'Linear equations',
    ]);
  });

  test('a chapter the learner renames keeps its id, so progress survives the edit', () => {
    pinWorld();
    const renamed = applyOverlayOps(readyUnits.units, [
      overlayOps.rename('u2', 'Equations, as my school calls them'),
    ]).nodes;
    ingestUnits({ ...readyUnits, units: renamed });
    const chapters = chaptersBySubject.Mathematics ?? [];
    expect(chapters.map((c) => c.name)).toEqual([
      'Rational numbers',
      'Equations, as my school calls them',
    ]);
    expect(chapters.map((c) => c.id)).toEqual(['u1', 'u2']);
    expect(chapterById('u2')?.name).toBe('Equations, as my school calls them');
  });

  test('a chapter the learner adds is theirs and sits with the board’s', () => {
    pinWorld();
    const added = applyOverlayOps(readyUnits.units, [
      overlayOps.add('subject-1', 'unit', 'A chapter my school adds'),
    ]).nodes;
    ingestUnits({ ...readyUnits, units: added });
    expect(chaptersBySubject.Mathematics?.map((c) => c.name)).toContain('A chapter my school adds');
  });
});
