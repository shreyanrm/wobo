'use client';

/**
 * THE SESSION LEDGER: what this learner has already said no to.
 *
 * docs/SUGGESTIONS-AND-NOTICES.md §2: *"A suggestion declined is not offered again that session."*
 *
 * THREE DECISIONS, EACH ONE THE LAW RATHER THAN CONVENIENCE.
 *
 * A SESSION, NOT A LIFETIME. The learner who waved away a bonus level this evening may well want it
 * tomorrow, and a product that remembers a no for ever is punishing the no. So it is sessionStorage:
 * it clears itself with the tab, and nothing has to decide when a no has aged out.
 *
 * THE SUGGESTION, NOT THE KIND. Ids name the things a suggestion is about, so declining a door in
 * one chapter says nothing about the door in the next one. Declining a KIND would be a preference,
 * and a preference belongs in settings where the learner can see it and change it back.
 *
 * ONE LEARNER'S. It goes through `scopedSession`, keyed to the subject who owns it, and its key is
 * on `SCOPED_SESSION_KEYS`, so signing out on a shared tablet takes it with them.
 */

import { scopedSession } from '../store/scope';

export const SUGGEST_SESSION_KEY = 'wobo-suggest-v1';

/**
 * The in-memory mirror. Storage can be absent (a server render, a keyless build) or refuse a write
 * (private mode, quota), and a suggestion that comes back after a no because the browser would not
 * remember is exactly the nag this law forbids. So memory is the answer and storage is the copy.
 */
let memory: string[] | null = null;

function load(): string[] {
  if (memory) return memory;
  const raw = scopedSession.getItem(SUGGEST_SESSION_KEY);
  if (!raw) {
    memory = [];
    return memory;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    memory = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    memory = [];
  }
  return memory;
}

/** Everything declined this session, oldest first. */
export function declinedIds(): readonly string[] {
  return [...load()];
}

/** Was this exact suggestion already waved away? */
export function wasDeclined(id: string): boolean {
  return load().includes(id);
}

/** The learner said no. Said once, remembered once, and never asked about. */
export function decline(id: string): void {
  if (!id) return;
  const held = load();
  if (held.includes(id)) return;
  held.push(id);
  scopedSession.setItem(SUGGEST_SESSION_KEY, JSON.stringify(held));
}

/**
 * A new session starts clean. Called when the tab is new by virtue of sessionStorage being empty,
 * and directly by a test that needs the next session to begin now.
 */
export function forgetDeclines(): void {
  memory = [];
  scopedSession.removeItem(SUGGEST_SESSION_KEY);
}
