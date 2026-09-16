'use client';

/**
 * The atom journey — the complete proven course for linear equations (topic m2-1, the real
 * ontology node). Arrival → balance-scale discovery → what-if sandbox → practice run → boss →
 * the greeting → the mystery tease. One idea per card, act-to-reveal, events on every meaningful
 * action (CONTEXT.md §5).
 *
 * WHEN THE CHAPTER HAS A POOL, THE MIDDLE IS A WALK, NOT A LIST (docs/LEARNING-MODEL.md, "The tutor
 * never leaves"). The course hands this player the module the learner's group names
 * (`screens/course/climb.ts`), and the player puts it on the card that is what the module is: a
 * simulation on the scale and the free play, a worked module on a worked example, an items module
 * on the practice run. When a module ends the course chooses again from what just happened, so a
 * practice run that beat the learner twice is followed by a different module rather than by its own
 * next item.
 *
 * THE BOSS IS THE PROOF, ON A WALK AND OFF ONE. When the learner's band holds, the boss door opens:
 * three questions the course has never shown solved (a worked module solves a twin, never an item
 * the course asks). The topic closes at one decision, `topicClosed` (band held AND boss passed), and
 * only then come the greeting and completion. A boss not passed closes nothing: on a walk the course
 * chooses again, and the door reopens once a check has landed since.
 *
 * THE WALK IS DECIDED WHEN IT IS NEEDED. The lesson never waits on the pool (`Course.tsx`). A pool in
 * hand when the learner leaves the arrival card starts the walk there; one that lands later joins it
 * at the next module boundary. A replay of a topic that still holds is the journey it always was;
 * a completed topic whose band has slipped is walked again. With no pool at all, the journey is the
 * fixed one it always was, and its boss is the same proof.
 */

import type { PracticeItem } from '@wobo/sdk';
import { useWoboBus, WaitScene } from '@wobo/wobo';
import { motion } from 'framer-motion';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { groundFor } from '../../curriculum/placement';
import { chapterById, topicById } from '../../curriculum/registry';
import type { Topic } from '../../data/model';
import { useProgress } from '../../store/progress';
import { useSdk } from '../../store/sdk';
import { nextThing, wayBack } from '../../suggest/kind';
import { Suggestions } from '../../suggest/Suggestions';
import { BossSigil } from '../../ui/art';
import { CourseIntroScene } from '../../ui/courseIntro';
import { hueForTopic, subjectForTopic } from '../../ui/hues';
import { type BridgeLesson, bridgeFor, bridgeFromReport } from '../../wobo/bridge';
import { announceCard } from '../../wobo/speech';
import { topicNodeId } from '../learn/mastery';
import { BalanceScale } from './BalanceScale';
import { Boss } from './Boss';
import { BridgeStep } from './BridgeStep';
import {
  type AtomModuleCard,
  atomCardFor,
  atomResumeCard,
  type Climb,
  topicClosed,
  topicHeld,
  workedFor,
} from './climb';
import { Greeting } from './Greeting';
import { MysteryLesson, MysteryTease } from './Mystery';
import { atomCardFromLink } from './open-at';
import { PracticeRun } from './PracticeRun';
import type { BarState, LessonOutline } from './shared';
import {
  CardBody,
  Deck,
  lead,
  readCoursePos,
  rgba,
  Stage,
  whisper,
  writeCoursePos,
} from './shared';
import { WhatIf } from './WhatIf';
import { Worked } from './Worked';

type CardId =
  | 'arrival'
  // The ground under this topic, when the learner does not yet stand on all of it. The atom is the
  // one node with verifier-frozen practice items, so it is the one place the placement check can
  // ask a real checked question instead of a self report, and it was the one player that never laid
  // a bridge: the topic where the check had teeth was the topic where nothing was done with it.
  | 'bridge'
  | 'scale'
  | 'whatif'
  // a worked module: one of the node's own items, solved move by move (only ever on a walk)
  | 'worked'
  | 'practice'
  | 'bossdoor'
  | 'boss'
  | 'greeting'
  | 'tease'
  | 'mystery';

const SEGMENTS = 9;
/**
 * The lesson's own ideas, for the side column — each card's own headline, in order, the way the
 * prototype lists "A right angle and its sides, Squares on each side, …" rather than the machinery
 * behind them. The arrival card is the topic itself, so it has no step of its own; the greeting,
 * the tease and the mystery are not steps of the lesson (a mystery lesson is discovered, never
 * assigned — DESIGN.md §9), so the column ends at the boss.
 */
const STEPS: readonly [CardId, string][] = [
  ['scale', 'Get x alone'],
  ['whatif', 'Every number here is yours to drag'],
  ['practice', 'Solve for x'],
  ['boss', 'Three questions, one scale'],
];
/** Where each card sits against the steps: the door stands before the boss; the end is past it. */
const STEP_AT: Record<CardId, number> = {
  arrival: -1,
  bridge: -1, // the run-up to the lesson, not a step of it

  scale: 0,
  worked: 0, // another way into the same idea as the scale
  whatif: 1,
  practice: 2,
  bossdoor: 3,
  boss: 3,
  greeting: 4,
  tease: 4,
  mystery: 4,
};
/** Per-card progress: base fill + the span the card's own sub-progress moves through. */
const PROGRESS: Record<CardId, [base: number, span: number]> = {
  arrival: [0.08, 0], // endowed — it never starts empty
  bridge: [0.12, 0],
  scale: [0.2, 0],
  worked: [0.3, 0],
  whatif: [0.36, 0],
  practice: [0.5, 0.22],
  bossdoor: [0.74, 0],
  boss: [0.78, 0.16],
  greeting: [1, 0],
  tease: [1, 0],
  mystery: [1, 0],
};

export function AtomJourney({
  topic,
  nodeId,
  openAt,
  setBar,
  setProgress,
  onExit,
  onResume,
  onOutline,
  climb = null,
}: {
  topic: Topic;
  nodeId: string;
  /**
   * The card a link asked to open on (docs/EMAILS-AND-ANIMATIONS.md §4). It BEATS the saved
   * position, because the learner pressed a button that named this card; a card this lesson does
   * not have is not a card, and the course opens where it always opens (`open-at.ts`).
   */
  openAt?: string | undefined;
  setBar: (b: BarState | null) => void;
  setProgress: (p: { f: number; segments: number }) => void;
  onExit: () => void;
  /** Fired once when the player restores a saved mid-course position. */
  onResume?: () => void;
  /** The steps and the one on stage, for the lesson's side column. */
  onOutline?: (outline: LessonOutline) => void;
  /**
   * The learner's walk through the chapter's pool, when there is one and it holds something this
   * player can show (`screens/course/climb.ts`). Null is the ordinary answer: the journey below runs
   * exactly as it always did.
   */
  climb?: Climb | null;
}) {
  const sdk = useSdk();
  const bus = useWoboBus();
  const { award, completed, setReplay } = useProgress();
  // The ground the learner stands on, read once at the door. A bridge that appeared halfway through
  // would be a detour; this one is the run-up, so it is decided before the lesson starts.
  const groundAtEntry = useRef(completed).current;

  // Owner replay law: a completed course can be redone freely, but earns no xp. Captured once at
  // mount (completeTopic flips `completed` at the greeting, so a live read would mislabel the very
  // first run as a replay).
  const replay = useRef(completed.has(topic.id)).current;

  // THE ONE RECORD. The band is read under the key the Learn board reads (`topicNodeId`), which for
  // the atom is the node every answer here is recorded against.
  const evidenceNode = topicNodeId(topic);
  const bandNow = useCallback(() => sdk.mastery.bands()[evidenceNode], [sdk, evidenceNode]);

  // THE WALK: 'open' until a pool that can serve this screen is in hand at a moment it is needed,
  // 'on' from then, 'off' for good (a replay of a topic that still holds, or a pool that ran out of
  // anything this screen can show). A completed topic whose band has slipped is walked again.
  const walkRef = useRef<'open' | 'on' | 'off'>(
    replay && topicHeld(sdk.mastery.bands()[evidenceNode]) ? 'off' : climb ? 'on' : 'open',
  );
  const walking = walkRef.current === 'on' && Boolean(climb);

  const [card, setCard] = useState<CardId>(() => {
    // A link that named a card wins over everything below it — including a replay's fresh start,
    // because pressing "the card they left" in a mail about a course they finished still means
    // that card. It earns nothing: the replay guard below is untouched by where the walk begins.
    const asked = atomCardFromLink(openAt);
    if (asked) return asked;
    // Resume where they left off — a course remembers its place (cliffhanger-friendly). A completed
    // course never resumes a stale end state: a replay always begins at the first card.
    const saved = readCoursePos(topic.id);
    // Mid-walk, the place to come back to is the module the walk names now. The course already
    // started the walk on the module played on this card when the learner's group still holds one
    // (`atomResumeCard`), so this is the saved card whenever that is still true.
    if (walking && climb && atomResumeCard(saved)) {
      const on = atomCardFor(climb.on) ?? 'scale';
      return saved === 'whatif' && on === 'scale' ? 'whatif' : on;
    }
    if (
      !replay &&
      typeof saved === 'string' &&
      saved !== 'arrival' &&
      saved !== 'bridge' &&
      saved !== 'greeting' &&
      saved !== 'tease' &&
      saved !== 'mystery'
    ) {
      return saved as CardId;
    }
    return 'arrival';
  });
  // "Picking up where you left off" is only true when they WERE here. A link that landed on a
  // card put them there just now, and saying it anyway would be the app narrating something that
  // did not happen (DESIGN.md §0.x).
  // On a walk the learner can come back to a different module than the one they left (what beat
  // them is out of the group), and then this would not be true either.
  const resumedRef = useRef(
    card !== 'arrival' && !atomCardFromLink(openAt) && card === readCoursePos(topic.id),
  );
  useEffect(() => {
    onOutline?.({ steps: STEPS.map((s) => s[1]), at: STEP_AT[card] });
  }, [card, onOutline]);
  const [sub, setSub] = useState(0);
  const [items, setItems] = useState<PracticeItem[]>([]);
  // One sitting per module handed: a module handed again is a fresh card, never the last one's state.
  const [sitting, setSitting] = useState(0);
  // The practice items that beat the learner, oldest first: a twin of the latest is worked through
  // next, and they come last in a sitting.
  const missedItems = useRef<string[]>([]);
  const missesTotal = useRef(0);
  // The boss's rounds so far (each one not passed starts on a different question), and the items
  // whose answers a checked round has put on screen.
  const [bossRound, setBossRound] = useState(0);
  const bossShown = useRef(new Set<string>());
  // The boss door opens when the band holds; after a round not passed, only once a check has
  // landed again since.
  const bossDue = useRef(true);
  // how many of the boss's three the learner got right — the greeting's performance-star signal
  const [bossCorrect, setBossCorrect] = useState(3);
  const enteredAt = useRef(Date.now());
  const attempts = useRef(0);
  const enteredFired = useRef(false);

  const chapter = chapterById(topic.chapterId);

  // Wobo reads each card's core line on arrival. Teaching cards gate the advance button (true);
  // celebration + the boss workbook narrate without locking (false). Practice is omitted — the run
  // reads each question itself as the learner moves.
  useEffect(() => {
    const name = topic.name.toLowerCase();
    const lines: Partial<Record<CardId, [text: string, gate: boolean]>> = {
      arrival: [`${name}. one idea — a scale that cannot lie, and a boss at the end.`, true],
      bridge: ['first, the ground under this one, so we walk up into it rather than at it.', true],
      scale: [
        'Here is a scale that cannot lie. Whatever you do to one side, do to the other, and it stays balanced.',
        true,
      ],
      worked: ['One worked all the way through. Press for each move, and watch both sides.', true],
      whatif: ['Now play. Change a number, and watch the whole equation answer back.', true],
      bossdoor: [
        'the boss. three questions you have not met yet, everything you just did at once. two of three closes the topic.',
        true,
      ],
      boss: ['Take your time. Solve it, fill in the missing step, and spot the error.', false],
      greeting: ['You did it. You can move a whole equation now, and keep it true.', false],
      tease: ['One more thing before you go — a small mystery.', false],
      mystery: ['Here is the twist that makes it all click.', false],
    };
    const entry = lines[card];
    if (entry) announceCard(`atom-${topic.id}-${card}-${sitting}`, entry[0], entry[1]);
  }, [card, topic.id, topic.name, sitting]);

  // resumed mid-course — let the shell show the quiet "picking up where you left off" beat, once
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only, resumedRef is stable
  useEffect(() => {
    if (resumedRef.current) onResume?.();
  }, []);

  // hold the store's replay guard open for as long as this completed course is on screen — every
  // award and completion inside then no-ops (no xp, no bloom, no level math).
  useEffect(() => {
    setReplay(replay);
    return () => setReplay(false);
  }, [setReplay, replay]);

  // arrival: the entered event, with the band the evidence plane currently holds
  useEffect(() => {
    if (enteredFired.current) return;
    enteredFired.current = true;
    bus.publishCurriculum({ nodeId, nodeName: topic.name });
    void (async () => {
      let band = 'not_started';
      try {
        const bands = await sdk.kgtopg.mastery.getBands(sdk.subjectId);
        band = bands.find((b) => b.node_id === nodeId)?.band ?? band;
      } catch {
        // fresh learner — not_started is the honest default
      }
      sdk.events.record(
        'learn.node.entered.v1',
        {
          node_id: nodeId,
          entry: 'map',
          initial_band: band as
            | 'not_started'
            | 'emerging'
            | 'developing'
            | 'secure'
            | 'independent',
        },
        { ontologyNodeId: nodeId },
      );
    })();
  }, [bus, sdk, nodeId, topic.name]);

  useEffect(() => {
    void sdk.content.getPracticeItems(nodeId).then((fetched) => {
      setItems([...fetched].sort((a, b) => a.difficulty - b.difficulty));
    });
  }, [sdk, nodeId]);

  useEffect(() => {
    const entry = PROGRESS[card];
    setProgress({ f: Math.min(1, entry[0] + sub * entry[1]), segments: SEGMENTS });
  }, [setProgress, card, sub]);

  // Every content type pays out on completion — small, once per topic, felt immediately.
  const CARD_XP: Partial<Record<CardId, number>> = useMemo(
    () => ({ scale: 15, worked: 15, whatif: 15, practice: 20 }),
    [],
  );
  const go = useCallback(
    (next: CardId) => {
      writeCoursePos(topic.id, next);
      const earned = CARD_XP[card];
      if (earned) award('bonus', { amount: earned, onceKey: `card-${topic.id}-${card}` });
      setSub(0);
      setCard(next);
    },
    [card, CARD_XP, award, topic.id],
  );

  const onAttempt = useCallback(() => {
    attempts.current += 1;
  }, []);

  // --- the walk ----------------------------------------------------------------------------------

  /** The band holds, and the boss is due: the door to the proof opens. */
  const ready = useCallback(() => topicHeld(bandNow()) && bossDue.current, [bandNow]);

  /**
   * THE MODULE BOUNDARY. The module on stage ended with `misses` in this sitting: the course records
   * it and chooses again. A clean check makes the boss due again; a band that holds opens the boss
   * door. A pool that has nothing more this screen can show hands the learner back to the journey's
   * own way in.
   */
  const endModule = useCallback(
    (misses: number) => {
      if (walkRef.current !== 'on' || !climb) return;
      const ended = climb.on;
      const next = climb.end(misses);
      if (misses === 0 && ended.role === 'check') bossDue.current = true;
      setSitting((n) => n + 1);
      if (ready()) {
        go('bossdoor');
        return;
      }
      const nextCard = next ? atomCardFor(next) : null;
      if (!nextCard) {
        walkRef.current = 'off';
        go('scale');
        return;
      }
      go(nextCard);
    },
    [climb, ready, go],
  );
  const endClean = useCallback(() => endModule(0), [endModule]);

  /**
   * THE NEXT THING AND THE WAY BACK (docs/SUGGESTIONS-AND-NOTICES.md §2), at the moment the module
   * on stage is about to end with `misses`. Both name what `endModule` is about to put on stage,
   * asked of the course (`climb.peek`) and never chosen here, so a suggestion cannot contradict the
   * course. Nothing when the course is going to the boss door, when it would hand back the module
   * on stage, or when it has nothing this screen can show. `take` is the card's own way on.
   */
  const suggestAt = useCallback(
    (misses: number, ending: 'beaten' | 'done', take: () => void): ReactNode => {
      if (walkRef.current !== 'on' || !climb) return null;
      const ended = climb.on;
      const bossNext =
        topicHeld(bandNow()) && (bossDue.current || (misses === 0 && ended.role === 'check'));
      if (bossNext) return null;
      const next = climb.peek(misses);
      if (!next || next.id === ended.id || !atomCardFor(next)) return null;
      const offer =
        ending === 'beaten'
          ? wayBack({ bp: climb.pool, topicId: topic.id, from: ended.id, held: climb.held(), next })
          : nextThing({ bp: climb.pool, topicId: topic.id, next });
      return <Suggestions candidates={[offer]} hue={hueForTopic(topic.id)} onTake={() => take()} />;
    },
    [climb, bandNow, topic.id],
  );
  const practiceOffer = useCallback(
    (at: { misses: number; ending: 'beaten' | 'done'; take: () => void }) =>
      suggestAt(at.misses, at.ending, at.take),
    [suggestAt],
  );

  /** The walk starts here if it has not and a pool that can serve this screen is now in hand. */
  const joinWalk = useCallback((): boolean => {
    if (walkRef.current === 'open' && climb) walkRef.current = 'on';
    return walkRef.current === 'on' && Boolean(climb);
  }, [climb]);

  /**
   * A MODULE OF THE FIXED JOURNEY ENDED. When a pool has landed since the door, the walk takes over
   * here: if the walk's module is the one just played, its end is recorded and the course chooses;
   * otherwise the walk's module is next. With no pool, the journey goes on as it always did.
   */
  const fixedEnd = useCallback(
    (ended: AtomModuleCard, misses: number, onward: CardId) => {
      if (walkRef.current === 'open' && joinWalk() && climb) {
        if (atomCardFor(climb.on) === ended) {
          endModule(misses);
          return;
        }
        setSitting((n) => n + 1);
        if (ready()) {
          go('bossdoor');
          return;
        }
        go(atomCardFor(climb.on) ?? onward);
        return;
      }
      go(onward);
    },
    [joinWalk, climb, endModule, ready, go],
  );

  /**
   * NOT YET. A boss round not passed, or passed while the band does not hold: nothing closes. The
   * boss waits for a check to land again and will start on another question; on a walk the course
   * chooses what comes now, and off one the practice run comes round again.
   */
  const notYet = useCallback(() => {
    bossDue.current = false;
    setBossRound((r) => r + 1);
    setSitting((n) => n + 1);
    if (joinWalk() && climb) {
      const next = climb.again();
      const nextCard = next ? atomCardFor(next) : null;
      if (nextCard) {
        go(nextCard);
        return;
      }
      walkRef.current = 'off';
    }
    go('practice');
  }, [joinWalk, climb, go]);

  const onMiss = useCallback(
    (item: PracticeItem) => {
      climb?.miss();
      missesTotal.current += 1;
      missedItems.current = [...missedItems.current.filter((id) => id !== item.id), item.id];
    },
    [climb],
  );
  const onUnmiss = useCallback(() => {
    climb?.unmiss();
    missesTotal.current = Math.max(0, missesTotal.current - 1);
  }, [climb]);
  const until = useCallback(
    (): 'beaten' | 'held' | false => (ready() ? 'held' : climb?.beaten() ? 'beaten' : false),
    [ready, climb],
  );
  const onRevealed = useCallback((ids: string[]) => {
    for (const id of ids) bossShown.current.add(id);
  }, []);

  const onScaleReveal = useCallback(
    (struggles: number) => {
      sdk.events.record(
        'learn.reveal.shown.v1',
        {
          node_id: nodeId,
          reveal_id: crypto.randomUUID(),
          modality: 'interactive',
          after_attempts: struggles,
          verification_hash: 'seed-balance-scale-x-plus-3-eq-8-v1',
        },
        { ontologyNodeId: nodeId },
      );
    },
    [sdk, nodeId],
  );

  // stable identities — bar-setting effects in the cards depend on these
  const toWhatif = useCallback(() => go('whatif'), [go]);
  const toPractice = useCallback(() => fixedEnd('scale', 0, 'practice'), [fixedEnd]);
  const workedDone = useCallback(() => fixedEnd('worked', 0, 'practice'), [fixedEnd]);
  const toBossdoor = useCallback(
    (misses: number) => fixedEnd('practice', misses, 'bossdoor'),
    [fixedEnd],
  );
  const toTease = useCallback(() => go('tease'), [go]);
  const toMystery = useCallback(() => go('mystery'), [go]);
  const finishMystery = useCallback(() => {
    award('mystery', { onceKey: `mystery-${topic.id}` });
    onExit();
  }, [award, topic.id, onExit]);

  const practiceItems = useMemo(() => items.slice(0, 3), [items]);
  const bossItems = useMemo(() => {
    const base = items.length >= 6 ? items.slice(3, 6) : items.slice(0, 3);
    const k = base.length > 0 ? bossRound % base.length : 0;
    // [A, B, C] then [C, A, B]: a round after one not passed opens on a question whose answer the
    // boss has not shown (the error item's own answer is never on screen).
    return k === 0 ? base : [...base.slice(base.length - k), ...base.slice(0, base.length - k)];
  }, [items, bossRound]);
  // THE BOSS DECIDES, WITH THE BAND. Read after the round's own answers are on the record.
  const toGreeting = useCallback(
    (correct: number) => {
      setBossCorrect(correct);
      if (topicClosed(bandNow(), { correct, total: bossItems.length })) {
        go('greeting');
        return;
      }
      notYet();
    },
    [go, bandNow, bossItems.length, notYet],
  );
  const bossFailed = useCallback(() => notYet(), [notYet]);
  // On a walk, a sitting of the practice run starts with what has not beaten them yet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-ordered once per sitting, from the ref
  const sittingItems = useMemo(() => {
    if (!walking) return practiceItems;
    const rank = (i: PracticeItem) => missedItems.current.indexOf(i.id);
    return [...practiceItems].sort((a, b) => rank(a) - rank(b));
  }, [practiceItems, walking, sitting]);
  // A twin of the item that beat them last, never an item the course will ask (`workedFor`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: chosen once per sitting, from the ref
  const workedItem = useMemo(
    () =>
      workedFor(
        practiceItems.find((i) => i.id === missedItems.current.at(-1)),
        items,
      ),
    [practiceItems, items, sitting],
  );

  /**
   * THE BRIDGE (wobo/bridge.ts). Asked for on mount, so it is ready while the arrival card is on
   * screen and the learner never waits for it. The placement check's own report wins when one has
   * settled for this topic; with none, the derived prerequisite graph is the honest fallback. A
   * refusal anywhere resolves to null, and the journey runs exactly as it always did.
   */
  const [bridge, setBridge] = useState<BridgeLesson | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked once at the door, like the course's own bridge — a bridge that appeared mid-lesson would be a detour
  useEffect(() => {
    let cancelled = false;
    const settled = groundFor(topic.id);
    void (
      settled
        ? bridgeFromReport(sdk, topic, settled, topicById, groundAtEntry)
        : bridgeFor(sdk, { topic, completed: groundAtEntry, lookup: topicById })
    )
      .then((lesson) => {
        if (!cancelled) setBridge(lesson);
      })
      .catch(() => {
        // no bridge is a lesson that simply begins, never an error the learner sees
      });
    return () => {
      cancelled = true;
    };
  }, [sdk, topic.id]);

  // Where the lesson starts: straight into the idea, which on a walk is the card of the module the
  // learner's group starts with. The walk is decided here, with whatever pool is in hand now.
  const toScale = useCallback(() => {
    go(joinWalk() && climb ? (atomCardFor(climb.on) ?? 'scale') : 'scale');
  }, [go, joinWalk, climb]);
  // Where "Begin" goes: over the ground when there is ground to cross, else into the idea.
  const afterArrival = useCallback(() => {
    if (bridge) go('bridge');
    else toScale();
  }, [go, bridge, toScale]);

  // static cards set their own bar here
  useEffect(() => {
    if (card === 'arrival') {
      setBar({ primary: { label: 'Begin', onClick: afterArrival } });
    } else if (card === 'bossdoor') {
      setBar({ primary: { label: 'Step in', onClick: () => go('boss') } });
    }
  }, [card, setBar, go, afterArrival]);

  // Which module is on stage, for Wobo's reading of the page and for the played tests. Never shown.
  const onStage =
    walking &&
    climb &&
    (card === 'scale' || card === 'whatif' || card === 'worked' || card === 'practice')
      ? climb.on.id
      : undefined;

  return (
    <Deck id={card}>
      <div data-module={onStage} style={{ display: 'contents' }}>
        {card === 'arrival' && (
          <CardBody maxWidth={620}>
            {/* this course's own arrival scene — sigil geometry + subject hue + a small cast */}
            <CourseIntroScene
              topicId={topic.id}
              hue={hueForTopic(topic.id)}
              minHeight={320}
              sigilSize={150}
            />
            <div style={{ textAlign: 'center' }}>
              <div style={whisper}>{(chapter?.name ?? 'mathematics').toLowerCase()}</div>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.5, ease: [0.2, 0, 0, 1] }}
                style={{
                  marginTop: 12,
                  fontSize: 'clamp(1.9rem, 6vw, 2.5rem)',
                  fontWeight: 600,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.12,
                  color: 'var(--wobo-ink-900)',
                }}
              >
                {topic.name.toLowerCase()}
              </motion.div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.5 }}
                style={{ ...lead, marginTop: 12 }}
              >
                one idea, a scale that cannot lie, and a boss at the end.
              </motion.div>
            </div>
          </CardBody>
        )}

        {card === 'bridge' && bridge && (
          <BridgeStep
            lesson={bridge}
            hue={hueForTopic(topic.id)}
            setBar={setBar}
            onDone={toScale}
          />
        )}

        {card === 'scale' && (
          <BalanceScale
            key={`scale-${sitting}`}
            nodeId={nodeId}
            setBar={setBar}
            onReveal={onScaleReveal}
            onDone={toWhatif}
          />
        )}

        {card === 'whatif' && (
          <WhatIf
            key={`whatif-${sitting}`}
            nodeId={nodeId}
            setBar={setBar}
            onDone={walking ? endClean : toPractice}
          />
        )}

        {card === 'worked' &&
          (workedItem ? (
            <Worked
              key={`worked-${sitting}`}
              item={workedItem}
              setBar={setBar}
              onDone={walking ? endClean : workedDone}
              after={walking ? suggestAt(0, 'done', endClean) : null}
            />
          ) : null)}

        {card === 'practice' &&
          (practiceItems.length > 0 ? (
            <PracticeRun
              key={`practice-${sitting}`}
              nodeId={nodeId}
              topicName={topic.name}
              items={walking ? sittingItems : practiceItems}
              setBar={setBar}
              setSub={setSub}
              onAttempt={onAttempt}
              onDone={walking ? endModule : toBossdoor}
              onMiss={walking ? onMiss : undefined}
              onUnmiss={walking ? onUnmiss : undefined}
              until={walking ? until : undefined}
              ladder={!walking}
              replay={replay}
              offer={walking ? practiceOffer : undefined}
            />
          ) : (
            <CardBody>
              {/* The three are coming. The orb draws this subject's own thing while they do. */}
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <WaitScene
                  subject={subjectForTopic(topic.id)}
                  pigment={hueForTopic(topic.id)}
                  width={220}
                />
              </div>
            </CardBody>
          ))}

        {card === 'bossdoor' && (
          <CardBody maxWidth={620}>
            {/* the weighted moment — a tonal stage; the topic's sigil glowing in its ring */}
            <Stage tonal minHeight={340}>
              <motion.div
                aria-hidden
                animate={{ opacity: [0.5, 0.85, 0.5], scale: [1, 1.08, 1] }}
                transition={{ duration: 4.2, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
                style={{
                  position: 'absolute',
                  width: 300,
                  height: 300,
                  borderRadius: 999,
                  background: `radial-gradient(circle, ${rgba(hueForTopic(topic.id), 0.16)} 0%, transparent 62%)`,
                  pointerEvents: 'none',
                }}
              />
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 230, damping: 26, delay: 0.15 }}
                style={{ position: 'relative' }}
              >
                <BossSigil id={topic.id} size={120} mastered hue={hueForTopic(topic.id)} />
              </motion.div>
              <div
                style={{
                  ...whisper,
                  position: 'relative',
                  marginTop: 22,
                }}
              >
                no fear — just weight
              </div>
            </Stage>
            <div style={{ textAlign: 'center' }}>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.5, ease: [0.2, 0, 0, 1] }}
                style={{
                  fontSize: 'clamp(1.6rem, 5vw, 2rem)',
                  fontWeight: 600,
                  letterSpacing: '-0.025em',
                  lineHeight: 1.15,
                  color: 'var(--wobo-ink-900)',
                }}
              >
                the boss
              </motion.div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.5 }}
                style={{ ...lead, marginTop: 12 }}
              >
                three questions you have not met yet, everything you just did at once. two of three
                closes the topic.
              </motion.div>
            </div>
          </CardBody>
        )}

        {card === 'boss' && (
          <Boss
            key={`boss-${bossRound}`}
            nodeId={nodeId}
            items={bossItems}
            setBar={setBar}
            setSub={setSub}
            onAttempt={onAttempt}
            onPass={toGreeting}
            onFail={walking ? bossFailed : undefined}
            shown={bossShown.current}
            onRevealed={onRevealed}
          />
        )}

        {card === 'greeting' && (
          <Greeting
            topic={topic}
            nodeId={nodeId}
            attemptsTotal={attempts.current}
            enteredAt={enteredAt.current}
            setBar={setBar}
            onContinue={toTease}
            bossCorrect={bossCorrect}
            bossTotal={bossItems.length}
            itemsTotal={
              walking
                ? Math.max(1, attempts.current - missesTotal.current)
                : practiceItems.length + bossItems.length
            }
            replay={replay}
          />
        )}

        {card === 'tease' && <MysteryTease setBar={setBar} onOpen={toMystery} onSkip={onExit} />}

        {card === 'mystery' && <MysteryLesson setBar={setBar} onDone={finishMystery} />}
      </div>
    </Deck>
  );
}
