'use client';

/**
 * The React seam over the curriculum.
 *
 * Each hook does one thing and does it lazily: a level is asked for when a level is opened, a
 * subject's chapters when the subject is opened, a chapter's topics when the chapter is opened
 * (CURRICULUM.md §8). Nothing is prefetched in bulk, nothing is generated ahead of the learner.
 *
 * Every hook has exactly three honest outcomes: an answer, "still looking" with the brain's own
 * line, or a refusal in Wobo's voice. None of them has a fourth outcome where a syllabus appears
 * from somewhere else.
 */

import {
  appendOp,
  applyOverlayOps,
  CurriculumError,
  type CurriculumFrameworkView,
  type CurriculumNode,
  type CurriculumOverlayView,
  type CurriculumStatusView,
  type CurriculumUnitsView,
  type CurriculumUpgradeView,
  DISCOVERY_COPY,
  type OverlayOp,
} from '@wobo/sdk';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { cache } from './cache';
import { curriculum, curriculumReady } from './client';
import { ingestTopics, ingestUnits, registryRevision, subscribeRegistry } from './registry';
import { countryHint, createSearchRunner, IDLE_SEARCH, type SearchState } from './search';
import { loadWorld, patchWorld, subscribeWorld, type World } from './world';

const EMPTY_WORLD_LINE = DISCOVERY_COPY.empty;

/** Wobo's line for anything the brain refused, already in their voice. */
function voiceOf(error: unknown): string {
  if (error instanceof CurriculumError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Give me a moment, then ask me again.';
}

// --- the world ------------------------------------------------------------------------------------

export function useWorld(): World | null {
  return useSyncExternalStore(subscribeWorld, loadWorld, loadWorld);
}

/** Re-renders whenever anything is ingested into the in-memory syllabus. */
export function useRegistryRevision(): number {
  return useSyncExternalStore(subscribeRegistry, registryRevision, registryRevision);
}

// --- board search ---------------------------------------------------------------------------------

export interface BoardSearch {
  state: SearchState;
  setQuery(text: string): void;
  /** Ask now — the Enter key, and the "tell me" door. */
  flush(): void;
  clear(): void;
}

export function useBoardSearch(): BoardSearch {
  const [state, setState] = useState<SearchState>(IDLE_SEARCH);
  const country = useMemo(() => countryHint(), []);
  const runner = useMemo(
    () =>
      createSearchRunner({
        search: (q) => {
          // No brain configured is a real state, and it is said plainly rather than papered over
          // with a bundled list of boards (WOBO-PLAN §13).
          if (!curriculumReady()) return Promise.reject(new Error('no gateway'));
          return curriculum().search(q, { country, limit: 8 });
        },
        onState: setState,
      }),
    [country],
  );
  useEffect(() => () => runner.cancel(), [runner]);
  return {
    state,
    setQuery: runner.query,
    flush: runner.flush,
    clear: runner.cancel,
  };
}

// --- one framework --------------------------------------------------------------------------------

export interface FrameworkQuery {
  view: CurriculumFrameworkView | null;
  loading: boolean;
  error: string | null;
}

/** The framework's levels, and — once a level is named — its subjects. */
export function useFramework(frameworkId: string | null, level?: string | null): FrameworkQuery {
  const [state, setState] = useState<FrameworkQuery>({ view: null, loading: false, error: null });

  useEffect(() => {
    if (!frameworkId || !curriculumReady()) {
      setState({ view: null, loading: false, error: null });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    curriculum()
      .framework(frameworkId, level ? { level } : {})
      .then(
        (view) => {
          if (!live) return;
          setState({ view, loading: false, error: null });
        },
        (error) => {
          if (!live) return;
          setState({ view: null, loading: false, error: voiceOf(error) });
        },
      );
    return () => {
      live = false;
    };
  }, [frameworkId, level]);

  return state;
}

// --- chapters, on opening a subject ----------------------------------------------------------------

export interface UnitsQuery {
  view: CurriculumUnitsView | null;
  units: CurriculumNode[];
  loading: boolean;
  /** True while a discovery job is running for this level and subject. */
  looking: boolean;
  error: string | null;
  /** True when these chapters came from the offline cache of the pinned version. */
  offline: boolean;
  reload(): void;
}

export function useUnits(subject: string | null): UnitsQuery {
  const world = useWorld();
  const overlay = useOverlayOps();
  const [view, setView] = useState<CurriculumUnitsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const frameworkId = world?.frameworkId ?? null;
  const versionId = world?.versionId ?? null;
  const level = world?.level ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` is the reload trigger
  useEffect(() => {
    if (!frameworkId || !level || !subject) {
      setView(null);
      setError(null);
      return;
    }
    let live = true;
    // The pinned version's cache answers instantly and offline; the network refreshes behind it.
    const cached = cache.units(frameworkId, versionId, level, subject);
    if (cached) {
      setView(cached);
      setOffline(true);
    }
    if (!curriculumReady()) {
      if (!cached) setError(null);
      return;
    }
    setLoading(true);
    curriculum()
      .units(frameworkId, level, subject, versionId ? { versionId } : {})
      .then(
        (next) => {
          if (!live) return;
          setView(next);
          setOffline(false);
          setLoading(false);
          setError(null);
          cache.putUnits(versionId, next);
        },
        (err) => {
          if (!live) return;
          setLoading(false);
          // A cached answer keeps the screen useful; without one the learner reads the refusal.
          if (!cached) setError(voiceOf(err));
        },
      );
    return () => {
      live = false;
    };
  }, [frameworkId, versionId, level, subject, nonce]);

  // The learner's overlay is applied on top of whatever the brain served, so an edit shows at once.
  const units = useMemo(() => {
    if (!view) return [];
    if (overlay.ops.length === 0) return view.units;
    return applyOverlayOps(view.units, overlay.ops).nodes;
  }, [view, overlay.ops]);

  // The in-memory registry holds the LEARNER'S list, not the board's — the same list the brain
  // itself returns on the next read, because it applies the overlay too. Ingesting the board's
  // raw units instead is what let a removed chapter stay on the screen until a reload: the
  // screens read the registry, and the registry had never heard about the edit.
  useEffect(() => {
    if (view) ingestUnits({ ...view, units });
  }, [view, units]);

  return {
    view,
    units,
    loading,
    looking: view?.status === 'looking',
    error,
    offline,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
}

// --- topics, on opening a chapter -------------------------------------------------------------------

export interface TopicsQuery {
  topics: CurriculumNode[];
  loading: boolean;
  error: string | null;
}

export function useTopics(unitId: string | null): TopicsQuery {
  const world = useWorld();
  const overlay = useOverlayOps();
  const [topics, setTopics] = useState<CurriculumNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const frameworkId = world?.frameworkId ?? null;
  const versionId = world?.versionId ?? null;

  useEffect(() => {
    if (!frameworkId || !unitId) {
      setTopics([]);
      return;
    }
    let live = true;
    const cached = cache.topics(frameworkId, versionId, unitId);
    if (cached) {
      setTopics(cached.topics);
      ingestTopics(cached);
    }
    if (!curriculumReady()) return;
    setLoading(true);
    curriculum()
      .topics(frameworkId, unitId, versionId ? { versionId } : {})
      .then(
        (view) => {
          if (!live) return;
          setTopics(view.topics);
          setLoading(false);
          setError(null);
          ingestTopics(view);
          cache.putTopics(versionId, view);
        },
        (err) => {
          if (!live) return;
          setLoading(false);
          if (!cached) setError(voiceOf(err));
        },
      );
    return () => {
      live = false;
    };
  }, [frameworkId, versionId, unitId]);

  const shown = useMemo(() => {
    if (overlay.ops.length === 0 || topics.length === 0) return topics;
    return applyOverlayOps(topics, overlay.ops).nodes;
  }, [topics, overlay.ops]);

  return { topics: shown, loading, error };
}

// --- the overlay ------------------------------------------------------------------------------------

export interface OverlayHandle {
  ops: OverlayOp[];
  /** What the last version upgrade could not re-apply, one line each. */
  report: string[];
  saving: boolean;
  error: string | null;
  apply(op: OverlayOp): void;
}

/**
 * One read of the overlay per version, however many hooks ask for it. A subject screen holds three
 * of these at once (chapters, topics, the editor) and they are all the same overlay.
 */
const overlayReads = new Map<string, Promise<CurriculumOverlayView>>();

function overlayKey(frameworkId: string, versionId: string | null): string {
  return `${frameworkId}:${versionId ?? 'pinned'}`;
}

function readOverlay(frameworkId: string, versionId: string | null) {
  const key = overlayKey(frameworkId, versionId);
  const inFlight = overlayReads.get(key);
  if (inFlight) return inFlight;
  const read = curriculum()
    .overlayGet({ frameworkId, ...(versionId ? { versionId } : {}) })
    .finally(() => overlayReads.delete(key));
  overlayReads.set(key, read);
  return read;
}

/**
 * The overlay itself, held once per version rather than once per hook.
 *
 * A subject screen mounts `useOverlayOps` three times — the chapter list, the topic list and the
 * editor — and they are all the same learner's edits on the same version. Held in component state
 * they were three separate copies, so tapping "remove" in the editor changed the editor and left
 * the chapter list showing the chapter. The learner's own edit is one fact, so it lives in one
 * place, and every hook that asks reads that place.
 */
const overlayOpsByVersion = new Map<string, OverlayOp[]>();
const overlayReports = new Map<string, string[]>();
const overlayListeners = new Set<() => void>();
let overlayRevision = 0;

function subscribeOverlay(listener: () => void): () => void {
  overlayListeners.add(listener);
  return () => {
    overlayListeners.delete(listener);
  };
}

function setOverlayOps(key: string, ops: OverlayOp[], report?: string[]): void {
  overlayOpsByVersion.set(key, ops);
  if (report) overlayReports.set(key, report);
  overlayRevision += 1;
  for (const listener of overlayListeners) listener();
}

/** Every hook reading this version sees the same array identity until the overlay really changes. */
const NO_OPS: OverlayOp[] = [];
const NO_REPORT: string[] = [];

/** The learner's edits for the pinned version. Optimistic locally, authoritative in the brain. */
export function useOverlayOps(): OverlayHandle {
  const world = useWorld();
  const frameworkId = world?.frameworkId ?? null;
  const versionId = world?.versionId ?? null;
  const key = frameworkId ? overlayKey(frameworkId, versionId) : null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The shared store, read the way React wants a shared store read. Every hook on this version
  // re-renders together, so an edit made in the editor is on the chapter list in the same frame.
  useSyncExternalStore(
    subscribeOverlay,
    () => overlayRevision,
    () => overlayRevision,
  );
  const ops = (key && overlayOpsByVersion.get(key)) || NO_OPS;
  const report = (key && overlayReports.get(key)) || NO_REPORT;

  useEffect(() => {
    if (!frameworkId || !key) return;
    let live = true;
    if (!overlayOpsByVersion.has(key)) {
      // The pinned version's cache answers instantly and offline; the brain refreshes behind it.
      setOverlayOps(key, cache.overlay(frameworkId, versionId) ?? []);
    }
    if (!curriculumReady()) return;
    readOverlay(frameworkId, versionId).then(
      (view) => {
        if (!live) return;
        setOverlayOps(key, view.ops, view.lastReport);
        cache.putOverlay(frameworkId, versionId, view.ops);
      },
      () => {
        // The cached overlay is the learner's own work; a failed read never discards it.
      },
    );
    return () => {
      live = false;
    };
  }, [frameworkId, versionId, key]);

  const apply = useCallback(
    (op: OverlayOp) => {
      if (!frameworkId || !key) return;
      const next = appendOp(overlayOpsByVersion.get(key) ?? [], op);
      setOverlayOps(key, next);
      cache.putOverlay(frameworkId, versionId, next);
      setSaving(true);
      setError(null);
      curriculum()
        .overlayApply({ frameworkId, ...(versionId ? { versionId } : {}) }, next)
        .then(
          (view) => {
            setOverlayOps(key, view.ops);
            setSaving(false);
            cache.putOverlay(frameworkId, versionId, view.ops);
          },
          (err) => {
            setSaving(false);
            // The edit stays on screen and in the cache; the learner is told it is not saved yet.
            setError(voiceOf(err));
          },
        );
    },
    [frameworkId, versionId, key],
  );

  return { ops, report, saving, error, apply };
}

/** A new learner, or a signed-out device: the previous learner's edits must not survive it. */
export function resetOverlayStore(): void {
  overlayOpsByVersion.clear();
  overlayReports.clear();
  overlayRevision += 1;
  for (const listener of overlayListeners) listener();
}

// --- version upgrades ---------------------------------------------------------------------------------

export interface UpgradeHandle {
  offer: CurriculumUpgradeView | null;
  busy: boolean;
  error: string | null;
  /** Take the new version. The overlay is re-applied by the brain and reported on. */
  accept(): Promise<void>;
  dismiss(): void;
}

export function useUpgrade(): UpgradeHandle {
  const world = useWorld();
  const frameworkId = world?.frameworkId ?? null;
  const [offer, setOffer] = useState<CurriculumUpgradeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!frameworkId || !curriculumReady()) {
      setOffer(null);
      return;
    }
    let live = true;
    curriculum()
      .upgrade(frameworkId)
      .then(
        (view) => {
          if (live) setOffer(view.upgradeAvailable ? view : null);
        },
        () => {
          // An upgrade the learner never hears about costs them nothing; it is offered again later.
        },
      );
    return () => {
      live = false;
    };
  }, [frameworkId]);

  const accept = useCallback(async () => {
    if (!frameworkId) return;
    setBusy(true);
    setError(null);
    try {
      const applied = await curriculum().upgrade(frameworkId, true);
      // The pin moved with the upgrade, so the world follows and the old version's cache is dropped.
      const previous = loadWorld();
      if (previous) cache.forget(previous.frameworkId, previous.versionId);
      patchWorld({
        versionId: applied.latest?.id ?? null,
        versionYear: applied.latest?.year ?? null,
        label: applied.latestLabel || (previous?.label ?? ''),
      });
      setOffer({ ...applied, upgradeAvailable: false });
    } catch (err) {
      setError(voiceOf(err));
    } finally {
      setBusy(false);
    }
  }, [frameworkId]);

  return { offer, busy, error, accept, dismiss: useCallback(() => setOffer(null), []) };
}

// --- watching a discovery job ---------------------------------------------------------------------------

const POLL_MS = 4000;

/**
 * Follow a running discovery job and say what it is doing, in the brain's own words. Stops the
 * moment the job is terminal — a refusal is an answer, and the screen turns it into the
 * own-syllabus door rather than spinning forever.
 */
export function useDiscoveryStatus(
  jobId: string | null,
  onFinished?: (status: CurriculumStatusView) => void,
): CurriculumStatusView | null {
  const [status, setStatus] = useState<CurriculumStatusView | null>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    if (!jobId || !curriculumReady()) {
      setStatus(null);
      return;
    }
    let live = true;
    let handle: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      curriculum()
        .status({ jobId })
        .then(
          (next) => {
            if (!live) return;
            setStatus(next);
            // Terminal is what the brain says, not a state name: a stored job is done and so is a
            // failed one, and neither is spelled "provisional".
            const done = !next.open;
            if (done) finished.current?.(next);
            else handle = setTimeout(tick, POLL_MS);
          },
          () => {
            if (live) handle = setTimeout(tick, POLL_MS * 2);
          },
        );
    };
    tick();
    return () => {
      live = false;
      if (handle) clearTimeout(handle);
    };
  }, [jobId]);

  return status;
}

export { EMPTY_WORLD_LINE };
