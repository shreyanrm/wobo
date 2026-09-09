/**
 * The conductor, driven end to end over a fake wire (docs/BOARD.md §4, §5).
 *
 * Three laws are asserted here that nothing below the conductor can assert on its own, because they
 * are about the seam between the stream, the surfaces and the learner:
 *
 *  · a turn holds TWO surfaces — a mark about the screen stays on the screen even when the same turn
 *    opens a board, so the board never sits over the thing the mark is pointing at;
 *  · barging in is not a failure — the pen lifts, the voice stops, the turn ends quietly;
 *  · a dropped connection resumes from the last frame that landed, rather than asking again.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { boardBook, glassHold, plane } from '@wobo/wobo';
import { boardTurn, dismissBoard, isAbort, screenStore } from './board-turn';

type Frame = { id?: string; data: Record<string, unknown> };

const encode = (frames: Frame[]): string =>
  frames.map((f) => `${f.id ? `id: ${f.id}\n` : ''}data: ${JSON.stringify(f.data)}\n\n`).join('');

interface Call {
  url: string;
  lastEventId: string | null;
}

const calls: Call[] = [];
let realFetch: typeof globalThis.fetch;

/** What the gateway does on one call: hand over these frames, then close, drop, or never end. */
type Reply = { frames: Frame[]; ends: 'close' | 'drop' | 'hang' };

const closes = (...frames: Frame[]): Reply => ({ frames, ends: 'close' });
const drops = (...frames: Frame[]): Reply => ({ frames, ends: 'drop' });
const hangs = (): Reply => ({ frames: [], ends: 'hang' });

/**
 * A gateway that answers each call with the next reply. Aborting the request tears the stream down
 * the way a real one does — that is the whole behaviour under test in the barge-in cases.
 */
function serve(...replies: Reply[]): void {
  let n = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), lastEventId: headers.get('last-event-id') });
    const reply = replies[Math.min(n++, replies.length - 1)] as Reply;
    const signal = init?.signal ?? null;
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () => {
          try {
            controller.error(new DOMException('aborted', 'AbortError'));
          } catch {
            // already torn down
          }
        });
      },
      pull(controller) {
        if (!sent) {
          sent = true;
          if (reply.frames.length > 0) {
            controller.enqueue(new TextEncoder().encode(encode(reply.frames)));
          }
          if (reply.ends === 'close') controller.close();
          return;
        }
        if (reply.ends === 'close') {
          controller.close();
          return;
        }
        if (reply.ends === 'drop') {
          controller.error(new TypeError('network error'));
          return;
        }
        return new Promise<void>(() => {}); // hangs: the turn is still streaming
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;
}

const ink = (object: Record<string, unknown>, id?: string): Frame => ({
  ...(id ? { id } : {}),
  data: { type: 'ink', object, t: 0 },
});

const RING = {
  id: 'ring',
  kind: 'circle',
  anchor: { focus: 'f1' },
  pad: 10,
  t: { start: 0, dur: 1 },
};
const AXIS = {
  id: 'x',
  kind: 'axis',
  anchor: { board: [120, 500] },
  orientation: 'x',
  min: 0,
  max: 10,
  step: 1,
  length: 400,
  t: { start: 0, dur: 1 },
};

const run = () =>
  boardTurn.run({ gatewayUrl: 'http://brain.test', payload: {}, route: 'learn', title: 't' });

beforeEach(() => {
  calls.length = 0;
  realFetch = globalThis.fetch;
  screenStore.reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  plane.dismiss();
  // `dismiss` only forgets a board that was closed empty, and these turns leave ink on the session's
  // board. The plane and its book are ONE module-level thing shared by every test in the run, so a
  // board left inked here is a board the next file inherits: put the book back to rest.
  for (const id of boardBook.ids()) boardBook.drop(id);
});

describe('a turn that has both a mark and a diagram in it', () => {
  it('keeps the mark on the screen and opens the board for the diagram', async () => {
    serve(closes(ink(RING), ink(AXIS), { data: { type: 'done', objects: 2 } }));
    const outcome = await run();

    expect(outcome.presentation).toBe('plane');
    const onScreen = screenStore.snapshot().map((s) => s.object.id);
    // The ring is still on the film the learner circled — it did not travel to the board.
    expect(onScreen).toEqual(['ring']);

    const board = boardBook
      .get(plane.get().boardId)
      .snapshot()
      .map((s) => s.object.id);
    expect(board).toEqual(['x']);
  });

  it('carries only board-bound ink across a promotion', async () => {
    // Two screen marks, then four steps of a derivation: the derivation moves, the marks do not.
    const step = (id: string) => ({
      id,
      kind: 'write',
      anchor: { object: 'p9' },
      text: 'so a squared',
      t: { start: 0, dur: 1 },
    });
    serve(
      closes(ink(RING), ink(step('s1')), ink(step('s2')), ink(step('s3')), ink(step('s4')), {
        data: { type: 'done' },
      }),
    );
    await run();

    expect(screenStore.snapshot().map((s) => s.object.id)).toEqual(['ring']);
    expect(
      boardBook
        .get(plane.get().boardId)
        .snapshot()
        .map((s) => s.object.id),
    ).toEqual(['s1', 's2', 's3', 's4']);
  });
});

describe('barging in', () => {
  it('is an ending, not an error', async () => {
    serve(hangs());
    const running = run();
    await Promise.resolve();
    boardTurn.interrupt();
    const outcome = await running;
    expect(outcome.completed).toBe(false);
  });

  it('names the abort for what it is', () => {
    const controller = new AbortController();
    controller.abort();
    expect(isAbort(controller.signal.reason)).toBe(true);
    expect(isAbort(new Error('something else'))).toBe(false);
  });
});

/**
 * THE CAP IS NOT THE LEARNER (the adversary, 2026-09-09, findings 3 and 10).
 *
 * Wave 40 counted a flat six seconds from the moment the glass was held — before the request had
 * even left — and the wire's first byte lives at 6.0-8.5 s. Every live course turn recorded
 * `release:cap` at 6032 ms, the conductor read it as a barge-in, and the answer the gateway had
 * already been paid for was aborted: empty transcript, no ink, voice billed for words never
 * written. A cap hands the PAGE back to the learner; it never takes the ANSWER away.
 */
describe('the glass cap while the wire is still silent', () => {
  it('does not abort the turn, and the ink that finally arrives still lands', async () => {
    let push: ((frames: Frame[]) => void) | null = null;
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (frames) => {
            controller.enqueue(new TextEncoder().encode(encode(frames)));
            controller.close();
          };
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    const running = run();
    await Promise.resolve();
    // Six seconds of silence: the cap lets the page go while the turn is still waiting.
    glassHold.hold('turn');
    glassHold.release('cap');
    await new Promise((r) => setTimeout(r, 0));
    expect(boardTurn.get().active).toBe(true);

    // ...and then the gateway finally speaks.
    (push as ((frames: Frame[]) => void) | null)?.([
      ink(RING),
      { data: { type: 'done', objects: 1 } },
    ]);
    const outcome = await running;
    expect(outcome.objects).toBe(1);
    expect(screenStore.snapshot().map((s) => s.object.id)).toEqual(['ring']);
  });

  it("the learner's own hand still cuts the turn off in one tick", async () => {
    serve(hangs());
    const running = run();
    await Promise.resolve();
    glassHold.hold('turn');
    glassHold.release('tap');
    const outcome = await running;
    expect(outcome.completed).toBe(false);
  });
});

describe('a dropped connection', () => {
  it('resumes from the last frame that landed rather than asking again', async () => {
    serve(drops(ink(RING, 'turn-7:0')), closes({ data: { type: 'done' } }));
    await run();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.lastEventId).toBe(null);
    // The whole point: the brain is told where to carry on from, so the turn is not paid for twice.
    expect(calls[1]?.lastEventId).toBe('turn-7:0');
  });

  it('never resumes a turn that had not acknowledged a single frame', async () => {
    serve(drops(), closes({ data: { type: 'done' } }));
    await expect(run()).rejects.toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(1);
  });

  it('does not resume when the learner is the one who stopped it', async () => {
    serve(hangs());
    const running = run();
    await Promise.resolve();
    boardTurn.interrupt();
    await running;
    expect(calls).toHaveLength(1);
  });
});

describe('the board opens only when there is something new to build (the owner, 2026-09-05)', () => {
  it('never opens an empty board because the brain named the plane', async () => {
    // A plan with nothing in it that still says "plane": the failure was an empty board sliding
    // over the thing the learner was reading, with nothing on it.
    serve(closes({ data: { type: 'done', presentation: 'plane', objects: 0 } }));
    const outcome = await run();

    expect(outcome.objects).toBe(0);
    expect(plane.get().open).toBe(false);
    expect(outcome.presentation).toBe('screen');
  });

  it('keeps a mark about the screen on the screen and leaves the board shut', async () => {
    const chip = { ...RING, anchor: { target: 'tri-hyp' } };
    serve(closes(ink(chip), { data: { type: 'done', presentation: 'screen', objects: 1 } }));
    const outcome = await run();

    expect(outcome.presentation).toBe('screen');
    expect(plane.get().open).toBe(false);
    expect(screenStore.snapshot().map((s) => s.object.id)).toEqual(['ring']);
  });
});

describe('wipe and put away tell the truth (wave 29, board-1 and board-2)', () => {
  const circle = (id: string) =>
    ({ id, kind: 'circle', anchor: { board: [100, 100] }, pad: 8 }) as never;
  it('wipe clears the board in front of the learner and says how much went', () => {
    // Between turns `state.presentation` still names the LAST turn's surface; the board in front is
    // the plane while it is open. Wipe reads the surfaces, not the stale field.
    const id = plane.fresh();
    boardBook.get(id).ink(circle('a'));
    boardBook.get(id).ink(circle('b'));
    expect(boardTurn.wipe()).toBe(2);
    expect(boardBook.get(id).snapshot().length).toBe(0);
    // a second wipe has nothing to say
    expect(boardTurn.wipe()).toBe(0);
    plane.close();
    boardBook.drop(id);
  });
  it('put away answers whether a board actually went', () => {
    expect(plane.get().open).toBe(false);
    expect(dismissBoard()).toBe(false);
    const id = plane.fresh();
    expect(dismissBoard()).toBe(true);
    expect(plane.get().open).toBe(false);
    boardBook.drop(id);
  });
});
