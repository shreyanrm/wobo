/**
 * The glass hold (docs/INK-FREEZE-PLAN-TRACE.md §3): held for the turn, released in one tick by
 * Escape, a tap, the learner's voice, or the turn's end; a finger already scrolling finishes;
 * route changes wait for the end. All against a plain EventTarget, a fake root and a fake clock.
 */

import { describe, expect, it } from 'bun:test';
import {
  GLASS_HELD_ATTRIBUTE,
  GLASS_HOLD_CAP_MS,
  GLASS_HOLD_IDLE_MS,
  GLASS_HOLD_MAX_MS,
  GLASS_HOLD_OPENING_MS,
  GlassHold,
} from '../src/glass/hold';

class FakeWindow extends EventTarget {}

class FakeRoot {
  attrs = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
}

function setup(start = 1000) {
  let now = start;
  const win = new FakeWindow();
  const root = new FakeRoot();
  const hold = new GlassHold({ target: win, root, clock: () => now });
  const tick = (ms: number) => {
    now += ms;
  };
  const wheel = () => {
    const event = new Event('wheel', { cancelable: true });
    win.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const key = (k: string) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key: k, altKey: false, ctrlKey: false, metaKey: false });
    win.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const pointer = () => {
    win.dispatchEvent(new Event('pointerdown'));
  };
  const touch = (type: string, ids: number[]) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { changedTouches: ids.map((identifier) => ({ identifier })) });
    win.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { win, root, hold, tick, wheel, key, pointer, touch };
}

describe('holding the glass for a turn', () => {
  it('locks scroll and marks the root while held, and neither survives the release', () => {
    const { hold, root, wheel } = setup();
    expect(wheel()).toBe(false);
    hold.hold('turn');
    expect(hold.held).toBe(true);
    expect(root.attrs.get(GLASS_HELD_ATTRIBUTE)).toBe('turn');
    expect(wheel()).toBe(true);
    hold.release('end');
    expect(hold.held).toBe(false);
    expect(root.attrs.has(GLASS_HELD_ATTRIBUTE)).toBe(false);
    expect(wheel()).toBe(false);
    expect(hold.get().released).toBe('end');
  });

  it('holds past the stroke hold cap: a burst of strokes is longer than one stroke', () => {
    const { hold, tick, wheel } = setup();
    hold.hold();
    hold.drawing();
    tick(1_600);
    expect(wheel()).toBe(true);
    hold.drawing();
    tick(2_000);
    expect(wheel()).toBe(true);
    expect(hold.held).toBe(true);
  });

  it('the cap is a few seconds, not most of a minute: the page is never pinned for a turn', () => {
    expect(GLASS_HOLD_CAP_MS).toBeLessThanOrEqual(10_000);
  });

  it('a stream that never closes cannot pin the page: the cap lets go', () => {
    const { hold, tick, wheel } = setup();
    hold.hold();
    tick(GLASS_HOLD_CAP_MS + 1);
    expect(wheel()).toBe(false);
    expect(hold.held).toBe(false);
    expect(hold.get().released).toBe('cap');
  });

  // A STROKE BUYS THE PAGE; A FRAME OFF THE WIRE DOES NOT (docs/INK-FOUR.md, timing; the
  // adversary, 2026-09-09, finding 4). Once a stroke has landed, the wire's next frame is a sign
  // the turn is still alive and the window starts again from it, so a burst of marks two seconds
  // apart never drops the page mid-answer.
  it('a slow next mark does not expire the hold once the pen is on the glass', () => {
    const { hold, tick } = setup();
    hold.hold('turn');
    hold.drawing();
    tick(5_000);
    expect(hold.held).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      hold.alive();
      tick(1_000);
    }
    expect(hold.get().since).not.toBeNull();
    expect(hold.held).toBe(true);
    expect(hold.get().released).toBeNull();
  });

  it('silence still lets go: the window runs from the last sign of life, not from the hold', () => {
    const { hold, tick, wheel } = setup();
    hold.hold('turn');
    hold.drawing();
    tick(4_000);
    hold.alive();
    tick(GLASS_HOLD_IDLE_MS - 1);
    expect(hold.held).toBe(true);
    tick(2);
    expect(hold.held).toBe(false);
    expect(hold.get().released).toBe('cap');
    expect(wheel()).toBe(false);
  });

  /**
   * THE PAGE IS HELD STILL ONLY WHILE A STROKE IS IN FLIGHT (docs/INK-FOUR.md, timing; the
   * adversary, 2026-09-09, finding 4).
   *
   * The hold is taken at the ASK, for the READ — the phone sheet folds to a strip, the layout
   * settles, the map is walked — and that is all it is for until ink appears. It used to run on
   * the six-second idle window from the first instant, with every wire frame putting it back, so
   * a turn that talked and never drew froze a child's page for as long as it talked. Measured
   * live on 2026-09-09: `hold@27, release:cap@6029` on a course turn with no ink at all, and
   * `hold@580, release:cap@6581` on the graph turn.
   */
  describe('before the first stroke', () => {
    it('lets the page go after the read, not after the answer', () => {
      const { hold, tick, wheel } = setup();
      hold.hold('turn');
      expect(wheel()).toBe(true);
      tick(GLASS_HOLD_OPENING_MS + 1);
      expect(hold.held).toBe(false);
      expect(wheel()).toBe(false);
    });

    it('the read gets its beat: the page is still while the sheet folds and the map is walked', () => {
      const { hold, tick } = setup();
      hold.hold('turn');
      tick(GLASS_HOLD_OPENING_MS - 100);
      expect(hold.held).toBe(true);
    });

    it('a frame off the wire does not buy the page back', () => {
      const { hold, tick } = setup();
      hold.hold('turn');
      // The wire's first byte at 6-8 s, a sentence a second: none of it is a stroke.
      for (let i = 0; i < 8; i += 1) {
        hold.alive();
        tick(1_000);
      }
      expect(hold.held).toBe(false);
      expect(hold.get().released).toBe('cap');
    });

    it('the opening window is about a read, not about an answer', () => {
      expect(GLASS_HOLD_OPENING_MS).toBeLessThanOrEqual(1_500);
      expect(GLASS_HOLD_OPENING_MS).toBeLessThan(GLASS_HOLD_IDLE_MS);
    });

    it('a stroke takes the page, and the idle window takes over from there', () => {
      const { hold, tick } = setup();
      hold.hold('turn');
      tick(GLASS_HOLD_OPENING_MS - 100);
      hold.drawing();
      tick(GLASS_HOLD_IDLE_MS - 100);
      expect(hold.held).toBe(true);
      tick(200);
      expect(hold.held).toBe(false);
    });

    it('late ink takes the glass back for itself', () => {
      const { hold, tick, wheel } = setup();
      hold.hold('turn');
      tick(GLASS_HOLD_OPENING_MS + 1);
      expect(hold.held).toBe(false);
      // Twelve seconds later the first stroke finally lands: it holds the page for itself.
      tick(11_000);
      hold.hold('turn');
      hold.drawing();
      expect(hold.held).toBe(true);
      expect(wheel()).toBe(true);
    });
  });

  it('a stream that never stops talking still cannot pin the page past the ceiling', () => {
    const { hold, tick } = setup();
    hold.hold('turn');
    for (let i = 0; i < 200; i += 1) {
      hold.alive();
      tick(500);
    }
    expect(hold.held).toBe(false);
    expect(hold.get().released).toBe('cap');
  });

  it('the ceiling is bounded, and wider than one idle window', () => {
    expect(GLASS_HOLD_MAX_MS).toBeGreaterThan(GLASS_HOLD_IDLE_MS);
    expect(GLASS_HOLD_MAX_MS).toBeLessThanOrEqual(45_000);
    expect(GLASS_HOLD_CAP_MS).toBe(GLASS_HOLD_IDLE_MS);
  });

  it('a sign of life on a glass nobody is holding takes nothing back', () => {
    const { hold, wheel } = setup();
    hold.hold('turn');
    hold.release('tap');
    hold.alive();
    expect(hold.held).toBe(false);
    expect(wheel()).toBe(false);
  });

  it('a second hold in the same turn changes nothing', () => {
    const { hold } = setup();
    hold.hold('turn');
    const since = hold.get().since;
    hold.hold('again');
    expect(hold.get().since).toBe(since);
    expect(hold.get().reason).toBe('turn');
  });
});

describe('every release, in one tick', () => {
  it('Escape', () => {
    const { hold, key, wheel } = setup();
    hold.hold();
    key('Escape');
    expect(hold.held).toBe(false);
    expect(hold.get().released).toBe('escape');
    expect(wheel()).toBe(false);
  });

  it('a tap on the glass', () => {
    const { hold, pointer, wheel } = setup();
    hold.hold();
    pointer();
    expect(hold.held).toBe(false);
    expect(hold.get().released).toBe('tap');
    expect(wheel()).toBe(false);
  });

  it("the learner's voice", () => {
    const { hold, wheel } = setup();
    hold.hold();
    hold.release('voice');
    expect(hold.held).toBe(false);
    expect(hold.get().released).toBe('voice');
    expect(wheel()).toBe(false);
  });

  it("the turn's end", () => {
    const { hold } = setup();
    hold.hold();
    hold.release('end');
    expect(hold.held).toBe(false);
    expect(hold.get().released).toBe('end');
  });

  it('tells every subscriber on the same tick, held then released', () => {
    const { hold, key } = setup();
    const seen: boolean[] = [];
    hold.subscribe((s) => seen.push(s.held));
    hold.hold();
    key('Escape');
    expect(seen).toEqual([true, false]);
  });
});

describe('the finger and the routes', () => {
  it('a finger already scrolling finishes its scroll; one that lands during the hold is refused', () => {
    const { hold, tick, touch } = setup();
    touch('touchstart', [1]);
    tick(50);
    hold.hold();
    expect(touch('touchmove', [1])).toBe(false);
    touch('touchstart', [2]);
    expect(touch('touchmove', [2])).toBe(true);
    touch('touchend', [1]);
  });

  it('a route change while held waits, keeps its order, and runs on the release', () => {
    const { hold, key } = setup();
    const went: string[] = [];
    hold.hold();
    expect(hold.defer(() => went.push('learn'))).toBe(true);
    expect(hold.defer(() => went.push('chat'))).toBe(true);
    expect(went).toEqual([]);
    expect(hold.get().deferred).toBe(2);
    key('Escape');
    expect(went).toEqual(['learn', 'chat']);
    expect(hold.get().deferred).toBe(0);
  });

  it('a route change with nothing held runs now', () => {
    const { hold } = setup();
    const went: string[] = [];
    expect(hold.defer(() => went.push('learn'))).toBe(false);
    expect(went).toEqual(['learn']);
  });

  it('dropped routes do not run', () => {
    const { hold } = setup();
    const went: string[] = [];
    hold.hold();
    hold.defer(() => went.push('learn'));
    hold.drop();
    hold.release('end');
    expect(went).toEqual([]);
  });
});

describe('the read is done, and nothing is in flight (the adversary, wave 47, finding 7)', () => {
  // INK-FOUR, timing: "The page is held still only while a stroke is in flight." The opening
  // window is for the READ — fold the sheet, settle the layout, walk the map — and on nine keyless
  // course turns that drew nothing at all the record was `hold@24 release:cap@1226`: 1.2 s of a
  // child's page frozen with no stroke ever started. The read now says when it is done.
  it('hands the page back the moment the read is done with nothing to draw', () => {
    const { hold, root } = setup();
    hold.hold('turn');
    expect(hold.get().held).toBe(true);
    hold.read();
    expect(hold.get().held).toBe(false);
    expect(hold.get().released).toBe('end');
    expect(root.attrs.has(GLASS_HELD_ATTRIBUTE)).toBe(false);
  });

  it('does not read as a barge-in: it releases as the turn’s own end', () => {
    const { hold } = setup();
    hold.hold('turn');
    hold.read();
    // board-turn.ts treats 'end', 'interrupt' and 'cap' as not-the-learner; anything else aborts
    // the turn. A read that let go must never abort the answer that is still coming.
    expect(hold.get().released).toBe('end');
  });

  it('keeps the page when a stroke is already on the glass', () => {
    const { hold } = setup();
    hold.hold('turn');
    hold.drawing();
    hold.read();
    expect(hold.get().held).toBe(true);
  });

  it('does nothing when nothing is held', () => {
    const { hold } = setup();
    hold.read();
    expect(hold.get().held).toBe(false);
    expect(hold.get().released).toBe(null);
  });

  it('lets late ink take the glass back for itself', () => {
    const { hold, tick } = setup();
    hold.hold('turn');
    hold.read();
    tick(13_000);
    hold.hold('turn');
    hold.drawing();
    expect(hold.get().held).toBe(true);
    tick(GLASS_HOLD_OPENING_MS + 1);
    // A stroke landed, so the idle window rules and the page stays still while the pen works.
    expect(hold.get().held).toBe(true);
  });
});
