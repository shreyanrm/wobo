# first-week

**Kind:** hospitality, sent once
**Trigger:** seven days after the first sign-in, if the learner did anything at all in that week
**To:** the learner
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** day 7, mid-evening local time
**Category:** weekly summaries. Off switch in footer.

## Subject lines
**Primary:** Your first week with me
Alternates: One week in, {{first_name}} · What your first week looked like

## Preview text
{{headline_stat_sentence}}

## Body

{{first_name}}, this is what your first week looked like.

**{{topics_count}} topics**, across {{subjects_list}}.
**{{questions_asked}} questions** you asked me.
**{{hardest_thing}}** was the one that took the longest.

{{wobo_note}}

There is a thing most people find in week two. Try saying "teach it back to me" after a topic; you explain it to me, and I find the hole. It is uncomfortable and it works better than anything else I know.

[Open your progress]

Take a day off when you need one. It does not cost you anything here.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `first_name` | (from the account) | |
| `topics_count` | 4 | Drop the line if 0 |
| `subjects_list` | maths and physics | Natural language list, maximum three, then "and others" |
| `questions_asked` | 23 | Drop the line if 0 |
| `hardest_thing` | Factorising by grouping | The topic with the most attempts or help requests |
| `wobo_note` | You asked why after a wrong answer eleven times. That is the habit that decides how the year goes. | Behaviour-based, generated, true |
| `headline_stat_sentence` | Four topics, and eleven times you asked me why. | Preheader |
| `progress_url` | https://heywobo.com/progress | |

## Rules
- Do not send if the week was empty; `quiet-week-check-in` covers that case.
- No comparison to other learners, ever. No percentile, no leaderboard.
- No upgrade pitch in the first-week email.
