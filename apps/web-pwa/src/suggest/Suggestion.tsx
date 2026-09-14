'use client';

/**
 * ONE SUGGESTION, DRAWN QUIETLY.
 *
 * docs/SUGGESTIONS-AND-NOTICES.md §2, and every clause of it is visible in the markup:
 *
 *   OFF THE FLOW.     An `<aside>`. Nothing that counts a learner's progress can see it, and the
 *                     screen's own action bar is untouched, so whatever was the primary thing
 *                     before this existed still is.
 *   NEVER THE LOUDEST. It paints only from `quiet.ts`: a surface, body-sized type, a text action,
 *                     and one accent dot. The filled pill in the pointer colour belongs to the
 *                     lesson, and it stays there.
 *   DECLINING IS FREE. "not now" sits beside the action, the same size, asking nothing. It is the
 *                     only thing on the card that is remembered, and it is remembered for one
 *                     session (`session.ts`).
 *   NOTHING IS LOST.  Where a kind has something to say about declining, it says it on the card,
 *                     in its own words, rather than in a document nobody reads.
 *
 * It describes neither itself nor Wobo: no label saying what a suggestion is, no line announcing
 * what is about to happen. It names a thing and says why it follows (DESIGN.md §0.x).
 */

import { motion, useReducedMotion } from 'framer-motion';
import type { Suggestion as Offer } from './kind';
import { QUIET } from './quiet';

const LABEL: Record<Offer['kind'], string> = {
  next: 'next',
  way_back: 'another way in',
  side_door: 'bonus level',
  ask: 'ask',
};

/**
 * THE NO, WHICH EVERY SUGGESTION CARRIES.
 *
 * It is its own component because the side door renders its own card (the arcade's, with what it is
 * worth on it) and still has to be as easy to decline as every other kind. One control, one place,
 * so "declining is as easy as taking it" cannot be true on three screens and false on the fourth.
 */
export function DeclineButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      data-testid="suggestion-decline"
      onClick={onClick}
      style={{
        minHeight: QUIET.tap,
        padding: '11px 16px',
        borderRadius: 999,
        border: 0,
        background: QUIET.actionBackground,
        color: QUIET.declineColor,
        fontFamily: 'inherit',
        fontSize: QUIET.bodySize,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

export function Suggestion({
  offer,
  hue,
  onTake,
  onAsk,
  onDecline,
}: {
  offer: Offer;
  /** The topic's own colour, spent on a dot and nowhere else. */
  hue: string;
  onTake?: (offer: Offer) => void;
  onAsk?: (question: string, offer: Offer) => void;
  onDecline?: (offer: Offer) => void;
}) {
  const reduced = useReducedMotion() ?? false;

  return (
    <motion.aside
      data-testid="suggestion"
      data-kind={offer.kind}
      aria-label={`${LABEL[offer.kind]}: ${offer.title}`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 240, damping: 26 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: QUIET.gap,
        padding: QUIET.pad,
        borderRadius: QUIET.radius,
        background: QUIET.surface,
        maxWidth: QUIET.maxWidth,
        margin: '20px auto 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: QUIET.dot,
            height: QUIET.dot,
            borderRadius: 999,
            background: hue,
            flex: '0 0 auto',
          }}
        />
        <span
          style={{
            fontSize: QUIET.labelSize,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: QUIET.label,
            fontWeight: 500,
          }}
        >
          {LABEL[offer.kind]}
        </span>
      </div>

      <h3 style={{ margin: 0, fontSize: QUIET.titleSize, fontWeight: 540, color: QUIET.title }}>
        {offer.title}
      </h3>
      <p style={{ margin: 0, fontSize: QUIET.bodySize, lineHeight: 1.5, color: QUIET.body }}>
        {offer.why}
      </p>
      {offer.note ? (
        <p style={{ margin: 0, fontSize: QUIET.labelSize, lineHeight: 1.5, color: QUIET.label }}>
          {offer.note}
        </p>
      ) : null}

      {/*
        THE ASK KIND'S TWO OR THREE. They are the action, so there is no separate one: each question
        is its own control, and the page already knows the answer to every one of them.
      */}
      {offer.questions.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {offer.questions.map((q) => (
            <button
              key={q}
              type="button"
              data-testid="suggestion-question"
              onClick={() => onAsk?.(q, offer)}
              style={{
                minHeight: QUIET.tap,
                padding: '10px 16px',
                borderRadius: 999,
                border: 0,
                background: 'var(--paper)',
                color: QUIET.actionColor,
                fontFamily: 'inherit',
                fontSize: QUIET.bodySize,
                fontWeight: 500,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {offer.target ? (
          <button
            type="button"
            data-testid="suggestion-take"
            onClick={() => onTake?.(offer)}
            style={{
              minHeight: QUIET.tap,
              padding: '11px 16px',
              borderRadius: 999,
              border: 0,
              background: QUIET.actionBackground,
              color: QUIET.actionColor,
              fontFamily: 'inherit',
              fontSize: QUIET.bodySize,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {offer.action}
          </button>
        ) : null}
        <DeclineButton label={offer.decline} onClick={() => onDecline?.(offer)} />
      </div>
    </motion.aside>
  );
}
