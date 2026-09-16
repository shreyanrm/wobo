'use client';

/**
 * The gamification spine: XP, the identity streak, completions, and the bloom queue.
 *
 * Psychology (CONTEXT.md §9): XP is the visible currency; mastery is the truth underneath.
 * Rewards are few and precious — a bloom fires on genuine earn (completion, boss, account
 * moments), never on routine taps. The streak is an identity streak ("day 7 of being a
 * learner") and rest is sanctioned, never guilted.
 *
 * Persistence rides the SDK state seam: localStorage is the always-on cache (same key as ever);
 * in live mode learner_state hydrates on boot and merges on write, so devices reconcile.
 */

import { type LearnerState, mergeLearnerState } from '@wobo/sdk';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { hueForTopic } from '../ui/hues';
import { sfx } from '../ui/sound';
import { earnedTrophyKeys, type TrophyAward, topTrophyKey, trophyAwardFor } from '../ui/trophies';
import { SaveTrouble } from './SaveTrouble';
import { scoped } from './scope';
import { useSdk } from './sdk';

export type XpReason =
  | 'item'
  | 'topic'
  | 'chapter'
  | 'boss'
  | 'streak'
  | 'bonus'
  | 'account'
  | 'profile_photo'
  | 'invite_friend'
  | 'invite_parent'
  | 'mystery';

/**
 * WHAT EARNS EXPERIENCE POINTS (docs/LEVELS.md §1, and it is the table there, verbatim).
 *
 * The first six rows ARE that table. They were not before: topic paid 150 against the law's 50,
 * boss paid 80 against 300, bonus paid 45 against 15, and the law's two remaining rows — a chapter
 * finished, and a day kept in a streak — had no reason here at all, so the 20 the law pays for
 * turning up was never paid to anybody. A rate that contradicts its own law is the "motivating
 * without lying" rule (docs/LEARNING-MODEL.md, "The tutor never leaves", rule 4) failing at the
 * only place a learner can check it: the number on the screen.
 *
 * `streak` is the one that is earned by ARRIVING rather than by being right, which is why rule 4
 * asks the reward to fire "on effort and on progress, not only on right answers". It is paid by
 * `rollForward` below, once a day, to a learner who has answered nothing yet.
 *
 * The rows under the table are the account moments. docs/LEVELS.md §1 does not price them because
 * they are not learning, and they are left exactly as they were.
 *
 * These are dials on the console in the end (docs/LEVELS.md §7). This is their law-true default,
 * and `levels.test.ts` pins every one of them.
 */
export const XP_AWARDS: Record<XpReason, number> = {
  item: 10,
  topic: 50,
  chapter: 200,
  boss: 300,
  streak: 20,
  bonus: 15,
  account: 50,
  profile_photo: 20,
  invite_friend: 40,
  invite_parent: 40,
  mystery: 60,
};

export interface XpBloom {
  id: number;
  amount: number;
  reason: XpReason;
  /** The owning subject's hue — earned moments carry the subject family. */
  hue?: string;
  /** Set only when this award crossed a level boundary — the new level. Triggers the level-up beat. */
  crossedTo?: number;
  /** How many attempts this cost the learner. 1 is a first-try answer. */
  tries?: number;
}

/**
 * HOW LONG AN EARNED MOMENT IS HELD, DECIDED BY WHAT IT COST (docs/REWARDS.md §3).
 *
 * *"a bloom in the pigment, sized by how many tries it took: first try is quick and bright, fifth
 * is slower and warmer, because arriving late is still arriving."*
 *
 * REWARDS.md §8 listed "the try-again ladder wired to attempt count" as unbuilt, and it was: every
 * bloom was held for exactly the same 2.4 seconds whatever the learner had spent getting there, so
 * the product gave the same breath to an answer that cost four attempts as to one that cost none.
 * That is the half of rule 4 the owner names as firing on EFFORT rather than only on being right.
 *
 * It stays a breath and never becomes a ceremony: the ceiling is well inside the length that would
 * make it something to sit through, and nothing about it blocks (REWARDS.md §7, rules 1 and 2).
 */
export const BLOOM_HOLD_MS = 2400;
export const BLOOM_HOLD_CEILING_MS = 3600;
/** A third of a second more warmth per attempt it took, up to the ceiling. Never less. */
export const BLOOM_HOLD_PER_TRY_MS = 300;

export function bloomHold(tries = 1): number {
  const late = Math.max(0, Math.floor(tries) - 1);
  return Math.min(BLOOM_HOLD_CEILING_MS, BLOOM_HOLD_MS + late * BLOOM_HOLD_PER_TRY_MS);
}

/**
 * THE LEVEL CURVE (docs/LEVELS.md §2), which is the law's curve and no longer a second opinion
 * about it.
 *
 * The owner, 2026-09-09: *"I want level ups only based off XP... It should be progressive, it
 * should get harder as they go."* The law settles that as `60 × level^1.35`, rounded to ten, with
 * two deliberate departures: the first three levels are nearly free (30, 60, 120) because a first
 * session should end two or three levels in, and the cost stops rising at 8,000 XP so a learner
 * three years in is never facing a wall.
 *
 * What stood here instead was `20(l-1)(l+2)`: a different shape, reaching levels 2, 3 and 4 at
 * 80, 200 and 360 against the law's 30, 90 and 210, and arriving at level 41 having asked for
 * 34,400 XP against the law's 151,370. Under it a learner's first session ended one level in
 * rather than three, and the top of the curve was four and a half times cheaper than the pacing
 * the law had modelled against real use. docs/LEVELS.md §7 asks for exactly one pure function with
 * a test that pins every number in the table; `levels.test.ts` is that test, and it is why the
 * dev-only `console.assert` block that used to sit under here — pinning 80 and 200, and unable to
 * fail a build because `console.assert` does not throw — is gone rather than corrected.
 */
export const CURVE_BASE = 60;
export const CURVE_EXPONENT = 1.35;
/** The cost stops rising here (docs/LEVELS.md §2), so the number never becomes meaningless. */
export const CURVE_CEILING_XP = 8000;
/** The law's three nearly-free levels: what it costs to reach 2, 3 and 4. That is the hook. */
export const EARLY_LEVEL_COST = [30, 60, 120] as const;

/** What the step INTO `level` costs on its own. The one pure function docs/LEVELS.md §7 asks for. */
export function xpForLevel(level: number): number {
  const l = Math.floor(level);
  if (l <= 1) return 0; // nobody pays to be at level 1
  const early = EARLY_LEVEL_COST[l - 2];
  if (early !== undefined) return early;
  const raw = CURVE_BASE * (l - 1) ** CURVE_EXPONENT;
  return Math.min(CURVE_CEILING_XP, Math.round(raw / 10) * 10);
}

/** The first level whose step costs the ceiling — the law says "around level 39", and it is 39. */
export const CURVE_CEILING_LEVEL = ((): number => {
  let l = EARLY_LEVEL_COST.length + 2;
  while (xpForLevel(l) < CURVE_CEILING_XP) l += 1;
  return l;
})();

// Prefix sums, grown on demand and never recomputed. Index is the level; index 1 is 0, because
// reaching level 1 costs nothing.
const cumulative: number[] = [0, 0];

/** Total xp needed to REACH `level`. */
export function cumForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  while (cumulative.length <= l) {
    cumulative.push((cumulative[cumulative.length - 1] as number) + xpForLevel(cumulative.length));
  }
  return cumulative[l] as number;
}

export interface LevelInfo {
  level: number;
  /** xp earned into the current level. */
  intoLevel: number;
  /** xp remaining to the next level. */
  toNext: number;
  /** total xp the current level spans (intoLevel + toNext). */
  span: number;
  /** 0..1 fraction through the current level (for the ring). */
  progress: number;
}

export function levelInfo(xp: number): LevelInfo {
  const x = Math.max(0, Math.floor(xp));
  const atCeiling = cumForLevel(CURVE_CEILING_LEVEL);
  // Past the ceiling every step costs the same 8,000, so the tail is solved rather than walked: a
  // learner with an implausible amount of xp must not cost a loop proportional to it.
  const level =
    x >= atCeiling
      ? CURVE_CEILING_LEVEL + Math.floor((x - atCeiling) / CURVE_CEILING_XP)
      : (() => {
          let l = 1;
          while (cumForLevel(l + 1) <= x) l += 1;
          return l;
        })();
  const base = cumForLevel(level);
  const span = xpForLevel(level + 1);
  const intoLevel = x - base;
  return { level, intoLevel, toNext: span - intoLevel, span, progress: intoLevel / span };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** How many streak-freezes a learner gets per month, and how long a break stays repairable. */
export const FREEZE_BUDGET = 4;
const REPAIR_WINDOW_DAYS = 5;

const monthKey = (day: string): string => day.slice(0, 7);

/**
 * Streak roll-forward: yesterday keeps it, today keeps it, an older last-active day is a real
 * break. Rather than silently zeroing a hard-won chain (family P: illness, exams, travel), stash
 * it as `brokenStreak` so a logged streak-freeze can repair it within the window. A 1-day "streak"
 * isn't worth a freeze, so it just resets.
 */
function rollDays(p: LearnerState, t: string): LearnerState {
  if (p.lastActiveDay === t) return p;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (p.lastActiveDay === yesterday)
    return { ...p, streakDays: p.streakDays + 1, lastActiveDay: t };
  const brokenStreak =
    p.streakDays >= 2 ? { days: p.streakDays, brokenOn: p.lastActiveDay } : p.brokenStreak;
  return { ...p, streakDays: 1, lastActiveDay: t, brokenStreak };
}

/** The once-a-day key the day's own earn is booked against. */
export const streakDayKey = (day: string): string => `streak:${day}`;

/**
 * How many days of streak keys are kept. They exist only to answer "has today been paid", and a
 * key older than the repair window can never be today, so keeping them forever would be one row
 * of litter per day for the life of the account.
 */
const STREAK_KEY_WINDOW_DAYS = REPAIR_WINDOW_DAYS + 2;

function pruneStreakKeys(keys: readonly string[], day: string): string[] {
  const floor = Date.parse(day) - STREAK_KEY_WINDOW_DAYS * 86400000;
  return keys.filter((k) => {
    if (!k.startsWith('streak:')) return true; // every other one-time key is untouched
    const on = Date.parse(k.slice('streak:'.length));
    return Number.isNaN(on) || on >= floor;
  });
}

/**
 * THE DAY'S OWN EARN, PAID FOR TURNING UP (docs/LEVELS.md §1, "a day kept in a streak | 20", and
 * §4, "a day pays once. The streak's 20 is per day, not per session").
 *
 * Nobody was ever paid it. The rate did not exist, so the only XP in the product came from getting
 * something right, and a learner who opened Wobo, worked at one idea and got all of it wrong left
 * with a reward moment count of zero. That is rule 4 of "The tutor never leaves" failing at its
 * trigger: *"the reward system fires on effort and on progress, not only on right answers"*.
 * Sizing the moment by what it cost (`bloomHold`) was the other half of that rule and was already
 * built; this is the half that decides whether there is a moment at all.
 *
 * Booked against `awardedOnce` rather than against `lastActiveDay`, for three reasons that each
 * bit in practice. A brand-new learner's state already carries today as `lastActiveDay`, so a
 * day-comparison would never pay them their first day. `rollForward` runs at boot AND again when
 * the remote state arrives, so a day-comparison would pay twice on one morning. And `awardedOnce`
 * is unioned across devices by `mergeLearnerState`, so a phone and a laptop opened the same
 * morning settle on one payment rather than two.
 */
function payTheDay(p: LearnerState, day: string): LearnerState {
  const key = streakDayKey(day);
  const awarded = p.awardedOnce ?? [];
  if (awarded.includes(key)) return p;
  return {
    ...p,
    xp: p.xp + XP_AWARDS.streak,
    lastActiveDay: day,
    awardedOnce: [...pruneStreakKeys(awarded, day), key],
  };
}

/**
 * The chain rolled forward, and the day paid. Pure, and idempotent within a day: call it as many
 * times as a boot and a hydrate need to, and the 20 is paid exactly once.
 */
export function rollForward(p: LearnerState): LearnerState {
  const t = today();
  return payTheDay(rollDays(p, t), t);
}

/** Freezes still available this month (a new month resets the count without a write). */
function freezesLeftOf(s: LearnerState): number {
  const used = s.streakFreezes.month === monthKey(today()) ? s.streakFreezes.used : 0;
  return Math.max(0, FREEZE_BUDGET - used);
}

/** The pending repair the learner can spend a freeze on — null once it's too stale to be honest. */
function pendingRepair(s: LearnerState): { brokenDays: number; brokenOn: string } | null {
  const b = s.brokenStreak;
  if (!b) return null;
  const ageDays = Math.floor((Date.parse(today()) - Date.parse(b.brokenOn)) / 86400000);
  if (ageDays > REPAIR_WINDOW_DAYS) return null;
  return { brokenDays: b.days, brokenOn: b.brokenOn };
}

// ponytail: one runnable check for the break/repair math — dev-only, never throws.
if (import.meta.env.DEV) {
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const old = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const base = { ...({} as LearnerState), streakDays: 7, lastActiveDay: old } as LearnerState;
  console.assert(rollForward(base).streakDays === 1, 'break resets to 1');
  console.assert(rollForward(base).brokenStreak?.days === 7, 'break stashes the lost chain');
  console.assert(
    rollForward({ ...base, lastActiveDay: y }).streakDays === 8,
    'yesterday continues the chain',
  );
}

// Which milestone trophies have already had their ceremony — a local guard so a tier is celebrated
// exactly once, and never retroactively. Cross-device double-celebration isn't worth syncing.
const CELEBRATED_KEY = 'wobo-trophies-celebrated-v1';

function loadCelebrated(): Set<string> | null {
  try {
    const raw = scoped.getItem(CELEBRATED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function saveCelebrated(set: Set<string>): void {
  try {
    scoped.setItem(CELEBRATED_KEY, JSON.stringify([...set]));
  } catch {
    // storage unavailable — the ceremony still fires this session, just isn't remembered
  }
}

function bumpToday() {
  try {
    const key = 'wobo-activity-counts-v1';
    const counts = JSON.parse(scoped.getItem(key) ?? '{}') as Record<string, number>;
    const t = today();
    counts[t] = (counts[t] ?? 0) + 1;
    scoped.setItem(key, JSON.stringify(counts));
  } catch {
    // storage unavailable — heat map just stays cool
  }
}

/** What a grant did to the state, and what it actually paid. 0 is a one-time award, already paid. */
export interface AwardOutcome {
  state: LearnerState;
  granted: number;
}

/**
 * THE MONEY, AS A PURE FUNCTION.
 *
 * These two hold every rule docs/LEVELS.md §4 states about what may and may not be earned, and the
 * provider below is a thin wrapper that stamps and queues the moment. They are exported because a
 * test that plays a learner has to be able to drive the REAL rules — a test that re-implemented
 * "what an answer pays" would be asserting against its own copy, and the copy is the thing that
 * drifted from the law in the first place.
 */
export function applyAward(
  prev: LearnerState,
  reason: XpReason,
  opts?: { amount?: number; onceKey?: string },
): AwardOutcome {
  const amount = opts?.amount ?? XP_AWARDS[reason];
  const onceKey =
    opts?.onceKey ?? (['account', 'profile_photo'].includes(reason) ? reason : undefined);
  if (onceKey && prev.awardedOnce.includes(onceKey)) return { state: prev, granted: 0 };
  return {
    state: {
      ...prev,
      xp: prev.xp + amount,
      lastActiveDay: today(),
      awardedOnce: onceKey ? [...prev.awardedOnce, onceKey] : prev.awardedOnce,
    },
    granted: amount,
  };
}

/** A topic mastered pays once and never again (docs/LEVELS.md §4, "a concept pays once"). */
export function applyCompleteTopic(prev: LearnerState, topicId: string, xp?: number): AwardOutcome {
  if (prev.completedTopics.includes(topicId)) return { state: prev, granted: 0 };
  const amount = xp ?? XP_AWARDS.topic;
  return {
    state: {
      ...prev,
      xp: prev.xp + amount,
      completedTopics: [...prev.completedTopics, topicId],
      lastActiveDay: today(),
    },
    granted: amount,
  };
}

export interface ProgressStore {
  xp: number;
  streakDays: number;
  /** A broken streak still inside the repair window, or null — drives the You repair card. */
  streakRepair: { brokenDays: number; brokenOn: string } | null;
  /** Streak-freezes still available this month. */
  freezesLeft: number;
  /** Spend a freeze to repair the pending break (with a logged reason). Returns true on success. */
  repairStreak: (reason: string) => boolean;
  completed: ReadonlySet<string>;
  /** Furthest fraction reached inside each topic's course (0..1). */
  topicProgress: Record<string, number>;
  /** Persist the furthest point reached in a course — powers the row progress fills. */
  reportProgress: (topicId: string, fraction: number) => void;
  blooms: XpBloom[];
  /** Award XP with a bloom. One-time reasons (account, invites, photo) only ever grant once. */
  award: (
    reason: XpReason,
    /** `tries` is how many attempts it cost, so the moment is sized by effort (REWARDS.md §3). */
    opts?: { amount?: number; onceKey?: string; hue?: string; tries?: number },
  ) => number;
  completeTopic: (topicId: string, xp?: number) => void;
  /**
   * Owner law: a completed course can be redone freely, but a replay earns NO xp. While a
   * completed course is open the player flips this on; every award/completion then no-ops
   * silently — no grant, no bloom, no level math (events + mastery evidence still record).
   */
  setReplay: (active: boolean) => void;
  dismissBloom: (id: number) => void;
  /** Milestone trophies earned this session, awaiting their ceremony (the head shows first). */
  trophies: TrophyAward[];
  /** Retire a trophy once its ceremony has played. */
  dismissTrophy: (id: number) => void;
}

const Ctx = createContext<ProgressStore | null>(null);

export function useProgress(): ProgressStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useProgress must be used within <ProgressProvider>');
  return s;
}

let bloomSeq = 1;
let trophySeq = 1;

export function ProgressProvider({ children }: { children: ReactNode }) {
  const sdk = useSdk();
  // Whether the day's own 20 was ALREADY paid before this session opened. `false` means this
  // session is the one that earned it, and that is the only case that deserves the moment:
  // announcing it again on every reload of the same day would be the nag docs/REWARDS.md §3 forbids.
  const dayWasKnown = useRef<boolean | null>(null);
  const [state, setState] = useState<LearnerState>(() => {
    const cache = sdk.state.loadCache();
    dayWasKnown.current ??= (cache.awardedOnce ?? []).includes(streakDayKey(today()));
    return rollForward(cache);
  });
  const [blooms, setBlooms] = useState<XpBloom[]>([]);
  const [trophies, setTrophies] = useState<TrophyAward[]>([]);
  // The already-celebrated milestone set — null until the first settle adopts (or silently backfills)
  // it, so shipping this never dumps a pile of ceremonies for milestones passed long ago.
  const celebrated = useRef<Set<string> | null>(null);
  // True while a *completed* course is open (a replay). A ref so toggling it never re-renders and
  // the award closures read it live — no XP is earned twice for the same course.
  const replaying = useRef(false);
  const setReplay = useCallback((active: boolean) => {
    replaying.current = active;
  }, []);

  // The ceremony trigger: whenever xp or the streak lands on a new milestone tier, queue its trophy.
  // First-EVER run silently adopts the current earned set (never a retroactive pile on ship). Every
  // later boot still checks against the persisted set — so a streak tier reached today (the streak
  // ticks up at boot via rollForward, not mid-session) still gets its moment. Only the single most
  // significant fresh key fires when several land at once, keeping the ceremony scarce.
  useEffect(() => {
    const earned = earnedTrophyKeys(state.xp, state.streakDays);
    if (celebrated.current === null) {
      const stored = loadCelebrated();
      if (stored === null) {
        celebrated.current = new Set(earned);
        saveCelebrated(celebrated.current);
        return;
      }
      celebrated.current = stored;
    }
    const fresh = earned.filter((k) => !celebrated.current?.has(k));
    if (fresh.length === 0) return;
    for (const k of fresh) celebrated.current.add(k);
    saveCelebrated(celebrated.current);
    const award: TrophyAward = { ...trophyAwardFor(topTrophyKey(fresh)), id: trophySeq++ };
    setTrophies((q) => [...q, award]);
  }, [state.xp, state.streakDays]);

  const dismissTrophy = useCallback((id: number) => {
    setTrophies((q) => q.filter((t) => t.id !== id));
  }, []);

  // Hydrate on boot: reconcile the local cache with learner_state (a no-op in local mode) so a
  // session on another device carries over — union of topics, max XP, the streak chain intact.
  useEffect(() => {
    let cancelled = false;
    sdk.state.hydrate().then((remote) => {
      if (cancelled) return;
      setState((prev) => rollForward(mergeLearnerState(prev, remote)));
    });
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  // Persistence is an EFFECT of the state changing, never a side effect inside a setState updater:
  // React may run an updater more than once for a single change (StrictMode, a re-render race, a
  // dropped render), and each extra run would fire another cache write and another debounced remote
  // push — with a half-applied state. One state, one save, after the render that made it real.
  const savedAtBoot = useRef(false);
  useEffect(() => {
    if (!savedAtBoot.current) {
      savedAtBoot.current = true; // the boot value came FROM the cache; writing it back is noise
      return;
    }
    sdk.state.save(state);
  }, [sdk, state]);

  /** Every mutation stamps updatedAt; the save rides the effect above. Pure — safe to re-run. */
  const stamp = useCallback(
    (next: LearnerState): LearnerState => ({ ...next, updatedAt: new Date().toISOString() }),
    [],
  );

  const pushBloom = useCallback(
    (amount: number, reason: XpReason, hue?: string, fromXp = 0, tries = 1) => {
      const id = bloomSeq++;
      const before = levelInfo(fromXp).level;
      const after = levelInfo(fromXp + amount).level;
      const crossedTo = after > before ? after : undefined;
      setBlooms((b) => [...b, { id, amount, reason, hue, crossedTo, tries }]);
      // a small bloom for a routine correct item, a bright glint for a bonus chest, a warm chord else
      if (reason === 'item' && !crossedTo) sfx.bloom();
      else if (reason === 'bonus' && !crossedTo) sfx.reward();
      // "a streak is kept | tiny | the orb's bounce, once, never a nag" (docs/REWARDS.md §3). The
      // day's own earn takes the small lift, never the warm chord a mastered topic gets.
      else if (reason === 'streak' && !crossedTo) sfx.bloom();
      else sfx.chord();
      // The level-up beat lingers a touch longer than a routine bloom; a routine bloom lingers by
      // what it cost the learner to earn it (`bloomHold`), so arriving late is warmer, not thinner.
      setTimeout(
        () => setBlooms((b) => b.filter((x) => x.id !== id)),
        crossedTo ? 3000 : bloomHold(tries),
      );
    },
    [],
  );

  /**
   * THE DAY'S EARN, MADE VISIBLE.
   *
   * `rollForward` pays the 20 inside a state initialiser and again when the remote state lands,
   * and neither of those can queue a moment. This is where turning up becomes something the
   * learner sees — before they have answered anything, and whether or not they get anything right
   * afterwards. That is rule 4 of "The tutor never leaves" at its trigger rather than at its hold.
   */
  const dayAnnounced = useRef(false);
  useEffect(() => {
    if (dayAnnounced.current || dayWasKnown.current !== false) return;
    if (!state.awardedOnce.includes(streakDayKey(today()))) return;
    dayAnnounced.current = true;
    pushBloom(XP_AWARDS.streak, 'streak', undefined, Math.max(0, state.xp - XP_AWARDS.streak));
  }, [state.awardedOnce, state.xp, pushBloom]);

  const award = useCallback(
    (
      reason: XpReason,
      opts?: { amount?: number; onceKey?: string; hue?: string; tries?: number },
    ) => {
      const amount = opts?.amount ?? XP_AWARDS[reason];
      if (replaying.current) return 0; // replay earns nothing — no grant, no bloom, no level math
      let granted = 0;
      let fromXp = 0;
      setState((prev) => {
        const out = applyAward(prev, reason, opts);
        granted = out.granted;
        fromXp = prev.xp;
        return out.granted > 0 ? stamp(out.state) : prev;
      });
      bumpToday(); // the You heat map warms with every earned moment
      // The bloom must feel immediate; if the grant was a duplicate one-time award it is silent.
      setTimeout(
        () => granted > 0 && pushBloom(amount, reason, opts?.hue, fromXp, opts?.tries ?? 1),
        0,
      );
      return amount;
    },
    [pushBloom, stamp],
  );

  const completeTopic = useCallback(
    (topicId: string, xp?: number) => {
      if (replaying.current) return; // re-completing a course grants nothing (owner replay law)
      let fromXp = 0;
      let granted = false;
      setState((prev) => {
        const out = applyCompleteTopic(prev, topicId, xp);
        fromXp = prev.xp;
        granted = out.granted > 0;
        return out.granted > 0 ? stamp(out.state) : prev;
      });
      bumpToday();
      // a completion bloom carries the mastered topic's subject hue; silent on a repeat completion
      setTimeout(
        () => granted && pushBloom(xp ?? XP_AWARDS.topic, 'topic', hueForTopic(topicId), fromXp),
        0,
      );
    },
    [pushBloom, stamp],
  );

  const repairStreak = useCallback(
    // reason is the honesty gate — a freeze is spent against a stated cause, not tapped for free.
    // ponytail: no dedicated event type in the contracts registry; the You card is the honest record.
    (reason: string): boolean => {
      if (!reason.trim()) return false;
      let ok = false;
      setState((prev) => {
        const pend = pendingRepair(prev);
        if (!pend) return prev;
        const m = monthKey(today());
        const used = prev.streakFreezes.month === m ? prev.streakFreezes.used : 0;
        if (used >= FREEZE_BUDGET) return prev;
        ok = true;
        return stamp({
          ...prev,
          // the chain continues through the frozen gap; showing up today is the next day of it
          streakDays: pend.brokenDays + 1,
          streakFreezes: { month: m, used: used + 1 },
          brokenStreak: undefined,
        });
      });
      return ok;
    },
    [stamp],
  );

  const reportProgress = useCallback(
    (topicId: string, fraction: number) => {
      setState((prev) => {
        const cur = prev.topicProgress[topicId] ?? 0;
        const f = Math.max(0, Math.min(1, fraction));
        if (f <= cur) return prev;
        return stamp({
          ...prev,
          topicProgress: { ...prev.topicProgress, [topicId]: f },
        });
      });
    },
    [stamp],
  );

  const dismissBloom = useCallback((id: number) => {
    setBlooms((b) => b.filter((x) => x.id !== id));
  }, []);

  const store = useMemo<ProgressStore>(
    () => ({
      xp: state.xp,
      streakDays: state.streakDays,
      streakRepair: pendingRepair(state),
      freezesLeft: freezesLeftOf(state),
      repairStreak,
      completed: new Set(state.completedTopics),
      topicProgress: state.topicProgress,
      reportProgress,
      blooms,
      award,
      completeTopic,
      setReplay,
      dismissBloom,
      trophies,
      dismissTrophy,
    }),
    [
      state,
      blooms,
      award,
      completeTopic,
      setReplay,
      dismissBloom,
      reportProgress,
      repairStreak,
      trophies,
      dismissTrophy,
    ],
  );

  return (
    <Ctx.Provider value={store}>
      {children}
      {/*
        The one place the learner is told their work is not landing (`store/SaveTrouble.tsx`).
        It hangs off THIS provider on purpose: this is the store that owns the child's XP, streak
        and completions, and the sentence is about exactly that work failing to reach their
        account. It renders nothing at all until a run of failed saves crosses the threshold in
        `sync-health.ts`, so the ordinary screen is untouched.
      */}
      <SaveTrouble />
    </Ctx.Provider>
  );
}
