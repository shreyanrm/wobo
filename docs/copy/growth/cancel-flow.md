# save-flow

**Kind:** product surface, three screens
**Trigger:** the payer taps cancel in settings, plan
**To:** the account holder who pays
**Governed by:** WOBO-PLAN §14 (no dark patterns in cancel flows), voice.md §8

## The shape

One screen of options, then it is done on the next screen. Two screens total, and the second one cancels whatever the first one offered. Saying no is never harder than saying yes, and the cancel button is never the quiet one.

## Screen 1 — before you go

**Heading**
Before you go, three other options.

**Body**
Cancelling is the button at the bottom and it works. These are here in case one of them is what you actually wanted.

**Option: pause**
Pause for {{pause_months}} months. Billing stops, your progress stays, and Pro comes back on {{resume_date}} unless you cancel before then.
[Pause instead]

**Option: a smaller plan**
Move to {{smaller_plan_name}} at {{smaller_plan_price}}. Fewer turns than Pro, more than free.
[Move to {{smaller_plan_name}}]

**Option: a month on us**
A month of Pro, free, if the reason is money rather than the product. No card, nothing renews at the end of it, and it is the same offer for everyone in this position.
[Take the free month]

**The exit**
[Cancel my plan]

## Screen 2 — done

**Heading**
Your {{plan_name}} is cancelled.

**Body**
Nothing else to do, and you will not be charged again. You keep Pro until {{period_end_date}}, then the account goes back to free with everything you have learnt intact.

If you want your data, or want the account gone entirely, both are one button here.
[Export everything] · [Delete my account and data]

If something specific pushed you out, tell us. A person reads it.
[Tell us in a sentence]

## Variables
| Variable | Example | Notes |
|---|---|---|
| `plan_name` | Pro | |
| `pause_months` | 3 | Real maximum pause the system supports |
| `resume_date` | 3 December 2026 | Computed, shown, never vague |
| `smaller_plan_name` / `smaller_plan_price` | — | Drop the whole option if no smaller paid plan exists |
| `period_end_date` | 3 September 2027 | |

## Rules
- **Two screens, and the second one is the exit.** No third interstitial, no "are you sure" on the confirm, no survey the payer must finish before cancelling.
- **The cancel button is a real button**, the same weight as the others, never grey text at the bottom of the page.
- Each option appears only where it genuinely applies. An option that cannot be honoured is not shown.
- The free month is a gift, not a discount, and it is the same gift for everyone who reaches this screen. It is offered once per account, ever.
- **The deletion path is on the done screen**, not behind a support request.
- No child ever sees this flow. If the payer is a parent, it is theirs alone.
- `emails/cancel-thanks.md` sends after screen 2 and repeats nothing from screen 1. The cancellation is done; the email does not try to undo it.
- Every "one screen" claim about cancelling elsewhere in the copy system was corrected to match this flow. If this flow is not built, those lines go back and this file is deleted rather than left as a promise.
