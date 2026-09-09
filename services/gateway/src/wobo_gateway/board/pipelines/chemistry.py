"""Chemistry at the board — molecules in a chemist's stroke order, and equations that balance.

**On RDKit.** BOARD.md names RDKit as the route from SMILES to 2D coordinates, and
:mod:`wobo_gateway.plexus.chem` records the standing decision that the RDKit wheel is *not* a
gateway dependency (it is ~120 MB, and the true structural render already happens in the learner's
browser through RDKit-js). Both hold here: :func:`_coords_from_rdkit` uses RDKit when the
environment provides it, and the deterministic depiction below is what runs otherwise. The
molecule is never imagined either way — the SMILES is validated by the brain's existing checker
first, then parsed into a real atom-and-bond graph, and the coordinates are computed from that
graph's ring and chain geometry.

**Stroke order.** A chemist draws the ring or the main chain first, then the branches outward,
then the labels on the atoms that are not carbon. The objects come out of this module in that
order, so the hand simply draws the list.
"""

from __future__ import annotations

import math
import re
from typing import Any

from wobo_verifier.gate import CheckResult

from wobo_gateway.board.pipelines import (
    FIGURE,
    FIGURE_MID,
    MAX_NOTE_CHARS,
    Draft,
    accent,
    arrow_to,
    board,
    faint,
    on,
    wobo,
)
from wobo_gateway.board.verify import Unverified, balance, equation_balances
from wobo_gateway.plexus.chem import parse_formula, valid_smiles

#: Sized to the figure box, not to the board: a molecule drawn 520 units across put its own atom
#: labels at 6 px on a 1440 screen (see :data:`wobo_gateway.board.pipelines.FIGURE`).
BOND_LENGTH = min(70.0, FIGURE[3] * 0.30)
CENTRE = FIGURE_MID
MAX_ATOMS = 40

#: One coefficient ticks into place every this many milliseconds (BOARD.md §6: "coefficients that
#: tick"). The hand reads it off ``t.start``.
TICK_MS = 420

_ORGANIC = ("Cl", "Br", "B", "C", "N", "O", "P", "S", "F", "I")
_AROMATIC = "bcnops"
_BRACKET_RE = re.compile(r"\[([A-Za-z][a-z]?)(?:@{1,2})?(?:H(\d*))?(?:([+-])(\d*))?\]")
_BOND_ORDER = {"-": 1, "=": 2, "#": 3, ":": 1}


def build(intent: dict[str, Any], prefix: str, ask: str = "") -> Draft:
    op = str(intent.get("op") or "molecule")
    if op == "molecule":
        return _molecule(intent, Draft(prefix, ask=ask))
    if op == "balance":
        return _balance(intent, Draft(prefix, ask=ask))
    raise Unverified(f"chemistry cannot draw {op!r}")


# --- SMILES to a graph -----------------------------------------------------------------------


def parse_smiles(smiles: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The organic subset of SMILES as atoms and bonds. Raises :class:`Unverified` on anything
    it cannot read — it never guesses at a structure."""
    if not valid_smiles(smiles):
        raise Unverified(f"{smiles!r} is not a structure I can read")
    atoms: list[dict[str, Any]] = []
    bonds: list[dict[str, Any]] = []
    stack: list[int] = []
    rings: dict[str, tuple[int, int]] = {}
    previous: int | None = None
    pending = 1
    aromatic_next = False
    i = 0
    text = smiles.strip()

    def attach(index: int, order: int, ring: bool = False) -> None:
        bonds.append(
            {
                "a": previous if not ring else index,
                "b": index,
                "order": order,
                "ring": ring,
            }
        )

    while i < len(text):
        ch = text[i]
        if ch == "(":
            if previous is None:
                raise Unverified("a branch cannot open before an atom")
            stack.append(previous)
            i += 1
            continue
        if ch == ")":
            if not stack:
                raise Unverified("a branch closed that never opened")
            previous = stack.pop()
            i += 1
            continue
        if ch in _BOND_ORDER:
            pending = _BOND_ORDER[ch]
            aromatic_next = ch == ":"
            i += 1
            continue
        if ch == "/" or ch == "\\":
            i += 1
            continue
        if ch.isdigit() or ch == "%":
            if ch == "%":
                label, i = text[i + 1 : i + 3], i + 3
            else:
                label, i = ch, i + 1
            if previous is None:
                raise Unverified("a ring closure cannot come before an atom")
            open_ring = rings.pop(label, None)
            if open_ring is None:
                rings[label] = (previous, pending)
            else:
                start, order = open_ring
                bonds.append(
                    {"a": start, "b": previous, "order": max(order, pending), "ring": True}
                )
            pending = 1
            continue

        match = _BRACKET_RE.match(text, i)
        if match:
            element = match.group(1)
            sign, count = match.group(3), match.group(4)
            charge = 0
            if sign:
                charge = int(count or 1) * (1 if sign == "+" else -1)
            atoms.append(
                {"element": element.capitalize(), "aromatic": element.islower(), "charge": charge}
            )
            i = match.end()
        else:
            symbol = next(
                (s for s in _ORGANIC if text.startswith(s, i)),
                ch if ch in _AROMATIC else None,
            )
            if symbol is None:
                raise Unverified(f"{text[i]!r} is not part of the structure grammar I read")
            atoms.append(
                {
                    "element": symbol.upper() if len(symbol) == 1 else symbol,
                    "aromatic": symbol.islower(),
                    "charge": 0,
                }
            )
            i += len(symbol)
        index = len(atoms) - 1
        if previous is not None:
            bonds.append({"a": previous, "b": index, "order": pending, "ring": False})
        previous = index
        pending = 1
        aromatic_next = False

    if rings:
        raise Unverified("a ring closure was left open")
    if not atoms:
        raise Unverified("that structure has no atoms")
    if len(atoms) > MAX_ATOMS:
        raise Unverified(f"{len(atoms)} atoms is more than one board")
    del aromatic_next
    return atoms, bonds


def _ring_members(atoms: list[dict[str, Any]], bonds: list[dict[str, Any]]) -> list[list[int]]:
    """Every ring, as an ordered list of atom indices, found from the ring-closure bonds."""
    tree: dict[int, list[int]] = {i: [] for i in range(len(atoms))}
    for bond in bonds:
        if not bond["ring"]:
            tree[bond["a"]].append(bond["b"])
            tree[bond["b"]].append(bond["a"])
    rings: list[list[int]] = []
    for bond in bonds:
        if not bond["ring"]:
            continue
        path = _path(tree, bond["a"], bond["b"])
        if path and len(path) >= 3:
            rings.append(path)
    return rings


def _path(tree: dict[int, list[int]], start: int, goal: int) -> list[int]:
    queue: list[list[int]] = [[start]]
    seen = {start}
    while queue:
        route = queue.pop(0)
        if route[-1] == goal:
            return route
        for nxt in tree.get(route[-1], ()):
            if nxt not in seen:
                seen.add(nxt)
                queue.append([*route, nxt])
    return []


def _coords_from_rdkit(smiles: str, count: int) -> list[tuple[float, float]] | None:
    """RDKit's depiction when the environment has RDKit, and nothing when it does not."""
    try:  # pragma: no cover - exercised only where the optional wheel is installed
        from rdkit import Chem
        from rdkit.Chem import AllChem
    except ImportError:
        return None
    molecule = Chem.MolFromSmiles(smiles)  # pragma: no cover
    if molecule is None or molecule.GetNumAtoms() != count:  # pragma: no cover
        return None
    AllChem.Compute2DCoords(molecule)  # pragma: no cover
    conformer = molecule.GetConformer()  # pragma: no cover
    return [  # pragma: no cover
        (conformer.GetAtomPosition(i).x, conformer.GetAtomPosition(i).y) for i in range(count)
    ]


def layout(
    smiles: str, atoms: list[dict[str, Any]], bonds: list[dict[str, Any]]
) -> list[tuple[float, float]]:
    """Coordinates in bond-length units: rings as regular polygons, chains as a 120° zig-zag."""
    external = _coords_from_rdkit(smiles, len(atoms))
    if external is not None:  # pragma: no cover - optional path
        return external

    positions: dict[int, tuple[float, float]] = {}
    neighbours: dict[int, list[int]] = {i: [] for i in range(len(atoms))}
    for bond in bonds:
        neighbours[bond["a"]].append(bond["b"])
        neighbours[bond["b"]].append(bond["a"])

    for ring in _ring_members(atoms, bonds):
        size = len(ring)
        radius = 1.0 / (2 * math.sin(math.pi / size))
        placed = [i for i in ring if i in positions]
        if len(placed) >= 2:
            continue  # a fused ring shares an edge that is already drawn; leave it be
        cx, cy = (len(positions) * 2.4, 0.0)
        for step, index in enumerate(ring):
            if index in positions:
                continue
            angle = math.pi / 2 + 2 * math.pi * step / size
            positions[index] = (cx + radius * math.cos(angle), cy + radius * math.sin(angle))

    if not positions:
        positions[0] = (0.0, 0.0)

    # Everything not in a ring hangs off what is already placed, in a zig-zag that never doubles
    # back onto a neighbour.
    frontier = list(positions)
    while frontier:
        current = frontier.pop(0)
        base = positions[current]
        used = [
            math.atan2(positions[n][1] - base[1], positions[n][0] - base[0])
            for n in neighbours[current]
            if n in positions
        ]
        for nxt in neighbours[current]:
            if nxt in positions:
                continue
            angle = _free_angle(used)
            positions[nxt] = (base[0] + math.cos(angle), base[1] + math.sin(angle))
            used.append(angle)
            frontier.append(nxt)
    for index in range(len(atoms)):
        positions.setdefault(index, (float(index), 0.0))
    return [positions[i] for i in range(len(atoms))]


def _free_angle(used: list[float]) -> float:
    """The 30° step furthest from every bond already leaving this atom — a chemist's angles."""
    if not used:
        return math.radians(30)
    best, best_gap = math.radians(30), -1.0
    for degrees in range(0, 360, 30):
        candidate = math.radians(degrees)
        gap = min(abs(math.atan2(math.sin(candidate - u), math.cos(candidate - u))) for u in used)
        if gap > best_gap:
            best, best_gap = candidate, gap
    return best


def _molecule(intent: dict[str, Any], draft: Draft) -> Draft:
    smiles = str(intent.get("smiles") or "").strip()
    if not smiles:
        raise Unverified("a molecule needs a structure")
    atoms, bonds = parse_smiles(smiles)
    coords = layout(smiles, atoms, bonds)
    draft.ledger.record(
        CheckResult(
            name="board.smiles_valid",
            passed=True,
            detail=f"{smiles}: {len(atoms)} atoms, {len(bonds)} bonds",
        )
    )

    xs = [p[0] for p in coords]
    ys = [p[1] for p in coords]
    span = max(max(xs) - min(xs), max(ys) - min(ys), 1.0)
    scale = min(BOND_LENGTH, min(FIGURE[2], FIGURE[3]) / span)
    mid_x, mid_y = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2

    def place(index: int) -> dict[str, Any]:
        x, y = coords[index]
        return board(CENTRE[0] + (x - mid_x) * scale, CENTRE[1] - (y - mid_y) * scale)

    # Stroke order: the ring skeleton (or the main chain) first, then everything hanging off it.
    rings = _ring_members(atoms, bonds)
    skeleton = [i for ring in rings for i in ring]
    order = skeleton + [i for i in range(len(atoms)) if i not in skeleton]

    ids: dict[int, str] = {}
    for index in order:
        atom = atoms[index]
        ids[index] = draft.add(
            "atom",
            anchor=place(index),
            symbol=atom["element"],
            charge=atom["charge"] or None,
            style=accent(2) if atom["element"] != "C" else wobo(2),
            hint=atom["element"].lower(),
        )

    aromatic_ring = {
        tuple(sorted((r[i], r[(i + 1) % len(r)])))
        for r in rings
        for i in range(len(r))
        if all(atoms[a]["aromatic"] for a in r)
    }
    for position, bond in enumerate(sorted(bonds, key=lambda b: (not b["ring"], b["a"]))):
        pair = tuple(sorted((bond["a"], bond["b"])))
        aromatic = pair in aromatic_ring
        draft.add(
            "bond",
            # `to` is written where the pipeline computed it — the other atom's absolute board
            # point — and `Draft.add` rebases it into the offset from THIS bond's anchor, which is
            # the only thing the hand reads (`geometry.ts`: anchor + to). The anchor is an atom, not
            # board space, so the rebase resolves it through the atom's own origin.
            anchor=on(ids[bond["a"]]),
            to=place(bond["b"])["board"],
            # Benzene alternation: an aromatic ring is drawn as alternating single and double
            # bonds, which is what a chemist's hand actually puts on a board.
            order=(2 if position % 2 == 0 else 1) if aromatic else bond["order"],
            style=wobo(2),
            hint="bond",
        )
    name = str(intent.get("name") or "").strip()[:40]
    if name:
        draft.add(
            "label",
            anchor=board(CENTRE[0], FIGURE[1] + FIGURE[3] + 26.0),
            text=name[:MAX_NOTE_CHARS],
            style=faint(1),
            hint="name",
        )
    return draft


def _balance(intent: dict[str, Any], draft: Draft) -> Draft:
    """The equation is written first, then the coefficients tick into place one at a time."""
    reactants = [str(f).strip() for f in (intent.get("reactants") or []) if str(f).strip()]
    products = [str(f).strip() for f in (intent.get("products") or []) if str(f).strip()]
    coefficients = balance(reactants, products)
    balanced = draft.ledger.record(
        equation_balances(
            list(zip(coefficients[: len(reactants)], reactants, strict=True)),
            list(zip(coefficients[len(reactants) :], products, strict=True)),
        )
    ).name
    # A subscript is a numeral the learner can read, so a formula earns its ink the same way a
    # computed quantity does: it is parsed into real element counts before it is written.
    formulas_check = draft.ledger.record(
        CheckResult(
            name="board.formula_readable",
            passed=all(parse_formula(f) for f in [*reactants, *products]),
            detail=", ".join([*reactants, *products]),
        )
    ).name

    left_count = len(reactants)
    x = FIGURE[0]
    y = FIGURE_MID[1]
    slots: list[tuple[str, str]] = []
    for i, formula in enumerate([*reactants, *products]):
        if i == left_count:
            tail = board(x, y)
            x += 54.0
            arrow_to(draft, tip=board(x, y), tail=tail, style=wobo(2), hint="yields")
            x += 20.0
        elif i:
            plus = draft.add("label", anchor=board(x, y), text="+", style=wobo(2), hint="plus")
            del plus
            x += 32.0
        slot = board(x, y)
        species = draft.add(
            "write",
            anchor=slot,
            text=formula,
            check=formulas_check,
            style=wobo(2),
            hint=formula.lower(),
        )
        slots.append((species, formula))
        x += 22.0 + 13.0 * len(formula)

    # The coefficients are the answer, so they arrive last and one at a time.
    for tick, ((species, _formula), coefficient) in enumerate(
        zip(slots, coefficients, strict=True)
    ):
        if coefficient == 1:
            continue
        obj_id = draft.number(
            coefficient,
            balanced,
            anchor=on(species, "left"),
            decimals=0,
            style=accent(3),
        )
        for obj in draft.objects:
            if obj["id"] == obj_id:
                obj["t"] = {"start": tick * TICK_MS, "dur": 280}
    draft.add(
        "write",
        anchor=board(FIGURE_MID[0], FIGURE[1] + FIGURE[3] + 26.0),
        text="same atoms both sides",
        style=accent(1),
        hint="balancednote",
    )
    return draft
