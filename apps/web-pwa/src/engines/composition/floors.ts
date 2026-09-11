/**
 * The template floors (docs/CONTENT-INTERACTION.md §2 and §3).
 *
 * "Templates are the floor, not the ceiling." When the designer's composition is refused twice, the
 * concept's row of §2 supplies one of these instead, so quality never falls under the template and a
 * learner never meets a hole. They are written in EXACTLY the vocabulary a designed interaction is
 * written in — the generated `InteractionDesign` — so a floor and a design go through one door and
 * one renderer. There is no second code path, which is the whole reason they are data.
 *
 * §2 has eight rows and `InteractionDesign.kind` names all eight. Six of them are single acts and
 * are here. `drill` is the seventh and it is NOT a ninth primitive: it is the `discriminate` floor
 * with a `timer` and a `score` beat added, which is what a composition language is for. `watch` is
 * the eighth and it is not an interaction at all; it is the motion player (`engines/MotionPlayer`).
 *
 * The content in each floor is real (the content-realness law): a floor that shipped with lorem
 * would be a hole with a template round it. `fillFloor` swaps a level rendering's own pieces into
 * the fixed composition, which is what "a template filled from the level rendering" means in §1.
 */

import type { Feedback, HitBox } from '@wobo/contracts/plexus';
import type { Design } from './parse';
import { MIN_HIT_UNITS, STAGE_H, STAGE_W } from './parse';

/** A hit box on the stage, never under the finger's law and never off the edge. */
function box(x: number, y: number, w = 46, h = 14): HitBox {
  const width = Math.max(MIN_HIT_UNITS, Math.min(w, STAGE_W - x));
  const height = Math.max(MIN_HIT_UNITS, Math.min(h, STAGE_H - y));
  return { x, y, w: width, h: height };
}

/** Two columns of four rows: where a floor's pieces sit on the stage. */
const slot = (i: number): HitBox => box(i % 2 === 0 ? 2 : 52, 2 + Math.floor(i / 2) * 15);
/** One column of four rows, for the acts that read as a list. */
const row = (i: number): HitBox => box(2, 2 + i * 15, 96);

const fb = (right: string, wrong: string, hint?: string): Feedback => ({
  right,
  wrong,
  ...(hint ? { hint } : {}),
});

// --- classify: drop each token into the bin its rule admits -----------------------------------------

const classify: Design = {
  id: 'floor-classify',
  concept: 'The three kinds of rock',
  kind: 'classify',
  mechanic: 'Put each rock with the way it was made.',
  why: 'A rock is named by the process that made it, not by how it looks, so sorting by process is the idea itself.',
  source: 'floor',
  refreshDays: 90,
  marks: [],
  steps: [
    {
      id: 'sort-the-rocks',
      beat: 'check',
      surprise: 'How a rock was made, not what it looks like, is what names it.',
      primitive: {
        kind: 'drop',
        prompt: 'Put each rock with the way it was made.',
        feedback: fb(
          'That is the process that made it.',
          'Look past the colour. Ask what happened to the material, not what it looks like now.',
        ),
        tokens: [
          {
            id: 'granite',
            label: 'Granite',
            box: slot(0),
            belongs: 'igneous',
            why: 'Granite cooled slowly underground, so its crystals are large enough to see.',
          },
          {
            id: 'basalt',
            label: 'Basalt',
            box: slot(1),
            belongs: 'igneous',
            why: 'Basalt cooled fast at the surface, so its crystals are too small to see.',
          },
          {
            id: 'sandstone',
            label: 'Sandstone',
            box: slot(2),
            belongs: 'sedimentary',
            why: 'Sandstone is grains of sand pressed together over a long time.',
          },
          {
            id: 'limestone',
            label: 'Limestone',
            box: slot(3),
            belongs: 'sedimentary',
            why: 'Limestone is built from shells and skeletons that settled on a sea floor.',
          },
          {
            id: 'marble',
            label: 'Marble',
            box: slot(4),
            belongs: 'metamorphic',
            why: 'Marble was limestone until heat and pressure recrystallised it.',
          },
          {
            id: 'slate',
            label: 'Slate',
            box: slot(5),
            belongs: 'metamorphic',
            why: 'Slate was mud that pressure squeezed into flat sheets.',
          },
        ],
        zones: [
          {
            id: 'igneous',
            label: 'Cooled from molten rock',
            box: box(2, 47, 30, 14),
            accepts: ['granite', 'basalt'],
            feedback: fb(
              'Both of these were once molten.',
              'This one never melted. Melting and cooling is what puts a rock in here.',
            ),
          },
          {
            id: 'sedimentary',
            label: 'Settled in layers',
            box: box(35, 47, 30, 14),
            accepts: ['sandstone', 'limestone'],
            feedback: fb(
              'Both of these settled and were pressed.',
              'Nothing settled to make this one. Layers of loose material are what puts a rock in here.',
            ),
          },
          {
            id: 'metamorphic',
            label: 'Changed by heat and pressure',
            box: box(68, 47, 30, 14),
            accepts: ['marble', 'slate'],
            feedback: fb(
              'Both of these were another rock first.',
              'This one was made this way. A rock in here started as a different rock.',
            ),
          },
        ],
      },
    },
  ],
};

// --- order: put the set into its order --------------------------------------------------------------

const order: Design = {
  id: 'floor-order',
  concept: 'Water on its way round',
  kind: 'order',
  mechanic: 'Put the four stages in the order water passes through them.',
  why: 'The cycle is only a cycle if the stages hold their order, so the order is what has to be understood.',
  source: 'floor',
  refreshDays: 90,
  marks: [],
  steps: [
    {
      id: 'order-the-cycle',
      beat: 'check',
      surprise: 'Water changes state twice on the way round, and it never leaves the cycle.',
      primitive: {
        kind: 'sort',
        prompt: 'Put the four stages in the order water passes through them.',
        axis: 'vertical',
        feedback: fb(
          'That is the road one drop takes.',
          'Follow one drop. It has to become vapour before it can become cloud, and cloud before it can fall.',
        ),
        items: [
          {
            id: 'evaporation',
            label: 'Evaporation',
            box: row(0),
            rank: 1,
            why: 'Heat lifts water off the sea as vapour before anything else can happen.',
          },
          {
            id: 'condensation',
            label: 'Condensation',
            box: row(1),
            rank: 2,
            why: 'Vapour has to cool into droplets before there is a cloud at all.',
          },
          {
            id: 'precipitation',
            label: 'Precipitation',
            box: row(2),
            rank: 3,
            why: 'Only once droplets are heavy enough does water fall.',
          },
          {
            id: 'collection',
            label: 'Collection',
            box: row(3),
            rank: 4,
            why: 'What falls gathers, and that gathered water is what evaporates next.',
          },
        ],
      },
    },
  ],
};

// --- match: join each left to its right --------------------------------------------------------------

const match: Design = {
  id: 'floor-match',
  concept: 'The base quantities and their units',
  kind: 'match',
  mechanic: 'Join each quantity to the unit it is measured in.',
  why: 'A unit is meaningless apart from the quantity it measures, so the pairing is the idea.',
  source: 'floor',
  refreshDays: 90,
  marks: [],
  steps: [
    {
      id: 'match-the-units',
      beat: 'check',
      surprise: 'Every other unit in physics is built out of these seven.',
      primitive: {
        kind: 'match',
        prompt: 'Join each quantity to the unit it is measured in.',
        card: box(2, 2, 44, 14),
        feedback: fb(
          'That unit could only measure that quantity.',
          'Read the quantity first, then look for the unit that could measure nothing else.',
        ),
        pairs: [
          {
            id: 'length',
            left: 'Length',
            right: 'metre',
            why: 'A metre is a distance, and distance is what length is.',
          },
          {
            id: 'mass',
            left: 'Mass',
            right: 'kilogram',
            why: 'A kilogram measures how much matter is there, not how heavy it feels.',
          },
          {
            id: 'time',
            left: 'Time',
            right: 'second',
            why: 'A second is a duration, and nothing else in this list is.',
          },
          {
            id: 'current',
            left: 'Electric current',
            right: 'ampere',
            why: 'An ampere is charge passing per second, which is what a current is.',
          },
        ],
      },
    },
  ],
};

// --- vary: move the value and watch the picture --------------------------------------------------------

const vary: Design = {
  id: 'floor-vary',
  concept: 'The same amount, cut differently',
  kind: 'vary',
  mechanic: 'Cut the bar into more pieces and watch the shaded part.',
  why: 'The misconception is that more pieces means more, and the only thing that undoes it is watching the amount refuse to change.',
  source: 'floor',
  refreshDays: 90,
  marks: [
    { id: 'bar', shape: 'rect', x: 10, y: 20, w: 80, h: 20, tone: 'muted', fill: 'soft' },
    { id: 'shaded', shape: 'rect', x: 10, y: 20, w: 40, h: 20, tone: 'hue', fill: 'solid' },
    { id: 'cut', shape: 'line', x: 50, y: 16, x2: 50, y2: 44, tone: 'ink' },
  ],
  steps: [
    {
      id: 'stretch-the-bar',
      beat: 'build',
      surprise: 'The shaded part never grew. Only the number of cuts changed.',
      primitive: {
        kind: 'slide',
        prompt: 'Cut the bar into more pieces and watch the shaded part.',
        min: 2,
        max: 12,
        from: 2,
        at: 8,
        valueLabel: '{v} pieces',
        bind: { mark: 'cut', prop: 'x', at: [50, 50] },
        feedback: fb(
          'Twice the pieces and twice the shaded pieces is the same amount of bar.',
          'Cutting a bar into more pieces does not give you more bar. Each piece just gets smaller.',
        ),
      },
    },
  ],
};

// --- construct: build it step by step, checked at each step -----------------------------------------------

const construct: Design = {
  id: 'floor-construct',
  concept: 'Getting x on its own',
  kind: 'construct',
  mechanic: 'Build the solution one move at a time, with a check at each move.',
  why: 'The idea is that every move keeps both sides equal, and only building it move by move shows that.',
  source: 'floor',
  refreshDays: 90,
  marks: [],
  steps: [
    {
      id: 'build-the-solution',
      beat: 'build',
      surprise: 'Every move kept both sides equal, which is why the last line is still true.',
      primitive: {
        kind: 'sequence',
        prompt: 'Build the solution of 2x + 3 = 11, one move at a time.',
        feedback: fb(
          'Both sides are still equal.',
          'Whatever you do to one side you do to the other. Undo the adding before you undo the multiplying.',
        ),
        steps: [
          {
            id: 'start',
            label: '2x + 3 = 11',
            box: row(0),
            check: 'Both sides are equal, and x is still buried.',
            feedback: fb(
              'Start from what you were given.',
              'Start from the equation as it was written, before anything was moved.',
            ),
          },
          {
            id: 'minus',
            label: 'Take 3 from both sides',
            box: row(1),
            check: 'The same amount left both sides, so they are still equal.',
            feedback: fb(
              'The +3 is the thing standing between you and 2x.',
              'The 3 is added, so it comes off first. Dividing while it is still there splits it too.',
            ),
          },
          {
            id: 'mid',
            label: '2x = 8',
            box: row(2),
            check: 'x is multiplied by 2 and nothing else.',
            feedback: fb(
              'This is what is left.',
              'This line only exists after the 3 has gone from both sides.',
            ),
          },
          {
            id: 'divide',
            label: 'Divide both sides by 2',
            box: row(3),
            check: 'Both sides were halved, so they are still equal.',
            feedback: fb(
              'Dividing undoes the multiplying.',
              'Dividing is what undoes a multiply, and it has to happen to both sides at once.',
            ),
          },
        ],
      },
    },
  ],
};

// --- discriminate: tell the near things apart ---------------------------------------------------------------

const discriminate: Design = {
  id: 'floor-discriminate',
  concept: 'Which side is the hypotenuse',
  kind: 'discriminate',
  mechanic: 'Choose the one description that holds however the triangle is turned.',
  why: 'Every wrong answer here is a real misconception about what the name is attached to.',
  source: 'floor',
  refreshDays: 90,
  marks: [],
  steps: [
    {
      id: 'find-the-hypotenuse',
      beat: 'check',
      surprise:
        'The hypotenuse is the side opposite the right angle, and that is why it is always the longest.',
      primitive: {
        kind: 'branch',
        prompt: 'In a right triangle, which side is the hypotenuse?',
        feedback: fb(
          'It is named by the angle it faces, not by where it sits on the page.',
          'Turn the triangle in your head. The answer must survive the turn.',
        ),
        options: [
          {
            id: 'opposite',
            label: 'The side opposite the right angle',
            box: row(0),
            correct: true,
            teaches: '',
          },
          {
            id: 'bottom',
            label: 'The side along the bottom',
            box: row(1),
            correct: false,
            teaches: 'Turn the triangle and the bottom changes. The right angle does not.',
          },
          {
            id: 'slanted',
            label: 'Whichever side is slanted',
            box: row(2),
            correct: false,
            teaches:
              'A slant depends on how the triangle was drawn on the page, not on the triangle.',
          },
          {
            id: 'any-longest',
            label: 'The longest side of any triangle',
            box: row(3),
            correct: false,
            teaches:
              'Only a right triangle has a hypotenuse. In other triangles the longest side has no special name.',
          },
        ],
      },
    },
  ],
};

// --- drill: the challenge. The discriminate floor, with a clock and a score on it. ---------------------------

const drill: Design = {
  ...discriminate,
  id: 'floor-drill',
  kind: 'drill',
  mechanic: 'Name the side, against the clock.',
  why: 'Where the skill is speed of recall rather than reasoning, the clock is the mechanic.',
  steps: [
    ...discriminate.steps,
    {
      id: 'the-clock',
      beat: 'fun',
      primitive: {
        kind: 'timer',
        seconds: 60,
        onExpire: 'reveal',
        visible: true,
        feedback: fb(
          'Time is up, and the answer stands.',
          'The clock ran out. Nothing is taken away for that.',
        ),
      },
    },
    {
      id: 'the-score',
      beat: 'fun',
      primitive: {
        kind: 'score',
        perRight: 10,
        perWrong: 0,
        show: 'number',
        feedback: fb('Ten for that one.', 'Nothing lost. A wrong answer costs no points here.'),
      },
    },
  ],
};

/** One floor per row of §2 that is a composition. `watch` is the film and lives outside the composer. */
export const FLOORS = { classify, order, match, vary, construct, discriminate, drill } as const;

export type FloorRow = keyof typeof FLOORS;

/** The rows in the order §2's table gives them. */
export const ROWS: readonly FloorRow[] = [
  'classify',
  'order',
  'match',
  'vary',
  'construct',
  'discriminate',
  'drill',
];

/** The floor for a row. An unknown row falls to `discriminate`, which every concept can carry. */
export function floorFor(row: string): Design {
  return (FLOORS as Record<string, Design>)[row] ?? discriminate;
}

/** What a level rendering supplies when it fills a floor (docs/CONTENT-INTERACTION.md §1). */
export interface Filling {
  concept?: string;
  prompt?: string;
  surprise?: string;
  /** Replaces the pieces of the act, in order. A short list leaves the rest of the floor as it is. */
  pieces?: {
    id: string;
    label: string;
    why?: string;
    right?: string;
    belongs?: string;
    correct?: boolean;
    teaches?: string;
  }[];
}

/**
 * Fill a floor from a level rendering. The COMPOSITION is fixed; only the content moves. Anything the
 * filling does not name keeps the floor's own, so a partial filling degrades to the floor rather than
 * to a hole. The result still goes through `parseDesign` before it renders.
 */
export function fillFloor(row: string, filling: Filling): Design {
  const base = floorFor(row);
  const first = base.steps[0];
  if (!first) return base;
  const pieces = filling.pieces?.length ? filling.pieces : null;
  const p = first.primitive;
  let filled = p;

  if (pieces) {
    if (p.kind === 'drop') {
      const known = new Set(p.zones.map((z) => z.id));
      const tokens = pieces.map((piece, i) => {
        const was = p.tokens[i % p.tokens.length];
        const belongs = piece.belongs && known.has(piece.belongs) ? piece.belongs : was?.belongs;
        return {
          id: piece.id,
          label: piece.label,
          box: was?.box ?? slot(i),
          belongs: belongs ?? (p.zones[0]?.id as string),
          why: piece.why ?? was?.why ?? '',
        };
      });
      const live = new Set(tokens.map((t) => t.id));
      filled = {
        ...p,
        tokens,
        zones: p.zones
          .map((z) => ({
            ...z,
            accepts: tokens.filter((t) => t.belongs === z.id).map((t) => t.id),
          }))
          .filter((z) => z.accepts.length > 0 || live.size === 0),
      };
    } else if (p.kind === 'sort') {
      filled = {
        ...p,
        items: pieces.map((piece, i) => ({
          id: piece.id,
          label: piece.label,
          box: p.items[i]?.box ?? row_(i),
          rank: i + 1,
          why: piece.why ?? p.items[i]?.why ?? '',
        })),
      };
    } else if (p.kind === 'match') {
      filled = {
        ...p,
        pairs: pieces.map((piece, i) => ({
          id: piece.id,
          left: piece.label,
          right: piece.right ?? p.pairs[i]?.right ?? piece.label,
          why: piece.why ?? p.pairs[i]?.why ?? '',
        })),
      };
    } else if (p.kind === 'sequence') {
      filled = {
        ...p,
        steps: pieces.map((piece, i) => {
          const was = p.steps[i % p.steps.length];
          return {
            id: piece.id,
            label: piece.label,
            box: was?.box ?? row_(i),
            check: piece.why ?? was?.check ?? '',
            feedback:
              was?.feedback ??
              fb('Both sides still hold.', 'That move does not follow from the last one.'),
          };
        }),
      };
    } else if (p.kind === 'branch') {
      filled = {
        ...p,
        options: pieces.map((piece, i) => ({
          id: piece.id,
          label: piece.label,
          box: p.options[i]?.box ?? row_(i),
          correct: piece.correct ?? i === 0,
          teaches: piece.teaches ?? piece.why ?? '',
        })),
      };
    }
  }

  return {
    ...base,
    id: `${base.id}-filled`,
    concept: filling.concept?.trim() || base.concept,
    mechanic: filling.prompt?.trim() || base.mechanic,
    steps: [
      {
        ...first,
        ...(filling.surprise?.trim() ? { surprise: filling.surprise.trim() } : {}),
        primitive:
          'prompt' in filled && filling.prompt?.trim()
            ? { ...filled, prompt: filling.prompt.trim() }
            : filled,
      },
      ...base.steps.slice(1),
    ],
  };
}

/** `row` is taken by the parameter name above; the layout helper keeps its own name here. */
const row_ = row;
