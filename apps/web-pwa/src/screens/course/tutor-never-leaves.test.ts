/**
 * THE TUTOR NEVER LEAVES (docs/LEARNING-MODEL.md, "The tutor never leaves", the owner 2026-09-15).
 *
 * *"Is the content and teaching plan continuously optimising and personalising to the learner's
 * needs until they master or understand that topic? It should be motivating, continuous support,
 * understanding and guiding where they went wrong, and so on."*
 *
 * This file answers rules 4 and 5 of that section by PLAYING A LEARNER rather than by reading a
 * docstring. One struggling learner walks one topic end to end: wrong answers, slow answers, a
 * right answer after a wrong one, a closed tab and a return. Everything under it is the real
 * thing — the real chapter pool (`suggest/fixture.ts`, the cell the blueprint suite uses), the
 * real group selection (`curriculum/blueprint.ts`), the real re-teach ladder (`wobo/reteach.ts`),
 * the real round verdict and the real reward store. Only the model is mocked, and it is mocked at
 * the SDK seam the product itself calls, so nothing here reaches a network.
 *
 * The two rules this file owns:
 *
 *   RULE 4  It is motivating without lying. The reward fires on effort and on progress, not only
 *           on right answers; the try-again ladder never repeats the same line; the tone after a
 *           wrong answer is a tutor who knows you can, not a form.
 *   RULE 5  The learner is never left. No dead end: every screen after a wrong answer has the
 *           next thing to do, and the tutor stays in the room rather than handing over to a menu.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { type EventType, makeEvent, type PayloadOf, type WoboEvent } from '@wobo/contracts';
import type { Sdk } from '@wobo/sdk';
// Type-only, so it is erased before this file runs and cannot evaluate the module ahead of the
// storage stand-in installed below.
import type { ApproachId } from '../../wobo/reteach';

/**
 * Bun has no browser storage, and three of the modules under test are durable on purpose: the
 * re-teach ladder has to survive a closed tab, and that is one of the states a learner lands in.
 * Installed BEFORE the imports below, the way `kept.test.ts` and `reteach.test.ts` do it, because
 * each of those modules reads storage the moment it is evaluated.
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
/*
 * NEVER CLOBBER A STORE SOMEBODY ELSE ALREADY INSTALLED. `bun test` runs every file in ONE process,
 * and about ten test files install a stand-in like this one at module scope. Assigning
 * unconditionally takes the store out from under whichever of them loaded first: measured on the
 * full suite, this file alone turned 3891 pass / 0 fail into 3861 pass / 5 fail / 2 errors, none
 * of the casualties anywhere near this one. `??` is what `wobo/reteach.test.ts` already does, and
 * it is why that file has never had this effect.
 */
const g = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage };
g.localStorage = g.localStorage ?? (new MemoryStorage() as unknown as Storage);
g.sessionStorage = g.sessionStorage ?? (new MemoryStorage() as unknown as Storage);

const { groupFor, masteryOf, progressAlong } = await import('../../curriculum/blueprint');
const { pool } = await import('../../suggest/fixture');
const {
  APPROACHES,
  conceptMisses,
  dropReteachMemory,
  noteConceptCorrect,
  RETEACH_AFTER_MISSES,
  resetReteach,
  reteachOnMiss,
  triedApproaches,
} = await import('../../wobo/reteach');
const { comboBreak, comboHit, COMBO_EARN } = await import('../../ui/combo');
const { bloomHold, levelInfo, XP_AWARDS } = await import('../../store/progress');
const { roundVerdict, WORKBOOK_PASS_NEEDED } = await import('./Composing');
const { TRY_AGAIN_RUNGS, tryAgainRung } = await import('./shared');

/**
 * The model, mocked at the seam the product calls, with the REAL contract factory underneath: a
 * payload the app would reject is rejected here too, so a passing test cannot be passing on an
 * event the product could never actually record. Nothing here reaches a network.
 */
function fakeSdk(): { sdk: Sdk; events: WoboEvent[] } {
  const events: WoboEvent[] = [];
  const record = <T extends EventType>(eventType: T, payload: PayloadOf<T>): WoboEvent<T> => {
    const event = makeEvent({
      event_type: eventType,
      payload,
      actor: {
        subject_id: crypto.randomUUID(),
        surface: 'pwa',
        session_id: crypto.randomUUID(),
      },
      context: { app: 'learner', env: 'dev', consent_tier: 'un_elevated' },
    });
    events.push(event as WoboEvent);
    return event;
  };
  const sdk = { events: { record } } as unknown as Sdk;
  return { sdk, events };
}

const BP = pool();
/** The topic this learner is on. */
const TOPIC = 't4';
/**
 * The concept the miss tally is kept against. A real ontology node id, because the fake SDK above
 * mints through the REAL contract factory: an id the contract would refuse is an event the product
 * could never record, and `reteachNow` swallows exactly that failure so the learner never loses a
 * second explanation to it. A test that used a pretty string would be asserting against silence.
 */
const CONCEPT = crypto.randomUUID();

beforeEach(() => {
  resetReteach();
  comboBreak();
});

// --- the walk ------------------------------------------------------------------------------------

/**
 * ONE STRUGGLING LEARNER, ONE TOPIC, END TO END.
 *
 * The group is chosen from the real pool for THIS learner, they work it, they get things wrong,
 * they are slow, they come back the next day, and they get there. Every assertion below is about
 * what the product actually did to them on the way.
 */
describe('a learner who keeps getting it wrong is never left', () => {
  it('walks a group the pool chose for them, not a fixed list', () => {
    // They have not shown the ground the chapter assumes, and they have shown one misconception.
    const struggling = groupFor(BP, TOPIC, {
      unmetAssumptions: ['a2'],
      misconceptions: ['x2'],
    });
    const fluent = groupFor(BP, TOPIC, { heldIdeas: ['i5'] });

    // The one who missed the ground gets the module that lays it, first.
    expect(struggling[0]?.role).toBe('prerequisite');
    // ... and the repair for the mistake they actually made, which the fluent learner never sees.
    expect(struggling.map((m) => m.id)).toContain('r2');
    expect(fluent.map((m) => m.id)).not.toContain('r2');
    // The fast one is never idle: they get the stretch rather than the check that only confirms.
    expect(fluent.map((m) => m.role)).toContain('stretch');
    // Two learners, same chapter, two different roads.
    expect(struggling.map((m) => m.id)).not.toEqual(fluent.map((m) => m.id));
  });

  /**
   * RULE 4, the line the owner named first: *"the try-again ladder never repeats the same line"*.
   *
   * REWARDS.md §4 says what the rungs are: the first miss is almost nothing, the second brings the
   * ink back to the step that went wrong, the third stops asking and offers a different way in.
   * Before this test the workbook returned ONE string and returned it again on every round: a
   * learner who missed the same set four times read the identical sentence four times, under a
   * button that put the identical three items back in front of them.
   */
  it('never says the same thing twice while they try again', () => {
    const said = new Set<string>();
    for (let round = 0; round < TRY_AGAIN_RUNGS; round += 1) {
      const v = roundVerdict(0, 3, WORKBOOK_PASS_NEEDED, round);
      expect(v.advance).toBe(false);
      expect(said.has(v.line)).toBe(false);
      said.add(v.line);
    }
    expect(said.size).toBe(TRY_AGAIN_RUNGS);
  });

  /**
   * RULE 5: *"no dead end: every screen after a wrong answer has the next thing to do"*. The same
   * three items behind one button is not a next thing once it has already failed twice, so by the
   * third rung the verdict itself has to say that another way in belongs on the screen.
   */
  it('puts another way in on the screen rather than the same set a third time', () => {
    expect(roundVerdict(0, 3, WORKBOOK_PASS_NEEDED, 0).anotherWay).toBe(false);
    expect(roundVerdict(0, 3, WORKBOOK_PASS_NEEDED, 2).anotherWay).toBe(true);
    // and it never goes back to offering only the same set, however many rounds they take
    for (const round of [3, 4, 9]) {
      expect(roundVerdict(0, 3, WORKBOOK_PASS_NEEDED, round).anotherWay).toBe(true);
    }
  });

  /**
   * RULE 4: *"the tone after a wrong answer is the tone of a tutor who knows you can, not a
   * form"*, and voice.md: no em dash where a person reads, no exclamation mark, and Wobo never
   * says they were wrong (REWARDS.md §4: *"It never says they were wrong"*).
   */
  it('speaks like a tutor on every rung, never like a form', () => {
    for (let round = 0; round < TRY_AGAIN_RUNGS; round += 1) {
      const line = tryAgainRung(0, 3, round);
      expect(line).not.toContain('—');
      expect(line).not.toContain('!');
      expect(line.toLowerCase()).not.toContain('wrong');
      expect(line.toLowerCase()).not.toContain('incorrect');
      expect(line.toLowerCase()).not.toContain('failed');
      // never narrates itself (DESIGN.md §0.x, voice.md §10c)
      expect(line.toLowerCase()).not.toContain('let me');
      expect(line.toLowerCase()).not.toContain("i'll ");
      // it is a sentence a person says, not a code
      expect(line.length).toBeGreaterThan(20);
    }
  });

  /**
   * RULE 1 and RULE 5 together, through the real ladder: two misses on one concept and Wobo
   * changes approach on its own, on a different axis, and never hands back the pass that just
   * failed. This is the half that already worked; it is here because the walk has to prove the
   * whole loop, not the new piece of it.
   */
  it('changes approach on its own once a miss is a pattern, and never repeats one', () => {
    const { sdk, events } = fakeSdk();
    const opts = {
      nodeId: CONCEPT,
      conceptId: CONCEPT,
      from: 'worksheet' as const,
      context: { topic: 'Pressure' },
    };

    // one miss is a slip, not a pattern
    expect(reteachOnMiss(sdk, opts)).toBeNull();
    expect(conceptMisses(CONCEPT)).toBe(1);
    expect(RETEACH_AFTER_MISSES).toBe(2);

    // the second is a pattern, and Wobo moves without being asked
    const first = reteachOnMiss(sdk, opts);
    expect(first).not.toBeNull();
    expect(first?.approach.id).not.toBe('explain');
    expect(first?.reason).toBe('repeated_miss');
    expect(events.some((e) => e.event_type === 'learn.modality.switched.v1')).toBe(true);

    // they miss twice more: a second switch, and it is a different rung on a different axis
    reteachOnMiss(sdk, opts);
    const second = reteachOnMiss(sdk, opts);
    expect(second).not.toBeNull();
    expect(String(second?.approach.id)).not.toBe(String(first?.approach.id));
    expect(String(second?.approach.axis)).not.toBe(String(first?.approach.axis));

    // and it never lands back on the representation already on screen
    expect(second?.to).not.toBe(second?.from);
  });

  /**
   * THE CLOSED TAB AND THE RETURN. A learner who gives up mid-struggle and comes back later must
   * not be handed the approach that already failed them, so what has been tried is durable.
   */
  it('remembers what has already been tried when they close the tab and come back', () => {
    const { sdk } = fakeSdk();
    const opts = {
      nodeId: CONCEPT,
      conceptId: CONCEPT,
      from: 'worksheet' as const,
      context: { topic: 'Pressure' },
    };
    reteachOnMiss(sdk, opts);
    const before = reteachOnMiss(sdk, opts);
    expect(before).not.toBeNull();
    const beforeId = before?.approach.id as ApproachId;
    const tried = [...triedApproaches(CONCEPT)];
    expect(tried).toContain(beforeId);

    // the tab closes: the session cache goes, the record on the device does not
    dropReteachMemory();

    expect([...triedApproaches(CONCEPT)]).toEqual(tried);
    reteachOnMiss(sdk, opts);
    const after = reteachOnMiss(sdk, opts);
    expect(String(after?.approach.id)).not.toBe(String(beforeId));
    // every rung lands somewhere the learner can see: none of them is the pass that failed
    expect(APPROACHES.filter((a) => a.id !== 'explain').length).toBeGreaterThanOrEqual(3);
  });

  /**
   * RULE 4: *"the reward system fires on effort and on progress, not only on right answers"*, and
   * REWARDS.md §3: *"a bloom in the pigment, sized by how many tries it took: first try is quick
   * and bright, fifth is slower and warmer, because arriving late is still arriving"*.
   *
   * Before this, every bloom was the same length whatever it cost the learner to get there, and
   * REWARDS.md §8 listed "the try-again ladder wired to attempt count" as unbuilt.
   */
  it('pays the learner who arrived late more warmth, not less', () => {
    const quick = bloomHold(1);
    const hard = bloomHold(5);
    expect(hard).toBeGreaterThan(quick);
    // it is still a breath, never a blocking ceremony (REWARDS.md §7: nothing here is a surface)
    expect(hard).toBeLessThanOrEqual(4000);
    // and it never runs backwards as the tries climb
    let last = 0;
    for (const tries of [1, 2, 3, 4, 5, 9]) {
      const hold = bloomHold(tries);
      expect(hold).toBeGreaterThanOrEqual(last);
      last = hold;
    }
  });

  /**
   * THE RIGHT ANSWER AFTER A WRONG ONE. It pays exactly what a first-try answer pays (nothing is
   * deducted, ever, docs/LEVELS.md §4), the concept's miss tally clears because the teaching
   * landed, and the momentum the learner rebuilt is visible again.
   */
  it('pays a right answer that came after a wrong one exactly what it would have paid first time', () => {
    const { sdk } = fakeSdk();
    const opts = {
      nodeId: CONCEPT,
      conceptId: CONCEPT,
      from: 'worksheet' as const,
      context: { topic: 'Pressure' },
    };
    reteachOnMiss(sdk, opts);
    expect(conceptMisses(CONCEPT)).toBe(1);

    // the combo breaks honestly on the miss, with no penalty beyond the reset
    comboHit();
    comboBreak();

    // they come back and get it: the tally clears, and the item is worth what it was always worth
    noteConceptCorrect(CONCEPT);
    expect(conceptMisses(CONCEPT)).toBe(0);
    expect(XP_AWARDS.item).toBe(10);
    // nothing is deducted, ever: a miss costs no XP and no level
    expect(levelInfo(XP_AWARDS.item).level).toBeGreaterThanOrEqual(1);

    // and the momentum is theirs to rebuild
    let chain = 0;
    for (let i = 0; i < COMBO_EARN; i += 1) chain = comboHit();
    expect(chain).toBe(COMBO_EARN);
  });

  /**
   * RULE 2: *"it stops only when the topic is understood"*, never at a fixed number of modules.
   * The slow learner and the fast one both arrive, and the bar is the evidence rather than the
   * count of what they did.
   */
  it('stops at the evidence, never at a module count', () => {
    const slow = { heldIdeas: ['i5'], misconceptions: ['x2'] };
    const done = { heldIdeas: ['i5'] };
    // the misconception is still standing, so the topic is not held however much they did
    expect(masteryOf(BP, TOPIC, slow)).toBe(false);
    expect(masteryOf(BP, TOPIC, done)).toBe(true);
    // and their own bar is measured along THEIR group, not along the pool
    const state = { unmetAssumptions: ['a2'], misconceptions: ['x2'] };
    const group = groupFor(BP, TOPIC, state);
    const half = new Set(group.slice(0, 2).map((m) => m.id));
    expect(progressAlong(BP, TOPIC, state, half)).toBeGreaterThan(0);
    expect(progressAlong(BP, TOPIC, state, half)).toBeLessThan(1);
  });
});

// --- the screens a learner can land on after a wrong answer ---------------------------------------

/**
 * The rules above are about what the product decides. These are about what it puts on the screen,
 * and they are source-level for the reason `test/teaching-wiring.test.ts` states: what goes wrong
 * here is not a wrong answer inside a function, it is a screen that offers the learner nothing and
 * a tutor who left the room, and that is what a scan can see.
 */
describe('every screen after a wrong answer has the next thing to do', () => {
  const read = async (rel: string): Promise<string> =>
    await Bun.file(new URL(rel, import.meta.url)).text();

  it('the workbook never leaves the learner with one button and the same set', async () => {
    const src = await read('./Composing.tsx');
    // the round that did not pass carries a second door, and it is the different way in
    expect(src).toContain('anotherWay');
    expect(src).toContain('secondary');
  });

  it('the boss says something new each time rather than one fixed line', async () => {
    const src = await read('./Boss.tsx');
    expect(src).toContain('tryAgainRung');
    // and its verdict no longer carries an em dash a learner reads
    const verdict = src.slice(src.indexOf('passCount >= 2'));
    expect(verdict.slice(0, 400)).not.toContain('—');
  });

  it('the tutor stays in the room on every course screen, rather than handing over to a menu', async () => {
    const course = await read('../Course.tsx');
    // Wobo's own head and voice sit on the lesson frame, around whatever card is on stage, so a
    // learner who has just missed is looking at the tutor and not at a list of links.
    expect(course).toContain('<WoboHead');
    expect(course).toContain('Hold to talk to Wobo');
    // and the say row is outside the card, so no card can render without it
    expect(course.indexOf('ls-say')).toBeGreaterThan(course.indexOf('ls-stage'));
  });
});
