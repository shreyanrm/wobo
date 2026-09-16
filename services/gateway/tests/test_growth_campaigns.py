"""One durable campaign id per post, of the shape channel-yyyymm-slug-nn, used as utm_id."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from wobo_gateway.growth import campaigns

SEPT = date(2026, 9, 16)


@pytest.mark.parametrize("channel", ["x", "blog", "business-profile", "telegram", "medium"])
def test_every_channel_key_builds_and_parses(channel: str) -> None:
    built = campaigns.build(channel, "Work and energy", when=SEPT)
    assert built == f"{channel}-202609-work-and-energy-01"
    parsed = campaigns.parse(built)
    assert (parsed.channel, parsed.month, parsed.slug, parsed.attempt) == (
        channel,
        "202609",
        "work-and-energy",
        1,
    )


def test_a_one_letter_channel_is_a_real_channel() -> None:
    """X's key is one letter. The grammar refused it once, which silently untagged every thread."""
    assert campaigns.is_well_formed("x-202609-probability-01")


def test_the_month_is_utc() -> None:
    late = datetime(2026, 9, 30, 23, 30, tzinfo=UTC)
    assert campaigns.build("blog", "motion", when=late).startswith("blog-202609-")


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "blog-2026-motion-01",
        "blog-202613-motion-01",
        "blog-202609-motion-1",
        "blog-202609--01",
        "nowhere-202609-motion-01",
        "BLOG-202609-motion-01",
        "blog-202609-motion-01&x=1",
        "blog-202609-" + "a" * 90 + "-01",
    ],
)
def test_junk_is_never_a_campaign(bad: str) -> None:
    assert not campaigns.is_well_formed(bad)


def test_the_attempt_is_two_digits() -> None:
    assert campaigns.build("x", "motion", attempt=12, when=SEPT).endswith("-12")
    with pytest.raises(campaigns.BadCampaign):
        campaigns.build("x", "motion", attempt=100, when=SEPT)
    with pytest.raises(campaigns.BadCampaign):
        campaigns.build("x", "!!!", when=SEPT)


def test_tag_adds_one_parameter_and_keeps_the_fragment() -> None:
    cid = "x-202609-motion-01"
    assert campaigns.tag("https://heywobo.com/blog/motion", cid) == (
        "https://heywobo.com/blog/motion?utm_id=x-202609-motion-01"
    )
    assert campaigns.tag("https://heywobo.com/blog/motion?a=1#top", cid) == (
        "https://heywobo.com/blog/motion?a=1&utm_id=x-202609-motion-01#top"
    )
    with pytest.raises(campaigns.BadCampaign):
        campaigns.tag("https://heywobo.com/blog/motion", "not-one")


def test_from_query_reads_the_first_and_only_a_good_one() -> None:
    assert campaigns.from_query("?utm_id=x-202609-motion-01&utm_id=blog-202609-motion-01") == (
        "x-202609-motion-01"
    )
    assert campaigns.from_query("utm_source=x&UTM_ID=telegram-202609-motion-02") == (
        "telegram-202609-motion-02"
    )
    assert campaigns.from_query("utm_id=%3Cscript%3E") is None
    assert campaigns.from_query("") is None
    assert campaigns.from_query("utm_id=") is None
