/**
 * The few words the donate page needs that `docs/copy/growth/donate-page.md` does not carry.
 *
 * Everything a reader could check against the product — the heading, the sub, the three steps, the
 * four policy lines, what a place is, what it is not, the family's invitation and the honest
 * footnote — is read out of that file and rendered. What is here is page furniture: a chapter
 * label, a section heading, a caption, a control's name. The rule the whole page is held to is that
 * NOTHING IS CLAIMED THAT CANNOT BE SHOWN, so every line below is either a plain structural phrase
 * with no claim in it, or one that is entailed by a line of the governed copy, and the comment
 * beside it says which. They are Fable's own words in `design/prototypes/site-donate.html`, which
 * is the page's drawing.
 *
 * Two words from the drawing are deliberately NOT here:
 *
 *  · its example message, "Class 8, CBSE. We cannot manage the fee this year." A class number on a
 *    public surface is a gate, which law v5's copy law forbids outright (DESIGN.md §0), and the
 *    message is also a family that never wrote to us. The card in its place shows the mailbox and
 *    the copy's own sentence about what we do not ask for, which is the same reassurance without
 *    inventing a family to give it.
 *  · its hand-written "we read every one of these ourselves", which is a promise about our own
 *    conduct that nothing in the product can show. The copy's own "One line is enough." is written
 *    in Wobo's hand instead.
 */

/** What a length of a funded place is called, and what it costs. See `content.ts` for the price. */
export interface PlaceCopy {
  id: 'month' | 'term' | 'year';
  name: string;
  months: number | null;
  note: string;
  cta: string | null;
}

/**
 * The three lengths the copy's `place_lengths` names: a month, a term, a year.
 *
 * A month is the plan's monthly price and a term is three of them, because a plan is billed by the
 * month and there is no term rate to be cheaper or dearer than. A YEAR is the one the copy singles
 * out — "the YEARLY price, not twelve monthly ones, because that is what a parent pays for a year"
 * — and there is no yearly price anywhere in the product, so the year carries no number and no
 * door. A card that invented one would be the exact thing this page exists not to do.
 */
export const PLACES: readonly PlaceCopy[] = [
  {
    id: 'month',
    name: 'One place, one month',
    months: 1,
    note: 'Long enough to get past the chapter that started all this.',
    cta: 'Fund a month',
  },
  {
    id: 'term',
    name: 'One place, one term',
    months: 3,
    note: 'Three months, at three times the monthly price a parent pays.',
    cta: 'Fund a term',
  },
  {
    id: 'year',
    name: 'One place, one year',
    // Null on purpose, and not a gap: a year is priced by the year, so it is not a multiple of the
    // monthly price. `placePrice` reads the plan's own yearly total for this one.
    months: null,
    note: 'A whole year, at the yearly price a parent pays. Not twelve monthly ones.',
    cta: 'Fund a year',
  },
];

/** What the page shows where a price has not been decided. */
// The fallback when a price cannot be read for this market. All three lengths are priced today,
// so this should never render; it exists because a page that takes money must show a gap rather
// than a zero or a guess if a price table is ever missing.
export const PRICE_NOT_SET = 'price not set for your region yet';

/**
 * The panel drawn twice, once for each payer. Both panels render from this one object, so there is
 * nothing on either of them that is not on the other.
 */
export const PLACE_PANEL = {
  /** A learner's question, of the kind the board answers. Nobody's, and no name on it. */
  ask: 'Why does the bottom number stay the same?',
  /** What the board is showing, for anyone who cannot see it. */
  board: 'Two thirds shaded, then one more third added',
  /**
   * The four forms an answer takes. The copy's own list, in its own order: "drawn on a board,
   * played as a short film, built as a thing to drag, or spoken".
   */
  kinds: ['Drawn', 'Filmed', 'Tried', 'Spoken'],
  /** The copy again: "a memory of what did not stick, so it comes back before it is lost". */
  foot: 'What did not stick, brought back',
} as const;

export const DONATE_PAGE = {
  eyebrow: 'Donate Wobo',
  /** The half of the copy's heading the page sets in the brand pigment. */
  headingEm: 'who cannot',

  /** The twins. Both captions say the same thing about the same panel; only the payer changes. */
  sameLabel: 'The same product',
  sameTitle: 'Spot the difference.',
  // The copy's Sub, in the page's own voice: "It is the whole of Wobo... the same everything a
  // paying family gets" — plus policy 3, which is why the second payer is a stranger.
  sameLede:
    'One of these was paid for by a parent. The other was paid for by somebody the learner will never meet. We only ever built one thing, so there is only one thing to give.',
  sameHand: 'spot the difference',
  paidByParent: 'Paid for by a parent',
  paidByStranger: 'Paid for by somebody they will never meet',

  /** The steps. Entailed by policy 1 (no means test, no documents) and policy 4 (no gratitude). */
  stepsLabel: 'How it works',
  stepsTitle: 'No forms, no proof, no thank-you letter.',

  /** The four policy lines, stated where a reader can see all four at once. */
  rulesLabel: 'The rules',
  rulesTitle: 'The four rules of a funded place.',

  /** What a place costs. The heading is the copy's rule: the price is the plan price. */
  costLabel: 'What a place costs',
  costTitle: 'The price a parent pays. Nothing added.',
  costLink: 'The plans, side by side',

  /** What a place is. The label is the copy's Sub, word for word. */
  insideLabel: 'The whole of Wobo',
  insideTitle: 'What a place is.',

  /** What it is not. */
  notLabel: 'What it is not',
  notTitle: 'A funded place is not a lesser one.',

  /** The family's half. The heading and the line under it are the copy's, split at its full stop. */
  askLabel: 'If this is you',
  askAsideLabel: 'Write to',
  /** The copy's first step, word for word, so the card promises exactly what the page promises. */
  askAsideFoot: 'We do not ask for papers and we do not check up on anyone.',

  /** The close. The product is one product; the drawing's own last line. */
  closeTitle: 'The product is the same. Only the person paying changes.',
  closeQuiet: 'Gift Wobo instead',
} as const;
