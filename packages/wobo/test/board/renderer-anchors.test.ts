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

/**
 * THE TWO MECHANISMS ARE ONE LAW EACH, AND EACH IS HELD ON ITS OWN (wave 52).
 *
 * The close above was re-measured and holds on the glass, but the suite only caught the two
 * mechanisms TOGETHER: with `dependencyOrder` taken out of `buildObjects` the whole package
 * stayed green, and with the second pass taken out it stayed green too, because either one alone
 * still rescues a one-deep label. A close that no single test holds is a close a refactor can
 * undo without turning anything red, and wave 48's defect comes back the moment the survivor is
 * weakened as well. So: one test per mechanism, each red when only its own mechanism is removed.
 *
 * The division of labour they pin is the design itself — DEPTH is the ordering's job, and the
 * second pass is only ever for a cycle:
 *   · dependency order settles a chain of any depth in ONE sweep;
 *   · the second pass, bounded at two, is for the one edge a cycle forces the order to break.
 */
describe('each half of the build order is load-bearing on its own', () => {
  it('settles a chain of any depth in one sweep — depth is the ORDERING’s job', () => {
    // A label on a leader on a bracket on a rim on the cell body, every one of them beaten before
    // the thing it hangs off. Two sweeps of healing reach two levels; the chain is four deep, so
    // without the ordering the last two are lost exactly as the plant cell's were.
    const store = new BoardStore({ presentation: 'plane' });
    const chain: BoardObject[] = [];
    for (let i = 2; i <= 5; i += 1) {
      chain.push({
        id: `l${i}`,
        kind: 'label',
        anchor: { object: `l${i - 1}` },
        text: `part ${i}`,
      } as BoardObject);
    }
    for (const o of [...chain].reverse()) store.ink(o);
    store.ink({ id: 'l1', kind: 'ellipse', anchor: { board: [400, 300] }, rx: 90, ry: 60 } as BoardObject);
    expect(build(store).filter((b) => !b.geometry).map((b) => b.state.object.id)).toEqual([]);
  });

  it('heals the half of a cycle that CAN resolve — the SECOND PASS’s job', () => {
    // An arrow that starts at a note, and a note that hangs off the arrow. No order can build both
    // second, so the order breaks the arrow's edge: the note is built first and comes back empty,
    // the arrow lands on its own board point, and the pass that follows is what puts the note on
    // the glass. Without that pass the note is not late, it is never drawn.
    const store = makeStore([
      {
        id: 'arr',
        kind: 'arrow',
        anchor: { board: [500, 300] },
        from: { object: 'note' },
      } as BoardObject,
      { id: 'note', kind: 'label', anchor: { object: 'arr' }, text: 'this way' } as BoardObject,
    ]);
    expect(build(store).find((b) => b.state.object.id === 'note')?.geometry).not.toBeNull();
  });

  it('carries the whole tail hanging off a healed cycle, within the two sweeps', () => {
    // The bound of two is only honest if a heal cascades WITHIN a sweep: the tail hanging off the
    // note must land in the same sweep the note does, however long it is.
    const store = makeStore([
      {
        id: 'arr',
        kind: 'arrow',
        anchor: { board: [500, 300] },
        from: { object: 'note' },
      } as BoardObject,
      { id: 'note', kind: 'label', anchor: { object: 'arr' }, text: 'this way' } as BoardObject,
      { id: 'tail1', kind: 'label', anchor: { object: 'note' }, text: 'and then' } as BoardObject,
      { id: 'tail2', kind: 'label', anchor: { object: 'tail1' }, text: 'and then' } as BoardObject,
    ]);
    expect(build(store).filter((b) => !b.geometry).map((b) => b.state.object.id)).toEqual([]);
  });
});
