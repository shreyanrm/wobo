# docs/copy — the copy system

Everything Wobo writes to a person, and the rules that govern it. Written against `docs/WOBO-PLAN.md` (§14 growth, §15 every element earns its place, §16 the Brilliant floor, §17 white-label, §18 device agnostic, §19 Wobo has no gender), `DESIGN.md`, `docs/BOARD.md` and `docs/CURRICULUM.md`.

## What is here

| Path | What it is |
|---|---|
| [`voice.md`](voice.md) | The one page every writer reads first. Pronouns, case, punctuation, length, warmth, honesty, the vendor rule, the words we use and the ones we do not. |
| [`about.md`](about.md) | The About page: mission, how Wobo teaches, what we cover, our promises, team placeholder, and the element inventory for the page. |
| [`help-centre/`](help-centre/) | Three groups, 34 articles. Wobo basics, product features, boards and curriculum. Each article answers in its first line, then explains. |
| [`emails/`](emails/) | 25 specs: transactional, hospitality, parent, billing, win-back, flags. Subject lines, preview text, body copy, variables, rules. |
| [`growth/`](growth/) | The three growth surfaces WOBO-PLAN §14 and §16 name and that had no copy: the cancel flow, the gifted week, the gift page. |

## The rules that apply to every file here

1. **Wobo has no gender.** Name first. They and them only when a pronoun is unavoidable. Never she, her, he or him, in copy, drafts, prompts, tests or comments. Wobo speaks of itself as "I".
2. **Sentence case. No emoji. No exclamation marks.** The only exception in the whole system is the "do not write this" column in `voice.md` §10, which quotes copy we reject.
3. **"Hey Wobo" is two words.** The domain is heywobo.com.
4. **No vendor.** No provider, model, host, framework or payment brand is named anywhere. In legal text only, the phrase is "third-party AI and infrastructure providers".
5. **Answer first.** The first line of an article, an email or an error is a complete answer on its own.
6. **Honesty over polish.** We say what we do not know, we label uncertain content as uncertain, and we never claim progress that did not happen.
7. **No manipulation of minors.** No urgency, no scarcity, no streak threats, no selling to a child. Money is discussed with the adult who pays.
8. **Every non-transactional message has an off switch, in the message.**
9. **No invented person.** No made-up learner, parent or teacher name, anywhere — not in a page, an email spec, a variable example or a test fixture. Write "your child", "the learner", or address the reader. A real name arrives only as a variable the account fills.
10. **No grade gate.** No class, grade, year or age range on any public surface. "Every subject your board sets."
11. **No raw allowance.** No count of questions a day, in digits or in words. Free carries no multiplier; Pro is five times the free allowance and Max is twenty times. Never "unlimited", never "no daily limit".
12. **Location is inferred.** No country switch. The browser's time zone, or the request's country on the server, chooses the currency.
13. **Drawing is one part.** Wherever a line says Wobo draws, a neighbouring line names another form: it films, simulates, speaks, practises, remembers and reports.
14. **Promote before you invite.** Until the product opens, the closing call on a marketing surface is early access.

Rules 9 to 12 are enforced, not just written: `services/gateway/tests/test_copy_law.py` scans every file in this directory, the email templates and the public ask suggestions on each run, and fails the build. `voice.md` §8 is the long form.

## Placeholders the owner fills

`[Company legal name]` · `[postal address]` · `[support email]` · `[privacy email]` · `[careers email]` · `[Team placeholder]` · `[amount]` wherever a price appears · `[n]` the number of days a backup takes to age out, in the deletion sentence.


Sender identity, URLs and prices come from configuration, never from a hard-coded string in a template.

## Open decisions for the owner

These are not placeholders. They are places where the copy would have had to invent a product commitment, so it does not. Each one blocks the file it sits in.

| Decision | Where it bites | What is blocked |
|---|---|---|
| **The sign-in method.** WOBO-PLAN §6 specifies a third-party account button and phone OTP. A third-party sign-in button legally carries that provider's name and mark on the screen, which §17 forbids in our copy. Either drop the button and amend §6, or grant §17 a narrow exception for the sign-in screen. | `help-centre/wobo-basics/07-your-account-and-signing-in.md`, `emails/password-reset.md` | Both are marked do not ship. Email-code sign-in and the optional password are written against this unresolved choice and are not confirmed as built. |
| **What counts against a turn.** WOBO-PLAN §9 says the budget meter counts every tier, and lessons and boss battles run on paid tiers. Nothing may be described as not using turns until the metering rule is set. | `help-centre/wobo-basics/09-plans-and-billing.md` | The turns paragraph. |
| **What Pro actually includes**, beyond raising the allowance. Longer boards, priority under load, and a family plan with a seat count were all struck out: none is in the plan, and the six-seat shape came from the reference product, not from us. `prices.ts` gives Pro voice replies and longer boards and Max two learners; nothing beyond those may be written here until it is built. | `09-plans-and-billing.md`, `emails/plan-confirmation.md` | The Pro benefits list and the family block. |
| **Is there an annual cadence at all?** `apps/web-pwa/src/screens/plans/prices.ts` prices Pro and Max monthly only and states that there is no annual card. The billing specs were written against an annual plan and a 30-day renewal notice. Either add the cadence or delete `emails/renewal-reminder-30-days.md`. | `09-plans-and-billing.md`, `emails/renewal-reminder-30-days.md`, `emails/receipt.md` | Every sentence that says "annual". |
| **Retention after deletion.** How long backups take to age out, and which billing records the law requires us to hold. Counsel decides `[n]` before any of this ships. | `10-your-privacy-and-your-data.md`, `emails/cancel-thanks.md`, `emails/win-back-90-days.md`, `emails/receipt.md` | The deletion sentence, which is shared word for word across all four. |
| **The cancel flow is two taps and nothing else.** §14 sanctioned a save flow with a pause, a downgrade and a gifted month; the owner's ruling of 4 September 2026 removed the refund and the retention screen with it, and `DESIGN.md` §0 is the law that now governs. `growth/cancel-flow.md` was rewritten to match and every cancellation sentence in the system follows it. | `growth/cancel-flow.md`, `09-plans-and-billing.md`, `emails/plan-confirmation.md`, `emails/renewal-reminder-7-days.md` | Nothing. Left here because it contradicts WOBO-PLAN §14, which the owner has not yet amended. |
| **Hands-free listening for adults.** WOBO-PLAN §3 specifies hold-to-talk and a desktop hotkey only. If there is no wake word, "Hey Wobo" is a domain and not a phrase anyone says to the product. | `help-centre/wobo-basics/03-saying-hey-wobo.md`, `08-settings.md`, `voice.md` §2 | The article's first line and the settings entry. |
| **A textbook registry.** `CURRICULUM.md` §6 gives only a learner-supplied overlay. A curated per-board textbook list, and answering "where is this in my book" by chapter, need a scope decision and a copyright answer. | `help-centre/boards-and-curriculum/11-adding-your-textbook.md` | Two claims, both cut for now. |

## Tasks this raised for engineering

- **The copy-law gate is built.** `services/gateway/tests/test_copy_law.py` scans this directory, `services/gateway/src/wobo_gateway/email_templates.py` and the public ask suggestions for an invented first name, a class or age range, and a raw allowance count. It needs no allowlist: this file and `voice.md` name what they forbid rather than quoting it.
- **The CI gate needs an allowlist.** The scans for exclamation marks and for a gendered pronoun near "Wobo" must exempt `voice.md`, this file, and WOBO-PLAN §19, because all three state the rules by quoting what they forbid. Everything else fails the build.
- **Syllabus examples in specs are checked against the live registry** before a template is built. They get pasted into templates and fixtures, and boards rationalise their syllabuses between years.
- **Example values must never be a provider's documented test data.** A payment processor's test card number in a spec is both a vendor tell and a string that survives into a real receipt.

## Before anything here ships

- Read it aloud. If it sounds written for everyone, rewrite it for one person.
- Check the four scans: gendered pronoun, exclamation mark, emoji, vendor name. `test_copy_law.py` runs the other three for you: invented name, grade range, raw allowance.
- Check every claim is one the product actually keeps. Copy is a contract.
