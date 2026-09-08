"""SVG sanitizer — every diagram passes through here before it is served.

Rules: the root must be ``<svg>`` with a ``viewBox`` (and always carries the SVG namespace on
the way out); no script / foreignObject / iframe / object / embed / style / set elements, and no
``animate*`` element that targets a URL (or ``style``) attribute; no ``on*`` event attributes;
href, xlink:href and src only to fragments (``#...``) or inline ``data:image/`` payloads, and an
animation's to/from/values/by held to the same rule ONLY when that animation actually targets one
of those attributes. Anything unusable returns ``None`` and the caller serves a seed instead —
never an error to the learner. Read as a DETECTOR (``svg_violations``) the same rules apply to
the WHOLE string, including anything outside the ``<svg>`` element.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections import Counter

_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"

# ``set`` is the one that looks harmless: <set attributeName="href" to="javascript:..."/> rewrites
# an attribute we already checked, AFTER we checked it. It belongs with script and foreignObject.
_FORBIDDEN_TAGS = {"script", "foreignobject", "iframe", "object", "embed", "style", "set"}

# SMIL animation elements can retarget an attribute the same way ``set`` does, over time.
_ANIMATION_TAGS = {"animate", "animatetransform", "animatemotion", "animatecolor"}

# The attributes that carry a URL, whichever spelling the document uses. ``href`` alone let
# ``src`` and the xlink-prefixed spelling through untouched.
_URL_ATTRS = {"href", "src"}

# Where an animation puts the values it will write into its target attribute.
_ANIMATION_VALUE_ATTRS = {"to", "from", "values", "by"}


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


_RASTER_DATA = ("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,")


def _href_allowed(value: str) -> bool:
    # Fragments and raster data images only. data:image/svg+xml is explicitly out —
    # a nested SVG payload is a sanitizer bypass, not an image.
    v = value.strip().lower()
    return v.startswith("#") or v.startswith(_RASTER_DATA)


def _animation_target(el: ET.Element) -> str:
    """The attribute this animation writes into, however the document spells ``attributeName``.

    ElementTree is an XML parser, so ``el.get("attributeName")`` matches that exact casing and
    nothing else. The artifact does not end its life in an XML parser: the render worker hands it
    to headless Chrome as HTML (``Explainer.tsx``'s ``dangerouslySetInnerHTML``), and the HTML
    Standard's "adjust SVG attributes" table (§13.2.6.5) folds ``attributename`` — any casing —
    back to ``attributeName``. A case-sensitive lookup here therefore left
    ``<animate attributename="href" to="https://…"/>`` neither removed nor stripped, and live in
    the browser. The attribute NAMES are scanned case-insensitively for that reason.
    """
    for name, value in el.attrib.items():
        if _local(name).lower() == "attributename":
            return _local(value).lower()
    return ""


def _animates_a_url(el: ET.Element) -> bool:
    """Does this animation element write into an attribute that carries a URL?

    ``<animate attributeName="xlink:href" to="javascript:…"/>`` sets the very attribute the
    attribute pass already cleared, one frame later. The element goes, not the attribute.
    """
    target = _animation_target(el)
    return any(name in target for name in _URL_ATTRS)


def _animates_an_unsafe_attribute(el: ET.Element) -> bool:
    """The URL attributes, plus ``style``.

    An animation aimed at ``style`` can write ``fill:url(…)`` — the very thing the attribute pass
    strips from a static ``style`` — one frame after that pass has run. It goes the same way an
    href animation goes: the element is removed, not the attribute.
    """
    return _animates_a_url(el) or "style" in _animation_target(el)


def _scrub(el: ET.Element) -> None:
    for child in list(el):
        tag = _local(child.tag).lower()
        if tag in _FORBIDDEN_TAGS or (
            tag in _ANIMATION_TAGS and _animates_an_unsafe_attribute(child)
        ):
            el.remove(child)
        else:
            _scrub(child)
    is_animation = _local(el.tag).lower() in _ANIMATION_TAGS
    for attr in list(el.attrib):
        name = _local(attr).lower()
        value = el.attrib[attr]
        if (
            name.startswith("on")
            or "javascript:" in value.lower()
            # href, src and the xlink: spelling of either — _local() strips the prefix, so one
            # membership test covers href, xlink:href and src alike.
            or (name in _URL_ATTRS and not _href_allowed(value))
            # An animation's to/from/values/by are future values of the attribute it TARGETS, so
            # the href rule applies only when that target is a URL attribute. Held to it blindly,
            # `values="0;1"` on an opacity animation was deleted for not being a valid URL — a
            # real over-reach, and the reason the rule is narrowed here. What it did NOT do is
            # empty the shipped corpus: the raw model responses, which never pass through this
            # module, carry <animate> elements with keyTimes/dur and no animation function at all,
            # and the sanitized corpus is byte-identical before and after this narrowing. The
            # blank films are a GENERATION defect (lint.py, open), not this rule's doing.
            # (Belt and braces: such an animation is already removed whole above — this is the
            # second line of defence if that path ever changes.)
            or (
                is_animation
                and name in _ANIMATION_VALUE_ATTRS
                and _animates_an_unsafe_attribute(el)
                and not all(_href_allowed(v) for v in value.split(";") if v.strip())
            )
            or (name == "style" and "url(" in value.lower())
        ):
            del el.attrib[attr]


def sanitize_svg(text: str) -> str | None:
    """Return a clean inline SVG string, or ``None`` if the input is unusable."""
    if not text:
        return None
    # No markup declarations of any kind (DOCTYPE, ENTITY, CDATA — anything but comments):
    # kills XXE and entity-expansion (billion laughs) BEFORE the parser ever runs, without
    # relying on string spellings a crafted payload could dodge.
    if re.search(r"<!(?!--)", text):
        return None
    start, end = text.find("<svg"), text.rfind("</svg>")
    if start < 0 or end < 0:
        return None
    fragment = text[start : end + len("</svg>")]
    ET.register_namespace("", _SVG_NS)
    ET.register_namespace("xlink", _XLINK_NS)
    try:
        root = ET.fromstring(fragment)
    except ET.ParseError:
        return None
    if _local(root.tag) != "svg" or not root.get("viewBox"):
        return None
    if _local(root.tag).lower() in _FORBIDDEN_TAGS:
        return None
    _scrub(root)
    # Force the SVG namespace back onto the root. A fragment parsed WITHOUT an xmlns serializes
    # without one, and a namespace-less <svg> is inert in a browser — which made every sanitized
    # diagram render blank and look permanently stale to the cache.
    if not root.tag.startswith("{"):
        root.set("xmlns", _SVG_NS)
    return ET.tostring(root, encoding="unicode")


def _inventory(el: ET.Element, out: Counter[str]) -> None:
    tag = _local(el.tag).lower()
    out[f"<{tag}>"] += 1
    for attr in el.attrib:
        out[f"{_local(attr).lower()}= on <{tag}>"] += 1
    for child in el:
        _inventory(child, out)


def svg_violations(text: str) -> list[str]:
    """What :func:`sanitize_svg` would REMOVE from ``text`` — the sanitizer read as a DETECTOR.

    ``sanitize_svg`` cleans and hands back a string, which is the right answer at generation
    time. On the SERVE path the question is different: a record already in the cache that needs
    cleaning is a record somebody tampered with, and the answer is to refuse it, not to quietly
    launder it (:func:`wobo_gateway.plexus.engines._cache_read_refusals`).

    Implemented by running the very same ``_scrub`` over a copy and diffing the element/attribute
    inventory, so the rules can never drift from the sanitizer's — every future change to
    ``_scrub`` is a change to this detector too. Empty list = nothing would be stripped.
    """
    if not text:
        return ["empty payload"]
    if re.search(r"<!(?!--)", text):
        return ["markup declaration (DOCTYPE / ENTITY / CDATA)"]
    start, end = text.find("<svg"), text.rfind("</svg>")
    if start < 0 or end < 0:
        return ["not an inline <svg> document"]
    # Everything OUTSIDE the <svg> element is live markup too. ``sanitize_svg`` may drop it
    # because it returns only the slice it cleaned; a DETECTOR may not, because the string it is
    # judging is handed WHOLE to an HTML parser downstream (``Explainer.tsx`` does one
    # ``.replace(/<svg\b/, …)`` and passes the lot to ``dangerouslySetInnerHTML``). Asking "is
    # the <svg> inside this string safe" let a prefixed <script> and a suffixed <img onerror=>
    # through with an empty violation list.
    outside = (text[:start] + text[end + len("</svg>") :]).strip()
    if outside:
        return [f"markup outside the <svg> element: {outside[:80]!r}"]
    try:
        root = ET.fromstring(text[start : end + len("</svg>")])
    except ET.ParseError as exc:
        return [f"not well-formed XML: {exc}"]
    if _local(root.tag) != "svg":
        return ["root element is not <svg>"]
    if not root.get("viewBox"):
        return ["root <svg> has no viewBox"]
    before: Counter[str] = Counter()
    _inventory(root, before)
    _scrub(root)
    after: Counter[str] = Counter()
    _inventory(root, after)
    removed = before - after
    return [f"would be stripped: {what} x{n}" for what, n in sorted(removed.items())]
