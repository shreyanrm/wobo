/**
 * THE EXAM-CYCLE PAGES' QUALITY GATE.
 *
 * These are the pages where being wrong costs a family something real, so the checks are about
 * where a fact came from rather than about how it reads:
 *
 *  · every link on a board page is on that board's own host, and a lookalike domain is refused;
 *  · every document carries the hash of the bytes we read and the day we read them;
 *  · no page publishes an examination date, in any form, because we hold no board's date sheet;
 *  · a board with no chapters has no page at all, so the four state boards in the seed that were
 *    fetched only to prove they exist never reach an address;
 *  · a "checked" date in the future is refused rather than printed.
 */

import { describe, expect, it } from 'bun:test';
import {
  BOARDS,
  boardById,
  boardPage,
  checkSentence,
  DOCUMENTS,
  examPaths,
  examsIndex,
  LABELS,
  OFFICIAL_HOSTS,
  OFFICIAL_PAGES,
  publishableBoards,
} from './examCycle';
import { onHost, WORD_FLOOR } from './gate';

const NOW = new Date('2026-09-09T23:00:00Z');
const pages = publishableBoards(NOW);

describe('which boards get a page', () => {
  it('publishes exactly the boards whose syllabus we have actually read', () => {
    expect(pages.map((p) => p.id).sort()).toEqual(['cbse', 'icse', 'isc', 'nios']);
  });

  /** The seed also holds four state boards with a home page fetched and no chapter under it. */
  it('gives every published board chapters to publish', () => {
    for (const board of BOARDS) expect([board.id, board.chapters > 0]).toEqual([board.id, true]);
  });

  it('answers with nothing for a board id we do not hold', () => {
    expect(boardById('telangana')).toBeNull();
    expect(boardById('')).toBeNull();
  });
});

describe('every link goes to the board', () => {
  it('keeps every published document on the board own hosts', () => {
    const stray: string[] = [];
    for (const page of pages) {
      const hosts = OFFICIAL_HOSTS[page.id] ?? [];
      for (const doc of page.documents) if (!onHost(doc.url, hosts)) stray.push(doc.url);
    }
    expect(stray).toEqual([]);
  });

  it('keeps every hand-checked index page on the board own hosts', () => {
    const stray: string[] = [];
    for (const [board, entries] of Object.entries(OFFICIAL_PAGES)) {
      const hosts = OFFICIAL_HOSTS[board] ?? [];
      for (const entry of entries) if (!onHost(entry.url, hosts)) stray.push(entry.url);
    }
    expect(stray).toEqual([]);
  });

  /**
   * The gate proving it can say no. A document moved to a host that merely looks official is the
   * one mistake on this family that would matter, so it is tested rather than trusted.
   */
  it('drops a document that is not on the board own host', () => {
    const cbse = boardById('cbse');
    if (!cbse) throw new Error('no CBSE to build the negative case from');
    const first = cbse.documents[0];
    if (!first) throw new Error('CBSE holds no documents');
    const before = boardPage(cbse, NOW).documents.length;
    const doc = DOCUMENTS[first];
    if (!doc) throw new Error('a cited document that is not in the table');
    const original = doc.url;
    try {
      (doc as { url: string }).url = 'https://cbseacademic.nic.in.example.com/x.pdf';
      expect(boardPage(cbse, NOW).documents.length).toBe(before - 1);
    } finally {
      (doc as { url: string }).url = original;
    }
  });

  it('gives every document a hash and a day we read it', () => {
    for (const doc of Object.values(DOCUMENTS)) {
      expect([doc.id, doc.sha256.length]).toEqual([doc.id, 64]);
      expect([doc.id, Number.isNaN(new Date(doc.fetchedAt).getTime())]).toEqual([doc.id, false]);
    }
  });

  it('refuses a check dated in the future rather than printing it', () => {
    const early = new Date('2026-01-01T00:00:00Z');
    for (const page of publishableBoards(early)) expect(page.official).toEqual([]);
  });
});

describe('the gate, on the pages that ship', () => {
  it('passes every board page, with the words counted from the page itself', () => {
    for (const page of pages) {
      expect([page.id, page.verdict.because]).toEqual([page.id, []]);
      expect([page.id, page.evidence.words >= WORD_FLOOR]).toEqual([page.id, true]);
      expect([page.id, page.evidence.sources > 0]).toEqual([page.id, true]);
      expect([page.id, page.evidence.drawn]).toEqual([page.id, false]);
      expect([page.id, page.evidence.door]).toEqual([page.id, true]);
    }
  });

  it('refuses a board stripped of its documents and its subjects', () => {
    const cbse = boardById('cbse');
    if (!cbse) throw new Error('no CBSE to build the negative case from');
    const empty = boardPage(
      { ...cbse, documents: [], subjects: [], chapters: 0, topics: 0, verifiedSubjects: 0 },
      NOW,
    );
    expect(empty.verdict.publishable).toBe(false);
    // And it says one true sentence rather than a template with zeroes in it.
    expect(empty.lead).toBe('We hold no CBSE syllabus yet.');
    expect(empty.limits).toEqual([]);
  });
});

describe('what the pages say, and what they may never say', () => {
  /**
   * The rule this family exists under. An examination date we have not read off the board is the
   * one thing a family plans around, so no page carries one — not a date, not a month, not a
   * "usually announced in".
   */
  it('publishes no examination date and no guess at one', () => {
    const GUESS = /\b(?:expected|usually|likely|around|due)\s+(?:in|by|around)\b/i;
    const MONTH =
      /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
    for (const page of pages) {
      const own = [page.heading, page.lead, page.standing, ...page.limits, page.subjectsLead];
      expect([page.id, own.filter((line) => GUESS.test(line))]).toEqual([page.id, []]);
      // A month may only appear in the "we read it on this day" line, which is a fact about us.
      expect([page.id, own.filter((line) => MONTH.test(line))]).toEqual([page.id, []]);
      expect([page.id, page.limits.some((l) => l.includes('No examination date sheet'))]).toEqual([
        page.id,
        true,
      ]);
    }
  });

  it('labels a syllabus per subject, in the words the brain uses', () => {
    for (const page of pages) {
      for (const row of page.subjects) {
        const ok = row.label === LABELS.provisional || row.label.endsWith(', verified');
        expect([page.id, row.subject, ok]).toEqual([page.id, row.subject, true]);
      }
    }
  });

  it('says in plain words what a check that has not passed means', () => {
    const named = new Set(pages.flatMap((p) => p.subjects.map((s) => s.open)).filter(Boolean));
    // No page may print a machine name at a reader.
    for (const line of named) expect([line, /_/.test(line)]).toEqual([line, false]);
    expect(checkSentence('a_check_nobody_wrote_a_sentence_for')).toContain('has not passed');
  });

  it('says out loud where a board gave us no topics, and fills nothing in', () => {
    for (const page of pages) {
      const board = boardById(page.id);
      if (board && board.topics === 0) {
        expect([
          page.id,
          page.limits.some((l) => l.includes('do not break them into topics')),
        ]).toEqual([page.id, true]);
      }
    }
  });

  it('prints the day everything was last checked, on every page', () => {
    for (const page of pages) expect([page.id, page.checked]).toEqual([page.id, page.checked]);
    for (const page of pages) expect(page.checked).toContain('2026');
  });

  it('carries no exclamation mark and no em dash', () => {
    const all = pages.flatMap((p) => [
      p.title,
      p.description,
      p.heading,
      p.lead,
      p.standing,
      p.documentsLead,
      p.subjectsLead,
      p.officialLead,
      ...p.limits,
      p.checked,
      p.askHeading,
      p.askPlaceholder,
      ...p.askChips,
    ]);
    expect(all.filter((line) => /[!—]/.test(line))).toEqual([]);
  });
});

describe('the index and the addresses', () => {
  const index = examsIndex(NOW);

  it('publishes, and lists exactly the boards that have a page', () => {
    expect(index.verdict.publishable).toBe(true);
    expect(index.boards.map((b) => b.id)).toEqual(pages.map((p) => p.id));
  });

  it('gives the index first, then one address per board', () => {
    const paths = examPaths(NOW);
    expect(paths[0]).toBe('/exams');
    expect(paths.slice(1)).toEqual(pages.map((p) => p.path));
  });
});

/**
 * ONE FACT ABOUT A DOCUMENT SET, SAID ONCE.
 *
 * Every ISC syllabus we hold has the same check open, so the same 26-word sentence stood in all
 * eight rows of that page's table: about 200 words of one repeated sentence inside an 840-word
 * page, and it counted towards the gate's floor eight times because it came from per-subject data.
 * A check open on EVERY syllabus of a board is a fact about that board's documents, so it belongs
 * once under "What is not here"; a row keeps only what is open on that row alone.
 *
 * The label is not touched by any of this. The honest label stays per subject, always.
 */
describe('a note that is true of every row is not printed on every row', () => {
  it('says a board-wide open check once, under what is not here', () => {
    for (const page of publishableBoards(NOW)) {
      const notes = page.subjects.map((row) => row.open).filter(Boolean);
      const everywhere = notes.length === page.subjects.length && new Set(notes).size === 1;
      expect([page.id, everywhere]).toEqual([page.id, false]);
    }
    const isc = publishableBoards(NOW).find((page) => page.id === 'isc');
    expect(isc, 'the ISC page is the case this rule was written for').toBeDefined();
    const hoisted = (isc as NonNullable<typeof isc>).limits.filter((line) =>
      line.includes('said here once rather'),
    );
    expect(hoisted.length).toBeGreaterThan(0);
    // And the sentence it lifted is no longer standing in a row.
    for (const row of (isc as NonNullable<typeof isc>).subjects) {
      expect([row.key, row.open.includes('does not break its chapters into topics')]).toEqual([
        row.key,
        false,
      ]);
    }
  });

  it('still says how well it knows each syllabus, subject by subject', () => {
    for (const page of publishableBoards(NOW)) {
      for (const row of page.subjects) {
        expect([page.id, row.key, row.label.length > 0]).toEqual([page.id, row.key, true]);
      }
    }
  });
});
