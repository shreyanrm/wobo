# Levels: earned by XP alone, and each one costs more than the last

**The owner, 2026-09-09:** *"I want level ups only based off XP, and the same amount of XP doesn't lead
to level ups as the level increases. It should be progressive, it should get harder as they go."*

Settled. Levels come from experience points and nothing else, and the cost of each level rises. This
file is the curve, the earning rates, and the rules that stop it being gamed. The sky in
docs/REWARDS.md stays as the picture of what a learner has covered; the level is the number.

## 1. What earns experience points

Modest on purpose, so a level always means learning happened.

| | XP |
|---|---|
| a card finished | 10 |
| a topic mastered | 50 |
| a chapter finished | 200 |
| a boss cleared | 300 |
| a day kept in a streak | 20 |
| a bonus level in the arcade | 15, capped per chapter |

**Free and paid earn identically.** A plan buys more time with Wobo, never a faster climb, which is the
law already written in docs/ALLOWANCE.md.

## 2. The curve

The cost of the next level is `60 × level^1.35`, rounded to ten, with two deliberate departures:

- **The first three levels are nearly free**: 30, 60, 120. A learner's first session should end two or
  three levels in. That is the hook, and it costs nothing to give.
- **The cost stops rising at 8,000 XP**, which happens around level 39, so a learner three years in is
  never facing a wall that makes the number meaningless.

| To reach | XP for that level | Total XP |
|---|---|---|
| 2 | 30 | 30 |
| 3 | 60 | 90 |
| 4 | 120 | 210 |
| 5 | 390 | 600 |
| 6 | 530 | 1,130 |
| 11 | 1,340 | 6,130 |
| 21 | 3,420 | 30,590 |
| 31 | 5,920 | 78,260 |
| 41 | 8,000 | 151,370 |

## 3. What that feels like, modelled against real use

A first session of three cards, one topic mastered and the day's streak is 100 XP, which is **level 3**.

| | after week 1 | after a month | after a term | after the school year |
|---|---|---|---|---|
| three short sessions a week | 3 | 5 | 8 | 11 |
| most days, a chapter a week | 5 | 7 | 13 | 18 |
| every day, exam season pace | 6 | 10 | 19 | 27 |

Fast at the start, roughly a level a week in the middle of a steady learner's year, and slow enough at
the top that reaching level 30 means something. Nobody finishes.

## 4. The rules that stop it being farmed

- **A concept pays once.** Mastering a topic pays 50 the first time and nothing on a revisit. Practice
  on a topic already mastered pays a small amount, and it decays with each run that day.
- **A day pays once.** The streak's 20 is per day, not per session.
- **The arcade is capped per chapter**, so a learner cannot skip the learning and play.
- **Nothing pays for speed.** Answering fast never earns more than answering slowly, because a product
  that rewards speed teaches guessing.
- **Nothing is deducted, ever.** No level is lost, no XP is taken back, and a wrong answer costs
  nothing. A learner who leaves for a month comes back to exactly what they had.
- **A broken streak resets the streak, not the level.**

## 5. What a level may and may not say

A level is a distance travelled, never a rank. The product never compares one learner to another,
never shows a leaderboard, never says a level is good or behind, and never uses a level to gate
learning. Every lesson is open to every learner at level 1 and level 40 alike.

On the learner's own screen it is a number and a bar. On the parent's view it appears as time and
progress, in the parent's register, never as a score to be proud or ashamed of.

## 6. The level-up moment

Composed like every other reward (docs/REWARDS.md): the bar fills, the number turns over, and the
learner's most recent concept sigil ignites in its subject's pigment. Under 400 milliseconds, never
blocking, reduced motion a still with the spark. Levels ending in a milestone, every tenth, hold a beat
longer and nothing more. There is no level-up popup, because the bar is already on the screen.

## 7. Where it lives

The curve is one pure function with a test that pins every number in the table above, so a change to
the pacing is a deliberate, reviewed act and never a drift. The earning rates are dials on the console
(`ops.settings`, live and audited) because they will need tuning once real learners are on it, and the
curve's constants are dials too, with a warning on the screen that changing them re-levels everyone.
