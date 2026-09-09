/**
 * Ink before the word (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace).
 *
 * The plan streams `say` and `ink` frames on the brain's clock; the voice speaks on its own, and
 * the two drift: a TTS call that takes 1.8 s put the pen 1.9 s ahead of the word, and by the second
 * sentence the voice ran 1.4 to 4.3 s behind the hand (the scorecard's timing lens). The law is
 * simple: the first stroke of a sentence starts within 150 ms of its first word or ahead of it,
 * never after the sentence ends, and the hand waits on sentence boundaries.
 *
 * So every ink frame belongs to a sentence: the one its plan names (`beat.with`, counted
 * across the turn's say frames) or, when the plan does not say, the sentence most recently said
 * before it. It is held until the voice actually begins that sentence. The voice reports each
 * sentence as it starts (the utterance in speech.tsx fires a beat before the audio plays, or on
 * the reading clock when there is no audio), and that is the moment the marks of that sentence
 * are released, in order, keeping the plan's own spacing between them but never trailing the
 * word by more than a hand's reach. Ink that arrives with no sentence before it, or for a
 * sentence already under way, lands at once on the utterance clock exactly as before.
 *
 * Pure: an injected clock and an `apply` callback, so the whole rule is measured in beat.test.ts.
 */

import type { BoardEvent } from '@wobo/wobo';
import { sentences } from './speech';

export type InkFrame = BoardEvent & { type: 'ink' };

export interface SentenceGateOptions {
  now: () => number;
  /** Put the frame on the board, starting at `at` on the store's clock. */
  apply: (event: InkFrame, at: number) => void;
  /** The most a later mark of a sentence may trail the sentence's first word. */
  reach?: number;
  /** The most the FIRST mark of a turn may wait for a voice that has not begun. */
  budget?: number;
  /** How a one-shot deadline is armed and dropped. Injected so the rule is measurable. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** Marks may not trail the word that names them by more than this, whatever the plan said. */
export const SENTENCE_REACH_MS = 1500;

/**
 * THE FIRST STROKE IS ON THE GLASS WITHIN A SECOND OF THE ASK (docs/INK-FOUR.md, Timing at 4) —
 * of the ASK, not of Wobo's first word.
 *
 * The hand waits on the voice, and it should: a mark lands as the sentence that names it begins.
 * But the voice is weather. Live on 2026-09-09, with the drawing itself on the wire inside 400 ms,
 * a plant cell still waited 8 413 ms for its first stroke because the sentence naming it fell back
 * to the device voice, and a map waited 3 296 ms on a slow synthesis. The learner asked to be
 * shown something; they are owed the stroke, not an explanation of the queue.
 *
 * So the wait has a deadline. When it passes, the turn's first mark lands AHEAD of the word — which
 * the trace law has always allowed ("within 150 ms of its first word OR AHEAD OF IT") — and every
 * later mark keeps time with its own sentence exactly as before.
 */
export const FIRST_STROKE_BUDGET_MS = 1000;

/**
 * The wait is not the whole second. Two pieces of the turn happen outside it and both were
 * measured live on 2026-09-09:
 *
 * - BEFORE. The gate is built when the turn opens, and by then the glass has been held, the layout
 *   settled and the map read: 80 to 146 ms, before a request could even leave.
 * - AFTER. A mark released here is drawn onto a plane that is still sliding in, and reaches the
 *   viewport 119 ms later.
 *
 * A deadline of the full second therefore put the stroke on the glass at 1 080 to 1 146 ms — past
 * the law by exactly the two. This much of the second is kept back for them.
 */
export const OVERHEAD_ALLOWANCE_MS = 300;

/** How long the first mark of a turn waits for a voice before it goes down without one. */
export const FIRST_STROKE_DEADLINE_MS = FIRST_STROKE_BUDGET_MS - OVERHEAD_ALLOWANCE_MS;

interface Waiting {
  sentence: number;
  event: InkFrame;
  /** The plan's own `t.start`, for spacing between marks of one sentence. */
  planned: number | undefined;
  /** The plan's own lag after the sentence's first word, when it named one. */
  lag: number | undefined;
}

export class SentenceGate {
  private readonly now: () => number;
  private readonly place: (event: InkFrame, at: number) => void;
  private readonly reach: number;
  private readonly budget: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  /** When the turn opened, on the same clock: the moment the learner asked. */
  private readonly openedAt: number;
  /** The armed deadline for the first stroke, while one is armed. */
  private deadline: unknown = null;
  /** How many marks have been put on the board this turn. */
  private landed = 0;
  /** How many sentences have been said so far (queued to the voice). */
  private planned = 0;
  /** The index of the sentence the voice is on; -1 before it starts. */
  private started = -1;
  private readonly waiting: Waiting[] = [];

  constructor(opts: SentenceGateOptions) {
    this.now = opts.now;
    this.place = opts.apply;
    this.reach = opts.reach ?? SENTENCE_REACH_MS;
    this.budget = opts.budget ?? FIRST_STROKE_DEADLINE_MS;
    this.schedule =
      opts.schedule ?? ((fn, ms) => (typeof setTimeout === 'function' ? setTimeout(fn, ms) : null));
    this.cancel =
      opts.cancel ??
      ((handle) => {
        if (handle !== null && typeof clearTimeout === 'function') {
          clearTimeout(handle as ReturnType<typeof setTimeout>);
        }
      });
    // The gate is built when the turn opens, before the request leaves, so this IS the ask.
    this.openedAt = opts.now();
  }

  /** Put a mark down, and remember that this turn has now drawn something. */
  private apply(event: InkFrame, at: number): void {
    this.landed += 1;
    this.disarm();
    this.place(event, at);
  }

  private disarm(): void {
    if (this.deadline === null) return;
    const handle = this.deadline;
    this.deadline = null;
    this.cancel(handle);
  }

  /**
   * Nothing has been drawn and the voice has not begun: the turn's first waiting mark lands now,
   * ahead of the word it belongs to. Only the first — the choreography is the point of the rest.
   */
  private releaseFirst(): void {
    this.deadline = null;
    if (this.landed > 0) return;
    const first = this.waiting.shift();
    if (first === undefined) return;
    this.apply(first.event, this.now());
  }

  /** A line of Wobo's reached the voice: its sentences are the beats the next marks wait on. */
  say(text: string): void {
    this.planned += sentences(text).length;
  }

  /** How many sentences have been queued to the voice so far. */
  said(): number {
    return this.planned;
  }

  /** An ink frame arrived. It lands now, or waits for the sentence it belongs to. */
  ink(event: InkFrame): void {
    const beat = beatOf(event);
    const sentence = beat?.with ?? this.planned - 1;
    if (sentence < 0 || sentence <= this.started) {
      this.apply(event, this.now());
      return;
    }
    this.waiting.push({ sentence, event, planned: plannedStart(event), lag: beat?.lag });
    if (this.landed === 0 && this.deadline === null) {
      const left = Math.max(0, this.openedAt + this.budget - this.now());
      this.deadline = this.schedule(() => this.releaseFirst(), left);
    }
  }

  /** The voice began sentence `index`: everything waiting on it, or on an earlier one, lands. */
  voiceStarted(index: number): void {
    this.started = Math.max(this.started, index);
    const now = this.now();
    let first: number | undefined;
    const keep: Waiting[] = [];
    const due: Waiting[] = [];
    for (const w of this.waiting) {
      if (w.sentence > this.started) keep.push(w);
      else due.push(w);
    }
    // The queue is settled BEFORE a frame lands: `apply` may ask what is still pending (the
    // conductor decides whether the glass can be let go), and a frame mid-landing is not.
    this.waiting.length = 0;
    this.waiting.push(...keep);
    for (const w of due) {
      // The first released mark starts on the word; the rest keep the plan's spacing after it,
      // capped so no mark of the sentence lands after a hand could have drawn it. A plan that
      // named its own lag is taken at its word, under the same cap.
      if (first === undefined) first = w.planned;
      const offset =
        w.lag !== undefined
          ? w.lag
          : w.planned !== undefined && first !== undefined
            ? Math.max(0, w.planned - first)
            : 0;
      this.apply(w.event, now + Math.min(offset, this.reach));
    }
  }

  /** How many frames are waiting on a sentence the voice has not reached. */
  pending(): number {
    return this.waiting.length;
  }

  /** The learner cut Wobo off: what was waiting never lands. Returns how many frames went. */
  drop(): number {
    this.disarm();
    const n = this.waiting.length;
    this.waiting.length = 0;
    return n;
  }

  /** The turn is over and the voice is done: nothing is left stranded. */
  flush(): void {
    this.disarm();
    const now = this.now();
    for (const w of this.waiting) this.apply(w.event, now);
    this.waiting.length = 0;
  }
}

function plannedStart(event: InkFrame): number | undefined {
  const t = (event.object as { t?: { start?: unknown } }).t;
  return typeof t?.start === 'number' && Number.isFinite(t.start) ? t.start : undefined;
}

/** The sentence the plan tied this mark to, when it tied it to one: `beat`, or `meta.beat`. */
function beatOf(event: InkFrame): { with: number; lag?: number } | null {
  type Beat = { with?: unknown; lag?: unknown };
  const object = event.object as { beat?: Beat; meta?: unknown };
  const nested =
    object.meta && typeof object.meta === 'object'
      ? (object.meta as { beat?: Beat }).beat
      : undefined;
  const beat = object.beat ?? nested;
  if (!beat || typeof beat.with !== 'number' || !Number.isFinite(beat.with)) return null;
  return {
    with: Math.max(0, Math.floor(beat.with)),
    ...(typeof beat.lag === 'number' && Number.isFinite(beat.lag) ? { lag: beat.lag } : {}),
  };
}
