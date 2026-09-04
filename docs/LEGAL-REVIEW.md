# What needs a lawyer, in the order it would cost most to be wrong

Written 4 September 2026, as part of the honesty pass on branch `the-life`. One list, for the owner,
to hand to counsel as it stands.

**Why this exists separately from the checklist in `docs/legal/README.md`.** That checklist is
grouped by subject, which is the right shape for a lawyer working through the folder. This one is
ordered by exposure, which is the right shape for deciding what to pay for first. Where they differ,
the README has the detail and this file has the priority. The 101 inline `[REVIEW: ...]` notes across
the ten documents are the third layer: each one names its own statute and sits on the sentence it
doubts, and none of them is resolved.

**Two things to say plainly before the list.**

- Nothing in `docs/legal/` has been reviewed by a lawyer. The documents render live at
  `heywobo.com/legal/*` today, behind a banner that says they are an unreviewed draft
  (`apps/web-pwa/src/screens/legal/Legal.tsx:49-57`). Keeping that banner is not optional.
- Five of these items are not questions about wording. They are questions about whether the product
  may be sold in a market in the state it is in. Those are marked **BLOCKING**.

---

## 1. BLOCKING. May Wobo be offered to a child at all, today, with no consent mechanism?

**Cost of being wrong:** the largest on this list by an order of magnitude. India's DPDP Act carries
penalties up to ₹250 crore for a failure of children's-data obligations, and India is the primary
market. COPPA civil penalties run per child per violation. A GDPR Article 8 failure is in the higher
tier, up to 4 % of global turnover. All three attach to a product that is live and taking sign-ups.

**The facts counsel needs.** There is no consent mechanism in the product. `consent_tier` is read on
every capability call and written by nothing. Memory, voice, photograph intake and the parent link
are ungated at every age. The declared date of birth is never sent to a server, so nothing on our
side can act on age even if it wanted to. `docs/CONSENT-PLAN.md` sets it out in full with the code
references, and `docs/legal/childrens-privacy.md` section 3 now says it to parents.

**The questions.** Whether the product may lawfully continue to be offered in India, the EU, the UK
and the United States in this state; what the exposure is for the period it has already been offered;
whether the honest disclosure now published changes that answer; and, if the answer is that it may
not, what has to happen this week rather than this quarter.

## 2. BLOCKING. The crisis path, and the helpline list that does not exist

**Cost of being wrong:** a child comes to harm and this is the document that is read afterwards.
There is no cap on that, financial or otherwise.

**The facts.** The distress reply names two Indian helplines, Childline on 1098 and Tele-MANAS on
14416, to every learner in every country (`services/gateway/src/wobo_gateway/safety.py:127-130`). No
local emergency number is named anywhere. Nothing is sent to any adult: there is no route from a
safety event to a person, and the field that used to claim one has been removed with the reasoning on
the record. `docs/legal/safety-and-content.md` section 3 now states all of this.

**The questions.** Mandatory reporting duties per jurisdiction, and the retention duties that follow
a report. The lawful basis for contacting a parent or an emergency service, and the guidance where
the parent may be the source of the harm. Whether a product that talks to children about anything
may ship at all without a per-country helpline list. **This one needs a child-safeguarding
specialist as well as a lawyer**, and it is the cheapest item on the list to actually fix.

## 3. BLOCKING in the markets it covers. Security representations to families

**Cost of being wrong:** security misrepresentation is the standard enforcement hook, under FTC Act
section 5 in the United States and under GDPR Article 32 read with Article 5(1)(a) in Europe, and the
data is children's. This repository has already been caught claiming a SOC 2, an ISO 27001 and a
penetration test it never had.

**What changed today.** `docs/legal/privacy-policy.md` section 10 no longer claims access logging,
least privilege for staff, key rotation or provider review. It now lists the controls that were
checked against the code, and names the ones that are absent, including that our own server holds a
key that can read any learner's rows and nothing records when it is used.

**The questions.** Whether the corrected section is defensible as written. Whether the absence of
access logging has to be disclosed as prominently as it now is, or more. And a sign-off on the public
security page at `apps/web-pwa/src/screens/pitch/Security.tsx`, which is a separate surface owned by a
separate piece of work and still carries claims about data residency and provider knowledge.

## 4. BLOCKING for the EU and the UK. Data subject rights that have no route

**Cost of being wrong:** Articles 15, 17 and 20 are the rights a regulator tests first because they
are the ones a complainant can demonstrate in a screenshot. Under the DPDP Act they are sections 11
and 12.

**The facts.** There is no export: no route, no button, no file. There is no account deletion: no code
in the repository deletes an account, so "erase and start over" leaves the account, its email address
and its password standing. The erase that does exist reaches 6 of the 22 durable stores that hold
personal data; the full list is `docs/conformance/privacy-and-children.md` sections I and J.
`privacy-policy.md` section 8, `childrens-privacy.md` section 6 and `parental-consent.md` section 5
now say all of this and route the rest to the support mailbox.

**The questions.** How long an email-only route for access, portability and deletion is defensible for
a service used by children. By when the export and the account deletion have to exist. And whether
handling a deletion request by hand, with no ticketing system behind the 30-day commitment, is a
commitment we can publish at all.

## 5. BLOCKING before any provider claim is repeated. No-training and zero-retention terms

**Cost of being wrong:** `childrens-privacy.md` section 5 tells parents that our contracts with
third-party AI and infrastructure providers forbid training on their child's data. If that term is not
actually in each contract, and the zero-retention setting is not actually enabled in each account,
that sentence is a misrepresentation to parents about children's data, which is item 3's enforcement
hook pointed at the most emotive fact in the product.

**The facts.** No DPA, no standard contractual clauses, no transfer risk assessment and no
no-training term is stored anywhere in this repository. Prompts carrying the learner's name, age,
class, board and up to twelve remembered personal facts go to three United States model providers on
every turn.

**The questions.** Produce and file each signed DPA and each Article 46 transfer mechanism. Confirm
the no-training and zero-retention term in each. Confirm the transfer risk assessments, which are
claimed at `privacy-policy.md` section 6 and do not exist. Until then, the claim should not be
repeated anywhere new.

## 6. Age assurance, and whether to hold a date of birth

**Cost of being wrong:** it decides whether the age gate is a property of the account or a screen a
child clicks past once, and every consent obligation above sits on top of it.

**The questions.** Whether self-declaration plus a parental confirmation is a sufficient
age-assurance method in each market, particularly under the UK code and the Indian rules. Whether the
Article 8 age should be a per-member-state table or one global number set at the strictest. Whether
we may hold a child's date of birth at all, or should derive and store a band and a country instead.
Decision 3 in `docs/CONSENT-PLAN.md` frames it; the answer is counsel's plus the owner's.

## 7. Retention periods, none of which is decided

**Cost of being wrong:** storage limitation, GDPR Article 5(1)(e), and the practical fact that a
product with no retention job holds everything forever, including every answer every child has ever
given.

**The facts.** There is no retention job anywhere in the product. Every period in
`privacy-policy.md` section 7 is a square-bracketed placeholder. Two of the rows have been corrected
today because they described deletions of things that are never stored in the first place: voice is
relayed and never written, and a photographed page is read and never written. The backup window
cannot be published because the hosting project's setting has never been read.

**The questions.** A real number for each row, per jurisdiction where it differs, and confirmation
that a conversation history with no rolling limit is defensible for a child.

## 8. Who the controller is, and who has to be appointed

**Cost of being wrong:** an unappointed Article 27 representative is a standing infringement in the
EU and the UK, and an unregistered Consent Manager may be a precondition to operating in India at all.

**The questions.** Confirm the entity, its registration, and whether a separate entity is needed for
India or the EU. Whether a DPO is mandatory given large-scale processing of children's data. Whether
Article 27 representatives are required in the EU and the UK, and appoint them if so, because
`privacy-policy.md` currently carries both as literal placeholders. Whether an Indian grievance
officer must be a named individual and whether a Consent Manager registration is required.

## 9. Money: renewals, mandates, cooling off, and a cancel-only policy

**Cost of being wrong:** automatic-renewal law is enforced actively and cheaply against consumer
subscriptions in the United States, and the RBI e-mandate rules are a hard operational gate in India.

**The questions.** The whole of section D of the checklist in `docs/legal/README.md`, which is
already written and does not need restating here. The one to answer first is the owner's ruling that
there are no refunds and a subscriber cancels instead: confirm that a cancel-only policy is lawful in
every market, and in particular that nothing in it can be read as contracting out of the EU, EEA and
UK withdrawal right, which cannot be removed by a term.

## 10. Naming recipients, or naming categories

**Cost of being wrong:** it is the point where the product's white-label rule meets Article 13(1)(e),
the DPDP notice requirements and the CCPA notice at collection, and it is the item most likely to
force a visible change to a live page.

**The questions.** Whether category-level disclosure plus a named list on request is sufficient,
especially for children's data. Note that the named list itself does not exist yet and is six rows of
work. Note also that a public code delivery network receives a child's device address when a
computer-science exercise runs, which was in no legal document until today and is now disclosed in
`privacy-policy.md` section 5 and `cookies.md` section 2.

## 11. The three documents that have to exist before a regulator asks

**Cost of being wrong:** accountability, GDPR Article 5(2), is the article that converts every other
gap into an enforceable one, because it is the duty to be able to demonstrate compliance.

**The questions.** Commission the Data Protection Impact Assessment, which Article 35(3)(b) almost
certainly requires for large-scale processing of children's data and which the folder already assumes
is required. Write the record of processing activities; section I of
`docs/conformance/privacy-and-children.md` is most of it already, table by table. Write the legitimate
interests assessment, which `privacy-policy.md` section 3 currently claims has been recorded and which
does not exist.

## 12. The contract itself

**Cost of being wrong:** moderate and slow. A term that is unenforceable against a consumer is
usually severed rather than fatal, but arbitration and class-action waivers against minors are the
exception and can be expensive.

**The questions.** Section E of the checklist in `docs/legal/README.md`: governing law and forum, the
liability cap against consumers, whether arbitration is workable when the counterparty is often a
minor, the notice period for changes, and the intellectual-property position on extracting curriculum
structure from official syllabus documents.

## 13. Intermediary and platform duties

**Cost of being wrong:** low today and rising the day the shared library opens, at which point it
becomes item 4 of a different list.

**The questions.** Whether the Digital Services Act applies at all, given that nothing is published
and there is no user-to-user contact. DMCA agent registration and the Indian intermediary rules and
their takedown timelines. Both are currently theoretical, because there is no control in the product
that sends a learner's syllabus anywhere.

## 14. Accessibility

**Cost of being wrong:** European Accessibility Act deadlines are real and dated, and an accessibility
statement is one of the few documents where the format itself can be prescribed.

**The questions.** Which regimes bind us given where we sell, and the EAA deadlines. The required
statement format, feedback mechanism and enforcement route to name.
`docs/legal/accessibility-statement.md` section 2 has been moved into the future tense today, because
none of its claims had been measured and three of them were known to be false.

## 15. Cookies and ePrivacy

**Cost of being wrong:** low, and it just got lower. The product stores nothing that is not strictly
necessary, has no analytics, no crash reporting and no experiments, and the notice no longer describes
a banner it does not have.

**The questions.** Whether the preferences store qualifies for the interface-customisation exemption,
because if it does not, there has to be a banner after all. Whether a site with nothing to opt out of
still has to read and respond to Global Privacy Control.

## 16. Schools, and the day one signs

**Cost of being wrong:** nothing today, a great deal the day a school signs, because FERPA and the US
state student-privacy laws arrive with the first contract and are not retrofittable.

**The questions.** Hold this one until a school is actually in prospect, then do it before the
contract rather than after: FERPA, New York Education Law 2-d, California's SOPIPA, the position of a
school as controller in the UK and the EU, and the Indian position on school-obtained consent.

---

## What the owner should do with this

Items 1 to 5 are the ones worth paying a specialist for this month, and items 1 and 2 are the two that
should not wait for a specialist to be free. Items 6 to 11 are a second engagement. Items 12 to 16 can
wait for the first, except that item 14 has a deadline attached that nobody has looked up.

The thing that makes all sixteen cheaper is the same thing: every one of them is a question about a
gap between a sentence and the code, and the gaps are now written down in the sentences themselves
rather than discovered by whoever asks first.
