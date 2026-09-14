'use client';

/**
 * Wobo's hands (docs/WOBO-PLAN.md §3) — "show me" and "do it".
 *
 * "Show me" is not a tooltip: a visible cursor glides across the real screen to the real control and
 * taps it, so the learner watches the thing happen where it happens. The path is resolved through
 * the surface registry, never through coordinates a model wrote, so it works on every registered
 * screen and breaks honestly when a control is not there.
 *
 * "Do it" runs under the permission ladder — recommend, prepare, execute with permission, safe
 * automatic. Anything that communicates, buys, submits or deletes always asks first, whatever rung
 * the action would otherwise sit on. That rule lives here as code, not as a prompt.
 */

import {
  GLASS_SURFACE_ID,
  type Rect,
  type SurfaceRegistry,
  type SurfaceTarget,
  surfaceRegistry,
} from '@wobo/wobo';
import type { PermissionRung } from './capabilities';
import { echoesQuestion } from './looking';

// --- The permission ladder ------------------------------------------------------------------------

/** Verbs that always ask, whatever else is true about the action. */
const ALWAYS_ASK =
  /\b(send|share|post|message|email|buy|purchase|pay|subscribe|checkout|submit|delete|remove|erase|forget|clear|reset|sign\s*out|unenrol|unenroll)\b/i;

/** Reads that change nothing and are trivially reversible — Wobo just does them. */
const SAFE_AUTOMATIC =
  /\b(open|show|go\s*to|navigate|scroll|highlight|point|read|explain|preview)\b/i;

/**
 * The rung an action runs on. The name is the learner-facing phrase ("send the parent note"), not an
 * internal id, because that is what a child is being asked to approve.
 */
export function permissionFor(action: string): PermissionRung {
  if (ALWAYS_ASK.test(action)) return 'execute_with_permission';
  if (SAFE_AUTOMATIC.test(action)) return 'safe_automatic';
  return 'execute_with_permission';
}

/** True when the action may run without asking. */
export function runsWithoutAsking(action: string): boolean {
  return permissionFor(action) === 'safe_automatic';
}

/**
 * The prepared-but-not-executed rung. Wobo names exactly what Wobo is about to do and waits for the
 * learner to say go ahead; nothing happens on the model's word alone, and an offer left alone
 * simply expires rather than lingering as a trap.
 */
export const ARMED_TTL_MS = 60_000;

interface ArmedAction {
  targetId: string;
  label: string;
  at: number;
}

let armed: ArmedAction | null = null;

export function armDoIt(targetId: string, label: string, at = Date.now()): void {
  armed = { targetId, label, at };
}

export function armedAction(now = Date.now()): ArmedAction | null {
  if (!armed) return null;
  if (now - armed.at > ARMED_TTL_MS) {
    armed = null;
    return null;
  }
  return armed;
}

export function disarm(): void {
  armed = null;
}

const CONFIRM = /^\s*(yes|yeah|yep|yup|go ahead|do it|please do|ok|okay|sure|carry on)\b/i;
const DECLINE = /^\s*(no|nope|not now|don'?t|cancel|stop|leave it)\b/i;

/** Did the learner say yes to what Wobo offered? */
export function isConfirmation(text: string): boolean {
  return CONFIRM.test(text);
}

/** Did they say no? A no is honoured immediately and never asked about again. */
export function isDecline(text: string): boolean {
  return DECLINE.test(text);
}

/** Whether the runtime wants everything to arrive instantly. */
function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    );
  } catch {
    return false;
  }
}

// --- The visible cursor ---------------------------------------------------------------------------

export interface CursorState {
  /** Null when Wobo is not showing anything. */
  at: { x: number; y: number } | null;
  /** True for the beat of the tap, so the ring can pulse. */
  tapping: boolean;
  /** What Wobo is narrating while it moves — announced to screen readers. */
  saying: string;
}

const RESTING: CursorState = { at: null, tapping: false, saying: '' };

class Cursor {
  private state: CursorState = RESTING;
  private readonly listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = (): CursorState => this.state;

  set(patch: Partial<CursorState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  rest(): void {
    this.set(RESTING);
  }
}

export const showCursor = new Cursor();

/** Where on a rect Wobo taps: the middle, which is where a person would. */
export function tapPoint(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Ease-in-out — Wobo sets off, travels, and settles, like a hand and not a linear tween. */
export function glideEase(t: number): number {
  const p = t < 0 ? 0 : t > 1 ? 1 : t;
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
}

/** The point along the glide at fraction `t`. */
export function glideAt(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const e = glideEase(t);
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
}

/** How long the trip should take: far is slower, but never slow. */
export function glideDurationMs(distance: number, reduced = false): number {
  if (reduced) return 0;
  return Math.max(320, Math.min(1100, 260 + distance * 0.9));
}

/** Words too common to distinguish one control from another. */
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'this',
  'that',
  'with',
  'you',
  'your',
  'where',
  'what',
  'how',
  'can',
  'please',
  'button',
  'from',
  'into',
  'about',
]);

export interface ShowMeResult {
  ok: boolean;
  /** Wobo's one-line account, in Wobo's voice — spoken and written. */
  say: string;
}

export interface ShowMeOptions {
  registry?: SurfaceRegistry;
  /** Reduced motion: Wobo arrives instantly and still taps. */
  reduced?: boolean;
  /** Tap when Wobo gets there. False for "show me where it is" without pressing it. */
  tap?: boolean;
  /** Injected for tests; defaults to the real clock. */
  now?: () => number;
  raf?: (cb: (t: number) => void) => void;
}

/**
 * Glide to a registered target and tap it. Returns what Wobo should say — Wobo narrates the move, so
 * the learner is told what is happening even with their eyes off the cursor.
 */
export async function showMe(targetId: string, options: ShowMeOptions = {}): Promise<ShowMeResult> {
  const registry = options.registry ?? surfaceRegistry;
  const target = registry.getTarget(targetId);
  if (!target) return { ok: false, say: 'I cannot find that on this screen right now.' };
  const rect = target.rect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return { ok: false, say: `${target.label} is not on screen at the moment.` };
  }
  const to = tapPoint(rect);
  const from = showCursor.get().at ?? {
    x: typeof window === 'undefined' ? to.x : window.innerWidth - 72,
    y: typeof window === 'undefined' ? to.y : window.innerHeight - 96,
  };
  const saying = `here: ${target.label}`;
  showCursor.set({ at: from, saying, tapping: false });

  const reduced = options.reduced ?? prefersReducedMotion();
  const duration = glideDurationMs(Math.hypot(to.x - from.x, to.y - from.y), reduced);
  if (duration > 0 && typeof requestAnimationFrame !== 'undefined') {
    await new Promise<void>((resolve) => {
      const started = performance.now();
      const step = () => {
        const t = (performance.now() - started) / duration;
        showCursor.set({ at: glideAt(from, to, t) });
        if (t >= 1) {
          resolve();
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  } else {
    showCursor.set({ at: to });
  }

  if (options.tap !== false) {
    showCursor.set({ tapping: true });
    const action = target.actions?.find((a) => a.name === 'tap' || a.name === 'activate');
    if (action) {
      await registry.callAction(targetId, action.name, {});
    } else {
      // No declared action: press the real control the learner would have pressed.
      //
      // The point Wobo set off towards is up to 1.1 s old by now, and a scroll or a layout shift in
      // that second would leave it over something else entirely — the one place in the hand where
      // a coordinate can outlive its layout. So the target is re-read, Wobo is moved to where it
      // actually is, and the element found there is pressed only if it BELONGS to that target.
      const fresh = target.rect();
      const at = fresh && (fresh.width > 0 || fresh.height > 0) ? tapPoint(fresh) : to;
      if (at.x !== to.x || at.y !== to.y) showCursor.set({ at });
      const owner = target.element?.() ?? null;
      // Duck-typed like the rest of this branch: the document here may be a real one, a partial
      // stand-in another test left on the global, or absent. Only a document that can answer
      // "what is under this point" is asked; otherwise the target's own element is pressed.
      const fromPoint = (globalThis as { document?: { elementFromPoint?: unknown } }).document
        ?.elementFromPoint;
      const element =
        typeof fromPoint === 'function'
          ? (fromPoint.call(document, at.x, at.y) as HTMLElement | null)
          : null;
      const pressable = element?.closest?.(
        'button, [role="button"], a, input, select, textarea, [tabindex]',
      ) as HTMLElement | null;
      const belongs =
        !owner || (pressable ? owner.contains(pressable) || pressable.contains(owner) : false);
      // Duck-typed, not `instanceof HTMLElement`: an element can come from another realm, and this
      // path has to work anywhere the registry does.
      const press = (owner as { click?: () => void } | null)?.click;
      if (pressable && belongs) pressable.click();
      else if (typeof press === 'function') press.call(owner);
    }
    setTimeout(() => showCursor.set({ tapping: false }), 260);
  }
  setTimeout(() => showCursor.rest(), 1400);
  return { ok: true, say: saying };
}

/**
 * What the glass lends that a hand can aim at. The registry lends every entry on the map as a
 * target (docs/INK-FREEZE-PLAN-TRACE.md §4), and a line of prose is not a control: "show me" points
 * at a thing to look at or press. The lab of 2026-09-08 found the cursor gliding to the learner's
 * own bubble in Wobo's transcript — "here: why does that step work?" — because a line scores on
 * every word of the question it repeats.
 */
const AIMABLE_ON_GLASS = new Set([
  'heading',
  'step',
  'figure',
  'figure-part',
  'chip',
  'input',
  'cell',
  'photo-line',
  'target',
]);

/**
 * The targets a hand may aim at: everything registered by hand, and the glass's own subjects.
 *
 * `said` is the LEARNER'S OWN WORDS, whole. It is a separate argument from `query` on purpose (the
 * adversary, 2026-09-09, finding 2): the caller strips "show me" out of the words before it
 * resolves a target, and the echo test run against the STRIPPED words no longer lined up with the
 * bubble. "show me a number line" became " a number line", which does not begin as the bubble
 * "show me a number line" begins, so the bubble came through, won on every word, and Wobo's whole
 * spoken and printed answer was "here: show me a number line" — no ink, no gateway turn, nothing.
 *
 * The refusal is applied to EVERY surface, not only the glass: a target whose label reads the
 * learner's question back is never what they meant, wherever it was registered.
 */
export function aimableTargets(
  registry: SurfaceRegistry,
  query: string,
  said: string = query,
): SurfaceTarget[] {
  // On the glass, a target whose words BEGIN as the learner's words begin is the question read
  // back: a bubble in a transcript, an announcement, a heading that quotes the ask.
  const echoesOnGlass = (t: SurfaceTarget): boolean =>
    echoesQuestion(t.label ?? '', said) ||
    echoesQuestion(t.label ?? '', query) ||
    echoesQuestion(t.text?.() ?? '', said);
  // A hand-registered control's label is OURS, and it often is exactly what a learner types ("the
  // continue button"), so only a label that is the whole of what they said, word for word, is a
  // readback rather than a control.
  const isTheQuestion = (t: SurfaceTarget): boolean => {
    const label = (t.label ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, '');
    const words = said
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, '');
    return label.length > 0 && label === words;
  };
  return registry
    .getSurfaces()
    .flatMap((surface) =>
      surface.id === GLASS_SURFACE_ID
        ? surface.targets.filter((t) => AIMABLE_ON_GLASS.has(t.kind) && !echoesOnGlass(t))
        : surface.targets.filter((t) => !isTheQuestion(t)),
    );
}

/**
 * The target "show me" should aim at, given what the learner asked for. The registry's labels are
 * written for a person, so a plain-words match against label, kind and id is the right resolver.
 */
/**
 * THE ID IS NOT WORDS, AND A FRAGMENT IS NOT A WORD (the adversary, 2026-09-09, finding 1).
 *
 * The haystack used to be `id kind label description`, matched with `includes`. Both halves of
 * that were wrong, and together they cost a whole turn: the course outline registers its lines as
 * `course-outline-1`, which CONTAINS "line", so "show me a number line" scored on the page's
 * first lesson card and Wobo's entire spoken and printed answer was "here: 1meet a square and a
 * cube" — no ink, no gateway turn, and the number-line pipeline never reached (live at 1440,
 * 2026-09-09). "the script" would have found "your subscription" the same way.
 *
 * An id is OURS. What a learner typed is matched against what a learner can READ: the label, the
 * description, and the kind as the plain word it is ("chip", "step", "figure"). And it is matched
 * word for word, with only a plural's s forgiven, so no word is ever found inside a longer one.
 */
function readableWords(target: SurfaceTarget): { phrase: string; words: Set<string> } {
  const phrase = `${target.kind} ${target.label} ${target.description ?? ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return { phrase, words: new Set(phrase.split(' ').filter(Boolean)) };
}

/** One word of the ask against the words on the thing: the same word, or the same word pluralised. */
function matchesWord(words: Set<string>, word: string): boolean {
  if (words.has(word)) return true;
  if (words.has(`${word}s`)) return true;
  return word.endsWith('s') && words.has(word.slice(0, -1));
}

export function findTargetId(
  query: string,
  registry: SurfaceRegistry = surfaceRegistry,
  /** What the learner actually said, before the caller stripped "show me" out of it. */
  said: string = query,
): string | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const targets = aimableTargets(registry, query, said);
  const exact = targets.find((t) => t.id.toLowerCase() === q);
  if (exact) return exact.id;
  // Words that appear in every label carry no signal. Without this, "the microscope" matches the
  // first control on the screen through the word "the" — and pointing at the wrong thing is worse
  // than saying Wobo cannot find it.
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  // A NUMBER IS THE WHOLE OF WHAT "STEP 3" NAMES. It is one or two characters, so the noise filter
  // above threw it away: "show me step 3 of the course" scored `step` against all seven outline
  // lines and answered with the first, "here: 1 meet a square and a cube" (measured at 1440,
  // 2026-09-09). It counts for more than a word, because a word like "step" is on every line and
  // the number is on one.
  const numbers = q.match(/\b\d+\b/g) ?? [];
  if (words.length === 0 && numbers.length === 0) return null;
  let best: { id: string; score: number } | null = null;
  for (const target of targets) {
    const hay = readableWords(target);
    let score = 0;
    if (hay.phrase.includes(q)) score += 10;
    for (const w of words) if (matchesWord(hay.words, w)) score += 2;
    for (const n of numbers) if (hay.words.has(n)) score += 3;
    if (score > 0 && (!best || score > best.score)) best = { id: target.id, score };
  }
  return best?.id ?? null;
}
