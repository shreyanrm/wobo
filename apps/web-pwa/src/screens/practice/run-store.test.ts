/**
 * The practice door keeps what a learner did on it (learn-4). Position, the marks on every item and
 * what `check` said are written through the learner's own scope the moment they change, and read
 * back on the next mount: a tap on Home, a reload, a bookmark. Nothing here is a course, so it is
 * not the course position store; it is its own key, on SCOPED_KEYS so it leaves with the learner.
 */

import { beforeEach, describe, expect, it } from 'bun:test';

class FakeStorage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const local = new FakeStorage();
(globalThis as { localStorage?: unknown }).localStorage = local;
(globalThis as { sessionStorage?: unknown }).sessionStorage = new FakeStorage();

const { SCOPED_KEYS, scoped } = await import('../../store/scope');
const { PRACTICE_KEY, practiceOnceKey, readRun, writeRun } = await import('./run-store');
const { BIGGER_THIRD_OR_QUARTER, FRACTIONS_SET } = await import('./set');
const { check, resetState } = await import('@wobo/wobo');

const SET = 'fractions';

function answeredSecond() {
  const states = FRACTIONS_SET.map(resetState);
  const results = FRACTIONS_SET.map(() => null as ReturnType<typeof check> | null);
  const spec = BIGGER_THIRD_OR_QUARTER;
  const state = { ...resetState(spec), kind: 'choose_visual' as const, selected: ['third'] };
  states[1] = state;
  results[1] = check(spec, state);
  return { pos: 1, states, results, earned: ['bigger-third-or-quarter'] };
}

describe('the practice run survives leaving the screen', () => {
  beforeEach(() => local.clear());

  it('starts empty', () => {
    expect(readRun(SET, FRACTIONS_SET)).toBeNull();
  });

  it('reads back exactly what was written: the place, the marks, and what check said', () => {
    const run = answeredSecond();
    writeRun(SET, run);
    const back = readRun(SET, FRACTIONS_SET);
    expect(back).not.toBeNull();
    expect(back?.pos).toBe(1);
    expect(back?.results[1]?.correct).toBe(true);
    expect(back?.states[1]).toEqual(run.states[1]);
    expect(back?.results.filter((r) => r?.correct).length).toBe(1);
    expect(back?.earned).toEqual(['bigger-third-or-quarter']);
  });

  it('is the learner’s own: written under the scoped store, on the list forget-me sweeps', () => {
    writeRun(SET, answeredSecond());
    expect(scoped.getItem(PRACTICE_KEY)).not.toBeNull();
    expect(SCOPED_KEYS as readonly string[]).toContain(PRACTICE_KEY);
  });

  it('refuses a run that does not fit the set it is asked for', () => {
    writeRun(SET, answeredSecond());
    expect(readRun('another-set', FRACTIONS_SET)).toBeNull();
    // a set of a different length is not this run
    expect(readRun(SET, FRACTIONS_SET.slice(0, 2))).toBeNull();
  });

  it('treats a broken record as no record', () => {
    scoped.setItem(PRACTICE_KEY, '{not json');
    expect(readRun(SET, FRACTIONS_SET)).toBeNull();
    scoped.setItem(PRACTICE_KEY, JSON.stringify({ [SET]: { pos: 'x' } }));
    expect(readRun(SET, FRACTIONS_SET)).toBeNull();
  });

  it('names the once-key an item’s XP is granted under, so a re-run earns nothing twice', () => {
    expect(practiceOnceKey(SET, 'colour-half')).toBe('practice:fractions:colour-half');
  });
});
