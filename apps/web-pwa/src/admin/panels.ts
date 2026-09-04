/**
 * What a desk is allowed to put on the screen, and the one rule that governs it.
 *
 * THE RULE: a panel either carries a number AND its provenance, or it carries no number at all.
 * There is no third shape. `Figure` and `Rows` both require a `Provenance`; `Absent` cannot hold
 * a value and must say what would fill it. That is why the honesty rule is a type here rather
 * than a comment: a desk cannot draw an empty chart, because there is no panel kind that renders
 * one, and it cannot show an unsourced figure, because the field is not optional.
 *
 * TONE is semantic and is kept away from the brand. `ok`, `warn` and `critical` are mint,
 * marigold and rose; `pig` — Wobo blue, the pointer — is never a status. On an operator screen a
 * brand accent that also means "healthy" is a colour that means two things, and the six traps in
 * DESIGN.md were all a thing meaning two things.
 */

/** Semantic state. `unknown` exists so a reading we could not take never renders as `ok`. */
export type Tone = 'ok' | 'warn' | 'critical' | 'unknown' | 'plain';

/** Where a number came from and when. Required on anything that shows one. */
export interface Provenance {
  /** Chaseable in words: the endpoint, and the module behind it. */
  readonly source: string;
  /** When this reading was taken, ISO. `null` only while the first read is in flight. */
  readonly at: string | null;
  /** Anything that makes the figure narrower than it looks. Shown, never hidden in a tooltip. */
  readonly caveat?: string;
}

export interface Figure {
  readonly kind: 'figure';
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly note?: string;
  readonly tone: Tone;
  readonly provenance: Provenance;
}

export interface Rows {
  readonly kind: 'rows';
  readonly id: string;
  readonly label: string;
  readonly columns: readonly string[];
  /**
   * Cell text plus its tone. Tone is per row so a failing check reads at a glance.
   *
   * `id` is optional and is the row's OWN identity where it has one (a report id). Rows used to be
   * keyed on their joined cell text, so two identical rows — same minute, same handle, same
   * reason, no note — collided and React dropped one from the DOM. That is exactly the shape of a
   * duplicate submit, or of a script burying a real flag under repeats, which is the case a desk
   * exists to catch.
   */
  readonly rows: readonly {
    readonly id?: string;
    readonly cells: readonly string[];
    readonly tone: Tone;
  }[];
  readonly provenance: Provenance;
}

/** A panel with nothing behind it. It states the absence and what would end it. No value field. */
export interface Absent {
  readonly kind: 'absent';
  readonly id: string;
  readonly label: string;
  /** Why there is no number. Specific — a module or a table, not "coming soon". */
  readonly because: string;
  /** What would fill it. Specific enough to be a piece of work someone can pick up. */
  readonly wouldFill: string;
}

export type Panel = Figure | Rows | Absent;

/** Which tone wins when two readings disagree. Worst first, and `unknown` beats `ok`: not
 *  knowing is a worse position than knowing it is fine, and must not be summarised as fine. */
const RANK: Record<Tone, number> = { critical: 4, warn: 3, unknown: 2, plain: 1, ok: 0 };

export function worst(tones: readonly Tone[]): Tone {
  return tones.reduce<Tone>((held, next) => (RANK[next] > RANK[held] ? next : held), 'ok');
}

export function rank(tone: Tone): number {
  return RANK[tone];
}

// --- how numbers are written ---------------------------------------------------------------------
// Tabular everywhere (the CSS does that); these decide the digits. Money is never rounded up to a
// friendlier number: an operator pricing a plan needs the figure, not a nice one.

/** US dollars, the currency every provider bills the platform in. Two places, or four when the
 *  figure is small enough that two would print `$0.00` for real money that was actually spent. */
export function usd(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  if (amount > 0 && amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

/** A fraction as a percentage. One place under 10 %, none above — the extra digit matters when
 *  the number is small and is noise when it is large. */
export function percent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—';
  const value = fraction * 100;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

/** A count, grouped. `—` when it is not a number, never `0`: absent and zero are different facts. */
export function count(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
}

/** Spoken or filmed time, as an operator reads it: seconds under a minute, then m and s. */
export function seconds(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 60) return `${Math.round(value)}s`;
  const whole = Math.round(value);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
}

/** "as of 14:32:07 UTC" — the freshness line every panel carries. UTC because the ledger's day,
 *  the spend ceiling's day and the gateway's clock are all UTC, and a console showing a local
 *  time beside a UTC day is how somebody reads the wrong day's money. */
export function asOf(iso: string | null): string {
  if (!iso) return 'not read yet';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'not read yet';
  return `as of ${when.toISOString().slice(11, 19)} UTC`;
}
