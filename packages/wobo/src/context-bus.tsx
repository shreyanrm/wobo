'use client';

import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type ConsequentialAction, reduceActions, type WoboAction } from './actions';
import { labelElement } from './glass/read';
import type { WoboMood } from './identity';

/**
 * The Wobo Context Bus. Every page publishes its full state into it, and registers the elements
 * Wobo may draw on — which turns each page into a canvas Wobo is directly plugged into. Wobo perceives
 * the app through this bus (the four-layer context assembler: turn, session, lifetime, curriculum),
 * never through a screen-share, and Wobo expresses back through it (mood, a scene's state,
 * and offered actions). One store is both Wobo's eyes and Wobo's hands.
 */

// --- Perception: what a page publishes -----------------------------------------------------------

/**
 * The universal scene-graph seams (WOBO.md §3). Any registered target may implement them, which
 * turns it from an annotatable element into a live scene Wobo reads at code level and can drive.
 * All optional — existing targets keep working unchanged.
 */
export interface SceneSeams {
  /** Semantic scene state, e.g. { grid: '4×4', '(0,2)': 3 } — code-level, never pixels. */
  getSceneState?: () => Record<string, unknown>;
  /** What can be done on this scene right now, as plain phrases for Wobo's reasoning. */
  getValidActions?: () => string[];
  /** Apply a tutor-driven state patch (the setState action) — demonstrate by doing. */
  applyTutorAction?: (patch: Record<string, unknown>) => void;
}

/** An element on the page Wobo can point at, highlight, or annotate — and, when it implements the
 * scene seams, read and drive. */
export interface AnnotatableTarget extends SceneSeams {
  id: string;
  kind: string; // 'expression' | 'step' | 'opener' | 'concept' | 'control' | 'region' | ...
  label: string; // human/AI-readable meaning, e.g. "the step where 3 was moved across"
  meaning?: string;
  /** Live viewport rect, for the overlay to position marks. */
  getRect: () => DOMRect | null;
}

/** The serialized scene a target exposes into Wobo's assembled context. */
export interface TargetScene {
  state?: Record<string, unknown>;
  validActions?: string[];
  /** True when the target accepts setState (it implements applyTutorAction). */
  drivable: boolean;
}

export interface CanvasWorking {
  nodeId: string;
  equation?: string;
  steps: string[];
  lastEditedAt?: string;
}

export interface PageContext {
  route: string;
  state: Record<string, unknown>;
}
export interface CurriculumContext {
  nodeId?: string;
  nodeName?: string;
  band?: string;
  prerequisiteIds?: string[];
}
export interface SessionContext {
  sessionId: string;
  recentEvents: string[];
  /**
   * True only on the learner's very first turn with Wobo. Wobo already introduced themself during
   * setup ("I'm Wobo, your AI wobot"), so the gateway uses this to greet warmly by name — and to
   * never introduce themself a second time.
   */
  firstMeeting?: boolean;
}
export interface TurnContext {
  recentTurns: { role: 'user' | 'wobo'; text: string }[];
  lastUserInput?: string;
  /** The learner's local wall-clock, so wellbeing turns (late-night, sleep) ride the real time. */
  localTime?: string;
}
export interface LifetimeContext {
  twinSummary?: string;
  masteryHighlights?: string[];
  /** Who Wobo is teaching — the dossier's identity, from the onboarding profile (WOBO.md §7). */
  learner?: { name: string; age?: number; grade?: string; board?: string };
  /** Durable facts Wobo has learned in conversation — the concierge's notepad. */
  facts?: string[];
  /** Durable accessibility profile — Wobo honors these every turn (family P). */
  accessibility?: { readAloud?: boolean; largeText?: boolean; highContrast?: boolean };
  /** Persistent instruction language — Wobo teaches in this until it's changed. */
  language?: string;
}

/**
 * The machine room (WOBO-CAPABILITIES.md family J) — the system's internal truth for the turn:
 * a mastery-band snapshot, the spaced-review due queue, XP/level/streak, the recent event-stream
 * tail, and any in-flight content generation. Digests, never dumps — the app assembles it each turn
 * and the gateway renders it compactly so Wobo references it naturally ("3 reviews due, two minutes
 * each", "how far to level 5" answered exactly).
 */
export interface MachineRoomContext {
  /** How many nodes sit in each mastery band right now, e.g. { developing: 3, secure: 2 }. */
  masteryBands?: Record<string, number>;
  /** Spaced-review queue: how many are due now, how many scheduled, and the soonest few. */
  reviews?: { dueCount: number; scheduled: number; next?: { node: string; inMinutes: number }[] };
  /** Gamification state — enough to answer "how far to level N" exactly. */
  progress?: { xp: number; level: number; intoLevel: number; toNext: number; streakDays: number };
  /** The event-stream tail, richest last (~8): what they clicked, answered, hesitated on. */
  eventTail?: string[];
  /** In-flight content generation — the one composing right now, if any. */
  generating?: { what: string };
}

/** The full, serializable context Wobo reasons over — Wobo's perception of the app. */
export interface WoboAssembledContext {
  page: PageContext;
  curriculum: CurriculumContext;
  session: SessionContext;
  turn: TurnContext;
  lifetime: LifetimeContext;
  canvas?: CanvasWorking;
  /** The system's live internal state (family J) — assembled by the app each turn. */
  machine?: MachineRoomContext;
  targets: { id: string; kind: string; label: string; meaning?: string; scene?: TargetScene }[];
}

// --- Expression: what Wobo draws (ActiveHighlight / ActiveAnnotation live in ./actions) ---------

export interface WoboHandlers {
  navigate?: (route: string) => void;
  startPractice?: (nodeId: string) => void;
  switchModality?: (to: string) => void;
  onSay?: (text: string) => void;
  /**
   * Voice-locked speech (the speak action): play through the voice path when live, otherwise render
   * as Wobo's handwritten line. When absent, speak degrades to onSay.
   */
  onSpeak?: (text: string) => void;
  onRevealHint?: (level: number) => void;
  onEscalateHint?: () => void;
  /** Persist a durable fact Wobo just learned (the remember action) into the learner's mind. */
  onRemember?: (text: string) => void;
}

export interface WoboBus {
  // perception (publish)
  registerTarget(target: AnnotatableTarget): () => void;
  publishPage(page: PageContext): void;
  publishCurriculum(curriculum: CurriculumContext): void;
  publishSession(session: SessionContext): void;
  publishTurn(turn: TurnContext): void;
  publishLifetime(lifetime: LifetimeContext): void;
  /**
   * Publish (or clear) the working canvas. Pass an `owner` key — one stable string per surface —
   * so an unmount hook only ever clears the canvas it published: screens overlap on a swap (the
   * arriving one publishes before the leaving one's cleanup runs), and an ownerless clear in that
   * window wipes the new screen's canvas out from under it.
   */
  publishCanvas(canvas: CanvasWorking | undefined, owner?: string): void;
  publishMachine(machine: MachineRoomContext | undefined): void;
  // perception (read)
  assembleContext(): WoboAssembledContext;
  getTargets(): AnnotatableTarget[];
  /**
   * Registration changes as a subscription, not a state field. Targets mount and unmount constantly
   * (every card, step and control on a screen), and holding that count in bus state re-rendered the
   * whole consumer tree on each one. Subscribers pair this with `getTargetsVersion` —
   * `useSyncExternalStore(subscribeToTargets, getTargetsVersion)` — so only the components that
   * actually care about the target list wake up. Returns an unsubscribe.
   */
  subscribeToTargets(listener: () => void): () => void;
  /** Monotonic registration counter — the `useSyncExternalStore` snapshot for `subscribeToTargets`. */
  getTargetsVersion(): number;
  /**
   * Drive a registered scene through its applyTutorAction seam (the setState action). Returns true
   * when the target exists and accepts tutor actions.
   */
  applyTutorAction(targetId: string, patch: Record<string, unknown>): boolean;
  // expression
  mood: WoboMood;
  pendingOffer: ConsequentialAction | null;
  /**
   * Run a turn's actions: the mood, the spoken lines, a scene's setState, the hints, the facts to
   * remember, and at most one consequential offer. Nothing here draws: a mark on the page is a
   * plan traced by the one pen (docs/INK-FREEZE-PLAN-TRACE.md §3), never an action.
   */
  dispatch(actions: WoboAction[]): void;
  acceptOffer(): void;
  dismissOffer(): void;
}

export interface CanvasSlot {
  canvas?: CanvasWorking;
  owner?: string;
}

/**
 * Resolve one publishCanvas call against the slot. Publishing always wins (and takes ownership);
 * a clear only lands when it comes from the owner — a surface unmounting after its replacement has
 * already published must not blank the new canvas. An ownerless clear still clears, as before.
 */
export function resolveCanvasSlot(
  slot: CanvasSlot,
  next: CanvasWorking | undefined,
  owner?: string,
): CanvasSlot {
  if (next !== undefined) return { canvas: next, owner };
  if (owner !== undefined && slot.owner !== owner) return slot; // not yours to clear
  return {};
}

/**
 * The registered-target store. Registration is a SUBSCRIPTION, not React state: targets mount and
 * unmount constantly (every card, step, control and engine on a screen), and a version held in bus
 * state pushed each one through the bus memo and re-rendered every consumer of it. Consumers that
 * genuinely care about the target list pair `subscribe` with `getVersion` through
 * `useSyncExternalStore`, so only they wake up.
 */
export interface TargetStore {
  register(target: AnnotatableTarget): () => void;
  get(id: string): AnnotatableTarget | undefined;
  getTargets(): AnnotatableTarget[];
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}

export function createTargetStore(): TargetStore {
  const targets = new Map<string, AnnotatableTarget>();
  const listeners = new Set<() => void>();
  let version = 0;
  const bump = () => {
    version += 1;
    // Copy first: a listener may unsubscribe itself while being notified.
    for (const listener of [...listeners]) listener();
  };
  return {
    register(target) {
      targets.set(target.id, target);
      bump();
      let live = true;
      return () => {
        // Idempotent, and it never evicts a same-id target that replaced this one (a remount
        // registers the new element before the old one's cleanup runs).
        if (!live) return;
        live = false;
        if (targets.get(target.id) === target) targets.delete(target.id);
        bump();
      };
    },
    get: (id) => targets.get(id),
    getTargets: () => Array.from(targets.values()),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
  };
}

const BusContext = createContext<WoboBus | null>(null);

export function useWoboBus(): WoboBus {
  const bus = useContext(BusContext);
  if (!bus) throw new Error('useWoboBus must be used within a <WoboProvider>');
  return bus;
}

export interface WoboProviderProps {
  children: ReactNode;
  handlers?: WoboHandlers;
}

export function WoboProvider({ children, handlers }: WoboProviderProps) {
  // Perception fields are refs, not state: publishing them must NOT recreate the bus object, or every
  // consumer effect that publishes page/canvas would re-run and loop. They are read on demand when
  // Wobo assembles their context. Only expression state (mood/marks/offer) drives re-renders.
  const pageRef = useRef<PageContext>({ route: 'today', state: {} });
  const curriculumRef = useRef<CurriculumContext>({});
  const sessionRef = useRef<SessionContext>({ sessionId: 'dev-session', recentEvents: [] });
  const turnRef = useRef<TurnContext>({ recentTurns: [] });
  const lifetimeRef = useRef<LifetimeContext>({});
  const canvasRef = useRef<CanvasSlot>({});
  const machineRef = useRef<MachineRoomContext | undefined>(undefined);

  const publishPage = useCallback((v: PageContext) => {
    pageRef.current = v;
  }, []);
  const publishCurriculum = useCallback((v: CurriculumContext) => {
    curriculumRef.current = v;
  }, []);
  const publishSession = useCallback((v: SessionContext) => {
    sessionRef.current = v;
  }, []);
  const publishTurn = useCallback((v: TurnContext) => {
    turnRef.current = v;
  }, []);
  const publishLifetime = useCallback((v: LifetimeContext) => {
    lifetimeRef.current = v;
  }, []);
  const publishCanvas = useCallback((v: CanvasWorking | undefined, owner?: string) => {
    canvasRef.current = resolveCanvasSlot(canvasRef.current, v, owner);
  }, []);
  const publishMachine = useCallback((v: MachineRoomContext | undefined) => {
    machineRef.current = v;
  }, []);

  const [mood, setMood] = useState<WoboMood>('idle');
  const [pendingOffer, setPendingOffer] = useState<ConsequentialAction | null>(null);

  const storeRef = useRef<TargetStore | null>(null);
  storeRef.current ??= createTargetStore();
  const store = storeRef.current;
  const handlersRef = useRef<WoboHandlers | undefined>(handlers);
  handlersRef.current = handlers;

  const registerTarget = useCallback(
    (target: AnnotatableTarget) => store.register(target),
    [store],
  );
  const subscribeToTargets = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );
  const getTargetsVersion = useCallback(() => store.getVersion(), [store]);
  const getTargets = useCallback(() => store.getTargets(), [store]);

  const assembleContext = useCallback(
    (): WoboAssembledContext => ({
      page: pageRef.current,
      curriculum: curriculumRef.current,
      session: sessionRef.current,
      turn: turnRef.current,
      lifetime: lifetimeRef.current,
      canvas: canvasRef.current.canvas,
      machine: machineRef.current,
      targets: getTargets().map((t) => {
        const drivable = typeof t.applyTutorAction === 'function';
        const hasScene = drivable || t.getSceneState || t.getValidActions;
        return {
          id: t.id,
          kind: t.kind,
          label: t.label,
          meaning: t.meaning,
          scene: hasScene
            ? {
                state: t.getSceneState?.(),
                validActions: t.getValidActions?.(),
                drivable,
              }
            : undefined,
        };
      }),
    }),
    [getTargets],
  );

  const applyTutorAction = useCallback(
    (targetId: string, patch: Record<string, unknown>) => {
      const target = store.get(targetId);
      if (!target?.applyTutorAction) return false;
      target.applyTutorAction(patch);
      return true;
    },
    [store],
  );

  // The side-effects of a turn (mood, voice, setState, hints, remembers).
  const fireSideEffects = useCallback(
    (effects: ReturnType<typeof reduceActions>) => {
      const h = handlersRef.current;
      if (effects.mood) setMood(effects.mood);
      for (const text of effects.says) h?.onSay?.(text);
      // speak is voice-locked: through the voice path when the app wires onSpeak (live), otherwise it
      // degrades to Wobo's written line.
      for (const text of effects.speaks) {
        if (h?.onSpeak) h.onSpeak(text);
        else h?.onSay?.(text);
      }
      // setState demonstrations route to each scene's applyTutorAction seam; unknown or non-drivable
      // targets are ignored (Wobo can only drive what publishes itself).
      for (const s of effects.setStates) applyTutorAction(s.targetId, s.patch);
      for (const level of effects.revealHints) h?.onRevealHint?.(level);
      for (let i = 0; i < effects.escalateHints; i += 1) h?.onEscalateHint?.();
      // Wobo writes to Wobo's own dossier — a fact learned here rides every future turn
      for (const text of effects.remembers) h?.onRemember?.(text);
    },
    [applyTutorAction],
  );

  const dispatch = useCallback(
    (actions: WoboAction[]) => {
      const effects = reduceActions(actions);
      setPendingOffer(effects.offer);
      fireSideEffects(effects);
    },
    [fireSideEffects],
  );

  const acceptOffer = useCallback(() => {
    setPendingOffer((offer) => {
      const h = handlersRef.current;
      if (offer) {
        if (offer.type === 'navigate') h?.navigate?.(offer.route);
        else if (offer.type === 'startPractice') h?.startPractice?.(offer.nodeId);
        else if (offer.type === 'switchModality') h?.switchModality?.(offer.to);
      }
      return null;
    });
  }, []);

  const dismissOffer = useCallback(() => setPendingOffer(null), []);

  const bus = useMemo<WoboBus>(
    () => ({
      registerTarget,
      publishPage,
      publishCurriculum,
      publishSession,
      publishTurn,
      publishLifetime,
      publishCanvas,
      publishMachine,
      assembleContext,
      getTargets,
      subscribeToTargets,
      getTargetsVersion,
      applyTutorAction,
      mood,
      pendingOffer,
      dispatch,
      acceptOffer,
      dismissOffer,
    }),
    [
      registerTarget,
      publishPage,
      publishCurriculum,
      publishSession,
      publishTurn,
      publishLifetime,
      publishCanvas,
      publishMachine,
      assembleContext,
      getTargets,
      subscribeToTargets,
      getTargetsVersion,
      applyTutorAction,
      mood,
      pendingOffer,
      dispatch,
      acceptOffer,
      dismissOffer,
    ],
  );

  return <BusContext.Provider value={bus}>{children}</BusContext.Provider>;
}

/**
 * Label a DOM element as a thing Wobo can name. Attach the returned ref to the element:
 *   const ref = useRegisterTarget('step-1', { kind: 'step', label: 'the step you subtracted 3' });
 *   return <div ref={ref}>2x = 10</div>;
 *
 * A LABEL, NEVER A PRECONDITION (docs/INK-FREEZE-PLAN-TRACE.md §3): the glass map reads every
 * rendered line and element off the page whether or not anything registered it. What this adds is
 * the id the content model wants the thing known by, its role and its meaning, written on the
 * element as `data-glass` attributes for the reader to keep; and, for interactives, the scene
 * seams (getSceneState / getValidActions / applyTutorAction) on the bus, so Wobo can read and
 * drive them. Inline closures are fine, they are held in a ref so re-renders never re-register.
 */
/** A target is a scene when a component gave it any seam: state to read, moves to name, or a drive. */
export function hasSceneSeam(seams: {
  hasState: boolean;
  hasValidActions: boolean;
  hasDrive: boolean;
}): boolean {
  return seams.hasState || seams.hasValidActions || seams.hasDrive;
}

export function useRegisterTarget<T extends HTMLElement = HTMLElement>(
  id: string,
  meta: { kind: string; label: string; meaning?: string } & SceneSeams,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  const { registerTarget } = useWoboBus();
  const { kind, label, meaning } = meta;
  const seamsRef = useRef<SceneSeams>(meta);
  seamsRef.current = meta;
  const hasState = Boolean(meta.getSceneState);
  const hasValidActions = Boolean(meta.getValidActions);
  const hasDrive = Boolean(meta.applyTutorAction);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const unlabel = labelElement(el, { id, kind, label, meaning });
    // Only a scene rides the bus: something Wobo reads the state of or drives. A plain thing on
    // the page is on the glass map by being on the page, and a second list of it would be the
    // second registry the law removed (docs/INK-FREEZE-PLAN-TRACE.md §4).
    if (!hasSceneSeam({ hasState, hasValidActions, hasDrive })) return unlabel;
    const unregister = registerTarget({
      id,
      kind,
      label,
      meaning,
      getRect: () => el.getBoundingClientRect(),
      getSceneState: hasState ? () => seamsRef.current.getSceneState?.() ?? {} : undefined,
      getValidActions: hasValidActions
        ? () => seamsRef.current.getValidActions?.() ?? []
        : undefined,
      applyTutorAction: hasDrive
        ? (patch: Record<string, unknown>) => seamsRef.current.applyTutorAction?.(patch)
        : undefined,
    });
    return () => {
      unlabel();
      unregister();
    };
  }, [id, kind, label, meaning, registerTarget, hasState, hasValidActions, hasDrive]);
  return ref;
}
