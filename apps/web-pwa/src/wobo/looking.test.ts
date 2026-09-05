import { describe, expect, it } from 'bun:test';
import { SurfaceRegistry } from '@wobo/wobo';
import { lookingAt } from './looking';

const registry = () => {
  const r = new SurfaceRegistry();
  r.registerSurface({
    id: 'course',
    title: 'the course player',
    targets: [
      {
        id: 'download-center',
        kind: 'queue',
        label: 'the courses being composed for you right now',
        rect: () => ({ x: 430, y: 637, width: 420, height: 67 }),
      },
      {
        id: 'course-advance',
        kind: 'control',
        label: 'the button that moves this lesson on',
        rect: () => ({ x: 720, y: 672, width: 140, height: 38 }),
      },
    ],
  });
  return r;
};

describe('the optimistic point lands only on what the words are about', () => {
  it('rings nothing for a greeting', () => {
    expect(lookingAt('hello', registry())).toBeNull();
    expect(lookingAt('thanks, that helped', registry())).toBeNull();
  });
  it('rings the thing a question names', () => {
    expect(lookingAt('which button moves this lesson on?', registry())).toBe('course-advance');
    expect(lookingAt('draw a ring round the button that moves this lesson on', registry())).toBe(
      'course-advance',
    );
  });
  it('never falls back to the first target on the screen', () => {
    // "show me the working" names nothing registered; the old code rang the toast.
    expect(lookingAt('show me the working', registry())).toBeNull();
    expect(lookingAt('what is a prime number?', registry())).toBeNull();
  });
});
