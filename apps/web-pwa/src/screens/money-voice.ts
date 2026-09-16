/**
 * The money's voice: the lines, verbatim, and the words that may never appear beside them.
 *
 * The owner, 2026-09-15 (docs/SELL.md, "The money's voice"): *"In the billing or pricing areas,
 * make sure you use lines like: we use this money to invest in improving the application, create
 * more beautiful content. We need to make them feel grateful, create that personal touch. We
 * aren't showing ourselves like a business."*
 *
 * THE LINES ARE NOT WRITTEN HERE. They live in `docs/copy/money.md`, one per surface, and this
 * file is a typed copy of that table. `money-voice.test.ts` reads the document off disk and holds
 * every constant below equal to its row, so the page, the mail and the app cannot drift into
 * three voices for the same sentence — and so that changing the voice is an edit to the document
 * the owner wrote, never to a string in a component.
 *
 * THE RULES THE DOCUMENT SETS, enforced by the test rather than remembered:
 *  · ONE LINE PER SURFACE. Never two on one screen. A second sentence of thanks reads as a pitch.
 *  · NOTHING THAT SOUNDS LIKE A COMPANY. `FORBIDDEN` is the document's own list, and "business"
 *    never appears in any form.
 *  · NO EXCLAMATION MARK, and no em dash: the copy laws (DESIGN.md §0, docs/copy/voice.md §10a)
 *    bind these lines like every other line a family reads.
 *
 * WHAT THIS FILE IS NOT. It is not a money figure and never becomes one. The learner's own
 * surfaces show no currency at all (docs/ALLOWANCE.md §2, the owner: *"it's not money based at
 * the users' end"*), so the line on the You bar says where the money goes and never how much.
 */

/** Every surface `docs/copy/money.md` writes a line for. The keys are this file's; the sentences
 *  are the document's. */
export type MoneySurface =
  | 'plansPage'
  | 'checkout'
  | 'youBar'
  | 'receiptMail'
  | 'planOpenedMail'
  | 'renewalMail'
  | 'failedPaymentMail'
  | 'parentPay'
  | 'donate'
  | 'freeLearnerYou';

/**
 * The table, word for word. Held equal to `docs/copy/money.md` by the test.
 *
 * The four mail lines are here as well as in the gateway's `email_templates.py` for one reason:
 * the test that proves a mail carries its line reads THIS table and the document, so a line
 * changed in one place and not the other goes red on both sides of the wire.
 */
export const MONEY_LINES: Readonly<Record<MoneySurface, string>> = {
  plansPage:
    'Your plan pays for the drawings, the voice, and the next lesson. That is where the money goes.',
  checkout: 'This is what keeps Wobo drawing for your child, and for the next one.',
  youBar: "Today's lessons are paid for by your plan. Thank you for that.",
  receiptMail: 'Thank you. This pays for the drawings, the voice, and a better lesson tomorrow.',
  planOpenedMail:
    'Thank you for choosing a plan. It pays for the drawings, the voice, and the next child’s first lesson.',
  renewalMail: 'Your plan renewed. Thank you for keeping the drawings coming.',
  failedPaymentMail:
    'The payment did not go through. Nothing changes today. When you are ready, the plan picks up where it left off.',
  parentPay:
    'What you pay here becomes drawings, a voice, and lessons that keep going until the topic is understood.',
  donate:
    'A gift here goes to a child whose family cannot pay. It becomes their drawings and their lessons.',
  freeLearnerYou:
    'Thank you for learning with Wobo. A plan adds more lessons a day and pays for the drawings that make them.',
} as const;

/**
 * The words `docs/copy/money.md` forbids on any surface that mentions money, and the reason each
 * one is on the list: every one of them is how a company talks about itself to a customer, and
 * the register here is a person telling a family where their money went.
 *
 * "business" is separate from the rest because the document bans the WORD, in any phrase, not
 * only the stock apology "we appreciate your business".
 */
export const FORBIDDEN: readonly string[] = [
  'subscription',
  'billing cycle',
  'tier',
  'upgrade',
  'premium',
  'pro features',
  'unlock',
  'limited offer',
  'exclusive',
  'appreciate your business',
  'mission',
  'business',
];

/** Every line, for a test that wants to sweep them all. */
export const EVERY_LINE: readonly string[] = Object.values(MONEY_LINES);

/**
 * Which forbidden words a piece of copy carries. Empty is the only passing answer.
 *
 * Word-boundary matched, so "tier" does not fire on "tiered" by accident and — more importantly —
 * does fire on "Tier" at the start of a sentence. Multi-word entries are matched as phrases.
 */
export function forbiddenWordsIn(text: string): string[] {
  const said = text.toLowerCase();
  return FORBIDDEN.filter((word) =>
    new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(said),
  );
}

/**
 * How many of the document's lines a surface is carrying. The document says one per surface and
 * never two, so this is the assertion a screen test makes rather than a substring check.
 */
export function linesCarriedBy(text: string): MoneySurface[] {
  return (Object.keys(MONEY_LINES) as MoneySurface[]).filter((surface) =>
    // Apostrophes differ between the document (’) and a source file that may write ('), so the
    // comparison normalises them rather than failing on a character nobody reads differently.
    normalise(text).includes(normalise(MONEY_LINES[surface])),
  );
}

/** One spelling for the two apostrophes and the two quote marks, so copy cannot fail on glyphs. */
export function normalise(text: string): string {
  return text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}
