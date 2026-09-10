/**
 * The template floors (docs/CONTENT-INTERACTION.md §2 and §3).
 *
 * "Templates are the floor, not the ceiling." When the designer's composition is refused twice, the
 * concept's row of §2 supplies one of these instead, so quality never falls under the template and
 * the learner never sees a hole. They are written in EXACTLY the language a designed interaction is
 * written in, so a template and a designed interaction go through one gate and one renderer. There
 * is no second code path, which is the whole reason they are data.
 *
 * §2 has eight rows. Six of them are compositions and are here. The seventh, the challenge with a
 * score, is not a ninth play: it is the discrimination floor with a `timer` and a `score` on it, and
 * `CHALLENGE` below is literally that. The eighth, the film, is not an interaction at all; it is the
 * motion player (`engines/MotionPlayer.tsx`) and lives outside the composer.
 *
 * The content in each floor is real (the content-realness law): a floor that shipped with lorem
 * would be a hole with a template around it. `fillFloor` swaps a level rendering's own pieces into
 * the fixed composition, which is what "a template filled from the level rendering" means in §1.
 */

import type { Chip, Composition } from './spec';

/** The rows of §2 that a composition can serve. */
export type Row =
  | 'classification'
  | 'ordering'
  | 'correspondence'
  | 'variation'
  | 'construction'
  | 'discrimination';

export const ROWS: readonly Row[] = [
  'classification',
  'ordering',
  'correspondence',
  'variation',
  'construction',
  'discrimination',
];

const classification: Composition = {
  id: 'floor-classification',
  title: 'Three kinds of rock',
  source: 'floor',
  steps: [
    {
      id: 'sort-the-rocks',
      prompt: 'Put each rock with the way it was made.',
      reveal: 'How a rock was made, not what it looks like, is what names it.',
      play: {
        kind: 'bins',
        bins: [
          { id: 'igneous', label: 'Cooled from molten rock', accepts: ['granite', 'basalt'] },
          { id: 'sedimentary', label: 'Settled in layers', accepts: ['sandstone', 'limestone'] },
          { id: 'metamorphic', label: 'Changed by heat and pressure', accepts: ['marble', 'slate'] },
        ],
        items: [
          { id: 'granite', label: 'Granite', teach: 'Granite cooled slowly underground, so its crystals are large enough to see.' },
          { id: 'basalt', label: 'Basalt', teach: 'Basalt cooled fast at the surface, so its crystals are too small to see.' },
          { id: 'sandstone', label: 'Sandstone', teach: 'Sandstone is grains of sand pressed together over a long time.' },
          { id: 'limestone', label: 'Limestone', teach: 'Limestone is built from the shells and skeletons that settled on a sea floor.' },
          { id: 'marble', label: 'Marble', teach: 'Marble was limestone until heat and pressure recrystallised it.' },
          { id: 'slate', label: 'Slate', teach: 'Slate was mud that pressure squeezed into flat sheets.' },
        ],
      },
    },
  ],
};

const ordering: Composition = {
  id: 'floor-ordering',
  title: 'Water on its way round',
  source: 'floor',
  steps: [
    {
      id: 'order-the-cycle',
      prompt: 'Put the four stages in the order water passes through them.',
      reveal: 'Water changes state twice on the way round, and it never leaves the cycle.',
      teach: 'Follow one drop: it has to become vapour before it can become cloud, and cloud before it can fall.',
      play: {
        kind: 'sort',
        axis: { from: 'First', to: 'Last' },
        items: [
          { id: 'evaporation', label: 'Evaporation' },
          { id: 'condensation', label: 'Condensation' },
          { id: 'precipitation', label: 'Precipitation' },
          { id: 'collection', label: 'Collection' },
        ],
        order: ['evaporation', 'condensation', 'precipitation', 'collection'],
      },
    },
  ],
};

const correspondence: Composition = {
  id: 'floor-correspondence',
  title: 'The base quantities and their units',
  source: 'floor',
  steps: [
    {
      id: 'match-the-units',
      prompt: 'Join each quantity to the unit it is measured in.',
      reveal: 'Every other unit in physics is built out of these seven.',
      teach: 'A unit answers "how much of what". Read the quantity first, then look for the unit that could only measure that.',
      play: {
        kind: 'match',
        pairs: [
          { id: 'length', label: 'Length' },
          { id: 'mass', label: 'Mass' },
          { id: 'time', label: 'Time' },
          { id: 'current', label: 'Electric current' },
        ],
        rights: ['metre', 'kilogram', 'second', 'ampere'],
      },
    },
  ],
};

const variation: Composition = {
  id: 'floor-variation',
  title: 'The same amount, cut differently',
  source: 'floor',
  steps: [
    {
      id: 'stretch-the-bar',
      prompt: 'Cut the bar into more pieces and watch the shaded part.',
      reveal: 'Twice the pieces and twice the shaded pieces is the same amount of bar.',
      teach: 'Cutting a bar into more pieces does not give you more bar. Each piece just gets smaller.',
      play: {
        kind: 'slide',
        min: 2,
        max: 12,
        from: 2,
        at: 8,
        valueLabel: '{v} pieces',
        marks: [
          { id: 'bar', shape: 'rect', x: 12, y: 22, w: 76, h: 18, tone: 'muted', fill: 'soft' },
          { id: 'shaded', shape: 'rect', x: 12, y: 22, w: 38, h: 18, tone: 'hue', fill: 'solid' },
          { id: 'cut', shape: 'line', x: 50, y: 18, x2: 50, y2: 44, tone: 'ink' },
        ],
        bind: { mark: 'cut', prop: 'x', at: [50, 50] },
      },
    },
  ],
};

const construction: Composition = {
  id: 'floor-construction',
  title: 'Getting x on its own',
  source: 'floor',
  steps: [
    {
      id: 'build-the-solution',
      prompt: 'Build the solution of 2x + 3 = 11, one move at a time.',
      reveal: 'Every move keeps both sides equal, which is why the last line is still true.',
      teach: 'Whatever you do to one side you do to the other. Undo the adding before you undo the multiplying.',
      play: {
        kind: 'sequence',
        steps: [
          { id: 'start', label: '2x + 3 = 11' },
          { id: 'minus', label: 'Take 3 from both sides' },
          { id: 'mid', label: '2x = 8' },
          { id: 'divide', label: 'Divide both sides by 2' },
          { id: 'end', label: 'x = 4' },
        ],
      },
    },
  ],
};

const discrimination: Composition = {
  id: 'floor-discrimination',
  title: 'Which side is the hypotenuse',
  source: 'floor',
  steps: [
    {
      id: 'find-the-hypotenuse',
      prompt: 'In a right triangle, which side is the hypotenuse?',
      reveal: 'The hypotenuse is the side opposite the right angle, and it is always the longest.',
      play: {
        kind: 'select',
        options: [
          { id: 'opposite', label: 'The side opposite the right angle' },
          { id: 'bottom', label: 'The side along the bottom', teach: 'Turn the triangle and the bottom changes. The right angle does not.' },
          { id: 'slanted', label: 'Whichever side is slanted', teach: 'A slant depends on how the triangle is drawn on the page, not on the triangle.' },
          { id: 'longest-always', label: 'The longest side of any triangle', teach: 'Only a right triangle has a hypotenuse. In other triangles the longest side has no special name.' },
        ],
        answer: ['opposite'],
      },
    },
  ],
};

/** One floor per composable row of §2. */
export const FLOORS: Record<Row, Composition> = {
  classification,
  ordering,
  correspondence,
  variation,
  construction,
  discrimination,
};

/**
 * §2's seventh row. A challenge is the discrimination floor with a clock and a score on it, and
 * nothing else: the proof that the modifiers compose rather than each mechanic being its own code.
 */
export const CHALLENGE: Composition = {
  ...discrimination,
  id: 'floor-challenge',
  title: 'Name the side, against the clock',
  steps: discrimination.steps.map((s) => ({
    ...s,
    id: 'challenge',
    timer: { seconds: 60 },
    score: { per: 10, streak: 5 },
  })),
};

/** The floor for a row. An unknown row falls to discrimination, which every concept can carry. */
export function floorFor(row: string): Composition {
  return FLOORS[row as Row] ?? discrimination;
}

/** What a level rendering supplies when it fills a floor (docs/CONTENT-INTERACTION.md §1). */
export interface Filling {
  title?: string;
  prompt?: string;
  reveal?: string;
  teach?: string;
  /** Replaces the chips of the play, in order. A shorter list leaves the rest of the floor as it is. */
  pieces?: Chip[];
  /** For `match` only: the right-hand column, in the same order as `pieces`. */
  rights?: string[];
  /** For `sort` only: the ids of `pieces` in their correct order. */
  order?: string[];
  /** For `bins` only: which piece ids each bin takes, keyed by bin id. */
  accepts?: Record<string, string[]>;
  /** For `select` only: the ids of the right options. */
  answer?: string[];
}

/**
 * Fill a floor from a level rendering. The COMPOSITION is fixed; only the content moves. Anything
 * the filling does not name keeps the floor's own, so a partial filling degrades to the floor
 * rather than to a hole. The result still goes through `parseComposition` before it renders.
 */
export function fillFloor(row: string, filling: Filling): Composition {
  const base = floorFor(row);
  const step = base.steps[0];
  const play = step.play;
  const pieces = filling.pieces?.length ? filling.pieces : null;

  let filled = play;
  if (pieces) {
    if (play.kind === 'bins') {
      const ids = new Set(pieces.map((p) => p.id));
      const accepts = filling.accepts ?? {};
      const bins = play.bins.map((b) => ({
        ...b,
        accepts: (accepts[b.id] ?? b.accepts).filter((a) => ids.has(a)),
      }));
      filled = { ...play, items: pieces, bins };
    } else if (play.kind === 'sort') {
      filled = { ...play, items: pieces, order: filling.order ?? pieces.map((p) => p.id) };
    } else if (play.kind === 'match') {
      filled = { ...play, pairs: pieces, rights: filling.rights ?? play.rights };
    } else if (play.kind === 'sequence') {
      filled = { ...play, steps: pieces };
    } else if (play.kind === 'select') {
      filled = { ...play, options: pieces, answer: filling.answer ?? [pieces[0].id] };
    }
  }

  return {
    ...base,
    id: `${base.id}-filled`,
    title: filling.title?.trim() || base.title,
    steps: [
      {
        ...step,
        prompt: filling.prompt?.trim() || step.prompt,
        reveal: filling.reveal?.trim() || step.reveal,
        ...(filling.teach?.trim() || step.teach ? { teach: filling.teach?.trim() || step.teach } : {}),
        play: filled,
      },
    ],
  };
}
