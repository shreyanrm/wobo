/**
 * Ink before the word (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace): the first stroke of a sentence
 * starts within 150 ms of its first word or ahead of it, never after the sentence ends, and the
 * hand waits on sentence boundaries. The gate that makes that true is pure, so it is measured here
 * with an injected clock; the real voice is measured on screen in tests/trace.spec.ts.
 */

import { describe, expect, it } from 'bun:test';
import type { BoardEvent } from '@wobo/wobo';
import {
  FIRST_STROKE_DEADLINE_MS,
  SENTENCE_ASSUMED_MS,
  SENTENCE_REACH_MS,
  SentenceGate,
  VOICE_STALL_GRACE_MS,
  VOICELESS_MS,
} from './beat';
import { estimateReadMs } from './speech';

const ink = (id: string, start?: number): BoardEvent & { type: 'ink' } =>
  ({
    type: 'ink',
    t: start ?? 0,
    object: {
      id,
      kind: 'circle',
      anchor: { target: 'row' },
      ...(start !== undefined ? { t: { start, dur: 400 } } : {}),
    },
  }) as never;

function harness(now = 0) {
  const applied: { id: string; at: number }[] = [];
  const clock = { now };
  /** Deadlines the gate armed, fired by hand: the rule is measured, never waited for. */
  const timers: { fn: () => void; ms: number; due: number }[] = [];
  const gate = new SentenceGate({
    now: () => clock.now,
    apply: (event, at) => applied.push({ id: (event.object as { id: string }).id, at }),
    schedule: (fn, ms) => {
      timers.push({ fn, ms, due: clock.now + ms });
      return timers.length;
    },
    cancel: (handle) => {
      const at = (handle as number) - 1;
      if (timers[at]) timers[at] = { fn: () => {}, ms: 0, due: Number.POSITIVE_INFINITY };
    },
  });
  /**
   * Fire every deadline whose moment has come on the injected clock. It used to fire them all,
   * whatever they were armed for — which was fine while there was one deadline and wrong the
   * moment there were two (the first stroke's, and the bound on the whole queue).
   */
  const fireDeadlines = () => {
    for (let i = 0; i < timers.length; i += 1) {
      const t = timers[i];
      if (!t || t.due > clock.now) continue;
      timers[i] = { fn: () => {}, ms: 0, due: Number.POSITIVE_INFINITY };
      t.fn();
    }
  };
  return { gate, applied, clock, timers, fireDeadlines };
}

describe('the hand waits on sentence boundaries', () => {
  it('ink for a sentence the voice has not reached waits for it', () => {
    const { gate, applied, clock } = harness();
    gate.say('Look at the second step.');
    gate.ink(ink('ring', 200));
    expect(applied).toHaveLength(0);
    expect(gate.pending()).toBe(1);
    clock.now = 900;
    gate.voiceStarted(0);
    expect(applied).toEqual([{ id: 'ring', at: 900 }]);
    expect(gate.pending()).toBe(0);
  });

  it('ink for a sentence already being spoken lands at once', () => {
    const { gate, applied, clock } = harness();
    gate.say('Look at the second step.');
    gate.voiceStarted(0);
    clock.now = 300;
    gate.ink(ink('ring', 900));
    expect(applied).toEqual([{ id: 'ring', at: 300 }]);
  });

  it('ink with no sentence before it lands at once, on the utterance clock', () => {
    const { gate, applied } = harness(50);
    gate.ink(ink('ring'));
    expect(applied).toEqual([{ id: 'ring', at: 50 }]);
  });

  it('two marks in one sentence keep their spacing, and never trail the word by long', () => {
    const { gate, applied, clock } = harness();
    gate.say('The sign flips, and the term moves.');
    gate.ink(ink('a', 100));
    gate.ink(ink('b', 700));
    gate.ink(ink('c', 9000));
    clock.now = 2000;
    gate.voiceStarted(0);
    expect(applied.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(applied[0]?.at).toBe(2000);
    expect(applied[1]?.at).toBe(2600);
    // A mark planned seconds later still lands inside the sentence.
    expect((applied[2]?.at ?? 0) - 2000).toBeLessThanOrEqual(1500);
  });

  it('counts every sentence of a line, so the third sentence gates the third mark', () => {
    const { gate, applied, clock } = harness();
    gate.say('First. Second. Third.');
    gate.ink(ink('third'));
    gate.voiceStarted(0);
    gate.voiceStarted(1);
    expect(applied).toHaveLength(0);
    clock.now = 3000;
    gate.voiceStarted(2);
    expect(applied).toEqual([{ id: 'third', at: 3000 }]);
  });

  it('a later sentence releases everything queued before it', () => {
    const { gate, applied } = harness();
    gate.say('One.');
    gate.ink(ink('a'));
    gate.say('Two.');
    gate.ink(ink('b'));
    gate.voiceStarted(1);
    expect(applied.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('a plan that names its sentence is taken at its word, whatever was said last', () => {
    const { gate, applied, clock } = harness();
    gate.say('First. Second.');
    // Tied to the first sentence by the plan, though the second has already been said.
    gate.ink({
      ...ink('a'),
      object: { ...(ink('a').object as object), beat: { with: 0, lag: 120 } },
    } as never);
    // Tied to the second, with no lag: the word itself. Nested the brain's way, under `meta`.
    gate.ink({
      ...ink('b'),
      object: { ...(ink('b').object as object), meta: { beat: { with: 1 } } },
    } as never);
    clock.now = 500;
    gate.voiceStarted(0);
    expect(applied).toEqual([{ id: 'a', at: 620 }]);
    clock.now = 2500;
    gate.voiceStarted(1);
    expect(applied[1]).toEqual({ id: 'b', at: 2500 });
  });

  it("a lag past a hand's reach is brought back inside it", () => {
    const { gate, applied, clock } = harness();
    gate.say('One.');
    gate.ink({
      ...ink('a'),
      object: { ...(ink('a').object as object), beat: { with: 0, lag: 9000 } },
    } as never);
    clock.now = 100;
    gate.voiceStarted(0);
    expect(applied[0]?.at).toBe(1600);
  });

  /**
   * THE ONE-SECOND LAW OUTRANKS THE WAIT (docs/INK-FOUR.md, Timing at 4). The hand waits on the
   * voice, but the voice is weather: live, a from-scratch board whose ink was on the wire at
   * 382 ms waited 8.4 s because the sentence naming it fell back to the device voice, and a map
   * whose ink arrived at 378 ms waited 2.9 s on a slow synthesis. The learner asked to be shown
   * something; the first stroke is theirs inside a second whether or not Wobo has found a voice
   * yet, and it lands AHEAD of the word, which the trace law has always allowed.
   */
  it('the first mark of a turn does not wait past the law for a voice that has not begun', () => {
    const { gate, applied, clock, timers, fireDeadlines } = harness();
    gate.say('Look at the second step.');
    gate.ink(ink('ring', 200));
    expect(applied).toHaveLength(0);
    expect(timers[0]?.ms).toBe(FIRST_STROKE_DEADLINE_MS);

    clock.now = FIRST_STROKE_DEADLINE_MS;
    fireDeadlines();
    expect(applied).toEqual([{ id: 'ring', at: FIRST_STROKE_DEADLINE_MS }]);

    // And it is not drawn a second time when the voice finally arrives.
    clock.now = 4000;
    gate.voiceStarted(0);
    expect(applied).toHaveLength(1);
  });

  it('only the FIRST mark is released early; the rest keep time with their sentence', () => {
    const { gate, applied, clock, fireDeadlines } = harness();
    gate.say('One. Two.');
    gate.ink(ink('a', 100));
    gate.ink(ink('b', 900));
    clock.now = FIRST_STROKE_DEADLINE_MS;
    fireDeadlines();
    expect(applied).toEqual([{ id: 'a', at: FIRST_STROKE_DEADLINE_MS }]);
    expect(gate.pending()).toBe(1);
    clock.now = 2000;
    gate.voiceStarted(1);
    expect(applied).toEqual([
      { id: 'a', at: FIRST_STROKE_DEADLINE_MS },
      { id: 'b', at: 2000 },
    ]);
  });

  it('a voice that begins in time is never overtaken: no deadline is left armed', () => {
    const { gate, applied, clock, fireDeadlines } = harness();
    gate.say('One.');
    gate.ink(ink('a', 100));
    clock.now = 300;
    gate.voiceStarted(0);
    expect(applied).toEqual([{ id: 'a', at: 300 }]);
    clock.now = 4000;
    fireDeadlines();
    expect(applied).toHaveLength(1);
  });

  it('an interruption drops what was waiting; a flush lands it', () => {
    const one = harness();
    one.gate.say('One.');
    one.gate.ink(ink('a'));
    expect(one.gate.drop()).toBe(1);
    expect(one.applied).toHaveLength(0);

    const two = harness(400);
    two.gate.say('One.');
    two.gate.ink(ink('a'));
    two.gate.flush();
    expect(two.applied).toEqual([{ id: 'a', at: 400 }]);
  });
});

/**
 * A MARK NEVER WAITS ON A SENTENCE THAT WILL NEVER COME (the adversary, wave 49, finding 2).
 *
 * Live at 1440: the lens board put fifteen ink frames on the wire in order, the model's sentences
 * were refused, no sentence ever began — and the learner watched a bare axis while marks 2 to 15
 * sat in this queue for the whole turn. The turn's own flush is behind an await on the voice
 * draining, so the gate cannot lean on it; the bound has to be the gate's own.
 */
describe('the hand goes on without a voice that never comes', () => {
  it("the whole plan lands when no sentence ever begins, on the plan's own clock", () => {
    const { gate, applied, clock, fireDeadlines } = harness();
    gate.say('Object, image, far focus, near focus.');
    gate.ink(ink('axis', 120));
    gate.ink(ink('lens', 360));
    gate.ink(ink('object', 600));

    // the first stroke is still owed inside the second
    clock.now = FIRST_STROKE_DEADLINE_MS;
    fireDeadlines();
    expect(applied).toEqual([{ id: 'axis', at: FIRST_STROKE_DEADLINE_MS }]);
    expect(gate.pending()).toBe(2);

    // and the rest are owed the turn, not the voice — in the plan's order, keeping the 240 ms the
    // plan put between them, and never dumped on the glass together
    clock.now = VOICELESS_MS;
    fireDeadlines();
    expect(applied).toEqual([
      { id: 'axis', at: FIRST_STROKE_DEADLINE_MS },
      { id: 'lens', at: VOICELESS_MS },
      { id: 'object', at: VOICELESS_MS + 240 },
    ]);
    expect(gate.pending()).toBe(0);
    expect(gate.keepingPlanTime()).toBe(true);
  });

  it("the plan's own spacing survives: a mark still to come keeps its place in the drawing", () => {
    const { gate, applied, clock, fireDeadlines } = harness();
    gate.say('One.');
    gate.ink(ink('a', 100));
    gate.ink(ink('b', 400));
    gate.ink(ink('c', 900));
    // the first stroke is owed inside the second, whatever the voice does
    clock.now = FIRST_STROKE_DEADLINE_MS;
    fireDeadlines();
    clock.now = VOICELESS_MS;
    fireDeadlines();
    expect(gate.keepingPlanTime()).toBe(true);
    // The two still waiting keep the 500 ms the plan put between them, laid from the moment the
    // voice was given up on rather than from a zero the voice never set.
    expect(applied).toEqual([
      { id: 'a', at: FIRST_STROKE_DEADLINE_MS },
      { id: 'b', at: VOICELESS_MS },
      { id: 'c', at: VOICELESS_MS + 500 },
    ]);
    applied.length = 0;
    // a frame off the wire after the voice was given up on keeps its place in the order, inside a
    // hand's reach of the moment the hand took over — not at the voice's own hour
    gate.ink(ink('later', VOICELESS_MS + 900));
    expect(applied).toEqual([{ id: 'later', at: VOICELESS_MS + SENTENCE_REACH_MS }]);
    // and one whose moment has already gone lands at its place, never in the past
    applied.length = 0;
    gate.ink(ink('overdue', 300));
    expect(applied).toEqual([{ id: 'overdue', at: VOICELESS_MS }]);
  });

  it('a voice that is genuinely speaking is never overtaken: its own length is the rope', () => {
    const { gate, applied, clock, fireDeadlines } = harness();
    // the wire's own order: a line, the marks that hang off it, then the next line
    gate.say('A long first sentence.');
    gate.ink(ink('a', 100));
    gate.say('Then a second.');
    gate.ink(ink('b', 5000));
    clock.now = 300;
    gate.voiceStarted(0, 4400); // the synthesis says this sentence runs 4.4 s
    expect(applied).toEqual([{ id: 'a', at: 300 }]);
    // deep inside that sentence, the mark for the NEXT one is still waiting
    clock.now = 4000;
    fireDeadlines();
    expect(gate.pending()).toBe(1);
    expect(gate.keepingPlanTime()).toBe(false);
    // and it lands with the word, as the choreography intends
    clock.now = 4700;
    gate.voiceStarted(1, 2000);
    expect(applied).toEqual([
      { id: 'a', at: 300 },
      { id: 'b', at: 4700 },
    ]);
  });

  it('a voice that dies mid-turn does not bury the rest of the plan', () => {
    const { gate, applied, clock, fireDeadlines } = harness();
    gate.say('One.');
    gate.ink(ink('a', 100));
    gate.say('Two.');
    gate.ink(ink('b', 900));
    clock.now = 200;
    gate.voiceStarted(0, 1200);
    expect(applied).toEqual([{ id: 'a', at: 200 }]);
    // the voice never reaches sentence two. Its own length plus a hand's grace is all it gets.
    const bound = 200 + 1200 + VOICE_STALL_GRACE_MS;
    clock.now = bound - 1;
    fireDeadlines();
    expect(gate.pending()).toBe(1);
    clock.now = bound;
    fireDeadlines();
    expect(applied).toEqual([
      { id: 'a', at: 200 },
      { id: 'b', at: bound },
    ]);
  });

  it('a voice with no measured length is given the sentence its own words would take', () => {
    const { gate, clock, fireDeadlines } = harness();
    const long =
      'The first sentence of this turn is a long one, because a long sentence is exactly the ' +
      'case a flat number gets wrong, and the reading clock takes as long over it as the words ' +
      'themselves need before the next one can begin at all.';
    gate.say(long);
    gate.ink(ink('a', 100));
    gate.say('Two.');
    gate.ink(ink('b', 900));
    clock.now = 200;
    gate.voiceStarted(0); // the reading clock: no synthesis, so no measured length
    const read = estimateReadMs(long);
    expect(read).toBeGreaterThan(SENTENCE_ASSUMED_MS / 2);
    // deep inside the sentence its own words buy, the next sentence's mark still waits
    clock.now = 200 + read + VOICE_STALL_GRACE_MS - 1;
    fireDeadlines();
    expect(gate.pending()).toBe(1);
    clock.now += 1;
    fireDeadlines();
    expect(gate.pending()).toBe(0);
  });

  it('when the voice finally speaks it takes the beat back', () => {
    const { gate, applied, clock, fireDeadlines } = harness();
    gate.say('One.');
    gate.ink(ink('a', 100));
    gate.ink(ink('a2', 200));
    clock.now = VOICELESS_MS;
    fireDeadlines();
    expect(gate.keepingPlanTime()).toBe(true);
    gate.say('Two.');
    clock.now = 3000;
    gate.voiceStarted(0, 1500);
    expect(gate.keepingPlanTime()).toBe(false);
    applied.length = 0;
    gate.ink(ink('b', 9000)); // for sentence one, which the voice has not reached
    expect(applied).toHaveLength(0);
    expect(gate.pending()).toBe(1);
  });

  /**
   * A VOICE THAT NEVER CAME DOES NOT SET THE LENGTH OF THE DRAWING (the adversary, wave 49,
   * finding 1).
   *
   * The bound above holds when the voice is ABSENT. It did not hold when the voice was merely
   * LATE, because giving up on it was only half the rule: everything waiting was then laid on the
   * plan's own ABSOLUTE clock, and the plan's clock is the length of the words. Measured on the
   * real screen at 1440, keyless, with the TTS call held five seconds the way a provider's read
   * timeout holds it (`beat-lab/stall.mjs`): the pythagoras board's ten marks are planned across
   * 120 to 5 054 ms, four of them dumped together on the 2 177 ms wall and the last reached the
   * DOM at 5 215 ms — against 1 932 ms on the same board with the voice healthy. A stalled
   * provider held the pen for five seconds.
   */
  it('a voice that never came does not stretch the drawing over the words it never said', () => {
    const { gate, applied, clock, fireDeadlines } = harness();
    // the pythagoras board off the wire, keyless: ten marks choreographed across five seconds
    gate.say('Square on the base, square on the height, square on the longest side.');
    const plan: [string, number][] = [
      ['triangle', 120],
      ['rightangle', 322],
      ['sqbase', 469],
      ['num9', 1108],
      ['sqside', 1368],
      ['num16', 2477],
      ['sqhyp', 2737],
      ['sum', 4189],
      ['hyp', 4449],
      ['note', 5054],
    ];
    for (const [id, start] of plan) gate.ink(ink(id, start));

    clock.now = FIRST_STROKE_DEADLINE_MS;
    fireDeadlines();
    clock.now = VOICELESS_MS;
    fireDeadlines();

    expect(gate.pending()).toBe(0);
    expect(applied.map((x) => x.id)).toEqual(plan.map(([id]) => id));
    // THE WHOLE DRAWING IS ON THE GLASS INSIDE A HAND'S REACH OF THE BOUND, not five seconds out.
    const last = Math.max(...applied.map((x) => x.at));
    expect(last).toBeLessThanOrEqual(VOICELESS_MS + SENTENCE_REACH_MS);
    // and it is a drawing, not a dump: the plan's spacing survives, scaled onto the hand's clock
    const atTheWall = applied.filter((x) => x.at === VOICELESS_MS);
    expect(atTheWall).toHaveLength(1);
    for (let i = 2; i < applied.length; i += 1) {
      expect(applied[i]?.at ?? 0).toBeGreaterThan(applied[i - 1]?.at ?? 0);
    }
  });

  it('an interruption drops the bound with the queue', () => {
    const { gate, applied, clock, fireDeadlines, timers } = harness();
    gate.say('One.');
    gate.ink(ink('a', 100));
    expect(gate.drop()).toBe(1);
    clock.now = 10_000;
    fireDeadlines();
    expect(applied).toHaveLength(0);
    expect(timers.every((t) => t.due === Number.POSITIVE_INFINITY)).toBe(true);
  });
});
