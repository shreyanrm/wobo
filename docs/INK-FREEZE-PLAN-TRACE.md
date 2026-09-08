# Ink: freeze, plan, trace

**The owner, 2026-09-08, on the 0.92 scorecard:** *"0.92 is horrible. Deeply understand the mechanics
of heyclicky.com. The drawing is very simple: come up with a plan in your head, and trace it, that's
all. See if freezing the screen or screenshotting helps. And not just a screenshot: since you are the
code, you know it at a much more internal level than Clicky, so you can deliver better at lower cost
and faster, because you know the context too."*

This document is the board's law from today. Where docs/BOARD.md disagrees, this wins; BOARD.md keeps
the plane's from-scratch grammar (graphs, free bodies, Punnett squares, circuits), which scored well
and stays.

## 1. What Clicky does, and what we do instead

Clicky (a macOS app, not an extension) works like this, from its own site and its open-source
predecessor: press the hotkey, one screenshot is taken and sent to a vision model, the model answers
by voice and returns a few points and shapes in image coordinates, the app flies a cursor and draws
hand-drawn rings, highlights and polygons over the screen while it talks, and everything clears when
the speech ends. It sees pixels because it does not own the page. That is its ceiling.

We own the page. So we do the same three things with better material:

| verb | Clicky | Wobo |
|---|---|---|
| freeze | a screenshot cannot scroll | the glass is held still for the turn: scroll locked, sheet folded, no route change, layout held |
| plan | a vision model reads pixels and guesses coordinates | Luna reads a **glass map**: every visible line of text and every meaningful element with its box, its role and, when it is our content, its meaning (the step, the concept, the misconception); it plans marks by id |
| trace | a cursor flies to x,y | one pen traces each mark from the element's real box, in step with the sentence that names it |

## 2. Why 0.92 happened (from the maps of our own code)

- **Two registries, two pipelines.** Marks anchor to a target id that a component must have registered
  with `useRegisterTarget` (67 call sites); the overlay pipeline reads one registry and the board
  pipeline another; the brain refuses any mark whose id is not in a 2 KB snapshot that trims targets by
  a fixed ladder. A diagram registers as ONE target, so "circle the effect" rings the whole figure. A
  worked example registers nothing, so "which step is wrong" has nowhere to land.
- **Nothing holds the glass.** A ring was drawn 214 px above the viewport behind the phone sheet; a
  route change kept drawing the lesson's note over the next page; an empty plane opened over the thing
  it was explaining because a surface word runs before the brain answers.
- **The hand drops instead of holding.** A mark whose box comes back null is skipped on that frame, not
  faded; screen ink dies after six seconds whether or not the question is still open; the say is a
  registry label read back.
- **Two plans for every silent turn, keyword heuristics, a 413 for too much.** Complexity where a plan
  of two marks per sentence would do.

## 3. The law

### Freeze
When a turn that may draw begins, the client takes the **glass map** and holds the glass:
- The map lists what is visible in the viewport: every rendered line of text (a text run split at
  line boxes, with its words), every meaningful element (card, step, figure, figure part by its SVG id,
  chip, input, table cell), each with `id`, `role`, `text`, `box` in CSS px, and, when we own it,
  `meaning` from the content model (`step:3`, `concept:sign-flip`, `misconception:moves-term-without-sign`).
  Ids are stable across re-measure (content hash plus index), so nothing needs registering; a
  component may add a label, never a precondition. The map is at most 60 entries and about 2 KB, chosen
  by visibility and by relevance to the question, never by a trimming ladder.
- The glass is held: scroll locked for the turn (a finger already scrolling finishes its scroll), the
  phone sheet folded to a strip, route changes deferred, layout held; a resize or theme flip re-measures
  the same ids. Escape, a tap on the glass, or the learner speaking releases everything in one tick.
- On the doubt page the photo's lines are the map, with boxes from the vision read, same as today.
- Where we do not own the content (a PDF, a photo, a textbook page), a screenshot is taken once, read
  once by Gemini Flash into the same map shape, and stored, so the second question costs what the first
  question about a lesson costs.

### Plan
The brain gets the question, the learner's state (what they got wrong, the chip they tapped, where
they are), the content model of what is on the glass, and the glass map. On Luna it returns a **plan**:
- Two to four sentences. Each sentence carries at most two marks. A turn carries at most ten.
- A mark is `{kind, target, words}`: kind is one of ring, underline, arrow, bracket, tick, cross, note,
  point; target is a glass id (or, as a fallback, the exact words to find); words is what the mark
  means, spoken with it. The say names what it draws: never a label read back, never a pronoun with no
  mark under it.
- No board-space geometry in a plan. A drawing from scratch (a graph, a free body, a square) is a
  different verb: the plan says `open: {kind, intent}` and the plane's pipelines build it as today. A
  plan never opens an empty plane; if nothing is to be drawn, the plane does not open.
- Wrong is refused before it is drawn: a target not in the map, a number the ask did not give, a mark
  with no words, a sentence with no mark when the question asked to be shown.
- Cost: the prompt is the map plus the state, a couple of thousand tokens; Luna; one call. The
  keyless path uses the same plan grammar with the same tests.

### Trace
- One pen, CSS px, from the element's real box: ring 300 to 600 ms, underline and bracket by length,
  a note in the margin that dodges page text. Weight and nib in screen px at every width.
- Ink before the word: the first stroke of a sentence starts within 150 ms of its first word or ahead
  of it, never after the sentence ends. The hand waits on sentence boundaries.
- Ink holds until the question is answered: while an ask is open the marks stay; they fade when the
  learner answers, interrupts, or the next turn begins. A mark whose target leaves the glass fades,
  it never floats and it is never dropped on a frame.
- Interruption is one tick: Escape, a tap, the learner's voice, or a route change lifts the pen, stops
  the voice, fades the ink, and releases the glass. A route change during a trace is an interruption.
- What already worked stays exactly as it is: the drift-free ring on a released scroll, the theme
  flip that re-inks mid-stroke, the pen tick, reduced motion drawing at once, the utterance clock, the
  SSE stream with say, ink, ask and done, and the plane for from-scratch drawings.

## 4. What goes
The overlay pipeline (highlight, annotate, point actions) and the bus-to-registry bridge: one plan
grammar, one hand. `target_named_by` and the keyword tables for on-page marks. The double planning of
silent turns. The 413 for too much on the glass (the plan is capped at ten marks). The 2 KB trimming
ladder. The six-second screen TTL while a question is open. The registry label as the say.

## 5. Proof
The same 59 turns wave 33 judged, re-run on the new path keyless, must score above 3 on every lens at
390 and 1440; then twelve live turns on Luna with a real voice under the three-dollar cap, spend to
the cent. The first-stroke bench requires the stroke inside the viewport.
