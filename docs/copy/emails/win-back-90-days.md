# win-back-90-days

**Kind:** lifecycle, final
**Trigger:** 90 days with no activity
**To:** the learner, or the parent where consent sits with the parent
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** once, early evening local time. The last message of this kind we send.
**Category:** progress moments. Off switch in footer.

## Subject lines
**Primary:** The last one of these from me
Alternates: Your Wobo account, and what happens to it

## Preview text
Your work is kept. This is the last message of this kind you will get.

## Body

{{first_name}}, this is the last message of this kind I will send.

Your account stays as it is. {{topics_count}} topics, your boards, your notes, your syllabus. We do not delete work because someone stopped coming, so it will be there in a year if you want it.

If you have moved on, settings, your data, erases what Wobo remembers and the progress it built, in one screen. Closing the account itself is not a button yet: write to support@heywobo.com and we do it by hand, and we tell you when it is done. The only thing we keep either way is the billing records the law requires us to hold.

[Erase my data] · [Or pick up where you stopped]

{{return_line}}

I will not write again unless you come back or something changes on your account.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `first_name` | (from the account) | |
| `topics_count` | 12 | |
| `delete_url` | https://heywobo.com/settings/privacy | |
| `resume_url` | https://heywobo.com/resume | |
| `return_line` | If you are back for exams later in the year, tell me the date and I will work backwards from it. | One line, useful, no offer |

## Rules
- **The delete link comes first.** Offering the exit before the return is the point of this email, and it is the reason it is credible.
- **This is genuinely the last one.** After this, no lifecycle mail is sent to the account. Enforce it in the system, not in the copy.
- The deletion sentence is fixed wording, shared word for word with `cancel-thanks` and help article 10. Do not shorten it back to "we keep nothing".
- No offer, no discount, no urgency, no "your account will be closed".
- Never sent to an account under 18 without marketing consent.
