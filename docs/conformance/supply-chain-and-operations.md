# Conformance register — supply chain and operations

Compiled 4 September 2026 against the working tree at commit `95e3617` (branch `the-life`).
`origin/the-life` is 9 commits behind that at `31b31d5`; where a fact depends on what GitHub or a
host can actually see, this register uses the pushed commit and says so.

Every audit, scan and probe below was **run**, not read. Where a thing needs a login this machine
does not hold (Railway), a GitHub scope this token does not have (`admin:repo_hook`), or a human in
a dashboard, it is marked **NOT VERIFIED** and the row names the exact command or click that would
settle it. Nothing here is ticked from a document alone.

**How to read a status.**

| Status | Means |
|---|---|
| MET | The obligation is discharged, and the evidence column names the file, line or command that shows it. |
| PARTIAL | Something real exists and something real is missing. Both are named. |
| NOT MET | It does not exist. |
| N/A | Considered, does not apply to this product, with the reason. |
| NOT VERIFIED | Cannot be checked from this machine. The evidence column says exactly what would check it. |

---

## The five that would actually hurt

1. **Nothing gates a production deploy.** `main` has no branch protection and no ruleset
   (`gh api repos/shreyanrm/wobo/branches/main/protection` → `404 Branch not protected`;
   `gh api .../rulesets` → `[]`). The Vercel git integration deploys the branch on push and does
   not wait for GitHub Actions. On the currently pushed head `31b31d5`, **four of the five CI jobs
   are failing** and heywobo.com is serving. Over the last 40 runs: 5 success, 20 failure, 15
   cancelled. CI is, in practice, decoration.
2. **Nothing tells anyone when the gateway falls over.** There is no uptime monitor, no error
   tracker, no alert route, no status page. `SENTRY_DSN` exists in `.env.example:122` and the
   string `sentry` appears nowhere in `services/`, `apps/` or `packages/`. The only automated
   response to a crash is Railway restarting the container (`railway.json:10`). If the brain dies
   at 2am, the first report is a child failing to get an answer.
3. **17 known-vulnerable JS packages and 3 Python advisories are live, and nothing scans.** `bun
   audit` returns 16 high + 1 moderate; `pip-audit` returns 3 advisories against `aiohttp 3.14.1`
   (the package the live voice relay imports). Dependabot security updates are **disabled**
   (`gh api repos/shreyanrm/wobo` → `dependabot_security_updates: disabled`), no CI job runs an
   audit, and no SBOM exists.
4. **The provider keys the owner pasted into a chat have not been rotated.**
   `docs/history/PHASE-0-REPORT.md:93` recorded the exposure; `docs/WOBO-TASKS.md:17` is still an
   unticked box. Keys in the same format sit in a world-readable (`0644`) `.env.local` on this
   machine. No rotation procedure or cadence is written down anywhere.
5. **Everything runs on one personal account with no second owner and no infrastructure record.**
   Railway service variables, the Railway custom domain, Supabase auth providers and the redirect
   allowlist, and DNS records are all configured by hand in three dashboards owned by one GitHub
   user (`gh api .../collaborators` → `shreyanrm`, alone). Losing that account loses the product's
   entire runtime configuration; the migrations and `vercel.json` would survive, nothing else would.

The good news, stated as plainly: **no secret has ever been committed to this repository.** A scan
of all 6,278 blobs in the object database — every commit on every ref, plus unreferenced objects —
found zero provider keys, zero private keys, zero tokens. The ignore discipline across
`.gitignore`, `.vercelignore`, `.railwayignore` and `.dockerignore` is genuinely careful and the
gateway logs key *presence*, never key *value*.

---

## 1. Dependency management

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 1.1 | A lockfile for the JS tree is committed | OpenSSF Scorecard "Pinned-Dependencies"; NIST SSDF PW.4 | MET | `git ls-files` shows `bun.lock` (133,540 B) and `services/render-worker/bun.lock` (49,778 B), both tracked | — |
| 1.2 | A lockfile for the Python tree is committed | same | MET | `uv.lock` tracked, 461,418 B | — |
| 1.3 | Lockfiles carry integrity hashes, not just versions | SLSA L1 / SSDF PW.4.4 | MET | `grep -c '"sha512-' bun.lock` → 492; `grep -c 'hash = "sha256:' uv.lock` → 1386 | — |
| 1.4 | CI installs strictly from the lockfile (JS) | SSDF PW.4 | MET | `.github/workflows/ci.yml:37,78,113,206` — `bun install --frozen-lockfile` in all four JS jobs | — |
| 1.5 | CI installs strictly from the lockfile (Python) | same | PARTIAL | `.github/workflows/ci.yml:169` runs `uv sync --all-packages` **without** `--frozen` or `--locked`, so uv silently re-resolves and rewrites the lock if a `pyproject.toml` drifted; the gateway image does it correctly at `services/gateway/Dockerfile:18,24` (`uv sync --frozen`) | Add `--frozen` to the CI `uv sync` line |
| 1.6 | The production web build installs from the lockfile | same | PARTIAL | `vercel.json:3` — `"installCommand": "bun install"`, no `--frozen-lockfile`. Bun defaults to frozen when `CI` is set, which Vercel sets, so it is *probably* frozen — but the guarantee is an undocumented default, not a stated flag | Change to `bun install --frozen-lockfile` |
| 1.7 | The gateway image installs from the lockfile | SLSA L1 | MET | `services/gateway/Dockerfile:18,24` — `uv sync --frozen --no-dev --no-editable` | — |
| 1.8 | Direct dependency versions are pinned | OpenSSF Scorecard | PARTIAL | Ranges throughout (`react: ^19.0.0`, `vite: ^6.0.0`, `aiohttp>=3.9`, `litellm>=1.50`), and seven `"@types/bun": "latest"` specs (`apps/web-pwa/package.json:47`, `packages/*/package.json`). The lockfiles pin the actual resolution, so a build is deterministic; a *re-lock* is not | Replace `latest` with a real range; accept ranges elsewhere as long as the lock is authoritative |
| 1.9 | Every dependency resolves from a trusted registry | SSDF PW.4.1 | MET | `grep -oE '"(git\+\|https?://)[^"]+"' bun.lock \| grep -v registry.npmjs.org` → empty. `uv.lock` non-PyPI sources are only the four workspace members (`editable = "services/…"`) | — |
| 1.10 | Lifecycle/postinstall scripts from third parties are not executed | supply-chain hardening | MET | Bun does not run install scripts for untrusted packages unless listed in `trustedDependencies`; `git grep trustedDependencies -- '**/package.json'` → no matches, so none are trusted | — |
| 1.11 | Something scans for known vulnerabilities, automatically | SSDF RV.1.1; OpenSSF Scorecard "Vulnerabilities" | NOT MET | `.github/workflows/ci.yml` has no audit step (full read; the five jobs are `js`, `gates`, `e2e`, `python`, `render-worker`). `gh api repos/shreyanrm/wobo` → `dependabot_security_updates: {"status":"disabled"}`; `gh api .../dependabot/alerts` → `403 Dependabot alerts are disabled` | Add a `.github/dependabot.yml` for `bun` + `uv` + `github-actions`, and a CI step running `bun audit` and `uvx pip-audit` |
| 1.12 | The JS tree has no known-vulnerable packages **today** | SSDF RV.1 | NOT MET | `bun audit` (run 2026-09-04, v1.3.14): **17 vulnerabilities — 16 high, 1 moderate.** `fast-uri` (6 high, SSRF + host confusion, via `vite-plugin-pwa`); `brace-expansion` (5 high, DoS, via `vite-plugin-pwa`); `nanoid` (2 high, via `vite`); `postcss` (1 high + 1 moderate, path traversal via `sourceMappingURL`, via `vite`); `browserslist` (2 high, via `@vitejs/plugin-react` and `vite-plugin-pwa`) | All are build-time toolchain, none ships to the browser — `bun update` inside the existing ranges resolves most; verify with a re-run |
| 1.13 | The Python tree has no known-vulnerable packages **today** | same | NOT MET | `uvx pip-audit -r <(uv export --all-packages --no-hashes)` (run 2026-09-04): `aiohttp 3.14.1` — `PYSEC-2026-3545` (fix 3.14.3), `PYSEC-2026-3546`, `PYSEC-2026-3547` (fix 3.14.2). Unlike 1.12 this one **runs in production**: `services/gateway/pyproject.toml:9` declares it for the live voice relay's upstream websockets | `uv lock --upgrade-package aiohttp` to ≥3.14.3, then redeploy the gateway |
| 1.14 | The render-worker's separate tree is clean | same | MET | `cd services/render-worker && bun audit` → no findings, exit 0 | — |
| 1.15 | Third-party code loaded at runtime is integrity-pinned | SRI / CSP hardening | PARTIAL | `apps/web-pwa/src/engines/cs/pyodide.ts:13-14,64,67` loads ~10 MB of CPython WASM from `cdn.jsdelivr.net` by dynamic `import()`, and `vercel.json:23` allows `cdn.jsdelivr.net` in both `script-src` and `connect-src`. The **version is pinned** (`v0.26.4`) but there is **no integrity hash**, so a jsDelivr compromise executes attacker code on the app origin, with the learner's session in reach | Self-host the pyodide directory under `apps/web-pwa/public` and drop jsDelivr from the CSP — the code comment at `pyodide.ts:210-211` already names this as the path |
| 1.16 | Dependency changes are reviewed before merge | SSDF PW.4.4 | NOT MET | No branch protection (§5), 2 pull requests in the repo's entire life (`gh pr list --state all`), no `dependency-review-action` in the workflow | Enable the GitHub dependency-review action once PRs are the merge path (§5.7) |
| 1.17 | A license inventory exists for shipped dependencies | OSS compliance | NOT MET | No `LICENSE` scan, no SBOM (§4.4), no license field audit anywhere in the repo | Generate an SBOM (§4.4) and read licenses off it once |
| 1.18 | Unused/dead dependency surface is controlled | least dependency | PARTIAL | `.env.example:88` declares `WOBO_GATEWAY_KEY` which `git grep` finds in no source file — a documented credential with no consumer. Otherwise the manifests are commented and justified line by line (`services/gateway/pyproject.toml:6-27` explains every entry) | Delete the dead var from `.env.example` |

---

## 2. Secret handling

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 2.1 | No secret exists in the current tracked tree | SSDF PW.9; OWASP ASVS 14.1 | MET | Scanned every tracked file for provider-key, JWT, private-key, AWS, GitHub, Slack and Supabase patterns. Only tracked env files are `.env.example`, `apps/web-pwa/.env.example`, `apps/web-pwa/.env.production` — all three verified secret-free by reading them | — |
| 2.2 | No secret exists anywhere in git history | same | MET | Full scan of **all 6,278 blobs** in the object database (`git cat-file --batch-all-objects`, every ref plus unreferenced objects) against a 16-pattern regex. Zero provider keys, zero private keys, zero tokens. The 27 `service_role` hits are all SQL `grant` statements in `infra/supabase/migrations/`, not keys | — |
| 2.3 | …including unreachable objects | thoroughness | MET (with a note) | One blob, `77ca1ef7a8c25e7fec88db929dfbb5735dfbf707`, holds an older `scripts/set-vercel-env.sh` with the Supabase **anon/publishable** key inline. It is **not reachable from any ref** (`git rev-list --all --objects` does not list it) and the key is publishable by design — it ships in the browser bundle. The current script (`scripts/set-vercel-env.sh:8-12`) takes the key as an argument and commits nothing | Nothing required; `git gc --prune=now` would clear the object if the owner wants it gone |
| 2.4 | `.gitignore` covers every env file, with deliberate exceptions | SSDF PW.9 | MET | `.gitignore:4-12` — `.env`, `.env.*`, `*.local`, `secrets/`, `*.pem`, `*.key`, then three explicit negations. The comment at `:2-3` explains the last-match rule so nobody appends a broad pattern below | — |
| 2.5 | Deploy upload contexts exclude env files | same | MET | `.vercelignore:6-9`, `.railwayignore:8-10`, `.dockerignore:3-4` all exclude `.env` / `.env.*` / `.env*` with only `.env.example` (and, for Vercel, the non-secret `apps/web-pwa/.env.production`) negated | — |
| 2.6 | The one committed production env file is non-secret only | SSDF PW.9 | MET | `apps/web-pwa/.env.production` read in full: five mode flags, three brand strings, two public URLs, one proxy flag. Its header (`:1-13`) states the rule and names the two vars that may never appear. `services/gateway/tests/test_deploy_config.py:108` is a test named `test_vercel_env_script_is_committed_and_credential_free` | — |
| 2.7 | Example env files carry no live values | same | MET | `.env.example` — every `*KEY`/`*SECRET`/`*TOKEN`/`*DSN` var is empty except two dev-only placeholder strings (`:88-89`) and one literal `sb_publishable_xxx` (`:23`) | — |
| 2.8 | Secrets never reach application logs | OWASP ASVS 7.1.1 | MET | `git grep -nE 'log(ger)?\.(info\|debug\|warning\|error)\(.*(API_KEY\|token\|secret)' -- services/` returns three lines — `app.py:137,139` and `plexus/media.py:40` — each logging only that a key is **missing**, never a value. `parents.py:248-251` masks parent email to `a***@example.test` before it is stored or shown | — |
| 2.9 | Production config carries no fallback credential | fail-closed | MET | `email.py:459-466` — an unset `INTERNAL_EMAIL_KEY` refuses every request rather than defaulting to the `.env.example` placeholder. `DEPLOY.md:72,82` records that `ENV=prod` refuses to boot without a JWT verification path and refuses to boot at all if `DEV_AUTH` is set | — |
| 2.10 | Local developer secrets are stored under protection | SSDF PW.9 / basic hygiene | NOT MET | `.env.local` on this machine is mode **`0644` (world-readable)** and holds plaintext `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GOOGLE_AI_API_KEY` in live key formats. It is correctly gitignored (`git check-ignore -v .env.local` → `.gitignore:6:*.local`) and has never been committed (§2.2), so this is a laptop risk, not a repo risk | `chmod 600 .env.local`, and move the keys to the OS keychain or a secrets manager |
| 2.11 | Keys exposed in chat have been rotated | NIST SP 800-57 §5.3; any incident practice | NOT MET | `docs/history/PHASE-0-REPORT.md:93-94` records that the OpenAI, Anthropic, Gemini and Supabase service-role keys were pasted into a chat. `docs/WOBO-TASKS.md:17` is still `- [ ] **owner** Precautionary rotation of provider keys before launch`. The keys in `.env.local` are of the same providers and were last written 2026-09-03 | Rotate all five providers in their consoles, update Railway service variables and `.env.local`, tick the box |
| 2.12 | A rotation procedure and cadence is written down | ISO 27001 A.5.17 (control, not certification) | NOT MET | `git grep -in 'rotate\|rotation' -- '*.md'` returns only the two open to-dos above and unrelated prose. `DEPLOY.md` §0 says where each secret lives but never how or when it is replaced | One section in `DEPLOY.md`: the list of secrets, where each is set, and the sequence to swap one without downtime |
| 2.13 | A secrets manager holds production secrets | SSDF PO.5 | NOT MET | Production secrets live in Railway service variables and Vercel project env, typed by hand (`DEPLOY.md:275-282`). `CONTEXT.md:157` names Infisical in the intended stack; nothing in the repo integrates it | Acceptable at this size — but §2.12 becomes mandatory if it stays manual |
| 2.14 | Push protection stops a secret before it lands | GitHub Advanced Security (free on public repos) | MET | `gh api repos/shreyanrm/wobo` → `secret_scanning: enabled`, `secret_scanning_push_protection: enabled`. `gh api .../secret-scanning/alerts` → `[]` | — |
| 2.15 | Secret scanning is configured to its full strength | same | NOT MET | Same call: `secret_scanning_non_provider_patterns: disabled`, `secret_scanning_validity_checks: disabled` — so a generic high-entropy string is not caught, and a caught key is not tested for whether it is still live | Two toggles in repo Settings → Code security |
| 2.16 | CI holds no secrets | least privilege | MET | `grep -n 'secrets\.' .github/workflows/ci.yml` → no matches. The web build in the `js` job deliberately overrides to the keyless mock provider (`ci.yml` "Build web app", `VITE_LLM_MODE: mock`) so no CI artifact is ever a live-mode bundle | — |
| 2.17 | The service-role key never reaches a browser | OWASP ASVS 14.2 | MET (contract level) | `DEPLOY.md:60` and `apps/web-pwa/.env.production:8-9` both state anon-key-only; `vercel env ls` shows `VITE_SUPABASE_ANON_KEY` as the only key-shaped var in either target. The gateway holds `SUPABASE_SERVICE_ROLE_KEY` server-side only (`DEPLOY.md:78`) | — |
| 2.18 | The Railway project token pasted in chat has been invalidated | incident practice | NOT VERIFIED | `railway status` → `Unauthorized. Please login with 'railway login'` — this machine cannot read Railway's token list. `docs/WOBO-TASKS.md:17` names Railway in the same unticked rotation to-do | `railway login`, then Railway → Account → Tokens: revoke every token not recognised, and check Project → Settings → Tokens |
| 2.19 | Provider keys currently in use are confirmed live/valid | operational | NOT VERIFIED | Deliberately not tested: verifying would mean sending the owner's credentials to third-party APIs from an audit session | Owner runs one authenticated call per provider, or reads last-used timestamps in each provider console |

---

## 3. Continuous integration

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 3.1 | CI exists and runs on every push and PR to the working branches | SSDF PW.7/PW.8 | MET | `.github/workflows/ci.yml:5-9` — `push` and `pull_request` on `[main, the-life, "phase-*"]` | — |
| 3.2 | CI covers the whole tree | same | MET | Five jobs: `js` (typecheck, biome, unit, web build), `gates` (three brand gates), `e2e` (two Playwright suites), `python` (ruff + four pytest suites), `render-worker` (bun test). Only the audit gate is missing (§1.11) | — |
| 3.3 | CI is currently green | the point of CI | NOT MET | `gh api repos/shreyanrm/wobo/commits/31b31d5/check-runs` on the pushed head: `Python (ruff · pytest): failure`, `JS (typecheck · lint · unit · web build): failure`, `Brand gates: failure`, `E2E (Playwright journey suite): failure`, `Render worker: success`. The failing Python job dies at `pytest — gateway`; the failing gates job dies at `Build web app` | Fix the four failing jobs, or this register's other CI rows are moot |
| 3.4 | CI is reliably green over time | signal quality | NOT MET | Last 40 runs: **5 success, 20 failure, 15 cancelled** (`gh run list --limit 40 --json conclusion`). A gate that fails four times in five teaches everyone to ignore it | — |
| 3.5 | A failing CI run blocks a merge | OpenSSF Scorecard "Branch-Protection"; SSDF PW.7.2 | NOT MET | `gh api repos/shreyanrm/wobo/branches/main/protection` → `404 Branch not protected`. `gh api .../rulesets` → `[]`. No required status check exists on any branch | Enable a ruleset on `main` (and `the-life`) requiring the five CI checks — see §5 |
| 3.6 | A failing CI run blocks a **deploy** | release engineering | NOT MET | The Vercel git integration builds on push and does not consult GitHub check runs. Proof: the pushed head `31b31d5` has four failing checks and `https://heywobo.com` returns `200` from a production deployment on the same branch (`vercel inspect` → aliases include `heywobo.com` and `wobo-git-the-life-depl-shreyan.vercel.app`) | Turn off automatic production deploys and promote deliberately, or move the production branch behind a required-check ruleset |
| 3.7 | Actions are pinned to a commit SHA | OpenSSF Scorecard "Pinned-Dependencies"; SLSA | NOT MET | All nine `uses:` lines use a floating major tag: `actions/checkout@v4` (`:24,65,100,160,189`), `oven-sh/setup-bun@v2` (`:26,67,102,191`), `actions/cache@v4` (`:31,72,107,116,196`), `astral-sh/setup-uv@v5` (`:162`), `actions/upload-artifact@v4` (`:147`). A tag is mutable: whoever controls the action repo controls what runs in CI | Repin each to a full 40-char SHA with the version in a trailing comment |
| 3.8 | The workflow token runs least-privilege | OpenSSF Scorecard "Token-Permissions" | NOT MET | `grep -n permissions .github/workflows/ci.yml` → no match. With no `permissions:` block the workflow inherits the repository default, which for an older repo is read/write on all scopes | Add `permissions: contents: read` at the top of `ci.yml`; the jobs need nothing more |
| 3.9 | The repository's default workflow permission is read-only | same | NOT VERIFIED | `gh api repos/shreyanrm/wobo/actions/permissions/workflow` needs `admin:repo_hook`, which this token lacks (scopes: `gist, read:org, repo, workflow`) | Repo Settings → Actions → General → Workflow permissions; set "Read repository contents" |
| 3.10 | Runs are deduplicated so the branch head is what's tested | practicality | MET | `.github/workflows/ci.yml:12-14` — `concurrency` group per ref with `cancel-in-progress: true`. Note the cost: 15 of the last 40 runs are `cancelled`, so many commits were never fully tested |  — |
| 3.11 | Third-party actions come from trusted publishers | supply chain | PARTIAL | `actions/*` is GitHub's own; `oven-sh/setup-bun` and `astral-sh/setup-uv` are the vendors' own. All reputable — but unpinned (§3.7), so trust is in the repo owner's *future* behaviour, not in a reviewed artifact | Fixed by §3.7 |
| 3.12 | Fork pull requests cannot exfiltrate secrets | GitHub hardening | MET | The workflow uses `pull_request`, never `pull_request_target`, and holds no secrets at all (§2.16). A fork PR's job gets a read-only token and nothing to steal | — |
| 3.13 | CI artifacts do not leak build inputs | hygiene | MET | The only upload is the Playwright report on failure (`ci.yml:141-152`), 7-day retention, from a suite the config runs in mock mode with no gateway | — |
| 3.14 | The local verify command matches CI | reproducibility | MET | `package.json:15-22` — `typecheck`, `test`, `gate` (`scripts/gates.sh` runs all three gate scripts), `py:test`; `bunfig.toml:[test]` excludes the Playwright dirs so `bun test` is honest rather than noisy (the file's own comment explains why) | — |

---

## 4. Reproducible builds and SBOM

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 4.1 | Dependency resolution is deterministic | SLSA L1 | MET | Two hashed lockfiles (§1.1-1.3), frozen installs in CI and the image (§1.4, §1.7) | — |
| 4.2 | Container base images are pinned by digest | SLSA L2 / CIS Docker 4.2 | NOT MET | `services/gateway/Dockerfile:7` — `FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim` and `:26` — `FROM python:3.12-slim-bookworm`. Both are mutable tags; the same Dockerfile builds a different image next week | Append `@sha256:…` to both `FROM` lines and bump them deliberately |
| 4.3 | The container runs as a non-root user | CIS Docker 4.1 | MET | `services/gateway/Dockerfile:27` — `RUN useradd --create-home --uid 10001 gateway`; `:63` — `USER gateway`; every `COPY` uses `--chown=gateway:gateway` | — |
| 4.4 | An SBOM is produced for a release | US EO 14028; CRA Annex I | NOT MET | `find . -iname '*sbom*' -o -iname '*.cdx.json' -o -iname '*spdx*'` → nothing. No tooling installed either (`syft`, `cyclonedx-py` both absent) | One CI step: `syft . -o cyclonedx-json` for the JS tree and `uv export` → `cyclonedx-py` for Python, uploaded as an artifact |
| 4.5 | Build provenance / attestation is generated | SLSA L2-L3 | NOT MET | No `actions/attest-build-provenance` step; nothing signs or attests the Docker image or the web bundle | `actions/attest-build-provenance` in a release workflow, once one exists |
| 4.6 | Released artifacts are signed | SLSA L3 | NOT MET | No cosign, no signing key, no signed image | Defer until §4.5 exists; not proportionate today |
| 4.7 | Releases are versioned and tagged | change management | NOT MET | `git tag` → empty. `gh release list` → empty. Every `package.json` is `"version": "0.0.0"`, `pyproject.toml:3` likewise. There is no name for what is in production | Tag the production commit at each promote; it is also the only way §6.3's rollback has a target to name |
| 4.8 | The build does not reach the network for code | hermeticity | PARTIAL | The gateway image build fetches only from PyPI under `--frozen` (`Dockerfile:18,24`) — deterministic. The web build is deterministic at build time, but the **running app** fetches ~10 MB of executable WASM from jsDelivr (§1.15), which is the same class of risk one step later | Fixed by §1.15 |
| 4.9 | Runtime data files are pinned into the image, not fetched | operational determinism | MET | `services/gateway/Dockerfile:31-46` copies `concepts.json`, `facts.v1.jsonl`, `festivals.json` and the help-centre copy into the image with `ENV` overrides pointing at them; `services/gateway/tests/test_deploy_config.py` fails if that drifts. The comment records why: both modules "degrade *silently*" when the file is missing | — |

---

## 5. Branch protection and review

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 5.1 | The default branch is protected | OpenSSF Scorecard "Branch-Protection" | NOT MET | `gh api repos/shreyanrm/wobo/branches/main/protection` → `{"message":"Branch not protected","status":"404"}` | Create a ruleset on `main` |
| 5.2 | The branch that actually deploys is protected | same, applied honestly | NOT MET | `the-life` is the live branch (production deployment aliased `wobo-git-the-life-depl-shreyan.vercel.app`). `gh api .../rulesets` → `[]` — no ruleset covers it either | Protect `the-life` too, or make `main` the deploy branch and protect that |
| 5.3 | Status checks are required to pass | SSDF PW.7.2 | NOT MET | No protection object exists to hold a required-checks list (§5.1) | Require the five CI checks in the ruleset |
| 5.4 | Review is required before merge | SSDF PW.7.1; SOC 2 CC8.1 (control, not certification) | NOT MET | `gh pr list --state all` → 2 PRs total in the repo's life (#1 merged 2026-07-01, #2 open since 2026-07-01). Everything since has been pushed straight to the branch | With one collaborator this cannot be a second human; a self-review-plus-required-checks ruleset is the honest version |
| 5.5 | Force-push and deletion are blocked on the deploy branch | GitHub hardening | NOT MET | Follows from §5.1/§5.2 — no protection, so both are permitted | Same ruleset |
| 5.6 | Code owners are declared | change control | NOT MET | No `CODEOWNERS` at the root or in `.github/` | Low value at one collaborator; add when a second person arrives |
| 5.7 | There is more than one person who can review or recover | bus factor | NOT MET | `gh api repos/shreyanrm/wobo/collaborators` → `shreyanrm` only. The repo is under a personal account, not an organisation | Move the repo to an org and add a second owner — this is also the fix for §8.8 |
| 5.8 | Commits are signed | SLSA L2; OpenSSF Scorecard "Signed-Releases" | NOT MET | `git log --format='%h %G? %s' -20` → every commit shows `N` (no signature). `git config commit.gpgsign` → unset | `git config --global commit.gpgsign true` with an SSH signing key; five minutes |
| 5.9 | The repository's public visibility is deliberate | disclosure posture | MET | `gh repo view` → `"isPrivate": false`. `DEPLOY.md:3-5` and `.gitignore:1` both state the repo is public and treat it as a constraint on every secret decision. That discipline holds (§2.1-2.2) | — |
| 5.10 | A security disclosure route is published | ISO 29147; CRA Art. 13 | NOT MET | No `SECURITY.md` at the root or in `.github/`. The public site names `support@heywobo.com` for everything | One `SECURITY.md` naming an address and a response window |

---

## 6. Deployment and rollback

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 6.1 | The web deploy is automated | DORA / release engineering | MET | Vercel git integration builds on push; the live production deployment `dpl_BsQc9VpKAt5Tc5kcRp4fDWTWSzva` carries the aliases `heywobo.com`, `www.heywobo.com` and `wobo-git-the-life-…`. `.vercelignore:1-2` records that production is built remotely by the git integration | — |
| 6.2 | The gateway deploy is automated | same | NOT MET | `DEPLOY.md:265-286` — the gateway ships by an owner typing `railway up` from the repo root on their own laptop, after `railway login` and `railway link`. No workflow, no trigger, no record of what shipped | A deploy workflow on a tag, or at minimum record the deployed commit somewhere the gateway will report |
| 6.3 | A deploy can be rolled back | DORA "time to restore" | PARTIAL | Vercel retains prior deployments and can re-alias one (`vercel ls` shows the full history; the current production build is one of many `Ready` builds), so a web rollback is one dashboard action. But **no rollback procedure is written anywhere** — `git grep -in 'rollback'` over the docs returns only `docs/PLATFORMS.md:500,569,604,607` about a *future* desktop updater, never about heywobo.com or the gateway | Two paragraphs in `DEPLOY.md`: how to re-promote a Vercel deployment, and how to redeploy a previous Railway build |
| 6.4 | The gateway can be rolled back | same | NOT VERIFIED | Railway keeps prior deployments and offers redeploy, but this machine cannot log in (`railway status` → `Unauthorized`) and there is no tag or version to roll *back to* (§4.7) | `railway login`, then Railway → service → Deployments → Redeploy a previous build; write down what you saw |
| 6.5 | A database migration can be rolled back | change management | NOT MET | 14 forward migrations in `infra/supabase/migrations/`, none with a down/rollback counterpart (`ls infra/supabase/migrations \| grep -i down` → nothing). A bad migration is repaired by writing a new forward migration under time pressure | For each new migration, write the reverse statements in a comment block at minimum |
| 6.6 | Migrations are applied automatically and in order | same | NOT MET | `DEPLOY.md:326-331` — `supabase --workdir infra db push`, run by hand by the owner. The `supabase` CLI is not even installed on this machine (`which supabase` → not found) | A migrate step in the deploy path, or an explicit written order-of-operations in `DEPLOY.md` §5 |
| 6.7 | Deploys are gated on tests | SSDF PW.7 | NOT MET | See §3.6 — production is live from a branch with four failing CI jobs | — |
| 6.8 | A post-deploy smoke check exists | release engineering | PARTIAL | `DEPLOY.md:362-400` is a genuinely good manual checklist — four `curl`s plus eleven human checks including "no provider hostname in the network tab" and "no dev leaks". It is manual, unticked, and nothing runs it | Automate the four `curl`s as a post-deploy job; leave the human ones human |
| 6.9 | The service reports its own health | operational baseline | MET | `railway.json:8` `healthcheckPath: /healthz` with a 120 s timeout; `services/gateway/Dockerfile:65-66` adds a container-level `HEALTHCHECK` every 15 s. Verified live: `curl https://api.heywobo.com/healthz` → `{"status":"ok","mode":"live"}` | — |
| 6.10 | Scaling limits are known and recorded | capacity | MET | `railway.json:12` pins `numReplicas: 1` and `DEPLOY.md:288-290` explains why — "the rate limiter and the voice-token store are in-memory, so a second replica would split them. Move both to Redis before scaling." This is exactly the kind of thing usually discovered during an outage | — |
| 6.11 | Nothing is deployed by hand | modern practice | NOT MET | Two of the three planes are hand-deployed from the owner's laptop: the gateway (§6.2) and the database (§6.6). Both require the owner's personal logins. `DEPLOY.md:3-5` says so plainly: "Every step needs the OWNER's authenticated accounts; nothing here runs unattended" | Honest and stable at this size; it becomes a single-point-of-failure the day the owner is unavailable (§8.8) |
| 6.12 | What is in production is identifiable from the repo | traceability | NOT MET | No tags, no releases, no version endpoint, no build-info file. `/healthz` returns `{"status":"ok","mode":"live"}` and nothing about *which* code. `DEPLOY.md:302-304` names the failure mode from experience: "Deploying stale code is the failure mode to watch for" | Bake the git SHA into the image and return it from `/healthz` |
| 6.13 | The local tree matches what is deployed | drift | NOT MET (today) | `git rev-list --left-right --count origin/the-life...HEAD` → `0 9`. Nine local commits — including "cancel, never refund", "auth: the doors, redesigned" and "law v5 everywhere" — exist only on this laptop. If it were lost right now, they are gone | Push, or accept it as a deliberate hold; either way it is a fact worth seeing |

---

## 7. Environment separation

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 7.1 | A staging environment exists | change management | NOT MET | `git grep -inE 'staging'` across `*.md *.json *.ts *.py` returns exactly one hit, and it is an unrelated test name. There is one Vercel project, one Railway service, one Supabase project | — |
| 7.2 | Non-production builds exist at all | same | PARTIAL | Vercel preview deployments are produced per push (`vercel ls` shows a dozen previews in the last five hours, several `Error`). They are builds, not an environment: they have no separate backend | — |
| 7.3 | Non-production has its own data plane | data safety | NOT MET | One Supabase project (`keepraxqagzgjrrweryt`) is named in `apps/web-pwa/.env.production:29`, `vercel.json:9`, `DEPLOY.md:15` and the Railway variables. Preview builds that reach a database reach the **same rows children are using** | Create a second Supabase project for preview, or set the preview env to `VITE_PERSIST_MODE=local` so previews cannot write |
| 7.4 | Preview env vars are set deliberately | config hygiene | PARTIAL | `vercel env ls` shows four Preview vars; pulling them (`vercel env pull --environment=preview`) returns `VITE_GATEWAY_URL=""`, `VITE_LLM_MODE=""`, `VITE_SUPABASE_URL=""` — **all empty strings**, which override the committed defaults with nothing. `VITE_PERSIST_MODE` and `VITE_DEV_AUTH` are not set for Preview at all, so previews inherit `live` / `false` from `apps/web-pwa/.env.production:17-19` | Decide what a preview is for, then set all five vars to match that decision |
| 7.5 | Preview deployments are access-controlled | exposure | NOT VERIFIED | Vercel deployment protection is a project setting the CLI does not print (`vercel project inspect wobo` shows only framework settings) | Vercel → Project → Settings → Deployment Protection; confirm previews are not publicly indexable |
| 7.6 | Production and development modes are separated by configuration, not by code | 12-factor III | MET | `DEPLOY.md:38-120` is a full env contract: every mode flag, where it lives, whether it is secret, and its production value. `apps/web-pwa/.env.production:12-13` records that without the file the build "would fall back to dev defaults … and fail OPEN" | — |
| 7.7 | Development authentication cannot reach production | fail-closed | MET | `DEPLOY.md:63,82` — `VITE_SUPABASE_DEV_JWT` is "never set in production"; `DEV_AUTH` is never set on Railway and `ENV=prod` "refuses to boot with it at any value". `vercel env ls` confirms neither var exists in the Production target | — |
| 7.8 | Test/CI runs cannot touch production data | isolation | MET | The `js` job builds with `VITE_LLM_MODE: mock` and a blank gateway URL; `playwright.config.ts` starts vite in mock mode with dev auth and local persistence and, per `ci.yml:129-131`, "fails the run if the page reaches any origin at all". No CI job holds a credential (§2.16) | — |

---

## 8. Infrastructure as code

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 8.1 | The web host's build configuration is in the repo | IaC | MET | `vercel.json` at the root — install/build commands, output dir, the `/db` rewrite, the SPA fallback, and all seven security headers including the full CSP (`:23`). `DEPLOY.md:26-35` records that the second, conflicting `apps/web-pwa/vercel.json` was deleted | — |
| 8.2 | The gateway host's build and deploy configuration is in the repo | IaC | PARTIAL | `railway.json` covers builder, Dockerfile path, healthcheck, restart policy and replica count. It does **not** cover service variables, the custom domain, or the region | Railway supports more of this in config; move what it supports |
| 8.3 | The database schema is in the repo | IaC | MET | 14 ordered migrations, `0001`→`0014`, in `infra/supabase/migrations/`, with grants and RLS in the same files (e.g. `0002_learner_operational_plane.sql:204-214`) | — |
| 8.4 | Database auth configuration is in the repo | IaC | NOT MET | `DEPLOY.md:333-337` — enabling Phone (OTP) and Google providers, and adding `https://heywobo.com/**` to the redirect allowlist, are **dashboard actions, once**. Nothing in the repo records or reproduces them; nothing detects if the allowlist changes | Record the exact provider settings and allowlist entries in `infra/supabase/README.md` so they can be rebuilt |
| 8.5 | Runtime environment variables are in code (or reproducible from it) | IaC | PARTIAL | Vercel: `scripts/set-vercel-env.sh` reproduces the five non-secret production vars from the committed `.env.production`, credential-free by design and tested (`test_deploy_config.py:108`). Railway: the ~20 variables at `DEPLOY.md:65-120` are a **documentation table**, typed by hand into a dashboard. There is no equivalent script | Write `scripts/set-railway-env.sh` on the same pattern — non-secret values from a committed file, secrets as arguments |
| 8.6 | DNS is in code | IaC | PARTIAL | `infra/dns/heywobo.com.md` is declared the single source of truth (`DEPLOY.md:23-24`, `:243`) and `DEPLOY.md` §1.4 is a deliberate copy of it. It is a markdown table, not a zone file, and nothing applies or diffs it | Export the zone and commit it, or accept the table but add a check |
| 8.7 | Every configured surface is enumerated somewhere | recoverability | PARTIAL | `DEPLOY.md` is unusually complete about what is configured where — this register found no configured surface it fails to mention. What is missing is the **values**: which Railway variables are actually set, which Supabase providers are actually on, what the current DNS actually is | Once per quarter, dump each dashboard's state next to the runbook |
| 8.8 | Loss of one account would not lose the product | continuity | NOT MET | Vercel (`depl-shreyan`), Railway, Supabase and GitHub are all on one personal identity; the repo has one collaborator (§5.7). What is in the repo survives: schema, headers, Dockerfile, DNS as prose. What does not: every Railway service variable and secret, the Railway custom domain, the Supabase auth providers and redirect allowlist, the Vercel domain and env, and the live database | Move GitHub to an organisation, add a second owner on each platform, and store the recovery detail somewhere the owner is not the only reader |
| 8.9 | Database backups exist and are recoverable | continuity | NOT VERIFIED | Supabase backup frequency and retention depend on the project's plan and are shown only in the dashboard; the Supabase MCP server is not connected in this session and the `supabase` CLI is not installed here | Supabase → Project → Database → Backups: confirm frequency and retention, then restore one into a scratch project and time it |
| 8.10 | The runbook is accurate | trust in the runbook | PARTIAL | `DEPLOY.md:320-322` states "**The project is currently paused.** … nothing else in this runbook works until it is back." That is stale — `curl -sI https://heywobo.com/db/auth/v1/health` returns `401` (an answering project rejecting an unauthenticated call), not the 503/540 a paused project returns. A runbook with one wrong sentence is read more slowly at 2am | Delete the paragraph |

---

## 9. Monitoring and alerting

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 9.1 | The service exposes health | baseline | MET | `curl https://api.heywobo.com/healthz` → `{"status":"ok","mode":"live"}` (run 2026-09-04). Web root returns `200` | — |
| 9.2 | A readiness probe distinct from liveness exists | k8s/12-factor convention | NOT MET | `curl -o /dev/null -w '%{http_code}' https://api.heywobo.com/readyz` → `404`. `/healthz` answers `ok` without asserting that Supabase, the model providers or the fact-base are reachable | Add `/readyz` that checks the three downstreams; it is what makes §9.3 worth alerting on |
| 9.3 | Something outside the platform watches the service | SRE baseline | NOT MET | `git grep -ilE 'uptimerobot\|betterstack\|healthchecks\.io\|statuspage'` → three files, all of which mention nothing of the sort (they matched on `sentry`/`incident` prose). No monitor is configured anywhere in the repo | A free uptime monitor on `https://api.heywobo.com/healthz` and `https://heywobo.com`, alerting to the owner's phone. This is the single cheapest fix in this register |
| 9.4 | Someone is told when the gateway falls over | the owner's own question | NOT MET | The only automated response is Railway restarting the container (`railway.json:10-11`, `ON_FAILURE`, 10 retries) — silent, and after 10 failures it stops trying and still tells no one. Railway's own built-in deploy/crash email notifications could not be checked (`railway status` → `Unauthorized`) | Fix §9.3; separately, confirm Railway → Project → Settings → Notifications is on |
| 9.5 | Application errors are captured centrally | observability baseline | NOT MET | `SENTRY_DSN` is declared at `.env.example:122` and recommended at `docs/06-TOOLING/01-api-keys-and-env.md:16`. `git grep -in sentry -- services/ apps/ packages/` → **zero matches**. The variable is aspirational; no error reporter is wired on either the browser or the gateway | Sentry (or equivalent) on both halves; a child hitting a crash currently produces no record anywhere |
| 9.6 | Requests are logged in a structured, queryable form | observability | MET | `services/gateway/src/wobo_gateway/app.py:96-117` — a `_JsonFormatter` installed on the root logger emitting `json.dumps` lines; the Dockerfile runs uvicorn with `--no-access-log` precisely so the app's own JSON lines are the only ones (`Dockerfile:69-71`) | — |
| 9.7 | Metrics are collected and retained | observability | NOT MET | `services/gateway/src/wobo_gateway/telemetry.py:1-6` says it plainly: latency, tokens, cache hits and track go to "structured logging plus an **in-memory** metrics sink for dev and tests; a real metrics exporter (feeding the cost dashboard) replaces the sink later." Nothing leaves the process; a restart discards everything | Export the same events to any hosted metrics backend |
| 9.8 | LLM cost and quality are observable | product-specific | NOT MET | `docs/06-TOOLING/01-api-keys-and-env.md:16` names Langfuse as recommended-optional; `git grep -i langfuse` finds no integration. `budget.py` contains no alert, notify or threshold logic (`grep -n 'alert\|notify\|threshold'` → nothing) | Provider spend alerts in each console today; Langfuse when there is time |
| 9.9 | Logs are retained long enough to investigate | forensics; and `docs/legal/privacy-policy.md:145` promises "[90 days]" for security and access logs | NOT VERIFIED | Gateway logs go to stdout and are held by Railway at whatever its plan retains; nothing in the repo sets or records a retention period. Vercel likewise | Read Railway's and Vercel's actual log retention, then either make the privacy policy's 90 days true or change the number |
| 9.10 | Alert routes are tested | SRE | **NOT MET — corrected 2026-09-04 after `_challenge.md` C14.** "The control does not exist, therefore testing it does not apply" is NOT MET, not N/A; N/A is for a control that does not apply to this product | There is nothing to test because there is no monitor — see §9.3, §9.4 | Fix §9.3 first, then test the route once |

---

## 10. Runbooks and incident response

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 10.1 | A deployment runbook exists | operations | MET | `DEPLOY.md`, 400 lines: env contract, both hosts, migrations, the domain swap as a receipt of what the first one touched, and a smoke checklist. It is better than most | — |
| 10.2 | An incident runbook exists — what to do at 2am | operations; SOC 2 CC7.3 (control, not certification) | NOT MET | `git grep -ilE 'runbook\|incident\|postmortem\|on.call' -- '*.md'` returns five files; every hit is either `DEPLOY.md` using "runbook" to mean the deploy steps, or `docs/legal/*` describing legal obligations *after* an incident. **Nothing describes how to diagnose or restore a broken service.** There is no first-thing-to-check list, no log location, no restore step | One page: how to reach each dashboard, where the logs are, how to roll the web back, how to redeploy the gateway, how to tell whether the fault is Vercel, Railway or Supabase |
| 10.3 | A named person is responsible when it breaks | operations | **NOT MET — corrected 2026-09-04 after `_challenge.md` C15** (a dual status is not one of the five this register's own key allows, and it let the row sit in the N/A column while the prose said NOT MET) | A one-person team cannot have an on-call rotation, so the rotation is genuinely N/A. What is not N/A is that the one person has no alert (§9.4) and no written procedure (§10.2), so responsibility exists without any mechanism behind it | Fix §9.3 and §10.2; the rotation can wait for a second person |
| 10.4 | A breach-notification runbook exists | GDPR Art. 33 (72 h); India DPDP Act §8(6) | NOT MET | `docs/legal/README.md:89` is an unticked box: "Confirm breach notification timelines and the internal runbook that meets them." The timeline is a legal deadline measured in hours; there is no procedure to meet it | Write it — who is told, in what order, within what clock, with the regulator's form to hand |
| 10.5 | A dependency- or key-compromise response exists | SSDF RV.3 | NOT MET | No procedure for "a package we depend on was backdoored" or "a provider key leaked". §2.11 shows what happens instead: the exposure is noted in a report, the rotation becomes a to-do, and the to-do stays open for two months | The rotation procedure from §2.12 is most of this |
| 10.6 | A backup restore has been rehearsed | continuity | NOT MET | Nothing in the repo or docs records a restore ever being attempted; §8.9 shows backup configuration itself is unverified | Restore one backup into a scratch project once, and write down how long it took |
| 10.7 | Users can see whether the service is up | user-facing operations | NOT MET | No status page and no in-app degraded-service state referenced in the deploy or ops docs | A static status page is cheap; more important is that the app says something honest when the gateway is unreachable |
| 10.8 | There is a route for a family to report a problem | direct-to-family duty of care | PARTIAL | `support@heywobo.com` is the single published address (commit `9f15d09`, "one mailbox for everything"). Whether it is monitored, and what response time it carries, is written nowhere | State a response window on the contact page, and confirm the mailbox actually delivers |
| 10.9 | Post-deploy verification is recorded | change management | NOT MET | `DEPLOY.md:362-400`'s checkboxes are a template, not a log. No record exists of any deploy having been verified | Copy the checklist into a dated file per deploy, or automate the four `curl`s (§6.8) |

---

## 11. Items considered and found not to apply

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| 11.1 | Multi-region / multi-AZ redundancy | availability engineering | N/A | One replica is pinned deliberately because the rate limiter and voice-token store are in-process (`railway.json:12`, `DEPLOY.md:288-290`). A direct-to-family learning app can be down for minutes; the honest constraint is written down, which is the point | — |
| 11.2 | Blue/green or canary deploys | release engineering | N/A | Vercel's atomic aliasing already gives an instant swap between two immutable builds, which is the same guarantee at this scale. The gap is not the strategy, it is that no rollback is written down (§6.3) | — |
| 11.3 | An artifact registry with retention and scanning | supply chain | N/A | Railway builds the image from source and holds it; there is no separately published container. Revisit if the image is ever pushed to a public registry | — |
| 11.4 | Vendor/subprocessor security review | ISO 27001 A.5.19 | N/A here | Vercel, Railway, Supabase, Anthropic, OpenAI, Google and Resend are all subprocessors, but they are assessed in the privacy register (`docs/conformance/privacy-and-children.md`), not this one | — |
| 11.5 | Separate build and deploy identities | least privilege | N/A | There is one human and no service accounts to separate. Becomes real the day §6.2 is automated | — |
| 11.6 | Air-gapped or offline build capability | high-assurance | N/A | Not proportionate to a consumer web product | — |

---

## What this register could not check, and what would check it

| Question | Why not | What settles it |
|---|---|---|
| Have the chat-exposed provider keys actually been rotated? | Rotation state lives in five provider consoles; verifying by calling the APIs would mean sending the owner's credentials from an audit session | Owner reads the key creation dates in the Anthropic, OpenAI, Google AI, Resend and Supabase consoles |
| Is any Railway project token still live? | `railway status` → `Unauthorized`; this machine holds no Railway session | `railway login`, then Account → Tokens and Project → Settings → Tokens |
| Can the gateway be rolled back, and how fast? | Same missing session | `railway login`, then service → Deployments → Redeploy a previous build, timed |
| Does Railway alert the owner on crash or failed deploy? | Same missing session | Railway → Project → Settings → Notifications |
| Are Supabase backups configured, and can one be restored? | Supabase MCP server not connected this session; `supabase` CLI not installed on this machine | Supabase → Database → Backups, then one rehearsed restore into a scratch project |
| Is the repository's default workflow token read-only? | `gh api .../actions/permissions/workflow` needs `admin:repo_hook`; this token has `gist, read:org, repo, workflow` | Repo Settings → Actions → General → Workflow permissions |
| Are Vercel preview deployments publicly reachable? | Deployment protection is not exposed by `vercel project inspect` | Vercel → Project → Settings → Deployment Protection |
| Which exact branch and commit is the Vercel production branch? | The CLI prints aliases (`wobo-git-the-life-…`, so the integration is wired to `the-life`) but not the project's production-branch setting | Vercel → Project → Settings → Git → Production Branch |
| How long are gateway and web logs retained? | Platform-plan dependent, not in the repo — and `docs/legal/privacy-policy.md:145` already promises 90 days | Railway and Vercel plan/log settings, then reconcile the privacy policy |
| Do the 17 JS advisories reach a shipped artifact? | All five packages are build-time (`vite`, `vite-plugin-pwa`, `@vitejs/plugin-react`), which strongly suggests no — but "suggests" is not evidence | Build `apps/web-pwa` and grep `dist/` for the vulnerable module code, or run `bun audit --production` once the tree is green |
