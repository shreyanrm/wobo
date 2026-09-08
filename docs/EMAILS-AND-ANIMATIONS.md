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
- The router's card segment and the signed link; the superadmin's mail desk: sends, opens, clicks,
  unsubscribes per kind, and the switch per kind.
