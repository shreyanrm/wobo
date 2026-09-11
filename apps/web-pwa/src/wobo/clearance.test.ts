/**
 * Wobo's own furniture gets out of the ink's way (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace; the
 * adversary's finding 15). The frames at 390 and 1440 are the real proof (tests/glass.spec.ts);
 * this pins the rule so nobody quietly puts the toast back over the marks.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHEET_ATTRIBUTE } from '@wobo/wobo';
import { FLAG_CSS } from '../ui/FlagControl';
import { GLASS_HELD, INK_CLEARANCE_CSS, INK_ON_SCREEN_ATTRIBUTE, KEEPER_HEIGHT } from './clearance';

const HERE = import.meta.dir;
const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8');
const DOUBT_CSS = read('../screens/doubt/doubt.css');
const CHAT_CSS = read('../screens/chat/chat.css');
const STAGE = read('./Stage.tsx');

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

/**
 * THE PHONE'S CHROME NEVER COVERS THE ANSWER (docs/INK-FOUR.md, craft: "nothing under a panel,
 * sheet, toast or pill"; the adversary, wave 49, finding 6).
 *
 * Measured at 390 on the from-scratch boards: pythagoras lost "9 + 16 = 25" and
 * "hypotenuse 5.00 cm" behind the Tell Wobo pill, punnett lost "dominant 3" and "recessive 1"
 * (pill and the save-to-notes bar), projectile lost "range 40.79 m", and the map lost
 * "find maharashtra" behind the doubt camera. The clearance existed and did not fire, because it
 * was keyed on `data-wobo-ink` — which `Stage` sets from the SCREEN store only, and every one of
 * those boards draws on the phone SHEET. The sheet is the third key.
 */
describe("while Wobo's sheet is up on a phone", () => {
  it('the Tell Wobo pill stands aside, as it does for held glass and for screen ink', () => {
    expect(FLAG_CSS).toContain(`[${SHEET_ATTRIBUTE}] .wf-float`);
    for (const line of FLAG_CSS.split('\n')) {
      if (!line.includes('.wf-float{visibility:hidden}')) continue;
      expect(line).toContain(`[${GLASS_HELD}] .wf-float`);
      expect(line).toContain(`[${INK_ON_SCREEN_ATTRIBUTE}] .wf-float`);
      expect(line).toContain(`[${SHEET_ATTRIBUTE}] .wf-float`);
    }
  });

  it('the doubt camera stands aside too, on the sheet and on the screen ink', () => {
    expect(DOUBT_CSS).toContain(`[${SHEET_ATTRIBUTE}] .db-entry`);
    expect(DOUBT_CSS).toContain(`[${INK_ON_SCREEN_ATTRIBUTE}] .db-entry`);
    expect(DOUBT_CSS).toContain('visibility:hidden');
  });

  it("the sheet's canvas ends above the keeper bar, so no mark is laid under it", () => {
    expect(INK_CLEARANCE_CSS).toContain(`[${SHEET_ATTRIBUTE}] .wobo-chrome-sheet`);
    expect(INK_CLEARANCE_CSS).toContain('.wobo-chrome-canvas{margin-bottom:');
    expect(INK_CLEARANCE_CSS).toContain(KEEPER_HEIGHT);
    // the bar itself does not move: lifted above the sheet it covered the say instead
    expect(STAGE).toContain('bottom: 12,');
    expect(STAGE).not.toContain('--wobo-keeper-lift');
  });

  it('and the thread still keeps the whole sheet clear at its foot', () => {
    const rule = CHAT_CSS.split('\n').find((l) => l.startsWith(`[${SHEET_ATTRIBUTE}] .ch-thread`));
    expect(rule).toBeTruthy();
    expect(rule).toContain('--wobo-sheet-h');
  });
});
