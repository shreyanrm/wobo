/**
 * The glass map (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze): what the brain is handed about the
 * glass, chosen by visibility and relevance, never trimmed by a ladder. The pure half, with the
 * candidates a reader would produce for the five surfaces the law names: the course card, the
 * greeting card's triangle, a diagram with parts, a worked example with steps, the doubt photo.
 */

import { describe, expect, it } from 'bun:test';
import {
  assignGlassIds,
  chooseGlass,
  contentHash,
  GLASS_BYTE_BUDGET,
  GLASS_MAX_ENTRIES,
  type GlassBox,
  type GlassCandidate,
  type GlassEntry,
  glassAsScreen,
  glassBytes,
  glassLabel,
  meaningSlug,
  questionWords,
} from '../src/glass/map';

const PHONE = { w: 390, h: 844, scrollY: 0 };
const DESK = { w: 1440, h: 900, scrollY: 0 };

/** The share of a box inside a viewport, as a reader computes it. */
function visibleShare(box: GlassBox, vp: { w: number; h: number }): number {
  const [x, y, w, h] = box;
  if (w <= 0 || h <= 0) return 0;
  const ix = Math.max(0, Math.min(x + w, vp.w) - Math.max(x, 0));
  const iy = Math.max(0, Math.min(y + h, vp.h) - Math.max(y, 0));
  return (ix * iy) / (w * h);
}

let order = 0;
const at = (
  role: GlassCandidate['role'],
  text: string,
  box: GlassBox,
  extra: Partial<GlassCandidate> = {},
  vp = PHONE,
): GlassCandidate => ({
  role,
  text,
  box,
  order: order++,
  visible: visibleShare(box, vp),
  ...extra,
});

// --- the five surfaces, as candidates -----------------------------------------------------------

/** The composed course's card c2, "Feel the rule", at 390: title, idea, the act, the chip. */
function courseCard(vp = PHONE): GlassCandidate[] {
  order = 0;
  return [
    at('line', 'Drag it and feel the law move', [24, 120, 300, 18], {}, vp),
    at(
      'card',
      'feel the rule',
      [16, 100, 358, 420],
      { id: 'card-c2', meaning: 'concept:feel-the-rule' },
      vp,
    ),
    at('heading', 'feel the rule', [24, 150, 220, 34], {}, vp),
    at('line', 'The idea behaves like a balance: change one side,', [24, 200, 340, 24], {}, vp),
    at('line', 'the other follows.', [24, 226, 160, 24], {}, vp),
    at(
      'line',
      'Drag a number until the relationship balances.',
      [38, 280, 320, 24],
      { meaning: 'act:drag' },
      vp,
    ),
    at('chip', 'Check', [24, 760, 120, 44], {}, vp),
    at('line', 'Solving equations', [80, 12, 200, 20], { chrome: true }, vp),
  ];
}

/** The arrival card's triangle: a figure and its four parts, by their SVG ids. */
function greetingTriangle(vp = PHONE): GlassCandidate[] {
  order = 0;
  return [
    at('figure', '', [16, 90, 358, 252], { id: 'course-intro-mathematics' }, vp),
    at(
      'figure-part',
      'triangle',
      [90, 160, 160, 120],
      { id: 'course-intro-mathematics.triangle', meaning: 'part:triangle' },
      vp,
    ),
    at(
      'figure-part',
      'right angle',
      [90, 250, 28, 28],
      { id: 'course-intro-mathematics.right-angle', meaning: 'part:right-angle' },
      vp,
    ),
    at(
      'figure-part',
      'square on the hypotenuse',
      [140, 90, 190, 210],
      { id: 'course-intro-mathematics.hypotenuse-square', meaning: 'part:hypotenuse-square' },
      vp,
    ),
    at(
      'figure-part',
      'c²',
      [220, 170, 30, 30],
      { id: 'course-intro-mathematics.c2', meaning: 'part:c2' },
      vp,
    ),
    at('heading', 'solving equations with the variable on one side', [24, 360, 340, 60], {}, vp),
  ];
}

/** The seeded diagram on card c3: the figure, and its parts named by their text. */
function diagramWithParts(vp = PHONE): GlassCandidate[] {
  order = 0;
  return [
    at('figure', 'diagram: Predict, then check', [24, 300, 340, 190], { id: 'diagram-c3' }, vp),
    at(
      'figure-part',
      'Predict, then check',
      [80, 310, 230, 16],
      { id: 'diagram-c3.predict-then-check', meaning: 'part:predict-then-check' },
      vp,
    ),
    at(
      'figure-part',
      'idea',
      [70, 380, 72, 72],
      { id: 'diagram-c3.idea', meaning: 'part:idea' },
      vp,
    ),
    at(
      'figure-part',
      'effect',
      [220, 380, 72, 72],
      { id: 'diagram-c3.effect', meaning: 'part:effect' },
      vp,
    ),
    at('line', 'A claimed answer must survive the original problem.', [24, 240, 340, 24], {}, vp),
  ];
}

/** The boss's choose-the-error: a worked example whose third step carries the misconception. */
function workedExample(vp = PHONE): GlassCandidate[] {
  order = 0;
  return [
    at(
      'card',
      'one line below is wrong, tap it',
      [16, 100, 358, 300],
      { id: 'course-boss-error', meaning: 'worked-example' },
      vp,
    ),
    at('step', '2x + 3 = 11', [24, 140, 300, 40], { meaning: 'step:1' }, vp),
    at(
      'step',
      '2x = 14',
      [24, 190, 300, 40],
      { meaning: 'step:2;misconception:moves-term-without-sign' },
      vp,
    ),
    at('step', 'x = 7', [24, 240, 300, 40], { meaning: 'step:3' }, vp),
    at(
      'line',
      'the slip is where 3 crossed the equals sign and kept its sign',
      [24, 300, 340, 24],
      {},
      vp,
    ),
  ];
}

/** The doubt photo: the lines the vision read, with boxes from the read, ids as the gateway's. */
function doubtPhoto(vp = PHONE): GlassCandidate[] {
  order = 0;
  return [
    at('photo-line', '3x + 5 = 20', [40, 220, 200, 40], { id: 'r1' }, vp),
    at('photo-line', '5', [110, 220, 24, 40], { id: 'r2' }, vp),
    at('photo-line', '20', [170, 220, 40, 40], { id: 'r3' }, vp),
    at('line', 'I read this as 3x + 5 = 20; 5; 20. Is that right?', [24, 620, 340, 44], {}, vp),
    at('chip', 'Explain', [24, 760, 120, 44], {}, vp),
  ];
}

describe('ids: stable across re-measure, content hash plus index', () => {
  it('gives the same id to the same line twice and different ids to two identical lines', () => {
    const a = assignGlassIds(courseCard());
    const b = assignGlassIds(courseCard());
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    order = 0;
    const twins = assignGlassIds([
      at('line', 'x = 7', [0, 0, 50, 20]),
      at('line', 'x = 7', [0, 40, 50, 20]),
    ]);
    expect(twins[0]?.id).not.toBe(twins[1]?.id);
    expect(twins[0]?.id.endsWith('-0')).toBe(true);
    expect(twins[1]?.id.endsWith('-1')).toBe(true);
  });

  it('keeps a declared id verbatim: the doubt lines are r1..rn, the diagram parts are figure.part', () => {
    const ids = assignGlassIds(doubtPhoto()).map((c) => c.id);
    expect(ids.slice(0, 3)).toEqual(['r1', 'r2', 'r3']);
    const parts = assignGlassIds(diagramWithParts()).map((c) => c.id);
    expect(parts).toContain('diagram-c3.effect');
  });

  it('does not move when the box moves (a scroll, a resize, a theme flip re-measure the same id)', () => {
    const before = assignGlassIds(courseCard(PHONE));
    const after = assignGlassIds(
      courseCard(DESK).map((c) => ({
        ...c,
        box: [c.box[0] + 300, c.box[1] - 80, c.box[2] * 2, c.box[3]] as GlassBox,
      })),
    );
    expect(before.map((c) => c.id)).toEqual(after.map((c) => c.id));
  });

  it('hashes by content: the id changes when the words change', () => {
    expect(contentHash('line|x = 7')).not.toBe(contentHash('line|x = 8'));
    expect(contentHash('line|x = 7')).toBe(contentHash('line|x = 7'));
  });
});

describe('the map on each surface', () => {
  it('the course card: the card with its concept, its heading, its lines, the act and the chip', () => {
    const map = chooseGlass(courseCard(), PHONE, { question: 'why does the other side follow?' });
    const byRole = (r: string) => map.entries.filter((e) => e.role === r);
    expect(byRole('card')[0]?.meaning).toBe('concept:feel-the-rule');
    expect(byRole('heading')[0]?.text).toBe('feel the rule');
    expect(byRole('line').map((l) => l.text)).toContain('the other follows.');
    expect(byRole('chip')[0]?.text).toBe('Check');
    // reading order: the header line is first, the chip last
    expect(map.entries[0]?.box[1]).toBeLessThanOrEqual(map.entries[1]?.box[1] ?? 0);
    expect(map.entries.at(-1)?.role).toBe('chip');
  });

  it('the greeting card: the triangle is on the map part by part, so "circle the hypotenuse" has a box', () => {
    const map = chooseGlass(greetingTriangle(), PHONE, {
      question: 'circle the square on the hypotenuse',
    });
    const square = map.entries.find((e) => e.id === 'course-intro-mathematics.hypotenuse-square');
    expect(square).toBeDefined();
    expect(square?.meaning).toBe('part:hypotenuse-square');
    expect(square?.box).toEqual([140, 90, 190, 210]);
    expect(map.entries.find((e) => e.id === 'course-intro-mathematics.c2')?.text).toBe('c²');
  });

  it('a diagram with parts: the effect circle is its own entry inside the figure', () => {
    const map = chooseGlass(diagramWithParts(), PHONE, {
      question: 'circle the effect circle in the diagram',
    });
    const figure = map.entries.find((e) => e.id === 'diagram-c3');
    const effect = map.entries.find((e) => e.id === 'diagram-c3.effect');
    expect(figure).toBeDefined();
    expect(effect?.box).toEqual([220, 380, 72, 72]);
    // inside the figure's box
    const [fx, fy, fw, fh] = (figure as GlassEntry).box;
    const [ex, ey, ew, eh] = (effect as GlassEntry).box;
    expect(ex).toBeGreaterThanOrEqual(fx);
    expect(ey).toBeGreaterThanOrEqual(fy);
    expect(ex + ew).toBeLessThanOrEqual(fx + fw);
    expect(ey + eh).toBeLessThanOrEqual(fy + fh);
  });

  it('a worked example: steps carry step:n and the misconception rides the step it lives on', () => {
    const map = chooseGlass(workedExample(), PHONE, { question: 'which step is wrong?' });
    const steps = map.entries.filter((e) => e.role === 'step');
    expect(steps.map((s) => s.meaning)).toEqual([
      'step:1',
      'step:2;misconception:moves-term-without-sign',
      'step:3',
    ]);
    expect(steps[1]?.text).toBe('2x = 14');
  });

  it('the doubt photo: the lines from the vision read are entries with the gateway ids and boxes', () => {
    const map = chooseGlass(doubtPhoto(), PHONE, { question: 'how does the 5 move across' });
    const r2 = map.entries.find((e) => e.id === 'r2');
    expect(r2?.role).toBe('photo-line');
    expect(r2?.box).toEqual([110, 220, 24, 40]);
    expect(map.entries.map((e) => e.id).slice(0, 3)).toEqual(['r1', 'r2', 'r3']);
  });
});

describe('the choice: visibility and relevance, never a ladder', () => {
  /** A long page: 200 lines, some off the glass, a few about the question. */
  function longPage(vp: { w: number; h: number; scrollY: number }): GlassCandidate[] {
    order = 0;
    const out: GlassCandidate[] = [];
    for (let i = 0; i < 200; i += 1) {
      const y = 40 + i * 28;
      const text =
        i === 150
          ? 'the sign flips when the term crosses the equals'
          : i === 151
            ? 'a term crosses with its sign kept: the slip'
            : `line ${i} of the page, ordinary words about nothing in particular`;
      out.push(
        at(
          'line',
          text,
          [24, y, vp.w - 48, 22],
          i === 150 ? { meaning: 'concept:sign-flip' } : {},
          vp,
        ),
      );
    }
    return out;
  }

  it('is at most sixty entries and about two kilobytes, whole entries only', () => {
    const map = chooseGlass(longPage(DESK), DESK);
    expect(map.entries.length).toBeLessThanOrEqual(GLASS_MAX_ENTRIES);
    expect(glassBytes(map)).toBeLessThanOrEqual(GLASS_BYTE_BUDGET + 16);
    expect(map.more).toBeGreaterThan(0);
    for (const e of map.entries) expect(e.text.length).toBeGreaterThan(0);
  });

  it('prefers what is in the viewport: nothing wholly below the fold is chosen while visible lines are left out', () => {
    const map = chooseGlass(longPage(PHONE), PHONE);
    const below = map.entries.filter((e) => e.box[1] >= PHONE.h);
    expect(below).toHaveLength(0);
    expect(map.entries.every((e) => e.box[1] < PHONE.h)).toBe(true);
  });

  // NOTHING OFF THE GLASS IS ON THE MAP (the adversary's lab, 2026-09-08: diagram-c4.effect was
  // offered at y=-143 and ringed 143 px above the fold). A thing the question names but the
  // learner cannot see is brought into view by the FREEZE (readGlass scrolls it in, then reads);
  // it is never offered at the place it is not.
  it('never offers what is off the glass, however well the words name it', () => {
    const map = chooseGlass(longPage(PHONE), PHONE, {
      question: 'why does the sign flip when the term crosses?',
    });
    const texts = map.entries.map((e) => e.text);
    expect(texts.some((t) => t.startsWith('the sign flips'))).toBe(false);
    expect(texts.some((t) => t.startsWith('a term crosses'))).toBe(false);
    for (const e of map.entries) {
      expect(e.box[1]).toBeLessThan(PHONE.h);
      expect(e.box[1] + e.box[3]).toBeGreaterThan(0);
    }
  });

  it('offers the thing the words name once it has been scrolled onto the glass', () => {
    // the same page after the freeze scrolled line 150 into view: its box is now in the viewport
    const scrolled = longPage(PHONE).map((c) =>
      c.text.startsWith('the sign flips')
        ? { ...c, box: [24, 400, 342, 22] as GlassBox, visible: 1 }
        : c,
    );
    const map = chooseGlass(scrolled, PHONE, {
      question: 'why does the sign flip when the term crosses?',
    });
    expect(map.entries.some((e) => e.text.startsWith('the sign flips'))).toBe(true);
  });

  it('a mark above the fold, beside the page or below it is all the same refusal', () => {
    order = 0;
    const map = chooseGlass(
      [
        at('figure-part', 'effect', [698, -143, 64, 64], { meaning: 'part:effect' }, PHONE),
        at('line', 'off to the right', [500, 200, 200, 22], {}, PHONE),
        at('line', 'below the fold', [24, 900, 300, 22], {}, PHONE),
        at('line', 'on the glass', [24, 200, 300, 22], {}, PHONE),
      ],
      PHONE,
      { question: 'circle the effect' },
    );
    expect(map.entries.map((e) => e.text)).toEqual(['on the glass']);
  });

  it('never chooses what a sheet or a dialog covers', () => {
    order = 0;
    const map = chooseGlass(
      [
        at('line', 'under the sheet', [0, 700, 300, 20], { occluded: true }),
        at('line', 'in the clear', [0, 100, 300, 20]),
      ],
      PHONE,
    );
    expect(map.entries.map((e) => e.text)).toEqual(['in the clear']);
    expect(map.more).toBeUndefined();
  });

  it('the same screen at 390 and 1440 keeps the same ids and re-measured boxes', () => {
    const phone = chooseGlass(courseCard(PHONE), PHONE);
    const desk = chooseGlass(
      courseCard(DESK).map((c) => ({
        ...c,
        box: [c.box[0] + 400, c.box[1], c.box[2] + 200, c.box[3]] as GlassBox,
      })),
      DESK,
    );
    const ids = (m: { entries: { id: string }[] }) => m.entries.map((e) => e.id).sort();
    expect(ids(phone)).toEqual(ids(desk));
    expect(desk.viewport.w).toBe(1440);
    const title = (m: typeof phone) => m.entries.find((e) => e.role === 'heading')?.box;
    expect(title(phone)?.[0]).toBe(24);
    expect(title(desk)?.[0]).toBe(424);
  });

  it('a candidate with a focus id is kept before anything else', () => {
    const many = longPage(PHONE);
    const focused = { ...(many[20] as GlassCandidate), id: 'focus-1' };
    const map = chooseGlass([...many.slice(0, 20), focused, ...many.slice(21)], PHONE, {
      focusId: 'focus-1',
    });
    expect(map.entries.some((e) => e.id === 'focus-1')).toBe(true);
  });

  it('a focus that has scrolled off the glass is not offered either', () => {
    const many = longPage(PHONE);
    const focused = { ...(many[190] as GlassCandidate), id: 'focus-1' };
    const map = chooseGlass([...many.slice(0, 190), focused, ...many.slice(191)], PHONE, {
      focusId: 'focus-1',
    });
    expect(map.entries.some((e) => e.id === 'focus-1')).toBe(false);
  });
});

describe('the wire', () => {
  it('reads as one surface in the older shape, id for id, with the meaning as the description', () => {
    const map = chooseGlass(workedExample(), PHONE);
    const screen = glassAsScreen(map, 'course');
    expect(screen.surfaces).toHaveLength(1);
    expect(screen.surfaces[0]?.targets.map((t) => t.id)).toEqual(map.entries.map((e) => e.id));
    const slip = screen.surfaces[0]?.targets.find((t) => t.label === '2x = 14');
    expect(slip?.description).toBe('step:2;misconception:moves-term-without-sign');
    expect(screen.route).toBe('course');
  });

  it('questionWords keeps the content and the numbers, drops the verbs of pointing', () => {
    expect(questionWords('circle the effect circle in the diagram').words).toEqual([
      'effect',
      'diagram',
    ]);
    expect(questionWords('why is 15 cm the focal length').numbers).toEqual(['15']);
  });

  it('glassLabel and meaningSlug are what a component sets', () => {
    expect(glassLabel('step', 'step:3')).toEqual({
      'data-glass': 'step',
      'data-glass-meaning': 'step:3',
    });
    expect(glassLabel('card', undefined, 'card-c2')).toEqual({
      'data-glass': 'card',
      'data-glass-id': 'card-c2',
    });
    expect(meaningSlug('Predict, then check')).toBe('predict-then-check');
  });
});

describe('a registration is a label', () => {
  it('writes the id, the role and the meaning on the element, and the label as text for a figure', () => {
    const { glassAttributesOfTarget } =
      require('../src/glass/read') as typeof import('../src/glass/read');
    expect(
      glassAttributesOfTarget({
        id: 'diagram-c3',
        kind: 'diagram',
        label: 'diagram: Predict, then check',
      }),
    ).toEqual({
      'data-glass': 'figure',
      'data-glass-id': 'diagram-c3',
      'data-glass-text': 'diagram: Predict, then check',
    });
    expect(
      glassAttributesOfTarget({
        id: 'course-outline-2',
        kind: 'step',
        label: 'step 2',
        meaning: 'step:2',
      }),
    ).toEqual({
      'data-glass': 'step',
      'data-glass-id': 'course-outline-2',
      'data-glass-meaning': 'step:2',
    });
  });

  it('takes the label off again', () => {
    const { labelElement } = require('../src/glass/read') as typeof import('../src/glass/read');
    const attrs = new Map<string, string>();
    const el = {
      setAttribute: (n: string, v: string) => attrs.set(n, v),
      removeAttribute: (n: string) => attrs.delete(n),
    };
    const off = labelElement(el, { id: 'r1', kind: 'photo-region', label: '3x + 5 = 20' });
    expect(attrs.get('data-glass')).toBe('photo-line');
    off();
    expect(attrs.size).toBe(0);
  });
});
