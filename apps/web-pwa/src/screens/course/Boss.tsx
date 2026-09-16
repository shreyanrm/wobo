'use client';

/**
 * The boss battle (DESIGN.md §9) — a three-item digital workbook that closes the topic: solve,
 * fill-the-missing-step, choose-the-error. Answered in full, evaluated at the end. Calm, no fear;
 * a miss earns another look, never shame. Every exercise is derived arithmetically from verified
 * seed items — nothing invented.
 *
 * WHAT A PASS MEANS NOW (docs/LEARNING-MODEL.md, "The tutor never leaves"). The boss is the proof on
 * questions the course never showed solved, so an answer to an exercise whose answer the boss has
 * already put on screen (the move under the step, the slip in the error, once a round is checked)
 * is recorded as aided, and the course closes the topic only when the band holds as well
 * (`climb.ts`, `topicClosed`). On a walk a round that is not passed is not retried on the spot with
 * its answers showing: the course chooses what comes next (`onFail`).
 */

import type { PracticeItem } from '@wobo/sdk';
import { glassLabel, useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { motion } from 'framer-motion';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useSdk } from '../../store/sdk';
import { BossSigil } from '../../ui/art';
import { ComboMeter, comboBreak, comboHit } from '../../ui/combo';
import { sfx } from '../../ui/sound';
import { BOSS_PASS } from './climb';
import { aX, firstMove, fmt, linearize } from './equations';
import type { BarState } from './shared';
import { CardBody, ChoiceButton, cardTitle, rgba, Stage, tryAgainRung, whisper } from './shared';

const HUE = 'var(--wobo-ultramarine)';

const ORDINALS = ['one', 'two', 'three'];

interface StepExercise {
  lines: [string, string]; // before the gap, after the gap
  choices: string[];
  correctIndex: number;
}

interface ErrorExercise {
  lines: string[];
  errorIndex: number;
  b: number;
}

/** Fill-the-missing-step, built from the item's own linear structure. */
function buildStep(item: PracticeItem): StepExercise | null {
  const lin = linearize(item.equation);
  if (!lin) return null;
  const correct = firstMove(lin).text;
  const distractors =
    lin.b !== 0
      ? [
          lin.b > 0 ? `add ${fmt(lin.b)} to both sides` : `subtract ${fmt(-lin.b)} from both sides`,
          `divide both sides by ${fmt(Math.abs(lin.b))}`,
        ]
      : Math.abs(lin.a) < 1
        ? [`divide both sides by ${fmt(1 / lin.a)}`, `add ${fmt(1 / lin.a)} to both sides`]
        : [`multiply both sides by ${fmt(lin.a)}`, `subtract ${fmt(lin.a)} from both sides`];
  const first = distractors[0] ?? '';
  const second = distractors[1] ?? '';
  return {
    lines: [item.equation, `x = ${fmt(lin.x)}`],
    choices: [first, correct, second],
    correctIndex: 1,
  };
}

/**
 * Choose-the-error: a worked solution with one classic slip — the constant crosses the equals
 * sign without flipping its sign. Every later line follows honestly from the slip.
 */
function buildError(item: PracticeItem): ErrorExercise | null {
  const lin = linearize(item.equation);
  if (!lin || lin.b === 0) return null;
  const wrongK = lin.c + lin.b; // kept its sign — the slip
  const lines: string[] = [item.equation];
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/−/g, '-');
  if (norm(lin.flat) !== norm(item.equation)) lines.push(lin.flat);
  const errorIndex = lines.length;
  lines.push(`${aX(lin.a)} = ${fmt(wrongK)}`);
  lines.push(`x = ${fmt(wrongK / lin.a)}`);
  return { lines, errorIndex, b: lin.b };
}

const blockStyle = (state: 'idle' | 'correct' | 'retry'): CSSProperties => ({
  border:
    state === 'correct'
      ? '1px solid var(--wobo-feedback-correct)'
      : state === 'retry'
        ? '1px solid var(--wobo-feedback-retry)'
        : '0.5px solid var(--wobo-hairline-on-paper-strong)',
  background:
    state === 'correct'
      ? 'var(--wobo-feedback-correctSoft)'
      : state === 'retry'
        ? 'var(--wobo-feedback-retrySoft)'
        : 'var(--wobo-paper)',
  borderRadius: 'var(--wobo-radius-md)',
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
});

export function Boss({
  nodeId,
  items,
  setBar,
  setSub,
  onAttempt,
  onPass,
  onFail,
  shown,
  onRevealed,
}: {
  nodeId: string;
  /** Three verified items: [solve, fill-the-step, choose-the-error]. */
  items: PracticeItem[];
  setBar: (b: BarState | null) => void;
  setSub: (f: number) => void;
  onAttempt: () => void;
  /** Fires on a pass, carrying how many of the three were correct — the greeting's star signal. */
  onPass: (correct: number) => void;
  /**
   * A round that was not passed. Given, the round ends there and the course chooses what follows;
   * absent, the learner takes one more look at the same three.
   */
  onFail?: (correct: number) => void;
  /** Items whose answer the course has already shown in an earlier round: answered, they are aided. */
  shown?: ReadonlySet<string>;
  /** The items whose answers a checked round has just put on screen. */
  onRevealed?: (itemIds: string[]) => void;
}) {
  const sdk = useSdk();
  const bus = useWoboBus();
  const bossRef = useRegisterTarget<HTMLDivElement>('course-boss', {
    kind: 'workbook',
    label: 'the boss workbook — solve, missing step, find the error',
  });

  const solveItem = items[0];
  // memoized — the bar-setting effect depends on these identities
  const step = useMemo(() => {
    const source = items[1];
    return source ? buildStep(source) : null;
  }, [items]);
  const error = useMemo(() => {
    const source = items[2];
    return source ? buildError(source) : null;
  }, [items]);

  const [solveEntry, setSolveEntry] = useState('');
  const [stepChoice, setStepChoice] = useState<number | null>(null);
  const [errorChoice, setErrorChoice] = useState<number | null>(null);
  const [evaluated, setEvaluated] = useState(false);
  const [results, setResults] = useState<[boolean, boolean, boolean] | null>(null);
  const round = useRef(0);
  const startedAt = useRef(Date.now());
  // What this workbook has already shown the answer to: the course's record, and its own rounds.
  const revealed = useRef(new Set<string>(shown ?? []));

  const solveLin = solveItem ? linearize(solveItem.equation) : null;
  const solveValid = solveEntry !== '' && Number.isFinite(Number(solveEntry.replace('−', '-')));
  const answered =
    (solveValid ? 1 : 0) + (stepChoice !== null ? 1 : 0) + (errorChoice !== null ? 1 : 0);

  useEffect(() => setSub(answered / 3), [setSub, answered]);

  useEffect(() => {
    bus.publishCanvas({
      nodeId,
      equation: solveItem?.equation ?? '',
      steps: [
        `boss workbook: ${answered} of 3 answered`,
        evaluated && results
          ? `evaluated — ${results.filter(Boolean).length} of 3 correct`
          : 'not yet evaluated',
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, nodeId, solveItem, answered, evaluated, results]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  useEffect(() => {
    if (!solveItem || !step || !error) {
      setBar(null);
      return;
    }
    if (!evaluated) {
      setBar({
        primary: {
          label: 'Check all three',
          disabled: answered < 3,
          onClick: () => {
            const value = Number(solveEntry.replace('−', '-'));
            const r: [boolean, boolean, boolean] = [
              Math.abs(value - Number(solveItem.answer)) < 1e-9,
              stepChoice === step.correctIndex,
              errorChoice === error.errorIndex,
            ];
            const latency = Date.now() - startedAt.current;
            const responses: {
              item_id?: string;
              response: { kind: 'numeric'; value: number } | { kind: 'choice'; selected: string[] };
            }[] = [
              { item_id: solveItem.id, response: { kind: 'numeric', value } },
              {
                item_id: items[1]?.id,
                response: { kind: 'choice', selected: [step.choices[stepChoice ?? 0] ?? ''] },
              },
              {
                item_id: items[2]?.id,
                response: { kind: 'choice', selected: [`line-${errorChoice}`] },
              },
            ];
            responses.forEach((resp, i) => {
              onAttempt();
              sdk.events.record(
                'learn.attempt.submitted.v1',
                {
                  node_id: nodeId,
                  ...(resp.item_id ? { item_id: resp.item_id } : {}),
                  response: resp.response,
                  correct: r[i] ?? false,
                  // honest about what was on the screen: an answer the boss already showed is aided
                  aided: Boolean(resp.item_id && revealed.current.has(resp.item_id)),
                  independence_signal: 0.9,
                  latency_ms: latency,
                  attempt_index: round.current,
                },
                { ontologyNodeId: nodeId },
              );
            });
            round.current += 1;
            // Checked, the round shows the move under the step and the slip in the error.
            const nowShown = [items[1]?.id, items[2]?.id].filter((id): id is string => Boolean(id));
            for (const id of nowShown) revealed.current.add(id);
            onRevealed?.(nowShown);
            // the combo carries in from practice: each clean answer extends it, a miss breaks it —
            // silent here so the boss's own evaluation moment stays one idea, not a stack of tones
            for (const ok of r) {
              if (ok) comboHit(true);
              else comboBreak();
            }
            // one tone for the whole evaluation: a soft bloom on a pass, a gentle blip otherwise
            if (r.filter(Boolean).length >= BOSS_PASS) sfx.bloom();
            else sfx.wrong();
            setResults(r);
            setEvaluated(true);
          },
        },
      });
    } else {
      const correct = results?.filter(Boolean).length ?? 0;
      const pass = correct >= BOSS_PASS;
      setBar({
        primary: pass
          ? { label: 'Continue', onClick: () => onPass(correct) }
          : onFail
            ? { label: 'Continue', onClick: () => onFail(correct) }
            : {
                label: 'One more look',
                onClick: () => {
                  setEvaluated(false);
                  setResults(null);
                  startedAt.current = Date.now();
                },
              },
      });
    }
  }, [
    setBar,
    solveItem,
    step,
    error,
    evaluated,
    answered,
    solveEntry,
    stepChoice,
    errorChoice,
    results,
    sdk,
    nodeId,
    onAttempt,
    onPass,
    onFail,
    onRevealed,
    items,
  ]);

  if (!solveItem || !step || !error) return null;

  const state = (i: 0 | 1 | 2): 'idle' | 'correct' | 'retry' =>
    !evaluated || !results ? 'idle' : results[i] ? 'correct' : 'retry';
  const passCount = results?.filter(Boolean).length ?? 0;

  return (
    <CardBody maxWidth={600} center={false}>
      {/* the boss's face — its sigil watching over the workbook, prompt large */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={whisper}>The boss · answered together, checked together</div>
            <ComboMeter hue={HUE} />
          </div>
          <div style={{ ...cardTitle, marginTop: 8 }}>Three questions, one scale</div>
        </div>
        <motion.div
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
          style={{ flexShrink: 0 }}
        >
          <BossSigil id={nodeId} size={72} mastered hue={HUE} />
        </motion.div>
      </div>

      {/* the workbook — three exercises on the topic's own stage */}
      <Stage
        hue={HUE}
        tint={0.05}
        minHeight={0}
        style={{
          alignItems: 'stretch',
          justifyContent: 'flex-start',
          padding: 'clamp(14px, 3vw, 22px)',
        }}
      >
        {/* a whispered grid behind the work — the workbook sits on graph paper */}
        <svg
          role="presentation"
          aria-hidden
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          preserveAspectRatio="none"
        >
          <defs>
            <pattern id="boss-grid" width="44" height="44" patternUnits="userSpaceOnUse">
              <path d="M 44 0 L 0 0 0 44" fill="none" stroke={rgba(HUE, 0.06)} strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#boss-grid)" />
        </svg>
        <div
          ref={bossRef}
          style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          {/* one — solve */}
          <div style={blockStyle(state(0))}>
            <div style={whisper}>{ORDINALS[0]} · solve it</div>
            <div
              style={{
                fontSize: '1.45rem',
                fontWeight: 550,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--wobo-ink-900)',
              }}
            >
              {solveItem.equation}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: 'var(--wobo-ink-500)' }}>x =</span>
              <input
                value={solveEntry}
                onChange={(e) => setSolveEntry(e.target.value.replace(/[^0-9\-−.]/g, ''))}
                disabled={evaluated}
                inputMode="numeric"
                aria-label="your answer for x"
                style={{
                  width: 110,
                  padding: '10px 12px',
                  fontSize: '1.1rem',
                  fontFamily: 'inherit',
                  fontVariantNumeric: 'tabular-nums',
                  textAlign: 'center',
                  border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
                  borderRadius: 'var(--wobo-radius-sm)',
                  // no inline `outline: none` — keep the global :focus-visible ring (main.tsx)
                  background: 'var(--wobo-paper)',
                  color: 'var(--wobo-ink-900)',
                }}
              />
            </div>
            {evaluated && results && !results[0] && solveLin && (
              <div style={{ fontSize: '0.88rem', color: 'var(--wobo-ink-700)', lineHeight: 1.6 }}>
                put your x back in: the sides make{' '}
                {fmt(solveLin.lhs(Number(solveEntry.replace('−', '-'))))} and{' '}
                {fmt(solveLin.rhs(Number(solveEntry.replace('−', '-'))))} — not level yet.
              </div>
            )}
          </div>

          {/* two — the missing step */}
          <div style={blockStyle(state(1))}>
            <div style={whisper}>{ORDINALS[1]} · one step is missing — choose it</div>
            <div
              style={{
                fontSize: '1.15rem',
                fontWeight: 550,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--wobo-ink-900)',
              }}
            >
              {step.lines[0]}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {step.choices.map((choice, i) => (
                <ChoiceButton
                  key={choice}
                  chosen={stepChoice === i}
                  evaluated={evaluated}
                  isAnswer={i === step.correctIndex}
                  blockWrong={!!results && !results[1]}
                  disabled={evaluated}
                  onClick={() => setStepChoice(i)}
                >
                  {choice}
                </ChoiceButton>
              ))}
            </div>
            <div
              style={{
                fontSize: '1.15rem',
                fontWeight: 550,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--wobo-ink-900)',
              }}
            >
              {step.lines[1]}
            </div>
            {evaluated && results && !results[1] && (
              <div style={{ fontSize: '0.88rem', color: 'var(--wobo-ink-700)', lineHeight: 1.6 }}>
                the move must undo what sits around x — here that is “
                {step.choices[step.correctIndex]}”.
              </div>
            )}
          </div>

          {/* three — find the error */}
          <div style={blockStyle(state(2))}>
            <div style={whisper}>{ORDINALS[2]} · one line below is wrong — tap it</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {error.lines.map((line, i) => (
                // Each line is a step on the glass map, and the slip rides the step it lives on
                // (docs/INK-FREEZE-PLAN-TRACE.md §3): "which step is wrong" has a box to land on.
                <div
                  key={line}
                  {...glassLabel(
                    'step',
                    i === error.errorIndex
                      ? `step:${i + 1};misconception:moves-term-without-sign`
                      : `step:${i + 1}`,
                  )}
                >
                  <ChoiceButton
                    chosen={errorChoice === i}
                    evaluated={evaluated}
                    isAnswer={i === error.errorIndex}
                    blockWrong={!!results && !results[2]}
                    disabled={evaluated}
                    onClick={() => setErrorChoice(i)}
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: '1.05rem',
                      fontWeight: 550,
                    }}
                  >
                    {line}
                  </ChoiceButton>
                </div>
              ))}
            </div>
            {evaluated && results && !results[2] && (
              <div style={{ fontSize: '0.88rem', color: 'var(--wobo-ink-700)', lineHeight: 1.6 }}>
                the slip is where {fmt(Math.abs(error.b))} crossed the equals sign and kept its sign
                — crossing always flips it.
              </div>
            )}
          </div>

          {evaluated && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
              style={{ textAlign: 'center', color: 'var(--wobo-ink-700)', fontSize: '0.95rem' }}
            >
              {/*
                The boss climbs the same ladder the workbook does (`shared.tsx`). It used to say
                one fixed sentence on every failed round, so a learner who could not pass read the
                identical words as many times as they tried; and that sentence carried two em
                dashes in front of a child, which voice.md forbids outright.
              */}
              {passCount >= BOSS_PASS
                ? passCount === 3
                  ? 'All three. Clean.'
                  : 'Two of three, and that is a pass, earned.'
                : tryAgainRung(passCount, 3, round.current - 1)}
            </motion.div>
          )}
        </div>
      </Stage>
    </CardBody>
  );
}
