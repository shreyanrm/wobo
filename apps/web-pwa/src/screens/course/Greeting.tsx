'use client';

/**
 * The greeting — the victory theatre that closes a topic (DESIGN.md §3.9, §5). A full-screen
 * earned moment: the sigil ignites in the subject hue, performance stars land (1–3 from the run's
 * real accuracy), the XP tally springs up, a restrained starburst arrives, and the completion
 * chord sounds. Then the "what you proved" line and the door onward. A boss-closed topic earns a
 * bigger theatre and a trophy note. When the earn crosses a level curve threshold, a distinct
 * full-screen level moment forges in as a second beat. Reduced-motion, dark theme, and mute all
 * respected. Docked Wobo celebrates, then settles.
 */

import { useWoboBus } from '@wobo/wobo';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { Topic } from '../../data/model';
import { levelInfo, useProgress, XP_AWARDS } from '../../store/progress';
import { useSdk } from '../../store/sdk';
import { TopicSigil } from '../../ui/art';
import { Juni, Pico, Pip } from '../../ui/cast';
import {
  LevelUpMoment,
  PerformanceStars,
  performanceStars,
  Starburst,
  TrophyNote,
  XpTally,
} from '../../ui/celebration';
import { hueForTopic } from '../../ui/hues';
import { useWoboChat } from '../../wobo/chat';
import type { BarState } from './shared';
import {
  CardBody,
  GOLD,
  lead,
  readCourseStars,
  rgba,
  Stage,
  whisper,
  writeCourseStars,
} from './shared';

/** Floating sparks — a handful of hue and gold motes rising once, then gone. */
function Sparks({ hue }: { hue: string }) {
  const sparks = [
    { id: 's1', left: '12%', top: '78%', s: 5, d: 0.4 },
    { id: 's2', left: '26%', top: '88%', s: 3, d: 0.9 },
    { id: 's3', left: '44%', top: '92%', s: 4, d: 0.6 },
    { id: 's4', left: '62%', top: '86%', s: 6, d: 0.3 },
    { id: 's5', left: '78%', top: '90%', s: 3, d: 1.1 },
    { id: 's6', left: '88%', top: '80%', s: 4, d: 0.7 },
    { id: 's7', left: '34%', top: '84%', s: 3, d: 1.4 },
    { id: 's8', left: '70%', top: '94%', s: 4, d: 1.2 },
  ];
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {sparks.map((sp, i) => (
        <motion.span
          key={sp.id}
          initial={{ y: 0, opacity: 0 }}
          animate={{ y: -220 - i * 14, opacity: [0, 0.9, 0] }}
          transition={{ delay: sp.d, duration: 2.6, ease: [0.2, 0, 0.4, 1] }}
          style={{
            position: 'absolute',
            left: sp.left,
            top: sp.top,
            width: sp.s,
            height: sp.s,
            borderRadius: 999,
            background: i % 3 === 0 ? GOLD : hue,
          }}
        />
      ))}
    </div>
  );
}

/**
 * The "what you proved" headline. Course-aware via the run's real performance rather than a
 * topic-specific metaphor — "you kept the scale level" is the equations balance, and read as
 * nonsense in a chemistry or biology course. Stars come from this run's graded evidence.
 *
 * Three stars forgive one stumble (`performanceStars`), which is a fair bar for the reward; the
 * sentence is not allowed the same tolerance. A learner whose one miss the app stopped to
 * dramatise thirty seconds ago knows they put a foot wrong, so the absolute line is reserved for
 * a walk with no miss at all, and the one-slip walk gets its own true one. A replay reads its
 * banked stars, but the words still follow the walk the learner just did.
 */
export function provedLine(
  run: { bossCorrect?: number; bossTotal?: number; attemptsTotal: number; itemsTotal: number },
  stars: number = performanceStars(run),
): string {
  const bossClean = run.bossTotal ? (run.bossCorrect ?? 0) >= run.bossTotal : true;
  const noMiss = bossClean && run.attemptsTotal <= run.itemsTotal;
  if (stars >= 3) {
    return noMiss
      ? 'You never put a foot wrong, the whole way through.'
      : 'One slip on the way, and you set it right before the end.';
  }
  if (stars >= 2) return 'You found the through-line and held it.';
  return 'You got there, and that is what counts.';
}

export function Greeting({
  topic,
  nodeId,
  attemptsTotal,
  enteredAt,
  setBar,
  onContinue,
  boss = true,
  bossCorrect,
  bossTotal,
  itemsTotal = 6,
  replay = false,
}: {
  topic: Topic;
  nodeId: string;
  attemptsTotal: number;
  enteredAt: number;
  setBar: (b: BarState | null) => void;
  onContinue: () => void;
  /** A boss-closed topic earns the bigger theatre and the trophy note. */
  boss?: boolean;
  /** Graded boss evidence — items correct of total — the lead signal for the performance stars. */
  bossCorrect?: number;
  bossTotal?: number;
  /** Baseline count of graded items in the run, so extra attempts read as stumbles. */
  itemsTotal?: number;
  /** A replay of an already-completed course: warm, but no xp tally / re-award theatrics. */
  replay?: boolean;
}) {
  const sdk = useSdk();
  const bus = useWoboBus();
  const { completeTopic, xp } = useProgress();
  const { setMood } = useWoboChat();
  const reduced = useReducedMotion() ?? false;
  const fired = useRef(false);

  // the real earn, and whether it crosses a level curve threshold (§ store levelInfo). xp here is
  // the pre-completion total (completeTopic runs in the effect below), so the crossing is exact.
  const gained = topic.xp ?? XP_AWARDS.topic;
  const startXp = useRef(xp);
  const levelBefore = levelInfo(startXp.current).level;
  const levelAfter = levelInfo(startXp.current + gained).level;
  const leveledUp = levelAfter > levelBefore;

  // A replay shows the ORIGINAL earned stars (banked at first completion), never a fresh grade.
  const runStars = performanceStars({ bossCorrect, bossTotal, attemptsTotal, itemsTotal });
  const stars = replay ? (readCourseStars(topic.id) ?? runStars) : runStars;

  // victory first; if the earn crossed a level, a distinct level beat follows before moving on
  const [phase, setPhase] = useState<'victory' | 'levelup'>('victory');

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    completeTopic(topic.id, topic.xp);
    // bank the stars once, on the genuine first completion — every later replay reads these back
    if (!replay) writeCourseStars(topic.id, runStars);
    setMood('celebrate');
    const settle = window.setTimeout(() => setMood('idle'), 1600);

    // the completion event carries the band the evidence actually earned
    void (async () => {
      let finalBand = 'developing';
      try {
        const bands = await sdk.kgtopg.mastery.getBands(sdk.subjectId);
        finalBand = bands.find((b) => b.node_id === nodeId)?.band ?? finalBand;
      } catch {
        // seed path — the fallback band is honest for a fresh pass
      }
      sdk.events.record(
        'learn.node.completed.v1',
        {
          node_id: nodeId,
          final_band: finalBand as
            | 'not_started'
            | 'emerging'
            | 'developing'
            | 'secure'
            | 'independent',
          attempts_total: attemptsTotal,
          duration_ms: Math.max(0, Date.now() - enteredAt),
        },
        { ontologyNodeId: nodeId },
      );
    })();

    bus.publishCanvas(undefined);
    return () => window.clearTimeout(settle);
  }, [completeTopic, setMood, sdk, bus, topic, nodeId, attemptsTotal, enteredAt, replay, runStars]);

  // victory bar advances to the level beat when the earn crossed a threshold; otherwise onward.
  useEffect(() => {
    if (phase === 'levelup') {
      setBar({ primary: { label: 'Continue', onClick: onContinue } });
    } else {
      setBar({
        primary: {
          label: 'Continue',
          onClick: leveledUp ? () => setPhase('levelup') : onContinue,
        },
      });
    }
  }, [phase, leveledUp, setBar, onContinue]);

  const hue = hueForTopic(topic.id);

  if (phase === 'levelup') {
    return <LevelUpMoment level={levelAfter} reduced={reduced} />;
  }

  return (
    <CardBody maxWidth={560}>
      {/* the full-screen ignite — one hue wave sweeping the whole viewport, once, sub-second.
          skipped on a replay: the map already caught light the first time. */}
      {!replay && (
        <motion.div
          aria-hidden
          initial={{ x: '-45%' }}
          animate={{ x: '145%', opacity: [1, 1, 0] }}
          transition={{ duration: 0.9, ease: [0.2, 0, 0.2, 1], delay: 0.25 }}
          style={{
            position: 'fixed',
            inset: 0,
            width: '55vw',
            background: `linear-gradient(100deg, transparent 0%, ${rgba(hue, 0.14)} 42%, ${rgba(hue, 0.26)} 50%, ${rgba(hue, 0.14)} 58%, transparent 100%)`,
            pointerEvents: 'none',
            zIndex: 30,
          }}
        />
      )}
      {/* the earned moment gets its own lit stage — glow, sparks, the sigil large */}
      <Stage hue={hue} tint={0.07} minHeight={300}>
        <motion.div
          aria-hidden
          animate={{ opacity: [0.45, 0.8, 0.45], scale: [1, 1.06, 1] }}
          transition={{ duration: 5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            width: 320,
            height: 320,
            borderRadius: 999,
            background: `radial-gradient(circle, ${rgba(hue, 0.16)} 0%, transparent 62%)`,
            pointerEvents: 'none',
          }}
        />
        {/* sparks drift up while the room catches light */}
        <Sparks hue={hue} />
        {/* the reward arriving as stars — bigger for a boss-closed topic (stars law, §5).
            a replay skips the re-award burst; the sigil still lights, warm as ever. */}
        {!replay && <Starburst hue={hue} reduced={reduced} big={boss} />}

        {/* the sigil, mastered — the same geometry from the row and the door, now lit large */}
        <motion.div
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 230, damping: 24, delay: 0.2 }}
          style={{ position: 'relative' }}
        >
          <TopicSigil id={topic.id} size={130} mastered hue={hue} draw />
        </motion.div>

        {/* the cast arrives to celebrate — Wobo's world catching the same light */}
        <motion.div
          aria-hidden
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 230, damping: 24, delay: 0.9 }}
          style={{ position: 'absolute', left: 18, bottom: 0 }}
        >
          <Pip size={60} mood="delighted" />
        </motion.div>
        <motion.div
          aria-hidden
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 230, damping: 24, delay: 1.05 }}
          style={{ position: 'absolute', right: 20, bottom: 0 }}
        >
          <Pico size={54} mood="delighted" seed={2} />
        </motion.div>
        <motion.div
          aria-hidden
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 1.25 }}
          style={{ position: 'absolute', right: 74, top: 30 }}
        >
          <Juni size={40} seed={1} />
        </motion.div>
      </Stage>

      {/* the earned scoreboard — performance stars, the XP springing up, and the boss trophy */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <PerformanceStars stars={stars} hue={hue} reduced={reduced} />
        {/* no fresh xp on a replay — the currency was banked the first time */}
        {!replay && <XpTally amount={gained} hue={hue} reduced={reduced} />}
        {boss && !replay && <TrophyNote hue={hue} />}
      </div>

      <div style={{ position: 'relative', textAlign: 'center' }}>
        <div style={whisper}>{replay ? 'You came back' : 'The greeting'}</div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.55, ease: [0.2, 0, 0, 1] }}
          style={{
            marginTop: 16,
            fontSize: 'clamp(1.6rem, 5vw, 2.1rem)',
            fontWeight: 550,
            letterSpacing: '-0.02em',
            lineHeight: 1.25,
            color: 'var(--wobo-ink-900)',
          }}
        >
          {replay
            ? 'You walked it again.'
            : provedLine({ bossCorrect, bossTotal, attemptsTotal, itemsTotal }, stars)}
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.5, ease: [0.2, 0, 0, 1] }}
          style={{ ...lead, marginTop: 14 }}
        >
          {replay ? (
            <>
              <span style={{ color: hue, fontWeight: 550 }}>{topic.name.toLowerCase()}</span> is
              still yours — the reps are real, the xp already banked.
            </>
          ) : (
            <>
              <span style={{ color: hue, fontWeight: 550 }}>{topic.name.toLowerCase()}</span> is
              yours now — not memorised, understood.
            </>
          )}
        </motion.div>
        {!replay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1, duration: 0.5 }}
            style={{ marginTop: 18, fontSize: '0.88rem', color: 'var(--wobo-ink-500)' }}
          >
            the map just caught light.
          </motion.div>
        )}
      </div>
    </CardBody>
  );
}
