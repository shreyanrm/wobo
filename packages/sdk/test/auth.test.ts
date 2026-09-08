import { afterEach, describe, expect, it } from 'bun:test';
import {
  AUTH_SESSION_KEY,
  createSdk,
  type KVStorage,
  NoSuchAccountError,
  NotAuthenticatedError,
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

/** An unsigned JWT whose payload carries the given sub — enough for client-side sub extraction. */
function fakeJwt(sub: string): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64({ sub, role: 'authenticated' })}.sig`;
}

const SUBJECT = '11111111-2222-4333-8444-555555555555';
const realFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(url), init))) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const cfg = (storage: KVStorage) => ({
  url: 'https://project.supabase.co',
  anonKey: 'sb_publishable_test',
  surface: 'pwa' as const,
  storage,
});

describe('SupabaseAuthIdentity', () => {
  it('is signed out with empty storage and refuses getSession', async () => {
    const id = new SupabaseAuthIdentity(cfg(new MapKV()));
    expect(id.isAuthenticated()).toBe(false);
    expect(id.subjectId).toBeNull();
    expect(await id.getAccessToken()).toBeNull();
    await expect(id.getSession()).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it('verifies a phone OTP into a persisted session whose subject is auth.uid', async () => {
    const storage = new MapKV();
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(url);
      if (url.endsWith('/auth/v1/otp')) return new Response(null, { status: 200 });
      if (url.endsWith('/auth/v1/verify')) {
        expect(JSON.parse(String(init?.body)).type).toBe('sms');
        return Response.json({
          access_token: fakeJwt(SUBJECT),
          refresh_token: 'r1',
          expires_in: 3600,
          user: { id: SUBJECT },
        });
      }
      return new Response(null, { status: 404 });
    });

    const id = new SupabaseAuthIdentity(cfg(storage));
    await id.auth.requestPhoneOtp('+911234567890');
    const session = await id.auth.verifyPhoneOtp('+911234567890', '123456');

    expect(session.subject_id).toBe(SUBJECT);
    // consent stays un_elevated until verifiable parental consent exists
    expect(session.consent_tier).toBe('un_elevated');
    expect(id.isAuthenticated()).toBe(true);
    expect(id.subjectId).toBe(SUBJECT);
    expect(calls.some((u) => u.endsWith('/auth/v1/otp'))).toBe(true);

    // the persisted session boots a fresh instance signed in — no network needed
    const rebooted = new SupabaseAuthIdentity(cfg(storage));
    expect(rebooted.subjectId).toBe(SUBJECT);
    expect(await rebooted.getAccessToken()).toBe(fakeJwt(SUBJECT));
  });

  /**
   * ONLY THE DOOR THAT ASKS MAY MAKE AN ACCOUNT.
   *
   * `create_user` was hard-coded true, so the sign-in door — which has no date-of-birth field and
   * no consent tick — created a brand-new account for any number typed into it. Every consent gate
   * downstream then had nothing to read, and the age gate on the OTHER door was decoration.
   */
  it('does not create an account unless the caller asked for one', async () => {
    const bodies: unknown[] = [];
    mockFetch((url, init) => {
      if (url.endsWith('/auth/v1/otp')) {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    const id = new SupabaseAuthIdentity(cfg(new MapKV()));
    await id.auth.requestPhoneOtp('+911234567890');
    await id.auth.requestPhoneOtp('+911234567890', { createUser: false });
    await id.auth.requestPhoneOtp('+911234567890', { createUser: true });
    expect(bodies).toEqual([
      { phone: '+911234567890', create_user: false },
      { phone: '+911234567890', create_user: false },
      { phone: '+911234567890', create_user: true },
    ]);
  });

  it('names the number with no account behind it, rather than failing anonymously', async () => {
    mockFetch(() =>
      Response.json({ code: 'otp_disabled', msg: 'Signups not allowed for otp' }, { status: 422 }),
    );
    const id = new SupabaseAuthIdentity(cfg(new MapKV()));
    await expect(id.auth.requestPhoneOtp('+911234567890')).rejects.toBeInstanceOf(
      NoSuchAccountError,
    );
    // and anything else stays the generic failure rather than being guessed at
    mockFetch(() => Response.json({ msg: 'Invalid phone number' }, { status: 400 }));
    await expect(id.auth.requestPhoneOtp('+911234567890')).rejects.not.toBeInstanceOf(
      NoSuchAccountError,
    );
  });

  it('signs out locally even when the server revoke fails', async () => {
    const storage = new MapKV();
    storage.setItem(
      AUTH_SESSION_KEY,
      JSON.stringify({
        access_token: fakeJwt(SUBJECT),
        refresh_token: 'r1',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        subject_id: SUBJECT,
      }),
    );
    mockFetch(() => {
      throw new Error('offline');
    });
    const id = new SupabaseAuthIdentity(cfg(storage));
    expect(id.isAuthenticated()).toBe(true);
    await id.auth.signOut();
    expect(id.isAuthenticated()).toBe(false);
    expect(new SupabaseAuthIdentity(cfg(storage)).isAuthenticated()).toBe(false);
    // The key leaves rather than staying as an empty string on every after-sign-out listing.
    expect(storage.map.has(AUTH_SESSION_KEY)).toBe(false);
  });
});

describe('createSdk live-auth wiring', () => {
  it('still throws on DEV_AUTH=false without env keys (secrets come from env only)', () => {
    expect(() => createSdk({ devAuth: false })).toThrow(/SUPABASE_URL/);
  });

  it('binds the Supabase identity when DEV_AUTH=false with keys, signed out => local providers', () => {
    const sdk = createSdk({
      devAuth: false,
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'sb_publishable_test',
      persistMode: 'live',
    });
    expect(sdk.identity).toBeInstanceOf(SupabaseAuthIdentity);
    expect(sdk.identity.isAuthenticated()).toBe(false);
    // signed out: nothing may write upstream — events stay in-memory, unattributed to any real id
    const event = sdk.events.record('onboarding.step.completed.v1', {
      step: 'door_choice',
      step_index: 0,
      total_steps: 5,
    });
    expect(event.actor.subject_id).toBe('00000000-0000-0000-0000-000000000000');
    expect(event.context.consent_tier).toBe('un_elevated');
  });
});
