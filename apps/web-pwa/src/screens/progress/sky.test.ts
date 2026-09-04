/**
 * The constellation's geometry.
 *
 * The old twin placed eight stars by hand, so it could not be wrong about a syllabus it had never
 * seen. This one composes, which means it can be — a wedge that overlaps its neighbour, a star that
 * leaves the box, an order that reshuffles between visits. These tests are what keeps it honest for
 * a syllabus nobody has drawn.
 */

import { describe, expect, it } from 'bun:test';
import type { ProgressTopic, TopicState } from './evidence';
import { buildSky, newlyLit, SKY_H, SKY_W } from './sky';

function star(
  id: string,
  subject: string,
  chapter: string,
  state: TopicState = 'untouched',
  prereqTopicIds: string[] = [],
): ProgressTopic {
  return {
    id,
    name: `Topic ${id}`,
    subjectId: subject,
    subjectName: subject,
    chapterId: chapter,
    chapterName: `Chapter ${chapter}`,
    chapterIndex: Number(chapter.replace(/\D/g, '')) || 1,
    order: 0,
    prereqTopicIds,
    state,
  };
}

const TWO_SUBJECTS: ProgressTopic[] = [
  star('m1', 'Mathematics', 'c1', 'learnt'),
  star('m2', 'Mathematics', 'c1', 'learnt', ['m1']),
  star('m3', 'Mathematics', 'c2', 'debt', ['m2']),
  star('m4', 'Mathematics', 'c2', 'started', ['m3']),
  star('p1', 'Physics', 'p1', 'untouched'),
  star('p2', 'Physics', 'p1', 'untouched', ['p1']),
  star('p3', 'Physics', 'p2', 'untouched', ['p2', 'm4']),
];

describe('buildSky', () => {
  it('an empty syllabus makes an empty sky, not a starless void with a legend under it', () => {
    const sky = buildSky([]);
    expect(sky.stars).toEqual([]);
    expect(sky.edges).toEqual([]);
    expect(sky.subjects).toEqual([]);
  });

  it('is composed, not simulated: the same syllabus gives the same sky every visit', () => {
    expect(buildSky(TWO_SUBJECTS)).toEqual(buildSky(TWO_SUBJECTS));
  });

  it('keeps the syllabus order, which is the order a keyboard walks it in', () => {
    expect(buildSky(TWO_SUBJECTS).stars.map((s) => s.id)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('keeps every star inside the box, at any number of subjects', () => {
    for (const count of [1, 2, 3, 5, 8]) {
      const topics = Array.from({ length: count * 4 }, (_, i) =>
        star(`t${i}`, `S${Math.floor(i / 4)}`, `c${i % 2}`),
      );
      for (const s of buildSky(topics).stars) {
        expect(s.x).toBeGreaterThan(0);
        expect(s.y).toBeGreaterThan(0);
        expect(s.x).toBeLessThan(SKY_W);
        expect(s.y).toBeLessThan(SKY_H);
      }
    }
  });

  it('gives each subject its own wedge — two subjects never share an angle', () => {
    const sky = buildSky(TWO_SUBJECTS);
    // measured from twelve o'clock, where the first wedge starts, so nothing straddles atan2's cut
    const from12 = (s: { x: number; y: number }) =>
      (Math.atan2(s.y - sky.cy, s.x - sky.cx) + Math.PI / 2 + 4 * Math.PI) % (2 * Math.PI);
    const angles = new Map<string, number[]>();
    for (const s of sky.stars) {
      angles.set(s.subjectId, [...(angles.get(s.subjectId) ?? []), from12(s)]);
    }
    const maths = angles.get('Mathematics') as number[];
    const physics = angles.get('Physics') as number[];
    expect(Math.max(...maths)).toBeLessThan(Math.min(...physics));
  });

  it('puts a later chapter further out than an earlier one', () => {
    const sky = buildSky(TWO_SUBJECTS);
    const radius = (id: string) => {
      const s = sky.stars.find((x) => x.id === id);
      return s ? Math.hypot(s.x - sky.cx, s.y - sky.cy) : 0;
    };
    expect(radius('m3')).toBeGreaterThan(radius('m1'));
  });

  it('draws a prerequisite only when both ends are on the board', () => {
    const sky = buildSky([...TWO_SUBJECTS, star('x1', 'Physics', 'p2', 'untouched', ['nowhere'])]);
    expect(sky.edges.some((e) => e.toId === 'x1')).toBe(false);
    expect(sky.edges.map((e) => e.id)).toContain('m1->m2');
  });

  it('lights a prerequisite only when the learner has actually walked both of its ends', () => {
    const sky = buildSky(TWO_SUBJECTS);
    expect(sky.edges.find((e) => e.id === 'm1->m2')?.lit).toBe(true);
    expect(sky.edges.find((e) => e.id === 'm2->m3')?.lit).toBe(false);
  });

  it('counts what each subject holds, for the roll-up under the map', () => {
    const sky = buildSky(TWO_SUBJECTS);
    expect(sky.subjects).toHaveLength(2);
    expect(sky.subjects[0]).toMatchObject({ id: 'Mathematics', topics: 4, learnt: 2 });
    expect(sky.subjects[1]).toMatchObject({ id: 'Physics', topics: 3, learnt: 0 });
  });

  it('a single subject takes the whole circle rather than sitting in a tenth of it', () => {
    const only = TWO_SUBJECTS.filter((t) => t.subjectId === 'Mathematics');
    const sky = buildSky(only);
    const spread = sky.stars.map(
      (s) => (Math.atan2(s.y - sky.cy, s.x - sky.cx) + Math.PI / 2 + 4 * Math.PI) % (2 * Math.PI),
    );
    expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(Math.PI);
  });

  it('staggers its rings, so chapters of equal length never line up into spokes', () => {
    const even = [
      star('a1', 'S', 'c1'),
      star('a2', 'S', 'c1'),
      star('b1', 'S', 'c2'),
      star('b2', 'S', 'c2'),
    ];
    const sky = buildSky(even);
    const angle = (id: string) => {
      const s = sky.stars.find((x) => x.id === id);
      return s ? Math.atan2(s.y - sky.cy, s.x - sky.cx) : 0;
    };
    expect(angle('a1')).not.toBeCloseTo(angle('b1'), 3);
  });

  it('every curve is a path a browser can draw', () => {
    for (const edge of buildSky(TWO_SUBJECTS).edges) {
      expect(edge.d).toMatch(/^M[-\d.]+ [-\d.]+ Q[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/);
    }
  });
});

describe('newlyLit', () => {
  it('is what became theirs since this session last looked', () => {
    expect(newlyLit(new Set(['a', 'b', 'c']), new Set(['a']))).toEqual(['b', 'c']);
  });

  it('is empty when nothing has changed, so nothing replays on a reload', () => {
    expect(newlyLit(new Set(['a']), new Set(['a', 'b']))).toEqual([]);
  });
});
