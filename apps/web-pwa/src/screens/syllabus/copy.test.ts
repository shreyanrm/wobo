/**
 * THE COPY LAW, RUN OVER EVERY ONE OF THE 1,120 PAGES THIS FAMILY WRITES.
 *
 * Every other public page on this site was written by a person and reviewed by a person. These are
 * generated, which means the review has to be mechanical: the patterns below are the ones the
 * gateway's `tests/test_copy_law.py` runs over `docs/copy/**` and the prototypes, ported here and
 * pointed at every title, description, heading, sentence, provenance line and ask chip the family
 * produces. A page that broke the law would otherwise ship 333 times.
 *
 * The one deliberate exception is a NAME. A chapter's name is the board's own words off the board's
 * own document, and we do not edit it: if a syllabus writes an en dash into a chapter title, the
 * page carries it. So the dash and sentence-case rules are applied to the words WE write, and the
 * test proves separately that no name we quote carries an em dash either.
 */

import { describe, expect, it } from 'bun:test';
import {
  article,
  ask,
  checksLine,
  childrenLabel,
  classWords,
  dateWords,
  description,
  distinctName,
  fingerprintLine,
  heading,
  hubAsk,
  hubDescription,
  hubHeading,
  hubSummary,
  hubTail,
  hubTitle,
  linkNote,
  list,
  number,
  ordinal,
  provenance,
  spoken,
  summary,
  title,
} from './copy';
import { handmade } from './handmade';
import { boards, find, type Place, pathOf, subjects } from './tree';

// --- every page, once ------------------------------------------------------------------------------

function everyPlace(): Place[] {
  const out: Place[] = [];
  const push = (address: Parameters<typeof find>[0]): void => {
    const place = find(address);
    if (place) out.push(place);
  };
  for (const board of boards()) {
    push({ board: board.slug });
    for (const level of board.children) {
      push({ board: board.slug, level: level.slug });
      for (const subject of level.children) {
        push({ board: board.slug, level: level.slug, subject: subject.slug });
        for (const chapter of subject.children) {
          const seat = { board: board.slug, level: level.slug, subject: subject.slug };
          push({ ...seat, chapter: chapter.slug });
          for (const topic of chapter.children) {
            push({ ...seat, chapter: chapter.slug, topic: topic.slug });
          }
        }
      }
    }
  }
  return out;
}

const PLACES = everyPlace();

/** Only the words this repo wrote: the sentences, minus the names quoted inside them. */
function ourWords(place: Place): string[] {
  const door = ask(place);
  // The sixty-seven handwritten pages are ours in the fullest sense, so the law runs over them
  // here rather than only in `handmade.test.ts`: they were typed by a person and every other line
  // in this family was composed by a function, which is the way round that usually goes wrong.
  const written = handmade(pathOf(place));
  return [
    summary(place),
    provenance(place.node.source, place.board),
    checksLine(place.node.source) ?? '',
    door.heading,
    door.placeholder,
    ...door.chips,
    ...(written ? [written.opening, written.question, written.answer] : []),
  ];
}

/** Everything a reader sees, names included. */
function everyLine(place: Place): string[] {
  const head = heading(place);
  return [
    title(place),
    description(place),
    head.name,
    head.where,
    ...ourWords(place),
    ...place.node.children.map((child) => linkNote(child) ?? ''),
  ];
}

const ALL_LINES = PLACES.flatMap(everyLine).concat(
  subjects().flatMap((hub) => {
    const head = hubHeading(hub);
    const door = hubAsk(hub);
    return [
      hubTitle(hub),
      hubDescription(hub),
      head.name,
      head.where,
      hubSummary(hub),
      hubTail(hub),
      door.heading,
      door.placeholder,
      ...door.chips,
    ];
  }),
);

// --- the patterns, as the gateway writes them ---------------------------------------------------------

const LEVEL = 'class(?:es)?|grades?|years?|std|standards?';
const JOIN = 'to|through|until|up\\s+to|–|—|-|\\.\\.';
const GRADE_SPAN = new RegExp(
  `\\b(?:${LEVEL})\\s*\\.?\\s*\\d{1,2}\\s*(?:${JOIN})\\s*(?:${LEVEL})?\\s*\\d{1,2}\\b`,
  'i',
);
const GRADE_BOUND = new RegExp(
  `\\b(?:from|up\\s+to|below|above|under|over|beyond|starting\\s+(?:at|from))\\s+(?:about\\s+|around\\s+|roughly\\s+)?(?:${LEVEL})\\s*\\d{1,2}\\b`,
  'i',
);
const GRADE_FLOOR = /\b(?:class(?:es)?|grades?)\s*4\b/i;
const AGE_SPAN = new RegExp(
  `\\bages?\\s*\\d{1,2}\\s*(?:${JOIN})\\s*\\d{1,2}\\b|\\b\\d{1,2}\\s*(?:${JOIN})\\s*\\d{1,2}[\\s-]*year[\\s-]*olds?\\b`,
  'i',
);

describe('the copy law, over every syllabus page', () => {
  it('never gates by class or by age, in any direction', () => {
    const hits = ALL_LINES.filter((line) =>
      [GRADE_SPAN, GRADE_BOUND, GRADE_FLOOR, AGE_SPAN].some((pattern) => pattern.test(line)),
    );
    expect(hits.slice(0, 5)).toEqual([]);
  });

  it('never puts a made-up person on a page', () => {
    // Nothing in this family addresses anyone, so the only safe shapes are none at all.
    const hits = ALL_LINES.filter((line) =>
      /\b(?:my (?:son|daughter)|a (?:girl|boy) (?:called|named))\b/i.test(line),
    );
    expect(hits).toEqual([]);
  });

  it('never counts an allowance, and never says unlimited', () => {
    const hits = ALL_LINES.filter((line) =>
      /\b(?:unlimited|no daily limit|\d+\s+questions? (?:a|per) day)\b/i.test(line),
    );
    expect(hits).toEqual([]);
  });

  it('never uses an exclamation mark or an emoji', () => {
    expect(ALL_LINES.filter((line) => /!/.test(line))).toEqual([]);
    expect(ALL_LINES.filter((line) => /\p{Extended_Pictographic}/u.test(line))).toEqual([]);
  });

  it('never writes an em dash in a line of our own', () => {
    const hits = PLACES.flatMap(ourWords).filter((line) => line.includes('—'));
    expect(hits).toEqual([]);
  });

  it('quotes no board name that carries an em dash either', () => {
    const names: string[] = [];
    for (const board of boards()) {
      const walk = (node: { name: string; children: readonly { name: string }[] }): void => {
        if (node.name.includes('—')) names.push(node.name);
        for (const child of node.children) {
          walk(child as { name: string; children: readonly { name: string }[] });
        }
      };
      walk(board);
    }
    expect(names).toEqual([]);
  });

  /**
   * THE NAMING LAW (docs/GROWTH-ENTITY.md §2): the brand is Wobo, and heywobo.com is an address a
   * person never reads as a name. The vendor half of this rule is not repeated here on purpose:
   * `scripts/gate_white_label.py` scans every shipped source file for a provider's name, this
   * family's words are shipped source, and writing the names into a test would be the leak the
   * gate exists to stop.
   */
  it('never says the brand as one word', () => {
    expect(ALL_LINES.filter((line) => /heywobo/i.test(line))).toEqual([]);
    expect(ALL_LINES.filter((line) => /\bWobo\b/.test(line)).length).toBeGreaterThan(0);
  });

  it('never sells by running anything down', () => {
    const hits = ALL_LINES.filter((line) =>
      /\b(?:better than|unlike (?:byju|vedantu|a tutor|your teacher)|cheaper than)\b/i.test(line),
    );
    expect(hits).toEqual([]);
  });
});

// --- what makes the page worth publishing ---------------------------------------------------------------

describe('what a page claims', () => {
  it('never claims an explanation the family does not have yet', () => {
    // Tier two adds the drawn explanation; tier one must not imply one exists
    // (docs/GROWTH-SEARCH.md §6, the last paragraph).
    const hits = PLACES.flatMap(ourWords).filter((line) =>
      /\b(?:we explain|explained here|full explanation|step[- ]by[- ]step solution|notes below|solutions? below)\b/i.test(
        line,
      ),
    );
    expect(hits).toEqual([]);
  });

  it('says out loud where a board gave us no topic list, and lists nothing there', () => {
    const icse = PLACES.filter(
      (place) =>
        place.kind === 'chapter' && (place.board.slug === 'icse' || place.board.slug === 'isc'),
    );
    expect(icse.length).toBe(92 + 60);
    for (const place of icse) {
      expect(place.node.children, place.node.slug).toEqual([]);
      expect(summary(place)).toContain('no topic list under it');
      expect(summary(place)).toContain('unit');
    }
  });

  it('calls a provisional document provisional, and an official one official', () => {
    for (const board of boards()) {
      const level = board.children[0];
      const subject = level?.children[0];
      const chapter = subject?.children[0];
      const place = find({
        board: board.slug,
        level: (level as { slug: string }).slug,
        subject: (subject as { slug: string }).slug,
        chapter: (chapter as { slug: string }).slug,
      });
      const line = provenance((place as Place).node.source, board);
      if (board.status === 'verified') {
        expect(line, board.slug).toContain('official');
        expect(line, board.slug).not.toContain('still checking');
      } else {
        expect(line, board.slug).toContain('still checking');
        expect(line, board.slug).not.toContain('the official');
      }
    }
  });

  it('names the document, the page inside it and the day we read it', () => {
    const place = find({
      board: 'cbse',
      level: 'class-10',
      subject: 'mathematics',
      chapter: 'number-systems',
    }) as Place;
    const line = provenance(place.node.source, place.board);
    expect(line).toContain('CBSE');
    expect(line).toContain(place.node.source?.section ?? '');
    expect(line).toMatch(/read on \d{1,2} \w+ \d{4}\./);
    expect(checksLine(place.node.source)).toMatch(
      /^We checked this list against that document on /,
    );
  });

  it('says plainly when there is no source on file, rather than implying one', () => {
    expect(provenance(null, boards()[0] as never)).toBe(
      'We have no source document on file for this one.',
    );
    expect(checksLine(null)).toBeNull();
  });
});

// --- the shape the demand data asked for -----------------------------------------------------------------

describe('the words people actually type', () => {
  it('says maths, because 1,505 searches say maths and 61 say mathematics', () => {
    expect(spoken('Mathematics')).toBe('maths');
    expect(spoken('Physics')).toBe('physics');
    const place = find({ board: 'cbse', level: 'class-10', subject: 'mathematics' }) as Place;
    expect(title(place)).toContain('maths');
    // and the ADDRESS keeps the board's own word
    expect(place.node.slug).toBe('mathematics');
  });

  it('calls the layer a chapter, because 4,110 searches say chapter and 48 say unit', () => {
    const place = find({
      board: 'cbse',
      level: 'class-10',
      subject: 'mathematics',
      chapter: 'number-systems',
    }) as Place;
    expect(summary(place)).toContain('chapter');
  });

  it('leads a chapter title with the chapter, then the class and the subject', () => {
    const place = find({
      board: 'cbse',
      level: 'class-10',
      subject: 'mathematics',
      chapter: 'number-systems',
    }) as Place;
    expect(title(place)).toBe('Number systems · class 10 maths, CBSE · Wobo');
  });
});

// --- the small words hold up --------------------------------------------------------------------------------

describe('the small words', () => {
  it('says a before a consonant sound and an before a vowel one, acronyms included', () => {
    expect(article('CBSE')).toBe('a');
    expect(article('ICSE')).toBe('an');
    expect(article('ISC')).toBe('an');
    expect(article('NIOS')).toBe('an');
    expect(article('board')).toBe('a');
    expect(article('official')).toBe('an');
  });

  it('writes one and two as words and everything else as a numeral', () => {
    expect([number(1), number(2), number(3), number(15)]).toEqual(['one', 'two', '3', '15']);
  });

  it('joins a list the way Indian English does, with no serial comma', () => {
    expect(list(['a'])).toBe('a');
    expect(list(['a', 'b'])).toBe('a and b');
    expect(list(['a', 'b', 'c'])).toBe('a, b and c');
    expect(list([])).toBe('');
  });

  it('writes a date the way a person reads one, and drops the clock', () => {
    expect(dateWords('2026-09-03T07:05:07Z')).toBe('3 September 2026');
    expect(dateWords('2026-12-25')).toBe('25 December 2026');
    expect(dateWords(null)).toBeNull();
    expect(dateWords('2026')).toBeNull();
  });

  it('counts in words where a reader would say a word', () => {
    expect([ordinal(1), ordinal(3), ordinal(6), ordinal(11), ordinal(22)]).toEqual([
      'first',
      'third',
      '6th',
      '11th',
      '22nd',
    ]);
  });

  it('lowercases a class inside a sentence and leaves it alone as a name', () => {
    expect(classWords('Class 10')).toBe('class 10');
  });

  it('only marks a repeated name, and only from the second one on', () => {
    const a = { kind: 'topic' as const, slug: 'a', name: 'Same', source: null, children: [] };
    const b = { ...a, slug: 'a-2' };
    const other = { ...a, slug: 'c', name: 'Other' };
    expect(distinctName(a, [a, other, b], 0)).toBe('Same');
    expect(distinctName(other, [a, other, b], 1)).toBe('Other');
    expect(distinctName(b, [a, other, b], 2)).toBe('Same (second of that name)');
  });
});

// --- a textbook is not a chapter (the closer's run, 2026-09-17) ------------------------------------------

/**
 * The CBSE middle years publish each subject as one or two NCERT textbooks, or as theme sections,
 * and class 10 social science as four books; the chapters sit one layer further down. Six shipped
 * pages told a parent that a textbook was "one chapter ... 12 topics between them". The count
 * matched the tree, so the count test passed, and the sentence was false.
 */
describe('a page never calls a textbook, a theme or a book a chapter', () => {
  const at = (level: string, subject: string) => find({ board: 'cbse', level, subject }) as Place;

  it('says a subject taught from a textbook is taught from a textbook', () => {
    expect(summary(at('class-6', 'science'))).toBe(
      'CBSE class 6 teaches science from one textbook, Curiosity, Grade 6, with 12 chapters in it.',
    );
    expect(summary(at('class-8', 'mathematics'))).toBe(
      'CBSE class 8 teaches maths from two textbooks, Ganita Prakash, Grade 8, Part 1 and ' +
        'Ganita Prakash, Grade 8, Part 2, with 14 chapters between them.',
    );
    for (const [level, subject] of [
      ['class-6', 'science'],
      ['class-6', 'mathematics'],
      ['class-7', 'science'],
      ['class-7', 'mathematics'],
      ['class-8', 'science'],
      ['class-8', 'mathematics'],
    ] as const) {
      const line = summary(at(level, subject));
      expect(line).not.toMatch(/\bchapters? of\b|topics between them|\bIt is\b/);
      expect(line).toContain('textbook');
    }
  });

  it('counts theme sections and books as what they are, and the chapters inside them', () => {
    expect(summary(at('class-6', 'social-science'))).toBe(
      'CBSE class 6 sets social science as 5 theme sections, with 14 chapters between them.',
    );
    expect(summary(at('class-10', 'social-science'))).toBe(
      'CBSE class 10 sets social science as 4 books, with 21 chapters between them.',
    );
  });

  it('labels the list and each entry in it by what it is', () => {
    const science = at('class-6', 'science');
    const book = science.node.children[0] as Place['node'];
    expect(linkNote(science.node)).toBe('one textbook, 12 chapters');
    expect(linkNote(book)).toBe('12 chapters');
    expect(childrenLabel('subject', science.node)).toBe('Textbooks');
    expect(childrenLabel('chapter', book)).toBe('Chapters');
    expect(childrenLabel('subject', at('class-10', 'mathematics').node)).toBe('Chapters');
    const page = find({
      board: 'cbse',
      level: 'class-6',
      subject: 'science',
      chapter: book.slug,
    }) as Place;
    expect(summary(page)).toMatch(
      /^Curiosity, Grade 6 is a textbook of CBSE class 6 science with 12 chapters in it, from /,
    );
  });

  it('counts only real chapters on a class page and a board page', () => {
    const six = find({ board: 'cbse', level: 'class-6' }) as Place;
    // maths 10 + science 12 + social science 14: not the 7 nodes the layer holds
    expect(summary(six)).toContain('36 chapters in all');
  });

  it('holds on every page the family writes', () => {
    for (const place of everyPlace()) {
      if (place.kind !== 'subject') continue;
      const line = summary(place);
      for (const child of place.node.children) {
        if (
          /,\s*Grade \d+|^Theme [A-Z] - |^(History|Geography|Political Science|Economics) \(/.test(
            child.name,
          )
        ) {
          expect(line).not.toMatch(/\bchapters? of\b/);
        }
      }
    }
  });
});

describe('the provenance block reads as sentences, not a system report', () => {
  it('says what was checked, without a count of named checks', () => {
    const place = find({
      board: 'cbse',
      level: 'class-8',
      subject: 'science',
    }) as Place;
    const line = checksLine(place.node.source) ?? '';
    expect(line).toMatch(/^We checked this list against that document on \d{1,2} \w+ \d{4}\.$/);
    expect(line).not.toMatch(/named|\d+ checks?/);
  });

  it('gives the fingerprint as a sentence a parent can read', () => {
    const place = find({ board: 'cbse', level: 'class-8', subject: 'science' }) as Place;
    const line = fingerprintLine(place.node.source) ?? '';
    expect(line).toMatch(
      /^The copy we read has the fingerprint [0-9a-f]{12}, so anyone can check it is the same file\.$/,
    );
    expect(fingerprintLine(null)).toBeNull();
  });
});
