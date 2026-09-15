'use client';

/**
 * The moment right after setup, before the world opens.
 *
 * The old "frame" — a bundled catalog assembled per board and grade — is gone (WOBO-PLAN §13).
 * What happens here now is the real thing: the learner's pinned framework is asked for the
 * subjects of their class, and Wobo narrates it honestly while a skeleton constellation forms.
 *
 * Three ends, all true. A class we hold a syllabus for opens with the welcome moment and the
 * board's own subject names. A class we hold nothing for shows the discovery job actually running,
 * in its own words, with the own-syllabus door beside it. No board at all sends them back to
 * choosing one. None of the three shows a subject the learner's board does not teach.
 */

import { useWoboBus, WaitScene, WoboBody, type WoboMood } from '@wobo/wobo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ONBOARDED_KEY } from '../App';
import { chooseLevel } from '../curriculum/adopt';
import { useWorld } from '../curriculum/hooks';
import { ProvenanceLabel } from '../curriculum/Labels';
import { DiscoveryCard, EmptyWorldCard } from '../curriculum/StatusCard';
import { useRouter } from '../shell/router';
import { lifetimeSnapshot } from '../store/mind';
import { useProgress } from '../store/progress';
import { scoped } from '../store/scope';
import { useSdk } from '../store/sdk';
import { SubjectGlyph } from '../ui/art';
import { Confetti } from '../ui/ceremony';
import { toneForSubject } from '../ui/hues';
import { fluidSpace, MagneticButton } from '../ui/kit';
import { sfx } from '../ui/sound';
import { speakLine } from '../wobo/speech';
import { loadProfile } from './you/profile';

const ULTRA = 'var(--pig)';

type Phase = 'building' | 'welcome' | 'empty';

/** A deterministic skeleton constellation — nodes and the near-neighbour edges between them. */
function useConstellation(seed: number) {
  return useMemo(() => {
    // a tiny LCG so the shape is stable within a session but varied across learners
    let s = seed || 1;
    const rand = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const nodes = Array.from({ length: 13 }, (_, i) => ({
      id: i,
      x: 12 + rand() * 76,
      y: 14 + rand() * 72,
    }));
    const edges: { a: number; b: number }[] = [];
    for (let i = 0; i < nodes.length; i++) {
      // link each node to its nearest yet-unlinked forward neighbour — a sparse, tree-like web
      let best = -1;
      let bestD = Infinity;
      for (let j = i + 1; j < nodes.length; j++) {
        const na = nodes[i];
        const nb = nodes[j];
        if (!na || !nb) continue;
        const d = (na.x - nb.x) ** 2 + (na.y - nb.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best >= 0) edges.push({ a: i, b: best });
    }
    return { nodes, edges };
  }, [seed]);
}

function SkeletonConstellation({ reduced }: { reduced: boolean }) {
  const seed = useMemo(() => Math.floor(Math.random() * 1e6), []);
  const { nodes, edges } = useConstellation(seed);
  return (
    <svg
      viewBox="0 0 100 100"
      role="presentation"
      aria-hidden
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.9 }}
    >
      {edges.map((e, i) => {
        const a = nodes[e.a];
        const b = nodes[e.b];
        if (!a || !b) return null;
        return (
          <motion.line
            key={`e-${e.a}-${e.b}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={ULTRA}
            strokeOpacity={0.24}
            strokeWidth={0.35}
            initial={reduced ? { pathLength: 1, opacity: 0.24 } : { pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.24 }}
            transition={{ duration: 0.7, delay: 0.5 + i * 0.12, ease: [0.2, 0, 0, 1] }}
          />
        );
      })}
      {nodes.map((n, i) => (
        <motion.circle
          key={n.id}
          cx={n.x}
          cy={n.y}
          r={i % 4 === 0 ? 1.5 : 1}
          fill={ULTRA}
          fillOpacity={i % 4 === 0 ? 0.85 : 0.5}
          initial={reduced ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
          animate={
            reduced
              ? { scale: 1, opacity: 1 }
              : {
                  scale: 1,
                  opacity: 1,
                  transition: { delay: i * 0.09, type: 'spring', stiffness: 320, damping: 18 },
                }
          }
        >
          {!reduced && i % 4 === 0 && (
            <animate
              attributeName="fill-opacity"
              values="0.85;0.35;0.85"
              dur="2.4s"
              repeatCount="indefinite"
            />
          )}
        </motion.circle>
      ))}
    </svg>
  );
}

/** The real subject doors, cascading in during the welcome — in the board's own naming and order. */
function WelcomeDoors({ subjects, reduced }: { subjects: string[]; reduced: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        justifyContent: 'center',
        maxWidth: 460,
      }}
    >
      {subjects.slice(0, 6).map((name, i) => {
        const tone = toneForSubject(name);
        return (
          <motion.div
            key={name}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={
              reduced
                ? { duration: 0.2, delay: 0.1 + i * 0.06 }
                : { delay: 0.35 + i * 0.09, type: 'spring', stiffness: 300, damping: 20 }
            }
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              width: 116,
              padding: '16px 10px',
              background: tone.wash,
              borderRadius: 3,
            }}
          >
            <SubjectGlyph subjectId={name} size={46} accent />
            <span
              style={{
                fontSize: '0.82rem',
                fontWeight: 600,
                color: 'var(--wobo-ink-900)',
                textAlign: 'center',
                lineHeight: 1.25,
              }}
            >
              {name}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

export function FrameBuilding() {
  const router = useRouter();
  const sdk = useSdk();
  const bus = useWoboBus();
  const { award } = useProgress();
  const reduced = useReducedMotion() ?? false;
  const world = useWorld();

  const profile = useMemo(() => loadProfile(), []);
  const firstName = profile.name.split(' ')[0] || profile.name;
  const label = world?.frameworkName ?? '';
  const level = world?.level ?? '';

  const [phase, setPhase] = useState<Phase>(world ? 'building' : 'empty');
  const [subjects, setSubjects] = useState<string[]>(world?.subjects ?? []);
  const [mood, setMood] = useState<WoboMood>('thinking');
  const [trouble, setTrouble] = useState<string | null>(null);
  const ran = useRef(false);

  /**
   * The wait a learner pays once for their whole board (docs/BOARD-COLD-START.md §2, step 2): "a
   * designed wait, not a spinner... the orb draws something from their subject. It never says what
   * it is doing, never shows a percentage, and never mentions a syllabus." The four rotating lines
   * that used to be here — opening your shelf, laying your subjects out, wiring the chapters,
   * almost there — were the software describing itself to a child on their first screen.
   *
   * The scene is their FIRST subject's, because that is the one they are most likely to open.
   */
  const waitSubject = subjects[0] ?? world?.subjects?.[0] ?? '';

  useEffect(() => {
    bus.publishPage({
      route: 'building',
      state: { board: world?.frameworkId ?? null, grade: level, phase },
    });
  }, [bus, world?.frameworkId, level, phase]);

  // The one real job: ask the learner's own framework for the subjects of their class.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run-once, guarded by the ran ref
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!world?.level) {
      setPhase('empty');
      return;
    }
    const startedAt = performance.now();
    const already = world.subjects.length > 0;
    const settle = (found: string[], error: string | null) => {
      // Hold the building beat so it never flashes — shorter when the answer was already here.
      const floor = already ? 900 : 1700;
      window.setTimeout(
        () => {
          setTrouble(error);
          if (found.length > 0) {
            setSubjects(found);
            setMood('celebrate');
            setPhase('welcome');
          } else {
            setMood('idle');
            setPhase('empty');
          }
        },
        Math.max(0, floor - (performance.now() - startedAt)),
      );
    };
    if (already) settle(world.subjects, null);
    else
      void chooseLevel(world.level).then((result) =>
        settle(result.world?.subjects ?? [], result.error),
      );
  }, []);

  const welcomed = useRef(false);
  useEffect(() => {
    if (phase !== 'welcome' || welcomed.current) return;
    welcomed.current = true;
    sfx.fanfare();
    void speakLine(`Welcome, ${firstName}. This is all yours — let's begin.`);
  }, [phase, firstName]);

  const finish = (to: 'home' | 'learn' | 'you') => {
    award('account'); // +50, blooms on home
    try {
      sdk.events.record('onboarding.step.completed.v1', {
        step: 'aha',
        step_index: 0,
        total_steps: 1,
      });
    } catch {
      // event stream best-effort
    }
    bus.publishLifetime(lifetimeSnapshot());
    scoped.setItem(ONBOARDED_KEY, '1');
    // live mode rebuilds on the real session so providers re-key to auth.uid()
    if (!sdk.config.devAuth) {
      window.location.assign('/');
      return;
    }
    router.replace({ name: to });
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        padding: `${fluidSpace.xl} ${fluidSpace.gutter}`,
        position: 'relative',
        isolation: 'isolate',
        gap: fluidSpace.lg,
        textAlign: 'center',
      }}
    >
      {/* LAW v5 (DESIGN.md §0): the ground is white, and no surface takes a wash to say it is
          a surface. The two radial glows that used to sit here were exactly that, and on the
          white paper they read as a stain. What carries this screen is the constellation. */}
      {phase === 'welcome' && !reduced && <Confetti hue={ULTRA} />}

      {/* the constellation stage behind Wobo — the skeleton of the course, forming */}
      <div style={{ position: 'relative', width: 'min(560px, 86vw)', height: 300 }}>
        <AnimatePresence>
          {phase === 'building' && (
            <motion.div
              key="constellation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.4 } }}
              style={{ position: 'absolute', inset: 0 }}
            >
              <SkeletonConstellation reduced={reduced} />
            </motion.div>
          )}
        </AnimatePresence>

        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <motion.div
            animate={
              phase === 'welcome' && !reduced
                ? { y: [0, -26, 0, -11, 0] }
                : phase === 'building' && !reduced
                  ? { y: [0, -6, 0] }
                  : { y: 0 }
            }
            transition={
              phase === 'welcome'
                ? { duration: 0.95, ease: [0.3, 0, 0.3, 1], times: [0, 0.3, 0.6, 0.8, 1] }
                : { duration: 3, repeat: Infinity, ease: 'easeInOut' }
            }
          >
            <WoboBody size={112} mood={mood} label="Wobo" />
          </motion.div>
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 560, minHeight: 150 }}>
        <AnimatePresence mode="wait">
          {phase === 'building' && (
            <motion.div
              key="building"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
            >
              <WaitScene
                subject={waitSubject}
                pigment={toneForSubject(waitSubject).hue}
                orb={false}
                width={240}
              />
            </motion.div>
          )}

          {phase === 'welcome' && world && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    fontSize: 'clamp(1.6rem, 1.2rem + 1.8vw, 2.2rem)',
                    fontWeight: 650,
                    letterSpacing: '-0.03em',
                    color: 'var(--wobo-ink-900)',
                  }}
                >
                  Welcome, {firstName}
                </div>
                <div style={{ fontSize: '0.95rem', color: 'var(--wobo-ink-500)' }}>
                  Your {label} · {level} world is ready
                </div>
                {/* §5: how well we know this syllabus, said here before anything is taught. */}
                <ProvenanceLabel
                  status={world.status}
                  label={world.label}
                  name={world.frameworkName}
                  version={world.versionYear}
                  style={{ textAlign: 'center' }}
                />
              </div>
              <WelcomeDoors subjects={subjects} reduced={reduced} />
              <MagneticButton
                size="lg"
                variant="primary"
                onClick={() => finish('home')}
                style={{ minWidth: 150, justifyContent: 'center' }}
              >
                Step in
              </MagneticButton>
            </motion.div>
          )}

          {phase === 'empty' && (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 18 }}
            >
              {world ? (
                <>
                  <div
                    style={{
                      fontSize: 'clamp(1.3rem, 1.1rem + 1.2vw, 1.7rem)',
                      fontWeight: 640,
                      letterSpacing: '-0.02em',
                      color: 'var(--wobo-ink-900)',
                      textAlign: 'center',
                    }}
                  >
                    I do not have {label} {level} yet, {firstName}
                  </div>
                  <DiscoveryCard
                    view={null}
                    // Onboarding hands this card no answer at all (`view={null}`), so there is
                    // never a plan here and never a row to press. If one ever arrives, the honest
                    // door is the end of onboarding on the board the plan actually lives on —
                    // `finish` either replaces the route or reloads on the real session, so a
                    // course opened over the top of it would be thrown away either way.
                    onStart={() => finish('learn')}
                    onOwnSyllabus={() => finish('you')}
                  />
                  <MagneticButton
                    size="lg"
                    variant="quiet"
                    onClick={() => finish('home')}
                    style={{ justifyContent: 'center' }}
                  >
                    Take me in anyway
                  </MagneticButton>
                </>
              ) : (
                <EmptyWorldCard onChooseBoard={() => router.replace({ name: 'onboarding' })} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
