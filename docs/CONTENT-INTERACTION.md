# Interactive content: the concept is cached, the level and the interaction are chosen

**The owner, 2026-09-08:** *"For interactive content, think of the quality gate where you decide it
should be gamified, or drag and drop, or selection, or whatever it may be; it will be a mix of
different types. We need to learn to cache a concept, not a template; templates too, but not
blindly the same thing for everything; be smart and creative about it. This is how we cut costs
by optimising."* And, the same morning: *"top quality at the lowest cost possible; better models
only where needed."*

This reconciles two things that pulled against each other in wave 31: the artifact key now carries
the board and the class (correct: a CBSE class 6 child and an ISC class 11 student must not get the
same words), which means every board regenerates everything (wrong: most of what makes a concept
teachable does not change between boards).

---

## 1. Three layers, three prices

| Layer | What it holds | Keyed on | Made by | Reused across |
|---|---|---|---|---|
| **Concept core** | the idea in one paragraph, the why, the two commonest misconceptions and the counter-example for each, the one check that proves understanding, the vocabulary with the board's own terms marked | concept | the strongest text model, judged by the strongest judge, once | every board, grade and interaction |
| **Level rendering** | the reading at this grade's length and register, the worked example with this board's numbers and units, the chapter's own names, the quiz items at this grade's complexity | concept x board x grade x syllabus version | the cheapest model that passes, from the core, judged | every interaction type at this level |
| **Interaction** | the drag-and-drop, the sort, the match, the slider or simulation, the build, the challenge, the selection: the mechanics and the assets, filled from the level rendering | concept x level x interaction type | a template filled by rules where rules suffice, the cheapest model where they do not | itself |

The concept core is the expensive thing and it is made once. The level rendering is cheap because
it is a transformation of the core, not a fresh generation, and the judge scores it against the
core (did the level keep the idea and the misconception?) rather than against nothing. The
interaction is cheapest of all: a template is code, not a model call.

**Cost, from the price table (docs/OPERATIONS.md 11.2):** a concept core at sol is about USD 0.05;
a level rendering at luna is about USD 0.002; an interaction from a template is USD 0. Today one
cell costs USD 0.27 to 1.1 (wave 30's manifests). Three boards and four grades of one concept
today: twelve full generations. Under this: one core, twelve level renderings, templates. About
one tenth of the money, and the core is better because it was made by the strongest model once.

## 2. Choosing the interaction: the gate decides, per concept, from a mix

The quality gate (plexus/validate.py) already judges an artifact after it is served. It gains a
step BEFORE generation: **what kind of interaction does this concept want?** Chosen from a fixed
menu, by rules first and a small model where rules cannot decide, and recorded in the concept core
so the choice is made once:

| The concept is... | The interaction that fits | Example |
|---|---|---|
| a classification, a taxonomy, parts of a whole | **drag and drop into bins**, **label the diagram** | plant cell organelles; types of rock; parts of speech |
| an ordering, a sequence, a chronology | **sort into order** | steps of respiration; the non-cooperation movement's events; a proof's lines |
| a correspondence, pairs, cause and effect | **match** | term to definition; ratio to picture; cause to consequence |
| a quantity that varies and a relation that holds | **slider and see**, **simulation** | equivalent fractions; a projectile; Ohm's law; supply and demand |
| a construction, a derivation, a procedure | **build it step by step**, with a check at each step | balancing an equation; a ray diagram; a Punnett square |
| a discrimination among near things | **selection**, one of several, with distractors that are real misconceptions | which step is wrong; which is the hypotenuse |
| a skill that benefits from repetition and speed | **a challenge with a score** (the gamified one) | times tables; unit conversions; date recall |
| an idea that needs to be seen moving | **a film** (the storyboard with real motion) | the water cycle; how a lens bends light |

A concept gets a MIX: a plant cell wants label-the-diagram AND a selection AND a short film;
fractions want slider-and-see AND a sort AND a challenge. The rule for the mix: one interaction
that builds the idea, one that checks it, one that makes it fun, never three of the same kind. The
menu is the templates the client already has (engines/: Discovery, MiniWorkbook, SimRunner,
PerturbationSandbox, WhatIfNumerical, WordProblemBreakdown, CompareInteractive, ConceptMap,
Flashcards, MotionPlayer, the subject scenes) plus what is missing from it today: **drag and drop
into bins**, **sort into order**, **match**, **build step by step**, **the challenge**.

## 3. Templates, but not blindly

A template is a mechanic, never a look. "Sort into order" is one piece of code; the five things
being sorted, their names, the picture on each, the feedback on a wrong order, the register of
the words are all from the level rendering, so the same template on two concepts looks and reads
like two different things. The judge's engagement lens (wave 30 scored it 1.12 of 4: "one visual
idea per cell, templated") is the test: a learner should never feel the template.

What is generated per interaction, cheaply: the items and their assets from the level rendering;
the feedback lines (a wrong sort says WHY the order matters, in this concept's words); the
"moment" (what changes, what is revealed, what the learner sees that they did not before).

## 4. What changes in the code

1. `plexus/store.py`: two keys, not one. The concept core keyed on the concept alone; the level
   rendering keyed on concept x board x grade x version (as wave 31 made it). A cache read for a
   level that misses falls back to the core and renders the level, never to a full generation.
2. `plexus/engines.py`: compose becomes two calls. `compose.core` (once, sol, judged hard) and
   `compose.level` (luna, from the core, judged against the core). The prompt for the level carries
   the core verbatim and the board, grade, chapter and syllabus version (wave 31's audience line).
3. `plexus/validate.py`: the interaction chooser before generation (rules, then luna); the judge's
   rubric scores a level rendering against its core, and scores an interaction on whether the
   learner would feel the template.
4. `plexus/specs.py` and `engines/`: the five missing templates (drag into bins, sort, match, build
   step by step, the challenge), each a real component with a hit area a finger can use (wave 32's
   fix for the marks applies to all of them), each with its feedback slot.
5. `routing.py`: generate tier starts at luna and climbs one rung per rejection (the owner's rule);
   the core is made at the verify tier's model from the start (that is "better models where
   needed").
6. The ledger: cost per concept core, per level rendering, per interaction, so the saving is a
   number on the console and not a claim.

## 5. What a 4 looks like

A CBSE class 6 child opening "equivalent fractions" gets: a slider where they stretch a chocolate
bar into more pieces and watch two fractions stay the same size (build the idea), a sort of six
fractions by size with a wrong sort answered by the picture (check it), and a sixty-second
challenge to match equivalent pairs against the clock (make it fun). An ISC class 11 student opening
"nature of roots" gets the same three shapes with different content: a slider on the discriminant
that moves the parabola across the axis, a sort of equations by number of real roots, a challenge
to classify twenty in a minute. Neither feels like the other. Both cost a fraction of today.

## 6. The arcade: bonus levels in the middle of the climb (owner, 2026-09-08)

**The owner:** optional study arcade games as bonus levels for extra XP, "every now and then in the
middle" of a chapter, since the boss level already sits at the end.

What exists: `engines/ArcadeShell.tsx` (score, lives, restart; one mechanic, answers rain down and a
wrong catch costs a life; wired to real quiz items; records real evidence), the `bonus` stop type on
the home map in marigold, and a once-keyed bonus award so XP cannot be farmed.

The rules:
- **Placement:** in the middle, not the end. After every second or third topic of a chapter, a bonus
  level appears as a side door off the climb: optional, never in the path, never a nag. The boss
  level stays the summit.
- **The mechanic is the concept.** A bonus level exists only where speed or recall is genuinely the
  skill (times tables, unit conversions, equivalent-fraction pairs, dates and order, balancing under
  a clock). Never a multiple-choice quiz with lights on: the judges scored engagement 1.12 for
  exactly "no tap can be wrong" and "all recognition".
- **Six mechanics, not one skin:** catch, sort against the clock, match pairs, defend the number
  line, build the sequence, the running quiz with lives. Templates filled from the level rendering,
  zero model calls per play; the same game on two chapters looks and reads like two games.
- **XP:** bonus XP is capped per day and separate from the XP that unlocks levels; a reward, never a
  shortcut past the learning.
- **The register and the never-narrate law hold inside a game.** Calm; older classes get a lighter
  shell than class 6.
