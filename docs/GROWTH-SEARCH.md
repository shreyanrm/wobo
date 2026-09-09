# Search: the market is open, and our site is invisible

Five readers went out on 2026-09-09. This is what they found and what we do about it. The full
evidence is preserved beside the wave 33 reports as `search-research.json`.

## 1. The market is asleep, and the category has left the field

| Who | What they hold | What is wrong with it |
|---|---|---|
| Vedantu | 343,462 indexed pages, 289k of them one question each | the solutions are behind a sign-in; the page titles say so |
| Allen (it absorbed Doubtnut) | 8,269,713 doubt pages, 99.9% of its estate | zero structured data on any of them |
| Physics Wallah | about 23,000 pages, updated yesterday | the freshest incumbent, and the one to respect |
| Byju's | chapter pages frozen on the 2023-24 syllabus | still lists a chapter the board removed |
| Toppr | nothing | the certificate expired in April 2025; the site does not load |
| Khanmigo | 9 pages | the category leader in AI has no organic surface at all |
| Photomath, Gauth | no sitemap; one blocks crawlers outright | the same |

Read that last block again. **Every AI-native tutor has ceded school search to legacy content farms**,
and the farms are decaying. A solo operator called Tiwari Academy currently out-performs every funded
company on page signals. This is not a crowded market. It is an abandoned one.

**And nobody draws.** Not one competitor page carries an original explanatory figure with image or
video markup. Vedantu, the biggest, has three URLs in its video sitemap. Our entire product is a tutor
that draws. That is the wedge, and it is unguarded.

## 2. Our site cannot be read at all

The audit, exact. Every URL on heywobo.com returns the identical 3,338-byte shell: no words, no links,
no heading. All 61 pages in our sitemap. The content exists only after JavaScript runs, and the
crawlers that matter for answer engines do not run JavaScript.

- **Every page tells crawlers it is the home page.** The canonical tag is hardcoded to the root in the
  build, and the correct per-page value is written client-side, which no crawler sees.
- **Every shared link previews as the home page.** The social tags are static and never updated per
  page. There is no preview image, no card, no structured data of any kind on any page.
- **Every legal document exists at two addresses**, each claiming to be the original, with the footer
  linking one and the sitemap listing the other.
- **Every missing path returns success**, including `/favicon.ico`, `/llms.txt` and any typo. A crawler
  probing for a file gets a page that says nothing.
- Layout shift on mobile is 0.243, which is poor. The rest of the vitals are acceptable.

None of this is hard to fix. The sitemap generator, the robots generator and the per-route canonical
table already exist and are exactly what a pre-renderer needs.

## 3. What we can honestly publish

Counted from the seed in production, not estimated: 4 boards carry a syllabus (CBSE verified, NIOS
verified, ICSE and ISC provisional), 13 classes, 50 subjects, 333 chapters, 711 topics, and 3,948
concept slugs. Every node carries its source document, page, section, the hash of the bytes we read,
when we read them, and the named checks that passed.

**That provenance is the rarest thing we own.** No competitor publishes where their syllabus came
from. Byju's cannot, because theirs is three years stale. One quiet line on every chapter page saying
which official document this came from, which page, and when we last checked it, is a trust signal no
content farm can copy.

The page families, in the order they become honest:

| Family | Count | Buildable |
|---|---|---|
| the 61 pages we already have | 61 | **today**, by pre-rendering; they are written, lawyered and voice-checked, and no crawler has read one |
| board pages | 4 | today, from the registry and the honest status labels |
| class pages | 13 | today |
| subject pages | 50 | today |
| chapter pages, tier 1 | 333 | today: the chapter, its topics, its provenance, and the tutor door |
| chapter pages, tier 2 | 333 | when the concept cores exist: the drawn explanation, the figure, three questions |
| topic pages | 711 | with tier 2 |
| glossary pages | up to 3,948 | with the cores; board-agnostic, so one core serves every board |

Two honest limits stay honest: **ICSE and ISC have no topics under their chapters**, and the concept
cores that make tier 2 possible are designed and not yet built.

**What the first limit turned out to mean, once the pages were built and measured (2026-09-09).**
A chapter page for a unit with no topic list carries its own name and nothing else: every other
string on it, including the sentence explaining that there is no list, is word for word the same on
the other 151. So those 152 do not ship, and ten more chapters whose only named topic repeats the
chapter's own name do not ship either. The units are all still published, with the document, the
page inside it and the hash, on the SUBJECT page above them, which is where a reader was going to
end up anyway. **The chapter family therefore publishes 171, not 333**, and the count in the table
below is the count of addresses that could be computed rather than the count that passed the gate.
The honest-count law (WOBO-TASKS §10.21) governs which of the two we print anywhere a person reads
it: 247 syllabus pages ship, of 409 addresses.

The tutor door needed for these pages already exists and is open: the public ask endpoint, grounded,
screened both ways, rate limited. Widening its corpus to the syllabus turns every chapter page into a
page you can ask a question on, which is the thing no competitor offers and the thing answer engines
like to cite.

## 4. The order of work

1. **Pre-render the public site.** Every URL emits real HTML at build time with its own title,
   description, canonical, social tags and preview image. Real files for robots and llms.txt. A 404
   that is a 404. One address per legal document. This alone makes 61 finished pages readable by every
   engine, and nothing else in growth is worth doing before it.
2. **Structured data where it still earns anything:** Organization with the sameAs graph for the entity
   work, WebSite, breadcrumbs, and Education question-and-answer markup on the chapter pages. Skip the
   schemas Google has retired.
3. **Ship the chapter pages at tier 1**, 333 of them, at a measured pace behind a quality gate.
4. **Then tier 2 and the glossary**, as the concept cores land, because that is where the drawn
   explanation and the unguarded wedge live.
5. **Then the demand pages** the readers mapped: chapter notes, the single-question long tail, the
   comparison pages that Byju's collapse has left unanswered, and the exam-cycle pages that spike from
   December to March.

## 5. What we do not do

Chase Allen's eight million pages. Publish a page for a board we have not read. Generate a page per
keyword with a template. Claim a syllabus we have not verified. The count we publish is the count we
can prove, which is the rule already written in the honest-count law.

## 6. Handcrafted where it counts, generated where it scales (owner, 2026-09-09)

*"Are we specially designing each of those subject pages and all those other pages, handcrafted
uniquely?"* Not all of them, and the split is deliberate.

**Handcrafted, 67 pages.** The 4 board pages, the 13 class pages and the 50 subject pages are written
and designed one at a time, with their own opening, their own art and their own answer to the question
a parent is actually asking on that page. These are the pages someone lands on while deciding, and
there are few enough to do properly. They are never generated from a template with a name swapped, and
a test asserts that no two of them share a paragraph.

**Where that stands, 2026-09-09.** The writing is done and it is stricter than the ruling asks: all
67 carry their own opening and their own answer to the one question a parent is really asking there,
in `apps/web-pwa/src/screens/syllabus/handmade.ts`, and `handmade.test.ts` fails if two of them share
a paragraph, a sentence, or even a run of six words. **The art is not done**, and it is owed rather
than dropped: the figure that would go on one of these pages is drawn per concept by the same
pipeline that draws for a learner, and the concept cores it needs are designed and not built. Sixty
seven decorations chosen by hand instead would be the swapped-name template this ruling forbids,
wearing a picture.

**One template per large family, with content and artwork unique per page.** 333 chapters, 711 topics,
the glossary. A shared frame is right here: it is what makes a site navigable and it is what every
reference site on earth does. The template is not what makes a page thin; emptiness is. Ours carries,
per page and different every time: the chapter's own topics, the official document it came from with
its page and section, the hash of the bytes we read, the date we last checked, and a tutor door that
answers about that chapter.

**The upgrade that no competitor can copy.** Our figures are generated per concept, not chosen from a
library, so an electrostatics page can carry a field diagram and a French Revolution page a timeline,
each drawn for that concept by the same pipeline that draws for a learner. Nobody in this market ships
an original explanatory figure on a chapter page at all. That is the difference between our template
and a content farm's, and it is the reason to build the cores before scaling the family.

**So the family ships in two passes, and the first is honest about being the first.** Tier one is the
chapter, its topics, its provenance and the tutor door: real, useful, plain, and shipped at a measured
pace. Tier two adds the drawn explanation, the figure and three questions as the concept cores land.
A tier one page never implies it has an explanation it does not have.
