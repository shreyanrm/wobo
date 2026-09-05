# CLAIMS.md — what we say, and what backs it

Every superlative or comparative claim the product makes in public, and the evidence behind it.

**Why this file exists.** A comparative claim ("world's first", "the only", "better than") is
regulated advertising in the EU and the UK, and a regulator or a competitor may ask for
substantiation. The answer cannot be assembled in a hurry. It is written here, in advance, and every
line on a public page that makes such a claim is listed with what supports it.

This is also the file that stops the claim drifting. A marketing line tends to grow: "first" becomes
"only", "shows you" becomes "understands you". The wording below is the wording that is defensible,
and changing it means coming back here.

---

## 1. "The world's first AI companion that shows you"

**Where it appears:** the homepage eyebrow, above the headline.
**Owner's decision, 2026-09-05:** *"I want to use the line worlds first cause I actually am."*

### The claim, stated precisely

The claim is not "the first AI tutor", which would be plainly false, and not "the best", which is
unfalsifiable. It is a claim about a **combination** that we can each substantiate:

> An AI companion that **visually explains** an answer as it is worked, **understands the learner's
> context in real time**, and **generates the explanation for that learner** rather than serving a
> pre-made one.

Each of the three is verifiable in this codebase, and it is their combination in one product,
following a learner's own board syllabus, that the claim rests on.

### The substantiation

| Element of the claim | What backs it, in the code |
|---|---|
| Visually explains, as it works | The board draws the answer line by line rather than returning text: `services/gateway/src/wobo_gateway/board/`, `packages/wobo/src/board/`. The same idea also arrives filmed, as a thing to drag, or spoken, chosen by what the idea needs. |
| In four distinct forms | `ANSWER_KINDS` in `packages/contracts/src/answers.ts` — shade_regions, place_points, slider, order, match, number_pad, expression, draw, circle_part, choose_visual. |
| Understands context in real time | The tutor is conditioned on who it is teaching and where they are in their own syllabus every turn: `wobo_gateway/wobo.py`. Mastery state gates what comes next: `apps/web-pwa/src/screens/learn/mastery.ts`. |
| Changes approach when one does not land | `apps/web-pwa/src/wobo/reteach.ts` — a ladder across method, representation, example and voice, which never repeats the explanation that just failed. |
| Tests the ground beneath a topic | `apps/web-pwa/src/curriculum/placement.ts` — a short check, not an exam, that teaches the gap first. |
| Generates for this learner | Explanations are produced per learner per question. There is no content library being served. The example is built from what the learner has said they care about (`reteach.ts`, the `their_world` rung), and is skipped rather than invented when nothing has been stated. |
| Follows the learner's own syllabus | `curriculum/` — framework, board, class, chapter, topic, with the learner's own syllabus acceptable as a paste, a photograph or a PDF (`curriculum/OwnSyllabus.tsx`). |

### What we do NOT claim, and must not start claiming

- Not "the first AI tutor". Untrue and unnecessary.
- Not "the only". A stronger claim with no more evidence behind it.
- Not better than any named product, and never a comparison to a teacher, a school or a tuition
  centre. That is a standing owner ruling (DESIGN.md) and it is absolute.
- No market-share, user-count or ranking figure of any kind.

### The honest caveat, recorded

We have not run an exhaustive survey of every product on earth, and nobody could. What we have is a
claim about a specific combination, each part of which we can demonstrate on request in under a
minute. If a product is ever shown to have done all of it first, the line changes that day. That
position is defensible; a vaguer, grander version of it would not be.

---

## 2. "Fall in love with learning while studying"

**Where it appears:** the homepage headline.
**Owner's decision, 2026-09-05:** *"they actually will."*

### Is this a claim that needs substantiation?

No, and the distinction matters. This is **puffery**: a subjective aspiration no reasonable reader
takes as a measurable guarantee, in the same family as "the best day of your life". Regulators treat
puffery differently from a factual claim precisely because nobody can be misled about a feeling.

It is worth noting what makes it safe: it does not promise a grade, a rank, an exam result or a
percentage improvement. **Any of those would be a factual claim requiring evidence we do not have.**
That line is the one to hold: the day a hero line promises a mark, this file needs a study behind it.

### What the product does to earn it

The line rests on a real distinction — studying is the obligation, learning is what happens when it
lands — and the mechanisms that turn one into the other are built and testable: mastery gates
progression, a miss re-teaches on a different axis by itself, prerequisites are taught before the
topic that needs them, and what slipped comes back before it is lost.

---

## Keeping this file true

- A new superlative or comparative on a public page gets a section here BEFORE it ships.
- If the code behind a row changes, the row changes or the claim comes off the page.
- Nothing in here is a certification, an audit or a legal opinion. See `docs/CONFORMANCE.md` for what
  we deliberately do not claim.
