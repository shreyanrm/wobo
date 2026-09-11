'use client';

/**
 * THE ARCADE SHELL — one frame, six mechanics, and a bonus level that pays once.
 *
 * docs/CONTENT-INTERACTION.md §7 (the owner, 2026-09-08): optional study arcade games as bonus
 * levels for extra XP, "every now and then in the middle" of a chapter, since the boss level
 * already sits at the end.
 *
 * WHAT THIS FILE OWNS: the score, the lives, the clock, which round is up, the evidence, the
 * award, and the words around the play. WHAT IT DOES NOT OWN: the play itself. Each of the six
 * mechanics is a field in `arcade/mechanics.tsx` and says only two things back — that one is
 * right, or that one is wrong and here is why. Adding a seventh is a row in `MECHANICS` and a
 * shape in `plexus/specs.py`; it is never a change here.
 *
 * THE RULES THAT ARE NOT NEGOTIABLE, all of them from §7 and docs/LEVELS.md §4:
 *   · Bonus XP is capped per chapter and per day and NEVER counts toward a level. `store/arcade.ts`
 *     holds it, in its own key, and cannot reach the climb's XP. A game is a reward, never a
 *     shortcut past the learning.
 *   · A level pays the first time it is cleared and never again. It stays open, because it is
 *     theirs; it just stops paying.
 *   · The register and the never-narrate law hold inside a game. Nothing here says what the
 *     product is doing, and there is no hype anywhere in it.
 *   · Older classes get a lighter shell: fewer words, no encouragement, the same game (`lite`).
 *   · Reduced motion is a still with the spark, and the sound layer is the app's one mute.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BarState } from '../screens/course/shared';
import { CardBody, cardTitle, whisper } from '../screens/course/shared';
import { awardBonus, BONUS_LINES, type BonusOutcome } from '../store/arcade';
import { useSdk } from '../store/sdk';
import { hueForTopic } from '../ui/hues';
import { sfx } from '../ui/sound';
import { MECHANICS, type MechanicProps } from './arcade/mechanics';
import { ARCADE_COPY, type ArcadeGame, type ArcadeSpec, parseArcade } from './arcade/spec';

export {
  ARCADE_COPY,
  ARCADE_GAMES,
  type ArcadeGame,
  type ArcadeRound,
  type ArcadeSpec,
  parseArcade,
} from './arcade/spec';

const START_LIVES = 3;

/**
 * Which mechanics spend the round on a wrong move. Catch has already fallen, the quiz has already
 * been answered and the line has already been tapped, so all three move on. A sort, a match and a
 * sequence are still in front of the learner, so they stay: the board is the lesson.
 */
const SPENDS_THE_ROUND: ReadonlySet<ArcadeGame> = new Set(['catch', 'quiz', 'numberline']);

type Phase = 'ready' | 'playing' | 'won' | 'lost';

export interface ArcadeShellProps {
  spec: ArcadeSpec;
  hue?: string;
  /** The concept this level rehearses. Every attempt is recorded against it, as real evidence. */
  nodeId: string;
  courseId?: string;
  /** The chapter the door hangs off. The XP cap is per chapter, so it has to be named. */
  chapterId?: string;
  /** The lighter shell: set for the older classes. Same game, fewer words. */
  lite?: boolean;
  setBar?: (b: BarState | null) => void;
  onDone?: () => void;
}

export function ArcadeShell({
  spec,
  hue = hueForTopic(''),
  nodeId,
  courseId,
  chapterId = 'chapter',
  lite = false,
  setBar,
  onDone,
}: ArcadeShellProps) {
  const sdk = useSdk();
  const bus = useWoboBus();
  const reduced = useReducedMotion() ?? false;

  const [phase, setPhase] = useState<Phase>('ready');
  const [at, setAt] = useState(0);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [run, setRun] = useState(0);
  const [left, setLeft] = useState(spec.seconds ?? 0);
  const [paid, setPaid] = useState<BonusOutcome | null>(null);
  const settling = useRef(false);
  const itemIds = useRef<Map<number, string>>(new Map());
  // Which round is up, readable from a timer without re-creating it. React may run a state updater
  // more than once for one change, so deciding "was that the last round?" INSIDE `setAt` both
  // hides the decision from the render that needs it and risks running it twice. The ref is the
  // decision; `setAt` only draws it.
  const atRef = useRef(0);

  const round = spec.rounds[at];
  const Field = MECHANICS[spec.game];

  const record = useCallback(
    (index: number, correct: boolean) => {
      let id = itemIds.current.get(index);
      if (!id) {
        id = crypto.randomUUID();
        itemIds.current.set(index, id);
      }
      try {
        sdk.events.record(
          'learn.attempt.submitted.v1',
          {
            node_id: nodeId,
            item_id: id,
            response: { kind: 'choice', selected: [correct ? 'cleared' : 'missed'] },
            correct,
            aided: false,
            independence_signal: 0.9,
            latency_ms: 0,
            attempt_index: 0,
          },
          { ontologyNodeId: nodeId, ...(courseId ? { courseId } : {}) },
        );
      } catch {
        // A refused payload must never eat the play. The evidence is worth having and the caller
        // hands us a real node id, but a game that freezes mid-round because a record was rejected
        // is a worse failure than a lost attempt, and this is the round the learner is standing in.
      }
    },
    [sdk, nodeId, courseId],
  );

  const start = useCallback(() => {
    atRef.current = 0;
    setAt(0);
    setScore(0);
    setLives(START_LIVES);
    setLeft(spec.seconds ?? 0);
    setPaid(null);
    setRun((n) => n + 1);
    settling.current = false;
    setPhase('playing');
  }, [spec.seconds]);

  /** The clock, where the mechanic has one. It runs on the level, not the round. */
  useEffect(() => {
    if (phase !== 'playing' || !spec.seconds) return;
    const tick = window.setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          window.clearInterval(tick);
          setPhase('lost');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [phase, spec.seconds]);

  const advance = useCallback(() => {
    settling.current = true;
    window.setTimeout(
      () => {
        const next = atRef.current + 1;
        if (next >= spec.rounds.length) {
          setPhase('won');
          return;
        }
        atRef.current = next;
        setAt(next);
        settling.current = false;
      },
      reduced ? 160 : 460,
    );
  }, [spec.rounds.length, reduced]);

  const onRight = useCallback(() => {
    if (settling.current) return;
    setScore((s) => s + 1);
    record(at, true);
    advance();
  }, [at, record, advance]);

  const onWrong = useCallback(() => {
    if (settling.current) return;
    record(at, false);
    setLives((l) => {
      const next = l - 1;
      if (next <= 0) setPhase('lost');
      return Math.max(0, next);
    });
    if (SPENDS_THE_ROUND.has(spec.game)) advance();
  }, [at, record, advance, spec.game]);

  /** The award, once the level is cleared. It pays once, under two caps, and never up the climb. */
  useEffect(() => {
    if (phase !== 'won' || paid) return;
    const outcome = awardBonus(chapterId, spec.id);
    setPaid(outcome);
    if (outcome.granted > 0) sfx.reward();
  }, [phase, paid, chapterId, spec.id]);

  const ended = phase === 'won' || phase === 'lost';

  // The action bar. The primary is always the way out, because a bonus level is never in the path:
  // a learner who opens one can leave it at any moment and lose nothing.
  useEffect(() => {
    if (!setBar) return;
    setBar({
      primary: {
        label: phase === 'won' ? 'back to the climb' : 'leave it',
        disabled: false,
        onClick: () => onDone?.(),
      },
      // Offered only once a level has ENDED. A restart sitting under a round in progress is an
      // invitation to give up on the round the learner is standing in.
      secondary: ended ? { label: 'play again', onClick: start } : undefined,
    });
    return () => setBar(null);
  }, [setBar, phase, ended, onDone, start]);

  const stageRef = useRegisterTarget<HTMLDivElement>(`arcade-${spec.id}`, {
    kind: 'arcade',
    label: `bonus level: ${spec.title}, played as ${spec.game}`,
    getSceneState: () => ({
      title: spec.title,
      game: spec.game,
      phase,
      round: `${at + 1} of ${spec.rounds.length}`,
      prompt: round?.prompt,
      score,
      lives,
      ...(spec.seconds ? { secondsLeft: left } : {}),
    }),
    getValidActions: () => (phase === 'playing' ? ['play the round'] : ['start the level']),
    applyTutorAction: (patch) => {
      if (patch.start === true) start();
    },
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId,
      steps: [
        `bonus level: ${spec.title}`,
        `${spec.game} · ${phase}`,
        `round ${at + 1} of ${spec.rounds.length} · score ${score} · lives ${lives}`,
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, nodeId, spec, phase, at, score, lives]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  const copy = ARCADE_COPY[spec.game];
  const how = lite ? copy.lite : copy.how;

  const props: MechanicProps | null = round
    ? { round, run, hue, lite, reduced, onRight, onWrong }
    : null;

  return (
    <CardBody maxWidth={620} center={false}>
      <div ref={stageRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 12,
          }}
        >
          <div>
            <div style={whisper}>bonus level</div>
            <h2 style={{ ...cardTitle, marginTop: 6, marginBottom: 0 }}>{spec.title}</h2>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {spec.seconds ? (
              <div style={{ textAlign: 'right' }}>
                <div style={whisper}>time</div>
                <div
                  style={{
                    fontSize: '1.2rem',
                    fontWeight: 600,
                    color: 'var(--ink)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {left}
                </div>
              </div>
            ) : null}
            <div style={{ textAlign: 'right' }}>
              <div style={whisper}>score</div>
              <div
                style={{
                  fontSize: '1.2rem',
                  fontWeight: 600,
                  color: 'var(--ink)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {score}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }} role="img" aria-label={`${lives} lives left`}>
              {Array.from({ length: START_LIVES }, (_, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: three fixed life pips
                  key={i}
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    background: i < lives ? hue : 'var(--paper-3)',
                    transition: 'background 0.3s ease',
                  }}
                />
              ))}
            </div>
          </div>
        </header>

        {phase === 'playing' && props ? (
          <Field {...props} />
        ) : (
          <div
            style={{
              minHeight: 300,
              borderRadius: 16,
              background: 'var(--paper-2)',
              display: 'grid',
              placeItems: 'center',
              padding: 24,
              textAlign: 'center',
            }}
          >
            <motion.div
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: '1.2rem',
                  fontWeight: 540,
                  color: 'var(--ink)',
                  lineHeight: 1.35,
                }}
              >
                {phase === 'ready'
                  ? how
                  : phase === 'won'
                    ? `cleared, ${score} of ${spec.rounds.length}`
                    : `out of it at ${score} of ${spec.rounds.length}`}
              </p>
              {ended && paid ? (
                <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: '0.95rem', maxWidth: 340 }}>
                  {BONUS_LINES[paid.reason]}
                </p>
              ) : null}
              {phase === 'lost' && !lite ? (
                <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: '0.95rem', maxWidth: 340 }}>
                  nothing is lost here. the climb is exactly where you left it.
                </p>
              ) : null}
              <button
                type="button"
                onClick={start}
                style={{
                  minHeight: 44,
                  padding: '11px 24px',
                  borderRadius: 999,
                  border: 0,
                  background: hue,
                  color: 'var(--paper)',
                  fontFamily: 'inherit',
                  fontSize: '0.95rem',
                  fontWeight: 540,
                  cursor: 'pointer',
                }}
              >
                {phase === 'ready' ? 'start' : 'play again'}
              </button>
            </motion.div>
          </div>
        )}

        <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: '0.85rem' }}>
          round {Math.min(at + 1, spec.rounds.length)} of {spec.rounds.length}
        </p>
      </div>
    </CardBody>
  );
}

/**
 * A hand-authored level for the engine gallery — real items, and one of each mechanic would be six
 * demos, so this is the catch that already shipped. Every other mechanic is exercised by
 * `arcade/spec.test.ts` and by `tests/arcade.spec.ts` against the running app.
 */
export const ARCADE_DEMO: ArcadeSpec = parseArcade({
  id: 'demo-arcade',
  title: 'element catch',
  game: 'catch',
  skill: 'recall',
  rounds: [
    {
      id: 'r1',
      prompt: 'catch the element with 6 protons.',
      answer: 'carbon',
      distractors: ['oxygen', 'helium'],
      why: 'the proton count is what names an element, and carbon is the one with six.',
    },
    {
      id: 'r2',
      prompt: 'catch the particle with no charge.',
      answer: 'neutron',
      distractors: ['proton', 'electron'],
      why: 'a proton is positive and an electron negative, so the neutral one is the neutron.',
    },
    {
      id: 'r3',
      prompt: 'catch what decides the element.',
      answer: 'proton count',
      distractors: ['electron count', 'neutron count'],
      why: 'electrons and neutrons can change without the element changing. protons cannot.',
    },
  ],
}) as ArcadeSpec;

/** Six, and a seventh is a row in `MECHANICS` plus a shape in `specs.py`. Read by the gallery. */
export const ARCADE_MECHANIC_COUNT = Object.keys(MECHANICS).length;
