/**
 * What Wobo is looking at, before the model has answered.
 *
 * The optimistic ink used to ring `targets[0]` (or the first equation, step or option) on EVERY
 * turn: on /course that was the download-centre toast, for "show me the button that moves this
 * lesson on" and for "hello" alike, and it was the only page-anchored stroke most turns had, so the
 * scroll hold engaged for a third of a second on every turn for ink unrelated to the question (the
 * owner's word was "so that it doesn't become irrelevant"). Now the point lands only on a thing the
 * learner's own words name, and only when they are asking about it or asking for it to be marked.
 * A greeting rings nothing.
 */

import type { SurfaceRegistry } from '@wobo/wobo';
import { findTargetId } from './hands';

/** A question, or a request to mark something: the two shapes of "about that thing there". */
const ASKS_OR_MARKS =
  /\?\s*$|^\s*(why|how|what|which|where|explain|tell\s+me|point\s+(at|to)|ring|circle|mark|highlight|underline|show\s+me)\b|\b(ring|circle|mark|highlight|underline)\b/i;

/** The registered target the learner's words are about, or null when they are about nothing. */
export function lookingAt(text: string, registry: SurfaceRegistry): string | null {
  const t = text.trim();
  if (!t || !ASKS_OR_MARKS.test(t)) return null;
  return findTargetId(t, registry);
}
