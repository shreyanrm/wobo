"""The board grammar, mirrored in the brain — the one thing a board object is checked against.

`docs/BOARD.md` §2 and §3 are the law. `packages/wobo/src/board/schema.ts` is the single source
of truth on the hand's side, and it is generated into ``wobo_gateway.board_schema``; this
module ADOPTS that mirror at import (:func:`_adopt_generated`) so the vocabulary and the per-kind
field names can never drift between the two halves of Wobo. The table written out below is the
fallback for the case where the generated file is not there, and it is kept in step with it by
``test_the_brain_validates_against_the_generated_mirror``.

Two laws are enforced here rather than in prose:

1. **Nothing is placed by pixels.** An anchor is a registry target, another object, a focus
   region, or board space (a 1000-unit logical square). There is no fifth form, and there is no
   pixel form.
2. **Every number on a board is computed and verified before it is drawn.** Any object whose
   visible text carries a numeral must name the check that passed (``check``). A model cannot
   write ``4.9`` onto a board by asserting it; a pipeline computes it and the verifier signs it.

The validator is plain Python — no jsonschema dependency for a table this small — and returns a
list of human-readable problems rather than raising, because the planner refuses per object and
keeps the rest of the board.
"""

from __future__ import annotations

import re
from typing import Any

# --- the vocabulary (BOARD.md §2) -----------------------------------------------------------

MARK_KINDS: tuple[str, ...] = (
    "point",
    "circle",
    "underline",
    "arrow",
    "bracket",
    "strike",
    "number",
    "write",
    "erase",
    "wipe",
)
SHAPE_KINDS: tuple[str, ...] = (
    "line",
    "polyline",
    "curve",
    "polygon",
    "ellipse",
    "axis",
    "grid",
    "table",
    "label",
    "tex",
    "bond",
    "atom",
    "region",
    "image",
)
CONTROL_KINDS: tuple[str, ...] = ("slider", "toggle", "input", "drag")
# BOARD.md §4: "any event may reference earlier object ids". A patch carries an EARLIER id and
# changes what is already drawn; it is a grammar of its own rather than a kind of object.
PATCH_KINDS: tuple[str, ...] = ("fade", "remove", "redraw", "repoint", "move", "restyle")

OBJECT_KINDS: tuple[str, ...] = MARK_KINDS + SHAPE_KINDS + CONTROL_KINDS

INK_STYLES: tuple[str, ...] = ("wobo", "accent", "learner", "faint")
PRESENTATIONS: tuple[str, ...] = ("screen", "plane", "full")

#: The logical board is a square of this many units on a side (BOARD.md §3).
BOARD_UNITS = 1000.0

#: ``at`` accepts these words, or a fraction pair ``[u, v]`` in 0..1.
AT_WORDS: tuple[str, ...] = (
    "center",
    "top",
    "bottom",
    "left",
    "right",
    "topLeft",
    "topRight",
    "bottomLeft",
    "bottomRight",
)

_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,63}$")
_NUMERAL_RE = re.compile(r"\d")
_MAX_TEXT = 400
#: Where the generated grammar is tighter than the general cap, it wins — a label the hand
#: would truncate is a label the brain should not have written.
_TEXT_LIMITS: dict[tuple[str, str], int] = {
    ("axis", "label"): 40,
    ("number", "label"): 80,
    ("region", "title"): 80,
    ("image", "alt"): 160,
    ("slider", "label"): 40,
    ("toggle", "label"): 40,
    ("input", "label"): 40,
    ("drag", "label"): 40,
    ("input", "value"): 80,
}
_MAX_POINTS = 400

# kind -> (required fields, optional fields), as the generated mirror declares them. Common
# fields (id/kind/anchor/style/t/depends) are checked for every kind and are not repeated here;
# ``check`` and ``meta`` are the brain's own additions and are common too.
_FIELDS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    # marks
    "point": ((), ()),
    "circle": ((), ("pad",)),
    "underline": ((), ()),
    "strike": ((), ()),
    "bracket": ((), ("side", "label")),
    # An arrow points AT its anchor and starts at ``from`` — the head is the thing it is about.
    "arrow": ((), ("from", "curve")),
    "number": (("value", "verified"), ("unit", "label", "precision")),
    "write": (("text",), ("size", "maxWidth")),
    "erase": (("object",), ()),
    "wipe": ((), ()),
    # shapes
    "line": (("to",), ()),
    "polyline": (("points",), ()),
    "curve": (("points",), ("closed",)),
    # ``title`` is the board naming its own shape for a listener: spoken, never drawn. Three
    # identical squares on a Pythagoras board are three identical sentences without it.
    "polygon": (("points",), ("title",)),
    "ellipse": (("rx", "ry"), ()),
    "axis": (("orientation", "min", "max", "step", "length"), ("label", "ticks")),
    "grid": (("cols", "rows", "w", "h"), ()),
    "table": (("rows", "w"), ("rowHeight",)),
    "label": (("text",), ("size",)),
    "tex": (("tex",), ("size",)),
    "atom": (("symbol",), ("charge", "lonePairs", "size")),
    "bond": (("to",), ("order", "wedge")),
    "region": (("w", "h"), ("title",)),
    "image": (("href", "w", "h", "alt"), ()),
    # controls
    "slider": (("variable", "min", "max", "value"), ("step", "w", "label")),
    "toggle": (("variable", "value"), ("label",)),
    "input": (("variable", "value"), ("w", "label")),
    "drag": (("variable", "value"), ("bounds", "label")),
}

#: Is this field turned into glyphs the learner can read? Every field name in ``_FIELDS`` is
#: classified exactly once, and ``test_every_board_field_is_classified_as_visible_or_not`` fails the
#: moment a new one is added without an answer — which is how a table's ``rows`` came to carry
#: numerals past the verified-number law for a whole wave. ``geometry.ts`` is the arbiter: what it
#: sends through ``writeText`` is visible, what it turns into a path is not.
_VISIBLE_BY_NAME: dict[str, bool] = {
    # written, drawn, announced — a numeral in any of these is a numeral on the board
    "text": True,
    "tex": True,
    "label": True,
    "title": True,
    "value": True,
    "unit": True,
    "symbol": True,
    "rows": True,
    "alt": True,
    # geometry and behaviour: numbers that describe a shape or a scale rather than assert a fact.
    # An axis running 0..10 is a ruler the frame computed, not a quantity Wobo is claiming; refusing
    # it would demand a verifier for every gridline.
    "min": False,
    "max": False,
    "step": False,
    "length": False,
    "ticks": False,
    "cols": False,
    "w": False,
    "h": False,
    "rowHeight": False,
    "size": False,
    "maxWidth": False,
    "rx": False,
    "ry": False,
    "pad": False,
    "side": False,
    "from": False,
    "curve": False,
    "to": False,
    "points": False,
    "closed": False,
    "orientation": False,
    "precision": False,
    "verified": False,
    "object": False,
    "charge": False,
    "lonePairs": False,
    "order": False,
    "wedge": False,
    "href": False,
    "variable": False,
    "bounds": False,
}

#: Where one field name means two different things depending on the kind. ``table.rows`` is the
#: text in the cells; ``grid.rows`` is how many lines to rule.
#:
#: The same split runs through ``value``. On a ``number`` (or a label, or a table cell) it is a
#: quantity Wobo is ASSERTING, and the verified-number law rightly demands the check that signed
#: it. On a control it is the STATE OF THE VARIABLE THE LEARNER DRIVES — where the knob sits now
#: — and ``geometry.ts`` is the arbiter this table names: a slider's value becomes the knob's
#: position along the track, a toggle's picks which end the knob rests at, a drag's is an ``[dx,
#: dy]`` offset for the handle. None of the three ever reaches ``writeText``, so none of them is
#: a numeral on the board, and no verifier could sign one anyway — the learner changes it with
#: their thumb a moment later. ``input.value`` is the exception that proves it: geometry DOES
#: write that one out as glyphs, so it stays visible and stays under the law.
_VISIBLE_OVERRIDES: dict[tuple[str, str], bool] = {
    ("grid", "rows"): False,
    ("slider", "value"): False,
    ("toggle", "value"): False,
    ("drag", "value"): False,
}


def is_visible_field(kind: str, name: str) -> bool:
    """Does the hand write this field of this kind where the learner can read it?"""
    override = _VISIBLE_OVERRIDES.get((kind, name))
    if override is not None:
        return override
    return _VISIBLE_BY_NAME.get(name, False)


def _flatten_text(value: Any) -> list[str]:
    """Every string inside a field, however nested — a table's rows are lists of lists of cells."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple)):
        return [s for item in value for s in _flatten_text(item)]
    if value is None or isinstance(value, bool):
        return []
    if isinstance(value, (int, float)):
        return [str(value)]
    return []


def visible_text(obj: dict[str, Any]) -> str:
    """Everything on this object the learner can read, as one string."""
    kind = str(obj.get("kind") or "")
    parts: list[str] = []
    for name, value in obj.items():
        if value is not None and is_visible_field(kind, name):
            parts.extend(_flatten_text(value))
    return " ".join(parts)


#: Patches carry an EXISTING object's id and change it; they are their own grammar on the hand's
#: side (``BOARD_PATCH_SCHEMA``), so they are validated separately from a new object.
_PATCH_FIELDS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "fade": ((), ()),
    "remove": ((), ()),
    "redraw": ((), ()),
    "repoint": (("anchor",), ()),
    "move": (("anchor",), ()),
    "restyle": (("style",), ()),
}

# ``check`` and ``meta`` are the brain's, not the hand's: the generated schemas do not close
# their objects, so an extra property is legal on the wire and the hand simply ignores it.
_COMMON = frozenset({"id", "kind", "anchor", "style", "t", "depends", "meta", "check"})


def contains_number(text: Any) -> bool:
    """Does this visible text carry a numeral? The trigger for the verified-number law."""
    return bool(_NUMERAL_RE.search(str(text or "")))


def _is_num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _board_coord(value: Any) -> bool:
    return (
        isinstance(value, (list, tuple))
        and len(value) == 2
        and all(_is_num(v) and 0.0 <= float(v) <= BOARD_UNITS for v in value)
    )


def validate_anchor(anchor: Any, *, field: str = "anchor") -> list[str]:
    """One anchor, one of the four forms in BOARD.md §3. Never a pixel, never a bare number."""
    if not isinstance(anchor, dict):
        return [f"{field} must be an object"]
    forms = [k for k in ("target", "object", "focus", "board") if k in anchor]
    if len(forms) != 1:
        return [f"{field} must name exactly one of target, object, focus, board"]
    form = forms[0]
    problems: list[str] = []
    if form == "board":
        if not _board_coord(anchor["board"]):
            problems.append(f"{field}.board must be [x, y] inside 0..{BOARD_UNITS:g}")
    else:
        value = anchor[form]
        if not isinstance(value, str) or not value.strip():
            problems.append(f"{field}.{form} must be a non-empty id")
    at = anchor.get("at")
    if at is not None:
        ok_word = isinstance(at, str) and at in AT_WORDS
        ok_pair = (
            isinstance(at, (list, tuple))
            and len(at) == 2
            and all(_is_num(v) and 0.0 <= float(v) <= 1.0 for v in at)
        )
        if not (ok_word or ok_pair):
            problems.append(f"{field}.at must be one of {AT_WORDS} or a fraction pair")
    offset = anchor.get("offset")
    if offset is not None and not (
        isinstance(offset, (list, tuple)) and len(offset) == 2 and all(_is_num(v) for v in offset)
    ):
        problems.append(f"{field}.offset must be a pair of numbers")
    unknown = set(anchor) - {"target", "object", "focus", "board", "at", "offset"}
    if unknown:
        problems.append(f"{field} has unknown keys: {sorted(unknown)}")
    return problems


def _validate_style(style: Any) -> list[str]:
    if style is None:
        return []
    if not isinstance(style, dict):
        return ["style must be an object"]
    problems: list[str] = []
    ink = style.get("ink")
    if ink is not None and ink not in INK_STYLES:
        problems.append(f"style.ink must be one of {INK_STYLES}")
    weight = style.get("weight")
    if weight is not None and not (isinstance(weight, int) and 1 <= weight <= 4):
        problems.append("style.weight must be an integer 1..4")
    for flag in ("dash", "fill"):
        value = style.get(flag)
        if value is not None and not isinstance(value, (bool, str)):
            problems.append(f"style.{flag} must be a boolean or a token")
    return problems


def _validate_timing(t: Any) -> list[str]:
    if t is None:
        return []
    if not isinstance(t, dict):
        return ["t must be an object with start and dur in milliseconds"]
    problems: list[str] = []
    for key in ("start", "dur"):
        value = t.get(key)
        if value is None:
            continue
        if not _is_num(value) or float(value) < 0:
            problems.append(f"t.{key} must be a non-negative number of milliseconds")
    return problems


def _offset_pair(value: Any) -> bool:
    """A displacement in board units: finite, and no longer than the board is wide."""
    return (
        isinstance(value, (list, tuple))
        and len(value) == 2
        and all(_is_num(v) and abs(float(v)) <= BOARD_UNITS for v in value)
    )


def _validate_points(points: Any) -> list[str]:
    """A path is one stroke: a list of OFFSETS from the object's own anchor.

    Offsets, not board coordinates — that is what the hand reads
    (``packages/wobo/src/board/geometry.ts``: ``offsetPoints``), and it is the only reading a shape
    anchored to a registry target or to another object can have, since the brain cannot know where
    those will land. Demanding absolute 0..1000 coordinates here refused every legal polygon whose
    outline runs up or left from its own first point — which is most of them.
    """
    if not isinstance(points, list) or not points:
        return ["points must be a non-empty list"]
    if len(points) > _MAX_POINTS:
        return [f"points has {len(points)} entries (limit {_MAX_POINTS})"]
    return [
        f"points[{i}] must be [dx, dy] within {BOARD_UNITS:g} board units of the anchor"
        for i, point in enumerate(points)
        if not _offset_pair(point)
    ]


def _validate_kind_fields(obj: dict[str, Any], kind: str) -> list[str]:
    required, optional = _FIELDS[kind]
    problems: list[str] = []
    for name in required:
        if obj.get(name) is None:
            problems.append(f"{kind} requires {name}")
    allowed = _COMMON | set(required) | set(optional)
    unknown = set(obj) - allowed
    if unknown:
        problems.append(f"{kind} has unknown fields: {sorted(unknown)}")

    # ``line.to`` and ``arrow.from`` are anchors; ``bond.to`` is the other atom's board point.
    if kind == "line" and isinstance(obj.get("to"), dict):
        problems.extend(validate_anchor(obj["to"], field="to"))
    if kind == "arrow" and isinstance(obj.get("from"), dict):
        problems.extend(validate_anchor(obj["from"], field="from"))
    # `bond.to` is the other atom's position RELATIVE to this bond's anchor, for the same reason a
    # path is: `geometry.ts` draws the bond from the resolved anchor to `anchor + to`. A ring cannot
    # be written any other way — two of a hexagon's six edges run up and to the left of their start.
    if kind == "bond" and "to" in obj and not _offset_pair(obj["to"]):
        problems.append("bond.to must be [dx, dy] from this bond's anchor, in board units")
    if kind in ("polyline", "curve", "polygon") and "points" in obj:
        problems.extend(_validate_points(obj["points"]))
        if isinstance(obj["points"], list) and len(obj["points"]) < 2:
            problems.append(f"{kind} needs at least two points")
    for name in ("rx", "ry", "w", "h", "size", "rowHeight", "maxWidth", "length", "step"):
        if name in obj and not (_is_num(obj[name]) and float(obj[name]) > 0):
            problems.append(f"{kind}.{name} must be a positive number")
    if kind == "number":
        if "value" in obj and not _is_num(obj["value"]):
            problems.append("number.value must be numeric")
        if obj.get("verified") is not True:
            problems.append("a number is drawn only when it is verified")
    if kind == "axis":
        if obj.get("orientation") not in ("x", "y"):
            problems.append("axis.orientation must be 'x' or 'y'")
        lo, hi = obj.get("min"), obj.get("max")
        if not (_is_num(lo) and _is_num(hi)):
            problems.append("axis needs numeric min and max")
        elif float(lo) >= float(hi):
            problems.append("axis.min must be below axis.max")
        if "ticks" in obj and not isinstance(obj["ticks"], bool):
            problems.append("axis.ticks is a flag, not a count")
    if kind == "grid":
        for name in ("cols", "rows"):
            value = obj.get(name)
            if not (isinstance(value, int) and 1 <= value <= 60):
                problems.append(f"grid.{name} must be an integer 1..60")
    if kind == "bond" and obj.get("order", 1) not in (1, 2, 3):
        problems.append("bond.order must be 1, 2 or 3")
    if kind == "atom":
        symbol = obj.get("symbol")
        if not isinstance(symbol, str) or not 1 <= len(symbol) <= 3:
            problems.append("atom.symbol must be an element symbol")
        charge = obj.get("charge")
        if charge is not None and not (isinstance(charge, int) and -4 <= charge <= 4):
            problems.append("atom.charge must be a whole charge between -4 and 4")
    if kind == "table":
        rows = obj.get("rows")
        if (
            not isinstance(rows, list)
            or not 1 <= len(rows) <= 24
            or not all(
                isinstance(r, list) and 1 <= len(r) <= 12 and all(isinstance(c, str) for c in r)
                for r in rows
            )
        ):
            problems.append("table.rows must be 1..24 rows of 1..12 text cells")
    if kind == "erase" and not isinstance(obj.get("object"), str):
        problems.append("erase.object must name one object id")
    if kind in CONTROL_KINDS:
        variable = obj.get("variable")
        if not isinstance(variable, str) or not variable.strip():
            problems.append(f"{kind}.variable must be a name")
        if kind == "slider":
            lo, hi = obj.get("min"), obj.get("max")
            if _is_num(lo) and _is_num(hi) and float(lo) >= float(hi):
                problems.append("slider.min must be below slider.max")

    for name in ("text", "label", "tex", "alt", "title", "symbol"):
        value = obj.get(name)
        if value is None:
            continue
        limit = _TEXT_LIMITS.get((kind, name), _MAX_TEXT)
        if not isinstance(value, str) or len(value) > limit:
            problems.append(f"{kind}.{name} must be text of at most {limit} characters")
    return problems


def validate_patch(patch: Any) -> list[str]:
    """A change to an object already on the board (BOARD.md §4)."""
    if not isinstance(patch, dict):
        return ["a patch must be a JSON object"]
    kind = patch.get("kind")
    if kind not in PATCH_KINDS:
        return [f"a patch kind must be one of {PATCH_KINDS}, got {kind!r}"]
    problems: list[str] = []
    if not isinstance(patch.get("id"), str) or not patch["id"].strip():
        problems.append("a patch must name the object it changes")
    required, optional = _PATCH_FIELDS[kind]
    for name in required:
        if patch.get(name) is None:
            problems.append(f"{kind} requires {name}")
    unknown = set(patch) - {"id", "kind", "t"} - set(required) - set(optional)
    if unknown:
        problems.append(f"{kind} has unknown fields: {sorted(unknown)}")
    if "anchor" in patch:
        problems.extend(validate_anchor(patch["anchor"]))
    problems.extend(_validate_style(patch.get("style")))
    problems.extend(_validate_timing(patch.get("t")))
    return problems


def validate_object(obj: Any) -> list[str]:
    """Every problem with one board object, in reading order. Empty means it may be drawn."""
    if not isinstance(obj, dict):
        return ["object must be a JSON object"]
    problems: list[str] = []

    obj_id = obj.get("id")
    if not isinstance(obj_id, str) or not _ID_RE.match(obj_id):
        problems.append("id must be a short identifier: a letter then letters, digits, _ . : -")

    kind = obj.get("kind")
    if kind not in OBJECT_KINDS:
        return [*problems, f"kind must be one of the board grammar, got {kind!r}"]

    # Placement is an anchor or it is nothing. A wipe clears the board and belongs nowhere.
    if kind != "wipe" or obj.get("anchor") is not None:
        problems.extend(validate_anchor(obj.get("anchor")))

    problems.extend(_validate_style(obj.get("style")))
    problems.extend(_validate_timing(obj.get("t")))

    depends = obj.get("depends")
    if depends is not None and (
        not isinstance(depends, list) or not all(isinstance(d, str) for d in depends)
    ):
        problems.append("depends must be a list of variable names")

    problems.extend(_validate_kind_fields(obj, kind))

    # The verified-number law. A numeral the learner can read must name the check that passed —
    # wherever it is written, a table's cells included.
    if contains_number(visible_text(obj)) and not str(obj.get("check") or "").strip():
        problems.append(
            "an object showing a number must name the check that verified it (check: ...)"
        )
    return problems


def is_valid(obj: Any) -> bool:
    return not validate_object(obj)


# --- the JSON Schema view (for the reconcile with the TS grammar) ---------------------------


def json_schema() -> dict[str, Any]:
    """A draft 2020-12 view of the table above — what Worker 2's generated mirror is diffed
    against. Derived from ``_FIELDS`` so the two can never drift apart inside this module."""
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "board object",
        "type": "object",
        "required": ["id", "kind"],
        "properties": {
            "id": {"type": "string", "pattern": _ID_RE.pattern},
            "kind": {"enum": list(OBJECT_KINDS)},
            "anchor": {"$ref": "#/$defs/anchor"},
            "style": {"$ref": "#/$defs/style"},
            "t": {
                "type": "object",
                "properties": {
                    "start": {"type": "number", "minimum": 0},
                    "dur": {"type": "number", "minimum": 0},
                },
            },
            "depends": {"type": "array", "items": {"type": "string"}},
        },
        "$defs": {
            "anchor": {
                "type": "object",
                "oneOf": [
                    {"required": ["target"]},
                    {"required": ["object"]},
                    {"required": ["focus"]},
                    {"required": ["board"]},
                ],
                "properties": {
                    "target": {"type": "string"},
                    "object": {"type": "string"},
                    "focus": {"type": "string"},
                    "board": {
                        "type": "array",
                        "minItems": 2,
                        "maxItems": 2,
                        "items": {"type": "number", "minimum": 0, "maximum": BOARD_UNITS},
                    },
                    "at": {},
                },
            },
            "style": {
                "type": "object",
                "properties": {
                    "ink": {"enum": list(INK_STYLES)},
                    "weight": {"type": "integer", "minimum": 1, "maximum": 4},
                    "dash": {},
                    "fill": {},
                },
            },
            "kinds": {
                kind: {"required": list(req), "optional": list(opt)}
                for kind, (req, opt) in _FIELDS.items()
            },
        },
    }


def _generated() -> Any | None:
    """The mirror generated from ``packages/wobo/src/board/schema.ts``, wherever it was written."""
    for module in ("wobo_gateway.board_schema", "wobo_gateway.board.board_schema"):
        try:
            return __import__(module, fromlist=["BOARD_OBJECT_SCHEMA"])
        except ImportError:
            continue
    return None


def _fields_from(
    object_schema: dict[str, Any], *, placed: bool = True
) -> dict[str, tuple[tuple[str, ...], ...]]:
    """Per-kind required and optional field names, read off the generated ``oneOf`` branches.

    ``placed`` objects carry their anchor as a common field; a patch declares it per kind.
    """
    out: dict[str, tuple[tuple[str, ...], ...]] = {}
    common = ("id", "kind", "anchor") if placed else ("id", "kind")
    for branch in object_schema.get("oneOf") or []:
        properties = branch.get("properties") or {}
        kind = (properties.get("kind") or {}).get("const")
        if not isinstance(kind, str):
            continue
        required = tuple(name for name in branch.get("required") or [] if name not in common)
        optional = tuple(
            name
            for name in properties
            if name not in required and name not in _COMMON and name != "kind"
        )
        out[kind] = (required, optional)
    return out


def _adopt_generated() -> None:
    """Reconcile with the grammar generated from ``schema.ts`` — the single source of truth.

    The vocabulary and the per-kind field names come from the TypeScript grammar, so the two
    halves of Wobo can never drift; the anchor rule and the verified-number law stay here, because
    they are laws about how the brain composes rather than about what the hand can render.
    """
    module = _generated()
    if module is None:
        return
    global OBJECT_KINDS, MARK_KINDS, SHAPE_KINDS, CONTROL_KINDS, PATCH_KINDS
    global INK_STYLES, PRESENTATIONS, BOARD_UNITS
    MARK_KINDS = tuple(getattr(module, "MARK_KINDS", MARK_KINDS))
    SHAPE_KINDS = tuple(getattr(module, "SHAPE_KINDS", SHAPE_KINDS))
    CONTROL_KINDS = tuple(getattr(module, "CONTROL_KINDS", CONTROL_KINDS))
    PATCH_KINDS = tuple(getattr(module, "PATCH_KINDS", PATCH_KINDS))
    INK_STYLES = tuple(getattr(module, "INK_ROLES", INK_STYLES))
    PRESENTATIONS = tuple(getattr(module, "PRESENTATIONS", PRESENTATIONS))
    BOARD_UNITS = float(getattr(module, "BOARD_UNITS", BOARD_UNITS))
    OBJECT_KINDS = tuple(getattr(module, "OBJECT_KINDS", MARK_KINDS + SHAPE_KINDS + CONTROL_KINDS))
    schema_ = getattr(module, "BOARD_OBJECT_SCHEMA", None)
    if isinstance(schema_, dict):
        for kind, fields in _fields_from(schema_).items():
            _FIELDS[kind] = (tuple(fields[0]), tuple(fields[1]))
    patches = getattr(module, "BOARD_PATCH_SCHEMA", None)
    if isinstance(patches, dict):
        for kind, fields in _fields_from(patches, placed=False).items():
            _PATCH_FIELDS[kind] = (tuple(fields[0]), tuple(fields[1]))


_adopt_generated()
