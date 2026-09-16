# NOW: everything discussed, and where it actually is

**The rule (owner, 2026-09-09):** *"Everything we discuss should be on a task list, it should be in
motion. Eventually we can just keep ideas as plans without implementation."* So nothing said in a
conversation is finished until it appears here with a state. This file is the single board. It is
updated in the same breath as the decision, not later.

**States:** `RUNNING` a wave is working on it now · `QUEUED` written and waiting on the tree ·
`TO WRITE` decided, the wave is not written yet · `OWNER` waiting on the owner and nothing else ·
`LANDED` in the repository and verified.

## What happened on 2026-09-11, and what is happening now

The usage limit hit while seven waves were mid-task. Every agent still running died; the ones that had
finished are kept. The tree was left half-built: about 120 typecheck errors, 28 gateway failures, 13
web failures, two migrations sharing a number. **Wave 52 healed it** on 2026-09-14 (21 closers, one per failure group, each closing by its law rather
than by whichever side was easier), verified in isolation and committed as `9d204ed`, deployed to both
ends (Railway 91c2488b, Vercel dpl_9AvJDo2vvYx9gx3trN5MpdcgHFUB; the press page is live at /press). Wave 48b committed as `b281c5c` and live on both ends (Railway 7fcf6b21, Vercel dpl_95PBz2pF1HinHCF2MuXfF7GERpYx). Wave 48c committed as `6c7b144`, isolated build and gates green, live on both ends (Railway b812ea0f, Vercel dpl_39cjiq4oMmGNchivKMe2vxdVnXg5). Wave 45 committed as `9acf682` and live on both ends (2026-09-16). Then nine waves were launched at once and the session cap killed all nine within five minutes. Their
five minutes of partial work is kept as a patch and the tree was reset to `9d204ed`. **From here, one
wave at a time**, each verified, committed and deployed before the next, so that a cap hits between
waves and never inside one. And from 2026-09-15 by the owner's rule: Opus builds, Fable only judges
and designs, Sonnet runs the suites; every agent in every wave carries its model. Nothing they were building is dropped; it is queued in the order the
owner's walk needs it.

## Running now

Exactly one wave runs at a time, so a usage cap lands between waves and never inside one.

| What | Wave | Where it is |
|---|---|---|
| The tutor never leaves: re-chosen after every module until understood, where they went wrong in the concept's words, motivating, no dead end | 54 | next to launch |

## The queue, in order

Each is written and stamped Opus; each waits for the one before it to be verified, committed and
deployed. Nothing here is lost, and nothing here has started.

| # | What | Wave |
|---|---|---|
| 1 | The tutor never leaves: re-chosen after every module until understood, where they went wrong in the concept's words, motivating, no dead end | 54 |
| 2 | The mail law enforced, and the animation library on every surface | 38 |
| 3 | The daily allowance, the models desk, the free pool cap | 36 |
| 4 | One owner and per-person roles, the board that changes once, the four suggestions | 49 |
| 5 | The growth desk, the press page, chapter pages at tier two | 50 |
| 6 | The mail law's 26 assertions, the 67 pages measured, the core's depth band | 51 |
| 7 | The parent's account screens | 34 |

## Landed, with the proof

| What | Wave | Proof |
|---|---|---|
| The ink's correctness at four out of four | 42, 47 | correctness scores 4.00; craft is what wave 48 is closing |
| The public site readable by a crawler that runs no script | 43 | 440 pages of real HTML, a canonical on each, a real 404 |
| The page families | 44 | the syllabus door, chapters, topics, subjects, comparisons, the blog |
| No trace of the old name | 40 | the gate scripts refuse it |
| The door closed to new accounts | 46 | `/v1/doors` answers `{"doors_open":false}` in production |
| Mail that reaches a person | 38 | the domain is verified and the first send landed in Primary |
| The tree healed after the kill: 21 closers, five suites green in isolation | 52 | commit `9d204ed`; typecheck clean, web 3596 pass, gateway 5942 pass, gates clean |
| The money meter: a quarter of the plan a day, in the learner's own local day | 36 | allowance.py, 33 tests, in `9d204ed` |
| A discovery refusal that says what actually happened | 45 | `verify.text_layer_is_unreadable` tells "we could not read it" apart from "it is not the syllabus" (Uttar Pradesh's own Class 10 Mathematics pdf was refused as the second and is the first — a legacy Devanagari text layer); the new `document_unreadable` line and desk sentence; the refusal's detail and its trail of every candidate opened now reach `discovery_jobs.result` and the console's refused table. 16 + 1 + 2 tests red first; BOARD-COLD-START §11 |
| The prewarm queue and the console's Boards desk | 45 | `prewarm.py` (India's boards by enrolment, console-editable, queued behind every waiting learner), `curriculum/desk.py` + four routes, the Boards desk in the console; 72 tests red first; BOARD-COLD-START §8. The switch is still off in production |
| The last tenth of the ink: size and placement solved together, one voice a turn | 48 | LANDED in `6c7b144`: 3.939 (relevance 3.983, correctness 3.983, craft 3.932, timing 3.983, experience 3.814; 46 of 59 perfect); what remains is on the ink's own list in INK-FOUR's discipline |
| The boards: discovery runs, the cold start, the prewarm, the console | 45 | LANDED 2026-09-16: discovery ran end to end on three real state boards offline (Maharashtra reads faithfully; Uttar Pradesh's legacy-font pdf and Tamil Nadu's broken TLS chain are refused honestly and written up); eight faults found by the run, each with a test; the money ceiling survives restarts; the first learner on a cold board never sees an empty shelf; the console's syllabus desk; the runbook in OPERATIONS 9.2.1 |
| The document's year is checked against the learner's (Maharashtra's 2012 syllabus would have published) | 45 | LANDED in the tree, uncommitted: `discovery/dating.py`, `verify.CHECK_DOCUMENT_YEAR`, the gate before a model is paid, 46 tests; docs/BOARD-COLD-START.md §9. NOT done: the four published syllabi are not re-checked for their year |

## Queued, written, waiting only on the tree

| What | Wave | Why it waits |
|---|---|---|
| The content layers, the caches, the five stores | 37 | the concept cores that tier-two pages need |

## Decided, still to write

| What | Where it is specified |
|---|---|
| **The cold start is not fixed.** Measured on a throttled phone: first paint 33,800 ms, first interactive lesson frame 33,900 ms, 1,195 kB of JS on the lesson route, 4,696 kB precached. Four causes are located precisely and NONE is landed; the Playwright suite is deliberately red against the target rather than green against today | wave 53's measurement, kept as `tests/cold-start.spec.ts`. It is an e2e spec, so it does not block `bun run test` or the gate. Needs its own wave |
| The install offer has no way back: `askAgain()` is built and tested and has zero callers, because the settings row belongs on `screens/You.tsx` | wave 53, named defect. One row on You, wired to `askAgain()` |
| A learner who declines an install offer can be shown it again — `INSTALL_SHOWINGS = 3` is a number a builder chose, and no law states one | docs/SUGGESTIONS-AND-NOTICES.md sets no repeat count. **Wants the owner's ruling** |
| Should a kept lesson ever expire? Today a topic's lesson is frozen at the kept composition until the shelf evicts it, so a better engine or a moved syllabus reaches that learner only after eviction | wave 53, named. **Wants the owner's ruling** |
| A photo shared while nobody is signed in is now DROPPED rather than held through sign-in — the learner meets the camera with nothing said and must share again | wave 53 made this trade to close the leak. **The owner should know; reversible** |

| What | Where it is specified |
|---|---|
| Discovery: a board that times out must rest before it eats the day's generations, and a run that cost nothing must not spend one | docs/OPERATIONS.md, "What the first live hour of discovery actually did" (2026-09-16). Two faults found by running it, both bounded and neither urgent |

| What | Where it is specified |
|---|---|
| The tutor never leaves: the proof that teaching re-chooses after every module until understood, explains where they went wrong, motivates, never dead-ends | docs/LEARNING-MODEL.md, the 2026-09-15 section; wave 54, written, queued after 53 |
| The money's voice on every money surface, with docs/copy/money.md verbatim | docs/SELL.md, the 2026-09-15 section; carried by wave 36's plans-and-bar builder |

Everything else: Every decision on this board is running, queued on the tree, landed, or held below by a
reason with a name on it. When the owner says something next, it is written into a wave in the same
breath as the saying.

## Named by wave 45, for the waves that own them

| What | Owner |
|---|---|
| A learner's first debit, made before the device's zone is known, lands on the UTC day; the test now mirrors the product (the zone arrives with the request), but the product question stands | wave 36, the allowance |
| Uttar Pradesh's syllabus is a legacy-font pdf with no readable text layer; reading it needs a render-and-read path | the boards, a decision for the owner on cost |
| Tamil Nadu's board serves a TLS chain Python cannot build; we refuse rather than loosen verification | the owner's decision, written up in the runbook |
| A per-board money alert: the ceiling refuses but nothing pages anyone | wave 36 |

## Held on purpose, each by a named reason

| What | Held by |
|---|---|
| The Android shell and the desktop build | the owner walks the web version first and says he is satisfied (owner, 2026-09-10) |
| Push notifications | last by design: nothing reaches a phone until the in-product suggestions have earned their place (docs/SUGGESTIONS-AND-NOTICES.md) |

## Waiting on the owner, and nothing else

| What | Why it matters | Effort |
|---|---|---|
| **Supabase: turn off "Allow new users to sign up" and anonymous sign-ins** | the only way an account can still be made; the gateway refuses them everywhere else | two clicks |

| Claim @heywobo everywhere, and linkedin.com/company/wobo | a handle is first-come and unobtainable once noticed | an hour |
| Reserve the app name Wobo in Play Console and App Store Connect | a namespace, not a build; the owner's call whether to do it now | a form, about 10,500 rupees a year |
| A real mailbox behind hello@ and support@ | replies are the strongest inbox signal there is | minutes |

| Top up the Anthropic account | the cross-provider second opinion is out of credit | minutes |
| File the Wobo trademark in India, classes 41 and 9 | the legal backstop for the name | a lawyer |
| Create the listings: Wikidata, LinkedIn, Crunchbase, Product Hunt, Google Business Profile | this is what makes an engine answer "Wobo is an AI tutor" | an afternoon, copy is written |
| Razorpay keys | checkout answers 503 until they exist | minutes |
| Turn on Supabase leaked-password protection | an open advisory | one switch |
| Set the repo's git identity: `git config user.email` to the address of the Vercel account | every commit is authored by the machine (`depl@...local`), and Vercel now blocks a deploy whose commit author is not a team member; until then we deploy from a git-less export | one command |
| **Push `the-life` to `main`** | NOT housekeeping any more: Railway is wired to `main`, and HEAD is **192 commits ahead** of it. Any variable write or UI redeploy rebuilds `main` and ships a months-old gateway — it did exactly that on 2026-09-16 and took `/v1/doors` down until HEAD was re-uploaded (docs/OPERATIONS.md, "The Railway trap") | one command, and it closes a standing hazard |

## The owner's walk, which gates the store apps

Before any store build, the owner walks the web version end to end on a real phone and says whether it
is ready. What that walk needs from us, and it is the same work that makes the store apps good anyway:
the ink at four out of four, the first real boards, offline lessons, a fast cold start on a cheap
Android phone, the camera path, share targets, notifications, and the install prompt in the right place.
When it is close, the owner gets a clean build and a route through every surface: the door, onboarding,
a lesson with the ink, a photographed doubt, the arcade, the parent's view, plans, and the console.

## Landed today

2026-09-16: discovery is live and ticking (`discovery.worker.started, interval_s=30`) on deploy `775708fa`, with `/v1/doors` shut and `/healthz` detailed again. Getting there cost one outage: setting the Railway variable rebuilt GitHub `main` (192 commits stale) instead of the uploaded snapshot. Written up as "The Railway trap" in docs/OPERATIONS.md.

2026-09-16: **syllabus discovery is switched on in production.** The four money dials were written into `ops.settings` FIRST, so the audit trail records a deliberate choice rather than a code default: `discovery.running` true, `discovery.board.max_usd` 0.50, `discovery.daily.max_usd` 5.00, `discovery.refusal.retry_days` 7. Then `WOBO_DISCOVERY_WORKER=1` on Railway, which triggered deployment `9dd1bb7a`. The hard stop is one statement away and takes effect in thirty seconds with no deploy: `update ops.settings set value = 'false'::jsonb where key = 'discovery.running';`

2026-09-16: **migrations 0024 through 0033 are APPLIED** to production Supabase, on the owner's explicit permission, verbatim and in dependency order: the settings dial and both audit trails, the waiting list, the content stores and their private bucket, promo codes, the allowance dials, one-owner plus per-person capabilities, pace and pools, the board-change queue, the mail log, the mail dials. 0029's two unique indexes succeeding proves the live register held no duplicate active owner and no duplicate live address. The ledger now records twenty-nine.

2026-09-15, evening: wave 48c's builders made the room, and this is the corrected account of it, because the first one was written before anything was measured. True: the board package's 14 written-mark laws that were red that morning are green, 1129 pass and 0 fail in 8.2 s. The room was made in the pipelines, not in the solver. The projectile's greatest height, which an exhaustive scan proved had zero lawful positions at either width, now hangs off a drawn dimension gauge, a dashed rise from the ground to the apex with a faint tie across to it, so the number is written beside sixty units of the quantity it measures instead of beside the apex dot four other marks were already crowding; the lens's image distance moved from the axis, which is as wide as the board, to the lens it is measured from, and its magnification to the foot of the image it is a fact about. The type ladder now ends a climb it has proved it cannot win, and ladder.test.ts holds that ending against the full climb on whatever boards the tree has rather than against copied numbers. Measured here on the sixteen, three runs each, with the counting lay that test uses: 68 lays and 307 to 320 ms with the ending, 68 lays and 300 to 301 ms with every rung walked. So the ending costs nothing and today saves nothing on these boards; it was the pipelines that took the sixteen from 138 lays and 955 to 1131 ms at b281c5c, the projectile alone 25 lays at 1440, down to 68 lays and about 310 ms, the projectile 4. Not true, and claimed in the row this one replaces: reserved zones are NOT wired. layout.ts has reservedStrip and grades candidates against WrittenSolve.reserved, and the only caller in the tree that passes a zone is written-solver.test.ts; the one production call, geometry.ts line 826, passes none, and renderer.tsx never mentions it. Nor is there a leader: schema.ts has no leader kind, and the leaders in the tree are arrows the plant cell's pipeline hints, older than this wave. Both are named rather than quietly dropped, and neither is owed a fix: every written-mark law is green without them, so what was broken was the claim and not the drawing, and the mechanism stays built and unused until a board needs it. One thing the row should have said and did not: every written mark through the solver holds for the write, number and label kinds, while a table handed non-empty rows still prints its cells raw through writeText in geometry.ts, outside the solver, at 0.0 px of air from the grid printing them. The punnett square is clean only because its pipeline hands the table empty rows and writes each gamete and genotype as its own mark, so the next pipeline that fills a table's rows inherits that, and it is named here so it cannot be inherited silently. 2026-09-15, later: wave 48b, ten Opus closers and one Fable judge: the ink at 3.919 with relevance and correctness at four; the solver 38 percent faster while its reach improved; voice spend down 37 percent while the first syllable improved. 2026-09-15: wave 48's second round: correctness 4.000 on all 59 turns, craft 3.66 to 3.78, grand 3.868, 40 of 59 turns perfect on every lens; its third round was cut by the cap and runs as wave 48b on Opus. The movie-poster mail shape (the Brilliant mail the owner forwarded) is law in EMAILS-AND-ANIMATIONS.md and in wave 38's brief.

2026-09-15: the admin seat's email claim fails closed (a token that does not say the address was verified carries no address), with the test that proves it; the second proof, a signed single-use invitation link, is written into the console law and wave 49's brief.

The four-out-of-four standard; the ink law (freeze, plan, trace); the search law; the content desk;
press, awards and the press kit's exact words; the entity plan and the handle audit; the naming law
(the brand is Wobo, heywobo.com is an address); the animation library widened to twelve moves on every
surface; the board cold start; the console roles and the board-change rule; the platforms order; the
free tier's rule that quality is shared and quantity is sold; the concept core keyed on concept x depth band (docs/CONTENT-INTERACTION.md 5b, decided rather than asked); the create tier on Astra paid by the
platform; wave 32 and wave 35 verified, committed and deployed to both ends.

## Every law has a row

`docs/LEDGER.md` indexes every law in `docs/` with the owner's own words behind it, generated rather
than remembered. A decision goes three places in one action: the law file that settles it, a row in
the ledger, and a row here. Nothing is held in anyone's head. If a thing was decided and not written,
it did not happen.

## The rule about this file

Anything decided in conversation is written here before the conversation moves on. A plan with no row
here does not exist. A row that sits in `TO WRITE` for more than a few days is either written or struck
out on purpose, never left to rot.

## The honest audit, 2026-09-11

Asked whether everything discussed is ready. It is not, and this is measured rather than remembered.

| | |
|---|---|
| the twelve orb moves, the move sheet, the renderer | **in flight, wave 38** |
| the earned-moment component, the levels curve, the wait game | **in flight, wave 38** |
| the mail law's 26 assertions, and the five new mail kinds | **in flight, wave 51** (24 templates are written; the domain is verified and delivering) |
| the allowance, the free pool cap | **in flight, wave 36** |
| growth attribution, the campaign id, the five shapes, the two posting rules | **in flight, wave 50** |
| the parent's account screens | **queued, wave 34** |
| the four kinds of suggestion, and one owner with per-person roles | **in flight, wave 49** |
| push notifications | **held last on purpose**, see above |
| the 67 pages measured for real distinctness, the core's depth band | **in flight, wave 51** |
| the discovery worker | **not switched on** (one Railway variable, on the owner's list) |
| the blueprint and the per-learner module pool | **built** (wave 37) |
| the content's three layers, the interaction vocabulary | **built** (wave 37) |
| the public site, 440 pages, the closed door, the syllabus door | **built and live** |
| mail, verified and delivering to Primary | **built and live** |
| The phone, three of four: the install prompt, the share target, offline lessons | 53 | Verified on the exact index: typecheck clean, board 1139 pass, web 3836 pass 0 fail, gateway 6259 pass. The install offer is armed at the entry (`main.tsx`) so Chromium's event is never fired into an empty room, made once after a first earned moment, never on a public surface. The share target works end to end on Android/Chromium. Offline lessons were FALSE before this and are now real: a played lesson kept its own cards, and the five faces are precached so an offline learner does not read the product in a fallback font |
| Two real leaks closed while building the phone | 53 | A shared photo could open in a sibling's solver within ten minutes and be sent under THEIR account; and a QA engines bench was shipped and precached inside a children's app (486 kB, the largest precached file). Both found by the wave's own adversaries, both closed |
