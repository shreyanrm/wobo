/**
 * The app's half of the activity record (store/activity.ts → POST /v1/me/activity).
 *
 * What is held here: a session is the app on screen and nothing else; the body is exactly what
 * the gateway accepts; progress settles before it is sent and a finished module drops what was
 * waiting; a visitor who is not signed in sends nothing; and a note that cannot land never throws
 * into a lesson.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  ACTIVITY_PATH,
  bodyFor,
  cardsDone,
  closeSession,
  currentSession,
  flushProgress,
  mayRecord,
  noteActivity,
  noteModuleFinished,
  noteProgress,
  noteTopicMastered,
  openSession,
  PROGRESS_SETTLE_MS,
  resetActivity,
  setActivityGate,
  setActivityScheduler,
  setActivityTransport,
  TITLE_MAX,
  watchSessions,
} from './activity';

interface Sent {
  url: string;
  body: Record<string, unknown>;
  keepalive: boolean;
}

let sent: Sent[] = [];
let answer = 204;

function install(): void {
  sent = [];
  answer = 204;
  setActivityTransport(
    async (url: string, init?: RequestInit) => {
      sent.push({
        url,
        body: JSON.parse(String(init?.body ?? '{}')),
        keepalive: init?.keepalive === true,
      });
      if (answer === 0) throw new Error('offline');
      return new Response(null, { status: answer });
    },
    () => 'http://brain.test',
  );
}

/** Lets a note's promise settle. No clock is involved: the fetch is called synchronously. */
const settle = () => Promise.resolve();

/** The clock, handed in: a pending timer runs when the test moves time past it, never by waiting. */
let clock = 0;
let timers: { id: number; at: number; fn: () => void }[] = [];
let nextTimer = 1;
function advance(ms: number): void {
  clock += ms;
  const due = timers.filter((t) => t.at <= clock).sort((a, b) => a.at - b.at);
  timers = timers.filter((t) => t.at > clock);
  for (const t of due) t.fn();
}

class FakePage {
  visibilityState = 'visible';
  private fns = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void): void {
    if (!this.fns.has(type)) this.fns.set(type, new Set());
    this.fns.get(type)?.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.fns.get(type)?.delete(fn);
  }
  fire(type: string): void {
    for (const fn of this.fns.get(type) ?? []) fn();
  }
  listeners(): number {
    let n = 0;
    for (const set of this.fns.values()) n += set.size;
    return n;
  }
}

beforeEach(() => {
  resetActivity();
  install();
  clock = 0;
  timers = [];
  setActivityScheduler({
    set: (fn, ms) => {
      const id = nextTimer++;
      timers.push({ id, at: clock + ms, fn });
      return id;
    },
    clear: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
  });
});

afterEach(() => {
  resetActivity();
  setActivityTransport(null);
  setActivityScheduler(null);
});

describe('a session is the app on screen', () => {
  it('opens once, with a uuid, and closes as the page is hidden', async () => {
    const id = openSession();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(openSession()).toBe(id as string);
    closeSession();
    await settle();
    expect(sent.map((s) => s.body)).toEqual([
      { kind: 'session_start', session: id as string, surface: 'pwa' },
      { kind: 'session_end', session: id as string },
    ]);
    expect(sent.every((s) => s.url === `http://brain.test${ACTIVITY_PATH}`)).toBe(true);
    // the end is sent as the page goes, so it has to outlive the page
    expect(sent[1]?.keepalive).toBe(true);
    expect(currentSession()).toBeNull();
  });

  it('follows visibility: hidden closes, visible opens a new one, and unsubscribing closes', async () => {
    const doc = new FakePage();
    const win = new FakePage();
    const stop = watchSessions(doc, win);
    const first = currentSession();
    expect(first).not.toBeNull();
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    expect(currentSession()).toBeNull();
    doc.visibilityState = 'visible';
    doc.fire('visibilitychange');
    const second = currentSession();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    win.fire('pagehide');
    expect(currentSession()).toBeNull();
    doc.fire('visibilitychange');
    stop();
    await settle();
    expect(doc.listeners() + win.listeners()).toBe(0);
    expect(currentSession()).toBeNull();
    const kinds = sent.map((s) => s.body.kind);
    expect(kinds.filter((k) => k === 'session_start').length).toBe(
      kinds.filter((k) => k === 'session_end').length,
    );
  });

  it('opens nothing for a page that starts hidden', async () => {
    const doc = new FakePage();
    doc.visibilityState = 'hidden';
    const stop = watchSessions(doc, new FakePage());
    expect(currentSession()).toBeNull();
    stop();
    await settle();
    expect(sent).toEqual([]);
  });
});

describe('nothing is sent for a visitor who is not signed in', () => {
  it('holds every kind of note behind the gate', async () => {
    setActivityGate(() => false);
    expect(openSession()).toBeNull();
    noteProgress('t1', 'Fractions', 2, 9);
    noteModuleFinished('t1', 'Fractions');
    noteTopicMastered('t1', 'Fractions');
    flushProgress();
    closeSession();
    expect(await noteActivity({ kind: 'module_finished', ref: 't1' })).toBe(false);
    await settle();
    expect(sent).toEqual([]);
  });

  it('sends nothing when no gateway is configured', async () => {
    setActivityTransport(
      async () => new Response(null, { status: 204 }),
      () => undefined,
    );
    expect(openSession()).toBeNull();
    expect(await noteActivity({ kind: 'topic_mastered', ref: 't1' })).toBe(false);
  });
});

describe('the body is what the gateway accepts', () => {
  it('bounds the title, trims the ref and keeps card counts whole', () => {
    const body = bodyFor({
      kind: 'progress',
      ref: `  ${'r'.repeat(300)}  `,
      title: `Linear   equations ${'x'.repeat(400)}`,
      done: 2.7,
      total: 9000,
    });
    expect(String(body.ref).length).toBe(128);
    expect(String(body.title).length).toBe(TITLE_MAX);
    expect(String(body.title).startsWith('Linear equations ')).toBe(true);
    expect(body.done).toBe(2);
    expect(body.total).toBe(500);
    expect(Object.keys(body).sort()).toEqual(['done', 'kind', 'ref', 'title', 'total']);
  });

  it('never sends a field the gateway would refuse', () => {
    for (const note of [
      { kind: 'session_start' as const, session: 's' },
      { kind: 'session_end' as const, session: 's' },
      { kind: 'module_finished' as const, ref: 't', title: '' },
    ]) {
      const keys = Object.keys(bodyFor(note));
      for (const key of keys) {
        expect(['kind', 'session', 'surface', 'ref', 'title', 'done', 'total']).toContain(key);
      }
      expect(keys).not.toContain('at');
      expect(keys).not.toContain('subject');
    }
    expect(bodyFor({ kind: 'session_end', session: 's' })).toEqual({
      kind: 'session_end',
      session: 's',
    });
  });

  it('a refusal or a dropped connection is a false, never a throw', async () => {
    answer = 503;
    expect(await noteActivity({ kind: 'topic_mastered', ref: 't1' })).toBe(false);
    answer = 0;
    expect(await noteActivity({ kind: 'topic_mastered', ref: 't1' })).toBe(false);
    answer = 204;
    expect(await noteActivity({ kind: 'topic_mastered', ref: 't1' })).toBe(true);
  });
});

describe('progress settles, and a finished module drops what was waiting', () => {
  it('sends the latest report once, after it settles', async () => {
    noteProgress('t1', 'Fractions', 1, 9);
    noteProgress('t1', 'Fractions', 2, 9);
    noteProgress('t1', 'Fractions', 3, 9);
    advance(PROGRESS_SETTLE_MS - 1);
    expect(sent).toEqual([]);
    advance(1);
    expect(sent.map((s) => s.body)).toEqual([
      { kind: 'progress', ref: 't1', title: 'Fractions', done: 3, total: 9 },
    ]);
    expect(timers).toEqual([]);
  });

  it('flushes what is waiting when the session closes', async () => {
    openSession();
    noteProgress('t1', 'Fractions', 4, 9);
    closeSession();
    await settle();
    const progress = sent.find((s) => s.body.kind === 'progress');
    expect(progress?.body).toEqual({
      kind: 'progress',
      ref: 't1',
      title: 'Fractions',
      done: 4,
      total: 9,
    });
    expect(progress?.keepalive).toBe(true);
  });

  it('a module finished cancels its own waiting report and leaves another chapter’s', async () => {
    noteProgress('t1', 'Fractions', 8, 9);
    noteProgress('t2', 'Decimals', 1, 9);
    noteModuleFinished('t1', 'Fractions');
    advance(PROGRESS_SETTLE_MS);
    await settle();
    expect(sent.map((s) => s.body)).toEqual([
      { kind: 'module_finished', ref: 't1', title: 'Fractions' },
      { kind: 'progress', ref: 't2', title: 'Decimals', done: 1, total: 9 },
    ]);
  });

  it('a chapter with no cards is not progress', async () => {
    noteProgress('t1', 'Fractions', 0, 0);
    flushProgress();
    await settle();
    expect(sent).toEqual([]);
  });
});

describe('cards done', () => {
  it('counts whole cards passed, never the placeholder before the first', () => {
    expect(cardsDone(0.08, 9)).toBe(0);
    expect(cardsDone(0.5, 10)).toBe(5);
    expect(cardsDone(1, 9)).toBe(9);
    expect(cardsDone(2, 9)).toBe(9);
    expect(cardsDone(Number.NaN, 9)).toBe(0);
    expect(cardsDone(0.5, 0)).toBe(0);
  });
});

describe('who may write the record', () => {
  const account = (authenticated: boolean, anonymous: boolean) => ({
    isAuthenticated: () => authenticated,
    isAnonymous: () => anonymous,
  });

  it('a signed-in learner, and never a visitor', () => {
    expect(mayRecord(account(true, false))).toBe(true);
    expect(mayRecord(account(true, true))).toBe(false);
    expect(mayRecord(account(false, false))).toBe(false);
  });

  it('a build with no account layer leaves it to the gateway’s own door', () => {
    expect(mayRecord(null)).toBe(true);
    expect(mayRecord(undefined)).toBe(true);
  });
});
