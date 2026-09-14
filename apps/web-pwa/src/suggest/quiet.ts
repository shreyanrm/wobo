/**
 * WHAT A SUGGESTION IS ALLOWED TO PAINT WITH.
 *
 * docs/SUGGESTIONS-AND-NOTICES.md §2: *"It is never the loudest thing on the page."* That sentence
 * is the one rule in the law that a reviewer would otherwise have to hold by eye, twice a week, for
 * ever. So it is a token sheet instead, and `quiet.test.ts` holds the sheet to the sentence.
 *
 * The measure is not "is this pretty", it is "is this quieter than the thing it sits beside".
 * DESIGN.md §0 gives every accent a job and says one pointer per view; the primary action on a
 * lesson already owns it. A suggestion therefore gets a surface, body-sized type, a text action,
 * and one accent dot the size of a full stop. Nothing else.
 */

/** The accents DESIGN.md §0 gives a job to. A suggestion may wear one as a dot and never as a ground. */
export const ACCENTS = ['--pig', '--marigold', '--mint', '--rose', '--violet'] as const;

export const QUIET = {
  /** The ground it sits on: a surface, the way every card does. Never an accent, never a wash. */
  surface: 'var(--paper-2)',
  /** Its one heading, at body size, so nothing real on the page is smaller than it. */
  titleSize: '1rem',
  title: 'var(--ink)',
  /** Everything it says after the title, a step down. */
  bodySize: '0.9rem',
  body: 'var(--ink-2)',
  /** The kind's own label, and its second line. Quietest ink there is. */
  labelSize: '0.8125rem',
  label: 'var(--ink-3)',
  /**
   * The action. Text on the surface, not a filled pill: the filled pill in the pointer colour is
   * the one primary thing on the screen, and the suggestion is never it.
   */
  actionBackground: 'transparent',
  actionColor: 'var(--ink)',
  /** The decline, beside the action and as easy to hit. Same weight, quieter ink. */
  declineColor: 'var(--ink-3)',
  /** The whole accent budget, in pixels. */
  dot: 8,
  radius: 16,
  pad: 16,
  gap: 10,
  maxWidth: 620,
  /** Every control a thumb has to find. */
  tap: 44,
} as const;
