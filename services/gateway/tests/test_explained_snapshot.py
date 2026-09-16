"""TIER TWO OF THE CHAPTER FAMILY: what may be frozen onto a public chapter page, and what may not.

Tier one is live: the chapter, its topics, its provenance and the tutor door
(docs/GROWTH-SEARCH.md §4). Tier two adds the thing no competitor in this market ships on a
chapter page at all: the concept's own explanation, an original figure drawn for that concept,
and three questions taken from the concept's own misconceptions (§6).

:mod:`wobo_gateway.curriculum.explained` is what freezes those, from the SAME cache a learner's
lesson is rendered from, into a committed file the website is built from. This file is the gate
around it, and every test in here is a way the family could quietly stop being worth publishing:

  · a chapter with no core in the cache must stay at tier one, silently;
  · the seeded figure (two circles labelled "idea" and "effect", identical for every concept in
    the catalogue) must never reach a page, because 171 pages carrying one picture is the thin
    page the whole plan is written to avoid;
  · a core written for another depth band must never be shown to this class's reader
    (docs/CONTENT-INTERACTION.md §5b);
  · nothing may be invented: the topic a page explains is one the board itself published, and on
    ICSE and ISC, which give us a unit and nothing under it, there is no topic and so no tier two.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from wobo_gateway.curriculum import explained, public, snapshot
from wobo_gateway.plexus import store


@pytest.fixture(autouse=True)
def _fresh_tree() -> None:
    public.reset()


# --- a core and a figure, as the cache holds them -------------------------------------------------


def _core(**over: Any) -> dict[str, Any]:
    record = {
        "concept": "Refraction of light",
        "band": "senior",
        "shape": "process",
        "idea": (
            "Light changes direction when it passes from one material into another because its "
            "speed changes. The bend is towards the normal going into a denser material and away "
            "from it coming out."
        ),
        "why": "It is why a straw looks broken in a glass of water and why a lens can focus.",
        "misconceptions": [
            {
                "belief": "light always bends when it crosses a surface",
                "counter": (
                    "Light that arrives along the normal carries straight on with no bend at all."
                ),
            },
            {
                "belief": "the light slows down because the glass is heavier",
                "counter": "Speed follows the optical density of the material, not its mass.",
            },
        ],
        "check": {
            "question": "Which way does a ray bend going from air into glass?",
            "answer": "Towards the normal, because it slows down.",
        },
        "vocabulary": [
            {"term": "normal", "meaning": "the line at right angles to the surface"},
            {"term": "refraction", "meaning": "the change of direction as light changes speed"},
        ],
        "status": store.CANONICAL,
        "promptVersion": store.CORE_PROMPT_VERSION,
        "provenance": {"model": "openai/gpt-5.6-sol", "judge": {"score": 88}},
    }
    record.update(over)
    return record


REAL_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">'
    '<line x1="40" y1="150" x2="360" y2="150" stroke="#111" stroke-width="1.5" />'
    '<text x="52" y="70" font-size="13" fill="#111">Air</text>'
    '<text x="52" y="185" font-size="13" fill="#111">Glass</text>'
    "</svg>"
)

SEED_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">'
    '<circle cx="92" cy="106" r="34" fill="none" stroke="#111" />'
    '<text x="92" y="110">idea</text>'
    '<circle cx="234" cy="106" r="34" fill="none" stroke="#111" />'
    '<text x="234" y="110">effect</text>'
    "</svg>"
)


def _figure(**over: Any) -> dict[str, Any]:
    record = {
        "concept": "Refraction of light",
        "modality": "diagram",
        "difficulty": "core",
        "verified": True,
        "seeded": False,
        "artifact": REAL_SVG,
        "provenance": {"model": "anthropic/claude-opus-4-8", "engine": "engine.diagram"},
    }
    record.update(over)
    return record


# --- the depth band ------------------------------------------------------------------------------


def test_the_band_is_read_from_the_class_and_never_guessed() -> None:
    assert explained.band_of("Class 4") == "foundation"
    assert explained.band_of("Class 5") == "foundation"
    assert explained.band_of("Class 6") == "middle"
    assert explained.band_of("Class 8") == "middle"
    assert explained.band_of("Class 9") == "senior"
    assert explained.band_of("Class 12") == "senior"
    # A level with no number in it has no band, and a page with no band asks for no core.
    assert explained.band_of("Foundation") is None


# --- the three questions -------------------------------------------------------------------------


def test_three_questions_come_off_the_core_and_add_nothing_to_it() -> None:
    asked = explained.questions(_core())
    assert asked is not None
    assert len(asked) == 3
    # The core's own check, first, word for word.
    assert asked[0]["q"] == "Which way does a ray bend going from air into glass?"
    assert asked[0]["a"] == "Towards the normal, because it slows down."
    # Then one per misconception, each answered by its own counter-example, word for word.
    assert asked[1]["q"] == "Is it true that light always bends when it crosses a surface?"
    assert asked[1]["a"] == _core()["misconceptions"][0]["counter"]
    assert asked[2]["a"] == _core()["misconceptions"][1]["counter"]


def test_a_core_with_one_misconception_yields_no_questions_at_all() -> None:
    """Two is the schema's own floor (`engines._verify_core`). One is a core that was not what it
    claims to be, and half a set of questions is worse than none."""
    thin = _core(misconceptions=[_core()["misconceptions"][0]])
    assert explained.questions(thin) is None


# --- the figure ----------------------------------------------------------------------------------


def test_the_figure_keeps_its_own_size_and_is_named_by_the_board_s_word() -> None:
    figure = explained.figure_of(_figure(), concept="refraction-of-light", name="Refraction")
    assert figure is not None
    assert figure["width"] == 400
    assert figure["height"] == 300
    assert figure["alt"] == "Refraction"
    assert figure["file"].endswith(".svg")
    assert figure["svg"].startswith("<svg")


def test_the_seeded_figure_never_reaches_a_page() -> None:
    """The seed is two circles labelled "idea" and "effect" and it is the SAME picture for every
    concept in the catalogue. One picture on 171 pages is the thin page this family exists to
    avoid, and it is also a lie about having drawn something for the concept."""
    assert (
        explained.figure_of(_figure(seeded=True, artifact=SEED_SVG), concept="c", name="C") is None
    )


def test_a_figure_nobody_drew_never_reaches_a_page() -> None:
    mock = _figure(provenance={"model": "mock", "engine": "engine.diagram"})
    assert explained.figure_of(mock, concept="c", name="C") is None


def test_a_figure_that_does_not_sanitize_never_reaches_a_page() -> None:
    unsafe = _figure(artifact='<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
    assert explained.figure_of(unsafe, concept="c", name="C") is None


# --- the gate ------------------------------------------------------------------------------------


def test_a_topic_with_a_core_and_a_figure_passes() -> None:
    assert explained.refusals(_core(), _figure(), band="senior") == []


def test_a_topic_with_no_core_is_refused_quietly() -> None:
    assert explained.refusals(None, _figure(), band="senior") == ["no_core"]


def test_a_core_from_another_band_is_refused() -> None:
    """docs/CONTENT-INTERACTION.md §5b: a class 11 treatment of an idea loses the class 7 child
    inside its first sentence. A page whose reader is in one band may not be handed the other
    band's core, and a core that does not say which band it was written for is not known to be
    written for this one."""
    assert explained.refusals(_core(band="middle"), _figure(), band="senior") == ["other_band"]
    assert explained.refusals(_core(band=None), _figure(), band="senior") == ["no_band"]


def test_a_held_core_is_refused() -> None:
    assert "not_canonical" in explained.refusals(_core(status="held"), _figure(), band="senior")


def test_a_core_under_the_judge_s_bar_is_refused() -> None:
    low = _core(provenance={"model": "m", "judge": {"score": explained.JUDGE_FLOOR - 1}})
    assert "below_the_bar" in explained.refusals(low, _figure(), band="senior")
    unjudged = _core(provenance={"model": "m"})
    assert "unjudged" in explained.refusals(unjudged, _figure(), band="senior")


def test_an_em_dash_anywhere_in_the_core_is_refused() -> None:
    """docs/copy/voice.md §3: nothing a person reads carries one, and every word of a core that
    passes this gate is read by a person on a public page."""
    dashed = _core(idea="Light bends — or it does not.")
    assert "em_dash" in explained.refusals(dashed, _figure(), band="senior")


def test_a_stale_core_is_refused() -> None:
    stale = _core(promptVersion="core-v0")
    assert "stale" in explained.refusals(stale, _figure(), band="senior")


def test_a_topic_with_no_figure_is_refused() -> None:
    assert explained.refusals(_core(), None, band="senior") == ["no_figure"]


# --- the file -------------------------------------------------------------------------------------


def test_the_committed_file_is_shaped_the_way_the_website_reads_it() -> None:
    path = explained.DEFAULT_OUT
    assert path.exists(), f"the website's tier two file is missing: {path}"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["shape"] == explained.SHAPE
    assert isinstance(data["chapters"], list)
    for entry in data["chapters"]:
        for key in (
            "path",
            "topic",
            "name",
            "concept",
            "band",
            "idea",
            "why",
            "questions",
            "figure",
        ):
            assert key in entry, f"{entry.get('path')} is missing {key}"
        assert len(entry["questions"]) == 3


def test_every_figure_the_file_promises_is_a_file_on_disk() -> None:
    """The same discipline the sitemap and the pre-renderer live under: a page may not promise
    something the build did not write. A named figure with no file is a broken image on the one
    page family that exists to carry one."""
    data = json.loads(explained.DEFAULT_OUT.read_text(encoding="utf-8"))
    for entry in data["chapters"]:
        figure = explained.FIGURES_DIR / entry["figure"]["file"]
        assert figure.exists(), f"{entry['path']} names a figure that was never written: {figure}"


def test_every_chapter_named_is_a_chapter_the_board_published() -> None:
    """Nothing invented, in the one direction it could be: a tier two entry pointing at an address
    the syllabus does not hold would publish an explanation of a chapter nobody set."""
    data = json.loads(explained.DEFAULT_OUT.read_text(encoding="utf-8"))
    if not data["chapters"]:
        pytest.skip("no chapter carries a core yet; tier one is the whole family today")
    addresses = set()
    for board in json.loads(snapshot.DEFAULT_OUT.read_text(encoding="utf-8"))["boards"]:
        for level in board.get("classes") or []:
            for subject in level.get("subjects") or []:
                for chapter in subject.get("chapters") or []:
                    address = "/learn/" + "/".join(
                        n["slug"] for n in (board, level, subject, chapter)
                    )
                    addresses.add((address, tuple(t["slug"] for t in chapter.get("topics") or [])))
    held = dict(addresses)
    for entry in data["chapters"]:
        assert entry["path"] in held, f"{entry['path']} is not an address the syllabus holds"
        assert entry["topic"] in held[entry["path"]], (
            f"{entry['path']} explains {entry['topic']}, which its board did not publish under it"
        )


def test_a_chapter_appears_at_most_once() -> None:
    data = json.loads(explained.DEFAULT_OUT.read_text(encoding="utf-8"))
    paths = [entry["path"] for entry in data["chapters"]]
    assert len(paths) == len(set(paths))


def test_no_two_chapters_share_a_figure() -> None:
    data = json.loads(explained.DEFAULT_OUT.read_text(encoding="utf-8"))
    files = [entry["figure"]["file"] for entry in data["chapters"]]
    assert len(files) == len(set(files))


# --- the pace -------------------------------------------------------------------------------------


def test_a_run_publishes_at_most_the_limit_and_never_unpublishes(tmp_path: Path) -> None:
    """The measured pace, as a mechanism rather than an intention (docs/GROWTH-SEARCH.md §4).

    A run adds at most :data:`explained.LIMIT` chapters to what is already published, and never
    removes one: a page that is live and being read does not vanish because a cache was cleared on
    the machine somebody happened to run the command on."""
    standing = [
        {
            "path": "/learn/cbse/class-10/science/light",
            "topic": "refraction",
            "name": "Refraction",
            "concept": "refraction",
            "band": "senior",
            "idea": "x",
            "why": "y",
            "questions": [{"q": "a", "a": "b"}] * 3,
            "figure": {"file": "refraction.svg", "width": 400, "height": 300, "alt": "Refraction"},
        }
    ]
    fresh = [
        dict(
            standing[0],
            path=f"/learn/cbse/class-10/science/c{n}",
            concept=f"c{n}",
            figure=dict(standing[0]["figure"], file=f"c{n}.svg"),
        )
        for n in range(10)
    ]
    out = explained.merge(standing, fresh, limit=3)
    assert len(out) == 4
    assert out[0]["path"] == standing[0]["path"]


# --- end to end, on a real address ---------------------------------------------------------------


def _a_real_chapter() -> tuple[Any, Any, Any, Any]:
    """The first CBSE chapter in the published tree that has topics under it."""
    tree = public.build_tree()
    for board in tree.boards:
        for level in board.children:
            if explained.band_of(level.name) is None:
                continue
            for subject in level.children:
                for chapter in subject.children:
                    if explained.has_page(chapter):
                        return board, level, subject, chapter
    raise AssertionError("the published tree holds no chapter the site writes a page for")


def test_a_planted_core_and_figure_light_up_one_real_chapter_page(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole path, on an address the board actually published: a core and a figure in the
    cache become one entry naming that chapter, that topic, and a figure with its own size.

    This is the test that would catch the family going dark for a reason nobody notices: a key
    that stopped matching, a scope that stopped resolving, a figure that stopped sanitizing. Every
    other test in this file proves a refusal; this one proves the pass.
    """
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    board, level, subject, chapter = _a_real_chapter()
    topic = chapter.children[0]
    band = explained.band_of(level.name)
    scope = {"subject": subject.name, "chapter": chapter.name}
    # The core key is concept x band (docs/CONTENT-INTERACTION.md §5b) and the band is the store's
    # own argument, not a scope key: the page's class names it, exactly as the module does.
    store.save_core(topic.name, _core(band=band, concept=topic.name), scope, band=band)
    store.save(topic.name, "diagram", "core", _figure(concept=topic.name), scope)

    found, why = explained.candidates()
    mine = [entry for entry in found if entry["topic"] == topic.slug]
    assert len(mine) == 1, f"the planted core lit up {len(mine)} pages, not one"
    entry = mine[0]
    assert entry["path"] == f"/learn/{board.slug}/{level.slug}/{subject.slug}/{chapter.slug}"
    assert entry["name"] == topic.name
    assert entry["band"] == band
    assert entry["figure"]["width"] == 400 and entry["figure"]["height"] == 300
    assert entry["figure"]["alt"] == topic.name
    assert len(entry["questions"]) == 3
    assert entry["svg"].startswith("<svg")
    # Everything else stayed at tier one rather than borrowing what was planted here.
    assert why["no_core"] >= 1


def _chapter(board: str, level: str, subject: str, chapter: str) -> tuple[Any, ...]:
    tree = public.build_tree()
    for b in tree.boards:
        for lv in b.children:
            for sj in lv.children:
                for ch in sj.children:
                    if (b.slug, lv.slug, sj.slug, ch.slug) == (board, level, subject, chapter):
                        return b, lv, sj, ch
    raise AssertionError(f"no chapter {board}/{level}/{subject}/{chapter}")


def test_a_chapter_the_site_does_not_publish_gets_no_tier_two(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """2026-09-17: the site refuses a chapter whose only topic is its own name, so the freezer
    must not spend a run's allowance explaining a page nobody can reach."""
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    _, level, subject, chapter = _chapter("cbse", "class-9", "mathematics", "number-system")
    assert not explained.has_page(chapter)
    topic = chapter.children[0]
    band = explained.band_of(level.name)
    scope = {"subject": subject.name, "chapter": chapter.name}
    store.save_core(topic.name, _core(band=band, concept=topic.name), scope, band=band)
    store.save(topic.name, "diagram", "core", _figure(concept=topic.name), scope)
    found, why = explained.candidates()
    assert not [e for e in found if e["path"].endswith("/class-9/mathematics/number-system")]
    assert why["too_few_topics"] >= 1


def test_the_freezer_and_the_site_agree_on_which_chapters_have_a_page() -> None:
    """The same floors as ``apps/web-pwa/src/screens/syllabus/tree.ts`` (``hasPage``), which the
    web suite pins at 86 chapter pages."""
    tree = public.build_tree()
    pages = [
        ch
        for b in tree.boards
        for lv in b.children
        for sj in lv.children
        for ch in sj.children
        if ch.source and ch.source.get("url") and explained.has_page(ch)
    ]
    assert len(pages) == 86
    assert explained.OWN_TOPIC_FLOOR == 3 and explained.OWN_WORD_FLOOR == 15


def test_the_pace_holds_on_a_real_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Two chapters ready, a limit of one: one ships, and the figure written is the one that did."""
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path / "cache"))
    tree = public.build_tree()
    planted = 0
    for board in tree.boards:
        for level in board.children:
            band = explained.band_of(level.name)
            if band is None:
                continue
            for subject in level.children:
                for chapter in subject.children:
                    if not explained.has_page(chapter) or planted >= 2:
                        continue
                    topic = chapter.children[0]
                    scope = {"subject": subject.name, "chapter": chapter.name}
                    store.save_core(
                        topic.name, _core(band=band, concept=topic.name), scope, band=band
                    )
                    store.save(topic.name, "diagram", "core", _figure(concept=topic.name), scope)
                    planted += 1
    assert planted == 2

    out = tmp_path / "explained.json"
    art = tmp_path / "figures"
    path, kept, _ = explained.write(out, art, limit=1)
    assert len(kept) == 1
    written = list(art.glob("*.svg"))
    assert len(written) == 1
    assert written[0].name == kept[0]["figure"]["file"]
    # The file the website reads carries no SVG at all: a visitor's bundle must not pay for the
    # bytes of a picture that is already a file at its own address.
    body = json.loads(path.read_text(encoding="utf-8"))
    assert "svg" not in body["chapters"][0]

    # A second run adds the other one and keeps the first.
    _, again, _ = explained.write(out, art, limit=1)
    assert len(again) == 2
    assert again[0]["path"] == kept[0]["path"]
