/**
 * WHY THE FLOOR IS ON SCREEN DECIDES WHETHER THE DOWNLOAD SURVIVES IT.
 *
 * `seeded` says the learner is looking at the scaffold. It never said WHY, and the two whys pull in
 * opposite directions: a brain that answered with its seed means the queue's `ready` is stale and
 * wants correcting; a brain that never answered at all means the network is bad and the course the
 * learner owns is untouched.
 *
 * The guard used to be `!isOffline()`, which is `navigator.onLine === false`. Aeroplane mode sets
 * that flag. The phone this product is built for does not: on a village connection the radio is up,
 * `onLine` stays true and the requests simply time out. So for the child in the brief the guard was
 * not there at all, and opening a lesson they already owned on bad data ran the whole chain the
 * offline lab exists to prevent — the download flipped `ready` to `failed`, the gate in
 * `screens/Course.tsx` enqueued the topic again, and `router.back()` sent them home.
 *
 * These four cases are that decision, and the last one holds the browser's opinion out of it.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reconcilesDownload } from './Composing';

describe('a floor corrects a download only when the brain actually answered', () => {
  it('the brain answered with its seed: the ready entry was never ready, and is corrected', () => {
    // engine.compose returned, and what came back was the honest floor rather than this topic's
    // course. The queue saying "ready" over a page saying "not written yet" is the defect
    // reconcilePlaceholder exists for, and this is the one case that fires it.
    expect(reconcilesDownload(true, 'answered')).toBe(true);
  });

  it('nothing came back: the course the learner owns is left exactly as it was', () => {
    // The village phone in the brief. `navigator.onLine` is true, the radio is up, and the compose
    // timed out anyway. Before this, the floor was read as the brain's answer and the record of a
    // download the learner had already been given was destroyed by the act of opening it.
    expect(reconcilesDownload(true, 'unreachable')).toBe(false);
  });

  it('and the same holds with the aeroplane switch on, which is the easy half of it', () => {
    // Aeroplane mode reaches the identical branch: the call rejects, so nothing came back. The
    // reason is read off whether the request returned, never off what the browser believes about
    // the radio, so both phones are covered by one rule.
    expect(reconcilesDownload(true, 'unreachable')).toBe(false);
  });

  it('a real composed course is never a floor, whatever happened on the way to it', () => {
    for (const reason of ['answered', 'unreachable', null] as const) {
      expect(reconcilesDownload(false, reason)).toBe(false);
    }
  });

  it('a course still composing has decided nothing yet', () => {
    expect(reconcilesDownload(false, null)).toBe(false);
    expect(reconcilesDownload(true, null)).toBe(false);
  });
});

/**
 * The regression, held at the source. The decision is about what the brain did, and the moment it
 * consults the browser's online flag again it stops covering the phone it was written for.
 */
describe('the player never asks the browser whether it is online', () => {
  it('Composing.tsx decides this on the compose call, not on navigator.onLine', () => {
    const source = readFileSync(join(import.meta.dir, 'Composing.tsx'), 'utf8');
    // Comments explain a law; they do not break one. The rule above names the guard it replaced,
    // so the scan is of the code, the way `states/waiting-never-narrates.test.ts` reads a file.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1 ');
    expect(code).not.toContain('isOffline');
    expect(code).toContain('reconcilesDownload(');
  });

  it('hands the reason the compose call produced to the screen that reads it', () => {
    // THE GAP THIS EXISTS FOR, and it was live in this file for a while: `reason` worked out in the
    // compose effect, `floorReason` declared beside the course and passed down to the ink screen,
    // and nothing joining the two. It typechecks, because the prop is supplied; every case above
    // still passes, because the rule itself is right. And the reason is null for ever, so the
    // correction never fires at all and the placeholder a learner was told was ready stays ready.
    // A rule nobody hands an answer to is the wave-29 law repealed by the fix for this one.
    const source = readFileSync(join(import.meta.dir, 'Composing.tsx'), 'utf8');
    expect(source).toContain('setFloorReason(reason)');
  });
});
