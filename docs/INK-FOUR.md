# Four out of four: what each lens means, and the one thing we do not have yet

**The owner, 2026-09-09, on the re-judged 0.96:** *"0.96 out of 4 is not enough. We have to be 100%,
4 out of 4, if that's the move."*

It is the move. This file says what a 4 is on each lens so a builder can build to it and a judge can
withhold it, and it names the one piece of architecture that no amount of fixing gets us.

The measurement never changes: the same 59 turns, the same five lenses, 390 and 1440, both themes,
reduced motion, keyless for all 59 and twelve live on Luna. A lens scores 4 only when every turn that
lens applies to earns it. One failure is the lens's score.

## The five lenses at 4

**Relevance.** The mark lands on exactly the thing the question named, on the first stroke, and
nothing else is marked. A question that names a part gets the part, not its figure. A question that
names nothing on the glass gets no ink and a useful sentence instead. Wobo never marks its own words,
its own chrome, or anything off the glass. Every drawing turn is a drawing turn because the learner
asked to be shown, not because a regular expression matched.

**Correctness.** Every number, label and relationship drawn is true, and true for the question asked:
a 15 cm lens draws 15 cm, a monohybrid cross is a two by two square, a cell shows the parts it names
and no more. Nothing carries `verified` unless a check ran and passed. Nothing is spoken that was not
drawn, and nothing drawn contradicts what was said. A refusal is honest and rare.

**Craft.** The ink reads as a teacher's hand at both widths: labels at least 12 px on the glass,
strokes in screen pixels, a note in the margin within 24 px of its subject and never over the text it
explains, a ring that fits its subject with even padding. Nothing under a panel, sheet, toast or pill.
Nothing off the viewport. The plane opens only for something built from scratch, and never over the
thing being explained.

**Timing.** The first stroke is on the glass **within one second of the learner asking**, not of
Wobo's first word. Each mark is drawn in step with the sentence that names it, ahead of the word,
never after the sentence ends. Ink holds while the ask is open and fades when it is answered. The
page is held still only while a stroke is in flight, and a released scroll carries the ink with no
drift.

**Experience.** The say names what it draws, every turn, in the register, never narrating. One voice,
one transcript, the ask printed once. Escape, a tap or the learner's voice stops pen and voice on the
same tick. The page the learner is looking at is never taken away to make room for the answer. After
the turn the learner can act on what they see.

## The one thing we do not have: the instant mark

Live, the first stroke lands 8.6 to 19.3 seconds after the ask. No amount of prompt trimming fixes
that, because it is a round trip to a model that thinks for seconds. Timing can therefore never score
4 with today's architecture, and timing drags experience with it.

The fix is the advantage we have over anyone drawing on a screen from outside: **we already know what
is on the page and what it means.** The glass map carries the concept, the part, the step and the
misconception for everything visible. So for the large class of questions that name something on the
glass, **the client can resolve the target and start the stroke immediately, with no model call at
all**:

1. **Resolve locally, in milliseconds.** "Circle the hypotenuse" on a page whose triangle declares its
   parts is a lookup, not an inference. The pen starts inside 200 ms while the request is still in
   flight.
2. **The model refines, it does not gate.** The plan arrives a second or two later and adds the
   sentences, the second mark and the ask. If the model disagrees with the local aim, the ink moves
   once, visibly, the way a teacher corrects a stroke. If the model fails, the local mark is still
   right and the turn still taught something.
3. **The words come from the core, not from the wire.** The concept core already holds a sentence for
   every part it declares, made once by the architect and cached. Wobo can say the true thing about
   the hypotenuse before any model answers.
4. **Precompute the obvious asks.** For each card, the three or four questions a learner actually asks
   are known from the blueprint's misconceptions. Their plans are made once, cached with the level,
   and served in milliseconds.

That is four steps to a sub-second first stroke on the majority of turns, and it costs less per turn
than today, not more.

## The order

| wave | what it earns |
|---|---|
| 41 (running) | relevance and the aim: Wobo stops marking its own words; the validator stops eating good marks; the pen goes above the panel |
| 42 | timing and experience: the instant mark, the local resolve, the cached asks, the words from the core |
| 43 | correctness: every from-scratch drawing right and verified, every label legible |
| 44 | the last mile: whatever the judge still withholds a 4 for |

Each wave ends with the same 59 turns judged on this file. The wave is not finished when its findings
are closed. It is finished when the lens it was built for scores 4.
