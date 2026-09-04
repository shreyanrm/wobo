import type { ConsentTier } from '@wobo/contracts';

/**
 * SDK configuration. The app reads its environment and passes values in (dependency injection), so
 * the shared SDK never reads process.env / import.meta.env directly and works in both browser and node.
 * Each seam has a mock-vs-live switch; Phase 0 runs entirely on the mock/seed side.
 */
export interface SdkConfig {
  /** DEV_AUTH: true => the dev-mock user, no login. Flips false at Phase 4. */
  devAuth: boolean;
  /**
   * The dev mock subject's opaque UUID. The default below is a FIXED id, which is correct on a
   * laptop and wrong in a bundle: if a production build still runs dev auth, every visitor is
   * that one subject. The web app overrides it with a per-device id (`store/device.ts`).
   */
  mockSubjectId: string;
  consentTierDefault: ConsentTier;
  surface: 'expo' | 'pwa';
  displayName?: string;
  /** LLM_MODE: mock => deterministic in-process; live => calls the gateway. */
  llmMode: 'mock' | 'live';
  /** CONTENT_MODE: seed => the verified atom cache; live => generate->verify->cache. */
  contentMode: 'seed' | 'live';
  gatewayUrl?: string;
  /** PERSIST_MODE: local => localStorage only; live => Supabase state/outbox with a local cache. */
  persistMode: 'local' | 'live';
  /** Supabase project URL + publishable key (client-safe), from env only — required for live. */
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /**
   * The RLS access token: in dev a pre-minted JWT (sub = mockSubjectId, role authenticated) from
   * env; at Phase 4 the real Supabase session token. Never hardcoded, never committed.
   */
  supabaseAccessToken?: string;
}

export const DEV_DEFAULTS: SdkConfig = {
  devAuth: true,
  mockSubjectId: '00000000-0000-7000-8000-000000000001',
  consentTierDefault: 'un_elevated',
  surface: 'pwa',
  displayName: 'Learner',
  llmMode: 'mock',
  contentMode: 'seed',
  persistMode: 'local',
};

/** Merge partial overrides onto the dev defaults. */
export function resolveConfig(overrides: Partial<SdkConfig> = {}): SdkConfig {
  return { ...DEV_DEFAULTS, ...overrides };
}
