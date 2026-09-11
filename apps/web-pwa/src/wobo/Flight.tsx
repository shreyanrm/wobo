'use client';

/**
 * Wobo in flight. On every page Wobo flies in from somewhere — arcs through the room, banks
 * into the turn, and settles onto Wobo's dock with a soft bounce. Wobo never stops floating: docked,
 * a slow organic drift (bob, a whisper of sway and tilt) keeps Wobo mid-swoosh — the same being
 * that glides between routes, never a metronome, never a beam pinning Wobo to the ground.
 */

import { useReducedMotion } from '@wobo/motion';
import {
  type TrackRect,
  type WoboBehaviour,
  WoboBody,
  type WoboExpression,
  type WoboMood,
} from '@wobo/wobo';
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTime,
  useTransform,
  useVelocity,
} from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

// Once per browser session Wobo performs the full arrival; after that Wobo only glides.
const FLEW_KEY = 'wobo-flew';

export function FlyingWobo({
  routeKey,
  mood,
  gestureAngle,
  focus,
  idleSince,
  behaviour,
  behaviourKey,
  onTap,
  onDoubleTap,
  onHoldStart,
  onHoldEnd,
  size = 68,
}: {
  routeKey: string;
  mood: WoboMood | WoboExpression;
  /** Direction (radians) Wobo leans + gazes toward while explaining — toward the ink Wobo is drawing. */
  gestureAngle?: number;
  /** What the learner pointed at: Wobo's eyes go there before anything else. */
  focus?: TrackRect | null;
  /** When the learner last did anything, anywhere — Wobo's idle life runs off real quiet, not a timer. */
  idleSince?: number;
  /** One played behaviour — Wobo leans, points, or startles when something real happens. */
  behaviour?: WoboBehaviour | null;
  behaviourKey?: string | number;
  onTap: () => void;
  onDoubleTap?: () => void;
  /** Push-to-talk on Wobo's docked body — forwarded straight to WoboBody. */
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  size?: number;
}) {
  const reduced = useReducedMotion();
  const time = useTime();
  const [flying, setFlying] = useState(false);
  const lastRoute = useRef<string>('');

  // The entrance offset from the dock, driven by force — not keyframes. At rest it sits at 0
  // (docked); a flight jumps it off-screen then springs it home, so acceleration, the banked
  // arc, overshoot and settle all fall out of the physics instead of being authored.
  const ex = useMotionValue(0);
  const ey = useMotionValue(0);
  const op = useMotionValue(0);
  // Anticipation squash — Wobo loads before Wobo launches.
  const sqx = useMotionValue(1);
  const sqy = useMotionValue(1);
  // Banking is truthful: it reads Wobo's real horizontal velocity and relaxes to 0 as Wobo settles.
  const evx = useVelocity(ex);
  const bank = useTransform(evx, (v) => Math.max(-22, Math.min(22, v * 0.012)));

  // Docked responsiveness: Wobo drifts a few px toward the cursor — alive, never in the way.
  const px = useSpring(0, { stiffness: 60, damping: 18 });
  const py = useSpring(0, { stiffness: 60, damping: 18 });
  useEffect(() => {
    if (reduced) return; // reduced-motion: Wobo stays put — no drift, no pointer lean.
    const onMove = (e: PointerEvent) => {
      px.set(Math.max(-8, Math.min(8, (e.clientX - window.innerWidth + 60) * 0.02)));
      py.set(Math.max(-8, Math.min(8, (e.clientY - window.innerHeight + 60) * 0.02)));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [px, py, reduced]);

  // The perpetual idle drift — docked, Wobo wanders a slow organic loop, not a metronomic bob.
  // Layered incommensurate periods (bob ≈5s, sway ≈6.6s, tilt ≈5.6s) with phase offsets trace a
  // soft Lissajous float; the spring/velocity feel rides in on Wobo's pointer springs folded below.
  const driftY = useTransform(time, (ms) =>
    reduced ? 0 : Math.sin(ms / 800) * 7 + Math.sin(ms / 520) * 1.3,
  );
  const driftX = useTransform(time, (ms) =>
    reduced ? 0 : Math.sin(ms / 1050 + 0.7) * 3 + Math.sin(ms / 680) * 0.8,
  );
  const driftRot = useTransform(time, (ms) => (reduced ? 0 : Math.sin(ms / 900 + 1.3) * 1.5));

  // Pointer drift folded into the same values — velocity-continuous springs, Wobo's route-glide feel.
  const idleX = useTransform([driftX, px], ([d, p]: number[]) => (d ?? 0) + (p ?? 0));
  const idleY = useTransform([driftY, py], ([d, p]: number[]) => (d ?? 0) + (p ?? 0));

  useEffect(() => {
    if (lastRoute.current === routeKey) return;
    lastRoute.current = routeKey;

    // Reduced motion collapses the whole thing to a fade — no travel, no lean.
    if (reduced) {
      ex.jump(0);
      ey.jump(0);
      animate(op, 1, { duration: 0.3 });
      return;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    const flew = sessionStorage.getItem(FLEW_KEY);

    // FREQUENCY LAW: later route changes get a short, low-amplitude glide into the dock —
    // present already, Wobo just eases back in. Never the grand arrival twice.
    if (flew) {
      op.set(1);
      ex.jump(-Math.min(46, w * 0.05));
      ey.jump(-Math.min(26, h * 0.04));
      animate(ex, 0, { type: 'spring', stiffness: 140, damping: 20 });
      animate(ey, 0, { type: 'spring', stiffness: 170, damping: 22 });
      return;
    }

    // The full arrival — once per session. One continuous force curve from off-screen to dock.
    sessionStorage.setItem(FLEW_KEY, '1');
    const small = w < 760 || h < 560;
    ex.jump(-(small ? w * 0.5 : w * 0.72));
    ey.jump(-(small ? h * 0.36 : h * 0.44));
    op.set(0);
    setFlying(true);

    // Anticipation: the squash is Wobo's visible load, and an underdamped spring eases in from rest
    // on its own — Wobo barely moves for the first breath, then launches. No timing gap to cancel.
    animate(op, 1, { duration: 0.24 });
    animate(sqx, [1, 1.12, 0.98, 1], { duration: 0.34, ease: 'easeOut' });
    animate(sqy, [1, 0.86, 1.04, 1], { duration: 0.34, ease: 'easeOut' });

    // y catches home faster than x, so the trajectory bows into an arc — no control points.
    // Underdamped springs (ratio < 1) give the overshoot-and-settle the law asks for, for free.
    animate(ey, 0, { type: 'spring', stiffness: 90, damping: 15 });
    const home = animate(ex, 0, { type: 'spring', stiffness: 45, damping: 13 });
    void home.then(() => setFlying(false)).catch(() => setFlying(false));

    // No matter what interrupts the flight, Wobo always lands, visible, on Wobo's dock.
    const safety = window.setTimeout(() => {
      ex.jump(0);
      ey.jump(0);
      op.set(1);
      sqx.set(1);
      sqy.set(1);
      setFlying(false);
    }, 3000);
    return () => window.clearTimeout(safety);
  }, [routeKey, reduced, ex, ey, op, sqx, sqy]);

  return (
    <motion.div
      style={{
        position: 'fixed',
        right: 22,
        // ABOVE THE TAB RAIL, NEVER INSIDE IT (the adversary, wave 47, finding 8). At 390 on
        // /doubt this control sat at [298,740,68,68] with the rail at [0,773,390,71]: its bottom
        // 35 px behind the one bar a child uses to move between screens, in light, dark and
        // reduced motion alike. The rail publishes `--rail-h` so that everything pinned to the
        // foot of a phone can stand above it; this now reads it, and the safe-area strip the rail
        // pads itself with on top of that. On a laptop there is no rail and the token is 0px.
        bottom: 'calc(26px + var(--rail-h, 0px) + env(safe-area-inset-bottom))',
        opacity: op,
        zIndex: 'var(--wobo-z-woboPresence)' as unknown as number,
        pointerEvents: flying ? 'none' : 'auto',
      }}
    >
      {/* The flight body — position, bank and squash all live on real motion values. */}
      <motion.div style={{ x: ex, y: ey, rotate: bank, scaleX: sqx, scaleY: sqy }}>
        <motion.div style={{ x: idleX, y: idleY, rotate: driftRot }}>
          {/* Wobo's motion flame — an upside-down fire, trailing beneath Wobo as Wobo flies. */}
          <motion.div
            aria-hidden
            animate={{ opacity: flying ? 1 : 0 }}
            transition={{ duration: flying ? 0.2 : 0.45 }}
            style={{
              position: 'absolute',
              left: '50%',
              top: '62%',
              width: size * 0.86,
              height: size * 1.35,
              translateX: '-50%',
              transformOrigin: '50% 0%',
              pointerEvents: 'none',
              filter: 'blur(1.5px)',
            }}
          >
            <motion.svg
              viewBox="0 0 40 60"
              width="100%"
              height="100%"
              animate={{
                scaleY: [1, 1.28, 0.92, 1.18, 1],
                scaleX: [1, 0.92, 1.06, 0.95, 1],
                skewX: [0, -3, 2.5, -2, 0],
              }}
              transition={{ duration: 0.55, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
              style={{ transformOrigin: '50% 8%', display: 'block', overflow: 'visible' }}
            >
              {/* outer tongue — molten into rose */}
              <path
                d="M20 58 C7 41 2 30 6 18 C9 9 14 5 20 3 C26 5 31 9 34 18 C38 30 33 41 20 58 Z"
                fill="rgba(240,97,155,0.55)"
              />
              <path
                d="M20 54 C9 39 5 30 8.5 19 C11 11 15 7 20 5.5 C25 7 29 11 31.5 19 C35 30 31 39 20 54 Z"
                fill="#FF5A1F"
                opacity="0.85"
              />
              {/* the hot core */}
              <motion.path
                d="M20 46 C13 36 11 29 13 22 C15 16 17.5 13.5 20 12.5 C22.5 13.5 25 16 27 22 C29 29 27 36 20 46 Z"
                fill="#FFD9A8"
                animate={{ scaleY: [1, 1.2, 0.9, 1.15, 1] }}
                transition={{ duration: 0.4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
                style={{ transformOrigin: '50% 20%' }}
              />
            </motion.svg>
          </motion.div>
          <WoboBody
            size={size}
            mood={flying ? 'hint' : mood}
            // Wobo's eyes go, in order, to what the learner circled, then to the ink Wobo is laying
            // down, then to the cursor. Flight owns Wobo's gaze during arrival, so none of it applies
            // until Wobo has landed.
            focus={flying ? null : (focus ?? null)}
            gaze={flying || focus ? undefined : gestureAngle !== undefined ? undefined : 'pointer'}
            gestureAngle={flying ? undefined : gestureAngle}
            {...(idleSince !== undefined ? { idleSince } : {})}
            {...(flying ? {} : { behaviour: behaviour ?? null })}
            {...(behaviourKey !== undefined ? { behaviourKey } : {})}
            onTap={onTap}
            {...(onDoubleTap ? { onDoubleTap } : {})}
            // Push-to-talk only once Wobo has landed — a hold during the arrival would fight it.
            onHoldStart={flying ? undefined : onHoldStart}
            onHoldEnd={flying ? undefined : onHoldEnd}
            label="Talk to Wobo"
          />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
