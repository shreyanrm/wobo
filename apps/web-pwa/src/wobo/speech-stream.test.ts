/**
 * THE FIRST SOUND IS A RACE, AND THE TURN KEEPS THE MOUTH THAT WON IT.
 *
 * Measured live on 2026-09-11 (adv-lab/w58j/live/*.json, every browser --mute-audio, the first
 * voice clip read off `AudioBufferSourceNode.start`, every socket off a patched `WebSocket`): the
 * first voice of twelve live board turns landed at 365, 529, 791, 802, 868, 869, 878, 3172, 5262,
 * 12388, 13029 and 13224 ms after the ask. Five of twelve past the 1.5 s a first syllable is given
 * (docs/BOARD.md §10), three of them by more than eight times. And across the whole session the
 * gateway served ZERO `/v1/voice/session` — the token the voice socket needs — because the drain
 * loop a board answer goes down (`startUtterance`) only ever asked the buffered `/v1/voice/tts`,
 * whose first request holds a voice the gateway has since given up on.
 *
 * So the sentence that owns the first syllable is asked for two ways at once — the buffered ladder
 * and the voice socket — and the first audio to land takes the mouth. Whichever mouth wins keeps
 * the WHOLE turn (INK-FOUR experience: one voice), and the other is closed before it plays.
 *
 * Everything below stands a gateway, a socket and an audio graph in front of `startUtterance` and
 * watches the beat the ink is paced against (`onSentence`) and the graph's own `start` calls.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { forgetVoiceHealth, REASK_RUNGS_MS, STREAM_AFTER_MS, startUtterance } from './speech';

// --- the fakes ------------------------------------------------------------------------------------

/** A stream chunk: four samples. */
const CHUNK_B64 = Buffer.from(new Int16Array([1000, -1000, 1000, -1000]).buffer).toString('base64');
/** A buffered clip: eight samples, so the graph tells the two mouths apart by length. */
const CLIP_B64 = Buffer.from(
  new Int16Array([1000, -1000, 1000, -1000, 1000, -1000, 1000, -1000]).buffer,
).toString('base64');

type Started = { len: number; rate: number; t: number };

class FakeCtx {
  /** speech.tsx makes the graph itself (`new AudioContext()`); the test reads the one it made. */
  static made: FakeCtx | null = null;
  state = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  started: Started[] = [];
  constructor() {
    FakeCtx.made = this;
  }
  createBuffer(_channels: number, len: number, rate: number) {
    return { duration: len / rate, length: len, sampleRate: rate, copyToChannel() {} };
  }
  createBufferSource() {
    const ctx = this;
    const node = {
      buffer: null as null | { length: number; sampleRate: number; duration: number },
      onended: null as null | (() => void),
      connect() {},
      start() {
        const b = node.buffer;
        if (b) ctx.started.push({ len: b.length, rate: b.sampleRate, t: performance.now() });
        setTimeout(() => node.onended?.(), 5);
      },
      stop() {},
    };
    return node;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
  }
}

type Script = (ws: FakeSocket, text: string) => void;

class FakeSocket {
  static made: FakeSocket[] = [];
  static script: Script = () => {};
  /**
   * voice.py `_MAX_TTS_PER_SUBJECT`: the gateway keeps TWO live TTS sockets for one learner and
   * closes the next at once, unheard. Default off, so every test that does not care is unchanged.
   */
  static cap = Number.POSITIVE_INFINITY;
  /** Sockets the gateway currently counts as live for this learner. */
  static live = 0;
  /** Sockets it closed on sight, over the cap: a bill, a mint, and nothing heard. */
  static refused = 0;
  url: string;
  sent: string[] = [];
  closed = false;
  createdAt = performance.now();
  onopen: null | (() => void) = null;
  onmessage: null | ((e: { data: string }) => void) = null;
  onclose: null | ((e: unknown) => void) = null;
  onerror: null | ((e: unknown) => void) = null;
  constructor(url: string) {
    this.url = String(url);
    FakeSocket.made.push(this);
    FakeSocket.live++;
    setTimeout(() => this.onopen?.(), 2);
  }
  send(text: string) {
    this.sent.push(text);
    if (FakeSocket.live > FakeSocket.cap) {
      FakeSocket.refused++;
      setTimeout(() => this.close(), 15); // the 1008, with no syllable in it
      return;
    }
    FakeSocket.script(this, text);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    FakeSocket.live--;
    setTimeout(() => this.onclose?.({}), 1);
  }
  /** One audio part, the way Gemini Live frames it. */
  chunk() {
    if (this.closed) return;
    this.onmessage?.({
      data: JSON.stringify({
        serverContent: { modelTurn: { parts: [{ inlineData: { data: CHUNK_B64 } }] } },
      }),
    });
  }
  /** The gateway's own close after the turn completes. */
  done() {
    if (this.closed) return;
    this.onmessage?.({ data: JSON.stringify({ serverContent: { turnComplete: true } }) });
    this.close();
  }
}

/** The gateway on the wire: what `/v1/voice/session` and `/v1/voice/tts` answer, per sentence. */
type Wire = {
  session: () => Response;
  tts: (text: string, signal: AbortSignal | null | undefined) => Promise<Response>;
};

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const clipResponse = () => ok({ mime: 'audio/pcm;rate=24000', b64: CLIP_B64 });
const hang = (signal: AbortSignal | null | undefined) =>
  new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

function serve(wire: Wire): { ttsAsks: string[]; mints: { n: number } } {
  const ttsAsks: string[] = [];
  const mints = { n: 0 };
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/v1/voice/session')) {
      mints.n++;
      return Promise.resolve(wire.session());
    }
    if (u.includes('/v1/voice/tts')) {
      const text = String((JSON.parse(String(init?.body ?? '{}')) as { text?: string }).text);
      ttsAsks.push(text);
      return wire.tts(text, init?.signal);
    }
    return Promise.resolve(new Response('{}'));
  }) as unknown as typeof fetch;
  return { ttsAsks, mints };
}

const realFetch = globalThis.fetch;
const realSocket = globalThis.WebSocket;
const realWindow = (globalThis as { window?: unknown }).window;
const realUrl = process.env.VITE_GATEWAY_URL;
/** The graph speech.tsx made for the current test (it makes a new one once the last is closed). */
const ctx = () => FakeCtx.made as FakeCtx;

beforeAll(() => {
  (globalThis as { window?: unknown }).window = {
    AudioContext: FakeCtx,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
});

beforeEach(() => {
  forgetVoiceHealth(); // every test starts on a session that has seen no stall
  process.env.VITE_GATEWAY_URL = 'http://brain.test';
  FakeSocket.made = [];
  FakeSocket.script = () => {};
  FakeSocket.cap = Number.POSITIVE_INFINITY;
  FakeSocket.live = 0;
  FakeSocket.refused = 0;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = realSocket;
  if (realUrl === undefined) delete process.env.VITE_GATEWAY_URL;
  else process.env.VITE_GATEWAY_URL = realUrl;
  // The context speech.tsx keeps is closed so the next test (and the next file) makes its own.
  FakeCtx.made?.close();
});

afterAll(() => {
  (globalThis as { window?: unknown }).window = realWindow;
});

type Beat = { index: number; voicedMs?: number; at: number };

async function speak(lines: string[], onBeat?: (b: Beat) => void) {
  const beats: Beat[] = [];
  const started = performance.now();
  const utterance = startUtterance(undefined, {
    onSentence: (index, voicedMs) => {
      const b = { index, voicedMs, at: performance.now() - started };
      beats.push(b);
      onBeat?.(b);
    },
  });
  for (const line of lines) utterance.say(line);
  utterance.end();
  return { beats, utterance, started };
}

const streams = () => ctx().started.filter((s) => s.len === 4);
const clips = () => ctx().started.filter((s) => s.len === 8);

// --- THE RACE -------------------------------------------------------------------------------------

describe('the deciding sentence is asked for on the socket and on the ladder at once', () => {
  it('speaks from the socket while the buffered ask is still being held', async () => {
    // The live shape: the buffered request holds a voice the gateway has given up on and never
    // answers; the socket has its first audio in 80 ms.
    serve({ session: () => ok({ mode: 'tts', token: 't-1' }), tts: (_t, s) => hang(s) });
    FakeSocket.script = (ws) => {
      setTimeout(() => ws.chunk(), 80);
      setTimeout(() => ws.done(), 130);
    };
    const { beats, utterance, started } = await speak([
      'The hypotenuse is the side opposite the right angle.',
    ]);
    await utterance.done;

    expect(FakeSocket.made.length).toBe(1);
    expect(FakeSocket.made[0]?.url).toContain('/v1/voice/tts/stream');
    expect(FakeSocket.made[0]?.url).toContain('token=t-1');
    expect(FakeSocket.made[0]?.sent).toEqual([
      'The hypotenuse is the side opposite the right angle.',
    ]);
    expect(beats.length).toBe(1);
    // The grace, the mint, the connect and the socket's own first audio, all inside the 1.5 s
    // BOARD.md §10 gives the first syllable — and nowhere near the far side of the ladder's budget.
    expect(beats[0]?.at ?? Infinity).toBeLessThan(1500);
    expect((FakeSocket.made[0] as FakeSocket).createdAt - started).toBeLessThan(
      STREAM_AFTER_MS + 400,
    );
    expect(streams().length).toBeGreaterThan(0);
    expect(clips().length).toBe(0);
  }, 20000);

  it('closes the socket before it plays when the buffered clip lands first', async () => {
    // A buffered route slow enough to spend the whole grace, so a socket really is opened beside
    // it — and then answers anyway, still inside the first syllable's 1.5 s.
    serve({
      session: () => ok({ mode: 'tts', token: 't-1' }),
      tts: () => new Promise((r) => setTimeout(() => r(clipResponse()), STREAM_AFTER_MS + 100)),
    });
    FakeSocket.script = (ws) => {
      setTimeout(() => ws.chunk(), 1500);
      setTimeout(() => ws.done(), 1560);
    };
    const { beats, utterance } = await speak(['A ray through the centre goes straight on.']);
    await utterance.done;
    await new Promise((r) => setTimeout(r, 1700)); // past the socket's own chunk

    expect(beats.length).toBe(1);
    expect(beats[0]?.at ?? Infinity).toBeLessThan(1500);
    expect(clips().length).toBe(1);
    expect(streams().length).toBe(0); // nothing of the socket was ever scheduled
    expect(FakeSocket.made.length).toBe(1);
    expect(FakeSocket.made[0]?.closed).toBe(true);
  }, 20000);

  it('keeps the whole turn on the socket once the socket won, and never plays the clip that came later', async () => {
    // Sentence two's clip is on the gateway's disk (bought ahead) and answers at once — but this
    // turn is already being read on the socket's voice, and an answer is one performance.
    const { ttsAsks } = serve({
      session: () => ok({ mode: 'tts', token: 't-n' }),
      tts: (text, s) =>
        text.startsWith('The first')
          ? hang(s)
          : new Promise((r) => setTimeout(() => r(clipResponse()), 2)),
    });
    FakeSocket.script = (ws) => {
      setTimeout(() => ws.chunk(), 60);
      setTimeout(() => ws.chunk(), 90);
      setTimeout(() => ws.done(), 120);
    };
    const { beats, utterance } = await speak([
      'The first step is to square both legs. The second step is to add them.',
    ]);
    await utterance.done;

    expect(beats.map((b) => b.index)).toEqual([0, 1]);
    expect(FakeSocket.made.map((w) => w.sent[0])).toEqual([
      'The first step is to square both legs.',
      'The second step is to add them.',
    ]);
    expect(clips().length).toBe(0);
    expect(streams().length).toBeGreaterThanOrEqual(4);
    // The buffered pipeline was not even asked for sentence two: the turn was the socket's.
    expect(ttsAsks.filter((t) => t.startsWith('The second')).length).toBe(0);
  }, 20000);

  it("opens the next sentence's socket while the current one is playing, so there is no gap", async () => {
    serve({ session: () => ok({ mode: 'tts', token: 't-n' }), tts: (_t, s) => hang(s) });
    FakeSocket.script = (ws) => {
      setTimeout(() => ws.chunk(), 40);
      setTimeout(() => ws.done(), 200);
    };
    const { beats, utterance } = await speak(['One side is three. The other side is four.']);
    await utterance.done;

    expect(FakeSocket.made.length).toBe(2);
    const second = FakeSocket.made[1] as FakeSocket;
    const first = FakeSocket.made[0] as FakeSocket;
    // The second socket was opened before the first one had even finished arriving.
    expect(second.createdAt).toBeLessThan(first.createdAt + 150);
    // And sentence two began the moment sentence one ended — no mint, no connect in between.
    expect((beats[1]?.at ?? 0) - (beats[0]?.at ?? 0)).toBeLessThan(300);
  }, 20000);

  it('closes every open socket the moment the learner cuts Wobo off', async () => {
    serve({ session: () => ok({ mode: 'tts', token: 't-n' }), tts: (_t, s) => hang(s) });
    FakeSocket.script = (ws) => {
      setTimeout(() => ws.chunk(), 30); // and then nothing more, ever
    };
    const { utterance } = await speak(['Look at the base. Now look at the height.'], (b) => {
      if (b.index === 0) setTimeout(() => utterance.stop(), 20);
    });
    await utterance.done;
    await new Promise((r) => setTimeout(r, 50));
    expect(FakeSocket.made.length).toBeGreaterThan(0);
    for (const ws of FakeSocket.made) expect(ws.closed).toBe(true);
  }, 20000);

  it('names the mouth that won on the timing trail the live verifier reads', async () => {
    const w = (globalThis as unknown as { window: { __woboTiming?: unknown[] } }).window;
    w.__woboTiming = [];
    serve({ session: () => ok({ mode: 'tts', token: 't-1' }), tts: (_t, s) => hang(s) });
    FakeSocket.script = (ws) => {
      setTimeout(() => ws.chunk(), 30);
      setTimeout(() => ws.done(), 60);
    };
    const { utterance } = await speak(['Pressure is force over area.']);
    await utterance.done;
    const trail = w.__woboTiming as { kind: string; mouth?: string }[];
    expect(trail.some((e) => e.kind === 'first-sound' && e.mouth === 'stream')).toBe(true);
    delete w.__woboTiming;
  }, 20000);
});

// --- A KEYLESS BOX --------------------------------------------------------------------------------

describe('a keyless box', () => {
  it('opens no socket, and its first beat does not wait for a rung', async () => {
    // 59 of the 59 judged turns run keyless. The gateway says no in a few milliseconds, and the
    // sentence beat the ink is paced against must fall on the reading clock at once — not after
    // every rung of the ladder has asked and been refused (9.5 s, before this test).
    serve({
      session: () => new Response('voice unavailable', { status: 503 }),
      tts: () => Promise.resolve(new Response('voice unavailable', { status: 503 })),
    });
    const { beats, utterance } = await speak(['Nothing here is spoken aloud.']);
    // The first beat must land well inside the first rung; the reading clock then holds the
    // sentence for its own length, which is not what this measures.
    await new Promise((r) => setTimeout(r, REASK_RUNGS_MS[0]));
    expect(beats.length).toBe(1);
    expect(beats[0]?.at ?? Infinity).toBeLessThan(300);
    expect(FakeSocket.made.length).toBe(0);
    utterance.stop();
    await utterance.done;
  }, 20000);
});

// --- WHAT THE JUDGE MEASURED ON 2026-09-14, AND WHAT IT COSTS ------------------------------------
//
// Twelve live turns on Luna, every browser --mute-audio, the first clip read off
// `AudioBufferSourceNode.start` and every socket off a patched `WebSocket` (w60j/live/*.json):
//
//   · the socket won 4 of 11 boards, and those four are the SLOWEST first syllables of the run —
//     4780 ms (pythagoras 1440), 3825 (map), 3745 (graph), 3464 (derivation) — while every
//     buffered win landed in 322 to 973 ms;
//   · the socket won ONLY where the buffered route had failed: `POST /v1/voice/tts` answered 502
//     seven times in the run;
//   · and once the socket had the turn its seams ran 2.2 to 12.2 s, three to five sockets a turn.
//
// A 502 from that route is not a refusal. voice.py raises it after BOTH voices failed for this
// sentence, and before raising it REFUNDS the call and re-pins the turn's voice — so the very next
// ask is a disk read in the new voice, which is the whole reason the ladder exists. Until today
// the ladder threw itself away on exactly that answer ("the gateway ANSWERED"), handed the turn to
// the mouth that costs seconds, and then paid for it sentence after sentence.

const fail = (status: number) => new Response('no', { status });

describe('a 502 is the gateway asking to be asked again', () => {
  it('climbs on it, keeps the turn on the buffered mouth, and speaks inside the syllable budget', async () => {
    let asks = 0;
    serve({
      session: () => ok({ mode: 'tts', token: 't-1' }),
      tts: () => {
        asks++;
        return Promise.resolve(asks === 1 ? fail(502) : clipResponse());
      },
    });
    // The socket, scripted at its measured live speed: first audio to the ear at 3.5 s.
    FakeSocket.script = (ws) => {
      setTimeout(() => ws.chunk(), 3500);
      setTimeout(() => ws.done(), 3600);
    };
    const { beats, utterance } = await speak([
      'The square on the hypotenuse is the sum of the other two.',
    ]);
    await utterance.done;

    expect(asks).toBeGreaterThanOrEqual(2);
    expect(beats.length).toBe(1);
    expect(beats[0]?.at ?? Infinity).toBeLessThan(1500); // BOARD.md §10, the first syllable
    expect(clips().length).toBe(1);
    expect(streams().length).toBe(0); // the socket never took a turn it would have dragged
  }, 20000);

  it('does not climb on a refusal: a keyless box is still silent in milliseconds', async () => {
    let asks = 0;
    serve({
      session: () => fail(503),
      tts: () => {
        asks++;
        return Promise.resolve(fail(503));
      },
    });
    const { beats, utterance } = await speak(['Nothing here is spoken aloud.']);
    await new Promise((r) => setTimeout(r, REASK_RUNGS_MS[0] as number));
    expect(beats[0]?.at ?? Infinity).toBeLessThan(300);
    expect(asks).toBe(1); // one ask, one answer, no ladder
    utterance.stop();
    await utterance.done;
  }, 20000);

  it('does not climb on a spent day either', async () => {
    let asks = 0;
    serve({
      session: () => fail(429),
      tts: () => {
        asks++;
        return Promise.resolve(fail(429));
      },
    });
    const { beats, utterance } = await speak(['The day’s voice is spent.']);
    await new Promise((r) => setTimeout(r, REASK_RUNGS_MS[0] as number));
    expect(beats[0]?.at ?? Infinity).toBeLessThan(300);
    expect(asks).toBe(1);
    utterance.stop();
    await utterance.done;
  }, 20000);
});

describe('the socket is the second ask, not a second bill on every turn', () => {
  it('opens no socket at all when the buffered route answers inside the grace', async () => {
    serve({
      session: () => ok({ mode: 'tts', token: 't-1' }),
      tts: () => new Promise((r) => setTimeout(() => r(clipResponse()), 20)),
    });
    const { beats, utterance } = await speak(['A ray through the centre goes straight on.']);
    await utterance.done;
    await new Promise((r) => setTimeout(r, STREAM_AFTER_MS + 300)); // past the grace, and then some

    expect(beats.length).toBe(1);
    expect(clips().length).toBe(1);
    expect(FakeSocket.made.length).toBe(0); // no mint, no socket, no second voice, no second bill
  }, 20000);

  it('opens the socket the moment the buffered route says it failed, not on the clock', async () => {
    serve({
      session: () => ok({ mode: 'tts', token: 't-1' }),
      tts: () => new Promise((r) => setTimeout(() => r(fail(502)), 10)),
    });
    FakeSocket.script = (ws) => {
      setTimeout(() => ws.chunk(), 20);
      setTimeout(() => ws.done(), 60);
    };
    const { utterance, started } = await speak(['Both voices are out today.']);
    await utterance.done;

    const first = FakeSocket.made[0] as FakeSocket | undefined;
    expect(first).toBeDefined();
    // The grace is a ceiling, not a wait: this turn's own evidence opened the socket long inside it.
    expect((first as FakeSocket).createdAt - started).toBeLessThan(STREAM_AFTER_MS);
  }, 20000);
});

describe('a streamed turn does not pay a watchdog for a socket that will not speak', () => {
  it('replaces a later sentence’s dead socket on a rung, not after eight seconds of silence', async () => {
    serve({ session: () => ok({ mode: 'tts', token: 't-n' }), tts: (_t, s) => hang(s) });
    FakeSocket.script = (ws, text) => {
      const nth = FakeSocket.made.filter((w) => w.sent[0] === text).length;
      // Sentence one speaks at once. Sentence two's FIRST socket opens and never says a word —
      // the live shape behind the 11.7 and 12.2 s seams; only its replacement speaks.
      if (text.startsWith('One side') || nth >= 2) {
        setTimeout(() => ws.chunk(), 40);
        setTimeout(() => ws.done(), 90);
      }
    };
    const { beats, utterance } = await speak(['One side is three. The other side is four.']);
    await utterance.done;

    expect(beats.map((b) => b.index)).toEqual([0, 1]);
    const seam = (beats[1]?.at ?? 0) - (beats[0]?.at ?? 0);
    expect(seam).toBeLessThan(4500); // was the 8 s watchdog plus a whole fresh socket after it
    expect(FakeSocket.made.filter((w) => w.sent[0]?.startsWith('The other')).length).toBe(2);
  }, 20000);
});

// --- WHAT THE JUDGE MEASURED ON 2026-09-15, AND WHAT THE LADDER WAS SPENDING ---------------------
//
// Twelve turns on Luna, every browser --mute-audio. Eight of eleven boards were clean — 396 to
// 1034 ms to the first syllable, zero sockets. Two were not, and the bill for them was thirty
// `502 POST /v1/voice/tts` against wave 60's seven, each one a nine-to-eleven second upstream
// read the gateway had to sit through.
//
// Replaying the lens-1440 wire through this file showed where those went. The gateway there was
// ANSWERING — 200, with audio — but only after `_UNHEARD_TIMEOUT_S` (voice.py: six seconds on the
// turn's pinned voice) had run. The ladder read slow as dead: at every third rung it aborted the
// OLDEST ask in flight to make room for a new one, and on that day the oldest ask is the one
// NEAREST its answer. Ten asks were sent for one sentence, two answers with audio in them were
// thrown away unheard, and the learner waited 7307 ms for a syllable that was ready at 6600.
//
// Three chances in the air is three. A rung that can only be climbed by murdering one of them is
// not a fourth chance, and the gateway pays for it twice.

describe('a slow gateway is not a dead one', () => {
  it('keeps the ask that was about to answer, and stops buying reads it cannot use', async () => {
    let asks = 0;
    serve({
      session: () => ok({ mode: 'tts', token: 't-1' }),
      // Every ask is answered WITH AUDIO 3.4 s after it is sent — the lens-1440 shape: the
      // gateway is working through its six-second unheard deadline, not holding. Ask 0's audio is
      // therefore due at 3400, past the rungs at 700 and 1400 and squarely under the one at 3000.
      tts: (_t, signal) => {
        asks++;
        return new Promise<Response>((resolve) => {
          const timer = setTimeout(() => resolve(clipResponse()), 3400);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve(new Response('no', { status: 499 }));
          });
        });
      },
    });
    FakeSocket.script = () => {}; // the socket opened at the grace never says a word, as it did live
    const { beats, utterance } = await speak(['A ray through the centre goes straight on.']);
    await utterance.done;

    expect(beats.length).toBe(1);
    // The first ask's audio was ready at 3400 ms and it is the one the learner hears. Murdering it
    // at the 3000 rung costs the next one's whole read on top of its own head start: 700 + 3400.
    expect(beats[0]?.at ?? Infinity).toBeLessThan(3900);
    // Ask 0 at 0, the rungs at 700 and 1400 — and no rung past them while all three are in the air.
    expect(asks).toBeLessThanOrEqual(3);
  }, 20000);

  it('runs the deciding ladder for the deciding sentence only, not for the one behind it', async () => {
    // THE OTHER HALF OF THE LENS TURN'S BILL. `turn.spoke()` does not run until the clip actually
    // plays, but the NEXT sentence is asked for a line earlier — so on every turn sentence two
    // found `turn.chosen()` still null and took the full deciding ladder: three more reads and a
    // twelve-second budget, for a sentence whose mouth was settled the moment sentence one's clip
    // won it. Six upstream voice reads for a two-sentence turn, where four is the honest number.
    let asks = 0;
    serve({
      session: () => ok({ mode: 'tts', token: 't-1' }),
      tts: (_t, signal) => {
        asks++;
        return new Promise<Response>((resolve) => {
          const timer = setTimeout(() => resolve(clipResponse()), 3400);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve(new Response('no', { status: 499 }));
          });
        });
      },
    });
    FakeSocket.script = () => {};
    const { beats, utterance } = await speak([
      'A ray through the centre goes straight on. The image is real and inverted.',
    ]);
    await utterance.done;

    expect(beats.map((b) => b.index)).toEqual([0, 1]);
    // Sentence one's own three chances, and ONE ask for sentence two — the mouth is not in doubt.
    expect(asks).toBeLessThanOrEqual(4);
    // And the seam is no worse for it: sentence two is still asked for while sentence one plays.
    expect((beats[1]?.at ?? 0) - (beats[0]?.at ?? 0)).toBeLessThan(3900);
  }, 25000);

  it('still climbs at once when the route is holding rather than working', async () => {
    // The wave-58 shape this ladder was built for, and it must not be lost: ask 0 is HELD and
    // never answers; the rung's ask is the same sentence off the gateway's disk in milliseconds.
    let asks = 0;
    serve({
      session: () => ok({ mode: 'tts', token: 't-1' }),
      tts: (_t, signal) => {
        asks++;
        return asks === 1 ? hang(signal) : Promise.resolve(clipResponse());
      },
    });
    FakeSocket.script = () => {};
    const { beats, utterance } = await speak(['The hypotenuse is opposite the right angle.']);
    await utterance.done;

    expect(asks).toBeGreaterThan(1);
    expect(beats[0]?.at ?? Infinity).toBeLessThan(REASK_RUNGS_MS[0] + 600);
  }, 20000);
});

describe('the grace is paid once a session, not once a turn', () => {
  it('opens the second hanging turn’s socket at once, having learnt on the first', async () => {
    serve({ session: () => ok({ mode: 'tts', token: 't-n' }), tts: (_t, s) => hang(s) });
    FakeSocket.script = (ws) => {
      setTimeout(() => ws.chunk(), 40);
      setTimeout(() => ws.done(), 90);
    };
    const one = await speak(['The buffered route is hanging today.']);
    await one.utterance.done;
    const first = (FakeSocket.made[0] as FakeSocket).createdAt - one.started;
    expect(first).toBeGreaterThanOrEqual(STREAM_AFTER_MS - 40);

    FakeSocket.made = [];
    const two = await speak(['And it is still hanging on the next turn.']);
    await two.utterance.done;
    const again = (FakeSocket.made[0] as FakeSocket).createdAt - two.started;
    expect(again).toBeLessThan(80); // no grace the second time: the session already knows
    expect(two.beats[0]?.at ?? Infinity).toBeLessThan(first);
  }, 20000);
});

// --- WHAT THE JUDGE MEASURED ON THE LIVE WIRE, 2026-09-15 ----------------------------------------
//
// Eleven boards on Luna, every browser --mute-audio, every request off a patched `window.fetch`
// and every socket off a patched `WebSocket`:
//
//   · `/v1/voice/tts` requests fell 78 to 55 — but voice SOCKETS rose 12 to 43, the socket mouth
//     won 5 boards instead of 1, and the voice bill rose 0.145 to 0.195 USD (+34 percent), of
//     which gemini native audio went 0.008 to 0.049;
//   · the socket's first MESSAGE landed at 1.8 to 2.0 s and its first AUDIO at 4.8 to 8.4 s;
//   · and a later sentence of a streamed turn opened THREE sockets inside TWENTY MILLISECONDS, all
//     of them closed with no syllable, before a fourth spoke.
//
// That last one is the gateway's own cap answering: voice.py keeps two live TTS sockets for a
// learner (`_MAX_TTS_PER_SUBJECT`) and closes the third at once with a 1008. The sentence in front
// was still streaming (one), the sentence's own socket was open (two), and the rung at
// STREAM_REASK_MS made a third — three mints, three native-audio starts, nothing heard, and the
// sentence itself went silent while they were spent.

describe('the gateway keeps two sockets for one learner, and so does this file', () => {
  it('waits for a slot instead of opening a third the gateway can only refuse', async () => {
    FakeSocket.cap = 2;
    const { mints } = serve({
      session: () => ok({ mode: 'tts', token: 't-n' }),
      tts: (_t, s) => hang(s),
    });
    FakeSocket.script = (ws, text) => {
      if (text.startsWith('One side')) {
        // A real sentence of audio: the socket stays LIVE while it streams, and the gateway counts
        // it the whole time. This is the socket the later ones are queueing behind.
        setTimeout(() => ws.chunk(), 40);
        setTimeout(() => ws.done(), 4000);
        return;
      }
      // Sentence two's first socket opens and never says a word — the live shape. Only a socket
      // that gets a real slot (the second one, once the sentence in front is whole) speaks.
      const nth = FakeSocket.made.filter((w) => w.sent[0] === text).length;
      if (nth >= 2) {
        setTimeout(() => ws.chunk(), 40);
        setTimeout(() => ws.done(), 300);
      }
    };
    const { beats, utterance } = await speak(['One side is three. The other side is four.']);
    await utterance.done;

    expect(beats.map((b) => b.index)).toEqual([0, 1]);
    // Not one socket was opened for the gateway to close unheard, and not one token was minted
    // for one: the third waited for the first to finish instead.
    expect(FakeSocket.refused).toBe(0);
    expect(mints.n).toBe(FakeSocket.made.length);
    // And the sentence that used to be spent on refusals is spoken: both sentences are on the
    // socket's voice, the second one on a slot the first gave back.
    expect(streams().length).toBeGreaterThanOrEqual(2);
    expect(clips().length).toBe(0);
  }, 20000);

  it('does not open another socket in the millisecond one was refused on sight', async () => {
    // Belt to the cap's braces: whatever the gateway refuses a socket FOR, asking again the same
    // millisecond buys the same no. A socket that dies before a connection could even be made was
    // refused, not killed; only one that really tried is replaced at once.
    serve({ session: () => ok({ mode: 'tts', token: 't-n' }), tts: (_t, s) => hang(s) });
    FakeSocket.script = (ws, text) => {
      if (text.startsWith('One side')) {
        setTimeout(() => ws.chunk(), 40);
        setTimeout(() => ws.done(), 120);
        return;
      }
      setTimeout(() => ws.close(), 5); // refused on sight, no syllable in it
    };
    const { beats, utterance } = await speak(['One side is three. The other side is four.']);
    await utterance.done;

    expect(beats.map((b) => b.index)).toEqual([0, 1]);
    // ONE socket for the refused sentence, not three. The learner hears no more either way; the
    // difference is two mints, two native-audio starts and two connections nobody heard.
    expect(FakeSocket.made.filter((w) => w.sent[0]?.startsWith('The other')).length).toBe(1);
  }, 20000);
});

describe('a later sentence is given the time the day actually takes', () => {
  it('does not kill its own socket at a deadline the day is already past', async () => {
    // THE REST OF THE TURN, on 2026-09-15. The socket that won a board had its first AUDIO at 4.8
    // to 8.4 s (its first message at 1.8 to 2.0). The deciding sentence can afford that: firstSound
    // gives it the whole twelve seconds. Every sentence AFTER it got STREAM_SENTENCE_MS — 4500 —
    // so our own watchdog killed its socket before the day's audio could arrive, the rung opened a
    // second to be killed the same way, and the sentence fell to the reading clock in silence.
    // One sentence heard, the rest of the turn mute, two or three native-audio starts per silence.
    serve({ session: () => ok({ mode: 'tts', token: 't-n' }), tts: (_t, s) => hang(s) });
    FakeSocket.script = (ws) => {
      setTimeout(() => ws.chunk(), 5000); // the day, as the wire had it
      setTimeout(() => ws.done(), 5300);
    };
    const { beats, utterance } = await speak(['One side is three. The other side is four.']);
    await utterance.done;

    expect(beats.map((b) => b.index)).toEqual([0, 1]);
    // BOTH sentences are heard, on the one voice that won the turn.
    expect(streams().length).toBeGreaterThanOrEqual(2);
    // And on ONE socket each: no rung fires before the day's own time, so nothing is bought to
    // stand beside a socket that is merely keeping up with the weather.
    expect(FakeSocket.made.filter((w) => w.sent[0]?.startsWith('The other')).length).toBe(1);
  }, 30000);
});
