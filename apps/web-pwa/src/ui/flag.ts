/**
 * The quiet flag: what a child taps, and what it says to the brain.
 *
 * THE PROMISE THIS KEEPS. The help centre published "there is a quiet flag on every lesson,
 * question, board and diagram" and an error screen told a child to use it, and there was no such
 * control anywhere in the app: no component, no button, no call. `docs/conformance/
 * content-and-safety.md` §6.1 called it the most quotable failure in its register, because a child
 * told to report something and unable to find the control learns that nobody is listening, which
 * is worse than never having promised it. `apps/web-pwa/src/screens/site/promises.test.ts` has a
 * probe watching this exact module for the call below; the day it finds one the honesty rule
 * retires itself, and the copy that disclaimed the control has to be rewritten in the same commit.
 *
 * THE INTAKE ALREADY EXISTED. `services/gateway/src/wobo_gateway/reports.py` owns `POST /v1/flags`,
 * `ops.reports` and the flag desk in the console. Nothing here builds a second queue, a second
 * endpoint or a second desk: this module is the last few centimetres between a child's thumb and a
 * row on a desk a person works through.
 *
 * THE RULES THE CONTROL IS BUILT UNDER, and every one of them is a line of code below:
 *
 *  - **A tap is enough.** `note` is optional, exactly as the gateway's own contract has it: "a
 *    child who taps 'this upset me' and types nothing has made a complete report and the control
 *    must not demand more". Nothing here asks a child to justify themselves.
 *  - **It never claims what is not built.** There is no case number, no turnaround, no message back
 *    when it is settled and no score. The answer is Wobo's own line, and when the brain sends its
 *    own we use that one instead, so the two can never drift apart.
 *  - **A failure is said out loud.** A report that did not reach anybody must never look like one
 *    that did. When the post fails the child is told plainly, and given the one mailbox
 *    (support@heywobo.com) that always works.
 *  - **A learner's work never leaves the learner plane.** `about` is a closed set of POINTERS at
 *    what was on screen. It is filtered here to the same allow-list `reports.ABOUT_KEYS` filters on
 *    arrival, so nothing a child wrote or drew can ride along inside a key nobody is watching.
 */

import { gatewayFetch } from '@wobo/sdk';

/** Where a flag lands. The gateway's route, and the string the honesty probe looks for. */
export const FLAG_PATH = '/v1/flags';

/**
 * The reasons, in the gateway's own order (`reports.REASONS['flag']`). `code` is what is sent;
 * `label` is what a child reads, and it is a whole sentence in their own voice rather than a
 * category name, because "not_my_syllabus" is a thing an operator says and "this isn't what I'm
 * studying" is a thing a child says.
 *
 * The two that the gateway treats as urgent (`upsetting`, `unsafe`) are not marked, ranked or
 * coloured here. A child in trouble should not have to notice that one of these buttons is the
 * serious one, and a child who is fine should not be nudged towards it.
 */
export const FLAG_REASONS: readonly { code: string; label: string }[] = [
  { code: 'wrong', label: 'This looks wrong' },
  { code: 'confusing', label: "I don't understand this" },
  { code: 'upsetting', label: 'This upset me' },
  { code: 'unsafe', label: "This shouldn't be here" },
  { code: 'not_my_syllabus', label: "This isn't what I'm studying" },
  { code: 'other', label: 'Something else' },
];

/** Every word the control says. One place, so a review can read the whole voice at once. */
export const FLAG_COPY = {
  /** The control itself. Quiet, and it says what it does rather than naming a feature. */
  open: 'Tell Wobo',
  openHint: 'Tell Wobo something is wrong here',
  title: 'Tell Wobo what is wrong',
  /** The invitation. It promises that one tap finishes the job, because one tap does. */
  invite: 'Tap whatever fits. You do not have to explain.',
  noteLabel: 'You can say more if you want to',
  notePlaceholder: 'Only if you want to',
  sending: 'Sending.',
  /**
   * The answer. It is the gateway's own sentence (`reports.raise_flag`), repeated here for the
   * moment the brain answers without one. It promises exactly one thing, and that thing is true:
   * a person reads these. No case number, no time, no message back.
   */
  thanks: 'Thank you for telling me. A person reads these.',
  /** The honest failure. It never pretends the report was kept. */
  trouble:
    'I could not send that just now. You can write to support@heywobo.com and a person will read it.',
  close: 'Close',
} as const;

/**
 * The pointers at what was on screen. Six of the eight keys `reports.ABOUT_KEYS` accepts, and
 * nothing else exists to put a learner's own words in.
 *
 * The two the client does not send are `capability` and `build`: neither is a pointer at what the
 * child was looking at, and the gateway knows both already from the request itself.
 */
export interface FlagAbout {
  /** What kind of thing this is: a lesson, a question, a board, a diagram. */
  surface?: string;
  /** Which one: a topic id, a practice item id, a board's title. */
  content_id?: string;
  subject?: string;
  route?: string;
  board?: string;
  grade?: string;
}

/** The value shape `reports._ABOUT_VALUE_RE` accepts. Anything else is dropped on arrival. */
const VALUE_OK = /^[\w .:@/#+-]{1,200}$/;
const MAX_NOTE = 2000;

/** Past this much repair a pointer is no longer the thing it was, so it is dropped instead. */
const MANGLED = 0.25;

/**
 * Trim a pointer to something the desk will actually keep, or drop it.
 *
 * The gateway drops a value it cannot match, silently and correctly. Doing the same repair HERE is
 * what stops a lesson id with a comma in it from arriving as a row with no lesson on it: the
 * characters outside the set become dashes rather than the whole pointer becoming nothing.
 *
 * The repair has a floor, though. A board titled "a² + b² = c²" survives it as "a- - b- - c-",
 * which is not a pointer at anything: it is noise on a desk somebody has to read. Past a quarter
 * of the characters the value is dropped, and the row simply says less rather than saying rubbish.
 */
function pointer(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, 200);
  if (!trimmed) return null;
  const text = trimmed.replace(/[^\w .:@/#+-]/g, '-');
  let changed = 0;
  for (let i = 0; i < text.length; i += 1) if (text[i] !== trimmed[i]) changed += 1;
  if (changed / text.length > MANGLED) return null;
  return VALUE_OK.test(text) ? text : null;
}

/** The `about` map, filtered to the pointers and stripped of everything empty. */
export function aboutOf(about: FlagAbout | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['surface', 'content_id', 'subject', 'route', 'board', 'grade'] as const) {
    const value = pointer(about?.[key]);
    if (value) out[key] = value;
  }
  return out;
}

export interface FlagReport {
  reason: string;
  /** The child's own words. Optional, always, and never asked for twice. */
  note?: string;
  about?: FlagAbout;
}

export interface FlagOutcome {
  /** Whether a row actually reached the desk. The control never says thank you when this is false. */
  sent: boolean;
  /** What the child is told. Wobo's voice either way. */
  message: string;
}

export interface FlagDeps {
  gatewayUrl?: string | undefined;
  fetcher?: typeof gatewayFetch;
}

/**
 * Raise one flag. Never throws, and never resolves to a thank-you it has not earned.
 *
 * A refusal the brain explains in its own words (the twenty-a-day limit, a reason it does not
 * know) is passed straight through, because that sentence is already Wobo's and is more useful
 * than a generic apology. Anything else is the honest failure line.
 */
export async function raiseFlag(report: FlagReport, deps: FlagDeps = {}): Promise<FlagOutcome> {
  const base = (deps.gatewayUrl ?? import.meta.env?.VITE_GATEWAY_URL ?? '').replace(/\/$/, '');
  if (!base) return { sent: false, message: FLAG_COPY.trouble };
  const note = (report.note ?? '').trim().slice(0, MAX_NOTE);
  const body: Record<string, unknown> = { reason: report.reason };
  if (note) body.note = note;
  const about = aboutOf(report.about);
  if (Object.keys(about).length > 0) body.about = about;
  const fetcher = deps.fetcher ?? gatewayFetch;
  try {
    const res = await fetcher(`${base}${FLAG_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const answer = (await res.json().catch(() => null)) as {
      message?: string;
      detail?: { message?: string };
    } | null;
    const said =
      typeof answer?.message === 'string'
        ? answer.message
        : typeof answer?.detail?.message === 'string'
          ? answer.detail.message
          : null;
    if (!res.ok) return { sent: false, message: said ?? FLAG_COPY.trouble };
    return { sent: true, message: said ?? FLAG_COPY.thanks };
  } catch {
    return { sent: false, message: FLAG_COPY.trouble };
  }
}
