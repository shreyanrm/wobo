/**
 * The instant mark at the conductor's seam (docs/INK-FOUR.md, "the one thing we do not have").
 *
 *  · the local mark is on the glass before the request is even answered;
 *  · the plan REFINES it: the same target draws no second ring, another target MOVES the one ring;
 *  · a plan that never arrives, or that draws nothing, leaves the local mark standing;
 *  · an interruption lifts it like any other ink.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { boardBook, plane } from '@wobo/wobo';
import { boardTurn, INSTANT_ID, screenStore } from './board-turn';

type Frame = { data: Record<string, unknown> };
const encode = (frames: Frame[]): string =>
  frames.map((f) => `data: ${JSON.stringify(f.data)}\n\n`).join('');

let realFetch: typeof globalThis.fetch;

/** A gateway that takes `delay` ms to say its first word — the live 8.6 to 19.3 seconds, in small. */
function serveAfter(delay: number, ...frames: Frame[]): void {
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal ?? null;
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () => {
          try {
            controller.error(new DOMException('aborted', 'AbortError'));
          } catch {
            // torn down already
          }
        });
      },
      async pull(controller) {
        if (sent) {
          controller.close();
          return;
        }
        sent = true;
        await new Promise<void>((r) => setTimeout(r, delay));
        if (frames.length > 0) controller.enqueue(new TextEncoder().encode(encode(frames)));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;
}

const ink = (object: Record<string, unknown>): Frame => ({ data: { type: 'ink', object, t: 0 } });
const done: Frame = { data: { type: 'done' } };

const INSTANT = {
  target: 'diagram-c4.effect',
  kind: 'ring' as const,
  words: 'the effect',
};

const run = (instant: typeof INSTANT | null = INSTANT) =>
  boardTurn.run({
    gatewayUrl: 'http://brain.test',
    payload: {},
    route: 'learn',
    title: 't',
    ...(instant ? { instant } : {}),
  });

const tick = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The live object under the instant id, if the pen ever put one down. */
const instantOnGlass = () =>
  screenStore.snapshot().find((s) => s.object.id.startsWith(INSTANT_ID) && !s.removed);

const anchorTarget = (state: ReturnType<typeof instantOnGlass>): string | undefined => {
  if (!state) return undefined;
  const anchor = screenStore.anchorOf(state);
  return anchor && 'target' in anchor ? anchor.target : undefined;
};

beforeEach(() => {
  realFetch = globalThis.fetch;
  screenStore.reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  plane.close();
  for (const id of boardBook.ids()) boardBook.drop(id);
});

describe('the stroke starts before the model answers', () => {
  it('the mark is on the glass while the request is still in flight', async () => {
    serveAfter(
      300,
      ink({
        id: 'r1',
        kind: 'ring',
        anchor: { target: 'diagram-c4.effect' },
        t: { start: 0, dur: 1 },
      }),
      done,
    );
    const running = run();
    await tick(40);
    // The gateway has not said a word yet, and the ring is already down.
    const mark = instantOnGlass();
    expect(mark).toBeDefined();
    expect(anchorTarget(mark)).toBe('diagram-c4.effect');
    await running;
  });

  it('draws nothing at all when the resolver aimed at nothing', async () => {
    serveAfter(20, done);
    const running = run(null);
    await tick(40);
    expect(instantOnGlass()).toBeUndefined();
    await running;
  });
});

describe('the model refines, it does not gate', () => {
  it('never draws a second ring beside the first when the plan agrees', async () => {
    serveAfter(
      60,
      ink({
        id: 'r1',
        kind: 'ring',
        anchor: { target: 'diagram-c4.effect' },
        words: 'the effect',
        t: { start: 0, dur: 1 },
      }),
      done,
    );
    await run();
    await tick(40);
    const rings = screenStore.snapshot().filter((s) => !s.removed && s.object.kind === 'ring');
    expect(rings).toHaveLength(1);
    expect(anchorTarget(instantOnGlass())).toBe('diagram-c4.effect');
  });

  it('moves the one ring, once, when the plan names another target', async () => {
    serveAfter(
      60,
      ink({
        id: 'r1',
        kind: 'ring',
        anchor: { target: 'diagram-c4.idea' },
        words: 'the idea',
        t: { start: 0, dur: 1 },
      }),
      done,
    );
    await run();
    await tick(40);
    const rings = screenStore.snapshot().filter((s) => !s.removed && s.object.kind === 'ring');
    expect(rings).toHaveLength(1);
    const mark = instantOnGlass();
    expect(anchorTarget(mark)).toBe('diagram-c4.idea');
    // It went again from the new box rather than appearing there: a teacher correcting a stroke.
    expect((mark?.generation ?? 0) > 0).toBe(true);
  });

  it('takes the plan words over the local ones when it moves', async () => {
    serveAfter(
      60,
      ink({
        id: 'r1',
        kind: 'ring',
        anchor: { target: 'diagram-c4.idea' },
        words: 'the idea',
        t: { start: 0, dur: 1 },
      }),
      done,
    );
    await run();
    await tick(40);
    const mark = instantOnGlass();
    expect(mark).toBeDefined();
    expect((mark?.object as { words?: string } | undefined)?.words).toBe('the idea');
  });

  it('leaves a second, different mark alone: only the first anchored mark reconciles', async () => {
    serveAfter(
      60,
      ink({
        id: 'r1',
        kind: 'ring',
        anchor: { target: 'diagram-c4.effect' },
        t: { start: 0, dur: 1 },
      }),
      ink({
        id: 'n1',
        kind: 'note',
        anchor: { target: 'diagram-c4.idea' },
        text: 'and this',
        t: { start: 0, dur: 1 },
      }),
      done,
    );
    await run();
    await tick(60);
    const live = screenStore.snapshot().filter((s) => !s.removed);
    expect(live.filter((s) => s.object.kind === 'ring')).toHaveLength(1);
    expect(live.filter((s) => s.object.kind === 'note')).toHaveLength(1);
  });
});

describe('the words come from the core, in one voice', () => {
  const withSay = () =>
    boardTurn.run({
      gatewayUrl: 'http://brain.test',
      payload: {},
      route: 'learn',
      title: 't',
      instant: { ...INSTANT, say: 'The effect changes.' },
      onSay: (text) => lines.push(text),
    });
  let lines: string[] = [];

  beforeEach(() => {
    lines = [];
  });

  it('says the core sentence first, before the model has said anything', async () => {
    serveAfter(200, { data: { type: 'say', text: 'And here is why.', t: 0 } }, done);
    await withSay();
    await tick(40);
    expect(lines[0]).toBe('The effect changes.');
    expect(lines).toContain('And here is why.');
  }, 15000);

  it('never says it twice when the plan says the same thing', async () => {
    serveAfter(
      60,
      { data: { type: 'say', text: 'The effect changes.', t: 0 } },
      { data: { type: 'say', text: 'Watch it move.', t: 0 } },
      done,
    );
    await withSay();
    await tick(40);
    const said = lines.filter((l) => l.startsWith('The effect changes'));
    expect(said).toHaveLength(1);
    expect(lines).toContain('Watch it move.');
  }, 15000);
});

describe('the local mark stands when the model does not', () => {
  it('a plan with no ink leaves the mark where it is', async () => {
    serveAfter(40, { data: { type: 'say', text: 'Here it is.', t: 0 } }, done);
    await run();
    await tick(40);
    expect(anchorTarget(instantOnGlass())).toBe('diagram-c4.effect');
  });

  it('a stream that fails outright leaves the mark where it is', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof globalThis.fetch;
    await run().catch(() => undefined);
    await tick(20);
    expect(anchorTarget(instantOnGlass())).toBe('diagram-c4.effect');
  });
});

/**
 * ONE TURN'S INK IS NEVER THE NEXT TURN'S FIRST STROKE (the adversary, 2026-09-09, finding 7).
 *
 * The instant mark was placed under one fixed id, so the second turn's mark landed on the FIRST
 * turn's store entry: the board store keeps an existing object's place and bumps its generation,
 * the renderer keys on `<id>#<generation>`, and the ring the learner saw was `instant#1` — the
 * last turn's node, never redrawn. Live at 1440 on 2026-09-09 "draw this for me" recorded
 * `inkObjectsBefore.screen: 1` and a first stroke at 26 ms that was the previous turn's ring, so
 * no first-stroke number measured after a drawing turn could be trusted.
 */
describe("a new turn's mark is a new mark", () => {
  it("never lands on the last turn's object, so it is drawn and not inherited", async () => {
    serveAfter(5, done);
    await run();
    await tick(60);
    const first = instantOnGlass();
    expect(first).toBeDefined();
    expect(first?.generation).toBe(0);
    const firstId = first?.object.id;

    // The learner asks again. The turn opens, and its mark is its own — a new object, at
    // generation 0, so the pen really draws it rather than inheriting the last turn's node.
    serveAfter(5, done);
    await run();
    await tick(60);
    const marks = screenStore.snapshot().filter((s) => s.object.id.startsWith(INSTANT_ID));
    expect(marks.length).toBe(2);
    const second = marks.at(-1);
    expect(second).toBeDefined();
    expect(second?.object.id).not.toBe(firstId);
    expect(second?.generation).toBe(0);
  });

  it('leaves nothing of the last turn live on the glass when the next one opens', async () => {
    serveAfter(5, done);
    await run();
    await tick(60);
    expect(screenStore.snapshot().filter((s) => !s.removed).length).toBeGreaterThan(0);

    boardTurn.answered();
    const live = screenStore.snapshot().filter((s) => !s.removed && s.fadingAt === undefined);
    expect(live).toEqual([]);
  });
});
