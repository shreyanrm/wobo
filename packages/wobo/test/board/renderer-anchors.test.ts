import { describe, expect, it } from 'bun:test';
import { frameOf } from '../../src/board/anchors';
import {
  buildObjects,
  dependencyOrder,
  liveObjectIds,
  objectDependencies,
  type CacheEntry,
} from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';
import { BoardStore } from '../../src/board/store';

/**
 * THE MARK ANCHORED TO A MARK NOT YET DRAWN (the adversary, wave 48, findings 1 and 2).
 *
 * The gateway beats a plant-cell label at 4538 ms and the leader it hangs off at 10 323 ms. The
 * client's build used to walk the store in arrival order and resolve an `{object: …}` anchor only
 * against boxes filled EARLIER in the same pass, then cache the empty result under the signature
 * `gone|zoom` — a signature that can never change, because the anchor is always built after it.
 * The label was therefore lost for ever: a five-label ask rendered three labels and two arrows
 * pointing at empty space.
 */

const frame = frameOf({ x: 0, y: 0, width: 1440, height: 900 });

function makeStore(objects: BoardObject[]): BoardStore {
  const store = new BoardStore({ presentation: 'plane' });
  for (const o of objects) store.ink(o);
  return store;
}

function build(store: BoardStore, cache = new Map<string, CacheEntry>()) {
  return buildObjects(store.snapshot(), {
    frame,
    font: null,
    store,
    cache,
    targets: () => [],
    focus: () => [],
    boxes: new Map(),
    occupied: [],
  });
}

const leader: BoardObject = {
  id: 'b0_14leader',
  kind: 'ellipse',
  anchor: { board: [400, 300] },
  rx: 60,
  ry: 40,
} as BoardObject;

const label: BoardObject = {
  id: 'b0_15part',
  kind: 'label',
  anchor: { object: 'b0_14leader' },
  text: 'vacuole',
} as BoardObject;

describe('every mark is built after the mark it hangs off', () => {
  it('names an object anchor as a dependency', () => {
    const store = makeStore([leader, label]);
    const state = store.get('b0_15part')!;
    expect(objectDependencies(state, store)).toEqual(['b0_14leader']);
  });

  it('names an arrow’s `from`, a line’s `to` and an erase’s subject as dependencies too', () => {
    const store = makeStore([
      leader,
      {
        id: 'arr',
        kind: 'arrow',
        anchor: { object: 'b0_14leader' },
        from: { object: 'tail' },
      } as BoardObject,
      { id: 'ln', kind: 'line', anchor: { board: [0, 0] }, to: { object: 'far' } } as BoardObject,
      { id: 'er', kind: 'erase', anchor: { board: [0, 0] }, object: 'gone' } as BoardObject,
    ]);
    expect(objectDependencies(store.get('arr')!, store).sort()).toEqual(['b0_14leader', 'tail']);
    expect(objectDependencies(store.get('ln')!, store)).toEqual(['far']);
    expect(objectDependencies(store.get('er')!, store)).toEqual(['gone']);
  });

  it('orders a dependant after its anchor however they were beaten', () => {
    const store = makeStore([label, leader]);
    const order = dependencyOrder(store.snapshot(), store).map((s) => s.object.id);
    expect(order).toEqual(['b0_14leader', 'b0_15part']);
  });

  it('keeps arrival order between marks that do not depend on each other', () => {
    const store = makeStore([
      { id: 'a', kind: 'point', anchor: { board: [10, 10] } } as BoardObject,
      { id: 'b', kind: 'point', anchor: { board: [20, 20] } } as BoardObject,
    ]);
    expect(dependencyOrder(store.snapshot(), store).map((s) => s.object.id)).toEqual(['a', 'b']);
  });

  it('terminates on a cycle rather than dropping either mark', () => {
    const store = makeStore([
      { id: 'x', kind: 'label', anchor: { object: 'y' }, text: 'x' } as BoardObject,
      { id: 'y', kind: 'label', anchor: { object: 'x' }, text: 'y' } as BoardObject,
    ]);
    expect(dependencyOrder(store.snapshot(), store).map((s) => s.object.id).sort()).toEqual([
      'x',
      'y',
    ]);
  });

  it('DRAWS a label beaten before the leader it hangs off, in one pass', () => {
    const store = makeStore([label, leader]);
    const built = build(store);
    const lab = built.find((b) => b.state.object.id === 'b0_15part');
    expect(lab?.geometry).not.toBeNull();
  });

  it('returns the marks in store order, so z-order is arrival order', () => {
    const store = makeStore([label, leader]);
    expect(build(store).map((b) => b.state.object.id)).toEqual(['b0_15part', 'b0_14leader']);
  });

  it('DRAWS the label on the pass after the leader arrives, not never', () => {
    // The real wire: the label is beaten seconds before its leader, so the first build has nothing
    // to hang it off. It must land the moment the leader does.
    const cache = new Map<string, CacheEntry>();
    const store = makeStore([label]);
    expect(build(store, cache).find((b) => b.state.object.id === 'b0_15part')?.geometry).toBeNull();
    store.ink(leader);
    const lab = build(store, cache).find((b) => b.state.object.id === 'b0_15part');
    expect(lab?.geometry).not.toBeNull();
  });

  it('never caches an empty geometry under a signature that cannot change', () => {
    const cache = new Map<string, CacheEntry>();
    build(makeStore([label]), cache);
    expect(cache.get('b0_15part')).toBeUndefined();
  });
});

describe('what moves with the page moves with the page, whenever it was beaten', () => {
  it('carries a mark that hangs off a screen-anchored mark beaten AFTER it', () => {
    const store = makeStore([
      { id: 'lab', kind: 'label', anchor: { object: 'ring' }, text: 'here' } as BoardObject,
      { id: 'ring', kind: 'circle', anchor: { target: 't1' } } as BoardObject,
    ]);
    const live = liveObjectIds(store.snapshot(), store);
    expect(live.has('ring')).toBe(true);
    expect(live.has('lab')).toBe(true);
  });

  it('follows the dependency through an arrow’s `from`', () => {
    const store = makeStore([
      { id: 'arr', kind: 'arrow', anchor: { board: [0, 0] }, from: { object: 'ring' } } as BoardObject,
      { id: 'ring', kind: 'circle', anchor: { target: 't1' } } as BoardObject,
    ]);
    expect(liveObjectIds(store.snapshot(), store).has('arr')).toBe(true);
  });
});
