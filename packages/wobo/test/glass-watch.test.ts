/**
 * The glass is re-measured by id on a resize and on a theme flip (docs/INK-FREEZE-PLAN-TRACE.md §3,
 * Freeze): the same ids, fresh boxes, nothing walked again. Against a fake read, a fake window,
 * a fake media query and a fake attribute observer.
 */

import { describe, expect, it } from 'bun:test';
import type { GlassMap, GlassRead } from '../src/glass';
import { watchGlass } from '../src/glass/watch';

class FakeWindow extends EventTarget {}

function fakeRead(): GlassRead & { measured: number } {
  const map: GlassMap = {
    v: 1,
    viewport: { w: 390, h: 844, scrollY: 0 },
    entries: [{ id: 'l-1-0', role: 'line', text: 'x = 7', box: [24, 100, 60, 20] }],
  };
  const read = {
    measured: 0,
    map,
    scrolled: false,
    remeasure() {
      read.measured += 1;
      return map;
    },
    rectOf: () => null,
    find: () => null,
    elementOf: () => null,
  };
  return read;
}

function setup() {
  const win = new FakeWindow();
  const read = fakeRead();
  const seen: GlassMap[] = [];
  let themeListener: (() => void) | null = null;
  let attrListener: (() => void) | null = null;
  let attrStopped = 0;
  const stop = watchGlass(read, {
    target: win,
    media: {
      addEventListener: (_type: string, l: () => void) => {
        themeListener = l;
      },
      removeEventListener: () => {
        themeListener = null;
      },
    },
    observeTheme: (l) => {
      attrListener = l;
      return () => {
        attrStopped += 1;
        attrListener = null;
      };
    },
    onChange: (map) => seen.push(map),
  });
  return {
    win,
    read,
    seen,
    stop,
    theme: () => themeListener?.(),
    attr: () => attrListener?.(),
    stopped: () => attrStopped,
    themeOff: () => themeListener === null,
  };
}

describe('re-measuring the glass', () => {
  it('a resize re-measures the same ids and tells the subscriber', () => {
    const { win, read, seen } = setup();
    win.dispatchEvent(new Event('resize'));
    expect(read.measured).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.entries[0]?.id).toBe('l-1-0');
  });

  it('a theme flip re-measures, by the media query and by the root attribute', () => {
    const { read, theme, attr } = setup();
    theme();
    expect(read.measured).toBe(1);
    attr();
    expect(read.measured).toBe(2);
  });

  it('stops listening when stopped, and never measures again', () => {
    const { win, read, stop, theme, stopped, themeOff } = setup();
    stop();
    win.dispatchEvent(new Event('resize'));
    theme();
    expect(read.measured).toBe(0);
    expect(stopped()).toBe(1);
    expect(themeOff()).toBe(true);
  });
});
