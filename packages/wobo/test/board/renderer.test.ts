import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { frameOf } from '../../src/board/anchors';
import type { ObjectGeometry } from '../../src/board/geometry';
import type { Stroke } from '../../src/board/pen';
import { inkLength, spokenLabel, strokeSlots, surfaceArea } from '../../src/board/renderer';
import { type BoardObject, CONTROL_KINDS, MARK_KINDS, SHAPE_KINDS } from '../../src/board/schema';
import { BoardStore } from '../../src/board/store';

const stroke = (length: number): Stroke => ({ d: 'M 0 0 L 1 0', length });

const geometry = (strokes: Stroke[], glyphTravel: number): ObjectGeometry => ({
  strokes,
  glyphs: glyphTravel
    ? [{ trace: [{ d: 'M 0 0', length: glyphTravel }], box: { x: 0, y: 0, w: 1, h: 1 } }]
    : [],
  box: { x: 0, y: 0, w: 1, h: 1 },
  length: strokes.reduce((s, x) => s + x.length, 0) + glyphTravel,
});

describe('one clock for strokes and written glyphs', () => {
  it('shares the object’s draw time across everything it has to draw', () => {
    // An axis: 30 units of rule, then a 10-unit label. The rules must not finish before the label
    // starts — three quarters of the time is the rules, the last quarter is the writing.
    const slots = strokeSlots(geometry([stroke(30)], 10));
    expect(slots[0]).toEqual({ from: 0, to: 0.75 });
  });

  it('splits the strokes in proportion to their own length', () => {
    const slots = strokeSlots(geometry([stroke(30), stroke(10)], 0));
    expect(slots[0]).toEqual({ from: 0, to: 0.75 });
    expect(slots[1]).toEqual({ from: 0.75, to: 1 });
  });

  it('falls back to equal shares when nothing has length (a pure fill)', () => {
    const slots = strokeSlots(geometry([{ d: 'M 0 0 Z', length: 0, fill: true }], 0));
    expect(slots[0]?.to).toBe(1);
  });

  it('an object with only writing has no stroke slots at all', () => {
    expect(strokeSlots(geometry([], 40))).toEqual([]);
  });
});

describe('surface helpers', () => {
  it('measures the pen travel of a set of strokes', () => {
    expect(inkLength([stroke(10), stroke(5)])).toBe(15);
    expect(inkLength([])).toBe(0);
  });

  it('reports the board area of a surface: 1000 wide by its own aspect', () => {
    expect(surfaceArea(frameOf({ x: 0, y: 0, width: 500, height: 250 }))).toEqual({
      x: 0,
      y: 0,
      w: 1000,
      h: 500,
    });
  });
});

/**
 * Everything on a board is announced (docs/BOARD.md §8, DESIGN.md's accessibility law).
 *
 * The surface used to be `role="img"`, which is atomic to assistive technology: the per-object
 * aria-labels the hand writes into the tree were invisible, the whole board read as one image
 * called "Wobo's board", and nothing announced new ink at all. That was fixed, and it uncovered
 * the deeper one: the text that went into the live region was the WORDS off the object, so six
 * kinds spoke and twenty-two were announced as nothing at all.
 *
 * A block in this file used to assert that silence on purpose: "says nothing about a shape that
 * has no words — it is not a caption on a picture". That is the right rule for a photograph and
 * the wrong one for a board, and the difference is the whole product. Wobo's premise is that it
 * DRAWS the explanation; on the real Pythagoras board six of fourteen objects were silent, and
 * they were the triangle, the three squares, the rule under the total and the ring around the
 * answer. A learner who could not see the drawing was getting the least of what we offer.
 *
 * So the rule now is the opposite one, and these are its cases: every kind says what it is, in
 * words a person would say; a mark says what it is ABOUT; and the last block walks two real
 * golden boards end to end, because a description that is correct object by object and senseless
 * in order is still not teaching.
 */
describe('what a screen reader is told about a board', () => {
  const said = (object: Record<string, unknown>, look?: (id: string) => unknown) =>
    spokenLabel(object as never, look as never);

  it('reads the words Wobo wrote', () => {
    expect(said({ id: 'a', kind: 'write', text: 'the first revolt' })).toBe('the first revolt');
    expect(said({ id: 'b', kind: 'label', text: '1857' })).toBe('1857');
    // A formula is READ, not spelled. Announcing the source made a screen reader say "a caret two
    // plus b caret two" for the one object on the board that carries the mathematics.
    expect(said({ id: 'c', kind: 'tex', tex: 'a^2 + b^2' })).toBe('a squared plus b squared');
    expect(said({ id: 'd', kind: 'region', title: 'the salt march' })).toBe('the salt march');
  });

  it('reads a computed number with its unit, and never drops the value for its label', () => {
    expect(said({ id: 'n', kind: 'number', value: 9.81, unit: 'm/s2', verified: true })).toBe(
      '9.81 m/s2',
    );
    expect(said({ id: 'n', kind: 'number', value: 90, verified: true })).toBe('90');
    // The label is Wobo's own sentence about the quantity, so it leads and the value follows it.
    // This is the case the old rule got wrong on a real board: `label: 'a² ='` with `value: 16`
    // was announced as "a² =" and the sixteen was never said out loud.
    expect(said({ id: 'n', kind: 'number', value: 16, label: 'a² =', verified: true })).toBe(
      'a² = 16',
    );
    // A label that already carries the number is left exactly as Wobo wrote it.
    expect(
      said({ id: 'n', kind: 'number', value: 90, label: 'from 1857 to 1947 = 90 years' }),
    ).toBe('from 1857 to 1947 = 90 years');
  });

  it('reads a table row by row', () => {
    expect(
      said({
        id: 't',
        kind: 'table',
        rows: [
          ['element', 'left', 'right'],
          ['C', '6', '6'],
        ],
      }),
    ).toBe('element, left, right. C, 6, 6');
  });

  it('names a shape as a learner would name it, not as a type', () => {
    const poly = (points: number[][], style?: unknown) => ({
      id: 'p',
      kind: 'polygon',
      anchor: { board: [0, 0] },
      points,
      ...(style ? { style } : {}),
    });
    expect(
      said(
        poly([
          [0, 0],
          [0, 90],
          [120, 90],
        ]),
      ),
    ).toBe('a right-angled triangle');
    expect(
      said(
        poly([
          [0, 0],
          [60, 100],
          [120, 0],
        ]),
      ),
    ).toBe('a triangle');
    expect(
      said(
        poly([
          [0, 0],
          [120, 0],
          [120, 120],
          [0, 120],
        ]),
      ),
    ).toBe('a square');
    expect(
      said(
        poly([
          [0, 0],
          [200, 0],
          [200, 90],
          [0, 90],
        ]),
      ),
    ).toBe('a rectangle');
    // The square on the hypotenuse, drawn on its corner. It is still a square, and a listener is
    // told which one it is: on the Pythagoras board this is the ONLY thing the measurements can
    // use to tell the big square apart from the two on the legs.
    expect(
      said(
        poly([
          [0, 120],
          [120, 210],
          [210, 90],
          [90, 0],
        ]),
      ),
    ).toBe('a tilted square');
    expect(said({ id: 'e', kind: 'ellipse', anchor: { board: [0, 0] }, rx: 80, ry: 80 })).toBe(
      'a circle',
    );
    expect(said({ id: 'e', kind: 'ellipse', anchor: { board: [0, 0] }, rx: 26, ry: 18 })).toBe(
      'an oval',
    );
  });

  it('says what is shaded, and how much of it', () => {
    const square = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(said({ id: 'p', kind: 'polygon', points: square, style: { fill: 'wash' } })).toBe(
      'a shaded square',
    );
    expect(said({ id: 'p', kind: 'polygon', points: square, style: { fill: 'solid' } })).toBe(
      'a filled-in square',
    );
    expect(said({ id: 'e', kind: 'ellipse', rx: 26, ry: 18, style: { fill: 'wash' } })).toBe(
      'a shaded oval',
    );
    expect(said({ id: 'r', kind: 'region', w: 100, h: 60, style: { fill: 'wash' } })).toBe(
      'a shaded area',
    );
  });

  it('says what a mark is about, because that is the whole meaning of a mark', () => {
    const board = {
      answer: { id: 'answer', kind: 'write', text: 'so c = 5' },
      total: { id: 'total', kind: 'number', value: 25, label: 'c² =', verified: true },
    } as Record<string, unknown>;
    const look = (id: string) => board[id];
    expect(said({ id: 'ring', kind: 'circle', anchor: { object: 'answer' } }, look)).toBe(
      'a ring around so c = 5',
    );
    expect(said({ id: 'rule', kind: 'underline', anchor: { object: 'total' } }, look)).toBe(
      'a line under c² = 25',
    );
    expect(said({ id: 'x', kind: 'strike', anchor: { object: 'answer' } }, look)).toBe(
      'so c = 5, crossed out',
    );
    expect(said({ id: 'e', kind: 'erase', object: 'answer' }, look)).toBe('so c = 5, rubbed out');
    // With nobody to ask, it says what it is rather than what it is about. Still true, less useful.
    expect(said({ id: 'ring', kind: 'circle', anchor: { object: 'answer' } })).toBe('a ring');
    // A bare coordinate is left unsaid: "at 660 by 210" tells a listener nothing about the lesson.
    expect(said({ id: 'd', kind: 'point', anchor: { board: [660, 210] } })).toBe('a dot');
    // A region the learner circled is named in the learner's own terms.
    expect(said({ id: 'd', kind: 'point', anchor: { focus: 'f1' } })).toBe(
      'a dot on what you circled',
    );
  });

  it('says where an arrow comes from and what it points at', () => {
    const board = {
      block: { id: 'block', kind: 'ellipse', rx: 26, ry: 18 },
      sun: { id: 'sun', kind: 'label', text: 'the sun' },
    } as Record<string, unknown>;
    const look = (id: string) => board[id];
    expect(
      said({ id: 'a', kind: 'arrow', anchor: { object: 'sun' }, from: { object: 'block' } }, look),
    ).toBe('an arrow from an oval to the sun');
    expect(said({ id: 'a', kind: 'arrow', anchor: { object: 'sun' } }, look)).toBe(
      'an arrow pointing at the sun',
    );
    // A force arrow: it starts on something and ends in a direction, which has no name.
    expect(
      said(
        { id: 'a', kind: 'arrow', anchor: { board: [10, 10] }, from: { object: 'block' } },
        look,
      ),
    ).toBe('an arrow from an oval');
    expect(said({ id: 'a', kind: 'arrow', anchor: { board: [10, 10] } })).toBe('an arrow');
  });

  it('reads the working parts: an axis, a grid, a control the learner can move', () => {
    expect(
      said({
        id: 'x',
        kind: 'axis',
        orientation: 'x',
        min: 1850,
        max: 1950,
        step: 10,
        length: 780,
        label: 'year',
      }),
    ).toBe('the x axis, year, from 1850 to 1950');
    expect(said({ id: 'g', kind: 'grid', cols: 4, rows: 3, w: 100, h: 80 })).toBe(
      'a grid, 4 across and 3 down',
    );
    expect(
      said({ id: 's', kind: 'slider', variable: 'a', min: 0.4, max: 2.6, value: 1.5, label: 'x' }),
    ).toBe('a slider for x, from 0.4 to 2.6, now at 1.5');
    expect(
      said({ id: 't', kind: 'toggle', variable: 'grid', value: true, label: 'the grid' }),
    ).toBe('a switch for the grid, on');
    expect(said({ id: 'i', kind: 'input', variable: 'n', value: '12' })).toBe(
      'a box for n, holding 12',
    );
  });

  it('reads chemistry as chemistry', () => {
    expect(said({ id: 'c', kind: 'atom', symbol: 'C' })).toBe('carbon');
    expect(said({ id: 'o', kind: 'atom', symbol: 'O', lonePairs: 2 })).toBe(
      'oxygen, two lone pairs',
    );
    expect(said({ id: 'n', kind: 'atom', symbol: 'Na', charge: 1 })).toBe('sodium, charge +1');
    // A symbol we do not name is spoken as it is written, never invented.
    expect(said({ id: 'x', kind: 'atom', symbol: 'Xx' })).toBe('Xx');
    expect(said({ id: 'b', kind: 'bond', to: [10, 10], order: 2 })).toBe('a double bond');
    expect(said({ id: 'b', kind: 'bond', to: [10, 10], wedge: 'up' })).toBe(
      'a bond coming towards you',
    );
  });

  it('tells the learner which marks are their own', () => {
    expect(
      said({
        id: 'learner-1',
        kind: 'polyline',
        points: [
          [0, 0],
          [10, 10],
          [20, 5],
        ],
        style: { ink: 'learner' },
      }),
    ).toBe('your own mark');
  });

  it('leaves nothing in the grammar silent', () => {
    const one: Record<string, Record<string, unknown>> = {
      point: {},
      circle: {},
      underline: {},
      arrow: {},
      bracket: {},
      strike: {},
      number: { value: 1, verified: true },
      write: { text: 'x' },
      erase: { object: 'gone' },
      wipe: {},
      line: { to: { board: [1, 1] } },
      polyline: {
        points: [
          [0, 0],
          [1, 1],
        ],
      },
      curve: {
        points: [
          [0, 0],
          [1, 1],
        ],
      },
      polygon: {
        points: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      },
      ellipse: { rx: 1, ry: 1 },
      axis: { orientation: 'x', min: 0, max: 1, step: 1, length: 10 },
      grid: { cols: 2, rows: 2, w: 10, h: 10 },
      table: { rows: [['a']], w: 10 },
      label: { text: 'x' },
      tex: { tex: 'x' },
      bond: { to: [1, 1] },
      atom: { symbol: 'C' },
      region: { w: 10, h: 10 },
      image: { href: 'x', w: 10, h: 10, alt: 'a leaf' },
      slider: { variable: 'a', min: 0, max: 1, value: 0.5 },
      toggle: { variable: 'a', value: false },
      input: { variable: 'a', value: '' },
      drag: { variable: 'a', value: [0, 0] },
    };
    const kinds = [...MARK_KINDS, ...SHAPE_KINDS, ...CONTROL_KINDS];
    expect(Object.keys(one).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) {
      const object = { id: kind, kind, anchor: { board: [0, 0] }, ...one[kind] };
      expect(said(object).length, kind).toBeGreaterThan(0);
    }
  });
});

/**
 * A real board, walked in the order a screen reader walks it.
 *
 * Object by object this could be perfect and the board could still teach nothing, because a
 * description in the wrong order is not an explanation. The renderer announces in the order the
 * ink lands, which is the order Wobo says it in, so these two assertions are the whole board read
 * aloud: the Pythagoras proof, and the timeline whose rhythm is dot, year, event.
 */
describe('a real board, read aloud in order', () => {
  const REPO = new URL('../../../../', import.meta.url).pathname;

  function golden(name: string): { plan: { type: string; object?: BoardObject }[] } {
    const file = join(REPO, 'apps', 'web-pwa', 'src', 'wobo', 'goldens', `${name}.json`);
    return JSON.parse(readFileSync(file, 'utf8'));
  }

  /** Exactly what the live region says, in the order the store hands the objects over. */
  function readAloud(name: string): string[] {
    const store = new BoardStore({ presentation: 'full' });
    for (const event of golden(name).plan) {
      if (event.type === 'ink' && event.object) store.ink(event.object);
    }
    return store
      .snapshot()
      .map((s) => spokenLabel(s.object, (id) => store.get(id)?.object))
      .filter(Boolean);
  }

  /**
   * THE PROOF IS THE THREE SQUARES, AND THEY USED TO BE ONE SENTENCE SAID THREE TIMES.
   *
   * The transcript below used to read "a square. a square. a square." — every distinguishing fact
   * present in the golden and discarded. Square-a is 120 across and sits under the shorter leg,
   * square-b is 90 across and sits beside the upright one, square-c is the tilted 150-unit square
   * on the hypotenuse. A listener could not tell there was a big one, a small one and a tilted
   * one, could not tell which side each sat on, and so never heard the relationship the lesson
   * exists to teach — and the test locked that in by asserting the three identical strings.
   *
   * Two things fixed it. The board names its own shapes (`title`, spoken and never drawn, the way
   * `alt` names an image), and a square drawn on its corner now says that it is. The formula is
   * read as a teacher reads it rather than as its own LaTeX.
   */
  it('reads the whole Pythagoras proof, and tells the three squares apart', () => {
    const heard = readAloud('pythagoras');
    expect(heard).toEqual([
      'a right-angled triangle',
      'a',
      'b',
      'c',
      'the square on side a, the shorter leg',
      'the square on side b, the upright leg',
      'the tilted square on the hypotenuse, the one the other two fill',
      'a squared plus b squared equals c squared',
      'a² = 16',
      'b² = 9',
      'c² = 25',
      'a line under c² = 25',
      'so c = 5',
      'a ring around so c = 5',
    ]);
    // The point of the block above, asserted as itself: no two objects on this board say the
    // same thing, so nothing on it is unhearable.
    expect(new Set(heard).size).toBe(heard.length);
  });

  /**
   * The formula IS the physics on this board, and it was announced as its own source: "h equals
   * backslash frac open brace open paren v underscore zero backslash sin theta close paren caret
   * two close brace open brace two g close brace".
   */
  it('reads the projectile board’s formula the way a teacher would say it', () => {
    expect(readAloud('projectile-apex')).toContain(
      'h equals v nought sine theta, all squared over 2g',
    );
  });

  it('keeps the rhythm of the timeline board: the mark, then the year, then what happened', () => {
    expect(readAloud('timeline').slice(0, 7)).toEqual([
      'the x axis, year, from 1850 to 1950',
      'a dot',
      '1857',
      'the first revolt',
      'a dot',
      '1885',
      'the Congress founded',
    ]);
    // And the last thing said is the ring, around the thing it was drawn around.
    expect(readAloud('timeline').at(-1)).toBe('a ring around a dot');
  });

  it('leaves nothing on any golden board unsaid', () => {
    const boards = [
      'benzene',
      'food-web',
      'free-body-incline',
      'long-division',
      'photosynthesis-balance',
      'plant-cell',
      'projectile-apex',
      'pythagoras',
      'series-circuit',
      'tangent-parabola',
      'timeline',
      'titration-curve',
    ];
    for (const name of boards) {
      const objects = golden(name).plan.filter((e) => e.type === 'ink').length;
      expect(readAloud(name).length, name).toBe(objects);
    }
  });
});
