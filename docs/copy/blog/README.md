# The Wobo blog

**What we learn while building a tutor, written down: how to read a syllabus document, what a board actually changed this year, and what a machine can and cannot do for a learner.**

This folder is the source of `/blog`. One Markdown file is one post. `apps/web-pwa/src/screens/site/blog/compile.ts` reads this folder at build time and writes `apps/web-pwa/src/screens/site/content/blog.json` and `apps/web-pwa/public/blog/feed.xml`. Nothing rewrites a sentence on the way through, and nothing on the page is typed twice.

**heywobo.com/blog is the origin.** Every other copy of a post, anywhere, points its canonical back here, and no copy is released before this one is indexed. That order is the difference between a small site keeping its own ranking and handing it to a larger one (docs/GROWTH-DESK.md section 3).

## How a post is written

Front matter first, between two lines of three hyphens, then the post.

| Field | What it holds |
|---|---|
| `title` | The page title, and the headline. Sentence case. |
| `summary` | The meta description and the line under the title on the index. One sentence, between 60 and 160 characters, in the page's own words. |
| `published` | The day it went up, as `YYYY-MM-DD`. |
| `updated` | The day it was last revised, or left out. |
| `author` | A key from the Authors table below. |
| `tags` | Keys from the Tags table below, separated by commas. |
| `ai-assisted` | `true` or `false`. Stated every time. A missing field fails the build rather than defaulting to a comfortable answer. |

The body opens on one bold line that answers the question on its own, the way a help article does. Under it, at least three sections with headings, so a reader can jump through the page instead of scrolling it.

## The gate

The build refuses to publish a post that does not clear these, and says which post and why. The rules live in `blog/post.ts` and are held by `blog/post.test.ts`.

- At least 600 words of real prose. Not padding to a number: it is roughly the length at which a page can carry an answer, the working behind it and the honest limit.
- An opening line of at least ten words, and at least three headings.
- A summary a search result can actually show.
- A real date, an author who exists, and at least one tag that exists.
- No em dash, anywhere a reader can see one.
- A tag page publishes only with at least two posts under it and a blurb of its own. A tag with one post is that post at a second address, which is the duplicate a content farm publishes.

The count we publish is the count we can prove: the index prints the number of posts it is actually holding, never a number anybody typed (the honest-count law, WOBO-TASKS section 10.21).

## Tags

| slug | title | blurb |
|---|---|---|
| syllabus | Syllabus | What a board actually publishes, where it publishes it, and how to tell this year's document from the one that is still sitting in a search result. |
| how-wobo-teaches | How Wobo teaches | Why a drawn explanation lands, how a photographed doubt is solved step by step, and what happens when the first explanation misses. |
| for-parents | For parents | For the person paying and worrying: what to look for, what to ask, and what nobody should promise you. |

## Authors

A name goes here when the owner decides which name goes on the page. Until then the byline names the desk, because a byline nobody decided would be a byline somebody invented, and that is exactly the thing these pages exist to be the opposite of (docs/copy/voice.md section 8.1).

| key | name | role | about |
|---|---|---|---|
| syllabus-desk |  | syllabus desk | Fetches the board documents, reads them against their own page numbers, and keeps a record of what was read and when. |
| teaching-desk |  | teaching desk | Works on how an explanation is built, what happens when one misses, and what the tutor should refuse to do. |

## The assistance note

Drafted with AI help, from source documents and notes a person gathered, then read and edited by a person before it went up. Every figure in it is one we can show you the source of.
