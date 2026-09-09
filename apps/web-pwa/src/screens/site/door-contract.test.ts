/**
 * THE SEAM. The browser's half of `contracts/doors.json`, asserted against the real parsers.
 *
 * Two suites were green while three contract breaks shipped in one wave: the list posted to a path
 * the gateway does not serve, under field names the gateway forbids, with a page NAME where the
 * gateway wants a path; and the dial read a key the gateway never wrote, which made it a one-way
 * valve the owner could never reopen. Each side had tested itself against its own hand-written
 * mock, and nothing anywhere asserted that the two agreed.
 *
 * So one file names the two addresses and the exact bodies that cross them, and BOTH suites read
 * it with their own real code. `services/gateway/tests/test_door_contract.py` drives the routes
 * the app actually serves; this drives `readDial` and `joinList`, which are the functions the
 * browser actually runs. A path or a key changed on one side alone now fails on both.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIAL_PATH, readDial } from './dial';
import { joinList, LIST_PATH, type ListSource, listBody, SOURCE_PATH } from './invitation';

const CONTRACT = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../../../contracts/doors.json'), 'utf8'),
) as {
  dial: { path: string; body: Record<string, boolean> };
  list: { path: string; body: Record<string, string> };
};

/** The gateway's own answer, as the fixture records it, handed to the browser's own parser. */
function serves(body: unknown, ok = true): typeof fetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('the dial, across the seam', () => {
  it('asks the address the gateway serves', () => {
    expect(DIAL_PATH).toBe(CONTRACT.dial.path);
  });

  it('reads the key the gateway actually answers under', async () => {
    // The break: the gateway said `{ open: ... }` and this parser read `doors_open`, so every
    // browser read false forever and the owner could shut the door but never reopen it.
    const key = Object.keys(CONTRACT.dial.body)[0] as string;
    expect(await readDial('https://b', serves({ ...CONTRACT.dial.body, [key]: true }))).toBe(true);
    expect(await readDial('https://b', serves({ ...CONTRACT.dial.body, [key]: false }))).toBe(
      false,
    );
  });

  it('still reads every other shape as closed', async () => {
    expect(await readDial('https://b', serves({ open: true }))).toBe(false);
    expect(await readDial('https://b', serves(null))).toBe(false);
    expect(await readDial('https://b', serves(CONTRACT.dial.body, false))).toBe(false);
  });
});

describe('the list, across the seam', () => {
  it('posts to the address the gateway serves', () => {
    expect(LIST_PATH).toBe(CONTRACT.list.path);
  });

  it('sends the field names the gateway takes, and no field it forbids', async () => {
    // `JoinBody` is extra="forbid", so a field this app invented is a 422 and not a dropped
    // value. `where` and `source` were both invented, and both are why nobody reached the list.
    let sent: Record<string, unknown> = {};
    let asked = '';
    const capture = (async (url: string, init: RequestInit) => {
      asked = url;
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return { ok: true, status: 200, json: async () => ({ message: 'kept' }) };
    }) as unknown as typeof fetch;
    const outcome = await joinList(
      'https://api.example.com',
      { email: CONTRACT.list.body.email as string, where: 'class 9 CBSE', source: 'sign-up' },
      capture,
    );
    expect(outcome.joined).toBe(true);
    expect(asked).toBe(`https://api.example.com${CONTRACT.list.path}`);
    expect(Object.keys(sent).sort()).toEqual(Object.keys(CONTRACT.list.body).sort());
    expect(sent).toEqual(CONTRACT.list.body);
  });

  it('says which page they came from as a path, never as a name', () => {
    // `_PAGE_RE` on the gateway requires a leading slash, so 'sign-up' was refused as surely as
    // an unknown field was.
    for (const [source, path] of Object.entries(SOURCE_PATH)) {
      expect([source, path.startsWith('/')]).toEqual([source, true]);
    }
    expect(listBody({ email: 'a@b.co', source: 'sign-up' }).page).toBe(
      CONTRACT.list.body.page as string,
    );
  });

  it('drops a class and a board it cannot read rather than losing the address', () => {
    // The gateway's normalisers drop an unreadable optional field; this side must not send a
    // shape that turns one into a refusal of the whole body.
    const body = listBody({ email: 'a@b.co', where: '!!!', source: 'home' });
    expect(body.email).toBe('a@b.co');
    expect(body.class).toBeUndefined();
    expect(body.board).toBeUndefined();
  });

  it('reads a class and a board out of the one field a reader is given', () => {
    const cases: Array<[string, string | undefined, string | undefined]> = [
      ['class 9 CBSE', 'class 9', 'CBSE'],
      ['9 CBSE', '9', 'CBSE'],
      ['CBSE class 10', 'class 10', 'CBSE'],
      ['ICSE', undefined, 'ICSE'],
      ['11', '11', undefined],
      ['grade 8, Maharashtra State Board', 'grade 8', 'Maharashtra State Board'],
    ];
    for (const [text, klass, board] of cases) {
      const body = listBody({ email: 'a@b.co', where: text, source: 'home' });
      expect([text, body.class, body.board]).toEqual([text, klass, board]);
    }
  });

  it('covers every source the site can post from', () => {
    const sources: ListSource[] = [
      'sign-up',
      'home',
      'plans',
      'checkout',
      'onboarding',
      'syllabus',
      'help',
    ];
    for (const source of sources) expect(SOURCE_PATH[source]).toBeTruthy();
  });
});
