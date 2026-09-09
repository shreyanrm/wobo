# The felt moments: gamification is feedback, not points

**The owner, 2026-09-09:** *"How about the application gamification, subtle animations and stuff?"*

## 1. What we actually have, audited today

**The structure is all there.** XP, streaks, completed counts, topic progress, awards, a trophy room,
boss battles across 38 files, the climb with a frontier edge that grows, and one genuinely lovely idea
already in the code: a topic's ring **ignites in its subject's own pigment once the concept is
mastered**. That is a better reward mechanic than a badge and nobody else in the category has it.

**The motion vocabulary is real too.** The motion package ships Ignite, CountUp, SpringBar, Magnetic,
Ripple, entrance, focus, annotation and a constellation ignite, all with reduced-motion handling and
proper easing tokens.

**And here is the problem, in one line: it is used in eleven files, and most of them are marketing
pages.** MeetWobo, the reveals, the ask block, the plans page and the landing are animated. The
learning surfaces are not. We have built a beautifully animated brochure in front of a still product.

That is also what the judges have been telling us. Across three rounds of judging the ink, experience
scored 0.56, then 1.34. It is the lowest lens every time.

## 2. The principle

**Points are not gamification. Feedback is.** Duolingo's hold on people is not the XP number, it is the
sound and the motion in the instant you are right. The number is the record of the feeling, not the
source of it. We have a product that can draw, and a learner who answers correctly currently gets a
state change and no moment.

So the rule: **every moment a learner does something, the product answers within 100 milliseconds, in
motion, before any number moves.** The number moves after, as confirmation.

## 3. The moments that must be felt, and what each one is

| Moment | What the learner sees |
|---|---|
| an answer lands right | the mark itself confirms in the subject's hue, then the count climbs; never a tick pasted on top |
| an answer lands wrong | the shake, once, gentle, and the ink stays so they can look again; never red, never a buzzer |
| a card is finished | the card settles and the next one is already arriving; no interstitial |
| a topic is mastered | the ignite that already exists in the code, given its proper moment and its sound |
| a chapter is finished | the climb's frontier visibly advances, and the map is worth looking at |
| a boss is cleared | the biggest moment in the product, and it should feel like it: the constellation ignite, held, with the orb's spark |
| a streak is kept | small, daily, never a nag; the orb's bounce |
| a bonus level is found | the side door opens itself, once, so the learner knows it was there |
| a doubt is solved | the page's own line is marked and the answer settles under it |
| the day's work is done | the last thing they see is calm, not another prompt |

## 4. Subtle means subtle

Every one of these is small, fast and quiet. No confetti. No full-screen takeover. No sound that a
child would be embarrassed to have play in a classroom. The register applies to motion exactly as it
applies to words: confident, warm, never loud. A moment that a learner would want to turn off is a
moment we designed wrong.

Three rules keep it honest:

1. **Under 400 milliseconds**, all of it, or it is in the way.
2. **It never blocks.** A learner who wants to move on can move on through any celebration.
3. **Reduced motion is a still with the spark**, everywhere, without exception, and it must still feel
   like something happened.

## 5. The arcade

Designed in docs/CONTENT-INTERACTION.md section 7 and not built: optional bonus levels in the middle of
the climb, six mechanics, XP capped and counted separately so it never competes with real learning. It
is the piece that earns the landing page's promise that some of it is a game. It ships with the content
layers.

## 6. What is missing, precisely

- The motion package is not used in any learning surface. Every moment in section 3 needs wiring.
- No earned-moment component exists at all: there is no single place that owns "something good just
  happened", so each surface would invent its own. One component, one vocabulary.
- The twelve orb moves (docs/EMAILS-AND-ANIMATIONS.md section 8) are not built, and half the moments
  above want one.
- The arcade has no screen.
- There is no sound at all in the product, and two or three tiny sounds would carry more feeling than
  any amount of motion. They must be optional, off in a classroom, and never a fanfare.

## 7. The order

This lands with the animation library, because they are the same work: one library of moves, one
component that owns the earned moment, and then every surface in section 3 wired to it. The arcade
follows the content layers. Nothing here is worth doing before the ink scores four, because a
celebration on top of an answer that missed is worse than no celebration.
