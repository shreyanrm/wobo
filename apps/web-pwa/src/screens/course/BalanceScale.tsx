'use client';

/**
 * Guided discovery — the balance scale (DESIGN.md §9, the keystone grammar). x + 3 = 8 sits on a
 * real springy scale. The learner drags weights off the pans; the beam tips honestly (x weighs 5
 * underneath). The principle — whatever you do to one side, do to the other — appears only AFTER
 * the act: pose, struggle, reveal.
 *
 * LAW v5 (DESIGN.md §0): every colour on this scale is a token. The pale-blue and dark-grey
 * gradients this was drawn with were light-theme-only — on night they turned a weight into a
 * bright slab and the pillar into a hole — and the flat fills are also the hand DESIGN.md §4 asks
 * for: ink and wash, never a bevel.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BarState } from './shared';
import { CardBody, cardTitle, GOLD, lead, Stage, whisper } from './shared';

const STAGE_W = 540;
const STAGE_H = 234;
const BEAM_Y = 46;
const HALF = 196;
const PAN_W = 148;
const STRING = 64;
const X_WEIGHT = 5; // what x truly weighs — the scale never lies

const HUE = 'var(--wobo-ultramarine)';
const INK = 'var(--wobo-ink)';

const spring = { type: 'spring', stiffness: 150, damping: 14 } as const;
const rad = (deg: number) => (deg * Math.PI) / 180;

function UnitWeight({
  onRemove,
  removable,
  restore = false,
}: {
  onRemove: () => void;
  removable: boolean;
  restore?: boolean;
}) {
  // A weight that has just been taken off stays in the page while it leaves. It must not still be
  // a weight: under reduced motion the next tap used to land on it and do nothing, so every other
  // tap was lost. Leaving, it has no name, takes no tap and lets the tap through to the next one.
  const present = useIsPresent();
  const live = present && (removable || restore);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: restore ? 10 : -22, scale: 0.7 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      drag={present && removable && !restore}
      dragSnapToOrigin
      whileDrag={{ scale: 1.15, zIndex: 6 }}
      whileTap={{ scale: 0.94 }}
      onDragEnd={(_, info) => {
        if (present && removable && Math.hypot(info.offset.x, info.offset.y) > 52) onRemove();
      }}
      onTap={() => {
        if (live) onRemove();
      }}
      aria-label={present ? (restore ? 'put this weight back' : 'take this weight off') : undefined}
      aria-hidden={present ? undefined : true}
      style={{
        width: 30,
        height: 28,
        border: `1.5px solid ${INK}`,
        borderBottomWidth: 3.5,
        background: 'var(--paper-2)',
        borderRadius: 4,
        display: 'grid',
        placeItems: 'center',
        fontSize: '0.72rem',
        fontWeight: 600,
        color: INK,
        cursor: live ? 'grab' : 'default',
        pointerEvents: present ? undefined : 'none',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      1
    </motion.div>
  );
}

function Pan({
  side,
  angle,
  children,
}: {
  side: -1 | 1;
  angle: number;
  children: React.ReactNode;
}) {
  const y = side * HALF * Math.sin(rad(angle));
  const x = -side * HALF * (1 - Math.cos(rad(angle)));
  return (
    <motion.div
      animate={{ x, y }}
      transition={spring}
      style={{
        position: 'absolute',
        top: BEAM_Y,
        left: STAGE_W / 2 + side * HALF - PAN_W / 2,
        width: PAN_W,
        height: STRING + 4,
      }}
    >
      {/* the strings — a triangle of suspension, like a real pan */}
      <svg
        role="presentation"
        aria-hidden
        width={PAN_W}
        height={STRING + 4}
        viewBox={`0 0 ${PAN_W} ${STRING + 4}`}
        style={{ position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none' }}
      >
        <path
          d={`M ${PAN_W / 2} 2 L 14 ${STRING} M ${PAN_W / 2} 2 L ${PAN_W - 14} ${STRING}`}
          stroke={INK}
          strokeWidth={1.4}
          strokeLinecap="round"
          fill="none"
        />
        <circle cx={PAN_W / 2} cy={3} r={3} fill={INK} />
      </svg>
      {/* the plate — a gradient dish with an ink edge */}
      <div
        style={{
          position: 'absolute',
          left: 6,
          right: 6,
          top: STRING - 2,
          height: 9,
          background: 'var(--pig)',
          border: `1.5px solid ${INK}`,
          borderRadius: '3px 3px 6px 6px',
        }}
      />
      {/* weights rest on the plate, stacking upward */}
      <div
        style={{
          position: 'absolute',
          left: 6,
          right: 6,
          bottom: 4,
          display: 'flex',
          flexWrap: 'wrap-reverse',
          gap: 3,
          justifyContent: 'center',
          alignItems: 'flex-end',
        }}
      >
        {children}
      </div>
    </motion.div>
  );
}

export function BalanceScale({
  nodeId,
  setBar,
  onReveal,
  onDone,
}: {
  nodeId: string;
  setBar: (b: BarState | null) => void;
  onReveal: (struggles: number) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const stageRef = useRegisterTarget<HTMLDivElement>('course-scale', {
    kind: 'sim',
    label: 'the balance scale holding x + 3 = 8',
    meaning: 'left pan: x plus unit weights; right pan: unit weights; it tips when sides differ',
  });

  const [leftOn, setLeftOn] = useState<string[]>(['l1', 'l2', 'l3']);
  const [rightOn, setRightOn] = useState<string[]>([
    'r1',
    'r2',
    'r3',
    'r4',
    'r5',
    'r6',
    'r7',
    'r8',
  ]);
  const [hint, setHint] = useState(false);
  const struggles = useRef(0);
  const revealedRef = useRef(false);

  const leftWeight = X_WEIGHT + leftOn.length;
  const rightWeight = rightOn.length;
  const angle = Math.max(-10, Math.min(10, (rightWeight - leftWeight) * 3));
  const revealed = leftOn.length === 0 && rightOn.length === X_WEIGHT;

  // responsive stage: fixed geometry, scaled to fit
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / STAGE_W));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const remove = (side: 'l' | 'r', id: string) => {
    if (revealed) return;
    const set = side === 'l' ? setLeftOn : setRightOn;
    set((ids) => ids.filter((w) => w !== id));
    const nextLeft = X_WEIGHT + (side === 'l' ? leftOn.length - 1 : leftOn.length);
    const nextRight = side === 'r' ? rightOn.length - 1 : rightOn.length;
    if (Math.abs(nextRight - nextLeft) >= 2) {
      struggles.current += 1;
      if (struggles.current >= 2) setHint(true);
    }
  };
  const restore = (side: 'l' | 'r', id: string) => {
    if (revealed) return;
    const set = side === 'l' ? setLeftOn : setRightOn;
    set((ids) => [...ids, id]);
  };

  // Wobo watches the pans at code level
  useEffect(() => {
    const tilt =
      angle === 0
        ? 'level'
        : angle > 0
          ? 'tipping right (right side heavier)'
          : 'tipping left (left side heavier)';
    bus.publishCanvas({
      nodeId,
      equation: 'x + 3 = 8',
      steps: [
        `left pan: x${leftOn.length > 0 ? ` and ${leftOn.length} unit weight${leftOn.length === 1 ? '' : 's'}` : ' alone'}`,
        `right pan: ${rightOn.length} unit weight${rightOn.length === 1 ? '' : 's'}`,
        `the scale is ${tilt}`,
        ...(revealed ? ['balanced with x alone — the learner has discovered x = 5'] : []),
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, nodeId, leftOn.length, rightOn.length, angle, revealed]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  useEffect(() => {
    if (revealed && !revealedRef.current) {
      revealedRef.current = true;
      onReveal(struggles.current);
    }
  }, [revealed, onReveal]);

  useEffect(() => {
    setBar({ primary: { label: 'Continue', onClick: onDone, disabled: !revealed } });
  }, [setBar, onDone, revealed]);

  const leftOff = ['l1', 'l2', 'l3'].filter((id) => !leftOn.includes(id));
  const rightOff = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'].filter(
    (id) => !rightOn.includes(id),
  );

  return (
    <CardBody maxWidth={680}>
      <div style={whisper}>Guided discovery</div>
      <div style={cardTitle}>Get x alone</div>
      <div style={lead}>Take weights off the pans. The scale must end level.</div>

      <Stage hue={HUE} tint={0.055} minHeight={340} style={{ padding: '20px 16px 12px' }}>
        {/* the equation, morphing at the reveal */}
        <div style={{ textAlign: 'center', minHeight: 48, width: '100%' }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={revealed ? 'solved' : 'posed'}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              style={{
                fontSize: '1.8rem',
                fontWeight: 600,
                letterSpacing: '-0.01em',
                color: revealed ? HUE : 'var(--wobo-ink-900)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {revealed ? 'x = 5' : 'x + 3 = 8'}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* the scale */}
        <div ref={wrapRef} style={{ width: '100%' }}>
          <div
            ref={stageRef}
            style={{
              width: STAGE_W,
              height: STAGE_H * scale,
              margin: '0 auto',
              maxWidth: '100%',
            }}
          >
            <div
              style={{
                width: STAGE_W,
                height: STAGE_H,
                position: 'relative',
                transform: `scale(${scale})`,
                transformOrigin: 'top center',
                marginLeft: scale < 1 ? (STAGE_W * (scale - 1)) / 2 : 0,
              }}
            >
              {/* the ground — a soft tonal shadow the whole scene stands on */}
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  left: STAGE_W / 2 - 110,
                  top: STAGE_H - 20,
                  width: 220,
                  height: 16,
                  borderRadius: '50%',
                  background:
                    'radial-gradient(ellipse, color-mix(in srgb, var(--wobo-ink) 14%, transparent) 0%, transparent 68%)',
                }}
              />
              {/* the fulcrum — a chunky gradient pillar with an ink outline */}
              <svg
                role="presentation"
                aria-hidden
                width={72}
                height={STAGE_H - BEAM_Y - 8}
                viewBox={`0 0 72 ${STAGE_H - BEAM_Y - 8}`}
                style={{
                  position: 'absolute',
                  left: STAGE_W / 2 - 36,
                  top: BEAM_Y + 2,
                  display: 'block',
                }}
              >
                <defs>
                  <linearGradient id="scale-pillar" x1="0" y1="0" x2="1" y2="0">
                    <stop
                      offset="0%"
                      stopColor="color-mix(in srgb, var(--ink) 82%, var(--paper))"
                    />
                    <stop offset="50%" stopColor="var(--ink)" />
                    <stop offset="100%" stopColor="var(--ink)" />
                  </linearGradient>
                </defs>
                <path
                  d={`M 36 0 L 58 ${STAGE_H - BEAM_Y - 26} L 14 ${STAGE_H - BEAM_Y - 26} Z`}
                  fill="url(#scale-pillar)"
                  stroke={INK}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
                <rect x={4} y={STAGE_H - BEAM_Y - 28} width={64} height={9} rx={3} fill={INK} />
              </svg>
              {/* beam — a solid ink bar with a light top edge */}
              <motion.div
                animate={{ rotate: angle }}
                transition={spring}
                style={{
                  position: 'absolute',
                  left: STAGE_W / 2 - HALF,
                  top: BEAM_Y - 3,
                  width: HALF * 2,
                  height: 6,
                  background: 'var(--ink)',
                  borderRadius: 3,
                  transformOrigin: 'center',
                }}
              />
              {/* pivot — the golden point, the art system's one accent */}
              <div
                style={{
                  position: 'absolute',
                  left: STAGE_W / 2 - 6,
                  top: BEAM_Y - 6,
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: GOLD,
                  border: `2px solid ${INK}`,
                }}
              />

              <Pan side={-1} angle={angle}>
                {/* x — the unknown; it cannot be taken off */}
                <motion.div
                  layout
                  transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                  style={{
                    position: 'relative',
                    width: 42,
                    height: 34,
                    background: 'var(--ink)',
                    color: 'var(--paper)',
                    border: `1.5px solid ${INK}`,
                    borderRadius: 4,
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 600,
                    fontSize: '1rem',
                    userSelect: 'none',
                  }}
                >
                  x{/* the golden accent — the unknown carries the treasure */}
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: 3,
                      right: 3,
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: GOLD,
                    }}
                  />
                </motion.div>
                <AnimatePresence>
                  {leftOn.map((id) => (
                    <UnitWeight key={id} removable={!revealed} onRemove={() => remove('l', id)} />
                  ))}
                </AnimatePresence>
              </Pan>

              <Pan side={1} angle={angle}>
                <AnimatePresence>
                  {rightOn.map((id) => (
                    <UnitWeight key={id} removable={!revealed} onRemove={() => remove('r', id)} />
                  ))}
                </AnimatePresence>
              </Pan>
            </div>
          </div>
        </div>

        {/* the table — taken-off weights can go back */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            minHeight: 34,
            alignItems: 'center',
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', gap: 5, minHeight: 26 }}>
            <AnimatePresence>
              {leftOff.map((id) => (
                <UnitWeight key={id} restore removable={false} onRemove={() => restore('l', id)} />
              ))}
            </AnimatePresence>
          </div>
          {(leftOff.length > 0 || rightOff.length > 0) && !revealed && (
            <div style={{ ...whisper, textAlign: 'center' }}>Off the scale. Tap to put back.</div>
          )}
          <div style={{ display: 'flex', gap: 5, minHeight: 26 }}>
            <AnimatePresence>
              {rightOff.map((id) => (
                <UnitWeight key={id} restore removable={false} onRemove={() => restore('r', id)} />
              ))}
            </AnimatePresence>
          </div>
        </div>
      </Stage>

      {/* struggle → a quiet nudge; success → the principle, only after the act */}
      <div style={{ minHeight: 52, textAlign: 'center' }}>
        <AnimatePresence mode="wait">
          {revealed ? (
            <motion.div
              key="principle"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.5, ease: [0.2, 0, 0, 1] }}
              style={{ fontSize: '1.08rem', color: 'var(--wobo-ink-900)', lineHeight: 1.6 }}
            >
              whatever you do to one side, do to the other.
              <div style={{ ...lead, marginTop: 4 }}>
                you took 3 from both pans, and that is all algebra ever asks.
              </div>
            </motion.div>
          ) : hint ? (
            <motion.div
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              style={{ color: 'var(--wobo-ink-500)', fontSize: '0.9rem' }}
            >
              it tips when the sides stop matching.
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </CardBody>
  );
}
