# Emails

Specs for every message Wobo sends. Each file carries the trigger, the recipient, subject lines, preview text, the body in Wobo's voice, the variables it needs, and the rules that govern it.

## How to read a spec

- **Subject** — one primary. Alternates are for testing, not for a writer to pick from at random.
- **Preview text** — the preheader. It must add information, never repeat the subject, and never be an empty spacer.
- **Body** — final copy. Square brackets are placeholders for the owner; double braces are variables the system fills.
- **Variables** — every one the template needs, with an example.

## Laws that apply to all of them

- Sentence case. No emoji. No exclamation marks. Under 120 words unless the message carries a summary.
- Wobo by name; they and them only when a pronoun is unavoidable; Wobo writes as "I".
- No provider, model or vendor name anywhere, including in error explanations. In legal text the only permitted phrase is "third-party AI and infrastructure providers".
- Sender name and address come from configuration, not from a hard-coded string. Intended values: Wobo, from hello@heywobo.com, reply-to support@heywobo.com. Transactional mail may use a no-reply address only where a reply cannot be handled; every such message still says where to write instead.
- Every non-transactional message carries its category and a one-tap way to turn that category off. Categories are the ones in settings: progress moments, weekly summaries, exam reminders, and festival greetings, which has its own switch separate from other progress mail. Billing and account mail is not switchable and is not a category with an off switch.
- **Minors.** Marketing and lifecycle mail to a learner under 18 goes only where consent covers it, and anything about money is addressed to the adult who pays, never to the child. No message asks a child to ask a parent for money.
- **No manufactured urgency.** No countdown, no scarcity, no "you are about to lose". Renewal and payment mail states facts and dates.
- **Every claim is true at send time.** If a variable is missing, the sentence that needs it is dropped, not filled with a guess. Never send a summary with a zero in it dressed as an achievement.
- **Example values are not test data.** No example in any spec may be a payment provider's documented test value, or any other string that identifies a vendor. Card examples use a neutral last four, currently "card ending 1180".
- **Every syllabus example is checked against the live registry before the template is built.** Chapter and unit names in these specs get pasted straight into templates and test fixtures, and syllabuses are rationalised between years. A chapter that has been dropped from a board must not survive here as an example.
- Plain text version required for every one, and it must read properly on its own.
- Every email has an illustration slot at the top: Wobo drawing the thing the email is about, in ink. Never a stock photograph.

## The set

**Account and transactional**
`welcome` · `verify-email` · `password-reset`

**Progress and hospitality**
`first-lesson-done` · `first-week` · `unit-finished` · `boss-beaten` · `streak-milestones` · `streak-saved` · `quiet-week-check-in` · `before-exam` · `festival-wishes` · `birthday`

**Parent**
`parent-link-invite` · `parent-weekly-summary`

**Billing**
`plan-confirmation` · `receipt` · `renewal-reminder-30-days` · `renewal-reminder-7-days` · `payment-failed` · `cancel-thanks`

**Growth surfaces** (not email; specs live in [`../growth/`](../growth/))
`cancel-flow` · `gifted-week` · `gift-page`

**Win-back**
`win-back-30-days` · `win-back-90-days`

**Flags**
There is no flag control in the product: not on a lesson, not on a board, not on a practice item
(`docs/legal/community-and-flags.md` section 2). The two decks that described the flow —
`flag-received` and `flag-fixed` — were deleted on 2026-09-04 because nothing could ever send
them: there is no control to raise a flag, and no job that mails one. They promised a reader "a
person reads every one of these" for something a reader cannot do. The route today is
support@heywobo.com, read by a person. Write the decks again in the commit that ships the control.
