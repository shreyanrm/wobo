'use client';

/**
 * THE LEVEL STORE: the concept core, cached beside the level it belongs to (docs/INK-FOUR.md,
 * steps 3 and 4).
 *
 * The level already knows the true sentence about every part it declares, and the blueprint's
 * misconceptions already say which three or four questions a learner asks on each card. Both were
 * made once, when the level was composed — so both are kept here, beside the level, and served in
 * microseconds when the learner asks. Nothing is generated at question time and nothing is invented:
 * every sentence in the store is the architect's own.
 *
 * The store is per learner (`scoped`), keyed by the level, and small: a level's core is a few
 * hundred bytes of its own words. It is a cache, so a miss costs nothing but the ordinary turn.
 */

import { scoped } from '../store/scope';
import { buildCore, type ConceptCore, type CoreCard, EMPTY_CORE } from './instant';

const PREFIX = 'wobo-core-v1';
/** Levels kept at once. A learner works through a handful; the oldest yields to today's. */
const MAX_LEVELS = 24;
const INDEX_KEY = `${PREFIX}:index`;

const keyFor = (levelId: string) => `${PREFIX}:${levelId}`;

function index(): string[] {
  try {
    const raw = scoped.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function remember(key: string): void {
  const keys = index().filter((k) => k !== key);
  keys.push(key);
  while (keys.length > MAX_LEVELS) {
    const gone = keys.shift();
    if (gone) scoped.removeItem(gone);
  }
  try {
    scoped.setItem(INDEX_KEY, JSON.stringify(keys));
  } catch {
    // A full or blocked store is not a reason to lose a turn: the core is only ever a shortcut.
  }
}

/**
 * The core in front of the learner right now. Held in memory as well as on disk, because the
 * resolver reads it on the very keystroke that opens a turn and must never wait on storage.
 */
let live: { levelId: string; core: ConceptCore } | null = null;

/**
 * The level composed: make its core once and keep it. Called by the lesson screen the moment the
 * cards are parsed, not on any turn.
 */
export function rememberCore(levelId: string, cards: readonly CoreCard[]): ConceptCore {
  const core = buildCore(cards);
  live = { levelId, core };
  const key = keyFor(levelId);
  try {
    scoped.setItem(key, JSON.stringify(core));
    remember(key);
  } catch {
    // Memory alone is enough for this session.
  }
  return core;
}

/** The core for a level: memory, then disk, then nothing. Never a fetch, never a guess. */
export function coreFor(levelId: string | null | undefined): ConceptCore {
  if (!levelId) return EMPTY_CORE;
  if (live && live.levelId === levelId) return live.core;
  try {
    const raw = scoped.getItem(keyFor(levelId));
    if (!raw) return EMPTY_CORE;
    const parsed = JSON.parse(raw) as Partial<ConceptCore>;
    const core: ConceptCore = {
      sentences: parsed.sentences ?? {},
      asks: parsed.asks ?? {},
    };
    live = { levelId, core };
    return core;
  } catch {
    return EMPTY_CORE;
  }
}

/** The core of whatever level is on screen, whichever it is. */
export function currentCore(): ConceptCore {
  return live?.core ?? EMPTY_CORE;
}

/** The learner left the lesson: the next one brings its own. */
export function forgetCore(): void {
  live = null;
}
