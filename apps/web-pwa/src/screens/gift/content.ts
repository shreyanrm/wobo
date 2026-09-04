/**
 * The gift page's words, read out of `docs/copy/growth/gift-page.md`.
 *
 * That file is reviewed copy and it is written with template variables in it — `{{gift_length}}` —
 * because a gift's length is a product decision, not prose. Two rules follow, and both are enforced
 * here rather than left to whoever edits the page:
 *
 *  · a variable with a decided value is filled;
 *  · a variable with no decision behind it becomes a visible blank, never a plausible-looking
 *    number. A gift page that says "three months" before anyone has decided three months is the
 *    kind of small lie a learner's parent finds out about after paying.
 *
 * Pure, and tested against the real file in `content.test.ts`.
 */

import type { Block } from '../legal/markdown';

/** The variables that have a decision behind them. Anything missing renders as a blank. */
export const GIFT_VALUES: Readonly<Record<string, string>> = {
  // WOBO-PLAN §14 bills monthly, so a gift is a run of months rather than a fixed pack, and the
  // length is the giver's own choice at checkout. That is a decision, so it fills rather than
  // blanks — and it keeps the copy's rule that a gift costs what the same plan costs.
  gift_length: 'the months you choose',
};

/** Fill the decided variables; mark the rest as the open decisions they are. */
export function fillTemplate(
  source: string,
  values: Readonly<Record<string, string>> = GIFT_VALUES,
): string {
  return source.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_all, name: string) => {
    const value = values[name];
    if (value) return value;
    return `[${name.replace(/_/g, ' ')} not decided yet]`;
  });
}

/**
 * The page's sections, keyed by the bold label the copy gives them ("Heading", "Sub", "How it
 * works", "What it is", "What it is not", "The honest footnote"). Only the part of the document
 * under "## The page" is read: what follows it is the email the recipient gets, which the mail
 * templates own, not this page.
 */
export function giftSections(blocks: readonly Block[]): Record<string, Block[]> {
  const out: Record<string, Block[]> = {};
  let inPage = false;
  let current: string | null = null;
  for (const block of blocks) {
    if (block.kind === 'heading') {
      if (block.level === 2) {
        inPage = /^the page$/i.test(block.text.trim());
        current = null;
      }
      continue;
    }
    if (!inPage) continue;
    // The copy labels a section with a bold run at the head of a paragraph; whatever follows the
    // bold run on the same line is that section's first sentence.
    const spans = block.kind === 'paragraph' ? block.spans : [];
    const [first, ...rest] = spans;
    if (block.kind === 'paragraph' && first?.kind === 'strong') {
      current = first.text.trim().replace(/:$/, '');
      const body =
        rest[0]?.kind === 'text'
          ? [{ ...rest[0], text: rest[0].text.replace(/^\s+/, '') }, ...rest.slice(1)]
          : rest;
      out[current] = body.length ? [{ kind: 'paragraph', spans: body }] : [];
      continue;
    }
    if (current) (out[current] as Block[]).push(block);
  }
  return out;
}

/** The flat text of a section, for a heading or a lead that has to be a plain string. */
export function sectionText(blocks: readonly Block[] | undefined): string {
  if (!blocks?.length) return '';
  return blocks
    .filter((b) => b.kind === 'paragraph')
    .map((b) => (b.kind === 'paragraph' ? b.spans.map((s) => s.text).join('') : ''))
    .join(' ')
    .trim();
}

/** A paragraph that is only a bracketed label is the copy's way of drawing a button. */
export function isButtonLine(block: Block): string | null {
  if (block.kind !== 'paragraph' || block.spans.length !== 1) return null;
  const [only] = block.spans;
  return only?.kind === 'placeholder' ? only.text : null;
}
