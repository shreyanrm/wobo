import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NOTHING OF WOBO'S STANDS BEHIND THE PHONE'S TAB RAIL (docs/INK-FOUR.md, craft: "nothing under a
 * panel, sheet, toast or pill"; the adversary, wave 47, finding 8).
 *
 * Measured at 390x844 on /doubt, in light, dark and reduced motion alike: Wobo's own "Talk to
 * Wobo, idle" control (`button.wobo-rig`) sat at [298, 740, 68, 68] while the tab rail occupied
 * [0, 773, 390, 71] — its bottom 35 px behind the rail, which is the one control a learner uses to
 * talk to Wobo at all.
 *
 * The rail publishes its own height as `--rail-h` for exactly this reason, and every other thing
 * pinned to the foot of a phone reads it. Wobo's dock did not. And once the dock stands above the
 * rail it is itself a thing to clear, so the doubt camera stacks above IT rather than on it.
 *
 * The numbers below are read out of the files that ship, so the arithmetic is the app's own.
 */

const SRC = join(import.meta.dir, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

const flight = read('wobo', 'Flight.tsx');
const ui = read('ui', 'primitives', 'ui.css');
const doubt = read('screens', 'doubt', 'doubt.css');

/** The tab rail's published height on a phone. */
const railHeight = (): number => {
  const m = ui.match(/--rail-h:\s*(\d+)px/);
  expect(m).not.toBeNull();
  return Number((m as RegExpMatchArray)[1]);
};

/** Wobo's dock, as `Flight.tsx` pins it. */
const dock = (): { bottom: string; size: number } => {
  const bottom = flight.match(/bottom:\s*(?:'([^']+)'|(\d+))/);
  const size = flight.match(/\bsize\s*=\s*(\d+)/);
  expect(bottom).not.toBeNull();
  expect(size).not.toBeNull();
  const raw = (bottom as RegExpMatchArray)[1] ?? (bottom as RegExpMatchArray)[2];
  return { bottom: String(raw), size: Number((size as RegExpMatchArray)[1]) };
};

/** The lowest pixel of a `calc(...)` chain, counting only its plain px terms. */
const pixels = (expr: string): number =>
  [...expr.matchAll(/(\d+(?:\.\d+)?)px/g)].reduce((n, m) => n + Number(m[1]), 0);

describe("the phone's bottom right corner is a stack, not a pile", () => {
  it('Wobo is docked above the tab rail, not inside it', () => {
    const { bottom } = dock();
    expect(bottom).toContain('--rail-h');
    // And above the notch's own strip as well: the rail pads itself by the safe area on top of
    // its published height, so a dock that read only `--rail-h` is behind it again on an iPhone.
    expect(bottom).toContain('env(safe-area-inset-bottom)');
  });

  it('the doubt camera stands above the docked Wobo, not across it', () => {
    const phone = doubt.slice(doubt.indexOf('@media (max-width:900px)'));
    const entry = phone.match(/\.db-entry\{[^}]*bottom:\s*calc\(([^;]+)\)/);
    expect(entry).not.toBeNull();
    const expr = String((entry as RegExpMatchArray)[1]);
    expect(expr).toContain('--rail-h');
    const { bottom, size } = dock();
    expect(pixels(String(expr))).toBeGreaterThanOrEqual(pixels(bottom) + size);
  });

  it('and the rail still publishes the height they both read', () => {
    expect(railHeight()).toBeGreaterThan(60);
  });
});
