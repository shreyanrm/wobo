'use client';

/**
 * The placement check, on screen.
 *
 * A learner opens a topic whose ground they have not covered. Before the lesson starts, Wobo asks
 * about the ground: at most three questions, each one either a real item with a frozen answer or
 * the learner's own word about their own past.
 *
 * THREE DOORS, BECAUSE A GATE IS ADVICE AND NEVER A WALL (DESIGN.md §8).
 *
 * There used to be two, and one of them was a trapdoor. "I know this" settled every question still
 * standing, including ground the learner had not been shown, as a permanent claim: the check filters
 * placed ground out of every future check, so one tap deleted up to three prerequisites from the
 * learner's picture and nothing in the product could put them back. And there was no third door at
 * all: no back, no not-now, and the copy under the button said "nothing here is a wall" while the
 * screen was one. So:
 *
 *   I know this        claims ONLY the question on screen. The learner claims what they were shown.
 *   I know all of this appears only when more than one is left, and says how many it covers.
 *   Not now            settles nothing and records nothing. The check is offered again next time.
 *
 * Every claim is takeable back (`forgetPlacement`, and Wobo's own "forget everything"), which is
 * what makes a claim safe to record at all.
 *
 * Everything this screen decides lives in `curriculum/placement.ts`. This file only asks, listens,
 * and hands the settled ground report back. It adds no stylesheet: the card, the buttons and the
 * chips are the kit's, so the design wave can restyle it without touching this logic.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Blueprint, groundUnder } from '../../curriculum/blueprint';
import {
  type GroundReport,
  type PlacementAnswer,
  type PlacementEvents,
  type PlacementPlan,
  type PlacementQuestion,
  planPlacement,
  settlePlacement,
  skipPlacement,
} from '../../curriculum/placement';
import type { Topic } from '../../data/model';
import { useSdk } from '../../store/sdk';
import { Button, Card, Chip, WoboHead } from '../../ui/primitives';

/** The screen's own layout. Two rules of spacing, no colour: the kit owns how this looks. */
const COLUMN: React.CSSProperties = { display: 'grid', gap: 14 };
const ROW: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };

export interface PlacementCheckProps {
  plan: PlacementPlan;
  /** Where the diagnostics go. `sdk.events` satisfies this. */
  events?: PlacementEvents;
  /** The settled ground, handed straight on to whoever opened the gate. */
  onDone: (report: GroundReport) => void;
  /**
   * "Not now": the learner leaves the check without answering it and without claiming anything.
   * Nothing is persisted, so the same questions are offered the next time they open the topic.
   * Omitted only where there is genuinely nowhere to go back to.
   */
  onSkip?: () => void;
}

export function PlacementCheck({ plan, events, onDone, onSkip }: PlacementCheckProps) {
  const [at, setAt] = useState(0);
  const [typed, setTyped] = useState('');
  const answers = useRef<PlacementAnswer[]>([]);
  const asked = useRef(Date.now());
  /** The box holding this question's controls, so the focus lands on the answer and not the skip. */
  const panel = useRef<HTMLDivElement>(null);

  const question: PlacementQuestion | undefined = plan.questions[at];
  const total = plan.questions.length;

  // A fresh question is a fresh clock, a fresh box, and the focus moved onto it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the question index is the whole trigger
  useEffect(() => {
    asked.current = Date.now();
    setTyped('');
    panel.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, [at]);

  const settle = useCallback(
    (extra: readonly PlacementAnswer[]) => {
      onDone(settlePlacement(plan, [...answers.current, ...extra], { events }));
    },
    [plan, events, onDone],
  );

  const advance = useCallback(
    (answer: PlacementAnswer) => {
      answers.current = [...answers.current, answer];
      if (at + 1 < total) setAt(at + 1);
      else settle([]);
    },
    [at, total, settle],
  );

  /**
   * "I know this", for THE QUESTION ON SCREEN. One tap, one claim, about the one piece of ground
   * the learner was actually shown. Whatever comes after it is still asked.
   */
  const claimThis = useCallback(() => {
    if (!question) return;
    advance({
      question,
      value: 'solid',
      latencyMs: Math.max(0, Date.now() - asked.current),
      claimed: true,
    });
  }, [question, advance]);

  /**
   * "I know all of this": the deliberate version, offered only when there is more than one left and
   * labelled with how many it covers. The claim itself is `skipPlacement`, so the screen and the
   * module cannot drift into two ideas of what a claim is.
   */
  const claimRest = useCallback(() => {
    onDone(
      skipPlacement(plan, {
        events,
        answered: answers.current,
        from: at,
        latencyMs: Math.max(0, Date.now() - asked.current),
      }),
    );
  }, [plan, events, at, onDone]);

  const answer = useCallback(
    (value: string) => {
      if (!question) return;
      advance({ question, value, latencyMs: Math.max(0, Date.now() - asked.current) });
    },
    [question, advance],
  );

  if (!question) return null;
  const remaining = total - at;

  return (
    <section
      aria-labelledby="placement-heading"
      style={{ display: 'grid', placeItems: 'center', padding: 20 }}
    >
      <Card style={{ maxWidth: 520, width: '100%', ...COLUMN }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <WoboHead size={40} />
          <p style={{ margin: 0 }}>
            Before {plan.topicName.toLowerCase()}, one look at the ground under it.
          </p>
        </div>

        <h1 id="placement-heading" style={{ margin: 0 }}>
          {question.prompt}
        </h1>
        <p aria-live="polite" style={{ margin: 0 }}>
          Question {at + 1} of {total}
        </p>

        <div ref={panel}>
          {question.kind === 'item' ? (
            <ItemQuestion question={question} typed={typed} onType={setTyped} onAnswer={answer} />
          ) : (
            <SelfQuestion question={question} onAnswer={answer} />
          )}
        </div>

        <div style={ROW}>
          <Button tone="quiet" onClick={claimThis}>
            I know this
          </Button>
          {remaining > 1 && (
            <Button tone="quiet" onClick={claimRest}>
              I know all {remaining} of these
            </Button>
          )}
          {onSkip && (
            <Button tone="quiet" onClick={onSkip}>
              Not now
            </Button>
          )}
        </div>
        <small>
          Nothing here is a wall. Say you know it and we go straight on, Wobo remembers you said so,
          and you can tell Wobo to forget it whenever you want.
        </small>
      </Card>
    </section>
  );
}

function SelfQuestion({
  question,
  onAnswer,
}: {
  question: PlacementQuestion;
  onAnswer: (value: string) => void;
}) {
  const options = useMemo(() => question.options ?? [], [question.options]);
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, ...COLUMN }}>
      <legend style={{ padding: 0 }}>{question.prereqName}</legend>
      <div style={ROW}>
        {options.map((option) => (
          <Chip key={option.id} onClick={() => onAnswer(option.id)}>
            {option.label}
          </Chip>
        ))}
      </div>
    </fieldset>
  );
}

function ItemQuestion({
  question,
  typed,
  onType,
  onAnswer,
}: {
  question: PlacementQuestion;
  typed: string;
  onType: (value: string) => void;
  onAnswer: (value: string) => void;
}) {
  const id = `placement-item-${question.id}`;
  return (
    <form
      style={COLUMN}
      onSubmit={(e) => {
        e.preventDefault();
        if (typed.trim()) onAnswer(typed);
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>{question.equation}</p>
      <label htmlFor={id}>Your answer</label>
      <input
        id={id}
        value={typed}
        onChange={(e) => onType(e.target.value)}
        inputMode="text"
        autoComplete="off"
        enterKeyHint="done"
      />
      <Button type="submit" tone="pig" disabled={!typed.trim()}>
        Check
      </Button>
    </form>
  );
}

// --- the gate -------------------------------------------------------------------------------------

export type PlacementGate =
  | { status: 'planning'; plan: null }
  | { status: 'checking'; plan: PlacementPlan }
  | { status: 'clear'; plan: null };

/**
 * Plan the check for a topic the learner is about to open.
 *
 * `clear` is the common answer and it is the fast one: no unmet ground, or ground already placed,
 * and the lesson opens as it always did. Nothing here blocks on the network: the sources degrade
 * to "ask the learner", so a check still runs offline.
 */
export function usePlacementGate(
  topic: Topic | undefined,
  completed: ReadonlySet<string>,
  enabled = true,
  /**
   * The chapter's pool, when the architect has built one (`curriculum/pool.ts`).
   *
   * THE ARCHITECT FIRST. `planPlacement` has always preferred the ground a blueprint DECLARES
   * over the ground this client derives from a printed order. Until 2026-09-10 nothing passed it
   * one, so that branch was unreachable and every check ran on the derived graph. What the learner
   * answers here is what pulls the matching prerequisite module into their group.
   */
  pool: Blueprint | null = null,
): PlacementGate & { dismiss: () => void } {
  const sdk = useSdk();
  // A gate that is off, or has no topic to gate, is clear on the FIRST render: a course with
  // nothing to check must not hold the screen for a frame it does not need.
  const [gate, setGate] = useState<PlacementGate>(() =>
    enabled && topic ? { status: 'planning', plan: null } : { status: 'clear', plan: null },
  );
  const dismiss = useCallback(() => setGate({ status: 'clear', plan: null }), []);
  // The gate is planned once per topic ADDRESS, not once per topic object: re-ingesting a chapter
  // mints new topic objects, and a check the learner is halfway through must not restart under
  // them. `completed` is read at the same moment, for the same reason.
  const latest = useRef({ topic, completed });
  latest.current = { topic, completed };
  const topicId = topic?.id;

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the address, read through the ref
  useEffect(() => {
    const { topic: here, completed: done } = latest.current;
    if (!enabled || !here) {
      setGate({ status: 'clear', plan: null });
      return;
    }
    let live = true;
    setGate({ status: 'planning', plan: null });
    void planPlacement(here, done, {
      items: (nodeId) => sdk.content.getPracticeItems(nodeId),
      ontology: (nodeId) => sdk.kgtopg.ontology.getPrerequisites(nodeId),
      ...(pool ? { assumptions: (t: Topic) => groundUnder(pool, t.id) } : {}),
    })
      .then((plan) => {
        if (!live) return;
        setGate(plan ? { status: 'checking', plan } : { status: 'clear', plan: null });
      })
      .catch(() => {
        // A gate that cannot be planned is a gate that does not exist. The lesson opens.
        if (live) setGate({ status: 'clear', plan: null });
      });
    return () => {
      live = false;
    };
  }, [enabled, topicId, sdk, pool]);

  return { ...gate, dismiss };
}
