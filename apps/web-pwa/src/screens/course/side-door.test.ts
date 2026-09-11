import { describe, expect, it } from 'bun:test';
import { parseArcade } from '../../engines/arcade/spec';
import { DOOR_LINE, doorPositions, everyFor, offerFor, sitsAtADoor } from './side-door';

/**
 * THE SIDE DOOR (docs/CONTENT-INTERACTION.md §7).
 *
 * *"In the middle, not the end. After every second or third topic of a chapter, a bonus level
 * appears as a side door off the climb: optional, never in the path, never a nag. The boss level
 * stays the summit."*
 *
 * Every test below is one clause of that sentence.
 */

/** A recall level: a door every third topic, which is the default stride. */
const spec = parseArcade({
  id: 'bonus-3-sort',
  title: 'the sevens',
  game: 'sort',
  skill: 'recall',
  seconds: 45,
  rounds: [{ id: 'r1', prompt: 'smallest first', order: ['42', '49', '56'] }],
});

/** A speed level: a door every SECOND topic, because going faster is the whole skill. */
const fast = parseArcade({
  id: 'bonus-2-line',
  title: 'fractions on the line',
  game: 'numberline',
  skill: 'speed',
  seconds: 40,
  rounds: [{ id: 'r1', prompt: 'three quarters', target: 0.75, min: 0, max: 1, tolerance: 0.06 }],
});

const chapter = { chapterId: 'ch-1', chapterName: 'multiplication tables', topicId: 't3' };

describe('where a door may sit', () => {
  it('sits in the middle, after every third topic by default', () => {
    expect(doorPositions(9, 3)).toEqual([3, 6]);
    expect(doorPositions(7, 3)).toEqual([3, 6]);
    expect(doorPositions(6, 3)).toEqual([3]);
  });

  it('sits after every second topic where speed is the whole skill', () => {
    expect(everyFor('speed')).toBe(2);
    expect(everyFor('recall')).toBe(3);
    expect(doorPositions(7, 2)).toEqual([2, 4, 6]);
  });

  it('never sits where the boss stands, at any chapter length', () => {
    for (let topics = 1; topics < 20; topics++) {
      for (const every of [2, 3]) {
        expect(doorPositions(topics, every).every((p) => p < topics)).toBe(true);
      }
    }
  });

  it('gives a chapter too short to have a middle no door at all', () => {
    expect(doorPositions(3, 3)).toEqual([]);
    expect(doorPositions(2, 2)).toEqual([]);
    expect(doorPositions(1, 3)).toEqual([]);
  });

  it('answers for one topic at a time, which is how a course asks', () => {
    expect(sitsAtADoor(3, 9, 'recall')).toBe(true);
    expect(sitsAtADoor(4, 9, 'recall')).toBe(false);
    expect(sitsAtADoor(9, 9, 'recall')).toBe(false); // the last one is the boss's
  });
});

describe('the offer itself', () => {
  it('is made where a door sits and the course really carried a level', () => {
    const offer = offerFor({ ...chapter, spec, position: 3, topics: 9 });
    expect(offer).not.toBeNull();
    expect(offer?.spec.game).toBe('sort');
    expect(offer?.line).toBe(DOOR_LINE);
  });

  it('is not made where no door sits, however good the level is', () => {
    expect(offerFor({ ...chapter, spec, position: 4, topics: 9 })).toBeNull();
  });

  it('follows the level’s OWN stride: a speed level opens a door every second topic', () => {
    expect(offerFor({ ...chapter, spec: fast, position: 2, topics: 9 })).not.toBeNull();
    expect(offerFor({ ...chapter, spec: fast, position: 3, topics: 9 })).toBeNull();
  });

  it('is not made at the last topic, because the boss is there', () => {
    expect(offerFor({ ...chapter, spec, position: 9, topics: 9 })).toBeNull();
  });

  it('is not made when the course carried no level, and nothing is invented', () => {
    expect(offerFor({ ...chapter, spec: null, position: 3, topics: 9 })).toBeNull();
  });

  it('is not made when the level is one this client cannot render', () => {
    expect(parseArcade({ id: 'x', title: 'x', game: 'platformer', rounds: [] })).toBeNull();
  });
});

describe('optional, never in the path, never a nag', () => {
  it('says so in its own words, in the register', () => {
    expect(DOOR_LINE.includes('—')).toBe(false);
    expect(DOOR_LINE.includes('!')).toBe(false);
    // it says the climb goes on without it, which is the whole promise
    expect(DOOR_LINE.toLowerCase()).toContain('without it');
  });

  it('carries no route that could replace what comes next', () => {
    const offer = offerFor({ ...chapter, spec, position: 3, topics: 9 });
    // the offer names the level and the chapter, and nothing about where the course goes next.
    expect(Object.keys(offer ?? {}).sort()).toEqual([
      'chapterId',
      'chapterName',
      'line',
      'position',
      'spec',
      'topicId',
      'why',
    ]);
  });
});
