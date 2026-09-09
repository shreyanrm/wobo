/**
 * The trace's laws at the conductor's seam (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace):
 *
 *  · the plane never opens before its first object exists;
 *  · screen ink holds while an ask is open, and fades when the next turn begins;
 *  · a turn with no question lingers, then fades;
 *  · an interruption lifts the pen, fades the ink and releases the glass in one tick;
 *  · the object Wobo was cut off at reaches the next turn's wire.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { boardBook, glassHold, plane, scrollHold } from '@wobo/wobo';
import { boardTurn, lessonStore, screenStore } from './board-turn';

type Frame = { data: Record<string, unknown> };
const encode = (frames: Frame[]): string =>
  frames.map((f) => `data: ${JSON.stringify(f.data)}\n\n`).join('');

const bodies: Record<string, unknown>[] = [];
let realFetch: typeof globalThis.fetch;

type Reply = { frames: Frame[]; ends: 'close' | 'hang' };
const closes = (...frames: Frame[]): Reply => ({ frames, ends: 'close' });
const thenHangs = (...frames: Frame[]): Reply => ({ frames, ends: 'hang' });

function serve(...replies: Reply[]): void {
  let n = 0;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    const reply = replies[Math.min(n++, replies.length - 1)] as Reply;
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
        return new Promise<void>(() => {});
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;
}

const ink = (object: Record<string, unknown>): Frame => ({ data: { type: 'ink', object, t: 0 } });
const say = (text: string): Frame => ({ data: { type: 'say', text, t: 0 } });
const done: Frame = { data: { type: 'done' } };

const RING = {
  id: 'ring',
  kind: 'circle',
  anchor: { target: 'row-2' },
  pad: 9,
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

const run = (override?: 'plane' | 'screen') =>
  boardTurn.run({
    gatewayUrl: 'http://brain.test',
    payload: {},
    route: 'learn',
    title: 't',
    ...(override ? { override } : {}),
  });

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  bodies.length = 0;
  realFetch = globalThis.fetch;
  screenStore.reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  plane.close();
  for (const id of boardBook.ids()) boardBook.drop(id);
});

describe('the plane never opens before its first object exists', () => {
  it('the learner said "board", the brain only talked: no plane', async () => {
    serve(closes(say('There is nothing to draw for that.'), done));
    await run('plane');
    expect(plane.get().open).toBe(false);
  });

  it('opens on the first object that needs it, and not before', async () => {
    serve(closes(ink(AXIS), done));
    await run('plane');
    expect(plane.get().open).toBe(true);
    expect(
      boardBook
        .get(plane.get().boardId)
        .snapshot()
        .map((s) => s.object.id),
    ).toEqual(['x']);
  });
});

describe('ink holds while the question is open', () => {
  it('a turn that ends on an ask keeps its marks; the next turn fades them', async () => {
    serve(closes(ink(RING), { data: { type: 'ask', prompt: 'Which step is wrong?' } }, done));
    const outcome = await run();
    expect(outcome.ask?.prompt).toBe('Which step is wrong?');
    expect(screenStore.get('ring')?.fadingAt).toBeUndefined();

    serve(closes(done));
    await run();
    expect(screenStore.get('ring')?.fadingAt).toBeDefined();
  });

  it('a turn with no question lingers, then fades on its own', async () => {
    serve(closes(ink(RING), done));
    const before = screenStore.time();
    await run();
    const fadingAt = screenStore.get('ring')?.fadingAt;
    expect(fadingAt).toBeDefined();
    expect(fadingAt as number).toBeGreaterThan(before + 1000);
  });
});

describe('an interruption is one tick', () => {
  it('lifts the pen, fades the ink, releases the glass and tells the next turn where', async () => {
    serve(thenHangs(ink({ ...RING, t: { start: 0, dur: 5000 } })));
    const released: boolean[] = [];
    const off = boardTurn.onRelease(() => released.push(true));
    const running = run();
    await tick();
    expect(screenStore.get('ring')).toBeDefined();
    scrollHold.hold('a-stroke');
    const at = boardTurn.interrupt();
    off();
    expect(at).toBe('ring');
    expect(screenStore.get('ring')?.fadingAt).toBeDefined();
    expect(scrollHold.held).toBe(false);
    expect(released).toEqual([true]);
    const outcome = await running;
    expect(outcome.completed).toBe(false);

    serve(closes(done));
    await run();
    const board = (bodies[1] as { payload?: { board?: { interrupted_at?: string } } }).payload
      ?.board;
    expect(board?.interrupted_at).toBe('ring');
  });

  it('a route change while the pen is down is an interruption', async () => {
    serve(thenHangs(ink({ ...RING, t: { start: 0, dur: 5000 } })));
    const running = run();
    await tick();
    boardTurn.routeChanged('home');
    expect(boardTurn.get().active).toBe(false);
    expect(screenStore.get('ring')?.fadingAt).toBeDefined();
    await running;
  });
});

// --- the fixer, wave 34: what the adversary's lab found -------------------------------------------

describe('the glass is let go when the last stroke lands, not when the voice stops', () => {
  it('a long line over one quick ring: the page is free while Wobo is still speaking', async () => {
    const { glassHold } = await import('@wobo/wobo');
    // eight words: the reading clock gives the sentence at least 1.6 s; the ring takes 1 ms
    const line = Array.from({ length: 8 }, () => 'word').join(' ');
    serve(closes(say(`${line}.`), ink({ ...RING, t: { start: 0, dur: 1 } }), done));
    const running = run();
    // the ring lands at once (no sentence before it in the plan's beat), the glass is held
    await tick();
    expect(screenStore.get('ring')).toBeDefined();
    // done has landed and the ring's stroke is over: the hold is released while the voice
    // (the reading clock: eight words, 1.6 s at least) is still going
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    expect(boardTurn.get().active).toBe(true);
    expect(glassHold.held).toBe(false);
    boardTurn.interrupt();
    await running;
  });
});

describe('the ask is asked once', () => {
  it('a say that already ends on the question is not grown or spoken again by the ask frame', async () => {
    const heard: string[] = [];
    serve(
      closes(
        say('Look at the top line. What do you notice about it?'),
        { data: { type: 'ask', prompt: 'What do you notice about it?', targets: [] } },
        done,
      ),
    );
    const outcome = await boardTurn.run({
      gatewayUrl: 'http://brain.test',
      payload: {},
      route: 'learn',
      onSay: (text) => heard.push(text),
      onAsk: (prompt) => heard.push(prompt),
    });
    const joined = heard.join(' ');
    expect(joined.match(/What do you notice about it\?/g)?.length).toBe(1);
    expect(outcome.said.match(/What do you notice about it\?/g)?.length).toBe(1);
    expect(outcome.ask?.prompt).toBe('What do you notice about it?');
  });
});

describe('the transcript reads what was spoken', () => {
  it('after Escape the lines the voice never reached are not printed', async () => {
    const heard: string[] = [];
    serve(
      thenHangs(
        say('One line here.'),
        say('Two lines here now.'),
        say('Three lines here now then.'),
      ),
    );
    const running = boardTurn.run({
      gatewayUrl: 'http://brain.test',
      payload: {},
      route: 'learn',
      onSay: (text) => heard.push(text),
    });
    await tick();
    boardTurn.interrupt();
    // the cut is one tick: nothing more is printed after it, whatever the voice's clock does
    expect(boardTurn.get().active).toBe(false);
    expect(heard.length).toBeLessThan(3);
    const outcome = await running;
    expect(heard.length).toBeLessThan(3);
    expect(outcome.said).not.toContain('Three lines');
  }, 20_000);

  it('a turn that runs to its end prints every line, in order', async () => {
    const heard: string[] = [];
    serve(closes(say('One.'), say('Two.'), done));
    await boardTurn.run({
      gatewayUrl: 'http://brain.test',
      payload: {},
      route: 'learn',
      onSay: (text) => heard.push(text),
    });
    expect(heard).toEqual(['One.', 'Two.']);
  });
});

// --- wave 40: the hold is short and honest, and a drawing never replaces the page --------------

describe('the glass is held only while a stroke is in flight', () => {
  it('never takes the glass at all for a turn that draws nothing', async () => {
    glassHold.reset();
    const taken: boolean[] = [];
    const off = glassHold.subscribe((s) => taken.push(s.held));
    serve(closes(say('There is nothing to draw for that.'), done));
    await run();
    off();
    expect(taken.some(Boolean)).toBe(false);
    expect(glassHold.held).toBe(false);
  });

  it('lets the page go between sentences, and the next mark takes it back', async () => {
    glassHold.reset();
    const taken: boolean[] = [];
    const off = glassHold.subscribe((s) => taken.push(s.held));
    // eight words a sentence: the reading clock gives each one at least 1.6 s, so the second
    // mark waits on its sentence while nothing at all is being drawn.
    const line = Array.from({ length: 8 }, () => 'word').join(' ');
    serve(
      closes(
        say(`${line}.`),
        ink({ ...RING, t: { start: 0, dur: 1 } }),
        say(`${line} again.`),
        ink({ ...RING, id: 'ring2', t: { start: 0, dur: 1 } }),
        done,
      ),
    );
    const running = run();
    await tick();
    expect(screenStore.get('ring')).toBeDefined();
    await new Promise<void>((resolve) => setTimeout(resolve, 320));
    // the first stroke has landed, the second sentence has not begun: the page is the learner's
    expect(screenStore.get('ring2')).toBeUndefined();
    expect(glassHold.held).toBe(false);
    // and the second mark takes it back when its sentence comes
    const deadline = Date.now() + 8000;
    while (!screenStore.get('ring2') && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    off();
    expect(screenStore.get('ring2')).toBeDefined();
    expect(taken.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    boardTurn.interrupt();
    await running;
  }, 20_000);
});

describe('a drawing from scratch never replaces the page a mark is about', () => {
  it('inside a lesson it floats over the page instead of taking the full board', async () => {
    lessonStore.reset();
    serve(closes(ink(RING), ink(AXIS), done));
    await boardTurn.run({
      gatewayUrl: 'http://brain.test',
      payload: {},
      route: 'course',
      title: 't',
    });
    // the ring stayed on the page it is about
    expect(screenStore.get('ring')).toBeDefined();
    // and the axis went to a card floating over that page, not to the board that replaces it
    expect(lessonStore.get('x')).toBeUndefined();
    expect(plane.get().open).toBe(true);
    expect(boardBook.get(plane.get().boardId).get('x')).toBeDefined();
  });

  it('a lesson turn with nothing on the page still uses the lesson board', async () => {
    lessonStore.reset();
    serve(closes(ink(AXIS), done));
    await boardTurn.run({
      gatewayUrl: 'http://brain.test',
      payload: {},
      route: 'course',
      title: 't',
    });
    expect(lessonStore.get('x')).toBeDefined();
  });
});
