import { describe, expect, it } from 'bun:test';
import { CHALLENGE, FLOORS, floorFor } from './floors';
import { DESIGNED } from './fixtures';
import {
  type Composition,
  MAX_STEPS,
  movesNeeded,
  nextStep,
  parseComposition,
  type Refusal,
  teachFor,
} from './spec';

/**
 * The gate (docs/CONTENT-INTERACTION.md §3): nothing generated ever executes on a learner's device,
 * so a composition is data and this is the only door it comes through. Every test here is a shape a
 * model could plausibly emit; each one that is refused is a bug that would otherwise have rendered.
 */

const bins = (over: Record<string, unknown> = {}) => ({
  title: 'where each part lives',
  steps: [
    {
      id: 's1',
      prompt: 'put each part where it belongs',
      reveal: 'the wall is the plant cell’s own; the animal cell has none.',
      play: {
        kind: 'bins',
        bins: [
          { id: 'plant', label: 'plant cell', accepts: ['wall', 'chloro'] },
          { id: 'both', label: 'both', accepts: ['nucleus'] },
        ],
        items: [
          { id: 'wall', label: 'cell wall', teach: 'only the plant cell has a rigid wall.' },
          { id: 'chloro', label: 'chloroplast', teach: 'chloroplasts make food from light.' },
          { id: 'nucleus', label: 'nucleus', teach: 'both cells keep their instructions here.' },
        ],
      },
      ...over,
    },
  ],
});

const why = (out: Refusal[]) => out.map((r) => `${r.where}: ${r.why}`).join(' | ');

describe('the composition gate', () => {
  it('accepts a plain designed composition and names it designed', () => {
    const out: Refusal[] = [];
    const c = parseComposition(bins(), out);
    expect(why(out)).toBe('');
    expect(c?.source).toBe('designed');
    expect(c?.steps[0]?.play.kind).toBe('bins');
  });

  it('refuses anything that is not an object, and says so once', () => {
    for (const junk of [null, undefined, 'a composition', 7, [], true]) {
      const out: Refusal[] = [];
      expect(parseComposition(junk, out)).toBeNull();
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('refuses a step with no reveal — a step that reveals nothing taught nothing', () => {
    const raw = bins();
    raw.steps[0].reveal = '   ';
    const out: Refusal[] = [];
    expect(parseComposition(raw, out)).toBeNull();
    expect(why(out)).toContain('no reveal');
  });

  it('refuses a step where a wrong move says nothing (rule 3)', () => {
    const raw = bins();
    for (const item of raw.steps[0].play.items) delete (item as { teach?: string }).teach;
    const out: Refusal[] = [];
    expect(parseComposition(raw, out)).toBeNull();
    expect(why(out)).toContain('says nothing');
  });

  it('accepts a wrong move that is taught at the step instead of the piece', () => {
    const raw = bins({ teach: 'the wall is what a plant builds and an animal cannot.' });
    for (const item of raw.steps[0].play.items) delete (item as { teach?: string }).teach;
    expect(parseComposition(raw)).not.toBeNull();
  });

  it('refuses a chip that belongs to two bins, and a chip that belongs to none', () => {
    const two = bins();
    two.steps[0].play.bins[1].accepts = ['nucleus', 'wall'];
    expect(parseComposition(two)).toBeNull();

    const none = bins();
    none.steps[0].play.bins[1].accepts = ['nucleus'];
    none.steps[0].play.items.push({ id: 'orphan', label: 'ribosome', teach: 'both have these.' });
    const out: Refusal[] = [];
    expect(parseComposition(none, out)).toBeNull();
    expect(why(out)).toContain('no bin');
  });

  it('refuses a sort whose order is not a permutation of its chips', () => {
    const step = {
      id: 's1',
      prompt: 'put them in order',
      reveal: 'glucose is split before anything reaches the mitochondrion.',
      teach: 'the order is the order the energy is released in.',
      play: {
        kind: 'sort',
        items: [
          { id: 'a', label: 'glycolysis' },
          { id: 'b', label: 'the link reaction' },
          { id: 'c', label: 'the Krebs cycle' },
        ],
        order: ['a', 'b', 'b'],
      },
    };
    const out: Refusal[] = [];
    expect(parseComposition({ title: 'respiration', steps: [step] }, out)).toBeNull();
    expect(why(out)).toContain('permutation');
  });

  it('refuses a select where every option is right — there is nothing to tell apart', () => {
    const step = {
      id: 's1',
      prompt: 'which step is wrong',
      reveal: 'the sign flips when a term crosses the equals sign.',
      teach: 'crossing over changes the sign.',
      play: {
        kind: 'select',
        options: [
          { id: 'a', label: 'x + 3 = 7' },
          { id: 'b', label: 'x = 7 - 3' },
          { id: 'c', label: 'x = 4' },
        ],
        answer: ['a', 'b', 'c'],
      },
    };
    const out: Refusal[] = [];
    expect(parseComposition({ title: 'signs', steps: [step] }, out)).toBeNull();
    expect(why(out)).toContain('nothing to tell apart');
  });

  it('refuses a slide bound to a mark that is not on the canvas, and a NaN range', () => {
    const base = (play: Record<string, unknown>) => ({
      title: 'equivalent fractions',
      steps: [
        {
          id: 's1',
          prompt: 'stretch the bar',
          reveal: 'more pieces, smaller pieces, the same amount.',
          teach: 'cutting a bar into more pieces does not give you more bar.',
          play: { kind: 'slide', min: 1, max: 8, from: 1, at: 4, ...play },
        },
      ],
    });
    const out: Refusal[] = [];
    expect(
      parseComposition(base({ bind: { mark: 'ghost', prop: 'x', at: [0, 10] } }), out),
    ).toBeNull();
    expect(why(out)).toContain('not on the canvas');
    expect(parseComposition(base({ max: Number.NaN }))).toBeNull();
    expect(parseComposition(base({ at: 99 }))).toBeNull();
  });

  it('refuses more than six steps — six is a lesson, seven is a lecture', () => {
    const one = bins().steps[0];
    const many = Array.from({ length: MAX_STEPS + 1 }, (_, i) => ({ ...one, id: `s${i}` }));
    const out: Refusal[] = [];
    expect(parseComposition({ title: 'too much', steps: many }, out)).toBeNull();
    expect(why(out)).toContain(`one to ${MAX_STEPS} steps`);
  });

  it('refuses a branch that goes nowhere', () => {
    const raw = bins({ branch: [{ on: 'wrong', goto: 'nowhere' }] });
    const out: Refusal[] = [];
    expect(parseComposition(raw, out)).toBeNull();
    expect(why(out)).toContain('not a step');
  });

  it('drops a timer and a score that are not real, and keeps the ones that are', () => {
    const bad = parseComposition(bins({ timer: { seconds: 0 }, score: { per: -3 } }));
    expect(bad?.steps[0]?.timer).toBeUndefined();
    expect(bad?.steps[0]?.score).toBeUndefined();
    const good = parseComposition(bins({ timer: { seconds: 60 }, score: { per: 10, streak: 5 } }));
    expect(good?.steps[0]?.timer?.seconds).toBe(60);
    expect(good?.steps[0]?.score).toEqual({ per: 10, streak: 5 });
  });

  it('never lets a non-finite number reach a drawing', () => {
    const raw = {
      title: 'the parts',
      steps: [
        {
          id: 's1',
          prompt: 'tap the nucleus',
          reveal: 'the nucleus holds the instructions.',
          teach: 'the instructions live in one place.',
          play: {
            kind: 'canvas',
            marks: [
              { id: 'n', shape: 'circle', x: Number.NaN, y: 30, r: 8 },
              { id: 'm', shape: 'circle', x: 60, y: 30, r: 8 },
            ],
            targets: ['n', 'm'],
            need: 1,
          },
        },
      ],
    };
    const c = parseComposition(raw);
    // the NaN mark is dropped, not repaired; the target that referenced it goes with it
    const play = c?.steps[0]?.play;
    expect(play?.kind).toBe('canvas');
    if (play?.kind === 'canvas') {
      expect(play.marks.map((m) => m.id)).toEqual(['m']);
      expect(play.targets).toEqual(['m']);
    }
  });
});

describe('what the renderer asks of a step', () => {
  const c = parseComposition(bins()) as Composition;

  it('counts the right moves a step needs', () => {
    expect(movesNeeded(c.steps[0].play)).toBe(3);
  });

  it('gives the piece its own line before the step’s', () => {
    expect(teachFor(c.steps[0], 'wall')).toContain('rigid wall');
    expect(teachFor(c.steps[0], 'absent')).toBe('');
  });

  it('walks on by one when nothing branched', () => {
    expect(nextStep(c, 0, true)).toBe(1);
  });

  it('follows a branch on a wrong answer', () => {
    const two = parseComposition({
      title: 'two ways',
      steps: [
        { ...bins().steps[0], id: 'a', branch: [{ on: 'wrong', goto: 'b' }] },
        { ...bins().steps[0], id: 'b' },
      ],
    }) as Composition;
    expect(nextStep(two, 0, false)).toBe(1);
    expect(nextStep(two, 0, true)).toBe(1);
  });
});

describe('the template floors — the floor quality never falls under (§3)', () => {
  it('has one floor for each composable row of section 2', () => {
    expect(Object.keys(FLOORS).sort()).toEqual([
      'classification',
      'construction',
      'correspondence',
      'discrimination',
      'ordering',
      'variation',
    ]);
  });

  it('every floor goes through the same gate the designer’s work does', () => {
    for (const [row, floor] of Object.entries(FLOORS)) {
      const out: Refusal[] = [];
      const parsed = parseComposition(floor, out);
      expect(`${row}: ${why(out)}`).toBe(`${row}: `);
      expect(parsed?.source).toBe('floor');
    }
  });

  it('each floor is the play its row calls for', () => {
    expect(FLOORS.classification.steps[0].play.kind).toBe('bins');
    expect(FLOORS.ordering.steps[0].play.kind).toBe('sort');
    expect(FLOORS.correspondence.steps[0].play.kind).toBe('match');
    expect(FLOORS.variation.steps[0].play.kind).toBe('slide');
    expect(FLOORS.construction.steps[0].play.kind).toBe('sequence');
    expect(FLOORS.discrimination.steps[0].play.kind).toBe('select');
  });

  it('the challenge is not a ninth play: it is the discrimination floor with a timer and a score', () => {
    const c = parseComposition(CHALLENGE);
    expect(c).not.toBeNull();
    expect(c?.steps[0]?.play.kind).toBe('select');
    expect(c?.steps[0]?.timer?.seconds).toBeGreaterThan(0);
    expect(c?.steps[0]?.score?.per).toBeGreaterThan(0);
  });

  it('names a floor for every row a concept can land on, and falls back rather than failing', () => {
    expect(floorFor('classification').steps[0].play.kind).toBe('bins');
    expect(floorFor('not a row').steps[0].play.kind).toBe('select');
  });
});

describe('the designer’s three outputs', () => {
  it('there are three, from three different subjects and grades', () => {
    expect(DESIGNED).toHaveLength(3);
    expect(new Set(DESIGNED.map((d) => d.title)).size).toBe(3);
  });

  it('every one passes the gate', () => {
    for (const d of DESIGNED) {
      const out: Refusal[] = [];
      expect(`${d.title}: ${why(out)}`).toBe(`${d.title}: `);
      expect(parseComposition(d, out)).not.toBeNull();
    }
  });

  it('each mixes its kinds — one builds the idea, one checks it, one makes it fun (§2)', () => {
    for (const d of DESIGNED) {
      const parsed = parseComposition(d);
      const kinds = parsed?.steps.map((s) => s.play.kind) ?? [];
      expect(kinds.length).toBeGreaterThanOrEqual(3);
      expect(new Set(kinds).size).toBeGreaterThanOrEqual(3);
    }
  });

  it('never narrates: no step describes the software or announces what it is about to do', () => {
    const banned = /\b(let me|i['’]ll|i will|this (?:diagram|interaction|activity)|drawn for you|loading)\b/i;
    for (const d of DESIGNED) {
      const parsed = parseComposition(d);
      for (const s of parsed?.steps ?? []) {
        expect(`${s.prompt} ${s.reveal} ${s.teach ?? ''}`).not.toMatch(banned);
      }
    }
  });

  it('carries no em dash a learner reads', () => {
    for (const d of [...DESIGNED, ...Object.values(FLOORS), CHALLENGE]) {
      const parsed = parseComposition(d);
      const words = [
        parsed?.title ?? '',
        ...(parsed?.steps ?? []).flatMap((s) => [s.prompt, s.reveal, s.teach ?? '']),
      ].join(' ');
      expect(words).not.toContain('—');
    }
  });
});
