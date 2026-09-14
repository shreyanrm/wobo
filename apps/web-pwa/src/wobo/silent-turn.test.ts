/**
 * A TURN NEVER ENDS IN SILENCE (the adversary, wave 53; docs/INK-FOUR.md, experience: "the say
 * names what it draws, every turn").
 *
 * The judge of wave 42 recorded one keyless drawing turn in sixty-five that produced no board at
 * all — no sheet, zero ink objects — on the same ask against the same mock gateway, and only under
 * contention. This is that turn, made deterministic: the wire opens, carries nothing, and closes
 * without a `done` frame, which is exactly what a proxy or a loaded gateway does when it drops an
 * event stream mid-flight.
 *
 * `streamBoardTurn` RESOLVES in that case — it does not throw — so the conductor's caller never
 * reaches its catch, and the honest line it keeps for a turn that came back with no shape
 * (`AppRuntime.tsx`: "That one did not come out.") is guarded on `outcome.completed`. With
 * `completed` reading "a `done` frame landed" the guard was false, and the learner was left with
 * their own question, an empty page and nothing said at all.
 *
 * So `completed` answers the question its one caller actually asks: did this turn end of its own
 * accord, rather than under the learner's hand? A stream that closes without `done` ended it just
 * as surely — badly, but not by the learner — and it is precisely the turn that owes an answer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { glassHold, plane } from '@wobo/wobo';
import type { BoardTurnOutcome } from './board-turn';
import { boardTurn, screenStore } from './board-turn';

type Frame = Record<string, unknown>;
const encode = (frames: Frame[]): string =>
  frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');

let realFetch: typeof globalThis.fetch;
/**
 * The gateway address as the process had it before this file, put back after. Bun maps
 * `import.meta.env` onto the process environment, and another file in the same run leaves
 * `VITE_GATEWAY_URL` set; with an address to ask, the voice asks the wire for each sentence's
 * sound and rides the whole first-sound ladder (`REASK_RUNGS_MS`, 9.5 s of rungs) before it gives
 * up on a wire that only ever answers with events. This file is about the WIRE, not the voice: a
 * keyless turn reads its lines on the clock (docs/BOARD.md, the muted reading clock), which is the
 * same beat the ink lands on, and `completed` is decided by the stream, never by the voice.
 */
let realGatewayUrl: string | undefined;

/** A wire that sends `frames`, then closes — with no `done` unless one is passed. */
function serveThenCloses(frames: Frame[], options: { body?: 'stream' | 'none' } = {}): void {
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = { 'content-type': 'text/event-stream' };
    if (options.body === 'none') return new Response(null, { status: 200, headers });
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
      pull(controller) {
        if (!sent) {
          sent = true;
          if (frames.length > 0) controller.enqueue(new TextEncoder().encode(encode(frames)));
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers });
  }) as typeof globalThis.fetch;
}

/** A wire that sends nothing and never closes, so the learner can cut in on it. */
function serveHangs(): void {
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal ?? null;
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
      pull() {
        return new Promise<void>(() => {});
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;
}

const turn = () =>
  boardTurn.run({ gatewayUrl: 'http://brain.test', payload: {}, route: 'learn', title: 't' });

/**
 * The caller's own guard, copied from `AppRuntime.tsx` so this file fails the moment the contract
 * it reads stops meaning what it means: a turn that ended by itself with nothing said and nothing
 * drawn is a turn Wobo still owes an answer for.
 */
const owesAnAnswer = (outcome: BoardTurnOutcome): boolean =>
  outcome.completed && !outcome.said.trim() && outcome.objects === 0;

beforeEach(() => {
  realFetch = globalThis.fetch;
  realGatewayUrl = process.env.VITE_GATEWAY_URL;
  delete process.env.VITE_GATEWAY_URL;
  screenStore.reset();
  glassHold.reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realGatewayUrl === undefined) delete process.env.VITE_GATEWAY_URL;
  else process.env.VITE_GATEWAY_URL = realGatewayUrl;
  plane.close();
});

describe('a turn whose wire carried nothing at all', () => {
  it('owes the learner an answer rather than ending in silence', async () => {
    serveThenCloses([]);
    const outcome = await turn();
    expect(outcome.said).toBe('');
    expect(outcome.objects).toBe(0);
    // The turn ended of its own accord — nothing of the learner's cut it short.
    expect(outcome.completed).toBe(true);
    expect(owesAnAnswer(outcome)).toBe(true);
  });

  it('is the same when the door answers with no body at all', async () => {
    serveThenCloses([], { body: 'none' });
    const outcome = await turn();
    expect(owesAnAnswer(outcome)).toBe(true);
  });

  it('leaves nothing of itself behind: no ink, no hold, no running turn', async () => {
    serveThenCloses([]);
    await turn();
    expect(boardTurn.get().active).toBe(false);
    expect(screenStore.snapshot().filter((s) => !s.removed)).toHaveLength(0);
    expect(glassHold.held).toBe(false);
  });
});

describe('a wire that stops in the middle of the plan', () => {
  it('keeps what it drew, and is not called silent', async () => {
    serveThenCloses([
      { type: 'say', text: 'Look at the top row.', t: 0 },
      {
        type: 'ink',
        t: 0,
        object: {
          id: 'ring',
          kind: 'circle',
          anchor: { target: 'row-2' },
          pad: 9,
          t: { start: 0, dur: 1 },
        },
      },
    ]);
    const outcome = await turn();
    expect(outcome.objects).toBeGreaterThan(0);
    expect(outcome.said).toContain('Look at the top row.');
    // It ended by itself, so `completed` is true — and the guard stays quiet, because something
    // was said and something was drawn. Wobo never apologises over an answer it gave.
    expect(outcome.completed).toBe(true);
    expect(owesAnAnswer(outcome)).toBe(false);
  });
});

describe('the learner cut Wobo off', () => {
  it('is never mistaken for a turn that came back empty', async () => {
    serveHangs();
    const running = turn();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    boardTurn.interrupt();
    const outcome = await running;
    expect(outcome.said).toBe('');
    expect(outcome.objects).toBe(0);
    // BOARD.md §4: barging in is not a failure, and Wobo says nothing about it.
    expect(outcome.completed).toBe(false);
    expect(owesAnAnswer(outcome)).toBe(false);
  }, 20_000);
});
