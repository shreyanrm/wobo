# The models desk: what answers what, at what price, changed from one place

**The owner, 2026-09-08:** *"In the superadmin make sure I see what models are being used for what,
and an option to change them from there, so I can control the content quality and the costing from
one place."*

## 1. What the desk shows

The router's whole table (`routing.py`, the tiers and the chains), live, with the vendor's price
beside every id from the catalogue, and beside every tier the jobs that ride on it (from
`registry.py`: which capabilities), what it cost yesterday and today (from the ledger, per tier and
per model), and who is carrying it right now (the health snapshot's `carrying`, so an outage or a
provider out of credit shows as the fallback in bold). One row per tier:

| tier | jobs on it | primary | chain | price in / out per M | spent today | carrying now |

Plus the generation ladder (luna, terra, sol) with how often each rung was reached this week, and
the judge's pass rate per rung, which is the number that says whether the cheap rung is good enough.

## 2. What the desk lets the owner change

- A tier's primary and its chain, from the catalogue only (an id not on the catalogue is refused, as
  the env override is today), with the effect previewed before saving: the price difference per
  thousand calls at yesterday's volume.
- The generation ladder's rungs.
- Every change is an audit row (who, when, from, to) and takes effect without a deploy: the gateway
  reads `ops.settings` for tier overrides on a short cache and calls `routing.configure()` with them,
  the same path the env variables use, so the two never disagree (env wins if both are set, and the
  desk says so).
- A "back to the owner's table" button that clears every override.

## 3. What changes in the code

1. `ops.settings` (with the allowance settings, docs/ALLOWANCE.md): keys `tier.<name>.primary`,
   `tier.<name>.chain`, `generation.ladder`, each with `updated_by`, `updated_at`, and an audit row.
2. `routing.configure(overrides)` already exists; a settings reader in the gateway feeds it and
   re-reads on a short interval and on a console write.
3. `desks_api.py`: `GET /v1/admin/models` (the table, the prices, the spend, the carrying, the ladder
   stats) and `POST /v1/admin/models` (a change, owner-only, audited). The console screen in
   `apps/web-pwa/src/admin/`.
4. The ledger already records the model that served each call; the per-tier spend is a rollup of it.

## Prices are dated, not eternal (2026-09-08)

OpenAI's page (read 2026-09-08): Sol 4.00 in / 0.40 cached / 20.00 out per million is **promotional,
"available at least through November 21, 2026"**; Terra 2.00 / 0.20 / 12.00 and Luna 0.20 / 0.02 / 1.20
are standard rates. All three carry a long-context band at roughly double the input price (Sol 8.00 /
30.00, Terra 4.00 / 18.00, Luna 0.40 / 1.80); the 5.6 page does not print the token boundary, but the
GPT-6 Astra page does ("more than 272K input tokens"), so the desk uses 272K for the whole family until
the vendor prints otherwise. GPT-6 Astra (10.00 / 1.00 / 50.00, cache writes 12.50) is in the catalogue
so the desk can offer it per tier; it is on no chain by default: at a typical Wobo turn it costs
forty-five times Luna and the daily allowance would buy six of them. The desk
shows the promotion's end date beside Sol's price and turns the row amber thirty days before it, and
the catalogue's prices are re-read from the vendor pages on the first of every month with the diff
logged to the audit.

## The creative pool (owner, 2026-09-08)

The desk carries one more row and one more line: the **create** tier (GPT-6 Astra first) and the
**creative pool**, the platform's own daily cap for it (default 40 USD, its own dial, its own
alert at 50/80/100 percent), shown beside the learners' spend and never mixed with it. The row
shows what was created today (concepts, candidates, films), what it cost, and the cache's hit rate,
so the owner can see the impressive stuff being paid for exactly once.

## Expenses you can see, dials that apply (owner, 2026-09-08)

*"I want to be able to track all these expenses in my dashboards and adjust them so that what I
request will apply."* Two obligations on the console:

**See.** Spend by day, by payer (the creative pool; learners by plan: free, plus, pro, max; strangers),
by tier and model, by capability, with cache hit rates beside every content row so paid-once work is
visibly paid once. Per learner on the learner's admin page: today's allowance, spent, on which tiers.
The daily ceiling, the creative pool's cap and the free tier's rupees each with a bar. Exported as a
CSV a month at a time. The provider dashboards remain the authority for the bill; the desk
reconciles to them and shows the gap.

**Apply.** Every dial the owner changes (generosity, the free tier's rupees, the creative pool's cap,
the daily ceiling, any tier's model, a promo code) is written to `ops.settings` with an audit row,
and the gateway reads it within a minute without a deploy: `routing.configure()` and the spend and
allowance readers re-read on a short interval and on a `/v1/admin/settings/apply` call. The desk
shows "applied at" next to each dial and turns red if the gateway's view lags. A test proves a
changed dial changes the very next call's model and cap.
