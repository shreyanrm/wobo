# The growth desk: what it makes, where it may post, and what we may measure

**The owner, 2026-09-09:** *"Blogging, Medium, Reddit, Quora and so many others... what if we could
build some automations which could work on these and continuously keep posting all day everyday on
various different topics by gathering those details, generating content, visuals and everything, and
post and stuff; Google Analytics tools and stuff."*

Yes, with one correction that keeps the accounts alive and one that keeps us lawful. The engine makes
content all day. **A person posts where the platform requires a person.** And **the learner side of
the product is never measured by a third party**, because Indian law forbids it.

## 1. The law that decides the architecture

**DPDP Act 2023, section 9(3):** *"A Data Fiduciary shall not undertake tracking or behavioural
monitoring of children or targeted advertising directed at children."* A child is anyone under 18.
This is an absolute bar, and parental consent does not cure it. The Rules notified in November 2025
bring the children's obligations into force on 13 May 2027, and the educational carve-outs in the
Fourth Schedule are for institutions, not for a consumer app.

Two facts finish the argument. Google's promise not to log IP addresses is scoped to the EU,
Switzerland and the UK, so Indian traffic's IP reaches Google as a persistent identifier. And consent
mode's advanced setting still fires pings before any consent exists.

**So measurement splits physically at the sign-in door, and the split is enforced by the content
security policy rather than by anyone's discipline:**

| Surface | Who is there | What runs | Why |
|---|---|---|---|
| the public site: marketing, the chapter pages, help, plans, legal | parents and teachers arriving from search | **Plausible**, about $9 a month, no cookies and no persistent identifiers, so no banner and no consent state | matches the constraint by construction |
| the learner app, once signed in | children | **no third-party analytics at all**; the gateway counts what matters, first-party, day-bucketed | section 9(3) |

Nothing of value is lost. Sign-ups, source, first lesson, retention and cost per sign-up are all
facts the gateway already owns. Google Analytics may later sit on the public site alone, with Google
Signals off, and the one server event worth sending is the parent's payment.

## 2. The channels, in three tiers that never mix

**Tier 1, a script may post:** our own blog, Telegram, Threads (250 posts a day), Instagram Reels and
carousels (100 a day), the Facebook page, the LinkedIn page as document posts (the only real carousel
available organically), YouTube Shorts and long-form with chapters, and X as native threads.

**Tier 2, the machine drafts and a person sends:** Medium (its API is closed to new tokens; the
import tool sets the canonical back to us), Pinterest, the newsletter, Google Business Profile posts.

**Tier 3, a person only, and no automation ever:** **Reddit and Quora.** Reddit's shadowbans are tuned
for exactly the pattern a scheduler produces, and Quora has no write API at all. Our Reddit presence
is one named account that says who we are, answering questions in the study subreddits with the whole
worked solution in the comment and no link, for weeks before any link appears, with the moderators
asked first. That is marketing time, not an integration. Hacker News is the same and its guidelines
say so outright.

**X's price shapes the format:** a post costs about 1.5 cents, a post containing a link costs 20
cents. So links go in the last reply of a thread, never in the first post, which is also what the
platform rewards.

## 3. What Google will and will not forgive

*"Scaled content abuse is when many pages are generated for the primary purpose of manipulating
search rankings and not helping users"*, and the named example is generating many pages with a
generative model without adding value. The discriminator is not the machine and not the volume. It is
the marginal value of each page. Our chapter pages carry a real explanation, a drawn figure and
verified working, which is exactly the thing a template with a swapped keyword does not have. The
desk still publishes them at a measured pace behind a quality gate, never a thousand in a night.

**Publish then syndicate, enforced in code:** the blog post goes to heywobo.com first, waits until the
URL is actually indexed, and only then releases the Medium repost with a canonical back, the LinkedIn
document and the X thread. A syndication job that runs before the origin is indexed is how a small
site loses its own ranking to Medium.

Disclosure: Medium demotes undisclosed machine-written pieces, so every syndicated piece carries a
plain note and a human byline. Our own blog says the same in its about line, because it is true.

## 4. The desk itself

Jobs in the gateway, a page on the superadmin called Growth, nothing new to host.

1. **Gather** (daily): Search Console queries we nearly rank for, the questions in the study
   subreddits and People Also Ask, exam and board dates, and what our own learners asked most. Ranked
   by demand and by how well a cached concept core already answers it.
2. **Make**: one source piece per topic from the concept core, answer first, with a drawn figure from
   the board pipeline and a short film from the film pipeline, in the register, never narrating, and
   only claims that docs/CLAIMS.md has cleared. Then five shapes from the one piece: the blog post,
   the Medium repost, a LinkedIn document, an X thread, a Short.
3. **Queue and post**: tier 1 on its own, tier 2 and 3 into an approval list you clear in one tap.
4. **Measure**: every piece gets one durable campaign id, used as `utm_id`, of the shape
   `channel-yyyymm-slug-nn`. The gateway writes that id on the account at sign-up, once, and the
   cookie dies there. Migration `0024_growth_attribution.sql` adds `growth.campaigns` and one column
   on the account.
5. **Report** (weekly, on the desk): pages indexed, impressions and clicks by page family, sign-ups
   by campaign, cost per sign-up, and a standing check of whether the answer engines name us.
6. **Dials**: cadence per channel, topics on and off, the approval queue, and a kill switch, all live
   from the console with an audit row, never a deploy.

## 5. First, and cheapest

Telegram is free, has no approval and no disclosure regime, and its limits are far above a daily
drop, so the problem of the day goes there from day one and gives the engine a real heartbeat while
the heavier channels are wired. The blog and Threads are a day's work each. LinkedIn, Instagram,
Facebook, X and YouTube come after, and only then is it worth deciding between hand-written adapters
and a self-hosted scheduler.

Search Console and Bing Webmaster take twenty minutes: a domain property verified by a DNS record
that stays forever, the sitemap submitted, and IndexNow on the Bing side.

## 6. The blog, and it is built

`/blog` exists, and it is the origin section 3 requires: the index, one page per post, one page per
tag, and a feed at `/blog/feed.xml`. Every post is a Markdown file in `docs/copy/blog/`, compiled at
build time the way the help centre is, so a post is a file and needs no database.

| Piece | Where |
|---|---|
| the posts, and the blog's own tags, writers and assistance note | `docs/copy/blog/**` |
| the engine and the gate: front matter, reading time, addresses, feed, structured data | `apps/web-pwa/src/screens/site/blog/post.ts` |
| the build step | `apps/web-pwa/src/screens/site/blog/compile.ts`, run as `bun run blog:content` |
| the three pages | `blog/Blog.tsx`, `blog/BlogPost.tsx`, `blog/BlogTag.tsx` |
| the compiled blog and the feed | `src/screens/site/content/blog.json`, `public/blog/feed.xml` |

**The gate is the part that matters**, because section 3 is about not becoming the thing Google
calls scaled content abuse. The build refuses to publish a post under 600 words, without an opening
line that answers on its own, without at least three sections, without a real date, a declared
author and a declared tag, without a summary a search result can show, with an em dash anywhere, or
at an address that would collide with the tag pages. It refuses a tag page with fewer than two posts
under it or with no words of its own, because a tag with one post is that post at a second address.
A refused post fails the build with its name and the reason. The count on the index is
`posts.length`, never a number anybody typed.

**Two things are the owner's, and both are one line of a file.** The bylines name a desk rather than
a person, because inventing a name is forbidden and nobody has been named: fill the `name` column in
`docs/copy/blog/README.md` and every post's byline and its structured data name that person instead.
And every post here says a machine helped write it, in the words of the same README's assistance
note, which is the disclosure section 3 requires of the syndicated copies as well.
