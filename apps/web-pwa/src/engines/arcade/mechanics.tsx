'use client';

/**
 * THE SIX MECHANICS — one play field each, and the mechanic IS the concept.
 *
 * docs/CONTENT-INTERACTION.md §7: *"Six mechanics, not one skin: catch, sort against the clock,
 * match pairs, defend the number line, build the sequence, the running quiz with lives. Templates
 * filled from the level rendering, zero model calls per play; the same game on two chapters looks
 * and reads like two games."*
 *
 * Every one of them obeys the same four rules, which is why they live in one file:
 *
 *   A TAP CAN BE WRONG.      No mechanic here is recognition with the lights on. Something is at
 *                            stake in every one: a life, the clock, or the line giving ground.
 *   A WRONG MOVE TEACHES.    `round.why` says why the order matters, in the concept's own words,
 *                            and it is shown where the mistake happened. Never "try again".
 *   A FINGER CAN USE IT.     Every touchable is at least 44 css px, laid out to work at 390 wide.
 *   IT IS QUIET.             The register holds inside a game (voice.md 10a): no hype, no
 *                            exclamation, no emoji, and reduced motion is a still with the spark.
 *
 * The shell (`ArcadeShell.tsx`) owns the score, the lives, the clock and the rounds. A mechanic
 * owns one round's play field and says only two things back: that one is right, or that one is
 * wrong and here is why.
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { sfx } from '../../ui/sound';
import {
  type ArcadeRound,
  type CatchRound,
  deal,
  type LineRound,
  type MatchRound,
  type QuizRound,
  type SequenceRound,
  type SortRound,
  shuffle,
  withinTolerance,
} from './spec';

export interface MechanicProps {
  round: ArcadeRound;
  /** Which play this is. The deal is seeded on it, so a re-render never reshuffles mid-move. */
  run: number;
  /** The owning subject's pigment. Earned moments only: a miss is ink, never colour. */
  hue: string;
  /** The lighter shell an older class gets: fewer words, no encouragement, same game. */
  lite: boolean;
  reduced: boolean;
  onRight: () => void;
  onWrong: (why?: string) => void;
}

// --- the shared furniture --------------------------------------------------------------------

/** The law: 44 css px is the smallest thing a finger may be asked to land on. */
export const HIT = 44;

type ChipState = 'rest' | 'picked' | 'right' | 'wrong' | 'done';

const CHIP_BG: Record<ChipState, string> = {
  rest: 'var(--paper-2)',
  picked: 'var(--paper-3)',
  right: 'var(--mint-w)',
  wrong: 'var(--rose-w)',
  done: 'var(--paper-3)',
};

function Chip({
  children,
  state = 'rest',
  onClick,
  disabled,
  label,
  style,
  grow,
}: {
  children: ReactNode;
  state?: ChipState;
  onClick?: () => void;
  disabled?: boolean;
  label?: string;
  style?: CSSProperties;
  grow?: boolean;
}) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      aria-label={label}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      animate={state === 'wrong' ? { x: [0, -5, 5, -3, 3, 0] } : { x: 0 }}
      transition={{ duration: 0.34 }}
      onClick={onClick}
      style={{
        minHeight: HIT,
        minWidth: HIT,
        padding: '10px 14px',
        flex: grow ? '1 1 auto' : '0 0 auto',
        borderRadius: 12,
        border: 0,
        background: CHIP_BG[state],
        color: 'var(--ink)',
        fontFamily: 'inherit',
        fontSize: '0.95rem',
        fontWeight: 500,
        lineHeight: 1.35,
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        opacity: state === 'done' ? 0.55 : 1,
        transition: 'background 0.22s ease, opacity 0.22s ease',
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

/** The one line a mechanic is allowed to say when a move went wrong. It teaches or it is absent. */
function Because({ why }: { why?: string }) {
  return (
    <AnimatePresence>
      {why ? (
        <motion.p
          key={why}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          style={{
            margin: 0,
            padding: '10px 12px',
            borderRadius: 12,
            background: 'var(--paper-2)',
            color: 'var(--ink-2)',
            fontSize: '0.9rem',
            lineHeight: 1.5,
          }}
        >
          {why}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, width: '100%' };

const promptStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.05rem',
  fontWeight: 520,
  lineHeight: 1.4,
  color: 'var(--ink)',
};

// --- 1. catch — the answers rain down ----------------------------------------------------------

interface Falling {
  key: string;
  label: string;
  correct: boolean;
  x: number;
  y: number;
  vy: number;
  caught: 'right' | 'wrong' | null;
}

const CATCHER_Y = 86;
const CATCHER_W = 26;

export function CatchField({ round, run, hue, reduced, onRight, onWrong }: MechanicProps) {
  const r = round as CatchRound;
  const areaRef = useRef<HTMLDivElement>(null);
  const catcherX = useRef(50);
  const [catcher, setCatcher] = useState(50);
  const [items, setItems] = useState<Falling[]>([]);
  const settled = useRef(false);
  const raf = useRef(0);
  const last = useRef(0);

  const speed = reduced ? 13 : 21;

  useEffect(() => {
    const options = shuffle(
      [
        { label: r.answer, correct: true },
        ...r.distractors.map((d) => ({ label: d, correct: false })),
      ],
      run + r.id.length,
    );
    settled.current = false;
    catcherX.current = 50;
    setCatcher(50);
    setItems(
      options.map((o, i) => ({
        key: `${run}-${i}`,
        label: o.label,
        correct: o.correct,
        x: 16 + (i + 0.5) * (68 / options.length),
        y: -8 - i * 24,
        vy: speed * (0.85 + i * 0.07),
        caught: null,
      })),
    );
  }, [r, run, speed]);

  useEffect(() => {
    const step = (ts: number) => {
      const dt = last.current ? Math.min(0.05, (ts - last.current) / 1000) : 0;
      last.current = ts;
      setItems((prev) => {
        if (settled.current) return prev;
        let right = false;
        let wrong = false;
        let missed = false;
        const next: Falling[] = [];
        for (const it of prev) {
          if (it.caught) {
            next.push(it);
            continue;
          }
          const y = it.y + it.vy * dt;
          const inBand = y >= CATCHER_Y && it.y < CATCHER_Y;
          if (inBand && Math.abs(it.x - catcherX.current) <= CATCHER_W / 2 + 5) {
            if (it.correct) right = true;
            else wrong = true;
            next.push({ ...it, y, caught: it.correct ? 'right' : 'wrong' });
            continue;
          }
          if (y > 106) {
            if (it.correct) missed = true;
            continue;
          }
          next.push({ ...it, y });
        }
        if (right) {
          settled.current = true;
          sfx.bloom();
          onRight();
        } else if (wrong) {
          settled.current = true;
          onWrong(r.why);
        } else if (missed) {
          settled.current = true;
          onWrong(r.why);
        }
        return next;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [onRight, onWrong, r.why]);

  const move = useCallback((x: number) => {
    const clamped = Math.max(CATCHER_W / 2, Math.min(100 - CATCHER_W / 2, x));
    catcherX.current = clamped;
    setCatcher(clamped);
  }, []);

  const onPointer = (e: ReactPointerEvent) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (rect) move(((e.clientX - rect.left) / rect.width) * 100);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') move(catcherX.current - 9);
      else if (e.key === 'ArrowRight') move(catcherX.current + 9);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move]);

  return (
    <div style={field}>
      <p style={promptStyle}>{r.prompt}</p>
      <div
        ref={areaRef}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        role="application"
        aria-label={`catch ${r.answer ? 'the right answer' : ''}. move with the arrow keys.`}
        style={{
          position: 'relative',
          width: '100%',
          height: 300,
          borderRadius: 16,
          background: 'var(--paper-2)',
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        {items.map((it) => (
          <div
            key={it.key}
            style={{
              position: 'absolute',
              left: `${it.x}%`,
              top: `${it.y}%`,
              transform: 'translate(-50%, -50%)',
              padding: '8px 14px',
              minHeight: HIT - 12,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 999,
              whiteSpace: 'nowrap',
              fontSize: '0.95rem',
              fontWeight: 520,
              background:
                it.caught === 'right'
                  ? 'var(--mint-w)'
                  : it.caught === 'wrong'
                    ? 'var(--rose-w)'
                    : 'var(--paper)',
              color: 'var(--ink)',
              pointerEvents: 'none',
            }}
          >
            {it.label}
          </div>
        ))}
        <div
          style={{
            position: 'absolute',
            left: `${catcher}%`,
            top: `${CATCHER_Y}%`,
            transform: 'translate(-50%, -50%)',
            width: `${CATCHER_W}%`,
            height: 12,
            borderRadius: 999,
            background: hue,
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

// --- 2. sort against the clock -----------------------------------------------------------------

export function SortField({ round, run, hue, lite, onRight }: MechanicProps) {
  const r = round as SortRound;
  const [order, setOrder] = useState<string[]>(() => deal(r, run));
  const [picked, setPicked] = useState<number | null>(null);
  const [why, setWhy] = useState<string | undefined>();
  const [solved, setSolved] = useState(false);

  useEffect(() => {
    setOrder(deal(r, run));
    setPicked(null);
    setWhy(undefined);
    setSolved(false);
  }, [r, run]);

  const tap = (at: number) => {
    if (solved) return;
    if (picked === null) {
      setPicked(at);
      return;
    }
    if (picked === at) {
      setPicked(null);
      return;
    }
    const next = [...order];
    [next[picked], next[at]] = [next[at] as string, next[picked] as string];
    setPicked(null);
    setOrder(next);
    /*
     * A SWAP NEVER COSTS A LIFE. The clock is the whole cost here, which is what "against the
     * clock" means, and a mechanic that punished every trial swap would teach a learner to stop
     * trying. A swap that moved further from the answer says WHY, once, and nothing else happens.
     */
    const off = (list: string[]) => list.filter((c, i) => c !== r.order[i]).length;
    setWhy(off(next) > off(order) ? r.why : undefined);
    if (next.every((chip, i) => chip === r.order[i])) {
      setSolved(true);
      sfx.bloom();
      onRight();
    }
  };

  return (
    <div style={field}>
      <p style={promptStyle}>{r.prompt}</p>
      {r.by ? <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: '0.9rem' }}>{r.by}</p> : null}
      <ol
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {order.map((chip, at) => (
          <li key={chip} style={{ display: 'flex', flex: '1 1 30%' }}>
            <Chip
              grow
              state={picked === at ? 'picked' : solved ? 'right' : 'rest'}
              onClick={() => tap(at)}
              label={`${chip}, position ${at + 1} of ${order.length}`}
              style={picked === at ? { boxShadow: `inset 0 0 0 2.5px ${hue}` } : undefined}
            >
              {chip}
            </Chip>
          </li>
        ))}
      </ol>
      {!lite && (
        <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: '0.85rem' }}>
          tap one, then tap the one it should swap with.
        </p>
      )}
      <Because why={why} />
    </div>
  );
}

// --- 3. match pairs ------------------------------------------------------------------------------

export function MatchField({ round, run, hue, onRight, onWrong }: MechanicProps) {
  const r = round as MatchRound;
  const tiles = useMemo(
    () =>
      shuffle(
        r.pairs.flatMap((p) => [p.left, p.right]),
        run * 7 + 3,
      ),
    [r, run],
  );
  const partner = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of r.pairs) {
      map.set(p.left, p.right);
      map.set(p.right, p.left);
    }
    return map;
  }, [r]);

  const [held, setHeld] = useState<string | null>(null);
  const [locked, setLocked] = useState<string[]>([]);
  const [missed, setMissed] = useState<string | null>(null);
  const [why, setWhy] = useState<string | undefined>();
  const done = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the round and the play ARE the reset — a new round must clear the board even though the body reads neither
  useEffect(() => {
    setHeld(null);
    setLocked([]);
    setMissed(null);
    setWhy(undefined);
    done.current = false;
  }, [r, run]);

  const tap = (tile: string) => {
    if (done.current || locked.includes(tile)) return;
    if (held === null) {
      setHeld(tile);
      setMissed(null);
      setWhy(undefined);
      return;
    }
    if (held === tile) {
      setHeld(null);
      return;
    }
    if (partner.get(held) === tile) {
      const next = [...locked, held, tile];
      setLocked(next);
      setHeld(null);
      sfx.bloom();
      if (next.length === tiles.length) {
        done.current = true;
        onRight();
      }
      return;
    }
    setHeld(null);
    setMissed(tile);
    setWhy(r.why);
    onWrong(r.why);
  };

  return (
    <div style={field}>
      <p style={promptStyle}>{r.prompt}</p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
        }}
      >
        {tiles.map((tile) => {
          const state: ChipState = locked.includes(tile)
            ? 'right'
            : missed === tile
              ? 'wrong'
              : held === tile
                ? 'picked'
                : 'rest';
          return (
            <Chip
              key={tile}
              state={state}
              disabled={locked.includes(tile)}
              onClick={() => tap(tile)}
              label={tile}
              style={held === tile ? { boxShadow: `inset 0 0 0 2.5px ${hue}` } : undefined}
            >
              {tile}
            </Chip>
          );
        })}
      </div>
      <Because why={why} />
    </div>
  );
}

// --- 4. defend the number line -------------------------------------------------------------------

export function LineField({ round, hue, lite, onRight, onWrong }: MechanicProps) {
  const r = round as LineRound;
  const span = r.max - r.min;
  const trackRef = useRef<HTMLButtonElement>(null);
  const [caret, setCaret] = useState(0.5);
  const [placed, setPlaced] = useState<number | null>(null);
  const [why, setWhy] = useState<string | undefined>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: the round and the play ARE the reset — a new round must clear the board even though the body reads neither
  useEffect(() => {
    setCaret(0.5);
    setPlaced(null);
    setWhy(undefined);
  }, [r]);

  const place = (fraction: number) => {
    if (placed !== null) return;
    const at = r.min + Math.max(0, Math.min(1, fraction)) * span;
    setPlaced(at);
    if (withinTolerance(at, r.target, r.tolerance)) {
      sfx.bloom();
      onRight();
    } else {
      setWhy(r.why);
      onWrong(r.why);
    }
  };

  const onPointer = (e: ReactPointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    place((e.clientX - rect.left) / rect.width);
  };

  const label = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, ''));
  const pct = (v: number) => `${((v - r.min) / span) * 100}%`;

  return (
    <div style={field}>
      <p style={promptStyle}>{r.prompt}</p>
      <div style={{ padding: '28px 4px 8px' }}>
        <button
          ref={trackRef}
          type="button"
          onPointerDown={onPointer}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setCaret((c) => Math.max(0, c - 0.02));
            else if (e.key === 'ArrowRight') setCaret((c) => Math.min(1, c + 0.02));
            else if (e.key === 'Enter' || e.key === ' ') place(caret);
          }}
          aria-label={`the line runs from ${label(r.min)} to ${label(r.max)}. tap where ${r.prompt} sits, or move with the arrow keys and press enter.`}
          style={{
            position: 'relative',
            display: 'block',
            width: '100%',
            height: 72,
            border: 0,
            padding: 0,
            background: 'transparent',
            cursor: placed === null ? 'pointer' : 'default',
            touchAction: 'none',
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 34,
              height: 4,
              borderRadius: 999,
              background: 'var(--paper-3)',
            }}
          />
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <span
              key={t}
              style={{
                position: 'absolute',
                left: `${t * 100}%`,
                top: 26,
                width: 2,
                height: 20,
                marginLeft: -1,
                background: 'var(--line)',
              }}
            />
          ))}
          {/* the caret a keyboard moves */}
          {placed === null && (
            <span
              style={{
                position: 'absolute',
                left: `${caret * 100}%`,
                top: 20,
                width: 3,
                height: 32,
                marginLeft: -1.5,
                borderRadius: 999,
                background: 'var(--ink-3)',
              }}
            />
          )}
          {/* where they put it, and where it actually sits: the difference IS the teaching */}
          {placed !== null && (
            <>
              <span
                style={{
                  position: 'absolute',
                  left: pct(placed),
                  top: 18,
                  width: 3,
                  height: 36,
                  marginLeft: -1.5,
                  borderRadius: 999,
                  background: 'var(--ink)',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: pct(r.target),
                  top: 12,
                  width: 4,
                  height: 48,
                  marginLeft: -2,
                  borderRadius: 999,
                  background: withinTolerance(placed, r.target, r.tolerance) ? hue : 'var(--ink-2)',
                }}
              />
            </>
          )}
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: 56,
              fontSize: '0.8rem',
              color: 'var(--ink-3)',
            }}
          >
            {label(r.min)}
            {r.unit ? ` ${r.unit}` : ''}
          </span>
          <span
            style={{
              position: 'absolute',
              right: 0,
              top: 56,
              fontSize: '0.8rem',
              color: 'var(--ink-3)',
            }}
          >
            {label(r.max)}
            {r.unit ? ` ${r.unit}` : ''}
          </span>
        </button>
      </div>
      {!lite && placed === null && (
        <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: '0.85rem' }}>
          tap the line where it belongs.
        </p>
      )}
      {placed !== null && (
        <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: '0.9rem' }}>
          it sits at {label(r.target)}
          {r.unit ? ` ${r.unit}` : ''}.
        </p>
      )}
      <Because why={why} />
    </div>
  );
}

// --- 5. build the sequence -------------------------------------------------------------------------

export function SequenceField({ round, run, hue, onRight, onWrong }: MechanicProps) {
  const r = round as SequenceRound;
  const tray = useMemo(() => deal(r, run), [r, run]);
  const [built, setBuilt] = useState<string[]>([]);
  const [missed, setMissed] = useState<string | null>(null);
  const [why, setWhy] = useState<string | undefined>();
  const slips = useRef(0);
  const done = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the round and the play ARE the reset — a new round must clear the board even though the body reads neither
  useEffect(() => {
    setBuilt([]);
    setMissed(null);
    setWhy(undefined);
    slips.current = 0;
    done.current = false;
  }, [r, run]);

  const tap = (step: string) => {
    if (done.current || built.includes(step)) return;
    const wanted = r.steps[built.length];
    if (step === wanted) {
      const next = [...built, step];
      setBuilt(next);
      setMissed(null);
      setWhy(undefined);
      sfx.bloom();
      if (next.length === r.steps.length) {
        done.current = true;
        onRight();
      }
      return;
    }
    setMissed(step);
    setWhy(r.why);
    slips.current += 1;
    // REWARDS.md §4: the first miss is almost nothing. The step simply does not go in; from the
    // second, it costs a life, because by then the order is the thing being learnt.
    if (slips.current > 1) onWrong(r.why);
  };

  return (
    <div style={field}>
      <p style={promptStyle}>{r.prompt}</p>
      <ol
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {r.steps.map((step, i) => (
          <li
            key={step}
            style={{
              minHeight: HIT,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 12,
              background: built[i] ? 'var(--mint-w)' : 'var(--paper-2)',
              color: built[i] ? 'var(--ink)' : 'var(--ink-3)',
              fontSize: '0.95rem',
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 999,
                background: built[i] ? hue : 'var(--paper-3)',
                color: built[i] ? 'var(--paper)' : 'var(--ink-3)',
                fontSize: '0.75rem',
                fontWeight: 600,
                flex: '0 0 auto',
              }}
            >
              {i + 1}
            </span>
            {built[i] ?? ' '}
          </li>
        ))}
      </ol>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {tray.map((step) => (
          <Chip
            key={step}
            grow
            state={built.includes(step) ? 'done' : missed === step ? 'wrong' : 'rest'}
            disabled={built.includes(step)}
            onClick={() => tap(step)}
            label={step}
          >
            {step}
          </Chip>
        ))}
      </div>
      <Because why={why} />
    </div>
  );
}

// --- 6. the running quiz with lives -----------------------------------------------------------------

export function QuizField({ round, run, hue, onRight, onWrong }: MechanicProps) {
  const r = round as QuizRound;
  const options = useMemo(() => shuffle(r.options, run * 11 + 5), [r, run]);
  const [picked, setPicked] = useState<string | null>(null);
  const [why, setWhy] = useState<string | undefined>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: the round and the play ARE the reset — a new round must clear the board even though the body reads neither
  useEffect(() => {
    setPicked(null);
    setWhy(undefined);
  }, [r, run]);

  const tap = (option: string) => {
    if (picked !== null) return;
    setPicked(option);
    if (option === r.answer) {
      sfx.bloom();
      onRight();
    } else {
      setWhy(r.why);
      onWrong(r.why);
    }
  };

  return (
    <div style={field}>
      <p style={promptStyle}>{r.prompt}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((option) => {
          const state: ChipState =
            picked === null
              ? 'rest'
              : option === r.answer
                ? 'right'
                : option === picked
                  ? 'wrong'
                  : 'rest';
          return (
            <Chip
              key={option}
              grow
              state={state}
              disabled={picked !== null}
              onClick={() => tap(option)}
              label={option}
              style={state === 'right' ? { boxShadow: `inset 0 0 0 2.5px ${hue}` } : undefined}
            >
              {option}
            </Chip>
          );
        })}
      </div>
      <Because why={why} />
    </div>
  );
}

// --- the one door into all six ----------------------------------------------------------------------

export const MECHANICS = {
  catch: CatchField,
  sort: SortField,
  match: MatchField,
  numberline: LineField,
  sequence: SequenceField,
  quiz: QuizField,
} as const;
