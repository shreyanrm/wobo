import { afterEach, describe, expect, it } from 'bun:test';
import {
  configureGatewayAuth,
  createSdk,
  type KVStorage,
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

    const sdk = createSdk({
      llmMode: 'live',
      gatewayUrl: 'https://brain.test',
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'sb_publishable_test',
    });
    expect(sdk.account?.isAuthenticated()).toBe(false);

    await sdk.llm.invoke('wobo.turn', { context: {} }, { consentTier: 'un_elevated' });

    expect(calls[0]).toBe('https://project.supabase.co/auth/v1/signup');
    expect(calls[1]).toBe('https://brain.test/v1/capability/wobo.turn');
    expect(headers[1]).toBe(`Bearer ${fakeJwt(ANON, { is_anonymous: true })}`);
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
