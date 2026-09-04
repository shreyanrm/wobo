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
* **FIVE MIGRATIONS HAVE NEVER BEEN APPLIED, and three shipped features read tables they create.**
  Checked against the live project on 2026-09-04: eight migrations are applied, ending at
  `0012_parent_links_expired`, and the `ops`, `billing` and `admin` schemas do not exist at all.
  Unapplied, in order:

  | Migration | What has already shipped against it |
  |---|---|
  | `0013_mastery_cache_evidence` | the mastery evidence write path |
  | `0014_subscriptions` | billing reads `learner.subscriptions` |
  | `0015_admin_register_and_audit` | the admin console door reads `ops.admins`, `ops.admin_sessions`, `ops.admin_audit` |
  | `0017_ops_reports` | `POST /v1/flags` writes `ops.reports`, and the console's four desks read it |
  | `0018_usage_ledger` | the usage ledger writes `ops.model_calls` and `ops.usage_daily` |

  (`0016` is deliberately empty and records a skipped number; applying it changes nothing.)

  Nothing crashes today because nothing has exercised those paths in production yet. The first
  admin login, the first flag and the first ledger flush all fail against a missing table.
  Reproduce the check with `list_migrations` and `list_tables` on schemas `ops`, `billing`,
  `admin`. **Applying these is the owner's call and has not been done for him:** they were written
  by three different waves, they have never run anywhere, and applying SQL to the production
  project is not something a build agent should do on its own judgement. Apply them in numeric
  order, one at a time, reading each file first.

If any of these changes, change this page in the same commit.

---

## 9. Where the code is

| Concern | File |
|---|---|
| The money ceiling and the lanes | `services/gateway/src/wobo_gateway/spend.py` |
| The alarm and the webhook sink | `services/gateway/src/wobo_gateway/alerts.py` |
| What `/healthz` knows | `services/gateway/src/wobo_gateway/health.py` |
| Where the ceiling is enforced | `services/gateway/src/wobo_gateway/app.py` (`Gateway.invoke`, `stream_board_turn`) |
| Where a call's cost is priced | `services/gateway/src/wobo_gateway/telemetry.py` (`record_cost`) |
| The per-learner daily allowance | `services/gateway/src/wobo_gateway/budget.py` |
| Deploy steps and rollback | `DEPLOY.md` |

Tests: `services/gateway/tests/test_spend.py`, `test_alerts.py`, `test_health.py`.
Run them with `cd services/gateway && uv run pytest -q`.
