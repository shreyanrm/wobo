/**
 * Wobo's own furniture gets out of the ink's way (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace; the
 * adversary's finding 15). The frames at 390 and 1440 are the real proof (tests/glass.spec.ts);
 * this pins the rule so nobody quietly puts the toast back over the marks.
 */

import { describe, expect, it } from 'bun:test';
import { FLAG_CSS } from '../ui/FlagControl';
import { GLASS_HELD, INK_CLEARANCE_CSS, INK_ON_SCREEN_ATTRIBUTE } from './clearance';

describe("while Wobo's ink is on the screen", () => {
  it('the toast stands aside, and keeps its live region rather than being hidden from it', () => {
    expect(INK_CLEARANCE_CSS).toContain(`[${INK_ON_SCREEN_ATTRIBUTE}] [data-wobo-toast]`);
    expect(INK_CLEARANCE_CSS).toContain('opacity:0');
    expect(INK_CLEARANCE_CSS).toContain('pointer-events:none');
    // visibility:hidden and display:none would take the toast out of the accessibility tree with
    // it, so a course that finished composing mid-turn would never be announced at all.
    expect(INK_CLEARANCE_CSS).not.toContain('visibility:hidden');
    expect(INK_CLEARANCE_CSS).not.toContain('display:none');
  });

  it('the toast fades rather than blinking, and does not move at all under reduced motion', () => {
    expect(INK_CLEARANCE_CSS).toContain('transition:opacity');
    expect(INK_CLEARANCE_CSS).toContain('prefers-reduced-motion: reduce');
  });

  /**
   * The adversary, 2026-09-09, finding 14: keyed on ink alone, the rule fired only where the
   * problem had already gone. Every turn that drew nothing kept the toast at full opacity over
   * the card and over the "Start the course" button.
   */
  it('stands aside for the whole TURN, not only once a mark has landed', () => {
    expect(INK_CLEARANCE_CSS).toContain(`[${GLASS_HELD}] [data-wobo-toast]`);
    for (const line of INK_CLEARANCE_CSS.split('\n')) {
      if (!line.includes('data-wobo-toast')) continue;
      expect(line).toContain(`[${GLASS_HELD}] [data-wobo-toast]`);
    }
  });

  it('the Tell Wobo pill hides, while the glass is held and while the ink is up', () => {
    expect(FLAG_CSS).toContain('[data-glass-held] .wf-float');
    expect(FLAG_CSS).toContain(`[${INK_ON_SCREEN_ATTRIBUTE}] .wf-float`);
    expect(FLAG_CSS).toContain('visibility:hidden');
  });
});
