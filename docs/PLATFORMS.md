# PLATFORMS.md — the same app, on every device

Dated 2026-09-03. The readiness audit and the plan for shipping `apps/web-pwa` as native apps: Capacitor for iOS and Android (phones and tablets), Tauri v2 for macOS, Windows and Linux. Companion to `docs/WOBO-PLAN.md` §17 (white label), §18 (device agnostic) and `DEPLOY.md` (the gateway contract). The task list in §12 is written to be pasted into `docs/WOBO-TASKS.md` Wave 8.

The law this file serves: one codebase, one Wobo, one learner. A native app is a shell around the same web app, not a second product. Nothing is rewritten for a platform; where a platform needs something the browser cannot give, a bridge is added behind an interface the web build already has.

Every version and every store rule below was fetched from the official documentation on 2026-09-03 and is cited in §13. Nothing here is from memory.

---

## 1. The shape of it

Three build outputs from one source tree:

| Output | Shell | Targets | What it is |
|---|---|---|---|
| Web | none | any browser, installable PWA | `bun run build` in `apps/web-pwa`, today's deploy |
| Mobile | Capacitor 8 | iOS 15+, Android 7+ (API 24+), phone and tablet | the same `dist/` copied into a native project, served from a local WebView origin |
| Desktop | Tauri 2 | macOS 10.15+, Windows 7+, Linux with webkit2gtk 4.1 | the same `dist/` embedded in a Rust binary |

The web app stays the source of truth. Both shells consume `apps/web-pwa/dist` unmodified except for a small number of build-time flags (§4.6). Neither shell forks a screen, a component or a copy string.

Workspace layout to add, alongside `apps/web-pwa`:

```
apps/
  web-pwa/            unchanged
  mobile/             capacitor.config.ts, ios/, android/, fastlane/
  desktop/            src-tauri/ (tauri.conf.json, Cargo.toml)
```

Both new workspaces depend on `@wobo/web-pwa` only for its built assets, never for source. Neither gets its own React tree.

---

## 2. Verified versions

Fetched 2026-09-03 from the npm registry and the official docs. Pin these exactly; do not float.

**Capacitor 8**

| Package | Version |
|---|---|
| `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android` | 8.5.1 |
| `@capacitor/app` | 8.1.1 |
| `@capacitor/preferences` | 8.0.1 |
| `@capacitor/push-notifications` | 8.1.2 |
| `@capacitor/local-notifications` | 8.3.1 |
| `@capacitor/camera` | 8.2.4 |
| `@capacitor/filesystem` | 8.1.3 |
| `@capacitor/haptics` | 8.0.2 |
| `@capacitor/keyboard` | 8.0.5 |
| `@capacitor/status-bar` | 8.0.3 |
| `@capacitor/splash-screen` | 8.0.2 |
| `@capacitor/share` | 8.0.1 |
| `@capacitor/browser` | 8.0.4 |
| `@capacitor/network` | 8.0.1 |
| `@capacitor/device` | 8.0.3 |
| `@capacitor/screen-orientation` | 8.0.1 |
| `@capacitor/assets` (dev) | 3.0.5 |
| `@aparajita/capacitor-secure-storage` | 8.0.0 |
| `@capgo/capacitor-updater` (only if live updates are adopted, §10) | 8.51.15 |
| `@revenuecat/purchases-capacitor` (only if in-app purchase is adopted, §6) | 13.5.0 |

Platform floors, from the Capacitor 8 docs: iOS 15 or later with Xcode 26.0 or later; Android API 24 (Android 7) or later, requiring an Android System WebView at Chrome 60 or later.

**Tauri 2**

| Package or crate | Version |
|---|---|
| `@tauri-apps/cli` | 2.11.4 |
| `@tauri-apps/api` | 2.11.1 |
| `tauri` (crate) | 2.11.5 |
| `tauri-build` (crate) | 2.6.3 |
| `@tauri-apps/plugin-updater` / `tauri-plugin-updater` | 2.11.0 |
| `@tauri-apps/plugin-deep-link` / `tauri-plugin-deep-link` | 2.4.10 |
| `tauri-plugin-single-instance` | 2.4.4 |
| `@tauri-apps/plugin-notification` | 2.4.0 |
| `@tauri-apps/plugin-store` | 2.4.4 |
| `@tauri-apps/plugin-global-shortcut` | 2.3.2 |
| `@tauri-apps/plugin-os` | 2.3.2 |
| `@tauri-apps/plugin-log` | 2.9.1 |
| `wry` (webview layer, transitive) | 0.56.0 |

Tauri prerequisites: Rust via `rustup`; on macOS, Xcode or the command line tools; on Windows, the Microsoft C++ Build Tools with "Desktop development with C++" and WebView2 (preinstalled from Windows 10 1803 onward, otherwise the Evergreen Bootstrapper), plus VBSCRIPT enabled only if an MSI is built; on Linux, `libwebkit2gtk-4.1-dev` and the usual build chain. Supported floors are macOS 10.15 and Windows 7.

`wry` 0.56.0 matters specifically: it added the expanded permission handling API across WebView2, WKWebView, WebKitGTK and Android, including `PermissionResponse::Prompt` to raise the native system dialog, and on macOS it splits camera and microphone requests. This is what makes Wobo's voice viable on desktop without a custom fork.

---

## 3. What already works unchanged

The web app was built device-agnostic and stack-local, which pays off here. The following need no bridge at all.

- **The whole React tree.** React 19, framer-motion 11, the router, every screen. Both shells run a Chromium-class or WebKit engine that meets the app's floor.
- **The board.** `packages/wobo/src/board/*` is SVG and Canvas with an opentype path renderer. No platform surface is touched.
- **The engines.** Three.js and `@react-three/fiber` need WebGL2, present on all six targets. Mafs, the SVG diagram engines, the map and geo engines, CodeMirror — all pure DOM.
- **Fonts.** Both variable faces are bundled locally through `@fontsource-variable/*` and imported from `apps/web-pwa/src/main.tsx`. There is no font CDN round trip, so a native app with no network still renders in the right typeface on first paint. This is already the law in `DEPLOY.md` §1.1 and it happens to be exactly what a native shell needs.
- **The design tokens.** Injected once from `@wobo/config/css` in `main.tsx`, no build-time CSS host dependency.
- **The gateway client.** `packages/sdk/src/gateway.ts` is plain `fetch` with one auth header and typed refusals. It works from any origin the gateway allows. No cookie, no same-origin assumption.
- **Identity storage is already abstracted.** The identity provider in `packages/sdk/src/identity.ts` takes an injectable `storage: KVStorage` and only falls back to `localStorage`. Swapping in native secure storage is a constructor argument, not a rewrite (§4.4).
- **Offline queueing.** `apps/web-pwa/src/store/downloads.ts` and `src/shell/resilience.ts` are storage plus events, no service worker dependency in the logic itself.
- **Theme, reduced motion, accessibility.** `src/ui/theme.ts` and `src/ui/access.ts` read media queries the native WebViews honour.
- **The three-width discipline.** Plan §18 already requires every screen to be proven at 360, 820 and 1440 in both themes. That is the same work as tablet readiness; it is not extra.

**One thing that is nearly free and should be claimed:** `apps/web-pwa/src/shell/router.tsx` already mirrors its stack into the History API and exposes `routeToPath` and `pathToRoute` as pure functions. Deep links (§4.5) become a five-line listener rather than a routing rewrite, because that work is done.

---

## 4. What needs a native bridge

### 4.1 Microphone and the voice relay

Today: `apps/web-pwa/src/wobo/voice.ts` calls `navigator.mediaDevices.getUserMedia({ audio: … })`, builds a capture `AudioContext` and a 24 kHz playback `AudioContext`, pushes PCM16 up `wss://…/v1/voice/relay` with a single-use minted token, and plays Wobo's reply back with minimal buffering. `apps/web-pwa/src/wobo/speech.tsx` runs a second, streaming TTS socket over a shared `AudioContext`.

- **iOS.** WKWebView has supported `getUserMedia` since iOS 14.3, so the code path itself is fine. Two native changes are required. First, `NSMicrophoneUsageDescription` in `Info.plist`, written in Wobo's voice and in sentence case, or the call is rejected with no dialog. Second, implement `WKUIDelegate`'s `webView(_:requestMediaCapturePermissionFor:initiatedByFrame:type:decisionHandler:)` in the Capacitor bridge subclass, or iOS raises the permission dialog on *every* `getUserMedia` call — which for hold-to-talk means a dialog on every single hold. This is the highest-value native task in the whole mobile port.
- **Android.** `RECORD_AUDIO` in the manifest plus a runtime request, and a `WebChromeClient.onPermissionRequest` grant for `RESOURCE_AUDIO_CAPTURE`. Capacitor's bridge handles the WebView half; the runtime request is ours.
- **Desktop.** `wry` 0.56.0's permission API covers all three engines. On macOS the app bundle still needs `NSMicrophoneUsageDescription` and the `com.apple.security.device.audio-input` entitlement. On Linux, WebKitGTK routes capture through GStreamer, so `gstreamer1.0-plugins-good` (and on some distributions `-bad`) must be a package dependency of the `.deb` and `.rpm`, and the AppImage must carry them. Without it, `getUserMedia` fails on a clean install with no useful error.
- **`ScriptProcessorNode`.** `voice.ts:259` uses `createScriptProcessor(1024, 1, 1)` with a comment naming the AudioWorklet upgrade. On a mid-range Android device the main-thread processor is the likeliest source of audible capture jitter, because the main thread is also running framer-motion and the board. Move to an `AudioWorkletProcessor` before the Android beta, not after. This is a web-side change that benefits every target.
- **Sample rate.** The code already reads the real capture rate and resamples, because Safari ignores the 16 kHz hint. That behaviour is correct on both native WebKit targets and needs no change.

### 4.2 Background audio

Wobo's podcasts (`src/engines/PodcastPlayer.tsx`) and long narration are the only reason to want this. Today, locking the phone stops the audio.

- **iOS.** Requires `UIBackgroundModes` containing `audio` in `Info.plist` and an `AVAudioSession` category of `.playback` (or `.playAndRecord` while the voice relay is live) activated from native code. Apple reviews this: an app that declares the audio background mode without genuinely playing audio in the background is rejected. Declaring it is a commitment to ship a real background listening experience, including lock-screen controls via `MPNowPlayingInfoCenter` and remote command handling.
- **Android.** A foreground service with a `mediaPlayback` type and its notification, plus `FOREGROUND_SERVICE_MEDIA_PLAYBACK`. Android 14 and later enforce the declared foreground service type strictly.
- **The call.** Background audio is a Wave 8.5 item, not a launch blocker. Ship the first native release with audio that pauses on background, because that is honest and reviewable, and add background playback as a deliberate feature once the podcast surface is genuinely worth listening to with the screen off. Do not declare the background mode before then.
- **The voice relay must stop on background regardless.** An open microphone socket in the background is both a battery problem and a privacy claim we do not want to make about a product used by children. Wire `App.addListener('appStateChange')` to `voice.stop()` and to `stopSpeaking()`.

### 4.3 Push notifications

The lifecycle moments in plan §14 (first aha, first board saved, win-back after seven quiet days, exam surges) and the download-ready moment in `src/store/DownloadCenter.tsx` are the honest uses.

- **iOS** uses APNs directly through `@capacitor/push-notifications`; no third-party messaging SDK is needed. Enable the Push Notifications capability in Xcode and add the two `AppDelegate` registration methods the plugin documents.
- **Android** needs the push service configuration file (`google-services.json`) in the app module. The plugin wires the SDK itself; no manifest editing beyond the notification icon metadata. Android 13 and later require an explicit `POST_NOTIFICATIONS` grant, so `checkPermissions()` then `requestPermissions()` must be called at a moment that earns it — after the first genuine aha, never on first launch.
- **Desktop** uses `@tauri-apps/plugin-notification` for local notifications only. Remote push on desktop is out of scope; the desktop app polls the same lifecycle state on focus.
- **The rule that constrains us.** Apple guideline 5.1.2 forbids requiring push to be enabled in order to use functionality or receive anything. Nothing Wobo does may be gated behind a granted notification permission. And under Play's Families policy, a child-directed app must not use advertising identifiers, so notification targeting is keyed to our own subject id and nothing else.
- **Consent.** Marketing consent for a minor lives with the parent (plan §14 compliance rails). The notification permission prompt is a device permission, not consent to market. Two separate doors, and the parent link (§4.5) is where the marketing one lives.

### 4.4 Secure storage for the session token

Today, `packages/sdk/src/identity.ts` persists `{ access_token, refresh_token, expires_at, subject_id }` as JSON under `AUTH_SESSION_KEY = 'wobo-auth-session-v1'`, defaulting to `localStorage`. In a browser that is defensible. In a native app it is not: WebView local storage sits in the app container as a readable file, so on a rooted or jailbroken device, or in a device backup, a refresh token is recoverable in plain text.

The fix is small because the seam exists.

- **Mobile.** Implement a `KVStorage` over `@aparajita/capacitor-secure-storage` 8.0.0, which stores on the iOS Keychain and the Android EncryptedSharedPreferences with a hardware-backed key where available. Pass it as the identity config's `storage` field. Nothing else in the SDK changes.
- **Desktop.** Same shape over `@tauri-apps/plugin-store` 2.4.4 backed by the OS keyring, or a small Rust command over the platform keychain. On Linux, degrade honestly when no keyring is present rather than silently writing plaintext.
- **`@capacitor/preferences` is not secure storage.** It is `UserDefaults` and `SharedPreferences`. Use it for the mute flag, the theme, the download queue — never for a token.
- **Everything else stays in local storage.** The dossier, the download queue, the board notes and the progress marks are not credentials. Scoping them per account is already Wave 3 work; native does not change it.
- **Migration.** On first native launch, read the legacy `localStorage` value, write it to secure storage, and clear the original. `apps/web-pwa/src/store/legacy-keys.ts` already establishes this pattern and the migration should be added there.

### 4.5 Deep links

Two flows need them: the parent link (`apps/web-pwa/src/screens/You.tsx`, which builds `inviteLink(origin, kind, referralCode())` today and copies it to the clipboard) and every email call to action the gateway sends.

- **iOS.** `apple-app-site-association`, with no file extension, served from `https://heywobo.com/.well-known/apple-app-site-association` with `{"applinks":{"apps":[],"details":[{"appID":"TEAMID.com.heywobo.wobo","paths":["*"]}]}}`, and the Associated Domains capability with `applinks:heywobo.com`.
- **Android.** `assetlinks.json` at `https://heywobo.com/.well-known/assetlinks.json` carrying the release keystore's SHA-256 fingerprint, plus an `intent-filter` with `android:autoVerify="true"` for scheme `https` and host `heywobo.com`.
- **Desktop.** `tauri-plugin-deep-link` 2.4.10 with a `wobo://` custom scheme, paired with `tauri-plugin-single-instance` 2.4.4 so a second launch hands the URL to the running window instead of opening a second one.
- **The code.** A deep link does not navigate the WebView; it fires an event. Add a listener that calls the router's existing pure `pathToRoute`:

  ```ts
  // apps/web-pwa/src/shell/deep-links.ts (new, guarded by the native flag)
  App.addListener('appUrlOpen', ({ url }) => {
    const route = pathToRoute(new URL(url).pathname);
    if (route) router.navigate(route);
  });
  ```
- **The web fallback must stay perfect.** A parent without the app installed opens the same URL in a browser and gets the same read-only progress page. Universal links fail open to the web by design, and that is the behaviour we want.
- **`inviteLink` needs no change** as long as `VITE_APP_URL` is the real domain, because the link is built from the origin, not from a hardcoded host. That is already the case.
- **OAuth is the sharp edge.** `identity.ts` signs in with the identity service's implicit redirect flow, returning tokens in the URL fragment to `location.origin`. In a native shell, `location.origin` is a local WebView origin on mobile and a custom-protocol origin that differs per desktop platform (§4.7, to be measured), none of which an identity provider will accept as a redirect target. Native sign-in must instead open a system browser (`@capacitor/browser`, which uses `SFSafariViewController` and Custom Tabs) and come back through the app link. Apple guideline 5.1.1 also forbids storing social credentials off device, which our flow already respects. Phone OTP has no such problem and should stay the default door on native.

### 4.6 Offline caching and the service worker

`vite-plugin-pwa` is configured in `apps/web-pwa/vite.config.ts` with `registerType: 'autoUpdate'`, `skipWaiting`, `clientsClaim`, a 2.5 MiB precache ceiling and a runtime rule for the RDKit wasm.

- **Turn the service worker off in native builds.** Service workers cannot be registered from the `capacitor://` scheme on iOS, and on Android they need a workaround. More importantly they are pointless there: Capacitor and Tauri already ship the whole bundle inside the app, so offline-first is the default state, and a stale service worker cache on top of a bundled app is a source of the exact "shipped feature looks missing" bug the current config was written to prevent. Gate `VitePWA(...)` behind a `WOBO_TARGET` env check so `WOBO_TARGET=native` builds omit it entirely.
- **The RDKit wasm is 6.9 MB and currently lazy-fetched.** In a native build it must be bundled, not fetched, or the chemistry cards fail offline. It goes into the app bundle and pushes the download size up; that is the correct trade for a product that promises to work on a dead network.
- **Pre-synced learning packs** — `docs/WOBO-TASKS.md` Wave 8, "**Offline** — pre-synced learning packs; the board works offline for cached lessons" — are the real offline story, and they are storage, not caching. On native, back them with `@capacitor-community/sqlite` or the filesystem rather than IndexedDB, because a WebView's storage can be evicted under pressure while app-container files cannot.
- **Apple guideline 4.2.3(ii)** requires disclosing the size of any resources the app must download on first launch and prompting before doing so. If any learning pack is fetched on first run, that prompt is mandatory and must be written in Wobo's voice.

### 4.7 Origins, CORS and CSP

This is the single most likely cause of a native build that looks broken with no visible error.

- **The origins change.** Capacitor serves from `https://localhost` on Android (`androidScheme` defaults to `https`) and `capacitor://localhost` on iOS (`iosScheme` defaults to `capacitor`), with `hostname` defaulting to `localhost` so that secure-context APIs including `getUserMedia` are available. Tauri serves over a custom protocol whose exact origin string differs by platform, because WebView2 cannot register a custom scheme with a path. Do not guess these: log `window.location.origin` on each of the five native targets in the first spike and record the real values in `DEPLOY.md`.
- **The gateway allow-list must learn them.** `APP_URL` is the CORS allow-list entry (`DEPLOY.md` §0). Add an explicit list of native origins as a separate service variable rather than widening `APP_URL`, so the web origin stays exactly one value. The voice relay handshake should check `Origin` against the same list.
- **CSP is no longer a response header on native.** The web CSP lives in the root deploy config and is served by the host; a WebView loading from the app bundle never sees it. Native builds need the equivalent policy expressed in `tauri.conf.json` under `app.security.csp` (Tauri appends its own nonces and hashes at compile time) and as a `<meta http-equiv>` for Capacitor. Keep one source and generate both, or they drift, which is exactly the failure `DEPLOY.md` §1.1 warns about.
- **`connect-src` must include the native gateway origins**, both `https:` and `wss:`, and `'wasm-unsafe-eval'` must survive or every chemistry structure and the execution visualiser die silently.

### 4.8 The Python runtime

`apps/web-pwa/src/engines/cs/pyodide.ts` loads Pyodide v0.26.4 from `cdn.jsdelivr.net` at runtime, roughly 10 MB of WebAssembly, and runs learner-typed Python behind two isolation locks.

This is a review risk on both stores and it needs a deliberate decision before the first submission.

- **Apple guideline 2.5.2** says apps must be self-contained and may not download or execute code that introduces or changes features. It carves out exactly one exception: *educational apps designed to teach executable code may download code in limited circumstances, provided the code is not used for other purposes and the source code is completely viewable and editable by the user.* Wobo's CS ramp fits that exception squarely — the learner types the code, sees it, and edits it. But the exception has to be argued in the Notes for Review, with the guideline number quoted, or a reviewer sees a WebView downloading a 10 MB runtime and rejects.
- **The safer build is to bundle it.** Vendoring the Pyodide distribution into the app bundle removes the download entirely, removes the CDN from `connect-src` and `script-src`, and makes the CS ramp work offline. It costs roughly 10 MB of app size. Do this for native and keep the CDN path for web.
- **Google Play** has no equivalent bar for interpreted code in a WebView, but the Families policy's SDK restrictions mean the runtime must not phone home. Bundling settles that too.
- **The isolation guard in `ISOLATION` must not regress.** It blocks `js` and `pyodide_js` so Python cannot reach the DOM, `localStorage` or the session token. In a native shell the same page origin also has the Capacitor bridge on it, which raises the stakes: a bridge escape from Python would reach native APIs. Move the runtime into a Web Worker before the native release, as the file's own note already anticipates.

### 4.9 Input, gestures and chrome

- **Hold to talk.** `apps/web-pwa/src/App.tsx` listens for `keydown` on Escape and space for barge-in. On mobile the hold is a long press on the orb, already the plan (§18). On desktop it should become a real global hotkey through `@tauri-apps/plugin-global-shortcut` 2.3.2, so Wobo can be summoned without focusing the window. Guard it: a global shortcut that swallows a key from every other app is hostile, so it must be a modifier chord and it must be user-changeable in settings.
- **Safe areas.** Notches, home indicators and the Android 15 edge-to-edge default all need `env(safe-area-inset-*)` honoured in the shell layout. This is a web-side fix that also improves the installed PWA.
- **Keyboard.** `@capacitor/keyboard` for resize behaviour so the chat composer is not covered on iOS.
- **Haptics.** DESIGN.md §5 calls for a haptic on the aha, "where supported". `@capacitor/haptics` makes it real on mobile. On desktop there is none; the sound carries the moment alone.
- **Status bar and splash.** `@capacitor/status-bar` must follow the theme, and the splash screen must be the loader from plan §16 — Wobo drawing a line that becomes the first hairline — not a static logo card.
- **Orientation.** Tablets must work in both orientations (plan §18). Do not lock orientation. Phones may lock to portrait only if a landscape layout genuinely has no purpose, and the board's landscape mode says it does.

### 4.10 Camera and file upload

`apps/web-pwa/src/screens/You.tsx` uses `<input type="file" accept="image/*">`, and `docs/CURRICULUM.md` §6 promises a photo-of-your-syllabus path. Both WebViews support the file input, but the native picker experience is poor and iOS will not offer the camera without a usage description.

Use `@capacitor/camera` 8.2.4 behind a small interface so the web build keeps the file input and native gets the real picker. Required strings: `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` on iOS, `READ_MEDIA_IMAGES` on Android 13 and later.

The safety line from plan §16 — never share pictures of people or personal information — must appear on the native picker path too, not only on the web attach control.

---

## 5. Store listing requirements

### 5.1 Icons and graphics

| Asset | Spec |
|---|---|
| iOS app icon | 1024 × 1024, no alpha; generated for all device sizes by `@capacitor/assets` |
| Android adaptive icon | foreground and background layers; generated by `@capacitor/assets` |
| Play store icon | 512 × 512 px, 32-bit PNG with alpha, 1024 KB maximum |
| Play feature graphic | 1024 × 500 px, JPEG or 24-bit PNG with no alpha, required to publish |
| macOS icon | `.icns`, generated by `tauri icon` |
| Windows icon | `.ico` |

Source of truth is the wordmark master and the crop recipe in `DEPLOY.md` §1.2. **The master is not in the repository yet.** The only copy on disk is `services/render-worker/public/wobo-logo.png`, which is untracked and is the full wordmark rather than the square W-mark the icon pipelines need. Before Wave 8 starts, commit two named assets — the wordmark master and a square 1024 × 1024 W-mark master — and let every icon command read from those paths (task 8.8). The same W-mark carries every platform; there is no second brand for native.

### 5.2 Screenshots

**App Store.** One to ten per localisation, JPEG or PNG, no alpha channel. At least one iPhone size is required if the app runs on iPhone, and iPad screenshots are required if it runs on iPad. Take them at the two largest sizes and let Apple scale down:

| Display | Portrait | Landscape |
|---|---|---|
| iPhone 6.9" | 1320 × 2868 | 2868 × 1320 |
| iPhone 6.5" | 1284 × 2778 | 2778 × 1284 |
| iPad 13" | 2064 × 2752 | 2752 × 2064 |
| iPad 11" | 1668 × 2420 | 2420 × 1668 |
| Mac (if the desktop app ships through the Mac App Store) | 1280 × 800, 1440 × 900, 2560 × 1600 or 2880 × 1800 |

**Google Play.** Minimum two screenshots across device types, four or more recommended to be eligible for large-format recommendations. Phone: minimum dimension 320 px, maximum 3840 px, and the maximum may not exceed twice the minimum; 16:9 landscape at 1920 × 1080 or 9:16 portrait at 1080 × 1920 is the recommended shape. Tablet (7-inch and 10-inch) and Chromebook: 1080–7680 px, 16:9 or 9:16, four recommended each. A preview video is a public, embeddable, ads-disabled YouTube URL, not an uploaded file.

**What the screenshots must show.** `DESIGN.md` §3, law 10: "Built to be screenshotted — the twin and mastery artifacts are hero art by default." The screenshot set is the board mid-performance, the twin igniting, a guided-discovery screen, the parent artifact, and Wobo mid-sentence. Not chrome, not a feature list, not text over a gradient. They are captured from the real app at the real sizes by the existing Playwright configuration extended with device profiles, so they can never drift from what ships.

### 5.3 Apple privacy nutrition labels

Declared in App Store Connect, changeable without an app update, and mandatory for every submission. For each data type, declare the purpose and one of three buckets: data used to track you, data linked to you, data not linked to you.

What Wobo actually collects, as the code stands:

| Data type | Bucket | Purpose | Status |
|---|---|---|---|
| User ID (`subject_id`) | linked to you | app functionality | declare |
| Name | linked to you | app functionality, product personalisation | declare |
| Phone number (sign-in) | linked to you | app functionality | declare |
| Email address (sign-in, lifecycle mail) | linked to you | app functionality | declare |
| Other user content (board work, answers, uploaded syllabus photos) | linked to you | app functionality, product personalisation | declare |
| Product interaction | linked to you | analytics, product personalisation | declare |
| Crash and performance data | not linked to you | app functionality | declare |
| Other user contact info (parent phone) | linked to you | app functionality | conditional — not collected today |
| Audio data (the voice relay) | linked to you | app functionality | conditional — only if audio is retained |

The last two rows are conditional on purpose. The parent phone never leaves the device as the code stands: `apps/web-pwa/src/screens/You.tsx` writes `{phone, linkedAt}` to `localStorage` under `wobo-parent-link-v1`, and the event that reaches the gateway carries a random `parent_ref` UUID and nothing else. Declare it the day the parent link actually transmits a number, and not before. Voice audio is declarable only if the transient-audio rule in §8 is not met; if task 8.1's test proves the audio is deleted as the turn completes, it is not collected under the definition below, and declaring it anyway would contradict the COPPA voice-exception argument §8 rests on.

Nothing is declared as used to track. Nothing goes to a data broker. There is no advertising identifier and no third-party advertising SDK, and that must stay true — it is what keeps the Kids Category and the Families policy open to us.

Two things must be got right. First, the definition of "collect" is transmission off device retained beyond servicing the request in real time; anything Wobo processes on device only is not declared. Second, third-party SDK collection must be declared even where we never use the data, and every third-party SDK must ship a privacy manifest and a signature. This is a hard argument for keeping the native dependency list as short as §2 makes it.

### 5.4 Google Play data safety form

The same substance in Play's shape: declare collection, sharing, whether encryption in transit is used (it is, everywhere), whether users can request deletion (they can — the forget-all path exists in `apps/web-pwa/src/wobo/forget-all.test.ts` and Wobo's memory page), and link the privacy policy. Categories that apply: personal info, messages, photos and videos, audio files, app activity, device or other IDs.

Sharing with our third-party AI and infrastructure providers is processing by service providers under our instruction, which Play treats as exempt from the sharing declaration, but the privacy policy must name the category of recipient in exactly those words and no others (plan §17).

### 5.5 Age ratings

Apple's rating system now runs 4+, 9+, 13+, 16+ and 18+, and the questionnaire gained required questions on in-app controls, capabilities, medical or wellness topics, and violent themes. Answers were required by 31 January 2026 to keep submitting updates, so this is done at account setup, before the first build is ever uploaded.

The capabilities questions are the ones that bite. Wobo has a conversational AI that generates content, a microphone, and user-generated content on the board. Answer them honestly and take the rating that follows; a rating won by a shaded answer is a removal waiting to happen. If the resulting rating is higher than we would like, the answer is not to soften the questionnaire, it is to ship the in-app controls (moderation, reporting, parent controls) that lower it legitimately.

Play uses the IARC questionnaire, plus the separate target audience and content declaration that determines Families policy applicability.

---

## 6. Money: in-app purchase versus web checkout

This is the section that changes the legal text, so it is written as rules rather than options.

**Apple.** Guideline 3.1.1 requires In-App Purchase for unlocking features or functionality, including subscriptions and premium content. Wobo Plus is exactly that. On iOS, Plus must be sold through IAP or not sold in the app at all. Physical goods and person-to-person real-time services are exempt; nothing we sell is either. There are External Purchase Link Entitlements in some storefronts, and the reader-app rules under 3.1.3(a), but neither fits a subscription that unlocks in-app features, so do not plan around them.

**Google.** Play's Payments policy requires Google Play's billing system for in-app digital purchases, with alternative billing and external offer programmes available by enrolment in eligible countries. India, our first market, is one of the places where the alternative billing programme has existed; whether to enrol is a commercial decision for the owner, not an engineering one. Default to Play Billing.

**Desktop and web.** Neither store has any claim. Web checkout stays exactly as designed in plan §14.

**What this does to the product.**

- Prices differ by platform because the store takes a cut, but **plan §14's uniform-pricing law is about not varying price by behaviour, not about not varying by platform.** The same person pays the same price on the same platform. State this plainly rather than pretending the numbers match.
- The behaviour-timed gifts in plan §14 — a gifted Plus week after an abandoned payment page, unannounced free days for real mastery — are entitlements granted by the gateway, not purchases. They are unaffected by store billing and must stay server-side so that a gift granted on web is honoured in the iOS app.
- **Entitlement is a gateway fact, never a client fact.** Whatever the purchase channel, the client asks the brain what the learner is entitled to. The store receipt is validated server-side and written to the same entitlement record the web checkout writes.
- A cross-platform receipt layer (`@revenuecat/purchases-capacitor` 13.5.0) is worth its weight only if we ship both stores plus web on day one. Otherwise use the platform APIs directly and keep the dependency count down, which the privacy manifest rules reward.

**How the legal text must differ.**

- The web terms describe our own billing and our own cancellation, which lives on the You screen, on the card called Your plan. There is no goodwill refund policy to describe: the owner's ruling of 4 September 2026 is cancel, never refund, and the only refunds left are the ones the law requires, listed in `docs/legal/refund-and-cancellation.md` section 5.
- The iOS terms must say the subscription is billed by the App Store, that it renews unless cancelled at least 24 hours before the period ends, that cancellation is managed in the device's account settings, and that refunds are handled by the store, not by us. Apple's own model text for auto-renewing subscriptions is required near the purchase control, and Brilliant's two consent checkboxes that plan §16 tells us to keep (terms and privacy; the recurring-charge disclosure naming the amount, the renewal and the cancellation) satisfy this cleanly.
- The Android terms say the same with the Play billing equivalents.
- One privacy policy serves all platforms, and it names recipients only as "third-party AI and infrastructure providers" (plan §17).
- The app must offer account deletion in the app, per guideline 5.1.1(v). Wobo's forget-all path is most of it; the remaining work is that deletion must remove the account, not only the memory.

**The line we do not cross.** Plan §14 forbids pressuring a child and forbids dark patterns in cancel flows. On a store platform this is also a policy matter, since Apple's Kids Category rules put purchasing opportunities behind a parental gate. Wherever the learner may be under 13, the upgrade surface is the parent's, reached through the parent link, and the child's app shows what Plus unlocks without a buy button.

---

## 7. App review risk register

Ordered by how likely it is to cost us a submission.

1. **Guideline 4.2, minimum functionality.** A WebView wrapper is the classic rejection. Our defence is real and must be made visible in the build, not just argued: native microphone with a real permission dialog, haptics on the aha, push on genuine moments, offline learning packs, the native picker, universal links, a real splash. A reviewer who opens the app offline and finds it fully working has answered 4.2 for us.
2. **AI with minors.** There is no single guideline named "generative AI", but four converge on us: 4.7 (chatbots must follow the privacy rules, include content moderation, a reporting mechanism, a way to block abusive material, and an age restriction mechanism), 1.3 (Kids Category), 5.1.4 (children's data), and 5.1.2(i), which requires explicit permission before sharing personal data with third-party AI. What we must be able to demonstrate: the safety layer in the gateway, the flag-anything path from plan §16 landing in a real queue with a real human reading it, no generated fact reaching a child unverified, and the consent record that permits sending a learner's words to a third-party AI provider at all. Build the reviewer's walkthrough as an artefact: a short screen recording plus a Notes for Review paragraph that names each mechanism and where to find it.
3. **The Kids Category question.** Entering it brings a hard constraint: no links out, no purchasing opportunities and no distractions except behind a parental gate, no personally identifiable or device information to third parties, and effectively no third-party analytics or advertising. Wobo can meet the second and third. The first collides with the upgrade surface and with any outbound share. **Recommendation: do not enter the Kids Category for the first release.** Ship as a general education app with an honest age rating and full COPPA and DPDP compliance, and revisit the Kids Category once the parent-gated upgrade flow is built and proven. Also note that "For Kids" and "For Children" are reserved terms we may not use in the name, subtitle, icon, screenshots or description unless we are in that category.
4. **Guideline 2.5.2 and the Python runtime.** Covered in §4.8. Bundling it removes the argument entirely.
5. **Guideline 2.3.1, hidden features.** Every capability must be reachable and described. A command palette, a voice path that reaches any surface, and behaviour-triggered content are all things a reviewer can miss and then treat as undocumented. The Notes for Review must be specific; generic descriptions are rejected by rule.
6. **Guideline 5.1.1, account deletion.** Must be in the app. See §6.
7. **Play Families policy.** If the target audience declaration includes children, we may not collect the advertising ID, IMEI, MAC address, device phone number or precise location, and every SDK must be approved for child-directed services. Our dependency list already satisfies this; the task is to keep it that way and to declare the target audience truthfully.
8. **Play technical quality.** The user-perceived crash rate threshold is 1.09% overall and 8% per phone model, enforced now and affecting visibility. A WebView app crashing on a low-memory device with Three.js and a 10 MB Python runtime loaded is a real scenario. Memory and code optimisation thresholds arrive in February 2027, which is inside our horizon.
9. **Play target API level.** New apps and updates must target Android 16 (API 36) or higher. Existing apps must target API 35 or higher to stay available to new users. Capacitor 8 handles this, but the value must be set explicitly and checked in CI.

---

## 8. COPPA, the age gate, and consent

`apps/web-pwa/src/screens/Onboarding.tsx` already asks when the learner was born — a native date input, `aria-label="your date of birth"` — and derives age from it (phase `'age'`, `ageFromBirthdate`). It carries no minimum, no maximum and no default value, which already satisfies the FTC's "must not default to 13 or over". The three gaps below are the whole remaining delta.

**What the FTC requires of a neutral age screen.** It must let a person enter their age accurately, must not default to 13 or over, must not discourage truthful answers, must collect the age before any other personal information, and must use a technical measure to stop a rejected user simply going back and changing the answer.

**Three gaps to close.**

1. **Order.** Today Wobo asks for a name first, then the birthdate. Under a strict reading, age must come before any other personal information. Move the birthdate question ahead of the name, or treat the name as non-identifying until age is known and do not persist it until then. The first is simpler and Wobo can carry it warmly.
2. **Non-circumvention.** A rejected under-13 answer must be remembered on the device so the flow cannot be retried with a different birthdate.
3. **The consent tier must be derived server-side.** This is already a Wave 1 finding (`services/gateway` deriving `consent_tier` instead of trusting the client). It is a prerequisite for every claim in this section, because an age gate that the client can assert around is not an age gate.

**The amended COPPA rule.** Effective 23 June 2025, with compliance required by 22 April 2026 for most provisions — a date already behind us, so this is current law and not a future project. It adds: separate verifiable parental consent for disclosing a child's personal information to third parties, an obligation to publish a written data retention policy and to practise data minimisation, and an expanded definition of personal information covering biometric and government-issued identifiers. Sending a child's spoken words and board work to a third-party AI provider is a third-party disclosure, so the separate consent is required, not optional.

**The voice-recording exception matters to us.** The FTC will not take enforcement action for collecting an audio file of a child's voice without parental consent where the audio is a replacement for written text, is used only to perform the request, is deleted promptly, and no other personal information is requested through it, provided the practice is clearly posted. Wobo's voice relay can sit inside that exception, but only if the audio is genuinely transient. **Do not retain voice audio.** Retain the transcript under the ordinary consent path if it is needed, and delete the audio as the turn completes. This should be asserted by a test, not by a policy sentence.

**The parental consent flow.** Verifiable parental consent needs a real method — a card transaction with notification, a staffed phone line, a video call, or government ID matched against a database. The parent link (§4.5) is the natural carrier: the child creates the link, the parent opens it on their own device, and consent is recorded against the parent's identity, not the child's. Design it once and use it for consent, for marketing preferences and for the upgrade surface, because it is the same person on the same device in all three cases.

**Beyond COPPA.** India's DPDP Act treats everyone under 18 as a child and requires verifiable parental consent, which is a stricter and, for our first market, the binding constraint. Design to eighteen and COPPA follows for free. The UK Age Appropriate Design Code adds design duties for anyone likely to be accessed by children, which plan §14's no-dark-patterns rule already anticipates.

---

## 9. Build pipeline, exact commands

### 9.1 Shared: the native web build

```bash
# from the repo root
cd apps/web-pwa
WOBO_TARGET=native bun run build     # skips vite-plugin-pwa, bundles the Python runtime
```

`vite.config.ts` gains one branch: when `process.env.WOBO_TARGET === 'native'`, omit `VitePWA(...)` and switch the Python runtime resolution from the CDN to a bundled copy. Everything else in the config is untouched.

### 9.2 Capacitor: first-time setup

```bash
cd apps/mobile
bun add @capacitor/core@8.5.1
bun add -d @capacitor/cli@8.5.1
bun add @capacitor/ios@8.5.1 @capacitor/android@8.5.1
bunx cap init Wobo com.heywobo.wobo --web-dir ../web-pwa/dist
bunx cap add ios
bunx cap add android
```

`capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.heywobo.wobo',
  appName: 'Wobo',
  webDir: '../web-pwa/dist',
  server: { hostname: 'localhost', androidScheme: 'https', iosScheme: 'capacitor' },
  ios: { contentInset: 'never', limitsNavigationsToAppBoundDomains: true },
};

export default config;
```

`limitsNavigationsToAppBoundDomains` is deliberate: with `WKAppBoundDomains` in `Info.plist` it stops the WebView navigating anywhere we did not name, which is both a security posture and a good answer to a reviewer.

### 9.3 Capacitor: every build

```bash
cd apps/web-pwa && WOBO_TARGET=native bun run build
cd ../mobile && bunx cap sync                 # copy assets + install native deps
bunx cap open ios                             # Xcode: archive, upload
bunx cap open android                         # Android Studio: signed bundle
```

Command line release builds, for CI:

```bash
# Android app bundle
cd apps/mobile/android && ./gradlew bundleRelease
# iOS archive
cd apps/mobile/ios/App && xcodebuild -workspace App.xcworkspace -scheme App \
  -configuration Release -archivePath build/Wobo.xcarchive archive
xcodebuild -exportArchive -archivePath build/Wobo.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export
```

Icons and splash from one source image:

```bash
bunx @capacitor/assets generate --iconBackgroundColor '#FFFFFF' \
  --splashBackgroundColor '#FFFFFF' --iosProject ios/App --androidProject android
```

### 9.4 Tauri: first-time setup

```bash
cd apps/desktop
bun add -d @tauri-apps/cli@2.11.4
bun add @tauri-apps/api@2.11.1
bunx tauri init          # frontendDist: ../../web-pwa/dist, devUrl: http://localhost:5173
bunx tauri icon <path to the committed square W-mark master>   # see §5.1
bun add @tauri-apps/plugin-updater@2.11.0 @tauri-apps/plugin-deep-link@2.4.10 \
        @tauri-apps/plugin-notification@2.4.0 @tauri-apps/plugin-store@2.4.4 \
        @tauri-apps/plugin-global-shortcut@2.3.2 @tauri-apps/plugin-os@2.3.2
cd src-tauri
cargo add tauri-plugin-updater@2.11.0 tauri-plugin-deep-link@2.4.10 \
          tauri-plugin-single-instance@2.4.4
```

### 9.5 Tauri: every build

```bash
cd apps/web-pwa && WOBO_TARGET=native bun run build
cd ../desktop && bunx tauri build                       # host platform, default bundles
bunx tauri build --bundles dmg                          # macOS disk image
bunx tauri build --bundles nsis                         # Windows installer
bunx tauri build --bundles deb,rpm,appimage             # Linux
bunx tauri build --target aarch64-apple-darwin          # Apple silicon
bunx tauri build --target x86_64-apple-darwin           # Intel
```

There is no cross-compilation across operating systems. Three CI runners: macOS for the two Apple architectures, Windows, and Linux. macOS builds must run on macOS because notarisation needs Apple tooling.

---

## 10. Code signing and notarisation

**iOS.** Apple Developer Program membership, an App Store distribution certificate and provisioning profile, uploaded through Xcode Organizer or Transporter by hand, and `xcrun notarytool` with an App Store Connect API key from CI — the same key variables the macOS block below uses. `altool` is deprecated for delivery and retired for notarisation; do not write it into a script. Automatic signing in Xcode is fine for the first releases; move to Fastlane Match when more than one person builds.

**Android.** An upload keystore, generated once and never lost, with Play App Signing holding the real release key. `keystore.properties` stays out of the repository and the key material lives in the CI secret store.

**macOS desktop, outside the App Store.** A Developer ID Application certificate, hardened runtime, and notarisation.

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: [Company legal name] (TEAMID)"
# CI, from a base64 .p12:
export APPLE_CERTIFICATE="…" APPLE_CERTIFICATE_PASSWORD="…"
# notarisation, either an Apple ID app-specific password:
export APPLE_ID="…" APPLE_PASSWORD="…" APPLE_TEAM_ID="…"
# or an App Store Connect API key, which is better in CI:
export APPLE_API_ISSUER="…" APPLE_API_KEY="…" APPLE_API_KEY_PATH="…"
bunx tauri build --bundles dmg
```

Entitlements must include `com.apple.security.device.audio-input` for Wobo's voice, and network client access. `Info.plist` needs `NSMicrophoneUsageDescription`. Signing identity can also be set at `bundle.macOS.signingIdentity` in `tauri.conf.json`; the pseudo-identity `"-"` is ad-hoc signing for local development only.

**macOS through the Mac App Store** uses an Apple Distribution certificate instead and is a separate configuration. Note that shipping there brings guideline 3.1.1 back into play for anything sold in the desktop app.

**Windows.** An OV or EV code-signing certificate. EV gives immediate SmartScreen reputation; OV is cheaper and available to individuals but will show a SmartScreen warning until reputation accrues. Configure `bundle.windows.certificateThumbprint`, `digestAlgorithm: "sha256"` and a `timestampUrl`, or supply a custom `signCommand` for a cloud signing service — which is now the common path, since hardware token requirements make a local certificate awkward in CI. Signing is required for the Microsoft Store and to avoid the download warning.

**Linux.** No signing authority. Ship a `.deb`, an `.rpm` and an AppImage, publish checksums, and rely on the Tauri updater's own signature (§11) for update integrity.

---

## 11. Update strategy

**The default: ship through the stores.** Both review queues are fast enough now that a store update is the honest path, and it keeps the shipped bundle identical to what was reviewed.

**Capacitor live updates.** Over-the-air JavaScript updates are attractive because a fix reaches every learner without a review cycle. Two things to know before adopting them.

First, the incumbent hosted service is being wound down: existing apps keep working until 31 December 2027, but it takes no new customers and gains no new features. That date is reported from the vendor's own wind-down announcement rather than fetched into §13 — confirm it against their notice before any plan depends on it. Do not build on it. The live alternatives are `@capgo/capacitor-updater` 8.51.15, which supports self-hosting, and comparable newer services.

Second, the policy line. Apple permits updating interpreted code that runs in the system WebView provided it does not change the app's primary purpose or introduce features that were not reviewed. That is a real constraint, not a formality: a live update may fix a bug, adjust copy, or correct a layout. It may not add a capability, change what is sold, or alter what data is collected. Anything on that list goes through review.

**Recommendation.** Ship the first three releases store-only. Add live updates once the app is stable, scoped by written policy to bug fixes and content corrections, with a rollback channel and a version pin so a bad update can be reverted in minutes. Self-host it against our own storage so no third party sits between us and the learner's device.

**Tauri desktop.** The updater plugin is the right answer and should ship in the first desktop release.

```bash
bunx tauri signer generate -w ~/.tauri/wobo.key
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/wobo.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
```

Environment variables only; a `.env` file is not read by the signer. Then in `tauri.conf.json`:

```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "<public key>",
      "endpoints": ["https://heywobo.com/desktop/{{target}}/{{arch}}/{{current_version}}"],
      "windows": { "installMode": "passive" }
    }
  }
}
```

The endpoint serves a static JSON manifest with `version`, optional `notes` and `pub_date`, and a `platforms` map of `{ url, signature }` per target triple. Artefacts are `.app.tar.gz` plus `.sig` on macOS, `.AppImage` plus `.sig` on Linux, and the installer plus `.sig` on Windows. `updater:default` must be in the capability permissions or the calls are denied. Leave `dangerousInsecureTransportProtocol` off.

The manifest is generated by CI on release and published to our own domain, so no third party controls what our desktop app installs.

---

## 12. Wave 8 task list

Paste into `docs/WOBO-TASKS.md` under `## Wave 8 — Platforms and launch`, replacing the eight placeholder bullets. Ordered so each block unblocks the next.

```markdown
### 8.1 Web-side prerequisites (done before either shell exists)
- [ ] **Native build flag** — `WOBO_TARGET=native` in `apps/web-pwa/vite.config.ts` omits `VitePWA(...)` and switches the Python runtime from the CDN to a bundled copy; web build byte-identical to today when the flag is unset
- [ ] **Move voice capture to an AudioWorklet** — replace `createScriptProcessor(1024,1,1)` in `apps/web-pwa/src/wobo/voice.ts:259`; measure capture jitter on a mid-range Android device before and after
- [ ] **Move the Python runtime into a Web Worker** — the `ISOLATION` guard stays; a bridge escape must not reach the Capacitor bridge (`src/engines/cs/pyodide.ts`)
- [ ] **Safe-area insets** — `env(safe-area-inset-*)` honoured across the shell; fixes the installed PWA too
- [ ] **Stop voice and speech on background** — `appStateChange` closes the relay and `stopSpeaking()`; asserted by a test
- [ ] **Delete voice audio as the turn completes** — retention asserted by a test, not by a policy sentence (COPPA voice exception, §8)
- [ ] **gate** Age asked before any other personal information; a rejected under-13 answer cannot be retried (`src/screens/Onboarding.tsx`)
- [ ] **gate** Consent tier derived server-side (carried from Wave 1; blocks every claim in PLATFORMS.md §8)
- [ ] **Account deletion in the app** — not only memory-forget; required by App Store guideline 5.1.1(v)

### 8.2 Capacitor project
- [ ] **`apps/mobile` workspace** — Capacitor 8.5.1 core/cli/ios/android, `capacitor.config.ts` per PLATFORMS.md §9.2, `webDir` pointing at the web build
- [ ] **Record the real native origins** — log `window.location.origin` on iOS, Android, macOS, Windows and Linux; write the five values into `DEPLOY.md`
- [ ] **Native CORS allow-list** — a gateway service variable separate from `APP_URL`; the voice relay handshake checks `Origin` against it
- [ ] **One CSP, three emissions** — single source generating the web header, the Capacitor `<meta>` and `tauri.conf.json` `app.security.csp`; `'wasm-unsafe-eval'` preserved
- [ ] **`limitsNavigationsToAppBoundDomains`** with `WKAppBoundDomains` naming only our own hosts

### 8.3 Native bridges
- [ ] **Microphone, iOS** — `NSMicrophoneUsageDescription` in Wobo's voice; `WKUIDelegate` `requestMediaCapturePermissionFor` so hold-to-talk does not prompt on every hold
- [ ] **Microphone, Android** — `RECORD_AUDIO` runtime request plus `onPermissionRequest` grant for `RESOURCE_AUDIO_CAPTURE`
- [ ] **Microphone, desktop** — wry 0.56.0 permission API on all three engines; macOS entitlement `com.apple.security.device.audio-input`; GStreamer plugins declared as `.deb`/`.rpm` dependencies and carried in the AppImage
- [ ] **Secure storage for the session token** — `KVStorage` over `@aparajita/capacitor-secure-storage@8.0.0` (Keychain / EncryptedSharedPreferences) and `@tauri-apps/plugin-store@2.4.4` on desktop, passed as the identity config's `storage` field; one-time migration from `wobo-auth-session-v1` in `store/legacy-keys.ts`
- [ ] **Deep links** — `apple-app-site-association` and `assetlinks.json` at `heywobo.com/.well-known/`; Associated Domains and an autoVerify intent-filter; `wobo://` plus single-instance on desktop; `appUrlOpen` listener calling the router's existing `pathToRoute`
- [ ] **Native sign-in** — system browser via `@capacitor/browser@8.0.4` returning through the app link; phone OTP stays the default door
- [ ] **Camera and picker** — `@capacitor/camera@8.2.4` behind an interface the web build satisfies with the existing file input; the safety line carried onto the native path
- [ ] **Push** — `@capacitor/push-notifications@8.1.2`; APNs on iOS, `google-services.json` on Android, `POST_NOTIFICATIONS` requested after the first genuine aha; nothing gated behind the grant (guideline 5.1.2)
- [ ] **Haptics, keyboard, status bar, splash** — `@capacitor/haptics@8.0.2` on the aha only; `@capacitor/keyboard@8.0.5`; status bar follows the theme; splash is Wobo drawing the first hairline (plan §16), reduced-motion safe
- [ ] **Desktop hotkey** — `@tauri-apps/plugin-global-shortcut@2.3.2`, a modifier chord, user-changeable in settings
- [ ] **design** Tablet layouts in both orientations; no orientation lock; board landscape mode proven

### 8.4 Tauri desktop
- [ ] **`apps/desktop` workspace** — Tauri 2.11.5 / CLI 2.11.4, `frontendDist` at the web build, icons from `tauri icon`
- [ ] **Updater** — signing keypair generated, `createUpdaterArtifacts`, static manifest published on our own domain, `updater:default` permission, `installMode: passive` on Windows, rollback tested
- [ ] **Three CI runners** — macOS (both architectures), Windows, Linux; no cross-OS compilation

### 8.5 Offline and packs
- [ ] **Bundle the chemistry wasm** — no runtime fetch on native; chemistry cards work with no network
- [ ] **Learning packs on native storage** — SQLite or the app container rather than IndexedDB, which can be evicted
- [ ] **First-run download prompt** — if anything is fetched on first launch, disclose the size and ask first (guideline 4.2.3(ii))
- [ ] **gate** Airplane mode walkthrough on every platform: open a cached course, draw on the board, run Python, finish a boss

### 8.6 Money
- [ ] **owner** Decide the store billing posture: In-App Purchase and Play Billing for the mobile apps, web checkout on desktop and web
- [ ] **Entitlement stays a gateway fact** — store receipts validated server-side into the same record web checkout writes; a gift granted on web is honoured on iOS
- [ ] **Per-platform legal text** — store billing, renewal and cancellation language on iOS and Android; two consent checkboxes at checkout (plan §16); one privacy policy naming recipients only as "third-party AI and infrastructure providers"
- [ ] **No buy button in a child's app** — the upgrade surface is the parent's, reached through the parent link

### 8.7 Compliance and review
- [ ] **owner** Answer the updated App Store age-rating questionnaire (4+ / 9+ / 13+ / 16+ / 18+; in-app controls, capabilities, medical or wellness, violent themes) before the first upload
- [ ] **owner** Decision recorded: not entering the Kids Category for the first release (see PLATFORMS.md §7)
- [ ] **Privacy nutrition labels** filled from the table in PLATFORMS.md §5.3; nothing declared as used to track
- [ ] **Play data safety form** and target-audience declaration; Families policy honoured (no advertising ID, no precise location, no unapproved SDKs)
- [ ] **Separate parental consent for third-party disclosure** — amended COPPA rule, compliance date already passed; DPDP treats everyone under 18 as a child, so design to eighteen
- [ ] **Written data retention policy**, published and matched by what the code actually does
- [ ] **Flag-anything path proven end to end** — a flag from any content unit reaching a queue a person reads (plan §16)
- [ ] **Notes for Review** — the 2.5.2 educational-code argument quoted by number, the moderation and reporting mechanisms named, a short screen recording; no generic descriptions (guideline 2.3.1)
- [ ] **Target API 36** set explicitly and checked in CI; crash rate watched against Play's 1.09% overall and 8% per-model thresholds

### 8.8 Store assets
- [ ] **Commit the brand masters** — the wordmark and a square 1024×1024 W-mark, at named tracked paths; today the only copy is untracked (PLATFORMS.md §5.1). Blocks every icon command, `tauri icon` included
- [ ] **design** Icons from the one W-mark: iOS 1024, Android adaptive, Play 512 (32-bit PNG, ≤1024 KB), feature graphic 1024×500 (no alpha), macOS `.icns`, Windows `.ico`
- [ ] **design** Screenshots captured from the real app by an extended Playwright device-profile run: iPhone 6.9" 1320×2868, 6.5" 1284×2778, iPad 13" 2064×2752, 11" 1668×2420; Play phone 1080×1920 and tablet at 16:9 or 9:16, four or more each; the board mid-performance, the twin igniting, guided discovery, the parent artifact, Wobo mid-sentence
- [ ] **Listings** — name, subtitle, description, keywords; sentence case, no emoji, no exclamation marks; "For Kids" and "For Children" not used

### 8.9 Release
- [ ] **Final deploy on green** — web and gateway; domain swap when the owner says (`DEPLOY.md` §3); the `.well-known` files and the updater endpoint go live with it
- [ ] **Signing** — iOS distribution certificate and profile; Android upload keystore with Play App Signing; macOS Developer ID with hardened runtime and notarisation; Windows OV or EV with a timestamp URL
- [ ] **Live updates deferred** — store-only for the first three releases; then self-hosted, scoped by written policy to fixes and content corrections, with rollback
- [ ] **Monitoring** — crash and error tracking on all five native targets, budget dashboards, uptime, cost per learner
- [ ] **gate** Every screen proven on iPhone, iPad, an Android phone, an Android tablet, macOS, Windows and Linux, in both themes, with reduced motion, with a screen reader
- [ ] **Launch checklist** — store accounts, budget dials, legal live, monitoring, rollback, support inbox
```

---

## 13. Sources

All fetched 2026-09-03.

**Capacitor** — [Getting started](https://capacitorjs.com/docs/getting-started) · [iOS](https://capacitorjs.com/docs/v8/ios) · [Android](https://capacitorjs.com/docs/v8/android) · [Configuration](https://capacitorjs.com/docs/v8/config) · [Push notifications](https://capacitorjs.com/docs/v8/apis/push-notifications) · [Deep links](https://capacitorjs.com/docs/v8/guides/deep-links) · [Progressive web apps](https://capacitorjs.com/docs/web/progressive-web-apps). Package versions from the npm registry.

**Tauri** — [Start](https://v2.tauri.app/start/) · [Prerequisites](https://v2.tauri.app/start/prerequisites/) · [Distribute](https://v2.tauri.app/distribute/) · [Updater plugin](https://v2.tauri.app/plugin/updater/) · [macOS signing](https://v2.tauri.app/distribute/sign/macos/) · [Windows signing](https://v2.tauri.app/distribute/sign/windows/) · [CSP](https://v2.tauri.app/security/csp/) · [Webview versions](https://v2.tauri.app/reference/webview-versions/) · [wry releases](https://v2.tauri.app/release/wry/). Crate versions from crates.io.

**Apple** — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (1.3, 2.3.1, 2.5.2, 3.1.1, 3.1.3(a), 4.2, 4.7, 5.1.1, 5.1.2, 5.1.4) · [App privacy details](https://developer.apple.com/app-store/app-privacy-details/) · [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/) · [Updated age ratings](https://developer.apple.com/news/?id=ks775ehf) · [Age rating requirements](https://developer.apple.com/news/upcoming-requirements/?id=07242025a).

**Google** — [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469) · [Families policy](https://support.google.com/googleplay/android-developer/answer/9893335) · [Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738) · [Preview assets](https://support.google.com/googleplay/android-developer/answer/9866151) · [Technical quality requirements](https://support.google.com/googleplay/android-developer/answer/17492799) · [Target API level](https://support.google.com/googleplay/android-developer/answer/11926878).

**Children's privacy** — [FTC, complying with COPPA](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions) · [Amended COPPA rule, Federal Register, 22 April 2025](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule).

**Repository** — `apps/web-pwa/vite.config.ts`, `apps/web-pwa/src/wobo/voice.ts`, `apps/web-pwa/src/wobo/speech.tsx`, `apps/web-pwa/src/engines/cs/pyodide.ts`, `apps/web-pwa/src/shell/router.tsx`, `apps/web-pwa/src/screens/Onboarding.tsx`, `apps/web-pwa/src/screens/You.tsx`, `apps/web-pwa/src/store/downloads.ts`, `packages/sdk/src/identity.ts`, `packages/sdk/src/gateway.ts`, `DEPLOY.md`, `DESIGN.md`, `docs/WOBO-PLAN.md`, `docs/CURRICULUM.md`.
