# The learning model: chapters hold modules, and a group of modules teaches a topic

**The owner, 2026-09-09:** *"The subject has multiple chapters, and the chapter has multiple topics,
and each of those topics have multiple modules to master that particular topic, and these keep varying
based on that particular learner's pace and style and prerequisites and so on. So it's not modules
within that topic. It's multiple modules within that chapter, and a group of modules teaches the
topic."*

This supersedes the flatter reading in docs/CONTENT-INTERACTION.md section 9, where the architect's
output was described as levels belonging to a topic. It is the model everything else is built on.

## 1. The shape

    subject
      chapter                      from the board's own syllabus
        topic                      from the board's own syllabus; what must be learned
        module ── module ── module  the chapter's pool: how it is taught

- **Chapters and topics come from the board.** They are the syllabus, they are cited, and we never
  invent one. They answer *what* must be learned.
- **Modules are ours.** They live in the **chapter's** pool, not inside a topic, and they answer *how*
  it is taught. Each is one sitting: a single idea, a single mechanic, five to ten minutes.
- **A topic is taught by a group of modules**, and the group is a selection from the chapter's pool
  rather than a folder inside the topic.
- **A module may serve more than one topic**, which is precisely why it belongs to the chapter. Sign
  conventions serve linear equations and quadratics both; drawn once, it counts for both.

## 2. Why the group varies by learner

The pool is fixed for the chapter and made once. **The group is chosen per learner**, and it is where
the adaptation lives:

- **Prerequisites.** A learner who has not held the earlier idea gets the module that repairs it pulled
  into their group, from an earlier chapter's pool if that is where it lives.
- **Pace.** A learner who shows the topic is already held skips the modules that would only confirm it,
  and goes to the ones that stretch.
- **Style.** The same idea exists in the pool more than once, taught differently: a drawn one, a worked
  one, a simulated one, a game. Which one a learner meets depends on what has landed for them before.
- **What went wrong.** A module exists for each misconception a topic can produce, and it enters a
  learner's group only when they show it.

So two learners in the same class on the same chapter walk two different paths through the same pool,
and both arrive at the same topic mastered. That is what "it adapts to your pace and your way of
thinking" means in docs/copy/growth/lines.md, and it is now the mechanism rather than a claim.

## 3. What mastery means

A topic declares what must be true for it to be held: the ideas that must be understood, and the
misconceptions that must be gone. Not a module count, and never a score.

**A topic is mastered when the evidence exists**, gathered across whatever modules that learner did.
Two learners may reach it with four modules and eleven. Both are mastered, both light the same star,
and neither is told they took a different road.

The chapter is finished when its topics are held. The boss at the end tests the chapter across topics,
which is the point of it, and it is the only thing that tests more than one topic at a time.

## 4. Who makes what, and who pays

| | Made by | Once per | Paid by |
|---|---|---|---|
| the chapter's module pool, and which topic each module serves | the architect (`create.blueprint`, Astra) | chapter, board, class, syllabus version | the platform |
| each module's concept core and its mechanic | `create.core` (Astra) | concept | the platform |
| a module rendered for a board and class | `engine.compose` (Luna) | cell, then cached | the first learner who asks; free for everyone after |
| the group chosen for this learner, and the order | the planner, from the learner's state | every session | nothing; it is a selection, not a generation |

The last row is the important one: **adapting to a learner costs nothing**, because it is choosing from
a pool that already exists rather than making something new. That is what makes "it does not stop until
the topic is yours" affordable at five rupees a day.

## 5. What the pool has to contain for this to work

The architect designs the pool so that a group can always be found:

- **At least two ways in** for every idea a topic needs, taught differently.
- **One repair module per misconception** the topic is known to produce.
- **A stretch module** for a learner who already holds it, so the fast learner is never idle.
- **A prerequisite module** for each thing the chapter assumes but the board does not re-teach.
- Every module declares what it teaches, what it repairs, what it assumes, its mechanic and its
  minutes, so the planner can choose without reading the content.

A pool that cannot serve a learner who has missed the prerequisite is an incomplete pool, and that is a
judgeable fault.

## 6. What this changes in the tree

- **The blueprint's output** is a chapter's module pool plus the map from modules to topics, not a
  linear list of levels. docs/CONTENT-INTERACTION.md section 9 is amended to say so.
- **Progress** is per topic, evidenced through modules; the star lights on the topic, and the sigil is
  the topic's own (docs/REWARDS.md).
- **Experience points** attach to a module finished (10, as a card does today) and to a topic mastered
  (50), so a learner who needs more modules earns more along the way and the topic pays the same at the
  end. Nobody is paid less for finding it hard.
- **The climb** shows the chapter and its topics, never the pool; a learner sees what they are learning,
  not the machinery that chooses it.
- **The public chapter pages** list the board's topics, never our modules, because the syllabus is the
  board's and the pool is ours.

## 7. The seam, and where it stands (2026-09-10)

The two ends of this were built and never joined: the architect builds a pool on the gateway
(`plexus/blueprint.py`), the client walks one (`curriculum/blueprint.ts`: `groupFor`,
`blueprintWalk`, `groundUnder`), and nothing carried a pool from one to the other.
`placement.ts`'s whole "THE ARCHITECT FIRST" branch sat behind a `sources.assumptions` parameter no
caller passed, and `groupFor` was imported by no screen.

What now exists, end to end:

- **`curriculum.blueprint`** — a capability that READS a stored pool for one syllabus cell and
  never builds one. A cell without a pool answers null, a HELD pool is never served, and the count
  of held attempts rides along so a screen can be honest about "not yet"
  (`curriculum/api.py`, `test_curriculum_blueprint_route.py`).
- **`curriculum/pool.ts`** — one fetch per cell per session, validated by the same `isBlueprint`
  gate the walker uses, and `usePool` for a screen. The gateway's answer is remembered, "no pool"
  included; a failed request is not an answer and is asked again the next time the chapter opens
  (never once per render).
- **The placement check asks the architect's own ground.** `Course.tsx` hands the pool to
  `usePlacementGate`, which hands `groundUnder` to `planPlacement`; what the learner answers is
  what `unmetAssumptions` feeds to `groupFor`. That is the loop this document exists for, closed.

What is still open, said plainly rather than implied: **no pool has passed its judge yet** (the one
cell run is held at 42/48/58/58 against a bar of 70), and **the course still renders a level, not a
group of modules** — rendering a group needs the compose brief seam (`blueprint.compose_brief`)
wired into the content path, and until a pool passes, none of it can be proved on real content.

## The tutor never leaves (owner, 2026-09-15)

*"Is the content and teaching plan continuously optimising and personalising to the learner's needs
until they master or understand that topic? It should be motivating, continuous support, understanding
and guiding where they went wrong, and so on."*

Yes, and this section is the check that it is TRUE in code and not only in the plan. Five things must
hold, each with a test that plays a learner rather than reads a docstring:

1. **The group changes with the learner, every time.** After every module the group that teaches the
   topic is re-chosen from the chapter's pool using what just happened (right, wrong, how wrong, how
   slow, what they said), the prerequisites, the pace and the style. Not once at the start. A learner
   who gets a module wrong twice gets a different module next, never the same one again, and never a
   harder one.
2. **It stops only when the topic is understood.** The climb ends at the topic's own mastery evidence
   (docs/CONTENT-INTERACTION.md, docs/CURRICULUM.md), never at a fixed number of modules, never at a
   time. A learner who understands early moves on early. A learner who does not is given more, from
   the pool, at no extra cost (a group is chosen, not generated).
3. **Where they went wrong is said, in this concept's words.** Every wrong answer gets the reason it
   is wrong, drawn where the mistake is, from the concept core's own misconceptions. Never "incorrect,
   try again". Never a generic hint.
4. **It is motivating without lying.** The reward system (docs/REWARDS.md, docs/LEVELS.md) fires on
   effort and on progress, not only on right answers; the try-again ladder never repeats the same
   line; the tone after a wrong answer is the tone of a tutor who knows you can, not a form.
5. **The learner is never left.** No dead end: every screen after a wrong answer has the next thing
   to do, and the tutor stays in the room (the orb, the voice) rather than handing over to a menu.

What already exists: the chapter pool and the per-learner group (wave 37), the reward laws (docs/
REWARDS.md, docs/FEEL.md, docs/LEVELS.md, wave 38), the misconception-based feedback (docs/CONTENT-
INTERACTION.md section 4). What this section adds is the proof: an adversary that plays a struggling
learner end to end and reports where the tutor left, repeated, generalised, or stopped early.

## Who chooses: the device, and only the device (2026-09-16)

The group that teaches a topic is chosen **on the learner's device**, by `groupFor` in
`apps/web-pwa/src/curriculum/blueprint.ts`, out of the pool that `curriculum.blueprint` hands over
once per cell per session (`curriculum/pool.ts`). It is the only chooser, so nothing else can
overrule it. Rule 1's re-choice after every module is a call to `groupFor` with the learner's state
as it stands now. What ends a topic (rule 2) is decided on the device too, at one place
(`topicClosed`, below in "Proved before it is said"). Choosing costs no model call, no network call and no turn
from the learner's day, which is the property section 4 depends on.

**`curriculum.climb` is retired.** Wave 54 built a second chooser on the gateway: `climb.py`, a
handler in `curriculum/api.py`, a registry row at tier TINY with no cache, and `climb()` in the SDK.
Nothing ever called it, and it could not have been the chooser without breaking the rules it was
built for. This was measured on 2026-09-16 by playing the same learners through it and through
`groupFor`, on the same pool (the gateway's CBSE class 8 Science "Force and Pressure" fixture):

- **It was metered.** Every capability under `curriculum.` draws on the learner's turn counter
  (`budget.py`), and the money meter refuses a spent day (`allowance.check`). The test learner
  missed each module once and then got it. Signed in anonymously (six turns a day), that learner was
  refused with a 429 on the seventh call. They were still inside the first topic and held two of
  the chapter's six ideas. The climb ended at the meter, not at mastery, which breaks rules 2
  and 5. On the free plan, the same learner walked the chapter in 19 calls. That is 19 of their 40
  turns spent on being told what comes next, and the same counter pays for their questions to
  Wobo. Through `groupFor`, the same walk reached all six ideas with no network call at all.
- **It disagreed with the device on the first wrong answer.** On the same pool with the same
  learner, the gateway gave `p1 r1 r1 p3 r1 p3` and went to the repair after one miss. The device
  gave `p1 p1 p3 p3 r1 r1`, because the device counts one miss as a slip and two as a pattern
  (`wobo/reteach.ts`, `RETEACH_AFTER_MISSES = 2`). When two choosers disagree on the first miss,
  neither one is the authority. A test that proves one of them says nothing about what the learner
  actually met. That is how wave 54 recorded rule 1 as "made true on the gateway" while no learner
  ever reached that code.
- **It served nobody.** It kept nothing: the evidence arrived with each request and left with each
  answer. So it could not be the parent's view or a cross-device record. The cross-device record is
  the learner's synced state (`packages/sdk/src/mastery.ts`). Choosing is a pure function of the
  pool and that state, so every device derives the same group from it.
- **It needed the network.** A learner who was offline got no next module.

What was removed: the capability (its registry row and its entry in the expected list, the handler
in `curriculum/api.py`, and the SDK's `climb()` with its three types),
`services/gateway/src/wobo_gateway/climb.py`, and its two test files. All of it is recoverable from
commit `39548ee9`. The gateway's remaining part in choosing is the pool. `curriculum.blueprint`
serves it, once per cell per session, on a counter of its own that never spends one of the learner's
questions (`budget.READ`), and `create.blueprint` builds and judges it with
platform money.

**From here on, re-choosing is never a gateway call.** This section rules out any capability that
picks a learner's next module, per learner and per module, whatever it is called. A surface that
needs "what comes next", such as a parent's or a teacher's view, computes it from the learner's
synced state with the same pure function. It does not ask a gateway door. Three tests enforce this:

- `services/gateway/tests/test_one_chooser.py`: the gateway has no chooser door, a call from a
  stale client gets a 404 and costs no turn, and this section exists.
- `packages/sdk/test/no-chooser.test.ts`
- `apps/web-pwa/test/one-chooser.test.ts`: a struggling learner walks a whole chapter on one read
  of the pool.

**What the device's chooser does not read yet.** Rule 1 names five inputs: right, wrong, how wrong,
how slow, and what the learner said. `groupFor` reads right and wrong through the miss tally
(`stuckOn`), how wrong through `misconceptions`, and also the prerequisites and the style. It does
not read **how slow** or **what they said**. The retired climb read both. Its `pace_of` compared the
learner's seconds against the module's own minutes. Its `said_shows` matched the learner's own words
against the chapter's declared misconceptions and never guessed. Port both into `LearnerState` from
`39548ee9` instead of writing them again. Three more gaps were open when this section was written:

- Nothing in the committed course set `stuckOn` (docs/NOW.md). Wave 55's course builder is wiring
  it at the module boundary.
- `groupFor` can return nothing when a learner shows a misconception the pool has no repair for.
  The client's own fixture (`suggest/fixture.ts`) has no repair for `x3`. Played on that fixture, a
  learner who shows `x3` in t5 got an empty group. The retired climb searched the whole chapter's
  pool first, and when that failed it named the idea still open. `groupFor` has no such fallback,
  so whatever calls it must have one; wave 55's course builder is adding one at the course
  boundary. Either way, a pool without one repair per misconception fails section 5.
- `plexus/blueprint.py` still holds `group_for`, `walk`, `mastered` and `LearnerState`, the Python
  copy of the chooser. Only `test_plexus_blueprint.py` reads them now.

## Proved before it is said (2026-09-16)

Adversaries played the course after wave 55 and found three ways it still broke this section's
rules. A child who got 8 of 12 wrong, and only copied back equations a worked card had just solved,
was told the topic "is yours now". A child who got the first two right was finished after two
answers, because the practice run records each answer twice (as a learn-loop attempt and as a
practice answer) and both counted. The boss, on questions the child had never seen, came after the
topic was already closed and decided nothing. The course also held a blank page until the pool
request answered (66 s when it stalled), and it remembered a refused request as "no pool" for the
whole session. And the course and the Learn board read the band under two different keys, so a
chapter the course's own record said had slipped still read "Mastered".

What stands now, each part played before and after (`apps/web-pwa/tests/tutor-proves-it.spec.ts`):

- **One answer is one piece of evidence.** The mastery engine pairs the two reports of one answer
  and counts it once. Two answers to the same item are still two
  (`platform/kgtopg-contract-seed/src/reference/in-memory.ts`).
- **A worked module solves a twin.** It works an equation of the same shape as the item that beat
  the learner, with different numbers. Every line is computed, and the twin is never an item the
  course asks (`workedFor`, `twinEquation`). Nothing the learner will be asked is shown solved.
- **The boss is the proof, and the topic closes at one decision.** When the band holds, the boss
  door opens. `topicClosed` is the band held AND the boss passed (two of three). The greeting and
  completion come after it and never before. A boss that is not passed closes nothing. On a walk the
  course chooses again (`again`), and the door reopens only after a check sitting lands clean. A
  later round starts on a different question, and an exercise whose answer an earlier round showed
  counts as aided. The journey without a pool follows the same decision.
- **One record decides finished.** The course reads the band with the board's own function
  (`topicNodeId`). That function now returns the topic's node id when the id is a UUID, which is
  what the atom records its answers against. A completed topic whose band has slipped is walked
  again, not replayed as the fixed journey.
- **One tally decides stuck.** On a walk the practice run does not run Wobo's re-teach ladder. That
  ladder is a second chooser, and its re-teach is a model call. The module tally and `groupFor`
  decide.
- **The lesson never waits on the pool for more than a second.** The door (the placement check,
  then the lesson) waits at most `POOL_WAIT_MS` and then opens with the pool it has. That choice is
  locked for the topic, so a pool that arrives later never re-plans a door the learner is already
  through. It joins the walk at the next module boundary instead. A failed read is asked again the
  next time the chapter opens.
- **Reading the pool never spends a question.** On the gateway, `curriculum.blueprint` draws on a
  counter of its own (`budget.READ`, 400 a day, 120 anonymous), and a spent money day never refuses
  it (`tests/test_pool_read_costs_no_turn.py`).

Still open:

- The atom holds six items. After a boss round is not passed, the next round rotates the same three
  questions, so a learner who fails the boss several times in one sitting meets questions whose
  answers have been shown. Those answers count as aided, and the walk goes on, but no new unseen
  question exists until the node has more items.
- A boss passed two of three can, rarely, leave the band just under the floor (the reliability
  window slides by three answers). The course then says nothing closed and hands more practice,
  although the boss card has just said "a pass".
- The composed player has no walk, so Wobo's re-teach ladder is still the one chooser there, and
  its re-teach is still a model call.
