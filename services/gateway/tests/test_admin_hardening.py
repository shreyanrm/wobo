"""The console's second pass: the leaks, the lies and the broken readings, each pinned by a test.

Every test here fails against the console as it was first written. They are grouped in the order
the fixes were made, which is the order the risk runs in: what LEAKS first, because this console
can see every child in the product; then what LIES, because the owner will price a plan on these
numbers; then what is BROKEN; then what is sloppy.

The shape of a leak test is fixed: it sets up somebody who should not get the thing — a stranger
with no token, a signed-in learner, an admin in the lowest seat — and asserts they do not get it.
A test that only proves the right person succeeds proves nothing about a door.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from wobo_gateway import (
    admin_auth,
    budget,
    console_api,
    health,
    ledger,
    reports,
    unit_economics,
)
from wobo_gateway.admin_auth import (
    ADMIN_PREFIX,
    CONSOLE_READ,
    LEARNER_READ,
    OPERATOR,
    OWNER,
    PERMISSIONS,
    VIEWER,
    InMemoryAdminStore,
)
from wobo_gateway.reports import InMemoryReportStore, Report

OWNER_SUBJECT = "61111111-1111-4111-8111-111111111111"
VIEWER_SUBJECT = "62222222-2222-4222-8222-222222222222"
OPERATOR_SUBJECT = "63333333-3333-4333-8333-333333333333"
LEARNER_SUBJECT = "64444444-4444-4444-8444-444444444444"
OTHER_LEARNER = "65555555-5555-4555-8555-555555555555"


@pytest.fixture(autouse=True)
def _console_env(monkeypatch: pytest.MonkeyPatch) -> InMemoryAdminStore:
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.setenv("REPORTS_STORE", "memory")
    monkeypatch.setenv("REPORTS_HANDLE_PEPPER", "a-test-pepper-for-the-queue-handle")
    monkeypatch.delenv("ENV", raising=False)
    monkeypatch.delenv("DEV_AUTH", raising=False)
    store = InMemoryAdminStore()
    admin_auth.set_store(store)
    admin_auth.reset_limiter()
    reports.set_store(InMemoryReportStore())
    yield store
    admin_auth.set_store(None)
    reports.set_store(None)


@pytest.fixture()
def client() -> TestClient:
    from wobo_gateway.app import create_app

    return TestClient(create_app())


def _bearer(subject: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET)}"}


def _seat(
    client: TestClient, store: InMemoryAdminStore, subject: str, role: str
) -> dict[str, str]:
    """Register somebody at one level and sign them into the console."""
    store.upsert_admin(
        subject_id=subject,
        email=f"{role}@example.com",
        role=role,
        granted_by=None,
        mfa_required=False,
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(subject))
    assert opened.status_code == 200, opened.text
    return {**_bearer(subject), admin_auth.SESSION_HEADER: opened.json()["session_token"]}


# =================================================================================================
# LEAKS
# =================================================================================================
def test_the_published_spec_names_no_admin_route(client: TestClient) -> None:
    """``/openapi.json`` is not under ``/v1``, so the front door never sees a request for it.

    It answered 200 to anybody off prod and listed thirteen ``/v1/admin`` paths with their methods
    and full request and response schemas — the whole operator API map, published, with the console
    bundle kept scrupulously separate for exactly the disclosure one curl was handing out.
    """
    spec = client.get("/openapi.json")
    assert spec.status_code == 200  # still published: this is a dev/staging convenience
    assert [path for path in spec.json()["paths"] if ADMIN_PREFIX in path] == []
    assert ADMIN_PREFIX not in spec.text

    # And the two pages that render from it name nothing either.
    for page in ("/docs", "/redoc"):
        rendered = client.get(page)
        assert ADMIN_PREFIX not in rendered.text


def test_the_app_refuses_to_boot_with_an_unguarded_admin_route(client: TestClient) -> None:
    """The guard was carried by the router and could still be bypassed by one decorator.

    ``@app.get(ADMIN_PREFIX + ...)`` mounted a route with no guard at all, and the only thing
    standing against it was a test — a thing somebody can skip, xfail, or simply not run on the box
    that deploys. This is the same check at start-up, where the consequence is a gateway that will
    not serve rather than a console that quietly serves the wrong person.
    """
    app = client.app

    @app.get(f"{ADMIN_PREFIX}/oops")
    def unguarded() -> dict[str, str]:  # pragma: no cover — never reached
        return {"every": "learner"}

    with pytest.raises(RuntimeError, match="without the console guard"):
        admin_auth.assert_admin_surface(app)


def test_the_app_refuses_to_boot_with_a_published_admin_route(client: TestClient) -> None:
    """The second half of the same rule: guarded is not enough if the map is public."""
    app = client.app
    router = admin_auth.admin_router(include_in_schema=True)

    @router.get("/loud")
    def loud() -> dict[str, str]:  # pragma: no cover — never reached
        return {"every": "learner"}

    app.include_router(router)
    assert f"GET {ADMIN_PREFIX}/loud" in admin_auth.schema_visible_admin_routes(app)
    with pytest.raises(RuntimeError, match="published in /openapi.json"):
        admin_auth.assert_admin_surface(app)


def test_create_app_actually_runs_the_surface_check(monkeypatch: pytest.MonkeyPatch) -> None:
    """The two checks above are only worth anything if boot runs them. This is that wiring.

    It is asserted separately because a check nobody calls is a comment with a docstring.
    """
    from wobo_gateway import app as app_module

    ran: list[Any] = []
    monkeypatch.setattr(app_module, "assert_admin_surface", lambda app: ran.append(app))
    built = app_module.create_app()
    assert ran == [built]


def test_the_open_health_probe_publishes_no_money(client: TestClient) -> None:
    """``/healthz`` is unauthenticated and used to return ``spend.state()`` verbatim.

    The day's model spend, the ceiling, the fraction between them and the call volume — the exact
    figures the console guards behind a register, a TOTP factor, a revocable session and an audit
    row per look, readable by anybody on the internet with one curl.
    """
    from wobo_gateway import spend

    spend.record(3.25)
    body = client.get("/healthz").json()
    assert body["status"] in ("ok", "degraded", "unhealthy")
    assert body["checks"]["spend"]["status"] in ("ok", "degraded", "fail")
    for money in ("spent_usd", "ceiling_usd", "fraction", "calls"):
        assert money not in body["checks"]["spend"], f"/healthz still publishes {money}"
    assert "3.25" not in client.get("/healthz").text

    # And the console, which pays a session and an audit row for the look, still gets all of it.
    assert health.snapshot()["checks"]["spend"]["spent_usd"] == pytest.approx(3.25)


def test_the_console_health_desk_still_carries_the_figures(
    client: TestClient, _console_env: InMemoryAdminStore
) -> None:
    """The money did not disappear; it moved behind the door, where a look is recorded."""
    from wobo_gateway import spend

    spend.record(1.5)
    headers = _seat(client, _console_env, OWNER_SUBJECT, VIEWER)
    body = client.get(f"{ADMIN_PREFIX}/health", headers=headers).json()
    assert body["checks"]["spend"]["spent_usd"] == pytest.approx(1.5)


def test_the_lowest_seat_cannot_identify_a_child() -> None:
    """``viewer`` is described as "see everything, change nothing" and carried ``learner.read``.

    ``learner.read`` is ``GET /v1/admin/reports/who``, which answers with a learner's real subject
    id and the address a parent typed on a refund request. Reading is the risk this console is
    written against: the harm is somebody LOOKING, and looking leaves no other mark.
    """
    assert LEARNER_READ not in PERMISSIONS[VIEWER]
    assert PERMISSIONS[VIEWER] == frozenset({CONSOLE_READ})
    # It stays where the work is: a seat that may act on a case may find out whose case it is.
    assert LEARNER_READ in PERMISSIONS[OPERATOR]
    assert LEARNER_READ in PERMISSIONS[OWNER]


def test_a_viewer_is_refused_the_route_that_names_a_learner(
    client: TestClient, _console_env: InMemoryAdminStore
) -> None:
    """The permission table is the rule; this is the door actually holding it."""
    client.post(
        "/v1/refund-request",
        json={"reason": "charged_twice", "note": "twice in March", "reply_to": "a@parent.test"},
        headers=_bearer(LEARNER_SUBJECT),
    )
    viewer = _seat(client, _console_env, VIEWER_SUBJECT, VIEWER)
    queue = client.get(f"{ADMIN_PREFIX}/reports", headers=viewer).json()
    report_id = queue["reports"][0]["id"]

    refused = client.get(f"{ADMIN_PREFIX}/reports/who", params={"id": report_id}, headers=viewer)
    assert refused.status_code == 403
    assert LEARNER_SUBJECT not in refused.text
    assert "a@parent.test" not in refused.text

    operator = _seat(client, _console_env, OPERATOR_SUBJECT, OPERATOR)
    allowed = client.get(f"{ADMIN_PREFIX}/reports/who", params={"id": report_id}, headers=operator)
    assert allowed.status_code == 200
    assert allowed.json()["reply_to"] == "a@parent.test"


def test_a_queue_handle_cannot_be_matched_against_a_learner_id(
    client: TestClient, _console_env: InMemoryAdminStore
) -> None:
    """``handle`` was ``learner_id[:8]`` — a raw prefix of the child's Supabase subject.

    The flag desk refuses ``/reports/who`` outright so a child's safety flag stays unattributed.
    A raw prefix defeated that: the same child's refund row DOES answer that route with the full
    id, and a full id starts with its own first eight characters, so a flag could be attributed by
    matching against a different desk.
    """
    client.post(
        "/v1/flags",
        json={"reason": "upsetting", "note": "it made me cry", "surface": "lesson"},
        headers=_bearer(LEARNER_SUBJECT),
    )
    client.post(
        "/v1/refund-request",
        json={"reason": "charged_twice", "note": "twice", "reply_to": "a@parent.test"},
        headers=_bearer(LEARNER_SUBJECT),
    )
    operator = _seat(client, _console_env, OPERATOR_SUBJECT, OPERATOR)
    rows = client.get(f"{ADMIN_PREFIX}/reports", headers=operator).json()["reports"]
    flag = next(row for row in rows if row["kind"] == "flag")
    refund = next(row for row in rows if row["kind"] == "refund")

    named = client.get(
        f"{ADMIN_PREFIX}/reports/who", params={"id": refund["id"]}, headers=operator
    ).json()
    assert named["learner_id"] == LEARNER_SUBJECT  # the route that is allowed to say it

    # The handle is not that id, nor a prefix of it, nor derivable from it without the pepper.
    assert flag["handle"] != LEARNER_SUBJECT[:8]
    assert not LEARNER_SUBJECT.startswith(flag["handle"])
    assert re.fullmatch(r"[0-9a-f]{8}", flag["handle"])
    # Still stable, which is the whole reason a handle exists: the same person twice, one morning.
    assert flag["handle"] == refund["handle"]


def test_two_learners_get_two_handles() -> None:
    assert reports.handle(LEARNER_SUBJECT) != reports.handle(OTHER_LEARNER)


def test_no_pepper_means_no_handle_rather_than_a_raw_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """An unkeyed digest of a uuid is one table away from being the uuid. So: no handle."""
    monkeypatch.delenv("REPORTS_HANDLE_PEPPER", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    assert reports.handle(LEARNER_SUBJECT) == "—"


def test_the_dev_seam_may_not_meet_a_real_admin_register(monkeypatch: pytest.MonkeyPatch) -> None:
    """``ENV=stg`` with ``DEV_AUTH=1`` was a header-authenticated owner console.

    ``app.validate_env`` refuses DEV_AUTH only in prod, and staging usually points at the
    production Supabase project. ``auth.authenticate`` mints a Principal straight from
    ``X-Wobo-Dev-Subject`` with no token and no signature, so one header naming a registered
    admin's subject opened a console session — and the register's own claim that a principal is
    "never from a header" was false everywhere but prod.
    """
    monkeypatch.setenv("ENV", "stg")
    monkeypatch.setenv("DEV_AUTH", "1")
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "a-service-role-key")
    monkeypatch.delenv("ADMIN_STORE", raising=False)
    with pytest.raises(RuntimeError, match="DEV_AUTH is refused"):
        admin_auth.validate_admin_env()

    # A throwaway in-memory register is fine: there is nothing behind it to protect.
    monkeypatch.setenv("ADMIN_STORE", "memory")
    admin_auth.validate_admin_env()


def test_the_dev_seam_is_still_allowed_with_no_project_at_all(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A local run with no Supabase reaches ``UnconfiguredAdminStore``, which refuses everything."""
    monkeypatch.setenv("ENV", "dev")
    monkeypatch.setenv("DEV_AUTH", "1")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    monkeypatch.delenv("ADMIN_STORE", raising=False)
    admin_auth.validate_admin_env()


# =================================================================================================
# LIES
# =================================================================================================
def test_a_relaxed_console_setting_is_refused_at_BOOT_not_at_the_first_console_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``validate_admin_env`` was reached only through ``build_store``, lazily.

    So a prod gateway with ``ADMIN_REQUIRE_MFA=0`` booted normally, served every learner request,
    and surfaced the misconfiguration as an unhandled 500 the first time somebody opened the
    console. It failed closed, which is the important half; the operator was told at the worst
    possible moment rather than at deploy.
    """
    from wobo_gateway.app import validate_env

    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "a-secret-long-enough-for-hs256-in-a-test")
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.delenv("DEV_AUTH", raising=False)
    with pytest.raises(RuntimeError, match="ADMIN_REQUIRE_MFA=0 is refused"):
        validate_env()


def test_a_memory_register_in_prod_is_refused_at_boot(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway.app import validate_env

    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "1")  # so the refusal under test is the store's
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "a-secret-long-enough-for-hs256-in-a-test")
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.delenv("DEV_AUTH", raising=False)
    with pytest.raises(RuntimeError, match="ADMIN_STORE=memory is refused"):
        validate_env()


def test_the_usage_read_says_how_old_the_rollup_behind_it_is(
    client: TestClient, _console_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every panel printed "as of HH:MM:SS UTC" from the moment of the FETCH, so it read as live.

    ``ops.usage_daily`` is rebuilt on a cadence (a quarter of an hour by default) on top of a five
    second flush, so today's row can be well behind reality. The rollup already stamped
    ``rolled_at`` on every row and ``read_daily`` selects ``*`` — the truth was on the wire and the
    envelope threw it away.
    """
    stamp = "2026-09-04T09:00:00+00:00"
    monkeypatch.setattr(
        ledger,
        "read_daily",
        lambda **_: [
            {"day": "2026-09-04", "cost_usd": 1, "calls": 1, "rolled_at": stamp},
            {"day": "2026-09-03", "cost_usd": 1, "calls": 1, "rolled_at": "2026-09-03T09:00:00Z"},
        ],
    )
    headers = _seat(client, _console_env, OWNER_SUBJECT, VIEWER)
    body = client.get(f"{ADMIN_PREFIX}/usage", headers=headers).json()
    assert body["rolled_at"] == stamp  # the NEWEST stamp, not the first row's
    assert body["rollup_interval_s"] == ledger.rollup_interval_s()


def test_rolled_at_is_none_rather_than_invented_when_no_row_carries_one() -> None:
    assert console_api.rolled_at(None) is None
    assert console_api.rolled_at([]) is None
    assert console_api.rolled_at([{"day": "2026-09-04"}]) is None


def test_a_price_we_typed_is_named_on_the_pacing_desk() -> None:
    """Gemini's text-to-speech publishes no per-second rate.

    ``plexus/media.py`` multiplies ``LEDGER_PRICE_SPOKEN_SECOND_USD`` by the seconds produced, so a
    per-unit rate derived back out of it is a restatement of a number an operator typed, not a
    measurement. ``configured_calls`` was carried all the way through the rollup and never produced
    a gap, so the free-day figure said nothing at all — on the one desk the owner will price from.
    """
    def _row(kind: str, *, configured: int, day: str) -> dict[str, Any]:
        return {
            "day": day,
            "capability": "wobo.turn",
            "model_served": "a-model",
            "plan": "free",
            "unit_kind": kind,
            "calls": 40,
            "configured_calls": configured,
            "unpriced_calls": 0,
            "unit_count": 400,
            "cost_usd": 4.0,
        }

    rows = [
        _row(ledger.SPOKEN_SECOND, configured=40, day="2026-09-04"),
        _row(ledger.TURN, configured=0, day="2026-09-04"),
        _row(ledger.GENERATION, configured=0, day="2026-09-03"),
    ]
    derived = unit_economics.derive(rows)
    spoken = next(u for u in derived.per_unit if u.unit_kind == ledger.SPOKEN_SECOND)
    assert spoken.usd_per_unit is not None
    assert spoken.gap is not None and "a figure we entered" in spoken.gap
    turn = next(u for u in derived.per_unit if u.unit_kind == ledger.TURN)
    assert turn.gap is None  # a real price table earns no caveat
    # And the day's own figure carries the count, so the panel can say so beside the money.
    assert derived.free_day.as_dict()["configured_calls"] > 0


def test_the_economics_route_answers_with_the_plan_it_actually_priced(
    client: TestClient, _console_env: InMemoryAdminStore
) -> None:
    """``budget.limits_for`` falls back to the FREE dials for a plan name it does not know.

    The route echoed the string it was handed, so a request for ``plan=plus`` came back as a
    free-plan figure labelled "plus", and the first person to add a plan switcher inherits a
    mislabelled price.
    """
    headers = _seat(client, _console_env, OWNER_SUBJECT, VIEWER)
    body = client.get(
        f"{ADMIN_PREFIX}/economics", params={"plan": "a-plan-nobody-configured"}, headers=headers
    ).json()
    assert body["plan"] == "free"
    assert body["asked_plan"] == "a-plan-nobody-configured"
    assert any("no allowance dials" in gap for gap in body["gaps"])


def test_resolve_plan_says_which_dials_a_name_lands_on() -> None:
    assert budget.resolve_plan("free") == "free"
    assert budget.resolve_plan("not-a-plan") == "free"
    assert budget.resolve_plan("anything", anonymous=True) == "anon"


def test_the_desk_counts_say_whether_they_reached_the_end_of_the_table(
    client: TestClient, _console_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``ops.reports`` only grows — closing is a state, and 0017 grants no delete.

    A single fixed page of 5000, ordered newest first, silently became a floor that dropped the
    OLDEST rows: an old, still-open urgent safety flag stops being counted while the tile above the
    desk says "none open" in mint, and nothing on screen says the tally was truncated.
    """
    truncated = reports.Counts(
        tally=(("flag", "new", False, 3),), complete=False, scanned=reports.COUNT_MAX_ROWS
    )
    monkeypatch.setattr(reports.get_store(), "counts", lambda: truncated)
    headers = _seat(client, _console_env, OWNER_SUBJECT, VIEWER)
    body = client.get(f"{ADMIN_PREFIX}/desks", headers=headers).json()
    assert body["complete"] is False
    assert body["scanned"] == reports.COUNT_MAX_ROWS


def test_a_postgrest_count_pages_instead_of_stopping_at_one_fixed_limit() -> None:
    """And it pages by the rows it RECEIVED, so PostgREST's own db-max-rows cannot silently cap it.

    A server that caps a page below what was asked for makes this slower; it must never make it
    wrong, and the old single request had no way to tell the two apart.
    """
    made = [
        {"kind": "flag", "state": "new", "urgent": True},
        {"kind": "flag", "state": "closed", "urgent": False},
        {"kind": "bug", "state": "new", "urgent": False},
    ]
    seen: list[dict[str, str]] = []

    class _Paging(reports.PostgrestReportStore):
        def __init__(self) -> None:  # no network, no base url
            self._served = 0

        def _call(self, method: str, params: dict[str, str], *, body: Any = None) -> Any:
            seen.append(dict(params))
            offset = int(params["offset"])
            # A server that ignores our limit and serves one row at a time.
            return made[offset : offset + 1]

    counted = _Paging().counts()
    assert counted.complete is True
    assert counted.scanned == len(made)
    assert dict(((k, s, u), n) for k, s, u, n in counted.tally) == {
        ("flag", "new", True): 1,
        ("flag", "closed", False): 1,
        ("bug", "new", False): 1,
    }
    assert [int(p["offset"]) for p in seen] == [0, 1, 2, 3]


def test_the_pricing_desk_can_see_the_ledger_s_own_losses(
    client: TestClient, _console_env: InMemoryAdminStore
) -> None:
    """``derive_window`` called ``read_daily`` and never ``ledger.state()``.

    So the derivation had no way to know a batch of rows was dropped to protect a lesson, and the
    pacing desk — the one the owner will price from — reported a complete figure over an
    incomplete ledger.
    """
    headers = _seat(client, _console_env, OWNER_SUBJECT, VIEWER)
    body = client.get(f"{ADMIN_PREFIX}/economics", headers=headers).json()
    assert set(ledger.state()) <= set(body["ledger"])
    assert "rolled_at" in body and "rollup_interval_s" in body


# =================================================================================================
# BROKEN
# =================================================================================================
def test_a_mistyped_id_is_a_refusal_and_not_an_outage(
    client: TestClient, _console_env: InMemoryAdminStore
) -> None:
    """``PostgrestAdminStore._uuid`` raised ``StoreUnavailable`` for a malformed value.

    Every caller maps that to 503 with an OUTAGE message, so a typo told the operator "I could not
    read the trail just now" while the database was perfectly fine. Mid-incident that is the
    difference between "the console is blind" and "you typed it wrong", and this console exists so
    somebody can tell those apart.
    """
    headers = _seat(client, _console_env, OWNER_SUBJECT, OWNER)
    typo = client.get(f"{ADMIN_PREFIX}/audit", params={"actor": "not-a-uuid"}, headers=headers)
    assert typo.status_code == 400
    assert typo.json()["detail"]["code"] == "not_an_id"

    missed = client.get(f"{ADMIN_PREFIX}/reports/who", params={"id": "nope"}, headers=headers)
    assert missed.status_code == 422
    assert missed.json()["detail"]["code"] == "not_a_report_id"


def test_a_malformed_id_is_its_own_exception_and_still_fails_closed() -> None:
    """It subclasses ``StoreUnavailable``, so nothing that already fails closed starts serving."""
    assert issubclass(admin_auth.BadIdentifier, admin_auth.StoreUnavailable)
    assert issubclass(reports.BadIdentifier, reports.StoreUnavailable)


def test_a_queue_page_says_it_is_a_page(
    client: TestClient, _console_env: InMemoryAdminStore
) -> None:
    """A desk with 200 open reports looked like a desk with 50, under a count from a different,
    separately-truncated source that disagreed with no explanation."""
    for index in range(3):
        client.post(
            "/v1/report/bug",
            json={"reason": "broken", "note": f"number {index}"},
            headers=_bearer(LEARNER_SUBJECT),
        )
    headers = _seat(client, _console_env, OWNER_SUBJECT, VIEWER)
    page = client.get(
        f"{ADMIN_PREFIX}/reports", params={"kind": "bug", "limit": 2}, headers=headers
    ).json()
    assert page["limit"] == 2
    assert page["shown"] == 2
    assert page["more"] is True

    whole = client.get(
        f"{ADMIN_PREFIX}/reports", params={"kind": "bug", "limit": 50}, headers=headers
    ).json()
    assert whole["shown"] == 3
    assert whole["more"] is False


def test_open_work_sorts_above_a_settled_urgent_row() -> None:
    """The order was urgent-then-newest across every state, so a CLOSED urgent flag outranked live
    open work and could fill the visible page while open rows sat below the cut."""
    store = InMemoryReportStore()
    now = datetime.now(UTC)
    store.insert(
        Report(
            id="11111111-1111-4111-8111-111111111111",
            kind="flag",
            state="closed",
            reason="upsetting",
            urgent=True,
            created_at=now,
        )
    )
    store.insert(
        Report(
            id="22222222-2222-4222-8222-222222222222",
            kind="flag",
            state="new",
            reason="wrong",
            urgent=False,
            created_at=now - timedelta(days=2),
        )
    )
    queued = store.queue(kind="flag", state=None, limit=10)
    assert [row.state for row in queued] == ["new", "closed"]


# =================================================================================================
# SLOPPY
# =================================================================================================
def test_a_viewer_reads_their_own_trail_and_nobody_else_s(
    client: TestClient, _console_env: InMemoryAdminStore
) -> None:
    """Every audit row carries the actor's full address, subject, session, address fingerprint and
    path. Read across everybody, that is a complete surveillance record of the owner's working day
    handed to the lowest seat — while ``_identity_view`` strips the domain off an admin's own
    address on the grounds that a shell needs a word to greet somebody by, not a mailbox."""
    owner = _seat(client, _console_env, OWNER_SUBJECT, OWNER)
    client.get(f"{ADMIN_PREFIX}/usage", headers=owner)  # the owner does something worth hiding

    viewer = _seat(client, _console_env, VIEWER_SUBJECT, VIEWER)
    theirs = client.get(f"{ADMIN_PREFIX}/audit", headers=viewer)
    assert theirs.status_code == 200
    assert theirs.json()["scope"] == "self"
    assert "owner@example.com" not in theirs.text
    assert OWNER_SUBJECT not in theirs.text
    assert all(row["actor_subject"] == VIEWER_SUBJECT for row in theirs.json()["rows"])

    # A viewer cannot get somebody else's rows by asking for them either.
    asked = client.get(f"{ADMIN_PREFIX}/audit", params={"actor": OWNER_SUBJECT}, headers=viewer)
    assert asked.json()["scope"] == "self"
    assert OWNER_SUBJECT not in asked.text

    # The owner — who can also revoke the seat that did the looking — reads the whole thing.
    whole = client.get(f"{ADMIN_PREFIX}/audit", headers=owner)
    assert whole.json()["scope"] == "everyone"
    assert any(row["actor_subject"] == VIEWER_SUBJECT for row in whole.json()["rows"])


def test_the_trail_is_still_append_only_from_the_outside(
    client: TestClient, _console_env: InMemoryAdminStore
) -> None:
    """Scoping a read must not have opened a write."""
    headers = _seat(client, _console_env, OWNER_SUBJECT, OWNER)
    for method in ("post", "put", "patch", "delete"):
        answer = getattr(client, method)(f"{ADMIN_PREFIX}/audit", headers=headers)
        assert answer.status_code == 405


def test_the_console_window_helper_still_reports_the_range_it_covered() -> None:
    since, until = console_api.window(400, today=date(2026, 9, 4))
    assert until == date(2026, 9, 4)
    assert (until - since).days == console_api.MAX_WINDOW_DAYS - 1
