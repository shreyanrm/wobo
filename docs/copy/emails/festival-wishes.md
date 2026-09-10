# festival-wishes

**Kind:** hospitality, template
**Trigger:** a festival in the learner's region, chosen from a curated list, on the day
**To:** the learner
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** morning, local time
**Category:** progress moments. Off switch in footer.

## Subject lines
**Primary:** Happy {{festival_name}}
Alternates: {{festival_name}} wishes from me · A small drawing for {{festival_name}}

## Preview text
{{greeting_description}}

## Body

{{first_name}}, happy {{festival_name}}.

I drew you something.

[The drawing]

{{festival_line}}

Nothing to do today. Come back when you come back.

## The drawn greeting

Every festival email carries one drawing, made by Wobo's own hand in ink, in the same style as everything else Wobo draws. Never a stock illustration, never a photograph, never a generic gradient card.

**`greeting_description`** is one line describing what Wobo drew, used as the preview text and as the image's alternative text. It names the thing, not the feeling.

Examples of the shape it takes:

| Festival | greeting_description |
|---|---|
| Diwali | A row of lamps drawn one by one, the last one still being lit. |
| Eid | A thin crescent drawn in one stroke, with the night filled in around it. |
| Christmas | A star drawn over a rooftop line, the ink still wet at the last point. |
| Pongal | A pot drawn boiling over, the steam sketched in three curls. |
| Onam | A flower circle laid out ring by ring, the middle one left for you. |
| Losar | A prayer flag line drawn across the page, each flag a single stroke. |
| Nowruz | Seven small things drawn on a cloth, counted out as they land. |

**`festival_line`** is one sentence, warm and specific to the festival, that does not lecture the learner about their own culture and does not explain the festival to them. One line, then stop.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `first_name` | (from the account) | |
| `festival_name` | Diwali | Exact name as used in the learner's region |
| `greeting_description` | A row of lamps drawn one by one, the last one still being lit. | Preview text and alt text |
| `artifact_url` | https://heywobo.com/greetings/... | The drawing, sharable as an image |
| `festival_line` | I hope the house is loud and the food is good. | One sentence |

## Rules
- **Only festivals the learner's own region and account signals support.** Never guess a religion from a name. If we are not confident, we do not send.
- One festival email per learner per quarter at most. This is a greeting, not a calendar campaign.
- No lesson, no streak, no plan pitch, no "study smart this festive season". The email sells nothing.
- No exclamation marks, including in "Happy {{festival_name}}".
- A learner can turn festival greetings off separately from other progress mail.
