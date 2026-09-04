/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Every `VITE_` variable this app reads, declared once with its real type.
 *
 * Declaring them here is what makes a misspelling a compile error instead of a silent `undefined`
 * at runtime: `import.meta.env.VITE_GATEWY_URL` no longer type-checks, and the literal unions mean
 * a mode typo (`"live "`, `"LIVE"`) is caught at the read site rather than falling through to a
 * default three screens later. Nothing here is a secret: `VITE_` values are inlined into the client
 * bundle, so only publishable keys ever appear.
 *
 * Keep this list and `scripts/set-vercel-env.sh` in step — this is the contract that says which
 * names the deploy has to set.
 */
interface ImportMetaEnv {
  /** Mock brain (in-repo fixtures) or the live gateway. Default: mock. */
  readonly VITE_LLM_MODE?: 'mock' | 'live';
  /** Base URL of the gateway (no trailing slash), e.g. https://gateway.example.com. */
  readonly VITE_GATEWAY_URL?: string;
  /**
   * Where the OPERATOR CONSOLE talks to the brain. Falls back to VITE_GATEWAY_URL, so a local run
   * needs no new configuration; it exists so the console can be pointed at a private origin that
   * the learner app never touches.
   */
  readonly VITE_ADMIN_GATEWAY_URL?: string;
  /** Where this app is served from, for links a learner shares. Brand-neutral by env (plan §8). */
  readonly VITE_PUBLIC_ORIGIN?: string;
  /** Origin used to build invite links; falls back to `window.location.origin`. */
  readonly VITE_APP_URL?: string;
  /** `'false'` turns dev-mock auth OFF and requires the real Supabase session. Default: dev auth. */
  readonly VITE_DEV_AUTH?: 'true' | 'false';
  /** Local cache only, or Supabase-backed persistence. Default: local. */
  readonly VITE_PERSIST_MODE?: 'local' | 'live';
  /** Supabase project URL. */
  readonly VITE_SUPABASE_URL?: string;
  /**
   * `'1'` routes the database through our own origin (`/db`, a Vercel rewrite) instead of the
   * project URL, so the browser never names the database host. Anything else ⇒ direct.
   */
  readonly VITE_SUPABASE_PROXY?: string;
  /** The publishable/anon key — client-safe by design, never a service key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Dev-only signed JWT for local work against a real project. Refused outside `import.meta.env.DEV`. */
  readonly VITE_SUPABASE_DEV_JWT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
