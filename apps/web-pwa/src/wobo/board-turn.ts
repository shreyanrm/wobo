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
  type FocusObject,
  focusRectNow,
  pageScroll,
  plane,
  type Rect,
  surfaceRegistry,
} from '@wobo/wobo';
import { type BoardContext, type BoardDone, streamBoardTurn } from './board-stream';
import { lessonView } from './lesson-view';
import { isLessonRoute, type Presentation, PresentationChoice } from './presentation';
import { startUtterance, stopSpeaking, type Utterance } from './speech';

/** Ink on the screen: it fades after the utterance, like a whiteboard. */
export const screenStore = new BoardStore({ presentation: 'screen' });
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
}

export interface BoardTurnOutcome {
  /** Everything Wobo said, in order — one line for the transcript. */
  said: string;
  /** True when `done` landed; false when the learner or the network cut it short. */
  completed: boolean;
  presentation: Presentation;
  objects: number;
  interruptedAt: string | null;
  ask: { prompt: string; targets: string[] } | null;
}

class BoardConductor {
  private state: BoardTurnState = RESTING;
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private utterance: Utterance | null = null;
  /**
   * Every ink frame of the running turn with the surface it landed on, so a promotion can replay
   * exactly the ink that needs a board and leave the screen's own marks where they are pointing.
   */
  private inked: { event: BoardEvent; pinned: boolean }[] = [];
  private choice = new PresentationChoice();
  /** The BOARD surface's store. Screen-anchored marks always go to `screenStore` instead. */
  private store: BoardStore = screenStore;
  /** The instant the voice zeroed the clock, so a promoted board keeps Wobo's timing. */
  private utteranceAt: number | null = null;
  private lastEventId: string | undefined;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = (): BoardTurnState => this.state;

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
    const drawn = this.boardStore()
      .snapshot()
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
    // Both halves of a two-surface turn lift together: the pen is one pen.
    const onScreen = screenStore.interrupt();
    const at = this.store === screenStore ? onScreen : (this.store.interrupt() ?? onScreen);
    this.utterance?.stop();
    this.utterance = null;
    stopSpeaking();
    this.controller?.abort();
    this.controller = null;
    this.set({ active: false, interruptedAt: at });
    return at;
  }

  /** A new turn is beginning: nothing of the last one is left mid-air. */
  private open(route: string, override: Presentation | null | undefined, title?: string): void {
    this.controller?.abort();
    this.inked = [];
    this.lastEventId = undefined;
    this.utteranceAt = null;
    this.choice = new PresentationChoice({
      ...(override ? { override } : {}),
      lesson: isLessonRoute(route),
    });
    const presentation = this.choice.current();
    this.store = this.storeFor(presentation, title);
    // Screen ink is per-utterance whatever else the turn does, and every turn can now put a mark
    // on the screen — so the screen starts empty even when the board surface is the plane. The log
    // goes with it: the screen has no scrubber, so keeping it was an accumulation with no reader.
    screenStore.reset();
    this.set({
      active: true,
      presentation,
      boardId: presentation === 'plane' ? plane.get().boardId : null,
      ask: null,
      interruptedAt: null,
      verified: [],
      objects: 0,
    });
  }

  private storeFor(presentation: Presentation, title?: string): BoardStore {
    if (presentation === 'full') return lessonStore;
    if (presentation === 'plane') {
      const id = plane.summon({ ...(title ? { title } : {}) });
      return boardBook.get(id);
    }
    return screenStore;
  }

  /**
   * The surface changed under a running plan: bring what is already drawn with Wobo. The objects are
   * semantic, so moving them is exact — nothing is re-rendered from pixels.
   */
  private promote(to: Presentation, origin?: { x: number; y: number }, title?: string): void {
    const id =
      to === 'plane'
        ? plane.summon({ ...(origin ? { origin } : {}), ...(title ? { title } : {}) })
        : null;
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
    this.open(route, override, title);
    const controller = new AbortController();
    this.controller = controller;
    const said: string[] = [];
    // speech.tsx owns the utterance clock: it zeroes the board the moment the performance opens, so
    // every `t.start` in the plan is measured from Wobo first breath, and the pen leads the voice by
    // exactly the time Wobo first syllable takes to arrive — a hand's anticipation, not a lag.
    const utterance = startUtterance(() => ({
      // Both surfaces are on one clock: every `t.start` in the plan is measured from Wobo first
      // breath whether the ink lands on the screen or on the board.
      beginUtterance: (at?: number) => {
        const zero = at ?? this.store.time();
        this.utteranceAt = zero;
        this.store.beginUtterance(zero);
        if (this.store !== screenStore) screenStore.beginUtterance(zero);
      },
    }));
    this.utterance = utterance;

    const handlers = {
      onSay: (text: string, t?: number, durMs?: number) => {
        said.push(text);
        options.onSay?.(text, t, durMs);
        utterance.say(text);
      },
      onInk: (event: BoardEvent & { type: 'ink' }) => {
        const surface = this.choice.offer(event.object as never);
        const pinned = this.choice.pinned;
        // A promotion moves the BOARD surface and replays the ink that needs one; the marks
        // pinned to the screen stay on the screen, pointing at what they are about.
        if (this.choice.promoted) this.promote(this.choice.current(), origin, title);
        this.inked.push({ event, pinned });
        (pinned || surface === 'screen' ? screenStore : this.store).applyEvent(event);
        this.set({ objects: this.choice.objects() });
      },
      onAction: (action: unknown) => options.onAction?.(action),
      onAsk: (prompt: string, targets: string[]) => {
        this.store.applyEvent({ type: 'ask', prompt, targets, t: 0 } as BoardEvent);
        // An `ask` pauses the performance and waits for the learner — so Wobo has to actually
        // ask it out loud, on the same voice as the rest of the turn, and as a question (10b).
        utterance.say(prompt, 'ask');
        options.onAsk?.(prompt, targets);
        this.set({ ask: { prompt, targets } });
      },
      onCard: (card: unknown) => options.onCard?.(card),
      onDone: (done: BoardDone) => this.finish(done),
    };

    const open = (): Promise<unknown> =>
      streamBoardTurn({
        gatewayUrl,
        payload,
        board: this.boardContext(route, override),
        signal: controller.signal,
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
        ...(options.body ? { body: options.body } : {}),
        handlers,
        // BOARD.md §4: "on resume the brain continues from the last acknowledged event". The id is
        // recorded as each frame lands rather than read off the return value, because a network
        // loss throws and there is no return value to read.
        onEventId: (id: string) => {
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
      if (this.utterance === utterance) this.utterance = null;
      if (this.controller === controller) this.controller = null;
      this.set({ active: false });
    }
    return this.outcome(said);
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

/** The board targets the renderer anchors to — every registered surface target, live. */
export function boardTargets(): readonly { id: string; getRect: () => DOMRect | null }[] {
  return surfaceRegistry.getTargets().map((target) => ({
    id: target.id,
    getRect: () => {
      const rect = target.rect();
      return rect ? (rect as DOMRect) : null;
    },
  }));
}
