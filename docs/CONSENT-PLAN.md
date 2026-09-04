# The consent plan

**Status: nothing in this document is built.** Written 4 September 2026 as part of the honesty pass
on branch `the-life`. It exists because four published documents described a consent gate the
product does not have, those documents have now been corrected to say so, and the correction is only
half an answer. This is the other half: what has to be recorded, what has to be gated, what each
market requires, and what the owner has to decide before any of it can be built.

It is a plan and not a specification. Where a decision belongs to the owner or to counsel, it says
so instead of choosing.

---

## 1. What exists today, verified in code

Every line here was checked on 4 September 2026 against branch `the-life`.

| Thing | Where | State |
|---|---|---|
| A consent tier on every account | `infra/supabase/migrations/0002_learner_operational_plane.sql:22-23` | `profiles_cache.consent_tier`, constrained to `un_elevated` or `elevated`, defaulting to `un_elevated` |
| A server-side read of it | `services/gateway/src/wobo_gateway/consent.py:169` `get_tier` | Real, derived from the verified subject, never read from a request body |
| An enforcement point | `services/gateway/src/wobo_gateway/app.py:270-279` | Real. A capability marked `elevated_only` is refused for an un-elevated learner |
| Capabilities that use it | `registry.py:135-140`, `registry.py:167-172` | Two: `peakcut.evaluate` and `archetype.classify`. Neither is a thing a parent would recognise |
| A writer | nowhere | `grep -rn "consent_tier" services packages apps infra` returns reads, one dev seed row, and the column definition. **No code path in the repository ever sets it.** `0014_subscriptions.sql:154` revokes the learner's own update grant on the column |

The consequence: every learner in the product sits permanently on `un_elevated`, and the four
features a parent would actually care about check nothing at all.

| Feature | Where it runs | Tier check |
|---|---|---|
| Long-term memory across sessions | `learner_state.mind`, written through `packages/sdk`, read into every prompt by `wobo.py:880-915` | none |
| Voice | `services/gateway/src/wobo_gateway/voice.py`, `GET /v1/voice/session` | none |
| Photograph intake | `services/gateway/src/wobo_gateway/curriculum/own.py`, `read_photo` | none |
| The parent link | `services/gateway/src/wobo_gateway/parents.py`, `POST /v1/me/parent-invite` | none |

One more fact that decides part of the design: **the declared date of birth is never persisted
anywhere a server can see it.** `profiles_cache.birthdate` exists
(`0006_wobo_rename_and_profile_fields.sql:8`) and nothing writes it; `syncProfile` sends
`display_name, grade, board, archetype_slot` only (`packages/sdk/src/client.ts:109-114`); the
sign-up screen holds the date in React state and drops it. So today the server cannot tell a nine
year old from a nineteen year old, which means it cannot decide who needs consent even if consent
existed.

---

## 2. What must be recorded

A consent record is not a boolean. Every regime that matters here asks the same four questions, and
a record that cannot answer all four is not evidence of anything.

**Who consented.** The adult, identified well enough to be found again: the address or number the
confirmation went to, and the identifier of whatever verification method was used. Not the child's
subject id, which is who the consent is *about*.

**What they consented to.** Item by item, not one lump. Memory, voice, photographs, the parent link,
and marketing to the parent are five separate answers, and a parent who says yes to two has said no
to three. Store the list, with the exact wording that was on the screen at the time, or a version
identifier that resolves to it.

**When.** The timestamp, and the version of the notice that was shown. A consent given against
wording that has since changed is a consent to the old wording.

**How it was verified.** The method, by name, from a closed list, plus whatever evidence that method
produces: the message identifier, the confirmation event, the transaction reference for a card
check. "Email" on its own is not a method, it is a channel.

**And, throughout: what changed.** Withdrawal is as much a record as consent. Never overwrite; append.
A row that says only "memory: off" cannot tell a regulator, or a parent, that it was on for eight
months first.

Suggested shape, for the owner and counsel to argue with rather than adopt:

- `learner.consent_grants` — one row per grant or withdrawal: `subject_id`, `scope`
  (`memory` / `voice` / `photos` / `parent_link` / `parent_marketing`), `granted` boolean,
  `notice_version`, `method`, `verified_at`, `evidence_ref`, `actor` (`parent` / `learner`),
  `recorded_at`. Append only, service-role write, learner read of their own rows.
- `profiles_cache.consent_tier` stays as the fast door the gateway already enforces, derived from
  the grant rows rather than written directly, so there is exactly one source of truth and the
  gateway's existing check keeps working unchanged.
- A retention rule of its own: the consent record outlives the account, because the obligation is to
  be able to show consent was given. `privacy-policy.md` section 7 currently guesses at three years;
  that number needs counsel.

---

## 3. What gates on it

Four, and the enforcement point for all four already exists.

1. **Memory.** Not the lesson record, and not progress. The gate is on `learner_state.mind`: the
   facts a child told Wobo in their own words, the twin summary, and their inclusion in the prompt
   dossier at `wobo.py:880-915`. Un-elevated means the tutoring still remembers what was mastered
   and still teaches from it, and Wobo does not carry a dossier of the person.
2. **Voice.** The gate is on the session token at `voice.py`, which is the point where our key is
   spent, so refusing there refuses everything downstream.
3. **Photograph intake.** The gate is on `read_photo` in `curriculum/own.py`, before any image
   leaves for a model. A child can still type a syllabus in.
4. **The parent link.** The gate is on `POST /v1/me/parent-invite`. This is the one where the
   construction matters most: below the age of consent, the parent is the account holder exercising
   their own rights and the child's tap is not a valid consent to disclosure; at or above it, the
   learner's own consent is the basis and should be recorded as such.

Three things that must **not** gate, because gating them would make consent a price on learning:
teaching, progress and mastery, and the erase and access controls. `apps/web-pwa/src/screens/auth/age.ts:15-17`
already encodes "teaching is never gated" as a rule, and it should stay the rule.

The two capabilities that gate today, `peakcut.evaluate` and `archetype.classify`, are behavioural
profiling of a child and belong in the same conversation, not in a separate one.

---

## 4. What each market requires

**India, DPDP Act 2023.** Verifiable parental consent for every Data Principal under 18, section
9(1), with no exception for a service a teenager could otherwise contract for. This is the strictest
of the four and the product's primary market, so it sets the ceiling: under-18 means parent. Section
9(3) separately forbids tracking and behavioural monitoring of a child, which is the question the
learning profile itself has to answer, not just the consent in front of it. The verification standard
lives in the rules and may point at a Consent Manager or a digital-locker token.

**European Union, GDPR Article 8.** Consent of the holder of parental responsibility below the age
of digital consent, which each member state sets between 13 and 16. That means a country table, not
one number, keyed on a country the product already collects for pricing. Above that age the learner
consents for themselves, and the notice still has to be intelligible to a child, Article 12(1).

**United Kingdom, UK GDPR and the Age Appropriate Design Code.** Age of digital consent 13. The code
applies to every user under 18 regardless of consent, and two of its standards bear directly on this
plan: standard 7, high privacy by default, which the product currently fails because
`getFlag` (`apps/web-pwa/src/screens/you/profile.ts:226-232`) returns true for an absent key and so
turns every optional feature, including Wobo's spoken voice, on for a brand-new learner; and standard
3, age-appropriate application, which needs an age the server can act on.

**United States, COPPA.** Verifiable parental consent before collecting anything from a child under
13, and the method has to come off the list at 16 CFR 312.5(b)(2). Email-plus is on that list only
for internal use of the data, and a prompt that goes to a frontier model provider is not internal
use. Section 312.7 additionally forbids conditioning participation on more data than is reasonably
necessary, which is the rule that makes "teaching is never gated" a legal requirement and not only
good manners.

**California.** Nothing to opt into for sale or sharing, because nothing is sold or shared. The
eraser-button law and the CPRA minors' rules bite on the deletion side, which is a separate piece of
work in `privacy-policy.md` section 8.

---

## 5. What the owner has to decide

These are decisions, not engineering. Nothing below can be settled by reading the code.

1. **One age rule, or a table.** The simple answer is to apply the Indian rule everywhere: under 18
   means a parent consents. It is the strictest, it is one code path, and it is defensible in every
   market. The cost is asking for a parent from a sixteen year old in Berlin who does not legally
   need one, and losing some of them. The alternative is a country table and five times the
   surface to get wrong.

2. **Which verification method, per market.** A confirmation link to the parent's own address is
   cheap and is not enough for COPPA. A refundable card charge is on the COPPA list and adds a
   payment step to a free product. A government-backed identity or a Consent Manager may be required
   in India. This is a cost and conversion decision as much as a legal one, and it is the single
   biggest fork in the plan.

3. **Whether to persist the birthdate.** Without it the age gate is one screen and nothing more, and
   nothing on the server can act on age. With it, the product holds a date of birth for every child,
   which is more data about a minor, not less. The middle answer is to store the derived band and the
   country rather than the date. The owner should pick one and the answer should be written down.

4. **What happens to accounts that already exist.** Every learner in the product today gave nothing
   and was asked nothing, and their memory, their voice sessions and their photographs happened
   without a consent. When the gate ships, do those accounts keep what they have and get asked
   going forward, or does the memory come off until a parent says yes? The second is right and
   expensive.

5. **Whether the shipped default inverts.** Standard 7 of the UK code says high privacy by default.
   `getFlag` says the opposite, on every optional flag, including the spoken voice. Inverting it is
   two lines and it will make the product quieter on first run for everyone. This is a taste
   decision with a legal shadow.

6. **Whether a crisis is ever passed to a parent.** Out of scope for the four gates and it uses the
   same machinery, so it belongs in the same decision. `safety.py` records that the old
   `escalated_to: "guardian"` field claimed this and nothing read it, and that the decision belongs
   to the owner. `docs/legal/safety-and-content.md` section 3 now says plainly that nothing is sent.

7. **Whether the product may be offered at all, in each market, before this ships.** That one is
   counsel's, and it is the first question on the list in `docs/LEGAL-REVIEW.md`.

---

## 6. The order to build it in

1. Persist the age answer, in whatever form question 3 above settles on. Without it nothing else can
   decide who needs consent.
2. The append-only grant table and the derivation of `consent_tier` from it. The gateway's
   enforcement point already exists and does not change.
3. The parental notice screen. The wording is already written, word for word, at
   `docs/legal/parental-consent.md` section 3, and it is reviewed copy, not a draft.
4. The four gates, in this order: photographs, voice, the parent link, memory. Memory last because it
   is the one with a migration question attached, per decision 4.
5. Withdrawal, which is the same table with `granted` false, plus the erase of the data behind the
   feature that was switched off. That erase depends on the erasure work in
   `docs/conformance/privacy-and-children.md` section J, which today reaches 6 of 22 stores.
6. Then, and only then, `docs/legal/childrens-privacy.md` section 3 and
   `docs/legal/parental-consent.md` are rewritten back into the present tense, one sentence at a
   time, each against the code that makes it true.
