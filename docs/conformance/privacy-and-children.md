# Conformance register — privacy and children

Compiled 4 September 2026 against branch `the-life` at commit `0704817`, by reading the code, the
migrations and the shipped legal set. Nothing here is ticked from a document alone: where a
document promises a thing, the entry says whether the code does it.

**How to read a status.**

| Status | Means |
|---|---|
| MET | The obligation is discharged, and the evidence column names the file, line or command that shows it. |
| PARTIAL | Something real exists and something real is missing. Both are named. |
| NOT MET | It does not exist. |
| N/A | Considered, does not apply to this product, with the reason. |
| NOT VERIFIED | Cannot be checked from this repository. The evidence column says exactly what would check it. |

**The three things that would hurt most, before the tables.**

1. **The public security page tells families that AI model providers "answer the question without
   ever knowing whose it is"** (`apps/web-pwa/src/screens/pitch/Security.tsx:194`). Every tutoring
   turn sends the learner's **name, age, class, board, twin summary, mastery highlights and up to
   twelve remembered personal facts** to OpenAI, Anthropic or Google in the prompt
   (`services/gateway/src/wobo_gateway/wobo.py:880-915`, called at `:1118`). The page is live at
   `/security`. This is a false statement about children's data on a public marketing page.
2. **There is no consent mechanism at all.** `consent_tier` is read on every capability call
   (`services/gateway/src/wobo_gateway/consent.py:169`) and no code path in the repository ever
   writes it; migration 0014 explicitly withdrew the learner's grant to write it
   (`infra/supabase/migrations/0014_subscriptions.sql:154`). Memory, voice, photographs and the
   parent link are all reachable today by any signed-in learner of any age, which is the exact
   opposite of what `docs/legal/childrens-privacy.md` §3 tells parents.
3. **Erasure reaches 6 of the 22 durable stores that hold personal data**, and there is no account
   deletion at all — no code deletes an `auth.users` row, so "start over" leaves the account, its
   email and its password standing. Section J lists what is left behind.

---

## A. Governance and accountability

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| A1 | A named controller / Data Fiduciary is identified to users | GDPR Art 13(1)(a); DPDP s5 | MET | `docs/legal/privacy-policy.md:21` names Dot eVentures Pvt Ltd with a registered address, rendered live at `/legal/privacy` (`apps/web-pwa/src/screens/legal/catalog.ts:19`) | — |
| A2 | Controller entity confirmed as the correct legal entity for EU/India | GDPR Art 4(7) | NOT VERIFIED | `privacy-policy.md:21` carries `[REVIEW: confirm entity, registration…]` | Company records and counsel's opinion; nothing in the repo can answer it |
| A3 | Record of processing activities (ROPA) | GDPR Art 30 | NOT MET | `grep -rli "record of processing\|ROPA" docs/` returns only the legal drafts and this file; no ROPA document exists | Write a ROPA; section I of this register is the raw material for it |
| A4 | Data Protection Impact Assessment for large-scale processing of children's data | GDPR Art 35(3)(b); ICO Age Appropriate Design Code | NOT MET | `docs/legal/README.md:69` lists "Confirm whether a DPIA is required, which we assume it is, and commission it" as an unchecked box | Commission a DPIA before launch; it is a precondition, not a follow-up |
| A5 | Data Protection Officer designated and contactable | GDPR Art 37; DPDP s10 | PARTIAL | `docs/legal/privacy-policy.md:28-29` publishes a DPO row and an India grievance-officer row, both pointing at `support@heywobo.com` with no named person; `privacy-policy.md:34` flags whether a DPO is even required as unanswered | Name a person, give them a dedicated mailbox, and record the appointment |
| A6 | The published mailboxes actually exist and are answered | GDPR Art 12(2) | NOT VERIFIED | `docs/legal/README.md:57` requires support@, privacy@, dpo@, safety@, security@, accessibility@, legal@ to exist before launch; nothing in the repo proves any of them do | Send a test message to each address and keep the reply |
| A7 | EU Article 27 representative | GDPR Art 27 | NOT MET | `docs/legal/privacy-policy.md:30` is the literal placeholder `[EU representative name and address]` | Appoint one, or establish that Art 3(2) does not bite, before selling into the EU |
| A8 | UK Article 27 representative | UK GDPR Art 27 | NOT MET | `docs/legal/privacy-policy.md:31` is the placeholder `[UK representative name and address]` | Same as A7 for the UK |
| A9 | Grievance officer published for India | DPDP s13(3) | PARTIAL | `docs/legal/privacy-policy.md:29` names the role and a postal address but no individual, and there is no in-product grievance route | Name the officer and give them a route in the app, not only in a document |
| A10 | Processor contracts / DPAs in place with every provider | GDPR Art 28(3); DPDP s8(2) | NOT VERIFIED | Providers used are OpenAI, Anthropic and Google Gemini (`services/gateway/src/wobo_gateway/routing.py:92-106`), Supabase, Railway, Vercel and a mail provider; no DPA is stored in the repository | Collect each signed DPA and file it; the model-provider ones also have to carry the no-training term claimed at `childrens-privacy.md:79` |
| A11 | A named sub-processor list available on request | GDPR Art 13(1)(e) | PARTIAL | `docs/legal/privacy-policy.md:118` promises a named list on request; the public page publishes categories and regions only (`Security.tsx:181-208`); no list document exists in the repo | Write the list; it is six rows |
| A12 | Staff access to children's data is least-privilege and logged | GDPR Art 32; and the public claim at `Security.tsx:164-165` | NOT MET | The gateway holds `SUPABASE_SERVICE_ROLE_KEY` which bypasses every RLS policy (`services/gateway/src/wobo_gateway/memory.py:101-107`); there is no access-logging code and no break-glass procedure anywhere in the tree | Either build access logging or delete the "Support access is a deliberate act and it is logged" claim from the live page |
| A13 | A breach-response runbook with the 72-hour clock | GDPR Art 33; DPDP s8(6) | NOT MET | `docs/legal/privacy-policy.md:188` promises notification "without undue delay"; `grep -ril "incident response\|breach" docs/` finds no runbook | Write a one-page runbook naming who declares, who notifies and by when |
| A14 | Data protection by design and by default | GDPR Art 25 | PARTIAL | Genuinely present: per-subject RLS on every learner table (`infra/supabase/migrations/0002_learner_operational_plane.sql:136-164`), consent tier derived server-side and never read from a request body (`consent.py:3-6`), IP addresses salted before they reach a log (`app.py:424-430`), the model persona forbidden from naming providers, no analytics or advertising SDK in the bundle (`grep -rn "posthog\|sentry\|gtag\|mixpanel" apps packages` → no matches). Absent: the default is maximum data collection, because the consent tier that would gate memory, voice and photos is never set (see B7) | Ship the consent gate; the rest of Art 25 is already the house style |
| A15 | Vendor/provider review cadence | GDPR Art 28(1) | NOT MET | `privacy-policy.md:184` claims "regular review of our providers"; no review record or cadence exists in the repo | Set a cadence or drop the claim |

## B. Lawful basis, notice and consent (UK/EU GDPR)

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| B1 | A lawful basis identified for each purpose | GDPR Art 6 | PARTIAL | The basis table exists at `docs/legal/privacy-policy.md:81-89` and maps contract / legitimate interests / consent / legal obligation onto four purpose groups. It is written at a level above the actual processing: no basis is recorded for the mind snapshot, the twin summary, the parent link, the festival calendar, or the transfer of prompts to model providers | Extend the table to the purposes in section I of this register, one row each |
| B2 | Legitimate interests assessment recorded | GDPR Art 6(1)(f), Recital 47 | NOT MET | `privacy-policy.md:86` says "We have recorded that balancing test and you can ask to see the summary". No LIA exists in the repo | Write the LIA, or delete the sentence claiming it exists |
| B3 | Article 8 age of digital consent respected | GDPR Art 8 | PARTIAL | The code encodes 13 as the account age and 18 as the consent age (`apps/web-pwa/src/screens/auth/age.ts:23-25`) and branches the sign-up on it (`age.ts:57-83`, `Auth.tsx:256-273`). But Art 8 ages run 13–16 by member state and the code has one global number; `childrens-privacy.md:32` records this as unresolved | Make the age table country-aware, keyed on the country already collected for pricing |
| B4 | Age is collected neutrally, without nudging | ICO AADC standard 3 | MET | A bare date field with the hint "I ask once, to know what a grown-up has to say yes to" (`apps/web-pwa/src/screens/auth/copy.ts:56-57`); no branch of the UI reveals which answer unlocks more before the answer is given (`Auth.tsx:400-408`) | — |
| B5 | The declared date of birth is stored, so the age gate survives a reinstall | GDPR Art 5(1)(d) accuracy; Art 8 | NOT MET | `profiles_cache.birthdate` exists (`infra/supabase/migrations/0006_wobo_rename_and_profile_fields.sql:8`) but no writer ever fills it: `syncProfile` sends only `display_name, grade, board, archetype_slot` (`packages/sdk/src/client.ts:109-114, 314-322`), and the sign-up screen keeps the date in React state and discards it (`Auth.tsx:161`) | Persist the birthdate at sign-up; without it the age gate is a one-time screen, not a property of the account |
| B6 | Consent is freely given, specific, informed, unambiguous, unbundled | GDPR Art 7, Art 4(11) | PARTIAL | The terms/privacy tick is never pre-ticked and links both documents (`Auth.tsx:432-444`). The per-feature parental consent screen specified word-for-word at `docs/legal/parental-consent.md:50-76` does not exist in the app | Build the parental notice screen; the copy is already written |
| B7 | Consent is recorded, and gates the features it is supposed to gate | GDPR Art 7(1); DPDP s6 | **NOT MET** | `consent_tier` is read on every capability call (`services/gateway/src/wobo_gateway/consent.py:155-166`, `app.py:249-254`) and **written by nothing**: `grep -rn "consent_tier" services packages apps` shows reads only, and `0014_subscriptions.sql:154` revokes the learner's update grant on the column. So every learner sits permanently on `un_elevated` and the only two capabilities that check the flag are `peakcut.evaluate` and `archetype.classify` (`registry.py:140`, `:160`). Memory (`learner_state.mind`), voice (`voice.py:433`), photo intake (`curriculum/own.py:285`) and the parent link (`parents.py:1031`) check no tier at all | Build a consent record — who consented, to what, when, how verified — and gate memory, voice, photos and sharing on it. This is the single biggest gap in the register |
| B8 | Consent is as easy to withdraw as to give | GDPR Art 7(3) | PARTIAL | The mail dials are one-tap and per-channel (`infra/supabase/migrations/0010_hospitality.sql:20-47`, `PUT /v1/me/mail-preferences`), and every mail carries a one-click stop link (`hospitality/tokens.py`). There is nothing to withdraw for memory, voice or photos, because nothing was ever asked | Follows B7 |
| B9 | Privacy notice is concise, transparent, intelligible, in clear plain language for a child | GDPR Art 12(1); AADC standard 4 | MET | Every legal document opens with an "in plain words" box, and `childrens-privacy.md:15-17` carries a second box addressed to the learner; the site renders them with a draft banner that states the document is not lawyer-reviewed and how many questions remain open (`apps/web-pwa/src/screens/legal/Legal.tsx:49-57`) | — |
| B10 | The notice is accurate about the shipped product | GDPR Art 5(1)(a) | **NOT MET** | `childrens-privacy.md:59-63` tells parents that before consent Wobo will not keep long-term memory, use voice, accept photographs or share with a parent. All four ship ungated (B7). `cookies.md:37-41` describes optional analytics, crash reporting and A/B categories behind a banner; none of the three exist and no banner exists (`grep -rin "cookie" apps/web-pwa/src` finds only links to the document) | Either build the gates or rewrite the documents to describe what actually ships. Publishing the stricter version and shipping the looser one is the worst of the two |
| B11 | Cookie / local-storage consent banner for non-essential storage | ePrivacy Art 5(3) | N/A **today**, and a documentation defect | Nothing non-essential is stored: no analytics or crash SDK is in the bundle (`grep -rn "posthog\|sentry\|gtag\|google-analytics\|mixpanel\|plausible\|amplitude" apps packages services` → no matches), and the CSP forbids third-party script origins other than jsdelivr (`vercel.json:23`). The app stores only `wobo-*` keys in localStorage (`apps/web-pwa/src/screens/You.tsx:249-253`) | `cookies.md:41-45, 62` describes a banner and three optional categories that do not exist. Cut them from the document until they do |
| B12 | Changes to the notice are announced with 30 days' notice and versions kept | GDPR Art 13(3) | NOT MET | `privacy-policy.md:198` promises it; there is no version history mechanism — the site renders whatever is in `docs/legal/*.md` at build time (`apps/web-pwa/src/screens/legal/docs.ts:24-28`) and older versions are unreachable | Keep dated copies under `docs/legal/history/` and route to them |

## C. The data-protection principles

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| C1 | Data minimisation | GDPR Art 5(1)(c); COPPA §312.7 | PARTIAL | Good: the mail preferences table refuses free text and takes only ISO codes and a bounded slug list (`0010_hospitality.sql:35-47`); the public Ask box strips emails, links and phone numbers from a visitor's question before anything else touches it (`ask_public.py:474-478`); IP addresses are fingerprinted before logging (`app.py:424-430`). Weak: `learner_threads.turns` stores the entire conversation with no cap or window (`0005_learner_state_threads_relay.sql:23-31`), and `learner.outbox.payload` stores every domain event in full, forever (`0002:117-127`) | Cap the thread and give the outbox a purge |
| C2 | Purpose limitation | GDPR Art 5(1)(b) | PARTIAL | The migrations are unusually disciplined about it — `0010_hospitality.sql:11-16` states the festival calendars are used for wishes and nothing else, and `0009_curriculum_review_offers.sql:52-54` requires the moderator queue to carry a keyed digest rather than a subject id. Nothing enforces purpose at the query layer, and the service role can read everything | Acceptable at this scale; record it in the ROPA (A3) rather than building enforcement |
| C3 | Storage limitation | GDPR Art 5(1)(e) | NOT MET | No retention job exists anywhere: `grep -rn "cron\|schedule" .github/workflows/ci.yml railway.json` → no matches, and the only scheduled endpoints are the two mail passes (`hospitality/jobs.py:840`, `:852`). Every row in section I lives until an erase that mostly does not reach it. The retention table at `privacy-policy.md:137-148` is entirely square-bracketed placeholders | Pick real periods, then write one sweep job. Voice ("deleted within [24 hours]") and photos ("within [30 days]") are the two the documents already commit to |
| C4 | Accuracy, and the ability to correct | GDPR Art 5(1)(d) | PARTIAL | A learner can edit name, class, board and the remembered facts item by item (`apps/web-pwa/src/store/mind.ts`, the You screen memory panel); mastery bands are derived and not directly correctable | Sufficient for the tutoring picture; note it in the ROPA |
| C5 | Integrity and confidentiality | GDPR Art 5(1)(f), Art 32 | PARTIAL | RLS on every learner table with `subject_id = auth.uid()` (`0002:136-164`, `0010:57-72`, `0011:106-125`, `0014:113-120`); JWT verification with a closed algorithm allowlist and no `none` (`auth.py:34-35, 156-205`); the dev-auth header seam refused outright under `ENV=prod` (`auth.py:73-86`); strict CSP, HSTS, `frame-ancestors 'none'`, camera and geolocation denied (`vercel.json:22-50`). Not present: the encryption-at-rest, key-rotation and access-logging claims on the public page (A12) | See A12 |
| C6 | Accountability — able to demonstrate compliance | GDPR Art 5(2) | NOT MET | Follows A3, A4, B2 and B7: there is no ROPA, no DPIA, no LIA and no consent record | The four documents above |

## D. Data subject rights — promised versus implemented

`docs/legal/privacy-policy.md:153-164` says "Most of this is a button in settings, under privacy
and data." One of the seven is a button.

| # | Right | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| D1 | Access / copy of the data | GDPR Art 15; DPDP s11 | NOT MET | No export or "see everything" route exists. `GET /v1/me` returns subject, plan, consent tier and today's budget only (`app.py:804-821`). The memory page shows the mind snapshot alone, not the attempts, sessions, canvas ink or mastery evidence | Build one `GET /v1/me/export`; the table list in section I is the spec |
| D2 | Rectification | GDPR Art 16 | PARTIAL | Name, class, board and each remembered fact are editable in the app; nothing else is | Say so in the policy, or widen it |
| D3 | Erasure | GDPR Art 17; DPDP s12(3) | PARTIAL | Two erase paths exist and both work (`POST /v1/me/erase` at `app.py:824-851` → `memory.py:158-232`, `:240-256`; `eraseSubjectRows` at `packages/sdk/src/supabase.ts:66-82`), wired to one "start over" control (`You.tsx:245-261`) and honest about failure (a partial erase returns 502 and names the store). They reach 6 of 22 tables. Section J is the gap list | See section J |
| D4 | Portability, machine-readable | GDPR Art 20 | **NOT MET** | Nothing in the product exports anything. `grep -rn "eraseRemoteData\|export" packages/sdk/src/client.ts` shows an erase seam and no export seam; the plan panel test at `apps/web-pwa/src/screens/you/plan.test.ts:545-550` records that an "Export everything" control was specified and deliberately removed because the panel never had one. `privacy-policy.md:159` and `parental-consent.md:96` both promise a download | One JSON endpoint reading the same table list as the erase path |
| D5 | Objection | GDPR Art 21 | NOT MET | No mechanism beyond writing to the support mailbox | Acceptable to handle by mail, but then the policy's "button in settings" sentence is wrong |
| D6 | Restriction of processing | GDPR Art 18 | NOT MET | No mechanism, and no state in the schema that could represent a restricted account | Add a flag the gateway honours, or state honestly that restriction is handled manually |
| D7 | Withdraw consent | GDPR Art 7(3) | PARTIAL | Only for mail. See B8 | Follows B7 |
| D8 | Not subject to solely automated decisions with legal or significant effect | GDPR Art 22 | **NOT VERIFIED — corrected 2026-09-04 after `_challenge.md` C13.** The three negatives below are true and none of them is the question: the product decides, with no human in the loop, what a child is taught next (`grade.attempt` marks, `mastery_cache.band` records the verdict, `curriculum/placement.ts` places). Whether a learning path is "similarly significant" for a child under the AADC and DPDP s9(3) is counsel's answer, recorded in the DPIA (A4), not an engineer's tick | The product makes no decision with legal or similarly significant effect: no grading for a school, no admissions, no pricing by behaviour (`Security.tsx:117` states this and the code has no such path). Profiling for teaching is real and disclosed at `privacy-policy.md:96` | — |
| D9 | Identity verification before answering a request | GDPR Art 12(6) | MET for the in-product path | Both erase paths key off the verified JWT subject and never off a body (`app.py:836-837`, `auth.py:208-222`) | — |
| D10 | Response within one month | GDPR Art 12(3) | NOT VERIFIED | `privacy-policy.md:36` commits to 30 days; there is no ticketing system in the repo to measure against | A support queue with timestamps |
| D11 | Rights exercisable free of charge | GDPR Art 12(5) | MET | `POST /v1/me/erase` is explicitly free and unmetered — "a data right that costs a learner their last turn of the day is not a right" (`app.py:827-829`), and `test_me_erase.py::test_erasing_is_not_a_way_to_refill_a_spent_day` holds the line both ways | — |
| D12 | A child's own rights are exercisable by the child | AADC; GDPR Recital 58 | MET | "Start over" sits on the You screen behind a confirm, in the learner's own hands, and Wobo will run it as an approved capability card (`apps/web-pwa/src/wobo/capabilities.ts:154-167`) | — |

**Verification run.** `cd services/gateway && uv run pytest -q tests/test_me_erase.py tests/test_consent.py`
→ `35 passed`. The erase path that exists is tested; the gaps in section J are gaps in scope, not
in correctness.

## E. India — Digital Personal Data Protection Act 2023

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| E1 | Verifiable parental consent for every Data Principal under 18 | DPDP s9(1) | **NOT MET** | The under-13 branch sends a magic link to the parent's address and stops there (`Auth.tsx:256-273`); the 13–17 branch offers the parent's address but proceeds without it (`age.ts:66-79`). Nothing verifies the recipient is an adult, nothing records a consent, and nothing gates a feature on one (B7). The intended methods are still a `[REVIEW]` at `parental-consent.md:38-40` | Build the parental notice page (`parental-consent.md` §3 is the copy), record the consent, and gate on it |
| E2 | Consent is the lawful basis, and notice accompanies it | DPDP s5–s6 | PARTIAL | Declared at `privacy-policy.md:90`; the itemised notice DPDP s5 requires is the parental-consent screen that does not exist | Follows E1 |
| E3 | Notice available in the Eighth Schedule languages | DPDP s5(3) | NOT MET | The legal set is English only (`ls docs/legal/` → eleven `.md` files, no translations); the app has a `language` preference but no translated legal copy | Translate at least the privacy notice and the parental consent notice for the launch states |
| E4 | No tracking or behavioural monitoring of a child | DPDP s9(3) | PARTIAL | No advertising or cross-site tracking exists at all — no third-party script origins in the CSP other than a code CDN (`vercel.json:23`), no analytics SDK in the tree, and `Security.tsx:115` states it publicly and is, on this point, true. But the product does build a persistent behavioural profile of the child (`learner_state.mind`, the twin summary, mastery evidence) and whether that is caught by s9(3) is unresolved (`childrens-privacy.md:34`) | Get counsel's answer on the tutoring profile; it is the one DPDP question that could change the product |
| E5 | No targeted advertising to children | DPDP s9(3) | MET | There is no advertising anywhere in the product, and no ad identifier is collected (`grep` for ad SDKs → no matches) | — |
| E6 | Data Protection Officer / person to answer questions, published | DPDP s5(1)(iii), s10 | PARTIAL | See A5 | — |
| E7 | Grievance redressal mechanism | DPDP s13 | PARTIAL | See A9 | — |
| E8 | Consent Manager registration, where required | DPDP s6(7) | NOT VERIFIED | `docs/legal/README.md:70` lists it as an open question for counsel | Counsel's answer |
| E9 | Breach notification to the Board and to affected principals | DPDP s8(6) | NOT MET | See A13 | — |
| E10 | Erasure on withdrawal of consent | DPDP s12(3) | PARTIAL | The erase path is real but incomplete (section J), and there is nothing to withdraw (B7) | Follows B7 and J |
| E11 | The right to nominate | DPDP s14 | NOT MET | Disclosed at `privacy-policy.md:170`; no mechanism exists | Handle by mail and say so, or build it |
| E12 | Restrictions on transfer to notified countries | DPDP s16 | NOT VERIFIED | `privacy-policy.md:132` defers to a notified list that did not exist when the document was written. Model calls go to US-hosted providers (`routing.py:92-106`) | Re-check once the list is notified |
| E13 | Reasonable security safeguards | DPDP s8(5) | PARTIAL | See C5 and A12 | — |

## F. United States — COPPA (under 13)

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| F1 | Verifiable parental consent before collection from an under-13 | 16 CFR §312.5 | **NOT MET** | The under-13 branch mails a magic link (`Auth.tsx:264-272`). Email-plus is not on the §312.5(b)(2) list for anything beyond internal use, and there is no second step, no record, and no gate. `parental-consent.md:38-40` marks the whole method question as open | Choose a method from the §312.5(b)(2) list, implement it, and record it |
| F2 | Direct notice to the parent, separate from the online privacy policy | §312.4(c) | NOT MET | The wording exists (`parental-consent.md:50-76`) and is not rendered anywhere in the app; `grep -rn "would like your permission" apps` → no matches | Build the screen and the confirming email |
| F3 | Participation not conditioned on more data than reasonably necessary | §312.7 | PARTIAL as designed, unverified as shipped | The design is right — `childrens-privacy.md:59-63` keeps teaching outside the consent gate and `age.ts:15-17` encodes "teaching is never gated" as a rule. Since no gate exists, the product currently collects everything from everyone, which fails the principle from the other direction | Follows B7 |
| F4 | Parent may review, refuse further collection, and delete | §312.6 | NOT MET | There is no parent-facing surface at all. The only parent route is the weekly-note link (`parents.py:1031-1145`), which shows a parent nothing and gives them accept, decline and stop only | Build parent controls, or state honestly that a parent must email support |
| F5 | Retention only as long as reasonably necessary, then deletion | §312.10 | NOT MET | See C3 | — |
| F6 | Confidentiality, security and integrity of children's data | §312.8 | PARTIAL | See C5 | — |
| F7 | Disclosure of third parties to whom data is disclosed | §312.4(d)(2) | PARTIAL | Categories are published (`privacy-policy.md:106-117`), names are not; whether categories suffice is flagged at `privacy-policy.md:118` | Follows A11 |
| F8 | Safe harbour / operator listing obligations | §312.11 | N/A | Not a member of an FTC-approved safe harbour programme and not required to be | — |

## G. California and other US states

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| G1 | Notice at collection | CCPA §1798.100(a); CPRA regs §7012 | PARTIAL | The collection table exists (`privacy-policy.md:41-77`) and a plain-language version is live on the security page (`Security.tsx:74-112`), but there is no notice at or before the point of collection in the sign-up flow beyond a link | Add the categories and purposes to the sign-up screen, or link the notice at collection there |
| G2 | Categories table in the regulation's own shape | CPRA regs §7011(e) | NOT MET | The policy's table is written by purpose, not by the statutory categories, and `privacy-policy.md:184` flags this as open | Restate section 2 in the statutory categories once counsel confirms |
| G3 | Right to know, delete, correct | §1798.100, .105, .106 | PARTIAL | Same as D1–D3 | — |
| G4 | Right to opt out of sale or sharing | §1798.120 | N/A | Nothing is sold or shared for cross-context behavioural advertising: no ad SDK, no ad identifier, no third-party analytics (`grep` → no matches), stated at `privacy-policy.md:104` | — |
| G5 | Opt-in for sale/sharing of a minor's data under 16 | §1798.120(c) | N/A | Follows G4 — there is nothing to opt into | — |
| G6 | Right to limit use of sensitive personal information | §1798.121 | PARTIAL | Voice is arguably SPI and is processed live to Google (`voice.py:1-15`); `privacy-policy.md:77` flags the treatment of voice recordings as open. Nothing is used beyond providing the service | Get counsel's view on voice as SPI, then either add the limit control or record why it is unnecessary |
| G7 | The eraser button for content posted by a minor | Cal. Bus. & Prof. Code §22581 | **PARTIAL — corrected 2026-09-04 after `_challenge.md` C16.** The row's own evidence describes the statute's fact pattern: content a minor submitted becomes visible to others and cannot be withdrawn | There is no public posting: no learner-to-learner messaging and no publication (`childrens-privacy.md:81`). The one outward path is offering a syllabus to the registry, which strips the owner and keeps only a keyed digest (`0009_curriculum_review_offers.sql:13-15, 52-54`) — but an accepted offer becomes a `community` framework with no route back for the learner who offered it | Give an offerer a way to withdraw an accepted offer |
| G8 | Universal opt-out signal (GPC) honoured | CPRA regs §7025 | N/A today | Nothing to opt out of (G4). `cookies.md:54` promises GPC is honoured, which is a promise about a mechanism that does not exist | Drop the sentence until there is something for GPC to switch off |
| G9 | Non-discrimination for exercising a right | §1798.125 | MET | The erase route is free and unmetered by design (`app.py:827-829`) and nothing in the product varies by whether a right was used | — |
| G10 | Other state laws (VA, CO, CT, UT, TX…) | State privacy acts | NOT VERIFIED | `privacy-policy.md:174` covers them with one sentence and a `[REVIEW]` | Counsel, once launch markets are decided |

## H. International transfers

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| H1 | Transfers to model providers identified | GDPR Ch V | **PARTIAL — corrected 2026-09-04 after `_challenge.md` C11: jsDelivr is missing from this list.** `apps/web-pwa/src/engines/cs/pyodide.ts:13-14` fetches ~10 MB of executable WASM from `https://cdn.jsdelivr.net` at runtime (allowed by `vercel.json:23` in both `script-src` and `connect-src`), so a third-country CDN receives a child's IP address and user agent. It is in no legal document (`grep -rniE "jsdelivr" docs/legal/` → no matches, re-run 2026-09-04). The model-provider half below is correct | Prompts go to OpenAI, Anthropic and Google (`routing.py:92-106`); voice frames are relayed live to Google's `generativelanguage.googleapis.com` (`voice.py:76-79`); a photographed syllabus page is sent as a base64 data URL to the image-capable tier (`curriculum/own.py:258-276`) | — |
| H2 | An Article 46 mechanism (SCCs / UK addendum / IDTA) in place per provider | GDPR Art 46 | NOT VERIFIED | `privacy-policy.md:131` says SCCs are relied on; no executed SCC is in the repo | Collect and file each one |
| H3 | Transfer risk assessments | Schrems II; EDPB Rec 01/2020 | NOT MET | Claimed at `privacy-policy.md:131`; none exists | Write one per provider, or delete the claim |
| H4 | Storage regions stated accurately | GDPR Art 13(1)(f) | PARTIAL | The policy leaves the region as the placeholder `[regions]` (`privacy-policy.md:129`) while the live public page states "Database and storage — INDIA, WITH EU FOR EU FAMILIES" (`Security.tsx:188-190`). The repo has one Supabase project (`vercel.json:10`) and no EU project | Either build the EU residency the page claims, or correct the page. A specific regional claim that is not true is worse than the placeholder |
| H5 | Onward transfer by providers disclosed | GDPR Art 44 | NOT VERIFIED | Depends on the DPAs at A10 | — |
| H6 | India-specific transfer restrictions observed | DPDP s16 | NOT VERIFIED | See E12 | — |

## I. The personal-data inventory

Every column in every table that holds something about a person, with the basis it would be
processed under and the retention that actually applies today. **"Retention: indefinite" below is
a statement of fact about the code, not a policy** — there is no retention job (C3).

### `learner` schema (Supabase, one project)

| # | Table / column | What it is about a person | Basis (as intended) | Retention today | Erased by |
|---|---|---|---|---|---|
| I1 | `profiles_cache.subject_id` | the pseudonymous identifier for the learner | contract | indefinite | SDK path only |
| I2 | `profiles_cache.display_name` | the child's name | contract | indefinite | SDK path only |
| I3 | `profiles_cache.grade`, `.board` | class and curriculum | contract | indefinite | SDK path only |
| I4 | `profiles_cache.archetype_slot` | a learner-type label derived from behaviour | legitimate interests / consent | indefinite | SDK path only |
| I5 | `profiles_cache.consent_tier` | the consent state | consent record | indefinite; **never written** (B7) | SDK path only |
| I6 | `profiles_cache.birthdate` | date of birth | Art 8 / s9 age determination | column exists, **never written** (B5) | SDK path only |
| I7 | `profiles_cache.interests` | what the child likes | consent | indefinite | SDK path only |
| I8 | `profiles_cache.plan` | paid tier | contract | indefinite | SDK path only |
| I9 | `sessions.subject_id, surface, started_at, ended_at` | when and on what device the child used the product | legitimate interests | indefinite | **nothing** |
| I10 | `attempts.subject_id, node_id, item_id, response, correct, aided, independence_signal, latency_ms` | every answer the child gave, verbatim, and how fast | contract (tutoring) | indefinite | **nothing** |
| I11 | `canvas_state.subject_id, node_id, expression, strokes` | the child's handwriting and working on the board | contract | indefinite | **nothing** |
| I12 | `mastery_cache.subject_id, node_id, band, scope, evidence` | what the child understands, with the evidence trail | contract | indefinite | SDK path only |
| I13 | `meter_state.subject_id, date, budget_*, peak_detected, day_had_real_win` | daily usage pattern | legitimate interests | indefinite | **nothing** |
| I14 | `notifications.subject_id, type, scheduled_for, sent_at, archetype_variant` | what was sent to the child and in which behavioural variant | consent | indefinite | **nothing** |
| I15 | `outbox.subject_id, event_type, payload, occurred_at` | **a full copy of every domain event**, including its payload | legitimate interests (delivery) | indefinite, never purged after publish | **nothing** |
| I16 | `learner_state.xp, streak_days, last_active_day, completed_topics, topic_progress, awarded_once, streak_freezes, broken_streak` | the child's record of work and habit | contract | indefinite | SDK path only |
| I17 | `learner_state.mind` | **the dossier**: facts the child told Wobo, preferences, twin marks | consent (in the documents) | until erase | `/v1/me/erase` patches it to `{}` (`memory.py:167-190`) |
| I18 | `learner_threads.turns` | **the entire conversation**, unbounded | contract / consent | until erase | both paths delete the row |
| I19 | `mail_preferences.learner_id, sunday_note, wins, festivals` | mail choices | consent | until erase | `/v1/me/erase` |
| I20 | `mail_preferences.festival_calendar` | which festivals the family keeps — **a proxy for religion, GDPR Art 9 / DPDP sensitive** | explicit consent | until erase | `/v1/me/erase` |
| I21 | `mail_preferences.country, region, timezone` | where the family lives, to region granularity | consent | until erase | `/v1/me/erase` |
| I22 | `parent_links.parent_email` | **a third party's email address**, typed by a child | see section M | until revoked or erased; a revoked row is forced to null by a check constraint (`0011:79-80`) | `/v1/me/erase` |
| I23 | `parent_links.parent_email_hash` | keyed HMAC of the parent's address | legitimate interests (dedupe, abuse limits) | survives revocation by design | `/v1/me/erase` deletes the row |
| I24 | `parent_links.learner_name` | the child's first name, shown to the parent | consent | until erase | `/v1/me/erase` |
| I25 | `parent_links.timezone, status, invited_at, linked_at, revoked_at, revoked_by, invite_token_hash, unsubscribe_url` | the link's lifecycle | consent | until erase | `/v1/me/erase` |
| I26 | `subscriptions.learner_id, plan, status, origin, current_period_end, started_at, cancelled_at` | what the family bought | contract / legal obligation (accounting) | indefinite | **deliberately not erased** (`0014:31-37`) — the reasoning is recorded and defensible |
| I27 | `content_cache.*` | nothing about a person | — | — | N/A |

### `curriculum` schema

| # | Table / column | What it is about a person | Basis | Retention today | Erased by |
|---|---|---|---|---|---|
| I28 | `frameworks.owner_subject_id` + the name of a personal framework | that this child uploaded this syllabus | contract | indefinite | **nothing** |
| I29 | `versions`, `nodes`, `provenance` for a personal framework | the content of the child's own syllabus document | contract | indefinite | **nothing** |
| I30 | `overlays.subject_id, patch, last_report` | the child's own edits to a syllabus | contract | indefinite | **nothing** |
| I31 | `pins.subject_id, framework_id, version_id` | what the child is studying | contract | indefinite | **nothing** |
| I32 | `discovery_jobs.query, requested_by` | **what the child typed** into the search, tied to their id | legitimate interests | indefinite | **nothing** |
| I33 | `review_queue.flagged_by` | the subject id of whoever flagged | legitimate interests | indefinite | **nothing** |
| I34 | `review_queue.offered_by_hash, note, payload` | a keyed digest of the offerer plus their note; the payload carries the framework shape and hash, not the document pages (`0009:13-15, 52-57`) | consent (offering is a choice) | indefinite | **nothing** |

### Outside the two schemas

| # | Store / field | What it is about a person | Basis | Retention today | Erased by |
|---|---|---|---|---|---|
| I35 | `auth.users` (Supabase-managed): email, phone, password hash, provider identity, `raw_user_meta_data`, sign-in timestamps | the account itself | contract | indefinite | **nothing** — `grep -rn "auth/v1/admin\|deleteUser" services packages apps` → no matches. There is no account deletion in this product |
| I36 | Storage buckets `media-nuggets`, `generated-assets`, `remotion-renders` (`0003_realtime_and_storage.sql:6-13`) | may hold learner-associated media | contract | indefinite | **nothing** |
| I37 | Mail log at `MAIL_LOG_PATH` (`email.py:96-110, 345-352`) | hashed recipient, mail kind, idempotency key, timestamp | legitimate interests (no double-send) | indefinite, file-backed | **nothing** |
| I38 | Board turn cache (`board/stream.py:66`) | the child's words and Wobo's reply, in process memory | contract | 180 s TTL, 512 turns | `/v1/me/erase` (`memory.py:251`) |
| I39 | Voice grants (`voice.py:81, 247`) | a token bound to the subject | contract | 300 s TTL | `/v1/me/erase` (`memory.py:254`) |
| I40 | Budget and rate-limit counters | keyed on `sub:<subject>` or, for anonymous learners, on the **raw IP address** (`app.py:444-459`) | legitimate interests | in-process, per window | not erased, expires |
| I41 | Structured gateway logs | salted IP fingerprint (`app.py:424-430`), subject id, capability, model, latency, tokens (`telemetry.py:19-31`) | legitimate interests | as the platform retains them | NOT VERIFIED — Railway's retention is not set in this repo |
| I42 | Local storage on the device, `wobo-*` keys | mind, progress, drafts, preferences | contract / consent | until cleared | "start over" clears every `wobo-*` key (`You.tsx:248-255`) |

**Count: 22 durable stores hold personal data — 13 `learner` tables (every one except
`content_cache`), 7 `curriculum` tables, `auth.users`, and the three storage buckets counted as
one. Six of the 22 are reached by an erase. The mail log, the in-process caches and the platform
logs (I37–I42) are on top of that.**

## J. Erasure, checked against the full table list

`POST /v1/me/erase` (`app.py:824`, `memory.py:158-232`, `:240-256`) reaches: `learner_state.mind` (patched to
`{}`), `learner_threads`, `mail_preferences`, `parent_links`, the in-process board turns and the
voice grants. `eraseSubjectRows` (`packages/sdk/src/supabase.ts:46-53`) reaches: `learner_state`,
`learner_threads`, `profiles_cache`, `mastery_cache`. `You.tsx:245-261` calls both, then clears the
device.

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| J1 | Erasure is honest about what it did | GDPR Art 12; the product's own rule | MET, and unusually well done | Every store is attempted so one failure cannot hide the rest; the counts returned are what came back, not what was intended; a partial erase is a 502 that names the refusing store (`memory.py:16-21`, `app.py:840-850`); the queued retry survives a reload and a flight-mode wipe (`store/mind.ts:289-345`) | — |
| J2 | `learner.attempts` erased | Art 17 | **NOT MET** | Not in `ERASABLE_TABLES` (`supabase.ts:46-53`) and not in `memory.py`. Every answer the child ever gave survives an erase | Add to both lists |
| J3 | `learner.canvas_state` erased | Art 17 | **NOT MET** | Same. The child's handwriting survives | Add to both lists |
| J4 | `learner.sessions` erased | Art 17 | NOT MET | Same | Add to both lists |
| J5 | `learner.meter_state` erased | Art 17 | NOT MET | Same | Add to both lists |
| J6 | `learner.notifications` erased | Art 17 | NOT MET | Same | Add to both lists |
| J7 | `learner.outbox` erased or purged | Art 17 | **NOT MET** | The outbox holds a full copy of every event payload and has a select-only policy for `authenticated` (`0002:162-163`), so only the service role could clear it and nothing does | Purge published rows on a schedule, and delete the subject's rows on erase |
| J8 | `curriculum.overlays`, `.pins`, `.frameworks` (personal), `.versions`, `.nodes`, `.provenance` erased | Art 17 | **NOT MET** | The whole `curriculum` schema grants `authenticated` select only (`0008:395-397`), so the client cannot erase it and the gateway does not try. A child's uploaded syllabus and their edits to it survive an erase | Extend `memory.py` to the curriculum tables with the service role |
| J9 | `curriculum.discovery_jobs` erased or de-linked | Art 17 | NOT MET | `query` (what the child typed) and `requested_by` survive | Null `requested_by` on erase at minimum |
| J10 | `curriculum.review_queue` offers handled | Art 17 | PARTIAL | `offered_by_hash` is a server-keyed digest and not recomputable by a moderator (`0009:52-54`), which is the right design; but an offer the learner made is not withdrawable | See G7 |
| J11 | Storage bucket objects erased | Art 17 | NOT MET | No bucket is touched by either erase path | Add a bucket sweep keyed on the subject |
| J12 | `learner.subscriptions` retained | Art 17(3)(b) | **NOT MET — corrected 2026-09-04 after `_challenge.md` C6: the table does not exist.** `list_migrations` on project `keepraxqagzgjrrweryt` (re-run 2026-09-04) returns 8 versions — `0001, 0006, 0007, 0008, 0009, 0010, 0011, 0012` — and `list_tables` over `learner` and `curriculum` returns 22 tables with **no `subscriptions`**. Migrations `0013` and `0014` have never been applied, so the reasoning below is a decision about SQL that has never run | `0014_subscriptions.sql:31-37` records the decision and the reason (a record of money taken, and erasing it would end a paid period with no refund). This is a defensible retention, and the fact that it is written down is what makes it defensible | — |
| J13 | The mail log erased | Art 17 | NOT MET | The hashed recipient and send history survive (`email.py:345-352`) | Either purge on erase or record it as a legitimate-interest retention with a period |
| J14 | The account itself deletable | Art 17; COPPA §312.6; the product's own promise | **NOT MET** | `privacy-policy.md:158` and `Security.tsx:81` both offer "delete your account". No code deletes an `auth.users` row (I35). "Start over" empties some data and leaves the account, its email and its password standing | Add a service-role admin delete behind the same confirm |
| J15 | Backup erasure within a stated window | Art 17; `privacy-policy.md:148` | NOT VERIFIED | The policy promises removal from backups within `[90 days]` (`privacy-policy.md:148`); Supabase backup retention is not configured in this repo | Read the project's backup settings and write the real number into the policy |
| J16 | The erase control is easy to find, and not behind a retention argument | AADC; `parental-consent.md:103` | MET | It is a control on the You screen behind one confirm, with no retention plea (`You.tsx:237-261`) | — |

## K. Portability

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| K1 | A learner can export their data | GDPR Art 20 | **NOT MET** | No route, no seam, no button. `plan.test.ts:545-550` records that the "Export everything" control was cut from the spec because nothing implemented it | Build `GET /v1/me/export`, service role, keyed on the door's subject, returning JSON over the tables in section I |
| K2 | The export is in a structured, commonly used, machine-readable format | Art 20(1) | NOT MET | Follows K1 | JSON is sufficient |
| K3 | A parent can export the child's data | COPPA §312.6(a); `parental-consent.md:96` | NOT MET | There is no parent surface at all (F4) | Follows K1 and F4 |
| K4 | The promise is made publicly | — | **This is the risk** | `privacy-policy.md:13` ("download it"), `:159`, `childrens-privacy.md:13`, `:73`, `parental-consent.md:96` all promise a download, on pages live at `heywobo.com/legal/*` | Build it, or cut the sentence from five documents |

## L. What is sent to model providers

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| L1 | Providers are identified internally | GDPR Art 28 | **PARTIAL — corrected 2026-09-04 after `_challenge.md` C11.** The model providers below are identified; **jsDelivr is not** — see H1 | OpenAI, Anthropic, Google Gemini, routed by tier and never pinned at a call site (`routing.py:92-113`, `wobo.py:539-560`) | — |
| L2 | Nothing identifying is sent with a prompt | The claim at `Security.tsx:194` | **NOT MET — the most serious finding in this register** | `_dossier()` builds a block containing the learner's **name** ("address them by name naturally"), **age**, class, board, the twin summary, mastery highlights and up to twelve **remembered personal facts in the child's own words**, and it rides **every turn** (`wobo.py:880-915`, composed into the prompt at `:1118`) | Either stop sending the name and facts, or replace the sentence "Answer the question without ever knowing whose it is" on the live page with what actually happens |
| L3 | Voice audio to a provider | GDPR Art 44; the voice notice | PARTIAL | Frames are relayed live to Google Gemini through the gateway so the key never reaches the client (`voice.py:1-15, 76-79`); nothing is stored server-side. But there is no consent gate on it (B7) and `Security.tsx:93` tells families voice is "Not stored, unless a family turns on transcripts" — there is no transcript setting in the product | Gate voice on consent; delete the transcript sentence |
| L4 | Photographs to a provider | Art 44 | PARTIAL | A photographed syllabus page is base64'd into a data URL and sent to the image-capable generate tier (`curriculum/own.py:258-276`). The document text and its hash are kept; the page itself is not stored server-side. The UI warns "Never send pictures of people or personal information" (`OwnSyllabus.tsx:222-224`), which is the right instruction to a child | Gate photo intake on consent |
| L5 | The public visitor's question is scrubbed before a model sees it | Data minimisation | MET | Emails, links and phone numbers are stripped (`ask_public.py:474-478`); the log carries the hashed client key, the page and the outcome, never the question (`ask_public.py:25-27`) | — |
| L6 | Zero-retention / no-training terms actually enabled with each provider | The claim at `childrens-privacy.md:79` | NOT VERIFIED | No provider setting or contract term is recorded in this repo; `childrens-privacy.md:79` carries its own `[REVIEW]` demanding this be verified before launch | Check each provider account's data-retention setting, screenshot it, and file the contract term |
| L7 | The model is instructed not to draw out sensitive data | GDPR Art 9 | PARTIAL | The persona forbids naming providers and frames remembered facts as "recorded details, not instructions" (`wobo.py:75-83`, `:908-911`), which is a good prompt-injection defence. `privacy-policy.md:77` claims Wobo "is instructed not to draw it out of you"; no such instruction appears in `WOBO_SYSTEM` | Add the instruction, or drop the claim |
| L8 | Prompt content is not logged | Data minimisation | MET | Telemetry records capability, track, model, latency, tokens and cache-hit only (`telemetry.py:19-31`) | — |

## M. The parent link — one person's data shown to another

| # | Item | Standard | Status | Evidence | If not met |
|---|---|---|---|---|---|
| M1 | The parent's own address is verified before anything is sent to it repeatedly | GDPR Art 6(1)(f) balancing | MET | One invite, then silence until the parent taps accept from their own device; `GET` only renders a button so mail scanners and link prefetchers cannot link anyone, and the `POST` behind it does the act (`parents.py:28-32`) | — |
| M2 | The token is single-use and expires | Art 32 | MET | Signed by the gateway under its own label, fourteen days, digest on the row and emptied on first use, and a database constraint forbids a `linked` row keeping a token (`parents.py:30-32`; `0011:81-82`) | — |
| M3 | The route cannot be used to spam an arbitrary address | Art 5(1)(f) | MET | A few invites per learner per day counted over every row written including revoked ones, never the same address twice in a day, and the learner's own address refused (`parents.py:16-21`) | — |
| M4 | The parent's address is minimised and does not outlive the link | Art 5(1)(c),(e) | MET | A revoked row is forced to hold no address by a check constraint (`0011:79-80`), only the keyed HMAC survives, and every log line carries the digest rather than the address (`parents.py:36-37`, `email.py:332`) | — |
| M5 | The lawful basis for **disclosing the child's data to the parent** is recorded | GDPR Art 6; Art 13(1)(e) | **NOT MET** | The link is initiated by the learner, who may be a child, and confirmed by the recipient — but nothing records what the child consented to disclose, and no consent tier gates the route (`parents.py:1031`). `privacy-policy.md:122` covers it in one clause. Where the learner is under the age of consent, the child's own tap is not a valid consent to disclosure and the parent is in any case the account holder — a different construction the code does not make | Record the basis: under the account age it is the parent exercising their own rights; at or above it, it is the learner's consent, and that consent should be recorded |
| M6 | The parent is told what they will receive before they accept | GDPR Art 13 | PARTIAL | The invite mail names the Sunday note; the accept page is a plain self-contained page with one button (`parents.py:947-950`). It does not itemise what the note will contain about the child | Put the contents on the accept page — the note carries XP, topics touched, minutes and focus areas (`email_templates.py:530-577`) |
| M7 | Either side can end it, at once | Art 7(3); Art 21 | MET | The learner from the You screen (`DELETE /v1/me/parent-link`), the parent from "Not me", and an unanswered invite expires and is replaced (`parents.py:27-29`; `0012_parent_links_expired.sql`) | — |
| M8 | The child is told when the parent declined | Transparency | MET | The row records `revoked_by = 'parent'` and the You screen reads it (`parents.py:22-25`; `0011:135-137`) | — |
| M9 | The weekly note is proportionate and not surveillance | AADC standard 9 (profiling), standard 12 | PARTIAL | The note is a summary — XP, topics touched, minutes, focus (`email_templates.py:530-577`) — not a transcript, which is the right choice. It is nonetheless a parent monitoring a teenager who may be old enough to consent for themselves, and nothing tells the learner each time a note goes out | Show the learner the note that was sent |
| M10 | A parent link is gated on age/consent | DPDP s9; COPPA §312.5 | NOT MET | No tier check on the route (`parents.py:1031-1063`), and `childrens-privacy.md:63` promises no sharing "including a parent link" before consent | Follows B7 |

## N. Public claims measured against the shipped product

The owner has already caught this repository claiming a SOC 2, an ISO 27001 and a penetration test
it never had. These are the claims that are currently live and are not yet true. They are listed
separately because a false privacy claim to families is enforceable in a way that a missing feature
is not.

| # | Claim, and where it is live | Status | Evidence | If not met |
|---|---|---|---|---|
| N1 | "AI model providers — answer the question without ever knowing whose it is" (`Security.tsx:194`, live at `/security`) | **FALSE** | The name, age and remembered facts ride every prompt (L2) | Correct the page today; it is one string |
| N2 | "Voice — not stored, unless a family turns on transcripts" (`Security.tsx:93`) | MISLEADING | Voice is not stored, which is true; there is no transcript setting anywhere in the product | Cut the second clause |
| N3 | "Least privilege for people. No standing access to a learner's data. Support access is a deliberate act and it is logged" (`Security.tsx:164-165`) | UNSUPPORTED | The gateway holds a service-role key that bypasses RLS; no access log exists (A12) | Build it or cut it |
| N4 | "AES-256 at rest… keys managed by the hosting provider and rotated" (`Security.tsx:152-153`) | NOT VERIFIED | True of Supabase by default, but nothing in this repo evidences it | Cite the provider's own statement in the page, or check the project settings and record the check |
| N5 | "Database and storage — INDIA, WITH EU FOR EU FAMILIES" (`Security.tsx:188-190`) | NOT VERIFIED, probably FALSE | One Supabase project is configured (`vercel.json:10`); no EU project exists in the repo | Correct to the real regions |
| N6 | The "scheduled" list — penetration test, break-glass logging with monthly review, SOC 2 Type I then II, ISO 27001 readiness (`Security.tsx:173-179`) | ACCEPTABLE **only** because it is labelled as scheduled | The framing is honest and the earlier false-claim problem is fixed here | Keep the label; never move a row out of it without the certificate |
| N7 | "Train on a child without consent — off by default, explicit to turn on" (`Security.tsx:119-122`) | MISLEADING | There is no training setting in the product at all. The sentence implies a control that does not exist, and reads as though training on a child is available if switched on | Rewrite as "we never train on a child's data" — which is what the contracts are supposed to say (L6) |
| N8 | "Erase memory, keep progress, or erase all" (`Security.tsx:88`) | PARTIAL | "Erase memory, keep progress" is real and well built (`memory.py:19-22`). "Erase all" leaves 16 of 22 stores and the account itself (section J) | Follows J |
| N9 | "You can see what Wobo remembers about you, change it, download it, and delete it" (`privacy-policy.md:13`, live at `/legal/privacy`) | PARTIAL | See, change and (partly) delete are real. Download is not (K1) | Follows K |
| N10 | The legal set publishes as a lawyer-unreviewed draft | HONEST, and correctly handled | `README.md:3` forbids publication before the checklist is complete, and the site nonetheless renders the documents — but with a banner stating the draft date and how many counsel questions remain unanswered, and with the `[REVIEW]` notes stripped from the reader's view (`Legal.tsx:49-57`, `markdown.ts:166-168`, `docs.ts:24-28`). 106 `[REVIEW]` markers remain across eleven documents (`grep -c REVIEW docs/legal/*.md`) | Keep the banner. Do not publish a version without it |
| N11 | Sitemap advertises the legal and security pages to search engines | MET | 60 URLs including `/security` and every `/legal/*` slug (`apps/web-pwa/public/sitemap.xml`, `screens/states/routes.ts:33, 38, 83-85`) | — |

## O. Items considered and not applicable

| # | Item | Why N/A |
|---|---|---|
| O1 | Advertising identifiers, ad-tech consent strings, TCF | No advertising exists anywhere in the product, and no ad SDK is in the bundle |
| O2 | Selling or sharing personal data | No such path exists; the company is paid by families |
| O3 | Learner-to-learner messaging, moderation of user-to-user contact | There is no chat between users (`childrens-privacy.md:81`) |
| O4 | Publication of user content | Nothing a child makes is published; the one outward path is an offered syllabus, owner-stripped (G7) |
| O5 | Biometric age assurance | Not used, and stated as not used (`childrens-privacy.md:47`) |
| O6 | Precise location | Not collected; `Permissions-Policy: geolocation=()` in `vercel.json:38-40` |
| O7 | FERPA and US state student-privacy laws | No school deployment exists yet; the school scenario is documented and flagged (`childrens-privacy.md:106`). Becomes live the day a school signs |
| O8 | Employee / HR data | The company has no such processing in this product |
| O9 | Cross-device advertising graph, data brokers | None |

---

## Counts

140 numbered items, excluding the 42 rows of the section I inventory, which is a record rather
than a set of obligations. The five labels used in section N (FALSE, MISLEADING, UNSUPPORTED,
ACCEPTABLE, HONEST) are folded into the five statuses below: a claim that is false, misleading or
unsupported counts as NOT MET.

| Status | Count |
|---|---|
| MET | 25 |
| PARTIAL | 36 |
| NOT MET | 50 |
| N/A | 15 |
| NOT VERIFIED | 14 |

## What cannot be checked from this repository

- Whether the published mailboxes exist and are answered (A6).
- Whether any DPA, SCC or no-training term has been signed with OpenAI, Anthropic, Google, Supabase,
  Railway, Vercel or the mail provider (A10, H2, L6).
- The Supabase project's actual region, encryption and backup-retention settings (N4, N5, J15).
- Railway's log retention (I41).
- Whether the entity, the DPO requirement, the Art 27 representatives and the Consent Manager
  registration are legally required (A2, A5, A7, A8, E8).
- Every jurisdiction question the legal set has already tagged: 106 `[REVIEW]` markers across the
  eleven documents, each naming the statute to confirm.

## The order I would fix them in

1. **N1** — one string on a live page that misdescribes what happens to a child's name. Today.
2. **B7** — build the consent record and gate memory, voice, photos and the parent link on it.
   Everything in E1, F1, F3, B8, B10, D7, L3, L4 and M10 collapses into this one piece of work.
3. **J2–J11, J14** — finish the erase and add account deletion. The list is section I.
4. **K1** — the export. It is the same table list as the erase, read instead of deleted.
5. **B5** — persist the birthdate, or the age gate is theatre after the first screen.
6. **C3** — one retention sweep, and real numbers in `privacy-policy.md` §7.
7. **A3, A4, B2** — the ROPA, the DPIA and the LIA. Section I is most of the first one already.
8. **N2, N3, N5, N7** — the remaining unsupported sentences on the security page.
