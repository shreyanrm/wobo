/**
 * TIER TWO OF THE CHAPTER PAGES, PROVED ON A FIXTURE.
 *
 * The committed `explained.json` is empty today: no chapter's concept core has landed in the
 * cache the freezer reads (`wobo_gateway.curriculum.explained --dry-run`, 2026-09-17: 86 chapters
 * held back for no core, 95 because the site writes no page for them, 152 for no topic). So the rules are proved here on a record shaped
 * exactly as the freezer writes one, and the real file is proved separately to publish nothing it
 * cannot back.
 *
 * What has to hold, in the order a mistake would cost most:
 *
 *  · a chapter with no complete record stays at tier one and says nothing about an explanation;
 *  · a record may only explain a topic its OWN board published under that chapter, so an ICSE or
 *    ISC unit, which carries no topics, can never carry one;
 *  · a record written for another depth band than the page's class is not shown;
 *  · the figure is a real file with its size declared, and it carries `ImageObject` markup that
 *    names the brand as Wobo and the address only where an address belongs.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { extractJsonLd, nodesOfType } from '../../../scripts/jsonld-check';
import { namingViolations } from '../../shell/jsonld';
import { RouterProvider } from '../../shell/router';
import { OURS_LINE, QUESTIONS_LABEL } from './copy';
import {
  bandOf,
  explainedPages,
  explanationFor,
  figureLd,
  readExplained,
  reset,
} from './explained';
import file from './explained.json';
import { gate, ownProse, pageProse } from './pages';
import { SyllabusBody } from './Syllabus';
import { find, type Place, pathOf } from './tree';

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

const FIGURE = {
  file: 'quadratic-equations--a1b2c3d4e5f6.svg',
  width: 640,
  height: 360,
  alt: 'Quadratic equations',
};

/** One record, shaped exactly as `curriculum/explained.py` writes it. Neutral, invented words. */
function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path: pathOf(CHAPTER),
    topic: 'quadratic-equations',
    name: 'Quadratic equations',
    concept: 'quadratic-equations',
    band: 'senior',
    idea: 'A quadratic equation asks which numbers make a squared expression come out to zero, and there are at most two of them.',
    why: 'The path of a thrown ball follows the same curve, so finding the roots finds where it lands.',
    questions: [
      { q: 'How many real roots can a quadratic have?', a: 'None, one or two.' },
      {
        q: 'Is it true that every quadratic has two different roots?',
        a: 'A perfect square such as x squared minus 2x plus 1 has only one.',
      },
      {
        q: 'Is it true that a negative discriminant means a negative root?',
        a: 'It means there is no real root at all; the curve never meets the axis.',
      },
    ],
    figure: FIGURE,
    ...overrides,
  };
}

function fixture(...rows: Record<string, unknown>[]): unknown {
  return { shape: 1, stamp: 'fixture', written: '2026-09-17', chapters: rows };
}

function markup(place: Place): string {
  return renderToStaticMarkup(
    <RouterProvider initial={{ name: 'landing' }}>
      <SyllabusBody place={place} freshness="built" door={<div id="the-door" />} />
    </RouterProvider>,
  );
}

afterEach(() => reset());

describe('the committed file', () => {
  it('is read to the shape the freezer writes', () => {
    expect((file as { shape: number }).shape).toBe(1);
  });

  it('names only figures that exist, on chapters that have the topic they explain', () => {
    for (const entry of explainedPages()) {
      const on = join(import.meta.dir, '../../../public/learn/figures', entry.figure.file);
      expect(existsSync(on), `${entry.path} names ${entry.figure.file}`).toBe(true);
      const place = find(addressOf(entry.path));
      expect(place, entry.path).not.toBeNull();
      expect(explanationFor(place as Place), entry.path).not.toBeNull();
    }
  });
});

function addressOf(path: string) {
  const [board, level, subject, chapter] = path.replace(/^\/learn\//, '').split('/');
  return { board: board ?? '', level, subject, chapter };
}

describe('the band a class sits in', () => {
  it('reads it off the class number, the way the freezer does', () => {
    expect(bandOf('Class 4')).toBe('foundation');
    expect(bandOf('Class 6')).toBe('middle');
    expect(bandOf('Class 8')).toBe('middle');
    expect(bandOf('Class 9')).toBe('senior');
    expect(bandOf('Class 12')).toBe('senior');
    expect(bandOf('Senior Secondary')).toBeNull();
  });
});

describe('a chapter with a complete record', () => {
  it('carries the explanation, the figure and the three questions, before the provenance', () => {
    reset(fixture(record()));
    const html = markup(CHAPTER);
    const heading = html.indexOf('>Quadratic equations</h2>');
    const figure = html.indexOf(`src="/learn/figures/${FIGURE.file}"`);
    const source = html.indexOf('Where this came from');
    const door = html.indexOf('id="the-door"');
    expect(heading).toBeGreaterThan(-1);
    expect(figure).toBeGreaterThan(heading);
    expect(source).toBeGreaterThan(figure);
    expect(door).toBeGreaterThan(source);
    expect(html).toContain('width="640"');
    expect(html).toContain('height="360"');
    expect(html).toContain('alt="Quadratic equations"');
    expect(html).toContain(`>${QUESTIONS_LABEL}<`);
    expect(html.match(/<details><summary>/g)?.length).toBe(3);
    // Every answer is in the markup, so a reader with nothing executed reads all three.
    expect(html).toContain('None, one or two.');
    // Who wrote what, inside the provenance, once.
    expect(html.split(OURS_LINE.replace(/'/g, '&#x27;')).length - 1).toBe(1);
  });

  it('declares the figure as an ImageObject that names the same file the page shows', () => {
    reset(fixture(record()));
    const html = markup(CHAPTER);
    const images = nodesOfType(extractJsonLd(html), 'ImageObject');
    expect(images.length).toBe(1);
    const image = images[0] as Record<string, unknown>;
    expect(String(image.contentUrl)).toEndWith(`/learn/figures/${FIGURE.file}`);
    expect(image.width).toBe(640);
    expect(image.height).toBe(360);
    expect(image.encodingFormat).toBe('image/svg+xml');
    expect(image.name).toBe('Quadratic equations');
    expect(namingViolations(images)).toEqual([]);
  });

  it('builds ImageObject markup that keeps the naming law on any origin', () => {
    const entry = readExplained(fixture(record()))[0];
    const node = figureLd(entry as NonNullable<typeof entry>, 'https://heywobo.com');
    expect(node.contentUrl).toBe(`https://heywobo.com/learn/figures/${FIGURE.file}`);
    expect(node['@id']).toBe(`https://heywobo.com${pathOf(CHAPTER)}#figure`);
    expect(namingViolations([node])).toEqual([]);
    expect(JSON.stringify(node)).not.toContain('—');
  });

  it('counts the explanation as the page’s own words, and the labels as frame', () => {
    reset(fixture(record()));
    const own = ownProse(CHAPTER).join(' ');
    expect(own).toContain('at most two of them');
    expect(own).toContain('None, one or two.');
    expect(own).not.toContain(OURS_LINE);
    const all = pageProse(CHAPTER).join(' ');
    expect(all).toContain(OURS_LINE);
    expect(gate(CHAPTER)).toEqual([]);
  });
});

describe('a chapter that stays at tier one', () => {
  it('says nothing about an explanation when the file has no record for it', () => {
    reset(fixture());
    const html = markup(CHAPTER);
    expect(html).not.toContain('sy-explain');
    expect(html).not.toContain(OURS_LINE.replace(/'/g, '&#x27;'));
    expect(html).not.toContain('ImageObject');
    expect(html).not.toMatch(/explanation|figure/i);
  });

  it('drops a record missing any part rather than rendering a gap', () => {
    const broken = [
      record({ idea: '' }),
      record({ why: '   ' }),
      record({ questions: record().questions && (record().questions as unknown[]).slice(0, 2) }),
      record({ figure: { ...FIGURE, width: 0 } }),
      record({ figure: { ...FIGURE, file: 'not a file.png' } }),
      record({ band: '' }),
    ];
    for (const row of broken) {
      reset(fixture(row));
      expect(explanationFor(CHAPTER)).toBeNull();
      expect(markup(CHAPTER)).not.toContain('sy-explain');
    }
  });

  it('refuses a topic the board did not publish under that chapter', () => {
    reset(fixture(record({ topic: 'the-french-revolution' })));
    expect(explanationFor(CHAPTER)).toBeNull();
  });

  it('refuses a record written for another depth band than the page’s class', () => {
    reset(fixture(record({ band: 'middle' })));
    expect(explanationFor(CHAPTER)).toBeNull();
  });

  it('never carries one on an ICSE or ISC unit, which has no topics to explain', () => {
    reset(
      fixture(
        record({
          path: pathOf(UNIT),
          topic: 'basic-biology',
          name: UNIT.node.name,
          band: 'senior',
        }),
      ),
    );
    expect(UNIT.node.children.length).toBe(0);
    expect(explanationFor(UNIT)).toBeNull();
    expect(markup(UNIT)).not.toContain('sy-explain');
  });

  it('never carries one on a page that is not a chapter', () => {
    const subject = find({ board: 'cbse', level: 'class-10', subject: 'mathematics' }) as Place;
    reset(fixture(record({ path: pathOf(subject) })));
    expect(explanationFor(subject)).toBeNull();
  });
});
