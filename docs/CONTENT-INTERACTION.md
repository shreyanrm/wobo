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

## 3. The model designs the mechanic; templates are the floor, not the ceiling (owner, 2026-09-08)

**The owner:** *"Let's have our LLM be creative about the interactive content on a regular basis
rather than go with the same template."*

So the menu in section 2 is a vocabulary, not a catalogue. For each concept the model DESIGNS the
interaction: what the learner moves, what responds, what is revealed, what a wrong move teaches, what
the moment of surprise is. It writes that design as a composition of primitives the client already
renders (today: tap, drag, slide in `plexus/specs.py`; to add: drop zones with rules, sort, match,
sequence, timer, score, reveal, branch-on-answer, canvas mark), never as code: nothing generated ever
executes on a learner's device, exactly as simulations are declarative specs today. Any valid
composition renders; the schema (`codegen.py`) is the contract, and a composition the schema refuses
never ships.

The gate judges the design before it is cached: does the mechanic embody THIS concept (a wrong move
must teach something about the idea, not about the game); can a finger complete it at 390 wide; is
it genuinely different from the last three interactions this learner's chapter used; would a
fourteen-year-old feel the template. Below the bar, the model tries again one rung up; below it
twice, the concept's template from section 2 is used, so quality never falls under the template floor.

**On a regular basis:** the design is cached at the concept level (section 1) and refreshed on a
cadence the superadmin sets (default: a new design every ninety days, and immediately when the
concept core changes), so a returning learner meets new mechanics over a year without the cost of
generating per view. The judge's variety criterion reads the chapter's recent interactions from the
cache, so the model is told what it must not repeat.

## 4. What is generated per interaction, cheaply the items and their assets from the level rendering;
the feedback lines (a wrong sort says WHY the order matters, in this concept's words); the
"moment" (what changes, what is revealed, what the learner sees that they did not before).

## 5. What changes in the code

1. `plexus/store.py`: two keys, not one. The concept core keyed on the concept alone; the level
   rendering keyed on concept x board x grade x version (as wave 31 made it). A cache read for a
   level that misses falls back to the core and renders the level, never to a full generation.
2. `plexus/engines.py`: compose becomes two calls. `compose.core` (once, sol, judged hard) and
   `compose.level` (luna, from the core, judged against the core). The prompt for the level carries
   the core verbatim and the board, grade, chapter and syllabus version (wave 31's audience line).
3. `plexus/validate.py`: the interaction chooser before generation (rules, then luna); the judge's
   rubric scores a level rendering against its core, and scores an interaction on whether the
   learner would feel the template.
4. `plexus/specs.py` and `engines/`: the interaction primitives as a composable vocabulary (drop zones
   with rules, sort, match, sequence, timer, score, reveal, branch-on-answer, canvas mark) rendered by
   one composer component, plus the template floor for each row of section 2; every primitive with a
   hit area a finger can use (wave 32's fix for the marks applies to all of them).
   The judge's playability and variety criteria in `plexus/validate.py`; the refresh cadence as a
   superadmin setting (docs/ALLOWANCE.md's settings table).
5. `routing.py`: generate tier starts at luna and climbs one rung per rejection (the owner's rule);
   the core is made at the verify tier's model from the start (that is "better models where
   needed").
6. The ledger: cost per concept core, per level rendering, per interaction, so the saving is a
   number on the console and not a claim.

## 6. What a 4 looks like

A CBSE class 6 child opening "equivalent fractions" gets: a slider where they stretch a chocolate
bar into more pieces and watch two fractions stay the same size (build the idea), a sort of six
fractions by size with a wrong sort answered by the picture (check it), and a sixty-second
challenge to match equivalent pairs against the clock (make it fun). An ISC class 11 student opening
"nature of roots" gets the same three shapes with different content: a slider on the discriminant
that moves the parabola across the axis, a sort of equations by number of real roots, a challenge
to classify twenty in a minute. Neither feels like the other. Both cost a fraction of today.

## 7. The arcade: bonus levels in the middle of the climb (owner, 2026-09-08)

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

## 8. The creative side runs on Astra, and the platform pays for it (owner, 2026-09-08)

**The owner:** *"I think we should use Astra more on the creative side"*, and then: *"I want the
superadmin to be responsible for the creative billing. I don't want to charge the users; bill them
only for content and usage. This way our templates, caching and all the impressive stuff will be
top notch."*

So the three layers of §1 get their models by who pays for them:

| layer | job | tier and model | paid by | how often |
|---|---|---|---|---|
| concept core, the interaction's design, the film's choreography | `create.core` | **create: GPT-6 Astra** (Opus 5, then Flash behind it) | the platform's creative pool | once per concept and version, then cached for everyone |
| level rendering for a board, grade, version | `engine.compose` and the rest | generate: Luna, then the ladder | the learner's allowance | once per cell, cached |
| the served turn, the voice, the read page | `wobo.turn`, `voice.tts`, `doubt.read` | turn, tiny, voice, vision | the learner's allowance | every time |

The rules:
- **Astra designs, never serves.** It is on the create chain and on no other; nothing escalates
  into it; when the platform's day is spent it steps down to generate and the cache carries on.
- **One paid call makes several things.** A create call returns the core and two or three
  candidate mechanics for the concept at once, so the 90-day variety of §3 comes from the stored
  candidates and the judge's pick, not from paying Astra again. Regeneration happens on a signal
  (the judge's score, the observer's flag, a version change), never on a clock.
- **The platform pays** (`registry.PLATFORM_PAID`): a create call is never counted against a
  learner's daily allowance and never appears on a learner's or a parent's surface. It lands in
  the creative pool on the models desk, which has its own daily cap, its own line on the day's
  spend, and its own alert.
- **What it costs, in one line:** about 3k tokens in and 8k out per concept, roughly 0.45 USD on
  Astra against 0.01 on Luna; the whole seeded syllabus (1,493 nodes) is about 670 USD once, at
  the platform's pace, never in one night.

## 9. The architect (owner, 2026-09-08, the same hour)

> **Amended 2026-09-09 by docs/LEARNING-MODEL.md, which wins where the two differ.** The architect's
> output is a CHAPTER'S POOL OF MODULES plus the map of which modules can teach which topic, not a
> linear list of levels belonging to a topic. Modules live at the chapter, a group of them teaches a
> topic, a module may serve several topics, and the group is chosen per learner from the pool. Read
> that file first; the section below still holds for the thread, the flow, the misconceptions and the
> candidate mechanics.


*"Astra should be like a designer, an architect, a visionary. It needs to think how a certain topic
could be split and taught in the best possible ways, how the flow should be, what all types and
sub-modules or levels there should be."*

Today a syllabus topic is split into levels mechanically, and the only model-made course is the
free-text-goal path (`generate.course`: a learner's own ask, six to ten node names, and rightly the
learner's to pay for). The architect is a new job, `create.blueprint`, on the create tier, paid by
the platform, run once per topic, board, grade and syllabus version, judged, cached, and served to
every learner of that cell. Its input is the syllabus node and its chapter outline, the subject,
the board's register, the grade, and the archetypes we teach (never a person). Its output is the
**blueprint**:

- **The thread:** the one idea the topic is really about, in a sentence a learner of that grade
  would say, and the misconceptions the topic exists to undo.
- **The split:** the levels, each with its aim, its kind (a reading, a worked example, a
  simulation, a film, a set of items, a game, a boss), the concept cores it needs (which
  `create.core` then makes), the misconception it targets, its minutes, and what it assumes.
- **The flow:** the order and why; where a side door (the arcade, §7) sits and what it rehearses;
  where the boss goes and what it must prove; where a learner may skip ahead and where they may
  not; what a stuck learner is shown instead.
- **The variety:** for each level, two or three candidate mechanics from the primitives, so the
  90-day rotation of §3 is a pick from stored candidates, never a new bill.

The blueprint is judged on the verify tier against the syllabus (nothing outside the node, nothing
missing from it), the hours and register laws, and the content laws; a failed blueprint is
regenerated once on the create tier's second rung, then held for the superadmin. Rendering each
level for the cell stays on generate (Luna) and is the learner's; the web's placement keeps a
learner's progress along the blueprint's levels rather than along the mechanical split.
