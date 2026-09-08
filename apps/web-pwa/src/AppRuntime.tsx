'use client';

/**
 * The app runtime — everything behind the door, in one chunk that a visitor to the public site
 * never downloads.
 *
 * Identity → SDK → Wobo's bus → the screens. Wobo is the runtime the app executes inside
 * (DESIGN.md §4): the home is Wobo's front door; everywhere else Wobo is docked, reading the page
 * at code level through the context bus, one tap from expanding.
 *
 * It is mounted by `App.tsx` the moment the address stops being a public one — and prefetched
 * while a visitor reads the site, so walking through the door costs nothing they can feel.
 */

import type { Sdk } from '@wobo/sdk';
import {
  type FocusObject,
  hasSyncAnchor,
  isTypingTarget,
  parseActions,
  plane,
  scrollHold,
  surfaceRegistry,
  useWoboBus,
  type WoboHandlers,
  type WoboMood,
  WoboOverlay,
  WoboProvider,
} from '@wobo/wobo';
import { AnimatePresence, motion } from 'framer-motion';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ONBOARDED_KEY } from './App';
import { takeSignInSource } from './screens/auth/source';
import { answerBody, doubtAnswerPath } from './screens/doubt/api';
import { doubtCaption } from './screens/doubt/caption';
import { StateLayer } from './screens/states/StateHost';
import { boardName, loadProfile, mergeAccount } from './screens/you/profile';
import { resolveDestination } from './shell/destinations';
import { isPublicSite } from './shell/public-routes';
import { useConnectivity } from './shell/resilience';
import { type Route, useRouter } from './shell/router';
import { publicScreen } from './site/PublicRoutes';
import { appSdk, GATEWAY_URL } from './store/app-sdk';
import { machineRoomSnapshot } from './store/machine-room';
import { MasteryProvider } from './store/mastery';
import {
  forgetMatching,
  lifetimeSnapshot,
  loadMind,
  MindObserver,
  mindLines,
  rememberFact,
} from './store/mind';
import { ProgressProvider, useProgress } from './store/progress';
import { applyScope, scoped } from './store/scope';
import { SdkProvider } from './store/sdk';
import { AppHeader } from './ui/AppHeader';
import { ensureDefaultAvatar } from './ui/avatars';
import { ClickInk } from './ui/ClickInk';
import { CeremonyHost } from './ui/ceremony';
import { MotionPrefConfig } from './ui/MotionPref';
import { sfx } from './ui/sound';
import { BoardBenchGate } from './wobo/board-bench';
import { boardTurn, dismissBoard } from './wobo/board-turn';
import { WoboCompanion } from './wobo/Companion';
import {
  boardTurnPayload,
  forgetAllOffer,
  noteAccount,
  turnFocus,
  woboTurnPayload,
} from './wobo/capabilities';
import {
  type AskOptions,
  appendToArchive,
  CHAT_PAGE,
  type ChatTurn,
  mintTurnId,
  readArchive,
  updateArchiveTurn,
  WoboChatProvider,
  writeArchive,
} from './wobo/chat';
import { takeHandedQuestion } from './wobo/handoff';
import {
  armDoIt,
  armedAction,
  disarm,
  findTargetId,
  isConfirmation,
  isDecline,
  runsWithoutAsking,
  showMe,
} from './wobo/hands';
import { holdToTalkEnd, holdToTalkStart } from './wobo/hold';
import { lookingAt } from './wobo/looking';
import { modeDraws, modeFromText, modePrompt } from './wobo/modes';
import { resolveTurnExtras, type TurnExtras } from './wobo/paths';
import { useLifeSignals } from './wobo/presence';
import { boardShapeOf, isLessonRoute } from './wobo/presentation';
import { refusalLine } from './wobo/refusals';
import { WoboStage } from './wobo/Stage';
import { beatOfTurn, registerPerformance, SpeechNarrator, speakLine } from './wobo/speech';
import { changeVariable, gatewayBrain } from './wobo/variables';

// LAZY: one chunk per screen, fetched on the navigation that needs it. Each of these pulls its own
// engine tree behind it (mafs, the CS ramp, the map projections, the trophy room), which is what
// made the eager entry chunk ~2.1 MB. Home and Onboarding are here too: this whole module is
// already behind a dynamic import, so the two first-paint screens ride the boot curtain that
// exists for exactly this wait, and neither one is in the chunk the public site downloads.
const ChatScreen = lazy(() =>
  import('./screens/ChatScreen').then((m) => ({ default: m.ChatScreen })),
);
const Course = lazy(() => import('./screens/Course').then((m) => ({ default: m.Course })));
const DownloadCenter = lazy(() =>
  import('./store/DownloadCenter').then((m) => ({ default: m.DownloadCenter })),
);
const CommandPalette = lazy(() =>
  import('./shell/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
const EnginesGallery = lazy(() =>
  import('./screens/concepts/EnginesGallery').then((m) => ({ default: m.EnginesGallery })),
);
const FrameBuilding = lazy(() =>
  import('./screens/FrameBuilding').then((m) => ({ default: m.FrameBuilding })),
);
const Home = lazy(() => import('./screens/Home').then((m) => ({ default: m.Home })));
const Learn = lazy(() => import('./screens/Learn').then((m) => ({ default: m.Learn })));
const Onboarding = lazy(() =>
  import('./screens/Onboarding').then((m) => ({ default: m.Onboarding })),
);
const Practice = lazy(() => import('./screens/Practice').then((m) => ({ default: m.Practice })));
const ProgressScreen = lazy(() =>
  import('./screens/ProgressScreen').then((m) => ({ default: m.ProgressScreen })),
);
const SubjectScreen = lazy(() =>
  import('./screens/SubjectScreen').then((m) => ({ default: m.SubjectScreen })),
);
const You = lazy(() => import('./screens/You').then((m) => ({ default: m.You })));
const DoubtScreen = lazy(() =>
  import('./screens/doubt/DoubtScreen').then((m) => ({ default: m.DoubtScreen })),
);
const ParentView = lazy(() =>
  import('./screens/you/ParentView').then((m) => ({ default: m.ParentView })),
);

/**
 * What sits in the frame while a screen's chunk arrives. Deliberately empty: the route transition
 * is already animating, the header and Wobo are outside this boundary and never blink, and a
 * spinner for a chunk that usually lands in a few hundred milliseconds is noise. Full height so
 * the page does not collapse and bounce the scroll position.
 */
const ScreenPending = () => <div aria-busy="true" style={{ minHeight: '60vh' }} />;

/** Zero-argument destinations Wobo may offer to navigate to. */
const NAV_ROUTES: Record<string, Route> = {
  home: { name: 'home' },
  chat: { name: 'chat' },
  learn: { name: 'learn' },
  practice: { name: 'practice' },
  progress: { name: 'progress' },
  you: { name: 'you' },
};

// The first meeting is the runtime's own bookkeeping; the two the screens read live in App.tsx.
/** Set once the learner has taken their first turn with Wobo — their first meeting is over. */
const MET_TURN_KEY = 'wobo-first-turn-v1';

// The learner's face, before the header can ask for it. It runs when this chunk is evaluated,
// which is the first moment anything in the app can render — and never on the public site, which
// has no header and no learner to have a face.
ensureDefaultAvatar();

// The shared-axis law (MOTION.md §2): navigation is spatial. Nav-level routes are siblings —
// they crossfade with a small rise, silently. Going deeper is a forward shared-axis push; back is
// its mirror; each rides the single transition sound. Scenes that own the viewport bring their own
// entrances and are never doubled with route motion.
type Dir = 'forward' | 'back' | 'sibling' | 'none';
const SIBLING_ROUTES = new Set(['home', 'chat', 'learn', 'practice', 'progress', 'you']);
const OWN_VIEWPORT_ROUTES = new Set([
  'landing',
  'onboarding',
  'concept',
  'legal',
  'plans',
  'gift',
  'sign-in',
  'sign-up',
  'contact',
  'sitemap',
  'security',
  'meet-wobo',
  'for-parents',
  'for-students',
  'how-it-works',
  'subjects',
  'notfound',
  'ui-kit',
]);
const SHARED_SPRING = { type: 'spring', stiffness: 260, damping: 30 } as const;

function classifyTransition(
  prev: { name: string; depth: number } | null,
  name: string,
  depth: number,
): Dir {
  if (!prev) return 'none';
  if (OWN_VIEWPORT_ROUTES.has(name) || OWN_VIEWPORT_ROUTES.has(prev.name)) return 'none';
  if (SIBLING_ROUTES.has(name) && SIBLING_ROUTES.has(prev.name)) return 'sibling';
  return depth < prev.depth ? 'back' : 'forward';
}

const screenVariants = {
  enter: (d: Dir) =>
    d === 'sibling'
      ? { opacity: 0, y: 8, x: 0 }
      : d === 'back'
        ? { opacity: 0, x: -24, y: 0 }
        : d === 'forward'
          ? { opacity: 0, x: 24, y: 0 }
          : { opacity: 1, x: 0, y: 0 },
  center: (d: Dir) => ({
    opacity: 1,
    x: 0,
    y: 0,
    transition:
      d === 'sibling'
        ? { duration: 0.22, ease: [0.4, 0, 0.2, 1] }
        : d === 'none'
          ? { duration: 0.001 }
          : SHARED_SPRING,
  }),
  // A leaving screen takes no tap: for the length of its exit it sits over the new one at
  // opacity 0.x, and a finger that lands then lands on the old page. pointerEvents is set, not
  // tweened, by framer-motion, so it is off from the first exit frame.
  exit: (d: Dir) =>
    d === 'sibling'
      ? {
          opacity: 0,
          y: -8,
          pointerEvents: 'none' as const,
          transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] },
        }
      : d === 'back'
        ? {
            opacity: 0,
            x: 24,
            pointerEvents: 'none' as const,
            transition: { duration: 0.18, ease: [0.3, 0, 0.8, 0.4] },
          }
        : d === 'forward'
          ? {
              opacity: 0,
              x: -24,
              pointerEvents: 'none' as const,
              transition: { duration: 0.18, ease: [0.3, 0, 0.8, 0.4] },
            }
          : { opacity: 0, pointerEvents: 'none' as const, transition: { duration: 0.12 } },
} as const;

function Screen() {
  const { route, depth } = useRouter();
  const routeKey = JSON.stringify(route);
  // ONE KEY PER NAVIGATION, never per route. The key used to be the route alone, so a screen that
  // came straight back while its last instance was still leaving shared a key with it: the
  // download-first gate mounts Course, enqueues and bounces `back()` to Learn in the same tick, so
  // Learn's exiting instance and its new instance were one child to AnimatePresence, and neither
  // it nor the bouncing Course was ever removed. Measured 2026-09-08 (wave 29, learn-2): three
  // `.wk-shell`s at top:0 for as long as the page lived, the stale climb over 'Start the course'
  // taking the tap. A key minted per navigation makes every instance its own child, so every exit
  // finishes and the DOM under the new screen is the new screen alone.
  //
  // AND ONE DIRECTION PER NAVIGATION. The direction used to be classified on every render against
  // `prevRef`, which the effect below advances to the current route as soon as the navigation
  // commits, so the very next re-render (a bus message, a store event) re-classified the same
  // navigation as 'none' and handed both screens a different variant mid-flight. For the leaving
  // screen that re-resolved its exit while the first exit was still running, and the first one's
  // promise never settled, so AnimatePresence never heard the exit finish and never removed the
  // node: 'AP exit start' with no 'AP exit done' in the instrumented trace, the unit page still in
  // the DOM under Learn after a plain back. Classified once, when the key is minted, and held.
  const seq = useRef(0);
  const lastRouteKey = useRef<string | null>(null);
  const prevRef = useRef<{ name: string; depth: number } | null>(null);
  const dirRef = useRef<Dir>('none');
  if (routeKey !== lastRouteKey.current) {
    if (lastRouteKey.current !== null) seq.current += 1;
    lastRouteKey.current = routeKey;
    dirRef.current = classifyTransition(prevRef.current, route.name, depth);
  }
  const key = `${seq.current}:${routeKey}`;
  const dir = dirRef.current;
  // The single transition sound (MOTION.md §2) rides structural forward/back only — never a sibling
  // tab, never an own-viewport scene. Skip the first mount.
  const firstScreen = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the trigger, not a body dep
  useEffect(() => {
    prevRef.current = { name: route.name, depth };
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    if (dir === 'forward' || dir === 'back') sfx.whoosh();
  }, [key]);
  // Leaving a screen mid-stroke: the hold lets go on the spot and the ink that was about the old
  // page goes with it. Measured on 2026-09-05: for ~200 ms after a navigation the previous page's
  // ring was still drawing itself over the new page, with the page held.
  const { clearMarks } = useWoboBus();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the route is the trigger
  useEffect(() => {
    if (prevRef.current === null) return;
    scrollHold.releaseAll();
    clearMarks();
  }, [route.name]);
  return (
    <AnimatePresence mode="popLayout" initial={false} custom={dir}>
      <motion.div
        key={key}
        custom={dir}
        variants={screenVariants}
        initial="enter"
        animate="center"
        exit="exit"
        // width:100% keeps an EXITING screen full-bleed. mode="popLayout" pops the outgoing screen
        // out of flow (position:absolute); with no width it shrinks to its content — a course's
        // ~520px card — and re-anchors top-left, leaking as a stray card over the next screen's
        // header during the crossfade. Pinned to 100% it stays a full page sliding out. No-op in flow.
        style={{ willChange: 'transform, opacity', width: '100%' }}
      >
        <Suspense fallback={<ScreenPending />}>
          {route.name === 'onboarding' && <Onboarding />}
          {route.name === 'building' && <FrameBuilding />}
          {route.name === 'home' && <Home />}
          {route.name === 'chat' && <ChatScreen />}
          {route.name === 'learn' && <Learn />}
          {route.name === 'practice' && <Practice />}
          {route.name === 'subject' && (
            <SubjectScreen subjectId={route.subjectId} intent={route.intent} />
          )}
          {route.name === 'course' && <Course topicId={route.topicId} />}
          {route.name === 'sandbox' && <Course topicId={route.topicId ?? ''} sandbox />}
          {route.name === 'progress' && <ProgressScreen />}
          {route.name === 'you' && <You />}
          {route.name === 'doubt' && <DoubtScreen />}
          {route.name === 'parent' && <ParentView />}
          {route.name === 'concept' && route.which === 'engines' && <EnginesGallery />}
          {/* the public site's own addresses, from the one table both hosts share */}
          {publicScreen(route)}
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

function AppInner({ sdk }: { sdk: Sdk }) {
  const bus = useWoboBus();
  const router = useRouter();
  const { route } = router;
  const { xp, streakDays } = useProgress();
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState<WoboMood>('idle');
  // What the learner last pointed at. It rides the next turn's packet (set by the stage) and it is
  // what Wobo's eyes track, so "this" always means the same thing to both of them.
  const [focus, setFocus] = useState<FocusObject | null>(null);
  // Every real interaction anywhere counts as life, so Wobo's idle behaviour is honest rather than
  // timed against a screen Wobo cannot see input on.
  useLifeSignals();
  /**
   * Barge-in (docs/BOARD.md §4): a tap, a key or a word stops the pen and the voice on the same
   * beat. What is already drawn stays, and the object the nib was on rides the next turn so Wobo
   * picks up where Wobo was cut off rather than starting again.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const cut = () => {
      if (boardTurn.get().active) boardTurn.interrupt();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== ' ') return;
      // TYPING IS NOT AN INTERRUPT. The commonest thing a fourteen year old does while an answer is
      // still arriving is start typing the next question, and every space in it used to abort the
      // stream, lift the pen and stop the voice — the derivation simply ended, with nothing said
      // about why. The gesture layer solved this the same way for its own hotkey
      // (packages/wobo/src/gesture.tsx), and Escape in a field is a field's own key too.
      if (isTypingTarget(e.target)) return;
      cut();
    };
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener('pointerdown', cut, opts);
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', cut, opts);
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, []);
  // Offline resilience lives here in the shared chat layer, not in one screen — so every composer
  // (the home front door, the chat page, a suggestion chip) gets the same safe behavior: a message
  // typed with no connection is queued, shown as a pending bubble, and fired once on reconnect,
  // instead of hitting the network and falling into the generic "give me a moment" error.
  const { offline } = useConnectivity();
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  const [pending, setPending] = useState<{ id: string; text: string }[]>([]);
  // One conversation for life: the archive is the local source of truth; only its tail loads.
  const [boot] = useState(() => {
    let archive = readArchive();
    if (archive.length === 0) {
      // migrate the old tail-only thread cache into the archive, once
      const cached = sdk.state.loadThreadCache('wobo');
      if (cached && cached.turns.length > 0) {
        archive = cached.turns
          .filter((t) => t.id !== 'seed')
          .map((t, i) => ({ ...t, id: `t${i}-${t.role}` }));
        writeArchive(archive);
      }
    }
    const start = Math.max(0, archive.length - CHAT_PAGE);
    return { tail: archive.slice(start), start };
  });
  const [turns, setTurns] = useState<ChatTurn[]>(() =>
    boot.tail.length > 0
      ? boot.tail
      : [{ id: 'seed', role: 'wobo', text: 'Ask me anything. I can see the page you are on.' }],
  );
  const loadedStart = useRef(boot.start);
  const [hasOlder, setHasOlder] = useState(boot.start > 0);
  const loadOlder = () => {
    const from = Math.max(0, loadedStart.current - CHAT_PAGE);
    if (from === loadedStart.current) return;
    const older = readArchive().slice(from, loadedStart.current);
    loadedStart.current = from;
    setHasOlder(from > 0);
    setTurns((prev) => [...older, ...prev]);
  };
  // Cross-device: learner_threads reconciles in (live mode) only when this device has nothing.
  const emptyAtBoot = useRef(boot.tail.length === 0);
  useEffect(() => {
    let cancelled = false;
    sdk.state.hydrateThread('wobo').then((snapshot) => {
      if (cancelled || !snapshot || !emptyAtBoot.current || snapshot.turns.length === 0) return;
      const migrated = snapshot.turns
        .filter((t) => t.id !== 'seed')
        .map((t, i) => ({ ...t, id: `t${i}-${t.role}` }));
      writeArchive(migrated);
      loadedStart.current = Math.max(0, migrated.length - CHAT_PAGE);
      setHasOlder(loadedStart.current > 0);
      setTurns(migrated.slice(loadedStart.current));
    });
    return () => {
      cancelled = true;
    };
  }, [sdk]);
  // Who the brain says this learner is: the plan they are on and the consent tier IT derived. The
  // client never decides either — it asks once, and every context packet after that repeats the
  // answer, so Wobo never offers past the door the brain opened (WOBO-PLAN §5.3). A keyless build
  // has no meter to read and `me()` answers null, which is carried as honestly as any other answer.
  //
  // NOT ON THE PUBLIC FRONT DOOR. The landing page is a marketing page: nothing on it reads a plan,
  // a consent tier or a budget, and a visitor who has never opened the product should not have
  // their account metered by arriving. Asked there anyway, it was a request to the production
  // gateway on every first load — visible locally only because it CORS-failed. The ask is deferred
  // to the moment someone walks through the door, which is exactly when the answer is first used.
  const onFrontDoor = route.name === 'landing';
  useEffect(() => {
    if (onFrontDoor) return;
    let cancelled = false;
    void sdk
      .me()
      .then((me) => {
        if (!cancelled) noteAccount(me);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sdk, onFrontDoor]);
  // Save only after the conversation actually moves — re-stamping the boot snapshot "now" would
  // out-fresh an older-but-richer transcript from another device during reconciliation.
  const bootTurns = useRef(true);
  useEffect(() => {
    if (bootTurns.current) {
      bootTurns.current = false;
      return;
    }
    sdk.state.saveThread('wobo', turns.slice(-60));
  }, [sdk, turns]);

  // One line into the one conversation. Hoisted out of `ask` so the board turn writes into exactly
  // the same archive — a turn Wobo drew is a turn Wobo had, and the transcript must not fork.
  const say = (t: Omit<ChatTurn, 'id'>) => {
    const turn = { ...t, id: mintTurnId() };
    appendToArchive(turn);
    setTurns((prev) => [...prev, turn]);
    if (t.role === 'wobo') sfx.chime(); // a gentle chime as Wobo arrives
    return turn;
  };

  /** Wobo's line grows as the plan streams: the written words keep up with the spoken ones. */
  const growTurn = (id: string, text: string) => {
    const grow = (t: ChatTurn): ChatTurn =>
      t.id === id ? { ...t, text: t.text ? `${t.text} ${text}` : text } : t;
    setTurns((prev) => prev.map(grow));
    updateArchiveTurn(id, grow);
  };

  /** Where the plane slides from — Wobo's docked orb, bottom right. */
  const orbOrigin = () =>
    typeof window === 'undefined'
      ? { x: 0, y: 0 }
      : { x: window.innerWidth - 56, y: window.innerHeight - 60 };

  /**
   * A board turn (docs/BOARD.md §4): the same capability, the same door, the same meter — the only
   * difference is that the answer has a shape, so the plan streams and Wobo's hand draws it while Wobo
   * speaks. Wobo writes into the one conversation as Wobo goes, so the transcript reads as one voice.
   */
  const askBoard = async (
    text: string,
    shape: ReturnType<typeof boardShapeOf>,
    context: ReturnType<typeof bus.assembleContext>,
    /** The rung of the assistance ladder this turn is on — the one thing the screen cannot report. */
    mode?: string,
    /**
     * A doubt from a photo (screens/doubt): the confirmed reading and the regions the brain found,
     * riding beside the packet so the ink can anchor to the photo's registered regions.
     */
    doubt?: AskOptions['doubt'],
  ) => {
    const line = say({ role: 'wobo', text: '' });
    const title = doubt
      ? 'your doubt'
      : (context.curriculum?.nodeName ?? (context.page.state.title as string | undefined));
    if (doubt) doubtCaption.begin();
    try {
      const outcome = await boardTurn.run({
        gatewayUrl: GATEWAY_URL as string,
        // The whole envelope, not its inside: the gateway reads the learner's words at
        // `payload.context.turn.lastUserInput` — both to plan the board and, before that, to
        // run the inbound safety screen. Unwrapping it here handed the brain an empty turn,
        // so a board turn planned nothing and was screened against nothing.
        payload: boardTurnPayload(context, mode ? { task: { mode } } : {}),
        // The doubt's answer streams the same frames from its own door, with the learner's
        // corrections as the body (services/gateway doubt.py composes the packet from the photo).
        ...(doubt
          ? { endpoint: doubtAnswerPath(doubt.id), body: answerBody(doubt.lines, doubt.words) }
          : {}),
        route: route.name,
        ...(shape.override ? { override: shape.override } : {}),
        origin: orbOrigin(),
        ...(title ? { title } : {}),
        onSay: (said, t, dur) => {
          growTurn(line.id, said);
          // The doubt screen prints the caption sentence by sentence ON THE BEAT (law 5 for the
          // sound-off learner), so it takes the say frame with its time, not the joined text.
          if (doubt) doubtCaption.say(said, t ?? 0, dur);
        },
        onAsk: (prompt) => growTurn(line.id, prompt),
        onAction: (action) => bus.dispatch(parseActions([action])),
        onCard: (card) => {
          const extras = resolveTurnExtras(
            card as Record<string, unknown>,
            text,
            context.curriculum?.nodeName,
          );
          if (extras.path === 'inline') return;
          const attach = (t: ChatTurn): ChatTurn => (t.id === line.id ? { ...t, extras } : t);
          setTurns((prev) => prev.map(attach));
          updateArchiveTurn(line.id, attach);
        },
      });
      // Nothing came back with a shape after all — Wobo still owes the learner an answer. Unless
      // the learner cut Wobo off: BOARD.md §4 says the pen lifts and the voice stops, and a line
      // Wobo never asked for is not silence, it is Wobo talking over their own interruption.
      if (outcome.completed && !outcome.said.trim() && outcome.objects === 0) {
        growTurn(line.id, 'Let us look at this together.');
      }
      sdk.events.record('wobo.turn.assistant.v1', {
        turn_id: crypto.randomUUID(),
        assistance_level: 'coach',
        hint_level: 0,
        grounded: outcome.objects > 0,
        track: 'track_2',
        handed_answer: false,
      });
      setMood(outcome.objects > 0 ? 'explaining' : 'idle');
    } catch (err) {
      const refusal = refusalLine(err);
      // An empty line is a barge-in: Wobo stops where Wobo is and says nothing about it.
      if (refusal.text) growTurn(line.id, refusal.text);
      if (refusal.signIn && sdk.account) {
        window.setTimeout(() => router.navigate({ name: 'onboarding' }), 900);
      }
      setMood('idle');
    } finally {
      if (doubt) doubtCaption.end();
      setBusy(false);
    }
  };

  // A real Wobo turn: Wobo reasons over the page Wobo is plugged into, then speaks and acts on it.
  const ask = async (text: string, options: AskOptions = {}) => {
    // No connection — hold it rather than dropping it on the floor. It renders as a pending bubble
    // on the chat page and the reconnect effect below drains the queue once, in order. A silent ask
    // is Wobo's own question and has no bubble to hold: it is dropped, and the surface that raised
    // it has already said its line to the learner.
    if (offlineRef.current) {
      if (!options.silent) setPending((q) => [...q, { id: crypto.randomUUID(), text }]);
      return;
    }
    // A silent ask still rides the same context window, because the model has to see what it is
    // answering — it simply never becomes a learner bubble in the archive (wobo/chat.tsx).
    const userTurn = options.silent
      ? { id: mintTurnId(), role: 'user' as const, text }
      : say({ role: 'user', text });
    setBusy(true);
    setMood('thinking');
    // Optimistic ink: Wobo reacts in <100ms with a point at the thing the learner's words are
    // about, before the model returns. Only that thing (wobo/looking.ts): ringing the first target
    // on the screen for every turn put a ring round the download toast for "hello", and held the
    // page for it. The real actions replace this the moment they land.
    const looking = lookingAt(text, surfaceRegistry);
    if (looking) bus.dispatch([{ type: 'point', targetId: looking, ttl: 2200 }]);
    // Wobo remembers what matters, not the transcript: a short recent window, with Wobo's own long
    // explanations clipped — the archive is for the learner to scroll, never re-fed to the model.
    const recent = [...turns.slice(-7), userTurn].map((t) => ({
      role: t.role,
      text:
        t.role === 'wobo' && t.text.length > 220
          ? `${t.text.slice(0, 220)}…`
          : t.text.slice(0, 600),
    }));
    // The clock rides the context (WOBO-CAPABILITIES.md family O): a human-readable local
    // wall-clock so wellbeing turns — late-night on a school night, "I'm exhausted" — reason about
    // the real time, not a guess. Weekday + time is all Wobo needs to sanction rest.
    const now = new Date();
    const localTime = now.toLocaleString(undefined, {
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
    });
    bus.publishTurn({ recentTurns: recent, lastUserInput: text, localTime });
    // What the learner has actually been doing — the last few backbone events, compacted. Carries
    // Wobo's interaction history into the assembled context so Wobo grounds in real activity, not just
    // the static page (context-bus SessionContext.recentEvents; rendered by the gateway).
    const recentEvents = sdk.events
      .getLog()
      .slice(-6)
      .map((e) => {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const tail =
          p.correct !== undefined
            ? ` (correct=${p.correct})`
            : typeof p.assistance_level === 'string'
              ? ` (${p.assistance_level})`
              : '';
        return `${e.event_type.replace(/\.v1$/, '')}${tail}`;
      });
    // The first turn a learner ever takes with Wobo. Wobo introduced themself during setup, so the
    // gateway greets by name here and never re-introduces (owner law: one introduction, ever).
    // Keyed to THIS learner (store/scope.ts): a sibling on the same phone gets their own
    // introduction, and this one's is not repeated. A refused write means Wobo is warm twice at
    // worst, never a second introduction.
    const firstMeeting = !scoped.getItem(MET_TURN_KEY);
    if (firstMeeting) scoped.setItem(MET_TURN_KEY, '1');
    bus.publishSession({ sessionId: 'dev-session', recentEvents, firstMeeting });
    // The machine room (WOBO-CAPABILITIES.md family J — the total-context law): the system's live
    // internal truth for this turn — the mastery-band snapshot, the FSRS due queue, XP/level/streak,
    // the event-stream tail, and any in-flight generation. The selector digests it; the gateway
    // renders it compactly so Wobo references it naturally ("3 reviews due", "how far to level 5").
    let bands: { band: string }[] = [];
    try {
      bands = await sdk.kgtopg.mastery.getBands(sdk.subjectId);
    } catch {
      // the mastery view is unavailable — the rest of the machine room still rides
    }
    bus.publishMachine(
      machineRoomSnapshot({
        bands,
        eventLog: sdk.events.getLog(),
        xp,
        streakDays,
        nowMs: Date.now(),
      }),
    );
    try {
      const context = bus.assembleContext();
      // A doubt from a photo always streams (the ink has to land on the photo inside the
      // sentences about it), carries the confirmed reading beside the packet, and skips every
      // shortcut below: it is never a navigation, a "show me", or a wipe. Keyless, there is
      // nobody to read the page, and the screen has already said so.
      if (options.doubt) {
        if (!GATEWAY_URL) {
          say({ role: 'wobo', text: 'I need to be connected to read a photo.' });
          setMood('idle');
          setBusy(false);
          return;
        }
        await askBoard(text, { board: true }, context, 'explain_this', options.doubt);
        return;
      }
      // The learner's word about the surface is obeyed before anything is asked of the brain:
      // "close the board" is not a question, and "fresh board" has to be true before Wobo draws.
      const mode = modeFromText(text);
      const hasFocus = turnFocus() !== null;
      const shape = boardShapeOf(text, {
        hasFocus,
        // Whether the mode can draw on THIS turn is the mode's own to answer (wobo/modes.ts): a
        // mode that needs something in hand cannot draw without it, and `quiz_me` needs nothing.
        modeDraws: modeDraws(mode, hasFocus),
        // A question about a thing on this screen is answered on it, in place.
        namesTarget: looking !== null,
        // The screen said it would draw (onboarding step three); keep the promise.
        draw: options.draw === true,
      });
      // ONLY THE LEARNER'S OWN WORD MOVES THE BOARD. A silent ask is Wobo's own sentence — the
      // re-teach ladder asking for a second explanation on the learner's behalf — and the learner
      // never typed it and never sees it (wobo/chat.tsx `AskOptions.silent`). Read as a surface
      // word it would move the board, wipe it, or put it away with nothing on screen to explain
      // why: Wobo obeying an instruction nobody gave. The words still make the turn a DRAWING
      // turn; where the ink lands goes back to the ink.
      const word = options.silent ? undefined : shape.word;
      // The same rule for the override the board call reads (`askBoard` sends `shape.override`).
      const turnShape = options.silent ? { ...shape, word: undefined, override: undefined } : shape;
      if (word?.dismiss) {
        // `plane.dismiss()` alone was wrong twice over: it returns early on a pinned board, and
        // inside a lesson the ink is on the lesson's own full board, which the plane controller
        // cannot reach at all. Either way Wobo said "Put away." over a board that had not moved.
        const went = dismissBoard();
        say({
          role: 'wobo',
          text: went
            ? 'Put away. Say the word and it comes back with your ink on it.'
            : 'There is no board out at the moment. Ask me to draw and one will come.',
        });
        setMood('idle');
        return;
      }
      if (word?.wipe) {
        const wiped = boardTurn.wipe();
        say({
          role: 'wobo',
          text: wiped > 0 ? 'Wiped. Clean board.' : 'The board is already clean.',
        });
        setMood('idle');
        return;
      }
      if (word?.fresh) plane.fresh(orbOrigin());

      // The hands (WOBO-PLAN §3). "Show me" is not a description: a visible cursor glides to the
      // real control on the real screen and taps it, resolved through the registry so it works on
      // every registered surface and fails honestly where a control is not there. It needs no model
      // at all, which is why it works with no gateway and no key.
      const armed = armedAction();
      if (armed && isConfirmation(text)) {
        disarm();
        const result = await showMe(armed.targetId);
        say({ role: 'wobo', text: result.ok ? `Done: ${armed.label}.` : result.say });
        setMood('idle');
        return;
      }
      if (armed && isDecline(text)) {
        disarm();
        say({ role: 'wobo', text: 'Left alone. It is yours to press when you want it.' });
        setMood('idle');
        return;
      }
      if (mode === 'show_me' || mode === 'do_it') {
        const inHand = turnFocus();
        const named = text.replace(/\b(show me|do it|for me|please|where is|how to)\b/gi, ' ');
        const targetId = inHand?.targetIds[0] ?? findTargetId(named);
        const target = targetId ? surfaceRegistry.getTarget(targetId) : undefined;
        if (target) {
          // The permission ladder: anything that communicates, buys, submits or deletes asks
          // first, whatever the model thought. "Show me" only ever points, it never presses.
          if (mode === 'show_me') {
            const result = await showMe(target.id, { tap: false });
            say({ role: 'wobo', text: result.say });
            setMood('idle');
            return;
          }
          if (runsWithoutAsking(target.label)) {
            const result = await showMe(target.id);
            say({ role: 'wobo', text: result.say });
            setMood('idle');
            return;
          }
          armDoIt(target.id, target.label);
          say({
            role: 'wobo',
            text: `I can do that: ${target.label}. Say go ahead and I will.`,
          });
          setMood('idle');
          return;
        }
      }
      // The board turn streams; the ordinary turn does not. One capability either way, one meter,
      // and the header is the only thing that chooses (docs/BOARD.md §4). Keyless builds never
      // stream, so the deterministic path below keeps every mode working with no gateway at all.
      if (shape.board && GATEWAY_URL) {
        await askBoard(text, turnShape, context, mode ?? undefined);
        return;
      }
      // Navigation on command (WOBO.md §10) — the one nav path, shared by the chat page and the
      // drawer. Any phrasing that resolves to a place navigates directly: no approval card, a
      // spoken + inked confirmation (SpeechNarrator voices Wobo's line), and never silence on a clear
      // miss. It runs on the raw text and needs no model at all, so it is resolved BEFORE the
      // gateway round-trip: "take me to practice" used to cost a full turn (and a token spend, and
      // seconds on a 2G link) to reach an answer this function already had.
      const nav = resolveDestination(text);
      if (nav) {
        say({ role: 'wobo', text: 'route' in nav ? nav.say : nav.unknown });
        sdk.events.record('wobo.turn.assistant.v1', {
          turn_id: crypto.randomUUID(),
          assistance_level: 'coach',
          hint_level: 0,
          grounded: false, // resolved on device, from the route table — no model grounding involved
          track: 'track_2',
          handed_answer: false,
        });
        if ('route' in nav) {
          setMood('explaining');
          window.setTimeout(() => router.navigate(nav.route), 650);
        } else {
          setMood('idle');
        }
        return;
      }

      // The rung Wobo is on rides the packet's task state; the beat, the attempt and the score come
      // off the screen itself (`taskFrom`), so the brain always knows where in the work this is.
      const onRung = mode ? { task: { mode } } : {};
      const result = await sdk.llm.invoke('wobo.turn', woboTurnPayload(context, onRung), {
        consentTier: 'un_elevated',
      });
      const output = result.output as {
        say?: string;
        actions?: unknown[];
        grounded?: boolean;
        safety?: { flagged?: boolean; category?: string; severity?: string; action?: string };
      };
      // The gateway's child-safety pass flagged this turn — record it on the event backbone.
      // `escalated_to: 'guardian'` used to ride along on every crisis. Nothing anywhere read it:
      // no mail, no job, no queue, no review surface. It said the product tells a parent, and the
      // product does not. Whether it ever should is the owner's call and a legal one; until it is
      // made and built, this records what actually happened and claims nothing else. A crisis is
      // 'logged' because that is all that happens to it — the child is answered with support, and
      // the flag is written here.
      if (output.safety?.flagged) {
        const s = output.safety;
        sdk.events.record('safety.flag.raised.v1', {
          surface: 'wobo_chat',
          category: s.category === 'crisis' ? 'crisis' : 'moderation',
          severity: s.severity === 'low' || s.severity === 'high' ? s.severity : 'medium',
          action: s.category === 'crisis' ? 'logged' : 'blocked',
        });
      }
      const actions = parseActions(output.actions ?? []);
      // Data rights (WOBO-CAPABILITIES.md family E, the forget verb): show or purge Wobo's memory,
      // grounded in the real on-device dossier — never the model's guess. Deleting is honest: Wobo
      // reports exactly what left (or that there was nothing), so no fake confirmation ever lands.
      // The forget action is destructive; the gateway prompt gates it (confirm-before-execute) so
      // Wobo only emits a delete after the learner says yes.
      const forgets = actions.filter((a) => a.type === 'forget');
      if (forgets.length > 0) {
        for (const a of forgets) {
          if (a.type !== 'forget') continue; // narrow the discriminated union
          if (a.scope === 'show') {
            const lines = mindLines(loadMind());
            say({
              role: 'wobo',
              text:
                lines.length > 0
                  ? `Here is everything I am keeping about you:\n${lines
                      .map((l) => `· ${l}`)
                      .join('\n')}\n\nSay the word and I will forget any of it.`
                  : 'I have not saved anything about you yet. Tell me what matters and I will keep it.',
            });
          } else if (a.scope === 'all') {
            // The whole memory is not something a model reply gets to take. Wobo offers the wipe as
            // an approval card in the thread (approve / not now); clearMind runs inside the
            // capability, on the learner's tap alone — and nothing is erased if they walk away.
            say({
              role: 'wobo',
              text: 'I can let go of everything I know about you. That cannot be undone, so tell me to go ahead and I will.',
              extras: { path: 'action', action: forgetAllOffer(crypto.randomUUID()) },
            });
          } else {
            // Answered against the record, so a fact told on another device is found too; the
            // device's copy only answers when the record cannot be asked (store/mind.ts).
            const removed = await forgetMatching(a.target ?? '');
            bus.publishLifetime(lifetimeSnapshot());
            say({
              role: 'wobo',
              text:
                removed.length > 0
                  ? `Forgotten. I let go of “${removed.join('”, “')}”.`
                  : 'I could not find that in what I remember, so there is nothing to forget there.',
            });
          }
        }
      }
      let spokenTurnId: string | undefined;
      if (forgets.length === 0) {
        // The five-path orchestrator (WOBO.md §6): the gateway's classification wins; unclassified
        // turns fall to the deterministic keyword classifier so every mode works keyless.
        const extras = resolveTurnExtras(
          output as Record<string, unknown>,
          text,
          context.curriculum?.nodeName,
        );
        spokenTurnId = say({
          role: 'wobo',
          text: output.say ?? 'Let us look at this together.',
          ...(extras.path !== 'inline' ? { extras } : {}),
        }).id;
        // the route path: Wobo walks you there, docked — after Wobo's line lands
        if (extras.route) {
          const dest = NAV_ROUTES[extras.route.to];
          if (dest) window.setTimeout(() => router.navigate(dest), 650);
        }
      }
      // Wobo's turn on the event backbone — attributed, grounded, accountable
      sdk.events.record('wobo.turn.assistant.v1', {
        turn_id: crypto.randomUUID(),
        assistance_level: 'coach',
        hint_level: 0,
        grounded: Boolean(output.grounded),
        track: result.track,
        handed_answer: false,
      });
      // THE ACTION TIMELINE: anchored ink rides Wobo's speech beats (the conductor plays it as Wobo
      // speaks the line just said); the rest dispatches at once for an instant reaction. A turn
      // with no anchors keeps the original all-at-once behavior.
      const anchored = actions.filter(hasSyncAnchor);
      const immediate = actions.filter((a) => !hasSyncAnchor(a));
      // What kind of line this is (voice.md 10b): the crisis line, the mood the tutor set, or a
      // step. Read off the tutor's own output here and told to the voice; never guessed from words.
      if (spokenTurnId) {
        registerPerformance(spokenTurnId, anchored, beatOfTurn(actions, output.safety));
      }
      bus.dispatch(immediate);
      setMood(actions.length > 0 ? 'explaining' : 'idle');
    } catch (err) {
      // The brain's refusals reach the learner as Wobo's line, never a status code and never a
      // provider's words: sign-in needed takes them to Wobo's sign-in beat (where the beat lives); a
      // spent day says when Wobo is free again. Anything else is the honest "give me a moment".
      const refusal = refusalLine(err);
      // An empty line is a barge-in, not a refusal: Wobo stops and says nothing about it.
      if (refusal.text) say({ role: 'wobo', text: refusal.text });
      if (refusal.signIn && sdk.account) {
        window.setTimeout(() => router.navigate({ name: 'onboarding' }), 900);
      }
      setMood('idle');
    } finally {
      setBusy(false);
    }
  };

  // Reconnect: drain the offline queue once, in order. askRef keeps us off the latest closure so
  // this effect doesn't re-run on every turn that lands.
  const askRef = useRef(ask);
  askRef.current = ask;
  // A question typed into a public page's ask box (a pitch page, a help article) was parked while
  // this runtime was still downloading. It is taken exactly once, here, and asked by the real
  // engine — the visitor's words are never lost in the handover and never asked twice.
  useEffect(() => {
    const handed = takeHandedQuestion();
    if (handed) void askRef.current(handed);
  }, []);
  useEffect(() => {
    if (offline || pending.length === 0) return;
    const queued = pending;
    setPending([]);
    void (async () => {
      for (const q of queued) await askRef.current(q.text);
    })();
  }, [offline, pending]);

  // Approval outcomes and action results patch the turn wherever it is rendered — and the archive,
  // so a decided card never re-offers after reload.
  const updateTurn = (id: string, patch: (extras: TurnExtras) => TurnExtras) => {
    const apply = (t: ChatTurn): ChatTurn =>
      t.id === id && t.extras ? { ...t, extras: patch(t.extras) } : t;
    setTurns((prev) => prev.map(apply));
    updateArchiveTurn(id, apply);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: ask is recreated with turns; tracking turns/busy/mood covers it
  const chat = useMemo(
    () => ({
      turns,
      ask,
      busy,
      mood,
      setMood,
      hasOlder,
      loadOlder,
      updateTurn,
      offline,
      pending,
      focus,
    }),
    [turns, busy, mood, hasOlder, offline, pending, focus],
  );

  // The first authenticated boot after the sign-in beat: record the subject's creation, fully
  // attributed to the real auth.uid() through the live outbox.
  useEffect(() => {
    if (!sdk.identity.isAuthenticated()) return;
    const source = takeSignInSource();
    if (!source) return;
    sdk.events.record('identity.subject.created.v1', {
      // a provider sign-in is a linked identity, whichever provider it was
      source: source === 'google' || source === 'apple' ? 'linked' : 'phone_otp',
      age_branch: 'unknown',
      consent_tier_initial: 'un_elevated',
    });
  }, [sdk]);

  // A signed-in account (optional, additive) folds its identity into the local profile and syncs the
  // profile row — name/email/avatar fill only gaps, the local copy stays the working truth. Runs on
  // every boot, so it completes a Google round-trip started from onboarding OR from You.
  useEffect(() => {
    const acct = sdk.account?.profile();
    if (!acct) return;
    mergeAccount(acct);
    // Don't push local→remote until this device has completed onboarding — otherwise a fresh-device
    // sign-in would overwrite the account's saved world with the seed fallback before the returning
    // learner's flow restores it. Onboarding writes the authoritative row on completion.
    if (!scoped.getItem(ONBOARDED_KEY)) return;
    const p = loadProfile();
    void sdk.account?.syncProfile({
      display_name: p.name,
      grade: p.grade,
      board: boardName(p.boardId),
      // The account says setup is done. Onboarding's restore reads exactly this slot, and nothing
      // wrote it before, so a learner signing back in (sign-out now empties the device) was sent
      // through setup again instead of home.
      archetype_slot: 'onboarded',
    });
  }, [sdk]);

  // The guard: unauthenticated in live mode always lands on onboarding — the sign-in beat lives
  // there, in Wobo's flow. No route (palette, Wobo nav) can walk around it.
  const locked = !sdk.config.devAuth && !sdk.identity.isAuthenticated();
  // The lock's ADDRESS. App.tsx picks the first route without the identity layer (it is not loaded
  // on a public page), so a started-but-signed-out boot lands on `home` and the lock above shows
  // onboarding over it. The bar is corrected here, once, to the address the sign-in beat lives at
  // — nothing re-renders, because onboarding is already what is on screen.
  const bootAddress = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the boot address is corrected once, on mount
  useEffect(() => {
    if (bootAddress.current) return;
    bootAddress.current = true;
    if (locked && route.name === 'home') {
      router.replace({ name: 'onboarding' });
      return;
    }
    // The mirror case: signed in for real, on a device that holds nothing of theirs (sign-out
    // empties it, docs/ONE-LEARNER-ONE-WOBO.md; or this is a new phone). Setup is the one screen
    // that reads the account back (`resumeAfterAuth`), and an account that has finished setup goes
    // straight home from there, so the boot goes through it rather than showing an empty home.
    const account = sdk.account;
    if (
      route.name === 'home' &&
      account?.isAuthenticated() &&
      !account.isAnonymous() &&
      !scoped.getItem(ONBOARDED_KEY)
    ) {
      router.replace({ name: 'onboarding' });
    }
  }, []);

  // Onboarding, the frame-building theatre, and design concepts render standalone — no app chrome
  // over them, they own the whole canvas.
  const inFlow =
    locked ||
    route.name === 'landing' ||
    route.name === 'onboarding' ||
    route.name === 'building' ||
    isPublicSite(route.name) ||
    route.name === 'concept';
  const onHome = route.name === 'home';
  /**
   * The learner moved one of Wobo's controls (docs/BOARD.md §8). The handle follows the finger at
   * once and the dependants are recomputed BY THE BRAIN — the hand never invents the new numbers.
   * Without a gateway there is nobody to ask, so the handle still moves and the board honestly
   * keeps the numbers it already had.
   */
  const onVariableChange = (
    variable: string,
    value: number | boolean | string | [number, number],
  ) => {
    if (!GATEWAY_URL) return;
    const store = boardTurn.boardStore();
    void changeVariable(
      store,
      { variable, value },
      gatewayBrain({
        gatewayUrl: GATEWAY_URL,
        payload: boardTurnPayload(bus.assembleContext()),
        board: boardTurn.boardContext(route.name),
      }),
    );
  };
  // What a saved or shared board is called: the topic Wobo is on, or the lesson Wobo is inside.
  const boardTitle = isLessonRoute(route.name)
    ? (bus.assembleContext().curriculum.nodeName ?? undefined)
    : undefined;

  return (
    <WoboChatProvider value={chat}>
      {/* The state family lives here, wrapping the screen slot: a render that throws takes its own
          subtree down instead of the app, and the page that explains it (offline, a spent day,
          planned work, an expired link) covers everything, wordmark and all. */}
      <StateLayer>
        {locked &&
        route.name !== 'onboarding' &&
        route.name !== 'landing' &&
        !isPublicSite(route.name) ? (
          <Suspense fallback={<ScreenPending />}>
            <Onboarding />
          </Suspense>
        ) : (
          <Screen />
        )}
      </StateLayer>
      {/* Wobo's ink over the current screen — annotations anchored to real elements. */}
      <WoboOverlay />
      {/* The nervous system above the app: the gesture sense, Wobo's ink on the screen, the plane, the
          full board a lesson becomes, the cursor Wobo shows things with. Wobo's own full-screen flows
          (onboarding, the frame theatre, a design concept) keep the stage but not the gestures —
          Wobo is teaching there, not being pointed at. */}
      <WoboStage
        route={route.name}
        {...(boardTitle ? { title: boardTitle } : {})}
        gestures={!inFlow}
        onFocus={setFocus}
        onAsk={(f) => void ask(modePrompt('explain_this', f?.text))}
        // Hold-to-talk on the desktop hotkey opens the SAME microphone the orb's hold does
        // (WOBO-TASKS §5.9). The face alone was the whole of it before, so every keyboard hold was
        // a pantomime: Wobo looked like Wobo was listening and no session ever opened.
        onHoldStart={() => {
          setMood('listening');
          holdToTalkStart();
        }}
        onHoldEnd={() => {
          holdToTalkEnd();
          setMood('idle');
        }}
        // A bound control moved on a board: the brain recomputes everything that depends on that
        // variable and redraws it in place (docs/BOARD.md §8).
        onVariableChange={onVariableChange}
      />
      {!inFlow && <AppHeader />}
      {/* the chat page IS Wobo — no docked twin over it */}
      {!inFlow && !onHome && route.name !== 'chat' && <WoboCompanion />}
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
      {/* the award ceremony for a milestone crossing — blur, descend, confetti, fanfare, Wobo's jump */}
      <CeremonyHost />
      <ClickInk />
      {/* the per-learner mind — folds behavioural signals into Wobo's lifetime context */}
      <MindObserver />
      {/* Wobo speaks what Wobo writes — sound and ink on the same beat */}
      <SpeechNarrator />
      {/* the course-download queue: composes ungened courses one at a time, notifies on ready */}
      <Suspense fallback={null}>
        <DownloadCenter />
      </Suspense>
      {/* dev only, at #board-bench: the hand playing one golden plan, with no brain and no network */}
      <BoardBenchGate />
    </WoboChatProvider>
  );
}

function WithWobo({ sdk }: { sdk: Sdk }) {
  const router = useRouter();
  const handlers = useMemo<WoboHandlers>(
    () => ({
      navigate: (route: string) => {
        const r = NAV_ROUTES[route];
        if (r) router.navigate(r);
      },
      startPractice: () => router.navigate({ name: 'practice' }),
      switchModality: () => {},
      // Wobo's 'speak' action plays aloud through the TTS path (mute-respecting); the drawer
      // still shows the written line either way
      onSpeak: (text: string) => void speakLine(text),
      // Wobo writes a durable fact to the learner's mind; MindObserver folds it into the next
      // lifetime pulse (~4s) and every reload thereafter carries it in the dossier
      onRemember: (text: string) => rememberFact(text),
    }),
    [router],
  );
  return (
    <WoboProvider handlers={handlers}>
      <AppInner sdk={sdk} />
    </WoboProvider>
  );
}

/**
 * The runtime's root: the one SDK, the learner's progress, Wobo's motion preference, and the app.
 * The router is above this (App.tsx owns it), so the address survives the swap from the public
 * site to here without a second history entry.
 */
export function AppRuntime() {
  const sdk = appSdk();

  // Every learner is somebody to the brain, from the first screen: with Supabase keys and no
  // session, sign in anonymously so the very first turn carries a real identity (a small day's
  // budget, no elevated doors) — this is what lets Wobo teach before anyone signs up. Keyless
  // builds skip it entirely and stay local.
  //
  // It lives HERE, not in App.tsx, and that is the point: a visitor reading the landing page or a
  // parent reading /security must not have a Supabase session minted for them, and the brain must
  // not be asked who they are. Nobody is signed into anything until they walk through the door.
  useEffect(() => {
    const account = sdk.account;
    if (!account || account.isAuthenticated()) return;
    void account.ensureSession().then((subject) => {
      if (subject) applyScope(subject, account.isAnonymous());
    });
  }, [sdk]);

  return (
    <MotionPrefConfig>
      <SdkProvider value={sdk}>
        <ProgressProvider>
          <MasteryProvider>
            <WithWobo sdk={sdk} />
          </MasteryProvider>
        </ProgressProvider>
      </SdkProvider>
    </MotionPrefConfig>
  );
}
