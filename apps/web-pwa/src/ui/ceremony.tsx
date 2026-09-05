'use client';

/**
 * The ceremony (Fable's design) — the award moment for a genuine milestone. On earn: the world
 * blurs and dims, a column of light opens, the trophy DESCENDS with weight and a puff of light-
 * dust, a specular sweep crosses it, a physics-true confetti burst fires once, the warm fanfare
 * sounds (sfx.fanfare, mute-aware), and Wobo jumps and speaks one honest line. It rests on a
 * quiet self-superlative from real data — never a fabricated percentile — then the trophy shrinks
 * and arcs toward its shelf as the blur lifts and a whisper points there.
 *
 * Laws: 3px corners, no shadows, one hit of pigment (the track hue; gold and paper-white are its
 * two ceremonial accents). Sound rides sfx / speakLine (wobo-voice-muted-v1) — never a second
 * system. Reduced motion collapses to a crossfade, a static trophy, and a single shimmer — no
 * confetti, no descent, no dust.
 */

import { fontFamily } from '@wobo/config';
import { WoboBody } from '@wobo/wobo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { GOLD, rgba } from '../screens/course/shared';
import { useRouter } from '../shell/router';
import { useProgress } from '../store/progress';
import { speakLine } from '../wobo/speech';
import { resolvedColor } from './hues';
import { sfx } from './sound';
import { Trophy, type TrophyAward } from './trophies';

const PAPER = '#FFFFFF';
// The three ceremonial colors, exactly (spec): the track hue, gold, and paper-white. No loop.
// A canvas takes a colour string, not a token, so the two that are tokens are read off the live
// document here — the one place in the app that has to resolve a variable by hand.
function confettiColors(hue: string): [string, string, string] {
  return [resolvedColor(hue), resolvedColor(GOLD, '#FFB629'), PAPER];
}

/**
 * A one-shot, physics-true confetti burst on a canvas — gravity, air drag, and a per-piece flutter
 * (each rectangle tumbles, its width breathing as it spins). Runs ~1.8s then stops cold; never
 * loops. Exactly three colors. Silent (the fanfare carries the sound).
 */
export function Confetti({ hue }: { hue: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const colors = confettiColors(hue);

    // burst from the trophy's height, fountaining up and out before gravity takes over
    const ox = W / 2;
    const oy = H * 0.42;
    const N = 90;
    const pieces = Array.from({ length: N }, (_, i) => {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4; // mostly upward
      const speed = 6 + Math.random() * 9;
      return {
        x: ox + (Math.random() - 0.5) * 40,
        y: oy + (Math.random() - 0.5) * 20,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        w: 5 + Math.random() * 5,
        h: 8 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.4,
        flutter: Math.random() * Math.PI * 2,
        color: colors[i % 3] as string,
      };
    });

    const gravity = 0.32;
    const drag = 0.98;
    const start = performance.now();
    const DURATION = 1800;
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      const fade = t > DURATION - 400 ? Math.max(0, (DURATION - t) / 400) : 1;
      for (const p of pieces) {
        p.vy += gravity;
        p.vx *= drag;
        p.vy *= drag;
        p.flutter += 0.16;
        // flutter: a light sideways drift + the face turning edge-on and back
        p.x += p.vx + Math.sin(p.flutter) * 0.9;
        p.y += p.vy;
        p.rot += p.vrot;
        const squash = Math.abs(Math.cos(p.flutter)); // the paper turning in the air
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = fade;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * squash + 1);
        ctx.restore();
      }
      if (t < DURATION) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hue]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}

/** A soft puff of light-dust at the moment the trophy lands. */
function DustPuff({ hue, delay }: { hue: string; delay: number }) {
  const bits = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return { id: i, x: Math.cos(a) * (40 + (i % 3) * 14), y: Math.sin(a) * (18 + (i % 3) * 8) };
  });
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {bits.map((b) => (
        <motion.span
          key={b.id}
          initial={{ x: 0, y: 40, opacity: 0, scale: 0.4 }}
          animate={{ x: b.x, y: 40 + b.y * 0.4, opacity: [0, 0.7, 0], scale: [0.4, 1, 0.5] }}
          transition={{ duration: 0.7, delay, ease: [0.2, 0, 0.2, 1] }}
          style={{
            position: 'absolute',
            width: 5,
            height: 5,
            borderRadius: 999,
            background: b.id % 3 === 0 ? GOLD : hue,
            filter: 'blur(0.4px)',
          }}
        />
      ))}
    </div>
  );
}

export function Ceremony({ award, onDismiss }: { award: TrophyAward; onDismiss: () => void }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const dismissed = useRef(false);

  // sound + voice land on the same beat as the light (DESIGN law): the fanfare, then Wobo's one line.
  useEffect(() => {
    sfx.fanfare();
    void speakLine(award.woboLine, { beat: 'win' }); // pleased, not thrilled (voice.md 10b)
  }, [award.woboLine]);

  // Wobo rests on screen a moment, then the trophy leaves for its shelf. A tap skips the wait.
  const leave = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    setPhase('out');
    window.setTimeout(onDismiss, reduced ? 260 : 820);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: reduced is the only real trigger; leave is stable-enough (guarded by a ref) and re-arming on its identity would restart the timer
  useEffect(() => {
    const t = window.setTimeout(leave, reduced ? 2600 : 4400);
    return () => window.clearTimeout(t);
  }, [reduced]);

  const going = phase === 'out';
  // the descent → settle spring: weighty, with a visible overshoot as it lands
  const trophyLanding = reduced
    ? { y: 0, opacity: 1, scale: 1 }
    : {
        y: 0,
        opacity: 1,
        scale: 1,
        transition: { type: 'spring', stiffness: 150, damping: 12, mass: 1.1 },
      };

  return (
    <motion.div
      role="dialog"
      aria-label={`${award.title} earned`}
      onClick={leave}
      initial={{ opacity: 0 }}
      animate={{ opacity: going ? 0 : 1 }}
      transition={{ duration: reduced ? 0.2 : 0.34 }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--wobo-z-toast)' as unknown as number,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        // the world blurs and dims behind the moment
        background: 'color-mix(in srgb, var(--wobo-ink-900) 30%, transparent)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        cursor: 'pointer',
        padding: 24,
        textAlign: 'center',
      }}
    >
      {/* a soft vignette deepens the dim toward the edges, pulling the eye to the column of light */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, transparent 34%, color-mix(in srgb, var(--wobo-ink-900) 26%, transparent) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* the column of light the trophy descends through */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0, scaleY: 0.6 }}
        animate={{ opacity: going ? 0 : 1, scaleY: 1 }}
        transition={{ duration: reduced ? 0.2 : 0.6, ease: [0.2, 0, 0.2, 1] }}
        style={{
          position: 'absolute',
          top: '10%',
          width: 220,
          height: '62%',
          transformOrigin: 'top center',
          background: `linear-gradient(180deg, ${rgba(award.hue, 0.19)} 0%, ${rgba(award.hue, 0.06)} 40%, transparent 82%)`,
          filter: 'blur(6px)',
          pointerEvents: 'none',
        }}
      />

      {!reduced && !going && <Confetti hue={award.hue} />}

      {/* the trophy — descends with weight, arcs to its shelf on the way out */}
      <motion.div
        initial={reduced ? { opacity: 0, scale: 0.96 } : { y: -180, opacity: 0, scale: 0.9 }}
        animate={
          going
            ? {
                y: -140,
                x: '38vw',
                scale: 0.18,
                opacity: 0,
                transition: { duration: 0.8, ease: [0.5, 0, 0.75, 0.2] },
              }
            : trophyLanding
        }
        style={{ position: 'relative', display: 'grid', placeItems: 'center' }}
      >
        {/* specular sweep — a band of light crossing the metal once, after it lands */}
        {!reduced && !going && (
          <motion.div
            aria-hidden
            initial={{ x: '-140%', opacity: 0 }}
            animate={{ x: '140%', opacity: [0, 0.9, 0] }}
            transition={{ duration: 0.7, delay: 0.85, ease: 'easeInOut' }}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              background:
                'linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.85) 50%, transparent 60%)',
              mixBlendMode: 'screen',
              pointerEvents: 'none',
            }}
          />
        )}
        <Trophy
          form={award.form}
          tier={award.tier}
          hue={award.hue}
          size={148}
          engrave={award.engrave}
        />
        {!reduced && !going && <DustPuff hue={award.hue} delay={0.62} />}
        {/* the impact ring — a single hairline shockwave expands as the trophy lands: felt weight */}
        {!reduced && !going && (
          <motion.div
            aria-hidden
            initial={{ scale: 0.2, opacity: 0 }}
            animate={{ scale: 1.7, opacity: [0, 0.65, 0] }}
            transition={{ duration: 0.9, delay: 0.62, ease: [0.2, 0, 0.2, 1] }}
            style={{
              position: 'absolute',
              inset: 0,
              margin: 'auto',
              width: 176,
              height: 176,
              borderRadius: 999,
              border: `1px solid ${award.hue}`,
              pointerEvents: 'none',
            }}
          />
        )}
        {/* reduced-motion: a single quiet shimmer stands in for the whole sequence */}
        {reduced && (
          <motion.div
            aria-hidden
            initial={{ x: '-120%' }}
            animate={{ x: '120%' }}
            transition={{ duration: 1.1, delay: 0.2, ease: 'easeInOut' }}
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(115deg, transparent 42%, rgba(255,255,255,0.7) 50%, transparent 58%)',
              mixBlendMode: 'screen',
              pointerEvents: 'none',
            }}
          />
        )}
      </motion.div>

      {/* the title and the honest standing line */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: going ? 0 : 1, y: going ? 6 : 0 }}
        transition={{ delay: reduced ? 0.1 : 0.95, duration: 0.5, ease: [0.2, 0, 0, 1] }}
        style={{ marginTop: 18, maxWidth: 360 }}
      >
        <div
          style={{
            fontSize: 'clamp(1.5rem, 5vw, 2rem)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: PAPER,
          }}
        >
          {award.title}
        </div>
        <div style={{ marginTop: 8, fontSize: '0.86rem', color: 'rgba(255,255,255,0.72)' }}>
          {award.standingLine}
        </div>
        {/* the reserved cohort slot — rendered ONLY when real cohort data exists someday */}
        {award.cohortPercentile != null && (
          <div style={{ marginTop: 4, fontSize: '0.86rem', color: 'rgba(255,255,255,0.72)' }}>
            top {Math.round(100 - award.cohortPercentile)}% of learners on this
          </div>
        )}
      </motion.div>

      {/* Wobo — Wobo jumps as the trophy lands, and Wobo's one line arrives in Wobo's hand */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: going ? 0 : 1 }}
        transition={{ delay: reduced ? 0.15 : 1.15, duration: 0.5 }}
        style={{
          marginTop: 22,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <motion.div
          animate={reduced || going ? undefined : { y: [0, -22, 0, -9, 0] }}
          transition={{
            delay: 0.85,
            duration: 0.9,
            ease: [0.3, 0, 0.3, 1],
            times: [0, 0.3, 0.6, 0.8, 1],
          }}
        >
          <WoboBody size={64} mood="celebrate" />
        </motion.div>
        <div
          style={{
            fontFamily: fontFamily.handwritten,
            fontSize: '1.15rem',
            lineHeight: 1.35,
            color: PAPER,
            maxWidth: 320,
          }}
        >
          {award.woboLine}
        </div>
      </motion.div>

      {/* the exit whisper — the trophy has a home now */}
      <AnimatePresence>
        {going && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'absolute',
              bottom: '18%',
              fontSize: '0.8rem',
              letterSpacing: '0.08em',
              color: 'rgba(255,255,255,0.66)',
            }}
          >
            Visit your shelf
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Routes that own the viewport bring their own celebrations (the course greeting theatre) — the
// ceremony never doubles over them; a queued trophy simply waits until the learner is back out.
const IMMERSIVE = new Set(['course', 'sandbox', 'onboarding', 'building', 'concept']);

/** Always-mounted: shows the head of the trophy queue as a ceremony, one at a time. */
export function CeremonyHost() {
  const { trophies, dismissTrophy } = useProgress();
  const { route } = useRouter();
  const head = trophies[0];
  const show = head && !IMMERSIVE.has(route.name);
  return (
    <AnimatePresence>
      {show && <Ceremony key={head.id} award={head} onDismiss={() => dismissTrophy(head.id)} />}
    </AnimatePresence>
  );
}
