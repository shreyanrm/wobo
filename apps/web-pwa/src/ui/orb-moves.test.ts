/**
 * The orb that moves — the proof that the library is RENDERED and not drawn (docs/EMAILS-AND-
 * ANIMATIONS.md §2 and §8, rule 1: one source).
 *
 * Every assertion here exists to catch a specific way the library could stop being one character:
 *
 *  - a GIF that is missing, or is not a GIF, or is not 480 px: the mail would fall back to alt text
 *  - a GIF over 600 KB: Gmail clips a message over 102 KB of HTML and a heavy image is the other
 *    half of a slow mail; the number is the design's, not a guess
 *  - a GIF that does not loop: a mail client shows one frame and the character is a still
 *  - a first frame that is not the RESTING orb: many clients (Outlook on Windows above all) freeze
 *    the first frame, so frame one is the picture most readers will ever see. It has to be Wobo at
 *    rest, and it has to be the same Wobo in all eight, or the eight moves are eight characters
 *  - a CSS file that drifted from the rendered motion: the product and the mail would move
 *    differently, which is rule 1 broken in the only place it can be broken silently
 *
 * The clock is handed in: `content/brand/orb/motion.json` is what the rig itself computed, frame by
 * frame, under a clock the renderer drove (tools/orb/render.mjs). Nothing here re-authors a move.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGif } from '../../../../tools/orb/gif.ts';
import {
  MAX_GIF_BYTES,
  MOVE_NAMES,
  MOVES,
  ORB_SIZE,
  type OrbMoveName,
} from '../../../../tools/orb/moves.ts';
import { orbMovesCss, type OrbMotion } from '../../../../tools/orb/css.ts';
import { decodePng } from '../../../../tools/orb/png.ts';

const ROOT = new URL('../../../..', import.meta.url).pathname;
const ORB_DIR = join(ROOT, 'content/brand/orb');
const CSS_FILE = join(ROOT, 'apps/web-pwa/src/ui/orb-moves.css');
const MOTION_FILE = join(ORB_DIR, 'motion.json');

const gifPath = (move: OrbMoveName) => join(ORB_DIR, `${move}.gif`);
const stillPath = (move: OrbMoveName) => join(ORB_DIR, `${move}.png`);

/** A channel of a decoded picture. The buffers are whole, so a read past the end is a bug, not a hole. */
function channel(buf: Uint8Array, i: number): number {
  const v = buf[i];
  if (v === undefined) throw new Error(`read past the end of a picture at ${i}`);
  return v;
}

/** How far apart one channel of one pixel is in two pictures. */
const gap = (a: Uint8Array, b: Uint8Array, i: number) => Math.abs(channel(a, i) - channel(b, i));

/** Mean absolute error per channel between two RGBA buffers of the same size. */
function meanError(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += gap(a, b, i) + gap(a, b, i + 1) + gap(a, b, i + 2);
  }
  return sum / ((a.length / 4) * 3);
}

/** The share of pixels where any channel is off by more than `tol`. */
function shareOver(a: Uint8Array, b: Uint8Array, tol: number): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (gap(a, b, i) > tol || gap(a, b, i + 1) > tol || gap(a, b, i + 2) > tol) {
      n += 1;
    }
  }
  return n / (a.length / 4);
}

/** The first frame of a decoded GIF, which every assertion about a frozen client is about. */
function openingFrame(move: OrbMoveName) {
  const gif = decodeGif(readFileSync(gifPath(move)), { maxFrames: 1 });
  const [opening] = gif.frames;
  if (!opening) throw new Error(`${move}.gif decoded to no frames at all`);
  return opening;
}

describe('the eight moves', () => {
  it('are the eight the design names, in the order the design gives them', () => {
    expect(MOVE_NAMES).toEqual([
      'hover',
      'wave',
      'bounce',
      'spark',
      'thinking',
      'drawing',
      'reading',
      'sleeping',
    ]);
  });

  it('each say what they are for, so nothing is decoration (rule 5)', () => {
    for (const name of MOVE_NAMES) {
      expect(MOVES[name].says.length).toBeGreaterThan(0);
      expect(MOVES[name].usedBy.length).toBeGreaterThan(0);
    }
  });
});

describe.each(MOVE_NAMES)('%s.gif', (move) => {
  it('exists and is under 600 KB', () => {
    expect(existsSync(gifPath(move))).toBe(true);
    expect(statSync(gifPath(move)).size).toBeLessThan(MAX_GIF_BYTES);
  });

  it('is a 480 px GIF that loops for ever and carries real motion', () => {
    const gif = decodeGif(readFileSync(gifPath(move)));
    expect(gif.version).toBe('GIF89a');
    expect(gif.width).toBe(ORB_SIZE);
    expect(gif.height).toBe(ORB_SIZE);
    // 0 is the Netscape extension's "for ever". A missing block is a one-shot animation.
    expect(gif.loopCount).toBe(0);
    expect(gif.frameCount).toBeGreaterThanOrEqual(8);
    // The GIF's own clock agrees with the move's, to the centisecond a GIF can express.
    expect(gif.durationMs).toBe(MOVES[move].frames * MOVES[move].frameMs);
  });

  it('opens on the resting orb — the frame a client that freezes one will show', () => {
    const opening = openingFrame(move);
    const still = decodePng(readFileSync(stillPath(move)));
    expect(still.width).toBe(ORB_SIZE);
    expect(still.height).toBe(ORB_SIZE);
    expect(opening.rgba.length).toBe(still.rgba.length);
    // The GIF frame is the still, quantised. Not identical; recognisably the same picture.
    expect(meanError(opening.rgba, still.rgba)).toBeLessThan(4);
    expect(shareOver(opening.rgba, still.rgba, 24)).toBeLessThan(0.01);
  });
});

describe('the eight are one character', () => {
  it('rest identically — the same orb, at rest, in every still', () => {
    const [firstMove, ...others] = MOVE_NAMES;
    if (!firstMove) throw new Error('the move table is empty');
    const first = decodePng(readFileSync(stillPath(firstMove)));
    for (const move of others) {
      const still = decodePng(readFileSync(stillPath(move)));
      expect(still.width).toBe(first.width);
      expect(still.height).toBe(first.height);
      expect(Buffer.compare(Buffer.from(still.rgba), Buffer.from(first.rgba))).toBe(0);
    }
  });
});

describe('orb-moves.css', () => {
  const css = () => readFileSync(CSS_FILE, 'utf8');

  it('is exactly what the rendered motion generates — never edited by hand', () => {
    const motion = JSON.parse(readFileSync(MOTION_FILE, 'utf8')) as OrbMotion;
    expect(css()).toBe(orbMovesCss(motion));
  });

  it('carries a class and keyframes for each of the eight', () => {
    const text = css();
    for (const move of MOVE_NAMES) {
      expect(text).toContain(`@keyframes wobo-orb-${move}`);
      expect(text).toContain(`.wobo-orb--${move}`);
    }
  });

  it('answers reduced motion with a still that keeps the spark', () => {
    const text = css();
    const at = text.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(at).toBeGreaterThan(-1);
    const block = text.slice(at);
    expect(block).toContain('animation: none');
    // The spark is what a still keeps (DESIGN.md §2, law 9; the library's rule 4).
    expect(block).toContain('.wobo-orb__spark');
    expect(block).toContain('opacity: 1');
  });

  /**
   * And answers the OTHER switch, which is the one a learner is actually offered.
   *
   * The app carries its own "Reduce motion · Still frames instead of animation" row on the You
   * screen (`ui/motion.ts`), and it stamps `data-motion="reduce"` on the document root rather than
   * touching the device's setting. `packages/motion`'s `useReducedMotion` counts that attribute as
   * EXACTLY equal to `prefers-reduced-motion`, in its own words, "so a learner without a
   * system-wide preference still gets still frames everywhere the library draws"; and every other
   * stylesheet in the app answers it (`screens/progress/progress.css`,
   * `screens/learn/Climb.css`, `ui/primitives/ui.css`).
   *
   * A sheet that answers only the media query leaves the orb moving for the learner who asked it to
   * stop, in the one place they were offered the ask. Rule 4 of the library is "reduced motion is a
   * still with the spark, everywhere, WITHOUT EXCEPTION", so the two switches are one rule here.
   */
  it("answers the app's own reduce-motion switch, not only the device's", () => {
    const text = css();
    const at = text.indexOf('[data-motion="reduce"] .wobo-orb__body');
    expect(at).toBeGreaterThan(-1);
    const block = text.slice(at);
    expect(block).toContain('animation: none');
    expect(block).toContain('transform: none');
    // The same still, and the same spark left on it, as the device's setting gets.
    expect(block).toContain('[data-motion="reduce"] .wobo-orb__prop');
    expect(block).toContain('[data-motion="reduce"] .wobo-orb__spark');
    expect(block).toContain('opacity: 1');
  });
});
