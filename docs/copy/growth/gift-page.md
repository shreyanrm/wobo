# gift-page

**Kind:** product surface, heywobo.com/gift
**To:** an adult buying Wobo for someone else
**Governed by:** WOBO-PLAN §16 (the gift page), §14, voice.md §8

## The page

**Heading**
Give someone a tutor who sits beside them.

**Sub**
Pro, for {{gift_length}}, for one learner. They pick their own board and their own subjects; you never see their work unless they show you.

**How it works**
1. Choose the length and pay once. Nothing renews, ever, for you or for them.
2. Write a line. We send it with the gift on the day you choose.
3. They open it, set up their board, and start. It works on a phone, a tablet or a laptop.

[Give Pro]

**What it is**
A tutor that thinks out loud while it works. Ask a question about anything on the screen and the answer comes in the form the idea needs: drawn on a board, played as a short film, built as a thing to drag, or spoken. Then practice, and a memory of what did not stick. Every number checked by code before it is shown. Their syllabus, their board, their class, in their board's own words.

**What it is not**
Not a video library. Not a question bank. Not something that will pester them, guilt them about a streak, or sell them anything once you have paid.

**The honest footnote**
One gift, one learner, {{gift_length}}. Paid once, renews never, so there is nothing to cancel and nothing that can charge you again. After it ends, the account goes back to the free plan and everything they learnt stays.

## The gift message they receive

**Subject:** {{giver_first_name}} gave you Wobo

**Body**

{{recipient_first_name}}, {{giver_first_name}} gave you {{gift_length}} of Wobo Pro.

{{giver_message}}

I am a tutor. I draw, I film things, I build models you can drag, I talk it through, and I set the practice after. Tell me what you are studying and I will load your syllabus, in your board's own words, and we can start on whatever is hardest this week.

[Open Wobo]

Nothing renews and nothing is charged to you, now or later.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `gift_length` | three months | Words, not a number of days |
| `giver_first_name` / `recipient_first_name` | — | |
| `giver_message` | — | The giver's own line, unedited, shown as written. Drop the paragraph if empty. |

## Rules
- **No testimonials we did not receive, and no invented ones.** §16 notes that the reference product's gift page carries testimonials and "great gift for" cards. Ours carries them only when they are real and consented to, and until then the page carries none. An empty space is better than a fabricated quote.
- **Nothing renews.** A gift that quietly becomes a subscription is the exact dark pattern this system exists to avoid.
- **No money back is promised here.** A gift is paid once and renews never, so cancelling does not arise. The refunds that remain are the ones the law requires, and they live in `docs/legal/refund-and-cancellation.md` section 5, not on a page that sells.
- The giver never gets access to the learner's work. Say so on the page, in those words.
- No urgency, no seasonal countdown, no "order by" pressure. A seasonal banner may state a date; it may not imply loss.
- The price is the same as the equivalent plan. A gift is not a discount surface.
