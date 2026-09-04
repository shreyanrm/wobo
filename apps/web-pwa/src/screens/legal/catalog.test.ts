/**
 * The addresses of the legal set, and the index built out of the README's own table.
 */

import { describe, expect, it } from 'bun:test';
import {
  canonicalSlug,
  crossReference,
  indexRows,
  legalPath,
  mailboxes,
  slugOfFile,
  spansText,
} from './catalog';
import { parseBlocks } from './markdown';

const KNOWN = ['terms-of-service', 'privacy-policy', 'cookies'];

describe('addresses', () => {
  it('resolves the short links the landing page footer already uses', () => {
    expect(canonicalSlug('terms')).toBe('terms-of-service');
    expect(canonicalSlug('privacy')).toBe('privacy-policy');
    expect(canonicalSlug('safety')).toBe('safety-and-content');
  });

  it('leaves a document slug alone', () => {
    expect(canonicalSlug('cookies')).toBe('cookies');
    expect(slugOfFile('docs/legal/childrens-privacy.md')).toBe('childrens-privacy');
    expect(legalPath('cookies')).toBe('/legal/cookies');
    expect(legalPath()).toBe('/legal');
  });

  it('turns a cross-reference in the prose into a link, and leaves an unknown one as it is', () => {
    expect(crossReference('cookies.md', KNOWN)).toBe('/legal/cookies');
    expect(crossReference('CONTEXT.md', KNOWN)).toBe(null);
    expect(crossReference('the plan', KNOWN)).toBe(null);
  });
});

describe('indexRows', () => {
  const readme = parseBlocks(`# The legal set

| File | What it is | Who reads it |
|---|---|---|
| \`terms-of-service.md\` | the agreement to use Wobo | everyone, at sign-up |
| \`cookies.md\` | what we store on your device | everyone |
| \`missing.md\` | a document we do not hold | nobody |
`);

  it("describes each document in the README's own words", () => {
    const rows = indexRows(readme, KNOWN);
    expect(rows.map((r) => r.slug)).toEqual(['terms-of-service', 'cookies']);
    expect(spansText(rows[0]?.what ?? [])).toBe('the agreement to use Wobo');
    expect(spansText(rows[0]?.who ?? [])).toBe('everyone, at sign-up');
  });

  it('drops a row naming a document the site does not hold, rather than linking nowhere', () => {
    expect(indexRows(readme, KNOWN).some((r) => r.slug === 'missing')).toBe(false);
  });
});

describe('mailboxes', () => {
  it('collects every address once, in the order a reader meets them', () => {
    expect(
      mailboxes(['write to support@heywobo.com', 'or Second@example.com, or support@heywobo.com']),
    ).toEqual(['support@heywobo.com', 'second@example.com']);
  });
});
