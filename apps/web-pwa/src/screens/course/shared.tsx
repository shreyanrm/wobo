'use client';

/**
 * Course-player chrome, shared across every card: the segmented progress bar (endowed, eased),
 * the bottom action bar (Check/Continue + a quiet "why?"), the horizontal card deck, the
 * hue-tinted Stage every card's visual subject sits on, the celebration particle pop, and the
 * draggable number scrubber. Bold ink on paper: tonal surfaces, no line, no corner under 10px
 * (DESIGN.md §2).
 */

import { useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { scoped } from '../../store/scope';
import { MagneticButton } from '../../ui/kit';

/**
 * A translucent stop of a hue — stages and ignites are built from them.
 *
 * Subject hues are palette v4 tokens now (`var(--pig)`), not hexes, so a colour cannot be taken
 * apart into channels here: the theme decides the channels, in CSS, at paint time. `color-mix`
 * does the same job in the same place, and a real hex still takes the arithmetic path so nothing
 * that hands one in changes.
 */
export function rgba(color: string, alpha: number): string {
  if (!color.startsWith('#')) {
    return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
  }
  const n = Number.parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// --- Course position store (shared by every player: a course never restarts) ---------------------
// One store keyed by topicId. The atom stores a CardId string; the generated player stores a card
// index number. A topic is only ever one kind, so the value types never collide.

const POS_KEY = 'wobo-course-pos-v1';

export function readCoursePos(topicId: string): string | number | undefined {
  try {
    return (JSON.parse(scoped.getItem(POS_KEY) ?? '{}') as Record<string, string | number>)[
      topicId
    ];
  } catch {
    return undefined;
  }
}

export function writeCoursePos(topicId: string, pos: string | number): void {
  try {
    const all = JSON.parse(scoped.getItem(POS_KEY) ?? '{}') as Record<string, unknown>;
    all[topicId] = pos;
    scoped.setItem(POS_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable — session-only resume
  }
}

// The stars a topic earned on its FIRST completion — a replay shows these, never a fresh tally
// (owner replay law: the walk is real, but the reward was already banked).
const STARS_KEY = 'wobo-course-stars-v1';

export function readCourseStars(topicId: string): 1 | 2 | 3 | undefined {
  try {
    const v = (JSON.parse(scoped.getItem(STARS_KEY) ?? '{}') as Record<string, number>)[topicId];
    return v === 1 || v === 2 || v === 3 ? v : undefined;
  } catch {
    return undefined;
  }
}

export function writeCourseStars(topicId: string, stars: number): void {
  try {
    const all = JSON.parse(scoped.getItem(STARS_KEY) ?? '{}') as Record<string, number>;
    // only ever record the original earn — a later replay must not overwrite it
    if (all[topicId] === undefined) {
      all[topicId] = stars;
      scoped.setItem(STARS_KEY, JSON.stringify(all));
    }
  } catch {
    // storage unavailable — a replay falls back to the run's own stars
  }
}

/** The one golden accent of the art system — palette v4's marigold, which night lifts a step. */
export const GOLD = 'var(--marigold)';

// --- Text registers ------------------------------------------------------------------------------

export const whisper: CSSProperties = {
  // the 13px label floor (DESIGN.md §2) — a whisper is small, never unreadable
  fontSize: '0.8125rem',
  letterSpacing: '0.14em',
  color: 'var(--wobo-ink-500)',
  fontWeight: 500,
};

export const cardTitle: CSSProperties = {
  fontSize: 'clamp(1.5rem, 4vw, 1.9rem)',
  fontWeight: 550,
  letterSpacing: '-0.02em',
  color: 'var(--wobo-ink-900)',
  lineHeight: 1.2,
};

export const lead: CSSProperties = {
  fontSize: '1rem',
  lineHeight: 1.6,
  color: 'var(--wobo-ink-700)',
};

/**
 * The line under a scene that says what to do with it.
 *
 * It used to be a 2 px rule in the subject's hue down its left edge. DESIGN.md's line clause
 * forbids border lines outright — "surfaces separate by tone, by space, and by shape" — and puts
 * the ink floor at 2.5 px, so a 2 px rule broke it twice over. The separation is made the way the
 * law makes it instead: one tonal step off the card it sits on, at the kit's card radius.
 */
export const captionSurface: CSSProperties = {
  background: 'var(--paper-2)',
  borderRadius: 16,
  padding: '12px 14px',
};

export const equationType: CSSProperties = {
  fontSize: 'clamp(1.6rem, 5vw, 2.1rem)',
  fontWeight: 550,
  letterSpacing: '-0.01em',
  color: 'var(--wobo-ink-900)',
  fontVariantNumeric: 'tabular-nums',
};

// --- The action bar ------------------------------------------------------------------------------

export interface BarAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface BarState {
  primary: BarAction;
  /** The quiet affordance — "why?" after an answer, "done" on optional cards. */
  secondary?: BarAction;
}

/** This lesson's steps, as the player on stage reports them: the names, and which one is on. */
export interface LessonOutline {
  steps: string[];
  /** Index into `steps`; -1 before the lesson has begun, `steps.length` once it is done. */
  at: number;
}

/**
 * The one control that moves a lesson forward, registered by name so "show me how to carry on"
 * walks the learner to the real button. Its rect is read off the live element rather than a stored
 * box, so it survives the bar re-laying out under a longer label. Registered exactly ONCE:
 * registering fans a state change through the provider, so an effect that re-registers whenever
 * the bar's identity changes drives the whole tree into a re-render loop (each card hands down a
 * fresh bar object). The live bar is read through a ref instead.
 *
 * `host` is the element the primary button is the last `<button>` of — the action bar, or the
 * lesson screen's say row.
 */
export function useAdvanceTarget(
  host: RefObject<HTMLElement | null>,
  bar: BarState | null,
  gated: boolean,
): void {
  // `registerTarget` alone, never the whole bus: the bus object is rebuilt on every registration.
  const { registerTarget } = useWoboBus();
  const live = useRef<{ bar: BarState | null; gated: boolean }>({ bar, gated });
  live.current = { bar, gated };
  useEffect(() => {
    const ready = () => {
      const { bar: b, gated: g } = live.current;
      return Boolean(b) && !g && !b?.primary.disabled;
    };
    return registerTarget({
      id: 'course-advance',
      kind: 'control',
      label: 'the button that moves this lesson on',
      getRect: () => {
        const el = host.current?.querySelector('button:last-of-type') as HTMLElement | null;
        return el?.getBoundingClientRect() ?? null;
      },
      getSceneState: () => ({
        label: live.current.bar?.primary.label,
        waitingForWobo: live.current.gated,
        ready: ready(),
      }),
      getValidActions: () => (ready() ? [live.current.bar?.primary.label ?? 'continue'] : ['wait']),
      applyTutorAction: (patch) => {
        if (patch.advance === true && ready()) live.current.bar?.primary.onClick();
      },
    });
  }, [registerTarget, host]);
}

export function ActionBar({
  bar,
  gate,
}: {
  bar: BarState | null;
  /** When present, the primary advance button is held closed and fills up as Wobo reads. */
  gate?: { progress: number };
}) {
  const still = useReducedMotion();
  const gated = Boolean(gate);
  const barRef = useRef<HTMLDivElement | null>(null);
  useAdvanceTarget(barRef, bar, gated);
  if (!bar) return null;
  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 32 }}
      style={{
        position: 'relative',
        padding: '14px 24px calc(14px + env(safe-area-inset-bottom, 0px))',
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--wobo-paper)',
      }}
    >
      {/* the card content dissolves into the bar — a soft tonal veil above the hairline, so a scrolling
          card never hard-cuts at the seam (§1 ambient depth, no shadows) */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: -28,
          height: 28,
          pointerEvents: 'none',
          background: 'linear-gradient(to top, var(--wobo-paper), transparent)',
        }}
      />
      <div
        ref={barRef}
        style={{
          width: 'min(680px, 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 10,
        }}
      >
        {bar.secondary && (
          <MagneticButton variant="quiet" onClick={bar.secondary.onClick}>
            {bar.secondary.label}
          </MagneticButton>
        )}
        <MagneticButton
          variant="primary"
          onClick={bar.primary.onClick}
          disabled={bar.primary.disabled || gated}
          style={{
            minWidth: 148,
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
            // never a dead button while Wobo reads — it stays lit and fills up
            ...(gated ? { opacity: 1, cursor: 'default' } : {}),
          }}
        >
          {gated && (
            // LAW v5 §8 (DESIGN.md §0): a fill is scrubbed on TRANSFORM, never on width. Animating
            // width relayouts the button on every frame of the hold, which is the stutter the
            // owner saw; scaleX from a left origin is the same picture on the compositor.
            <motion.span
              aria-hidden
              animate={{ scaleX: Math.max(0, Math.min(1, gate?.progress ?? 0)) }}
              transition={{ ease: 'linear', duration: 0.12 }}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '100%',
                transformOrigin: 'left',
                background: 'rgba(255,255,255,0.2)',
                pointerEvents: 'none',
              }}
            />
          )}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={bar.primary.label}
              initial={{ opacity: 0, y: 7 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -7 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              style={{ position: 'relative' }}
            >
              {bar.primary.label}
            </motion.span>
          </AnimatePresence>
        </MagneticButton>
      </div>
    </motion.div>
  );
}

// --- Segmented progress (endowed — never starts empty) -------------------------------------------

export function SegmentedProgress({ fraction, segments }: { fraction: number; segments: number }) {
  const still = useReducedMotion();
  const f = Math.max(0, Math.min(1, fraction));
  // the frontier stop — the one currently lighting; it breathes so progress feels alive, not static
  const lead = f >= 1 ? -1 : Math.min(segments - 1, Math.floor(f * segments));
  return (
    <div
      aria-hidden
      style={{ display: 'flex', gap: 4, flex: 1, alignItems: 'center', minWidth: 0 }}
    >
      {Array.from({ length: segments }, (_, i) => {
        const fill = Math.max(0, Math.min(1, f * segments - i));
        const isLead = i === lead;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional by nature
            key={i}
            style={{
              position: 'relative',
              flex: 1,
              height: 3,
              background: 'var(--wobo-ink-100)',
              overflow: 'hidden',
            }}
          >
            {isLead && (
              // the stop igniting: a faint ultramarine breath on the frontier — mastery at rest
              // (the one earned pigment of the view, DESIGN.md §1)
              <motion.div
                aria-hidden
                animate={still ? { opacity: 0.4 } : { opacity: [0.22, 0.6, 0.22] }}
                transition={
                  still
                    ? undefined
                    : { duration: 2, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }
                }
                style={{ position: 'absolute', inset: 0, background: 'var(--wobo-ultramarine)' }}
              />
            )}
            {/* LAW v5 §8: transform and opacity only — a segment fills by scaling, never by
                growing its box inside a flex row that would then re-measure every sibling. */}
            <motion.div
              animate={{ scaleX: fill }}
              transition={{ type: 'spring', stiffness: 120, damping: 26 }}
              style={{
                position: 'relative',
                height: '100%',
                width: '100%',
                transformOrigin: 'left',
                // the frontier's growing edge ignites ultramarine; travelled ground settles to ink
                background: isLead
                  ? 'linear-gradient(90deg, var(--wobo-ink-900) 60%, var(--wobo-ultramarine))'
                  : 'var(--wobo-ink-900)',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// --- A multiple-choice option — checking a wrong pick lights the correct one green ----------------
// After the wrong pick shakes, the right answer's green fades in (a beat later). Reused by the
// generated player's workbook/boss and the atom boss. (DESIGN.md §9 — a wrong answer never shames.)

export function ChoiceButton({
  children,
  chosen,
  evaluated,
  isAnswer,
  blockWrong,
  disabled,
  onClick,
  style,
}: {
  children: ReactNode;
  /** The learner's current selection. */
  chosen: boolean;
  /** True once the set has been checked. */
  evaluated: boolean;
  /** True if this option is the correct answer. */
  isAnswer: boolean;
  /** True if the learner got this block wrong — delays the correct green until after the shake. */
  blockWrong: boolean;
  disabled: boolean;
  onClick: () => void;
  style?: CSSProperties;
}) {
  const wrongPick = evaluated && chosen && !isAnswer;
  const showCorrect = evaluated && isAnswer;
  const delay = showCorrect && blockWrong ? 0.4 : 0;
  // Tonal surfaces, no line round them (DESIGN.md §2): paper-2 at rest, ink when chosen, the mint
  // wash for the right one and the coral wash for a wrong pick once the set is checked.
  const background = !evaluated
    ? chosen
      ? 'var(--ink)'
      : 'var(--paper-2)'
    : showCorrect
      ? 'var(--mint-w)'
      : wrongPick
        ? 'var(--rose-w)'
        : 'var(--paper-2)';
  return (
    <motion.button
      type="button"
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      animate={wrongPick ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.4 }}
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '11px 14px',
        fontSize: '0.95rem',
        lineHeight: 1.45,
        fontFamily: 'inherit',
        color: !evaluated && chosen ? 'var(--paper)' : 'var(--ink)',
        background,
        border: 0,
        borderRadius: 12,
        cursor: disabled ? 'default' : 'pointer',
        transition: `background 0.25s ease ${delay}s, color 0.2s ease`,
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

// --- The stage — every card's visual subject sits on one ------------------------------------------

/**
 * The panel a card's centerpiece sits on: 16px corners, a tonal surface, generous height.
 *
 * LAW v5 (DESIGN.md §0): this used to be a 5–7% wash of the card's subject hue, which is exactly
 * the tint-to-mark-a-section the white ground forbids — and on night it turned every stage into a
 * differently coloured murk. The ground is now `paper-2` in both themes, and the subject's hue
 * stays where it does work: in the ink the card draws with, in a tick, in a pill.
 *
 * `hue` and `tint` are kept in the signature because the drawing inside a stage still asks for a
 * hue, and because a caller passing one must not become a type error — neither paints the ground.
 */
export function Stage({
  minHeight = 300,
  children,
  style,
}: {
  /** Kept for the callers that name their subject's hue; the stage no longer paints with it. */
  hue?: string;
  /** Kept for the same reason; the stage's ground is a tonal surface at every tint. */
  tint?: number;
  /** Kept for the same reason; every stage is tonal now. */
  tonal?: boolean;
  minHeight?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const still = useReducedMotion();
  return (
    <motion.div
      initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={
        still ? { duration: 0.2, ease: 'easeOut' } : { type: 'spring', stiffness: 260, damping: 26 }
      }
      style={{
        position: 'relative',
        width: '100%',
        minHeight,
        borderRadius: 16,
        background: 'var(--paper-2)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

// --- The particle pop — a small burst for earned moments ------------------------------------------

export function ParticlePop({
  hue = 'var(--wobo-ultramarine)',
  count = 12,
}: {
  hue?: string;
  count?: number;
}) {
  const parts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + (i % 2) * 0.35;
        const d = 36 + (i % 3) * 18;
        return {
          id: `p${i}`,
          x: Math.cos(a) * d,
          y: Math.sin(a) * d,
          s: i % 3 === 0 ? 7 : 4,
          gold: i % 4 === 0,
        };
      }),
    [count],
  );
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        display: 'grid',
        placeItems: 'center',
        overflow: 'visible',
      }}
    >
      {parts.map((p, i) => (
        <motion.span
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.3 }}
          transition={{ duration: 0.75, ease: [0.15, 0, 0.2, 1], delay: i * 0.014 }}
          style={{
            position: 'absolute',
            width: p.s,
            height: p.s,
            borderRadius: 999,
            background: p.gold ? GOLD : hue,
          }}
        />
      ))}
    </div>
  );
}

// --- The deck (horizontal slide-spring + stage crossfade) ------------------------------------------

export function Deck({ id, children }: { id: string; children: ReactNode }) {
  const still = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={id}
        initial={{ x: still ? 0 : 72, opacity: 0, scale: still ? 1 : 0.99 }}
        animate={{
          x: 0,
          opacity: 1,
          scale: 1,
          transition: still
            ? { duration: 0.2, ease: 'easeOut' }
            : { type: 'spring', stiffness: 320, damping: 30 },
        }}
        exit={{
          x: still ? 0 : -56,
          opacity: 0,
          scale: still ? 1 : 0.985,
          transition: { duration: 0.18, ease: [0.4, 0, 1, 1] },
        }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** One idea per screen: a centered column that breathes. */
export function CardBody({
  children,
  center = true,
  maxWidth = 640,
}: {
  children: ReactNode;
  center?: boolean;
  maxWidth?: number;
}) {
  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        maxWidth,
        margin: '0 auto',
        // Bottom padding clears the globally docked Wobo orb (Companion.tsx: fixed, ~112px tall at
        // bottom-right) so the last line of copy is never occluded on short/mobile viewports.
        padding: '28px 24px max(36px, 96px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: center ? 'center' : 'flex-start',
        gap: 18,
      }}
    >
      {children}
    </div>
  );
}

// --- Scrubber — a draggable number (what-if grammar: numericals are never static) -----------------

export function Scrubber({
  value,
  min,
  max,
  onChange,
  label,
  display,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  /** Optional display override (e.g. magnitude while the sign renders as the operator). */
  display?: string;
}) {
  const start = useRef<{ x: number; v: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, v: value };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const s = start.current;
    if (!s) return;
    const next = Math.max(min, Math.min(max, s.v + Math.round((e.clientX - s.x) / 16)));
    if (next !== value) onChange(next);
  };
  const onPointerUp = () => {
    start.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(Math.min(max, value + 1));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(Math.max(min, value - 1));
    }
  };

  return (
    <motion.span
      className="ls-scrub"
      role="slider"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      whileTap={{ scale: 1.07 }}
      transition={{ type: 'spring', stiffness: 400, damping: 24 }}
      style={{
        display: 'inline-block',
        padding: '0 6px 2px',
        borderBottom: '2px dashed var(--wobo-ink-500)',
        cursor: 'ew-resize',
        touchAction: 'none',
        userSelect: 'none',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--wobo-ink-900)',
        outlineOffset: 3,
      }}
    >
      {display ?? String(value)}
    </motion.span>
  );
}
