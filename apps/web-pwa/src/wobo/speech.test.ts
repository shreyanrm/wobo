import { describe, expect, it } from 'bun:test';
import type { WoboAction, WoboMood } from '@wobo/wobo';
import { beatOfMood, beatOfTurn, onceCallback, sentences, speakLine, withBeat } from './speech';

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

  it('has no choreography of its own: a turn is one beat, the board keeps time from the plan', () => {
    // The overlay's per-sentence moods (withSentence / afterSentence) went with the overlay
    // (docs/INK-FREEZE-PLAN-TRACE.md §4). A mood the model attaches to a sentence is not parsed.
    const crisis = beatOfTurn([{ type: 'setMood', mood: 'celebrate' }], { category: 'crisis' });
    expect(crisis).toBe('crisis');
  });

  it('carries the beat on the socket URL beside the token, never in the spoken frame', () => {
    const url = withBeat('wss://brain.test/v1/voice/tts/stream?token=abc', 'win');
    expect(url).toBe('wss://brain.test/v1/voice/tts/stream?token=abc&beat=win');
    expect(withBeat('wss://brain.test/v1/voice/tts/stream?token=abc', 'step')).toBe(
      'wss://brain.test/v1/voice/tts/stream?token=abc&beat=step',
    );
  });
});
