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

#: THE TYPE IS THE RULER, NOT THE FIGURE — the whole of the legibility law, and it runs backwards
#: from the way it looks.
#:
#: Written type on the board is a FIXED size in board units (``geometry.ts``: ``LABEL_SIZE`` 22 for
#: a label, a number, a table cell and an axis label; ``WRITE_SIZE`` 30 for a note), and the plane's
#: camera FITS THE INK: ``layout.ts fitCamera`` sets ``zoom = min(1000 * 0.78 / bounds.w,
#: viewHeight * 0.78 / bounds.h)``. So the only thing that decides how many PIXELS a number is drawn
#: at is how wide and how tall the drawing around it is. Draw the figure big and the camera pulls
#: back and the writing shrinks with it.
#:
#: Measured on the real plane, 2026-09-09: it is 496 x 282 px at 1440 and 366 x 393 px at 390.
#: Solving the two for 22-unit type at 12 px gives ``bounds.w <= 524`` (the 390 screen binds) and
#: ``bounds.h <= 403`` (the 1440 screen binds), and ``contentBounds`` adds ``BOARD_PADDING`` (28)
#: on every side. That is the budget below. On that day the Punnett square was drawn 453 x 316 and
#: its cells measured 15.3 px; the projectile was drawn 1409 units across and its labels measured
#: 3.3 px. Same board, same type size, one difference.
#:
#: FIGURE is where the GEOMETRY goes; the union of everything — the labels and the notes hanging
#: off it, which do not shrink with it — has to stay inside FIGURE_UNION, which is the budget
#: above less the padding. 260 x 160 for the figure is what leaves room for both, and it was
#: settled by measuring: at 320 x 190 the lens and the plant cell came out at 11.2 and 11.4 px,
#: and at 260 x 160 the twenty-one from-scratch boards run 12.5 to 37 px at both widths.
FIGURE: tuple[float, float, float, float] = (370.0, 395.0, 260.0, 160.0)
#: The widest and tallest the union of every object on a from-scratch board may be, padding in.
FIGURE_UNION = (468.0, 347.0)
#: The middle of the figure box — where a drawing that has no frame of its own is centred.
FIGURE_MID = (FIGURE[0] + FIGURE[2] / 2, FIGURE[1] + FIGURE[3] / 2)
#: Type the pipelines write, in board units. The same size as a number, so a label and the number
#: beside it read as one hand.
TYPE_UNITS = 22
#: A note longer than this does not fit the budget above: at 22 units a character is about 9
#: units wide, so 28 of them is 258 board units — more than half the figure. Wobo says the rest
#: out loud, which is where a sentence belongs anyway (DESIGN.md 0: never narrate the drawing).
MAX_NOTE_CHARS = 28

#: WHAT THE FLOOR IS ON, AND WHAT IT IS NOT ON (measured, 2026-09-09, wave 45).
#:
#: Wave 43 reported "61 of 61 boards clear the 12 px floor" and the adversary re-measured 105 board
#: renders and found 62 of them carrying a written thing whose INK was under 12 px — "axon" on the
#: neuron at 5.4 px, "stoma" on the leaf at 6.9 px. Both measurements are correct. They measure two
#: different things, and the difference is the whole of finding 2.
#:
#: * The **em** is :data:`TYPE_UNITS` (or ``WRITE_SIZE``) times the camera's zoom. It is the type
#:   size, and it is what this module can choose.
#: * The **ink** is how tall the tallest glyph in a word actually draws, and it depends on WHICH
#:   LETTERS ARE IN THE WORD. Measured on the neuron at 390 with one type size: "dendrite" 9.9 px,
#:   "myelin sheath" 9.8 px, "axon" 5.4 px. The ratios are 0.66 of the em for a word with an
#:   ascender or a descender, 0.36 for a word that is all x-height, and 0.80 to 0.87 for digits.
#:
#: So a floor on the INK is a floor on the em divided by 0.36 in the worst case: 12 px of ink on
#: "axon" needs a 33 px em. THIS BOX CANNOT REACH THAT. The arithmetic, at 390, where the plane
#: measures 366 px for 1000 board units and the camera fills 0.78 of it::
#:
#:     rendered em = 285.5 x T / (gap + labels x T + 56)
#:
#: For the neuron — six labels in two columns either side of a 138-unit figure, the columns 2.75
#: and 4.72 ems wide — that is 285.5T/(194 + 7.47T), which rises to 38 px as T rises and the figure
#: shrinks to nothing. Measured against it: T=22 gives 17.5 px predicted and 17.6 px on the screen,
#: T=60 gives 26.7 px predicted and 24.4 px on the screen. 33 px of em is off the end of that
#: curve, with a figure of zero size. A labelled diagram with six names at 390 cannot carry 12 px
#: of ink on an all-x-height word, whatever this module does.
#:
#: Two things upstream of here would move it, and both live in ``packages/wobo/src/board``:
#:
#: 1. ``geometry.ts`` reads ``object.size`` for ``write``, ``label`` and ``tex`` and IGNORES it for
#:    ``number``, ``axis``, ``table``, ``region`` and ``bracket``, which are hard-coded to
#:    ``LABEL_SIZE``/``WRITE_SIZE``. Measured with TYPE_UNITS at 60: the neuron's labels grew and
#:    the free-body diagram's "10.00 N" did not. Half the writing on the board is out of reach.
#: 2. Type is a size in BOARD UNITS, so the camera shrinks it with the drawing. Strokes already
#:    render in screen pixels (``vector-effect="non-scaling-stroke"``); type does not.
#:
#: Two board-composition costs measured here, for whoever takes that on: the free-body diagram's
#: 17-character note "the arrows cancel" is 366 board units wide against a 220-unit drawing and
#: sets that board's whole width (its em is 8.5 px at 1440, the worst of the 38 measured); and the
#: client's note placer walks colliding labels apart in board units, so SHRINKING :data:`FIGURE`
#: does not shrink the bounds on a crowded board — measured at 200 x 123 the neuron improved from
#: 15.0 to 17.6 px em and the ray diagram got WORSE, 12.6 to 11.8, because its labels collided
#: sooner and were walked further out. That is why this box is unchanged.
_SLUG_RE = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class Frame:
    """A rectangle of board space, and the data range it shows.

    The whole point of the frame is that a pipeline thinks in the units of its subject — metres,
    volts, moles, x — and never in board units. :meth:`at` is the one crossing.
    """

    x0: float = FIGURE[0]
    y0: float = FIGURE[1]
    w: float = FIGURE[2]
    h: float = FIGURE[3]
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

    @classmethod
    def fit(
        cls,
        xmin: float,
        xmax: float,
        ymin: float,
        ymax: float,
        *,
        box: tuple[float, float, float, float] | None = None,
    ) -> Frame:
        """A frame that shows this data range AT ONE SCALE, centred in the figure box.

        The default :class:`Frame` stretches: it maps whatever x-range it is given across 760 board
        units and whatever y-range across 700, so a projectile 40.8 m long and 10.2 m high came out
        with its height exaggerated 2.9 times — a parabola that is not the parabola the ball flew
        (the evidence lab, 2026-09-09, ``turns/scratch/physics-projectile-1440``). Anything that
        lives in PHYSICAL space — a trajectory, a ray diagram, a triangle, a construction — is
        built through here instead, where one metre is one length whichever way it is measured.
        """
        left, top, width, height = box or FIGURE
        span_x = (xmax - xmin) or 1.0
        span_y = (ymax - ymin) or 1.0
        scale = min(width / span_x, height / span_y)
        w, h = span_x * scale, span_y * scale
        return cls(
            x0=round(left + (width - w) / 2, 2),
            y0=round(top + (height - h) / 2, 2),
            w=round(w, 2),
            h=round(h, 2),
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
        )

    @property
    def per_unit(self) -> float:
        """Board units per unit of the subject, on the x axis."""
        return self.w / ((self.xmax - self.xmin) or 1.0)

    @property
    def per_unit_y(self) -> float:
        return self.h / ((self.ymax - self.ymin) or 1.0)


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
    #: The learner's own sentence. Every GIVEN a pipeline draws is read out of this rather than
    #: taken from whoever wrote the intent — see :meth:`given`.
    ask: str = ""
    ledger: Ledger = field(default_factory=Ledger)
    objects: list[dict[str, Any]] = field(default_factory=list)
    #: Every object's absolute board origin, by id. A path or a bond is written in absolute board
    #: coordinates by the pipeline and rebased into offsets at :meth:`add`; when the object hangs
    #: off ANOTHER object rather than off board space, this is where its origin is looked up.
    origins: dict[str, list[float]] = field(default_factory=dict)
    _n: int = 0

    def given(
        self,
        label: str,
        fallback: Any,
        *cues: str,
        unit: str | None = None,
        magnitude: bool = False,
        sign: float = 1.0,
    ) -> Any:
        """The learner's own number for this quantity, or ``fallback`` when they named none.

        THE ASK IS THE SOURCE OF EVERY GIVEN. "a convex lens of focal length 15 cm with the object
        30 cm away" was drawn as a lens of focal length 10, with the image at 15 and the
        magnification at -0.5 — every number on the board signed ``verified`` by a CAS that had
        genuinely proved them, of a lens nobody had asked about (the evidence lab, 2026-09-09,
        ``turns/scratch/physics-lens-1440``). The arithmetic was right and the board was wrong,
        because nothing between the sentence and the pen had read the sentence.

        The check that goes in the ledger names the words it read the number out of, and says what
        it was about to be drawn as instead, so the board can prove it answered the question asked.
        """
        from wobo_gateway.board import verify

        try:
            reference = float(fallback)
        except (TypeError, ValueError):
            reference = None
        value, check = verify.from_the_ask(
            label,
            self.ask,
            *cues,
            fallback=abs(reference) if (magnitude and reference is not None) else reference,
            unit=unit,
        )
        if value is None or check is None:
            return fallback
        self.ledger.note(check)
        return (abs(value) if magnitude else value) * sign

    def given_unit(self, fallback: str | None, *cues: str) -> str | None:
        """The unit the learner wrote beside one of these words. ``cm`` is not ``m``."""
        from wobo_gateway.board import verify

        return verify.unit_from_the_ask(self.ask, *cues) or fallback

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
        _size_the_writing(obj)
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


#: The kinds whose text the hand writes out and a learner has to read.
_WRITTEN_KINDS = ("write", "label", "tex", "note")


def _size_the_writing(obj: dict[str, Any]) -> None:
    """Every written thing carries its type size, and nothing is longer than the board can show.

    ``geometry.ts`` defaults a note to 30 units and a label to 22; a pipeline that names neither is
    at the mercy of which kind it happened to pick. Naming it here makes the whole board one hand,
    and makes :data:`FIGURE_UNION` a budget that can actually be kept — a 37-character note is 340
    board units of ink on its own, which is most of the figure and all of the reason the labels
    beside it came out at 3 px (the evidence lab, 2026-09-09).
    """
    if obj["kind"] in _WRITTEN_KINDS:
        obj.setdefault("size", TYPE_UNITS)
    # A title on a region, a label on an axis or a bracket is written out by the same hand at the
    # same size, so it is held to the same length even though its kind carries no `size` field.
    for field_name in ("text", "tex", "label", "title"):
        text = obj.get(field_name)
        if isinstance(text, str) and len(text) > MAX_NOTE_CHARS:
            raise Unverified(
                f"{text[:24]!r} is {len(text)} characters and the board can show "
                f"{MAX_NOTE_CHARS} — Wobo says the rest out loud"
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


def run_intent(intent: dict[str, Any], *, index: int = 0, ask: str = "") -> Draft:
    """Dispatch one intent to its pipeline. Raises :class:`Unverified` when it cannot be drawn.

    ``ask`` is the learner's own sentence, carried down so a pipeline reads its givens out of the
    question instead of trusting whoever wrote the intent (:meth:`Draft.given`).
    """
    from wobo_gateway.board.pipelines import bio_social, chemistry, math, physics

    handlers: dict[str, Callable[[dict[str, Any], str, str], Draft]] = {
        "math": math.build,
        "physics": physics.build,
        "chemistry": chemistry.build,
        "bio_social": bio_social.build,
    }
    name = str(intent.get("pipeline") or "").strip()
    handler = handlers.get(name)
    if handler is None:
        raise Unverified(f"there is no {name!r} pipeline")
    return handler(intent, f"{name[0]}{index}_", ask)


__all__ = [
    "FIGURE",
    "FIGURE_MID",
    "FIGURE_UNION",
    "MAX_NOTE_CHARS",
    "TYPE_UNITS",
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
