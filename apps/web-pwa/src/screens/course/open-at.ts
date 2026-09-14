/**
 * WHICH CARD A LINK OPENS A COURSE AT (docs/EMAILS-AND-ANIMATIONS.md §4).
 *
 * `/course/<course>/card/<card>` carries the card as one opaque segment, because the two players
 * number their cards differently: the atom's are named (`scale`, `boss`), the generated player's
 * are an index (`4`). The router does not know which kind a course is and must not learn — so the
 * segment is read HERE, by the player that owns those cards, and a card that means nothing to this
 * course is simply not a card: the course opens the way it always did, at the saved place.
 *
 * Two rules the players share, and the reason each exists:
 *
 * 1. **Never the end of the course.** The greeting, the tease and the mystery are what a lesson
 *    PAYS OUT — the completion, the stars, the ceremony. A link that opened on one would hand
 *    over the finish of a lesson nobody walked, to anybody who guessed the address.
 * 2. **Only a card that is really there.** An index past the end of the deck is a blank screen
 *    with a Continue button on it, which is worse than starting where they left off.
 *
 * A pressed link is signed (`hospitality/links.py`), so in practice the card is one WE minted.
 * These two rules hold for the other way in as well: a typed address, a stale bookmark, a link
 * forwarded and edited on the way.
 */

/**
 * The cards of the atom a link may open on: the teaching beats, and nothing before or after them.
 * The same list the resume position is filtered by, so a place a course would never restore to is
 * not a place a link can jump to either.
 */
export const OPENABLE_ATOM_CARDS = ['scale', 'whatif', 'practice', 'bossdoor', 'boss'] as const;

export type OpenableAtomCard = (typeof OPENABLE_ATOM_CARDS)[number];

/** The atom card this link asks for, or null to open the course the way it always opens. */
export function atomCardFromLink(cardId: string | undefined): OpenableAtomCard | null {
  if (!cardId) return null;
  const found = OPENABLE_ATOM_CARDS.find((card) => card === cardId);
  return found ?? null;
}

/**
 * The generated player's card index this link asks for, or null.
 *
 * `cards` is how many cards the composed course holds. Card 0 is the ink card the course opens
 * on — its own front door, not a place to land — and the index one past the last card is the
 * workbook, which is.
 */
export function composedCardFromLink(cardId: string | undefined, cards: number): number | null {
  if (!cardId || !/^\d+$/.test(cardId)) return null; // digits only: no sign, no dot, no exponent
  const index = Number(cardId);
  if (!Number.isSafeInteger(index) || cards < 1) return null;
  return index >= 1 && index <= cards + 1 ? index : null;
}
