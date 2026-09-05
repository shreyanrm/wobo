/**
 * LAW 5, held over the wire: "it shouldnt just draw on the image, it should explain while drawing
 * on that photo" (owner, on the first brief).
 *
 * A doubt's answer rides the SAME SSE stream as every board turn (wobo/board-stream.ts) — say,
 * ink, action, ask, card, done, in order — from its own door, `POST /v1/doubt/{id}/answer`, with
 * the learner's corrections as the body (services/gateway doubt.py). This test drives the real
 * parser and the real dispatcher against a fake gateway at that door, records the frame order
 * exactly as it landed, and holds it to `checkBeats` over the photo's own lines: every ink frame
 * anchored to a line arrives inside the window of the say frame that explains it. A turn shaped
 * "draw everything, then explain" fails; so does "explain, then draw everything". The fixture is
 * what a conforming answer looks like on the wire, and `docs/DOUBT.md` carries the same shape.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { streamBoardTurn } from '../../wobo/board-stream';
import { checkBeats, frameRecorder, offPageStrokes } from '../../wobo/doubt-surface';
import { answerBody, doubtAnswerPath } from './api';

type Frame = Record<string, unknown>;
const encode = (frames: Frame[]): string =>
  frames.map((f, i) => `id: t1:${i}\ndata: ${JSON.stringify(f)}\n\n`).join('');

let realFetch: typeof globalThis.fetch;
const sent: { url: string; body: Record<string, unknown>; accept: string }[] = [];

function serve(frames: Frame[]): void {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      accept: new Headers(init?.headers).get('accept') ?? '',
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(encode(frames)));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;
}

const DOUBT_ID = 'd9f3a1b2';
/** The gateway's line ids: the targets its ink anchors to. */
const LINES = new Set(['r1', 'r2', 'r3']);

const say = (t: number, text: string, dur: number): Frame => ({ type: 'say', text, t, dur });
const circle = (id: string, target: string, t: number): Frame => ({
  type: 'ink',
  t,
  object: { id, kind: 'circle', anchor: { target }, pad: 12, t: { start: t, dur: 400 } },
});

/** What a conforming answer looks like: each stroke inside the sentence about it. */
const CONFORMING: Frame[] = [
  say(0, 'I read this as 3x plus 5 equals 20. Look at the five first.', 2600),
  circle('c-five', 'r2', 300),
  say(2600, 'It moves to the other side and becomes minus five.', 2400),
  circle('c-rhs', 'r3', 2900),
  say(5000, 'So three x is fifteen, and x is five.', 2200),
  circle('c-eq', 'r1', 5200),
  { type: 'done', t: 7400, objects: 3, presentation: 'screen' },
];

/** Everything drawn first, then the paragraph: the failure the owner named. */
const INK_THEN_PARAGRAPH: Frame[] = [
  circle('c-five', 'r2', 0),
  circle('c-rhs', 'r3', 200),
  circle('c-eq', 'r1', 400),
  say(1200, 'Move the five, then divide by three, and x is five.', 3000),
  { type: 'done', t: 4200, objects: 3 },
];

/** The paragraph, then all the ink: the other failure. */
const PARAGRAPH_THEN_INK: Frame[] = [
  say(0, 'Move the five, then divide by three, and x is five.', 3000),
  circle('c-five', 'r2', 3200),
  circle('c-rhs', 'r3', 3400),
  circle('c-eq', 'r1', 3600),
  { type: 'done', t: 4000, objects: 3 },
];

const CORRECTIONS = [
  { id: 'r1', text: '3x + 5 = 20' },
  { id: 'r2', text: '5' },
  { id: 'r3', text: '20' },
];

async function record(frames: Frame[]) {
  serve(frames);
  const rec = frameRecorder();
  const result = await streamBoardTurn({
    gatewayUrl: 'http://brain.test',
    payload: { context: { turn: { lastUserInput: 'Explain this to me: 3x + 5 = 20' } } },
    endpoint: doubtAnswerPath(DOUBT_ID),
    body: answerBody(CORRECTIONS, 'Explain this to me: 3x + 5 = 20'),
    handlers: rec.handlers,
  });
  return { result, frames: rec.frames() };
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  sent.length = 0;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("a doubt's answer over the one wire, from its own door", () => {
  it('records the frame order as it landed, and the law holds on a conforming answer', async () => {
    const { result, frames } = await record(CONFORMING);
    expect(result.completed).toBe(true);
    expect(result.lastEventId).toBe('t1:6');
    expect(frames.map((f) => `${f.type}@${f.t}${f.target ? `→${f.target}` : ''}`)).toEqual([
      'say@0',
      'ink@300→r2',
      'say@2600',
      'ink@2900→r3',
      'say@5000',
      'ink@5200→r1',
      'done@5200',
    ]);
    expect(checkBeats(frames, { targets: LINES })).toEqual({
      ok: true,
      orphans: [],
      inks: 3,
      says: 3,
    });
  });

  it('asks at the answer door with the corrections as the body, and asks for the stream', async () => {
    await record(CONFORMING);
    expect(sent[0]?.url).toBe('http://brain.test/v1/doubt/d9f3a1b2/answer');
    expect(sent[0]?.accept).toBe('text/event-stream');
    expect(sent[0]?.body).toEqual({
      lines: CORRECTIONS,
      words: 'Explain this to me: 3x + 5 = 20',
    });
    // the ordinary envelope does not ride this door: the gateway composes the packet itself
    expect(sent[0]?.body).not.toHaveProperty('payload');
  });

  it('the ordinary board turn is untouched: no endpoint, no body, the one capability door', async () => {
    serve(CONFORMING);
    await streamBoardTurn({
      gatewayUrl: 'http://brain.test',
      payload: { context: {} },
      handlers: {},
    });
    expect(sent[0]?.url).toBe('http://brain.test/v1/capability/wobo.turn');
    expect(sent[0]?.body).toEqual({ payload: { context: {} } });
  });

  it('fails all the ink, then a paragraph', async () => {
    const { frames } = await record(INK_THEN_PARAGRAPH);
    const report = checkBeats(frames, { targets: LINES });
    expect(report.ok).toBe(false);
    expect(report.orphans.map((o) => o.id)).toEqual(['c-five', 'c-rhs', 'c-eq']);
  });

  it('fails a paragraph, then all the ink', async () => {
    const { frames } = await record(PARAGRAPH_THEN_INK);
    const report = checkBeats(frames, { targets: LINES });
    expect(report.ok).toBe(false);
    expect(report.orphans).toHaveLength(3);
  });

  it('law 3 — every stroke of the conforming answer resolves to a line on the page', () => {
    const page = { x: 20, y: 80, width: 350, height: 500 };
    const rects: Record<string, { x: number; y: number; width: number; height: number }> = {
      r1: { x: 60, y: 180, width: 200, height: 30 },
      r2: { x: 130, y: 180, width: 20, height: 30 },
      r3: { x: 220, y: 180, width: 40, height: 30 },
    };
    const objects = CONFORMING.filter((f) => f.type === 'ink').map(
      (f) => f.object as { id: string; anchor: unknown; pad?: number },
    );
    expect(offPageStrokes(objects, (id) => rects[id] ?? null, page, { targets: LINES })).toEqual(
      [],
    );
    // the same strokes with the photo scrolled half off the top: measured, not shrugged at
    const scrolled = { ...page, y: 200 };
    expect(
      offPageStrokes(objects, (id) => rects[id] ?? null, scrolled, { targets: LINES }).map(
        (b) => b.id,
      ),
    ).toEqual(['c-five', 'c-rhs', 'c-eq']);
  });
});
