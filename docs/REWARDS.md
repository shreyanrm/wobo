# The reward system: composed, never chosen

**The owner, 2026-09-09:** *"How about the level system, XP vibe animations, celebration scenes, try
again scenes, not same for all, everything should depend on the vibe, completion popups, everything you
could think of."*

The instinct is exactly right and the machinery for it is already in the tree, unconnected. This file
is the design.

## 1. The thing that makes them all different, and it already exists

Three generators are already written and already mean something:

- **Every concept owns a sigil.** `ui/art.tsx` derives unique geometric line-art from a concept's id:
  a base polygon, orbiting nodes, arc traces. Fine ink at rest. It already ignites in its subject's
  pigment when the concept is mastered. One generator, thousands of distinct artworks, zero authored
  assets, and it is the concept's identity, repeated on its card, its course header and its star.
- **Every subject owns a pigment.** `ui/hues.ts`, and the law is already right: pigment is for earned
  moments only, chrome never takes it.
- **The constellation exists**, with nodes, edges and ranks, in the motion package.

So a celebration is never picked from a list of five. **It is composed** from four things:

    the concept's own sigil  ×  its subject's pigment  ×  how hard this was for this learner  ×  which moment it is

That is thousands of distinct celebrations from one generator, each one made of the thing they just
learned. A concept whose sigil is a three-node triangle celebrates differently from one with eight
orbiting nodes, because the sigil is different. Electrostatics does not look like photosynthesis,
because their sigils and their pigments are not the same. Nobody authored either one.

## 2. The level system: your sky, not your rank

**Both, and they do different jobs (owner, 2026-09-09).** There IS a level, it comes from experience
points alone, and each one costs more than the last: the curve, the earning rates and the anti-farming
rules are in docs/LEVELS.md. The level is the number that moves today. The sky below is the picture of
what a learner has actually covered, and it is what they look at to see their year:

- **Every concept mastered is a star**, lit in its subject's pigment, drawn as its own sigil.
- **A subject's stars form its constellation**, and its edges draw as the concepts connect.
- **Your standing is how much of your sky is lit**, per subject and overall, and it is a picture rather
  than a number.
- **Experience points stay** as the day-to-day number, because a number that climbs is satisfying and
  honest. The sky is what it adds up to.

The trophy room becomes the sky. A learner can look at it and see their year.

## 3. The moments, and how each is composed

| Moment | Scale | What is composed |
|---|---|---|
| an answer lands right | a breath | the mark confirms in the subject's pigment; the count follows |
| a card is finished | small | a bloom in the pigment, sized by how many tries it took: first try is quick and bright, fifth is slower and warmer, because arriving late is still arriving |
| a topic is mastered | medium | **the sigil ignites**: its own polygon, its own nodes, its own arcs, drawn once in the subject's pigment and then held as the topic's permanent mark |
| a chapter is finished | large | the chapter's topics' sigils gather and the constellation's edges draw between them |
| a boss is cleared | the largest | the constellation ignite, the whole chapter lit at once, the orb's spark, and a held beat before anything else moves |
| a subject is finished | rare | that subject's whole constellation completes and takes its place in the sky |
| a streak is kept | tiny | the orb's bounce, once, never a nag |
| a bonus level is found | small | the side door opens itself so they know it was there |
| a day's work is done | quiet | the last thing they see is calm, not another prompt |

**Intensity is earned, not uniform.** How hard it was decides how much happens: a concept a learner got
first time gets a quick bright bloom; one they came back to three times gets a slower, warmer, longer
one, because that is the harder thing and it deserves more. A boss cleared without a hint is not the
same scene as one cleared with three.

## 4. Try again, and this is the one that matters most

A wrong answer is the moment a learner decides whether they like this product. So:

- **Never red, never a buzzer, never a cross.** One gentle shake, and the ink stays so they can look
  at it again.
- **It varies by attempt, not by randomness.** The first miss is almost nothing: the mark simply does
  not confirm. The second brings the ink back to the step that went wrong. The third stops asking and
  offers a different way in, which is the re-teach ladder the product already has.
- **It never says they were wrong.** It shows what is true and lets them see the difference.
- **The pigment never appears on a miss.** Pigment is for earned moments only, and that law is already
  written. A missed answer is ink, not colour.

## 5. The popups, which should mostly not be popups

A completion that interrupts is a completion that annoys. So the default is **in place**: the card
settles, the sigil ignites where it already sits, the constellation draws on the map the learner is
already looking at. Three things earn an actual surface of their own, and only three:

1. **A boss cleared**, because it is the end of a chapter and deserves a beat.
2. **A subject completed**, because it happens rarely and it is enormous.
3. **The first time**, because a learner's first mastered concept should be explained once.

Everything else happens where the learner already is. Any one of the three can be moved past with a
tap, always.

## 6. Sound

Two or three sounds, no more, and they carry more feeling than any amount of motion: the pen's tick
(already in the board), a soft confirm, and one warmer tone for an ignite. Off by default in the first
release, offered once, remembered after. Never a fanfare, never anything a child would be embarrassed
to have play in a classroom.

## 7. The rules that keep it subtle

1. **Under 400 milliseconds**, everything, except the three surfaces in section 5.
2. **Never blocking.** A learner who wants to move on moves on, through anything.
3. **Reduced motion is a still with the spark**, everywhere, and it must still feel like something
   happened.
4. **Pigment only for earned moments.** Already law, and it is what makes the colour mean anything.
5. **Composed, never authored.** If someone has to draw a new asset for a new concept, the design is
   wrong. Every celebration comes out of the generators.

## 8. What has to be built

- One **earned-moment component** that owns "something good just happened" and composes it from the
  four inputs. Nothing else in the app invents a celebration.
- The **sigil ignite** given its proper moment, its timing and its hold. It exists as art and has no
  moment.
- The **constellation** wired to real progress, and the trophy room rebuilt as the sky.
- The **try-again ladder** wired to attempt count, with the re-teach ladder behind the third.
- The **twelve orb moves** (docs/EMAILS-AND-ANIMATIONS.md section 8), which several of these want.
- The **three surfaces** of section 5, and no others.
- The **sounds**, last.

It ships with the animation library, after the ink scores four, because a celebration on top of a mark
that missed is worse than no celebration.
