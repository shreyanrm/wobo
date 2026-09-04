# Wobo — the build plan

Dated 2026-09-02. Owner: Shreyan. Orchestrator: Fable. This plan is the working contract between the owner's vision (recorded in `CONTEXT.md`, `DESIGN.md`, `WOBO.md`, `WOBO-CAPABILITIES.md`, `MOTION.md`, `DECISIONS.md`) and the code. Where this plan and an older law conflict, this plan wins and the law is amended in `DECISIONS.md`.

Task tracking lives in `docs/WOBO-TASKS.md`. Both files are updated at the end of every wave.

---

## 0. North star

Wobo is a tutor who thinks on a board while talking, for every child on every syllabus, free by default. Wobo is present on every screen, reads what the learner points at, and answers by drawing. The category reference is Brilliant.org; the bar is above it: playful in the character, professional in the chrome, flawless in execution.

Non-negotiables carried from the laws: one hit of pigment per view, no shadows, sentence case, no emoji, no exclamation marks in product copy; consent and age are capability doors; no generated fact reaches a child unverified; the learner's data is theirs and deletable.

## 1. Architecture: companion and brain

**Wobo (the companion)** is the face, senses, hands and voice. Wobo runs in the client and has full access to the nervous system. Wobo has no intelligence of their own beyond choreography and never holds a credential, a key, a model name, or a limit.

**The brain** is the gateway (`services/gateway`) and the services behind it. It decides everything: which model, what budget remains, what the learner is allowed at their consent tier, what content to compose, what Wobo may remember, what is safe to say. Free limits are enforced here and only here.

**The nervous system** (client, `packages/wobo` + `apps/web-pwa/src/wobo`):

- **Surface registry.** Every screen registers what is on it with a semantic id, a description, and the actions it supports. Shaped like WebMCP's `registerTool` so it is browser-compatible when Chrome ships it. No screenshots of our own UI, ever.
- **Scene bus.** Every interactive publishes live state (values, last action, correct model) and accepts tutor actions. Already law; the audit found seven engines with the ref never attached. Fixed in Wave 3.
- **Gesture layer.** One transparent layer over the app captures selection, circling, hover-and-hold, long-press, a desktop hotkey, and turns each into a structured focus object: the exact elements inside, their text and numbers, the owning component's state.
- **Ink renderer.** One app-wide SVG layer that draws Wobo's strokes and the learner's, anchored to registry targets, never to pixels.
- **Context packet.** Per turn: focus, screen state, route, task state, the learner's mind summary, the last turns, under a token budget.

**The seam** is the capability registry. One capability, `wobo.turn`, carries the context packet up and streams speech, ink, and actions back down. Mobile and desktop shells call the same seam unchanged.

**White-label rule.** Nothing user-facing names Classess, Claude, Gemini, OpenAI, Google, or any provider. Model ids never leave the brain. Provider errors are rewritten to Wobo's voice.

## 2. The board

The board is the medium of every explanation. The brain streams a drawing plan the way it streams words; Wobo's hand draws it stroke by stroke, timed to Wobo's voice. All SVG, generated from Wobo's own thought, exact because every number is computed by code.

**Three presentations, one grammar, one renderer:**

1. **Ink on the screen.** Wobo draws on and around whatever is there: a paused video, an outline, a setting, a sim. Anchored to what's on screen; fades like a whiteboard.
2. **The plane.** A frosted, translucent board slides in from Wobo's orb and floats over the current screen. Movable, resizable, pinnable, minimizable to a thumbnail with its ink intact. A sheet on phones. Summonable by gesture or by saying "board". Its ink persists until wiped.
3. **The full board.** Inside a lesson the board is the screen.

Wobo's rule: a pointer or one line stays on screen; a derivation or a diagram from scratch gets the plane; a lesson gets the full board. The learner can override with a word.

**The grammar** (streamed, compact): point, circle, underline, arrow, bracket, strike, number, write, erase, wipe, and shape primitives: line, polyline, curve, polygon, ellipse, axis, grid, table, label, tex, bond, atom, arrowhead, region. Every object has an id and can be re-pointed, moved, faded, or redrawn later. Layout hints only; a layout engine places objects so nothing collides.

**Domain pipelines under the grammar:** graphs and constructions from the installed math libraries; molecules from SMILES through RDKit into stroke order a chemist would draw; equations rendered to paths so Wobo genuinely writes them; physics diagrams from computed geometry; maps and cells from the existing scene specs. Every quantity passes the verifier (CAS, dimensional analysis, balance checks) before it is drawn.

**Feel:** pen physics with anticipation and settle, chalk or marker aesthetics per theme, the pen sound, handwriting in Caveat letter by letter, ink that fades, an eraser swipe, a fresh board. Wobo points before saying "this".

**Bidirectional:** the learner draws on the same board; Wobo reads their ink; moving Wobo's tangent updates the numbers. Stylus on tablets.

**The artifact:** a board has a timeline to scrub, saves to notes, and exports as a shareable image. This is the proof loop.

**Latency:** the pen starts within a second. The plan streams ahead of speech; first strokes are drawn before the first sentence finishes.

**Migration of engines:** the thirty bespoke engines become idioms of the board over time. A slider bound to a variable is a sim; a blank region with a question is a workbook. Existing engines keep working until each is absorbed.

## 3. The companion

**Senses:** screen (registry + bus), gesture (focus objects), learner (account, consent tier, mastery per topic, recent mistakes, preferred analogies, last ten turns).

**Hands:** point, act. "Show me" glides a visible cursor to the real control. "Do it" executes under the permission ladder: recommend, prepare, execute with permission, safe automatic. Anything that communicates, buys, submits, or deletes asks first.

**Voice:** push-to-talk on the orb and a desktop hotkey. No always-listening for minors. Accent follows the learner's country; American English is the fallback.

**Modes:** explain this, show me, do it, quiz me, check my work, why is this wrong, say it in my world (analogy), read it aloud, teach it back to me.

**Proactive:** when the bus shows three wrong drags or forty idle seconds, the orb leans in and offers a pointer. Governed by the quiet/balanced/proactive dial.

**Memory:** what Wobo remembers is set by the consent tier, enforced in the brain, visible and erasable on a memory page.

**Horizons after the core:** snap a homework page and Wobo grades the working; handwriting canvas with math recognition; code-switching across Hinglish and vernacular; parent mode narrating the week; vision fallback for content we did not make.

## 4. Curriculum

**Registry of boards and curricula.** A searchable global list with aliases, country, levels, and official sites: national boards, every Indian state board, NIOS, IB, Cambridge, Edexcel, AP, US states, UK nations, Australian states, Canadian provinces, common homeschool programmes. Drafted, then verified, then extended by discovery.

**Not listed? Type it and Wobo looks.** A discovery job searches for the official syllabus, fetches it, extracts the outline into our schema, cross-checks with a second model and structural checks, and saves it to the global database as provisional with provenance. The learner sees it at once with an honest label. Promotion to verified after checks pass; owner review available.

**Nothing found? They bring their own.** Paste, type, photo, PDF. Wobo structures it into a personal syllabus and builds the plan. Optionally offered to the global database as community-contributed, moderated.

**Ontology, versioned by academic year:** framework, version, level, subject, unit, topic, learning objective; provenance on every node; CASE export mapping. Never overwritten, only new versions. A freshness crawler watches official pages and diffs new releases; Wobo tells the learner what moved.

**Editable overlay.** Add, remove, reorder, "not in my school", attach a textbook. Edits live on top of the canonical version.

**On demand at every level.** Chapter list on selection, topics on open, content on open, cached and shared across boards through the canonical concept graph.

**Scope:** grades 4 to 13 wherever a board has them; school level only.

Replaces the static catalog file and the fragile "frame" system.

## 5. Content and evaluation, board-native

**Visual by default (owner law, 2026-09-03).** Pretty much everything is visual. Brilliant.org is the bar and ours is higher: their visuals are authored once for everyone; ours are drawn live, for this learner, on their own syllabus, and they can be circled, dragged and asked about. Every explanation is a board drawing, a simulation, a diagram, a graph, a construction, an animation, or an interactive; text is the caption of a visual, never the lesson. A lesson beat with no visual object is a defect, and the golden-board suite asserts that every beat carries at least one drawn object. Where a visual would not help (a definition, a name), it stays one short line beside the thing it names, never a paragraph.

Courses, practice runs, mini-workbooks, flashcards, boss battles, the daily thread, XP, the knowledge twin all stay. Each becomes board-native: a quiz is Wobo asking on the board and grading the working; a boss battle is a live problem Wobo draws and you solve on the same surface; feedback is ink on the mistake.

Evaluation upgrades: free-reasoning grading of text, voice, and handwriting; the assistance ladder that visibly fades; the "I think I'm right" re-grade; the calibration harness against human-graded sets; misconception detonation from the learner's own numbers. The audit's grading bugs are fixed in Wave 3.

## 6. Experience

**Landing page.** The board's first performance. A chalk cursor with a fading ink trace in WebGL; Wobo alive in a shader hero, eyes following the cursor; scroll-driven lesson where Wobo draws as you scroll; a live mini-board the visitor can type into; then calm editorial sections: every board on earth, the parent's weekly artifact, pricing annual-first, the invitation. Lazy-loaded, fast on cheap phones, honours reduced motion.

**Auth and legal.** Login and sign-up (Google, phone OTP), terms, privacy, user agreement, cookie and consent notice, parental consent flow for minors, deletion path. Drafted in full to DPDP and children's-data requirements; lawyer review before launch.

**Onboarding, the first five minutes.** Intro (done), then sign in first (Google or phone OTP; the account carries the name). Then one question: what are you studying right now? Text, voice, or a photo. Wobo infers board and class; one tap confirms. Then the aha: Wobo teaches one real thing on the board. Then the guided tour: Wobo walks the learner through what they can do and how, Clicky-style, pointing at the real controls (the thread, Learn, Practice, the board, the plane, asking by circling, push-to-talk), with the learner trying each. Three quick questions light the map. Interests fold into the first analogy. Board picker is a search with a "not listed? show me your syllabus" path. Returning learners see nothing. (Owner decision 2026-09-02: sign-in before the aha, not after.)

**UI raise.** One design pass through every surface against `DESIGN.md`, with Brilliant as the floor. Poppins for UI, Caveat for Wobo's hand. Fixes from the audit folded in: tokenised surfaces in both themes, one hit of pigment, chat on the home front door, reduced motion honoured, the twin as hero art, illustration and empty states with craft. Two or three screens shown to the owner before rollout.

## 7. Platforms

Web first. Store apps for iOS and Android, phones and tablets, via Capacitor (owner confirmed 2026-09-02): same codebase, native camera, microphone, push, gestures. Desktop via Tauri when wanted. No React Native rewrite; the SVG, canvas and WebAssembly engines are the asset. The empty Expo workspace becomes the Capacitor project when that wave arrives.

## 8. Operations

- Config is brand-neutral: hostnames, sender addresses, and titles come from environment, so the domain swap is one change. Until the owner buys a domain the app lives on the default Vercel URL.
- Commit and push at the end of every wave (standing permission). Deploy once towards the end, on green.
- Keys: the deploy ignore files must exclude `.env*` explicitly (Wave 2). Precautionary rotation of provider keys recommended before launch.
- Supabase project `keepraxqagzgjrrweryt` is paused; restoring it is an owner dashboard action unless the CLI is authorised.
- CI runs on `the-life`, builds the web app, runs unit and Playwright suites, and the Python suites, every push.

## 9. Model routing and cost (owner directive 2026-09-02)

Development: Fable orchestrates, designs (all UI and creative direction is Fable's hand), and writes the crown jewels; Opus does the bulk; Sonnet the cheap labour. Unrelated waves run simultaneously as dynamic workflows when their files do not overlap.

In product, the brain routes by tier, never by name to the user. Generation runs on OpenAI's GPT-5.6 family; the latest Claude models cross-check and carry the conversation; Gemini stays as is for voice and imagery. Cheaper models take everything basic. Prices are per million tokens as of September 2026 (Sol $5 in / $30 out; Terra $2 / $12; Luna $0.20 / $1.20).

| Tier | Jobs | Primary | Fallback |
|---|---|---|---|
| tiny | intent classification, routing, safety pre-screen, titles and summaries, alias and catalog matching, packet compression | `openai/gpt-5.6-luna` | `anthropic/claude-haiku-4-5` |
| turn | Wobo's conversational turns, on-screen explanations, hints, "why is this wrong" | `anthropic/claude-sonnet-5` | `openai/gpt-5.6-terra` |
| generate | board plans, lessons, practice items, workbooks, syllabus extraction, discovery jobs | `openai/gpt-5.6-terra` | `anthropic/claude-opus-5` |
| reason | synthesis boss battles, misconception detonation, first extraction of a new board's syllabus, grading escalations | `openai/gpt-5.6-sol` | `anthropic/claude-opus-5` |
| verify | second-opinion cross-check of anything generated (always the other provider); math goes through CAS first | `anthropic/claude-opus-5` | `openai/gpt-5.6-terra` |
| voice | live voice, streaming TTS | Gemini 2.5 Flash native audio (unchanged) | — |
| image | imagery SVG cannot express | Gemini 2.5 Flash Image (unchanged) | — |

**The cost rule (owner, 2026-09-02): generation goes to the cheapest model that passes verification and escalates only on failure.** Terra by default for every board plan and lesson; Sol only on a verifier or second-opinion rejection or for the hard list (synthesis bosses, misconception detonation, first extraction of a new board's syllabus). Sonnet 5 for turns; Opus 5 only as the cross-check and on escalation. Luna and Haiku take everything basic. Every escalation is logged with its reason so the hard list stays honest.

Retired from the router: Claude Opus 4.8, GPT-5.5, GPT-4.1. `claude-fable-5-1` is available on the key but reserved; it is not in the product router until a job proves it needs it. The budget meter counts every tier; free by default with metered usage, upgrade for more; only dummy prices appear in code or screens until the owner sets real ones.

## 10. Waves

Each wave ends with all gates green, a commit, a push, a screenshot proof, and an update to this plan and the task list.

| Wave | Goal | Exit criteria |
|---|---|---|
| 0 | Land the rebrand; restore Supabase | Pushed; sign-in works against the restored project |
| 1 | Lock the brain | Every gateway route authenticated or token-gated; consent tier server-derived; budget meter live; timeouts, caches, limiter fixed; SymPy sandboxed; path traversal closed; live probe shows 401s |
| 2 | Production truth | CSP correct; one vercel.json; Railway config in repo; dead hosts gone; CI on `the-life` running all suites; web tests wired |
| 3 | Main-flow bugs | Every high bug from the audit fixed with a test; per-account scoping; dark-mode literals gone from main surfaces |
| 4 | Repo cleanup | Media untracked, dead packages gone, scripts removed, `.gitignore` complete, history rewrite decided |
| 5 | The nervous system and the board | Registry on every screen; gesture layer; ink renderer with the full grammar; the plane; on-screen ink over a paused video; streaming plans from the brain; verified numbers |
| 6 | Curriculum | Board registry; discovery job; own-syllabus path; ontology with provenance; editable overlay; on-demand generation; grades 4 to 13 |
| 7 | Experience | Landing page; auth and legal; new onboarding; UI raise across every surface; board-native content and evaluation |
| 8 | Platforms and launch | Capacitor apps; store assets; final deploy; launch checklist |
| 9 | Horizons | Homework snap, handwriting canvas, parent mode, vernacular, vision fallback |

Waves 1 to 4 are short and unglamorous; they are the difference between a demo and a product. Waves 5 and 6 are the product. Wave 7 is the release.

## 11. Risks

- **Invented syllabi.** Provenance is mandatory; anything without an official source is labelled draft and editable.
- **Cost of a continuous companion.** The budget meter and the cheap-model router are built in Wave 1, before the companion exists.
- **Board latency.** Streaming plans and drawing ahead of speech; measured on a cheap Android phone, not a laptop.
- **Handwriting quality.** Glyph-to-stroke conversion done properly rather than faked; validated on tablets.
- **Children's data.** Consent tiers enforced in the brain; memory visible and erasable; deletion model implemented, not documented.
- **Scope.** Every wave has exit criteria; nothing starts on ambiguity between waves.

## 12. Owner actions

1. Restore the Supabase project (dashboard) if the CLI path fails.
2. Buy the domain and say the word; the swap is one config change.
3. Rotate provider keys before launch as a precaution.
4. Lawyer review of the legal drafts before launch.
5. Real prices when ready; dummy values until then.
6. A launch date or event, if one exists, so polish is sequenced right.

## 13. Replace, don't patch (owner law, 2026-09-02)

Any UI, code, logic, schema, or structure that is not ours any more or is slated for rebuild is not fixed or polished; it is rewritten better, once, in the wave that owns it. With zero users on the restored database, interim fixes to soon-dead code are waste. Concretely: the old course players, home stops, Learn/Subject/Practice/You screens, the onboarding, the static catalog and "frame" system, the thirty bespoke engines, the chrome components, the dead UI package, and the old content-composer layer of the gateway are superseded by Waves 5 to 7; audit tasks in those files are marked superseded rather than fixed. What survives and is fixed in place: the SDK, the nervous-system substrate (bus, presence, speech), the shell (router, store, download center), the gateway core (auth, routing, registry, voice, safety, email, cache, providers), the verifiers and the cache store, the render worker, contracts, deploy config, CI, and repo hygiene. Security findings are never superseded; they are closed in Wave 1 regardless of the file's future.

## 14. Growth and marketing, built in (owner directive, 2026-09-02)

Marketing is a product surface, not a campaign. Every tactic is behaviour-timed, honest, and aimed at the person who pays, the parent, never at pressuring a child. Uniform pricing for everyone stays law; what varies by behaviour is the **gift**, the timing, and the framing, which keeps us on the right side of the "adapt everything but price" rule and of a children's-product reputation.

- **The parent link.** In settings, a learner (or parent) creates a parent link: a weekly, beautiful, WhatsApp-native progress artifact drawn from the child's own boards. The share page is the upgrade surface: what the child mastered, what Plus would unlock next, one calm button. "Show mom what I just cracked" fires it from a victory.
- **Behaviour-timed offers (gifts, not discounts).** Visited the payment page and left: a gifted Plus week, same for everyone in that state. Strong streak and real mastery: surprise generosity, unannounced free Plus days. Exam season: unlimited weekends to taste then lose. Anniversary and milestones: titles of self, not coupons.
- **Cancelling is not a growth surface.** SUPERSEDED by the owner's ruling of 4 September 2026 ("we dont do refunds, they can cancel if they want to"), which this section previously contradicted: there is NO save flow, no pause, no downgrade and no gifted month on the way out. A payer who cannot get money back must not also be made to argue their way out. Two taps and one plain confirmation, specified in `docs/copy/growth/cancel-flow.md` and built in `apps/web-pwa/src/screens/you/PlanPanel.tsx`. Any lever placed between a payer and the exit is a dark pattern this plan's own compliance rail forbids two bullets below.
- **Paywall timing.** The ask lands just before the wow it unlocks, at the emotional peak, framed as pushing limits, never on a timer; annual-first; charm pricing; decoy tiers; real numbers only when the owner sets them.
- **Share loops.** The challenge loop (share a hard problem, never the answer, WhatsApp-native) for acquisition; the proof loop (the board as a branded mastery image) for credibility; referrals rewarded in learning, not cash.
- **Lifecycle.** Email, push, and WhatsApp on progress moments: welcome, first aha, first board saved, first boss, streak with taste, win-back after seven quiet days, exam-calendar surges. Preferences, unsubscribe, no schedule-driven nagging.
- **Acquisition.** Programmatic SEO pages per board, class, subject and chapter with a live mini-board on each; the landing page as the board's first performance; app-store optimisation; build-in-public; velvet-rope invites with insider lore at launch.
- **The engine underneath.** Every lever flaggable and A/B-testable; the adaptive tactic engine selects copy, reward type, framing and timing per archetype; attribution and cohort retention tracked; a fraud and integrity layer on referrals and sponsored seats.
- **Compliance rails.** Marketing consent lives with the parent for minors; DPDP-clean; no dark patterns in cancel flows; every message has an off switch.

### 14.1 Hospitality (owner law, 2026-09-03)

Experience, design and relevance make the business; frequency, assurance, reminding and confirming, and the other kinds of hospitality are how we win. We celebrate wins with the learner all along the way, we praise, we motivate, we wish them well on their festivals, and we are there for them even when they never asked, building the trust that we can take care of them. Concretely:

- **Confirm everything.** Every action gets an acknowledgement in the product and, when it matters, an email: sign-up, first lesson, plan change, payment, parent link, streak saved, flag received, flag fixed, account changes.
- **Remind with care.** Reminders arrive at the learner's own time, in Wobo's voice, with the thing they were doing pictured; frequency is a visible dial the learner and the parent can set; never a generic nag.
- **Reassure.** Weekly summaries to parents in Wobo's voice; "your place is saved"; receipts that explain; cancel flows that thank and keep the door open; a note when something we broke is fixed.
- **Celebrate along the way.** First lesson, first week, first month, a unit finished, a boss beaten, a streak milestone, a personal best, a hard topic cracked: Wobo marks it on the spot (a drawn flourish, a line in the learner's name) and the parent hears about the big ones.
- **Praise and motivate.** Praise is specific and about behaviour (asked for help after a miss, came back after a gap, tried a harder one), never empty; motivation is a picture of the next small step, not pressure.
- **Festivals.** Wishes on the learner's own festivals by country and calendar (Diwali, Holi, Eid, Christmas, Pongal, Onam, Navratri, Dussehra, Chinese New Year, Ramadan, Vaisakhi, the regional new years, exam-result days, birthdays) in Wobo's hand, with the seasonal gift framing from §14 where a plan is in view; the price never varies, the gift and the moment do.
- **There unasked.** Check-ins after a hard week, before an exam the syllabus calendar knows about, after a silence, after a wrong-answer streak; a parent nudge when a child has gone quiet. All of it opt-out in one tap, respectful of school hours and sleep, and never more than the dial allows.
- **Relevance gate.** Anything that is not about this learner's syllabus, class, last lesson or their own calendar does not send.
- **Hyperlocal, never broadcast (owner, 2026-09-03).** Relevance is local to the one learner: a wish for Janmashtami goes to a family in Mathura who told us they celebrate it, not to a learner in Nairobi. The rules: (1) the base calendar comes from the learner's country and state or region (public holidays, school calendar, board exam windows); (2) religious and cultural festivals are wished only when the family has chosen them in "Festivals we can wish you on" (onboarding and settings; a parent chooses for a child under the consent age), never inferred from a name, a language, a board, or a place; (3) that chosen list is sensitive data: explicit opt-in, shown in plain words what it is used for, used for nothing else, deletable in one tap, covered by the privacy policy as a special category; (4) currency, time zone, school hours, quiet hours and exam windows follow the same locality, but WORDS do not: product copy is plain English everywhere, "your parent", "your family", or the name the family gave us, never regional kinship or cultural words (no "Amma", "Ammi", "Mummy", "Mum" variants), because language and religion are entangled in our first market and we do not play there; (5) when locality is unknown or ambiguous, nothing sends. The hospitality calendar carries country and region tags and a `requires_opt_in` flag on every religious or cultural entry so the engine cannot broadcast by accident.

**Prices (owner, 2026-09-03).** Free every day with a daily allowance. Pro ₹1,999 a month for five times the free allowance; Max ₹3,999 a month for twenty times. Outside India, Pro $20 and Max $50 a month, chosen by the learner's country. Billed monthly, cancel anytime. The price never varies by behaviour; only the gifts and the framing do (§14).

## 15. Every element earns its place (owner law, 2026-09-03)

User experience is one of the highest priorities. Everything on every page must make sense and have a valid reason to be there. Valid reasons are three: it serves a learner task; it carries the brand or the character (the cool factor, the moment that makes someone smile, Wobo doing something delightful); or it is simply nice to have there and someone can say why. What goes is the irrelevant: leftovers, chrome nobody would miss, controls that duplicate another, copy that explains nothing. Concretely: for every screen we ship, an element inventory names each visible thing (control, label, chip, card, line of copy, animation) with its reason in one of the three kinds; anything without one is removed, not restyled. One screen, one intention (DESIGN.md law 1); the simple thing first, depth on request (law 6). Copy is written from the learner's side of the screen and says exactly what happens. Every wave's QA includes this audit; the Wave 7 UI raise starts from the inventory, not from the existing layout. The owner reviews the inventory for the main surfaces before rollout.

## 16. What we take from Brilliant, and where we go past it

The owner walked Brilliant end to end on 2026-09-03 (44 screenshots, About and Gift pages) and set it as the floor. What we take, what we change, and where Wobo goes further:

**Answering is doing.** Brilliant's best move is that the answer is a manipulation of the thing itself: shade half the square, drop a point on the grid, tap digits into a coordinate, use a maths keyboard for fractions and roots. Ours: every practice item has an interactive answer kind chosen by the brain, never a text choice where a visual act exists. The answer kinds we ship: shade regions, place or drag points, drag a slider, order or match, build with a number pad or expression keyboard, draw a line or angle on the board, circle the part, choose among visuals. "Start over" always beside the interactive; "Check" is the one primary control; keyboard and screen-reader paths for each. Onboarding's placement uses these same kinds, so the first test already looks like the product, with the spacing and rhythm of a finished page, not a form.

**Hand-held explanations.** Brilliant's tutor, when the learner is wrong, says "Not quite, but that's okay", offers "Get help" and "Try again", asks a Socratic question, offers a "Why was my answer wrong?" chip, reveals the answer after two misses with "Want to learn why?", then walks it step by step with small choice buttons (1 / −1 / both) and highlights the relevant region of the screen as it talks. Ours does all of that, and the highlight is Wobo drawing on the very control: the ring on the shaded square, the arrow at the point Wobo means, the equation written in Wobo's hand beside the graph. Copy laws hold: no exclamation marks, no emoji, warm and short. State reads at a glance: the frame hairline and Wobo's expression change for right, wrong and thinking; a tick or a small wobble is drawn by Wobo's hand, never a colour flood.

**Never lose progress.** Brilliant threatens: "If you quit, you will lose your progress and XP." We save every step, so leaving says "Leave for now? Your place is saved." Honesty is a feature.

**The loader is the character.** Brilliant loads with its mascot on a beam of light. Wobo loads by drawing: a pen line that becomes the page's first hairline, then Wobo's body settles into the orb. One motion, under a second, reduced-motion safe.

**Flag anything.** Brilliant has a flag on every problem that opens a ticket with an automatic screenshot, annotation tools (pen, circle, rectangle, blur), ticket type (bug, question, improvement), screen recording and file attach. Ours: a quiet flag on every content unit, the screenshot taken by our own renderer, annotation with Wobo's ink tools, a blur tool for privacy, type, description, and Wobo can raise the same flag by voice ("this is wrong"). Flags land in a table the owner can read and an email digest; the learner sees a thank you and, when fixed, a note.

**Help that is mostly Wobo, plus a real help centre.** Brilliant has a searchable help centre in three columns (basics, product features, courses and curriculum) with illustrated articles, and settings for account, plan and preferences (appearance auto/light/dark, reduce motion on/off/auto, narration toggle, sound effects toggle, email notifications by category, verified email, add email, password). Ours ships all of those pages, written for Wobo, and Wobo answers help questions grounded on that content before a page is ever needed. We add: voice and accent, language, the parent link, data and privacy (export, delete), consent, and the plan.

**Plans, checkout and gifts.** Brilliant's upgrade surfaces: a benefits table (free versus premium with ticks and crosses), three price cards (monthly, annual with strike-through and "most popular", family with six seats), an honest billing footnote, checkout with Apple Pay and card, country, and two explicit consent checkboxes (terms and privacy; the recurring-charge disclosure naming the amount, renewal and cancellation). Also a "keys left today" allowance widget, per-feature upsell modals ("only on Premium"), a seasonal discount banner, and a gift page with testimonials and "great gift for" cards. Ours keeps the table, the three cards, the footnote, the consent checkboxes (they are legally right), the allowance widget (ours is "turns left today" with a real reset time), the gift page and per-feature moments, all under §14's rule: the price never varies, the framing does, and no manipulation of minors.

**Home and courses.** Brilliant's home: a search box ("What do you want to learn?") that opens an ask panel with clarifying chips and recommends a lesson card; attachments with the safety line "Never share pictures of people or personal info"; a streak widget; the current course card with level and lesson list; grade-banded learning paths with progress bars, "New" badges and favourites. Ours: the ask box is Wobo; the clarifying chips and the recommended card come from the brain against the learner's own syllabus; the safety line stays verbatim in spirit; paths are the learner's board and class, not a generic ladder.

**Progress in the tutor's voice.** Brilliant's "You" page: a week/month/year toggle, "This week's summary" written by the tutor ("You asked me 6 questions this week, which tells me you're working through problems instead of skipping them"), activity snapshot, problems-solved chart, learning progress, and learning strengths as behaviour-based praise (resilience: asked for help after a wrong answer; initiative: asked on your own). Ours: the same page in Wobo's voice, the same behaviour-based strengths, drawn charts in Wobo's hand, and the parent link shares this page read-only.

**About and mission.** Brilliant's About: mission headline, "what we do", "our approach" with a real growth chart, "our learners", "what we teach" as a concept map, accreditation, method accordion, reading list, careers, kidSAFE membership. Ours ships an About page with a mission, how Wobo teaches (drawn live), what we cover (the boards), our promises (privacy, honesty, no manipulation), and the legal set. The concept map on their About page is exactly our curriculum concept graph; we can draw ours live.

**Where we go past them.** Their visuals are authored once for everyone; ours are drawn live for this learner on their own syllabus. Their tutor highlights; ours draws, on any screen, including a paused film. Their curriculum is a fixed ladder; ours is every board on earth on demand. Their character reacts; ours has idle life, gaze, hands and a voice.

## 17. Rebrand everywhere, and white-label all the way down

Wobo is the name in every account and every artefact, not only in the product: the GitHub repository, the Vercel project, the Railway project and service, the Supabase project, package names, Python modules, environment variable prefixes, storage keys, cache names, email sender, OAuth app names, app store listings. "Classess" survives nowhere.

White-label means nobody using or inspecting the product can tell which models or vendors are underneath. Concretely: no provider or model name in any response, error, header, log the client can see, bundle string, email, or legal page beyond the generic "third-party AI and infrastructure providers" that privacy law needs; server and framework headers stripped; generic error bodies; OpenAPI off; source maps off in production; voice names and model tiers exposed only as Wobo's own words ("thinking harder"); no vendor SDK names in user-facing strings. What a custom domain alone can hide: hosting-provider hostnames and headers, and the database host (proxied through our domain or a fronting CDN). Until the domain exists, those two are visible to anyone who opens the network tab; the domain wave closes them.

## 18. Device agnostic, and handcrafted for one person

Every surface works on a phone in portrait, a tablet in either orientation, a laptop, and a large monitor, with touch, mouse, stylus and keyboard, with a screen reader and with reduced motion. Nothing is "desktop first" or "mobile first"; the layout is composed per breakpoint, and every proof we take is taken at three widths (360, 820, 1440) and both themes. Board ink, the plane and the gesture layer follow the same rule: on a phone the plane is a sheet, the lasso is a finger, hold-to-talk is a long press.

And the whole thing feels handcrafted for the one learner using it: Wobo's hand on the board, their name in Wobo's mouth, their syllabus, their board and class, their pace; copy that reads like a person wrote it for them; nothing that looks poured out of a template. Personalised is not a settings toggle, it is the default state of every page.

## 19. Wobo has no gender

Wobo is a wobot, not a boy or a girl (owner, 2026-09-03). Rules for every word we write or generate: use the name first ("Wobo draws", "ask Wobo"); when a pronoun is unavoidable use they/them; never she/her or he/him, in product copy, prompts, docs, code comments, tests, marketing and legal; Wobo speaks of itself as "I"; if a learner asks, Wobo says it is a wobot and neither, warmly and briefly, and moves on. The voice is chosen for clarity and warmth, not to signal a gender, and no copy describes it as one. Everything written before this date is rewritten to comply (a repo-wide pass with a grep gate in CI for "she "/"her " near "Wobo").

## 20. Neutral by default

Anything controversial, we stay neutral or we do not go there (owner, 2026-09-03). Wobo teaches; it does not take sides. Rules:

- **Teach the syllabus as the board states it.** Where a question is contested (religion, politics, caste, community, nationality, contested history, borders, gender debates, current affairs), Wobo says what the learner's own syllabus says, notes plainly that people disagree, and does not add an opinion. It never ranks religions, parties, communities or countries, never jokes about them, and never uses them in examples.
- **Maps and symbols.** When Wobo draws a map, it draws the learner's country as that country's own government publishes it, and marketing never draws contested borders at all. National symbols, anthems and flags appear only as the syllabus requires.
- **Words.** Plain English everywhere; no regional kinship or cultural words; no religious greetings unless the family chose that festival (§14.1); no slang that belongs to one community.
- **Marketing and hospitality.** No festival, day or cause is used to sell unless it is on the family's chosen list or is a public holiday in their region; no political or national-pride framing; birthdays and learning milestones are the safe defaults for celebration.
- **Safety and prompts.** The persona prompt, the board planner and the safety screen carry this rule: a neutrality clause in the prompts, a "contested topic" classifier that switches Wobo to the syllabus-only register, and a test set of contested prompts per subject that must produce syllabus-anchored, opinion-free answers.
- **When in doubt, leave it out.** A line that could be read as taking a side does not ship.
