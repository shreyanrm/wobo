/**
 * THE LAST RUNG OF THE ASKING IS STILL THIS CONCEPT'S OWN, AND NEVER A LINE THAT COULD BE ABOUT
 * ANYTHING.
 *
 * docs/LEARNING-MODEL.md, "the tutor never leaves" (the owner, 2026-09-15), rule 3: every wrong
 * answer gets the reason it is wrong, drawn where the mistake is, *"never a generic hint"*. The rule
 * exempts nothing, and least of all the bottom of the ladder: the bottom is where a struggling
 * learner arrives after repeated misses, so the learner who needs this concept's own words most is
 * the one the bottom rung answers.
 *
 * So this file plays the learner who keeps missing. It walks the REAL chapter pool
 * (`suggest/fixture.ts`) through the REAL climb (`curriculum/blueprint.ts`), plays the REAL floors
 * and the REAL designed interactions through the REAL door (`parseDesign`), and runs each act until
 * every reason the concept holds is spent and the asking is all that is left. No model is called.
 *
 * What it proves, which no docstring can: every line a stuck learner reads names something in the
 * act in front of them, and two learners stuck on two different concepts never read the same
 * sentence.
 */

import { describe, expect, it } from 'bun:test';
import { blueprintWalk, type LearnerState } from '../../curriculum/blueprint';
import { pool } from '../../suggest/fixture';
import { DESIGNED } from './fixtures';
import { floorFor, ROWS } from './floors';
import { acts, type Design, type Primitive, parseDesign, reasonFor } from './parse';

// --- the learner -------------------------------------------------------------------------------

interface Move {
  piece?: string;
  into?: string;
}

/** The mistake this act can actually produce: the piece moved, and where it was put. */
function missIn(p: Primitive): Move {
  switch (p.kind) {
    case 'drop': {
      const token = p.tokens[0];
      const wrongZone = p.zones.find((z) => z.id !== token?.belongs) ?? p.zones[0];
      return { piece: token?.id, into: wrongZone?.id };
    }
    case 'sort':
      return { piece: p.items[0]?.id };
    case 'match':
      return { piece: p.pairs[0]?.id };
    case 'sequence':
      return { piece: p.steps[1]?.id ?? p.steps[0]?.id };
    case 'branch':
      return { piece: p.options.find((o) => !o.correct)?.id };
    case 'mark':
      return { piece: p.targets[0]?.id };
    default:
      return {};
  }
}

/** Miss the same way `times` times, and collect what the learner reads, in order. */
function keepMissing(p: Primitive, times: number, move: Move = missIn(p)): string[] {
  const said: string[] = [];
  for (let i = 0; i < times; i++) said.push(reasonFor(p, move, said));
  return said;
}

// --- what counts as "about this concept" ---------------------------------------------------------

const STOP = new Set([
  'the',
  'and',
  'with',
  'from',
  'that',
  'this',
  'each',
  'they',
  'them',
  'then',
  'than',
  'what',
  'when',
  'which',
  'where',
  'into',
  'onto',
  'your',
  'their',
  'have',
  'has',
  'was',
  'were',
  'are',
  'its',
  'one',
  'all',
  'any',
  'how',
  'why',
  'who',
  'can',
  'will',
  'does',
  'not',
  'but',
  'for',
  'you',
  'put',
  'way',
  'here',
  'there',
  'about',
  'other',
  'these',
  'those',
]);

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 4 && !STOP.has(w));

/** Everything this act calls something, verbatim: a label may be `2x = 8`, which has no words. */
function names(design: Design, p: Primitive): string[] {
  const out: string[] = [design.concept];
  if ('prompt' in p) out.push(p.prompt);
  switch (p.kind) {
    case 'drop':
      out.push(...p.tokens.map((t) => t.label), ...p.zones.map((z) => z.label));
      break;
    case 'sort':
      out.push(...p.items.map((i) => i.label));
      break;
    case 'match':
      out.push(...p.pairs.flatMap((x) => [x.left, x.right]));
      break;
    case 'sequence':
      out.push(...p.steps.map((s) => s.label));
      break;
    case 'branch':
      out.push(...p.options.map((o) => o.label));
      break;
    case 'slide':
      out.push(p.valueLabel ?? '', p.unit ?? '');
      break;
    default:
      break;
  }
  // A name that runs on is cut at its first clause before it is put inside a question, so the
  // opening clause is what a question carries and what this test has to recognise.
  return out
    .flatMap((n) => {
      const s = n.trim();
      if (s.length <= 32) return [s];
      const cut = s.search(/[:;,]/);
      return [s, (cut > 0 ? s.slice(0, cut) : s).trim()];
    })
    .filter((s) => s.length >= 2);
}

/** This act's own vocabulary: the concept it teaches, its ask, and everything it names on screen. */
function vocabulary(design: Design, p: Primitive): Set<string> {
  const sources: string[] = [design.concept];
  if ('prompt' in p) sources.push(p.prompt);
  switch (p.kind) {
    case 'drop':
      sources.push(...p.tokens.map((t) => t.label), ...p.zones.map((z) => z.label));
      break;
    case 'sort':
      sources.push(...p.items.map((i) => i.label));
      break;
    case 'match':
      sources.push(...p.pairs.map((x) => `${x.left} ${x.right}`));
      break;
    case 'sequence':
      sources.push(...p.steps.map((s) => s.label));
      break;
    case 'branch':
      sources.push(...p.options.map((o) => o.label));
      break;
    case 'slide':
      sources.push(p.valueLabel ?? '', p.unit ?? '');
      break;
    default:
      break;
  }
  return new Set(sources.flatMap(words));
}

const namesSomething = (
  line: string,
  vocab: ReadonlySet<string>,
  own: readonly string[],
): boolean =>
  words(line).some((w) => vocab.has(w)) ||
  own.some((n) => line.toLowerCase().includes(n.toLowerCase()));

/**
 * The rungs this file governs: what Wobo ASKS once the concept's reasons are spent.
 *
 * A reason is the designer's own sentence about this mistake and is concept-drawn by construction,
 * so it is held to a different proof: section 2 below plays every act in the vocabulary and shows
 * that no reason is ever said about two concepts either.
 */
const isAsked = (line: string): boolean => line.trim().endsWith('?');

const GENERIC = /^(that is |)(wrong|incorrect|not quite|nope|try again|have another go)\b/i;

/** Every act a learner can meet today: the seven floors and the three designed interactions. */
function everyAct(): { design: Design; act: Primitive; where: string }[] {
  const out: { design: Design; act: Primitive; where: string }[] = [];
  for (const row of ROWS) {
    const design = parseDesign(floorFor(row)) as Design;
    for (const beat of acts(design))
      out.push({ design, act: beat.primitive, where: `${row}/${beat.id}` });
  }
  for (const designed of DESIGNED) {
    const design = parseDesign(designed) as Design;
    for (const beat of acts(design))
      out.push({ design, act: beat.primitive, where: `${design.id}/${beat.id}` });
  }
  return out;
}

// --- 1. the bottom of the ladder ------------------------------------------------------------------

describe('a learner who keeps missing is never handed a line about nothing', () => {
  it('every question, to the very bottom of the ladder, names something in this act', () => {
    for (const { design, act, where } of everyAct()) {
      const vocab = vocabulary(design, act);
      const own = names(design, act);
      const said = keepMissing(act, 12);
      for (const [i, line] of said.entries()) {
        expect(line, `${where} move ${i + 1} said nothing`).not.toBe('');
        expect(line, `${where} move ${i + 1}: "${line}"`).not.toMatch(GENERIC);
        // No em dash where a person reads (docs/copy/voice.md 10a).
        expect(line, `${where} move ${i + 1} used an em dash`).not.toContain('—');
        if (!isAsked(line)) continue;
        expect(
          namesSomething(line, vocab, own),
          `${where} move ${i + 1} asked a question about nothing: "${line}"`,
        ).toBe(true);
      }
    }
  });

  it('the asking begins once the concept is spent, and it is asking rather than asserting', () => {
    for (const { act, where } of everyAct()) {
      const said = keepMissing(act, 12);
      expect(
        said.some((l) => l.trim().endsWith('?')),
        `${where} never asked`,
      ).toBe(true);
    }
  });

  it('no act anywhere reaches for the old catch-all', () => {
    for (const { act, where } of everyAct()) {
      for (const line of keepMissing(act, 12)) {
        expect(line, `${where} fell back to the catch-all`).not.toBe(
          'Which part of it decides the answer?',
        );
      }
    }
  });
});

// --- 2. two concepts, two ladders, and nothing shared ---------------------------------------------

describe('two learners stuck on two different concepts never read the same sentence', () => {
  it('no line said about one concept is ever said about another', () => {
    const ladders = everyAct().map(({ design, act, where }) => ({
      concept: design.concept,
      where,
      lines: new Set(keepMissing(act, 12)),
    }));

    for (const a of ladders) {
      for (const b of ladders) {
        if (a.concept === b.concept) continue;
        for (const line of a.lines) {
          expect(
            b.lines.has(line),
            `"${line}" is said about ${a.concept} (${a.where}) and about ${b.concept} (${b.where})`,
          ).toBe(false);
        }
      }
    }
  });

  it('rocks and fractions share no line, right down to the last rung', () => {
    const rocks = parseDesign(floorFor('classify')) as Design;
    const fractions = parseDesign(floorFor('vary')) as Design;
    const rockAct = acts(rocks)[0]?.primitive as Primitive;
    const fractionAct = acts(fractions)[0]?.primitive as Primitive;

    const heard = new Set(keepMissing(rockAct, 12));
    for (const line of keepMissing(fractionAct, 12)) expect(heard.has(line)).toBe(false);
  });
});

// --- 3. the whole walk: the real pool, the real group, a learner who struggles all the way ---------

describe('a struggling learner walks their real group and is answered in words about the work', () => {
  it('every module of the group answers every miss with a line about that module', () => {
    const bp = pool();
    const state: LearnerState = { unmetAssumptions: ['a2'], misconceptions: ['x2'] };
    const group = blueprintWalk(bp, 't4', state);
    expect(group.length).toBeGreaterThan(2);

    const readEverywhere: string[] = [];
    for (const [n, moduleId] of group.entries()) {
      const row = ROWS[n % ROWS.length] ?? 'discriminate';
      const design = parseDesign(floorFor(row)) as Design;
      const beat = acts(design)[0];
      if (!beat) throw new Error(`${row} has no act a learner can play`);
      const vocab = vocabulary(design, beat.primitive);
      const own = names(design, beat.primitive);

      // Six misses in a row: past every reason the concept holds, and into the asking.
      const said = keepMissing(beat.primitive, 6);
      for (const [i, line] of said.entries()) {
        expect(line, `${moduleId}/${row} left the learner with nothing`).not.toBe('');
        expect(line, `${moduleId}/${row}: "${line}"`).not.toMatch(GENERIC);
        if (isAsked(line))
          expect(
            namesSomething(line, vocab, own),
            `${moduleId}/${row} move ${i + 1} asked a question about nothing: "${line}"`,
          ).toBe(true);
        if (i > 0) expect(line, `${moduleId}/${row} repeated itself`).not.toBe(said[i - 1]);
      }
      readEverywhere.push(...said);
    }

    // The walk never runs out of things to say, and never says one thing everywhere.
    expect(new Set(readEverywhere).size).toBeGreaterThan(group.length * 3);
  });
});
