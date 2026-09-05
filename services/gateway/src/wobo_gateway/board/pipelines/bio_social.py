"""Biology and social science at the board — cells, food webs, Punnett squares, timelines, maps.

These are the domains where the danger is not arithmetic but invention: a label that sounds right,
a date that is nearly right, a state on a map that is not on the map. So nothing here is written
from the model's memory. Labels come from a curated parts table cross-checked against the brain's
fact base; a Punnett square's cells and ratio come from :mod:`wobo_gateway.plexus.bio`; a map
is refused unless the brain's existing map validator accepts the scene; a timeline's dates must
survive an ordering and plausibility check before a single tick is drawn.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from wobo_verifier.gate import CheckResult

from wobo_gateway.board import verify
from wobo_gateway.board.pipelines import (
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
#: in). Curated rather than generated, and cross-checked against the fact base when it covers the
#: concept — a label Wobo cannot support is not drawn.
CELL_PARTS: dict[str, tuple[str, ...]] = {
    "animal cell": (
        "cell membrane",
        "cytoplasm",
        "nucleus",
        "mitochondrion",
        "ribosome",
        "endoplasmic reticulum",
        "golgi apparatus",
        "lysosome",
    ),
    "plant cell": (
        "cell wall",
        "cell membrane",
        "cytoplasm",
        "nucleus",
        "chloroplast",
        "vacuole",
        "mitochondrion",
    ),
    "neuron": ("dendrite", "cell body", "nucleus", "axon", "myelin sheath", "axon terminal"),
    "leaf": (
        "cuticle",
        "upper epidermis",
        "palisade mesophyll",
        "spongy mesophyll",
        "stoma",
        "lower epidermis",
    ),
}

_EARLIEST_YEAR = -4000
_MAX_EVENTS = 14
_MAX_NODES = 16


def build(intent: dict[str, Any], prefix: str) -> Draft:
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
    return handler(intent, Draft(prefix))


def _cell(intent: dict[str, Any], draft: Draft) -> Draft:
    subject = str(intent.get("subject") or "animal cell").strip().lower()
    parts = CELL_PARTS.get(subject)
    if parts is None:
        raise Unverified(f"I do not have a verified parts list for {subject!r}")
    asked = [str(p).strip().lower() for p in (intent.get("parts") or parts)]
    unknown = [p for p in asked if p not in parts]
    if unknown:
        raise Unverified(f"these are not parts of a {subject}: {unknown[:3]}")
    # The fact base is the second opinion where it covers the concept; where it does not, the
    # curated table above stands alone and the check is recorded rather than enforced.
    draft.ledger.note(verify.fact_supported(intent.get("concept_id") or subject, asked))

    outline = draft.add(
        "ellipse", anchor=board(480.0, 460.0), rx=260.0, ry=200.0, style=wobo(2), hint="outline"
    )
    if subject == "plant cell":
        draft.add(
            "polygon",
            anchor=board(200.0, 240.0),
            points=[[200.0, 240.0], [760.0, 240.0], [760.0, 680.0], [200.0, 680.0]],
            style=wobo(2),
            hint="wall",
        )
    inner = draft.add(
        "ellipse", anchor=board(480.0, 440.0), rx=70.0, ry=60.0, style=accent(2), hint="nucleus"
    )
    import math

    for i, part in enumerate(asked):
        angle = 2 * math.pi * i / max(1, len(asked))
        tip = board(480.0 + 300.0 * math.cos(angle), 460.0 + 230.0 * math.sin(angle))
        pointer = arrow_to(
            draft,
            tip=tip,
            tail=on(inner if part == "nucleus" else outline),
            style=faint(1),
            hint="pointer",
        )
        draft.add(
            "label",
            anchor=on(pointer, "right"),
            text=part,
            style=accent(1) if part == "nucleus" else wobo(1),
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
        eaten = str(link.get("from") or "").strip()[:32]
        eater = str(link.get("to") or "").strip()[:32]
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

    ids: dict[str, str] = {}
    for level, group in sorted(by_level.items()):
        y = 720.0 - (level * (560.0 / max(1, depth - 1 or 1)))
        for i, name in enumerate(sorted(group)):
            x = 200.0 + (i + 1) * (600.0 / (len(group) + 1))
            node = draft.add(
                "region",
                anchor=board(x, y),
                w=150.0,
                h=54.0,
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
        anchor=board(500.0, 780.0),
        text="the arrow points where the energy goes",
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

    table = draft.add(
        "table",
        anchor=board(360.0, 340.0),
        rows=[[a[0], a[1]], [b[0], cells[0]], [b[1], cells[2]]],
        w=280.0,
        style=wobo(2),
        hint="square",
    )
    # The four cells are filled one at a time, which is how the square is taught.
    for i, cell in enumerate(cells):
        draft.add(
            "write",
            anchor=on(table, [0.25 + 0.5 * (i % 2), 0.25 + 0.5 * (i // 2)]),
            text=cell,
            style=accent(2),
            hint="cell",
            dur=320,
        )
    draft.number(
        dominant,
        "board.numbers_agree:punnett cells",
        anchor=on(table, "bottom"),
        decimals=0,
        style=accent(2),
    )
    draft.number(
        recessive,
        "board.numbers_agree:punnett cells",
        anchor=on(table, "right"),
        decimals=0,
        style=wobo(2),
    )
    return draft


def _timeline(intent: dict[str, Any], draft: Draft) -> Draft:
    raw = intent.get("events") or []
    if not isinstance(raw, list) or len(raw) < 2:
        raise Unverified("a timeline needs at least two events")
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
        label = str(item.get("label") or "").strip()[:60]
        if not label:
            raise Unverified("each event needs a label")
        draft.ledger.record(verify.in_bounds(f"year {year}", year, _EARLIEST_YEAR, horizon))
        events.append((year, label))
    events.sort()
    if len({y for y, _ in events}) != len(events):
        raise Unverified("two events share a year, so the line cannot order them")

    lo, hi = events[0][0], events[-1][0]
    frame = Frame(y0=440.0, h=1.0, xmin=float(lo), xmax=float(hi), ymin=0.0, ymax=1.0)
    line = draft.add(
        "line",
        anchor=board(*frame.at(lo, 0)),
        to=board(*frame.at(hi, 0)),
        style=wobo(2),
        hint="timeline",
    )
    for year, label in events:
        tick = draft.add("point", anchor=board(*frame.at(year, 0)), style=accent(3), hint="tick")
        # The check's name carries the year, because that is how it was RECORDED above
        # (``verify.in_bounds(f"year {year}", ...)`` -> ``board.in_bounds:year 1919``). Writing the
        # bare ``board.in_bounds:year`` here named a check that never ran, so the planner's own law
        # refused every number and the learner got a timeline with no dates on it. Found by the
        # teaching harness, 2026-09-05, on "a timeline of the national movement".
        draft.number(
            year, f"board.in_bounds:year {year}", anchor=on(tick, "top"), decimals=0, style=wobo(1)
        )
        draft.add("label", anchor=on(tick, "bottom"), text=label, style=faint(1), hint="event")
    draft.add("underline", anchor=on(line), style=faint(1), hint="span")
    return draft


def _map(intent: dict[str, Any], draft: Draft) -> Draft:
    """A shaded map. The scene goes through the brain's existing map validator first: a region
    that is not in the bundled geometry, or a shading with no single extreme, is refused there."""
    from wobo_gateway.plexus.maps import verify_map_scene

    regions = [str(r).strip().lower() for r in (intent.get("regions") or []) if str(r).strip()]
    values = intent.get("values") or []
    prompt = str(intent.get("prompt") or "which one is the most").strip()[:120]
    if not regions:
        raise Unverified("a map needs regions")
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
    draft.ledger.record(
        CheckResult(
            name="board.map_scene",
            passed=True,
            detail=f"{len(regions)} catalog regions, shading with one extreme",
        )
    )

    shading = {
        str(v.get("id")): float(v.get("value"))
        for v in values
        if isinstance(v, dict) and v.get("id") in regions
    }
    columns = 3
    for i, region in enumerate(regions):
        x = 260.0 + (i % columns) * 240.0
        y = 260.0 + (i // columns) * 200.0
        area = draft.add(
            "region",
            anchor=board(x, y),
            w=200.0,
            h=150.0,
            title=region,
            style=accent(2) if shading.get(region) == max(shading.values(), default=None)
            else wobo(1),
            hint="region",
        )
        if region in shading:
            draft.number(
                shading[region],
                "board.map_scene",
                anchor=on(area, "center"),
                style=faint(1),
            )
    draft.add("write", anchor=board(500.0, 760.0), text=prompt, style=wobo(1), hint="prompt")
    return draft
