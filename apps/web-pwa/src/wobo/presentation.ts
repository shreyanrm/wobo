'use client';

/**
 * Which surface Wobo draws on (docs/BOARD.md §5).
 *
 * THE RULE, in one line: the ink decides the surface, and only the learner's word beats it.
 *
 * When the thing to point at is already on the learner's screen — a chip, a line of the lesson, a
 * step of their own working, a part of a diagram in front of them — Wobo annotates it in place: a
 * mark anchored to that registry target, drawn on the screen, following the thing as the page
 * moves. The board opens only when there is something NEW to build (a graph, a construction, a
 * derivation, a diagram that is not on the page), and a lesson has the full board. A board never
 * opens with nothing on it. The brain applies the same rule the same way (`board/planner.py`,
 * `choose_presentation`), and the brain's own naming of a surface is a hint, never the decision:
 * every drawn answer used to open the board because the model wrote "plane" out of habit (the
 * owner, 2026-09-05). The learner overrides it all with a word — "board" pushes the ink onto the
 * plane, "here" brings it back onto the screen — and the override wins over everything.
 *
 * The choice has to be made as the FIRST object arrives, not when the plan finishes: the pen starts
 * within a second, and a stroke cannot wait for a `done` frame. So the decision is a small state
 * machine fed one object at a time. It can promote (screen → plane) once, and when it does, the app
 * replays the handful of objects already drawn onto the new surface — they are semantic objects, not
 * pixels, so moving them is exact.
 *
 * **A turn holds two surfaces, not one.** The choice is made per OBJECT, because a single turn
 * genuinely has both halves in it: "this arrow here is the velocity" is a mark about something on
 * the screen, and the derivation that follows is a diagram from scratch. A mark anchored to a
 * registry target or to the region the learner circled always stays on the screen, whatever else
 * the turn does; only the ink that has nothing on the page to hang from moves to a board. Deciding
 * one surface for the whole turn is what put the plane over the film the learner had just circled
 * and left the ring anchored to nothing — the two failures BOARD.md §11 names in one move.
 */

import type { BoardObject } from '@wobo/wobo';

export type Presentation = 'screen' | 'plane' | 'full';

/** More than this many objects is no longer a pointer or one line — it is a board. */
export const SCREEN_OBJECT_LIMIT = 3;

/**
 * Kinds Wobo only ever draws from scratch. One of these is a diagram, not an annotation, so it
 * belongs on a board however few objects arrive with it.
 */
const FROM_SCRATCH = new Set([
  'axis',
  'grid',
  'table',
  'polygon',
  'polyline',
  'curve',
  'ellipse',
  'tex',
  'bond',
  'atom',
  'region',
  'image',
  'slider',
  'toggle',
  'input',
  'drag',
]);

/** True when this object could only live on a board of its own. */
export function needsBoard(object: BoardObject): boolean {
  if (FROM_SCRATCH.has(object.kind)) return true;
  const anchor = 'anchor' in object ? object.anchor : undefined;
  // Board space is a board: there is nothing on the screen for it to hang off.
  return Boolean(anchor && typeof anchor === 'object' && 'board' in anchor);
}

/**
 * True when this object is ABOUT something on the screen — a registry target, or the region the
 * learner circled. Such a mark cannot leave the screen: move it to a board and it is pointing at
 * nothing, and the board is covering the very thing it was pointing at. That is the failure
 * BOARD.md §11 names ("a plane that hides the thing it explains"), and it is exactly what a lesson
 * did to the video case in §5 — a circle drawn round a paused frame was locked onto the full board
 * that covers the film.
 */
export function staysOnScreen(object: BoardObject): boolean {
  const anchor = 'anchor' in object ? object.anchor : undefined;
  if (!anchor || typeof anchor !== 'object') return false;
  return 'target' in anchor || 'focus' in anchor;
}

/** The board object this one hangs off, when it hangs off one — it lives wherever that one lives. */
function ownerOf(object: BoardObject): string | null {
  const anchor = 'anchor' in object ? object.anchor : undefined;
  if (!anchor || typeof anchor !== 'object' || !('object' in anchor)) return null;
  const owner = (anchor as { object?: unknown }).object;
  return typeof owner === 'string' && owner ? owner : null;
}

export interface ChoiceOptions {
  /** The learner said "board" or "here" — this wins over everything. */
  override?: Presentation | null;
  /** Inside a lesson the board is the screen. */
  lesson?: boolean;
}

/**
 * The running choice. Feed it every object as it lands; it answers with the surface in force.
 * `promoted` is true on the single frame where it moved, which is the app's cue to replay.
 */
export class PresentationChoice {
  private surface: Presentation;
  private readonly locked: boolean;
  private readonly lesson: boolean;
  private count = 0;
  /** Objects that had nothing on the page to hang from — only these can call for a board. */
  private needing = 0;
  /** Where each object went, so a mark hung off one follows it. */
  private readonly placed = new Map<string, Presentation>();
  /** The objects that are pinned to the screen — the ones a promotion must leave behind. */
  private readonly pinnedIds = new Set<string>();
  /** True on the offer that moved the board surface; false again on the next. */
  promoted = false;
  /**
   * True when the object just offered is pinned to the screen — it is about something on the page,
   * so no promotion can ever take it to a board. Distinct from "the surface happens to be the
   * screen right now", which is what everything else is doing before the first board arrives.
   */
  pinned = false;

  constructor(opts: ChoiceOptions = {}) {
    this.lesson = Boolean(opts.lesson);
    if (opts.override) {
      this.surface = opts.override;
      this.locked = true;
      return;
    }
    this.surface = this.lesson ? 'full' : 'screen';
    // Only the learner's own word locks the surface. A lesson STARTS on the full board, but a mark
    // about something on the screen still belongs on the screen; the board would only be in the way.
    this.locked = false;
  }

  /** The BOARD surface in force — where ink that needs a board of its own is going. */
  current(): Presentation {
    return this.surface;
  }

  objects(): number {
    return this.count;
  }

  /** How many objects are pinned to the screen: the other half of a two-surface turn. */
  onScreen(): number {
    return this.pinnedIds.size;
  }

  /** One more object has arrived. Returns the surface THIS object belongs on. */
  offer(object: BoardObject): Presentation {
    this.count += 1;
    this.promoted = false;
    this.pinned = false;
    const id = typeof object.id === 'string' ? object.id : '';
    const remember = (surface: Presentation, pinned = false): Presentation => {
      this.pinned = pinned;
      if (id) {
        this.placed.set(id, surface);
        if (pinned) this.pinnedIds.add(id);
      }
      return surface;
    };
    // The learner said "board" or "here": their word is the whole answer.
    if (this.locked) return remember(this.surface);
    // A mark hung off another object lives wherever that object went. Splitting the two would break
    // the anchor: `{object: id}` resolves against the boxes on the SAME surface.
    const owner = ownerOf(object);
    const withOwner = owner ? this.placed.get(owner) : undefined;
    if (owner && withOwner) return remember(withOwner, this.pinnedIds.has(owner));
    // A mark about something on the screen never leaves the screen. On a board it would point at
    // nothing, and the board would be sitting over the very thing it was about.
    if (staysOnScreen(object)) return remember('screen', true);

    this.needing += 1;
    if (this.surface === 'screen' && (needsBoard(object) || this.needing > SCREEN_OBJECT_LIMIT)) {
      this.surface = 'plane';
      this.promoted = true;
    }
    return remember(this.surface);
  }
}

// --- The learner's word --------------------------------------------------------------------------

export interface PresentationWord {
  /** Where Wobo should draw from now on. */
  presentation?: Presentation;
  /** "fresh board" — a new board, not the one Wobo was on. */
  fresh?: boolean;
  /** "wipe the board". */
  wipe?: boolean;
  /** "close the board". */
  dismiss?: boolean;
}

const FRESH = /\b(fresh|new|another|clean|blank)\s+(board|whiteboard|canvas)\b/i;
const WIPE = /\b(wipe|clear|erase|rub\s+out)\s+(the\s+)?(board|whiteboard|canvas)\b/i;
const DISMISS =
  /\b(close|hide|dismiss|put\s+away|get\s+rid\s+of)\s+(the\s+)?(board|whiteboard|canvas)\b/i;
const FULL = /\b(full|whole|big)\s+(board|screen)\b/i;
const BOARD = /\b(on\s+the\s+)?(board|whiteboard)\b/i;
const HERE = /\b(here|on\s+(the\s+)?(screen|page)|right\s+here|in\s+place)\b/i;

/**
 * What the learner just said about the surface, if anything. Order matters: "close the board" is a
 * dismissal, not a summons, and "fresh board" is a new board, not the one already open.
 */
export function presentationWord(text: string): PresentationWord | null {
  const t = text.trim();
  if (!t) return null;
  if (DISMISS.test(t)) return { dismiss: true };
  if (WIPE.test(t)) return { wipe: true };
  if (FRESH.test(t)) return { fresh: true, presentation: 'plane' };
  if (FULL.test(t)) return { presentation: 'full' };
  if (BOARD.test(t)) return { presentation: 'plane' };
  if (HERE.test(t)) return { presentation: 'screen' };
  return null;
}

/** Routes where the board is the screen — a lesson, not an annotation over one. */
export function isLessonRoute(route: string): boolean {
  return route === 'course' || route === 'sandbox';
}

/**
 * Words that are a request to draw. Not every question is a board turn: "what time is my review" is
 * a sentence, and drawing it would be theatre. Wobo draws when the answer has a shape.
 */
const DRAWS =
  /\b(draw|sketch|graph|plot|diagram|derive|derivation|work\s+it\s+out|step\s+by\s+step|prove|construct|balance|free[-\s]?body|number\s+line|label\s+(it|the)|write\s+it\s+out|on\s+the\s+board|show\s+me\s+(how|the\s+working))\b/i;

/**
 * A question asked with a region in hand. Circling something and saying "why?" is not an ordinary
 * question — the learner has already told Wobo what "this" is, and the answer to it is a mark ON
 * the thing they drew around (docs/BOARD.md §5, the video case). It is also the commonest board
 * turn there is, and it needs no subject pipeline: a ring and a written word, anchored to the
 * focus. Without this a lasso followed by "why?" fell through to a paragraph, which is exactly
 * the slideshow BOARD.md §11 warns about.
 */
/** A request to put a mark on a thing: a ring, a circle, an underline, a pointer. */
const MARKS = /\b(ring|circle|mark|highlight|underline|point\s+(at|to))\b/i;

const ASKS_ABOUT_IT =
  /^\s*(why|how|what|explain|tell\s+me|huh|i\s+don'?t\s+(get|understand))\b|\bwhat\s+(is|are|does)\s+(this|that|it)\b|\?\s*$/i;

/**
 * DOES THE ASK ITSELF WANT INK? (the adversary, 2026-09-09, finding 1.)
 *
 * "show me a number line" is `show_me` mode, so the hand took it before anything else could — and
 * a hand can only point at what is already on the page. There is no number line on a course card,
 * so the registry matched whatever it could and Wobo's entire spoken and printed reply was
 * "here: 1meet a square and a cube": no ink, no gateway turn, the number-line pipeline never
 * reached. These words ask to be shown something NEW, which is the board's verb, not the hand's.
 *
 * This reads the WORDS only — no glass, no focus, no mode — because it runs before the hand, and
 * a learner with a region in hand ("show me this bit") is still the hand's, which is why
 * AppRuntime keeps a focus ahead of it.
 */
export function asksForADrawing(text: string): boolean {
  return Boolean(presentationWord(text)?.presentation) || DRAWS.test(text);
}

export interface BoardShape {
  /** True when this turn should stream a plan and use the hand. */
  board: boolean;
  /** The learner's explicit surface, when they named one. */
  override?: Presentation;
  /** They asked for a new board, a wipe, or for it to go away. */
  word?: PresentationWord;
}

/**
 * Is this a turn Wobo should answer by drawing? A word about the surface, a request with a shape, or
 * a mode that draws with something in hand — anything else stays a conversation.
 */
export function boardShapeOf(
  text: string,
  opts: { hasFocus?: boolean; modeDraws?: boolean; namesTarget?: boolean; draw?: boolean } = {},
): BoardShape {
  const word = presentationWord(text);
  if (word?.dismiss || word?.wipe) return { board: false, ...(word ? { word } : {}) };
  const override = word?.presentation;
  const asked = Boolean(override) || DRAWS.test(text);
  // A mode whose answer IS a drawing. Whether this mode can draw on this turn is the caller's to
  // know, not this function's: `modeDraws` in wobo/modes.ts already asks the mode itself, because a
  // mode that needs something in hand cannot draw without it and one that needs nothing can draw
  // with nothing. Demanding a focus here locked out `quiz_me` — the only drawing mode offered with
  // an empty hand — so its card promised the board on every press and never once opened it.
  const byMode = Boolean(opts.modeDraws);
  const aboutFocus = Boolean(opts.hasFocus) && ASKS_ABOUT_IT.test(text);
  // A question about something ALREADY ON THE SCREEN is answered in place, with a ring on it
  // (docs/BOARD.md §5). That is a planner turn too: it streams, and the ink lands on the
  // registered target. "which button starts the course?" used to go to the plain conversation,
  // and the learner got words about a button they were looking at (the 2026-09-05 review).
  const aboutTheScreen =
    Boolean(opts.namesTarget) && (ASKS_ABOUT_IT.test(text) || MARKS.test(text));
  // THE SCREEN PROMISED A DRAWING. Onboarding step three says "I'll draw it" over three sample
  // questions that are plain prose ("Why is the sky blue?"): no draw word, no mode, no target.
  // Read as words alone they went to the conversation and came back as handwriting under a
  // headline that promised ink (wave 23, 2026-09-05). A screen that made the promise asks for
  // the hand outright; the learner's own word about the surface, above, still wins.
  const promised = Boolean(opts.draw);
  return {
    board: asked || byMode || aboutFocus || aboutTheScreen || promised,
    ...(override ? { override } : {}),
    ...(word ? { word } : {}),
  };
}
