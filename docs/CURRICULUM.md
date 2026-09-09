# CURRICULUM.md — every board on earth, on demand

The contract for Wave 6. Companion to `docs/WOBO-PLAN.md` §4 and `docs/BOARD.md`. Law for anything that touches what a learner studies.

## 1. The idea in one paragraph

A learner types the name of their board or curriculum and picks it from a global list. If it is not there, they type it anyway and the brain goes looking for the official syllabus, extracts it into our schema, checks it, and saves it to the global registry as provisional with its source attached, so the next learner from that board gets it instantly. If nothing official exists, the learner shows Wobo their own syllabus and Wobo builds a personal one. Everything below the framework is generated lazily: chapters on selection, topics on open, content on open. Every node carries provenance and an honest label. The learner's edits sit on top of the canonical version and survive updates. Board topics map onto one canonical concept graph so generated content is reused across boards.

## 2. Ontology

```
framework        one board, programme, or curriculum (CBSE, ICSE, NIOS, IB DP, Cambridge IGCSE, Texas TEKS, UK National Curriculum, a homeschool programme, or a learner's personal syllabus)
  version        one academic year or edition of that framework; immutable once published
    level        a class, grade, year, or stage ("Class 9", "Grade 10", "Year 11", "IGCSE")
      subject    ("Mathematics", "Science", "Social Science", "Physics" …)
        unit     chapter, module, or theme, in the framework's own order
          topic  the unit of study a learner opens; maps to concept nodes
            objective   a learning objective or outcome, in the framework's own words when available
```

Every node has: `id` (stable, opaque), `name`, `aliases[]`, `order`, `source_ref` (document URL + page or section), `provenance` (§5), and `concept_ids[]` on topics (§7). Frameworks also carry `kind` (national | state | international | open | homeschool | online | personal), `country`, `region`, `languages[]`, `levels[]` (4 to 13 where the board has them), `official_site`, `status` (verified | provisional | community | personal).

Nothing is ever edited in place after publication. A new academic year is a new `version`. A correction to a published version is a new version with a `supersedes` pointer. Learners are pinned to a version and offered the upgrade with a diff.

## 3. The registry

A searchable global list of frameworks, seeded before launch and extended by discovery:

- **Seed:** every Indian national and state board and NIOS; IB (PYP, MYP, DP); Cambridge (Primary, Lower Secondary, IGCSE, O and A Level); Edexcel; AP; every US state; England, Scotland, Wales, Northern Ireland; every Australian state; every Canadian province; Singapore; Hong Kong; South Africa; the UAE and GCC boards commonly followed by Indian families abroad; the common homeschool programmes. Names, aliases, country, levels and the official site only. Drafted by a model, verified against the official site by a second pass, then marked `verified` at the framework level (not yet at the syllabus level).
- **Search:** type-ahead over names and aliases, fuzzy, with the learner's country hinted from locale. The "not listed? tell me" path is always visible and never more than one tap away.
- **Structured sources first:** where a machine-readable source exists it is imported rather than extracted: 1EdTech CASE frameworks (US states, Rosetta Exchange), the Common Standards Project API, Oak National Academy's open API (England), DIKSHA/Sunbird framework taxonomies (India). Extraction from PDFs is the fallback, not the default.

## 4. The discovery job

Triggered when a learner types a framework that is not in the registry, or opens a level or subject whose syllabus is not yet stored.

1. **Search.** The brain's search capability queries for the official syllabus document (board site first, then known aggregators). Budgeted: a small number of queries, a wall-clock ceiling.
2. **Fetch and extract.** HTML or PDF → text with page anchors → the generate tier turns it into the schema as strict JSON, keeping `source_ref` on every node.
3. **Check.** The verify tier (the other provider) re-reads the source and the extraction independently; structural checks run in code: unit counts against the document's own table of contents, level coverage, duplicate and empty nodes, name sanity, ordering. Anything failing is redrawn once, then refused.
4. **Store.** Saved as `provisional` with the full provenance and the source document hash. The learner sees it immediately with the honest label. The next learner from the same framework and level gets it from the registry, never a second discovery.
5. **Promote.** `verified` when the checks passed and two different learners have used it without structural edits, or when the owner reviews it in the review queue. Anything flagged stays provisional.
6. **Fail honestly.** If nothing official is found inside the budget, Wobo says so in one line and offers the own-syllabus path immediately. Wobo never invents a syllabus.

## 5. Provenance and labels

Every node's provenance records: `source_url`, `source_page_or_section`, `document_hash`, `fetched_at`, `extractor_model`, `verifier_model`, `checks_passed[]`, `verified_at`, `verified_by` (system | owner | community).

The label the learner sees is derived from status, in plain language, never a badge with a number:

| Status | Label |
|---|---|
| verified | Official CBSE 2026-27, verified |
| provisional | Found on the board's site, still checking |
| community | Shared by another learner, not yet checked |
| personal | Drafted from your syllabus, check it |

## 6. The learner's own syllabus and the overlay

- **Own syllabus:** paste, type, a photo of a page or timetable (camera or upload), or a PDF. The generate tier structures it into a personal framework (`kind: personal`); the learner confirms with one tap per unit. Personal frameworks belong to the learner and are never shared unless they choose to offer them to the registry as `community`, where moderation applies.
- **Overlay:** on any framework, the learner can add, remove, reorder, rename, mark a topic "not in my school", and attach their own textbook. Edits are stored as an overlay keyed by the canonical node ids, never by mutating the canonical version, so a version upgrade re-applies them and reports what no longer matches.
- **Diff on upgrade:** when a new version is published, Wobo tells the learner what moved, in one line per change, and offers to switch.

## 7. The concept graph

Topics from every framework map onto one canonical concept graph (the existing prerequisite graph, extended). Two boards that teach "linear equations in one variable" share a concept node, so a lesson generated for one learner is cached against the concept and reused for the other, personalised at the cheap tier. Mapping is proposed by the generate tier, confirmed by structural checks (same objectives, same level band) and by usage. The graph is what makes the free tier affordable across boards; it is also what powers prerequisite gates, bridges, and the twin.

## 8. On demand at every level

| Action | What is generated | Cached where |
|---|---|---|
| framework chosen | nothing (the registry entry exists) | — |
| level and subject opened | the unit list (from the stored syllabus; discovery if missing) | registry |
| unit opened | the topic list with objectives | registry |
| topic opened | the board performance: cards, sims, practice, boss (BOARD.md) | content cache keyed by concept |
| practice or boss | items, verified | content cache keyed by concept |

Nothing is generated in bulk. First learner pays, the next thousand reuse.

## 9. Freshness

A scheduled job re-fetches each verified framework's official document monthly and at the known release windows, compares the hash, and if changed runs discovery into a new version. Wobo tells affected learners what moved. Provisional and community frameworks are re-checked when a second learner arrives.

## 10. Storage

A `curriculum` schema in Supabase: `frameworks`, `versions`, `nodes` (level, subject, unit, topic, objective in one table with `kind` and `parent_id`), `provenance`, `concept_map` (node → concept), `overlays` (subject_id, version_id, patch), `discovery_jobs` (state machine, budget, result), `review_queue`. Read for all authenticated learners on public rows; personal frameworks and overlays under per-subject RLS; writes only by the service role through the brain. Indexed for type-ahead. The static catalog file and the client "frame" system are deleted once the registry serves the seeded boards; the client caches the learner's pinned version for offline.

## 11. Scope and honesty

Grades 4 to 13 wherever a framework has them; school level only. English first; framework names and node names keep their original language alongside an English rendering. The system prefers refusing to inventing: a missing syllabus is a clear message and a door to the own-syllabus path, never a plausible fabrication.

## 12. What kills it

A syllabus with no source. A node edited in place. A learner's edits lost on upgrade. Bulk generation. A second discovery for a framework that is already stored. A label that overstates what we know.

## 13. The open door: the syllabus a stranger may read

`GET /v1/syllabus` (`curriculum/public.py`). One open, cached, rate-limited read, and the only curriculum surface that takes no token. Every public chapter page on the site is built from it (docs/GROWTH-SEARCH.md §3), and it is what lets the ask box at the bottom of one of those pages answer about that chapter.

**One path, four depths.** No query is the boards we publish; `?board=` is that board's classes; `&class=` its subjects; `&subject=` its chapters; `&chapter=` its topics. Naming a deeper part without the part above it is a 400, and a path we do not hold is a real 404, not a page that says nothing. Every layer is addressed by a slug derived from the board's own words, unique among its siblings, and stable, because a page keeps its address.

**What every node carries.** The name, its children, and the provenance: the official document's URL, the page or section inside it, the hash of the bytes we read, when we read them, the named checks that passed, and the honest label from §5. It also carries `publishable`, which is true only when both the document and its hash are on file — the bar a page must clear to ship, said once here so no page family has to invent the rule. The extractor and the verifier never leave the brain (WOBO-PLAN §17).

**What it will not serve.** A personal syllabus, a community one, or a framework we have not read: only `verified` and `provisional`, and only when there is a chapter under it. No subject, no overlay, no pin, no write. Objectives are not a page family and never leave the store.

**Cached hard, bounded anyway.** The tree is built once per process and held for `SYLLABUS_TREE_TTL_S`; the answer carries a long `Cache-Control` and an `ETag`, and a matching `If-None-Match` is a 304. A syllabus changes when a version is published, which is rare. Open is still not free: the path is on the door's stranger dial, per address, exactly like the public ask box.

**The corpus behind the ask box.** The same tree becomes one grounding entry per chapter and per topic (`ask_public.SyllabusIndex`): the name, where it sits, and the fact that we read it from an official document. Names and provenance only — the syllabus says what is taught, not what it says. The help centre answers first and always; a question no article covers reaches the syllabus; a question neither corpus covers still gets the honest line, and the screens on the way in and the way out are unchanged.

## 14. The frozen copy the website is built from

`uv run python -m wobo_gateway.curriculum.snapshot` writes the whole publishable tree to
`apps/web-pwa/src/screens/syllabus/syllabus.json`, through the same `build_tree` §13 serves, from
the seed under `content/curriculum/`. It is a committed artefact and
`tests/test_syllabus_snapshot.py` re-derives it, so it cannot drift: when a board publishes a new
edition, regenerate it in the same change as the seed.

**Why a file and not a fetch.** The site is built, not served. One real HTML file is pre-rendered
per public address and the sitemap is generated from the same list, so a build that read a thousand
pages over the network would ship a thousand empty ones the first time the gateway was slow, and
the count it published would be whatever the network returned rather than the count we can prove
(WOBO-TASKS §10.21). The open door is still read at runtime by every page (`syllabus/door.ts`): the
file renders the page and the door corrects it, which is what keeps a page already in front of a
reader right when an edition changes between deploys.

**The shape.** Provenance records are interned, and the lists of check names inside them are
interned again: 1,044 nodes carry 678 distinct records naming 8 distinct check lists between them,
so the file is about 290 kB and 33 kB over the wire. It travels in the syllabus pages' own chunk
and nothing else on the site pays for it.
