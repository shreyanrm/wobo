# The stores: what is kept, keyed on what, and reused where

**The owner, 2026-09-08:** *"Style caching and content caching are two different things, and so are
components, and so is Wobo helping a learner with something generic and repetitive. Storage is cheap;
regenerating is sometimes expensive. Having these in our database to make use of will help."*

Agreed, and it closes a production hole: today the content cache is a directory on the gateway's
container with no persistent volume (scorecard fix 11), so every deploy discards everything generated
and pays again. The database is the record; the container's disk is a cache of a cache.

## 1. Five stores, five keys

| Store | What it holds | Keyed on | Reused across | Freshness |
|---|---|---|---|---|
| **Concept cores** | the idea, the why, the misconceptions, the check, the vocabulary (docs/CONTENT-INTERACTION.md 1) | concept | every board, grade, interaction, learner | on a core change, judged again |
| **Level renderings** | the reading, worked example, quiz at one board and grade | concept x board x grade x syllabus version | every learner at that level | on the syllabus version, or the core |
| **Interaction designs and components** | the model's composition of primitives for a concept; the template floors as fixed compositions; the six arcade mechanics | concept x interaction kind (designs); kind alone (templates) | every level of the concept; every concept (templates) | the refresh cadence (ninety days default) |
| **Visual assets, the "style"** | diagram SVGs, scene storyboards and their frames, the raster images, narration audio, the per-subject visual vocabulary (what a cell, a ray, a timeline look like here) | asset kind x concept x level where it matters, kind x subject for the vocabulary | across levels where the picture does not change with the grade, which is most of them | on the design law (DESIGN.md 0) or the concept |
| **Generic turns** | Wobo's answer to a question many learners ask in the same words: "what is a prime number", "why is the sky blue", "how do I balance this"; the say and the ink PLAN, never the rendered pixels | the normalised question x board x grade x subject x concept, with NO personal context in the key | every learner who asks it at that level | the syllabus version, the register law, the never-narrate law |

Binaries (SVG, PNG, WAV) go to a private storage bucket; rows go to Postgres with provenance, the
judge's score, the model that made it and its cost, a version, and `supersedes`, exactly as the
curriculum versions do. Nothing is edited in place.

## 2. The rules that make reuse safe

- **A generic turn is generic only when its context packet carries nothing personal.** No mind items,
  no "their world" facts, no page-specific anchors beyond the concept. The gateway decides at the door:
  a turn with personal context is never written to the store and never read from it. A learner's name
  is stitched in at serve time by the cheapest model or by a template, never stored.
- **Ink plans re-anchor at serve time.** A cached plan names semantic targets (the registry's), never
  pixels, so it lands on the learner's own screen; if a target is absent on this screen the plan is
  declined and the turn goes live.
- **The judge gate runs once, at insert.** A store never holds an unjudged core, level or design;
  a cached row is re-sanitised and re-linted on every read (wave 31), so a poisoned row is refused.
- **Version, never overwrite.** A refresh writes a new row with `supersedes`; the old one stays for the
  learners mid-chapter on it and for the revert.
- **A small in-process cache sits in front** (the plexus file store becomes that), because a
  database read is tens of milliseconds and a file read is not; the database is the truth when the
  container is new.

## 3. What it saves, and what it costs

The turn cache is the biggest saving: turns are the most frequent model call and the generic ones
repeat across every learner at a level. A concept core made once at sol and reused forever is the
second. Storage at Supabase's prices is pennies per gigabyte-month; the regeneration it replaces is
dollars per hundred lessons and grows with every learner. The one cost to watch is the judge call at
insert, which is why inserts happen once per concept and not per learner.

## 4. In the code

- Migration: `content.cores`, `content.levels`, `content.interactions`, `content.assets` (with a
  private `content-assets` bucket), `content.turns`; all service-role only; RLS on.
- `plexus/store.py`: the database behind the file store; the file store becomes the in-process front.
- `wobo.py` / `board/`: the generic-turn door (personal context excludes), the plan re-anchoring at serve.
- The console: a stores desk with hit rates, rows, spend saved (the ledger knows what a miss costs).
- Built in wave 37 with the rest of the content design.
