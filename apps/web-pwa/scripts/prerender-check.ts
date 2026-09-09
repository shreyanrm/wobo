/**
 * WHAT A PRE-RENDERED PAGE HAS TO BE, checked on the emitted file rather than on the intention.
 *
 * Two callers run exactly these rules, which is the point of them living in one place:
 *
 *   · `scripts/prerender.ts`, at the end of the build, which FAILS THE BUILD on any violation, so
 *     a page that says nothing can never be deployed;
 *   · `test/prerender.test.ts`, over whatever is in `dist`, which reads each file the way a crawler
 *     that does not run JavaScript reads it: off disk, tags and all, with nothing executed.
 *
 * The rules come from what was actually wrong (docs/GROWTH-SEARCH.md §2): 61 addresses returning
 * one wordless shell, every one of them claiming to be the home page, and every share of any of
 * them previewing as the home page.
 */

/** A page a reader has to be able to READ, not a stub with a heading. */
export const WORD_FLOOR = 100;

/**
 * The one address below the floor, and it is named rather than waived.
 *
 * `/sign-in` is a form: a heading, one line saying why, a phone field and two provider buttons.
 * It is the ONLY page in the sitemap under the 100-word floor, and it carries 4 internal links
 * against a median of 37. How many words it actually renders is not written down here any more:
 * the comment said 70 and a reading of the built file said 86, because a number typed in a comment
 * drifts the moment the copy does. `test/prerender.test.ts` reads the count out of the build's own
 * manifest instead, and fails if a waived page has since cleared the floor (the waiver should then
 * go) or fallen under the number waived for it. It is in the sitemap because "wobo login" is one
 * of the qualified
 * queries the entity work has to win (docs/GROWTH-ENTITY.md §1), so it must be readable and
 * indexable, but padding a door with prose to clear a number would be writing for the checker.
 * The honest fix is the footer the site shell gives every other page, which the two doors do not
 * wear; until that lands, the floor for this one address is its real content.
 */
/**
 * A DOOR IS NOT AN ARTICLE. This address is a way in rather than something to read, and a floor
 * written for a page that has to earn a search result would push words onto a control.
 *
 * `/sign-up` was waived beside it on 2026-09-09 and no longer needs to be. It carries the
 * invitation while new accounts are closed, and once that panel also carried the path out of it
 * for a reader with nothing running it cleared the floor on its own words. A waiver a page has
 * grown out of is a waiver that hides the next page to fall below it.
 */
export const THIN_PAGES: Readonly<Record<string, number>> = { '/sign-in': 60 };

/** A description shorter than this is a label, not something a search result can show. */
export const DESCRIPTION_FLOOR = 50;

export interface PageFile {
  /** The address this file answers at, e.g. `/about`. */
  path: string;
  /** Where it was written, relative to `dist`, e.g. `about/index.html`. */
  file: string;
  /** The file's bytes, exactly as a crawler with no JavaScript would receive them. */
  html: string;
}

export interface Violation {
  path: string;
  what: string;
}

const VOID_TEXT = /<(script|style|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** What a reader sees: the markup with everything that is not words taken out. */
export function visibleText(html: string): string {
  return (
    html
      .replace(VOID_TEXT, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
      .replace(/\s+/g, ' ')
      // A tag becomes a space so two blocks never run together, but a browser puts no space between
      // an inline element and the full stop after it, so neither does this.
      .replace(/\s+([.,;:!?%)\]])/g, '$1')
      .trim()
  );
}

/** The body of the page, which is what a crawler counts. The head is not reading matter. */
export function bodyHtml(html: string): string {
  return html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
}

export function firstHeading(html: string): string {
  const raw = bodyHtml(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return raw ? visibleText(raw) : '';
}

export function titleOf(html: string): string {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return raw ? visibleText(raw) : '';
}

export function linkHref(html: string, rel: string): string | null {
  const re = new RegExp(`<link\\b[^>]*\\brel=["']${rel}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag?.match(/\bhref=["']([^"']*)["']/i)?.[1] ?? null;
}

/** One meta tag's content, by `name` or by `property`. */
export function metaContent(html: string, key: string): string | null {
  const re = new RegExp(`<meta\\b[^>]*\\b(?:name|property)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const raw = tag?.match(/\bcontent=["']([^"']*)["']/i)?.[1];
  return raw === undefined ? null : visibleText(raw);
}

export function wordCount(html: string): number {
  const text = visibleText(bodyHtml(html));
  return text ? text.split(' ').filter(Boolean).length : 0;
}

function floorFor(path: string): number {
  return THIN_PAGES[path] ?? WORD_FLOOR;
}

/** The address this file should declare, absolute. */
export function expectedCanonical(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, '')}${path}`;
}

/**
 * Every rule, over every emitted page. Returns what is wrong, empty when nothing is.
 *
 * The uniqueness rules are the ones the old shell failed hardest: one title, one description and
 * one canonical for the entire site. They are checked across the whole set, not per page, because
 * that is the only way a duplicate can be seen at all.
 */
/**
 * THE INVITATION'S FORM IS A TRAP FOR A READER WITH NOTHING RUNNING, UNLESS THE PAGE SAYS SO.
 *
 * It posts JSON, from JavaScript, to another hostname. A NATIVE submit of the same form is
 * form-encoded and cross-origin: the list answers 422, and the browser navigates there, so a
 * reader with JavaScript off lands on a raw error page on a host that is not ours with no header,
 * no footer and no way back. The panel therefore carries a `noscript` block that hides the form
 * and puts one address in its place, and this is what proves the block survived the build: React
 * renders it into a live DOM, and a `noscript` element's children do not come back out of
 * `innerHTML` on their own.
 */
export const INVITATION_FORM = 'jl-form';

/** Does this file hand a reader with nothing running a path that is not the form? */
export function hasNoScriptPath(html: string): boolean {
  if (!new RegExp(`class="[^"]*\\b${INVITATION_FORM}\\b`).test(html)) return true;
  const hides = new RegExp(`\\.${INVITATION_FORM}\\s*\\{[^}]*display\\s*:\\s*none`);
  for (const found of html.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)) {
    const inside = found[1] ?? '';
    if (hides.test(inside) && inside.includes('mailto:')) return true;
  }
  return false;
}

export function checkPrerenderedPages(pages: readonly PageFile[], origin: string): Violation[] {
  const bad: Violation[] = [];
  const titles = new Map<string, string[]>();
  const descriptions = new Map<string, string[]>();

  for (const page of pages) {
    const say = (what: string) => bad.push({ path: page.path, what });
    const html = page.html;

    const h1 = firstHeading(html);
    if (!h1) say('has no <h1> a reader with JavaScript off would see');

    const words = wordCount(html);
    if (words < floorFor(page.path)) {
      say(`reads ${words} words with JavaScript off, under the floor of ${floorFor(page.path)}`);
    }

    const canonical = linkHref(html, 'canonical');
    const want = expectedCanonical(origin, page.path);
    if (!canonical) say('declares no canonical');
    else if (canonical !== want) say(`points its canonical at ${canonical}, not at ${want}`);

    const title = titleOf(html);
    if (!title) say('has no title');
    else titles.set(title, [...(titles.get(title) ?? []), page.path]);

    const description = metaContent(html, 'description');
    if (!description) say('has no meta description');
    else if (description.length < DESCRIPTION_FLOOR) {
      say(`describes itself in ${description.length} characters, under ${DESCRIPTION_FLOOR}`);
    } else descriptions.set(description, [...(descriptions.get(description) ?? []), page.path]);

    // Nothing a person reads carries an em dash (docs/copy/voice.md), and these two lines are the
    // most-read copy the product has: the search result and the share card.
    for (const [what, value] of [
      ['title', title],
      ['description', description ?? ''],
    ] as const) {
      if (value.includes('—')) say(`carries an em dash in its ${what}`);
    }

    const social: [string, string | null][] = [
      ['og:title', title],
      ['og:description', description],
      ['og:url', canonical],
      ['twitter:title', title],
      ['twitter:description', description],
    ];
    for (const [key, expected] of social) {
      const got = metaContent(html, key);
      if (!got) say(`carries no ${key}`);
      else if (expected && got !== expected) say(`${key} says "${got}" and not what the page says`);
    }
    if (!metaContent(html, 'og:site_name')) say('carries no og:site_name');
    if (!metaContent(html, 'og:locale')) say('carries no og:locale');
    if (metaContent(html, 'twitter:card') !== 'summary_large_image') {
      say('does not ask for a large share card');
    }
    const image = metaContent(html, 'og:image');
    if (!image) say('carries no og:image');
    else if (!/^https?:\/\//i.test(image)) say(`names a relative og:image (${image})`);
    if (metaContent(html, 'twitter:image') !== image)
      say('shows a different image on each network');
    if (metaContent(html, 'robots') === 'noindex') say('asks not to be indexed');

    if (!hasNoScriptPath(html)) {
      say(
        'carries the invitation form with no path for a reader who has JavaScript off: ' +
          'pressing it natively throws them onto another hostname with no way back',
      );
    }
  }

  for (const [title, paths] of titles) {
    if (paths.length > 1) {
      for (const path of paths)
        bad.push({
          path,
          what: `shares the title "${title}" with ${paths.filter((p) => p !== path).join(', ')}`,
        });
    }
  }
  for (const [, paths] of descriptions) {
    if (paths.length > 1) {
      for (const path of paths)
        bad.push({
          path,
          what: `shares its description with ${paths.filter((p) => p !== path).join(', ')}`,
        });
    }
  }
  return bad;
}

/** Two addresses declaring one address of record: the failure the whole audit turned on. */
export function sharedCanonicals(pages: readonly PageFile[]): Violation[] {
  const byCanonical = new Map<string, string[]>();
  for (const page of pages) {
    const canonical = linkHref(page.html, 'canonical');
    if (!canonical) continue;
    byCanonical.set(canonical, [...(byCanonical.get(canonical) ?? []), page.path]);
  }
  const bad: Violation[] = [];
  for (const [canonical, paths] of byCanonical) {
    if (paths.length > 1) {
      for (const path of paths) {
        bad.push({
          path,
          what: `claims ${canonical}, which ${paths.filter((p) => p !== path).join(', ')} also claims`,
        });
      }
    }
  }
  return bad;
}

/** The violations as the lines a build log should print. */
export function reportViolations(bad: readonly Violation[]): string {
  return bad.map((v) => `  ${v.path} ${v.what}`).join('\n');
}
