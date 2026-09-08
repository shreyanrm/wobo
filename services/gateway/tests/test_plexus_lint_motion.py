"""A SMIL animation with no animation function is a dead animation, and the lint says so.

Wave-30 finding (SCORECARD §3.3, fix #16): every film in the product was blank. 615 ``<animate>``
elements across four subjects carried ``keyTimes``, ``dur`` and ``keySplines`` and no ``values``,
``from``, ``to`` or ``by``. SMIL builds no animation function from such an element, so it never
runs, and every mark authored at ``opacity="0"`` waiting for it stays invisible for the whole
narration. The raw model responses carry the same shape (``test_wave30_adversary.py``), so the
defect is generation: the video prompt never demanded a function and ``lint.py`` never checked
for one, so a storyboard with timing and no motion passed the gate clean, was judged, and served.

The lab's blank scenes were pruned with the scratchpad, so the corpus here is rebuilt from the
shape the skeptics quoted verbatim from the served scenes: ``<animate attributeName=... keyTimes=...
dur=... keySplines=...>`` with no function. Every such scene must fail lint; the same scene with a
function must pass; and a failure must route a rebuild exactly the way every other lint failure
does, with no judge call burned on it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from wobo_gateway.plexus import engines, store
from wobo_gateway.plexus.lint import lint_artifact, lint_svg
from wobo_gateway.plexus.validate import validate_and_promote

_HDR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">'


def _scene(body: str) -> str:
    return _HDR + body + "</svg>"


# --- the corpus: what the models actually emitted, one element class per entry ------------------

# Each entry is (name, the dead element as shipped, the same element with its function restored).
DEAD_AND_ALIVE: list[tuple[str, str, str]] = [
    (
        "opacity fade on a group (cbse-6 fractions s4, quoted in maths-skeptic.md)",
        '<g opacity="0"><animate attributeName="opacity" keyTimes="0;0.07;0.87;1" dur="6.8s"'
        ' calcMode="spline" keySplines="0.2 0 0 1;0.2 0 0 1;0.2 0 0 1" fill="freeze"/>'
        '<text x="60" y="100" font-size="24">two thirds</text></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.07;0.87;1"'
        ' dur="6.8s" calcMode="spline" keySplines="0.2 0 0 1;0.2 0 0 1;0.2 0 0 1" fill="freeze"/>'
        '<text x="60" y="100" font-size="24">two thirds</text></g>',
    ),
    (
        "stroke-dashoffset draw-on (the 940 that froze where it started)",
        '<path d="M60 300 L580 120" stroke="#14142B" stroke-width="5" fill="none"'
        ' stroke-dasharray="940" stroke-dashoffset="940">'
        '<animate attributeName="stroke-dashoffset" dur="1.4s" calcMode="spline"'
        ' keySplines="0.2 0 0 1" fill="freeze"/></path>',
        '<path d="M60 300 L580 120" stroke="#14142B" stroke-width="5" fill="none"'
        ' stroke-dasharray="940" stroke-dashoffset="940">'
        '<animate attributeName="stroke-dashoffset" from="940" to="0" dur="1.4s" calcMode="spline"'
        ' keySplines="0.2 0 0 1" fill="freeze"/></path>',
    ),
    (
        "a bar that was meant to rise (height with keyTimes and no values)",
        '<rect x="200" y="300" width="80" height="0" fill="#2B45FF">'
        '<animate attributeName="height" keyTimes="0;1" dur="2s" begin="0.4s" fill="freeze"/>'
        "</rect>",
        '<rect x="200" y="300" width="80" height="0" fill="#2B45FF">'
        '<animate attributeName="height" values="0;160" keyTimes="0;1" dur="2s" begin="0.4s"'
        ' fill="freeze"/></rect>',
    ),
    (
        "animateTransform with a type and timing but nothing to move between",
        '<g><animateTransform attributeName="transform" type="translate" dur="1.2s"'
        ' keyTimes="0;1" calcMode="spline" keySplines="0.2 0 0 1" fill="freeze"/>'
        '<circle cx="320" cy="180" r="30" fill="#FFB629"/></g>',
        '<g><animateTransform attributeName="transform" type="translate" from="0 0" to="120 0"'
        ' dur="1.2s" keyTimes="0;1" calcMode="spline" keySplines="0.2 0 0 1" fill="freeze"/>'
        '<circle cx="320" cy="180" r="30" fill="#FFB629"/></g>',
    ),
    (
        "a timed <set> with no 'to' (the stepped readout that never stepped)",
        '<text x="560" y="130" font-size="38" opacity="0">12'
        '<set attributeName="opacity" begin="2s" dur="1s" fill="freeze"/></text>',
        '<text x="560" y="130" font-size="38" opacity="0">12'
        '<set attributeName="opacity" to="1" begin="2s" dur="1s" fill="freeze"/></text>',
    ),
    (
        "animateMotion with a duration and no path",
        '<circle r="8" fill="#2B45FF"><animateMotion dur="2s" fill="freeze"/></circle>',
        '<circle r="8" fill="#2B45FF"><animateMotion path="M60,300 L580,300" dur="2s"'
        ' fill="freeze"/></circle>',
    ),
]


_IDS = [d[0] for d in DEAD_AND_ALIVE]


@pytest.mark.parametrize(("name", "dead", "_alive"), DEAD_AND_ALIVE, ids=_IDS)
def test_an_animation_with_timing_and_no_function_fails_lint(name, dead, _alive) -> None:
    reasons = lint_svg(_scene(dead))
    assert reasons, f"{name}: a dead animation passed lint clean"
    joined = " ".join(reasons)
    assert "no animation function" in joined, reasons
    # the reason names the timing that was there and the function that was not, so the ledger
    # says it plainly (a <set> takes only 'to'; everything else takes values/from/to/by)
    assert "values/from/to/by" in joined or "takes only 'to'" in joined, reasons
    assert "dur" in joined or "begin" in joined, reasons


@pytest.mark.parametrize(("name", "_dead", "alive"), DEAD_AND_ALIVE, ids=_IDS)
def test_the_same_animation_with_a_function_passes_lint(name, _dead, alive) -> None:
    assert lint_svg(_scene(alive)) == [], f"{name}: a working animation was refused"


def test_an_mpath_child_is_an_animation_function_for_animatemotion() -> None:
    svg = _scene(
        '<path id="track" d="M60,300 L580,300" fill="none" stroke="none"/>'
        '<circle r="8" fill="#2B45FF"><animateMotion dur="2s" fill="freeze">'
        '<mpath href="#track"/></animateMotion></circle>'
    )
    assert lint_svg(svg) == []


def test_a_single_value_is_still_a_function() -> None:
    # values="1" is legal SMIL (a discrete hold); the lint refuses only what has nothing at all
    svg = _scene('<g><animate attributeName="opacity" values="1" dur="1s"/></g>')
    assert lint_svg(svg) == []


def test_a_whole_storyboard_of_dead_scenes_fails_as_a_video_artifact() -> None:
    """The shape of a served film: every scene timed, nothing moving. lint_artifact must refuse it
    with one reason per dead element so the ledger shows the count, not just a verdict."""
    artifact = {
        "complexity": "simple",
        "scenes": [
            {
                "id": f"s{i + 1}",
                "durationMs": 6000,
                "narration": "A line of narration over nothing.",
                "visual": {"kind": "svg", "payload": _scene(dead)},
            }
            for i, (_n, dead, _a) in enumerate(DEAD_AND_ALIVE)
        ],
    }
    verdict = lint_artifact("video", artifact)
    assert not verdict.ok
    assert len([r for r in verdict.reasons if "no animation function" in r]) == len(DEAD_AND_ALIVE)


def test_the_seed_film_still_lints_clean() -> None:
    """The honest floor animates for real (values everywhere); the new check must not touch it."""
    seed = engines._seed("video", "photosynthesis", "core")
    verdict = lint_artifact("video", seed)
    assert verdict.ok, verdict.reasons


# --- the gate: a dead film routes a rebuild like every other lint failure -----------------------

_OPUS = "anthropic/claude-opus-5"
_GPT = "openai/gpt-5.6-terra"


@pytest.fixture
def cache_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    return tmp_path


def test_a_dead_film_is_rejected_and_rebuilt_without_a_judge_call(monkeypatch, cache_dir) -> None:
    dead_film = {
        "scenes": [
            {
                "id": "s1",
                "durationMs": 6000,
                "narration": "n",
                "visual": {"kind": "svg", "payload": _scene(DEAD_AND_ALIVE[0][1])},
            }
        ]
    }
    alive_film = {
        "scenes": [
            {
                "id": "s1",
                "durationMs": 6000,
                "narration": "n",
                "visual": {"kind": "svg", "payload": _scene(DEAD_AND_ALIVE[0][2])},
            }
        ]
    }
    judge_calls: list = []
    rebuild_calls: list = []

    def judge(*a, **_k):
        judge_calls.append(a)
        return {"score": 99.0, "critical": False, "weak": [], "notes": "must never run"}

    def regen(modality_, concept, difficulty, provider_model, fallbacks, payload):
        rebuild_calls.append(provider_model)
        return alive_film, provider_model, 5, False

    monkeypatch.setattr("wobo_gateway.plexus.validate._judge", judge)
    monkeypatch.setattr("wobo_gateway.plexus.engines._generate_live", regen)
    out = validate_and_promote(
        concept="fractions",
        modality="video",
        difficulty="core",
        scope={},
        record={
            "concept": "fractions",
            "modality": "video",
            "difficulty": "core",
            "verified": True,
            "seeded": False,
            "status": store.PROVISIONAL,
            "provenance": {"engine": "engine.video", "model": _OPUS,
                           "prompt_version": "plexus-v4"},
            "artifact": dead_film,
        },
        judge_model=_OPUS,
        escalation_model=_GPT,
    )
    assert judge_calls == []  # no judge call burned on a film that cannot move
    assert rebuild_calls == [_GPT]
    assert out["status"] == store.CANONICAL
    assert out["artifact"] == alive_film
    rejected = [v for v in store.load_versions("fractions", "video", "core", {})
                if v["status"] == store.REJECTED]
    assert len(rejected) == 1
    assert any("no animation function" in r for r in rejected[0]["provenance"]["lint"])


# --- the same measurement over the real corpus, when a checkout still has one ---------------------

_ANIMATE_EL = re.compile(r"<(?:ns\d+:)?animate\b[^>]*/?>", re.I)


def _corpus_root() -> Path | None:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / ".lab" / "artifacts"
        if candidate.is_dir():
            return candidate
    return None


def test_every_served_scene_in_the_corpus_fails_the_new_lint() -> None:
    root = _corpus_root()
    if root is None:
        pytest.skip("judged artifact corpus (.lab/artifacts) not present in this checkout")
    scenes: list[str] = []

    def walk(obj: object) -> None:
        if isinstance(obj, str):
            if "<svg" in obj and "<animate" in obj:
                scenes.append(obj)
        elif isinstance(obj, dict):
            for value in obj.values():
                walk(value)
        elif isinstance(obj, list):
            for value in obj:
                walk(value)

    for path in sorted(root.rglob("*.json")):
        try:
            walk(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    if not scenes:
        pytest.skip("no animated scenes in the corpus")
    dead = [s for s in scenes if any("no animation function" in r for r in lint_svg(s))]
    functionless = [s for s in scenes if not any(
        re.search(r"\b(?:values|from|to|by)=", el) for el in _ANIMATE_EL.findall(s))]
    assert len(dead) == len(functionless), (len(dead), len(functionless))


# --- the prompt: the rule in words the model cannot miss, and the law it draws by ----------------


def test_the_video_prompt_demands_an_animation_function() -> None:
    system = engines._SYSTEMS["video"]
    # the rule, named by the attributes the model must write and the failure it is avoiding
    assert "values=" in system and "from=" in system and "to=" in system
    assert "keyTimes" in system and "keySplines" in system
    assert "rejected" in system.lower() or "refused" in system.lower()
    # and the first frame is never empty: nothing authored invisible without the fade that lands it
    assert 'opacity="0"' in system


def test_the_video_prompt_is_pointed_at_design_md() -> None:
    system = engines._SYSTEMS["video"]
    assert "DESIGN.md" in system
    # type: the two faces, and no third
    assert "Poppins" in system and "Caveat" in system
    for retired in ("Fraunces", "JetBrains", "Georgia", "monospace"):
        assert retired not in system, retired
    # tokens: the law's palette in, the pre-v5 palette out
    for token in ("#14142B", "#2B45FF", "#FFB629", "#12B981", "#FF6B57"):
        assert token in system, token
    for retired in ("#1F35E0", "#CC1E7A", "#66B300", "#FF5A1F", "#0D0D10", "#6E6E76"):
        assert retired not in system, retired
    # ground: the film draws on the plane's own paper, never a painted white slab
    assert "white ground" not in system.lower()
    assert "no background" in system.lower() or "never paint" in system.lower()
    # line and type floors: 3 px ink and 13 px labels, stated in viewBox units at 390
    assert "3 px" in system or "3px" in system
    assert "13 px" in system or "13px" in system
    assert "stroke-width 1.5" not in system


# --- wave 29 fixer: a function that cannot run is as dead as no function ------------------------
# Each entry is (name, the element as measured frozen in headless Chromium 1208, the same element
# with the defect repaired). Blink's animation-mode table takes from+to, from+by, by, to or values;
# `from` alone is no function, an empty function is no function, and timing that never fires
# (begin="indefinite", an event begin, dur="0s", dur="indefinite") or that is malformed (a
# keyTimes or keySplines list that does not fit the values) leaves the mark exactly as authored.
NEVER_RUNS: list[tuple[str, str, str]] = [
    (
        "from with no to (opacity 0 at every sampled time)",
        '<g opacity="0"><animate attributeName="opacity" from="0" dur="1s" fill="freeze"/>'
        '<text x="60" y="100" font-size="24">two</text></g>',
        '<g opacity="0"><animate attributeName="opacity" from="0" to="1" dur="1s" fill="freeze"/>'
        '<text x="60" y="100" font-size="24">two</text></g>',
    ),
    (
        "stroke-dashoffset from alone (stays at 940)",
        '<path d="M60 300 L580 120" stroke="#14142B" stroke-width="5" fill="none"'
        ' stroke-dasharray="940" stroke-dashoffset="940">'
        '<animate attributeName="stroke-dashoffset" from="940" dur="1.4s" fill="freeze"/></path>',
        '<path d="M60 300 L580 120" stroke="#14142B" stroke-width="5" fill="none"'
        ' stroke-dasharray="940" stroke-dashoffset="940">'
        '<animate attributeName="stroke-dashoffset" from="940" to="0" dur="1.4s" fill="freeze"/>'
        "</path>",
    ),
    (
        "animateTransform translate from alone (does not move)",
        '<g><animateTransform attributeName="transform" type="translate" from="0 0" dur="1.2s"'
        ' fill="freeze"/><circle cx="320" cy="180" r="30" fill="#FFB629"/></g>',
        '<g><animateTransform attributeName="transform" type="translate" from="0 0" to="120 0"'
        ' dur="1.2s" fill="freeze"/><circle cx="320" cy="180" r="30" fill="#FFB629"/></g>',
    ),
    (
        "an empty to",
        '<g opacity="0"><animate attributeName="opacity" to="" dur="1s" fill="freeze"/></g>',
        '<g opacity="0"><animate attributeName="opacity" to="1" dur="1s" fill="freeze"/></g>',
    ),
    (
        "an empty by",
        '<rect x="0" y="0" width="10" height="10"><animate attributeName="x" by="" dur="1s"'
        ' fill="freeze"/></rect>',
        '<rect x="0" y="0" width="10" height="10"><animate attributeName="x" by="20" dur="1s"'
        ' fill="freeze"/></rect>',
    ),
    (
        "values made of separators only",
        '<g opacity="0"><animate attributeName="opacity" values=";" dur="1s" fill="freeze"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" dur="1s" fill="freeze"/></g>',
    ),
    (
        "animateMotion with an empty path",
        '<circle r="8" fill="#2B45FF"><animateMotion path="" dur="2s" fill="freeze"/></circle>',
        '<circle r="8" fill="#2B45FF"><animateMotion path="M60,300 L580,300" dur="2s"'
        ' fill="freeze"/></circle>',
    ),
    (
        'begin="indefinite" on an animate (waits for a script that never comes)',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" begin="indefinite" dur="1s"'
        ' fill="freeze"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" begin="0.3s" dur="1s"'
        ' fill="freeze"/></g>',
    ),
    (
        'begin="indefinite" on a set',
        '<g opacity="0"><set attributeName="opacity" to="1" begin="indefinite"/></g>',
        '<g opacity="0"><set attributeName="opacity" to="1" begin="0.5s"/></g>',
    ),
    (
        'begin="click" (nobody clicks a film)',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" begin="click" dur="1s"'
        ' fill="freeze"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" begin="1s" dur="1s"'
        ' fill="freeze"/></g>',
    ),
    (
        'dur="0s"',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" dur="0s" fill="freeze"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" dur="1s" fill="freeze"/></g>',
    ),
    (
        'dur="indefinite" on an animate (held at its first value for ever)',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" dur="indefinite"'
        ' fill="freeze"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" dur="2s" fill="freeze"/></g>',
    ),
    (
        "keyTimes with more entries than values",
        '<g opacity="0"><animate attributeName="opacity" values="0;1" keyTimes="0;0.5;1" dur="1s"'
        ' fill="freeze"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" keyTimes="0;1" dur="1s"'
        ' fill="freeze"/></g>',
    ),
    (
        "keyTimes that does not end at 1",
        '<g opacity="0"><animate attributeName="opacity" values="0;1" keyTimes="0;0.5" dur="1s"'
        ' fill="freeze"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" keyTimes="0;1" dur="1s"'
        ' fill="freeze"/></g>',
    ),
    (
        "one keySpline for three values",
        '<g opacity="0"><animate attributeName="opacity" values="0;1;1" keyTimes="0;0.5;1"'
        ' calcMode="spline" keySplines="0.2 0 0 1" dur="1s" fill="freeze"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1;1" keyTimes="0;0.5;1"'
        ' calcMode="spline" keySplines="0.2 0 0 1;0.2 0 0 1" dur="1s" fill="freeze"/></g>',
    ),
    (
        "no attributeName at all",
        '<g opacity="0"><animate values="0;1" dur="1s" fill="freeze"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" dur="1s" fill="freeze"/></g>',
    ),
    (
        'attributeName="opacty"',
        '<g opacity="0"><animate attributeName="opacty" values="0;1" dur="1s" fill="freeze"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" dur="1s" fill="freeze"/></g>',
    ),
]

_NEVER_IDS = [d[0] for d in NEVER_RUNS]


@pytest.mark.parametrize(("name", "dead", "_alive"), NEVER_RUNS, ids=_NEVER_IDS)
def test_an_animation_that_can_never_run_fails_lint(name, dead, _alive) -> None:
    reasons = lint_svg(_scene(dead))
    assert reasons, f"{name}: passed lint clean and is frozen in Chromium"
    assert any(
        "never runs" in r or "never fires" in r or "never lands" in r for r in reasons
    ), reasons


@pytest.mark.parametrize(("name", "_dead", "alive"), NEVER_RUNS, ids=_NEVER_IDS)
def test_the_same_animation_repaired_passes_lint(name, _dead, alive) -> None:
    assert lint_svg(_scene(alive)) == [], f"{name}: a working animation was refused"


# --- the landing claim, made a law: opacity="0" is only ever a mark waiting for its fade ---------
NEVER_LANDS: list[tuple[str, str, str]] = [
    (
        "an opacity-0 mark with no opacity animation at all",
        '<g opacity="0"><circle cx="320" cy="180" r="30" fill="#FFB629"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" dur="0.6s" fill="freeze"/>'
        '<circle cx="320" cy="180" r="30" fill="#FFB629"/></g>',
    ),
    (
        'values="0;0" (a hold at invisible)',
        '<g opacity="0"><animate attributeName="opacity" values="0;0" dur="1s" fill="freeze"/>'
        '<circle cx="320" cy="180" r="30" fill="#FFB629"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" dur="1s" fill="freeze"/>'
        '<circle cx="320" cy="180" r="30" fill="#FFB629"/></g>',
    ),
    (
        'values="0" (the single-value hold, at invisible)',
        '<g opacity="0"><animate attributeName="opacity" values="0" dur="1s" fill="freeze"/>'
        '<circle cx="320" cy="180" r="30" fill="#FFB629"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="1" dur="1s" fill="freeze"/>'
        '<circle cx="320" cy="180" r="30" fill="#FFB629"/></g>',
    ),
    (
        "a child fading inside an opacity-0 parent that never fades",
        '<g opacity="0"><circle cx="320" cy="180" r="30" fill="#FFB629" opacity="0">'
        '<animate attributeName="opacity" values="0;1" dur="1s" fill="freeze"/></circle></g>',
        '<g><circle cx="320" cy="180" r="30" fill="#FFB629" opacity="0">'
        '<animate attributeName="opacity" values="0;1" dur="1s" fill="freeze"/></circle></g>',
    ),
    (
        'a fade with no fill="freeze" (shows, then snaps back to 0)',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" dur="1s"/>'
        '<circle cx="320" cy="180" r="30" fill="#FFB629"/></g>',
        '<g opacity="0"><animate attributeName="opacity" values="0;1" dur="1s" fill="freeze"/>'
        '<circle cx="320" cy="180" r="30" fill="#FFB629"/></g>',
    ),
]

_LAND_IDS = [d[0] for d in NEVER_LANDS]


@pytest.mark.parametrize(("name", "dead", "_alive"), NEVER_LANDS, ids=_LAND_IDS)
def test_an_invisible_mark_that_nothing_lands_fails_lint(name, dead, _alive) -> None:
    reasons = lint_svg(_scene(dead))
    assert reasons, f"{name}: passed lint clean and is invisible at 3 s in Chromium"
    assert any("never lands" in r for r in reasons), reasons


@pytest.mark.parametrize(("name", "_dead", "alive"), NEVER_LANDS, ids=_LAND_IDS)
def test_a_landed_mark_passes_lint(name, _dead, alive) -> None:
    assert lint_svg(_scene(alive)) == [], f"{name}: a landed mark was refused"


def test_a_deliberate_fade_out_and_a_loop_still_land() -> None:
    # the corpus' own alive shape: in, hold, out, frozen at the end. It showed; that is the law.
    svg = _scene(
        '<g opacity="0"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.07;0.87;1"'
        ' dur="6.8s" fill="freeze"/><text x="60" y="100" font-size="24">two thirds</text></g>'
    )
    assert lint_svg(svg) == []
    # a breathing loop keeps showing without a freeze
    svg = _scene(
        '<g opacity="0"><animate attributeName="opacity" values="0;1;0" dur="2s"'
        ' repeatCount="indefinite"/><circle cx="320" cy="180" r="30" fill="#FFB629"/></g>'
    )
    assert lint_svg(svg) == []
    # a <set> holds to the end of the scene by itself (its simple duration is indefinite)
    svg = _scene(
        '<g opacity="0"><set attributeName="opacity" to="1" begin="1s"/>'
        '<circle cx="320" cy="180" r="30" fill="#FFB629"/></g>'
    )
    assert lint_svg(svg) == []
    # a hidden track for an <mpath> is not a mark
    svg = _scene(
        '<defs><path id="track" d="M60,300 L580,300" opacity="0"/></defs>'
        '<circle r="8" fill="#2B45FF"><animateMotion dur="2s" fill="freeze">'
        '<mpath href="#track"/></animateMotion></circle>'
    )
    assert lint_svg(svg) == []


def test_the_video_prompt_states_the_landing_and_the_freeze() -> None:
    system = engines._SYSTEMS["video"]
    assert 'fill="freeze"' in system
    assert "from alone" in system.lower() or "from without" in system.lower()
    assert "begin=\"indefinite\"" in system or "indefinite" in system
    assert "keyTimes" in system and "keySplines" in system
