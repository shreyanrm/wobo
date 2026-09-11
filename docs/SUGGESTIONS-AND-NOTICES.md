# What Wobo offers, and what it interrupts for

**Found missing on 2026-09-11**, when the owner asked whether everything discussed was ready and
listed "notifications... suggestions". Both exist in fragments and neither had a law, which is how a
thing gets lost. This is the law for both, and the two belong together because they are the same
question asked twice: **when may Wobo speak first?**

## 1. The principle

A learner opens Wobo because they want to. Every time the product speaks without being asked, it
spends a little of that. So the rule is not "how do we get them back", it is: **speak first only when
the learner would thank you for it.**

Three things follow. Nothing Wobo offers is ever a demand. Nothing is ever a guilt. And a learner who
ignores everything we offer has lost nothing at all, which means no streak, no badge and no
consequence attaches to an offer they did not take.

## 2. Suggestions: what Wobo offers inside the product

**Where they already exist.** The public ask box carries suggestion chips (`/v1/ask/suggestions`),
and the board offers an ask at the end of a turn. Those stay. What has no law is everything else.

**The four kinds, and what each is allowed to be:**

| Kind | Where | What it may say | What it may never say |
|---|---|---|---|
| the next thing | at the end of a card or a chapter | the one thing that follows, named, and why it follows | a list to choose from, a ranking, a nudge to keep going |
| the way back | when a learner is stuck twice on one idea | a different way into the same idea, from the chapter's own pool (docs/LEARNING-MODEL.md) | that they are struggling, or anything that reads as a verdict |
| the side door | the arcade, mid-chapter | that a game opened, and that it is optional | a reward for taking it that a learner loses by not taking it |
| the question to ask | on a lesson and on a chapter page | two or three questions this page can genuinely answer, drawn from the concept's own misconceptions | a question the page cannot answer, which is a promise broken on the tap |

**The rules.** At most one suggestion on screen at a time. A suggestion declined is not offered again
that session. It is never the loudest thing on the page. It is drawn from what this learner actually
did, never from what learners in general do, because the second is a recommendation engine and we are
a tutor. And a suggestion is never an advertisement for a plan.

## 3. Notices: when Wobo reaches outside the product

**Mail is already governed** by docs/MAIL-PRIMARY.md and the inbox law: at most one per address per
twenty-four hours, never on a day the learner came, every kind with its own one-click unsubscribe,
under 13 to the parent. Nothing here loosens that.

**Push notifications do not exist and are not built.** When they are, they inherit the inbox law
exactly, plus four rules of their own, because a push is more intrusive than mail and the same
cadence would be a different thing:

1. **Off until asked for.** No permission prompt on arrival. The offer appears once, after a learner
   has come back on their own at least three times, and never again if declined.
2. **Fewer than mail, never more.** A push and a mail about the same thing is one message, not two,
   and the push wins because it is the lighter one.
3. **Never at a late hour**, by the hours law, in the learner's own timezone, and never during school
   hours on a school day.
4. **Only three kinds ever**: the lesson they left half done, the answer to a doubt they photographed,
   and the day their streak would end, which is the only one that is a reminder rather than a result.
   No product news, no offers, no "we miss you", no re-engagement campaign.

**The parent's notices** are their own and quieter still: the Sunday note, the first week, and a
consent request. A parent is never pushed at all in the first release.

## 4. What is built, and what is not

| | |
|---|---|
| ask suggestion chips, the board's closing ask | **built** |
| the four suggestion kinds above, with their rules | **not built** |
| mail, verified and delivering | **built** |
| the five nudge kinds | **not built** (wave 38) |
| push notifications | **not built**, and deliberately last |

Push is last on purpose. It is the most intrusive thing we could ship and the easiest to get wrong,
and a product that has not yet earned a learner's return has not earned the right to interrupt them.
