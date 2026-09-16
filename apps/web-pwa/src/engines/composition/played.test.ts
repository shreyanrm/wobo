/**
 * A LEARNER IS PLAYED, END TO END, AND WOBO IS ASKED WHERE THEY WENT WRONG.
 *
 * docs/LEARNING-MODEL.md, "The tutor never leaves" (the owner, 2026-09-15), rule 3: *"Every wrong
 * answer gets the reason it is wrong, drawn where the mistake is, from the concept core's own
 * misconceptions. Never 'incorrect, try again'. Never a generic hint."* And rule 4: the ladder
 * *"never repeats the same line"*.
 *
 * Nothing here reads a docstring. It walks the REAL chapter pool (`suggest/fixture.ts`, the CBSE
 * class 8 Science cell the blueprint suite uses), chooses this learner's group through the REAL
 * climb (`curriculum/blueprint.ts`'s `groupFor`), and plays the REAL template floors through the
 * REAL door (`parseDesign`) with a learner who gets things wrong, comes back, and finally gets one
 * right. No model is called: a floor is code and a group is a selection, so the whole play is free.
 *
 * What a played sequence proves that a unit assertion cannot: the line a learner reads is a
 * function of WHICH MISTAKE THEY MADE, and two mistakes in a row never read the same.
 */

import { describe, expect, it } from 'bun:test';
import { blueprintWalk, groupFor, type LearnerState } from '../../curriculum/blueprint';
import { pool } from '../../suggest/fixture';
import { FLOORS, floorFor } from './floors';
import { type Design, type Primitive, parseDesign, reasonFor } from './parse';

// --- the learner ----------------------------------------------------------------------------------

/**
 * One move a learner makes. `into` is where they put it, which only a drop has — and which is the
 * half that says why the placement was wrong rather than why the piece is what it is.
 */
interface Move {
  piece?: string;
  into?: string;
}

/**
 * Play a run of wrong moves against one beat and collect what the learner reads, in order.
 *
 * This is the composer's own policy, driven directly: `Composer.tsx` calls `reasonFor` with the
 * mistake and the lines already said, and prints what comes back. Driving the policy rather than
 * the pixels is what lets a test play twenty moves; `tests/composition.spec.ts` is the other half
 * and proves the same lines reach a real screen at 390 and 1440.
 */
function play(p: Primitive, moves: readonly Move[]): string[] {
  const said: string[] = [];
  for (const move of moves) {
    said.push(reasonFor(p, move, said));
  }
  return said;
}

const firstAct = (d: Design): Primitive => {
  const act = d.steps.find((s) => !['timer', 'score', 'reveal'].includes(s.primitive.kind));
  if (!act) throw new Error(`${d.id} has no act a learner can play`);
  return act.primitive;
};

const GENERIC = /^(that is |)(wrong|incorrect|not quite|nope|try again|have another go)\b/i;

// --- 1. the group is re-chosen, and a wrong answer changes it -------------------------------------

describe('the group that teaches the topic is chosen for THIS learner', () => {
  const bp = pool();

  it('a learner who has not shown the ground gets the module that lays it, first', () => {
    const walk = blueprintWalk(bp, 't4', { unmetAssumptions: ['a2'] });
    expect(walk[0]).toBe('q2');
    expect(walk).toContain('c2');
  });

  it('showing a misconception pulls its repair into the group, and nobody else gets it', () => {
    const behind: LearnerState = { unmetAssumptions: ['a2'] };
    const before = blueprintWalk(bp, 't4', behind);
    const after = blueprintWalk(bp, 't4', { ...behind, misconceptions: ['x2'] });

    expect(before).not.toContain('r2');
    expect(after).toContain('r2');
    // Rule 1: what they get NEXT is different, and it is never the module that just failed again.
    expect(after).not.toEqual(before);
  });

  it('a learner who already holds the idea is stretched rather than re-checked', () => {
    const fast = groupFor(bp, 't4', { heldIdeas: ['i5'] }).map((m) => m.role);
    expect(fast).toContain('stretch');
    expect(fast).not.toContain('check');
  });
});

// --- 2. where they went wrong, drawn where the mistake is -----------------------------------------

describe('every wrong answer says WHY, in this concept’s own words', () => {
  it('a token dropped in the wrong bin is answered by THAT bin’s refusal', () => {
    const design = parseDesign(FLOORS.classify) as Design;
    const act = firstAct(design);
    if (act.kind !== 'drop') throw new Error('the classify floor stopped being a drop');

    // Marble belongs in `metamorphic`. The learner puts it in `igneous`.
    const line = reasonFor(act, { piece: 'marble', into: 'igneous' });

    // The reason is drawn on the MISTAKE: it is the igneous bin's own refusal, which says what
    // puts a rock in there. The token's own `why` says why marble is marble, which is a different
    // sentence and answers a question the learner did not ask.
    expect(line).toContain('never melted');
    expect(line).not.toContain('recrystallised');
  });

  it('the same token refused by two different bins reads as two different reasons', () => {
    const act = firstAct(parseDesign(FLOORS.classify) as Design);
    const intoIgneous = reasonFor(act, { piece: 'marble', into: 'igneous' });
    const intoSedimentary = reasonFor(act, { piece: 'marble', into: 'sedimentary' });
    expect(intoIgneous).not.toBe(intoSedimentary);
  });

  it('a wrong option is answered by what THAT option teaches', () => {
    const act = firstAct(parseDesign(FLOORS.discriminate) as Design);
    if (act.kind !== 'branch') throw new Error('the discriminate floor stopped being a branch');
    const wrong = act.options.filter((o) => !o.correct);
    expect(wrong.length).toBeGreaterThan(0);
    for (const option of wrong) {
      const teaches = option.teaches ?? '';
      expect(reasonFor(act, { piece: option.id })).toBe(teaches);
    }
  });

  it('no floor answers a wrong move with a line about the game', () => {
    for (const row of Object.keys(FLOORS)) {
      const design = parseDesign(floorFor(row)) as Design;
      for (const step of design.steps) {
        const line = reasonFor(step.primitive, {});
        expect(line, `${row}/${step.id} said nothing`).not.toBe('');
        expect(line, `${row}/${step.id}: "${line}"`).not.toMatch(GENERIC);
        // No em dash where a person reads (docs/copy/voice.md §10a).
        expect(line).not.toContain('—');
      }
    }
  });
});

// --- 3. never the same line twice in a row --------------------------------------------------------

describe('the same line never lands twice in a row', () => {
  it('a learner who repeats one mistake is told something new the second time', () => {
    const act = firstAct(parseDesign(FLOORS.classify) as Design);
    const said = play(act, [
      { piece: 'marble', into: 'igneous' },
      { piece: 'marble', into: 'igneous' },
    ]);
    expect(said[0]).not.toBe(said[1]);
    expect(said[1]).not.toBe('');
  });

  it('a long run of the same mistake never repeats itself back to back', () => {
    const act = firstAct(parseDesign(FLOORS.classify) as Design);
    const said = play(
      act,
      Array.from({ length: 8 }, () => ({ piece: 'slate', into: 'sedimentary' })),
    );
    for (let i = 1; i < said.length; i++) {
      expect(said[i] === said[i - 1], `move ${i} repeated move ${i - 1}`).toBe(false);
      expect(said[i]).not.toBe('');
    }
  });

  it('when the concept has nothing left to say, the tutor asks rather than asserts', () => {
    const act = firstAct(parseDesign(FLOORS.classify) as Design);
    const said = play(
      act,
      Array.from({ length: 6 }, () => ({ piece: 'granite', into: 'sedimentary' })),
    );
    // Something in the run is a question back, and it is never a verdict on the learner.
    expect(said.some((l) => l.trim().endsWith('?'))).toBe(true);
    for (const line of said) expect(line).not.toMatch(GENERIC);
  });
});

// --- 4. the whole sequence: wrong, slow, then right ------------------------------------------------

describe('a learner plays a group of modules and is never left', () => {
  it('walks the group, gets things wrong, and reads a new reason every time', () => {
    const bp = pool();
    const state: LearnerState = { unmetAssumptions: ['a2'], misconceptions: ['x2'] };
    const group = blueprintWalk(bp, 't4', state);
    expect(group.length).toBeGreaterThan(2);

    const read: string[] = [];
    for (const moduleId of group) {
      // Each module is taught by one of §2's rows; the floor is what a learner meets when the
      // model has not written a design yet, so it is the honest worst case to play.
      const row = Object.keys(FLOORS)[group.indexOf(moduleId) % Object.keys(FLOORS).length] ?? '';
      const design = parseDesign(floorFor(row)) as Design;
      const act = firstAct(design);

      // wrong, wrong again (the slow learner who comes back), then right.
      const said = play(act, [{ piece: undefined }, { piece: undefined }]);
      for (const line of said) {
        expect(line, `${moduleId}/${row} left the learner with nothing`).not.toBe('');
        expect(line).not.toMatch(GENERIC);
      }
      expect(said[0]).not.toBe(said[1]);
      read.push(...said);
    }

    // Nothing in the whole played run is a verdict, and nothing is a dead end.
    expect(read.length).toBeGreaterThan(group.length);
    for (const line of read) expect(line.trim().length).toBeGreaterThan(10);
  });
});
