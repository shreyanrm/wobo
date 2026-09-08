"""The sanitiser must not delete an animation's function.

Wave-30 finding (SCORECARD §3.3, fix #1): ``sanitize.py`` held an animation's
``to``/``from``/``values``/``by`` to the HREF allow-list no matter what the animation targeted,
so ``values="0;1"`` on an *opacity* animation would be deleted for not being a valid URL. That
over-reach is real and the rule is narrowed.

What it is NOT is the reason the films are blank. Corrected measurement over the judged corpus
(the earlier "615 elements / every film blank" causation was measured on values re-injected into
the corpus, not on the corpus): the shipped scenes hold ``<animate>`` elements with ``keyTimes``,
``dur`` and ``keySplines`` and **no** animation function — and so do the RAW model responses,
which never passed through this module. The models emit animations with no function; that is a
generation defect (``lint.py``, open), not this rule's doing. Sanitised output is byte-identical
before and after the narrowing on every scene in the corpus.

Three tests: the rule itself, the same rule measured over the real generated scenes, and the
raw responses that prove where the missing functions actually went (in
``test_wave30_adversary.py``).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from wobo_gateway.plexus.sanitize import sanitize_svg

_ANIMATE_EL = re.compile(r"<(?:ns\d+:)?animate\b[^>]*/?>")
_VALUE_ATTR = re.compile(r"\b(?:values|from|to|by)=")
_ATTRIBUTE_NAME = re.compile(r'attributeName="([^"]*)"')


# --- the rule ----------------------------------------------------------------------------


def test_opacity_animation_keeps_its_values() -> None:
    """An animation that does NOT target a URL attribute keeps its animation function.

    Without ``values`` an element authored at ``opacity="0"`` never fades in — so the rule may
    not take them from an animation that targets neither a URL attribute nor ``style``.
    """
    svg = (
        '<svg viewBox="0 0 10 10">'
        '<text opacity="0">hello'
        '<animate attributeName="opacity" values="0;1" keyTimes="0;1" dur="1s"'
        ' fill="freeze"/></text>'
        '<circle r="2" stroke-dasharray="20" stroke-dashoffset="20">'
        '<animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.8s"/></circle>'
        '<rect><animateTransform attributeName="transform" type="rotate"'
        ' values="0;90" dur="1s"/></rect>'
        "</svg>"
    )
    clean = sanitize_svg(svg)
    assert clean is not None
    assert 'values="0;1"' in clean  # the opacity fade survives
    assert 'from="20"' in clean and 'to="0"' in clean  # the stroke draw-on survives
    assert 'values="0;90"' in clean  # the transform survives
    # the timing attributes were never in question, but a film needs both halves
    assert 'keyTimes="0;1"' in clean and 'dur="1s"' in clean


def test_href_animation_still_cannot_smuggle_a_javascript_url() -> None:
    """The security half of the same rule: an animation aimed at a URL attribute — in any
    spelling — is still removed whole, and no ``javascript:`` payload survives anywhere."""
    dirty = (
        '<svg viewBox="0 0 10 10">'
        '<a href="#ok"><animate attributeName="href" to="javascript:alert(1)" dur="1s"/></a>'
        '<image href="#ok"><animate attributeName="xlink:href"'
        ' values="#ok;javascript:alert(2)" dur="1s"/></image>'
        '<image href="#ok"><animate attributeName="src" from="#ok"'
        ' to="https://evil.example/x.png" dur="1s"/></image>'
        # retargeting `style` can carry a url() the attribute pass strips — it goes with them
        '<rect><animate attributeName="style" values="fill:url(#a);fill:url(#b)" dur="1s"/></rect>'
        # ...and a javascript: payload is refused even on an allowed (non-URL) target
        '<text opacity="0"><animate attributeName="opacity"'
        ' values="javascript:alert(3);1" dur="1s"/></text>'
        "</svg>"
    )
    clean = sanitize_svg(dirty)
    assert clean is not None
    lowered = clean.lower()
    assert "javascript:" not in lowered
    assert "evil.example" not in clean
    assert "url(" not in lowered
    # every URL/style-targeting animation element is gone whole — nothing left to animate in
    targets = [
        m.group(1).lower()
        for el in _ANIMATE_EL.findall(clean)
        for m in [_ATTRIBUTE_NAME.search(el)]
        if m
    ]
    assert not [t for t in targets if "href" in t or "src" in t or "style" in t]
    # the innocent neighbour is still there (this is a filter, not a ban) minus its payload
    assert targets == ["opacity"]
    assert "values=" not in clean


# --- the same rule, measured on the real generated scenes ---------------------------------


def _corpus_root() -> Path | None:
    """The judged artifacts (``.lab/artifacts``) when this checkout has them, else ``None``.
    The lab is not part of the shipped repo, so the corpus measurement skips outside it."""
    for parent in Path(__file__).resolve().parents:
        candidate = parent / ".lab" / "artifacts"
        if candidate.is_dir():
            return candidate
    return None


def _scene_files(root: Path) -> list[Path]:
    """Every generated video scene SVG the judges scored, across all four subjects."""
    return sorted(p for p in root.rglob("*.svg") if re.search(r"scene|video", str(p), re.I))


def test_real_generated_scenes_keep_their_animation_functions() -> None:
    """Run the REAL generated scenes through ``sanitize_svg`` and count the ``<animate>``
    elements that still carry an animation function.

    Two measurements on the shipped corpus:

    1. **What shipped.** Not one of the ``<animate>`` elements in the served scenes carries
       ``values``/``from``/``to``/``by``, and not one of them targets a URL attribute. The raw
       model responses are the same (``test_wave30_adversary.py``), so the functions were never
       generated — this fix restores nothing that shipped, and the corpus is unchanged by it.
    2. **Before / after, on values this test injects.** Each real element is given an animation
       function (a numeric ``values`` pair, which is what an opacity or stroke-dashoffset
       animation needs) and the real scene is re-sanitised. Under the old blanket rule the
       survivor count is 0; under the narrowed rule, all of them. This is the rule under test,
       measured on synthetic values — NOT a count of animations restored in the product.
    """
    root = _corpus_root()
    if root is None:
        pytest.skip("judged artifact corpus (.lab/artifacts) not present in this checkout")
    files = _scene_files(root)
    if not files:
        pytest.skip("no generated scene SVGs in the corpus")

    # the corpus is real and big enough to mean something
    assert len(files) >= 40, f"corpus too small to measure: {len(files)} scene files"

    shipped_animations = 0
    shipped_with_function = 0
    url_targeted = 0
    restored_total = 0
    survived = 0

    for path in files:
        source = path.read_text(encoding="utf-8")
        elements = _ANIMATE_EL.findall(source)
        shipped_animations += len(elements)
        shipped_with_function += sum(1 for el in elements if _VALUE_ATTR.search(el))
        url_targeted += sum(
            1
            for el in elements
            for m in [_ATTRIBUTE_NAME.search(el)]
            if m and ("href" in m.group(1).lower() or "src" in m.group(1).lower())
        )
        # put the deleted animation function back on every real element, then re-sanitise
        restored = _ANIMATE_EL.sub(
            lambda m: m.group(0).replace("<animate", '<animate values="0;1"', 1), source
        )
        restored_total += len(elements)
        clean = sanitize_svg(restored)
        assert clean is not None, f"{path} no longer sanitises at all"
        survived += sum(1 for el in _ANIMATE_EL.findall(clean) if _VALUE_ATTR.search(el))

    assert shipped_animations >= 300, f"only {shipped_animations} animations found in the corpus"
    # 1. what shipped: no animation carries a function, and none of them ever pointed at a URL
    #    (so the sanitiser had nothing to take here — see the raw-response measurement)
    assert shipped_with_function == 0
    assert url_targeted == 0
    # 2. after the fix every one of those animations keeps the function it was written with
    assert survived == restored_total, (
        f"{restored_total - survived} of {restored_total} injected animation functions are "
        "still lost through sanitize"
    )
