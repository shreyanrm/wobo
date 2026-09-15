/**
 * The app's glass (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze): the read the turn is planned from,
 * the targets the hand traces from, and the lines a note dodges. The pure seams, with a fake read.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { GlassEntry, GlassMap } from '@wobo/wobo';
import { linesNear, mergeTargets, registeredOf } from './glass';

const entries: GlassEntry[] = [
  { id: 'h-1-0', role: 'heading', text: 'feel the rule', box: [24, 150, 220, 34] },
  { id: 'l-2-0', role: 'line', text: 'the idea behaves like a balance', box: [24, 200, 340, 24] },
  { id: 'l-3-0', role: 'line', text: 'the other follows', box: [24, 226, 160, 24] },
  { id: 'diagram-c3', role: 'figure', text: 'diagram', box: [24, 300, 340, 190] },
  {
    id: 'diagram-c3.effect',
    role: 'figure-part',
    text: 'effect',
    box: [220, 380, 72, 72],
    meaning: 'part:effect',
  },
  { id: 'l-4-0', role: 'line', text: 'far below', box: [24, 800, 340, 24] },
];
const map: GlassMap = { v: 1, viewport: { w: 390, h: 844, scrollY: 0 }, entries };

describe('the targets the hand traces from', () => {
  it('every entry on the map is a target with a live box, glass first, the registry after', () => {
    const live = new Map<string, [number, number, number, number]>([
      ['diagram-c3.effect', [221, 381, 72, 72]],
    ]);
    const targets = mergeTargets(map, (id) => live.get(id) ?? null, [
      { id: 'diagram-c3.effect', rect: () => ({ x: 0, y: 0, width: 1, height: 1 }) },
      { id: 'you-plan', rect: () => ({ x: 5, y: 6, width: 7, height: 8 }) },
    ]);
    expect(targets.map((t) => t.id)).toEqual([...entries.map((e) => e.id), 'you-plan']);
    const effect = targets.find((t) => t.id === 'diagram-c3.effect');
    // the glass's own measure wins over the registry's for an id on the map
    expect(effect?.getRect()?.x).toBe(221);
    const plan = targets.find((t) => t.id === 'you-plan');
    expect(plan?.getRect()?.width).toBe(7);
    // an entry that has left the glass answers null, so the hand fades it rather than floating it
    expect(targets.find((t) => t.id === 'h-1-0')?.getRect()).toBeNull();
  });
});

describe('the ground a target declares', () => {
  it('a photographed line is paper in both themes; the app’s own surfaces declare nothing', () => {
    const photo: GlassMap = {
      ...map,
      entries: [{ id: 'r3', role: 'photo-line', text: '3x = 20 + 5 ?', box: [139, 142, 79, 7] }],
    };
    const targets = mergeTargets(photo, () => null, [
      { id: 'r4', kind: 'photo-region', rect: () => ({ x: 139, y: 155, width: 36, height: 7 }) },
      { id: 'you-plan', kind: 'button', rect: () => ({ x: 5, y: 6, width: 7, height: 8 }) },
    ]);
    expect(targets.find((t) => t.id === 'r3')?.ground).toBe('paper');
    expect(targets.find((t) => t.id === 'r4')?.ground).toBe('paper');
    expect(targets.find((t) => t.id === 'you-plan')?.ground).toBeUndefined();
  });
});

describe('the lines a note dodges', () => {
  it('are the text lines within reach of the subject, never the figure or the far page', () => {
    const near = linesNear(map, { x: 220, y: 380, width: 72, height: 72 });
    expect(near.map((r) => r.y)).toEqual([150, 200, 226]);
  });
});

describe('what the registry still lends the reader', () => {
  it('a photo region with no element of its own rides in with its id, its kind and its words', () => {
    const [r1] = registeredOf([
      {
        id: 'r1',
        kind: 'photo-region',
        label: '3x + 5 = 20',
        description: 'reads: 3x + 5 = 20',
        rect: () => ({ x: 40, y: 220, width: 200, height: 40 }),
        text: () => '3x + 5 = 20',
      },
    ]);
    expect(r1?.id).toBe('r1');
    expect(r1?.kind).toBe('photo-region');
    expect(r1?.text).toBe('3x + 5 = 20');
    expect(r1?.rect()?.y).toBe(220);
  });
});

// --- the fixer, wave 34: what the adversary's lab found -------------------------------------------

describe("Wobo's own layers are never on the glass", () => {
  it("skips Wobo's own subtrees by the mark on their roots, never by a list of Wobo's copy", async () => {
    const { IGNORE } = await import('./glass');
    // the learner's bubble and Wobo's reply live in the companion sheet, which carries the mark;
    // the lasso's spoken announcement is a 1 px live region whose text range still reports a
    // 411 px box, and the gesture layer that draws it carries the mark too
    expect(IGNORE).toContain('[data-wobo-surface]');
    expect(IGNORE).toContain('[data-glass-ignore]');
    expect(IGNORE).toContain('[aria-live]');
    // and NOT one word of Wobo's own copy: a renamed button must not fall back onto the glass
    for (const selector of IGNORE) {
      // an accessible name is copy: it is rewritten, translated and renamed, and a map that
      // depends on it leaks the day someone edits a button
      expect(selector).not.toMatch(/aria-label|title=|placeholder=/);
    }
  });

  it('the roots the mark is on: the sheet with the transcript, the orb, the note, the lean-in', () => {
    const companion = readFileSync(new URL('./Companion.tsx', import.meta.url).pathname, 'utf8');
    expect(companion.match(/data-wobo-surface/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    // the sheet itself, where every bubble lives
    expect(companion).toContain('data-wobo-sheet');
  });
});

describe('the registry lends the glass before the first turn', () => {
  it('a lasso on a fresh page resolves against a read taken on demand', async () => {
    const { surfaceRegistry } = await import('@wobo/wobo');
    await import('./glass');
    expect(surfaceRegistry.getSurfaces().some((s) => s.id === 'glass')).toBe(true);
  });
});

describe('the thing the words name is brought onto the glass before the freeze', () => {
  it('offGlass: wholly above, below or beside the viewport', async () => {
    const { offGlass } = await import('./glass');
    const vp = { w: 390, h: 844 };
    expect(offGlass([698, -143, 64, 64], vp)).toBe(true);
    expect(offGlass([24, 900, 340, 24], vp)).toBe(true);
    expect(offGlass([24, 200, 340, 24], vp)).toBe(false);
    // half in is on the glass: the ring can land on what shows
    expect(offGlass([24, -12, 340, 24], vp)).toBe(false);
  });
});

// --- the closer, wave 41: what the adversary's lab found at 390 -----------------------------------

/**
 * THE DECIDING READ IS TAKEN UNDER THE FREEZE (the adversary, 2026-09-09, finding 5).
 *
 * At 390 the only way to ask is the companion sheet, which is `[role=dialog][aria-modal=true]`
 * over [23,64,367,780] of a 390x844 screen. That is a correct occluder, so the read that decides
 * whether this turn draws saw ONE entry — the breadcrumb — on a course page that reads 21 entries
 * at 1440. Nothing was named, so it was not a drawing turn, so it never froze, so the sheet never
 * folded. The fold was gated on a hold only a drawing turn ever took, and only a folded read could
 * have made it one. "Circle the hypotenuse" drew nothing and answered with a canned line.
 */
describe('the read that decides the turn', () => {
  const runtime = readFileSync(new URL('../AppRuntime.tsx', import.meta.url).pathname, 'utf8');

  it('freezes and lets the sheet settle before it reads, not after', () => {
    const read = runtime.indexOf('lookingAt(text, takeGlass(');
    expect(read).toBeGreaterThan(0);
    const before = runtime.slice(0, read);
    const hold = before.lastIndexOf("glassHold.hold('turn')");
    const settle = before.lastIndexOf('await nextLayout()');
    expect(hold).toBeGreaterThan(0);
    expect(settle).toBeGreaterThan(hold);
    // and nothing else between them: the hold is what makes the fold happen, the settle is what
    // waits for it to finish
    expect(read - settle).toBeLessThan(1400);
  });

  it('hands the page back on a turn that never draws, rather than leaving it to the cap', () => {
    // The cap is silence, not a wall clock (glass/hold.ts), so a plain turn that forgot to let go
    // would pin a child's page for six seconds for nothing.
    expect(runtime).toContain("glassHold.release('end')");
    const tail = runtime.slice(runtime.lastIndexOf('} finally {'));
    expect(tail).toContain("glassHold.release('end')");
  });

  it('lets go the moment the shape says this turn will not draw, not at the end of the wire', () => {
    // The freeze is for the READ. Holding it through a whole round trip would lock a child's
    // scroll for every plain question, which is what wave 33 fixed.
    expect(runtime).toContain("if (!(shape.board && GATEWAY_URL)) glassHold.release('end');");
    const decided = runtime.indexOf('const shape = boardShapeOf(');
    const released = runtime.indexOf(
      "if (!(shape.board && GATEWAY_URL)) glassHold.release('end');",
    );
    const wire = runtime.indexOf('if (shape.board && GATEWAY_URL) {');
    expect(released).toBeGreaterThan(decided);
    expect(released).toBeLessThan(wire);
  });
});

/**
 * THE FOLD IS WHAT PUTS THE PAGE BACK ON THE GLASS. A folded sheet is a strip at the bottom, and
 * it drops `aria-modal` so only the strip's own box is occluded — not the whole page.
 */
describe('the sheet on a phone, while the glass is held', () => {
  it('folds to a strip and stops being a modal over the page', async () => {
    const { sheetFolded } = await import('./fold');
    expect(sheetFolded({ open: true, held: true, inkHolding: false, width: 390 })).toBe(true);
    const companion = readFileSync(new URL('./Companion.tsx', import.meta.url).pathname, 'utf8');
    // aria-modal is dropped while folded: the whole-page occlusion goes with it
    expect(companion).toContain("aria-modal={folded ? undefined : 'true'}");
  });
});
