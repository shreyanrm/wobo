# plan-confirmation

**Kind:** transactional
**Trigger:** a paid plan starts
**To:** the account holder who paid
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** immediately
**Category:** billing. Not switchable off.

## Subject lines
**Primary:** Your Wobo {{plan_name}} is active
Alternates: {{plan_name}} is on

## Preview text
{{plan_price}} {{billing_period}}. Renews {{renewal_date}}. Cancel any time.

## Body

Your {{plan_name}} plan is active.

**What you pay.** {{plan_price}}, {{billing_period}}. The next charge is on {{renewal_date}} unless you cancel before then.
**What changes now.** {{allowance_line}}
**Cancelling.** Open You, then the card called Your plan, then Cancel. Two taps, no offer to stay and no reason to give. You keep {{plan_name}} until {{period_end_date}}, nothing is charged after that, and everything you have learnt stays either way.

{{renewal_notice_line}}

[Open Wobo]

{{family_block}}

Your receipt is in a separate email. Questions about billing go to support@heywobo.com and a person answers.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `plan_name` | Pro | "Pro" or "Max". Never a plan name the product does not sell. |
| `allowance_line` | Five times the free allowance, every day. | Pro: "Five times the free allowance, every day." Max: "Twenty times the free allowance, every day, and a second learner." Never a count of questions, and never "unlimited". |
| `plan_price` | [amount] | Real amount and currency as charged. Placeholder until the owner sets prices; never a made-up figure in code or screens. |
| `billing_period` | every year | "every month" or "every year". Gates `renewal_notice_line`. |
| `renewal_notice_line` | We will write to you 30 days and 7 days before {{renewal_date}} with the amount and the date, so a renewal is never a surprise. | Annual and family only. Monthly plans get: "We will write to you 7 days before {{renewal_date}} with the amount and the date, so a renewal is never a surprise." |
| `renewal_date` | 3 September 2027 | |
| `period_end_date` | 3 September 2027 | |
| `family_block` | — | Family plan only: how many seats, how to invite them, and that each seat is a separate account with its own private learning |

## Rules
- Renewal reminders are stated as a promise here because we actually send them, and the promise must match what is actually scheduled. `renewal_notice_line` is gated on `billing_period`: annual and family get the 30-day and 7-day wording, monthly gets the 7-day wording only. The 30-day sentence must never reach a monthly payer, who would never receive that notice and for whom 30 days is longer than the period itself.
- No upsell, no referral ask, no "tell your friends" in a confirmation.
- If the payer is a parent and the learner is a child, this goes to the parent only. The learner sees the change in the product, not in their inbox.
