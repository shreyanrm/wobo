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
