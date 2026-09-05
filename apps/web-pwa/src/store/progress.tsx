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
  | 'boss'
  | 'topic'
  | 'account'
  | 'profile_photo'
  | 'invite_friend'
  | 'invite_parent'
  | 'mystery'
  | 'bonus';

export const XP_AWARDS: Record<XpReason, number> = {
  item: 10,
  boss: 80,
  topic: 150,
  account: 50,
  profile_photo: 20,
  invite_friend: 40,
  invite_parent: 40,
  mystery: 60,
  bonus: 45,
};

export interface XpBloom {
  id: number;
  amount: number;
  reason: XpReason;
  /** The owning subject's hue — earned moments carry the subject family. */
  hue?: string;
  /** Set only when this award crossed a level boundary — the new level. Triggers the level-up beat. */
  crossedTo?: number;
}

/**
 * The level curve. Level n opens at cumForLevel(n) cumulative xp; the step to the next level
 * widens by 40 each time (80 → 120 → 160 …) so early levels come fast for the hook and later
 * ones stretch. Closed-form so a single xp number tells the whole story — no separate persistence.
 */
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

const cumForLevel = (l: number): number => 20 * (l - 1) * (l + 2); // xp needed to REACH level l

export function levelInfo(xp: number): LevelInfo {
  const x = Math.max(0, Math.floor(xp));
  // invert cumForLevel: largest l with 20(l-1)(l+2) <= x. +epsilon guards fp at exact boundaries.
  const level = Math.max(1, Math.floor((-1 + Math.sqrt(9 + x / 5)) / 2 + 1e-9));
  const base = cumForLevel(level);
  const span = cumForLevel(level + 1) - base;
  const intoLevel = x - base;
  return { level, intoLevel, toNext: span - intoLevel, span, progress: intoLevel / span };
}

// ponytail: one runnable check — dev-only, console.assert never throws so a wrong curve just logs.
if (import.meta.env.DEV) {
  console.assert(levelInfo(0).level === 1 && levelInfo(0).toNext === 80, 'lvl@0');
  console.assert(levelInfo(79).level === 1 && levelInfo(80).level === 2, 'lvl boundary 80');
  console.assert(levelInfo(200).level === 3 && levelInfo(199).level === 2, 'lvl boundary 200');
  console.assert(levelInfo(100).intoLevel === 20 && levelInfo(100).span === 120, 'into@100');
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
function rollForward(p: LearnerState): LearnerState {
  const t = today();
  if (p.lastActiveDay === t) return p;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (p.lastActiveDay === yesterday)
    return { ...p, streakDays: p.streakDays + 1, lastActiveDay: t };
  const brokenStreak =
    p.streakDays >= 2 ? { days: p.streakDays, brokenOn: p.lastActiveDay } : p.brokenStreak;
  return { ...p, streakDays: 1, lastActiveDay: t, brokenStreak };
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
  award: (reason: XpReason, opts?: { amount?: number; onceKey?: string; hue?: string }) => number;
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
  const [state, setState] = useState<LearnerState>(() => rollForward(sdk.state.loadCache()));
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

  const pushBloom = useCallback((amount: number, reason: XpReason, hue?: string, fromXp = 0) => {
    const id = bloomSeq++;
    const before = levelInfo(fromXp).level;
    const after = levelInfo(fromXp + amount).level;
    const crossedTo = after > before ? after : undefined;
    setBlooms((b) => [...b, { id, amount, reason, hue, crossedTo }]);
    // a small bloom for a routine correct item, a bright glint for a bonus chest, a warm chord else
    if (reason === 'item' && !crossedTo) sfx.bloom();
    else if (reason === 'bonus' && !crossedTo) sfx.reward();
    else sfx.chord();
    // the level-up beat lingers a touch longer than a routine bloom
    setTimeout(() => setBlooms((b) => b.filter((x) => x.id !== id)), crossedTo ? 3000 : 2400);
  }, []);

  const award = useCallback(
    (reason: XpReason, opts?: { amount?: number; onceKey?: string; hue?: string }) => {
      const amount = opts?.amount ?? XP_AWARDS[reason];
      if (replaying.current) return 0; // replay earns nothing — no grant, no bloom, no level math
      let granted = 0;
      let fromXp = 0;
      setState((prev) => {
        const onceKey =
          opts?.onceKey ?? (['account', 'profile_photo'].includes(reason) ? reason : undefined);
        if (onceKey && prev.awardedOnce.includes(onceKey)) return prev;
        granted = amount;
        fromXp = prev.xp;
        return stamp({
          ...prev,
          xp: prev.xp + amount,
          lastActiveDay: today(),
          awardedOnce: onceKey ? [...prev.awardedOnce, onceKey] : prev.awardedOnce,
        });
      });
      bumpToday(); // the You heat map warms with every earned moment
      // The bloom must feel immediate; if the grant was a duplicate one-time award it is silent.
      setTimeout(() => granted > 0 && pushBloom(amount, reason, opts?.hue, fromXp), 0);
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
        if (prev.completedTopics.includes(topicId)) return prev;
        fromXp = prev.xp;
        granted = true;
        return stamp({
          ...prev,
          xp: prev.xp + (xp ?? XP_AWARDS.topic),
          completedTopics: [...prev.completedTopics, topicId],
          lastActiveDay: today(),
        });
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
