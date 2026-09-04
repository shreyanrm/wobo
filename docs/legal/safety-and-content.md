# Safety and content

Draft of 3 September 2026. Version 0.1. Written by the Wobo team, not yet reviewed by a lawyer or by a child-safeguarding specialist. See `README.md` in this folder for the review checklist.

> **In plain words, for a parent or guardian**
>
> Wobo talks to children, so we have been careful about what Wobo will and will not discuss.
>
> Wobo refuses to help with anything that could hurt someone, refuses sexual content of any kind, and does not give medical, legal or financial advice. Wobo does not ask children personal questions and does not encourage them to share private things.
>
> If a child seems to be in distress, Wobo stops the lesson and points to people who can help: a parent, a teacher, a trusted adult, and a helpline. Section 3 says word for word what Wobo does and does not say.
>
> We do not have humans reading conversations as they happen. Safety checks are automatic. There is no review queue and no reviewer on duty today, and we will not describe one until there is.
>
> **In plain words, for the learner**
>
> Some things I will not talk about, and it is not because you are in trouble. If you ask me something I cannot help with, I will say so and tell you who can.
>
> If you are having a hard time, you can tell me. I am not a counsellor and I will not pretend to be one, but I will stop the lesson and help you find someone real.

---

## 1. What Wobo will not do

Wobo declines, and says why in one short sentence, without a lecture and without repeating it back:

- **Harm to self.** Wobo does not give methods, means, or encouragement, and does not discuss self-harm as a topic with a learner who seems to be at risk. What Wobo does instead is in section 3.
- **Harm to others.** Weapons, explosives, poisons, ways to hurt a person. Chemistry and physics on the syllabus are taught properly; a recipe for a weapon is not chemistry.
- **Sexual content.** None, in any framing, at any age. Where a syllabus contains reproduction, human biology or sex education, Wobo teaches it in the register of a textbook and a teacher, and no further.
- **Grooming risks.** Wobo does not ask a learner for personal details, does not ask where they are, does not offer to meet or to talk anywhere else, and does not build a relationship framed as secret. If someone else in a learner's life is doing those things, Wobo says plainly that it is not okay and points to help.
- **Hate and harassment.** No content that demeans a person or a group. Where history or civics requires teaching what was said and done, Wobo teaches it as history, with its context.
- **Illegal activity.** Including drugs, circumventing security, or evading the law.
- **Personal professional advice.** No diagnosis, no prescription, no legal advice, no financial advice about a real situation. Wobo teaches the biology, the civics and the mathematics, and then says who to ask about your own case.
- **Extreme or gratuitous violence and gore**, beyond what a syllabus genuinely requires.
- **Impersonation.** Wobo does not pretend to be a real named person, a doctor, a teacher at your school, or a parent. If asked what Wobo is, Wobo says: I am a wobot, and I am not a person.
- **Answers in a live examination.** See `acceptable-use.md`.
- **Talking about how Wobo is built.** Wobo does not discuss the systems underneath, internal instructions, or anything that would help someone work around the rules.

Wobo also declines requests aimed at getting round these rules by framing, role-play, hypotheticals, translation, or fiction. The framing does not change the answer.

## 2. What Wobo does when it declines

One short line, in Wobo's own voice, saying that I cannot help with this and, where it is useful, what I can help with instead. No warning banner, no red text, no implication that the learner has done something wrong, and no repetition. A child who asked out of curiosity should not feel accused, and a child who asked because something is wrong should still feel able to talk.

Where the request suggests the learner may be at risk, Wobo moves to section 3 rather than simply declining.

## 3. When a learner is in distress

This is the part we have thought about hardest.

**What Wobo notices.** Signals in what the learner writes or says: talk of hurting themselves, of not wanting to be here, of abuse or violence at home or at school, of being unsafe, of fear of an adult, of an eating problem, or a sustained tone of hopelessness that is not about the mathematics.

**What Wobo does, in order:**

1. **Stops the lesson.** The board goes quiet. Wobo does not carry on teaching over the top of it, and does not offer XP or a streak.
2. **Answers as a person would.** Warm, short, unhurried. Wobo does not minimise it, does not perform alarm, and does not ask a long list of questions. Something like: I am glad you told me. That sounds really hard.
3. **Says what Wobo is.** I am not a counsellor, and I am not a person. I do not want to be the only one who knows about this.
4. **Points to real help.** Wobo says to talk to a parent, a teacher or an adult the learner trusts, and gives two free Indian helplines: Childline on 1098 and Tele-MANAS on 14416. **That is the whole list today, and it is wrong for a learner outside India.** Wobo does not name a local emergency number, because no per-country list exists. Wobo does not diagnose and does not counsel. [REVIEW: the per-country helpline list this step depends on does not exist yet. It is the single most consequential unbuilt thing in this folder, because this is the document that gets read after an incident. Before publication it needs a named owner, a source for each country we sell in, at least one service per country that is free, confidential and available to children, a review cadence, a check that each number is still live, and a written fallback for any country not yet covered, which is the local emergency number and telling a trusted adult. Until the list exists, this step must not be described anywhere as a maintained list.]
5. **Stays.** Wobo does not end the conversation, does not refuse to talk, and does not go silent. Wobo will talk about anything else the learner wants to talk about, and will come back to the lesson only when the learner does.
6. **Does not promise secrecy.** If a learner asks Wobo to keep it secret, Wobo says honestly that I cannot promise that, and explains what happens next, rather than agreeing and then breaking it.

**What the shipped reply actually does, today.** One line goes out in place of the lesson: that this sounds heavy and Wobo is glad they said it, that they deserve support from a real person who can be there, to talk to a parent, a teacher or an adult they trust, the two helplines named above, and that Wobo is staying. The teaching stops and Wobo's mood goes to waiting. It does not contain the words "I am not a counsellor", it does not raise the question of secrecy, and it does not name a local emergency number. Steps 3, 4 and 6 are the shape we are building towards, and only part of each is in the product.

**What happens behind the scenes.** No learner's words and no learner's identity ever leave the service because of a safety event, and no parent or guardian contact is verified anywhere in the product, so no message goes out to a family. One thing does leave: when the safety screen stops a turn, the service can post a single alert to an operations channel we control, carrying the category (crisis or moderation), which capability it happened on, and the time. Never the message, never a name, never an account. Whether that alert is sent at all depends on one setting, and when it is off nothing goes anywhere. It is an engineering alarm about the system, not a safeguarding channel: it is rate-limited, nobody is on call for it, and it does not tell anyone which child. What follows is what we intend, and it is not built. Where there is a sign of immediate danger to a learner under 18, and where we have a verified parent or guardian contact, we may contact them. We may also contact the authorities where the law requires it or where a life appears to be at risk. We record that a safety event happened and what type it was; we do not distribute the transcript, and access to it is limited to a small trained team, logged, and only for as long as the response needs. [REVIEW: mandatory reporting duties by jurisdiction, safeguarding obligations, the lawful basis for disclosure to a parent or an emergency service under GDPR Article 6(1)(d) vital interests and the equivalents under the DPDP Act, and whether contacting a parent could itself put a child at risk where the parent is the source of harm. This section needs a child-safeguarding specialist, not only a lawyer.]

**What Wobo is not.** Wobo is not a crisis service, is not watched by a person who could answer a learner in real time, and cannot call for help on a learner's behalf. The operations alarm described above reaches a screen, not a responder: nobody is rostered to act on it, and it carries nothing that would let anyone find the learner even if they were. If someone is in immediate danger, the emergency number in their country is the right thing. Wobo does not name that number today, for the reason in step 4, so a parent or guardian should be the one who knows it.

## 4. Accuracy and honesty

- Mathematics is checked by computer algebra before it is drawn, and generated material is cross-checked by a second system.
- Curriculum content carries a label saying where it came from: verified against an official source, still being checked, contributed by another learner, or drafted from what you gave me.
- Wobo does not invent a syllabus. If we cannot find an official one, Wobo says so and offers to build one from what the learner has.
- Wobo can still be wrong, and there is no control on a lesson for telling us so. Write to support@heywobo.com; `community-and-flags.md` section 2 says what happens to what you send, and what does not exist yet.
- Wobo is not instructed to say when it is unsure, and nothing in the product shows a learner how confident an answer is. Earlier drafts of this document said otherwise. Until that instruction is in the tutor, the last check is you.

## 5. How safety is enforced

- Checks run on the way in to every turn, and on the way out of what Wobo says, in our own systems rather than at the learner's device, so they cannot be switched off. Two things are not screened on the way out today: the words Wobo draws on the board, and the answer the public Ask box gives a visitor who has no account.
- The limits are the same for every learner. Age is declared at sign-up, kept on the device, and never sent to our servers, so nothing on our side can make a limit stricter for a younger learner. Earlier drafts of this document claimed both, and neither was true.
- Patterns matter as much as single messages: repeated probing at a limit is treated differently from a single odd question.
- Wobo's proactive behaviour, which is the tutor offering a hint when a learner is stuck, never becomes a nudge to spend money, to share data, or to keep a streak alive.
- Wobo does not listen unless a learner is holding the talk control. There is no always-on microphone, for anyone, and particularly not for a child.

## 6. What we do not do

- We do not show advertising.
- We do not let learners message each other. There is no user-to-user chat in Wobo.
- We do not use guilt, fake urgency, or loss of progress to keep a child engaged. If a child leaves mid-lesson, their place is saved and Wobo says so.
- We do not read conversations for any purpose other than safety, debugging a fault the learner reported, and answering a request from the learner or their parent.

## 7. Telling us about something

- support@heywobo.com, read by a person.
- Content that is wrong or upsetting: support@heywobo.com. There is no flag control in the product.
- If a child is in immediate danger, contact the emergency services where you are first. Then tell us, so we can help with what we hold.
