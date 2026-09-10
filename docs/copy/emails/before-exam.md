# before-exam

**Kind:** hospitality
**Trigger:** an exam the learner told Wobo about, or a board exam window for their board and class, is {{days_until}} away. Sends at 14 days and 3 days.
**To:** the learner
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** early evening local time
**Category:** exam reminders. Off switch in footer.

## Subject lines
**Primary (14 days):** {{exam_name}} is in two weeks
**Primary (3 days):** Three days to {{exam_name}}
Alternates: What to go over before {{exam_name}}

## Preview text
**14 days:** {{weak_topic_1}}, {{weak_topic_2}}, {{weak_topic_3}}. Not the whole syllabus.
**3 days:** One topic and the flashcards that are due. Under an hour.

## Body — 14 days

{{first_name}}, {{exam_name}} is on {{exam_date}}.

I looked at what you have done and these are the three I would go over, in this order:

1. **{{weak_topic_1}}** — {{reason_1}}
2. **{{weak_topic_2}}** — {{reason_2}}
3. **{{weak_topic_3}}** — {{reason_3}}

That is it. Not the whole syllabus, these three, because they are the ones that are still shaky and they carry the most weight in what is coming.

[Start with {{weak_topic_1}}]

Sleep matters more than one more hour of this. I mean that.

## Body — 3 days

{{first_name}}, {{exam_name}} is on {{exam_date}}.

Three days out, going over everything is the wrong move. Do this instead: {{weak_topic_1}}, and the flashcards that are due. Both together is under an hour.

[Open revision]

Everything you have drawn with me is in your notes if you want to look back at a board rather than read.

Good luck. You have done the work.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `first_name` | (from the account) | |
| `exam_name` | your maths half-yearly | The learner's own words where they gave them |
| `exam_date` | Tuesday 14 October | Local format |
| `days_until` | 14 | Gates which body is used |
| `weak_topic_1..3` | Surface areas | From actual mastery data, weakest first; if fewer than three exist, send fewer |
| `reason_1..3` | you got the units wrong three times | One clause, true, from their own history |
| `revision_url` | https://heywobo.com/revise | |

## Rules
- Only send if we know a real exam. Never invent an exam window to create urgency.
- Never suggest a plan the learner cannot finish in the time. Three topics at 14 days, one at 3 days.
- The sleep line stays. It is the most useful sentence in the email.
- No plan pitch in an exam email, in either direction. Never sell to an anxious child.
