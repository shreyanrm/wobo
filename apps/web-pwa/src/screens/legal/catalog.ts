/**
 * The addresses of the legal set, and the index rows, derived from the documents themselves.
 *
 * Nothing here restates the copy. The slugs come from the filenames in `docs/legal/`, and the
 * one-line description of each document is read out of the table in `docs/legal/README.md` rather
 * than written again here — so a change to that table changes this index, and the two can never
 * drift apart.
 *
 * Pure and unit-tested; the file loading lives in `docs.ts`, which is the only Vite-specific module
 * in this folder.
 */

import type { Block, Inline } from './markdown';

/**
 * THE OLD SHORT ADDRESSES, each mapped to the document's own slug.
 *
 * These were once what the footer linked, and that was the bug: `/legal/terms` and
 * `/legal/terms-of-service` both answered 200 with the same 2,610 words and each declared ITSELF
 * the original, so the site's links and the site's sitemap pointed at two different addresses for
 * one document (docs/GROWTH-SEARCH.md §2). The address of record is now the document's own
 * filename, which is what `public/sitemap.xml` publishes; every entry below is a nickname that
 * resolves to it (`pathToRoute`) and 301s to it at the edge (`vercel.json`). Nothing in the
 * product links one any more, and `test/addresses.test.ts` keeps it that way — but they are kept
 * forever, because an address that was once published is a link somebody still holds.
 */
export const SLUG_ALIASES: Readonly<Record<string, string>> = {
  terms: 'terms-of-service',
  privacy: 'privacy-policy',
  safety: 'safety-and-content',
  refunds: 'refund-and-cancellation',
  accessibility: 'accessibility-statement',
  children: 'childrens-privacy',
  consent: 'parental-consent',
  community: 'community-and-flags',
  use: 'acceptable-use',
};

/** The slug a document file is addressed by: `docs/legal/cookies.md` → `cookies`. */
export function slugOfFile(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

/** Resolve an address a link may use to the document's own slug. */
export function canonicalSlug(slug: string): string {
  const clean = slug.trim().toLowerCase();
  return SLUG_ALIASES[clean] ?? clean;
}

/** The path a legal page lives at. */
export function legalPath(slug?: string): string {
  return slug ? `/legal/${slug}` : '/legal';
}

/**
 * A cross-reference in the prose — the documents refer to each other as `` `cookies.md` `` — turned
 * into the address that document lives at here, or null where the code span is not one of ours.
 */
export function crossReference(code: string, known: readonly string[]): string | null {
  if (!code.endsWith('.md')) return null;
  const slug = slugOfFile(code);
  return known.includes(slug) ? legalPath(slug) : null;
}

export interface IndexRow {
  slug: string;
  /** The file, exactly as `README.md` names it. */
  file: string;
  /** "what it is", from the README's table. */
  what: Inline[];
  /** "who reads it", from the README's table. */
  who: Inline[];
}

/** The flat text of a run of spans — used to read a filename out of a table cell. */
export function spansText(spans: readonly Inline[]): string {
  return spans.map((s) => s.text).join('');
}

/**
 * The index, read out of the first three-column table in `README.md`. Rows naming a file we do not
 * hold are dropped rather than rendered as a dead link.
 */
export function indexRows(readme: readonly Block[], known: readonly string[]): IndexRow[] {
  const table = readme.find(
    (b): b is Extract<Block, { kind: 'table' }> => b.kind === 'table' && b.head.length >= 3,
  );
  if (!table) return [];
  const rows: IndexRow[] = [];
  for (const row of table.rows) {
    const file = spansText(row[0] ?? []).trim();
    const slug = slugOfFile(file);
    if (!file.endsWith('.md') || !known.includes(slug)) continue;
    rows.push({ slug, file, what: row[1] ?? [], who: row[2] ?? [] });
  }
  return rows;
}

/** Every mailbox named across the documents, deduplicated, in the order a reader meets them. */
export function mailboxes(sources: readonly string[]): string[] {
  const found: string[] = [];
  for (const source of sources) {
    for (const match of source.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
      const address = match[0].toLowerCase();
      if (!found.includes(address)) found.push(address);
    }
  }
  return found;
}
