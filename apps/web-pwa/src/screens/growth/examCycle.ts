/**
 * /exams/<board> — the exam-cycle pages, and the rule that keeps them out of trouble.
 *
 * THE DEMAND IS REAL AND IT IS SEASONAL. From December to March a parent searches the syllabus for
 * the year, the sample papers and the date sheet, and what they find is a content farm's copy of a
 * board circular with no date on it. The harvest is full of it: "class 10 social science syllabus
 * 2026-27", "class 12 chemistry sample paper 2025-26", "class 12 science date sheet".
 *
 * THE RULE, AND IT IS THE WHOLE FAMILY. **We publish only what the board itself published, we cite
 * it, and we say when we last looked.** Not a summary of a circular. Not a date somebody posted on
 * a forum. Not "expected in November". A board's examination dates move, and a page that guesses
 * one is worse than no page: a family plans around it.
 *
 * So a board page is built from two sources and no others:
 *
 *   THE DOCUMENTS WE HAVE READ — `content/curriculum/syllabi/**`, compiled into `data/boards.json`.
 *   Every one carries the board's own title for it, the publisher, the URL, how many pages, the
 *   sha256 of the exact bytes and the moment we fetched them. This is the part no competitor has,
 *   and on this page it is not a footnote: it is the page.
 *
 *   THE OFFICIAL INDEX PAGES WE CHECKED BY HAND — `OFFICIAL_PAGES` below. One line each, the
 *   board's own page title, its address on the board's own host, and the day a person opened it.
 *   A board whose site we could not open on the day we checked simply has no entries, and the page
 *   says nothing about that: whether somebody else's server answered us is not news, and it is not
 *   ours to report.
 *
 * WHAT IS DELIBERATELY NOT HERE. No examination date sheet. We hold no board's date sheet as a
 * document, so no page carries one, in any form, including "usually announced in". When we hold
 * one, hashed and dated, it goes in the table like everything else.
 *
 * The honest label is per SUBJECT, never rolled up into a word for the whole board. Ten of the
 * twenty-three CBSE syllabi we hold have passed every check and thirteen have not; a board-level
 * "verified" would be a claim about the thirteen (docs/CURRICULUM.md §5, and `curriculum/labels.py`
 * whose four sentences these mirror).
 */

import { listOf, numberWord } from './concepts';
import boardsJson from './data/boards.json';
import type { Evidence, Verdict } from './gate';
import { checkedDay, gate, latest, onDay, onHost, shortHash, words } from './gate';

// --- what the compiled file holds ----------------------------------------------------------------

export interface BoardDoc {
  id: string;
  title: string;
  publisher: string;
  url: string;
  pages?: number;
  fetchedAt: string;
  sha256: string;
  board: string;
}

export interface BoardSubject {
  level: string;
  levelOrder: number;
  subject: string;
  status: 'verified' | 'provisional';
  chapters: number;
  topics: number;
  checksPassed: number;
  checksFailed: string[];
  documents: string[];
}

export interface Board {
  id: string;
  name: string;
  short: string;
  officialSite: string;
  /** The edition of the syllabus we hold: "2026-27", or NIOS's "2023". */
  version: string;
  chapters: number;
  topics: number;
  verifiedSubjects: number;
  subjects: BoardSubject[];
  documents: string[];
}

interface BoardsFile {
  documents: Record<string, BoardDoc>;
  boards: Board[];
}

const FILE = boardsJson as unknown as BoardsFile;

export const BOARDS: readonly Board[] = FILE.boards;
export const DOCUMENTS: Readonly<Record<string, BoardDoc>> = FILE.documents;

export function boardById(id: string): Board | null {
  return BOARDS.find((b) => b.id === id) ?? null;
}

// --- the official pages a person opened, and the day they opened them -----------------------------

export interface OfficialPage {
  /** The board's own title for the page, as the page titles itself. Never ours. */
  title: string;
  url: string;
  /** What is on it, in one line, factual. */
  holds: string;
  /** The day a person opened it and read the title off it. */
  checked: string;
}

/**
 * Index pages on a board's own site, opened by hand and read.
 *
 * A row here is a claim that somebody looked, so a row carries the day they looked, the gate
 * refuses any address that is not on the board's own host, and nothing is added from memory. When
 * a board's site could not be opened on the day of the check, it gets no rows and the page says
 * nothing about it.
 */
export const OFFICIAL_PAGES: Readonly<Record<string, readonly OfficialPage[]>> = {
  cbse: [
    {
      title: 'CBSE | Academics Unit : Curriculum/Syllabus',
      url: 'https://cbseacademic.nic.in/curriculum_2027.html',
      holds: 'The curriculum documents for the 2026-27 session, secondary and senior secondary.',
      checked: '2026-09-09',
    },
    {
      title: 'Class X Sample Question Paper & Marking Scheme for Exam 2025-26',
      url: 'https://cbseacademic.nic.in/SQP_CLASSX_2025-26.html',
      holds: "The board's own sample question papers and marking schemes, subject by subject.",
      checked: '2026-09-09',
    },
    {
      title: 'Class XII Sample Question Paper & Marking Scheme for Exam 2025-26',
      url: 'https://cbseacademic.nic.in/SQP_CLASSXII_2025-26.html',
      holds: 'The same, for the senior secondary subjects.',
      checked: '2026-09-09',
    },
  ],
};

/**
 * The hosts each board's own material may be linked from.
 *
 * A syllabus link that is not on the board's own site is not a board's syllabus, whatever it says,
 * and this is the gate rather than a review note because a wrong host here is the one mistake on
 * these pages that would matter. CBSE publishes its academic material on the academics unit's host
 * and its notices on its main one; CISCE publishes both ICSE and ISC.
 */
export const OFFICIAL_HOSTS: Readonly<Record<string, readonly string[]>> = {
  cbse: ['cbseacademic.nic.in', 'cbse.gov.in', 'ncert.nic.in'],
  nios: ['nios.ac.in'],
  icse: ['cisce.org'],
  isc: ['cisce.org'],
};

/**
 * What a check that has not passed yet means, in a sentence a parent can read.
 *
 * The seed states these as machine names and also carries a `status_reason` written by the
 * extractor for an engineer. Neither is page copy, so the compiler drops the reason and this table
 * says the same thing in our own words. A check we have no sentence for is reported as itself
 * rather than hidden, because a silent gap is how a page starts overclaiming.
 */
const CHECK_SENTENCES: Readonly<Record<string, string>> = {
  every_unit_has_a_topic_layer:
    'the chapter list holds, but the document does not break its chapters into topics, so we do not publish topics under them',
  second_reader_agrees:
    'a second reader disagreed with how the first one split the document, so the chapter list is not settled',
  every_name_is_on_its_cited_page: 'a chapter name sits a page away from the page we cited for it',
  every_name_is_in_the_source: 'a chapter name could not be matched word for word in the document',
  coverage_matches_the_documents_numbering:
    'the document numbers its chapters differently from the list we read off it',
  no_duplicate_name_within_a_unit: 'a chapter name appears twice under one heading',
  no_duplicate_topic_name_within_a_unit: 'a topic name appears twice under one chapter',
};

export function checkSentence(name: string): string {
  return CHECK_SENTENCES[name] ?? `a check named ${name} has not passed`;
}

/** The four honest labels, in the words `curriculum/labels.py` uses (docs/CURRICULUM.md §5). */
export const LABELS = {
  verified: 'Official, verified',
  provisional: "Found on the board's site, still checking",
} as const;

export function labelFor(board: Board, subject: BoardSubject): string {
  return subject.status === 'verified'
    ? `Official ${board.short} ${board.version}, verified`
    : LABELS.provisional;
}

// --- the words on a page -------------------------------------------------------------------------

export interface DocumentRow {
  id: string;
  title: string;
  publisher: string;
  url: string;
  /** "10 pages", or empty where the seed does not hold a page count. */
  extent: string;
  read: string;
  hash: string;
}

export interface SubjectRow {
  key: string;
  level: string;
  subject: string;
  /** "9 chapters, 46 topics" — counted, never claimed. */
  size: string;
  label: string;
  /** What has not passed yet, in plain words. Empty where everything passed. */
  open: string;
}

export interface BoardPage {
  id: string;
  path: string;
  short: string;
  name: string;
  title: string;
  description: string;
  heading: string;
  lead: string;
  standing: string;
  documentsHeading: string;
  documentsLead: string;
  documents: DocumentRow[];
  subjectsHeading: string;
  subjectsLead: string;
  subjects: SubjectRow[];
  officialHeading: string;
  officialLead: string;
  official: OfficialPage[];
  limitsHeading: string;
  limits: string[];
  /** "Everything on this page was last checked on 9 September 2026." */
  checked: string;
  askHeading: string;
  askPlaceholder: string;
  askChips: string[];
  evidence: Evidence;
  verdict: Verdict;
}

/**
 * "one chapter", "two topics", "133 chapters". Words for one and two, numerals above them
 * (docs/copy/voice.md §3), because these are counts a reader reads rather than acts on.
 */
function plural(n: number, one: string, many: string): string {
  return `${n <= 2 ? numberWord(n) : n} ${n === 1 ? one : many}`;
}

/** "10 of the 23 have", "none of the 12 has", "all 7 have" — never a bare zero in a sentence. */
function share(part: number, whole: number, verb: [string, string]): string {
  if (whole === 0) return '';
  if (part === 0) return `None of the ${whole} ${verb[1]}`;
  if (part === whole) return `All ${whole} ${verb[0]}`;
  return `${part} of the ${whole} ${verb[0]}`;
}

export function boardPage(board: Board, now: Date = new Date()): BoardPage {
  const hosts = OFFICIAL_HOSTS[board.id] ?? [];
  const documents: DocumentRow[] = board.documents
    .map((id) => DOCUMENTS[id])
    .filter((doc): doc is BoardDoc => Boolean(doc))
    // The gate, applied at the point the row is made rather than after: a document that is not on
    // the board's own host, or whose fetch date we cannot read, never becomes a line on the page.
    .filter((doc) => onHost(doc.url, hosts) && checkedDay(doc.fetchedAt, now))
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      publisher: doc.publisher,
      url: doc.url,
      extent: doc.pages ? plural(doc.pages, 'page', 'pages') : '',
      read: `Read on ${onDay(doc.fetchedAt)}.`,
      hash: `Hash of the bytes we read: ${shortHash(doc.sha256)}.`,
    }));

  const ordered = [...board.subjects].sort(
    (a, b) => a.levelOrder - b.levelOrder || a.subject.localeCompare(b.subject),
  );

  // ONE FACT ABOUT A DOCUMENT SET IS STATED ONCE, NOT ONCE PER ROW.
  //
  // Every ISC syllabus we hold has the same check open, so the same 26-word sentence stood in all
  // eight rows of the table: about 200 words of one repeated sentence inside an 840-word page, and
  // it counted towards the gate's floor eight times because it came from per-subject data. That is
  // the texture the gate exists to catch, arriving through the gate's own front door. A check that
  // is open on EVERY syllabus of a board is a fact about that board's document set, so it is said
  // once under "What is not here", and a row keeps only what is open on that row alone.
  //
  // The LABEL is never touched by this. The honest label stays per subject, always
  // (docs/CURRICULUM.md §5): it is the label, not this note, that says how well we know one
  // syllabus, and rolling it up would be the claim the whole page exists to avoid making.
  const everywhere =
    ordered.length > 1
      ? ordered
          .map((s) => s.checksFailed)
          .reduce((shared, list) => shared.filter((name) => list.includes(name)))
      : [];

  const subjects: SubjectRow[] = ordered.map((s) => ({
    key: `${s.levelOrder}-${s.subject}`,
    level: s.level,
    subject: s.subject,
    size: s.topics
      ? `${plural(s.chapters, 'chapter', 'chapters')}, ${plural(s.topics, 'topic', 'topics')}`
      : plural(s.chapters, 'chapter', 'chapters'),
    label: labelFor(board, s),
    open: s.checksFailed
      .filter((name) => !everywhere.includes(name))
      .map(checkSentence)
      .join('; '),
  }));

  const official = (OFFICIAL_PAGES[board.id] ?? []).filter(
    (page) => onHost(page.url, hosts) && checkedDay(page.checked, now),
  );

  const checkedAt = latest([
    ...documents.map((d) => (DOCUMENTS[d.id] as BoardDoc).fetchedAt),
    ...official.map((p) => p.checked),
  ]);

  const verified = board.verifiedSubjects;
  const held = board.subjects.length;
  const heading = `${board.short}: the syllabus we hold, and where every line came from`;
  // A board with nothing read off it says one sentence and falls under the gate. It never reaches
  // an address, but the sentence has to be true rather than a template with zeroes in it.
  const lead =
    held === 0 || documents.length === 0
      ? `We hold no ${board.short} syllabus yet.`
      : `We hold ${plural(held, 'syllabus', 'syllabuses')} for ${board.short}, edition ` +
        `${board.version}, read off ${plural(documents.length, 'official document', 'official documents')} ` +
        `published by ${board.name}. That is ${plural(board.chapters, 'chapter', 'chapters')}` +
        `${board.topics ? ` and ${plural(board.topics, 'topic', 'topics')}` : ''}. ` +
        `${share(verified, held, ['have', 'has'])} passed every check we run` +
        (verified === held
          ? '.'
          : verified === 0
            ? ' yet, and the table below says what is open on each.'
            : ', and the table below says which, and what is still open on the rest.');

  const standing =
    "Everything here is the board's own document. We do not summarise a circular, we do not " +
    'repost a date somebody put on a forum, and we do not print an examination date we have not ' +
    'read off the board. Each line names the file, the day we read it, and the hash of the exact ' +
    'bytes, so you can open the same file and check us.';

  const limits: string[] = [];
  if (held > 0 && !board.topics) {
    limits.push(
      `The ${board.short} documents we hold list chapters and do not break them into topics, so ` +
        'no topic is published under a chapter. Nothing is filled in from another board.',
    );
  }
  for (const name of everywhere) {
    limits.push(
      `This is open on every ${board.short} syllabus we hold, so it is said here once rather ` +
        `than on every row above: ${checkSentence(name)}.`,
    );
  }
  if (held > 0 && verified < held) {
    limits.push(
      `${
        verified === 0
          ? `None of the ${plural(held, 'syllabus', 'syllabuses')} has passed every check yet`
          : `${held - verified} of the ${held} are still being checked`
      }. They are published with that said on their own row rather than held back, because a ` +
        'chapter list read off the official document is worth more to you than an empty page.',
    );
  }
  if (held > 0) {
    limits.push(
      'No examination date sheet. We hold none as a document, so no page here carries one, in ' +
        'any form. When we hold one it will sit in the table above with a date and a hash like ' +
        'everything else.',
    );
  }

  const page: Omit<BoardPage, 'evidence' | 'verdict'> = {
    id: board.id,
    path: `/exams/${board.id}`,
    short: board.short,
    name: board.name,
    title: `${board.short} ${board.version} syllabus, and where it came from · Wobo`,
    description:
      `The ${board.short} ${board.version} syllabus as we hold it: ` +
      `${plural(board.chapters, 'chapter', 'chapters')} read off ${board.name}'s own ` +
      'documents, each with its page, its hash and the day we read it.',
    heading,
    lead,
    standing,
    documentsHeading: 'The documents this was read from',
    documentsLead:
      'Each one is the file the board published, fetched whole and hashed. The link goes to the ' +
      'board, not to a copy of it on our site.',
    documents,
    subjectsHeading: 'Subject by subject, and what is still open',
    subjectsLead:
      'A syllabus is published the moment we have read it off the official document, with how well ' +
      'we know it said on its own row. Nothing is hidden until it is perfect.',
    subjects,
    officialHeading: `Pages on ${board.short}'s own site that we check`,
    officialLead:
      'Opened by hand, titled as the board titles them, with the day somebody looked. Follow the ' +
      'link and read the board rather than us.',
    official,
    limitsHeading: 'What is not here',
    limits,
    checked: checkedAt
      ? `Everything on this page was last checked on ${onDay(checkedAt)}.`
      : 'Everything on this page carries its own date.',
    askHeading: `Ask Wobo about the ${board.short} syllabus`,
    askPlaceholder: `Which chapters are in ${board.short} class 10 maths?`,
    askChips: [
      'Which subjects do you hold for my board?',
      'Where did you get this syllabus?',
      'My school uses its own books',
    ],
  };

  const evidence: Evidence = {
    sources: documents.length + official.length,
    drawn: false,
    door: true,
    // Only this board's own words. The standing note, the three section leads and the headings are
    // the family's furniture, identical on all four pages, and counting them would let a board
    // with nothing on it clear the floor on boilerplate (see `gate.ts`).
    words: words(
      page.heading,
      page.lead,
      documents.map((d) => [d.title, d.publisher, d.extent, d.read, d.hash]),
      subjects.map((s) => [s.level, s.subject, s.size, s.label, s.open]),
      official.map((p) => [p.title, p.holds]),
      // The date-sheet line is on every page in the family, so it is rendered and not counted.
      limits.filter((line) => !line.startsWith('No examination date sheet')),
      page.checked,
    ),
  };
  return { ...page, evidence, verdict: gate(evidence) };
}

/** The boards that clear the gate. */
export function publishableBoards(now: Date = new Date()): BoardPage[] {
  return BOARDS.map((b) => boardPage(b, now)).filter((p) => p.verdict.publishable);
}

/** Every exam-cycle address, for the sitemap. */
export function examPaths(now: Date = new Date()): string[] {
  return ['/exams', ...publishableBoards(now).map((p) => p.path)];
}

// --- the index -----------------------------------------------------------------------------------

export interface ExamsIndex {
  title: string;
  description: string;
  heading: string;
  lead: string;
  standing: string;
  boards: { id: string; short: string; name: string; path: string; line: string }[];
  askHeading: string;
  askPlaceholder: string;
  askChips: string[];
  evidence: Evidence;
  verdict: Verdict;
}

export function examsIndex(now: Date = new Date()): ExamsIndex {
  const pages = publishableBoards(now);
  const boards = pages.map((page) => {
    const board = boardById(page.id) as Board;
    return {
      id: board.id,
      short: board.short,
      name: board.name,
      path: page.path,
      line:
        `${board.version}. ${plural(board.chapters, 'chapter', 'chapters')}` +
        `${board.topics ? ` and ${plural(board.topics, 'topic', 'topics')}` : ''}, read off ` +
        `${plural(page.documents.length, 'official document', 'official documents')}.`,
    };
  });
  const heading = 'The syllabus, from the board';
  const lead =
    `${capitalise(numberWord(boards.length))} boards, ${listOf(boards.map((b) => b.short))}. For ` +
    'each one, the syllabus we have read, the official document behind every chapter, the hash of ' +
    'the bytes and the day we read them. Follow any link and you land on the board, not on a copy ' +
    'of the board.';
  const standing =
    'Each board page carries the same four things: the documents we read, subject by subject with ' +
    "how well we know each one, the pages on the board's own site that we check by hand, and " +
    'what ' +
    'is not here yet. What you will not find is an examination date we have not read off the ' +
    'board itself, or a syllabus for a board we have not opened. Both are easy to write and ' +
    'neither is worth anything to a family planning a year.';

  const evidence: Evidence = {
    sources: boards.length,
    drawn: false,
    door: true,
    // An index has no siblings, so nothing on it is shared furniture and all of it counts.
    words: words(
      heading,
      lead,
      standing,
      boards.map((b) => [b.short, b.name, b.line]),
    ),
  };
  return {
    title: 'The syllabus, from the board · Wobo',
    description:
      'CBSE, ICSE, ISC and NIOS: the syllabus we hold for each, the official document behind ' +
      'every chapter, and the day we last read it.',
    heading,
    lead,
    standing,
    boards,
    askHeading: 'Ask Wobo about your board',
    askPlaceholder: 'Does Wobo follow the ICSE syllabus?',
    askChips: [
      'Where did you get this syllabus?',
      'What if my board is not listed?',
      'My school uses its own books',
    ],
    evidence,
    verdict: gate(evidence),
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
