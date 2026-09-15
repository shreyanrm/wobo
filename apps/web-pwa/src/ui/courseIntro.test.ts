/**
 * The arrival art, held to the hand that drew it.
 *
 * The four drawings are Fable's, off the subjects page. This checks three things a redraw could
 * quietly lose: that every mark is still the one in design/prototypes/site-subjects.html, that the
 * ink stays inside DESIGN.md's 2.5–4px, and that a drawing carries exactly one accent pigment.
 * A snapshot per subject holds the whole drawing still on top of that.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ART_FRAME_W,
  ART_INK,
  ART_THIN,
  ART_VIEWBOX,
  artForSubject,
  artForTopic,
  gripOf,
  inkWidth,
  SUBJECT_ART,
  type SubjectArtKey,
} from './courseIntro';

const REPO = join(import.meta.dir, '..', '..', '..', '..');
const TILES = readFileSync(join(REPO, 'design', 'prototypes', 'site-subjects.html'), 'utf8');

const KEYS: SubjectArtKey[] = ['mathematics', 'science', 'social', 'english'];

/** Palette v4's pigments, by the token name the drawing may reach for. */
const PIGMENTS = ['--pig', '--violet', '--rose', '--marigold', '--mint', '--lilac'];

describe('the marks are the site tiles, verbatim', () => {
  for (const key of KEYS) {
    it(`${key} draws only paths the prototype already drew`, () => {
      for (const mark of SUBJECT_ART[key].marks) {
        if (mark.el === 'path') expect(TILES, mark.d).toContain(`d="${mark.d}"`);
        if (mark.el === 'text') expect(TILES, mark.text).toContain(`>${mark.text}<`);
      }
    });
  }

  it('the benzene ring and the port are the prototype’s circles', () => {
    expect(TILES).toContain('cx="100" cy="80" r="30"');
    expect(TILES).toContain('cx="140" cy="60" r="6"');
  });

  it('the highlighter is the prototype’s rect', () => {
    expect(TILES).toContain('x="60" y="52" width="70" height="18" rx="6"');
  });

  it('and the drawing keeps the tiles’ own frame', () => {
    expect(TILES).toContain(`viewBox="${ART_VIEWBOX}"`);
  });
});

describe('one hand, one accent, no wash', () => {
  it('ink is 4px and nothing is thinner than 2.5', () => {
    expect(ART_INK).toBe(4);
    expect(ART_THIN).toBe(2.5);
    expect(ART_THIN).toBeGreaterThanOrEqual(2.5);
    expect(ART_INK).toBeLessThanOrEqual(4);
  });

  for (const key of KEYS) {
    it(`${key} carries exactly one accent pigment, on a tonal tile`, () => {
      const art = SUBJECT_ART[key];
      const accents = PIGMENTS.filter((p) => art.accent === `var(${p})`);
      expect(accents).toHaveLength(1);
      expect(art.tint).toMatch(/^var\(--(pig|violet|rose|marigold|mint|lilac)-w\)$/);
    });

    it(`${key} draws no shape wearing a wash`, () => {
      const serialised = JSON.stringify(SUBJECT_ART[key]);
      expect(serialised).not.toContain('opacity');
      expect(serialised).not.toContain('rgba');
    });
  }

  it('the highlighter goes down before the lines it marks', () => {
    const marks = SUBJECT_ART.english.marks;
    expect(marks[0]?.el).toBe('mark');
    expect(marks[1]?.el).toBe('path');
  });
});

describe('a subject opens on its own drawing', () => {
  it('resolves every family the curriculum knows', () => {
    expect(artForSubject('Mathematics')).toBe('mathematics');
    expect(artForSubject('math')).toBe('mathematics');
    expect(artForSubject('computer')).toBe('mathematics');
    expect(artForSubject('Physical Science')).toBe('science');
    expect(artForSubject('chemistry')).toBe('science');
    expect(artForSubject('biology')).toBe('science');
    expect(artForSubject('History, Civics and Geography')).toBe('social');
    expect(artForSubject('English')).toBe('english');
    expect(artForSubject('Second Language — Hindi')).toBe('english');
  });

  it('a subject nobody recognises still opens on a drawing', () => {
    expect(KEYS).toContain(artForSubject('Basket weaving'));
  });

  it('a topic resolves through its chapter, as the hues do', () => {
    expect(KEYS).toContain(artForTopic('m2-1'));
    expect(KEYS).toContain(artForTopic('no-such-topic'));
  });
});

describe('the drawing itself', () => {
  for (const key of KEYS) {
    it(`${key} is unchanged`, () => {
      expect(SUBJECT_ART[key]).toMatchSnapshot();
    });
  }
});

/**
 * THE MATHS FIGURE IS A FIGURE A CHILD CAN READ (the adversary, 2026-09-09, finding 13).
 *
 * It is the drawing "circle the hypotenuse" correctly rings, so it is looked at up close. Its
 * "square on the hypotenuse" was an OPEN four-sided path, 113 long by 67 wide, with two corners
 * above the frame at y = -2 and y = -38: not square, not closed, and cut off at the top.
 */
describe('the square on the hypotenuse is a square', () => {
  const points = (d: string): [number, number][] =>
    (d.match(/-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/g) ?? []).map((pair) => {
      const [x, y] = pair.split(/\s+/).map(Number);
      return [x as number, y as number];
    });
  const marks = SUBJECT_ART.mathematics.marks;
  const pathOf = (part: string) => {
    const mark = marks.find((m) => m.part === part);
    if (!mark || mark.el !== 'path') throw new Error(`no path for ${part}`);
    return mark.d;
  };

  it('is closed, and its four sides are the same length', () => {
    const d = pathOf('square on the hypotenuse');
    expect(d.trim().endsWith('Z')).toBe(true);
    const p = points(d);
    expect(p).toHaveLength(4);
    const side = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const sides = [
      side(p[0] as [number, number], p[1] as [number, number]),
      side(p[1] as [number, number], p[2] as [number, number]),
      side(p[2] as [number, number], p[3] as [number, number]),
      side(p[3] as [number, number], p[0] as [number, number]),
    ];
    for (const s of sides) expect(Math.abs(s - (sides[0] as number))).toBeLessThan(1.5);
  });

  it('sits on the triangle’s own hypotenuse, and inside the frame', () => {
    const tri = points(pathOf('triangle'));
    const sq = points(pathOf('square on the hypotenuse'));
    // the square's first and last corners ARE the triangle's hypotenuse ends
    const near = (a: [number, number], b: [number, number]) =>
      Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5;
    expect(near(sq[0] as [number, number], tri[1] as [number, number])).toBe(true);
    expect(near(sq[3] as [number, number], tri[2] as [number, number])).toBe(true);
    const [, , w, h] = ART_VIEWBOX.split(' ').map(Number);
    for (const [x, y] of [...tri, ...sq]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(w as number);
      expect(y).toBeLessThanOrEqual(h as number);
    }
  });

  it('the right angle is marked ON the corner where the two legs meet', () => {
    const tri = points(pathOf('triangle'));
    const corner = tri[0] as [number, number];
    const mark = points(pathOf('right angle'))[0] as [number, number];
    expect(mark[0]).toBe(corner[0]);
    expect(Math.abs(mark[1] - corner[1])).toBeLessThanOrEqual(16);
  });
});

/**
 * THE SIDE ITSELF (the adversary, wave 58, finding 1; INK-FOUR relevance: "a question that names
 * a part gets the part, not its figure"). Live at 1440 and at 390, "circle the hypotenuse" rang
 * the SQUARE ON the hypotenuse, because the drawing declared the triangle, the right angle, the
 * square and c² — and never the side. The prototype-verbatim law above forbids a new stroke, so
 * the side is declared as a place with no ink of its own: the edge the triangle already draws,
 * from B to C, named so the glass map can hand it to Wobo.
 */
describe('the mathematics drawing names its hypotenuse', () => {
  const marks = SUBJECT_ART.mathematics.marks;
  const side = marks.find((m) => m.part === 'hypotenuse');

  it('declares the side by name', () => {
    expect(side).toBeDefined();
    expect(side?.el).toBe('side');
  });

  it('and the side is the triangle’s own edge, B to C, with no ink of its own', () => {
    if (side?.el !== 'side') throw new Error('no side');
    // The triangle is M46 124 L106 124 L46 79 Z: the right angle at A(46,124), B(106,124), C(46,79).
    expect([side.x1, side.y1, side.x2, side.y2]).toEqual([106, 124, 46, 79]);
    expect('ink' in side).toBe(false);
  });
});

/**
 * A RING ON THE SIDE IS NOT A RING ON THE FIGURE (the judge, wave 60; INK-FOUR relevance, "a
 * question that names a part gets the part, not its figure"; craft, "a ring that fits its subject").
 *
 * Measured on the app's own arrival card before this test was written: the glass gave
 * `course-intro-mathematics.hypotenuse` the box [131,261,71,54] at 390 and [547,369,126,95] at
 * 1440 — the same box, to the pixel, as `...triangle` — and the ring the screen store painted on
 * it held all THREE of the triangle's corners at every one of 390 light, 390 dark, 390 reduced,
 * 1440 light and 1440 dark. That is arithmetic, not a bug in the pen: the hypotenuse of a right
 * triangle whose legs lie along its box's edges runs corner to corner of that box, so a box around
 * the whole of it IS the figure. The declaration therefore names the stretch a mark lands on.
 *
 * The clearances below are stated in the frame's units and hold at both widths: the drawing is one
 * frame scaled whole, so a stretch clear of the legs in frame units is clear of them everywhere.
 */
describe('the stretch of the hypotenuse a mark lands on', () => {
  const marks = SUBJECT_ART.mathematics.marks;
  const side = marks.find((m) => m.part === 'hypotenuse');
  if (side?.el !== 'side') throw new Error('no side');
  const grip = gripOf(side);
  const box = {
    x: Math.min(grip.x1, grip.x2),
    y: Math.min(grip.y1, grip.y2),
    w: Math.abs(grip.x2 - grip.x1),
    h: Math.abs(grip.y2 - grip.y1),
  };
  /** A(46,124) is the right angle, B(106,124) and C(46,79) are the hypotenuse's own ends. */
  const CORNERS: [number, number][] = [
    [46, 124],
    [106, 124],
    [46, 79],
  ];

  it('is on the side, centred on its midpoint', () => {
    expect(grip.x1 + (grip.x2 - grip.x1) / 2).toBeCloseTo((side.x1 + side.x2) / 2, 6);
    expect(grip.y1 + (grip.y2 - grip.y1) / 2).toBeCloseTo((side.y1 + side.y2) / 2, 6);
    // every point of the grip is a point of the side: same direction, inside its ends
    const t = (px: number) => (px - side.x1) / (side.x2 - side.x1);
    for (const p of [
      [grip.x1, grip.y1],
      [grip.x2, grip.y2],
    ] as [number, number][]) {
      const at = t(p[0]);
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(1);
      expect(side.y1 + (side.y2 - side.y1) * at).toBeCloseTo(p[1], 6);
    }
  });

  it('holds no corner of the triangle, so a ring on it is not a ring on the figure', () => {
    for (const [x, y] of CORNERS) {
      const held = x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
      expect(held, `corner ${x},${y}`).toBe(false);
    }
  });

  it('keeps clear air between itself and both legs', () => {
    // leg A-B lies along y = 124, leg A-C along x = 46: the grip's box stands off both.
    expect(124 - (box.y + box.h)).toBeGreaterThanOrEqual(9);
    expect(box.x - 46).toBeGreaterThanOrEqual(9);
  });

  it('and is still a box the glass can measure at the narrowest width it is drawn at', () => {
    // 390 puts the frame on the glass at 1.19 px per unit (measured); the reader drops a part
    // under three pixels in either direction (glass/read.ts, MIN_PX).
    const k = 1.19;
    expect(box.w * k).toBeGreaterThan(3);
    expect(box.h * k).toBeGreaterThan(3);
  });
});

/**
 * THE WHOLE STROKE, AT FOUR SCREEN PIXELS (the judge, wave 60: "the square on the hypotenuse with
 * only two sides at the end frame").
 *
 * Measured on the arrival card before the fix: `vector-effect: non-scaling-stroke` beside framer's
 * `pathLength` draw-on left the square painting 220.5 px of its 630 (k = 2.10 at 1440) and 125.0 of
 * 357 (k = 1.19 at 390) — half the square, a triangle with no vertical leg, a right angle with no
 * corner. The weight is held by division now, so the dash has nothing to misread.
 */
describe('the ink is in screen pixels', () => {
  const widths = [
    { width: 420, k: 420 / ART_FRAME_W },
    { width: 238, k: 238 / ART_FRAME_W },
  ];

  it('an ink stroke paints ART_INK on the glass at every scale', () => {
    for (const { k } of widths) expect(inkWidth('ink', k) * k).toBeCloseTo(ART_INK, 6);
  });

  it('a thin stroke paints ART_THIN on the glass at every scale', () => {
    for (const { k } of widths) {
      expect(inkWidth('thin', k) * k).toBeCloseTo(ART_THIN, 6);
      expect(inkWidth('accent-thin', k) * k).toBeCloseTo(ART_THIN, 6);
    }
  });

  it('and an unmeasured frame still draws, at the weight it was written in', () => {
    for (const k of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(inkWidth('ink', k)).toBe(ART_INK);
      expect(inkWidth('accent', k)).toBe(ART_INK);
    }
  });
});
