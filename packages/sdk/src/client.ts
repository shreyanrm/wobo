import {
  InMemoryKgtopg,
  isAtFloor,
  type KGtoPG,
  type MasterySnapshot,
} from '@wobo/kgtopg-contract-seed';
import { resolveConfig, type SdkConfig } from './config';
import { mayCreateAccount } from './doors';
import { type EventProvider, InMemoryEventProvider, SupabaseOutboxEventProvider } from './events';
import { configureGatewayAuth, fetchMe, type Me } from './gateway';
import {
  type AccountProfile,
  DevMockIdentity,
  type IdentityProvider,
  SupabaseAuthIdentity,
} from './identity';
import { LocalMasteryProvider, type MasteryProvider, SupabaseMasteryProvider } from './mastery';
import {
  type ContentProvider,
  GatewayLLMProvider,
  type LLMProvider,
  type MessagingProvider,
  MockLLMProvider,
  MockMessagingProvider,
  MockPaymentProvider,
  type PaymentProvider,
  SeedContentProvider,
} from './providers';
import { LocalStateProvider, type StateProvider, SupabaseStateProvider } from './state';
import { ERASABLE_TABLES, type ErasureResult, eraseSubjectRows, SupabaseRest } from './supabase';
import { SyncHealth } from './sync-health';

/**
 * The assembled SDK — the one surface the app consumes. It wires the identity boundary, the KGtoPG
 * governed-view binding, and the provider seams, each selected mock-vs-live by config. The app never
 * reaches Supabase, the platform, or a model directly; it goes through here.
 */
export interface Sdk {
  config: SdkConfig;
  /**
   * THE SUBJECT EVERYTHING IS FILED UNDER. Ask for it here, never `config.mockSubjectId`.
   *
   * Under live auth the canonical subject is `auth.uid()`, and `config` is the raw resolved
   * configuration whose `mockSubjectId` is still the dev knob. Every event this session records is
   * attributed to the subject below, so a governed view asked about `config.mockSubjectId` in live
   * mode is asked about a learner with no evidence at all and answers from an empty band set. This
   * field is the attribution subject in both modes, so the question and the evidence agree.
   */
  subjectId: string;
  identity: IdentityProvider;
  kgtopg: KGtoPG;
  events: EventProvider;
  llm: LLMProvider;
  content: ContentProvider;
  messaging: MessagingProvider;
  payment: PaymentProvider;
  /** Learner state + Wobo threads: localStorage in local mode; Supabase-reconciled in live mode. */
  state: StateProvider;
  /**
   * Mastery: the evidence behind every band, and the bands themselves. Persisted (localStorage
   * always, `learner.mastery_cache` in live mode) so a returning learner resumes mid-climb instead
   * of starting the topic over. `hydrate()` reconciles and feeds the recovered evidence back into
   * the KGtoPG binding, so bands read after it are the learner's whole history, not this session's.
   */
  mastery: MasteryProvider;
  /**
   * Who the brain thinks this learner is, and what is left of their day. Null when no gateway is
   * configured (a keyless build has no meter to read). The client never computes a limit; it asks.
   */
  me(): Promise<Me | null>;
  /**
   * WHETHER THE LEARNER'S WORK IS ACTUALLY LANDING (`sync-health.ts`).
   *
   * Every remote write reports here. Past a run of failures the app is allowed to say one calm
   * sentence with a way to try again, instead of the boot loader going on promising "Your place is
   * saved" against a database that is refusing every write. Present in every mode; in a local build
   * nothing ever reports to it, so it is permanently quiet.
   */
  sync: SyncHealth;
  /**
   * The optional account layer — Supabase Auth as an ADDITIVE identity+sync layer, present whenever
   * the Supabase env keys are configured (even in dev-mock/local mode). Signing in never becomes a
   * wall: the local subject keeps working; a Google session just adds a real identity and syncs the
   * profile row. Undefined when no Supabase keys are configured (pure local build).
   */
  account?: AccountLayer;
  /**
   * The app moved a learner's buckets under a new subject (an anonymous learner signed in for real:
   * `store/scope.ts` inheritScope moves the SDK's `:<anon>` keys under the account) and the caches
   * built a moment earlier have to read them: this re-keys the state, thread and mastery caches
   * and feeds the mastery evidence back into the KGtoPG binding. The anonymous sign-in calls the
   * same thing on its own the moment its session lands.
   */
  rekey(subject: string): void;
}

/** The cached profile row for a subject — what a returning sign-in reconstructs their world from. */
export interface CachedProfile {
  display_name?: string;
  grade?: string;
  board?: string;
  /** Onboarding completion sentinel ('onboarded' once the flow finished) — reuses an existing column. */
  archetype_slot?: string;
}

/** The additive account surface the app offers from onboarding and You. */
export interface AccountLayer {
  isAuthenticated(): boolean;
  /** auth.uid() for the current session — null when there is none yet. */
  subjectId(): string | null;
  /** True when this session is an anonymous learner (a JWT, no account). */
  isAnonymous(): boolean;
  /**
   * Make sure this device has a session before anything talks to the brain: an anonymous sign-in
   * when there is none. Resolves to the subject id, or null when it could not be established
   * (anonymous sign-ins disabled, offline) — the app then runs local-only, as it always could.
   */
  ensureSession(): Promise<string | null>;
  /** The signed-in identity's claims (email/name/avatar), or null when signed out. */
  profile(): AccountProfile | null;
  /** Read the cached profile row for the signed-in subject (null when none / signed out). */
  fetchProfile(): Promise<CachedProfile | null>;
  /** Redirect to Google sign-in; the session completes on return via the URL fragment. */
  signInWithGoogle(redirectTo?: string): Promise<void>;
  /** End the account session (local caches stay — offline-first). */
  signOut(): Promise<void>;
  /** Upsert the learner profile row under auth.uid() (RLS-guarded, best-effort). */
  syncProfile(row: {
    display_name?: string;
    grade?: string;
    board?: string;
    archetype_slot?: string;
  }): Promise<void>;
  /**
   * Erasure (DPDP). Delete every row this account owns — learner state, threads, profile cache —
   * so "erase and start over" reaches the server and not only this device's localStorage. Reports
   * which tables went and which did not; nothing is claimed erased that was not.
   */
  eraseRemoteData(): Promise<ErasureResult>;
}

/** Never-uploaded placeholder for pre-sign-in live-mode events (RLS would reject them anyway). */
const NIL_SUBJECT = '00000000-0000-0000-0000-000000000000';

export function createSdk(overrides: Partial<SdkConfig> = {}): Sdk {
  const config = resolveConfig(overrides);
  // One counter for the whole SDK, handed to every provider that writes remotely.
  const sync = new SyncHealth();

  if (!config.devAuth && (!config.supabaseUrl || !config.supabaseAnonKey)) {
    // Secrets/keys come from env only — live auth without them is a misconfiguration, not a mode.
    throw new Error('DEV_AUTH=false requires SUPABASE_URL and SUPABASE_ANON_KEY from the env.');
  }
  // Supabase Auth exists whenever the (client-safe) keys are configured — additively, even in
  // dev-mock mode. It adopts an OAuth session from the URL fragment on construction, so a Google
  // round-trip completes on the next boot regardless of which mode the app runs in.
  const supabaseAuth =
    config.supabaseUrl && config.supabaseAnonKey
      ? new SupabaseAuthIdentity({
          url: config.supabaseUrl,
          anonKey: config.supabaseAnonKey,
          surface: config.surface,
        })
      : null;
  // In live mode (DEV_AUTH=false) it IS the app's identity; in dev-mock it stays a side account.
  const liveAuth = !config.devAuth ? supabaseAuth : null;
  const identity: IdentityProvider = liveAuth ?? new DevMockIdentity(config);

  // Live mode: auth.uid() IS the canonical subject, and consent stays un_elevated until verifiable
  // parental consent exists (DPDP) — the dev knobs never leak into a real session's attribution.
  const subjectId = liveAuth ? (liveAuth.subjectId ?? NIL_SUBJECT) : config.mockSubjectId;
  const attribution: SdkConfig = liveAuth
    ? { ...config, mockSubjectId: subjectId, consentTierDefault: 'un_elevated' }
    : config;

  // Live persistence needs the project URL + publishable key (env only); anything less stays local,
  // so mock mode keeps working fully keyless. Under live auth it additionally needs a signed-in
  // session — pre-sign-in the device stays on the local cache (the app re-creates the sdk after
  // the sign-in beat completes).
  const rest =
    config.persistMode === 'live' &&
    config.supabaseUrl &&
    config.supabaseAnonKey &&
    (!liveAuth || liveAuth.isAuthenticated())
      ? new SupabaseRest({
          url: config.supabaseUrl,
          anonKey: config.supabaseAnonKey,
          // Live auth reads the token per request so refreshes propagate; dev uses the env JWT.
          accessToken: liveAuth ? () => liveAuth.currentAccessToken() : config.supabaseAccessToken,
        })
      : null;

  // MASTERY SURVIVES A RELOAD. The cache is read before the KGtoPG binding is built, so the
  // reference starts the session already holding everything this learner has ever answered — the
  // band a returning learner sees is their whole history, not the last five minutes of it. Local
  // mode and a signed-out learner get the localStorage half and work exactly as before.
  const mastery: MasteryProvider = rest
    ? new SupabaseMasteryProvider(rest, subjectId, undefined, undefined, sync)
    : new LocalMasteryProvider(undefined, supabaseAuth?.subjectId ?? '');

  // Events go through the real contract; evidence-bearing events update mastery via the consumer
  // (the same reference instance), so attempts flow all the way to bands and ignite on seed data.
  // In live mode they are additionally batch-appended to learner.outbox for the relay.
  // Declared before the binding because the binding's change hook records through it. Null only
  // between these two statements; nothing consumes an event during the binding's construction.
  let events: EventProvider | null = null;

  // Mock-first: the in-repo reference. The live Supabase-backed client binds at Phase 1.
  const kgtopg = new InMemoryKgtopg({
    consentTier: attribution.consentTierDefault,
    evidence: { [subjectId]: mastery.loadCache() },
    onChange: (subject, snapshot, changes) => {
      // The repository holds exactly one learner; a snapshot for anyone else is not ours to write.
      if (subject !== subjectId) return;
      // Every crossing is written down before it is announced: a band the learner earned must
      // survive the tab closing a second later.
      mastery.save(snapshot);
      for (const change of changes) {
        // The contract has carried mastery.band.changed.v1 since commit 1 and nothing emitted it.
        // It does now — one event per crossing, ignite only when the topic reaches the floor for
        // the first time, so the moment stays scarce.
        events?.record(
          'mastery.band.changed.v1',
          {
            node_id: change.node_id,
            from_band: change.from,
            to_band: change.to,
            scope: 'node',
            ...(change.triggered_by_event_id
              ? { triggered_by_event_id: change.triggered_by_event_id }
              : {}),
            ignite: isAtFloor(change.to) && !isAtFloor(change.from),
          },
          { ontologyNodeId: change.node_id },
        );
      }
    },
  });

  events = rest
    ? new SupabaseOutboxEventProvider(attribution, kgtopg, rest, undefined, undefined, sync)
    : new InMemoryEventProvider(attribution, kgtopg);
  const eventProvider: EventProvider = events;

  // Local mode still knows who is signed in: the cache is scoped to the account (empty only in a
  // keyless build), so a second learner on the same browser reads their own bucket instead of the
  // previous one's XP, streak and conversation. The pre-scope bucket is adopted once, by the first
  // subject to claim the device (state.ts).
  const state: StateProvider = rest
    ? new SupabaseStateProvider(rest, subjectId, undefined, undefined, sync)
    : new LocalStateProvider(undefined, supabaseAuth?.subjectId ?? '');

  // One anonymous sign-in per device, at most one in flight: the boot effect asks for it, and any
  // gateway call that arrives first asks for it too, so a turn taken in the first second of a
  // learner's life still carries a real JWT instead of meeting a sign-in wall.
  //
  // AND IT ASKS THE DOOR FIRST (`doors.ts`, `docs/DOORS-CLOSED.md` §1 and §4). An anonymous
  // subject IS a freshly minted account: it costs one public call to the auth server, which the
  // gateway never sees and therefore cannot refuse. So while `doors_open` is false nothing is
  // minted here at all. A session that already exists is untouched, because the line above returns
  // before any of this: closing the door to new accounts is not locking anybody out (§2).
  let establishing: Promise<void> | null = null;
  const establishSession = async (): Promise<void> => {
    if (!supabaseAuth || supabaseAuth.isAuthenticated()) return;
    establishing ??= mayCreateAccount(config.gatewayUrl)
      .then(async (may) => {
        if (!may) return;
        await supabaseAuth.auth.signInAnonymously();
        // THE CACHES FOLLOW. Built before the session existed, they were keyed to nobody and
        // writing the plain keys; from here on they are this learner's, and what was written
        // plain moves under them (state.ts adoptPlainKeys).
        const subject = supabaseAuth.subjectId;
        if (subject) rekeyCaches(subject);
      })
      .catch(() => undefined) // refused or offline — the device stays local, never broken
      .finally(() => {
        establishing = null;
      });
    await establishing;
  };

  // Identity for every gateway call, bound once. With Supabase keys the learner's own JWT rides
  // each request (anonymous or signed in); without them this is a keyless dev/mock build and the
  // gateway is told which local subject is calling — a header it honours only outside production.
  configureGatewayAuth(
    supabaseAuth
      ? {
          accessToken: async () => {
            await establishSession();
            return (await supabaseAuth.getAccessToken()) ?? null;
          },
        }
      : config.supabaseAccessToken
        ? { accessToken: () => config.supabaseAccessToken ?? null }
        : { devSubject: config.mockSubjectId },
  );

  const llm: LLMProvider =
    config.llmMode === 'live' && config.gatewayUrl
      ? new GatewayLLMProvider(config.gatewayUrl)
      : new MockLLMProvider();

  const content: ContentProvider = new SeedContentProvider();
  const messaging: MessagingProvider = new MockMessagingProvider();
  const payment: PaymentProvider = new MockPaymentProvider();

  // The additive account layer: profile sync rides its own REST client keyed to the account token
  // (auth.uid()), independent of persistMode — so a Google session upserts profiles_cache even when
  // the device is otherwise in local mode.
  const accountRest =
    supabaseAuth && config.supabaseUrl && config.supabaseAnonKey
      ? new SupabaseRest({
          url: config.supabaseUrl,
          anonKey: config.supabaseAnonKey,
          accessToken: () => supabaseAuth.currentAccessToken(),
        })
      : null;
  const account: AccountLayer | undefined = supabaseAuth
    ? {
        isAuthenticated: () => supabaseAuth.isAuthenticated(),
        subjectId: () => supabaseAuth.subjectId,
        isAnonymous: () => supabaseAuth.isAnonymous(),
        ensureSession: async () => {
          await establishSession();
          return supabaseAuth.subjectId;
        },
        profile: () => supabaseAuth.accountProfile(),
        fetchProfile: async () => {
          const sub = supabaseAuth.subjectId;
          if (!sub || !accountRest) return null;
          try {
            const row = await accountRest.selectOne('profiles_cache', {
              match: { subject_id: sub },
              select: 'display_name,grade,board,archetype_slot',
            });
            return (row as CachedProfile | null) ?? null;
          } catch {
            // A READ, not a write: nothing of the learner's is lost by failing it, so it does not
            // go to `sync` — the local profile already answers every screen. Treated as no cached
            // profile, which is what an offline device genuinely has.
            return null;
          }
        },
        signInWithGoogle: (redirectTo) => supabaseAuth.auth.signInWithGoogle(redirectTo),
        signOut: () => supabaseAuth.auth.signOut(),
        eraseRemoteData: async () => {
          const sub = supabaseAuth.subjectId;
          if (!sub || !accountRest) return { erased: [], failed: [...ERASABLE_TABLES] };
          return eraseSubjectRows(accountRest, sub);
        },
        syncProfile: async (row) => {
          const sub = supabaseAuth.subjectId;
          if (!sub || !accountRest) return;
          try {
            await accountRest.upsert('profiles_cache', { subject_id: sub, ...row }, 'subject_id');
            sync.succeeded('profile');
          } catch (err) {
            // Still best-effort, still never thrown at the learner: the local profile holds and the
            // next sync carries it. Counted rather than dropped, because the learner's own name and
            // class not reaching their account is exactly the kind of loss they should hear about.
            sync.failed('profile', err);
          }
        },
      }
    : undefined;

  const me = async (): Promise<Me | null> =>
    config.gatewayUrl ? fetchMe(config.gatewayUrl) : null;

  // The reconcile: the remote rows merge into the cache, and the recovered evidence goes back into
  // the KGtoPG binding, so a band read after this is the learner's whole history. Wrapped here (not
  // inside the provider) because the provider knows about storage and nothing else.
  const masteryLayer: MasteryProvider = {
    loadCache: () => mastery.loadCache(),
    bands: () => mastery.bands(),
    save: (snapshot: MasterySnapshot) => mastery.save(snapshot),
    subscribe: (listener: () => void) => mastery.subscribe(listener),
    hydrate: async () => kgtopg.hydrateEvidence(subjectId, await mastery.hydrate()),
    flush: () => mastery.flush(),
    rekey: (scope: string) => {
      mastery.rekey(scope);
      kgtopg.hydrateEvidence(subjectId, mastery.loadCache());
    },
  };

  function rekeyCaches(subject: string): void {
    state.rekey(subject);
    masteryLayer.rekey(subject);
  }

  return {
    config,
    subjectId,
    identity,
    kgtopg,
    events: eventProvider,
    llm,
    content,
    messaging,
    payment,
    state,
    mastery: masteryLayer,
    me,
    sync,
    account,
    rekey: rekeyCaches,
  };
}
