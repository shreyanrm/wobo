import { describe, expect, it } from 'bun:test';
import type { WoboAction, WoboBus, WoboMood } from '@wobo/wobo';
import { planPerformance } from '@wobo/wobo';
import {
  beatOfMood,
  beatOfTurn,
  onceCallback,
  performTurn,
  sentenceBeats,
  sentences,
  speakLine,
  withBeat,
} from './speech';

describe('the sentence splitter — where a period really ends a breath', () => {
  it('keeps decimals in one piece', () => {
    expect(sentences('π is about 3.14 for our purposes.')).toEqual([
      'π is about 3.14 for our purposes.',
    ]);
    expect(sentences('Version 1.2.3 shipped. Then we moved on.')).toEqual([
      'Version 1.2.3 shipped.',
      'Then we moved on.',
    ]);
  });

  it('keeps abbreviations and initials in one piece', () => {
    expect(sentences('Take a solid, e.g. ice, and warm it.')).toEqual([
      'Take a solid, e.g. ice, and warm it.',
    ]);
    expect(sentences('Dr. Rao showed this first.')).toEqual(['Dr. Rao showed this first.']);
    expect(sentences('Bring a ruler, a pen, etc. Then we start.')).toEqual([
      'Bring a ruler, a pen, etc. Then we start.',
    ]);
  });

  it('still breaks on a real sentence end, a question, an exclamation and a newline', () => {
    expect(sentences('That holds. Why does it hold? Because both sides moved!')).toEqual([
      'That holds.',
      'Why does it hold?',
      'Because both sides moved!',
    ]);
    expect(sentences('First line\nSecond line')).toEqual(['First line', 'Second line']);
  });

  it("keeps the intro's short opening sentence as its own beat (first audio stays fast)", () => {
    expect(sentences('Hey there. I can see the page you are on, so just ask.')).toEqual([
      'Hey there.',
      'I can see the page you are on, so just ask.',
    ]);
  });

  it('never returns nothing for a line with no punctuation at all', () => {
    expect(sentences('no punctuation here')).toEqual(['no punctuation here']);
  });
});

describe('onDone is guaranteed, and guaranteed once', () => {
  it('a once-guard runs the callback exactly one time', () => {
    let n = 0;
    const finish = onceCallback(() => n++);
    finish();
    finish();
    finish();
    expect(n).toBe(1);
    expect(() => onceCallback(undefined)()).not.toThrow(); // no callback is still safe
  });

  it('a line that cannot be spoken still releases the gate exactly once', async () => {
    let n = 0;
    await speakLine('Wobo is on screen either way', { onDone: () => n++ });
    expect(n).toBe(1); // keyless/muted: the advance button must never stay locked
  });

  it('an empty line releases the gate too', async () => {
    let n = 0;
    await speakLine('   ', { onDone: () => n++ });
    expect(n).toBe(1);
  });
});

/** A bus that just records what the performance asked for. */
function recordingBus() {
  const beats: { actions: WoboAction[]; opts?: { noteDurationMs?: number } }[] = [];
  let turns = 0;
  const bus: Pick<WoboBus, 'addBeat' | 'beginTurn'> = {
    addBeat: (actions, opts) => {
      beats.push({ actions, opts });
    },
    beginTurn: () => {
      turns++;
    },
  };
  return { bus, beats, turnCount: () => turns };
}

describe('performTurn — one performance, every beat once', () => {
  it('fires each anchored beat exactly once and opens exactly one turn', async () => {
    const { bus, beats, turnCount } = recordingBus();
    const actions = [
      { type: 'highlight', targetId: 'a', withSentence: 0 },
      { type: 'annotate', targetId: 'b', mark: 'underline', afterSentence: 0 },
      { type: 'say', text: 'and that is why', afterSentence: 1 },
    ] as unknown as WoboAction[];
    const moods: WoboMood[] = [];

    await performTurn('Take three. Now double it.', actions, bus, {
      onMood: (m) => moods.push(m),
    });

    expect(turnCount()).toBe(1);
    // the finally-flush used to replay every afterSentence beat after a completed performance
    expect(beats.length).toBe(3);
    const targets = beats.flatMap((b) => b.actions.map((a) => JSON.stringify(a)));
    expect(new Set(targets).size).toBe(3); // no duplicates
    expect(moods).toEqual([]);
  }, 30000);
});

// --- the beat (docs/copy/voice.md 10b): the tutor knows what a line is, and the voice is told ------

describe('the beat travels with the line', () => {
  it('maps the moods the tutor already sets onto the five beats, and has no opinion otherwise', () => {
    expect(beatOfMood('correct')).toBe('win');
    expect(beatOfMood('celebrate')).toBe('win');
    expect(beatOfMood('oops')).toBe('miss');
    expect(beatOfMood('hint')).toBe('miss');
    expect(beatOfMood('waiting')).toBe('ask'); // "waiting" when the move is theirs: Wobo just asked
    for (const calm of ['thinking', 'idle', 'explaining', 'listening', 'resting'] as WoboMood[]) {
      expect(beatOfMood(calm)).toBeUndefined();
    }
    expect(beatOfMood(undefined)).toBeUndefined();
  });

  it("reads a turn's beat off its last setMood, and a crisis beats every mood", () => {
    const won: WoboAction[] = [
      { type: 'setMood', mood: 'thinking' },
      { type: 'setMood', mood: 'correct' },
    ];
    expect(beatOfTurn(won)).toBe('win');
    expect(beatOfTurn([{ type: 'setMood', mood: 'hint' }])).toBe('miss');
    expect(beatOfTurn([])).toBe('step');
    expect(beatOfTurn([{ type: 'setMood', mood: 'thinking' }])).toBe('step');
    // the crisis line is the softest of all, whatever mood rode along with it
    expect(beatOfTurn(won, { category: 'crisis' })).toBe('crisis');
    expect(beatOfTurn([], { category: 'moderation' })).toBe('step');
  });

  it('gives each sentence of a choreographed turn its own beat, carried forward until the next', () => {
    // The worked shape from the tutor's own prompt: thinking on the setup, waiting on the question.
    const actions: WoboAction[] = [
      { type: 'setMood', mood: 'thinking', withSentence: 0 },
      { type: 'setMood', mood: 'waiting', withSentence: 2 },
    ];
    expect(sentenceBeats(planPerformance(actions, 3), 3, 'step')).toEqual(['step', 'step', 'ask']);
    // a check mark on sentence 0 and "waiting" AFTER sentence 1: the win, then the question
    const affirmed: WoboAction[] = [
      { type: 'setMood', mood: 'correct', withSentence: 0 },
      { type: 'setMood', mood: 'waiting', afterSentence: 0 },
    ];
    expect(sentenceBeats(planPerformance(affirmed, 2), 2, 'step')).toEqual(['win', 'ask']);
    // no anchored mood at all: the turn's beat, every sentence
    expect(sentenceBeats(planPerformance([], 2), 2, 'miss')).toEqual(['miss', 'miss']);
  });

  it('reads every sentence of a crisis turn as the crisis, whatever mood the model anchored', () => {
    // The turn-level guarantee (beatOfTurn puts the crisis first) used to stop at the turn: a
    // `celebrate` the model anchored to sentence 1 re-leaned sentences 1 and 2 to a win, so the
    // softest line of all was read brightly by accident. The safety block is the gateway's own.
    const cheered: WoboAction[] = [{ type: 'setMood', mood: 'celebrate', withSentence: 1 }];
    expect(beatOfTurn(cheered, { category: 'crisis' })).toBe('crisis');
    expect(sentenceBeats(planPerformance(cheered, 3), 3, 'crisis')).toEqual([
      'crisis',
      'crisis',
      'crisis',
    ]);
    const after: WoboAction[] = [
      { type: 'setMood', mood: 'correct', withSentence: 0 },
      { type: 'setMood', mood: 'waiting', afterSentence: 0 },
    ];
    expect(sentenceBeats(planPerformance(after, 2), 2, 'crisis')).toEqual(['crisis', 'crisis']);
    // and the same anchors on an ordinary turn still lean, so the guard is the crisis alone
    expect(sentenceBeats(planPerformance(cheered, 3), 3, 'step')).toEqual(['step', 'win', 'win']);
  });

  it('carries the beat on the socket URL beside the token, never in the spoken frame', () => {
    const url = withBeat('wss://brain.test/v1/voice/tts/stream?token=abc', 'win');
    expect(url).toBe('wss://brain.test/v1/voice/tts/stream?token=abc&beat=win');
    expect(withBeat('wss://brain.test/v1/voice/tts/stream?token=abc', 'step')).toBe(
      'wss://brain.test/v1/voice/tts/stream?token=abc&beat=step',
    );
  });
});
