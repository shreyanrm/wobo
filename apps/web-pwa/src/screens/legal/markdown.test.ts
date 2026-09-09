/**
 * The parser that renders the legal set. Its job is fidelity: the reviewed copy in `docs/legal/**`
 * has to come out the other side as what the author wrote, with the two documented exceptions —
 * the questions for counsel are stripped and counted, and a bracketed blank is marked as a blank.
 */

import { describe, expect, it } from 'bun:test';
import {
  documentBody,
  documentShape,
  parseBlocks,
  parseInline,
  slugify,
  stripReviewTags,
  trimPlainWordsLabel,
} from './markdown';

const text = (spans: ReturnType<typeof parseInline>): string => spans.map((s) => s.text).join('');

describe('parseInline', () => {
  it('reads bold, code and a bracketed blank', () => {
    const spans = parseInline('**In plain words** see `cookies.md` within [30 days]');
    expect(spans.map((s) => s.kind)).toEqual(['strong', 'text', 'code', 'text', 'placeholder']);
    expect(text(spans)).toBe('In plain words see cookies.md within 30 days');
  });

  it('links a bare email address, which is how every address in the set is written', () => {
    const spans = parseInline('Write to support@heywobo.com about it.');
    const link = spans.find((s) => s.kind === 'link');
    expect(link).toEqual({
      kind: 'link',
      text: 'support@heywobo.com',
      href: 'mailto:support@heywobo.com',
    });
  });

  it('reads a markdown link', () => {
    expect(parseInline('[the terms](/legal/terms)')).toEqual([
      { kind: 'link', text: 'the terms', href: '/legal/terms' },
    ]);
  });

  it('leaves an unclosed marker as text rather than swallowing the rest of the line', () => {
    expect(text(parseInline('a ** b ` c [ d'))).toBe('a ** b ` c [ d');
  });
});

describe('stripReviewTags', () => {
  it('removes the questions for counsel and counts them', () => {
    const out = stripReviewTags(
      'You can hold an account from 13. [REVIEW: confirm the age.] Next.',
    );
    expect(out.reviews).toBe(1);
    expect(out.text).toBe('You can hold an account from 13. Next.');
  });

  it('handles a tag that nests a bracketed blank', () => {
    const out = stripReviewTags('Kept. [REVIEW: whether [90 days] is right for a link.] Done.');
    expect(out.reviews).toBe(1);
    expect(out.text).toBe('Kept. Done.');
  });

  it('leaves a document with no tags exactly as it was', () => {
    expect(stripReviewTags('Nothing to review here.')).toEqual({
      text: 'Nothing to review here.',
      reviews: 0,
    });
  });
});

describe('parseBlocks', () => {
  const source = `# Terms of service

Draft of 3 September 2026. Version 0.1.

> **In plain words**
>
> The short version.

---

## 1. Who we are

We are [Company legal name].

- one rule
- another rule

| Plan | What you get |
|---|---|
| Free | a daily allowance |
| Plus | more of it |

1. first
2. second
`;

  const blocks = parseBlocks(source);

  it('reads every kind of block the set uses', () => {
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'quote',
      'rule',
      'heading',
      'paragraph',
      'list',
      'table',
      'list',
    ]);
  });

  it('gives every heading an anchor', () => {
    const headings = blocks.filter((b) => b.kind === 'heading');
    expect(headings.map((h) => (h.kind === 'heading' ? h.id : ''))).toEqual([
      'terms-of-service',
      '1-who-we-are',
    ]);
  });

  it('reads a table as a head row and body rows', () => {
    const table = blocks.find((b) => b.kind === 'table');
    expect(table?.kind === 'table' && table.head.map(text)).toEqual(['Plan', 'What you get']);
    expect(table?.kind === 'table' && table.rows.length).toBe(2);
  });

  it('tells an ordered list from a bulleted one', () => {
    const lists = blocks.filter((b) => b.kind === 'list');
    expect(lists.map((l) => (l.kind === 'list' ? l.ordered : null))).toEqual([false, true]);
  });

  it('reads the shape of the document', () => {
    const shape = documentShape(blocks, source);
    expect(shape.title).toBe('Terms of service');
    expect(shape.drafted).toBe('3 September 2026');
    expect(shape.version).toBe('0.1');
    expect(shape.contents.map((h) => h.text)).toEqual(['1. Who we are']);
    expect(shape.plainWords?.length).toBe(2);
  });

  it('reads a date as a date when the line goes on to name a file', () => {
    // docs/legal/README.md opens: "Draft of 3 September 2026, with `refund-and-cancellation.md`
    // revised on 7 September 2026 at version 0.3." Stopping at the first full stop stopped inside
    // "refund-and-cancellation.md", so /legal published "Drafted 3 September 2026, with
    // `refund-and-cancellation." — a broken sentence with a markdown backtick in it, frozen into
    // static HTML on an indexed page.
    const readme =
      '# The legal set\n\nDraft of 3 September 2026, with `refund-and-cancellation.md` revised on 7 September 2026 at version 0.3. Ten documents.\n';
    const shape = documentShape(parseBlocks(readme), readme);
    expect(shape.drafted).toBe('3 September 2026');
  });

  it('never lets markdown of any kind into a date a reader sees', () => {
    for (const line of [
      'Draft of 3 September 2026, with `a.md` revised later.',
      'Draft of 3 September 2026. Version 0.1.',
      'Draft of 3 September 2026; revised since.',
    ]) {
      expect(documentShape([], line).drafted).toBe('3 September 2026');
    }
  });

  it('starts the body after the front matter', () => {
    const body = documentBody(blocks);
    expect(body[0]?.kind).toBe('heading');
    expect(body.some((b) => b.kind === 'quote')).toBe(false);
  });

  it('drops the box its own label, so the page does not say it twice', () => {
    const shape = documentShape(blocks, source);
    expect(trimPlainWordsLabel(shape.plainWords ?? []).map(text)).toEqual(['The short version.']);
  });
});

describe('slugify', () => {
  it('makes a stable anchor', () => {
    expect(slugify('7. What we keep, and for how long')).toBe('7-what-we-keep-and-for-how-long');
  });

  it('never returns an empty anchor', () => {
    expect(slugify('—')).toBe('section');
  });
});
