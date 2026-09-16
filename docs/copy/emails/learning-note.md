# learning-note

**Kind:** hospitality, the floor of the weekly cadence (wave 56)
**Trigger:** the address is owed a mail under the cadence (at least three in any seven days while the learner is learning, the ladder's number while they are away) and nothing the learner did earned one of its own
**To:** the learner, or the parent when the learner is under 13 (or their age is not known)
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** at the hour they usually learn, else four in the afternoon; never twice in a day, never late, never ahead of a mail the learner earned that day, and never on a festival wish's day
**Category:** notes about learning. Its own switch, its own one-click stop ("Stop this one"), and a parent's "Stop all of these".

The owner, 2026-09-16: most of the mail is good news about the learner's own work, and "we wont say use more, we encourage and motivate to learn, that is our application." So this note says one true thing from the activity record, and asks for nothing else.

## What it says

One of four, in this order, the first this address has not been told. The cadence chooses; the template never invents a fact it was not handed.

| Angle | When | Headline | The line (learner) | The line (parent) | Button |
|---|---|---|---|---|---|
| cracked, finished | a module finished in the last seven days | Every card, done. | You finished {{title}}, every card of it. | {{learner_first_name}} finished {{title}}, every card of it. | See what is next / See the chapter |
| cracked, solid | a topic mastered in the last seven days | That one is solid. | {{title}} is solid now, and you got it there by practising. | {{learner_first_name}} has {{title}} solid now, from practising it. | See what is next / See the chapter |
| next | a chapter in progress | Next up. | You are {{done}} cards into {{title}}, with {{left}} cards to go. | {{learner_first_name}} is {{done}} cards into {{title}}, with {{left}} cards to go. | Carry on / See the card |
| days | two or more learning days in the last seven | {{days}} days this week. | You learned on {{days}} days this week. That is how this gets easy. | {{learner_first_name}} learned on {{days}} days this week. That is how it gets easy. | Pick the next one / See the week |
| waiting | always, and the only angle below the full cadence | Where you left it. / Where they left it. | {{title}} is where you left it, with {{left}} cards to go. | {{title}} is where {{learner_first_name}} left it, with {{left}} cards to go. | Pick it up / See the card |
| waiting, nothing recorded | no chapter in progress | Bring a question. / Any question counts. | Anything from class that did not make sense is a good place to start. | {{learner_first_name}} can bring anything from class that did not make sense, any time. | Ask a question / See where to start |

**What is waiting, said six ways (2026-09-16).** The same fact is often true for weeks, and one sentence was sent eight times in a month, twice on consecutive days. The cadence counts the "waiting" notes a learner has been sent and the template says it the next way along, so no two in a row are the same sentence and no one repeats inside six.

| Way | Headline | The line (learner) | The line (parent) | Button |
|---|---|---|---|---|
| 0 | Where you left it. / Where they left it. | {{title}} is where you left it, with {{left}} cards to go. | {{title}} is where {{learner_first_name}} left it, with {{left}} cards to go. | Pick it up / See the card |
| 1 | Your place is saved. / Their place is saved. | Your place in {{title}} is saved, at the card you stopped on. | {{learner_first_name}}’s place in {{title}} is saved, at the card they stopped on. | Pick it up / See the card |
| 2 | Ready when you are. / Ready when they are. | You can pick {{title}} up exactly where you stopped. | {{learner_first_name}} can pick {{title}} up exactly where they stopped. | Pick it up / See the card |
| 3 | The next card. | Card {{next}} of {{title}} is next. | Card {{next}} of {{title}} is next for {{learner_first_name}}. | Open it / See the card |
| 4 | A bit at a time. | A few cards at a time is how {{title}} gets easy. | A few cards at a time is how {{title}} gets easy for {{learner_first_name}}. | Take the next one / See the card |
| 5 | Any question counts. | Anything in {{title}} that did not make sense is worth asking about. | Anything in {{title}} that did not make sense to {{learner_first_name}} is worth asking about. | Ask about it / See the card |

With nothing recorded, the two ways alternate: the one above, and "Worth asking." / "If something in class did not make sense, that is a good place to start." ("... did not make sense to {{learner_first_name}}, ..." for a parent).

Numbers are written as words, as in the other notes. "cards" becomes "card" for one.

## Subject lines

The name and a verb, rewritten without the name when there is none.

| Angle | Learner | Parent |
|---|---|---|
| cracked, finished | {{first_name}}, you finished {{title}} | {{learner_first_name}} finished {{title}} |
| cracked, solid | {{first_name}}, {{title}} is solid | {{learner_first_name}} has {{title}} solid |
| next | {{first_name}}, {{left}} cards to go in {{title}} | {{learner_first_name}} is {{done}} cards into {{title}} |
| days | {{first_name}}, {{days}} days of learning this week | {{learner_first_name}} learned on {{days}} days this week |
| waiting | {{first_name}}, {{title}} is where you left it | {{learner_first_name}} can pick up {{title}} any time |
| waiting, nothing recorded | {{first_name}}, bring a question from class | {{learner_first_name}} can bring any question from class |

When a long title would push the subject past 60 characters: "{{first_name}}, a note about your learning", or "A note about {{learner_first_name}}'s learning".

## Preview text

The line.

## The footer

Learner: "You get this because you have a Wobo account and notes about learning are switched on. {{cadence}} Reply to this note and a person answers."

Parent: "You get this because {{learner_first_name}} linked you as a parent, so notes about their learning come to you. Notes about learning are switched on. {{cadence}} Reply to this note and a person answers." (It said "is under thirteen" until 2026-09-16. The product holds no age, so that was a claim about most children that was not true of them.)

`{{cadence}}`, shared by every note of this family:
- on the full cadence: "It comes a few times a week, never twice in a day, and never late."
- below it: "It comes less often now, never twice in a day, and never late."

## Rules

- **Never a count of days away**, never "we miss you", never "we noticed", never a streak threat, never "come back". Below the full cadence the note is always "waiting": what is where they left it.
- **Never the same thing twice.** Each angle carries what makes it once-only (the moment and its day, the chapter and the card count, the week), and "waiting" is said a different way each time.
- **Good news may go on a day the learner came.** Only the come-back notes (the quick one, mid-chapter) are held by coming.
- **No open pixel, no click rewrite, no utm.** Whether it worked is read from whether the learner came back.
