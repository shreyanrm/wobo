"""The consent tier is derived, never declared.

The audit's finding was that ``consent_tier`` arrived in the request body: any caller could
type ``"elevated"`` and walk through an elevated-only door. These tests hold that shut.
"""

from __future__ import annotations

import pytest
from wobo_gateway import budget, consent
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.registry import ConsentTier
from wobo_gateway.telemetry import MetricsSink


def client():
    from fastapi.testclient import TestClient

    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


# --- the door -------------------------------------------------------------------------
def test_a_body_that_claims_elevated_is_ignored(auth) -> None:
    response = client().post(
        "/v1/capability/archetype.classify",
        json={"consent_tier": "elevated", "payload": {}},
        headers=auth(),
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_allowed"


def test_a_token_that_claims_elevated_is_ignored(auth) -> None:
    """Even a validly signed token cannot carry its own consent tier."""
    response = client().post(
        "/v1/capability/archetype.classify",
        json={"payload": {}},
        headers=auth("claimer", consent_tier="elevated", plan="plus"),
    )
    assert response.status_code == 403


def test_the_stored_tier_opens_the_door(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    monkeypatch.setattr(
        consent,
        "fetch_profile",
        lambda subject: consent.Profile(tier=ConsentTier.ELEVATED, plan="free"),
    )
    consent.reset_cache()
    response = client().post(
        "/v1/capability/archetype.classify", json={"payload": {}}, headers=auth("elevated-learner")
    )
    assert response.status_code == 200


def test_me_reports_the_derived_tier(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    monkeypatch.setattr(
        consent,
        "fetch_profile",
        lambda subject: consent.Profile(tier=ConsentTier.ELEVATED, plan="plus"),
    )
    consent.reset_cache()
    me = client().get("/v1/me", headers=auth("plus-learner")).json()
    assert me["consent_tier"] == "elevated"
    assert me["plan"] == "plus"
    # The plus dial, from the stored plan: the legacy name resolves to pro, which is five
    # times free (budget.py _MULTIPLIER, and DESIGN.md §0 "Pro is five times the free allowance").
    assert me["budget"]["turns_remaining"] == budget.limits_for("plus")[budget.TURN]


# --- the lookup -----------------------------------------------------------------------
def test_unknown_subject_falls_back_to_basic() -> None:
    assert consent.get_tier("nobody-we-know") is ConsentTier.UN_ELEVATED
    assert consent.get_plan("nobody-we-know") == "free"


def test_anonymous_never_reaches_the_database(monkeypatch: pytest.MonkeyPatch) -> None:
    def explode(subject: str) -> None:
        raise AssertionError("anonymous learners have no stored record to read")

    monkeypatch.setattr(consent, "fetch_profile", explode)
    assert consent.get_tier("anon-x", anonymous=True) is ConsentTier.UN_ELEVATED


def test_a_failed_lookup_is_least_privilege(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(consent, "fetch_profile", lambda subject: None)
    consent.reset_cache()
    assert consent.get_profile("outage") == consent.DEFAULT_PROFILE


def test_the_lookup_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def counted(subject: str) -> consent.Profile:
        calls.append(subject)
        return consent.Profile(tier=ConsentTier.ELEVATED, plan="free")

    monkeypatch.setattr(consent, "fetch_profile", counted)
    consent.reset_cache()
    consent.get_tier("cached-learner")
    consent.get_tier("cached-learner")
    assert calls == ["cached-learner"]


@pytest.mark.parametrize(
    "stored,expected",
    [
        ("elevated", ConsentTier.ELEVATED),
        ("ELEVATED", ConsentTier.ELEVATED),
        ("basic", ConsentTier.UN_ELEVATED),
        ("", ConsentTier.UN_ELEVATED),
        (None, ConsentTier.UN_ELEVATED),
        ("something-nobody-wrote", ConsentTier.UN_ELEVATED),
    ],
)
def test_stored_values_coerce_safely(stored: str | None, expected: ConsentTier) -> None:
    assert consent._coerce_tier(stored) is expected


# --- the lookup points at the table that actually exists ------------------------------
def _capture(monkeypatch: pytest.MonkeyPatch, rows: list[dict]) -> dict:
    """Run one fetch_profile against a fake PostgREST and hand back the request it made."""
    import json

    seen: dict = {}

    class FakeResponse:
        def read(self) -> bytes:
            return json.dumps(rows).encode()

        def __enter__(self) -> FakeResponse:
            return self

        def __exit__(self, *_: object) -> None:
            return None

    def urlopen(request, timeout=None):  # noqa: ANN001, ARG001
        seen["url"] = request.full_url
        seen["headers"] = {k.lower(): v for k, v in request.headers.items()}
        return FakeResponse()

    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setattr(consent.urllib.request, "urlopen", urlopen)
    return seen


def test_the_lookup_reads_learner_profiles_cache_by_subject_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The live project has no ``public.profiles``. The row is ``learner.profiles_cache`` keyed
    by ``subject_id`` (migrations 0002 + 0006), and PostgREST selects the schema by header —
    without it every read lands in ``public`` and silently downgrades every learner."""
    for var in ("SUPABASE_CONSENT_SCHEMA", "SUPABASE_CONSENT_TABLE", "SUPABASE_CONSENT_ID_COLUMN"):
        monkeypatch.delenv(var, raising=False)
    seen = _capture(monkeypatch, [{"consent_tier": "elevated", "plan": "plus"}])
    profile = consent.fetch_profile("subject-1")
    assert "/rest/v1/profiles_cache?" in seen["url"]
    assert "subject_id=eq.subject-1" in seen["url"]
    assert seen["headers"]["accept-profile"] == "learner"
    assert profile == consent.Profile(tier=ConsentTier.ELEVATED, plan="plus")


def test_the_schema_table_and_id_column_stay_overridable(monkeypatch: pytest.MonkeyPatch) -> None:
    """A deploy that moves the profile behind a governed view is config, not a code change."""
    monkeypatch.setenv("SUPABASE_CONSENT_SCHEMA", "governed")
    monkeypatch.setenv("SUPABASE_CONSENT_TABLE", "profile_view")
    monkeypatch.setenv("SUPABASE_CONSENT_ID_COLUMN", "sub")
    seen = _capture(monkeypatch, [{"consent_tier": "un_elevated", "plan": "free"}])
    consent.fetch_profile("subject-2")
    assert "/rest/v1/profile_view?" in seen["url"] and "sub=eq.subject-2" in seen["url"]
    assert seen["headers"]["accept-profile"] == "governed"


@pytest.mark.parametrize(
    "stored,tier,plan",
    [
        ({"consent_tier": "un_elevated", "plan": "free"}, ConsentTier.UN_ELEVATED, "free"),
        ({"consent_tier": "un_elevated", "plan": "plus"}, ConsentTier.UN_ELEVATED, "plus"),
        ({"consent_tier": "elevated", "plan": "free"}, ConsentTier.ELEVATED, "free"),
        ({"consent_tier": "elevated", "plan": "plus"}, ConsentTier.ELEVATED, "plus"),
    ],
)
def test_the_four_values_the_database_can_hold(
    monkeypatch: pytest.MonkeyPatch, stored: dict, tier: ConsentTier, plan: str
) -> None:
    """``consent_tier`` is checked to ('un_elevated','elevated') and ``plan`` to ('free','plus'),
    so these four rows are everything the table can produce."""
    _capture(monkeypatch, [stored])
    assert consent.fetch_profile("subject-3") == consent.Profile(tier=tier, plan=plan)


def test_a_row_is_read_whatever_its_column_is_called(monkeypatch: pytest.MonkeyPatch) -> None:
    import json

    class FakeResponse:
        def read(self) -> bytes:
            return json.dumps([{"tier": "elevated", "subscription": "plus"}]).encode()

        def __enter__(self) -> FakeResponse:
            return self

        def __exit__(self, *_: object) -> None:
            return None

    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setattr(consent.urllib.request, "urlopen", lambda *a, **k: FakeResponse())
    profile = consent.fetch_profile("row-learner")
    assert profile == consent.Profile(tier=ConsentTier.ELEVATED, plan="plus")


def test_no_database_configured_means_no_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setattr(
        consent.urllib.request,
        "urlopen",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not reach the network")),
    )
    assert consent.fetch_profile("anyone") is None
