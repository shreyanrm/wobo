# content/curriculum/syllabi

First-board syllabus fixtures: one JSON per framework, level and subject, built to
the ontology in `docs/CURRICULUM.md` section 2 and carrying the provenance section 5
asks for. Every unit here was read off an official document that was fetched during
the build; nothing is written from memory, and a syllabus that could not be fetched
or does not exist is stored as a negative result rather than as an empty syllabus. A
missing unit list is a fact about the world, not a licence to invent one.

121 files. 15 `verified`, 106 `provisional`. 50 of them carry `read_off_source: true`, meaning the units below were read off the board's own document, and 71 carry `discovery_state: "blocked"` with a blocker code and no units at all. 333 units and 711 topics in total. Every provisional file carries a `status_reason` saying exactly why it is not verified; the row-by-row account is `docs/curriculum/VERIFICATION.md`.

## The shape of a file

```
framework_id, framework_name, framework_kind, country, region?
official_site      the board site or document library this pass actually reached
aliases[]          other names for the framework
languages[]        the languages this file is written in
levels[]           the levels this framework publishes for, as far as this pass established
version            the academic year or edition of the document
applies_to?        the academic year a version predating it is still in force for
exam_year?         CISCE publishes per examination year; this is the year this level sits
level, level_order the class, and its number for sorting
subject, course_code?, stage?
status             verified | provisional (see below)
status_reason?     on a provisional file: what the verification pass could not find or decide
read_off_source    true when the units were read off the board's own document
discovery_state?   "blocked" on a file with no units, with a blocker code beside it
blocker?           browser_required | no_official_document | document_not_machine_readable
provenance         extractor, verifier, checks_passed[], checks_failed[], verified_at,
                   verified_by, verification - the build's checks and the verification
                   pass's checks, recorded as they came out, pass or fail
documents[]        every source document, with url, fetched_at, document_sha256 (of the
                   bytes fetched), extracted_text_sha256 (of the text the build read)
                   and the extraction method
units[]            id, name, aliases[], order, source_ref, topics[], and where the
                   document states them: marks, unit_number, instructional_hours,
                   contents, source_title (the verbatim heading when name was
                   normalised out of the document's capitals),
                   notes_from_document (material the document prints among the topics
                   that is not itself syllabus content)
  topics[]         id, name, aliases[], concept_ids[], order, source_ref, and where the
                   document states them: objectives[], contents, chapter_number,
                   lesson_number. `null` where the topic layer is not trusted, with
                   topic_discovery_state and topic_blocker beside it
note               anything a reader needs to know to trust or distrust the file
```

`id` is a stable opaque node id, derived deterministically from framework, version,
level, subject and the node's position, so the same node keeps the same id across a
rebuild and a learner overlay written against it survives the first import.
`concept_ids[]` is present and empty: the canonical concept graph in section 7 does
not exist yet, and an empty list says so.

`source_ref` is `{document_id, page, section}`: the document it came from, the page
of that document, and the heading it sits under. `document_id` always resolves to an
entry in the same file's `documents[]`.

## Status

`docs/CURRICULUM.md` section 4.4 stores discovery output as `provisional` and section 4.5
earns `verified` only after the source has been re-read independently. The build that
wrote these files did the first half: `read_off_source: true` is the weaker, true claim
that a build read the units off the board's own document at the page each `source_ref`
names. The verification pass (`wobo_gateway.curriculum.discovery.audit`) does the second
half: it fetches every cited document again, checks the bytes against the recorded hash,
looks for every unit and topic name on the page it cites, checks the count against the
document's own numbering, and asks the verify tier only where code cannot decide. A file
that holds becomes `verified`, with `provenance.verifier`, `verified_at`, `verified_by`
and every check in `provenance.verification`. One that does not stays `provisional` and
carries a `status_reason` naming exactly what could not be found or decided. Nothing is
edited to make it pass. `docs/curriculum/VERIFICATION.md` is the row-by-row account.

`provisional` covers three different situations, told apart by `discovery_state` and
`blocker`: the document was read and the units are here; the document exists but could
not be reached or parsed without a browser (`browser_required`,
`document_not_machine_readable`); or the board publishes no such document at all
(`no_official_document`). A file in the last two cases has `units: null`, never `[]`, so
an importer cannot mistake a stored negative result for a stored syllabus and skip the
discovery job the note asks for.

## How the documents were fetched and read

Every document was fetched over the network during this build with the Python standard
library only (`urllib`), saved, hashed, and turned into text. PDFs were read two ways and
cross-checked: a standard-library extractor written for this pass (zlib inflate over the
PDF content streams, with ToUnicode CMap handling) and `pdftotext -layout`, which keeps
table columns apart and is what the column-aware parsers read. `document_sha256` is the
hash of the bytes that came off the wire; `extracted_text_sha256` is the hash of the text
the parser actually read, so both halves of the claim can be checked. No model wrote or
rewrote any string in these files.

CISCE serves its pages behind a challenge that a plain request cannot pass. The subject
PDF links were discovered by loading the CISCE index page in a browser; every PDF itself
was then fetched with the standard-library fetcher, and it is those fetches the hashes
below record.

## Files

### CBSE, Central Board of Secondary Education

| File | Level | Subject | Status | State | Units | Topics | Source |
|---|---|---|---|---|---|---|---|
| `cbse/class-6-mathematics.json` | Class 6 | Mathematics | provisional | read off source | 1 | 10 | Ganita Prakash, textbook of Mathematics for Grade 6 (prelims) |
| `cbse/class-6-science.json` | Class 6 | Science | provisional | read off source | 1 | 12 | Curiosity, textbook of Science for Grade 6 (prelims) |
| `cbse/class-6-social-science.json` | Class 6 | Social Science | provisional | read off source | 5 | 14 | Exploring Society: India and Beyond, Social Science for Grade 6 (prelims) |
| `cbse/class-7-mathematics.json` | Class 7 | Mathematics | provisional | read off source | 2 | 15 | Ganita Prakash, textbook of Mathematics for Grade 7, Part 1 (prelims); Ganita Prakash, textbook of Mathematics for Grade 7, Part 2 (prelims) |
| `cbse/class-7-science.json` | Class 7 | Science | provisional | read off source | 1 | 12 | Curiosity, textbook of Science for Grade 7 (prelims) |
| `cbse/class-7-social-science.json` | Class 7 | Social Science | provisional | read off source | 10 | 20 | Exploring Society: India and Beyond, Social Science for Grade 7, Part 1 (prelims); Exploring Society: India and Beyond, Social Science for Grade 7, Part 2 (prelims) |
| `cbse/class-8-mathematics.json` | Class 8 | Mathematics | provisional | read off source | 2 | 14 | Ganita Prakash, textbook of Mathematics for Grade 8, Part 1 (prelims); Ganita Prakash, textbook of Mathematics for Grade 8, Part 2 (prelims) |
| `cbse/class-8-science.json` | Class 8 | Science | provisional | read off source | 1 | 13 | Curiosity, textbook of Science for Grade 8 (prelims) |
| `cbse/class-8-social-science.json` | Class 8 | Social Science | provisional | read off source | 9 | 15 | Exploring Society: India and Beyond, Social Science for Grade 8, Part 1 (prelims); Exploring Society: India and Beyond, Social Science for Grade 8, Part 2 (prelims) |
| `cbse/class-9-mathematics.json` | Class 9 | Mathematics | verified | read off source | 6 | 15 | Mathematics, Class IX, Secondary Curriculum Part 1, 2026-27 |
| `cbse/class-9-science.json` | Class 9 | Science | verified | read off source | 4 | 12 | Science, Class IX, Secondary Curriculum Part 1, 2026-27 |
| `cbse/class-9-social-science.json` | Class 9 | Social Science | provisional | read off source | 16 | 74 | Social Science, Class IX, Secondary Curriculum Part 1, 2026-27 |
| `cbse/class-10-mathematics.json` | Class 10 | Mathematics | verified | read off source | 7 | 15 | Mathematics, Class X, Secondary Curriculum Part 1, 2026-27 |
| `cbse/class-10-science.json` | Class 10 | Science | verified | read off source | 5 | 19 | Science, Class X, Secondary Curriculum Part 1, 2026-27 |
| `cbse/class-10-social-science.json` | Class 10 | Social Science | provisional | read off source | 4 | 21 | Social Science (087), Class X, 2026-27 |
| `cbse/class-11-biology.json` | Class 11 | Biology | verified | read off source | 5 | 19 | Biology, Classes XI and XII, Secondary Curriculum Part 2, 2026-27 |
| `cbse/class-11-chemistry.json` | Class 11 | Chemistry | verified | read off source | 9 | 66 | Chemistry, Classes XI and XII, Secondary Curriculum Part 2, 2026-27 |
| `cbse/class-11-mathematics.json` | Class 11 | Mathematics | provisional | read off source | 5 | 13 | Mathematics, Classes XI and XII, Secondary Curriculum Part 2, 2026-27 |
| `cbse/class-11-physics.json` | Class 11 | Physics | verified | read off source | 10 | 14 | Physics, Classes XI and XII, Secondary Curriculum Part 2, 2026-27 |
| `cbse/class-12-biology.json` | Class 12 | Biology | verified | read off source | 5 | 13 | Biology, Classes XI and XII, Secondary Curriculum Part 2, 2026-27 |
| `cbse/class-12-chemistry.json` | Class 12 | Chemistry | provisional | read off source | 10 | 61 | Chemistry, Classes XI and XII, Secondary Curriculum Part 2, 2026-27 |
| `cbse/class-12-mathematics.json` | Class 12 | Mathematics | verified | read off source | 6 | 13 | Mathematics, Classes XI and XII, Secondary Curriculum Part 2, 2026-27 |
| `cbse/class-12-physics.json` | Class 12 | Physics | verified | read off source | 9 | 14 | Physics, Classes XI and XII, Secondary Curriculum Part 2, 2026-27 |

### ICSE, Council for the Indian School Certificate Examinations

| File | Level | Subject | Status | State | Units | Topics | Source |
|---|---|---|---|---|---|---|---|
| `icse/class-6-mathematics.json` | Class 6 | Mathematics | provisional | blocked, no official document | - | - | no document |
| `icse/class-6-science.json` | Class 6 | Science | provisional | blocked, no official document | - | - | no document |
| `icse/class-6-social-studies.json` | Class 6 | Social Studies | provisional | blocked, no official document | - | - | no document |
| `icse/class-7-mathematics.json` | Class 7 | Mathematics | provisional | blocked, no official document | - | - | no document |
| `icse/class-7-science.json` | Class 7 | Science | provisional | blocked, no official document | - | - | no document |
| `icse/class-7-social-studies.json` | Class 7 | Social Studies | provisional | blocked, no official document | - | - | no document |
| `icse/class-8-mathematics.json` | Class 8 | Mathematics | provisional | blocked, no official document | - | - | no document |
| `icse/class-8-science.json` | Class 8 | Science | provisional | blocked, no official document | - | - | no document |
| `icse/class-8-social-studies.json` | Class 8 | Social Studies | provisional | blocked, no official document | - | - | no document |
| `icse/class-9-biology.json` | Class 9 | Biology | provisional | read off source | 7 | withdrawn | Biology (52), ICSE examination year 2027 |
| `icse/class-9-chemistry.json` | Class 9 | Chemistry | provisional | read off source | 8 | withdrawn | Chemistry (52), ICSE examination year 2027 |
| `icse/class-9-geography.json` | Class 9 | Geography | provisional | read off source | 5 | withdrawn | Geography (53), ICSE examination year 2027 |
| `icse/class-9-history-and-civics.json` | Class 9 | History and Civics | provisional | read off source | 11 | withdrawn | History & Civics (53), ICSE examination year 2027 |
| `icse/class-9-mathematics.json` | Class 9 | Mathematics | provisional | read off source | 8 | withdrawn | Mathematics (51), ICSE examination year 2027 |
| `icse/class-9-physics.json` | Class 9 | Physics | provisional | read off source | 8 | withdrawn | Physics (52), ICSE examination year 2027 |
| `icse/class-10-biology.json` | Class 10 | Biology | provisional | read off source | 6 | withdrawn | Biology (52), ICSE examination year 2027 |
| `icse/class-10-chemistry.json` | Class 10 | Chemistry | provisional | read off source | 9 | withdrawn | Chemistry (52), ICSE examination year 2027 |
| `icse/class-10-geography.json` | Class 10 | Geography | provisional | read off source | 11 | withdrawn | Geography (53), ICSE examination year 2027 |
| `icse/class-10-history-and-civics.json` | Class 10 | History and Civics | provisional | read off source | 6 | withdrawn | History & Civics (53), ICSE examination year 2027 |
| `icse/class-10-mathematics.json` | Class 10 | Mathematics | provisional | read off source | 7 | withdrawn | Mathematics (51), ICSE examination year 2027 |
| `icse/class-10-physics.json` | Class 10 | Physics | provisional | read off source | 6 | withdrawn | Physics (52), ICSE examination year 2027 |

### ISC, Council for the Indian School Certificate Examinations

| File | Level | Subject | Status | State | Units | Topics | Source |
|---|---|---|---|---|---|---|---|
| `isc/class-11-biology.json` | Class 11 | Biology | provisional | read off source | 5 | withdrawn | Biology, ISC examination year 2027 |
| `isc/class-11-chemistry.json` | Class 11 | Chemistry | provisional | read off source | 9 | withdrawn | Chemistry, ISC examination year 2027 |
| `isc/class-11-mathematics.json` | Class 11 | Mathematics | provisional | read off source | 5 | withdrawn | Mathematics, ISC examination year 2027 |
| `isc/class-11-physics.json` | Class 11 | Physics | provisional | read off source | 10 | withdrawn | Physics, ISC examination year 2027 |
| `isc/class-12-biology.json` | Class 12 | Biology | provisional | read off source | 5 | withdrawn | Biology, ISC examination year 2027 |
| `isc/class-12-chemistry.json` | Class 12 | Chemistry | provisional | read off source | 10 | withdrawn | Chemistry, ISC examination year 2027 |
| `isc/class-12-mathematics.json` | Class 12 | Mathematics | provisional | read off source | 7 | withdrawn | Mathematics, ISC examination year 2027 |
| `isc/class-12-physics.json` | Class 12 | Physics | provisional | read off source | 9 | withdrawn | Physics, ISC examination year 2027 |

### Telangana

| File | Level | Subject | Status | State | Units | Topics | Source |
|---|---|---|---|---|---|---|---|
| `telangana/class-6-mathematics.json` | Class 6 | Mathematics | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-6-science.json` | Class 6 | Science | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-6-social-science.json` | Class 6 | Social Science | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-7-mathematics.json` | Class 7 | Mathematics | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-7-science.json` | Class 7 | Science | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-7-social-science.json` | Class 7 | Social Science | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-8-mathematics.json` | Class 8 | Mathematics | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-8-science.json` | Class 8 | Science | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-8-social-science.json` | Class 8 | Social Science | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-9-mathematics.json` | Class 9 | Mathematics | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-9-science.json` | Class 9 | Science | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-9-social-science.json` | Class 9 | Social Science | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-10-mathematics.json` | Class 10 | Mathematics | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-10-science.json` | Class 10 | Science | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |
| `telangana/class-10-social-science.json` | Class 10 | Social Science | provisional | blocked, browser required | - | - | State Council of Educational Research and Training, Telangana - site index; Board of Secondary Education, Telangana - site index |

### Andhra Pradesh

| File | Level | Subject | Status | State | Units | Topics | Source |
|---|---|---|---|---|---|---|---|
| `andhra-pradesh/class-6-mathematics.json` | Class 6 | Mathematics | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-6-science.json` | Class 6 | Science | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-6-social-science.json` | Class 6 | Social Science | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-7-mathematics.json` | Class 7 | Mathematics | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-7-science.json` | Class 7 | Science | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-7-social-science.json` | Class 7 | Social Science | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-8-mathematics.json` | Class 8 | Mathematics | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-8-science.json` | Class 8 | Science | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-8-social-science.json` | Class 8 | Social Science | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-9-mathematics.json` | Class 9 | Mathematics | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-9-science.json` | Class 9 | Science | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-9-social-science.json` | Class 9 | Social Science | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-10-mathematics.json` | Class 10 | Mathematics | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-10-science.json` | Class 10 | Science | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |
| `andhra-pradesh/class-10-social-science.json` | Class 10 | Social Science | provisional | blocked, no official document | - | - | Board of Secondary Education, Andhra Pradesh - site index |

### Maharashtra

| File | Level | Subject | Status | State | Units | Topics | Source |
|---|---|---|---|---|---|---|---|
| `maharashtra/class-6-mathematics.json` | Class 6 | Mathematics | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-6-science.json` | Class 6 | Science | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-6-social-science.json` | Class 6 | Social Science | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-7-mathematics.json` | Class 7 | Mathematics | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-7-science.json` | Class 7 | Science | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-7-social-science.json` | Class 7 | Social Science | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-8-mathematics.json` | Class 8 | Mathematics | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-8-science.json` | Class 8 | Science | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-8-social-science.json` | Class 8 | Social Science | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-9-mathematics.json` | Class 9 | Mathematics | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-9-science.json` | Class 9 | Science | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-9-social-science.json` | Class 9 | Social Science | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-10-mathematics.json` | Class 10 | Mathematics | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-10-science.json` | Class 10 | Science | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |
| `maharashtra/class-10-social-science.json` | Class 10 | Social Science | provisional | blocked, browser required | - | - | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index |

### Karnataka School Examination and Assessment Board

| File | Level | Subject | Status | State | Units | Topics | Source |
|---|---|---|---|---|---|---|---|
| `karnataka/class-6-mathematics.json` | Class 6 | Mathematics | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-6-science.json` | Class 6 | Science | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-6-social-science.json` | Class 6 | Social Science | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-7-mathematics.json` | Class 7 | Mathematics | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-7-science.json` | Class 7 | Science | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-7-social-science.json` | Class 7 | Social Science | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-8-mathematics.json` | Class 8 | Mathematics | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-8-science.json` | Class 8 | Science | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-8-social-science.json` | Class 8 | Social Science | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-9-mathematics.json` | Class 9 | Mathematics | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-9-science.json` | Class 9 | Science | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-9-social-science.json` | Class 9 | Social Science | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-10-mathematics.json` | Class 10 | Mathematics | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-10-science.json` | Class 10 | Science | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |
| `karnataka/class-10-social-science.json` | Class 10 | Social Science | provisional | blocked, browser required | - | - | Karnataka Textbook Society textbook portal - index |

### NIOS, National Institute of Open Schooling

| File | Level | Subject | Status | State | Units | Topics | Source |
|---|---|---|---|---|---|---|---|
| `nios/class-10-english.json` | Class 10 | English | provisional | blocked, document not machine readable | - | - | Bifurcation of syllabus, English (202), NIOS secondary course |
| `nios/class-10-mathematics.json` | Class 10 | Mathematics | verified | read off source | 6 | 26 | Bifurcation of syllabus, Mathematics (211), NIOS secondary course |
| `nios/class-10-science-and-technology.json` | Class 10 | Science and Technology | provisional | read off source | 7 | 32 | Bifurcation of syllabus, Science and Technology (212), NIOS secondary course |
| `nios/class-10-social-science.json` | Class 10 | Social Science | verified | read off source | 4 | 28 | Bifurcation of syllabus, Social Science (213), NIOS secondary course |
| `nios/class-12-biology.json` | Class 12 | Biology | verified | read off source | 5 | 31 | Bifurcation of syllabus, Biology (314), NIOS senior secondary course |
| `nios/class-12-chemistry.json` | Class 12 | Chemistry | provisional | read off source | 8 | 32 | Bifurcation of syllabus, Chemistry (313), NIOS senior secondary course |
| `nios/class-12-english.json` | Class 12 | English | provisional | blocked, document not machine readable | - | - | Bifurcation of syllabus, English (302), NIOS senior secondary course |
| `nios/class-12-mathematics.json` | Class 12 | Mathematics | verified | read off source | 10 | 38 | Bifurcation of syllabus, Mathematics (311), NIOS senior secondary course |
| `nios/class-12-physics.json` | Class 12 | Physics | verified | read off source | 8 | 30 | Bifurcation of syllabus, Physics (312), NIOS senior secondary course |

## Source documents

Every document any file above points at, with the hash of the bytes fetched.

| Document id | Title | URL | Fetched | document_sha256 |
|---|---|---|---|---|
| `ap-bse-home` | Board of Secondary Education, Andhra Pradesh - site index | https://bse.ap.gov.in/ | 2026-09-03T07:49:22Z | `9418448335352304738ff54b19e9de9008d2a9a43bc326881b6ee851dbaf0440` |
| `cbse-10-maths` | Mathematics, Class X, Secondary Curriculum Part 1, 2026-27 | https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart1/Maths_SecP1X_2026-27.pdf | 2026-09-03T07:03:44Z | `d773e7c12b99e0bd498067e2b8268c76d0496bf9cad1c9e41c8652ab68b412a5` |
| `cbse-10-science` | Science, Class X, Secondary Curriculum Part 1, 2026-27 | https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart1/Science_SecP1_2026-27.pdf | 2026-09-03T07:03:45Z | `1bec4a9e44452b22c9d422d8cb528b4de30598f56c243461845165771df7bc37` |
| `cbse-10-social` | Social Science (087), Class X, 2026-27 | https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart1/SocialScience_SecP1X_2026-27.pdf | 2026-09-03T07:03:50Z | `99d21fd5e2fdddb990797eec5450c31098438c6a7ecc4406fce401e5e88083eb` |
| `cbse-1112-biology` | Biology, Classes XI and XII, Secondary Curriculum Part 2, 2026-27 | https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart2/Biology_SecP2_2026-27.pdf | 2026-09-03T07:03:56Z | `3a5767515b41b12b9356151e759beba48bb15a1b711b96c321fa273a7fa7a6ee` |
| `cbse-1112-chemistry` | Chemistry, Classes XI and XII, Secondary Curriculum Part 2, 2026-27 | https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart2/Chemistry_SecP2_2026-27.pdf | 2026-09-03T07:03:55Z | `5610f09d357d3ccc9a7b39fc29cb7b1f4530847753783b16c72fff691acd2418` |
| `cbse-1112-maths` | Mathematics, Classes XI and XII, Secondary Curriculum Part 2, 2026-27 | https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart2/Maths_SecP2_2026-27.pdf | 2026-09-03T07:03:57Z | `5bf4105d4076189fe00b879fd6d41ffadec87a894a078a7fb912b2f219769572` |
| `cbse-1112-physics` | Physics, Classes XI and XII, Secondary Curriculum Part 2, 2026-27 | https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart2/Physics_SecP2_2026-27.pdf | 2026-09-03T07:03:52Z | `9e32271cf5a86caa605cffe2a4b5e19710abc3d3a8715ef725ba78cd94caf1f7` |
| `cbse-9-maths` | Mathematics, Class IX, Secondary Curriculum Part 1, 2026-27 | https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart1/Maths_SecP1IX_2026-27.pdf | 2026-09-03T07:03:39Z | `932ea66d6fbfcefce8182f28ab921c886187f5dea674321088b5c7230bbe6c32` |
| `cbse-9-science` | Science, Class IX, Secondary Curriculum Part 1, 2026-27 | https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart1/ScienceSt_SecP1_2026-27.pdf | 2026-09-03T07:03:41Z | `ab19589aede5ad8b0b2f87964914c1a55a987f39032903871baa973c02ed6e24` |
| `cbse-9-social` | Social Science, Class IX, Secondary Curriculum Part 1, 2026-27 | https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart1/SocialScience_SecP1IX_2026-27.pdf | 2026-09-03T07:03:42Z | `c81d9237b8e74d462e57776e162d534ff04feff27ed72eb236621361a9061735` |
| `icse-biology` | Biology (52), ICSE examination year 2027 | https://cisce.org/wp-content/uploads/2025/03/12.-Biology.pdf | 2026-09-03T07:29:50Z | `f804154ed40b35394d85cc25ca59fb2d47089a5e3ba5fe6cfc74759173ab694f` |
| `icse-chemistry` | Chemistry (52), ICSE examination year 2027 | https://cisce.org/wp-content/uploads/2025/03/11.-Chemistry.pdf | 2026-09-03T07:29:49Z | `18026d7b758953978288418a3dd1a70abf9e502680b41608ee29d30e100120be` |
| `icse-geography` | Geography (53), ICSE examination year 2027 | https://cisce.org/wp-content/uploads/2025/03/ICSE-Geography.pdf | 2026-09-03T07:29:52Z | `d4fa4d4fc971aa3d7386161e86b6414b1850992b3357bc4514fc03e12786221f` |
| `icse-history-civics` | History & Civics (53), ICSE examination year 2027 | https://cisce.org/wp-content/uploads/2025/03/ICSE-History-Civics.pdf | 2026-09-03T07:29:51Z | `f7dcdfe81603436b4fd34a01cfc817010bbb0a931487951beb915597b9c14dac` |
| `icse-maths` | Mathematics (51), ICSE examination year 2027 | https://cisce.org/wp-content/uploads/2025/03/9.-Mathematics.pdf | 2026-09-03T07:29:47Z | `08b64aa3b4a5ff2b818bb2a92d4459c0a64c99622e2422fec6f26d90d97c7d16` |
| `icse-physics` | Physics (52), ICSE examination year 2027 | https://cisce.org/wp-content/uploads/2025/03/10.-Physics.pdf | 2026-09-03T07:29:48Z | `2acfb898c5377a15c7e89770dba64597a5760bbb4683b3c2c2c47651b9003cac` |
| `isc-biology` | Biology, ISC examination year 2027 | https://cisce.org/wp-content/uploads/2025/04/20.-ISC-Biology.pdf | 2026-09-03T07:29:56Z | `8419f94fea206eb5b3978908d1a44e3ed0eae325872814e444672a68175cc0af` |
| `isc-chemistry` | Chemistry, ISC examination year 2027 | https://cisce.org/wp-content/uploads/2025/04/19.-ISC-Chemistry-1.pdf | 2026-09-03T07:29:55Z | `8cc033031b12f40db02390719ab8606106ee318597c133fd71e5fc66ff12ce1d` |
| `isc-maths` | Mathematics, ISC examination year 2027 | https://cisce.org/wp-content/uploads/2025/04/17.-ISC-Mathematics.pdf | 2026-09-03T07:29:54Z | `fe272b0fbf5e1ef1df1a5a8ae269bc3ffad18905107c3e9678143a6754e8d9a5` |
| `isc-physics` | Physics, ISC examination year 2027 | https://cisce.org/wp-content/uploads/2026/02/ISC-2027-Physics.pdf | 2026-09-03T07:29:54Z | `18d4fc0f33ff9b5a5cdb575ec92190f3a32bbd4d69931566adff3de32792a6d2` |
| `ka-textbooks` | Karnataka Textbook Society textbook portal - index | https://textbooks.karnataka.gov.in/ | 2026-09-03T07:47:02Z | `89bb24f30e431a075f5950985473f9752315d1c6d3c0e283c46818556e69c27c` |
| `mh-balbharati-home` | Maharashtra State Bureau of Textbook Production and Curriculum Research (Balbharati) - site index | https://ebalbharati.in/ | 2026-09-03T07:49:22Z | `275404a187d8a26d92aa3b77e66205bf6d5b23156f33f762c2211befcf341881` |
| `ncert-6-curiosity` | Curiosity, textbook of Science for Grade 6 (prelims) | https://ncert.nic.in/textbook/pdf/fecu1ps.pdf | 2026-09-03T07:05:10Z | `0f143518474320c83059c0ca2036cf292e7a3f8a460c1c1c22719de193a0a058` |
| `ncert-6-ganita` | Ganita Prakash, textbook of Mathematics for Grade 6 (prelims) | https://ncert.nic.in/textbook/pdf/fegp1ps.pdf | 2026-09-03T07:05:07Z | `902147cff853df0023b4e13293711573562bf42abf91253e5045e877c76d51df` |
| `ncert-6-society` | Exploring Society: India and Beyond, Social Science for Grade 6 (prelims) | https://ncert.nic.in/textbook/pdf/fees1ps.pdf | 2026-09-03T07:05:47Z | `7605e63efa73bf1748d866c843217473b1a4826f39309525540a3a058bd6e310` |
| `ncert-7-curiosity` | Curiosity, textbook of Science for Grade 7 (prelims) | https://ncert.nic.in/textbook/pdf/gecu1ps.pdf | 2026-09-03T07:06:07Z | `1c3d49d5609cf52ac4c007bd42d0810d2449f08cb8870c535f8fe6246811b56d` |
| `ncert-7-ganita1` | Ganita Prakash, textbook of Mathematics for Grade 7, Part 1 (prelims) | https://ncert.nic.in/textbook/pdf/gegp1ps.pdf | 2026-09-03T07:05:53Z | `d05d0fe3524eaa7727683387787f04c84f3d444e9f6b4b44819b97a6ee023d2c` |
| `ncert-7-ganita2` | Ganita Prakash, textbook of Mathematics for Grade 7, Part 2 (prelims) | https://ncert.nic.in/textbook/pdf/gegp2ps.pdf | 2026-09-03T07:05:58Z | `59a3b897ce08f71605805ee73ecbfeef126a930bc0d9a3716d15e9dcf2c430aa` |
| `ncert-7-society1` | Exploring Society: India and Beyond, Social Science for Grade 7, Part 1 (prelims) | https://ncert.nic.in/textbook/pdf/gees1ps.pdf | 2026-09-03T07:06:37Z | `7701947726d2dcc9890bce3e36669cd8388fe5bea2cf3cd55082b2a409fdb7da` |
| `ncert-7-society2` | Exploring Society: India and Beyond, Social Science for Grade 7, Part 2 (prelims) | https://ncert.nic.in/textbook/pdf/gees2ps.pdf | 2026-09-03T07:07:03Z | `f673f0474ebf9d8f5b383ef255ef5630ff967a67db30204bc20e84fe5121ed16` |
| `ncert-8-curiosity` | Curiosity, textbook of Science for Grade 8 (prelims) | https://ncert.nic.in/textbook/pdf/hecu1ps.pdf | 2026-09-03T07:07:29Z | `cf752771b28a3328bf37ec768907ed0f46d2a2507a77803222b435c651830955` |
| `ncert-8-ganita1` | Ganita Prakash, textbook of Mathematics for Grade 8, Part 1 (prelims) | https://ncert.nic.in/textbook/pdf/hegp1ps.pdf | 2026-09-03T07:07:09Z | `e08bdb82e719ba12a1b2482c94629a4f35df91852539b4413f2a26e9eaab3dfd` |
| `ncert-8-ganita2` | Ganita Prakash, textbook of Mathematics for Grade 8, Part 2 (prelims) | https://ncert.nic.in/textbook/pdf/hegp2ps.pdf | 2026-09-03T07:07:21Z | `c5f4d86252edb391401831f279ab5f2065ecb2f2d0631607aa4044e5a0d74cc8` |
| `ncert-8-society1` | Exploring Society: India and Beyond, Social Science for Grade 8, Part 1 (prelims) | https://ncert.nic.in/textbook/pdf/hees1ps.pdf | 2026-09-03T07:07:44Z | `70408aa655e5273cc98dc717bce61290d06313b12136d89b932c985dc3f1248b` |
| `ncert-8-society2` | Exploring Society: India and Beyond, Social Science for Grade 8, Part 2 (prelims) | https://ncert.nic.in/textbook/pdf/hees2ps.pdf | 2026-09-03T07:07:54Z | `a15fbefbd6b55383b7b7a0cd2731c3ccedf7bd7584efafe2640ecfc48aa380ad` |
| `nios-bif-202` | Bifurcation of syllabus, English (202), NIOS secondary course | https://nios.ac.in/media/documents/Course_Bifurcation_2023/10th/202.pdf | 2026-09-03T07:41:08Z | `1599b176a6df6824c96a12bcfcaa090163ecca389b8f41ca2a3955ec54e4aff3` |
| `nios-bif-211` | Bifurcation of syllabus, Mathematics (211), NIOS secondary course | https://nios.ac.in/media/documents/Course_Bifurcation_2023/10th/211.pdf | 2026-09-03T07:41:08Z | `d1556c2957c7b95496ef00ba6eefd7fe513dc5499ecbdb4902bc0c646bc4ec4e` |
| `nios-bif-212` | Bifurcation of syllabus, Science and Technology (212), NIOS secondary course | https://nios.ac.in/media/documents/Course_Bifurcation_2023/10th/212.pdf | 2026-09-03T07:41:10Z | `ff502cfc85e0e30f68163088f3af9cb4cfacd1ad61cad022a96ce88cb1ee0725` |
| `nios-bif-213` | Bifurcation of syllabus, Social Science (213), NIOS secondary course | https://nios.ac.in/media/documents/Course_Bifurcation_2023/10th/213.pdf | 2026-09-03T07:41:11Z | `fec5b97caa0d1f1aefbe70dcdb32e95122ca9aa47e5e086f20e58356d3ffd183` |
| `nios-bif-302` | Bifurcation of syllabus, English (302), NIOS senior secondary course | https://nios.ac.in/media/documents/Course_Bifurcation_2023/12th/302Bifurcation_new.pdf | 2026-09-03T07:40:40Z | `02c79fbbc81c67e660243c41271f4fb4dbf2f5497bf285848bf693da50bf60af` |
| `nios-bif-311` | Bifurcation of syllabus, Mathematics (311), NIOS senior secondary course | https://nios.ac.in/media/documents/Course_Bifurcation_2023/12th/311Bifurcation.pdf | 2026-09-03T07:40:33Z | `9277951767337f561e8bf72ec9aa2479ab8341b50a93f98531b286ab35dca1c9` |
| `nios-bif-312` | Bifurcation of syllabus, Physics (312), NIOS senior secondary course | https://nios.ac.in/media/documents/Course_Bifurcation_2023/12th/312Bifurcation.pdf | 2026-09-03T07:40:35Z | `99a62227af7f661f95119e89ed2d24cff737292e0d753fcaceab2ea2e076ae46` |
| `nios-bif-313` | Bifurcation of syllabus, Chemistry (313), NIOS senior secondary course | https://nios.ac.in/media/documents/Course_Bifurcation_2023/12th/313Bifurcation.pdf | 2026-09-03T07:40:37Z | `794120e04fb20498567022d720304a3c04060e0c86d6650bd2b50c1e9db1acd7` |
| `nios-bif-314` | Bifurcation of syllabus, Biology (314), NIOS senior secondary course | https://nios.ac.in/media/documents/Course_Bifurcation_2023/12th/314Bifurcation.pdf | 2026-09-03T07:40:39Z | `0804d1e2432a9c78dc733e2f55a39a67bcb117ffea62bc278b4a5218b3a4c5db` |
| `ts-bse-home` | Board of Secondary Education, Telangana - site index | https://bse.telangana.gov.in/ | 2026-09-03T07:48:06Z | `f718254abf82365719e02b5f6cc69524a096c258d7c1816a5de50e19c2433f48` |
| `ts-scert-home` | State Council of Educational Research and Training, Telangana - site index | https://scert.telangana.gov.in/ | 2026-09-03T07:48:06Z | `3c050da99f15d0b4a2526f22175cb52d315e58f9264a47f422119356501814a5` |

## Known limits, named

- **The CISCE topic layer is withdrawn, in all 20 ICSE and ISC files with units.**
  An earlier pass re-flowed the booklets' two-column layout by line position. It truncated
  topic titles mid-phrase ("Areas of similar triangles are", "Tangent and Secant Properties:
  5") and, worse, filed topics under the wrong unit: the circulatory, excretory, endocrine
  and reproductive systems landed under Plant Physiology while Human Anatomy and Physiology
  sat empty, and 35 items including sewage treatment and lab practicals were dumped into
  Ecology and Environment. Ninety-nine units came out with no topics at all. None of that
  is kept. Every unit in those files now has `topics: null` with
  `topic_discovery_state: "blocked"`, and the unit list, unit order and any unit-level
  `contents` prose are what remain. Re-deriving the topics means keying off the booklet's
  own bracketed sub-headings and bracket depth, not line position, and having a second
  reader confirm the unit to topic mapping before anything is promoted.

- **Page-tail bleed, found and bounded.** The first build never bounded the last objective
  or prose run of a unit, so the remainder of the PDF - practicals lists, question-paper
  design tables, prescribed-book lists - ran on into a learner-facing string. Twenty-three
  strings across seven CBSE files were affected, the worst about 2,000 characters long. Each
  run is now cut at the next page-tail token (`PRACTICALS`, `No. of periods`, `Question
  Paper Design`, `Max. Marks`, `Prescribed Books`, `Ch. n`) and trimmed back to the last
  whole sentence. The check `no_page_tail_bled_into_a_node` in each file's
  `provenance.checks_passed` is what re-runs the test.

- **Prose split into topics.** Where a unit's contents are one run of prose, topics are that
  prose split at its own commas, semicolons and full stops. Every topic string is verbatim;
  only the boundaries are ours, and the unit keeps the untouched prose in `contents`. The
  split used to swallow the assessment table and the editorial note printed after the
  syllabus in CBSE chemistry; that material now sits in the unit's `notes_from_document` and
  is not offered as a topic.

- **Duplicate topic names.** `cbse/class-12-chemistry.json` repeats plain headings
  ("Classification, Nomenclature", "Chemical Reactions", "Physical Properties") under
  different units, exactly as the document does. The file records this in
  `provenance.checks_failed`. Node ids are positional, not derived from the title, so the
  duplicates do not collide; a renderer that shows a topic outside its unit will need the
  parent unit name beside it.

- **NIOS is a 2023 document.** Every NIOS bifurcation document the board currently publishes
  is the 2023 edition, still in force. Those files are stamped `version: "2023"` with
  `applies_to: "2026-27"` rather than claiming a 2026-27 document that does not exist, so
  section 9's re-fetch compares like with like.

- **CISCE publishes per examination year.** The booklets fetched are for the 2027
  examination. `exam_year` carries this: 2027 on classes 10 and 12, 2028 on classes 9 and
  11, who sit a later examination and whose booklet may still change.

- **Shouted headings.** CBSE class X mathematics prints its unit and topic names in capitals
  while class IX prints them in title case. `name` is normalised to sentence case for
  display and `source_title` keeps the document's own string, so nothing is lost and two
  adjacent classes do not look like two products.

- **CBSE class IX Social Science** states learning outcomes in a column of the same table as
  the topics. The two columns interleave in the extracted text, so that file records the
  topics and names the pages where the outcomes live, rather than transcribing them with
  losses.

- **Where a board's own document has a typo, the typo is kept.** The file records what the
  board published.

- **Coverage is classes 6 to 12.** `docs/CURRICULUM.md` section 11 scopes grades 4 to 13.
  Classes 1 to 5 and the year 13 equivalents are not built here.

## Next

1. Re-derive the CISCE topic layer off the booklets' bracket structure and have a second
   reader confirm the unit to topic mapping.
2. Work the blocked files: each names a portal and a blocker code, and running the
   discovery job in `docs/CURRICULUM.md` section 4 with a browser-capable fetcher against
   that portal is the next step, followed by extraction from the prescribed textbook's own
   contents page, the way the CBSE middle-stage files here were built.
3. Then, and only then, take files through the section 4.5 promotion that earns `verified`.

## The toolchain

`tools/migrate_2026_09_03.py` is the repair pass that produced the current shape of these
files, and `tools/build_readme.py` regenerates this README from them, so every count above
is read out of the data rather than typed. The fetchers and the per-board extractors that
built the first cut are in `tools/extract/`.
