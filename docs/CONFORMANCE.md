# The conformance register

**What this is.** Every standard this product was measured against, item by item, with what it meets
and what it does not. Seven domain registers were written on 2026-09-04 by seven separate passes over
the code; an eighth pass challenged their ticks. This document assembles them and states the answer.

**The one rule.** Nothing is ticked without evidence. Every status here traces to a row in a domain
file, and every domain row carries a `file:line` or a command and its real output. Where something
could not be checked, it says NOT VERIFIED and names the check that would settle it. An honest
unknown is recorded as a finding, not rounded up.

**What this is not.** Not an audit. Not a certification. Not a penetration test. Not a legal opinion.
See *What we deliberately do not claim* at the end, and never move a line out of it without the
certificate in hand.

---

## The answer

**The engineering underneath this product is genuinely good, and the promises printed on top of it
are ahead of what it does.** The parts a competent engineer would look at first hold up under
scrutiny: authentication, access control, row isolation, injection defence, prompt fencing, the
verified number law on the board, type discipline with zero suppressions in 140,000 lines. Application
security scores 76 MET against 10 NOT MET, and the challenge pass attacked ten of those ticks and broke
none of the important ones. What is not sound is the distance between the published word and the
shipped code. A help centre tells a child to use a flag control that does not exist. A security page
tells families that model providers answer "without ever knowing whose it is" while the child's name,
age and remembered facts ride every prompt. A children's privacy notice promises no memory, no voice,
no photographs before consent, and there is no consent mechanism in the product at all. Four legal
documents publish claims nobody has reviewed. Two of the fourteen database migrations have never been
applied, so a conformance claim that rested on one of them was a claim about SQL that has never run.
Underneath that sits an operational hole: nothing tells anyone when it breaks, no spend ceiling exists
anywhere, no backup restore has ever been rehearsed, and CI is red while production serves. **This is
not a product with bad foundations. It is a product whose foundations are further along than its
paperwork, its operations and its honesty controls, and the gap is now the risk.**

For a product used by children, the three that would hurt a family first are: the missing crisis
classifier (a fifteen phrase keyword list that returns "ok" for `my dad hits me`), the missing consent
gate, and the flag control that a child is told to use and cannot find.

---

## Counts by domain

Counted mechanically from the seven domain files after the challenge corrections were applied.
Reproduce with the script at the end of this document.

| Domain | MET | PARTIAL | NOT MET | N/A | NOT VERIFIED | Items |
|---|---|---|---|---|---|---|
| [Application security](conformance/application-security.md) | 76 | 31 | 10 | 12 | 5 | 134 |
| [Content and child safety](conformance/content-and-safety.md) | 62 | 29 | 21 | 2 | 9 | 123 |
| [Testing and quality](conformance/testing-and-quality.md) | 62 | 18 | 41 | 8 | 7 | 136 |
| [Reliability and performance](conformance/reliability-and-performance.md) | 51 | 24 | 29 | 8 | 11 | 123 |
| [Supply chain and operations](conformance/supply-chain-and-operations.md) | 41 | 17 | 55 | 6 | 7 | 126 |
| [Accessibility](conformance/accessibility.md) | 39 | 29 | 11 | 3 | 6 | 88 |
| [Privacy and children](conformance/privacy-and-children.md) | 21 | 39 | 51 | 14 | 15 | 140 |
| **Total** | **352** | **187** | **218** | **53** | **60** | **870** |

Read the shape rather than the score. Application security is 57 % MET; privacy is 15 % MET. That is
not seven domains averaging out to "fine". It is one product that was built carefully and documented
optimistically, and the domains that measure *what was built* pass while the domains that measure
*what was promised, operated and proved* do not.

Two counting notes, because a number nobody can reproduce is a number nobody should trust.
Accessibility is counted here by register row (88); its own file also rolls up to 56 WCAG 2.2 Level A
and AA success criteria at 26 MET / 19 PARTIAL / 4 NOT MET / 3 N/A / 4 NOT VERIFIED, and both numbers
are useful. Privacy folds its section N labels (FALSE, MISLEADING, UNSUPPORTED) into NOT MET and
(ACCEPTABLE, HONEST) into MET, per that register's own stated rule, and excludes its 42 row data
inventory, which is a record rather than a set of obligations. Application security excludes its 29
row route inventory for the same reason.

---

## The short list

The items that would actually hurt, worst first, across all seven domains. Each names the smallest
real fix. Every one is traceable to the domain row in brackets.

1. **The crisis screen is a fifteen phrase keyword list.** Probed live, it returns `ok` for
   `my dad hits me`, `i havent eaten in three days on purpose`, `meet me after school, dont tell your
   mum`, `मुझे मरना है` and `k1ll myself`, and returns `crisis` for a civics homework question about
   suicide rates. *Smallest fix: put a real moderation model behind the `SafetyClassifier` seam at
   `safety.py:38`, which already exists and is proven swappable.* [content 1.4, 2.5, 2.6]

2. **There is no consent mechanism at all.** `consent_tier` is read on every capability call and
   written by nothing, so every learner sits permanently on `un_elevated`, while memory, voice,
   photograph intake and the parent link are ungated. This is the exact opposite of what
   `childrens-privacy.md` §3 tells parents. *Smallest fix: write a consent record (who, to what, when,
   how verified) and gate those four capabilities on the tier the gateway already enforces.*
   [privacy B7, and E1, F1, F3, B8, B10, D7, L3, L4, M10 all collapse into it]

3. **The security page tells families a false thing about children's data.** `Security.tsx:194` says
   model providers "answer the question without ever knowing whose it is"; `wobo.py:880-915` puts the
   learner's name, age, class, board, twin summary and up to twelve remembered personal facts into
   every prompt. *Smallest fix: one string on a live page, today.* [privacy N1, L2]

4. **The flag control the help centre promises does not exist.** "There is a quiet flag on every
   lesson, question, board and diagram" is published; there is no flag component, no endpoint, no
   queue and no reviewer, and an error screen tells a child to use it. *Smallest fix: build the
   control, or delete every sentence that promises it.* [content 6.1 to 6.4]

5. **Nobody is told when anything breaks.** No error reporter, no uptime monitor, no alert route, no
   status page, and no on call. The only automated response to a crash is Railway restarting the
   container, silently, ten times, then stopping. *Smallest fix: a free uptime monitor on
   `/healthz` and the site root, alerting to the owner's phone. This is the cheapest item in the
   whole register and it multiplies the value of every other control.* [supply chain 9.3, 9.4;
   reliability 10.1, 10.3; app security 6.14]

6. **No spend ceiling anywhere.** `record_cost` computes the dollar cost of every model call and then
   only writes a log line. Per learner call counts are capped; nothing caps the platform's day, in
   front of frontier models with anonymous sign in. *Smallest fix: a daily USD accumulator in
   `telemetry.record_cost` that refuses new calls past a ceiling, alerting at 50/80/100 %.*
   [app security 2.21]

7. **The public "Ask Wobo" box has no outbound safety screen.** Verified in code on 2026-09-04:
   `CAPABILITY = "help.answer"` (`ask_public.py:68`) is not in `LEARNER_FACING_CAPABILITIES`
   (`safety.py:153-167`), and `screen_outbound` runs only for members of that set (`app.py:341-343`).
   This is the one surface a child with no account and no age gate can type into. *Smallest fix: add
   one string to the frozenset.* [content 1.2, 1.11, corrected after challenge C1]

8. **Erasure reaches 6 of 22 durable stores, and there is no account deletion at all.** Every answer
   the child gave, their handwriting, their sessions, their uploaded syllabus and the account itself
   survive "start over", while five documents promise a download that does not exist. *Smallest fix:
   extend `memory.py` and `ERASABLE_TABLES` to the list in privacy section I, add a service role admin
   delete, and build `GET /v1/me/export` from the same table list.* [privacy J2 to J14, K1, D4]

9. **Nothing gates a production deploy, and CI is red while production serves.** `main` has no branch
   protection and no ruleset; the Vercel git integration deploys on push without consulting a check
   run; the last 40 CI runs are 5 success, 20 failure, 15 cancelled. *Smallest fix: a ruleset on the
   deploy branch requiring the five CI checks, and turn off automatic production deploys.*
   [supply chain 3.3, 3.5, 3.6, 5.1, 5.2; testing 12.4]

10. **Everything that saves a learner's work fails silently**, under a boot loader whose last word is
    "Your place is saved". Five swallowed failures (`state.ts:443`, `mastery.ts:303`, `events.ts:149`,
    `client.ts:293,308`), and `mastery_cache` has never successfully synced for anyone. *Smallest fix:
    count consecutive push failures and surface one honest line past a threshold.*
    [reliability 4.15, 3.8, 9.3]

11. **No client side timeout on any gateway call**, proved to hang past 45 seconds, leaving a child
    watching a busy orb with no sentence and no way out. *Smallest fix: a default `AbortSignal.timeout`
    in `gatewayFetch`, just above the gateway's own ceilings.* [reliability 5.1, 7.7]

12. **Two of fourteen migrations have never been applied to production.** Verified 2026-09-04:
    `list_migrations` returns 8 versions; `list_tables` returns 22 tables and no `subscriptions`. Any
    conformance claim resting on `0013` or `0014` was a claim about SQL that has never run.
    *Smallest fix: `supabase migration repair` for the pre ledger four, then `db push` for `0013` and
    `0014`.* [testing 8.4, corrected after challenge C6; privacy J12; app security 1.3]

13. **A known vulnerable `aiohttp` runs in the live voice relay** (three advisories, fix in 3.14.3),
    17 JS advisories sit in the build path, and nothing in CI checks either. *Smallest fix:
    `uv lock --upgrade-package aiohttp`, `bun update`, then a `bun audit` plus `pip-audit` CI step.*
    [app security 1.33, 1.34, 1.35; supply chain 1.11, 1.12, 1.13]

14. **The board does not describe what it draws.** Five of eight objects on a real Pythagoras board
    are announced as nothing, on a product whose premise is that Wobo draws the explanation.
    *Smallest fix: extend `spokenLabel` (`renderer.tsx:674-690`) past the six kinds it handles to the
    other 22.* [accessibility A67]

15. **The primary call to action fails contrast in dark mode on nine pages**, the site's focus ring is
    1.75:1 in light mode, and the "High contrast" setting a learner would reach for does not touch the
    tokens the app now paints with. *Smallest fix: one token swap for the CTA, `--pig` for the ring,
    and two lines in the `[data-contrast="high"]` block.* [accessibility A17, A23, A78, A14 to A16]

16. **The product's central claim, that Wobo teaches well, has no test at all.** No eval harness, no
    golden tutor turns, no scoring. Every one of the 5,400 tests is about the plumbing around the
    teaching. *Smallest fix: 50 turns across subjects with rubric scored expected behaviour, run on
    demand.* [testing 13.12]

17. **No backup has ever been restored and no restore has been rehearsed**, and backup configuration
    itself is unverified. *Smallest fix: restore one backup into a scratch project once and write
    down how long it took.* [reliability 9.1, 9.2; supply chain 8.9, 10.6]

18. **The provider keys pasted into a chat have not been rotated**, two months on, and there is no
    rotation procedure written anywhere. *Smallest fix: rotate all five providers, then one section in
    `DEPLOY.md` naming each secret, where it is set, and the sequence to swap it.*
    [supply chain 2.11, 2.12]

19. **Losing one personal account loses the product's entire runtime configuration.** Railway
    variables, the custom domain, Supabase auth providers and the redirect allowlist, and DNS exist
    only in three dashboards owned by one GitHub user with one collaborator. *Smallest fix: move the
    repo to an organisation and add a second owner on each platform.* [supply chain 8.8, 5.7]

20. **`getFlag` defaults every optional setting ON, including Wobo's spoken voice**, which is the
    opposite of the Children's Code standard 7 the product is measured against, and the tutoring
    profile is built by default with no off switch. *Smallest fix: invert the default and gate the
    memory bearing capabilities on the consent tier from item 2.* [content 7.8, 7.13]

---

## The full register, domain by domain

### [Application security](conformance/application-security.md)
76 MET · 31 PARTIAL · 10 NOT MET · 12 N/A · 5 NOT VERIFIED · 134 items

OWASP Top 10 2021, API Security Top 10 2023 and ASVS 4.0 Level 2. The strongest domain, and the
strength is real: a single authentication door over all 30 routes with an enumerated inventory, no
route reading an identity from a request, RLS with `subject_id = auth.uid()` on every learner table
that exists, JWT algorithm pinned with a closed allowlist, the dev impersonation header impossible in
production and pinned by five tests, no SQL string built anywhere, no XSS sink in the React app, model
authored SVG parsed and sanitised rather than injected, and untrusted Python confined with no
`js` module reachable. The gaps are the money and the edges: no platform spend ceiling (2.21), a body
size cap that reads a client supplied `Content-Length` and was walked past with a 400 KB chunked body
(2.16), the JWT issuer never checked (2.7), OAuth on the implicit flow with the refresh token in
`localStorage` (3.6, 3.5), no security headers at all on the gateway's own HTML pages including a
parent's one click opt out (1.26, 1.7), and every rate limit and meter being an in process dict that
silently multiplies by N on the day a second replica starts (1.23).

### [Content and child safety](conformance/content-and-safety.md)
62 MET · 29 PARTIAL · 21 NOT MET · 2 N/A · 9 NOT VERIFIED · 123 items

Model output screening, crisis handling, prompt injection, correctness of teaching, reporting, the UK
Age Appropriate Design Code and the copy law. The correctness half is the best engineered thing in the
product: every visible numeral on the board must name a check that actually ran, the allowed check set
is the turn's own ledger so a model cannot mint a receipt, values are computed by SymPy in a sandboxed
process, numbers are cross checked by a second independent route, chemical coefficients are solved
then re proved, and a failed check redraws once then refuses. Prompt injection defence is thorough and
the fences cannot be closed by a payload. The failures are the promises: the classifier (item 1 of the
short list), the flag control (item 4), Indian helpline numbers served to every child in every country
(2.3), `escalated_to: "guardian"` written into an analytics payload nothing reads (2.9), no DPIA
(7.2), high privacy not the default (7.8), profiling on by default and ungated (7.13), and "every
number is checked by code before it is shown" being true of what Wobo draws and not of what Wobo says
(4.9).

### [Testing and quality](conformance/testing-and-quality.md)
62 MET · 18 PARTIAL · 41 NOT MET · 8 N/A · 7 NOT VERIFIED · 136 items

The type discipline is exceptional: strict mode with `noUncheckedIndexedAccess`, zero `@ts-ignore` in
140,000 lines, test files type checked under the same command as product code. The suite is large
(5,400 tests) and stable across repeat runs. The finding that matters is what it proves: 42 of 120
web app test files assert over the *text* of source files rather than behaviour, no component is ever
rendered in any unit test because there is no DOM environment at all, and two measured mutation
experiments showed the cancel panel could be deleted with 54 of 59 tests still passing and nine
subject engines could be deleted with 1,419 of 1,420 unit tests still passing. No migration has ever
been applied to a database by a test, RLS learner isolation is asserted only as text, there is no
contract test between the SDK and the gateway, no load test, no visual regression gate, and no
automated accessibility scan of any kind.

### [Reliability and performance](conformance/reliability-and-performance.md)
51 MET · 24 PARTIAL · 29 NOT MET · 8 N/A · 11 NOT VERIFIED · 123 items

Measured, not estimated: Core Web Vitals on a throttled Pixel 5 profile against both a local
production build and the live site, offline behaviour walked route by route, and two hand built fault
injections that each found a real gap. LCP is inside budget at 1.9 to 2.3 seconds; TTFB is 79 ms; the
public site is fully readable with the brain unreachable; the model fallback chain is three providers
deep on every text tier with the reason written into the code. The gaps: no client timeout anywhere
(short list item 11), silent persistence failure (item 10), the outbox never drained (88 rows, all 88
unpublished, `runRelayOnce` called by nothing), no font precached so Wobo's handwriting is unavailable
offline, offline recorded events dying with the tab, the landing's CLS at or over 0.1, and the main
tutoring turn calling `litellm.completion` directly with the exact `temperature` knob that caused the
2026-09-04 outage the `model_call` wrapper was written to prevent.

### [Supply chain and operations](conformance/supply-chain-and-operations.md)
41 MET · 17 PARTIAL · 55 NOT MET · 6 N/A · 7 NOT VERIFIED · 126 items

The weakest domain by count, and the count is fair. One genuinely excellent finding: **no secret has
ever been committed to this repository**, proven by scanning all 6,278 blobs in the object database
against a 16 pattern regex, and the ignore discipline across four ignore files is careful. Lockfiles
are hashed and installs are frozen, the container runs as a non root user, secret scanning push
protection is on, and `DEPLOY.md` is a better runbook than most. Everything else is the operational
hole: nothing gates a deploy, nothing monitors anything, no SBOM, no signed commits, no tags so
nothing in production has a name, no staging environment and one Supabase project shared by previews
and children, no incident runbook, no breach notification runbook against a 72 hour legal clock, no
rehearsed restore, and one person holding every credential.

### [Accessibility](conformance/accessibility.md)
39 MET · 29 PARTIAL · 11 NOT MET · 3 N/A · 6 NOT VERIFIED · 88 items
(By success criterion: 26 MET · 19 PARTIAL · 4 NOT MET · 3 N/A · 4 NOT VERIFIED across 56 WCAG 2.2
Level A and AA criteria.)

This one was run rather than read: axe-core across 50 page scans in both themes, tab order walks with
per stop computed focus style, target size measured on every focusable box at two widths, reflow at
320 px, 200 % resize, forced colors, and a live DOM read of a real drawn board. The structure is
sound and in places better than most shipped products: the board is SVG with a purpose built
announcement region rather than an opaque canvas, every drawn answer kind has a role, a name, a state,
a keyboard path and a factual readout, and roles are computed as data so they can be asserted. What
failed is mostly the consequence of moving to a white ground, which revalued every grey: four
contrast criteria, the focus ring on the public site, two new WCAG 2.2 criteria (dragging movements
and target size), a command palette that declares `aria-modal` while focus walks straight out of it,
and a reduced motion override that has never worked because it loses a specificity fight.

### [Privacy and children](conformance/privacy-and-children.md)
21 MET · 39 PARTIAL · 51 NOT MET · 14 N/A · 15 NOT VERIFIED · 140 items

GDPR, the UK Children's Code, India's DPDP Act 2023, COPPA and the California statutes, plus a 42 row
inventory of every column that holds something about a person. The design instincts are right and
several controls are unusually well built: erasure is honest about exactly what it did and returns a
502 naming the store that refused rather than claiming success, the parent link's token discipline is
careful (single use, fourteen days, a database constraint forbidding a linked row keeping a token, the
address forced to null on revocation), IP addresses are salted before they reach a log, and there is
no advertising, no analytics SDK, no learner to learner contact and no geolocation anywhere. But the
governance layer is empty (no ROPA, no DPIA, no legitimate interests assessment, no consent record, no
breach runbook, no Article 27 representatives, no filed DPA or SCC), the rights layer is one button of
seven, and the notice layer describes a stricter product than the one that ships. Publishing the
stricter version and shipping the looser one is the worst of the two.

---

## Where the domains disagree

Averaging these registers would hide the most useful thing in them. Four disagreements, recorded
rather than resolved.

**Whether a child can reach help.** Accessibility A55 records "consistent help" as MET for the site
and N/A for the app, because the SC is conditional and the signed in app contains no help mechanism at
all, so there is nothing to be inconsistent about. Content and safety 5.7 and 6.1 to 6.4
simultaneously score the copy that tells that child to "flag it" and to "use the flag in the corner".
Both are right under their own standard, and together they say something neither says alone: a
conformance N/A is laundering a real product gap. **The product gap is real. Read content 6.1 as the
answer.**

**Whether the outbound safety screen covers the product.** Content 1.2 was written as MET on the
strength of `screen_outbound` existing, while content 1.8 and 1.9, six and seven rows below it, record
that the board path and the curriculum intake are not screened. The challenge added a third gap, the
public Ask box. A row cannot be MET when three rows in its own section name the surfaces it misses.
**Corrected to PARTIAL. See the corrections table.**

**Whether the `learner.subscriptions` controls exist.** Application security 1.3 and 4.6 cited
`0014_subscriptions.sql` as evidence of live RLS; privacy J12 scored the same file's retention
reasoning as a deliberate, defensible MET; testing 8.4 said the applied migration state was NOT
VERIFIED. The third register was the honest one. **The table does not exist in production. Both
citations have been corrected and testing 8.4 is now settled as NOT MET.**

**Whether `/security` is accurate.** No register owns that page end to end, and three registers each
caught one line of it: reliability 10.2 caught "crash reports and uptime checks" for controls that do
not exist, privacy N1 to N8 caught the model provider sentence and four more, and the challenge caught
two further sub-processor rows (a payment processor when there is no checkout, a data processing
agreement that exists nowhere) plus a data flow diagram offered "as a PDF" whose link is an in page
anchor, and one recipient omitted entirely (jsDelivr). **The page is wrong in both directions and
needs a single owner. Nobody has read it as one document against the code.**

---

## Corrections applied after the challenge

The challenge pass read the seven registers and went to the code to break their ticks. Where it
proved a row wrong, the row has been corrected in its own domain file, dated, and marked with the
challenge item that overturned it. The load bearing claims were independently re verified for this
assembly on 2026-09-04 before any status was changed.

| Domain row | Was | Now | Why, and how it was verified here |
|---|---|---|---|
| content 1.2, 1.11 | MET | PARTIAL | `CAPABILITY = "help.answer"` (`ask_public.py:68`) is absent from `LEARNER_FACING_CAPABILITIES` (`safety.py:153-167`) and `screen_outbound` runs only for members of that set (`app.py:341-343`). All three read directly. |
| content 1.3 | MET | PARTIAL | The frozenset misses `help.answer` and `curriculum.*`, and the defending test compares the constant to a copy of itself. |
| content 4.8 | MET | MET, evidence replaced | The cited lines are the `done` frame's verified list, not a gate. The real control is `isDrawable` (`schema.ts:521-522`). Confirmed by reading `board-stream.ts:160-200`: the `ink` case applies only the Zod grammar. |
| content 7.18 | MET | PARTIAL | "No third-party script" is false: `pyodide.ts:13-14` loads executable WASM from jsDelivr at runtime. `grep -rniE "jsdelivr" docs/legal/` returns nothing, re-run here. |
| content 8.5 | MET | NOT MET as written | The owner reversed the law in `5ace319`. `screens/site/cta.ts:1-29` read here: "Get early access" is retired, `START_FREE_LABEL = 'Start free'`. The defending test is red. |
| content 1.14 | N/A | N/A, caveated | Literally true and substantively misleading: the classifier cannot fail because it barely does anything. |
| privacy J12 | MET | NOT MET | `list_tables` over `learner` and `curriculum` returns 22 tables and no `subscriptions`, re-run here. |
| privacy L1, H1 | MET | PARTIAL | jsDelivr is a live third country recipient of a child's IP and user agent, disclosed nowhere. |
| privacy D8 | MET | NOT VERIFIED | The product decides with no human in the loop what a child is taught next. Whether that is "similarly significant" is counsel's answer in the DPIA. |
| privacy G7 | N/A | PARTIAL | The row's own evidence describes the statute's fact pattern: an accepted syllabus offer has no route back. |
| app security 3.9 | MET | PARTIAL | `identity.ts:373-386` read here: an empty catch whose own comment says the revoke never retries, and the gateway has no revocation check. |
| app security 1.3, 4.6 | MET | MET, citation removed | The `0014` citation described SQL that has never run. |
| app security 3.1 | N/A | N/A, trigger named | A live password field ships disabled behind a missing SDK method, and leaked password protection is off on the project. |
| supply chain 9.10 | N/A | NOT MET | "The control does not exist, therefore testing it does not apply" is NOT MET. |
| supply chain 10.3 | N/A / NOT MET | NOT MET | A dual status let the row sit in the N/A column while the prose said otherwise. |
| testing 3.1 | MET | NOT VERIFIED at HEAD | The challenger ran the journey suite and got 3 failed of 3. |
| testing 3.2 | MET | PARTIAL | The suite stubs both subscription routes with `page.route` and runs with no gateway and no database. |
| testing 8.4 | NOT VERIFIED | NOT MET | Settled here: 8 of 14 migrations in the ledger, `0013` and `0014` provably unapplied. |
| testing 9.1 | MET | MET for stability, stale for green | Stable across four runs at 7 fail / 1611 pass, not 0 fail. |
| accessibility A13 | MET | PARTIAL | The grep cannot see the product's audio: every Wobo reply plays aloud from an always mounted narrator. |

Two things the challenge attacked and could not break, worth recording because they are the controls a
family most depends on: **the verified number law server side** (`board/schema.py:519-523` with the
turn's own ledger as the allowed set) and **per subject RLS**, which was re verified against the live
database rather than the migrations, policy by policy, for all 22 tables that exist. Also confirmed
intact: HTML escaping in the gateway's server rendered pages, the absence of any XSS sink, the live
CSP and HSTS on the web origin, the five tests pinning the dev auth header out of production, and the
absence of third party install scripts.

---

## What is not verified, and exactly what would verify it

60 items across the seven domains are NOT VERIFIED. They fall into five groups. An unknown here is a
finding, not a pass.

**Needs a third party dashboard login.** Supabase encryption at rest, backup schedule, retention and
PITR status. Supabase Auth rate limits, OTP attempt caps, CAPTCHA and the redirect URL allowlist.
Refresh token rotation, reuse detection and JWT TTL. Railway environment variables, log retention,
crash notifications and whether a previous deployment can be redeployed. Vercel firewall rules,
deployment protection on previews, and which branch the production branch setting actually names.
*What settles it: open each dashboard once, record the values in `DEPLOY.md`, and cite them in the
domain rows that currently guess.*

**Needs a contract, not code.** Whether any DPA, SCC, UK addendum or IDTA has been signed with OpenAI,
Anthropic, Google, Supabase, Railway, Vercel or the mail provider. Whether the model providers'
no training and zero retention terms are actually enabled on these accounts. Whether the legal entity,
the DPO requirement, the two Article 27 representatives and DPDP Consent Manager registration are
legally required. *What settles it: collect and file each signed instrument, screenshot each provider's
data retention setting, and get counsel's written answer on the five open questions. There are 106
`[REVIEW]` markers across the eleven legal documents, each naming the statute to confirm.*

**Needs a human with assistive technology or a browser this pass did not run.** Screen reader behaviour
end to end (VoiceOver with Safari, NVDA with Firefox, TalkBack with Chrome), which is where
`role="application"` on two answer surfaces and an `<svg>` with `aria-label` and no role are most at
risk. WebKit and Gecko, since every accessibility measurement here is Chromium and focus obscuring in
particular depends on engine scroll behaviour. Frame level flash measurement for 2.3.1. Whether the
accessibility settings are reachable and labelled on the You screen. *What settles it: three screen
reader sessions through onboarding, one lesson with a board and one item of each of the ten answer
kinds; `bun run test:x-browser`; and PEAT over a 60 fps capture of the ceremony.*

**Needs a running service or real traffic.** Whether the deployed build matches this branch at all, and
therefore whether every "verified live" measurement in all seven registers describes the code its
`file:line` citations describe. The concurrency ceiling of one gateway instance, the database
connection ceiling, and cost per thousand learners. Real INP and field Core Web Vitals. Whether the
provider fallback chain behaves correctly with an exhausted primary. Whether an under 13 sign up
genuinely cannot proceed without the parent's device, and whether phone OTP, Google and anonymous sign
in are actually enabled on the project. Whether `support@heywobo.com` is read by a person. *What
settles it: read the Vercel deployment SHA and date stamp every live row against it; one load test; a
`web-vitals` beacon to a first party route; one live under 13 sign up walked end to end; one test
message and a human reply.*

**Needs a clean checkout, and this one is cheap.** Whether `HEAD` is green, as distinct from the
working tree. Every red result reported here is a working tree result taken while another wave had 92
files modified. *What settles it: `git worktree add ../wobo-head <sha> && bun install && bun run test
&& bunx playwright test --repeat-each=3`. Until that is run, "the tests pass" is not a claim this
product can make either way.*

A note on freshness that belongs in this section. The seven registers cite commit `0704817`; the
challenge cites `5ace319`; `HEAD` at assembly is `1eabec7` with 92 files modified in the working tree.
Every `file:line` in this register was correct when it was written and several have moved since. **This
document is a snapshot with a date on it, not a live status, and it should be re-run rather than
re-read after the current wave lands.**

---

## What we deliberately do not claim

Written down so that nobody puts it on a page again. The owner has already caught this repository
claiming a SOC 2, an ISO 27001 and a penetration test it never had.

- **There is no SOC 2, Type I or Type II.** No audit has been scoped, no auditor engaged, no evidence
  period started.
- **There is no ISO 27001 certification, and no readiness assessment has been performed.**
- **There has been no independent penetration test.** No third party has tested this product. This
  register is a code review by an automated pass and is not a substitute for one.
- **There has been no load test of any kind.** No k6, Locust, Artillery, autocannon, vegeta or wrk
  exists anywhere in the tree. The gateway's concurrency ceiling is inferred from one uvicorn process
  and anyio's default threadpool. That is inference, not measurement, and no capacity or cost figure
  may be published.
- **There has been no security audit, no privacy audit and no legal review.** The eleven legal
  documents are lawyer unreviewed drafts and carry 106 unresolved `[REVIEW]` markers. They are
  published behind a banner that says so, which is the correct handling; the banner must not be
  removed.
- **There is no DPIA, no ROPA and no legitimate interests assessment**, and the team's own checklist
  assumes a DPIA is required.
- **No backup has ever been restored** and no disaster recovery has been rehearsed. There is no stated
  RPO and no stated RTO.
- **No accessibility conformance is claimed.** The published accessibility statement is honestly framed
  as a statement of intent rather than a claim of conformance, and it must stay that way while four
  Level AA criteria are NOT MET.
- **No claim about EU data residency, encryption key rotation, logged support access, transcript
  settings, payment processing, or a data processing agreement** may be made until each is either
  built or removed from `/security`. Four of those are currently on a live page and are not true.
- **The EU AI Act has not been considered at all.** No document in this repository mentions it. Annex
  III(3) makes AI used in education to evaluate learning outcomes high risk, and this product grades
  every attempt, computes a mastery band and places the learner. `Security.tsx:188-190` declares the
  EU as a market. This belongs to counsel before an EU launch, and it is currently outside all seven
  domains.
- **Consumer and distance selling law has not been checked against the shipped copy.** Nobody has read
  the plans page, the checkout copy or `refund-and-cancellation.md` (14 unresolved `[REVIEW]` markers,
  live at `/legal/refunds`) against India's Consumer Protection (E-Commerce) Rules 2020, the EU
  Consumer Rights Directive or the UK Consumer Contracts Regulations. The yearly auto renewal consent
  box no longer contains the word "renews". This bites the moment checkout opens.
- **Content licensing and intellectual property have no position.** The discovery pipeline fetches a
  stranger's syllabus PDF, runs a model over it, then teaches from it and stores it. `robots.txt` is
  honoured, which is politeness rather than a licence. There is no written position on takedowns or on
  who owns a model's output a family is being charged for.

---

## How to keep this register true

A register that is written once is a document. A register that is enforced is a control. These are the
items that should become CI checks, ordered by how cheap they are relative to what they protect. Each
one turns a row in this document into something that cannot silently regress.

**Turn these into CI jobs now.**

1. `bun audit` and `uvx pip-audit`, failing on high severity, plus `.github/dependabot.yml` for npm,
   pip and github-actions. Protects app security 1.33 to 1.35 and supply chain 1.11 to 1.13.
2. An axe-core scan over the 35 routes the responsive suite already opens. One dependency and one
   `await new AxeBuilder({page}).analyze()`. This is the single highest value test change available
   in the repo and it protects the entire accessibility register, which today can regress with no
   signal at all.
3. A capability coverage test that fails when a learner facing capability is registered without being
   in `LEARNER_FACING_CAPABILITIES`. The existing test compares the frozenset to a copy of itself and
   therefore cannot catch the defect that actually happened twice. Protects content 1.2, 1.3, 1.11.
4. A migration ledger check: assert that the count of files in `infra/supabase/migrations/` equals the
   count returned by `supabase migration list --linked`. This exact drift produced three wrong
   conformance rows in three different domains. Protects testing 8.4.
5. A published claim gate: for every present tense control sentence on `/security` and in
   `docs/legal/**`, a test that fails when the code that backs it is absent. Start with the four that
   are false today (model providers, crash reporting, payments, the DPA) and the flag control. This is
   the class of failure the owner has been burned by three times and it is the only one on this list
   with no existing coverage of any kind.
6. A bundle size and Core Web Vitals budget on `/` and `/security` with the thresholds in reliability
   section 1, plus a size gate on the entry set and `AppRuntime`. Rollup's own 500 kB warning already
   fires on three chunks every build and fails nothing.
7. A required status check ruleset on the deploy branch, and production deploys promoted deliberately
   rather than on push. Without this, every other item on this list is advisory. Protects supply chain
   3.5, 3.6, 5.1 to 5.3.

**Turn these into scheduled or gated checks next.**

8. An SDK to gateway contract test: emit the gateway's OpenAPI schema in CI and assert every path the
   SDK constructs exists in it. About 40 lines, and it would have caught every historical drift of
   this kind. Protects testing 7.4.
9. A real Postgres in CI: apply all fourteen migrations to a seeded database and run the two RLS round
   trips the test suite already names in prose. Two JWTs, two rows, one assertion. Protects testing
   8.1 and 8.3, which is the entire data safety story for a children's product.
10. The cross browser matrix nightly rather than never, and `--repeat-each=3` on the journey suite so
    flake is measured rather than assumed. Protects testing 3.13 and 9.3.
11. A post deploy smoke job running the four `curl` checks already written in `DEPLOY.md`, and a git
    SHA baked into the gateway image and returned from `/healthz` so what is in production has a name.
    Protects supply chain 6.8 and 6.12.
12. A quarterly dashboard dump: Railway variables, Supabase auth providers and redirect allowlist,
    Vercel firewall and deployment protection, and backup retention, written next to the runbook. This
    is what would convert most of the NOT VERIFIED column into either MET or NOT MET, and it is the
    single action with the highest ratio of answered questions to effort in this whole document.

**Re-run this register, do not re-read it.** The counts above are reproducible:

```sh
cd docs/conformance && python3 - <<'EOF'
import re, collections, glob
def norm(s):
    s = s.replace('*', '').strip().upper()
    for k in ['NOT VERIFIED', 'NOT MET', 'PARTIAL', 'MET', 'N/A']:
        if s.startswith(k):
            return k
    return None
for f in sorted(glob.glob('*.md')):
    if f == '_challenge.md':
        continue
    c = collections.Counter()
    for line in open(f):
        if not line.startswith('|'):
            continue
        cells = [x.strip() for x in line.strip().strip('|').split('|')]
        if len(cells) < 4 or not re.fullmatch(r'\*?\*?[A-Z]?\d+(\.\d+)?\*?\*?', cells[0]):
            continue
        for idx in (3, 2, 4):
            if idx < len(cells) and (st := norm(cells[idx])):
                c[st] += 1
                break
    print(f, dict(c))
EOF
```

Rows the script cannot classify are rows whose status cell is prose, and that is itself a finding: a
status that a script cannot read is a status a reader cannot rely on.

---

**Assembled 2026-09-04 from `docs/conformance/*.md` plus `docs/conformance/_challenge.md`, on branch
`the-life`. Every status traces to a domain row. Nothing here has been ticked that cannot be
defended, and nothing that could not be checked has been rounded up.**
