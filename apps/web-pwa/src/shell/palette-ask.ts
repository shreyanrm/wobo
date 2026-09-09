/**
 * A question is not a destination (docs/INK-FREEZE-PLAN-TRACE.md §3).
 *
 * The palette reaches every surface, subject, chapter and action, and anything it does not know
 * falls through to Wobo. But a learner inside a lesson types questions into it — "why does that
 * step work?", "draw me a graph of y = x squared" — and the ranked list will happily match a
 * chapter called Graphs. Walking there answers nothing and takes the page the question was about
 * off the screen; the lab of 2026-09-08 watched the graph, the derivation and the free body get
 * drawn under /chat with nothing visible.
 *
 * So a query that reads as a question makes the ask row the default stop: Enter asks Wobo, where
 * the learner is, and the ink lands on the page in front of them. Every other row is still one
 * arrow key away.
 */

/** The openings a learner uses when they are asking rather than going somewhere. */
const ASKS =
  /^\s*(why|how|what|which|who|whose|when|where|is|are|does|do|did|can|could|should|would|explain|show\s+me|tell\s+me|draw|prove|solve|teach|help|ring|circle|mark|highlight|underline|point\s+(at|to))\b/i;

/** Does this query read as a question for Wobo rather than a place to go? */
export function readsAsQuestion(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  // A single word is a search, whatever it is ("what" on its own is nobody's question).
  if (!/\s/.test(q)) return q.endsWith('?');
  return q.endsWith('?') || ASKS.test(q);
}

/**
 * Is the ask the stop Enter should take? A question, unless a row IS what was typed — the modes
 * are rows with names a learner types word for word ("show me", "do it for me"), and a row named
 * exactly is the row they meant.
 */
export function asksRather(query: string, topLabel?: string): boolean {
  if (!readsAsQuestion(query)) return false;
  return (topLabel ?? '').trim().toLowerCase() !== query.trim().toLowerCase();
}
