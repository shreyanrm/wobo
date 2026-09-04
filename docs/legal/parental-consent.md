# Parental consent

Draft of 3 September 2026. Version 0.1. Written by the Wobo team, not yet reviewed by a lawyer. See `README.md` in this folder for the review checklist. This document is both a legal notice and the wording used in the product, so that what a parent reads on screen and what is written here are the same thing.

> **Read this first: none of this is built.**
>
> This document describes the consent flow Wobo is going to have. **It does not describe the product today.** There is no screen that asks a parent for permission, nothing records that permission was given, and no feature waits for it: memory, voice, photographs of a page and the parent link are all available to any signed-in learner of any age, right now. `childrens-privacy.md` section 3 states that plainly, and `docs/CONSENT-PLAN.md` is the plan for closing it.
>
> The document stays published, in the future tense, for two reasons: the wording in section 3 is the wording a parent will actually see, and a parent is entitled to know what is coming and what is missing.
>
> **In plain words, once it exists**
>
> If the learner is under 18, we will ask a parent or guardian to say yes before Wobo starts remembering them. We will verify that you are a real adult, tell you exactly what each feature does with your child's data, and you will tick only the ones you want. Nothing will be pre-ticked.
>
> Your child will be able to learn either way. What consent will switch on is memory, voice, photographs and sharing, never the teaching itself.
>
> You will be able to change your mind at any time, feature by feature, and the data behind a feature you switch off is deleted.

---

## 1. When we ask

The age at which a learner can hold their own account is set once, in `terms-of-service.md` section 4: from 13 the learner holds it; below 13 a parent or guardian holds the account with them; where local law sets a higher age, that age applies. This document is about the consent that goes with it, and does not change it.

**Not yet. Nothing below is enforced by the product.** When it is, we will ask for a parent's or guardian's verifiable consent when the learner is:

- under 18 anywhere in India; [REVIEW: DPDP Act 2023 section 9]
- under 13 in the United States, where the parent or guardian also holds the account; [REVIEW: COPPA, and whether consent given by the account holder for a child on their own account is treated as verifiable parental consent]
- under the age of digital consent in their EU member state, which is 13 to 16; [REVIEW: GDPR Article 8 and each member state's age]
- under 13 in the United Kingdom, where the parent or guardian also holds the account; [REVIEW: UK GDPR Article 8 as implemented by the Data Protection Act 2018 section 9, and the Age Appropriate Design Code]
- under 18 anywhere, for the optional features listed in section 3, whatever age the learner holds their account from;
- under whatever higher age the law where they live sets.

Above those ages, the learner consents for themselves, and we still write to them in language they will actually understand.

## 2. How we verify that you are the parent

We use a method proportionate to what is being consented to, and we keep a record that consent was given. [REVIEW: COPPA's list of acceptable verifiable-parental-consent methods, and whether the "email plus" method is sufficient given what we collect; the DPDP rules' expectations for verifiable consent, including the use of a Consent Manager or a virtual token issued by a digital locker; and the UK code's proportionate approach.]

The methods we intend to use, in order:

1. **A message to the parent's own email address or phone number**, entered by the learner, followed by a link that the parent opens, reads, and confirms from their own device, with a second confirmation sent afterwards so a child cannot quietly complete it. [REVIEW: this "notice plus confirmation" pattern is only sufficient for some kinds of collection.]
2. **A small refundable card charge, or a payment-instrument check**, where a stronger method is needed. [REVIEW: whether a payment-instrument check is on COPPA's list of acceptable methods for what we collect, whether the charge must be refunded or may be nominal, and whether taking a card detail from a parent solely to verify age is proportionate under the GDPR and the DPDP Act.]
3. **A government-backed digital identity or consent manager**, where one exists in the country and the law points to it. [REVIEW: India's Consent Manager framework.]

We never treat a tick box on a child's own screen as parental consent.

## 3. The notice a parent will see

This is the wording. It is written and reviewed and it is **not on any screen in the product**. When the screen exists, this is what will be on it: one page, plain language, before anything is ticked.

---

**Wobo would like your permission**

[Child's name] wants to learn with Wobo. Wobo is a tutor that explains school topics by drawing on a board and talking.

We are Dot eVentures Pvt Ltd, of 141 Prashasan Nagar, Jubilee Hills, Hyderabad, Telangana 500033, India. You can reach us at support@heywobo.com.

**Wobo can teach your child without any of this.** Everything below is optional, and your child keeps full access to lessons either way.

Please choose what you are happy for Wobo to do. Nothing is ticked already.

- [ ] **Remember how my child learns.** Wobo keeps what your child has understood, what they find hard, and the mistakes that keep coming back, so lessons build on each other instead of starting over. Without this, Wobo forgets between sessions. You can read and delete this memory at any time.
- [ ] **Let my child talk to Wobo.** Your child holds a button to speak, and Wobo answers out loud. Wobo never listens on its own, and there is no always-on microphone. The recording is turned into text and then deleted within a day. The text is kept with the rest of the conversation.
- [ ] **Let my child show Wobo a photograph.** A page of a textbook, a syllabus, or a homework question. Wobo reads the page. Wobo will remind your child never to send pictures of people.
- [ ] **Send me a weekly summary.** A short, honest picture of what your child worked on, sent to [parent contact]. You can stop it in one tap.
- [ ] **Let my child share their work.** A board or a progress image your child chooses to save or send. Nothing is ever shared automatically.
- [ ] **Send me occasional messages about Wobo itself.** New features and offers. Never sent to your child. Off by default and easy to stop.

To answer your child, some of what they type, say or photograph is sent to third-party AI and infrastructure providers who process it for us under contract. They cannot use it for their own purposes and cannot use it to train their own systems. The full detail is in our privacy policy and children's privacy notice.

We do not sell your child's data, we do not advertise inside Wobo, and we do not track your child anywhere else.

You can change any of this, or delete everything, at any time, by writing to support@heywobo.com.

By continuing, you confirm that you are the parent or legal guardian of [Child's name] and that you are over 18.

[ I agree to the terms of service and the privacy policy ]
[ Confirm ]

---

## 4. What will happen after you consent

- The features you ticked switch on, and nothing else does.
- We email you a copy of exactly what you agreed to, with the date, and a link to change it.
- We keep a record of the consent, what it covered, how it was verified, and when, because we have to be able to show it was given.
- We ask again if we ever want to do something materially different with your child's data. Fresh purpose, fresh question.

None of those four happens today. There is no consent record in the product: the field exists on every account and nothing ever writes it.

## 5. Your rights as a parent or guardian

At any time, and without giving a reason, you can:

**There are no parent controls.** A parent has no account, no login and no screen in Wobo. The words that used to head the right-hand column of this table pointed at something that has never existed. Every row below is an email to support@heywobo.com, which we answer by hand, except the two that a learner can do themselves on their own device.

| You want to | How, today |
|---|---|
| See everything Wobo holds about your child | write to support@heywobo.com |
| See what Wobo remembers about how your child learns | the memory page in the app, which lists it item by item. The learner opens it |
| Correct something wrong | the same page, in the app, or write to us |
| Have a copy of it all | there is no way to take a copy away yourself, so write to us and we assemble one by hand |
| Delete the memory and the progress record | the learner's own "erase and start over" in settings, which does not reach practice answers, board ink, session records or an uploaded syllabus |
| Close the account entirely | there is no control in the product that does this, so write to us and we do it by hand |
| Switch a feature off and delete the data behind it | there are no per-feature permissions, because there is no consent record for them to hang on, so write to us |
| Withdraw consent altogether | there is nothing to withdraw, because nothing was ever asked. See `childrens-privacy.md` section 3 |
| Refuse further collection while your child keeps learning | write to us and say so |
| Stop the weekly note | the link in any message, or the parent's own "not me" on the invite |

We do not ask you to explain why, we do not offer you a retention argument on the way out, and we do not hide any of this behind a support conversation designed to talk you out of it. What we do have to admit is that most of it is a conversation rather than a button, and that is a gap in the product and not a policy.

We respond within 30 days, usually far sooner, and we confirm in writing when a deletion is done. There is no ticketing system behind that commitment yet, so it is a promise about how we work rather than something a system enforces. [REVIEW: response-time obligations per jurisdiction.]

## 6. If a parent and a learner disagree

Where the learner is under the age of consent, the parent decides. Where the learner is above it and consenting for themselves, we follow the learner, and we will say so plainly to a parent who asks. Where the two conflict and the law is not clear, we take the more protective option for the child and explain what we have done. [REVIEW: the position where a 16-year-old in the EU consents for themselves but Indian law would require a parent, and the position on requests from a non-custodial parent.]

## 7. Guardians, and adults who are not parents

A legal guardian has the same rights as a parent. Where a learner has a guardian appointed by a court, or a carer acting under an arrangement recognised by law, we can accept their consent with reasonable proof. Write to support@heywobo.com. [REVIEW: proof standards, and the DPDP Act's provisions for persons with disability and lawful guardians.]
