'use client';

/**
 * The rail's allowance card, fed by the brain (WOBO-PLAN §16): `GET /v1/me` says how many turns are
 * left today and when they come back. One answer is shared across every screen that mounts the
 * shell and held for a minute, so walking Home → Learn → Home does not ask three times.
 */

import type { Me, Sdk } from '@wobo/sdk';
import { useEffect, useState } from 'react';
import { type Allowance, allowanceLine, readAllowance } from '../screens/plans/allowance';
import { useSdk } from '../store/sdk';

const FRESH_MS = 60_000;

let last: { at: number; me: Me | null } | null = null;
let inflight: Promise<Me | null> | null = null;

function fetchMe(sdk: Sdk): Promise<Me | null> {
  if (last && Date.now() - last.at < FRESH_MS) return Promise.resolve(last.me);
  if (!inflight) {
    inflight = sdk
      .me()
      .then((me) => {
        last = { at: Date.now(), me };
        return me;
      })
      .catch(() => last?.me ?? null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Tests only: forget the shared answer. */
export function resetAllowanceCache(): void {
  last = null;
  inflight = null;
}

export function useAllowance(): Allowance {
  const sdk = useSdk();
  const [me, setMe] = useState<Me | null>(() => last?.me ?? null);
  useEffect(() => {
    let live = true;
    void fetchMe(sdk).then((next) => {
      if (live) setMe(next);
    });
    return () => {
      live = false;
    };
  }, [sdk]);
  return readAllowance(me);
}

/**
 * The card's line — one voice for the allowance, everywhere.
 *
 * This used to read "25 of 40 turns left · resets 6:00 am", and the plans page said "about half of
 * today's allowance is left" for the very same number. Two voices for one fact, and one of them
 * was the raw count DESIGN.md §0 bans. The law states that rule without the "on a public surface"
 * qualifier its grade-gate rule carries, and the rail is mounted on every authenticated screen, so
 * the count went. The proportion is not lost: `allowanceProgress` still draws the exact fraction
 * on the marigold bar right beside this sentence, which is where a share belongs.
 *
 * `now` is kept in the signature because callers pass it and because a reset time is read against
 * a clock; `allowanceLine` formats the same instant.
 */
export function allowanceNote(allowance: Allowance, now: Date = new Date()): string {
  const at = allowance.resetsAt;
  // A reset stamped more than a day in the past is stale, and a sentence that promises the
  // allowance comes back at a time that has already gone is worse than one that does not name it.
  const stale = at !== null && at.getTime() <= now.getTime() - 86_400_000;
  return allowanceLine(stale ? { ...allowance, resetsAt: null } : allowance);
}

/** 0..1 for the marigold bar; undefined when there is no limit to draw against. */
export function allowanceProgress(allowance: Allowance): number | undefined {
  if (allowance.remaining === null || allowance.limit === null || allowance.limit <= 0) {
    return undefined;
  }
  return allowance.remaining / allowance.limit;
}
