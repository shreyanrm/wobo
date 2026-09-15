import { afterEach, describe, expect, it } from 'bun:test';
import {
  AUTH_SESSION_KEY,
  configureGatewayAuth,
  createSdk,
  DOORS_KEY,
  DOORS_PATH,
  type KVStorage,
  resetDoors,
  SupabaseAuthIdentity,
} from '../src/index';

class MapKV implements KVStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** An unsigned JWT carrying the claims the client reads (the brain re-verifies the real one). */
function fakeJwt(sub: string, claims: Record<string, unknown> = {}): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64({ sub, role: 'authenticated', ...claims })}.sig`;
}

const ANON = 'aaaaaaaa-1111-4222-8333-444444444444';
const realFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(url), init))) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  configureGatewayAuth({}); // the auth binding is a module singleton — never leak it between tests
  resetDoors(); // so is the door's held answer (doors.ts)
});

const cfg = (storage: KVStorage) => ({
  url: 'https://project.supabase.co',
  anonKey: 'sb_publishable_test',
  surface: 'pwa' as const,
  storage,
});

describe('anonymous sign-in — every learner is somebody to the brain', () => {
  it('mints a session on first boot, so the first turn already carries a JWT', async () => {
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      if (url.endsWith('/auth/v1/signup')) {
        return Response.json({
          access_token: fakeJwt(ANON, { is_anonymous: true }),
          refresh_token: 'r-anon',
          expires_in: 3600,
          user: { id: ANON },
        });
      }
      return new Response(null, { status: 404 });
    });
    const id = new SupabaseAuthIdentity(cfg(new MapKV()));
    expect(id.isAuthenticated()).toBe(false);

    const session = await id.auth.signInAnonymously();

    expect(session.subject_id).toBe(ANON);
    expect(id.isAuthenticated()).toBe(true);
    expect(id.isAnonymous()).toBe(true);
    expect(await id.getAccessToken()).toBe(fakeJwt(ANON, { is_anonymous: true }));
    expect(calls).toEqual(['https://project.supabase.co/auth/v1/signup']);
  });

  it('is idempotent: a second boot reuses the stored session and mints nothing', async () => {
    const storage = new MapKV();
    let signups = 0;
    mockFetch((url) => {
      if (url.endsWith('/auth/v1/signup')) {
        signups += 1;
        return Response.json({
          access_token: fakeJwt(ANON, { is_anonymous: true }),
          refresh_token: 'r-anon',
          expires_in: 3600,
          user: { id: ANON },
        });
      }
      return new Response(null, { status: 404 });
    });
    await new SupabaseAuthIdentity(cfg(storage)).auth.signInAnonymously();
    const rebooted = new SupabaseAuthIdentity(cfg(storage));
    await rebooted.auth.signInAnonymously();
    expect(signups).toBe(1);
    expect(rebooted.subjectId).toBe(ANON);
  });

  it('a real session is not anonymous — the upgrade is visible to the client', async () => {
    const storage = new MapKV();
    mockFetch((url) => {
      if (url.endsWith('/auth/v1/verify')) {
        return Response.json({
          access_token: fakeJwt('real-subject'),
          refresh_token: 'r-real',
          expires_in: 3600,
          user: { id: 'real-subject' },
        });
      }
      return new Response(null, { status: 404 });
    });
    const id = new SupabaseAuthIdentity(cfg(storage));
    await id.auth.verifyPhoneOtp('+911234567890', '123456');
    expect(id.isAnonymous()).toBe(false);
    expect(id.subjectId).toBe('real-subject');
  });

  it('refused anonymous sign-in leaves the device signed out, not broken', async () => {
    mockFetch(() => Response.json({ msg: 'anonymous sign-ins are disabled' }, { status: 422 }));
    const id = new SupabaseAuthIdentity(cfg(new MapKV()));
    await expect(id.auth.signInAnonymously()).rejects.toThrow(/could not start a session/);
    expect(id.isAuthenticated()).toBe(false);
  });
});

describe('the assembled SDK signs the device in before it ever asks the brain', () => {
  it('a first turn mints an anonymous session, then carries its JWT', async () => {
    const calls: string[] = [];
    const headers: (string | null)[] = [];
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      headers.push(new Headers(init?.headers).get('authorization'));
      // The door is open in this test, and nothing is minted anywhere while it is not
      // (`doors.ts`, docs/DOORS-CLOSED.md §1). The SDK asks before it signs anybody in.
      if (String(url).endsWith(DOORS_PATH)) {
        return Promise.resolve(Response.json({ [DOORS_KEY]: true }));
      }
      if (String(url).endsWith('/auth/v1/signup')) {
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

    // Live auth: the mode that uses the session is the only one that mints it (see the last
    // describe in this file); a dev-mock build names its dev subject instead.
    const sdk = createSdk({
      devAuth: false,
      llmMode: 'live',
      gatewayUrl: 'https://brain.test',
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'sb_publishable_test',
    });
    expect(sdk.account?.isAuthenticated()).toBe(false);

    await sdk.llm.invoke('wobo.turn', { context: {} }, { consentTier: 'un_elevated' });

    expect(calls[0]).toBe(`https://brain.test${DOORS_PATH}`);
    expect(calls[1]).toBe('https://project.supabase.co/auth/v1/signup');
    expect(calls[2]).toBe('https://brain.test/v1/capability/wobo.turn');
    expect(headers[2]).toBe(`Bearer ${fakeJwt(ANON, { is_anonymous: true })}`);
    expect(sdk.account?.isAnonymous()).toBe(true);
    expect(await sdk.account?.ensureSession()).toBe(ANON); // idempotent — no second signup
    expect(calls.filter((c) => c.endsWith('/auth/v1/signup'))).toHaveLength(1);
  });

  it('a keyless build never signs anyone in — it names its local subject instead', async () => {
    const headers: (string | null)[] = [];
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      headers.push(new Headers(init?.headers).get('x-wobo-dev-subject'));
      return Promise.resolve(
        Response.json({ capability: 'wobo.turn', output: {}, track: 'track_2', cache_hit: false }),
      );
    }) as typeof fetch;

    const sdk = createSdk({ llmMode: 'live', gatewayUrl: 'https://brain.test' });
    expect(sdk.account).toBeUndefined();
    await sdk.llm.invoke('wobo.turn', { context: {} }, { consentTier: 'un_elevated' });
    expect(headers[0]).toBe(sdk.config.mockSubjectId);
  });
});

/**
 * THE FIRST SESSION FOLLOWS THE LEARNER. The SDK is built before the anonymous session is minted,
 * so its state, thread and mastery caches are keyed to nobody and write the PLAIN keys. Until this
 * they went on doing so until a reload, and the plain bucket was what the next person's door-time
 * SDK read as their own (seen in a browser, 2026-09-07). The session now tells the caches who they
 * belong to the moment it lands.
 */
describe('the caches re-key the moment the anonymous session lands', () => {
  it('moves what was written plain under the new subject and writes there from then on', async () => {
    const storage = new MapKV();
    (globalThis as { localStorage?: KVStorage }).localStorage = storage;
    try {
      globalThis.fetch = ((url: string | URL | Request) => {
        if (String(url).endsWith('/auth/v1/signup')) {
          return Promise.resolve(
            Response.json({
              access_token: fakeJwt(ANON, { is_anonymous: true }),
              refresh_token: 'r-anon',
              expires_in: 3600,
              user: { id: ANON },
            }),
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      }) as typeof fetch;
      const sdk = createSdk({
        supabaseUrl: 'https://project.supabase.co',
        supabaseAnonKey: 'sb_publishable_test',
        devAuth: false,
        persistMode: 'local',
      });
      // Before the session: the door-time SDK, keyed to nobody.
      sdk.state.save({ ...sdk.state.loadCache(), xp: 40 });
      sdk.state.saveThread('wobo', [{ id: 't1', role: 'user', text: 'my dog is Bruno' }]);
      expect(storage.map.has('wobo-progress-v1')).toBe(true);

      expect(await sdk.account?.ensureSession()).toBe(ANON);

      expect(storage.map.has('wobo-progress-v1')).toBe(false);
      expect(storage.map.has('wobo-conversation-v1')).toBe(false);
      expect(JSON.parse(storage.map.get(`wobo-progress-v1:${ANON}`) ?? '{}').xp).toBe(40);
      expect(sdk.state.loadCache().xp).toBe(40);
      expect(sdk.state.loadThreadCache('wobo')?.turns[0]?.text).toBe('my dog is Bruno');
      sdk.state.save({ ...sdk.state.loadCache(), xp: 55 });
      expect(storage.map.has('wobo-progress-v1')).toBe(false);
      expect(JSON.parse(storage.map.get(`wobo-progress-v1:${ANON}`) ?? '{}').xp).toBe(55);
    } finally {
      (globalThis as { localStorage?: KVStorage }).localStorage = undefined;
    }
  });
});

/**
 * A REFUSED SIGN-IN IS NOT ASKED AGAIN (the adversary, wave 47, finding 12).
 *
 * The client mints one anonymous session per device, single-flight — but it cleared the flight on
 * SETTLE, so an attempt that failed was made again by the next caller. With anonymous sign-ins
 * turned off on the project the browser fired `POST /auth/v1/signup` THREE times per page load and
 * every one came back 422: three failed cross-internet round trips before the learner had asked
 * anything, and the "Failed to load resource: 422" console error on all 59 keyless turns.
 *
 * The auth server ANSWERING no is an answer. A failure with no answer at all is the network, and
 * that may come back, so it stays askable.
 */
describe('a door that said no is not knocked on again', () => {
  const serve = (
    calls: string[],
    signup: () => Promise<Response>,
  ): void => {
    globalThis.fetch = ((url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).endsWith(DOORS_PATH)) {
        return Promise.resolve(Response.json({ [DOORS_KEY]: true }));
      }
      if (String(url).endsWith('/auth/v1/signup')) return signup();
      return Promise.resolve(
        Response.json({ capability: 'wobo.turn', output: {}, track: 'track_2', cache_hit: false }),
      );
    }) as typeof fetch;
  };

  const boot = () =>
    createSdk({
      devAuth: false, // live auth is the mode that mints; see the last describe in this file
      llmMode: 'live',
      gatewayUrl: 'https://brain.test',
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'sb_publishable_test',
    });

  it('asks the auth server exactly once when it answers 422', async () => {
    const calls: string[] = [];
    serve(calls, () =>
      Promise.resolve(
        Response.json({ code: 422, error_code: 'anonymous_provider_disabled' }, { status: 422 }),
      ),
    );
    const sdk = boot();
    for (let i = 0; i < 3; i += 1) {
      await sdk.llm.invoke('wobo.turn', { context: {} }, { consentTier: 'un_elevated' });
    }
    expect(calls.filter((c) => c.endsWith('/auth/v1/signup'))).toHaveLength(1);
  });

  it('still asks the door only once, too', async () => {
    const calls: string[] = [];
    serve(calls, () => Promise.resolve(new Response(null, { status: 422 })));
    const sdk = boot();
    for (let i = 0; i < 3; i += 1) {
      await sdk.llm.invoke('wobo.turn', { context: {} }, { consentTier: 'un_elevated' });
    }
    expect(calls.filter((c) => c.endsWith(DOORS_PATH)).length).toBeLessThanOrEqual(1);
  });

  it('a device that was merely offline may try again', async () => {
    const calls: string[] = [];
    let attempt = 0;
    serve(calls, () => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(
        Response.json({
          access_token: fakeJwt(ANON, { is_anonymous: true }),
          refresh_token: 'r-anon',
          expires_in: 3600,
          user: { id: ANON },
        }),
      );
    });
    const sdk = boot();
    await sdk.llm.invoke('wobo.turn', { context: {} }, { consentTier: 'un_elevated' });
    await sdk.llm.invoke('wobo.turn', { context: {} }, { consentTier: 'un_elevated' });
    expect(sdk.account?.isAnonymous()).toBe(true);
    expect(calls.filter((c) => c.endsWith('/auth/v1/signup'))).toHaveLength(2);
  });
});

/**
 * AN IDENTITY IS MINTED ONLY BY THE MODE THAT WILL USE IT (the adversary, wave 58, on finding 12).
 *
 * The single flight left one `POST /auth/v1/signup` per page load, and it still came back 422:
 * one failed cross-internet round trip and a "Failed to load resource: 422" console error on every
 * cold load, followed by three 401s on `GET /v1/me` that the fix had not looked at. Measured on a
 * dev-mock build with Supabase keys, which is every lab and every developer's browser.
 *
 * In dev-mock mode the learner IS already somebody to the brain: `identity` is the dev mock, and
 * the gateway honours `x-wobo-dev-subject` under DEV_AUTH. An anonymous Supabase session minted
 * beside it costs a call to a real auth server (and a row in a real project) for a JWT the dev
 * gateway would treat no better than the header, and a dev gateway with no project configured
 * could not verify at all. So dev-mock mode never knocks, and its every call names the dev
 * subject. Live mode mints exactly as before, door first and a no not asked again, and a budget
 * read with nobody behind it is answered locally rather than sent to be refused.
 */
describe('an identity is minted only by the mode that will use it', () => {
  const ME_BODY = {
    subject: 'whoever',
    anonymous: false,
    plan: 'free',
    consent_tier: 'un_elevated',
    budget: { turns: { limit: 40, used: 1, remaining: 39 }, generations: {}, reset_at: null },
    allowance: {},
  };
  const serve = (calls: { url: string; auth: string | null; dev: string | null }[]) => {
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(url),
        auth: headers.get('authorization'),
        dev: headers.get('x-wobo-dev-subject'),
      });
      if (String(url).endsWith(DOORS_PATH)) {
        return Promise.resolve(Response.json({ [DOORS_KEY]: true }));
      }
      if (String(url).endsWith('/auth/v1/signup')) {
        return Promise.resolve(
          Response.json({ code: 422, error_code: 'anonymous_provider_disabled' }, { status: 422 }),
        );
      }
      if (String(url).endsWith('/v1/me')) {
        // The brain under DEV_AUTH: a dev subject is a learner, nobody at all is a 401.
        if (!headers.get('authorization') && !headers.get('x-wobo-dev-subject')) {
          return Promise.resolve(
            Response.json({ code: 'sign_in_required', message: 'sign in' }, { status: 401 }),
          );
        }
        return Promise.resolve(Response.json(ME_BODY));
      }
      return Promise.resolve(
        Response.json({ capability: 'wobo.turn', output: {}, track: 'track_2', cache_hit: false }),
      );
    }) as typeof fetch;
  };
  const keyed = {
    llmMode: 'live' as const,
    gatewayUrl: 'https://brain.test',
    supabaseUrl: 'https://project.supabase.co',
    supabaseAnonKey: 'sb_publishable_test',
  };

  it('dev-mock mode never knocks on the auth server, and names the dev subject on every call', async () => {
    const calls: { url: string; auth: string | null; dev: string | null }[] = [];
    serve(calls);
    const sdk = createSdk(keyed); // devAuth is the default, exactly as a dev browser with keys
    expect(sdk.config.devAuth).toBe(true);

    await sdk.llm.invoke('wobo.turn', { context: {} }, { consentTier: 'un_elevated' });
    const me = await sdk.me();

    expect(calls.filter((c) => c.url.endsWith('/auth/v1/signup'))).toHaveLength(0);
    expect(calls.filter((c) => c.url.endsWith(DOORS_PATH))).toHaveLength(0);
    const brain = calls.filter((c) => c.url.startsWith('https://brain.test'));
    expect(brain.length).toBeGreaterThanOrEqual(2);
    for (const c of brain) {
      expect(c.dev).toBe(sdk.config.mockSubjectId);
      expect(c.auth).toBeNull();
    }
    expect(me?.plan).toBe('free');
    expect(await sdk.account?.ensureSession()).toBeNull();
  });

  it('a session the learner made on purpose still rides as the bearer in dev-mock mode', async () => {
    const storage = new MapKV();
    storage.setItem(
      AUTH_SESSION_KEY,
      JSON.stringify({
        access_token: fakeJwt('google-subject'),
        refresh_token: 'r-google',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        subject_id: 'google-subject',
      }),
    );
    (globalThis as { localStorage?: KVStorage }).localStorage = storage;
    try {
      const calls: { url: string; auth: string | null; dev: string | null }[] = [];
      serve(calls);
      const sdk = createSdk(keyed);
      await sdk.llm.invoke('wobo.turn', { context: {} }, { consentTier: 'un_elevated' });
      const turn = calls.find((c) => c.url.includes('/v1/capability/'));
      expect(turn?.auth).toBe(`Bearer ${fakeJwt('google-subject')}`);
      expect(calls.filter((c) => c.url.endsWith('/auth/v1/signup'))).toHaveLength(0);
    } finally {
      (globalThis as { localStorage?: KVStorage }).localStorage = undefined;
    }
  });

  it('live mode, refused: the budget read is answered locally, never sent to be refused', async () => {
    const calls: { url: string; auth: string | null; dev: string | null }[] = [];
    serve(calls);
    const sdk = createSdk({ ...keyed, devAuth: false });

    expect(await sdk.me()).toBeNull();
    expect(await sdk.me()).toBeNull();

    expect(calls.filter((c) => c.url.endsWith('/auth/v1/signup'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith('/v1/me'))).toHaveLength(0);
  });
});
