# The press kit, word for word

Every line here is used **verbatim and identically** on every surface. That is the point: an answer
engine decides what Wobo is by what independent sources agree on, and today they agree it is a
job-search app (wobo.ai). Sameness is the lever. Nothing here is a draft to be improved per site.

## The one line (use everywhere: listings, app stores, social bios, the meta description)

> Wobo is an AI tutor for Indian school students that draws every explanation live on the page, for
> every subject their board sets.

## The hundred words (Crunchbase, Product Hunt, LinkedIn, press kit)

> Wobo is an AI tutor for Indian school students, for every subject their board sets. It holds the
> official syllabus for CBSE, ICSE, ISC and NIOS, and a learner on any other board brings their own.
> It teaches the way a good teacher does: it draws. Ask a question and
> Wobo marks the page in front of you, circles the step that went wrong, builds the diagram stroke
> by stroke, and explains as it goes. Photograph a page of homework and it reads the page and works on it with you.
> It is free every day, it never judges, and it does not stop at one explanation: when one way does
> not land, it tries another. Wobo is made by Dot eVentures Pvt Ltd in Hyderabad.

## The three hundred words (the press page, the pitch email's body)

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

## The founder

> Shreyan Reddy, founder of Wobo.

One name, spelled the same way on every listing, in every byline and in the press page's Organization
markup. A photograph belongs beside it and there is not one yet; the page names the founder without
one rather than inventing a placeholder, and the photograph drops in when the owner supplies it.

## The contact a person reads

> support@heywobo.com

Not a form and not a no-reply. It is the one mailbox the legal set publishes
(`apps/web-pwa/src/screens/site/identity.ts` reads it back rather than typing it), so a journalist,
a parent and a regulator all write to the same place and a person answers. A press@ box would be a
second address for the same human and one more thing to go unread, so there is not one until there
is somebody whose job it is to read it.

## The facts, for the box in every article

| | |
|---|---|
| What | An AI tutor that draws its explanations live on the learner's page |
| For | School students in India, and their parents |
| Boards | CBSE, ICSE, ISC and NIOS; any other board from the learner's own syllabus |
| Price | Free every day; paid plans buy more time, not better teaching |
| Made by | Dot eVentures Pvt Ltd, Hyderabad, India |
| Site | heywobo.com |
| Founded | 2026 |

## What we never say

Any class, grade or age range, in any direction. The copy law forbids a range on every public
surface and a listing is the most public surface there is (docs/copy/voice.md §8.2), so the words
here say **every subject their board sets** and let anyone who reads them sign up and look. This
file named a floor and a ceiling in three places until 2026-09-09; the gateway's own copy test
failed on it, and the range came out rather than the law bending for a press release.

A consent step Wobo does not take yet. Until 2026-09-17 the three hundred words promised "parental
consent for under-13s", "no behavioural tracking of learners" and a parent view, and
`docs/legal/childrens-privacy.md` §3 says in as many words that no consent gate ships and that
whether the tutoring profile counts as behavioural monitoring is still with counsel. A press kit
may not promise what the legal set says is missing, so that paragraph now carries only what §3
lists as "true today either way". The consent line comes back the day `docs/CONSENT-PLAN.md`
ships, and not before. The same day, "the same tutor and the same lessons" became "the same
teaching": the paragraph before it says no two learners get the same lesson, and a journalist
reads both.

Any number we cannot show. Any claim of exam results or marks improved. "Personalised" as a claim on
its own. The names of the models behind it (the white-label rule). A comparison naming a competitor
unfavourably. Anything about a specific child.

## Where these strings go, and who does it

Listings the owner creates, pasting the one line and the hundred words unchanged: **Wikidata**
(the item is what makes engines resolve the name), **LinkedIn company page**, **Crunchbase**,
**Product Hunt**, **Google Business Profile** for Dot eVentures, **Play Store and App Store** when the
shells ship, **G2 and Capterra**. The press page at heywobo.com/press is ours to build: the same copy,
the logo in SVG and PNG, three screenshots, a sixty-second film of a lesson being drawn, the facts
box, and a contact address that a person reads.

## The page, and what it actually carries (built 2026-09-11)

`/press` is live in the tree and pre-renders like every other public page, so a journalist with
JavaScript off and an answer engine that never runs any both read the whole kit off the file. It
carries, in this order: the one line, the hundred words, the three hundred words, the facts box, the
founder, the downloads, the screenshots, and the contact address. Every string on it is read from
`apps/web-pwa/src/screens/press/copy.ts`, which is held to THIS FILE by
`apps/web-pwa/src/screens/press/press.test.ts`: change a word here and the test fails until the page
agrees, which is the only way sameness survives a year of edits.

**The downloads.** `public/press/wobo-wordmark.svg`, `wobo-wordmark.png` (2048px wide, transparent)
and `wobo-mark.svg` (the drawn face), written by `scripts/press-assets.ts` from the same wordmark the
site's own header wears, so the logo a journalist prints and the logo on the site can never be two
different drawings.

**The screenshots.** Three, written by the same script from the REAL built site rather than drawn for
the occasion: the answer being drawn, the four forms of one answer, and the re-teach ladder. Each is
captured at 1440 on the pre-rendered page it lives on, and each is labelled on the press page with
what it shows and where it came from.

**The film is not there yet**, and the page does not pretend otherwise: the sixty seconds of a real
lesson being drawn is the one item of this kit that has to be recorded rather than built, and the
page says so in one line rather than leaving a dead link. That is the only gap.


## The launch assets (2026-09-17)

`docs/copy/press/` holds the three things a person sends by hand, and nothing in the repo sends
any of them: `product-hunt.md` (the launch page, field by field), `pitch-email.md` (one named
journalist at a time, never a blast) and `awards.md` (the design award submissions). Every line a
reader reads sits in a quote, exactly as it does here, and `press.test.ts` holds those quotes to
this file and to the same law the page obeys. The one line, the hundred words and the three
hundred words appear in them unchanged.

A board we do not hold the official syllabus for, named as covered. Until 2026-09-17 this file
claimed every board run by a state government, in three places, and the syllabus the site publishes
holds CBSE, ICSE, ISC and NIOS and none of those, so a journalist who looked one up found nothing.
What is backed is the four boards by name and the learner's own syllabus for every other one
(docs/CLAIMS.md, `curriculum/OwnSyllabus.tsx`). A board is added to these words the day its
syllabus is on the site, and not before.
