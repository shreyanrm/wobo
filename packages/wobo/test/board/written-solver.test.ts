import { describe, expect, it } from 'bun:test';
import type { BoardRect } from '../../src/board/anchors';
import {
  type Placed,
  type Reserved,
  reservedStrip,
  type Size,
  solveWritten,
  type WrittenSolve,
} from '../../src/board/layout';

/**
 * THE WRITTEN SOLVER, ON ITS OWN, AGAINST ALL THREE CLAUSES OF THE CRAFT SENTENCE (wave 58).
 *
 * "Labels at least 12 px on the glass, a note in the margin within 24 px of its subject and never
 * over the text it explains." The fixture tests hold the sentence on sixteen real boards through
 * the renderer; this file holds the solver to it directly, in board units, on boards small enough
 * that the right answer can be worked out by hand — so a regression names the rule it broke.
 *
 * Against the wave 57 solver, which spent the air between two marks to nought, measured its
 * reach against its line box and knew nothing of the marks still to come, the two air tests,
 * the two ink tests and the reserved-zone test were red; the rest hold the lines it happened to
 * keep, so they cannot be lost while the others are being won.
 */

const gapOf = (a: BoardRect, b: BoardRect): number => {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
};
const overlap = (a: BoardRect, b: BoardRect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const written = (b: BoardRect): Placed => ({ ...b, written: true });

/** A one-line phrase: 0.45 units of width per character per unit of size, a 1.22 line box. */
const phrase =
  (chars: number, ink?: (size: number, w: number) => BoardRect) =>
  (size: number, maxWidth: number): Size => {
    const natural = chars * size * 0.45;
    const lines = Math.max(1, Math.ceil(natural / Math.max(maxWidth, 1)));
    const w = Math.min(natural, maxWidth);
    const h = lines * size * 1.22;
    return ink ? { w, h, ink: ink(size, w) } : { w, h };
  };

const subject: BoardRect = { x: 400, y: 400, w: 40, h: 30 };

function solve(over: Partial<WrittenSolve>): ReturnType<typeof solveWritten> {
  return solveWritten({
    subject,
    measure: phrase(10),
    sizes: [24, 20, 16],
    maxWidth: 400,
    occupied: [],
    margin: 8,
    reach: 24,
    ...over,
  });
}

describe('the air between two written marks is never spent', () => {
  it('leaves the reach rather than take the one spot in it that is five units from writing', () => {
    // Writing on three sides, and under the subject a written block five units past where the
    // caption would sit at its margin. The wave 57 solver took that spot at its roomiest rung.
    const crowd: Placed[] = [
      written({ x: 448, y: 380, w: 200, h: 70 }),
      written({ x: 300, y: 300, w: 300, h: 84 }),
      written({ x: 150, y: 380, w: 242, h: 70 }),
      written({ x: 300, y: 472, w: 300, h: 60 }),
    ];
    const fit = solve({ occupied: crowd, air: 14, nib: 3, allowInside: false });
    for (const o of crowd) expect(gapOf(fit.box, o)).toBeGreaterThanOrEqual(14 - 1e-6);
    expect(fit.withinReach).toBe(false);
  });

  it('a drawn neighbour needs only a nib, so the mark can sit closer to it than to writing', () => {
    const stroke: Placed = { x: subject.x + subject.w + 8, y: 380, w: 200, h: 70 };
    const drawn = solve({ occupied: [stroke], air: 14, nib: 3 });
    const inked = solve({ occupied: [written(stroke)], air: 14, nib: 3 });
    expect(overlap(drawn.box, stroke)).toBe(0);
    expect(gapOf(drawn.box, stroke)).toBeGreaterThanOrEqual(3 - 1e-6);
    // Same board, same box, one written: the mark must stand further off.
    expect(gapOf(inked.box, stroke)).toBeGreaterThanOrEqual(14 - 1e-6);
  });

  it('when the air law and the reach law cannot both hold, the mark goes clear and says so', () => {
    // Writing on every side, everywhere inside the reach.
    const ring: Placed[] = [
      written({ x: 300, y: 300, w: 240, h: 90 }),
      written({ x: 300, y: 440, w: 240, h: 90 }),
      written({ x: 300, y: 390, w: 90, h: 50 }),
      written({ x: 450, y: 390, w: 90, h: 50 }),
    ];
    const fit = solve({ occupied: ring, air: 14, nib: 3, allowInside: false });
    for (const o of ring) expect(gapOf(fit.box, o)).toBeGreaterThanOrEqual(14 - 1e-6);
    expect(fit.withinReach).toBe(false);
  });
});

describe('the air is aimed above its law', () => {
  it('takes a spot an eighth clear of the law over one exactly at it', () => {
    // A written neighbour under the subject such that the bottom candidate at the margin sits
    // exactly the law from it; the top is free. The wave 58 solver took the bottom.
    const air = 14;
    const h = 24 * 1.22;
    const below = written({ x: 300, y: 430 + 8 + h + air, w: 300, h: 40 });
    const fit = solve({ occupied: [below], air, nib: 3, at: 'bottom', sizes: [24] });
    expect(gapOf(fit.box, below)).toBeGreaterThanOrEqual(air * 1.125 - 1e-6);
  });
});

describe('the reach is measured on the ink a mark paints, not its line box', () => {
  // A phrase of digits: the ink sits nine units under the top of its line box and leaves nineteen
  // clear beneath — the '1919' the timeline at 390 measured.
  const digits = phrase(4, (size, w) => ({
    x: 0,
    y: size * 0.16,
    w,
    h: size * 0.6,
  }));

  it('a mark above its subject brings its ink, not its leading, within reach', () => {
    const fit = solve({ measure: digits, sizes: [45], at: 'top', reach: 12 });
    const ink = fit.ink as BoardRect;
    expect(ink.h).toBeCloseTo(45 * 0.6, 3);
    expect(gapOf(ink, subject)).toBeLessThanOrEqual(12 + 1e-6);
    // The box's leading may hang inside the margin; the ink may not.
    expect(subject.y - (ink.y + ink.h)).toBeGreaterThanOrEqual(0);
  });

  it('the fit reports the ink so a caller can check the law on it', () => {
    const fit = solve({ measure: digits, sizes: [30] });
    const ink = fit.ink as BoardRect;
    expect(ink.x).toBeCloseTo(fit.box.x, 6);
    expect(ink.y).toBeCloseTo(fit.box.y + 30 * 0.16, 6);
  });
});

describe('a note on a written subject hugs its ink, not its leading', () => {
  it('still goes under the line when the line’s ink overhangs its own box', () => {
    // Caveat's last glyph runs past the advance: the ink is two units wider than the line box.
    const line: BoardRect = { x: 300, y: 300, w: 200, h: 55 };
    const ink = written({ x: 302, y: 309, w: 200, h: 27 });
    const fit = solve({ subject: line, subjectBox: line, reachTo: ink, occupied: [ink], at: 'bottom', margin: 8, reach: 14 });
    expect(fit.box.y).toBeGreaterThanOrEqual(ink.y + ink.h);
    expect(gapOf(fit.box, ink)).toBeLessThanOrEqual(14 + 1e-6);
  });

  it('sits at the margin from the subject’s ink when the subject is writing', () => {
    // The subject's reservation is a line box with nineteen units of leading under its ink.
    const line: BoardRect = { x: 300, y: 300, w: 200, h: 55 };
    const ink = written({ x: 300, y: 309, w: 196, h: 27 });
    const fit = solve({
      subject: line,
      subjectBox: line,
      reachTo: ink,
      occupied: [ink],
      at: 'bottom',
      margin: 8,
      reach: 14,
    });
    const gap = gapOf(fit.box, ink);
    expect(gap).toBeLessThanOrEqual(14 + 1e-6);
    expect(gap).toBeGreaterThanOrEqual(8 - 1e-6);
  });
});

describe('a reserved zone is kept for the mark that will need it', () => {
  it('prefers a clear candidate over one crossing a pending sibling’s zone', () => {
    const later: BoardRect = { x: 470, y: 400, w: 40, h: 30 };
    const strip = reservedStrip(later, 'bottom', 40) as Reserved;
    const fit = solve({ at: 'bottom', reserved: [strip], measure: phrase(20) });
    expect(overlap(fit.box, strip)).toBe(0);
    expect(fit.withinReach).toBe(true);
  });

  it('when every shape has to cross, the one that takes least of the zone wins', () => {
    // The next tick's zone starts 100 units right of this one; writing to the left leaves no room
    // there. A single line at 20 characters runs the whole way under the next tick; two lines
    // clip it. The wave 58 solver took the single line, and starved the caption that came next.
    const later: BoardRect = { x: 500, y: 400, w: 40, h: 30 };
    const strip = reservedStrip(later, 'bottom', 40) as Reserved;
    const fit = solve({
      at: 'bottom',
      reserved: [strip],
      measure: phrase(20),
      sizes: [20],
      occupied: [
        written({ x: 100, y: 380, w: 290, h: 120 }),
        { x: 0, y: 0, w: 1000, h: 392 },
        { x: 470, y: 392, w: 600, h: 38 },
      ],
      air: 10,
      nib: 2,
    });
    // Not the single line, which covers the whole zone; a wrapped block that clips it or clears it.
    expect(fit.box.w).toBeLessThan(20 * 20 * 0.45 - 1);
    const covered = Math.max(0, Math.min(fit.box.x + fit.box.w, strip.x + strip.w) - Math.max(fit.box.x, strip.x));
    expect(covered).toBeLessThan(strip.w);
    expect(fit.withinReach).toBe(true);
  });

  it('strips face the side asked for', () => {
    const s = { x: 10, y: 10, w: 20, h: 20 };
    expect(reservedStrip(s, 'top', 5)).toEqual({ x: 10, y: 5, w: 20, h: 5, side: 'top' });
    expect(reservedStrip(s, 'bottomRight', 5)).toEqual({ x: 10, y: 30, w: 20, h: 5, side: 'bottom' });
    expect(reservedStrip(s, 'left', 5)).toEqual({ x: 5, y: 10, w: 5, h: 20, side: 'left' });
    expect(reservedStrip(s, undefined, 5)).toEqual({ x: 30, y: 10, w: 5, h: 20, side: 'right' });
    expect(reservedStrip(s, [0.5, 0.5], 5)).toBeNull();
  });
});

describe('the side a caption was asked for is kept before its alignment is', () => {
  it('a caption under a tick narrower than itself is centred under the tick, not left-aligned', () => {
    // The left-aligned form would clip the next tick's zone; the centred form does not. Before,
    // the solver left the side altogether and wrote the caption BESIDE its tick.
    const tick: BoardRect = { x: 400, y: 400, w: 16, h: 14 };
    const next: BoardRect = { x: 434, y: 400, w: 16, h: 14 };
    const fit = solve({
      subject: tick,
      at: 'top',
      measure: phrase(4),
      sizes: [20],
      reserved: [reservedStrip(next, 'top', 40) as Reserved],
    });
    expect(fit.box.y + fit.box.h).toBeLessThanOrEqual(tick.y);
    expect(Math.abs(fit.box.x + fit.box.w / 2 - (tick.x + tick.w / 2))).toBeLessThan(0.5);
  });
});

describe('the rings widen out to the reach', () => {
  it('a reservation a hair inside the ring at the margin does not push the mark off the aim', () => {
    // A drawn box whose top sits 0.3 units below where the ink at the margin would end.
    const subject: BoardRect = { x: 400, y: 400, w: 20, h: 20 };
    const h = 20 * 1.22;
    const rays: Placed = { x: 300, y: 400 - 8 - h + 0.3 + h - 0.3 - 3 + 0.3, w: 300, h: 60 };
    // i.e. the ring at margin 8 puts the ink's bottom at 392; the box starts at 389.3 and the
    // nib is 3, so that ring is out by a hair, and the next ring out is inside the aim.
    const fit = solve({ subject, at: 'top', measure: phrase(6), sizes: [20], occupied: [rays], nib: 3, reach: 24 });
    expect(fit.gap).toBeLessThanOrEqual(24 + 1e-6);
    expect(overlap(fit.box, rays)).toBe(0);
  });
});

describe('the shape ladder', () => {
  it('a single line at a smaller size beats a block at a larger one', () => {
    // Drawn walls above and either side, writing below: one band of room under the subject, wide
    // enough for eighteen characters on one line at size 16 but not at 24, and not tall enough
    // for two lines at 24.
    const fit = solve({
      measure: phrase(18),
      sizes: [24, 16],
      occupied: [
        { x: 0, y: 0, w: 1000, h: 392 },
        { x: 0, y: 392, w: 380, h: 200 },
        { x: 540, y: 392, w: 460, h: 200 },
        written({ x: 0, y: 476, w: 1000, h: 100 }),
      ],
      at: 'bottom',
      air: 10,
      nib: 2,
    });
    expect(fit.size).toBe(16);
    expect(fit.box.h).toBeCloseTo(16 * 1.22, 3);
    expect(fit.withinReach).toBe(true);
  });
});
