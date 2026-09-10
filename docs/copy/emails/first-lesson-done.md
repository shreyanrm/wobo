# first-lesson-done

**Kind:** hospitality, sent once
**Trigger:** the learner completes their first lesson, including its boss
**To:** the learner
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** within an hour of finishing, never between 22:00 and 07:00 local time
**Category:** progress moments. Off switch in footer.

## Subject lines
**Primary:** You finished {{topic_name}}
Alternates: That is one topic down · {{topic_name}}, done

## Preview text
{{one_line_about_how_it_went}}

## Body

{{first_name}}, you finished {{topic_name}} today.

{{wobo_note}}

Here is the board from the part you got stuck on. It still works, so you can move the slider and scrub it back to watch it being drawn.

[Open the board]

Whenever you want the next one, {{next_topic_name}} follows from this, and I have your place ready.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `first_name` | (from the account) | Drop the name if absent |
| `topic_name` | Linear equations in one variable | The learner's own syllabus wording |
| `wobo_note` | You got the balance step wrong twice and then asked me why, which is the reason the third one took you ten seconds. | Generated per learner from what actually happened. Two sentences maximum. Behaviour, never flattery. Must be true. |
| `one_line_about_how_it_went` | The balance step is the one that clicked. | Preheader, generated |
| `board_url` | https://heywobo.com/boards/... | A real board from this lesson; drop the paragraph and the button if none was drawn |
| `next_topic_name` | Linear equations in two variables | From the syllabus order |

## Rules
- No XP number in the subject line. The achievement is the topic, not the points.
- If the lesson went badly, say so kindly and specifically, and still send. "That one was rough. The bit that tripped you was X, and I have a different way in when you are ready."
- Never a streak reference in this email.
