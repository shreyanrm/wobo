# The pitch to the Indian tech press

One email, written once, sent by hand to one named journalist at a time. Nothing in the repo sends
it, and it is never sent to a list. docs/GROWTH-PRESS.md §2.6 is the plan: at launch, with the film
and the demonstration, then again at each real number. §3 is what we never do, and the first line
of it is the one that matters here: never the same email to fifty journalists.

## When it may go

- **The film is cut and the demonstration survives a stranger's question.** A pitch that invites a
  reporter to try it is only as good as the first try.
- **Every sentence below is still true.** The body is the press kit's three hundred words, which
  `press.test.ts` holds to `docs/copy/press-kit.md`. If the kit changed, this changed with it.
- **A number goes in only when it can be shown.** The draft carries none, on purpose. When there is
  one (the plan names the first ten thousand lessons drawn, a board fully covered, a school using
  it), it gets a row in `docs/CLAIMS.md` first and a sentence here second.

## How it is sent

1. **Pick one person, not an outlet.** Read the last few pieces the outlet ran on education or
   consumer AI and find who wrote them. Their name goes in `{{journalist_first_name}}`. Nobody's name
   is ever guessed, and none is written into this file (voice.md §8.1).
2. **Write `{{why_you}}` for that person alone.** One sentence about a piece they actually wrote and
   why this is the next thing in it. If there is no honest sentence to write, that person is the
   wrong person.
3. **Send it one at a time**, from the founder, to their own address. No BCC, no mail merge, no
   tracking pixel, no attachment: the press page carries the files.
4. **Follow up once, a week later, in one line.** Then never again on the same news.
5. **Write down who was sent what and when** in the owner's own notes, so nobody hears the same
   pitch twice.

## Where

The reachable tier, from GROWTH-PRESS §1. Each is a person to find, not an address to send to.

| Outlet | The person to find |
|---|---|
| YourStory | whoever covers edtech startups |
| Inc42 | whoever covers edtech or consumer AI |
| Entrackr | whoever covers early-stage companies |
| Analytics India Magazine | whoever covers AI products built in India |
| Economic Times Tech | whoever covers edtech |
| Moneycontrol | whoever covers startups and technology |
| The Ken | whoever writes the long pieces on education |

TechCrunch and Forbes are not on this list until there is a round or a number (GROWTH-PRESS §1).

## What each sentence rests on

| The email says | What backs it |
|---|---|
| it answers on the page, and draws there | the board draws line by line: `packages/wobo/src/board/`, docs/CLAIMS.md §1 |
| a photograph of homework is read and worked on | photograph intake, named in `docs/legal/childrens-privacy.md` §3 |
| when one explanation does not land it tries another | the re-teach ladder, `apps/web-pwa/src/wobo/reteach.ts` |
| it follows the board's own syllabus | `apps/web-pwa/src/curriculum/`, and every chapter page cites its source document |
| free every day, and paid buys time, not teaching | the plans page and docs/copy/money.md |
| no advertising, nothing sold, no tracking across sites | `docs/legal/childrens-privacy.md` §3, "true today either way" |
| it can be shown working in under a minute | docs/CLAIMS.md §1, "each part of which we can demonstrate on request in under a minute" |

## Subject

> A tutor that draws the answer on the student's own page

## The email

> Hi {{journalist_first_name}},

> {{why_you}}

> I make Wobo, and I'd like to show it to you rather than describe it. Pick a question from any
> school textbook, in any subject, and I'll share my screen while it works on it. It takes under a
> minute. The short version is below.

> Most learning apps hand a child a video and a quiz. A good teacher does something else entirely:
> they pick up a pen and draw on the page in front of you, and they keep going until you have it.
>
> Wobo is an AI tutor built on that idea. It sees the page the learner is on, and it draws there: a
> ring around the step where the sign flipped, a number line built as it is explained, a labelled
> diagram appearing stroke by stroke while it talks. Photograph a page of homework and it reads the
> page, marks the line that went wrong, and works through it with the learner rather than handing
> over an answer.
>
> It follows the syllabus the learner's board actually sets: the official one for CBSE, ICSE, ISC and
> NIOS, and for any other board the one the learner brings as a photograph, a PDF or pasted text.
> And it adapts: no two learners get the same lesson, and when one explanation does not land it
> tries another, and another, until the topic is theirs.
>
> Wobo is free every day. Every learner gets the same tutor and the same teaching; a paid plan buys
> more time with it, never a better version of it.
>
> There is no advertising anywhere in Wobo, no learner's data is sold, and nothing tracks a learner
> across other sites or apps. A learner can see what Wobo remembers and delete it, line by line.
>
> Wobo is made by Dot eVentures Pvt Ltd, Hyderabad, India, at heywobo.com.

> The logo, screenshots and facts are at heywobo.com/press, free to use. A reply to this email
> reaches me, and so does support@heywobo.com.

> In short:

> Wobo is an AI tutor for Indian school students that draws every explanation live on the page, for
> every subject their board sets.

> Shreyan Reddy, founder of Wobo.

## The follow-up, a week later

> Hi {{journalist_first_name}}, one line in case my earlier note sank: I'm still glad to show Wobo
> working on a question of your choosing, whenever suits you.
