"""Domain pipelines — a small intent in, exact objects out.

BOARD.md §6: "The brain does not draw a molecule from imagination." A pipeline is the only thing
allowed to turn "graph y=x^2 with the tangent at x=1" into coordinates, and every coordinate it
produces comes from :mod:`wobo_gateway.board.verify` — SymPy in the verifier's sandbox, the
existing dimensional analyser, the existing balance checker, the fact base.

The model never sends coordinates. It sends an intent in this shape::

    {"pipeline": "math", "op": "graph", "expr": "x**2", "domain": [-3, 3], "tangent_at": 1}

:func:`run_intent` dispatches it. Everything shared by the four pipelines — the board frame, id
minting, drawing durations, the ordered draft — lives here so a pipeline is only its domain.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from wobo_gateway.board.schema import BOARD_UNITS
from wobo_gateway.board.verify import Ledger, Unverified

#: Drawing time in milliseconds. A hand is faster on a long line than on a letter (BOARD.md §7),
#: so a stroke's duration is a floor plus a per-unit rate, and handwriting is paced per character.
STROKE_MS_BASE = 140
STROKE_MS_PER_UNIT = 0.55
WRITE_MS_PER_CHAR = 55
MARK_MS = 260

_SLUG_RE = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class Frame:
    """A rectangle of board space, and the data range it shows.

    The whole point of the frame is that a pipeline thinks in the units of its subject — metres,
    volts, moles, x — and never in board units. :meth:`at` is the one crossing.
    """

    x0: float = 120.0
    y0: float = 120.0
    w: float = 760.0
    h: float = 700.0
    xmin: float = -5.0
    xmax: float = 5.0
    ymin: float = -5.0
    ymax: float = 5.0

    def at(self, x: float, y: float) -> list[float]:
        """Data coordinates to board coordinates, y flipped (board y grows downward), clamped
        to the board so nothing an outlier produces can escape the 1000-unit square."""
        span_x = (self.xmax - self.xmin) or 1.0
        span_y = (self.ymax - self.ymin) or 1.0
        bx = self.x0 + (x - self.xmin) / span_x * self.w
        by = self.y0 + self.h - (y - self.ymin) / span_y * self.h
        return [
            round(min(BOARD_UNITS, max(0.0, bx)), 2),
            round(min(BOARD_UNITS, max(0.0, by)), 2),
        ]

    def holds(self, x: float, y: float) -> bool:
        return self.xmin <= x <= self.xmax and self.ymin <= y <= self.ymax

    def with_y(self, ymin: float, ymax: float) -> Frame:
        pad = (ymax - ymin) * 0.12 or 1.0
        return Frame(self.x0, self.y0, self.w, self.h, self.xmin, self.xmax, ymin - pad, ymax + pad)


def stroke_ms(points: list[list[float]]) -> int:
    """How long a hand takes to draw this path, in milliseconds."""
    length = sum(
        ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
        for a, b in zip(points, points[1:], strict=False)
    )
    return int(STROKE_MS_BASE + length * STROKE_MS_PER_UNIT)


@dataclass
class Draft:
    """An ordered board under construction. Ids are minted here, so they are unique by
    construction and a pipeline never invents one that collides with another pipeline's."""

    prefix: str
    ledger: Ledger = field(default_factory=Ledger)
    objects: list[dict[str, Any]] = field(default_factory=list)
    #: Every object's absolute board origin, by id. A path or a bond is written in absolute board
    #: coordinates by the pipeline and rebased into offsets at :meth:`add`; when the object hangs
    #: off ANOTHER object rather than off board space, this is where its origin is looked up.
    origins: dict[str, list[float]] = field(default_factory=dict)
    _n: int = 0

    def mint(self, hint: str = "o") -> str:
        self._n += 1
        slug = _SLUG_RE.sub("", hint.lower())[:12] or "o"
        return f"{self.prefix}{self._n}{slug}"

    def origin_of(self, anchor: dict[str, Any] | None) -> list[float] | None:
        """The absolute board point an anchor sits at, when this draft can know it.

        Board space names its own point. An object anchor borrows the point of the object it hangs
        off — this draft minted that object, so it has it. A registry target or a focus region is a
        rect on the learner's screen and has no board point here at all; a path hung off one of
        those is authored as offsets to begin with, which is the only reading it can have.
        """
        if not isinstance(anchor, dict):
            return None
        board_at = anchor.get("board")
        if isinstance(board_at, (list, tuple)) and len(board_at) == 2:
            return [float(board_at[0]), float(board_at[1])]
        owner = anchor.get("object")
        # `at` names a corner of the owner's box rather than its origin, so the crossing is no
        # longer exact and the path is left alone rather than rebased against the wrong point.
        if isinstance(owner, str) and anchor.get("at") is None:
            return self.origins.get(owner)
        return None

    def add(
        self,
        kind: str,
        *,
        anchor: dict[str, Any] | None = None,
        dur: int | None = None,
        hint: str = "",
        **fields: Any,
    ) -> str:
        """Append one object in drawing order and return its id."""
        obj: dict[str, Any] = {"id": self.mint(hint or kind), "kind": kind}
        if anchor is not None:
            obj["anchor"] = anchor
        obj.update({k: v for k, v in fields.items() if v is not None})
        origin = self.origin_of(anchor)
        _rebase_path(obj, origin)
        if origin is not None:
            self.origins[obj["id"]] = origin
        if dur is None:
            points = fields.get("points")
            if isinstance(points, list) and points and isinstance(points[0], list):
                dur = stroke_ms(points)
            elif kind in ("write", "label", "tex"):
                written = str(fields.get("text") or fields.get("tex") or "")
                dur = int(WRITE_MS_PER_CHAR * len(written))
            else:
                dur = MARK_MS
        obj["t"] = {"start": 0, "dur": max(80, int(dur))}
        self.objects.append(obj)
        return obj["id"]

    def number(
        self,
        value: float,
        check: str,
        *,
        anchor: dict[str, Any],
        unit: str | None = None,
        decimals: int = 2,
        style: dict[str, Any] | None = None,
        label: str | None = None,
    ) -> str:
        """A computed number, carrying the name of the check that earned it. The only way a
        numeral reaches the board — ``verified`` is the hand's flag, ``check`` is the receipt.

        ``label`` is the word beside it that says WHAT it is. A projectile board wrote 14.14 m/s
        at the apex with nothing saying it was the across-speed, and a judge reading the board
        could not tell (the 2026-09-05 review); a number nobody can name teaches nothing."""
        return self.add(
            "number",
            anchor=anchor,
            value=round(float(value), 6),
            unit=unit,
            label=label,
            precision=decimals,
            verified=True,
            check=check,
            style=style,
            hint="num",
        )


def arrow_to(
    draft: Draft,
    *,
    tip: dict[str, Any],
    tail: dict[str, Any],
    style: dict[str, Any] | None = None,
    hint: str = "arrow",
) -> str:
    """An arrow points AT its anchor and starts at ``from`` — the head is the thing it is about."""
    return draft.add("arrow", anchor=tip, style=style, hint=hint, **{"from": tail})


def board(x: float, y: float) -> dict[str, Any]:
    """An anchor in board space — the only placement a shape drawn from scratch may use."""
    return {"board": [round(x, 2), round(y, 2)]}


def on(object_id: str, at: str | None = None) -> dict[str, Any]:
    anchor: dict[str, Any] = {"object": object_id}
    if at:
        anchor["at"] = at
    return anchor


def wobo(weight: int = 2) -> dict[str, Any]:
    return {"ink": "wobo", "weight": weight}


def accent(weight: int = 2) -> dict[str, Any]:
    """The one hit of pigment: ultramarine, Wobo's pen. Reserved for the thing being taught."""
    return {"ink": "accent", "weight": weight}


def faint(weight: int = 1) -> dict[str, Any]:
    return {"ink": "faint", "weight": weight}


PIPELINES = ("math", "physics", "chemistry", "bio_social")


def run_intent(intent: dict[str, Any], *, index: int = 0) -> Draft:
    """Dispatch one intent to its pipeline. Raises :class:`Unverified` when it cannot be drawn."""
    from wobo_gateway.board.pipelines import bio_social, chemistry, math, physics

    handlers: dict[str, Callable[[dict[str, Any], str], Draft]] = {
        "math": math.build,
        "physics": physics.build,
        "chemistry": chemistry.build,
        "bio_social": bio_social.build,
    }
    name = str(intent.get("pipeline") or "").strip()
    handler = handlers.get(name)
    if handler is None:
        raise Unverified(f"there is no {name!r} pipeline")
    return handler(intent, f"{name[0]}{index}_")


__all__ = [
    "Draft",
    "arrow_to",
    "Frame",
    "PIPELINES",
    "Unverified",
    "accent",
    "board",
    "faint",
    "on",
    "run_intent",
    "stroke_ms",
    "wobo",
]


# --- Paths are offsets from the anchor, not board coordinates ------------------------------------
#
# `packages/wobo/src/board/schema.ts` is the grammar's source of truth and the hand reads a path as
# OFFSETS from the resolved anchor (`geometry.ts`: `offsetPoints`, and the same for `bond.to`). It
# has to: a polygon anchored to a registry target or to another object cannot know where that thing
# will be, so the only placement a path can carry is a displacement. Board space is no exception —
# one reading, or the same object means two different pictures on the two halves of Wobo.
#
# A pipeline, though, thinks in absolute board coordinates: `frame.at(x, y)` is the one crossing
# from metres or volts into the board, and every path is built out of it. Rebasing here — once, at
# the seam where an object is minted — keeps every pipeline writing the coordinates it computed
# while the wire carries what the hand actually reads. Without it every shape was drawn at anchor +
# point, which is roughly double its intended position: a graph's curve slid a fifth of the board
# down and to the right, off the axes it belonged to.
#
# The origin is NOT read off the anchor here: it is handed in by :meth:`Draft.add`, which can also
# resolve an `{"object": id}` anchor to the point that object was placed at. That case is the whole
# reason this is a seam and not a rule about board anchors — every bond a molecule draws is anchored
# to an ATOM and carries the other atom's absolute position, so a rebase that only understood board
# anchors left every bond in every molecule pointing hundreds of units off the board.
_PATH_KINDS = ("polyline", "curve", "polygon")
#: The kinds whose geometry the hand reads as offsets from the resolved anchor.
_OFFSET_KINDS = (*_PATH_KINDS, "bond")


def _rebase_path(obj: dict[str, Any], origin: list[float] | None) -> None:
    """Turn a path's absolute board coordinates into offsets from the point its anchor sits at."""
    if obj["kind"] not in _OFFSET_KINDS:
        return
    if origin is None:
        anchor = obj.get("anchor")
        # A shape hung off a registry target or a focus region has no board point to be written
        # against, so it is authored as offsets already and there is nothing to do. A shape hung off
        # an object this draft did not mint is a pipeline bug, and shipping it would put the mark
        # anywhere at all — the board says nothing rather than something wrong (BOARD.md §6).
        if isinstance(anchor, dict) and "object" in anchor and anchor.get("at") is None:
            raise Unverified(
                f"{obj['kind']} {obj['id']} hangs off an object with no known board origin"
            )
        return
    ox, oy = float(origin[0]), float(origin[1])
    if obj["kind"] in _PATH_KINDS:
        points = obj.get("points")
        if isinstance(points, list):
            obj["points"] = [
                [round(float(pt[0]) - ox, 2), round(float(pt[1]) - oy, 2)]
                for pt in points
                if isinstance(pt, (list, tuple)) and len(pt) == 2
            ]
    else:
        to = obj.get("to")
        if isinstance(to, (list, tuple)) and len(to) == 2:
            obj["to"] = [round(float(to[0]) - ox, 2), round(float(to[1]) - oy, 2)]
