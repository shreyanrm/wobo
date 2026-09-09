# The wait: what a learner does while Wobo is making something

**The owner, 2026-09-09, with two screenshots of ChatGPT:** *"ChatGPT gives a very light game while the
content is being generated. It's so damn creative, don't you think? We should do something like this
too."*

Yes, and we can do better than they can for one reason: **their game is generic because they have no
subject.** A dot grid means nothing about the answer being written. We are a learning product, so a
wait can be worth something without being work.

Reference kept outside the repo at `design-reference/chatgpt-wait-game.png`.

## 1. The wait has three lengths, and each one gets a different thing

A game during a two second wait is over before it begins, and an animation during a two minute wait is
an insult. So the rule is by duration, decided when the wait starts because we know what we asked for:

| How long | What the learner gets |
|---|---|
| under 2 seconds | nothing but the orb's own breath; a wait this short must never draw attention to itself |
| 2 to 10 seconds | the orb doing the subject's thing, as already designed: a number line drawn, a pendulum swinging, a cell dividing, a page turning (docs/EMAILS-AND-ANIMATIONS.md section 3) |
| **over 10 seconds** | **the wait game**, offered rather than imposed |

The long waits are real and named: composing a course, rendering a film, reading a photographed page,
and the first learner on a board whose syllabus is being read (docs/BOARD-COLD-START.md).

## 2. The wait game

**It is offered, never imposed.** One line and one tap: play while this builds. A learner who ignores
it gets the animation and nothing is lost. A learner who taps gets something that starts instantly and
can be dropped at any moment.

**It is mostly play, lightly seasoned.** A tired child waiting for a course should not be quizzed. So
the games are games first, and where a fact fits naturally it is one they already know, never one they
are about to learn, and **never scored, never recorded, never shown to a parent.** Nothing that happens
in a wait is evidence of anything.

**Four to start, and each is composed rather than authored**, the same way the celebrations are
(docs/REWARDS.md):

| The game | What it is | Where it comes from |
|---|---|---|
| **Trace** | the concept's own sigil appears as a dotted outline and the learner draws over it with a finger | `ui/art.tsx` already generates a unique sigil per concept, so every chapter has its own shape to trace |
| **Catch** | shapes drift down in the subject's pigment; catch the ones that belong to the thing being built, let the rest fall | the concept's own parts, from the core |
| **Line up** | three or four things arrive out of order and are dragged into place | steps, sizes, dates, the order of a process, from what the learner already finished |
| **Just dots** | pure play in the subject's pigment, no learning in it at all | for the days when a child does not want to be taught anything |

**Never the same twice.** The pigment is the subject's, the shape is the concept's, and the difficulty
follows nothing at all, because it is not a test. Two learners waiting on the same chapter do not get
the same board.

## 3. The rules that keep it from becoming annoying

1. **The content arriving always wins.** The moment the thing is ready the game yields, immediately,
   mid-move if necessary. It never asks to finish. It never says "your course is ready" over a game;
   the game simply gives way to the thing they were waiting for.
2. **Nothing is lost by ignoring it.** No streak, no points, no badge, no consequence.
3. **One tap out, always visible.**
4. **It is silent by default**, like everything else.
5. **Reduced motion gets the still and no game.** A learner who has asked for less motion is not offered
   more of it.
6. **It never appears twice in a row for the same learner** unless they played the first one, because a
   thing offered and declined should not be offered again immediately.
7. **It is never a loading bar in disguise.** It shows no progress and no percentage, and the never
   narrate law holds: it never mentions what is being made.

## 4. Why this is worth building rather than a nice extra

The long waits are the ones that lose people, and we have several by design: a course is composed, a
film is rendered, a board's syllabus is read for the very first learner who picks it. Every one of
those is a moment where a fourteen-year-old decides whether this app is worth the wait. A spinner says
we are sorry. A game says the wait is ours to make pleasant, and it costs nothing per learner because
it is composed from things already generated and cached.

## 5. Where it lives

One component that takes the concept, the subject and the expected duration and returns the right
thing for the length of the wait. It ships with the animation library, because it uses the same twelve
moves and the same composed vocabulary, and it has one test per rule in section 3.
