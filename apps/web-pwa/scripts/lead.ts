/**
 * THE OPENING WORDS OF A PAGE, READ OFF THE PAGE'S OWN MARKUP.
 *
 * `scripts/prerender.ts` describes every address in a search result with the page's own opening
 * paragraphs (`describeFrom` in `src/shell/head.ts` joins and trims them). Which paragraphs those
 * are used to be decided inside `page.evaluate`, by a CSS selector nothing could test, and it was
 * wrong in a way that shipped: the quiet list named the bare tags `header` and `footer`, meant for
 * the site's own chrome, and every growth page opens with `<header class="gw-head">` holding the
 * `<h1>` and the page's lead paragraph. So the one paragraph written to describe that page was the
 * one paragraph skipped, and the description fell through to the standing line the whole family
 * shares. Four `/exams` pages and four `/compare` pages ended up with one description each, which
 * `checkPrerenderedPages` correctly failed the build over.
 *
 * The chrome is identified by what it actually is: `.st-header` and `.st-footer` (the site shell),
 * `.au-top` (the doors), `.st-note` (the draft notice a legal page carries, which describes the
 * state of the document rather than the document) and any `<nav>`. Everything else inside `<main>`
 * is the page.
 *
 * It reads the emitted markup as a string rather than a live DOM, so it runs in a test with no
 * browser, which is the whole reason the bug lived: nothing could read the rule.
 */

import { visibleText } from './prerender-check';

/** The site's own chrome and the notices that describe a document rather than say it. */
export const QUIET_CLASSES = ['st-note', 'st-header', 'st-footer', 'au-top'] as const;
/** Chrome by tag. `nav` is a list of links wherever it sits; the rest is the page. */
export const QUIET_TAGS = ['nav'] as const;
/** Chrome by tag when the page has no `<main>` to scope to, so the shell cannot be sliced off. */
export const OUTER_TAGS = ['header', 'footer'] as const;

/** What the page says, not what it labels: a paragraph or a standfirst. */
const LEAD_CLASS = 'st-sub';
const LEAD_TAG = 'p';

/** Shorter than this is a label or a caption, not an opening. */
export const LEAD_MIN_CHARS = 25;

/** The card's own label names the card. It is not what the card says. */
const LABELS = [/^in plain words\b/i];

const BLOCKS = /<(script|style|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function classesOf(attrs: string): string[] {
  const raw = attrs.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? '';
  return raw.split(/\s+/).filter(Boolean);
}

/** The `<main>` a page renders into, when it renders one. Everything outside it is the shell. */
export function mainOf(html: string): string {
  const open = html.match(/<main\b[^>]*>/i);
  if (!open) return html;
  const start = (open.index ?? 0) + open[0].length;
  const end = html.lastIndexOf('</main>');
  return end > start ? html.slice(start, end) : html.slice(start);
}

/**
 * The page's opening paragraphs, in the order the page says them, with the chrome left out.
 */
export function leadParagraphs(html: string): string[] {
  const cleaned = html.replace(BLOCKS, ' ').replace(COMMENTS, ' ');
  const scoped = mainOf(cleaned);
  const quietTags = new Set<string>([...QUIET_TAGS, ...(scoped === cleaned ? OUTER_TAGS : [])]);
  const quietClasses = new Set<string>(QUIET_CLASSES);

  const found: string[] = [];
  /** Every element still open, and whether it silences what is inside it. */
  const stack: { tag: string; quiet: boolean }[] = [];
  /** The element whose words are being collected, and where its content started. */
  let taking: { depth: number; from: number } | null = null;
  let quietDepth = 0;

  const tags = /<\/?([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g;
  for (let m = tags.exec(scoped); m; m = tags.exec(scoped)) {
    const tag = (m[1] as string).toLowerCase();
    const attrs = m[2] ?? '';
    const closing = (m[0] as string).startsWith('</');
    const selfClosing = m[3] === '/' || VOID_TAGS.has(tag);

    if (closing) {
      // Unwind to the matching open tag, so stray markup cannot leave the stack wedged.
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at < 0) continue;
      if (taking && taking.depth >= at) {
        const text = visibleText(scoped.slice(taking.from, m.index));
        if (text.length >= LEAD_MIN_CHARS && !LABELS.some((label) => label.test(text))) {
          found.push(text);
        }
        taking = null;
      }
      for (let i = stack.length - 1; i >= at; i -= 1) {
        if ((stack[i] as { quiet: boolean }).quiet) quietDepth -= 1;
      }
      stack.length = at;
      continue;
    }

    const classes = classesOf(attrs);
    const quiet = quietTags.has(tag) || classes.some((c) => quietClasses.has(c));
    if (selfClosing) continue;
    if (!taking && !quiet && quietDepth === 0) {
      if (tag === LEAD_TAG || classes.includes(LEAD_CLASS)) {
        taking = { depth: stack.length, from: m.index + (m[0] as string).length };
      }
    }
    if (quiet) quietDepth += 1;
    stack.push({ tag, quiet });
  }
  return found;
}
