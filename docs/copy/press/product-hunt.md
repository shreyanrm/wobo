# Product Hunt, the launch page field by field

The launch page as a person fills it in, on the day, by hand. Nothing in the repo posts it.
docs/GROWTH-PRESS.md §2.4 is the plan and §3 is the list of things we never do; this file is only
the words. Every line a visitor reads is in a quote, and `apps/web-pwa/src/screens/press/press.test.ts`
holds those quotes to `docs/copy/press-kit.md` and to the copy law.

## Before it goes up

- **The film exists.** Two minutes of a real lesson, recorded as it happened, first in the
  gallery. Until it is cut there is no launch, because a demonstration that misfires is worse than
  silence (GROWTH-PRESS §1).
- **The link is a chapter page, never the home page** (GROWTH-PRESS §2.4). It is the chapter the
  film was recorded on, copied on the day from `heywobo.com/sitemap.xml` so it is an address the
  build actually wrote.
- **The handle is ours.** `shell/profiles.ts` has a `producthunt` row; set `claimed: true` the day
  the maker account exists, and the Organization markup picks it up on the next build.
- **The founder answers every comment for twenty-four hours.** Nobody is ever asked for an upvote,
  in any channel, by anyone.

## Name

> Wobo

## Tagline

Product Hunt cuts a tagline at sixty characters. This is forty-six.

> An AI tutor that draws the answer on your page

## Description

The one line, unchanged.

> Wobo is an AI tutor for Indian school students that draws every explanation live on the page, for
> every subject their board sets.

## About

The hundred words, unchanged.

> Wobo is an AI tutor for Indian school students, for every subject their board sets. It holds the
> official syllabus for CBSE, ICSE, ISC and NIOS, and a learner on any other board brings their own.
> It teaches the way a good teacher does: it draws. Ask a question and
> Wobo marks the page in front of you, circles the step that went wrong, builds the diagram stroke
> by stroke, and explains as it goes. Photograph a page of homework and it reads the page and works on it with you.
> It is free every day, it never judges, and it does not stop at one explanation: when one way does
> not land, it tries another. Wobo is made by Dot eVentures Pvt Ltd in Hyderabad.

## Topics

Chosen from Product Hunt's own list on the day: Education, Artificial Intelligence, Parenting.

## Gallery

The film first. Then the press page's three screenshots, in its order, captioned as the press page
captions them. Each is written by the build from the real site, so it is downloaded fresh from the
live address on the day rather than kept here.

https://heywobo.com/press/wobo-drawn-answer.png

> The answer, drawn. One question, answered on the page in front of the learner rather than in a
> paragraph.

https://heywobo.com/press/wobo-four-forms.png

> The same question, four ways. Drawn, filmed, handed over to drag, or said out loud, whichever the
> idea needs.

https://heywobo.com/press/wobo-reteach.png

> When one explanation does not land. The second attempt is a different route in, never the same
> explanation louder.

## Maker

> Shreyan Reddy, founder of Wobo.

## The maker's comment

Posted by the founder the minute the page goes live. It says what can be checked on the page it
sits on and nothing else: no count of anything, no comparison, no promise about marks.

> Hi Product Hunt, I'm Shreyan, and I make Wobo.

> A good teacher picks up a pen, and Wobo is built on that. Ask it a question from your syllabus and
> it answers on the page in front of you: it rings the step where the sign flipped, builds the
> diagram as it explains, and when that way does not land, it tries a different one.

> Drawing is one of the things it does. It also films an idea, hands you something to drag, and
> says it out loud, whichever the idea needs.

> It follows the syllabus a student's own board sets: the official one for CBSE, ICSE, ISC and NIOS,
> and for any other board the one the student brings. It is free every day, and a paid plan buys
> more time with the same tutor, never a better version of it.

> The film above is a real lesson, not a mock-up. Try it on a question of your own and tell me where
> it gets something wrong. I'm answering every comment here today.
