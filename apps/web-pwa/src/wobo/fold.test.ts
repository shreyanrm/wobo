/**
 * The phone sheet folds to a strip while Wobo's ink is on the page, not only while the glass is
 * held: live at 390 the number line ended behind the sheet, which unfolded modal over the ink on
 * the turn's end while the ask was still open (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace).
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { sheetFolded, sheetParts } from './fold';

describe('when the sheet folds', () => {
  it('folds on a phone while the glass is held', () => {
    expect(sheetFolded({ open: true, held: true, inkHolding: false, width: 390 })).toBe(true);
  });
  it('stays folded while screen ink is still holding for an answer', () => {
    expect(sheetFolded({ open: true, held: false, inkHolding: true, width: 390 })).toBe(true);
  });
  it('unfolds once the ink has gone', () => {
    expect(sheetFolded({ open: true, held: false, inkHolding: false, width: 390 })).toBe(false);
  });
  it('never folds on a desktop, and never when closed', () => {
    expect(sheetFolded({ open: true, held: true, inkHolding: true, width: 1440 })).toBe(false);
    expect(sheetFolded({ open: false, held: true, inkHolding: true, width: 390 })).toBe(false);
  });
});

/**
 * A STRIP IS THE ASK ROW AND NOTHING ELSE (the adversary, 2026-09-09, finding 4). At 390 the input
 * sat at y 904 in an 844 px viewport, and stayed there after Escape and after a scroll to the end,
 * so seven of the fifty-nine turns could not be taken at all.
 */
describe('what a folded sheet shows', () => {
  it('only the ask row: nothing else can push it off the bottom of the phone', () => {
    const strip = sheetParts(true);
    expect(strip.ask).toBe(true);
    expect(strip.thread).toBe(false);
    expect(strip.modes).toBe(false);
    expect(strip.teachBack).toBe(false);
    expect(strip.head).toBe(false);
  });

  it('and everything comes back the moment it unfolds', () => {
    expect(sheetParts(false)).toEqual({
      head: true,
      thread: true,
      teachBack: true,
      modes: true,
      ask: true,
    });
  });

  it('the sheet obeys it: every part that can push is gated, and the box is not a fixed height', () => {
    const sheet = readFileSync(new URL('./Companion.tsx', import.meta.url).pathname, 'utf8');
    expect(sheet).toContain('sheetParts(folded)');
    expect(sheet).toContain("display: parts.thread ? 'flex' : 'none'");
    expect(sheet).toContain('{parts.modes && !tb && (');
    expect(sheet).toContain('{parts.teachBack && !tb && topicName && (');
    // the 128 px box that could not hold what was inside it is gone
    expect(sheet).not.toContain('height: folded ? 128');
  });
});
