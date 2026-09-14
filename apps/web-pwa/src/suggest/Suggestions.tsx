'use client';

/**
 * THE ONE PLACE A SUGGESTION IS RENDERED.
 *
 * docs/SUGGESTIONS-AND-NOTICES.md §2: *"At most one suggestion on screen at a time."* A rule like
 * that cannot live in a review comment, because the day two screens each render their own is the
 * day it is broken, quietly, and nobody notices for a month. So there is one host: a screen hands
 * it everything that might be true and it hands back one card, or nothing.
 *
 * It also owns the no. `decline` writes to the session ledger before the caller hears about it, so
 * a screen cannot forget to remember, and the same suggestion cannot come back this session even if
 * the screen rebuilds its candidates on every render.
 *
 * `slotFor` is for a kind that already has a card of its own — the side door has the arcade's, with
 * what it is worth written on it. The slot replaces the card and never the gate: the chosen one is
 * still chosen here, and the no still sits underneath it.
 */

import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { choose } from './choose';
import type { Suggestion as Offer } from './kind';
import { decline } from './session';
import { DeclineButton, Suggestion } from './Suggestion';

export function Suggestions({
  candidates,
  hue,
  onTake,
  onAsk,
  slotFor,
}: {
  /** Everything that might be true on this screen. Nulls are ordinary and are dropped. */
  candidates: readonly (Offer | null | undefined)[];
  hue: string;
  onTake?: (offer: Offer) => void;
  onAsk?: (question: string, offer: Offer) => void;
  /** A card of the kind's own, for a kind that has one. Return null to use the plain one. */
  slotFor?: (offer: Offer) => ReactNode | null;
}) {
  // A no has to change what `choose` answers on the very next render, and the ledger it writes to
  // is module state rather than React state, so this is what takes the card off the screen.
  const [, setSaidNo] = useState(0);

  const onDecline = useCallback((offer: Offer) => {
    decline(offer.id);
    setSaidNo((n) => n + 1);
  }, []);

  const offer = choose(candidates);
  if (!offer) return null;

  const slot = slotFor?.(offer) ?? null;
  if (slot) {
    return (
      <>
        {slot}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-start',
            maxWidth: 620,
            margin: '4px auto 0',
          }}
        >
          <DeclineButton label={offer.decline} onClick={() => onDecline(offer)} />
        </div>
      </>
    );
  }

  return <Suggestion offer={offer} hue={hue} onTake={onTake} onAsk={onAsk} onDecline={onDecline} />;
}
