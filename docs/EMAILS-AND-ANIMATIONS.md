# Mail that makes you come back, and the orb that moves

**The owner, 2026-09-08, with three screenshots of a Brilliant reminder:** *"They keep sending really
cool emails like these on a regular basis and we should too, and those animations, creative loading
screen animations, and a lot more."*

What that mail does, and why it works: one animated character doing ONE thing; four words for a
headline; one line; one button that lands you where you were; the app badges and the legal line
below a hairline. Nothing narrates. We do the same in our register, with our orb, under our laws.

## 1. The family of mails

Every mail is: the wordmark, one orb animation, a headline of two to four words, one line, one
button that deep-links to the exact place, the hairline, the badges, the address, one-click
unsubscribe for that kind. Subject lines are the learner's name and a verb.

| Mail | When | Headline (draft) | The line | The button lands on |
|---|---|---|---|---|
| A quick one | 48 hours without a lesson, at the hour they usually learn | "Five minutes." | "Fractions, part two, is waiting. It takes five." | the exact next card |
| Mid-chapter | left a chapter half done, 24 hours later | "You were here." | "Two cards left in Linear equations." | the card they left |
| The streak | day 3, day 7, day 30 of a streak, the morning after | "Seven days." | "Seven days in a row. Today makes eight." | home |
| A bonus level | a bonus level opened on the climb | "A side door." | "There is a game between Motion and Force. Optional." | the bonus level |
| Your doubt | a photographed doubt's answer is ready (if it was not read live) | "Solved." | "The page you photographed, explained on the page." | the doubt |
| The Sunday note | exists (hospitality) | unchanged | unchanged | unchanged |
| The welcome, the win, the wish | exist (hospitality) | unchanged | unchanged | unchanged |

The laws that bind every one:
- **The inbox law stands:** no address hears from Wobo twice in twenty-four hours, and a nudge is
  never sent on a day the learner came. A learner who came three days running gets no mail that week
  but the Sunday note.
- **Never a late hour** (the hours law): a nudge goes at the hour the learner usually learns, or at
  4 pm local, never after 8 pm.
- **Under 13, the mail goes to the parent**, in the parent's register, about the child.
- **Never narrate** applies to mail: no "we noticed", no "your AI wobot", no "we miss you".
- **Cadence is the learner's**: the mail preferences already carry the dials; each kind is its own
  dial with its own one-click unsubscribe (the `List-Unsubscribe` path exists).
- **Every send lands in the mail log and the pace desk**, and a kind that nobody opens in a month is
  switched off by the superadmin, not by a guess.

## 2. The orb that moves

The orb is drawn in-app (`wobo/Companion.tsx`, `ui/Logo.tsx`: the gradient jelly and its spark).
That is the source of truth. For mail, which plays GIF and nothing else, the animations are RENDERED
FROM THE APP'S OWN ORB, never redrawn by hand: a script drives the component in a headless browser,
captures frames, and assembles GIFs at 480 px, under 600 KB each, with a still PNG fallback for
clients that freeze the first frame. Eight moves, each one thing:

| Move | Used by |
|---|---|
| hover (the resting breath) | the quick one, the welcome |
| wave | the welcome, the mid-chapter |
| a small bounce | the streak |
| the spark (the earned moment, marigold) | the win, the bonus level |
| thinking (the orb tilts, a dot orbits) | loading screens |
| drawing (a pencil line grows beside it) | loading a lesson, the doubt |
| reading (a page turns under it) | the doubt's reading |
| sleeping (only in-app, never in mail) | the empty states |

The same eight ship in-app as CSS and SVG (they already exist in part) so the mail and the product
are one character.

## 3. Loading that is worth watching

The experience judges scored waiting states low (1.25): spinners, blanks, captions for an absence.
Under the never-narrate law a loading screen says nothing about loading. It shows the orb doing the
subject's thing while the lesson comes: for maths the orb draws a number line and marks it; for
physics a pendulum swings under it; for biology a cell divides; for chemistry two beakers pour; for
social science a map fills in; for the doubt, a page turns and a pencil underlines. Ten seconds of
looped motion each, calm, both themes, reduced motion respected (a still with the spark). The first
real content replaces it mid-loop without a jump. Never a percentage, never "generating", never a
sentence about what Wobo is doing.

## 4. Landing on the exact place

A mail's button carries a signed, expiring link to a card: `/course/<course>/card/<card>` (the router
gains the card segment), which opens the course at that card with the learner signed in on the device
that opened it, or through the door first. The link is single-use for the sign-in part and reusable
for the destination.

## 5. In the code

- `services/gateway/src/wobo_gateway/hospitality/jobs.py` and `email_templates.py`: the five new
  kinds, each with its dial, its cadence rule, its deep link, its one-click unsubscribe, and the
  inbox law; tests for every rule above with the clock handed in.
- `tools/orb/render.mjs` (new): renders the eight moves from the app's orb into
  `content/brand/orb/<move>.gif` and `.png`; a test that every GIF exists, is under 600 KB, and
  that a mail template references only these.
- `apps/web-pwa/src/ui/orb-moves.css` and the loading screens per subject in `screens/course` and
  `screens/doubt`, under never-narrate, measured at 390 and 1440, both themes, reduced motion.
- The mail log moves into the database: `ops.mail_log`, append-only (migration 0024), because today it
  is a JSONL file on a Railway instance with no volume, so every held would-send and every record of a
  send is lost on each redeploy, and a mail desk cannot stand on that. The seed test's tab placements
  and the Postmaster numbers land in the same schema.
- The router's card segment and the signed link; the superadmin's mail desk on `ops.mail_log`: sends,
  held, clicks, unsubscribes per kind, the tab each seed landed in, and the switch per kind.

## 6. Landing in Primary, not Promotions

**The owner, later the same day:** *"They use such wording or tactics that their mails do not end up
in Updates or Promotions or Spam; they come straight to Primary. We need to do that too."*

Gmail's tabs are a classifier over three things: whether the sender is authenticated and known, what
the mail looks like, and what people do with it. Brilliant lands in Primary because all three are
in order. Ours, measured on 2026-09-08: **none of the three exist yet.** `heywobo.com` publishes no
SPF, no DKIM, no DMARC and no MX record (so no domain can be verified with Resend; the send-only
key we hold cannot list domains, DNS is the proof); so the gateway holds every live send as
`domain_unverified` and not one mail from Wobo has ever reached an inbox. Wording is the
third thing; the first two come first.

**First, the identity (an owner action, half an hour, once):**
1. Add `heywobo.com` in Resend (region: the nearest to India) and put its three records into Vercel
   DNS: the DKIM `TXT` at `resend._domainkey`, the SPF `TXT` and the `MX` for the bounce address
   at `send.heywobo.com` (a sending subdomain keeps bounces and reputation off the root).
2. Publish DMARC: `_dmarc.heywobo.com TXT "v=DMARC1; p=none; rua=mailto:dmarc@heywobo.com"`,
   then `p=quarantine` after two clean weeks. Gmail's 2024 sender rules require SPF, DKIM, an
   aligned DMARC, one-click `List-Unsubscribe-Post` (we send it), a spam rate under 0.3 percent,
   and a valid forward and reverse DNS on the sender. Without these the mail goes to spam or is
   dropped regardless of the words in it.
3. Register the domain in Google Postmaster Tools; the spam rate and the reputation there are the
   only honest measurement, and they belong on the superadmin's mail desk.
4. Put a real mailbox behind `hello@heywobo.com` and `support@heywobo.com`, and read replies.
   Replies are the strongest Primary signal Gmail has; a sender nobody can answer is a promotion.

**Then, the shape (the gateway enforces every line; the wave writes the tests):**
- One sender, always: `Wobo <hello@heywobo.com>`. Never `noreply`, never a second address, never a
  different display name per kind. The address that sent the welcome sends the streak.
- A person's mail, not a campaign's: text first, one image (the orb), one link. Gmail files
  image-heavy multi-link mail with a footer full of badges in Promotions. Brilliant's badges sit
  below a hairline, small, and are the ONLY extra links; we do the same or drop them.
- Under 120 words. No promotional vocabulary: no "free", "offer", "unlock", "limited", "%", no
  exclamation mark, no ALL CAPS, no emoji in the subject. A test scans every template and subject.
- The subject is the learner's name and a verb, and the first line of the body carries something
  only this learner would get (the chapter, the card count, the day of the streak). Personal is not
  a trick here; it is the inbox law's content rule.
- No open-tracking pixel and no click-tracking rewrite (Resend's tracking stays OFF for the
  domain); tracked links are a promotion signal and a privacy cost, and children's mail must not
  carry them. Opens are not measured; clicks are measured on our side by the deep link landing.
- `List-Unsubscribe` and `List-Unsubscribe-Post` on every nudge (already there), one click, no
  login. Honouring it instantly is a Primary signal; ignoring it is the spam signal.
- Send from a warm domain: the first fortnight sends only welcomes and Sunday notes, then the
  nudges, and volume grows with the learner count, never in a burst. A daily send cap in the
  gateway, raised by the superadmin, not by a deploy.
- Every send is one address per twenty-four hours (the inbox law), which also keeps the volume
  shape human.

**Then, the proof:** a seed test before launch and monthly after: the five mails to a Gmail, an
Outlook and a Yahoo inbox we own, and the tab each lands in recorded on the mail desk. Placement is
measured, not assumed.
