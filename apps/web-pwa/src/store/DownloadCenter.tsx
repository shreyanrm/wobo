'use client';

/**
 * The download center — mounted once, globally (App.tsx), so it runs no matter which screen the
 * learner wanders to. Two jobs:
 *
 *  1. The runner. It drives the queue store one at a time: claim the oldest queued course, ask the
 *     real generation seam (engine.compose) to compose + verify it — which also warms the gateway's
 *     board-shared content cache, so when the learner opens the course the player's own compose call
 *     is an instant cache hit. LLM_MODE=mock returns immediately; the flow is identical live.
 *
 *  2. The notify moment. The instant a course is ready it lands wherever the learner now is: a soft
 *     sfx tick, Wobo says it aloud (mute-aware), and a frosted toast they can tap to dive in.
 */

import { useRegisterTarget } from '@wobo/wobo';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { claimNextForge, settleForge, useForged } from '../screens/practice/forge-store';
import { composeWorkbook } from '../screens/practice/pools';
// The staged labels live with the loading scene, not here: the toast and the long-wait screen are
// two views of one wait, and a learner who taps the toast has to see the same sentence continue.
import { composeStage, isLongWait } from '../screens/states/generation';
import { GenerationWait } from '../screens/states/Scene';
import { failureFromError, reportFailure } from '../screens/states/select';
import { useRouter } from '../shell/router';
import { sfx } from '../ui/sound';
import { speakLine } from '../wobo/speech';
import {
  acknowledge,
  claimNext,
  type Download,
  enqueue,
  markFailed,
  READY_TOAST,
  readyLine,
  SLIPPED_TOAST,
  settleCompose,
  useDownloads,
} from './downloads';
import { loadMind } from './mind';
import { useSdk } from './sdk';

const COMPOSE_TIMEOUT_MS = 75_000;

export function DownloadCenter() {
  const sdk = useSdk();
  const router = useRouter();
  const items = useDownloads();
  const forged = useForged();
  const running = useRef(false);
  const forgeRunning = useRef(false);
  const forgeNotified = useRef<Set<string>>(new Set());
  const forgeInit = useRef(false);
  // Notifications fire exactly once per topic even though items re-renders many times.
  const notified = useRef<Set<string>>(new Set());

  // What is being made for this learner right now. Registered so "is my course ready" is answered
  // from the real queue, and so Wobo can point at the toast rather than describe it.
  const centreRef = useRegisterTarget<HTMLDivElement>('download-center', {
    kind: 'queue',
    label: 'the courses being composed for you right now',
    getSceneState: () => ({
      composing: items
        .filter((d) => d.status === 'downloading' || d.status === 'queued')
        .map((d) => d.title),
      ready: items.filter((d) => d.status === 'ready').map((d) => d.title),
      forged: forged.length,
    }),
  });

  // The one compose the learner has chosen to sit and watch, if any.
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  // A gentle clock so the composing toast's staged label advances while Wobo works. Only ticks while
  // something is actually composing, then stops — no idle timers.
  const [now, setNow] = useState(() => Date.now());
  const composingCount = items.filter(
    (d) => d.status === 'downloading' || d.status === 'queued',
  ).length;
  useEffect(() => {
    if (composingCount === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1200);
    return () => clearInterval(t);
  }, [composingCount]);

  // The runner loop: self-driving. Claiming flips a course to `downloading` and fans a store event,
  // which re-runs this effect; the running ref plus claimNext's one-in-flight guard keep it to a
  // single generation at a time. markReady/markFailed fan another event → the next course is claimed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `items` is the re-trigger (not read here); sdk is a stable singleton
  useEffect(() => {
    if (running.current) return;
    const next = claimNext();
    if (!next) return;
    running.current = true;
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('compose timeout')), COMPOSE_TIMEOUT_MS);
    });
    Promise.race([
      sdk.llm.invoke(
        'engine.compose',
        { topic: next.title, topic_id: next.topicId, difficulty: 'core' },
        { consentTier: 'un_elevated' },
      ),
      timeout,
    ])
      // A refusal or timeout is not an error the learner should see: the course player floors to a
      // structural seed course either way (Composing.tsx). "ready" means this topic's course came
      // back; a placeholder envelope settles as failed (downloads.composeOutcome), never as ready.
      .then((res) => settleCompose(next.topicId, res.output))
      .catch((err: unknown) => {
        // Two refusals ARE worth a page, because they are about the learner rather than this one
        // course: a spent day (with the real reset instant off the 429's own header) and a request
        // that never left the device. Everything else stays silent and floors to the seed course.
        const failure = failureFromError(err);
        if (failure) reportFailure(failure);
        markFailed(next.topicId);
      })
      .finally(() => {
        running.current = false;
      });
    // sdk is a stable singleton; `items` is the sole trigger that re-drives the queue.
  }, [items]);

  // The notify moment — fires as a course settles ready, once, wherever the learner is now.
  useEffect(() => {
    for (const d of items) {
      if (d.status !== 'ready' || d.seen || notified.current.has(d.topicId)) continue;
      notified.current.add(d.topicId);
      sfx.ding(); // a soft notification ding — mute-aware inside sound.ts
      void speakLine(readyLine(d.title)); // Wobo says it aloud — mute-aware inside speech.ts
    }
  }, [items]);

  // The forge build runner — one composition in flight, mirroring the course queue's discipline. The
  // short delay is the "binding" moment made real; composition itself (pools.ts) is deterministic.
  // NO CLEANUP, deliberately (same discipline as the course runner above): claiming a forge fans a
  // store event, which re-runs this effect, whose cleanup would have cancelled the very build it
  // just started — leaving the workbook stranded in "building" for ever. The effect owns the work
  // for its whole life; settleForge writes only to the module store, so an unmount is safe.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `forged` re-triggers; the runner reads the store directly
  useEffect(() => {
    if (forgeRunning.current) return;
    const next = claimNextForge();
    if (!next) return;
    forgeRunning.current = true;
    const slipNodeIds = loadMind().slips.map((s) => s.nodeId);
    window.setTimeout(() => {
      settleForge(next.id, composeWorkbook(next.picks, next.size, next.mix, slipNodeIds));
      forgeRunning.current = false;
    }, 1600);
  }, [forged]);

  // The forge notify moment — a workbook settling to ready lands wherever the learner now is. Ready
  // forges already on disk at mount are adopted silently (never a pile of dings on every boot).
  useEffect(() => {
    if (!forgeInit.current) {
      forgeInit.current = true;
      for (const w of forged) if (w.status === 'ready') forgeNotified.current.add(w.id);
      return;
    }
    for (const w of forged) {
      if (w.status !== 'ready' || forgeNotified.current.has(w.id)) continue;
      forgeNotified.current.add(w.id);
      sfx.ding();
      void speakLine(
        `your workbook on ${w.title.toLowerCase()} is forged. it's on your shelf, ready whenever you are.`,
      );
    }
  }, [forged]);

  // The toast carries the learner through the whole journey wherever they now are: composing (they
  // just tapped an ungenerated course and were bounced back per the content law), then ready (tap to
  // dive in) or a slip (tap to retry). downloading/queued carry seen=true, so they surface by status
  // alone; ready/failed surface until acknowledged. This is the visible downloading pill the bounce
  // relies on — no matter which screen the learner landed back on.
  const toasts = items.filter(
    (d) =>
      // The one the learner is watching full-screen is not also a pill in the corner.
      d.topicId !== waitingFor &&
      (d.status === 'downloading' ||
        d.status === 'queued' ||
        ((d.status === 'ready' || d.status === 'failed') && !d.seen)),
  );

  const open = (d: Download) => {
    if (d.status === 'downloading' || d.status === 'queued') {
      // Still composing. Tapping it used to do nothing at all, which read as a dead control; now a
      // learner who has been waiting a while can choose to wait WITH Wobo, and gets the loading
      // scene with the same staged line the toast was showing. It replaces the toast rather than
      // stacking on it, and the work carries on either way.
      if (isLongWait(d.at, Date.now())) setWaitingFor(d.topicId);
      return;
    }
    acknowledge(d.topicId);
    if (d.status === 'ready') {
      router.navigate({ name: 'course', topicId: d.topicId });
    } else {
      // a slip → put it back in line; the runner picks it up, the notify moment lands again
      notified.current.delete(d.topicId);
      enqueue(d.topicId, d.title);
    }
  };

  // The wait the learner asked to watch, dropped the moment that course stops composing — the
  // notification takes over from there, and nobody is left looking at a loader for finished work.
  const waiting = items.find(
    (d) => d.topicId === waitingFor && (d.status === 'downloading' || d.status === 'queued'),
  );
  useEffect(() => {
    if (waitingFor && !waiting) setWaitingFor(null);
  }, [waitingFor, waiting]);

  return (
    <div
      ref={centreRef}
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: 'min(420px, calc(100vw - 32px))',
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence>
        {toasts.map((d) => {
          const composing = d.status === 'downloading' || d.status === 'queued';
          const stage = composing ? composeStage(Math.max(0, now - d.at)) : '';
          return (
            <motion.button
              key={d.topicId}
              type="button"
              layout
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 340, damping: 30 }}
              onClick={() => open(d)}
              whileTap={{ scale: 0.985 }}
              style={{
                position: 'relative',
                overflow: 'hidden',
                pointerEvents: 'auto',
                width: '100%',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 16px',
                // a toast floats, so it wears the soft shadow; ink on paper, no line (DESIGN.md §2)
                borderRadius: 16,
                cursor: composing ? 'default' : 'pointer',
                fontFamily: 'inherit',
                color: 'var(--paper)',
                background: 'var(--ink)',
                border: 0,
                boxShadow: 'var(--shadow)',
              }}
            >
              {/* honest indeterminate track along the bottom — Wobo is actively working, no fake % */}
              {composing && (
                <motion.span
                  aria-hidden
                  initial={{ x: '-60%' }}
                  animate={{ x: '160%' }}
                  transition={{
                    duration: 1.6,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: 'easeInOut',
                  }}
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: 0,
                    height: 3,
                    width: '40%',
                    borderRadius: 999,
                    background: 'var(--marigold)',
                    opacity: 0.9,
                  }}
                />
              )}
              {/* a small breathing dot in the mastery pigment — ready glows, a slip is muted */}
              <motion.span
                aria-hidden
                animate={
                  d.status === 'ready' || composing
                    ? { scale: [1, 1.35, 1], opacity: [0.9, 0.5, 0.9] }
                    : { opacity: 0.6 }
                }
                transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
                style={{
                  flexShrink: 0,
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  background:
                    d.status === 'ready' || composing ? 'var(--marigold)' : 'var(--ink-3)',
                }}
              />
              <span
                style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}
              >
                <span style={{ fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.25 }}>
                  {d.title}
                </span>
                <span style={{ fontSize: '0.8125rem', opacity: 0.82, lineHeight: 1.35 }}>
                  {composing
                    ? `${stage}… Wobo will let you know the moment it's ready`
                    : d.status === 'ready'
                      ? READY_TOAST
                      : SLIPPED_TOAST}
                </span>
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  opacity: 0.9,
                  whiteSpace: 'nowrap',
                }}
              >
                {composing ? `${stage}…` : d.status === 'ready' ? 'Open' : 'Retry'}
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
      {waiting ? (
        <GenerationWait
          title={waiting.title}
          stage={composeStage(Math.max(0, now - waiting.at))}
          onLeave={() => setWaitingFor(null)}
        />
      ) : null}
    </div>
  );
}
