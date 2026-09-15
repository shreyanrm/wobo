/**
 * What a board says out loud.
 *
 * THE FAILURE THIS CLOSES. Wobo's whole premise is that it DRAWS the explanation, and until now a
 * learner who could not see the drawing got the least of what we offer: `spokenLabel` returned the
 * words off six kinds of object and an empty string for the other twenty-two, and an empty string
 * is announced as nothing at all. On the real Pythagoras board (`goldens/pythagoras.json`) that is
 * six of fourteen objects silent, and they are the six that carry the proof: the triangle, the
 * three squares on its sides, the rule under the total, and the ring around the answer. A listener
 * heard "a", "b", "c", the formula and three numbers, and never learned that anything had been
 * drawn at all. The old test asserted that silence on purpose — "it is not a caption on a picture"
 * — and the reasoning was sound for a caption and wrong for a board: on a board the shape IS the
 * sentence, and refusing to say it does not protect the learner from a caption, it withholds the
 * lesson.
 *
 * WHAT IT SAYS INSTEAD. Every kind in the grammar describes itself, in words a person would say
 * out loud, and the description is built from the object's OWN data rather than from a look at the
 * pixels: a polygon of three points with a right angle in it is "a right-angled triangle"; an
 * ellipse whose radii match is "a circle"; a mark that hangs off another object names the thing it
 * is about ("a line under c² = 25"), because that relationship is the whole meaning of a mark. A
 * formula is read the way a teacher reads it, in words ("h equals v nought sine theta, all squared,
 * over 2g") rather than as its own source. And where the measurements genuinely cannot tell two
 * objects apart — the three squares that ARE the Pythagoras proof all measure "a square" — the
 * board names its own shape with a `title`, spoken and never drawn.
 * Nothing here invents a fact. Where the board holds no name for something the sentence stays at
 * what is true ("a dot"), and where a mark points at a bare coordinate the coordinate is left
 * unsaid, because a position in board units means nothing to somebody listening.
 *
 * THE ORDER IS PART OF THE MEANING. The renderer announces these in the order the ink lands, which
 * is the order Wobo explains in, and `renderer.test.ts` holds a whole real board to that: on the
 * timeline board the walk is dot, year, event, dot, year, event, and a correct description in a
 * senseless order would still not be teaching.
 */

import type { Anchor, BoardObject, BoardPoint, BoardStyle } from './schema';

/** How an object referred to by id is found. The renderer passes the store's own `get`. */
export type LookUp = (id: string) => BoardObject | undefined;

/**
 * The elements a school board actually draws. A symbol that is not here is spoken as the symbol,
 * which is what is written on the board anyway; this list exists so that a benzene ring reads as
 * six carbons rather than six letters.
 */
const ELEMENTS: Record<string, string> = {
  H: 'hydrogen',
  He: 'helium',
  Li: 'lithium',
  Be: 'beryllium',
  B: 'boron',
  C: 'carbon',
  N: 'nitrogen',
  O: 'oxygen',
  F: 'fluorine',
  Ne: 'neon',
  Na: 'sodium',
  Mg: 'magnesium',
  Al: 'aluminium',
  Si: 'silicon',
  P: 'phosphorus',
  S: 'sulphur',
  Cl: 'chlorine',
  Ar: 'argon',
  K: 'potassium',
  Ca: 'calcium',
  Cr: 'chromium',
  Mn: 'manganese',
  Fe: 'iron',
  Ni: 'nickel',
  Cu: 'copper',
  Zn: 'zinc',
  Br: 'bromine',
  Ag: 'silver',
  Sn: 'tin',
  I: 'iodine',
  Ba: 'barium',
  Pt: 'platinum',
  Au: 'gold',
  Hg: 'mercury',
  Pb: 'lead',
  U: 'uranium',
};

/** Small counts read as words; a big one stays a numeral, as a person would say it. */
const COUNTS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

// --- LaTeX, said out loud -------------------------------------------------------------------------
//
// THE ONE OBJECT THAT CARRIES THE PHYSICS WAS THE ONE OBJECT NOBODY COULD HEAR. `tex` used to be
// announced as its own source, so the projectile board read out "h equals backslash frac open brace
// open paren v underscore zero backslash sin theta close paren caret two close brace open brace two
// g close brace", and the Pythagoras law read "a caret two plus b caret two equals c caret two" —
// while the very same board renders `a² = 16` with a real superscript, so the inconsistency was
// audible within one board. `texPlainText` in `handwriting.ts` solves the neighbouring problem (the
// GLYPHS when the font never arrived); this one is about words a person would say.

/** The commands a school board writes, in the words a teacher says for them. */
const TEX_SPOKEN: Record<string, string> = {
  times: 'times',
  cdot: 'times',
  div: 'divided by',
  pm: 'plus or minus',
  mp: 'minus or plus',
  leq: 'is at most',
  le: 'is at most',
  geq: 'is at least',
  ge: 'is at least',
  neq: 'is not equal to',
  ne: 'is not equal to',
  approx: 'is about',
  equiv: 'is equivalent to',
  propto: 'is proportional to',
  infty: 'infinity',
  degree: 'degrees',
  circ: 'degrees',
  sin: 'sine',
  cos: 'cosine',
  tan: 'tan',
  sec: 'secant',
  cosec: 'cosec',
  cot: 'cot',
  log: 'log',
  ln: 'natural log',
  exp: 'e to the power',
  sum: 'the sum of',
  int: 'the integral of',
  alpha: 'alpha',
  beta: 'beta',
  gamma: 'gamma',
  delta: 'delta',
  epsilon: 'epsilon',
  eta: 'eta',
  theta: 'theta',
  lambda: 'lambda',
  mu: 'mu',
  nu: 'nu',
  pi: 'pi',
  rho: 'rho',
  sigma: 'sigma',
  tau: 'tau',
  phi: 'phi',
  omega: 'omega',
  Delta: 'delta',
  Sigma: 'sigma',
  Omega: 'omega',
  Theta: 'theta',
  Phi: 'phi',
  Lambda: 'lambda',
  to: 'goes to',
  rightarrow: 'gives',
  Rightarrow: 'so',
  leftrightarrow: 'is the same as',
  left: '',
  right: '',
  quad: ' ',
  qquad: ' ',
}; // fmt: skip

/** The symbols a keyboard writes, in the same words. */
const TEX_OPERATORS: Record<string, string> = {
  '=': 'equals',
  '+': 'plus',
  '-': 'minus',
  '*': 'times',
  '/': 'over',
  '<': 'is less than',
  '>': 'is greater than',
  '±': 'plus or minus',
  '×': 'times',
  '÷': 'divided by',
}; // fmt: skip

/** The balanced `{...}` starting at `start`, or null when there is not one. */
function braced(source: string, start: number): { body: string; end: number } | null {
  if (source[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: source.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** What follows `^` or `_`: a braced group, a command, or the single next character. */
function argumentAt(source: string, at: number): { body: string; end: number } {
  const group = braced(source, at);
  if (group) return group;
  const command = /^\\[a-zA-Z]+/.exec(source.slice(at));
  if (command) return { body: command[0], end: at + command[0].length };
  return { body: source[at] ?? '', end: at + 1 };
}

/** A power, in the words a class uses for it. */
function power(exponent: string): string {
  const said = spokenTex(exponent);
  if (said === '2') return 'squared';
  if (said === '3') return 'cubed';
  return `to the power ${said}`;
}

/**
 * One line of LaTeX as a person would read it out.
 *
 * "h = \\frac{(v_0 \\sin\\theta)^2}{2g}" becomes "h equals v nought sine theta, all squared, over
 * 2 g". Grouping is kept where it changes the meaning ("all squared" after a bracket) and dropped
 * where it does not, because a listener cannot hear a bracket and does not need to.
 */
export function spokenTex(tex: string): string {
  const words: string[] = [];
  let i = 0;
  while (i < tex.length) {
    const char = tex[i] as string;
    if (char === '\\') {
      const command = /^\\([a-zA-Z]+)/.exec(tex.slice(i));
      if (!command) {
        i += 1;
        continue;
      }
      const name = command[1] as string;
      i += command[0].length;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const top = braced(tex, i);
        const bottom = top ? braced(tex, top.end) : null;
        if (top && bottom) {
          words.push(`${spokenTex(top.body)} over ${spokenTex(bottom.body)}`);
          i = bottom.end;
          continue;
        }
      }
      if (name === 'sqrt') {
        const inside = braced(tex, i);
        if (inside) {
          words.push(`the square root of ${spokenTex(inside.body)}`);
          i = inside.end;
          continue;
        }
      }
      const said = TEX_SPOKEN[name];
      // An unknown command is dropped rather than spelled out: "backslash mathrm" teaches nothing.
      if (said) words.push(said);
      continue;
    }
    if (char === '^' || char === '_') {
      const argument = argumentAt(tex, i + 1);
      i = argument.end;
      if (char === '^') words.push(power(argument.body));
      // v_0 is "v nought" in every classroom this product serves; anything else is read as itself.
      else words.push(argument.body === '0' ? 'nought' : `sub ${spokenTex(argument.body)}`);
      continue;
    }
    if (char === '(' || char === '[') {
      const close = char === '(' ? ')' : ']';
      let depth = 0;
      let end = i;
      for (let j = i; j < tex.length; j += 1) {
        if (tex[j] === char) depth += 1;
        else if (tex[j] === close) {
          depth -= 1;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end > i) {
        const inside = spokenTex(tex.slice(i + 1, end));
        // A bracket only matters to a listener when something is done to the whole of it.
        if (tex[end + 1] === '^') {
          const argument = argumentAt(tex, end + 2);
          words.push(`${inside}, all ${power(argument.body)}`);
          i = argument.end;
        } else {
          words.push(inside);
          i = end + 1;
        }
        continue;
      }
    }
    const operator = TEX_OPERATORS[char];
    if (operator) {
      words.push(operator);
      i += 1;
      continue;
    }
    if (char === '{' || char === '}' || char === '&') {
      i += 1;
      continue;
    }
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    // A run of ordinary characters — a name, a numeral — travels as one word.
    const run = /^[^\\^_(){}[\]&\s=+\-*/<>±×÷]+/.exec(tex.slice(i));
    const token = run ? run[0] : char;
    words.push(token);
    i += token.length;
  }
  return words
    .filter((w) => w.trim())
    .join(' ')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

const say = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The words the object carries itself, if it carries any. */
function ownWords(o: Record<string, unknown>): string {
  return say(o.text) || say(o.tex) || say(o.title) || say(o.alt);
}

/** A number as it should be read: at the precision Wobo set, with no trailing zeroes of its own. */
function amount(value: number, precision?: number): string {
  if (typeof precision === 'number') return value.toFixed(precision);
  return String(value);
}

/** How the shading reads. `wash` is a tint over the shape; `solid` is the ink itself. */
function shading(style: BoardStyle | undefined): string {
  if (style?.fill === 'wash') return 'shaded ';
  if (style?.fill === 'solid') return 'filled-in ';
  return '';
}

const dashed = (style: BoardStyle | undefined): string => (style?.dash ? 'dashed ' : '');

/** "oval" becomes "an oval". Said out loud, the wrong article is heard as a stumble. */
const withArticle = (phrase: string): string =>
  `${/^[aeiou]/i.test(phrase) ? 'an' : 'a'} ${phrase}`;

/** Is this the learner's own stroke rather than Wobo's ink? */
const isLearners = (object: BoardObject): boolean => object.style?.ink === 'learner';

// --- shapes that can name themselves --------------------------------------------------------------

const side = (a: BoardPoint, b: BoardPoint): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The interior angle at `b`, in degrees. */
function angleAt(a: BoardPoint, b: BoardPoint, c: BoardPoint): number {
  const u: BoardPoint = [a[0] - b[0], a[1] - b[1]];
  const v: BoardPoint = [c[0] - b[0], c[1] - b[1]];
  const mag = Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]);
  if (mag === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (u[0] * v[0] + u[1] * v[1]) / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

const SQUARE_TOLERANCE = 0.04;
const RIGHT_TOLERANCE = 2;
/** How far off the horizontal a side may lean before a listener would call the shape tilted. */
const UPRIGHT_TOLERANCE = 3;

/** Does this shape sit square to the board, or on its corner? */
function isUpright(points: readonly BoardPoint[]): boolean {
  return points.every((p, i) => {
    const q = points[(i + 1) % points.length] as BoardPoint;
    const angle = Math.abs((Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI) % 90;
    return Math.min(angle, 90 - angle) < UPRIGHT_TOLERANCE;
  });
}

/**
 * What a closed run of points is, said the way a learner names it: a triangle, a square, a
 * rectangle, a hexagon. The measurements are the object's own points, so a square drawn on its
 * corner (the square on the hypotenuse) is still a square.
 */
export function shapeName(points: readonly BoardPoint[]): string {
  const n = points.length;
  if (n < 3) return 'a line';
  const sides = points.map((p, i) => side(p, points[(i + 1) % n] as BoardPoint));
  const angles = points.map((p, i) =>
    angleAt(points[(i + n - 1) % n] as BoardPoint, p, points[(i + 1) % n] as BoardPoint),
  );
  const longest = Math.max(...sides);
  const equal =
    longest > 0 && sides.every((s) => Math.abs(s - longest) / longest < SQUARE_TOLERANCE);
  const square = angles.every((a) => Math.abs(a - 90) < RIGHT_TOLERANCE);
  if (n === 3) {
    return angles.some((a) => Math.abs(a - 90) < RIGHT_TOLERANCE)
      ? 'a right-angled triangle'
      : 'a triangle';
  }
  if (n === 4) {
    // A square drawn on its corner IS still a square, and a listener still needs to know which one
    // it is: the square on the hypotenuse is the tilted one, and on the Pythagoras board that was
    // the only thing separating it from the two on the legs.
    const lean = isUpright(points) ? '' : 'tilted ';
    if (square) return equal ? `a ${lean}square` : `a ${lean}rectangle`;
    return 'a four-sided shape';
  }
  if (n === 5) return 'a pentagon';
  if (n === 6) return 'a hexagon';
  return `a shape with ${n} sides`;
}

// --- what a mark is about --------------------------------------------------------------------------

/**
 * The thing an anchor points at, said in words, or null when there is nothing to say.
 *
 * A board coordinate deliberately returns null: "at 660 by 210" is a fact about the paper and
 * tells a listener nothing about the lesson. A registered target or a circled region says what it
 * is in the learner's own terms.
 */
export function whatAnchors(anchor: Anchor | undefined, look?: LookUp): string | null {
  if (!anchor) return null;
  if ('object' in anchor) {
    const other = look?.(anchor.object);
    // One hop only: the object it is about, never the object THAT one is about, or a chain of
    // marks would read the whole board back for one ring.
    return other ? describe(other) || null : null;
  }
  if ('focus' in anchor) return 'what you circled';
  if ('target' in anchor) return anchor.target.replace(/[-_]+/g, ' ').trim() || null;
  return null;
}

// --- the sentence ------------------------------------------------------------------------------------

/**
 * One object, in a sentence. Empty only for a `wipe` with nothing to report, so the renderer can
 * still choose to stay silent.
 *
 * `look` is optional and everything degrades without it: a mark that cannot find what it is about
 * says what it is instead of what it is about, which is less useful and still true.
 */
export function describe(
  object: BoardObject,
  look?: LookUp,
  /** How the hand placed it, where that changes the sentence: a cross beside a line, not through it. */
  placed?: { beside?: boolean },
): string {
  const o = object as unknown as Record<string, unknown>;
  const style = object.style;
  const about = 'anchor' in object ? whatAnchors(object.anchor, look) : null;
  const on = about ? ` on ${about}` : '';

  switch (object.kind) {
    // --- what Wobo wrote: the words themselves, and nothing added to them ---
    case 'write':
    case 'label':
      return say(o.text);
    case 'tex':
      return spokenTex(say(o.tex));
    case 'image':
      return say(o.alt);

    case 'number': {
      // The label is Wobo's own sentence about the quantity ("a² ="), so it leads; the value is
      // added unless the sentence already carries it. The value used to be dropped entirely
      // whenever a label existed, so the real board said "a² =" and never said sixteen.
      const value = amount(object.value, object.precision);
      const unit = say(o.unit);
      const said = `${value}${unit ? ` ${unit}` : ''}`;
      const label = say(o.label);
      if (!label) return said;
      return label.includes(value) ? label : `${label} ${said}`;
    }

    case 'table':
      return Array.isArray(o.rows)
        ? (o.rows as unknown[])
            .map((row) =>
              Array.isArray(row) ? row.filter((c) => typeof c === 'string').join(', ') : '',
            )
            .filter(Boolean)
            .join('. ')
        : 'a table';

    // --- marks: a mark is about something, so it names it ---
    case 'point':
      return about ? `a dot on ${about}` : 'a dot';
    case 'tick':
      return about ? `a tick beside ${about}` : 'a tick';
    case 'cross':
      return about ? `a cross ${placed?.beside ? 'beside' : 'through'} ${about}` : 'a cross';
    case 'note':
      return about ? `${object.text}, beside ${about}` : object.text;
    case 'ring':
    case 'circle':
      return about ? `a ring around ${about}` : 'a ring';
    case 'underline':
      return about ? `a line under ${about}` : 'a line underneath';
    case 'strike':
      return about ? `${about}, crossed out` : 'something crossed out';
    case 'arrow': {
      const from = whatAnchors(object.from, look);
      if (from && about) return `an arrow from ${from} to ${about}`;
      if (from) return `an arrow from ${from}`;
      if (about) return `an arrow pointing at ${about}`;
      return 'an arrow';
    }
    case 'bracket': {
      const label = say(o.label);
      const where = about ? ` around ${about}` : '';
      return label ? `a bracket${where}, labelled ${label}` : `a bracket${where}`;
    }
    case 'erase': {
      const gone = look?.(object.object);
      const what = gone ? describe(gone) : '';
      return what ? `${what}, rubbed out` : 'something rubbed out';
    }
    case 'wipe':
      return 'the board is wiped clean';

    // --- shapes: something new on the board ---
    case 'line': {
      const to = whatAnchors(object.to, look);
      const base = `a ${dashed(style)}line`;
      if (about && to) return `${base} from ${about} to ${to}`;
      if (to) return `${base} to ${to}`;
      return base;
    }
    case 'polyline': {
      if (isLearners(object)) return 'your own mark';
      const n = object.points.length;
      const base = `a ${dashed(style)}line`;
      return n > 2 ? `${base} through ${n} points` : base;
    }
    case 'curve':
      if (isLearners(object)) return 'your own mark';
      return object.closed ? `a closed ${shading(style)}curve` : `a ${dashed(style)}curve`;
    case 'polygon': {
      // A board that named this shape has said something the points cannot: which of three
      // identical squares this one is. Its own word wins over the measured one.
      const named = ownWords(o);
      if (named) return named;
      // "a square" becomes "a shaded square": the shading goes inside the phrase, so the article
      // still agrees with the shape a listener is being told about.
      const name = shapeName(object.points);
      const shade = shading(style);
      return shade ? name.replace(/^an? /, (article) => `${article}${shade}`) : name;
    }
    case 'ellipse': {
      const round = Math.abs(object.rx - object.ry) / Math.max(object.rx, object.ry) < 0.05;
      return withArticle(`${shading(style)}${round ? 'circle' : 'oval'}`);
    }
    case 'axis': {
      const label = say(o.label);
      const name = `the ${object.orientation} axis`;
      return `${name}${label ? `, ${label}` : ''}, from ${amount(object.min)} to ${amount(object.max)}`;
    }
    case 'grid':
      return `a grid, ${object.cols} across and ${object.rows} down`;
    case 'region': {
      // A region is a card on the board. Its title is the teaching; the shading is how much of it
      // is filled, which is the one thing a listener cannot otherwise know.
      const title = ownWords(o);
      const shade = shading(style).trim();
      if (title) return shade ? `${title}, ${shade}` : title;
      return shade ? `a ${shade} area` : 'an area of the board';
    }
    case 'bond': {
      const order = object.order ?? 1;
      const kind = order === 3 ? 'a triple bond' : order === 2 ? 'a double bond' : 'a bond';
      if (object.wedge === 'up') return `${kind} coming towards you`;
      if (object.wedge === 'down') return `${kind} going back`;
      return about ? `${kind} from ${about}` : kind;
    }
    case 'atom': {
      const symbol = say(o.symbol);
      const name = ELEMENTS[symbol] ?? symbol;
      const charge = typeof o.charge === 'number' && o.charge !== 0 ? (o.charge as number) : 0;
      const pairs = typeof o.lonePairs === 'number' ? (o.lonePairs as number) : 0;
      const bits = [name];
      if (charge) bits.push(`charge ${charge > 0 ? '+' : ''}${charge}`);
      if (pairs) bits.push(`${COUNTS[pairs] ?? pairs} lone pair${pairs === 1 ? '' : 's'}`);
      return bits.join(', ');
    }

    // --- controls: a shape the learner can move ---
    case 'slider':
      return `a slider for ${say(o.label) || object.variable}, from ${amount(object.min)} to ${amount(object.max)}, now at ${amount(object.value)}`;
    case 'toggle':
      return `a switch for ${say(o.label) || object.variable}, ${object.value ? 'on' : 'off'}`;
    case 'input':
      return `a box for ${say(o.label) || object.variable}, ${say(o.value) ? `holding ${say(o.value)}` : 'empty'}`;
    case 'drag':
      return `a handle for ${say(o.label) || object.variable} you can move${on}`;
  }
}
