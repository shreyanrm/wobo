/**
 * Ink before the word (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace): the first stroke of a sentence
 * starts within 150 ms of its first word or ahead of it, never after the sentence ends, and the
 * hand waits on sentence boundaries. The gate that makes that true is pure, so it is measured here
 * with an injected clock; the real voice is measured on screen in tests/trace.spec.ts.
 */

import { describe, expect, it } from 'bun:test';
import type { BoardEvent } from '@wobo/wobo';
import { FIRST_STROKE_DEADLINE_MS, SentenceGate } from './beat';

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
  const timers: { fn: () => void; ms: number }[] = [];
  const gate = new SentenceGate({
    now: () => clock.now,
    apply: (event, at) => applied.push({ id: (event.object as { id: string }).id, at }),
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    cancel: (handle) => {
      const at = (handle as number) - 1;
      if (timers[at]) timers[at] = { fn: () => {}, ms: 0 };
    },
  });
  const fireDeadlines = () => {
    const due = [...timers];
    timers.length = 0;
    for (const t of due) t.fn();
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
