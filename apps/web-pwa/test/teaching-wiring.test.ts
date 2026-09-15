import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE WIRING, HELD DOWN.
 *
 * Every case here is a seam that was built and then left unconnected, or a claim in a comment that
 * the code did not keep. They are source-level on purpose: what went wrong was not a wrong answer
 * inside a function, it was a function nobody called and a promise nobody kept, and that is what a
 * scan can see. A behaviour that CAN be tested by running it is tested by running it, next to the
 * module it belongs to; these are the ones about who calls what.
 */

const SRC = join(import.meta.dir, '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const ALL = walk(SRC);
const PRODUCTION = ALL.filter((p) => !/\.test\.tsx?$/.test(p));
const read = (path: string) => readFileSync(path, 'utf8');
const source = (relative: string) => read(join(SRC, relative));

/** Every production file that names this symbol. Tests do not count: a test is not a caller. */
function callers(symbol: string): string[] {
  const re = new RegExp(`\\b${symbol}\\b`);
  return PRODUCTION.filter((p) => re.test(read(p))).map((p) => p.slice(SRC.length + 1));
}

/**
 * `subscribeGround` and `skipPlacement` shipped with tests and no callers: the screen re-implemented
 * the claim inline, and nothing in the product ever learnt a floor that settled after it started.
 * `clearPlacements` carried the comment "the You screen's clear what Wobo knows reaches this" while
 * nothing reached it, so a claim was unerasable.
 */
describe('the placement module’s seams are joined to the product', () => {
  for (const seam of ['subscribeGround', 'skipPlacement', 'clearPlacements', 'forgetPlacement']) {
    it(`${seam} is called by something that ships`, () => {
      const outside = callers(seam).filter((p) => !p.startsWith('curriculum/placement.ts'));
      expect(outside.length).toBeGreaterThan(0);
    });
  }

  it('the erase path reaches everything Wobo keeps about a learner', () => {
    const capabilities = source('wobo/capabilities.ts');
    const forget = capabilities.slice(capabilities.indexOf('forget_all: {'));
    expect(forget).toContain('clearMind()');
    expect(forget).toContain('clearPlacements()');
    expect(forget).toContain('resetReteach()');
  });

  it('and sign-out takes them off the device with the rest of the learner’s world', () => {
    const scope = source('store/scope.ts');
    expect(scope).toContain("'wobo-placement-v1'");
    expect(scope).toContain("'wobo-reteach-v1'");
  });
});

/**
 * The re-teach ladder writes Wobo's new explanation into the drawer and asks for it on the
 * learner's behalf. Both facts have consequences: the drawer has to open, or the teaching is
 * invisible; and the ask must not be recorded as the learner's own words, or a child scrolling
 * their conversation later finds requests they never made.
 */
describe('a re-teach reaches the learner, in Wobo’s voice', () => {
  const sites = ['screens/course/PracticeRun.tsx', 'screens/course/Composing.tsx'];

  for (const site of sites) {
    it(`${site} opens the drawer the new explanation lands in`, () => {
      const text = source(site);
      expect(text).toContain('openCompanion(');
    });

    it(`${site} asks silently, so the archive holds only the learner’s own words`, () => {
      const text = source(site);
      expect(text).toContain('{ silent: true }');
      // and nothing on this path asks in the loud way any more
      expect(text).not.toMatch(/ask\(turn\.ask\)/);
    });
  }

  it('the drawer has a second opener, and it is the signal module', () => {
    expect(source('wobo/Companion.tsx')).toContain('subscribeCompanionOpen(');
  });
});

/**
 * The bridge is the run-up to a lesson. It appeared in exactly one of the two course players, and
 * the one it skipped is the atom: the only node with verifier-frozen practice items, and therefore
 * the only place the placement check can ask a real checked question instead of a self report.
 */
describe('both course players lay the bridge', () => {
  for (const player of ['screens/course/Composing.tsx', 'screens/course/AtomJourney.tsx']) {
    it(`${player} renders it`, () => {
      expect(source(player)).toContain('<BridgeStep');
    });
  }

  it('reading the ground under a topic is never paid for', () => {
    const composing = source('screens/course/Composing.tsx');
    // The act/check effect is the one that pays 15 XP for pressing Check. The bridge has to be out
    // of it before the effect's body runs, on the same early return as the other self-barred cards.
    const guard = composing
      .split('\n')
      .find((line) => line.includes('card.discovery || card.activity'));
    expect(guard).toBeDefined();
    expect(guard).toContain("card.id === 'bridge'");
  });
});

/**
 * The check returned INSTEAD of the app frame, at 100dvh, with no back, no nav rail, no bottom bar,
 * and two exits: answer every question, or the irreversible claim. The copy under the button said
 * "nothing here is a wall".
 */
describe('the check is advice, and looks like it', () => {
  it('has a way out that records nothing', () => {
    const check = source('screens/onboarding/PlacementCheck.tsx');
    expect(check).toContain('onSkip');
    expect(check).toContain('Not now');
  });

  it('no longer holds the whole viewport on its own', () => {
    expect(source('screens/onboarding/PlacementCheck.tsx')).not.toContain('100dvh');
  });

  it('sits inside the app, with the same frame as the lesson it precedes', () => {
    const course = source('screens/Course.tsx');
    const gate = course.slice(course.indexOf("placement.status === 'checking'"));
    const frameEnds = gate.indexOf('</AppFrame>');
    expect(frameEnds).toBeGreaterThan(-1);
    expect(gate.slice(0, frameEnds)).toContain('<PlacementCheck');
  });
});

/**
 * The wave's copy law: no em dashes in code comments or copy. These are the modules the wave wrote
 * or reworked; the house style in files it did not touch is not this test's business.
 */
describe('the copy law holds in the files this work owns', () => {
  const owned = [
    'screens/learn/mastery.ts',
    'screens/learn/units.ts',
    'store/mastery.tsx',
    'wobo/reteach.ts',
    'wobo/bridge.ts',
    'wobo/drawer.ts',
    'curriculum/placement.ts',
    'curriculum/prereq.ts',
    'screens/course/BridgeStep.tsx',
    'screens/onboarding/PlacementCheck.tsx',
  ];
  for (const file of owned) {
    it(`${file} carries no em dash`, () => {
      expect(source(file)).not.toContain('—');
    });
  }
});

/**
 * THE PLAN EVERY BOARD SHARES WAS A LIST, NOT A DOOR.
 *
 * `DiscoveryCard`'s `onStart` was optional and no screen passed one, so `SharedPlanClimb` rendered
 * each concept as a `<div>` and a learner on one of the 264 boards with no syllabus read two dozen
 * names and could press none of them. docs/BOARD-COLD-START.md §2.4 says "they start anyway... and
 * the first lesson begins"; this is the half that makes the second clause true.
 */
describe('the plan every board shares is something a learner can start', () => {
  const sites = PRODUCTION.filter((p) => /<DiscoveryCard/.test(read(p)));
  const rel = (p: string) => p.slice(SRC.length + 1);

  it('is rendered by more than one surface, so no single screen can be the only door', () => {
    expect(sites.length).toBeGreaterThanOrEqual(2);
  });

  for (const site of sites) {
    it(`${rel(site)} gives the rows somewhere to go`, () => {
      expect(read(site)).toContain('onStart=');
    });
  }

  it('and the card cannot be rendered without one', () => {
    const card = source('curriculum/StatusCard.tsx');
    expect(card).not.toContain('onStart?(');
    expect(card).toContain('onStart(concept:');
  });

  it('every row is a control, never a paragraph dressed as one', () => {
    const card = source('curriculum/StatusCard.tsx');
    const climb = card.slice(card.indexOf('function SharedPlanClimb'));
    expect(climb).toContain('<button');
    expect(climb).not.toContain('cursor: onStart');
  });

  /**
   * The card mounts only once the answer is in hand, so a clock started at mount charges the
   * learner the fetch AND the whole eight seconds. The two learn surfaces hand it the moment the
   * learner asked, which is the only place that knows it.
   */
  for (const site of ['screens/Learn.tsx', 'screens/SubjectScreen.tsx']) {
    it(`${site} counts the designed wait from when the learner asked`, () => {
      expect(source(site)).toContain('since={units.since}');
    });
  }
});
