/**
 * Wobo's line in the one conversation, grown as the turn speaks (docs/INK-FREEZE-PLAN-TRACE.md §3).
 *
 * A turn writes ONE line, sentence by sentence, as the voice reaches each one. Two things this
 * knows that the caller must not have to remember:
 *
 *  · THE ASK IS PRINTED ONCE. A plan's last sentence is usually its question, and the `ask` frame
 *    that follows names it again so the wire can pause the turn on it. Printed as it arrives, every
 *    turn with a question said it twice — "What do you notice about it? What do you notice about
 *    it?" (the lab of 2026-09-08, finding 12).
 *  · NOTHING IS PRINTED THAT WAS NOT SAID. The conductor surfaces a sentence as the voice begins
 *    it, so after Escape the line simply stops growing; this keeps the one account of what is in
 *    it, so nobody re-derives the text from the frames that were still on the wire.
 *  · MACHINERY IS NEVER A SENTENCE. Live on 2026-09-08 a fallback for "Prove Pythagoras theorem"
 *    came back as `{"path":"visualization", "viz":{"kind":"diagram"...`, and the voice read it out
 *    and the line printed it. The gateway refuses that at the source now
 *    (`board/naming.refuse_machinery`); this is the last gate before a learner, and it holds
 *    whatever produced the line — a fallback, a salvaged envelope, a model that answered in JSON.
 */

/**
 * A spoken line is prose. Anything carrying a brace, or anything that parses as JSON, is machinery
 * and has never been something to read to a child: it is refused rather than cleaned up, because a
 * half-cleaned envelope is still not a sentence.
 */
export function sayable(text: string): boolean {
  const body = text.trim();
  if (!body) return false;
  if (/[{}]/.test(body)) return false;
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'number';
  } catch {
    return true;
  }
}

/** The same sentence, whatever the stream did to its spacing, case or final punctuation. */
export function sameSentence(a: string, b: string): boolean {
  const flat = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const left = flat(a);
  return left.length > 0 && left === flat(b);
}

export interface TurnLine {
  /** A sentence the voice has begun. True when it is new and should be printed. */
  say: (text: string) => boolean;
  /** The question this turn waits on. True only when no sentence has already asked it. */
  ask: (prompt: string) => boolean;
  /** Everything printed so far, as the transcript reads it. */
  text: () => string;
  /** The sentences printed so far, in order. */
  said: () => readonly string[];
}

export function newTurnLine(): TurnLine {
  const parts: string[] = [];
  return {
    say(text: string): boolean {
      const said = text.trim();
      if (!sayable(said)) return false;
      parts.push(said);
      return true;
    },
    ask(prompt: string): boolean {
      const asked = prompt.trim();
      if (!sayable(asked)) return false;
      if (parts.some((part) => sameSentence(part, asked))) return false;
      parts.push(asked);
      return true;
    },
    text: () => parts.join(' '),
    said: () => parts,
  };
}

/**
 * IS THERE ANYTHING IN THIS LINE FOR THE LEARNER (the adversary, wave 47, finding 9)?
 *
 * Wobo's line is minted at the ask, empty, so it can grow sentence by sentence as the voice
 * reaches each one. When the learner cuts Wobo off before the first sentence, nothing ever grows
 * into it — and escape mid-stroke left `{"role":"wobo","text":""}` standing in the transcript,
 * live and keyless, the same defect wave 44 named. A turn can still answer with no sentence at
 * all when it hands back something to act on, and then the bubble is what holds it.
 */
export function linePrinted(turn: { text: string; extras?: unknown }): boolean {
  return turn.text.trim().length > 0 || turn.extras != null;
}
