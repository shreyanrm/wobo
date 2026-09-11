/**
 * Three designed interactions, in the shape `create.core` returns them (docs/CONTENT-INTERACTION.md
 * §8: one Astra call returns the concept core and two or three candidate mechanics; the judge picks
 * one and the rest are stored for the ninety-day rotation). These are the picked ones.
 *
 * They are here as DATA, not as content the product serves: the renderer has to be provable without
 * a model call, and this wave spends nothing on Astra. Each is a real concept from a real board and
 * class, written to §2's rule for a mix — one act that builds the idea, one that checks it, one that
 * makes it fun, and never three of the same kind — and each exercises primitives the floors do not,
 * so between the two sets every act in the vocabulary is rendered and measured.
 *
 * `tests/composition.spec.ts` plays every beat of all three at 390 and 1440.
 */

import type { HitBox } from '@wobo/contracts/plexus';
import type { Design } from './parse';
import { MIN_HIT_UNITS, STAGE_H, STAGE_W } from './parse';

const box = (x: number, y: number, w = 46, h = 14): HitBox => ({
  x,
  y,
  w: Math.max(MIN_HIT_UNITS, Math.min(w, STAGE_W - x)),
  h: Math.max(MIN_HIT_UNITS, Math.min(h, STAGE_H - y)),
});
/** Two columns, four rows. */
const slot = (i: number): HitBox => box(i % 2 === 0 ? 2 : 52, 2 + Math.floor(i / 2) * 15);
/** One full-width column. */
const line = (i: number): HitBox => box(2, 2 + i * 15, 96);

// --- CBSE, class 6, mathematics ------------------------------------------------------------------------

/** The core: more pieces and more of them shaded is the same amount of chocolate. */
const equivalentFractions: Design = {
  id: 'designed-equivalent-fractions',
  concept: 'Equivalent fractions',
  kind: 'vary',
  mechanic: 'Stretch a chocolate bar into more pieces and watch two fractions stay the same size.',
  why: 'The misconception is that a bigger bottom number means more. Only watching the shaded amount refuse to change undoes it.',
  source: 'model',
  refreshDays: 90,
  marks: [
    { id: 'bar', shape: 'rect', x: 10, y: 18, w: 80, h: 20, tone: 'muted', fill: 'soft' },
    { id: 'shaded', shape: 'rect', x: 10, y: 18, w: 40, h: 20, tone: 'hue', fill: 'solid' },
    { id: 'cut', shape: 'line', x: 50, y: 14, x2: 50, y2: 42, tone: 'ink' },
    {
      id: 'half',
      shape: 'text',
      x: 50,
      y: 50,
      text: 'half the bar, however it is cut',
      tone: 'muted',
    },
  ],
  steps: [
    {
      id: 'stretch',
      beat: 'build',
      surprise:
        'The shaded part never grew. Only the number of cuts changed, so 1/2 and 4/8 are the same chocolate.',
      primitive: {
        kind: 'slide',
        prompt: 'Cut the bar into more pieces. Watch the shaded part as you go.',
        min: 2,
        max: 12,
        from: 2,
        at: 8,
        valueLabel: '{v} pieces',
        bind: { mark: 'cut', prop: 'x', at: [50, 50] },
        feedback: {
          right: 'Eight pieces, four of them shaded, and the amount has not moved.',
          wrong:
            'Cutting the bar into fewer pieces does not give you less chocolate either. Watch the shaded part, not the count.',
        },
      },
    },
    {
      id: 'order',
      beat: 'check',
      surprise:
        'A bigger number underneath means smaller pieces, so 1/8 is less than 1/3 even though 8 is more than 3.',
      primitive: {
        kind: 'sort',
        prompt: 'Put the fractions in order, smallest first.',
        axis: 'vertical',
        feedback: {
          right: 'Smallest pieces first, largest share last.',
          wrong:
            'Read the bottom number as how many pieces the whole was cut into. More pieces, smaller pieces.',
        },
        items: [
          {
            id: 'f18',
            label: '1/8',
            box: line(0),
            rank: 1,
            why: 'The whole was cut into eight, so one piece is the smallest here.',
          },
          {
            id: 'f14',
            label: '1/4',
            box: line(1),
            rank: 2,
            why: 'Four pieces, so each is bigger than an eighth and smaller than a third.',
          },
          {
            id: 'f13',
            label: '1/3',
            box: line(2),
            rank: 3,
            why: 'Three pieces, so each is bigger than a quarter.',
          },
          {
            id: 'f12',
            label: '1/2',
            box: line(3),
            rank: 4,
            why: 'Two pieces, so one of them is half the whole.',
          },
        ],
      },
    },
    {
      id: 'pairs',
      beat: 'fun',
      surprise:
        'Multiply the top and the bottom by the same number and the fraction has not moved.',
      primitive: {
        kind: 'match',
        prompt: 'Join each fraction to the one worth the same.',
        card: box(2, 2, 44, 14),
        feedback: {
          right: 'Same amount, cut differently.',
          wrong: 'Ask what the bottom was multiplied by, then do that same thing to the top.',
        },
        pairs: [
          {
            id: 'p12',
            left: '1/2',
            right: '4/8',
            why: 'Both the top and the bottom were multiplied by four.',
          },
          {
            id: 'p13',
            left: '1/3',
            right: '3/9',
            why: 'Both the top and the bottom were multiplied by three.',
          },
          {
            id: 'p34',
            left: '3/4',
            right: '9/12',
            why: 'Both the top and the bottom were multiplied by three.',
          },
          {
            id: 'p25',
            left: '2/5',
            right: '6/15',
            why: 'Both the top and the bottom were multiplied by three.',
          },
        ],
      },
    },
    {
      id: 'clock',
      beat: 'fun',
      primitive: {
        kind: 'timer',
        seconds: 60,
        onExpire: 'reveal',
        visible: true,
        feedback: {
          right: 'Time is up, and the pairs stand.',
          wrong: 'The clock ran out. Nothing is taken away for that.',
        },
      },
    },
    {
      id: 'points',
      beat: 'fun',
      primitive: {
        kind: 'score',
        perRight: 10,
        perWrong: 0,
        show: 'number',
        feedback: {
          right: 'Ten for that pair.',
          wrong: 'Nothing lost. A wrong join costs no points.',
        },
      },
    },
  ],
};

// --- CBSE, class 8, biology -----------------------------------------------------------------------------

/** The core: a plant cell is an animal cell with three things added. */
const plantCell: Design = {
  id: 'designed-plant-cell',
  concept: 'Inside a plant cell',
  kind: 'classify',
  mechanic:
    'Find the parts on the drawing, put the loose one where it works, then sort what is the plant’s own.',
  why: 'The wall, the chloroplasts and the one big vacuole are the whole difference, and each is a place on the drawing before it is a word.',
  source: 'model',
  refreshDays: 90,
  marks: [
    // The wall alone, not a wall and a membrane three units inside it: two hit areas that close
    // together are one hit area on a phone, and the door refuses a design that asks for both.
    { id: 'wall', shape: 'rect', x: 14, y: 6, w: 72, h: 40, tone: 'ink' },
    { id: 'nucleus', shape: 'circle', x: 38, y: 26, r: 7, tone: 'hue', fill: 'solid' },
    { id: 'chloro', shape: 'ring', x: 66, y: 18, r: 5, tone: 'hue' },
    { id: 'vacuole', shape: 'circle', x: 64, y: 36, r: 6, tone: 'muted', fill: 'soft' },
    { id: 'spare', shape: 'circle', x: 8, y: 55, r: 5, tone: 'hue', fill: 'solid' },
  ],
  steps: [
    {
      id: 'label',
      beat: 'build',
      surprise:
        'The wall is the outermost line, and it is why a plant cell holds its shape when an animal cell cannot.',
      primitive: {
        kind: 'tap',
        prompt: 'Tap the nucleus, then a chloroplast, then the cell wall.',
        targets: ['nucleus', 'chloro', 'wall'],
        need: 3,
        feedback: {
          right: 'That is it.',
          wrong:
            'The wall is the outermost line of all. The green rings are the chloroplasts, and the big pale circle is the vacuole.',
        },
      },
    },
    {
      id: 'place',
      beat: 'build',
      surprise:
        'Chloroplasts sit inside the membrane, in the cytoplasm, where the light that gets through can reach them.',
      primitive: {
        kind: 'drag',
        prompt: 'Put the loose chloroplast where it can do its work.',
        handle: 'spare',
        to: { x: 46, y: 30 },
        radius: 8,
        feedback: {
          right: 'Inside the membrane, where the light reaches it.',
          wrong:
            'Nothing that works for the cell sits outside the wall. The wall is a boundary, not a shelf.',
        },
      },
    },
    {
      id: 'sort',
      beat: 'check',
      surprise:
        'Three things are the plant cell’s alone: the wall, the chloroplasts and the one large vacuole.',
      primitive: {
        kind: 'drop',
        prompt: 'Put each part where it is found.',
        feedback: {
          right: 'That is where it is found.',
          wrong:
            'Ask whether an animal cell could live without it. If it could not, both cells have it.',
        },
        tokens: [
          {
            id: 'wall',
            label: 'Cell wall',
            box: slot(0),
            belongs: 'plant-only',
            why: 'Only a plant builds a wall of cellulose outside its membrane.',
          },
          {
            id: 'chloroplast',
            label: 'Chloroplast',
            box: slot(1),
            belongs: 'plant-only',
            why: 'An animal eats its food. A plant makes it here, from light.',
          },
          {
            id: 'vacuole',
            label: 'One large vacuole',
            box: slot(2),
            belongs: 'plant-only',
            why: 'An animal cell has small vacuoles. The plant keeps one big one full of sap.',
          },
          {
            id: 'nucleus',
            label: 'Nucleus',
            box: slot(3),
            belongs: 'both',
            why: 'Both cells keep their instructions in a nucleus.',
          },
          {
            id: 'membrane',
            label: 'Cell membrane',
            box: slot(4),
            belongs: 'both',
            why: 'Every cell has a membrane. Only the plant has a wall around it as well.',
          },
          {
            id: 'mitochondrion',
            label: 'Mitochondrion',
            box: slot(5),
            belongs: 'both',
            why: 'Plants respire too, so they need mitochondria just as animals do.',
          },
        ],
        zones: [
          {
            id: 'plant-only',
            label: 'The plant cell only',
            box: box(2, 47, 46, 14),
            accepts: ['wall', 'chloroplast', 'vacuole'],
            feedback: {
              right: 'An animal cell has nothing like it.',
              wrong:
                'An animal cell has this too, so it cannot be what makes a plant cell a plant cell.',
            },
          },
          {
            id: 'both',
            label: 'Both cells',
            box: box(52, 47, 46, 14),
            accepts: ['nucleus', 'membrane', 'mitochondrion'],
            feedback: {
              right: 'Every cell needs this one.',
              wrong:
                'An animal cell does not have this. It is one of the three the plant keeps to itself.',
            },
          },
        ],
      },
    },
    {
      id: 'tell-apart',
      beat: 'fun',
      surprise:
        'A straight edge and green bodies inside are enough. Neither can belong to an animal cell.',
      primitive: {
        kind: 'branch',
        prompt: 'One of these is on a slide under the microscope. Which cell is it?',
        feedback: {
          right: 'Two things gave it away, and both are the plant’s own.',
          wrong: 'Look for something an animal cell could not have.',
        },
        options: [
          {
            id: 'plant',
            label: 'A plant cell: a straight edge, and green bodies inside',
            box: line(0),
            correct: true,
            teaches: '',
          },
          {
            id: 'animal',
            label: 'An animal cell, because it has a nucleus',
            box: line(1),
            correct: false,
            teaches: 'Both cells have a nucleus, so a nucleus cannot tell them apart.',
          },
          {
            id: 'bacterium',
            label: 'A bacterium, because it has a wall',
            box: line(2),
            correct: false,
            teaches: 'Bacteria have a wall too, but no nucleus at all. This one has a nucleus.',
          },
          {
            id: 'either',
            label: 'Either: you cannot tell from a picture',
            box: line(3),
            correct: false,
            teaches:
              'You can. A wall and chloroplasts are visible, and an animal cell has neither.',
          },
        ],
      },
    },
  ],
};

// --- ISC, class 11, mathematics -----------------------------------------------------------------------------

/** The core: the discriminant is where the parabola meets the axis. */
const natureOfRoots: Design = {
  id: 'designed-nature-of-roots',
  concept: 'The nature of the roots',
  kind: 'construct',
  mechanic:
    'Move the curve across the axis, then build the discriminant that predicts what you saw.',
  why: 'A root is a crossing. Seeing the crossings vanish before deriving b squared minus 4ac makes the sign mean something.',
  source: 'model',
  refreshDays: 90,
  marks: [
    { id: 'axis', shape: 'line', x: 6, y: 38, x2: 94, y2: 38, tone: 'muted' },
    { id: 'curve', shape: 'ring', x: 50, y: 44, r: 20, tone: 'hue' },
    { id: 'vertex', shape: 'circle', x: 50, y: 24, r: 2.5, tone: 'hue', fill: 'solid' },
  ],
  steps: [
    {
      id: 'move-c',
      beat: 'build',
      surprise:
        'The curve crosses twice, then touches once, then misses. Nothing about the curve broke; it only moved.',
      primitive: {
        kind: 'slide',
        prompt: 'Move c and watch where the curve meets the axis.',
        min: -4,
        max: 6,
        from: -4,
        at: 2.25,
        valueLabel: 'c = {v}',
        bind: { mark: 'curve', prop: 'y', at: [56, 24] },
        feedback: {
          right: 'Two crossings, then one, then none.',
          wrong:
            'The roots are the crossings. Going the other way only widens the gap you are trying to close.',
        },
      },
    },
    {
      id: 'cross',
      beat: 'check',
      surprise:
        'Those two points are the roots. Nothing else about the curve says how many there are.',
      primitive: {
        kind: 'mark',
        prompt: 'Mark the two places the curve meets the axis.',
        tool: 'point',
        need: 2,
        targets: [
          {
            id: 'left',
            x: 31,
            y: 38,
            r: 7,
            why: 'The smaller root: the first place the curve comes back up through the axis.',
          },
          {
            id: 'right',
            x: 69,
            y: 38,
            r: 7,
            why: 'The larger root: the second crossing, on the other side of the vertex.',
          },
        ],
        feedback: {
          right: 'Both crossings found.',
          wrong:
            'A root is where the curve MEETS the axis, not where it turns. The turning point is the vertex.',
        },
      },
    },
    {
      id: 'derive',
      beat: 'check',
      surprise:
        'Completing the square leaves b squared minus 4ac under the root, and only its sign decides how many real roots there are.',
      primitive: {
        kind: 'sequence',
        prompt: 'Build the discriminant from the general equation, one move at a time.',
        feedback: {
          right: 'Each line follows from the one above it.',
          wrong:
            'The square root is the last thing you take, so it is the last thing that can fail. Get there in order.',
        },
        steps: [
          {
            id: 'general',
            label: 'ax squared + bx + c = 0',
            box: line(0),
            check: 'Nothing has been assumed about a, b or c yet.',
            feedback: {
              right: 'Start from the general form.',
              wrong: 'Start from the equation before anything has been divided or moved.',
            },
          },
          {
            id: 'divide',
            label: 'Divide through by a',
            box: line(1),
            check: 'a is not zero, or this would not be a quadratic.',
            feedback: {
              right: 'The squared term is now bare.',
              wrong:
                'The square cannot be completed while the squared term still carries a coefficient.',
            },
          },
          {
            id: 'complete',
            label: 'Complete the square',
            box: line(2),
            check: 'The left side is now one bracket squared.',
            feedback: {
              right: 'One bracket squared, and a number beside it.',
              wrong: 'There is still an a in front of the squared term. Divide first.',
            },
          },
          {
            id: 'root',
            label: 'Take the square root of both sides',
            box: line(3),
            check: 'What is under the root is b squared minus 4ac, over 4a squared.',
            feedback: {
              right: 'And there it is, under the root.',
              wrong: 'The bracket has to be alone before the root can be taken.',
            },
          },
        ],
      },
    },
    {
      id: 'classify',
      beat: 'fun',
      surprise:
        'The discriminant is zero, so the two roots have collapsed onto each other. One root, counted twice.',
      primitive: {
        kind: 'branch',
        prompt: 'How many real roots does x squared + 4x + 4 = 0 have?',
        feedback: {
          right: 'Sixteen and sixteen, so the curve touches the axis and does not cross it.',
          wrong: 'Work out b squared and 4ac and compare them before choosing.',
        },
        options: [
          { id: 'one', label: 'One real root, repeated', box: line(0), correct: true, teaches: '' },
          {
            id: 'two',
            label: 'Two distinct real roots',
            box: line(1),
            correct: false,
            teaches: 'Two distinct roots need b squared above 4ac. Here 16 and 16 are equal.',
          },
          {
            id: 'none',
            label: 'No real roots',
            box: line(2),
            correct: false,
            teaches:
              'No real root needs b squared below 4ac. Equal means the curve touches the axis.',
          },
          {
            id: 'cannot',
            label: 'You cannot say without factorising',
            box: line(3),
            correct: false,
            teaches: 'The discriminant answers it without factorising. That is what it is for.',
          },
        ],
      },
    },
    {
      id: 'points',
      beat: 'fun',
      primitive: {
        kind: 'score',
        perRight: 10,
        perWrong: 0,
        show: 'number',
        feedback: { right: 'Ten.', wrong: 'Nothing lost.' },
      },
    },
  ],
};

/** The three, in the order the bench and the browser proof play them. */
export const DESIGNED: readonly Design[] = [equivalentFractions, plantCell, natureOfRoots];
