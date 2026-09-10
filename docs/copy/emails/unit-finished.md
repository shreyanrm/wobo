# unit-finished

**Kind:** hospitality
**Trigger:** every topic in a unit or chapter is mastered
**To:** the learner
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** within an hour, never between 22:00 and 07:00 local
**Category:** progress moments. Off switch in footer.

## Subject lines
**Primary:** {{unit_name}} is finished
Alternates: That is the whole of {{unit_name}} · {{unit_name}}, all of it

## Preview text
{{topics_count}} topics, and the one that gave you trouble is now the one you are best at.

## Body

{{first_name}}, that is all {{topics_count}} topics in {{unit_name}}.

{{wobo_note}}

I drew this while you worked through it. It is the whole chapter on one board, which is a useful thing to look at when the exam comes round.

[Open the chapter board]

{{next_unit_name}} is next in {{subject_name}} whenever you want it. There is also something outside the syllabus connected to this chapter that I think you would like; it is sitting on the topic page, marked as optional.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `first_name` | (from the account) | |
| `unit_name` | Quadrilaterals | The learner's own syllabus wording |
| `subject_name` | Mathematics | |
| `topics_count` | 6 | |
| `wobo_note` | Mid-point theorem took you four goes on Tuesday. You did the last three problems on it without a hint. | Specific, true, from this unit |
| `chapter_board_url` | https://heywobo.com/boards/... | The summary board; drop the paragraph and button if it does not exist |
| `next_unit_name` | Circles | Next in the syllabus order, checked against the live registry; drop the sentence if this was the last unit |

## Rules
- Mention the bonus lesson only if one actually exists for this unit.
- If the unit was finished mostly with support, say so honestly and offer the re-test: "Most of this went in with help beside you. I will bring three of them back next week to see what stuck on its own."
