'use client';

/**
 * Flashcards — recall wired into spaced repetition (DESIGN.md §9). A card flips with real spring
 * 3D physics (front → back), and the learner grades their own recall on a swipe: left = "again",
 * right = "got it". Each grade runs the FSRS-lite scheduler (@wobo/sdk reviewCard) and records
 * the retrieval events — practice.item.answered.v1 + practice.retrieval.scheduled.v1 — so the due
 * queue and mastery actually move. Per-card schedule persists locally, so a card the learner keeps
 * getting right grows its interval across sessions, exactly as spaced retrieval should.
 *
 * Registers as a Wobo scene target (Wobo can flip and grade to demonstrate). Reduced-motion aware
 * (the flip becomes a crossfade); mute-aware via sfx; both themes; no new deps.
 */

import { type RetrievalCard, reviewCard } from '@wobo/sdk';
import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { BarState } from '../screens/course/shared';
import { CardBody, rgba, whisper } from '../screens/course/shared';
import { scoped } from '../store/scope';
import { useSdk } from '../store/sdk';
import { hueForTopic } from '../ui/hues';
import { sfx } from '../ui/sound';

// --- The spec ------------------------------------------------------------------------------------

export interface Flashcard {
  id: string;
  front: string;
  back: string;
}

export interface FlashcardsSpec {
  id: string;
  title: string;
  cards: Flashcard[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

export function parseFlashcards(raw: unknown): FlashcardsSpec | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (raw.verified === false || src.verified === false) return null;
  const cards = (Array.isArray(src.cards) ? src.cards : [])
    .filter((c): c is Record<string, unknown> => isRecord(c) && str(c.front) && str(c.back))
    .map((c, i) => ({
      id: str(c.id) ? (c.id as string) : `fc${i + 1}`,
      front: c.front as string,
      back: c.back as string,
    }));
  if (cards.length === 0 || cards.length > 20) return null;
  return {
    id: str(src.id) ? src.id : 'flashcards',
    title: str(src.title) ? src.title : 'flashcards',
    cards,
  };
}

// --- Per-card FSRS state (per-learner storage; the interval must survive across sessions) ---------
//
// Scoped (store/scope.ts): this is a model of ONE learner's memory. On a family tablet an unscoped
// copy would schedule a sibling's revision from the first learner's recall.

const FSRS_KEY = 'wobo-fsrs-v1';
function loadSchedule(cardKey: string): RetrievalCard | null {
  try {
    return (
      (JSON.parse(scoped.getItem(FSRS_KEY) ?? '{}') as Record<string, RetrievalCard>)[cardKey] ??
      null
    );
  } catch {
    return null;
  }
}
function saveSchedule(cardKey: string, card: RetrievalCard): void {
  try {
    const all = JSON.parse(scoped.getItem(FSRS_KEY) ?? '{}') as Record<string, RetrievalCard>;
    all[cardKey] = card;
    scoped.setItem(FSRS_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable — session-only scheduling
  }
}

/** "in 3 days", "in ~5 hours" — the human-facing due promise after a grade. */
function dueLabel(card: RetrievalCard): string {
  const ms = new Date(card.dueAt).getTime() - Date.now();
  const hours = ms / 3_600_000;
  if (hours < 1) return 'again in a few minutes';
  if (hours < 24) return `again in ~${Math.round(hours)} hours`;
  const days = Math.round(hours / 24);
  return `again in ${days} day${days === 1 ? '' : 's'}`;
}

// --- The deck ------------------------------------------------------------------------------------

export function Flashcards({
  spec,
  hue = hueForTopic(''),
  nodeId,
  setBar,
  onDone,
}: {
  spec: FlashcardsSpec;
  hue?: string;
  nodeId: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const sdk = useSdk();
  const bus = useWoboBus();
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [swipe, setSwipe] = useState<'again' | 'got' | null>(null);
  const [know, setKnow] = useState({ got: 0, again: 0 });
  const [lastDue, setLastDue] = useState<string | null>(null);
  const cardUuids = useRef(spec.cards.map(() => crypto.randomUUID()));

  const card = spec.cards[idx];
  const last = idx >= spec.cards.length - 1;

  const grade = (got: boolean) => {
    if (!card || swipe) return;
    const cardKey = `${nodeId}:${card.id}`;
    const prev = loadSchedule(cardKey);
    const next = reviewCard(prev, got, Date.now());
    saveSchedule(cardKey, next);
    const itemId = cardUuids.current[idx] ?? crypto.randomUUID();
    // the retrieval is real evidence + a real FSRS schedule
    sdk.events.record(
      'practice.item.answered.v1',
      {
        node_id: nodeId,
        item_id: itemId,
        response: { kind: 'choice', selected: [got ? 'known' : 'again'] },
        correct: got,
        latency_ms: 0,
        independence_signal: 1,
      },
      { ontologyNodeId: nodeId },
    );
    sdk.events.record(
      'practice.retrieval.scheduled.v1',
      {
        node_id: nodeId,
        item_id: itemId,
        due_at: next.dueAt,
        stability: next.stabilityDays,
        difficulty: next.difficulty,
        scheduler: 'fsrs',
      },
      { ontologyNodeId: nodeId },
    );
    if (got) sfx.bloom();
    else sfx.wrong();
    setKnow((k) => ({ got: k.got + (got ? 1 : 0), again: k.again + (got ? 0 : 1) }));
    setLastDue(dueLabel(next));
    setSwipe(got ? 'got' : 'again');
    window.setTimeout(
      () => {
        if (last) {
          onDone();
          return;
        }
        setIdx((i) => i + 1);
        setFlipped(false);
        setSwipe(null);
      },
      reduced ? 120 : 420,
    );
  };

  // the bar mirrors the on-card controls (and keeps a keyboard/again path always reachable)
  // biome-ignore lint/correctness/useExhaustiveDependencies: grade closes over the live card; flipped is the trigger
  useEffect(() => {
    setBar({
      primary: {
        label: flipped ? 'got it' : 'flip to check',
        onClick: () => (flipped ? grade(true) : setFlipped(true)),
      },
      secondary: flipped ? { label: 'again', onClick: () => grade(false) } : undefined,
    });
  }, [flipped, idx, swipe, setBar]);

  const stageRef = useRegisterTarget<HTMLDivElement>(`flashcards-${spec.id}`, {
    kind: 'flashcards',
    label: `flashcard deck: ${spec.title}`,
    getSceneState: () => ({
      title: spec.title,
      card: `${idx + 1} of ${spec.cards.length}`,
      front: card?.front,
      flipped,
      known: know.got,
      again: know.again,
    }),
    getValidActions: () => (flipped ? ['grade got it', 'grade again'] : ['flip the card']),
    applyTutorAction: (patch) => {
      if (patch.flip === true) return setFlipped(true);
      if (patch.grade === 'got') return grade(true);
      if (patch.grade === 'again') return grade(false);
    },
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId,
      steps: [
        `flashcards: ${spec.title}`,
        `card ${idx + 1}/${spec.cards.length}${flipped ? ' (answer shown)' : ''}`,
        `${know.got} known · ${know.again} to review`,
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, nodeId, spec, idx, flipped, know]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  if (!card) return null;

  const flipDur = reduced ? 0.001 : 0.5;

  return (
    <CardBody maxWidth={560}>
      <div
        ref={stageRef}
        style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center' }}
      >
        <div style={{ ...whisper, alignSelf: 'flex-start' }}>
          recall · {idx + 1} / {spec.cards.length}
        </div>

        {/* the card — real 3D flip on a spring, swipe-out on grade. It is a button: the flip is
            reachable from a keyboard (Enter or Space) outside a course, where no action bar offers
            "flip to check", and the face turned away is out of the accessibility tree, so a
            screen reader is read the question OR the answer, never both in one breath. The
            retrieval this engine exists for depends on the answer staying hidden until asked. */}
        <div style={{ perspective: 1200, width: '100%', maxWidth: 440, height: 260 }}>
          <motion.div
            key={card.id}
            role="button"
            tabIndex={0}
            onClick={() => !swipe && setFlipped((f) => !f)}
            onKeyDown={(e) => {
              if (swipe || (e.key !== 'Enter' && e.key !== ' ')) return;
              e.preventDefault();
              setFlipped((f) => !f);
            }}
            initial={{ x: 0, opacity: 1 }}
            animate={{
              rotateY: flipped ? 180 : 0,
              x: swipe ? (swipe === 'got' ? 260 : -260) : 0,
              opacity: swipe ? 0 : 1,
              rotateZ: swipe ? (swipe === 'got' ? 8 : -8) : 0,
            }}
            transition={{
              rotateY: { type: 'spring', stiffness: 260, damping: 24, duration: flipDur },
              default: { type: 'spring', stiffness: 200, damping: 26 },
            }}
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              transformStyle: 'preserve-3d',
              cursor: 'pointer',
            }}
          >
            {/* front */}
            <div
              aria-hidden={flipped}
              style={{
                position: 'absolute',
                inset: 0,
                backfaceVisibility: 'hidden',
                borderRadius: 12,
                border: `0.5px solid var(--wobo-hairline-on-paper-strong)`,
                background: `linear-gradient(160deg, ${rgba(hue, 0.08)}, var(--wobo-paper))`,
                display: 'grid',
                placeItems: 'center',
                padding: '28px 30px',
                textAlign: 'center',
              }}
            >
              <div>
                <div style={{ ...whisper, marginBottom: 12 }}>prompt</div>
                <div
                  style={{
                    fontSize: '1.3rem',
                    fontWeight: 540,
                    color: 'var(--wobo-ink-900)',
                    lineHeight: 1.4,
                  }}
                >
                  {card.front}
                </div>
                <div style={{ ...whisper, marginTop: 18, opacity: 0.7 }}>tap to flip</div>
              </div>
            </div>
            {/* back */}
            <div
              aria-hidden={!flipped}
              style={{
                position: 'absolute',
                inset: 0,
                backfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
                borderRadius: 12,
                border: `1px solid ${hue}`,
                background: rgba(hue, 0.06),
                display: 'grid',
                placeItems: 'center',
                padding: '28px 30px',
                textAlign: 'center',
              }}
            >
              <div>
                <div style={{ ...whisper, marginBottom: 12, color: hue }}>answer</div>
                <div
                  style={{
                    fontSize: '1.2rem',
                    fontWeight: 520,
                    color: 'var(--wobo-ink-900)',
                    lineHeight: 1.5,
                  }}
                >
                  {card.back}
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* the grade controls appear once flipped — swipe with a tap */}
        <AnimatePresence>
          {flipped && !swipe && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{ display: 'flex', gap: 12 }}
            >
              <button
                type="button"
                onClick={() => grade(false)}
                style={{
                  padding: '10px 20px',
                  borderRadius: 999,
                  border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
                  background: 'var(--wobo-paper)',
                  color: 'var(--wobo-ink-700)',
                  fontFamily: 'inherit',
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                }}
              >
                ← again
              </button>
              <button
                type="button"
                onClick={() => grade(true)}
                style={{
                  padding: '10px 20px',
                  borderRadius: 999,
                  border: `1px solid ${hue}`,
                  background: rgba(hue, 0.12),
                  color: 'var(--wobo-ink-900)',
                  fontFamily: 'inherit',
                  fontSize: '0.95rem',
                  fontWeight: 520,
                  cursor: 'pointer',
                }}
              >
                got it →
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {lastDue && (
            <motion.div
              key={lastDue + idx}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ ...whisper, color: hue }}
            >
              {lastDue}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </CardBody>
  );
}

// --- A hand-authored demo -------------------------------------------------------------------------

export const FLASHCARDS_DEMO: FlashcardsSpec = {
  id: 'demo-flashcards',
  title: 'the atom, from memory',
  cards: [
    {
      id: 'c1',
      front: 'what decides which element an atom is?',
      back: 'the number of protons in its nucleus.',
    },
    {
      id: 'c2',
      front: 'where is nearly all of an atom’s mass?',
      back: 'in the nucleus — over 99.9% of it.',
    },
    {
      id: 'c3',
      front: 'what lives in the shells around the nucleus?',
      back: 'electrons, held at a distance.',
    },
  ],
};
