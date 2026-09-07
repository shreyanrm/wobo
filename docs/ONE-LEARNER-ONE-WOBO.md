# One learner, one Wobo

**The owner's requirement, 2026-09-05:** *"context relevance for wobo and user relevance and their
memory and details about the user and so on is very very important; I need you to make sure that
every user gets their own wobo in their account and doesnt mix up with someone elses... it's pretty
much like everyone getting their own claude chat account vibe."*

That is the right standard and it is the correct one for this product specifically, because Wobo is
not a stateless answer box. It carries a name, an age, a class, a board, a summary of what a learner
is like, up to twelve remembered facts and a record of what has already been tried. If two children
share any of that, the product is broken at its centre, and the failure is worse than a bug: a child
is handed somebody else's Wobo and told it is theirs.

**The shared family device is the normal case, not the edge case.** One laptop, two siblings. Any
design that only works when each learner has their own machine has not solved this.

---

## What is actually true today, audited 2026-09-05

Thirty keys reach a storage API across the app, the SDK and the character package. There are TWO
scoping mechanisms and they do not cover the same ground.

1. **`apps/web-pwa/src/store/scope.ts`** namespaces nine keys per learner (`key::subject`). It is
   the right mechanism and it covers the most sensitive things: Wobo's mind, the archive, the
   avatar, the learner profile and photograph, the boards they drew together, what the placement
   check established, what the re-teach ladder has already tried, and the vibe.
2. **`packages/sdk/src/state.ts`** scopes its own through `this.scoped(...)`: learner state, the
   conversation threads and the mastery cache.

### The gap

**Fourteen keys hold something that belongs to one learner and are scoped by neither.** On a shared
device, a second child inherits every one of them:

| Key | What the next child inherits | Where |
|---|---|---|
| `wobo-fsrs-v1` | the spaced-repetition schedule, which IS their memory of what needs revising | `engines/Flashcards.tsx` |
| `wobo-proactivity-v1` | Wobo's own proactivity state, out of the mind store | `store/mind.ts` |
| `wobo-course-pos-v1` | where they had got to in every course | `screens/course/shared.tsx` |
| `wobo-course-stars-v1` | the stars they earned | `screens/course/shared.tsx` |
| `wobo-trophies-celebrated-v1` | which trophies have been celebrated | `store/progress.tsx` |
| `wobo-activity-v1`, `wobo-activity-counts-v1` | the activity ledger | `screens/you/*` |
| `wobo-forged-v1` | practice they forged | `screens/practice/forge-store.ts` |
| `wobo-sky-seen-v1` | their progress sky | `screens/progress/sky.ts` |
| `wobo-parent-link-v1` | **their linked parent** | `screens/You.tsx` |
| `wobo-first-turn-v1` | whether they have met Wobo, so the second child never gets an introduction | `AppRuntime.tsx` |
| `wobo-referral-code-v1` | their referral | `store/referral.ts` |
| `wobo-onboarded-v1`, `wobo-onb-return` | onboarding state | `App.tsx`, `Onboarding.tsx` |
| `<POOL_KEY>` | practice pools, key built at runtime and unverified | `screens/practice/pools.ts` |

**The parent link and the flashcard schedule are the two that would be noticed first**, and the
first-turn flag is the one that would feel strangest: the second child is never introduced to Wobo,
because as far as the device is concerned they have already met.

### Legitimately device-level, and fine unscoped

`wobo-auth-session-v1` (the session itself), `wobo-voice-muted-v1`, `wobo-inspect` (a dev flag),
`wobo-signin-source-v1` (transient). (`wobo-state-adopted-v1`, the once-per-device adoption
marker, was retired on 2026-09-07: it held a previous learner's id under a plain key, and its gate
lost the second anonymous learner's work; the SDK now adopts the plain bucket under whoever the
device is keyed to next, and removes the old marker on sight.) Each of these
should carry a comment saying it is device-level ON PURPOSE, so the next reader does not have to
guess whether it was considered.

### The server side, from the earlier audit

Row level security is correct: all 23 tables key on `subject_id = auth.uid()`, and no gateway route
takes a learner id from a request. **One exception, and it is real:** an anonymous learner's identity
is `anon:<ip>`, and board ownership is that key, so two children behind one home or school NAT share
a meter and can reach each other's board turn. That is a deliberate anti-abuse trade with an
unintended privacy edge, and keying board ownership on the pair rather than the address alone keeps
the abuse property and removes the cross-read.

---

## The standard to build to

1. **Per-learner by default, device-level by exception.** A new key is scoped unless somebody writes
   down why it is not. The default today is the wrong way round.
2. **One mechanism, not two.** The SDK's own scoping and `store/scope.ts` should not be separate
   things a reader has to know about. Whichever survives, everything goes through it.
3. **Sign-out leaves nothing behind.** Anything belonging to the learner who just left is gone or
   is inaccessible to whoever signs in next.
4. **The anonymous-to-account upgrade carries the work forward**, because a child who tried Wobo
   before signing up should not lose what they did. That is the one case where data legitimately
   crosses a boundary, and it must cross only when the SAME person is on both sides of it.
5. **A test that fails if a new unscoped key appears.** This is the only rule that survives contact
   with a future wave. Enumerate the keys, and require every one of them to be on the scoped list or
   on an explicitly-justified device-level list.

---

## As built, 2026-09-07

The standard above is now code, and one test holds it: `apps/web-pwa/src/store/isolation.test.ts`.

**Two lists, in `apps/web-pwa/src/store/scope.ts`, and nothing outside them.**

- `SCOPED_KEYS`, `SCOPED_PREFIXES`, `SCOPED_SESSION_KEYS`: everything that describes one learner.
  The fourteen from the table above are on it (course position and stars, the flashcard schedule,
  forged workbooks, downloads, the activity ledger, trophies, proactivity, the parent link, the
  first-turn flag, the referral, both onboarding sentinels; the daily-quest claim was removed on
  2026-09-07, since nothing ever claimed it), plus the curriculum
  world, the brain-erase marker, the doubts, and the mind's offline queue. They are reached through
  `scoped` and `scopedSession`, which key every read and write by the signed-in subject.
- `DEVICE_KEYS`: the phone's own, each with the file that touches it and one line saying why two
  children on one phone should share it: theme, reduce motion, mute (three files read it), Wobo's
  once-per-tab arrival, the sign-in source (written before there is a subject, read once on the
  next boot), the auth session itself, the keyless dev identity, the key-rename marker, the
  remembered scope, and the developer's inspect flag. Read aloud and the palette's recent doors
  were moved OFF this list on 2026-09-07: read aloud rides every turn as the learner's own
  accessibility need, and a recent door id names the chapter the previous learner last opened.
  `SDK_SCOPED` names the SDK's own `:<subject>` caches so the scan can tell them from a stray.

**The migration.** `applyScope` moves every listed key under the learner the moment they are known,
and `scoped.getItem` moves an unscoped value on the first scoped read even when the key joined the
list later, so the day this ships nobody loses a streak. Proved in `isolation.test.ts` ("migration").

**The rule that survives.** The test reads the source of `apps/web-pwa/src`, `packages/sdk/src` and
`packages/wobo/src` and fails the moment a `localStorage`, `sessionStorage` or IndexedDB use appears
in a file that is not `scope.ts` or named on `DEVICE_KEYS`, and the moment a `wobo-…-vN` literal
appears on neither list. Run against the committed tree before this wave it reports 22 strays in
eleven files; against this tree, none.

**Sign-out.** `forgetScope` sweeps every key carrying the learner's id in both stores, the SDK's
`:<subject>` caches included, and the SDK's plain buckets too. The device keys stay.

**The door.** Under live auth the SDK is built before there is a session, so its providers were
keyed to nobody until the next reload, and a returning learner never reloaded: their XP went to the
plain `wobo-progress-v1` and never to the account. The door now leaves the page the moment a code
signs somebody in (`screens/auth/run.ts` `landingAfterDoor`), the same full navigation a provider
round trip already made, landing on `/onboarding`, where the account is read back and a learner who
has finished setup goes straight home.

**Proved in a browser at 390 wide** by `apps/web-pwa/tests/isolation.spec.ts` (project `isolation`):
Asha signs in, earns XP and a course star, tells Wobo a fact, links a parent; signs out; Riya signs in
and sees none of it, with her own referral and setup from the start; Asha signs back in and the
account gives her XP, streak and profile back. Shots in `apps/web-pwa/shots/isolation/`.

**Still open, and said plainly.** The account does not yet hold course stars, the flashcard
schedule, the activity ledger or the parent phone link (the mind syncs through another wave's
`mind-sync.ts`). They are isolated on the device and they leave with the learner; they do not yet
follow the learner to a second device. That is the MEMORY-LAW backlog, not something the spec
pretends about: it asserts what does not come back. And the SDK still keys its own caches with a
second mechanism (`:<subject>`); the sweep covers both, but "one mechanism" above is not yet true.
