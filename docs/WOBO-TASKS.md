# Wobo — task list

Companion to `docs/WOBO-PLAN.md`. Every task is a checkbox; checked off with the commit that closed it. Waves 1 to 4 come from the 2026-09-02 audit (246 findings; the report is kept outside the repo); waves 5 to 9 are the product. Nothing starts on ambiguity between waves; each wave ends with all gates green, a commit, a push, screenshot proof, and an update to this file.

Legend: **owner** = only the owner can do it · **design** = Fable's own hand · **gate** = must pass before the wave closes.

## Wave 0 — Land and unblock

- [x] Rebrand Classess Learner and Vidya to Wobo across app, gateway, contracts, docs — `09a2bf4`
- [x] First-meeting introduction (owner copy), written in Wobo's hand and spoken once — `09a2bf4`
- [x] Brand assets: inline wordmark, favicon, PWA icons, video watermark — `09a2bf4`
- [x] Plan and task list committed
- [x] **owner** Restore Supabase project `keepraxqagzgjrrweryt` — restored 2026-09-02; hostname resolves; auth answers
- [x] Database follows the rebrand — migration `0006`: `last_seen_by_wobo_at`, thread default `wobo`, `profiles_cache.birthdate` / `interests` / `plan` — applied 2026-09-02
- [ ] Sync `birthdate` and `interests` to `profiles_cache` now that the columns exist (the onboarding keeps them local today) — folds into Wave 3
- [ ] **owner** Buy the Wobo domain; until then the default Vercel URL is the address; config stays brand-neutral
- [ ] **owner** Precautionary rotation of provider keys before launch (Anthropic, OpenAI, Google AI, Resend, Supabase service role, Railway)
- [ ] **owner** Real prices when ready; dummy values until then
- [ ] **owner** A launch date or event, if one exists

<!-- AUDIT-SECTION-START -->

<!-- Derived from audit-findings.json (246 verified findings). All paths and identifiers
     rewritten for the Wobo rebrand (src/vidya/ -> src/wobo/, packages/vidya -> packages/wobo,
     classess_gateway/vidya.py -> wobo.py, vidya.turn -> wobo.turn, VIDYA_SYSTEM -> WOBO_SYSTEM).
     Every location was verified to exist. Two corrections to the audit's own paths:
       - engines/BlockAssembly.tsx is actually engines/cs/BlockAssembly.tsx
       - wave14-shots/ does not exist (that finding is itself about the nonexistent path)
     Three locations are git-tracked but already deleted in the working tree by remediation
     running concurrently with this write: apps/web-pwa/vercel.json, render.yaml,
     services/gateway/fly.toml. -->

## Wave 1 — Lock the brain (security boundary)

37 tasks · 36 done · 0 open · 1 deferred · 0 superseded (rebuilt in later waves)

### Gateway auth, spend and rate limiting
- [x] **Authenticate the gateway HTTP surface** — `services/gateway/src/classess_gateway/app.py:375` · critical · CONFIRMED — Verify a Supabase `Authorization: Bearer` JWT inside the existing `_guard_and_log` middleware over the spend-bearing path set it already computes, returning 401 before `call_next` while leaving `/healthz` open. (reported twice) — 0466342
- [x] **Stop accepting client-supplied `messages` in capability payloads** — `services/gateway/src/classess_gateway/providers.py:280` · critical · CONFIRMED — Delete the `messages` branch, build the prompt only from `payload["input"]` plus a gateway-owned system prompt, and add a per-capability `max_tokens` ceiling. — 0466342
- [ ] **Derive consent tier server-side instead of trusting the client** — `services/gateway/src/classess_gateway/app.py:117` · critical · CONFIRMED — Drop `consent_tier` from `CapabilityRequest` and have `Gateway.invoke` evaluate `pol.allows(ConsentTier.UN_ELEVATED)`, gating elevated-only capabilities behind the internal shared key until a server-side consent record exists. (reported twice) — deferred: consent_tier field removal after one release
- [x] **Key the rate limiter on the real client, not the platform proxy** — `services/gateway/src/classess_gateway/app.py:318` · high · CONFIRMED — Resolve the bucket key from the trusted forwarded chain (set `FORWARDED_ALLOW_IPS` behind the platform edge) instead of `request.client.host`, so every learner is not bucketed behind one proxy IP. (reported twice) — 0466342
- [x] **Prune the rate-limit map by expiry instead of clearing it** — `services/gateway/src/classess_gateway/app.py:326` · medium · UNVERIFIED — Replace the wholesale `hits.clear()` at the size cap with `{k: v for k, v in hits.items() if k[1] >= window}` so growing the map cannot reset every caller’s counter. — sweep
- [x] **Drop the Vercel preview-origin CORS regex under `ENV=prod`** — `services/gateway/src/classess_gateway/app.py:292` · medium · UNVERIFIED — Pass `allow_origin_regex` only when `ENV` is not `prod`, so the production trust boundary is exactly the single origin `_cors_origins()` returns. — sweep
- [x] **Key the generation queue on the authenticated subject** — `services/gateway/src/classess_gateway/plexus/engines.py:1958` · medium · UNVERIFIED — Derive the per-user slot key from the Supabase JWT subject rather than `payload["user"]`, keeping the per-IP limiter as the anonymous fallback. — 0466342
- [x] **Trim or gate the `/v1/capabilities` disclosure** — `services/gateway/src/classess_gateway/app.py:371` · low · UNVERIFIED — Put the route behind the same auth dependency as the capability invokes, or reduce `PolicyView` to capability name and `elevated_only` and drop provider_model, cost_ceiling and the fallback chain. — 0466342

### LLM call bounds and resource limits
- [x] **Put a timeout on every live LLM call and enforce the registry ceilings** — `services/gateway/src/classess_gateway/wobo.py:990` · high · CONFIRMED — Add a keyword-only `timeout_s` to the Provider protocol (defaulted so MockProvider and existing tests keep working) and thread the registry’s `max_latency_ms`/`cost_ceiling` through every live call. — 0466342
- [x] **Bound the gateway in-memory artifact cache** — `services/gateway/src/classess_gateway/cache.py:45` · high · CONFIRMED — Back `InMemoryCache._store` with an `OrderedDict`, `move_to_end` on hit and evict at a capacity ceiling, so base64 video narration is not retained for the life of the process. — 0466342
- [x] **Stop re-arming post-serve validation on every provisional cache hit** — `services/gateway/src/classess_gateway/plexus/engines.py:1952` · high · CONFIRMED — Track in-flight validations in a `_validating` set beside `_gen_lock` so a cached provisional artifact spawns one validation thread instead of one per request. — 0466342
- [x] **Bound the telemetry MetricsSink** — `services/gateway/src/classess_gateway/telemetry.py:26` · medium · UNVERIFIED — Make `MetricsSink.events` a `deque(maxlen=1000)` so dev/test inspection survives while production stops accumulating every event forever. — sweep

### Prompt injection and content trust
- [x] **Bind cache keys to the full normalized concept to stop shared-cache poisoning** — `services/gateway/src/classess_gateway/plexus/engines.py:1738` · high · CONFIRMED — Compute the artifact digest from the full normalized concept rather than the truncated slug, so an unauthenticated caller cannot collide keys and seed content every child then reads. — 0466342
- [x] **Fence the client-supplied region of the Wobo prompt** — `services/gateway/src/classess_gateway/wobo.py:930` · medium · UNVERIFIED — Wrap the client-derived block in explicit delimiters in `_build_user_prompt`, add one line to `WOBO_SYSTEM` declaring that region data and never instructions, and strip newlines from the injected dossier/machine-room fields. — sweep
- [x] **Treat remembered learner facts as data, not instructions** — `apps/web-pwa/src/store/mind.ts:93` · medium · UNVERIFIED — Emit dossier facts as a JSON array in `_dossier`, state in `WOBO_SYSTEM` that they are recorded details rather than instructions, and run the inbound safety classifier over `lifetime.facts`. — sweep
- [x] **Screen every free-text field the prompt builder actually reads** — `services/gateway/src/classess_gateway/safety.py:147` · medium · UNVERIFIED — Make `inbound_text` walk the same keys `_build_user_prompt` consumes (canvas.equation, canvas.steps[], targets[].label, page.state, lifetime.facts[], turn.*) instead of enumerating two by hand. — sweep
- [x] **Run inbound child-safety screening on every learner-facing capability** — `services/gateway/src/classess_gateway/app.py:198` · medium · UNVERIFIED — Move the screen out of the `capability == "wobo.turn"` special case to the top of `Gateway.invoke` for the learner-facing set, and run the outbound screen on their text output too. — sweep
- [x] **Screen model-authored action text on the way out** — `services/gateway/src/classess_gateway/safety.py:173` · medium · UNVERIFIED — Have `screen_wobo_outbound` classify `say` plus every text field in `output["actions"]` and the viz caption, dropping the actions on a flag exactly as it already does. — sweep
- [x] **Implement the image-generation moderation stub** — `services/gateway/src/classess_gateway/plexus/image.py:66` · medium · UNVERIFIED — Call `classess_gateway.safety.moderate(concept)` inside `_moderation_ok` and return False on any flagged verdict, instead of a one-line stub that always returns True. — sweep
- [x] **Bring the server SVG sanitizer to parity with the client’s** — `services/gateway/src/classess_gateway/plexus/sanitize.py:40` · medium · UNVERIFIED — Add `set` to the removed-element pass, drop `animate*` elements whose `attributeName` contains href, and apply `_href_allowed` to `src`/`xlink:href` and to animation `to`/`values`/`from`. — sweep

### Voice relay and microphone
- [x] **Gate `/v1/voice/tts/stream` with a session token and the concurrency cap** — `services/gateway/src/classess_gateway/voice.py:189` · high · CONFIRMED — Require `_consume_token(query_params["token"])` and the `_MAX_CONCURRENT_RELAYS` check before accept, and have `speakStream` fetch `/v1/voice/session` and append `?token=` the way `voice.ts` already does. (reported twice) — 0466342
- [x] **Validate relay frames before forwarding them to Gemini Live** — `services/gateway/src/classess_gateway/voice.py:74` · high · CONFIRMED — In `pump_up`, parse each inbound frame and forward only dicts whose keys are a subset of `{realtimeInput, clientContent, toolResponse}`, dropping anything carrying a `setup` key. — sweep
- [x] **Close the mic when push-to-talk is released before the session connects** — `apps/web-pwa/src/wobo/Companion.tsx:226` · high · CONFIRMED — Add an epoch ref in `voice.ts` and tear the stream down when the epoch moves, so releasing the orb mid-connect stops the track instead of leaving it streaming indefinitely. — 0466342
- [x] **Cap voice relay concurrency per subject rather than globally** — `services/gateway/src/classess_gateway/voice.py:53` · medium · UNVERIFIED — Replace the single global counter with a per-subject dict plus a much higher instance-wide ceiling, so four anonymous sockets cannot take the voice offline for every learner. — 0466342

### Code execution sandboxes
- [x] **Kill the SymPy eval namespace in the CAS verifier** — `services/verifier/src/classess_verifier/cas.py:41` · critical · CONFIRMED — Build `_NS` from sympy’s public names with `__builtins__ = {}` and pass `global_dict=_NS` to `parse_expr`, rather than relying on a character allowlist that is bypassable via `eval(chr(..))`. (reported twice) — 0466342
- [x] **Isolate Pyodide from the page origin** — `apps/web-pwa/src/engines/cs/pyodide.ts:143` · medium · UNVERIFIED — Run Pyodide in a Web Worker (or at minimum pass `jsglobals: new Map()` and strip the `js`/`pyodide_js` modules) so executed Python has no DOM, cookies, localStorage or same-origin fetch. (reported twice) — sweep

### Path handling and output injection
- [x] **Sanitize `difficulty` before it reaches the cache filename** — `services/gateway/src/classess_gateway/plexus/store.py:122` · high · CONFIRMED — Slug `difficulty` inside `artifact_path` before computing the body/digest so every caller is covered and client input can no longer traverse to an arbitrary file write. — 0466342
- [x] **Validate and sanitize RDKit SVG before `dangerouslySetInnerHTML`** — `apps/web-pwa/src/engines/ChemScene.tsx:1081` · medium · UNVERIFIED — Port the gateway’s `valid_smiles` charset/length check into `parseChemScene` and adopt only the parsed `<svg>` root from `DOMParser` instead of injecting the renderer’s raw string. — sweep
- [x] **Escape and scheme-check CTA URLs in email templates** — `services/gateway/src/classess_gateway/email_templates.py:61` · medium · UNVERIFIED — Escape `url` in `_button` after rejecting anything that is not `https://`, and apply the same to the raw link/cta_url uses in the plain-text bodies. — sweep
- [x] **Restrict `/v1/email/send` recipients and CTA hosts** — `services/gateway/src/classess_gateway/email.py:108` · medium · UNVERIFIED — Allowlist the CTA host at the `_button` choke point and restrict `to` to addresses associated with the subject the email is about, so the internal key stops being a phishing primitive. — sweep
- [x] **Drop `<style>` elements from generated SVG entirely** — `apps/web-pwa/src/engines/DiagramView.tsx:42` · low · UNVERIFIED — Remove every `<style>` element in `sanitizeSvgElement` instead of blocklisting the `url(` token, which currently lets `@import` through. — sweep
- [x] **Encode PostgREST filter values** — `packages/sdk/src/state.ts:339` · low · UNVERIFIED — Have `SupabaseRest.selectOne` take structured filters run through `URLSearchParams` instead of a pre-built query string, so every caller is encoded where the URL is assembled. — sweep

### Learner privacy (minor data)
- [x] **Scope the tutor transcript archive per account and clear it on sign-out** — `apps/web-pwa/src/wobo/chat.tsx:43` · high · CONFIRMED — Add a module-level archive scope in `chat.tsx` and key `clss-wobo-archive-v1` by subject id via an `archiveKey()` helper used by `readArchive`/`writeArchive`, matching the scoping the SDK already applies. — 0466342
- [x] **Add a server-side erasure path for a minor’s data** — `apps/web-pwa/src/screens/You.tsx:921` · medium · UNVERIFIED — Add a `delete(table, query)` verb to `SupabaseRest` and have `startOver` (plus a dedicated delete-my-data control) issue DELETEs against `learner_state`, `learner_threads` and `profiles_cache` for the current subject before clearing localStorage. — sweep
- [x] **Stop logging recipient email addresses** — `services/gateway/src/classess_gateway/email.py:50` · low · UNVERIFIED — Log a `to_hash` (sha256 prefix) instead of the address in all four `send_email` log calls. — sweep
- [x] **Stop retaining raw client IPs for minors** — `services/gateway/src/classess_gateway/app.py:347` · low · UNVERIFIED — Log a salted `blake2b` hash of the IP at the single emission point instead of the address itself. — sweep
- [x] **Stop putting the child’s real name in invite links** — `apps/web-pwa/src/screens/You.tsx:823` · low · UNVERIFIED — Use the opaque subject id or a short random referral code as the `via` parameter so the minor’s name stops travelling in shared URLs. — sweep

## Wave 2 — Production config, deploy truth, CI

29 tasks · 28 done · 1 open · 0 deferred · 0 superseded (rebuilt in later waves)

### CSP and web deploy config
- [x] **Fix the production CSP so the engines actually run** — `vercel.json:19` · high · CONFIRMED — In the root `vercel.json` CSP add `'wasm-unsafe-eval'` and `https://cdn.jsdelivr.net` to `script-src` (and jsdelivr to `connect-src`) and `data:` to `media-src`, which unblocks RDKit, Pyodide and every generated video/narration clip in production. (reported five times) — 63017a4
- [x] **Collapse the two conflicting `vercel.json` files to one** — `apps/web-pwa/vercel.json:1` · medium · CONFIRMED — Delete `apps/web-pwa/vercel.json` and keep the root file as the single deploy contract, since only one is ever read and only the root one carries the security headers. (reported three times) — 63017a4
- [x] **Exclude `.env*` from the Railway and Vercel upload contexts** — `.railwayignore:1` · medium · UNVERIFIED — Add `.env*` with a `!.env.example` negation to `.railwayignore` and `.vercelignore`, mirroring `.dockerignore` — on Vercel an uploaded `.env.local` is inlined into the public bundle by Vite. — 63017a4
- [x] **Ship theme-aware `theme-color` meta tags** — `apps/web-pwa/index.html:6` · low · UNVERIFIED — Emit media-scoped light/dark `theme-color` tags matching `chrome.page` and `--clss-page`, and update them from `paint()` when the learner picks an explicit theme. — sweep

### Environment and secrets
- [x] **Close the production fail-open on dev auth and persist mode** — `DEPLOY.md:7` · high · CONFIRMED — `apps/web-pwa/.env.production` is gitignored though DEPLOY.md calls it committed — default `DEV_AUTH` to `import.meta.env.DEV` and `PERSIST_MODE` to `live` outside dev so a missing file cannot fall back to dev-mock auth. — 63017a4
- [x] **Rewrite `.env.example` from the variables the code actually reads** — `.env.example:5` · medium · UNVERIFIED — Drop the twelve unread vars, add the nine gateway vars that are read but undocumented, and add a first-class `VITE_*` section for the six the web app requires. (reported twice) — 63017a4
- [x] **Fix the `.gitignore` ordering that defeats `!.env.example`** — `.gitignore:53` · medium · UNVERIFIED — Delete the appended `.env*` line that overrides the negation — lines 2-3 already cover every secret file, so the negation then works as written. — 63017a4
- [x] **Commit the real Vercel env procedure and reference it from DEPLOY.md** — `scripts/set-vercel-env.sh:9` · medium · UNVERIFIED — Commit `scripts/set-vercel-env.sh` with the anon key read from an argument or `vercel env pull` rather than hardcoded, add `VITE_GATEWAY_URL` to the set it writes, and link it from DEPLOY.md §1. — sweep

### Deploy targets and the gateway image
- [x] **Reconcile DEPLOY.md with the live Railway deploy** — `DEPLOY.md:67` · medium · CONFIRMED — Add a `railway.json` pinning the live build (builder, dockerfile, start command, healthcheck) and document the real `ENV=prod`/`LLM_MODE=live` values, so the host that actually serves traffic has config in the repo. — 63017a4
- [x] **Ship `content/catalogs` and `content/factbase` in the gateway image** — `services/gateway/Dockerfile:12` · medium · CONFIRMED — Drop `content/catalogs` from `.dockerignore`/`.railwayignore` (keeping `content/cache` excluded) and COPY both into the image, so the correctness fact-check gate stops silently no-opping in production. — sweep
- [x] **Declare `aiohttp` as a gateway dependency** — `services/gateway/pyproject.toml:6` · medium · UNVERIFIED — Add `aiohttp>=3.9` to `services/gateway/pyproject.toml` dependencies so the live voice path’s import is pinned deliberately rather than by accident. — sweep
- [x] **Retire or mark the stale `fly.toml` manifest** — `services/gateway/fly.toml:17` · low · UNVERIFIED — Keep exactly one manifest for the host actually in use and delete or explicitly mark this one inactive; it currently pins `LLM_MODE=mock` while prod runs live. — 63017a4
- [x] **Retire or mark the stale `render.yaml` blueprint** — `render.yaml:2` · low · UNVERIFIED — Keep one blueprint for the host actually in use and move the alternatives under a clearly marked docs path, so exactly one file describes where the gateway runs. — 63017a4

### CI and test wiring
- [x] **Give `apps/web-pwa` a `test` script so its unit tests run** — `apps/web-pwa/package.json:11` · high · CONFIRMED — Add `"test": "bun test .test.ts"` to `apps/web-pwa/package.json` — the path filter matters, since a bare `bun test` also collects the Playwright `*.spec.ts` suites and breaks CI. (reported three times) — 63017a4
- [x] **Fix the E2E profile-button locator that can never match** — `apps/web-pwa/tests/journey.spec.ts:183` · high · CONFIRMED — Add a shared `profileButton(page)` helper to `apps/web-pwa/tests/helpers.ts` matching the rendered accessible name, and use it from both specs. — 56f06de
- [x] **Make CI cover the active branch, the build and the E2E suite** — `.github/workflows/ci.yml:5` · medium · UNVERIFIED — Change the push trigger to all branches (or add `the-life`), add `bun run build`, and add a Playwright step that installs chromium and runs the committed e2e suite. (reported twice) — 63017a4, 56f06de
- [x] **Rewrite the onboarding E2E test against the shipped flow** — `apps/web-pwa/tests/journey.spec.ts:33` · medium · CONFIRMED — Rewrite journey.spec.ts test 1 against the beats that actually ship, and do not copy `test/x-browser.spec.ts`, which asserts a deleted `getByLabel('your name')` field. — 56f06de
- [x] **Include test sources in the web-pwa typecheck** — `apps/web-pwa/tsconfig.json:9` · medium · UNVERIFIED — Add `tests`/`test` to `include`, drop the `src/**/*.test.ts` exclude, and add `@playwright/test` to `compilerOptions.types` so the one command CI runs covers the test sources. — sweep
- [x] **Give the cross-browser Playwright suite a runnable script and a gitignored output path** — `apps/web-pwa/test/x-browser.config.ts:14` · medium · UNVERIFIED — Add `"test:xbrowser": "playwright test -c test/x-browser.config.ts"` to `apps/web-pwa/package.json` and point `SHOT_ROOT` at a gitignored directory instead of committing 84 MB of output. (reported twice) — already-fixed: `apps/web-pwa/package.json` already carried `test:x-browser`, and `xbrowser/` was already gitignored (`git ls-files | grep -c '^xbrowser/'` = 0 — the 84 MB was never tracked). The sweep only repointed the script at the suite's new home under `tests/`.
- [x] **Run the render-worker test suite from CI** — `services/render-worker/package.json:9` · medium · UNVERIFIED — Add a CI step (or root script) that runs `bun test` inside `services/render-worker`; the package already has its own node_modules and only needs to be invoked. — 63017a4
- [x] **Bring `services/render-worker` into the workspace, lint and test paths** — `pyproject.toml:20` · medium · UNVERIFIED — Add `services/render-worker` to the root `package.json` workspaces (and the ruff/pyproject paths) so its seven source files stop having zero CI coverage. — sweep
- [x] **Add tests for the streaming voice endpoint and its token/concurrency gate** — `services/gateway/tests/test_gateway.py:301` · medium · UNVERIFIED — Add `tests/test_voice.py` covering mint/consume/expiry directly plus the two websocket gates via `TestClient.websocket_connect`, asserting a 1008 close with no token and once the relay cap is saturated. — sweep
- [x] **Pin the safety-screen boundary for the non-`wobo.turn` model paths** — `services/gateway/tests/test_safety.py:92` · medium · UNVERIFIED — Add a `test_safety.py` case invoking `tutor.turn` with the crisis text that asserts the intended behaviour explicitly, so the boundary is stated rather than assumed. — sweep
- [x] **Add the contracts-bundle drift test the codegen already claims** — `packages/contracts/codegen/emit-schemas.ts:9` · medium · UNVERIFIED — Add a drift test in `packages/contracts/test/` modelled on `plexus.codegen.test.ts` that rebuilds the bundle and asserts it string-equals both committed files. — sweep

### Contracts, codegen and lint config
- [x] **Add the seven missing activity fields to the generated card contract** — `services/gateway/src/classess_gateway/plexus/specs.py:136` · medium · UNVERIFIED — Add the seven `dict[str, Any] | None` fields to `Card` in `specs.py` and regenerate, and either set `extra="forbid"` on `Spec` or delete the claim from its docstring. — sweep
- [x] **Make ISO-timestamp validation survive the TS → JSON Schema crossing** — `packages/contracts/src/primitives.ts:17` · medium · UNVERIFIED — Replace the `.refine()` in `primitives.ts` with `z.string().regex(ISO_8601_RE)` so `z.toJSONSchema` emits the pattern and the Python mirror enforces the same rule. — sweep
- [ ] **Fix the unknown `preset` key in the Biome lint config** — `biome.json:29` · medium · UNVERIFIED — Change the rules key to `"recommended": true` and verify with `bunx biome check --diagnostic-level=info .` that no configuration diagnostic is emitted. — skipped: the finding is inverted. On the pinned Biome 2.5.1, `preset` is the CURRENT key and `recommended` is the DEPRECATED one — applying the prescribed change makes `bunx biome check --diagnostic-level=info biome.json` emit `DEPRECATED — The use of the recommended field has been deprecated … Use preset instead`, while the committed config emits nothing and lints identically. Change applied, deprecation observed, reverted (`git diff biome.json` empty). Direction pinned by `test_deploy_config.py::test_biome_linter_uses_the_current_config_key` so it is not swapped twice.
- [x] **Correct the JSON Schema dialect in the emitted contract bundle** — `packages/contracts/codegen/emit-schemas.ts:21` · low · UNVERIFIED — Change the top-level literal to `https://json-schema.org/draft/2020-12/schema` so the bundle header matches what Zod actually emits, and regenerate both bundles. — sweep
- [x] **Delete the drifted Wobo model constants and use the resolved policy** — `services/gateway/src/classess_gateway/wobo.py:39` · low · UNVERIFIED — Remove `WOBO_PRIMARY`/`WOBO_ESCALATE` and the `startswith("classess/")` branch, always using the `provider_model` and fallbacks the registry resolved. — sweep

## Wave 3 — Main-flow bugs and data scoping

62 tasks · 33 done · 29 open · 2 deferred — re-read against the code at `f84e7bb` on 2026-09-04. The 36 lines struck through as "superseded: rebuilt in Wave 5/7" were checked one at a time against the file each names: 9 defects are genuinely gone and are now ticked, and 27 are NOT superseded — the engines under `apps/web-pwa/src/engines/` were never rebuilt, so those findings are still live and each now says where.

### Shell, router and app state
- [x] **Stop the forge build runner cancelling itself in its own effect cleanup** — `apps/web-pwa/src/store/DownloadCenter.tsx:125` · high · CONFIRMED — Delete the cleanup (and the now-unused `timer` binding) so the effect owns `forgeRunning.current` for the life of the async work, matching the course runner above it — otherwise any forge-store mutation inside the 1600 ms window strands every workbook at "building". — 56f06de
- [x] **Wire the router to the History API** — `apps/web-pwa/src/shell/router.tsx:45` · high · CONFIRMED — Add `routeToPath`/`pathToRoute` next to the Route union and drive `RouterProvider` from `history.pushState`/`popstate`, leaving all 48 call sites untouched, so the Android back button works and routes become addressable. — 56f06de
- [x] **Mint chat turn ids independently of archive length** — `apps/web-pwa/src/App.tsx:283` · medium · UNVERIFIED — Use `crypto.randomUUID()` at the single mint site so ids stop colliding once the archive hits its 2000-turn cap. — 56f06de
- [x] **Move persistence out of the `setState` updater in the progress store** — `apps/web-pwa/src/store/progress.tsx:327` · medium · UNVERIFIED — Keep the updater pure and move `persist`/`sdk.state.save` into a `useEffect` keyed on state — one effect covers all five call sites. — 56f06de
- [x] **Confirm before `forget` wipes the whole memory** — `apps/web-pwa/src/App.tsx:424` · medium · UNVERIFIED — Render a client-side confirm affordance in the thread on `scope === "all"` and only call `clearMind()` after it is accepted. — 56f06de

### Account scoping and persistence
- [x] **Scope the local-mode state cache per account** — `packages/sdk/src/client.ts:139` · high · CONFIRMED — Pass the signed-in subject id into `LocalStateProvider` so a second learner on the same device cannot read the first’s progress and tutor transcript. — 56f06de
- [x] **Re-arm the outbox timer after a failed flush** — `packages/sdk/src/events.ts:132` · medium · UNVERIFIED — In the catch branch re-queue and re-arm the backoff timer, so a failed batch is retried instead of dying with the tab. — 56f06de
- [x] **Persist streak-freeze budget and pending broken streak** — `packages/sdk/src/state.ts:259` · low · UNVERIFIED — Add `streak_freezes` and `broken_streak` columns in a migration and include them in `stateToRow`/`stateFromRow`, or move the freeze allowance somewhere that does sync. — 56f06de
- [x] **Mint transcript turn ids with `crypto.randomUUID()`** — `apps/web-pwa/src/wobo/Companion.tsx:99` · low · UNVERIFIED — Use the same UUID mint the `turn_id` two blocks down already uses, removing the dependence on archive length. — 56f06de
- [x] **Handle the floating consume promise in `record()`** — `packages/sdk/src/events.ts:64` · low · UNVERIFIED — Attach at least a `.catch(() => {})` (better, a recorded diagnostic) at the single call site so a consumer rejection is not an unhandled rejection. — 56f06de

### Wobo tutor, speech and context bus
- [x] **Fire each `afterSentence` beat exactly once per performance** — `apps/web-pwa/src/wobo/speech.tsx:421` · high · CONFIRMED — Track fired beats in a `Set` keyed `s${i}`/`e${i}` in `performTurn` and flush only the remainder, so ink, say lines and setState stop duplicating after the performance completes. — 56f06de
- [x] **Guarantee `onDone` fires once even when a line is muted or superseded** — `apps/web-pwa/src/wobo/speech.tsx:549` · high · CONFIRMED — Wrap the completion in a `done` flag with a single `finish()` in `speakLine`, so a muted or superseded line cannot permanently lock the course advance button. — 56f06de
- [x] **Fix the sentence splitter’s handling of decimals and abbreviations** — `apps/web-pwa/src/wobo/speech.tsx:114` · medium · UNVERIFIED — Tighten `sentences()` so a period only ends a segment before whitespace and a capital/end-of-string and never between digits, keeping voice-anchored ink beats in sync. — 56f06de
- [x] **Reset the redrawable mark set at the start of each turn** — `packages/wobo/src/context-bus.tsx:467` · medium · UNVERIFIED — Add `beginTurn()` to the bus and call it once in `performTurn`, so `addBeat` stops growing `lastMarksRef` without bound across a session. — 56f06de
- [x] **Normalise fill-in-the-blank answer comparison** — `apps/web-pwa/src/wobo/paths/cards.tsx:94` · medium · UNVERIFIED — Trim, lowercase and collapse whitespace on both sides at the single comparison point instead of comparing case-sensitively. — 56f06de
- [ ] **Give the published canvas slot an owner** — `packages/wobo/src/context-bus.tsx:257` · medium · UNVERIFIED — Change `publishCanvas` to take an owner key so the ~20 copy-pasted `publishCanvas(undefined)` unmount hooks stop clearing another screen’s slot. — deferred: publishCanvas owner keys until the engines rebuild — PARTIAL: the owner seam was built — `packages/wobo/src/context-bus.tsx:178` takes an `owner?`, and `resolveCanvasSlot` (`:272`) refuses a clear from a non-owner / MISSING: no caller passes one — all 40 `publishCanvas(undefined)` sites are still ownerless, and `:278` lets an ownerless clear through, so the defect survives unchanged

### Dark-theme regressions
- [x] **Emit theme-aware colours from the generated-visualization fallback** — `apps/web-pwa/src/wobo/paths/classify.ts:341` · medium · UNVERIFIED — Emit `currentColor` and `var(--clss-paper)` in `seedVizSvg` and set `color: var(--clss-ink-900)` on the `SafeSvg` host, so the compose-a-visualization path is visible in dark theme. — 56f06de

### Gateway and plexus main-flow bugs
- [x] **Write cache records atomically** — `services/gateway/src/classess_gateway/plexus/store.py:144` · medium · CONFIRMED — Write to a same-directory temp file with a pinned encoding and `os.replace` it, so a background render thread cannot interleave with a partial write. — 56f06de
- [x] **Emit telemetry under the key the log formatter reads** — `services/gateway/src/classess_gateway/telemetry.py:38` · medium · UNVERIFIED — Change `telemetry.emit` to `extra={"fields": asdict(event)}` — one line at the only place telemetry is logged. — 56f06de
- [x] **Fall back to the raw model text instead of a canned line** — `services/gateway/src/classess_gateway/wobo.py:1001` · medium · UNVERIFIED — When `_extract_json` yields `{}` and the text is non-empty, use the stripped text as `say` rather than discarding the reply. — 56f06de
- [x] **Make the SMILES branch stack local to `valid_smiles`** — `services/gateway/src/classess_gateway/plexus/chem.py:258` · medium · UNVERIFIED — Delete the module-global stack and `valid_smiles_reset`, so the only production caller cannot be poisoned by a previous parse. — 56f06de
- [x] **Refuse map scenes with tied extreme values server-side** — `services/gateway/src/classess_gateway/plexus/maps.py:129` · medium · UNVERIFIED — Compute the extreme per `it["extreme"]` and refuse when more than one entry attains it, so the derived answer is unambiguous. — 56f06de
- [ ] **Drain the relay outbox or delete the seam** — `platform/kgtopg-contract-seed/src/relay.ts:33` · medium · UNVERIFIED — Build the service-role publisher that reads `learner.outbox` where `published_at is null` and calls `runRelayOnce`, or remove the unreachable relay, since no event currently reaches `platform.events`. — deferred: the outbox relay publisher (KGtoPG platform wave)
- [x] **Substitute the unsubscribe link and postal address in transactional email** — `services/gateway/src/classess_gateway/email_templates.py:196` · low · UNVERIFIED — Take an `unsubscribe_url` parameter on `_shell` alongside `cta_url` and have `render()` supply a real per-recipient link, replacing the bracketed placeholders. — b895c53
- [x] **Compare the internal key as bytes** — `services/gateway/src/classess_gateway/email.py:114` · low · UNVERIFIED — Use `secrets.compare_digest(provided.encode("utf-8", "ignore"), expected.encode())` so a non-ASCII header returns 403 instead of raising TypeError. — b895c53
- [x] **Make the cache re-key migration idempotent** — `content/cache/_migrations/aliases.jsonl:1` · low · UNVERIFIED — Read the existing alias log into a set of `from` names once and skip files already recorded, so re-runs stop appending duplicate rows. — already-fixed in `56f06de`: `store._logged_aliases()` reads the log into a set of `(from, to)` pairs and `migrate()` skips any pair already recorded (stricter than the `from`-only set the finding asked for). Regression test `test_plexus.py:1267` re-runs `migrate()` and asserts the log is byte-identical. The finding was stale when the sweep list was cut.

<details><summary>Superseded in this wave (36)</summary>

- [ ] ~~**Scope course position, banked stars, thread-seen and daily-quest keys per account**~~ — `apps/web-pwa/src/screens/course/shared.tsx:31` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `screens/course/shared.tsx:35` `POS_KEY`/`STARS_KEY` still use raw `localStorage` and are absent from `store/scope.ts` `SCOPED_KEYS`; `screens/home/stops.ts:52` daily-quest key is unscoped too — the defect is live
- [ ] ~~**Scope and shard the Flashcards FSRS schedule key**~~ — `apps/web-pwa/src/engines/Flashcards.tsx:75` · low — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/Flashcards.tsx:63` is still one global `FSRS_KEY = 'wobo-fsrs-v1'` on raw `localStorage`, not in `SCOPED_KEYS` and neither per-account nor sharded — only the `clss-`→`wobo-` prefix changed
- [x] ~~**Rebuild the frame when class or board changes in You**~~ — `apps/web-pwa/src/screens/You.tsx:741` · high — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — the bundled catalog and the whole frame system are deleted (`screens/FrameBuilding.tsx:6`), and `screens/You.tsx:427` rebuilds the world through `chooseLevel`/`adoptFramework` when class or board changes
- [x] ~~**Key Home stops and Practice sandboxes off the frame’s own doors**~~ — `apps/web-pwa/src/screens/Practice.tsx:291` · high — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — `screens/home/stops.ts:97` derives every stop from `loadedTopics()`/`loadWorld()` — the learner's own registry — so a catalog-less board yields the honest board-choosing door, never an invented topic
- [ ] ~~**Await the frame build before navigating home on cross-device restore**~~ — `apps/web-pwa/src/screens/Onboarding.tsx:274` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `screens/Onboarding.tsx:255` still fires `void adoptFramework(...)` without awaiting it before `router.replace({ name: 'home' })` on cross-device restore
- [x] ~~**Read the learner’s stored avatar choice on the expedition**~~ — `apps/web-pwa/src/screens/AdventureRoadmap.tsx:488` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — `screens/AdventureRoadmap.tsx:489` reads the learner's stored choice with `scoped.getItem(AVATAR_KEY)` and only falls back to the hashed pick when nothing is stored
- [ ] ~~**Derive the Practice due-count and target from FSRS**~~ — `apps/web-pwa/src/screens/Practice.tsx:287` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `screens/Practice.tsx:31` is still a static `FRACTIONS_SET`; there is no FSRS import in the file, so neither the due count nor the target comes from the schedule
- [x] ~~**Write the onboarded marker when the profile is persisted**~~ — `apps/web-pwa/src/screens/FrameBuilding.tsx:286` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — `screens/FrameBuilding.tsx:296` writes `ONBOARDED_KEY` after the profile is already persisted upstream by `screens/Onboarding.tsx:340`
- [ ] ~~**Route the twin’s fallback study door to a real subject**~~ — `apps/web-pwa/src/screens/ProgressScreen.tsx:209` · low — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `screens/ProgressScreen.tsx:209` still hardcodes the fallback door to `{ name: 'subject', subjectId: 'math' }` rather than a subject the learner actually studies
- [x] ~~**Stop the earned-burst and day-sealed banner freezing on screen**~~ — `apps/web-pwa/src/screens/home/Thread.tsx:726` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — `screens/home/Thread.tsx` is deleted (f84e7bb); the rebuilt `screens/Home.tsx` carries no earned-burst or day-sealed banner state at all, so neither can freeze
- [ ] ~~**Use a local date key for the daily quest reset**~~ — `apps/web-pwa/src/screens/home/stops.ts:37` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `screens/home/stops.ts:53` `todayStr()` is still `new Date().toISOString().slice(0, 10)` — a UTC date key, so the quest resets at the wrong hour everywhere east or west of UTC
- [ ] ~~**Carry the boss score through to the performance stars**~~ — `apps/web-pwa/src/screens/course/Composing.tsx:1218` · high — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `screens/course/Composing.tsx:1270` `bossDone()` still drops the `ItemSet`'s `correctCount`, and the Greeting render at `:1368` omits `bossCorrect`/`bossTotal`
- [ ] ~~**Ignore Enter on an empty practice entry**~~ — `apps/web-pwa/src/screens/course/PracticeRun.tsx:456` · high — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): the Check button is disabled while empty (`screens/course/PracticeRun.tsx:469`) but the hardware-Enter path at `:456` calls `checkRef.current()` straight past that guard, and `check()` at `:366` accepts it because `Number('')` is 0 and finite — Enter on an empty entry still submits 0
- [ ] ~~**Randomise the correct option’s position in the boss missing-step card**~~ — `apps/web-pwa/src/screens/course/Boss.tsx:56` · high — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `screens/course/Boss.tsx:54` still builds `choices: [first, correct, second]` with `correctIndex: 1` fixed, and nothing shuffles at render — the answer is always the middle option
- [ ] ~~**Let a generated course resume into the boss**~~ — `apps/web-pwa/src/screens/course/Composing.tsx:1191` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `screens/course/Composing.tsx:1243` still bounds resume at `saved <= built.cards.length + 1`, which excludes the boss stage, contradicting the comment beside it
- [ ] ~~**Hoist the balancer’s inline `Side` component to module scope**~~ — `apps/web-pwa/src/engines/ChemScene.tsx:463` · high — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/ChemScene.tsx:481` still defines `const Side = ({...}) => (...)` inside the component body, so it remounts its subtree on every render
- [x] ~~**Attach the scene-target refs the seven engines register**~~ — `apps/web-pwa/src/engines/MiniWorkbook.tsx:714` · high — superseded: rebuilt in Wave 5 (board/engines) — every engine now attaches its `useRegisterTarget` ref to a real DOM node — `engines/MiniWorkbook.tsx:754`, `engines/ArcadeShell.tsx:368`, `engines/ChemScene.tsx:529` and the rest of the seventeen
- [ ] ~~**Grade the MiniWorkbook answers being revealed, not the stale ones**~~ — `apps/web-pwa/src/engines/MiniWorkbook.tsx:691` · high — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/MiniWorkbook.tsx:669` `revealAll()` still calls `setAnswers` then `setTimeout(grade, 60)`, and `grade` closes over the pre-reveal `answers` — the stale set is what gets graded
- [ ] ~~**Refuse titration specs that would need thousands of taps**~~ — `apps/web-pwa/src/engines/ChemScene.tsx:690` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/ChemScene.tsx:296` validates only `dropVolumeMl > 0`; `maxDrops` at `:709` is unbounded, so a titration spec needing thousands of taps is still accepted
- [ ] ~~**Refuse choropleth specs with tied extreme values**~~ — `apps/web-pwa/src/engines/MapScene.tsx:225` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/MapScene.tsx:177` never checks for tied extremes, and `choroplethAnswer` at `:225` silently resolves a tie to the first region
- [ ] ~~**Keep the ArcadeShell state updater pure**~~ — `apps/web-pwa/src/engines/ArcadeShell.tsx:259` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/ArcadeShell.tsx:226` still calls `sfx`, `setScore`, `recordAttempt`, `loseLife` and `advanceRound` from inside the `setItems` updater
- [ ] ~~**Cancel the ArcadeShell round-advance timeout on restart and unmount**~~ — `apps/web-pwa/src/engines/ArcadeShell.tsx:203` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/ArcadeShell.tsx:203` `advanceRound` calls `window.setTimeout` without storing the id, and there is no `clearTimeout` anywhere in the file — nothing cancels it on restart or unmount
- [ ] ~~**Stop the BlockAssembly walk when the program is edited**~~ — `apps/web-pwa/src/engines/cs/BlockAssembly.tsx:286` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/cs/BlockAssembly.tsx:284` resets `playIndex`/`reached` on edit but never calls `stop()`, so the stale interval at `:341` keeps driving the walk
- [ ] ~~**Never start a second PodcastPlayer reading-clock loop**~~ — `apps/web-pwa/src/engines/PodcastPlayer.tsx:229` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/PodcastPlayer.tsx:220` — the fallback reading-clock branch starts a new rAF without cancelling the running one first, unlike the branch at `:212`
- [ ] ~~**Prevent orphaned narration audio nodes overlapping**~~ — `apps/web-pwa/src/engines/PodcastPlayer.tsx:216` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/PodcastPlayer.tsx:216` `play()` has no staleness guard after `await synth`, so a pause or jump mid-await still lets the stale call start a second source
- [ ] ~~**Move Discovery’s side effects out of the state updater**~~ — `apps/web-pwa/src/engines/Discovery.tsx:399` · low — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/Discovery.tsx:400` `tapTarget`'s state updater still calls `sfx.tap()` and `queueMicrotask(fire)` inside itself
- [ ] ~~**Stop SimRunner collapsing fractional parameter ranges**~~ — `apps/web-pwa/src/engines/SimRunner.tsx:200` · low — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/SimRunner.tsx:214` still rounds min, max and start with `Math.round` after validating the raw floats, collapsing a fractional range to a single point
- [ ] ~~**Charge one life per ArcadeShell mistake**~~ — `apps/web-pwa/src/engines/ArcadeShell.tsx:262` · low — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `loseLife()` is called from inside the impure `setItems` updater (`engines/ArcadeShell.tsx:256`), which StrictMode double-invokes (`main.tsx:101`), so a mistake can still cost two lives
- [ ] ~~**Restore the global cursor when AnatomyCanvas unmounts**~~ — `apps/web-pwa/src/engines/AnatomyCanvas.tsx:45` · low — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/AnatomyCanvas.tsx:45` sets `document.body.style.cursor` on pointer over and out only; the file has no `useEffect` and no unmount cleanup, so an unmount mid-hover leaves the cursor changed
- [ ] ~~**Stop the app header rendering as a white bar in dark mode**~~ — `apps/web-pwa/src/ui/AppHeader.tsx:476` · high — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `ui/AppHeader.tsx:482` still hardcodes `rgba(255,255,255,0.62)` with no theme token, so the header is a white bar in dark mode
- [x] ~~**Token the course what-if plates that hardcode white**~~ — `apps/web-pwa/src/screens/course/WhatIf.tsx:235` · high — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — `screens/course/WhatIf.tsx:256` onward uses `var(--paper)`/`var(--paper-2)` throughout — no hardcoded white or hex remains, and the tokens are theme-aware
- [x] ~~**Replace `fill="#FFFFFF"` on ink-outlined shapes with `var(--clss-paper)`**~~ — `apps/web-pwa/src/screens/Learn.tsx:147` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — `screens/Learn.tsx` carries no `fill=` attribute at all after the f84e7bb rewrite; all three `fill="#FFFFFF"` occurrences are gone
- [ ] ~~**Put the command palette above the fixed header**~~ — `apps/web-pwa/src/ui/AppHeader.tsx:474` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `ui/tokens.ts:282` still orders `modal: 1000` below `toast: 1100`, and `ui/AppHeader.tsx:480` uses z-toast while `shell/CommandPalette.tsx:530` uses z-modal — the palette still opens beneath the header
- [x] ~~**Select the newest rendered manifest, not the lexicographically last**~~ — `services/gateway/src/classess_gateway/plexus/engines.py:1834` · high — superseded: rebuilt in Wave 5 (board/engines) — `services/gateway/src/wobo_gateway/plexus/engines.py:1919` selects with `max(manifests, key=lambda m: (m.stat().st_mtime, m.name))` — newest by mtime, not lexicographically last
- [ ] ~~**Add the missing school units to the dimension table**~~ — `services/gateway/src/classess_gateway/plexus/dimensions.py:44` · low — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `wobo_gateway/plexus/dimensions.py:51` `_UNITS` still holds only SI base units and a few derived ones — km, cm, mm, g, min, h and L are all still rejected
- [ ] ~~**Attach only the first valid activity field to a composed card**~~ — `services/gateway/src/classess_gateway/plexus/engines.py:700` · low — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `wobo_gateway/plexus/engines.py:750` still loops over all seventeen `_CARD_ACTIVITIES` fields with no break, attaching every valid one, contradicting the "at most one" doctrine its own prompt states at `:1257`

</details>

## Wave 4 — Repo cleanup and test wiring

27 tasks · 23 done · 2 open · 2 deferred · 0 superseded (rebuilt in later waves)

### Dead code — app and packages
- [x] **Delete the dead `packages/ui` component system** — `packages/ui/src/index.ts:1` · medium · CONFIRMED — Port the surviving assertions from `packages/ui/test/ui.test.ts` first, then delete the package and drop it from `apps/web-pwa`’s dependencies — all 16 components have zero import sites and have diverged from the live kit. (reported twice) — bd5a7b4
- [x] **Delete the second, unused Wobo presence implementation** — `packages/wobo/src/WoboPresence.tsx:1` · medium · UNVERIFIED — Remove `WoboPresence.tsx`, `WoboPanel.tsx` and `wobo-layer.tsx` plus their three export lines, leaving actions/context-bus/highlight-overlay as the live surface. — sweep
- [x] **Get the Concept A/B/C prototypes out of the production bundle and palette** — `apps/web-pwa/src/screens/concepts/ConceptA.tsx:415` · medium · UNVERIFIED — Delete (or `import.meta.env.DEV`-gate) the three command-palette entries and lazy-load or remove the prototype routes, so screens full of fabricated learner data are neither reachable nor statically bundled. (reported three times) — sweep
- [x] **Delete the unreachable `engine.image` seam** — `apps/web-pwa/src/engines/GeneratedImage.tsx:34` · medium · UNVERIFIED — Remove `ENGINE`/`register()` from `plexus/image.py` and the orphan `GeneratedImage.tsx` renderer, since there is no registry entry and no caller. — sweep
- [x] **Consume or delete `useFidelity`** — `apps/web-pwa/src/shell/resilience.ts:96` · medium · UNVERIFIED — Gate the first-visit swoop and the full-arrival Wobo branch on `useFidelity()`, or delete the export — the documented low-fidelity degradation is currently never applied. — sweep
- [ ] **Delete the three dead scene-envelope unwrap paths** — `apps/web-pwa/src/engines/ChemScene.tsx:258` · low · UNVERIFIED — Remove the `raw.artifact`/`raw.spec` unwraps and the `verified === false` check from all seven parsers; the `card` field is the spec. — skipped: premise false, and the deletion would remove a live safety gate. The plexus SERVE path really is an envelope — `engines._public()` returns `{artifact, verified, seeded, provenance, status}` and `Composing.tsx` unwraps `res.output.artifact` — so `verified === false` is a reachable refusal in `DerivationDepth`, `WordProblemBreakdown`, `PerturbationSandbox`, `SocialScene`, `MathScene`, `CompareInteractive`, `MiniWorkbook`, `ArcadeShell`, `BioScene` and `Flashcards`. Dropping it across the parsers would ship unverified generated content to a child for a `low` cleanup.
- [x] **Delete `shell/shell-context.tsx`** — `apps/web-pwa/src/shell/shell-context.tsx:14` · low · UNVERIFIED — Nothing imports it and the `AppShell` it references does not exist. — sweep
- [x] **Delete the unreferenced `public/wobo-logo.png`** — `apps/web-pwa/src/ui/Logo.tsx:12` · low · UNVERIFIED — Post-rebrand this finding is partly stale — `WoboLogo` and `public/favicon.svg` are both live now (AppHeader, MotionPlayer, concepts, index.html), so only the unreferenced PNG should go. — 0466342
- [ ] **Delete the unread `Board.seeded` flag** — `apps/web-pwa/src/data/catalog.ts:20` · low · UNVERIFIED — Remove the field from `data/model.ts` and all thirteen catalog entries; it is never read and already contradicts the code that decides seeding. — skipped: premise false. `Board.seeded` is read in five live places — `screens/you/GradeBoardPicker.tsx:69,70,229,230,298` — where it splits the seeded boards from the doors in the picker UI; removing it breaks the picker. What WAS dead is the neighbouring helper `boardSeeded()` in `screens/you/profile.ts` (zero callers), deleted under the export-pruning task.
- [x] **Drop the `export` keyword from ~77 module-local symbols** — `apps/web-pwa/src/data/catalog.ts:848` · low · UNVERIFIED — Un-export the mind.ts, resilience.ts, catalog.ts and forge-store.ts clusters, leaving only what other files actually import. — sweep

### Dead code — services and content
- [x] **Wire or remove the 663-line email subsystem** — `services/gateway/src/classess_gateway/email.py:107` · medium · UNVERIFIED — Either wire the callers and add `INTERNAL_EMAIL_KEY` to the deploy config, or drop `register_email` from `create_app` until there is a caller. — b895c53
- [x] **Wire or delete the `engine.image` / raster seam** — `services/gateway/src/classess_gateway/plexus/engines.py:1592` · medium · UNVERIFIED — Either have the composing screen request `engine.diagram` with `raster: true` for cards carrying an imageSpec, or delete the seam — nothing ever requests it today. — sweep
- [x] **Call the Python contract mirror or drop the dependency** — `services/contracts/src/classess_contracts/__init__.py:3` · medium · UNVERIFIED — Invoke `classess_contracts.validate_event` at the server-side ingest point, or remove `classess_contracts` from the gateway dependencies, since no gateway module imports it. — sweep
- [x] **Delete `services/render-worker/queue.py`** — `services/render-worker/queue.py:43` · medium · UNVERIFIED — `worker.pending_jobs` + `_append_status` are the real queue; the dead module’s `drain()` truncates the file and destroys jobs appended during the read. (reported twice) — sweep
- [x] **Call or delete the Manim escalation rung** — `services/gateway/src/classess_gateway/plexus/manim_rung.py:55` · low · UNVERIFIED — Either call `needs_manim` inside `_generate_video_live` and enqueue beside `_maybe_enqueue_render`, or soften the README claim — no production path reaches it. — sweep
- [x] **Wire or archive the `content/atom` spike** — `content/atom/spike-report.json:1` · low · UNVERIFIED — Either wire the grounded grader (the only code pairing the CAS verifier with a hint-safety guardrail) into the gateway, or archive the completed spike and its committed report. — sweep
- [x] **Delete or relocate the four unreferenced `content/catalogs` JSON files** — `content/catalogs/reference-structures.json:1` · low · UNVERIFIED — Roughly 460 KB with no code reference — delete them, or move them beside the existing provenance notes if they are deliberate inputs. — sweep

### Tracked artifacts that should not be in the repo
- [ ] **Untrack the generated `content/cache/video` blobs** — `content/cache/video/:0` · high · OBSERVED — Confirm the cache is regenerable, add `content/cache/` to `.gitignore`, `git rm -r --cached` it and include it in the history rewrite. — deferred: history rewrite decision
- [ ] **Untrack `xbrowser/`, `respdiag/` and `shots/`** — `xbrowser/:0` · high · OBSERVED — Add all three to `.gitignore`, `git rm -r --cached` them and purge the paths from history — roughly 106 MB of duplicated QA screenshots. — deferred: history rewrite decision
- [x] **Untrack the ~200 root-level screenshots and videos** — `wave14-audit-home-desktop-light.png:1` · high · OBSERVED — `git rm --cached` the root images and the three MP4s, add root screenshot/video patterns to `.gitignore`, and relocate anything worth keeping into `docs/` with provenance. (reported twice) — 383829a
- [x] **Make `.gitignore` actually cover the on-disk junk** — `.gitignore:43` · medium · OBSERVED — Add `.playwright-mcp/`, `xbrowser/`, `respdiag/`, `shots/`, `content/cache/` and a root screenshot/video glob, with a negation for the real PWA assets under `apps/web-pwa/public/`. (reported three times) — 383829a
- [x] **Remove the six one-off `*.workflow.js` orchestration scripts from the app package** — `apps/web-pwa/wave3-plexus.workflow.js:1` · medium · OBSERVED — `git rm` all six from `apps/web-pwa/` (they hardcode a machine-local scratchpad path and are recoverable from history) and drop the now-unneeded `!**/*.workflow.js` exclude from `biome.json`. (reported four times) — 383829a
- [x] **Gitignore `scripts/set-vercel-env.sh` so the embedded anon JWT is never committed** — `scripts/set-vercel-env.sh:0` · medium · OBSERVED — Add the filename (or `scripts/*-env.sh`) to `.gitignore`; it is currently untracked but flips prod env vars directly with a live key inline. — 383829a
- [x] **Move the dated handoff and phase reports out of the repo root** — `HANDOFF.md:1` · low · UNVERIFIED — Relocate `HANDOFF.md`, `PHASE-0-REPORT.md` and `PHASE-1-REPORT.md` into `docs/history/` with a dated prefix, leaving only the binding law files at root. — 383829a
- [x] **Delete the applied one-off factbase migration scripts** — `content/factbase/apply.sh:6` · low · UNVERIFIED — Remove `content/factbase/apply.sh`, `patch_validate.py` and `APPLY.md` — they hardcode personal paths and the work they describe is already applied. — bd5a7b4

### Root-level duplication
- [x] **Delete `migrate-to-new-project.sql`** — `migrate-to-new-project.sql:1` · medium · UNVERIFIED — It is a hand-maintained duplicate of the five `infra/supabase/migrations` files; document the equivalent as a one-line concatenation in the infra README instead. (reported twice) — 383829a
- [x] **Resolve the empty `apps/expo-app` workspace** — `apps/expo-app/README.md:1` · low · UNVERIFIED — Either delete the directory and its README references, or add a minimal `package.json` so it stops sitting inside the `apps/*` workspace glob with nothing in it. (reported twice) — bd5a7b4

## Deferred / fold into later waves (design-law, a11y, perf, doc-drift, maintainability)

60 tasks · 36 done · 24 open — re-read against the code at `f84e7bb` on 2026-09-04. Of the 38 lines struck through as superseded, 14 are genuinely gone (the re-skin's token layer, the reduced-motion wrapper, the deleted Thread and heatmap, the memoised sanitiser and world sync) and 24 are NOT — mostly the engine perf and a11y findings, which no wave has touched.

### Design-law violations (→ UI overhaul wave)
- [x] **Inline a first-paint background style in `index.html`** — `apps/web-pwa/index.html:18` · low · UNVERIFIED — Add a tiny inline `<style>` setting `color-scheme` and a `prefers-color-scheme` background so dark-mode users do not get a white flash. → UI overhaul wave. — sweep

### Accessibility (→ UI overhaul wave)
- [x] **Restore the focus ring on the Wobo composers and quiz input** — `apps/web-pwa/src/wobo/Companion.tsx:579` · medium · UNVERIFIED — Delete the `outline: none` declarations so the global `:focus-visible` ring applies to the primary input. → UI overhaul wave. (reported twice) — sweep
- [x] **Raise `--clss-ink-faint` to the WCAG AA floor** — `packages/config/src/tokens.ts:118` · medium · UNVERIFIED — Set `chrome.inkFaint` to the AA-passing values already computed for `ink[300]` in both themes. → UI overhaul wave. — sweep
- [x] **Give the command palette a touch entry point** — `apps/web-pwa/src/shell/CommandPalette.tsx:316` · medium · UNVERIFIED — Export an opener (module store or a `clss-open-palette` event) and wire the existing Home affordance, so the palette is reachable on phones and in the installed PWA. → UI overhaul wave. — sweep
- [x] **Make the Wobo drawer a real dialog** — `apps/web-pwa/src/wobo/Companion.tsx:339` · low · UNVERIFIED — Add `role="dialog" aria-modal="true"`, focus the composer on open, restore focus on close and handle Escape. → UI overhaul wave. — sweep
- [x] **Move the palette’s combobox ARIA onto the input** — `apps/web-pwa/src/shell/CommandPalette.tsx:466` · low · UNVERIFIED — Put `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant` on the `<input>` and mark the wrapper `role="dialog"`. → UI overhaul wave. — sweep

### Performance — app shell and engines
- [x] **Route-split the 2.1 MB eager entry chunk** — `apps/web-pwa/vite.config.ts:24` · high · CONFIRMED — Split at `App.tsx`’s single mount point while keeping the two first-paint screens eager, per the 2G/cheap-phone law. → UI overhaul wave. — sweep
- [x] **Resolve nav intents before spending a gateway round-trip** — `apps/web-pwa/src/App.tsx:382` · medium · UNVERIFIED — Move `resolveDestination(text)` above the `sdk.llm.invoke` call in `ask()` and return early on a route hit. → UI overhaul wave. — sweep
- [x] **Build the target rect map once per overlay render** — `packages/wobo/src/highlight-overlay.tsx:109` · medium · UNVERIFIED — Hoist the `targetsRef` lookup into a single `Map<string, DOMRect>` instead of measuring every mark against every target each frame. → UI overhaul wave. — sweep
- [x] **Replace `targetsVersion` with a subscription** — `packages/wobo/src/context-bus.tsx:292` · medium · UNVERIFIED — Expose registration changes through `subscribeToTargets(cb)` so every target mount/unmount does not re-render the whole Wobo consumer tree. → UI overhaul wave. — sweep

### Performance — gateway and plexus (→ board wave)
- [x] **Record lint refusals so a failed canonical is not regenerated every request** — `services/gateway/src/classess_gateway/plexus/validate.py:248` · medium · UNVERIFIED — Persist `refusedAt`/`lintFailures` on the canonical record that `_promote_after_lint_failure` already assembles and short-circuit on it. → board wave. — sweep
- [x] **Preserve `xmlns` through SVG sanitization** — `services/gateway/src/classess_gateway/plexus/sanitize.py:76` · medium · UNVERIFIED — Force the namespace on the root before serializing, so the cache stops treating every sanitized diagram as permanently stale. → board wave. — sweep

### Maintainability
- [x] **Make `SimSpec` a single definition** — `packages/contracts/src/generated/plexus.ts:142` · medium · UNVERIFIED — Have `SimRunner.tsx` import `SimSpec` from `@classess/contracts/plexus` and reconcile the drift back into `specs.py`. → board wave. — sweep
- [x] **Separate the bun-test and Playwright directories** — `apps/web-pwa/test/x-browser.spec.ts:1` · medium · UNVERIFIED — Move `test/x-browser.spec.ts` and its config into `tests/` so one directory does not hold two suites run by two different runners. → folds into the Wave 4 repo cleanup. — sweep

### Documentation drift
- [x] **Rewrite README.md against the real repo** — `README.md:63` · medium · UNVERIFIED — Fix the directory tree, replace the Phase-0 line with the live state and a pointer to HANDOFF.md, and rewrite the auth bullet. → folds into the Wave 2 deploy-truth pass. — sweep
- [x] **Publish an explicit law precedence order** — `CONTEXT.md:46` · medium · UNVERIFIED — Add a precedence header to README.md naming DECISIONS.md > root law files (CONTEXT/DESIGN/WOBO/MOTION/SUBJECTS) > `docs/` as historical, and mark the phase-mandating docs as superseded. → folds into the Wave 2 deploy-truth pass. — sweep
- [x] **Reconcile the shipped typeface with DECISIONS.md** — `apps/web-pwa/index.html:14` · medium · UNVERIFIED — Either self-host the faces under `public/fonts/` as DECISIONS.md promises, or amend the decision to record the CDN stand-in. → UI overhaul wave. — sweep
- [x] **Reconcile the Google Fonts CDN link with the "bundled locally" stack law** — `apps/web-pwa/index.html:13` · low · UNVERIFIED — Add the `@fontsource` packages and import them from `main.tsx`, deleting the `<link>` tags and the two CDN entries from the CSP. → UI overhaul wave. — sweep
- [x] **Declare all seven `VITE_` variables in `vite-env.d.ts`** — `apps/web-pwa/src/vite-env.d.ts:4` · low · UNVERIFIED — Give each its literal union type so the `App.tsx` casts can be dropped and a misspelled name becomes a compile error. → folds into the Wave 2 env pass. — sweep
- [x] **Update the app README’s description and scripts list** — `apps/web-pwa/README.md:3` · low · UNVERIFIED — Match `package.json` including the e2e commands, and annotate which workspaces the root filter actually reaches. → folds into the Wave 2 CI pass. — sweep
- [x] **Delete the stale SDK test assertion** — `packages/sdk/test/sdk.test.ts:38` · low · UNVERIFIED — `sdk.test.ts:38-40` asserts a constraint the auth work removed; `auth.test.ts:113` states the same guarantee correctly. → folds into the Wave 2 CI pass. — sweep
- [x] **Drop the `wave14-shots/` premise from any cleanup brief** — `(no such path — wave14 files are flat at repo root)` · low · OBSERVED — Path verified not to exist — the wave14 screenshots are flat root-level files, already covered by the root-dump task in Wave 4. → folds into the Wave 4 repo cleanup. — sweep

<details><summary>Superseded in this wave (38)</summary>

- [ ] ~~**Move the conversation onto Home and delete the `chat` route**~~ — `apps/web-pwa/src/screens/Home.tsx:223` · high — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): the `chat` route is still live — `shell/router.tsx:35` keeps it, `App.tsx:356` still renders `ChatScreen`, and `screens/Home.tsx:116` still navigates to it
- [x] ~~**Stop inventing a CBSE Class 8 maths syllabus for catalog-less boards**~~ — `apps/web-pwa/src/screens/home/stops.ts:79` · high — superseded: rebuilt in Wave 6 (curriculum/catalog/frame) — `screens/home/stops.ts` now reads only `loadWorld()`/`loadedTopics()`; `curriculum/registry.ts:6` and `curriculum/world.ts:8` record that the invented CBSE Class 8 default is impossible — a catalog-less board yields the board-choosing door
- [ ] ~~**Replace the hero doors’ five-colour rotating aurora with one pigment**~~ — `apps/web-pwa/src/ui/kit.tsx:547` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — PARTIAL: no hero door uses it any more — `AuroraButton` is exported by `ui/kit.tsx:527` and called from nowhere in the app / MISSING: the five-colour rotating aurora is still in the kit as a live export (`ui/kit.tsx:555`), so nothing stops it being used again
- [x] ~~**Neutralize the home thread’s five always-on chrome pigments**~~ — `apps/web-pwa/src/screens/home/Thread.tsx:26` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — `screens/home/Thread.tsx` is deleted; the rebuilt `screens/Home.tsx` and `screens/home/Home.css` draw from the palette-v4 tokens (`--pig`, `--paper-2`) rather than five always-on pigments
- [ ] ~~**Stop gating course Continue on video generation**~~ — `apps/web-pwa/src/screens/course/Composing.tsx:1032` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `screens/course/Composing.tsx:1081` still sets `disabled: video.status === 'pending'` on the Continue button inside `VideoBeat`, so a slow render still blocks the lesson
- [ ] ~~**Refuse perturbation specs that are already broken at mount**~~ — `apps/web-pwa/src/engines/PerturbationSandbox.tsx:168` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/PerturbationSandbox.tsx:66` `parsePerturbSpec` never calls `isBroken(spec, from)`, so a spec already broken at its starting value still validates and mounts
- [x] ~~**Remove the drop shadows from the roadmap and BioScene chips**~~ — `apps/web-pwa/src/screens/AdventureRoadmap.tsx:917` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — superseded by design law v3 / palette v4, which requires soft shadows under floating things — `screens/AdventureRoadmap.tsx:918` and `engines/BioScene.tsx:599` now carry soft tinted shadows only on floating and dragged chips
- [ ] ~~**Bring the kit’s entrance choreography back to MOTION.md**~~ — `apps/web-pwa/src/ui/kit.tsx:620` · low — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `ui/kit.tsx:637` still staggers the cascade at 0.07 s and rises 22 px, against MOTION.md §3's documented 40 ms stagger and 12 px rise
- [x] ~~**Give the two Learn shelf affordances real destinations**~~ — `apps/web-pwa/src/screens/Learn.tsx:466` · low — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — the custom-courses shelf was removed from `screens/Learn.tsx` in the f84e7bb rewrite; every remaining affordance (tiles, rows, `DiscoveryCard`) navigates a real route
- [ ] ~~**Route the daily "did you know" chip through Wobo**~~ — `apps/web-pwa/src/ui/AppHeader.tsx:396` · low — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `ui/AppHeader.tsx:398` `FACTS` is still a hardcoded static array picked by date — nothing routes the daily chip through Wobo or the gateway
- [ ] ~~**Drop the magenta accent from the header chrome**~~ — `apps/web-pwa/src/ui/AppHeader.tsx:504` · low — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `ui/AppHeader.tsx:510` still sets `SparkIcon color="#CC1E7A"` — a magenta that is not in the palette-v4 pigment list
- [x] ~~**Remove or replace the "coming soon" dead-end in You**~~ — `apps/web-pwa/src/screens/You.tsx:674` · low — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — no "coming soon" string survives anywhere in `apps/web-pwa/src`, and `screens/You.tsx` carries no disabled or dead-end affordance
- [ ] ~~**Give BioScene foodWeb and dragLabel a keyboard path**~~ — `apps/web-pwa/src/engines/BioScene.tsx:1052` · high — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `engines/BioScene.tsx:1052` foodWeb's `<g role="button">` still has no `tabIndex` or `onKeyDown`, and DragLabel's chips at `:469` are pointer-only
- [ ] ~~**Make MapScene operable without a pointer**~~ — `apps/web-pwa/src/engines/MapScene.tsx:451` · high — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `engines/MapScene.tsx:440` still offers only `onPointerDown` on an SVG marked `role="img"` — no `tabIndex`, no key handler anywhere
- [x] ~~**Honour `prefers-reduced-motion` app-wide**~~ — `apps/web-pwa/src/ui/kit.tsx:627` · high — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — `apps/web-pwa/src/main.tsx:97` wraps the whole app in `MotionPrefConfig`/`MotionConfig`, and `ui/kit.tsx:161`, `:196` and `:230` call `useReducedMotion()` for the rAF-driven effects
- [x] ~~**Skip the home first-visit theatre under reduced motion**~~ — `apps/web-pwa/src/screens/Home.tsx:253` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — the first-visit theatre was removed in the rebuild — `screens/Home.tsx` has no swoop-in, typewriter or first-visit animation code at all
- [x] ~~**Guard the infinite decorative loops in SubjectScreen, Learn and Practice**~~ — `apps/web-pwa/src/screens/SubjectScreen.tsx:261` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — no `repeat: Infinity` survives in the live `screens/SubjectScreen.tsx`, `screens/Learn.tsx` or `screens/Practice.tsx`; the only remnant is `screens/learn/legacy.tsx:71`, which nothing imports
- [x] ~~**Restore focus visibility on MiniWorkbook’s SVG label targets**~~ — `apps/web-pwa/src/engines/MiniWorkbook.tsx:488` · medium — superseded: rebuilt in Wave 5 (board/engines) — `engines/MiniWorkbook.tsx:476` gives each `g[role=button]` a `tabIndex` and an Enter/Space `onKeyDown`, and nothing suppresses the default focus outline
- [ ] ~~**Make Discovery’s act-to-reveal gate keyboard-completable**~~ — `apps/web-pwa/src/engines/Discovery.tsx:578` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/Discovery.tsx` tap targets (`MarkShape`'s `common`) still carry no `tabIndex` or `onKeyDown`, and the drag handle at `:564` is pointer-only
- [ ] ~~**Hoist Punnett’s inline `CellBox`/`HeaderCell` to module scope**~~ — `apps/web-pwa/src/engines/BioScene.tsx:737` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/BioScene.tsx:737` and `:776` still define `CellBox` and `HeaderCell` inside `function Punnett` (`:623`) rather than at module scope
- [x] ~~**Give the twin query bar a submit control**~~ — `apps/web-pwa/src/screens/ProgressScreen.tsx:288` · low — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — the twin's query bar is now a real `<form onSubmit={submitQuery}>` (`screens/ProgressScreen.tsx:307`), so Enter and a mobile keyboard's Go key both submit — the input is no longer a dead end
- [x] ~~**Memoize the `chaptersBySubject` proxy resolution**~~ — `apps/web-pwa/src/data/catalog.ts:2316` · medium — superseded: rebuilt in Wave 6 (curriculum/catalog/frame) — `curriculum/registry.ts:102` `syncWorld` short-circuits on a worldKey comparison and `curriculum/world.ts:45` caches `loadWorld`, so the proxy traps are cheap unless the world actually changed
- [ ] ~~**Tear down the 3Dmol viewer and its WebGL context**~~ — `apps/web-pwa/src/engines/ChemScene.tsx:1137` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/ChemScene.tsx:1160` cleanup calls only `viewer.clear()`, which drops scene objects but never disposes the renderer or releases the WebGL context
- [ ] ~~**Compute the WebGL probe once per session**~~ — `apps/web-pwa/src/engines/AnatomyScene.tsx:289` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/AnatomyScene.tsx:289` memoises `hasWebGL` per component instance with `useMemo(hasWebGL, [])`; there is no module-level cache, so it is recomputed on every mount
- [ ] ~~**Memoize expression tokenisation in MathScene**~~ — `apps/web-pwa/src/engines/MathScene.tsx:553` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/MathScene.tsx:556` calls `evaluateExpr` per sample inside `Plot.OfX`, and `engines/SimRunner.tsx:87` `tokenize()` caches nothing by expression string
- [ ] ~~**Drive the projectile from a ref instead of a 60 fps `setState`**~~ — `apps/web-pwa/src/engines/PhysicsScene.tsx:337` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/PhysicsScene.tsx:335` still calls `setT()` on every rAF tick — a 60 fps `setState` rather than driving the ball from a ref
- [ ] ~~**Switch AnatomyCanvas to `frameloop="demand"`**~~ — `apps/web-pwa/src/engines/AnatomyCanvas.tsx:91` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/AnatomyCanvas.tsx:156` `<Canvas>` still has no `frameloop` prop (so it defaults to "always") and there are no `invalidate()` calls to support demand mode
- [ ] ~~**Give the Pyodide output harness a step/time budget**~~ — `apps/web-pwa/src/engines/cs/pyodide.ts:126` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/cs/pyodide.ts:171` `OUTPUT_HARNESS` still has no step or time limit, unlike `TRACE_HARNESS`, which caps at `_LIMIT = 6000` (`:115`)
- [x] ~~**Hoist the You heatmap’s localStorage read into a `useMemo`**~~ — `apps/web-pwa/src/screens/You.tsx:1251` · low — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — the "ACTIVITY · 30 DAYS" heatmap is gone from `screens/You.tsx` entirely; the weekly aggregates that remain are computed in `useMemo` over a lazily-read store (`:170`, `:171`)
- [x] ~~**Sanitize generated SVG once per render**~~ — `apps/web-pwa/src/engines/DiagramView.tsx:126` · low — superseded: rebuilt in Wave 5 (board/engines) — `engines/DiagramView.tsx:93` and `:126` wrap both `sanitizeSvgElement` and `svgIsClean` in `useMemo` keyed on the `svg` string, so the sanitize runs once per render
- [ ] ~~**Mint workbook and flashcard ids lazily**~~ — `apps/web-pwa/src/engines/MiniWorkbook.tsx:633` · low — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/MiniWorkbook.tsx:633` still calls `useRef(spec.items.map(() => crypto.randomUUID()))`, which mints a fresh set of UUIDs on every render rather than lazily
- [ ] ~~**Serve rendered MP4s over a media route instead of base64 in JSON**~~ — `services/gateway/src/classess_gateway/plexus/engines.py:1843` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `wobo_gateway/plexus/engines.py:1898` `_rendered_url` still inlines the MP4 as a base64 `data:` URI, and its own comment records that the `/media` route was never built
- [x] ~~**Route CBSE through the same frame path as every other board**~~ — `apps/web-pwa/src/data/catalog.ts:2295` · medium — superseded: rebuilt in Wave 6 (curriculum/catalog/frame) — CBSE has no special case left — `apps/web-pwa/src/data/catalog.ts` is deleted, and `screens/you/profile.ts:150` and `:173` put every `frameworkId` through the same generic path
- [ ] ~~**Break up the 1160-line `You()` and 800-line `Onboarding()`**~~ — `apps/web-pwa/src/screens/You.tsx:716` · medium — superseded: rebuilt in Wave 7 (screens/chrome/onboarding) — NOT SUPERSEDED (re-read 2026-09-04): `You()` is still 527 lines (`screens/You.tsx:137-663`) and `Onboarding()` still 696 (`screens/Onboarding.tsx:117-812`) — both remain one monolithic function
- [ ] ~~**Add `Mark.fill` to `specs.py` and regenerate**~~ — `services/gateway/src/classess_gateway/plexus/specs.py:52` · medium — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `wobo_gateway/plexus/specs.py:59` `Mark` still has no `fill` field, so the frontend's `Mark.fill` (`engines/Discovery.tsx:72`) is unmodelled on the backend contract
- [ ] ~~**Amend VIDEO-QUALITY.md to match the shipped video path**~~ — `VIDEO-QUALITY.md:4` · low — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `VIDEO-QUALITY.md:4` still claims "not rendered MP4s" while the render worker in `plexus/engines.py` and `engines/MotionPlayer.tsx:277` play baked MP4s through `renderedUrl`
- [ ] ~~**Make the `Spec` base model forbid unmodelled fields as documented**~~ — `services/gateway/src/classess_gateway/plexus/specs.py:36` · low — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `wobo_gateway/plexus/specs.py:36` `Spec.model_config` still sets no `extra="forbid"`; the docstring records that the claim was deleted rather than the rule enforced
- [ ] ~~**Reconcile DerivationDepth’s advertised expand/collapse actions**~~ — `apps/web-pwa/src/engines/DerivationDepth.tsx:245` · low — superseded: rebuilt in Wave 5 (board/engines) — NOT SUPERSEDED (re-read 2026-09-04): `engines/DerivationDepth.tsx:241` `getValidActions` still advertises expand and collapse, but no `applyTutorAction` handler is registered to execute either

</details>

## Tally

- **Wave 1 — Lock the brain (security boundary)** — 43 findings across 37 tasks
- **Wave 2 — Production config, deploy truth, CI** — 40 findings across 29 tasks
- **Wave 3 — Main-flow bugs and data scoping** — 63 findings across 62 tasks
- **Wave 4 — Repo cleanup and test wiring** — 39 findings across 27 tasks
- **Deferred / fold into later waves** — 61 findings across 60 tasks
- **Total** — 246 findings across 215 tasks (all 246 audit findings represented exactly once)
- **Replace, don't patch (WOBO-PLAN §13)** — 141 tasks to fix · 74 were struck through as superseded, rebuilt in Waves 5 to 7. Re-read line by line against `f84e7bb` on 2026-09-04: **23 of those 74 are genuinely gone** (9 in Wave 3, 14 in Deferred) and **51 are not** — the claim was made for whole directories, but `apps/web-pwa/src/engines/` was never rebuilt, so its perf, purity and keyboard findings survived the label.
- **Whole file, after the 2026-09-04 reconciliation** — 409 task lines · 238 done · 171 open

<!-- AUDIT-SECTION-END -->

**Reconciled 2026-09-04** against the code at `f84e7bb` (Waves 6, 7a–7c, 8a, 8b, 8d committed). Sections re-read: Wave 3, Deferred, Wave 5, Wave 6, Wave 7, Wave 8. **64 lines moved to done** and **112 were annotated with what exists and what is still missing**; 65 were left exactly as they were. By section — Wave 3: 9 ticked, 28 annotated; Deferred: 14 ticked, 24 annotated; Wave 6: 12 ticked, 10 annotated; Wave 7: 29 ticked, 48 annotated; Wave 8: 0 ticked, 2 annotated; Wave 5: unchanged, its notes already matched the code. Every tick carries the file, line, route, test or migration it was read from. Two cautions for the next reader: a Wave 8e refactor was in flight and uncommitted while this ran, so some cited paths under `apps/web-pwa/src/screens/` (ProgressScreen, AdventureRoadmap, progress/*) are already moving; and the word "superseded" on an old audit line is not evidence — 51 of the 74 that carried it were still live defects.


## Wave 5 — The nervous system and the board

47 tasks · 31 done · 16 open (13 partial, 3 not started) — reconciled against `0fc3ef9` and `3d7baf6`, then again after the Wave 5b pass (interrupt, bidirectional, timeline, video handoff, voice, character rig v2 closed) and once more at the Wave 5b gate, which read each remaining partial against the code and found two already closed by that pass but never ticked (packet builder, equations); every tick carries its file or test

### 5.1 Surface registry (the screen sense)
- [x] **Registry contract** — `packages/wobo/src/registry.ts`: `registerSurface({ id, title, description, targets: [{ id, kind, label, rect(), actions: [{ name, description, inputSchema, run }] }] })`; WebMCP-shaped so `navigator.modelContext` can be adopted when Chrome ships it — done: `packages/wobo/src/registry.ts:346` (`registerSurface`), action shape at `:42`, `toModelContextTools()` at `:513` — test `registry.test.ts` 'emits WebMCP-shaped tools, namespaced by target'
- [ ] **Lifecycle** — register on mount, unregister on unmount; targets re-measure on scroll and resize; stable ids across renders — partial: `useSurface` (`registry.ts:641`) and `useTarget` (`:705`) register on mount and unregister on unmount; `ensureLayoutWatch()` (`:559`) throttles scroll, listens to resize and observes every element; ids held stable by `surfaceKey()` (`:628`) — class-level tests only ('registers and unregisters a surface', 'bumps the version on every change, so anchors re-measure') / no test renders either hook and nothing drives a scroll, resize or ResizeObserver event, so the re-measure path is unproven
- [x] **Screens registered** — home thread (stops, composer, chips, doors), Learn grid, Subject and chapters, Course players (cards, beats, continue), Practice, Progress (twin), You (profile, board and class pickers, settings), Onboarding, Command palette, the plane itself, Download center — done: every one of the twelve named areas registers, mirrored into the registry by `apps/web-pwa/src/wobo/bus-bridge.ts:131` (mounted `Stage.tsx:64`, root `App.tsx:940`) — home thread/composer/chips/doors `Home.tsx:154-175`, Learn `Learn.tsx:493`, Subject `SubjectScreen.tsx:796`, Course `Course.tsx:106` + `course/shared.tsx:158`, Practice `Practice.tsx:308`, twin `ProgressScreen.tsx:65`, You + pickers + settings `You.tsx:969-1017`, Onboarding `Onboarding.tsx:239`, palette `CommandPalette.tsx:132`, the plane `Stage.tsx:156`, Download center `DownloadCenter.tsx:62` — test `bus-bridge.test.ts` 'registers the whole screen, and the registry can call through it'
- [ ] **Engines expose targets** — every interactive publishes its semantic parts (axes, points, sliders, molecules, labels, cells, map regions) as targets with live state; fixes the seven unattached scene refs from the audit — partial: 24 of 26 engine files register a target carrying live state through `getSceneState`/`getValidActions`/`applyTutorAction` (surfaced as `value` and a `set_state` action by `bus-bridge.ts:58`), which closes the seven unattached scene refs / the semantic PARTS are not addressable — each engine registers one whole-scene target with axes, sliders, cells and regions flattened into a state string (`MathScene.tsx:443`, `MapScene.tsx:376`, `MiniWorkbook.tsx:714`); only `ConceptMap.tsx:130` exposes a target per node
- [x] **Registry snapshot** — a serialiser that produces the "what is on screen" part of the context packet in under 2 KB, with truncation rules — done: `buildSnapshot()`/`fitSnapshot()` at `registry.ts:197`/`:231` against `SNAPSHOT_BYTE_BUDGET = 2048` (`:120`) with a six-rung truncation ladder (`:219-299`) — test `registry.test.ts` 'fits the 2 KB screen budget for a genuinely crowded screen' and 'drops descriptions before it drops targets'
- [x] **Dev inspector** — an overlay (dev only) that shows registered targets and their ids for QA — done: `RegistryInspector` at `registry.ts:768` draws every live target rect with its id and a `data-wobo-inspect` hook, gated by `inspectorEnabled()` (`:754`), mounted at `Stage.tsx:137` — test `registry.test.ts` 'is off unless a developer turns it on'. Note: runtime-flag-gated, not build-gated, so it ships in the production bundle switched off

### 5.2 Gesture layer (the gesture sense)
- [x] **Transparent gesture layer** over the whole app: text selection, cursor lasso (freehand circle), hover-and-hold, long-press on touch, two-finger circle on touch, desktop hotkey (hold to talk) — done: all six gestures in `packages/wobo/src/gesture.tsx` — selection `:473`, lasso `:411`, hover-hold `:437` (700 ms), long-press `:395` (550 ms), two-finger circle `:385`, hold-to-talk chord `:513`/`:66`; layer is `inset:0` with `pointerEvents:'none'` (`:623`), mounted `Stage.tsx:110` under `App.tsx:940` — tests `gesture.test.ts` 'defaults to alt and space', 'catches only the targets whose centre is inside the loop'. Scoped off in-flow by `App.tsx:943`, and the pointer gestures are proven by code, not by a driven test
- [ ] **Focus object** — `{ kind, targetIds[], text, numbers[], rect, ownerState, screenshotFallback? }` computed from `elementsFromPoint` and the registry; never a screenshot for our own UI — partial: every named field present at `packages/wobo/src/focus.ts:41-66` (kind, targetIds, text, numbers, rect, ownerState) with numbers derived from text and never taken on trust, resolved through `elementsFromPoint` at `registry.ts:458` and never a screenshot — tests `focus.test.ts` 'derives its numbers from its text and never takes them on trust', 'collects the live values of the hit targets only' / `screenshotFallback` does not exist anywhere in the repo, so the seam the vision fallback (5.7) would fill is absent
- [x] **Focus affordance** — a quiet chip near the focus ("ask Wobo about this"); the orb leans toward it; escape clears — done: chip button 'Ask Wobo about this' at `gesture.tsx:695` positioned by `chipPosition` (`:754`), orb leans via `focus` → `tracking.ts:84`, Escape clears at `gesture.tsx:517` — tests `gesture.test.ts` 'sits just under the focus' / 'flips above when the focus is at the bottom edge' and `tracking.test.ts` 'puts the focus region above everything else'
- [ ] **Learner ink capture** — strokes drawn by the learner become focus objects with their geometry; stylus pressure on tablets — partial: a finished stroke becomes a focus object carrying its path, box and the targets it crossed (`board/renderer.tsx:1058` → `Stage.tsx:76` `createFocus({kind:'ink', path, targetIds})`), and stylus pressure IS read at `renderer.tsx:1001` / pressure dead-ends — it is never forwarded to `FocusObject`, the packet or the ink weight (fixed `weight: 1` at `renderer.tsx:1050`); capture is on for the plane and full board only, so a learner cannot draw over an ordinary app screen; no test asserts a stroke produces a focus
- [x] **Accessibility** — every gesture has a keyboard path (select with keyboard, then hotkey); focus objects announce to screen readers — done: selection bound to `keyup` as well as `mouseup` (`gesture.tsx:496`) so shift+arrow then the hotkey reaches the same chip; the chip is a real `<button>` (`:696`); visually-hidden `aria-live="polite"` announces `describeFocus()` (`gesture.tsx:681`, `focus.ts:397`); keyboard pen at `renderer.tsx:1069` — tests `focus.test.ts` 'announces itself in Wobo's voice: sentence case, no emoji, no exclamation' and e2e `board-reach.spec.ts` 'arrows move the pen, space puts it down and lifts it' / 'new ink is announced as it lands'

### 5.3 Context packet and the `wobo.turn` seam
- [x] **Packet builder** — focus + registry snapshot + route + task state (beat, attempt, score) + learner mind summary (mastery band for the current topic, recent mistakes, preferred analogy, consent tier, plan) + last N turns, under a token budget with priority truncation — done: the builder was always complete — every named input typed at `packages/wobo/src/packet.ts:58`, `MAX_TURNS = 6` (`:99`), a fourteen-rung priority truncation ladder (`:156-291`), tests `packet.test.ts` 'fits the 6 KB total budget on a crowded screen', 'sheds the conversation before it sheds the screen', 'keeps the focus to the very end — it is what they asked about' — and the production feed now FILLS it (Wave 5b): `mindFrom()` (`apps/web-pwa/src/wobo/capabilities.ts:296`) emits band, topic, mistakes, analogy, consent tier and plan, reading the last two off what `GET /v1/me` said through `noteAccount()` (`:274`, called at `App.tsx:439`) and the first from `preferredAnalogy()`; `taskFrom()` (`:321`) reads beat/of, attempt and score off the LIVE registry targets rather than a number the app remembered, and `buildTurnPacket` (`:363`) merges an explicit `options.task` over it, so no caller can forget to say which beat it is on. Tests `packet-seam.test.ts` 'digests the whole mind §5.3 asks for — analogy, consent tier and plan included', 'carries the world the learner asked for and the door the brain opened, on the real feed', 'tells the brain where in the task they are — the beat, the attempt and the score', 'sends no task state at all where the screen has none' — the old three-field assertion is gone
- [x] **Turn protocol** — `wobo.turn` streams a mixed sequence of `say`, `ink`, `action`, `ask`, `card` events; ordering guarantees; cancellation on interrupt; resume after network loss — done: say/ink/action/ask/card/done all routed at `apps/web-pwa/src/wobo/board-stream.ts:143-195`; ordering enforced server-side (`board/stream.py:259`, test `test_events_are_ordered_and_done_is_last`); cancellation at `board-turn.ts:152`; resume replays the tail from `last-event-id` free of charge (`board-turn.ts:286-317`, `app.py:510` before `budget.charge`) — tests `board-conductor.test.ts` 'resumes from the last frame that landed rather than asking again' and `test_board_route.py::test_a_resume_costs_nothing_and_replays_the_tail`
- [x] **Interrupt** — the learner can stop Wobo mid-sentence (tap, key, voice); ink stops with the voice; partial board state stays — done: one call lifts the pen, stops the utterance and aborts the stream while partial ink stays (`board-turn.ts:152-164`) — test `board-turn.test.ts` 'the pen lifts where it is on an interrupt, and ink that had not begun never lands'; tap and key are bound at `App.tsx`; and the third path, TRUE VOICE BARGE-IN, now closes with them — `bargeIn()` (`wobo/voice.ts:66`) stops every audio source AND calls `hand.interrupt()`, and it is the `interrupted` frame's own handler (`:396`) rather than a function nobody calls — tests `voice.test.ts` 'lifts the pen with the voice — one interruption, both halves', 'is what the relay frame actually reaches — not a function nobody calls', 'an interrupted frame stops there — no audio, no transcript, no turn close'. Note: the tap and key listeners are still asserted only at the call site, never by driving a real pointerdown or keydown.
- [ ] **Latency budget** — first speech under 1.5 s on a cheap Android phone over 4G; first stroke under 1 s; measured, not assumed — partial: FIRST STROKE IS NOW MEASURED ON THE MACHINE THE LAW NAMES — `apps/web-pwa/tests/board-latency-throttled.spec.ts` throttles the CPU 4x and puts the network on Chrome's Slow 4G preset through CDP *before* the first navigation, so module fetching, mount, measure, geometry and paint all happen on the slow machine, and holds the same unmoved `FIRST_STROKE_BUDGET_MS = 1000`: 'the pen still starts within a second on the heaviest board' (timeline, 148 ms cold at 4x CPU / Slow 4G) and 'and holds across every golden board, not just the heaviest' (all twelve, 12-49 ms), with the desktop reading kept alongside in `board-latency.spec.ts`; both of the law's numbers are printed on every run, pass or fail (`report()`) / FIRST SPEECH IS STILL NOT MEASURED — `FIRST_SYLLABLE_BUDGET_MS = 1500` is asserted by 'the voice speaks within a second and a half in mock mode', but the bench does not publish `firstSyllableMs` (`apps/web-pwa/src/wobo/board-bench.tsx` exposes `firstStrokeMs` and `firstMarkFromLoadMs` only), so that test SKIPS with the reason written out rather than passing on a number nobody took. The harness is ready; the seam it reads is the remaining work.

### 5.4 Ink renderer and the board grammar
- [x] **Grammar v1** — marks: point, circle, underline, arrow, bracket, strike, number, write, erase, wipe; shapes: line, polyline, curve, polygon, ellipse, axis, grid, table, label, tex, bond, atom, region; each with an id, anchor, style, and timing — done: all ten marks (`board/schema.ts:306`) and all thirteen named shapes (`:319`, plus `image` and four controls = 28 kinds), each carrying id/anchor/style/timing from one shared `common` block (`:101`); four anchor forms at `:50`; generated Python mirror `wobo_gateway/board_schema.py` — tests `schema.test.ts` 'covers every mark, shape and control BOARD.md §2 names', 'accepts all four anchor forms', 'rejects an object with no anchor — nothing is placed by pixels' and `codegen.test.ts` 'the committed Python mirror is current'
- [x] **Streaming plan protocol** — plan chunks interleaved with speech; renderer draws ahead of speech; a plan chunk can reference earlier ids — done: plan chunks interleave with speech and the pen leads it by `INK_LEAD_MS = 120` (`board/stream.py:48`, enforced `:218`); a chunk may anchor to an earlier id (`{object: id}` at `anchors.ts:202`, validated against ids already drawn at `planner.py:225`) — tests `board-stream.test.ts` 'routes every event of the protocol', `schema.test.ts` 'parses every event in the streaming protocol', and the golden build gate 'the first stroke lands after the first sentence'
- [ ] **Renderer** — one SVG layer; pen physics (anticipation, overshoot, settle); chalk and marker aesthetics per theme; the pen sound; ink that fades; eraser swipe; a fresh board; reduced-motion path draws instantly — partial: one SVG layer (`renderer.tsx:1155`), pen physics (`pen.ts:134`, test 'anticipates before the stroke and overshoots past its end'), a real WebAudio pen sound (`pen.ts:323` `penTick`, called `renderer.tsx:958`, muted with Wobo's voice), fading ink, eraser swipe and wipe (`geometry.ts:464`/`:483`), fresh board (`store.ts:301`) and reduced-motion instant draw (e2e `board.spec.ts` 'everything still lands, in the same order') / the chalk-vs-marker difference is thinner than stated: `--wobo-nib:2.6` is declared for dark at `renderer.tsx:117` but never read — width comes from the constant `NIB_PX = 2` (`:639`) — so the theme reduces to inverted tokens plus 0.86 opacity; and `penTick` has no test
- [x] **Anchoring** — every stroke anchored to a registry target or a learner-circled region; survives scroll, resize, theme change, and layout shift — done: `resolveAnchorBox` (`board/anchors.ts:187`) resolves all four forms and yields no box rather than a NaN one, so a mark whose target is gone fades instead of floating; scroll (capture listener `renderer.tsx:762`), resize (`ResizeObserver` + window resize `:759`) and layout shift all re-measure per frame because target rects are live thunks, keyed by `anchorSignature` (`anchors.ts:237`); theme survives by construction — ink is a CSS role, never a literal — tests `anchors.test.ts` 'a target anchor follows the target rect', 'a mark whose target is gone resolves to nothing — it never floats' and `board-turn.test.ts` 'follows the target it was drawn round, keeping the shape Wobo drew'
- [x] **Handwriting** — Caveat glyph-to-stroke so `write` genuinely writes, paced to speech; the two-word-first-sentence rule preserved for TTS — done: Caveat outlines flattened to ordered pen contours and written under a moving nib mask (`board/handwriting.ts:51`, `:164`, `:234`, `renderer.tsx:269`), paced on the same utterance clock as the strokes (`store.ts:116`) — tests `handwriting.test.ts` 'a letter has a fill and a traceable pen path', 'orders contours top band first, then left to right', `renderer.test.ts` 'shares the object's draw time across everything it has to draw', `store.test.ts` 'times ink from the start of the utterance, not from when the frame arrived', and the short-opener rule at `speech.test.ts` 'keeps the intro's short opening sentence as its own beat (first audio stays fast)'
- [x] **Equations** — `tex` rendered to paths and written stroke by stroke, not revealed — done: `tex` is genuinely written stroke by stroke, never revealed (`handwriting.ts:959` `layoutTex` → the same moving-mask writer), covering `^`, `_`, `\frac`, `\sqrt`, grouping, function names and the symbol table at `:681`, with a hand-drawn glyph for anything Caveat lacks and a visible box as the last resort — tests 'a fraction gets a ruled bar and stacks its parts', 'subscripts sit below and superscripts above the same base', 'every symbol the TeX subset maps to is one Wobo can draw'; and matrices now write as matrices (Wave 5b) — `MATRIX_FENCES` (`:689`) is the table of `\begin{...}` environments a school board writes (pmatrix→parens, bmatrix→brackets, Bmatrix/cases→braces, vmatrix/Vmatrix→rules), laid out as real rows at `:939` with its delimiters chosen at `:980`, an unknown environment degrading to bare rows rather than to its own name, and `texPlainText` (`:1329`) stripping `\begin`/`\end` as structure so even the no-font fallback line cannot write the word; `\sqrt[3]{x}` wears its index on the radical (`:780`, `:1336`) instead of leaking brackets. Tests `handwriting.test.ts` 'writes a real matrix — brackets and rows, never the environment name', 'never writes the environment name in the plain line either', 'gives each environment its own fence, and an unknown one no fence at all', 'an unterminated environment is still only its contents', 'a stray \end writes nothing at all', 'a cube root wears its index, and never its brackets'
- [x] **Layout engine** — places objects on the plane and the full board so nothing collides; label margins; auto-scroll and zoom when the board fills — done: `placeLabel`/`placeLabelAt` take the first free side then push down the margin (`board/layout.ts:16`, `:64`, `:98`) with an `occupied` list threaded through every written object (`geometry.ts:240`); `fitCamera` fills 70-85% of the box and `easeCamera` glides to it (`layout.ts:226`, `:259`), on for the plane and full board — tests `layout.test.ts` 'pushes down the margin when every side is taken', 'nudges a clash downward and keeps reading order', 'zooms out when the ink has outgrown the view' and `board-polish.test.ts` 'follows a whole golden board as it grows, and never crops it'
- [x] **Object memory** — re-point, move, fade, redraw any earlier object by id within a session; Wobo can say "this one" and tap it — done: six patch kinds — fade, remove, redraw, repoint, move, restyle (`schema.ts:391`, applied `store.ts:249`) — never rewriting the original object; 'this one' is a real `{object: id}` reference validated server-side (`planner.py:225`) and tapping it is a mark anchored to that id — tests `store.test.ts` 'fades one by id', 'redraws one: the pen genuinely goes again', 'repoints one at something else without rewriting the object', 'ignores a patch for an id that was never drawn'. The `move` patch alone has no test of its own
- [x] **Bidirectional** — the learner draws on the same layer; Wobo reads their ink; moving Wobo's tangent updates the numbers — done: the learner draws into the SAME store on the same layer with palm rejection and a keyboard pen (`renderer.tsx:994`, `:1075`; e2e `board-reach.spec.ts` 'arrows move the pen, space puts it down and lifts it'), Wobo READS it — the finished stroke becomes a focus carrying its path and the targets it crossed, serialised into the packet (`renderer.tsx:1058` → `Stage.tsx:77` → `packet.ts:133`, test `packet-seam.test.ts` 'picks up the focus the gesture layer last made') — AND moving the tangent now updates the numbers: `changeVariable()` (`apps/web-pwa/src/wobo/variables.ts`) moves the handle at once, then asks the BRAIN to recompute everything that declared `depends` on it (`board-stream.ts:113` carries `changed` and `recompute`), supplied for real at `App.tsx:946` `onVariableChange` and threaded through `Stage.tsx:132`/`:233` to both the plane and the full board; the tangent golden emits a real control (`goldens/tangent-parabola.json`, `goldens/build.ts`) — tests `variables.test.ts` 'moving the handle moves the tangent and changes the numbers under it', 'the handle follows the finger even before the brain answers', 'a brain that cannot be reached leaves the board honest, not invented', 'an unverified number the brain sends never reaches the board', and e2e `board-controls.spec.ts` 'moving the handle moves the tangent, and the numbers under it'
- [x] **Timeline and export** — scrub a board's history; save to notes; export as a shareable image (the proof loop) — done: save to notes stores objects and never pixels (`board/export.ts:140`, `store.ts:330`, tests 'saves objects and a title, never pixels', 'round-trips a board') and the shareable PNG bakes its own theme tokens, wordmark and caption (`export.ts:70`, tests 'carries its own size, paper and ink tokens', 'exports on slate as well as on paper'); and scrubbing now actually scrubs — `boardAt` is no longer a tested function with no callers: the full board passes `at: timeline.at` down while the handle is held (`board/fullboard.tsx:66`) so the surface renders the board as it WAS, and 'live' hands it back — e2e `board-controls.spec.ts` 'the handle shows the board as it was, and "live" hands it back', driven through the bench's own chrome (`board-bench.tsx`, `#board-bench/<name>/chrome`)
- [ ] **Performance** — thousands of strokes at 60 fps on a cheap phone; virtualised history; GPU-friendly transforms only — partial: the budget is measured, not assumed — `board-frames.spec.ts` holds 2,000 strokes at a 55 fps floor with p95 frame time under 33 ms on a 4x CPU-throttled machine, in both 'holds 2,000 strokes AND a mark on the screen at 55 fps on a 4x slower machine' and 'holds 2,000 board-anchored strokes...'; history is virtualised (`store.ts:68` `RENDER_BUDGET`, `:157` `renderable()`, log capped at `MAX_LOG`, tests 'paints only the newest N, and keeps the rest') / 'GPU-friendly transforms only' is not what ships: the camera animates the SVG `viewBox` (`renderer.tsx:1159`), drawing animates `stroke-dashoffset` (`pen.ts:250`) and the plane drags via `left/top/width/height` (`plane.tsx:369`) — layout and paint properties, not compositor transforms

### 5.5 Three presentations
- [x] **Ink on the screen** — over any surface, including a paused video (our videos expose frame state from the scene spec at the paused timestamp), a syllabus outline, a setting, a sim; fades — done: the screen surface is mounted over every route (`Stage.tsx:121` under `App.tsx:940`) and a paused film genuinely exposes its frame state from the scene spec — `frameSurface()` publishes `{atMs, step}` plus one target per identified element in the paused frame (`wobo/video.ts:86`, `:68`), registered only while paused (`MotionPlayer.tsx:246`); syllabus, settings and sim surfaces are ordinary registry targets; screen ink fades on a 6 s TTL (`store.ts:58`) — tests `video.test.ts` 'carries the frame own sentence, so the brain knows what it is looking at' and `store.test.ts` 'screen ink fades after the utterance; a board keeps what it holds'
- [ ] **The plane** — frosted overlay board sliding in from the orb; drag, resize, pin, minimize to thumbnail with ink intact; sheet on phones; summon by gesture or the word "board"; ink persists until wiped; multiple boards per session; "fresh board" — partial: frosted overlay sliding from the orb origin with drag, resize, pin and minimise to a thumbnail that renders the same store so the ink stays intact (`board/plane.tsx:371`, `:288`, `:306`, `:174`, `:490`), a phone sheet at `:206`/`:367`, ink persisting until wiped, multiple boards per session capped at eight (`BoardBook` `:22`, tests 'never holds more than a handful, and never evicts the one on screen', 'drops the oldest EMPTY board before it drops one with ink on it') and 'fresh board' by word (`App.tsx:630`, test 'hears a fresh board, a wipe and a dismissal, and never confuses them with a summons') / summoning BY GESTURE does not exist — nothing in `gesture.tsx` calls `plane.summon`, whose only callers are the palette, the word path and the bench — and summoning by the word 'board' runs through the board turn, which `App.tsx:683` gates on a gateway being configured; pin, minimise-with-ink and the phone sheet have no test
- [ ] **The full board** — inside lessons, full-bleed; the course player becomes a board with cards as regions — partial: the full-bleed board exists with scrubber and share chrome (`board/fullboard.tsx:32`) and takes the screen when the presentation resolves to 'full' with ink on it (`Stage.tsx:184`, Escape and a 'back to the lesson' button at `:198`/`:223`) — test `presentation.test.ts` 'a lesson is the full board and stays there' / the course player is not absorbed: the board is a `position:fixed` overlay above a still-mounted `Course.tsx`, and cards are NOT regions — the lesson card is a registry target of kind 'card' (`Course.tsx:106`), while the grammar's `region` (`schema.ts:251`) is only ever produced by a streamed plan; nothing converts one into the other and no test mounts the full board inside a real lesson
- [x] **Presentation choice** — Wobo's rule (pointer or one line on screen; derivation or diagram on the plane; lesson on the full board) plus learner override by word or gesture — done: Wobo's rule is `PresentationChoice.offer` (`wobo/presentation.ts:96`) — a pointer or one line stays on screen under `SCREEN_OBJECT_LIMIT = 3`, anything drawn from scratch goes to the plane (`:36`), a lesson goes to the full board (`:123`) — and the learner's word overrides it in both directions and locks (`:118`, `:202`, wired `App.tsx:478` → `board-turn.ts:167`) — tests `presentation.test.ts` 'keeps a pointer or one line on the screen', 'moves to the plane the moment a diagram from scratch arrives, however few objects', "the learner's word wins over Wobo's rule, in both directions" and `board-conductor.test.ts` 'keeps the mark on the screen and opens the board for the diagram'. Override is by word only; there is no gesture that names a surface
- [x] **Video handoff** — pause, ask, Wobo annotates the frame or opens the plane beside it, then returns the learner to the paused position — done: pause registers a hold with the exact resume callback and the learner is put back to the millisecond (`wobo/video.ts:146`, `MotionPlayer.tsx:321`, 'back to the film' at `Stage.tsx:319`), and annotate-vs-plane follows the presentation rule (`presentation.ts:71` keeps the ring on the paused frame while a from-scratch diagram opens the plane) — tests `video.test.ts` 'holds the paused position and puts the learner back on it, to the millisecond', 'releases when the film plays again — nothing stale is ever returned to'; and the baked-MP4 break is fixed at the root — the `scene.renderedUrl` case is now its own `RenderedFilm` component rather than an early return from inside the scene player, so the film's own `<video>` clock is what the hold records and what the seek drives (`holdFilm()`, `wobo/video.ts`) — tests `video.test.ts` "puts the learner back by the video's own clock, in seconds", 'reads the position off the element when it is not told one', 'asks for the element at resume time, not at hold time — the player can re-render under it', 'a film that has gone is not a crash — there is simply nothing to put back'

### 5.6 Domain pipelines under the grammar
- [ ] **Math** — axes, curves, tangents, constructions with visible compass arcs, number lines, long division, area models, derivations line by line with the substituted step underlined — partial: `board/pipelines/math.py` draws axes (`:46`), curves (`:114`), tangents whose slope is taken symbolically AND by central difference and must agree (`:138`), constructions with visible compass arcs (`:277`, `:313`), number lines (`:187`) and line-by-line derivations with the step underlined (`:226`) — tests `test_board_pipelines.py::test_golden_board`, `::test_the_tangent_is_refused_outside_the_graph`, `::test_a_derivation_with_a_broken_step_is_refused` / only four ops exist (`:24`): there is no long-division and no area-model op — long division exists solely as a hand-authored golden fixture (`goldens/build.ts:494`) with no pipeline behind it, and 'area model' appears nowhere in the repo. The underline is applied to every step, not selectively to the substituted one
- [x] **Physics** — free-body diagrams with forces appearing as named, projectiles with decomposed components at the apex, circuits symbol by symbol, ray diagrams through lenses, waves with wavelength brackets — done: all five in `board/pipelines/physics.py` — free-body diagrams that refuse an unnamed force (`:74`, `:68`), projectiles decomposed at an apex cross-checked closed-form against the sampled trajectory (`:134`, `:158`), circuits built symbol by symbol and checked against Kirchhoff (`:215`, `:239`), ray diagrams whose image distance is proved by the CAS (`:290`, `:309`) and waves with a labelled wavelength bracket (`:363`, `:399`) — tests `test_board_pipelines.py::test_golden_board` over all five prompts, plus `test_board_golden.py::test_the_projectile_apex_agrees_from_two_directions` and `::test_the_series_circuit_obeys_kirchhoff`
- [ ] **Chemistry** — molecules from SMILES via RDKit in a chemist's stroke order, benzene alternation, titration curves, orbital sketches, equation balancing with ticking coefficients, electron dot diagrams — partial: molecules are laid out ring-skeleton-first in a chemist's stroke order with benzene alternating 1/2/1/2/1/2, and equation balancing is SOLVED by nullspace in the verifier then re-proved, with coefficients ticking in at 420 ms (`board/pipelines/chemistry.py:301`, `:337`, `:347`, `:395`) — tests `test_benzene_alternates_and_is_drawn_ring_first`, `test_balancing_is_solved_not_asserted` / RDKit is NOT a gateway dependency — it appears only as an optional `ImportError`-guarded path marked `pragma: no cover` (`:194`) and is declared in no pyproject, so SMILES parsing and layout are hand-rolled (`:55`, `:211`); and only two ops exist (`:43`) — no titration op (the titration curve is a hand-authored golden only), no orbital sketches, no electron dot diagrams
- [x] **Biology and social science** — labelled cells, food webs with energy-direction arrows, timelines, shaded maps, Punnett squares filled one cell at a time — done: all five in `board/pipelines/bio_social.py` — cells labelled from a curated parts table that refuses an unknown part (`:85`, `:93`), food webs whose arrows point where the energy goes and which refuse a cycle (`:134`, `:186`, `:157`), timelines refusing two events in one year (`:273`, `:295`), maps shaded through `verify_map_scene` and refused if it fails (`:316`, `:336`) and Punnett squares written one cell at a time from the verifier's own cross (`:225`, `:247`) — tests `test_board_pipelines.py::test_food_web_arrows_point_up_the_levels`, `::test_a_web_that_eats_itself_is_refused`, `::test_punnett_ratio_comes_from_the_verifier`, `::test_timeline_refuses_two_events_in_one_year`, `::test_cell_labels_come_from_the_curated_parts_list`
- [x] **Verification** — every quantity through CAS, dimensional analysis, and balance checks before it is drawn; a failed check redraws or refuses, never serves — done: SymPy (a real dependency, `services/verifier/pyproject.toml:8`) runs in a spawned wall-clock-bounded sandbox (`board/verify.py:81`, `:144`), with dimensional analysis (`:250` → `plexus/dimensions.py:266`) and balance checks (`:262`, `:274`); the gate blocks in three layers — `Ledger.record` raises `Unverified` (`:57`), the planner redraws once then DROPS the objects and refuses (`planner.py:190-203`), and a visible numeral may only name a check that actually ran (`planner.py:266`, `schema.py:393`) — tests `test_board_planner.py::test_a_board_that_fails_twice_is_refused_and_never_served`, `::test_a_model_object_naming_a_check_that_did_not_run_is_refused`, `test_board_golden.py::test_no_number_is_drawn_unverified`, `test_board_number_law.py::test_a_model_authored_table_of_numbers_never_reaches_the_board`. Each quantity takes the checks appropriate to it rather than all three, and the fact-base check on cell labels advises rather than blocks (`bio_social.py:96`)
- [x] **Golden boards** — a regression suite of prompts with expected board outcomes (structure, not pixels) for every pipeline — done: exactly twelve boards, three per family (`goldens/manifest.json`), run by two structure-not-pixel suites — `services/gateway/tests/test_board_golden.py` (`test_there_are_twelve_boards_across_the_domains`, `test_nothing_is_placed_by_pixels`, `test_a_reference_always_points_backwards`, `test_every_number_on_the_board_is_recomputed_here_and_agrees` against an independent recomputation table) and `apps/web-pwa/tests/board.spec.ts` ('there are twelve of them, across the four families' and per-board 'Wobo draws it, anchored, in order'). The pipelines themselves are covered separately by the twelve-prompt `test_board_pipelines.py::test_golden_board`, since the twelve fixtures are hand-authored in `goldens/build.ts` rather than generated by running the Python pipelines

### 5.7 Companion modes and hands
- [x] **Wobo character rig v2 (design)** — the ink visor wobot: black body + white visor in light, inverted in dark, ultramarine eyes and pen tip; six states (idle, listening, thinking, drawing, celebrating, resting) with squash, lean, blink and eye-tracking; hairline rim for legibility over any content; app icon and favicon regenerated; DESIGN.md/DECISIONS.md amended to retire the molten body colour — done: the rig is the ink-visor wobot — a deep-navy ink body carrying a cream visor in light, inverted on night, Wobo-blue eyes and pen tip (palette v4), all six states (`body/expressions.ts:59-108` plus `resting`→`sleepy` at `:224`), squash about the base, lean, blink and eye-tracking (`WoboBody.tsx:219`, `:882`, `body/tracking.ts:24`), a half-pixel hairline rim (`WoboBody.tsx:1035`, `:1108`), and the favicon and all four PWA icons regenerated in `0fc3ef9`; AND THE LAW IS NOW AMENDED TO MATCH — `DESIGN.md` §2 carries palette v4 and §4 describes the ink-visor body in the exact hexes the rig renders (`#14142B`/`#F3F0E8` body, `#FAF7F0`/`#0F1226` visor, `#2B45FF`/`#7C8CFF` eyes and pen), `DECISIONS.md` carries the 2026-09-03 'Palette v4 retires the molten body' entry superseding the 2026-07-06 reservation, and the identity lock in code is the ink-visor one: `packages/wobo/src/identity.ts` exports `WOBO_TONES`/`WOBO_BLUE` with `form: 'ink_visor_wobot'` and no warm hex anywhere, while `body/palette.ts` READS those tones instead of restating them — tests `identity.test.ts` 'carries palette v4 exactly as DESIGN.md §2/§4 writes it', "is the source of the rig's default colours — the rig restates nothing", 'is gone from every hex in the package', 'is gone from every identifier and string in the package' (a comment-stripped scan of every source file in `packages/wobo/src`), 'is not signalled anywhere in the identity lock or the rig it drives' (WOBO-PLAN §19), plus `body/palette.test.ts` 'is the identity lock itself, not a second copy of it'; every one of them fails on the pre-v4 module, which exported `round_squircle_jelly` in a `molten` family
- [x] **Show me** — a visible cursor glides to the real control, taps, narrates, via the registry; works on every registered screen — done: `showMe()` resolves the control through `registry.getTarget`, glides a visible cursor to it, taps via `registry.callAction` or a re-read-rect real click, and narrates (`wobo/hands.ts:196`, `:236`); rendered as `<ShowMeCursor>` with an `aria-live` narration (`Stage.tsx:136`, `:388`), wired at `App.tsx:648`; because it goes through the registry it works on every registered screen — tests `hands.test.ts` 'presses the target itself when nothing is under the point it travelled to', 'says so rather than guessing when the target is not on screen at all', 'taps the middle of the control, where a person would', 'sets off, travels and settles — never a linear tween'
- [x] **Do it** — executes under the permission ladder (recommend, prepare, execute with permission, safe automatic); communicate, buy, submit, delete always ask — done: the four rungs are typed at `wobo/capabilities.ts:32`, and the always-ask set is code rather than prompt — `ALWAYS_ASK` (`wobo/hands.ts:22`) covers send/share/post/message/email/buy/pay/subscribe/checkout/submit/delete/erase/forget/reset, and `permissionFor` (`:33`) also returns `execute_with_permission` for anything unknown; the prepare rung is `armDoIt` with a 60 s expiry (`:59`), wired at `App.tsx:634` — tests `hands.test.ts` 'always asks before anything that communicates, buys, submits or deletes', 'asks when it is not sure — an unknown verb is never automatic', 'asks even when a harmless word sits beside a consequential one', 'expires rather than lingering as a trap', and e2e `wobo-capabilities.spec.ts` 'approval card: Wobo proposes starting practice, approve executes'
- [ ] **Explain this** / **why is this wrong** / **check my work** / **quiz me** / **say it in my world** (analogy) / **read it aloud** / **teach it back to me** — each a mode with its own prompt shape and board behaviour — partial: all seven modes exist with their own prompt shape and phrasing, each reachable by the words a child would use (`wobo/modes.ts:38` `MODES`, `:114` `PHRASES`, `:130` `modePrompt`, `:139` `PATTERNS`), wired through `App.tsx:610` and the command palette — tests `modes.test.ts` 'hears each mode in the words a child would use', 'prefers the more specific mode when two could match', 'names what is in hand for the modes that need it' / there is no PER-MODE BOARD BEHAVIOUR: the only board-facing field is one shared boolean `draws` (`modes.ts:34`), so nothing distinguishes what `quiz_me` draws from what `check_my_work` draws, no mode id reaches the gateway, and `teach_back` never calls the teach-back engine that exists at `Companion.tsx:155` — it sends an ordinary turn while the real engine is reachable only from a button
- [ ] **Watch me do one** — Wobo drives a sim with the cursor visibly, then hands over; first rung of the assistance ladder
- [x] **Proactive lean-in** — three wrong actions or forty idle seconds offers a pointer; governed by the quiet/balanced/proactive dial; never interrupts speech or typing — done: exact thresholds at `wobo/leanin.ts:34` — balanced `{misses: 3, idleMs: 40_000, cooldownMs: 90_000}`, `quiet` infinite on all three, `proactive` sooner; governed by the existing proactivity dial (`store/mind.ts:414`, no second store) and it never interrupts speech or typing (`leanin.ts:65`); wired to real signals on a 5 s tick at `Companion.tsx:318` — tests `leanin.test.ts` 'offers after three wrong actions on the balanced dial', 'offers after forty quiet seconds', 'is sooner on the proactive dial and never on the quiet one', 'never talks over themself, never interrupts typing, never doubles up on an open drawer', 'does not nag — one offer, then a long cooldown', and e2e `wobo-capabilities.spec.ts` 'proactivity dial: the chosen notch survives a reload'
- [x] **Voice** — push-to-talk on the orb and a desktop hotkey; accent by the learner's country with American English fallback; no always-listening; barge-in stops Wobo — done: push-to-talk on the orb opens the session only inside a hold and always releases the microphone (`Companion.tsx:246`, `wobo/voice.ts:170`), with no always-listening path — tests `voice.test.ts` 'opens the microphone first, then mints — never the other way round', 'no token, no session — and the microphone does not stay open', 'releases the microphone and reports cancelled when the hold ends during the prompt'; barge-in now stops BOTH halves (`bargeIn()` lifts the pen with the voice, `voice.ts:66`, `:396`); the desktop hotkey is no longer a pantomime — the chord reaches the same one live session through `registerHoldToTalk()` (`wobo/hold.ts`, registered at `Companion.tsx:274`, bound at `App.tsx:997`) — tests `hold.test.ts` 'opens and closes the same voice session Wobo body does', 'says so when there is no Wobo on screen to take the hold', 'an unmounted body takes no more holds — the hotkey never reaches a dead session', 'the newest mount is the live one, and unregistering the old one does not disarm it'; and ACCENT BY COUNTRY EXISTS, resolved in the brain from the verified token's own profile claims, never from a client string — `ACCENT_BY_COUNTRY` with `AMERICAN_ENGLISH = 'en-US'` as the fallback for any country Wobo cannot actually speak (`services/gateway/src/wobo_gateway/voice.py:98-125`), travelling as a line in the system instruction rather than a setup field so Wobo stays one voice — tests `test_voice.py` `test_the_one_shot_spoken_line_is_in_the_learners_own_english`, `test_a_learner_we_know_nothing_about_still_hears_american_english`, `test_the_accent_reaches_the_upstream_as_an_instruction_not_a_setup_field`
- [ ] **Memory page** — what Wobo remembers, set by consent tier, visible and erasable; erasure propagates to the brain — partial: the page lists what Wobo remembers with each item removable on its own and a clear-all (`screens/You.tsx:895`, `:1722`, `:1748`), republishing an empty dossier so the next turn reasons from a blank slate, and `forget_all` sits on the permission ladder as a card the learner must approve (`wobo/capabilities.ts:152`) — tests `forget-all.test.ts` 'is a capability on the permission ladder, not something a model reply can just do', 'leaves the memory untouched until the card is approved, then clears it' and ERASURE NOW PROPAGATES TO THE BRAIN: `forget_all.run` awaits `eraseFromBrain()` (`capabilities.ts:167`) so Wobo's line is the truth, and it knocks on the door the gateway actually serves — `POST /v1/me/erase` (`store/mind.ts` `ERASE_PATH`, corrected from a `/v1/memory/erase` that 404'd and left an erase queued forever), which empties the durable mind under the token's own subject and the cached generations keyed to it (`wobo_gateway/memory.py:151`, `:191`) — tests `test_me_erase.py` `test_erasing_is_not_a_way_to_refill_a_spent_day` / 'set by consent tier' is still not implemented — consent appears nowhere in the memory page or `store/mind.ts`
- [ ] **Vision fallback** — for content we did not make (a PDF, an embedded page) the circled region is read by a vision call; labelled as such
- [ ] **Engine absorption plan** — each existing engine mapped to board idioms; absorbed one at a time behind a flag without breaking lessons

## Wave 6 — Curriculum

### 6.1 Registry of boards and curricula
- [ ] **Re-verify syllabus provenance over verified TLS** — the writers' fetch tool skipped certificate verification (fixed 2026-09-03: verification on by default, per-host explicit opt-out recorded as tls_verified=false); re-fetch every 'verified' document with verification on, confirm document_sha256 matches, and downgrade any mismatch to provisional — PARTIAL: `discovery/freshness.py:155` re-fetches over default-TLS urllib and compares `document_sha256` / MISSING: a mismatch supersedes rather than downgrades to provisional, and no scheduler runs the check in production
- [x] **Data model** — `framework { id, name, aliases[], country, region, kind (national|state|international|open|homeschool|online), levels[], official_site, sources[] }` — `curriculum/models.py:172` `Framework` carries id, name, aliases, country, region, kind, levels, official_site; table in `infra/supabase/migrations/0008_curriculum.sql:34`
- [x] **Seed list** — national boards, every Indian state board, NIOS, IB (PYP/MYP/DP), Cambridge (Primary/Lower Secondary/IGCSE/A Level), Edexcel, AP, US states, UK nations, Australian states, Canadian provinces, Singapore, common homeschool programmes; drafted by Opus, verified by Sonnet against official sites — `content/curriculum/frameworks.seed.json` — 268 frameworks: 43 Indian state boards, NIOS, IB PYP/MYP/DP/CP, Cambridge, Edexcel, AP, US/UK/AU/CA, Singapore, 22 homeschool programmes
- [x] **Type-to-select search** — aliases, fuzzy matching, country hint from locale; "not listed? tell me" path always visible — `curriculum/store.py:117` `rank()`/`match_rank()` over aliases and substrings, `apps/web-pwa/src/curriculum/search.ts:133` `countryHint()`, and `curriculum/api.py:333` always returns the `not_listed` door
- [x] **Grades 4 to 13** per framework; school level only — `curriculum/models.py:25` `LEVEL_MIN=4`/`LEVEL_MAX=13`; `discovery/job.py:123` `SCHOOL_LEVELS`; `curriculum/api.py:391` `_check_level_band`

### 6.2 Ontology and versions
- [ ] **Schema** — framework → version (academic year) → level → subject → unit → topic → learning objective; provenance on every node (source URL, page, extracting model, verifier, verified_at); CASE export mapping — PARTIAL: the full framework→version→level→subject→unit→topic→objective ontology with per-node provenance is in `0008_curriculum.sql:112` / MISSING: no CASE (1EdTech) export mapping anywhere in the repo
- [x] **Immutable versions** — new academic year is a new version; never overwritten; learners pinned to a version with an offered upgrade — `0008_curriculum.sql:273` `refuse_published_edit` trigger plus `supersedes`; `curriculum/api.py:561` `_upgrade` offers the diff and carries the learner's overlay across
- [x] **Storage** — Supabase tables under a `curriculum` schema with RLS (read for all authenticated; write by service role); indexes for search — `0008_curriculum.sql:346` — RLS grants authenticated SELECT and service_role ALL, with trigram/GIN indexes for search; `curriculum/store.py` `PostgrestStore` reads it
- [x] **Move the catalog into the database** — replace `apps/web-pwa/src/data/catalog.ts` and the "frame" system with on-demand fetch; the client caches per framework version offline — `apps/web-pwa/src/data/catalog.ts` is deleted (only `data/model.ts` remains); `apps/web-pwa/src/curriculum/cache.ts` caches the pinned version offline; `screens/FrameBuilding.tsx:5` records the frame's removal
- [ ] **Concept graph mapping** — board topics map to canonical concepts so generated content is reused across boards; prerequisite edges kept — PARTIAL: `curriculum/concepts.py:461` `propose`/`attach_concepts` implements exact/proposed/minted mapping / MISSING: never called outside tests — `own.py:876` always writes `concept_ids: []`, and no prerequisite edges are stored

### 6.3 Discovery job
- [ ] **Web search and fetch capability** in the brain (one provider behind an interface; keys in env); PDF and HTML extraction — PARTIAL: `discovery/search.py:329` `NativeToolSearchProvider` behind one interface with env keys, and `discovery/fetch.py` does HTML and PDF extraction / MISSING: nothing in production calls `run_discovery` — `curriculum/api.py:94` records that no worker is scheduled
- [ ] **Extraction** — Opus turns an official syllabus into the schema; strict JSON; page references kept — PARTIAL: `discovery/extract.py:259` parses strict JSON and requires a `source_ref` page on every node / MISSING: the extraction pipeline has no production caller, only tests
- [ ] **Verification** — second-model cross-check; structural checks (chapter counts against the textbook table of contents, level coverage, duplicate detection); status `provisional` until passed — PARTIAL: `discovery/verify.py:340` runs nine structural checks plus a second-reader `cross_check`, and `report.ok` gates promotion out of provisional / MISSING: `verify_extraction` is reached only by tests
- [ ] **Promotion** — automatic when checks pass and two learners have used it without edits; owner review queue for anything flagged — PARTIAL: `discovery/job.py:634` `record_use`/`maybe_promote` (two clean uses)/`owner_review` implement the rule exactly / MISSING: none of the three are called from `curriculum/api.py` or the app — tests only
- [x] **Honest labels** — "Official CBSE 2026-27, verified" / "Found online, checking" / "Drafted from your syllabus, check it" — `curriculum/labels.py:26` holds the three exact strings and `curriculum/api.py:318` `_framework_block` calls `labels.label_for` on every served response
- [x] **Failure path** — nothing found within a time budget → own-syllabus path offered immediately — `curriculum/api.py:94` `discovery_worker_running` and `:456` `_discovery`, which refuses immediately and hands back the `not_listed` own-syllabus door on every miss

### 6.4 Own syllabus and edits
- [x] **Own syllabus path** — paste, type, photo (camera or upload), PDF; structured by Opus into a personal syllabus; the learner confirms — `apps/web-pwa/src/curriculum/OwnSyllabus.tsx:163` offers paste, camera, photo and PDF; `curriculum/api.py:758` `_own_read` calls `own.py` `read_paste`/`read_photo`/`read_pdf`/`structure`, with `_own_confirm` for the learner's confirmation
- [x] **Editable overlay** — add, remove, reorder, "not in my school", attach a textbook, rename; edits live on top of the canonical version and survive updates — `curriculum/overlay.py:41` defines the six ops, `apps/web-pwa/src/curriculum/OverlayEditor.tsx` is the UI, `curriculum/api.py:640` `_overlay_apply`, and `:606` remaps and reapplies the overlay across a version upgrade
- [x] **Community contribution** — optional offer to the global registry; moderated; credited anonymously — `curriculum/own.py:1047` `offer_to_registry` credits by `offered_by_hash` (anonymous); `curriculum/api.py:931` `_own_offer` writes a moderated `review_queue` row learners cannot read back

### 6.5 On demand
- [ ] **Lazy generation** — chapter list on selection, topics on open, content on open; cached and shared across boards through the concept graph — PARTIAL: `curriculum/api.py:412` `_units` and `:495` `_topics` generate the chapter and topic lists strictly on demand and cache them / MISSING: nothing is shared across boards — the concept graph is never populated (see the concept-graph line)
- [ ] **Freshness crawler** — scheduled job watches official pages, hashes documents, diffs new releases; Wobo tells the learner what moved — PARTIAL: `discovery/freshness.py:76` `due`/`due_records` and `:442` `run_freshness_check` implement the whole crawler, hashing and diffing documents / MISSING: no cron or worker calls it in production; only `test_discovery_freshness.py` does
- [ ] **First boards verified** — CBSE, ICSE, the seeded state boards, NIOS, then IB and Cambridge, then US and UK via their open APIs (Common Standards Project, Oak National Academy) — PARTIAL: `content/curriculum/syllabi/` carries real seeded content for CBSE, ICSE, ISC, NIOS and four state boards / MISSING: IB and Cambridge have framework rows but no syllabus content, and no Common Standards Project / Oak open-API integration exists

## Wave 7 — Experience

### 7.1 Landing page (**design**)
- [ ] **Chalk cursor with fading ink trace** — WebGL, silky at any frame rate; warms on headings; off on touch devices — PARTIAL: `screens/landing/cursor.tsx` draws a fading ink trace and is off on touch and under reduced motion (`:44`) / MISSING: it is Canvas2D, not WebGL (`:122` `getContext('2d')`), and it does not warm on headings
- [ ] **Wobo hero** — real-time jelly orb in a shader; weight and squash; eyes follow the cursor; blinks; falls back to a static image on weak devices — PARTIAL: the body rig blinks, gazes and squashes with spring physics (`packages/wobo/src/body/**`, `WoboBody.tsx`) / MISSING: it is an SVG rig, not a real-time shader orb, and there is no static-image fallback for weak devices
- [ ] **Scroll-driven lesson** — Wobo draws as you scroll: a triangle, self-labelling angles, a derivation down the margin, a molecule assembling; pinned sections; the visitor controls the pace — PARTIAL: `screens/landing/lesson.ts:38` draws the triangle and the margin derivation, pinned and scrubbed by `screens/landing/scroll.ts` / MISSING: the molecule assembling, and the angles self-labelling
- [ ] **Live mini-board** — type a prompt and watch Wobo draw, on the page, before sign-up; rate-limited through the brain's anonymous budget — PARTIAL: `screens/landing/sections/Ask.tsx` + `ask.ts` answer a typed prompt, and `BoardFrame.tsx` plays real board goldens / MISSING: the typed prompt does not drive a live drawn board, and no anonymous budget rate-limits the page
- [ ] **Story sections** — every board on earth (a globe of frameworks); the parent's weekly artifact; how it's free; pricing annual-first (dummy values until real); the invitation — PARTIAL: `screens/landing/sections/` carries the framework globe, the parent's weekly note and the invitation / MISSING: pricing is not on the page at all — `screens/landing/copy.ts:10` records that the numbers are deliberately withheld
- [x] **Copy** — outcome-led, calm, certain; sentence case; no exclamation marks — `screens/landing/copy.test.ts` enforces sentence case and refuses an exclamation mark; the same law is held for the site by `screens/site/styles.test.ts` and for the pitch pages by `screens/pitch/styles.test.ts`
- [ ] **Performance** — lazy-loaded effects, under 1 MB before interaction on a cheap phone, reduced motion honoured, Lighthouse 90+ on mobile — PARTIAL: every screen is a lazy route chunk (`App.tsx:122` onward) and `screens/landing/scroll.ts` gates the effects on visibility / MISSING: no measured byte budget and no Lighthouse assertion — the 1 MB and 90+ numbers are unproven
- [ ] **SEO and sharing** — titles, descriptions, Open Graph images of the board, sitemap — PARTIAL: `screens/site/SiteShell.tsx:34` sets a per-route document title and description, and `public/sitemap.xml` ships / MISSING: no Open Graph tags at all (zero `og:` in `index.html` or source), so no share image

### 7.2 Auth
- [ ] **Login and sign-up screens** — Google, phone OTP (India first), email as fallback; brand-neutral; Wobo present on the screen — PARTIAL: `screens/auth/Auth.tsx` offers Google, Apple, phone and email on a brand-neutral screen with Wobo present / MISSING: phone is not the India-first default on Auth.tsx (only Onboarding.tsx:70 does that)
- [x] **Anonymous session upgrade** — the anonymous learner from the landing demo becomes the real account without losing anything — `App.tsx:1133` `inheritScope` carries the anonymous learner's scope onto the real subject at sign-in, so nothing from the landing demo is lost
- [ ] **Session and device handling** — multiple devices, sign-out everywhere, re-auth on 401 in Wobo's voice — PARTIAL: `store/mind.ts` and the SDK re-auth on 401 / MISSING: no multi-device list, no sign-out-everywhere control, and no 401 copy in Wobo's voice
- [ ] **Account page** — name, avatar, board and class, plan, usage, memory page link, delete account — PARTIAL: `screens/You.tsx` carries name, avatar, board and class, plan and delete-account (`:248` erase) / MISSING: no memory page route to link to, and no usage figure on the page

### 7.3 Legal (**diplomatic drafts; lawyer review before launch**)
- [x] **Terms of service** — `docs/legal/terms-of-service.md`, served at `/legal/terms-of-service` through `screens/legal/Legal.tsx` + `docs.ts`; covered by the responsive proof's `legal-document` case
- [x] **Privacy policy** — DPDP, children's data, what is stored, what is remembered, retention, deletion model — `docs/legal/privacy-policy.md` with `docs/legal/childrens-privacy.md` — DPDP, children's data, retention and the deletion model; served at `/legal/privacy-policy`
- [x] **User agreement and acceptable use** — `docs/legal/acceptable-use.md`, served through `screens/legal/catalog.ts`
- [x] **AI disclosure** — that Wobo is an AI, what it can and cannot do, how to report a problem — `docs/legal/terms-of-service.md:35` discloses that Wobo is built on artificial intelligence from third-party providers, with the accuracy limits named
- [ ] **Cookie and consent notice** — PARTIAL: `docs/legal/cookies.md` is written and served at `/legal/cookies` / MISSING: no consent notice UI anywhere in the app — nothing renders a cookie or consent banner
- [x] **Parental consent flow** for minors; consent tiers wired to the brain — `screens/auth/Auth.tsx:176` branches to the parent path when the age gate requires it, and `services/gateway/src/wobo_gateway/consent.py` holds the tier server-side
- [x] **Refund and subscription terms** — `docs/legal/refund-and-cancellation.md`, linked from `screens/plans/Checkout.tsx:44` at the point of payment
- [ ] **Deletion path** — raw personal data leaves; de-identified insight stays; link severed; a confirmation email — PARTIAL: `services/gateway/src/wobo_gateway/memory.py:65` `erase_durable` deletes the rows and severs the parent link, tested by `test_me_erase.py` / MISSING: no de-identified insight is retained, and no confirmation email is sent
- [ ] **owner** Lawyer review before launch

### 7.4 Onboarding — the first five minutes (**design**)
- [ ] **Intro** (done) then **sign in first** — Google or phone OTP; name from the account; birthdate only where consent law needs it, with the parent path — PARTIAL: `screens/Onboarding.tsx:443` signs in first with Google or a phone code and resumes the flow with the account's name / MISSING: birthdate is only collected by redirecting to Auth.tsx, not inline with the parent path
- [ ] **One question** — what are you studying right now? Text, voice, or a photo of a textbook or timetable
- [ ] **Inference and one-tap confirm** — board and class inferred; board search with "not listed? show me your syllabus" — PARTIAL: `screens/Onboarding.tsx:614` offers board search with "Not listed? Paste your syllabus" always visible / MISSING: nothing is inferred — the learner picks board and class by hand, so there is no one-tap confirm
- [x] **The aha** — Wobo teaches one real thing from that topic on the board, drawing as Wobo talks — `screens/Onboarding.tsx:661` — step three has Wobo teach a real thing from the chosen topic on the board, drawing while talking
- [ ] **Guided tour** — Wobo shows what they can do and how: the thread, Learn, Practice, the board, the plane, asking by circling, push-to-talk; pointing at the real controls; the learner tries each; skippable, resumable
- [ ] **Endowed progress** — three quick questions light the map
- [ ] **Interests** — folded into the first analogy choice (cricket, Formula 1, music, games), not a list
- [ ] **Returning learners** — no onboarding; greeted by name; the tour available from the palette — PARTIAL: `App.tsx:1156` sends a returning learner straight home and `screens/Home.tsx:196` greets them by name / MISSING: no tour exists, so there is nothing for the palette to offer
- [x] **Edge cases** — Google return in the same tab, offline mid-onboarding, unsupported board, under-age with no parent yet — `screens/Onboarding.tsx:239` handles the Google same-tab return, a board search that finds nothing, and the under-age learner with no parent yet

### 7.5 UI raise (**design**)
- [ ] **Element inventory per screen (design, owner law)** — for every surface (landing, auth, onboarding beats, home, Learn, Subject, Course, Practice, Progress, You, the plane, settings, emails): list every visible element with the learner task it serves and the evidence it is needed; remove anything without a reason; copy written from the learner's side; owner reviews the main surfaces before rollout
- [x] **Typography** — Poppins for UI, Caveat for Wobo's hand; tokens updated; Google Sans references removed — `ui/tokens.css:15` self-hosts Poppins and Caveat out of `public/fonts`; no "Google Sans" reference survives anywhere in `apps/web-pwa/src`
- [ ] **Tokens** — light and dark complete; every surface through tokens; no hardcoded whites; one hit of pigment; no shadows; 3 px radius — PARTIAL: `ui/tokens.css:27` is a complete light and dark token set and the rebuilt screens go through it / MISSING: 131 hardcoded whites remain across 24 files (`ui/art.tsx`, `ui/kit.tsx`, `ui/trophies.tsx`, `ui/primitives/ui.css`, `screens/you/you.css`)
- [ ] **Chrome** — header, palette, doors, cards, buttons, inputs, chips, toasts, sheets redesigned to one system — PARTIAL: `ui/primitives/` holds Button, Card, Chip, Tile, Text, Toggle, Segmented, AskBox and AppShell on one system / MISSING: no Toast and no Sheet primitive — toasts are still ad-hoc in five files
- [ ] **Home** — the thread made genuinely minimal; chat on the home front door, no separate chat route — PARTIAL: `screens/Home.tsx` puts the ask box on the front door / MISSING: the separate `chat` route is still live — `shell/router.tsx:35`, `App.tsx:123` and the command palette all still reach it
- [ ] **Learn, Subject, Course, Practice, Progress, You** — a design pass on each against `DESIGN.md`, Brilliant as the floor — PARTIAL: all six screens were rebuilt on the `ui/primitives` kit and the palette-v4 token layer, and all six pass the responsive proof / MISSING: no per-screen design sign-off recorded against DESIGN.md
- [x] **The twin** — hero art that breathes and ignites; independent versus support-dependent visible; screenshot-worthy — `screens/progress/twin-data.ts:14` carries the `independent`/`supported` states and `screens/progress/Constellation.tsx` breathes and ignites the hero art
- [ ] **Illustration and empty states** — the sigil system extended; every empty state designed — PARTIAL: `screens/states/` (StateHost.tsx, Scene.tsx, art.tsx) is a real designed empty- and error-state system reached by every screen / MISSING: no evidence every screen's own empty state was passed through it
- [ ] **Motion** — one system; entrance choreography; magnetic buttons; reduced motion honoured everywhere — PARTIAL: `ui/motion.ts` with `ui/motion.test.ts` is one motion system and reduced motion is honoured across the landing and app / MISSING: no magnetic-button implementation and no entrance choreography documented as one system
- [x] **Mobile** — 360 px to tablets; touch targets 44 px; no fixed widths; safe areas — `ui/primitives/ui.css:146` sets a 44 px touch floor and `tests/helpers/proof.ts:31` proves 360 / 820 / 1440 on every route, asserting no sideways scroll and no fixed widths
- [ ] **Accessibility** — keyboard paths for every course beat; focus-visible; aria on icon buttons; contrast checked in both themes — PARTIAL: `:focus-visible` is honoured in ten files, icon buttons carry aria labels, and `tests/responsive.spec.ts` checks the first three tabbables show focus on every route / MISSING: no automated contrast check in either theme, and no keyboard path proof for the course beats
- [x] **White-label sweep** — nothing user-facing names Classess, Claude, Gemini, OpenAI, Google, or any provider; provider errors rewritten in Wobo's voice; model ids never leave the brain — the `white-label` gate (`scripts/gate_white_label.py`) now fails CI on a vendor name in the built bundle, in a gateway string a client receives, or in shipped source; the SDK's persistence errors were rewritten to "remote store"
- [ ] **Owner approval** — two or three screens shown before rollout

### 7.6 Board-native content and evaluation
- [x] **Visual-by-default gate** — every lesson beat, practice item, hint and boss step carries at least one drawn object (board grammar) or an interactive; a text-only beat fails the golden-board suite; copy is captions, never lessons; Brilliant is the floor for craft — `services/gateway/tests/test_board_golden.py:214` — every golden board must carry an `ink` event before the first sentence ends and `0 < count` objects, so a text-only beat fails the suite
- [ ] **Courses** — the course player as a full board; cards as regions; beats as board moments — PARTIAL: `packages/wobo/src/board/fullboard.tsx` is the full board with cards as regions, reached from `apps/web-pwa/src/wobo/Stage.tsx` / MISSING: the generated course player (`screens/course/Composing.tsx`) is still a carousel of separate engines, not board ink grammar
- [x] **Practice runs** — questions asked on the board; working graded, not only the answer — `apps/web-pwa/src/screens/course/PracticeRun.tsx` registers the question as a board target and `Detonation` substitutes the learner's own wrong number, so the working is graded rather than only the answer
- [x] **Mini-workbooks, flashcards, derivations, word problems** — as board idioms — `apps/web-pwa/src/screens/course/Composing.tsx:32` imports MiniWorkbook, Flashcards, DerivationDepth and WordProblemBreakdown and renders them at `:1461` as beats of the course
- [ ] **Boss battles** — a live problem Wobo draws; solved on the same surface; victory theatre kept — PARTIAL: `screens/course/Boss.tsx` keeps the victory theatre and solves on one surface / MISSING: the boss is a pre-generated three-item workbook (`Boss.tsx:3`), not a live problem Wobo draws in board grammar
- [ ] **Daily thread, XP, streaks with taste, trophies** — retained and refined — PARTIAL: streak days and XP are wired through `store/progress.tsx` into `screens/You.tsx:140`, and the daily thread survives / MISSING: `screens/you/TrophyRoom.tsx` is imported by nothing, so the trophies are unreachable
- [ ] **Free-reasoning grading** — text, voice, and handwriting; rubric versions; confidence bands (auto-accept high, escalate middle) — PARTIAL: `services/gateway/src/wobo_gateway/providers.py:253` `_grade_attempt` grades free text with a correctness call and feedback / MISSING: no rubric versions, no confidence bands or escalation, and no voice or handwriting path
- [x] **Assistance ladder** — Learn, Coach, Hint, Work-with-me, Check-my-work, Challenge, Assessment; support visibly fades — `apps/web-pwa/src/wobo/tutor.ts:19` `LADDER` is exactly learn / coach / hint / work_with_me / check_my_work / challenge / assessment, and `noteCorrect` fades the support as the learner succeeds
- [x] **"I think I'm right"** re-grade path — `apps/web-pwa/src/wobo/tutor.ts:138` `regrade()`, wired into `screens/course/PracticeRun.tsx:332` as the learner's "I think I'm right" path
- [ ] **Calibration harness** — human-graded sets, tracked agreement, adversarial hardening
- [x] **Misconception detonation** — from the learner's own numbers; flagged for spaced re-testing — `apps/web-pwa/src/screens/course/PracticeRun.tsx:429` substitutes the learner's own wrong value into the detonation and re-queues the item (`setQueue((q) => [...q, item])`) for spaced re-testing
- [ ] **Spaced retrieval** — FSRS actually backing the due queue — PARTIAL: `packages/sdk/src/fsrs.ts` computes and saves `dueAt` on every review / MISSING: it is FSRS-lite by its own docstring, and nothing ever queries `dueAt` back — no due queue reads it

### 7.7 Email programme
- [x] **Sender** — brand-neutral until the domain arrives; then the Wobo domain — `services/gateway/src/wobo_gateway/email.py:83` — the sender is one env var (`EMAIL_FROM`), now defaulting to the arrived domain `Wobo <hello@heywobo.com>` with `EMAIL_REPLY_TO` beside it
- [x] **Welcome, first-aha follow-up, progress moments, weekly parent artifact, streak with taste, win-back** — templates in the design system — `services/gateway/src/wobo_gateway/email_templates.py:1357` — fifteen templates including welcome, course_ready, boss_victory, streak_milestone, weekly_digest, sunday_note, parent_report and reengage; `test_email.py:121` pins the count
- [x] **Preferences and unsubscribe**; no schedule-driven nagging — `email_templates.py` `_unsubscribe`/`_preferences` and `_list_unsubscribe` put a one-click stop and a preferences link in every send; `hospitality/jobs.py` honours quiet days; `test_email.py:59` proves the footer carries a real opt-out

### 7.8 Growth and marketing, built in
- [ ] **Hyperlocal festivals (plan §14.1)** — profile fields country/region/language/celebrations[] (celebrations chosen by the family, parent-chosen under consent age; sensitive: opt-in, purpose shown, deletable, privacy policy special-category clause); onboarding step + settings section "Festivals we can wish you on"; festivals.json gets `requires_opt_in` on every religious/cultural entry and country/region tags on all; the hospitality engine = (country ∩ region public calendar) ∪ (chosen festivals) − quiet days; unknown locality → nothing sends; tests that a Janmashtami wish cannot reach a learner outside a family that chose it — PARTIAL: `hospitality/festivals.py:252` derives `requires_opt_in` for every religious entry and `:441` refuses one nobody chose; `test_hospitality_rules.py` proves a Nairobi learner gets nothing Indian and unknown locality sends nothing; the settings section is at `screens/You.tsx:598` / MISSING: no onboarding step collects country, region or celebrations — settings only
- [ ] **Locale everywhere, English words only** — currency, time zone, school hours, quiet hours, exam windows by board follow locality; copy stays plain English ("your parent", "your family", the given name); CI grep gate for regional kinship words (Amma, Ammi, Mummy, Mum, Papa, Appa, Abbu…) in copy, emails and prompts; every email and in-app note passes a locality check before it renders — PARTIAL: `hospitality/copy.py:26` holds the kinship-word list and applies it to festival wishes / MISSING: no repo-wide CI gate (`scripts/gates.sh` runs only no-classess, white-label and pronouns), and no locale-driven school hours or exam windows
- [ ] **Parent link** — created in settings; a weekly, WhatsApp-native progress artifact drawn from the child's own boards; the share page is the upgrade surface with one calm button; "show mom what I just cracked" from a victory — PARTIAL: `screens/you/ParentInvite.tsx` creates the link from settings and `screens/you/ParentView.tsx` is the read-only weekly artifact with the "show mom" path; `wobo_gateway/parents.py` + migrations 0011/0012 back it / MISSING: no WhatsApp delivery — the code says the artifact does not reach a phone yet
- [ ] **Gifts, not gambles** — behaviour-timed gifts that are the same for everyone in that state: abandoned checkout → a gifted Plus week; cancel flow → pause, downgrade, or a gifted month, then a graceful exit with the deletion path visible; real streak and mastery → surprise generosity; exam season → unlimited weekends with a true deadline
- [ ] **The gift box moment** — at a genuine win Wobo hands a wrapped box; a joyful reveal on the board; inside is a real, uniform gift with plain terms; no random wheel, no fake countdown, no anxiety (India's dark-pattern guidelines, DPDP, app-store rules, and our own calm law)
- [ ] **Paywall timing** — the ask lands just before the wow it unlocks, framed as pushing limits, never on a timer; annual-first; charm pricing; decoy tiers; dummy numbers until the owner sets real ones — PARTIAL: `screens/states/pages.tsx:105` lands the ask just before the wow it unlocks, never on a timer / MISSING: `screens/plans/prices.ts:16` records that there is no annual card and that §14 forbids a decoy tier, so annual-first and decoy tiers are not built
- [ ] **Share loops** — the challenge loop (share a hard problem, never the answer, WhatsApp-native); the proof loop (the board as a branded mastery image); referrals rewarded in learning, not cash — PARTIAL: the proof loop ships — `packages/wobo/src/board/fullboard.tsx` shares the board as an image through `wobo/Stage.tsx` / MISSING: `store/referral.ts` is defined but consumed by nothing, and there is no challenge loop
- [ ] **Lifecycle messaging** — email, push, WhatsApp on progress moments: welcome, first aha, first board saved, first boss, streak with taste, win-back after seven quiet days, exam-calendar surges; preferences and unsubscribe; never schedule-driven nagging — PARTIAL: the whole email lifecycle is built and tested (`email_templates.py`, `hospitality/jobs.py`) with preferences and unsubscribe on every send / MISSING: no push notifications and no WhatsApp send path
- [ ] **Acquisition** — programmatic SEO pages per board, class, subject and chapter with a live mini-board; app-store optimisation; build-in-public; velvet-rope invites with insider lore at launch
- [ ] **Experiment engine** — every lever flaggable and A/B-testable; the adaptive tactic engine selects copy, reward, framing and timing per archetype; attribution and cohort retention tracked
- [ ] **Integrity layer** — fraud checks on referrals and sponsored seats
- [ ] **Compliance rails** — marketing consent lives with the parent for minors; DPDP-clean; no dark patterns in cancel flows; every message has an off switch — PARTIAL: every message carries an off switch (`email_templates.py` `_unsubscribe`) and `wobo_gateway/consent.py` holds the tier server-side / MISSING: marketing consent is not held by the parent for minors, and there is no cancel flow to audit for dark patterns


### 7.9 Answering is doing (Brilliant floor, our bar)
- [x] **Answer kinds** — brain chooses per item from: shade regions, place/drag points, slider, order/match, number pad, expression keyboard (fractions, roots, powers), draw a line/angle on the board, circle the part, choose among visuals; no text multiple-choice where a visual act exists; each kind has keyboard + screen-reader path, "Start over", one primary "Check" — `packages/contracts/src/answers.ts:47` defines all ten kinds (shade_regions, place_points, slider, order, match, number_pad, expression, draw, circle_part, choose_visual); `packages/wobo/src/answers/` implements each with `a11y.ts` + `keyboard.ts`, and `ui.tsx:137` gives every kind "Start over" and one "Check"
- [ ] **Placement uses the same kinds** — onboarding's diagnostic is visual and interactive with finished-page spacing (owner law 2026-09-03); no form-looking test
- [x] **State at a glance** — frame hairline + Wobo's expression change for right/wrong/thinking; tick/wobble drawn by Wobo's hand; never a colour flood; no exclamation marks — `screens/course/PracticeRun.tsx` sets Wobo's mood to correct/hint rather than flooding colour, the frame carries a hairline, and `wobo/modes.test.ts:10` plus `screens/landing/copy.test.ts:58` refuse an exclamation mark
- [ ] **Hand-held explanations** — wrong → "Not quite, that's okay" + Get help / Try again; Socratic question; "Why was my answer wrong?" chip; reveal after two misses with "Want to learn why?"; step-wise with small choice buttons; every step draws on the actual control (ring, arrow, written equation) — PARTIAL: `wobo/tutor.ts` hint ladder, `PracticeRun.tsx` Detonation and `regrade` implement the mechanism / MISSING: the named copy — "Not quite, that's okay", "Get help", the "Why was my answer wrong?" chip — lives only in the help articles, not the runtime UI
- [x] **Never lose progress** — every step saved; leaving says "Leave for now? Your place is saved."; no threat dialogs — `screens/states/Scene.tsx:152` and `screens/states/pages.tsx:86` say "Your place is saved" throughout; there is no threat dialog anywhere in the app

### 7.10 Loader, flags, help, settings
- [x] **Loader is the character** — pen line becomes the page's first hairline, body settles into the orb; <1 s; reduced-motion variant — `packages/wobo/src/body/WoboLoader.tsx:59` — the pen draws the first hairline and the line loops into the orb; `apps/web-pwa/src/main.tsx:73` mounts it in its own boot root above the app with a 2.5 s backstop, and `:66` reads `useReducedMotion` for the reduced variant
- [ ] **Flag anything** — flag on every content unit; our own screenshot; annotation with Wobo's ink (pen, circle, rect, blur); type (bug/question/improvement); description; voice flag via Wobo; `learner.flags` table + owner email digest; thank-you and fixed-note to learner
- [ ] **Help centre** — searchable; three groups (Wobo basics, product features, boards and curriculum); illustrated articles written for Wobo; Wobo answers help grounded on this content first — PARTIAL: `screens/site/Help.tsx` is searchable (`screens/site/search.ts` `searchArticles`) over 34 articles in exactly three groups under `docs/copy/help-centre/`, and `wobo_gateway/ask_public.py` grounds Wobo's answers on that content first / MISSING: the articles carry no illustrations — `screens/site/marks.tsx:6` records the marks as placeholders
- [ ] **Settings** — Account (name, email verified/primary, add email, password, delete account, export data), Plan, Preferences (appearance auto/light/dark, reduce motion on/off/auto, narration toggle, sound effects toggle, voice and accent, language, email notifications by category), Parent link, Privacy and consent — PARTIAL: `screens/You.tsx:567` carries Wobo's voice, reduce motion, appearance, festivals and export-or-delete-your-data / MISSING: no Account section (email verified/primary, add email, password), no Plan or Privacy-and-consent sections, and no voice-accent or language picker

### 7.11 Plans, checkout, gifts (under §14)
- [ ] **Plan tiers in the brain** — budget.py plans free|pro|max with PRO = 5× and MAX = 20× the free daily allowance (turns and generations), voice metered the same way; profiles_cache.plan values updated (migration); /v1/me returns plan + allowance; tests — PARTIAL: `/v1/me` returns the plan and allowance, and `screens/plans/prices.ts` states the 5x and 20x multiples / MISSING: `services/gateway/src/wobo_gateway/budget.py:72` still knows only free / plus / anon — there is no pro or max tier, and `consent.py:52` folds both into "plus" at roughly 10x
- [x] **Benefits table** free vs plus with ticks and crosses; honest wording — `apps/web-pwa/src/screens/plans/copy.ts:29` `BENEFITS` — a free/pro/max table with drawn ticks and an em dash for what a plan does not carry
- [x] **Three cards** Free / Pro ₹1,999 (5× allowance) / Max ₹3,999 (20× allowance); $20 / $50 outside India by country; monthly, cancel anytime; billing footnote; "most families" on Pro — `apps/web-pwa/src/screens/plans/prices.ts:88` — Pro ₹1,999 / $20 at 5x and Max ₹3,999 / $50 at 20x chosen by country, monthly with the billing footnote, and `:57` `BEST_FOR = 'most families'` on Pro
- [ ] **Checkout** — Apple Pay / Google Pay / card, country; two explicit consent checkboxes (terms+privacy; recurring-charge disclosure naming amount, renewal and cancellation)
- [ ] **Allowance widget** — "turns left today" with real reset time; per-feature moments ("on Plus") that never block the free path — PARTIAL: `screens/plans/allowance.ts` with `shell/useAllowance.ts` shows real turns left today and the true reset time in the rail / MISSING: no per-feature "on Plus" moments anywhere in the app
- [x] **Gift page** — hero, two gift cards, why people gift (real quotes only once we have them; empty state until then), great-gift-for cards, benefits table, subject paths preview, footer CTA — `apps/web-pwa/src/screens/gift/Gift.tsx` — hero, two gift cards, a why-people-gift block held in its empty state until real quotes exist, great-gift-for cards, the benefits table, a subject preview from `boards.json`, and the closing CTA

### 7.12 Home, courses, progress, about
- [ ] **Ask box is Wobo** — clarifying chips + recommended card from the brain against the learner's syllabus; attach PDF/image with the safety line ("never share pictures of people or personal information") — PARTIAL: `ui/primitives/AskBox.tsx` is the front-door ask on `screens/Home.tsx:201` / MISSING: no clarifying chips, no recommended card from the brain against the syllabus, no PDF or image attach, and no safety line
- [ ] **Course card** — level, lesson list with state, Start; paths banded by the learner's class with progress and favourites — PARTIAL: `screens/Learn.tsx:172` shows level, the lesson list with per-lesson state, Continue and a progress bar, banded by the learner's class / MISSING: favourites do not exist anywhere in the app
- [ ] **You page** — week/month/year; "This week" in Wobo's voice; activity snapshot; drawn charts; learning strengths as behaviour-based praise (resilience, initiative, curiosity, consistency); parent link shares read-only — PARTIAL: `screens/You.tsx` with `screens/you/week.ts:323` gives week/month/year, "This week" in Wobo's voice, an activity snapshot, drawn charts and the read-only parent link / MISSING: only resilience, initiative and consistency are implemented — curiosity is not
- [ ] **About page** — mission, how Wobo teaches (drawn live), what we cover (the boards), our promises, legal set; live concept-graph drawing — PARTIAL: `screens/site/About.tsx:44` carries the mission, how Wobo teaches, the boards we cover, six promises and the legal set / MISSING: the teaching panel is a static SVG — there is no live concept-graph drawing

### 7.13 Rebrand everywhere + white-label (plan §17)
- [ ] **Accounts** — GitHub repo → wobo (done by orchestrator 2026-09-03 if rename succeeded; see git remote); Vercel project → wobo; Railway project + service → wobo; Supabase project "Wobo" (done); OAuth app names; email sender name — PARTIAL: the GitHub repo is renamed (`git remote` → `shreyanrm/wobo`) and the Vercel project is `wobo` (`.vercel/project.json`), with the sender at `hello@heywobo.com` / MISSING: the Railway project and service rename, the Supabase project name and the OAuth app names are unverified
- [x] **Code names** — `@classess/*` → `@wobo/*`; `classess_gateway` → `wobo_gateway`; env prefixes; storage keys `clss-*` → `wobo-*` with migration; SW cache names; CSS prefixes; test fixtures; docs — held by the `no-classess` gate (`scripts/gate_no_classess.py`). Survivors, each with a written reason in `scripts/gate_allowlist.py`: the live Railway hostname in `apps/web-pwa/.env.production` and `vercel.json` (blocked on the service rename), the one-release `CLASSESS_IMAGE_CACHE_DIR` shim, the sibling-product name in ecosystem prose, and the law/ledger text that has to quote the old name
- [x] **Nothing leaks** — no provider/model/vendor name in any response, error, client-visible header/log, bundle string, email, or legal page beyond generic "third-party AI and infrastructure providers"; strip `server`/`x-powered-by`; generic error bodies; OpenAPI off; production source maps off; grep gate in CI for provider names in built assets and templates — the gate ships as the `gates` CI job. It parses the gateway rather than grepping it, so `routing.py` may name a model while a `detail=` body may not
- [ ] **Domain wave** — custom domain for web, api and mail; database host proxied through our domain or fronted by a CDN; until then hosting and database hosts are visible in the network tab (owner informed) — PARTIAL: the domain wave has largely landed — `apps/web-pwa/.env.production` points web at `https://heywobo.com`, the brain at `https://api.heywobo.com` and proxies the database through `/db` (`vercel.json` rewrite, with `*.supabase.co` removed from the CSP) / MISSING: the mail sending domain is unverified, so `EMAIL_MODE` stays console

### 7.14 Device agnostic + handcrafted (plan §18)
- [ ] **Neutral by default (plan §20)** — neutrality clause in the persona + board planner prompts; 'contested topic' classifier in safety.py that switches to the syllabus-only register (states the syllabus, notes disagreement, no opinion); maps drawn per the learner's own government's official map, none in marketing; contested-prompt test set per subject (religion, politics, caste, borders, history, gender, current affairs) asserting opinion-free, syllabus-anchored answers; CI grep gate for community/religious/political terms in copy, emails and marketing — PARTIAL: `wobo_gateway/ask_public.py:510` `contested()` screens contested ground on the way in and out, proved by `test_ask_public.py:460` / MISSING: it covers only the public FAQ door — no neutrality clause in `wobo.py` or the board planner, no map rule, no per-subject contested test set, and no CI grep gate
- [x] **Pronoun pass (plan §19)** — repo-wide rewrite of she/her → name-first or they/them for Wobo across docs, prompts (wobo.py persona, board planner, email templates), code comments, tests, legal/marketing drafts; Wobo's self-description answer; CI grep gate — `scripts/gate_pronouns.py` fails on a gendered pronoun within 60 characters of "Wobo"; `WOBO.md`, `WOBO-CAPABILITIES.md`, `CONTENT-VISUALS.md`, `SUBJECTS.md` and `DECISIONS.md` were the last files carrying them
- [ ] **Three-width proofs** — every screen proven at 360 / 820 / 1440 in both themes; touch, mouse, stylus, keyboard; portrait and landscape on tablet; screen reader path; reduced motion — PARTIAL: `apps/web-pwa/tests/responsive.spec.ts` with `tests/helpers/proof.ts:31` proves 15 app routes and 18 public routes at 360 / 820 / 1440 in both themes, plus a reduced-motion pass, asserting no sideways scroll, no clipped text, a 44 px touch floor and focus on the first three tabbables — and it runs in CI (`playwright.config.ts` ignores only `x-browser.spec.ts`) / MISSING: no tablet portrait-and-landscape pass, no stylus or pointer-type matrix, and no screen-reader path
- [ ] **Board on small screens** — plane as sheet, lasso by finger, hold-to-talk as long press; ink scales with the target
- [ ] **Handcrafted default** — Wobo's hand, their name, their syllabus, their pace on every page; copy audit for template smell; no generic empty states — PARTIAL: the learner's name, board, syllabus and pace run through the rebuilt screens, and `screens/states/` replaces generic empty states with designed ones / MISSING: no copy audit for template smell — no script or gate checks it

## Wave 8 — Platforms and launch

- [ ] **Capacitor project** replacing the empty Expo workspace; iOS and Android; phones and tablets
- [ ] **Native plugins** — camera, microphone, push notifications, haptics, native gestures, keyboard handling, safe areas
- [ ] **Store assets** — icons, splash, screenshots, listings, privacy labels
- [ ] **Tauri desktop** — Mac, Windows, Linux from the same code; auto-update; the desktop hotkey
- [ ] **Offline** — pre-synced learning packs; the board works offline for cached lessons — PARTIAL: `apps/web-pwa/vite.config.ts:76` VitePWA/workbox precaches the app shell and `src/curriculum/cache.ts` + `warm.ts` hold the pinned syllabus offline / MISSING: no pre-synced learning packs, and `packages/wobo/src/board/store.ts` has no offline persistence, so a cached lesson's board cannot replay
- [ ] **Monitoring** — error tracking, budget dashboards, uptime, cost per learner
- [ ] **Final deploy** on green — web, gateway; domain swap when the owner says — PARTIAL: the domain swap to heywobo.com is done and committed (`apps/web-pwa/.env.production` — `VITE_APP_URL=https://heywobo.com`, `VITE_GATEWAY_URL=https://api.heywobo.com`, `VITE_SUPABASE_PROXY=1`), with Railway, `vercel.json` and CI in place / MISSING: `DEPLOY.md` §5 smoke checklist is still 20 unchecked boxes and 0 ticked, so "on green" is unconfirmed
- [ ] **Launch checklist** — accounts, budget dials, legal live, monitoring, rollback, support inbox

## Wave 9 — Horizons

- [ ] Snap a homework page; Wobo grades the working
- [ ] Handwriting canvas with math recognition
- [ ] Code-switching across Hinglish and vernacular; vernacular interfaces
- [ ] Parent mode narrating the week; WhatsApp presence
- [ ] Knowledge twin queryable in plain language
- [ ] Teach-to-unlock and the protégé economy (moderated)
- [ ] Earn-it-forward and the integrity layer
- [ ] Rive rig for the body, if it ever earns its cost

## Wave 10 — Law v5, the depth of the product, and what the site must prove (owner, 2026-09-04)

Every line here comes from the owner in one sitting. Nothing is inferred; where a decision was
needed it was asked and the answer is recorded beside the task.

### 10.1 The law (DESIGN.md §0) — applies to every surface
- [x] White ground, colour only where it does a job — `DESIGN.md:11` law v5, built in `design/prototypes/landing-v8.html`
- [x] One spacing rhythm: `--gutter`, `--band` (half from each side), `--colgap`; every grid child `min-width:0`
- [x] Band raised to `clamp(96px,11vw,184px)` — owner: "spacing between sections is not enough"
- [x] The three causes of scroll jitter banned: a CSS transition on a property GSAP scrubs; scrubbing a layout property; a tween created inside `onUpdate`
- [x] Magnetic controls move an INNER element, never themselves — the hero button jitter
- [x] The navbar CTA is magnetic too
- [ ] Law v5 applied to every app screen and public page — Wave 9 running (`wf_c9c922ce-559`)

### 10.2 The copy law
- [x] No names anywhere. Not "Aanya", not any invented learner or parent
- [x] No grade gate on any public surface. "Every subject your board sets"; anyone may sign up
- [x] No raw allowances ("40 questions a day"); Free carries no multiplier
- [x] Location inferred from the browser time zone, never asked (Plans lost its country switch)
- [x] "The first question is on us" removed — it read as though ONLY the first was free
- [x] "Tonight" removed everywhere — "this evening" where a time is needed at all
- [x] We do not deal with schools at this stage: gone from the footer, plans, security and contact
- [x] One mailbox for everything: support@heywobo.com. The invented safety@/accessibility@ are gone
- [x] Nothing claimed that cannot be shown. Removed: SOC 2, ISO 27001, penetration test, thirty-day
      backup purge with rehearsed restores, and the provider-training claim (owner: do not raise a
      worry about ourselves that nobody asked about). Replaced with the laws we are built to
      (DPDP, COPPA, GDPR incl. children, CCPA/CPRA) and the controls that exist: AES-256 at rest,
      TLS 1.2+, access rules inside the database, least privilege, reviewed and gated changes
- [ ] FERPA deliberately NOT claimed: it governs schools' education records and we serve families
      directly. Owner to confirm if they still want it stated

### 10.3 Plans
- [x] One subscription = ONE learner, on every tier
- [x] No capability differs between plans. Paying buys more questions a day and nothing else
- [x] `budget.py`: pro = 5× free, max = 20× free, `plus` a legacy alias, unknown plan falls to free
- [x] The checkout rehearsal cut from the plans page — consent belongs at the real checkout
- [ ] Payment path itself does not exist (Checkout is promise text only)

### 10.4 Brand
- [x] The real wordmark replaces the Poppins placeholder that was shipping on every app screen —
      `packages/wobo/src/brand/wordmark.svg`, `apps/web-pwa/src/ui/primitives/Wordmark.tsx`
- [ ] The eyes icon still needs a two-tone extraction; a flat colour pass collapses it to a disc

### 10.5 What the site must say about the product (owner: "wobot is one selling point, we do a lot more")
- [x] Drawing is one of five things: ask → place it in your syllabus → show it in the right form →
      try it → remember and report
- [x] The hero answers ONE question four ways: drawn, filmed, tried, spoken
- [x] "It teaches you, at your pace" — three beats: finds the hole beneath the chapter; tries a
      different way when one does not land; does not move on until it stays learnt
- [x] "The climb" — checkpoints, a reward at one, the chapter test, what is behind stays unlocked,
      and a Quest/Focused switch showing the SAME content in two vibes
- [ ] Ported into the app — Wave 9 then Wave 11

### 10.6 The product must actually work that way (audited 2026-09-04; verdicts are from the code)
- [ ] **Mastery gates progression.** PARTIAL: bands are computed (`platform/kgtopg-contract-seed/src/reference/in-memory.ts:144`) and reach the tutor's prompt, but `screens/learn/units.ts:39` derives done/now/later from completion alone. Nothing blocks advancing on low mastery
- [ ] **Mastery survives a reload.** `learner.mastery_cache` (migration 0002) is never written; evidence lives in an in-memory map
- [ ] **`getNextBestNode` has zero callers** — the "what next" chooser is orphaned
- [ ] **Prerequisite diagnosis.** ABSENT in production: `prerequisites` is `[]` for every topic; `unmetPrereqs` (`curriculum/registry.ts:248`), `masteredGround` and `composeBridge` (`wobo/tutor.ts:246,289`) all have zero callers since the roadmap was deleted. `onboarding.diagnostic.answered.v1` with `placement_band` is defined and never emitted
- [ ] **Re-teach differently, automatically.** PARTIAL: interests→analogy is live and reaches the model; every modality switch is learner-initiated. `LearnModalitySwitched.reason` has `repeated_miss`/`frustration` and nothing emits them
- [ ] **Gamification.** Live: XP, level curve, streak and freezes, trophies and ceremony, boss levels with stars, combos, arcade. Missing: the map
- [ ] **Two vibes.** ABSENT: `ui/viewPref.ts` (`'list' | 'adventure'` over identical data) was deleted
- [ ] **Regression, mine:** commit `0bee678` silently dropped 2,755 lines — `AdventureRoadmap.tsx`
      (1,221), `progress/Constellation.tsx` (492), `progress/Report.tsx` (470), `progress/twin-data.ts`
      (247), `learn/legacy.tsx` (300), `ui/viewPref.ts` (25). Recovered to `design/salvage/`.
      Owner's ruling: rebuild them to law v5 rather than restore as they were

### 10.7 New pages
- [ ] **Donate Wobo**, alongside Gift. Owner's ruling: it funds a child who cannot pay. The
      selection rule is the one thing still to settle
- [x] Contact rebuilt around the single mailbox, with no invented reply time

### 10.8 Visual bugs found and fixed (each had a cause worth remembering)
- [x] A class-name collision put a grey panel behind the hero's wake line
- [x] A grid child with only absolutely-positioned content collapsed to zero width
- [x] Headline highlights forced the page sideways: `white-space:nowrap` on a long phrase. The mark
      is now painted ON the span with `box-decoration-break:clone`, so it wraps
- [x] Over-reaching descendant selectors turned rows into 30px columns of single words
- [x] Marks drawn at guessed coordinates drifted off their words (the English mark-up, the fourth
      answer form). Marks now ride the words themselves
- [x] The envelope painted its flap over the letter; it now falls behind, as paper does
- [x] The hero board only drew on scroll, so the first frame was an empty card
### 10.9 Built today, by hand (2026-09-04)
- [x] **The Donate copy source** — `docs/copy/growth/donate-page.md`, governed the same way the gift
      page is. It opens with the four lines that are POLICY rather than product, written as proposals,
      because a donate page cannot exist without them and they are the owner's to set:
      who receives a place, what a donation buys, whether the donor learns who received it, whether
      the family learns who paid
- [x] **The Donate page, handcrafted** — `design/prototypes/site-donate.html`. Its argument is one
      visual: two panels side by side, one paid for by a parent and one by a stranger, drawn from the
      same markup because they ARE the same product. Sections: the twins, three steps (no forms, no
      proof, no thank-you letter), what a place costs at the plan price with no discount, what a
      funded place is not, and the family's own half of the page with an example of how little needs
      to be written. No counter, no child's face, no story, no urgency
- [x] **The climb, handcrafted** — `design/prototypes/app-climb.html`. One spine, nodes either side,
      states carrying colour with a job: mint learnt, pig here, rose needs another pass, lilac ground
      beneath a topic, marigold a reward. The debt loop is the drawing that says we do not move on.
      The bridge panel shows prerequisites being taught before the topic that needs them
- [x] **The two vibes, rebuilt to law v5** — one markup, one order, one set of states. Quest draws
      the reward as a chest and the test as a star and writes its asides by hand; Focused draws the
      same nodes as an unlock and a paper in the neutral tone and sets the asides in the body face.
      The switch cannot change what is taught, which was the owner's rule
- [x] Proofs: 1440 / 834 / 390, both vibes, zero horizontal overflow, zero console errors

### 10.10 Bugs found today
- [x] **Every left-hand node on the climb sat 65px below its own dot.** Grid auto-placement never
      moves backwards, so a card explicitly placed in column 1 AFTER a dot in column 2 was pushed to
      the next row. Pinning `grid-row:1` on both fixes it. Add to the list of CSS traps in DESIGN.md
- [x] **The debt loop pointed the wrong way** — the arrowhead was at the bottom, so a drawing that
      means "we come back up to it" read as "carry on down"
- [x] **The header call to action wrapped to two lines below 600px** on the site prototypes. Under
      that width the header now carries the wordmark and one control; signing in lives in the footer.
      STILL TO APPLY to the React header once Wave 9 releases `screens/site/`

### 10.11 Running now (refreshed 2026-09-05 18:30)
- [ ] **Wave 26** `wf_b452b4f7-c2d` (task `wcvbw618c`) — one learner, one Wobo on the device: every per-learner
      key scoped by account with migration and a source-scanning test; the memory law's client half
      (write-through cache, offline queue, forget reaches the server first). Adversary: two learners, one phone
- [ ] **Wave 27** `wf_b63b663c-815` (task `wihbee045`) — Razorpay subscriptions: plans to the paisa from
      PRICING.md, checkout, signed webhooks processed once, cancel at cycle end, keys from env only, payments-off
      honest. Adversary: steal a plan. Owner supplies RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET later
- [ ] **Wave 28** `wf_a10b2cad-80a` (task `wdhyh0hr3`) — fallbacks everywhere: OpenAI terra/luna/sol first,
      Anthropic second, Gemini last and for audio; every seam through one funnel; fast skip on no credit;
      per-tier price table from the official pages. Adversary: kill each provider
- Wave 14 (`wf_7adb6510-1f2`, testing) is held until the owner calls the testing pass (§10.15)
### 10.12 Cancel, never refund (owner, 2026-09-04)
- [ ] **The site promises a feature that does not exist.** `screens/plans/copy.ts:143` prints
      "You → Your plan → Cancel. Two taps, no call, no 'are you sure' maze." There is no
      Settings and Your plan, no cancel control, no subscription record, no period end and no
      endpoint. `screens/pitch/Security.tsx:118` prints the same promise a second way. Wave 13 builds it
- [ ] **`profiles_cache.plan` still checks `in ('free','plus')`** while `budget.py` prices free, pro
      and max. The constraint and the code disagree today
- [x] **The rule is written into the copy law** — no product surface may promise money back
- [ ] **Every discretionary refund promise comes out**: the gift page's "refundable within fourteen
      days if it is unopened" and its `refund_days` variable, the REFUND WINDOW constant in
      `screens/plans/prices.ts:240`, and the goodwill wording through
      `docs/legal/refund-and-cancellation.md`
- [ ] **What may not be removed, because it is statutory, not goodwill**: a charge taken after
      cancelling, a duplicate charge, an unauthorised charge, a service we did not supply, and the
      fourteen day withdrawal right in the EU, the EEA and the UK. Apple and Google refund their own
      purchases under their own policies whatever we write. FOR THE OWNER: this is the one place his
      ruling cannot be carried out in full, and the reason is law rather than taste

### 10.13 Yearly plans (owner, 2026-09-04)
- [x] **The canonical table** — `docs/PRICING.md`. One place every price is stated, with the rule
      that makes the numbers honest: a year costs ten months
- [x] **The plans page** — yearly and monthly, with a two-option control whose indicator only
      translates. Yearly is first and yearly is the default. Pro reads ₹1,666 a month with
      ₹19,992 billed annually underneath; Max reads ₹3,333 with ₹39,996. Free is unaffected
- [x] Every price, every line of small print and the closing sentence read from one choice, so the
      page cannot show a yearly price beside a monthly promise
- [x] **Contrast bug fixed** — the annual line inherited a light-mode grey and was nearly invisible
      on the dark Max card. Now 7.81 against its own ground
- [x] **Donate re-priced** — a year now costs the YEARLY rate a parent pays, not twelve monthly
      ones. The page claims "the price a parent pays, nothing added", so twelve monthly would have
      made that sentence false
- [ ] **Into the app**: `screens/plans/prices.ts` and the period switch on the real page. Held until
      Wave 13 releases `screens/plans/**`, which it is editing right now
- [ ] **The subscription record must store the period**, so the cancel screen can say "till the year
      you paid for ends" instead of assuming a month. Wave 13 is building that record now
- [ ] FOR THE OWNER: the rupee figures are yours. The dollar figures are derived by the same rule
      (ten months for twelve, so $200 and $500 a year) and are open to being set differently

### 10.14 The doors, the footer and the c-squared (owner, 2026-09-04)
- [x] **The doors, redesigned** — `design/prototypes/app-auth.html`, both screens. What was wrong
      with the pair that shipped: a cream ground the law no longer allows; everything stacked dead
      centre in one column, which is what made it read as a template; a field that was a beige slab
      with nothing but a placeholder to say you could type in it; four buttons of identical weight so
      nothing led; a greyed-out provider with an apology under it; and, on the way back in, an OR
      rule with nothing after it but a sentence saying the other way was switched off
- [x] The page is a conversation with a character, so it is laid out as one: Wobo and what Wobo is
      saying on the left, the thing you do on the right
- [x] **The field is a ruled line you write on**, not a box, which is what this product is about. The
      rule takes the pigment and draws across when you focus it, and its glyph becomes a phone the
      moment what you are typing reads like a number, switching the keyboard with it
- [x] The primary action is the only saturated thing on the page. The providers are white objects
      that float, so they read as buttons on white paper without one border line
- [x] Nothing that does not work is a dead grey slab with an apology: it keeps its shape and carries
      a small "soon", the same call the owner made for the app store buttons. The divider that
      divided nothing is gone
- [x] Wobo looks down at the field when you focus it
- [x] Proved at 1440, 834, 390 and in the dark theme. Zero overflow, zero console errors
- [x] **The footer wordmark** — the name, edge to edge, writing itself on as you arrive. On all ten
      public pages
- [x] **The c-squared bug** — a highlight sized from the baseline cut every superscript in half. Now
      sized against the line box. Written into DESIGN.md as the sixth trap
- [ ] **Port the doors into the app** (`screens/auth/Auth.tsx`, 544 lines, plus its copy). Held while
      Wave 9 finishes the app and Wave 13 finishes the plans and settings screens
- [ ] **Sweep the whole app for the c-squared class of bug**: anything drawn at a guessed coordinate,
      any band sized from a baseline, any mark that does not ride its own word. The owner asked for
      this across the application, not just where he found it
- [ ] Apply the footer wordmark to the real site shell once Wave 9 releases `screens/site/`

### 10.15 Development only until the owner calls it (owner, 2026-09-04)
The owner's ruling: "run full vigurous testing towards the end once i approve that the full
development is done, but until then work on development only", with the standards list kept in the
back of the mind while building.
- [x] **Wave 14 stopped mid-run** — the adversarial account-isolation audit. It can resume from cache
      (`resumeFromRunId: wf_7adb6510-1f2`) the moment testing is approved, so nothing is lost
- [x] **Wave 15 kept** — the conformance register is a LIST, not a test run, and it is the thing that
      keeps the standards in the back of the mind during development
- [x] **Wave 13 landed** — cancel is real, refunds are out of the product, and two live bugs were
      found on the way: a privilege hole letting any learner grant themselves a paid plan, and the
      voice path metering on the wrong column so a paying learner would have been cut off mid-sentence
- [ ] **Wave 11 running** — the climb in the app, reading the real mastery state Wave 10 built
- [ ] **Wave 12 running** — Donate in React beside Gift, and the depth of the product onto the pitch pages
- [ ] **Wave 16 running** — the redesigned doors ported in, and yearly pricing on the real plans page
      with the annual total moved to checkout
- [ ] **Wave 15 running** — the register of global standards, every item verified or honestly marked
      not verified

### 10.16 Held for the testing pass, when the owner calls it
- [ ] Resume Wave 14: account creation, data isolation, the shared family device, the whole journey
- [ ] Load testing. There is none in this repo. Concurrency, the database connection ceiling, the
      rate limiter under load, and the cost per thousand learners are all unknown
- [ ] Dependency vulnerability scanning and secret scanning in CI
- [ ] Accessibility testing in CI, and visual regression
- [ ] Content protection: per-viewer watermarking, short-lived signed URLs, rate-limit hardening.
      NOTE FOR THE OWNER: screen recording cannot be prevented on the web, so the plan is the four
      things that do work rather than a lock that does not lock

## Wave 20 onward — THE PRODUCT ONLY (owner, 2026-09-05)

**The owner's ruling:** *"lets leave the public landing pages, lets get back to it later; lets focus
on the product first and once that is ready and flawless we will have enough knowledge to context to
build the perfect landing pages"*

This is a sequencing decision and it is a good one. The site has spent weeks describing a product
that does not fully work, which is why so many of its sentences had to be deleted for claiming
things the code did not do. Build the product, then describe what is actually there. Every landing
and public-page task below is PAUSED, not cancelled.

### Paused until the product is ready
- The conversion rework beyond what has already landed
- Any further copy, hero or positioning work
- The public pages' remaining handoffs and friction items
- The anonymous tutor demo — CANCELLED by the owner, not paused: *"no demo without account cause it
  is free anyways"*. The free tier is the demo.
- Consent — DEFERRED by the owner to the end, not dropped. Still the largest single item in the
  privacy register and still required before a real launch.

### The product, in the owner's priority order
- [ ] **Everything Wobo says, draws and explains is right.** His words: *"make sure everything wobo
      says and draws and explains is working perfectly and on point"*. The product's central claim
      has NO test at all today: all 5,400 tests are about the plumbing around the teaching, and
      nothing checks the teaching itself
- [ ] **Never lose a child's work.** Five swallowed save failures under a loader whose last word is
      "Your place is saved", and no client timeout on any gateway call (proved to hang past 45s)
- [ ] **A child can report anything, anywhere.** The queue, the endpoint and the admin desk exist;
      the control the learner taps does not, while the help centre promises one on every lesson,
      question, board and diagram
- [ ] **Start over actually starts over.** Erasure reaches 6 of 22 durable stores; the answers, the
      handwriting, the sessions, the uploaded syllabus and the account itself all survive it
- [ ] **The board describes what it draws.** Five of eight objects on a real Pythagoras board are
      announced as nothing, on a product whose premise is that it draws the explanation
- [ ] **Payments: Razorpay** (owner's choice, 2026-09-05). Nothing is wired today and checkout is
      promise text
- [ ] **Operations**, authorised by the owner: *"do whatever is needed"*. Monitoring, alerting,
      backups and a rehearsed restore, dependency and secret scanning in CI, branch protection
- [x] **The migrations reach production.** Done 2026-09-05: `0013`-`0018` with commit `1d0614f`,
      then `0019_parent_accounts` and `0020_wobo_mind`, which the erase path needs to answer at all.
      `docs/OPERATIONS.md` §8 records what was applied, by whom, and how to undo the last two

### 20.1 The teaching harness, and the six bugs it found on its first day (2026-09-05)

The owner's first priority, built and then RUN. `services/gateway/harness/` is the first test in
this repository that asks whether the teaching is any good rather than whether the plumbing around
it works. Twelve real questions across five subjects and three boards, plus the re-teach ladder
probe that is appended to the score sheet as a thirteenth row, driven through the real
`POST /v1/capability/wobo.turn` — the real door, safety screen, meter, planner, verifier and wire —
with real models behind them. About $0.17 a run and roughly a minute. Deliberately NOT in
`uv run pytest`: it calls real models and the owner pays.

- [x] **The harness.** Answers checked against ground truth computed a different way round from the
      product; the board MEASURED with the product's own `geometryOf` and its real handwriting font,
      not described; the teaching marked on a rubric by the other provider; a report per dimension,
      rolled up by subject and by board, with every finding's evidence beside it. `--replay` scores
      recorded transcripts for free, which is the mode CI can run
- [x] **Its own test** — `services/gateway/tests/test_teaching_harness.py`, in the default suite.
      Every check is driven against a transcript containing the failure it exists to catch, and each
      one was proved to FAIL when the check was broken on purpose. Since 2026-09-05 it also walks
      the twelve RECORDED transcripts in `harness/fixtures/` and fails a claim that never fires on
      its own case's real turn, which is the seam the hand-built transcripts were hiding (below)

**What it found, in the order it found it.** Every one is fixed, and every fix has a test that
fails without it.

- [x] **Wobo's own two model calls had no protection at all.** `model_call.py` was written on
      2026-09-04 because a model in the fallback chain refuses `temperature`, answers 400, and the
      learner gets nothing. Every call in the gateway was routed through it except the two that
      TEACH: `run_wobo_turn` and `run_board_plan` called `litellm.completion` directly
- [x] **And the protection itself had a hole a third provider opened.** With three models in the
      chain the middle one refused the knob, the last failed on a bad key, and what surfaced was an
      authentication error naming no knob — so no retry fired. Every live board plan in the gateway
      failed this way, and because `board_plan_for` degrades to the keyless keyword plan rather than
      erroring, no learner and no log ever said so. The rule now is the chain itself: with a
      fallback in play the error is one model's opinion and one attempt without the optional knobs
      is owed before the whole call is written off
- [x] **The board grammar never told the model the shape of an intent.** `BOARD_SYSTEM` printed a
      table of pipelines and ops and never the object, so the model wrote `{"math": {...}}`, the
      planner dropped it, and the turn streamed *"I've drawn the parabola and its tangent"* over an
      empty board. The prompt now carries the object, a test proves the prompt's own example is one
      a pipeline can draw, and the planner folds the nested shape into the flat one
- [x] **A timeline with no dates on it.** `_timeline` records one check per event named after its
      year and wrote the bare `board.in_bounds:year` on every number, so the planner's own law
      refused all seven and the line was drawn with nothing on it but labels
- [x] **A quadratic could not be drawn at all.** A factorisation ends "x - 2 = 0 or x - 3 = 0", the
      CAS cannot read a disjunction, and the whole derivation was refused for it. Worse, the
      no-steps fallback wrote `x = <first root>` and threw the other root away, which the chain
      check rightly refused. Steps are now droppable, and a multi-root answer is written as the
      factored form, which is both checkable and what the chapter teaches
- [x] **"15.0 m" for an image 15 centimetres away.** `_ray` is unit-agnostic and hard-coded metres
      on the distance it drew, so a number the CAS had genuinely proved was published with a unit
      nobody gave it, wrong by a factor of a hundred. The unit is the learner's now, or there is
      none. The tautological dimensional check beside it (`units_agree("f", "m", {"f": "m"})`) went
      with it: it passed for every ray diagram ever drawn and proved nothing
- [x] **The board could not draw a right triangle.** The commonest figure in Class 9, and
      `construction` knew only the perpendicular bisector, so "legs of 3 cm and 4 cm, draw it and
      work out the hypotenuse" reached no pipeline and the learner got an explanation over an empty
      board. `what: "right_triangle"` computes the hypotenuse and proves it two ways
- [x] **Four drawing bugs, all measured rather than guessed.** A plotted grid counted as an obstacle,
      so every note written inside a graph was pushed down and off the bottom of the board; the two
      label loops stepped down with no bound at all; a steep tangent ran from inside the axes to the
      very bottom edge of the board; and an x-axis label was written past the right edge on every
      projectile board. A fifth was introduced by the bound and caught by the next run: clamping a
      label onto the board AFTER the collision search slid a timeline's last event on top of the one
      before it

**What the last run says, and what is still open.** Both live runs of 2026-09-05 ended
`verdict: FAILED` (`harness/reports/teaching-live-20260905-060715.md:8` and `...-064734.md:8`), and
the row of 4.00s that used to open this paragraph did not say so. It says so now, first: the second
run failed on one WRONG finding, and that finding is the Punnett entry below rather than anything
about layout. With that named, the drawing dimensions of that same run were `drew` 4.00, `legible`
4.00, `verified` 4.00, `voice` 4.00 and `changes approach` 4.00 — the re-teach ladder fires by
itself on the second miss and the rung it picks comes back a genuinely different lesson (4% and 45%
similar to the first explanation).

**And the arithmetic that was meant to catch a wrong number was not reading the product.** Found on
2026-09-05 by running every claim in the bank against the product's own recorded transcripts: 8 of
9 matched NOTHING. The patterns were written the way prose reads (`jallianwala[^.\n]{0,60}?(\d{4})`)
and the real history board draws the year as its own object ABOVE the event label, which no
single-line pattern can bridge. Proved end to end by editing the recorded timeline to date the
Jallianwala Bagh massacre to 1921: `correct` stayed at 4 of 4 and the run verdict stayed "nothing
false reached a learner". All of the following are fixed, each with a test that fails without it.

- [x] **A board number is matched by its IDENTITY now** — the verifier check it names, its unit, and
      the words on the objects sharing its anchor — rather than by hunting for a phrase near it in a
      blob of joined text. 13 of 13 claims fire on their own recorded transcript, against 1 of 9
      before, and the 1921 mutation above now fails the run
- [x] **The `ask` frame is read by every check.** It is a full sentence Wobo puts in front of a
      child and only one boolean ever read it, so `check_claims`, `check_forbidden` and
      `check_voice` were all blind to it. An ask prompt reading "Divide both sides by 2, so x = 2"
      scored 4 of 4 on the one case whose whole purpose is the graduated-hint law
- [x] **A question with no ground truth is scored 2 and labelled unchecked**, not 4. Five of the
      twelve cases have no claims, and each was being handed a free top mark on `correct` for
      producing non-empty text — which then propped up the by-subject and by-board rollups
- [x] **The judge can no longer fail a run by itself.** Its `errors` were recorded at WRONG, the
      fatal severity, which is the exact authority the doctrine says it must never have; it had
      already failed a run by marking with g = 9.8. A judged error is a WEAKNESS now, reported in
      full for a person to settle
- [x] **`their world` was one common English word away from a free 4.** The check was a bare
      substring test, so a generic fractions explanation containing "Moreover" passed the cricket
      case, because "Moreover" contains "over"

- [ ] **`teaches` is the weakest dimension at 1.92 of 4**, on the product whose whole claim is that
      it teaches. The second opinion says the same thing about nearly every answer: the result is
      right and the reason is missing. The persona's "two to four sentences" cap is part of it
- [ ] **The learner's own world is reached for only sometimes.** The dossier carries it, the prompt
      demands it, and across runs the cricket case scored 4 and 0. Non-deterministic teaching on a
      law that is not optional
- [ ] **Wobo's spoken line is not covered by the verified-number law.** The law is enforced on board
      OBJECTS; the say is model-authored prose that passes the safety screen and nothing else. Every
      run records how much unverified arithmetic is riding on it (two to five numbers a turn)
- [ ] **The ray diagram draws no construction rays** — the two principal rays are the lesson, and
      `_ray` draws one connecting line instead. The judge caught it on three runs running
- [ ] **THE WRONG FACT: the Punnett turn asks a child for two boxes when three are dominant.** The
      recorded turn (`harness/fixtures/bio.cbse.10.punnett.json`) asks a Class 10 CBSE learner *"Can
      you spot which two boxes show the dominant phenotype?"* — an Aa x Aa cross gives AA, Aa and
      aA, which is three, so a child who answers correctly is told they are wrong by their own
      tutor. It is the single WRONG finding that failed the last live run. It is now caught by
      arithmetic rather than by a judge's opinion (`test_the_recorded_punnett_turn_asks_for_two_
      boxes_when_three_are_dominant`), which means a repeat fails the run. What is still OPEN is the
      teaching side: the prompt is model-authored, so the fix is in `BOARD_SYSTEM`'s own words about
      counting cells before asking about them
- [ ] **The Punnett square draws two of its four cells twice**, once inside the table's own rows and
      once as an overlaid write
- [ ] **Two of the three model providers are unreachable from this machine** (one out of credit, one
      with an invalid key), so every live run above was answered by the second provider alone. The
      harness reports this rather than assuming a chain it did not get
- [ ] **The second opinion shares a provider with the tutor** for the same reason, which is a weaker
      cross-check than the routing doctrine asks for. The report says so on every run

### 10.17 How Wobo sees the screen (owner, 2026-09-05)

**Landed `a5be4f5` (wave 22).** The ink decides the surface, and only the learner's word beats
it: a mark anchored to something on the screen stays there and follows its target; the board
opens only for something built from scratch, never empty. The planner no longer reads the
model's 'presentation' field (it said 'plane' out of habit; that was the whole bug). Scroll is
held only while a page-anchored stroke is mid-flight, 1.5 s cap, Escape releases, a moving
finger keeps its scroll. The harness scores 'in place' (4/4 on three recorded cases). Same wave:
the register law in both prompts, their-world 0 to 4, teaches 1.92 to 3.47 under stricter checks,
the crisis script unreachable from a classifier outage. 25 findings raised, 27 closed.
The owner's ruling, reasoning from first principles: an overlay with a scroll hold is right, and
the one case that needs a screenshot is a VIDEO, because a frame has no structure to point at,
so there you pause, capture, lock and annotate, and nowhere else.

Verified against the code, and the design already matches, with one refinement:
- [x] **Everything we render is registered, never photographed.** Every screen registers semantic
      targets (id, kind, label, live rect, actions). "Nothing is ever placed by pixels." No vision
      call, no screenshot, nothing about a child's screen ever leaves as an image
- [x] **Wobo's OWN films need no screenshot either.** `wobo/video.ts`: the frame at the paused
      timestamp IS a scene spec, every drawable part carries an id, and on pause those parts
      register as surface targets, so Wobo annotates the exact arrow in the exact frame. The player
      returns to the paused millisecond afterwards. Wired through `engines/MotionPlayer.tsx` and
      `wobo/Stage.tsx`
- [x] **There is no external video in the product today.** No embed, no iframe, no video upload.
      Learner uploads are photographs of a page, handed to the model as an image at upload time,
      which is input rather than a screenshot
- [ ] **THE ONE SCREENSHOT CASE, recorded so it is built right if it ever arrives:** video we did
      not make (a YouTube embed, a learner's clip). Pause, capture the frame, hold scroll, annotate,
      release. That is the owner's design and it is the only place a screenshot is permitted
- [ ] Scroll hold during an active stroke on any surface: Wave 22, running

### 10.18 The syllabus observer (owner, 2026-09-05)

**Ask.** *"Verify from the web the first time a user selects a board. Build an observer of flag
reports and edits so you can correct the syllabi based on the similarity of edits, referring the web
and the LLM knowledge to conclude the ideal syllabus. The syllabus may or may not change every year."*

**Design.** `docs/CURRICULUM-OBSERVER.md`. Three witnesses, ranked: the board document, learner
consensus, the model. Consensus can only trigger a re-read; it never writes a chapter the document
does not contain (except into labelled `community` status). Corrections are always a new version
with `supersedes`, never in place. Thresholds are relative (35%/50%) with a minimum in learners
(12), a learner counts once per (node, op) and only after real use, so a hundred edits from one
account are one vote and twenty fresh accounts are none. Consensus does not cross a year boundary.
Console desk with a require-review switch, default on.

**Build.** Wave 25, fourth builder (`observer.py`, counts migration, hooks on overlay write and
`not_my_syllabus` flag, `about` allow-list carries `version_id` + `node_id`). The syllabus
adversary poisons it: one account × 100 edits, 20 fresh accounts, 30 real accounts removing a
real chapter — the document must win; then a genuinely dropped chapter must mint a new version.

**State.** Built, 2026-09-05 (run `wf_5b2d02c9-074`, task `wozfy0307`). What landed, and the
proof for each: `curriculum/observer.py` (counts, thresholds, the re-read, the reconciler, the
run, the desk view); migration `0022_curriculum_observer.sql` (four tables, two views, never a
subject id, NOT applied to the project, owner's call, `docs/OPERATIONS.md`); hooks in
`curriculum/api.py` (overlay write), `reports.py` (`not_my_syllabus` flag, `about` carries
`version_id` + `node_id`) and `app.py` (`wobo.turn` is real use); `GET /v1/admin/observer` and
`POST /v1/admin/observer/review-switch` (owner only, default on) in `desks_api.py`. Tests:
`test_curriculum_observer.py` (§3 to §7, the poisoning file written first: one account × 100 edits
is one vote, twenty fresh accounts are none, thirty real accounts cannot remove a chapter the
document lists, a dropped chapter mints through the freshness path), `test_observer_desk.py`
(the hooks and the desk through the real admin door), `test_observer_schema.py` (0022 as a
contract). Not yet wired: the worker loop that calls `observer.run_pass` on the discovery
worker's cadence (the PUBLISH builder owns the loop; `run_pass` refuses unless
`WOBO_DISCOVERY_WORKER` is on), and the console screen for the desk.

### 10.19 Onboarding: one sign-in, not two (owner, 2026-09-05)

**Ask.** A first-time learner should be impressed; one sign-in, every step seen in pixels, the
aha moment proven.

**Landed, `0dad66f` (wave 23).** Step one of /onboarding renders the same Auth door as /sign-up
(a `run` prop says where Google lands and what happens on sign-in); the 77-class private copy is
deleted and a test keeps it deleted. An empty submit says one line and puts the caret in the
first missing thing, in page order, on the door, on step two and on the parent step. The stepper
is one shared nav with real Back buttons; a reload resumes where the learner was, never past the
door or an unanswered question; an anonymous Supabase session no longer counts as signed in.
Every step measured at 1440/834/390, light and dark: no sideways scroll, nothing at opacity 0, no
control under 44px on a phone. Adversary raised 9, fixer closed 9, each held by a test proven to
fail without the change. Shots in `shots/onboarding-2026-09-05/`.

**Closed.** The draw flag landed (commit after `471c9bc`): step three asks for the hand outright
and the learner's word about the surface still wins. Not proven live on this machine (no model
key); the wave's e2e `tests/onboarding.spec.ts` is the proof to re-run with a key.

### 10.20 The doubt solver (owner, 2026-09-05)

**Ask.** Photo a book page; Wobo annotates on the photo itself and explains while drawing,
stroke by sentence.

**Landed `a5be4f5` (wave 24).** Two steps over the one existing tutor: POST /v1/doubt reads the
photo and returns the reading first, for the learner to correct any line; POST
/v1/doubt/{id}/answer streams the board frames over the photo as a registered surface, so the
planner, verifier, spoken-number law, both safety screens, meter, spend ceiling and ledger all
apply. Every model mark anchors to a line of the page or is counted off it; every stroke is
beaten to a sentence. Photos are bounded (6 MB decoded, 8000 px side, 40 MP), EXIF-oriented,
re-encoded with no metadata (EXIF, COM, XMP, ICC all gone), screened before read or keep, and
the screen fails closed. Faces, personal details and non-pages refused kindly. Storage
account-keyed; forget-me reaches the table and the bucket. Client: a sign-in door before any
shutter, camera, reading, corrections in place, ink on the photo, chips ranked for the doubt,
a caption revealed on the beat, Hindi pages tokenised. Two taps to the first line of
explanation. Cost of one doubt from the price table: about $0.026 typical, $0.038 ceiling.
Adversaries raised 18 (leaks first), the fixer closed 18, each run red first.

**Open.** Migration `0021_doubts.sql` (learner.doubts + private doubt-photos bucket) is written,
NOT applied; until it is, the reading answers 503 not_kept in production. Apply after a read.

### 10.21 The syllabi reach production, and the honest count (owner, 2026-09-05)

**Ask.** Quality of board selection, accuracy per grade, learner editing; verify from the web on
first selection; the observer (10.18).

**Landed `a5be4f5` (wave 25).** The commit message says "publish and verify in flight"; that
was wrong, the wave had finished before the snapshot and the message was written from an older
notification. Everything below is in that commit.

- **The honest count.** The seed holds 121 syllabus files but only 50 carry chapters; 71 are
  stored negative results (a blocker code and a note, no units) and mint nothing. The 50 fall
  into 4 versions: CBSE 2026-27 (23 subjects, classes 6 to 12), ICSE 2026-27 (12), ISC 2026-27
  (8), NIOS 2023 (7). 268 frameworks, 1493 nodes (a loader bug emitted 37 duplicate level ids;
  fixed at the source and asserted unique).
- **Verified against the source, row by row** (`docs/curriculum/VERIFICATION.md`): all 41 source
  documents re-fetched and hashed identical. 15 verified (9 by code alone, 6 with a second
  reader), 15 provisional failed, 20 provisional incomplete, 71 with nothing to check. Cost
  USD 0.36. Errors found in our reading and fixed at the source, never in place: class 11
  maths was missing Three-dimensional Geometry; class 10 science had three formative-box topics
  wrong (the PDF's text layer misled the first cut; pages rendered as images and re-read);
  physics marks brackets read off the drawn cells; a NIOS "Module- ll" misprint recorded.
- **Publish** is one idempotent command with `--emit-sql`; the SQL (2.08 MB, 19 inserts, every one
  on-conflict-do-nothing) is applied by the orchestrator, never by a worker.
- **The discovery worker** is scheduled behind `WOBO_DISCOVERY_WORKER=1` (default off), one
  conditional claim per job so two replicas cannot both run one, charged as generations to a
  system subject under the spend ceiling. About USD 0.20 per discovery, at most USD 1.60 a day
  (`docs/OPERATIONS.md` §9.2). The owner turns it on.
- **First selection verifies from the web.** The first learner on a provisional (board, class,
  subject) triggers a re-check off the request thread with an honest "checking" line; the second
  learner reads the stored verdict. Proven live: CBSE class 10 maths fetched, hash identical, all
  9 structural checks passed in 1.2 s; class 8 maths timed out at NCERT and took the honest
  unreachable path.
- **The beat** (10a/10b): adversary raised 8, fixer closed 8; a crisis line can never be re-beaten.

**Open.** The production discovery worker is off until the owner sets the env var. 71 syllabi
have no chapters yet; discovery fills them when a learner asks and the worker is on.

### 10.22 Production, 2026-09-05 evening: what is applied and the one thing the owner runs

- Migrations 0021 (doubts table + private photo bucket) and 0022 (observer tables, views, the
  review-queue kind) applied to production after a read, both verified absent first.
- The syllabus seed is NOT yet in production: `curriculum.frameworks/versions/nodes/provenance`
  are 0/0/0/0. The SQL is generated and byte-identical to the checked-in file, but it is 2 MB
  across 19 statements and the only production SQL path available here takes text inline, which
  would mean transcribing 2 MB of ids by hand into rows 0008 makes immutable. Not done, on
  purpose. `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` is empty; no CLI is logged in.
- **THE OWNER RUNS ONE COMMAND** (from `services/gateway`, idempotent, expect 268/4/1493/1493):
  `SUPABASE_SERVICE_ROLE_KEY=<key> uv run python -m wobo_gateway.curriculum.publish`
  or pastes the key into `.env.local` and says so, and I run it. Verify with the query in the
  header of `harness/reports/publish-seed.sql`.
- Until then every board still yields no syllabus in production.

### 10.23 Production wiring, 2026-09-05 evening (owner logged in to Vercel)

- **Why the live site was a demo shell:** all six `VITE_*` variables existed on Vercel with EMPTY values
  (`vercel env add` fed from a pipe stores a blank in CLI 54). Set through the REST API with the CLI's own
  token, production and preview, verified by pull: Supabase URL and anon key, `VITE_SUPABASE_PROXY=1` (the
  CSP only allows our own origin, so the database goes through the `/db` rewrite), gateway URL, app URL,
  `VITE_LLM_MODE=live`, `VITE_PERSIST_MODE=live`, `VITE_DEV_AUTH=false`. Empty duplicate rows deleted.
- **The live gateway is old:** `/healthz` answers the two-field body from before health.py; today's code
  returns a full snapshot. Railway needs a deploy. The `RAILWAY_API_TOKEN` in `.env.local` is rejected as an
  account token, as a project token, and by the GraphQL API: **the owner runs `railway login`**, then
  `railway up` from services/gateway lands today's gateway.
- **Order of deploys:** gateway first (the new web talks to routes the old gateway lacks), then promote the web.
- **Promoted 2026-09-05 ~19:30 IST:** today's HEAD deployed to production from the clean export (`vercel deploy --prod` in
  the export dir with `.vercel/project.json` copied in). Verified: entry chunk changed, gateway host in 5 chunks, anon key
  inlined, today's hero and the doubt routes present, `/db` rewrite reaches Supabase (401 without apikey = reached),
  gateway preflight allows `https://heywobo.com`. The gateway went live ~75 s after `railway up` (§10.24).

### 10.24 Railway, 2026-09-05 evening (owner supplied a project token)

- The token is a PROJECT token (project wobo, environment production); the CLI's name for it is
  `RAILWAY_TOKEN`, stored in `.env.local` with `RAILWAY_PROJECT_ID`. Service: `wobo`, domains
  `api.heywobo.com` and `wobo.up.railway.app`. Build: root `railway.json` -> `services/gateway/Dockerfile`,
  context = repo root, `.railwayignore` trims the upload. Deploy from a CLEAN EXPORT of HEAD
  (`git archive HEAD | tar -x` into the scratchpad, then `railway up --service wobo --detach` there), never
  from the working tree while waves are editing it.
- The live gateway before today's deploy was from 2026-09-04 05:25Z. Today's HEAD (`55c3a0f`) deployed
  at ~19:00 IST; health polled for the new snapshot (`version` field).
- **Missing on the service, by name:** `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_JWT_SECRET`. Sign-in
  needs neither (the door verifies through the project's JWKS, one ES256 key published). But EVERY durable
  store (subscriptions, reports, ledger, mind, parent, doubts, curriculum, observer, consent, hospitality)
  needs the service-role key and degrades to its honest "unconfigured" state without it, as yesterday's
  build did too. Nothing server-side has ever persisted in production. **Owner supplies the service-role
  key** (Supabase dashboard, Project Settings, API, service_role) and I set it on Railway through the API
  and use it once for the seed publish.
- Present on the service: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `RESEND_API_KEY`,
  `SUPABASE_URL`, `ENV=prod`, `LLM_MODE=live`, `APP_URL`, `GATEWAY_URL`, mail settings.

### 10.25 The syllabi are in production; the service key is on the gateway (2026-09-05, ~20:40 IST)

- Owner supplied the Supabase service-role key (stored in `.env.local`, never printed; set on the Railway
  service through the CLI with `--skip-deploys`, then `railway redeploy`). The API's `variableUpsert` refuses a
  project token (403); the CLI's own path works.
- **Seed published** from the clean lab export with `python -m wobo_gateway.curriculum.publish`: run 1 wrote
  268 frameworks / 4 versions / 1493 nodes / 1493 provenance; run 2 found `already.versions = 4` and moved nothing.
  Verified in production by query: 268 / 4 / 1493 / 1493, 0 orphan nodes, 0 nodes without provenance; versions
  cbse 2026-27 verified, icse 2026-27 provisional, isc 2026-27 provisional, nios 2023 verified. 71 seed files
  carry no chapters (stored negative results) and minted nothing; discovery fills them when the worker is on.
- From this redeploy on, every server-side store in production is configured: subscriptions, reports, ledger,
  mind, parent, doubts, curriculum, observer, consent, hospitality.
