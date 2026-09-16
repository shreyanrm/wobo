"""MAKE's gate and the five shapes of one piece (docs/GROWTH-DESK.md sections 3 and 4.2)."""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import date

from growth_world import good_piece
from wobo_gateway.growth import campaigns, piece, shapes
from wobo_gateway.growth.piece import Section

DAY = date(2026, 9, 16)


def test_the_world_piece_clears_the_gate() -> None:
    verdict = piece.check(good_piece())
    assert verdict.publishable, verdict.because


def test_no_figure_no_piece() -> None:
    verdict = piece.check(good_piece(figure=None))
    assert not verdict.publishable
    assert any("drawn figure" in b for b in verdict.because)
    unverified = replace(good_piece().figure, verified=False)  # type: ignore[type-var]
    assert not piece.check(good_piece(figure=unverified)).publishable


def test_a_thin_page_is_refused_with_every_reason() -> None:
    thin = good_piece(lead="Probability.", sections=[Section("Idea", "Short.")], provenance=[])
    because = piece.check(thin).because
    assert len(because) >= 4
    assert any("sections" in b for b in because)
    assert any("provenance" in b for b in because)


def test_a_second_address_for_one_idea_is_refused() -> None:
    first = good_piece("work-and-energy")
    out = (piece.Published(slug=first.slug, fingerprints=first.fingerprints()),)
    second = good_piece("work-energy-and-power")
    because = piece.check(second, published=out).because
    assert any("second address" in b for b in because)
    assert any("paragraph" in b for b in because)


def test_generated_copy_is_screened_in_the_gate() -> None:
    loud = good_piece(lead="Probability is easy and this page will improve your marks, guaranteed!")
    assert not piece.check(loud).publishable


def test_five_shapes_on_their_channels_each_with_its_own_campaign() -> None:
    built = shapes.posts_for(good_piece(), when=DAY)
    assert built.owed == {}
    kinds = {p.kind for p in built.posts}
    assert kinds == set(shapes.KINDS)
    ids = [p.campaign_id for p in built.posts]
    assert len(ids) == len(set(ids))
    for post in built.posts:
        parsed = campaigns.parse(post.campaign_id)
        assert parsed.channel == post.channel
        assert parsed.slug == "probability"
        assert parsed.month == "202609"
        if post.channel != "blog":
            assert post.link.endswith(f"?utm_id={post.campaign_id}")
            assert post.canonical == "https://heywobo.com/blog/probability"


def test_the_origin_comes_first_and_is_a_file_the_blog_compiler_reads() -> None:
    built = shapes.posts_for(good_piece(), when=DAY)
    origin = built.posts[0]
    assert origin.channel == "blog" and origin.link == ""
    text = origin.units[0]
    assert text.startswith("---\ntitle: ")
    for field in (
        "summary:",
        "published: 2026-09-16",
        "author: teaching-desk",
        "tags:",
        "ai-assisted: true",
    ):
        assert f"\n{field}" in text, field
    assert "\n**Probability is the number" in text
    assert text.count("\n## ") >= 4
    assert "## Where this comes from" in text
    assert "https://ncert.nic.in/textbook/pdf/jemh114.pdf" in text
    assert "—" not in text


def test_x_keeps_the_link_for_the_last_reply() -> None:
    built = shapes.posts_for(good_piece(), when=DAY)
    for post in built.posts:
        if post.kind != shapes.THREAD:
            continue
        assert len(post.units) >= 3
        for unit in post.units[:-1]:
            assert not re.search(r"https?://|heywobo\.com", unit), (post.channel, unit)
            assert len(unit) <= shapes.THREAD_UNIT_MAX
        assert post.link in post.units[-1]
        assert len(post.units[-1]) <= shapes.THREAD_UNIT_MAX


def test_medium_points_home_and_says_how_it_was_written() -> None:
    (medium,) = [p for p in shapes.posts_for(good_piece(), when=DAY).posts if p.channel == "medium"]
    text = medium.units[0]
    assert "https://heywobo.com/blog/probability" in text
    assert shapes.ASSISTANCE_NOTE in text
    assert medium.canonical == "https://heywobo.com/blog/probability"


def test_the_assistance_note_is_the_blogs_own_words() -> None:
    from pathlib import Path

    readme = (Path(__file__).resolve().parents[3] / "docs/copy/blog/README.md").read_text()
    assert shapes.ASSISTANCE_NOTE in " ".join(readme.split())


def test_no_film_means_the_short_is_owed_and_the_rest_still_build() -> None:
    built = shapes.posts_for(good_piece(film=None), when=DAY)
    assert shapes.SHORT not in {p.kind for p in built.posts}
    assert {"short on youtube", "short on instagram", "short on facebook"} <= set(built.owed)
    assert all("film" in reason for key, reason in built.owed.items() if key.startswith("short"))
    assert {p.kind for p in built.posts} == set(shapes.KINDS) - {shapes.SHORT}


def test_a_shape_that_fails_the_screen_is_owed_not_posted() -> None:
    from wobo_gateway.growth.piece import Film

    loud = Film(concept="p", seconds=30, script="Roll it now!", asset_id="a")
    built = shapes.posts_for(good_piece(film=loud), when=DAY)
    assert "exclamation" in built.owed["short on youtube"]


def test_only_limits_the_channels() -> None:
    built = shapes.posts_for(good_piece(), when=DAY, only=("blog", "telegram"))
    assert {p.channel for p in built.posts} == {"blog", "telegram"}
