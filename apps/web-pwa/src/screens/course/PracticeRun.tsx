'use client';

/**
 * The practice run — three quick items, number-pad entry, honest events. A wrong answer never
 * shames: it detonates the misconception (DESIGN.md §9) — the learner's own number is substituted
 * back into the equation, the equality visibly breaks, the correct move replays (never the final
 * answer), and the item returns later in the run with an FSRS retry framing.
 */

import { type PracticeItem, reviewCard } from '@wobo/sdk';
import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion } from 'framer-motion';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { preferredAnalogy } from '../../store/mind';
import { useProgress, XP_AWARDS } from '../../store/progress';
import { useSdk } from '../../store/sdk';
import { ComboMeter, comboBreak, comboHit, XpTick } from '../../ui/combo';
import { sfx } from '../../ui/sound';
import { hintNote, screenStore } from '../../wobo/board-turn';
import { useWoboChat } from '../../wobo/chat';
import { openCompanion } from '../../wobo/drawer';
import { noteConceptCorrect, reteachOnMiss, seedFromEvidence } from '../../wobo/reteach';
import { announceCard } from '../../wobo/speech';
import { hintFor, maxHintDepth, noteCorrect, noteMiss, regrade, useTutor } from '../../wobo/tutor';
import { firstMove, fmt, linearize } from './equations';
import type { BarState } from './shared';
import { CardBody, cardTitle, lead, ParticlePop, rgba, Stage, whisper } from './shared';

const PAD_KEYS = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['−', '0', '⌫'],
] as const;

const HUE = 'var(--pig)';
/** The thing that needs care (DESIGN.md §0): a retry glows rose, never a hardcoded amber. */
const RETRY = 'var(--rose)';

/**
 * What happens to a missed item next, said only when it is true. It comes back in this run; or
 * this miss was the second and the course takes the same idea another way; or the run is over for
 * a better reason and nothing needs promising.
 */
export type AfterMiss = 'returns' | 'another_way' | 'nothing';

const AFTER_MISS: Record<AfterMiss, string | null> = {
  returns: 'this one comes back before the end — the finish is yours.',
  another_way: 'next, the same idea from another side. the finish is still yours.',
  nothing: null,
};

function Detonation({
  item,
  theirs,
  then = 'returns',
}: {
  item: PracticeItem;
  theirs: number;
  then?: AfterMiss;
}) {
  const lin = linearize(item.equation);
  if (!lin) return null;
  const lhsVal = lin.lhs(theirs);
  const rhsVal = lin.rhs(theirs);
  const lhsSrc = item.equation.split('=')[0]?.trim() ?? '';
  const substituted = lhsSrc.replace(/x/gi, `(${fmt(theirs)})`);
  const move = firstMove(lin);
  const at = (delay: number) => ({
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { delay, duration: 0.4, ease: [0.2, 0, 0, 1] as const },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center' }}>
      <motion.div {...at(0)} style={{ fontSize: '1.15rem', color: 'var(--wobo-ink-900)' }}>
        you said x = {fmt(theirs)} — watch.
      </motion.div>

      <motion.div
        {...at(0.5)}
        style={{
          fontSize: '1.35rem',
          fontWeight: 550,
          color: 'var(--wobo-ink-900)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {substituted} → {fmt(lhsVal)}
      </motion.div>

      {/* the equality physically cracks — a flash, then the two halves separate */}
      <div style={{ position: 'relative', padding: '6px 0' }}>
        {/* the flash at the moment of the break */}
        <motion.div
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.9, 0] }}
          transition={{ delay: 1.1, duration: 0.55, times: [0, 0.25, 1] }}
          style={{
            position: 'absolute',
            inset: -24,
            background: `radial-gradient(circle, ${rgba(RETRY, 0.3)} 0%, transparent 62%)`,
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            fontSize: '2rem',
            fontWeight: 600,
            color: 'var(--wobo-feedback-retry)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <motion.span
            initial={{ x: 0, rotate: 0 }}
            animate={{ x: [0, -6, -18], rotate: [0, -1, -3] }}
            transition={{ delay: 1.15, duration: 0.5, ease: [0.2, 0, 0.2, 1] }}
            style={{ display: 'inline-block' }}
          >
            {fmt(lhsVal)}
          </motion.span>
          {/* the crack itself, drawing down between the halves */}
          <span
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 46,
            }}
          >
            <motion.svg
              aria-hidden
              viewBox="0 0 16 56"
              width={16}
              height={56}
              style={{ position: 'absolute', top: -8 }}
            >
              <motion.path
                d="M 9 0 L 5 12 L 11 22 L 4 34 L 10 44 L 6 56"
                fill="none"
                stroke={RETRY}
                strokeWidth={2}
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ delay: 1.12, duration: 0.35, ease: [0.3, 0, 0.4, 1] }}
              />
            </motion.svg>
            <motion.span
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: [0.4, 1.35, 1] }}
              transition={{ delay: 1.5, duration: 0.4, times: [0, 0.55, 1] }}
              style={{ display: 'inline-block', position: 'relative' }}
            >
              ≠
            </motion.span>
          </span>
          <motion.span
            initial={{ x: 0, rotate: 0 }}
            animate={{ x: [0, 6, 18], rotate: [0, 1, 3] }}
            transition={{ delay: 1.15, duration: 0.5, ease: [0.2, 0, 0.2, 1] }}
            style={{ display: 'inline-block' }}
          >
            {fmt(rhsVal)}
          </motion.span>
        </div>
      </div>

      <motion.div {...at(1.8)} style={{ ...lead, textAlign: 'center' }}>
        the two sides stopped being equal — the scale tipped.
      </motion.div>

      <motion.div
        {...at(2.3)}
        style={{
          margin: '4px auto 0',
          padding: '14px 18px',
          border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
          borderRadius: 'var(--wobo-radius-md)',
          maxWidth: 420,
          background: 'var(--wobo-paper)',
        }}
      >
        <div style={{ ...whisper, marginBottom: 6 }}>The honest move</div>
        <div style={{ fontSize: '1rem', color: 'var(--wobo-ink-900)' }}>
          {move.text}
          {move.result ? ` → ${move.result}` : ''}
        </div>
        {AFTER_MISS[then] && (
          <div style={{ fontSize: '0.85rem', color: 'var(--wobo-ink-500)', marginTop: 6 }}>
            {AFTER_MISS[then]}
          </div>
        )}
      </motion.div>
    </div>
  );
}

export function PracticeRun({
  nodeId,
  topicName,
  items,
  setBar,
  setSub,
  onAttempt,
  onDone,
  onMiss,
  onUnmiss,
  until,
  ladder = true,
  replay = false,
  offer,
}: {
  nodeId: string;
  /** What is being practised, in the learner's words. Wobo re-teaches by name, never by node id. */
  topicName: string;
  items: PracticeItem[];
  setBar: (b: BarState | null) => void;
  setSub: (f: number) => void;
  onAttempt: () => void;
  /** The run is over. `misses` is how many answers in THIS run were wrong and stayed wrong. */
  onDone: (misses: number) => void;
  /**
   * A wrong answer, told to the course the moment it happens, so the module on stage carries it in
   * the product's tally (`screens/course/climb.ts`) even if the tab closes a second later.
   */
  onMiss?: (item: PracticeItem) => void;
  /** A wrong answer the verifier then overturned: it was never a miss. */
  onUnmiss?: () => void;
  /**
   * Asked after every answer and each time the learner moves on. Anything but false ends the run
   * there: `beaten`, the module has beaten them twice, so the course chooses again rather than
   * handing them the next item of the same run; `held`, the topic is held and there is nothing
   * left to prove.
   */
  until?: () => 'beaten' | 'held' | false;
  /**
   * Wobo's own re-teach ladder (`wobo/reteach.ts`): on a second miss it picks another approach and
   * asks the model for it. Off when the course itself chooses what follows a miss (a walk through
   * the chapter's pool, `climb.ts`): one screen has one answer to "stuck", and choosing never
   * costs a model call (docs/LEARNING-MODEL.md, "Who chooses"). Played 2026-09-16 before this: on
   * the same second miss the course moved to a worked module for free while the ladder opened
   * Wobo's drawer and sent the model a second "work one through" ask.
   */
  ladder?: boolean;
  /** A replay of a completed course — the correct-answer +xp chip is suppressed (no xp is earned). */
  replay?: boolean;
  /**
   * What the course would suggest at the moment this run is about to end, or nothing
   * (docs/SUGGESTIONS-AND-NOTICES.md §2). Asked with how the run ends: `beaten`, on the miss that
   * ends it; `done`, on the last item answered. `take` is the run's own Continue, so taking a
   * suggestion can never lead anywhere the course was not already going.
   */
  offer?: (at: { misses: number; ending: 'beaten' | 'done'; take: () => void }) => ReactNode;
}) {
  const sdk = useSdk();
  const bus = useWoboBus();
  const { award } = useProgress();
  const { setMood, ask, offline } = useWoboChat();
  const { mode } = useTutor();

  const [queue, setQueue] = useState<PracticeItem[]>(items);
  const [pos, setPos] = useState(0);
  const [phase, setPhase] = useState<'answer' | 'correct' | 'detonate'>('answer');
  const [entry, setEntry] = useState('');
  const [whyOpen, setWhyOpen] = useState(false);
  const [detReady, setDetReady] = useState(false);
  const [wrongValue, setWrongValue] = useState(0);
  const [afterMiss, setAfterMiss] = useState<AfterMiss>('returns');
  // the assistance ladder at work: hint depth per item, and the "I think I'm right" contest
  const [hintLevel, setHintLevel] = useState(0);
  const lastHintRef = useRef<string>('');
  const [contest, setContest] = useState<'idle' | 'checking' | 'upheld' | 'stood'>('idle');
  const [contestNote, setContestNote] = useState('');

  const startRef = useRef(Date.now());
  const attemptsByItem = useRef<Record<string, number>>({});
  const servedRef = useRef<Set<number>>(new Set());
  // The misses that stand in this run, and whether the run has already been handed back.
  const missesRef = useRef(0);
  const finishedRef = useRef(false);
  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onDone(missesRef.current);
  }, [onDone]);

  const item = queue[pos];

  const equationRef = useRegisterTarget<HTMLDivElement>('course-practice-equation', {
    kind: 'equation',
    label: item ? `the practice equation ${item.equation}` : 'the practice equation',
  });
  const padRef = useRegisterTarget<HTMLDivElement>('course-practice-pad', {
    kind: 'input',
    label: 'the number pad where the learner types x',
  });

  // The tutor keeps no durable table of its own: mastery already persists this node's answers, so
  // a session that ended on two misses resumes with the ladder already knowing to teach it another
  // way. Ignored when this session is already counting (wobo/reteach.ts).
  useEffect(() => {
    seedFromEvidence(nodeId, sdk.mastery.loadCache().nodes[nodeId]?.evidence ?? []);
  }, [sdk, nodeId]);

  // every item arrival: serve event + fresh clock
  useEffect(() => {
    if (!item || servedRef.current.has(pos)) return;
    servedRef.current.add(pos);
    startRef.current = Date.now();
    sdk.events.record(
      'practice.item.served.v1',
      {
        node_id: nodeId,
        item_id: item.id,
        difficulty: item.difficulty,
        scheduled_by: 'orchestrator',
        aided: false,
      },
      { ontologyNodeId: nodeId },
    );
  }, [item, pos, sdk, nodeId]);

  // Wobo reads each question aloud as the learner arrives at it — never gates the check button
  useEffect(() => {
    if (!item || phase !== 'answer') return;
    const spoken = item.equation
      .replace(/=/g, ' equals ')
      .replace(/\+/g, ' plus ')
      .replace(/[-−]/g, ' minus ')
      .replace(/\s+/g, ' ')
      .trim();
    announceCard(`q-${nodeId}-${item.id}-${pos}`, `solve for x. ${spoken}.`, false);
  }, [item, pos, phase, nodeId]);

  // done when the queue (including re-queued misses) is exhausted
  useEffect(() => {
    if (pos >= queue.length && queue.length > 0) finish();
  }, [pos, queue.length, finish]);

  useEffect(() => {
    setSub(queue.length === 0 ? 0 : Math.min(1, pos / queue.length));
  }, [setSub, pos, queue.length]);

  // Wobo reads the pad at code level — including how much support Wobo is currently giving
  useEffect(() => {
    if (!item) return;
    bus.publishCanvas({
      nodeId,
      equation: item.equation,
      steps: [
        `item ${Math.min(pos + 1, queue.length)} of ${queue.length}`,
        `learner's entry so far: ${entry === '' ? '(nothing yet)' : entry.replace('-', '−')}`,
        `assistance: ${mode}${hintLevel > 0 ? ` · hint depth ${hintLevel}` : ''}`,
        phase === 'correct'
          ? 'answered correctly'
          : phase === 'detonate'
            ? `answered x = ${fmt(wrongValue)}, which breaks the equality — misconception shown`
            : 'still working',
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, nodeId, item, pos, queue.length, entry, phase, wrongValue, mode, hintLevel]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  const advance = useCallback(() => {
    // The course may have seen enough: this run beat them twice, or the topic is held. Either way
    // the next thing is the course's to choose, never the next item of this run.
    if (until?.()) {
      finish();
      return;
    }
    setPhase('answer');
    setEntry('');
    setWhyOpen(false);
    setDetReady(false);
    setHintLevel(0);
    lastHintRef.current = '';
    setContest('idle');
    setContestNote('');
    setPos((p) => p + 1);
  }, [until, finish]);

  // one clue at a time — depth escalates on request, capped by the ladder, delivered in Wobo's ink
  const giveHint = useCallback(() => {
    if (!item) return;
    const cap = maxHintDepth(mode);
    // Escalate — and never repeat the last clue: if a depth lands on the same words, step further.
    let next = hintLevel;
    let text = '';
    do {
      next = Math.min(next + 1, cap);
      text = hintFor(item, next, mode);
    } while (text === lastHintRef.current && next < cap);
    if (next === hintLevel && text === lastHintRef.current) return;
    lastHintRef.current = text;
    setHintLevel(next);
    sdk.events.record(
      'wobo.hint.escalated.v1',
      { node_id: nodeId, from_level: hintLevel, to_level: next, reason: 'explicit_request' },
      { ontologyNodeId: nodeId },
    );
    bus.dispatch([{ type: 'setMood', mood: 'hint' }]);
    // One pen (docs/INK-FREEZE-PLAN-TRACE.md §4): the clue is a note beside the equation, traced
    // from the equation's real box by the same hand that draws every other mark.
    screenStore.applyEvent(hintNote('course-practice-equation', text, next));
  }, [item, hintLevel, mode, sdk, nodeId, bus]);

  /**
   * Wobo changes approach without being asked. Two wrong on this concept is a pattern rather than a
   * slip (wobo/reteach.ts owns the threshold and the ladder), and the answer is never the same
   * explanation said again: a different axis, asked for through the routing every mode already
   * uses. Nothing announces the switch (DESIGN.md §0.x): the next explanation arrives and its
   * words are about the idea. Offline the ask waits, because a queued bubble the learner never
   * typed is noise, not teaching.
   */
  const reteach = useCallback(() => {
    const turn = reteachOnMiss(sdk, {
      nodeId,
      // One practice node teaches one concept, so the node is the concept the tally is kept against.
      conceptId: nodeId,
      from: 'worksheet',
      context: { topic: topicName, world: preferredAnalogy() },
    });
    if (!turn) return;
    bus.dispatch([{ type: 'setMood', mood: 'hint' }]);
    if (offline) return;
    // The new explanation arrives in Wobo's drawer, so the drawer opens: a second way of teaching
    // it that the learner never sees is not a second way of teaching it (wobo/drawer.ts). Silent,
    // because Wobo asked this, not the learner, and the archive is the learner's own words.
    openCompanion({ reason: 'reteach', ask: turn.ask });
    void ask(turn.ask, { silent: true }).catch(() => undefined);
  }, [sdk, nodeId, topicName, bus, ask, offline]);

  // the learner contests an evaluated answer — the verifier looks again, gracefully either way
  const doContest = useCallback(async () => {
    if (!item) return;
    setContest('checking');
    const r = await regrade(sdk, item, wrongValue);
    setContestNote(r.note);
    if (r.upheld) {
      // the grade bends to the proof: corrected evidence, the earned moment, no re-queue
      sdk.events.record(
        'practice.item.answered.v1',
        {
          node_id: nodeId,
          item_id: item.id,
          response: { kind: 'numeric', value: wrongValue },
          correct: true,
          latency_ms: 0,
          independence_signal: 0.95,
        },
        { ontologyNodeId: nodeId },
      );
      setQueue((q) => {
        const i = q.lastIndexOf(item);
        return i > pos ? q.filter((_, j) => j !== i) : q;
      });
      noteCorrect();
      noteConceptCorrect(nodeId); // the grade bent to the proof: this concept was never missed
      missesRef.current = Math.max(0, missesRef.current - 1);
      onUnmiss?.();
      award('item');
      comboHit();
      setContest('upheld');
      setPhase('correct');
      setMood('correct');
      window.setTimeout(() => setMood('idle'), 1400);
    } else {
      setContest('stood');
    }
  }, [item, wrongValue, sdk, nodeId, pos, award, setMood, onUnmiss]);

  const check = useCallback(() => {
    if (!item) return;
    const value = Number(entry.replace('−', '-'));
    if (!Number.isFinite(value)) return;
    const correct = Math.abs(value - Number(item.answer)) < 1e-9;
    const latency = Date.now() - startRef.current;
    const attemptIndex = attemptsByItem.current[item.id] ?? 0;
    attemptsByItem.current[item.id] = attemptIndex + 1;
    onAttempt();

    // honesty about independence: a hinted answer is aided evidence, not unaided
    const aided = hintLevel > 0;
    const independence = aided ? 0.6 : 0.95;
    sdk.events.record(
      'learn.attempt.submitted.v1',
      {
        node_id: nodeId,
        item_id: item.id,
        response: { kind: 'numeric', value },
        correct,
        aided,
        independence_signal: independence,
        latency_ms: latency,
        attempt_index: attemptIndex,
      },
      { ontologyNodeId: nodeId },
    );
    sdk.events.record(
      'practice.item.answered.v1',
      {
        node_id: nodeId,
        item_id: item.id,
        response: { kind: 'numeric', value },
        correct,
        latency_ms: latency,
        independence_signal: independence,
      },
      { ontologyNodeId: nodeId },
    );

    if (correct) {
      noteCorrect();
      noteConceptCorrect(nodeId); // a clean answer is the evidence this way of teaching landed
      setPhase('correct');
      award('item');
      comboHit();
      setMood('correct');
      window.setTimeout(() => setMood('idle'), 1400);
    } else {
      noteMiss();
      if (ladder) reteach();
      // THE MISS, RECORDED WHERE IT HAPPENED: against the module on stage, not only the topic.
      missesRef.current += 1;
      onMiss?.(item);
      const ends = until?.();
      setAfterMiss(ends === 'beaten' ? 'another_way' : ends === 'held' ? 'nothing' : 'returns');
      comboBreak();
      sfx.wrong(); // a gentle low blip — kind, never punishing (correct blooms via award)
      // FSRS framing: a lapse, due again soon — and it literally returns later in this run
      const card = reviewCard(null, false, Date.now());
      sdk.events.record(
        'practice.retrieval.scheduled.v1',
        {
          node_id: nodeId,
          item_id: item.id,
          due_at: card.dueAt,
          stability: card.stabilityDays,
          difficulty: card.difficulty,
          scheduler: 'fsrs',
        },
        { ontologyNodeId: nodeId },
      );
      setWrongValue(value);
      setQueue((q) => [...q, item]);
      setPhase('detonate');
      setMood('hint');
      window.setTimeout(() => setMood('idle'), 2000);
      window.setTimeout(() => setDetReady(true), 2600);
    }
  }, [
    item,
    entry,
    sdk,
    nodeId,
    award,
    setMood,
    onAttempt,
    hintLevel,
    reteach,
    onMiss,
    until,
    ladder,
  ]);

  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  }, [check]);

  const onKey = useCallback((key: string) => {
    if (key === '⌫') setEntry((e) => e.slice(0, -1));
    else if (key === '−') setEntry((e) => (e.startsWith('-') ? e.slice(1) : `-${e}`));
    else setEntry((e) => (e.length < 7 ? e + key : e));
  }, []);

  // hardware keyboard is a first-class citizen
  useEffect(() => {
    if (phase !== 'answer') return;
    const handler = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) onKey(e.key);
      else if (e.key === '-') onKey('−');
      else if (e.key === 'Backspace') onKey('⌫');
      else if (e.key === 'Enter') checkRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, onKey]);

  // the action bar follows the phase — and carries the ladder's quiet affordances
  useEffect(() => {
    if (!item) {
      setBar(null);
      return;
    }
    if (phase === 'answer') {
      const invalid = entry === '' || entry === '-' || !Number.isFinite(Number(entry));
      setBar({
        primary: { label: 'Check', onClick: () => checkRef.current(), disabled: invalid },
        secondary:
          hintLevel < maxHintDepth(mode)
            ? { label: hintLevel === 0 ? 'Hint' : 'Another hint', onClick: giveHint }
            : undefined,
      });
    } else if (phase === 'correct') {
      setBar({
        primary: { label: 'Continue', onClick: advance },
        secondary: { label: 'Why?', onClick: () => setWhyOpen((o) => !o) },
      });
    } else {
      setBar({
        primary: { label: 'Continue', onClick: advance, disabled: !detReady },
        secondary:
          contest === 'idle' && detReady
            ? { label: 'I think I’m right', onClick: () => void doContest() }
            : undefined,
      });
    }
  }, [
    setBar,
    item,
    phase,
    entry,
    detReady,
    advance,
    hintLevel,
    mode,
    giveHint,
    contest,
    doContest,
  ]);

  if (!item) return null;

  const lin = linearize(item.equation);
  const correctValue = Number(item.answer);
  const tint =
    phase === 'correct'
      ? {
          border: '1px solid var(--wobo-feedback-correct)',
          background: 'var(--wobo-feedback-correctSoft)',
        }
      : phase === 'detonate'
        ? {
            border: '1px solid var(--wobo-feedback-retry)',
            background: 'var(--wobo-feedback-retrySoft)',
          }
        : {
            border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
            background: 'var(--wobo-paper)',
          };

  return (
    <CardBody maxWidth={520} center={false}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div style={whisper}>
          practice · {Math.min(pos + 1, queue.length)} of {queue.length}
        </div>
        <ComboMeter hue={HUE} />
      </div>
      <div style={cardTitle}>Solve for x</div>

      <div
        ref={equationRef}
        style={{
          textAlign: 'center',
          fontSize: 'clamp(1.7rem, 6vw, 2.2rem)',
          fontWeight: 550,
          letterSpacing: '-0.01em',
          color: 'var(--wobo-ink-900)',
          fontVariantNumeric: 'tabular-nums',
          padding: '18px 0 6px',
        }}
      >
        {item.equation}
      </div>

      {/* one hint, one surface: Wobo's note beside the equation, from the one pen (board-turn hintNote). */}

      <AnimatePresence mode="wait" initial={false}>
        {phase === 'detonate' ? (
          <motion.div
            key={`det-${pos}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Stage hue={RETRY} tint={0.06} minHeight={320} style={{ padding: '28px 18px' }}>
              <Detonation item={item} theirs={wrongValue} then={afterMiss} />
            </Stage>
            {/* the re-grade path: contesting is welcome, and the outcome is graceful either way */}
            <AnimatePresence initial={false}>
              {contest !== 'idle' && (
                <motion.div
                  key={contest}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
                  style={{
                    marginTop: 12,
                    textAlign: 'center',
                    fontSize: '0.92rem',
                    lineHeight: 1.55,
                    color: 'var(--wobo-ink-700)',
                  }}
                >
                  {contest === 'checking' ? 'Asking the verifier to look again…' : contestNote}
                </motion.div>
              )}
            </AnimatePresence>
            {/* The way back, once the detonation has had its moment, and only while the run ends here. */}
            {offer && detReady && contest !== 'checking' && until?.() === 'beaten'
              ? offer({ misses: missesRef.current, ending: 'beaten', take: advance })
              : null}
          </motion.div>
        ) : (
          <motion.div
            key={`pad-${pos}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <Stage
              hue={phase === 'correct' ? 'var(--mint)' : HUE}
              tint={0.05}
              minHeight={phase === 'correct' ? 300 : 0}
              style={{
                padding: '18px 16px',
                gap: 16,
                justifyContent: phase === 'correct' ? 'center' : 'flex-start',
              }}
            >
              {/* the entry */}
              <motion.div
                animate={phase === 'correct' ? { scale: [1, 1.03, 1] } : {}}
                transition={{ duration: 0.45, ease: [0.2, 0, 0, 1] }}
                style={{
                  ...tint,
                  position: 'relative',
                  width: '100%',
                  borderRadius: 'var(--wobo-radius-sm)',
                  minHeight: 64,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.7rem',
                  fontWeight: 550,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--wobo-ink-900)',
                  gap: 10,
                }}
              >
                <span style={{ color: 'var(--wobo-ink-500)', fontWeight: 500 }}>x =</span>
                <span>{entry === '' ? ' ' : entry.replace('-', '−')}</span>
                {/* the earned burst — small, hue-true, once — with the real +xp riding up beside it.
                    the +xp chip is suppressed on a replay: the combo still runs, but nothing is earned. */}
                {phase === 'correct' && <ParticlePop hue={HUE} />}
                {phase === 'correct' && !replay && <XpTick amount={XP_AWARDS.item} hue={HUE} />}
              </motion.div>

              {phase === 'correct' && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'var(--wobo-feedback-correct)', fontWeight: 550 }}>
                    that holds.
                  </div>
                  {contest === 'upheld' && (
                    <div style={{ marginTop: 6, fontSize: '0.9rem', color: 'var(--wobo-ink-700)' }}>
                      you contested — and the proof took your side.
                    </div>
                  )}
                  <AnimatePresence>
                    {whyOpen && lin && (
                      // Law v5 §8 names `height` outright, so this opens on a grid row track
                      // (0fr → 1fr) rather than on `height: auto` — same reveal, no per-frame
                      // reflow of the page below it.
                      <motion.div
                        initial={{ opacity: 0, gridTemplateRows: '0fr' }}
                        animate={{ opacity: 1, gridTemplateRows: '1fr' }}
                        exit={{ opacity: 0, gridTemplateRows: '0fr' }}
                        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
                        style={{ display: 'grid', overflow: 'hidden' }}
                      >
                        <div style={{ ...lead, marginTop: 8, minHeight: 0, overflow: 'hidden' }}>
                          put x = {fmt(correctValue)} back in: both sides make{' '}
                          {fmt(lin.lhs(correctValue))}. the scale stays level — that is what being a
                          solution means.
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* the pad — tactile keys with real faces */}
              {phase === 'answer' && (
                <div
                  ref={padRef}
                  style={{ display: 'flex', flexDirection: 'column', gap: 9, width: '100%' }}
                >
                  {PAD_KEYS.map((row) => (
                    <div key={row.join('')} style={{ display: 'flex', gap: 9 }}>
                      {row.map((key) => (
                        <motion.button
                          key={key}
                          type="button"
                          onClick={() => onKey(key)}
                          whileTap={{ scale: 0.94, y: 2 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                          aria-label={key === '⌫' ? 'delete' : key === '−' ? 'minus' : key}
                          style={{
                            flex: 1,
                            height: 58,
                            fontSize: '1.2rem',
                            fontFamily: 'inherit',
                            fontWeight: 550,
                            color: 'var(--wobo-ink-900)',
                            // LAW v5 / DESIGN.md §2: a key is a tonal surface with a soft
                            // shadow under it, never a bevel drawn out of three hairlines in
                            // colours that only exist by day.
                            background: 'var(--paper-2)',
                            border: 0,
                            boxShadow: 'var(--lift)',
                            borderRadius: 12,
                            cursor: 'pointer',
                          }}
                        >
                          {key}
                        </motion.button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </Stage>
            {/* The next thing, on the last answer of the run, and never over the pad. */}
            {offer && phase === 'correct' && pos === queue.length - 1 && !until?.()
              ? offer({ misses: missesRef.current, ending: 'done', take: advance })
              : null}
          </motion.div>
        )}
      </AnimatePresence>
    </CardBody>
  );
}
