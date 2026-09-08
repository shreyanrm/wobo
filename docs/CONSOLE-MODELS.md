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
