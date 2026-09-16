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

## Accepting a seat proves the address twice (2026-09-15)

A seat is invited by address and bound to an account when a person signs in with that address. The
sign-in token counts as proof only when it says, in so many words, that the address was verified: a
token that says nothing about it is not a yes (the gateway fails closed; `_claim_email` in
admin_auth.py, with the test that a right address without the claim is refused). That is the first
proof, and it is already in code.

The second, still to build under the console wave: the invitation itself carries a signed, single-use,
expiring link sent to the invited address, and a seat binds only when the person arrives THROUGH that
link with a token whose verified address matches. A token alone, however verified, never binds a seat.
Reason: the address claim is only as strong as the identity provider's confirmation step, and an
administrator's seat should not rest on one provider setting. The invited row already carries
`mfa_required`; the link is the out-of-band half.

**Built (2026-09-17).** The link: `wobo_gateway/admin_invite.py` (signed with `ADMIN_INVITE_SECRET`,
72 hours by default, bound to a keyed digest of the address, never the address). The register row
keeps only the link's SHA-256 and its deadline (migration 0037, in the repository, not applied), and
the write that binds the seat names that digest and clears it, so the link works once. A verified
token with no link, a link with an unverified or different address, a spent link, an expired link
and another seat's link all bind nothing (`tests/test_console_invitation.py`). Nothing sends the
mail: the owner's Register desk shows the link and the message once, with copy buttons, and a person
sends it. The route no longer accepts an account id, so every seat is taken through its link. Setup
and the fresh-link step are in docs/OPERATIONS.md section 13.6.

**What the console shows (2026-09-17).** The rail, the controls and the reads follow the seat's
effective set from `GET /v1/admin/panels` (`apps/web-pwa/src/admin/seats.ts`, checked against
`console_panels.py` by `seats.test.ts`). A desk the seat cannot read is not drawn and is never
asked for. The Register desk shows each person's effective set with where each part came from, and
the owner grants, revokes, puts back, re-links and suspends from it, one audited row per change.

## What the closer found and settled (2026-09-17)

**A panel's figures do not ride on another desk.** Revoking the money panel closed the money
routes, but the health, syllabus, stores and models desks still carried spend, ceilings, prices
and savings. Every admin answer now passes through `console_panels.without_money`, installed on
the route class that `admin_router` gives every desk, so a seat without `panel.money.read` gets
no key that names money on any desk, and a desk added later is cut the same way. The models and
syllabus desks draw without those columns rather than breaking
(`tests/test_console_money_hidden.py`, `src/admin/moneyHidden.test.ts`).

**The owner's grant is the whole answer.** A route's coarse permission is also met when the seat
holds the exact panel capability the guard asked of that path, so a viewer given
`panel.boards.act` can grant a board change and nothing else. `admin.manage` (the register, the
dials, the router) is never widened by a panel grant. The Grant button is drawn only for a seat
that holds the board desk's act.

**Where a learner came from, when the gateway has no trail.** The app's word is taken only when it
names a move. A missing board, or the board they are moving to, is decided by the learner's
syllabus pins: a pin on another board means this is their change and it is counted. Pins that
cannot be read refuse. An unlisted board picked on the You screen asks for the board to be found
and moves nothing; the move happens when they pick the found board, through the rule.

**The dials are written whole, then recorded.** One upsert for every dial, and the audit row,
with the values before and after, is written only once the write has taken.

**Still the owner's to rule on:**

1. **The parent path (§1, "under 13, the parent does it").** Not built, and it cannot be without
   two rulings: the server has no age signal (`under_13` is unknown almost everywhere), and the
   parent plane holds exactly four actions with `boards` on its forbidden list
   (`parent_account.py`). Until then nothing writes a parent's change, the "a parent's change
   counts" dial governs nothing, and the console says so under the dial
   (`board_change.PARENT_CHANGES_POSSIBLE`).
2. **"Their progress stays but re-maps to the new syllabus" (§1).** The product does not re-map:
   completion is filed under each board's own topic ids. What it does is keep the old board's
   topics by name and mark where they came from, and the three lines a learner confirms say
   exactly that. The sentence above is the owner's and is left as spoken; the owner decides
   whether re-mapping is still wanted or the sentence should change.
3. **The kept record lives on the device**, like the rest of a learner's progress (stars,
   completion, practice marks). A second device does not show it. Carrying it across devices is
   the same question as carrying progress across devices, under docs/MEMORY-LAW.md.
