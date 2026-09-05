/**
 * The golden boards — twelve turns Wobo can be held to (docs/BOARD.md; WOBO-PLAN §2).
 *
 * Run me:  bun run apps/web-pwa/src/wobo/goldens/build.ts
 *
 * Everything a golden board shows is computed HERE, in code, from the physics or the arithmetic —
 * never typed in as a literal Wobo then "explains". The output is twelve JSON plans plus a manifest,
 * read by the bench (the hand) and by `services/gateway/tests/test_board_golden.py` (the brain),
 * which recomputes every one of these numbers independently before it lets the fixture pass.
 *
 * Three rules the generator itself enforces, so a badly built board never becomes a golden:
 *  1. every object carries one of the four anchor forms, and shape points are non-negative offsets
 *     inside the 1000-unit square (the brain's mirror rejects anything else);
 *  2. every object showing a numeral names the verifier that signed it;
 *  3. the plan parses through the shipping grammar (`parseBoardPlan`) with nothing dropped.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type BoardEvent,
  type BoardObject,
  type BoardObjectKind,
  type BoardPoint,
  type Presentation,
  parseBoardPlan,
} from '@wobo/wobo';
import type { AnchorForm, GoldenBoard, GoldenExpectation, GoldenNumber } from './types';

// --- the little language a board is written in ----------------------------------------------------

const CHECK = {
  readable: (what: string) => `board.readable:${what}`,
  agree: (what: string) => `board.numbers_agree:${what}`,
  bounds: (what: string) => `board.in_bounds:${what}`,
  units: (what: string) => `board.units_agree:${what}`,
  balances: (what: string) => `board.equation_balances:${what}`,
  fact: (what: string) => `board.fact_supported:${what}`,
} as const;

type Ink = 'wobo' | 'accent' | 'learner' | 'faint';

interface Draft {
  say(text: string, t: number): void;
  ink(object: Record<string, unknown>, t: number, dur?: number): void;
  done(t: number): void;
}

/** One board under construction. It records the plan and derives the expectation from it. */
class Board implements Draft {
  readonly events: BoardEvent[] = [];
  readonly ids: string[] = [];
  readonly kinds: BoardObjectKind[] = [];
  readonly anchors: AnchorForm[] = [];
  readonly hangsOff: [string, string][] = [];
  readonly written: string[] = [];
  readonly numbers: GoldenNumber[] = [];
  private readonly seen = new Set<string>();

  say(text: string, t: number): void {
    this.events.push({ type: 'say', text, t });
  }

  ink(object: Record<string, unknown>, t: number, dur?: number): void {
    const id = String(object.id);
    if (this.seen.has(id)) throw new Error(`duplicate object id ${id}`);
    this.seen.add(id);
    const timed = { ...object, t: { start: t, ...(dur === undefined ? {} : { dur }) } };
    this.events.push({ type: 'ink', object: timed, t } as BoardEvent);

    const kind = String(object.kind) as BoardObjectKind;
    const anchor = object.anchor as Record<string, unknown> | undefined;
    const form = anchorForm(anchor);
    this.ids.push(id);
    this.kinds.push(kind);
    this.anchors.push(form);
    if (form === 'object') this.hangsOff.push([id, String(anchor?.object)]);

    // What the hand will put in the DOM as this object's accessible name.
    if (kind === 'write' || kind === 'label') this.written.push(String(object.text));
    if (kind === 'number') {
      const value = object.value as number;
      const precision = object.precision as number | undefined;
      const unit = object.unit as string | undefined;
      const label = object.label as string | undefined;
      const shown = precision === undefined ? String(value) : value.toFixed(precision);
      this.written.push(`${label ? `${label} ` : ''}${shown}${unit ? ` ${unit}` : ''}`);
      this.numbers.push({
        id,
        value,
        ...(precision === undefined ? {} : { precision }),
        ...(unit === undefined ? {} : { unit }),
        check: String(object.check),
        from: String(object.meta ?? ''),
      });
    }
  }

  done(t: number): void {
    this.events.push({ type: 'done', t });
  }

  expectation(): GoldenExpectation {
    return {
      ids: this.ids,
      kinds: this.kinds,
      anchors: this.anchors,
      hangsOff: this.hangsOff,
      written: this.written,
      numbers: this.numbers,
    };
  }
}

function anchorForm(anchor: Record<string, unknown> | undefined): AnchorForm {
  if (!anchor) throw new Error('nothing is placed by pixels: every object needs an anchor');
  for (const form of ['board', 'object', 'target', 'focus'] as const) {
    if (form in anchor) return form;
  }
  throw new Error(`unrecognised anchor ${JSON.stringify(anchor)}`);
}

const at = (x: number, y: number): { board: BoardPoint } => ({ board: [round(x), round(y)] });
const on = (object: string): { object: string } => ({ object });
/** Hang off a named PART of an object — the top-right of a boundary, not the middle of it. */
const onEdge = (object: string, where: string) => ({ object, at: where });
const style = (ink: Ink, weight = 1) => ({ ink, weight });

/** Board coordinates carry six decimals — enough for exact geometry, short enough to read. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
const pt = (x: number, y: number): BoardPoint => [round(x), round(y)];

/** Offsets from an anchor, rebased so the smallest is [0, 0] — the brain's mirror wants them
 *  inside the board square, and a shape that starts at its own top-left is what a hand draws. */
function shape(points: readonly (readonly [number, number])[]): {
  anchor: { board: BoardPoint };
  points: BoardPoint[];
} {
  const minX = Math.min(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  return {
    anchor: at(minX, minY),
    points: points.map(([x, y]) => pt(x - minX, y - minY)),
  };
}

// --- 1. math: why a² + b² = c² --------------------------------------------------------------------

function pythagoras(): GoldenBoard {
  const b = new Board();
  // A 3-4-5, forty board units to the side. The arithmetic is done here and only then drawn.
  const unit = 30;
  const legA = 4;
  const legB = 3;
  const aSq = legA * legA;
  const bSq = legB * legB;
  const cSq = aSq + bSq;
  const c = Math.sqrt(cSq);
  const [ax, ay] = [legA * unit, legB * unit];
  const apex: [number, number] = [260, 300];
  const right: [number, number] = [apex[0], apex[1] + ay];
  const foot: [number, number] = [apex[0] + ax, apex[1] + ay];
  // The outward normal of the hypotenuse, so the big square is built away from the triangle.
  const len = Math.hypot(ax, ay);
  const nx = ay / len;
  const ny = -ax / len;
  const hyp = c * unit;

  b.say('Here it is. A right triangle, and a square on every side.', 0);
  b.ink(
    { id: 'triangle', kind: 'polygon', ...shape([apex, right, foot]), style: style('wobo', 2) },
    0,
    1100,
  );
  b.say('Call the legs a and b, and the long side c.', 1200);
  b.ink(
    { id: 'leg-a', kind: 'label', anchor: at((right[0] + foot[0]) / 2, right[1] + 26), text: 'a' },
    1300,
    400,
  );
  b.ink(
    { id: 'leg-b', kind: 'label', anchor: at(apex[0] - 26, (apex[1] + right[1]) / 2), text: 'b' },
    1600,
    400,
  );
  b.ink(
    {
      id: 'leg-c',
      kind: 'label',
      anchor: at((apex[0] + foot[0]) / 2 + 16, (apex[1] + foot[1]) / 2 - 24),
      text: 'c',
    },
    1900,
    400,
  );
  b.say('Now a square on each one.', 2400);
  b.ink(
    {
      id: 'square-a',
      kind: 'polygon',
      title: 'the square on side a, the shorter leg',
      ...shape([right, foot, [foot[0], foot[1] + ax], [right[0], right[1] + ax]]),
      style: style('faint', 1),
    },
    2500,
    900,
  );
  b.ink(
    {
      id: 'square-b',
      kind: 'polygon',
      title: 'the square on side b, the upright leg',
      ...shape([apex, right, [right[0] - ay, right[1]], [apex[0] - ay, apex[1]]]),
      style: style('faint', 1),
    },
    3400,
    800,
  );
  b.ink(
    {
      id: 'square-c',
      kind: 'polygon',
      title: 'the tilted square on the hypotenuse, the one the other two fill',
      ...shape([
        apex,
        foot,
        [foot[0] + nx * hyp, foot[1] + ny * hyp],
        [apex[0] + nx * hyp, apex[1] + ny * hyp],
      ]),
      style: style('accent', 2),
    },
    4200,
    1300,
  );
  b.say('The two small squares fill the big one exactly.', 5600);
  b.ink(
    {
      id: 'law',
      kind: 'tex',
      anchor: at(660, 120),
      tex: 'a^2 + b^2 = c^2',
      size: 40,
      check: CHECK.readable('pythagoras'),
    },
    5700,
    1500,
  );
  b.ink(
    {
      id: 'a-squared',
      kind: 'number',
      anchor: at(660, 210),
      value: aSq,
      label: 'a² =',
      verified: true,
      check: CHECK.agree('a squared'),
      meta: '4 * 4',
    },
    7200,
    500,
  );
  b.ink(
    {
      id: 'b-squared',
      kind: 'number',
      anchor: at(660, 265),
      value: bSq,
      label: 'b² =',
      verified: true,
      check: CHECK.agree('b squared'),
      meta: '3 * 3',
    },
    7700,
    500,
  );
  b.ink(
    {
      id: 'c-squared',
      kind: 'number',
      anchor: at(660, 320),
      value: cSq,
      label: 'c² =',
      verified: true,
      check: CHECK.agree('a squared plus b squared'),
      meta: '4*4 + 3*3',
    },
    8200,
    600,
  );
  b.ink(
    { id: 'sum-underline', kind: 'underline', anchor: on('c-squared'), style: style('accent', 2) },
    8800,
    400,
  );
  b.say('Sixteen and nine make twenty-five, so c is five.', 9000);
  b.ink(
    {
      id: 'answer',
      kind: 'write',
      anchor: at(660, 390),
      text: 'so c = 5',
      size: 34,
      style: style('accent', 2),
      check: CHECK.agree('hypotenuse'),
    },
    9300,
    1200,
  );
  b.ink(
    {
      id: 'answer-circle',
      kind: 'circle',
      anchor: on('answer'),
      pad: 12,
      style: style('accent', 2),
    },
    10500,
    800,
  );
  b.done(11400);

  return {
    name: 'pythagoras',
    prompt: 'why does a squared plus b squared equal c squared',
    title: 'a² + b² = c²',
    presentation: 'full',
    subject: 'math',
    expect: b.expectation(),
    plan: b.events,
  };
}

// --- 2. math: the tangent to y = x² ---------------------------------------------------------------

function tangent(): GoldenBoard {
  const b = new Board();
  const f = (x: number) => x * x;
  const fPrime = (x: number) => 2 * x;
  const a = 1.5;
  const slope = fPrime(a); // 3
  const height = f(a); // 2.25
  const intercept = height - slope * a; // -2.25

  // Board mapping: origin at (500, 520), 70 units per x, 45 units per y.
  const ox = 500;
  const oy = 520;
  const sx = 70;
  const sy = 45;
  const bx = (x: number) => ox + x * sx;
  const by = (y: number) => oy - y * sy;

  const samples: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const x = -3 + (6 * i) / 24;
    samples.push([bx(x), by(f(x))]);
  }
  const tangentFrom = 0.4;
  const tangentTo = 2.6;

  b.say('This is y equals x squared.', 0);
  b.ink(
    {
      id: 'axis-x',
      kind: 'axis',
      anchor: at(bx(-3), oy),
      orientation: 'x',
      min: -3,
      max: 3,
      step: 1,
      length: 6 * sx,
      label: 'x',
      ticks: true,
      style: style('faint', 1),
    },
    0,
    700,
  );
  b.ink(
    {
      id: 'axis-y',
      kind: 'axis',
      anchor: at(ox, oy),
      orientation: 'y',
      min: 0,
      max: 9,
      step: 1,
      length: 9 * sy,
      label: 'y',
      ticks: true,
      style: style('faint', 1),
    },
    250,
    700,
  );
  b.ink({ id: 'parabola', kind: 'curve', ...shape(samples), style: style('wobo', 2) }, 900, 1400);
  b.say('At x equals one and a half the curve is climbing. How fast?', 2400);
  b.ink(
    {
      id: 'touch-point',
      kind: 'point',
      anchor: at(bx(a), by(height)),
      style: style('accent', 3),
      depends: ['a'],
    },
    2600,
    300,
  );
  b.ink(
    {
      id: 'derivative-rule',
      kind: 'write',
      anchor: at(790, 120),
      text: "y' = 2x",
      size: 30,
      check: CHECK.readable('derivative of x squared'),
    },
    2900,
    900,
  );
  b.say('The derivative is two x, so here the slope is three.', 3900);
  b.ink(
    {
      id: 'slope-value',
      kind: 'number',
      anchor: at(790, 180),
      value: slope,
      label: 'slope =',
      verified: true,
      check: CHECK.agree('tangent slope'),
      meta: 'd/dx(x**2) at x = 1.5',
      depends: ['a'],
    },
    4100,
    500,
  );
  b.ink(
    {
      id: 'point-value',
      kind: 'number',
      anchor: at(790, 240),
      value: height,
      precision: 2,
      label: 'y =',
      verified: true,
      check: CHECK.agree('point on the curve'),
      meta: '1.5**2',
      depends: ['a'],
    },
    4600,
    500,
  );
  b.ink(
    {
      id: 'tangent-line',
      kind: 'polyline',
      ...shape([
        [bx(tangentFrom), by(slope * tangentFrom + intercept)],
        [bx(tangentTo), by(slope * tangentTo + intercept)],
      ]),
      style: style('accent', 2),
      depends: ['a'],
    },
    5100,
    900,
  );
  b.ink(
    {
      id: 'tangent-label',
      kind: 'label',
      anchor: on('tangent-line'),
      text: 'the tangent',
      style: style('accent', 1),
      depends: ['a'],
    },
    6000,
    600,
  );
  b.ink(
    {
      id: 'point-arrow',
      kind: 'arrow',
      anchor: on('touch-point'),
      from: at(790, 300),
      style: style('accent', 2),
      depends: ['a'],
    },
    6600,
    700,
  );
  // The board that answers back (docs/BOARD.md §2, §8). Everything above carries `depends: ['a']`,
  // so dragging this handle is a question to the brain — move the point of contact and the tangent,
  // the slope and the height on the curve are all recomputed and redrawn. It is drawn last because
  // a control is only offered once the thing it controls is on the board to be moved.
  b.say('Drag the handle and watch the slope change.', 7300);
  b.ink(
    {
      id: 'x-handle',
      kind: 'slider',
      anchor: at(bx(-3), 590),
      variable: 'a',
      min: tangentFrom,
      max: tangentTo,
      value: a,
      step: 0.1,
      w: 6 * sx,
      label: 'x',
      style: style('accent', 2),
    },
    7400,
    600,
  );
  b.done(8100);

  return {
    name: 'tangent-parabola',
    prompt: 'draw y = x squared and the tangent at x = 1.5',
    title: 'the tangent to y = x²',
    presentation: 'full',
    subject: 'math',
    expect: b.expectation(),
    plan: b.events,
  };
}

// --- 3. math: long division -----------------------------------------------------------------------

function longDivision(): GoldenBoard {
  const b = new Board();
  const dividend = 4823;
  const divisor = 7;
  const quotient = Math.floor(dividend / divisor); // 689
  const remainder = dividend % divisor; // 0

  // The steps, walked exactly as a hand walks them: take a digit, divide, multiply, subtract.
  const digits = String(dividend).split('').map(Number);
  const steps: { carried: number; digit: number; product: number; left: number }[] = [];
  let carried = 0;
  for (const d of digits) {
    const value = carried * 10 + d;
    const q = Math.floor(value / divisor);
    const product = q * divisor;
    const left = value - product;
    steps.push({ carried: value, digit: q, product, left });
    carried = left;
  }
  // The leading zero of 4 ÷ 7 is not written; a hand starts at the first digit that divides.
  const shown = steps.filter((s, i) => s.digit > 0 || i > 0);

  const left = 260;
  let y = 200;
  const line = () => {
    const at_ = y;
    y += 52;
    return at_;
  };

  b.say('Four thousand eight hundred and twenty-three, shared by seven.', 0);
  b.ink(
    {
      id: 'bracket-line',
      kind: 'write',
      anchor: at(left, 130),
      text: '7 ) 4823',
      size: 36,
      check: CHECK.agree('the division'),
    },
    0,
    1200,
  );
  b.ink(
    {
      id: 'vinculum',
      kind: 'polyline',
      ...shape([
        [left + 44, 118],
        [left + 190, 118],
      ]),
      style: style('faint', 1),
    },
    1200,
    300,
  );
  b.ink(
    {
      id: 'quotient',
      kind: 'number',
      anchor: at(left + 52, 76),
      value: quotient,
      verified: true,
      check: CHECK.agree('quotient'),
      meta: 'floor(4823 / 7)',
    },
    1500,
    800,
  );

  let t = 2400;
  shown.forEach((s, i) => {
    const step = i + 1;
    b.say(`${s.carried} divided by seven is ${s.digit}.`, t);
    b.ink(
      {
        id: `step-${step}-take`,
        kind: 'write',
        anchor: at(left, line()),
        text: `${s.carried} ÷ 7 = ${s.digit}`,
        size: 28,
        check: CHECK.agree(`step ${step} quotient digit`),
      },
      t + 100,
      700,
    );
    b.ink(
      {
        id: `step-${step}-take-product`,
        kind: 'write',
        anchor: at(left + 250, y - 52),
        text: `${s.digit} × 7 = ${s.product}`,
        size: 28,
        style: style('faint', 1),
        check: CHECK.agree(`step ${step} product`),
      },
      t + 800,
      700,
    );
    b.ink(
      {
        id: `step-${step}-left`,
        kind: 'write',
        anchor: at(left + 480, y - 52),
        text: `${s.carried} − ${s.product} = ${s.left}`,
        size: 28,
        style: style('faint', 1),
        check: CHECK.agree(`step ${step} remainder`),
      },
      t + 1500,
      700,
    );
    t += 2300;
  });

  b.say('Nothing is left over, so seven goes in exactly.', t);
  b.ink(
    {
      id: 'remainder',
      kind: 'number',
      anchor: at(left, line()),
      value: remainder,
      label: 'remainder',
      verified: true,
      check: CHECK.agree('remainder'),
      meta: '4823 mod 7',
    },
    t + 100,
    600,
  );
  b.ink(
    {
      id: 'quotient-circle',
      kind: 'circle',
      anchor: on('quotient'),
      pad: 10,
      style: style('accent', 2),
    },
    t + 800,
    800,
  );
  b.done(t + 1700);

  return {
    name: 'long-division',
    prompt: 'show me 4823 divided by 7 the long way',
    title: '4823 ÷ 7',
    presentation: 'full',
    subject: 'math',
    expect: b.expectation(),
    plan: b.events,
  };
}

// --- 4. physics: the projectile at the apex --------------------------------------------------------

const G = 9.81;

function projectile(): GoldenBoard {
  const b = new Board();
  const v0 = 20;
  const deg = 45;
  const rad = (deg * Math.PI) / 180;
  const vx = v0 * Math.cos(rad);
  const vy0 = v0 * Math.sin(rad);
  const tApex = vy0 / G;
  const apexHeight = (vy0 * vy0) / (2 * G);
  const range = (v0 * v0 * Math.sin(2 * rad)) / G;
  const apexX = range / 2;

  const sx = 560 / range; // board units per metre, across
  const sy = 30; // board units per metre, up
  const groundY = 520;
  const bx = (x: number) => 130 + x * sx;
  const by = (y: number) => groundY - y * sy;

  const arc: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const t = (2 * tApex * i) / 40;
    arc.push([bx(vx * t), by(vy0 * t - 0.5 * G * t * t)]);
  }

  b.say('A ball thrown at twenty metres a second, forty-five degrees up.', 0);
  b.ink(
    {
      id: 'ground',
      kind: 'polyline',
      ...shape([
        [110, groundY],
        [720, groundY],
      ]),
      style: style('faint', 1),
    },
    0,
    500,
  );
  b.ink({ id: 'trajectory', kind: 'curve', ...shape(arc), style: style('wobo', 2) }, 500, 1500);
  b.say('At the top it is still moving. Only sideways.', 2100);
  b.ink(
    { id: 'apex', kind: 'point', anchor: at(bx(apexX), by(apexHeight)), style: style('accent', 3) },
    2200,
    300,
  );
  b.ink(
    {
      id: 'apex-vx',
      kind: 'arrow',
      anchor: at(bx(apexX) + 90, by(apexHeight)),
      from: on('apex'),
      style: style('accent', 2),
    },
    2500,
    600,
  );
  b.ink(
    {
      id: 'apex-vx-label',
      kind: 'label',
      anchor: on('apex-vx'),
      text: 'sideways only',
      style: style('accent', 1),
    },
    3100,
    600,
  );
  b.ink(
    {
      id: 'height-line',
      kind: 'polyline',
      ...shape([
        [bx(apexX), by(apexHeight)],
        [bx(apexX), groundY],
      ]),
      style: { ...style('faint', 1), dash: true },
    },
    3700,
    600,
  );
  b.say('The height at the top comes out of the vertical speed alone.', 4300);
  b.ink(
    {
      id: 'apex-formula',
      kind: 'tex',
      anchor: at(760, 120),
      tex: 'h = \\frac{(v_0 \\sin\\theta)^2}{2g}',
      size: 34,
      check: CHECK.readable('apex height'),
    },
    4400,
    1400,
  );
  b.ink(
    {
      id: 'apex-height',
      kind: 'number',
      anchor: at(760, 210),
      value: apexHeight,
      precision: 2,
      unit: 'm',
      label: 'h =',
      verified: true,
      check: CHECK.agree('apex height'),
      meta: '(20*sin45)**2 / (2*9.81)',
    },
    5800,
    600,
  );
  b.ink(
    {
      id: 'apex-speed',
      kind: 'number',
      anchor: at(760, 265),
      value: vx,
      precision: 2,
      unit: 'm/s',
      label: 'vx =',
      verified: true,
      check: CHECK.agree('horizontal speed'),
      meta: '20*cos45',
    },
    6400,
    600,
  );
  b.ink(
    {
      id: 'apex-vertical',
      kind: 'number',
      anchor: at(760, 320),
      value: 0,
      precision: 2,
      unit: 'm/s',
      label: 'vy =',
      verified: true,
      check: CHECK.bounds('vertical speed at the apex'),
      meta: '20*sin45 - 9.81*t_apex',
    },
    7000,
    600,
  );
  b.ink(
    {
      id: 'apex-time',
      kind: 'number',
      anchor: at(760, 375),
      value: tApex,
      precision: 2,
      unit: 's',
      label: 't =',
      verified: true,
      check: CHECK.agree('time to the apex'),
      meta: '20*sin45 / 9.81',
    },
    7600,
    600,
  );
  b.ink(
    {
      id: 'height-brace',
      kind: 'bracket',
      anchor: on('height-line'),
      side: 'left',
      style: style('faint', 1),
    },
    8200,
    600,
  );
  b.done(8900);

  return {
    name: 'projectile-apex',
    prompt: 'what is happening at the top of a projectile',
    title: 'the apex of a projectile',
    presentation: 'full',
    subject: 'physics',
    expect: b.expectation(),
    plan: b.events,
  };
}

// --- 5. physics: a free body on an incline ---------------------------------------------------------

function incline(): GoldenBoard {
  const b = new Board();
  const mass = 5;
  const deg = 30;
  const rad = (deg * Math.PI) / 180;
  const weight = mass * G; // 49.05 N
  const along = weight * Math.sin(rad); // 24.525 N
  const normal = weight * Math.cos(rad); // 42.4779 N
  const accel = G * Math.sin(rad); // 4.905 m/s²

  // The slope: a right triangle, 30° at the left.
  const base = 520;
  const apexY = 480 - base * Math.tan(rad);
  const slopeLeft: [number, number] = [180, 480];
  const slopeRight: [number, number] = [180 + base, 480];
  const slopeTop: [number, number] = [180 + base, apexY];
  // The block sits two fifths of the way up the slope.
  const along40 = 0.42;
  const blockX = slopeLeft[0] + (slopeRight[0] - slopeLeft[0]) * along40;
  const blockY = 480 - (480 - apexY) * along40;

  const arrowLen = 120;
  const down: [number, number] = [blockX, blockY + arrowLen];
  const normalDir: [number, number] = [
    blockX - Math.sin(rad) * arrowLen,
    blockY - Math.cos(rad) * arrowLen,
  ];
  const alongDir: [number, number] = [
    blockX + Math.cos(rad) * arrowLen,
    blockY + Math.sin(rad) * arrowLen,
  ];

  b.say('A five kilogram block resting on a thirty degree slope.', 0);
  b.ink(
    {
      id: 'slope',
      kind: 'polygon',
      ...shape([slopeLeft, slopeRight, slopeTop]),
      style: style('faint', 1),
    },
    0,
    1200,
  );
  b.ink(
    {
      id: 'angle-label',
      kind: 'label',
      anchor: at(slopeLeft[0] + 46, slopeLeft[1] - 22),
      text: '30°',
      check: CHECK.agree('the slope angle'),
    },
    1200,
    400,
  );
  b.ink(
    {
      id: 'block',
      kind: 'ellipse',
      anchor: at(blockX, blockY),
      rx: 26,
      ry: 18,
      style: { ...style('wobo', 2), fill: 'wash' },
    },
    1600,
    600,
  );
  b.say('Three forces act on it, and only three.', 2200);
  b.ink(
    {
      id: 'force-weight',
      kind: 'arrow',
      anchor: at(down[0], down[1]),
      from: on('block'),
      style: style('wobo', 2),
    },
    2300,
    700,
  );
  b.ink(
    {
      id: 'force-normal',
      kind: 'arrow',
      anchor: at(normalDir[0], normalDir[1]),
      from: on('block'),
      style: style('wobo', 2),
    },
    3000,
    700,
  );
  b.ink(
    {
      id: 'force-along',
      kind: 'arrow',
      anchor: at(alongDir[0], alongDir[1]),
      from: on('block'),
      style: style('accent', 2),
    },
    3700,
    700,
  );
  // A force's name goes past its own arrowhead, computed from the arrow's direction — not dropped
  // into whatever free space the layout finds, which for three arrows on one block is across the room.
  b.ink(
    { id: 'weight-label', kind: 'label', anchor: at(down[0] - 24, down[1] + 26), text: 'weight' },
    4400,
    400,
  );
  b.ink(
    {
      id: 'normal-label',
      kind: 'label',
      anchor: at(normalDir[0] - 70, normalDir[1] - 30),
      text: 'normal',
    },
    4800,
    400,
  );
  b.ink(
    {
      id: 'along-label',
      kind: 'label',
      anchor: at(alongDir[0] + 16, alongDir[1] + 10),
      text: 'down the slope',
      style: style('accent', 1),
    },
    5200,
    500,
  );
  b.say('Split the weight along the slope and across it.', 5800);
  b.ink(
    {
      id: 'weight-value',
      kind: 'number',
      anchor: at(700, 130),
      value: weight,
      precision: 2,
      unit: 'N',
      label: 'W =',
      verified: true,
      check: CHECK.agree('weight'),
      meta: '5 * 9.81',
    },
    5900,
    600,
  );
  b.ink(
    {
      id: 'along-value',
      kind: 'number',
      anchor: at(700, 185),
      value: along,
      precision: 2,
      unit: 'N',
      label: 'W sinθ =',
      verified: true,
      check: CHECK.agree('component along the slope'),
      meta: '5 * 9.81 * sin30',
    },
    6500,
    600,
  );
  b.ink(
    {
      id: 'normal-value',
      kind: 'number',
      anchor: at(700, 240),
      value: normal,
      precision: 2,
      unit: 'N',
      label: 'N =',
      verified: true,
      check: CHECK.agree('normal force'),
      meta: '5 * 9.81 * cos30',
    },
    7100,
    600,
  );
  b.ink(
    {
      id: 'accel-value',
      kind: 'number',
      anchor: at(700, 295),
      value: accel,
      precision: 3,
      unit: 'm/s²',
      label: 'a =',
      verified: true,
      check: CHECK.agree('acceleration down the slope'),
      meta: '9.81 * sin30',
    },
    7700,
    600,
  );
  b.ink(
    {
      id: 'accel-underline',
      kind: 'underline',
      anchor: on('accel-value'),
      style: style('accent', 2),
    },
    8300,
    400,
  );
  b.done(8800);

  return {
    name: 'free-body-incline',
    prompt: 'draw the forces on a block on a 30 degree slope',
    title: 'a block on an incline',
    presentation: 'full',
    subject: 'physics',
    expect: b.expectation(),
    plan: b.events,
  };
}

// --- 6. physics: a series circuit ------------------------------------------------------------------

function circuit(): GoldenBoard {
  const b = new Board();
  const emf = 12;
  const resistances = [4, 6, 2];
  const total = resistances.reduce((s, r) => s + r, 0); // 12 Ω
  const current = emf / total; // 1 A
  const drops = resistances.map((r) => current * r); // 4, 6, 2 V

  const boxLeft = 200;
  const boxRight = 800;
  const boxTop = 180;
  const boxBottom = 460;

  b.say('One loop, one current, three resistors in a row.', 0);
  b.ink(
    {
      id: 'loop',
      kind: 'polyline',
      ...shape([
        [boxLeft, boxBottom],
        [boxLeft, boxTop],
        [boxRight, boxTop],
        [boxRight, boxBottom],
        [boxLeft, boxBottom],
      ]),
      style: style('wobo', 2),
    },
    0,
    1600,
  );
  b.ink(
    {
      id: 'cell',
      kind: 'polyline',
      ...shape([
        [boxLeft - 18, boxBottom - 22],
        [boxLeft + 18, boxBottom - 22],
      ]),
      style: style('accent', 3),
    },
    1600,
    300,
  );
  b.ink(
    {
      id: 'emf',
      kind: 'number',
      anchor: on('cell'),
      value: emf,
      unit: 'V',
      verified: true,
      check: CHECK.agree('the cell'),
      meta: 'given: 12 V',
    },
    1900,
    500,
  );

  let t = 2400;
  const ids: string[] = [];
  resistances.forEach((r, i) => {
    const cx = boxLeft + ((i + 1) * (boxRight - boxLeft)) / 4;
    const id = `resistor-${i + 1}`;
    ids.push(id);
    b.ink(
      {
        id,
        kind: 'polyline',
        ...shape([
          [cx - 40, boxTop],
          [cx - 30, boxTop - 16],
          [cx - 10, boxTop + 16],
          [cx + 10, boxTop - 16],
          [cx + 30, boxTop + 16],
          [cx + 40, boxTop],
        ]),
        style: style('wobo', 2),
      },
      t,
      600,
    );
    b.ink(
      {
        id: `${id}-value`,
        kind: 'number',
        anchor: on(id),
        value: r,
        unit: 'ohm',
        verified: true,
        check: CHECK.agree(`resistor ${i + 1}`),
        meta: `given: ${r} ohm`,
      },
      t + 600,
      500,
    );
    t += 1200;
  });

  b.say('In a series loop the resistances simply add.', t);
  b.ink(
    {
      id: 'total-resistance',
      kind: 'number',
      anchor: at(660, 530),
      value: total,
      unit: 'ohm',
      label: 'R total =',
      verified: true,
      check: CHECK.agree('total resistance'),
      meta: '4 + 6 + 2',
    },
    t + 100,
    600,
  );
  b.ink(
    {
      id: 'current',
      kind: 'number',
      anchor: at(660, 580),
      value: current,
      precision: 2,
      unit: 'A',
      label: 'I =',
      verified: true,
      check: CHECK.agree('current'),
      meta: '12 / 12',
    },
    t + 700,
    600,
  );
  t += 1400;
  b.say('The same current everywhere, so each resistor takes its share.', t);
  drops.forEach((v, i) => {
    const cx = boxLeft + ((i + 1) * (boxRight - boxLeft)) / 4;
    b.ink(
      {
        id: `drop-${i + 1}`,
        kind: 'number',
        anchor: at(cx - 30, boxTop + 60),
        value: v,
        precision: 2,
        unit: 'V',
        verified: true,
        check: CHECK.agree(`voltage across resistor ${i + 1}`),
        meta: `1 * ${resistances[i]}`,
      },
      t + i * 500,
      500,
    );
  });
  t += drops.length * 500;
  b.ink(
    {
      id: 'current-arrow',
      kind: 'arrow',
      anchor: at(620, boxBottom - 26),
      from: at(460, boxBottom - 26),
      style: style('accent', 2),
    },
    t,
    700,
  );
  b.done(t + 800);

  return {
    name: 'series-circuit',
    prompt: 'twelve volts across four, six and two ohms in series',
    title: 'a series circuit',
    presentation: 'full',
    subject: 'physics',
    expect: b.expectation(),
    plan: b.events,
  };
}

// --- 7. chemistry: benzene ------------------------------------------------------------------------

function benzene(): GoldenBoard {
  const b = new Board();
  const cx = 480;
  const cy = 320;
  const r = 130;
  // Six carbons on a regular hexagon, first one straight up — the way a chemist starts the ring.
  const vertices: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    vertices.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }

  b.say('Benzene. Six carbons in a ring, and every bond the same.', 0);
  let t = 0;
  vertices.forEach((v, i) => {
    b.ink(
      {
        id: `c${i + 1}`,
        kind: 'atom',
        anchor: at(v[0], v[1]),
        symbol: 'C',
        size: 24,
        style: style('wobo', 2),
      },
      t,
      300,
    );
    t += 260;
  });
  b.say('Join them up, carbon to carbon.', t);
  // Each bond runs from one carbon to the next by NAME. Nothing here is a coordinate: move a
  // carbon and its two bonds follow it, which is what an anchor is for.
  vertices.forEach((_, i) => {
    b.ink(
      {
        id: `bond-${i + 1}`,
        kind: 'line',
        anchor: on(`c${i + 1}`),
        to: on(`c${((i + 1) % 6) + 1}`),
        style: style('wobo', 2),
      },
      t + 100 + i * 320,
      300,
    );
  });
  t += 100 + 6 * 320;
  b.say(
    'The electrons are shared all the way round, so we draw a circle rather than three double bonds.',
    t,
  );
  b.ink(
    {
      id: 'aromatic-ring',
      kind: 'ellipse',
      anchor: at(cx, cy),
      rx: r * 0.62,
      ry: r * 0.62,
      style: style('accent', 2),
    },
    t + 100,
    900,
  );
  b.ink(
    {
      id: 'formula',
      kind: 'label',
      anchor: at(760, 200),
      text: 'C6H6',
      size: 34,
      check: CHECK.fact('benzene'),
    },
    t + 1000,
    700,
  );
  b.ink(
    {
      id: 'formula-arrow',
      kind: 'arrow',
      anchor: on('aromatic-ring'),
      from: on('formula'),
      style: style('accent', 2),
    },
    t + 1700,
    700,
  );
  b.done(t + 2500);

  return {
    name: 'benzene',
    prompt: 'draw benzene and explain the ring',
    title: 'benzene',
    presentation: 'full',
    subject: 'chemistry',
    expect: b.expectation(),
    plan: b.events,
  };
}

// --- 8. chemistry: balancing photosynthesis --------------------------------------------------------

/** Whole-number coefficients that balance an equation. Solved, never asserted — the same job the
 *  brain's `verify.balance` does, so the fixture and the verifier must land on the same list. */
function balanceEquation(reactants: string[], products: string[]): number[] {
  const species = [...reactants, ...products];
  const counts = species.map(parseFormula);
  const elements = [...new Set(counts.flatMap((c) => Object.keys(c)))].sort();
  // One row per element; reactants positive, products negative. Look for the integer nullspace by
  // brute force over small coefficients — six species, coefficients under twelve, always enough.
  const limit = 12;
  const n = species.length;
  const coefficients = new Array<number>(n).fill(1);
  const balanced = (c: number[]) =>
    elements.every((el) => {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += (counts[i]?.[el] ?? 0) * (c[i] as number) * (i < reactants.length ? 1 : -1);
      }
      return sum === 0;
    });
  const search = (i: number): number[] | null => {
    if (i === n) return balanced(coefficients) ? [...coefficients] : null;
    for (let v = 1; v <= limit; v++) {
      coefficients[i] = v;
      const found = search(i + 1);
      if (found) return found;
    }
    return null;
  };
  const found = search(0);
  if (!found) throw new Error('this equation does not balance with small whole numbers');
  return found;
}

function parseFormula(formula: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const re = /([A-Z][a-z]?)(\d*)/g;
  for (const m of formula.matchAll(re)) {
    if (!m[1]) continue;
    counts[m[1]] = (counts[m[1]] ?? 0) + (m[2] ? Number(m[2]) : 1);
  }
  return counts;
}

function photosynthesis(): GoldenBoard {
  const b = new Board();
  const reactants = ['CO2', 'H2O'];
  const products = ['C6H12O6', 'O2'];
  const coefficients = balanceEquation(reactants, products); // [6, 6, 1, 6]
  const species = [...reactants, ...products];

  // The equation reads left to right on one line, with room in front of every formula for the
  // coefficient that is about to go there.
  const y = 200;
  const xs = [200, 390, 650, 920];

  b.say('Carbon dioxide and water become sugar and oxygen. But not one for one.', 0);
  species.forEach((s, i) => {
    b.ink(
      {
        id: `species-${i + 1}`,
        kind: 'label',
        anchor: at(xs[i] as number, y),
        text: s,
        size: 32,
        check: CHECK.fact('photosynthesis'),
      },
      i * 400,
      600,
    );
  });
  b.ink(
    {
      id: 'plus-left',
      kind: 'label',
      anchor: at(320, y),
      text: '+',
      size: 30,
      style: style('faint', 1),
    },
    1700,
    300,
  );
  b.ink(
    { id: 'yields', kind: 'arrow', anchor: at(600, y), from: at(510, y), style: style('wobo', 2) },
    2000,
    700,
  );
  b.ink(
    {
      id: 'plus-right',
      kind: 'label',
      anchor: at(790, y),
      text: '+',
      size: 30,
      style: style('faint', 1),
    },
    2700,
    300,
  );
  b.say('Count the atoms on each side. They have to match.', 3000);
  // Every cell of the tally is counted here, from the formulas and the coefficients the search
  // above returned — a table is written glyph by glyph exactly like a label, so its numerals earn
  // their ink the same way (BOARD.md §6, and the verified-number law in the brain's schema).
  const perSpecies = species.map((s) => parseFormula(s));
  const tallyElements = ['C', 'H', 'O'];
  const sideTotal = (element: string, from: number, to: number): number => {
    let sum = 0;
    for (let i = from; i < to; i++) {
      sum += (perSpecies[i]?.[element] ?? 0) * (coefficients[i] as number);
    }
    return sum;
  };
  const tally = tallyElements.map((element) => [
    element,
    String(sideTotal(element, 0, reactants.length)),
    String(sideTotal(element, reactants.length, species.length)),
  ]);
  for (const [element, left, right] of tally) {
    if (left !== right) throw new Error(`the tally for ${element} does not balance`);
  }
  b.ink(
    {
      id: 'atom-tally',
      kind: 'table',
      anchor: at(220, 330),
      w: 520,
      rows: [['element', 'left', 'right'], ...tally],
      check: CHECK.balances('photosynthesis'),
      meta: `atom counts of balance(${reactants.join(' + ')} -> ${products.join(' + ')})`,
      style: style('faint', 1),
    },
    3100,
    1600,
  );
  b.ink(
    {
      id: 'tally-brace',
      kind: 'bracket',
      anchor: on('atom-tally'),
      side: 'right',
      style: style('faint', 1),
    },
    4700,
    500,
  );
  b.say('The coefficients that make them match are six, six, one and six.', 5200);
  coefficients.forEach((c, i) => {
    b.ink(
      {
        id: `coefficient-${i + 1}`,
        kind: 'number',
        // In front of the formula it multiplies, which is where a coefficient belongs.
        anchor: at((xs[i] as number) - 52, y),
        value: c,
        verified: true,
        check: CHECK.balances('photosynthesis'),
        meta: `balance(${reactants.join(' + ')} -> ${products.join(' + ')})[${i}]`,
        style: style('accent', 2),
      },
      5300 + i * 500,
      500,
    );
  });
  const t = 5300 + coefficients.length * 500;
  b.ink(
    {
      id: 'balanced-note',
      kind: 'write',
      anchor: at(800, 400),
      text: 'balanced',
      size: 30,
      style: style('accent', 2),
    },
    t,
    800,
  );
  b.ink(
    {
      id: 'balanced-circle',
      kind: 'circle',
      anchor: on('balanced-note'),
      pad: 12,
      style: style('accent', 2),
    },
    t + 800,
    700,
  );
  b.done(t + 1600);

  return {
    name: 'photosynthesis-balance',
    prompt: 'balance the photosynthesis equation',
    title: 'balancing photosynthesis',
    presentation: 'full',
    subject: 'chemistry',
    expect: b.expectation(),
    plan: b.events,
  };
}

// --- 9. chemistry: a titration curve ---------------------------------------------------------------

function titration(): GoldenBoard {
  const b = new Board();
  const acidVolume = 25; // mL
  const acidMolarity = 0.1;
  const baseMolarity = 0.1;
  const acidMoles = acidVolume * acidMolarity; // mmol
  const equivalence = acidMoles / baseMolarity; // 25 mL
  const equivalencePh = 7;

  const ph = (v: number): number => {
    const baseMoles = v * baseMolarity;
    const totalVolume = acidVolume + v;
    if (Math.abs(baseMoles - acidMoles) < 1e-12) return 7;
    if (baseMoles < acidMoles) return -Math.log10((acidMoles - baseMoles) / totalVolume);
    return 14 + Math.log10((baseMoles - acidMoles) / totalVolume);
  };

  const ox = 200;
  const oy = 540;
  const sx = 640 / 50; // 50 mL across
  const sy = 400 / 14; // pH 0..14 up
  const bx = (v: number) => ox + v * sx;
  const by = (p: number) => oy - p * sy;

  // Sampled densely through the jump, sparsely on the flats — the shape of the chemistry.
  const volumes = [
    0, 2, 5, 8, 12, 16, 20, 22, 23, 24, 24.5, 24.8, 24.9, 24.95, 25, 25.05, 25.1, 25.2, 25.5, 26,
    27, 29, 32, 36, 40, 45, 50,
  ];
  const curve: [number, number][] = volumes.map((v) => [bx(v), by(ph(v))]);

  b.say('Twenty-five millilitres of acid, and base going in drop by drop.', 0);
  b.ink(
    {
      id: 'axis-volume',
      kind: 'axis',
      anchor: at(ox, oy),
      orientation: 'x',
      min: 0,
      max: 50,
      step: 10,
      length: 640,
      label: 'base added (mL)',
      ticks: true,
      style: style('faint', 1),
    },
    0,
    800,
  );
  b.ink(
    {
      id: 'axis-ph',
      kind: 'axis',
      anchor: at(ox, oy),
      orientation: 'y',
      min: 0,
      max: 14,
      step: 2,
      length: 400,
      label: 'pH',
      ticks: true,
      style: style('faint', 1),
    },
    300,
    800,
  );
  b.ink({ id: 'curve', kind: 'curve', ...shape(curve), style: style('wobo', 2) }, 1100, 2200);
  b.say('Almost nothing happens, then everything happens at once.', 3300);
  b.ink(
    {
      id: 'equivalence-point',
      kind: 'point',
      anchor: at(bx(equivalence), by(equivalencePh)),
      style: style('accent', 3),
    },
    3400,
    300,
  );
  // The name sits in the empty upper-left of the plot and reaches the point with an arrow —
  // there is no free space beside the jump itself, and a note shuffled away from what it names
  // is a note about nothing.
  b.ink(
    {
      id: 'equivalence-label',
      kind: 'label',
      anchor: at(250, 200),
      text: 'equivalence',
      style: style('accent', 1),
    },
    3700,
    600,
  );
  b.ink(
    {
      id: 'equivalence-arrow',
      kind: 'arrow',
      anchor: on('equivalence-point'),
      from: on('equivalence-label'),
      style: style('accent', 2),
    },
    4300,
    700,
  );
  b.ink(
    {
      id: 'neutral-line',
      kind: 'polyline',
      ...shape([
        [ox, by(7)],
        [ox + 640, by(7)],
      ]),
      style: { ...style('faint', 1), dash: true },
    },
    5000,
    700,
  );
  b.ink(
    {
      id: 'start-ph',
      kind: 'number',
      anchor: at(760, 140),
      value: ph(0),
      precision: 2,
      label: 'pH at the start =',
      verified: true,
      check: CHECK.agree('starting pH'),
      meta: '-log10(0.1)',
    },
    5000,
    600,
  );
  b.ink(
    {
      id: 'equivalence-volume',
      kind: 'number',
      anchor: at(760, 195),
      value: equivalence,
      precision: 2,
      unit: 'mL',
      label: 'equivalence at',
      verified: true,
      check: CHECK.agree('equivalence volume'),
      meta: '25 * 0.1 / 0.1',
    },
    5600,
    600,
  );
  b.ink(
    {
      id: 'equivalence-ph',
      kind: 'number',
      anchor: at(760, 250),
      value: equivalencePh,
      precision: 2,
      label: 'pH there =',
      verified: true,
      check: CHECK.bounds('pH'),
      meta: 'strong acid with strong base: 7',
    },
    6200,
    600,
  );
  b.ink(
    {
      id: 'end-ph',
      kind: 'number',
      anchor: at(760, 305),
      value: ph(50),
      precision: 2,
      label: 'pH at 50 mL =',
      verified: true,
      check: CHECK.agree('final pH'),
      meta: '14 + log10((5 - 2.5) / 75)',
    },
    6800,
    600,
  );
  b.ink(
    {
      id: 'jump-bracket',
      kind: 'bracket',
      anchor: on('equivalence-point'),
      side: 'right',
      style: style('accent', 1),
    },
    7400,
    700,
  );
  b.done(8200);

  return {
    name: 'titration-curve',
    prompt: 'why does the pH jump so suddenly in a titration',
    title: 'a strong acid titration',
    presentation: 'full',
    subject: 'chemistry',
    expect: b.expectation(),
    plan: b.events,
  };
}

// --- 10. biology: a labelled plant cell ------------------------------------------------------------

function plantCell(): GoldenBoard {
  const b = new Board();
  const left = 200;
  const top = 140;
  const w = 460;
  const h = 380;

  b.say('A plant cell. The wall first, because that is what makes it a plant.', 0);
  b.ink(
    {
      id: 'cell-wall',
      kind: 'polygon',
      ...shape([
        [left, top],
        [left + w, top],
        [left + w, top + h],
        [left, top + h],
      ]),
      style: style('wobo', 2),
    },
    0,
    1400,
  );
  b.ink(
    {
      id: 'cell-membrane',
      kind: 'polygon',
      ...shape([
        [left + 14, top + 14],
        [left + w - 14, top + 14],
        [left + w - 14, top + h - 14],
        [left + 14, top + h - 14],
      ]),
      style: style('faint', 1),
    },
    1400,
    1200,
  );
  b.say('Inside: a nucleus, a great water vacuole, and the chloroplasts.', 2600);
  b.ink(
    {
      id: 'nucleus',
      kind: 'ellipse',
      anchor: at(left + 130, top + 120),
      rx: 56,
      ry: 48,
      style: { ...style('wobo', 2), fill: 'wash' },
    },
    2700,
    900,
  );
  b.ink(
    {
      id: 'nucleolus',
      kind: 'ellipse',
      anchor: on('nucleus'),
      rx: 16,
      ry: 14,
      style: { ...style('wobo', 2), fill: 'solid' },
    },
    3600,
    400,
  );
  b.ink(
    {
      id: 'vacuole',
      kind: 'ellipse',
      anchor: at(left + 300, top + 210),
      rx: 110,
      ry: 92,
      style: style('faint', 1),
    },
    4000,
    1100,
  );
  b.ink(
    {
      id: 'chloroplast-1',
      kind: 'ellipse',
      anchor: at(left + 90, top + 290),
      rx: 30,
      ry: 16,
      style: { ...style('accent', 2), fill: 'wash' },
    },
    5100,
    500,
  );
  b.ink(
    {
      id: 'chloroplast-2',
      kind: 'ellipse',
      anchor: at(left + 170, top + 320),
      rx: 30,
      ry: 16,
      style: { ...style('accent', 2), fill: 'wash' },
    },
    5600,
    500,
  );
  b.ink(
    {
      id: 'chloroplast-3',
      kind: 'ellipse',
      anchor: at(left + 380, top + 70),
      rx: 30,
      ry: 16,
      style: { ...style('accent', 2), fill: 'wash' },
    },
    6100,
    500,
  );
  b.say('Now the names, each one pointing at the thing it names.', 6600);
  // The names live outside the cell, in the clear, and each one reaches its organelle with an
  // arrow. That is how a labelled diagram is drawn, and it is also what keeps five notes from
  // being shuffled into whatever gap the layout can find inside a full cell.
  // A boundary is named at its edge, not at the middle of everything it encloses: the arrow for
  // the wall lands ON the wall. `at` is what makes that expressible without a coordinate.
  const labels: [string, string, string, [number, number], string][] = [
    ['label-wall', 'cell-wall', 'cell wall', [710, 160], 'topRight'],
    ['label-membrane', 'cell-membrane', 'cell membrane', [710, 240], 'right'],
    ['label-nucleus', 'nucleus', 'nucleus', [40, 200], 'center'],
    ['label-vacuole', 'vacuole', 'vacuole', [710, 400], 'center'],
    ['label-chloroplast', 'chloroplast-1', 'chloroplast', [40, 470], 'center'],
  ];
  let t = 6700;
  labels.forEach(([id, owner, text, where, side]) => {
    b.ink({ id, kind: 'label', anchor: at(where[0], where[1]), text }, t, 600);
    b.ink(
      {
        id: `${id}-arrow`,
        kind: 'arrow',
        anchor: side === 'center' ? on(owner) : onEdge(owner, side),
        from: on(id),
        style: style('faint', 1),
      },
      t + 600,
      600,
    );
    t += 1300;
  });
  b.done(t + 400);

  return {
    name: 'plant-cell',
    prompt: 'label a plant cell for me',
    title: 'a plant cell',
    presentation: 'full',
    subject: 'biology',
    expect: b.expectation(),
    plan: b.events,
  };
}

// --- 11. biology: a food web -----------------------------------------------------------------------

function foodWeb(): GoldenBoard {
  const b = new Board();
  const nodes: { id: string; text: string; x: number; y: number }[] = [
    { id: 'grass', text: 'grass', x: 150, y: 520 },
    { id: 'grasshopper', text: 'grasshopper', x: 400, y: 470 },
    { id: 'rabbit', text: 'rabbit', x: 380, y: 260 },
    { id: 'frog', text: 'frog', x: 680, y: 540 },
    { id: 'snake', text: 'snake', x: 870, y: 400 },
    { id: 'hawk', text: 'hawk', x: 660, y: 160 },
  ];
  const links: [string, string][] = [
    ['grass', 'grasshopper'],
    ['grass', 'rabbit'],
    ['grasshopper', 'frog'],
    ['frog', 'snake'],
    ['snake', 'hawk'],
    ['rabbit', 'hawk'],
  ];

  b.say('Every arrow points the way the energy travels.', 0);
  let t = 0;
  for (const n of nodes) {
    b.ink({ id: n.id, kind: 'label', anchor: at(n.x, n.y), text: n.text, size: 26 }, t, 500);
    t += 400;
  }
  b.say('Grass feeds the grasshopper and the rabbit.', t);
  links.forEach(([from, to], i) => {
    b.ink(
      {
        id: `eats-${i + 1}`,
        kind: 'arrow',
        anchor: on(to),
        from: on(from),
        style: style(i >= 4 ? 'accent' : 'wobo', 2),
      },
      t + 100 + i * 600,
      600,
    );
  });
  t += 100 + links.length * 600;
  b.say('Remove one link and everything above it feels it.', t);
  b.ink(
    {
      id: 'producer-note',
      kind: 'label',
      anchor: on('grass'),
      text: 'producer',
      style: style('faint', 1),
    },
    t + 100,
    500,
  );
  b.ink(
    {
      id: 'top-note',
      kind: 'label',
      anchor: on('hawk'),
      text: 'top predator',
      style: style('accent', 1),
    },
    t + 700,
    500,
  );
  b.ink(
    { id: 'hawk-circle', kind: 'circle', anchor: on('hawk'), pad: 16, style: style('accent', 2) },
    t + 1300,
    800,
  );
  b.done(t + 2200);

  return {
    name: 'food-web',
    prompt: 'draw a food web for a grassland',
    title: 'a grassland food web',
    presentation: 'full',
    subject: 'biology',
    expect: b.expectation(),
    plan: b.events,
  };
}

// --- 12. social: a timeline ------------------------------------------------------------------------

function timeline(): GoldenBoard {
  const b = new Board();
  const from = 1850;
  const to = 1950;
  const axisLeft = 120;
  const axisLength = 780;
  const axisY = 340;
  const events: { year: number; label: string }[] = [
    { year: 1857, label: 'the first revolt' },
    { year: 1885, label: 'the Congress founded' },
    { year: 1919, label: 'Jallianwala Bagh' },
    { year: 1930, label: 'the salt march' },
    { year: 1942, label: 'quit India' },
    { year: 1947, label: 'independence' },
  ];
  // Every position is the year, mapped — never an eyeballed placement.
  const xOf = (year: number) => axisLeft + ((year - from) / (to - from)) * axisLength;

  b.say('A century, and six moments in it.', 0);
  b.ink(
    {
      id: 'timeline-axis',
      kind: 'axis',
      anchor: at(axisLeft, axisY),
      orientation: 'x',
      min: from,
      max: to,
      step: 10,
      length: axisLength,
      label: 'year',
      ticks: true,
      style: style('faint', 1),
    },
    0,
    1200,
  );
  let t = 1200;
  // Four bands, not two: the last four dates fall inside seventeen years, and two bands would
  // have them writing over one another.
  const BANDS = [-52, 44, -108, 100];
  events.forEach((e, i) => {
    const band = BANDS[i % BANDS.length] as number;
    b.ink(
      {
        id: `mark-${e.year}`,
        kind: 'point',
        anchor: at(xOf(e.year), axisY),
        style: style('accent', 3),
      },
      t,
      300,
    );
    b.ink(
      {
        id: `year-${e.year}`,
        kind: 'label',
        anchor: at(xOf(e.year) - 22, axisY + band),
        text: String(e.year),
        size: 24,
        check: CHECK.fact('freedom struggle'),
      },
      t + 300,
      400,
    );
    b.ink(
      {
        id: `event-${e.year}`,
        kind: 'label',
        anchor: on(`year-${e.year}`),
        text: e.label,
        size: 20,
        style: style('faint', 1),
      },
      t + 700,
      600,
    );
    t += 1400;
  });
  b.say('Ninety years from the first revolt to the last midnight.', t);
  b.ink(
    {
      id: 'span',
      kind: 'number',
      anchor: at(560, 560),
      value: 1947 - 1857,
      unit: 'years',
      label: 'from 1857 to 1947 =',
      verified: true,
      check: CHECK.agree('the span'),
      meta: '1947 - 1857',
    },
    t + 100,
    700,
  );
  b.ink(
    {
      id: 'independence-circle',
      kind: 'circle',
      anchor: on('mark-1947'),
      pad: 18,
      style: style('accent', 2),
    },
    t + 800,
    800,
  );
  b.done(t + 1700);

  return {
    name: 'timeline',
    prompt: 'give me a timeline of the Indian freedom struggle',
    title: 'the freedom struggle',
    presentation: 'full',
    subject: 'social',
    expect: b.expectation(),
    plan: b.events,
  };
}

// --- the twelve ------------------------------------------------------------------------------------

const BUILDERS = [
  pythagoras,
  tangent,
  longDivision,
  projectile,
  incline,
  circuit,
  benzene,
  photosynthesis,
  titration,
  plantCell,
  foodWeb,
  timeline,
];

// --- the generator's own gate ----------------------------------------------------------------------

const NUMERAL = /\d/;

/** Everything an object can put on the board in words or figures. */
const COMPUTED_FIELDS = ['text', 'tex', 'label', 'title', 'value'] as const;

/** A shape bound to a variable (docs/BOARD.md §2). Its value is the learner's, not the verifier's. */
const CONTROL_KINDS: ReadonlySet<string> = new Set(['slider', 'toggle', 'input', 'drag']);

/** Everything a golden board must satisfy before it becomes a fixture. */
function audit(board: GoldenBoard): string[] {
  const problems: string[] = [];
  const objects = board.plan.flatMap((e) =>
    e.type === 'ink' ? [e.object as unknown as Record<string, unknown>] : [],
  );

  // The grammar itself: nothing may be dropped by the shipping parser.
  const parsed = parseBoardPlan(board.plan);
  if (parsed.length !== board.plan.length) {
    problems.push(`${board.plan.length - parsed.length} frame(s) failed the grammar`);
  }

  const seen = new Set<string>();
  for (const object of objects) {
    const id = String(object.id);
    const kind = String(object.kind);
    const anchor = object.anchor as Record<string, unknown> | undefined;

    // Law 1: nothing is placed by pixels, and a reference points backwards.
    if (!anchor) problems.push(`${id}: no anchor`);
    else if ('object' in anchor && !seen.has(String(anchor.object))) {
      problems.push(`${id}: anchored to ${String(anchor.object)}, which is not on the board yet`);
    }
    if (anchor && 'board' in anchor) {
      const [x, y] = anchor.board as BoardPoint;
      if (x < 0 || x > 1000 || y < 0 || y > 1000) problems.push(`${id}: anchor outside the board`);
    }
    const from = object.from as Record<string, unknown> | undefined;
    if (from && 'object' in from && !seen.has(String(from.object))) {
      problems.push(`${id}: starts at ${String(from.object)}, which is not on the board yet`);
    }
    const points = object.points as BoardPoint[] | undefined;
    if (points) {
      for (const [i, p] of points.entries()) {
        if (p[0] < 0 || p[0] > 1000 || p[1] < 0 || p[1] > 1000) {
          problems.push(`${id}: points[${i}] is outside the 1000-unit board square`);
        }
      }
    }

    // Law 2: every visible numeral names the verifier that signed it. A CONTROL is the exception,
    // and the only one: its `value` is not a quantity Wobo computed and drew, it is where the
    // learner has put the handle. What the brain recomputes FROM it — the numbers, the tangent —
    // still names a check, which is what this law is actually protecting.
    const visible = (CONTROL_KINDS.has(kind) ? ['text', 'tex', 'label', 'title'] : COMPUTED_FIELDS)
      .map((k) => String(object[k] ?? ''))
      .join(' ');
    if (NUMERAL.test(visible) && !String(object.check ?? '').trim()) {
      problems.push(`${id}: shows a number with no check`);
    }
    if (kind === 'number' && object.verified !== true) {
      problems.push(`${id}: a number is drawn only when it is verified`);
    }
    seen.add(id);
  }

  // BOARD.md §10: forty objects typical, two hundred the ceiling.
  if (objects.length > 200) problems.push(`${objects.length} objects (the ceiling is 200)`);

  // BOARD.md §4: the first ink must arrive before the first sentence ends. A sentence at 165 words
  // a minute takes about 360 ms a word; the first ink beating the first say is stricter and simpler.
  const firstSay = board.plan.find((e) => e.type === 'say');
  const firstInk = board.plan.find((e) => e.type === 'ink');
  if (!firstInk) problems.push('a board with no ink is not a board');
  else if (firstSay && (firstInk.t ?? 0) > (firstSay.t ?? 0) + 1200) {
    problems.push('the first stroke lands after the first sentence');
  }
  const last = board.plan.at(-1);
  if (last?.type !== 'done') problems.push('a turn closes with done');

  // Timestamps only ever move forwards: the hand plays the stream in the order it arrives.
  let previous = -1;
  for (const event of board.plan) {
    const t = event.t ?? 0;
    if (t < previous) problems.push(`event at ${t} ms comes after an event at ${previous} ms`);
    previous = t;
  }
  return problems;
}

// --- write it out -----------------------------------------------------------------------------------

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  mkdirSync(here, { recursive: true });
  const boards = BUILDERS.map((build) => build());
  const failures: string[] = [];

  for (const board of boards) {
    const problems = audit(board);
    if (problems.length) failures.push(`${board.name}:\n  ${problems.join('\n  ')}`);
    writeFileSync(join(here, `${board.name}.json`), `${JSON.stringify(board, null, 2)}\n`);
  }

  const manifest = boards.map((b) => ({
    name: b.name,
    prompt: b.prompt,
    title: b.title,
    subject: b.subject,
    presentation: b.presentation as Presentation,
    objects: b.expect.ids.length,
    numbers: b.expect.numbers.length,
  }));
  writeFileSync(join(here, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  if (failures.length) {
    console.error(`\nthese boards are not golden:\n\n${failures.join('\n\n')}\n`);
    process.exit(1);
  }
  const objects = manifest.reduce((s, m) => s + m.objects, 0);
  const numbers = manifest.reduce((s, m) => s + m.numbers, 0);
  console.log(`${boards.length} golden boards, ${objects} objects, ${numbers} verified numbers`);
}

// A generator, not app code: it runs when it is the thing being run, never on import. (Vite's
// production build has one input and never reaches this file at all; the guard is for safety, and
// so the type-checker still covers the generator along with the rest of `src`.)
if (process.argv[1]?.includes('goldens/build')) main();

export type { BoardObject, BoardObjectKind, GoldenBoard };
export { audit, BUILDERS, balanceEquation, main };
