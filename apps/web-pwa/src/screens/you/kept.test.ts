import { beforeEach, describe, expect, it } from 'bun:test';
import type { CurriculumTopicsView } from '@wobo/sdk';

/** A localStorage stand-in, installed before the stores that read it are imported. */
const map = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  get length() {
    return map.size;
  },
  key: (i: number) => [...map.keys()][i] ?? null,
  getItem: (k: string) => map.get(k) ?? null,
  setItem: (k: string, v: string) => void map.set(k, String(v)),
  removeItem: (k: string) => void map.delete(k),
  clear: () => map.clear(),
};

const { cache } = await import('../../curriculum/cache');
const { SCOPED_KEYS, scoped } = await import('../../store/scope');
const { heldTopics, KEPT_KEY, keepBoard, keptExcept, keptMark, loadKept } = await import('./kept');

const page = (frameworkId: string, unit: string, topics: [string, string][]) =>
  ({
    frameworkId,
    unit: { id: unit, name: unit, order: 0 },
    topics: topics.map(([id, name]) => ({ id, name })),
  }) as unknown as CurriculumTopicsView;

beforeEach(() => {
  scoped.removeItem(KEPT_KEY);
  cache.clear();
});

describe('what a learner did on the board they leave', () => {
  it('keeps what they finished and what they started, by name, and nothing they never opened', () => {
    const got = heldTopics(
      [
        page('cbse', 'u1', [
          ['t1', 'Integers'],
          ['t2', 'Fractions'],
          ['t3', 'Decimals'],
        ]),
      ],
      new Set(['t1']),
      { t2: 0.4, t3: 0 },
    );
    expect(got).toEqual([
      { id: 't1', name: 'Integers', done: true },
      { id: 't2', name: 'Fractions', done: false },
    ]);
  });

  it('reads the names off the cache before the cache is dropped, and the record outlives it', () => {
    cache.putTopics(null, page('cbse', 'u1', [['t1', 'Integers']]));
    cache.putTopics(null, page('icse', 'u9', [['x1', 'Sets']]));
    const views = cache.topicsOf('cbse');
    expect(views.map((v) => v.frameworkId)).toEqual(['cbse']);

    keepBoard({
      boardId: 'cbse',
      boardName: 'CBSE',
      at: '2026-09-17T00:00:00Z',
      topics: heldTopics(views, new Set(['t1']), {}),
    });
    cache.forget('cbse');
    expect(cache.topicsOf('cbse')).toEqual([]);
    expect(loadKept()[0]?.topics[0]?.name).toBe('Integers');
  });

  it('writes nothing for a board with nothing done, and merges a board left twice', () => {
    expect(keepBoard({ boardId: 'ib', boardName: 'IB', at: 'x', topics: [] })).toEqual([]);
    keepBoard({
      boardId: 'cbse',
      boardName: 'CBSE',
      at: 'a',
      topics: [{ id: 't1', name: 'A', done: true }],
    });
    const two = keepBoard({
      boardId: 'cbse',
      boardName: 'CBSE',
      at: 'b',
      topics: [{ id: 't2', name: 'B', done: false }],
    });
    expect(two).toHaveLength(1);
    expect(two[0]?.at).toBe('b');
    expect(two[0]?.topics.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('shows every board but the one they are on, marked with where it came from', () => {
    const rows = [
      { boardId: 'cbse', boardName: 'CBSE', at: 'a', topics: [{ id: 't', name: 'A', done: true }] },
      { boardId: 'icse', boardName: 'ICSE', at: 'b', topics: [{ id: 'u', name: 'B', done: true }] },
    ];
    expect(keptExcept(rows, 'cbse').map((r) => r.boardId)).toEqual(['icse']);
    expect(keptMark('CBSE')).toBe('From CBSE');
  });

  it("is the learner's own: it moves with them and leaves with them", () => {
    expect([...SCOPED_KEYS]).toContain(KEPT_KEY);
  });

  it('survives a record it cannot read', () => {
    scoped.setItem(KEPT_KEY, '{not json');
    expect(loadKept()).toEqual([]);
  });
});
