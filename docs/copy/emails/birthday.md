# birthday

**Kind:** hospitality
**Trigger:** the learner's birthday, where a date of birth is known
**To:** the learner
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** morning, local time
**Category:** progress moments. Off switch in footer.

## Subject lines
**Primary:** Happy birthday, {{first_name}}
Alternates: It is your birthday · A drawing for your birthday

## Preview text
{{greeting_description}}

## Body

Happy birthday, {{first_name}}.

I drew you this. It is {{age}} of something, because that felt right.

[The drawing]

{{year_line}}

Nothing to study today.

## The drawn greeting

Wobo draws the number of the learner's new age out of something from a subject they have actually studied this year: {{age}} lamps, {{age}} points on a curve, {{age}} atoms in a chain, {{age}} triangles tiling. Drawn in Wobo's hand, in ink, one at a time.

`greeting_description` names it: "Fifteen points dropped on a curve, one at a time."

## Variables
| Variable | Example | Notes |
|---|---|---|
| `first_name` | (from the account) | Required; do not send without it |
| `age` | 15 | Only if the date of birth is known and reliable. If not, drop the age clause and the drawing counts something else. |
| `greeting_description` | Fifteen points dropped on a curve, one at a time. | Preview and alt text |
| `year_line` | You went from not liking graphs to finishing the whole chapter in about six weeks this year. | One true sentence from their own history; drop it for an account under three months old |
| `artifact_url` | https://heywobo.com/greetings/... | |

## Rules
- No gift, no discount, no offer, no "birthday sale". Nothing is sold to a child on their birthday.
- No streak, no XP, no "come back and study".
- Send once. If it fails to send on the day, do not send it late.
- If the learner has never told us a birthday, we do not ask for one to enable this.
