# Cancelling, renewals and refunds

Draft of 4 September 2026. Version 0.2. Written by the Wobo team, not yet reviewed by a lawyer. See `README.md` in this folder for the review checklist. This document forms part of the terms of service. Prices in the product are placeholders until the owner sets real ones, and every figure below is an example.

> **In plain words**
>
> Wobo is free to use. If you pay, you are paying for higher limits and a few extra features, not for the teaching itself.
>
> A subscription renews on its own until you cancel. We tell you the price, the date and the amount before you pay, and again before each renewal.
>
> Cancelling is the answer to almost everything here. It takes two taps in settings, at any time, with no phone call, no offer to make you stay and no reason to give. You keep the plan until the end of the period you have already paid for, nothing renews after that, and everything you learnt stays. Change your mind before the period ends and one tap puts the plan back.
>
> We do not give money back as a gesture of goodwill. Where the law gives you a refund you have it, and section 5 lists every case: a charge after you cancelled, a charge taken twice, a charge you did not authorise, a service we did not supply, and the cooling-off right in the European Union, the European Economic Area and the United Kingdom.

---

## 1. What you can buy

| Plan | What it is |
|---|---|
| Free | Wobo, with a daily allowance of tutoring turns and generated lessons. The allowance and its reset time are shown in the app |
| Pro, monthly | a higher daily allowance and spoken replies, billed every month, for one learner |
| Max, monthly | a higher allowance again, and two learners on one plan, billed every month |
| Gift | a fixed period bought for someone else, which does not renew |

This table is the plans page, and it is kept the same as `apps/web-pwa/src/screens/plans/prices.ts`, which is the one place a tier or a price is written down. There is no annual plan and no family plan; if either is ever sold, it is added here in the same change that adds it there. The benefits of each plan are listed on the plans page before you buy, with what is included and what is not.

## 2. Before you pay

On the checkout screen, before the payment control, you will see, together and in the same place:

- what you are buying;
- the total amount, in your currency, with tax stated;
- how often it renews, and on what date the first renewal falls;
- that it renews automatically until you cancel;
- how to cancel, in one line, and where the control is;
- a separate, unticked box to accept the terms of service and the privacy policy;
- a separate, unticked box acknowledging the recurring charge, naming the amount, the frequency and the cancellation route.

We keep those two boxes separate because agreeing to terms and agreeing to be charged repeatedly are two different decisions. [REVIEW: US state automatic-renewal laws, particularly California's, on clear and conspicuous disclosure, affirmative consent to the recurring charge, and the acknowledgment that must be sent afterwards; and the EU rules on the order button being labelled with a payment obligation.]

After you pay, we email you the same information again, with the receipt.

## 3. Renewals

- A monthly plan renews every month on the same date. Every plan we sell is monthly.
- We send a reminder before a renewal, at least [7 days] ahead, with the amount and the date, and a link to cancel. [REVIEW: notice windows required by US state automatic-renewal laws, and by the EU where a contract auto-renews. Also confirm, before this document is published against a live checkout, that the reminder is actually sent: `docs/copy/emails/renewal-reminder-7-days.md` is written but nothing in `services/gateway` sends it, because nothing renews yet.]
- If the price changes, we tell you at least [30 days] before the renewal it applies to, and you can cancel before it takes effect. A price change never applies to a term you have already paid for. [REVIEW: the notice period a price change requires in each market, whether the change needs the subscriber's affirmative consent rather than silence, and the US state automatic-renewal rules on notifying a material change to a recurring charge.]
- If a payment fails we retry, tell you, and give you [7 days] to fix it before the plan drops back to free. Nothing is deleted.

**In India**, recurring card and account mandates follow the Reserve Bank of India's framework for recurring payments. That means the mandate is set up with additional factor authentication the first time, we send you a pre-debit notification at least 24 hours before each charge with the amount and the date, you can cancel the mandate at any time without going through us, and charges above the limit the framework sets need you to authenticate again. [REVIEW: RBI's e-mandate circulars and the current per-transaction limit for additional factor authentication, which has been revised more than once; confirm the payment provider actually sends the pre-debit notification and that we are not double-sending.]

## 4. Cancelling

Cancelling is the main thing this document is about, so it is written out in full.

**Where it is.** Open You, the last of the four doors in Wobo, and find the card called Your plan. Cancel is on it. Two taps: the control, and one confirmation that states exactly what is about to happen. Writing to support@heywobo.com works too, and we will do it for you.

**What we do not do on the way out.** No phone call. No chat with a person. No reason to pick, no survey, no discount to stay, no pause offered instead, no second screen asking whether you are sure. The confirmation is a confirmation, not a negotiation. [REVIEW: the FTC's negative-option rule and its litigation history, and California's requirement that cancellation be available by the same route used to sign up.]

**What happens.**

- The plan stays live until the end of the period you have already paid for. Nothing is taken away early.
- Nothing renews after that. There is no further charge, and the account moves to the free allowance by itself on the day the period ends.
- Everything you learnt stays: your history, your boards, your notes, your mastery and your climb. Cancelling a plan is not deleting an account.
- Nothing is deleted unless you delete it. Deleting your account is a separate control, described in `privacy-policy.md`.

**Changing your mind.** While the period you paid for is still running, one tap puts the plan back on and it renews as it did before. After the period ends there is nothing to resume, and you would be subscribing again at whatever the price is then.

**If it does not work.** If the cancellation fails to save, we say so plainly and the plan is unchanged, so you can try again or write to us. We never show a cancellation that did not happen.

**Bought through an app store.** Cancel it in the store, not here. Section 6 has the detail, and our cancel control will point you there rather than pretending it can do it for you.

## 5. Refunds

We do not refund as a gesture of goodwill, and we would rather say that here than let you find it later. Cancelling is the answer to a change of mind: you stop the next charge, you keep the plan to the end of the period you paid for, and nothing renews.

Some refunds are not goodwill. They are yours by law or because we took money we had no business taking, and in each of these cases we refund without argument, on request to support@heywobo.com:

- **A charge taken after you cancelled.** Returned in full.
- **A charge taken twice for the same period.** The duplicate returned in full.
- **A charge you did not authorise.** Returned in full, and we will help you with your bank if you need it.
- **A service we did not supply.** If we could not deliver what you paid for, or we ended your plan ourselves for a reason that is not serious misuse, we return the part of the term you did not get.
- **The cooling-off right, where you have one.** Set out immediately below.

**Cooling off, European Union, European Economic Area and United Kingdom.** You have 14 days from the day the contract is made to withdraw, without giving a reason. Digital content and digital services have a wrinkle: if you ask us to start straight away, and acknowledge that doing so means you lose the right to withdraw once the service has been fully supplied, then you lose it to that extent. Because Wobo is supplied over time rather than delivered once, if you withdraw within 14 days after starting we refund the amount in proportion to what is left, rather than nothing. We ask for that consent and that acknowledgment explicitly at checkout, in their own words, not buried. This right is not ours to remove, and nothing above shortens it. [REVIEW: Consumer Rights Directive Articles 9, 14(4)(b) and 16(m); the UK Consumer Contracts Regulations 2013 and the Consumer Rights Act 2015; the distinction between digital content supplied once and a digital service supplied over a period; and the model withdrawal form, which we must publish.]

**India.** A charge after cancelling, a duplicate charge and an unauthorised charge are reversed in full. Beyond those, a period already used is not refunded; you cancel instead, and keep what you paid for until it ends. Your rights under the Consumer Protection Act 2019 and the e-commerce rules are unaffected, and our grievance officer is named in `privacy-policy.md`. [REVIEW: Consumer Protection (E-Commerce) Rules 2020, including the duty to publish a clear refund and cancellation policy, the duty to name a grievance officer with a response timeline, and whether a policy of cancellation rather than refund satisfies that duty.]

**United States.** We refund where the charge was unauthorised, where it was taken after cancellation, and where the automatic-renewal disclosure or the cancellation route was not what the law requires it to be. State law may give you more, and where it does, it wins. [REVIEW: state automatic-renewal laws that require a refund where the disclosure was defective, and any state with a statutory cooling-off period that reaches digital services.]

**Everywhere.** Refunds go back to the payment method you used, within [10 working days] of us approving them, and your bank may take a few days more. Where a refund is due by law, we do not require you to accept credit instead.

**Gifts.** A gift is paid once and renews never, so there is nothing to cancel and nothing to stop. The cases above still apply to the person who paid: a duplicate charge, a charge they did not authorise, a gift we failed to deliver, and the cooling-off right where they have one. Once a gift has been opened it belongs to the learner who received it. [REVIEW: whether the cooling-off right survives redemption by a third party, and whether an unredeemed gift is a digital service that has not yet begun.]

**Free periods, gifted weeks and promotions.** These have no cash value and nothing to refund, because nothing was paid. Where a free period turns into a paid one, we tell you before the first charge and you can stop it in one tap.

## 6. If you bought through an app store

If you subscribed inside a phone app, the store took the payment, not us. That means:

- **Cancel in the store**, not in Wobo. Our cancel control will point you there, and we will also tell you how in one line.
- **Refunds are handled by the store**, under its own policy and its own time limits, which can be shorter or different from ours, and which apply whatever this document says.
- If the store refuses and we think you were owed a refund, write to support@heywobo.com and we will try to help, though we cannot reverse a charge we never received.
- **The price can differ by route.** Buying inside a phone app can cost more than buying on the web, because the store takes a share of what you pay it. The price is the same for everyone on the same purchase route, and we show both prices so you can see the difference before you choose. This is the one exception to the promise in `terms-of-service.md` section 6 that nobody pays a different price for the same plan, and it is stated in both documents so the two agree.

[REVIEW: the exact wording each app store requires in a refund policy, the store rules on directing users to an external payment route, which vary by country and change often, and the current position on external purchase links.]

## 7. Taxes

Prices include tax where we are required to show them that way, and add it at checkout where we are not. If you are buying for a business with a valid tax registration, tell us before you pay. [REVIEW: GST in India, VAT and the OSS scheme in the EU, UK VAT, and US sales tax on digital services state by state.]

## 8. Changes to a plan

- **Upgrading** takes effect at once, and we charge the difference for the rest of the period.
- **Downgrading** takes effect at the end of the period you have paid for.
- Neither is ever offered to you as a way of talking you out of cancelling. The cancel confirmation carries no plan change, no pause and no discount, and it never will.
- [REVIEW: there is no upgrade or downgrade control in the product today — the Your plan card offers cancel, resume and a door to the plans page, and nothing else. Both bullets above describe what happens at a checkout that is not open. When one is built, say where the control is; until then this document must not say it is anywhere.]

## 9. If we end it

If we close your account for a reason that is not serious misuse, we return the unused part of your term, because that is a service we did not supply rather than a goodwill refund. If we retire a paid feature you were relying on, we will tell you first and offer you the same. [REVIEW: whether withholding this return on closure for misuse is lawful in each consumer jurisdiction, and what notice a subscriber is owed before a paid feature is retired. This must match `terms-of-service.md` section 12.]

## 10. Complaints

support@heywobo.com first. If we cannot resolve it, the routes in `terms-of-service.md` section 14 apply: the consumer protection authority in your own country, an approved alternative dispute resolution body where one covers our sector, the courts where you live, and, in India, our grievance officer and then the consumer forums. [REVIEW: the European Commission's online dispute resolution platform closed on 20 July 2025 and must not be offered here; name the national consumer authority and any competent ADR body per market, and confirm the Indian grievance-redressal timelines under the Consumer Protection (E-Commerce) Rules 2020.]
