'use client';

/**
 * The mastery layer, in front of the screens.
 *
 * The SDK holds the truth (`sdk.mastery`: localStorage always, `learner.mastery_cache` in live
 * mode, reconciled on boot). This provider does three things and nothing else:
 *
 *   1. hydrates once per session, so a returning learner resumes mid-climb rather than restarting
 *      every topic: the reconcile feeds the recovered evidence back into the KGtoPG binding, so
 *      the bands read after it are the learner's whole history;
 *   2. repaints the board whenever a band moves, so a topic reaching the floor stops being "now"
 *      the moment it is earned rather than on the next reload;
 *   3. answers `bandOf(topic)` for the rules in `screens/learn/mastery.ts`.
 *
 * Nothing here can fail a lesson. A hydrate that cannot reach the network resolves to the cache;
 * a device with no storage at all reports every topic as `not_started`, which the rules read as
 * silence rather than as failure.
 */

import type { MasteryBand } from '@wobo/contracts';
import type { BandMap } from '@wobo/sdk';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Topic } from '../data/model';
import { topicNodeId } from '../screens/learn/mastery';
import { useSdk } from './sdk';

export interface MasteryStore {
  /** The band a topic stands at right now. `not_started` means nothing is known, not a bad result. */
  bandOf: (topic: Topic) => MasteryBand;
  /** Every band this learner holds, keyed by node id. */
  bands: BandMap;
  /**
   * The platform's own answer to "what next": `KGtoPG.mastery.getNextBestNode`, re-asked whenever
   * a band moves. Null when the governed view has nothing to say or cannot be reached, which is the
   * ordinary case for a syllabus the platform has not mapped: the learn flow then reads the
   * syllabus's own order through the same law (screens/learn/mastery.ts).
   */
  nextNodeId: string | null;
  /** False until the reconcile with the remote store has settled (or failed back to the cache). */
  ready: boolean;
}

const Ctx = createContext<MasteryStore | null>(null);

/**
 * The bands, with a fallback for every surface that renders outside the provider (the benches, a
 * test harness). Silence, not failure: the learn board then behaves as it did before mastery
 * was persisted rather than declaring every finished topic a debt.
 */
export function useMastery(): MasteryStore {
  return useContext(Ctx) ?? SILENT;
}

const SILENT: MasteryStore = {
  bandOf: () => 'not_started',
  bands: {},
  nextNodeId: null,
  ready: false,
};

/** Same keys, same values? Then the board has nothing new to paint. */
function sameBands(a: BandMap, b: BandMap): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

export function MasteryProvider({ children }: { children: ReactNode }) {
  const sdk = useSdk();
  const [bands, setBands] = useState<BandMap>(() => sdk.mastery.bands());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    const pull = () => {
      if (!live) return;
      const next = sdk.mastery.bands();
      setBands((prev) => (sameBands(prev, next) ? prev : next));
    };
    const stop = sdk.mastery.subscribe(pull);
    // The reconcile announces itself through the same subscription, so `pull` catches its result.
    // A failure is already swallowed inside the provider; the catch is the belt for the braces.
    void sdk.mastery
      .hydrate()
      .catch(() => {})
      .finally(() => {
        if (live) setReady(true);
      });
    pull();
    return () => {
      live = false;
      stop();
    };
  }, [sdk]);

  // The platform is asked directly, not reimplemented: the governed view knows prerequisite edges
  // the client does not hold. Re-asked whenever a band moves, because the answer depends on them.
  const [nextNodeId, setNextNodeId] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `bands` is the trigger, not an input: the platform derives its answer from the same evidence, so a band that moved means the answer may have moved with it
  useEffect(() => {
    let live = true;
    void sdk.kgtopg.mastery
      .getNextBestNode(sdk.subjectId)
      .then((node) => {
        if (live) setNextNodeId(node?.node_id ?? null);
      })
      .catch(() => {
        // the governed view is unavailable: the syllabus's own order still answers
      });
    return () => {
      live = false;
    };
  }, [sdk, bands]);

  const bandOf = useCallback(
    (topic: Topic): MasteryBand => bands[topicNodeId(topic)] ?? 'not_started',
    [bands],
  );

  // One identity per real change: `rowsOf` on the boards depends on `bandOf`, so a fresh object
  // every render would rebuild every chapter row on every keystroke elsewhere in the tree.
  const store = useMemo<MasteryStore>(
    () => ({ bandOf, bands, nextNodeId, ready }),
    [bandOf, bands, nextNodeId, ready],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
