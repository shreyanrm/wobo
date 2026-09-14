"""The five nudges as TEMPLATES (docs/EMAILS-AND-ANIMATIONS.md §1, §6; docs/MAIL-PRIMARY.md).

Every law that can be read off a rendered mail is read off it here: the shape (a headline of two
to four words, one line, one button, one link, no image), the register (no promotional
vocabulary, no exclamation mark, no emoji, no em dash, no percent, no ALL CAPS, no "there"), the
parent's register for an under-13, the one-click stop headers, and the dark client.

Nothing here sends. The jobs and their clocks are `test_mail_nudge_jobs.py`.
"""

from __future__ import annotations

import re
from typing import Any

import pytest
from wobo_gateway.email_templates import (
    NUDGE_KINDS,
    ORB_MOVES,
    PROMOTIONAL_WORDS,
    TEMPLATES,
    promotional_problems,
    render,
    text_of,
)

SAMPLE: dict[str, dict[str, Any]] = {
    "quick_one": {"name": "Learner", "chapter": "Fractions, part two", "minutes": 5},
    "mid_chapter": {"name": "Learner", "chapter": "Linear equations", "cards_left": 2},
    "streak": {"name": "Learner", "days": 7},
    "bonus_level": {"name": "Learner", "between": "Motion and Force"},
    "doubt": {"name": "Learner", "chapter": "Refraction"},
}


def rendered(kind: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return render(kind, {**SAMPLE[kind], **(extra or {})})


# --- the family exists ---------------------------------------------------------------------
def test_the_five_kinds_are_registered_with_a_move_each() -> None:
    assert NUDGE_KINDS == ("quick_one", "mid_chapter", "streak", "bonus_level", "doubt")
    for kind in NUDGE_KINDS:
        assert kind in TEMPLATES
        # §8: every mail carries one move, from the library, named by the template itself.
        assert ORB_MOVES[kind] in {"hover", "wave", "bounce", "spark", "thinking", "reading"}


@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_it_renders_with_nothing_at_all(kind: str) -> None:
    out = render(kind, {})
    assert out["subject"] and out["html"].startswith("<!DOCTYPE html>") and out["text"]


# --- the Brilliant shape --------------------------------------------------------------------
@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_the_headline_is_two_to_four_words_and_the_line_is_one(kind: str) -> None:
    out = rendered(kind)
    head, line = out["headline"], out["line"]
    assert 2 <= len(head.split()) <= 4, head
    assert head.endswith(".")
    assert line.count(".") <= 2 and "\n" not in line


@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_one_button_one_link_no_image(kind: str) -> None:
    html = rendered(kind)["html"]
    assert "<img" not in html
    # The button, the two switches, privacy: the footer's links are below the hairline and are
    # the only extra ones. Above the hairline there is exactly one link.
    above = html.split("<!--hairline-->")[0]
    assert above.count("<a ") == 1


@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_under_120_words_and_over_500_characters(kind: str) -> None:
    text = text_of(rendered(kind))
    assert len(text.split()) < 120, text
    # docs/MAIL-PRIMARY.md §3: the one structural threshold with data behind it is a FLOOR.
    assert len(text) > 500


# --- the register ----------------------------------------------------------------------------
@pytest.mark.parametrize("kind", sorted(TEMPLATES))
def test_no_template_and_no_subject_talks_like_a_promotion(kind: str) -> None:
    out = render(kind, SAMPLE.get(kind, {"name": "Learner", "learner_name": "Learner"}))
    assert promotional_problems(out, kind) == []


def test_the_scan_catches_what_it_is_for() -> None:
    assert "unlock" in PROMOTIONAL_WORDS and "free" in PROMOTIONAL_WORDS
    bad = {"subject": "Learner, unlock 50% off", "html": "<p>Hurry</p>", "text": "Hurry"}
    assert promotional_problems(bad)


@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_it_never_narrates_and_never_says_there(kind: str) -> None:
    out = rendered(kind, {"name": ""})
    blob = f"{out['subject']}\n{text_of(out)}".lower()
    for narration in ("we noticed", "we miss you", "just checking in", "your ai", "it looks like"):
        assert narration not in blob
    assert not re.search(r"\b(hi|hello|hey) there\b", blob)
    assert " there," not in blob


@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_the_subject_is_the_name_and_a_verb_and_the_line_is_only_this_learners(kind: str) -> None:
    out = rendered(kind)
    assert out["subject"].startswith("Learner, ")
    # The first body line carries the thing only this learner would recognise.
    first = out["line"]
    assert any(
        str(token) in first
        for token in (
            "Fractions, part two", "Linear equations", "Seven", "Motion and Force", "Refraction"
        )
    ), first


@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_without_a_name_the_sentence_is_rewritten_not_filled(kind: str) -> None:
    out = rendered(kind, {"name": ""})
    assert "," not in out["subject"].split(" ")[0]
    assert out["subject"][0].isupper()


# --- the way out -----------------------------------------------------------------------------
@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_one_click_unsubscribe_only_when_the_target_can_keep_the_promise(kind: str) -> None:
    plain = render(kind, SAMPLE[kind])
    assert "List-Unsubscribe" in plain["headers"]
    assert "List-Unsubscribe-Post" not in plain["headers"]

    tokened = rendered(kind, {"unsubscribe_url": "https://api.heywobo.com/v1/mail/stop?token=abc"})
    assert tokened["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert "token=abc" in tokened["headers"]["List-Unsubscribe"]
    assert "token=abc" in tokened["html"]


@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_the_footer_says_why_it_came_and_carries_the_address(kind: str) -> None:
    out = rendered(kind)
    text = text_of(out)
    assert "Dot eVentures" in text
    assert "You get this" in text or "You are getting this" in text


# --- the parent's register (under 13) ---------------------------------------------------------
@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_under_thirteen_it_is_written_to_the_parent_about_the_child(kind: str) -> None:
    out = rendered(kind, {"audience": "parent", "learner_name": "Learner", "name": ""})
    blob = text_of(out)
    assert "Learner" in blob
    # Nothing addresses the child directly in the parent's copy, and no kinship word is used.
    assert not re.search(r"\byou (are|were|left|have)\b", blob.lower())
    for kinship in ("mum", "mom", "dad", "papa", "mummy", "beta"):
        assert kinship not in blob.lower()
    assert out["subject"].startswith("Learner ")


# --- the dark client ---------------------------------------------------------------------------
@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_it_tells_a_dark_client_what_it_is_and_repaints_itself(kind: str) -> None:
    html = rendered(kind)["html"]
    assert 'name="color-scheme" content="light dark"' in html
    assert "prefers-color-scheme: dark" in html
    # Every colour that flips is declared for both, by class, never left to the client's invert.
    for token in ("wobo-paper", "wobo-card", "wobo-ink", "wobo-quiet"):
        assert token in html


# --- the link ----------------------------------------------------------------------------------
@pytest.mark.parametrize("kind", NUDGE_KINDS)
def test_the_button_goes_where_the_send_path_says_and_nowhere_else(kind: str) -> None:
    good = rendered(kind, {"cta_url": "https://heywobo.com/course/c/card/7?k=tok"})
    assert "https://heywobo.com/course/c/card/7?k=tok" in good["html"]
    hostile = rendered(kind, {"cta_url": "https://evil.test/steal"})
    assert "evil.test" not in hostile["html"]
