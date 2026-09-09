/**
 * NO ACCOUNT IS MINTED WHILE THE DOOR IS SHUT, INCLUDING THE ANONYMOUS ONE.
 *
 * `docs/DOORS-CLOSED.md` §1 and §4. The gateway refuses an anonymous principal's calls and always
 * did; what nothing refused was the account being CREATED, because that happens at the auth server
 * with the public key and never reaches the gateway. So a stranger who typed an ordinary address
 * had an anonymous account minted for them on boot, before the invitation was drawn, and rows were
 * written under it.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  configureGatewayAuth,
  createSdk,
  DOORS_KEY,
  DOORS_PATH,
  mayCreateAccount,
  resetDoors,
} from '../src/index';

const CONTRACT = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../contracts/doors.json'), 'utf8'),
) as { dial: { path: string; body: Record<string, boolean> } };

const ANON = 'aaaaaaaa-1111-4222-8333-444444444444';
const realFetch = globalThis.fetch;

function fakeJwt(sub: string, claims: Record<string, unknown> = {}): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64({ sub, role: 'authenticated', ...claims })}.sig`;
}

/** A gateway with the dial in a known position, and an auth server that would sign anybody up. */
function world(open: boolean | 'unreachable') {
  const calls: string[] = [];
  globalThis.fetch = ((url: string | URL | Request) => {
    const at = String(url);
    calls.push(at);
    if (at.endsWith(DOORS_PATH)) {
      if (open === 'unreachable') return Promise.reject(new Error('offline'));
      return Promise.resolve(Response.json({ [DOORS_KEY]: open }));
    }
    if (at.endsWith('/auth/v1/signup')) {
      return Promise.resolve(
        Response.json({
          access_token: fakeJwt(ANON, { is_anonymous: true }),
          refresh_token: 'r-anon',
          expires_in: 3600,
          user: { id: ANON },
        }),
      );
    }
    return Promise.resolve(
      Response.json({ capability: 'wobo.turn', output: {}, track: 'track_2', cache_hit: false }),
    );
  }) as typeof fetch;
  return calls;
}

const KEYED = {
  llmMode: 'live' as const,
  gatewayUrl: 'https://brain.test',
  supabaseUrl: 'https://project.supabase.co',
  supabaseAnonKey: 'sb_publishable_test',
};

afterEach(() => {
  globalThis.fetch = realFetch;
  configureGatewayAuth({});
  resetDoors();
});

describe('the door the SDK reads before it creates anything', () => {
  it('asks the address and the key the gateway actually answers with', () => {
    expect(DOORS_PATH).toBe(CONTRACT.dial.path);
    expect(Object.keys(CONTRACT.dial.body)).toEqual([DOORS_KEY]);
  });

  it('mints nothing while the dial is off', async () => {
    const calls = world(false);
    const sdk = createSdk(KEYED);
    expect(await sdk.account?.ensureSession()).toBeNull();
    expect(calls.filter((c) => c.endsWith('/auth/v1/signup'))).toHaveLength(0);
    expect(sdk.account?.isAuthenticated()).toBe(false);
  });

  it('mints nothing when it cannot ask, because closed is every failure', async () => {
    const calls = world('unreachable');
    const sdk = createSdk(KEYED);
    expect(await sdk.account?.ensureSession()).toBeNull();
    expect(calls.filter((c) => c.endsWith('/auth/v1/signup'))).toHaveLength(0);
  });

  it('mints nothing for a gateway call either, which is the path a turn takes', async () => {
    const calls = world(false);
    const sdk = createSdk(KEYED);
    await sdk.llm.invoke('wobo.turn', { context: {} }, { consentTier: 'un_elevated' });
    expect(calls.filter((c) => c.endsWith('/auth/v1/signup'))).toHaveLength(0);
  });

  it('mints one the minute the owner turns the dial on, with no release', async () => {
    const calls = world(true);
    const sdk = createSdk(KEYED);
    expect(await sdk.account?.ensureSession()).toBe(ANON);
    expect(calls.filter((c) => c.endsWith('/auth/v1/signup'))).toHaveLength(1);
    expect(sdk.account?.isAnonymous()).toBe(true);
  });

  it('asks a build with no brain nothing at all, and behaves as it always did', async () => {
    // A local or mock build has no product behind the door and nothing to sign up to.
    expect(await mayCreateAccount(undefined)).toBe(true);
    expect(await mayCreateAccount('')).toBe(true);
  });

  it('holds the answer for a minute rather than asking on every call', async () => {
    const calls = world(true);
    const at: [number] = [1_000_000];
    expect(await mayCreateAccount('https://brain.test', fetch, () => at[0] as number)).toBe(true);
    expect(await mayCreateAccount('https://brain.test', fetch, () => at[0] as number)).toBe(true);
    expect(calls.filter((c) => c.endsWith(DOORS_PATH))).toHaveLength(1);
    at[0] += 60_001;
    expect(await mayCreateAccount('https://brain.test', fetch, () => at[0] as number)).toBe(true);
    expect(calls.filter((c) => c.endsWith(DOORS_PATH))).toHaveLength(2);
  });

  it('reads only a plain yes as open', async () => {
    for (const body of [{ open: true }, { [DOORS_KEY]: 'true' }, { [DOORS_KEY]: 1 }, {}]) {
      resetDoors();
      globalThis.fetch = (() => Promise.resolve(Response.json(body))) as unknown as typeof fetch;
      expect(await mayCreateAccount('https://brain.test')).toBe(false);
    }
  });
});
