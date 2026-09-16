'use client';

/**
 * The composer — ONE component that renders ANY valid interaction design.
 *
 * docs/CONTENT-INTERACTION.md §3: "the model DESIGNS the interaction ... it writes that design as a
 * composition of primitives the client already renders, never as code: nothing generated ever
 * executes on a learner's device." This is the client half of that sentence. A designed interaction
 * and a template floor (`floors.ts`) are the same `InteractionDesign` in the same vocabulary, so
 * both come through `parseDesign` and land here on ONE code path. There is no second renderer for
 * templates, which is what stops the floor and the ceiling drifting apart.
 *
 * What the composer owns and the acts do not: which beat is on, the clock, the score, the line a
 * wrong move teaches, the reveal and the beat it lands on, the branch, and the advance.
 *
 * Never narrate (DESIGN.md §0.x). It prints the concept's own words and nothing about itself: no
 * "beat 2 of 3", no "loading", no caption for an absence, no announcement of what is about to
 * happen. Progress is dots. A refused design renders nothing at all and the caller falls to the
 * floor, silently.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BarState } from '../../screens/course/shared';
import { CardBody, ParticlePop, Stage } from '../../screens/course/shared';
import { sfx } from '../../ui/sound';
import {
  acts,
  type Beat,
  type Design,
  modifier,
  nextBeat,
  parseDesign,
  praiseFor,
  reasonFor,
  STAGE_W,
} from './parse';
import { PlayView } from './primitives/plays';
import './composition.css';

export interface ComposerProps {
  /** A parsed design, or the raw thing off the wire: the door runs either way. */
  design: Design | unknown;
  hue: string;
  setBar: (bar: BarState | null) => void;
  onDone: () => void;
  /** Points as they land, for the level and reward surfaces (docs/LEVELS.md, docs/REWARDS.md). */
  onScore?: (points: number) => void;
}

interface LiveBeat {
  /** The line a wrong move earned. Cleared by the next move. */
  teach: string;
  /**
   * Everything this beat has already told the learner. A tutor who repeats the sentence that just
   * failed is teaching nothing (docs/LEARNING-MODEL.md rule 4, docs/REWARDS.md §4), so the beat
   * remembers and `reasonFor` spends a new reason each time.
   */
  said: string[];
  /** True once the act is done and the idea is on the screen. */
  revealed: boolean;
  wrongs: number;
  /** The option a branch was answered with, so the branch can route on it. */
  chosen?: string;
}

const FRESH: LiveBeat = { teach: '', said: [], revealed: false, wrongs: 0 };

/** Which words land when a beat is done: the design's reveal, then the beat's surprise, then praise. */
function revealLine(design: Design, beat: Beat): string {
  const spec = modifier(design, 'reveal');
  if (spec && (spec.trigger === 'onDone' || spec.trigger === 'onRight')) return spec.what;
  if (beat.surprise) return beat.surprise;
  return praiseFor(beat.primitive);
}

export function Composer({ design, hue, setBar, onDone, onScore }: ComposerProps) {
  const parsed = useMemo<Design | null>(
    () =>
      design && typeof design === 'object' && 'steps' in design && 'mechanic' in design
        ? (design as Design)
        : parseDesign(design),
    [design],
  );

  const beats = useMemo(() => (parsed ? acts(parsed) : []), [parsed]);
  const [at, setAt] = useState(0);
  const [live, setLive] = useState<LiveBeat>(FRESH);
  const [points, setPoints] = useState(0);
  const [left, setLeft] = useState<number | null>(null);
  const [unitPx, setUnitPx] = useState(390 / STAGE_W);
  const host = useRef<HTMLDivElement | null>(null);
  const still = useReducedMotion();

  const timer = parsed ? modifier(parsed, 'timer') : undefined;
  const score = parsed ? modifier(parsed, 'score') : undefined;
  const beat = beats[at];

  // --- the finger's law, measured rather than assumed. A spec's hit box is in stage units; this is
  // what one unit is worth in css pixels at this width, and every control is sized through it.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const read = () => setUnitPx(el.clientWidth / STAGE_W);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- the clock. It ends a beat; it never takes anything away (docs/FEEL.md: feedback, not points).
  useEffect(() => {
    if (!timer || live.revealed || !beat) return;
    setLeft((l) => (l === null ? timer.seconds : l));
    const id = setInterval(() => {
      setLeft((l) => {
        if (l === null) return l;
        if (l > 1) return l - 1;
        clearInterval(id);
        if (timer.onExpire === 'end') onDone();
        else setLive((s) => ({ ...s, revealed: true }));
        return 0;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timer, live.revealed, beat, onDone]);

  const reveal = useCallback((chosen?: string) => {
    setLive((l) => (l.revealed ? l : { ...l, revealed: true, teach: '', chosen }));
    sfx.bloom();
  }, []);

  const right = useCallback(() => {
    sfx.tap();
    setLive((l) => ({ ...l, teach: '' }));
    if (score) {
      setPoints((v) => v + score.perRight);
      onScore?.(score.perRight);
    }
  }, [score, onScore]);

  const wrong = useCallback(
    (pieceId?: string, intoId?: string) => {
      if (!beat) return;
      sfx.wrong();
      const cost = score?.perWrong ?? 0;
      if (cost !== 0) {
        setPoints((v) => Math.max(0, v + cost));
        onScore?.(cost);
      }
      setLive((l) => {
        // The reason is drawn on THIS mistake (the piece and the place it went), and never repeats
        // what this beat has already said.
        const line = reasonFor(beat.primitive, { piece: pieceId, into: intoId }, l.said);
        return { ...l, teach: line, said: [...l.said, line], wrongs: l.wrongs + 1 };
      });
    },
    [beat, score, onScore],
  );

  const advance = useCallback(() => {
    if (!parsed) return;
    const to = nextBeat(parsed, at, live.chosen);
    if (to >= beats.length) {
      onDone();
      return;
    }
    setAt(to);
    setLive(FRESH);
    setLeft(null);
  }, [parsed, at, live.chosen, beats.length, onDone]);

  const last = at >= beats.length - 1;
  useEffect(() => {
    if (!parsed) return;
    setBar({
      primary: { label: last ? 'continue' : 'next', disabled: !live.revealed, onClick: advance },
    });
  }, [parsed, last, live.revealed, advance, setBar]);

  if (!parsed || !beat) return null;

  const line = revealLine(parsed, beat);
  const lowClock = left !== null && left <= 10;

  return (
    <Stage hue={hue} minHeight={320} style={{ justifyContent: 'flex-start' }}>
      <CardBody center={false}>
        <div
          ref={host}
          className="cx"
          style={{ ['--cx-hue' as string]: hue }}
          data-cx-design={parsed.id}
          data-cx-beat={beat.id}
          data-cx-kind={beat.primitive.kind}
        >
          <div className="cx-meter">
            <span className="cx-pips" aria-hidden>
              {beats.map((b, i) => (
                <i key={b.id} className={i <= at ? 'cx-on' : ''} />
              ))}
            </span>
            {timer?.visible && left !== null && (
              <span className={`cx-clock${lowClock ? ' cx-low' : ''}`} data-cx="clock">
                {left}s
              </span>
            )}
            {score && score.show !== 'none' && points > 0 && (
              <span className="cx-score" data-cx="score">
                {points}
              </span>
            )}
          </div>

          <p className="cx-prompt" data-cx="prompt">
            {'prompt' in beat.primitive ? beat.primitive.prompt : parsed.mechanic}
          </p>

          <PlayView
            key={beat.id}
            primitive={beat.primitive}
            marks={parsed.marks}
            hue={hue}
            unitPx={unitPx}
            frozen={live.revealed}
            onRight={right}
            onWrong={wrong}
            onDone={reveal}
          />

          <AnimatePresence initial={false} mode="wait">
            {live.teach && !live.revealed && (
              <motion.p
                key={`teach-${live.wrongs}`}
                className="cx-teach"
                data-cx="teach"
                role="status"
                initial={still ? { opacity: 0 } : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: still ? 0.15 : 0.24 }}
              >
                {live.teach}
              </motion.p>
            )}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {live.revealed && line && (
              <motion.div
                key="reveal"
                style={{ position: 'relative' }}
                initial={still ? { opacity: 0 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  still ? { duration: 0.2 } : { type: 'spring', stiffness: 280, damping: 28 }
                }
              >
                {!still && <ParticlePop hue={hue} count={10} />}
                <p className="cx-reveal" data-cx="reveal">
                  {line}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </CardBody>
    </Stage>
  );
}

export default Composer;
