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
ends (Railway 91c2488b, Vercel dpl_9AvJDo2vvYx9gx3trN5MpdcgHFUB; the press page is live at /press). Wave 48b committed as `b281c5c` and live on both ends (Railway 7fcf6b21, Vercel dpl_95PBz2pF1HinHCF2MuXfF7GERpYx). Then nine waves were launched at once and the session cap killed all nine within five minutes. Their
five minutes of partial work is kept as a patch and the tree was reset to `9d204ed`. **From here, one
wave at a time**, each verified, committed and deployed before the next, so that a cap hits between
waves and never inside one. And from 2026-09-15 by the owner's rule: Opus builds, Fable only judges
and designs, Sonnet runs the suites; every agent in every wave carries its model. Nothing they were building is dropped; it is queued in the order the
owner's walk needs it.

## Running now

| What | Wave | Where it is |
|---|---|---|
| The last tenth of the ink: size and placement solved together, one voice a turn | 48 | 48c judged 3.939 (relevance 3.983, correctness 3.983, craft 3.932, timing 3.983, experience 3.814; 46 of 59 perfect; all six gates green); its close round is running |
| The mail law enforced, and the animation library on every surface | 38 | queued fifth |
| The boards: discovery runs, the cold start, the prewarm, the console | 45 | queued second |
| The daily allowance, the models desk, the free pool cap | 36 | the money meter landed in 9d204ed; the rest queued sixth, now carrying the money's voice |
| One owner and per-person roles, the board that changes once, the four suggestions | 49 | queued seventh |
| The growth desk, the press page, chapter pages at tier two | 50 | queued eighth |
| The mail law's 26 assertions, the 67 pages measured, the core's depth band | 51 | queued ninth |
| The phone: the install prompt in its place, the share target into the doubt solver, offline lessons that really play, a cold start a cheap Android can live with | 53 | queued third |
| The tutor never leaves: re-chosen after every module until understood, where they went wrong in the concept's words, motivating, no dead end | 54 | written 2026-09-15, queued fourth |
| The parent's account screens | 34 | queued tenth |

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

## Queued, written, waiting only on the tree

| What | Wave | Why it waits |
|---|---|---|
| The content layers, the caches, the five stores | 37 | the concept cores that tier-two pages need |

## Decided, still to write

| What | Where it is specified |
|---|---|
| The tutor never leaves: the proof that teaching re-chooses after every module until understood, explains where they went wrong, motivates, never dead-ends | docs/LEARNING-MODEL.md, the 2026-09-15 section; wave 54, written, queued after 53 |
| The money's voice on every money surface, with docs/copy/money.md verbatim | docs/SELL.md, the 2026-09-15 section; carried by wave 36's plans-and-bar builder |

Everything else: Every decision on this board is running, queued on the tree, landed, or held below by a
reason with a name on it. When the owner says something next, it is written into a wave in the same
breath as the saying.

## Held on purpose, each by a named reason

| What | Held by |
|---|---|
| The Android shell and the desktop build | the owner walks the web version first and says he is satisfied (owner, 2026-09-10) |
| Push notifications | last by design: nothing reaches a phone until the in-product suggestions have earned their place (docs/SUGGESTIONS-AND-NOTICES.md) |

## Waiting on the owner, and nothing else

| What | Why it matters | Effort |
|---|---|---|
| **Supabase: turn off "Allow new users to sign up" and anonymous sign-ins** | the only way an account can still be made; the gateway refuses them everywhere else | two clicks |
| **Apply migrations 0024 through 0033, in order** | Supabase has 0001 to 0023 (checked 2026-09-14). Ten files wait: the settings dial (0024), the doors list (0025), the content stores (0026), promo codes (0027), the allowance dials (0028), the console owner and capabilities (0029), pace and pools (0030), the board change queue (0031), the mail log (0032), the mail dials (0033). Everything built since 2026-09-09 has nowhere to live until then | ten files, one sitting |
| Claim @heywobo everywhere, and linkedin.com/company/wobo | a handle is first-come and unobtainable once noticed | an hour |
| Reserve the app name Wobo in Play Console and App Store Connect | a namespace, not a build; the owner's call whether to do it now | a form, about 10,500 rupees a year |
| A real mailbox behind hello@ and support@ | replies are the strongest inbox signal there is | minutes |
| Set WOBO_DISCOVERY_WORKER on Railway | 264 boards are named and empty until this runs | one variable |
| Top up the Anthropic account | the cross-provider second opinion is out of credit | minutes |
| File the Wobo trademark in India, classes 41 and 9 | the legal backstop for the name | a lawyer |
| Create the listings: Wikidata, LinkedIn, Crunchbase, Product Hunt, Google Business Profile | this is what makes an engine answer "Wobo is an AI tutor" | an afternoon, copy is written |
| Razorpay keys | checkout answers 503 until they exist | minutes |
| Turn on Supabase leaked-password protection | an open advisory | one switch |
| Set the repo's git identity: `git config user.email` to the address of the Vercel account | every commit is authored by the machine (`depl@...local`), and Vercel now blocks a deploy whose commit author is not a team member; until then we deploy from a git-less export | one command |
| Push the branch | about 135 commits sit local | one command |

## The owner's walk, which gates the store apps

Before any store build, the owner walks the web version end to end on a real phone and says whether it
is ready. What that walk needs from us, and it is the same work that makes the store apps good anyway:
the ink at four out of four, the first real boards, offline lessons, a fast cold start on a cheap
Android phone, the camera path, share targets, notifications, and the install prompt in the right place.
When it is close, the owner gets a clean build and a route through every surface: the door, onboarding,
a lesson with the ink, a photographed doubt, the arcade, the parent's view, plans, and the console.

## Landed today

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
