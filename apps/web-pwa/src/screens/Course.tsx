'use client';

/**
 * The lesson — board 03 of design/prototypes/app-v1.html (DESIGN.md is law). The app shell with
 * the hold-to-talk pill in the rail; the crumb and the three view chips; the plane card (Wobo's
 * bar, the canvas, the say row); and the side column (this lesson's steps, ask about this, your
 * place).
 *
 * The canvas holds the lesson's cards — the atom journey, the composed course, or the free-play
 * sandbox — and, once Wobo has drawn, Wobo's board over them: the existing renderer, portalled in
 * by the stage (wobo/Stage.tsx) through the lesson-view seam. Nothing about the board is drawn
 * here; this screen is the frame around it.
 */

import {
  armLasso,
  BoardStore,
  BoardSurface,
  restoreBoard,
  useRegisterTarget,
  useWoboBus,
} from '@wobo/wobo';
import { AnimatePresence, motion } from 'framer-motion';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useRegistryRevision } from '../curriculum/hooks';
import { usePool } from '../curriculum/pool';
import { chapterById, subjectById, topicById } from '../curriculum/registry';
import { ensureTopic, warmFromCache } from '../curriculum/warm';
import { AppFrame } from '../shell/AppFrame';
import { useRouter } from '../shell/router';
import { enqueue as enqueueDownload, getDownload } from '../store/downloads';
import { useProgress } from '../store/progress';
import { useSdk } from '../store/sdk';
import { Button, Card, Chip, Tag, TopBar, WoboHead } from '../ui/primitives';
import { readNotes, type SavedBoard } from '../wobo/board-notes';
import { boardTurn } from '../wobo/board-turn';
import { holdToTalkEnd, holdToTalkStart } from '../wobo/hold';
import { type LessonView, lessonView, useLessonView } from '../wobo/lesson-view';
import { MuteButton, ReplayButton, useCardNarration } from '../wobo/speech';
import { AtomJourney } from './course/AtomJourney';
import { Composing } from './course/Composing';
import { hasKeptLesson } from './course/kept';
import { type BarState, type LessonOutline, useAdvanceTarget } from './course/shared';
import { WhatIf } from './course/WhatIf';
import { PlacementCheck, usePlacementGate } from './onboarding/PlacementCheck';
import './course/lesson.css';

/** The three chips at the top: where Wobo's board shows. */
const VIEWS: readonly { id: LessonView; label: string }[] = [
  { id: 'full', label: 'Full board' },
  { id: 'plane', label: 'Plane' },
  { id: 'notes', label: 'Notes' },
];

export function Course({
  topicId,
  cardId,
  sandbox = false,
}: {
  topicId: string;
  /**
   * THE LINK THAT LANDS (docs/EMAILS-AND-ANIMATIONS.md §4). `/course/<course>/card/<card>` opens
   * the course ON that card. The segment is passed straight through to the player, which is the
   * only thing that knows how its own cards are named; a card that means nothing to this course
   * changes nothing at all, and the course opens where it always opens.
   */
  cardId?: string | undefined;
  sandbox?: boolean;
}) {
  const router = useRouter();
  const sdk = useSdk();
  const bus = useWoboBus();

  // A custom course Wobo composed from a free-text ask: topicId carries the concept itself
  // (`custom:black holes`), so the composing player gets the real title, never "a new course".
  const custom = topicId.startsWith('custom:') ? topicId.slice('custom:'.length).trim() : null;
  // A deep link opens the course cold: the registry is empty until a screen has ingested the
  // pinned world. Read the cache here, before the first lookup (synchronous, nothing fetched), and
  // if the topic is still unknown ask the world for it before deciding anything — otherwise a real
  // topic's own name, atom, chapter and subject would be unknown on the first paint, the crumb
  // would call it "a new course" and the download gate would bounce the learner back home.
  useRegistryRevision();
  if (!custom && !topicById(topicId)) warmFromCache();
  const topic = custom ? undefined : topicById(topicId);
  const [resolving, setResolving] = useState(() => !custom && !topic);
  useEffect(() => {
    if (!resolving) return;
    let live = true;
    void ensureTopic(topicId).finally(() => {
      if (live) setResolving(false);
    });
    return () => {
      live = false;
    };
  }, [resolving, topicId]);
  const chapter = topic ? chapterById(topic.chapterId) : custom ? undefined : chapterById(topicId);
  const title = topic?.name ?? chapter?.name ?? custom ?? 'a new course';
  const nodeId = topic?.nodeId;
  const mode: 'sandbox' | 'atom' | 'composing' = sandbox
    ? 'sandbox'
    : nodeId
      ? 'atom'
      : 'composing';

  const [bar, setBar] = useState<BarState | null>(null);
  const { reportProgress, completed } = useProgress();

  // THE DOWNLOAD-FIRST CHOKEPOINT (CONTEXT.md content law). Every path into a course routes through
  // here, so the gate lives here once — not on each of the N call sites (subject rows, the Learn
  // continue card, home thread stops, expedition checkpoints, the command palette, Wobo's route
  // actions, custom courses, progress). A composed course the learner does not yet own is NEVER
  // opened cold into an in-page skeleton: if its content is not generated/cached and it is not
  // already on its way, enqueue it and bounce back — the downloading pill + the ready notification
  // carry it (owner law: first click says downloading → notify when ready → then they enter; tapping
  // the ready toast opens it). The atom (a prebuilt node), a mastered course (warm cache), a course
  // already ready to open, and every practice sandbox all open instantly, untouched by the gate.
  // A lesson already kept on this device is already owned: it opens, network or no network, and
  // the gate must not read a queue entry an offline open had flipped and send the learner home
  // (screens/course/kept.ts).
  const dl = getDownload(topicId);
  const needsDownload =
    !resolving &&
    mode === 'composing' &&
    !completed.has(topicId) &&
    dl?.status !== 'ready' &&
    !hasKeptLesson(topicId);
  const [progress, setProgress] = useState<{ f: number; segments: number }>({
    f: 0.08,
    segments: 9,
  });
  const sandboxEntered = useRef(false);
  // the quiet "picking up where you left off" beat — shown when a player restores a saved position
  const [resumed, setResumed] = useState(false);
  const onResume = useCallback(() => setResumed(true), []);
  useEffect(() => {
    if (!resumed) return;
    const t = window.setTimeout(() => setResumed(false), 3200);
    return () => window.clearTimeout(t);
  }, [resumed]);
  // Wobo reads each card aloud and the advance button waits for Wobo — muted, an equal reading clock
  // stands in. Gating only bites teaching cards' advance (never "check", never a question read).
  const narration = useCardNarration();
  const primaryLabel = (bar?.primary.label ?? '').toLowerCase();
  const gateApplies =
    narration.gating &&
    !narration.ready &&
    primaryLabel !== 'check' &&
    primaryLabel !== 'hint' &&
    primaryLabel !== 'another hint';

  // stable exit — card effects depend on it
  const exit = useCallback(() => router.back(), [router]);

  // The gate acts: enqueue (unless already in line/running) and bounce back to the previous screen,
  // where the downloading pill/toast is visible and the ready notification will land.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-time gate; topicId/title are stable per route
  useEffect(() => {
    if (!needsDownload) return;
    if (dl?.status !== 'downloading' && dl?.status !== 'queued') enqueueDownload(topicId, title);
    router.back();
  }, [needsDownload]);

  useEffect(() => {
    bus.publishPage({ route: sandbox ? 'sandbox' : 'course', state: { topicId, title, mode } });
  }, [bus, sandbox, topicId, title, mode]);

  // The card on stage — the beat the learner is actually on. Registered so Wobo's ink anchors to the
  // card itself ("this step", "the box at the top") and so the full board knows what it is about.
  const stageRef = useRegisterTarget<HTMLElement>('course-card', {
    kind: 'card',
    label: `the card on stage in ${title}`,
    meaning: 'the beat of the lesson the learner is on right now',
    getSceneState: () => ({
      topic: title,
      mode,
      beat: Math.round(progress.f * progress.segments) + 1,
      of: progress.segments,
      advance: bar?.primary.label,
    }),
  });

  // the row on the subject page fills as the learner travels — the tab is the progress bar. Never
  // for a course being bounced to the download queue (it would falsely mark the topic as started).
  useEffect(() => {
    if (!sandbox && topic && !needsDownload) reportProgress(topic.id, progress.f);
  }, [sandbox, topic, progress.f, reportProgress, needsDownload]);

  // free play on a real node is still an arrival worth recording
  useEffect(() => {
    if (!sandbox || !nodeId || sandboxEntered.current) return;
    sandboxEntered.current = true;
    sdk.events.record(
      'learn.node.entered.v1',
      { node_id: nodeId, entry: 'practice_review', initial_band: 'not_started' },
      { ontologyNodeId: nodeId },
    );
  }, [sandbox, nodeId, sdk]);

  // --- The frame's own state ---------------------------------------------------------------------

  // Which surface Wobo's board is on. The canvas is handed to the stage, which puts the board there.
  const { view } = useLessonView();
  const hostRef = useCallback((el: HTMLDivElement | null) => lessonView.host(el), []);
  useEffect(() => () => lessonView.reset(), []);
  // The live pill: on while the pen is moving.
  const drawing = useSyncExternalStore(
    boardTurn.subscribe,
    () => boardTurn.get().active,
    () => false,
  );
  // This lesson's steps, reported by the player on stage; free play has none.
  const [outline, setOutline] = useState<LessonOutline | null>(null);
  const crumb = useMemo(() => {
    // free play on no topic in particular is just free play
    if (sandbox) return topic || custom ? `Free play · ${title}` : 'Free play';
    const subject = chapter ? subjectById(chapter.subjectId) : undefined;
    const lesson = topic && chapter ? chapter.topics.findIndex((t) => t.id === topic.id) + 1 : 0;
    const parts = [
      subject?.name,
      chapter ? `Chapter ${chapter.index}` : undefined,
      lesson > 0 ? `Lesson ${lesson}` : undefined,
    ].filter((p): p is string => Boolean(p));
    return parts.length > 0 ? parts.join(' · ') : title;
  }, [sandbox, title, topic, chapter, custom]);

  const notes = view === 'notes';

  // THE PLACEMENT GATE (curriculum/placement.ts). A topic whose prerequisites the learner has not
  // covered gets a short look at the ground first: a few questions, never an exam, skippable at
  // every one of them. What it settles is handed to the tutor through the placement module's own
  // seam, so this screen only opens the door and gets out of the way. Free play and a course still
  // downloading are never gated.
  // THE CHAPTER'S POOL (docs/LEARNING-MODEL.md, curriculum/pool.ts). Null for a chapter the
  // architect has not built one for, which is most of them today and changes nothing: the check
  // falls back to the ground this client derives, and says that it derived it. When there IS a
  // pool, the architect's own declared ground is what the learner is asked about, and what they
  // answer is what pulls the prerequisite module into their group.
  const pool = usePool(chapter, chapter ? subjectById(chapter.subjectId)?.name : undefined);
  const placement = usePlacementGate(
    topic,
    completed,
    !sandbox && !needsDownload && !resolving,
    pool,
  );

  // Gated: hold a plain paper screen for the single frame before router.back() lands — no cold
  // skeleton, no white flash. The learner returns to where they were, download in flight. The same
  // paper holds while a cold address is being resolved against the world.
  // The same paper holds for the frame the placement gate takes to decide, so a lesson that is
  // about to be preceded by a check never flashes on screen first.
  if (needsDownload || resolving || placement.status === 'planning') {
    return <div style={{ height: '100dvh', background: 'var(--paper)' }} />;
  }

  // The check is INSIDE the app, not in front of it. It used to return instead of the AppFrame, at
  // 100dvh, with no nav rail, no back, no bottom bar and no way out but answering every question or
  // the irreversible claim: a full-screen interstitial with one door, carrying the sentence
  // "nothing here is a wall" printed on the wall. It sits in the same frame as the lesson it
  // precedes, with the same crumb and the same way back, and "Not now" opens the lesson anyway.
  if (placement.status === 'checking') {
    return (
      <AppFrame active="learn" bottom={<HoldToTalk />}>
        <h1 className="ls-sr">{title}</h1>
        <TopBar className="ls-topbar" crumb={crumb} />
        <PlacementCheck
          plan={placement.plan}
          events={sdk.events}
          onDone={placement.dismiss}
          onSkip={placement.dismiss}
        />
      </AppFrame>
    );
  }

  return (
    <AppFrame active="learn" bottom={<HoldToTalk />}>
      <h1 className="ls-sr">{title}</h1>
      <TopBar
        className="ls-topbar"
        crumb={crumb}
        right={VIEWS.map((v) => (
          <Chip
            key={v.id}
            on={view === v.id}
            onClick={() => lessonView.view(v.id)}
            // Wobo's own control of where Wobo's board shows: never on the glass map
            // (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze).
            data-wobo-surface=""
          >
            {v.label}
          </Chip>
        ))}
      />
      <div className="ls-lesson">
        <section className="ls-plane" aria-label={title} aria-busy={drawing || undefined}>
          {/* Wobo's own name and voice controls: never on the glass map. */}
          <div className="ls-bar" data-wobo-surface="">
            <b>Wobo</b>
            {/* on-stage voice controls: mute Wobo's narration, or replay the current card */}
            <span className="ls-voice">
              <ReplayButton onReplay={narration.replay} />
              <MuteButton />
            </span>
            {/* the pen is moving: the pulse says so, no word does (DESIGN.md §0.x); aria-busy on
                the section carries it to assistive tech */}
            {drawing && (
              <span className="ls-live" aria-hidden="true">
                <i />
              </span>
            )}
          </div>
          <div className="ls-canvas">
            {/* the lesson's cards; they stay mounted behind the notes so the beat is kept */}
            <main ref={stageRef} className="ls-stage wobo-scroll-quiet" hidden={notes}>
              {mode === 'sandbox' && <WhatIf nodeId={nodeId} freePlay setBar={setBar} />}
              {mode === 'atom' && topic && nodeId && (
                <AtomJourney
                  topic={topic}
                  nodeId={nodeId}
                  openAt={cardId}
                  setBar={setBar}
                  setProgress={setProgress}
                  onExit={exit}
                  onResume={onResume}
                  onOutline={setOutline}
                />
              )}
              {mode === 'composing' && (
                <Composing
                  topicId={topicId}
                  title={title}
                  openAt={cardId}
                  setBar={setBar}
                  setProgress={setProgress}
                  onExit={exit}
                  onResume={onResume}
                  onOutline={setOutline}
                />
              )}
            </main>
            {/* Wobo's board, when there is ink on it — the stage portals the renderer in here */}
            <div ref={hostRef} className="ls-host" hidden={notes} />
            {notes && <LessonNotes />}
          </div>
          <div className="ls-say">
            <WoboHead size={44} />
            <div className="hand" aria-live="polite">
              {narration.text}
            </div>
            <SayActions
              bar={bar}
              gate={gateApplies ? { progress: narration.progress } : undefined}
            />
          </div>
        </section>
        <aside className="ls-side">
          {outline && outline.steps.length > 0 && (
            <Card compact>
              <Tag>This lesson</Tag>
              <div className="ls-steps">
                {outline.steps.map((step, i) => (
                  <div key={step} className={i === outline.at ? 'ls-on' : undefined}>
                    <i>{i + 1}</i>
                    {step}
                  </div>
                ))}
              </div>
            </Card>
          )}
          {/* LAW v5 (DESIGN.md §0): rose is for the thing that needs care. The tools that let a
              learner circle the board and ask are neither a worry nor a highlight, so the card is
              a tonal surface and the pigment on this screen stays in Wobo's ink. */}
          <Card compact>
            <Tag>Ask about this</Tag>
            <p style={{ color: 'var(--ink)' }}>
              Circle any part of the board and ask why. Or just say it.
            </p>
            {/* the tools are Wobo's own; the card's words above them are the lesson's */}
            <div className="ls-tools" data-wobo-surface="">
              <Chip onClick={() => armLasso(true)}>Circle</Chip>
              <Chip>Type</Chip>
              <TalkChip />
            </div>
          </Card>
          <Card compact>
            <Tag>Your place</Tag>
            <p>Saved as you go. Leave any time, come back to this line.</p>
          </Card>
        </aside>
      </div>

      {/* the quiet resume beat — a soft line, then it fades on its own */}
      <AnimatePresence>
        {resumed && (
          <motion.div
            className="ls-resume"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            Picking up where you left off
          </motion.div>
        )}
      </AnimatePresence>
    </AppFrame>
  );
}

// --- The say row's actions -----------------------------------------------------------------------

/**
 * The one action under the board: the card's primary (Begin, Check, Continue) and, when the card
 * offers one, its quiet second (Hint, Why?). The primary is the `course-advance` target Wobo can
 * walk the learner to; while Wobo reads a teaching card it fills up rather than going dead.
 */
function SayActions({ bar, gate }: { bar: BarState | null; gate?: { progress: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const gated = Boolean(gate);
  useAdvanceTarget(ref, bar, gated);
  if (!bar) return null;
  return (
    <div ref={ref} className="ls-actions">
      {bar.secondary && (
        <Button size="sm" tone="quiet" onClick={bar.secondary.onClick}>
          {bar.secondary.label}
        </Button>
      )}
      <Button
        size="sm"
        className={gated ? 'ls-gated' : undefined}
        disabled={bar.primary.disabled || gated}
        onClick={bar.primary.onClick}
      >
        {gated && (
          <span
            className="ls-fill"
            aria-hidden="true"
            style={{ width: `${Math.round((gate?.progress ?? 0) * 100)}%` }}
          />
        )}
        <span style={{ position: 'relative' }}>{bar.primary.label}</span>
      </Button>
    </div>
  );
}

// --- Hold to talk --------------------------------------------------------------------------------

/** A hold that opens Wobo's microphone and lets go when the pointer does — the orb's own hold. */
function useHold() {
  const held = useRef(false);
  const start = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (held.current) return;
    held.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    holdToTalkStart();
  }, []);
  const end = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    holdToTalkEnd();
  }, []);
  useEffect(() => end, [end]);
  return { start, end };
}

/** The rail's bottom slot: the hint, and a hold on it is the same hold as the space bar. */
function HoldToTalk() {
  const { start, end } = useHold();
  return (
    <button
      type="button"
      className="wk-talk ls-hold"
      aria-label="Hold to talk to Wobo"
      // Wobo's own control of Wobo's own microphone: never on the glass map. The adversary,
      // 2026-09-09, finding 11: this chip sat at [20,757,200,71] among the lesson's lines on
      // every 1440 course turn, which is exactly what the construction set was meant to prevent.
      data-wobo-surface=""
      onPointerDown={start}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span className="wk-k">space</span>
      <span>Hold to talk to Wobo</span>
    </button>
  );
}

/** The Talk chip in the ask card — hold it to speak. */
function TalkChip() {
  const { start, end } = useHold();
  return (
    <Chip
      onClick={() => {}}
      aria-label="Hold to talk to Wobo"
      onPointerDown={start}
      onPointerUp={end}
      onPointerCancel={end}
    >
      Talk
    </Chip>
  );
}

// --- Notes ---------------------------------------------------------------------------------------

/** The boards the learner kept, newest first; open one and it is drawn again on the canvas. */
function LessonNotes() {
  const [notes] = useState<SavedBoard[]>(() => readNotes());
  const [open, setOpen] = useState<SavedBoard | null>(null);
  const store = useMemo(() => new BoardStore({ presentation: 'full' }), []);
  useEffect(() => {
    if (open) restoreBoard(store, open.objects);
  }, [open, store]);
  if (open) {
    return (
      <div className="ls-ink">
        <BoardSurface store={store} autoCamera label={`${open.title}, from your notes`} />
        <Button size="sm" tone="quiet" className="ls-back" onClick={() => setOpen(null)}>
          Notes
        </Button>
      </div>
    );
  }
  return (
    <section className="ls-notes" aria-label="Notes">
      {notes.length === 0 && <div className="ls-empty">Nothing kept yet.</div>}
      {notes.map((note) => (
        <button key={note.id} type="button" onClick={() => setOpen(note)}>
          {note.title}
          <span>{new Date(note.savedAt).toLocaleDateString()}</span>
        </button>
      ))}
    </section>
  );
}
