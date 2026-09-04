"""The guard is carried by the router, so a forgotten check is impossible by construction.

This file is the test the brief asked for: it fails if an unguarded ``/v1/admin`` route is ever
added. It walks the BUILT application rather than reading the source, so it catches a route added
anywhere — a new module, a sub-router, a decorator on ``app`` directly.

There is exactly one admin path that is not behind the console-session guard, and it is named
here rather than excused in the code: ``POST /v1/admin/session`` is the login, and it cannot
require the session it exists to issue. It carries its own register check, its own second-factor
check and its own strict limiter; ``test_admin_auth.py`` drives all three. If a second exception
ever appears, this test fails and somebody has to argue for it in writing.
"""

from __future__ import annotations

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi import FastAPI
from fastapi.testclient import TestClient
from wobo_gateway import admin_auth
from wobo_gateway.admin_auth import (
    ADMIN_PREFIX,
    admin_router,
    guard,
    iter_api_routes,
    unguarded_admin_routes,
)

#: The login, and nothing else. Adding to this set is a security decision, not a formality.
UNGUARDED_BY_DESIGN = [f"POST {ADMIN_PREFIX}/session"]


@pytest.fixture(autouse=True)
def _empty_register(monkeypatch: pytest.MonkeyPatch):
    """An empty register, so a refusal here is "you are not an admin" and not "no store"."""
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    admin_auth.set_store(admin_auth.InMemoryAdminStore())
    admin_auth.reset_limiter()
    yield
    admin_auth.set_store(None)


@pytest.fixture()
def app() -> FastAPI:
    from wobo_gateway.app import create_app

    return create_app()


def test_every_admin_route_but_the_login_carries_the_guard(app: FastAPI) -> None:
    assert sorted(unguarded_admin_routes(app)) == sorted(UNGUARDED_BY_DESIGN)


def test_the_login_is_the_only_unguarded_method_on_its_own_path(app: FastAPI) -> None:
    """GET and DELETE on /v1/admin/session are guarded; only POST, the login, is not."""
    loose = unguarded_admin_routes(app)
    assert f"GET {ADMIN_PREFIX}/session" not in loose
    assert f"DELETE {ADMIN_PREFIX}/session" not in loose
    assert f"POST {ADMIN_PREFIX}/session" in loose


def test_the_check_actually_catches_a_forgotten_guard(app: FastAPI) -> None:
    """The test above is only worth anything if it fails when the rule is broken. Here it is
    broken on purpose: a route mounted straight on the app under the admin prefix."""

    @app.get(f"{ADMIN_PREFIX}/oops")
    def unguarded() -> dict[str, str]:  # pragma: no cover - never called
        return {"every": "learner"}

    assert f"GET {ADMIN_PREFIX}/oops" in unguarded_admin_routes(app)
    assert sorted(unguarded_admin_routes(app)) != sorted(UNGUARDED_BY_DESIGN)


def test_a_route_added_to_the_admin_router_is_guarded_without_being_asked(app: FastAPI) -> None:
    """The construction itself: nobody wrote a dependency on this endpoint, and it is still shut."""
    router = admin_router()

    @router.get("/newly-added-desk")
    def desk() -> dict[str, str]:  # pragma: no cover - never reached unguarded
        return {"every": "learner"}

    app.include_router(router)
    assert unguarded_admin_routes(app) == UNGUARDED_BY_DESIGN

    route = next(
        r for path, r, _ in iter_api_routes(app) if path == f"{ADMIN_PREFIX}/newly-added-desk"
    )
    assert guard in admin_auth.route_dependencies(route)

    client = TestClient(app)
    signed_in_learner = {"Authorization": f"Bearer {mint('a-learner', secret=TEST_JWT_SECRET)}"}
    refused = client.get(f"{ADMIN_PREFIX}/newly-added-desk", headers=signed_in_learner)
    assert refused.status_code == 403
    assert refused.json()["detail"]["message"] == admin_auth.NOT_FOR_YOU


def test_no_admin_route_is_open_to_the_world(app: FastAPI) -> None:
    """The app's own unauthenticated allowlist must never grow an admin path."""
    from wobo_gateway import app as app_module

    for path in app_module._OPEN_PATHS | app_module._SOFT_AUTH_PATHS:
        assert not path.startswith(ADMIN_PREFIX), f"{path} would skip the front door"


def test_the_admin_prefix_is_rate_limited_by_the_app(app: FastAPI) -> None:
    """The console's door must not be free to knock on: app.py counts admin paths too."""
    from pathlib import Path

    source = Path(app_module_file()).read_text()
    assert "path.startswith(ADMIN_PREFIX)" in source


def app_module_file() -> str:
    from wobo_gateway import app as app_module

    return app_module.__file__ or ""
