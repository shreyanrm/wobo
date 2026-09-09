/**
 * freehand — the seed of Wobo's pen. The wobble of every stroke is SEEDED from stable identity
 * (an object id, a kind), never from age or tick, so a mark is frozen the moment it is born and
 * does not shimmer at 60 fps: the same seed in gives byte-identical geometry out. The board's pen
 * (board/pen.ts) and the gesture layer's lasso draw from these.
 *
 * ~30 lines of mulberry32 + FNV instead of rough.js/seedrandom — smaller than the dep and direct
 * control of the draw-on. Self-check in test/freehand.test.ts.
 */

/** FNV-1a → 32-bit unsigned. Stable across runs; identity in, seed out. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — deterministic 0..1 stream from a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The rng for one stroke, seeded only from its stable identity. */
export function inkRng(id: string, mark: string, level: string): () => number {
  return mulberry32(hashSeed(id, mark, level));
}
