"""Deterministic technical lint — the gate that never blinks.

Runs BEFORE the LLM judge in :mod:`validate`. The judge scores *pedagogical* quality; this
layer catches the SUBTLE *technical* defects a strong-but-imperfect content model emits that
render BROKEN in the browser yet slip past both the structural verifier and the judge:

  • an SVG geometry attribute that is not a number (``cx="undefined"`` — a real production bug),
    a malformed ``viewBox``, a ``<script>``/``<foreignObject>``, a SMIL animation with a garbage
    ``dur`` or a misspelled attribute, a ``url(#ref)`` / ``href="#ref"`` with no matching
    definition (a dangling gradient / filter / use).
  • a SMIL animation with timing and NO animation function — ``<animate attributeName="opacity"
    keyTimes="0;1" dur="1s" keySplines="0.2 0 0 1">`` with no ``values``/``from``/``to``/``by``.
    SMIL builds nothing from it, so it never runs and the mark stays exactly as authored; a mark
    authored at ``opacity="0"`` waiting for it stays invisible for the whole narration. This was
    every film in the product in wave 30 (615 elements, four subjects, all blank), and the raw
    model responses carried the same shape: the defect is generation, and this is its gate.
  • an EVALUATED expression (perturbation output, whatIf working) the client's safe parser
    (``evaluateExpr``) cannot read — the interaction renders dead. Display-only expressions
    (derivation, wordProblem) are deliberately NOT parse-checked: they are free text on the
    client, so checking them would be a false positive.
  • a card-type enum outside the client's exact vocabulary, or a spec coordinate that is not
    numeric.
  • an ANSWER that is provably wrong — a quiz key that does not satisfy its own equation, a key
    that names one of two roots, a line of working that is false (:mod:`maths`). Everything else
    here proves an artifact is not broken; that one proves it is not wrong.

Pure stdlib (``xml`` + ``re``) plus the CAS parser already in the tree. No network, fully
deterministic: the same artifact always lints the same way. It fails CLOSED on a *proven*
defect and OPEN on anything it cannot prove broken — a lint that rejects good content is worse
than no lint, because its verdict routes an expensive Opus rebuild. Every check therefore only
fires on a field that is PRESENT and demonstrably wrong.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

# The CAS parser is the "existing safe-parser" for evaluated expressions. parse_equation raises
# CasError (a ValueError) on anything it cannot parse; wrapping an expression as "0=<expr>" reuses
# it to prove pure parseability without a bespoke expression entrypoint.
from wobo_verifier.cas import parse_equation

# Reuse the client-parity constants + numeric predicate — one source of truth (they already
# mirror the client's exact vocabulary in engines.py, which mirrors the .tsx parsers).
from wobo_gateway.plexus.engines import (
    _INTERACTION_KINDS,
    _ITEM_TYPES,
    _SHAPES,
    _VISUAL_KINDS,
    _fnum,
)

# The answer checker (``maths.py``): the same CAS, asked whether the content is TRUE rather than
# whether it parses. It refuses only what it can prove wrong and declines everything else.
from wobo_gateway.plexus.maths import check_compose


@dataclass
class LintResult:
    ok: bool
    reasons: list[str] = field(default_factory=list)


# A discovery stage's interaction is tap / drag / slide only (no 'type' — Discovery.tsx).
_DISCOVERY_KINDS = {"tap", "drag", "slide"}


# --- SVG technical lint -----------------------------------------------------------------

# Geometry attributes that MUST be a number (optionally with a length unit). "undefined", "NaN",
# "null", or any word here is the exact class of bug that shipped as cx="undefined".
_GEOM_ATTRS = {
    "x", "y", "cx", "cy", "r", "rx", "ry",
    "x1", "y1", "x2", "y2", "width", "height",
}
# A CSS/SVG <length>: a number, optional exponent, optional unit or percent. Rejects non-numeric
# words. (Deliberately permissive on units so a valid "50%"/"10px" is never a false positive.)
_LENGTH_RE = re.compile(
    r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?(px|%|em|ex|rem|pt|pc|cm|mm|in)?$"
)
# A SMIL clock value: "1.6s", "500ms", "2min", "indefinite", or an "hh:mm:ss" clock.
_DUR_RE = re.compile(
    r"^\s*(indefinite|media|\d+(\.\d+)?(h|min|s|ms)?|\d+(:\d\d){1,2}(\.\d+)?)\s*$", re.I
)
_URL_REF_RE = re.compile(r"url\(\s*#([^)\s]+)\s*\)")

_FORBIDDEN_TAGS = {"script", "foreignobject", "iframe", "object", "embed"}
_ANIM_TAGS = {"animate", "animatetransform", "animatemotion", "animatecolor", "set"}
# Every attribute a SMIL animation element may legally carry. A name outside this set (and not an
# aria-/data-/xml- namespaced pass-through) is a misspelling like "attributenam" or "durr".
_SMIL_ATTRS = {
    "attributename", "attributetype", "values", "dur", "begin", "end", "min", "max",
    "restart", "repeatcount", "repeatdur", "fill", "calcmode", "keytimes", "keysplines",
    "from", "to", "by", "additive", "accumulate", "path", "keypoints", "rotate", "origin",
    "type", "href", "id", "class", "style", "role", "tabindex",
    "systemlanguage", "requiredfeatures", "requiredextensions",
}
# What an animation element needs before it HAS an animation function (SMIL Animation §3.2, and
# Blink's animation-mode table, which is what actually runs a film): from+to, from+by, by, to, or
# values. `from` ALONE is no function; an EMPTY function is no function. <animateMotion> may take
# a path or an <mpath> child instead; <set> takes only 'to'. Without one the element is timed but
# never runs. The timing attributes are listed so the reason can say what the model wrote instead
# of the function it forgot.
_FUNCTION_ATTRS = {"values", "from", "to", "by"}
_TIMING_ATTRS = ("keytimes", "dur", "keysplines", "calcmode", "begin", "end", "repeatcount")
# A begin that fires on its own in a film nobody touches: a clock value (optionally signed), or a
# syncbase on another animation ("draw.end", "fade.begin+0.3s"). "indefinite" waits for a script
# that never comes; "click", "mouseover", "accessKey(...)" and "wallclock(...)" wait for a hand
# or a clock the film does not have.
_CLOCK_RE = re.compile(r"^[+-]?\s*(\d+(\.\d+)?(h|min|s|ms)?|\d+(:\d\d){1,2}(\.\d+)?)$", re.I)
_SYNCBASE_RE = re.compile(
    r"^[A-Za-z_][\w\-.]*\.(begin|end)(\s*[+-]\s*\d+(\.\d+)?(h|min|s|ms)?)?$", re.I
)
# Every attribute a film may animate: SVG 1.1 geometry, the presentation attributes (which are
# also CSS properties), the text attributes, and the transform attributes for <animateTransform>.
# A name outside this set ("opacty", "stroke-dash-offset") animates nothing.
_ANIMATABLE = {
    # geometry
    "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "width", "height", "d",
    "points", "dx", "dy", "rotate", "offset", "startoffset", "textlength", "lengthadjust",
    "viewbox", "preserveaspectratio", "fx", "fy", "fr", "refx", "refy", "markerwidth",
    "markerheight", "pathlength", "href", "xlink:href",
    # presentation
    "opacity", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
    "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin",
    "stroke-miterlimit", "visibility", "display", "color", "stop-color", "stop-opacity",
    "flood-color", "flood-opacity", "lighting-color", "font-size", "font-weight", "font-family",
    "font-style", "font-variant", "font-stretch", "letter-spacing", "word-spacing",
    "text-anchor", "text-decoration", "dominant-baseline", "alignment-baseline",
    "baseline-shift", "clip-path", "clip-rule", "mask", "filter", "marker-start", "marker-mid",
    "marker-end", "overflow", "cursor", "pointer-events", "shape-rendering", "text-rendering",
    "image-rendering", "color-interpolation", "color-interpolation-filters", "direction",
    "writing-mode", "unicode-bidi", "glyph-orientation-vertical", "glyph-orientation-horizontal",
    "vector-effect", "paint-order", "transform-origin", "transform-box",
    # transforms (animateTransform)
    "transform", "patterntransform", "gradienttransform",
    # filter primitives, in case a film uses one
    "stddeviation", "in", "in2", "result", "mode", "type", "values", "k1", "k2", "k3", "k4",
    "operator", "radius", "scale", "xchannelselector", "ychannelselector", "surfacescale",
    "specularexponent", "specularconstant", "diffuseconstant", "azimuth", "elevation",
    "limitingconeangle", "pointsatx", "pointsaty", "pointsatz", "z", "basefrequency",
    "numoctaves", "seed", "stitchtiles", "tablevalues", "slope", "intercept", "amplitude",
    "exponent", "kernelmatrix", "divisor", "bias", "targetx", "targety", "edgemode",
    "kernelunitlength", "preservealpha", "order",
}


def _local(name: str) -> str:
    """Strip an XML namespace ``{uri}tag`` → ``tag``."""
    return name.rsplit("}", 1)[-1]


def _entries(value: str) -> list[str]:
    """The non-empty entries of a ';'-separated SMIL list."""
    return [v.strip() for v in value.split(";") if v.strip()]


def _floats(value: str) -> list[float] | None:
    try:
        return [float(v) for v in _entries(value)]
    except ValueError:
        return None


def _function_of(tag: str, names: dict[str, str], el: ET.Element) -> str | None:
    """Why this element has no animation function, or None when it has one that runs."""
    values = _entries(names["values"]) if "values" in names else None
    has = {k for k in ("from", "to", "by") if names.get(k, "").strip()}
    if tag == "set":
        if not names.get("to", "").strip():
            return "no 'to' (a <set> takes only 'to')"
        return None
    if tag == "animatemotion" and (
        names.get("path", "").strip()
        or any(_local(child.tag).lower() == "mpath" for child in el)
    ):
        return None
    if values:
        return None
    if "to" in has or "by" in has:
        return None
    if "from" in has:
        return "'from' alone (no 'to' or 'by' to reach)"
    if values is not None:
        return "an empty 'values'"
    if any(names.get(k) is not None for k in ("to", "by", "path")):
        return "an empty 'to'/'by'/'path'"
    if tag == "animatemotion":
        return "no values/from/to/by, no path, no <mpath> child"
    return "no values/from/to/by"


def _dead_animation(el: ET.Element, tag: str) -> str | None:
    """The reason this SMIL element can never run, or None when it runs.

    Proven in headless Chromium, not guessed: each shape here was rendered with SMIL paused and
    sampled at 0.05 s, 0.5 s and 3 s and left the mark exactly as authored. Three families:

    * no animation function: none of values/from/to/by, `from` alone, or an empty one (an
      <animateMotion> also accepts a path or an <mpath> child; a <set> animates only 'to');
    * timing that never fires: begin="indefinite" or an event begin, dur="0s", dur="indefinite"
      on an <animate>;
    * a function the engine refuses as malformed: no attributeName or one that names nothing, a
      keyTimes list that does not fit the values or does not run 0 to 1, a keySplines list that
      does not fit the segments.

    A single value (``values="1"``) is a legal discrete hold and passes.
    """
    names = {_local(k).lower(): v for k, v in el.attrib.items()}
    target = names.get("attributename")
    head = f"<{tag} attributeName={target!r}>" if target else f"<{tag}>"
    timing = ", ".join(t for t in _TIMING_ATTRS if t in names) or "no timing"
    why = _function_of(tag, names, el)
    if why:
        return (
            f"svg: {head} has {timing} and no animation function ({why}): it never runs, "
            "so the mark stays exactly as authored"
        )
    if tag != "animatemotion":
        if target is None or not target.strip():
            return f"svg: {head} names no attributeName: it never runs"
        if target.strip().lower() not in _ANIMATABLE:
            return f"svg: {head} animates nothing ({target!r} is not an attribute): it never runs"
    begin = names.get("begin")
    if begin is not None:
        entries = _entries(begin)
        if not any(_CLOCK_RE.match(e) or _SYNCBASE_RE.match(e) for e in entries):
            return (
                f"svg: {head} has begin={begin!r}: nothing in a film starts it, so it never fires"
            )
    dur = names.get("dur", "").strip().lower()
    if dur and tag != "set":
        if _DUR_RE.match(dur) and re.fullmatch(r"0+(\.0+)?(h|min|s|ms)?", dur):
            return f"svg: {head} has dur={names['dur']!r}: it never runs"
        if dur == "indefinite":
            return (
                f"svg: {head} has dur=\"indefinite\": held at its first value for ever, "
                "it never runs"
            )
    values = _entries(names["values"]) if "values" in names else None
    calc = names.get("calcmode", "linear").strip().lower()
    segments = (len(values) - 1) if values else 1
    if "keytimes" in names and calc != "paced":
        kt = _floats(names["keytimes"])
        expected = len(values) if values else 2
        if kt is None or len(kt) != expected:
            return (
                f"svg: {head} has keyTimes={names['keytimes']!r} for {expected} value(s): the "
                "lists do not fit, so the engine refuses the animation and it never runs"
            )
        if kt[0] != 0 or (calc != "discrete" and kt[-1] != 1) or any(
            b < a for a, b in zip(kt, kt[1:], strict=False)
        ):
            return (
                f"svg: {head} has keyTimes={names['keytimes']!r}: it must run 0 to 1 in order, so "
                "the engine refuses the animation and it never runs"
            )
    if calc == "spline":
        ks = _entries(names.get("keysplines", ""))
        if len(ks) != segments or any(
            (v := _floats(k.replace(",", " ").replace(" ", ";"))) is None
            or len(v) != 4
            or any(not 0 <= n <= 1 for n in v)
            for k in ks
        ):
            return (
                f"svg: {head} has calcMode=\"spline\" with keySplines={names.get('keysplines')!r} "
                f"for {segments} segment(s): the lists do not fit, so the engine refuses the "
                "animation and it never runs"
            )
    return None


def _lands(anim: ET.Element, tag: str) -> bool:
    """Whether this opacity animation ever shows its mark and leaves it showing: some value above
    0, and either frozen there (fill="freeze"), looping, or a <set> that holds by itself."""
    names = {_local(k).lower(): v for k, v in anim.attrib.items()}
    if _dead_animation(anim, tag):
        return False
    reached: list[float] = []
    if "values" in names:
        reached = _floats(names["values"]) or []
    else:
        for k in ("to", "by"):
            v = _floats(names.get(k, "")) or []
            reached += v
    if not any(v > 0 for v in reached):
        return False
    if tag == "set":
        dur = names.get("dur", "indefinite").strip().lower()
        return dur == "indefinite" or names.get("fill", "").strip().lower() == "freeze"
    if names.get("fill", "").strip().lower() == "freeze":
        return True
    return any(
        names.get(k, "").strip().lower() == "indefinite" for k in ("repeatcount", "repeatdur")
    )


def _never_lands(el: ET.Element, tag: str) -> str | None:
    """A mark authored invisible is a mark waiting for its fade, and nothing else.

    Wave 30's films authored every mark at opacity="0" and never landed one. The motion law now
    says so, and this is its lint: an element with opacity 0 (attribute or style) must carry its
    OWN opacity animation that reaches a value above 0 and stays there (fill="freeze", a loop,
    or a <set>). Measured frozen in Chromium and passing the old lint: ``values="0;0"``, the hold
    ``values="0"``, a child fading inside a parent that never fades, and a fade with no freeze
    that showed for a second and snapped back to 0.
    """
    opacity = el.get("opacity")
    style = el.get("style") or ""
    m = re.search(r"(?:^|;)\s*opacity\s*:\s*([0-9.]+)", style)
    authored = opacity if opacity is not None else (m.group(1) if m else None)
    if authored is None:
        return None
    try:
        if float(authored) > 0:
            return None
    except ValueError:
        return None
    fades = [
        child
        for child in el
        if _local(child.tag).lower() in ("animate", "set")
        and (child.get("attributeName") or "").strip().lower() == "opacity"
    ]
    if any(_lands(child, _local(child.tag).lower()) for child in fades):
        return None
    what = "no opacity animation" if not fades else "an opacity animation that never lands it"
    return (
        f"svg: <{tag} opacity=\"0\"> has {what} (a value above 0, frozen or looping): the mark "
        "never lands and stays invisible for the whole scene"
    )


def _viewbox_ok(vb: str) -> bool:
    parts = re.split(r"[\s,]+", vb.strip())
    if len(parts) != 4:
        return False
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return False
    return nums[2] > 0 and nums[3] > 0  # width and height must be positive


def lint_svg(svg: str) -> list[str]:
    """Deterministic technical checks on one inline SVG string. Empty list = clean."""
    reasons: list[str] = []
    # A markup declaration (DOCTYPE/ENTITY/CDATA) is an XXE / entity-expansion vector — never valid
    # in a generated diagram (comments are fine).
    if re.search(r"<!(?!--)", svg):
        reasons.append("svg: contains a markup declaration (DOCTYPE/ENTITY/CDATA)")
    start, end = svg.find("<svg"), svg.rfind("</svg>")
    if start < 0 or end < 0:
        return ["svg: no <svg>...</svg> element found"]
    try:
        root = ET.fromstring(svg[start : end + len("</svg>")])
    except ET.ParseError as exc:
        return [f"svg: not well-formed XML ({exc})"]

    vb = root.get("viewBox")
    if vb is None:
        reasons.append("svg: missing viewBox")
    elif not _viewbox_ok(vb):
        reasons.append(f"svg: malformed viewBox {vb!r}")

    defined_ids: set[str] = set()
    refs: list[tuple[str, str]] = []  # (referenced id, the attribute it came from)
    # A hidden element that is a track or a definition, not a mark: inside <defs>, or pointed at
    # by an <mpath>/href. The landing law does not apply to it.
    hidden_ok: set[ET.Element] = set()
    for defs in root.iter():
        if _local(defs.tag).lower() == "defs":
            hidden_ok.update(defs.iter())
    pointed = {
        v.lstrip("#")
        for el in root.iter()
        for k, v in el.attrib.items()
        if _local(k).lower() in ("href", "xlink:href") or k.endswith("}href")
    }
    hidden_ok.update(el for el in root.iter() if el.get("id") in pointed)
    for el in root.iter():
        tag = _local(el.tag).lower()
        if tag in _FORBIDDEN_TAGS:
            reasons.append(f"svg: forbidden <{tag}> element")
        is_anim = tag in _ANIM_TAGS
        el_id = el.get("id")
        if el_id:
            defined_ids.add(el_id)
        for raw, value in el.attrib.items():
            name = _local(raw).lower()
            if name in _GEOM_ATTRS and not _LENGTH_RE.match(value.strip()):
                reasons.append(f"svg: <{tag}> {name}={value!r} is not a number")
            for m in _URL_REF_RE.finditer(value):
                refs.append((m.group(1), name))
            if name == "href" and value.strip().startswith("#"):
                refs.append((value.strip()[1:], "href"))
            if is_anim:
                if not (
                    name in _SMIL_ATTRS
                    or name.startswith(("aria-", "data-", "xml"))
                ):
                    reasons.append(f"svg: <{tag}> unknown SMIL attribute {name!r}")
                elif name == "dur" and not _DUR_RE.match(value):
                    reasons.append(f"svg: <{tag}> dur={value!r} is not a valid clock value")
                elif name == "values" and not value.strip():
                    reasons.append(f"svg: <{tag}> has an empty 'values'")
        if is_anim and (dead := _dead_animation(el, tag)):
            reasons.append(dead)
        elif (
            not is_anim
            and tag not in ("svg", "defs", "mpath")
            and el not in hidden_ok
            and (landing := _never_lands(el, tag))
        ):
            reasons.append(landing)

    for ref, where in refs:
        if ref not in defined_ids:
            reasons.append(
                f"svg: dangling reference to #{ref} (via {where}) — no element defines id={ref!r}"
            )
    return reasons


def _find_svg_strings(obj: object):
    """Yield every string anywhere in the artifact that looks like an inline SVG."""
    if isinstance(obj, str):
        if "<svg" in obj:
            yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _find_svg_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _find_svg_strings(v)


# --- evaluated-expression + spec-shape lint ---------------------------------------------


def _expr_parses(text: object) -> bool:
    """True iff an EVALUATED expression is readable by the safe parser. Mirrors the client's
    evaluateExpr acceptance via the CAS (a superset for the ASCII grammar); unicode operators the
    client normalizes are normalized here first so a valid '·'/'×'/'÷' is never a false positive."""
    if not isinstance(text, str):
        return True  # a non-string (e.g. a plain numeric coord) is not an expression to parse
    t = text.strip().replace("·", "*").replace("×", "*").replace("÷", "/")
    if not t:
        return False
    try:
        parse_equation("0=" + t)  # RHS is the expression; a parse failure raises CasError
        return True
    except Exception:
        return False


def _lint_marks(marks: object, *, exprs: bool) -> list[str]:
    """Discovery / whatIf / compare marks: shape enum + numeric-or-expression coordinates."""
    out: list[str] = []
    if not isinstance(marks, list):
        return out
    for mark in marks:
        if not isinstance(mark, dict):
            continue
        mid = mark.get("id")
        shape = mark.get("shape")
        # discovery shapes are a fixed vocabulary; whatIf/perturbation shapes vary, so only enforce
        # the enum for discovery marks (exprs=False).
        if isinstance(shape, str) and shape not in _SHAPES and not exprs:
            out.append(f"mark {mid!r}: shape {shape!r} outside the client vocabulary")
        for axis in ("x", "y"):
            if axis not in mark:
                continue
            val = mark[axis]
            # whatIf coords may be an arithmetic string over value ids; discovery coords are numeric
            if exprs and not (_fnum(val) or _expr_parses(val)):
                out.append(f"mark {mid!r}: {axis}={val!r} is not numeric or a valid expression")
            elif not exprs and not _fnum(val):
                out.append(f"mark {mid!r}: {axis}={val!r} is not numeric")
    return out


def _lint_perturbation(pert: object) -> list[str]:
    if not isinstance(pert, dict):
        return []
    scene = pert.get("scene")
    out = _lint_marks(scene.get("marks") if isinstance(scene, dict) else None, exprs=True)
    output = pert.get("output")
    expr = output.get("expr") if isinstance(output, dict) else None
    if isinstance(expr, str) and not _expr_parses(expr):
        out.append(f"perturbation output.expr {expr!r} is not parseable by the safe evaluator")
    return out


def _lint_whatif(wi: object) -> list[str]:
    if not isinstance(wi, dict):
        return []
    out: list[str] = []
    for s in wi.get("solve") or []:
        if isinstance(s, dict) and isinstance(s.get("expr"), str) and not _expr_parses(s["expr"]):
            out.append(f"whatIf solve.expr {s['expr']!r} is not parseable by the safe evaluator")
    scene = wi.get("scene")
    if isinstance(scene, dict):
        out += _lint_marks(scene.get("marks"), exprs=True)
    return out


def _lint_mathscene(ms: object) -> list[str]:
    """Every expression a mathScene will evaluate live must parse: readout/curve exprs, plus any
    coordinate that is an arithmetic string (poly points, labelAt, segment ends, point/label at)."""
    if not isinstance(ms, dict):
        return []
    out: list[str] = []
    for section, key in (("readouts", "expr"), ("curves", "expr")):
        for entry in ms.get(section) or []:
            expr = entry.get(key) if isinstance(entry, dict) else None
            if isinstance(expr, str) and not _expr_parses(expr):
                out.append(
                    f"mathScene {section}.{key} {expr!r} is not parseable by the safe evaluator"
                )

    def _coords(pair: object, where: str) -> None:
        if isinstance(pair, list):
            for val in pair:
                if isinstance(val, str) and not _expr_parses(val):
                    out.append(
                        f"mathScene {where} coordinate {val!r} is not parseable by the safe"
                        " evaluator"
                    )

    for poly in ms.get("polys") or []:
        if not isinstance(poly, dict):
            continue
        for pt in poly.get("points") or []:
            _coords(pt, "polys.points")
        _coords(poly.get("labelAt"), "polys.labelAt")
    for seg in ms.get("segments") or []:
        if isinstance(seg, dict):
            _coords(seg.get("from"), "segments.from")
            _coords(seg.get("to"), "segments.to")
    for section in ("points", "labels"):
        for entry in ms.get(section) or []:
            if isinstance(entry, dict):
                _coords(entry.get("at"), f"{section}.at")
    return out


def _lint_compose(artifact: dict) -> list[str]:
    out: list[str] = []
    for card in artifact.get("cards") or []:
        if not isinstance(card, dict):
            continue  # a non-dict stub carries nothing to lint
        cid = card.get("id")
        inter = card.get("interaction")
        if isinstance(inter, dict) and (k := inter.get("kind", "tap")) not in _INTERACTION_KINDS:
            out.append(f"card {cid!r}: interaction.kind {k!r} outside vocabulary")
        discovery = card.get("discovery")
        if isinstance(discovery, dict):
            for stage in discovery.get("stages") or []:
                if not isinstance(stage, dict):
                    continue
                if isinstance(stage.get("visual"), dict):
                    out += _lint_marks(stage["visual"].get("marks"), exprs=False)
                si = stage.get("interaction")
                if isinstance(si, dict) and (k := si.get("kind", "tap")) not in _DISCOVERY_KINDS:
                    out.append(f"discovery interaction.kind {k!r} outside vocabulary")
        out += _lint_perturbation(card.get("perturbation"))
        out += _lint_whatif(card.get("whatIf"))
        out += _lint_mathscene(card.get("mathScene"))
    for bank in ("workbook", "boss"):
        for item in artifact.get(bank) or []:
            if isinstance(item, dict) and (t := item.get("type", "mcq")) not in _ITEM_TYPES:
                out.append(f"{bank} item {item.get('id')!r}: type {t!r} outside vocabulary")
    # …and the answers themselves. Everything above proves an artifact is not BROKEN; this proves
    # it is not WRONG, which is the defect a child cannot catch alone (they mark their own correct
    # working wrong against a confident key). Only what the CAS can PROVE false comes back here.
    out += check_compose(artifact)
    return out


def _lint_video(artifact: dict) -> list[str]:
    out: list[str] = []
    for scene in artifact.get("scenes") or []:
        if not isinstance(scene, dict):
            continue
        visual = scene.get("visual")
        if isinstance(visual, dict) and (k := visual.get("kind", "svg")) not in _VISUAL_KINDS:
            out.append(f"scene {scene.get('id')!r}: visual.kind {k!r} outside vocabulary")
    return out


def lint_artifact(modality: str, artifact: object) -> LintResult:
    """Deterministic technical lint over a whole artifact. ok=False routes an Opus rebuild without
    a judge call; reasons are persisted on the rejected version's provenance."""
    reasons: list[str] = []
    for svg in _find_svg_strings(artifact):
        reasons += lint_svg(svg)
    if isinstance(artifact, dict):
        if modality == "compose":
            reasons += _lint_compose(artifact)
        elif modality == "video":
            reasons += _lint_video(artifact)
        elif modality == "simulate":
            reasons += _lint_perturbation(None)  # no-op; sim formula is CAS-verified upstream
    return LintResult(ok=not reasons, reasons=reasons)


if __name__ == "__main__":  # runnable self-check — no framework, no network
    from wobo_gateway.plexus import engines

    _hdr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'

    # 1. every seed (the honest floor) must be lint-CLEAN — a floor failing its own lint is a bug.
    for _mod in engines.MODALITIES:
        _res = lint_artifact(_mod, engines._seed(_mod, "linear equations in one variable", "core"))
        assert _res.ok, (_mod, _res.reasons)

    # 2. each subtle-error class must be caught.
    _bad_attr = _hdr + '<circle cx="undefined" cy="5" r="2"/></svg>'
    assert not lint_artifact("diagram", _bad_attr).ok, "undefined attr slipped through"

    _anim = '<rect x="1" y="1" width="2" height="2"><animate attributeName="x" values="1;5" dur="abc"/></rect>'  # noqa: E501
    _bad_dur = {"scenes": [{"id": "s1", "visual": {"kind": "svg", "payload": _hdr + _anim + "</svg>"}}]}  # noqa: E501
    assert not lint_artifact("video", _bad_dur).ok, "bad SMIL dur slipped through"

    # wave 30: timing with no function is the shape every blank film carried
    _timed_only = '<g opacity="0"><animate attributeName="opacity" keyTimes="0;1" dur="1s" keySplines="0.2 0 0 1"/></g>'  # noqa: E501
    _dead_film = {"scenes": [{"id": "s1", "visual": {"kind": "svg", "payload": _hdr + _timed_only + "</svg>"}}]}  # noqa: E501
    assert not lint_artifact("video", _dead_film).ok, "a functionless animation slipped through"

    _dangling = _hdr + '<rect x="1" y="1" width="2" height="2" fill="url(#nope)"/></svg>'
    assert not lint_artifact("diagram", _dangling).ok, "dangling url(#ref) slipped through"

    _wrong_enum = {"cards": [{"id": "c1", "interaction": {"kind": "wiggle", "prompt": "x"}}]}
    assert not lint_artifact("compose", _wrong_enum).ok, "wrong enum slipped through"

    _dead = {"cards": [{"id": "c1", "whatIf": {"solve": [{"id": "s1", "expr": "12 +/ x"}]}}]}
    assert not lint_artifact("compose", _dead).ok, "dead expression slipped through"

    _wrong_key = {
        "workbook": [
            {
                "id": "w1",
                "type": "mcq",
                "prompt": "Solve 2x + 4 = 16.",
                "options": ["x = 4", "x = 6", "x = 8"],
                "answer": "x = 8",
            }
        ]
    }
    assert not lint_artifact("compose", _wrong_key).ok, "a wrong answer key slipped through"

    # 3. a clean, valid expression is NEVER a false positive.
    _ok = {"cards": [{"id": "c1", "whatIf": {"solve": [{"id": "s1", "expr": "sqrt(25 - 9)"}]}}]}
    assert lint_artifact("compose", _ok).ok
    assert lint_artifact("compose", {"cards": ["base"]}).ok  # the judge-test stub stays clean

    print("lint self-check ok")
