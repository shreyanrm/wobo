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

`services/gateway/src/wobo_gateway/alerts.py`. Seven events, one JSON log line each, and a webhook
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
| `pool_threshold` | warn, critical at 100 % | one of the two pools the platform pays for ITSELF crossed a line (`pools.py`): `pool` is `creative` (the work made once and cached for everyone) or `free` (the day's spend on all free learners together) | these are not the learners' money and not the `spend_threshold` ceiling. `creative` at 100 % means today's authoring is done and the cache carries the rest of the day; `free` at 100 % means the goodwill is spent and free learners meet the kind line until midnight. Both dials are on the models desk and apply without a deploy |

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
extraction on the generate tier and one re-reading on the verify tier. **Measured, 2026-09-15,
on three Indian state boards** (§9.2.1): 0.0089 to 0.034 USD a run on the floor rung, the high
end being a 200-page compilation that needed a redraw and two second readings. Budget it at one
generated lesson, 0.20 USD at most, which is comfortable rather than tight. Every discovery and every re-check is charged as a
generation to the worker's own meter subject, which has the free plan's allowance, so the
worker spends at most `FREE_DAILY_GENERATIONS` (default 8) generations a day, about 1.60 USD
worst case, and then leaves the rest queued with a line that says it will look again tomorrow.
It also stops the moment the spend ceiling (§2) is refusing the stranger lane, so it can never
spend a paying learner's headroom. The one replica in `railway.json` is still load-bearing: the
claim is safe across replicas, the meters are not.

### 9.2.1 Turning discovery on for the state boards: the runbook

Written 2026-09-15, after the pipeline was run end to end for the first time. It had been built
in September and never run — `WOBO_DISCOVERY_WORKER` has never been set on Railway — so this
section is what that run learned rather than what the design intended. Follow it in order.

**Why it is worth doing.** 268 boards are named in the registry and four carry a syllabus. 54 of
the named boards are Indian and most Indian school students sit in a state board. Every board
that lands is a shelf that was empty.

**Before you touch Railway.** Set the four dials, from the console or in the SQL editor against
`ops.settings`. They are read live, on the same 30-second interval as the model dials, and every
write leaves a row in `ops.settings_audit`. The values below are the defaults, so a dial you do
not set behaves exactly as written here; set them anyway, so the audit trail says you chose them.

| key | default | what it means |
|---|---|---|
| `discovery.running` | on | **the hard stop.** Write `false` and every discovery everywhere refuses, within thirty seconds, with no deploy and no restart |
| `discovery.board.max_usd` | `0.50` | what one board may cost in one UTC day, across all of its classes and subjects |
| `discovery.daily.max_usd` | `5.00` | what every board together may cost in one UTC day |
| `discovery.refusal.retry_days` | `7` | how long a refusal is remembered before the same question may cost money again |

```sql
insert into ops.settings (key, value, description, note) values
  ('discovery.running', 'true'::jsonb,
   'The hard stop on syllabus discovery. False and every discovery refuses within 30 seconds.',
   'State boards, first switch-on.'),
  ('discovery.board.max_usd', '0.50'::jsonb,
   'What one board may cost in one UTC day, across every class and subject.',
   'About twenty reads of one board.'),
  ('discovery.daily.max_usd', '5.00'::jsonb,
   'What every board together may cost in one UTC day.',
   'The day, all boards together.'),
  ('discovery.refusal.retry_days', '7'::jsonb,
   'How long a refusal is remembered before the same question may cost money again.',
   'A closed door stays shut a week.')
on conflict (key) do update set value = excluded.value, note = excluded.note;
```

`updated_by` is left null on purpose: it is the uuid of whoever turned a dial through a signed-in
surface, and this was turned in the SQL editor. The trigger on the table still writes the
before-and-after into `ops.settings_audit` either way.

**Then the switch.**

```bash
railway variables --set WOBO_DISCOVERY_WORKER=1     # then redeploy
```

`WOBO_DISCOVERY_WORKER` starts the loop; `discovery.running` stops the work. Use the variable
once and the dial thereafter: the dial takes effect in thirty seconds and the variable takes a
deploy.

**The order of boards, by the number of students behind them.** Do not open them all at once.
Take them a few at a time, read the console queue after each, and only go on when the last group
has landed or refused for a reason you understand.

1. Uttar Pradesh (`upmsp`), Maharashtra (`msbshse`), Bihar (`bseb`), West Bengal (`wbbse`,
   `wbchse`)
2. Madhya Pradesh (`mpbse`), Rajasthan (`rbse`), Tamil Nadu (`tn-dge`), Karnataka (`kseab`)
3. Gujarat (`gseb`), Andhra Pradesh (`bseap`, `bieap`), Telangana (`bse-telangana`, `tgbie`),
   Kerala (`kerala-state-board`), Odisha (`bse-odisha`), Punjab (`pseb`), Haryana (`bseh`),
   Assam (`seba`), Jharkhand (`jac`), Chhattisgarh (`cgbse`)

**What to watch, and what each thing means.**

- **The day's money**, in `railway logs`: every discovery writes one `discovery.spent` line with
  what that run cost, what its board has cost today, and what the day has cost against its
  ceiling. `ceiling.state().as_dict()` is the same thing as one object, for a console panel to
  read when one is built — **there is no discovery panel on the console yet, and this section does
  not pretend there is.** A discovery on the floor rung cost between 0.012 and 0.030 USD in the
  first live run, so a normal day of a few dozen reads is well under a dollar. If one board is
  climbing towards its own ceiling, its documents are big or its readings are being redrawn; look
  at it before raising anything.
- **`refused` rows in the console queue.** Every refusal now carries a `detail` — the url, the
  checks that failed, the transport error in words — so a row can be acted on without paying to
  run it again. Three refusals about a board's HOST (`not_fetchable`, `timeout`, `dns`,
  `tls_untrusted`, `http_error`, `robots_disallowed`) rest that board until the next UTC day, so
  the tenth learner who picks it does not pay for the tenth closed door.
- **A board's bill can read high, never low.** What a discovery cost is measured as the movement
  of the platform's own spend ledger across the run, and that ledger is everyone's: a learner's
  turn answered while a discovery is running is counted against the board. So a board may reach
  its ceiling earlier than it truly did and never later, and the guard errs towards refusing.
- **`provisional` is not published truth.** It means the board's own document was found, read,
  and agreed with by a second reader. A person still confirms it before it says "verified". That
  gate does not move.
- **Do not point the verify tier at the model the generate tier uses.** In the default table
  generate is Luna and verify is Sol, which is two minds. A dial that makes them one model turns
  the second reading into the same reading paid for twice. Since 2026-09-15 the code notices: a
  verify tier that resolves to the extractor's own model is not asked, the check is recorded as
  one that could not run, and the reading can reach `provisional` on its structural evidence but
  can never be promoted to `verified`. A disagreement from that same model is still kept, because
  a reading its own author will not stand behind is worth failing on.

**How to stop it.** In this order, cheapest first:

1. `update ops.settings set value = 'false'::jsonb where key = 'discovery.running';` — everything
   stops within thirty seconds. Nothing in flight is published; nothing queued is lost. "Thirty
   seconds" is one worker interval (`WOBO_DISCOVERY_INTERVAL_S`): the dial is read at the top of
   every tick, before the drain, the re-checks, the observer's pass and the prewarm, and again for
   each board before its row is claimed, so nothing is charged a generation on the way past. What
   is queued stays queued and says "I am not looking for syllabuses just now. Your place in the
   queue is kept.", because the stored line for a queued row promises a search that nobody is
   running. **Until 2026-09-15 this was not true of the worker** — it asked `run_discovery` with
   `force=True`, and `force` skipped this guard, so the one runner in production read boards while
   the switch said stop. The tests that hold it are `test_discovery_worker.py`'s hard-stop group.
2. Lower `discovery.daily.max_usd` to `0` for the same effect through the money guard.
3. `railway variables --set WOBO_DISCOVERY_WORKER=0` and redeploy — the loop itself stops, and a
   learner who picks an unheld board is served the shared class-and-subject plan as before.
4. The platform's own ceiling (§2) is above all three and is not discovery's to spend.

**What the first live run found, so you are not surprised by it.**

- **Maharashtra (`msbshse`) works, and is the shape most state boards have.** One 200-page pdf
  holding every subject of Standards IX and X. The Mathematics section is pages 151 to 162, its
  chapters are two papers (Algebra and Geometry) with eleven chapters between them, and the
  document's own text says "Std. X" and never "Class 10". The reading is faithful, including
  `Menstruation` on the Geometry page — **which is the board's own misprint for Mensuration** and
  is exactly the kind of thing a person confirms before it is called verified.
- **Uttar Pradesh (`upmsp`) cannot be read yet, and it is not our fault or theirs exactly.** Their
  class 10 Mathematics pdf has a text layer in a legacy Devanagari font: the page shows
  "इकाई-1 : संख्या पद्धति" and the text layer says `bdkbZ&1 % la[;k i)fr&`. Nothing downstream of
  that can be trusted, so it refuses, and it now refuses **before** a model is paid to read it.
  Reading UP needs a rendering-and-OCR path, or the board's Unicode edition if one exists. It is
  a piece of work, not a setting.
- **Tamil Nadu (`tn-dge`) refuses at the handshake.** `dge.tn.gov.in` serves its TLS certificate
  **without the intermediate**, so a chain cannot be built. A browser and curl hide this by
  fetching the missing certificate from the leaf's AIA extension; Python does not. The refusal is
  now `tls_untrusted` with the error in words rather than "unreachable", and the board rests.
  **Nothing in this pipeline turns verification off**, and it should not be turned off from here
  either: a document read over a connection we cannot trust would be published under a board's
  name. The options are to fetch and cache the missing intermediate deliberately, or to ask Tamil
  Nadu to fix their chain. Both are decisions, and they are yours.

**Running it yourself, offline, before any of this.** The whole pipeline runs by hand against an
in-memory store, touching no database:

```bash
cd services/gateway
DAILY_SPEND_CEILING_USD=3 uv run python -m wobo_gateway.curriculum.discovery.lab \
    --board msbshse --board upmsp --board tn-dge \
    --level "Class 10" --subject Mathematics
```

It reads on Luna and has Gemini Flash read second — the floor of two providers, so a lab run is
cheap and is still two minds. It refuses to start if the two are the same model, and it reads no
dial from production: the guard above runs on the documented defaults there.

Every stage is written to `services/gateway/harness/reports/discovery-<run>/`: the queries, every
candidate, every fetch with its bytes and its hash, both readers' whole replies, every check with
its verdict, what it cost and what would have been published. It reads no dial from production and
writes nothing anywhere else.

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
| What a discovery may spend, the hard stop, and the remembered refusal | `services/gateway/src/wobo_gateway/curriculum/discovery/ceiling.py` |
| Running the whole pipeline by hand, offline, against an in-memory store | `services/gateway/src/wobo_gateway/curriculum/discovery/lab.py` |
| A read syllabus becoming registry rows | `services/gateway/src/wobo_gateway/curriculum/discovery/persist.py` |
| The re-check on first selection and on the calendar | `services/gateway/src/wobo_gateway/curriculum/recheck.py` |
| Deploy steps and rollback | `DEPLOY.md` |

Tests: `services/gateway/tests/test_spend.py`, `test_alerts.py`, `test_health.py`,
`test_router_fallbacks.py`, `test_model_call.py`,
`test_curriculum_publish.py`, `test_discovery_worker.py`, `test_curriculum_recheck.py`,
`test_discovery_ceiling.py`, `test_discovery_runnable.py` (every fault the first live run found,
each with the test that names it).
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
Opus 5 behind it, Flash last. Only `create.core` runs on it: the concept core, the interaction's
design, the film's choreography, once per concept and cached. The platform pays (the creative pool
on the models desk, its own cap); a learner's allowance is only ever charged for what is served to
them. Astra is on no other chain and nothing escalates into it. `WOBO_TIER_CREATE` overrides it.

---

## 13. Break-glass: the owner's seat

Written 2026-09-14, from `docs/CONSOLE-ROLES-AND-BOARD.md` §2: one owner account, which nobody
else can suspend, demote or remove, and "recovery, if the owner ever loses access, is a documented
break-glass with the service key, written down in operations and requiring nobody's cooperation but
the owner's." This is that page. It is the only way the owner's row in `ops.admins` ever moves.

**What exists in code today, and where.** Two layers, and only one of them is applied.

* **The gateway refuses first** (`services/gateway/src/wobo_gateway/admin_auth.py`). Adding a
  second owner from the console answers `one_owner`; suspending the owner answers `not_the_owners`;
  suspending yourself answers `not_yourself`; granting or revoking a capability on the owner's row
  answers `not_the_owners`. Every attempt is written to `ops.admin_audit` as `admin.denied.owner`
  before the refusal. The register panel (`GET /v1/admin/admins`) reports `owner_count`, which is
  the number the two rules below keep at one.
* **The database refuses last** (`infra/supabase/migrations/0029_console_owner_and_capabilities.sql`).
  A partial unique index, `admins_one_active_owner`, allows at most one row with `role = 'owner'`
  and `status = 'active'`. A trigger, `ops.the_owner_is_not_yours_to_take`, refuses any UPDATE that
  demotes, suspends or rebinds the active owner and any DELETE of an owner row, whoever is asking,
  the service key the console runs on included. Its one bypass is a session setting,
  `ops.break_glass`, which must be `on` inside the transaction doing the write. PostgREST cannot
  send `set local`, so no console route can open it: it takes a direct SQL connection and the
  project's service role, which is you and nobody else.
* **0029 is in the repository and NOT on the project.** `list_migrations` on 2026-09-14 shows
  `0001` to `0023` applied (§8, and `docs/NOW.md`). Until 0029 is applied, the gateway's refusals are
  the only protection, a direct SQL write on the owner's row needs no setting at all, and a second
  active owner is refused by the gateway but not by the database. Apply 0029 before you need this
  page rather than during. If the index fails to create, the project already holds two active
  owners; the third recipe below is the fix, then apply again.

**What the trigger does not do.** A trigger that raises aborts its own transaction, so it cannot
write its own audit row; the gateway audits attempts instead. It follows that a break-glass write is
audited by nobody unless you write the row yourself, which is why every recipe below ends with an
INSERT into `ops.admin_audit`. Leave that line in. An owner's seat that moved with no record is the
thing this whole section exists to prevent.

**Where to run it.** The Supabase SQL editor for the project, or `psql` with the project's
connection string from the dashboard. The SQL editor runs as the `postgres` role; the trigger fires
for that role too, so the `set local` line is still required. Run each recipe as ONE block, from
`begin` to `commit`, because `set local` lives and dies with its transaction and is worthless
outside one. Nothing here is typed into the console, and nothing here goes through the gateway.

**Before any recipe, look.** Do not guess which row is the owner's.

```sql
select id, subject_id, email, role, status, mfa_required, granted_by, last_seen_at
  from ops.admins
 where role = 'owner'
 order by created_at;
```

### 13.1 You lost the second factor, not the account

The TOTP factor lives in Supabase auth, not in `ops.admins`, and the register is untouched. No
break-glass. In the Supabase dashboard, under Authentication, open your own user and remove the
enrolled factor; sign in to the product; enrol a new factor. The gateway will not open a console
session until the new factor has been verified (`aal2`), because in prod there is no switch that
relaxes that (`mfa_enforced`). Nothing to audit here beyond what auth keeps.

### 13.2 You lost the account: the owner's row must be bound to a new one

The owner's row is bound to one auth user id (`subject_id`), the trigger refuses changing it, and an
invitation cannot reach it (an invited row is matched only while it has no account). Create a new
user in Supabase auth, enrol its factor, note its id, then:

```sql
begin;
set local ops.break_glass = 'on';

update ops.admins
   set subject_id = '<new auth user id>',
       email      = '<the address on the new account>',
       updated_at = now()
 where role = 'owner' and status = 'active';

-- End every session the old account still holds, whatever its clock says.
update ops.admin_sessions
   set revoked_at = now(), revoked_reason = 'owner rebound by break-glass'
 where admin_id = (select id from ops.admins where role = 'owner' and status = 'active')
   and revoked_at is null;

insert into ops.admin_audit (actor_subject, actor_role, action, resource_type, resource_id, detail)
values ('<new auth user id>', 'owner', 'admin.break_glass',
        'admin', (select id::text from ops.admins where role = 'owner' and status = 'active'),
        '{"what": "rebind", "why": "<one line, no names>"}');
commit;
```

### 13.3 Two active owners, or the wrong account holds the seat

The one that should not be there is suspended, never deleted, so its trail keeps a name beside it.

```sql
begin;
set local ops.break_glass = 'on';

update ops.admins
   set status = 'suspended', updated_at = now()
 where id = '<the row to retire>' and role = 'owner';

update ops.admin_sessions
   set revoked_at = now(), revoked_reason = 'owner seat retired by break-glass'
 where admin_id = '<the row to retire>' and revoked_at is null;

insert into ops.admin_audit (actor_subject, actor_role, action, resource_type, resource_id, detail)
values ('<your auth user id>', 'owner', 'admin.break_glass',
        'admin', '<the row to retire>', '{"what": "suspend", "why": "<one line, no names>"}');
commit;
```

### 13.4 No active owner at all

The console cannot add an owner from inside itself, on purpose. The first row is the 0015 recipe,
and it is also the last resort. No `set local` is needed: the trigger guards changes to an existing
owner, and the unique index simply lets the first active one in.

```sql
begin;
insert into ops.admins (subject_id, email, role, status, mfa_required)
values ('<your auth user id>', '<your address>', 'owner', 'active', true)
on conflict (subject_id) do update set role = 'owner', status = 'active', updated_at = now();

insert into ops.admin_audit (actor_subject, actor_role, action, resource_type, detail)
values ('<your auth user id>', 'owner', 'admin.break_glass', 'admin',
        '{"what": "seat", "why": "<one line, no names>"}');
commit;
```

If that `on conflict` update is refused, the row it hit is a suspended owner and 0029 is applied:
run it again with `set local ops.break_glass = 'on'` as the first line after `begin`.

### 13.5 Afterwards

* `select count(*) from ops.admins where role = 'owner' and status = 'active';` must answer `1`.
* Sign in to the console and read the register panel: `owner_count` there must say the same.
* Read the newest rows of `ops.admin_audit`. Your `admin.break_glass` row is there, and so is any
  `admin.denied.owner` that preceded it, which is how you tell an accident from an attempt.
* The setting is gone the moment the transaction ends. There is nothing to switch back off.

**What this does not cover, honestly.** Nothing has run the trigger against a real project yet:
`services/gateway/tests/test_console_roles_schema.py` matches the text of 0029 and lists the four
things to drive by hand on a Supabase branch before this is relied on. Do that when 0029 is applied.

## 13. Break-glass: the owner's seat (migration 0029)

The console has exactly one owner account (docs/CONSOLE-ROLES-AND-BOARD.md §2). Migration
`0029_console_owner_and_capabilities.sql` makes that a constraint: a partial unique index allows one
active row with the owner role, and the trigger `ops.the_owner_is_not_yours_to_take` refuses any
statement that would demote, suspend, delete or rebind that row, whoever is asking, including the
service key the gateway runs on. The gateway refuses first and audits the attempt as
`admin.denied.owner`; the trigger is the backstop for the day the gateway is the problem.

That is a locked building with no key unless the way back is written down, so here it is. The
trigger has one bypass: the session setting `ops.break_glass`, read with `current_setting` inside
the transaction doing the write. PostgREST cannot issue `set local`, so no console route and no bug
in one can open it. It takes a direct SQL connection with the service role, which the owner holds
and nobody else does.

**When to use it.** The owner has lost access to the account bound to the owner row (a lost second
factor with no recovery code, a lost address), or the owner's row needs to move to a different
account. Nothing else. Adding, suspending and shaping every other person is done from the console.

**The procedure.** From a machine the owner controls, with the direct connection string (Supabase
dashboard, Project Settings, Database, the direct URI, not the pooler), in one transaction:

```sql
begin;
set local ops.break_glass = 'on';

-- 1. Look before touching. There is one active owner; note its id.
select id, subject_id, email, role, status from ops.admins where role = 'owner';

-- 2a. Move the seat to a different account: rebind the row to the new auth user's id.
update ops.admins
   set subject_id = '<the new auth.users.id>', email = '<the address on that account>'
 where role = 'owner' and status = 'active';

-- 2b. Or, if the seat must change hands entirely: retire the old row, then promote the new one.
--     The unique index allows one active owner, so the old row is retired first.
-- update ops.admins set status = 'suspended' where role = 'owner' and status = 'active';
-- update ops.admins set role = 'owner' where id = '<the new person's admin id>';

-- 3. End every console session on the row that moved.
update ops.admin_sessions
   set revoked_at = now(), revoked_reason = 'break_glass'
 where admin_id = '<the owner row id>' and revoked_at is null;

commit;
```

`set local` scopes the setting to this transaction and nothing else; a second session, or the same
session after `commit`, is back behind the trigger. Never `set` it at the role or database level,
which would leave the door open for every connection that follows.

**Afterwards.** Sign in to the console with the account now bound to the row and confirm the
register shows one owner. The trail carries no row for a change made this way, because it went
around the gateway on purpose, so write the date, the reason and the two ids in this section's
history below.

History: none yet.

### The database advisors, and the 33 findings that are the design (2026-09-16)

Run `get_advisors(security)` after any migration. On 2026-09-16, with 0024 to 0033 applied, it
returned three things and only one of them is work.

**33 x `rls_enabled_no_policy`, level INFO: intentional, every one.** Row level security is enabled
AND forced on these tables with no policy attached, which denies every client role outright and
leaves the gateway's service role as the only reader. The linter reports it because in an ordinary
Supabase app a policyless table means somebody forgot one; here it means the opposite, and each
migration says so in its own header ("NO policy for `authenticated` and none for `anon`"). The one
table that SHOULD carry a policy does: `learner.board_changes` has `board_changes_own_read`, and it
is correctly absent from the findings. **Do not "fix" these by adding a policy.** A policy on
`content.levels` hands a learner token the whole content library; one on `ops.promo_codes` hands it
every unredeemed code; one on `growth.waiting_list` hands it the mailing list.

**3 x `extension_in_public`, level WARN:** `vector`, `pgtap` and `pg_trgm` sit in `public`, from
0001. Real but not urgent, and moving an extension's schema breaks every reference to it, so it is
a planned change and not a tidy-up.

**1 x `auth_leaked_password_protection`, level WARN:** a dashboard toggle, on the owner's list. No
tool in this repo can set it.

### The Railway trap: a variable write redeploys GitHub `main`, not your upload (2026-09-16)

**This took production down once. Read it before touching a Railway variable.**

The `wobo` service is connected to the GitHub repo's `main` branch. `railway up` uploads a one-off
source SNAPSHOT and deploys that. Every OTHER trigger — a variable write, a redeploy pressed in the
UI, a rollback — rebuilds from **connected `main`**, ignoring whatever you last uploaded.

All of our work sits on `the-life`, unpushed. On 2026-09-16 `HEAD` was **192 commits ahead of
`origin/main`**, so setting `WOBO_DISCOVERY_WORKER=1` rebuilt `main` at `29684f29` ("app-wide
premium polish") and shipped a months-old gateway to production. Symptoms, in the order they appear:

* `/v1/doors` answers `404` instead of `{"doors_open":false}` — wave 46 is not in that build, so the
  door that refuses new accounts is not being served at all;
* `/healthz` still answers `200` but with the SHORT body `{"status":"ok","mode":"live"}` instead of
  the detailed one carrying `checks`. **A changed response SHAPE is the tell**: the status code lies,
  the shape does not.

**The fix, which takes about fifteen minutes:** re-upload verified HEAD as a snapshot.

```sh
git archive HEAD | tar -x -C /tmp/restore && cp .vercel/project.json .railwayignore /tmp/restore/
cd /tmp/restore && railway up --service wobo --detach
```

**The permanent fix is the owner's:** push `the-life` to `main`. Until `main` is current, a Railway
variable change is a production rollback with extra steps. If a variable MUST be changed before then,
set it and immediately re-upload HEAD, and check `/v1/doors` and the `/healthz` shape afterwards.

### What the first live hour of discovery actually did (2026-09-16)

Switched on at 03:11 UTC. By 03:19 the worker had stopped, and every tick since reads
`claimed=0 ... spent=true stopped=false`. **Nothing is broken.** The chain, traced rather than guessed:

* `worker.run_job` asks `ceiling.verdict()` (the $5 day, the $0.50 board, the hard stop) and then
  asks `self.afford()`. The two are SEPARATE gates and only the second returned `spent`.
* `afford()` calls `budget.charge("system:curriculum-discovery", "curriculum.discovery")`. That is
  the free plan's generation counter: `_FREE_GENERATIONS = 8`, and `FREE_DAILY_GENERATIONS` is not
  set on Railway. Eight a day.
* It spent all eight between 03:11 and 03:19: seven rechecks of `nios` (every one `unreachable`,
  a timeout) and one `isc` `mismatch`.

The money ceiling was never reached and never close: `model_calls_today = 0`, `spend_today_usd = 0`,
every job row's `result.cost_usd` is null, and `_amount(None)` is `0.0`, so the day's total is
**$0.00 against a $5.00 ceiling**. A reading of the tick that says "we hit the budget" is wrong.

**Two faults this exposed, both design, neither urgent:**

1. **An unreachable board consumes the whole day.** Seven of eight generations went to one board
   whose document timed out every time, and no information was gained from any of them. A board
   that has just timed out should not be the next thing tried; `BOARD_LEVEL_REASONS` already knows
   `timeout` and `unreachable` are facts about the HOST, and `REFUSALS_BEFORE_REST` is 3 — but that
   resting rule guards `ceiling.verdict`, which is not the gate that fired.
2. **A run that cost nothing still spends a generation.** `budget.refund` exists and
   `worker._refund()` calls it, but only when a CLAIM is lost, not when a run fails. A timeout
   costs no model call, so the day's budget is being spent on failures that bought nothing.

Neither is a reason to leave discovery off: it is bounded, honest, and it stops. The fix belongs in
a wave, with a test that a board timing out three times rests before it eats the day.

**Also observed and not a fault:** `/v1/doors` takes about 316 requests in the retained log window,
roughly one a second, across a dozen rotating `ip_hash` values with none dominant. That is the CDN
edge fanning out, not a runaway client.

### Pushing to `main` now triggers a deploy of its own (2026-09-16)

Since `main` was brought current, the Railway service's GitHub integration is live again, and that
changes the deploy rule written above.

Observed at 11:4x: `railway deployment list` showed TWO builds in flight at once —
`924661cf` from an uploaded snapshot and `e8b753bb` from `branch: main`. Both were the same commit
(`39548ee`), so the race was harmless; whichever landed last won and either was correct.

**The rule from here: push OR upload, not both.**

* `git push origin the-life:main` is now enough on its own — Railway builds it, and because `main` is
  current that build is the right code. This is the simple path and the one to prefer.
* `railway up` from a git-less export remains the way to deploy something that is NOT on `main`
  (a verification snapshot, a rollback, a fix that has not been pushed).
* Doing both starts two builds of possibly different code, and the loser is discarded silently. If
  they ever differ, the survivor is decided by build duration rather than by intent.

The Vercel side is unchanged and still needs the export: it blocks a deploy whose commit author is
not a team member, and the 192 commits made before 2026-09-16 are authored by the machine.

### The deploy procedure, confirmed by experiment (2026-09-16)

Two earlier notes in this file guessed at this and one of them guessed wrong. This one was tested:
wave 38 was committed, pushed, and NOTHING else was run — no `railway up`, no `vercel --prod`.

**Result: the push alone deployed both ends.** Railway built `a36f0168` from `branch: main,
commit d043e678`. Vercel built the same sha, twice, both marked `git push`. No CLI upload was
involved anywhere.

**So the procedure is: commit, push, stop.**

```sh
git push origin the-life:main    # Railway builds main; Vercel builds it too
git push origin the-life         # keeps the working branch current
```

**Correcting an earlier claim in this file.** The "Vercel blocks a deploy whose commit author is not
a team member" note was wrong about the mechanism. Deployment `dpl_CcwLvGCSvx6C8xASKt` built commit
`07864b04` — authored `MSR <depl@Shreyans-MacBook-Air.local>`, the machine — and shipped fine, logged
against the GitHub PUSHER (`ShreyanReddy`), not the commit author's email. Whatever refused a deploy
on 2026-09-15 was never isolated, and the git-less export was a workaround for a cause that was never
established. It is no longer a routine step.

**Keep the export for one case only:** deploying something that is NOT on `main` — a verification
snapshot, a rollback, or a fix that must not be pushed yet.

**One cost, measured, not yet optimised.** Pushing both refs produces THREE builds of one commit: a
Railway build from `main`, a Vercel build from `main`, and a Vercel build from `the-life`. They are
the same code so nothing breaks, but it is wasteful. Pushing only `the-life:main` would probably drop
it to two. That is an untested guess and is recorded as one.

**Asking Railway anything from a script (2026-09-16).** The credential in `.env.local` is a
**project** token, not an account token. Railway's GraphQL API at
`https://backboard.railway.com/graphql/v2` accepts it in a `Project-Access-Token:` header;
the ordinary `Authorization: Bearer` form is refused with `Not Authorized`, which is
indistinguishable from a revoked key and will send you looking for the wrong problem. The
`railway` CLI is separately logged out and says so — that is not evidence the token is dead.

```bash
TOK=$(grep '^RAILWAY_TOKEN=' .env.local | cut -d= -f2-)
curl -s https://backboard.railway.com/graphql/v2 \
  -H "Project-Access-Token: $TOK" -H 'Content-Type: application/json' \
  -d '{"query":"query{project(id:\"bc8ee3fe-7274-422e-bf7a-4fed542348a1\"){deployments(first:3){edges{node{id status meta}}}}}"}'
```

The surer proof that a deploy carried a given commit is not the deploy record but the service
itself: `curl -s https://api.heywobo.com/healthz` returns `version` — the running binary naming
its own commit. On 2026-09-16 that read `d043e6783338eeb…`, matching `main`, with
`status: degraded` for `payments` alone (Razorpay, awaiting the owner's keys) and
`/v1/doors` answering `{"doors_open":false}`.
