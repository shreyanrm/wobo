# DESIGN.md — Wobo, how it looks, feels, and behaves

Companion to `CONTEXT.md`. This file governs every visual and interaction decision. It is law. When a screen could belong to a generic edtech app, it has failed — rebuild it.

Product copy everywhere: sentence case, no emoji, no exclamation marks, calm and certain.


---

## 0. Law v5 — white paper, colour with a job (owner, 2026-09-04, supersedes the cream ground)

The ground is **white**. Colour is an accent, never a wash. A section does not get a tint to
tell you it is a new section; space and type do that. This replaces the cream paper of law v3
and v4 everywhere: site, app, email, prototype.

**Paper (light).** `paper #FFFFFF` the ground · `paper-2 #F6F6F8` surfaces (cards, inputs,
rails) · `paper-3 #ECECF0` pressed · `line #E4E4EA` the one hairline allowed, and only as a
separator between list rows, never as a box · `ink #14142B` · `ink-2 #55556B` · `ink-3 #8A8A9E`.
**Night.** `paper #0E0E16` · `paper-2 #17171F` · `paper-3 #1F1F29` · `line #26262F` ·
`ink #F4F4F7` · `ink-2 #B4B4C2` · `ink-3 #7E7E90`. Designed, never inverted.
**Accents, each with a job.** `pig #2B45FF` the pointer (one per view) · `marigold #FFB629`
the highlighter and the earned moment · `mint #12B981` confirmation · `rose #FF6B57` the thing
that needs care · `violet #7C5CFF` sparingly, for depth. An accent that is not doing one of
those jobs is decoration; take it out.

**Reference:** `design/prototypes/landing-v8.html` is the built expression of this law and the
source every surface copies its tokens, spacing rhythm and motion from.

### Spacing and responsiveness
One rhythm for the whole product: `--gutter clamp(20px,5vw,48px)`, `--band clamp(72px,9vw,132px)`
between sections (half from each side, so two sections never stack two bands of air), and
`--colgap clamp(32px,5vw,80px)` between the halves of a row. Every grid child carries
`min-width:0`. Three widths are the contract: 390, 834, 1440, in both themes, with no
horizontal scroll at any of them.

### Motion that never stutters
The jitter has three causes and all three are forbidden:
1. **A CSS transition on a property GSAP is scrubbing.** One owner per property, always.
2. **Scrubbing a layout property** (`width`, `height`, `top`). Transform and opacity only.
3. **A tween created per scroll frame.** Fire on state change, never inside `onUpdate`.
A magnetic control moves an inner element, never itself: moving the box out from under the
pointer makes the pointer leave, which resets it, which brings it back — the loop the owner
saw as jitter on 2026-09-04.

### Copy law (owner, 2026-09-04)
- **No names.** Never "Aanya", never any invented learner or parent. Say "your child", "the
  learner", or address the reader directly.
- **No grade gate.** Never "classes 4 to 12" or any age range on a public surface. Say "every
  subject your board sets". Anyone may sign up and see for themselves.
- **No raw allowances.** Never "40 questions a day". Say what it feels like: "enough for a
  normal evening", "five times the free allowance". Free carries no multiplier at all.
- **Location is inferred, never asked.** No country switch. Read the browser's time zone, or
  the request's country on the server, and show that currency.
- **Promote before you invite.** Until the product opens, the closing call is early access,
  not "begin tonight".
- **Drawing is one part.** Never let a surface imply the board is the whole product: it also
  films, simulates, speaks, practises, remembers and reports.

### The five traps this repo has already paid for
Every one of these produced a bug the owner saw with his own eyes. They are cheap to avoid and
expensive to find, so they are law rather than advice.
1. **A short class name means two things.** `.sub`, `.quiet` and `.ask` each meant one thing in a
   shell and another in a section, and each printed a stray box or a shifted row. Namespace every
   class a page adds, and grep it against the shell it renders inside before shipping.
2. **Grid auto-placement never moves backwards.** A child explicitly placed in an earlier column
   AFTER one in a later column lands on the NEXT ROW. It put every left-hand node of the climb
   sixty-five pixels below its own dot. Pin `grid-row` on both children.
3. **A descendant selector reaches too far.** `.claims div`, `.report .kpi span` and their kin
   matched inner wrappers and collapsed rows into thirty-pixel columns of single words. Use child
   selectors. Seventeen were tightened in one sitting.
4. **`white-space: nowrap` on anything long.** One highlighted phrase forced the whole page to
   1731px. If a mark must ride its words, paint it on the span with `box-decoration-break: clone`
   so it wraps.
5. **An annotation drawn at guessed coordinates drifts.** Hand-placed SVG marks over SVG text moved
   off their words at other widths and in other themes. A mark rides its own word: wrap the word and
   let the mark be that element's own background or `::after`.
Alongside them, two rules of proof: the first paint shows the page at rest, with nothing parked at
`opacity: 0` waiting for a scroll, and every page is measured at 1440, 834 and 390 in both themes
with `scrollWidth === clientWidth` and zero console errors before anyone calls it done.

---

## 1. The standard (law v3, superseded on colour by §0 above) — bold ink on good paper

Wobo looks like something drawn by a confident hand on thick paper: bold ink, warm paper, a few pigments used on purpose, and a character that is alive. Calm, but never thin. Friendly, but never childish. The wordmark sets the tone: round, chunky, sure of itself. Every screen has to feel like it belongs to that logo. When a screen could belong to a generic edtech app, or to a corporate dashboard, it has failed — rebuild it.

Two people have to love every page: the parent who pays and the learner who uses it. Beauty is not decoration here; it is the proof that someone cared, and it is what makes a hard subject feel approachable.

## 2. Brand tokens — built as code tokens, never generic defaults

**Paper (light).** `paper #FAF7F0` a warm cream ground · `paper-2 #F1EDE3` surfaces (cards, inputs, sheets) · `paper-3 #E7E1D3` pressed and secondary · `ink #14142B` a deep navy-black · `ink-2 #4E4E66` · `ink-3 #8A8A9E`.
**Night (dark).** `ground #0F1226` deep navy · `surface #181C3A` · `surface-2 #22264A` · `ink #F3F0E8` cream text · `ink-2 #B8B6C6` · `ink-3 #7C7B92`. Dark is designed on its own, never inverted: pigments lift a step, washes drop to their night tints.

**Pigments, each with a job.**
- **Wobo blue `#2B45FF`** (night `#7C8CFF`) — the brand, Wobo's pen and eyes, primary actions, links, the ink thread.
- **Marigold `#FFB629`** (`#FFC85A`) — the second brand colour: the highlighter, a win, a lamp's glow, "Begin tonight".
- **Coral `#FF6B57`** (`#FF8A78`) — warmth: the learner's own moment ("oh, that's why"), the line in a parent's note worth underlining, the "live" pulse.
- **Mint `#22C48B`** (`#4FE3BD`) — correct and safe: the tick, "verified", a saved place, the free-plan marks.
- **Lilac `#B7A6FF`** (`#C9BDFF`) and **violet `#7C5CFF`** (`#A996FF`) — depth and the far end of any blue gradient; tiles for language and reading; never alone as text.
- **Washes.** Every pigment has a tile tint (`pig-w #E6EAFF`, `marigold-w #FFF1D6`, `rose-w #FFE7E2`, `mint-w #DDF6EC`, `lilac-w #EFEBFF`, and their night versions) for product tiles, callouts and selected states. One leading pigment per surface; a second only as a wash. Never a rainbow, never grey-on-grey timidity either.

**Type.** **Poppins** for every interface word: display 700 at 48–120 px, tracking −0.03em; title 600 at 28–40, −0.02em; heading 600 at 20–24; body 400 and 500 at 16–17 / 1.55; label 500 at 13. Sentence case everywhere. All-caps tracked labels only for chapter markers, and rarely. Tabular numerals wherever numbers align. **Caveat** 600/700 only for what Wobo writes by hand: the board, notes, greetings, one-line delights. No third face.

**Shape.** Round and chunky, like the wordmark. `radius-s 10px` buttons and inputs · chips are pills · `radius-m 16px` cards and sheets · `radius-l 24px` the plane, modals, hero panels. Nothing sharp, nothing 3 px.

**Line.** There are no border lines in the interface: no 1 px card edges, no hairline dividers, no outlined inputs. Surfaces separate by tone (`paper-2` on `paper`), by space, and by shape. The only lines on a screen are the ones Wobo draws, and those are bold: **3 px** ink on screens (2.5 px minimum on a phone), **4 px** for illustration outlines and hero drawings, round caps and joins, the hand-wobble kept. A rule Wobo draws under something is 2 px at least. Anything thinner reads as a photocopy of a pencil and is a defect.

**Depth.** Tone and space first. Soft, tinted, diffuse shadows are allowed only on things that float: the plane, the docked orb, sheets, menus, toasts — `shadow-soft: 0 12px 40px rgba(31,53,224,.10)` on paper, `0 16px 48px rgba(0,0,0,.5)` on graphite. Actionable cards may lift 1 px on hover with `shadow-lift: 0 6px 20px rgba(26,26,31,.08)`. Never a hard or small shadow, never a shadow on a static surface.

**Space.** A 4 px base. Sections breathe at 96–128 px on desktop and 56–72 px on a phone; cards pad 24–28 px; touch targets are 44 px or more. Emptiness is fine when it frames something; emptiness that is just absence is a defect.

**Atmosphere and depth.** No particle or dust backgrounds. Depth comes from layered surfaces, floating drawn objects at different parallax depths, tilted cards, soft tinted shadows, and one sculpted 3D Wobo (a raymarched clay render in the same palette) where the page needs a centrepiece. On marketing pages the pointer is a plain Wobo-blue dot with a marigold highlighter trace that follows and fades; inside the app the cursor is native, because learners are working. Scroll is a storytelling instrument: pinned chapters scrub transformations, tiles land with a spring, headlines rise word by word, an ink thread draws itself down the page.

## 3. The ten design laws

1. One screen, one intention, one next-best-action.
2. Bold ink, warm paper: no line thinner than 2.5 px, no border on a surface, no corner under 10 px.
3. Depth by tone and space; a soft shadow only under what floats.
4. One leading pigment per surface, with a job; a second only as a wash.
5. Animate meaning, never chrome; everything eases like it has weight.
6. Progressive disclosure: the simple thing first, depth on request.
7. Every generated visual is glanceable, or it is redrawn.
8. Wobo is present but never in the way: expands when summoned, contracts when not.
9. The aha is precious: the ignite event is scarce, earned by genuine comprehension.
10. Every element earns its place (plan §15): a learner task, brand delight, or a nice-to-have someone can name.

## 4. Wobo (the tutor) — the life, not a layer

Wobo is one name for the app and the tutor inside it; this section is the tutor. Every surface is one of three things: Wobo is it, Wobo composed it, or it reports to Wobo. Wobo has no gender (plan §19): name first, they/them only when unavoidable, "I" in its own voice.

**The body.** The ink-visor wobot, exactly as the shipped rig renders it: a round body in ink (`#14142B` on cream, `#F3F0E8` on night) carrying a visor in the tone the body is not (cream `#FAF7F0` on paper, night `#0F1226` on the dark ground), two Wobo-blue eyes (`#2B45FF`, lifting to `#7C8CFF` on night) and a pen tip in the same blue, and a half-pixel opposite-tone hairline that keeps the silhouette crisp on any ground — the one hairline that survives, because it is part of the character, not the chrome. The rig is SVG driven by spring channels in one animation loop: weight and squash, anticipation, overshoot and settle, constant idle life (blinks, glances, boredom, stretches), gaze that follows the pointer or the pen, twenty expressions and a scenes registry the brain can cue. Docked, the orb sits on `shadow-soft`. Rebuilt to exceed the Koji bar: joyful, alive, never saccharine, never noisy.

**States, each with distinct body language.** Listening leans in; thinking pulses inward with a pen tap; explaining gestures toward what it draws; drawing follows its own pen; celebrating squashes and pops on genuine mastery, with a marigold flourish; resting breathes slowly and never guilts.

**The two modes, one entity.** Front door on the home screen, expanded into a full conversation; docked everywhere else, one tap from expanding, laying ink over the current screen, executing actions. It never forgets who the learner is between the two. There is no second assistant.

**Code-level screen awareness.** Wobo does not screenshot the screen. Every interactive component publishes its live state to the bus Wobo reads (§12), so annotation is exact.

**Illustration.** One hand draws everything: ink-and-wash scenes with 4 px outlines on paper, flat washes at 18–28% of one pigment, Wobo present in every scene, hand-wobble on long lines, no perspective boxes, no clip-art glyphs. Icons live on a 24 px grid at 2.5 px, rounded, drawn from the same hand.

## 5. The motion system — animate meaning

Named, GPU-friendly, eased, always meaningful.

- **Curve.** `cubic-bezier(.2,.8,.2,1)` for entrances and settles at 320–480 ms; presses scale to .98 and back; hovers lift 1 px with `shadow-lift`. Nothing linear, nothing that snaps.
- **Ink.** Everything Wobo draws is drawn on (stroke-dashoffset or the pen), never faded in. Text in its hand writes itself.
- **Signature primitives.** **ignite** (a region catching light the moment something is mastered, marigold) and **constellation-ignite** (the twin lighting a region and its connections).
- **The aha is multisensory.** A sub-second sound plus haptic where supported, only on genuine comprehension.
- **Arrival.** The app arrives with the loader from the states set: the pen draws a line, the line becomes the orb, the body settles. Under a second. Reduced motion shows the still frame.
- **Character in the chrome.** Playful lives in Wobo and in motion; the chrome itself stays disciplined. A five-year-old finds it friendly, a parent finds it serious.

## 6. Navigation — one screen, one intention

The generic left navigation is dead. Navigation is intention-first: say it to Wobo, tap one of a very small set of doors, or open the command palette.

- **No persistent rail** on the home. `Today / Learn / Create / Progress` from the conscience docs are a reference model, not gospel — in this app the home is deliberately narrower (see §7). Create and Progress live behind Wobo and the quiet "you" affordance.
- **Command palette (Cmd-K)** reaches any action in the product.
- **Wobo** reaches any surface by voice or text — so the small set of visible doors never limits what a learner can do.

> If Shreyan later wants a slim contextual rail inside Learn or course contexts only, that is the one place it may return. It never appears on home.

## 7. The home — radically minimal

On landing, the learner sees almost nothing. That emptiness is the premium signal.

```
┌─────────────────────────────────────────────┐
│  ◦ you                          ✦ did you know │
│                                               │
│              ◍  Wobo                          │
│         "ask me anything, or…"                 │
│                                               │
│   ┌───────────────────────────────────────┐   │
│   │  talk to Wobo…                        │   │
│   └───────────────────────────────────────┘   │
│      [ ✧ learn something cool ]  · chips       │
│                                               │
│         ┌──────────┐   ┌──────────┐            │
│         │  Learn   │   │ Practice │            │
│         └──────────┘   └──────────┘            │
└─────────────────────────────────────────────┘
```

- **Wobo, front door** — the conversation, centre stage. Chat lives only here; everywhere else is the docked orb.
- **Did you know** — top right, a genuinely surprising fact that changes every single day, fresh on every login.
- **Learn something cool** — shortcut chips under the chat bar that prompt Wobo to surface a delightful academic fact or rabbit hole on tap.
- **Learn / Practice** — the two doors, under the chat bar.
- **You** — a whisper-quiet affordance, top left, opening the twin, profile, past courses, and settings. Never a menu bar.

## 8. Screen behaviour

**Learn & Practice — the subject grid.** Both open to the learner's subjects in a clean, tactile grid; one tap into a subject, then chapters, then topics (a topic is a course). The **custom courses** the learner asked for sit below the syllabus grid under a "courses" heading. **Completed courses** move out of the active grid into a "past" shelf — a trophy case, not a to-do list. Practice additionally opens the free-play sandbox and the mixed practice surfaces.

**The course player — where Wobo docks.** Inside a course, content-type surfaces render full-bleed and Wobo contracts to the docked orb: present, reading the screen at code level, one tap from expanding, ready to annotate or answer "why is this wrong." The player is the guided-discovery shell — one idea per screen, act-to-reveal — closing on the boss battle, the greeting, and the XP.

**Prerequisite gates.** A topic whose prerequisites are unmastered shows the suggestion and a "proceed anyway" door — a gate is advice, never a wall. Gating is scoped to where the learner started (a grade-10 entrant is never sent to grade 9).

**Progress — the twin as hero.** The knowledge twin is its own surface and the emotional centre of retention (§11).

**Parent — the absolution engine.** Not a dashboard. A weekly, beautiful, WhatsApp-native artifact drawn from the child's own learning — a short video, a shareable page, or a graph, in the parent's language — a visual projection of who the learner is becoming. The child can trigger "show mom what I just cracked." See `CONTEXT.md` §12.

## 9. Content-type UX — the taxonomy, and how each looks and behaves

We are visual-first: animation, simulation, and graphics are the highest priority; text is the fallback, never the default. Wobo composes which types a topic uses and in what order, tuned to the concept and the learner.

**The keystone — build first.**
- **Guided-discovery interactive** — the Brilliant format and the format gap in edtech: one idea per screen, tap / drag / slide to reveal, zero lecturing. A reusable shell every other engine targets. If one thing is built perfectly, it is this shell.

**Interactive & simulated — the core.**
- **Simulators, everywhere** — click, drag, feel. Titration where drops shift colour transparent → pink → deep pink; circuits where you wire bulbs, cells, capacitors freely; reactions, the periodic table, lab experiments. If a concept can be felt, it is a sim.
- **Free-play sandbox** (practice) — an open area to build anything on a topic, no task, Wobo watching at code level.
- **Perturbation sandbox ("break it")** — expose the parameter where a law fails as a slider. Drag resistance to zero in `V=IR`; current diverges; "why not in reality?" surfaces internal resistance. Understanding a model is knowing where it stops working.
- **What-if sandbox** — every numerical is editable. Drag the person's height or distance to the tower in a heights-and-distances problem and the figure and the worked solution below update live. Numericals are never static.
- **Mini-games & arcade** — where a concept is better practised as play, a mechanic that *is* the concept.
- **Visual compare** — animal cell vs plant cell, series vs parallel — side-by-side, interactive, genuinely beautiful, correspondences and differences animated, not tabulated.

**Explanatory & visual.**
- **SVG diagrams** — every diagram is SVG, glanceable, and annotatable by Wobo. For complex biological or structural imagery (plant cell, human body), image generation (Gemini / Nano Banana) fills what SVG cannot.
- **Animated visuals** — animated SVG and motion sequences; meaning animated, chrome never.
- **Charts & graphs** — drawn in SVG, beautiful, and tutored: Wobo highlights, annotates, and walks the curve like a teacher, because Wobo reads the plot's data at code level.
- **Concept maps** — where a web of relationships needs showing, drawn from the real graph, structural not decorative.
- **Explainer videos** — short motion pieces, as long as the topic needs (ten seconds to two minutes), high-craft animation with Google TTS narration in sync. An offline pipeline feeding the cache, not runtime rendering.
- **Podcasts** — audio lectures for learning and revision, generated from the same verified content, voiced through the TTS pipeline.

**Depth on demand — shown only if asked.**
- **Derivation depth** — formulas carry an info button; tap it and the full derivation unfolds as a dropdown ("how we got here"). Recursive as sub-derivations in algebra and calculus. Most move on; the curious go deep without cluttering everyone.
- **Word-problem breakdown** — any word problem opens into a step-by-step visual dissection on request: the scene drawn, quantities labelled, the path made visible.
- **Personal analogy** — "explain this in terms of basketball / Formula One / cricket"; Wobo re-renders the concept in the learner's chosen world, same truth, their language.
- **Correlations** — when a concept the learner has *already mastered* connects to a new one, Wobo surfaces the link; if unmastered, the link stays hidden. Relevance is tactical, never noise.

**Practice & assessment surfaces.**
- **Mini-workbooks in-lesson** — short interactive mixes inside a course (match-the-following, fill-blanks, quick quizzes) for hands-on checks without leaving the flow.
- **Flashcards** — where recall matters, wired into spaced repetition.
- **Boss battle (end of topic)** — a full interactive digital workbook that closes a topic. The learner works through it, is evaluated, and only then receives the closing greeting and the XP. The engaging climax of a course.
- **Synthesis boss (cross-topic)** — a live problem assembled from everything the learner has mastered, drawn across topics via the graph.

**The two behaviour-triggered crown jewels.**
- **Misconception detonation** — triggered by a wrong answer, not a topic. Generate the exact sim that breaks the belief using the learner's own numbers (the two masses landing together; the missing `2ab` rectangles appearing in the gap). Not a generic "common mistakes" box: "you just said X — watch X break." Flagged in FSRS for re-testing.
- **Concept-graph bridge** — teach a new concept using only the concepts *this* learner has already mastered as scaffolding. Look at the edges into the target, intersect with their mastered set, generate a lesson that travels only over solid ground. Same destination, different bridge per learner. Graph traversal plus generation — nothing new authored.

**Beyond syllabus — optional delight.**
- **Mystery lessons** — hidden, optional lessons on a completed topic, something genuinely cool and out of syllabus, discovered not assigned, rewarded with XP.
- **Bonus lessons** — optional extensions for XP; sanctioned rabbit holes via bridges from where the learner stands.

## 10. Math & rendering

JSXGraph + Mafs for 2D math and graphing; Three.js / R3F for 3D and explorable models. GeoGebra is eliminated. Every diagram is SVG-first and glanceable; Gemini / Nano Banana only for imagery SVG cannot express. All rendered content is annotatable by Wobo through the component contract.

## 11. The knowledge twin as hero art

The twin is the product's signature icon and the emotional centre of retention. Treat it as generative hero art that breathes and **ignites** a region the moment something is mastered. It shows not just lit versus dark but **independent versus support-dependent** mastery. Queryable in plain language ("what am I weakest at," "what unlocks astrophysics"). Built to be screenshotted and shared. Every conclusion in it links back to its evidence.

## 12. The component contract — non-negotiable

Every interactive component (sim, sandbox, chart, workbook, diagram) must:
- **Publish its live state** to the shared bus Wobo reads — current values, the learner's last action, the correct model — so Wobo annotates and reasons at code level, never by vision. This is what makes Wobo fast, exact, and responsive. Build it into every component from the first one.
- **Expose an annotation layer** Wobo can draw over — highlight, circle, point — anchored to real elements, not screen coordinates.
- **Emit an attributed event** on every meaningful learner action, feeding mastery, gaps, and the twin (see `CONTEXT.md` §5).
- **Degrade gracefully offline** — pre-synced learning packs keep the core interactive experience alive on a dead network.

## 13. The review test — what "not generic edtech" means

Before any screen ships, look at it, in both themes and at three widths, and ask: could this belong to a generic edtech app, or to a corporate dashboard? If yes, it fails. The signals of failure: a persistent nav rail, dashboard cards of raw numbers, explain-first video-with-a-quiz, hard shadows, hairline borders, corners under 10 px, strokes under 2.5 px, monochrome timidity, the same headline size in every section, empty stretches that frame nothing, chrome that animates for no reason, Wobo reduced to a corner chatbot. The signals of the standard: bold ink on warm paper, one leading pigment with a job, meaning animated, Wobo alive and central, illustrations from one hand, the aha earned and precious, the twin worth screenshotting, and the owner smiling at the screenshot.
