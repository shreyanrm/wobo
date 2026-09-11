import { describe, expect, it } from 'bun:test';
import type { WoboAction, WoboMood } from '@wobo/wobo';
import {
  beatOfMood,
  beatOfTurn,
  onceCallback,
  sentences,
  speakLine,
  voiceOfTheTurn,
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

// --- ONE VOICE, ONE TURN ------------------------------------------------------------------------
//
// Measured live on 2026-09-10, twelve turns, every browser muted, timings off the synthesis call
// and the wire: on two of six boards the answer fell through to the DEVICE's own voice in the
// MIDDLE of itself — the plant cell's second sentence at 25 271 ms, the projectile's at 21 428 ms,
// after this file's eight-second abandon. So a learner heard Wobo say the first sentence and the
// phone say the second. INK-FOUR experience asks for one voice, and a turn is one performance.
//
// The device voice is the LAST voice and it is a whole turn's voice or none of it: a turn that has
// already been spoken aloud by Wobo holds a sentence it cannot get in silence, on the reading
// clock, rather than finishing in a different mouth.

describe('one voice for a whole turn — the device is never reached mid-answer', () => {
  it('holds a failed sentence on the clock once Wobo has spoken in this turn', () => {
    const turn = voiceOfTheTurn();
    expect(turn.chosen()).toBe(null);
    turn.spoke(); // the gateway's voice read the first sentence
    expect(turn.chosen()).toBe('gateway');
    expect(turn.whenSilent(true)).toBe('clock'); // the device could — and must not
    expect(turn.whenSilent(true)).toBe('clock');
    expect(turn.chosen()).toBe('gateway');
  });

  it('lets the device read the turn when Wobo has not spoken a syllable of it', () => {
    const turn = voiceOfTheTurn();
    expect(turn.whenSilent(true)).toBe('device');
    expect(turn.chosen()).toBe('device');
    expect(turn.whenSilent(true)).toBe('device'); // and it keeps reading it, to the end
  });

  it('falls to the reading clock when the device cannot speak either', () => {
    const turn = voiceOfTheTurn();
    expect(turn.whenSilent(false)).toBe('clock');
    expect(turn.chosen()).toBe(null); // nothing was chosen, so Wobo may still take the turn
    turn.spoke();
    expect(turn.chosen()).toBe('gateway');
  });

  it('never hands a device-voiced turn back to Wobo halfway through', () => {
    const turn = voiceOfTheTurn();
    expect(turn.whenSilent(true)).toBe('device');
    turn.spoke(); // a late sentence arrives from the gateway
    expect(turn.chosen()).toBe('device');
    expect(turn.whenSilent(true)).toBe('device');
  });
});
