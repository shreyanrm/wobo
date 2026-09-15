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
  BOARD_AIR_PX,
  gripOf,
  inkWidth,
  ringOnGrip,
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
  /** 390 puts the 200-unit frame on the glass at 1.19 px per unit — measured, both themes. */
  const K390 = 238 / ART_FRAME_W;
  /** The air two marks keep from each other on the glass, in CSS px (board/geometry.ts). */
  const LABEL_GAP_PX = 8;
  /**
   * The two marks nearest the side, in frame units. The right angle is its own path, `M46 112 h12
   * v12`. c² is a 22-unit glyph whose box no arithmetic here can know, so it is the box the glass
   * reader measured on the card at 390 — [178,325,22,33] in viewport px — carried back into frame
   * units; it is the same box at 1440, because the drawing is one frame scaled whole.
   */
  const NEIGHBOURS = {
    'right angle': { x: 46, y: 112, w: 12, h: 12 },
    'c²': { x: (178 - 76) / K390, y: (325 - 255) / K390, w: 22 / K390, h: 33 / K390 },
  };
  /** The shortest distance between two boxes, as the lab measures it; negative when they overlap. */
  const gap = (a: { x: number; y: number; w: number; h: number }, b: typeof a): number => {
    const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    return dx >= 0 && dy >= 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
  };

  it('is a stretch of the side itself, inside both of its ends', () => {
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
    // and it is centred where the drawing says, to the fraction
    expect(t(grip.x1 + (grip.x2 - grip.x1) / 2)).toBeCloseTo(side.at ?? 0.5, 6);
  });

  it('never runs off an end, whatever a drawing asks for', () => {
    const ends = (at: number, g: number) => {
      const got = gripOf({ x1: 0, y1: 0, x2: 100, y2: 0, grip: g, at });
      return [got.x1, got.x2];
    };
    const isAt = (got: number[], want: number[]) => {
      expect(got[0]).toBeCloseTo(want[0] as number, 6);
      expect(got[1]).toBeCloseTo(want[1] as number, 6);
    };
    isAt(ends(0, 0.4), [0, 40]);
    isAt(ends(1, 0.4), [60, 100]);
    isAt(ends(-5, 0.4), [0, 40]);
    // a side with no grip is still all of itself
    isAt(ends(0.5, 1), [0, 100]);
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
    expect(box.w * K390).toBeGreaterThan(3);
    expect(box.h * K390).toBeGreaterThan(3);
  });

  /**
   * AND THE RING THE PEN PAINTS ON IT KEEPS THE BOARD'S OWN AIR FROM EVERY OTHER MARK (the judge,
   * wave 62: "a 26 px loop ... 7 px from the right-angle tick"; INK-FOUR craft, "a ring that fits
   * its subject with even padding").
   *
   * The grip is not the ring. The pen pads the box by 9 px and will not draw a loop smaller than
   * its own hand (`loopAround`, board/geometry.ts: rx at least 12 px, ry at least 10, and about 3
   * percent of overshoot as the loop closes), so on this figure the ring is thirty-odd pixels
   * whatever the grip is, and where it lands decides what it crowds. Wave 60's middle tenth put it
   * under c², at 5.3 px; this is the same arithmetic, before a browser is opened.
   */
  it('leaves the board’s own air between the ring and every other mark, at 390', () => {
    const pad = 9 / K390;
    const rx = Math.max(box.w / 2 + pad, 12 / K390) * 1.03;
    const ry = Math.max(box.h / 2 + pad, 10 / K390) * 1.03;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const ring = { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
    for (const [name, other] of Object.entries(NEIGHBOURS)) {
      expect(gap(ring, other) * K390, name).toBeGreaterThanOrEqual(LABEL_GAP_PX);
    }
    // the legs are lines, not boxes: leg A-B along y = 124, leg A-C along x = 46
    expect((124 - (ring.y + ring.h)) * K390, 'leg A-B').toBeGreaterThanOrEqual(LABEL_GAP_PX);
    expect((ring.x - 46) * K390, 'leg A-C').toBeGreaterThanOrEqual(LABEL_GAP_PX);
  });

  it('and no corner of the triangle is inside that ring either', () => {
    const pad = 9 / K390;
    const rx = Math.max(box.w / 2 + pad, 12 / K390) * 1.03;
    const ry = Math.max(box.h / 2 + pad, 10 / K390) * 1.03;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    for (const [x, y] of CORNERS) {
      const held = Math.abs(x - cx) <= rx && Math.abs(y - cy) <= ry;
      expect(held, `corner ${x},${y}`).toBe(false);
    }
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

/**
 * AND THE STRETCH IS STATED IN THE BOARD'S OWN PIXELS, NOT IN THE FRAME'S UNITS (the closer, wave
 * 62; INK-FOUR craft, "a ring that fits its subject with even padding").
 *
 * `grip` was one fraction of the side for every width, swept by hand at 390. But the pen's numbers
 * are PIXELS — 9 px of pad, a smallest loop of 12 by 10, the board's 8 px of air — and pixels do
 * not scale with the frame. So the same fraction bought two different pictures: measured on the
 * arrival card, the ring stood 8.3 px off c² at 390 and 22.1 px off it at 1440, and covered 0.45
 * of the hypotenuse at 390 and only 0.32 of it at 1440. At the wide width the loop was a small
 * ring floating in an empty stretch of side, with room for twice itself going spare.
 *
 * The stretch is therefore SOLVED at the width it is drawn at: the widest one whose ring still
 * keeps the board's air from every piece of ink the side declares as its neighbour (`room`), with
 * the declared `grip` as a floor so a narrow frame never shrinks below the value measured on a
 * real screen. The pen's model here is board/geometry.ts's own — the `circle` case pads by 9 and
 * `loopAround` floors the loop at 12 by 10 and grows it 3 percent as it closes.
 */
describe('the stretch is solved in the board’s pixels, at the width it is drawn at', () => {
  const marks = SUBJECT_ART.mathematics.marks;
  const side = marks.find((m) => m.part === 'hypotenuse');
  if (side?.el !== 'side') throw new Error('no side');
  /** The frame on the glass: 238 px wide at 390, 420 px at 1440 (measured, both themes). */
  const K390 = 238 / ART_FRAME_W;
  const K1440 = 420 / ART_FRAME_W;
  const len = Math.hypot(side.x2 - side.x1, side.y2 - side.y1);
  const covers = (k: number) => {
    const g = gripOf(side, k);
    return Math.hypot(g.x2 - g.x1, g.y2 - g.y1) / len;
  };
  const gap = (a: { x: number; y: number; w: number; h: number }, b: typeof a): number => {
    const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    return dx >= 0 && dy >= 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
  };

  it('declares the ink its ring must keep the board’s air from', () => {
    expect(side.room?.length).toBeGreaterThanOrEqual(4);
  });

  it('is exactly the grip measured on a real 390 screen, so 390 is not spent for 1440', () => {
    expect(covers(K390)).toBeCloseTo(side.grip as number, 6);
  });

  it('and grows with the frame, because the pen’s pad does not', () => {
    expect(covers(K1440)).toBeGreaterThan((side.grip as number) * 2);
  });

  it('never shrinks below the declared grip, however narrow the frame', () => {
    for (const k of [0.2, 0.5, 1, K390]) expect(covers(k)).toBeGreaterThanOrEqual(side.grip as number);
  });

  it('and is exactly the declared grip when nobody has measured the frame yet', () => {
    for (const k of [undefined, 0, Number.NaN, Number.POSITIVE_INFINITY])
      expect(covers(k as number)).toBeCloseTo(side.grip as number, 6);
  });

  it('keeps the board’s air from every neighbour at every width it is drawn at', () => {
    for (let px = 320; px <= 1600; px += 20) {
      // The card holds the drawing to 420 px, and puts 24 px of padding each side of it at 390.
      const k = Math.min(420, px - 2 * 24 - 2 * 16) / ART_FRAME_W;
      if (k <= 0) continue;
      const ring = ringOnGrip(side, k);
      for (const [x, y, w, h] of side.room ?? []) {
        expect(gap(ring, { x, y, w, h }) * k, `${px}px: room ${x},${y}`).toBeGreaterThanOrEqual(
          BOARD_AIR_PX,
        );
      }
    }
  });

  it('and still holds no corner of the triangle, at any width', () => {
    const CORNERS: [number, number][] = [
      [46, 124],
      [106, 124],
      [46, 79],
    ];
    for (const k of [K390, (K390 + K1440) / 2, K1440]) {
      const ring = ringOnGrip(side, k);
      for (const [x, y] of CORNERS) {
        const held =
          x >= ring.x && x <= ring.x + ring.w && y >= ring.y && y <= ring.y + ring.h;
        expect(held, `corner ${x},${y} at k=${k}`).toBe(false);
      }
    }
  });

  it('and every point of it is still a point of the side, inside both ends', () => {
    for (const k of [K390, K1440, 4]) {
      const g = gripOf(side, k);
      const t = (px: number) => (px - side.x1) / (side.x2 - side.x1);
      for (const p of [
        [g.x1, g.y1],
        [g.x2, g.y2],
      ] as [number, number][]) {
        const at = t(p[0]);
        expect(at).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThanOrEqual(1);
        expect(side.y1 + (side.y2 - side.y1) * at).toBeCloseTo(p[1], 6);
      }
    }
  });
});
