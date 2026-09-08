'use client';

/**
 * Path results rendered inside the conversation thread (home front door and the docked drawer):
 * a sim or quiz Wobo summoned, a drawing Wobo made, or an action Wobo offers through the capability
 * registry. Every action card is explainable — one why line, its evidence, and the confidence
 * band — and its outcome (taken / ignored) is recorded on the event backbone.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { type CSSProperties, useEffect, useState } from 'react';
import { DiagramView } from '../../engines/DiagramView';
import { parseSimSpec, SimRunner, simSpecFromGateway } from '../../engines/SimRunner';
import { useRouter } from '../../shell/router';
import { useSdk } from '../../store/sdk';
import { MagneticButton } from '../../ui/kit';
import { capabilityById } from '../capabilities';
import { type ChatTurn, useWoboChat } from '../chat';
import {
  buildDoodle,
  type DoodleSpec,
  type Formula,
  type FormulaCardSpec,
  type MakerPlanSpec,
} from '../create';
import { refusalLine } from '../refusals';
import { answersMatch } from './answer';
import { freshOffers } from './classify';
import type { ActionAttachment, Flashcard, QuizItem, TurnExtras } from './types';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const whisper: CSSProperties = { fontSize: '0.78rem', color: 'var(--wobo-ink-500)' };

const rise = {
  initial: { opacity: 0, y: 10, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { type: 'spring', stiffness: 300, damping: 28 },
} as const;

function Shell({ eyebrow, children }: { eyebrow?: string; children: React.ReactNode }) {
  return (
    <motion.div
      {...rise}
      style={{
        width: '100%',
        background: 'var(--wobo-card)',
        border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
        borderRadius: 'var(--wobo-radius-sm)',
        padding: '14px 16px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {eyebrow && (
        <span
          style={{
            ...whisper,
            textTransform: 'lowercase',
            letterSpacing: '0.04em',
          }}
        >
          {eyebrow}
        </span>
      )}
      {children}
    </motion.div>
  );
}

// --- quiz -----------------------------------------------------------------------------------------

function parseQuizItems(spec: unknown): QuizItem[] {
  if (!isRecord(spec) || !Array.isArray(spec.items)) return [];
  return spec.items.flatMap((raw): QuizItem[] => {
    if (!isRecord(raw)) return [];
    const { id, type, prompt, options, answer } = raw;
    if (typeof prompt !== 'string' || typeof answer !== 'string' || !prompt || !answer) return [];
    if (type === 'mcq') {
      if (!Array.isArray(options)) return [];
      const opts = options.filter((o): o is string => typeof o === 'string' && o.length > 0);
      if (opts.length < 2 || !opts.includes(answer)) return [];
      return [{ id: String(id ?? prompt), type: 'mcq', prompt, options: opts, answer }];
    }
    if (type === 'fill') return [{ id: String(id ?? prompt), type: 'fill', prompt, answer }];
    return [];
  });
}

function QuizCard({ items }: { items: QuizItem[] }) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [right, setRight] = useState(0);
  const item = items[idx];
  const answered = picked !== null;
  // One comparison point for both the tally and the verdict — normalised, so "Photosynthesis. "
  // and "photosynthesis" are the same right answer (mcq options are exact strings either way).
  const correct = answered && item !== undefined && answersMatch(picked, item.answer);

  if (!item) {
    return (
      <div style={{ fontSize: '0.95rem', lineHeight: 1.6 }}>
        {right} of {items.length} on the first try.{' '}
        <span style={whisper}>
          {right === items.length ? 'clean sweep — that holds.' : 'the misses are the map.'}
        </span>
      </div>
    );
  }

  const settle = (value: string) => {
    if (answered) return;
    setPicked(value);
    if (answersMatch(value, item.answer)) setRight((n) => n + 1);
  };
  const next = () => {
    setIdx((i) => i + 1);
    setPicked(null);
    setTyped('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={whisper}>
        {idx + 1} of {items.length}
      </span>
      <div style={{ fontSize: '0.98rem', lineHeight: 1.55, fontWeight: 550 }}>{item.prompt}</div>

      {item.type === 'mcq' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(item.options ?? []).map((option) => {
            const chosen = picked === option;
            const isAnswer = option === item.answer;
            const border = !answered
              ? 'var(--wobo-hairline-on-paper-strong)'
              : isAnswer
                ? 'var(--wobo-feedback-correct)'
                : chosen
                  ? 'var(--wobo-feedback-retry)'
                  : 'var(--wobo-hairline-on-paper)';
            const background = !answered
              ? 'var(--wobo-card)'
              : isAnswer
                ? 'var(--wobo-feedback-correctSoft)'
                : chosen
                  ? 'var(--wobo-feedback-retrySoft)'
                  : 'var(--wobo-card)';
            return (
              <button
                key={option}
                type="button"
                onClick={() => settle(option)}
                style={{
                  textAlign: 'left',
                  padding: '11px 13px',
                  fontSize: '0.92rem',
                  lineHeight: 1.45,
                  fontFamily: 'inherit',
                  color: 'var(--wobo-ink-900)',
                  border: `1px solid ${border}`,
                  borderRadius: 'var(--wobo-radius-sm)',
                  background,
                  cursor: answered ? 'default' : 'pointer',
                  transition: 'border-color 0.2s ease, background 0.2s ease',
                }}
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) settle(typed.trim());
          }}
          style={{ display: 'flex', gap: 8 }}
        >
          <input
            value={answered ? (picked ?? '') : typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={answered}
            placeholder="Type your answer"
            style={{
              flex: 1,
              padding: '10px 12px',
              fontSize: '0.92rem',
              fontFamily: 'inherit',
              color: 'var(--wobo-ink-900)',
              background: 'var(--wobo-card)',
              borderRadius: 'var(--wobo-radius-sm)',
              border: `1px solid ${
                !answered
                  ? 'var(--wobo-hairline-on-paper-strong)'
                  : correct
                    ? 'var(--wobo-feedback-correct)'
                    : 'var(--wobo-feedback-retry)'
              }`,
            }}
          />
          {!answered && (
            <MagneticButton
              variant="quiet"
              size="sm"
              onClick={() => typed.trim() && settle(typed.trim())}
            >
              check
            </MagneticButton>
          )}
        </form>
      )}

      <AnimatePresence initial={false}>
        {answered && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <span
              style={{
                fontSize: '0.85rem',
                color: correct ? 'var(--wobo-feedback-correct)' : 'var(--wobo-ink-700)',
              }}
            >
              {correct
                ? 'that holds.'
                : item.type === 'fill'
                  ? `close — it was "${item.answer}".`
                  : 'not this time — the marked one survives the test.'}
            </span>
            <MagneticButton variant="quiet" size="sm" onClick={next}>
              {idx + 1 < items.length ? 'next' : 'finish'}
            </MagneticButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- flashcards -------------------------------------------------------------------------------------

function parseFlashcards(spec: unknown): Flashcard[] {
  if (!isRecord(spec) || !Array.isArray(spec.cards)) return [];
  return spec.cards.flatMap((raw): Flashcard[] => {
    if (!isRecord(raw)) return [];
    const { front, hint, back } = raw;
    if (typeof front !== 'string' || typeof back !== 'string' || !front || !back) return [];
    return [{ front, back, hint: typeof hint === 'string' ? hint : undefined }];
  });
}

function FlashcardsCard({ cards }: { cards: Flashcard[] }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[idx];
  if (!card) return null;
  const go = (delta: number) => {
    setIdx((i) => Math.min(cards.length - 1, Math.max(0, i + delta)));
    setFlipped(false);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? 'Show the front' : 'Reveal the back'}
        style={{
          minHeight: 120,
          padding: '18px 16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          textAlign: 'center',
          fontFamily: 'inherit',
          background: flipped ? 'var(--wobo-canvas)' : 'var(--wobo-card)',
          border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
          borderRadius: 'var(--wobo-radius-sm)',
          cursor: 'pointer',
          transition: 'background 0.25s ease',
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={flipped ? 'back' : 'front'}
            initial={{ opacity: 0, rotateX: -28 }}
            animate={{ opacity: 1, rotateX: 0 }}
            exit={{ opacity: 0, rotateX: 28 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            style={{
              fontSize: flipped ? '0.95rem' : '1.05rem',
              fontWeight: flipped ? 450 : 600,
              lineHeight: 1.55,
              color: 'var(--wobo-ink-900)',
            }}
          >
            {flipped ? card.back : card.front}
          </motion.span>
        </AnimatePresence>
        {!flipped && card.hint && <span style={whisper}>{card.hint}</span>}
        <span style={{ ...whisper, fontSize: '0.7rem' }}>
          {flipped ? 'tap to turn back' : 'tap to reveal'}
        </span>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <MagneticButton variant="ghost" size="sm" onClick={() => go(-1)} disabled={idx === 0}>
          back
        </MagneticButton>
        <span style={whisper}>
          card {idx + 1} of {cards.length}
        </span>
        <MagneticButton
          variant="ghost"
          size="sm"
          onClick={() => go(1)}
          disabled={idx === cards.length - 1}
        >
          next
        </MagneticButton>
      </div>
    </div>
  );
}

// --- one-page formula card (a real cram artifact, printable) ----------------------------------------

function parseFormulaCard(spec: unknown): FormulaCardSpec | null {
  if (!isRecord(spec) || !Array.isArray(spec.formulas)) return null;
  const formulas = spec.formulas.flatMap((raw): Formula[] => {
    if (!isRecord(raw)) return [];
    const { name, expr, when } = raw;
    if (typeof name !== 'string' || typeof expr !== 'string' || !name || !expr) return [];
    return [{ name, expr, when: typeof when === 'string' ? when : undefined }];
  });
  if (formulas.length === 0) return null;
  return {
    title: typeof spec.title === 'string' && spec.title ? spec.title : 'your formula card',
    formulas,
    seeded: spec.seeded === true,
    note: typeof spec.note === 'string' ? spec.note : undefined,
  };
}

function FormulaCardView({ card }: { card: FormulaCardSpec }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: '1.02rem', fontWeight: 650, lineHeight: 1.3 }}>{card.title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {card.formulas.map((f) => (
          <div
            key={f.name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              paddingBottom: 8,
              borderBottom: '0.5px solid var(--wobo-hairline-on-paper)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--wobo-ink-500)' }}>{f.name}</span>
              {f.when && <span style={{ ...whisper, fontSize: '0.72rem' }}>{f.when}</span>}
            </div>
            <span
              style={{
                fontSize: '1rem',
                fontWeight: 550,
                color: 'var(--wobo-ink-900)',
                letterSpacing: '0.01em',
              }}
            >
              {f.expr}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
      >
        {card.note ? (
          <span style={whisper}>{card.note}</span>
        ) : (
          <span style={whisper}>One page — keep it for the morning.</span>
        )}
        <MagneticButton variant="quiet" size="sm" onClick={() => window.print()}>
          print
        </MagneticButton>
      </div>
    </div>
  );
}

// --- maker-project plan (materials · steps · safety · timeline) --------------------------------------

function parseMakerPlan(spec: unknown): MakerPlanSpec | null {
  if (!isRecord(spec)) return null;
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : [];
  const steps = strList(spec.steps);
  if (steps.length === 0) return null;
  return {
    title: typeof spec.title === 'string' && spec.title ? spec.title : 'your build',
    materials: strList(spec.materials),
    steps,
    safety: strList(spec.safety),
    timeline: strList(spec.timeline),
  };
}

function MakerSection({
  label,
  items,
  ordered,
}: {
  label: string;
  items: string[];
  ordered?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ ...whisper, textTransform: 'lowercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item, i) => (
          <div key={item} style={{ display: 'flex', gap: 8, fontSize: '0.9rem', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--wobo-ink-500)', minWidth: ordered ? 16 : 8 }}>
              {ordered ? `${i + 1}.` : '·'}
            </span>
            <span style={{ color: 'var(--wobo-ink-900)' }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MakerPlanView({ plan }: { plan: MakerPlanSpec }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: '1.02rem', fontWeight: 650, lineHeight: 1.3 }}>{plan.title}</div>
      <MakerSection label="You'll need" items={plan.materials} />
      <MakerSection label="Steps" items={plan.steps} ordered />
      <MakerSection label="Stay safe" items={plan.safety} />
      <MakerSection label="Timeline" items={plan.timeline} />
    </div>
  );
}

// --- a small drawn delight (a seeded critter in Wobo's hand, one true fact hooked on) -------------------

function parseDoodle(spec: unknown): DoodleSpec | null {
  if (!isRecord(spec) || typeof spec.concept !== 'string' || !spec.concept) return null;
  return {
    concept: spec.concept,
    fact: typeof spec.fact === 'string' ? spec.fact : undefined,
    seed: typeof spec.seed === 'number' ? spec.seed : undefined,
  };
}

function DoodleView({ doodle }: { doodle: DoodleSpec }) {
  const art = buildDoodle(doodle.seed ?? 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
      <svg
        viewBox={art.viewBox}
        width="72%"
        role="img"
        aria-label={`a drawing of ${doodle.concept}`}
        style={{ maxWidth: 220, display: 'block' }}
      >
        <path
          d={art.body}
          fill="var(--wobo-card)"
          stroke="var(--wobo-ink-900)"
          strokeWidth={2.2}
          strokeLinejoin="round"
        />
        <path d={art.belly} fill="none" stroke="var(--wobo-ink-300)" strokeWidth={1.4} />
        <path
          d={art.spikes}
          fill="none"
          stroke="var(--wobo-ink-900)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <path
          d={art.tail}
          fill="none"
          stroke="var(--wobo-ink-900)"
          strokeWidth={2.2}
          strokeLinecap="round"
        />
        {art.legs.map((d) => (
          <path
            key={d}
            d={d}
            fill="var(--wobo-card)"
            stroke="var(--wobo-ink-900)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        <circle cx={art.eye.cx} cy={art.eye.cy} r={3} fill="var(--wobo-ink-900)" />
      </svg>
      <span style={{ fontSize: '0.9rem', color: 'var(--wobo-ink-700)', textAlign: 'center' }}>
        a little {doodle.concept}, just for you.
      </span>
      {doodle.fact && (
        <span style={{ ...whisper, textAlign: 'center', lineHeight: 1.5 }}>
          and one true thing: {doodle.fact}
        </span>
      )}
    </div>
  );
}

// --- the action card (approval + explainability + outcome) ------------------------------------------

function ActionCard({ turnId, action }: { turnId: string; action: ActionAttachment }) {
  const router = useRouter();
  const sdk = useSdk();
  const { updateTurn } = useWoboChat();
  const [running, setRunning] = useState(false);
  const capability = capabilityById(action.capability);

  const patch = (p: Partial<ActionAttachment>) =>
    updateTurn(turnId, (extras: TurnExtras) =>
      extras.action ? { ...extras, action: { ...extras.action, ...p } } : extras,
    );

  const recordOutcome = (outcome: 'taken' | 'ignored') =>
    sdk.events.record('wobo.offer.outcome.v1', {
      offer_id: action.offerId,
      capability: action.capability,
      outcome,
      confidence: action.confidence,
    });

  const execute = async () => {
    if (!capability || running) return;
    setRunning(true);
    recordOutcome('taken');
    try {
      const result = await capability.run({ router, sdk }, action.params);
      patch({ status: 'taken', result });
    } catch (err) {
      // A refusal from the brain (not signed in, today spent) is said in Wobo's own words, so a
      // capability card never dead-ends on a generic apology that hides the real reason.
      patch({ status: 'taken', result: refusalLine(err).text });
    } finally {
      setRunning(false);
    }
  };

  const dismiss = () => {
    recordOutcome('ignored');
    patch({ status: 'ignored' });
  };

  // safe-automatic: Wobo just does it — once, and only for offers minted this session, so a card
  // replayed from the archive never re-executes on its own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount, by design
  useEffect(() => {
    if (capability?.rung === 'safe_automatic' && action.status === 'offered') {
      if (freshOffers.delete(action.offerId)) void execute();
    }
  }, []);

  if (!capability) return null;

  return (
    <Shell>
      <div style={{ fontSize: '0.98rem', fontWeight: 600, lineHeight: 1.4 }}>
        {capability.label(action.params)}
      </div>

      {/* the why, in one line. The evidence and the confidence band stay on the attachment for
          the record (wobo.offer.outcome.v1) and never on the card: a learner who typed "teach me
          fractions" does not need it read back with a confidence score (DESIGN.md §0.x) */}
      <div style={{ fontSize: '0.9rem', lineHeight: 1.55, color: 'var(--wobo-ink-700)' }}>
        {action.why}
      </div>

      {action.status === 'offered' && capability.rung !== 'safe_automatic' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <MagneticButton
            variant="primary"
            size="sm"
            onClick={() => void execute()}
            disabled={running}
          >
            {running ? 'doing it…' : 'approve'}
          </MagneticButton>
          <MagneticButton variant="ghost" size="sm" onClick={dismiss} disabled={running}>
            not now
          </MagneticButton>
        </div>
      )}
      {action.status === 'taken' && action.result && (
        <div style={{ fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--wobo-ink-700)' }}>
          {action.result}
        </div>
      )}
      {action.status === 'ignored' && <span style={whisper}>Left for later — just ask again.</span>}
    </Shell>
  );
}

// --- the dispatcher ----------------------------------------------------------------------------------

/** Renders whatever a turn carries beyond prose. Inline turns carry nothing and render nothing. */
export function TurnAttachments({ turn }: { turn: ChatTurn }) {
  const extras = turn.extras;
  if (!extras) return null;

  if (extras.path === 'component' && extras.component) {
    const { kind, spec, concept } = extras.component;
    if (kind === 'sim') {
      const parsed = simSpecFromGateway(spec, concept || 'simulation') ?? parseSimSpec(spec);
      return parsed ? (
        <Shell eyebrow={concept ? `a sim · ${concept}` : 'a sim'}>
          <SimRunner spec={parsed} />
        </Shell>
      ) : null;
    }
    if (kind === 'quiz') {
      const items = parseQuizItems(spec);
      return items.length > 0 ? (
        <Shell eyebrow={concept ? `a quick quiz · ${concept}` : 'a quick quiz'}>
          <QuizCard items={items} />
        </Shell>
      ) : null;
    }
    if (kind === 'formula') {
      const card = parseFormulaCard(spec);
      return card ? (
        <Shell eyebrow="A one-page formula card">
          <FormulaCardView card={card} />
        </Shell>
      ) : null;
    }
    if (kind === 'maker') {
      const plan = parseMakerPlan(spec);
      return plan ? (
        <Shell eyebrow="A build, planned out">
          <MakerPlanView plan={plan} />
        </Shell>
      ) : null;
    }
    if (kind === 'doodle') {
      const doodle = parseDoodle(spec);
      return doodle ? (
        <Shell eyebrow="a doodle">
          <DoodleView doodle={doodle} />
        </Shell>
      ) : null;
    }
    const cards = parseFlashcards(spec);
    return cards.length > 0 ? (
      <Shell eyebrow={concept ? `flashcards · ${concept}` : 'flashcards'}>
        <FlashcardsCard cards={cards} />
      </Shell>
    ) : null;
  }

  if (extras.path === 'visualization' && extras.viz) {
    // The drawing carries its own caption (the idea it is of); the card says nothing about who
    // drew it or for whom (DESIGN.md §0.x).
    return (
      <Shell>
        {/* Wobo's ink inherits the page's ink colour — a drawing built on currentColor reads in both
            themes instead of vanishing as black-on-black at night */}
        <div style={{ color: 'var(--wobo-ink-900)' }}>
          <DiagramView
            id={turn.id}
            svg={extras.viz.spec.svg}
            label={extras.viz.spec.caption ?? 'a drawing'}
            caption={extras.viz.spec.caption}
          />
        </div>
      </Shell>
    );
  }

  if (extras.path === 'action' && extras.action) {
    return <ActionCard turnId={turn.id} action={extras.action} />;
  }

  if (extras.path === 'route' && extras.route) {
    return (
      <motion.span {...rise} style={{ ...whisper, fontStyle: 'normal' }}>
        taking you to {extras.route.to}
        {extras.route.why ? ` — ${extras.route.why}` : ''}
      </motion.span>
    );
  }

  return null;
}
