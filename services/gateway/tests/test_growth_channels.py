"""The channels, in three tiers that never mix, and Reddit and Quora with no automation, ever.

``docs/GROWTH-DESK.md`` section 2. The last test in this file is the one the law asks for by name:
there is no code path anywhere in the repository that posts to Reddit or Quora. It reads every
tracked source file rather than this package alone, because a posting path added somewhere else
is exactly the failure it exists to catch.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest
from growth_world import good_piece
from wobo_gateway.growth import campaigns, channels, posters, settings, shapes

REPO = Path(__file__).resolve().parents[3]


def test_the_three_tiers_are_the_laws_own() -> None:
    script = {c.key for c in channels.script_channels()}
    person = {c.key for c in channels.person_channels()}
    never = {c.key for c in channels.never_channels()}
    assert script == {
        "blog",
        "telegram",
        "threads",
        "instagram",
        "facebook",
        "linkedin",
        "youtube",
        "x",
    }
    assert person == {"medium", "pinterest", "newsletter", "business-profile"}
    assert never == {"reddit", "quora"} == set(channels.NEVER_AUTOMATED)
    assert not (script & person or script & never or person & never)


def test_every_channel_says_why_it_is_in_its_tier() -> None:
    for channel in channels.CHANNELS:
        assert channel.because.strip().endswith("."), channel.key
        assert "—" not in channel.because


def test_there_is_exactly_one_origin_and_it_is_ours() -> None:
    assert channels.origin().key == channels.ORIGIN == "blog"
    assert channels.may_a_script_post("blog")


def test_x_puts_the_link_last_and_medium_points_home() -> None:
    assert channels.channel("x").link_in_last_reply
    assert channels.channel("medium").canonical_back
    assert channels.channel("linkedin").canonical_back


@pytest.mark.parametrize("key", ["reddit", "quora", "Reddit", " QUORA "])
def test_tier_three_is_refused_at_every_door(key: str) -> None:
    with pytest.raises(channels.NeverAutomated):
        channels.refuse(key)
    with pytest.raises(channels.NeverAutomated):
        campaigns.build(key, "probability")
    with pytest.raises(channels.NeverAutomated):
        posters.poster_for(key)
    with pytest.raises(channels.NeverAutomated):
        posters.set_poster(key, None)
    with pytest.raises(channels.NeverAutomated):
        shapes.posts_for(good_piece(), only=(key,))
    with pytest.raises(channels.NeverAutomated):
        settings.valid_cadence({key: 1})


def test_a_campaign_id_naming_tier_three_is_never_read_back() -> None:
    assert not campaigns.is_well_formed("reddit-202609-probability-01")
    assert not campaigns.is_well_formed("quora-202609-probability-01")
    assert campaigns.from_query("utm_id=reddit-202609-probability-01") is None


def test_no_shape_is_ever_destined_for_tier_three() -> None:
    destined = {key for keys in shapes.DESTINATIONS.values() for key in keys}
    assert not destined & channels.NEVER_AUTOMATED
    built = shapes.posts_for(good_piece())
    assert built.posts
    assert not {p.channel for p in built.posts} & channels.NEVER_AUTOMATED


def test_a_person_channel_has_no_poster() -> None:
    for channel in channels.person_channels():
        with pytest.raises(posters.NotWired):
            posters.poster_for(channel.key)


def _tracked_files() -> list[Path]:
    listed = (
        subprocess.run(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            cwd=REPO,
            capture_output=True,
            check=True,
        )
        .stdout.decode()
        .split("\0")
    )
    wanted = (".py", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".sql", ".sh", ".toml", ".yml", ".yaml")
    return [REPO / name for name in listed if name.endswith(wanted)]


#: Domains are matched literally; package names only as whole words, so "sprawl" is not "praw".
_MARKERS = re.compile(
    "|".join(
        re.escape(m) if "." in m else rf"\b{re.escape(m)}\b"
        for m in sorted(channels.NEVER_AUTOMATED_MARKERS)
    ),
    re.I,
)
#: The one file that names the markers, so the scan has something to scan for.
_ALLOWED = {
    REPO / "services/gateway/src/wobo_gateway/growth/channels.py",
}


def test_no_code_anywhere_reaches_reddit_or_quora() -> None:
    """The assertion the law asks for: no code path posts to either, because no code touches
    either. A client library, a hostname or an OAuth endpoint for them anywhere in a source file
    fails this, in any package, in any language the repository holds."""
    files = _tracked_files()
    assert len(files) > 200, "the scan found almost nothing, so it is not scanning the repository"
    found: list[str] = []
    for path in files:
        if path in _ALLOWED or path == Path(__file__) or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for match in _MARKERS.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            found.append(f"{path.relative_to(REPO)}:{line}: {match.group(0)}")
    assert not found, "code that reaches a tier 3 site:\n" + "\n".join(found)


def test_the_scan_would_catch_one() -> None:
    """The scan is only worth its name if it fires. Each marker, in the shape a client would use."""
    for sample in (
        "https://oauth.reddit.com/api/submit",
        "import praw",
        "from asyncpraw import Reddit",
        "https://www.quora.com/answer",
        "https://redd.it/abc",
    ):
        assert _MARKERS.search(sample), sample
    for innocent in ("the sprawl of a city", "Reddit is tier 3", "a quorum"):
        assert not _MARKERS.search(innocent), innocent


def test_the_python_dependencies_carry_no_client_for_either() -> None:
    lock = REPO / "uv.lock"
    text = lock.read_text() if lock.is_file() else ""
    text += (REPO / "services/gateway/pyproject.toml").read_text()
    assert not re.search(r'name = "(async)?praw"', text)
    assert "quora" not in text.lower()
