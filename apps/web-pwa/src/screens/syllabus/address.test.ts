import { describe, expect, it } from 'bun:test';
import { pathToRoute, routeToPath } from '../../shell/router';
import { addressFrom, addressPath, hubPath, isSlug, layerOf, parentOf } from './address';

describe('the address of a syllabus page', () => {
  it('is one path per layer, each a prefix of the next', () => {
    expect(addressPath({ board: 'cbse' })).toBe('/learn/cbse');
    expect(addressPath({ board: 'cbse', level: 'class-10' })).toBe('/learn/cbse/class-10');
    expect(addressPath({ board: 'cbse', level: 'class-10', subject: 'mathematics' })).toBe(
      '/learn/cbse/class-10/mathematics',
    );
    expect(
      addressPath({
        board: 'cbse',
        level: 'class-10',
        subject: 'mathematics',
        chapter: 'number-systems',
      }),
    ).toBe('/learn/cbse/class-10/mathematics/number-systems');
    expect(
      addressPath({
        board: 'cbse',
        level: 'class-10',
        subject: 'mathematics',
        chapter: 'number-systems',
        topic: 'real-numbers',
      }),
    ).toBe('/learn/cbse/class-10/mathematics/number-systems/real-numbers');
  });

  it('stops at the first missing segment rather than writing a hole into the path', () => {
    expect(addressPath({ board: 'cbse', subject: 'mathematics' })).toBe('/learn/cbse');
  });

  it('puts the board-agnostic subject pages under the pitch page that asks their question', () => {
    expect(hubPath('mathematics')).toBe('/subjects/mathematics');
  });

  it('reads segments back into an address, and refuses what cannot be one', () => {
    expect(addressFrom(['cbse', 'class-10'])).toEqual({ board: 'cbse', level: 'class-10' });
    expect(addressFrom([])).toBeNull();
    expect(addressFrom(['a', 'b', 'c', 'd', 'e', 'f'])).toBeNull();
    expect(addressFrom(['CBSE'])).toBeNull();
    expect(addressFrom(['cbse', 'class 10'])).toBeNull();
    expect(addressFrom(['-cbse'])).toBeNull();
  });

  it('knows which layer an address names', () => {
    expect(layerOf({ board: 'cbse' })).toBe('board');
    expect(layerOf({ board: 'cbse', level: 'class-10' })).toBe('class');
    expect(layerOf({ board: 'cbse', level: 'c', subject: 's' })).toBe('subject');
    expect(layerOf({ board: 'cbse', level: 'c', subject: 's', chapter: 'k' })).toBe('chapter');
    expect(layerOf({ board: 'cbse', level: 'c', subject: 's', chapter: 'k', topic: 't' })).toBe(
      'topic',
    );
  });

  it('walks up one layer at a time, and stops at the board', () => {
    const deep = { board: 'cbse', level: 'c', subject: 's', chapter: 'k', topic: 't' };
    expect(addressPath(parentOf(deep) as never)).toBe('/learn/cbse/c/s/k');
    expect(addressPath(parentOf(parentOf(deep) as never) as never)).toBe('/learn/cbse/c/s');
    expect(parentOf({ board: 'cbse' })).toBeNull();
  });

  it('accepts only the slugs the gateway writes', () => {
    expect(isSlug('class-10')).toBe(true);
    expect(isSlug('x')).toBe(true);
    expect(isSlug('')).toBe(false);
    expect(isSlug('Class-10')).toBe(false);
    expect(isSlug('a/b')).toBe(false);
    expect(isSlug('a'.repeat(81))).toBe(false);
  });
});

describe('the router answers these addresses', () => {
  it('round-trips every layer', () => {
    const paths = [
      '/learn/cbse',
      '/learn/cbse/class-10',
      '/learn/cbse/class-10/mathematics',
      '/learn/cbse/class-10/mathematics/number-systems',
      '/learn/cbse/class-10/mathematics/number-systems/real-numbers',
      '/subjects/mathematics',
    ];
    for (const path of paths) {
      const route = pathToRoute(path);
      expect(route, path).not.toBeNull();
      expect(routeToPath(route as never)).toBe(path);
    }
  });

  it('leaves /learn and /subjects to the pages that already own them', () => {
    expect(pathToRoute('/learn')).toEqual({ name: 'learn' });
    expect(pathToRoute('/subjects')).toEqual({ name: 'subjects' });
  });

  it('is a 404 for a sixth segment or a segment that is not a slug', () => {
    expect(
      pathToRoute('/learn/cbse/class-10/mathematics/number-systems/real-numbers/extra'),
    ).toBeNull();
    expect(pathToRoute('/learn/CBSE')).toBeNull();
    expect(pathToRoute('/subjects/mathematics/extra')).toBeNull();
  });
});
