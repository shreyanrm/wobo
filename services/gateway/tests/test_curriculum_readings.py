"""Readings corrected against the board's own pages on 2026-09-05, held so they cannot drift back.

Each test names one thing a file used to say that the source does not, and fails on the file as
it was. The source refs were re-read off the rendered pages (not the text layer) of documents
whose sha256 matches what each file records; the page numbers are the physical pages pdftotext
and pypdf count, the same numbers the verification pass checks citations against.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

SYLLABI = Path(__file__).resolve().parents[3] / "content" / "curriculum" / "syllabi"


def _load(rel: str) -> dict:
    return json.loads((SYLLABI / rel).read_text(encoding="utf-8"))


def _topics(document: dict) -> dict[str, dict]:
    return {t["name"]: t for u in document["units"] for t in u["topics"]}


# --- CBSE class 10 science: what is examined ---------------------------------------------------


def test_cbse_10_science_marks_formative_only_what_the_document_boxes() -> None:
    """Science_SecP1_2026-27.pdf draws three boxes headed "assessed only formatively": Periodic
    Classification of Elements (page 4), Evolution (page 5), and Motor, Electromagnetic
    Induction, Electric Generator (page 6). Its Note for Teachers on page 6 names what is not
    examined. The first cut read a one-space indent in the text layer as the box and so told a
    board candidate that Acids, Bases and Salts (25-mark Unit I, three practicals under it), the
    human eye and the prism (Unit III) are not examined. They are."""
    topics = _topics(_load("cbse/class-10-science.json"))
    boxed = {
        "Periodic Classification of Elements",
        "Evolution",
        "Motor, Electromagnetic Induction, Electric Generator",
    }
    for name in boxed:
        assert "assessed only formatively" in topics[name]["assessment"], name
        assert "Note for Teachers" in topics[name]["assessment"], name
    for name in (
        "Acids, Bases and Salts",
        "Functioning of a lens in human eye",
        "Refraction of light through a prism",
        "Chemical Reactions and Equations",
        "Metals and Non-metals",
        "Reflection of light by curved surfaces",
        "Electric current",
        "Magnetic effects of current",
        "Our environment",
    ):
        assert "assessment" not in topics[name], (
            f"{name} is examined; the document boxes it nowhere"
        )
    # Heredity: the prose and the Note for Teachers disagree, and the file says so rather than
    # choosing for the document.
    assert "does not resolve" in topics["Heredity"]["assessment"]
    assert "Heredity and Evolution" in topics["Heredity"]["assessment"]


def test_cbse_10_science_cites_the_pages_the_document_prints_on() -> None:
    """The course structure is page 4 and the prose runs pages 4 to 6; the first cut cited 6 to
    8, two pages off every name, which the verification pass recorded as a failed check under a
    ``verified`` label."""
    document = _load("cbse/class-10-science.json")
    for unit in document["units"]:
        assert unit["source_ref"]["page"] == 4, unit["name"]
    pages = {t["name"]: t["source_ref"]["page"] for t in _topics(document).values()}
    assert pages["Chemical Reactions and Equations"] == 4
    assert pages["Acids, Bases and Salts"] == 4
    assert pages["Metals and Non-metals"] == 5
    assert pages["Heredity"] == 5
    assert pages["Reflection of light by curved surfaces"] == 5
    assert pages["Functioning of a lens in human eye"] == 6
    assert pages["Motor, Electromagnetic Induction, Electric Generator"] == 6
    assert pages["Our environment"] == 6
    assert document["provenance"]["checks_failed"] == []
    assert "every_name_is_on_its_cited_page" in document["provenance"]["checks_passed"]


# --- CBSE physics: marks belong to a bracketed group, never to one unit ------------------------


@pytest.mark.parametrize(
    ("rel", "groups"),
    [
        (
            "cbse/class-11-physics.json",
            [
                (("I", "II", "III"), 23),
                (("IV", "V", "VI"), 17),
                (("VII", "VIII", "IX"), 20),
                (("X",), 10),
            ],
        ),
        (
            "cbse/class-12-physics.json",
            [
                (("I", "II"), 16),
                (("III", "IV"), 17),
                (("V", "VI", "VII"), 18),
                (("VIII",), 12),
                (("IX",), 7),
            ],
        ),
    ],
)
def test_cbse_physics_marks_are_recorded_per_bracketed_group(rel: str, groups: list) -> None:
    """Physics_SecP2_2026-27.pdf pages 2 and 12 print one figure per bracket of units. The first
    cut landed each figure on whichever unit's row it was printed beside and left the group's
    other units at null, so a learner read "Thermodynamics 20 marks, Gravitation no marks"."""
    document = _load(rel)
    by_number = {u["unit_number"]: u for u in document["units"]}
    assert sum(marks for _, marks in groups) == 70
    for units, marks in groups:
        for number in units:
            unit = by_number[number]
            assert "marks" not in unit, f"unit {number} carries a figure the table gives a group"
            assert unit["marks_group"] == {"units": list(units), "marks": marks}, number
    assert "marks_group" in document["note"]


# --- NIOS: a unit number a learner can read ----------------------------------------------------


def test_nios_12_mathematics_reads_the_misprinted_module_as_ii() -> None:
    """311Bifurcation.pdf prints "Module- ll" (two lower-case L) for the second module; the file
    carried "LL" as its unit number."""
    document = _load("nios/class-12-mathematics.json")
    numbers = [u["unit_number"] for u in document["units"]]
    assert numbers == ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]
    for unit in document["units"]:
        assert re.fullmatch(
            r"M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})", unit["unit_number"]
        )
        assert f"Module {unit['unit_number']}" == unit["source_ref"]["section"]
    assert "Module- ll" in document["note"]


def test_the_nios_parser_reads_a_run_of_ls_as_the_typists_is() -> None:
    import sys

    sys.path.insert(0, str(SYLLABI / "tools" / "extract" / "lib"))
    from niosbif import module_number

    assert module_number("ll") == "II"
    assert module_number("LL") == "II"
    assert module_number("l") == "I"
    assert module_number("III") == "III"
    assert module_number("vii") == "VII"
    assert module_number("7") == "7"
