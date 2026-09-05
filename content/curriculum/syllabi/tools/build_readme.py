"""Regenerate content/curriculum/syllabi/README.md from the fixtures themselves.

Run from anywhere:  python3 content/curriculum/syllabi/tools/build_readme.py

Every count and every table row is read out of the JSON, so the README cannot
drift from the data the way the first one did.
"""

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORDER = ["cbse", "icse", "isc", "telangana", "andhra-pradesh", "maharashtra", "karnataka", "nios"]
HEADING = {
    "cbse": "CBSE, Central Board of Secondary Education",
    "icse": "ICSE, Council for the Indian School Certificate Examinations",
    "isc": "ISC, Council for the Indian School Certificate Examinations",
    "telangana": "Telangana",
    "andhra-pradesh": "Andhra Pradesh",
    "maharashtra": "Maharashtra",
    "karnataka": "Karnataka School Examination and Assessment Board",
    "nios": "NIOS, National Institute of Open Schooling",
}
BLOCKER_WORDS = {
    "browser_required": "blocked, browser required",
    "no_official_document": "blocked, no official document",
    "document_not_machine_readable": "blocked, document not machine readable",
}


def load():
    out = []
    for d in sorted(os.listdir(ROOT)):
        p = os.path.join(ROOT, d)
        if not os.path.isdir(p) or d == "tools":
            continue
        for f in sorted(os.listdir(p)):
            if f.endswith(".json"):
                with open(os.path.join(p, f)) as fh:
                    out.append((f"{d}/{f}", json.load(fh)))
    return out


def level_key(rel):
    n = rel.split("class-")[1].split("-")[0]
    return (int(n), rel)


def main():
    files = load()
    docs = {}
    for _, d in files:
        for doc in d.get("documents") or []:
            docs[doc["id"]] = doc
    units = sum(len(d.get("units") or []) for _, d in files)
    topics = sum(len(u.get("topics") or []) for _, d in files for u in (d.get("units") or []))
    read_off = sum(1 for _, d in files if d.get("read_off_source"))
    blocked = sum(1 for _, d in files if d.get("discovery_state") == "blocked")
    verified = sum(1 for _, d in files if d.get("status") == "verified")
    provisional = len(files) - verified
    reasoned = sum(1 for _, d in files if d.get("status") != "verified" and d.get("status_reason"))

    L = []
    w = L.append
    w("# content/curriculum/syllabi\n")
    w(
        "First-board syllabus fixtures: one JSON per framework, level and subject, built to\n"
        "the ontology in `docs/CURRICULUM.md` section 2 and carrying the provenance section 5\n"
        "asks for. Every unit here was read off an official document that was fetched during\n"
        "the build; nothing is written from memory, and a syllabus that could not be fetched\n"
        "or does not exist is stored as a negative result rather than as an empty syllabus. A\n"
        "missing unit list is a fact about the world, not a licence to invent one.\n"
    )
    w(
        f"{len(files)} files. {verified} `verified`, {provisional} `provisional`. "
        f"{read_off} of them carry `read_off_source: true`, meaning the units below were read off the "
        f'board\'s own document, and {blocked} carry `discovery_state: "blocked"` with a blocker '
        f"code and no units at all. {units} units and {topics} topics in total. "
        + (
            "Every provisional file"
            if provisional == reasoned
            else f"{reasoned} of the {provisional} provisional files"
        )
        + " carries a `status_reason` saying exactly why it is not verified; the row-by-row "
        "account is `docs/curriculum/VERIFICATION.md`.\n"
    )
    w("## The shape of a file\n")
    w("""```
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
""")
    w(
        "`id` is a stable opaque node id, derived deterministically from framework, version,\n"
        "level, subject and the node's position, so the same node keeps the same id across a\n"
        "rebuild and a learner overlay written against it survives the first import.\n"
        "`concept_ids[]` is present and empty: the canonical concept graph in section 7 does\n"
        "not exist yet, and an empty list says so.\n"
    )
    w(
        "`source_ref` is `{document_id, page, section}`: the document it came from, the page\n"
        "of that document, and the heading it sits under. `document_id` always resolves to an\n"
        "entry in the same file's `documents[]`.\n"
    )
    w("## Status\n")
    w(
        "`docs/CURRICULUM.md` section 4.4 stores discovery output as `provisional` and section 4.5\n"
        "earns `verified` only after the source has been re-read independently. The build that\n"
        "wrote these files did the first half: `read_off_source: true` is the weaker, true claim\n"
        "that a build read the units off the board's own document at the page each `source_ref`\n"
        "names. The verification pass (`wobo_gateway.curriculum.discovery.audit`) does the second\n"
        "half: it fetches every cited document again, checks the bytes against the recorded hash,\n"
        "looks for every unit and topic name on the page it cites, checks the count against the\n"
        "document's own numbering, and asks the verify tier only where code cannot decide. A file\n"
        "that holds becomes `verified`, with `provenance.verifier`, `verified_at`, `verified_by`\n"
        "and every check in `provenance.verification`. One that does not stays `provisional` and\n"
        "carries a `status_reason` naming exactly what could not be found or decided. Nothing is\n"
        "edited to make it pass. `docs/curriculum/VERIFICATION.md` is the row-by-row account.\n"
    )
    w(
        "`provisional` covers three different situations, told apart by `discovery_state` and\n"
        "`blocker`: the document was read and the units are here; the document exists but could\n"
        "not be reached or parsed without a browser (`browser_required`,\n"
        "`document_not_machine_readable`); or the board publishes no such document at all\n"
        "(`no_official_document`). A file in the last two cases has `units: null`, never `[]`, so\n"
        "an importer cannot mistake a stored negative result for a stored syllabus and skip the\n"
        "discovery job the note asks for.\n"
    )
    w("## How the documents were fetched and read\n")
    w(
        "Every document was fetched over the network during this build with the Python standard\n"
        "library only (`urllib`), saved, hashed, and turned into text. PDFs were read two ways and\n"
        "cross-checked: a standard-library extractor written for this pass (zlib inflate over the\n"
        "PDF content streams, with ToUnicode CMap handling) and `pdftotext -layout`, which keeps\n"
        "table columns apart and is what the column-aware parsers read. `document_sha256` is the\n"
        "hash of the bytes that came off the wire; `extracted_text_sha256` is the hash of the text\n"
        "the parser actually read, so both halves of the claim can be checked. No model wrote or\n"
        "rewrote any string in these files.\n"
    )
    w(
        "CISCE serves its pages behind a challenge that a plain request cannot pass. The subject\n"
        "PDF links were discovered by loading the CISCE index page in a browser; every PDF itself\n"
        "was then fetched with the standard-library fetcher, and it is those fetches the hashes\n"
        "below record.\n"
    )
    w("## Files\n")
    for fid in ORDER:
        rows = sorted(
            [(r, d) for r, d in files if d["framework_id"] == fid], key=lambda x: level_key(x[0])
        )
        if not rows:
            continue
        w(f"### {HEADING[fid]}\n")
        w("| File | Level | Subject | Status | State | Units | Topics | Source |")
        w("|---|---|---|---|---|---|---|---|")
        for rel, d in rows:
            us = d.get("units")
            if us is None:
                state = BLOCKER_WORDS[d["blocker"]]
                nu, nt = "-", "-"
            else:
                state = "read off source"
                nu = len(us)
                nt = sum(len(u.get("topics") or []) for u in us)
                if all(u.get("topics") is None for u in us):
                    nt = "withdrawn"
            srcs = "; ".join(doc["title"] for doc in d.get("documents") or []) or "no document"
            w(
                f"| `{rel}` | {d['level']} | {d['subject']} | {d.get('status')} | {state} "
                f"| {nu} | {nt} | {srcs} |"
            )
        w("")
    w("## Source documents\n")
    w("Every document any file above points at, with the hash of the bytes fetched.\n")
    w("| Document id | Title | URL | Fetched | document_sha256 |")
    w("|---|---|---|---|---|")
    for did in sorted(docs):
        doc = docs[did]
        w(
            f"| `{did}` | {doc['title']} | {doc['url']} | {doc['fetched_at']} | `{doc['document_sha256']}` |"
        )
    w("")
    w("## Known limits, named\n")
    # CISCE
    cisce = [r for r, d in files if d["framework_id"] in ("icse", "isc") and d.get("units")]
    w(
        f"- **The CISCE topic layer is withdrawn, in all {len(cisce)} ICSE and ISC files with units.**\n"
        "  An earlier pass re-flowed the booklets' two-column layout by line position. It truncated\n"
        '  topic titles mid-phrase ("Areas of similar triangles are", "Tangent and Secant Properties:\n'
        '  5") and, worse, filed topics under the wrong unit: the circulatory, excretory, endocrine\n'
        "  and reproductive systems landed under Plant Physiology while Human Anatomy and Physiology\n"
        "  sat empty, and 35 items including sewage treatment and lab practicals were dumped into\n"
        "  Ecology and Environment. Ninety-nine units came out with no topics at all. None of that\n"
        "  is kept. Every unit in those files now has `topics: null` with\n"
        '  `topic_discovery_state: "blocked"`, and the unit list, unit order and any unit-level\n'
        "  `contents` prose are what remain. Re-deriving the topics means keying off the booklet's\n"
        "  own bracketed sub-headings and bracket depth, not line position, and having a second\n"
        "  reader confirm the unit to topic mapping before anything is promoted.\n"
    )
    w(
        "- **Page-tail bleed, found and bounded.** The first build never bounded the last objective\n"
        "  or prose run of a unit, so the remainder of the PDF - practicals lists, question-paper\n"
        "  design tables, prescribed-book lists - ran on into a learner-facing string. Twenty-three\n"
        "  strings across seven CBSE files were affected, the worst about 2,000 characters long. Each\n"
        "  run is now cut at the next page-tail token (`PRACTICALS`, `No. of periods`, `Question\n"
        "  Paper Design`, `Max. Marks`, `Prescribed Books`, `Ch. n`) and trimmed back to the last\n"
        "  whole sentence. The check `no_page_tail_bled_into_a_node` in each file's\n"
        "  `provenance.checks_passed` is what re-runs the test.\n"
    )
    w(
        "- **Prose split into topics.** Where a unit's contents are one run of prose, topics are that\n"
        "  prose split at its own commas, semicolons and full stops. Every topic string is verbatim;\n"
        "  only the boundaries are ours, and the unit keeps the untouched prose in `contents`. The\n"
        "  split used to swallow the assessment table and the editorial note printed after the\n"
        "  syllabus in CBSE chemistry; that material now sits in the unit's `notes_from_document` and\n"
        "  is not offered as a topic.\n"
    )
    w(
        "- **Duplicate topic names.** `cbse/class-12-chemistry.json` repeats plain headings\n"
        '  ("Classification, Nomenclature", "Chemical Reactions", "Physical Properties") under\n'
        "  different units, exactly as the document does. The file records this in\n"
        "  `provenance.checks_failed`. Node ids are positional, not derived from the title, so the\n"
        "  duplicates do not collide; a renderer that shows a topic outside its unit will need the\n"
        "  parent unit name beside it.\n"
    )
    w(
        "- **NIOS is a 2023 document.** Every NIOS bifurcation document the board currently publishes\n"
        '  is the 2023 edition, still in force. Those files are stamped `version: "2023"` with\n'
        '  `applies_to: "2026-27"` rather than claiming a 2026-27 document that does not exist, so\n'
        "  section 9's re-fetch compares like with like.\n"
    )
    w(
        "- **CISCE publishes per examination year.** The booklets fetched are for the 2027\n"
        "  examination. `exam_year` carries this: 2027 on classes 10 and 12, 2028 on classes 9 and\n"
        "  11, who sit a later examination and whose booklet may still change.\n"
    )
    w(
        "- **Shouted headings.** CBSE class X mathematics prints its unit and topic names in capitals\n"
        "  while class IX prints them in title case. `name` is normalised to sentence case for\n"
        "  display and `source_title` keeps the document's own string, so nothing is lost and two\n"
        "  adjacent classes do not look like two products.\n"
    )
    w(
        "- **CBSE class IX Social Science** states learning outcomes in a column of the same table as\n"
        "  the topics. The two columns interleave in the extracted text, so that file records the\n"
        "  topics and names the pages where the outcomes live, rather than transcribing them with\n"
        "  losses.\n"
    )
    w(
        "- **Where a board's own document has a typo, the typo is kept.** The file records what the\n"
        "  board published.\n"
    )
    w(
        "- **Coverage is classes 6 to 12.** `docs/CURRICULUM.md` section 11 scopes grades 4 to 13.\n"
        "  Classes 1 to 5 and the year 13 equivalents are not built here.\n"
    )
    w("## Next\n")
    w(
        "1. Re-derive the CISCE topic layer off the booklets' bracket structure and have a second\n"
        "   reader confirm the unit to topic mapping.\n"
        "2. Work the blocked files: each names a portal and a blocker code, and running the\n"
        "   discovery job in `docs/CURRICULUM.md` section 4 with a browser-capable fetcher against\n"
        "   that portal is the next step, followed by extraction from the prescribed textbook's own\n"
        "   contents page, the way the CBSE middle-stage files here were built.\n"
        "3. Then, and only then, take files through the section 4.5 promotion that earns `verified`.\n"
    )
    w("## The toolchain\n")
    w(
        "`tools/migrate_2026_09_03.py` is the repair pass that produced the current shape of these\n"
        "files, and `tools/build_readme.py` regenerates this README from them, so every count above\n"
        "is read out of the data rather than typed. The fetchers and the per-board extractors that\n"
        "built the first cut are in `tools/extract/`.\n"
    )
    with open(os.path.join(ROOT, "README.md"), "w") as fh:
        fh.write("\n".join(L).rstrip() + "\n")
    print("wrote README.md", len(L), "blocks")


if __name__ == "__main__":
    main()
