/**
 * The transcript reads as one voice, and it records what Wobo SAID (docs/INK-FREEZE-PLAN-TRACE.md
 * §3, Trace; the lab's finding 12, 2026-09-08).
 *
 * Two laws, asserted here on the pure line and then over the real conductor on a fake wire:
 *  · the question is printed once — the plan's last sentence IS its ask, and the ask frame that
 *    follows it repeats it, so every turn with a question printed it twice
 *    ("What do you notice about it? What do you notice about it?");
 *  · after Escape the line holds only what the voice reached, never the sentences that were still
 *    streaming behind it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { boardBook, plane } from '@wobo/wobo';
import { boardTurn, screenStore } from './board-turn';
import { linePrinted, newTurnLine, sameSentence, sayable } from './transcript';

describe('the line Wobo is growing', () => {
  it('grows one sentence at a time, in the order they were spoken', () => {
    const line = newTurnLine();
    expect(line.say('The five crosses the equals sign.')).toBe(true);
    expect(line.say('Both sides moved together.')).toBe(true);
    expect(line.text()).toBe('The five crosses the equals sign. Both sides moved together.');
  });

  it('prints the ask once — the sentence that already asked it is the ask', () => {
    const line = newTurnLine();
    line.say('The five crosses the equals sign.');
    line.say('What do you notice about it?');
    expect(line.ask('What do you notice about it?')).toBe(false);
    expect(line.text()).toBe('The five crosses the equals sign. What do you notice about it?');
  });

  it('prints an ask nobody has said yet', () => {
    const line = newTurnLine();
    line.say('Both sides moved together.');
    expect(line.ask('Which step feels shaky?')).toBe(true);
    expect(line.text()).toBe('Both sides moved together. Which step feels shaky?');
  });

  it('is not fooled by punctuation, case or the spaces a stream leaves', () => {
    expect(sameSentence('What do you notice about it?', 'what do you  notice about it')).toBe(true);
    expect(sameSentence('Which step feels shaky?', 'What do you notice about it?')).toBe(false);
  });

  it('refuses a line that came back as machinery rather than words', () => {
    const line = newTurnLine();
    expect(line.say('{"path":"visualization","viz":{"kind":"diagram"}}')).toBe(false);
    expect(line.say('Here it is {"kind": "ring"} for you')).toBe(false);
    expect(line.ask('{"prompt":"what do you notice"}')).toBe(false);
    expect(line.text()).toBe('');
  });

  it('lets ordinary prose through untouched', () => {
    expect(sayable('The hypotenuse is the longest side.')).toBe(true);
    expect(sayable('c squared is 25, so c is 5.')).toBe(true);
  });

  it('refuses anything that parses as JSON, brace or not', () => {
    expect(sayable('[1, 2, 3]')).toBe(false);
    expect(sayable('"just a string"')).toBe(false);
    expect(sayable('42')).toBe(true);
  });

  it('never prints an empty frame, and says nothing about it', () => {
    const line = newTurnLine();
    expect(line.say('   ')).toBe(false);
    expect(line.ask('')).toBe(false);
    expect(line.text()).toBe('');
  });
});

// --- over the real conductor, on a fake wire ------------------------------------------------------

type Frame = { id?: string; data: Record<string, unknown> };

const encode = (frames: Frame[]): string =>
  frames.map((f) => `${f.id ? `id: ${f.id}\n` : ''}data: ${JSON.stringify(f.data)}\n\n`).join('');

let realFetch: typeof globalThis.fetch;

/**
 * A gateway that hands over these frames and then closes, or holds the stream open. Only the turn
 * is answered: the voice's own calls go to the same origin, and answering those with a stream that
 * never closes hangs the utterance and with it every sentence the transcript is waiting on.
 */
function serve(frames: Frame[], ends: 'close' | 'hang' = 'close'): void {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).includes('/v1/capability/wobo.turn')) {
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    }
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
          controller.enqueue(new TextEncoder().encode(encode(frames)));
          if (ends === 'close') controller.close();
          return;
        }
        if (ends === 'close') {
          controller.close();
          return;
        }
        return new Promise<void>(() => {});
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;
}

/** The seam AppRuntime wires: every say and the ask grow the one line of this turn. */
function runWithLine(): { line: ReturnType<typeof newTurnLine>; done: Promise<unknown> } {
  const line = newTurnLine();
  const done = boardTurn.run({
    gatewayUrl: 'http://brain.test',
    payload: {},
    route: 'learn',
    title: 't',
    onSay: (said) => void line.say(said),
    onAsk: (prompt) => void line.ask(prompt),
  });
  return { line, done };
}

/** Wait for the turn to reach a state, or fail rather than hang. */
async function until(ready: () => boolean, capMs = 5000): Promise<void> {
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > capMs) throw new Error('the turn never got there');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  screenStore.reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  plane.dismiss();
  for (const id of boardBook.ids()) boardBook.drop(id);
});

describe('a turn with a question in it', () => {
  it('prints the question once, though the wire carries it twice', async () => {
    serve([
      { data: { type: 'say', text: 'The five crosses the equals sign.', t: 0, dur: 40 } },
      { data: { type: 'say', text: 'What do you notice about it?', t: 40, dur: 40 } },
      { data: { type: 'ask', prompt: 'What do you notice about it?', targets: [], t: 80 } },
      { data: { type: 'done', objects: 0 } },
    ]);
    const { line, done } = runWithLine();
    await done;
    expect(line.text()).toBe('The five crosses the equals sign. What do you notice about it?');
    const asked = line.text().match(/What do you notice about it\?/g) ?? [];
    expect(asked).toHaveLength(1);
  }, 20_000);

  it('prints it once even when another sentence followed it', async () => {
    // The wire's own guard only knows the sentence it just sent; the line knows the whole turn.
    serve([
      { data: { type: 'say', text: 'What do you notice about it?', t: 0, dur: 40 } },
      { data: { type: 'say', text: 'Take your time.', t: 40, dur: 40 } },
      { data: { type: 'ask', prompt: 'What do you notice about it?', targets: [], t: 80 } },
      { data: { type: 'done', objects: 0 } },
    ]);
    const { line, done } = runWithLine();
    await done;
    expect(line.text()).toBe('What do you notice about it? Take your time.');
  }, 20_000);

  it('prints a question the say frames never carried', async () => {
    serve([
      { data: { type: 'say', text: 'Both sides moved together.', t: 0, dur: 40 } },
      { data: { type: 'ask', prompt: 'Which step feels shaky?', targets: [], t: 40 } },
      { data: { type: 'done', objects: 0 } },
    ]);
    const { line, done } = runWithLine();
    await done;
    expect(line.text()).toBe('Both sides moved together. Which step feels shaky?');
  }, 20_000);
});

describe('the learner cuts Wobo off', () => {
  it('records only what was said, never the sentences still on the wire', async () => {
    serve(
      [
        { data: { type: 'say', text: 'The five crosses the equals sign.', t: 0, dur: 40 } },
        { data: { type: 'say', text: 'So the sign flips.', t: 40, dur: 40 } },
        { data: { type: 'say', text: 'And the answer is five.', t: 80, dur: 40 } },
      ],
      'hang',
    );
    const { line, done } = runWithLine();
    // The whole plan has landed and the voice has begun its first sentence; Escape lands here.
    await until(() => line.said().length === 1);
    boardTurn.interrupt();
    await done;
    expect(line.text()).toBe('The five crosses the equals sign.');
  }, 20_000);
});

describe('an interrupted turn leaves no empty bubble (the adversary, wave 47, finding 9)', () => {
  // Escape mid-stroke left `{"role":"wobo","text":""}` standing in the transcript, live and
  // keyless — the same defect wave 44 named. The line is minted at the ask so it can grow as the
  // voice reaches each sentence; when the learner cuts Wobo off before the first one, there is
  // nothing in it to read and it is not a turn Wobo had.
  it('drops a wobo line that never said anything and carries nothing', () => {
    expect(linePrinted({ text: '', extras: undefined })).toBe(false);
    expect(linePrinted({ text: '   ', extras: undefined })).toBe(false);
  });

  it('keeps a line with one sentence in it', () => {
    expect(linePrinted({ text: 'Read the corner cells.', extras: undefined })).toBe(true);
  });

  it('keeps a wordless line that carries something to act on', () => {
    // A turn can answer with a card and no sentence; the bubble is what holds the card.
    expect(linePrinted({ text: '', extras: { path: 'card' } })).toBe(true);
  });
});
