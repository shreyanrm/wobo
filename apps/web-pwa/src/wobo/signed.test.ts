/**
 * A SIGNATURE IS RECONCILED AGAINST THE GLASS, NOT AGAINST THE WIRE (the adversary, wave 47,
 * finding 9; docs/INK-FOUR.md, correctness: "nothing carries `verified` unless a check ran and
 * passed").
 *
 * The gateway's `_signed` (board/stream.py) already refuses to sign a check for a mark that never
 * reached the wire. But the wire is not the glass: nothing checked that the CLIENT actually laid
 * it. Wave 47 measured 27 board turns where streamed == store == DOM == on screen, so the
 * guarantee held — by luck, not by construction. Wave 42 is what it looks like when the luck runs
 * out: the plant cell's "vacuole" and "chloroplast" never reached the DOM and the ledger signed
 * them anyway.
 *
 * So the last step is taken here, where the DOM is: when the ink has finished landing, any check
 * signed for a mark that is not on the glass is dropped, by the same rule the gateway uses — one
 * name is the whole signature, so one missing mark unsigns it everywhere.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { boardTurn, screenStore, unsignedMarks } from './board-turn';

const mark = (id: string, check?: string) => ({ id, ...(check ? { check } : {}) });

describe('what the glass did not take is not signed', () => {
  it('drops the check of a mark that never reached the glass', () => {
    const objects = [mark('m1', 'board.in_bounds:year 1922'), mark('m2', 'board.fact_supported')];
    const onGlass = new Set(['m2']);
    expect(unsignedMarks(objects, (id) => onGlass.has(id))).toEqual(['board.in_bounds:year 1922']);
  });

  it('signs nothing off the back of the half that landed', () => {
    // Two marks, one check name, one of them missing: the name is unsigned everywhere, exactly as
    // the gateway unsigns a name that failed anywhere on the turn.
    const objects = [mark('m1', 'board.fact_supported'), mark('m2', 'board.fact_supported')];
    expect(unsignedMarks(objects, (id) => id === 'm1')).toEqual(['board.fact_supported']);
  });

  it('leaves a board-wide check alone: no mark stands on it', () => {
    const objects = [mark('m1'), mark('m2')];
    expect(unsignedMarks(objects, () => true)).toEqual([]);
    expect(unsignedMarks(objects, () => false)).toEqual([]);
  });

  it('is silent when every signed mark is on the glass', () => {
    const objects = [mark('m1', 'cas.step_chain')];
    expect(unsignedMarks(objects, () => true)).toEqual([]);
  });
});

/**
 * And the whole seam, end to end: the wire says a check passed for a mark, the glass does not have
 * that mark, and the turn stops carrying the signature.
 *
 * The seam under test is the glass, not the voice, so the voice is kept silent for the whole run:
 * with `VITE_GATEWAY_URL` set the utterance asks the wire for each sentence's sound and climbs the
 * first-sound ladder against this file's stubbed fetch (speech.tsx, `FIRST_TTS_TIMEOUT_MS`), which
 * took the turn from 1.6 s to over 11 s and past the test's clock. `src/admin/session.test.ts` sets
 * that address at module scope for the whole process, so a full run leaks it here. This is the
 * same guard `silent-turn.test.ts` keeps, for the same reason.
 *
 * Every stub is put back in `afterEach`, never in the test's own `finally`: a test that runs out of
 * clock never reaches its `finally`, and the stub document then stood in for the real one in every
 * file after this.
 */
describe('the turn re-reads its own glass when the pen has finished', () => {
  const encode = (frames: Record<string, unknown>[]): string =>
    frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');

  const serve = (frames: Record<string, unknown>[]): void => {
    globalThis.fetch = (async () =>
      new Response(encode(frames), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as unknown as typeof globalThis.fetch;
  };

  /** A page holding exactly these marks, the way the renderer writes them. */
  const pageWith = (...ids: string[]) => ({
    querySelectorAll: () =>
      ids.map((id) => ({ getAttribute: () => `${id}#0` })) as unknown as Iterable<Element>,
  });

  let realFetch: typeof globalThis.fetch;
  let realDoc: unknown;
  let realGatewayUrl: string | undefined;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    realDoc = (globalThis as { document?: unknown }).document;
    realGatewayUrl = process.env.VITE_GATEWAY_URL;
    delete process.env.VITE_GATEWAY_URL;
    screenStore.reset();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realDoc === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = realDoc;
    if (realGatewayUrl === undefined) delete process.env.VITE_GATEWAY_URL;
    else process.env.VITE_GATEWAY_URL = realGatewayUrl;
  });

  const run = async (page: unknown): Promise<string[]> => {
    serve([
      { type: 'say', text: 'Here it is.', t: 0, dur: 10 },
      {
        type: 'ink',
        t: 0,
        object: {
          id: 'm1',
          kind: 'ring',
          anchor: { target: 'w2' },
          check: 'board.fact_supported',
          t: { start: 0, dur: 1 },
        },
      },
      { type: 'done', objects: 1, verified: ['board.fact_supported'] },
    ]);
    (globalThis as { document?: unknown }).document = page;
    await boardTurn.run({
      gatewayUrl: 'http://brain.test',
      payload: {},
      route: 'learn',
      title: 't',
    });
    // long enough for the pen to finish and the settle to fire behind it
    await new Promise<void>((r) => setTimeout(r, 1200));
    return boardTurn.get().verified;
  };

  /** The silent turn reads its one sentence on the clock, about 1.6 s, then the settle; room is left. */
  const CLOCK_MS = 10_000;

  it(
    'keeps the signature when the mark is on the glass',
    async () => {
      expect(await run(pageWith('m1'))).toEqual(['board.fact_supported']);
    },
    CLOCK_MS,
  );

  it(
    'drops it when the renderer never laid the mark',
    async () => {
      expect(await run(pageWith())).toEqual([]);
    },
    CLOCK_MS,
  );
});
