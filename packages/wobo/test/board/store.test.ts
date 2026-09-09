import { describe, expect, it } from 'bun:test';
import type { BoardEvent, BoardObject } from '../../src/board/schema';
import { BoardStore, MAX_LOG, restoreBoard, serializeBoard } from '../../src/board/store';

function clocked(presentation: 'screen' | 'plane' | 'full' = 'plane') {
  let t = 1000;
  const store = new BoardStore({ presentation, clock: () => t });
  return { store, tick: (ms: number) => (t += ms), at: () => t };
}

const circle = (id: string): BoardObject => ({ id, kind: 'circle', anchor: { target: 'btn' } });

describe('the board remembers what Wobo drew', () => {
  it('keeps objects in the order they were drawn', () => {
    const { store } = clocked();
    store.ink(circle('a'));
    store.ink(circle('b'));
    expect(store.snapshot().map((s) => s.object.id)).toEqual(['a', 'b']);
  });

  it('re-inking an id keeps its place in the order and bumps its generation', () => {
    const { store } = clocked();
    store.ink(circle('a'));
    store.ink(circle('b'));
    store.ink(circle('a'));
    expect(store.snapshot().map((s) => s.object.id)).toEqual(['a', 'b']);
    expect(store.get('a')?.generation).toBe(1);
  });

  it('a snapshot is stable until something changes — the renderer can bail out on it', () => {
    const { store } = clocked();
    store.ink(circle('a'));
    const first = store.snapshot();
    expect(store.snapshot()).toBe(first);
    store.ink(circle('b'));
    expect(store.snapshot()).not.toBe(first);
  });

  it('notifies its subscribers', () => {
    const { store } = clocked();
    let calls = 0;
    const off = store.subscribe(() => {
      calls++;
    });
    store.ink(circle('a'));
    expect(calls).toBe(1);
    off();
    store.ink(circle('b'));
    expect(calls).toBe(1);
  });
});

describe('the utterance clock', () => {
  it('times ink from the start of the utterance, not from when the frame arrived', () => {
    const { store, tick } = clocked();
    store.beginUtterance();
    tick(500); // the frame arrives late
    store.ink({ ...circle('a'), t: { start: 180, dur: 600 } });
    expect(store.get('a')?.startAt).toBe(1180);
    expect(store.get('a')?.durMs).toBe(600);
  });

  it('ink with no timing of its own lands now', () => {
    const { store, tick } = clocked();
    store.beginUtterance();
    tick(500);
    store.ink(circle('a'));
    expect(store.get('a')?.startAt).toBe(1500);
  });
});

describe('the law: a number the verifier never passed is not drawn', () => {
  it('refuses it and records the refusal', () => {
    const { store } = clocked();
    store.ink({
      id: 'n',
      kind: 'number',
      anchor: { board: [0, 0] },
      value: 42,
      verified: false,
    });
    expect(store.snapshot()).toHaveLength(0);
    expect(store.refused).toHaveLength(1);
  });

  it('draws a verified one', () => {
    const { store } = clocked();
    store.ink({ id: 'n', kind: 'number', anchor: { board: [0, 0] }, value: 42, verified: true });
    expect(store.snapshot()).toHaveLength(1);
    expect(store.refused).toHaveLength(0);
  });
});

describe('object memory — Wobo can come back to anything Wobo drew', () => {
  it('fades one by id', () => {
    const { store, at } = clocked();
    store.ink(circle('a'));
    store.ink({ id: 'a', kind: 'fade' });
    expect(store.get('a')?.fadingAt).toBe(at());
  });

  it('removes one by id', () => {
    const { store } = clocked();
    store.ink(circle('a'));
    store.ink({ id: 'a', kind: 'remove' });
    expect(store.snapshot()).toHaveLength(0);
    expect(store.history()).toHaveLength(1); // the timeline still has it
  });

  it('redraws one: the pen genuinely goes again', () => {
    const { store, tick } = clocked();
    store.ink(circle('a'));
    store.ink({ id: 'a', kind: 'fade' });
    tick(300);
    store.ink({ id: 'a', kind: 'redraw' });
    expect(store.get('a')?.generation).toBe(1);
    expect(store.get('a')?.fadingAt).toBeUndefined();
    expect(store.get('a')?.startAt).toBe(1300);
  });

  it('repoints one at something else without rewriting the object', () => {
    const { store } = clocked();
    store.ink(circle('a'));
    store.ink({ id: 'a', kind: 'repoint', anchor: { target: 'other' } });
    const state = store.get('a');
    expect(store.anchorOf(state as never)).toEqual({ target: 'other' });
    expect(state?.object.kind === 'circle' && state.object.anchor).toEqual({ target: 'btn' });
  });

  it('restyles one', () => {
    const { store } = clocked();
    store.ink(circle('a'));
    store.ink({ id: 'a', kind: 'restyle', style: { ink: 'accent', weight: 3 } });
    expect(store.styleOf(store.get('a') as never)).toEqual({ ink: 'accent', weight: 3 });
  });

  it('ignores a patch for an id that was never drawn', () => {
    const { store } = clocked();
    expect(() => store.ink({ id: 'ghost', kind: 'fade' })).not.toThrow();
    expect(store.snapshot()).toHaveLength(0);
  });
});

describe('erase and wipe', () => {
  it('an erase starts the target fading as the swipe crosses it', () => {
    const { store } = clocked();
    store.ink(circle('a'));
    store.ink({ id: 'e', kind: 'erase', anchor: { board: [0, 0] }, object: 'a', t: { dur: 400 } });
    expect(store.get('a')?.fadingAt).toBeGreaterThan(0);
  });

  it('a wipe takes the whole board with it, and is itself an object', () => {
    const { store } = clocked();
    store.ink(circle('a'));
    store.ink(circle('b'));
    store.ink({ id: 'w', kind: 'wipe' });
    expect(store.get('a')?.fadingAt).toBeGreaterThan(0);
    expect(store.get('b')?.fadingAt).toBeGreaterThan(0);
    expect(store.get('w')?.fadingAt).toBeUndefined();
  });
});

describe('the ttl each surface gives its ink', () => {
  it('screen ink holds until the conductor releases it; a board keeps what it holds', () => {
    // docs/INK-FREEZE-PLAN-TRACE.md §4: no six-second screen life while a question is open. The
    // conductor fades screen ink when the learner answers, interrupts, or the next turn begins.
    const screen = clocked('screen');
    screen.store.ink(circle('a'));
    expect(screen.store.get('a')?.ttl).toBeUndefined();

    const plane = clocked('plane');
    plane.store.ink(circle('a'));
    expect(plane.store.get('a')?.ttl).toBeUndefined();
  });

  it('an explicit ttl wins over the surface default', () => {
    const { store } = clocked('screen');
    store.ink({ ...circle('a'), t: { ttl: 1200 } });
    expect(store.get('a')?.ttl).toBe(1200);
  });
});

describe('the stream', () => {
  it('logs every event, and only ink reaches the board', () => {
    const { store } = clocked();
    const events: BoardEvent[] = [
      { type: 'say', text: 'here' },
      { type: 'ink', object: circle('a') },
      { type: 'ask', prompt: 'which one?', targets: ['a'] },
      { type: 'done' },
    ];
    for (const e of events) store.applyEvent(e);
    expect(store.log).toHaveLength(4);
    expect(store.snapshot()).toHaveLength(1);
    expect(store.pendingAsk?.prompt).toBe('which one?');
    expect(store.turnDone).toBe(true);
  });
});

describe('interrupt: the pen lifts where it is', () => {
  it('keeps what is drawn, drops what had not started, and names the object it was on', () => {
    const { store, tick } = clocked();
    store.beginUtterance();
    store.ink({ ...circle('a'), t: { start: 0, dur: 400 } });
    store.ink({ ...circle('b'), t: { start: 1000, dur: 400 } });
    tick(200);
    const at = store.interrupt();
    expect(at).toBe('a');
    expect(store.snapshot().map((s) => s.object.id)).toEqual(['a']);
  });
});

describe('the render budget virtualises old ink out of the DOM', () => {
  it('paints only the newest N, and keeps the rest', () => {
    const { store } = clocked();
    for (let i = 0; i < 30; i++) store.ink(circle(`o${i}`));
    expect(store.renderable(10)).toHaveLength(10);
    expect(store.renderable(10)[0]?.object.id).toBe('o20');
    expect(store.snapshot()).toHaveLength(30);
  });
});

describe('save to notes: objects, never pixels', () => {
  it('round-trips a board', () => {
    const { store } = clocked();
    store.ink(circle('a'));
    store.ink({ id: 'w', kind: 'write', anchor: { board: [0, 0] }, text: 'so c = 5' });
    const saved = serializeBoard(store);
    expect(saved.objects.map((o) => o.id)).toEqual(['a', 'w']);

    const fresh = new BoardStore({ presentation: 'plane' });
    restoreBoard(fresh, saved.objects);
    expect(fresh.snapshot().map((s) => s.object.id)).toEqual(['a', 'w']);
  });

  it('a fresh board forgets everything', () => {
    const { store } = clocked();
    store.ink(circle('a'));
    store.reset();
    expect(store.snapshot()).toHaveLength(0);
    expect(store.log).toHaveLength(0);
  });
});

/**
 * Nothing here may grow without a ceiling. The log holds whole point arrays and every turn adds to
 * it; two hundred turns of twenty objects left four thousand entries alive for the life of the tab.
 */
describe('what a long session costs', () => {
  it('caps the event log rather than keeping every turn of the session', () => {
    const { store } = clocked();
    for (let i = 0; i < MAX_LOG + 900; i++) {
      store.applyEvent({ type: 'say', text: `line ${i}`, t: 0 } as never);
    }
    expect(store.log.length).toBeLessThanOrEqual(MAX_LOG);
    // The newest is always kept: the scrubber looks backwards from now.
    const last = store.log[store.log.length - 1]?.event as { text?: string };
    expect(last.text).toBe(`line ${MAX_LOG + 899}`);
  });

  it('a fresh board forgets the log it can no longer reach', () => {
    const { store } = clocked();
    for (let turn = 0; turn < 60; turn++) {
      for (let i = 0; i < 100; i++) store.ink(circle(`t${turn}-${i}`));
      store.applyEvent({ type: 'done', t: 0 } as never);
      store.reset();
    }
    // Nothing is left over from the turns before: `reset` clears the objects AND the log, because
    // the timeline reads both and a log without its objects describes ink that no longer exists.
    expect(store.log).toHaveLength(0);
  });
});
