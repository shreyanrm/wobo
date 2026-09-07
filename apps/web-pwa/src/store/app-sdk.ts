'use client';

/**
 * The one SDK instance, and the env it is built from.
 *
 * It used to be minted inside `App()`, which meant the identity boundary, the Supabase client, the
 * event backbone and the provider seams were all in the entry chunk — downloaded by a visitor who
 * had only opened the marketing page. It lives here so the public site can reach it when a page
 * genuinely needs it (the ask box, the plans page's allowance, the two doors) and never otherwise.
 *
 * Building it is deliberately quiet: no session is minted, nothing is fetched. The anonymous
 * sign-in that gives a first-time learner a real identity belongs to the app runtime, behind the
 * door — a visitor reading the landing page must not be signed into anything.
 */

import { createSdk, DEV_DEFAULTS, type Sdk } from '@wobo/sdk';
import { resolveSupabaseUrl } from '../config/supabaseUrl';
import { deviceMockSubject } from './device';
import { applyScope, inheritScope, rememberedScope } from './scope';

// Every VITE_ name is typed in vite-env.d.ts, so these reads need no casts and a misspelled name
// is a compile error rather than a silent undefined.
export const LLM_MODE = import.meta.env.VITE_LLM_MODE ?? 'mock';
export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL;
// Live auth (Supabase phone-OTP + Google) only when explicitly flipped; dev mock stays the default.
const DEV_AUTH = import.meta.env.VITE_DEV_AUTH !== 'false';
// Live persistence (Supabase learner_state / learner_threads / outbox) — env only, keyless => local.
const PERSIST_MODE = import.meta.env.VITE_PERSIST_MODE ?? 'local';
// The database is reached through OUR origin when VITE_SUPABASE_PROXY=1 (a Vercel rewrite
// forwards /db/* to the project), so the browser never names the database host and the CSP does
// not have to allow it. One builder decides, and it is unit-tested (test/supabase-url.test.ts).
const SUPABASE_URL = resolveSupabaseUrl({
  projectUrl: import.meta.env.VITE_SUPABASE_URL,
  proxy: import.meta.env.VITE_SUPABASE_PROXY,
  appUrl: import.meta.env.VITE_APP_URL,
});
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
// A pre-minted access token is a DEV convenience and a production liability: shipped in a public
// JS bundle it is one long-lived bearer token every visitor holds, and every visitor is then the
// same learner — one budget, one consent tier, one archive. It exists only in a dev build.
const SUPABASE_DEV_JWT = import.meta.env.DEV ? import.meta.env.VITE_SUPABASE_DEV_JWT : undefined;
if (!import.meta.env.DEV && import.meta.env.VITE_SUPABASE_DEV_JWT) {
  console.warn('VITE_SUPABASE_DEV_JWT is set in a production build and has been ignored.');
}

let instance: Sdk | null = null;

/**
 * The SDK this tab uses. One instance for the life of the page — the public site and the app
 * runtime share it, so a visitor who walks through the door does not get a second client (two
 * places minting sessions is two places to get refresh wrong).
 */
export function appSdk(): Sdk {
  if (instance) return instance;
  const devSubject = deviceMockSubject(DEV_DEFAULTS.mockSubjectId);
  const s = createSdk({
    devAuth: DEV_AUTH,
    llmMode: LLM_MODE,
    gatewayUrl: GATEWAY_URL,
    persistMode: PERSIST_MODE,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    supabaseAccessToken: SUPABASE_DEV_JWT,
    ...(devSubject ? { mockSubjectId: devSubject } : {}),
  });
  // Everything personal is keyed to the learner who owns it, and the scope is set HERE — before
  // anything reads the archive, before any store is touched. A learner who was anonymous a moment
  // ago and has just signed in for real carries their world across.
  const subject = s.account?.subjectId() ?? null;
  const anonymous = s.account?.isAnonymous() ?? false;
  const previous = rememberedScope();
  if (subject && previous && previous.subject !== subject && previous.anonymous) {
    inheritScope(previous.subject, subject, anonymous);
    // The SDK's caches were built a moment ago on an account that had nothing under it; the
    // anonymous buckets have just moved there, so they read again (XP, the transcript, mastery).
    s.rekey(subject);
  } else {
    applyScope(subject, anonymous);
  }
  instance = s;
  return s;
}
