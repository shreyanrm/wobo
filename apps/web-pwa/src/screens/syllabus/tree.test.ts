/**
 * THE HONEST COUNT, HELD TO THE SEED.
 *
 * docs/GROWTH-SEARCH.md §3 publishes exactly these numbers, counted from the seed in production
 * and not estimated: 4 boards, 13 classes, 50 subjects, 333 chapters, 711 topics. WOBO-TASKS §10.21
 * is the law that says we may publish only what we can prove. This file is where that law is
 * mechanical: the file the site is built from is re-counted here, and a syllabus that grew or
 * shrank fails the build until the counts in the document are changed to match it.
 *
 * The other half of the law is negative. ICSE and ISC give us units with no topic list under them,
 * so those chapters must come back with NO children. A test that only counted totals would pass
 * happily on a tree that had quietly invented 92 chapter lists.
 */

import { describe, expect, it } from 'bun:test';
import { boards, counts, find, neighbours, SHAPE, STAMP, subjectHub, subjects } from './tree';

describe('the frozen syllabus', () => {
  it('is the shape this build knows how to read, and says which edition it is', () => {
    expect(SHAPE).toBe(1);
    expect(STAMP).toMatch(/^[0-9a-f]{8,}$/);
  });

  it('counts exactly what docs/GROWTH-SEARCH.md §3 publishes', () => {
    expect(counts()).toEqual({ board: 4, class: 13, subject: 50, chapter: 333, topic: 711 });
  });

  it('holds the four boards, each with its own honest status label', () => {
    const all = boards().map((board) => ({
      slug: board.slug,
      short: board.short,
      status: board.status,
    }));
    expect(all).toEqual([
      { slug: 'cbse', short: 'CBSE', status: 'verified' },
      { slug: 'icse', short: 'ICSE', status: 'provisional' },
      { slug: 'isc', short: 'ISC', status: 'provisional' },
      { slug: 'nios', short: 'NIOS', status: 'verified' },
    ]);
    for (const board of boards()) {
      expect(board.label.length, board.slug).toBeGreaterThan(8);
      expect(board.edition, board.slug).not.toBe('');
    }
  });

  /** The negative half of the honest-count law: nothing under ICSE and ISC is invented. */
  it('gives ICSE and ISC chapters no topics at all, because their documents give us none', () => {
    for (const board of boards()) {
      if (board.slug !== 'icse' && board.slug !== 'isc') continue;
      for (const level of board.children) {
        for (const subject of level.children) {
          for (const chapter of subject.children) {
            expect(chapter.children, `${board.slug}/${chapter.slug}`).toEqual([]);
          }
        }
      }
    }
  });

  it('carries a source document and a hash on every chapter and every topic', () => {
    const naked: string[] = [];
    for (const board of boards()) {
      for (const level of board.children) {
        for (const subject of level.children) {
          for (const chapter of subject.children) {
            for (const node of [chapter, ...chapter.children]) {
              if (!node.source?.url || !node.source.hash) naked.push(`${board.slug}/${node.slug}`);
            }
          }
        }
      }
    }
    expect(naked).toEqual([]);
  });

  it('gives every chapter and topic a source that names a page or section of the document', () => {
    let withSection = 0;
    let total = 0;
    for (const board of boards()) {
      for (const level of board.children) {
        for (const subject of level.children) {
          for (const chapter of subject.children) {
            for (const node of [chapter, ...chapter.children]) {
              total += 1;
              if (node.source?.section) withSection += 1;
            }
          }
        }
      }
    }
    expect(total).toBe(333 + 711);
    expect(withSection).toBe(total);
  });

  it('gives every address a slug that can be a URL segment, and no two the same in one place', () => {
    const walk = (nodes: readonly { slug: string; children: readonly unknown[] }[]): void => {
      const seen = new Set<string>();
      for (const node of nodes) {
        expect(node.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
        expect(seen.has(node.slug), node.slug).toBe(false);
        seen.add(node.slug);
        walk(node.children as { slug: string; children: readonly unknown[] }[]);
      }
    };
    walk(boards());
  });
});

describe('finding a place in it', () => {
  it('walks down to a chapter and knows every layer above it', () => {
    const place = find({
      board: 'cbse',
      level: 'class-10',
      subject: 'mathematics',
      chapter: 'number-systems',
    });
    expect(place?.kind).toBe('chapter');
    expect(place?.board.short).toBe('CBSE');
    expect(place?.level?.name).toBe('Class 10');
    expect(place?.subject?.name).toBe('Mathematics');
    expect(place?.node.name).toBe('Number systems');
  });

  it('is null for a path we do not hold, which is a real 404 and not an empty page', () => {
    expect(find({ board: 'igcse' })).toBeNull();
    expect(find({ board: 'cbse', level: 'class-3' })).toBeNull();
    expect(find({ board: 'cbse', level: 'class-10', subject: 'astrophysics' })).toBeNull();
  });

  it('refuses a deeper part named without the part above it', () => {
    expect(find({ board: 'cbse', subject: 'mathematics' })).toBeNull();
    expect(find({ board: 'cbse', level: 'class-10', chapter: 'number-systems' })).toBeNull();
  });

  it('knows what sits either side, and nothing beyond the ends', () => {
    const subject = find({ board: 'cbse', level: 'class-10', subject: 'mathematics' });
    const chapters = subject?.node.children ?? [];
    const first = find({
      board: 'cbse',
      level: 'class-10',
      subject: 'mathematics',
      chapter: (chapters[0] as { slug: string }).slug,
    });
    expect(neighbours(first as NonNullable<typeof first>).before).toBeNull();
    expect(neighbours(first as NonNullable<typeof first>).after?.name).toBe(
      (chapters[1] as { name: string }).name,
    );
    const last = find({
      board: 'cbse',
      level: 'class-10',
      subject: 'mathematics',
      chapter: (chapters[chapters.length - 1] as { slug: string }).slug,
    });
    expect(neighbours(last as NonNullable<typeof last>).after).toBeNull();
  });
});

describe('the board-agnostic subject hubs', () => {
  it('has one per distinct subject, and every one is taught somewhere', () => {
    const hubs = subjects();
    expect(hubs.length).toBe(9);
    for (const hub of hubs) {
      expect(hub.places.length, hub.slug).toBeGreaterThan(0);
      for (const row of hub.places) expect(row.subject.slug).toBe(hub.slug);
    }
    // Every subject page in the tree is reachable from exactly one hub.
    const total = hubs.reduce((sum, hub) => sum + hub.places.length, 0);
    expect(total).toBe(counts().subject);
  });

  it('is null for a subject nobody sets', () => {
    expect(subjectHub('astrophysics')).toBeNull();
    expect(subjectHub('mathematics')?.name).toBe('Mathematics');
  });
});
