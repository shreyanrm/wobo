"""A seat without the money panel sees no money, on any desk it still holds.

THE DEFECT THIS PINS (closer, 2026-09-17). The panel gate refused ``/usage``, ``/economics``,
``/billing``, ``/allowance`` and ``/promo`` to an operator whose ``panel.money.read`` had been
revoked, and the same figures came straight back through desks the seat still held: ``/health``
carried the day's spend and ceiling, ``/syllabus`` the day's spend, ceiling and a cost list,
``/stores`` the money a serve saved, and ``/models`` every price, the creative pool's cap and the
spend by tier. The law (docs/CONSOLE-ROLES-AND-BOARD.md §2) says a panel a person cannot read "is
not there", and "nothing leaks by way of a URL somebody remembers". A panel whose figures ride on
four other desks is there.

So the test walks EVERY mounted admin read, not the four we found, because the next desk that
carries a price will not announce itself.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi.testclient import TestClient
from test_console_roles import (  # noqa: F401 - the fixtures are used by name
    OPERATOR_SUBJECT,
    OWNER_SUBJECT,
    _admin_env,
    _console,
    _register,
    _sign_in,
    client,
)
from wobo_gateway import admin_auth, console_panels
from wobo_gateway.admin_auth import ADMIN_PREFIX, OPERATOR, OWNER, VIEWER, InMemoryAdminStore

#: A key that names money. Broader than the redactor on purpose: this is the net, not the knife.
MONEY = re.compile(r"usd|paise|inr|rupee|price|cost|spend|spent|ceiling|saved|per_million", re.I)


def _money_keys(value: Any, where: str = "") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, inner in value.items():
            here = f"{where}.{key}"
            if MONEY.search(str(key)):
                found.append(here)
            found.extend(_money_keys(inner, here))
    elif isinstance(value, list):
        for index, inner in enumerate(value):
            found.extend(_money_keys(inner, f"{where}[{index}]"))
    return found


def _readable_admin_gets(client: TestClient) -> list[str]:
    paths: list[str] = []
    for path, route, _deps in admin_auth.iter_api_routes(client.app):
        if not path.startswith(ADMIN_PREFIX) or "{" in path:
            continue
        if "GET" in (getattr(route, "methods", None) or set()):
            paths.append(path)
    return sorted(set(paths))


def _seat_without_money(store: InMemoryAdminStore, role: str = OPERATOR) -> None:
    _register(store, OWNER_SUBJECT, OWNER, "owner@example.com")
    seat = _register(store, OPERATOR_SUBJECT, role, "ops@example.com")
    for capability in ("panel.money.read", "panel.money.act"):
        store.set_capability(
            admin_id=seat.id, capability=capability, effect="revoke", granted_by=None
        )


def test_no_desk_this_seat_still_holds_carries_a_money_figure(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _seat_without_money(_admin_env)
    headers = _console(OPERATOR_SUBJECT, _sign_in(client, OPERATOR_SUBJECT))
    paths = _readable_admin_gets(client)
    # The four desks the leak was found on are in the walk; if one moves, this says so.
    for known in ("/health", "/syllabus", "/stores", "/models"):
        assert f"{ADMIN_PREFIX}{known}" in paths

    leaks: dict[str, list[str]] = {}
    answered: list[str] = []
    for path in paths:
        response = client.get(path, headers=headers)
        if response.status_code != 200:
            continue
        answered.append(path)
        found = _money_keys(response.json())
        if found:
            leaks[path] = found[:8]
    assert f"{ADMIN_PREFIX}/health" in answered and f"{ADMIN_PREFIX}/models" in answered
    assert not leaks, f"money on desks a seat without the money panel still reads: {leaks}"


def test_a_viewer_with_money_revoked_sees_none_either(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _seat_without_money(_admin_env, role=VIEWER)
    headers = _console(OPERATOR_SUBJECT, _sign_in(client, OPERATOR_SUBJECT))
    for desk in ("/health", "/syllabus", "/stores", "/models"):
        response = client.get(f"{ADMIN_PREFIX}{desk}", headers=headers)
        assert response.status_code == 200, desk
        assert not _money_keys(response.json()), desk


def test_a_seat_that_holds_the_money_panel_still_sees_every_figure(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """The redaction is the absence of a capability, never a blanket. The owner loses nothing."""
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    headers = _console(OWNER_SUBJECT, _sign_in(client, OWNER_SUBJECT))
    health = client.get(f"{ADMIN_PREFIX}/health", headers=headers).json()
    assert health["checks"]["spend"]["ceiling_usd"] > 0
    models = client.get(f"{ADMIN_PREFIX}/models", headers=headers).json()
    assert "price" in models["tiers"][0]
    assert "ceiling_usd" in models["spend"]
    syllabus = client.get(f"{ADMIN_PREFIX}/syllabus", headers=headers).json()
    assert "ceiling_usd" in syllabus["day"]
    stores = client.get(f"{ADMIN_PREFIX}/stores", headers=headers).json()
    assert "saved_usd_total" in stores["process"]


def test_what_is_not_money_survives_the_redaction() -> None:
    """The desk keeps its job: which model carries what, the queue, the hit rates."""
    held = console_panels.effective(OPERATOR, revokes=("panel.money.read",))
    payload = {
        "tiers": [{"tier": "turn", "primary": "m", "price": {"per_million_in": 1.0}}],
        "day": {"spent_usd": 1.0, "ceiling_usd": 25.0, "fraction": 0.04, "shedding": False},
        "creative_pool": {"cap_usd": 40.0, "alert_fractions": [0.5], "created_today": 3},
        "judge": {"fraction": 0.9},
        "cost": [{"board": "cbse", "usd": 1}],
    }
    out = console_panels.without_money(payload, held)
    assert out == {
        "tiers": [{"tier": "turn", "primary": "m"}],
        "day": {"shedding": False},
        "creative_pool": {"created_today": 3},
        # A fraction that sits beside no money figure is not a share of the ceiling. It stays.
        "judge": {"fraction": 0.9},
    }
    # And a seat that holds the panel gets the payload untouched.
    assert console_panels.without_money(payload, console_panels.CAPABILITIES) is payload
