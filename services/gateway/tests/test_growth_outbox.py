"""QUEUE AND POST: publish then syndicate, a measured pace, and who sends what.

Every poster here answers from ``tests/fixtures/growth/``; nothing reaches a network.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from growth_world import Recorder, fixture, good_piece
from wobo_gateway import doors
from wobo_gateway.growth import indexing, outbox, piece, posters, settings, shapes
from wobo_gateway.growth import store as store_mod
from wobo_gateway.growth.shapes import Post

NOW = datetime(2026, 9, 16, 6, 0, tzinfo=UTC)
ON = settings.Settings(running=True, approval=settings.APPROVE_PERSON_TIER)


class Hand:
    """A poster that records what it was handed and answers with a reference."""

    def __init__(self, channel: str, *, fail: Exception | None = None) -> None:
        self.channel = channel
        self.sent: list[Post] = []
        self.fail = fail

    def post(self, post: Post) -> str:
        if self.fail:
            raise self.fail
        self.sent.append(post)
        return f"{self.channel}:{len(self.sent)}"


class Site:
    """The live site, as the outbox reads it: which blog addresses answer with their own page."""

    def __init__(self, *, up: bool = True) -> None:
        self.up = up
        self.down: set[str] = set()
        self.asked: list[str] = []

    def __call__(self, url: str) -> tuple[int, str]:
        self.asked.append(url)
        if not self.up or url in self.down:
            return 404, "<html><head><title>Not found</title></head></html>"
        return 200, f'<html><head><link rel="canonical" href="{url}"></head></html>'


@pytest.fixture(autouse=True)
def site() -> Any:
    """No test reads the real site: every pass here asks this recording instead."""
    live = Site()
    outbox.set_page_reader(live)
    yield live
    outbox.set_page_reader(None)


@pytest.fixture(autouse=True)
def _world(monkeypatch: pytest.MonkeyPatch, site: Site) -> Any:
    monkeypatch.delenv(indexing.TOKEN_ENV, raising=False)
    world = store_mod.InMemoryGrowthStore()
    store_mod.set_store(world)
    doors.set_store(doors.InMemorySettingsStore())
    settings.forget()
    hands = {key: Hand(key) for key in ("blog", "telegram", "threads", "x")}
    for key, hand in hands.items():
        posters.set_poster(key, hand)
    yield hands
    posters.reset()
    store_mod.set_store(None)
    doors.set_store(None)
    settings.forget()


def _stage(dials: settings.Settings = ON, **changes: Any) -> None:
    made = good_piece(**changes)
    outbox.stage(made, piece.check(made), shapes.posts_for(made, when=NOW), now=NOW, dials=dials)


def _status() -> dict[str, str]:
    return {p.channel: p.status for p in store_mod.get_store().posts()}


def test_a_refused_piece_is_kept_with_its_reasons_and_stages_nothing() -> None:
    _stage(figure=None)
    kept = store_mod.get_store().piece("probability")
    assert kept is not None and not kept.publishable
    assert any("figure" in b for b in kept.verdict["because"])
    assert store_mod.get_store().posts() == []


def test_only_the_origin_may_move_until_it_is_indexed(_world: dict[str, Hand]) -> None:
    _stage()
    status = _status()
    assert status.pop("blog") == store_mod.APPROVED
    assert set(status.values()) == {store_mod.HELD}
    report = outbox.run(now=NOW, dials=ON)
    assert [p["id"] for p in report["posted"]] == ["blog-202609-probability-01"]
    assert _world["blog"].sent and not _world["telegram"].sent and not _world["x"].sent
    kept = store_mod.get_store().piece("probability")
    assert kept is not None and kept.published_at == NOW and kept.indexed_at is None
    # A day later, still not indexed: nothing else moves, however many passes run.
    for hours in (1, 12, 36):
        outbox.run(now=NOW + timedelta(hours=hours), dials=ON)
    assert not _world["telegram"].sent and not _world["x"].sent
    assert {s for c, s in _status().items() if c != "blog"} == {store_mod.HELD}


def test_a_copy_released_by_any_route_still_waits_for_the_origin(_world: dict[str, Hand]) -> None:
    _stage()
    store_mod.get_store().update_post("x-202609-probability-01", {"status": store_mod.APPROVED})
    report = outbox.run(now=NOW, dials=ON)
    assert not _world["x"].sent
    assert {"id": "x-202609-probability-01", "because": outbox.WAITING_FOR_ORIGIN} in report[
        "waiting"
    ]


def test_indexed_releases_the_copies_script_to_post_person_to_the_queue(
    _world: dict[str, Hand],
) -> None:
    _stage()
    outbox.run(now=NOW, dials=ON)
    outbox.record_indexed(
        "probability",
        {"source": "person", "note": "seen in results"},
        now=NOW + timedelta(hours=30),
    )
    report = outbox.run(now=NOW + timedelta(hours=31), dials=ON)
    assert report["released"] > 0
    status = _status()
    assert status["medium"] == store_mod.QUEUED_FOR_PERSON
    assert status["newsletter"] == store_mod.QUEUED_FOR_PERSON
    assert status["pinterest"] == store_mod.QUEUED_FOR_PERSON
    assert status["x"] == status["telegram"] == status["threads"] == store_mod.POSTED
    # Not wired: approved, waiting, with the reason on it.
    assert status["linkedin"] == store_mod.APPROVED
    linkedin = next(p for p in store_mod.get_store().posts() if p.channel == "linkedin")
    assert linkedin.error and linkedin.error.startswith("not wired")
    (thread,) = _world["x"].sent
    assert thread.units[-1].endswith("?utm_id=x-202609-probability-01")


def test_indexing_cannot_precede_publishing() -> None:
    _stage()
    with pytest.raises(outbox.Refused):
        outbox.record_indexed("probability", {"source": "person", "note": "x"}, now=NOW)
    with pytest.raises(outbox.Refused):
        outbox.record_indexed("nothing", {"source": "person"}, now=NOW)


def test_the_kill_switch_stops_everything(_world: dict[str, Hand]) -> None:
    _stage()
    report = outbox.run(now=NOW, dials=settings.Settings(running=False))
    assert report["running"] is False and report["because"] == "the kill switch is off"
    assert not _world["blog"].sent
    closed = outbox.run(now=NOW, dials=settings.Settings(running=False, readable=False))
    assert closed["because"] == "the dials could not be read"


def test_the_switch_defaults_off_and_an_unreadable_store_reads_as_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert settings.current(fresh=True).running is False

    class Broken:
        def read_many(self, keys: Any) -> Any:
            raise OSError("down")

    doors.set_store(Broken())  # type: ignore[arg-type]
    found = settings.current(fresh=True)
    assert found.running is False and found.readable is False


def test_every_post_waits_for_approval_until_the_owner_says_otherwise(
    _world: dict[str, Hand],
) -> None:
    every = settings.Settings(running=True)
    _stage(dials=every)
    assert _status()["blog"] == store_mod.AWAITING
    outbox.run(now=NOW, dials=every)
    assert not _world["blog"].sent
    with pytest.raises(outbox.Refused):
        outbox.approve("x-202609-probability-01", actor=None)  # held: the origin is not live
    outbox.approve("blog-202609-probability-01", actor="owner", now=NOW)
    outbox.run(now=NOW, dials=every)
    assert len(_world["blog"].sent) == 1
    outbox.record_indexed(
        "probability", {"source": "person", "note": "seen"}, now=NOW + timedelta(days=1)
    )
    outbox.run(now=NOW + timedelta(days=1), dials=every)
    assert _status()["x"] == store_mod.AWAITING
    assert not _world["x"].sent


def test_the_cadence_holds_the_pace(_world: dict[str, Hand]) -> None:
    for slug in ("probability", "statistics"):
        _stage(
            slug=slug,
            topic_slug=slug,
            sections=[
                piece.Section(s.heading, f"{s.body} This is the {slug} page.")
                for s in good_piece().sections
            ],
        )
    outbox.run(now=NOW, dials=ON)
    assert len(_world["blog"].sent) == 1, "one origin a day"
    outbox.run(now=NOW + timedelta(hours=2), dials=ON)
    assert len(_world["blog"].sent) == 1
    outbox.run(now=NOW + timedelta(days=1), dials=ON)
    assert len(_world["blog"].sent) == 2


def test_the_origin_ceiling_beats_the_dial() -> None:
    with pytest.raises(settings.BadSetting):
        settings.valid_cadence({"blog": settings.BLOG_CEILING + 1})
    with pytest.raises(settings.BadSetting):
        settings.valid_cadence({"x": settings.CHANNEL_CEILING + 1})


def test_a_topic_switched_off_does_not_post(_world: dict[str, Hand]) -> None:
    _stage()
    off = settings.Settings(
        running=True, approval=settings.APPROVE_PERSON_TIER, topics_off=frozenset({"probability"})
    )
    report = outbox.run(now=NOW, dials=off)
    assert not _world["blog"].sent
    assert report["waiting"][0]["because"] == "its topic is switched off"


def test_a_person_marks_a_queued_post_sent_and_it_never_moves_again() -> None:
    _stage()
    outbox.run(now=NOW, dials=ON)
    outbox.record_indexed(
        "probability", {"source": "person", "note": "seen"}, now=NOW + timedelta(days=1)
    )
    outbox.run(now=NOW + timedelta(days=1), dials=ON)
    with pytest.raises(outbox.Refused):
        outbox.approve("medium-202609-probability-01", actor="owner")
    sent = outbox.mark_sent(
        "medium-202609-probability-01", actor="owner", reference="https://medium.example/p/1"
    )
    assert sent.status == store_mod.SENT_BY_PERSON
    with pytest.raises(outbox.Refused):
        outbox.withdraw("medium-202609-probability-01", actor="owner")
    with pytest.raises(outbox.Refused):
        outbox.mark_sent("medium-202609-probability-01", actor="owner", reference="")


def test_a_refusing_channel_marks_the_post_failed(_world: dict[str, Hand]) -> None:
    posters.set_poster("blog", Hand("blog", fail=posters.PostFailed("the channel refused")))
    _stage()
    report = outbox.run(now=NOW, dials=ON)
    assert report["failed"] == [
        {"id": "blog-202609-probability-01", "because": "the channel refused"}
    ]
    assert _status()["blog"] == store_mod.FAILED


def test_a_campaign_id_is_minted_once() -> None:
    _stage()
    before = len(store_mod.get_store().posts())
    _stage()
    assert len(store_mod.get_store().posts()) == before
    with pytest.raises(store_mod.StoreUnavailable):
        store_mod.get_store().update_post("x-202609-probability-01", {"channel": "telegram"})


# --- the posters, against recordings --------------------------------------------------------------
def _post(channel: str) -> Post:
    built = shapes.posts_for(good_piece(), when=NOW)
    return next(p for p in built.posts if p.channel == channel)


def test_telegram_sends_one_message_with_the_link_at_its_foot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:abc")
    monkeypatch.setenv("TELEGRAM_CHANNEL_ID", "@wobo_test")
    recorder = Recorder((200, fixture("telegram_send_ok.json")))
    reference = posters.TelegramPoster(transport=recorder).post(_post("telegram"))
    assert reference == "telegram:412"
    (call,) = recorder.calls
    assert call["url"] == "https://api.telegram.org/bot123:abc/sendMessage"
    assert call["body"]["chat_id"] == "@wobo_test"
    assert call["body"]["text"].endswith("?utm_id=telegram-202609-probability-01")


def test_telegram_refusal_is_a_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:abc")
    monkeypatch.setenv("TELEGRAM_CHANNEL_ID", "@wobo_test")
    recorder = Recorder((403, fixture("telegram_send_refused.json")))
    with pytest.raises(posters.PostFailed):
        posters.TelegramPoster(transport=recorder).post(_post("telegram"))


def test_x_chains_the_replies_and_carries_the_link_only_last(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("X_USER_ACCESS_TOKEN", "user-token")
    thread = _post("x")
    answers = []
    for i in range(len(thread.units)):
        answer = fixture("x_post_ok.json")
        answer["data"]["id"] = f"18350000000000000{i:02d}"
        answers.append((201, answer))
    recorder = Recorder(*answers)
    assert posters.XPoster(transport=recorder).post(thread) == "x:1835000000000000000"
    bodies = [c["body"] for c in recorder.calls]
    assert "reply" not in bodies[0]
    for i, body in enumerate(bodies[1:], start=1):
        assert body["reply"]["in_reply_to_tweet_id"] == f"18350000000000000{i - 1:02d}"
    assert all("https://" not in b["text"] for b in bodies[:-1])
    assert "https://heywobo.com/blog/probability?utm_id=x-" in bodies[-1]["text"]


def test_threads_publishes_each_container_as_a_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("THREADS_USER_ID", "17841")
    monkeypatch.setenv("THREADS_ACCESS_TOKEN", "t")
    thread = _post("threads")
    answers: list[tuple[int, Any]] = []
    for i in range(len(thread.units)):
        answers += [(200, {"id": f"c{i}"}), (200, {"id": f"m{i}"})]
    recorder = Recorder(*answers)
    assert posters.ThreadsPoster(transport=recorder).post(thread) == "threads:m0"
    creates = [c["body"] for c in recorder.calls if c["url"].endswith("/threads")]
    assert "reply_to_id" not in creates[0]
    assert creates[2]["reply_to_id"] == "m1"


def test_a_poster_with_no_credentials_says_which(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID", "X_USER_ACCESS_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(posters.NotConfigured, match="TELEGRAM_BOT_TOKEN"):
        posters.TelegramPoster(transport=Recorder()).post(_post("telegram"))
    with pytest.raises(posters.NotConfigured, match="X_USER_ACCESS_TOKEN"):
        posters.XPoster(transport=Recorder()).post(_post("x"))


def test_the_blog_poster_counts_past_ninety_nine(tmp_path: Path) -> None:
    for number in range(1, 101):
        (tmp_path / shapes.blog_file_name(f"post-{number}", number)).write_text("x")
    assert (tmp_path / "100-post-100.md").exists()
    name = posters.BlogPoster(folder=tmp_path).post(_post("blog"))
    assert name == "101-probability.md"
    (tmp_path / name).unlink()
    (tmp_path / "100-post-100.md").rename(tmp_path / "100-probability.md")
    with pytest.raises(posters.PostFailed, match="already has a post"):
        posters.BlogPoster(folder=tmp_path).post(_post("blog"))


def test_the_blog_poster_writes_the_compilers_own_file_name(tmp_path: Path) -> None:
    (tmp_path / "06-what-an-ai-tutor-cannot-do.md").write_text("x")
    name = posters.BlogPoster(folder=tmp_path).post(_post("blog"))
    assert name == "07-probability.md"
    assert (tmp_path / name).read_text().startswith("---\ntitle: ")
    with pytest.raises(posters.PostFailed):
        posters.BlogPoster(folder=tmp_path).post(_post("blog"))


def test_the_wiring_says_what_is_not_wired_and_why() -> None:
    posters.reset()
    table = {row["channel"]: row for row in posters.wiring()}
    assert table["telegram"]["wired"] and table["x"]["wired"] and table["blog"]["wired"]
    for key in ("linkedin", "instagram", "facebook", "youtube"):
        assert not table[key]["wired"] and table[key]["because"].startswith("not wired")


# --- indexing, against recordings -----------------------------------------------------------------
@pytest.mark.parametrize(
    ("name", "indexed"),
    [
        ("inspection_indexed.json", True),
        ("inspection_not_indexed.json", False),
        ("inspection_pass_but_not_indexed.json", False),
    ],
)
def test_only_an_indexed_verdict_counts(name: str, indexed: bool) -> None:
    assert indexing.read_inspection(fixture(name)).indexed is indexed
    assert indexing.read_inspection({}).indexed is False
    assert indexing.read_inspection(None).indexed is False


def test_the_pass_asks_search_console_about_published_origins(
    monkeypatch: pytest.MonkeyPatch, _world: dict[str, Hand]
) -> None:
    monkeypatch.setenv(indexing.TOKEN_ENV, "token")
    monkeypatch.setenv(indexing.PROPERTY_ENV, "sc-domain:heywobo.com")
    _stage()
    asked: list[dict[str, Any]] = []

    def answer(url: str, headers: dict[str, str], body: dict[str, Any]) -> tuple[int, Any]:
        asked.append(body)
        return 200, fixture("inspection_indexed.json")

    outbox.run(now=NOW, dials=ON)
    found = outbox.check_indexing(now=NOW + timedelta(hours=5), transport=answer)
    assert found == {"checked": 1, "indexed": 1}
    assert asked == [
        {
            "inspectionUrl": "https://heywobo.com/blog/probability",
            "siteUrl": "sc-domain:heywobo.com",
        }
    ]
    kept = store_mod.get_store().piece("probability")
    assert kept is not None and kept.index_evidence["verdict"] == "PASS"


# --- the origin is the live page, not the stamp --------------------------------------------------
def test_a_written_file_is_not_a_published_post(_world: dict[str, Hand], site: Site) -> None:
    site.up = False
    _stage()
    report = outbox.run(now=NOW, dials=ON)
    assert [p["id"] for p in report["posted"]] == ["blog-202609-probability-01"]
    kept = store_mod.get_store().piece("probability")
    assert kept is not None and kept.published_at is None, "stamped before the page existed"
    with pytest.raises(outbox.Refused, match="not been published"):
        outbox.record_indexed("probability", {"source": "person", "note": "seen it"}, now=NOW)
    # The deploy lands: the next pass sees the page and only then stamps it published.
    site.up = True
    later = NOW + timedelta(hours=4)
    report = outbox.run(now=later, dials=ON)
    kept = store_mod.get_store().piece("probability")
    assert kept is not None and kept.published_at == later
    assert report["published"] == ["probability"]


def test_the_indexed_mark_needs_the_page_answering(site: Site) -> None:
    _stage()
    outbox.run(now=NOW, dials=ON)
    site.down.add("https://heywobo.com/blog/probability")
    with pytest.raises(outbox.Refused, match="not live"):
        outbox.record_indexed(
            "probability", {"source": "person", "note": "seen it"}, now=NOW + timedelta(hours=5)
        )
    kept = store_mod.get_store().piece("probability")
    assert kept is not None and kept.indexed_at is None


def test_a_page_that_is_gone_releases_nothing_and_posts_nothing(
    _world: dict[str, Hand], site: Site
) -> None:
    _stage()
    outbox.run(now=NOW, dials=ON)
    outbox.record_indexed(
        "probability", {"source": "person", "note": "seen"}, now=NOW + timedelta(hours=30)
    )
    # A redeploy wiped the written file: the stamps say live, the address says 404.
    site.down.add("https://heywobo.com/blog/probability")
    report = outbox.run(now=NOW + timedelta(hours=31), dials=ON)
    assert report["released"] == 0
    assert not _world["telegram"].sent and not _world["x"].sent
    assert {s for c, s in _status().items() if c != "blog"} == {store_mod.HELD}
    # A copy released by any route still waits while the page is gone.
    store_mod.get_store().update_post("x-202609-probability-01", {"status": store_mod.APPROVED})
    report = outbox.run(now=NOW + timedelta(hours=32), dials=ON)
    assert not _world["x"].sent
    assert {"id": "x-202609-probability-01", "because": outbox.ORIGIN_GONE} in report["waiting"]


def test_a_page_that_looks_like_ours_but_is_not_the_post_is_not_live() -> None:
    url = "https://heywobo.com/blog/probability"
    other = '<link rel="canonical" href="https://heywobo.com/blog">'
    outbox.set_page_reader(lambda u: (200, f"<html><head>{other}</head></html>"))
    assert outbox.page_is_up(url) is False
    outbox.set_page_reader(lambda u: (200, f'<link href="{url}" rel="canonical" />'))
    assert outbox.page_is_up(url) is True
    outbox.set_page_reader(lambda u: (_ for _ in ()).throw(OSError("down")))
    assert outbox.page_is_up(url) is False


def test_a_gone_page_is_posted_again_under_a_new_attempt(
    _world: dict[str, Hand], site: Site
) -> None:
    _stage()
    outbox.run(now=NOW, dials=ON)
    with pytest.raises(outbox.Refused, match="answering"):
        outbox.repost_origin("probability", actor="owner", now=NOW + timedelta(hours=1))
    site.down.add("https://heywobo.com/blog/probability")
    again = outbox.repost_origin(
        "probability", actor="owner", now=NOW + timedelta(days=1), dials=ON
    )
    assert again.id == "blog-202609-probability-02"
    assert again.status == store_mod.APPROVED
    first = next(p for p in store_mod.get_store().posts() if p.id == "blog-202609-probability-01")
    assert first.status == store_mod.POSTED, "a finished post does not move again"
    with pytest.raises(outbox.Refused, match="waiting"):
        outbox.repost_origin("probability", actor="owner", now=NOW + timedelta(days=1), dials=ON)
    outbox.run(now=NOW + timedelta(days=1), dials=ON)
    assert len(_world["blog"].sent) == 2
    assert _world["blog"].sent[1].units == _world["blog"].sent[0].units


def test_only_a_posted_origin_is_posted_again(site: Site) -> None:
    site.up = False
    with pytest.raises(outbox.Refused, match="no such piece"):
        outbox.repost_origin("nothing", actor="owner")
    _stage()
    with pytest.raises(outbox.Refused, match="already waiting"):
        outbox.repost_origin("probability", actor="owner")
    outbox.withdraw("blog-202609-probability-01", actor="owner")
    with pytest.raises(outbox.Refused, match="has not been posted"):
        outbox.repost_origin("probability", actor="owner")
    _stage(slug="thin", topic_slug="thin", figure=None)
    with pytest.raises(outbox.Refused, match="did not pass"):
        outbox.repost_origin("thin", actor="owner")
