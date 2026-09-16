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
   cookie dies there. Migration `0038_growth_desk.sql` adds `growth.campaigns` and one column
   on the account (the number this line first named went to `ops.settings`).
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

## 7. The desk, and it is built (2026-09-17)

Everything in section 4 now exists as jobs in the gateway and a page on the console, keyless and
stopped until the owner turns it on. Nothing has been posted anywhere, and nothing can be until the
kill switch is on, a channel has its credentials, and a person has approved the post.

| Piece | Where |
|---|---|
| the tiers, and Reddit and Quora refused at every door | `services/gateway/src/wobo_gateway/growth/channels.py` |
| gather: the harvest, Search Console near misses, what our learners were served, a person's notes, the live syllabus | `growth/demand.py`, `growth/gather.py` |
| make: one piece from a concept core already on file, a verified drawn figure, a film if there is one, and the official documents | `growth/make.py` |
| the gate a piece must clear, and the copy screen | `growth/piece.py`, `growth/screen.py` |
| the five shapes, each on its channels, each with its own campaign id | `growth/shapes.py`, `growth/campaigns.py` |
| publish then syndicate, the pace, the approval queue | `growth/outbox.py`, `growth/indexing.py` |
| the hands: the blog, Telegram, Threads and X are wired; LinkedIn, Instagram, the Facebook page and YouTube say why not | `growth/posters.py` |
| the dials, in `ops.settings` | `growth/settings.py` |
| the doors: three daily passes, the arrival, the console page | `growth/api.py` |
| the tables, and the account column written once | `infra/supabase/migrations/0038_growth_desk.sql` |
| the page | `apps/web-pwa/src/admin/growth.ts`, `GrowthActions.tsx` |
| the campaign carried from the public site to sign-up, then forgotten | `apps/web-pwa/src/shell/campaign.ts` |

**The three passes** are `POST /v1/internal/growth/gather`, `/make` and `/post`, behind the same
internal key as the mail passes, and a cron calls them daily in that order. Gather reads what it
can and names what it cannot. Make drafts at most `growth.pieces_daily` pieces a day from the top
of the ranking, skips a topic that is switched off or is the same idea as a piece already out, and
never buys a concept core: a topic with no core is owed, by name. Post checks indexing, releases
the copies of any origin that is live, and posts what is approved, under each channel's cadence.

**Publish then syndicate is enforced three times.** A copy is staged held; it is released only
once the blog post is posted and seen indexed (by Search Console, or by the owner with a note
saying how); it is checked again at the moment of posting; and the database refuses a copy that
moves to approved, queued, posted or sent while its piece has no indexed stamp.

**The dials** are `growth.running` (the kill switch, off by default, and off whenever the table
cannot be read), `growth.cadence` (posts a day per channel; the blog can never exceed three),
`growth.topics_off`, `growth.approval` (`every` by default: every post waits for the owner, tier 1
included, until the owner chooses `person`) and `growth.pieces_daily` (at most three). Every turn
is an owner act with a step-up, a line in the console trail, and a row in `ops.settings_audit`.

**Reddit and Quora.** No route, poster, shape, campaign id, dial, table row or control exists for
either, and `services/gateway/tests/test_growth_channels.py` scans every source file in the
repository for a client, a hostname or an endpoint of either and fails if it finds one. The
questions asked there reach the desk only as a person's pasted notes.

**What is owed, and why each is honest rather than faked.** Concept cores are not on file for the
ranked topics, so every topic is owed "no concept core"; the desk will not buy one. Search Console
is not verified, so near misses and indexing are read only once
`GROWTH_SEARCH_CONSOLE_TOKEN` and `GROWTH_SEARCH_CONSOLE_PROPERTY` are set. Exam dates stay absent
until a board's date sheet is read like any syllabus document. The film pipeline has made no
film, so every Short is owed. LinkedIn documents need their pages rendered to a PDF, and Reels and
Shorts need a film at a public address. Cost per sign-up and whether the answer engines name us
are printed as not measured, with what would measure them.

**The origin is a file, so a person ships it.** The blog is compiled from `docs/copy/blog/` at
build time (section 6), so the blog poster writes the post into `GROWTH_BLOG_DIR`, a checkout of
that folder, and the post goes live with the next deploy of the site. A written file is a posted
campaign and nothing more: the desk stamps the piece published only once its address answers with
its own canonical, refuses the indexed mark while it does not, and asks the address again before
every release and every copy. A page that has gone (a redeploy of a wiped disk can lose the file)
is posted again from the desk's "Post it again" control, under the next attempt; the finished row
never moves. Files are numbered past 99 the way the compiler reads them.

**What the writer may cost.** The make pass never calls the writer for a piece the gate must
refuse (no drawn figure, no official source): that topic is owed, by name, and tried again when
the figure lands. Every writer call spends the day's allowance, passed or refused, and the
allowance is two calls per piece the day may make, so six at the ceiling of three. A refused topic
is written again after seven days, not used up for good. And the writer stands down at the stranger
lane's degrade line (half the platform's ceiling, `spend.py`), so copy for the blog never takes
money a learner's answer would have had.

**Before the first post, in order:** apply migration 0038; point `GROWTH_BLOG_DIR` at a checkout
of the blog source; set the Telegram bot token and channel; turn the switch on; approve the first
blog post; deploy the site with the file it wrote; mark it indexed once it is (the desk refuses
the mark until the page answers).
