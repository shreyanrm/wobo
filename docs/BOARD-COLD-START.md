# The first learner on a board never sees an empty shelf

**The owner, 2026-09-09:** *"We should never show 'no syllabus' or whatever. We should put them on a
loading screen since it's the first ever user for that board while we fetch the actual syllabus, and
the next user selecting the same board will land there immediately, right?"*

Right, and the second half is exactly right: the first learner pays the wait once and every learner
after them on that board arrives instantly. The correction is only about how long the wait is, and it
makes the design better rather than worse.

## 1. What the wait actually is

Reading a board's syllabus is five stages: find the document on the board's own site, fetch it, read
it, have a second reader verify it against the same document, and publish it as a version. That is
thirty seconds to a few minutes, because the documents are long official PDFs and two models read
them. It is not a spinner's worth of time, and holding a fourteen-year-old on a loading screen for two
minutes is a worse first impression than the empty shelf we are replacing.

## 2. So the learner is never blocked, because teaching does not need the syllabus

This is the fact the whole design turns on: **our concept cores are board-agnostic.** Real numbers are
real numbers in Maharashtra and in Delhi. What a board's syllabus decides is the ORDER and the
COVERAGE of a learner's climb, not what a concept is or how Wobo teaches it. So a learner whose board
we have never read can start learning immediately, on the concepts their class and subject teach
everywhere, while their board's own syllabus is read behind them.

**What happens, in order:**

1. They pick their board and class. The discovery job starts in that instant, at the top of the queue,
   because a learner is waiting on it.
2. **A designed wait, not a spinner, and no more than about eight seconds.** The orb draws something
   from their subject, the way every loading screen in the product does (docs/EMAILS-AND-ANIMATIONS
   section 3). It never says what it is doing, never shows a percentage, and never mentions a syllabus.
3. **If the syllabus lands inside that window**, and for a board whose document we have seen before it
   usually will, they walk straight into their own climb and never know anything happened.
4. **If it does not**, they start anyway, on the class-and-subject plan every board shares, and the
   first lesson begins. When their board's syllabus lands, minutes later, their climb re-anchors to it
   quietly: same progress, same concepts, now in their board's order and with their board's chapters
   named. Nothing is lost and nothing is announced.
5. **Every learner after them arrives instantly**, because the version is published and cached.

## 3. What they are told, and what they are never told

The learner never reads "no syllabus stored yet". They never read that we are fetching anything. When
their board's syllabus is provisional rather than verified, the honest label already written for this
says so in a sentence a person would say, and it stays: found on the board's own site, still being
checked. That is confidence with honesty, which is the register.

The one case that needs a sentence is a board whose document we genuinely cannot find or read. Then
they are taught anyway, on the shared plan, and the board's chapters simply are not named yet. A
person picks it up from the console queue. They are never shown a dead end and never asked to wait
again.

## 4. Prewarm, so that the first learner is rare

Waiting for a first learner is the fallback, not the plan. The discovery worker runs ahead of demand
against the boards with the most students, so that by the time anyone picks Maharashtra or Uttar
Pradesh it is already there. The order is by student population, not alphabetical, and the console
shows the queue, what has landed, what refused and why.

## 5. The costs and the guards

- **The platform pays**, not the learner. A discovery is a few long-document reads, and it is paid once
  for every learner of that board ever, so it belongs in the creative pool beside the blueprints and
  the concept cores (docs/ALLOWANCE.md).
- **A budget per board and per day**, on the console with an alert, so a bad day cannot become a bill.
- **Nothing is published that a second reader did not verify against the same document**, and it is
  labelled provisional until a person confirms it. That gate already exists and does not move.
- **One job per board, ever, at a time.** Ten learners picking Maharashtra in the same minute wait on
  one job, not ten.
- **A refusal is remembered**, so a board whose document cannot be read is not re-fetched on every
  learner who picks it, and it goes to the console instead.

## 6. What this is worth

Two hundred and sixty-four boards currently name themselves and offer nothing. This turns the first
learner from each of them into the reason that board exists in the product, at a cost of one document
read. It is also the only way we cover India's state boards, where most Indian school students
actually are, without anyone typing a syllabus by hand.

---

## 7. As built (2026-09-15)

`services/gateway/src/wobo_gateway/curriculum/coldstart.py`, the cold branch of
`curriculum/api.py::_units`, `curriculum/labels.py`, the queue order in `curriculum/store.py`, and
`apps/web-pwa/src/curriculum/StatusCard.tsx`. Proved by `services/gateway/tests/
test_board_cold_start.py` (20 cases) and `apps/web-pwa/src/curriculum/cold-start.test.tsx` (15).
Where the build had to choose, it chose this:

- **The phrase is gone.** `labels.NO_SYLLABUS` and `no_syllabus_label` are deleted; a board we hold
  no syllabus for is now simply named (`labels.board_label`: "Official Maharashtra State Board…"),
  which claims only what §3 corroborated. What we hold is a machine field (`has_syllabus`), never a
  sentence. A test scans every quoted string under `apps/web-pwa/src`, `packages/sdk/src` and
  `packages/wobo/src` and fails on the phrase.
- **The wait's clock is the client's, and its ceiling is the brain's number.** A gateway that
  blocked for eight seconds would hold a request thread per waiting learner, so `curriculum.units`
  answers at once with `status: "shared"` and `wait_ms` (8000, `coldstart.WAIT_CEILING_MS`); the
  card counts to it and swaps the scene for the plan. Two tests pin the two halves to one number.
- **And the wait happens only when a syllabus can actually land inside it** (`api._wait_ms`,
  2026-09-15). The first cut sent the full ceiling whenever the chapter list was empty, whatever
  the job was doing, so §5's "every learner after them arrives instantly" was true only of a board
  that LANDED: on a board whose job refused, and on every board at all while
  `WOBO_DISCOVERY_WORKER` is unset — which is production today, 264 of the 268 — the second learner
  paid the whole wait again, and the third, forever. The ceiling now rides only on an answer whose
  job is open to the learner (`_learner_job_state`); otherwise `wait_ms` is 0 and they are on the
  shared plan in that instant. The row is untouched: it is still QUEUED for the console and for the
  worker.
- **And the job block beside the honest line says the same thing it does.** `_job_block` was the
  raw row — `open: true` and the stored "Looking for the official syllabus now" — while the answer's
  own `message` said the honest end. The SDK reads `job.open` (`packages/sdk/src/curriculum/
  parse.ts`) and `useDiscoveryStatus` polls until it is false, so on every cold board the client
  asked a question every four seconds whose answer could not change, and read the forbidden promise
  back each time. State, openness and line are now one reading of `_learner_job_state`, so the poll
  stops on the first answer and §4.6 holds over the whole payload rather than over one field of it.
- **The shared plan is CONCEPTS, from `content/catalogs/concepts.json`** — never a chapter, because
  chapters come from the board (docs/LEARNING-MODEL.md §1). It is the concepts more than one board
  teaches in that class and subject, most widely taught first, capped at 24; the board threshold
  relaxes to one board where two would leave fewer than eight (classes 11 and 12). Catalogue
  section headings ("Applications", "Word problems") are dropped from the plan and from nowhere
  else. Classes 6 to 12 all have a plan in maths, science and social science; **classes 4 and 5 are
  thin** (the graph holds ~50 concepts between them) and **a language has none at all**.
- **The one case that still needs a sentence is narrower than §5 assumed.** Not "we hold no
  syllabus for your board" but "we hold nothing anyone could be started on" — no chapters from this
  board and no shared concepts for this class and subject either, which in practice means a
  language. That case keeps the honest end and the own-syllabus door, unchanged.
- **The job is no longer refused in the same breath.** It used to be, because "Looking for the
  official syllabus now" about a search nobody is running is a promise §4.6 forbids. The cold start
  removes the promise instead of the job: nothing is said to the learner, so the row stays QUEUED —
  the console's queue and the backlog the worker drains the hour `WOBO_DISCOVERY_WORKER` is set.
  What a learner is TOLD is still the honest end (`api._learner_job_state`), computed on read and
  never written.
- **One job for ten learners** was already true (`store.enqueue_discovery` is one atomic
  find-and-insert); the cold start puts the learner's id on it, which is what moves it to the head
  of the queue ahead of prewarm (`store._queue_order`).
- **THE ROWS ARE DOORS, AND THE CEILING IS THE LEARNER'S (closed 2026-09-15).** Two halves of
  §2 were written and never joined, both found in a throttled 390px lab. First, §2.4's "the first
  lesson begins" was never true: `DiscoveryCard`'s `onStart` was declared optional "where a screen
  has nowhere to send them yet", no screen passed one, and `SharedPlanClimb` rendered each concept
  as a `<div>` — a learner on a cold board read up to 24 names and pressing one did nothing, with
  "Show me my syllabus" the only live control on the screen. `onStart` is now REQUIRED, every row
  is a `<button`, and all four callers send it to `sharedConceptRoute` — the composed-course seam
  (`Course.tsx`'s `custom:` prefix), which is the only door that can open on a concept no board of
  ours has named. The concept's canonical NAME travels, because `concept_id` is that name slugged,
  so the re-anchor can still find what was learned. Second, the eight seconds were the card's and
  not the learner's: the card cannot mount until the answer is in hand (`useUnits` reports
  `looking` off a view), so the fetch was charged on top of the ceiling and the plan landed at 9.1
  to 10.0 seconds. `useUnits` now reports `since` — the millisecond the learner opened the subject
  — and `remainingWait` spends the budget from there. Proved by eight new cases in
  `cold-start.test.tsx` and by `apps/web-pwa/test/teaching-wiring.test.ts`, which fails if any
  screen renders the card without a destination.
- **The re-anchor is built and proved as a function** (`coldstart.reanchor`: the board's order, the
  board's names, progress carried onto the board's node ids, and every concept the board does not
  name kept under the concept it was learned as; `announcements` is a field that exists to be
  empty). Its wire seam is `curriculum.units` with `anchor: true`, off the hot path because it
  walks the version's topics. **The client does not call it yet** — moving the learner's own
  progress store is the next wave.

## 8. As built: the prewarm and the console (2026-09-15)

§4 and §5, which §7's wave left for this one. `curriculum/discovery/prewarm.py`, the prewarm pass in
`discovery/worker.py`, `curriculum/desk.py`, four routes in `desks_api.py`, and the Boards desk in
`apps/web-pwa/src/admin/` (`syllabus.ts`, `SyllabusActions.tsx`). Proved by
`services/gateway/tests/test_prewarm.py` (19), `test_prewarm_worker.py` (9),
`test_syllabus_desk.py` (23) and `apps/web-pwa/src/admin/syllabus.test.ts` (21), each red first.
Where the build had to choose, it chose this:

- **The order is enrolment, and it is a rank rather than a claim.** `prewarm.SEED_ORDER` is 27
  Indian boards, biggest first — Uttar Pradesh, Bihar, Maharashtra, Madhya Pradesh, West Bengal,
  Rajasthan, Karnataka, Tamil Nadu, Gujarat, then the rest — carrying approximate state school
  enrolment of the order UDISE+ publishes. The numbers exist ONLY to set the order: none reaches a
  learner, a state's enrolment is a proxy for its board's roll rather than a count of it, and a
  number out by a million barely moves the rank. The console's stored order (`ops.settings`,
  `curriculum.prewarm.order`) wins outright when one is written, and a board id the registry does
  not hold is refused **by name** at the write rather than silently dropped.
- **Breadth first, not depth.** The plan walks RUNGS — every board's class 10 mathematics before any
  board's class 10 science — so a depth-first pass cannot spend a week finishing Uttar Pradesh while
  Bihar still has nothing. One board is never given two jobs in one pass.
- **A prewarmed board is only ever ENQUEUED, and it is queued LAST in the tick.** The drain has
  already run by then, so nothing queued ahead of demand can take this tick's slot from a learner;
  and `store._queue_order` now reads the prewarm's marker as the back of the queue rather than as a
  waiting person, so a learner arriving after two hundred prewarm jobs is still the next one drained.
  That last clause was a real hole: `requested_by` was the lane test, and `requested_by = "prewarm"`
  would have sat in the learner lane.
- **What a board cost is measured, not estimated.** `ledger.take_spend()` is drained before each run
  and taken after it, and the figure lands on the job's own row (`result.cost_usd`) for a stored run
  and for a refused one — a refusal after three searches and a 200-page fetch is not free. A run
  nothing could be priced on records `None`, never `0.0`, and the desk counts those separately so a
  board that cost something we cannot name never reads as a board that was free.
- **The desk shows which label each board is showing AND why.** The sentence is derived
  (`labels.label_for`) and sent over the wire; `apps/web-pwa/src/admin/syllabus.ts` contains no label
  text at all and a test reads the file to prove it. The `why` beside it is the console's own words
  about the derivation and never reaches a learner.
- **The gate did not move.** Promotion to verified needs `admin.manage`, a person SAYING in the body
  that they read the reading against the board's own document (409 otherwise), a version that is
  provisional, and a version that actually holds chapters — promoting an empty one would put the one
  label that names a board on a board with nothing behind it. Only `status` changes; 0008's
  `refuse_published_edit` guards every other column, and a correction is still a new version.
- **Retry is one board, chosen.** §5 remembers a refusal for a day so a dead host is not re-fetched
  on every learner; the console's button is a person overriding that for one board they have looked
  at. There is no "retry all", and a job still running is refused rather than re-queued.
- **NOT DONE: the per-board budget with an alert.** §5 asks for a budget per board and per day. The
  day is there (the platform's ceiling, the stranger lane, on the desk with its fraction) and the
  per-board SPEND is there; a per-board CAP that refuses a fourth reading of one board, and an alert
  that fires on it, are not built.
- **It has still never run in production.** `WOBO_DISCOVERY_WORKER` is not set on Railway, the desk
  says so as its first figure, and nothing in this wave was run against the real registry.

## 9. As built: the year the document is (2026-09-15)

The hole the first two-minds run fell into, and the stage that now stands in it.
`curriculum/discovery/dating.py`, `verify.document_is_current` and `verify.CHECK_DOCUMENT_YEAR`,
the gate in `discovery/job.py` before a model is paid, `Document.created_at` in `discovery/fetch.py`
and the fifth discovery dial. Proved by `services/gateway/tests/test_discovery_year.py` (46 cases,
red first), every number in it taken off the run that found the fault.

**What happened.** On 2026-09-15 the pipeline read Maharashtra's Std X Mathematics off
`mahahsscboard.in/sscsyllabus.pdf`, passed all nine structural checks, got the second reader's
agreement, and reported `would_publish: true` with the label "Found on the board's site, still
checking". The transcription was faithful — all thirteen names are on pages 158 and 159, and the
document re-fetches to the same sha256. **The document is the syllabus sanctioned by the Government
of Maharashtra letter of 12/03/2012.** Its own `/CreationDate` is 2013-05-24 and the extractor
answered `"version": "2013"` when it was asked what year the document states. Maharashtra revised
Std X Mathematics for 2018-19: the reading is missing Financial Planning and Pythagoras Theorem and
carries Geometric Progression, Cramer's rule, normal distribution and Euler's formula, none of
which the board sets at Std X any more. **No stage — search, fetch, extract, verify, persist —
asked what year it was.** A faithful reading of a withdrawn document is still the wrong chapters in
a child's hands, and it arrives wearing the one label that says we have looked.

Where the build had to choose, it chose this:

- **The file's own date is a CEILING, and no reading may lift it.** The first cut ranked the
  reading's stated year above everything, which hands the one model in the loop the power to talk
  the gate out of a verdict by saying the year we want to hear. A pdf produced in 2013 cannot hold
  the 2026-27 syllabus, so the file caps how new the edition can be (plus one year, because a board
  typesets the coming year's syllabus the year before it takes effect). A reading may still LOWER
  it, which is the common case: a 2012 syllabus re-exported as a pdf in 2024 is still the 2012
  syllabus.
- **Years printed in the text are not a witness, and that is a measurement.** Maharashtra's pdf
  names 1954, 1964, 1986, 2005, 2010, 2012, 2013, 2014 and 2020 across two hundred pages of
  nineteen subjects, and the seventy pages `extract.select_pages` hands the reader for Mathematics
  are mostly other subjects'. Believing the newest year in the text would have passed this exact
  document on the strength of a 2020 printed on another subject's page. The HTTP `Last-Modified`
  header is refused for the same reason in the other direction: a 2013 pdf re-uploaded in 2024
  carries a 2024 header.
- **The question is asked twice, and the cheap half is asked first.** The file's date is free, so
  it is read at fetch and the verdict is taken before any model is paid — the same seam and the
  same reasoning as `document_is_plausible`. The reading's stated year can only be asked
  afterwards, so `CHECK_DOCUMENT_YEAR` is a tenth structural check as well.
- **A failure a redraw cannot fix is not redrawn.** Reading the same 2013 pdf again with "it is
  2013" named as the problem buys one more generation and the same answer, so `verify.redrawable`
  sends the job to the next candidate instead (`verify.UNREDRAWABLE`).
- **What the verdict claims, said narrowly.** "Out of date" is never a claim that the board has
  revised. It is "the only document we can find is much older than the year this learner is in, and
  we cannot tell from here which of the two reasons that is". A board that genuinely has not revised
  since 2015 is refused by this, on purpose: §2 teaches the learner on the shared concept plan
  either way, the refusal is remembered (§5) and it lands in the console queue with the year and the
  witness on it, where a person can open the document and say. The other trade puts a board's name
  on chapters nobody checked the year of.
- **A document that dates itself nowhere is not failed.** The check reports that it could not run,
  which does not block a provisional and does block promotion to verified — the existing rule, and
  the right standing for a syllabus whose year nobody has confirmed.
- **The window is a dial**, `discovery.document.max_age_years`, default six: about one state-board
  revision cycle plus a year of grace, and three years clear of NIOS 2023, the oldest syllabus the
  product actually publishes. It is a judgement about likelihood, not a fact about boards, which is
  why it moves from the console without a deploy.
- **The already-stored syllabi inherit it at the first learner, but only that far.**
  `curriculum/recheck.py` — the first-selection check of docs/CURRICULUM-OBSERVER.md §2 — runs
  `verify_extraction`, so a stored reading whose document turns out to be old can no longer be
  promoted to verified and goes to the review queue with the file's own date, the year we settled
  on and the reading's contrary claim all in one sentence a person can act on
  (`test_curriculum_recheck.py`). **What it does NOT do is demote:** the stored provisional keeps
  serving its chapters until a person acts, which is the existing behaviour for every mismatch and
  is not changed here.
- **NOT DONE, and it matters.** The four syllabi already published (CBSE, ICSE, ISC, NIOS) have
  **not** been swept for their year: `discovery/audit.py` is the pass that reads every stored
  version against its source in one run, and this check is not in it, so nothing has told us
  whether any of the four sits on an old document. Nothing here was run against the real registry
  or the production database, and `WOBO_DISCOVERY_WORKER` is still not set on Railway.

## 10. As built: the day survives the process that counted it (2026-09-16)

§5's *"a bad day cannot become a bill"*, closed one layer down. `curriculum/discovery/ceiling.py`
(`recover`, `run_key`, `Row`), the key handed to `ceiling.meter` from `discovery/job.py`, and
`store.recent_jobs(since=, states=)`. Proved by 15 new cases in
`services/gateway/tests/test_discovery_ceiling.py` and 2 in `test_discovery_worker.py`, every one
of them red first — 9 of the 15 fail on the old globals, the rest on a key the rows cannot match.

**What was wrong.** The four guards were real and they were all in module globals: the day's
tally, every board's total, the resting list and the refusal counts behind it. So the ONE process
that runs discovery in production started every one of them again at zero on each redeploy and
each crash-loop restart, while the bill went on being real — and a second replica would have held
a second private ceiling of the same size. Measured on the three state boards: 0.0342 USD
(Maharashtra, provisional), 0.0089 (Uttar Pradesh, refused), 0.0133 (Tamil Nadu, refused), one
class and subject each; `prewarm.SEED_TARGETS` is 14 rungs, so about 0.48 USD per readable board
per pass and about 9.5 USD for twenty boards — more than the 5.00 day ceiling in a single pass,
which is exactly the case the ceiling exists for and exactly the case a restart forgave. Bounded
per process, unbounded across restarts.

Where the build had to choose, it chose this:

- **The durable memory is the rows that already carry it, not a new table.** The worker writes
  `result.cost_usd` onto every row it ends (a refused run included) and `result.reason` on every
  refusal, one row per (board, class, subject). `ceiling.recover` reads the day's finished rows
  back on the first question asked after a start and once a minute after that, which is also what
  lets two replicas see each other's spending within a minute instead of never.
- **A run is never counted twice, because both sides agree what one run IS.** `ceiling.run_key` is
  board + class + subject, normalised, and `job.run_discovery` hands it to the meter, so the run
  this process billed and the row it became are one entry. It is deliberately not
  `job.discovery_key`, which carries the academic year: the row does not store a year, and a key
  the rows cannot produce is a key the recovery cannot match.
- **Money is keyed; refusals are counted.** A row can only remember the last refusal of a subject,
  so the recovery raises a board's refusal count to what its rows show and never lowers it. Three
  closed doors still rest a board, whether this process saw them or a dead one did.
- **The owner's wake outranks the rows for the rest of the day.** "Try it again now" from the
  console that the next read of the rows undid would be a button that did nothing.
- **A store that will not answer never stops a discovery.** The recovery logs, backs off 15
  seconds and leaves the guard holding what this process knows, which is the old behaviour rather
  than a worse one. It is asked at most once a minute, never once per verdict.
- **The query is narrowed at the source** (`recent_jobs(since=, states=)`, both stores): the day's
  finished rows only, up to 800 — the most a 5.00 USD day can physically hold at the cheapest run
  measured. A page of the newest rows of every state would have let a morning's queue push the
  morning's spending off the end of it, and a day read back short is a day that can be spent twice.
- **NOT DONE, and each of these is a way the recovered day reads LOW.** A run that dies mid-flight,
  before its row is written, is money on no row and nothing here can recover it — the window is one
  run, and the row is written the moment the run ends either way. A run nothing could be priced on
  counts as a run and as no money, exactly as the desk counts it, so a day of unpriced models would
  not fill the ceiling. **A re-check's money is not on its row at all**: `recheck.Outcome.as_result`
  writes no `cost_usd`, and a re-check shares the discovery row for its (board, class, subject), so
  after a restart a day of re-checks reads as free. That is a one-line fix in the re-check's own
  result and it is not made here. The per-board ALERT §5 asks for is still not built: the cap
  refuses, and nothing pages anyone when it does. And none of this was run against the production
  database: `WOBO_DISCOVERY_WORKER` is still not set on Railway.

## 11. As built: the refusal that said the opposite of what happened (2026-09-16)

§5's last clause — *"a refusal is remembered … and it goes to the console instead"* — was true of
the row and false of what the row said. `discovery/job.py`, `discovery/verify.py`,
`discovery/worker.py`, `curriculum/desk.py`, `discovery/lab.py` and the console's refused table.
Proved by `services/gateway/tests/test_discovery_unreadable.py` (16 cases, red first), one case in
`test_discovery_worker.py` and two in `apps/web-pwa/src/admin/syllabus.test.ts`.

**What happened.** The 2026-09-15 runs refused Uttar Pradesh, Class 10, Mathematics under
`no_syllabus_in_document`, whose learner line is *"What I found … is not the syllabus itself"* and
whose console gloss was *"what was found is not the syllabus"*. Both are the opposite of the fact.
The candidate, `prereg.upmsp.edu.in/Downloads/Syllabus/Class10/928_Class-10th Math.pdf`, **is** the
board's Class 10 Mathematics syllabus — an earlier run the same afternoon had a model transcribe
the whole of it, seven units and seventy marks
(`harness/reports/discovery-20260915-163622-states/upmsp.json`). Its text layer is a legacy
Devanagari font: pypdf reads `bdkbZ&1 % la[;k i)fr&` where the page shows `इकाई-1 : संख्या पद्धति`,
so `document_is_plausible` found neither "Class 10" nor "Mathematics" in it and the run refused for
the only reason it had. The one true sentence — the record's `detail`, "the document never names
Class 10; the document never names Mathematics" — lived on the in-memory `JobRecord` and the worker
never wrote it to `discovery_jobs.result`, so the console row carried the false category and
nothing to contradict it.

Where the build had to choose, it chose this:

- **The two facts are told apart by asking the FILE what it is.** `verify.text_layer_is_unreadable`
  answers only when the document's text names NEITHER the level nor the subject **and** the name
  the board published the file under — its url path and the title in the pdf's own `/Info` — names
  one of them. Both halves are required: if the text named the level and only the subject failed,
  the text layer was readable and the document is simply not this subject's. The search result's
  title is deliberately not evidence; that is a third party's claim about the file, and the whole
  weight of this verdict is that it rests on what the board itself published.
- **The filename is read the way a filename is written.** `_norm` deletes punctuation rather than
  spacing it, so `Class-10th` becomes one word no level token is inside of. The file's own name
  gets its own normaliser: punctuation to a space, and a letter-to-digit boundary to a space, so
  `/Syllabus/Class10/928_Class-10th Math.pdf` reads as "class 10".
- **The new line claims only what we know.** "I found a document for {what} on the board's site and
  could not read what is written in it" — never that it is the syllabus, which the file's name is
  not proof of, and never that it is not, which is the lie being removed. The own-syllabus door is
  the same one.
- **The old reason is narrowed, not deleted.** `no_syllabus_in_document` still refuses a document
  that genuinely is not a syllabus — a question paper, another subject — which is what the reason
  was always true of and is still what the extractor's own refusal produces.
- **A refusal carries the trail, not only its last line.** `JobRecord.tried` is every candidate the
  run opened, the title it was offered under and what became of it, and the worker writes it and
  the `detail` onto the job row. Tamil Nadu is why: one candidate,
  `dge.tn.gov.in/docs/examina/sslc.pdf`, titled "SSLC Public Examination – Scheme of Examination",
  refused `tls_untrusted` — and a row reading "pages were found, the document itself would not
  open" reads as a TLS fault worth retrying. It is not. **That host is the exam directorate, the
  candidate is a scheme of examination rather than a syllabus, and Tamil Nadu's syllabus is
  SCERT's**, so a fixed certificate chain would find the same wrong document. The trail is what
  puts that in front of a person instead of leaving it in a log.
- **NOT DONE, and it matters.** The registry's `official_site` for `tn-dge` is still the exam
  directorate, so the `site:` query still asks the wrong body for Tamil Nadu's syllabus; changing
  it is a registry data change and is the owner's call, not a silent one. Uttar Pradesh still does
  not LAND — this wave makes the refusal true, it does not read a legacy font, and there is no
  image-rendering or transcription path in discovery (`fetch` refuses a textless pdf outright as
  `pdf_has_no_text`). Nothing here was run against the production database or the real registry,
  no lab was run, and `WOBO_DISCOVERY_WORKER` is still not set on Railway.
