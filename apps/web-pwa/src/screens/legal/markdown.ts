/**
 * The markdown the legal set is written in, parsed to blocks.
 *
 * `docs/legal/**` is reviewed copy: this module renders it, it never rewrites it. So the parser
 * covers exactly the constructs those ten documents use — headings, paragraphs, the "in plain
 * words" blockquote, bullet and numbered lists, tables, rules, bold, code spans and the bracketed
 * placeholders — and nothing else. A general markdown library would be a dependency, a bundle, and
 * a licence to render constructs nobody wrote.
 *
 * Two things the parser does that a generic one would not, both required by `docs/legal/README.md`:
 *
 *  · `[REVIEW: …]` tags are the questions for counsel, addressed to a lawyer and not to a learner.
 *    They are stripped from the rendered body and counted, so the page can say honestly how many
 *    open legal questions the document still carries instead of pretending it has none.
 *  · `[Company legal name]`, `[30 days]` and their kind are blanks that are not filled yet. They
 *    render as an explicit "not set yet" marker rather than as prose, because a reader must never
 *    mistake a placeholder for a term.
 *
 * Everything here is pure and unit-tested (`markdown.test.ts`); the React side is `Markdown.tsx`.
 */

// --- inline -------------------------------------------------------------------------------------

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  /** A bracketed blank in the source: a term that has not been decided yet. */
  | { kind: 'placeholder'; text: string };

/** An email address written as bare text, which is how every address in the legal set is written. */
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/** The index of the earliest inline construct in `src`, or -1. */
function nextMark(src: string): number {
  const marks = [src.indexOf('**'), src.indexOf('`'), src.indexOf('[')];
  const email = src.search(EMAIL);
  if (email >= 0) marks.push(email);
  const found = marks.filter((i) => i >= 0);
  return found.length ? Math.min(...found) : -1;
}

/** Push a run of plain text, merging with the previous text span so spans stay minimal. */
function pushText(out: Inline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.kind === 'text') last.text += text;
  else out.push({ kind: 'text', text });
}

/**
 * The spans of one line of prose. Unclosed markers (a lone `**`, an unbalanced `[`) are text, not
 * an error: reviewed copy is allowed to contain a stray bracket and it must still render.
 */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let src = source;
  while (src) {
    const at = nextMark(src);
    if (at < 0) {
      pushText(out, src);
      break;
    }
    pushText(out, src.slice(0, at));
    src = src.slice(at);

    if (src.startsWith('**')) {
      const end = src.indexOf('**', 2);
      if (end > 0) {
        out.push({ kind: 'strong', text: src.slice(2, end) });
        src = src.slice(end + 2);
        continue;
      }
    } else if (src.startsWith('`')) {
      const end = src.indexOf('`', 1);
      if (end > 0) {
        out.push({ kind: 'code', text: src.slice(1, end) });
        src = src.slice(end + 1);
        continue;
      }
    } else if (src.startsWith('[')) {
      const close = balancedClose(src, 0);
      if (close > 0) {
        const label = src.slice(1, close);
        const rest = src.slice(close + 1);
        const link = /^\(([^)\s]+)\)/.exec(rest);
        if (link?.[1]) {
          out.push({ kind: 'link', text: label, href: link[1] });
          src = rest.slice(link[0].length);
        } else {
          out.push({ kind: 'placeholder', text: label });
          src = rest;
        }
        continue;
      }
    } else {
      const email = EMAIL.exec(src);
      if (email && email.index === 0) {
        out.push({ kind: 'link', text: email[0], href: `mailto:${email[0]}` });
        src = src.slice(email[0].length);
        continue;
      }
    }
    // An unclosed marker: take one character as text and carry on.
    pushText(out, src.slice(0, 1));
    src = src.slice(1);
  }
  return out;
}

/** The index of the `]` closing the `[` at `open`, honouring one level of nesting, or -1. */
function balancedClose(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '[') depth += 1;
    else if (src[i] === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// --- the review tags ----------------------------------------------------------------------------

export interface Stripped {
  text: string;
  /** How many notes were removed. */
  reviews: number;
}

/**
 * Remove every bracketed editorial note whose opening bracket starts with one of `prefixes`, and
 * count them. Notes nest one level (`[REVIEW: … [90 days] …]`), so this scans for the balanced
 * close rather than the next `]`.
 */
export function stripNotes(source: string, prefixes: readonly string[]): Stripped {
  let text = '';
  let src = source;
  let reviews = 0;
  for (;;) {
    const marks = prefixes.map((p) => src.indexOf(p)).filter((i) => i >= 0);
    if (!marks.length) {
      text += src;
      break;
    }
    const at = Math.min(...marks);
    const close = balancedClose(src, at);
    if (close < 0) {
      text += src;
      break;
    }
    reviews += 1;
    // Leave no double space or orphaned space before a full stop where a note used to be.
    text += src.slice(0, at).replace(/[ \t]+$/, ' ');
    src = src.slice(close + 1).replace(/^[ \t]+/, ' ');
  }
  return { text: text.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' '), reviews };
}

/**
 * The questions for counsel: `[REVIEW: …]` tags, removed from what a learner reads and counted so
 * the page can say how many are still open (`docs/legal/README.md` §5).
 */
export function stripReviewTags(source: string): Stripped {
  return stripNotes(source, ['[REVIEW']);
}

/** Editorial notes in the reviewed copy — questions for counsel, and decisions left to the owner. */
export function stripEditorialNotes(source: string): Stripped {
  return stripNotes(source, ['[REVIEW', '[Owner:']);
}

// --- blocks -------------------------------------------------------------------------------------

export interface Heading {
  level: number;
  text: string;
  /** The anchor the table of contents links to. */
  id: string;
}

export type Block =
  | ({ kind: 'heading' } & Heading)
  | { kind: 'paragraph'; spans: Inline[] }
  | { kind: 'quote'; paragraphs: Inline[][] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' };

/** A heading's anchor: lowercase, words joined by hyphens, stable across edits to the prose. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

const TABLE_DIVIDER = /^\|?[\s:|-]+\|[\s:|-]*$/;

/** The cells of one table row, without the leading and trailing pipe. */
function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

/**
 * Parse a whole document. Review tags are stripped first, so a tag can never leak into a heading,
 * a table cell or the plain-words box.
 */
export function parseBlocks(source: string): Block[] {
  const { text } = stripReviewTags(source);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  const seen = new Map<string, number>();
  let i = 0;

  const anchor = (label: string): string => {
    const base = slugify(label);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      const label = heading[2].trim();
      blocks.push({ kind: 'heading', level: heading[1].length, text: label, id: anchor(label) });
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    if (line.startsWith('>')) {
      const paragraphs: Inline[][] = [];
      let buffer: string[] = [];
      const flush = () => {
        if (buffer.length) paragraphs.push(parseInline(buffer.join(' ')));
        buffer = [];
      };
      while (i < lines.length && (lines[i] as string).startsWith('>')) {
        const body = (lines[i] as string).replace(/^>\s?/, '').trim();
        if (body) buffer.push(body);
        else flush();
        i += 1;
      }
      flush();
      blocks.push({ kind: 'quote', paragraphs });
      continue;
    }

    if (line.trim().startsWith('|')) {
      const rowLines: string[] = [];
      while (i < lines.length && (lines[i] as string).trim().startsWith('|')) {
        rowLines.push(lines[i] as string);
        i += 1;
      }
      const [first, second, ...rest] = rowLines;
      if (first && second && TABLE_DIVIDER.test(second.trim())) {
        blocks.push({
          kind: 'table',
          head: cells(first).map(parseInline),
          rows: rest.map((r) => cells(r).map(parseInline)),
        });
      } else {
        for (const r of rowLines) blocks.push({ kind: 'paragraph', spans: parseInline(r) });
      }
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !bullet;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] as string;
        const match = ordered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(current)
          : /^\s*[-*]\s+(.*)$/.exec(current);
        if (match?.[1] !== undefined) {
          items.push(match[1]);
          i += 1;
          continue;
        }
        // A wrapped continuation line belongs to the item above it.
        if (current.trim() && /^\s{2,}\S/.test(current) && items.length) {
          items[items.length - 1] += ` ${current.trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: 'list', ordered, items: items.map(parseInline) });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i] as string;
      if (
        !current.trim() ||
        current.startsWith('#') ||
        current.startsWith('>') ||
        current.trim().startsWith('|') ||
        /^\s*([-*]|\d+[.)])\s+/.test(current) ||
        /^(-{3,}|\*{3,}|_{3,})\s*$/.test(current.trim())
      ) {
        break;
      }
      paragraph.push(current.trim());
      i += 1;
    }
    blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join(' ')) });
  }

  return blocks;
}

// --- what a document is about --------------------------------------------------------------------

export interface DocumentShape {
  /** The `# ` heading, or null where the document has none. */
  title: string | null;
  /** The `## ` headings, which are what the table of contents offers. */
  contents: Heading[];
  /** The "in plain words" box: the first blockquote, which every document in the set opens with. */
  plainWords: Inline[][] | null;
  /** The date the document was drafted, as written ("3 September 2026"), or null. */
  drafted: string | null;
  /** The version stated under the title, or null. */
  version: string | null;
}

/**
 * THE DATE, AND ONLY THE DATE.
 *
 * This used to be `/Draft of ([^.]+)\./`, and `docs/legal/README.md` opens "Draft of 3 September
 * 2026, with `refund-and-cancellation.md` revised on 7 September 2026 at version 0.3." — so the
 * capture ran on to the full stop INSIDE the filename and `/legal` published "Drafted 3 September
 * 2026, with `refund-and-cancellation.", a broken sentence carrying the only stray markdown
 * backtick in visible text anywhere on the site, on a page a crawler indexes. A date ends at the
 * first stop of any kind, so that is where the capture ends.
 */
const DRAFTED = /Draft of ([^.,;]+)/;
const VERSION = /Version (\d+(?:\.\d+)*)/;

/** Read the shape of a parsed document: its title, its sections, its summary box and its date. */
export function documentShape(blocks: Block[], source: string): DocumentShape {
  const title = blocks.find((b) => b.kind === 'heading' && b.level === 1);
  const quote = blocks.find((b) => b.kind === 'quote');
  return {
    title: title?.kind === 'heading' ? title.text : null,
    contents: blocks.filter(
      (b): b is Extract<Block, { kind: 'heading' }> => b.kind === 'heading' && b.level === 2,
    ),
    plainWords: quote?.kind === 'quote' ? quote.paragraphs : null,
    drafted: DRAFTED.exec(source)?.[1]?.trim() ?? null,
    version: VERSION.exec(source)?.[1]?.trim() ?? null,
  };
}

/**
 * The body of a document: everything after the front matter.
 *
 * Every document in the set opens the same way — the title, a line saying when it was drafted and
 * that no lawyer has read it yet, the "in plain words" box, then a rule. The page shows those three
 * as its own header, meta line and summary card, so the body starts after the rule. Where a
 * document does not have that shape, the title, the first paragraph and the summary box are dropped
 * individually and nothing else is lost.
 */
export function documentBody(blocks: readonly Block[]): Block[] {
  const rule = blocks.findIndex((b) => b.kind === 'rule');
  const quote = blocks.findIndex((b) => b.kind === 'quote');
  if (rule >= 0 && (quote < 0 || quote < rule)) return blocks.slice(rule + 1);
  let dropParagraph = true;
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.kind === 'heading' && block.level === 1) continue;
    if (block.kind === 'quote' && out.length === 0) continue;
    if (dropParagraph && block.kind === 'paragraph') {
      dropParagraph = false;
      continue;
    }
    out.push(block);
  }
  return out;
}

/**
 * The plain-words box without its own heading. Every document opens the box with a bold
 * "In plain words" line, and the page draws that label itself, so rendering both would say it twice.
 */
export function trimPlainWordsLabel(paragraphs: readonly Inline[][]): Inline[][] {
  const first = paragraphs[0];
  const isLabel =
    first?.length === 1 &&
    first[0]?.kind === 'strong' &&
    /^in plain words$/i.test(first[0].text.trim());
  return (isLabel ? paragraphs.slice(1) : paragraphs).map((p) => [...p]);
}
