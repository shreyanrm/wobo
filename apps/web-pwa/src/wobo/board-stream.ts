'use client';

/**
 * The streaming board turn (docs/BOARD.md §4) — the client half of the wire.
 *
 * One capability, one door: `POST /v1/capability/wobo.turn` with `Accept: text/event-stream` is the
 * only thing that selects the board. Identity rides `gatewayFetch`; no key, no model id and no limit
 * is ever held here. Frames arrive in order — `say`, `ink`, `action`, `ask`, `card`, `done` — and are
 * handed to the caller the instant they land, so the pen can start ahead of the voice.
 *
 * The parser is a plain state machine over the byte stream so it can be unit-tested without a
 * network: SSE frames can be split across any chunk boundary, and a half-frame must never be
 * delivered as if it were whole.
 */

import { gatewayFetch, throwForGatewayStatus } from '@wobo/sdk';
import { type BoardEvent, parseBoardEvent } from '@wobo/wobo';

/** One decoded server-sent frame. `event` is the SSE event name; `data` its raw payload. */
export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

/**
 * Feed it whatever arrives; it yields only whole frames. A comment line (`: open`) is a keep-alive
 * and produces nothing, which is exactly what the gateway's first flush is for.
 */
export class SseParser {
  private buffer = '';
  private id: string | undefined;
  private event: string | undefined;
  private data: string[] = [];

  /** Push a chunk of the stream; returns every frame it completed. */
  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const raw = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      const frame = this.line(line);
      if (frame) frames.push(frame);
      index = this.buffer.indexOf('\n');
    }
    return frames;
  }

  /** The stream ended: a frame that never got its blank line is still a frame. */
  flush(): SseFrame[] {
    const rest = this.buffer;
    this.buffer = '';
    const frames: SseFrame[] = [];
    if (rest) {
      const frame = this.line(rest.endsWith('\r') ? rest.slice(0, -1) : rest);
      if (frame) frames.push(frame);
    }
    const tail = this.dispatch();
    if (tail) frames.push(tail);
    return frames;
  }

  private line(line: string): SseFrame | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return null; // a comment — the keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'id') this.id = value;
    else if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    return null;
  }

  private dispatch(): SseFrame | null {
    if (this.data.length === 0 && this.event === undefined && this.id === undefined) return null;
    const frame: SseFrame = { data: this.data.join('\n') };
    if (this.id !== undefined) frame.id = this.id;
    if (this.event !== undefined) frame.event = this.event;
    this.id = undefined;
    this.event = undefined;
    this.data = [];
    return frame.data === '' && frame.event === undefined ? null : frame;
  }
}

/** `<turnId>:<seq>` — what a reconnect resumes from. Malformed ids are simply not resumable. */
export function parseEventId(id: string | undefined): { turnId: string; seq: number } | null {
  if (!id) return null;
  const at = id.lastIndexOf(':');
  if (at <= 0) return null;
  const tail = id.slice(at + 1);
  // `Number('')` is 0, which would silently resume a turn from its very first frame and replay it.
  if (tail === '') return null;
  const seq = Number(tail);
  if (!Number.isInteger(seq) || seq < 0) return null;
  return { turnId: id.slice(0, at), seq };
}

// --- The turn ------------------------------------------------------------------------------------

/** What the learner's side of the board looks like when the turn is asked for. */
export interface BoardContext {
  /** The learner's override, when they said "board" or "here". */
  presentation?: 'screen' | 'plane' | 'full';
  /** The object the pen stopped on when they interrupted Wobo's last turn. */
  interrupted_at?: string;
  /** Ids already on the board, so Wobo does not redraw what is there. */
  drawn?: string[];
  /**
   * WHAT THIS TURN'S OWN PEN HAS ALREADY PUT DOWN — the instant mark (docs/INK-FOUR.md), resolved
   * from the glass map and drawn before the request left. `drawn` is the turn BEFORE this one and
   * is only ids; this carries the mark itself, because the brain owes it words: a mark on the
   * glass that nothing is said about is the same broken law as a sentence about a mark that was
   * never drawn (`services/gateway/src/wobo_gateway/board/stream.py`).
   */
  standing?: {
    id: string;
    kind: 'ring' | 'underline';
    anchor: { target: string };
    words?: string;
  }[];
  /** Inside a lesson: the board is the screen. */
  lesson?: boolean;
  /**
   * A bound control the learner just moved, and what it now reads (docs/BOARD.md §2, §8). Its
   * companion `recompute` names the objects that declared they depend on it — the question the
   * brain's verifier answers with fresh ink.
   */
  changed?: { variable: string; value: number | boolean | string | [number, number] };
  recompute?: string[];
}

export interface BoardTurnHandlers {
  onSay?: (text: string, t: number, durMs?: number) => void;
  onInk?: (event: BoardEvent & { type: 'ink' }, t: number) => void;
  onAction?: (action: unknown, t: number) => void;
  onAsk?: (prompt: string, targets: string[], t: number) => void;
  onCard?: (card: unknown, t: number) => void;
  onDone?: (done: BoardDone) => void;
}

export interface BoardDone {
  presentation?: 'screen' | 'plane' | 'full';
  objects?: number;
  verified?: string[];
  refused?: unknown[];
  resumesFrom?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const numberAt = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Route one decoded frame to its handler. Pure but for the callbacks, so the whole protocol can be
 * exercised in a test without a socket. Anything unrecognised is dropped rather than guessed at.
 */
export function dispatchFrame(frame: SseFrame, handlers: BoardTurnHandlers): void {
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return; // a half-written frame is not a frame
  }
  if (!isRecord(payload)) return;
  const type = typeof payload.type === 'string' ? payload.type : frame.event;
  const t = numberAt(payload.t);
  switch (type) {
    case 'say': {
      if (typeof payload.text !== 'string') return;
      const dur = typeof payload.dur === 'number' ? payload.dur : undefined;
      handlers.onSay?.(payload.text, t, dur);
      return;
    }
    case 'ink': {
      const event = parseBoardEvent({ type: 'ink', object: payload.object, t });
      // The grammar is the gate: an object the schema does not recognise never reaches the hand.
      if (event?.type === 'ink') handlers.onInk?.(event, t);
      return;
    }
    case 'action':
      if (payload.action !== undefined) handlers.onAction?.(payload.action, t);
      return;
    case 'ask': {
      if (typeof payload.prompt !== 'string') return;
      const targets = Array.isArray(payload.targets)
        ? payload.targets.filter((x): x is string => typeof x === 'string')
        : [];
      handlers.onAsk?.(payload.prompt, targets, t);
      return;
    }
    case 'card':
      if (payload.card !== undefined) handlers.onCard?.(payload.card, t);
      return;
    case 'done':
      handlers.onDone?.({
        ...(typeof payload.presentation === 'string'
          ? { presentation: payload.presentation as 'screen' | 'plane' | 'full' }
          : {}),
        ...(typeof payload.objects === 'number' ? { objects: payload.objects } : {}),
        ...(Array.isArray(payload.verified)
          ? { verified: payload.verified.filter((x): x is string => typeof x === 'string') }
          : {}),
        ...(Array.isArray(payload.refused) ? { refused: payload.refused } : {}),
        ...(typeof payload.resumes_from === 'string' ? { resumesFrom: payload.resumes_from } : {}),
      });
      return;
    default:
  }
}

export interface StreamBoardTurnOptions {
  gatewayUrl: string;
  /** The context packet payload — exactly what the non-streaming turn sends. */
  payload: Record<string, unknown>;
  board?: BoardContext;
  handlers: BoardTurnHandlers;
  signal?: AbortSignal;
  /** Resume a dropped turn from the last frame that landed; never charged again. */
  lastEventId?: string;
  /**
   * Every frame id as it lands. The caller needs these to resume, and a network loss REJECTS this
   * call — so the return value is exactly the thing that is not there when a resume is wanted.
   */
  onEventId?: (id: string) => void;
  /**
   * THE SAME WIRE AT ANOTHER DOOR. The doubt solver's answer (`POST /v1/doubt/{id}/answer`,
   * services/gateway doubt.py) streams the same say, ink, ask, card, done frames, but the gateway
   * composes the packet itself from the photo it read; the client sends only the learner's
   * corrections. `endpoint` is the path under the gateway, `body` replaces the `{ payload }`
   * envelope. Left out, this is the ordinary board turn, unchanged.
   */
  endpoint?: string;
  body?: Record<string, unknown>;
}

export interface StreamBoardTurnResult {
  /** The last event id seen — hand it back to resume after a network loss. */
  lastEventId?: string;
  /** True once `done` landed. False means the stream was cut short. */
  completed: boolean;
}

/**
 * Open the turn and drive the handlers until `done` or the signal aborts. Refusals come back typed
 * through the SDK (sign-in needed, budget spent) so the learner hears Wobo's line, never a status code.
 */
export async function streamBoardTurn(
  options: StreamBoardTurnOptions,
): Promise<StreamBoardTurnResult> {
  const { gatewayUrl, payload, board, handlers, signal, lastEventId, onEventId } = options;
  const headers: Record<string, string> = {
    accept: 'text/event-stream',
    'content-type': 'application/json',
  };
  if (lastEventId) headers['last-event-id'] = lastEventId;
  const res = await gatewayFetch(`${gatewayUrl}${options.endpoint ?? '/v1/capability/wobo.turn'}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(options.body ?? { payload: { ...payload, ...(board ? { board } : {}) } }),
    ...(signal ? { signal } : {}),
  });
  await throwForGatewayStatus(res);
  const body = res.body;
  if (!body) return { completed: false };

  const parser = new SseParser();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let seen: string | undefined;
  let completed = false;
  const wrapped: BoardTurnHandlers = {
    ...handlers,
    onDone: (done) => {
      completed = true;
      handlers.onDone?.(done);
    },
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        if (frame.id) {
          seen = frame.id;
          onEventId?.(frame.id);
        }
        dispatchFrame(frame, wrapped);
      }
      if (completed) break;
    }
    if (!completed) {
      for (const frame of parser.flush()) {
        if (frame.id) {
          seen = frame.id;
          onEventId?.(frame.id);
        }
        dispatchFrame(frame, wrapped);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // the stream is already gone — nothing to release
    }
  }
  return { ...(seen ? { lastEventId: seen } : {}), completed };
}
