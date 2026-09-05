"""Parse a NIOS 'Bifurcation of Syllabus' table into modules with numbered lessons."""

import os
import re
import sys
from pathlib import Path

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODLINE = re.compile(
    r"^\s{0,4}(?:\d{1,2}\s*\.\s*)?Module\s*[-–]?\s*([IVXLC]+|\d+)\s*:?\s*(.*)$", re.I
)
ITEM = re.compile(
    r"(?:^|\s\s)\s*(?:L(?:esson)?\s*[-.–]?\s*(\d{1,2})|(\d{1,2})\.)\s*[:.]?\s*\(?\s*(\S.*?)\)?\s*$"
)
ITEM_ANY = re.compile(
    r"(?:L(?:esson)?\s*[-.–]?\s*(\d{1,2})\s*[:.]?\s*\(?|(?<![\d.])(\d{1,2})\.)\s*(?=\S)"
)
NUMMOD = re.compile(r"^\s{0,5}(\d{1,2})\.\s+([A-Z]\S.*)$")



def module_number(raw: str) -> str:
    """The module's roman numeral as the document means it, not as its type was set.

    The 2023 Mathematics (311) bifurcation prints the second module as "Module- ll": two
    lower-case letters L where II was meant. Read as a roman numeral that is "LL", which is not
    one (L never repeats), and the file carried it as a unit number a learner cannot read. A run
    of nothing but L is the typist's I, so it is read as that run of I; every other token is
    kept exactly as printed, upper-cased.
    """
    token = raw.strip()
    if token and set(token.lower()) == {"l"}:
        return "I" * len(token)
    return token.upper()

def _positions(lines):
    xs = []
    for ln in lines:
        for m in ITEM_ANY.finditer(ln):
            xs.append(m.start())
    return sorted(xs)


def parse(key):
    lines = (
        Path(HERE, "lay", key + ".txt").read_text(encoding="utf-8", errors="replace").split("\n")
    )
    page, pages = 1, []
    for ln in lines:
        pages.append(page)
        page += ln.count("\f")
    xs = _positions(lines)
    if not xs:
        return []
    cand = [x for x in xs if x >= 8]
    lw = max(0, (min(cand) if cand else min(xs)) - 1)
    right = [x for x in xs if x > lw + 14]
    gut = min(right) - 1 if right else lw + 40
    use_num = not any(MODLINE.match(ln.replace("\f", "")) for ln in lines)
    mods = []
    cur = None
    for i, ln in enumerate(lines):
        raw = ln.replace("\f", "").rstrip()
        m = NUMMOD.match(raw[:lw]) if use_num else MODLINE.match(raw)
        if m:
            cur = {
                "number": module_number(m.group(1)),
                "title_parts": [],
                "page": pages[i],
                "items": {},
                "last": {},
            }
            mods.append(cur)
            head = raw[:lw]
            hm = NUMMOD.match(head) if use_num else MODLINE.match(head)
            if hm and hm.group(2).strip():
                cur["title_parts"].append(hm.group(2).strip())
        elif cur is not None:
            label = raw[:lw].strip()
            if label and not ITEM_ANY.search(label) and not re.match(r"^\(", label):
                cur["title_parts"].append(label)
        if cur is None:
            continue
        # per-line column split: prefer the actual start of the right-hand item,
        # else the run of spaces that straddles the global gutter
        cut = None
        for mm in ITEM_ANY.finditer(raw):
            if mm.start() >= lw + 14:
                cut = mm.start()
                break
        if cut is None:
            for mm in re.finditer(r"\s{3,}", raw):
                if mm.start() <= gut + 6 and mm.end() >= gut - 6:
                    cut = mm.end()
            if cut is None:
                cut = len(raw) if len(raw) <= gut + 3 else gut
        cut = max(cut, lw + 1)
        raw[lw:]
        for ci, part in enumerate((raw[lw:cut], raw[cut:])):
            got = list(ITEM.finditer("  " + part)) or [m2 for m2 in [ITEM.match("  " + part)] if m2]
            if got:
                for mm in got:
                    n = int(mm.group(1) or mm.group(2))
                    cur["items"].setdefault(n, []).append(mm.group(3).strip())
                    cur["last"][ci] = n
            else:
                txt = part.strip()
                last = cur["last"].get(ci)
                toks = txt.split()
                junk = toks and sum(1 for x in toks if len(x) <= 2) * 2 > len(toks)
                if (
                    txt
                    and last is not None
                    and 0 < len(txt) < 70
                    and not junk
                    and not MODLINE.match(txt)
                    and re.search(r"[A-Za-z]{3}", txt)
                ):
                    cur["items"][last].append(txt)
    out = []
    for mo in mods:
        title = re.sub(r"\s{2,}", " ", " ".join(mo["title_parts"])).strip()
        title = re.sub(r"\(\s*(?:No\.\s*)?\d+\s*Lessons?\s*\)", "", title, flags=re.I)
        title = re.sub(r"(?<=[a-z]{2})(?=[A-Z][a-z])", " ", title)
        title = re.sub(r"\(\s*\d+\s*Marks?\s*\)", "", title, flags=re.I)
        title = re.sub(r"\s{2,}", " ", title).strip(" -:.")
        lessons = []
        for n in sorted(mo["items"]):
            t = re.sub(r"\s{2,}", " ", " ".join(mo["items"][n])).strip(" .;,")
            t = re.sub(r"\(\s*(?:No\.\s*)?\d+\s*Lessons?\s*\)", "", t, flags=re.I).strip()
            t = re.sub(r"(?<=[a-z]{2})(?=[A-Z][a-z])", " ", t)
            t = re.sub(r"\(\s*\d+\s*Marks?\s*\)", "", t, flags=re.I).strip(" -")
            if t.count(")") > t.count("("):
                t = t.replace(")", "", t.count(")") - t.count("("))
            t = t.strip(" -.;,")
            if t and not re.fullmatch(r"[\d\s.]+", t):
                lessons.append({"number": n, "title": t})
        if lessons:
            out.append(
                {"number": mo["number"], "title": title, "page": mo["page"], "lessons": lessons}
            )
    return out


if __name__ == "__main__":
    for m in parse(sys.argv[1]):
        print("== Module {}: {} (p{})".format(m["number"], m["title"], m["page"]))
        for c in m["lessons"]:
            print(f"     {c['number']:>2}. {c['title']}")
