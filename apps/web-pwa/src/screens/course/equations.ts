/**
 * A tiny deterministic linear-equation engine for the course player. Everything a learner sees
 * is computed, never asserted: substitutions, normalized forms, and "the correct move" all come
 * from arithmetic on the equation string itself (CONTEXT.md verification law — nothing unverified
 * is presented as truth).
 */

/** Evaluate an expression in one variable x. Supports + - * / ( ), implicit multiplication. */
export function evalExpr(src: string, x: number): number {
  const s = src.replace(/\s+/g, '').replace(/−/g, '-').replace(/[·×]/g, '*');
  let i = 0;
  const peek = () => s[i];

  const parseFactor = (): number => {
    const c = peek();
    if (c === '-') {
      i += 1;
      return -parseFactor();
    }
    if (c === '(') {
      i += 1;
      const v = parseExpr();
      if (peek() === ')') i += 1;
      return v;
    }
    if (c === 'x' || c === 'X') {
      i += 1;
      return x;
    }
    let j = i;
    while (j < s.length && /[0-9.]/.test(s.charAt(j))) j += 1;
    if (j === i) throw new Error(`unreadable expression "${src}"`);
    const v = Number(s.slice(i, j));
    i = j;
    return v;
  };

  const parseTerm = (): number => {
    let v = parseFactor();
    for (;;) {
      const c = peek();
      if (c === '*' || c === '/') {
        i += 1;
        const f = parseFactor();
        v = c === '*' ? v * f : v / f;
      } else if (c === '(' || c === 'x' || c === 'X') {
        // implicit multiplication: 2x, 2(x+3), (x+1)(x+2)
        v *= parseFactor();
      } else {
        break;
      }
    }
    return v;
  };

  const parseExpr = (): number => {
    let v = parseTerm();
    for (;;) {
      const c = peek();
      if (c === '+' || c === '-') {
        i += 1;
        const t = parseTerm();
        v = c === '+' ? v + t : v - t;
      } else {
        break;
      }
    }
    return v;
  };

  const v = parseExpr();
  if (i !== s.length) throw new Error(`unreadable expression "${src}"`);
  return v;
}

/** Compact number formatting: integers stay integers, everything else trims to 3 decimals. */
export function fmt(n: number): string {
  const r = Math.round(n);
  if (Math.abs(n - r) < 1e-9) return String(r);
  return String(Number(n.toFixed(3)));
}

/** Render a coefficient on x: 1 → "x", -1 → "−x", 0.5 → "x/2", else "3x". */
export function aX(a: number): string {
  if (a === 1) return 'x';
  if (a === -1) return '−x';
  if (a !== 0 && Math.abs(a) < 1 && Number.isInteger(1 / a)) {
    const d = 1 / a;
    return d > 0 ? `x/${fmt(d)}` : `−x/${fmt(-d)}`;
  }
  return `${fmt(a)}x`;
}

export interface Linear {
  /** Normalized to a·x + b = c (x-terms folded left, constants honest). */
  a: number;
  b: number;
  c: number;
  /** The solution (c − b) / a. */
  x: number;
  lhs: (x: number) => number;
  rhs: (x: number) => number;
  /** The equation rewritten flat as "a·x + b = c" — differs from raw for bracketed forms. */
  flat: string;
}

/**
 * Extract linear structure by evaluation (L at 0, 1, 2 gives slope, intercept, and a linearity
 * proof via second differences) — no symbolic algebra needed, and it cannot silently mis-parse.
 */
export function linearize(equation: string): Linear | null {
  const parts = equation.split('=');
  const L = parts[0];
  const R = parts[1];
  if (!L || !R || parts.length !== 2) return null;
  try {
    const l0 = evalExpr(L, 0);
    const l1 = evalExpr(L, 1);
    const l2 = evalExpr(L, 2);
    const r0 = evalExpr(R, 0);
    const r1 = evalExpr(R, 1);
    const r2 = evalExpr(R, 2);
    if (Math.abs(l2 - 2 * l1 + l0) > 1e-9 || Math.abs(r2 - 2 * r1 + r0) > 1e-9) return null;
    // p·x + q = r·x + s  →  (p − r)·x + q = s
    const a = l1 - l0 - (r1 - r0);
    const b = l0;
    const c = r0;
    if (Math.abs(a) < 1e-12) return null;
    const sign = b < 0 ? '−' : '+';
    const flat =
      b === 0 ? `${aX(a)} = ${fmt(c)}` : `${aX(a)} ${sign} ${fmt(Math.abs(b))} = ${fmt(c)}`;
    return {
      a,
      b,
      c,
      x: (c - b) / a,
      lhs: (x: number) => evalExpr(L, x),
      rhs: (x: number) => evalExpr(R, x),
      flat,
    };
  } catch {
    return null;
  }
}

export interface Move {
  /** The named correct move, e.g. "subtract 3 from both sides". */
  text: string;
  /** The equation after the move — omitted when showing it would hand over the answer. */
  result?: string;
}

/**
 * The correct first move on a·x + b = c. Never hands the final answer: when the move is the
 * last one, only the move is named — the learner finishes it.
 */
export function firstMove(lin: Linear): Move {
  const { a, b, c } = lin;
  if (b !== 0) {
    const text = b > 0 ? `subtract ${fmt(b)} from both sides` : `add ${fmt(-b)} to both sides`;
    if (a === 1) return { text }; // subtracting b would reveal x directly
    return { text, result: `${aX(a)} = ${fmt(c - b)}` };
  }
  if (Math.abs(a) < 1 && Number.isInteger(1 / a)) {
    return { text: `multiply both sides by ${fmt(1 / a)}` };
  }
  return { text: `divide both sides by ${fmt(a)}` };
}

const flat = (s: string) => s.replace(/\s+/g, '').replace(/−/g, '-');

/**
 * A TWIN of an equation: the same left side, a different whole-number answer, and the right side
 * that answer makes. "x + 7 = 12" has "x + 7 = 13"; "x/2 = 5" has "x/2 = 6".
 *
 * Computed, never asserted: the right side is the left side evaluated at the new answer, and the
 * twin is read back through `linearize` and kept only when it solves to exactly that answer. It is
 * never one of `avoid`, so a card that works it through never hands over an answer the learner
 * will be asked for. Null when the right side is not a plain number or no twin is near.
 */
export function twinEquation(
  equation: string,
  avoid: readonly string[] = [],
): { equation: string; x: number } | null {
  const lin = linearize(equation);
  const [left, right] = equation.split('=');
  if (!lin || !left || !right || !/^\s*-?\d+(\.\d+)?\s*$/.test(right)) return null;
  if (!Number.isInteger(lin.x)) return null;
  const taken = new Set([flat(equation), ...avoid.map(flat)]);
  for (let step = 1; step <= 24; step += 1) {
    const x = lin.x + step;
    const c = lin.lhs(x);
    if (!Number.isInteger(c)) continue;
    const twin = `${left.trim()} = ${fmt(c)}`;
    if (taken.has(flat(twin))) continue;
    const back = linearize(twin);
    if (back && Math.abs(back.x - x) < 1e-9) return { equation: twin, x };
  }
  return null;
}

/** Reduce k/d to a display string: "8/2" → "4", "7/2" → "7/2 = 3.5". */
export function fractionText(k: number, d: number): string {
  if (d === 0) return '—';
  const v = k / d;
  if (Number.isInteger(v)) return fmt(v);
  const g = gcd(Math.abs(Math.round(k)), Math.abs(Math.round(d)));
  const num = Math.round(k) / g;
  const den = Math.round(d) / g;
  const frac = den < 0 ? `${fmt(-num)}/${fmt(-den)}` : `${fmt(num)}/${fmt(den)}`;
  return `${frac} = ${fmt(v)}`;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x === 0 ? 1 : x;
}
