# Operations

**What this is.** What to watch, what each alert means, and what to do about it when you are
woken up. Written on 2026-09-04, when the conformance register found that nothing in this
product told anyone when it broke and nothing anywhere capped what it could spend.

**What it is not.** It is not an on-call rota, because there is one person. It is not a status
page, because there is not one. It does not describe a monitoring service, because none is
bought. Everything below is either code that exists in this repository today or a step **you**
have to take yourself, and the two are kept apart on purpose.

---

## 0. The three things to do first

In this order. The first two take about ten minutes between them and they are worth more than
everything else on this page.

1. **Set a hard billing limit on every provider account.** Anthropic, OpenAI and Google each
   let you cap a month's spend in their own console. The gateway's ceiling (§2) is a soft one:
   it lives in the gateway's memory and a restart forgets it. The provider's own cap is the only
   ceiling that cannot be restarted away. Set it to a number you would be unhappy but not ruined
   to pay.
2. **Point a free uptime monitor at the service** (§5). Ten minutes, no card, and it is the only
   thing that will tell you the site is down before a family does.
3. **Set `ALERT_WEBHOOK_URL`** on the Railway service (§4) so the gateway can reach your phone.

---

## 1. What is actually running

| Piece | Where | How you look at it |
|---|---|---|
| Gateway (FastAPI) | Railway, one replica | `railway logs`, and `GET /healthz` |
| Web (Vite PWA) | Vercel | the Vercel dashboard |
| Database and auth | Supabase | the Supabase dashboard |
| Models | Anthropic, OpenAI, Google | each provider's own console |

`railway.json` pins `numReplicas: 1`, restarts `ON_FAILURE` up to ten times, and health-checks
`/healthz` with a 120 second timeout. **The one replica is load-bearing.** Every limiter in this
service (the rate limiter, the free-tier meter, the public Ask allowance, and the spend ceiling
in §2) is an in-process dictionary. Two replicas means two of every limit. If you ever raise
`numReplicas`, move those counters to Redis first; `services/gateway/src/wobo_gateway/spend.py`
names the three functions that would have to change.

---

## 2. The money ceiling

`services/gateway/src/wobo_gateway/spend.py`. Every model call's dollar cost is added to a daily
accumulator, and calls are refused once the day is gone.

**It sheds load in three lanes, in this order.** A stranger is not allowed to spend a paying
learner's headroom.

| Lane | Who | Answered on a cheaper model from | Refused from |
|---|---|---|---|
| `stranger` | anonymous, or no account at all: the public Ask box, the cron jobs | 50 % | 90 % |
| `member` | a signed-in learner on the free plan | 80 % | 100 % |
| `paid` | a signed-in learner who pays | 100 % | 125 % |

Past a lane's first line the caller is still answered, on the tier one rung down the routing
ladder. Past the second they get Wobo's own honest line ("I have done as much thinking as I can
manage today. I will be ready again tomorrow.") and no charge against their own daily allowance.
A cached answer costs nothing and is served whatever the day looks like.

**Dials** (all environment variables, all with working defaults):

| Variable | Default | What it does |
|---|---|---|
| `DAILY_SPEND_CEILING_USD` | `25` | the day's ceiling. `0` or less disables the ceiling entirely |
| `SPEND_DEGRADE_STRANGER` / `SPEND_REFUSE_STRANGER` | `0.50` / `0.90` | the stranger lane's two lines |
| `SPEND_DEGRADE_MEMBER` / `SPEND_REFUSE_MEMBER` | `0.80` / `1.00` | the free member lane |
| `SPEND_DEGRADE_PAID` / `SPEND_REFUSE_PAID` | `1.00` / `1.25` | the paying lane |
| `SPEND_WARN_FRACTIONS` | `0.5,0.8,1.0` | where an alert is raised |

**Pick the number deliberately.** The default is 25 USD a day, which is a guess chosen to be
safe rather than right, and it starts refusing the moment real traffic passes it. Size it from
what the product actually costs: a conversational turn is budgeted at up to 0.05 USD and a whole
generated lesson at up to 0.20 USD (`registry.py`), and the free plan allows 40 turns and 8
generations per learner per day. So a day of heavy use by one free learner is under 4 USD in the
worst case. Multiply by the number of learners you want to be able to serve on your worst day,
then watch the `gateway.spend` line for a week and set it from what you see. **The alerts at
50 % and 80 % arrive before anything is shed**, so a ceiling set too low announces itself long
before it refuses anybody.

**Two limits of this ceiling, stated plainly.** A restart resets the day's accumulator to zero,
so the worst case is the ceiling multiplied by the number of restarts that day. And it counts
only what `record_cost` can price: a model litellm has no price table for is counted as zero.
Both are why §0.1 exists.

**Seeing the money without a dashboard.** Every priced call writes one line:

```bash
railway logs | grep '"msg": "gateway.spend"' | tail -1
```

which carries `spent_usd`, `ceiling_usd`, `fraction` and `calls` for the current UTC day.

---

## 3. The alarm

`services/gateway/src/wobo_gateway/alerts.py`. Six events, one JSON log line each, and a webhook
when one is configured.

```bash
railway logs | grep 'ALERT '        # by eye
railway logs | grep '"alert":'      # machine-readable
```

| Event | Severity | What it means | What to do |
|---|---|---|---|
| `startup` | info | the gateway booted | nothing, unless you see many. Ten inside five minutes is the restart policy giving up: read the log above the first one, that is the real fault |
| `server_error` | critical | a request answered 5xx, or a route raised | read the `path` and `error` fields, then the request log line beside it. A single one is usually a provider hiccup; a run of them with the same `path` is a bug |
| `safety_gate` | critical when `category` is `crisis`, else warn | the child-safety screen stopped something on the way in | **read this one.** A crisis category is a child in trouble. The alert never carries their words, by design; if you need to act, the product's own answer already gave them Childline (1098) and Tele-MANAS (14416) |
| `spend_threshold` | warn, critical at 100 % | the day's spend crossed a line (§2) | at 50 % nothing. At 80 % look at whether it is real traffic. At 100 % the free lanes are already shut; decide whether to raise `DAILY_SPEND_CEILING_USD` or leave it |
| `auth_failure_burst` | warn | more refused tokens in one minute than `ALERT_AUTH_FAILURE_BURST` (default 25) | usually an expired session storm after a deploy. If it persists across minutes with one `ip_hash`, somebody is trying keys; the rate limiter is already holding them |
| `provider_outage` | warn | one model call refused or timed out | one is weather. If `/healthz` also says `providers: fail`, the chain is genuinely down: check the provider's status page and whether the account has credit |

**Rules the alarm follows**, so you can trust what you see: the log line is written every time,
and the *page* is rate-limited to one per event per `ALERT_COOLDOWN_SECONDS` (default 300) so a
thousand errors is one page. A suppressed page still logs, with `"suppressed": true`. Nothing an
alert carries includes a learner's words, a token, or a key: only categories, paths, exception
type names and a salted `ip_hash`.

---

## 4. Wiring the webhook (yours to do, two minutes)

Set one Railway variable and restart. Unset, the alarm is a logger and nothing else.

```bash
railway variables --set ALERT_WEBHOOK_URL='<your webhook url>'
```

Any URL that accepts a JSON POST works. The body carries `text` (which Slack reads), `content`
(which Discord reads) and the structured `fields`, so one URL fits all three of these:

* **Slack** — Slack app → Incoming Webhooks → Add New Webhook to Workspace → copy the URL.
* **Discord** — channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy URL.
* **ntfy.sh** (a phone notification with no account at all) — pick an unguessable topic name and
  use `https://ntfy.sh/<that-topic>`, then subscribe to the same topic in the ntfy app.

You will know it worked because the next deploy sends you a `startup` alert.

---

## 5. The uptime monitor (yours to do, ten minutes)

Nothing outside this platform watches the service. Railway restarting a container is not
monitoring: it is what happens instead of telling you. This is the single cheapest thing on this
page and it multiplies the value of everything else.

Pick any free checker (UptimeRobot, Better Stack, Hetrix, healthchecks.io — the choice does not
matter) and create **two** monitors:

| Monitor | URL | Type | Interval | Alert when |
|---|---|---|---|---|
| API | `https://api.heywobo.com/healthz` | HTTP(S), expect `200` | 5 minutes | 2 consecutive failures |
| Site | `https://heywobo.com` | HTTP(S), expect `200` | 5 minutes | 2 consecutive failures |

Send the alerts to your phone (every one of those services can do SMS, push or email). Two
consecutive failures rather than one keeps a single slow response from waking you.

If the checker supports a keyword: on the API monitor, alert when the body does **not** contain
`"status": "ok"`. That catches a degraded gateway, which answers `200` on purpose (§6).

---

## 6. What `/healthz` means

`services/gateway/src/wobo_gateway/health.py`. Four checks, all of them dictionary or environment
reads, and no network call at all, so it is cheap enough to poll every minute.

```json
{"status": "ok", "mode": "live", "version": "abc1234",
 "checks": {"config": {...}, "auth": {...}, "spend": {...}, "providers": {...}}}
```

| `status` | HTTP | Meaning |
|---|---|---|
| `ok` | 200 | everything the gateway can see is fine |
| `degraded` | 200 | it still answers, but something is wrong that you should read. **Deliberately not a failure code**: a degraded gateway that Railway keeps restarting is worse than a degraded gateway |
| `unhealthy` | 503 | a request arriving now would not be served. Railway will restart it; you should look |

| Check | `fail` means | `degraded` means |
|---|---|---|
| `config` | `ENV`/`LLM_MODE` are nonsense, or in live mode no provider key at all | one provider key is missing, so a fallback chain is shorter than designed. It reports a COUNT (`providers_configured` of `providers_expected`), never a vendor name: the endpoint is public and the white-label law forbids naming what is underneath. Which key is missing is in the boot log |
| `auth` | in prod, no way to verify a learner token: every `/v1` route would answer 401 | — |
| `spend` | the day's ceiling is refusing every caller including paying ones | the ceiling is shedding load (§2) |
| `providers` | `PROVIDER_OUTAGE_STREAK` (default 5) live model calls failed in a row | two or more failed inside the window (default 120 s) |

`version` is `GIT_SHA` or `RAILWAY_GIT_COMMIT_SHA`, and honestly says `unknown` when neither is
set. Setting one is worth doing: "is this the code I deployed?" is the first question you will ask
under pressure.

**The public probe carries no money.** `/healthz` is unauthenticated, so the `spend` check that
reaches it is the status word and nothing else. `spent_usd`, `ceiling_usd`, `fraction` and `calls`
used to be in that body, which published the day's model spend and how close it was to shedding
load to anybody with a curl — the exact figures the operator console guards behind a register, a
second factor and an audit row per look. They are still all there, on `GET /v1/admin/health`, which
serves the same snapshot through the console door and writes down that somebody read it.

---

## 7. When you are woken up

**Work down this list. Stop at the first thing that explains it.**

1. **`curl -s https://api.heywobo.com/healthz | jq`.** If it answers, read `checks`; the table in
   §6 says which one is lying down. If it does not answer at all, the container is down or
   restarting: `railway logs` and look for the last `startup` alert and whatever is above it.
2. **Is it money?** `checks.spend.fraction` at or past 1.0 means the ceiling is doing its job and
   learners are being refused. That is a decision, not a fault: raise `DAILY_SPEND_CEILING_USD`
   if the spend is real traffic, and leave it if it is not.
3. **Is it a provider?** `checks.providers.status` of `fail`, or a run of `provider_outage`
   alerts. Check the provider's status page, then check the account has credit. Every text chain
   ends at Gemini, so all three providers have to be unhappy for a learner to get nothing.
4. **Is it us?** A run of `server_error` on one `path` is a bug in that route. The request log
   line carries `path`, `status`, `duration_ms` and a salted `ip_hash`.
5. **Is it the front door?** The site is on Vercel and the API is on Railway, and they fail
   independently. If `heywobo.com` is down but `/healthz` is fine, it is Vercel.
6. **Nothing looks wrong but a person says it is.** Ask for the exact time and the page. The
   request log is one JSON line per request and `duration_ms` is on every one of them.

**When to do nothing.** A single `provider_outage`. A single `server_error`. An
`auth_failure_burst` right after a deploy. A `spend_threshold` at 50 %. All of these are the
system telling you it is working.

---

## 8. What is still missing, honestly

So that nobody reads this page and believes more exists than does.

* **No error reporter.** No Sentry, no stack-trace aggregation. `server_error` alerts carry an
  exception type and a path, not a traceback; the traceback is in `railway logs`.
* **No status page**, and nothing that tells a learner's family the service is down.
* **No on call.** One person, one phone.
* **No rehearsed restore.** Supabase takes backups on its own schedule; nobody has ever restored
  one. Until someone has, treat the backups as untested.
* **No log retention beyond the platform's.** Railway keeps what Railway keeps. Nothing archives
  the `gateway.spend` lines, so the ledger is only as long as the log drain.
* **The spend ceiling is soft** (§2), which is why §0.1 asks for a hard one at the provider.
* **EVERY MIGRATION IN THE REPOSITORY IS APPLIED, and the page that said otherwise was wrong
  twice.** Checked against the live project with `list_migrations` on 2026-09-05 after applying:
  the ledger runs `0001`, `0006`–`0018`, `0019_parent_accounts` and `0020_wobo_mind`. (`0002`–
  `0005` predate the ledger: their tables exist and are in use, and they are not re-runnable from
  here. `0016` is deliberately empty and records a skipped number.)

  | Applied | When | By |
  |---|---|---|
  | `0013`–`0018` | 2026-09-05, commit `1d0614f` | the migration wave |
  | `0019_parent_accounts` | 2026-09-05 | this wave, from the file, verbatim |
  | `0020_wobo_mind` | 2026-09-05 | this wave, from the file, verbatim |

  **Applied since, all three from the file, verbatim, with `list_migrations` open (2026-09-05 and 2026-09-07):**
  | Applied | When | By |
  |---|---|---|
  | `0021_doubts` (learner.doubts + the private doubt-photos bucket) | 2026-09-05 | the orchestrator, after a read |
  | `0022_curriculum_observer` (four tables, two views, the consensus review kind) | 2026-09-05 | the orchestrator, after a read |
  | `0023_razorpay_billing` (period + provider ids on subscriptions; ops.billing_events, ops.billing_config) | 2026-09-07 | the orchestrator, after a read |
  The syllabus seed was published the same day (268 frameworks, 4 versions, 1493 nodes, 1493 provenance, verified
  by query, idempotent on a second run) and the service-role key is on the Railway service. Payments stay off
  until the three `RAZORPAY_*` variables are set; `/healthz` says `payments: off` and is degraded for exactly that.
* **No branch protection on `main`** as of 2026-09-08 (`gh api .../protection` answers 404). CI runs typecheck,
  biome, the unit suites, the build and the three brand gates on every push, but nothing requires them to pass
  before a merge.
* **No right-click or download guard on learner content** until 2026-09-08 (`apps/web-pwa/src/ui/guard.ts`);
  and a screen recording cannot be prevented on the web by anything, which the product does not pretend otherwise.
* **The parent account has no screen.** Eleven gateway routes exist (`parent_api.py`: sign-up, children, switch,
  ask, mind, offers); the client's `ParentView.tsx` is the learner's own read-only preview and says so in its
  header. Building the screen is the next wave.

## 9. The curriculum registry: the seed, the worker, and the re-check

Three things, written 2026-09-05, when the owner asked whether the syllabus was accurate and the
honest answer was that production held no syllabus at all: `curriculum.frameworks`, `versions`
and `nodes` had zero rows, the seed had never been loaded, and the discovery worker was scheduled
by nobody. What each one costs is stated plainly, because two of them spend money.

### 9.1 Publishing the seed (you do this once, and again whenever the seed changes)

`content/curriculum` holds 268 frameworks and 121 stored syllabus files. Fifty of those files
carry chapters (CBSE classes 6 to 12, ICSE, ISC and NIOS); the other 71 are honest negative
results, a blocker code and a note saying the board publishes no document we could read for
that class, and they mint nothing. The publish command reads the seed through the same loader
the gateway uses and writes it in dependency order with `on conflict do nothing` on every row,
so running it twice writes nothing the second time.

```bash
cd services/gateway
uv run python -m wobo_gateway.curriculum.publish --dry-run     # counts, writes nothing
uv run python -m wobo_gateway.curriculum.publish --emit-sql    # harness/reports/publish-seed.sql
uv run python -m wobo_gateway.curriculum.publish               # through the store, needs the service role
```

The SQL file is the way to production: paste it into the Supabase SQL editor (it needs no key
and this command never reads one). It is one transaction, 1.6 MB, and its header states the
rows it carries. After applying, run the query the header repeats:

```sql
select (select count(*) from curriculum.frameworks) as frameworks,
       (select count(*) from curriculum.versions)   as versions,
       (select count(*) from curriculum.nodes)      as nodes,
       (select count(*) from curriculum.provenance) as provenance;
```

Expect `268, 4, 1493, 1493` on an empty registry (more if discovery has run since). Every id is
the uuid5 of its natural key, the same one the in-memory store mints and a learner's pin already
names, so the file can be re-applied after a seed change and only the new rows land. A version
that is already in the registry is never rewritten: 0008 freezes a published version, and a
correction is a new version with `supersedes`.

Every seeded syllabus is `provisional`: extracted from the board's own document with page-level
source refs, never yet re-read against it. That is what the re-check below is for.

### 9.2 The discovery worker (one variable, and what it costs)

```bash
railway variables --set WOBO_DISCOVERY_WORKER=1     # then redeploy
```

Off, which is the default, a learner who opens a class and subject we do not hold is told so in
one line with the own-syllabus door open, and the row is recorded for the day the worker is on.
On, the gateway starts one thread that every 30 seconds (`WOBO_DISCOVERY_INTERVAL_S`) does four
things in order: re-queues jobs a dead process left open, runs up to three queued discoveries
(claimed with one conditional write, so a second replica cannot run the same job), re-checks one
stored subject on the freshness calendar, and runs the syllabus observer's pass. The line a
learner polls (`curriculum.status`) is the stage the run is genuinely at.

**What it costs.** One discovery is a web search on the provider's own search tool, one
extraction on the generate tier and one re-reading on the verify tier: budget it at one
generated lesson, 0.20 USD at most. Every discovery and every re-check is charged as a
generation to the worker's own meter subject, which has the free plan's allowance, so the
worker spends at most `FREE_DAILY_GENERATIONS` (default 8) generations a day, about 1.60 USD
worst case, and then leaves the rest queued with a line that says it will look again tomorrow.
It also stops the moment the spend ceiling (§2) is refusing the stranger lane, so it can never
spend a paying learner's headroom. The one replica in `railway.json` is still load-bearing: the
claim is safe across replicas, the meters are not.

### 9.3 First selection verifies from the web (`WOBO_RECHECK`)

The first time any learner opens a provisional (board, class, subject), the stored reading is
checked against the board's document before its chapters are shown: the document is fetched and
its hash compared, and if unchanged the reading is checked in code and by the second reader.
The learner reads "Checking this against the board's document now" while it runs and the
next learner is served what it found: "Official CBSE 2026-27, verified", or the provisional
label with one plain reason (the document could not be reached; what we read did not match, so
a person will look at it in the review queue; the day's checking allowance is spent), with the
own-syllabus door open beside it. A document that changed becomes a new version with
`supersedes`, and learners on the old one are offered the diff.

It is **on whenever `LLM_MODE=live`** and off in mock mode, because a mock second reader
would agree with anything; `WOBO_RECHECK=0` turns it off, `WOBO_RECHECK=1` forces it on. It
costs one fetch and one verify-tier reading per subject, once, then monthly: budget 0.20 USD a
check, at most 8 a day on its own meter subject, under the same spend ceiling. With the worker
on, the same check runs one subject a tick in the background, so most first selections find
the reading already checked and wait for nothing.

Two limits, stated: the registry stores one source document per version, so the four two-part
NCERT syllabi (CBSE classes 7 and 8, Mathematics and Social Science) can only be checked
against their first part and will land in the review queue saying the second part "cites
another document"; and a slow board host (ncert.nic.in took over 30 seconds from here) reads
as unreachable and is retried after six hours.

## 10. Where the code is

| Concern | File |
|---|---|
| The money ceiling and the lanes | `services/gateway/src/wobo_gateway/spend.py` |
| The alarm and the webhook sink | `services/gateway/src/wobo_gateway/alerts.py` |
| What `/healthz` knows | `services/gateway/src/wobo_gateway/health.py` |
| The routing table, the catalogue of ids and prices, the env overrides | `services/gateway/src/wobo_gateway/routing.py` |
| The chain walk: one call per model, the credit skip, the shared deadline | `services/gateway/src/wobo_gateway/model_call.py` |
| Per-provider state: last success, last failure, out of credit, who carries each tier | `services/gateway/src/wobo_gateway/health.py` |
| Where the ceiling is enforced | `services/gateway/src/wobo_gateway/app.py` (`Gateway.invoke`, `stream_board_turn`) |
| Where a call's cost is priced | `services/gateway/src/wobo_gateway/telemetry.py` (`record_cost`) |
| The per-learner daily allowance | `services/gateway/src/wobo_gateway/budget.py` |
| Publishing the seed, and the SQL it emits | `services/gateway/src/wobo_gateway/curriculum/publish.py` |
| The discovery worker and its switch | `services/gateway/src/wobo_gateway/curriculum/discovery/worker.py` |
| A read syllabus becoming registry rows | `services/gateway/src/wobo_gateway/curriculum/discovery/persist.py` |
| The re-check on first selection and on the calendar | `services/gateway/src/wobo_gateway/curriculum/recheck.py` |
| Deploy steps and rollback | `DEPLOY.md` |

Tests: `services/gateway/tests/test_spend.py`, `test_alerts.py`, `test_health.py`,
`test_router_fallbacks.py`, `test_model_call.py`,
`test_curriculum_publish.py`, `test_discovery_worker.py`, `test_curriculum_recheck.py`.
Run them with `cd services/gateway && uv run pytest -q`.

---

## 11. The router: who answers, what it costs, and what happens when a provider is out

Written 2026-09-05, the day every Claude call was refused with "credit balance is too low" and the
fallback carried the product. The owner's word that day: "use the openai and gemini keys if
anthropic isn't working, we should have fallbacks everywhere"; "use openai's terra luna sol; they
are pretty good for generations, and gemini is good for audio and cheaper".

### 11.1 The table

Every text tier goes to OpenAI first, Anthropic second (the cross-provider second opinion, back in
play the day the credit is topped up) and Gemini Flash last. Voice and imagery stay on Gemini with
an OpenAI rung behind them. `services/gateway/src/wobo_gateway/routing.py`, `DEFAULT_TABLE`.

| Tier | What rides on it | First | Second | Last |
|---|---|---|---|---|
| `tiny` | openers, digests, recall, the public Ask box, the curriculum registry | `openai/gpt-5.6-luna` | `anthropic/claude-haiku-4-5` | `gemini/gemini-2.5-flash` |
| `turn` | Wobo's turns, tutor turns, parent turns, grading one attempt | `openai/gpt-5.6-terra` | `anthropic/claude-sonnet-5` | `gemini/gemini-2.5-flash` |
| `generate` | board plans, lessons, diagrams, storyboards, courses | `openai/gpt-5.6-luna` | `anthropic/claude-haiku-4-5` | `gemini/gemini-2.5-flash` |
| `reason` | the hard list: `verify.math`, a grading escalation, a rebuild after a judge rejection | `openai/gpt-5.6-sol` | `anthropic/claude-opus-5` | `gemini/gemini-2.5-flash` |
| `verify` | the judge of anything generated | `openai/gpt-5.6-sol` | `anthropic/claude-opus-5` | `gemini/gemini-2.5-flash` |
| `voice` | Wobo speaking | `gemini/gemini-2.5-flash-preview-tts` | `openai/gpt-4o-mini-tts` | the device's own voice |
| `image` | raster imagery SVG cannot express | `gemini/gemini-2.5-flash-image` | `openai/gpt-image-2` | |
| `vision` | reading a photographed page (`doubt.read`) | `gemini/gemini-2.5-flash` | `openai/gpt-5.6-terra` | |
| `safety` | the child-safety classifier | `openai/gpt-5.6-luna` | `gemini/gemini-2.5-flash` | the rule layer |

Every text call, the vision read and the safety screen go through one funnel,
`model_call.complete`; a test (`tests/test_model_seams.py`) fails the build on any direct litellm
call outside it. The voice and image rows are raw HTTPS seams (`plexus/media.py`,
`plexus/image.py`) that read their OpenAI rung from this table.

The Google key is `GOOGLE_AI_API_KEY` everywhere in this product. litellm's Gemini provider reads
`GEMINI_API_KEY`, so the funnel hands the product's key to each `gemini/` rung per call; setting
only the product's name is enough for every row above.

One model is on the product's key and on no chain: the live microphone
(`gemini/gemini-2.5-flash-native-audio-latest`, `voice.VOICE_MODEL`, both websockets). Gemini
Live has no OpenAI rung; when it cannot open, the client's own fallback is the device's voice. It
is in `routing.CATALOGUE` and priced in §11.2, and since 2026-09-07 every socket writes one ledger
row and one spend line for the seconds that actually crossed it (`voice.LiveMeter`, unit
`live_second` for the relay, `spoken_second` for the read-aloud socket). Before that the ceiling
was asked once when the session token was minted and never charged for the minutes that
followed, on the dearest per-minute seam in the product.

One thing to know about the judge. With Anthropic second on every tier, the verify tier's primary
is Sol, which is the same account as the Terra that generated. The second opinion is still the
other mind whenever Anthropic is answering: the chain crosses, and a judge that cannot be reached
on one account is reached on the next. When only one account is answering, the judge is the same
account's flagship judging its middle model, which is a weaker check than two vendors and a
stronger one than none. That is the honest shape of "fallbacks everywhere".

### 11.2 The prices, from the vendors' own pages

Read on 2026-09-05 and read again on 2026-09-07; no number had moved. USD per million tokens,
standard short-context rates. The router carries the
same numbers in `routing.CATALOGUE`, and `test_router_fallbacks.py` holds litellm's price table
(the one the usage ledger prices every call from) to them, so if a vendor moves a price the test
is what breaks first.

| Model | Input | Cached input | Output | Page |
|---|---|---|---|---|
| `openai/gpt-5.6-sol` | 4.00 | 0.40 | 20.00 | [OpenAI pricing](https://developers.openai.com/api/docs/pricing) |
| `openai/gpt-5.6-terra` | 2.00 | 0.20 | 12.00 | same |
| `openai/gpt-5.6-luna` | 0.20 | 0.02 | 1.20 | same |
| `anthropic/claude-opus-5` | 5.00 | 0.50 (cache hit) | 25.00 | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| `anthropic/claude-sonnet-5` | 2.00 | 0.20 (cache hit) | 10.00 | same; the introductory price was made standard |
| `anthropic/claude-haiku-4-5` | 1.00 | 0.10 (cache hit) | 5.00 | same |
| `gemini/gemini-2.5-flash` | 0.30 | | 2.50 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| `gemini/gemini-2.5-flash-preview-tts` | 0.50 (text) | | 10.00 (audio) | same |
| `gemini/gemini-2.5-flash-image` | 0.30 | | 0.039 per image | same |
| `openai/gpt-4o-mini-tts` | 0.60 (text) | | 12.00 (audio) | OpenAI pricing; see the note below |
| `openai/gpt-image-2` | 5.00 (text), 8.00 (image) | | 30.00 (image) | same; per token, not per image |
| `gemini/gemini-3.8-flash` | 0.75 | | 3.75 | Gemini pricing; an override id, on no default chain; doubles on 2027-01-01 (below) |
| `gemini/gemini-3.5-flash-lite` | 0.30 | | 2.50 | same; an override id |
| `gemini/gemini-2.5-flash-native-audio-latest` | 0.50 (text), 3.00 (audio) | | 2.00 (text), 12.00 (audio) | same; the live microphone, per token; audio is 32 tokens a second (the tokens page) |

The OpenAI ids and which is which (Sol "flagship model for complex professional work", Terra
"balances intelligence and cost", Luna "optimized for cost-sensitive workloads") are from the
[OpenAI models page](https://developers.openai.com/api/docs/models), which also names
`gpt-4o-mini-tts` and `gpt-image-2`. OpenAI's long-context rates are double the short-context
input rate and higher on output; no call in this gateway reaches long context.

Two notes from the 2026-09-07 read. First, the voice and image rungs: the OpenAI page prices
them per token, and litellm's table carries a different figure for `gpt-4o-mini-tts` (2.50 in,
10.00 out). Neither number reaches the bill, because the seams that call those models price the
UNIT the learner received (a spoken second, an image) from the price an operator has entered
(`plexus/media.py`, `ledger.configured_price`), and with none entered the row is honestly
unpriced. Second, the Gemini page now lists `gemini-3.8-flash` at 0.75 / 3.75, which is dearer
than 2.5 Flash; 2.5 Flash is still a current, priced model on the page and stays the last rung.
The newer ids are in `routing.CATALOGUE` so a `WOBO_TIER_*_CHAIN` variable may name them (§11.4).

**Three dates the pages carry, read 2026-09-07, none of them past yet.**

| What | When | Where it bites |
|---|---|---|
| `claude-haiku-4-5-20251001` tentative retirement "not sooner than October 15, 2026" | five weeks from the read | the tiny tier's second rung (`anthropic/claude-haiku-4-5`). When it goes, `WOBO_TIER_TINY_CHAIN` names the replacement; `claude-sonnet-4-6` is "not sooner than February 17, 2027" and Sonnet 5 "not sooner than June 30, 2027" (Anthropic deprecations page) |
| Gemini 3.8 Flash goes from 0.75 / 3.75 to 1.50 / 7.50 | 1 January 2027 | only an override that names it; no default chain does |
| litellm's own table carries deprecation dates Google's pages do not show: `gemini/gemini-2.5-flash-image` 2026-10-02, bare `gemini-2.5-flash` 2026-10-20 | this autumn | the image primary and the last rung of every text chain. Google's models page (2026-09-07) lists both as current and shows no date; treat litellm's as the earlier warning and re-read the page in October. The newest image ids on Google's page are `gemini-3.1-flash-image` (0.067 per 1K image), `gemini-3.1-flash-lite-image` and `gemini-3-pro-image` |

And one on the same page: the Gemini models page lists the live microphone's id as
`gemini-2.5-flash-native-audio-preview-12-2025`; `-latest`, the id the product calls, is Google's
alias for it. The alias is kept because it is the id the relay was proved live with on Railway
(the 2026-09-07 voice deploy); the row in the catalogue says so.

### 11.3 What one turn costs

From litellm's price table, the one the ledger prices every row from, on the shapes the policies
allow (`registry.py` sets the output ceilings; the input figures are the assumption, stated):

| Call | Shape | On the first rung | On the second | On the last | Ceiling |
|---|---|---|---|---|---|
| a turn (`wobo.turn`) | 1,500 in, 400 out | Terra **0.0078** | Sonnet 5 0.0070 | Flash 0.0014 | 0.05 |
| a tiny call (`safety.classify`, an opener) | 600 in, 60 out | Luna **0.0002** | Haiku 4.5 0.0009 | Flash 0.0003 | 0.002 |
| a lesson or board plan (`engine.compose`) | 4,000 in, 3,000 out | Terra **0.044** | Opus 5 0.095 | Flash 0.0087 | 0.08 |
| a verify or reason call | 3,000 in, 800 out | Sol **0.028** | Opus 5 0.035 | Flash 0.0029 | 0.10 |

So a turn on the owner's table costs under one paisa's worth of a dollar: about 0.0078 USD, or
roughly 0.65 rupees at 83 to the dollar. Forty turns, the free plan's day, is about 0.31 USD.

**"All the models have been cost optimized so the pricing is the lower models without
compromising major quality, right?"** Yes, with one caveat stated plainly. Tiny is on Luna, the
cheapest text model on any of the three pages. Turn and generate are on Terra, the middle model,
and only the hard list and the judge pay for Sol. Generation goes to the cheapest model that
passes and climbs one rung per judge rejection (`routing.escalate`, logged with its reason), and
the spend ceiling walks the same ladder down (§2). The caveat: per output token Terra costs 12.00
where Sonnet 5 costs 10.00, so a turn on Terra is about ten percent dearer than the same turn on
Sonnet 5. OpenAI first on the turn tier is a choice for availability on a day Anthropic was out,
not the cheapest possible order. If that ten percent matters more than the order, one variable
moves it (§11.4). Gemini Flash is the cheapest text model of all at about 0.0014 a turn, and it is
last on purpose: it is the floor, not the voice of the product.

One more honest line: Opus 5 behind `generate` at 0.095 a lesson is OVER the generate tier's 0.08
ceiling. That is what the second rung costs when the first is out; `record_cost` logs it as
`gateway.cost over ceiling` rather than hiding it, and it is the price of a lesson still arriving.

The per-model figures are the model that ANSWERED. Since 2026-09-07 the `gateway.cost` line, the
`gateway.spend` line and the day's spend fields all carry `model` = who served, with
`model_requested` beside it on the cost line; before that only the ledger row did, and a
fallback's cost on the telemetry stream was attributed to the provider that refused.

### 11.4 Overriding a tier without a deploy

Set a Railway variable and let the service restart. The table above is the default; the variable
wins. An id the router does not know refuses the boot with a line that names the variable and lists
the ids it does know, so a typo is a failed deploy and not a quiet outage on every turn.

```bash
railway variables --set WOBO_TIER_TURN=openai/gpt-5.6-luna                         # move a primary
railway variables --set WOBO_TIER_GENERATE_CHAIN=gemini/gemini-2.5-flash,anthropic/claude-opus-5   # replace a chain
```

`WOBO_TIER_<TIER>` sets the primary (`TINY`, `TURN`, `GENERATE`, `REASON`, `VERIFY`, `VOICE`,
`IMAGE`, `VISION`, `SAFETY`, the nine rows of §11.1); `WOBO_TIER_<TIER>_CHAIN` replaces the
fallbacks, comma-separated, in order. A moved
primary drops out of the default chain rather than appearing twice; a chain that repeats a model
is refused; a chain kept on one account logs a warning, because a fallback on the same account is
not a fallback. The escalation ladder and the spend ceiling's degrade follow the override.

Five more variables, none needed on an ordinary day: `WOBO_CHAIN_PRIMARY_SHARE` (default 0.5, the
share of what is left of a deadline a rung gets when a live rung stands behind it, §11.5),
`WOBO_PROVIDER_WEATHER_STREAK` (3), `WOBO_PROVIDER_HANG_STREAK` (2),
`WOBO_PROVIDER_WEATHER_COOLOFF_S` (60) and `WOBO_PROVIDER_COOLOFF_S` (300).

### 11.5 When a provider runs out of credit, hangs, or falls over

Every model call in the gateway goes through `model_call.complete`, which walks the chain itself,
one model per call, and reads each refusal (litellm's own fallback runner swallowed them; §11 of
`model_call.py` says what that cost). The refusals it recognises as an empty balance or a spent
quota, from the vendors' own error pages: Anthropic's 400 "credit balance is too low", 402
`billing_error` and the 429 at a tier's spend cap; OpenAI's 429 with `insufficient_quota` and the
`credit_balance_exhausted` / `spend_limit_exceeded` / `usage_limit_exceeded` codes; Gemini's 429
`RESOURCE_EXHAUSTED`.

On one of those the provider is **marked out** for `WOBO_PROVIDER_COOLOFF_S` (default 300) and
the chain moves on. Every later call on any tier skips that provider without a network round trip,
which is the difference between well under a second and a timeout per turn while an account is
empty. When the cool-off passes, one call is let through to see; a second refusal marks it out
again, a success clears it. When every provider in a chain is out, the call fails at once with
`ProvidersOut` rather than making three round trips nobody can answer.

**Weather, since 2026-09-07.** A 5xx, a rejected key (the Google key on the build machine was
401 that day), a dead route or a timeout is an ordinary failure: the chain moves on and the
failure is written down. One is weather and marks nobody. Three in a row on one provider, or two
timeouts in a row, mark it out for `WOBO_PROVIDER_WEATHER_COOLOFF_S` (default 60) exactly as a
credit refusal does for 300; one probe is let through when the minute passes, a fourth failure
marks it again at once, and the first success clears the mark and the streak. Before this, a 503
storm cost every turn on every tier the dead primary's round trip for the whole outage.

**The deadline is shared, and the primary gets half.** A rung with a live rung behind it gets
`WOBO_CHAIN_PRIMARY_SHARE` (default 0.5) of what is left of the caller's `timeout`; the last rung
gets the rest; a lone model keeps the whole deadline. So a turn's 60 s is 30 for OpenAI, 15 for
Anthropic, 15 for Gemini, a generation's 180 s is 90 / 45 / 45, and the child-safety screen's
1.5 s is 0.75 / 0.75. Before this the primary had the whole deadline and a timeout stopped the
walk, so a hanging OpenAI was a total outage of every text tier and the safety screen with two
healthy providers idle. A rung that answers 400 to a sampling knob (Claude 4.7 and later, per
Anthropic's deprecations page) is never sent one: the funnel keeps its own list and drops the
knob up front, one round trip instead of two.

**The voice and image seams keep the same marks.** `plexus/media.py` and `plexus/image.py` ask
`health` before each vendor and feed it after, through `model_call.note_failure`: a Google quota
429 on a spoken line is a mark the Gemini rung of every text chain honours, and the other way
round. The Gemini voice gets a 20 s deadline of its own when OpenAI stands behind it
(`media._PRIMARY_TIMEOUT_S`), so a hang costs seconds before the other voice speaks.

**When nobody can answer, the child hears Wobo.** A total provider outage on
`POST /v1/capability/<name>` is a 503 `{"code": "providers_out", "message": ...}` in Wobo's own
line (`model_call.OUTAGE_LINE`), with `Retry-After: 60`; on the board stream it is the same line
over the ordinary stream, the way a spend refusal arrives; the turn is given back to the
learner's meter either way. `POST /v1/voice/tts` gives the call back too when neither voice
spoke. Before 2026-09-07 the first was FastAPI's bare `500 Internal Server Error` (the client's
generic broken page) and the second kept the charge.

What you will see, on the telemetry stream (`railway logs | grep gateway.provider`):

| Line | Level | Meaning | What to do |
|---|---|---|---|
| `gateway.provider.out_of_credit` | warning | `provider` refused for money or quota; `until` is when it is re-probed | open that provider's console and top up or raise the cap. The product is still answering on the next rung |
| `gateway.provider.out` | warning | `provider` was marked out for weather (`kind`): a streak of 5xx, 401, connection faults or hangs; `until` is when it is re-probed | open that provider's status page. Nothing to do on your side unless `reason` is `AuthenticationError`, which is a revoked or wrong key |
| `gateway.provider.skipped` | info | a rung was passed over because its provider is marked out | nothing; this is the skip working |
| `gateway.fallback` | info | `to_model` answered for `from_model`; `error` is the exception type | one is weather. A steady stream with the same `from_model` is that provider down |

And on `GET /v1/admin/health` (behind the register and the second factor; the public `/healthz`
carries only a count under `providers.out_of_credit`):

```json
"providers": {"status": "degraded",
  "reason": "1 provider(s) out of credit or quota; the chain is carrying",
  "by_provider": {"anthropic": {"last_success": null, "last_failure": 1788000000.0,
                                "last_error": "BadRequestError", "out": true, "out_kind": "credit",
                                "out_of_credit": true, "out_until": 1788000300.0,
                                "reason": "BadRequestError"},
                  "openai": {"last_success": 1788000001.0, "last_failure": null, "out": false,
                             "out_kind": null, "out_of_credit": false}},
  "carrying": {"tiny": "openai/gpt-5.6-luna", "turn": "openai/gpt-5.6-terra", ...}}
```

`carrying` is the model answering each tier right now, with the marks applied. One provider out is
`degraded` (the chain is carrying; `out_kind` says whether to top up or to wait). Every provider
on a text tier out is `unhealthy`, 503, because a request arriving now would not be served. The
public `/healthz` carries two counts, `out` and `out_of_credit`, and no name.

**Two limits, stated.** The marks live in one process, like every other counter here (§1): a
restart forgets them, and the first call after a restart pays one round trip to learn the balance
is still empty. And `validate_env` in `app.py` still refuses to boot live without
`ANTHROPIC_API_KEY`; with OpenAI first, the key the product cannot run without is
`OPENAI_API_KEY`, and that check belongs to the app, not the router.

---

## 12. Payments: the provider, the keys, and what "off" means

Written 2026-09-05, when the subscriptions integration landed with NO key on any machine. Nothing
below has been exercised against the provider's live or test account; it has been exercised against
a fake and against the signature vector the provider's own SDK ships with.

**Three variables, all or nothing.** `RAZORPAY_KEY_ID` (public, goes to the browser),
`RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` (never leave the host). With any one missing,
payments are OFF: `POST /v1/billing/checkout` answers 503 `payments_off` in Wobo's voice, the webhook
answers 503 and processes nothing, `/healthz` reports `payments: off` (degraded in prod, ok
elsewhere), and a cancel on a row the provider is charging is refused with the mailbox rather than
written. No key is ever logged; `validate_env` and the plans command report them by presence.

**Switching it on, in order.**
1. Apply `0023_razorpay_billing` (§8).
2. Set the three variables on the gateway host.
3. In the provider dashboard, create a webhook pointed at `GATEWAY_URL/v1/billing/razorpay/webhook`
   with the same secret, subscribed to every `subscription.*` event.
4. Run `uv run python -m wobo_gateway.billing.plans` once, on a machine with the keys and the
   project's service role. It creates the four plans (Pro and Max, monthly and yearly, amounts from
   `docs/PRICING.md` to the paisa) and records their ids in `ops.billing_config`. Running it again
   creates nothing; changing a price in PRICING.md and running it creates the new plan beside the
   old and points the config at the new. `--dry-run` prints the catalogue and touches nothing.
5. Watch `GET /v1/admin/billing` (console.read) for the first checkout and the first webhook.

**What moves the plan, and what does not.** A checkout writes nothing to `learner.subscriptions`.
The row is written when the provider sends `subscription.activated` or `subscription.charged`, with
the period end taken from the provider's `current_end`. `authenticated` (the mandate) flips nothing.
`pending` and `halted` (a card failed, retries exhausted) set `provider_status` only: the plan stays
to the day already paid for, and the learner's plan screen says the payment did not go through.
Nothing here refunds, and there is no refund event mapping on purpose.

**Cancel.** The learner's cancel tells the provider `cancel_at_cycle_end: true` FIRST and writes
`cancelled` only when the provider took it. The provider cannot restart a cancelled subscription
and offers no revert for a cancel scheduled at cycle end, so the resume route answers 409
`cannot_resume` for a provider-backed row and the plan screen does not offer the button.

**Once only.** Every webhook is checked for its signature over the raw body before a byte is
parsed, then its `X-Razorpay-Event-Id` is looked up in `ops.billing_events`; a replay answers 200
`already_processed` and moves nothing. If the ledger cannot be reached the webhook answers 503 so
the provider retries later, rather than applying an event it could not record.

**Not yet done, honestly.** The web checkout (`screens/plans/Checkout.tsx`) does not call the route
yet, and the console's subscriptions desk (`apps/web-pwa/src/admin/desks.ts`) does not read
`GET /v1/admin/billing` yet; both are wired on the gateway side only. `total_count` on a new
subscription is 60 months or 5 years, chosen, not read from a documented maximum.

### 11.6 The owner's rule: cheapest that passes, better only where needed (2026-09-08)

Generated content is judged and cached, so it starts at the CHEAPEST model, `luna`, and climbs one
rung per judge rejection: `luna`, then `terra`, then `sol` (`routing.generation_ladder`,
`routing.escalate(..., current=)`). A live tutor turn cannot be re-judged, so `turn` starts on
`terra`. The judge (`verify`) is `sol` from the first call, because a weak judge passes weak
content: that is the one place the money is spent up front. At luna's prices (0.20 in / 1.20 out
per million) a lesson that passes first time costs about a hundredth of one that needed sol.
The next step (docs/CONTENT-INTERACTION.md) caches the concept once and renders each level from it.

### 11.7 The create tier and who pays (2026-09-08)

`create` = GPT-6 Astra (10.00 / 1.00 cached / 50.00 per M; above 272K input, 2x in and 1.5x out),
Opus 5 behind it, Flash last. Only `engine.create` runs on it: the concept core, the interaction's
design, the film's choreography, once per concept and cached. The platform pays (the creative pool
on the models desk, its own cap); a learner's allowance is only ever charged for what is served to
them. Astra is on no other chain and nothing escalates into it. `WOBO_TIER_CREATE` overrides it.
