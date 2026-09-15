"""Biology and social science at the board — cells, food webs, Punnett squares, timelines, maps.

These are the domains where the danger is not arithmetic but invention: a label that sounds right,
a date that is nearly right, a state on a map that is not on the map. So nothing here is written
from the model's memory. Labels come from a curated parts table cross-checked against the brain's
fact base; a Punnett square's cells and ratio come from :mod:`wobo_gateway.plexus.bio`; a map
is refused unless the brain's existing map validator accepts the scene; a timeline's dates must
survive an ordering and plausibility check before a single tick is drawn.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from wobo_verifier.gate import CheckResult

from wobo_gateway.board import verify
from wobo_gateway.board.pipelines import (
    FIGURE,
    FIGURE_MID,
    MAX_NOTE_CHARS,
    Draft,
    Frame,
    accent,
    arrow_to,
    board,
    faint,
    on,
    wobo,
)
from wobo_gateway.board.verify import Unverified

#: The parts of the diagrams Wobo is asked for most, in the order a teacher labels them (outside
#: in), EACH WITH THE PLACE IT SITS AND THE SHAPE IT IS. Curated rather than generated, and
#: cross-checked against the fact base when it covers the concept — a label Wobo cannot support is
#: not drawn.
#:
#: The geometry is here because a label needs something to point AT. This module used to draw an
#: outline, a nucleus and nothing else, then hang every other name off a leader that started at the
#: middle of the cell: seven arrows out of one point, none of them touching the thing it named, on
#: a board that had been asked for five (the evidence lab, 2026-09-09,
#: `turns/scratch/bio-plant-cell-1440`). A diagram whose labels do not land on their parts is not a
#: diagram of anything.
#:
#: Positions and sizes are fractions of the body box, so the whole figure scales with
#: :data:`wobo_gateway.board.pipelines.FIGURE` and never with the board.


@dataclass(frozen=True)
class Part:
    """One named part of a diagram: what it is, where it sits, and which way its label runs."""

    name: str
    #: The centre of the part, as a fraction of the body box.
    at: tuple[float, float]
    #: Its half-width and half-height, as a fraction of the body box. Zero for a part that is a
    #: place rather than a shape (the cytoplasm is the space between the organelles).
    size: tuple[float, float] = (0.0, 0.0)
    #: "ellipse", "rect", or "none" for a part the body itself already draws.
    shape: str = "ellipse"
    #: Which side of the figure its label sits on.
    side: str = "right"


@dataclass(frozen=True)
class Diagram:
    """A labelled diagram: the body it is drawn on, and its parts outside in."""

    body: str  # "ellipse" | "rect" | "free"
    parts: tuple[Part, ...]
    #: WHICH PARTS SURVIVE A SMALLER ASK, MOST TELLING FIRST (the adversary, 2026-09-09, finding 6).
    #:
    #: "Draw a plant cell with five labels" returned cell wall, cell membrane, cytoplasm, nucleus
    #: and chloroplast, and no vacuole. Four of those five are on an animal cell too, so the
    #: drawing did not read as a plant cell — which is the one thing that ask was for.
    #:
    #: Outside in is the order a teacher LABELS a cell, and :meth:`teaching_order` leaves the
    #: drawing in it. It is not the order a teacher CHOOSES five from seven. When a diagram names
    #: an order here, that is the order the trim reads; when it does not, outside in stands.
    first: tuple[str, ...] = ()

    def teaching_order(self) -> list[str]:
        """The parts, most telling first — the order a smaller ask is answered in."""
        names = [p.name for p in self.parts]
        if not self.first:
            return names
        ranked = [n for n in self.first if n in names]
        return ranked + [n for n in names if n not in ranked]


CELL_DIAGRAMS: dict[str, Diagram] = {
    "animal cell": Diagram(
        "ellipse",
        (
            Part("cell membrane", (0.5, 0.5), (0.5, 0.5), "none", "left"),
            Part("cytoplasm", (0.30, 0.76), (0.0, 0.0), "none", "left"),
            Part("nucleus", (0.46, 0.42), (0.16, 0.16), "ellipse", "right"),
            Part("mitochondrion", (0.24, 0.30), (0.10, 0.06), "ellipse", "left"),
            Part("ribosome", (0.70, 0.24), (0.035, 0.045), "ellipse", "right"),
            Part("endoplasmic reticulum", (0.72, 0.52), (0.12, 0.07), "rect", "right"),
            Part("golgi apparatus", (0.70, 0.75), (0.11, 0.05), "rect", "right"),
            Part("lysosome", (0.30, 0.62), (0.06, 0.07), "ellipse", "left"),
        ),
        # An animal cell is shown for the three every syllabus asks for first, then the organelles
        # that do the work, then the space between them.
        first=(
            "cell membrane",
            "nucleus",
            "mitochondrion",
            "cytoplasm",
            "ribosome",
            "endoplasmic reticulum",
            "golgi apparatus",
            "lysosome",
        ),
    ),
    "plant cell": Diagram(
        "rect",
        (
            Part("cell wall", (0.5, 0.5), (0.5, 0.5), "none", "left"),
            Part("cell membrane", (0.5, 0.5), (0.455, 0.44), "rect", "left"),
            Part("cytoplasm", (0.32, 0.83), (0.0, 0.0), "none", "left"),
            Part("nucleus", (0.42, 0.38), (0.15, 0.15), "ellipse", "right"),
            Part("chloroplast", (0.71, 0.27), (0.115, 0.06), "ellipse", "right"),
            Part("vacuole", (0.68, 0.68), (0.14, 0.16), "ellipse", "right"),
            Part("mitochondrion", (0.24, 0.30), (0.085, 0.05), "ellipse", "left"),
        ),
        # The wall, the vacuole and the chloroplasts are what a plant cell is shown FOR: they are
        # the three an animal cell does not have. The nucleus is the part every cell diagram
        # names, and the membrane comes next because the wall is only meaningful against it.
        # Cytoplasm is the space that is left when the rest are named, so it names itself last.
        first=(
            "cell wall",
            "nucleus",
            "vacuole",
            "chloroplast",
            "cell membrane",
            "mitochondrion",
            "cytoplasm",
        ),
    ),
    "neuron": Diagram(
        "free",
        (
            Part("dendrite", (0.09, 0.28), (0.06, 0.10), "ellipse", "left"),
            Part("cell body", (0.22, 0.50), (0.10, 0.17), "ellipse", "left"),
            Part("nucleus", (0.22, 0.50), (0.04, 0.06), "ellipse", "left"),
            Part("axon", (0.55, 0.50), (0.20, 0.02), "rect", "right"),
            Part("myelin sheath", (0.62, 0.50), (0.06, 0.06), "ellipse", "right"),
            Part("axon terminal", (0.88, 0.50), (0.07, 0.11), "ellipse", "right"),
        ),
    ),
    "leaf": Diagram(
        "rect",
        (
            Part("cuticle", (0.5, 0.06), (0.5, 0.05), "rect", "left"),
            Part("upper epidermis", (0.5, 0.19), (0.5, 0.08), "rect", "left"),
            Part("palisade mesophyll", (0.5, 0.40), (0.5, 0.13), "rect", "right"),
            Part("spongy mesophyll", (0.5, 0.68), (0.5, 0.15), "rect", "right"),
            Part("lower epidermis", (0.5, 0.89), (0.5, 0.07), "rect", "left"),
            Part("stoma", (0.62, 0.96), (0.05, 0.03), "ellipse", "right"),
        ),
    ),
}

#: The names alone, in the same order — what a plan may ask for by name.
CELL_PARTS: dict[str, tuple[str, ...]] = {
    subject: tuple(p.name for p in diagram.parts) for subject, diagram in CELL_DIAGRAMS.items()
}

#: The body a labelled diagram is drawn on, inside the figure box: narrower than the box, so the
#: labels that hang off it either side stay inside :data:`FIGURE_UNION`.
BODY_BOX = (
    FIGURE[0] + FIGURE[2] * 0.29,
    FIGURE[1] + FIGURE[3] * 0.06,
    FIGURE[2] * 0.42,
    FIGURE[3] * 0.88,
)

#: THE TIMELINES THE SYLLABUS ITSELF ASKS FOR. "Draw a timeline of the non-cooperation movement"
#: was refused for want of dates, honestly and with a reason — and a Class 10 learner asking it has
#: asked a chapter question, so the refusal was not rare, it was a gap (the adversary, 2026-09-09,
#: finding 7).
#:
#: Curated like :data:`CELL_DIAGRAMS`, and for the same reason: nothing here is a model's memory of
#: history. Every year and every label below is the board the product's own live pipeline drew for
#: "a timeline of the national movement", read back out of
#: ``harness/fixtures/social.cbse.10.timeline.json``, whose spoken line a teaching review corrected
#: by hand on 2026-09-05. A topic that is not in this table is still refused with its reason.
SYLLABUS_TIMELINES: dict[str, tuple[tuple[int, str], ...]] = {
    "non-cooperation movement": (
        (1919, "Jallianwala Bagh massacre"),
        (1920, "Non-Cooperation begins"),
        (1922, "Chauri Chaura, called off"),
    ),
    "civil disobedience movement": (
        (1930, "Dandi March"),
        (1931, "Gandhi-Irwin Pact"),
        (1932, "Poona Pact"),
    ),
    "quit india movement": (
        (1942, "Quit India Movement"),
        (1946, "Cabinet Mission"),
        (1947, "Independence and Partition"),
    ),
    "indian national movement": (
        (1919, "Jallianwala Bagh massacre"),
        (1920, "Non-Cooperation begins"),
        (1930, "Dandi March"),
        (1942, "Quit India Movement"),
        (1947, "Independence and Partition"),
    ),
}

#: The words a learner writes for each of them. A topic is only matched when the question names it.
_TIMELINE_WORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("non-cooperation movement", ("non-cooperation", "non cooperation", "noncooperation")),
    ("civil disobedience movement", ("civil disobedience", "dandi", "salt march")),
    ("quit india movement", ("quit india",)),
    (
        "indian national movement",
        ("national movement", "freedom struggle", "independence movement"),
    ),
)


def syllabus_timeline(question: str) -> list[dict[str, Any]]:
    """The curated events for the movement this question names, or nothing at all.

    Nothing is guessed: a question that names no topic in :data:`SYLLABUS_TIMELINES` gets an empty
    list, and the pipeline refuses it with the reason it always did.
    """
    asked = " ".join(str(question or "").lower().split())
    for topic, words in _TIMELINE_WORDS:
        if any(word in asked for word in words):
            return [{"year": year, "label": label} for year, label in SYLLABUS_TIMELINES[topic]]
    return []


_EARLIEST_YEAR = -4000
#: HOW MANY EVENTS A BOARD HAS ROWS FOR — MEASURED (the judge, wave 48, finding 1).
#:
#: An event's name is written on a row of its own (see :func:`_timeline`), so a timeline is as tall
#: as it has events, and two things run out as the rows pile up: the board, and the type. Both
#: were measured on the real screens rather than reasoned about, on a made-up seven-event ask at
#: 390 and 1440:
#:
#: * SEVEN. The ladder walks past the bottom of the board, where ``placeLabelAt`` stops walking and
#:   starts writing names ON TOP of each other — four of them stacked on one row at 390 with the
#:   line where it used to sit. Moving the line to the top of the figure box (:data:`_TIMELINE_Y`)
#:   buys the room and seven then ladder cleanly, but the ink is now so tall that the camera pulls
#:   back and the writing goes under INK-FOUR's twelve pixels: five of the seven names measure 9.9
#:   to 11.7 px at 1440, and the shortest measures 11.7 px at 390. Both themes, and the same under
#:   reduced motion.
#: * SIX. Clean at 390 and 1440, in light, in dark and under reduced motion: six rows, nothing
#:   shared, nothing under the chrome, every name 12.6 to 17.5 px.
#:
#: So six, and a seventh is refused with the reason it always gave. Fourteen was a number nobody
#: had measured, and it drew a pile.
_MAX_EVENTS = 6

#: WHERE THE LINE ITSELF SITS: at the TOP of the figure box, not through the middle of it.
#:
#: The years stagger upward off the ticks and the names ladder downward, so a timeline is a figure
#: that hangs almost entirely BELOW its own line, and centring the line wasted half the box on air
#: and cost the ladder the rows it needed (see :data:`_MAX_EVENTS`). Measured: it changes nothing
#: at all for a three- or five-event board — the camera fits the ink, so sliding the whole figure
#: up is invisible — and it is the difference between six names in six rows and three names in a
#: heap.
_TIMELINE_Y = FIGURE[1]
_MAX_NODES = 16


def build(intent: dict[str, Any], prefix: str, ask: str = "") -> Draft:
    op = str(intent.get("op") or "")
    handlers = {
        "cell": _cell,
        "food_web": _food_web,
        "punnett": _punnett,
        "timeline": _timeline,
        "map": _map,
    }
    handler = handlers.get(op)
    if handler is None:
        raise Unverified(f"biology and social science cannot draw {op!r}")
    return handler(intent, Draft(prefix, ask=ask))


def _cell(intent: dict[str, Any], draft: Draft) -> Draft:
    subject = str(intent.get("subject") or "animal cell").strip().lower()
    diagram = CELL_DIAGRAMS.get(subject)
    if diagram is None:
        raise Unverified(f"I do not have a verified parts list for {subject!r}")
    names = [p.name for p in diagram.parts]

    asked = [str(p).strip().lower() for p in (intent.get("parts") or []) if str(p).strip()]
    unknown = [p for p in asked if p not in names]
    if unknown:
        raise Unverified(f"these are not parts of a {subject}: {unknown[:3]}")
    # HOW MANY LABELS THE LEARNER ASKED FOR IS A GIVEN LIKE ANY OTHER. "Draw a plant cell with five
    # labels" came back with seven, because the count was in the sentence and nothing read the
    # sentence (the evidence lab, 2026-09-09). Outside in is the order a teacher labels a cell, so
    # the first five are the five a learner wants.
    wanted = draft.given("labels", intent.get("label_count"), "labels", "labelled", "label")
    if wanted is not None and not asked:
        try:
            count = int(float(wanted))
        except (TypeError, ValueError) as exc:
            raise Unverified("a number of labels is a whole number") from exc
        if not 1 <= count <= len(names):
            raise Unverified(
                f"a {subject} has {len(names)} parts I can prove, and {count} were asked for"
            )
        # MOST TELLING FIRST, not outside in: five labels on a plant cell that leave out the
        # vacuole draw a cell that could be an animal's (:attr:`Diagram.first`). The DRAWING order
        # is untouched — `drawn` below reads `diagram.parts`, which is still outside in.
        asked = diagram.teaching_order()[:count]
    if not asked:
        asked = names
    # The fact base is the second opinion where it covers the concept; where it does not, the
    # curated table above stands alone and the check is recorded rather than enforced.
    draft.ledger.note(verify.fact_supported(intent.get("concept_id") or subject, asked))

    left, top, width, height = BODY_BOX
    at = lambda fx, fy: board(left + width * fx, top + height * fy)  # noqa: E731

    body_id = None
    if diagram.body == "ellipse":
        body_id = draft.add(
            "ellipse",
            anchor=at(0.5, 0.5),
            rx=round(width / 2, 2),
            ry=round(height / 2, 2),
            style=wobo(2),
            hint="outline",
        )
    elif diagram.body == "rect":
        body_id = draft.add(
            "polygon",
            anchor=at(0.0, 0.0),
            points=[
                at(0.0, 0.0)["board"],
                at(1.0, 0.0)["board"],
                at(1.0, 1.0)["board"],
                at(0.0, 1.0)["board"],
            ],
            title=subject,
            style=wobo(2),
            hint="outline",
        )

    # EVERY LEADER STARTS ON THE PART IT NAMES. They all used to start at the middle of the cell,
    # so a "chloroplast" arrow and a "vacuole" arrow left the same point and neither touched
    # anything. Here each part is drawn where it is, and its leader runs from the part outward to
    # its own label — which is what makes the drawing worth reading.
    drawn = [p for p in diagram.parts if p.name in asked]
    # A LANE PER SIDE, IN THE ORDER THE PARTS SIT DOWN THE FIGURE. One lane counter for both sides
    # sent the nucleus's label to the bottom right and the chloroplast's below it, while both parts
    # were near the top, so their leaders crossed each other on the way out.
    lanes: dict[str, float] = {}
    for side in ("left", "right"):
        column = sorted([p for p in drawn if p.side == side], key=lambda p: p.at[1])
        for i, part in enumerate(column):
            lanes[part.name] = 0.12 + 0.76 * (i / (len(column) - 1)) if len(column) > 1 else 0.5
    for part in drawn:
        cx, cy = part.at
        rx, ry = part.size
        # A part that is a PLACE rather than a shape (the cytoplasm is the space between the
        # organelles) is pointed at where it is; a part the body itself draws (the wall, the
        # membrane) is pointed at through the body.
        target = body_id if rx > 0 else None
        if part.shape == "ellipse" and rx > 0:
            target = draft.add(
                "ellipse",
                anchor=at(cx, cy),
                rx=round(width * rx, 2),
                ry=round(height * ry, 2),
                style=accent(2) if part.name == "nucleus" else wobo(1),
                hint=part.name,
            )
        elif part.shape == "rect" and rx > 0:
            target = draft.add(
                "polygon",
                anchor=at(cx - rx, cy - ry),
                points=[
                    at(cx - rx, cy - ry)["board"],
                    at(cx + rx, cy - ry)["board"],
                    at(cx + rx, cy + ry)["board"],
                    at(cx - rx, cy + ry)["board"],
                ],
                style=wobo(1),
                hint=part.name,
            )
        outward = -0.18 if part.side == "left" else 1.18
        # A LEADER STOPS ON THE EDGE OF ITS PART THAT FACES ITS OWN LABEL. Tipping at the part's
        # CENTRE meant three arrows crossed the cell wall and ran into the interior of the plant
        # cell, and the one for the wall itself ended in the middle of the cell (the adversary,
        # 2026-09-09, finding 6). A part that is a PLACE rather than a shape — the cytoplasm is
        # the space between the organelles — is still pointed at where it is, which is inside.
        leader = arrow_to(
            draft,
            tip=at(cx, cy) if target is None else on(target, part.side),
            tail=at(outward, lanes[part.name]),
            style=faint(1),
            hint="leader",
        )
        draft.add(
            "label",
            anchor=on(leader, part.side),
            text=part.name[:MAX_NOTE_CHARS],
            style=accent(1) if part.name == "nucleus" else wobo(1),
            hint="part",
        )
    return draft


def _food_web(intent: dict[str, Any], draft: Draft) -> Draft:
    """Arrows point the way the energy goes. A web that eats itself is refused."""
    links = intent.get("links") or []
    if not isinstance(links, list) or not links:
        raise Unverified("a food web needs links")
    edges: list[tuple[str, str]] = []
    for link in links:
        if not isinstance(link, dict):
            raise Unverified("each link is an eaten and an eater")
        eaten = str(link.get("from") or "").strip()[:MAX_NOTE_CHARS]
        eater = str(link.get("to") or "").strip()[:MAX_NOTE_CHARS]
        if not eaten or not eater or eaten == eater:
            raise Unverified("a link joins two different organisms")
        edges.append((eaten, eater))
    names: list[str] = []
    for eaten, eater in edges:
        for name in (eaten, eater):
            if name not in names:
                names.append(name)
    if len(names) > _MAX_NODES:
        raise Unverified(f"{len(names)} organisms is more than one board")

    levels = _trophic_levels(names, edges)
    if levels is None:
        raise Unverified("energy cannot flow in a circle — this web feeds on itself")
    draft.ledger.record(
        CheckResult(
            name="board.energy_flows_one_way",
            passed=True,
            detail=f"{len(names)} organisms over {max(levels.values()) + 1} trophic levels",
        )
    )
    depth = max(levels.values()) + 1
    by_level: dict[int, list[str]] = {}
    for name, level in levels.items():
        by_level.setdefault(level, []).append(name)

    left, top, width, height = FIGURE
    node_w = min(150.0, width / 3.2)
    node_h = min(54.0, height / 4.4)
    ids: dict[str, str] = {}
    for level, group in sorted(by_level.items()):
        y = top + height - node_h - (level * ((height - node_h) / max(1, depth - 1 or 1)))
        for i, name in enumerate(sorted(group)):
            x = left + (i + 1) * (width / (len(group) + 1)) - node_w / 2
            node = draft.add(
                "region",
                anchor=board(x, y),
                w=round(node_w, 2),
                h=round(node_h, 2),
                title=name,
                style=wobo(2) if level else accent(2),
                hint="node",
            )
            ids[name] = node
    for eaten, eater in edges:
        arrow_to(
            draft,
            tip=on(ids[eater], "bottom"),
            tail=on(ids[eaten], "top"),
            style=accent(1),
            hint="energy",
        )
    draft.add(
        "write",
        anchor=board(FIGURE_MID[0], FIGURE[1] + FIGURE[3] + 26.0),
        text="energy goes this way",
        style=faint(1),
        hint="legend",
    )
    return draft


def _trophic_levels(names: list[str], edges: list[tuple[str, str]]) -> dict[str, int] | None:
    """Longest path from a producer to each organism, or None when the web contains a cycle."""
    incoming: dict[str, int] = dict.fromkeys(names, 0)
    outgoing: dict[str, list[str]] = {n: [] for n in names}
    for eaten, eater in edges:
        outgoing[eaten].append(eater)
        incoming[eater] += 1
    level = dict.fromkeys(names, 0)
    queue = [n for n in names if incoming[n] == 0]
    seen = 0
    while queue:
        current = queue.pop(0)
        seen += 1
        for nxt in outgoing[current]:
            level[nxt] = max(level[nxt], level[current] + 1)
            incoming[nxt] -= 1
            if incoming[nxt] == 0:
                queue.append(nxt)
    return level if seen == len(names) else None


def _punnett(intent: dict[str, Any], draft: Draft) -> Draft:
    from wobo_gateway.plexus.bio import phenotype_ratio, punnett_cross, valid_genotype

    a = str(intent.get("parent_a") or "").strip()
    b = str(intent.get("parent_b") or "").strip()
    if not valid_genotype(a) or not valid_genotype(b):
        raise Unverified("both parents need a genotype like Aa")
    cells = punnett_cross(a, b)
    if not cells or len(cells) != 4:
        raise Unverified("that cross does not produce a square")
    dominant, recessive = phenotype_ratio(cells)
    draft.ledger.record(verify.numbers_agree("punnett cells", dominant + recessive, 4.0))
    # The GENOTYPE ratio too, under its own name. A live turn said "the square shows the genotype
    # ratio" over a board that carried only the 3 and the 1: every number verified, the name wrong.
    # With both ratios drawn and labelled there is nothing for a sentence to misname.
    genotypes: list[tuple[str, int]] = []
    for cell in cells:
        for i, (name, count) in enumerate(genotypes):
            if name == cell:
                genotypes[i] = (name, count + 1)
                break
        else:
            genotypes.append((cell, 1))
    genotype_check = draft.ledger.record(
        verify.numbers_agree("genotype counts", float(sum(n for _, n in genotypes)), 4.0)
    )

    # A PUNNETT SQUARE IS A SQUARE, WITH A BLANK CORNER. This drew a three-by-two table whose
    # second column already held two of the four offspring, printed by the grid itself; the hand
    # then wrote all four on top, so two genotypes appeared twice and the figure was not the
    # figure the chapter teaches (the evidence lab, 2026-09-09, `turns/scratch/bio-punnett-1440`).
    # The corner is empty because nothing belongs there: the gametes of one parent run along the
    # top, the other's down the side, and the four cells are what the learner fills in.
    side = FIGURE[3] * 0.9
    table = draft.add(
        "table",
        anchor=board(FIGURE_MID[0] - side / 2, FIGURE_MID[1] - side / 2),
        rows=[["", a[0], a[1]], [b[0], "", ""], [b[1], "", ""]],
        w=round(side, 2),
        rowHeight=round(side / 3, 2),
        style=wobo(2),
        hint="square",
    )
    # The four cells are filled one at a time, which is how the square is taught — and they are
    # written into the blanks the grid left for them, at the middle of each inner cell.
    for i, cell in enumerate(cells):
        draft.add(
            "write",
            anchor=on(table, [(1 + i % 2) / 3 + 0.10, (1 + i // 2) / 3 + 0.06]),
            text=cell,
            style=accent(2),
            hint="cell",
            dur=320,
        )
    # THE RATIO BELONGS TO THE WHOLE SQUARE, SO IT IS WRITTEN UNDER THE WHOLE SQUARE. "recessive 1"
    # used to hang off the square's right-hand side, outside the grid, annotating nothing, with
    # "dominant 3" below-left of it (the adversary, 2026-09-09, finding 5). Under the two bottom
    # corners they read as one ratio, left to right, the way a teacher writes 3 : 1.
    draft.number(
        dominant,
        "board.numbers_agree:punnett cells",
        anchor=on(table, "bottomLeft"),
        decimals=0,
        label="dominant",
        style=accent(2),
    )
    draft.number(
        recessive,
        "board.numbers_agree:punnett cells",
        anchor=on(table, "bottomRight"),
        decimals=0,
        label="recessive",
        style=wobo(2),
    )
    # The genotype counts go ABOVE the square. Hung under the phenotype ratio they made a third
    # line stacked below it, and the placer walked the whole column down off the bottom of the
    # panel at 390. Above the grid there is nothing, and a count of what is inside reads as the
    # square's own title.
    draft.add(
        "write",
        anchor=on(table, "top"),
        text="genotypes " + " : ".join(f"{count} {name}" for name, count in genotypes),
        check=genotype_check.name,
        style=faint(1),
        hint="genotypes",
    )
    return draft


def _timeline(intent: dict[str, Any], draft: Draft) -> Draft:
    raw = intent.get("events") or []
    if not isinstance(raw, list) or len(raw) < 2:
        # `turns/scratch/social-timeline-1440`: "draw a timeline of the non-cooperation movement"
        # drew nothing at all and Wobo said "which step feels shaky". A timeline whose dates
        # nobody has given is not a drawing Wobo may invent — it is a refusal with a reason, and
        # the reason says exactly what would let it be drawn.
        raise Unverified(
            "a timeline needs at least two events with their years, and this one gives "
            f"{len(raw) if isinstance(raw, list) else 0}"
        )
    if len(raw) > _MAX_EVENTS:
        raise Unverified(f"{len(raw)} events is more than one board")
    horizon = datetime.now(UTC).year + 1
    events: list[tuple[int, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise Unverified("each event is a year and a label")
        try:
            year = int(item.get("year"))
        except (TypeError, ValueError) as exc:
            raise Unverified("each event needs a whole year") from exc
        label = str(item.get("label") or "").strip()[:MAX_NOTE_CHARS]
        if not label:
            raise Unverified("each event needs a label")
        draft.ledger.record(verify.in_bounds(f"year {year}", year, _EARLIEST_YEAR, horizon))
        events.append((year, label))
    events.sort()
    if len({y for y, _ in events}) != len(events):
        raise Unverified("two events share a year, so the line cannot order them")

    lo, hi = events[0][0], events[-1][0]
    frame = Frame(
        x0=FIGURE[0],
        y0=_TIMELINE_Y,
        w=FIGURE[2],
        h=1.0,
        xmin=float(lo),
        xmax=float(hi),
        ymin=0.0,
        ymax=1.0,
    )
    line = draft.add(
        "line",
        anchor=board(*frame.at(lo, 0)),
        to=board(*frame.at(hi, 0)),
        style=wobo(2),
        hint="timeline",
    )
    # THE EVENT NAMES ARE A LADDER, NOT A ROW (the judge, wave 48, finding 1).
    #
    # Each name used to hang off its own tick at ``bottom`` and nothing else, which left WHICH
    # NAMES SHARE A ROW to the client's collision walk, and that walk only moves a label when the
    # boxes actually overlap. Measured on the real screens at 390, in light, in dark and under
    # reduced motion: "Jallianwala Bagh massacre" at x 41-198 and "Chauri Chaura, called off" at
    # x 205-352 on the SAME row — seven pixels between two different events' names, reading as one
    # run-on line — while "Non-Cooperation begins" was bumped 27 px down. The same plan at 1440
    # put that pair 55 px apart and read fine; the five-event national movement board ladders
    # cleanly at 390 and runs "Dandi March" into "Independence and Partition" with three pixels to
    # spare at 1440. So the board a learner read was a different board on a different screen.
    #
    # THE FIX IS A LEFT MARGIN, NOT A ROW HEIGHT. Every name asks to be written at the SAME left
    # edge — the first tick's — so every pair of them overlaps where it is asked for, and the
    # client's own walk steps each one down by one REAL line height at whatever size that screen's
    # type ladder chose. One event, one row, in the order the years run, identical at 390 and 1440.
    #
    # A row height cannot be chosen here: written type is scaled by the board's own ladder up to
    # twice its planned size (``MAX_TYPE_SCALE``), so a row is 37 board units on one screen and 64
    # on another, and a nudge in board units would be wrong on one of them. The nudge is sideways
    # only; the vertical step belongs to the hand that knows how big it is writing.
    #
    # It is a nudge on the anchor rather than a re-anchoring, so the name still belongs to the
    # tick of its own event — which is what the say is reconciled against, what the renderer's
    # dependency order reads, and what makes the name fade with the mark it names.
    left = frame.at(lo, 0)[0]
    for year, label in events:
        at_x, at_y = frame.at(year, 0)
        tick = draft.add("point", anchor=board(at_x, at_y), style=accent(3), hint="tick")
        # The check's name carries the year, because that is how it was RECORDED above
        # (``verify.in_bounds(f"year {year}", ...)`` -> ``board.in_bounds:year 1919``). Writing the
        # bare ``board.in_bounds:year`` here named a check that never ran, so the planner's own law
        # refused every number and the learner got a timeline with no dates on it. Found by the
        # teaching harness, 2026-09-05, on "a timeline of the national movement".
        draft.number(
            year, f"board.in_bounds:year {year}", anchor=on(tick, "top"), decimals=0, style=wobo(1)
        )
        draft.add(
            "label",
            anchor={**on(tick, "bottom"), "offset": [round(left - at_x, 2), 0.0]},
            text=label,
            style=faint(1),
            hint="event",
        )
    draft.add("underline", anchor=on(line), style=faint(1), hint="span")
    return draft


def known_region(name: str) -> bool:
    """Is this a region the brain's bundled map geometry actually holds?

    Asked through the validator rather than by reaching into its table, so there is one answer to
    "is this on the map" and it is the one that gates the drawing.
    """
    from wobo_gateway.plexus.maps import verify_map_scene

    slug = str(name or "").strip().lower()
    if not slug:
        return False
    return (
        verify_map_scene(
            {
                "kind": "map",
                "regions": [slug],
                "interaction": {"mode": "label", "prompt": "which one", "targetId": slug},
            }
        )
        is not None
    )


#: WHERE THE MAP IS DRAWN, and it is not :data:`FIGURE`. The bundled country is two and a half
#: times as tall as it is wide (Mercator, Kutch to Kanyakumari), so fitting it into the 260 x 160
#: figure box at one scale leaves a 64-unit-wide India with 100 units of dead air either side and
#: no room at all for a name. This box is the figure box turned on its side inside the same union
#: budget: the land comes out 128 units across and 190 tall, and the margins that are left are
#: where the names go. Measured at 390 and 1440 in `test_board_map.py` and on the real plane.
_MAP_BOX = (436.0, 380.0, 128.0, 190.0)


def _mercator(lon: float, lat: float) -> tuple[float, float]:
    """(lon, lat) in degrees to the projection the learner's own map engine uses.

    ``MapScene.tsx`` draws the bundled geometry with d3's ``geoMercator``. The ink uses the same
    projection so the map Wobo draws and the map the learner taps are the same shape of India, and
    because Mercator is conformal a state's outline is its outline rather than a squashed one.
    """
    return math.radians(lon), math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def _map_frame() -> Frame:
    """The whole bundled country, at ONE scale, centred in :data:`_MAP_BOX`."""
    from wobo_gateway.plexus.maps import CATALOG_IDS, region_ring

    points = [
        _mercator(lon, lat)
        for region_id in CATALOG_IDS
        for lon, lat in (region_ring(region_id) or ())
    ]
    return Frame.fit(
        min(p[0] for p in points),
        max(p[0] for p in points),
        min(p[1] for p in points),
        max(p[1] for p in points),
        box=_MAP_BOX,
    )


def _side_for(frame: Frame, region_id: str) -> str:
    """Which side of a state its name is written on: the one with the open board beside it.

    The client solves the final placement (``layout.ts solveWritten``, the 24 px reach law and the
    dodge), and takes the side named here first. Naming it from the geography rather than leaving
    it to the search is what keeps "kerala" out over the sea to the west instead of on top of Tamil
    Nadu, and it is computable: the side of the state with the most empty board between it and the
    edge of the drawing wins.
    """
    from wobo_gateway.plexus.maps import CATALOG_IDS, region_ring

    ring = [_mercator(lon, lat) for lon, lat in (region_ring(region_id) or ())]
    x0 = min(p[0] for p in ring)
    x1 = max(p[0] for p in ring)
    y0 = min(p[1] for p in ring)
    y1 = max(p[1] for p in ring)
    others = [
        [_mercator(lon, lat) for lon, lat in (region_ring(other) or ())]
        for other in CATALOG_IDS
        if other != region_id
    ]

    def clear(side: str) -> float:
        """How far the open board runs on this side before another state or the edge stops it."""
        if side in ("left", "right"):
            band = [p for other in others for p in other if y0 <= p[1] <= y1]
            if side == "left":
                near = [p[0] for p in band if p[0] < x0] + [frame.xmin]
                return x0 - max(near)
            near = [p[0] for p in band if p[0] > x1] + [frame.xmax]
            return min(near) - x1
        band = [p for other in others for p in other if x0 <= p[0] <= x1]
        if side == "bottom":
            near = [p[1] for p in band if p[1] < y0] + [frame.ymin]
            return y0 - max(near)
        near = [p[1] for p in band if p[1] > y1] + [frame.ymax]
        return min(near) - y1

    # East and west first: a name reads along the line of writing, so the room it needs is width.
    # A degree of longitude is the same board distance as a degree of Mercator latitude here, so
    # the four gaps are comparable as they stand.
    return max(("left", "right", "bottom", "top"), key=lambda side: (clear(side), -len(side)))


def _map(intent: dict[str, Any], draft: Draft) -> Draft:
    """A map of India, with the state the question is about marked on it.

    THE DEFECT THIS WAS REBUILT FOR (the adversary, wave 58). "Draw a labelled map of India and
    mark Maharashtra" drew a rectangle, the word "maharashtra" inside it, and a ring around the
    rectangle. Nothing false was SPOKEN — which is exactly why four waves of ledger checks let it
    through: the honesty machinery asks whether the say matches the glass, never whether the glass
    answers the question. There was no India on it. A box labelled maharashtra is not a labelled
    map of India, and "mark Maharashtra" means nothing without the thing it is marked on.

    So the land is drawn first and it is the whole bundled catalog — every state
    ``india-lite.json`` holds, each one its own polygon, in its own place, at one scale, in the
    projection the learner's tappable map uses. The question then decides what is marked ON it: the
    state's own boundary in the accent with a wash and its name for "mark Maharashtra", a wash and a
    number on each shaded state for "which state grows the most".

    THE MARK IS THE BOUNDARY, NOT A RING ROUND IT (the map closer, wave 58, measured at 390 and 1440
    in light, dark and reduced motion). The first rebuild ringed the state, and the ring did two
    things a map may not. It crossed Gujarat, Madhya Pradesh and Karnataka — a ring round one state
    on a map marks its neighbours' ground, and relevance says nothing else is marked. And its pad
    reserved the whole 24 px band round the state, so the placer had to clear it and the name
    landed 28 to 30 px from the thing it names, past the proximity law. The state drawn at full
    accent with the wash marks exactly Maharashtra and leaves the band for its name; the six
    renders after the change put the name inside 24 px.

    AND THE SAY IS ABOUT THE STATE, NOT THE CATALOG (the adversary, wave 60, keyless and live).
    The mark closed and the sentence did not: the rebuilt map draws eight titled polygons, and
    ``naming.part_name`` reads a polygon's title as a part the figure names of itself, so the
    transcript came back "Rajasthan, gujarat, maharashtra, madhya pradesh. Uttar pradesh,
    karnataka, kerala, tamil nadu. Read the labels as they land, and say which one is missing." —
    eight names over a board that writes ONE, in lower case, under the bio_social family's line
    telling a learner to read labels when exactly one label lands. Three things answer it, and
    they are the three ends of one sentence: the states the question is not about are marked
    ``meta.ground`` so the say does not run through them (they keep their titles for the listener
    who asks the board what is on it); every name is the bundle's own proper noun rather than a
    lower-cased one; and the map makes its own first sentence from its own intent
    (``naming.opening``), so it never falls back to the family's line, keyless or live.

    WHAT THIS MAP IS NOT, said plainly because a learner will meet it: the bundle is eight states,
    hand-authored and deliberately simplified, and it carries no national boundary. So Wobo draws
    the eight states it can prove, and the outline of India — which is a legal as well as a
    cartographic question in India, and needs an authoritative source rather than a brain's memory
    of one — is not drawn at all rather than drawn wrong. Adding it is a geometry decision for the
    owner and the bundle, not something the board may invent.

    The scene still goes through the brain's existing map validator first: a region that is not in
    the bundled geometry, or a shading with no single extreme, is refused there.
    """
    from wobo_gateway.plexus.maps import (
        CATALOG_IDS,
        region_name,
        region_ring,
        verify_map_scene,
    )

    regions = [
        str(r).strip().lower()[:MAX_NOTE_CHARS]
        for r in (intent.get("regions") or [])
        if str(r).strip()
    ]
    values = intent.get("values") or []
    mark = str(intent.get("mark") or "").strip().lower()[:MAX_NOTE_CHARS]
    if not regions:
        raise Unverified("a map needs regions")
    # TWO KINDS OF MAP QUESTION, and they are proved differently. "which state grows the most
    # wheat" is a shading with one extreme; "mark Maharashtra" is a region named on the map, and
    # the brain's validator refuses either one whose regions are not in the bundled geometry.
    shaded = bool(values) or not mark
    if not shaded:
        # A PROMPT IS WRITTEN FOR A LEARNER TO READ. ``f"find {mark}"`` wrote the catalog's own id
        # on the board — "find madhya-pradesh" — which is the slug law (see the name below) broken
        # on the one line the board asks the learner to act on.
        prompt = str(intent.get("prompt") or f"find {region_name(mark) or mark}").strip()[
            :MAX_NOTE_CHARS
        ]
        scene = {
            "kind": "map",
            "regions": regions,
            "interaction": {"mode": "label", "prompt": prompt, "targetId": mark},
        }
    else:
        prompt = str(intent.get("prompt") or "which one is the most").strip()[:MAX_NOTE_CHARS]
        scene = {
            "kind": "map",
            "regions": regions,
            "interaction": {
                "mode": "choropleth",
                "prompt": prompt,
                "extreme": str(intent.get("extreme") or "max"),
                "values": values,
            },
        }
    if verify_map_scene(scene) is None:
        raise Unverified("that map is not one I can prove — check the regions and the shading")
    shading = {
        str(v.get("id")): float(v.get("value"))
        for v in values
        if isinstance(v, dict) and v.get("id") in regions
    }
    extreme = None
    if shading:
        extreme = (max if str(intent.get("extreme") or "max") == "max" else min)(
            shading, key=lambda region_id: shading[region_id]
        )
    # A RECEIPT NAMES THE CHECK THAT ACTUALLY RAN. This one used to say "shading with one extreme"
    # on a map with no shading on it at all — a true-sounding line in the ledger for a check that
    # never happened, which is the same hole the drawing came through.
    draft.ledger.record(
        CheckResult(
            name="board.map_scene",
            passed=True,
            detail=(
                f"{len(shading)} of {len(CATALOG_IDS)} catalog regions shaded, "
                f"one extreme ({extreme})"
                if shading
                else f"{mark} marked on {len(CATALOG_IDS)} catalog regions"
            ),
        )
    )

    # THE LAND, AND IT IS THE WHOLE CATALOG. A state on its own is a shape; a state among its
    # neighbours is a place. Drawn first, so the client's placer counts the country as occupied
    # when it puts a name down.
    frame = _map_frame()
    named = [r for r in CATALOG_IDS if r in shading or r == mark]
    drawn: dict[str, str] = {}
    for region_id in CATALOG_IDS:
        ring = region_ring(region_id)
        if not ring:  # unreachable: CATALOG_IDS is the ring table's own keys
            continue
        # The closing vertex is the polygon's own doing — a ring drawn with it doubles a stroke.
        points = [frame.at(*_mercator(lon, lat)) for lon, lat in ring[:-1]]
        name = region_name(region_id) or region_id
        if region_id in (mark, extreme):
            style = accent(2)
        elif region_id in shading:
            style = wobo(1)
        else:
            style = faint(1)
        if region_id in shading:
            # The shading a choropleth is read from: the same wash on every shaded state, weighted
            # by its own value against the largest on the map, so darker is more and the learner
            # can rank them by eye before reading a single number.
            style = {
                **style,
                "fill": "wash",
                "opacity": round(0.2 + 0.5 * shading[region_id] / (max(shading.values()) or 1), 2),
            }
        elif region_id == mark:
            # No ``opacity`` here: the renderer scales the whole node by it, stroke included, and a
            # quarter-strength accent outline was not the one hit of pigment the answer is. The
            # wash is already translucent on its own (``renderer.tsx``: a wash fills at 0.14).
            style = {**style, "fill": "wash"}
        drawn[region_id] = draft.add(
            "polygon",
            anchor=board(*points[0]),
            points=points,
            title=name,
            style=style,
            hint=region_id,
            # THE COUNTRY IS THE GROUND, NOT AN INVENTORY. ``naming.part_name`` reads a polygon's
            # title as a part the figure names of itself and the say runs through every one of
            # them, which is right for a plant cell and wrong for a map: a state the question is
            # not about is drawn so the answer has somewhere to be, and it carries no name on the
            # glass to go with the one in the voice. Saying it is what put seven states the board
            # never writes into the transcript. The title stays — ``spoken.ts`` reads it to a
            # learner who asks what is on the board, which is the only reading of it a map wants.
            meta=None if region_id in named else {"ground": True},
        )
    # THE NAMES, and only the ones the question is about. Eight names cannot be written on this
    # map: "madhya-pradesh" is 126 board units of type and Madhya Pradesh is 63 units wide, so
    # writing every name inside its own state needs the country drawn 254 units across — 375 tall,
    # against a union budget of 347 — and Kerala, 15 units wide, needs it 393 across. Written in
    # the margins instead, eight names are eight leaders across the country. So the map is labelled
    # the way a teacher labels one at the board: the state the question names is named, and the
    # rest is the country it sits in, which every polygon's `title` still says out loud.
    for region_id in named:
        draft.add(
            "label",
            anchor=on(drawn[region_id], _side_for(frame, region_id)),
            text=region_name(region_id) or region_id,
            style=accent(1) if region_id in (mark, extreme) else wobo(1),
            hint="name",
        )
        if region_id in shading:
            draft.number(
                shading[region_id],
                "board.map_scene",
                anchor=on(drawn[region_id], "center"),
                decimals=0,
                style=faint(1),
            )
    draft.add(
        "write",
        anchor=board(FIGURE_MID[0], FIGURE[1] + FIGURE[3] + 26.0),
        text=prompt,
        style=wobo(1),
        hint="prompt",
    )
    return draft
