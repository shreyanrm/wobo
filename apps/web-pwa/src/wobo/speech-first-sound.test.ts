/**
 * THE FIRST SYLLABLE OF A LIVE ANSWER, AND THE TWO WAYS THIS FILE USED TO LOSE IT.
 *
 * Measured live on 2026-09-11 (adv-lab/w58j/live/*.json, every browser --mute-audio, the first
 * voice clip read off `AudioBufferSourceNode.start` and the fetches off a patched `window.fetch`):
 * on three of ten live board turns — pythagoras, the timeline and the lens — NOT ONE
 * `/v1/voice/tts` request completed before 12.3 s, and the very next request for the SAME sentence
 * came back with audio in 9, 15 and 21 ms. The clip was on the gateway's disk the whole time
 * (`gateway-live58j.log`: "re-decided to openai … spoke a line (voice.tts, from the disk)" while
 * the client's own request was still hanging, and that request then 502'd at 12 373 ms).
 *
 * A held request cannot learn that the gateway has changed its mind. Only a NEW one can. So the
 * sentence that owns the learner's first syllable is asked for on a ladder, and the first audio
 * that lands is the one they hear.
 *
 * These are the tests for that ladder, for the arbiter that keeps two mouths from both speaking,
 * and for the drain loop that a board answer actually goes down (`startUtterance`) — which is the
 * path the wave-58 probe found asking exactly once.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ASK_SPENT_MS, askForFirstSound, oneMouth, REASK_RUNGS_MS, startUtterance } from './speech';

// --- THE ARBITER ---------------------------------------------------------------------------

describe('one mouth, claimed once', () => {
  it('gives the turn to the first claimer and to nobody else', () => {
    const mouth = oneMouth();
    expect(mouth.taken()).toBe(false);
    expect(mouth.claim('stream')).toBe(true);
    expect(mouth.taken()).toBe(true);
    expect(mouth.claim('buffered')).toBe(false);
    expect(mouth.claim('stream')).toBe(true); // the owner may say so again
  });

  it('tells the loser it lost, exactly once, and never tells the winner', () => {
    const mouth = oneMouth();
    let streamClosed = 0;
    let bufferedDropped = 0;
    mouth.onLost('stream', () => streamClosed++);
    mouth.onLost('buffered', () => bufferedDropped++);
    expect(mouth.claim('buffered')).toBe(true);
    expect(streamClosed).toBe(1);
    expect(bufferedDropped).toBe(0);
    mouth.claim('stream');
    expect(streamClosed).toBe(1);
  });

  it('tells a latecomer immediately that the mouth is already gone', () => {
    const mouth = oneMouth();
    mouth.claim('buffered');
    let told = 0;
    mouth.onLost('stream', () => told++);
    expect(told).toBe(1);
  });
});

// --- THE LADDER ----------------------------------------------------------------------------

const clip = (n: number) => ({ id: n });

describe('the deciding sentence is asked for more than once', () => {
  it('takes the rung’s audio instead of waiting out a request that will never answer', async () => {
    // Ask 0 is the hang the live session measured, scaled: it answers nothing, ever, until its
    // budget. Ask 1 is the same sentence off the gateway's disk — 9 ms, live.
    const asked: number[] = [];
    const started = performance.now();
    const got = await askForFirstSound<{ id: number }>(
      (attempt) => {
        asked.push(attempt);
        if (attempt === 0) return new Promise((r) => setTimeout(() => r(null), 3000));
        return new Promise((r) => setTimeout(() => r(clip(attempt)), 5));
      },
      { rungs: [60], budgetMs: 3000 },
    );
    const took = performance.now() - started;
    expect(got).toEqual(clip(1));
    expect(asked).toEqual([0, 1]);
    // Without the ladder this is 3000 ms — the whole of the first ask's budget.
    expect(took).toBeLessThan(600);
  });

  it('asks exactly once on a healthy day', async () => {
    const asked: number[] = [];
    const got = await askForFirstSound<{ id: number }>(
      (attempt) => {
        asked.push(attempt);
        return new Promise((r) => setTimeout(() => r(clip(attempt)), 5));
      },
      { rungs: [60, 120], budgetMs: 1000 },
    );
    expect(got).toEqual(clip(0));
    await new Promise((r) => setTimeout(r, 200)); // past every rung
    expect(asked).toEqual([0]);
  });

  it('abandons the asks that lost, so a dead request stops holding a connection', async () => {
    const aborted: number[] = [];
    const got = await askForFirstSound<{ id: number }>(
      (attempt, signal) => {
        signal.addEventListener('abort', () => aborted.push(attempt));
        if (attempt === 0) return new Promise((r) => setTimeout(() => r(null), 3000));
        return Promise.resolve(clip(attempt));
      },
      { rungs: [40], budgetMs: 3000 },
    );
    expect(got).toEqual(clip(1));
    expect(aborted).toContain(0);
  });

  it('keeps at most three asks in flight, and climbs no rung that would cost one of them', async () => {
    // THREE CHANCES IN THE AIR IS THREE. Until 2026-09-15 a fourth rung took its place by ABORTING
    // THE OLDEST ASK — on the reasoning that the oldest is the deadest. It is the opposite on the
    // day that actually happens: a gateway spending its unheard deadline (voice.py, six seconds on
    // the pinned voice) is WORKING, not holding, and the oldest ask is the one nearest its answer.
    // See the lens-1440 test below for what that cost a learner.
    const asked: number[] = [];
    const aborted: number[] = [];
    const live = askForFirstSound<{ id: number }>(
      (attempt, signal) => {
        asked.push(attempt);
        signal.addEventListener('abort', () => aborted.push(attempt));
        return new Promise((r) => setTimeout(() => r(null), 5000));
      },
      { rungs: [20, 40, 60], budgetMs: 400 },
    );
    await new Promise((r) => setTimeout(r, 120));
    expect(asked).toEqual([0, 1, 2]); // the fourth rung is not climbed; nothing is murdered for it
    expect(aborted).toEqual([]);
    expect(await live).toBe(null);
    expect(aborted.sort((a, b) => a - b)).toEqual([0, 1, 2]); // the budget ends them all together
  });

  it('never abandons the ask that is nearest its answer to make room for a newer one', async () => {
    // THE LENS AT 1440, 2026-09-15, AS THE JUDGE MEASURED IT: first syllable 7307 ms. The gateway
    // was answering — 200, with audio — but only after its own six-second unheard deadline had run
    // on the pinned voice. Ask 0 was sent at 0 and its audio was due at 6600. The rung at 3000
    // aborted it to make room; the rung at 6500 aborted ask 1 (due at 7300) for the same reason;
    // and the learner finally heard ask 2, at 1400 + 6600 = 8006 ms on this ruler. Two answers
    // thrown away, and eight of the run's thirty 502s bought with them.
    const asked: number[] = [];
    const started = performance.now();
    const got = await askForFirstSound<{ id: number }>(
      (attempt, signal) => {
        asked.push(attempt);
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve(clip(attempt)), 660);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve(null);
          });
        });
      },
      { rungs: [70, 140, 300, 650, 950], budgetMs: 1200 },
    );
    const took = performance.now() - started;
    expect(got).toEqual(clip(0)); // the FIRST ask's audio, the one that was always going to be first
    expect(took).toBeLessThan(760); // not 800 (= 140 + 660), which is what murdering it costs
    expect(asked.length).toBeLessThanOrEqual(3); // and no rung past the three in the air
  });

  it('lets a rung stand on an ask the gateway has already given up on, and kills nothing for it', async () => {
    // THE OTHER HALF OF THE CAP, and what it cost on the wire of 2026-09-15. All three chances are
    // sent inside the first 1.4 s. The gateway re-decides an unheard turn's voice at its own six
    // seconds (voice.py `_UNHEARD_TIMEOUT_S`) and only a request sent AFTER that moment can be told
    // — so with a flat cap of three the ladder was frozen for the rest of its twelve-second budget
    // with nothing in the air that could learn anything. Buffered asks fell 78 to 55 while the
    // upstream read timeouts stayed at 37 and 40, and the socket took five boards instead of one.
    //
    // An ask past `spentMs` therefore holds no place. It is NOT aborted for that: it may still
    // answer, and on the lens at 1440 it did.
    const asked: number[] = [];
    const aborted: number[] = [];
    const abortedWhenTheFourthWasAsked: number[] = [];
    const repin = 150; // the gateway's re-decision, on this ruler
    const started = performance.now();
    const got = await askForFirstSound<{ id: number }>(
      (attempt, signal) => {
        asked.push(attempt);
        signal.addEventListener('abort', () => aborted.push(attempt));
        if (attempt === 3) abortedWhenTheFourthWasAsked.push(...aborted);
        // Sent before the re-decision: held for ever, waiting on a voice that no longer exists.
        if (performance.now() - started < repin) return new Promise<null>(() => {});
        return new Promise((r) => setTimeout(() => r(clip(attempt)), 5)); // a disk read, after it
      },
      { rungs: [20, 40, 170], budgetMs: 800, spentMs: 60 },
    );
    expect(got).toEqual(clip(3));
    expect(asked).toEqual([0, 1, 2, 3]); // the rung past the re-decision is climbed
    expect(abortedWhenTheFourthWasAsked).toEqual([]); // and nothing was spent to climb it
    expect(asked.length).toBe(4); // one extra read on a turn that has heard nothing for six seconds
  });

  it('counts an ask spent no sooner than the gateway re-decides the turn', () => {
    // voice.py holds an unheard turn's pinned voice for six seconds. Sooner than that, this floor
    // would buy a read the gateway was still about to answer.
    expect(ASK_SPENT_MS).toBeGreaterThanOrEqual(6000);
    // And it must be inside the deciding sentence's own budget, or no rung could ever use it.
    expect(ASK_SPENT_MS).toBeLessThan(12000);
  });

  it('is null when every rung is silent, and never outlives its budget', async () => {
    const started = performance.now();
    const got = await askForFirstSound<{ id: number }>(
      () => new Promise((r) => setTimeout(() => r(null), 5000)),
      { rungs: [30, 60], budgetMs: 250 },
    );
    expect(got).toBe(null);
    expect(performance.now() - started).toBeLessThan(900);
  });

  it('stops laddering the moment another mouth has the turn', async () => {
    const asked: number[] = [];
    let taken = false;
    const live = askForFirstSound<{ id: number }>(
      (attempt) => {
        asked.push(attempt);
        return new Promise((r) => setTimeout(() => r(null), 400));
      },
      { rungs: [40, 80], budgetMs: 500, stop: () => taken },
    );
    taken = true; // the stream claimed the mouth while ask 0 was in flight
    await live;
    expect(asked).toEqual([0]);
  });

  it('takes a gateway that says no at once as the answer, and does not wait for a rung to say it again', async () => {
    // A keyless box answers 503 in a few milliseconds. Until now the ladder waited for EVERY rung
    // to ask and be refused — 9.5 s of the learner's first sentence, on every one of the 59
    // keyless turns — because it only settled on silence when no rung was left to fire.
    const asked: number[] = [];
    const started = performance.now();
    const got = await askForFirstSound<{ id: number }>(
      (attempt) => {
        asked.push(attempt);
        return new Promise((r) => setTimeout(() => r(null), 5));
      },
      { rungs: [200, 400], budgetMs: 3000 },
    );
    expect(got).toBe(null);
    expect(asked).toEqual([0]);
    expect(performance.now() - started).toBeLessThan(150);
  });

  it('is called off by its signal, and abandons every ask it had in flight', async () => {
    // The other mouth (the stream) has the turn: nothing the ladder could still bring back is
    // worth hearing, and a request it is holding is a connection the gateway could use.
    const aborted: number[] = [];
    const cancel = new AbortController();
    const started = performance.now();
    const live = askForFirstSound<{ id: number }>(
      (attempt, signal) => {
        signal.addEventListener('abort', () => aborted.push(attempt));
        return new Promise((r) => setTimeout(() => r(clip(attempt)), 3000));
      },
      { rungs: [30], budgetMs: 3000, signal: cancel.signal },
    );
    setTimeout(() => cancel.abort(), 60);
    expect(await live).toBe(null);
    expect(performance.now() - started).toBeLessThan(400);
    expect(aborted.sort()).toEqual([0, 1]);
  });

  it('has rungs inside the first-syllable law, not past it', () => {
    expect(REASK_RUNGS_MS[0]).toBeLessThanOrEqual(1500);
    expect(REASK_RUNGS_MS.length).toBeGreaterThanOrEqual(2);
  });
});

// --- THE PATH A BOARD ANSWER ACTUALLY GOES DOWN ---------------------------------------------
//
// `startUtterance` is the drain loop the conductor opens for every board turn (board-turn.ts).
// The wave-58 probe found it asking for the deciding sentence exactly once and then waiting out
// the whole twelve seconds. This stands a gateway in front of it that behaves the way the live
// one did — the first ask never answers, the next one has the clip — and watches the beat the ink
// is paced against (`onSentence`) to see when the voice actually starts.

const SAMPLE_B64 = Buffer.from(new Int16Array([1000, -1000, 1000, -1000]).buffer).toString(
  'base64',
);

describe('a board turn asks again for the sentence that owns the first syllable', () => {
  const realFetch = globalThis.fetch;
  const realUrl = process.env.VITE_GATEWAY_URL;

  beforeEach(() => {
    process.env.VITE_GATEWAY_URL = 'http://brain.test';
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realUrl === undefined) delete process.env.VITE_GATEWAY_URL;
    else process.env.VITE_GATEWAY_URL = realUrl;
  });

  it('does not wait out a request that will never answer', async () => {
    let asks = 0;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (!String(url).includes('/v1/voice/tts')) return Promise.resolve(new Response('{}'));
      asks++;
      if (asks === 1) {
        // The hang: nothing comes back until somebody aborts it, exactly like the 502 at 12 373 ms.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ mime: 'audio/pcm;rate=24000', b64: SAMPLE_B64 }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    const beats: { index: number; voicedMs?: number; at: number }[] = [];
    const started = performance.now();
    const utterance = startUtterance(undefined, {
      onSentence: (index, voicedMs) =>
        beats.push({ index, voicedMs, at: performance.now() - started }),
    });
    utterance.say('The first step is to subtract five from both sides.');
    utterance.end();
    await utterance.done;

    expect(asks).toBeGreaterThan(1); // it asked again rather than holding the dead one
    expect(beats.length).toBe(1);
    // The learner's first syllable is Wobo's, and it is inside the ladder's first rung plus the
    // clip's own arrival — not on the far side of the twelve-second budget.
    expect(beats[0]?.voicedMs).toBeGreaterThan(0);
    expect(beats[0]?.at ?? Infinity).toBeLessThan(REASK_RUNGS_MS[0] + 1200);
  }, 20000);
});
