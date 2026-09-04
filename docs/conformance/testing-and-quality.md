# Conformance register — testing and quality

**Domain:** testing and quality assurance
**Repo:** `/Users/depl/Documents/classess-learner`, branch `the-life`
**Commit at time of audit:** `95e3617` (`tasks: development only until the owner calls the testing pass`)
**Audited:** 2026-09-04
**Auditor:** automated register pass. Nothing below is ticked without a command I ran or a file:line I read.

---

## 0. How to read this, and what was actually run

Every row is `MET` / `PARTIAL` / `NOT MET` / `N/A` / `NOT VERIFIED`. Evidence is either a `file:line`
or a command and its real output. Where I could not verify something, the row says `NOT VERIFIED`
and names what would verify it. There is no row here whose tick I cannot defend.

**A condition that shapes this whole register.** While I audited, another wave was editing this
working tree. `git status --porcelain` showed 18 modified and 12 untracked files under
`apps/web-pwa/`. So there are **two different answers** to "do the tests pass", and both are true:

| Tree | Command | Result |
|---|---|---|
| Committed `HEAD` (95e3617) | `bun test test/*.test.ts src` in `apps/web-pwa` | **1425 pass, 0 fail** |
| Live working tree | same command | **1515 pass, 3 fail, 1 error** |

I got the `HEAD` figure by extracting the commit into a scratch directory (`git archive HEAD | tar
-x`) so nothing in the owner's tree was touched. Where a number below could differ between the two,
I say which tree it came from. **The committed code is green. The uncommitted work in flight is
not.** That is normal mid-wave and is not itself a finding — but it does mean nobody should read a
green local run as proof of the tree on disk right now.

Commands run for this register (all read-only against the repo; mutations happened only in
throwaway copies under the scratchpad):

```
bun run typecheck                                  # exit 0
bun run test                                       # per-workspace, see §1
bunx biome check .                                 # HEAD: 1 warning; working tree: 3 errors
uv run pytest -q services/gateway|verifier|contracts, and content   # all exit 0
uv run --with pytest-cov pytest services/gateway --cov=...          # 87%
bunx playwright test                               # working tree: 52 pass / 9 fail / 5 skip
bun test --coverage                                # every TS workspace
gh run list --workflow=ci.yml --limit 40           # CI health
```

---

## 1. Inventory — how many tests there are and where

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 1.1 | An automated test suite exists | ISO/IEC 29119-2 §6; basic engineering hygiene | MET | **259 test files** at the moment of the audit — `apps` 135, `packages` 60, `services` 59, `platform` 4, `content` 1. Command: `find . -type d \( -name node_modules -o -name .venv -o -name .git -o -name dist \) -prune -o -type f \( -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.spec.ts" -o -name "test_*.py" \) -print`. The number drifts by a few during a wave, because the tree is being edited live | — |
| 1.2 | TypeScript unit tests, counted | — | MET | `bun run test`: config 14 (2 files), motion 22 (4), contracts 27 (4), kgtopg-contract-seed 27 (4), sdk 115 (9), wobo 696 (41), web-pwa 1425 (110 at HEAD). Plus `services/render-worker` 5 (1). **Total 2331 across 175 files** | — |
| 1.3 | Python tests, counted | — | MET | `uv run pytest <dir> --collect-only -o addopts="" -q`: gateway **2988**, verifier **41**, contracts **4**, content **17**. **Total 3050** | — |
| 1.4 | End-to-end tests, counted | — | MET | `bunx playwright test` on the working tree: **66 tests in 15 spec files** (52 pass, 9 fail, 5 skip). Separately `tests-plan/plan.spec.ts` 4 tests, and `tests/x-browser.spec.ts` 2 tests × 3 engines | — |
| 1.5 | Ratio of test code to product code | no standard; recorded for judgement | MET | Product (non-test): `apps/web-pwa/src` 85,077 LOC, `services/gateway/src` 32,476, `packages/wobo/src` 18,871, `packages/sdk/src` 4,044. Test code: **54,750 LOC**. Roughly 1 line of test per 2.6 lines of product | — |
| 1.6 | Tests run in one command per stack | — | MET | `package.json:12` `"test": "bun run --filter '*' test"`; `pyproject.toml:69-71` `[tool.pytest.ini_options] testpaths = ["services", "content"]` | — |
| 1.7 | Playwright specs excluded from the unit runner so a real failure is not hidden in collection noise | — | MET | `bunfig.toml:13-15` `pathIgnorePatterns = ["**/apps/web-pwa/tests/**", "**/apps/web-pwa/tests-plan/**"]`, with the reason written above it. This was a real historic bug and it is fixed | — |
| 1.8 | Skipped / disabled tests are rare and justified | ISO 29119-2; suppression hygiene | MET | 10 total. 6 are `test.skip(browserName !== 'chromium')` for CPU/network throttling (`tests/board-latency-throttled.spec.ts:137,153,158,174`, `tests/board-frames.spec.ts:74,103`) — a genuine engine capability limit. 4 are `pytest.skip("… is not present in this checkout")` (`test_curriculum_store.py:258,266`, `test_ask_public.py:564`, `test_curriculum_concepts.py:402`) | — |
| 1.9 | No `.only` left in the tree | — | MET | grep for `.only(` across all test files: 0 hits. `playwright.config.ts:34` also sets `forbidOnly: !!process.env.CI` | — |
| 1.10 | Throwaway/scratch specs are not left in the E2E directory | test-suite hygiene | **NOT MET** | Four untracked files sit in the directory Playwright globs: `apps/web-pwa/tests/zz-live.spec.ts`, `zz-verify.spec.ts`, `zz-verify2.spec.ts`, `zz-verify3.spec.ts`. They are ad-hoc verification scripts from an in-flight wave, they are already failing `biome check` (3 errors), and because `playwright.config.ts:22` sets `testDir: './tests'` with only `x-browser.spec.ts` ignored, **they would run as part of CI's E2E job if committed** | Delete them or move them out of `apps/web-pwa/tests/`; add `zz-*` to `testIgnore` if scratch specs are wanted at all. |

---

## 2. What the tests actually prove — and the large class that proves less than it looks

This is the most important section in the register. The suite is large and the assertions are
specific, but a substantial fraction of it asserts over the **text of source files** rather than
over behaviour. Those tests are copy gates and diff alarms — genuinely useful for a product whose
words are the product — but they must not be read as proof that a feature works.

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 2.1 | Tests exercise behaviour, not source text | ISO 29119-1 §3 (a test observes behaviour) | **PARTIAL** | **42 of 120** web-pwa test files call `readFileSync` on product source and assert over the characters. e.g. `apps/web-pwa/test/a11y-contracts.test.ts:53` asserts `expect(companion).toMatch(/if \(e\.key !== 'Escape'\) return;/)` — a literal source-string match, not a keypress. `apps/web-pwa/src/screens/site/law-v5.test.ts:44-52` reads every `.ts/.tsx` under five lanes and regexes the shipped words. `apps/web-pwa/src/screens/pitch/pitch.test.ts:33-48` diffs page source against `design/prototypes/*.html` | Keep these as copy gates, but add behaviour tests for the same claims (see 2.4, 3.x); never count a source-grep as coverage of a feature. |
| 2.2 | No component is rendered in any unit test | Testing Library / component-test practice | **NOT MET** | Zero DOM test environment anywhere: grep for `testing-library`, `happy-dom`, `jsdom` across every `package.json` returns **nothing**. Only 5 test files even import a `.tsx`, and they read it as text or import a constant from it. The entire React layer's rendering, state and event handling is untested below the E2E level | Add `happy-dom` + `@testing-library/react` to `apps/web-pwa` and write render tests for the ~10 screens that carry money, consent, auth and cancel. |
| 2.3 | **Would a test fail if the feature were deleted? (measured)** — the cancel flow | mutation-testing principle | **NOT MET** | I copied `HEAD` to a scratch dir and replaced `apps/web-pwa/src/screens/you/PlanPanel.tsx` with a one-line comment. `bun test src/screens/you/plan.test.ts` → **54 pass, 5 fail** of 59. The 5 that fail are the `readFileSync` source-grep assertions; **the 54 behavioural-sounding ones — "two taps reach the confirmation", "a failed request leaves the plan active" — all still pass with the panel deleted**, because they test `plan.ts`/`billing.ts` reducers that the deleted component was the only consumer of | The reducer tests are good and should stay; add one render or E2E test per claim so the *wiring* is also proved. `tests-plan/plan.spec.ts` already does this for two of them — extend it. |
| 2.4 | **Would a test fail if the feature were deleted? (measured)** — the subject engines | mutation-testing principle | **NOT MET** | Same method: in a scratch copy of `HEAD` I replaced **nine** subject engines — `MathScene.tsx`, `ChemScene.tsx`, `BioScene.tsx`, `PhysicsScene.tsx`, `MapScene.tsx`, `Flashcards.tsx`, `MiniWorkbook.tsx`, `Discovery.tsx`, `ConceptMap.tsx` — with `export default function X(){return null}`. Full unit suite: **1419 of 1420 pass**. One file errored (`raster-seam.test.ts`, a source-grep). **The visible teaching surface of the universal-curriculum claim can be deleted entirely and 99.9% of the unit suite stays green** | Add E2E coverage that opens each engine and asserts it drew something; today only the board engine is covered end to end. |
| 2.5 | The newest suites are behavioural | — | **PARTIAL** | Sampled the newest test files by `git log --diff-filter=A` (all added 2026-09-04). `src/screens/you/plan.test.ts` — strong reducer tests, but see 2.3. `src/screens/site/law-v5.test.ts:1-18` — pure source regex, and it says so in its own header. `src/screens/pitch/pitch.test.ts` — pure prototype-vs-source text diff. `src/curriculum/placement.test.ts`, `prereq.test.ts`, `packages/sdk/test/mastery.test.ts` — genuine pure-function tests | — |
| 2.6 | Tests are honest in their own documentation about what they do not prove | rare and creditable | MET | `services/gateway/tests/test_subscriptions_schema.py:1-25` opens: *"**No Postgres runs here.** Every assertion below is a string match over the CHARACTERS of a .sql file that has not been applied to any database… They are a diff alarm, not a database test"* — and then lists the two round trips that would close the gap. This is the standard the rest of the suite should be held to | — |
| 2.7 | Golden/fixture data is versioned and asserted against | — | MET | 12 golden boards under `apps/web-pwa/src/wobo/goldens/` (17 files incl. manifest and builder), asserted at `apps/web-pwa/tests/board.spec.ts:135` ("there are twelve of them, across the four families") and driven per-board in `tests/board.spec.ts:147` and `tests/board-latency.spec.ts:75` | — |
| 2.8 | Snapshot tests are used sparingly | snapshot-test practice | MET | Exactly **4 snapshots** in the whole TS suite, all in `apps/web-pwa/src/ui/courseIntro.test.ts:111` (`expect(SUBJECT_ART[key]).toMatchSnapshot()`). Snapshot sprawl is not a problem here | — |
| 2.9 | Deterministic verifier / grading is tested against authored ground truth | — | MET | `content/atom/tests/test_grade.py:15-23` parametrises the whole calibration set and asserts the verifier's correctness *and* first-bad-step against authored labels, with no model call | — |
| 2.10 | Mutation testing in CI | Stryker / mutmut; advanced practice | **NOT MET** | No `stryker`, `mutmut` or equivalent anywhere (`grep` over `package.json`, `pyproject.toml`, `.github/`) | Not worth adopting wholesale; the hand-run experiments in 2.3/2.4 already found the gap. Run `stryker` once against `packages/sdk` and `packages/wobo` to price it. |

---

## 3. End-to-end coverage — which real journeys are covered and which are not

The Playwright suite is hermetic by design: `playwright.config.ts:56-70` forces `VITE_LLM_MODE=mock`,
blanks the gateway URL and blanks the Supabase vars so no request leaves the browser, and
`tests/global-setup.ts` refuses to run against a dev server wired to a real gateway. That is a good
design and it is why these tests are stable. It is also the reason for every gap below.

**Covered** (title taken verbatim from the spec):

| Journey | Spec |
|---|---|
| Onboarding: landing → begin → name → date of birth → board → class → home | `tests/journey.spec.ts:47` |
| Home: wordmark, identity cluster, did-you-know, both doors | `tests/journey.spec.ts:119` |
| The atom course: course → detonation → boss → greeting → twin → invite → palette | `tests/journey.spec.ts:152` |
| Board picking by typed fragment; aliases; board's own chapters in the board's own order | `tests/curriculum.spec.ts:38,64,83` |
| "Not listed" path — no invented boards, classes or chapters | `tests/curriculum.spec.ts:145,205,247` |
| A pasted personal syllabus becomes a personal plan, marked personal | `tests/curriculum.spec.ts:291,342` |
| Router: UI nav writes an address; back pops without reload; cold deep link boots on the screen | `tests/router.spec.ts:39,71` |
| Cancel: two taps to confirm, a refused cancel leaves the plan active, Escape restores focus, a dead gateway never draws the plan as Free | `tests-plan/plan.spec.ts:44,116,131` |
| Approval card, teach-back, proactivity dial persisting across reload | `tests/wobo-capabilities.spec.ts:26,58,101` |
| Board: drawing, control handles, time-scrub, keyboard drawing, screen-reader exposure | `tests/board*.spec.ts` |
| Plans: opens on yearly, equal card heights at 3 widths, whole sum at checkout | `tests/plans-period.spec.ts` (untracked, in flight) |
| 35 routes at 3 widths × 2 themes + reduced motion | `tests/responsive.spec.ts` via `tests/helpers/proof.ts:71-200` |

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 3.1 | The core learning journey is covered end to end | — | **NOT VERIFIED at `HEAD`; NOT MET in the working tree — corrected 2026-09-04 after `_challenge.md` C8/C26.** The challenger ran `bunx playwright test tests/journey.spec.ts` and got **3 failed of 3**: `:47` `TimeoutError: locator.click` in onboarding, `:119` `expect(locator('header').last()).toBeVisible()` → element not found, `:152` timeout before heading "Learn". Re-run in a clean `git worktree` of `HEAD` before this is ticked again. The suite below exists and is well written; whether it passes is the open question | `tests/journey.spec.ts:47,119,152` — three tests walking landing → onboarding → home → course → boss → reward, asserting console-clean throughout (`watchConsole`/`assertNoErrors`, `tests/helpers.ts`) | — |
| 3.2 | The cancel/refund journey is covered end to end | consumer law: the exit must work | **PARTIAL — corrected 2026-09-04 after `_challenge.md` C7.** It is not end to end: `tests-plan/plan.spec.ts:37-38` stubs the answer with `page.route` on `/v1/me/subscription` and `/cancel`, and `tests-plan/config.ts:18-23` launches with `VITE_LLM_MODE=mock`, `VITE_PERSIST_MODE=local` and a blank `VITE_SUPABASE_URL` — no gateway, no database. It covers the **client's** two-tap dialog. Combined with the fact that `learner.subscriptions` does not exist in production (see `privacy-and-children.md` J12), this is a green CI job standing in front of a server path nothing covers | `tests-plan/plan.spec.ts:44,116,131`, run in CI as its own step (`.github/workflows/ci.yml`, "Run the cancel suite"). The config's comment explains why it needs its own config (it stubs a gateway with `page.route`, which the hermetic journey config forbids) | — |
| 3.3 | **Sign-up / sign-in is covered end to end** | the first door every family walks through | **NOT MET** | The E2E suite deliberately blanks `VITE_SUPABASE_URL`/`ANON_KEY` so "the mandatory sign-in beat is bypassed by config" (`playwright.config.ts:58-63`, its own comment). **No Playwright test ever creates an account, signs in, signs out, or recovers a password.** `packages/sdk/test/auth.test.ts` and `anonymous.test.ts` test the client against a hand-written `globalThis.fetch` stub (`test/auth.test.ts:30`) — that is not the real auth service | Add a second Playwright config pointed at a Supabase local stack (or a stubbed auth origin via `page.route`, as the cancel suite already does) covering sign-up → verify → sign-in → sign-out. |
| 3.4 | **Payment / checkout is covered end to end** | money path | **NOT MET** | `tests/plans-period.spec.ts:122` asserts checkout *states the whole sum*; nothing completes a purchase. No payment provider appears in any spec | If checkout is not open yet this is correctly N/A for launch — but it must not stay untested past the first paying family. |
| 3.5 | Parent linking / parent view is covered end to end | a named product surface | **NOT MET** | `/parent` is opened by `tests/helpers/proof.ts:90` only to check it renders and does not overflow. `apps/web-pwa/src/screens/you/parentLink.test.ts` and `services/gateway/tests/test_parent_links.py` cover the two ends separately; no test walks a parent through the link | Add one spec: learner generates a link → second browser context opens it → parent sees the transcript. |
| 3.6 | Voice is covered end to end | a headline capability | **NOT MET** | `playwright.config.ts:56` blanks the gateway so "TTS/voice no-op without a gateway URL". `tests/board-latency-throttled.spec.ts:149` is the one voice-timing test and it is `test.skip`-gated to chromium and reports *"first syllable: not exposed by the bench yet"* in its own output. `services/gateway/tests/test_voice.py` covers the server side in isolation | Stub the voice websocket in a Playwright config the way `tests-plan/config.ts` stubs the gateway, and assert the first syllable lands. |
| 3.7 | Offline / PWA install is covered | PWA baseline | **NOT MET** | `vite.config.ts:129-141` configures `VitePWA` with `registerType: 'autoUpdate'` and a workbox precache. **No test anywhere registers a service worker, goes offline, or asserts the app shell still loads** — grep for `serviceWorker`, `workbox`, `virtual:pwa` across all specs and tests returns nothing | Add one Playwright test that loads the app, calls `context.setOffline(true)`, reloads, and asserts the shell renders. |
| 3.8 | Data deletion / "forget everything" is covered end to end | GDPR Art. 17 operability | **PARTIAL** | Server side is well covered: `services/gateway/tests/test_me_erase.py`. Client side has `apps/web-pwa/src/wobo/forget-all.test.ts`. No E2E test walks a learner through the erase and confirms the app is empty afterwards | Add it to the journey suite; it is a hermetic, local-storage-only path so it fits the existing config. |
| 3.9 | E2E runs in CI on every push | — | MET | `.github/workflows/ci.yml` job `e2e`: installs chromium, runs `bun run test:e2e` and `bun run test:e2e:plan`, uploads the HTML report as an artifact on failure | — |
| 3.10 | E2E asserts a clean console | — | MET | `tests/journey.spec.ts:48` `watchConsole(page)` + `assertNoErrors`; `tests/wave7c-proof.spec.ts:28` prints `ERRORS <width> <theme>: []` per matrix cell and asserts it empty | — |
| 3.11 | E2E is stable on the current tree | — | **NOT MET (working tree)** | `bunx playwright test` on the live tree: **52 pass, 9 fail, 5 skip**. Failing: onboarding, the atom journey, both router tests, two curriculum picker tests, the landing puzzle, teach-back, and one board test. Almost certainly caused by the in-flight edits to `router.tsx`, `routes.ts`, `public-routes.ts`, `main.tsx`, `Auth.tsx` — but on the tree as it stands, **the core journey does not pass** | Nothing to fix in the suite; the in-flight wave must land green before this is meaningful. |
| 3.12 | E2E verified green on the committed `HEAD` | — | **NOT VERIFIED** | I extracted `HEAD` to a scratch dir and ran Playwright there. The run reached 29 pass / 12 fail before I stopped it, but every failure traced to `[vite] Failed to resolve import "@wobo/kgtopg-contract-seed"` — the scratch tree had symlinked root `node_modules` and no per-package workspace links. **The failures are my method, not the code.** I am not reporting a HEAD E2E result | To verify: `git worktree add` a clean checkout, `bun install`, then `bun run test:e2e`. Or read the CI run for a commit where the `e2e` job actually started (see §12 — it has not, recently). |
| 3.13 | Cross-browser coverage (webkit, firefox) runs somewhere automatic | — | **NOT MET** | `tests/x-browser.config.ts:32-36` defines chromium + webkit + firefox at 4 widths × 2 themes — a good matrix. It is **not in CI**: `ci.yml` runs `test:e2e` and `test:e2e:plan` only, and `playwright.config.ts:24` explicitly ignores `x-browser.spec.ts`. It runs when a human types `bun run test:x-browser` | Add a `x-browser` job to `ci.yml`, nightly rather than per-push if the runtime is too high. |
| 3.14 | E2E against the deployed site (production smoke) | release verification | **NOT MET** | No spec targets `heywobo.com` or `api.heywobo.com`. The only mentions of the domain are unit assertions about config strings (`apps/web-pwa/test/domain.test.ts:8`, `test/supabase-url.test.ts:5`) | Add a tiny post-deploy smoke job: load `https://heywobo.com`, assert 200, assert the landing headline, assert `GET api.heywobo.com/health` is 200. |
| 3.15 | E2E test isolation | — | MET | `playwright.config.ts:31-33`: `fullyParallel: false`, `workers: 1`, and the comment states why ("the journey mutates localStorage and shared app state"). `WOBO_E2E_PORT` is overridable so two concurrent runs cannot attach to each other's dev server — a real bug that was found and fixed (`playwright.config.ts:9-16`) | — |
| 3.16 | E2E retries do not mask flake | — | MET | `playwright.config.ts:35` `retries: 0` for the journey suite. `x-browser.config.ts:29` uses `retries: 1` with the reason written inline ("a real break fails twice") | — |

---

## 4. Visual regression

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 4.1 | Visual regression testing exists | Percy / Chromatic / Argos / Playwright `toHaveScreenshot` | **NOT MET** | Zero hits for `toHaveScreenshot`, `percy`, `chromatic`, `argos`, `reg-suit` across `apps`, `packages`, `services`, `.github`. Playwright's own baseline-comparison API is never used | Turn on `expect(page).toHaveScreenshot()` for ~10 key routes in the existing responsive suite and commit the baselines; it is a one-file change to `tests/responsive.spec.ts`. |
| 4.2 | Screenshots are taken | — | MET | `tests/responsive.spec.ts:163,214,244`, `tests/board.spec.ts:224,233`, `tests/wave7c-proof.spec.ts:43,45,80,92`, `tests/x-browser.spec.ts:59`. Output lives in `shots/` (35 files), `respdiag/` (115 files), `xbrowser/` (3 files) at the repo root | — |
| 4.3 | Those screenshots are compared to a baseline by a machine | — | **NOT MET** | They are written to disk and never read back by any assertion. **This is screenshots a human looks at.** The 115 files in `respdiag/` are a diagnostic artefact of the responsive proof, not a gate | See 4.1. Until then, do not describe the repo as having visual regression coverage. |
| 4.4 | Layout regressions are caught programmatically, even without pixel diffing | — | **PARTIAL — and better than most** | `tests/helpers/proof.ts:220-228` defines six machine checks run on every route × width × theme: `route-unreachable`, `horizontal-overflow`, `clipped-text`, `tap-target`, `font-size`, `focus-visible`, asserted at `tests/responsive.spec.ts:186,270`. It also distinguishes animating elements from static ones before reporting (`proof.ts:341`). This catches the layout breaks that matter most without a baseline — but it cannot see a wrong colour, a missing illustration or a broken font | Keep it; add pixel baselines only for the landing hero and the board. |
| 4.5 | Design-token drift is gated | — | MET | `packages/config/test/tokens.test.ts`, `apps/web-pwa/src/ui/tokens.test.ts`, `src/ui/palette.test.ts`, `src/screens/*/styles.test.ts` — the palette and spacing scale are asserted against the token source | — |

---

## 5. Accessibility testing

Full WCAG conformance is another wave's register (`docs/conformance/accessibility.md`). This section
covers only whether accessibility is **tested**, and by what.

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 5.1 | An automated accessibility engine runs in CI | axe-core / pa11y / Lighthouse CI | **NOT MET** | Zero hits for `axe-core`, `@axe-core/playwright`, `jest-axe`, `pa11y`, `lighthouse` across every `package.json`, `.ts` and `.yml` in the repo. **There is no automated WCAG scan of any kind** | `bun add -d @axe-core/playwright` and add `await new AxeBuilder({page}).analyze()` to the 35 routes the responsive suite already opens — that is the single highest-value test change available in this repo. |
| 5.2 | Colour contrast is tested | WCAG 2.2 SC 1.4.3 | **PARTIAL** | `packages/config/test/contrast.test.ts:14-18` implements the WCAG 2.1 ratio formula, sanity-checks it against known pairs (`:26-29`), and asserts `inkFaint` clears 4.5:1 in **both** themes. 5 tests. But this tests the **token palette in isolation** — nothing measures contrast of actual rendered text against its actual background, so a token used on the wrong surface is invisible to it | Covered by 5.1: axe measures rendered contrast. |
| 5.3 | Tap-target size is tested | WCAG 2.2 SC 2.5.8 (24×24 min); 44×44 is the stricter Apple/Android floor | MET | `tests/helpers/proof.ts:398-421` asserts a 44×44 floor, only at the 360 px width, with documented exemptions; run on every route by `tests/responsive.spec.ts` | — |
| 5.4 | Focus visibility is tested | WCAG 2.2 SC 2.4.7 / 2.4.11 | **PARTIAL** | Two mechanisms. Real: `tests/helpers/proof.ts:718-726` emits a `focus-visible` finding per route in the browser. Not real: `apps/web-pwa/test/a11y-contracts.test.ts:24-35` asserts six named source files do not contain the literal string `"outline: 'none'"` — a seventh file, or the same rule written as `outline:none` or in a CSS file, passes it | Extend the browser-side `focus-visible` check to every focusable control, and treat the source grep as a lint rule, not a test. |
| 5.5 | Screen-reader exposure is tested | WCAG 2.2 SC 1.1.1, 4.1.2 | **PARTIAL** | Genuinely tested for the board: `tests/board-reach.spec.ts:29` "the board is not one image, so everything Wobo writes on it is exposed" and `:54` "new ink is announced as it lands" — real assertions in a real browser. For everything else it is source-string matching: `test/a11y-contracts.test.ts:41-44` asserts `Companion.tsx` contains `role="dialog"`, `aria-modal="true"`, `aria-label="Wobo"` | Covered by 5.1; axe checks roles, names and landmarks on every route. |
| 5.6 | Keyboard operability is tested | WCAG 2.2 SC 2.1.1 | **PARTIAL** | Excellent for the board: `tests/board-reach.spec.ts:63` (arrows move the pen, space puts it down) and `:88` (the resize handle resizes from the keyboard). For the app: `tests-plan/plan.spec.ts:116` tests Escape and focus restoration on the cancel dialog. No keyboard-only walk of onboarding, the course, or practice | Add a keyboard-only pass to the existing journey spec (`Tab`/`Enter` instead of `click`). |
| 5.7 | Reduced-motion is tested | WCAG 2.2 SC 2.3.3 | MET | `packages/motion/test/reduced-motion.test.ts`; `apps/web-pwa/src/ui/motion.test.ts`; `packages/wobo/test/…` "the hand under reduced motion — everything still lands, in the same order" (`tests/board.spec.ts:238-243`); the responsive proof takes a reduced-motion pass per route (`tests/responsive.spec.ts:244`) | — |
| 5.8 | Text scaling / font-size floor is tested | WCAG 2.2 SC 1.4.4 | MET | `font-size` is one of the six machine checks in `tests/helpers/proof.ts:226` | — |
| 5.9 | Tested with a real screen reader | WCAG conformance requires human testing | **NOT VERIFIED** | Nothing in the repo records a VoiceOver / NVDA / TalkBack session. This cannot be automated and I cannot verify it from the tree | A human runs VoiceOver on the onboarding and course journeys and writes the result into `docs/conformance/accessibility.md`. |

---

## 6. Performance and load

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 6.1 | **Load testing** | k6 / Locust / Artillery | **NOT MET — stated plainly** | **There is no load testing in this repo.** No k6, Locust, Artillery, autocannon, vegeta or wrk anywhere in `apps`, `packages`, `services`, `infra`, `scripts` or `.github`. Nobody knows what the gateway does at 50 concurrent learners, or what a Railway instance costs at 500 | Write one k6 script hitting `POST /v1/capability/wobo.turn` with a mocked upstream, run it once against staging, and record the number. Until then no capacity claim can be made. |
| 6.2 | Client performance budgets are tested, and on a throttled machine | Core Web Vitals / a stated budget | MET — and unusually good | `tests/board-frames.spec.ts:70,99` assert 55 fps with 2,000 strokes on a 4× throttled CPU. `tests/board-latency-throttled.spec.ts:133` asserts first stroke inside 1 s at 4× CPU + Slow 4G, on the heaviest board; I watched it pass at 33 ms. `tests/board-latency.spec.ts:66,75,93,119` cover cold start and replay across every golden board | — |
| 6.3 | Those budgets run in CI | — | MET | They live in `apps/web-pwa/tests/`, which is exactly what the `e2e` job's `bun run test:e2e` executes | — |
| 6.4 | Server latency budgets are tested | — | **PARTIAL** | `services/gateway/tests/test_board_latency.py` exists and passes. It measures the planner in-process with a stubbed model; it does not measure the deployed gateway, the network, or a real model call | Record real p50/p95 from production telemetry (`services/gateway/src/wobo_gateway/telemetry.py`) and assert against it in a smoke job. |
| 6.5 | Bundle size is gated | performance budget | **NOT MET** | `apps/web-pwa/package.json:8` builds with `vite build`; no `size-limit`, no bundle budget, no CI assertion on output size. With `three`, `@react-three/fiber`, `3dmol`, `@rdkit/rdkit`, `mafs`, `gsap` and `framer-motion` as dependencies this matters | Add `size-limit` or assert `du -sh dist` against a ceiling in the `js` job. |
| 6.6 | Soak / endurance testing | — | **NOT MET** | Nothing runs longer than the 120 s Playwright timeout | Low priority for a direct-to-family product before launch; revisit when the render worker runs continuously. |
| 6.7 | Chaos / fault injection | — | **PARTIAL** | Not systematic, but the important cases are tested by hand-written stubs: `tests-plan/plan.spec.ts:131` "a gateway that is entirely down never draws the plan as Free"; `apps/web-pwa/test/resilience.test.ts` tests fidelity degradation on Save-Data / 2G / reduced-motion; `packages/sdk/test/gateway.test.ts` covers typed refusals and budget exhaustion | Sufficient for now. |

---

## 7. Contract testing — app ↔ SDK ↔ gateway

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 7.1 | The event contract has one source of truth, mirrored across languages, with a drift gate | consumer-driven contract testing | MET — and well done | `packages/contracts/codegen/emit-schemas.ts:41-44` emits from Zod to two byte-identical targets: `packages/contracts/schemas/contracts.bundle.json` and `services/contracts/src/wobo_contracts/_bundle.json`. `packages/contracts/test/contracts.codegen.test.ts:24-27` re-runs the generator in CI and fails on any byte of drift, and `:35` asserts both copies match. It even carries a regression test for a real cross-language bug — a Zod `.refine()` that vanished across the JSON-Schema boundary and let Python accept timestamps TypeScript rejected (`contracts.codegen.test.ts:49-60`) | — |
| 7.2 | The Python mirror validates against that bundle | — | MET | `services/contracts/tests/test_contracts.py` imports `wobo_contracts.validate_event` and asserts valid events pass and invalid ones raise `ContractViolation` | — |
| 7.3 | **The event contract is enforced at runtime** | a contract nobody calls is documentation | **NOT MET** | `grep -rln "wobo_contracts" services content --include="*.py"` returns **exactly one file: its own test.** `validate_event` is defined at `services/contracts/src/wobo_contracts/__init__.py:52` and called from no production code path anywhere in the gateway. On the TS side, `packages/sdk/src/client.ts:198` says in a comment: *"The contract has carried mastery.band.changed.v1 since commit 1 and nothing emitted it."* The codegen drift gate is real, but it guards a contract the running system does not enforce | Either call `validate_event` on the gateway's ingest path, or state in the docs that the bundle is a schema registry rather than a runtime guard. |
| 7.4 | **The SDK's HTTP calls are contract-tested against the gateway's real routes** | Pact / consumer-driven contract testing | **NOT MET — the biggest structural gap in this domain** | The gateway is tested with FastAPI's `TestClient` against the real app (`services/gateway/tests/test_gateway.py:288-591` — real paths, real status codes, real rate limiting). The SDK is tested against **hand-written `globalThis.fetch` stubs** (`packages/sdk/test/gateway.test.ts:24`, `auth.test.ts:30`, `anonymous.test.ts:29`, `supabase.test.ts:19`). Nothing compares the two: `grep -rln "app.routes\|openapi()" services/gateway/tests packages/sdk/test` returns nothing. **A gateway route renamed, a field dropped from a response, or a request body reshaped would leave both suites green and break the product** | Emit the gateway's OpenAPI schema in CI and assert every path the SDK constructs exists in it — a ~40-line test that would have caught every historical drift of this kind. |
| 7.5 | Gateway responses are validated by the SDK before use | trust-boundary validation | **NOT MET** | `packages/sdk/src/gateway.ts:139` — `return (await res.json()) as T;`. A bare cast, no schema. Same pattern at `identity.ts:220,339,359,471`, `providers.ts:144`, `supabase.ts:116,130`, `curriculum/client.ts:112,143`. `zod` **is** a dependency of `packages/contracts` and `packages/wobo`, so the tool is already in the tree and simply is not used at this seam | Replace the cast in `gatewayJson` with a Zod `safeParse` against the response schema; the schemas already exist in `@wobo/contracts`. |
| 7.6 | Migration SQL is checked against the code that queries it | — | **PARTIAL** | The `*_schema.py` tests grep the migration text for the columns and grants the code needs (e.g. `test_subscriptions_schema.py:38-49` lists all 10 columns of `learner.subscriptions`). That catches a dropped column in the SQL; it does not catch the code querying a column the SQL never had | Covered by 8.1 — a real applied migration plus a round trip. |
| 7.7 | Capability registry and tier routing are contract-tested | — | MET | `services/gateway/tests/test_gateway.py:127` "every capability declares a tier and routes on it"; `:288` walks `/v1/capabilities` and asserts the advertised set matches what actually routes | — |
| 7.8 | The advertised sitemap and the router agree | — | MET (as a design) | `apps/web-pwa/src/screens/states/public-routes.test.ts:31` "opens every address the sitemap advertises" — a genuine cross-check between the sitemap and the route table. It is one of the currently-failing tests, correctly, because the in-flight wave added `/donate` to the sitemap ahead of the router | — |

---

## 8. Migration and database testing

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 8.1 | **A migration is proved to apply cleanly to a populated database** | database change management | **NOT MET** | 14 migrations in `infra/supabase/migrations/` (`0001_extensions.sql` … `0014_subscriptions.sql`). **No Postgres is started by any test.** `grep -rln "psycopg\|asyncpg\|testcontainers\|DATABASE_URL"` across `services/gateway/tests` and `services/verifier/tests` returns nothing. The six `*_schema.py` tests are string matches over the `.sql` text, and `test_subscriptions_schema.py:1-8` says so itself: *"No Postgres runs here… They cannot prove that RLS scopes a row, that a revoked grant refuses a write, or that a check constraint holds"* | Add a CI job that runs `supabase db reset` against a local stack, applies all 14 migrations to a database seeded with rows, and runs the two round trips `test_subscriptions_schema.py:14-22` already names. |
| 8.2 | **A migration can be rolled back** | — | **NOT MET** | There are no `down` or rollback files: `ls infra/supabase/migrations | grep -i "down\|rollback"` → empty. Every migration is forward-only with no tested reverse. A bad migration on a live learner database has no rehearsed exit | Write a `down` script for at least the destructive migrations, and prove the round trip (up → seed → down → up) in the same job as 8.1. |
| 8.3 | RLS policies are proved to isolate learners | this is a children's product; row isolation is the whole safety story at the data layer | **NOT MET** | Asserted only as text (`test_subscriptions_schema.py` checks the policy *line* is present). The test file itself names the missing proof: *"two learners, each reading, and neither seeing the other's row."* Nothing runs it | The single most valuable database test to write. Two JWTs, two rows, one assertion. |
| 8.4 | Migrations are applied in a controlled way to production | — | **NOT MET — verified 2026-09-04 after `_challenge.md` C6; this row was NOT VERIFIED and is now settled** | `list_migrations` on project `keepraxqagzgjrrweryt` returns **8** versions (`0001, 0006, 0007, 0008, 0009, 0010, 0011, 0012`) against **14** files in `infra/supabase/migrations/`. `list_tables` over `learner` and `curriculum` returns 22 tables and **no `subscriptions`**, so `0013_mastery_cache_evidence` and `0014_subscriptions` have provably never been applied. The tables from `0002`–`0005` do exist, so those were applied before the ledger began | `supabase migration repair` for the pre-ledger four, `supabase db push` for `0013`/`0014`, then re-run `list_migrations`. |
| 8.5 | Seed / fixture data is separated from schema | — | MET | `infra/supabase/migrations/0004_seed_dev.sql` is named and isolated as dev seed | — |
| 8.6 | The store layer has unit coverage | — | MET | `services/gateway/tests/test_curriculum_store.py`, `test_hospitality_store.py`, `plexus/store.py` at 83% line coverage — the logic around the database is well covered even though the database is not | — |

---

## 9. Flake and determinism

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 9.1 | **The unit suite is stable across repeat runs** | — | MET **for stability; the "0 fail" figure is stale — noted 2026-09-04 after `_challenge.md` C25.** At `5ace319` the challenger got **7 fail / 1611 pass** in `apps/web-pwa`, identical across four consecutive runs: five in `screens/plans/copy.test.ts`, one in `copy.test.ts` "the consent boxes", one in `site/law-v5.test.ts` (see `content-and-safety.md` §8.5). The suite is stable and red, not stable and green | I ran `bun test test/*.test.ts src` **five consecutive times** against the extracted `HEAD`: `1425 pass / 0 fail` every time, identical. Three consecutive runs against the live working tree also gave identical results (`1515 pass / 3 fail / 1 error`, 1518 tests, 115 files each time). **The unit suite is not flaky** | — |
| 9.2 | Assertion counts are stable across runs | determinism | **PARTIAL** | Across three identical working-tree runs the `expect()` totals were 13750, 13750, **13752**. Test count and pass/fail were identical, so this is a test that loops a variable number of times rather than a correctness problem — but it means at least one assertion count depends on something non-deterministic (a clock, a directory listing, or a length that varies) | Low priority. Find it with `bun test --reporter` diffing if it ever becomes a real flake. |
| 9.3 | E2E stability verified across repeat runs | — | **NOT VERIFIED** | I could not get two clean full E2E runs. The working-tree run took over 10 minutes and was mid-edit; the `HEAD` extraction had unresolvable workspace imports (see 3.12). **The most likely place for flake in this repo is the one place I could not measure it** | Run `bunx playwright test --repeat-each=3` on a clean worktree and record the result. This is the single missing measurement in this register. |
| 9.4 | Time is not read directly in tests in a way that flakes | — | MET | Only one test file touches wall-clock or randomness at all: `apps/web-pwa/src/wobo/refusals.test.ts` (grep for `Math.random`/`Date.now()`/`setTimeout` across all `apps/web-pwa/src/**/*.test.ts`). Everything else takes time as an injected parameter | — |
| 9.5 | E2E waits on state, not on timers | flake avoidance | MET | The journey spec waits on visibility and app state throughout (`journey.spec.ts:63,68,72` — `waitFor({state:'visible'})`), with its comments saying so ("wait for it, not a timer"). The one `waitForTimeout(150)` at `journey.spec.ts:34` is inside a polling loop with a deadline, which is the correct shape | — |
| 9.6 | Concurrent test runs cannot collide | — | MET | `playwright.config.ts:18` `WOBO_E2E_PORT` override, with 9 lines of comment explaining the exact bug it prevents (two fleet workflows silently sharing one dev server). The three configs use three distinct default ports (5199, 5211, 5231) | — |
| 9.7 | A flaky-test quarantine or tracking process exists | — | **NOT MET** | No quarantine list, no flake dashboard, no `retries` telemetry. With `retries: 0` a flake is simply a red build | Acceptable at this size; revisit if 9.3 finds flake. |

---

## 10. Coverage — measured, with the caveat that coverage is not correctness

Coverage says which lines ran. It says nothing about whether the assertions that ran were worth
anything — §2.3 and §2.4 are the proof of that: nine engines can be deleted while coverage barely
moves, because the lines that "covered" them were only ever imported, not exercised. Read this table
as a map of *where nothing at all is looked at*, not as a score.

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 10.1 | Coverage is measurable | — | MET | `bun test --coverage` and `uv run --with pytest-cov pytest --cov` both work with no config change | — |
| 10.2 | Gateway (Python) coverage | 80% is a common floor | MET | `uv run --with pytest-cov pytest -q services/gateway --cov=services/gateway/src/wobo_gateway`: **TOTAL 14,079 statements, 1,897 missed, 87%** | — |
| 10.3 | `packages/wobo` coverage | — | MET | `bun test --coverage`: **81.59% functions / 85.07% lines** | — |
| 10.4 | `packages/sdk` coverage | — | MET | **80.80% functions / 79.92% lines** | — |
| 10.5 | `packages/config`, `packages/motion`, `platform/kgtopg-contract-seed` coverage | — | MET | **100% / 100%** for all three | — |
| 10.6 | `packages/contracts` coverage | — | MET | **75.00% functions / 85.53% lines** | — |
| 10.7 | **`apps/web-pwa` coverage** | — | **PARTIAL** | **43.29% functions / 49.36% lines** — the lowest in the repo, on the largest module (85,077 LOC), and the one the family actually touches | See 10.8; the fix is component-level tests (2.2), not more source greps. |
| 10.8 | The React layer has meaningful coverage | — | **NOT MET** | From the same report: `src/store/progress.tsx` **0.00% functions / 11.07% lines**; `src/store/mastery.tsx` 0.00/17.11; `src/shell/AppFrame.tsx` 0.00/17.39; `src/screens/site/SiteShell.tsx` 0.00/6.54; `src/screens/course/shared.tsx` 0.00/9.32; `src/screens/course/Greeting.tsx` 0.00/4.33; `src/curriculum/StatusCard.tsx` 0.00/15.46. `src/ui/cast/characters.tsx` 0.00/3.92 | Follows directly from 2.2 — with no DOM environment, no component function can ever be entered. |
| 10.9 | The subject engines have meaningful coverage | the universal-curriculum claim | **NOT MET** | Every engine in the same report: `ChemScene.tsx` **8.70%/10.65%**, `BioScene.tsx` 9.68/9.68, `PhysicsScene.tsx` 9.09/8.99, `MathScene.tsx` 6.45/33.52, `SocialScene.tsx` 10.53/8.22, `MiniWorkbook.tsx` 11.11/6.41, `MapScene.tsx` 22.22/16.22, `Discovery.tsx` 15.38/13.89, `MotionPlayer.tsx` 0.00/2.69, `DiagramView.tsx` 0.00/5.69 | One E2E test per engine that opens it and asserts it drew something. See 2.4. |
| 10.10 | The lowest-covered gateway modules are known | — | MET | Same run: `plexus/bio.py` **38%**, `plexus/social.py` 43%, `plexus/maps.py` 54%, `plexus/chem.py` 57%, `plexus/lint.py` 59%, `plexus/physics.py` 61%, `plexus/dimensions.py` 67%. The subject validators are the weak half of an otherwise strong service | — |
| 10.11 | Voice and speech client coverage | a headline capability | **NOT MET** | `src/wobo/voice.ts` **55.56% functions / 17.48% lines** (lines 226-466 entirely unexercised); `src/wobo/speech.tsx` 65.91/31.61; `src/wobo/tutor.ts` **34.62/55.61** | Follows from 3.6. |
| 10.12 | Coverage is measured in CI | — | **NOT MET** | `.github/workflows/ci.yml` never passes `--coverage` or `--cov`; no coverage artifact, no badge, no trend | Add `--coverage` to the `js` job and `--cov` to the `python` job and upload the report — visibility first, no threshold yet. |
| 10.13 | A coverage floor is enforced | — | **NOT MET** | No threshold anywhere | Do not add one until 10.12 has run for a few weeks; a floor set on today's numbers would lock in the web-pwa gap. |
| 10.14 | `services/render-worker` coverage | — | **NOT MET** | `bun test` in `services/render-worker`: **5 tests across 1 file** (`src/plan.test.ts`), 15 assertions, for a service of 372 LOC across `plan.ts`, `render.ts`, `Root.tsx`, `Explainer.tsx`. `render.ts` (136 LOC) has no test file at all | Add a test for `render.ts`'s queue-consume and failure paths; it is an operator-run drain worker, so a silent failure there is invisible. |
| 10.15 | `services/verifier` coverage | — | **PARTIAL** | 41 tests across 4 files for 965 LOC (`cas.py` alone is 366). Coverage not separately measured. The verifier is what grounds grading correctness, so it deserves a number | Run `uv run --with pytest-cov pytest services/verifier --cov=services/verifier/src` and record it. |

---

## 11. Type safety and trust boundaries

This is the strongest area in the register.

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 11.1 | TypeScript strict mode | — | MET | `tsconfig.base.json:9` `"strict": true`, inherited by every workspace (`apps/web-pwa/tsconfig.json:2`, all six `packages/*/tsconfig.json`) | — |
| 11.2 | Beyond-strict flags | — | MET | `tsconfig.base.json:10-14`: `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`. `noUncheckedIndexedAccess` in particular is rare and is the flag that stops most array-index bugs | — |
| 11.3 | **No `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck` anywhere** | — | MET | `grep -rn "@ts-ignore\|@ts-expect-error\|@ts-nocheck" apps packages platform services` → **0 hits**. Not one suppression in ~140,000 lines | — |
| 11.4 | `any` is nearly absent | — | MET | 13 hits total across all product source, and 6 of those are the word "any" in prose comments. The **7 real ones are all in third-party interop**: `src/engines/ChemScene.tsx:1022,1024,1053,1130,1132,1151,1154` (RDKit and 3Dmol, neither of which ships types) and `src/engines/MapScene.tsx:72` (`topojson` feature narrowing). Zero `any` in any test file | — |
| 11.5 | Test code type-checks under the same command as product code | — | MET | `apps/web-pwa/tsconfig.json:9,26` includes `test` and `tests` and adds `@playwright/test` + `bun` types, with the reason written inline: *"a broken spec must fail the build, not sit unchecked until someone runs Playwright by hand."* This is why the CI failure at §12 was a `nav.test.ts` type error | — |
| 11.6 | Typecheck passes | — | MET | `bun run typecheck` on the working tree: all 7 workspaces exit 0 | — |
| 11.7 | **Unchecked casts at the trust boundary** | OWASP ASVS 5.1 (validate all input) | **NOT MET** | Every gateway and Supabase response crosses into the app as a bare cast with no runtime validation: `packages/sdk/src/gateway.ts:139` `return (await res.json()) as T`, plus `gateway.ts:88,160`, `identity.ts:220,339,359,471`, `providers.ts:144`, `supabase.ts:107,116,130`, `curriculum/client.ts:112,143`. The compiler believes the shape; nothing checks it. A gateway that returns `{}` on an edge case produces `undefined` field accesses deep in a screen, not a caught error | Wrap `gatewayJson` in a Zod `safeParse`. `zod@^4` is already a dependency of `@wobo/contracts` and `@wobo/wobo`. |
| 11.8 | `localStorage` is parsed defensively | same boundary, user-writable | **PARTIAL** | ~20 sites do `JSON.parse(localStorage.getItem(...)) as T` (`src/curriculum/cache.ts:37,57`, `src/screens/course/shared.tsx:49,59,73,84`, `src/ui/avatars.tsx:137,171`, `src/shell/CommandPalette.tsx:54`, `src/screens/you/ledger.ts:17`, and more). **Three do it properly** and are the pattern to copy: `packages/sdk/src/state.ts:277` (`normalizeLearnerState`), `mastery.ts:151` (`normalizeMasterySnapshot`), `src/curriculum/placement.ts:292` (parses to `unknown` first). Most are wrapped in try/catch so a throw degrades rather than crashes, but a *well-formed wrong shape* passes straight through | Extend the `normalize*` pattern to the remaining call sites, or add one `readJson<T>(key, schema)` helper and route them all through it. |
| 11.9 | Python typing is enforced | — | **NOT MET** | `pyproject.toml` configures `ruff` (`[tool.ruff.lint] select = ["E","F","I","B","UP","SIM","C4"]`) but **no `mypy` or `pyright`**, and `ci.yml`'s `python` job runs `ruff` and `pytest` only. `from __future__ import annotations` and full annotations are used throughout the source, so the types are written — they are simply never checked | Add `uvx mypy services` to the `python` job; the annotations are already there, so the cost is mostly in fixing what it finds once. |
| 11.10 | Lint is clean | — | **PARTIAL** | `bunx biome check .` at `HEAD`: 687 files, **1 warning, 0 errors**. On the live working tree: **3 errors**, all `lint/style/useTemplate` in the untracked `zz-verify*.spec.ts` scratch files of §1.10 | Delete the `zz-*` files. |
| 11.11 | Lint runs in CI | — | MET | `.github/workflows/ci.yml`, `js` job: `bunx biome check .`; `python` job: `uvx ruff check services content` | — |
| 11.12 | Lint suppressions are audited | — | MET | The one biome warning at `HEAD` is `suppressions/unused` at `design/salvage/AdventureRoadmap.tsx:454` — a stale suppression in a salvage directory, not shipped code. `pyproject.toml:35-64` documents a per-file `E501` ignore list with a written justification per entry (prompts, inline SVG, transcribed syllabus text) | — |

---

## 12. CI as a gate — does any of this actually stop a bad commit

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 12.1 | CI exists and runs on every push and PR | — | MET | `.github/workflows/ci.yml`, `on: push/pull_request` for `main`, `the-life`, `phase-*`. Five jobs: `js`, `gates`, `e2e`, `python`, `render-worker` | — |
| 12.2 | CI covers every stack in the repo | — | MET | typecheck + biome + bun test + web build (`js`); three brand gates against the real bundle (`gates`); Playwright journey + cancel suites (`e2e`); ruff + four pytest suites (`python`); the isolated render worker (`render-worker`) | — |
| 12.3 | CI is well-constructed | — | MET | Bun and Playwright browser caches; `concurrency` with `cancel-in-progress`; `forbidOnly` in CI; the Playwright report uploaded as an artifact on failure; and the comments explain the non-obvious choices — notably that the `js` job builds with `VITE_LLM_MODE=mock` so no CI artifact is a live-mode bundle, while the `gates` job deliberately builds the **real** bundle so the white-label gate reads real vendor hostnames | — |
| 12.4 | **CI is actually green** | a red pipeline is not a gate | **NOT MET** | `gh run list --workflow=ci.yml --limit 40`: **20 failure, 15 cancelled, 5 success.** The most recent success is `2026-09-03T04:50:08Z`, and all three recent successes are **docs-only commits**. **No code commit has passed CI on `the-life` in over 24 hours** | The in-flight wave must land green. Until then, no claim in this repo is backed by a passing pipeline. |
| 12.5 | The specific failures are known | — | MET | Run `33849763034` (`gh run view --log-failed`), three jobs failed: (a) `python` — `test_ask_public.py:572` chip/placeholder text drifted from `site-security.html`, and `test_consent.py:68` `assert 200 == 400` on the plus-plan turn budget; (b) `js` and `gates` both — `src/screens/site/nav.test.ts(35,31): error TS2769` and `(74,36)`, a typecheck error **inside a test file**, which by 11.5's design correctly fails the build | — |
| 12.6 | The `e2e` job is providing signal | — | **NOT MET** | In the last several runs `e2e` never reported, because `js` and `python` failed first and the runs were cancelled or the job never completed. Of the last 40 runs, 15 were `cancelled` — the `concurrency` group cancels the previous run on each new push, and pushes are arriving faster than a 14-minute pipeline finishes. **The most expensive and most valuable job is the one least often reaching a verdict** | Reduce push frequency during a wave, or split `e2e` into its own workflow so a fast `js` failure does not cost the E2E signal. |
| 12.7 | Branch protection requires CI to pass before merge | — | **NOT VERIFIED** | I cannot read branch-protection rules from the working tree | `gh api repos/:owner/:repo/branches/main/protection`. Given 12.4, if `the-life` merges to `main` without a required check, red code reaches `main`. |
| 12.8 | Automated dependency updates | — | **NOT MET** | `.github/` contains only `workflows/`. No `dependabot.yml`, no Renovate config | Add `.github/dependabot.yml` for `bun`, `uv` and `github-actions`. (Supply chain is another register's domain; noted here because it is a CI gate.) |
| 12.9 | Static application security testing in CI | — | **NOT MET** | No CodeQL workflow, no Semgrep, no `bun audit` / `pip-audit` step | Add the CodeQL starter workflow for `javascript-typescript` and `python`. (Cross-references `docs/conformance/application-security.md`.) |
| 12.10 | Secrets scanning in CI | — | **NOT VERIFIED** | GitHub's push protection is a repo setting, not a file I can read | `gh api repos/:owner/:repo` and check `security_and_analysis.secret_scanning_push_protection`. |
| 12.11 | The verify command in every brief is trustworthy | — | MET | This was a real historic defect — `bun test` at the root collected the Playwright specs and exited 1 with collection errors while every assertion passed, so "the verify command in every brief has never been green" (`bunfig.toml:5-11`). It is fixed and the fix is documented | — |

---

## 13. Test process and practice

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 13.1 | Tests are named in the language of the product, not the code | — | MET | "two taps reach the confirmation and a refused cancel leaves the plan active"; "the world a learner ends up with never invents a board or a class"; "says nothing about a year once monthly is chosen". A reviewer can read the test list as a specification | — |
| 13.2 | Tests document *why* they exist | — | MET | Most suites open with a header explaining the bug or law they encode — e.g. `src/screens/site/law-v5.test.ts:5-8` names the six copy-law violations that were live before the test existed; `tests-plan/config.ts` and `ci.yml` explain why the cancel suite needs its own config | — |
| 13.3 | Test fixtures are realistic | — | MET | The E2E brain stub (`tests/helpers/brain.ts`) serves real syllabus and board payloads; `apps/web-pwa/src/wobo/goldens/` holds twelve real board plans across four subject families (`benzene.json`, `photosynthesis-balance.json`, `free-body-incline.json`, `long-division.json`, `plant-cell.json`, `food-web.json`, …) | — |
| 13.4 | Test-double boundaries are documented | — | MET | `playwright.config.ts:56-63` states exactly what is stubbed and why; `tests/global-setup.ts` fails loudly if the app can reach a gateway | — |
| 13.5 | A test plan / test strategy document exists | ISO/IEC 29119-3 | **NOT MET** | `docs/` has no test plan. The strategy is real but lives only as prose inside config files and test headers | One page in `docs/`: what is tested at which level, what is deliberately not tested, and who signs off before a release. |
| 13.6 | Defects found in testing are tracked | — | **NOT VERIFIED** | No issue tracker links from the repo; `gh issue list` was not part of this domain's scope | Check whether GitHub Issues is in use, or say plainly that the progress board (`tools/progress`) is the tracker. |
| 13.7 | Manual / exploratory test evidence is retained | — | **PARTIAL** | 153 screenshots retained across `shots/`, `respdiag/`, `xbrowser/`, and `respdiag/` carries a generated report (`tests/helpers/proof.ts:792` writes the prose summary). But nothing records *who looked at them, when, and what they concluded* | Keep a dated one-line sign-off with each responsive proof run. |
| 13.8 | Test data contains no real children's data | children's-product requirement | MET | Fixtures are synthetic throughout: `'Learner'` and `'2012-04-08'` in `journey.spec.ts:66,72`; UUIDs of the form `00000000-0000-7000-8000-…` in `services/contracts/tests/test_contracts.py:15-17`. No real names, emails or dates of birth in any fixture I read | — |
| 13.9 | Tests can run offline / without credentials | — | MET | Every suite I ran completed with no secrets and no network: `bun run test`, all four pytest suites, and the Playwright configs (which blank every endpoint by construction) | — |
| 13.10 | Suite runtime is acceptable | fast feedback | MET | Unit suites: web-pwa 7.9 s, wobo 0.23 s, sdk 0.15 s, all others under 0.1 s. Gateway pytest: ~40 s for 2,988 tests. E2E is the slow one (>10 min) but it is correctly a separate CI job | — |
| 13.11 | Safety and refusal behaviour is tested | children's product; the core promise | MET | `services/gateway/tests/test_safety.py` (273 lines), `test_hardening.py` (874 lines), `test_wobo.py` (507 lines), plus `apps/web-pwa/src/wobo/refusals.test.ts` on the client. Detailed conformance is `docs/conformance/content-and-safety.md`'s domain; recorded here as tested | — |
| 13.12 | LLM output quality is evaluated (an eval harness) | LLM product practice | **NOT MET** | There is no eval harness: no `evals/` directory, no golden-answer set for tutor turns, no judge, no regression scoring of model output. `content/atom/` is the nearest thing and is explicitly a *deterministic, no-model-call* verifier test (`content/atom/tests/test_grade.py:1-6`). **The product's central claim — that Wobo teaches well — has no test at all.** Everything tested is the plumbing around the teaching | Build a small eval set: 50 turns across subjects with rubric-scored expected behaviour, run on demand, tracked over time. This is the largest untested claim in the product. |

---

## 14. Considered and marked N/A

Recorded rather than dropped, so the register shows they were weighed.

| # | Item | Standard | Status | Why |
|---|---|---|---|---|
| 14.1 | Mobile app store testing (TestFlight, Play Console pre-launch) | — | N/A | The product ships as an installable PWA (`vite.config.ts:129` `VitePWA`), not a native binary. There is no store submission to test. Becomes live the day a native wrapper ships. |
| 14.2 | Multi-tenant / organisation isolation testing | — | N/A | Direct-to-family. There is no school or district tenant — `git log` shows schools were deliberately removed ("site: schools removed everywhere (we do not serve them yet)"). Learner-to-learner isolation is covered instead, at 8.3, and it is **not met**. |
| 14.3 | Localisation / i18n testing | — | N/A | Single locale (English, India-facing). No translation files and no `Intl` message catalogue in the tree. Becomes live on the first second language. |
| 14.4 | Backwards-compatibility testing of a public API | — | N/A | The gateway serves only this repo's own client; there is no published API with third-party consumers to keep stable. The internal seam is covered at 7.4, and it is **not met**. |
| 14.5 | Hardware / device-farm testing | — | N/A | No hardware. Device breadth is approximated by the cross-browser matrix (3.13, **not in CI**) and the responsive proof at 4 widths (4.4). |
| 14.6 | Formal UAT with a defined acceptance-criteria sign-off | ISO 29119-2 §7 | N/A for the current stage | Pre-launch, owner-reviewed. Becomes live before the first paying family; 13.5's test plan is where it would be recorded. |
| 14.7 | Accessibility testing for AT hardware (braille displays, switch access) | — | N/A for now | Out of scope until 5.1 and 5.9 exist; scanning and a screen-reader pass come first. |
| 14.8 | Disaster-recovery / backup-restore drill | — | N/A to this domain | Belongs to `docs/conformance/supply-chain-and-operations.md`. Noted so it is not lost between registers. |

---

## 15. Summary of counts

| Status | Count |
|---|---|
| MET | 64 |
| PARTIAL | 17 |
| NOT MET | 40 |
| N/A | 8 |
| NOT VERIFIED | 7 |
| **Total items** | **136** |

Counted mechanically from the tables above, not by hand:

```
awk -F'|' '/^\| [0-9]+\.[0-9]+ \|/ {print $5}' docs/conformance/testing-and-quality.md | sort | uniq -c
```

## 16. The gaps that would actually hurt, worst first

1. **The product's central claim — that Wobo teaches well — has no test at all** (13.12). There is no
   eval harness, no golden tutor turns, no scoring. Every one of the 5,400+ tests is about the
   plumbing around the teaching.
2. **Nine subject engines can be deleted and 1,419 of 1,420 unit tests stay green** (2.4, measured).
   The visible teaching surface of the universal-curriculum claim is unverified by the unit layer.
3. **No migration has ever been applied to a database by a test, and there is no rollback** (8.1,
   8.2). Fourteen forward-only migrations, and RLS learner-to-learner isolation — the entire data
   safety story for a children's product — is asserted only as text (8.3).
4. **No load testing at all** (6.1). Nobody knows the gateway's capacity or cost at any concurrency.
5. **No contract test between the SDK and the gateway** (7.4), and every gateway response enters the
   app as an unchecked cast (7.5, 11.7). A renamed route or dropped field breaks the product with
   both suites green.
6. **CI has not passed on a code commit in over 24 hours** (12.4), and the E2E job — the most
   valuable one — is usually cancelled before it reports (12.6).
7. **No automated accessibility scan anywhere** (5.1), for a product built for children.
8. **No end-to-end coverage of sign-up/sign-in** (3.3) — the first door every family walks through —
   nor of parent linking (3.5), voice (3.6), or offline/PWA (3.7).
9. **No component ever renders in a unit test** (2.2); `apps/web-pwa` sits at 43% coverage on 85,000
   lines, with the whole React store and shell layer at or near 0% (10.7, 10.8).
10. **Visual regression is a human looking at screenshots** (4.3), not a gate.

## 17. What could not be verified, and what would verify it

1. **E2E flake** (9.3) — I could not get two clean full runs (mid-edit tree; broken workspace
   resolution in my `HEAD` extraction). → `git worktree add` a clean checkout, `bun install`, then
   `bunx playwright test --repeat-each=3`.
2. **E2E green on committed `HEAD`** (3.12) — same cause. → Same fix.
3. **Branch protection** (12.7) → `gh api repos/:owner/:repo/branches/main/protection`.
4. **Secret-scanning push protection** (12.10) → `gh api repos/:owner/:repo`, read
   `security_and_analysis`.
5. **Migrations actually applied to the production Supabase project** (8.4) → `supabase migration
   list --linked`, diffed against `infra/supabase/migrations/`.
6. **Human screen-reader testing** (5.9) → a person runs VoiceOver or NVDA through onboarding and
   the course and writes down what happened. Not inferable from the tree.
7. **Defect tracking** (13.6) → confirm whether GitHub Issues is in use (`gh issue list`) or state
   plainly that `tools/progress` is the tracker of record.

## 18. Note for whoever reads this next

Two things in this repo are better than the register's "NOT MET" count suggests, and should not be
lost in the noise.

The first is **type discipline**. Zero `@ts-ignore` in 140,000 lines, `noUncheckedIndexedAccess` on,
test files type-checked under the same command as product code. That is rarer than any test-count
figure here.

The second is **honesty in the tests themselves**. `services/gateway/tests/test_subscriptions_schema.py`
opens by telling the reader that no Postgres runs, that it cannot prove RLS scopes a row, and then
lists the two round trips that would close the gap. `bunfig.toml` documents the day the verify
command was silently broken. `playwright.config.ts` documents the exact concurrency bug it prevents.
That habit is the reason this audit could be specific rather than vague — and it is the standard the
rest of the suite should be raised to, not the exception.

The gap in this domain is not effort. It is that the effort went into the layer that is cheap to
test (pure functions, source text, copy) and stopped at the layer that costs money to test (rendered
components, a real database, a real browser talking to a real service, and the model's actual
teaching).
