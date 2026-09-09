/**
 * THE INVITATION: every word of what stands where the door was, and the one request that carries
 * an address to the brain.
 *
 * `docs/DOORS-CLOSED.md`, owner 2026-09-09: *"Block any account creations for now until further
 * notice, because we have SEO, AEO and GEO but no product yet."* The door does not disappear. It
 * changes what it opens onto: an email address, optionally a class and board, and one plain
 * sentence saying Wobo is not open yet and that they will hear the day it is.
 *
 * WHY THE WORDS LIVE IN ONE FILE, exactly as `cta.ts` does. Nineteen surfaces carried the old
 * door. If each of them wrote its own version of "not open yet", the site would say nineteen
 * slightly different things about the single most important fact about it, and a reader who saw
 * two of them would learn that we do not know our own state. One object, read everywhere.
 *
 * WHAT IS DELIBERATELY ABSENT, and each of these was a real temptation:
 *
 *  · **No queue position and no number.** Not "you are 412th", not "join 3,000 others". The first
 *    is theatre and the second is a figure we would have to invent (`docs/SELL.md` §5, §9).
 *  · **No countdown, and no date.** We do not know the day, so we do not print one. The honest
 *    version of a date is "the day it opens".
 *  · **No "coming soon" in a large font.** A page whose loudest words are an apology for not
 *    existing has nothing else to say; this one says what it will be and then asks for one thing.
 *  · **No second promise.** One mail, the day it opens, and nothing else ever. Anything more
 *    would be a promise the mailing has to keep later (`voice.md` §6: copy is a contract).
 *
 * The address is a person's, so it is taken with the same care as everything else: one field, its
 * source recorded so we know which page earned it, and never a child's own address (§3, and
 * `docs/legal/childrens-privacy.md` §2 — under 13 it is a parent's or nothing).
 */

import { GATEWAY_COPY } from '@wobo/sdk';

/**
 * Where the address lands: the gateway's own list route, beside `/v1/ask` and `/v1/flags`.
 *
 * IT IS NOT OURS TO PICK. This constant, the field names below and the dial's key all live in
 * `contracts/doors.json`, read by this app's own tests AND by the gateway's, because the first
 * cut of this wave shipped `/v1/list` against a gateway serving `/v1/waiting-list` and both
 * suites were green: each had tested itself against its own mock, and 438 pre-rendered files
 * carried a 404 as their only way to reach us.
 */
export const LIST_PATH = '/v1/waiting-list';

/** How much of anything we will keep, so a paste cannot become a payload. */
const MAX_EMAIL = 254;
const MAX_WHERE = 80;
const MAX_CLASS = 16;
const MAX_BOARD = 64;

/**
 * The two shapes the gateway will keep. Copied from `waiting_list.py` deliberately rather than
 * approximated: a value that fails there is DROPPED, so a class we send in a shape it cannot read
 * is a class nobody ever learns, silently, while the request still answers yes.
 */
const CLASS_SHAPE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,15}$/;
const BOARD_SHAPE = /^[A-Za-z0-9][A-Za-z0-9 .&()/-]{0,63}$/;

/** A class as a person writes it, anywhere in the line: "class 9", "grade 8", "XII", or just "9". */
const CLASS_IN_LINE =
  /(?:^|[\s,;·|-])((?:class|grade|std|standard)\s*\.?\s*(?:[0-9]{1,2}|[ivx]{1,5})|[0-9]{1,2})(?=$|[\s,;·|-])/i;
/** What separates the two halves of that one field, once the class is taken out of it. */
const EDGES = /^[\s,;·|/-]+|[\s,;·|/-]+$/g;

/**
 * Which page a person was reading when they joined. It is recorded because it is genuinely useful
 * (which pages the search work turns into people) and because knowing it means never having to ask
 * a reader where they came from.
 */
export type ListSource =
  | 'sign-up'
  | 'home'
  | 'plans'
  | 'checkout'
  | 'onboarding'
  | 'syllabus'
  | 'help';

/**
 * The same thing as a PATH, which is the only form the gateway will keep.
 *
 * `waiting_list.py` takes `page` and requires a leading slash, on purpose: a visitor's referrer is
 * not to be trusted with a full address or a query string, so the column holds our own paths and
 * nothing else. The first cut sent the page's NAME under the name `source`, so every row would
 * have been refused twice over. A name is what the calling screen knows; the path is what the
 * list stores, and this table is the one place the two are held together.
 */
export const SOURCE_PATH: Record<ListSource, string> = {
  'sign-up': '/sign-up',
  home: '/',
  plans: '/plans',
  checkout: '/plans/checkout',
  onboarding: '/onboarding',
  syllabus: '/syllabus',
  help: '/help',
};

export const LIST = {
  /**
   * The door, on every public surface, while the dial is off. Two words, plain, and it describes
   * exactly what pressing it does. Not "get early access", which sells a privilege we are not
   * granting, and not "notify me", which is a setting rather than a sentence.
   */
  label: 'Join the list',
  /**
   * The one line under the door, and the only thing the door claims. Both halves are facts: it is
   * not open, and there will be one mail.
   */
  under: 'Wobo is not open yet. One mail the day it is.',
  /** The panel's heading. The whole truth of the moment, in five words, in the register. */
  title: 'Wobo is not open yet',
  /**
   * What it will be, in one line. `voice.md` §8.5: wherever a sentence says Wobo draws, a
   * neighbouring word names another form, so nobody reads "a drawing app" off this page.
   */
  what: 'It will be a tutor that draws the answer, films it, speaks it and practises it with you, on the syllabus your own board sets.',
  /** What we do with the address, stated before it is asked for. */
  promise: 'Leave your email and I will write once, the day it opens. Nothing else, ever.',
  emailLabel: 'Your email',
  /**
   * The under-13 rule, said where it applies rather than in a policy nobody opens. No age is
   * asked and no age is stored: a child reads this and hands the field to a parent, which is the
   * only version of this that takes no child's address at all.
   */
  emailHint: 'Under 13, ask a parent or guardian to leave their address instead of yours.',
  whereLabel: 'Your class and board',
  /**
   * Optional, and it says why it is worth giving. It decides which boards are read first
   * (docs/BOARD-COLD-START.md), which is a real answer rather than "to help us serve you better".
   */
  whereHint: 'Optional. It tells me which board to read first.',
  send: 'Join the list',
  sending: 'Sending.',
  /** The answer. It promises exactly one thing, and that thing is the thing we will do. */
  done: 'You are on the list. I will write once, the day Wobo opens.',
  /** The honest failure. It never pretends an address was kept when it was not. */
  trouble: 'I could not add you just now. Try once more, or write to support@heywobo.com.',
  /** The other door, quiet and never at the same weight. It has never stopped working. */
  signIn: 'Already have an account? Sign in',
  /**
   * FOR A READER WITH NOTHING RUNNING, and it is the whole path rather than a footnote.
   *
   * The panel used to leave a live submit button beside this line. A native form post is
   * `application/x-www-form-urlencoded` and the list takes a JSON body, and the action is on
   * another hostname, so pressing it threw the reader off the site onto a raw error page with no
   * header, no footer and no way back. So with nothing running the form is not drawn at all and
   * this is what stands in its place: one address, and a person on the other end of it.
   */
  noScript: 'Nothing is running in this browser, so write to',
  /** The address, drawn as a real link so it opens the reader's own mail. */
  supportEmail: 'support@heywobo.com',
  /** The rest of that sentence. Split so the address in the middle can be a link. */
  noScriptEnd: 'and a person will add you to the list.',
} as const;

export interface ListEntry {
  email: string;
  /** A class and a board, in the reader's own words, or nothing at all. */
  where?: string;
  source: ListSource;
}

export interface ListOutcome {
  /** Whether a row actually reached the list. The panel never says thank you without one. */
  joined: boolean;
  /** What the reader is told. Wobo's voice either way. */
  message: string;
}

/** The shape a browser will accept before anything is sent. Deliberately generous. */
export function looksLikeEmail(value: string): boolean {
  const text = value.trim();
  return text.length > 2 && text.length <= MAX_EMAIL && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(text);
}

/** What the gateway stores, out of the one optional field a reader is actually shown. */
export interface Where {
  class?: string;
  board?: string;
}

/**
 * Read a class and a board out of one line, and keep only what the list can store.
 *
 * ONE FIELD IS THE DECISION, and it is not the gateway's to unmake. `docs/SELL.md` §8: a field
 * that is not strictly needed costs conversions, and the law asks for two fields at most with the
 * second optional. So the reader writes "class 9 CBSE" and this splits it, rather than the page
 * asking twice for one answer.
 *
 * Anything that will not fit the column is DROPPED and never sent, which is what the gateway
 * would do with it anyway. The address is the field that matters; nothing optional may cost it.
 */
export function splitWhere(raw: string | undefined): Where {
  const text = (raw ?? '').trim().slice(0, MAX_WHERE).replace(/\s+/g, ' ');
  if (!text) return {};
  const found = CLASS_IN_LINE.exec(text);
  const klass = found?.[1]?.trim();
  const rest = (found ? text.replace(found[1] as string, ' ') : text).replace(EDGES, '').trim();
  const out: Where = {};
  if (klass && klass.length <= MAX_CLASS && CLASS_SHAPE.test(klass)) out.class = klass;
  if (rest && rest.length <= MAX_BOARD && BOARD_SHAPE.test(rest)) out.board = rest;
  return out;
}

/** Exactly what is posted, by the names the gateway takes. Nothing else may be added here. */
export interface ListBody {
  email: string;
  class?: string;
  board?: string;
  page: string;
}

/**
 * The body, built once, in one place, so the panel and the test and the markup cannot drift.
 *
 * `JoinBody` on the gateway is `extra="forbid"`, which is the line that makes it true that no
 * name, no date of birth and no age can reach the list. It also means a field we invent is a
 * refusal of the whole body rather than a dropped value, which is exactly what `where` and
 * `source` were.
 */
export function listBody(entry: ListEntry): ListBody {
  const { class: klass, board } = splitWhere(entry.where);
  return {
    email: entry.email.trim().slice(0, MAX_EMAIL).toLowerCase(),
    ...(klass ? { class: klass } : {}),
    ...(board ? { board } : {}),
    page: SOURCE_PATH[entry.source] ?? '/',
  };
}

/**
 * Join the list. Never throws, and never resolves to a thank-you it has not earned.
 *
 * A refusal the brain explains in its own words is passed straight through, because that sentence
 * is already Wobo's; anything else is the honest failure line.
 */
export async function joinList(
  gatewayUrl: string,
  entry: ListEntry,
  fetchImpl: typeof fetch = fetch,
): Promise<ListOutcome> {
  const base = (gatewayUrl ?? '').replace(/\/$/, '');
  if (!base) return { joined: false, message: LIST.trouble };
  const email = entry.email.trim().slice(0, MAX_EMAIL);
  if (!looksLikeEmail(email)) return { joined: false, message: LIST.trouble };
  const body = listBody({ ...entry, email });
  try {
    const res = await fetchImpl(`${base}${LIST_PATH}`, {
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
    if (!res.ok) return { joined: false, message: said ?? LIST.trouble };
    return { joined: true, message: said ?? LIST.done };
  } catch {
    return { joined: false, message: GATEWAY_COPY.trouble };
  }
}

/**
 * THE WHOLE NO-JAVASCRIPT BLOCK, AS MARKUP, because a `noscript` carries markup and not elements.
 *
 * A `noscript` element in a page that is running JavaScript holds RAW TEXT, not a tree: that is
 * what the parser does with it and what the serialiser gives back. React children written into
 * one therefore do not reach the 438 pre-rendered files at all, which ship with an empty
 * `<noscript></noscript>` — exactly the readers the block was written for, and exactly the files
 * they read. Written as one string it survives both paths: the browser stores it as text and
 * hands it back literally when the build captures the page, and a browser with scripting off
 * parses it as the markup it is.
 *
 * Every character of it is ours; nothing here is ever built from anything a reader typed.
 */
export const NO_SCRIPT_HTML: string =
  '<style>.jl-form{display:none}</style>' +
  `<p class="jl-hint jl-noscript">${LIST.noScript} ` +
  `<a href="mailto:${LIST.supportEmail}">${LIST.supportEmail}</a> ${LIST.noScriptEnd}</p>`;
