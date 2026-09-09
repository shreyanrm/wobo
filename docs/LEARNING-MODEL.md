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
