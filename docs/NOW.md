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
web failures, two migrations sharing a number. **Wave 52 heals it** (21 closers, one per failure
group, each closing by its law rather than by whichever side is easier), then the seven waves resume
from where they stopped. Nothing they were building is dropped.

## Running now

| What | Wave | Where it is |
|---|---|---|
| Heal the tree the killed waves left | 52 | running, 2026-09-14 |
| The last tenth of the ink: size and placement solved together, one voice a turn | 48 | killed mid-round two; four of five builders finished; resumes after 52 |
| The mail law enforced, and the animation library on every surface | 38 | killed; the mail log, the nudges and the orb stills are half on disk; resumes after 52 |
| The boards: discovery runs, the cold start, the prewarm, the console | 45 | killed; resumes after 52 |
| The daily allowance, the models desk, the free pool cap | 36 | the money meter FINISHED (allowance.py, 33 tests); promo, the desk and the bar killed; resumes after 52 |
| One owner and per-person roles, the board that changes once, the four suggestions | 49 | killed; console roles, board change and suggest are half on disk; resumes after 52 |
| The growth desk, the press page, chapter pages at tier two | 50 | killed; the press screen and tier-two explained pages are half on disk; resumes after 52 |
| The mail law's 26 assertions, the 67 pages measured, the core's depth band | 51 | killed; the band key is half in store.py; resumes after 52 |
| The phone: the install prompt in its place, the share target into the doubt solver, offline lessons that really play, a cold start a cheap Android can live with | 53 | written 2026-09-14 from PLATFORMS.md section 5; launches when 52 lands |
| The parent's account screens | 34 | launches when 52 lands, with the seven |

## Landed, with the proof

| What | Wave | Proof |
|---|---|---|
| The ink's correctness at four out of four | 42, 47 | correctness scores 4.00; craft is what wave 48 is closing |
| The public site readable by a crawler that runs no script | 43 | 440 pages of real HTML, a canonical on each, a real 404 |
| The page families | 44 | the syllabus door, chapters, topics, subjects, comparisons, the blog |
| No trace of the old name | 40 | the gate scripts refuse it |
| The door closed to new accounts | 46 | `/v1/doors` answers `{"doors_open":false}` in production |
| Mail that reaches a person | 38 | the domain is verified and the first send landed in Primary |

## Queued, written, waiting only on the tree

| What | Wave | Why it waits |
|---|---|---|
| The content layers, the caches, the five stores | 37 | the concept cores that tier-two pages need |

## Decided, still to write

Nothing. Every decision on this board is running, queued on the tree, landed, or held below by a
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
| Push the branch | about 135 commits sit local | one command |

## The owner's walk, which gates the store apps

Before any store build, the owner walks the web version end to end on a real phone and says whether it
is ready. What that walk needs from us, and it is the same work that makes the store apps good anyway:
the ink at four out of four, the first real boards, offline lessons, a fast cold start on a cheap
Android phone, the camera path, share targets, notifications, and the install prompt in the right place.
When it is close, the owner gets a clean build and a route through every surface: the door, onboarding,
a lesson with the ink, a photographed doubt, the arcade, the parent's view, plans, and the console.

## Landed today

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
