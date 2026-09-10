# streak-saved

**Kind:** hospitality
**Trigger:** a day passes with no activity and the weekly rest day covers it, keeping the streak intact
**To:** the learner
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** the following morning, local time
**Category:** progress moments. Off switch in footer.

## Subject lines
**Primary:** Yesterday was your rest day
Alternates: Your streak is fine · Nothing lost yesterday

## Preview text
You are still on {{streak_days}} days. Nothing to do about it.

## Body

{{first_name}}, you did not open Wobo yesterday, so I used your rest day. You are still on {{streak_days}}.

That is what the rest day is for, and you get another one next week.

If you want to pick up where you stopped, you were partway through {{last_topic_name}}, and everything is exactly where you left it.

[Carry on]

## Variables
| Variable | Example | Notes |
|---|---|---|
| `first_name` | (from the account) | |
| `streak_days` | 23 | The unbroken count |
| `last_topic_name` | Trigonometric ratios | Drop the whole paragraph and button if there is no saved place |
| `resume_url` | https://heywobo.com/resume | |

## Rules
- Tone is a shrug, not a rescue. Nothing here implies the learner nearly lost something.
- Send at most once a week; if two rest days are used in a month, do not escalate the messaging.
- No guilt, no "we missed you", no question about why they were away.
