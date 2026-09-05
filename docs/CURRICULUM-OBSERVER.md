# The syllabus observer

**The owner, 2026-09-05:** *"it's worth verifying from the web the first time a user selects a board,
and I need you to build an observer of flag reports and edits that were happening for those syllabi
so that you can correct them based on the similarity of edits, while referring the web and the LLM
knowledge to conclude what would be the ideal syllabus to show when asked in the future; and it has
to be kept in mind that the syllabus may or may not change every year."*

That is a self-correcting syllabus with three witnesses: the board's own document, what learners
collectively change, and the model's judgment. Versioned by year. The learner's own edits stay
theirs; the canonical version improves for everyone after them.

---

## 1. The three witnesses, and their rank

1. **The board's document** is the source of truth when it can be read. Nothing outranks a
   chapter that is plainly on the board's own page.
2. **Learner consensus** is evidence that our READING of the document is wrong, or that the
   document changed and we did not notice. It never outranks the document; it triggers a re-read.
3. **The model** never decides alone. It reconciles: given the document, the current reading and
   the consensus, it says which reading matches the document and where they differ. Its output is
   a proposed reading with citations into the document, or "cannot conclude".

A correction is applied only when witness 1 confirms it, or witnesses 2 and 3 agree and witness 1
is unreachable, and then it is marked so.

## 2. First selection verifies from the web

The first time any learner selects a (board, class, subject) that is provisional, the verify pass
runs against the board's document before the chapter list is shown, budget-capped, with an honest
line while it runs. The second learner is served from the verified reading. This is the freshness
rule already in the code ("re-checked when a second learner arrives"), moved one learner earlier.

If the document cannot be reached, the provisional reading is shown, marked as such in one plain
line, and the own-syllabus door is open beside it.

## 3. What the observer watches, anonymously

Two signals, both already recorded:

- **Edits.** Every overlay op (add, remove, rename, reorder, not-in-my-school, attach) keyed by
  canonical node id per (version). The observer counts ops per (version, node, op, normalised
  value). It never stores who. The learner's overlay is theirs under the memory law; the count is
  ours.
- **Flags.** `ops.reports` with reason `not_my_syllabus`, which must carry `version_id` and
  `node_id` in `about` so a flag points at the exact chapter. A flag with no pointer counts for the
  version, not a node.

The unit of observation is the (version, node). The observer asks: of the learners on this
version, what share have done the same thing to this node?

## 4. When consensus is a signal

Relative, never absolute. One learner removing a chapter is a school that skips it. The thresholds:

| Signal | Reads as | Threshold |
|---|---|---|
| `remove` or `not_in_my_school` on one node | the chapter may not be in the board's syllabus | 35% of learners on the version, minimum 12 learners |
| `add` with the same normalised name under one parent | the board has a chapter we lack | 35%, minimum 12, and the names agree after normalisation |
| `rename` converging on one name | our name for the chapter is wrong | 50%, minimum 12 |
| `reorder` converging on one order | our order is wrong | 50%, minimum 12 |
| `not_my_syllabus` flags on one node | as `remove` | counted with removes |

Below the minimum, nothing happens: a syllabus with four learners can never be corrected by
consensus, only by the document. "Not in my school" is counted with `remove` for the trigger but
recorded separately, because a chapter many schools skip is a different fact from a chapter the
board dropped, and the model is told which it was.

## 5. What happens at the threshold

1. **Re-read the document** (witness 1). Fetch the board's document fresh; compare the hash to the
   version's `document_hash`.
   - Hash changed: the document moved. Run discovery into a **new version** with `supersedes`,
     exactly as the freshness path does. Consensus was right because the world changed.
   - Hash same: our reading is in question. Continue.
2. **Ask the model to reconcile** (witness 3): the document text, our current reading, the
   consensus ops, and the question "which reading matches the document, and where do they differ?
   Cite the page for every difference." Output is a proposed reading with citations, or
   "cannot conclude".
3. **Decide:**
   - Proposed reading is cited into the document and matches consensus: **mint a new version**
     with `supersedes`, status `verified`, provenance naming the document, the consensus signal
     and the model, and the diff. Learners' overlays re-apply; each learner sees one line per
     change in their own terms, as the freshness path already promises.
   - Proposed reading disagrees with consensus, or cannot conclude: **review queue**, with the
     full dossier. A person decides. Nothing changes for learners.
   - Document unreachable and consensus strong (50%+, minimum 30): mint the version with status
     `community`, marked so, and queue the re-read for when the host answers.
4. **Never in place.** A correction is always a new version. The old one stays, with its
   provenance, so a wrong correction can be reverted by pointing back.

## 6. Poisoning, and why the thresholds are relative

One person with many accounts can manufacture consensus. Defences, all required:

- Counts are per learner, not per op: a hundred edits from one account are one vote.
- The minimum is in learners, and a learner counts only after real use of that syllabus (at least
  one turn on a topic in it), so an account made to vote does not count.
- The document always gets the final read. Consensus can only trigger a re-read; it cannot write
  a chapter the document does not contain, except into `community` status, which is labelled.
- The audit trail names the signal. A version minted from consensus says so in provenance, and the
  admin console shows it.

## 7. The year

- Versions are labelled by academic year already (`versions.label`, '2026-27'). A consensus
  correction within a year is a new version with the same year label and a patch note; a new
  year is a fresh discovery, and consensus from last year does not carry across, because the board
  may have made exactly the change learners were asking for.
- The freshness re-fetch at release windows stays. The observer is a second trigger for the same
  machinery, not a replacement for it.
- Overlays re-apply across a year boundary with a report, as they already do; a consensus-minted
  version is no different to a learner than a board-minted one.

## 8. What the owner sees

In the console: per version, the learner count, the top consensus signals with their share, what
the observer did (re-read, minted, queued, nothing), and the diff of any minted version. And a
switch to require review for every correction, for the first months, until the observer has earned
trust.

---

## 9. As built (2026-09-05)

`services/gateway/src/wobo_gateway/curriculum/observer.py`, migration `0022_curriculum_observer`,
and the desk in `desks_api.py`. Where the build had to choose, it chose this:

- **The count is a keyed digest, never a subject id** (`observer.voter_hash`, HMAC under
  `OBSERVER_PEPPER` or the service-role key, the construction `reports.handle` uses). The schema
  checks the columns are digests. One row per (version, node, op, learner) is a unique constraint,
  and the `observer_signals` view counts a vote only joined to a row in `observer_use`.
- **Real use** is one `wobo.turn` with `context.curriculum.nodeId` naming a topic we hold, from a
  signed-in session. Anonymous sessions never count, because a subject you can mint is not a
  learner. The share's denominator is learners of the same subject of the same version, not of the
  whole edition.
- **The minting path is the freshness path.** The re-read is `freshness.run_freshness_check`
  itself, and a reconciled correction goes through `run_discovery(..., supersedes=)` with the
  proposed reading handed in at the generate seam, so it passes the parser, every structural check
  and the second reader exactly as any extraction does. The only version made any other way is a
  `community` one, and it says so in its status, its label and its provenance.
- **The model never decides alone, in code.** Its differences must cite a page of the document,
  its proposed reading must parse with citations and pass the structural checks, and whether that
  reading matches the consensus is decided by `matches_consensus`, never by the model's own claim.
- **The switch** lives in `curriculum.observer_settings`; a missing row is ON. Only an owner
  (`admin.manage`) turns it off, and the trail carries the flip.
- **The scheduler** is `observer.tick(job_store, budget=)`, one call the discovery worker makes
  on its cadence with its own job store and budget. It runs `run_pass`, bounded to three subjects
  and five minutes per tick, and refuses unless `WOBO_DISCOVERY_WORKER` is on. The worker loop is
  the discovery worker's, not a second one; until that loop ships, nothing here moves, and the
  desk says so.
- **Production** has the migration written, not applied: `curriculum.observer_*` holds no tables
  yet, and the hooks say "not counting" once in the log and never cost a learner an edit.
