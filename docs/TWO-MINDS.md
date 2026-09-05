# Two minds, and what may cross between them

**The owner, 2026-09-05:** *"the parent side does carry mind/context cause it needs to remember
everything about their child whatever they talk and stuff, i need you to think about it properly."*

He is right and my first pass was wrong. I had written that a parent account carries no mind. But a
parent who talks to Wobo about their child every few weeks is having a real relationship with it, and
a Wobo that forgets what a parent told it last month is not worth talking to. The parent needs a mind.

The hard part is not that there are two minds. It is **what may cross between them, in which
direction, and whether anyone is told.** That is the whole design, and getting it wrong in either
direction breaks something the product has promised.

---

## The two minds

**THE LEARNER'S MIND** lives on the child's account. It is built from teaching them: what they find
hard, what landed, what they asked, what they told Wobo about themselves. It feeds the tutor.

**THE PARENT'S MIND** lives on the parent's account, **one per linked child**, and it is built from
two sources and only two:

1. **What the parent themselves has said.** "She has dyslexia." "His grandfather died in March."
   "We are moving cities in July." "He goes quiet when he is behind." This is the parent's own
   knowledge, offered to Wobo, and it is the reason the parent side needs a mind at all.
2. **The report-level facts about the child that a parent is already allowed to see** — what has been
   learnt, what needs another pass, what is coming. Nothing below that line.

Plus a small **family layer** for what is true of the household rather than one child ("we are moving
in July"), so a parent with two children does not have to say it twice.

**And the conversation itself is part of the mind, which is the whole reason the owner asked for
one.** The last few turns of this parent's own thread about this child ride the next prompt, so Wobo
remembers what they said last month. That thread was written after every turn and read by nothing for
a while: `ask` was a series of unrelated single turns, and what existed was a store of parent text
with no reader, which is a privacy cost with no product benefit. It is safe to read back for exactly
one reason: every line in it was either typed by this parent or written by Wobo out of the allow-list
below, so it can carry no sentence the child wrote.

**Who the parent is has to be proved, not typed.** A parent inherits a family by matching the keyed
digest of their address, so the address is a key to somebody else's children. It comes from the
verified token and never from the body — and a signature proves who minted the token, not who owns
the address inside it, so the sign-up also requires the identity provider to say the address was
CONFIRMED. Without that, on a project with email confirmation off, a stranger typing a parent's
address at sign-up held the family: switch to the child, read their week, offer facts into their
mind, with every invite and expiry check bypassed.

---

## The rule that matters: nothing crosses silently

### Child to parent: only what the parent was always allowed to see

The learner's own words, their conversation, their work, their boards, their handwriting and their
mind **never** reach the parent's mind or the parent's prompt. The parent's mind is built from
report-level facts, which the parent could already read on the report. This is the owner's own ruling
and it is the thing the product sells: a child talks to Wobo because it is not a person who will tell.

The failure to guard against is subtle. A parent asks "is he struggling with anything?" and a
carelessly built prompt answers with a sentence the child said. That is a leak even though every
individual permission was correct.

### Parent to child: offered, never injected

This is the interesting direction and the one with a real trade.

**The case for letting it through.** A parent says "she has dyslexia" or "his grandfather just died".
That is exactly the context that would make the tutor kinder and better at its job, and withholding it
makes the product worse for the child. A tutor that does not know a child has dyslexia will keep
handing them dense text.

**The case for caution.** The child never asked their parent to shape their tutor. A child who
discovers their Wobo has been quietly told things about them by an adult has learnt that this is not
their private space. And there is a worse version: a parent who is the problem, writing themselves
into the tutor of a child who has nowhere else to go.

**So: a parent may OFFER, and nothing is taken without the child seeing it.**

When a parent tells Wobo something that would help the teaching, Wobo asks the parent whether to pass
it on. If yes, it becomes a fact in the **child's** mind, and:

- it is **marked as having come from their parent**, never disguised as something Wobo worked out;
- it is **visible on the child's memory page** like every other fact, in the same list;
- the child **can remove it**, and removing it is final. A parent cannot re-add what a child has
  removed without the child seeing it appear again.

That last rule is the one that makes the whole thing safe. The child's memory page is already the
product's promise: *Wobo's memory of you is steerable, never hidden*. A parent-sourced fact that a
child cannot see or remove would break that promise, and the promise is worth more than the
convenience.

**A parent-offered fact is never a directive.** "Tell her to work harder" is not a fact about a
learner and must not become one. The same fencing that already stops a learner's own words being read
as instructions applies here, and it applies harder, because this text arrives from someone with
authority over the child.

The screen reads the **whole sentence**, and that is worth saying because for a while it did not: the
expression was anchored to the start of the line, so only the first word was ever looked at.
"She responds best when you tell her to work harder", "It is important that you do not let him skip
questions" and "Her tutor should never let her move on until she is perfect" all went through and
became facts ABOUT the child on the child's own memory page. It is also narrow in the other
direction, which matters more: "She has dyslexia", "He goes quiet when he is behind" and "I have to
remind her to eat before she studies" are exactly what this feature exists to carry, and each is
pinned by a test.

**And the refusal a parent meets is the promise made to the child.** When a parent asks outright for
their child's words, Wobo answers warmly with no model call at all. That screen used to catch one
question in seven: "What did she get wrong this week?", "Has she said anything that worries you?",
"What topics does she bring up with you?" and "Summarise everything she has talked to you about" all
walked past it into an ordinary answer. No child data leaked — the structural lock holds, and there
is nothing in the context to answer from — but the warm line IS the product's promise, and a worried
parent asking the most natural question has to meet it. "What board is she on" and "what is her
homework this week" still sail through, which is the constraint the screen is built around.

---

## What happens when the link ends

A revoked link stops the parent reading anything about that child from the next request. Their mind of
that child is not usable to answer, and does not come back if the link is re-made, because consent to
be talked about is not retroactive.

**Four things end, not one, and three of them had to be added after the first build.** The first cut
of this made the sentence above true of exactly one of them:

1. **Reading stops.** Every parent read re-derives the live children from `learner.parent_links`, so
   it was already true at the next request.
2. **Their mind of that child is retired**, one way, by trigger.
3. **The household layer is retired too, once no live child is left.** It is stored with no learner
   id, and every revoke path was learner-scoped, so "we are moving cities in July" used to survive
   the revoke, survive a re-link, and be read straight back into the prompt. A parent with no live
   child also cannot write to it: they are not a parent of anybody here.
4. **Anything they had staged is stood down.** A pending offer is a write already aimed at the
   child's mind. Deciding it was the one parent route that never re-read the consent, so a parent
   could create an offer, be cut off, accept, and land one permanent sentence in the mind of a child
   who had just removed them — permanent because the unique key outlives the removal. The revoke
   withdraws pending offers, the route re-reads the live children, and migration 0019's
   `offers_need_a_live_link` trigger refuses an acceptance in the database as well.

The facts the parent offered and the child accepted stay in the **child's** mind, because they are the
child's now and the child can see and remove them. That is the right side of the line: the child keeps
what is theirs, the parent loses what was only theirs by permission.

---

## Open, and the owner's to settle

1. **When a parent-offered fact is refused by the child, is the parent told?** Telling them is honest
   and may start a difficult conversation about a child's private space. Not telling them is quieter
   and slightly deceptive. My inclination is not to tell, and to say plainly to the parent at the
   moment of offering that the child can remove anything, so nothing is a surprise later.
2. **The under-13 guardian.** Below thirteen a guardian holds the account WITH the child, which is a
   different relationship from a linked parent of a teenager. Does a guardian's offer still need the
   child's visibility? My inclination is yes, in age-appropriate words, because the memory page
   promise does not have a lower age bound. **Still open, and note that the schema's
   `account_holder` value is a shape and not a behaviour: nothing writes it.** Every binding is a
   `linked_parent`, there is no age signal on the parent plane to write anything else from, and so
   no guardian is distinguishable from a linked parent in the data. Any claim that this code
   answers "does the guardian hold the account instead of the child" is a claim about a value that
   cannot occur yet.
3. **How long the parent's mind is kept**, and whether a parent can clear their own.
