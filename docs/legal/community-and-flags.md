# Community, flags and shared content

Draft of 3 September 2026. Version 0.1. Written by the Wobo team, not yet reviewed by a lawyer. See `README.md` in this folder for the review checklist.

> **In plain words**
>
> Wobo is not a social network. Learners cannot message each other, and there are no public profiles, comments or feeds.
>
> There are three places where something can leave your own account: you tell us that something Wobo produced is wrong, you save a board as an image and send it yourself, or you offer your own syllabus to the shared library so the next learner from your school gets it.
>
> Each of those is a choice you make, one at a time. Nothing is shared automatically.
>
> Today the first of those is a quiet flag control inside Wobo, or an email to support@heywobo.com, and the third is switched off. This document says which parts of it are built and which are not, rather than describing the finished shape as though it were here.

---

## 1. What this covers

Three things:

1. **Reports.** Telling us that something Wobo produced is wrong, confusing, or upsetting.
2. **Saved boards and progress.** A board Wobo drew for you, or a mastery image, which you can save to your device and send to someone yourself.
3. **Contributed syllabuses.** A syllabus you gave Wobo, which you can offer to the shared curriculum library so the next learner from the same board does not have to.

There is no fourth thing. Wobo has no learner-to-learner messaging, no comments, no forums, no public profiles, and no follower counts. That is a deliberate choice and not a feature we have not got to yet. If it ever changes, it will be a new version of this document with new protections written first.

## 2. Telling us something is wrong

**Where.** A quiet flag control sits on every screen inside Wobo: in the rail on a computer, above the row of doors on a phone, and in the corner of a full board. Pressing one of six lines sends the report; typing anything is optional. It carries the reason, your words if you typed any, and pointers at what was on screen (which lesson, question or board, and the subject), and nothing else from your device. Wobo has no spoken command that raises one. support@heywobo.com is still there and still read by a person, and it is the better route when you want an answer back.

**The one exception.** On an equation practice question there is an "I think I'm right" control on the question itself. It re-checks the answer against the equation and changes the mark where the proof is on the learner's side. That is a regrade, not a report, and it reaches nobody.

**What happens to what you send.** It goes into a queue a person works through, and a report marked upsetting or unsafe goes to the top of that queue and raises an alarm the moment it arrives. We read it, we work out whether the content was wrong, and we fix what was. There is no case number, no ordering by how many people reported the same thing, and no automatic message back when something is settled, because none of that is built. A message you send to the mailbox is answered; a flag raised in the product is read, and it is not a conversation.

**What a report contains.** What you chose to send us, and pointers at what was on screen when you sent it: the kind of thing it was, which one, and the subject. We do not take a picture of your screen, we do not copy your work or your answers into a report, and nothing at all is collected from your device when you write to the mailbox instead.

**Time.** We do not publish a turnaround time, because we have not staffed one and a target nobody is held to is worse than no target. What we will say is that a message about a child being at risk is read before anything else in the mailbox.

**What we intend to build, and have not.** A picture of exactly what you were looking at, drawn by our own renderer rather than captured from your device; ink and blur tools to mark it up; and a message back when a report is settled. None of those three exists today. (The control itself and the queue behind it were on this list until 5 September 2026, and both are now built; this paragraph is the record of that.) A turnaround time goes in here only once somebody is answerable for meeting it.

**Abuse.** Flooding us with false reports takes attention away from real problems, and repeated abuse is dealt with under `acceptable-use.md`.

## 3. Saving and sending a board or a progress page

**Nothing is public, and nothing is ever published.** A board, a note or a progress page lives in your account and on your device.

**What sharing actually is, today.** Wobo renders the board as an image and hands it to you. Nothing is uploaded, nothing is posted, and no link is created. What happens to that image after that is up to you and the app you send it through, and we have no part in it and no way to take it back.

**What does not exist.** There is no share link, so there is nothing to revoke and nothing to expire, and there is no control that strips your name from a link, because there is no link. Earlier drafts of this document described all three. They were describing a design, not the product.

**The parent link** is the one thing that leaves the device on its own: a weekly note about what your child worked on, sent to a parent or guardian who confirmed the invite from their own device. It is a summary and not a transcript, it shows learning and not conversations, and either the learner or the parent can end it. `parental-consent.md` has the detail, and section 3 of `childrens-privacy.md` says honestly what does and does not gate it.

**Please do not** put personal information into something you are about to send, and remember that once an image has reached another person, we cannot take it back from them.

## 4. Contributing a syllabus

If you gave Wobo your own syllabus, Wobo built you a personal curriculum from it. That is yours, and it is private.

The shared library is the intended next step: offering your syllabus to it would mean the next learner studying the same thing gets it straight away. **There is no control in the product that does this today**, and until there is, nothing you give Wobo goes anywhere near another learner. The terms below are what will apply when it opens, and none of them is in force yet:

- **It is your choice, every time, and it is off by default.**
- **We intend to strip what identifies you** before anything is stored in the shared library: your name, your school where it appears in a heading, your teacher's name, your class list, and any contact detail we can find. If we cannot strip it cleanly, we do not publish it. [REVIEW: this de-identification step is not built. `docs/CURRICULUM.md` describes contributed frameworks as moderated and nothing more. Before this sentence is published there must be a named de-identification stage in the contribution job that fails closed when it is uncertain, a test that proves it fails closed, and an owner. Until then this line must not be stated as a description of what happens today, and the shared library must stay switched off.]
- **It is labelled honestly.** The next learner sees "shared by another learner, not yet checked" until it has been through the same verification any other syllabus goes through.
- **You give us permission to use it** for that purpose. You keep ownership. You can withdraw it at any time and we will remove it from the library, though a learner who has already started studying from it keeps their own copy of what they were studying, because taking a curriculum out from under someone mid-term would do more harm than good. [REVIEW: whether this residual use needs to be spelled out as an irrevocable licence for copies already in use, and the copyright position of a syllabus document that belongs to an examination board rather than to the learner.]
- **A learner under 18** would need a parent or guardian to allow it first, and that gate does not exist yet either. It has to exist before the library opens.

**Copyright.** A board's syllabus document usually belongs to the board. We treat it as a factual source: we extract the structure of what is taught, record where it came from, and link to the official document rather than reproducing it. We do not publish scans or copies of anyone's textbook or paper. If you are a rights holder and think we have got that wrong, see section 6. [REVIEW: the copyright position on extracting curriculum structure from official syllabus documents in India, the UK, the EU and the US, including the database right in the EU and the UK, and fair dealing and fair use.]

## 5. Moderation

Anything that reaches the shared library is meant to pass automatic checks first, for personal information, unsafe content and obvious nonsense, with a person reviewing anything the checks flag and anything another learner flags. [REVIEW: neither the automatic check nor the reviewer exists yet, and share links are not scanned at all today. Before publication, either build the check and name the reviewer, or say plainly here that a share link is not scanned and that the learner is the only filter, which is the honest position and the one that will be tested after a child's school and full name reach the shared library. The shared library must stay switched off until the check exists.]

If we remove something you contributed or shared:

- we tell you, and we say why in plain language, not a code;
- you can appeal to support@heywobo.com and a person who was not involved the first time will look again;
- we tell you the outcome and the reason.

[REVIEW: the EU Digital Services Act, in particular the duties on statements of reasons, internal complaint handling, out-of-court dispute settlement and trusted flaggers, and whether Wobo falls inside its scope given that shared content is limited to links a learner sends and a curriculum library.]

## 6. If you are a rights holder

Write to support@heywobo.com with what the material is, where it is in Wobo, what right you hold, and how to reach you. We will look at it promptly and remove anything we should not have. Where the law provides a formal notice route, we follow it, and the person who contributed the material can give a counter-notice. [REVIEW: DMCA agent registration and the safe-harbour requirements in the US, the EU Digital Single Market Directive Article 17 position, and the Indian intermediary rules and their takedown timelines.]

## 7. Reporting

- Content that is wrong: support@heywobo.com.
- Someone at risk, or something that worries you: support@heywobo.com.
- A rights complaint: support@heywobo.com.
- Anything else: support@heywobo.com.
