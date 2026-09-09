# DEPLOY

The runbook for the two production targets. Every step needs the OWNER's
authenticated accounts (Vercel, Railway, Supabase); nothing here runs unattended,
and no secret ever enters this repo.

**Hosts.** The domain is **heywobo.com** (bought 2026-09-03). Both addresses below are our
own; the platform hostnames underneath them are an implementation detail and appear nowhere in
shipped code.

| Piece | Host | Address |
|---|---|---|
| Web PWA | Vercel | `https://heywobo.com` (`www` redirects to it) |
| Gateway (the brain) | Railway | `https://api.heywobo.com` (custom domain on the service) |
| Data | Supabase | project ref `keepraxqagzgjrrweryt`, reached by the browser as `https://heywobo.com/db` — see §1.3 |

```sh
export WEB_URL=https://heywobo.com
export GATEWAY_URL=https://api.heywobo.com
export MAIL_DOMAIN=heywobo.com   # the sending domain, once it verifies with the mail provider
```

Every DNS record for the domain lives in **`infra/dns/heywobo.com.md`** — that file is the
single source of truth; the table in §1.4 here is a copy of it.

**Config that is committed:** `vercel.json` (repo root — the only one; Vercel reads
the root file), `railway.json` (repo root), `services/gateway/Dockerfile`,
`infra/supabase/migrations/`, `apps/web-pwa/.env.production` (non-secret flags only).

**Removed deploy targets.** Fly.io and Render were both dead — neither host resolved
and the Render one answered 404. `services/gateway/fly.toml`
and `render.yaml` were deleted, and both hosts were dropped from the CSP `connect-src`.
Railway is the single gateway host. `apps/web-pwa/vercel.json` was deleted too: Vercel only
ever read the root file, so the second one was inert config that disagreed with the real one.

---

## 0. Env contract

Everything user-facing is env-driven so the domain swap is one change (see §4).

### Web PWA (Vite). Only `VITE_`-prefixed vars reach the browser — treat every one as public.

| Var | Where it lives | Secret | Production value |
|---|---|---|---|
| `VITE_LLM_MODE` | committed `apps/web-pwa/.env.production` | no | `live` |
| `VITE_PERSIST_MODE` | committed `.env.production` | no | `live` |
| `VITE_DEV_AUTH` | committed `.env.production` | no | `false` — the dev mock identity can never leak |
| `VITE_APP_NAME` | committed `.env.production` | no | `Wobo` (title, PWA manifest name) |
| `VITE_APP_URL` | committed `.env.production` | no | `https://heywobo.com` — canonical origin, `og:url`, and the base of the `/db` proxy |
| `VITE_GATEWAY_URL` | committed `.env.production` | no | `https://api.heywobo.com` |
| `VITE_SUPABASE_URL` | committed `.env.production` | no | `https://keepraxqagzgjrrweryt.supabase.co` — the rewrite's destination; the browser does not use it while the proxy is on |
| `VITE_SUPABASE_PROXY` | committed `.env.production` | no | `1` — the browser talks to the database through `https://heywobo.com/db` (§1.3). Anything else ⇒ direct, and `*.supabase.co` must go back into the CSP |
| `VITE_APP_DESCRIPTION` | Vercel project env (optional) | no | unset ⇒ built-in tagline |
| `VITE_SUPABASE_ANON_KEY` | **Vercel project env only** | yes-ish | publishable/anon key ONLY — never the service role |
| `VITE_SUPABASE_DEV_JWT` | **never set in production** | yes | dev-only RLS shim |

`apps/web-pwa/.env.production` is committed on purpose and holds **non-secret flags
only**. Without it a production build falls back to dev defaults (mock identity,
local-only persistence) and fails OPEN. Vercel project env overrides it at build
time, which is where every key belongs. The SDK fails fast at boot if
`VITE_DEV_AUTH=false` without the Supabase env, so a misconfigured prod build shows
an error instead of silently shipping dev mode.

### Proving the domain to the two search consoles (build-time only, no `VITE_` prefix)

Neither of these reaches the browser and neither is a secret. They exist so the owner can verify
ownership of the domain without shipping a commit: set the variable on the host, redeploy, and the
file appears at the root of the site. Unset means no file written, which is the right answer on a
laptop and on a preview build.

| Var | Where it lives | What the build writes |
|---|---|---|
| `GOOGLE_SITE_VERIFICATION` | Vercel project env (optional) | `/google<token>.html`, the file Search Console asks for. Paste either the bare token or the whole `google<token>.html` filename the console offers; both are accepted |
| `BING_SITE_VERIFICATION` | Vercel project env (optional) | `/BingSiteAuth.xml`, the file Bing Webmaster Tools asks for. Bing is the index ChatGPT's browsing reads, so it is worth having as well as Google |

A value carrying anything but letters, digits, `_` and `-` FAILS THE BUILD with the variable named,
rather than being skipped: a malformed token means somebody is waiting on a verification that will
never pass. The rules and the file contents are `apps/web-pwa/src/shell/verification.ts`, and
`apps/web-pwa/scripts/prerender.ts` writes them.

### Gateway (Railway service variables — nothing committed).

Every value below is read from the environment; none is hardcoded in service code. Secrets
live only in the Railway service variables and the owner's key vault.

**Identity and consent (Wave 1 — the brain's door).**

| Var | Secret | Where it lives | Production value |
|---|---|---|---|
| `SUPABASE_JWT_SECRET` | **yes** | Railway | the project's JWT secret (HS256 projects). **One of this or the JWKS pair is mandatory when `ENV=prod`** — boot fails without it |
| `SUPABASE_JWKS_URL` | no | Railway | RS256/ES256 projects. Unset ⇒ derived from `SUPABASE_URL` as `<url>/auth/v1/.well-known/jwks.json` |
| `SUPABASE_URL` | no | Railway | `https://keepraxqagzgjrrweryt.supabase.co` — the JWKS base and the consent lookup host. **Server-side, so it stays the project URL**; the `/db` proxy is a browser-only concern |
| `SUPABASE_JWT_AUD` | no | Railway (optional) | `authenticated` (the default) |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | Railway | server-only key for the consent/plan lookup (`learner.profiles_cache` by `subject_id`). Missing ⇒ every learner reads as un-elevated + free |
| `SUPABASE_CONSENT_SCHEMA` / `_TABLE` / `_ID_COLUMN` | no | Railway (optional) | defaults `learner` / `profiles_cache` / `subject_id` — the live schema; set only if the profile moves behind a view |
| `DEV_AUTH` | no | **never in production** | unset. It accepts any asserted identity; `ENV=prod` refuses to boot with it set at all |

**Budget meter and limiter (Wave 1 — the brain owns every number).**

| Var | Secret | Where it lives | Production value |
|---|---|---|---|
| `FREE_DAILY_TURNS` / `FREE_DAILY_GENERATIONS` | no | Railway (optional) | `40` / `8` |
| `ANON_DAILY_TURNS` / `ANON_DAILY_GENERATIONS` | no | Railway (optional) | `6` / `1` — anonymous learners, metered per address |
| `PLUS_DAILY_TURNS` / `PLUS_DAILY_GENERATIONS` | no | Railway (optional) | `400` / `60` — chosen by `profiles_cache.plan` |
| `RATE_LIMIT_PER_MINUTE` | no | Railway | `60` per verified subject |
| `UNAUTH_RATE_LIMIT_PER_MINUTE` | no | Railway | `15` per address for callers with no verified identity |
| `MAX_REQUEST_BYTES` | no | Railway (optional) | `262144` |
| `TRUST_PROXY` | no | Railway | `1` — Railway is our proxy, so the LAST `X-Forwarded-For` hop is the client. Leave unset anywhere the platform does not append that header |

**Brand and mail (the domain swap is these vars, nothing else).**

| Var | Secret | Where it lives | Production value |
|---|---|---|---|
| `APP_NAME` | no | Railway | `Wobo` — product name in prompts, emails, page titles |
| `APP_URL` | no | Railway | `https://heywobo.com` — canonical web origin. Also the CORS allow-list entry and the base of every email link |
| `APP_PREVIEW_ORIGIN_REGEX` | no | Railway (optional) | CORS regex for our own preview deploys; unset ⇒ the built-in Vercel preview pattern |
| `EMAIL_FROM` | no | Railway | `Wobo <hello@heywobo.com>` — RFC 5322 sender on the verified domain (also the code default) |
| `EMAIL_REPLY_TO` | no | Railway | `support@heywobo.com` — reply-to on every transactional send (also the code default). It must actually receive mail |
| `EMAIL_UNSUBSCRIBE_URL` | no | Railway (optional) | unset ⇒ `https://heywobo.com/unsubscribe` |
| `EMAIL_POSTAL_ADDRESS` | no | Railway | **owner action.** A real postal address; unset renders a loud placeholder in the footer |
| `EMAIL_MODE` | no | Railway | `console` until the sender domain is verified in Resend, then `live` |
| `RESEND_API_KEY` | **yes** | Railway | from the key vault |
| `INTERNAL_EMAIL_KEY` | **yes** | Railway | the shared key on `X-Wobo-Internal`; unset makes `POST /v1/email/send` a dead endpoint (fail closed) |
| `WOBO_GATEWAY_KEY` | **yes** | Railway | internal service key |

**Runtime.**

| Var | Secret | Where it lives | Production value |
|---|---|---|---|
| `ENV` | no | Railway | `prod` |
| `LLM_MODE` | no | Railway | `live` |
| `LOG_LEVEL` | no | Railway | `INFO` |
| `RAILWAY_DOCKERFILE_PATH` | no | Railway | `services/gateway/Dockerfile` (also declared in `railway.json`) |
| `ANTHROPIC_API_KEY` `OPENAI_API_KEY` `GOOGLE_AI_API_KEY` | **yes** | Railway | from the key vault |

`PORT` is injected by Railway; the Dockerfile's `CMD` already honours it. Locally the gateway
runs on **8081** (`uv run uvicorn wobo_gateway.app:app --port 8081`), which is what
`.env.example`'s `GATEWAY_URL`, `apps/web-pwa/.env.example` and `apps/web-pwa/.env.development`
all point at.

#### Railway must set — the Wave 1 checklist

Boot fails or a door stands open if any of these is wrong. Check it before every deploy:

- [ ] `ENV=prod` — turns on the prod-only refusals below.
- [ ] `LLM_MODE=live` — with `ANTHROPIC_API_KEY` present, or boot fails.
- [ ] **No `DEV_AUTH`** at any value. `ENV=prod` refuses to start with it set; that refusal is
      the last line of defence, not the plan.
- [ ] Token verification configured: `SUPABASE_JWT_SECRET`, **or** `SUPABASE_JWKS_URL`, **or**
      `SUPABASE_URL` (from which the JWKS URL is derived). `ENV=prod` fails fast without one.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set — otherwise the consent lookup silently answers
      un-elevated + free for everyone, and elevated capabilities are unreachable.
- [ ] `APP_URL` set to the real origin — it is the CORS allow-list, so a wrong value shows the
      browser an opaque network error on every call.
- [ ] `TRUST_PROXY=1` — Railway terminates TLS, so without it the limiter buckets by the proxy.
- [ ] `INTERNAL_EMAIL_KEY` set (or `POST /v1/email/send` stays dead by design).
- [ ] `EMAIL_POSTAL_ADDRESS` set before `EMAIL_MODE=live`.

The full template with comments: `.env.example` (repo root, gateway + shared) and
`apps/web-pwa/.env.example` (web).

---

## 1. Web PWA → Vercel

Production is built **remotely from the repo** by the Vercel git integration. A push
to the deployed branch is the deploy; there is no local build step and no
`vercel deploy` in the normal path. The root `vercel.json` supplies the whole build
(`installCommand`, `buildCommand`, `outputDirectory`, `framework: null`) plus the
SPA rewrite and every security header — no dashboard build configuration is needed,
and dashboard overrides must stay empty so this file remains the single source.

One-time setup:

```sh
vercel login
vercel link                       # link the repo to the project

# The production env in one step — sets VITE_SUPABASE_URL, VITE_GATEWAY_URL, VITE_DEV_AUTH,
# VITE_PERSIST_MODE and VITE_LLM_MODE from the committed apps/web-pwa/.env.production (so the
# project env can never drift from the runbook), and the anon key only if you pass it:
bash scripts/set-vercel-env.sh "<supabase-anon-key>"   # publishable key, never service role

# …or set the key by hand and skip the argument on later runs:
vercel env add VITE_SUPABASE_ANON_KEY production

vercel domains add heywobo.com
vercel domains add www.heywobo.com        # then set it to redirect to the apex in the dashboard
```

`scripts/set-vercel-env.sh` is committed and holds **no** credential — the anon key comes
from `$1` (or `VITE_SUPABASE_ANON_KEY` in the environment) and every other value is read out
of `.env.production`. It finishes with a `vercel env pull` verification that prints the flag
values and reports the anon key only as `<set>` / `<MISSING>`. Rerun it after any change to
`.env.production`, then redeploy.

**DNS (owner action):** the apex and `www` rows of the table in §1.4. Vercel provisions TLS
once they resolve (`vercel domains inspect heywobo.com`).

Manual deploys are a fallback only (`vercel deploy --prod` from the repo root; the
Hobby plan caps daily CLI deploys, which is why the git integration is the path).
`.vercelignore` applies to CLI uploads only and excludes every `.env` file except
`.env.example` and the committed `apps/web-pwa/.env.production`.

### 1.1 CSP

The one CSP lives in the root `vercel.json` — read it there rather than from a copy here,
which is a copy that drifts. The only source that moves is the gateway origin in
`connect-src` (the `https:` and `wss:` pair, `$GATEWAY_URL`); everything else is fixed.

Why each non-obvious source is there — remove one and something breaks silently:

- `'wasm-unsafe-eval'` — RDKit and Pyodide instantiate WebAssembly. Without it every
  chemistry structure and the execution visualiser fail to start.
- `https://cdn.jsdelivr.net` in **both** `script-src` and `connect-src` — Pyodide is
  imported from there (`apps/web-pwa/src/engines/cs/pyodide.ts`) and then fetches its
  own `.wasm` and package archives over `fetch`.
- `data:` in `media-src` — generated narration and video are handed to the player as
  data URIs; without it they mute with no error.
- **No font CDN.** Plus Jakarta Sans and Caveat are bundled (`@fontsource-variable/*`,
  imported from `apps/web-pwa/src/main.tsx`) and served from our own origin, so
  `font-src 'self'` is the whole story. Do not re-add `fonts.googleapis.com` /
  `fonts.gstatic.com`: a font `<link>` is a render-blocking third-party round-trip on
  the first paint of a cheap phone.
- `https://api.heywobo.com` **and** `wss://api.heywobo.com` — the gateway plus the
  `/v1/voice/relay` WebSocket. `api.heywobo.com` is also in `img-src` and `media-src`, for a
  generated image or an audio element pointed straight at the gateway.
- **no `*.supabase.co` at all.** The database is reached through our own origin (§1.3), so
  `connect-src 'self'` already covers it. Turning the proxy off means putting
  `https://*.supabase.co` back.

If the gateway moves, edit those `connect-src` entries and redeploy.

### 1.2 PWA icons

`apps/web-pwa/public/pwa-{192,512}.png`, `pwa-maskable-512.png` and
`apple-touch-icon.png` are cropped from the wordmark's W-mark. If the logo changes,
regenerate: crop `wobo-logo.png` to the W-mark box, alpha-bbox it, composite centred
on a white square at 72% (52% for maskable), export the four sizes — e.g.
`uv run --with pillow python` and PIL's `crop`/`alpha_composite`/`resize`.

### 1.3 The database proxy — `/db`

`vercel.json` rewrites `/db/:path*` to the Supabase project URL, **ahead of the SPA
catch-all** (order is the rule: `/(.*)` would otherwise swallow it into `index.html`). The web
app is built with `VITE_SUPABASE_PROXY=1`, so `apps/web-pwa/src/config/supabaseUrl.ts` hands the
SDK `https://heywobo.com/db` and every call becomes `…/db/auth/v1/…` or `…/db/rest/v1/…`.

Why: the database host was one of the two provider names a learner could read out of the
network tab (§17). It is now ours. The unit test is `apps/web-pwa/test/supabase-url.test.ts`,
which proves both planes survive the prefix; `apps/web-pwa/test/domain.test.ts` pins the rewrite,
its order, and the CSP that depends on it.

Limits, in `infra/dns/heywobo.com.md` in full: no `wss://` through a Vercel rewrite (we use none),
and Supabase's redirect allowlist must contain `https://heywobo.com/**`.

### 1.4 DNS records

The single source of truth is **`infra/dns/heywobo.com.md`**; this is a copy for the runbook.
Three values are read off a dashboard and never from memory.

| Record | Type | Host | Value |
|---|---|---|---|
| Apex → web | `ALIAS`/`ANAME` (or `A`) | `@` | `cname.vercel-dns.com`, or the **A record Vercel prints** for this project |
| www → web | `CNAME` | `www` | `cname.vercel-dns.com` (redirects to the apex) |
| api → gateway | `CNAME` | `api` | the **Railway-provided target** for the custom domain |
| DKIM ×3 | `CNAME` | `<token>._domainkey` | `<token>.dkim.amazonses.com` — the **three tokens from the mail provider** |
| SPF | `TXT` | `@` | `v=spf1 include:amazonses.com ~all` (merge into any existing SPF; never a second one) |
| DMARC | `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@heywobo.com; adkim=s; aspf=s` |
| MAIL FROM (optional) | `MX` + `TXT` | `mail` | `10 feedback-smtp.<region>.amazonses.com` and the same SPF value |
| Supabase | — | — | **no record.** The browser reaches it at `https://heywobo.com/db` (§1.3) |

The DKIM rows are the SES shape; the gateway sends through **Resend** today (which sends over
SES), so take the three `_domainkey` hosts from whichever provider is actually configured. SPF
and DMARC are the same either way.

---

## 2. Gateway → Railway

Deployed with `railway up` **from the repo root**: the Docker build needs the whole
uv workspace as its context. Railway builds from `services/gateway/Dockerfile`,
declared two ways — `railway.json` at the repo root (committed, the source of truth)
and the `RAILWAY_DOCKERFILE_PATH` service variable (already set; it takes precedence
and is a safe duplicate).

```sh
railway login
railway link                       # select the project + service

railway variables --set ENV=prod --set LLM_MODE=live --set TRUST_PROXY=1 \
  --set APP_NAME=Wobo --set APP_URL="$WEB_URL" \
  --set EMAIL_FROM="Wobo <hello@$MAIL_DOMAIN>" --set EMAIL_REPLY_TO="support@$MAIL_DOMAIN"
railway variables --set ANTHROPIC_API_KEY=... --set OPENAI_API_KEY=... --set GOOGLE_AI_API_KEY=...
# The door: one of these must verify a learner token, and the service role key reads the tier.
railway variables --set SUPABASE_URL=https://keepraxqagzgjrrweryt.supabase.co \
  --set SUPABASE_JWT_SECRET=... --set SUPABASE_SERVICE_ROLE_KEY=...
# DEV_AUTH is never set here. ENV=prod refuses to boot with it at any value.

railway up                         # from the repo root
curl -s "$GATEWAY_URL/healthz"
```

`railway.json` sets the healthcheck to `/healthz`, restarts `ON_FAILURE` (10
retries), and pins **one replica** — the rate limiter and the voice-token store are
in-memory, so a second replica would split them. Move both to Redis before scaling.

**`railway up` uploads the build context, so `.railwayignore` matters.** It excludes
`node_modules`, `apps`, `packages`, screenshots and caches (630 MB → a few MB; the
oversized upload is what made earlier deploys time out mid-transfer), and it excludes
every `.env` file — the gateway takes all values from Railway service variables.

**Two content files must ride along.** `content/catalogs/concepts.json` (the concept-id
registry) and `content/factbase/facts.v1.jsonl` (the verified-fact base behind the
correctness gate) are read at runtime, and both modules degrade *silently* when the file is
missing — the fact-check gate simply stops gating. The Dockerfile COPYs them to
`/app/content/...` and points `PLEXUS_CONCEPTS_PATH` / `FACTBASE_DIR` at the copies (the
package installs non-editable, so relative discovery from `__file__` would land inside
`/app/.venv`). Neither `.dockerignore` nor `.railwayignore` may exclude those two
directories; only `content/cache` — written at runtime — stays out.
`services/gateway/tests/test_deploy_config.py` fails if any of that drifts.

Deploying stale code is the failure mode to watch for: if a fix does not appear,
confirm the deploy actually rebuilt (`railway logs`) before debugging the code.

**Custom domain.** `api.heywobo.com` is attached in Railway → service → Settings → Domains →
Custom Domain, which prints the `CNAME` target for the `api` row in §1.4. Railway issues the
certificate once it resolves. The web app calls `https://api.heywobo.com` and nothing else, so
until that certificate is live the app cannot reach the brain — check it before blaming the
gateway.

---

## 3. Supabase → migrations

Project ref `keepraxqagzgjrrweryt`. **The project is currently paused.** Restoring it
is an owner dashboard action (Supabase → project → Restore); nothing else in this
runbook works until it is back, because sign-in and persistence both hang off it.

Migrations in `infra/supabase/migrations/` are the source of truth:

```sh
supabase login
supabase --workdir infra link --project-ref keepraxqagzgjrrweryt
supabase --workdir infra db push     # applies infra/supabase/migrations in order
```

**Auth providers (dashboard, once):** enable Phone (OTP) and Google under
Authentication → Providers, and add `https://heywobo.com/**` to the redirect allowlist
(Authentication → URL Configuration) — that is the origin the OAuth round-trip returns to,
even though the request itself goes out through `/db` (§1.3).

---

## 4. Swapping the domain

Done once already, for `heywobo.com` (2026-09-03). Doing it again is a config change, not a
code change — the list is the receipt of what the first swap touched:

1. `vercel domains add <new-domain>`, plus the `www` row; DNS per §1.4.
2. In the committed `apps/web-pwa/.env.production`: `VITE_APP_URL`, `VITE_GATEWAY_URL`,
   `VITE_APP_NAME`. Then `bash scripts/set-vercel-env.sh` and redeploy. Title, PWA manifest,
   canonical and `og:` tags all follow — `apps/web-pwa/vite.config.ts` reads them.
3. `vercel.json`: the gateway host in `connect-src` / `img-src` / `media-src`, and the `/db`
   rewrite destination if the project moves.
4. `apps/web-pwa/public/robots.txt` and `sitemap.xml` — the only two files where the domain is
   a literal that no env can reach.
5. On the Railway service: `APP_URL`, `APP_NAME`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, and
   `EMAIL_UNSUBSCRIBE_URL` if it is not `APP_URL/unsubscribe`. `APP_URL` is also the CORS
   allow-list entry and the base of every email link. Attach the gateway's own custom domain (§2).
6. `infra/dns/heywobo.com.md` — new file for the new zone; it is the source of truth.
7. Verify the sending domain with the mail provider before flipping `EMAIL_MODE=live`.

`apps/web-pwa/test/domain.test.ts` fails if steps 2–4 disagree with each other.

---

## 5. Smoke checklist (after all three)

```sh
curl -sI "$WEB_URL" | grep -iE 'content-security|strict-transport'
curl -s  "$GATEWAY_URL/healthz"
curl -sI "$WEB_URL/db/auth/v1/health"   # the database proxy reaches the project
curl -sI https://www.heywobo.com | grep -i location   # redirects to the apex
```

- [ ] **No CSP violations** — open the console on a page that renders a chemistry
      structure and one that runs the execution visualiser; zero `Refused to …` lines.
- [ ] **Fonts** — Plus Jakarta Sans and Caveat render (not the fallback stack).
- [ ] **Auth round-trip** — fresh browser → onboarding sign-in beat → phone OTP (or
      Google) → lands home; You → sign out → back to onboarding.
- [ ] **Wobo turn live** — ask something about the current screen → a grounded
      (non-canned) reply; `railway logs` shows the capability invoke.
- [ ] **Voice session** — mic prompt → speak → Wobo answers (WS `/v1/voice/relay`;
      needs `GOOGLE_AI_API_KEY` on the gateway).
- [ ] **Media** — a generated narration actually plays (proves `media-src data:`).
- [ ] **Events landing** — Supabase SQL editor:
      `select * from learner.outbox order by created_at desc limit 10;` — new rows,
      each attributed (app / subject / purpose / consent), drained to `platform.events`.
- [ ] **Persistence** — earn XP, reload → state survives (`learner.learner_state` updated).
- [ ] **PWA** — install from the browser menu → correct icon, standalone window;
      airplane-mode reload still serves the shell.
- [ ] **No dev leaks** — view-source has no localhost URL; `VITE_SUPABASE_DEV_JWT`
      absent from `vercel env ls production`.
- [ ] **No provider hostname in the network tab** — every request goes to `heywobo.com` or
      `api.heywobo.com`; nothing to `*.supabase.co` or `*.up.railway.app`.
