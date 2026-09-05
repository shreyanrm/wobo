'use client';

/**
 * Practice — board 04 of design/prototypes/app-v1.html (DESIGN.md is law). The app shell; the
 * crumb with the set and the place in it, a "Start over" chip and the learner's initial; the mint
 * item card (the question with its fraction in Wobo's hand, the answer kind, Check / Start over,
 * Wobo's line, Wobo's head in the corner); and the side column (this set, and how this works).
 *
 * The answer kinds are the library's (packages/wobo/src/answers): it draws, it moves, it never
 * decides. `check` decides, instantly and offline, and its result rings the learner's own marks
 * where the gap is. Wobo never says wrong.
 */

import type { AnswerCheck, AnswerState } from '@wobo/contracts';
import {
  AnswerControl,
  check,
  resetState,
  stateReadout,
  useRegisterTarget,
  useWoboBus,
} from '@wobo/wobo';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppFrame } from '../shell/AppFrame';
import { Avatar, Button, Card, Chip, Tag, TopBar, WoboHead } from '../ui/primitives';
import { sfx } from '../ui/sound';
import { CUT_BAR, FRACTIONS_SET, promptParts, quarterMoment, SET_TITLE } from './practice/set';
import './practice/practice.css';
import { loadProfile } from './you/profile';

const N = FRACTIONS_SET.length;

/** Wobo's line under the answer: when the learner is one part short, and when it holds. */
const CLOSE = "one more, and you're there";
const HOLDS = 'that holds.';

function sayFor(result: AnswerCheck | null): { text: string; win: boolean } | null {
  if (!result) return null;
  if (result.correct) return { text: HOLDS, win: true };
  const short = result.feedback.some((f) => f.code === 'too_few' && f.count === 1);
  return short ? { text: CLOSE, win: false } : null;
}

export function Practice() {
  const { publishPage } = useWoboBus();
  const [pos, setPos] = useState(0);
  const [states, setStates] = useState<AnswerState[]>(() => FRACTIONS_SET.map(resetState));
  const [results, setResults] = useState<(AnswerCheck | null)[]>(() =>
    FRACTIONS_SET.map(() => null),
  );
  const spec = FRACTIONS_SET[pos] ?? FRACTIONS_SET[0];
  const state = states[pos] ?? resetState(spec);
  const result = results[pos] ?? null;
  const done = results.map((r) => r?.correct === true);
  const doneCount = done.filter(Boolean).length;
  const learner = useMemo(() => loadProfile().name.trim(), []);
  const say = sayFor(result);
  // The board's ringed quarter: the learner's own cell ringed, the line beside it in Wobo's hand.
  const moment = quarterMoment(spec, state, result);
  const shown = moment?.result ?? result;
  // The last item draws over a bar — the thing the line has to cut — in the board's own ink.
  const backdrop =
    spec.kind === 'draw' ? (
      <rect
        className="wobo-answer-stroke"
        x={CUT_BAR[0]}
        y={CUT_BAR[1]}
        width={CUT_BAR[2]}
        height={CUT_BAR[3]}
        rx={24}
      />
    ) : undefined;

  const put = useCallback((index: number, next: AnswerState, r: AnswerCheck | null) => {
    setStates((all) => all.map((s, i) => (i === index ? next : s)));
    setResults((all) => all.map((x, i) => (i === index ? r : x)));
  }, []);

  /** A new move is a new answer: the ring was about the last one. */
  const onChange = (next: AnswerState) => put(pos, next, null);
  const resetItem = () => put(pos, resetState(spec), null);
  const startOver = () => {
    setStates(FRACTIONS_SET.map(resetState));
    setResults(FRACTIONS_SET.map(() => null));
    setPos(0);
  };
  /** On to the next item still open; with none left, the set is done and the row keeps Start over. */
  const advance = () => {
    for (let step = 1; step <= N; step++) {
      const i = (pos + step) % N;
      if (!done[i]) {
        setPos(i);
        return;
      }
    }
  };
  const doCheck = () => {
    if (result?.correct) {
      advance();
      return;
    }
    const r = check(spec, state);
    put(pos, state, r);
    if (r.correct) sfx.bloom();
    else sfx.wrong();
  };

  useEffect(() => {
    publishPage({
      route: 'practice',
      state: {
        title: 'practice',
        intent: 'practice',
        set: SET_TITLE,
        item: pos + 1,
        of: N,
        done: doneCount,
      },
    });
  }, [publishPage, pos, doneCount]);

  // The item as Wobo sees it — the question, the learner's marks so far, and what check said —
  // registered so Wobo rings, answers "why is this wrong" and drives the buttons at code level.
  const itemRef = useRegisterTarget<HTMLDivElement>('practice-item', {
    kind: 'answer',
    label: `practice — ${spec.prompt ?? spec.kind}`,
    meaning: 'the practice item the learner is answering right now',
    getSceneState: () => ({
      set: SET_TITLE,
      item: pos + 1,
      of: N,
      kind: spec.kind,
      answer: stateReadout(spec, state),
      checked: result ? (result.correct ? 'correct' : 'not yet') : 'unchecked',
      feedback: result?.feedback ?? [],
    }),
    getValidActions: () => [result?.correct ? 'continue' : 'check', 'start over'],
    applyTutorAction: (patch) => {
      if (patch.check === true) doCheck();
      if (patch.reset === true) resetItem();
      if (patch.next === true) advance();
    },
  });

  const allDone = done.every(Boolean);
  const mood = result ? (result.correct ? 'celebrate' : 'hint') : 'idle';

  return (
    // The question is one of the four surfaces the help centre names as carrying a quiet flag, and
    // the flag itself lives in the frame. This is how it learns WHICH question is on screen, so a
    // child who says "this looks wrong" does not also have to say which one they meant.
    <AppFrame active="practice" about={{ surface: 'question', content_id: spec.id }}>
      <h1 className="pr-sr">Practice</h1>
      <TopBar
        crumb={`Practice · ${SET_TITLE} · ${pos + 1} of ${N}`}
        right={
          <>
            <Chip onClick={startOver}>Start over</Chip>
            {learner && <Avatar aria-label={learner}>{learner[0]?.toUpperCase()}</Avatar>}
          </>
        }
      />
      <div className="pr-prac">
        <div ref={itemRef} className="pr-item">
          <div className="pr-q">
            {promptParts(spec.prompt ?? '').map((part, i) =>
              part.fraction ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one line, in order
                <i key={i}>{part.text}</i>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one line, in order
                <span key={i}>{part.text}</span>
              ),
            )}
          </div>
          <div className="pr-answer">
            <AnswerControl
              key={`${spec.id}-${pos}`}
              spec={spec}
              state={state}
              onChange={onChange}
              result={shown}
              disabled={result?.correct === true}
              backdrop={backdrop}
            />
            {moment && (
              <div className="pr-note" aria-live="polite">
                {moment.note}
              </div>
            )}
          </div>
          <div className="pr-row">
            {!(result?.correct && allDone) && (
              <Button onClick={doCheck}>{result?.correct ? 'Continue' : 'Check'}</Button>
            )}
            <Button tone="quiet" onClick={resetItem}>
              Start over
            </Button>
          </div>
          <div className={say?.win ? 'pr-say pr-win' : 'pr-say'} aria-live="polite">
            {say?.text ?? ''}
          </div>
          <WoboHead size={56} mood={mood} />
        </div>
        <div className="pr-side">
          <Card compact>
            <Tag>This set</Tag>
            <div className="pr-set">
              {FRACTIONS_SET.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  className={i === pos ? 'pr-on' : undefined}
                  aria-current={i === pos ? 'step' : undefined}
                  onClick={() => setPos(i)}
                >
                  {item.prompt}
                  {done[i] ? (
                    <span className="pr-ok" role="img" aria-label="done">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--ink)"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 12 l5 5 l9 -10" />
                      </svg>
                    </span>
                  ) : (
                    <span className="pr-dot" />
                  )}
                </button>
              ))}
            </div>
          </Card>
          {/* LAW v5 (DESIGN.md §0): an explainer is neither the highlighter nor an earned
          moment, so it takes no wash. The pigment on this screen stays where it works —
          the set the learner is standing in, and the tick beside a finished one. */}
          <Card compact>
            <Tag>How this works</Tag>
            <p style={{ color: 'var(--ink)' }}>
              Wobo never says wrong. When you're close, it draws the difference on your answer and
              waits. Get it, and it makes a small fuss.
            </p>
          </Card>
        </div>
      </div>
    </AppFrame>
  );
}
