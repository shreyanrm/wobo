/**
 * The scroll hold (the owner, 2026-09-05): the page stands still while a stroke is in flight, and
 * only then. Everything here runs against a plain EventTarget and a fake clock.
 */

import { describe, expect, it } from 'bun:test';
import { MAX_HOLD_MS, ScrollHold } from '../src/scroll-hold';

class FakeWindow extends EventTarget {}

function setup(start = 1000) {
  let now = start;
  const win = new FakeWindow();
  const hold = new ScrollHold({ target: win, clock: () => now });
  const tick = (ms: number) => {
    now += ms;
  };
  const wheel = () => {
    const event = new Event('wheel', { cancelable: true });
    win.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const key = (k: string, over: Record<string, unknown> = {}) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key: k, altKey: false, ctrlKey: false, metaKey: false, ...over });
    win.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const touch = (type: string, ids: number[]) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { changedTouches: ids.map((identifier) => ({ identifier })) });
    win.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { win, hold, tick, wheel, key, touch };
}

describe('holding the page while a stroke is in flight', () => {
  it('refuses a wheel scroll while held and lets it through the moment it is released', () => {
    const { hold, wheel } = setup();
    expect(wheel()).toBe(false); // nothing drawing: the page is the learner's
    hold.set('surface-1', true);
    expect(wheel()).toBe(true);
    hold.set('surface-1', false);
    expect(wheel()).toBe(false);
  });

  it('is released within one frame of the stroke ending', () => {
    // A 300 ms arc: the surface reports in-flight each frame and landed on the first frame past it.
    const { hold, wheel, tick } = setup();
    const startAt = 1000;
    const dur = 300;
    const frame = 16;
    let now = startAt;
    const report = () => hold.set('s', now < startAt + dur);
    for (; now < startAt + dur; now += frame) {
      report();
      expect(wheel()).toBe(true);
      tick(frame);
    }
    report(); // the first frame at or past the landing
    expect(now - (startAt + dur)).toBeLessThan(frame);
    expect(hold.held).toBe(false);
    expect(wheel()).toBe(false);
  });

  it('holds the page-scrolling keys and no other key', () => {
    const { hold, key } = setup();
    hold.set('s', true);
    expect(key('ArrowDown')).toBe(true);
    expect(key('PageDown')).toBe(true);
    expect(key(' ')).toBe(true);
    expect(key('a')).toBe(false);
    expect(key('ArrowDown', { ctrlKey: true })).toBe(false);
  });

  it('never blocks typing — an arrow inside a text field is the field’s', () => {
    const { hold, win } = setup();
    hold.set('s', true);
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, {
      key: 'ArrowDown',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    Object.defineProperty(event, 'target', { value: { tagName: 'INPUT' } });
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('never a lock the learner cannot escape', () => {
  it('lets go on Escape even while the surface still says in flight', () => {
    const { hold, wheel, key } = setup();
    hold.set('s', true);
    expect(wheel()).toBe(true);
    key('Escape');
    expect(hold.held).toBe(false);
    expect(wheel()).toBe(false);
  });

  it('lets go after MAX_HOLD_MS whatever a surface says', () => {
    const { hold, wheel, tick } = setup();
    hold.set('s', true);
    tick(MAX_HOLD_MS - 1);
    expect(wheel()).toBe(true);
    tick(2);
    expect(wheel()).toBe(false);
    expect(hold.held).toBe(false);
    // and a stroke that begins after that holds afresh
    hold.set('s2', true);
    expect(wheel()).toBe(true);
  });

  it('holds for the union of the surfaces and releases when the last one lands', () => {
    const { hold, wheel } = setup();
    hold.set('screen', true);
    hold.set('overlay', true);
    hold.set('screen', false);
    expect(wheel()).toBe(true);
    hold.set('overlay', false);
    expect(wheel()).toBe(false);
  });
});

describe('a phone: a finger already moving is left alone', () => {
  it('lets a finger that landed before ANY surface was watching keep its scroll', () => {
    // The order the product actually has for the first stroke of a turn: the finger is already
    // on the glass, THEN the first mark arrives, the overlay mounts and the hold begins. No
    // surface had called watch() when the finger landed. Measured in the app on 2026-09-05:
    // touchstart, hold('stroke'), touchmove -> defaultPrevented TRUE. It must be false.
    const { hold, touch, tick } = setup();
    expect(hold.watching).toBe(0);
    touch('touchstart', [11]);
    tick(40);
    hold.set('stroke', true);
    expect(touch('touchmove', [11])).toBe(false);
  });

  it('lets a gesture that began before the hold keep scrolling', () => {
    const { hold, touch, tick } = setup();
    const unwatch = hold.watch();
    touch('touchstart', [7]);
    tick(40);
    hold.set('s', true);
    expect(touch('touchmove', [7])).toBe(false);
    unwatch();
  });

  it('refuses a gesture that starts while the page is held', () => {
    const { hold, touch, tick } = setup();
    const unwatch = hold.watch();
    hold.set('s', true);
    tick(40);
    touch('touchstart', [9]);
    expect(touch('touchmove', [9])).toBe(true);
    hold.set('s', false);
    expect(touch('touchmove', [9])).toBe(false);
    unwatch();
  });
});

describe('the release is announced so the ink re-anchors', () => {
  it('tells subscribers on hold and on release, once each', () => {
    const { hold } = setup();
    const seen: boolean[] = [];
    hold.subscribe((held) => seen.push(held));
    hold.set('a', true);
    hold.set('b', true);
    hold.set('a', false);
    hold.set('b', false);
    expect(seen).toEqual([true, false]);
  });

  it('runs without a window at all', () => {
    const hold = new ScrollHold({ target: null });
    hold.set('s', true);
    expect(hold.held).toBe(true);
    hold.set('s', false);
    expect(hold.held).toBe(false);
  });
});
