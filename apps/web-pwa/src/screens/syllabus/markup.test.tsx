/**
 * THE CHAPTER PAGE, READ BACK OFF ITS OWN MARKUP.
 *
 * The order of a chapter page is the design decision this family turns on, and it is written down
 * in the comment at the top of `Syllabus.tsx`: the name and where it sits, one honest sentence, the
 * topics, the provenance, the tutor door, then the way on. A decision nothing checks is a decision
 * that drifts, so this renders the real component to static markup and reads the order back out of
 * the HTML — including the two things that must NOT be there: an empty topics heading on a board
 * that gave us no topic list, and any claim of an explanation this tier does not have.
 *
 * No browser and no SDK. The ask box is handed in as a slot, because what is being checked is where
 * it sits, not what it says (`copy.test.ts` holds its words).
 */

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider } from '../../shell/router';
import { handmade } from './handmade';
import { SyllabusBody } from './Syllabus';
import { find, hasPage, type Node, type Place } from './tree';

function markup(place: Place, freshness: 'built' | 'checked' | 'withdrawn' = 'built'): string {
  return renderToStaticMarkup(
    <RouterProvider initial={{ name: 'landing' }}>
      <SyllabusBody place={place} freshness={freshness} door={<div id="the-door" />} />
    </RouterProvider>,
  );
}

const CHAPTER = find({
  board: 'cbse',
  level: 'class-10',
  subject: 'mathematics',
  chapter: 'algebra',
}) as Place;

const UNIT = find({
  board: 'icse',
  level: 'class-9',
  subject: 'biology',
  chapter: 'basic-biology',
}) as Place;

/** Where each landmark starts in the HTML, so the order can be asserted as numbers. */
function at(html: string, needle: string): number {
  const found = html.indexOf(needle);
  expect(found, needle).toBeGreaterThan(-1);
  return found;
}

describe('the chapter page', () => {
  const html = markup(CHAPTER);

  it('says the six things in the order the design puts them in', () => {
    const name = at(html, CHAPTER.node.name);
    const seat = at(html, 'CBSE class 10 maths');
    const sentence = at(html, 'is a chapter of CBSE class 10 maths');
    const topics = at(html, '>Topics<');
    const source = at(html, 'Where this came from');
    const door = at(html, 'id="the-door"');
    const onward = at(html, 'The rest of this syllabus');
    expect([name < seat, seat < sentence, sentence < topics]).toEqual([true, true, true]);
    expect([topics < source, source < door, door < onward]).toEqual([true, true, true]);
  });

  it('names every topic, and links none of them, because this build writes no topic page', () => {
    // 711 topic addresses were linked from the chapter pages and NONE of them is pre-rendered:
    // `RELEASED` in pages.ts publishes board, class, subject, chapter and hub, and stops there
    // (the topic tier waits on the concept cores, docs/GROWTH-SEARCH.md §3). So every one of those
    // links answered 200 with the wordless SPA shell, and a crawler walking this site found more
    // empty addresses than real pages. A page this build did not write is not a page to send
    // anyone to; the topics are still named here, which is what the chapter actually knows.
    for (const topic of CHAPTER.node.children) {
      expect(html).not.toContain(`href="/learn/cbse/class-10/mathematics/algebra/${topic.slug}"`);
      expect(html).toContain(topic.name.replace(/&/g, '&amp;'));
    }
    expect(html).toContain('>Topics<');
  });

  it('still links the chapters and subjects it DOES write a page for', () => {
    const subject = markup(
      find({ board: 'cbse', level: 'class-10', subject: 'mathematics' }) as Place,
    );
    expect(subject).toContain('href="/learn/cbse/class-10/mathematics/algebra"');
  });

  it('walks up to the subject, the class and the board without being told how', () => {
    expect(html).toContain('href="/learn/cbse"');
    expect(html).toContain('href="/learn/cbse/class-10"');
    expect(html).toContain('href="/learn/cbse/class-10/mathematics"');
  });

  it('names the document, the section, the day, the checks and the hash', () => {
    const source = CHAPTER.node.source as NonNullable<typeof CHAPTER.node.source>;
    expect(html).toContain('From the official CBSE document');
    expect(html).toContain(source.section as string);
    expect(html).toMatch(/read on \d{1,2} \w+ \d{4}/);
    expect(html).toContain('named checks passed');
    expect(html).toContain('Document hash');
    expect(html).toContain((source.hash as string).slice(0, 12));
    // The document itself, openable, and never followed for ranking.
    expect(html).toContain(`href="${source.url}"`);
    expect(html).toContain('rel="nofollow noopener"');
  });

  it('says nothing about an explanation, because this tier does not have one', () => {
    expect(html).not.toMatch(/explanation|solutions|notes for this chapter/i);
  });
});

describe('a unit whose board gave us no topic list', () => {
  const html = markup(UNIT);

  it('leaves the slot empty rather than filling it with something plausible', () => {
    expect(html).not.toContain('>Topics<');
    // No list section at all. (The `<ul>` inside the provenance disclosure is the named checks,
    // which is evidence about the document and not a chapter list.)
    expect(html).not.toContain('class="sy-list');
    expect(html).toContain('no chapter list under it');
  });

  it('still carries the two things that make the page worth publishing', () => {
    expect(html).toContain('Where this came from');
    expect(html).toContain('still checking it');
    expect(html).toContain('id="the-door"');
  });

  it('calls the layer a unit here, and never a chapter with no chapters in it', () => {
    expect(html).toContain('is a unit of the ICSE class 9 biology syllabus');
  });
});

describe('a page the board has withdrawn since the build', () => {
  it('says so under the provenance rather than going on as if nothing happened', () => {
    const html = markup(CHAPTER, 'withdrawn');
    expect(html).toContain('The board no longer lists this one');
    expect(markup(CHAPTER, 'checked')).not.toContain('no longer lists');
  });
});

describe('the pages above the chapter', () => {
  it('gives a board its classes and a class its subjects, each counted', () => {
    const board = markup(find({ board: 'cbse' }) as Place);
    expect(board).toContain('>Classes<');
    expect(board).toContain('href="/learn/cbse/class-10"');
    expect(board).toMatch(/\d+ subjects/);
    // A board is the top of the family and has nothing above it to walk to.
    expect(board).not.toContain('The rest of this syllabus');

    const level = markup(find({ board: 'cbse', level: 'class-10' }) as Place);
    expect(level).toContain('>Subjects<');
    expect(level).toContain('href="/learn/cbse/class-10/mathematics"');
    expect(level).toMatch(/\d+ chapters, \d+ topics|one chapter/);
  });

  it('gives a subject its chapters, and the way to the one either side of it', () => {
    const subject = markup(
      find({ board: 'cbse', level: 'class-10', subject: 'mathematics' }) as Place,
    );
    expect(subject).toContain('>Chapters<');
    expect(subject).toContain('The rest of this syllabus');
    expect(subject).toContain('Up one');
  });
});

/**
 * EVERY ADDRESS A PAGE IN THIS FAMILY LINKS IS AN ADDRESS THE BUILD WROTE.
 *
 * Not only the children. The "Before this" and "After this" pair walks the siblings, and six
 * chapters the gate refuses sit between chapters it publishes, so each of those six was linked
 * from the page on either side and answered 200 with the wordless SPA shell. This walks a whole
 * subject and holds every href it renders to `hasPage`, so a new refusal cannot quietly reopen it.
 */
describe('every link a syllabus page renders', () => {
  const SUBJECT = { board: 'cbse', level: 'class-10', subject: 'mathematics' } as const;

  it('goes to a page the build wrote, children and neighbours alike', () => {
    const subject = find(SUBJECT) as Place;
    const byPath = new Map<string, Node>();
    const walk = (node: Node, path: string): void => {
      byPath.set(path, node);
      for (const child of node.children) walk(child, `${path}/${child.slug}`);
    };
    walk(subject.node, `/learn/${SUBJECT.board}/${SUBJECT.level}/${SUBJECT.subject}`);

    const dead: string[] = [];
    for (const chapter of subject.node.children) {
      const place = find({ ...SUBJECT, chapter: chapter.slug }) as Place;
      for (const link of markup(place).matchAll(/href="(\/learn\/[^"]*)"/g)) {
        const target = link[1] as string;
        const node = byPath.get(target);
        // A link up out of this subject is somebody else's page; only what is inside it is judged.
        if (node && !hasPage(node)) dead.push(`${chapter.slug} → ${target}`);
      }
    }
    expect(dead).toEqual([]);
  });
});

/**
 * THE SIXTY-SEVEN PAGES SOMEBODY LANDS ON WHILE DECIDING, read back off their own markup.
 *
 * docs/GROWTH-SEARCH.md §6 is an owner ruling: a board, a class and a subject page each get their
 * own opening and their own answer to the question a parent is actually asking there. `handmade.ts`
 * holds the words and proves they are unique; this proves they reach the page, and where.
 */
describe('a page somebody lands on while deciding', () => {
  const SUBJECT = find({
    board: 'cbse',
    level: 'class-10',
    subject: 'mathematics',
  }) as Place;
  const written = handmade('/learn/cbse/class-10/mathematics') as NonNullable<
    ReturnType<typeof handmade>
  >;
  const html = markup(SUBJECT);

  it('opens on its own paragraph, before the counted one', () => {
    const opening = at(html, written.opening.slice(0, 60));
    const counted = at(html, 'sets 7 chapters of maths');
    expect(opening).toBeLessThan(counted);
  });

  it('answers the question it was written to answer, after the list and before the source', () => {
    const list = at(html, '>Chapters<');
    const question = at(html, written.question.slice(0, 40));
    const answer = at(html, written.answer.slice(0, 60));
    const source = at(html, 'Where this came from');
    expect(list).toBeLessThan(question);
    expect(question).toBeLessThan(answer);
    expect(answer).toBeLessThan(source);
  });

  it('reads its heading as a sentence, with the placement set off by a comma', () => {
    expect(html).toContain('Mathematics</span><span class="sy-where">, CBSE class 10');
  });

  /** A chapter page has no handwritten paragraph, and must not grow one by accident. */
  it('puts none of it on a chapter page', () => {
    expect(markup(CHAPTER)).not.toContain('sy-written');
  });
});
