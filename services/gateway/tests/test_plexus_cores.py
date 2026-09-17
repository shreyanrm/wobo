"""The three layers and the cache: one concept core, many level renderings, one number for both.

docs/CONTENT-INTERACTION.md §1 and §5.1-5.3, docs/CACHES.md §1. Wave 31 keyed a whole compose
generation on concept x board x grade x version, which is right for what a learner READS and
wrong for what makes a concept teachable: the idea, the two misconceptions and their
counter-examples, the check and the vocabulary are identical at every board, and we paid for them
twelve times.

Here the core is made ONCE PER DEPTH BAND THAT TEACHES THE CONCEPT, keyed on concept x band
(docs/CONTENT-INTERACTION.md section 5b, decided 2026-09-11: a concept taught in one class has
one core, and fractions taught in 4, 6 and 8 has a foundation core and a middle core, two and not
three), at the verify tier's model, and judged against a higher bar than a lesson is; the level
renderings are made FROM it by the cheapest model, keyed on concept x board x grade x version,
and judged AGAINST the core. A level that misses falls back to the core and renders from it,
never to a full generation and never to the topic-agnostic seed.

No network: every model call is a stub. The costs the layer ledger reports come from the vendors'
own per-million rates in ``routing.CATALOGUE`` applied to the stub's reported usage, so the
saving is arithmetic on a published price and not an estimate.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from wobo_gateway.plexus import economy, engines, store, validate

CONCEPTS = (
    "equivalent fractions",
    "the parts of a plant cell",
    "the water cycle",
)

CBSE_6 = {
    "board": "CBSE",
    "grade": "6",
    "subject": "Mathematics",
    "chapter": "Fractions",
    "contentVersion": "2026-27",
}
ISC_11 = {
    "board": "ISC",
    "grade": "11",
    "subject": "Mathematics",
    "chapter": "Sets and relations",
    "contentVersion": "2026-27",
}
BOARDS = (CBSE_6, ISC_11)
GRADES = ("6", "9")

#: The registry docs/CONTENT-INTERACTION.md section 5b argues from: the three concepts it names,
#: with the classes it says teach them, and nothing else. The band tests point the store at this
#: file so they assert the law rather than today's catalogue.
DEPTH_BANDS = Path(__file__).parent / "fixtures" / "concepts_depth_bands.json"
TAUGHT_ONCE = "the nature of roots"  # class 9 only: one core, whichever class asks
FRACTIONS = "fractions"  # classes 4, 6 and 8: a foundation core and a middle core
CURRENT = "electric current"  # classes 7, 10 and 12: a middle core and a senior core


def _at(grade: str, board: dict[str, str] = CBSE_6) -> dict[str, str]:
    return {**board, "grade": grade}


@pytest.fixture
def depth_bands(monkeypatch):
    """The store reads the section 5b registry, and forgets it again afterwards so the tests
    that lean on the shipped catalogue are not reading three concepts."""
    monkeypatch.setenv("PLEXUS_CONCEPTS_PATH", str(DEPTH_BANDS))
    store.forget_registry()
    yield DEPTH_BANDS
    store.forget_registry()


@pytest.fixture(autouse=True)
def cache_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_AI_API_KEY", raising=False)
    economy.reset()
    # The refusal cooldown is in-process, so it outlives a test the way it outlives a request.
    # Clearing it here is what keeps one test's refused core from being another test's silence.
    engines.forget_core_refusals()
    return tmp_path


# --- the stub provider ------------------------------------------------------------------


class _Message:
    def __init__(self, content: str) -> None:
        self.content = content


class _Choice:
    def __init__(self, content: str) -> None:
        self.message = _Message(content)


class _Usage:
    def __init__(self, tin: int, tout: int) -> None:
        self.prompt_tokens = tin
        self.completion_tokens = tout
        self.total_tokens = tin + tout


class _Response:
    def __init__(self, content: str, model: str, tin: int, tout: int) -> None:
        self.choices = [_Choice(content)]
        self.usage = _Usage(tin, tout)
        self.model = model
        self.served_model = model


GOOD_CORE = {
    "shape": "relation",
    "idea": (
        "Two fractions are equivalent when they name the same amount of the same whole, even "
        "though the number of pieces and the size of each piece are different."
    ),
    "why": "It is what lets you compare, add and simplify fractions without changing their value.",
    "misconceptions": [
        {
            "belief": "a fraction with bigger numbers is a bigger fraction",
            "counter": (
                "two quarters and four eighths cover the same strip, so"
                " bigger numbers did not make more."
            ),
        },
        {
            "belief": "you may add the same number to the top and the bottom",
            "counter": (
                "adding one to each turns a half into two thirds, which is a different amount."
            ),
        },
    ],
    "check": {
        "question": "Is six ninths the same amount as two thirds, and how do you know?",
        "answer": (
            "Yes, because both numbers were multiplied by three, which cuts each piece into three."
        ),
    },
    "vocabulary": [
        {"term": "numerator", "meaning": "how many pieces are taken", "alsoCalled": []},
        {"term": "denominator", "meaning": "how many equal pieces the whole is cut into"},
    ],
}


def _level_json(brief: dict[str, Any]) -> str:
    """A level rendering the way a cheap model would answer: this reader's words, this length."""
    board = brief.get("board", "")
    grade = brief.get("class", "")
    core = brief["core"]
    cap = int(brief["cardWordCap"])
    long_tail = " and it holds for every whole you choose to cut" if cap > 30 else ""
    cards = [
        {
            "id": f"c{i + 1}",
            "kind": "text",
            "title": title,
            "idea": f"{idea}{long_tail}",
            "interaction": {
                "kind": "tap",
                "prompt": f"Tap what changes for a {board} class {grade} reader.",
            },
            "reveal": reveal,
        }
        for i, (title, idea, reveal) in enumerate(
            [
                ("Where you meet it", core["idea"], core["why"]),
                (
                    "A wrong turn",
                    f"Many think {core['misconceptions'][0]['belief']}",
                    core["misconceptions"][0]["counter"],
                ),
                (
                    "A second wrong turn",
                    f"Some think {core['misconceptions'][1]['belief']}",
                    core["misconceptions"][1]["counter"],
                ),
                ("The words", "the terms this board uses", core["vocabulary"][0]["meaning"]),
            ]
        )
    ]
    items = [
        {
            "id": "w1",
            "type": "fill",
            "prompt": "the top number is the ________.",
            "answer": "numerator",
        },
        {
            "id": "w2",
            "type": "fill",
            "prompt": "the bottom number is the ________.",
            "answer": "denominator",
        },
        {
            "id": "w3",
            "type": "mcq",
            "prompt": "which pair is equivalent?",
            "options": ["two quarters and four eighths", "one half and one third"],
            "answer": "two quarters and four eighths",
        },
    ]
    boss = [
        {"id": "b1", "type": "fill", "prompt": core["check"]["question"], "answer": "yes"},
        {
            "id": "b2",
            "type": "fill",
            "prompt": "six ninths simplifies to ________.",
            "answer": "two thirds",
        },
        {
            "id": "b3",
            "type": "mcq",
            "prompt": "which move keeps the value?",
            "options": ["multiply top and bottom", "add one to top and bottom"],
            "answer": "multiply top and bottom",
        },
    ]
    return json.dumps({"topic": brief["concept"], "cards": cards, "workbook": items, "boss": boss})


class Provider:
    """A stub ``model_call.complete`` that answers by which system message it was handed."""

    def __init__(
        self, *, core_score: float = 92.0, level_ok: bool = True, one_core: bool = False
    ) -> None:
        self.calls: list[dict[str, Any]] = []
        self.core_score = core_score
        self.level_ok = level_ok
        # A real model is told the band and writes for it; ``one_core`` is the model that ignores
        # the band and hands every band the same words, which the store refuses as a copy.
        self.one_core = one_core

    def __call__(self, **kwargs: Any) -> Any:
        system = kwargs["messages"][0]["content"]
        user = kwargs["messages"][1]["content"]
        model = kwargs["model"]
        if "You write CONCEPT CORES" in system:
            band = "" if self.one_core else str(json.loads(user).get("band") or "")
            core = {**GOOD_CORE, "idea": f"{GOOD_CORE['idea']}{' for ' + band if band else ''}"}
            kind, body, usage = "core", json.dumps(core), (2400, 1100)
        elif "strict judge of CONCEPT CORES" in system:
            kind = "core-judge"
            body = json.dumps(
                {"score": self.core_score, "critical": False, "weak": [], "notes": "sound"}
            )
            usage = (1800, 90)
        elif "THIS REQUEST CARRIES A CONCEPT CORE" in system:
            kind = "level"
            body = _level_json(json.loads(user)) if self.level_ok else "{}"
            usage = (1900, 900)
        elif "strict quality judge" in system:
            kind = "artifact-judge"
            body = json.dumps({"score": 88, "critical": False, "weak": [], "notes": "fine"})
            usage = (2000, 80)
        else:
            kind, body, usage = "other", "{}", (100, 20)
        self.calls.append({"kind": kind, "model": model, "user": user, "system": system})
        return _Response(body, model, *usage)

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [c for c in self.calls if c["kind"] == kind]


@pytest.fixture
def provider(monkeypatch):
    stub = Provider()
    monkeypatch.setattr("wobo_gateway.model_call.complete", stub)
    return stub


def _render(concept: str, scope: dict[str, str], model: str = "openai/gpt-5.6-luna"):
    from wobo_gateway.routing import Tier, tier_fallbacks, tier_model

    return engines._generate_live(
        "compose",
        concept,
        "core",
        model or tier_model(Tier.GENERATE).provider_model,
        tuple(tier_fallbacks(Tier.GENERATE)),
        dict(scope),
    )


# --- 1. the two keys ---------------------------------------------------------------------


def test_the_core_key_is_the_concept_and_its_band_and_the_level_key_is_not(depth_bands) -> None:
    """The half of wave 31's key that comes back off: a core is one file for every board. The half
    that stays on is the depth band (docs/CONTENT-INTERACTION.md section 5b): a concept the
    syllabus teaches in one band has one core whichever class asks, and a concept it teaches in
    two bands has two files that no board, chapter or syllabus version can join."""
    assert store.core_path(TAUGHT_ONCE, CBSE_6) == store.core_path(TAUGHT_ONCE, ISC_11)
    assert store.core_path(TAUGHT_ONCE, None) == store.core_path(TAUGHT_ONCE, CBSE_6)
    assert store.artifact_path(TAUGHT_ONCE, "compose", "core", CBSE_6) != store.artifact_path(
        TAUGHT_ONCE, "compose", "core", ISC_11
    )
    # two boards in one band share the core; the same concept one band deeper does not
    assert store.core_path(CURRENT, _at("7", CBSE_6)) == store.core_path(CURRENT, _at("8", ISC_11))
    assert store.core_path(CURRENT, _at("7")) != store.core_path(CURRENT, _at("10"))
    assert store.core_key(CURRENT, _at("10")).startswith("core/electric-current--senior--")
    # and it is still a different concept's core that a different concept gets
    assert store.core_path("the water cycle") != store.core_path(TAUGHT_ONCE)


def test_a_core_round_trips_within_its_band_and_every_version_is_kept_per_band() -> None:
    """docs/CONTENT-INTERACTION.md section 5b. This test used to write a core under class 6 and
    read it back under class 11, and that read is now the borrow the law forbids: an uncatalogued
    concept's band is the class that asked, class 6 is middle and class 11 is senior. A core
    written under one BOARD is read under another in the same band, and the version ledger is one
    per band because one core per band is what is being retained."""
    record = {"concept": "x", "promptVersion": store.CORE_PROMPT_VERSION, "core": {"idea": "one"}}
    store.save_core("x", record, CBSE_6)
    store.save_core_version("x", record, CBSE_6)
    store.save_core_version("x", {**record, "core": {"idea": "two"}}, _at("8", ISC_11))
    stamped = {**record, "band": store.MIDDLE}
    assert store.load_core("x", _at("8", ISC_11)) == stamped  # another board, the same band
    assert store.load_core("x", ISC_11) is None  # class 11 is senior, and senior has no core yet
    kept = store.load_core_versions("x", CBSE_6)
    assert [v["core"]["idea"] for v in kept] == ["one", "two"]
    assert [v["band"] for v in kept] == [store.MIDDLE, store.MIDDLE]
    assert store.load_core_versions("x", ISC_11) == []


def test_a_core_from_an_older_prompt_version_misses_rather_than_being_served() -> None:
    store.save_core("x", {"concept": "x", "promptVersion": "core-v0", "core": {}}, CBSE_6)
    assert store.load_core("x", CBSE_6) is None


# --- 2. one core, twelve levels ----------------------------------------------------------


def test_three_concepts_pay_for_one_core_per_band_that_teaches_them_and_every_level_renders(
    provider, depth_bands
) -> None:
    """The proof of section 1 as section 5b amends it (docs/CONTENT-INTERACTION.md, decided
    2026-09-11): a core is made once per concept PER DEPTH BAND THAT TEACHES IT, and every level
    is rendered from its band's core. This test used to say "one core per concept, whatever the
    board or the class", and for a concept that recurs that sentence cannot be honest: the three
    concepts the law names, rendered for every class the syllabus teaches them in on two boards,
    pay for five cores (one, two and two) and fourteen levels, and not for three cores and not for
    fourteen."""
    taught = {TAUGHT_ONCE: ("9",), FRACTIONS: ("4", "6", "8"), CURRENT: ("7", "10", "12")}
    for concept, grades in taught.items():
        for board in BOARDS:
            for grade in grades:
                artifact, _model, _tokens, seeded = _render(concept, {**board, "grade": grade})
                assert not seeded
                assert artifact["cards"]

    made: dict[str, list[str]] = {}
    for call in provider.of("core"):
        brief = json.loads(call["user"])
        made.setdefault(brief["concept"], []).append(brief["band"])
    assert made == {
        TAUGHT_ONCE: [store.SENIOR],
        FRACTIONS: [store.FOUNDATION, store.MIDDLE],
        CURRENT: [store.MIDDLE, store.SENIOR],
    }, "one core per band that teaches the concept: two for fractions, not three and not one"
    assert len(provider.of("level")) == 14, "one rendering per board x class"
    assert len(provider.of("core-judge")) == 5, "and each core is judged once, at insert"

    summary = economy.summary()
    layers = summary["layers"]
    assert layers["core"]["made"] == 5
    assert layers["core"]["cacheHits"] == 9, "nine of the fourteen levels found their core paid for"
    assert layers["level"]["made"] == 14
    assert layers["full"]["made"] == 0, "not one full generation was needed"
    # the ledger reports the cost per concept per band, so the multiplication is a number on the
    # console rather than a surprise on the bill (section 5b, "what it costs")
    by_band = [(r["concept"], r["band"], r["made"], r["cacheHits"]) for r in summary["coresByBand"]]
    assert by_band == [
        (CURRENT, store.MIDDLE, 1, 1),
        (CURRENT, store.SENIOR, 1, 3),
        (FRACTIONS, store.FOUNDATION, 1, 1),
        (FRACTIONS, store.MIDDLE, 1, 3),
        (TAUGHT_ONCE, store.SENIOR, 1, 1),
    ]
    assert all(r["costUsd"] > 0 for r in summary["coresByBand"])


def test_the_core_is_made_at_the_verify_tier_model_from_the_first_call(provider) -> None:
    """'Better models only where needed': the one call reused forever gets the strongest model,
    and the twelve renderings under it get the cheapest."""
    from wobo_gateway.routing import Tier, tier_model

    _render("equivalent fractions", CBSE_6)
    assert provider.of("core")[0]["model"] == tier_model(Tier.VERIFY).provider_model
    assert provider.of("level")[0]["model"] == "openai/gpt-5.6-luna"
    assert tier_model(Tier.GENERATE).provider_model == "openai/gpt-5.6-luna"


def test_the_core_carries_no_board_and_no_class_into_the_model_but_it_carries_its_band(
    provider, depth_bands
) -> None:
    """A core that knew the reader would be written for one of them, and then it is not a core.
    The one thing about depth it is told is its band (docs/CONTENT-INTERACTION.md section 5b),
    read from the syllabus and not from the class that asked: fractions asked for by a class 6
    child is the middle core, said as the band's classes and never as class 6."""
    _render(FRACTIONS, CBSE_6)
    brief = json.loads(provider.of("core")[0]["user"])
    assert brief["concept"] == FRACTIONS
    assert "board" not in brief and "class" not in brief and "grade" not in brief
    assert brief["subject"] == "Mathematics"  # a cell in biology is not a cell in physics
    assert brief["band"] == store.MIDDLE
    assert brief["classes"] == "classes 6 to 8"
    assert "6" not in brief.values(), "the class that asked is not in the brief"
    assert "band" in provider.of("core")[0]["system"].lower()


def test_the_level_prompt_carries_the_core_verbatim_and_this_reader(provider) -> None:
    _render("equivalent fractions", ISC_11)
    call = provider.of("level")[0]
    assert call["user"].count(GOOD_CORE["check"]["question"]) == 1
    brief = json.loads(call["user"])
    # the STORED core, which is the verified one: an empty alsoCalled is dropped and the
    # concept is stamped on, so the level renders from what the judge actually read.
    band = json.loads(provider.of("core")[0]["user"])["band"]
    written = {**GOOD_CORE, "idea": f"{GOOD_CORE['idea']} for {band}"}
    assert brief["core"] == engines._verify_core(written, "equivalent fractions")
    assert brief["core"]["misconceptions"] == GOOD_CORE["misconceptions"]
    assert brief["board"] == "ISC" and brief["class"] == "11"
    assert "ISC class 11 learner" in brief["audience"]
    assert "It is the AUTHORITY" in call["system"]


def test_two_boards_and_two_classes_read_like_two_different_readers(provider) -> None:
    young, _m, _t, _s = _render("equivalent fractions", {**CBSE_6, "grade": "6"})
    older, _m, _t, _s = _render("equivalent fractions", {**ISC_11, "grade": "11"})
    assert young != older
    assert "CBSE class 6" in json.dumps(young)
    assert "ISC class 11" in json.dumps(older)
    # the card word cap the level was given is the class's, and the two are not the same
    caps = [json.loads(c["user"])["cardWordCap"] for c in provider.of("level")]
    assert caps == [26, 55]


# --- 3. a level that misses falls back to the core, never to a generation -----------------


def test_a_level_that_fails_verification_renders_from_the_core(monkeypatch) -> None:
    stub = Provider(level_ok=False)
    monkeypatch.setattr("wobo_gateway.model_call.complete", stub)
    artifact, model, _tokens, seeded = _render("equivalent fractions", CBSE_6)

    assert seeded is False, "the seed is not the floor any more; the core is"
    assert model == engines.CORE_RENDER
    assert len(stub.of("level")) == 1, "one attempt, then the core; never a second generation"
    body = json.dumps(artifact)
    # the concept's own idea, both of its misconceptions and its check reached the learner
    assert GOOD_CORE["misconceptions"][0]["counter"][:40] in body
    assert GOOD_CORE["misconceptions"][1]["counter"][:40] in body
    assert GOOD_CORE["check"]["question"][:40] in body
    assert "balance" not in body.lower(), "the topic-agnostic seed course must not appear"
    assert "CBSE class 6 book" in body, "and it is cut for THIS reader"


def test_the_core_render_is_shorter_for_a_younger_reader() -> None:
    record = {"core": GOOD_CORE}
    young = engines._level_from_core(
        record, "equivalent fractions", "core", {**CBSE_6, "grade": "6"}
    )
    older = engines._level_from_core(
        record, "equivalent fractions", "core", {**ISC_11, "grade": "11"}
    )
    assert len(young["cards"][0]["idea"].split()) < len(older["cards"][0]["idea"].split())
    assert engines._level_words("6") == 26 and engines._level_words("11") == 55


def test_a_core_below_the_bar_is_never_stored_and_the_level_pays_the_old_price(
    monkeypatch,
) -> None:
    """docs/CACHES.md §2: a store never holds an unjudged core. Below the bar it is refused, and
    the level falls all the way back to one full generation, which is the baseline we measure."""
    stub = Provider(core_score=61.0)
    monkeypatch.setattr("wobo_gateway.model_call.complete", stub)
    _render("equivalent fractions", CBSE_6)
    assert store.load_core("equivalent fractions", CBSE_6) is None
    assert economy.summary()["layers"]["full"]["made"] == 1
    assert economy.summary()["layers"]["level"]["made"] == 0


# --- 4. the money is a number ------------------------------------------------------------


def test_the_ledger_carries_a_cost_for_the_core_and_for_every_level(provider) -> None:
    for board in BOARDS:
        for grade in GRADES:
            _render("equivalent fractions", {**board, "grade": grade})
    rows = economy.rows()
    cores = [r for r in rows if r["layer"] == "core" and not r["cached"]]
    levels = [r for r in rows if r["layer"] == "level"]
    assert len(cores) == 1 and len(levels) == 4
    assert cores[0]["costUsd"] > 0, "the vendor's own per-million rates priced the core"
    assert all(r["costUsd"] > 0 for r in levels)
    # the level rendering is the cheap one, by construction and in the ledger
    assert levels[0]["costUsd"] < cores[0]["costUsd"]
    assert {r["board"] for r in levels} == {"CBSE", "ISC"}
    assert {r["grade"] for r in levels} == {"6", "9"}


def test_the_saving_is_measured_against_a_full_generation_we_actually_paid_for() -> None:
    """No baseline row, no claim: :func:`economy.summary` says None rather than a flattering
    number. With a measured baseline it is arithmetic."""
    economy.record(economy.CORE, concept="c", capability="x", cost_usd=0.05, tokens=1)
    for _ in range(12):
        economy.record(economy.LEVEL, concept="c", capability="x", cost_usd=0.002, tokens=1)
    assert economy.summary()["baselineUsd"] is None
    assert economy.summary()["savedUsd"] is None

    economy.record(economy.FULL, concept="c", capability="x", cost_usd=0.06, tokens=1)
    out = economy.summary()
    assert out["totalUsd"] == pytest.approx(0.074)
    assert out["baselineUnitUsd"] == pytest.approx(0.06)
    assert out["baselineUsd"] == pytest.approx(0.72)
    assert out["savedUsd"] == pytest.approx(0.646)


# --- 5. the interaction is chosen by rule, and costs nothing -----------------------------


def test_the_interaction_chooser_decides_from_the_core_without_a_model(monkeypatch) -> None:
    def boom(**_kwargs: Any) -> Any:  # a model call here would be a bug, not a fallback
        raise AssertionError("the chooser must not call a model when the core names the shape")

    monkeypatch.setattr("wobo_gateway.model_call.complete", boom)
    mix = validate.choose_interactions("equivalent fractions", core=GOOD_CORE)
    assert [m["role"] for m in mix] == ["build", "check", "fun"]
    assert [m["kind"] for m in mix] == ["sliderAndSee", "sortIntoOrder", "challenge"]
    assert len({m["kind"] for m in mix}) == 3, "never three of the same kind"
    assert all(m["kind"] in validate.INTERACTION_MENU for m in mix)


@pytest.mark.parametrize(
    ("concept", "shape"),
    [
        ("the parts of a plant cell", "classification"),
        ("the steps of respiration", "ordering"),
        ("ohm's law", "relation"),
        ("balancing a chemical equation", "construction"),
        ("the water cycle", "process"),
    ],
)
def test_the_shape_falls_out_of_the_concept_when_the_core_has_none(concept, shape) -> None:
    assert validate.shape_of(concept) == shape


def test_a_concept_no_rule_can_place_uses_the_template_floor_when_no_model_answers() -> None:
    mix = validate.choose_interactions("a thing with no name a rule knows", ask_model=False)
    assert [m["kind"] for m in mix] == list(validate._MIX_FLOOR)
    assert all(m["by"] == "floor" for m in mix)


def test_a_chapter_that_just_used_a_mechanic_gets_a_different_one(provider) -> None:
    mix = validate.choose_interactions(
        "equivalent fractions", core=GOOD_CORE, recent=("sliderAndSee", "challenge")
    )
    kinds = [m["kind"] for m in mix]
    assert "sliderAndSee" not in kinds and "challenge" not in kinds
    assert len(set(kinds)) == 3


def test_the_chosen_mix_is_recorded_on_the_core_so_it_is_chosen_once(provider) -> None:
    _render("equivalent fractions", CBSE_6)
    record = store.load_core("equivalent fractions", CBSE_6)
    assert [m["kind"] for m in record["interactions"]] == [
        "sliderAndSee",
        "sortIntoOrder",
        "challenge",
    ]
    assert record["judged"] is True
    assert record["provenance"]["judge"]["score"] == 92.0
    assert record["status"] == store.CANONICAL


# --- 6. the judge scores a level against its core ----------------------------------------


def test_the_judge_is_handed_the_core_the_level_was_rendered_from(provider) -> None:
    _render("equivalent fractions", CBSE_6)
    validate._judge(
        "openai/gpt-5.6-sol",
        "compose",
        "equivalent fractions",
        {"cards": []},
        scope=CBSE_6,
        core=validate.core_for_judging("equivalent fractions", CBSE_6),
    )
    call = provider.of("artifact-judge")[-1]
    assert "THE CONCEPT CORE this rendering must carry" in call["user"]
    assert GOOD_CORE["misconceptions"][1]["belief"] in call["user"]
    assert "fidelity" in call["system"]
    assert "BOTH of the core's misconceptions" in call["system"]


def test_a_core_is_held_to_a_higher_bar_than_a_lesson() -> None:
    assert validate.CORE_PASS_THRESHOLD > validate.PASS_THRESHOLD
    seventy_five = {"score": 75.0, "critical": False, "weak": [], "notes": ""}
    assert validate._promotable(seventy_five) is True  # good enough for one lesson
    assert validate.core_passes(seventy_five) is False  # not good enough for twelve
    assert validate.core_passes(None) is False, "an unread core has not passed anything"


# --- 7. the third layer, and the hit rate the console reads -------------------------------


def test_the_interaction_is_the_third_layer_and_it_costs_nothing(provider) -> None:
    """docs/CONTENT-INTERACTION.md §1: an interaction from a template is USD 0. The ledger has to
    be able to SAY that, or 'the cheapest of the three' stays a claim."""
    _render("equivalent fractions", CBSE_6)
    rows = [r for r in economy.rows() if r["layer"] == "interaction"]
    assert len(rows) == 1
    assert rows[0]["costUsd"] == 0.0
    assert rows[0]["cached"] is True
    assert economy.summary()["layers"]["interaction"]["costUsd"] == 0.0


def test_a_level_served_from_the_cache_is_a_hit_in_the_layer_ledger(provider) -> None:
    """The number the design lives on is the hit rate, so a cache hit is an event and not a
    silence: two learners on the same board and class must show as one made and one hit."""
    from wobo_gateway.plexus import run_engine

    for _ in range(2):
        run_engine(
            capability="engine.compose",
            payload={"concept": "equivalent fractions", **CBSE_6},
            provider_model="openai/gpt-5.6-luna",
            live=True,
            subject="a-learner",
        )
    levels = economy.summary()["layers"]["level"]
    assert levels["made"] == 1 and levels["cacheHits"] == 1
    assert len(provider.of("level")) == 1, "the second learner cost no model call at all"


# --- 8. what the live run found: a judge starved of tokens says nothing -------------------


def test_the_judge_is_given_enough_headroom_to_answer(monkeypatch) -> None:
    """MEASURED, 2026-09-10, live on openai/gpt-5.6-sol: at max_tokens=800 the judge returned an
    EMPTY string with completion_tokens exactly 800 — the whole budget went on reasoning tokens
    and nothing was left for the verdict. An empty reply parses to no score, which this gate
    reads as "the judge is unreachable", which promotes NOTHING: every artifact would have sat
    provisional forever while we paid for a judge call each time. The same call at 4000 answered
    in 1611 completion tokens (1519 of them reasoning) with a real verdict. So the budget is a
    correctness property of the gate, not a saving."""
    seen: dict[str, Any] = {}

    def fake(**kwargs: Any) -> Any:
        seen.update(kwargs)
        return _Response(json.dumps({"score": 81, "critical": False}), kwargs["model"], 4000, 1600)

    monkeypatch.setattr("wobo_gateway.model_call.complete", fake)
    verdict = validate._judge("openai/gpt-5.6-sol", "compose", "x", {"cards": []})
    assert verdict is not None and verdict["score"] == 81.0
    assert seen["max_tokens"] >= validate.JUDGE_MAX_TOKENS >= 3000

    seen.clear()
    validate.judge_core(GOOD_CORE, "x")
    assert seen["max_tokens"] >= validate.JUDGE_MAX_TOKENS


def test_a_judge_whose_budget_ran_out_is_read_as_unreachable_not_as_a_pass(monkeypatch) -> None:
    """The empty reply, exactly as the live model returned it. Nothing may be promoted on it."""

    def starved(**kwargs: Any) -> Any:
        return _Response("", kwargs["model"], 4268, 800)

    monkeypatch.setattr("wobo_gateway.model_call.complete", starved)
    assert validate._judge("openai/gpt-5.6-sol", "compose", "x", {"cards": []}) is None
    assert validate.judge_core(GOOD_CORE, "x") is None
    assert validate._promotable(None) is False
    assert validate.core_passes(None) is False


# --- 9. what the live run found: a refused core must not be re-bought per level ------------


def test_a_refused_core_is_not_bought_again_for_every_level(monkeypatch) -> None:
    """MEASURED, 2026-09-10, live: one concept's core came back CRITICAL and was refused, and the
    next board's request bought a second core and a second judge for the same concept. Twelve
    levels of a concept whose core keeps failing would have paid twelve cores, twelve judges AND
    twelve full generations — strictly worse than the path this wave replaces. A refusal is
    remembered for a cooldown, so it costs one attempt per window and not one per learner."""
    stub = Provider(core_score=40.0)
    monkeypatch.setattr("wobo_gateway.model_call.complete", stub)
    engines.forget_core_refusals()
    for board in BOARDS:
        for grade in GRADES:
            _render("equivalent fractions", {**board, "grade": grade})
    assert len(stub.of("core")) == engines.CORE_SAMPLES, "one window's samples, not one per level"
    assert len(stub.of("core-judge")) == engines.CORE_SAMPLES
    assert economy.summary()["layers"]["full"]["made"] == 4, "each level still gets its lesson"

    # the window is not forever: forgetting it lets the concept be tried again
    engines.forget_core_refusals()
    _render("equivalent fractions", CBSE_6)
    assert len(stub.of("core")) == 2 * engines.CORE_SAMPLES


def test_a_core_refused_as_critical_says_so_rather_than_blaming_the_score(
    monkeypatch, caplog
) -> None:
    """The live log read 'judged 82.0 (below the core bar)' for a core the judge had passed on
    score and failed as CRITICAL. A reason that names the wrong thing sends an operator to tune a
    threshold that was never the problem."""
    stub = Provider()
    stub.core_score = 82.0
    monkeypatch.setattr("wobo_gateway.model_call.complete", stub)

    def critical(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"score": 82.0, "critical": True, "weak": ["board neutrality"], "notes": "n"}

    monkeypatch.setattr(validate, "judge_core", critical)
    with caplog.at_level("WARNING"):
        _render("equivalent fractions", CBSE_6)
    said = " ".join(r.getMessage() for r in caplog.records)
    assert "critical" in said and "82" in said


def test_the_summary_refuses_a_break_even_one_row_cannot_support() -> None:
    """This test used to assert 33, from one core, four levels and ONE full generation, and the
    wave published "~38" off the same shape of evidence. A mean of one is not a price: the
    headline run's twelve level costs straddled its single baseline, so the same arithmetic gives
    25, 38 or never depending on which row you divide by. The summary now says so in a sentence
    (:func:`economy._break_even`) instead of printing a figure."""
    economy.record(economy.CORE, concept="c", capability="x", cost_usd=0.0194, tokens=1)
    for _ in range(4):
        economy.record(economy.LEVEL, concept="c", capability="x", cost_usd=0.0058, tokens=1)
    economy.record(economy.FULL, concept="c", capability="x", cost_usd=0.0064, tokens=1)
    out = economy.summary()
    assert out["savedUsd"] < 0, "four levels do not amortise a core, and the number says so"
    assert out["breakEvenLevels"] is None
    assert out["baselineSamples"] == 1
    assert "not enough measurements" in out["breakEvenReason"]


def test_a_break_even_is_reported_when_the_two_ranges_do_not_overlap() -> None:
    """The honest case, and it is a real one: where every level rendering measured cost less than
    every full generation measured, the direction is not a coin toss and the figure means what it
    says — how many levels of one concept a core has to serve before the split is cheaper."""
    economy.record(economy.CORE, concept="c", capability="x", cost_usd=0.030, tokens=1)
    for cost in (0.0020, 0.0021, 0.0019):
        economy.record(economy.LEVEL, concept="c", capability="x", cost_usd=cost, tokens=1)
    for cost in (0.0120, 0.0115, 0.0125):
        economy.record(economy.FULL, concept="c", capability="x", cost_usd=cost, tokens=1)
    out = economy.summary()
    assert out["breakEvenLevels"] == 3
    assert out["breakEvenReason"] == ""


def test_a_level_that_costs_as_much_as_a_full_generation_never_breaks_even() -> None:
    for cost in (0.007, 0.0071, 0.0069):
        economy.record(economy.LEVEL, concept="c", capability="x", cost_usd=cost, tokens=1)
        economy.record(economy.FULL, concept="c", capability="x", cost_usd=cost, tokens=1)
    economy.record(economy.CORE, concept="c", capability="x", cost_usd=0.02, tokens=1)
    out = economy.summary()
    assert out["breakEvenLevels"] is None
    assert out["breakEvenReason"]


# --- 10. the core outlives the container -------------------------------------------------


@pytest.fixture
def fake_db(monkeypatch):
    """Postgres behind the file front, the way ``test_content_stores.py`` stands it up."""
    from store_fakes import FakePostgrest
    from wobo_gateway.plexus import db

    monkeypatch.delenv("PLEXUS_STORES", raising=False)
    transport = FakePostgrest()
    db.reset()
    db.configure(base_url="https://db.test", service_key="service-role", transport=transport)
    yield transport
    db.reset()


def test_a_core_survives_the_deploy_that_throws_the_disk_away(fake_db, cache_dir) -> None:
    """docs/CACHES.md: the container's disk is a cache of a cache. A core is the most expensive
    row we own (USD 0.019 against USD 0.006 for a level, measured live on 2026-09-10) and it is
    reused by every board, class and version forever, so losing it on every deploy is the worst
    loss in the whole content economy."""
    import shutil

    record = {
        "concept": "equivalent fractions",
        "layer": store.CORE_MODALITY,
        "promptVersion": store.CORE_PROMPT_VERSION,
        "status": store.CANONICAL,
        "judged": True,
        "core": engines._verify_core(GOOD_CORE, "equivalent fractions"),
        "provenance": {"model": "openai/gpt-5.6-sol", "costUsd": 0.0194},
    }
    store.save_core("equivalent fractions", record, CBSE_6)
    assert fake_db.rows.get("cores"), "the core reached the database, not only the disk"

    shutil.rmtree(cache_dir / store.CORE_MODALITY)  # the deploy
    # A different board asks for it. The catalogue teaches this concept in one band, so every
    # class lands on that one core (docs/CONTENT-INTERACTION.md section 5b, the common case), and
    # the record comes back stamped with the band it was saved under, which is what the store
    # reads to refuse a row that reached the key by any other route.
    band = store.band_for("equivalent fractions", CBSE_6)
    assert band == store.band_for("equivalent fractions", ISC_11)
    back = store.load_core("equivalent fractions", ISC_11)
    assert back == {**record, "band": band}
    assert fake_db.rows["cores"][-1]["key"] == store.core_key("equivalent fractions", CBSE_6)
    assert (cache_dir / store.CORE_MODALITY).is_dir(), "and the front is warm again"


def test_the_core_row_carries_what_it_cost_and_what_the_judge_said(fake_db) -> None:
    record = {
        "concept": "x",
        "promptVersion": store.CORE_PROMPT_VERSION,
        "status": store.CANONICAL,
        "core": {"idea": "one"},
        "provenance": {
            "model": "openai/gpt-5.6-sol",
            "costUsd": 0.0194,
            "judge": {"score": 91.0, "critical": False},
        },
    }
    store.save_core("x", record, CBSE_6)  # a core is written for a band, and a class names it
    row = fake_db.rows["cores"][-1]
    assert row["concept_id"] == store.concept_id("x")
    assert row["model"] == "openai/gpt-5.6-sol"
    assert row["cost_usd"] == 0.0194
    assert row["judge_score"] == 91.0
    assert row["status"] == store.CANONICAL


# --- 11. a core costs what it costs, judge included ---------------------------------------


def test_the_core_layer_carries_its_judge_call_too(provider) -> None:
    """The judge at insert exists only because the core does (docs/CACHES.md §3 names it as the
    one cost to watch), so leaving it out of the core's layer row understates the expensive layer
    and flatters the break-even. One core is ONE row, and it carries both calls."""
    _render("equivalent fractions", CBSE_6)
    rows = [r for r in economy.rows() if r["layer"] == "core" and not r["cached"]]
    assert len(rows) == 1, "one row per core attempt, whatever it took to decide"

    from wobo_gateway.routing import token_cost

    call = token_cost("openai/gpt-5.6-sol", 2400, 1100)
    judge = token_cost("openai/gpt-5.6-sol", 1800, 90)
    assert rows[0]["costUsd"] == pytest.approx(round(call + judge, 6))
    assert rows[0]["tokens"] == 3500 + 1890
    assert economy.summary()["layers"]["core"]["meanMadeUsd"] == pytest.approx(
        round(call + judge, 6)
    )


# --- 12. the floor must never be the thing that crashes -----------------------------------


def test_a_degenerate_core_still_renders_rather_than_raising() -> None:
    """The floor is what a learner gets when the model missed, so it may not have a failure mode
    of its own. A core whose two misconceptions read alike collapses the multiple-choice options
    it builds items from, and an item whose options are not distinct is refused by the compose
    verifier — with no slack, the floor would raise and the learner would get nothing."""
    same = "it only works in one special case"
    degenerate = {
        "concept": "x",
        "shape": "relation",
        "idea": "one idea",
        "why": "one reason",
        "misconceptions": [
            {"belief": same, "counter": same},
            {"belief": same, "counter": same},
        ],
        "check": {"question": same, "answer": same},
        "vocabulary": [{"term": "a", "meaning": same}, {"term": "a", "meaning": same}],
    }
    artifact = engines._level_from_core({"core": degenerate}, "x", "core", CBSE_6)
    assert len(artifact["cards"]) >= 3
    assert len(artifact["workbook"]) == 3 and len(artifact["boss"]) == 3


def test_a_core_with_no_misconceptions_at_all_still_renders() -> None:
    """A hand-written or legacy core may carry less than the schema demands; the floor fills in
    from the idea rather than falling over."""
    artifact = engines._level_from_core({"core": {"idea": "an idea"}}, "x", "core", ISC_11)
    assert len(artifact["cards"]) >= 3


# --- 13. a refused core is worth one more sample before the old price ---------------------


def test_a_refused_core_is_sampled_once_more_before_falling_back(monkeypatch) -> None:
    """MEASURED, 2026-09-10, live on openai/gpt-5.6-sol: the SAME concept's core came back
    critical at 74 and 78 on two runs and clean at 94 on a third. The refusals are partly
    variance, and a refusal is expensive twice over — the concept loses its core AND every level
    under it pays a full generation. The owner's rule is one rung per rejection; the verify tier
    is already the top rung this wave may spend on, so the one rung available is a second sample
    at the same model. One retry, then the cooldown."""
    stub = Provider()
    scores = iter([44.0, 91.0])

    def judged(*_args: Any, **kwargs: Any) -> dict[str, Any]:
        meter = kwargs.get("meter")
        if meter is not None:
            meter.update({"costUsd": 0.02, "tokens": 1890, "model": "openai/gpt-5.6-sol"})
        return {"score": next(scores), "critical": False, "weak": [], "notes": "n"}

    monkeypatch.setattr("wobo_gateway.model_call.complete", stub)
    monkeypatch.setattr(validate, "judge_core", judged)
    artifact, model, _t, seeded = _render("equivalent fractions", CBSE_6)

    assert len(stub.of("core")) == 2, "the first was refused, the second was sampled"
    stored = store.load_core("equivalent fractions", CBSE_6)
    assert stored is not None and stored["provenance"]["judge"]["score"] == 91.0
    assert not seeded and model == "openai/gpt-5.6-luna"
    made = [r for r in economy.rows() if r["layer"] == "core" and not r["cached"]]
    assert len(made) == 2, "both attempts are in the ledger; the refusal was not free"
    assert made[0]["note"].startswith("refused")


def test_two_refusals_stop_rather_than_sampling_forever(monkeypatch) -> None:
    stub = Provider(core_score=30.0)
    monkeypatch.setattr("wobo_gateway.model_call.complete", stub)
    _render("equivalent fractions", CBSE_6)
    assert len(stub.of("core")) == 2, "two samples, then the cooldown, never a third"
    assert economy.summary()["layers"]["full"]["made"] == 1


def test_the_mix_says_how_it_was_decided(monkeypatch) -> None:
    """rule, model or floor. An operator reading the stores desk has to be able to tell a choice
    that cost nothing from one that cost a model call, or "the interaction is the cheapest layer"
    is unfalsifiable."""
    by_rule = validate.choose_interactions("equivalent fractions", core=GOOD_CORE)
    assert {m["by"] for m in by_rule} == {"rule"}

    def says_ordering(**kwargs: Any) -> Any:
        return _Response(json.dumps({"shape": "ordering"}), kwargs["model"], 40, 8)

    monkeypatch.setattr("wobo_gateway.model_call.complete", says_ordering)
    by_model = validate.choose_interactions("a thing no rule can place")
    assert {m["by"] for m in by_model} == {"model"}
    assert [m["kind"] for m in by_model] == list(validate._MIX_BY_SHAPE["ordering"])

    def unreachable(**_kwargs: Any) -> Any:
        raise RuntimeError("out")

    monkeypatch.setattr("wobo_gateway.model_call.complete", unreachable)
    by_floor = validate.choose_interactions("a thing no rule can place")
    assert {m["by"] for m in by_floor} == {"floor"}


def test_the_cache_migration_never_mistakes_a_core_for_an_artifact(cache_dir) -> None:
    """``store.migrate`` walks every directory under the cache and re-indexes what it finds. The
    cores live in one of those directories now, and a core re-indexed as if it were a compose
    artifact would be served to a learner as a lesson."""
    store.save_core(
        "equivalent fractions",
        {
            "concept": "equivalent fractions",
            "promptVersion": store.CORE_PROMPT_VERSION,
            "core": engines._verify_core(GOOD_CORE, "equivalent fractions"),
        },
        CBSE_6,
    )
    before = store.core_path("equivalent fractions", CBSE_6).read_bytes()
    assert store.migrate() == []
    assert store.core_path("equivalent fractions", CBSE_6).read_bytes() == before
    assert not (cache_dir / "compose").exists()


# --- 14. the depth band: one core per band that teaches the concept ------------------------
# docs/CONTENT-INTERACTION.md section 5b, decided 2026-09-11. The resolver is pure and offline: it
# reads the curriculum's class list for the concept from the registry the tests point it at, and
# no model, clock, network or database is anywhere near a cache key.


def test_a_class_is_read_into_its_band_and_a_span_across_a_boundary_is_not() -> None:
    """Foundation is classes 1 to 5, middle 6 to 8, senior 9 to 12 (section 5b), however a
    syllabus document writes the class."""
    assert store.band_of_class("4") == store.FOUNDATION
    assert store.band_of_class("Class 6") == store.MIDDLE
    assert store.band_of_class("class-8") == store.MIDDLE
    assert store.band_of_class("12") == store.SENIOR
    assert store.band_of_class("11-12") == store.SENIOR, "a span inside one band is that band"
    assert store.band_of_class("8-9") is None, "a span across the boundary is nobody's band"
    assert store.band_of_class("") is None and store.band_of_class("13") is None


def test_a_concept_taught_once_has_one_core_whichever_class_asks(depth_bands) -> None:
    """Section 5b's first case: "a concept taught only in class 9: one core", and it costs exactly
    what it costs today. A class 6 stretch module reaching for it gets the same core, because
    there is no second band to be honest about."""
    assert store.classes_for_concept(TAUGHT_ONCE) == ("Class 9",)
    assert store.bands_for_concept(TAUGHT_ONCE) == (store.SENIOR,)
    for grade in ("3", "6", "9", "12"):
        assert store.band_for(TAUGHT_ONCE, _at(grade)) == store.SENIOR
    assert store.band_for(TAUGHT_ONCE, None) == store.SENIOR


def test_fractions_taught_in_4_6_and_8_has_a_foundation_core_and_a_middle_core(depth_bands) -> None:
    """Section 5b's second case: "fractions, taught in 4, 6 and 8: two cores, foundation and
    middle, not three and not twelve". A class 9 learner reaching back for it gets the middle
    core, the nearest band that teaches it, and never a third core the syllabus does not teach."""
    assert store.bands_for_concept(FRACTIONS) == (store.FOUNDATION, store.MIDDLE)
    assert store.band_for(FRACTIONS, _at("4")) == store.FOUNDATION
    assert store.band_for(FRACTIONS, _at("6")) == store.MIDDLE
    assert store.band_for(FRACTIONS, _at("8", ISC_11)) == store.MIDDLE
    assert store.band_for(FRACTIONS, _at("9")) == store.MIDDLE, "no senior core is ever made"
    assert store.band_for(FRACTIONS, _at("12")) == store.MIDDLE
    assert store.band_for(FRACTIONS, {"board": "CBSE"}) == store.UNBANDED, "no class, no guess"
    assert {store.band_for(FRACTIONS, _at(g)) for g in map(str, range(1, 13))} == {
        store.FOUNDATION,
        store.MIDDLE,
    }


def test_electric_current_taught_in_7_10_and_12_has_a_middle_core_and_a_senior_core(
    depth_bands,
) -> None:
    """Section 5b's third case: "electric current, taught in 7 and in 10 and 12: two cores,
    middle and senior". A class 3 request is nearest to middle, and gets middle."""
    assert store.bands_for_concept(CURRENT) == (store.MIDDLE, store.SENIOR)
    assert store.band_for(CURRENT, _at("7")) == store.MIDDLE
    assert store.band_for(CURRENT, _at("10")) == store.SENIOR
    assert store.band_for(CURRENT, _at("12", ISC_11)) == store.SENIOR
    assert store.band_for(CURRENT, _at("3")) == store.MIDDLE
    assert store.band_for(CURRENT, _at("9")) == store.SENIOR


def test_the_nearest_band_is_the_shallower_one_on_a_tie_and_a_caller_may_bring_the_classes() -> (
    None
):
    """A middle learner reaching for a concept taught in foundation and senior only is one band
    from each; the shallower wins, because a core that under-reaches is met by the level
    rendering's own class and a core that over-reaches loses the learner in its first sentence.
    ``classes`` lets the curriculum publisher say which classes it knows, registry or not."""
    assert (
        store.nearest_taught_band(store.MIDDLE, (store.FOUNDATION, store.SENIOR))
        == store.FOUNDATION
    )
    assert store.nearest_taught_band(store.SENIOR, (store.FOUNDATION, store.MIDDLE)) == store.MIDDLE
    with pytest.raises(ValueError):
        store.nearest_taught_band(store.UNBANDED, (store.MIDDLE,))
    assert store.band_for("anything", _at("7"), classes=("Class 4", "Class 11")) == store.FOUNDATION
    assert store.band_for("anything", _at("7"), classes=("Class 11",)) == store.SENIOR
    # an uncatalogued concept is the class that asked, and unbanded when nothing asked
    assert store.band_for("a concept no board has seeded", _at("5")) == store.FOUNDATION
    assert store.band_for("a concept no board has seeded", None) == store.UNBANDED


def test_a_level_rendering_cannot_borrow_another_band_s_core(depth_bands) -> None:
    """Section 5b, what it forbids: "a level rendering may never be asked to carry a core from
    another band. The store enforces this: the core key carries the band, so borrowing is not
    expressible." Two locks. The key: a class 8 read cannot name the class 4 file. The stamp: a
    record that reached the middle key by any other route and says it is foundation is a miss,
    and a miss makes the band's own core rather than papering over the distance."""
    foundation = {
        "concept": FRACTIONS,
        "promptVersion": store.CORE_PROMPT_VERSION,
        "core": {"idea": "pieces of one whole"},
    }
    store.save_core(FRACTIONS, foundation, _at("4"))
    assert store.load_core(FRACTIONS, _at("4", ISC_11)) == {**foundation, "band": store.FOUNDATION}
    assert store.load_core(FRACTIONS, _at("8")) is None, "the middle band has no core yet"
    assert store.load_core(FRACTIONS, _at("6"), band=store.MIDDLE) is None
    assert store.core_path(FRACTIONS, _at("4")) != store.core_path(FRACTIONS, _at("8"))

    # the second lock: a foundation record planted at the middle key is refused on its stamp
    planted = {**foundation, "band": store.FOUNDATION}
    store.write_atomic(store.core_path(FRACTIONS, _at("8")), json.dumps(planted))
    assert store.load_core(FRACTIONS, _at("8")) is None
    assert store.core_is_of_band(planted, store.MIDDLE) is False
    assert store.core_is_of_band(planted, store.FOUNDATION) is True

    # and a band that is not a band is a coding mistake, not a key
    with pytest.raises(ValueError):
        store.core_path(FRACTIONS, _at("8"), band="class-8")
    with pytest.raises(ValueError):
        store.load_core(FRACTIONS, _at("8"), band="nearby")


def test_a_core_cannot_be_copied_across_a_band_by_saving_it_under_another_key(
    depth_bands,
) -> None:
    """Section 5b: borrowing must not be expressible. Reading the foundation core and saving it
    under the middle key would restamp it middle and make the neighbour's core look like this
    band's own. The store refuses the copy, so the middle band still misses and makes its own."""
    store.save_core(
        FRACTIONS,
        {"concept": FRACTIONS, "promptVersion": store.CORE_PROMPT_VERSION, "core": {}},
        _at("4"),
    )
    foundation = store.load_core(FRACTIONS, _at("4"))
    assert foundation is not None and foundation["band"] == store.FOUNDATION
    with pytest.raises(ValueError):
        store.save_core(FRACTIONS, foundation, _at("8"))
    with pytest.raises(ValueError):
        store.save_core(FRACTIONS, foundation, None, band=store.MIDDLE)
    with pytest.raises(ValueError):
        store.save_core_version(FRACTIONS, foundation, _at("8"))
    assert store.load_core(FRACTIONS, _at("8")) is None, "the middle band still makes its own"
    assert not store.core_versions_dir(FRACTIONS, _at("8")).exists()
    # saving it again under its own band is not a borrow
    store.save_core(FRACTIONS, foundation, _at("5"))
    store.save_core_version(FRACTIONS, foundation, _at("4"))


def test_a_class_cannot_name_another_band_s_core_by_passing_the_band_outright(
    depth_bands,
) -> None:
    """The explicit ``band`` argument is for a caller that has no class (a chapter page names its
    band from the class it is published under). A request that DOES carry a class is already
    placed by the resolver, and naming a different band beside it is the borrow section 5b
    forbids, so it is refused rather than served."""
    store.save_core(
        FRACTIONS,
        {"concept": FRACTIONS, "promptVersion": store.CORE_PROMPT_VERSION, "core": {}},
        _at("4"),
    )
    with pytest.raises(ValueError):
        store.load_core(FRACTIONS, _at("8"), band=store.FOUNDATION)
    with pytest.raises(ValueError):
        store.core_path(FRACTIONS, _at("8"), band=store.FOUNDATION)
    with pytest.raises(ValueError):
        store.core_key(FRACTIONS, _at("8"), band=store.FOUNDATION)
    with pytest.raises(ValueError):
        store.save_core(FRACTIONS, {"core": {}}, _at("8"), band=store.FOUNDATION)
    # agreeing with the resolver is fine
    assert store.load_core(FRACTIONS, _at("4"), band=store.FOUNDATION) is not None
    assert store.load_core(FRACTIONS, _at("9"), band=store.MIDDLE) is None


def test_a_caller_with_no_class_cannot_pick_a_band_of_a_concept_taught_in_two(
    depth_bands,
) -> None:
    """2026-09-17, the closer's run: leaving the class out and naming the band outright handed the
    foundation core of fractions to any caller at all. With no class, the resolver says fractions
    is UNBANDED (two bands teach it and nobody said which), so a named band is a guess, and a guess
    across a band is the borrow section 5b forbids. A concept taught in ONE band has nothing to
    borrow, so naming that band with no class is still fine."""
    store.save_core(
        FRACTIONS,
        {"concept": FRACTIONS, "promptVersion": store.CORE_PROMPT_VERSION, "core": {"i": "a"}},
        _at("4"),
    )
    for scope in ({"board": "CBSE"}, {"board": "CBSE", "subject": "Mathematics"}, None):
        with pytest.raises(ValueError):
            store.load_core(FRACTIONS, scope, band=store.FOUNDATION)
        with pytest.raises(ValueError):
            store.core_path(FRACTIONS, scope, band=store.MIDDLE)
        with pytest.raises(ValueError):
            store.save_core(FRACTIONS, {"core": {"i": "b"}}, scope, band=store.FOUNDATION)
    # the class, not the band, is how a caller reaches its core
    assert store.load_core(FRACTIONS, {"board": "CBSE", "grade": "Class 4"}) is not None
    # unbanded is what the resolver says here, so naming it is not a guess
    assert store.load_core(FRACTIONS, None, band=store.UNBANDED) is None


def test_an_unstamped_copy_of_another_band_s_core_cannot_be_saved(depth_bands) -> None:
    """2026-09-17, the closer's run: the stamp refusal only caught a record that still said
    'foundation'. Loading the foundation core, dropping its band key and saving it at class 8
    wrote the foundation text as the middle core. The store now compares what a core teaches with
    every other band's stored core of the same concept, live and versioned, and refuses a copy."""
    foundation = {
        "concept": FRACTIONS,
        "promptVersion": store.CORE_PROMPT_VERSION,
        "core": {"idea": "pieces of one whole", "check": "shade three of eight"},
    }
    store.save_core(FRACTIONS, foundation, _at("4"))
    store.save_core_version(FRACTIONS, foundation, _at("4"))
    loaded = store.load_core(FRACTIONS, _at("4"))
    assert loaded is not None
    unstamped = {k: v for k, v in loaded.items() if k != "band"}
    with pytest.raises(ValueError):
        store.save_core(FRACTIONS, unstamped, _at("8"))
    with pytest.raises(ValueError):
        store.save_core_version(FRACTIONS, unstamped, _at("8"))
    retimed = {**unstamped, "createdAt": "2026-09-17T00:00:00+00:00", "provenance": {}}
    with pytest.raises(ValueError):
        store.save_core(FRACTIONS, retimed, _at("8"))
    assert store.load_core(FRACTIONS, _at("8")) is None, "the middle band still makes its own"
    # a copy found only in the foundation band's versions is still a copy
    newer = {**foundation, "core": {"idea": "a newer foundation core"}}
    store.save_core(FRACTIONS, newer, _at("4"))
    with pytest.raises(ValueError):
        store.save_core(FRACTIONS, unstamped, _at("8"))
    # the band's own, different core is written, and its own record saves again under its band
    middle = {**foundation, "core": {"idea": "a fraction is a number on the line"}}
    store.save_core(FRACTIONS, middle, _at("8"))
    assert store.load_core(FRACTIONS, _at("8"))["core"] == middle["core"]
    store.save_core(FRACTIONS, unstamped, _at("5"))


def test_a_record_with_no_band_stamp_is_not_served(depth_bands) -> None:
    """Every write stamps the band, so a record at a band's path with no stamp was put there by
    hand, and nothing says which band it was written for. It is a miss, never a hit."""
    path = store.core_path(FRACTIONS, _at("8"))
    path.parent.mkdir(parents=True, exist_ok=True)
    unstamped = {"concept": FRACTIONS, "promptVersion": store.CORE_PROMPT_VERSION, "core": {"i": 1}}
    path.write_text(json.dumps(unstamped))
    assert store.load_core(FRACTIONS, _at("8")) is None
    assert not store.core_is_of_band({"core": {}}, store.MIDDLE)


def test_a_model_that_writes_one_core_for_two_bands_is_refused_and_the_level_still_renders(
    monkeypatch, depth_bands
) -> None:
    """The store refuses a core that teaches word for word what another band's core teaches. A
    model that ignores the band it was told is exactly that, and the refusal must not take the
    learner's level down with it: the middle core is not stored, and the level renders whole."""
    stub = Provider(one_core=True)
    monkeypatch.setattr("wobo_gateway.model_call.complete", stub)
    _render(FRACTIONS, _at("4"))
    _render(FRACTIONS, _at("8"))  # raised ValueError out of the render before the guard
    assert economy.summary()["layers"]["full"]["made"] == 1, "the class 8 lesson is still made"
    assert store.load_core(FRACTIONS, _at("4")) is not None
    assert store.load_core(FRACTIONS, _at("8")) is None, "the copy was not stored"
    assert not store.core_versions_dir(FRACTIONS, _at("8")).exists()


def test_a_concept_taught_in_two_bands_never_pays_for_a_third_core(
    provider, depth_bands, tmp_path
) -> None:
    """Section 5b's count: "a concept gets one core per band that actually teaches it". Fractions
    is taught in two bands. A request with no class, or with a class written as a span across the
    boundary ('5-6'), resolves to UNBANDED, and UNBANDED used to be a third key that core_for paid
    for (the closer's run, 2026-09-17). Those requests now render whole, with no core bought and
    none stored, so the concept owns exactly two cores however it is asked for."""
    mathematics = {"board": "CBSE", "subject": "Mathematics", "chapter": "Fractions"}
    for scope in (
        _at("5"),
        _at("6"),
        _at("9"),
        {**mathematics, "grade": "5-6"},
        {**mathematics, "grade": "Class 5 and 6"},
        mathematics,
    ):
        _render(FRACTIONS, scope)
    bands = [json.loads(c["user"])["band"] for c in provider.of("core")]
    assert bands == [store.FOUNDATION, store.MIDDLE], bands
    stored = sorted(p.name.split("--")[1] for p in (tmp_path / store.CORE_MODALITY).glob("*.json"))
    assert stored == [store.FOUNDATION, store.MIDDLE]
    assert engines.core_for(FRACTIONS, mathematics) is None
    assert len(provider.of("core")) == 2
    with pytest.raises(ValueError):
        store.save_core(FRACTIONS, {"core": {"i": "c"}}, mathematics)
    with pytest.raises(ValueError):
        store.save_core_version(FRACTIONS, {"core": {"i": "c"}}, None, band=store.UNBANDED)


def test_a_miss_in_a_band_with_no_core_makes_that_band_s_core(provider, depth_bands) -> None:
    """Section 5b: "a cache miss for a band with no core yet makes that band's core; it does not
    borrow the neighbour's". Fractions at class 4 buys the foundation core; class 8 then buys the
    middle one rather than reading the foundation file, and class 6 reads the middle one."""
    _render(FRACTIONS, _at("4"))
    _render(FRACTIONS, _at("8", ISC_11))
    _render(FRACTIONS, _at("6"))
    assert [json.loads(c["user"])["band"] for c in provider.of("core")] == [
        store.FOUNDATION,
        store.MIDDLE,
    ]
    assert store.load_core(FRACTIONS, _at("4"))["band"] == store.FOUNDATION
    assert store.load_core(FRACTIONS, _at("6"))["band"] == store.MIDDLE
    rows = [r for r in economy.rows() if r["layer"] == "core"]
    assert [(r["band"], r["cached"]) for r in rows] == [
        (store.FOUNDATION, False),
        (store.MIDDLE, False),
        (store.MIDDLE, True),
    ]


def test_a_refusal_is_remembered_per_band_not_per_concept(monkeypatch, depth_bands) -> None:
    """A middle core that came back critical must not silence the senior core of the same
    concept: the cooldown is one per concept per band, so the senior level still gets its own
    sample rather than paying a full generation for a core nobody tried to make."""
    stub = Provider(core_score=30.0)
    monkeypatch.setattr("wobo_gateway.model_call.complete", stub)
    _render(CURRENT, _at("7"))
    assert len(stub.of("core")) == engines.CORE_SAMPLES, "the middle band's samples, then silence"
    _render(CURRENT, _at("8"))
    assert len(stub.of("core")) == engines.CORE_SAMPLES, "class 8 is the same band, and waits"
    _render(CURRENT, _at("10"))
    assert len(stub.of("core")) == 2 * engines.CORE_SAMPLES, "the senior band is tried on its own"


def test_the_blueprint_asks_for_the_band_s_core(depth_bands) -> None:
    """Section 5b, where it lives in code: "plexus/blueprint.py asks for the band's core". A
    module lives in the chapter's pool, and the pool is made once per chapter, board, class and
    syllabus version (docs/LEARNING-MODEL.md section 4), so the class the pool was made for is
    what resolves each core's band; the brief names it beside the cores it asks for."""
    from blueprint_fixture import blueprint as good_blueprint
    from blueprint_fixture import brief as good_brief
    from wobo_gateway.plexus import blueprint as bp

    parsed = bp.parse(good_blueprint())
    assert parsed is not None
    cell = bp.NodeBrief.from_dict(good_brief())
    module_ = parsed.module_by_id("r2")
    assert module_ is not None
    payload = bp.compose_brief(parsed, module_, cell)
    assert payload["cores"] == ["pressure"]
    assert payload["coreBands"] == {"pressure": store.band_for("pressure", cell.scope())}
    assert payload["coreBands"]["pressure"] == store.MIDDLE, "the pool is a class 8 pool"
    # and the compose engine resolves the same band from the same coordinate, so the two agree
    assert (
        store.band_for(
            "pressure", {k: str(v) for k, v in payload.items() if k in ("board", "grade")}
        )
        == store.MIDDLE
    )
