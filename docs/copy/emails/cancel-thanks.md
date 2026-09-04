# cancel-thanks

**Kind:** transactional
**Trigger:** a plan is cancelled, or lapses after a failed payment
**To:** the account holder who paid
**From:** Wobo <hello@heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** immediately on cancellation
**Category:** billing. Not switchable off.

## Subject lines
**Primary:** Your Wobo plan is cancelled
Alternates: Cancelled, and nothing is lost

## Preview text
Pro runs to {{period_end_date}}. Everything learnt stays, free, indefinitely.

## Body

Your {{plan_name}} is cancelled. Nothing else to do, and you will not be charged again.

**Until {{period_end_date}}** you still have Pro.
**After that** the account goes back to the free plan. Every topic, board, note and bit of progress stays exactly where it is, free, for as long as you want it.

If it was a mistake, one tap in settings puts the plan back, any time before {{period_end_date}}. After that there is nothing to put back.

If you want your data instead, or want the account gone entirely, both are one button in settings, data and privacy. We delete your account, your learning history and your boards, and it cannot be undone. The only thing we keep is the billing records the law requires us to hold, and backups age out within [n] days.

[Settings]

If something specific pushed you out, reply and tell us. A person reads it.

{{come_back_line}}

## Variables
| Variable | Example | Notes |
|---|---|---|
| `plan_name` | Pro | |
| `period_end_date` | 3 September 2027 | |
| `settings_url` | https://heywobo.com/settings/privacy | |
| `come_back_line` | Wobo is here on the free plan whenever you want it. | One line. Never a discount, never an offer, never a countdown. |

## Rules
- **No dark patterns.** The cancellation is already done when this arrives. This email does not argue with it. The one line about putting the plan back is a fact about the account, not an offer: no discount, no free month, no urgency, and it never appears before the cancellation is confirmed.
- **The deletion path is visible on the way out**, not hidden behind a support request.
- The deletion sentence is fixed wording, shared word for word with `win-back-90-days` and help article 10. It is qualified because it has to be: billing records are held for as long as the law requires. Do not shorten it back to an absolute.
- No offer, no "here is a month free to reconsider", no exit survey with required fields. One optional invitation to reply.
- The tone is a door held open, not a hand on the arm.
