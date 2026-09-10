# streak-milestones

**Kind:** hospitality
**Trigger:** the streak reaches 7, 30, 100 or 365 days
**To:** the learner
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** the evening the milestone is reached, never between 22:00 and 07:00 local
**Category:** progress moments. Off switch in footer.

## Subject lines
**Primary:** {{streak_days}} days
Alternates: {{streak_days}} days, {{first_name}} · That is {{streak_days}} in a row

## Preview text
{{milestone_note_short}}

## Body

{{first_name}}, {{streak_days}} days in a row.

{{wobo_note}}

I drew you something for it.

[See it]

Take tomorrow off if you want it. The week holds one rest day and the count stays where it is.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `first_name` | (from the account) | |
| `streak_days` | 30 | 7, 30, 100 or 365 only |
| `wobo_note` | Thirty days is not about the thirty. It is that opening this is now automatic, which is the only part that was ever hard. | Per milestone, generated, warm and short |
| `milestone_note_short` | The hard part was the first week. | Preheader |
| `artifact_url` | https://heywobo.com/boards/... | The drawn milestone piece, sharable as an image |

## Rules
- **No threat, ever.** Nothing about losing the streak, nothing about what happens if they stop.
- The rest-day line is mandatory in every one of these. It is the whole difference between our streak and everyone else's.
- If the learner has turned streaks off, this email does not exist for them.
- At 365, the note is about the year's work, not the number.
