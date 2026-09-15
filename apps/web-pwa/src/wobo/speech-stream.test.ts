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
    setTimeout(() => this.onopen?.(), 2);
  }
  send(text: string) {
    this.sent.push(text);
    FakeSocket.script(this, text);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
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

function serve(wire: Wire): { ttsAsks: string[] } {
  const ttsAsks: string[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/v1/voice/session')) return Promise.resolve(wire.session());
    if (u.includes('/v1/voice/tts')) {
      const text = String((JSON.parse(String(init?.body ?? '{}')) as { text?: string }).text);
      ttsAsks.push(text);
      return wire.tts(text, init?.signal);
    }
    return Promise.resolve(new Response('{}'));
  }) as unknown as typeof fetch;
  return { ttsAsks };
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
