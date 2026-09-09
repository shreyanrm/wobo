/**
 * What Wobo is looking at, before the brain has answered (docs/INK-FREEZE-PLAN-TRACE.md §3).
 *
 * A question about a thing on the glass is answered on it, in place, so the turn is a drawing
 * turn (wobo/presentation.ts `boardShapeOf`). Whether the words name such a thing is read off
 * the glass map, the one account of what is on the page: the parts of a figure, the steps of a
 * worked example, the chips, the inputs, the headings, and anything the content model gave a
 * meaning. A plain line of prose is not a thing to mark by being mentioned, and a greeting names
 * nothing. Nothing is drawn here: the plan decides the mark, the pen traces it.
 *
 * AND IT IS THE LEARNER'S PAGE, never Wobo's own. Wobo's surfaces are off the glass by
 * construction (wobo/glass.ts), and what gets through anyway is refused here: a line whose words
 * begin as the question's own words is the question read back, not a thing to ring. The lab of
 * 2026-09-08 found Wobo ringing the learner's own bubble on fifteen of twenty-three course turns
 * and saying "The line that says <your question> is this one".
 */

import { type GlassEntry, type GlassMap, questionWords } from '@wobo/wobo';

/** A question, or a request to mark something: the two shapes of "about that thing there". */
const ASKS_OR_MARKS =
  /\?\s*$|^\s*(why|how|what|which|where|explain|tell\s+me|point\s+(at|to)|ring|circle|mark|highlight|underline|show\s+me)\b|\b(ring|circle|mark|highlight|underline)\b/i;

/** Roles a question can be about by naming them; a plain line or card is not one. */
const NAMEABLE = new Set<GlassEntry['role']>([
  'heading',
  'step',
  'figure',
  'figure-part',
  'chip',
  'input',
  'cell',
  'photo-line',
  'target',
]);

/** The roles that are prose: read, not named. They speak only when the content model labelled them. */
const PROSE = new Set<GlassEntry['role']>(['line', 'card']);

/** A meaning that says the entry is Wobo's own (a transcript line, a spoken announcement). */
const OWN_MEANING = /^wobo[:.]/i;

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/**
 * The words on this line ARE the learner's question, read back: they begin exactly as the question
 * begins, word for word. That is a bubble in the conversation or a hidden announcement, never a
 * subject. A line that merely quotes part of the question ("the square on the hypotenuse") starts
 * somewhere else and is a subject like any other.
 */
export function echoesQuestion(text: string, question: string): boolean {
  const q = wordsOf(question);
  const t = wordsOf(text);
  const shared = Math.min(q.length, t.length);
  if (shared < 3) return false;
  for (let i = 0; i < shared; i += 1) if (q[i] !== t[i]) return false;
  return true;
}

/** Can a question be about this entry at all? Prose speaks only with a meaning, and never Wobo's. */
export function namesSomething(entry: GlassEntry, question: string): boolean {
  if (entry.meaning && OWN_MEANING.test(entry.meaning)) return false;
  if (PROSE.has(entry.role)) {
    if (!entry.meaning) return false;
    return !echoesQuestion(entry.text, question);
  }
  return NAMEABLE.has(entry.role) || Boolean(entry.meaning);
}

/** The glass entry the learner's words are about, or null when they are about nothing. */
export function lookingAt(text: string, map: GlassMap | null): string | null {
  const t = text.trim();
  if (!t || !map || !ASKS_OR_MARKS.test(t)) return null;
  const { words, numbers } = questionWords(t);
  if (words.length === 0 && numbers.length === 0) return null;
  let best: { id: string; score: number } | null = null;
  for (const entry of map.entries) {
    if (!namesSomething(entry, t)) continue;
    const hay = `${entry.text} ${entry.meaning ?? ''}`.toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score += 2;
    // "step 3" names the step whose meaning says so, not every line with a 3 on it.
    for (const n of numbers) if (entry.meaning?.includes(n)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { id: entry.id, score };
  }
  return best?.id ?? null;
}
