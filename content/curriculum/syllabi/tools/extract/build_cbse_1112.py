"""CBSE classes 11 and 12, 2026-27: Physics, Chemistry, Biology, Mathematics."""

import re
import sys

sys.path.insert(0, "lib")
from build import doc, ref, syllabus, topic, unit, write
from coursestruct import parse
from prose import items, unit_blocks

FW = {
    "framework_id": "cbse",
    "framework_name": "Central Board of Secondary Education",
    "framework_kind": "national",
    "country": "IN",
    "version": "2026-27",
    "aliases": ["CBSE", "Central Board of Secondary Education, New Delhi"],
}
PUB = "Central Board of Secondary Education"
SPLITNOTE = (
    "Where a unit's contents are stated as one run of prose, the topics below are that "
    "prose split at its own commas, semicolons and full stops; every topic string is "
    "verbatim, only the boundaries are ours, and the unit keeps the untouched prose in "
    "`contents`."
)

DOCS = {
    "physics": doc(
        "cbse_1112_physics",
        "Physics, Classes XI and XII, Secondary Curriculum Part 2, 2026-27",
        PUB,
    ),
    "chemistry": doc(
        "cbse_1112_chemistry",
        "Chemistry, Classes XI and XII, Secondary Curriculum Part 2, 2026-27",
        PUB,
    ),
    "biology": doc(
        "cbse_1112_biology",
        "Biology, Classes XI and XII, Secondary Curriculum Part 2, 2026-27",
        PUB,
    ),
    "mathematics": doc(
        "cbse_1112_maths",
        "Mathematics, Classes XI and XII, Secondary Curriculum Part 2, 2026-27",
        PUB,
    ),
}
DID = {
    "physics": "cbse-1112-physics",
    "chemistry": "cbse-1112-chemistry",
    "biology": "cbse-1112-biology",
    "mathematics": "cbse-1112-maths",
}
CHAP_SUB = r"^\s*Chapter[\s\-–]*(\d+)\s*:\s*(.+?)\s*$"
NUM_SUB = r"^\s*(\d+)\.\s{2,}(.+?)\s*$"


def build_from_blocks(subject, level, order, blocks, marks, note, structure_page):
    did = DID[subject]
    units = []
    for u in blocks:
        tops = []
        if u["subs"]:
            for s in u["subs"]:
                kw = {"contents": s["text"]} if s["text"] else {}
                tops.append(
                    topic(
                        s["title"],
                        source_ref=ref(
                            did,
                            page=s["page"],
                            section="Unit {}: {}, chapter {}".format(
                                u["key"], u["title"], s["number"]
                            ),
                        ),
                        chapter_number=int(s["number"]),
                        **kw,
                    )
                )
        else:
            for it in items(u["text"]):
                tops.append(
                    topic(
                        it,
                        source_ref=ref(
                            did, page=u["page"], section="Unit {}: {}".format(u["key"], u["title"])
                        ),
                    )
                )
        kw = {}
        if u["text"] and not u["subs"]:
            kw["contents"] = u["text"]
        m = marks.get(u["key"])
        if m:
            kw["marks"] = m
        units.append(
            unit(
                u["title"],
                ref(did, page=u["page"], section="Unit {}".format(u["key"])),
                topics=tops,
                unit_number=u["key"],
                **kw,
            )
        )
    return syllabus(
        **FW,
        level=level,
        level_order=order,
        subject=subject.capitalize(),
        status="verified",
        documents=[DOCS[subject]],
        units=units,
        note=note,
    )


# ---------------------------------------------------------------- physics
PHY_NOTE = (
    "Units and chapters are the course structure table; each chapter carries the detailed "
    "contents the document states for it. The table prints one marks figure per bracketed group "
    "of units, never per unit: `marks_group` on every unit names the units that share the "
    "figure and the figure itself, read off the table's drawn cell borders on the cited page, "
    "and no unit carries a figure of its own. The groups sum to the table's total of 70. "
    + SPLITNOTE
)
# The marks groups, read off the rendered course-structure pages (2 and 12) on 2026-09-05. The
# text layer cannot see them: the figure is printed once, vertically centred on a bracket that the
# table draws as a merged cell, so `coursestruct.parse` lands it on whichever unit's row it falls
# beside (Kinematics 23, Thermodynamics 20 ...) and leaves the group's other units at null. That
# is what the first cut recorded, and a learner read "Gravitation, no marks". The groups below
# are the brackets as drawn; each sums to the document's 70.
PHY_MARKS_GROUPS = {
    "Class 11": [
        (("I", "II", "III"), 23),
        (("IV", "V", "VI"), 17),
        (("VII", "VIII", "IX"), 20),
        (("X",), 10),
    ],
    "Class 12": [
        (("I", "II"), 16),
        (("III", "IV"), 17),
        (("V", "VI", "VII"), 18),
        (("VIII",), 12),
        (("IX",), 7),
    ],
}
for _level, _groups in PHY_MARKS_GROUPS.items():
    assert sum(marks for _, marks in _groups) == 70, _level


def norm(x):
    return re.sub(r"[^a-z]", "", x.lower()).rstrip("s").replace("behavior", "behaviour")


for level, order, ta, tb, da, db in [
    ("Class 11", 11, 48, 101, 102, 258),
    ("Class 12", 12, 436, 486, 487, 645),
]:
    cs = parse("cbse_1112_physics", ta, tb)
    detail = {
        u["key"]: u
        for u in unit_blocks(
            "cbse_1112_physics",
            da,
            db,
            unit_re=r"^\s*Unit\s+([IVXLC]+)\s*:\s*(.+?)\s*$",
            sub_re=r"^\s*Chapter\s*[–\-—]\s*(\d+)\s*:\s*(.+?)\s*$",
        )
    }
    units = []
    for u in cs:
        d = detail.get(u["roman"])
        if d and norm(d["title"]) != norm(u["title"]):
            d = next((x for x in detail.values() if norm(x["title"]) == norm(u["title"])), None)
        subs = {int(x["number"]): x for x in (d["subs"] if d else [])}
        tops = []
        for c in u["chapters"]:
            sub = subs.get(c["number"])
            kwt = {"contents": sub["text"]} if sub and sub["text"] else {}
            tops.append(
                topic(
                    c["title"],
                    chapter_number=c["number"],
                    source_ref=ref(
                        "cbse-1112-physics",
                        page=(sub["page"] if sub else c["page"]),
                        section=f"Unit {u['roman']}: {u['title']}, chapter {c['number']}",
                    ),
                    **kwt,
                )
            )
        kw = {}
        if d and d["text"]:
            kw["contents"] = d["text"]
        # Never the figure the text layer landed on this row: the group it belongs to.
        group_units, group_marks = next(
            (g, m) for g, m in PHY_MARKS_GROUPS[level] if u["roman"] in g
        )
        kw["marks_group"] = {"units": list(group_units), "marks": group_marks}
        units.append(
            unit(
                u["title"],
                ref(
                    "cbse-1112-physics",
                    page=u["page"],
                    section="Course structure {}, Unit {}".format(level, u["roman"]),
                ),
                topics=tops,
                unit_number=u["roman"],
                **kw,
            )
        )
    write(
        "cbse/{}-physics.json".format(level.lower().replace(" ", "-")),
        syllabus(
            **FW,
            level=level,
            level_order=order,
            subject="Physics",
            status="verified",
            documents=[DOCS["physics"]],
            units=units,
            note=PHY_NOTE,
        ),
    )

# ---------------------------------------------------------------- chemistry
CHEM_MARKS_XI = {"1": 7, "2": 9, "3": 6, "4": 7, "5": 9, "6": 7, "7": 4, "8": 11, "9": 10}
CHEM_MARKS_XII = {"1": 7, "2": 9, "3": 7, "4": 7, "5": 7, "6": 6, "7": 6, "8": 8, "9": 6, "10": 7}
CHEM_NOTE = (
    "Units and marks are the course structure table; the unit contents are the "
    "document's own prose. " + SPLITNOTE
)
write(
    "cbse/class-11-chemistry.json",
    build_from_blocks(
        "chemistry",
        "Class 11",
        11,
        unit_blocks("cbse_1112_chemistry", 66, 150),
        CHEM_MARKS_XI,
        CHEM_NOTE,
        2,
    ),
)
write(
    "cbse/class-12-chemistry.json",
    build_from_blocks(
        "chemistry",
        "Class 12",
        12,
        unit_blocks("cbse_1112_chemistry", 325, 405),
        CHEM_MARKS_XII,
        CHEM_NOTE,
        9,
    ),
)

# ---------------------------------------------------------------- biology
BIO_MARKS_XI = {"I": 15, "II": 10, "III": 15, "IV": 12, "V": 18}
BIO_MARKS_XII = {"VI": 16, "VII": 20, "VIII": 12, "IX": 12, "X": 10}
BIO_NOTE = (
    "Units and marks are the course structure table; topics are the document's own "
    "chapters, each carrying the contents stated for it verbatim."
)
write(
    "cbse/class-11-biology.json",
    build_from_blocks(
        "biology",
        "Class 11",
        11,
        unit_blocks("cbse_1112_biology", 115, 228, sub_re=CHAP_SUB),
        BIO_MARKS_XI,
        BIO_NOTE,
        3,
    ),
)
write(
    "cbse/class-12-biology.json",
    build_from_blocks(
        "biology",
        "Class 12",
        12,
        unit_blocks("cbse_1112_biology", 347, 452, sub_re=CHAP_SUB),
        BIO_MARKS_XII,
        BIO_NOTE,
        10,
    ),
)

# ---------------------------------------------------------------- mathematics
MATH_MARKS_XI = {"I": 23, "II": 25, "III": 12, "IV": 8, "V": 12}
MATH_MARKS_XII = {"I": 8, "II": 10, "III": 35, "IV": 14, "V": 5, "VI": 8}
MATH_NOTE = (
    "Units and marks are the course structure table; topics are the document's own "
    "numbered chapters, each carrying the contents stated for it verbatim. The Class XI "
    "table carries the board's note that there is no chapter-wise weightage inside a unit."
)
write(
    "cbse/class-11-mathematics.json",
    build_from_blocks(
        "mathematics",
        "Class 11",
        11,
        unit_blocks(
            "cbse_1112_maths",
            54,
            165,
            unit_re=r"^\s*Unit[-\s]+([IVXLC]+)\s*:?\s+(.+?)\s*$",
            sub_re=NUM_SUB,
        ),
        MATH_MARKS_XI,
        MATH_NOTE,
        1,
    ),
)
write(
    "cbse/class-12-mathematics.json",
    build_from_blocks(
        "mathematics",
        "Class 12",
        12,
        unit_blocks(
            "cbse_1112_maths",
            282,
            391,
            unit_re=r"^\s*Unit[-\s]+([IVXLC]+)\s*:?\s+(.+?)\s*$",
            sub_re=NUM_SUB,
        ),
        MATH_MARKS_XII,
        MATH_NOTE,
        6,
    ),
)
