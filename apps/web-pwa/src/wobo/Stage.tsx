'use client';

/**
 * The stage — everything of Wobo's that lives above the app, mounted once at the root
 * (docs/WOBO-PLAN.md §1, docs/BOARD.md §5).
 *
 * In one layer stack: the gesture sense over the whole app, Wobo's ink on the screen, the frosted
 * plane, the full board a lesson turns into, the cursor Wobo shows things with, and the dev
 * inspector. Nothing here is a screen; everything here is Wobo.
 *
 * The laws it keeps: nothing is placed by pixels (every mark anchors to a registry target, a focus
 * region, another object or board space); reduced motion is honoured by the renderer it mounts;
 * every interaction has a keyboard path; one hit of pigment; no shadows; 3 px corners.
 */

import { zIndex } from '@wobo/config';
import { useReducedMotion } from '@wobo/motion';
import {
  anchorRectOf,
  BoardChromeStyle,
  BoardSurface,
  ChromeButton,
  createFocus,
  type FocusObject,
  GestureLayer,
  type LearnerFocus,
  plane,
  RegistryInspector,
  surfaceRegistry,
  usePlane,
  useWoboBus,
  WoboFullBoard,
  WoboPlane,
} from '@wobo/wobo';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { FlagControl } from '../ui/FlagControl';
import { Button } from '../ui/primitives';
import { saveBoardToNotes } from './board-notes';
import { boardTargets, boardTurn, focusRegionsFor, lessonStore, screenStore } from './board-turn';
import { useBusRegistryBridge } from './bus-bridge';
import { setTurnFocus, turnFocus } from './capabilities';
import { showCursor } from './hands';
import { lessonView, useLessonView } from './lesson-view';
import { videoHandoff } from './video';

export interface WoboStageProps {
  route: string;
  /** The board's title — the lesson or topic it belongs to. It names the save and the export. */
  title?: string;
  /** The learner circled, selected, long-pressed or drew: this is what "this" means now. */
  onFocus?: (focus: FocusObject | null) => void;
  /** The chip, the hotkey: they ask Wobo about what is in hand. */
  onAsk?: (focus: FocusObject | null) => void;
  /** Hold-to-talk on the desktop hotkey. */
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  /** A bound control moved on the board — the brain recomputes its dependants. */
  onVariableChange?: (
    variable: string,
    value: number | boolean | string | [number, number],
  ) => void;
  /** The gesture layer is off inside Wobo's own full-screen flows (onboarding, a design concept). */
  gestures?: boolean;
}

/** Wobo's ink, Wobo's boards, Wobo's hands — one mount, above everything. */
export function WoboStage(props: WoboStageProps) {
  const { route, title, gestures = true } = props;
  useBusRegistryBridge(route);
  const [focus, setFocus] = useState<FocusObject | null>(null);

  const publish = useCallback(
    (next: FocusObject | null) => {
      setFocus(next);
      setTurnFocus(next);
      props.onFocus?.(next);
    },
    [props.onFocus],
  );

  /** A stroke the learner drew on a board is a focus object, exactly like a circle on the screen. */
  const onLearnerFocus = useCallback(
    (ink: LearnerFocus) => {
      // The targets under the stroke, where they are now: the mark travels with them if the page
      // moves, rather than staying glued to the pixels the learner happened to draw on.
      const anchorRect = anchorRectOf(
        ink.targetIds,
        (id) => surfaceRegistry.getTarget(id)?.rect() ?? null,
      );
      publish(
        createFocus({
          kind: 'ink',
          rect: {
            x: ink.rect.x,
            y: ink.rect.y,
            width: ink.rect.width,
            height: ink.rect.height,
          },
          targetIds: ink.targetIds,
          path: ink.points.map(([x, y]) => ({ x, y })),
          ...(anchorRect ? { anchorRect } : {}),
        }),
      );
    },
    [publish],
  );

  const regions = useMemo(() => focusRegionsFor(focus), [focus]);
  const focusRegions = useCallback(() => regions, [regions]);
  usePlaneTarget();

  return (
    <>
      {gestures ? (
        <GestureLayer
          registry={surfaceRegistry}
          onFocus={publish}
          onClear={() => publish(null)}
          {...(props.onAsk ? { onAsk: props.onAsk } : {})}
          {...(props.onHoldStart ? { onHoldStart: props.onHoldStart } : {})}
          {...(props.onHoldEnd ? { onHoldEnd: props.onHoldEnd } : {})}
        />
      ) : null}
      {/* Ink on the screen: fixed to the viewport, anchored to what is under it, fading like a
          whiteboard. Wobo never draws on it; the learner's ink belongs on a board. */}
      <BoardSurface
        fixed
        store={screenStore}
        targets={boardTargets}
        focusRegions={focusRegions}
        label="Wobo's ink on this screen"
      />
      <WoboPlane
        targets={boardTargets}
        focusRegions={focusRegions}
        onLearnerFocus={onLearnerFocus}
        {...(props.onVariableChange ? { onVariableChange: props.onVariableChange } : {})}
      />
      <LessonBoard
        {...(title ? { title } : {})}
        {...(props.onVariableChange ? { onVariableChange: props.onVariableChange } : {})}
      />
      <BoardKeeper {...(title ? { title } : {})} route={route} />
      <ShowMeCursor />
      <RegistryInspector />
    </>
  );
}

/**
 * The plane is a surface like any other — Wobo can point at it, tell a learner it is there, and be
 * asked to put it away. Its rect is read off the live dialog, so moving or resizing it is followed
 * without a single stored coordinate.
 */
function usePlaneTarget(): void {
  // `registerTarget` alone, never the whole bus: the bus object is rebuilt on every registration,
  // so an effect depending on it that registers a target would re-register forever.
  const { registerTarget } = useWoboBus();
  const state = usePlane();
  const open = state.open && !state.minimized;
  useEffect(() => {
    if (!open) return;
    return registerTarget({
      id: 'wobo-plane',
      kind: 'board',
      label: `${state.title} — Wobo's board, floating over this screen`,
      getRect: () => {
        const el = document.querySelector('[role="dialog"][aria-label*="Wobo\'s board"]');
        return el ? el.getBoundingClientRect() : null;
      },
      getSceneState: () => ({
        title: state.title,
        pinned: state.pinned,
        objects: boardTurn.boardStore().snapshot().length,
      }),
      getValidActions: () => ['wipe the board', 'a fresh board', 'put the board away'],
      applyTutorAction: (patch) => {
        if (patch.wipe === true) plane.wipe();
        if (patch.dismiss === true) plane.dismiss();
        if (patch.fresh === true) plane.fresh();
      },
    });
  }, [registerTarget, open, state.title, state.pinned]);
}

// --- The board a lesson draws on ---------------------------------------------------------------------

/**
 * Inside a lesson the board is the screen (docs/BOARD.md §5). It arrives only once Wobo has actually
 * drawn something, and there is always a way back to the lesson — the board is never a trap.
 *
 * Where it lands is the lesson screen's choice (wobo/lesson-view.ts): "Full board" covers the
 * viewport; "Plane" puts the same renderer inside the plane card's canvas, portalled into the
 * element the screen handed over. Escape leaves the full board for the plane, and hides the inline
 * ink until Wobo's next turn.
 */
function LessonBoard({
  title,
  onVariableChange,
}: {
  title?: string;
  onVariableChange?: (
    variable: string,
    value: number | boolean | string | [number, number],
  ) => void;
}) {
  const state = useSyncExternalStore(boardTurn.subscribe, boardTurn.get, boardTurn.get);
  const objects = useSyncExternalStore(
    lessonStore.subscribe,
    () => lessonStore.snapshot().length,
    () => 0,
  );
  const { view, host } = useLessonView();
  const [dismissed, setDismissed] = useState(false);
  // A new turn brings the ink back — dismissing is for this board, not for lessons.
  useEffect(() => {
    if (state.active) setDismissed(false);
  }, [state.active]);
  const inked = objects > 0 && !dismissed;
  const full = inked && view === 'full';
  const inline = inked && view === 'plane' && host !== null;

  useEffect(() => {
    if (!full && !inline) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (full) lessonView.view('plane');
      else setDismissed(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, inline]);

  if (!full && !inline) return null;
  const board = (
    <WoboFullBoard
      store={lessonStore}
      {...(title ? { title } : {})}
      targets={boardTargets}
      {...(onVariableChange ? { onVariableChange } : {})}
      onShare={shareImage}
      // the scrubber and the share live on the full board; the plane card keeps to the ink
      chrome={full}
    />
  );
  if (inline && host) return createPortal(<div className="ls-ink">{board}</div>, host);
  return (
    <div style={{ background: 'var(--paper)', inset: 0, position: 'fixed', zIndex: zIndex.panel }}>
      {board}
      <Button size="sm" tone="quiet" className="ls-back" onClick={() => lessonView.view('plane')}>
        back to the lesson
      </Button>
      {/* The full board covers the shell, and the shell is where the quiet flag lives (AppFrame).
          Without this copy the one surface the help centre names first — the board — would be the
          one surface with no way to say anything is wrong with it. */}
      <FlagControl
        placement="corner"
        about={{ surface: 'board', ...(title ? { content_id: title } : {}) }}
      />
    </div>
  );
}

/** Share: hand the learner the rendered image. Nothing is uploaded and nothing is sent for them. */
function shareImage(blob: Blob, filename: string): void {
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  };
  const file = new File([blob], filename, { type: 'image/png' });
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    void nav.share({ files: [file], title: filename }).catch(() => download(blob, filename));
    return;
  }
  download(blob, filename);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Save to notes, and back to the film -----------------------------------------------------------

/**
 * The board's two doors, docked beside the plane: keep it, or go back to the film it interrupted.
 * The timeline and the share affordance live in the full board's own chrome; this is the plane's.
 */
function BoardKeeper({ title, route }: { title?: string; route: string }) {
  const state = usePlane();
  const [kept, setKept] = useState<string | null>(null);
  const waiting = useSyncExternalStore(
    videoHandoff.subscribe,
    () => videoHandoff.get().playerId,
    () => null,
  );
  const reduced = useReducedMotion();
  if (!state.open || state.minimized) return null;

  const keep = () => {
    const note = saveBoardToNotes(boardTurn.boardStore(), {
      ...(title ? { title } : {}),
      route,
    });
    setKept(note ? 'kept in your notes' : 'there is nothing on it yet');
    setTimeout(() => setKept(null), 2400);
  };

  return (
    <div
      className="wobo-chrome wobo-chrome-bar"
      style={{
        bottom: 12,
        left: '50%',
        maxWidth: 'calc(100vw - 32px)',
        position: 'fixed',
        transform: 'translateX(-50%)',
        transition: reduced ? 'none' : 'opacity 160ms cubic-bezier(0.2, 0, 0, 1)',
        width: 'max-content',
        zIndex: zIndex.panel,
      }}
    >
      <BoardChromeStyle />
      <ChromeButton onClick={keep}>save to notes</ChromeButton>
      {waiting ? (
        <ChromeButton
          onClick={() => {
            plane.minimize();
            videoHandoff.returnToFrame();
          }}
        >
          back to the film
        </ChromeButton>
      ) : null}
      <span aria-live="polite" style={{ color: 'var(--ink-2)', fontSize: 13 }}>
        {kept ?? ''}
      </span>
    </div>
  );
}

// --- "Show me" ---------------------------------------------------------------------------------------

/**
 * The cursor Wobo shows things with: a real pointer gliding to a real control on the real screen. It
 * is inert (`pointer-events: none`) — Wobo taps the control itself, the way the learner would. The
 * line Wobo narrates is announced, so the move is not lost on anyone who is not watching the pixels.
 */
export function ShowMeCursor() {
  const state = useSyncExternalStore(showCursor.subscribe, showCursor.get, showCursor.get);
  const reduced = useReducedMotion();
  if (!state.at) return null;
  const size = state.tapping ? 26 : 18;
  return (
    <div
      style={{
        inset: 0,
        pointerEvents: 'none',
        position: 'fixed',
        zIndex: zIndex.modal,
      }}
    >
      <div
        aria-hidden
        // Where Wobo is, and what Wobo is doing there — readable from outside, so "show me" can be
        // proved to have reached the real control rather than merely narrated.
        data-wobo-cursor={state.tapping ? 'tapping' : 'gliding'}
        data-wobo-cursor-saying={state.saying ?? ''}
        style={{
          border: '3px solid var(--pig)',
          borderRadius: '50%',
          height: size,
          left: state.at.x - size / 2,
          opacity: state.tapping ? 0.4 : 0.85,
          position: 'fixed',
          top: state.at.y - size / 2,
          transition: reduced ? 'none' : 'width 160ms, height 160ms, opacity 160ms',
          width: size,
        }}
      />
      <div
        aria-live="polite"
        style={{
          clipPath: 'inset(50%)',
          height: 1,
          overflow: 'hidden',
          position: 'absolute',
          whiteSpace: 'nowrap',
          width: 1,
        }}
      >
        {state.saying}
      </div>
    </div>
  );
}

/** The focus in hand right now — for anything outside the stage that needs to know. */
export function currentFocus(): FocusObject | null {
  return turnFocus();
}
