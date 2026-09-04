/**
 * The gift page renders reviewed copy with its variables handled honestly.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseBlocks } from '../legal/markdown';
import { fillTemplate, giftSections, isButtonLine, sectionText } from './content';

const SOURCE = readFileSync(
  new URL('../../../../../docs/copy/growth/gift-page.md', import.meta.url).pathname,
  'utf8',
);

describe('fillTemplate', () => {
  it('fills the gift length now that the giver chooses it at checkout', () => {
    // §14: a gift is a run of months the giver picks, so the slot has an answer and states it.
    expect(fillTemplate('Pro, for {{gift_length}}, for one learner.')).toBe(
      'Pro, for the months you choose, for one learner.',
    );
  });

  it('marks a variable nobody has decided as a blank, never as a plausible number', () => {
    expect(fillTemplate('it costs {{price_nobody_set}} a month')).toBe(
      'it costs [price nobody set not decided yet] a month',
    );
  });

  it('leaves no template braces behind', () => {
    expect(fillTemplate(SOURCE)).not.toContain('{{');
  });
});

describe('giftSections', () => {
  const sections = giftSections(parseBlocks(fillTemplate(SOURCE)));

  it('reads the page the copy describes, and stops before the email', () => {
    expect(Object.keys(sections)).toEqual([
      'Heading',
      'Sub',
      'How it works',
      'What it is',
      'What it is not',
      'The honest footnote',
    ]);
  });

  it('keeps the heading and the sub as the copy wrote them', () => {
    expect(sectionText(sections.Heading)).toBe('Give someone a tutor who sits beside them.');
    expect(sectionText(sections.Sub)).toContain('They pick their own board');
  });

  it('carries the three steps as a list', () => {
    const list = sections['How it works']?.find((b) => b.kind === 'list');
    expect(list?.kind === 'list' && list.items.length).toBe(3);
  });

  it("reads the copy's own button line as a button", () => {
    const button = (sections['How it works'] ?? []).map(isButtonLine).find(Boolean);
    expect(button).toBe('Give Pro');
  });

  it('carries the honest footnote, and it says what happens at the end', () => {
    const footnote = sectionText(sections['The honest footnote']);
    expect(footnote).toContain('renews never');
    expect(footnote).toContain('goes back to the free plan');
    expect(footnote).toContain('everything they learnt stays');
  });
});

/**
 * DESIGN.md §0, "cancel, never refund" (owner, 4 September 2026): no product surface may promise
 * money back. The gift page is a selling surface, so the words are held out of the part of the copy
 * it renders — the rules block below "## The page" may still point at the legal document, because
 * nobody reads that on the site.
 */
describe('the gift page promises no money back', () => {
  const sections = giftSections(parseBlocks(fillTemplate(SOURCE)));
  // Every block the page renders, list items included, not just the paragraphs.
  const rendered = JSON.stringify(sections);

  it('says refund nowhere a buyer can read it', () => {
    expect(/refund/i.test(rendered)).toBe(false);
    expect(/money back/i.test(rendered)).toBe(false);
  });

  it('leaves no refund window variable behind to fill', () => {
    expect(SOURCE).not.toContain('refund_days');
    // and the value is gone with it, so a reappearing variable renders as the blank it now is
    expect(fillTemplate('{{refund_days}}')).toBe('[refund days not decided yet]');
  });

  it('says instead that there is nothing to cancel, because nothing renews', () => {
    expect(sectionText(sections['The honest footnote'])).toContain('nothing to cancel');
  });
});
