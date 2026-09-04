/**
 * The donate page's words and numbers, read out of `docs/copy/growth/donate-page.md`.
 *
 * The page proper is that file, rendered — the same arrangement `screens/gift/Gift.tsx` uses for
 * `gift-page.md`, and this module reuses that page's section reader rather than writing a second
 * one. What lives here is only what the donate source needs and the gift source did not:
 *
 *  · `unfoldLists` — the copy hard-wraps its numbered items at 100 columns. The legal parser (which
 *    only ever had to read `docs/legal/**`, wrapped differently) reads a wrapped continuation as a
 *    new paragraph, which split "Who gets a funded place." away from the half of the sentence that
 *    answers it. Joining the continuation back on before parsing is one pure function; teaching the
 *    shared parser about it would change how ten legal documents render.
 *  · `policyLines` — the four policy lines at the top of the source, read from the source rather
 *    than retyped. They are the owner's to settle and the page cannot exist without them, so the
 *    page states them; stating them by hand is how one of them would quietly get softened.
 *  · `placePrice` — what a place costs. THE PRICE IS THE PLAN PRICE (the copy's own rule): there is
 *    no donate price list, only `plans/prices.ts` read for the length being funded. A length with no
 *    price behind it yet returns null and the page draws the gap, never a plausible number.
 *
 * Pure, and tested against the real file in `content.test.ts`.
 */

import { isButtonLine, sectionText } from '../gift/content';
import type { Block, Inline } from '../legal/markdown';
import {
  formatMoney,
  type Market,
  type PlanTier,
  tierById,
  yearlyTotalLabel,
} from '../plans/prices';

// --- reading the source ---------------------------------------------------------------------------

/**
 * Join a hard-wrapped list item back into one line.
 *
 * A line that is indented and follows a list item is that item's continuation, not a paragraph of
 * its own. Everything else is left exactly as written, so a table, a heading and a blank line pass
 * through untouched.
 */
export function unfoldLists(source: string): string {
  const out: string[] = [];
  let open = false;
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    const item = /^\s*(?:[-*+]|\d+\.)\s+\S/.test(line);
    if (open && !item && /^\s{2,}\S/.test(line)) {
      out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`;
      continue;
    }
    open = item;
    out.push(line);
  }
  return out.join('\n');
}

/**
 * A section's PROSE — its words, without the copy's own bracketed button line.
 *
 * The copy draws a control as a line of its own ("[Ask for a place]") and the page draws it as a
 * real control, so the label must not also arrive as the tail of the paragraph above it. It did:
 * the family's invitation read "One line is enough. Ask for a place" until this filter existed.
 */
export function proseText(blocks: readonly Block[] | undefined): string {
  return sectionText((blocks ?? []).filter((block) => !isButtonLine(block)));
}

/** The flat text of a run of spans. */
function flatten(spans: readonly Inline[]): string {
  return spans.map((span) => span.text).join('');
}

/** One of the four lines at the top of the source that only the owner can settle. */
export interface PolicyLine {
  /** The bold lead the copy gives the line: what the line decides. */
  lead: string;
  /** The proposal, word for word, without the editorial "Proposed:" marker addressed to the owner. */
  text: string;
}

/**
 * The four policy lines, read out of the source's own numbered list.
 *
 * Two things are removed and nothing else: the "Proposed:" marker, which is addressed to the owner
 * rather than to a reader, and the lowercase start it left behind. No line is shortened, reordered
 * or softened, and a fifth cannot appear here without appearing in the copy first.
 */
export function policyLines(blocks: readonly Block[]): PolicyLine[] {
  let inside = false;
  for (const block of blocks) {
    if (block.kind === 'heading') {
      inside = block.level === 2 && /^owner confirm\b/i.test(block.text.trim());
      continue;
    }
    if (!inside || block.kind !== 'list' || !block.ordered) continue;
    return block.items.map((spans) => {
      const [first, ...rest] = spans;
      const strong = first?.kind === 'strong';
      const body = flatten(strong ? rest : spans)
        .trim()
        .replace(/^Proposed:\s*/i, '');
      return {
        lead: strong ? first.text.trim() : '',
        text: body.charAt(0).toUpperCase() + body.slice(1),
      };
    });
  }
  return [];
}

/**
 * A block of copy split at its first full stop: the sentence that names the thing, and whatever
 * follows it. The page draws the first as a heading and the rest as the line under it, which is how
 * the drawing sets a step and the family's invitation — without an editor retyping either half.
 */
export function splitLead(text: string): { lead: string; rest: string } {
  const at = text.search(/\.\s+\S/);
  if (at < 0) return { lead: text.trim(), rest: '' };
  return { lead: text.slice(0, at + 1).trim(), rest: text.slice(at + 1).trim() };
}

/** A paragraph as its sentences, in order. Used for the list of denials, which the copy writes flat. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A heading split around the phrase the page sets in the brand pigment. */
export function emphasise(text: string, phrase: string): [string, string, string] {
  const at = text.indexOf(phrase);
  if (at < 0) return [text, '', ''];
  return [text.slice(0, at), phrase, text.slice(at + phrase.length)];
}

// --- what a place costs ---------------------------------------------------------------------------

/**
 * The plan a funded place carries.
 *
 * The copy's rule is that the price is the plan price and a donation is never a discount surface,
 * so a place is a real tier out of `plans/prices.ts` and its price is that tier's price. Pro is the
 * tier the drawing prices (design/prototypes/site-donate.html shows ₹1,999 and $20, which are Pro's
 * two prices to the rupee), and it is the tier a parent buys for one learner. It is named here once
 * so the page cannot drift from the plans page, and it is in the report as a line for the owner.
 */
export const PLACE_TIER: PlanTier['id'] = 'pro';

export interface Place {
  id: 'month' | 'term' | 'year';
  /** What the card is called. */
  name: string;
  /**
   * How many months of the plan this length is, for the lengths priced by the month.
   *
   * A YEAR IS NOT TWELVE MONTHLY PRICES. The copy is explicit that a year costs the yearly price a
   * parent pays, and the page's whole claim is "the price a parent pays, nothing added", so charging
   * twelve monthlies for a year would make that sentence false. When this file was first written no
   * yearly price existed, so the year showed the gap honestly; `prices.ts` now carries one, and the
   * year reads it through `yearlyTotalOf` instead. `months` stays null for the year to say that its
   * price is not a multiple of anything.
   */
  months: number | null;
  /** The line under the price. */
  note: string;
  /** The card's door, where the length has one. */
  cta: string | null;
}

/** What a place costs, in this market, or null where the length has no price behind it yet. */
export function placePrice(place: Place, market: Market): string | null {
  const tier = tierById(PLACE_TIER);
  if (!tier) return null;
  // A year is the plan's own yearly price, never twelve monthly ones: this page promises the price
  // a parent pays and nothing added, and twelve monthlies would be more than a parent pays.
  if (place.id === 'year') return yearlyTotalLabel(tier, market);
  if (place.months === null) return null;
  const money = tier.price?.[market];
  if (!money) return null;
  return formatMoney({ currency: money.currency, amount: money.amount * place.months });
}
