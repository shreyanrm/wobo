import { beforeAll, describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { type BoardFrame, type BoardRect, frameOf } from '../../src/board/anchors';
import { type HandFont, parseHandFont } from '../../src/board/handwriting';
import { CAMERA_FILL_MAX } from '../../src/board/layout';
import {
  buildObjects,
  MAX_TYPE_SCALE,
  type Rung,
  settleBoardScales,
} from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';

/**
 * WHERE THE TYPE LADDER STOPS (the judge, wave 61, finding 1; INK-FOUR timing and craft).
 *
 * `settleBoardScales` walks a ladder of written-type factors, lays the board for real at each rung
 * and measures it on BOTH laws — the twelve-pixel floor and the twenty-four-pixel reach. Wave 60
 * made each lay cheap. What it did not do was stop the walk: on the morning of 2026-09-15, while
 * the projectile's 'greatest height' still had nowhere lawful to stand at any width, that board was
 * laid twenty-five times at 1440 to reach an answer two rungs of the ladder already held.
 *
 * MEASURED ON THE SIXTEEN AS THEY STOOD AT b281c5c, the full climb against the ended climb, six
 * runs. Full: 138 lays and 955 to 1,131 ms, the projectile 25 lays and 261 to 302 ms at 1440, 23
 * and 223 to 251 at 390; twelve of the sixteen met the aim on the first rung and took three to five
 * lays each. Ended: 118 lays and 746 to 865 ms, the projectile 10 and 117 to 171 at 1440, 18 and
 * 164 to 184 at 390; the lens does not move at all, because it is lawful on its first rung. The
 * projectile's four extra rungs at 1440 read 13.69 px of type against 53.2 px of reach, 17.57
 * against 67.2, 18.20 against 59.8 and 17.81 against 68.5 — every one of them worse on the very law
 * that was failing. Every rung all sixteen settle on, and both numbers each is judged by, identical
 * to four decimal places.
 *
 * THE LAW THE LADDER WAS MISSING. Its one instrument is a BIGGER HAND. So when a rung already
 * writes large enough to clear the type aim and the reach is not merely short of its aim but past
 * the LAW, what is failing is the room around the subject, and every rung above takes more of that
 * room, not less. There is nothing up there for this board: the climb ends, and the board is
 * reported as too dense for its surface, which is the pipeline's answer to give and not the hand's.
 *
 * AND WHY IT ONLY HOLDS WHILE NOTHING IS LAWFUL. Once a rung clears both laws the ladder has
 * stopped asking whether the board can be drawn and started choosing between rungs that can, and
 * that choice needs every one of them. Measured that same morning: the lens at 1440 was lawful on
 * its first rung with 1.2 px of type to spare and lawful again on its last with 4.2, and the last
 * is the one a browser's own re-measure cannot unseat — so the lens walked its whole ladder then
 * and would walk it again.
 *
 * AND THE CLIMB NEVER ENDS WITHOUT LAYING THE LADDER'S OWN EXTREME. The argument above is about a
 * board, not a proof about every board — the rungs are not monotone in either law — so the last
 * rung is laid anyway before the climb stops. What is skipped is the middle, which is where the
 * wasted lays were.
 *
 * NO NUMBER ABOVE IS ASSERTED HERE, and that is deliberate. The same afternoon those numbers were
 * taken, the pipelines gave the projectile and the lens their room back and every count changed:
 * the sixteen now settle in 67 lays and the climb ends nowhere. A test that pinned the counts would
 * have gone red at another builder's correct work. So the guard below RUNS the ladder as it was —
 * `climbAll`, every rung walked, the ending off — and requires the two answers to be the same rung
 * on whatever boards the tree holds. That is the claim the ending has to earn: a faster ladder that
 * moved one board's rung would have bought the timing lens with the craft lens, which is the trade
 * INK-FOUR forbids.
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

/** The board plane's own canvas, measured on the running app — the surface `written-cost` uses. */
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

/** One settle, with the board's lays counted — the ruler that reads the same on every machine. */
function settle(
  plan: BoardObject[],
  frame: BoardFrame,
  climbAll = false,
): { rung: Rung; lays: number; laid: number[] } {
  let lays = 0;
  const laid: number[] = [];
  const lay = (typeScale: number, glassScale: number) => {
    lays += 1;
    if (!laid.includes(typeScale)) laid.push(typeScale);
    const states = plan.map((object, i) => ({ object, generation: 0, seq: i }));
    const boxes = new Map<string, BoardRect>();
    return buildObjects(
      states as never,
      {
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
      } as never,
    );
  };
  const rung = settleBoardScales(lay, frame, true, CAMERA_FILL_MAX, { climbAll });
  return { rung, lays, laid };
}

const frameFor = (name: string) => SURFACE[name.endsWith('1440') ? '1440' : '390'] as BoardFrame;

describe('the type ladder stops where type stops being the question', () => {
  it('no board is ever laid MORE times than the full climb would lay it', () => {
    const worse: string[] = [];
    for (const { name, plan } of PLANS) {
      const frame = frameFor(name);
      const now = settle(plan, frame).lays;
      const all = settle(plan, frame, true).lays;
      if (now > all) worse.push(`${name} laid ${now} times against the full climb's ${all}`);
    }
    expect(worse).toEqual([]);
  });

  it('a board that has proved itself unplaceable is not climbed any further', () => {
    /**
     * Not a fixture but a board built to be unsatisfiable, so the law is held whatever the sixteen
     * happen to be on the day. Seven long captions hung off one point: the hand's own sizes already
     * clear the type floor (13.41 px) and the reach cannot be met at any rung of the ladder (72.3,
     * 72.0, 72.6, 113.7, 109.7 px against a law of 24) — the exact shape the projectile had on the
     * morning this was written.
     *
     * THE RUNG IS NOT ASSERTED HERE, and the reason is the honest bound on what the exit can cost.
     * Among rungs that are ALL unlawful the least-bad one can move: the full climb reads 47.97 px
     * over the law at 1.25 and the ended climb reads 48.27 at 1, three tenths of a pixel apart on a
     * board that is seventy-two pixels outside its law either way. A board in that state is not
     * rendered on a judgement, it is REPORTED — `written-placement.test.ts` is already red on it,
     * and the answer belongs to the pipeline that built it. Where any rung is lawful the exit cannot
     * fire at all, and the sixteen below show the rung is identical there.
     */
    const frame = frameFor('x-390');
    const crowded: BoardObject[] = [
      { id: 'dot', kind: 'point', anchor: { board: [500, 500] } },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `n${i}`,
        kind: 'label',
        anchor: { object: 'dot', at: 'right' },
        text: 'the greatest height reached here',
      })),
    ] as unknown as BoardObject[];
    const now = settle(crowded, frame);
    const all = settle(crowded, frame, true);
    expect(now.lays).toBeLessThan(all.lays);
    // And the ladder's own extreme was still laid, so a board that only becomes lawful under the
    // biggest hand could not have been walked past.
    expect(now.laid).toContain(MAX_TYPE_SCALE);
  });

  it('nor is a board climbed whose writing the whole ladder could not carry to the floor', () => {
    /**
     * The mirror of the case above, and the second clause of `spent` in `settleBoardScales`: a
     * board so far under the type floor that the ladder's whole range cannot cover the distance.
     * Two strays in opposite corners make the camera fit a thousand units into a phone's plane, and
     * the writing reads 2.98 px at the first rung and 5.87 px at the top against a floor of 12 —
     * the biggest hand the ladder owns cannot double 2.98 into 12, and fifteen lays were being
     * spent to learn what the first two say.
     */
    const frame = frameFor('x-390');
    const tiny: BoardObject[] = [
      { id: 'dot', kind: 'point', anchor: { board: [500, 500] } },
      { id: 'n1', kind: 'label', anchor: { object: 'dot', at: 'right' }, text: 'the apex' },
      { id: 'n2', kind: 'label', anchor: { object: 'dot', at: 'left' }, text: 'the speed' },
      { id: 'far', kind: 'label', anchor: { board: [40, 40] }, text: 'x' },
      { id: 'far2', kind: 'label', anchor: { board: [960, 960] }, text: 'y' },
    ] as unknown as BoardObject[];
    const now = settle(tiny, frame);
    const all = settle(tiny, frame, true);
    expect(now.lays).toBeLessThan(all.lays);
    expect(now.laid).toContain(MAX_TYPE_SCALE);
    // Under the floor at every rung, so the answer is the same least-bad one either way.
    expect(now.rung.typeScale).toBe(all.rung.typeScale);
  });
});

describe('and it settles on exactly the rung the full climb settles on', () => {
  for (const { name, plan } of PLANS) {
    it(`${name}: the same rung, the same two scalars, the same two measurements`, () => {
      const frame = frameFor(name);
      const now = settle(plan, frame).rung;
      const all = settle(plan, frame, true).rung;
      const part = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);
      expect({
        typeScale: now.typeScale === all.typeScale,
        glassScale: part(now.glassScale, all.glassScale),
        typePx: part(now.typePx, all.typePx),
        gapPx: part(now.gapPx, all.gapPx),
      }).toEqual({ typeScale: true, glassScale: true, typePx: true, gapPx: true });
    });
  }
});
