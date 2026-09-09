/**
 * THE QUALITY GATE every generated public page has to clear before it is published.
 *
 * Google's own rule is that producing many pages "without adding value for users" is spam, and a
 * page family built from a syllabus is exactly the shape that goes wrong: three hundred addresses,
 * one template, a name swapped in each. The difference between a family that ranks and a family
 * that is penalised is not the template. It is whether each page has something on it.
 *
 * So a page in these families does not exist because an address could be computed for it. It
 * exists because it passes here, and the counts we publish anywhere are the counts of pages that
 * passed (docs/WOBO-TASKS §10.21, the honest-count law).
 *
 * WHAT COUNTS AS VALUE, and it is not our opinion — it is the three things no competitor in this
 * market ships (docs/GROWTH-SEARCH.md §1 and §3):
 *
 *   1. PROVENANCE   the official document a line came from, the page or section inside it, the
 *                   hash of the bytes we read and the day we read them. Nobody else publishes it,
 *                   and one incumbent's chapter pages are three years stale precisely because they
 *                   cannot.
 *   2. THE DRAWN EXPLANATION   the figure generated for this concept. Not one competitor page in
 *                   the audit carried an original explanatory figure. It arrives with the concept
 *                   cores, so at tier one this is false everywhere and the pages say so rather
 *                   than implying otherwise.
 *   3. THE TUTOR DOOR   a real box that answers a question about this exact thing, grounded in the
 *                   syllabus, open with no account.
 *
 * A page carrying none of the three does not ship. A page below the word floor does not ship
 * either, however well sourced, because a reader who arrives from a search needs something to
 * read.
 *
 * THE WORD COUNT COUNTS THE PAGE'S OWN WORDS AND NOTHING ELSE, and that qualification is the
 * difference between a gate and a decoration. Every page in a family wears the same furniture: a
 * standing note, three section leads, an ask heading. Count those and a page with no content at
 * all clears a floor of two hundred words on boilerplate alone, which is exactly the failure this
 * gate exists to catch. So each family hands `words()` only the strings that came from its own
 * DATA — the rows, the documents, the counts, the lead built from them — and the shared furniture
 * is rendered but never counted. `no two pages share their counted copy` is a test in every family,
 * which is what stops the furniture creeping back in.
 *
 * A FAMILY'S INDEX IS THE EXCEPTION, and for the reason the rule was written rather than despite
 * it: copy is excluded because it is SHARED WITH SIBLING PAGES, and an index has no siblings. Its
 * opening and its standing note are written for it and appear nowhere else, so they are its own
 * words and they count.
 *
 * The gate is a pure function over data. Every family calls it from its own module and from its
 * own test, and the sitemap is built from what it returns.
 */

/**
 * The floor, in words a reader reads.
 *
 * Deliberately not a big number. A thin page is not a short page: a page that says four true,
 * sourced things in a hundred and forty words is worth more than nine hundred words of padding,
 * and a floor set high enough to feel impressive is a floor that invites the padding. This is the
 * level below which there is genuinely nothing on the page — a heading, a name and a link.
 */
export const WORD_FLOOR = 140;

/** What a page has to show for itself. Every field is measured, never declared. */
export interface Evidence {
  /**
   * Sourced facts on the page: each one names the document or page it came from, and the day we
   * read it. A fact with no source is not counted, which is the whole point of counting.
   */
  sources: number;
  /** A drawn explanation generated for this page's subject. False at tier one, everywhere. */
  drawn: boolean;
  /** A tutor door on the page that can answer about this page's subject. */
  door: boolean;
  /** The words the page actually renders, from `words()`. */
  words: number;
}

/** The verdict, and when it is no, every reason it is no. */
export interface Verdict {
  publishable: boolean;
  /** Empty when it passes. Plain sentences, because they end up in a test's failure message. */
  because: string[];
}

/**
 * Count the words a reader reads.
 *
 * Anything falsy is skipped so a caller can pass an optional line without guarding it, and a
 * nested array is flattened so a page can hand over a section at a time. Numbers are counted as
 * the words they are printed as. Nothing here strips markup, because none of these pages have
 * any: the copy is plain strings all the way down.
 */
export type Words = string | number | null | undefined | false | readonly Words[];

export function words(...parts: readonly Words[]): number {
  let n = 0;
  for (const part of parts) {
    if (part === null || part === undefined || part === false) continue;
    if (Array.isArray(part)) {
      n += words(...(part as readonly Words[]));
      continue;
    }
    n += String(part)
      .split(/\s+/)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  }
  return n;
}

/** Does this page have enough on it to be published? */
export function gate(evidence: Evidence): Verdict {
  const because: string[] = [];
  if (evidence.words < WORD_FLOOR) {
    because.push(`only ${evidence.words} words, and the floor is ${WORD_FLOOR}`);
  }
  if (evidence.sources < 1 && !evidence.drawn && !evidence.door) {
    because.push('no provenance, no drawn explanation and no tutor door');
  }
  return { publishable: because.length === 0, because };
}

/**
 * A hash, as a page prints it: the first twelve characters, which is enough for a reader to match
 * one document against another and short enough to sit in a line of prose. The full value stays in
 * the data, so anyone who wants to check the bytes still can.
 */
export function shortHash(sha256: string): string {
  return sha256.trim().slice(0, 12);
}

/**
 * A day, as a page prints it: "3 September 2026". No time, no zone, no relative phrasing — a
 * reader wants to know how old this is, and "2 days ago" stops being true the moment it is cached.
 *
 * An unparseable value returns an empty string rather than "Invalid Date", and every caller treats
 * an empty date as a missing one, so a broken timestamp fails the gate instead of printing.
 */
export function onDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(at);
}

/** The most recent of a set of days, as an ISO string. Empty when none of them parse. */
export function latest(isos: readonly string[]): string {
  let best = '';
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const iso of isos) {
    const at = new Date(iso).getTime();
    if (!Number.isNaN(at) && at > bestAt) {
      bestAt = at;
      best = iso;
    }
  }
  return best;
}

/**
 * Is this a date we may print as "last checked"?
 *
 * A checked date has to parse, and it has to be in the past. A date in the future is not a typo to
 * be rendered — it is a claim that we checked something we have not, and it fails the gate.
 * `now` is a parameter so a test can hold the clock still.
 */
export function checkedDay(iso: string, now: Date = new Date()): boolean {
  const at = new Date(iso).getTime();
  return !Number.isNaN(at) && at <= now.getTime();
}

/** The host of a URL, lowercased, or empty where it is not a URL we can read. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Is `url` on one of `hosts`, or on a subdomain of one?
 *
 * The exam pages link only to a board's own site and the comparison pages only to a source they
 * name, so "is this link where it says it is" is a gate rather than a review note. A bare suffix
 * match would let `notcbse.gov.in` through, so the boundary has to be a dot.
 */
export function onHost(url: string, hosts: readonly string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return hosts.some((h) => {
    const allowed = h.toLowerCase();
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}
