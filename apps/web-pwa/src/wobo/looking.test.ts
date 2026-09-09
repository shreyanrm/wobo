import { describe, expect, it } from 'bun:test';
import type { GlassMap } from '@wobo/wobo';
import { echoesQuestion, lookingAt } from './looking';

/** A lesson card's glass: a heading, two plain lines, a chip, a step with a meaning, a figure part. */
const glass = (): GlassMap => ({
  v: 1,
  viewport: { w: 390, h: 844, scrollY: 0 },
  entries: [
    { id: 'h-1', role: 'heading', text: 'Feel the rule', box: [24, 80, 300, 28] },
    {
      id: 'l-1',
      role: 'line',
      text: 'A prime number has exactly two factors.',
      box: [24, 120, 320, 22],
    },
    {
      id: 'l-2',
      role: 'line',
      text: 'the courses being composed for you right now',
      box: [24, 600, 320, 22],
    },
    { id: 'k-1', role: 'chip', text: 'Begin', box: [24, 700, 80, 36] },
    {
      id: 'course-advance',
      role: 'chip',
      text: 'the button that moves this lesson on',
      box: [200, 700, 160, 36],
    },
    { id: 's-3', role: 'step', text: '3x = 15', meaning: 'step:3', box: [24, 300, 120, 24] },
    {
      id: 'p-eff',
      role: 'figure-part',
      text: 'effect',
      meaning: 'part:effect',
      box: [200, 400, 60, 60],
    },
  ],
});

describe('what the words are about is read off the glass, never a registry', () => {
  it('names nothing for a greeting', () => {
    expect(lookingAt('hello', glass())).toBeNull();
    expect(lookingAt('thanks, that helped', glass())).toBeNull();
  });
  it('names the thing a question or a marking word points at', () => {
    expect(lookingAt('which button moves this lesson on?', glass())).toBe('course-advance');
    expect(lookingAt('circle the effect', glass())).toBe('p-eff');
    expect(lookingAt('why is step 3 wrong?', glass())).toBe('s-3');
  });
  it('never falls back to the first thing on the screen, and a plain line is not a thing to mark', () => {
    // "show me the working" names nothing; "the courses being composed" is a line, not a part.
    expect(lookingAt('show me the working', glass())).toBeNull();
    expect(lookingAt('what are the courses being composed?', glass())).toBeNull();
    expect(lookingAt('what is a prime number?', glass())).toBeNull();
  });
  it('names nothing when there is no glass yet', () => {
    expect(lookingAt('circle the effect', null)).toBeNull();
  });
});

/**
 * The lab of 2026-09-08 found Wobo ringing the learner's own question: the glass carried Wobo's
 * companion transcript, and the entry sharing the most words with the question is always the
 * bubble the learner just typed. What the words are about is a thing on the LEARNER'S page.
 */
describe("Wobo never looks at Wobo's own words", () => {
  const withTranscript = (): GlassMap => {
    const map = glass();
    map.entries.push(
      // the learner's own bubble, as the companion renders it, clamped by the reader
      {
        id: 'l-bubble',
        role: 'line',
        text: 'circle the effect circle in the',
        meaning: 'wobo:said',
        box: [24, 640, 320, 22],
      },
      // the question before it, still in the transcript
      {
        id: 'l-earlier',
        role: 'line',
        text: 'why does that step work?',
        meaning: 'wobo:said',
        box: [24, 610, 320, 22],
      },
      // Wobo's reply, growing as the turn speaks
      {
        id: 'l-reply',
        role: 'line',
        text: 'The line that says why does that step work is this one.',
        meaning: 'wobo:said',
        box: [24, 670, 320, 22],
      },
    );
    return map;
  };

  it('rings the part of the figure, not the bubble that repeats the question', () => {
    expect(lookingAt('circle the effect circle in the diagram', withTranscript())).toBe('p-eff');
  });

  it('names the step, not the two lines of the conversation that repeat the question', () => {
    // The transcript's lines carry every word of the question; the step carries one. Scored on
    // shared words alone the conversation always wins, which is what the lab found on the screen.
    expect(lookingAt('why does that step work?', withTranscript())).toBe('s-3');
  });

  it('names nothing for a question the page has nothing to do with', () => {
    // "what is 2 to the power 5?" became a drawing turn that ringed the learner's own bubble at
    // both widths (the lab, finding 10). It is a question about arithmetic, not about this page.
    const map = withTranscript();
    map.entries.push({
      id: 'l-power',
      role: 'line',
      text: 'what is 2 to the power 5?',
      meaning: 'wobo:said',
      box: [24, 700, 320, 22],
    });
    expect(lookingAt('what is 2 to the power 5?', map)).toBeNull();
  });

  it('still names a thing whose words the question quotes', () => {
    // The hypotenuse turn: the question quotes the label, and the label is the subject.
    const map = glass();
    map.entries.push({
      id: 'tri.hyp',
      role: 'figure-part',
      text: 'square on the hypotenuse',
      meaning: 'part:hypotenuse',
      box: [40, 200, 120, 120],
    });
    expect(lookingAt('circle the square on the hypotenuse', map)).toBe('tri.hyp');
  });
});

describe('the words that are the question read back', () => {
  it("knows the learner's own line, clamped or whole", () => {
    expect(echoesQuestion('why does that step work?', 'why does that step work?')).toBe(true);
    expect(
      echoesQuestion('circle the effect circle in the', 'circle the effect circle in the diagram'),
    ).toBe(true);
  });

  it('leaves a subject the question quotes alone', () => {
    expect(echoesQuestion('square on the hypotenuse', 'circle the square on the hypotenuse')).toBe(
      false,
    );
    expect(echoesQuestion('3x = 15', 'why does that step work?')).toBe(false);
    expect(echoesQuestion('effect', 'circle the effect')).toBe(false);
  });
});
