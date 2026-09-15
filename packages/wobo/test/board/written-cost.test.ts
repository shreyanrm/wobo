import { beforeAll, describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { type BoardFrame, type BoardRect, frameOf } from '../../src/board/anchors';
import { type HandFont, parseHandFont } from '../../src/board/handwriting';
import { CAMERA_FILL_MAX, traceWritten } from '../../src/board/layout';
import { buildObjects, settleBoardScales } from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';

/**
 * WHAT THE HAND'S SEARCH COSTS (the adversary, wave 60, finding 1; INK-FOUR timing).
 *
 * Wave 60's solver bought the craft counts with time. Measured on this tree the day this file was
 * written, before a line of it was changed: the sixteen from-scratch boards settled in 2,687 to
 * 2,712 ms all told — the projectile 896 ms at 1440 and 632 at 390, the lens 436 and 400, against
 * 7 to 59 for every other board — and on the glass the first ink after the ask went from wave 58's 437 to
 * 864 ms to 2,883 and 3,936. Four turns that had passed the timing lens failed it.
 *
 * TWO THINGS COST, AND ONLY ONE OF THEM IS THIS FILE'S. A board is laid once per rung of the type
 * ladder and once per step of the glass settle — the projectile twenty-six times, every board that
 * meets the aim four or five — and each lay pays for the hand's own phrase measuring in
 * `geometry.ts` and for the search in `layout.ts`. The lay count is `settleBoardScales`; the
 * measuring is `noteShape`. The SEARCH is `solveWritten`, and the search was the part that had
 * grown: on the projectile at 1440 it was 218 ms of the 896, and it built 1.5 million candidate
 * rectangles and 2 million dedupe strings to do it.
 *
 * So this file holds the search to a budget, two ways, and it is honest about which ruler shows
 * what. The CLOCK is the ruler the learner reads and the one that moved: 2,687 ms for the sixteen
 * became 1,608, and the projectile's 896 became 499, because the search stopped making a rectangle
 * and a dedupe string for every position it was about to throw away and stopped walking positions
 * whose answer it already held. The WORK — how many positions the solver carries and how many it
 * grades — barely moved on the boards that cannot be satisfied, and that is the point of having it
 * here: it is the same number on every machine, so it is what catches the search GROWING again,
 * the way it grew in wave 60. A clock alone would let a faster machine hide that; a counter alone
 * would have let this wave's own repair look like nothing.
 *
 * THIS FILE MAKES NO CLAIM ABOUT WHERE THE INK LANDS. `written-placement`, `written-ink-law` and
 * `written-air` hold that, and they are run beside this one on purpose: a cheaper search that moves
 * one mark has not made the hand faster, it has spent the craft lens to buy the timing lens, which
 * is the trade this wave exists to stop.
 */

const FONT_PATH = new URL(
  '../../../../apps/web-pwa/public/fonts/Caveat-Regular.ttf',
  import.meta.url,
).pathname;
const BOARDS = new URL('./fixtures/boards', import.meta.url).pathname;

let font: HandFont | null = null;
beforeAll(async () => {
  font = await parseHandFont(await Bun.file(FONT_PATH).arrayBuffer());
});

/** The board plane's own canvas, measured on the running app. */
const SURFACE: Record<string, BoardFrame> = {
  '390': frameOf({ x: 12, y: 438.73, width: 366, height: 333.27 }),
  '1440': frameOf({ x: 828, y: 474, width: 496, height: 282 }),
};

const PLANS = readdirSync(BOARDS)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({
    name: f.replace(/\.json$/, ''),
    plan: JSON.parse(readFileSync(`${BOARDS}/${f}`, 'utf8')) as BoardObject[],
  }));

function lay(plan: BoardObject[], frame: BoardFrame, typeScale: number, glassScale = 0) {
  const states = plan.map((object, i) => ({ object, generation: 0, seq: i }));
  const boxes = new Map<string, BoardRect>();
  return buildObjects(states as never, {
    frame,
    font,
    store: { anchorOf: (s: { object: { anchor?: unknown } }) => s.object.anchor ?? null },
    cache: new Map(),
    targets: () => [],
    focus: () => [],
    boxes,
    occupied: [],
    typeScale,
    ...(glassScale > 0 ? { glassScale } : {}),
  } as never);
}

interface Cost {
  /** Wall clock for the whole settle, in ms. */
  ms: number;
  /** Times `solveWritten` was entered across the settle. */
  solves: number;
  /** Candidate positions the search carried, and the ones it graded against the crowd. */
  built: number;
  graded: number;
}

/** One whole settle of one board: exactly what `BoardSurface` does before the plane opens. */
function settleCost(plan: BoardObject[], frame: BoardFrame): Cost {
  let solves = 0;
  let built = 0;
  let graded = 0;
  traceWritten((_solve, _fit, work) => {
    solves += 1;
    built += work.built;
    graded += work.graded;
  });
  try {
    const t0 = Bun.nanoseconds();
    settleBoardScales(
      (typeScale, glassScale) => lay(plan, frame, typeScale, glassScale),
      frame,
      true,
      CAMERA_FILL_MAX,
    );
    return { ms: (Bun.nanoseconds() - t0) / 1e6, solves, built, graded };
  } finally {
    traceWritten(null);
  }
}

/**
 * WHAT ONE SOLVE MAY COST, in candidate positions carried and positions graded.
 *
 * Stated per SOLVE and not per board, because the number of solves a board asks for is the type
 * ladder's and the staged caller's, not the search's; what the search owns is what it does when it
 * is asked once. Measured after the fix, over all sixteen boards at both widths: the worst board
 * carries 2,385 positions per solve and grades 574 of them — the projectile, whose last note has
 * nowhere lawful to go and which therefore runs every stage the solver has. The ceilings are set
 * near half as much again, which is room for a board denser than any of the sixteen and no room at
 * all for the search to go back to walking every position of every shape of every stage.
 */
const BUILT_PER_SOLVE = 3_600;
const GRADED_PER_SOLVE = 900;

/**
 * THE CLOCK, per board and for the sixteen together, in milliseconds of settle.
 *
 * Generous on purpose — a wall clock on a shared machine is a noisy ruler and a flaky law is not a
 * law. Measured after the fix on a quiet machine, five runs: 1,608 to 1,779 ms for the sixteen, the
 * worst board 499 to 560. Before it: 2,687 and 2,712, worst 896 and 901. The ceilings sit a third
 * above the slowest of those runs, which catches a regression of the size this wave repaired
 * without failing on a busy afternoon.
 *
 * WHAT IS STILL IN THESE NUMBERS AND IS NOT THIS FILE'S TO TAKE OUT. Of the projectile's 499 ms at
 * 1440, about 110 is the search; about 230 is `geometry.ts` laying its phrases out for real at
 * every new type size (`noteShape` misses its cache once per size per phrase per lay, and there are
 * twenty-six lays); and about 200 is the rest of `buildObjects` over those same lays. It is
 * twenty-six and not five because `settleBoardScales` walks every rung of the type ladder on a
 * board whose written marks cannot meet the reach aim at ANY rung — and they cannot, measured: on
 * a one-unit scan of every shape the solver may take, 'greatest height' has zero lawful positions
 * inside the law, at either width. Those two costs are not the search's, and the search is the part
 * held here.
 */
const CLOCK_CEILING_MS = 750;
const CLOCK_CEILING_TOTAL_MS = 2_200;

describe('what the hand’s search costs', () => {
  for (const { name, plan } of PLANS) {
    const frame = SURFACE[name.endsWith('1440') ? '1440' : '390'] as BoardFrame;

    it(`${name}: one solve stays inside its budget of candidates`, () => {
      const { solves, built, graded } = settleCost(plan, frame);
      const over: string[] = [];
      if (solves > 0 && built / solves > BUILT_PER_SOLVE)
        over.push(`carried ${(built / solves).toFixed(0)} per solve`);
      if (solves > 0 && graded / solves > GRADED_PER_SOLVE)
        over.push(`graded ${(graded / solves).toFixed(0)} per solve`);
      expect(over).toEqual([]);
    });
  }

  it('every board settles inside the clock, and the sixteen together inside theirs', () => {
    const slow: string[] = [];
    let total = 0;
    for (const { name, plan } of PLANS) {
      const frame = SURFACE[name.endsWith('1440') ? '1440' : '390'] as BoardFrame;
      const { ms } = settleCost(plan, frame);
      total += ms;
      if (ms > CLOCK_CEILING_MS) slow.push(`${name} ${ms.toFixed(0)}ms`);
    }
    expect(slow).toEqual([]);
    expect({ overTotal: total > CLOCK_CEILING_TOTAL_MS }).toEqual({ overTotal: false });
  });

  /**
   * A BOARD WHOSE MARKS ALL LAND WELL STOPS LOOKING (the early exit in `solveWritten`).
   *
   * The grade's fourth place is the shape's own index, so once a candidate is inside the aim, airy
   * and clear of every reserved zone, no later shape can beat it and the rest of the walk buys only
   * time. Before that exit the plant cell graded 527 positions over 25 solves and the timeline 2,278
   * over 40 — every position of every shape, on a board that had its answer in the first few. This
   * holds the exit: a board that meets the aim looks at a handful per solve, not at all of them.
   *
   * The projectile and the lens at 390 are not in this list on purpose. Their last note has nowhere
   * lawful to go, so the search genuinely has to exhaust before it can say so, and what bounds THEM
   * is the per-solve budget above.
   */
  it('a board that meets the aim grades a handful of positions per solve, not all of them', () => {
    const settles = ['bio-plant-cell', 'bio-punnett', 'maths-quadratic', 'social-timeline'];
    const over: string[] = [];
    for (const { name, plan } of PLANS) {
      if (!settles.some((s) => name.startsWith(s))) continue;
      const frame = SURFACE[name.endsWith('1440') ? '1440' : '390'] as BoardFrame;
      const { solves, graded } = settleCost(plan, frame);
      if (solves > 0 && graded / solves > 150)
        over.push(`${name} graded ${(graded / solves).toFixed(0)} per solve`);
    }
    expect(over).toEqual([]);
  });
});
