# Children's privacy

Draft of 3 September 2026. Version 0.1. Written by the Wobo team, not yet reviewed by a lawyer. See `README.md` in this folder for the review checklist. Read together with `privacy-policy.md` and `parental-consent.md`.

> **In plain words, for a parent or guardian**
>
> Most of the people Wobo teaches are children, so we built the product around that from the start rather than adding warnings later.
>
> **There is no consent gate in Wobo today.** That is the design, and it is not what ships. Memory, voice, photographs of a page, and the parent link are all available to any signed-in learner of any age, right now, without anybody asking you first. Section 3 says exactly what that means and what we are doing about it. We would rather you read that here than find it out for yourself.
>
> We never advertise to children, never sell their data, never build advertising profiles, and never use their learning to train systems for anyone else.
>
> You can see what Wobo remembers about your child and correct or delete it, at any time, without giving a reason. There is no download button and no delete-the-account button yet, and the erase that exists does not reach everything: section 6 lists what it reaches and what you have to ask us for by hand.
>
> **In plain words, for the learner**
>
> Wobo remembers what you have learned so it can teach you better. You can look at everything I remember about you, and delete any of it, on the memory page. If you would rather I forgot something, tell me and I will.

---

## 1. Who this covers

Anyone under 18.

**The age at which a learner can hold their own account is set in one place**, `terms-of-service.md` section 4, and this document follows it: from 13 a learner holds their own account; below 13 a parent or guardian holds the account with them and gives verifiable consent first; where local law sets a higher age than 13, that age applies. That is the rule. Section 3 says how much of it the product actually enforces today, which is none of the consent half. Where this document and the terms appear to differ, the terms govern.

What follows from age:

| Age | What applies |
|---|---|
| Under 13, in the United States | COPPA. The account is held by a parent or guardian, and verifiable parental consent comes before we collect anything beyond what is needed to ask for that consent. [REVIEW: confirm that a parent-held account for an under-13 satisfies COPPA, and what the operator must do when a child signs up alone and declares an age under 13.] |
| Under 16, or under 13, in the EU depending on the member state | GDPR Article 8. The age of digital consent varies from 13 to 16. Below it, a parent consents and holds the account. [REVIEW: the age in each member state we sell in, and whether Article 8 consent may be given for a service offered on the parent's own account.] |
| Under 13, in the UK | UK GDPR and the Age Appropriate Design Code. Below 13, a parent consents and holds the account. The code applies to every user under 18. [REVIEW: the code's fifteen standards against the shipped product, in particular default settings, profiling, nudge techniques and the detriment test.] |
| Under 18, in India | The DPDP Act 2023. Verifiable parental consent for every learner under 18, no behavioural monitoring, tracking, or targeted advertising. [REVIEW: whether the tutoring profile counts as behavioural monitoring under section 9(3), and the verification standard the rules require.] |
| Under 18, in California | The eraser-button law and the CPRA rules on minors. [REVIEW: Business and Professions Code 22581 on removal of content posted by a minor, and the CPRA opt-in for sale or sharing by anyone under 16, which we do not do.] |

Where two rules apply, we follow the stricter one.

## 2. How we find out someone's age

We ask, in a neutral way, during sign-up: a date of birth field with no hint about which answer unlocks more. We do not encourage anyone to lie, and we do not let a person retry the question until they get a better outcome.

Where the answer places the learner under 13, the sign-up screen asks for a parent's email address and sends them a link. Nothing is verified, nothing is recorded, and no feature waits for the parent to do anything: the account works fully either way. That is not the parental consent flow described in `parental-consent.md`, and section 3 says so plainly.

If we later learn that a child gave us a false age, or that a learner under 13 is holding their own account rather than one held by a parent or guardian, we suspend the extra features, contact the parent where we have a way to, move the account to the parent-held form or delete it, and delete the data we should not have collected. Anyone can tell us about such an account at support@heywobo.com.

We do not use facial age estimation or any biometric age check. [REVIEW: whether any market requires a stronger age-assurance method than self-declaration plus parental verification, particularly the UK code and Indian rules.]

## 3. Consent, and the gap between this document and the product

**What ships today, stated plainly.** There is no consent mechanism in Wobo. No screen asks a parent for permission, nothing records that permission was given, and no feature waits for it. The product carries a consent field on every account, it is read on every capability call, and **nothing in the product ever writes it**, so every learner sits permanently on the lowest tier and the two features that read it are a learner-type classifier and an internal evaluation step. Memory, voice, photographs of a page and the parent link check nothing at all.

**So, concretely, for a child of any age, with no parent involved:** Wobo keeps a long-term memory across sessions and builds a learning profile; voice works; a photograph of a syllabus or homework page can be sent and is read by a third-party model; and the learner can invite a parent by email. None of that waits for you.

**What this document used to say, and no longer does.** That there is a consent step, and that until it is taken Wobo teaches and nothing more, with no memory across sessions, no voice, no photographs and no sharing. That is the design and it is what we intend to build. It was written here in the present tense, and publishing the stricter version while shipping the looser one is worse than either, so it is corrected rather than softened.

**What we intend, and the order.** A parental notice screen with the wording already written in `parental-consent.md` section 3; a consent record naming who consented, to what, when and how it was verified; and four gates, on memory, voice, photograph intake and the parent link, on the tier the product already enforces everywhere else. `docs/CONSENT-PLAN.md` is the plan, including which market requires what and what the owner still has to decide. Until it ships, this section is the notice.

**What is true today either way.** Teaching is never gated and never will be. There is no advertising anywhere in the product. Nothing is sold. No learner can message another learner. A learner can see what Wobo remembers and delete it line by line, at any age, without asking anyone.

[REVIEW: this section describes a product that does not meet the consent requirements of DPDP section 9, GDPR Article 8 or COPPA 312.5. Counsel needs to answer, before this document is relied on in any market: whether the product may be offered at all in India, the EU, the UK or the United States in this state; what the exposure is for the period it has already been offered; and whether the honest disclosure in this section changes that answer.]

## 4. What we collect from a child

Only what the tutoring needs. Named in full in `privacy-policy.md` section 2, and in summary: account details, age band, what they study, what they say to Wobo, their working and their board ink, progress and mastery, preferences, device and log data, and photographs of syllabus or homework pages where the learner sends one. Read this list with section 3: today it is collected from every learner, at every age, with no consent step in front of it.

We do not collect from children: precise location, contacts, advertising identifiers, social media accounts, or anything that would let a stranger find them offline.

## 5. What we never do with a child's data

- We do not sell it, and we do not share it for advertising.
- We do not show advertising in Wobo, to anyone.
- We do not build behavioural profiles for advertising, and we do not track children across other sites or apps.
- We do not use a child's conversations or working to train general-purpose AI models for our providers or for anyone else. Our contracts with third-party AI and infrastructure providers forbid it. [REVIEW: verify each provider contract carries a no-training and no-retention term before launch, and that the zero-retention setting is actually enabled.]
- We do not use pressure, false urgency, streak guilt, or any other dark pattern to get a child to spend money or hand over more data. Purchases sit behind the parent.
- We do not let learners message each other. There is no chat between users in Wobo.
- We do not publish anything a child makes without an adult's decision to share it.

## 6. What a parent can do

**There is no parent-facing surface in the product.** A parent has no account, no login and no controls screen. The only thing a parent receives is the weekly note, and the only controls on it are accept, decline and stop. Everything else on this list is done by writing to support@heywobo.com, and we do it by hand.

At any time, without giving a reason, a parent or guardian can ask us to:

- **see** everything we hold about their child, including the memory Wobo has built;
- **correct** it;
- **give them a copy** of it. We assemble this by hand. There is no export button and no downloadable file, for a parent or for a learner;
- **delete** it. What the in-product erase reaches: what Wobo remembers, the conversation, the profile row, the mastery and progress record, the mail choices and the parent link. What it does not reach: every answer the child gave to a practice question, their ink on the board, their session records, a syllabus they uploaded, and the account itself with its email address and password. Ask us and we remove those too;
- **refuse further collection** while letting the child carry on learning;
- **turn off** the weekly summary. There is nothing else switchable from a parent's side today.

**Withdrawing consent** is not on this list, because no consent was ever taken. See section 3.

Requests go to support@heywobo.com. We do not make a parent create an account of their own to exercise these rights, and we do not charge for them.

## 7. Safety

`safety-and-content.md` sets out what Wobo refuses to discuss, and what Wobo does when a learner seems to be in distress. In short: Wobo stops teaching, says plainly that I am not a counsellor, offers ways to reach a person who can help, and, where there is a sign of immediate danger to a child and we have a way to reach a parent or guardian, we may contact them. We do not have humans watching conversations as they happen, and we will not pretend otherwise.

## 8. Schools

If a school gives Wobo to a class, the school decides the purpose and we act on its instructions. School consent is not a substitute for parental consent where the law requires the parent, and we will say so. A separate agreement applies. [REVIEW: FERPA, state student-privacy laws such as New York Education Law 2-d and California's SOPIPA, the UK's guidance for schools as controllers, and the Indian position on school-obtained consent.]

## 9. Complaints

Write to support@heywobo.com or to our data protection officer at support@heywobo.com. If you are not happy with our answer, you can complain to your data protection authority: the Data Protection Board of India, your national supervisory authority in the EU, the Information Commissioner's Office in the UK, the Federal Trade Commission or your state attorney general in the United States. [REVIEW: confirm each route and add the addresses.]
