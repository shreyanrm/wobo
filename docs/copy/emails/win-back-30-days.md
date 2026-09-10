# win-back-30-days

**Kind:** lifecycle
**Trigger:** 30 days with no activity, on an account that had at least one completed topic
**To:** the learner, or the parent where the learner is under 18 and marketing consent sits with the parent
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** once, early evening local time
**Category:** progress moments. Off switch in footer.

## Subject lines
**Primary:** {{topics_count}} topics are still waiting where you left them
Alternates: Your place in {{last_topic_name}} is still saved · Nothing has expired

## Preview text
Nothing has gone. Ten minutes gets you back into {{last_topic_name}}.

## Body

{{first_name}}, it has been about a month.

Everything is where you left it: {{topics_count}} topics done, your syllabus, your notes, and your place partway through {{last_topic_name}}. None of it expires and none of it has been touched.

{{new_thing_line}}

[Carry on from where you stopped]

If Wobo was not what you needed, that is a real answer and I would rather know it. Reply and tell me, or turn these off below.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `first_name` | (from the account) | |
| `topics_count` | 12 | Must be a real number greater than zero, or this email does not send |
| `last_topic_name` | Circles | Drop the clause if there is no saved place |
| `new_thing_line` | Since you were last here I can read your handwritten working on the board and mark the step, not just the answer. | One genuine change since their last session. If nothing changed, drop the line rather than inventing one. |
| `resume_url` | https://heywobo.com/resume | |

## Rules
- **One send.** Then nothing until day 90.
- No offer, no discount, no free trial dangled at a child.
- No guilt, no "we miss you", no streak reference, no count of days away in the body.
- Never sent during a known school holiday window for the learner's region.
- If the account is under 18 and there is no marketing consent, this is not sent at all.
