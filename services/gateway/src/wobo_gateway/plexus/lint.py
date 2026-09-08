"""Deterministic technical lint — the gate that never blinks.

Runs BEFORE the LLM judge in :mod:`validate`. The judge scores *pedagogical* quality; this
layer catches the SUBTLE *technical* defects a strong-but-imperfect content model emits that
render BROKEN in the browser yet slip past both the structural verifier and the judge:

  • an SVG geometry attribute that is not a number (``cx="undefined"`` — a real production bug),
    a malformed ``viewBox``, a ``<script>``/``<foreignObject>``, a SMIL animation with a garbage
    ``dur`` or a misspelled attribute, a ``url(#ref)`` / ``href="#ref"`` with no matching
    definition (a dangling gradient / filter / use).
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


def _local(name: str) -> str:
    """Strip an XML namespace ``{uri}tag`` → ``tag``."""
    return name.rsplit("}", 1)[-1]


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
