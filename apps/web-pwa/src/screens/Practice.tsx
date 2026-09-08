'use client';

/**
 * Practice — board 04 of design/prototypes/app-v1.html (DESIGN.md is law). The app shell; the
 * crumb with the set and the place in it, a "Start over" chip and the learner's initial; the mint
 * item card (the question with its fraction in Wobo's hand, the answer kind, Check / Start over,
 * Wobo's line, Wobo's head in the corner); and the side column (this set, the learner's own
 * workbooks, and how this works).
 *
 * The answer kinds are the library's (packages/wobo/src/answers): it draws, it moves, it never
 * decides. `check` decides, instantly and offline, and its result rings the learner's own marks
 * where the gap is. Wobo never says wrong.
 *
 * Three things this door keeps that it used to drop. The run — where the learner is, their marks,
 * what check said — is read from the learner's own store on mount and written on every change
 * (practice/run-store.ts), so a tap on Home or a reload loses nothing. A first correct check earns
 * the item's XP, once, so what is done here reaches the account. And the forge is reachable: the
 * bindery (practice/ForgeBuilder.tsx) and the workbook runner (practice/ForgeRun.tsx) were built,
 * tested and imported by nothing, so `wobo-forged-v1` could never gain a row; the shelf below the
 * set is their door, and it is the only practice that follows the learner's own syllabus, since the
 * fractions set is the board's fixed five for every learner.
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
import { useWorld } from '../curriculum/hooks';
import { warmFromCache } from '../curriculum/warm';
import { AppFrame } from '../shell/AppFrame';
import { useProgress } from '../store/progress';
import { Avatar, Button, Card, Chip, Tag, TopBar, WoboHead } from '../ui/primitives';
import { sfx } from '../ui/sound';
import { ForgeBuilder } from './practice/ForgeBuilder';
import { ForgeRun } from './practice/ForgeRun';
import { bestScore, useForged } from './practice/forge-store';
import { MIX_LABEL, SIZE_LABEL } from './practice/pools';
import { practiceOnceKey, readRun, writeRun } from './practice/run-store';
import { CUT_BAR, FRACTIONS_SET, promptParts, quarterMoment, SET_TITLE } from './practice/set';
import './practice/practice.css';
import { loadProfile } from './you/profile';

const N = FRACTIONS_SET.length;
/** The set's key in the run store. */
const SET_ID = 'fractions';

/** Where the learner is on this screen: the set, the bindery, or a workbook of their own. */
type Door = { at: 'set' } | { at: 'forge' } | { at: 'run'; id: string };

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
  const { award } = useProgress();
  const [door, setDoor] = useState<Door>({ at: 'set' });
  const forged = useForged();
  const world = useWorld();
  // The bindery picks from the registry, and a cold open of /practice arrives with it empty. Read
  // what this device already holds of the pinned world, the way Home and Learn do on arrival.
  const worldKey = world
    ? `${world.frameworkId}:${world.versionId ?? ''}:${world.level ?? ''}`
    : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: the world key is the trigger; the cache read is idempotent
  useEffect(() => {
    warmFromCache();
  }, [worldKey]);
  // The run this learner left here, if any — read once, on mount, from their own store.
  const [kept] = useState(() => readRun(SET_ID, FRACTIONS_SET));
  const [pos, setPos] = useState(kept?.pos ?? 0);
  const [states, setStates] = useState<AnswerState[]>(
    () => kept?.states ?? FRACTIONS_SET.map(resetState),
  );
  const [results, setResults] = useState<(AnswerCheck | null)[]>(
    () => kept?.results ?? FRACTIONS_SET.map(() => null),
  );
  const [earned, setEarned] = useState<string[]>(kept?.earned ?? []);
  useEffect(() => {
    writeRun(SET_ID, { pos, states, results, earned });
  }, [pos, states, results, earned]);
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
    if (!r.correct) {
      sfx.wrong();
      return;
    }
    // The first time an item holds, its XP reaches the account (the store plays the bloom); a
    // later run of the same item is real practice but earns nothing twice, and keeps its sound.
    if (earned.includes(spec.id)) {
      sfx.bloom();
      return;
    }
    setEarned((ids) => [...ids, spec.id]);
    award('item', { onceKey: practiceOnceKey(SET_ID, spec.id) });
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

  if (door.at === 'forge') {
    return (
      <AppFrame active="practice">
        <h1 className="pr-sr">The forge</h1>
        <TopBar
          crumb="Practice · The forge"
          right={<Chip onClick={() => setDoor({ at: 'set' })}>Back to the set</Chip>}
        />
        <ForgeBuilder onForged={() => setDoor({ at: 'set' })} />
      </AppFrame>
    );
  }

  if (door.at === 'run') {
    return (
      <AppFrame active="practice">
        <h1 className="pr-sr">A forged workbook</h1>
        <TopBar crumb="Practice · Your workbook" />
        <ForgeRun id={door.id} onExit={() => setDoor({ at: 'set' })} />
      </AppFrame>
    );
  }

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
          {/* The shelf: the workbooks this learner forged from chapters they have met, and the
          door to forging another. A workbook still being made is named, not tappable. */}
          <Card compact>
            <Tag>Your workbooks</Tag>
            {forged.length === 0 ? (
              <p style={{ color: 'var(--ink)' }}>
                Bind a workbook from the chapters you have met, and it lands here to run whenever
                you like.
              </p>
            ) : (
              <div className="pr-set">
                {forged.map((w) => {
                  const best = bestScore(w);
                  const ready = w.status === 'ready';
                  const note = !ready
                    ? 'being made'
                    : best
                      ? `best ${best.correct} of ${best.total}`
                      : `${w.total} items · ${SIZE_LABEL[w.size]} · ${MIX_LABEL[w.mix]}`;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      disabled={!ready}
                      aria-label={`${w.title}, ${note}`}
                      onClick={() => setDoor({ at: 'run', id: w.id })}
                    >
                      {w.title}
                      {best ? (
                        <span className="pr-ok" role="img" aria-label="attempted">
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
                  );
                })}
              </div>
            )}
            <div className="pr-row">
              <Button size="sm" tone="quiet" onClick={() => setDoor({ at: 'forge' })}>
                Forge a workbook
              </Button>
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
