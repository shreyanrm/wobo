# cancel-flow

**Kind:** product surface, two screens
**Trigger:** the payer taps Cancel on the Your plan card, in You
**To:** the account holder who pays
**Governed by:** DESIGN.md §0 "cancel, never refund" (owner, 4 September 2026), voice.md §8

## The shape

Two taps. The cancel control, then one confirmation that says exactly what is about to happen, and it is done. Nothing sits between them: no offer to stay, no smaller plan, no free month, no reason to pick, no survey, no second "are you sure". Leaving is as easy as joining, and the cancel button is never the quiet one.

This replaces the save flow WOBO-PLAN §14 sanctioned. The owner's ruling on 4 September 2026 removed the refund and, with it, the retention screen: a payer who cannot get money back must not also be made to argue their way out.

This file is the SPEC AND THE SHIPPED SCREEN, and the two are the same words. Where it once
described a "done" screen the panel never had, and headings the panel never printed, it now
describes what `apps/web-pwa/src/screens/you/PlanPanel.tsx` draws, with every line traced to where
that line lives. The strings are in `screens/you/plan.ts`; `plan.test.ts` holds them to this.

## Screen 1 — the confirmation

A modal dialog over the You screen. It is the only thing that floats on that screen.

**Heading** (`CONFIRM_TITLE`)
Cancel your plan

**Body** (`confirmationLines`, three lines and no fourth)
You keep {{plan_name}} until {{period_end_date}}. Nothing is taken away before then.

Nothing is charged after that, and your day goes back to the free allowance on its own.

Everything you have learnt stays: your history, your mastery, your climb.

[Cancel the plan] · [Keep my plan]

The date is written as a person reads one ("4 October 2026"). When the server sent no date the
first line says "until the end of the period you have paid for" rather than inventing one.

## Screen 2 — there is no screen 2

The cancel lands, the dialog closes, and the Your plan card re-renders in place. That IS the done
state, and it is deliberately not a page of its own: another screen after the exit is another step
in the exit.

**What the card then says** (`panelLines`, view `cancelled`)
{{plan_name}} until {{period_end_date}}.
Nothing will be charged again.
Everything you have learnt stays: your history, your mastery, your climb.

Beside it, the word `cancelled` in a pill — the state is carried by a word, never by a colour —
and one quiet control:

[Resume the plan]

**Data and deletion.** Export and delete are NOT on this card, and they are not behind a support
request either: they are on the same screen, in the Your data row a little above it ("Export or
delete everything, any time"). A learner cancelling can see both without leaving the page, and
cancelling a plan is kept a separate act from deleting an account, which it is.

## If it does not work

There is no failure SCREEN. The dialog stays exactly where it is, with the plan visibly untouched
behind it, and the failure is announced inside it as an `alert`.

**The line** (`CANCEL_FAILED`)
That did not go through, so your plan has not changed. Try again in a moment.

Both buttons come back enabled, so the retry is one tap on the control already under the finger.
The plan behind the dialog still reads active, still shows the date it runs to, and still has its
own Cancel. Nothing says support here, because there is nothing for support to do that the next
tap will not: the mailbox is on the card only in the one state the panel genuinely cannot act on,
a paid plan whose period the gateway cannot see.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `plan_name` | Pro | |
| `period_end_date` | 4 October 2026 | The end of the period already paid for. Read off the server's body, written the way a person reads a date, and never invented — when the server sends none, the copy says so in words |

## Rules
- **Two taps, and the second one is the exit.** No interstitial, no offer, no survey, no reason picker, no third screen. The confirmation states the consequence; it does not argue.
- **The cancel button is a real button**, the same weight as the one beside it, never grey text at the bottom of the page.
- **Nothing is taken away early.** The plan runs to the end of the period paid for, and the copy says the date rather than "the end of your period".
- **Resuming is offered, never required.** It appears on the card once the plan is ending; it never stands between the payer and the exit.
- **Never claim a cancellation that did not happen.** If the write fails, the dialog stays, the failure line above is what shows, and the plan is described as unchanged, because it is.
- **The deletion path is never behind a support request.** It is on the same screen as the plan, in Your data.
- **Nothing here says a plan renews.** Nothing in the product renews a subscription: there is no payment provider, no webhook and no scheduled sweep, and a plan runs to the end of the period paid for either way. Cancelling records the decision and stops anything being sold to that row later. Saying "it will still renew" would describe a mechanism we cannot show, which the copy law forbids.
- No child ever sees this flow. If the payer is a parent, it is theirs alone.
- `emails/cancel-thanks.md` sends after screen 2 and does not try to undo it.
- Money back is not offered here or anywhere else in the product. The refunds that remain are the ones the law requires, and they live in `docs/legal/refund-and-cancellation.md` section 5.
