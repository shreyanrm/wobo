# BOARD.md — how Wobo draws

The board is the medium of every explanation. This file is the contract between the brain (which composes) and the hand (which draws). It is law for Wave 5 and after. Companion to `WOBO.md` (who Wobo is), `DESIGN.md` (how the product looks) and `docs/WOBO-PLAN.md` (the build).

## 1. The idea in one paragraph

The brain streams a drawing plan the way it streams words. The hand draws it stroke by stroke, timed to Wobo's voice, on one of three surfaces: directly on whatever is on screen, on a floating frosted plane, or on the full board inside a lesson. Every mark is a semantic object with an id, anchored to something real, never to pixels. Every number is computed by code and verified before it is drawn. The learner draws on the same surface and Wobo reads their ink. A board has a history, can be saved, and can be shared as an image.

## 2. Objects

A board is an ordered list of objects. Each object is JSON with a stable `id`, a `kind`, an `anchor`, a `style`, and kind-specific fields. The brain emits objects; the hand renders them; both sides keep the same list so either can refer to any object later.

**Marks** (about something): `point`, `circle`, `underline`, `arrow`, `bracket`, `strike`, `number`, `write`, `erase`, `wipe`.

**Shapes** (something new): `line`, `polyline`, `curve`, `polygon`, `ellipse`, `axis`, `grid`, `table`, `label`, `tex`, `bond`, `atom`, `region`, `image`.

**Controls** (a shape that reacts): `slider`, `toggle`, `input`, `drag` — a shape bound to a variable; moving it re-evaluates every object that depends on that variable.

Common fields:

```
{ id: "v1", kind: "arrow", anchor: {...}, style: {...}, t: { start: 0, dur: 600 }, depends: ["theta"] }
```

- `id` — short, unique within the board; the brain invents them; the hand never renames.
- `anchor` — where the object lives (section 3).
- `style` — `ink: "wobo" | "accent" | "learner" | "faint"`, `weight: 1..4`, `dash?`, `fill?`; colours resolve through the theme tokens, never literals.
- `t` — timing relative to the start of the current utterance in milliseconds; `dur` is the drawing time.
- `depends` — variable names; when a bound control changes, dependants are recomputed by the brain's verifier, not by the model.

Kind-specific fields are documented in `packages/wobo/src/board/schema.ts`, which is the single source of truth and is generated into the Python mirror the brain validates against.

## 3. Anchors

Nothing is placed by screen coordinates. An anchor is one of:

- `{ target: "<registry id>", at?: "center|top|bottom|left|right|<fraction pair>" }` — a registered surface target (a button, a card, a sim's axis, a video's frame object).
- `{ object: "<board object id>", at?: ... }` — another board object.
- `{ focus: "<focus id>" }` — the region the learner circled or selected.
- `{ board: [x, y] }` — board coordinates in a 1000-unit logical space, used only for shapes Wobo draws from scratch on the plane or the full board.

Anchors are resolved at render time and re-resolved on scroll, resize, theme change and layout shift. A mark whose target disappears fades out; it never floats.

## 4. Streaming protocol

A turn is a stream of events in order:

```
{ type: "say",   text: "At the top, the ball is still moving." , t: 0 }
{ type: "ink",   object: {...}, t: 180 }
{ type: "ink",   object: {...}, t: 900 }
{ type: "ask",   prompt: "Where is it moving fastest?", targets: ["p3","p7"] }
{ type: "action", name: "navigate", args: {...}, needs: "permission" }
{ type: "card",  ... }
{ type: "done" }
```

- Speech and ink are interleaved with timestamps so the hand can draw ahead of the voice; the first `ink` event must arrive before the first sentence ends.
- `ask` pauses the performance and waits for the learner; `done` closes the turn.
- Any event may reference earlier object ids (`{ type: "ink", object: { id: "v1", kind: "fade" } }`).
- On interrupt (tap, key, voice), the hand stops the pen mid-stroke and the voice mid-sentence; objects already drawn stay; the brain receives `{ interrupted_at: <object id> }`.
- On network loss the hand keeps what it has; on resume the brain continues from the last acknowledged event.

## 5. The three presentations

Wobo picks one; the learner can override with a word ("board", "here") or a gesture.

**The rule: the ink decides the surface.** When the thing to point at is already on the learner's screen (a chip, a line of the lesson, a step of their own working, a part of a diagram they are looking at), Wobo annotates it in place: a mark anchored to that registry target, on the screen, following the thing as the page moves. The board opens only when there is something new to build, and never with nothing on it. The brain's own naming of a surface is a hint, not the decision (`planner.choose_presentation`, `presentation.ts`); the learner's word beats both.

**Scroll during a stroke.** Finished ink needs no lock: it is anchored and re-measured on scroll. A stroke in progress does: the page is held still for exactly as long as a page-anchored stroke is mid-flight, released on the frame it lands, and the registry re-anchors on the release (`scroll-hold.ts`). It never holds longer than 1.5 s, Escape always releases it, and a finger that was already moving when the stroke began keeps its scroll.

| Presentation | When | Ink | Life |
|---|---|---|---|
| **On the screen** | a pointer, one line, a small clarification | anchored to what's there | fades after the utterance |
| **The plane** | a derivation, a diagram from scratch, more than a few strokes | anchored to plane space and to the screen beneath | persists until wiped; pin, shrink, drag, resize; sheet on phones |
| **The full board** | a lesson | plane space, full-bleed | persists per lesson; cards are regions |

The plane slides in from the orb and is frosted so the context beneath stays visible. Minimised, it keeps its ink and lives as a thumbnail near the orb. Multiple boards per session; "fresh board" starts another.

**The video case.** For our own videos the frame state at the paused timestamp is a registry target set (every object in the scene spec has an id), so Wobo annotates the frame exactly. For content we did not make, the circled region is read by a vision call and marked as such.

## 6. Domain pipelines

The brain does not draw a molecule from imagination. Each domain has a pipeline that turns a small intent into exact objects:

- **Math** — graphs and constructions from the math libraries already installed; equations from TeX to paths; derivations as ordered `write` objects with `depends`.
- **Physics** — vectors, free-body diagrams, projectiles, circuits, rays and waves from computed geometry; every quantity through dimensional analysis.
- **Chemistry** — molecules from SMILES through RDKit into bonds and atoms in a chemist's stroke order; equations balanced by code with coefficients that tick.
- **Biology and social science** — cells, food webs, timelines, maps, Punnett squares from the existing scene specs and fact base.

The verifier (CAS, dimensional analysis, balance checks, fact base) runs before any number is drawn. A failed check redraws or refuses; it never serves.

## 7. The hand

- **Pen physics.** Anticipation before a stroke, slight overshoot, settle. Strokes are drawn along their path at a pace that reads as a hand, faster for long lines, slower for letters.
- **Handwriting.** `write` uses Caveat glyphs converted to strokes so text is genuinely written, paced to the voice. The two-word first sentence rule stays: Wobo's voice starts on a short clip and the pen starts with it.
- **Aesthetic.** Marker on paper in light, chalk on slate in dark; the pen sound, subtle; ink that fades; an eraser swipe; a fresh board.
- **Choreography.** Wobo points before saying "this". Ink never lands after the word that refers to it.
- **Reduced motion.** Everything draws instantly, still in order, with the same voice timing.

## 8. The learner's ink

The same layer captures the learner's strokes. A stroke becomes a focus object with geometry and the targets under it. Wobo reads it in the next turn. Moving a bound control re-evaluates dependants through the brain. On tablets, stylus pressure varies weight; palm rejection is on.

## 9. Memory, history, export

- Every board keeps its object list and event log; the hand can scrub back in time.
- "Save to notes" stores the board (objects, not pixels) against the learner; "share" renders a branded image.
- What Wobo remembers of a board across sessions is governed by the consent tier in the brain.

## 10. Budgets

| Measure | Budget | Where measured |
|---|---|---|
| First spoken syllable | 1.5 s | cheap Android phone, 4G |
| First stroke | 1.0 s | same |
| Frame rate with 2,000 strokes on screen | 60 fps | same |
| Context packet | 2 KB screen snapshot, 6 KB total | brain |
| Plan size per turn | 40 objects typical, 200 max | brain |

The first two rows are measured, not asserted. `apps/web-pwa/tests/board-latency.spec.ts` holds the hand to the same numbers on a fast desktop — the strict reading — and `apps/web-pwa/tests/board-latency-throttled.spec.ts` puts the stated machine in: a 4x-throttled CPU on Chrome's Slow 4G profile, applied before the page opens, reporting both of the numbers above on every run, pass or fail. The first stroke is measured there today; the first syllable is reported as unmeasured, and its assertion skips with the reason written out, until the bench publishes a speech-onset number — a budget nobody took is worse than one that says so. The numbers never move; only the machine does.

## 11. What kills it

Placing by pixels. A component that does not register its targets. A number the model wrote instead of the code computing it. Ink that lands after the word. A board that forgets what Wobo drew. A plane that hides the thing it explains. Any of these and the board is a slideshow, not a teacher.
