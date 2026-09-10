# renewal-reminder-30-days

**Kind:** transactional
**Trigger:** 30 days before an annual renewal. Annual and family plans only; monthly plans get the 7-day reminder only.
**To:** the account holder who pays
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** 30 days before {{renewal_date}}
**Category:** billing. Not switchable off.

## Subject lines
**Primary:** Your Wobo plan renews on {{renewal_date}}
Alternates: A month before your Wobo renewal

## Preview text
{{amount}} on {{renewal_date}}. Nothing to do if you want to keep it.

## Body

Your {{plan_name}} renews on {{renewal_date}} for {{amount}}.

Nothing to do if you want to keep it. If you would rather not, cancel any time before that date and you are not charged.

[Manage your plan]

{{year_line}}

The card we will use is {{payment_method_last4}}. If that has changed, update it on the same page.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `plan_name` | Pro | |
| `renewal_date` | 3 September 2027 | |
| `amount` | [amount] | Exactly what will be charged, including tax |
| `payment_method_last4` | card ending 1180 | |
| `year_line` | This year you finished 34 topics across maths and physics. | One true sentence of what the plan actually bought. Drop it if usage was low; never dress up a thin year. |
| `manage_url` | https://heywobo.com/settings/plan | |

## Rules
- **This is information, not a save attempt.** No offer, no discount, no reasons to stay beyond the one true line.
- The cancel path is named in the body and reachable in one click.
- If a price change applies at renewal, it is stated here, in the subject line as well, thirty days ahead. Never buried.
