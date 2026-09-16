'use client';

/**
 * A WORKED MODULE, ON THE ATOM — a twin of the item that beat the learner, solved one move at a time.
 *
 * It is what the course hands a learner a practice run has just beaten twice, when the chapter's
 * pool says the way back in is a worked one (`screens/course/climb.ts`). The same idea from another
 * side: not the next item of the run that beat them, and not anything harder.
 *
 * It never solves an item the course will ask. Until 2026-09-16 it solved the very item that beat
 * them, the check then asked that item again, and a child who copied the answer off this card was
 * counted as understanding it. The course hands it `workedFor(...)`: the same shape, other numbers
 * (`twinEquation`). Every line on it is computed from that equation (`equations.ts`), the same way
 * the detonation and the boss compute theirs, and the last move puts the answer back in to prove
 * it, so nothing here is asserted. The learner presses for each move, so the pace is theirs.
 */

import type { PracticeItem } from '@wobo/sdk';
import { useRegisterTarget } from '@wobo/wobo';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { aX, fmt, linearize } from './equations';
import type { BarState } from './shared';
import { CardBody, cardTitle, lead, Stage, whisper } from './shared';

const HUE = 'var(--wobo-ultramarine)';

export interface WorkedMove {
  /** The move, named. */
  move: string;
  /** The equation after it. */
  line: string;
}

const flatten = (s: string) => s.replace(/\s+/g, '').replace(/−/g, '-');

/**
 * The moves that solve `equation`, in order, ending with the check that proves the answer. Empty
 * for an equation this engine cannot read, and the card then has nothing to show.
 */
export function workedMoves(equation: string): WorkedMove[] {
  const lin = linearize(equation);
  if (!lin) return [];
  const { a, b, c, x } = lin;
  const moves: WorkedMove[] = [];
  if (flatten(lin.flat) !== flatten(equation)) {
    moves.push({ move: 'write it out flat', line: lin.flat });
  }
  if (b !== 0) {
    moves.push({
      move: b > 0 ? `subtract ${fmt(b)} from both sides` : `add ${fmt(-b)} to both sides`,
      line: `${aX(a)} = ${fmt(c - b)}`,
    });
  }
  if (a !== 1) {
    const inverse = Math.abs(a) < 1 && Number.isInteger(1 / a);
    moves.push({
      move: inverse ? `multiply both sides by ${fmt(1 / a)}` : `divide both sides by ${fmt(a)}`,
      line: `x = ${fmt(x)}`,
    });
  }
  moves.push({
    move: `put x = ${fmt(x)} back in`,
    line: `both sides make ${fmt(lin.lhs(x))}`,
  });
  return moves;
}

export function Worked({
  item,
  setBar,
  onDone,
}: {
  item: PracticeItem;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const moves = useMemo(() => workedMoves(item.equation), [item.equation]);
  const [shown, setShown] = useState(0);
  const ref = useRegisterTarget<HTMLDivElement>('course-worked', {
    kind: 'equation',
    label: `the worked equation ${item.equation}`,
  });

  // An equation the engine cannot read has nothing to work: the module is over, never a blank card.
  useEffect(() => {
    if (moves.length === 0) onDone();
  }, [moves.length, onDone]);

  useEffect(() => {
    if (moves.length === 0) return;
    setBar(
      shown < moves.length
        ? { primary: { label: 'Next move', onClick: () => setShown((n) => n + 1) } }
        : { primary: { label: 'Continue', onClick: onDone } },
    );
  }, [shown, moves.length, setBar, onDone]);

  return (
    <CardBody maxWidth={520} center={false}>
      <div style={whisper}>worked through</div>
      <div style={cardTitle}>Watch each move</div>
      <Stage hue={HUE} tint={0.05} style={{ padding: '22px 18px', gap: 14 }}>
        <div
          ref={ref}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            width: '100%',
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <div style={{ fontSize: 'clamp(1.6rem, 6vw, 2.1rem)', fontWeight: 550 }}>
            {item.equation}
          </div>
          {moves.slice(0, shown).map((m) => (
            <motion.div
              key={m.move}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
            >
              <div style={{ ...whisper, marginBottom: 4 }}>{m.move}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 550, color: 'var(--wobo-ink-900)' }}>
                {m.line}
              </div>
            </motion.div>
          ))}
        </div>
      </Stage>
      <div style={{ ...lead, textAlign: 'center' }}>
        {shown < moves.length
          ? 'one move at a time. each one keeps both sides equal.'
          : 'every move kept the scale level, so the answer holds.'}
      </div>
    </CardBody>
  );
}
