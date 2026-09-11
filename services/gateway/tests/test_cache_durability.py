"""NOTHING GENERATED SURVIVES A DEPLOY, AND THE GATEWAY SAID NOTHING ABOUT IT.

docs/CACHES.md: *"the database is the truth when the container is new."* The three-layer economy
rests on it — a core costs about USD 0.031 and is made once, forever — and on 2026-09-10 neither
half of that was true of the running gateway. ``PLEXUS_CACHE_DIR`` pointed at
``/home/gateway/cache``, a path in the container's own writable layer, no volume was declared
anywhere in the repo, and the content schema's migrations were unapplied, so a configured
PostgREST answered every content read 406. Every deploy threw away every core, level, design and
turn, and they were bought again — silently, because nothing in the gateway ever said which of the
two truths it was running without.

Three things are pinned here:

1. the cache follows an attached volume (``RAILWAY_VOLUME_MOUNT_PATH``) without anyone editing an
   env var by hand, so attaching one is all it takes;
2. the image points its cache at the mount path rather than at the writable layer;
3. a gateway with neither a durable cache nor a reachable store SAYS SO, in the one place an
   operator already looks. A silent ephemeral cache is the failure this file exists for.
"""

from __future__ import annotations

from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


# --- 1. the cache follows the volume ----------------------------------------------------------


def test_the_cache_follows_an_attached_volume(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway.plexus import store

    monkeypatch.delenv("PLEXUS_CACHE_DIR", raising=False)
    monkeypatch.setenv("RAILWAY_VOLUME_MOUNT_PATH", "/data")
    assert store.cache_dir() == Path("/data/plexus")
    assert store.cache_is_durable() is True


def test_an_explicit_path_still_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    """A lab, a test and a developer's laptop all set the path themselves, and they keep it."""
    from wobo_gateway.plexus import store

    monkeypatch.setenv("RAILWAY_VOLUME_MOUNT_PATH", "/data")
    monkeypatch.setenv("PLEXUS_CACHE_DIR", "/tmp/lab-cache")
    assert store.cache_dir() == Path("/tmp/lab-cache")


def test_a_cache_on_the_writable_layer_is_not_durable(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway.plexus import store

    monkeypatch.delenv("RAILWAY_VOLUME_MOUNT_PATH", raising=False)
    monkeypatch.setenv("PLEXUS_CACHE_DIR", "/home/gateway/cache")
    assert store.cache_is_durable() is False


def test_a_cache_inside_the_mount_is_durable_however_it_was_named(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway.plexus import store

    monkeypatch.setenv("RAILWAY_VOLUME_MOUNT_PATH", "/data")
    monkeypatch.setenv("PLEXUS_CACHE_DIR", "/data/cache")
    assert store.cache_is_durable() is True


# --- 2. the image ---------------------------------------------------------------------------


def test_the_image_caches_onto_the_mount_path_and_not_the_writable_layer() -> None:
    dockerfile = (REPO / "services/gateway/Dockerfile").read_text(encoding="utf-8")
    assert "PLEXUS_CACHE_DIR=/data/plexus" in dockerfile
    assert "WOBO_IMAGE_CACHE_DIR=/data/plexus/images" in dockerfile
    # The mount point exists in the image and belongs to the user that writes it, or an attached
    # volume mounts onto a directory the gateway cannot write and every save fails at runtime.
    assert 'VOLUME ["/data"]' in dockerfile
    assert "PLEXUS_CACHE_DIR=/home/gateway/cache" not in dockerfile


# --- 3. the gateway says which truth it is running without ------------------------------------


def _persistence(monkeypatch: pytest.MonkeyPatch) -> dict:
    from wobo_gateway import health

    return health.snapshot()["checks"]["persistence"]


def test_prod_with_no_volume_and_no_store_is_degraded_and_says_why(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway.plexus import db

    monkeypatch.setenv("ENV", "prod")
    monkeypatch.delenv("RAILWAY_VOLUME_MOUNT_PATH", raising=False)
    monkeypatch.setenv("PLEXUS_CACHE_DIR", "/home/gateway/cache")
    db.reset()
    check = _persistence(monkeypatch)
    assert check["status"] == "degraded"
    assert check["durable"] is False
    assert "deploy" in check["reason"]


def test_a_volume_alone_is_enough_to_be_healthy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("RAILWAY_VOLUME_MOUNT_PATH", "/data")
    monkeypatch.delenv("PLEXUS_CACHE_DIR", raising=False)
    check = _persistence(monkeypatch)
    assert check["status"] == "ok"
    assert check["durable"] is True


def test_dev_is_never_degraded_for_running_off_a_laptop(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "dev")
    monkeypatch.delenv("RAILWAY_VOLUME_MOUNT_PATH", raising=False)
    assert _persistence(monkeypatch)["status"] == "ok"
