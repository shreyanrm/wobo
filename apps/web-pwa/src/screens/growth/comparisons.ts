/**
 * /compare/<slug> — what each product is, side by side, sourced and dated.
 *
 * WHY THIS FAMILY EXISTS. A parent deciding where the money goes searches the name of a product
 * and the word that means "is this real". What comes back is either the company's own page or a
 * review farm paid by whoever pays. Nobody in this market publishes a plain, dated, sourced
 * statement of what each thing is and what it costs, and a page that does is useful to a person
 * whether or not they choose us.
 *
 * THE LAW ON THIS FAMILY, AND IT IS NARROWER THAN IT LOOKS. docs/SELL.md §2 is a standing owner
 * ruling: we never sell by running anything down, and there is no price comparison. docs/CLAIMS.md
 * governs every superlative.
 *
 * TWO THINGS CAME OFF THESE PAGES BECAUSE OF THAT RULING, and both had shipped.
 *
 *   THE PRICE ROW. "Not a price comparison" is the ruling's own words, and a row headed "What it
 *   costs" with two products in it is a price comparison however carefully the prose around it is
 *   written. Our price belongs on our own plans page, in full, which is where the close on this
 *   page sends a reader.
 *
 *   A ROW WITH AN ABSENCE ON ONE SIDE. Three of the four cells for one product read "Not on the
 *   page we read" opposite a fully detailed cell of ours naming the amount, the hash, the page and
 *   the date. Each half of that is true and the pair of them is adverse by selection: a reader
 *   sees a blank beside a paragraph and draws the conclusion the page carefully refuses to draw.
 *   No home page lists everything, so an absence there is a fact about a page rather than about a
 *   product, and it is not a comparison. A row now reaches a page only when BOTH sides say
 *   something.
 *
 * So this page does the one thing the ruling allows:
 *
 *   IT REPORTS. Each cell is a fact, with the page it was read off and the day it was read. A
 *   product's own words about itself are quoted and attributed. Our own row is stated in the same
 *   voice as everyone else's and gets no adjective the others do not get.
 *
 *   IT NEVER COMPARES. Not one sentence on the page says one thing is better, cheaper, faster,
 *   simpler or more anything than another. The prices sit in a row because a parent asked what
 *   each costs, and the page draws no conclusion from them. `comparisons.test.ts` fails the build on a
 *   comparative or a superlative anywhere in this file, which is what stops the drift that always
 *   happens next: a table becomes a verdict one adjective at a time.
 *
 *   IT NEVER JUDGES QUALITY. Never that a product teaches badly, never that its content is stale,
 *   never a word about a company's finances or its troubles. Those are not our facts to publish
 *   and a parent who reads one thinks less of us, not of them.
 *
 * WHY THESE THREE AND NOT A PAGE PER COMPETITOR. A comparison needs two things a person can
 * actually go and look at. Where a product's site did not answer on the day we checked, there is
 * no page: a page whose content is somebody else's trouble is not a comparison, it is a comment,
 * and it is exactly what "never sell by running anything down" means.
 *
 * EVERY FACT BELOW WAS READ ON THE DAY ITS `checked` SAYS, off the URL its `source` names. When a
 * product changes, the row changes or the row comes off. There is no third option, and
 * `STANDING_NOTE` says so on the page.
 */

import type { Evidence, Verdict } from './gate';
import { checkedDay, gate, hostOf, onDay, onHost, words } from './gate';

// --- the shape of a fact --------------------------------------------------------------------------

/** Where a fact was read. The page prints the title and links the URL. */
export interface Source {
  /** What the page calls itself, or what it is. Never a characterisation of it. */
  title: string;
  url: string;
}

/**
 * One cell. `value` is either a quotation from the source, marked as one, or a plain statement of
 * what the source does and does not say. Never an inference, never an adjective.
 */
export interface Fact {
  value: string;
  /** True where `value` is the source's own words, so the page can show them as a quotation. */
  quoted?: boolean;
  source: Source;
  /** The day a person opened the source and read this off it. */
  checked: string;
}

/**
 * The questions a parent asks, in the order they ask them.
 *
 * "What it costs" was here and came off: docs/SELL.md §2 is a standing owner ruling that we do not
 * publish a price comparison, and a row with two products' prices in it is one whatever the prose
 * around it says. What each product costs is on its own site, and ours is on `/plans`.
 */
export const ROWS = ['what', 'how', 'syllabus'] as const;
export type RowKey = (typeof ROWS)[number];

export const ROW_LABELS: Readonly<Record<RowKey, string>> = {
  what: 'What it is, in its own words',
  how: 'How an answer reaches the learner',
  syllabus: 'Where the syllabus it teaches came from',
};

export interface Product {
  name: string;
  /** The address of the product's own site, for the reader who wants to go and look. */
  site: string;
  facts: Readonly<Record<RowKey, Fact>>;
}

export interface Comparison {
  /** The address. It carries the words people type, which is "vs". */
  slug: string;
  /** The other product. Ours is always the first column and is never listed here. */
  other: Product;
}

// --- what we say about ourselves, in the same form as everyone else -------------------------------

const WOBO_SITE: Source = { title: 'heywobo.com', url: 'https://heywobo.com/' };
const OUR_EXAMS: Source = {
  title: 'Wobo, the syllabus from the board',
  url: 'https://heywobo.com/exams',
};

/** The day our own four rows were last read off our own pages. */
const OURS_CHECKED = '2026-09-09';

/**
 * Our own column, stated in the same voice as everybody else's and with no adjective the others do
 * not get. It carries no price: the price row came off the family (see the note at the top), and
 * what Wobo costs is on the plans page, in full, which is where this page's close sends a reader.
 */
export function ourColumn(): Product {
  return {
    name: 'Wobo',
    site: 'https://heywobo.com/',
    facts: {
      what: {
        value:
          'A tutor that draws the answer as it works, films it, speaks it, and gives you something to drag.',
        source: WOBO_SITE,
        checked: OURS_CHECKED,
      },
      how: {
        value:
          'Generated for the learner asking, on a board, line by line, and re-taught a different way when a miss repeats.',
        source: WOBO_SITE,
        checked: OURS_CHECKED,
      },
      syllabus: {
        value:
          'From the board, named: every chapter carries the official document, the page inside it, the hash of the bytes and the day we read them.',
        source: OUR_EXAMS,
        checked: OURS_CHECKED,
      },
    },
  };
}

/** The line every comparison page carries above the table. */
export const STANDING_NOTE =
  'Every line here is what a page said on the day we opened it, with the link beside it so you ' +
  'can read the same page yourself. Nothing here is a judgement about anyone: what each product ' +
  'does is on the record, and you are the one deciding. A product changes often, so if a line ' +
  'here is no longer true, tell us and it is checked again or it comes off.';

// --- the comparisons we publish -------------------------------------------------------------------

/**
 * The honest answer where a page does not say. It is a statement about a page, never about a
 * company: the source beside it names exactly which page was read, and the reader can open it.
 */
export const NOT_ON_THE_PAGE = 'Not on the page we read.';

export const COMPARISONS: readonly Comparison[] = [
  {
    slug: 'wobo-vs-vedantu',
    other: {
      name: 'Vedantu',
      site: 'https://www.vedantu.com/',
      facts: {
        what: {
          value: 'Online Classes and Offline Centers for Competitive Exams',
          quoted: true,
          source: { title: 'vedantu.com, the home page', url: 'https://www.vedantu.com/' },
          checked: '2026-09-09',
        },
        how: {
          value:
            'Tutoring described on the home page as one teacher and one student, with offline centres alongside the online classes.',
          source: { title: 'vedantu.com, the home page', url: 'https://www.vedantu.com/' },
          checked: '2026-09-09',
        },
        syllabus: {
          value: NOT_ON_THE_PAGE,
          source: { title: 'vedantu.com, the home page', url: 'https://www.vedantu.com/' },
          checked: '2026-09-09',
        },
      },
    },
  },
  {
    slug: 'wobo-vs-physics-wallah',
    other: {
      name: 'Physics Wallah',
      site: 'https://www.pw.live/',
      facts: {
        what: {
          value:
            'an Indian edtech platform that provides accessible & comprehensive learning experiences to students',
          quoted: true,
          source: { title: 'pw.live, the home page', url: 'https://www.pw.live/' },
          checked: '2026-09-09',
        },
        how: {
          value:
            'Live classes, study material and exam preparation, sold as named batches and listed by category on the home page.',
          source: { title: 'pw.live, the home page', url: 'https://www.pw.live/' },
          checked: '2026-09-09',
        },
        syllabus: {
          value: NOT_ON_THE_PAGE,
          source: { title: 'pw.live, the home page', url: 'https://www.pw.live/' },
          checked: '2026-09-09',
        },
      },
    },
  },
  {
    slug: 'wobo-vs-byjus',
    other: {
      name: "Byju's",
      site: 'https://byjus.com/',
      facts: {
        what: {
          value:
            'A learning platform whose home page describes programmes for school and for competitive examinations.',
          source: { title: 'byjus.com, the home page', url: 'https://byjus.com/' },
          checked: '2026-09-09',
        },
        how: {
          value:
            'Programmes and courses, with the home page inviting a booked session rather than opening a lesson.',
          source: { title: 'byjus.com, the home page', url: 'https://byjus.com/' },
          checked: '2026-09-09',
        },
        syllabus: {
          value: NOT_ON_THE_PAGE,
          source: { title: 'byjus.com, the home page', url: 'https://byjus.com/' },
          checked: '2026-09-09',
        },
      },
    },
  },
];

// --- the words on a page --------------------------------------------------------------------------

export interface CompareCell {
  label: string;
  ours: Fact;
  theirs: Fact;
}

export interface ComparePage {
  slug: string;
  path: string;
  otherName: string;
  title: string;
  description: string;
  heading: string;
  lead: string;
  standing: string;
  cells: CompareCell[];
  sourcesHeading: string;
  sources: { title: string; url: string; read: string }[];
  closingHeading: string;
  closing: string[];
  askHeading: string;
  askPlaceholder: string;
  askChips: string[];
  evidence: Evidence;
  verdict: Verdict;
}

/**
 * A fact is publishable when it says something, when it was checked on a day that has happened,
 * and when the page it was read off is on the PRODUCT'S OWN SITE.
 *
 * That last one is the rule worth having a function for. A statement about what a product costs
 * has to come from that product, not from a review site, an aggregator or a press report, and a
 * cell sourced anywhere else does not reach the page. It is also what makes our own column
 * checkable by exactly the same test: our four facts have to come off heywobo.com.
 */
export function factOk(fact: Fact, product: Product, now: Date = new Date()): boolean {
  if (!fact.value.trim()) return false;
  if (!checkedDay(fact.checked, now)) return false;
  const host = hostOf(product.site);
  return host !== '' && onHost(fact.source.url, [host]);
}

/** A cell whose value is the honest "the page we read does not say", rather than a fact. */
export function isAbsence(fact: Fact): boolean {
  return fact.value.trim() === NOT_ON_THE_PAGE;
}

/**
 * BOTH SIDES SAY SOMETHING, OR THE ROW IS NOT A ROW.
 *
 * An absence opposite an absence is a fair line: neither page answers, and a reader learns that.
 * An absence opposite a paragraph is not, whatever the prose around it says, because a reader
 * reads a blank beside a full answer as a verdict and the page has then made a comparison it
 * promised not to make (docs/SELL.md §2). A home page does not list everything, and holding that
 * against anybody is exactly what "never sell by running anything down" forbids.
 */
export function evenHanded(ours: Fact, theirs: Fact): boolean {
  return isAbsence(ours) === isAbsence(theirs);
}

export function comparePage(comparison: Comparison, now: Date = new Date()): ComparePage {
  const ours = ourColumn();
  const other = comparison.other;
  const cells: CompareCell[] = ROWS.map((key) => ({
    label: ROW_LABELS[key],
    ours: ours.facts[key],
    theirs: other.facts[key],
  }))
    .filter((cell) => factOk(cell.ours, ours, now) && factOk(cell.theirs, other, now))
    .filter((cell) => evenHanded(cell.ours, cell.theirs));

  const seen = new Map<string, { title: string; url: string; read: string }>();
  for (const cell of cells) {
    for (const fact of [cell.ours, cell.theirs]) {
      if (seen.has(fact.source.url)) continue;
      seen.set(fact.source.url, {
        title: fact.source.title,
        url: fact.source.url,
        read: `Read on ${onDay(fact.checked)}.`,
      });
    }
  }
  const sources = [...seen.values()];

  const heading = `Wobo and ${other.name}, side by side`;
  const lead =
    `The questions a family actually asks, answered for ${other.name} out of the pages ` +
    `${other.name} publishes and for Wobo out of ours, with the link and the date on every line. ` +
    'A question only appears here when both sides answer it, and nothing here ranks the two, ' +
    'because that is not a thing a page can tell you about your own child.';

  const closing = [
    `What to do next is the same either way: open ${other.name} and read it, then open ours. A ` +
      'minute on each is worth more to you than any table.',
    'The one question worth taking with you is where the syllabus came from. Ask whoever you are ' +
      'considering to name the document, the page inside it and the day they read it. It is a ' +
      'fair question to put to anyone, and our own answer to it is the last row above.',
  ];

  const page: Omit<ComparePage, 'evidence' | 'verdict'> = {
    slug: comparison.slug,
    path: `/compare/${comparison.slug}`,
    otherName: other.name,
    title: `Wobo and ${other.name}, side by side · Wobo`,
    description:
      `What Wobo and ${other.name} each are, how an answer reaches the learner and where the ` +
      'syllabus each teaches came from, every line sourced to the page it was read off and dated.',
    heading,
    lead,
    standing: STANDING_NOTE,
    cells,
    sourcesHeading: 'The pages every line was read off',
    sources,
    closingHeading: 'How to decide for yourself',
    closing,
    askHeading: 'Ask Wobo anything before you decide',
    askPlaceholder: 'What does Wobo do when my child gets the same thing wrong twice?',
    askChips: [
      'Does it follow my school syllabus?',
      'What does free include?',
      'Is it safe to use alone?',
    ],
  };

  const evidence: Evidence = {
    sources: cells.length * 2,
    drawn: false,
    door: true,
    // Only the facts and their sources. The lead, the standing note, the closing and the headings
    // are the family's furniture: they name the other product but say nothing about it, and
    // counting them would let a page with one sourced fact clear the floor (see `gate.ts`).
    words: words(
      cells.map((c) => [c.label, c.ours.value, c.theirs.value]),
      sources.map((s) => [s.title, s.read]),
    ),
  };
  return { ...page, evidence, verdict: gate(evidence) };
}

export function comparisonBySlug(slug: string): Comparison | null {
  return COMPARISONS.find((c) => c.slug === slug) ?? null;
}

export function publishableComparisons(now: Date = new Date()): ComparePage[] {
  return COMPARISONS.map((c) => comparePage(c, now)).filter((p) => p.verdict.publishable);
}

/**
 * Every comparison address, for the sitemap.
 *
 * The index is an address only while it has something to index. With no comparison page clearing
 * the gate there is nothing to send a crawler to, and publishing an empty list would be the thin
 * page the gate exists to refuse, so the family publishes no addresses at all rather than one.
 */
export function comparePaths(now: Date = new Date()): string[] {
  const pages = publishableComparisons(now);
  if (pages.length === 0 || !compareIndex(now).verdict.publishable) return [];
  return ['/compare', ...pages.map((p) => p.path)];
}

// --- the index ------------------------------------------------------------------------------------

export interface CompareIndex {
  title: string;
  description: string;
  heading: string;
  lead: string;
  standing: string;
  entries: { slug: string; name: string; path: string; line: string }[];
  askHeading: string;
  askPlaceholder: string;
  askChips: string[];
  evidence: Evidence;
  verdict: Verdict;
}

export function compareIndex(now: Date = new Date()): CompareIndex {
  const pages = publishableComparisons(now);
  const entries = pages.map((page) => ({
    slug: page.slug,
    name: page.otherName,
    path: page.path,
    line: 'What each one is, how an answer arrives, and where the syllabus it teaches came from.',
  }));
  const heading = 'Side by side';
  const lead =
    'Somebody deciding where the money goes deserves a plain answer to the same few questions, ' +
    'about whoever they are considering, with the page it was read off and the day it was read. ' +
    'That is all these pages are. A question appears only where both sides answer it, and they ' +
    'are written the same way whether the answer flatters us or not.';
  const standing = STANDING_NOTE;

  const evidence: Evidence = {
    sources: pages.length,
    drawn: false,
    door: true,
    // An index has no siblings, so nothing on it is shared furniture and all of it counts.
    words: words(
      heading,
      lead,
      standing,
      entries.map((e) => [e.name, e.line]),
      // The index is a table of contents for four questions, so it names them.
      ROWS.map((r) => ROW_LABELS[r]),
    ),
  };
  return {
    title: 'Side by side · Wobo',
    description:
      'What Wobo and the products a family is also looking at each are, how an answer reaches a ' +
      'learner, and where the syllabus each teaches came from, sourced to the page and dated.',
    heading,
    lead,
    standing,
    entries,
    askHeading: 'Ask Wobo before you decide',
    askPlaceholder: 'How is Wobo different from a recorded video lesson?',
    askChips: [
      'What does free include?',
      'Does it follow my school syllabus?',
      'Can two children share one account?',
    ],
    evidence,
    // AN INDEX WITH NOTHING UNDER IT IS NOT A PAGE. The entries are the index, and a list of none
    // is a dead end whatever its word count says, so it is refused here rather than published
    // empty and quietly dropped from the sitemap by something downstream.
    verdict:
      entries.length === 0 ? { publishable: false, because: ['no entries'] } : gate(evidence),
  };
}
