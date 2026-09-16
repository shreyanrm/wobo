/**
 * The board change as the You screen reaches it (docs/CONSOLE-ROLES-AND-BOARD.md §1). The rule
 * lives in the gateway (`services/gateway/src/wobo_gateway/board_change.py`); this seam only
 * carries what the gateway answered, and never lets a board move on a guess.
 */

import { describe, expect, it } from 'bun:test';
import { askForChange, changeBoard, parseStanding, readStanding, UNREACHABLE } from './boardChange';

type Call = { url: string; init?: RequestInit };
const recorder = (status: number, body: unknown) => {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as never;
  return { calls, fetcher };
};

const OPEN = {
  board: { framework_id: 'cbse', level: '9' },
  may_change: true,
  used: 0,
  last_changed_at: null,
  granted: false,
  cost: ['a', 'b', 'c'],
  line: null,
  button: null,
  request: null,
};
const CLOSED = {
  ...OPEN,
  may_change: false,
  used: 1,
  cost: [],
  line: 'A board change from here needs a person. Ask us and somebody will look at it.',
  button: 'Ask us to change it',
};

describe('reading where a learner stands', () => {
  it('carries the two shapes the gateway draws', () => {
    expect(parseStanding(OPEN)?.mayChange).toBe(true);
    expect(parseStanding(OPEN)?.cost).toEqual(['a', 'b', 'c']);
    const closed = parseStanding(CLOSED);
    expect(closed?.mayChange).toBe(false);
    expect(closed?.button).toBe('Ask us to change it');
    expect(parseStanding({ hello: 1 })).toBeNull();
  });

  it('never answers a standing it did not read', async () => {
    expect(await readStanding(undefined)).toEqual({ ok: false, message: UNREACHABLE });
    const down = recorder(503, { detail: { message: 'I cannot reach your board right now.' } });
    expect(await readStanding('https://brain', down.fetcher)).toEqual({
      ok: false,
      message: 'I cannot reach your board right now.',
    });
    const thrown = (async () => {
      throw new Error('offline');
    }) as never;
    expect(await readStanding('https://brain', thrown)).toEqual({
      ok: false,
      message: UNREACHABLE,
    });
  });
});

describe('changing the board', () => {
  it('sends the confirmation and where they are coming from, and hands back the new standing', async () => {
    const r = recorder(200, CLOSED);
    const got = await changeBoard(
      { to: 'icse', level: '9', from: 'cbse', fromLevel: '9' },
      'https://brain',
      r.fetcher,
    );
    expect(got.ok).toBe(true);
    expect(r.calls[0]?.url).toBe('https://brain/v1/board/change');
    expect(JSON.parse(String(r.calls[0]?.init?.body))).toEqual({
      framework_id: 'icse',
      level: '9',
      confirm: true,
      current_framework_id: 'cbse',
      current_level: '9',
    });
  });

  it('tells the screen a person is needed, in the gateway’s own words', async () => {
    const r = recorder(409, {
      detail: { code: 'needs_a_person', message: CLOSED.line, button: CLOSED.button },
    });
    const got = await changeBoard(
      { to: 'ib', level: '9', from: 'icse' },
      'https://brain',
      r.fetcher,
    );
    expect(got).toEqual({ ok: false, needsAPerson: true, message: CLOSED.line });
  });

  it('is refused, not assumed, when nothing answers', async () => {
    const got = await changeBoard({ to: 'ib', level: null, from: 'cbse' }, undefined);
    expect(got).toEqual({ ok: false, needsAPerson: false, message: UNREACHABLE });
  });
});

describe('asking a person', () => {
  it('carries the board they are on and the one they want, and nothing else', async () => {
    const r = recorder(200, { message: 'I have this. A person will look at it.' });
    const got = await askForChange(
      { to: 'cbse', level: '9', from: 'icse', fromLevel: '9' },
      'https://brain',
      r.fetcher,
    );
    expect(got).toEqual({ ok: true, message: 'I have this. A person will look at it.' });
    expect(r.calls[0]?.url).toBe('https://brain/v1/board/change/request');
    expect(Object.keys(JSON.parse(String(r.calls[0]?.init?.body))).sort()).toEqual([
      'current_framework_id',
      'current_level',
      'framework_id',
      'level',
    ]);
  });
});
