/**
 * THE PARENT'S WIRE, held to the gateway's own contract (services/gateway/src/wobo_gateway/parent_api.py).
 *
 * Every answer below is a body the gateway really sends. The one distinction this file exists for:
 * a 403 is two different things on this plane. `not_a_parent_account` is the parent door saying
 * "this is a student account" (the owner's ruling: a 403, never an empty list), and `doors_closed`
 * is the dial saying no account work happens right now (doors.py, a TOP-LEVEL body, not FastAPI's
 * `detail`). Reading the second as the first would send a real parent to the learner app.
 */

import { describe, expect, it } from 'bun:test';
import {
  readChildren,
  readParentMe,
  refusalOf,
  signUpParent,
  switchChild,
  TROUBLE_LINE,
} from './api';

const GW = 'http://gateway.test';

type Call = { url: string; init?: RequestInit };

function fake(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const offline = (async () => {
  throw new TypeError('Failed to fetch');
}) as unknown as typeof fetch;

describe('who is this account', () => {
  it('reads a parent account, and the four actions are the ceiling the server sent', async () => {
    const { fetcher, calls } = fake(200, {
      kind: 'parent',
      display_name: 'Meera',
      children: 2,
      actions: ['ask', 'pay', 'refer', 'donate'],
    });
    const me = await readParentMe(GW, fetcher);
    expect(calls[0]?.url).toBe(`${GW}/v1/parent/me`);
    expect(me).toEqual({
      kind: 'parent',
      displayName: 'Meera',
      children: 2,
      actions: ['ask', 'pay', 'refer', 'donate'],
    });
  });

  it('drops an action the client does not know rather than drawing a door for it', async () => {
    const { fetcher } = fake(200, {
      kind: 'parent',
      display_name: null,
      children: 0,
      actions: ['ask', 'read_the_chat', 'pay'],
    });
    const me = await readParentMe(GW, fetcher);
    expect(me.kind === 'parent' && me.actions).toEqual(['ask', 'pay']);
  });

  it('reads the parent door refusal as a student account', async () => {
    const { fetcher } = fake(403, {
      detail: {
        code: 'not_a_parent_account',
        message: 'This is not a parent account. Sign in with the parent account to see a child.',
      },
    });
    expect(await readParentMe(GW, fetcher)).toEqual({ kind: 'not-parent' });
  });

  it('never reads the closed dial as a student account', async () => {
    const line =
      'Wobo is not open for new accounts just yet, and the list on the site is how you hear the day it is.';
    const { fetcher } = fake(403, { code: 'doors_closed', message: line });
    expect(await readParentMe(GW, fetcher)).toEqual({ kind: 'closed', message: line });
  });

  it('reads a 401 as nobody signed in', async () => {
    const { fetcher } = fake(401, { detail: { code: 'sign_in_required', message: 'Sign in.' } });
    expect(await readParentMe(GW, fetcher)).toEqual({ kind: 'signed-out' });
  });

  it('says so when the store is down, in the server’s own words', async () => {
    const { fetcher } = fake(503, {
      detail: {
        code: 'store_unavailable',
        message: 'I could not reach that just now. Try again in a moment.',
      },
    });
    expect(await readParentMe(GW, fetcher)).toEqual({
      kind: 'trouble',
      message: 'I could not reach that just now. Try again in a moment.',
    });
  });

  it('says so when nothing answered at all', async () => {
    expect(await readParentMe(GW, offline)).toEqual({ kind: 'trouble', message: TROUBLE_LINE });
  });

  it('knows a build with no gateway has no parent side, and asks nobody', async () => {
    const { fetcher, calls } = fake(200, {});
    expect(await readParentMe(undefined, fetcher)).toEqual({ kind: 'unwired' });
    expect(calls).toEqual([]);
  });
});

describe('becoming a parent account', () => {
  it('posts only a display name: the address comes from the verified token, never the body', async () => {
    const { fetcher, calls } = fake(200, {
      account: { display_name: 'Meera', kind: 'parent' },
      children: [
        {
          learner_id: 'kid-1',
          name: 'Asha',
          relationship: 'linked_parent',
          linked_at: '2026-09-10T08:00:00+00:00',
        },
      ],
    });
    const out = await signUpParent('Meera', GW, fetcher);
    expect(calls[0]?.url).toBe(`${GW}/v1/parent/sign-up`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ display_name: 'Meera' });
    expect(out).toEqual({
      ok: true,
      children: [{ learnerId: 'kid-1', name: 'Asha', linkedAt: '2026-09-10T08:00:00+00:00' }],
    });
  });

  it('sends an empty body when there is no name to give, and never an email field', async () => {
    const { fetcher, calls } = fake(200, { account: {}, children: [] });
    await signUpParent(null, GW, fetcher);
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent).toEqual({});
    expect('email' in sent).toBe(false);
  });

  it('hands back the refusal code and line, so the page can say the true thing', async () => {
    const message =
      'This account is already learning with me, so it cannot also be a parent account. Sign up with a different address and I will link them.';
    const { fetcher } = fake(409, { detail: { code: 'already_a_learner', message } });
    expect(await signUpParent('Meera', GW, fetcher)).toEqual({
      ok: false,
      code: 'already_a_learner',
      message,
    });
  });

  it('reads the closed dial on the sign-up door too', async () => {
    const { fetcher } = fake(403, { code: 'doors_closed', message: 'closed' });
    expect(await signUpParent('Meera', GW, fetcher)).toEqual({
      ok: false,
      code: 'doors_closed',
      message: 'closed',
    });
  });

  it('never throws on a dead network', async () => {
    expect(await signUpParent('Meera', GW, offline)).toEqual({
      ok: false,
      code: 'unreachable',
      message: TROUBLE_LINE,
    });
  });
});

describe('the children, and the switch', () => {
  it('reads the live list and which one is chosen', async () => {
    const { fetcher, calls } = fake(200, {
      children: [
        { learner_id: 'kid-1', name: 'Asha', relationship: 'linked_parent', linked_at: null },
        { learner_id: 'kid-2', name: null, relationship: 'linked_parent', linked_at: null },
      ],
      selected: 'kid-2',
    });
    const out = await readChildren(GW, fetcher);
    expect(calls[0]?.url).toBe(`${GW}/v1/parent/children`);
    expect(out).toEqual({
      ok: true,
      children: [
        { learnerId: 'kid-1', name: 'Asha', linkedAt: null },
        { learnerId: 'kid-2', name: null, linkedAt: null },
      ],
      selected: 'kid-2',
    });
  });

  it('skips a row with no learner id instead of drawing a child with no name and no key', async () => {
    const { fetcher } = fake(200, {
      children: [{ name: 'Ghost' }, { learner_id: 'kid-1', name: 'Asha' }],
      selected: null,
    });
    const out = await readChildren(GW, fetcher);
    expect(out.ok && out.children.map((c) => c.learnerId)).toEqual(['kid-1']);
  });

  it('switches by id, and hands back the fresh scope the device must drop the last child by', async () => {
    const { fetcher, calls } = fake(200, {
      child: { learner_id: 'kid-2', name: 'Kabir', relationship: 'linked_parent', linked_at: null },
      scope: 'scope-2',
    });
    const out = await switchChild('kid-2', GW, fetcher);
    expect(calls[0]?.url).toBe(`${GW}/v1/parent/switch`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ learner_id: 'kid-2' });
    expect(out).toEqual({
      ok: true,
      child: { learnerId: 'kid-2', name: 'Kabir', linkedAt: null },
      scope: 'scope-2',
    });
  });

  it('reads an ended link as the server’s own refusal, never as a switch', async () => {
    const message = 'I do not have a child by that name on this account.';
    const { fetcher } = fake(404, { detail: { code: 'no_such_child', message } });
    expect(await switchChild('kid-9', GW, fetcher)).toEqual({
      ok: false,
      code: 'no_such_child',
      message,
    });
  });

  it('refuses a 200 with no scope: without one the device cannot drop the last child', async () => {
    const { fetcher } = fake(200, { child: { learner_id: 'kid-2' } });
    const out = await switchChild('kid-2', GW, fetcher);
    expect(out.ok).toBe(false);
  });
});

describe('a refusal, whichever shape it came in', () => {
  it('reads FastAPI’s detail and the dial’s top-level body alike', () => {
    expect(refusalOf({ detail: { code: 'a', message: 'one' } })).toEqual({
      code: 'a',
      message: 'one',
    });
    expect(refusalOf({ code: 'b', message: 'two' })).toEqual({ code: 'b', message: 'two' });
    expect(refusalOf(null)).toEqual({ code: 'unknown', message: TROUBLE_LINE });
    expect(refusalOf({ detail: 'a string' })).toEqual({ code: 'unknown', message: TROUBLE_LINE });
  });
});
