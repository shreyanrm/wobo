# The door is closed, and what stands in its place

**The owner, 2026-09-09:** *"Block any account creations for now until further notice, because we have
SEO, AEO and GEO but no product yet, that's why."*

Right, and for the right reason: 438 public pages are about to start earning visitors, and a person who
arrives from a search, signs up, and meets a tutor that is not ready has been lost permanently. A first
impression is spent once.

But a closed door that says nothing wastes every visitor those pages earn. So the door does not close.
**It changes what it opens onto.**

## 1. What is closed

**New accounts.** No sign-up, no anonymous account, no account created by any path: not the sign-up
door, not a deep link, not the checkout, not a parent invitation, not a gift. One switch turns it off
and one turns it back on.

**Payments stay off**, which they already are, since no keys exist.

## 2. What stays open, and why each one matters

- **Every public page.** The 438 pre-rendered pages, the syllabus, the chapters, the glossary, the
  blog, the help centre. They are the reason for all of this and they need no account.
- **The public ask box on every chapter page.** It is grounded in the help centre and the syllabus,
  screened both ways, rate limited by address, and it needs no account. It is the honest taste of the
  product, and it is what makes a chapter page worth landing on rather than reading.
- **Existing accounts.** Everyone who already has one signs in and uses it exactly as before. Closing
  the door is not locking anyone out.
- **The console**, obviously.

## 3. What the door opens onto instead: the list

Where "Start free" stands today, a person is asked for one thing: **an email address, and optionally
their class and board.** In return they are told plainly that Wobo is not open yet, and that they will
hear the day it is. Nothing else is asked, nothing is promised beyond that, and no waiting number, no
queue position, and no invented scarcity is ever shown.

- Two fields at most, and the second is optional.
- It says what it is: not open yet, you will hear from us, and here is what it will be.
- The class and board, when given, are worth having: they tell us which boards to read first, which is
  exactly the queue in docs/BOARD-COLD-START.md.
- Under 13, the parent's email, and no child's address is taken at all.
- One mail when it opens, and nothing else, ever. The unsubscribe works from the first message.
- The address is stored in its own table with its source (which page they came from), and it is
  deletable on request like everything else.

This is strictly better than an account they would be disappointed by, and it turns every visitor the
search work earns into a person we can tell when it is ready.

## 4. How it is switched

**A dial, not a deploy.** `ops.settings` holds `doors_open` (default false from now) and the gateway
refuses account creation while it is false, with an audit row for the change and for any refused
attempt. The web app reads it, so the copy and the door follow the switch within a minute and without
a release. The console shows the switch, who last changed it, and the size of the list.

Refusing at the gateway is what actually closes the door; the web copy is only what a person sees. Both
are tested, and a test proves an account cannot be created by any path while the dial is off, including
the anonymous path the public ask box would otherwise use.

## 5. The copy that changes

Nineteen places say "Start free". They become the invitation to the list, in the register, without
apology and without hype: no "coming soon" in a large font, no countdown, no waiting-list theatre. It
says what is true. The plans page keeps its prices and says the same thing about when.

Nothing on the public pages implies the product is open. Nothing implies it is closed forever either.

## 6. When it reopens

The dial goes back on when the owner has walked the web version and is satisfied (docs/PLATFORMS.md),
which is the same gate as the store apps. On that day everyone on the list gets one mail, and it is the
launch.
