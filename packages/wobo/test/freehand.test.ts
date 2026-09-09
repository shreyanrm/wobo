import { describe, expect, it } from 'bun:test';
import { hashSeed, inkRng, mulberry32 } from '../src/freehand';

describe('freehand — the seeded pen', () => {
  it('the same identity gives the same stream (no 60fps shimmer)', () => {
    const a = inkRng('t1', 'circle', 'wobo');
    const b = inkRng('t1', 'circle', 'wobo');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('a different identity gives a different stream (a real hand never repeats a stroke)', () => {
    const a = inkRng('t1', 'circle', 'wobo');
    const b = inkRng('t2', 'circle', 'wobo');
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('hashSeed is stable and deterministic', () => {
    expect(hashSeed('a', 'b', 1)).toBe(hashSeed('a', 'b', 1));
    expect(hashSeed('a', 'b', 1)).not.toBe(hashSeed('a', 'b', 2));
  });

  it('mulberry32 stays inside [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
