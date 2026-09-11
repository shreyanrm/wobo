/**
 * The doubt solver's doors to the brain — the wire of `services/gateway/src/wobo_gateway/doubt.py`:
 *
 *   POST   /v1/doubt                  the reading: the photo in, the lines and their boxes out
 *   POST   /v1/doubt/{id}/answer      the answer, streamed (the board wire, board-stream.ts)
 *   GET    /v1/doubt                  every kept doubt, for the memory page
 *   GET    /v1/doubt/{id}/photo       the photo as the gateway kept it (screened, no metadata)
 *   DELETE /v1/doubt/{id}             the row AND the object in the bucket
 *
 * The client holds no key and names no model. Vision is used exactly once, to read; the answer is
 * the ordinary board turn composed on the gateway from the CONFIRMED reading, with each line of the
 * page as a target the ink anchors to by its id. So the ids here are never rewritten: a line the
 * gateway called `r2` is the registry target `r2` on the surface `doubt:<id>`.
 *
 * The parser is defensive on purpose. A line with no id or no text is dropped; a box that is not
 * on the page is dropped WITH the line kept as text (editable, never a target): a region becomes a
 * registry target and Wobo's ink anchors to it, so a bad one is a mark in the wrong place on a
 * child's book.
 */

import { GatewayError, gatewayFetch, gatewayJson, throwForGatewayStatus } from '@wobo/sdk';
import type { DoubtRegion, PageBox } from '../../wobo/doubt-surface';

/** A photo as the client captured it: base64 bytes, their type, and the upright pixel size. */
export interface Capture {
  data: string;
  mediaType: string;
  width: number;
  height: number;
}

/** One line of the page as the gateway read it. `box` is null when the reader gave it no place. */
export interface DoubtLine {
  id: string;
  text: string;
  box: PageBox | null;
}

export interface DoubtReadResult {
  id: string;
  createdAt: string;
  status: 'read' | 'answered';
  /** The learner's own words beside the photo, as the gateway keeps them. */
  words: string;
  /** Law 1, in Wobo's voice, as the gateway said it. */
  say: string;
  reading: {
    subject: string;
    topic: string;
    question: string;
    lines: DoubtLine[];
    width: number;
    height: number;
  };
  climb: {
    nodeId?: string;
    nodeName?: string;
    frameworkId?: string;
  };
}

export class DoubtUnreadable extends Error {
  constructor(message = 'I could not read that page. Try a straighter, brighter photo?') {
    super(message);
    this.name = 'DoubtUnreadable';
  }
}

/**
 * A line of the page can be this long, on both sides of the wire (doubt.py `MAX_LINE_CHARS`). The
 * client used to allow 400 and the gateway 200, and a learner who fixed a line into the gap met a
 * raw validation error they could not read.
 */
export const MAX_LINE_CHARS = 200;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, max = 400): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * A box as the gateway sends it, `[x0, y0, x1, y1]` corners in page fractions (`{x, y, w, h}` is
 * accepted too), clamped to the page. Null when it is not a box or lies off the page entirely.
 */
export function parseBox(raw: unknown): PageBox | null {
  let x0: unknown;
  let y0: unknown;
  let x1: unknown;
  let y1: unknown;
  if (Array.isArray(raw) && raw.length === 4) [x0, y0, x1, y1] = raw;
  else if (isRecord(raw) && typeof raw.w === 'number' && typeof raw.h === 'number') {
    x0 = raw.x;
    y0 = raw.y;
    x1 = (raw.x as number) + raw.w;
    y1 = (raw.y as number) + raw.h;
  } else return null;
  const nums = [x0, y0, x1, y1].map((n) =>
    typeof n === 'number' && Number.isFinite(n) ? n : null,
  );
  if (nums.some((n) => n === null)) return null;
  const [ax, ay, bx, by] = nums as [number, number, number, number];
  const left = clamp01(Math.min(ax, bx));
  const top = clamp01(Math.min(ay, by));
  const right = clamp01(Math.max(ax, bx));
  const bottom = clamp01(Math.max(ay, by));
  if (right - left <= 0 || bottom - top <= 0) return null;
  return { x: round(left), y: round(top), w: round(right - left), h: round(bottom - top) };
}

function parseLines(raw: unknown): DoubtLine[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DoubtLine[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = str(item.id, 8);
    const text = str(item.text, MAX_LINE_CHARS);
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, text, box: parseBox(item.box) });
  }
  return out;
}

/** The doubt as the gateway sends it (`Doubt.as_dict`, plus `say`), or null when it is not one. */
export function parseDoubtRead(raw: unknown): DoubtReadResult | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.doubt, 32);
  const reading = isRecord(raw.reading) ? raw.reading : null;
  if (!id || !reading) return null;
  const climb = isRecord(raw.climb) ? raw.climb : {};
  const nodeId = str(climb.node_id, 64);
  const nodeName = str(climb.node_name, 160);
  const frameworkId = str(climb.framework_id, 128);
  return {
    id,
    createdAt: str(raw.created_at, 40),
    status: raw.status === 'answered' ? 'answered' : 'read',
    words: str(raw.words, 500),
    say: str(raw.say, 600),
    reading: {
      subject: str(reading.subject, 80),
      topic: str(reading.topic, 80),
      question: str(reading.question, 200),
      lines: parseLines(reading.lines),
      width: typeof reading.width === 'number' ? reading.width : 0,
      height: typeof reading.height === 'number' ? reading.height : 0,
    },
    climb: {
      ...(nodeId ? { nodeId } : {}),
      ...(nodeName ? { nodeName } : {}),
      ...(frameworkId ? { frameworkId } : {}),
    },
  };
}

/** The lines that have a place on the page: the targets ink may anchor to. */
export function regionsOf(lines: readonly DoubtLine[]): DoubtRegion[] {
  return lines.flatMap((line, i) =>
    line.box
      ? [
          {
            id: line.id,
            label: line.text.length <= 40 ? line.text : `line ${i + 1}`,
            text: line.text,
            box: line.box,
          },
        ]
      : [],
  );
}

/** The reading in one line, for Wobo's sentence and the memory page. */
export function readingText(lines: readonly { text: string }[], question = ''): string {
  const texts = lines.map((l) => l.text.trim()).filter(Boolean);
  if (texts.length === 0) return question.trim();
  return texts.join('; ');
}

export interface ReadOptions {
  /** The learner's own words about the photo, if they typed any. */
  words?: string;
  /** The board they follow, so the gateway can file the doubt in their syllabus (law 4). */
  frameworkId?: string | null;
}

/** The request body: the bytes and their type, the words, the board. Nothing about the learner. */
export function readPayload(capture: Capture, options: ReadOptions = {}): Record<string, unknown> {
  return {
    image: { data: capture.data, mediaType: capture.mediaType },
    ...(options.words?.trim() ? { words: options.words.trim().slice(0, 500) } : {}),
    ...(options.frameworkId ? { framework_id: options.frameworkId } : {}),
  };
}

export const doubtReadPath = '/v1/doubt';
export const doubtListPath = '/v1/doubt';
export const doubtAnswerPath = (id: string): string => `/v1/doubt/${encodeURIComponent(id)}/answer`;
export const doubtPhotoPath = (id: string): string => `/v1/doubt/${encodeURIComponent(id)}/photo`;
/** Where the memory page's remove reaches: the row and the object in the bucket, by id. */
export const doubtErasePath = (id: string): string => `/v1/doubt/${encodeURIComponent(id)}`;

export type PostJson = (path: string, body: Record<string, unknown>) => Promise<unknown>;

/** The default door: the gateway, with identity and typed refusals from the SDK. */
export function gatewayPost(gatewayUrl: string): PostJson {
  return (path, body) =>
    gatewayJson(`${gatewayUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
}

/**
 * Ask the brain to read the page. A refusal the gateway explains (a face, a live exam, too dark)
 * arrives as `DoubtUnreadable` carrying its line; a reply that is not a reading gets the default.
 */
export async function readDoubt(
  post: PostJson,
  capture: Capture,
  options: ReadOptions = {},
): Promise<DoubtReadResult> {
  let raw: unknown;
  try {
    raw = await post(doubtReadPath, readPayload(capture, options));
  } catch (err) {
    if (err instanceof GatewayError && err.message) throw new DoubtUnreadable(err.message);
    throw err;
  }
  const read = parseDoubtRead(raw);
  if (!read) throw new DoubtUnreadable();
  return read;
}

/** The body of the answer request: every line as the learner left it (an emptied line leaves). */
export function answerBody(
  lines: readonly { id: string; text: string }[],
  words?: string,
): Record<string, unknown> {
  return {
    lines: lines.map((l) => ({
      id: l.id,
      text: l.text.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_CHARS),
    })),
    ...(words?.trim() ? { words: words.trim().slice(0, 500) } : {}),
    // ONE FIELD IS ADDED LATER, and deliberately not here: `standing`, the mark the pen laid on
    // the photo before the request left. Only `wobo/board-turn.ts` knows the id it drew it under,
    // so it puts it on this body on the way out (docs/INK-FOUR.md, the instant mark).
  };
}

/** Every doubt the gateway keeps for this learner, newest first. Throws on a refusal. */
export async function listDoubts(gatewayUrl: string): Promise<DoubtReadResult[]> {
  const raw = await gatewayJson<{ doubts?: unknown }>(`${gatewayUrl}${doubtListPath}`, {
    method: 'GET',
  });
  const items = Array.isArray(raw?.doubts) ? raw.doubts : [];
  return items
    .map(parseDoubtRead)
    .filter((d): d is DoubtReadResult => d !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** The kept photo as an object URL, or null when there is none to show. Revoke it when done. */
export async function doubtPhotoUrl(gatewayUrl: string, id: string): Promise<string | null> {
  try {
    const res = await gatewayFetch(`${gatewayUrl}${doubtPhotoPath(id)}`, { method: 'GET' });
    if (!res.ok) return null;
    await throwForGatewayStatus(res);
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}
