import { describe, expect, it } from 'bun:test';
import { DESIGNED } from './fixtures';
import { FLOORS, fillFloor, floorFor, ROWS } from './floors';
import {
  acts,
  type Beat,
  type Design,
  MANIPULATIVE,
  MIN_HIT_PX,
  MIN_HIT_UNITS,
  MODIFIERS,
  modifier,
  movesNeeded,
  nextBeat,
  PHONE_PX_PER_UNIT,
  parseDesign,
  type Refusal,
  STAGE_H,
  STAGE_W,
  teachFor,
} from './parse';

/**
 * The door (docs/CONTENT-INTERACTION.md §3): nothing generated ever executes on a learner's device,
 * so a design is data and this is the only way it gets in. Every case below is a shape the model
 * could plausibly emit; each one that slipped through would have rendered wrong on a real phone.
 */

const why = (out: Refusal[]) => out.map((r) => `${r.where}: ${r.why}`).join(' | ');
const box = (x = 2, y = 2, w = 46, h = 14) => ({ x, y, w, h });
const fb = (right = 'Yes.', wrong = 'A third is a smaller share than a half.') => ({
  right,
  wrong,
});

/** A design with one drop beat, the shape the gateway emits. */
const drop = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  concept: 'where each part lives',
  kind: 'classify',
  mechanic: 'put each part where it belongs',
  why: 'the wall is the whole difference',
  steps: [
    {
      id: 'b1',
      beat: 'check',
      primitive: {
        kind: 'drop',
        prompt: 'put each part where it belongs',
        feedback: fb(),
        tokens: [
          {
            id: 'wall',
            label: 'cell wall',
            box: box(2, 2),
            belongs: 'plant',
            why: 'only a plant builds a wall.',
          },
          {
            id: 'nucleus',
            label: 'nucleus',
            box: box(52, 2),
            belongs: 'both',
            why: 'both cells keep instructions here.',
          },
        ],
        zones: [
          {
            id: 'plant',
            label: 'plant only',
            box: box(2, 40),
            accepts: ['wall'],
            feedback: fb('Yes.', 'an animal cell has this too.'),
          },
          {
            id: 'both',
            label: 'both',
            box: box(52, 40),
            accepts: ['nucleus'],
            feedback: fb('Yes.', 'an animal cell does not have this.'),
          },
        ],
      },
      ...over,
    },
  ],
});

const firstBeat = (d: Design | null) => d?.steps[0] as Beat;
/** `noUncheckedIndexedAccess` is on: reach into the one beat these fixtures carry, once, here. */
type RawDrop = ReturnType<typeof drop>;
const act = (raw: RawDrop) => raw.steps[0] as RawDrop['steps'][number];
const token = (raw: RawDrop, i = 0) =>
  act(raw).primitive.tokens[i] as { box: unknown; belongs: string };
const zone = (raw: RawDrop, i = 0) => act(raw).primitive.zones[i] as { accepts: string[] };

describe('the constants are the gateway’s constants', () => {
  it('holds the stage and the finger’s law to what plexus/specs.py declares', () => {
    expect(STAGE_W).toBe(100);
    expect(STAGE_H).toBe(62);
    expect(PHONE_PX_PER_UNIT).toBe(3.3);
    expect(MIN_HIT_PX).toBe(44);
    expect(MIN_HIT_UNITS).toBeCloseTo(13.333, 3);
  });

  it('knows which primitives are acts and which are modifiers', () => {
    expect([...MANIPULATIVE].sort()).toEqual([
      'drag',
      'drop',
      'mark',
      'match',
      'sequence',
      'slide',
      'sort',
    ]);
    expect([...MODIFIERS].sort()).toEqual(['reveal', 'score', 'timer']);
  });
});

describe('the door', () => {
  it('accepts a plain design and names it the model’s', () => {
    const out: Refusal[] = [];
    const d = parseDesign(drop(), out);
    expect(why(out)).toBe('');
    expect(d?.source).toBe('model');
    expect(firstBeat(d).primitive.kind).toBe('drop');
  });

  it('refuses anything that is not an object', () => {
    for (const junk of [null, undefined, 'a design', 7, [], true]) {
      const out: Refusal[] = [];
      expect(parseDesign(junk, out)).toBeNull();
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('refuses a design that will not say what its mechanic is or why', () => {
    const out: Refusal[] = [];
    expect(parseDesign({ ...drop(), why: '  ' }, out)).toBeNull();
    expect(why(out)).toContain('what its mechanic is and why');
  });

  it('refuses a hit box smaller than a finger, and one that runs off the stage', () => {
    const small = drop();
    token(small).box = box(2, 2, 46, 6);
    const outSmall: Refusal[] = [];
    expect(parseDesign(small, outSmall)).toBeNull();
    expect(why(outSmall)).toContain('no hit area a finger can use');

    const off = drop();
    token(off).box = box(80, 2, 46, 14);
    expect(parseDesign(off)).toBeNull();
  });

  it('refuses feedback whose wrong half teaches nothing — "try again" is not a line', () => {
    const blank = drop();
    (act(blank).primitive as { feedback: unknown }).feedback = { right: 'Yes.', wrong: '   ' };
    const out: Refusal[] = [];
    expect(parseDesign(blank, out)).toBeNull();
    expect(why(out)).toContain('teaches nothing');
  });

  it('refuses a zone that accepts a token that does not exist, and a token that belongs nowhere', () => {
    const ghost = drop();
    zone(ghost).accepts = ['ghost'];
    expect(parseDesign(ghost)).toBeNull();

    const orphan = drop();
    token(orphan).belongs = 'nowhere';
    const out: Refusal[] = [];
    expect(parseDesign(orphan, out)).toBeNull();
    expect(why(out)).toContain('belongs to no zone');
  });

  it('refuses ranks with a gap or a tie — an order that is not an order', () => {
    const design = {
      ...drop(),
      steps: [
        {
          id: 'b1',
          beat: 'check',
          primitive: {
            kind: 'sort',
            prompt: 'put them in order',
            feedback: fb('Yes.', 'follow one drop round the cycle.'),
            items: [
              {
                id: 'a',
                label: 'glycolysis',
                box: box(2, 2),
                rank: 1,
                why: 'glucose is split first.',
              },
              {
                id: 'b',
                label: 'the link reaction',
                box: box(2, 20),
                rank: 2,
                why: 'pyruvate enters the mitochondrion.',
              },
              {
                id: 'c',
                label: 'the Krebs cycle',
                box: box(2, 40),
                rank: 2,
                why: 'the cycle runs last.',
              },
            ],
          },
        },
      ],
    };
    const out: Refusal[] = [];
    expect(parseDesign(design, out)).toBeNull();
    expect(why(out)).toContain('no gaps or ties');
  });

  it('refuses a branch with no wrong answer, and a distractor that teaches nothing', () => {
    const branch = (options: unknown[]) => ({
      ...drop(),
      steps: [
        {
          id: 'b1',
          beat: 'check',
          primitive: {
            kind: 'branch',
            prompt: 'which one',
            feedback: fb('Yes.', 'turn it in your head.'),
            options,
          },
        },
      ],
    });
    const allRight = branch([
      { id: 'a', label: 'one', box: box(2, 2), correct: true },
      { id: 'b', label: 'two', box: box(2, 20), correct: true },
    ]);
    const out: Refusal[] = [];
    expect(parseDesign(allRight, out)).toBeNull();
    expect(why(out)).toContain('at least one wrong one');

    const silent = branch([
      { id: 'a', label: 'one', box: box(2, 2), correct: true },
      { id: 'b', label: 'two', box: box(2, 20), correct: false, teaches: '' },
    ]);
    const out2: Refusal[] = [];
    expect(parseDesign(silent, out2)).toBeNull();
    expect(why(out2)).toContain('teaches nothing');
  });

  it('refuses a slide bound to a mark that is not on the stage, and a NaN range', () => {
    const slide = (over: Record<string, unknown>, marks: unknown[] = []) => ({
      ...drop(),
      marks,
      steps: [
        {
          id: 'b1',
          beat: 'build',
          primitive: {
            kind: 'slide',
            prompt: 'stretch the bar',
            min: 2,
            max: 12,
            from: 2,
            at: 8,
            feedback: fb('Yes.', 'more pieces, smaller pieces.'),
            ...over,
          },
        },
      ],
    });
    const out: Refusal[] = [];
    expect(parseDesign(slide({ bind: { mark: 'ghost', prop: 'x', at: [0, 10] } }), out)).toBeNull();
    expect(why(out)).toContain('not on the stage');
    expect(parseDesign(slide({ max: Number.NaN }))).toBeNull();
    expect(parseDesign(slide({ at: 99 }))).toBeNull();
    expect(parseDesign(slide({ at: 2 }))).toBeNull(); // the threshold is where it starts
  });

  it('refuses a tap or a drag that names a mark the stage does not carry', () => {
    const stage = [{ id: 'bar', shape: 'rect', x: 10, y: 10, w: 20, h: 20 }];
    const tap = {
      ...drop(),
      marks: stage,
      steps: [
        {
          id: 'b1',
          beat: 'build',
          primitive: { kind: 'tap', prompt: 'tap it', targets: ['ghost'], need: 1, feedback: fb() },
        },
      ],
    };
    const out: Refusal[] = [];
    expect(parseDesign(tap, out)).toBeNull();
    expect(why(out)).toContain('not on the stage');
  });

  it('refuses a design of nothing but timers, scores and reveals', () => {
    const all = {
      ...drop(),
      steps: [
        {
          id: 'b1',
          beat: 'fun',
          primitive: {
            kind: 'timer',
            seconds: 60,
            onExpire: 'reveal',
            feedback: fb('Up.', 'nothing is taken away.'),
          },
        },
        {
          id: 'b2',
          beat: 'fun',
          primitive: { kind: 'score', perRight: 10, feedback: fb('Ten.', 'nothing lost.') },
        },
      ],
    };
    const out: Refusal[] = [];
    expect(parseDesign(all, out)).toBeNull();
    expect(why(out)).toContain('asks for no act');
  });

  it('refuses a score where a wrong move pays, and a clock outside its range', () => {
    const withMod = (primitive: unknown) => ({
      ...drop(),
      steps: [...drop().steps, { id: 'm', beat: 'fun', primitive }],
    });
    expect(
      parseDesign(
        withMod({ kind: 'score', perRight: 10, perWrong: 5, feedback: fb('Ten.', 'nothing.') }),
      ),
    ).toBeNull();
    expect(
      parseDesign(
        withMod({ kind: 'timer', seconds: 4, onExpire: 'reveal', feedback: fb('Up.', 'nothing.') }),
      ),
    ).toBeNull();
    expect(
      parseDesign(
        withMod({
          kind: 'timer',
          seconds: 60,
          onExpire: 'reveal',
          feedback: fb('Up.', 'nothing.'),
        }),
      ),
    ).not.toBeNull();
  });

  it('refuses more than five beats', () => {
    const one = act(drop());
    const many = Array.from({ length: 6 }, (_, i) => ({ ...one, id: `b${i}` }));
    const out: Refusal[] = [];
    expect(parseDesign({ ...drop(), steps: many }, out)).toBeNull();
    expect(why(out)).toContain('one to five beats');
  });

  it('refuses a branch option that routes to a beat that is not there', () => {
    const design = {
      ...drop(),
      steps: [
        {
          id: 'b1',
          beat: 'check',
          primitive: {
            kind: 'branch',
            prompt: 'which one',
            feedback: fb('Yes.', 'turn it in your head.'),
            options: [
              { id: 'a', label: 'one', box: box(2, 2), correct: true },
              {
                id: 'b',
                label: 'two',
                box: box(2, 20),
                correct: false,
                teaches: 'the bottom changes when you turn it.',
                goto: 'nowhere',
              },
            ],
          },
        },
      ],
    };
    const out: Refusal[] = [];
    expect(parseDesign(design, out)).toBeNull();
    expect(why(out)).toContain('not a beat');
  });

  it('drops a mark whose coordinates are not finite rather than drawing a broken shape', () => {
    const design = {
      ...drop(),
      marks: [
        { id: 'ghost', shape: 'circle', x: Number.NaN, y: 30, r: 8 },
        { id: 'real', shape: 'circle', x: 60, y: 30, r: 8 },
      ],
    };
    const parsed = parseDesign(design);
    expect(parsed?.marks.map((m) => m.id)).toEqual(['real']);
  });
});

describe('what the renderer asks of a beat', () => {
  const d = parseDesign(drop()) as Design;

  it('counts the right moves a beat needs', () => {
    expect(movesNeeded(firstBeat(d).primitive)).toBe(2);
  });

  it('gives the piece its own reason before the primitive’s line', () => {
    expect(teachFor(firstBeat(d).primitive, 'wall')).toContain('only a plant builds a wall');
    expect(teachFor(firstBeat(d).primitive, 'absent')).toContain('smaller share');
  });

  it('lifts the modifiers off the acts, so a clock is never a beat a learner plays', () => {
    const withClock = parseDesign({
      ...drop(),
      steps: [
        ...drop().steps,
        {
          id: 'm',
          beat: 'fun',
          primitive: {
            kind: 'timer',
            seconds: 45,
            onExpire: 'reveal',
            feedback: fb('Up.', 'nothing lost.'),
          },
        },
      ],
    }) as Design;
    expect(withClock.steps).toHaveLength(2);
    expect(acts(withClock)).toHaveLength(1);
    expect(modifier(withClock, 'timer')?.seconds).toBe(45);
    expect(modifier(withClock, 'score')).toBeUndefined();
  });

  it('walks on by one when nothing branched', () => {
    expect(nextBeat(d, 0)).toBe(1);
  });

  it('follows a branch option that names where it goes', () => {
    const two = parseDesign({
      ...drop(),
      steps: [
        {
          id: 'ask',
          beat: 'check',
          primitive: {
            kind: 'branch',
            prompt: 'which one',
            feedback: fb('Yes.', 'turn it in your head.'),
            options: [
              { id: 'right', label: 'one', box: box(2, 2), correct: true },
              {
                id: 'wrong',
                label: 'two',
                box: box(2, 20),
                correct: false,
                teaches: 'turning it changes the bottom.',
                goto: 'repair',
              },
            ],
          },
        },
        { ...act(drop()), id: 'repair' },
      ],
    }) as Design;
    expect(nextBeat(two, 0, 'wrong')).toBe(1);
    expect(nextBeat(two, 0, 'right')).toBe(1);
  });
});

describe('the template floors — the quality nothing falls under (§3)', () => {
  it('has a floor for every composable row of section 2, and the challenge is one of them', () => {
    expect(Object.keys(FLOORS).sort()).toEqual([
      'classify',
      'construct',
      'discriminate',
      'drill',
      'match',
      'order',
      'vary',
    ]);
    expect(ROWS).toHaveLength(7);
  });

  it('every floor goes through the same door the designer’s work does', () => {
    for (const [row, floor] of Object.entries(FLOORS)) {
      const out: Refusal[] = [];
      const parsed = parseDesign(floor, out);
      expect(`${row}: ${why(out)}`).toBe(`${row}: `);
      expect(parsed?.source).toBe('floor');
    }
  });

  it('each floor is the act its row calls for', () => {
    const kindOf = (row: keyof typeof FLOORS) => (FLOORS[row].steps[0] as Beat).primitive.kind;
    expect(kindOf('classify')).toBe('drop');
    expect(kindOf('order')).toBe('sort');
    expect(kindOf('match')).toBe('match');
    expect(kindOf('vary')).toBe('slide');
    expect(kindOf('construct')).toBe('sequence');
    expect(kindOf('discriminate')).toBe('branch');
  });

  it('the challenge is not a tenth primitive: it is discriminate with a clock and a score', () => {
    const drill = parseDesign(FLOORS.drill) as Design;
    expect(acts(drill).map((b) => b.primitive.kind)).toEqual(['branch']);
    expect(modifier(drill, 'timer')?.seconds).toBe(60);
    expect(modifier(drill, 'score')?.perRight).toBe(10);
  });

  it('falls back rather than failing when the row is unknown', () => {
    expect(floorFor('classify').id).toBe('floor-classify');
    expect(floorFor('not a row').id).toBe('floor-discriminate');
  });

  it('a level rendering fills the floor: the content moves, the composition does not', () => {
    const filled = fillFloor('order', {
      concept: 'The stages of mitosis',
      prompt: 'Put the four stages in the order a cell passes through them.',
      pieces: [
        { id: 'pro', label: 'Prophase', why: 'The chromosomes condense before anything can move.' },
        {
          id: 'meta',
          label: 'Metaphase',
          why: 'They line up on the plate before they are pulled apart.',
        },
        {
          id: 'ana',
          label: 'Anaphase',
          why: 'Only once they are lined up can they be pulled to the poles.',
        },
        { id: 'telo', label: 'Telophase', why: 'The two nuclei re-form last.' },
      ],
    });
    const parsed = parseDesign(filled);
    expect(parsed?.concept).toBe('The stages of mitosis');
    const p = (parsed as Design).steps[0]?.primitive as Beat['primitive'];
    expect(p.kind).toBe('sort');
    if (p.kind === 'sort') {
      expect(p.items.map((i) => i.label)).toEqual([
        'Prophase',
        'Metaphase',
        'Anaphase',
        'Telophase',
      ]);
      expect(p.items.map((i) => i.rank)).toEqual([1, 2, 3, 4]);
      expect(p.prompt).toContain('a cell passes through');
    }
  });

  it('a filling that names nothing degrades to the floor, never to a hole', () => {
    const filled = fillFloor('match', {});
    expect(parseDesign(filled)).not.toBeNull();
    expect(filled.concept).toBe(FLOORS.match.concept);
  });
});

describe('the designer’s three outputs', () => {
  it('there are three, from three different concepts', () => {
    expect(DESIGNED).toHaveLength(3);
    expect(new Set(DESIGNED.map((d) => d.concept)).size).toBe(3);
  });

  it('every one passes the door', () => {
    for (const d of DESIGNED) {
      const out: Refusal[] = [];
      const parsed = parseDesign(d, out);
      expect(`${d.concept}: ${why(out)}`).toBe(`${d.concept}: `);
      expect(parsed).not.toBeNull();
    }
  });

  it('each mixes its acts — one builds, one checks, one makes it fun, never three the same (§2)', () => {
    for (const d of DESIGNED) {
      const parsed = parseDesign(d) as Design;
      const kinds = acts(parsed).map((b) => b.primitive.kind);
      expect(kinds.length).toBeGreaterThanOrEqual(3);
      expect(new Set(kinds).size).toBe(kinds.length);
      expect(kinds.some((k) => MANIPULATIVE.has(k))).toBe(true);
      const beats = new Set(acts(parsed).map((b) => b.beat));
      expect(beats.has('build') || beats.has('check')).toBe(true);
    }
  });

  it('between the floors and the three designs, every act in the vocabulary is rendered', () => {
    const seen = new Set<string>();
    for (const d of [...DESIGNED, ...Object.values(FLOORS)]) {
      const parsed = parseDesign(d) as Design;
      for (const b of acts(parsed)) seen.add(b.primitive.kind);
    }
    expect([...seen].sort()).toEqual([
      'branch',
      'drag',
      'drop',
      'mark',
      'match',
      'sequence',
      'slide',
      'sort',
      'tap',
    ]);
  });

  it('never narrates: nothing describes the software or announces what it is about to do', () => {
    const banned =
      /\b(let me|i['’]ll|i will|this (?:diagram|interaction|activity)|drawn for you|loading|try again)\b/i;
    for (const d of [...DESIGNED, ...Object.values(FLOORS)]) {
      const parsed = parseDesign(d) as Design;
      const words: string[] = [parsed.mechanic, parsed.why];
      for (const b of parsed.steps) {
        if ('prompt' in b.primitive) words.push(b.primitive.prompt);
        if ('feedback' in b.primitive && b.primitive.feedback) {
          words.push(b.primitive.feedback.right, b.primitive.feedback.wrong);
        }
        if (b.surprise) words.push(b.surprise);
      }
      expect(`${parsed.id}: ${words.join(' ')}`).not.toMatch(banned);
    }
  });

  it('carries no em dash a learner reads', () => {
    for (const d of [...DESIGNED, ...Object.values(FLOORS)]) {
      const parsed = parseDesign(d) as Design;
      expect(JSON.stringify(parsed)).not.toContain('—');
    }
  });

  it('every hit box in every design is a finger’s worth at 390 wide', () => {
    for (const d of [...DESIGNED, ...Object.values(FLOORS)]) {
      const parsed = parseDesign(d) as Design;
      for (const b of parsed.steps) {
        const p = b.primitive;
        const boxes =
          p.kind === 'drop'
            ? [...p.tokens.map((t) => t.box), ...p.zones.map((z) => z.box)]
            : p.kind === 'sort'
              ? p.items.map((i) => i.box)
              : p.kind === 'sequence'
                ? p.steps.map((s) => s.box)
                : p.kind === 'branch'
                  ? p.options.map((o) => o.box)
                  : p.kind === 'match'
                    ? [p.card]
                    : [];
        for (const bx of boxes) {
          expect(bx.w * PHONE_PX_PER_UNIT).toBeGreaterThanOrEqual(MIN_HIT_PX - 0.01);
          expect(bx.h * PHONE_PX_PER_UNIT).toBeGreaterThanOrEqual(MIN_HIT_PX - 0.01);
        }
      }
    }
  });
});
