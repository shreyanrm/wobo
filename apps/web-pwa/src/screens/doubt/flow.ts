/**
 * The order the doubt screen is allowed to move in — a reducer, so LAW 1 is a state machine and
 * not a convention: capture → reading → confirm → explaining → placing.
 *
 * "THE READING IS SHOWN BEFORE THE ANSWER. Vision misreads. A 3 becomes an 8, a minus vanishes."
 * `explainAllowed` is false until a reading exists, and an `explain` action arriving early is
 * dropped rather than obeyed. The reading is held LINE BY LINE, each editable in place under the
 * gateway's own line id, because that is how the gateway takes corrections
 * (`POST /v1/doubt/{id}/answer`, `lines: [{id, text}]`) and how the ink is anchored: a line the
 * learner fixed is the same target, now reading right.
 */

import type { Capture, DoubtLine, DoubtReadResult } from './api';
import { regionsOf } from './api';

export type DoubtPhase = 'capture' | 'reading' | 'confirm' | 'explaining' | 'placing';

export interface DoubtFlow {
  phase: DoubtPhase;
  /** The bytes in hand. Cleared on a refusal, so a refused photo does not linger in memory. */
  capture: Capture | null;
  result: DoubtReadResult | null;
  /** The reading as the learner sees and edits it, one entry per line the gateway read. */
  lines: DoubtLine[];
  /** The line lit on the photo — tapped in the text, or on the page. */
  lit: string | null;
  /** The learner's own words about the doubt, if they typed any: "I do not get step 2". */
  words: string;
  error: string | null;
}

export const initialFlow: DoubtFlow = {
  phase: 'capture',
  capture: null,
  result: null,
  lines: [],
  lit: null,
  words: '',
  error: null,
};

export type FlowAction =
  | { type: 'captured'; capture: Capture }
  | { type: 'read'; result: DoubtReadResult }
  | { type: 'unreadable'; say: string }
  | { type: 'editLine'; id: string; text: string }
  | { type: 'light'; regionId: string | null }
  | { type: 'words'; text: string }
  | { type: 'explain' }
  | { type: 'explained' }
  | { type: 'unexplained'; say: string }
  | { type: 'retake' };

export function reduce(state: DoubtFlow, action: FlowAction): DoubtFlow {
  switch (action.type) {
    case 'captured':
      return { ...initialFlow, phase: 'reading', capture: action.capture };
    case 'read':
      if (state.phase !== 'reading') return state;
      return {
        ...state,
        phase: 'confirm',
        result: action.result,
        lines: action.result.reading.lines.map((l) => ({ ...l })),
        lit: null,
        error: null,
      };
    case 'unreadable':
      return { ...initialFlow, error: action.say };
    case 'editLine':
      return state.phase === 'confirm'
        ? {
            ...state,
            lines: state.lines.map((l) => (l.id === action.id ? { ...l, text: action.text } : l)),
          }
        : state;
    case 'light':
      return { ...state, lit: action.regionId };
    case 'words':
      return state.phase === 'confirm' ? { ...state, words: action.text.slice(0, 500) } : state;
    case 'explain':
      return explainAllowed(state)
        ? { ...state, phase: 'explaining', lit: null, error: null }
        : state;
    case 'explained':
      return state.phase === 'explaining' ? { ...state, phase: 'placing' } : state;
    // The answer never arrived (offline, a refusal, a turn that said nothing). The photo and the
    // reading the learner already confirmed are kept exactly as they were, so Explain is one tap
    // away again; what does NOT happen is 'placing', which is what files a doubt as explained.
    // It is also reachable from 'confirm' itself: with no connection the turn is refused here,
    // rather than sent to the chat as a queued message the photo will never see again.
    case 'unexplained':
      return state.phase === 'explaining' || state.phase === 'confirm'
        ? { ...state, phase: 'confirm', lit: null, error: action.say }
        : state;
    case 'retake':
      return initialFlow;
    default:
      return state;
  }
}

/** The one action a photo arrives on, whoever took it. */
export type CapturedAction = Extract<FlowAction, { type: 'captured' }>;

/**
 * A SHARED PHOTO IS A CAPTURED PHOTO.
 *
 * A child who photographs the page in the gallery app and shares it to Wobo has done exactly what
 * the camera button does, one screen earlier, so the flow must not learn a second way to begin: it
 * is the same `captured` action, the same `reading` phase, the same reading shown before anything
 * is computed (LAW 1). The share target's own halves are the manifest (vite.config.ts), the worker
 * that answers the POST (public/share-target.js) and the collection on arrival (capture.ts).
 *
 * And the quiet case, which is why this returns null rather than an action of its own: a share
 * that carried no image is NOT AN EVENT. The learner lands on the capture step with the camera in
 * front of them and nothing is said about what did not arrive (DESIGN.md §0.x, never narrate) —
 * there is no refusal to print, because nothing was refused.
 */
export function shared(capture: Capture | null): CapturedAction | null {
  return capture ? { type: 'captured', capture } : null;
}

/** LAW 1's gate. A reading, shown, with at least one line still in it. */
export function explainAllowed(state: DoubtFlow): boolean {
  return (
    state.phase === 'confirm' && state.result !== null && state.lines.some((l) => l.text.trim())
  );
}

/** The lines as they stand, emptied ones left out: what the photo's targets are right now. */
export function liveLines(state: DoubtFlow): DoubtLine[] {
  return state.lines.filter((l) => l.text.trim());
}

/** The regions ink may anchor to: the live lines that have a place on the page. */
export function liveRegions(state: DoubtFlow) {
  return regionsOf(liveLines(state));
}

/** True when the learner changed any line from what the gateway read. */
export function corrected(state: DoubtFlow): boolean {
  const read = new Map((state.result?.reading.lines ?? []).map((l) => [l.id, l.text]));
  return state.lines.some((l) => (read.get(l.id) ?? '') !== l.text.trim());
}

/**
 * What the answer is asked with (`AskOptions.doubt`): the gateway's id, the corrections by line
 * id, and the learner's words. Null until Explain is allowed.
 */
export interface DoubtPacket {
  id: string;
  lines: { id: string; text: string }[];
  words?: string;
  /**
   * The line lit on the photo when Explain was pressed. It never goes on the wire (`answerBody`
   * sends the lines and the words); it is what the INSTANT MARK aims at, so the pen starts on the
   * line the learner tapped while the answer is still being thought about
   * (docs/INK-FOUR.md, timing; wobo/instant.ts, `resolveDoubtInstant`).
   */
  lit?: string | null;
}

export function doubtPacket(state: DoubtFlow, words: string = state.words): DoubtPacket | null {
  if (!state.result || !explainAllowed(state)) return null;
  return {
    id: state.result.id,
    lines: state.lines.map((l) => ({ id: l.id, text: l.text.trim() })),
    ...(words?.trim() ? { words: words.trim() } : {}),
    ...(state.lit ? { lit: state.lit } : {}),
  };
}

/**
 * The learner's own words for the turn, as the transcript shows them: what they typed, or the tap's
 * meaning over the first line AS THEY CORRECTED IT. Never the reader's `question`: that string is
 * not shown and cannot be edited, and until 2026-09-05 it was sent as the learner's own words, so a
 * learner who fixed 8x to 3x still asked about 8x.
 */
export function explainPrompt(state: DoubtFlow): string {
  const own = state.words.trim();
  if (own) return own;
  const first = liveLines(state)[0]?.text.trim() ?? '';
  return `Explain this to me: ${first}`.trim();
}

/**
 * Which door a learner meets. The gateway keeps a photo against an ACCOUNT (law 2) and answers
 * 403 to an anonymous session, so the camera is not offered to one: a photo must not travel
 * before the refusal. With no account layer at all (a local build) the gateway decides.
 */
export function doorFor(
  account: { isAuthenticated(): boolean; isAnonymous(): boolean } | undefined,
): 'camera' | 'sign-in' {
  if (!account) return 'camera';
  return account.isAuthenticated() && !account.isAnonymous() ? 'camera' : 'sign-in';
}
