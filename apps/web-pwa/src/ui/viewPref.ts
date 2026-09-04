/**
 * THE VIBE — how the climb LOOKS, and nothing else it is.
 *
 * The owner's brief: "students get a more sophisticated UI where they unlock levels type of
 * stuff, same content, same approach, but vibe depending on their interests ... not too childish
 * obviously, we keep it professional for kids who dont want all that".
 *
 * So there is one climb and two chromes.
 *
 *   quest     the reward is a chest, the chapter test is a gate, the asides are in Wobo's hand
 *   focused   the reward is an unlock, the chapter test is the chapter test, the asides are set
 *             in the body face, and the corners come in a step
 *
 * THE RULE THAT CANNOT BEND: the two vibes are ONE set of data. Same nodes, same order, same
 * states, same gating, same topic titles, same teaching. This module is the whole surface the
 * vibe is allowed to act through, and it is deliberately narrow — a preference, two words, and a
 * `data-vibe` stamp that a stylesheet reads. There is no way to express "hide a node" or "change
 * a title" through it, which is the point. `ui/viewPref.test.ts` holds it to that.
 *
 * It mirrors `ui/theme.ts` and `ui/motion.ts`: one stored preference, an attribute on the document
 * root that CSS reads, a `useSyncExternalStore` hook for the control. Two things are different.
 *
 *   1. It is PER LEARNER (`store/scope.ts` SCOPED_KEYS), not per device. A sibling on the family
 *      tablet has their own taste, and signing out takes the choice with the rest of that
 *      learner's world.
 *   2. It is read BEFORE FIRST PAINT, from `main.tsx`, which is earlier than the app knows whose
 *      device this is. So it reads the unscoped key first (which is also what an anonymous first
 *      session writes), then re-reads through `onScopeChange` the moment the session resolves.
 *      Both happen inside the same React commit as the map's first render, so the map never
 *      paints one vibe and flips to the other.
 */

import { useSyncExternalStore } from 'react';
import { onScopeChange, scoped } from '../store/scope';

/** The two chromes. There is no third, and there is no "system". */
export type Vibe = 'quest' | 'focused';

/** In the order the switch shows them. */
export const VIBES: readonly Vibe[] = ['quest', 'focused'] as const;

/** What each button in the switch says. Sentence case, and nothing exclaims. */
export const VIBE_LABELS: Readonly<Record<Vibe, string>> = {
  quest: 'Quest',
  focused: 'Focused',
};

/**
 * The two node labels the vibe is allowed to rewrite, and the exhaustive list of them.
 *
 * Everything else on the climb reads the same in both vibes, including every topic title, every
 * status line and every aside — Focused changes the FACE an aside is set in, never its words.
 */
export interface VibeWords {
  /** The reward node: what the learner just earned. */
  reward: string;
  /**
   * The node at the end of the chapter.
   *
   * It is NOT a test, and it must not be worded as one. The prototype called it "the gate" and
   * "Chapter test", and both were promises this product does not keep: nothing scores a chapter,
   * no event records one, and no screen serves one. Boss battles exist, but per topic
   * (`screens/course/AtomJourney.tsx`, `screens/home/stops.ts`), never per chapter. So the node
   * says what is actually true when a learner reaches it, which is that the chapter is behind them.
   *
   * If a chapter-wide boss is built, this is the word that changes, and only then.
   */
  chapterEnd: string;
}

const WORDS: Readonly<Record<Vibe, VibeWords>> = {
  quest: { reward: 'A chest', chapterEnd: 'The summit' },
  focused: { reward: 'Unlocked', chapterEnd: 'Chapter complete' },
};

/** The two words this vibe gives the reward node and the node at the end of the chapter. */
export function vibeWords(vibe: Vibe): VibeWords {
  return WORDS[vibe];
}

/** Where the choice lives. Per learner: `store/scope.ts` suffixes it with the subject who owns it. */
export const VIBE_KEY = 'wobo-vibe-v1';

/**
 * The preference this replaces. It stored 'list' | 'adventure' and it shipped, so a device that
 * has been here before still carries it. Read once, written forward, then gone.
 */
const LEGACY_KEY = 'wobo-view-pref-v1';

/** The attribute the stylesheet reads (`ui/vibe.css`). */
const ATTR = 'data-vibe';

/**
 * Quest is the default because the map IS a climb — checkpoints, a reward, a gate — and Focused is
 * the same climb with the costume off. A learner who wants the quieter one is one tap away and is
 * then remembered.
 */
export const DEFAULT_VIBE: Vibe = 'quest';

export function isVibe(v: unknown): v is Vibe {
  return v === 'quest' || v === 'focused';
}

/** The deleted preference's value in the new words, or null when the device never had one. */
function legacyVibe(): Vibe | null {
  const v = scoped.getItem(LEGACY_KEY);
  if (v === 'adventure') return 'quest';
  if (v === 'list') return 'focused';
  return null;
}

function read(): Vibe {
  const stored = scoped.getItem(VIBE_KEY);
  if (isVibe(stored)) return stored;
  return legacyVibe() ?? DEFAULT_VIBE;
}

/**
 * The live value. Cached rather than re-read, because `getVibe` is the `getSnapshot` of every
 * component that watches it and a snapshot that touched storage on every render would be a
 * storage read per node per frame.
 */
let current: Vibe | null = null;

export function getVibe(): Vibe {
  if (current === null) current = read();
  return current;
}

function paint(vibe: Vibe): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(ATTR, vibe);
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** The learner picked a look. Stamped, stored, and announced to everything watching. */
export function setVibe(vibe: Vibe): void {
  if (!isVibe(vibe) || vibe === current) return;
  current = vibe;
  scoped.setItem(VIBE_KEY, vibe);
  paint(vibe);
  emit();
}

/**
 * Re-read after the device learns whose it is. Silent when nothing moved, which is the common
 * case: one learner, one device, the value already correct from boot.
 */
function refresh(): void {
  const next = read();
  if (next === current) return;
  current = next;
  paint(next);
  emit();
}

let started = false;

/**
 * Call once at boot, before the first render: stamp the stored vibe on the document root so the
 * map's very first paint is already the right one, and keep it honest when the session resolves.
 */
export function initVibe(): void {
  // A device that only ever had the old preference is carried forward, then the old key goes.
  if (!isVibe(scoped.getItem(VIBE_KEY))) {
    const legacy = legacyVibe();
    if (legacy) scoped.setItem(VIBE_KEY, legacy);
    scoped.removeItem(LEGACY_KEY);
  }
  current = null; // this IS the boot read: whatever was cached before it does not count
  paint(getVibe());
  if (started) return;
  started = true;
  onScopeChange(refresh);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * The reactive read. This is what the map and the switch both use.
 *
 * The third argument is the same read as the second, deliberately. It exists to keep a server's
 * HTML and a client's hydration in agreement, and this app has neither: it is a Vite SPA mounted
 * with `createRoot`, never `hydrateRoot`, so nothing ever renders on a server. The only thing that
 * reaches this branch is a static render in a test, and a test wants the truth, not a default.
 */
export function useVibe(): Vibe {
  return useSyncExternalStore(subscribe, getVibe, getVibe);
}

/**
 * Hold the reader's place across a toggle.
 *
 * Changing the vibe changes two labels and a corner radius, and "Unlocked" is a shorter line than
 * "A chest": if either of them is ABOVE the fold, everything below it slides and the node the
 * learner was reading walks off the screen. So we take the element under a point near the top of
 * the viewport, and after the change we put it back where it was.
 *
 * `behavior: 'instant'` on purpose — `html { scroll-behavior: smooth }` is set app-wide, and a
 * correction that animates is the jitter it was meant to prevent.
 *
 * Returns the restore. Call it after the commit (a frame later), or never, harmlessly.
 */
export function holdScrollPlace(): () => void {
  // Also the guard for a test's stand-in document, which has a root and not much else.
  if (typeof window === 'undefined') return () => {};
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
    return () => {};
  }
  const y = Math.min(Math.round(window.innerHeight / 3), Math.max(window.innerHeight - 1, 0));
  const anchor = document.elementFromPoint(Math.round(window.innerWidth / 2), y);
  if (!anchor) return () => {};
  const before = anchor.getBoundingClientRect().top;
  return () => {
    if (!anchor.isConnected) return;
    const drift = anchor.getBoundingClientRect().top - before;
    if (Math.abs(drift) >= 1) window.scrollBy({ top: drift, behavior: 'instant' });
  };
}
