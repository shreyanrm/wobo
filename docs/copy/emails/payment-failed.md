# payment-failed

**Kind:** transactional
**Trigger:** a charge is declined. Sends on the first failure and once more before the plan ends.
**To:** the account holder who pays
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** within an hour of the decline
**Category:** billing. Not switchable off.

## Subject lines
**Primary (first):** Your Wobo payment did not go through
**Primary (final):** Your Wobo plan ends on {{grace_end_date}}
Alternates: A payment problem on your Wobo plan

## Preview text
Nothing is lost. Update the card and it retries on its own.

## Body — first failure

The {{amount}} payment for your {{plan_name}} was declined by the card issuer on {{attempt_date}}.

This is usually an expired card, a changed number, or a limit on international payments. We do not get told which.

[Update your payment method]

We will try again on {{retry_date}}. Pro stays on until {{grace_end_date}}, and nothing about {{learner_first_name}}'s learning is affected either way.

## Body — final notice

We have not been able to take the {{amount}} payment for your {{plan_name}}, so the plan ends on {{grace_end_date}}.

[Update your payment method]

If you would rather leave it, that is fine. The account goes back to the free plan on {{grace_end_date}}. Every topic, board and note stays exactly where it is, and nothing is deleted.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `amount` | [amount] | |
| `plan_name` | Pro | |
| `attempt_date` / `retry_date` / `grace_end_date` | 3 September 2026 | |
| `learner_first_name` | (from the account) | Drop the clause if the payer is the learner |
| `update_url` | https://heywobo.com/settings/plan | |

## Rules
- **Never name the payment processor or the card network.** "The card issuer declined it" is the whole explanation we give, because it is the whole explanation we have.
- **Never alarm.** No red banner language, no "urgent", no "action required", no capitals.
- **Never contact the child about money.** If the payer is a parent, only the parent gets this, and the learner sees nothing.
- Say plainly that learning data is untouched. That is the actual worry.
- Two sends maximum. After the plan ends, `cancel-thanks` covers the exit.
