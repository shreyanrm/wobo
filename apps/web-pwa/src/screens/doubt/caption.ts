/**
 * The printed caption follows the beat (law 5, the sound-off half).
 *
 * The board wire carries each `say` frame with the moment it is spoken (`t`, on the utterance
 * clock) and how long it takes (`dur`). The voice already lands on those times; the ink is
 * scheduled to them. The PRINTED line was not: the turn's frames all arrive at wire delivery, so
 * the whole paragraph was on screen about a second in, while the strokes it explains landed two
 * and five seconds later. For a learner with the sound off, the explanation was finished before
 * the drawing started.
 *
 * So the caption is revealed sentence by sentence on the same clock: a say frame is shown once
 * `t` milliseconds have passed since the first one arrived. Pure arithmetic in `captionAt`; one
 * small store (`doubtCaption`) the runtime feeds and the screen reads.
 */

export interface SayFrame {
  text: string;
  /** Milliseconds on the utterance clock, as the wire carried it. */
  t: number;
  dur?: number;
}

/** The sentences due by `elapsedMs`, in order, joined the way the transcript joins them. */
export function captionAt(frames: readonly SayFrame[], elapsedMs: number): string {
  return frames
    .filter((f) => f.t <= elapsedMs)
    .sort((a, b) => a.t - b.t)
    .map((f) => f.text.trim())
    .filter(Boolean)
    .join(' ');
}

class DoubtCaption {
  private frames: SayFrame[] = [];
  private zero: number | null = null;
  private ended = false;
  private readonly listeners = new Set<() => void>();

  /** A new doubt turn is starting: nothing said yet, the clock not yet begun. */
  begin(): void {
    this.frames = [];
    this.zero = null;
    this.ended = false;
    this.emit();
  }

  /** One say frame as the wire delivered it. The clock starts on the first. */
  say(text: string, t: number, dur?: number, now: number = performance.now()): void {
    if (this.zero === null) this.zero = now - Math.max(0, t);
    this.frames.push({ text, t: Math.max(0, t), ...(dur === undefined ? {} : { dur }) });
    this.emit();
  }

  /** The turn is over: whatever is left is shown, however the clock stands. */
  end(): void {
    this.ended = true;
    this.emit();
  }

  /** What may be printed right now. */
  visible(now: number = performance.now()): string {
    if (this.zero === null) return '';
    if (this.ended) return captionAt(this.frames, Number.POSITIVE_INFINITY);
    return captionAt(this.frames, now - this.zero);
  }

  /** True while a sentence is still due to appear. */
  pending(now: number = performance.now()): boolean {
    if (this.zero === null || this.ended) return false;
    const elapsed = now - this.zero;
    return this.frames.some((f) => f.t > elapsed);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

export const doubtCaption = new DoubtCaption();
