/**
 * THE FREEZE, MEASURED AGAINST THE PEN (docs/INK-FREEZE-PLAN-TRACE.md §3, Timing;
 * docs/INK-FOUR.md, timing: "The page is held still only while a stroke is in flight").
 *
 * Two laws the adversary took the glass to on 2026-09-10, both in wobo/board-turn.ts:
 *
 *  1. THE PAGE IS THE LEARNER'S BETWEEN THE STROKES. A plan whose marks are spaced across the
 *     sentences that name them lands them all at once and schedules each for its own moment. The
 *     conductor used to hold the glass from the first landing to the LAST SCHEDULED stroke's end,
 *     which is not "in flight": live at 1440 on "circle the hypotenuse" the glass was taken again
 *     when the plan arrived at 5584 ms and let go by the CAP at 11592 — six seconds of a frozen
 *     page in the middle of an answer, with nothing being drawn for most of it.
 *
 *  2. THE LAST TURN'S INK IS GONE BEFORE THIS TURN'S FIRST WORD. The lift happens at the ask, but
 *     a fade is 480 ms and the first word can land inside it: measured at 1440 on "show me why",
 *     the previous ring was still in the DOM at 0.05 when Wobo began the new answer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { boardBook, glassHold, plane } from '@wobo/wobo';
import { boardTurn, screenStore } from './board-turn';

type Frame = { data: Record<string, unknown> };
const encode = (frames: Frame[]): string =>
  frames.map((f) => `data: ${JSON.stringify(f.data)}\n\n`).join('');

let realFetch: typeof globalThis.fetch;

function serve(...frames: Frame[]): void {
  globalThis.fetch = (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(encode(frames)));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof globalThis.fetch;
}

const ink = (object: Record<string, unknown>): Frame => ({ data: { type: 'ink', object, t: 0 } });
const say = (text: string): Frame => ({ data: { type: 'say', text, t: 0 } });
const done: Frame = { data: { type: 'done' } };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const run = (onSay?: (text: string) => void) =>
  boardTurn.run({
    gatewayUrl: 'http://brain.test',
    payload: {},
    route: 'learn',
    ...(onSay ? { onSay } : {}),
  });

/**
 * "A stroke is in flight", read the way the pen means it: the freeze is taken a lead ahead of the
 * nib and given back a breath after it lands, so a stroke owns the page from `LEAD` before its
 * start to `SETTLE` after its end, and nothing else does.
 */
const LEAD = 120;
const SETTLE = 80;
function flying(now: number): boolean {
  return screenStore.snapshot().some((s) => {
    if (s.removed) return false;
    if (s.fadingAt !== undefined && s.fadingAt <= now) return false;
    return s.startAt - LEAD <= now && now <= s.startAt + (s.durMs ?? 900) + SETTLE;
  });
}
/** A stroke the plan has scheduled but the pen has not reached yet. */
function pending(now: number): boolean {
  return screenStore.snapshot().some((s) => !s.removed && s.startAt > now);
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  screenStore.reset();
  glassHold.reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  boardTurn.interrupt();
  glassHold.reset();
  plane.close();
  for (const id of boardBook.ids()) boardBook.drop(id);
});

describe('the page is held still only while a stroke is in flight', () => {
  it('lets the page go between two strokes of one plan, and takes it back for the second', async () => {
    // One sentence, two marks: the second is spaced 1200 ms after the first by the plan's own
    // clock, so both frames land together and the pen reaches the second more than a second later.
    serve(
      say('Look at the top line here.'),
      ink({
        id: 'first',
        kind: 'circle',
        anchor: { target: 'row-1' },
        beat: { with: 0 },
        t: { start: 0, dur: 1 },
      }),
      ink({
        id: 'second',
        kind: 'circle',
        anchor: { target: 'row-2' },
        beat: { with: 0 },
        t: { start: 1200, dur: 300 },
      }),
      done,
    );
    const running = run();
    const samples: { at: number; held: boolean; flying: boolean; pending: boolean }[] = [];
    for (let i = 0; i < 130; i += 1) {
      const now = screenStore.time();
      samples.push({ at: i * 16, held: glassHold.held, flying: flying(now), pending: pending(now) });
      await wait(16);
    }
    await running;

    // The gap is real: the plan put a stroke more than a second out, and it was drawn.
    const gap = samples.filter((s) => !s.flying && s.pending);
    expect(gap.length).toBeGreaterThan(20);
    const drew = samples.filter((s) => s.flying);
    expect(drew.length).toBeGreaterThan(3);
    // And for all of that gap the page belonged to the learner.
    expect(gap.filter((s) => s.held).map((s) => s.at)).toEqual([]);
    // While the pen was actually on the glass, the page was held. (A sample can catch the tick
    // that takes the glass, so this is a majority and not every last frame.)
    expect(drew.filter((s) => s.held).length).toBeGreaterThan(drew.length / 2);
  }, 10_000);
});

describe("the last turn's ink is gone before this turn's first word", () => {
  it('a plain spoken turn: the ask lifts the ring, and the lift ends — it is not a whole fade', async () => {
    serve(
      ink({ id: 'ring', kind: 'circle', anchor: { target: 'row-2' }, t: { start: 0, dur: 1 } }),
      { data: { type: 'ask', prompt: 'Which step is wrong?', targets: [] } },
      done,
    );
    await run();
    expect(screenStore.get('ring')?.fadingAt).toBeUndefined();

    // "show me why" at 1440 draws nothing and runs no conductor at all: the only thing the board
    // hears is the ask itself. Wobo's line is on the glass at 255 ms and spoken at 503; the ring
    // has to be gone before that, and an ordinary fade (480 ms + a sweep) is not.
    boardTurn.answered();
    await wait(120);
    const early = screenStore.get('ring');
    expect(early !== undefined && !early.removed).toBe(true);
    await wait(120);
    const late = screenStore.get('ring');
    expect(late === undefined || late.removed).toBe(true);
  }, 10_000);

  it('cuts the tail of a lift that would otherwise outlive the first word', async () => {
    serve(
      ink({ id: 'ring', kind: 'circle', anchor: { target: 'row-2' }, t: { start: 0, dur: 1 } }),
      { data: { type: 'ask', prompt: 'Which step is wrong?', targets: [] } },
      done,
    );
    await run();
    expect(screenStore.get('ring')).toBeDefined();

    // The learner asks the next thing: the lift begins here, as it does at the ask in the app.
    boardTurn.answered();
    // The round trip. By the time Wobo speaks, the lift is all but finished — and what is left of
    // it is what the adversary measured still standing under the new answer.
    await wait(420);

    serve(say('Here is the new answer.'), done);
    let atFirstWord: { present: boolean } | null = null;
    await run(() => {
      if (atFirstWord === null) {
        const state = screenStore.get('ring');
        atFirstWord = { present: state !== undefined && !state.removed };
      }
    });
    expect(atFirstWord).not.toBeNull();
    expect(atFirstWord as unknown as { present: boolean }).toEqual({ present: false });
  }, 10_000);

  it('never cuts a lift at full weight: a fresh one keeps its own first beat, then goes', async () => {
    serve(
      ink({ id: 'ring', kind: 'circle', anchor: { target: 'row-2' }, t: { start: 0, dur: 1 } }),
      { data: { type: 'ask', prompt: 'Which step is wrong?', targets: [] } },
      done,
    );
    await run();
    expect(screenStore.get('ring')).toBeDefined();

    // No round trip at all: the word lands while the lift has only just begun.
    boardTurn.answered();
    serve(say('Here is the new answer.'), done);
    let atFirstWord: { present: boolean } | null = null;
    const running = run(() => {
      if (atFirstWord === null) {
        const state = screenStore.get('ring');
        atFirstWord = { present: state !== undefined && !state.removed };
      }
    });
    // It is still there as the word lands — nothing blinks out at full weight.
    await wait(60);
    expect(atFirstWord as unknown as { present: boolean }).toEqual({ present: true });
    // And it does not hang about either: the word's handover comes back for it the moment the
    // lift has had its own first beat, long before the fade would have run out (480 + a sweep).
    await wait(220);
    const after = screenStore.get('ring');
    expect(after === undefined || after.removed).toBe(true);
    await running;
  }, 10_000);
});
