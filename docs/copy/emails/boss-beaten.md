# boss-beaten

**Kind:** hospitality
**Trigger:** a boss battle is completed. Sent for the first boss, for synthesis bosses, and for a boss beaten with no help; not for every ordinary one.
**To:** the learner
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** within the hour, never between 22:00 and 07:00 local
**Category:** progress moments. Off switch in footer.

## Subject lines
**Primary:** You beat {{boss_name}}
Alternates: {{boss_name}}, on your own · That was the hard one

## Preview text
{{attempts_line}}

## Body

{{first_name}}, you got through {{boss_name}}.

{{wobo_note}}

Here is your working, with my marks on it.

[Open the board]

{{share_line}}

## Variables
| Variable | Example | Notes |
|---|---|---|
| `first_name` | (from the account) | |
| `boss_name` | The bridge problem | The boss's own name |
| `attempts_line` | Two attempts, no hints. | Preheader; must be accurate |
| `wobo_note` | You set it up wrong the first time and spotted it yourself before I said anything. That is the part worth noticing. | Generated, specific, behaviour-based |
| `board_url` | https://heywobo.com/boards/... | The marked working |
| `share_line` | If you want to show someone, the board shares as an image from the same page. | Only when a parent link exists, or as the neutral share line otherwise |

## Rules
- Never send for a boss that was completed with heavy help unless the copy says so plainly and warmly.
- A synthesis boss gets its own note naming the topics it crossed: "This one pulled in three chapters you learnt weeks apart."
- No XP number in the subject.
