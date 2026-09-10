# receipt

**Kind:** transactional
**Trigger:** any successful charge
**To:** the account holder who paid
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** immediately
**Category:** billing. Not switchable off.

## Subject lines
**Primary:** Receipt from Wobo, {{amount}}
Alternates: Your Wobo receipt for {{charge_date}}

## Preview text
{{plan_name}}, {{period_start}} to {{period_end}}. Next charge {{renewal_date}}.

## Body

Receipt for your Wobo plan.

| | |
|---|---|
| Amount | {{amount}} |
| Date | {{charge_date}} |
| Plan | {{plan_name}} |
| Period | {{period_start}} to {{period_end}} |
| Paid with | {{payment_method_last4}} |
| Receipt number | {{receipt_number}} |
| Next charge | {{renewal_date}}, {{amount}} |

[Download this as a PDF]

{{tax_block}}

Billed by [Company legal name], [postal address]. {{tax_id_line}}

To cancel your plan: open You, then the card called Your plan. For anything that looks wrong here, reply with this receipt number and a person will look at it.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `amount` | [amount] | Including tax, in the charged currency |
| `charge_date` | 3 September 2026 | |
| `plan_name` | Pro | |
| `period_start` / `period_end` | 3 September 2026 / 3 September 2027 | |
| `payment_method_last4` | card ending 1180 | Last four only, never a full number, never a card brand where the brand is a vendor name we can avoid |
| `receipt_number` | WB-2026-0000481 | |
| `renewal_date` | 3 September 2027 | Omit the row entirely if the plan will not renew |
| `pdf_url` | https://heywobo.com/receipts/... | |
| `tax_block` / `tax_id_line` | — | Tax lines required in the payer's country; owner and counsel fill these |

## Rules
- A receipt is a document. No product news, no tips, no marketing, no illustration beyond the wordmark.
- Amounts and dates must come from the charge record, never recomputed in the template.
- Retained and downloadable for as long as the law requires, even after the account is cancelled.
- **This retention is the one exception to the deletion promise made everywhere else in this system.** After a deletion we keep the billing records the law requires us to hold and nothing else, and backups age out within [n] days. `cancel-thanks`, `win-back-90-days` and help article 10 state that in fixed wording; this rule and those three must never drift apart.
- The exact retention windows, and the value of [n], go to counsel before any of this ships.
