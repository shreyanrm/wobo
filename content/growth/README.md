# The demand data the growth desk gathers from

Four files. Three are data with their own provenance, one is the harvester that produced the first
of them. `manifest.json` carries the counts and the hash of each, and
`services/gateway/tests/test_growth_demand.py` fails if a file and its manifest row disagree, so a
number printed anywhere downstream is a number somebody can check.

| File | What it holds | Where it came from |
|---|---|---|
| `harvest.json` | 17,928 real queries, each with the engines that suggested it (`g`, `b`) | Google and Bing autocomplete for India, 2026-09-09 |
| `curriculum.json` | 1,044 syllabus rows: 333 units and 711 topics across four boards | the seed in `content/curriculum/syllabi`, as it stood on 2026-09-09 |
| `manifest.json` | counts, hashes, sources and the day each was read | written beside the files it describes |
| `harvest.py` | the harvester, so the snapshot is reproducible rather than remembered | `python3 content/growth/harvest.py content/growth` |

**Why a snapshot lives in the repo at all.** The gather job (`wobo_gateway.growth.demand`) ranks
this, and a ranking is only as honest as its input. A file in the tree with a hash beside it can be
checked by anybody; a call to an autocomplete endpoint at request time cannot be, gives a different
answer every hour, and puts a third party in the path of a job that has to run. So the harvest is
taken deliberately, recorded, and re-taken when somebody decides to re-take it.

**What the engines column means.** `["g", "b"]` is a query both Google and Bing chose to suggest,
which is the strongest signal in this file, and there are 1,771 of them. A single engine is weaker
and is ranked lower for exactly that reason. Neither is a volume figure and nothing downstream
prints one as if it were: autocomplete says a query is asked often enough to suggest, and that is
the whole of what it says. `docs/GROWTH-DESK.md` section 4 is the law this serves, and
`docs/GROWTH-SEARCH.md` section 5 is the rule it obeys: the count we publish is the count we can
prove.

**Refreshing it.** Re-run the harvester, then rebuild the manifest with the hashes and counts of
what you actually got. The counts in this table come from the manifest and are not typed by hand;
if you change the data and not the manifest, the demand test says so by name.
