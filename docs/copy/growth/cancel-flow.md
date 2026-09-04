# cancel-flow

**Kind:** product surface, two screens
**Trigger:** the payer taps cancel in settings, your plan
**To:** the account holder who pays
**Governed by:** DESIGN.md §0 "cancel, never refund" (owner, 4 September 2026), voice.md §8

## The shape

Two taps. The cancel control, then one confirmation that says exactly what is about to happen, and it is done. Nothing sits between them: no offer to stay, no smaller plan, no free month, no reason to pick, no survey, no second "are you sure". Leaving is as easy as joining, and the cancel button is never the quiet one.

This replaces the save flow WOBO-PLAN §14 sanctioned. The owner's ruling on 4 September 2026 removed the refund and, with it, the retention screen: a payer who cannot get money back must not also be made to argue their way out.

## Screen 1 — confirm

**Heading**
Cancel {{plan_name}}?

**Body**
You keep {{plan_name}} until {{period_end_date}}, the day the period you have already paid for ends. Nothing is charged after that, and the account goes back to the free allowance by itself. Everything you have learnt stays: your boards, your notes, your practice and your progress.

You can put the plan back any time before {{period_end_date}}.

[Cancel my plan] · [Keep my plan]

## Screen 2 — done

**Heading**
Your {{plan_name}} is cancelled.

**Body**
Nothing else to do, and you will not be charged again. {{plan_name}} runs until {{period_end_date}}, then the account goes back to free with everything you have learnt intact.

Changed your mind? One tap puts it back, any time before {{period_end_date}}.
[Resume {{plan_name}}]

If you want your data, or want the account gone entirely, both are one button here.
[Export everything] · [Delete my account and data]

## If it does not work

**Heading**
We could not cancel it.

**Body**
Something went wrong on our side and nothing has changed: {{plan_name}} is still on and it will still renew. Try again, or write to support@heywobo.com and a person will do it for you.

[Try again]

## Variables
| Variable | Example | Notes |
|---|---|---|
| `plan_name` | Pro | |
| `period_end_date` | 3 September 2027 | The end of the period already paid for. Computed, shown, never vague |

## Rules
- **Two taps, and the second one is the exit.** No interstitial, no offer, no survey, no reason picker, no third screen. The confirmation states the consequence; it does not argue.
- **The cancel button is a real button**, the same weight as the one beside it, never grey text at the bottom of the page.
- **Nothing is taken away early.** The plan runs to the end of the period paid for, and the copy says the date rather than "the end of your period".
- **Resuming is offered, never required.** It sits on the done screen and in settings; it never stands between the payer and the exit.
- **Never claim a cancellation that did not happen.** If the write fails, the failure screen above is what shows, and the plan is described as unchanged, because it is.
- **The deletion path is on the done screen**, not behind a support request.
- No child ever sees this flow. If the payer is a parent, it is theirs alone.
- `emails/cancel-thanks.md` sends after screen 2 and does not try to undo it.
- Money back is not offered here or anywhere else in the product. The refunds that remain are the ones the law requires, and they live in `docs/legal/refund-and-cancellation.md` section 5.
