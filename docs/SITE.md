# SITE.md — the public site: map, navigation, and how every page pitches

Owner brief (2026-09-03): "a lot of internal pages explaining everything in detail; every page pitches in its own way; the top navbar planned accordingly; a security page for all our compliances and data security, so viewers have full confidence." Reference for the scroll and chapter feel: groundreality.ai (GSAP ScrollTrigger + Lenis, pinned numbered chapters, one drawn artefact per chapter, disciplined spacing). Visual law: DESIGN.md §0, law v5 (white ground, colour only where it does a job, the spacing rhythm, the three causes of scroll jitter, the copy law). The built expression of the law, and the source every page copies its tokens, spacing, motion and copy from: `design/prototypes/landing-v8.html`.

## 1. Navigation

**Top bar.** Wordmark · Meet Wobo · Subjects · How it works · For parents · For students · Plans · | · Sign in · the one call to action.

The order is the order the doubts arrive (docs/SELL.md §3), not the order the pages were built: "what even is this" first, then "will it work for MY board", which is the single biggest qualifier and used to sit fifth. A nav is not a sitemap, so six items is the ceiling and the security page stays out of the bar, one tap away from the footer, the parents page and the legal set.

The loud door is not written here, and it is not written on a page either. It lives in one constant, `apps/web-pwa/src/screens/site/cta.ts`, and every surface reads it from there, so a header and a plans page can never again say two different things about whether we are open. We are open (owner, 2026-09-04): the door invites, and no surface may imply a waitlist.

**Footer.** Wobo (Meet Wobo, How it works, Subjects, Plans, Gift Wobo, Donate Wobo) · For (Parents, Students) · Help (Help centre, Contact, Questions) · Company (About, Security and trust, Terms, Privacy, Children's privacy, Cookies, Accessibility).

"Schools" came out of the second column. It pointed at `/schools`, there has never been a route for it, and it therefore answered with the 404 on every public page the footer appears on — a dead control in the chrome, which is the friction docs/SELL.md §8 names first. `screens/site/handoffs.test.ts` now walks every address in the nav and the footer through the router, so a second one cannot be added by hand.

Every page shares the site shell (header, footer, cursor ribbon, depth layer, Lenis scroll), the spacing scale, and the rule that the mechanism is never explained ("every board on demand" stays a secret; pages say "it teaches what your school teaches").

## 2. Pages, and how each one pitches

Every page is a pitch with its own angle, told through scenes rather than feature lists, and ends on the same close: **Wobo opens to families this term. Leave an address and you are in the first group, free, with the whole tutor from day one.** Never "begin tonight", and never a first lesson, while the product is still opening. Each page has: a hero with one made artefact, two or three pinned or scrolled chapters, an interactive moment where it fits, an Ask Wobo section near the end, and the early-access close panel.

One rule cuts across all of them: **drawing is one part.** No page may leave a reader thinking the board is the product. Wherever a chapter shows Wobo drawing, a neighbouring chapter shows it filming, simulating, speaking, setting practice or remembering.

| Route | Angle | Hero artefact | Chapters | Interactive moment |
|---|---|---|---|---|
| `/` | The Tuesday night | live drawing card + Wobo | 9:40 pm chapter · the learner tries one · Sunday note · on anything · subjects · parents · ask · questions · devices | the half-square puzzle, Ask Wobo |
| `/meet-wobo` | Who Wobo is, the character and the voice | Wobo large, blinking, following the pointer; the first-meeting line written | how it listens (voice + typed + circle) · how it shows (drawn, filmed, built to drag, spoken) · how it notices (praise, gaps, the note) · what it never does (no shaming, no opinions, no ads) | say "Hey Wobo" (hold space demo, mock) |
| `/how-it-works` | A lesson from first question to Sunday note | the three-step strip drawn | ask · drawn out · try one · practice that rings the gap · the week · the parent view | a second answer kind (drag the point on the graph) |
| `/for-parents` | Peace of mind and a tutor at any hour | the Sunday note with the envelope | the 8 pm drive · what you see (parent view) · safe by design · what it costs (link to plans) · the questions parents ask | Ask Wobo (parent questions) |
| `/for-students` | It never makes you feel small | the film with the lasso | ask the basic thing · it shows, it doesn't lecture (drawn, filmed, dragged, spoken) · you answer back in the kind that fits · it rings the gap · it notices when you nail it · your streak, your way | the puzzle plus a "draw the angle" moment |
| `/subjects` | Every subject, your school's way | the four subject tiles as drawn objects | one chapter per subject with its own drawn lesson (Pythagoras, benzene, a map that is drawn per the learner's own government, a paragraph marked up) | the subject objects morph on scroll (the raymarched prism → benzene → planet) |
| `/subjects/mathematics` etc. | One subject, every level your board sets | the subject's own object | the first ideas · the middle years · the senior chapters · the kind of practice · the note a parent gets | one answer kind native to the subject |
| `/plans` | Free every day; more when exams get close | the allowance widget drawn | free vs pro vs max, honest table (a multiple of the free allowance, never a count of questions) · the two consent checkboxes at checkout · the gift | the plan picker. No country switch: the currency comes from the browser's time zone, or the request's country on the server |
| `/gift` | The smartest gift | a wrapped note | who it's for · what they get · how it arrives | choose a gift card |
| `/schools` | For a class, not a child (later) | a classroom board | the teacher's view · the syllabus pinned · privacy for a school | contact form |
| `/about` | Why we built it | the mission line in Wobo's hand | how Wobo teaches · what we cover · our promises · the team | Ask Wobo about us |
| `/security` | Full confidence: what we hold, how we protect it, who can see it | a drawn shield with Wobo's eyes | data we collect and why · where it lives and how it is protected (encryption in transit and at rest, access control, keys, backups, incident response) · children's data and consent (DPDP, COPPA, GDPR) · what we never do (sell, track across the web, train on your child without consent, show ads) · who can see what (learner, parent, staff, the audit trail) · third parties as categories · compliance posture and the road to certifications (stated honestly: which controls are in place today, which audits are scheduled) · how to report a concern · sub-processor list and change notice | request the security overview (email form) |
| `/help`, `/help/<group>/<slug>` | Answers first | the group's ink mark | article · next · Ask Wobo about this | Ask Wobo |
| `/contact` | A person answers | the letter | form · response promise | form |
| `/legal/*` | The set, plain-worded | the "in plain words" card | document | — |
| states (404, 500, offline, limit, expired, maintenance) | Wobo present, never a dead end | the ink scenes from `states-v2.html` | — | — |

## 3. The security page, in detail

Written for a parent, a school IT lead and a journalist at once. Sentence case, no jargon without a one-line gloss, no claim we cannot show. Sections:

1. **The short version.** Five lines: what we collect, why, where it lives, who sees it, how to delete it.
2. **What we collect and why.** Account (email, name, class, board), learning data (questions, answers, drawings, progress), voice (processed for the turn, not stored unless the family opts in), payment (handled by the payment provider, never stored by us), device and usage (for reliability, no advertising identifiers). Each row: purpose, retention, how to delete.
3. **Where it lives and how it is protected.** Regions, encryption in transit (TLS 1.2+) and at rest, key management, least-privilege access, audit logs, backups and restore tests, secure development (reviews, dependency scanning, secrets never in code), incident response with notification windows.
4. **Children first.** Consent flows by age and jurisdiction (DPDP Act 2023 verifiable parental consent, COPPA under 13, GDPR-K), the parent view, the erase-everything button, no profiling for advertising, neutral content rules (plan §20).
5. **Who can see what.** A table: learner, parent, school (if linked), Wobo staff (break-glass with logging), third-party processors by category.
6. **What we never do.** Sell data, track across the web, show ads, vary prices by behaviour, use dark patterns, train models on a child's data without explicit consent.
7. **Compliance posture.** Today: the controls above. Scheduled: independent penetration test, SOC 2 Type I then Type II, ISO 27001 readiness; kidSAFE-style seal evaluated. Dates only when they are real.
8. **Sub-processors.** Categories with regions and the change-notice promise.
9. **Report a concern.** support@heywobo.com, a responsible-disclosure promise, a 72-hour acknowledgement.
10. **Documents.** Privacy policy, children's privacy, terms, DPA on request, the data-flow diagram drawn in ink.

## 4. Build order

1. Home (`design/prototypes/landing-v8.html`) ported into the app with the shell, the scroll engine and the ribbon; every public page adopts the shell, and copies v8's token block, spacing variables, motion rules and copy verbatim.
2. Meet Wobo, How it works, For parents, For students, Subjects (+ four subject pages), Security: designed as prototypes by Fable from this map, then built by workers with the copy from `docs/copy/**` extended per page, under the copy law of `docs/copy/voice.md` §8.
3. About, Help, Plans, Gift, Contact, Legal, states: re-skinned to law v5 (they were built during Wave 7b in the cream-ground language of v3 and v4).
4. Every page: element inventory (§15), three-width proofs at 390, 834 and 1440 in both themes with no horizontal scroll, the copy audit (§19, §20 and the copy law, which `services/gateway/tests/test_copy_law.py` runs), performance budget.
