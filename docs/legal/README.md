# The legal set

Draft of 3 September 2026, with `refund-and-cancellation.md` revised on 7 September 2026 at version 0.3. Ten documents, written by the Wobo team, none of them reviewed by a lawyer. Nothing in this folder should be published until the checklist below is complete.

> **In plain words**
>
> This folder holds everything Wobo has to tell a learner and a parent about how the product works, what it does with their information, what it costs, and what it will not do.
>
> It is written to be read by a fourteen-year-old and by their parent, not by a lawyer, and then checked by a lawyer.
>
> Every line that depends on the law of a particular country is tagged `[REVIEW]`. There are 102 of them. Each one carries its own question, naming the statute, the decision or the figure to confirm, so a specialist can answer it without first working out what was meant.

---

## 1. The documents

| File | What it is | Who reads it |
|---|---|---|
| `terms-of-service.md` | the agreement to use Wobo | everyone, at sign-up |
| `privacy-policy.md` | what we collect, why, who sees it, how long we keep it, and your rights | everyone, at sign-up, and linked from settings |
| `childrens-privacy.md` | how a learner under 18 is treated differently | parents, and regulators |
| `parental-consent.md` | the consent flow wording, and a parent's rights | parents, in the consent flow |
| `cookies.md` | what we store on your device | everyone, from the cookie banner and the footer |
| `acceptable-use.md` | the rules of use | everyone, part of the terms |
| `refund-and-cancellation.md` | cancelling, renewals, and the refunds the law requires | anyone who pays, linked at checkout |
| `accessibility-statement.md` | what works, what does not yet, and how to tell us | anyone who needs it, linked in the footer |
| `safety-and-content.md` | what Wobo refuses, and what Wobo does when a learner is in distress | parents, schools, regulators |
| `community-and-flags.md` | flags, sharing, and contributed syllabuses | anyone who flags or shares |

They are meant to be read together and they cross-reference each other. Three of them, `acceptable-use.md`, `refund-and-cancellation.md` and `safety-and-content.md`, are stated to form part of the terms of service, so a change to one is a change to the contract.

## 2. How they are written

- **Plain English.** Short sentences. No legalese where a sentence will do. Written from the reader's side.
- **Sentence case headings**, no emoji, no exclamation marks, in line with `DESIGN.md`.
- **An "in plain words" box at the top of each**, which is the honest summary a reader should be able to stop at. Where a document has two audiences, the box has two halves, one for the parent and one for the learner.
- **Wobo has no gender.** The name comes first; where a pronoun is unavoidable it is they. Wobo speaks of itself as I.
- **White-label.** No provider, model or vendor is named anywhere. Where privacy law requires recipients to be disclosed, the phrase is "third-party AI and infrastructure providers", with a named list available on request. Whether category-level disclosure is enough is itself a `[REVIEW]` item, and it is the one most likely to force a change.
- **No promise the product cannot keep.** Every claim was written against `docs/WOBO-PLAN.md`. Where a behaviour is intended but not yet built, or not yet measured, the line says so or carries a `[REVIEW]` asking for it to be verified before publication.

## 3. Placeholders to fill before publication

| Placeholder | Where |
|---|---|
| `Dot eVentures Pvt Ltd` | every document |
| `141 Prashasan Nagar, Jubilee Hills, Hyderabad, Telangana 500033, India` | every document |
| `[governing law]`, `[courts]` | terms, section 14 |
| `Data protection contact`, `support@heywobo.com` | privacy policy, children's privacy |
| `Grievance officer, Dot eVentures Pvt Ltd` and contact, for India | privacy policy, refunds |
| `[EU representative]`, `[UK representative]` | privacy policy |
| `[regions]` where data is stored | privacy policy, section 6 |
| every retention period in square brackets | privacy policy, section 7 |
| every price, plan size and time limit in square brackets | refunds |
| `[screen readers]`, `[browsers]`, test dates | accessibility statement |
| liability cap `[amount]` | terms, section 13 |

Every email address used in these documents must exist and be answered before launch: support@, privacy@, dpo@, safety@, security@, accessibility@, legal@, all at heywobo.com.

## 4. The lawyer review checklist

Give this to counsel with the ten documents. It is grouped by subject, which is the shape a lawyer works in.

**For deciding what to pay for first, read `docs/LEGAL-REVIEW.md`**, which is the same material in one list ordered by how much it would cost to be wrong, with the five blocking items named. Where the two differ, that file has the priority and this one has the detail.

### A. Children, which is most of our users

- [ ] Confirm the age thresholds in `childrens-privacy.md` section 1 for every market we open in, including the age of digital consent in each EU member state.
- [ ] Confirm the verification methods in `parental-consent.md` section 2 are sufficient for what we collect, under COPPA, under the DPDP Act's rules on verifiable parental consent, and under the UK Age Appropriate Design Code.
- [ ] Confirm the split in `childrens-privacy.md` section 3 between what works before consent and what needs consent, and that we are not conditioning participation on more data than necessary.
- [ ] Confirm the DPDP Act position on tracking, behavioural monitoring and targeted advertising directed at children, and whether the tutoring profile is caught by it.
- [ ] Confirm whether a Data Protection Impact Assessment is required, which we assume it is, and commission it.
- [ ] Confirm whether we need a Consent Manager registration in India.
- [ ] Confirm whether an Article 27 representative is required in the EU and in the UK, and whether a DPO is mandatory.
- [ ] Confirm the school scenario in `childrens-privacy.md` section 8 against FERPA, US state student-privacy laws, and the position of a school as controller in the UK and the EU.

### B. Safety

- [ ] Have `safety-and-content.md` section 3 reviewed by a child-safeguarding specialist as well as a lawyer. It is the document most likely to be judged after an incident.
- [ ] Confirm mandatory reporting duties for child sexual abuse material and for a child at risk, per jurisdiction, and the retention duties that follow a report.
- [ ] Confirm the lawful basis for contacting a parent or an emergency service in a crisis, and the guidance where the parent may be the source of harm.
- [ ] **Build the helpline list, or do not publish `safety-and-content.md` section 3 step 4.** It does not exist today. It needs a named owner, a source per country, at least one free, confidential, child-accessible service in each country we sell in, a review cadence, a liveness check on every number, and a written fallback for uncovered countries. This is the highest-stakes unbuilt thing in the folder.

### C. Privacy

- [ ] Confirm the identity of the controller and data fiduciary, and whether a separate entity is needed for India or the EU.
- [ ] Confirm that naming categories of recipients rather than companies satisfies GDPR Article 13(1)(e), the DPDP notice requirements, and the CCPA notice at collection, especially for children's data. This is the point where the white-label rule meets transparency law.
- [ ] Confirm the legal bases table in `privacy-policy.md` section 3, and record the legitimate interests balancing tests.
- [ ] Confirm transfer mechanisms, the correct SCC modules, the UK addendum, and any Indian transfer restriction.
- [ ] Confirm each retention period against what the system actually does, not against what we would like it to do. Voice recordings, photographs and conversation history are the three to check first.
- [ ] Confirm the CCPA and CPRA categories table, the 12-month look-back, minors' opt-in for sale or sharing, the eraser-button law, and the universal opt-out signal.
- [ ] Confirm breach notification timelines and the internal runbook that meets them.
- [ ] Confirm the Article 22 position on profiling, given that the subjects are children.
- [ ] Verify that every provider contract carries a no-training and no-retention term, and that the zero-retention setting is enabled in production.

### D. Money

- [ ] Confirm the checkout disclosure and the two separate consent boxes against US state automatic-renewal laws and the EU rules on the payment-obligation button.
- [ ] Confirm the RBI recurring-payment position, including the current additional-factor-authentication limit and the 24-hour pre-debit notification, and confirm the payment provider actually sends it.
- [ ] Confirm the EU and UK cooling-off wording, the consent and acknowledgment we take at checkout, the proportionate refund on withdrawal, and publish the model withdrawal form.
- [ ] Confirm the app store sections against each store's current rules, including what a refund policy is required to say and what may be said about paying outside the store.
- [ ] Confirm tax treatment: GST, VAT and the OSS scheme, and US sales tax on digital services.
- [ ] Confirm the cancel flow contains no dark pattern under the FTC negative-option rule and California's requirements.
- [ ] **The owner's ruling is that we do not do refunds; a subscriber cancels instead** (`DESIGN.md` section 0, 4 September 2026). Confirm that a cancel-only policy is lawful in every market we sell in, and in particular: that the India e-commerce duty to publish a refund and cancellation policy is satisfied by a policy that says cancellation is the remedy; that no US state automatic-renewal law obliges a refund we have not listed in `refund-and-cancellation.md` section 5; and that nothing in that section can be read as contracting out of the EU, EEA or UK withdrawal right, which we cannot remove.

### E. The contract

- [ ] Confirm governing law, forum, and whether arbitration or a class-action waiver is workable when the counterparty is often a minor.
- [ ] Confirm the liability cap is enforceable against consumers in each jurisdiction, and that the consumer carve-outs are wide enough.
- [ ] Confirm the notice period for changes to the terms, and whether re-consent is needed for minors.
- [ ] Confirm the intellectual property position on curriculum extraction from official syllabus documents, including the EU and UK database right.
- [ ] Confirm the DMCA agent registration, the Indian intermediary rules, and the takedown timelines.
- [ ] Confirm whether the Digital Services Act applies, given that shared content is limited to links a learner sends and a contributed curriculum library.
- [ ] **The EU online dispute resolution platform is gone.** It stopped operating on 20 July 2025 and Regulation 524/2013 was repealed by Regulation (EU) 2024/3228, so the duty to link to it no longer exists. Both references have been removed from `terms-of-service.md` section 14 and `refund-and-cancellation.md` section 10. Confirm what replaced the linking duty in each member state we sell in, name the national consumer authority and any competent ADR body per market, and confirm whether we must state whether we commit to ADR.
- [ ] Confirm the three new clauses in `terms-of-service.md` section 15: how notice is given and when it counts as received, no waiver, and force majeure, each against consumer law and against the notice promises in sections 10 and 11.

### F. Accessibility

- [ ] Do not publish `accessibility-statement.md` section 2 until every claim in it has been measured. It is currently a statement of intent.
- [ ] Confirm which accessibility regimes bind us, and the European Accessibility Act deadlines.
- [ ] Confirm the required statement format, the feedback mechanism, and the enforcement route to name.

### G. Before publication

- [ ] Fill every placeholder in section 3 above.
- [ ] Make every email address live and staffed.
- [ ] Publish the model withdrawal form, the cookie settings panel, the memory page, the export control and the delete control, and check each one works, because each is promised in these documents.
- [ ] **Controls promised but not built.** Build these, or cut the sentence that promises them. The de-identification stage in the syllabus contribution job, which must fail closed when uncertain, and a test that proves it does. The automatic check and the named human reviewer on anything reaching the shared library. An honest answer, in `community-and-flags.md` section 5, to whether a share link is scanned at all. The per-country helpline list in section B. Until the first two exist, the shared library stays switched off.
- [ ] **Verify `privacy-policy.md` section 10 item by item before publishing it**, on the same footing as `accessibility-statement.md` section 2: row-level-security account isolation, access logging on personal data and its review, code review before ship, encryption in transit and at rest, provider review cadence, and the no-training and zero-retention provider terms. Drop any control not actually in place.
- [ ] **Check the two cross-document pairs that used to disagree**, and keep them in step in every future edit: the minimum age, set once in `terms-of-service.md` section 4 and referenced from `childrens-privacy.md` section 1 and `parental-consent.md` section 1; and the app-store price difference, stated in `terms-of-service.md` section 6 and `refund-and-cancellation.md` section 6. A third pair now joins them: the cancel-not-refund rule, stated in `terms-of-service.md` sections 6, 11 and 12 and in `refund-and-cancellation.md` sections 4, 5 and 9.
- [ ] Date and version every document, keep the old versions available, and set the change-notice mechanism running.
- [ ] Run a final read for tone: no legalese, no exclamation marks, no emoji, no vendor names, no gendered reference to Wobo.

## 5. Where the `[REVIEW]` tags are

102 tags across the ten documents. Every one of them names a statute, a decision or a figure to confirm; there are no bare tags left, because a tag with no question attached is a bill for a guess.

| File | Tags |
|---|---|
| `privacy-policy.md` | 25 |
| `terms-of-service.md` | 13 |
| `refund-and-cancellation.md` | 15 |
| `parental-consent.md` | 11 |
| `childrens-privacy.md` | 10 |
| `accessibility-statement.md` | 9 |
| `community-and-flags.md` | 6 |
| `cookies.md` | 8 |
| `acceptable-use.md` | 3 |
| `safety-and-content.md` | 2, one of which is the largest single tag in the set |

To list them: `grep -n "REVIEW" docs/legal/*.md`. To check none has gone bare again: `grep -n "\[REVIEW\]\|\[REVIEW\.\]" docs/legal/*.md` should return only the five prose mentions in this file.

## 6. Keeping them true

These documents describe a product that is still being built. Two rules keep them honest:

1. **A change to what the product does with data is a change to these documents, in the same wave.** Adding a feature that remembers something new, sends something somewhere new, or collects something new is not finished until the privacy policy says so.
2. **A claim we have not measured does not go in.** Where we want to say something and cannot yet prove it, it goes in as a `[REVIEW]` or it stays out.
