'use client';

/**
 * The conductor of a board turn (docs/BOARD.md §4, §5) — the one place the stream, the voice, the
 * surface choice and the interrupt meet.
 *
 * It opens the streamed turn, decides on the first object which surface Wobo is drawing on, keeps the
 * pen and the voice on one clock, and stops both together the instant the learner interrupts. It
 * never holds a key, a model id, or a limit: it sends a context packet through the one door and
 * renders whatever comes back through the grammar, refusing anything the schema does not recognise.
 */

import { BudgetExhaustedError, SignInRequiredError } from '@wobo/sdk';
import {
  type BoardEvent,
  BoardStore,
  boardBook,
  FADE_MS,
  type FocusObject,
  focusRectNow,
  type GlassRelease,
  glassHold,
  pageScroll,
  plane,
  type Rect,
  scrollHold,
  surfaceRegistry,
  warmPen,
} from '@wobo/wobo';
import { type InkFrame, SentenceGate } from './beat';
import { type BoardContext, type BoardDone, streamBoardTurn } from './board-stream';
import { forgetGlass, glassTargets } from './glass';
import { lessonView } from './lesson-view';
import { isLessonRoute, type Presentation, PresentationChoice } from './presentation';
import { sentences, startUtterance, stopSpeaking, type Utterance } from './speech';
import { sameSentence } from './transcript';

/**
 * Ink on the screen. It holds while the question it points at is open, and fades when the learner
 * answers, interrupts, or the next turn begins (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace); a turn
 * that asked nothing lets it linger `LINGER_MS`, then lets it go.
 */
export const screenStore = new BoardStore({ presentation: 'screen' });
/** How long screen ink stays after a turn with no question, before it fades. */
export const LINGER_MS = 4000;
/** A stroke whose plan named no duration: the pen decides from its length, never past this. */
const DEFAULT_STROKE_MS = 900;
/**
 * The one id the instant mark lives under, for the whole turn. The plan's first anchored mark is
 * rewritten to this id, so the ring the learner is already looking at is the ring the plan refines:
 * the pen never puts a second one down beside it (docs/INK-FOUR.md, step 2).
 */
export const INSTANT_ID = 'instant';

/** How long after the last stroke the turn re-reads its own glass, and the longest it will wait. */
const SIGNATURE_SETTLE_GRACE_MS = 260;
const SIGNATURE_SETTLE_MAX_MS = 8000;

/**
 * The check names this turn may no longer sign: every name carried by a mark that is not on the
 * glass. One name is the whole signature, so one missing mark unsigns it everywhere — the same
 * rule `board/stream.py` `_signed` applies to a check that failed anywhere on the turn. A check no
 * mark stands on is the board's, not a mark's, and is never dropped here.
 */
export function unsignedMarks(
  objects: readonly { id: string; check?: string }[],
  onGlass: (id: string) => boolean,
): string[] {
  const lost: string[] = [];
  for (const object of objects) {
    const check = object.check;
    if (!check || lost.includes(check)) continue;
    if (!onGlass(object.id)) lost.push(check);
  }
  return lost;
}

/**
 * Every mark the renderer has actually put in the page, by id — `data-wobo-object` is written as
 * `<id>#<generation>`, and it is the only way to ask the DOM what is really on the glass. Null
 * when there is no document to read (a server render, a test): no evidence is not evidence.
 */
function idsOnGlass(): Set<string> | null {
  const doc = (
    globalThis as { document?: { querySelectorAll?: (s: string) => Iterable<Element> } }
  ).document;
  if (!doc?.querySelectorAll) return null;
  const ids = new Set<string>();
  for (const el of doc.querySelectorAll('[data-wobo-object]')) {
    const raw = el.getAttribute?.('data-wobo-object') ?? '';
    ids.add(raw.split('#')[0] ?? raw);
  }
  return ids;
}

/**
 * A NEW TURN'S MARK IS A NEW MARK (the adversary, 2026-09-09, finding 7).
 *
 * The id above used to be the whole id, every turn. The board store keeps an existing object's
 * place and bumps its GENERATION rather than making a new one, and the renderer keys its nodes on
 * `<id>#<generation>` — so the second turn's instant mark inherited the first turn's node and was
 * never drawn at all. Live at 1440, "draw this for me" recorded `inkObjectsBefore.screen: 1` and
 * a first stroke at 26 ms which was the previous turn's `instant#1` ring still standing. Every
 * turn now mints its own, so a first stroke is always this turn's first stroke.
 */
let instantTurn = 0;
const nextInstantId = (): string => `${INSTANT_ID}-${(instantTurn += 1)}`;
/** How long the local ring takes to draw. Short: it is an aim, not a flourish. */
const INSTANT_STROKE_MS = 420;
/** A breath after the last stroke lands before the glass is let go. */
const STROKE_SETTLE_MS = 80;
/**
 * A stroke that begins within this is already the pen's: the freeze is taken just ahead of the
 * nib, never a moment earlier. A plan spaces its marks across the sentences that name them, so
 * between two of them there is nothing in flight and the page is the learner's.
 */
const STROKE_LEAD_MS = 120;
/**
 * HOW LONG A HANDOVER LIFT LASTS (the adversary, wave 52, finding 2).
 *
 * A third of `FADE_MS`. When the learner asks the next thing, the last turn's ink is lifted — and
 * it used to be lifted as an ordinary fade, `FADE_MS` long, which the new answer begins inside:
 * measured at 1440, Wobo's line is on the glass at 255-306 ms and spoken at 503 ms, and live the
 * first word lands at 433 ms, while the ring is still there at 0.43, 0.19, 0.05 — a mark about the
 * question the learner has already left, standing under the answer to the new one.
 *
 * A lift is not a fade: the mark is not finishing, it is being taken away, and it is taken away
 * before Wobo says anything. A third of the fade is enough for the eye to read it as going rather
 * than as a blink, and it is inside every first word measured, keyless or live, by 95 ms or more.
 * An ordinary end-of-turn fade is untouched — that one has nothing coming after it.
 */
const LIFT_MIN_MS = 160;

/** Is any of Wobo's ink still on the screen, holding for an answer or lingering? */
export function screenInkHolding(): boolean {
  return screenStore.snapshot().some((s) => !s.removed && s.fadingAt === undefined);
}

/** Do the lines said so far already end on this question? Then the ask frame repeats it. */
function alreadyEndsWith(said: readonly string[], prompt: string): boolean {
  const flat = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const wanted = flat(prompt);
  return wanted.length > 0 && flat(said.join(' ')).endsWith(wanted);
}
/** The full board inside a lesson. One per session; a fresh lesson wipes it. */
export const lessonStore = new BoardStore({ presentation: 'full' });

export interface BoardTurnState {
  /** True while a plan is streaming or the pen is still drawing it. */
  active: boolean;
  /** Where Wobo is drawing right now. */
  presentation: Presentation;
  /** The plane board Wobo is on, when the plane is the surface. */
  boardId: string | null;
  /** What Wobo asked at the end of the turn, if anything. */
  ask: { prompt: string; targets: string[] } | null;
  /** The object the pen stopped on when the learner cut Wobo off. */
  interruptedAt: string | null;
  /** The checks the brain reports it passed before drawing — QA and the inspector read these. */
  verified: string[];
  /** How many objects landed. */
  objects: number;
}

const RESTING: BoardTurnState = {
  active: false,
  presentation: 'screen',
  boardId: null,
  ask: null,
  interruptedAt: null,
  verified: [],
  objects: 0,
};

export interface RunBoardTurn {
  gatewayUrl: string;
  /** The context packet payload, exactly as the ordinary turn sends it. */
  payload: Record<string, unknown>;
  route: string;
  /** The learner's word: "board", "here", "the full board". */
  override?: Presentation | null;
  /**
   * "Fresh board": the plane, when it opens, is a new board rather than the last one. It still
   * opens only on the first object that needs it (docs/INK-FREEZE-PLAN-TRACE.md §3, Plan: a plan
   * never opens an empty plane), so the word alone puts nothing over the page.
   */
  fresh?: boolean;
  /**
   * The same frames at another door (board-stream.ts): the doubt solver's answer streams from
   * `POST /v1/doubt/{id}/answer` with the learner's corrections as the body. Both optional.
   */
  endpoint?: string;
  body?: Record<string, unknown>;
  /** Where the plane slides from — Wobo's orb. */
  origin?: { x: number; y: number };
  /** The lesson or topic the board belongs to; it names the export and the save. */
  title?: string;
  /**
   * Wobo's spoken line, handed back so the transcript carries what Wobo said, with the moment on
   * the utterance clock it is spoken (`t`) and how long it takes, as the wire carried them.
   */
  onSay?: (text: string, t?: number, durMs?: number) => void;
  /** An action frame — the caller runs it through the permission ladder. */
  onAction?: (action: unknown) => void;
  /** A component or visualisation the ordinary turn would have attached. */
  onCard?: (card: unknown) => void;
  /** Wobo asked the learner something and is waiting for them. */
  onAsk?: (prompt: string, targets: string[]) => void;
  /**
   * THE INSTANT MARK (docs/INK-FOUR.md; resolved by wobo/instant.ts before this is called).
   *
   * The learner's question named something the content model declared, so the target is known
   * without asking anyone: the pen starts on it now, while the request is still in flight, and the
   * plan refines it when it lands. Absent, nothing is drawn early and the turn is as it was.
   */
  instant?: {
    target: string;
    kind: 'ring' | 'underline';
    /** What the mark means, from the concept core. */
    words: string;
    /**
     * The true sentence the architect wrote for this thing, when the level's own store holds one
     * (docs/INK-FOUR.md, step 3: the words come from the core). Spoken as the turn's FIRST
     * sentence, on the same voice as the rest — never a second voice beside the model's, and a
     * plan sentence that repeats it is dropped rather than said twice.
     */
    say?: string;
    /**
     * THE REST OF WHAT ONE GESTURE CROSSED (the adversary, wave 47, finding 3). A lasso can land on
     * two lines of the outline; each gets its own mark now, and the whole group moves aside
     * together if the plan turns out to mean something else.
     */
    also?: { target: string; kind: 'ring' | 'underline'; words: string }[];
  } | null;
}

export interface BoardTurnOutcome {
  /** Everything Wobo said, in order — one line for the transcript. */
  said: string;
  /**
   * THE TURN ENDED OF ITS OWN ACCORD — nothing of the learner's cut it short (the adversary,
   * wave 53; docs/INK-FOUR.md, experience).
   *
   * It used to read "a `done` frame landed", and its one caller asks a different question:
   * `AppRuntime.tsx` says the honest line — "That one did not come out." — for a turn that came
   * back with no shape, "unless the learner cut Wobo off". A stream that opens, carries nothing
   * and closes without `done` is exactly that turn, and `streamBoardTurn` RESOLVES on it rather
   * than throwing, so the caller's catch never ran either: the learner was left with their own
   * question, an empty page, and nothing said at all. One keyless drawing turn in sixty-five did
   * this under contention, and it is the failure no probe catches, because there is nothing to
   * look at.
   *
   * So: true when the wire ran to its end, however badly, and false only when the learner
   * interrupted (a thrown network loss reaches the caller as a throw, and is refused in words).
   */
  completed: boolean;
  presentation: Presentation;
  objects: number;
  interruptedAt: string | null;
  ask: { prompt: string; targets: string[] } | null;
}

class BoardConductor {
  private state: BoardTurnState = RESTING;
  private readonly listeners = new Set<() => void>();
  /** Told whenever the pen lifts and the glass is let go: an interruption, or the turn's end. */
  private readonly releaseListeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private utterance: Utterance | null = null;
  /** The hand's gate on the voice: a mark waits for the sentence that names it (wobo/beat.ts). */
  private gate: SentenceGate | null = null;
  /** True while this turn holds the glass (its ink is on the screen). */
  private glassHeld = false;
  /**
   * True from this turn's first screen stroke until the turn ends or is cut: while it stands, the
   * strokes govern the glass — they take it as each one begins and give it back as it lands.
   */
  private strokesGovern = false;
  /** The next moment the glass changes hands: the end of the stroke in flight, or the next one's start. */
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Which run this is, and which run was cut, so a cut turn never prints what it did not say. */
  private runSeq = 0;
  private interruptedRun = -1;
  /**
   * The board the learner asked for by name ("board"), not yet open: the plane never opens before
   * its first object exists, so the summons waits for the first mark that needs it.
   */
  private pendingBoard: Presentation | null = null;
  /** Where the plane slides from and what it is called, for a summons made mid-turn. */
  private origin: { x: number; y: number } | undefined;
  private title: string | undefined;
  /** The next summons opens a fresh board (the learner said so). */
  private fresh = false;
  /**
   * Every ink frame of the running turn with the surface it landed on, so a promotion can replay
   * exactly the ink that needs a board and leave the screen's own marks where they are pointing.
   */
  private inked: { event: BoardEvent; pinned: boolean }[] = [];
  private choice = new PresentationChoice();
  /**
   * The instant mark's aim, while it is still the only thing on the glass. Cleared the moment the
   * plan's first anchored mark has reconciled with it, so exactly one mark ever moves, once.
   */
  private instantTarget: string | null = null;
  private instantKind: 'ring' | 'underline' | null = null;
  /** The turn has been told it is over; the pen may still be finishing what it was given. */
  private doneSeen = false;
  /** When the glass is next re-read for signatures (`settleSignatures`). */
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** The id this turn's instant mark lives under; the plan's first anchored mark is rewritten to it. */
  private instantId: string | null = null;
  /**
   * The rest of one gesture's marks — the second line a lasso crossed — by store id, so the plan's
   * correction takes the whole guess off the glass rather than leaving half of it beside the answer.
   */
  private instantAlso: { id: string; target: string; kind: 'ring' | 'underline' }[] = [];
  /** True once the last turn's ink has been taken off the glass for this one. */
  private handedOver = false;
  /** The BOARD surface's store. Screen-anchored marks always go to `screenStore` instead. */
  private store: BoardStore = screenStore;
  /** The instant the voice zeroed the clock, so a promoted board keeps Wobo's timing. */
  private utteranceAt: number | null = null;
  private lastEventId: string | undefined;

  constructor() {
    // The glass let go under the LEARNER'S HAND (docs/INK-FREEZE-PLAN-TRACE.md §3): Escape, a tap
    // on the glass, or their voice releases everything in one tick, and the pen lifts on that
    // same tick. The hold's own release is the one signal; nothing else has to listen for taps.
    //
    // THE CAP IS NOT THE LEARNER (the adversary, 2026-09-09, findings 3 and 10). Wave 40's flat
    // 6 s cap expired at 6032 ms — before the wire's first byte, which lives at 6.0-8.5 s — and
    // this listener read that as a barge-in and aborted the turn. Every live course turn came back
    // with an empty transcript and no ink while the voice was billed for words Wobo never wrote.
    // A cap gives the PAGE back; it never takes the ANSWER away.
    glassHold.subscribe((hold) => {
      if (hold.held || hold.released === null) return;
      if (hold.released === 'end' || hold.released === 'interrupt' || hold.released === 'cap') {
        return;
      }
      if (this.state.active || this.utterance) this.interrupt();
    });
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = (): BoardTurnState => this.state;

  /** Be told when the pen lifts and the glass is released, in the same tick it happens. */
  onRelease = (l: () => void): (() => void) => {
    this.releaseListeners.add(l);
    return () => {
      this.releaseListeners.delete(l);
    };
  };

  private set(patch: Partial<BoardTurnState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** The store the ink is currently landing in — the stage reads this to know what to mount. */
  current(): BoardStore {
    return this.store;
  }

  /**
   * THE BOARD IN FRONT OF THE LEARNER — what "wipe the board" wipes, what "save to notes" saves,
   * and what the next turn's packet reports as drawn.
   *
   * It is deliberately NOT read off `state.presentation`. That field is re-set by `open()` on every
   * turn, so between turns it describes the LAST turn's surface; the plane, once summoned, stays
   * open until something closes it. A board turn followed by a screen-anchored one therefore left
   * this pointing at `screenStore` while the plane sat there full of ink, and "wipe the board"
   * rubbed out a screen mark and told the learner the board was clean (2026-09-05).
   *
   * So it asks the surfaces themselves, in the order they sit in front of the learner: the board
   * this turn is inking on, then the lesson's own full board while a lesson is on screen, then the
   * plane while it is open, and the screen when there is no board at all.
   */
  boardStore(): BoardStore {
    // Mid-turn the surface was chosen object by object, and that choice is the truest answer.
    if (this.state.active && this.store !== screenStore) return this.store;
    // A lesson screen is mounted (Course.tsx hands its canvas to `lessonView`): inside a lesson the
    // board is the lesson's own, whatever else a previous chat turn left open behind it.
    if (lessonView.get().host !== null) return lessonStore;
    const { open, boardId } = plane.get();
    if (open) return boardBook.get(boardId);
    return screenStore;
  }

  /** The context the next turn carries about the board: what is on it, and where Wobo was cut off. */
  boardContext(route: string, override?: Presentation | null): BoardContext {
    // Ink already on its way out is not "drawn": the brain would be told about marks that are
    // fading from the last turn and refuse to draw them again.
    const drawn = this.boardStore()
      .snapshot()
      .filter((s) => s.fadingAt === undefined)
      .map((s) => s.object.id);
    return {
      ...(override ? { presentation: override } : {}),
      ...(this.state.interruptedAt ? { interrupted_at: this.state.interruptedAt } : {}),
      ...(drawn.length > 0 ? { drawn: drawn.slice(-40) } : {}),
      ...(isLessonRoute(route) ? { lesson: true } : {}),
    };
  }

  /**
   * The learner cut Wobo off (a tap, a key, a word). The pen lifts where it is and the voice stops
   * on the same beat; what is already drawn stays, and the brain is told which object Wobo was on.
   */
  interrupt(): string | null {
    if (!this.state.active && !this.utterance) return this.state.interruptedAt;
    // One tick, all of it (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace): the marks still waiting on a
    // sentence never land, the pen lifts where it is on both surfaces, the screen's ink fades, the
    // voice stops, the stream is cut, and the glass is let go. A board keeps what it holds.
    this.gate?.drop();
    this.interruptedRun = this.runSeq;
    const onScreen = screenStore.interrupt();
    const at = this.store === screenStore ? onScreen : (this.store.interrupt() ?? onScreen);
    this.releaseScreen();
    this.utterance?.stop();
    this.utterance = null;
    stopSpeaking();
    this.controller?.abort();
    this.controller = null;
    this.set({ active: false, interruptedAt: at });
    this.strokesGovern = false;
    this.releaseGlass('interrupt');
    return at;
  }

  /**
   * The learner went somewhere else. A route change during a trace is an interruption; and even
   * between turns the ink about the page they left goes with the page, never drawn over the next
   * one (the scorecard's 04-navigate-away-and-back).
   */
  routeChanged(_route: string): void {
    if (this.state.active || this.utterance) {
      this.interrupt();
      return;
    }
    const held = this.glassHeld || scrollHold.held;
    this.releaseScreen();
    this.strokesGovern = false;
    if (held) this.releaseGlass('interrupt');
    // The page the read was of is gone: the next reader (a lasso, a turn) takes a fresh one.
    forgetGlass();
  }

  /**
   * The learner answered, or asked something else: the ink that was holding for their answer is
   * let go. Every turn calls this as it opens; a plain turn that draws nothing calls it too.
   */
  answered(): void {
    this.liftForTheAsk();
  }

  /** Let the screen's ink go, now or at `at`, and forget it once its fade has finished. */
  private releaseScreen(at: number = screenStore.time()): void {
    screenStore.release(at);
    if (typeof setTimeout !== 'function') return;
    const wait = Math.max(0, at - screenStore.time()) + FADE_MS + 40;
    setTimeout(() => screenStore.sweep(), wait);
  }

  /**
   * THE LAST TURN'S INK IS NEVER ON THE GLASS BESIDE THIS TURN'S (the adversary, wave 49,
   * finding 7).
   *
   * The lift already happens at the ask — measured at 1440 on the course page, the previous ring
   * begins to fade within 40 ms of Enter. But a fade is 480 ms, and this turn's first stroke is
   * owed inside 700 (docs/INK-FOUR.md, timing): on 'draw this for me' the old ring was still at
   * 0.69 opacity 169 ms in, and on a slower machine or a faster plan the learner has two of Wobo's
   * rings on the page at once, one of them about the question they have already left.
   *
   * So the fade is a handover, not an overlap: the moment THIS turn puts anything on the screen,
   * whatever is still fading from the last one goes. Nothing pops — the eye is on the new stroke,
   * which is exactly the moment the old mark has stopped meaning anything. A turn that draws
   * nothing leaves the fade alone and it finishes in its own time.
   */
  private handOver(): void {
    if (this.handedOver) return;
    this.handedOver = true;
    for (const s of screenStore.snapshot()) {
      if (s.removed || s.fadingAt === undefined) continue;
      screenStore.ink({ id: s.object.id, kind: 'remove' } as never);
    }
  }

  /**
   * THE LEARNER ASKED SOMETHING ELSE: LIFT WHAT THE LAST ANSWER LEFT (the adversary, wave 52,
   * finding 2; docs/INK-FREEZE-PLAN-TRACE.md §3, Trace: ink "fades when the learner answers,
   * interrupts, or the next turn begins").
   *
   * `handOver` is the whole answer for a turn that DRAWS: the first stroke takes the last turn's
   * ink with it. But most turns do not draw. On "show me why" at 1440 no conductor runs at all —
   * it is a plain spoken answer — and the ring from "circle the hypotenuse" was left to an
   * ordinary `FADE_MS` fade that the new answer begins inside: 0.43 when Wobo's line appears at
   * 255 ms, 0.19 at 402, gone at 517, with the voice starting at 503. Live the same shape, 0.05 at
   * 433 ms. The learner hears a new answer over the mark of the question they already left.
   *
   * So the lift is a lift: the ink fades for `LIFT_MIN_MS` and is then off the glass, well before
   * anything of the new turn is said. Only what this handover itself lifted goes — ink that begins
   * fading later (this turn's own, at its end) fades in its own time, which is what a fade is for.
   */
  private liftForTheAsk(): void {
    const at = this.now();
    this.releaseScreen(at);
    if (typeof setTimeout !== 'function') return;
    setTimeout(() => {
      for (const s of screenStore.snapshot()) {
        if (s.removed || s.fadingAt === undefined || s.fadingAt > at) continue;
        screenStore.ink({ id: s.object.id, kind: 'remove' } as never);
      }
    }, LIFT_MIN_MS);
  }

  /**
   * The pen is on the glass: hold it still for the turn (the freeze; glass/hold.ts).
   *
   * A STROKE IS THE ONLY THING THAT BUYS THE PAGE (docs/INK-FOUR.md, timing; the adversary,
   * 2026-09-09, finding 4). The hold taken at the ask is for the READ and lets go after a beat;
   * `drawing()` is what widens it to the idle window, so a turn that talks and never draws hands
   * the page straight back, and ink that arrives twelve seconds later takes the glass for itself.
   * `hold` is idempotent and this is called as every mark lands, so a late first stroke on a
   * released glass takes it again here.
   */
  private holdGlass(): void {
    glassHold.hold('turn');
    glassHold.drawing();
    this.glassHeld = true;
  }

  /**
   * A SIGN THAT THIS TURN IS STILL ALIVE — a frame off the wire, a sentence begun, a mark landing.
   *
   * The hold's window is silence (glass/hold.ts), so every one of these restarts it. Without this
   * the window was a wall clock started before the request even left, and a gateway that took
   * seven seconds to speak lost its whole answer to the cap (the adversary, 2026-09-09).
   */
  private stillAlive(): void {
    glassHold.alive();
  }

  /**
   * THE GLASS FOLLOWS THE PEN (docs/INK-FREEZE-PLAN-TRACE.md §3; docs/INK-FOUR.md, timing: "the
   * page is held still only while a stroke is in flight"; the adversary, 2026-09-08 and wave 52,
   * finding 1).
   *
   * The freeze is for the tracing, not the talking. The glass is taken just ahead of each stroke
   * and given back the instant it lands — mid-turn, between two sentences, while Wobo is still
   * speaking — so wave 33's best moment is possible inside a turn: a released scroll carries the
   * ring with it, because every mark re-measures its own live box.
   *
   * THE SCHEDULE IS NOT THE PEN (wave 52, finding 1). This used to schedule one release at the end
   * of the LAST stroke the store knew about, and every mark of a plan lands in the store the
   * moment its sentence begins while the pen reaches it up to `SENTENCE_REACH_MS` later. So a plan
   * whose marks are spaced across its sentences held the page from the first landing to the last
   * scheduled stroke's end, with nothing being drawn for most of it: live at 1440 on "circle the
   * hypotenuse" the glass was taken again when the plan arrived at 5584 ms and let go by the CAP
   * at 11592 — six frozen seconds in the middle of an answer, and the same shape on world sync-1
   * (hold@7503, release:cap@13510). Keyless it never showed, because a keyless plan's strokes are
   * all in flight at once and every hold released on `end` inside 138 ms.
   *
   * Now this is a tick, not a countdown: it looks at what the pen is doing NOW, holds or lets go
   * accordingly, and comes back at the next moment either could change — the end of the stroke in
   * flight, or a lead ahead of the next one's start. Ink already fading is on its way out and buys
   * nothing. Returns true while the strokes still have a claim on the glass.
   */
  private traceGlass(): boolean {
    if (!this.strokesGovern) return false;
    if (this.releaseTimer !== null) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    const now = this.now();
    /** The end of the last stroke that is in flight right now (or about to be). */
    let flying = 0;
    /** The start of the nearest stroke the pen has not reached yet. */
    let next = Number.POSITIVE_INFINITY;
    for (const s of screenStore.snapshot()) {
      if (s.removed) continue;
      if (s.fadingAt !== undefined && s.fadingAt <= now) continue;
      const end = s.startAt + (s.durMs ?? DEFAULT_STROKE_MS);
      if (s.startAt <= now + STROKE_LEAD_MS) {
        if (end > now) flying = Math.max(flying, end);
      } else {
        next = Math.min(next, s.startAt);
      }
    }
    const at = (when: number) => {
      if (typeof setTimeout !== 'function') return;
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = null;
        this.traceGlass();
      }, Math.max(0, when));
    };
    if (flying > now) {
      if (!this.glassHeld) this.holdGlass();
      at(flying - now + STROKE_SETTLE_MS);
      return true;
    }
    if (this.glassHeld) this.releaseGlass('end');
    if (next === Number.POSITIVE_INFINITY) {
      this.strokesGovern = false;
      return false;
    }
    // The page is the learner's until the pen reaches the next mark, and then it is the pen's.
    at(next - STROKE_LEAD_MS - now);
    return true;
  }

  /**
   * The turn is over: the glass goes back, unless a stroke of it is still in flight or still owed
   * a moment on the clock — those keep it for exactly as long as they are drawing.
   */
  private endGlass(): void {
    if (this.traceGlass()) return;
    this.strokesGovern = false;
    this.releaseGlass('end');
  }

  /** Let the glass go: the turn's hold, any stroke's hold, and whoever is waiting to hear it. */
  private releaseGlass(why: GlassRelease): void {
    if (this.releaseTimer !== null) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    this.glassHeld = false;
    glassHold.release(why);
    scrollHold.releaseAll();
    for (const l of [...this.releaseListeners]) l();
  }

  /** A new turn is beginning: nothing of the last one is left mid-air. */
  private open(
    route: string,
    override: Presentation | null | undefined,
    title?: string,
    origin?: { x: number; y: number },
    fresh = false,
  ): void {
    this.controller?.abort();
    this.gate?.drop();
    this.inked = [];
    this.lastEventId = undefined;
    this.utteranceAt = null;
    // The last turn's strokes no longer govern the glass; this turn's will, from its first mark.
    this.strokesGovern = false;
    if (this.releaseTimer !== null) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    // The pen's audio opens now, while the brain is being waited on, never on the first stroke.
    warmPen();
    this.origin = origin;
    this.title = title;
    this.fresh = fresh;
    this.instantTarget = null;
    this.instantKind = null;
    this.instantId = null;
    this.instantAlso = [];
    this.doneSeen = false;
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.handedOver = false;
    this.choice = new PresentationChoice({
      ...(override ? { override } : {}),
      lesson: isLessonRoute(route),
    });
    const presentation = this.choice.current();
    // The plane never opens before its first object exists: "board" is remembered, and the
    // summons waits for the first mark that needs a board (`land`). Inside a lesson the full board
    // is a store, not a door; it shows itself only once it holds ink.
    this.pendingBoard = presentation === 'plane' ? 'plane' : null;
    this.store = presentation === 'full' ? lessonStore : screenStore;
    // The last turn's ink was holding for an answer, and this turn is the answer: it is lifted
    // now, under the new marks rather than before them. The log is bounded, so nothing accumulates.
    this.liftForTheAsk();
    this.set({
      active: true,
      presentation: presentation === 'plane' ? 'screen' : presentation,
      boardId: null,
      ask: null,
      interruptedAt: null,
      verified: [],
      objects: 0,
    });
  }

  /**
   * THE INSTANT MARK, PUT DOWN NOW (docs/INK-FOUR.md, step 1).
   *
   * The learner's words named something the content model declared, so the target is already known
   * and the pen does not wait for anyone: the ring lands on the glass while the request is still in
   * flight. It is ordinary ink under one reserved id, so everything that governs ink governs it —
   * the hold, the release, the fade, the interrupt, the drift-free re-measure on a scroll.
   */
  private startInstant(mark: NonNullable<RunBoardTurn['instant']>): void {
    this.instantTarget = mark.target;
    this.instantKind = mark.kind;
    this.instantId = nextInstantId();
    this.instantAlso = (mark.also ?? []).map((m, i) => ({
      id: `${this.instantId as string}b${i + 1}`,
      target: m.target,
      kind: m.kind,
    }));
    const objectFor = (id: string, m: { target: string; kind: string; words?: string }) => ({
      id,
      kind: m.kind,
      anchor: { target: m.target },
      ...(m.words ? { words: m.words } : {}),
      t: { start: 0, dur: INSTANT_STROKE_MS },
    });
    this.handOver();
    screenStore.beginUtterance(screenStore.time());
    screenStore.applyEvent({
      type: 'ink',
      t: 0,
      object: objectFor(this.instantId, mark),
    } as BoardEvent);
    (mark.also ?? []).forEach((m, i) => {
      const id = this.instantAlso[i]?.id;
      if (!id) return;
      screenStore.applyEvent({ type: 'ink', t: 0, object: objectFor(id, m) } as BoardEvent);
    });
    this.strokesGovern = true;
    this.set({ objects: Math.max(this.state.objects, 1 + this.instantAlso.length) });
    this.traceGlass();
  }

  /**
   * THE MODEL REFINES, IT DOES NOT GATE (docs/INK-FOUR.md, step 2).
   *
   * The plan's first mark that anchors to something on the glass is the one that answers the aim
   * the client took. If it names the same thing the same way, it is already drawn and the frame is
   * swallowed — never a second ring beside the first. If it names something else, it takes the
   * instant mark's own id, so the ONE ring moves there and goes again from the new box, the way a
   * teacher corrects a stroke. Everything after that is ordinary ink.
   *
   * Returns the frame to apply, or null when there is nothing left to do.
   */
  private reconcileInstant(event: InkFrame): InkFrame | null {
    if (this.instantTarget === null) return event;
    const object = event.object as { id?: unknown; kind?: unknown; anchor?: { target?: unknown } };
    const target = object?.anchor?.target;
    if (typeof target !== 'string') return event;
    const wasTarget = this.instantTarget;
    const wasKind = this.instantKind;
    const wasId = this.instantId ?? INSTANT_ID;
    const also = this.instantAlso;
    this.instantTarget = null;
    this.instantKind = null;
    this.instantId = null;
    this.instantAlso = [];
    // The plan agrees, in the same hand: the mark the learner is looking at IS the plan's mark.
    // A gesture's OTHER marks count as agreement too — the learner circled those lines, and the
    // plan naming one of them is the plan meeting the gesture, not overruling it.
    if (target === wasTarget && object.kind === wasKind) return null;
    if (also.some((m) => m.target === target && m.kind === object.kind)) return null;
    // The plan means something else. The whole guess goes, in one beat, and the one mark that
    // remains is the plan's own — the way a teacher wipes a stroke and draws the right one.
    for (const m of also) screenStore.ink({ id: m.id, kind: 'remove' } as never);
    return { ...event, object: { ...(event.object as object), id: wasId } } as InkFrame;
  }

  /**
   * An ink frame's moment has come (the sentence that names it has begun, or it belongs to none):
   * choose its surface, open a board for it if it needs one, and put it down at `at`.
   */
  private land(event: InkFrame, at: number): void {
    const reconciled = this.reconcileInstant(event);
    if (reconciled === null) return;
    event = reconciled;
    // Ink that arrives after `done` pushes the signature settle back behind itself.
    const stroke = (event.object as { t?: { dur?: number } } | undefined)?.t?.dur;
    this.scheduleSettle(typeof stroke === 'number' ? stroke : 0);
    let surface = this.choice.offer(event.object as never);
    const pinned = this.choice.pinned;
    // A DRAWING NEVER REPLACES THE PAGE A MARK IS ABOUT (the adversary's finding 6, the plane
    // half). Inside a lesson the board surface starts as the lesson's FULL board, which takes the
    // page's place: live, "circle the hypotenuse" ringed the square on the hypotenuse and then the
    // full board wiped the triangle out from under the ring and filled the card with a y = x^2
    // graph. Once this turn has marked the page, ink built from scratch floats OVER that page on
    // the plane instead, so the ring and the thing it rings are both still there.
    const keepsThePage = surface === 'full' && !pinned && this.choice.onScreen() > 0;
    if (keepsThePage) surface = 'plane';
    // A promotion moves the BOARD surface and replays the ink that needs one; the marks pinned to
    // the screen stay on the screen, pointing at what they are about. The board the learner asked
    // for by name opens here too, on its first object and not before.
    const summons =
      this.pendingBoard !== null && !pinned && surface !== 'screen' && this.store === screenStore;
    if (this.choice.promoted || summons || (keepsThePage && this.store === lessonStore)) {
      this.pendingBoard = null;
      this.promote(surface, this.origin, this.title);
    }
    // The store measures `t.start` from the utterance's zero; the gate answers in clock time.
    const zero = this.utteranceAt ?? screenStore.time();
    const object = event.object as { t?: Record<string, unknown> };
    const timed = {
      ...event,
      object: { ...object, t: { ...(object.t ?? {}), start: Math.max(0, at - zero) } },
    } as InkFrame;
    this.inked.push({ event: timed, pinned });
    const store = pinned || surface === 'screen' ? screenStore : this.store;
    // Whatever surface this turn draws on, the last turn's ink on the PAGE has handed over: at
    // 1440 the plane is a panel beside the page, so a board turn used to leave the previous ring
    // standing on the very page the board is about.
    this.handOver();
    store.applyEvent(timed);
    this.stillAlive();
    if (store === screenStore) this.strokesGovern = true;
    this.set({ objects: this.choice.objects() });
    this.traceGlass();
  }

  private storeFor(presentation: Presentation, title?: string): BoardStore {
    if (presentation === 'full') return lessonStore;
    if (presentation === 'plane') {
      const id = plane.summon({ ...(title ? { title } : {}) });
      return boardBook.get(id);
    }
    return screenStore;
  }

  /** The store's clock, as the gate and the stores read it. */
  private now(): number {
    return screenStore.time();
  }

  /**
   * The surface changed under a running plan: bring what is already drawn with Wobo. The objects are
   * semantic, so moving them is exact — nothing is re-rendered from pixels.
   */
  private promote(to: Presentation, origin?: { x: number; y: number }, title?: string): void {
    const summons = { ...(origin ? { origin } : {}), ...(title ? { title } : {}) };
    let id: string | null = null;
    if (to === 'plane') {
      // A fresh board is summoned as one; the word was kept until there was ink to put on it.
      id = this.fresh
        ? plane.summon({ ...summons, boardId: boardBook.fresh() })
        : plane.summon(summons);
      this.fresh = false;
    }
    const next = to === 'plane' && id ? boardBook.get(id) : this.storeFor(to, title);
    const previous = this.store;
    if (next === previous) return;
    next.reset();
    next.beginUtterance(this.utteranceAt ?? previous.time());
    // Only the ink that needs a board travels. A mark about something on the screen stays where it
    // is pointing: moving it would leave it pointing at nothing, under a board sitting over the
    // very thing it was about (docs/BOARD.md §11).
    const moving = this.inked.filter((entry) => !entry.pinned);
    for (const entry of moving) next.applyEvent(entry.event);
    // The screen keeps its own marks; take back only what has just left it.
    if (previous === screenStore) {
      for (const entry of moving) {
        const objectId = inkedObjectId(entry.event);
        if (objectId) screenStore.ink({ id: objectId, kind: 'remove' } as never);
      }
    }
    this.store = next;
    this.set({ presentation: to, boardId: id });
  }

  /**
   * Run one board turn. Resolves when the stream closes, the plan is drawn, or the learner cuts Wobo
   * off — whichever comes first.
   */
  async run(options: RunBoardTurn): Promise<BoardTurnOutcome> {
    const { gatewayUrl, payload, route, override, origin, title } = options;
    // Read before `open` clears it: where Wobo was cut off has to reach the wire, and reading it
    // after the reset sent every resumed turn back to the top (the scorecard's robust-timing-8).
    const board = this.boardContext(route, override);
    this.open(route, override, title, origin, options.fresh === true);
    const token = ++this.runSeq;
    // THE FIRST STROKE, BEFORE THE REQUEST LEAVES (docs/INK-FOUR.md). Everything below this line
    // waits on a model; this line does not. `open()` has just cleared the glass of the last turn's
    // ink, so the mark lands on a clean page and holds it still while it draws.
    if (options.instant) {
      this.startInstant(options.instant);
      // AND THE BRAIN IS TOLD IT IS THERE. `board.drawn` is the last turn's ids and was read a
      // line ago, before this pen moved; this is what THIS turn has already put on the glass, in
      // the words it carries. Without it the brain plans against a board it believes is empty:
      // live at 1440 "circle the hypotenuse" rang the square on the hypotenuse at 158 ms and then
      // refused both of the model's sentences for having no mark, so the ring stood there for the
      // whole turn with nothing said about it (the adversary, wave 42). The gateway's half of the
      // law is `board/stream.py`, "nothing stands on the glass unspoken".
      board.standing = [
        {
          id: this.instantId ?? INSTANT_ID,
          kind: options.instant.kind,
          anchor: { target: options.instant.target },
          ...(options.instant.words ? { words: options.instant.words } : {}),
        },
        ...this.instantAlso.map((m, i) => ({
          id: m.id,
          kind: m.kind,
          anchor: { target: m.target },
          ...(options.instant?.also?.[i]?.words
            ? { words: options.instant.also[i]?.words as string }
            : {}),
        })),
      ];
    }
    const controller = new AbortController();
    this.controller = controller;
    const said: string[] = [];
    /** The say frames as the wire delivered them, for the ask that repeats the last of them. */
    const wired: string[] = [];
    /** The core's own opening sentence, if this turn had one: the model never repeats it. */
    const opening = options.instant?.say?.trim() || null;
    let openingSpoken = false;
    /**
     * The transcript reads what was spoken (docs/INK-FREEZE-PLAN-TRACE.md §3): one beat per
     * sentence queued to the voice, surfaced to the caller as the voice begins it, never as the
     * frame arrives. After Escape the lines the voice never reached are not printed.
     */
    const beats: { surface: () => void; done: boolean }[] = [];
    const surfaceUpTo = (index: number) => {
      for (let i = 0; i <= index && i < beats.length; i += 1) {
        const beat = beats[i];
        if (beat && !beat.done) {
          beat.done = true;
          beat.surface();
        }
      }
    };
    // The hand waits on the voice: a mark lands as the sentence that names it begins, never after
    // the sentence ends (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace). Ink with no sentence before it
    // lands at once on the utterance clock.
    const gate = new SentenceGate({
      now: () => this.now(),
      apply: (event, at) => this.land(event, at),
    });
    this.gate = gate;
    // speech.tsx owns the utterance clock: it zeroes the board the moment the performance opens, so
    // every `t.start` in the plan is measured from Wobo first breath, and the pen leads the voice by
    // exactly the time Wobo first syllable takes to arrive — a hand's anticipation, not a lag.
    const utterance = startUtterance(
      () => ({
        // Both surfaces are on one clock: every `t.start` in the plan is measured from Wobo first
        // breath whether the ink lands on the screen or on the board.
        beginUtterance: (at?: number) => {
          const zero = at ?? this.store.time();
          this.utteranceAt = zero;
          this.store.beginUtterance(zero);
          if (this.store !== screenStore) screenStore.beginUtterance(zero);
        },
      }),
      {
        // The sentence's own length rides with the beat: it is the rope the voice is given before
        // the hand goes on without it (wobo/beat.ts, "a mark never waits on a sentence that will
        // never come"). speech.tsx has it from the synthesis and had nowhere to put it until now.
        onSentence: (index, voicedMs) => {
          gate.voiceStarted(index, voicedMs);
          surfaceUpTo(index);
        },
      },
    );
    this.utterance = utterance;

    const handlers = {
      onSay: (text: string, t?: number, durMs?: number) => {
        this.stillAlive();
        const parts = sentences(text);
        if (parts.length === 0) return;
        // The core already said this, before the model did. One voice, once: the first time
        // through is the core's own sentence, and every later repeat of it is dropped.
        if (opening !== null && sameSentence(text, opening)) {
          if (openingSpoken) return;
          openingSpoken = true;
        }
        wired.push(text);
        for (const part of parts) {
          beats.push({
            done: false,
            surface: () => {
              said.push(part);
              options.onSay?.(part, t, durMs);
            },
          });
        }
        gate.say(text);
        utterance.say(text);
      },
      onInk: (event: BoardEvent & { type: 'ink' }) => {
        this.stillAlive();
        gate.ink(event);
      },
      onAction: (action: unknown) => {
        this.stillAlive();
        options.onAction?.(action);
      },
      onAsk: (prompt: string, targets: string[]) => {
        this.stillAlive();
        this.store.applyEvent({ type: 'ask', prompt, targets, t: 0 } as BoardEvent);
        // An `ask` pauses the performance and waits for the learner — so Wobo has to actually
        // ask it out loud, on the same voice as the rest of the turn, and as a question (10b).
        // Unless the line just said already ended on it: a plan's last sentence IS its ask, and
        // asking it again printed and spoke every question twice.
        if (!alreadyEndsWith(wired, prompt)) {
          sentences(prompt).forEach((_part, i) => {
            beats.push({
              done: false,
              surface: () => {
                if (i === 0) options.onAsk?.(prompt, targets);
              },
            });
          });
          gate.say(prompt);
          utterance.say(prompt, 'ask');
        }
        this.set({ ask: { prompt, targets } });
      },
      onCard: (card: unknown) => {
        this.stillAlive();
        options.onCard?.(card);
      },
      onDone: (done: BoardDone) => this.finish(done),
    };

    // 3. THE WORDS COME FROM THE CORE (docs/INK-FOUR.md). The level already holds the true sentence
    // about the thing the pen has just ringed, so Wobo says it now rather than waiting to be told
    // what it says. It goes through the SAME handler as every other sentence, so it is one voice,
    // one transcript, in order; the plan's sentences extend it, and one that repeats it is dropped.
    if (options.instant?.say) handlers.onSay(options.instant.say);

    const open = (): Promise<unknown> =>
      streamBoardTurn({
        gatewayUrl,
        payload,
        board,
        signal: controller.signal,
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
        // A DOOR OF ITS OWN STILL HEARS ABOUT THE INSTANT MARK. The doubt's answer goes to
        // `/v1/doubt/{id}/answer` with its own body rather than the turn payload, so `board`
        // above never reaches it; without this the brain plans against a photo it believes is
        // unmarked and the mark already standing on it is one nothing says a word about
        // (docs/INK-FOUR.md, the instant mark; the gateway's half is `doubt.StandingMark`).
        ...(options.body
          ? {
              body:
                options.instant && board.standing?.length
                  ? {
                      ...options.body,
                      standing: board.standing.map((mark) => ({
                        id: String(mark.id),
                        kind: String(mark.kind),
                        target: String(
                          (mark as { anchor?: { target?: unknown } }).anchor?.target ?? '',
                        ),
                      })),
                    }
                  : options.body,
            }
          : {}),
        handlers,
        // BOARD.md §4: "on resume the brain continues from the last acknowledged event". The id is
        // recorded as each frame lands rather than read off the return value, because a network
        // loss throws and there is no return value to read.
        onEventId: (id: string) => {
          this.stillAlive();
          this.lastEventId = id;
        },
        ...(this.lastEventId ? { lastEventId: this.lastEventId } : {}),
      });

    try {
      try {
        await open();
      } catch (err) {
        // Barging in is not a failure (BOARD.md §4): the pen lifts, the voice stops, what is drawn
        // stays, and the learner hears nothing about it. Anything else that is not a refusal is a
        // dropped connection, and the turn is resumed once from the last frame that landed rather
        // than asked for again and charged again.
        if (isAbort(err)) return this.outcome(said, false);
        if (!this.lastEventId || isRefusal(err) || controller.signal.aborted) throw err;
        try {
          await open();
        } catch (again) {
          if (isAbort(again)) return this.outcome(said, false);
          throw again;
        }
      }
    } finally {
      utterance.end();
      await utterance.done;
      // Nothing is left stranded: a mark whose sentence the voice never reached lands now.
      if (this.gate === gate) {
        gate.flush();
        this.gate = null;
      }
      if (this.utterance === utterance) this.utterance = null;
      if (this.controller === controller) this.controller = null;
      // A turn that ran to its end prints every line it had, whatever the voice managed; one
      // that was cut, or superseded by the next, prints only what was spoken.
      if (this.runSeq === token && this.interruptedRun !== token) surfaceUpTo(beats.length - 1);
      this.set({ active: false });
      // The ink holds while the question is open. A turn that asked nothing lets it linger a
      // moment, then lets it go; and the glass is released the moment the pen and the voice end.
      if (!this.state.ask) this.releaseScreen(this.now() + LINGER_MS);
      this.endGlass();
    }
    // THE STREAM ENDED, WHATEVER IT CARRIED (the adversary, wave 53). Reaching this line means
    // `open()` resolved: the wire ran out, with a `done` frame or without one. Only the learner's
    // own interruption makes a turn incomplete here — everything else that goes wrong on the wire
    // throws, and is answered in words by the caller. A turn that ends with nothing said and
    // nothing drawn therefore reaches the honest line instead of ending in silence.
    return this.outcome(said, this.interruptedRun !== token);
  }

  /** What the caller is handed however the turn ended. */
  private outcome(said: string[], completed?: boolean): BoardTurnOutcome {
    return {
      said: said.join(' ').trim(),
      completed: completed ?? (this.store.turnDone || screenStore.turnDone),
      presentation: this.state.presentation,
      objects: this.state.objects,
      interruptedAt: this.state.interruptedAt,
      ask: this.state.ask,
    };
  }

  /**
   * THE LAST STEP OF THE SIGNATURE: WIRE → GLASS (the adversary, wave 47, finding 9).
   *
   * `_signed` (board/stream.py) reconciles the plan against the WIRE — a check signed for a mark
   * the gateway never emitted is refused there. Nothing checked the half after that: whether the
   * client actually LAID it. Wave 47 measured 27 board turns where streamed == store == DOM == on
   * screen, so the guarantee held by luck; wave 42 is what it looks like when the luck runs out —
   * the plant cell's "vacuole" and "chloroplast" never reached the DOM and the ledger signed them.
   *
   * So the turn reads its own glass once the ink has finished landing, and drops the signature of
   * anything that is not on it. It runs after the pen, never at `done`: at `done` most of this
   * turn's ink has not been drawn yet, and a mark that is merely still coming is not a mark that
   * was lost.
   */
  private settleSignatures(): void {
    if (this.state.verified.length === 0) return;
    const live = [...screenStore.snapshot(), ...(this.store === screenStore ? [] : this.store.snapshot())];
    const onGlass = idsOnGlass();
    if (onGlass === null) return; // no page to read: no evidence, and nothing is unsigned on a guess
    const objects = live.map((s) => s.object as { id: string; check?: string });
    const lost = unsignedMarks(objects, (id) => onGlass.has(id));
    if (lost.length === 0) return;
    this.set({ verified: this.state.verified.filter((c) => !lost.includes(c)) });
  }

  /**
   * The plan closed. The surface was decided object by object as the ink landed (`PresentationChoice`:
   * a mark about something on the screen stays on the screen, something built from scratch opens
   * the plane), and the `done` frame does not reopen that decision. It used to: an empty plan that
   * named the plane opened an empty board over the thing the learner was reading, which is the
   * board at its worst and the owner's complaint in one frame (2026-09-05). A board opens only
   * when there is something on it, and that is known by the time `done` arrives.
   */
  private finish(done: BoardDone): void {
    const closed = { type: 'done', t: 0 } as BoardEvent;
    this.store.applyEvent(closed);
    if (this.store !== screenStore) screenStore.applyEvent(closed);
    this.set({
      ...(done.verified ? { verified: done.verified } : {}),
      ...(done.objects !== undefined ? { objects: done.objects } : {}),
    });
    this.traceGlass();
    // And once the pen has finished, the signatures are reconciled against the glass itself.
    this.doneSeen = true;
    this.scheduleSettle(0);
  }

  /**
   * Re-read the glass a beat after the ink stops arriving. `done` is not that moment: the wire
   * closes while the pen is still drawing what it was given, so the settle is pushed back by every
   * mark that lands after it and only fires once the page has really stopped changing.
   */
  private scheduleSettle(strokeMs: number): void {
    if (!this.doneSeen || typeof setTimeout !== 'function') return;
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    const wait = Math.min(SIGNATURE_SETTLE_MAX_MS, Math.max(0, strokeMs)) + SIGNATURE_SETTLE_GRACE_MS;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.settleSignatures();
    }, wait);
  }

  /**
   * Everything Wobo has drawn on the board in front of the learner, cleared — "wipe the board".
   * Returns how many objects went, so the line said afterwards can be true of the screen rather
   * than announcing a clean board over one that was already empty.
   */
  wipe(): number {
    const store = this.boardStore();
    const went = store.snapshot().length;
    store.reset();
    return went;
  }

  /** The last event id, for a resume after a network loss. */
  resumeToken(): string | undefined {
    return this.lastEventId;
  }
}

export const boardTurn = new BoardConductor();

/**
 * "Close the board." Puts away whichever board is actually in front of the learner, and says
 * whether one went.
 *
 * `plane.dismiss()` alone was wrong on two axes. It returns early on a pinned board, so the learner
 * was told "Put away." over a board that had not moved; and inside a lesson the ink is on
 * `lessonStore`, which the plane controller cannot reach at all, so the same sentence was said over
 * a full board still covering the screen. An explicit close is never accidental — that is what the
 * pin guards against — so it unpins on the way out.
 */
export function dismissBoard(): boolean {
  const lesson = lessonView.get();
  if (lesson.host !== null && lessonStore.snapshot().length > 0) {
    if (lesson.dismissed) return false;
    lessonView.dismiss();
    return true;
  }
  if (!plane.get().open) return false;
  return plane.close();
}

/**
 * The learner cut Wobo off. `AbortController.abort()` rejects the in-flight fetch with an
 * `AbortError`, and BOARD.md §4 is clear that nothing about a barge-in is a failure: the pen lifts,
 * the voice stops, what is drawn stays. Reading it as an error appended "Give me a moment, then ask
 * me again." to Wobo's own half-finished sentence.
 */
export function isAbort(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === 'AbortError';
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

/** A refusal the learner is meant to hear (sign in, budget spent). Retrying it would be rude. */
function isRefusal(err: unknown): boolean {
  return err instanceof SignInRequiredError || err instanceof BudgetExhaustedError;
}

/** The id an ink frame carries, whether it places an object or patches one. */
function inkedObjectId(event: BoardEvent): string | null {
  if (event.type !== 'ink') return null;
  const object = (event as { object?: { id?: unknown } }).object;
  return typeof object?.id === 'string' ? object.id : null;
}

/**
 * A clue written beside a thing on the screen by the one pen: a `note` object anchored to the
 * thing's glass id, holding until the learner's next turn lets the screen's ink go. The depth
 * keys the id, so a deeper clue replaces the last rather than piling beside it.
 */
export function hintNote(targetId: string, text: string, depth: number): BoardEvent {
  return {
    type: 'ink',
    t: 0,
    object: {
      id: `hint-${targetId}`,
      kind: 'note',
      anchor: { target: targetId, at: 'right' },
      text,
      words: text,
      meta: { depth },
    },
  } as BoardEvent;
}

/**
 * The regions the learner has circled, for `{focus}` anchors. Kept here so the stage, the plane and
 * the full board all read one list.
 */
export function focusRegionsFor(
  focus: FocusObject | null,
): readonly { id: string; rect: () => Rect }[] {
  if (!focus) return [];
  // A thunk, exactly like `BoardTarget.getRect`: BOARD.md §3 re-resolves an anchor on scroll, and a
  // rect frozen at the moment of the gesture floated 300 units off the film after a 300 px scroll.
  return [{ id: focus.id, rect: () => liveFocusRect(focus) }];
}

/** Where a focus region is right now — its targets' live rects, or the page's scroll delta. */
export function liveFocusRect(focus: FocusObject): Rect {
  return focusRectNow(focus, {
    target: (id) => surfaceRegistry.getTarget(id)?.rect() ?? null,
    scroll: pageScroll(),
  });
}

/**
 * The targets the renderer anchors to: every entry on the glass map with its live measure, then
 * whatever the registry still holds under an id the map does not (docs/INK-FREEZE-PLAN-TRACE.md
 * §3, Trace: one pen, from the element's real box).
 */
export function boardTargets(): readonly { id: string; getRect: () => DOMRect | null }[] {
  return glassTargets();
}
