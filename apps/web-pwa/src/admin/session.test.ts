/**
 * FAIL CLOSED. The console opens on one thing and one thing only: a 200 from the guard carrying
 * an identity the server minted AND a session token. Every other outcome leaves it locked.
 *
 * This is the file that would have to be broken for the console to let somebody in by accident,
 * so it enumerates the ways: a refusal, the 404 a stranger is deliberately shown, a 500, a
 * timeout, a 200 with a body that is nearly right, and a 200 with a body that says `admin: true`
 * — the shape an attacker would try if they could reach a response at all.
 *
 * It also proves the two things that are not obvious from reading `session.ts`:
 *   the console never writes a credential to browser storage; and
 *   signing out forgets both proofs even when the server's revoke failed.
 */

// Bun maps `import.meta.env` onto the process environment, so these two are what the console
// reads for its two addresses. Set before the modules under test are imported.
process.env.VITE_GATEWAY_URL = 'https://gateway.test';
process.env.VITE_SUPABASE_URL = 'https://project.test';
process.env.VITE_SUPABASE_ANON_KEY = 'anon';

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { SESSION_HEADER } from './api';
import {
  isAdminEnvelope,
  isOpenedSession,
  LOCK_COPY,
  mayReadConsole,
  signIn,
  signOut,
  takeInvitation,
} from './session';

const OK_ADMIN = {
  id: 'a1',
  email: 'ops@example.com',
  role: 'viewer',
  permissions: ['console.read'],
};

/** A fetch that answers the product sign-in and then whatever the test says for the guard. */
function fetcherFor(guard: () => Response, options: { signedIn?: boolean } = {}): typeof fetch {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (href.includes('/auth/v1/token')) {
      return options.signedIn === false
        ? new Response('{}', { status: 400 })
        : Response.json({ access_token: 'product-token', user: { factors: [] } });
    }
    return guard();
  }) as unknown as typeof fetch & { calls: typeof calls };
  impl.calls = calls;
  return impl;
}

function seen(fetcher: typeof fetch) {
  return (fetcher as unknown as { calls: { url: string; init: RequestInit }[] }).calls;
}

describe('the shape check is what stands between a mint and a JSON body', () => {
  it('accepts only a complete identity', () => {
    expect(isAdminEnvelope({ admin: OK_ADMIN })).toBe(true);
    expect(isAdminEnvelope({ admin: { ...OK_ADMIN, permissions: 'console.read' } })).toBe(false);
    expect(isAdminEnvelope({ admin: { ...OK_ADMIN, id: '' } })).toBe(false);
    expect(isAdminEnvelope({ admin: { ...OK_ADMIN, permissions: [1] } })).toBe(false);
    expect(isAdminEnvelope(OK_ADMIN)).toBe(false); // unwrapped is not the guard's shape
    expect(isAdminEnvelope({ admin: true })).toBe(false);
    expect(isAdminEnvelope(null)).toBe(false);
  });

  it('and a session needs a token as well as an identity', () => {
    expect(isOpenedSession({ admin: OK_ADMIN, session_token: 't' })).toBe(true);
    expect(isOpenedSession({ admin: OK_ADMIN })).toBe(false);
    expect(isOpenedSession({ admin: OK_ADMIN, session_token: '' })).toBe(false);
  });
});

describe('the console fails closed', () => {
  const CREDENTIALS = { email: 'ops@example.com', password: 'x', code: '' };

  it.each([
    ['a refusal', () => new Response('{}', { status: 403 }), 'not_registered'],
    ['the 404 a stranger is shown', () => new Response('{}', { status: 404 }), 'not_registered'],
    ['a gateway error', () => new Response('{}', { status: 500 }), 'guard_error'],
    ['a bad gateway', () => new Response('{}', { status: 502 }), 'guard_error'],
    [
      'a 200 whose body is nearly right',
      () => Response.json({ admin: { id: 'a1', email: 'x@y.z' } }),
      'guard_unrecognised',
    ],
    [
      'a 200 that simply asserts it',
      () => Response.json({ admin: true, session_token: 'anything' }),
      'guard_unrecognised',
    ],
    [
      'a 200 with an identity and no token',
      () => Response.json({ admin: OK_ADMIN }),
      'guard_unrecognised',
    ],
    [
      'nothing at all',
      () => {
        throw new Error('network');
      },
      'guard_unreachable',
    ],
  ])('stays locked on %s', async (_name, guard, why) => {
    const session = await signIn(CREDENTIALS, fetcherFor(guard as () => Response));
    expect(session.state).toBe('locked');
    if (session.state === 'locked') expect(session.why).toBe(why as never);
  });

  it('stays locked when the product sign-in itself is refused, and never asks the guard', async () => {
    const fetcher = fetcherFor(() => Response.json({ admin: OK_ADMIN, session_token: 't' }), {
      signedIn: false,
    });
    const session = await signIn(CREDENTIALS, fetcher);
    expect(session.state).toBe('locked');
    expect(seen(fetcher).some((call) => call.url.includes('/v1/admin/session'))).toBe(false);
  });

  it('opens only on an identity AND a token, and then carries both proofs', async () => {
    const fetcher = fetcherFor(() => Response.json({ admin: OK_ADMIN, session_token: 'sess-1' }));
    const session = await signIn(CREDENTIALS, fetcher);
    expect(session.state).toBe('open');
    if (session.state !== 'open') return;
    expect(session.admin.role).toBe('viewer');
    // An account with no enrolled factor is reported, not hidden: production refuses it.
    expect(session.weakFactor).toBe(true);

    await signOut(fetcher);
    // DELETE on /v1/admin/session, which is the route that revokes the row. The console used to
    // POST /v1/admin/session/end, which the gateway has never registered: it 404'd, the failure
    // was discarded, and the session token stayed live on the server until its TTL.
    const end = seen(fetcher).find((call) => call.init.method === 'DELETE');
    expect(end?.url.endsWith('/v1/admin/session')).toBe(true);
    const headers = end?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer product-token');
    expect(headers[SESSION_HEADER]).toBe('sess-1');
  });

  it('and sign-out reaches the one route that actually revokes the row', async () => {
    // The gateway registers GET and DELETE /v1/admin/session and POST /v1/admin/session (the
    // login). Anything else 404s, and a 404 reads as 'not_deployed' — indistinguishable from a
    // console that is simply not deployed, which is why this went unnoticed.
    const fetcher = fetcherFor(() => Response.json({ admin: OK_ADMIN, session_token: 'sess-3' }));
    await signIn(CREDENTIALS, fetcher);
    await signOut(fetcher);
    const calls = seen(fetcher).filter((call) => call.url.includes('/v1/admin/session'));
    for (const call of calls) {
      expect(call.url.endsWith('/session/end')).toBe(false);
    }
    expect(calls.some((call) => call.init.method === 'DELETE')).toBe(true);
  });

  it('forgets both proofs on sign-out even when the revoke failed', async () => {
    const open = fetcherFor(() => Response.json({ admin: OK_ADMIN, session_token: 'sess-2' }));
    await signIn(CREDENTIALS, open);
    await signOut(fetcherFor(() => new Response('{}', { status: 503 })));

    // The next call carries neither proof, so a revoke this console could not confirm cannot
    // leave a live token in the tab.
    const after = fetcherFor(() => new Response('{}', { status: 401 }));
    await signOut(after);
    const headers = seen(after)[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(headers[SESSION_HEADER]).toBeUndefined();
  });

  it('and a seat without console.read may not read the platform’s figures', () => {
    expect(mayReadConsole({ ...OK_ADMIN, permissions: ['support.act'] })).toBe(false);
    expect(mayReadConsole(OK_ADMIN)).toBe(true);
  });
});

describe('no credential is ever written to browser storage', () => {
  it('nothing in the console touches localStorage, sessionStorage, IndexedDB or a cookie', () => {
    const dir = import.meta.dir;
    const guilty = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name)))
      .filter((entry) => !entry.name.endsWith('.test.ts'))
      .filter((entry) => {
        const shipped = readFileSync(join(dir, entry.name), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/^\s*\/\/.*$/gm, ' ');
        return /localStorage|sessionStorage|indexedDB|document\.cookie/.test(shipped);
      })
      .map((entry) => entry.name);
    expect(guilty).toEqual([]);
  });

  it('and every request omits cookies, so the guard’s header choice is not undone', () => {
    const dir = import.meta.dir;
    for (const name of ['api.ts', 'productSignIn.ts']) {
      const text = readFileSync(join(dir, name), 'utf8');
      expect(text).toContain("credentials: 'omit'");
      expect(text).not.toContain("credentials: 'include'");
    }
  });
});

describe('a seat is taken through its invitation link', () => {
  const CREDENTIALS = { email: 'new@example.com', password: 'x', code: '123456' };

  it('reads the token from the address and hands back an address without it', () => {
    const taken = takeInvitation('https://console.test/admin.html?invite=abc.def&x=1#top');
    expect(taken.invitation).toBe('abc.def');
    expect(taken.cleaned).toBe('https://console.test/admin.html?x=1#top');
    const bare = takeInvitation('https://console.test/admin.html?invite=abc.def');
    expect(bare.cleaned).toBe('https://console.test/admin.html');
  });

  it('takes nothing from an address with no token, or with one that is not a token', () => {
    expect(takeInvitation('https://console.test/admin.html').invitation).toBeNull();
    expect(takeInvitation('https://console.test/admin.html').cleaned).toBeNull();
    expect(takeInvitation('https://console.test/admin.html?invite=').invitation).toBeNull();
    expect(takeInvitation('https://console.test/admin.html?invite=<script>').invitation).toBeNull();
    expect(takeInvitation(`https://console.test/admin.html?invite=${'a'.repeat(600)}`).invitation).toBeNull();
    // A bad token is still taken out of the address bar.
    expect(takeInvitation('https://console.test/admin.html?invite=<script>').cleaned).toBe(
      'https://console.test/admin.html',
    );
    expect(takeInvitation('not a url').invitation).toBeNull();
  });

  it('sends the token with the sign-in, and only in the body', async () => {
    const fetcher = fetcherFor(() => Response.json({ admin: OK_ADMIN, session_token: 'sess-9' }));
    const session = await signIn(CREDENTIALS, fetcher, 'abc.def');
    expect(session.state).toBe('open');
    const call = seen(fetcher).find((one) => one.url.endsWith('/v1/admin/session'));
    expect(JSON.parse(String(call?.init.body))).toEqual({ invitation: 'abc.def' });
    expect(call?.url).not.toContain('abc.def');
  });

  it('sends an empty body when there is no invitation, as it always has', async () => {
    const fetcher = fetcherFor(() => Response.json({ admin: OK_ADMIN, session_token: 'sess-8' }));
    await signIn(CREDENTIALS, fetcher);
    const call = seen(fetcher).find((one) => one.url.endsWith('/v1/admin/session'));
    expect(JSON.parse(String(call?.init.body))).toEqual({});
  });

  it('tells a person with a waiting seat to come through the link', async () => {
    const fetcher = fetcherFor(() =>
      Response.json(
        { detail: { code: 'invitation_link_required', message: 'Open the invitation link' } },
        { status: 403 },
      ),
    );
    const session = await signIn(CREDENTIALS, fetcher);
    expect(session.state).toBe('locked');
    if (session.state === 'locked') expect(session.why).toBe('invitation_link_required');
  });

  it('says a link that did not open a seat may be spent or expired, and not why', async () => {
    const fetcher = fetcherFor(() =>
      Response.json({ detail: { code: 'invitation_link_required', message: 'x' } }, { status: 403 }),
    );
    const session = await signIn(CREDENTIALS, fetcher, 'abc.def');
    if (session.state === 'locked') expect(session.why).toBe('invitation_refused');
    const stranger = fetcherFor(() =>
      Response.json({ detail: { code: 'not_registered', message: 'x' } }, { status: 403 }),
    );
    const refused = await signIn(CREDENTIALS, stranger, 'abc.def');
    if (refused.state === 'locked') expect(refused.why).toBe('invitation_refused');
  });

  it('asks for the second factor when that is what stands in the way', async () => {
    const fetcher = fetcherFor(() =>
      Response.json({ detail: { code: 'mfa_required', message: 'x' } }, { status: 401 }),
    );
    const session = await signIn(CREDENTIALS, fetcher, 'abc.def');
    if (session.state === 'locked') expect(session.why).toBe('mfa_required');
  });

  it('carries no em dash in anything it says', () => {
    for (const line of Object.values(LOCK_COPY)) expect(line).not.toContain('\u2014');
  });
});
