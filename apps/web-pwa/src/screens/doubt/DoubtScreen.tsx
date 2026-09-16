'use client';

/**
 * THE DOUBT SOLVER (owner, 2026-09-05): "when the students are using their phones or computers
 * or tabs, they can upload or take a photo of their book or whatever they have a doubt about and
 * wobo can annotate on that and explain as well."
 *
 * The screen moves in the order flow.ts allows and no other:
 *
 *   capture     the camera (a phone), the picker and the drop zone (a laptop);
 *   reading     the gateway reads the page (`POST /v1/doubt`) — the one place the product uses
 *               vision, screened on the way in;
 *   confirm     LAW 1: "I read this as ..." with every line editable in place and the line it came
 *               from lit on the photo. Nothing is computed until the learner says Explain;
 *   explaining  LAW 5: the answer rides the ordinary board turn over the SAME SSE wire, from
 *               `POST /v1/doubt/{id}/answer` with the corrections as the body; each ink frame lands
 *               on its line inside the sentence about it (wobo/Stage.tsx paints `screenStore` over
 *               the photo through the registry — PhotoStage registers the lines under the gateway's
 *               own ids). The board opens only if the answer builds something the page does not
 *               show (the conductor's own rule). Scroll holds during a stroke and releases;
 *   placing     LAW 4: the doubt joins the climb on the device (climb.ts) as the gateway files it
 *               in the syllabus on its side, and is listed on the memory page with a remove that
 *               reaches the server (doubt-store.ts).
 *
 * Taps from "I have a doubt" to the first line of explanation, on a phone: the camera button (1),
 * then Explain (2). The OS camera's own shutter and "Use photo" sit between them and are not ours.
 */

import { createFocus, EMPTY_RECT, surfaceRegistry, WaitScene } from '@wobo/wobo';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useWorld } from '../../curriculum/hooks';
import { loadedTopics } from '../../curriculum/registry';
import { warmFromCache } from '../../curriculum/warm';
import { AppFrame } from '../../shell/AppFrame';
import { useRouter } from '../../shell/router';
import { GATEWAY_URL } from '../../store/app-sdk';
import { useProgress } from '../../store/progress';
import { useSdk } from '../../store/sdk';
import { Button, Chip, Tag, TopBar, usePhone } from '../../ui/primitives';
import { screenStore } from '../../wobo/board-turn';
import { setTurnFocus, turnFocus } from '../../wobo/capabilities';
import { useWoboChat } from '../../wobo/chat';
import { doubtSurfaceId, type Rotation, readingLine, strokeHold } from '../../wobo/doubt-surface';
import {
  type Capture,
  DoubtUnreadable,
  gatewayPost,
  MAX_LINE_CHARS,
  readDoubt,
  readingText,
} from './api';
import { doubtCaption } from './caption';
import { acceptsFile, CaptureRefused, captureFromFile, sharedCapture } from './capture';
import {
  comeBackFor,
  type DoubtHint,
  joinClimb,
  resolveDoubtTopic,
  suggestTopics,
  topicForDoubt,
} from './climb';
import { CameraIcon, DOUBT_ENTRY_LABEL, DOUBT_SIGN_IN_LINE } from './DoubtEntry';
import { saveDoubt, takeCapture } from './doubt-store';
import {
  doorFor,
  doubtPacket,
  explainAllowed,
  explainPrompt,
  initialFlow,
  liveLines,
  liveRegions,
  reduce,
  shared,
} from './flow';
import { PhotoStage } from './PhotoStage';

/**
 * Keep the newest words of the printed caption in view, the way a transcript does.
 *
 * Only when the learner is already at the foot of the reading: a learner who scrolled back up to
 * the photo's second line is reading that, and yanking them down is worse than a fade. The jump is
 * instant rather than smooth — the pen owns motion on this screen, and a scroll animation under a
 * stroke is the drift the freeze exists to prevent.
 */
export function followTheCaption(scroller: HTMLElement | null, slack = 48): void {
  if (!scroller) return;
  const room = scroller.scrollHeight - scroller.clientHeight;
  if (room <= 0) return;
  const fromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  if (fromBottom > slack) return;
  scroller.scrollTop = scroller.scrollHeight;
}

import './doubt.css';

export const DOUBT_TITLE = 'Take a photo of the doubt';
/** What a keyless build says instead of pretending to read. */
export const OFFLINE_LINE =
  'I need to be connected to read a photo. Type the question in the chat and I am still here.';
/** What a learner with no connection is told INSTEAD of an explanation that is not coming. */
export const OFFLINE_EXPLAIN_LINE =
  'I need to be connected to explain a photo. Your reading is still here, so tap Explain again once you are back on.';
/** And what they are told when the answer was refused, cut off, or arrived with nothing in it. */
export const UNEXPLAINED_LINE =
  'I could not finish that explanation. Nothing is lost: tap Explain and I will have another go.';
/** How long a stroke is held for when the pen did not say. */
const DEFAULT_STROKE_MS = 900;
/** Past this the reading is saying so, rather than leaving a learner watching a still photo. */
const SLOW_READ_MS = 9000;
/** Air between the foot of the phone pane and the first of Wobo's floating controls. */
const PANE_GAP_PX = 8;
/** The pane never gives the reading less than this, whatever a small screen says. */
const MIN_PANE_PX = 360;
/**
 * A fixed box counts as the screen's bottom furniture when it lives in the lower part of the
 * viewport and never reaches the top of it. The tab bar sits ON the bottom edge; the Tell Wobo pill
 * floats 84 px above it; a full-screen ink layer or sheet starts at the top and is neither.
 */
const BOTTOM_BAND = 0.55;

/**
 * WHERE WOBO'S OWN FURNITURE BEGINS, measured rather than guessed.
 *
 * The numbers belong to other files — `.wk-rail` is 76 px of tab bar (ui/primitives/ui.css) and
 * `.wf-float` sits 84 px above it (ui/FlagControl.tsx) — and a constant copied here would be a
 * fourth place for them to disagree. So the screen reads the live boxes, the same way the
 * save-trouble strip publishes its own height for everything else pinned to the bottom to sit
 * above: whatever floats down there, the pane stops before it.
 */
function bottomChrome(): number {
  const floor = window.innerHeight;
  let ceiling = floor;
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    const style = getComputedStyle(el);
    if (style.position !== 'fixed') continue;
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (Number(style.opacity) === 0 || style.pointerEvents === 'none') continue;
    const box = el.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) continue;
    if (box.top <= floor * BOTTOM_BAND || box.top >= floor) continue;
    if (box.bottom <= floor * BOTTOM_BAND) continue;
    ceiling = Math.min(ceiling, box.top);
  }
  return ceiling;
}

/** Where a doubt was filed: the learner's own topic, or the node the gateway filed it under. */
interface Placed {
  topicId?: string;
  topicName: string;
}

/** What `keep` is asked to file: a topic on this device, the gateway's node, or neither. */
interface Filing {
  topic?: { id: string; name: string };
  nodeId?: string | undefined;
  name?: string | undefined;
}

export function DoubtScreen() {
  const router = useRouter();
  const sdk = useSdk();
  const world = useWorld();
  const progress = useProgress();
  const { ask, turns, busy, offline } = useWoboChat();
  const [state, dispatch] = useReducer(reduce, initialFlow);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [asking, setAsking] = useState(false);
  /** True while the world is being walked for the topic this doubt belongs to (law 4). */
  const [filing, setFiling] = useState(false);
  /** The reading is taking long enough to say so. */
  const [slowRead, setSlowRead] = useState(false);
  const [held, setHeld] = useState(false);
  const [over, setOver] = useState(false);
  /** The printed caption, revealed on the beat (caption.ts), never the whole paragraph at once. */
  const [caption, setCaption] = useState('');
  /** Where Wobo's words for THIS doubt begin in the one conversation. */
  const [saidFrom, setSaidFrom] = useState<number | null>(null);
  const itemId = useRef<string>(crypto.randomUUID());
  /** Which reading is the live one: an abandoned photo's answer must not land on the new one. */
  const readRun = useRef(0);
  const lineInputs = useRef(new Map<string, HTMLInputElement>());
  /** The paragraph a refusal is printed in, wherever it is printed. */
  const refusalRef = useRef<HTMLParagraphElement | null>(null);
  /** The phone pane, and the one thing inside it that scrolls. */
  const paneRef = useRef<HTMLDivElement | null>(null);
  const readRef = useRef<HTMLElement | null>(null);
  const phone = usePhone();
  const frameworkId = world?.frameworkId ?? null;
  /** True once there is a photo to work on: from there the screen is a pane, not a column. */
  const paneUp = state.phase !== 'capture' && !!state.capture;

  /**
   * THE PANE ENDS WHERE WOBO'S OWN FURNITURE BEGINS (docs/INK-FOUR.md, craft: "Nothing under a
   * panel, sheet, toast or pill"; experience: "after the turn the learner can act on what they
   * see". The adversary, wave 42 re-judge, finding 1.)
   *
   * Measured at 390x844 on the step a learner actually reaches with a photo: the sentence Wobo
   * asks them to check sat under the fixed "Tell Wobo" pill, the instruction under the tab bar,
   * and EXPLAIN — the only way the turn continues — at y 1302 in an 844 px viewport, 458 px below
   * a fold nothing scrolled to. The column was 1478 px long and the bottom 128 px of every screen
   * of it belonged to chrome.
   *
   * A taller column cannot fix that: at 390 the confirm step needs about a thousand pixels and the
   * screen has 628 once the tab bar and the pill have taken theirs. So on a phone the doubt becomes
   * a PANE that ends above them: the photo keeps the top of it, the reading scrolls INSIDE it, the
   * action is docked at its foot (`.db-act`), and the page itself no longer scrolls at all —
   * nothing can pass under anything, because nothing of the pane is ever painted there.
   *
   * The photo keeps its place rather than scrolling with the reading, because a line tapped in the
   * reading LIGHTS its place on the photo (`PhotoStage`, law 1), and a photo that had scrolled away
   * would either light off screen or yank the correction the learner was typing back out of view.
   *
   * The height is measured, not written down: `bottomChrome()` reads the live boxes so the pane
   * still stops in the right place if the pill moves, if the save-trouble strip lifts it, or if a
   * phone's safe area is deeper than a lab's. `--db-tail` cancels the main column's own bottom
   * padding, which exists to clear the same tab bar and would otherwise leave the page scrolling
   * 110 px to nothing.
   */
  useEffect(() => {
    const node = paneRef.current;
    if (!node || typeof window === 'undefined') return;
    if (!phone || !paneUp) {
      node.style.removeProperty('--db-pane');
      node.style.removeProperty('--db-tail');
      return;
    }
    const measure = () => {
      const pane = paneRef.current;
      if (!pane) return;
      // measured with the pane at its natural height, so a second pass never reads its own answer
      pane.style.removeProperty('--db-pane');
      pane.style.removeProperty('--db-tail');
      const top = pane.getBoundingClientRect().top + window.scrollY;
      const main = pane.closest('main');
      const tail = main ? Number.parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const room = Math.max(MIN_PANE_PX, bottomChrome() - top - PANE_GAP_PX);
      pane.style.setProperty('--db-pane', `${Math.round(room)}px`);
      pane.style.setProperty('--db-tail', `${Math.round(tail)}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [phone, paneUp]);

  /**
   * A REFUSAL THE LEARNER NEVER SEES IS NOT A REFUSAL (docs/INK-FOUR.md, experience; the
   * adversary, wave 49, finding 8).
   *
   * Measured at 1440x900: "I cannot see the page on this device..." sat at top 1382 on a page 1520
   * tall with scrollY 0, and nothing scrolled to it. The hero camera's size is the cause and is
   * fixed in doubt.css; this is the rule that holds whatever any future layout does — a refusal
   * that lands off the fold brings itself into view. Reduce motion gets the jump, not the glide.
   */
  useEffect(() => {
    if (!state.error) return;
    const el = refusalRef.current;
    if (!el || typeof window === 'undefined') return;
    const box = el.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) return;
    const still =
      document.documentElement.getAttribute('data-motion') === 'reduce' ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  }, [state.error]);

  // --- reading -----------------------------------------------------------------------------------
  const begin = useCallback(
    async (capture: Capture) => {
      const run = ++readRun.current;
      itemId.current = crypto.randomUUID();
      setRotation(0);
      setPlaced(null);
      setFiling(false);
      setSaidFrom(null);
      dispatch({ type: 'captured', capture });
      if (!GATEWAY_URL) {
        dispatch({ type: 'unreadable', say: OFFLINE_LINE });
        return;
      }
      try {
        const result = await readDoubt(gatewayPost(GATEWAY_URL), capture, { frameworkId });
        if (run !== readRun.current) return;
        dispatch({ type: 'read', result });
      } catch (err) {
        if (run !== readRun.current) return;
        dispatch({
          type: 'unreadable',
          say:
            err instanceof DoubtUnreadable
              ? err.message
              : err instanceof Error && err.message
                ? err.message
                : 'I could not reach my reading just now. Try again in a moment?',
        });
      }
    },
    [frameworkId],
  );

  /**
   * THE PHOTO THAT IS ALREADY TAKEN, whichever hand took it.
   *
   * Two ways one arrives and both end in the same place. The entry control took it before this
   * screen existed and handed it over in memory (`takeCapture`, doubt-store.ts). Or the phone's
   * own share sheet did: a child photographs the page in the gallery app, taps share and chooses
   * Wobo, the OS POSTs the picture to `/doubt/shared` (the manifest's `share_target`,
   * vite.config.ts), the service worker answers that POST itself, keeps the bytes on the device
   * and redirects here (public/share-target.js), and the file is collected from that store ONCE
   * (`takeSharedFile`, capture.ts). Either way it goes through `begin`, so a shared photo is
   * screened, read, shown and corrected exactly as a photographed one is and LAW 1 is untouched:
   * nothing is computed until the learner says Explain.
   *
   * SIGNED IN BEFORE THE SHUTTER, HERE TOO (LAW 2). The gateway keeps a photo against an account
   * and answers an anonymous session with 403, so a share is not collected at all until the door
   * is the camera: the bytes stay in the device's own store, the sign-in card is what the learner
   * meets, and nothing has travelled. A share nobody collected is swept by the worker.
   *
   * AND A SHARE WITH NO PHOTO SAYS NOTHING (DESIGN.md §0.x). `shared` hands back no action at all,
   * so the learner is on the capture step with the camera in front of them and not one word about
   * what did not arrive.
   */
  useEffect(() => {
    const capture = takeCapture();
    if (capture) {
      void begin(capture);
      return;
    }
    let live = true;
    // `sharedCapture` holds the read itself (capture.ts), so the Cache is emptied once however
    // many times this effect is mounted, and the photo waits there for whichever mount is alive.
    // THE DOOR RIDES IN WITH IT, and the store is emptied on arrival WHATEVER the door is: a share
    // met by the sign-in card is dropped, never left on the device for the next learner to sign in
    // on this tablet. Nothing travels either way (LAW 2) and nothing is said (DESIGN.md §0.x).
    void sharedCapture(window.location.href, doorFor(sdk.account))
      .then((shot) => {
        if (!live) return;
        const action = shared(shot);
        if (action) void begin(action.capture);
      })
      .catch((err: unknown) => {
        if (!live) return;
        dispatch({
          type: 'unreadable',
          say:
            err instanceof CaptureRefused
              ? err.message
              : 'I could not open that photo. Try another?',
        });
      });
    return () => {
      live = false;
    };
  }, [begin, sdk]);

  const onFile = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      await begin(await captureFromFile(file));
    } catch (err) {
      dispatch({
        type: 'unreadable',
        say:
          err instanceof CaptureRefused ? err.message : 'I could not open that photo. Try another?',
      });
    }
  };

  /**
   * Back to the camera, with whatever reading is in flight abandoned rather than left to land.
   * The stage offers it in every phase but the live turn, the READING included: a slow or stuck
   * read used to leave a learner with two rotate buttons and no way out at all until the SDK's
   * own 65 second deadline gave up for them.
   */
  const retake = useCallback(() => {
    readRun.current += 1;
    setFiling(false);
    dispatch({ type: 'retake' });
  }, []);

  // The reading has no budget in any doc, but a learner watching a still photo has one: past
  // SLOW_READ_MS the screen says so, and the stage's "Another photo" is the way out either way.
  useEffect(() => {
    if (state.phase !== 'reading') {
      setSlowRead(false);
      return;
    }
    const id = window.setTimeout(() => setSlowRead(true), SLOW_READ_MS);
    return () => window.clearTimeout(id);
  }, [state.phase]);

  // --- explaining --------------------------------------------------------------------------------
  /**
   * A DOUBT IS ONLY EXPLAINED IF WOBO ACTUALLY EXPLAINED IT.
   *
   * `ask` never rethrows — the runtime catches every refusal, says its line in the transcript and
   * returns — so a `finally` that dispatched 'explained' told a learner their doubt was answered
   * when the gateway had refused it, when the turn said nothing, and when there was no connection
   * at all (where the words go to the chat as a queued message, detached from the photo). The
   * caption store is the honest witness: it holds the say frames of THIS turn, and a turn that
   * said nothing said nothing.
   */
  const explain = async () => {
    const packet = doubtPacket(state);
    if (!packet || asking) return;
    if (offline) {
      dispatch({ type: 'unexplained', say: OFFLINE_EXPLAIN_LINE });
      return;
    }
    dispatch({ type: 'explain' });
    setAsking(true);
    setSaidFrom(turns.length);
    doubtCaption.begin();
    try {
      await ask(explainPrompt(state), { doubt: packet });
    } finally {
      setAsking(false);
      dispatch(
        doubtCaption.spoke()
          ? { type: 'explained' }
          : { type: 'unexplained', say: UNEXPLAINED_LINE },
      );
    }
  };

  // THE LINE THEY LIT IS THE THING THEY ARE ASKING ABOUT (the adversary, wave 47, finding 4;
  // docs/INK-FOUR.md, timing). The doubt photo is the one turn of the 59 that fails timing — the
  // first stroke landed 8 193 ms after the learner confirmed the reading, because every mark on
  // this screen waits on a model that reads a photograph and then thinks. But a learner who has
  // TAPPED a line has already said which one they mean, and the line is a registered target whose
  // id is the gateway's own (`doubt-surface.ts`). So it rides the packet as the turn's focus, and
  // `wobo/instant.ts` underlines it while the request is still in flight, with no model call at
  // all. Ours is the only focus this screen makes, so ours is the only one it clears.
  const litFocus = useRef<string | null>(null);
  useEffect(() => {
    const mine = litFocus.current;
    const lit = state.lit;
    if (!lit) {
      if (mine && turnFocus()?.id === mine) setTurnFocus(null);
      litFocus.current = null;
      return;
    }
    const rect = surfaceRegistry.getTarget(lit)?.rect() ?? null;
    const focus = createFocus({
      kind: 'longpress',
      targetIds: [lit],
      text: liveLines(state).find((l) => l.id === lit)?.text ?? '',
      rect: rect ?? EMPTY_RECT,
      surfaceId: doubtSurfaceId(state.result?.id ?? 'photo'),
    });
    litFocus.current = focus.id;
    setTurnFocus(focus);
  }, [state]);

  useEffect(
    () => () => {
      if (litFocus.current && turnFocus()?.id === litFocus.current) setTurnFocus(null);
    },
    [],
  );

  // AND THE PANE FOLLOWS THE CAPTION (the adversary, wave 47, finding 8). At 390 the last live
  // doubt ended "… removing the extra 5. Starting": the scroller's fade, and the rest of Wobo's
  // answer under it. The caption prints sentence by sentence on the beat, so the one thing that
  // scrolls keeps the newest sentence in view — unless the learner has scrolled up themselves
  // (then it is their place, not ours) or the pen is holding the page still mid-stroke.
  useEffect(() => {
    if (state.phase !== 'explaining' || held) return;
    followTheCaption(readRef.current);
  }, [caption, state.phase, held]);

  // The caption follows the beat: a sentence is printed when it is spoken, so with the sound off
  // the words and the strokes still arrive together (law 5).
  useEffect(() => {
    if (state.phase !== 'explaining') {
      setCaption('');
      return;
    }
    let timer: number | null = null;
    const show = () => {
      setCaption(doubtCaption.visible());
      if (timer !== null) window.clearTimeout(timer);
      timer = doubtCaption.pending() ? window.setTimeout(show, 100) : null;
    };
    show();
    const off = doubtCaption.subscribe(show);
    return () => {
      off();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [state.phase]);

  // The page holds still under the pen: a stroke landing on the photo locks scroll until it ends.
  useEffect(() => {
    if (state.phase !== 'explaining') return;
    const root = document.documentElement;
    const before = root.style.overflow;
    // On a phone the page does not scroll at all — the reading inside the pane does — so holding
    // the page still under the pen means holding that as well, or the ink would be the only thing
    // that did not move (docs/INK-FOUR.md, timing).
    const scroller = readRef.current;
    const scrolledBefore = scroller ? scroller.style.overflowY : '';
    const hold = strokeHold({
      lock: () => {
        root.style.overflow = 'hidden';
        if (scroller) scroller.style.overflowY = 'hidden';
        setHeld(true);
      },
      unlock: () => {
        root.style.overflow = before;
        if (scroller) scroller.style.overflowY = scrolledBefore;
        setHeld(false);
      },
      now: () => performance.now(),
      after: (ms, fn) => {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
    });
    let seen = screenStore.snapshot().length;
    const off = screenStore.subscribe(() => {
      const live = screenStore.snapshot();
      if (live.length <= seen) {
        seen = live.length;
        return;
      }
      for (const entry of live.slice(seen)) hold.onStroke(entry.durMs ?? DEFAULT_STROKE_MS);
      seen = live.length;
    });
    return () => {
      off();
      hold.dispose();
    };
  }, [state.phase]);

  // --- placing -----------------------------------------------------------------------------------
  const keep = useCallback(
    (filed: Filing) => {
      if (!state.result || !state.capture) return;
      const { result } = state;
      const topic = filed.topic;
      const record = (type: 'practice.retrieval.scheduled.v1', payload: object, context?: object) =>
        sdk.events.record(type, payload as never, context as never);
      if (topic) {
        joinClimb(itemId.current, topic.id, {
          nowMs: Date.now(),
          record,
          reportProgress: progress.reportProgress,
          progressNow: progress.topicProgress[topic.id],
        });
        setPlaced({ topicId: topic.id, topicName: topic.name });
      } else if (filed.nodeId) {
        // The gateway knows where this belongs and this device does not (yet). It still comes back
        // in practice and still counts as a miss on the concept; only the ring on the map waits.
        comeBackFor(itemId.current, filed.nodeId, { nowMs: Date.now(), record });
        if (filed.name) setPlaced({ topicName: filed.name });
      }
      const lines = liveLines(state);
      const name = topic?.name ?? (filed.nodeId ? filed.name : undefined);
      saveDoubt({
        id: result.id,
        createdAt: result.createdAt || new Date().toISOString(),
        reading: readingText(lines, result.reading.question),
        lines,
        width: result.reading.width || state.capture.width,
        height: result.reading.height || state.capture.height,
        explained: true,
        ...(topic ? { topicId: topic.id } : {}),
        ...(name ? { topicName: name } : {}),
      });
    },
    [sdk, progress.reportProgress, progress.topicProgress, state],
  );

  /**
   * The moment the explanation ends: place it where it belongs, or ask where that is.
   *
   * `topicForDoubt` can only search what is IN MEMORY, and the registry fills lazily as a learner
   * opens chapters — on a cold arrival at the camera, which is how a doubt arrives, it held
   * nothing, so the gateway's own node hint was thrown away and a learner with a board pinned was
   * told to go and choose one. So: the pinned version's cache is brought in first without a
   * request, and when that still does not answer, the world is walked for the node the gateway
   * filed this doubt under (climb.ts `resolveDoubtTopic`) before anything is said to the learner.
   */
  const placedOnce = useRef(false);
  useEffect(() => {
    if (state.phase !== 'placing' || placedOnce.current) return;
    placedOnce.current = true;
    const hint: DoubtHint = {
      nodeId: state.result?.climb.nodeId,
      name: state.result?.climb.nodeName ?? state.result?.reading.topic,
    };
    warmFromCache();
    const here = topicForDoubt(readingText(liveLines(state)), hint);
    if (here) {
      keep({ topic: { id: here.id, name: here.name } });
      return;
    }
    if (!hint.nodeId && !hint.name) {
      keep({});
      return;
    }
    let live = true;
    setFiling(true);
    void resolveDoubtTopic(hint).then((topic) => {
      if (!live) return;
      setFiling(false);
      keep(topic ? { topic: { id: topic.id, name: topic.name } } : hint);
    });
    return () => {
      live = false;
    };
  }, [state, keep]);
  useEffect(() => {
    if (state.phase === 'capture') placedOnce.current = false;
  }, [state.phase]);

  const said =
    saidFrom === null
      ? ''
      : turns
          .slice(saidFrom)
          .filter((t) => t.role === 'wobo')
          .map((t) => t.text)
          .join(' ')
          .trim();
  const canExplain = explainAllowed(state) && !busy && !asking;
  // THE READER'S `question` IS NEVER ON SCREEN (DOUBT.md §5). It is not shown and cannot be
  // corrected, so it can still carry the misread digit the learner has just fixed; falling back to
  // it when every line was emptied put the 8 they deleted back on the page, in Wobo's own "I read
  // this as ..." voice. With no lines left there is nothing read, and `readingLine` says so.
  const reading = readingText(liveLines(state));
  const regions = liveRegions(state);
  const door = doorFor(sdk.account);
  // The topics this doubt could belong to, best first (climb.ts), never the first eight in load
  // order: a learner with two hundred topics whose match failed used to see eight unrelated chips.
  const choices =
    state.phase === 'placing' && !placed && !filing
      ? suggestTopics(reading, state.result?.reading.topic, loadedTopics(), progress.topicProgress)
      : [];

  /**
   * WHAT THE LEARNER DOES NEXT, written once and put in one of two places: at the end of the
   * reading on a laptop, where the whole step is on the glass at once; docked at the foot of the
   * pane on a phone, where it is not. A refusal travels with the action it is about, so it is
   * never the thing that fell off the bottom.
   */
  const nextStep =
    state.phase === 'confirm' ? (
      <>
        {state.error ? (
          <p className="db-error" role="alert" ref={refusalRef}>
            {state.error}
          </p>
        ) : null}
        <div className="db-row">
          <Button tone="pig" onClick={() => void explain()} disabled={!canExplain}>
            Explain
          </Button>
        </div>
      </>
    ) : state.phase === 'placing' ? (
      <div className="db-row">
        <Button tone="pig" onClick={retake}>
          Another doubt
        </Button>
        <Button tone="quiet" onClick={() => router.navigate({ name: 'you' })}>
          See my doubts
        </Button>
      </div>
    ) : null;

  return (
    <AppFrame active="learn" about={{ surface: 'doubt' }}>
      <TopBar crumb="A doubt" />
      <div className="db-wrap">
        {state.phase === 'capture' && door === 'sign-in' ? (
          <section className="db-drop" aria-label={DOUBT_TITLE} data-door="sign-in">
            <CameraIcon />
            <h2>{DOUBT_TITLE}</h2>
            <p>
              {DOUBT_SIGN_IN_LINE} A photo of your page is kept with your account and only there.
            </p>
            <div className="db-row">
              <Button tone="pig" onClick={() => router.navigate({ name: 'sign-in' })}>
                Sign in
              </Button>
            </div>
          </section>
        ) : null}

        {state.phase === 'capture' && door === 'camera' ? (
          <section
            className={over ? 'db-drop db-over' : 'db-drop'}
            aria-label={DOUBT_TITLE}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const file = e.dataTransfer.files?.[0];
              const refusal = file ? acceptsFile(file) : null;
              if (refusal) dispatch({ type: 'unreadable', say: refusal });
              else void onFile(file);
            }}
          >
            <CameraIcon />
            <h2>{DOUBT_TITLE}</h2>
            <p>Point at the page, the sum, the diagram, whatever it is.</p>
            <div className="db-row">
              <label className="wk-btn wk-pig db-take">
                Take a photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label={DOUBT_ENTRY_LABEL}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    void onFile(file);
                  }}
                />
              </label>
              <label className="wk-btn wk-quiet db-take">
                Choose a file
                <input
                  type="file"
                  accept="image/*"
                  aria-label="Choose a photo of the page from your files"
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    void onFile(file);
                  }}
                />
              </label>
            </div>
            <p className="db-note">On a laptop you can also drop the photo here.</p>
            {state.error ? (
              <p className="db-error" role="alert" ref={refusalRef}>
                {state.error}
              </p>
            ) : null}
          </section>
        ) : null}

        {paneUp && state.capture ? (
          <div className="db-grid" ref={paneRef}>
            <PhotoStage
              photoId={state.result?.id ?? 'photo'}
              capture={state.capture}
              regions={regions}
              reading={reading}
              rotation={rotation}
              onRotate={setRotation}
              lit={state.lit}
              onLight={(id) => {
                dispatch({ type: 'light', regionId: id });
                if (id && state.phase === 'confirm') lineInputs.current.get(id)?.focus();
              }}
              held={held}
              {...(state.phase !== 'explaining' ? { onRetake: retake } : {})}
            />

            <section className="db-read" aria-label="What Wobo read" ref={readRef}>
              {/* The page being read. The orb turns a page and underlines a line while it does,
                  and says nothing about it (docs/EMAILS-AND-ANIMATIONS.md §3). Past SLOW_READ_MS a
                  line arrives, and it is help rather than a caption: what makes a photo quicker to
                  read, and the way out that is already on the screen. */}
              {state.phase === 'reading' ? (
                <>
                  <WaitScene subject="doubt" width={236} style={{ alignSelf: 'center' }} />
                  {slowRead ? (
                    <p className="db-note" role="status">
                      A straighter or brighter photo is often quicker, and Another photo is right
                      there.
                    </p>
                  ) : null}
                </>
              ) : null}

              {state.phase === 'confirm' ? (
                <>
                  <Tag>Check what I read</Tag>
                  <p className="db-line" data-testid="doubt-reading-line">
                    {readingLine(reading)}
                  </p>
                  <p className="db-note">Fix anything I misread, line by line, then I explain.</p>
                  <ol className="db-lines">
                    {state.lines.map((line, i) => (
                      <li
                        key={line.id}
                        className={state.lit === line.id ? 'db-lit-row' : undefined}
                      >
                        <input
                          ref={(el) => {
                            if (el) lineInputs.current.set(line.id, el);
                            else lineInputs.current.delete(line.id);
                          }}
                          className="db-text"
                          type="text"
                          maxLength={MAX_LINE_CHARS}
                          value={line.text}
                          aria-label={`Line ${i + 1} as I read it. Edit it if I got something wrong.`}
                          onFocus={() =>
                            dispatch({ type: 'light', regionId: line.box ? line.id : null })
                          }
                          onChange={(e) =>
                            dispatch({ type: 'editLine', id: line.id, text: e.target.value })
                          }
                        />
                      </li>
                    ))}
                  </ol>
                  {regions.length > 0 ? (
                    <div className="db-parts">
                      {regions.map((r) => (
                        <Chip
                          key={r.id}
                          on={state.lit === r.id}
                          onClick={() =>
                            dispatch({
                              type: 'light',
                              regionId: state.lit === r.id ? null : r.id,
                            })
                          }
                        >
                          {r.label}
                        </Chip>
                      ))}
                    </div>
                  ) : null}
                  <label className="db-words">
                    <span className="db-note">
                      Anything to tell me? Which step, or what is confusing. Optional.
                    </span>
                    <textarea
                      className="db-text"
                      rows={2}
                      maxLength={500}
                      value={state.words}
                      placeholder="I do not get how the 5 moves across"
                      aria-label="Your own words about this doubt, if you want to add any"
                      onChange={(e) => dispatch({ type: 'words', text: e.target.value })}
                    />
                  </label>
                  {phone ? null : nextStep}
                </>
              ) : null}

              {state.phase === 'explaining' || state.phase === 'placing' ? (
                <>
                  <Tag>{state.phase === 'explaining' ? 'Explaining' : 'Explained'}</Tag>
                  <p className="db-line">{reading}</p>
                  <p className="db-said" aria-live="polite" data-testid="doubt-said">
                    {state.phase === 'explaining' ? caption : said}
                  </p>
                </>
              ) : null}

              {state.phase === 'placing' ? (
                <div className="db-place">
                  {placed ? (
                    <p>
                      Filed under <b>{placed.topicName}</b>.{' '}
                      {placed.topicId
                        ? 'It is on your map now, and it will come round again in practice so it sticks.'
                        : 'It will come round again in practice so it sticks.'}
                    </p>
                  ) : filing ? (
                    <p role="status">Finding where this belongs on your map.</p>
                  ) : choices.length > 0 ? (
                    <>
                      <p>Where does this belong? Pick a topic and it joins your map.</p>
                      <div className="db-parts">
                        {choices.map((t) => (
                          <Chip
                            key={t.id}
                            onClick={() => keep({ topic: { id: t.id, name: t.name } })}
                          >
                            {t.name}
                          </Chip>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p>
                      {world
                        ? 'Kept with your doubts. Open the subject it belongs to and I can put it on your map.'
                        : 'Kept with your doubts. Choose a board in You and it can join your map.'}
                    </p>
                  )}
                  {phone ? null : nextStep}
                </div>
              ) : null}
            </section>
            {phone && nextStep ? <div className="db-act">{nextStep}</div> : null}
          </div>
        ) : null}
      </div>
    </AppFrame>
  );
}
