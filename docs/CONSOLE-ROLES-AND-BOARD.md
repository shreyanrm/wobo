# The board a learner may change once, and who may see what in the console

Two rulings from the owner on 2026-09-09.

## 1. The board changes once, then a person handles it

*"If the user wants to change their board in settings, they can, but only for the first time it lets
them reselect. The next time onwards when they want to change again, show them a button to contact
support and we will handle it from there."*

**Why the rule is right, so nobody softens it later.** A syllabus is the spine of everything a learner
has: their climb, their progress, their cached levels, the parent's view. Changing a board throws all
of it away and re-anchors the plan, and a child who switches boards weekly to see what is behind each
one wrecks their own record and costs us a re-render of every level. A genuine change happens when a
family moves city or a school changes affiliation, which is roughly once, so the product allows
exactly that and asks a person to look at anything more.

**The behaviour:**

- On the You screen, under Settings, the board and class picker shows what they are on now.
- **First change: it just works.** They pick, they confirm what it costs them (their climb re-anchors,
  their progress stays but re-maps to the new syllabus, and what does not exist in the new board is
  kept and marked), and it happens. The change is stamped on the account with when and from what.
- **Second change onwards: the picker is not offered.** In its place, one line saying a board change
  needs a person, and one button, "Ask us to change it", which opens the support form with the
  learner's current board, the board they want, and nothing else pre-filled. It is never a dead end and
  never a wall of text.
- **Under 13, the parent does it**, from the parent's account, and the same once-then-support rule
  applies to the parent's action, not to the child's.
- Nothing about this ever mentions money, a limit, or a policy. It says a person will look at it.

**In the console:** every board-change request lands in a queue with the learner's current board, the
board they asked for, when they last changed, and one button to grant it. Granting resets their
allowance of one, writes the audit row, and tells them it is done. The queue is Support work, not
Owner work, so an operator can clear it.

**The dials the console holds** (`ops.settings`, live, audited, no deploy): how many free changes a
learner gets before support is needed (default 1), whether a parent's change counts against the
learner's, and whether the whole rule is off for a cohort.

## 2. One owner, and the owner decides what everyone else sees

*"In the superadmin we one owner account which only I will have access to, and the rest of the new
users that get added by me, I should be able to assign their roles and what all visible to them."*

What exists already: an admin register in a schema the learner cannot read, written only with the
service key, every change audited, three roles (viewer, operator, owner) with fixed permission sets,
sessions with a step-up window for anything that writes. That posture is right and stays.

What changes:

**The owner is exactly one account.** A constraint in the database, not a convention: at most one row
with the owner role and the status active, and the register refuses a second. The owner cannot be
suspended or removed by anyone else, cannot have their role changed by anyone else, and the audit
records every attempt. Recovery, if the owner ever loses access, is a documented break-glass with the
service key, written down in operations and requiring nobody's cooperation but the owner's.

**Roles become the owner's to shape.** Today a role is one of three names with a fixed set of
permissions. It becomes: the three names stay as the starting points, and the owner may grant or
revoke each capability per person, from the console, with an audit row for every change. A person's
capabilities are the union of their role's defaults and the owner's explicit grants, minus their
explicit revocations, and the screen always shows the effective set rather than the theory.

**The capabilities are the console's own panels**, so "what they can see" and "what they can do" are
one list, not two: the learner desk, the support queues, the syllabus and observer desk, the models
desk, the money and allowance desk, the growth desk, the mail desk, the content and judge queues, the
board-change queue, and the admin register itself. Each is read and act separately, because seeing a
learner's day is a different thing from acting on it.

**The console shows only what a person holds.** A panel they cannot read is not greyed out, it is not
there, and its route refuses them with the same message a stranger gets. The navigation, the search
and the deep links all obey the same list, so nothing leaks by way of a URL somebody remembers.

**Adding a person** is the owner's action alone: an email, a role to start from, and the capabilities;
they receive an invitation, set up a second factor before their first sign-in, and appear in the
register with who granted them and when. Suspending is instant and ends their sessions.

**Everything is audited**, and the audit is readable in the console by the owner alone: who changed
what, for whom, when, from where, and what the value was before.
