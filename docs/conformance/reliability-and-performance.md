# Conformance register — reliability and performance

**Domain:** reliability and performance of the Wobo learner product (web PWA, model gateway,
Supabase plane).
**Written:** 2026-09-04, branch `the-life`.
**Rule:** nothing is ticked without evidence. Every row is MET, PARTIAL, NOT MET, N/A or
NOT VERIFIED, with a `file:line` or a command and its real output.

## How the measurements in this register were taken

Everything with a number in it was measured, not estimated. Reproduce it like this:

```sh
cd /Users/depl/Documents/classess-learner
bun run --filter '@wobo/web-pwa' build        # real production build (mode=production)
cd apps/web-pwa && bun run vite preview --port 4318 --strictPort
```

Then Playwright (`playwright-core@1.58.2`, chromium-1208, already in the tree) drives the page
emulating a **Pixel 5, 4x CPU throttle, 1.6 Mbit/s down, 150 ms RTT** — a mid-range Indian phone on
a poor 4G link, which is the device family the code itself names (`apps/web-pwa/src/shell/resilience.ts:3`).
LCP / CLS / long tasks come from `PerformanceObserver` (`largest-contentful-paint`, `layout-shift`,
`longtask`) with `buffered: true`. Transfer sizes come from `PerformanceResourceTiming.transferSize`
(over the wire, post-compression) and `decodedBodySize`.

The same script was run against the **live production site** `https://heywobo.com` and the numbers
agree with the local preview build to within noise, so the local figures below are a fair proxy.

The scripts live in this session's scratchpad
(`/private/tmp/claude-501/-Users-depl-Documents-classess-learner/e78e989d-9890-46b7-8ea9-a8b6fca9a943/scratchpad/`:
`cwv.mjs`, `cwv2.mjs`, `wire.mjs`, `cls.mjs`, `offline2.mjs`, `fonts.mjs`, `hang.mjs`, `gwdown.mjs`).
They are throwaway measurement harnesses, not repo code; if these numbers are to be defended over
time they need to become a committed budget check (see item 10.4).

---

## 1. Core Web Vitals — measured on the real built pages

### The raw numbers

Throttled (Pixel 5 · 4x CPU · 1.6 Mbit/s · 150 ms RTT), **no interaction**, local production build:

| Page | LCP | FCP | CLS | TBT | long tasks | wire KB | decoded KB | requests |
|---|---|---|---|---|---|---|---|---|
| `/` (landing) @2 s | 2196 ms | 2196 ms | **0.106** | 444 ms | 4 | 276 | 588 | 18 |
| `/security` @2 s | 2260 ms | 2260 ms | 0.0003 | 113 ms | 1 | 276 | 599 | 37 |
| `/plans` @2 s | 2060 ms | 2060 ms | 0.021 | 37 ms | 1 | — | 570 | 35 |
| `/` @9 s (after the idle prefetch) | 2144 ms | 2132 ms | 0.100 | 348 ms | 3 | 530 | 1361 | 34 |
| `/security` @9 s | 2272 ms | 2272 ms | 0.0003 | 134 ms | 2 | — | 1278 | 46 |

Same script against **production `https://heywobo.com`**:

| Page | LCP | FCP | CLS | TBT | decoded KB |
|---|---|---|---|---|---|
| `/` @2 s | 2204 ms | 2012 ms | 0.027 | 145 ms | 590 |
| `/security` @2 s | 2092 ms | 2092 ms | 0.0004 | 102 ms | 601 |
| `/plans` @2 s | 1924 ms | 1924 ms | 0.0033 | 27 ms | 566 |
| `/` @9 s | 2192 ms | 2124 ms | **0.079** | 164 ms | 1361 |

Unthrottled desktop-class, same build: LCP 352–400 ms, CLS ≈ 0.

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 1.1 | LCP ≤ 2.5 s at p75 on mobile | Core Web Vitals "good" | **MET** (lab, single run) | Measured LCP 1908–2304 ms on every public page under 4x CPU / 1.6 Mbit/s; prod `/` 2204 ms, `/plans` 1924 ms. See table above | — |
| 1.2 | LCP ≤ 2.5 s on the **app** shell | Core Web Vitals | **NOT VERIFIED** | The app's own routes render the onboarding/sign-in beat without a session, so the LCP measured there is the sign-in card, not a learner's home. Verifying needs a seeded, signed-in session against a live gateway | Add a Playwright fixture that mints a real anonymous session, then measure `/`, `/practice`, `/progress` |
| 1.3 | CLS ≤ 0.1 | Core Web Vitals "good" | **PARTIAL** | The document pages are excellent (`/security` 0.0003, `/plans` 0.003). The **landing is at or over the line**: 0.106 local, 0.079–0.099 prod. One shift of **0.0934 at t=2211 ms** does all the damage | See 1.4 |
| 1.4 | No late layout shift from the hero | Core Web Vitals / CLS sources | **NOT MET** | `cls.mjs` names the shifting nodes: `div.device`, `div.stagewrap`, `div.under.reveal`, `a.btn.ghost` — the drawn-device stage and the reveal band under the hero, shifting once at 2.2 s as the hero mounts | Reserve the device stage's height with an `aspect-ratio` / `min-height` box so the reveal band never moves when the stage paints |
| 1.5 | INP ≤ 200 ms | Core Web Vitals "good" | **NOT VERIFIED** | Real INP needs field data from real taps. The lab proxy (max `PerformanceEventTiming.duration` after one synthetic click + scroll) read 0–128 ms throttled — but one unthrottled `/` run read **768 ms**, almost certainly the click that triggers the runtime chunk import. A single synthetic click is not INP | Ship a `web-vitals` field beacon (or run a scripted interaction suite over the real app screens) before claiming INP |
| 1.6 | TBT / main-thread blocking under control | Lighthouse TBT < 200 ms | **PARTIAL** | `/plans` 27–37 ms and `/security` 102–113 ms are good. The **landing is 348–444 ms local, 145–164 ms prod**, across 3–4 long tasks | Split the landing's hero/scroll choreography so no single task exceeds 50 ms; it is the heaviest page and the one every stranger meets first |
| 1.7 | TTFB | Core Web Vitals ≤ 800 ms | **MET** | `curl -s -o /dev/null -w "%{time_starttransfer}"` against `https://heywobo.com/` → **0.079 s**; Vercel edge, `x-vercel-cache: HIT` | — |
| 1.8 | Field (RUM) Core Web Vitals from real learners | CrUX / real-user monitoring | **NOT MET** | No RUM at all. `grep -rniE "web-vitals\|posthog\|sentry\|gtag"` over `apps packages services` → no matches; the only analytics claim in the repo is the *absence* of one (`docs/conformance/privacy-and-children.md:53`) | Add a first-party vitals beacon to the gateway (no third-party SDK needed — it can POST to a `/v1/vitals` route), or accept lab-only numbers and say so publicly |
| 1.9 | No render-blocking third-party resources on first paint | Web performance baseline | **MET** | `apps/web-pwa/index.html` has no third-party `<link>`; fonts are self-hosted from `/fonts` and preloaded (`apps/web-pwa/vite.config.ts:29-40`); CSP forbids other script origins (`vercel.json:23`) | — |
| 1.10 | First paint has a correct background in both themes (no white flash) | Perceived performance | **MET** | Inline `<style>` in `apps/web-pwa/index.html` paints `#FFFFFF` / `#0E0E16` before any JS, with `data-theme` overrides | — |

---

## 2. Bundle size, and whether the public site really ships only the site

### What actually goes down the wire

`bun run --filter '@wobo/web-pwa' build` — 102 JS chunks, `dist` 12 MB on disk, 4.8 MB of JS,
**1429 KiB gzipped across all chunks**, plus one 6.9 MB `RDKit_minimal-*.wasm`.

Largest chunks (raw / gzip, from the build log):
`heavy-three` 891.5 / 238.7 KB · `heavy-3dmol` 588.3 / 168.5 KB · `EnginesGallery` 497.9 / 166.3 KB ·
`AppRuntime` 364.2 / 103.5 KB · `core` 342.4 / 104.5 KB · `Landing` 226.2 / 75.5 KB ·
`react` 194.4 / 60.7 KB · `opentype.module` 173.5 / 50.0 KB · `motion` 123.0 / 41.1 KB ·
`zod` 76.0 / 20.3 KB.

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 2.1 | The public site ships the site and not the app **on first paint** | The repo's own law (`apps/web-pwa/src/shell/public-routes.ts:4-8`, `App.tsx:6-11`) | **MET** | Measured with zero interaction, 2 s after load: `/` and `/security` fetch **276 KB over the wire / ~590 KB decoded, 18–37 requests**, and `AppRuntime`, `wobo-board`, `wobo-answers` are **absent** from the request list. The split is real | — |
| 2.2 | …and keeps shipping only the site while the visitor reads | Same law | **NOT MET as stated** | 4 s after load, or on the **first `pointermove`/`wheel`/`keydown`**, `App.tsx:80-101` fires `import('./AppRuntime')`. Measured: every public page then pulls `AppRuntime` 356 KB + `wobo-board` 73 KB + `wobo-answers` 60 KB, taking the page from 276 → **530 KB wire / 1361 KB decoded**. A parent who opens `/security` and scrolls downloads the whole tutoring runtime | This is a deliberate trade (documented at `App.tsx:74-79`) and it may well be right — but the register must record that "downloads the site and nothing else" is true for ~4 s, not for the visit |
| 2.3 | The runtime prefetch respects Data Saver / a 2G link | `Save-Data` / Network Information API; the repo's own India-reality law | **NOT MET** | `apps/web-pwa/src/shell/resilience.ts:29-35` already reads `saveData` and `effectiveType` — and `App.tsx:80-101` never consults it. A learner on Data Saver or `effectiveType: '2g'` gets the same unsolicited 254 KB | Gate the prefetch on `decideFidelity(readSignals()) === 'full'`; the function already exists, it is one import |
| 2.4 | No app-only library reaches a document page | The manualChunks contract (`apps/web-pwa/vite.config.ts:66-121`) | **PARTIAL** | Holds for `motion`, `heavy-three`, `heavy-3dmol`. **Broken for `zod`**: `/security` and `/plans` fetch `zod-Bos346-A.js` (74 KB raw / 20 KB gz) within 2 s of load, before any prefetch. The comment at `vite.config.ts:104-105` says zod is "reached only through Wobo's board plans" — a document page is pulling it | Trace the import chain from the site's page table to zod (likely a shared contracts/schema import) and move the parse behind the app boundary |
| 2.5 | Heavy engines stay out of the first load and out of the precache | Bundle discipline | **MET** | `vite.config.ts:150` `globIgnores: ['**/RDKit_minimal*.wasm', '**/assets/heavy-*']`, with matching CacheFirst runtime rules at `:152-163`. Verified in the built `dist/sw.js`: the 123 precache URLs contain **no** `heavy-*` and **no** `.wasm` | — |
| 2.6 | Fonts are a proportionate share of the first load | Web font budget | **PARTIAL** | Fonts are **106 KB of the 276 KB first load — 38%** — on every public page. `Caveat-latin.woff2` alone is 73 KB and is preloaded on every page (`vite.config.ts:35-38`) even where no handwriting is drawn | Subset Caveat to the glyphs the hero headline actually uses, or preload it only on routes that render handwriting |
| 2.7 | The handwriting TTF is justified and not on the critical path | Asset discipline | **MET, with a note** | `public/fonts/Caveat-Regular.ttf` is **403 KB** and is fetched on the app path. It is not decoration: `packages/wobo/src/board/handwriting.ts:51` (`HAND_FONT_URL`) hands the raw TTF to opentype.js for glyph outlines — Wobo's actual hand. It is not preloaded and not on the landing's critical path | — |
| 2.8 | A bundle-size budget is enforced in CI | Performance budget | **NOT MET** | `.github/workflows/ci.yml` builds the web app twice as a compile gate and runs three brand gates, but asserts nothing about size. Rollup's own 500 kB warning fires on `EnginesGallery`, `heavy-3dmol`, `heavy-three` on every build and nothing fails | Add a size check on the entry set (entry + react + tokens + CSS) and on `AppRuntime`, failing the build over a threshold |
| 2.9 | Static assets are immutably cached | HTTP caching | **PARTIAL** | `curl -D -` on prod: `/assets/index-*.js` → `cache-control: public, max-age=31536000, immutable` (`vercel.json:56-63`). But `/fonts/Caveat-Regular.ttf` and `/fonts/Poppins-700-latin.woff2` → `public, max-age=0, must-revalidate` — 106 KB of **content-stable, never-changing** font revalidated on every navigation | Add a `/fonts/(.*)` rule to `vercel.json` headers with a long max-age (they are not content-hashed, so version the path or accept a long TTL) |
| 2.10 | Code splitting per route | Bundle discipline | **MET** | Every screen is behind `React.lazy`; the build emits 102 chunks with per-screen names (`Home`, `Course`, `Practice`, `Security`, `Plans`, …) — see the build log | — |

---

## 3. The offline story — what works, what queues, what is lost

The PWA precaches **123 entries, 3324.85 KiB** (`vite-plugin-pwa` output), `registerType: 'autoUpdate'`,
`skipWaiting` + `clientsClaim` + `cleanupOutdatedCaches` (`vite.config.ts:127-133`), and a
`NavigationRoute` bound to `index.html` (confirmed in the built `dist/sw.js`).

Measured offline (`offline2.mjs`: load online, walk the routes, `context.setOffline(true)`, reload):

| Offline navigation | Result |
|---|---|
| `/` (landing), `/security`, `/plans` and every document page | **Renders fully** — 9–10 k characters of real content |
| `/404` and any unknown address | **Renders the real 404 page** |
| `/practice`, `/you`, `/progress`, `/learn`, `/chat` with **no prior session** | Renders the **sign-in beat**, not the learner's work |
| `/fonts/*.woff2`, `/fonts/Caveat-Regular.ttf` | **`fetch` fails** (proved with `cache: 'no-store'` to bypass the HTTP cache) |
| `/assets/heavy-*` never opened online | `fetch` fails (by design — CacheFirst populates on first real use) |

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 3.1 | The app shell loads offline | PWA baseline | **MET** | SW controls the page (`navigator.serviceWorker.controller` truthy), 123 precache entries in `workbox-precache-v2-...`, every route navigates offline without a network error | — |
| 3.2 | Every public document page reads offline | PWA baseline | **MET** | `/security` 9073 chars, `/` 10408 chars, `/plans` full content, all with the context offline | — |
| 3.3 | Wobo's own fonts survive offline | PWA completeness | **NOT MET** | The built `dist/sw.js` precache manifest contains **no font at all** (`urls.filter(u=>/font|ttf/i.test(u))` → `[]`), and there is no runtime rule for `/fonts/*` (`vite.config.ts:152-163` covers only RDKit and `heavy-*`). Offline, all three font fetches fail. `includeAssets` at `vite.config.ts:110-116` lists the logo, favicon, robots and sitemap — not the fonts | Add `'fonts/**/*'` to `includeAssets`, or a `StaleWhileRevalidate` runtime rule for `/fonts/`. Without it Wobo's handwriting is unavailable offline the moment the browser HTTP cache is evicted |
| 3.4 | A learner's saved lessons and conversation work offline | `resilience.ts:63-65` — `OFFLINE_LINE` promises exactly this | **PARTIAL / NOT VERIFIED** | The *promise* is `"You're offline — your saved lessons, practice, and our whole conversation still work."` The *lock* is `AppRuntime.tsx:904`: `const locked = !sdk.config.devAuth && !sdk.identity.isAuthenticated()`. Production runs `VITE_DEV_AUTH=false` (`apps/web-pwa/.env.production:3`). A learner **who has signed in before** keeps working: `identity.ts:284` returns true on a persisted session and never checks expiry, and `refresh()` at `identity.ts:476-478` keeps the session on a network error. A learner who has **never** established a session cannot: offline `signInAnonymously()` fails, is swallowed (`client.ts:229`), and every app route renders the sign-in beat — which is what the offline test above measured | Verify the returning-learner case with a real signed-in fixture, and either soften the lock for a device that has local state or narrow `OFFLINE_LINE` so it does not promise what a first-time offline learner does not get |
| 3.5 | A question typed offline is queued and sent on reconnect | Offline-first | **PARTIAL** | The queue exists and works within the tab: `AppRuntime.tsx:516-518` pushes to `pending`, `:834-841` drains it once, in order, when `offline` flips false. But `pending` is **React `useState`** (`AppRuntime.tsx:332`) — pure memory. **Close the tab offline and every queued question is gone**, with no trace | Persist `pending` to `localStorage` the way `store/downloads.ts:53` already does for the download queue |
| 3.6 | Learning events recorded offline survive the tab closing | Transactional-outbox durability | **NOT MET — and the code says so** | `packages/sdk/src/events.ts:98-100`: *"the pending queue is in-memory — events recorded fully offline that never see another flush are lost with the tab."* `SupabaseOutboxEventProvider.pending` is a plain array (`events.ts:104`). Every attempt, band crossing and turn recorded during an offline session is lost if the learner closes the tab before reconnecting | Move `pending` to `localStorage`/IndexedDB and drain on boot. The class already re-arms its own timer (`events.ts:154`); only the storage is missing |
| 3.7 | A long-delayed flush is safe (no duplicates, no ordering damage) | At-least-once delivery | **MET (by design), NOT VERIFIED (in fact)** | `events.ts:96-97` and `infra/supabase/migrations/0005_learner_state_threads_relay.sql:4` say `outbox_append_batch` dedupes on `event_id`, so a retry after any delay is a no-op, and a failed flush re-prepends in order (`events.ts:151`). No test exercises a flush after a long delay, and the relay that would consume the rows has never run (item 9.4) | Add a test that flushes a stale batch twice and asserts one row per `event_id` |
| 3.8 | Learner state / mastery survive offline and reconcile on reconnect | Offline-first durability | **PARTIAL** | Both providers fall back to the local cache on any error and merge on the next boot (`packages/sdk/src/state.ts:432-434`, `packages/sdk/src/mastery.ts:292-294`). But the **debounced push swallows its failure with no retry**: `state.ts:443` `void this.upsertState(...).catch(() => {})` and `mastery.ts:303` do the same. The comment says "next push" — but a push only happens on the next `save()`. A learner's **last action of a session** that fails to upload is device-only, silently | Re-arm a timer on a failed push the way `events.ts:154` does, and flush on `visibilitychange`/`pagehide` |
| 3.9 | The service worker updates without stranding a learner on a stale build | PWA update discipline | **MET** | `skipWaiting: true`, `clientsClaim: true`, `cleanupOutdatedCaches: true`, `registerType: 'autoUpdate'` (`vite.config.ts:127-133`), and `/sw.js` + `/registerSW.js` + `/manifest.webmanifest` are served `max-age=0, must-revalidate` (`vercel.json:65-89`, confirmed with `curl -D -` on prod) | — |
| 3.10 | A stale precache does not outlive its assets | PWA correctness | **MET** | `cleanupOutdatedCaches: true`; asset URLs are content-hashed and immutable | — |
| 3.11 | The learner is told what still works when offline | Dead-end rule | **PARTIAL** | The copy exists and is good (`resilience.ts:61-65`), and `screens/states/select.ts:57-63` correctly decides *not* to show an offline page just for being offline. But per 3.4 the copy over-promises for a first-time offline learner | Reconcile the copy with the lock |

---

## 4. Error handling — every network call, and what a learner sees

There are twelve outbound call sites in the app. This is all of them.

| # | Call site | What a learner sees on failure | Status |
|---|---|---|---|
| 4.1 | `AppRuntime.tsx:707` `sdk.llm.invoke('wobo.turn', …)` — the main turn | Wobo's own line via `refusalLine` (`AppRuntime.tsx:807-816`): sign-in / spent-day / wobbly-network / "give me a moment" | **MET** |
| 4.2 | `wobo/board-stream.ts:240` → `board-turn.ts:287` — the streamed board turn | Same `refusalLine` path (`AppRuntime.tsx:497-503`); a barge-in is correctly silent (`refusals.ts:29-38`) | **MET** |
| 4.3 | `wobo/speech.tsx:211` — TTS for Wobo's voice | **Silence.** Deliberate: `return null` on any non-ok or abort (`speech.tsx:218,224`). The reply is already on screen; voice is grace | **MET (justified silent)** |
| 4.4 | `engines/PodcastPlayer.tsx:130` — TTS per podcast chapter | Falls back to the transcript, `catch { return null }` (`:144-147`) | **MET (justified silent)** |
| 4.5 | `packages/sdk/src/gateway.ts:170` `mintVoiceToken` | `return null` → voice simply unavailable, no line | **MET (justified silent)** |
| 4.6 | `wobo/tutor.ts:152` `regrade` | The local substitution proof already decided; the verifier being unreachable changes nothing (`:161-163`) | **MET** |
| 4.7 | `wobo/tutor.ts:294` `composeBridge` | Falls back to an honest local outline built from the learner's own mastered topics (`:311-330`) | **MET** |
| 4.8 | `wobo/capabilities.ts:190` | — | **NOT VERIFIED** — not read in this pass |
| 4.9 | `screens/course/Composing.tsx:1146,1342` | — | **NOT VERIFIED** — not read in this pass |
| 4.10 | `store/DownloadCenter.tsx:101` | Reports to the state layer: `failureFromError` → `reportFailure` (`:116`), which surfaces the daily-limit / server-error / offline page | **MET** |
| 4.11 | `store/mind.ts:333` — server-side erasure | — | **NOT VERIFIED** — the gateway half returns a 502 with a Wobo line (`app.py:838-849`); the client half not read |
| 4.12 | `packages/sdk/src/supabase.ts` — every `rpc`/`select`/`upsert`/`delete` | **Nothing.** Every failure is swallowed by the caller (`state.ts:443`, `mastery.ts:303`, `client.ts:293,308`, `events.ts:149`) | **NOT MET** — see 4.15 |

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 4.13 | A learner is never shown a status code, a stack trace or a provider name | The repo's own law (`packages/sdk/src/gateway.ts:29-36`) | **MET** | `refusals.ts:52-70` maps every throwable to one Wobo sentence; the gateway's own refusals carry `{code, message}` in Wobo's voice (`app.py:777-797`); the outbound safety screen runs over anything a model produced (`app.py:341-345`) | — |
| 4.14 | An error boundary catches a screen that throws | Resilience baseline | **PARTIAL** | Two boundaries exist: `PublicSite.tsx:45-52` (falls the visitor through to the runtime) and `screens/states/StateHost.tsx:33-50` (reports a `server` failure and renders the state page). Neither wraps `appSdk()` itself — and `createSdk` **throws** on a misconfigured env (`packages/sdk/src/client.ts:126-129`, `DEV_AUTH=false` without an anon key), from `store/app-sdk.ts:57` with no try/catch. A missing Vercel env var is a white screen | Wrap `appSdk()` and render the state layer's `ServerError` instead of unmounting |
| 4.15 | No **silent** failure in anything that saves a learner's work | The one thing a child is trusting | **NOT MET** | The persistence layer fails silently in five places: `state.ts:443`, `mastery.ts:303`, `client.ts:293` (`fetchProfile`), `client.ts:308` (`syncProfile`), `events.ts:149` (outbox flush). None reports to `reportFailure`, none retries beyond the next unrelated write, none tells the learner. The boot loader's last word is *"Your place is saved"* (`apps/web-pwa/src/main.tsx:66`) — which is a promise the write path does not keep when it quietly fails | At minimum, count consecutive push failures and, past a threshold, surface one honest Wobo line ("I can't reach my notebook right now — everything is safe on this device"). Silence here is the finding |
| 4.16 | A spent daily budget reaches the dedicated `DailyLimit` page | The state layer's own design (`screens/states/select.ts:70`) | **PARTIAL** | The page exists and `selectState` routes `kind: 'budget'` to it. But **nothing on the main turn path reports it**: `grep -rn "reportFailure" apps/web-pwa/src` shows only `PublicSite.tsx:52`, `Auth.tsx:171`, `DownloadCenter.tsx:116`. A `BudgetExhaustedError` from `ask`/`askBoard` becomes a chat line (`AppRuntime.tsx:810`) and the plan door beside it is never offered | Call `reportFailure({kind:'budget', resetAt})` from `refusalLine`'s budget branch, or accept that the page only serves generations and document it |
| 4.17 | Unhandled promise rejections cannot crash the page | Browser resilience | **MET** | `events.ts:64-70` explicitly catches the floating consumer promise and records the failure rather than letting it escape as an unhandled rejection; `board-stream.ts:285-288` guards `reader.cancel()` | — |
| 4.18 | The gateway never returns a bare 500 to a learner-facing call | Error contract | **PARTIAL** | The named refusals are all handled and Wobo-voiced (`app.py:777-797`, `:955-1019`). A **provider failure that exhausts the whole chain** falls to `except Exception: budget.refund(...); raise` (`app.py:1020-1022`, `:952-955`) → FastAPI's default `{"detail":"Internal Server Error"}` with no `code`, no `Retry-After`. The client copes (`gateway.ts:118` → `GATEWAY_COPY.trouble`), so the learner still gets a sentence — but the status is a 500 and nothing tells the client when to try again | Add an exception handler that returns 503 with `{code:'brain_unreachable', message: …}` and a `Retry-After` |
| 4.19 | The budget is refunded when a call fails | Fairness | **MET** | Three refund paths, all present: `app.py:951`, `:1021`, `app.py:601` (board stream) | — |
| 4.20 | Console errors are not the only record of a failure | Observability | **NOT MET** | `StateHost.tsx:46` `console.error('a screen failed to render', error)` is the only place a render crash is recorded, and nothing collects it. See §10 | — |

---

## 5. Timeouts, retries and backoff

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 5.1 | Every browser→gateway call has a timeout | Reliability baseline | **NOT MET — proved** | `packages/sdk/src/gateway.ts:127-131` `gatewayFetch` passes no `signal` and no timeout. `packages/sdk/src/providers.ts:136-141` `GatewayLLMProvider.invoke` adds none. **Proved in a browser**: routing `api.heywobo.com` to a socket that accepts and never answers, a `fetch` to `/v1/capability/wobo.turn` was **still pending after 45 s** (`hang.mjs` → `{"settled":"STILL PENDING after 45s","ms":45001}`). `AppRuntime.tsx:817-819` clears `busy` only in `finally`, so a stalled gateway leaves Wobo silent and busy with no line and no way out on the non-streaming path | Give `gatewayFetch` a default `AbortSignal.timeout(…)`, ~65 s for a turn and ~185 s for a generation, just above the gateway's own ceilings |
| 5.2 | The streamed board turn has an idle watchdog | Streaming reliability | **NOT MET** | `board-stream.ts:262-265` awaits `reader.read()` in a loop with no per-frame deadline. `board-turn.ts:239` does create an `AbortController`, so the learner *can* barge in — but nothing aborts on its own if frames simply stop arriving | Abort the reader if no frame lands within N seconds and let the existing single resume take over |
| 5.3 | TTS has a timeout | Reliability | **PARTIAL** | `wobo/speech.tsx:26` `TTS_TIMEOUT_MS = 8000`, with a real `AbortController` at `:206-207` and a playback watchdog at `:328`. **`engines/PodcastPlayer.tsx:130` has neither** — no signal, no timeout | Reuse the same 8 s abort in `PodcastPlayer` |
| 5.4 | Browser→Supabase calls have a timeout | Reliability | **NOT MET** | None of `rpc`, `selectOne`, `select`, `delete`, `upsert` in `packages/sdk/src/supabase.ts:96-172` passes a signal. A hung PostgREST connection hangs the hydrate | Same fix as 5.1, applied to `SupabaseRest` |
| 5.5 | Browser→Supabase **auth** calls have a timeout | Reliability | **NOT MET** | `packages/sdk/src/identity.ts:465-469` `refresh()` — plain `fetch`, no signal | — |
| 5.6 | Every gateway→model call has a deadline | Reliability | **MET** | `services/gateway/src/wobo_gateway/providers.py:34-35` `TURN_TIMEOUT_S = 60.0`, `GENERATION_TIMEOUT_S = 180.0`; `timeout_for()` at `:49-55` clamps any caller override *down* to the class ceiling and is passed at every call site (`providers.py:225,292,467`, `wobo.py:1198,1593`, `ask_public.py:988`) | — |
| 5.7 | Every gateway→Supabase call has a deadline | Reliability | **MET** | `_HTTP_TIMEOUT_S` present at every `urlopen`: `auth.py:38` 5 s, `memory.py:44` 5 s, `billing.py:78` 5 s, `consent.py:45` 5 s, `parents.py:73` 5 s, `curriculum/store.py:63` 6 s, `hospitality/preferences.py:46` 5 s, `hospitality/jobs.py:93` 5 s | — |
| 5.8 | Retry with backoff on a transient outbound failure | Resilience baseline | **PARTIAL** | Exactly **one** outbound path retries: the email provider (`email.py:15,269,291-296`) — retry on 5xx and network faults, 4xx final, with a `_BACKOFF_S` table and a `_sleep` test seam. Everything else — every gateway→Supabase call, every browser→Supabase call — gets **one attempt** | Give the gateway's Supabase seam the same helper `email.py` already has; it is written and tested |
| 5.9 | The model call retries on a transient provider failure | Provider resilience | **PARTIAL, by choice** | `model_call.py:15` is explicit: *"Nothing else is retried here: a real failure (no credit, a bad key, a timeout) is raised as it arrived."* The only retry is the fussy-sampling-knob backstop (`:107-111`). LiteLLM's own `num_retries` is never set at any call site (`grep -rn "num_retries" services/` → no matches). Cross-provider failover carries the redundancy instead (§6) | Defensible — but a transient 529/overloaded from the *last* provider in the chain currently costs the learner the turn. One retry on 5xx/429-with-Retry-After would be cheap |
| 5.10 | The offline outbox flush backs off | Queue discipline | **PARTIAL** | `events.ts:145-156` re-arms on failure, but at a **fixed 800 ms** (`flushAfterMs`) forever — no exponential backoff, no jitter, no attempt cap. A gateway-down period means a Supabase RPC every 800 ms per tab | Add exponential backoff with a ceiling |
| 5.11 | A dropped stream resumes rather than being re-charged | Cost + UX | **MET** | `board-turn.ts:305-317` resumes **once** from the last acknowledged frame, and only if a frame landed; a barge-in and a typed refusal are excluded. The gateway honours `last-event-id` before charging (`app.py:544-549`) | — |
| 5.12 | Resume survives a restart / a second instance | Reliability | **NOT MET** | `board/stream.py:104` `_turns: dict[str, Turn]` — in-process, `_MAX_TURNS = 512`, `TURN_TTL_S = 180.0` (`:66-67`). A redeploy or a second replica loses every resumable turn | Move to Redis with the rest of the shared state (see 8.2) |
| 5.13 | The rate limiter tells the caller when to try again | HTTP correctness | **MET** | `app.py:735-740` sets `Retry-After`; `ask_public.py:1079` and `parents.py:1060` do the same | — |
| 5.14 | Nothing retries a destructive operation blindly | Safety | **MET** | `eraseSubjectRows` (`supabase.ts:70-85`) attempts every table once, reports `{erased, failed}` and never claims what did not happen; `SupabaseRest.delete` refuses a filter-less delete (`supabase.ts:141-143`) | — |

---

## 6. The model fallback chain — the owner's empty Anthropic balance is the test case

Routing (`services/gateway/src/wobo_gateway/routing.py:118-142`):

| tier | primary | fallback 1 | fallback 2 |
|---|---|---|---|
| `tiny` | `openai/gpt-5.6-luna` | `anthropic/claude-haiku-4-5` | `gemini/gemini-2.5-flash` |
| `turn` | `anthropic/claude-sonnet-5` | `openai/gpt-5.6-terra` | `gemini/gemini-2.5-flash` |
| `generate` | `openai/gpt-5.6-terra` | `anthropic/claude-opus-5` | `gemini/gemini-2.5-flash` |
| `reason` | `openai/gpt-5.6-sol` | `anthropic/claude-opus-5` | `gemini/gemini-2.5-flash` |
| `verify` | `anthropic/claude-opus-5` | `openai/gpt-5.6-terra` | `gemini/gemini-2.5-flash` |

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 6.1 | No single provider outage or empty balance can leave a learner with no answer | Multi-provider resilience | **MET (in the table)** | `routing.py:126-129` adds `tier.text.last` (Gemini) to **every** text chain, with the reason stated: *"on 2026-09-04 both happened at once and a learner got nothing."* Three providers, three keys, on every text tier. `registry.py:319` asserts every capability's chain equals its tier's chain | — |
| 6.2 | …and it is actually wired into every call | Same | **PARTIAL** | Wired for `generate.course` (`providers.py:222`), `grade.attempt` (`:289`), the generic path (`:465`), `help.answer` (`ask_public.py:986`) and every engine. Passed correctly from `app.py:325` and `wobo.py:1624` | — |
| 6.3 | The main tutoring turn survives a fussy model in its chain | The 2026-09-04 production incident | **NOT MET** | `model_call.py` exists **because** a fallback refused `temperature` and the learner got nothing. It drops the offending knob before the call and retries as a backstop. But `run_wobo_turn` calls **`litellm.completion` directly** (`wobo.py:1182`) with `temperature=0.3` (`:1192`), and `run_board_plan` does the same (`wobo.py:1584`) with `temperature=0.2` (`:1589`). **The one path a child actually talks to is the one path the fix does not cover** | Change both call sites to `from wobo_gateway.model_call import complete as model_complete` — the same one-line change `providers.py:20` already made |
| 6.4 | A verifier rejection escalates one rung rather than failing | The owner's cost rule | **MET** | `routing.py:145-150` `_ESCALATION`, `escalate()` at `:212-228` logs the escalation and its reason on the telemetry logger; `engines.py:1712-1744` retries a refused sim once with the verifier's reason fed back | — |
| 6.5 | Escalation is bounded | Cost control | **MET** | `escalate()` returns `None` at the top of the ladder and logs "declined (top of the ladder)" (`routing.py:222-224`) | — |
| 6.6 | A missing provider key is detected at boot, not at the learner | Fail-fast | **PARTIAL** | `app.py:137` logs `"OPENAI_API_KEY missing: cross-check fallbacks will fail over"` — a **warning in a log nobody watches** (§10). Nothing checks the Anthropic or Gemini key, and nothing surfaces a degraded chain | Add the missing keys to the same check and expose a `/healthz` field naming which providers are reachable |
| 6.7 | A provider's words never reach a learner | Brand + safety law | **MET** | `gateway.ts:29-36` and `refusals.ts:1-8` both enforce it; `providers.py` never puts a provider string in `output`; outbound safety screens every learner-facing capability (`app.py:341-345`) | — |
| 6.8 | The model that actually answered is what gets logged and cached | Honest telemetry | **MET** | `providers.py:80-84` `ProviderResponse.model`; `app.py:349-357` caches and emits `served_model`, not the primary | — |
| 6.9 | Cost per capability is recorded | Cost control | **PARTIAL** | `telemetry.py:69-83` `record_cost` via `litellm.completion_cost`, never raising, called at every live call site. But it only writes a **log line** — `MetricsSink` is `deque(maxlen=1000)` in one process (`telemetry.py:36-46`), explicitly "for dev and tests" | Ship the cost lines somewhere durable before the first real spend month |
| 6.10 | Track 2 (fine-tuned / edge SLMs) cannot route a live learner at a placeholder | Correctness | **MET** | `routing.py:132-140` — the slots are declared, nothing targets them, and the docstring says why: *"a placeholder id is not a model, and routing a live learner at one bought an error and a failover on every call"* | — |
| 6.11 | The chain's real behaviour under an exhausted provider has been exercised | Verification | **NOT VERIFIED** | No test drives a live chain with a dead first provider. `pytest` runs in mock mode only (`providers.py:1-6`) | Add a test that stubs litellm to raise a credit error on the primary and asserts the answer comes from the last hop |

---

## 7. Graceful degradation when the gateway is down entirely

Tested by aborting every request to `api.heywobo.com` with `connectionrefused` against the live site.

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 7.1 | The public site is fully readable with the brain unreachable | Graceful degradation | **MET** | `gwdown.mjs` against `https://heywobo.com` with `api.heywobo.com` aborted: the landing renders its full hero, the drawn-device scene, the pricing band and every section; **zero page errors** | — |
| 7.2 | A board turn falls back to a deterministic plan rather than nothing | Degradation | **MET** | `wobo.py:1626-1631`: *"a provider that fell over never costs the turn — the keyless plan draws instead"* → `mock_board_plan(payload)` | — |
| 7.3 | A model that answers in prose instead of JSON still reaches the learner | Degradation | **MET** | `wobo.py:1205-1210` — an unparseable reply becomes the `say` line verbatim rather than being replaced by the canned line, and still passes the outbound safety screen | — |
| 7.4 | Fidelity degrades on a bad link / Data Saver / reduced motion | India-reality law | **MET (as a decision)** | `shell/resilience.ts:29-35` `decideFidelity` is pure and unit-tested; `useFidelity` subscribes to both `prefers-reduced-motion` and the connection change event (`:96-110`) | See 2.3 — the one place it is *not* consulted is the runtime prefetch |
| 7.5 | The gateway degrades quietly when its runtime content files are absent | Deploy resilience | **MET** | `services/gateway/Dockerfile:29-45` COPYs `concepts.json`, `facts.v1.jsonl`, `festivals.json` and the help corpus, with the comment that all four "degrade quietly when the data is absent"; `services/gateway/tests/test_deploy_config.py` fails if that drifts | — |
| 7.6 | The app renders something rather than nothing if the runtime chunk fails to load | Degradation | **MET** | `PublicSite.tsx:45-52` boundary calls `onFailure` → `App.tsx:110` swaps to the runtime; `main.tsx:106` `setTimeout(dismissBoot, 2500)` guarantees the boot curtain lifts whatever happens | — |
| 7.7 | The learner is not left staring at a busy orb when the gateway hangs | Dead-end rule | **NOT MET** | Follows directly from 5.1: with no client timeout, `setBusy(false)` in the `finally` at `AppRuntime.tsx:817-819` never runs. Proved: the fetch was still pending at 45 s | Fix 5.1 |
| 7.8 | A health probe catches an unhealthy container from both sides | Deploy resilience | **MET** | `railway.json` `healthcheckPath: "/healthz"`, `healthcheckTimeout: 120`, `restartPolicyType: ON_FAILURE`, `restartPolicyMaxRetries: 10`; plus a container-level `HEALTHCHECK` (`services/gateway/Dockerfile:65-66`). Verified live: `curl https://api.heywobo.com/healthz` → `{"status":"ok","mode":"live"}` HTTP 200 in 0.456 s | — |
| 7.9 | `/healthz` reflects readiness, not just liveness | Health-check design | **PARTIAL** | `app.py:799-801` returns `{"status":"ok","mode":…}` unconditionally — it never touches Supabase or a provider key. A gateway that cannot reach the database reports healthy and Railway keeps routing to it | Add a shallow readiness probe (a cheap Supabase call, cached for a few seconds) on a separate path |
| 7.10 | The SSE stream flushes early so the pen can start before the plan is done | The stated design (`board/stream.py:472-474`) | **NOT MET** | The docstring says *"A comment frame goes first so a proxy flushes headers immediately — that is the difference between the pen starting in a second and the pen starting when the whole plan is done."* But `app.py:571` calls `board_plan_for(...)` — the full model call, ceiling **180 s** — **before** `_stream(...)` is reached at `:608`. Starlette does not send headers until the handler returns, so `: open` goes out only once the plan is finished. Zero bytes on the wire for the whole plan latency, which is also an idle-timeout risk on any proxy in front of Railway | Build the `StreamingResponse` first and do the planning inside the generator, so `: open` and a periodic heartbeat go out while the model thinks |

---

## 8. Capacity, concurrency and load — what is unknown, and why

**There is no load test in this repository.** `grep -rlniE "k6|locust|artillery|vegeta|autocannon|wrk"` over
the tree returns no tooling. The register does not fix that; it states what is therefore unknown.
None of the following is a guess dressed as a fact — each is a number the product does not have.

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 8.1 | Known concurrency ceiling per gateway instance | Capacity planning | **NOT VERIFIED** | Structurally bounded and worth stating: **one replica** (`railway.json` `numReplicas: 1`), **one uvicorn process, no `--workers`** (`services/gateway/Dockerfile:78`), and every route is a **sync `def`** (only 3 `async def` in `app.py`, and the capability route at `app.py:890` is sync). FastAPI therefore runs every blocking model call on anyio's threadpool — default **40 threads**. So the ceiling is on the order of 40 concurrent model calls before requests queue behind the pool, each holding up to 180 s. Untested | Run a concurrency ramp against a staging gateway in mock mode to find the real knee, then again in live mode for a cost figure |
| 8.2 | The rate limiter behaves correctly under load and across instances | Rate limiting | **NOT MET (correctness) / NOT VERIFIED (behaviour)** | The code says it: `app.py:638` *"in-memory fixed window, per process — move to Redis when >1 instance runs."* Three consequences. (a) It is a **fixed** window, not sliding: a caller can spend `RATE_LIMIT_PER_MINUTE` (default 60) at 59.9 s and again at 60.1 s — 120 in 200 ms. (b) The `hits` map is pruned only by expiry above 4096 entries (`:660-666`) — correct, and the comment records the earlier bug where a wholesale clear *was* the way past the limit. (c) A second replica doubles every limit. Same story for the budget meter: `budget.py:11-13` *"the store is an in-process dict, so the ceiling is ONE gateway instance — two Railway replicas would each grant a full day's budget"* | Move both to Redis (already the documented upgrade path) before scaling past one replica. Until then, `numReplicas: 1` is a correctness constraint, not a cost choice — that should be written down where someone about to scale will see it |
| 8.3 | Database connection ceiling | Capacity planning | **NOT VERIFIED** | The gateway reaches Supabase over **PostgREST via `urllib.request`** (`auth.py:114`, `memory.py:140`, `curriculum/store.py:945`, …) — no connection pool of its own, so the ceiling is PostgREST's and the project's compute tier, neither of which is recorded anywhere in the repo. The browser also talks to PostgREST directly through the `/db` Vercel rewrite (`vercel.json:8-11`), so learner traffic and gateway traffic share that ceiling | Record the project's tier and its pooler limits in `DEPLOY.md`, then load-test through the rewrite |
| 8.4 | Cost per thousand learners | Unit economics | **NOT VERIFIED** | The inputs exist — per-call cost is computed (`telemetry.py:69-83`) and the free tier is 40 turns + 8 generations/day (`budget.py:73`) with `pro`×5, `max`×20 (`:74`) — but nothing aggregates them, and no live traffic has been priced. `MetricsSink` is an in-process `deque(maxlen=1000)` | Ship the cost log lines to a store and compute a real per-learner-day figure from one week of live traffic |
| 8.5 | The board's first-stroke latency budget is proved | The product's own §10 budget | **PARTIAL** | Real budgets exist and run in CI: `tests/board-latency.spec.ts:27` and `tests/board-latency-throttled.spec.ts:38-40` — `FIRST_STROKE_BUDGET_MS = 1000`, `FIRST_SYLLABLE_BUDGET_MS = 1500`, including a 12-iteration cold-load run over a 1.44 Mbit/s pipe. But `playwright.config.ts:52-64` forces `VITE_LLM_MODE=mock` and `VITE_GATEWAY_URL=` — hermetically. **The budget is proved against a mock plan, never a live model round-trip**, and per 7.10 the live path cannot start drawing until the whole plan is done | Add a staging e2e run against a real gateway and measure the same two onsets there. The gateway already records them (`telemetry.py:24-28` `first_syllable_ms`, `first_stroke_ms`) |
| 8.6 | The board store cannot be filled by one caller | Resource exhaustion | **MET** | `board/stream.py:66-67,109-117` — `_MAX_TURNS = 512` with expiry-first eviction then oldest-first, and `TURN_TTL_S = 180`; turns are owned by the meter key (`:126`) | — |
| 8.7 | Request bodies are bounded | Resource exhaustion | **MET** | `app.py:394` `_MAX_BODY_BYTES` default 256 KB, refused at the door with a Wobo line (`:722-729`) | — |
| 8.8 | One learner cannot run many generations at once | Resource exhaustion | **MET** | `plexus/engines.py` one-generation-at-a-time slot, keyed on the **verified** subject from the door rather than a caller-supplied field (`app.py:346-348`, `providers.py:91-94`); `GenerationBusy` → 429 with `Retry-After` (`app.py:1012-1018`) | — |
| 8.9 | The response cache reduces provider load | Efficiency | **PARTIAL** | `app.py:308-322` serves from `InMemoryCache` per policy `cache_tier`. It is **in-process** (`build_gateway()` at `app.py:373-375`), so it is lost on every deploy and not shared across replicas. Hit rate in production is unmeasured | Move to Redis alongside 8.2, and log the hit rate |
| 8.10 | Autoscaling / capacity headroom | Availability | **NOT MET** | `railway.json` `numReplicas: 1`. One instance, no horizontal scale, and per 8.2 scaling would break the meter and the limiter | Redis first, then replicas |
| 8.11 | Behaviour at the memory ceiling | Availability | **NOT VERIFIED** | The in-process stores are individually bounded (`budget.py:94` `_STORE_MAX = 20_000`, `hits` 4096, `_turns` 512, telemetry 1000) but no container memory limit or observed RSS is recorded anywhere | Record the Railway plan's memory limit and observe RSS under the ramp in 8.1 |

---

## 9. Data durability, backups and restore

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 9.1 | Database backups exist | Data protection baseline | **NOT VERIFIED** | Supabase takes daily backups on paid plans, but **nothing in this repository records the project's plan, its backup schedule, its retention, or whether PITR is on**. The only backup words in the repo are aspirational: `docs/SITE.md:46` ("backups and restore tests") describes what the `/security` page should say, and `docs/WOBO-TASKS.md:622` lists "backup purge with rehearsed restores" as an open task | Check the dashboard for project `keepraxqagzgjrrweryt`, and write the plan, schedule, retention and PITR status into `DEPLOY.md` |
| 9.2 | A restore has been rehearsed | Disaster recovery | **NOT MET** | No runbook, no rehearsal record, no RPO and no RTO anywhere in the tree. `DEPLOY.md:321` mentions "Restore" only in the sense of un-pausing a paused Supabase project, which is a different operation entirely | Write a restore runbook and rehearse it once against a branch database, recording the wall-clock time as the RTO |
| 9.3 | The learner's own data is recoverable if the browser is lost | Product promise | **PARTIAL** | Server-side rows exist and RLS-key to `auth.uid()` (`learner_state`, `learner_threads`, `profiles_cache`, `mastery_cache`), and `hydrate()` merges them on boot. But per 3.8/4.15 the push that puts them there fails silently, and `mastery_cache` currently holds **0 rows** in production (`select count(*) from learner.mastery_cache` → `0`) against 4 rows in `learner_state` — so mastery has never successfully synced for anyone | Fix the silent push failure (4.15) and then re-check the row counts |
| 9.4 | The outbox is drained | Transactional-outbox pattern | **NOT MET** | `learner.outbox` holds **88 rows, all 88 unpublished** (`select count(*) … where published_at is null` → 88). `runRelayOnce` exists (`platform/kgtopg-contract-seed/src/relay.ts:39`) and is unit-tested, but **nothing calls it** — `grep -rn "runRelayOnce"` outside tests returns only its own definition and a comment at `relay.ts:14` saying so. The Supabase performance advisor independently confirms it: `outbox_unpublished_idx` on `learner.outbox` **"has not been used"**. The table grows without bound and no event has ever reached `platform.events` | Schedule the relay (a Railway cron service or a Supabase scheduled function) and add an alert on unpublished row age |
| 9.5 | Erasure actually reaches the server | DPDP / data rights | **MET** | `supabase.ts:44-53` `ERASABLE_TABLES` covers all four learner-owned tables; `eraseSubjectRows` (`:70-85`) attempts each independently and reports `{erased, failed}`; the gateway half returns **502 with an honest message** when a store refused (`app.py:838-849`) — *"Wobo never claims to have forgotten something Wobo did not"* | — |
| 9.6 | Migrations are the source of truth and are ordered | Schema management | **MET** | `infra/supabase/migrations/` with `supabase db push` documented at `DEPLOY.md:326-330` | — |
| 9.7 | The database has no obvious performance debt at scale | Postgres hygiene | **NOT MET** | `mcp__supabase__get_advisors(performance)` on the live project, observed 2026-09-04T09:59:28Z, returns **20 `auth_rls_initplan` WARNs** — every learner and curriculum RLS policy calls `auth.<function>()` **per row** instead of `(select auth.<function>())`: `learner.learner_state`, `learner_threads`, `mastery_cache`, `attempts`, `sessions`, `outbox`, `notifications`, `meter_state`, `canvas_state`, `profiles_cache`, `mail_preferences` (×3), `parent_links` (×3), `curriculum.frameworks`, `overlays`, `pins`, `discovery_jobs`. Plus **6 unindexed foreign keys** (`curriculum.discovery_jobs.framework_id`, `nodes.parent_id`, `overlays.version_id`, `pins.framework_id`, `review_queue.node_id`, `review_queue.version_id`). Harmless at 4 rows; quadratic at scale | One migration wrapping every `auth.uid()` in `(select …)`, and six `create index` statements |
| 9.8 | Idempotent writes | Data integrity | **MET** | `outbox_append_batch` dedupes on `event_id` (`infra/supabase/migrations/0005_...sql:4`); every `upsert` names an explicit conflict target (`state.ts:417`, `mastery.ts:258`) | — |
| 9.9 | Schema drift degrades rather than breaks | Deploy resilience | **MET** | `state.ts:412-419` (missing streak columns) and `mastery.ts:267-279` (missing evidence column) both detect the specific error, remember it, and fall back to the older row shape — so a gateway newer than the database keeps a learner working | — |

---

## 10. Observability — knowing a failure happened

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 10.1 | Crash / error reporting exists | Reliability baseline | **NOT MET** | `grep -rniE "sentry\|datadog\|newrelic\|opentelemetry\|prometheus\|grafana\|pagerduty"` over `apps packages services` → matches only in prose (`CONTEXT.md:157` listing an intended stack, `docs/06-TOOLING/01-api-keys-and-env.md:16` calling `SENTRY_DSN` optional) and in `docs/PLATFORMS.md:605` / `docs/WOBO-TASKS.md:583`, both of which list **"Monitoring — error tracking, budget dashboards, uptime, cost per learner"** as an **open, unchecked task**. There is no error reporting in the product | Ship one. Until then nobody learns that a learner's screen crashed |
| 10.2 | The `/security` page's reliability claim is true | **Honesty — the owner has already been burned by this class of claim** | **NOT MET** | `apps/web-pwa/src/screens/pitch/Security.tsx:203-206` lists a sub-processor: `{ role: 'Reliability', line: 'Crash reports and uptime checks. No advertising identifiers.', region: 'US' }`. **There is no crash reporter and no uptime check in this product** (10.1, 10.3). This is a public page telling parents about a control that does not exist — the same failure mode as the SOC 2 / ISO 27001 / penetration-test claims already caught | Either ship crash reporting and an uptime check, or delete that row from the sub-processor list today. Do not leave it up |
| 10.3 | Uptime monitoring / alerting | Availability | **NOT MET** | The only health checking is Railway's own restart loop (`railway.json`) and the container `HEALTHCHECK`. Nothing external watches `heywobo.com` or `api.heywobo.com`, and nothing pages anyone | Point any external uptime checker at `/healthz` and the site root |
| 10.4 | A performance regression is caught before it ships | Performance budget | **NOT MET** | CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit, two Playwright suites and three brand gates — and asserts nothing about LCP, CLS, bundle size or transfer size. The board latency budgets (8.5) are the only perf assertions and they are mock-only | Add a Lighthouse-CI or a scripted CWV check on `/` and `/security` with the thresholds in §1, and a bundle-size gate (2.8) |
| 10.5 | The gateway emits structured, greppable request and telemetry lines | Observability baseline | **MET** | `app.py:747-760` — one JSON line per request with method, path, status, salted `ip_hash`, subject and `duration_ms`, excluding `/healthz` so probes do not drown the log; `telemetry.py:48-56` emits capability/track/model/latency/tokens/cache-hit under the same `fields` key | — |
| 10.6 | Those lines reach somewhere durable | Observability | **NOT MET** | They go to stdout and live only in Railway's log retention. `MetricsSink` is explicitly *"an in-memory metrics sink for dev and tests; a real metrics exporter … replaces the sink later"* (`telemetry.py:4-6`) | Ship logs to a store with a retention you have chosen on purpose |
| 10.7 | Cost anomalies are visible | Cost control | **NOT MET** | `record_cost` never raises and writes a log line (`telemetry.py:69-83`); escalations are logged on the same stream (`routing.py:224-227`). Nothing aggregates or alerts. Given §6's three-provider chain, a primary silently failing over to a pricier model is invisible | A daily aggregate of the cost lines, with a threshold |
| 10.8 | The two board onsets are measured in production | The product's own §10 budget | **PARTIAL** | The fields exist and are filled by the board's own measurement (`telemetry.py:24-28`, `board.stream.record_onsets`), so the data is emitted. It is not collected anywhere (10.6) | Same fix as 10.6 |
| 10.9 | Interactive API docs are closed in production | Attack surface | **MET** | `app.py:614-622` — `docs_url`/`redoc_url`/`openapi_url` are `None` unless `ENV != prod` | — |

---

## 11. Items considered and marked N/A

| # | Item | Standard | Status | Why |
|---|---|---|---|---|
| 11.1 | Multi-region active-active failover | HA architecture | **N/A today** | One product, one market, one replica, pre-launch. It becomes real the day an outage costs revenue; recording it so the decision is deliberate rather than forgotten |
| 11.2 | Blue/green or canary deploys | Deployment safety | **N/A today** | Vercel gives instant rollback on the web side; the gateway is one Railway service with `restartPolicyType: ON_FAILURE`. With zero users the blast radius is zero. Revisit before launch |
| 11.3 | CDN cache purge strategy | Content delivery | **N/A** | Every asset is content-hashed and immutable; HTML and the SW are `max-age=0, must-revalidate` (`vercel.json:56-89`, verified on prod). A deploy is the purge |
| 11.4 | Database read replicas / query routing | Scale | **N/A today** | 4 rows in `learner_state`, 0 in `mastery_cache`. Item 9.7 is the real database work |
| 11.5 | Queue/broker durability (Kafka, SQS, …) | Async architecture | **N/A** | There is no broker. The transactional outbox in Postgres is the async seam, and its real gap is 9.4 — that it is never drained |
| 11.6 | Server-side rendering / streaming HTML for LCP | Performance | **N/A** | A pure SPA on a CDN with a 79 ms TTFB and a 2.1 s LCP; SSR would be a large change for a page that is already inside budget once §1.4 and §1.6 are fixed |
| 11.7 | Native app crash/ANR rates | Mobile reliability | **N/A today** | Web PWA only. `docs/PLATFORMS.md` plans native targets; this register covers the web product |
| 11.8 | Chaos engineering / fault injection | Advanced resilience | **N/A today** | Premature before a load test (§8) and before monitoring (§10) exist. The one-off fault injection in this pass (`hang.mjs`, `gwdown.mjs`) found two real gaps and is the cheap version worth keeping |

---

## Summary of counts

123 numbered items. The twelve rows in §4's call-site table are counted as items in their own
right, because each one is a real network call with a real verdict about what a learner sees.

| Status | Count |
|---|---|
| MET | 51 |
| PARTIAL | 24 |
| NOT MET | 29 |
| N/A | 8 |
| NOT VERIFIED | 11 |
| **Total** | **123** |

Reproduce this tally:

```sh
python3 - <<'EOF'
import re, collections
c = collections.Counter()
for line in open('docs/conformance/reliability-and-performance.md'):
    if not re.match(r'^\|\s*\d+\.\d+\s*\|', line): continue
    cells = [x.strip().replace('**','') for x in line.strip().strip('|').split('|')]
    if len(cells) < 4: continue
    c[cells[3].split()[0] + (' ' + cells[3].split()[1] if cells[3].startswith(('NOT',)) else '')] += 1
print(c)
EOF
```

## The gaps that would actually hurt, in order

1. **`Security.tsx:203-206` tells parents Wobo has crash reporting and uptime checks. It has neither.**
   Same class as the SOC 2 claim already caught. Delete the row or ship the control — today.
2. **No client-side timeout on any gateway call** (`gateway.ts:127`), proved to hang past 45 s. A
   stalled brain leaves a child watching a busy orb with no sentence and no way out.
3. **The main tutoring turn bypasses the fix written for the outage that broke it.** `wobo.py:1182`
   and `:1584` call `litellm.completion` directly with a `temperature` — the exact knob that took
   the product down on 2026-09-04 — while `model_call.complete` protects every other path.
4. **Everything that saves a learner's work fails silently** (`state.ts:443`, `mastery.ts:303`,
   `events.ts:149`, `client.ts:293,308`), under a boot loader whose last word is "Your place is saved".
   `mastery_cache` has 0 rows in production.
5. **The outbox has never been drained** — 88 rows, 88 unpublished, `runRelayOnce` called by nothing.
6. **Offline loses more than it says it does**: no font is precached, the queued-question list is
   React state, and offline-recorded events die with the tab.
7. **One replica is a correctness constraint, not a cost choice** — the budget meter and the rate
   limiter are both per-process dicts. Nothing in the deploy config says so where someone scaling
   would see it.
8. **No load test, so no known concurrency ceiling, no database connection ceiling, and no cost per
   thousand learners.** The structural ceiling looks like ~40 concurrent model calls (one sync
   uvicorn process, anyio's default threadpool), but that is inference, not measurement.
