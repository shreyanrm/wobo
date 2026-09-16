/**
 * THE QUALITY GATE, PROVEN OVER THE REAL SYLLABUS.
 *
 * The rule this file exists to hold: we publish only what we can prove (WOBO-TASKS §10.21), and a
 * page family generated at this scale is spam unless every page adds something (docs/GROWTH-SEARCH
 * §3). So the assertions here are the ones that would catch the family going wrong quietly:
 *
 *  · the counts are exactly the published ones, layer by layer, and they are the counts of pages
 *    that PASSED rather than of addresses that could be computed;
 *  · every published page carries a source document AND the hash of the bytes we read;
 *  · no two share a title or a heading, because two pages with one title are one page;
 *  · every published page says something no other published page says, which is the assertion the
 *    word floors are only a proxy for and the one that would have caught the 152 unit pages whose
 *    whole content was a shared constant;
 *  · the gate and `tree.hasPage` agree over every node, so the sitemap, the pre-render list and the
 *    links on a rendered page cannot disagree about which addresses exist;
 *  · the pace is honest: the topic family is built and not yet announced, because the drawn
 *    explanation that makes a topic page worth a visit is tier two (docs/GROWTH-SEARCH.md §4).
 */

import { describe, expect, it } from 'bun:test';
import { countWords, DESCRIPTION_MAX } from '../../shell/head';
import { pathToRoute } from '../../shell/router';
import { expandPublicRoutes, syllabusRoutes } from '../states/routes';
import { addressFrom } from './address';
import {
  collisions,
  FLOOR,
  gate,
  OWN_FLOOR,
  ownProse,
  pageProse,
  published,
  publishedPages,
  releasedLayers,
  releasedPages,
} from './pages';
import {
  boards,
  find,
  hasPage,
  OWN_TOPIC_FLOOR,
  ownChildren,
  type Place,
  PUBLISHED_LAYERS,
  pathOf,
  type Source,
} from './tree';

const PAGES = publishedPages();

/** Every page this build actually ships, with the place behind it, so a test can re-read its words. */
const SHIPPED: { path: string; place: Place }[] = releasedPages().flatMap((page) => {
  if (page.layer === 'hub') return [];
  const address = addressFrom(page.path.split('/').filter(Boolean).slice(1));
  const place = address ? find(address) : null;
  return place ? [{ path: page.path, place }] : [];
});

/** Every node in the tree, published or not, for the tests that are about the gate's decisions. */
const EVERY_PLACE: Place[] = (() => {
  const out: Place[] = [];
  const at = (address: Parameters<typeof find>[0]): void => {
    const place = find(address);
    if (place) out.push(place);
  };
  for (const board of boards()) {
    at({ board: board.slug });
    for (const level of board.children) {
      at({ board: board.slug, level: level.slug });
      for (const subject of level.children) {
        at({ board: board.slug, level: level.slug, subject: subject.slug });
        for (const chapter of subject.children) {
          const seat = { board: board.slug, level: level.slug, subject: subject.slug };
          at({ ...seat, chapter: chapter.slug });
          for (const topic of chapter.children) {
            at({ ...seat, chapter: chapter.slug, topic: topic.slug });
          }
        }
      }
    }
  }
  return out;
})();

describe('what the family publishes', () => {
  it('publishes exactly the counts docs/GROWTH-SEARCH.md §3 prints', () => {
    // NOT the 1,120 addresses the tree can compute. 152 of the 333 chapters are units two boards
    // publish with nothing under them, and 95 more hold fewer than three topics of their own or
    // fewer than fifteen words of their own; none of those pages has anything a reader cannot read
    // on the subject page above it, so none of them is published (docs/GROWTH-SEARCH.md §3,
    // WOBO-TASKS §10.21). The topic family passes 6 of 711, and ships none of them.
    expect(published(PAGES)).toEqual({
      board: 4,
      class: 13,
      subject: 50,
      chapter: 86,
      topic: 6,
      hub: 9,
      total: 168,
    });
  });

  it('gives no two pages the same title, heading or description', () => {
    expect(collisions(PAGES)).toEqual({ titles: [], headings: [], descriptions: [] });
  });

  it('gives every page its own address, and one the router answers', () => {
    const seen = new Set<string>();
    for (const page of PAGES) {
      expect(seen.has(page.path), page.path).toBe(false);
      seen.add(page.path);
      expect(pathToRoute(page.path), page.path).not.toBeNull();
    }
  });

  it('keeps every description inside what a search result can show', () => {
    for (const page of PAGES) {
      expect(page.description.length, page.path).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(page.description.length, page.path).toBeGreaterThan(40);
    }
  });

  it('leaves the thinnest page comfortably above the floor', () => {
    const words = PAGES.map((page) => page.words);
    const min = Math.min(...words);
    expect(min).toBeGreaterThan(FLOOR);
    // If this ever drops to the floor the family has lost content, not gained a rule.
    expect(min).toBeGreaterThanOrEqual(88);
  });
});

describe('the gate', () => {
  it('refuses a page with no source document, whatever else is on it', () => {
    const place = find({
      board: 'cbse',
      level: 'class-10',
      subject: 'mathematics',
      chapter: 'trigonometry',
    }) as Place;
    expect(gate(place)).toEqual([]);
    const naked: Place = { ...place, node: { ...place.node, source: null } };
    expect(gate(naked)).toContain('no_source');
    expect(gate(naked)).toContain('no_hash');
  });

  it('refuses a page whose provenance names a document with no hash behind it', () => {
    const place = find({ board: 'cbse', level: 'class-10' }) as Place;
    const unhashed: Place = {
      ...place,
      node: { ...place.node, source: { ...(place.node.source as Source), hash: null } },
    };
    expect(gate(unhashed)).toEqual(['no_hash']);
  });

  it('refuses a page whose subject matter has gone, however much frame is left', () => {
    // The frame alone (the provenance, the checks, the ask box) is about sixty words, so this is
    // the case a single whole-page floor would wave through: everything the page is ABOUT is gone.
    const place = find({
      board: 'cbse',
      level: 'class-10',
      subject: 'mathematics',
      chapter: 'number-systems',
    }) as Place;
    const stripped: Place = {
      ...place,
      node: {
        ...place.node,
        name: 'x',
        children: [],
        source: { ...(place.node.source as Source), section: null },
      },
    };
    expect(countWords(pageProse(stripped).join(' '))).toBeGreaterThan(40);
    expect(countWords(ownProse(stripped).join(' '))).toBeLessThan(OWN_FLOOR);
    expect(gate(stripped)).toContain('too_thin');
  });

  /**
   * THE 2026-09-17 FINDING. Four chapter pages sat at exactly the old floor of twelve, and every
   * one of them was its own name twice: "Number System is a chapter of CBSE class 9 maths with one
   * topic in it, Number System." The section of the document carried them over. A page reference
   * is not prose and a topic named as its chapter is not a topic list, so neither counts now.
   */
  it('refuses a chapter whose only topic is its own name, whatever its page reference says', () => {
    for (const address of [
      { board: 'cbse', level: 'class-9', subject: 'mathematics', chapter: 'number-system' },
      { board: 'cbse', level: 'class-9', subject: 'mathematics', chapter: 'coordinate-geometry' },
      { board: 'cbse', level: 'class-10', subject: 'mathematics', chapter: 'number-systems' },
      { board: 'cbse', level: 'class-10', subject: 'mathematics', chapter: 'coordinate-geometry' },
    ]) {
      const place = find(address) as Place;
      expect(place, JSON.stringify(address)).toBeTruthy();
      expect(gate(place), pathOf(place)).toContain('too_few_topics');
      expect(hasPage(place.node), pathOf(place)).toBe(false);
      const section = place.node.source?.section ?? '';
      expect(section.length).toBeGreaterThan(0);
      expect(ownProse(place).join(' ')).not.toContain(section);
    }
  });

  it('holds every chapter it ships to three topics and fifteen words of its own', () => {
    const chapters = SHIPPED.filter(({ place }) => place.kind === 'chapter');
    expect(chapters.length).toBe(86);
    for (const { path, place } of chapters) {
      expect(ownChildren(place.node).length, path).toBeGreaterThanOrEqual(OWN_TOPIC_FLOOR);
      expect(countWords(ownProse(place).join(' ')), path).toBeGreaterThanOrEqual(15);
    }
    expect(OWN_FLOOR).toBe(15);
  });

  /**
   * THE ONE THE OLD VERSION OF THIS FILE GOT WRONG, and it is worth stating plainly.
   *
   * `ownProse` used to hand back every string the page rendered, including a 26-word constant
   * about a missing topic list that is identical on 152 pages. Counted as a page's OWN words it
   * carried all 152 of them over a floor of twenty, which made the gate a decoration. So the
   * count now takes only what came off this node's data, and the floor is what a chapter with a
   * name, a real topic list and a page reference actually reaches.
   */
  it('counts only what came off this page, and holds the floor to it', () => {
    const unit = find({
      board: 'icse',
      level: 'class-9',
      subject: 'biology',
      chapter: 'basic-biology',
    }) as Place;
    expect(ownProse(unit).join(' ')).not.toContain('no chapter list under it');
    expect(countWords(ownProse(unit).join(' '))).toBeLessThan(OWN_FLOOR);
    expect(gate(unit)).toContain('nothing_of_its_own');

    const own = PAGES.filter((page) => page.layer !== 'hub').map((page) => page.ownWords);
    expect(Math.min(...own)).toBeGreaterThanOrEqual(OWN_FLOOR);
  });

  /**
   * THE ASSERTION THE FLOORS ARE ONLY A PROXY FOR: every published page says something that no
   * other published page says. A four-word run is the unit, because that is short enough that a
   * page whose only distinguishing feature is its own title still fails it.
   */
  it('gives every page it ships a run of words that no other page ships', () => {
    // Over what actually SHIPS. The topic family is built and held back (see the pace, below), and
    // a topic that carries a name and a page reference and nothing else is exactly why: several of
    // them read identically to a topic of the same name under another chapter. That is the tier
    // two problem, and the tier the concept cores fix, rather than a thing to publish now.
    const runs = new Map<string, number>();
    const per = SHIPPED.map(({ path, place }) => {
      const words = ownProse(place)
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
      const mine = new Set<string>();
      for (let i = 0; i + 4 <= words.length; i += 1) mine.add(words.slice(i, i + 4).join(' '));
      for (const run of mine) runs.set(run, (runs.get(run) ?? 0) + 1);
      return { path, mine };
    });
    const echoes = per
      .filter((page) => ![...page.mine].some((run) => runs.get(run) === 1))
      .map((page) => page.path);
    expect(echoes).toEqual([]);
  });

  /** The gate and the rule the running app links by must never say different things. */
  it('agrees with the rule a rendered page links by', () => {
    const disagreed = EVERY_PLACE.filter(
      (place) =>
        hasPage(place.node) !== (gate(place).length === 0 && PUBLISHED_LAYERS.includes(place.kind)),
    ).map((place) => pathOf(place));
    expect(disagreed).toEqual([]);
  });

  it('counts the words the template actually renders, not an estimate of them', () => {
    const place = find({
      board: 'icse',
      level: 'class-9',
      subject: 'biology',
      chapter: 'basic-biology',
    }) as Place;
    const prose = pageProse(place).join(' ');
    // The three things every page must carry are all in what was counted.
    expect(prose).toContain('Basic Biology');
    expect(prose).toContain('no topic list under it');
    expect(prose).toContain('page 4, Class IX, section 1');
    expect(prose).toContain('still checking it');
    expect(prose).toContain('Ask about Basic Biology');
  });
});

describe('the pace of the release', () => {
  it('holds the topic family back until tier two, and announces everything else', () => {
    expect(releasedLayers()).toEqual(['board', 'class', 'subject', 'chapter', 'hub']);
    const released = releasedPages();
    expect(published(released)).toEqual({
      board: 4,
      class: 13,
      subject: 50,
      chapter: 86,
      hub: 9,
      total: 162,
    });
  });

  it('lets the build set the pace without a code change', () => {
    expect(releasedLayers({ WOBO_SYLLABUS_LAYERS: 'none' })).toEqual([]);
    expect(releasedPages({ WOBO_SYLLABUS_LAYERS: 'none' })).toEqual([]);
    expect(releasedLayers({ WOBO_SYLLABUS_LAYERS: 'all' })).toEqual([
      'board',
      'class',
      'subject',
      'chapter',
      'topic',
      'hub',
    ]);
    expect(releasedPages({ WOBO_SYLLABUS_LAYERS: 'all' }).length).toBe(168);
    expect(releasedPages({ WOBO_SYLLABUS_LAYERS: 'board,class' }).length).toBe(17);
  });
});

describe('the sitemap the build writes', () => {
  it('carries every released syllabus address and nothing the gate refused', () => {
    const rows = syllabusRoutes({});
    expect(rows.length).toBe(162);
    for (const row of rows) {
      expect(row.path.startsWith('/learn/') || row.path.startsWith('/subjects/')).toBe(true);
      expect(pathToRoute(row.path), row.path).not.toBeNull();
    }
  });

  it('adds them to the other addresses without ever repeating one', () => {
    const all = expandPublicRoutes({ syllabus: syllabusRoutes({}) });
    const paths = all.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
    const mine = paths.filter(
      (path) => path.startsWith('/learn/') || /^\/subjects\/[^/]+$/.test(path),
    );
    expect(mine.length).toBe(162);
  });

  it('publishes none of them when the build says none', () => {
    const all = expandPublicRoutes({ syllabus: [] });
    expect(all.some((route) => route.path.startsWith('/learn/'))).toBe(false);
  });

  it('gives a chapter the highest priority in the family, because it is the page people want', () => {
    const chapter = PAGES.find((page) => page.layer === 'chapter');
    const topic = PAGES.find((page) => page.layer === 'topic');
    expect(Number(chapter?.priority)).toBeGreaterThan(Number(topic?.priority));
  });
});

describe('every published address resolves to a place we hold', () => {
  it('walks each one back through the router and the tree', () => {
    for (const page of PAGES) {
      if (page.layer === 'hub') continue;
      const segments = page.path.split('/').filter(Boolean).slice(1);
      const address = addressFrom(segments);
      expect(address, page.path).not.toBeNull();
      expect(find(address as never), page.path).not.toBeNull();
    }
  });
});
