# welcome

**Kind:** transactional, sent once
**Trigger:** account created and first sign-in completed
**To:** the learner
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** immediately
**Category:** account. Not switchable off.

## Subject lines
**Primary:** Wobo is set up for {{board_short}} class {{class_name}}
Alternates: You are in, {{first_name}} · Your board is loaded

## Preview text
Everything is on your syllabus now. Here is where to start.

## Body

Hello {{first_name}}.

I am set up for {{board_short}}, class {{class_name}}. Your chapters are loaded in the order your board sets them, so when you open a subject it should look like the book on your desk.

Three things worth knowing on day one.

**Circle anything and ask.** On any screen, draw a loop around what you do not understand and ask me about it. I already know what it is, so you can just say "why is this negative".

**I pick the form, not just the words.** Some things I draw on a board, line by line. Some I play as a short film you can pause anywhere. Some I build so you can drag them and watch every number move. Some I just say.

**Then you try one.** When you are close I ring the gap on your own working and wait. I never say wrong.

[Open Wobo]

If your board or class is not right, change it in settings and nothing is lost.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `first_name` | (from the account) | From the account. If absent, drop "Hello {{first_name}}." and open on "I am set up for..." |
| `board_short` | CBSE | The board's short name as the learner picked it |
| `class_name` | 9 | The board's own word for the level, e.g. "9", "Grade 10", "Year 11" |
| `app_url` | https://heywobo.com/home | Button destination |

## Rules
- No plan pitch, no pricing, no referral ask. This email exists to make day one work.
- If board or class is unset, replace the first paragraph with: "Tell me what you are studying and I will load your syllabus." and link to that step.
