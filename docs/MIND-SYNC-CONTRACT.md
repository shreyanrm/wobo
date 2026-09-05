# The mind sync contract

**What the client wave builds against.** The server half is done: the schema (`0020_wobo_mind`,
applied), the routes, the merge rule and the erase floor. This page is the exact shape of every
call, and the rules a client has to keep for the record to stay true. `docs/MEMORY-LAW.md` is the
law behind it; `services/gateway/src/wobo_gateway/mind.py` is the implementation and its docstring
is the reasoning.

**The one sentence.** The database is the record, the account is the key, the browser copy is a
cache — so a write says what CHANGED, in verbs, and the answer is always the record as it now
stands. A whole-snapshot PUT that unions into the record reads well and is wrong: it lets a phone
that has been in a drawer for a month decide what Wobo remembers.

---

## 1. `GET /v1/me/mind`

Read the record. Free, unmetered, on the sync's own rate-limit bucket (120 a minute by default,
separate from the one the lesson spends).

Query: `?since=YYYY-MM-DD` trims the day ledger to that date onward. Use it on sign-in: a full year
of counters is about 46KB and only ever draws a chart.

```json
{
  "mind": {
    "interests": ["cricket"],
    "facts": ["exam on friday"],
    "latenciesMs": [1200],
    "slips": [{ "nodeId": "n1", "itemId": "i1", "value": 4, "at": "2026-09-05T10:00:00Z" }],
    "dwellSec": { "practice": 500 },
    "sessionDays": ["2026-09-04", "2026-09-05"],
    "days": { "2026-09-05": { "answered": 8, "wrong": 1, "asked": 0, "helped": 0,
                              "kept": 0, "entered": 0, "seconds": 0, "evening": true } },
    "helpedAt": null
  },
  "stored": true,
  "updated_at": "2026-09-05T10:00:03+00:00",
  "erased_at": null
}
```

* `mind` is exactly `MindState` in `apps/web-pwa/src/store/mind.ts`. Render it directly; there is no
  translation layer and there must not be one.
* `stored` is false when there is no record yet **or** when the record holds nothing.
* `erased_at` is non-null when this account's mind was erased. **A client that sees it must clear its
  local copy**, because nothing it still holds will be accepted.
* An anonymous caller gets `stored: false` and an empty mind, never a 403. Their device keeps its own
  copy and the first signed-in write seeds it into the account.
* A parent account is refused (`403 not_a_learner_account`). Parent accounts have no mind of their
  own, for life.

## 2. `PUT /v1/me/mind`

Every field is optional. A write that only forgets carries no snapshot; a write that only counts
carries no words.

```json
{
  "mind": { "…MindState…" },
  "remember": { "facts": ["exam on friday"], "interests": ["cricket"] },
  "forget":   { "facts": ["plays cricket"],  "interests": [] },
  "bump": {
    "days":  { "2026-09-05": { "answered": 3, "wrong": 1, "evening": true } },
    "dwell": { "practice": 120 }
  },
  "write_id": "a-uuid-for-this-write",
  "client_updated_at": "2026-09-05T10:00:00.000Z"
}
```

**`mind` — the snapshot. It SEEDS once and CONFIRMS forever after.**
On the very first write against an account it becomes the record, which is how the work a child did
before signing in follows them in. After that a fact or an interest the record does not already hold
is **not added by a snapshot, ever**. The fields that do fold from every snapshot are the ones with
an identity of their own: `slips` (keyed on node, item and time), `sessionDays` (a set of dates),
`helpedAt` (the later stamp) and `latenciesMs` (see below). `days` and `dwellSec` in a snapshot are
read only when seeding; after that they change through `bump` alone.

**`remember` — the only way to add.** Send it when the learner actually tells Wobo something. It
lifts a tombstone: somebody who cleared "plays cricket" in March and says it again in June gets it
remembered again. Max 32 items per list, 160 characters each, flattened to one line.

**`forget` — the memory page's per-item clear.** Writes a tombstone (a digest, never the text) so the
item cannot come back from a device that still holds it. 400 tombstones per kind are kept, which is
far past a year of ordinary tidying.

**`bump` — the counters, as deltas.** What happened ON THIS DEVICE since its last successful write.
The server ADDS them, so three answers on the laptop and five on the phone is eight. Counters:
`answered`, `wrong`, `asked`, `helped`, `kept`, `entered`, `seconds`, plus the `evening` flag, which
is an OR. Max 10,000 per counter per write. **Reset your local pending deltas only after a 200.**

**`write_id` — idempotency for `bump`.** A fresh id per write, the SAME id on a retry. A write id the
record has already seen is answered from the record and counted once. The last 16 are remembered.

**`client_updated_at` — send it on every write.** Two uses: it breaks the tie on `latenciesMs`, and
it is how the server tells a live device from the cache of an account that was erased. A stamp more
than 24 hours ahead of the server's clock is replaced by the server's, so a device with a wrong
clock cannot freeze a field for the life of the account.

### The answer

```json
{
  "mind": { "…the record as it now stands…" },
  "stored": true,
  "updated_at": "…",
  "erased_at": null,
  "applied": true,
  "ignored": null,
  "dropped": []
}
```

* `applied: false` with `ignored: "erased"` — this device is talking from a cache the learner erased.
  Nothing was written. **Clear the local copy.**
* `applied: false` with `ignored: "duplicate"` — this exact `write_id` already landed. Nothing was
  written twice; treat it as a success and drop your pending deltas.
* `dropped` — items the record could not take. Today only interests beyond the eighth: the record
  keeps the FIRST eight the learner named, which is the order onboarding wrote them in and the order
  `store/mind.ts` keeps (`slice(0, 8)`). Facts are a rolling window of the newest twelve.
* **Reconcile to `mind` on every answer.** It is the record; your copy is not.

## 3. `POST /v1/me/mind/forget`

```json
{ "contains": "mother" }
```

The in-conversation verb — "Wobo, forget about my mother" — answered against the RECORD. The
client-side substring match could only see the device it ran on, so a fact the learner told Wobo on
their phone, which this laptop had never held, was not matched, not tombstoned, and pushed back to
every device on the next sync: the learner asked to be forgotten, was told it was done, and it was
not. Answers with the usual view plus:

```json
{ "forgot": { "facts": ["my mother is unwell"], "interests": [] } }
```

`forgetMatching` in `AppRuntime.tsx` should call this and then reconcile to the returned `mind`,
rather than resolving the substring against `loadMind()`.

## 4. Failures, and what each one means

| Status | code | What is true | What the client does |
|---|---|---|---|
| 403 | `sign_in_required` | anonymous, or no subject | keep the local copy; offer sign-in |
| 403 | `not_a_learner_account` | this is a parent account | there is no learner mind here; stop syncing |
| 422 | — | a field the route does not know | a bug; do not retry |
| 429 | `rate_limited` | the sync's own bucket is spent | back off; the lesson's allowance is untouched |
| 500 | `store_refused` | the store said no and will say no again | keep the local copy; do NOT retry; the line names support@heywobo.com |
| 503 | `store_unavailable` | could not be reached, or would not settle | **nothing was written**; keep the local copy, tell the learner in one calm line, retry |

A 503 is worth retrying and a 500 is not, and that distinction is the point of splitting them:
telling somebody "try again in a moment" about a constraint violation is a false claim in a kind
voice.

## 5. What the client still owns

* **The offline queue.** Write locally so the screen is instant, enqueue `remember` / `forget` /
  `bump`, drain when the network returns. That is memory-law rule 2, and this contract is shaped for
  it: the verbs are what a queue holds.
* **The debounce.** One write in flight per device, and the same `write_id` on a retry.
* **Rendering.** `days`, `dwellSec`, `sessionDays` and `latenciesMs` never reach a prompt; they draw
  the You screen.

## 6. What the record puts into the prompt, so the client no longer has to

`POST /v1/capability/wobo.turn` now GROUNDS the dossier server-side before the turn is built
(`mind.ground_lifetime`), for the streaming and non-streaming paths alike:

* `context.lifetime.facts` and `.interests` are **replaced** by the account's record whenever a
  record exists. (When there is none — a client that has not synced yet — the device's copy stands,
  because stripping it would make Wobo worse at teaching for no gain in truth.)
* `context.lifetime.parentFacts` is **always replaced** by the accepted parent-offered facts read
  from the offers store, and rendered on their own dossier line, marked as coming from their parent.
  A payload asserting it is not evidence of it: the promise to the child is that a parent-offered
  fact is never disguised as something Wobo worked out, and provenance the client can type is not a
  promise.

The rest of `lifetime` (the learner's name, grade, board, twin summary, mastery highlights,
accessibility, language) still comes from the payload, because those stores have not moved to the
account yet. That is named here so nobody reads the grounding as more than it is.

## 7. Two things this wave could NOT do, and they are the client wave's to close

Both are in `packages/sdk/src/**` and `apps/web-pwa/src/**`, which another wave held while this one
ran.

1. **`ERASURE_REGISTER` in `packages/sdk/src/supabase.ts` names none of the eight tables added by
   0019 and 0020.** Consequences, in order of seriousness: `eraseRemoteData` (the client's own erase,
   the path that runs when the gateway is unreachable) never issues the delete for
   `learner.wobo_mind`, even though the policy allows it; and `erasureGapSentence()` on the You
   screen cannot name what is left standing, so the screen tells a family everything is on a list
   that does not contain the most personal table in the database. The rows to add, with the reach
   each one honestly has:

   | Table | reach | why |
   |---|---|---|
   | `learner.wobo_mind` | erasable | policy `wobo_mind_own_erase` is FOR DELETE to the owner; the gateway's erase also leaves the `erased_at` marker, which holds a date and nothing about the learner |
   | `parent.accounts`, `parent.child_links`, `parent.selections`, `parent.mind_facts`, `parent.threads` | unreached by the client | the whole `parent` schema is service-role only, by design (0019); the gateway's `/v1/me/erase` reaches them |
   | `parent.offers` | exempt | the removed row deliberately keeps its `fact_key`, which is what stops a parent re-adding what a child removed |
   | `parent.access_audit` | exempt | append-only by trigger and by grant; it is the trail that protects the child |

2. **`forgetMatching` (AppRuntime.tsx:763) must call `POST /v1/me/mind/forget`** rather than
   matching against `loadMind().facts`.

And one thing that is neither: **`wobo-proactivity-v1` lives inside `store/mind.ts`, is outside
`MindState`, and uses raw `localStorage` rather than `scoped`** — so it neither follows the account
nor separates two siblings on one laptop. It needs a decision: either into `MindState` (and then it
syncs by this contract with no server change) or into the named list of genuinely device-level keys
with a reason, per memory-law rule 5.
