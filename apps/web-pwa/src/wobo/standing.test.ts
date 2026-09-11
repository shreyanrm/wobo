/**
 * WHAT THE CLIENT PUT ON THE GLASS, TOLD TO THE BRAIN (docs/INK-FOUR.md, the instant mark).
 *
 * The adversary, wave 42: live at 1440, "circle the hypotenuse" rang the square on the hypotenuse
 * at 158 ms; the model then planned nothing, both of its sentences were refused for want of a
 * mark, and the ring stood on the glass for the whole turn with no sentence attached to it. The
 * brain refused against its own empty plan because nothing ever told it a ring was down.
 *
 * The turn's packet reports `board.drawn` — ids from EARLIER turns, so Wobo does not redraw what
 * is there — and it is read before this turn's own pen moves. This is the other field: the mark
 * this turn just laid, with the words it carries, so `stream.build_events` can keep its half of
 * the law (`services/gateway/src/wobo_gateway/board/stream.py`, "nothing stands on the glass
 * unspoken").
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { boardBook, plane } from '@wobo/wobo';
import { boardTurn, screenStore } from './board-turn';

type Sent = { board?: { standing?: unknown[]; drawn?: unknown[] } };

let realFetch: typeof globalThis.fetch;
let sent: Sent | null = null;

/** A gateway that records what it was asked and answers with an empty, well-formed turn. */
function record(): void {
  sent = null;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { payload?: Sent };
    sent = body.payload ?? null;
    return new Response(`data: ${JSON.stringify({ type: 'done' })}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof globalThis.fetch;
}

const INSTANT = {
  target: 'course-intro-mathematics.square-on-the-hypotenuse',
  kind: 'ring' as const,
  words: 'square on the hypotenuse',
};

const run = (instant: typeof INSTANT | null = INSTANT) =>
  boardTurn.run({
    gatewayUrl: 'http://brain.test',
    payload: { context: { turn: { lastUserInput: 'circle the hypotenuse' } } },
    route: 'course',
    title: 't',
    ...(instant ? { instant } : {}),
  });

beforeEach(() => {
  realFetch = globalThis.fetch;
  screenStore.reset();
  record();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  plane.close();
  for (const id of boardBook.ids()) boardBook.drop(id);
});

describe('the brain is told what the pen already put down', () => {
  it('reports the instant mark, with its target and its words', async () => {
    await run();
    const standing = sent?.board?.standing as
      | { id?: string; kind?: string; anchor?: { target?: string }; words?: string }[]
      | undefined;
    expect(standing).toBeDefined();
    expect(standing).toHaveLength(1);
    const mark = standing?.[0];
    expect(mark?.kind).toBe('ring');
    expect(mark?.anchor?.target).toBe('course-intro-mathematics.square-on-the-hypotenuse');
    expect(mark?.words).toBe('square on the hypotenuse');
    // The id is the one the ink is actually under, so a plan mark may hang off it.
    expect(mark?.id).toBe(screenStore.snapshot()[0]?.object.id.split('#')[0]);
  });

  it('says nothing about a glass it did not mark', async () => {
    await run(null);
    expect(sent?.board?.standing).toBeUndefined();
  });
});
