/**
 * The reader's two refusals (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze), as pure decisions.
 *
 * NOTHING OFF THE GLASS IS ON THE MAP, and when the thing the question names is off the glass the
 * FREEZE brings it into view before it reads. `scrollTarget` is that decision with no page under
 * it: which candidate, if any, the read should scroll to before it walks again.
 *
 * The adversary's lab, 2026-09-08: `diagram-c4.effect` was offered to the brain at y=-143 with
 * scrollY 561, and the ring was drawn 143 px above the fold, where the learner cannot look.
 */

import { describe, expect, it } from 'bun:test';
import type { GlassBox, GlassCandidate } from '../src/glass/map';
import { figurePartHandle, joinTextRuns, measureHandle, scrollTarget } from '../src/glass/read';

const PHONE = { w: 390, h: 844 };

let order = 0;
function at(
  role: GlassCandidate['role'],
  text: string,
  box: GlassBox,
  extra: Partial<GlassCandidate> = {},
): { candidate: GlassCandidate } {
  const [x, y, w, h] = box;
  const ix = Math.max(0, Math.min(x + w, PHONE.w) - Math.max(x, 0));
  const iy = Math.max(0, Math.min(y + h, PHONE.h) - Math.max(y, 0));
  return {
    candidate: {
      role,
      text,
      box,
      order: order++,
      visible: w <= 0 || h <= 0 ? 0 : (ix * iy) / (w * h),
      ...extra,
    },
  };
}

describe('what the freeze scrolls onto the glass before it reads', () => {
  it('scrolls to the part the question names when it is above the fold', () => {
    order = 0;
    const pending = [
      at('line', 'one idea, in one line, about balance', [24, 120, 342, 22]),
      at('figure', 'diagram: Predict, then check', [24, -260, 342, 190]),
      at('figure-part', 'effect', [220, -143, 72, 72], { meaning: 'part:effect' }),
    ];
    const index = scrollTarget(pending, 'circle the effect circle in the diagram');
    expect(index).toBe(2);
    expect(pending[index]?.candidate.text).toBe('effect');
  });

  it('holds the glass exactly as it is when what the words name is already in view', () => {
    order = 0;
    const pending = [
      at('figure-part', 'effect', [220, 380, 72, 72], { meaning: 'part:effect' }),
      at('figure-part', 'effect', [220, -143, 72, 72], { meaning: 'part:effect' }),
    ];
    expect(scrollTarget(pending, 'circle the effect circle in the diagram')).toBe(-1);
  });

  it('does not chase an ordinary line that happens to share one word', () => {
    order = 0;
    const pending = [
      at('line', 'the balance of the two sides', [24, 2000, 342, 22]),
      at('line', 'in view, about nothing', [24, 120, 342, 22]),
    ];
    expect(scrollTarget(pending, 'why does the balance hold?')).toBe(-1);
  });

  it('goes to the line the words name twice, wherever it is on the page', () => {
    order = 0;
    const pending = [
      at('line', 'the sign flips when the term crosses the equals', [24, 2000, 342, 22]),
      at('line', 'in view, about nothing', [24, 120, 342, 22]),
    ];
    expect(scrollTarget(pending, 'why does the sign flip when the term crosses?')).toBe(0);
  });

  it('never scrolls to app furniture, and never to what a sheet covers', () => {
    order = 0;
    const chrome = [
      at('heading', 'the sign flips: chapter', [24, -400, 342, 30], { chrome: true }),
    ];
    expect(scrollTarget(chrome, 'why does the sign flip when the term crosses?')).toBe(-1);
    order = 0;
    const covered = [
      at('step', 'the sign flips when the term crosses', [24, -400, 342, 30], {
        occluded: true,
        meaning: 'step:3',
      }),
    ];
    expect(scrollTarget(covered, 'why does the sign flip when the term crosses?')).toBe(-1);
  });

  it('a question of stop words alone moves nothing', () => {
    order = 0;
    const pending = [at('step', 'do it', [24, -400, 342, 30], { meaning: 'step:3' })];
    expect(scrollTarget(pending, 'what about this one?')).toBe(-1);
    expect(scrollTarget(pending, '')).toBe(-1);
  });
});

/**
 * THE WORDS AS A PERSON READS THEM (the adversary, 2026-09-09, finding 10).
 *
 * The course outline draws its number in its own span, `<span>1</span>meet a square and a cube`,
 * and `textContent` glues the two with nothing between them. The glass carried "1meet a square
 * and a cube" and "2feel the rule", so the lasso sent — and the transcript printed as the
 * learner's own words — `explain this: "2feel the rule"` on all fourteen world lasso turns.
 */
describe('the words a run of text really says', () => {
  const run = (text: string, box: [number, number, number, number] | null, breaks = true) => ({
    text,
    box: box ? { left: box[0], top: box[1], right: box[2], bottom: box[3] } : null,
    breaks,
  });

  it('puts the space back between an ordinal and the line it numbers', () => {
    // <span style="margin-right:10px">1</span>meet a square and a cube
    expect(
      joinTextRuns([
        run('1', [404, 653, 411, 677], false),
        run('meet a square and a cube', [421, 653, 610, 677]),
      ]),
    ).toBe('1 meet a square and a cube');
  });

  it('never breaks a word that markup happened to split', () => {
    // <b>hyp</b>otenuse — the two runs touch, so they are one word.
    expect(
      joinTextRuns([run('hyp', [10, 0, 34, 20], false), run('otenuse', [34, 0, 90, 20])]),
    ).toBe('hypotenuse');
  });

  it('breaks at a line wrap even when the runs are one element', () => {
    expect(
      joinTextRuns([
        run('the square on the', [10, 0, 200, 20], false),
        run('hypotenuse', [10, 22, 90, 42], false),
      ]),
    ).toBe('the square on the hypotenuse');
  });

  it('falls back to the markup boundary when there is no layout to read', () => {
    expect(joinTextRuns([run('1', null, false), run('meet a square and a cube', null)])).toBe(
      '1 meet a square and a cube',
    );
  });

  it('leaves the page its own spacing alone', () => {
    expect(
      joinTextRuns([run('Step ', [10, 0, 50, 20], false), run('3', [50, 0, 58, 20])]),
    ).toBe('Step 3');
  });
});

describe('a figure part measures the thing it advertises (the adversary, wave 47, finding 5)', () => {
  // `figureParts` offered `diagram-c4.effect` to the brain as [698,411,64,64] — the union of the
  // <text> label and the circle it sits on — but handed back a handle to the <text> node alone.
  // `rectOf` therefore returned the words' box and the instant ring landed at [705,426,48,34]:
  // INSIDE the circle the learner named, 7 to 9 px in on every side. The map and the pen have to
  // read the same box.
  const el = (x: number, y: number, w: number, h: number) =>
    ({
      getBoundingClientRect: () => ({
        x,
        y,
        width: w,
        height: h,
        left: x,
        top: y,
        right: x + w,
        bottom: y + h,
      }),
    }) as unknown as Element;

  it('re-measures a label as the union of the label and the shape it names', () => {
    const circle = el(698, 411, 64, 64);
    const text = el(705, 426, 48, 34);
    expect(measureHandle(figurePartHandle(text, circle))).toEqual([698, 411, 64, 64]);
  });

  it('falls back to the label alone when it sits on nothing', () => {
    const text = el(705, 426, 48, 34);
    expect(measureHandle(figurePartHandle(text, null))).toEqual([705, 426, 48, 34]);
  });

  it('follows both boxes when the figure moves under a scroll', () => {
    let dy = 0;
    const moving = (x: number, y: number, w: number, h: number) =>
      ({
        getBoundingClientRect: () => ({
          x,
          y: y - dy,
          width: w,
          height: h,
          left: x,
          top: y - dy,
          right: x + w,
          bottom: y - dy + h,
        }),
      }) as unknown as Element;
    const handle = figurePartHandle(moving(705, 426, 48, 34), moving(698, 411, 64, 64));
    dy = 120;
    expect(measureHandle(handle)).toEqual([698, 291, 64, 64]);
  });

  it('drops a part whose shape and label have both gone', () => {
    const gone = el(0, 0, 0, 0);
    expect(measureHandle(figurePartHandle(gone, null))).toBe(null);
  });
});
