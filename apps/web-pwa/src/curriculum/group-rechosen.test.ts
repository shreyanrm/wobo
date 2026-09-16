/**
 * THE GROUP IS RE-CHOSEN AFTER EVERY MODULE, AND A LEARNER IS PLAYED TO PROVE IT.
 *
 * docs/LEARNING-MODEL.md, "The tutor never leaves" (the owner, 2026-09-15), rule 1: *"After every
 * module the group that teaches the topic is re-chosen from the chapter's pool using what just
 * happened (right, wrong, how wrong, how slow, what they said) ... Not once at the start. A learner
 * who gets a module wrong twice gets a different module next, never the same one again, and never a
 * harder one."*
 *
 * WHAT WAS FALSE BEFORE THIS FILE. `groupFor` chose from four lists that say what a learner KNOWS
 * (unmet ground, misconceptions shown, ideas held, style), and not one of them can change by doing
 * a module and failing it. So the group a learner got at the door was the group they still had
 * after the fourth wrong answer, and the next thing in it was the module that had just failed them,
 * because a module nobody finished is not finished. The pool even carried the architect's own
 * answer for that learner (`flow.stuck`, *"what a stuck learner is shown INSTEAD"*) and the
 * selection never once read it.
 *
 * HOW THIS IS PLAYED RATHER THAN ASSERTED. A learner walks a sequence of modules out of the REAL
 * chapter pool (`suggest/fixture.ts`, the CBSE class 8 Science cell the blueprint suite and both
 * sibling played tests use) through the REAL climb (`groupFor`), and their misses are counted by
 * the REAL tally the rest of the product already uses for this (`wobo/reteach.ts`'s
 * `noteConceptMiss` and `RETEACH_AFTER_MISSES`), so nothing here invents a second opinion about
 * when a learner is struggling. They get things wrong, they get one wrong twice, they are slow,
 * they get one right after getting it wrong, and after every single module the group is asked for
 * again. No model is called and no network is touched at any point, because a group is a selection
 * out of a pool that already exists: that is the property that makes adapting free, and a test that
 * needed a model to prove it would have disproved it.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import type { Blueprint, BlueprintModule, ModuleRole } from './blueprint';

/**
 * Bun has no browser storage and the real miss tally is durable on purpose (a learner who closes
 * the tab mid-struggle must not be handed the module that already failed them). Installed before
 * the imports below, and with `??` rather than an assignment: `bun test` runs every file in one
 * process and about ten of them install a stand-in like this, so clobbering one that is already
 * there takes the store out from under whichever file loaded first.
 */
class MemoryStorage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}
const g = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage };
g.localStorage = g.localStorage ?? (new MemoryStorage() as unknown as Storage);
g.sessionStorage = g.sessionStorage ?? (new MemoryStorage() as unknown as Storage);

const { groupFor, progressAlong } = await import('./blueprint');
const { pool } = await import('../suggest/fixture');
const { conceptMisses, noteConceptCorrect, noteConceptMiss, RETEACH_AFTER_MISSES, resetReteach } =
  await import('../wobo/reteach');

const BP = pool();
/** Pressure. The topic this learner opened. */
const TOPIC = 't4';

/**
 * How far down a module sits, stated here from the law rather than imported, so that a change to
 * the ladder in `blueprint.ts` has to face this file rather than agree with itself.
 */
const DEPTH: Record<ModuleRole, number> = {
  prerequisite: 0,
  repair: 1,
  way_in: 2,
  side_door: 2,
  check: 3,
  stretch: 4,
  boss: 5,
};

/** Every module of the chapter's pool, which is what a screen would have in hand. */
const ALL_IDS = BP.modules.map((m) => m.id);

/**
 * THE LEARNER, PLAYED.
 *
 * One object, holding only what a screen actually holds: what they have finished, and nothing else.
 * Whether they are stuck is never stored here. It is asked of the real tally every time the group
 * is chosen, which is exactly the shape the product has to use, because a group that reads a
 * remembered verdict is a group chosen once again with extra steps.
 */
class Learner {
  readonly done = new Set<string>();

  /**
   * Whose tally this is. In the product the ladder's memory is scoped to the learner already
   * (`store/scope.ts`, so a sibling on the same tablet climbs their own), and two learners in one
   * test are two scopes for the same reason. Keying the misses is how this file gets that without
   * reaching into the scope machinery, and without it the second learner below reads the first
   * learner's misses and the two of them walk one road by accident.
   */
  constructor(private readonly who = 'one') {}

  private key(moduleId: string): string {
    return `${this.who}:${moduleId}`;
  }

  /** How many times this learner has missed this module. */
  misses(moduleId: string): number {
    return conceptMisses(this.key(moduleId));
  }

  /** The modules the real tally says have stopped working: a pattern, not a slip. */
  stuckOn(): string[] {
    return ALL_IDS.filter((id) => this.misses(id) >= RETEACH_AFTER_MISSES);
  }

  /** The group as it stands RIGHT NOW, re-chosen from the pool against what just happened. */
  group(): BlueprintModule[] {
    return groupFor(BP, TOPIC, { stuckOn: this.stuckOn() });
  }

  /** The one thing that follows, which is what a screen puts in front of them next. */
  next(): BlueprintModule | undefined {
    return this.group().find((m) => !this.done.has(m.id));
  }

  /** They got it wrong. One miss is a slip; the tally decides when it becomes a pattern. */
  missed(moduleId: string): void {
    noteConceptMiss(this.key(moduleId));
  }

  /** They got it, however long it took. Nothing about arriving late is held against them. */
  landed(moduleId: string): void {
    noteConceptCorrect(this.key(moduleId));
    this.done.add(moduleId);
  }
}

beforeEach(() => {
  resetReteach();
});

// --- the walk -------------------------------------------------------------------------------------

describe('a learner who gets a module wrong twice is never handed it back', () => {
  /**
   * THE SEQUENCE, END TO END: wrong, wrong again, a different module, slow, wrong, then right.
   *
   * Every step asks the pool for the group again and looks at what a screen would show. The
   * assertions are about what the product did to this learner on the way, in order.
   */
  it('walks a sequence and is given a different module every time one stops working', () => {
    const learner = new Learner();
    const seen: string[] = [];
    const record = () => {
      const next = learner.next();
      expect(next, 'the learner was left with nothing to do').toBeDefined();
      seen.push(next?.id ?? '');
      return next as BlueprintModule;
    };

    // They open Pressure. The pool's own first way in is what they meet.
    const first = record();
    expect(first.role).toBe('way_in');
    expect(first.id).toBe('p9');

    // ONE WRONG ANSWER IS A SLIP. A tutor who changes tack on a single miss teaches nothing, so
    // the group is unchanged and they get another go at the same module. This is the case the
    // rule does NOT cover, and it has to keep working or the fix has broken good behaviour.
    learner.missed('p9');
    expect(learner.misses('p9')).toBe(1);
    expect(record().id).toBe('p9');

    // THE SECOND MISS IS A PATTERN, and this is the line the owner wrote. The group is re-chosen
    // and what follows is a DIFFERENT module.
    learner.missed('p9');
    expect(learner.misses('p9')).toBe(RETEACH_AFTER_MISSES);
    const afterStuck = record();
    expect(afterStuck.id).not.toBe('p9');
    // never the same one again: it is gone from the group, not merely later in it
    expect(learner.group().map((m) => m.id)).not.toContain('p9');
    // never a harder one
    expect(DEPTH[afterStuck.role]).toBeLessThanOrEqual(DEPTH.way_in);
    // and it is the road the ARCHITECT wrote for exactly this module, not one this client invented
    expect(afterStuck.id).toBe('p10');
    expect(BP.flow.stuck.find((s) => s.module === 'p9')?.instead).toBe('p10');

    // THEY ARE SLOW ON IT AND MISS ONCE, then come back and get it. A miss that is answered is not
    // a pattern, so the tally clears and nothing about the road is held against them.
    learner.missed('p10');
    expect(record().id).toBe('p10');
    learner.landed('p10');
    expect(learner.misses('p10')).toBe(0);

    // The check is what follows a way in that landed. They are being asked for the idea back
    // because they have now got it, which is the only reason a check is ever the next thing.
    const check = record();
    expect(check.role).toBe('check');
    expect(check.id).toBe('c2');

    // THEY MISS THE CHECK TWICE. A check that keeps failing is not re-run and is not followed by
    // the stretch: the tutor goes back UNDER the idea.
    learner.missed('c2');
    learner.missed('c2');
    const afterCheck = record();
    expect(afterCheck.id).not.toBe('c2');
    expect(DEPTH[afterCheck.role]).toBeLessThan(DEPTH.check);
    expect(afterCheck.role).toBe('repair');

    // Nothing in the whole played run was ever offered twice after it stopped working, and the
    // learner was never once left without a next thing.
    expect(seen.filter((id) => id === 'p9').length).toBe(2);
    expect(seen).not.toContain('b1');
    expect(seen).not.toContain('g2');
  });

  /**
   * THE LEARNER WHO FAILS EVERY WAY IN. The pool holds two roads into "pressure is the force spread
   * over the area it presses on" and this learner has now failed both. The tutor does not hand back
   * either of them and does not move up to the check: it goes under the idea, which is what the
   * repair module is for.
   */
  it('goes under the idea when every way into it has stopped working', () => {
    const learner = new Learner();
    for (const id of ['p9', 'p10']) {
      learner.missed(id);
      learner.missed(id);
    }

    const group = learner.group().map((m) => m.id);
    expect(group).not.toContain('p9');
    expect(group).not.toContain('p10');

    const next = learner.next();
    expect(next?.id).toBe('r2');
    expect(next?.role).toBe('repair');
    // the repair the architect wrote for a misconception this topic actually produces
    expect(BP.misconceptions.find((m) => m.id === next?.repairs)?.topics).toContain(TOPIC);
    // and never the check, which would be the product testing what it has just failed to teach
    expect(group.indexOf('r2')).toBeLessThan(group.indexOf('c2'));
  });

  /**
   * TWO LEARNERS, SAME CHAPTER, SAME MORNING, DIFFERENT ROADS BY THE SECOND CARD. This is the claim
   * docs/LEARNING-MODEL.md section 2 makes, tested at the only moment it can be false: after
   * something happened to one of them and nothing happened to the other.
   */
  it('puts two learners on different roads once one of them gets stuck', () => {
    const stuck = new Learner('the one it stopped working for');
    const fine = new Learner('the one it did not');
    expect(stuck.next()?.id).toBe(fine.next()?.id);

    stuck.missed('p9');
    stuck.missed('p9');

    expect(stuck.next()?.id).not.toBe(fine.next()?.id);
    expect(fine.next()?.id).toBe('p9');
  });

  /**
   * THE BAR DOES NOT LURCH WHEN THE ROAD CHANGES. A learner watching their own progress must not be
   * punished for being re-routed: a road swapped for another road is the same number of modules, so
   * what they have done still counts for what it counted for a moment ago (docs/LEARNING-MODEL.md
   * section 3: two learners reach the same mastered topic with four modules and eleven, and neither
   * bar reads as though the other one's road were the real one).
   */
  it('does not move the learner’s own bar backwards for being re-routed', () => {
    const before = groupFor(BP, TOPIC, {});
    const after = groupFor(BP, TOPIC, { stuckOn: ['p9'] });
    expect(after.length).toBe(before.length);

    // they had finished nothing either way, and the check they have not reached is still ahead
    expect(progressAlong(BP, TOPIC, { stuckOn: ['p9'] }, new Set())).toBe(0);
    expect(progressAlong(BP, TOPIC, { stuckOn: ['p9'] }, new Set(['p10']))).toBeCloseTo(0.5);
  });

  /**
   * THE INVARIANT, SWEPT. Whatever this learner is stuck on, the next thing is never that module
   * and never anything harder than it. Written as a sweep because a rule that holds for the one
   * case somebody thought of is not a rule.
   */
  it('never returns the stuck module and never escalates, whichever one it was', () => {
    for (const state of [
      {},
      { unmetAssumptions: ['a2'] },
      { misconceptions: ['x2'] },
      { unmetAssumptions: ['a2'], misconceptions: ['x2'] },
    ]) {
      const plain = groupFor(BP, TOPIC, state);
      for (const module of plain) {
        const stuckOn = [module.id];
        const group = groupFor(BP, TOPIC, { ...state, stuckOn });
        expect(
          group.map((m) => m.id),
          `${module.id} was handed back`,
        ).not.toContain(module.id);
        const next = group[0];
        if (!next) continue;
        expect(
          DEPTH[next.role],
          `stuck on ${module.id} (${module.role}) and offered ${next.id} (${next.role})`,
        ).toBeLessThanOrEqual(DEPTH[module.role]);
        // the boss belongs to the chapter and a side door is never in the path, on this road too
        for (const m of group) expect(['boss', 'side_door']).not.toContain(m.role);
      }
    }
  });

  /**
   * A POOL THAT CANNOT SERVE A STUCK LEARNER IS SHOWN AS ONE, rather than papered over with the
   * check. docs/LEARNING-MODEL.md section 5: *"A pool that cannot serve a learner who has missed
   * the prerequisite is an incomplete pool, and that is a judgeable fault."* So when the pool holds
   * no second way in, no repair and no prerequisite, the honest answer is that it has nothing,
   * never the module that just failed and never the module above it.
   */
  it('withholds the check rather than escalating when the pool holds no way out', () => {
    const thin: Blueprint = {
      ...BP,
      modules: BP.modules.filter((m) => ['p9', 'c2'].includes(m.id)),
    };
    expect(groupFor(thin, TOPIC, {}).map((m) => m.id)).toEqual(['p9', 'c2']);

    const stranded = groupFor(thin, TOPIC, { stuckOn: ['p9'] }).map((m) => m.id);
    expect(stranded).not.toContain('p9');
    expect(stranded).not.toContain('c2');
    expect(stranded).toEqual([]);
  });

  /**
   * AND NOTHING CHANGES FOR A LEARNER WHO IS NOT STUCK. The re-choice is a step that only ever
   * fires on evidence; a learner to whom nothing has happened walks exactly the road they walked
   * before this file existed.
   */
  it('leaves the group exactly as it was for a learner nothing has happened to', () => {
    for (const state of [
      {},
      { unmetAssumptions: ['a2'] },
      { misconceptions: ['x2'] },
      { heldIdeas: ['i5'] },
      { style: ['worked'] as const },
    ]) {
      expect(groupFor(BP, TOPIC, { ...state, stuckOn: [] }).map((m) => m.id)).toEqual(
        groupFor(BP, TOPIC, state).map((m) => m.id),
      );
    }
    // a module that is stuck but was never in this learner's group changes nothing at all
    expect(groupFor(BP, TOPIC, { stuckOn: ['p11', 'g2', 'b1'] }).map((m) => m.id)).toEqual(
      groupFor(BP, TOPIC, {}).map((m) => m.id),
    );
  });
});
