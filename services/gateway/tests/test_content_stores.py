"""The five stores: what a deploy costs today, and what it costs once Postgres is the truth.

THE ORDER OF THIS FILE IS THE ARGUMENT.

1. The cache dies with every deploy, proved from the two committed files that make it so, before a
   line of the fix is exercised. If that proof ever stops holding — somebody mounts a volume — the
   test says so and the reasoning in migration 0026 has to be re-read rather than assumed.
2. A container restart keeps every row: write, throw the disk away, read it back.
3. The front answers in microseconds and the database in tens of milliseconds, which is why there
   are two tiers rather than one.
4. The spend a serve saved, per store, counted and never guessed.

No Postgres runs here. ``store_fakes.FakePostgrest`` keeps the rows in a dict and enforces the
three schema rules the gateway leans on; the schema itself is a contract asserted in
``test_content_stores_schema.py``, which is honest about what a grep can and cannot prove.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

import pytest
from store_fakes import FakePostgrest
from wobo_gateway.plexus import db, store

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakePostgrest:
    """A configured store over a dict, and nothing left behind for the next test."""
    monkeypatch.delenv("PLEXUS_STORES", raising=False)
    transport = FakePostgrest()
    db.reset()
    db.configure(base_url="https://db.test", service_key="service-role", transport=transport)
    yield transport
    db.reset()


@pytest.fixture
def cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A fresh container's disk: empty, and ours to delete."""
    disk = tmp_path / "container-1"
    disk.mkdir()
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(disk))
    return disk


def _record(text: str = "a paragraph about photosynthesis") -> dict[str, Any]:
    return {
        "concept": "photosynthesis",
        "modality": "reading",
        "difficulty": "core",
        "body": text,
        "status": store.CANONICAL,
        "provenance": {"engine": "engine.compose", "model": "gemini/luna", "cost_usd": 0.002},
        "validation": {"score": 4.4},
    }


SCOPE = {"board": "CBSE", "grade": "Class 8", "contentVersion": "2026-27"}


# --- 1. the cache used to die with every deploy; now it can be mounted ---------------------------
#
# THE FINDING THIS FILE WAS WRITTEN AROUND, and what changed. The test below used to assert that
# the image cached into /home/gateway/cache — the container's own writable layer — and its comment
# said: *"the day somebody mounts a volume, this test fails and the argument in 0026 gets re-read
# instead of quietly becoming wrong."* That day is 2026-09-10. The image now caches into /data,
# `store.cache_dir()` follows RAILWAY_VOLUME_MOUNT_PATH on its own, and /healthz reports
# `persistence.durable` so a deployment with no volume attached SAYS it is ephemeral rather than
# quietly buying every core again (tests/test_cache_durability.py).
#
# 0026's argument is unchanged and still holds: the database is the truth. A volume is one
# container's disk, it does not follow a second replica, and a file front is a cache in front of
# the truth — never the truth itself.


def test_the_gateway_caches_onto_a_mount_point_and_not_the_writable_layer() -> None:
    """No ``VOLUME`` instruction is asserted here, and none may appear. Railway refuses a Dockerfile
    that carries one ("dockerfile invalid: docker VOLUME at Line 63 is not supported, use Railway
    Volumes"); two production deploys failed on it before the line was removed, and the Dockerfile's
    own comment records the failure. The volume is attached on the platform and mounts onto /data.
    Durability is therefore proven by the env vars pointing under /data, the mkdir and chown of the
    mount point to the user that writes it, and the comment naming Railway Volumes."""
    dockerfile = (REPO / "services/gateway/Dockerfile").read_text()
    assert "PLEXUS_CACHE_DIR=/data/plexus" in dockerfile, (
        "the cache path moved: re-derive whether what it writes survives a deploy"
    )
    assert "WOBO_IMAGE_CACHE_DIR=/data/plexus/images" in dockerfile
    # A volume mounts onto a directory that exists and is owned by the user that writes it.
    assert "mkdir -p /data/plexus/images" in dockerfile
    assert "useradd --create-home --uid 10001 gateway" in dockerfile
    assert "chown -R gateway:gateway /data" in dockerfile
    # The instruction Railway rejects must stay out, and the comment must keep saying why.
    # Anchored to the start of a line: Railway refuses BOTH spellings, `VOLUME ["/data"]` and
    # `VOLUME /data`, and only an instruction starts a line; the comment above the mkdir may name
    # the word, an instruction may not appear.
    assert not re.search(r"^\s*VOLUME\b", dockerfile, re.MULTILINE), (
        "a VOLUME instruction is back in the Dockerfile; Railway will refuse the whole file"
    )
    assert "use Railway Volumes" in dockerfile


def test_railway_declares_no_volume_in_the_repo() -> None:
    """A Railway volume is attached to a service on the platform, not declared in this file, so the
    code reads ``RAILWAY_VOLUME_MOUNT_PATH`` instead of trusting a key here. The keys of
    ``deploy`` are still pinned: a stray one is a deploy behaviour nobody reviewed."""
    railway = json.loads((REPO / "railway.json").read_text())
    assert "volumes" not in railway, (
        "railway.json now declares volumes — check that Railway honours the key before relying "
        "on it, and that store.cache_dir() still lands inside the mount"
    )
    assert set(railway["deploy"]) == {
        "healthcheckPath",
        "healthcheckTimeout",
        "restartPolicyType",
        "restartPolicyMaxRetries",
        "numReplicas",
    }, railway["deploy"]


def test_no_file_in_the_repo_mounts_a_volume_for_the_cache() -> None:
    """Not in railway.json, not in a compose file, not anywhere: `/home/gateway/cache` is a path in
    a container and nothing in this repository makes it durable."""
    mentions = [
        path
        for path in REPO.rglob("*")
        if path.is_file()
        and path.suffix in {".json", ".toml", ".yaml", ".yml"}
        and "node_modules" not in path.parts
        and ".git" not in path.parts
        and "/home/gateway/cache" in path.read_text(errors="ignore")
    ]
    assert not mentions, f"something now names the cache path: {mentions}"


def test_more_than_one_replica_would_not_share_the_file_cache() -> None:
    """`numReplicas` is a dial. Two containers do not share a writable layer, so the file cache is
    per-replica as well as per-deploy — the database is what makes the second replica warm."""
    railway = json.loads((REPO / "railway.json").read_text())
    assert railway["deploy"]["numReplicas"] >= 1


# --- 2. a container restart keeps every row -------------------------------------------------------


def test_a_new_container_serves_what_the_old_one_generated(
    fake: FakePostgrest, cache: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole wave in one test.

    Generate once, write to both tiers, then throw the container away — a new PLEXUS_CACHE_DIR is
    exactly what a deploy hands the gateway. Today that is a total loss. With the database behind
    the file, the artifact comes straight back and nothing is regenerated.
    """
    record = _record()
    store.save("photosynthesis", "reading", "core", record, SCOPE)
    key = store.cache_key("photosynthesis", "reading", "core", SCOPE)
    assert fake.live("levels", key) is not None, "the generation never reached the database"

    # The deploy. A new container, a new empty disk, the same database.
    fresh = tmp_path / "container-2"
    fresh.mkdir()
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(fresh))
    assert not list(fresh.rglob("*.json"))

    served = store.load("photosynthesis", "reading", "core", SCOPE)
    assert served == record

    # …and it warmed the new container's front on the way past, so the SECOND read costs nothing.
    assert list(fresh.rglob("*.json")), "the database hit did not re-index onto the file front"
    before = len(fake.calls)
    assert store.load("photosynthesis", "reading", "core", SCOPE) == record
    assert fake.calls[before:] == [], "the second read went back to the database"


def test_without_a_database_a_new_container_is_empty_and_must_regenerate(
    cache: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The control, and today's production behaviour. Same steps, no database configured."""
    db.reset()
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    store.save("photosynthesis", "reading", "core", _record(), SCOPE)
    assert store.load("photosynthesis", "reading", "core", SCOPE) is not None

    fresh = tmp_path / "container-2"
    fresh.mkdir()
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(fresh))
    assert store.load("photosynthesis", "reading", "core", SCOPE) is None


def test_the_stores_can_be_turned_off_entirely(
    fake: FakePostgrest, cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A deploy that suspects the stores of serving something wrong falls back to generating
    everything: dear, and always available."""
    monkeypatch.setenv("PLEXUS_STORES", "off")
    assert db.configured() is False
    store.save("photosynthesis", "reading", "core", _record(), SCOPE)
    assert fake.all_rows("levels") == []


def test_an_unreachable_database_is_a_cache_miss_and_never_an_error(
    cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An accounting line is worth less than a child's answer, and so is a cache row."""

    def refuses(method: str, url: str, headers: dict[str, str], body: bytes | None):
        raise ConnectionError("the database is not there")

    db.reset()
    db.configure(base_url="https://db.test", service_key="k", transport=refuses)
    store.save("photosynthesis", "reading", "core", _record(), SCOPE)  # must not raise
    assert store.load("photosynthesis", "reading", "core", SCOPE) is not None  # the file front
    db.reset()


# --- 3. the two tiers, and the distance between them ----------------------------------------------


def test_the_front_answers_in_microseconds_and_the_database_in_tens_of_milliseconds(
    cache: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Why there are two tiers rather than one.

    The database round trip here is SIMULATED at 20 ms, which is what one costs; the file read is
    real. What the test measures is that the front is orders of magnitude faster than the tier
    behind it, which is the entire reason the file cache survives this wave instead of being
    deleted in favour of Postgres.
    """
    slow = FakePostgrest(latency_s=0.020)
    db.reset()
    db.configure(base_url="https://db.test", service_key="k", transport=slow)
    try:
        record = _record()
        store.save("photosynthesis", "reading", "core", record, SCOPE)

        front = _fastest(lambda: store.load("photosynthesis", "reading", "core", SCOPE))
        assert front < 0.005, f"the file front took {front * 1000:.2f} ms"

        # A new container: the front is empty, so the same read goes to the database.
        fresh = tmp_path / "cold"
        fresh.mkdir()
        monkeypatch.setenv("PLEXUS_CACHE_DIR", str(fresh))
        started = time.perf_counter()
        assert store.load("photosynthesis", "reading", "core", SCOPE) == record
        from_database = time.perf_counter() - started
        assert from_database >= 0.020, f"the database read took {from_database * 1000:.2f} ms"
        assert from_database > front * 10
    finally:
        db.reset()


def _fastest(call, attempts: int = 5) -> float:
    """The best of several runs. A single timing on a laptop measures whatever else the laptop was
    doing; the floor is the honest figure for "how fast is this when nothing is in the way"."""
    best = float("inf")
    for _ in range(attempts):
        started = time.perf_counter()
        call()
        best = min(best, time.perf_counter() - started)
    return best


def test_the_front_hit_and_the_database_hit_are_counted_apart(
    fake: FakePostgrest, cache: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store.save("photosynthesis", "reading", "core", _record(), SCOPE)
    store.load("photosynthesis", "reading", "core", SCOPE)  # the front
    fresh = tmp_path / "cold"
    fresh.mkdir()
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(fresh))
    store.load("photosynthesis", "reading", "core", SCOPE)  # the database
    store.load("something nobody has generated", "reading", "core", SCOPE)  # a miss

    levels = db.state()["stores"]["levels"]
    assert levels["front_hits"] == 1
    assert levels["database_hits"] == 1
    assert levels["misses"] == 1
    assert levels["hit_rate"] == pytest.approx(2 / 3, abs=1e-4)


# --- 4. spend saved, per store --------------------------------------------------------------------


def test_a_database_hit_records_the_money_it_did_not_spend(
    fake: FakePostgrest, cache: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """docs/CACHES.md §3: the saving is what a MISS would have cost, and the row remembers it."""
    store.save("photosynthesis", "reading", "core", _record(), SCOPE)
    for n in (2, 3):
        fresh = tmp_path / f"cold-{n}"
        fresh.mkdir()
        monkeypatch.setenv("PLEXUS_CACHE_DIR", str(fresh))
        assert store.load("photosynthesis", "reading", "core", SCOPE) is not None

    state = db.state()
    assert state["stores"]["levels"]["saved_usd"] == pytest.approx(0.004)
    assert state["saved_usd_total"] == pytest.approx(0.004)


def test_a_row_nobody_could_price_is_counted_and_never_valued_at_zero(
    fake: FakePostgrest, cache: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The same rule the usage ledger keeps. A zero here would make every store look free forever,
    and the owner is going to price a product on this number."""
    record = _record()
    record["provenance"].pop("cost_usd")
    store.save("photosynthesis", "reading", "core", record, SCOPE)
    fresh = tmp_path / "cold"
    fresh.mkdir()
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(fresh))
    store.load("photosynthesis", "reading", "core", SCOPE)

    levels = db.state()["stores"]["levels"]
    assert levels["database_hits"] == 1
    assert levels["saved_unpriced"] == 1
    assert levels["saved_usd"] == 0.0


def test_the_serve_counter_is_bumped_in_the_database_and_off_the_read_path(
    fake: FakePostgrest, cache: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The count is what makes ``content.store_savings`` durable, and nothing a learner waits on
    ever waits on it: the increment is buffered and flushed in a batch."""
    store.save("photosynthesis", "reading", "core", _record(), SCOPE)
    key = store.cache_key("photosynthesis", "reading", "core", SCOPE)
    for n in (2, 3, 4):
        fresh = tmp_path / f"cold-{n}"
        fresh.mkdir()
        monkeypatch.setenv("PLEXUS_CACHE_DIR", str(fresh))
        store.load("photosynthesis", "reading", "core", SCOPE)

    assert fake.live("levels", key)["served_count"] == 0, "a read waited on a counter"
    assert db.flush_serves() == 1  # one row, three serves
    assert fake.live("levels", key)["served_count"] == 3
    assert db.state()["serves_noted"] == 3


def test_the_savings_view_is_read_as_rows_and_a_failure_is_not_an_empty_table(
    fake: FakePostgrest, cache: Path
) -> None:
    """A cache reported as empty and a cache reported as unreachable are different facts, and only
    one of them is an emergency."""
    store.save("photosynthesis", "reading", "core", _record(), SCOPE)
    rows = db.savings()
    assert rows and rows[0]["store"] == "levels"

    db.reset()
    assert db.savings() is None


# --- the row law, from the gateway's side ---------------------------------------------------------


def test_only_the_columns_a_store_declares_are_ever_sent(fake: FakePostgrest, cache: Path) -> None:
    """``db.FIELDS`` is the allow-list, and it is the code path rather than a comment beside one."""
    db.write(db.LEVELS, {"key": "k", "body": {}, "learner_ref": "abc", "meter_key": "sub:1"})
    written = fake.all_rows("levels")[0]
    assert "learner_ref" not in written
    assert "meter_key" not in written


def test_a_row_with_no_key_is_refused_before_the_wire(fake: FakePostgrest, cache: Path) -> None:
    """An insert with no key would sit in the table forever and never be found by a read."""
    assert db.write(db.LEVELS, {"body": {"a": 1}}) is None
    assert fake.all_rows("levels") == []


def test_a_write_to_a_store_nobody_declared_is_refused(fake: FakePostgrest, cache: Path) -> None:
    assert db.write("secrets", {"key": "k", "body": {}}) is None
    assert db.read("secrets", "k") is None


def test_the_loser_of_a_race_serves_the_winners_row(fake: FakePostgrest, cache: Path) -> None:
    """Two replicas generate the same artifact at the same instant. One wins the partial unique
    index; the other must serve what the winner wrote, not fail and not regenerate."""
    first = db.write(db.LEVELS, {"key": "k", "body": {"say": "first"}, "cost_usd": 0.01})
    assert first is not None
    second = db.write(db.LEVELS, {"key": "k", "body": {"say": "second"}})
    assert second is not None
    assert second["id"] == first["id"]
    assert second["body"] == {"say": "first"}


def test_a_superseding_row_retires_the_one_it_names(fake: FakePostgrest, cache: Path) -> None:
    """Version, never overwrite: the old row stays, for the learner mid-chapter and for the
    revert, and the read serves the new one."""
    old = db.write(db.LEVELS, {"key": "k", "body": {"v": 1}})
    new = db.write(
        db.LEVELS, {"key": "k", "body": {"v": 2}, "supersedes": old["id"], "version": 2}
    )
    assert new is not None
    assert len(fake.all_rows("levels")) == 2
    assert db.read(db.LEVELS, "k")["body"] == {"v": 2}


def test_a_rejected_regeneration_does_not_retire_the_row_that_beat_it(
    fake: FakePostgrest, cache: Path
) -> None:
    """A loser does not retire the winner. This is the whole reason the trigger checks the status
    of the row being inserted rather than only the presence of `supersedes`."""
    good = db.write(db.LEVELS, {"key": "k", "body": {"v": 1}})
    db.write(
        db.LEVELS,
        {"key": "k", "body": {"v": 2}, "supersedes": good["id"], "status": "rejected"},
    )
    assert db.read(db.LEVELS, "k")["body"] == {"v": 1}


def test_a_level_row_carries_its_judge_score_model_and_cost(
    fake: FakePostgrest, cache: Path
) -> None:
    """Provenance, the judge, the model and the money: the four things that make a stored artifact
    auditable rather than merely present."""
    store.save("photosynthesis", "reading", "core", _record(), SCOPE)
    row = fake.all_rows("levels")[0]
    assert row["judge_score"] == 4.4
    assert row["model"] == "gemini/luna"
    assert row["cost_usd"] == 0.002
    assert row["provenance"]["engine"] == "engine.compose"
    assert row["board"] == "CBSE"
    assert row["grade"] == "Class 8"
    assert row["content_version"] == "2026-27"


def test_the_key_a_row_is_filed_under_is_the_key_the_file_is(cache: Path) -> None:
    """One definition of a key. The database key and the file path are the same computation, so a
    change to one cannot silently split the two tiers apart."""
    key = store.cache_key("photosynthesis", "reading", "core", SCOPE)
    path = store.artifact_path("photosynthesis", "reading", "core", SCOPE)
    assert key == f"{path.parent.name}/{path.stem}"
    # …and the scoped key still differs from the unscoped one, which is wave 30's whole finding.
    assert key != store.cache_key("photosynthesis", "reading", "core", None)


# --- the stores desk ---------------------------------------------------------------------------


def test_the_console_desk_shows_the_process_and_the_stored_reading(
    fake: FakePostgrest, cache: Path
) -> None:
    """Two readings that disagree by design, exactly as `/usage` shows the rollup beside the live
    ceiling: what THIS container has seen since it started, and what the rows themselves say."""
    from wobo_gateway.console_api import register_console

    store.save("photosynthesis", "reading", "core", _record(), SCOPE)
    store.load("photosynthesis", "reading", "core", SCOPE)

    seen: dict[str, Any] = {}

    class _Router:
        def get(self, path: str):
            def wrap(fn):
                seen[path] = fn
                return fn

            return wrap

        def post(self, path: str):
            return self.get(path)

    class _App:
        def include_router(self, router) -> None:
            pass

    import wobo_gateway.console_api as console_api

    original = console_api.admin_router
    console_api.admin_router = lambda **_: _Router()
    try:
        register_console(_App())
    finally:
        console_api.admin_router = original

    class _Ctx:
        def audit(self, *args, **kwargs) -> None:
            self.audited = args[0]

    ctx = _Ctx()
    desk = seen["/stores"](ctx)
    assert ctx.audited == "console.stores.read"
    assert desk["process"]["stores"]["levels"]["front_hits"] == 1
    assert desk["stored"][0]["store"] == "levels"

    db.reset()
    assert seen["/stores"](_Ctx())["stored"] is None, (
        "an unreadable view must read as unreadable, never as a table of zeroes"
    )
