import type { ConsentTier } from '@wobo/contracts';
import type { SdkConfig } from './config';
import type { KVStorage } from './state';

/**
 * The identity boundary. The whole app consumes `IdentityProvider`; app code only ever sees the
 * opaque `subject_id`, never email/phone/PII. DEV_AUTH=true returns the dev-mock user; live mode
 * (DEV_AUTH=false) is Supabase Auth — phone-OTP-first + Google — where `auth.uid()` IS the
 * canonical subject_id and NOTHING else in the app changes.
 */
export interface Session {
  /** Opaque canonical subject UUID. The only identity app code sees. */
  subject_id: string;
  consent_tier: ConsentTier;
  surface: 'expo' | 'pwa';
  /** A display name from the profile cache (not PII in domain logic). */
  display_name?: string;
}

/** Raised by the auth seams when running in dev-mock mode (no live auth to perform). */
export class AuthNotEnabledError extends Error {
  constructor(seam: string) {
    super(`${seam} is not available in dev-mock mode; flip DEV_AUTH=false for live account auth.`);
    this.name = 'AuthNotEnabledError';
  }
}

/** Raised when a session is required (live mode) but nobody is signed in. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('no session — sign in first (live mode routes to onboarding for this)');
    this.name = 'NotAuthenticatedError';
  }
}

/**
 * Raised when a code was asked for on a door that does not make accounts, and the number has none.
 *
 * The caller needs to tell those two cases apart to say anything useful, and it cannot do it from
 * a status code: GoTrue answers a refused signup with the same 4xx it answers a malformed number
 * with. The screen reads `name` rather than `instanceof`, so a second copy of this module in the
 * bundle graph cannot silently turn a nameable problem back into the catch-all.
 */
export class NoSuchAccountError extends Error {
  constructor() {
    super('no account exists for that phone number, and this call was not allowed to create one');
    this.name = 'NoSuchAccountError';
  }
}

/** How a phone-OTP request should behave when the number has no account yet. */
export interface PhoneOtpOptions {
  /**
   * Make an account for a number that has none. FALSE BY DEFAULT, and that is the point of it:
   * creating an account is the sign-up door's job, and the sign-up door is the only screen that
   * asks for a date of birth and takes an agreement to the terms. The sign-in door used to create
   * accounts too — the request went out with `create_user: true` whichever door sent it — so a
   * brand-new account could be minted with no age question and no consent recorded anywhere.
   */
  createUser?: boolean;
}

/** Parental consent record shape (DigiLocker-grade verification is a later Phase-4 step). */
export interface ParentalConsentRecord {
  subject_id: string;
  guardian_ref: string;
  verifier: 'digilocker';
  purposes: string[];
}

export interface AccountLink {
  subject_id: string;
  provider: 'phone';
  handle: string;
}

/** The auth seams. Live (Supabase) in `SupabaseAuthIdentity`; throwing stubs in the dev mock. */
export interface AuthSeams {
  /**
   * Establish an anonymous learner so a first-time visitor carries a real JWT before they ever sign
   * in — this is what lets Wobo teach on the first screen while the brain still knows who is asking
   * (a small day's budget, no elevated doors). Resolves to the existing session when there is one.
   */
  signInAnonymously(): Promise<Session>;
  /**
   * Sends an SMS one-time code to the phone (E.164, e.g. +91…). Signs an EXISTING account in
   * unless `options.createUser` says otherwise; raises `NoSuchAccountError` when the number has
   * no account and this call was not allowed to make one.
   */
  requestPhoneOtp(phone: string, options?: PhoneOtpOptions): Promise<void>;
  /** Verifies the code and establishes the session. Resolves to the new session. */
  verifyPhoneOtp(phone: string, code: string): Promise<Session>;
  /** Redirects the browser to Google sign-in; the session completes on return. */
  signInWithGoogle(redirectTo?: string): Promise<void>;
  /** Ends the session everywhere this tab can reach; local caches stay (offline-first). */
  signOut(): Promise<void>;
  /** Not built yet: consent-tier elevation requires verifiable parental consent (DPDP). */
  recordParentalConsent(record: ParentalConsentRecord): Promise<never>;
  linkAccount(link: AccountLink): Promise<never>;
}

export interface IdentityProvider {
  /** The current session. Throws NotAuthenticatedError when live mode has nobody signed in. */
  getSession(): Promise<Session>;
  /**
   * The access token PostgREST/RLS uses. Dev: the env-supplied dev JWT (or null). Live: the real
   * Supabase access token, refreshed when close to expiry.
   */
  getAccessToken(): Promise<string | null>;
  /** True when a subject is established (always true for the dev mock). */
  isAuthenticated(): boolean;
  auth: AuthSeams;
}

const notEnabled: AuthSeams = {
  signInAnonymously: async () => {
    throw new AuthNotEnabledError('anonymous sign-in');
  },
  requestPhoneOtp: async () => {
    throw new AuthNotEnabledError('phone-OTP signup');
  },
  verifyPhoneOtp: async () => {
    throw new AuthNotEnabledError('phone-OTP verification');
  },
  signInWithGoogle: async () => {
    throw new AuthNotEnabledError('Google sign-in');
  },
  signOut: async () => {
    throw new AuthNotEnabledError('sign-out');
  },
  recordParentalConsent: async () => {
    throw new AuthNotEnabledError('parental-consent recording');
  },
  linkAccount: async () => {
    throw new AuthNotEnabledError('account linking');
  },
};

/** The dev-mock identity: a fixed opaque subject, a configurable consent tier, no login. */
export class DevMockIdentity implements IdentityProvider {
  readonly auth: AuthSeams = notEnabled;
  private readonly session: Session;
  private readonly accessToken: string | null;

  constructor(config: SdkConfig) {
    this.session = {
      subject_id: config.mockSubjectId,
      consent_tier: config.consentTierDefault,
      surface: config.surface,
      display_name: config.displayName,
    };
    // The Phase-1 dev JWT (sub = mockSubjectId, role authenticated), env-supplied — RLS keys on it.
    this.accessToken = config.supabaseAccessToken ?? null;
  }

  async getSession(): Promise<Session> {
    return this.session;
  }

  async getAccessToken(): Promise<string | null> {
    return this.accessToken;
  }

  isAuthenticated(): boolean {
    return true;
  }
}

// --- Live Supabase auth ---------------------------------------------------------------------------

/** Where the live session persists on-device (a wobo-* key so "start over" erases it too). */
export const AUTH_SESSION_KEY = 'wobo-auth-session-v1';

export interface SupabaseAuthConfig {
  /** Supabase project URL (env only). */
  url: string;
  /** The publishable/anon key (client-safe, env only — never the service role). */
  anonKey: string;
  surface: 'expo' | 'pwa';
  /** Injectable for tests / non-DOM runtimes; defaults to localStorage. */
  storage?: KVStorage;
}

interface StoredSession {
  access_token: string;
  refresh_token: string;
  /** Epoch seconds. */
  expires_at: number;
  /** auth.uid() — the canonical subject. */
  subject_id: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id?: string };
}

/** Structural stand-ins for DOM globals — the sdk compiles without the DOM lib (node runtimes). */
interface LocationLike {
  hash: string;
  origin: string;
  pathname: string;
  search: string;
  assign(url: string): void;
}
interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string): void;
}

class MemoryKV implements KVStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/** Decode a JWT payload client-side (no verification — GoTrue signs it, RLS re-verifies server-side). */
function jwtClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1] ?? '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Read the `sub` claim (auth.uid) straight off a JWT. */
function jwtSub(token: string): string | null {
  const c = jwtClaims(token);
  return typeof c?.sub === 'string' ? c.sub : null;
}

/** The identity claims an OAuth session carries — Google fills email + name + avatar. */
export interface AccountProfile {
  /** auth.uid() — the canonical subject. */
  subjectId: string;
  email?: string;
  name?: string;
  avatar?: string;
}

async function gotrueError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error_description?: string;
      msg?: string;
      message?: string;
    };
    return body.error_description ?? body.msg ?? body.message ?? `status ${res.status}`;
  } catch {
    return `status ${res.status}`;
  }
}

/**
 * The live identity: Supabase Auth (GoTrue) over plain fetch — phone-OTP-first plus Google via the
 * OAuth redirect flow. The session persists under a wobo-* key, refreshes itself before expiry, and
 * exposes auth.uid() as the canonical subject_id.
 *
 * Consent stays `un_elevated` until verifiable parental consent exists (DPDP) — elevation is a
 * later Phase-4 step and there is no client-side switch for it.
 *
 * ponytail: plain fetch like SupabaseRest, no @supabase/supabase-js — add the SDK when realtime
 * auth events or PKCE become requirements.
 */
export class SupabaseAuthIdentity implements IdentityProvider {
  readonly auth: AuthSeams;
  private readonly storage: KVStorage;
  private session: StoredSession | null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly cfg: SupabaseAuthConfig) {
    this.storage =
      cfg.storage ?? (globalThis as { localStorage?: KVStorage }).localStorage ?? new MemoryKV();
    this.session = this.readStored();
    this.completeOAuthRedirect();
    this.scheduleRefresh();

    this.auth = {
      signInAnonymously: () => this.signInAnonymously(),
      requestPhoneOtp: (phone, options) => this.requestPhoneOtp(phone, options),
      verifyPhoneOtp: (phone, code) => this.verifyPhoneOtp(phone, code),
      signInWithGoogle: (redirectTo) => this.signInWithGoogle(redirectTo),
      signOut: () => this.signOut(),
      recordParentalConsent: notEnabled.recordParentalConsent,
      linkAccount: notEnabled.linkAccount,
    };
  }

  // --- IdentityProvider ---------------------------------------------------

  async getSession(): Promise<Session> {
    if (!this.session) throw new NotAuthenticatedError();
    return {
      subject_id: this.session.subject_id,
      // un_elevated until verifiable parental consent exists — never configurable client-side.
      consent_tier: 'un_elevated',
      surface: this.cfg.surface,
    };
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.session) return null;
    if (this.session.expires_at * 1000 - Date.now() < 30_000) await this.refresh();
    return this.session?.access_token ?? null;
  }

  isAuthenticated(): boolean {
    return this.session !== null;
  }

  /** The canonical subject (auth.uid), synchronously — null when signed out. */
  get subjectId(): string | null {
    return this.session?.subject_id ?? null;
  }

  /** The current access token without a refresh round-trip (SupabaseRest reads this per request). */
  currentAccessToken(): string | undefined {
    return this.session?.access_token;
  }

  /**
   * True when the session is an anonymous learner (no account yet). The brain reads the same
   * `is_anonymous` claim off the verified JWT and gives them a smaller day; this copy is for the
   * client's own choices (what to offer, what to migrate on upgrade), never for a permission.
   */
  isAnonymous(): boolean {
    if (!this.session) return false;
    return jwtClaims(this.session.access_token)?.is_anonymous === true;
  }

  /** Identity claims from the current session's JWT — Google fills these. Null when signed out. */
  accountProfile(): AccountProfile | null {
    if (!this.session) return null;
    const c = jwtClaims(this.session.access_token) ?? {};
    const meta = (c.user_metadata ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() ? v.trim() : undefined;
    return {
      subjectId: this.session.subject_id,
      email: str(c.email),
      name: str(meta.full_name) ?? str(meta.name),
      avatar: str(meta.avatar_url) ?? str(meta.picture),
    };
  }

  // --- The flows ------------------------------------------------------------

  /**
   * Anonymous sign-in (GoTrue `POST /signup` with no credentials). One JWT per device, minted on
   * first boot, so every learner — including the one who has not signed up yet — is a real subject
   * to the brain: identified, budgeted, safe. Signing in for real later upgrades the same person.
   * Idempotent: an existing session is returned untouched.
   */
  private async signInAnonymously(): Promise<Session> {
    if (this.session) return this.getSession();
    const res = await fetch(`${this.cfg.url}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: this.cfg.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`could not start a session: ${await gotrueError(res)}`);
    this.adopt((await res.json()) as TokenResponse);
    return this.getSession();
  }

  /**
   * ONLY THE SIGN-UP DOOR MAY MAKE AN ACCOUNT. `create_user` was hard-coded true here, so the
   * sign-in door — which asks no date of birth and takes no agreement to the terms — created a
   * brand-new account for any number typed into it, and every consent gate downstream had nothing
   * to read. The caller says which door it is; the default is the one that does not.
   */
  private async requestPhoneOtp(phone: string, options?: PhoneOtpOptions): Promise<void> {
    const createUser = options?.createUser === true;
    const res = await fetch(`${this.cfg.url}/auth/v1/otp`, {
      method: 'POST',
      headers: { apikey: this.cfg.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ phone, create_user: createUser }),
    });
    if (res.ok) return;
    const said = await gotrueError(res);
    // A refused signup is a nameable problem ("there is no account with that number"), not the
    // catch-all. GoTrue says so as `otp_disabled` / "Signups not allowed for otp"; anything else
    // stays the generic failure rather than being guessed at.
    if (!createUser && /otp_disabled|signups?\s+(are\s+)?not\s+allowed/i.test(said)) {
      throw new NoSuchAccountError();
    }
    throw new Error(`could not send the code: ${said}`);
  }

  private async verifyPhoneOtp(phone: string, code: string): Promise<Session> {
    const res = await fetch(`${this.cfg.url}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: this.cfg.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'sms', phone, token: code }),
    });
    if (!res.ok) throw new Error(`that code did not verify: ${await gotrueError(res)}`);
    const data = (await res.json()) as TokenResponse;
    this.adopt(data);
    return this.getSession();
  }

  private async signInWithGoogle(redirectTo?: string): Promise<void> {
    const loc = (globalThis as { location?: LocationLike }).location;
    if (!loc) throw new Error('Google sign-in needs a browser (redirect flow)');
    const dest = redirectTo ?? loc.origin;
    loc.assign(
      `${this.cfg.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(dest)}`,
    );
  }

  private async signOut(): Promise<void> {
    const token = this.session?.access_token;
    this.clear();
    if (!token) return;
    try {
      // Best-effort server-side revoke — local sign-out already happened either way.
      await fetch(`${this.cfg.url}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: this.cfg.anonKey, authorization: `Bearer ${token}` },
      });
    } catch {
      // unreachable network — the revoke retries never; the refresh token dies at expiry
    }
  }

  // --- Session plumbing -----------------------------------------------------

  /** Adopt a GoTrue token response as the current session and persist it. */
  private adopt(data: TokenResponse): void {
    const subject = data.user?.id ?? jwtSub(data.access_token);
    if (!subject) throw new Error('token response carried no subject');
    this.session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
      subject_id: subject,
    };
    try {
      this.storage.setItem(AUTH_SESSION_KEY, JSON.stringify(this.session));
    } catch {
      // storage unavailable — the session lives for this tab
    }
    this.scheduleRefresh();
  }

  private readStored(): StoredSession | null {
    try {
      const raw = this.storage.getItem(AUTH_SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<StoredSession>;
      if (!s.access_token || !s.refresh_token || !s.subject_id || !s.expires_at) return null;
      return s as StoredSession;
    } catch {
      return null;
    }
  }

  private clear(): void {
    this.session = null;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    try {
      // The key leaves rather than staying as an empty string on every after-sign-out listing.
      if (this.storage.removeItem) this.storage.removeItem(AUTH_SESSION_KEY);
      else this.storage.setItem(AUTH_SESSION_KEY, '');
    } catch {
      // fine
    }
  }

  /**
   * Complete the Google redirect: GoTrue's implicit flow returns tokens in the URL fragment.
   * Adopt them, then scrub the fragment so tokens never sit in history.
   */
  private completeOAuthRedirect(): void {
    const loc = (globalThis as { location?: LocationLike }).location;
    if (!loc?.hash.includes('access_token=')) return;
    const params = new URLSearchParams(loc.hash.slice(1));
    const access = params.get('access_token');
    const refresh = params.get('refresh_token');
    if (!access || !refresh) return;
    try {
      this.adopt({
        access_token: access,
        refresh_token: refresh,
        expires_at: Number(params.get('expires_at')) || undefined,
        expires_in: Number(params.get('expires_in')) || undefined,
      });
    } catch {
      return; // malformed fragment — stay signed out
    }
    (globalThis as { history?: HistoryLike }).history?.replaceState(
      null,
      '',
      loc.pathname + loc.search,
    );
  }

  private async refresh(): Promise<void> {
    const current = this.session;
    if (!current) return;
    try {
      const res = await fetch(`${this.cfg.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: this.cfg.anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      if (res.ok) {
        this.adopt((await res.json()) as TokenResponse);
        return;
      }
      // The refresh token was rejected (revoked/rotated elsewhere) — honestly signed out.
      if (res.status === 400 || res.status === 401 || res.status === 403) this.clear();
    } catch {
      // offline — keep the session; the next call retries
    }
  }

  /** Refresh ~1 min before expiry. Browser only — tests and node runtimes refresh lazily. */
  private scheduleRefresh(): void {
    if (!(globalThis as { window?: unknown }).window || !this.session) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const inMs = Math.max(5_000, this.session.expires_at * 1000 - Date.now() - 60_000);
    this.refreshTimer = setTimeout(() => void this.refresh(), inMs);
  }
}
