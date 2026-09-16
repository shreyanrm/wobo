"""The free tier: counted in the brain, never in the client."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from wobo_gateway import budget
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink


def client():
    from fastapi.testclient import TestClient

    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


BODY = {"payload": {}}


# --- classification -------------------------------------------------------------------
@pytest.mark.parametrize(
    "capability,kind",
    [
        ("wobo.turn", budget.TURN),
        ("tutor.turn", budget.TURN),
        ("grade.attempt", budget.TURN),
        ("generate.opener", budget.TURN),
        ("verify.math", budget.TURN),
        ("engine.compose", budget.GENERATION),
        ("engine.video", budget.GENERATION),
        ("generate.course", budget.GENERATION),
        ("podcast.build", budget.GENERATION),
    ],
)
def test_capabilities_are_classified(capability: str, kind: str) -> None:
    assert budget.classify(capability) == kind


def test_an_unknown_capability_is_still_metered() -> None:
    """A capability added tomorrow must not be free by accident."""
    assert budget.classify("something.brand.new") == budget.TURN


# --- the meter ------------------------------------------------------------------------
def test_charge_counts_down_and_then_refuses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FREE_DAILY_TURNS", "3")
    for expected in (2, 1, 0):
        assert budget.charge("s1", "wobo.turn").turns_remaining == expected
    with pytest.raises(budget.BudgetExhausted) as raised:
        budget.charge("s1", "wobo.turn")
    assert raised.value.kind == budget.TURN


def test_the_two_counters_are_independent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FREE_DAILY_GENERATIONS", "1")
    budget.charge("s2", "engine.compose")
    with pytest.raises(budget.BudgetExhausted):
        budget.charge("s2", "engine.compose")
    assert budget.charge("s2", "wobo.turn").turns_remaining > 0  # turns untouched


def test_refund_gives_the_call_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FREE_DAILY_TURNS", "1")
    budget.charge("s3", "wobo.turn")
    budget.refund("s3", "wobo.turn")
    assert budget.charge("s3", "wobo.turn").turns_remaining == 0


def test_anonymous_gets_the_smaller_allowance() -> None:
    free = budget.limits_for("free")
    anon = budget.limits_for("free", anonymous=True)
    plus = budget.limits_for("plus")
    assert anon[budget.TURN] < free[budget.TURN] < plus[budget.TURN]
    assert anon[budget.GENERATION] < free[budget.GENERATION] < plus[budget.GENERATION]


def test_an_anonymous_plus_claim_does_not_buy_a_bigger_allowance() -> None:
    """Anonymity wins over any plan a token might claim."""
    assert budget.limits_for("plus", anonymous=True) == budget.limits_for("free", anonymous=True)


def test_reset_is_the_next_utc_midnight() -> None:
    moment = budget.reset_at()
    assert (moment.hour, moment.minute, moment.second) == (0, 0, 0)


# --- over HTTP ------------------------------------------------------------------------
def test_429_with_headers_after_the_daily_turns(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    monkeypatch.setenv("FREE_DAILY_TURNS", "2")
    c = client()
    headers = auth()

    first = c.post("/v1/capability/tutor.turn", json=BODY, headers=headers)
    assert first.status_code == 200
    assert first.headers["X-Wobo-Budget-Remaining"] == "1"
    assert first.headers["X-Wobo-Budget-Reset"]

    assert c.post("/v1/capability/tutor.turn", json=BODY, headers=headers).status_code == 200

    spent = c.post("/v1/capability/tutor.turn", json=BODY, headers=headers)
    assert spent.status_code == 429
    assert spent.json()["code"] == "budget_exhausted"
    assert spent.headers["X-Wobo-Budget-Remaining"] == "0"
    assert spent.headers["X-Wobo-Budget-Reset"]
    # Wobo's voice, and no price
    message = spent.json()["message"]
    assert "₹" not in message and "$" not in message


def test_one_learners_spend_is_not_anothers(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    monkeypatch.setenv("FREE_DAILY_TURNS", "1")
    c = client()
    assert c.post("/v1/capability/tutor.turn", json=BODY, headers=auth("a")).status_code == 200
    assert c.post("/v1/capability/tutor.turn", json=BODY, headers=auth("a")).status_code == 429
    assert c.post("/v1/capability/tutor.turn", json=BODY, headers=auth("b")).status_code == 200


def test_anonymous_learner_runs_out_sooner(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    monkeypatch.setenv("ANON_DAILY_TURNS", "1")
    monkeypatch.setenv("FREE_DAILY_TURNS", "50")
    c = client()
    anon = auth("anon-visitor", anonymous=True)
    assert c.post("/v1/capability/tutor.turn", json=BODY, headers=anon).status_code == 200
    assert c.post("/v1/capability/tutor.turn", json=BODY, headers=anon).status_code == 429
    # a signed-in learner on the same box is unaffected
    assert c.post("/v1/capability/tutor.turn", json=BODY, headers=auth("real")).status_code == 200


def test_an_unknown_capability_costs_nothing(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    """A 404 is not a turn."""
    monkeypatch.setenv("FREE_DAILY_TURNS", "1")
    c = client()
    headers = auth()
    assert c.post("/v1/capability/nope.turn", json=BODY, headers=headers).status_code == 404
    assert c.post("/v1/capability/tutor.turn", json=BODY, headers=headers).status_code == 200


def test_a_closed_consent_door_is_refunded(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    monkeypatch.setenv("FREE_DAILY_TURNS", "1")
    c = client()
    headers = auth()
    denied = c.post("/v1/capability/archetype.classify", json=BODY, headers=headers)
    assert denied.status_code == 403
    # the turn is still there — the gate refused, so it was never spent
    assert c.post("/v1/capability/tutor.turn", json=BODY, headers=headers).status_code == 200


def test_me_reports_what_is_left(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    monkeypatch.setenv("FREE_DAILY_TURNS", "5")
    monkeypatch.setenv("FREE_DAILY_GENERATIONS", "2")
    c = client()
    headers = auth("me-learner")

    me = c.get("/v1/me", headers=headers).json()
    assert me["subject"] == "me-learner"
    assert me["anonymous"] is False
    assert me["plan"] == "free"
    assert me["consent_tier"] == "un_elevated"
    assert me["budget"]["turns_remaining"] == 5
    assert me["budget"]["generations_remaining"] == 2
    assert me["budget"]["reset_at"]

    c.post("/v1/capability/tutor.turn", json=BODY, headers=headers)
    assert c.get("/v1/me", headers=headers).json()["budget"]["turns_remaining"] == 4

    # nothing about a model, a provider or a price ever reaches the client
    body = c.get("/v1/me", headers=headers).text.lower()
    for forbidden in ("claude", "gemini", "openai", "anthropic", "price", "₹", "$"):
        assert forbidden not in body


def test_me_marks_an_anonymous_learner(auth) -> None:
    me = client().get("/v1/me", headers=auth("anon-2", anonymous=True)).json()
    assert me["anonymous"] is True
    assert me["budget"]["turns_remaining"] == budget.limits_for("free", anonymous=True)[budget.TURN]


# --- the free tier is not something you can mint your way out of -------------------------


def test_rotating_anonymous_subjects_share_one_meter(
    monkeypatch: pytest.MonkeyPatch, auth
) -> None:
    """Supabase anonymous sign-in is a public endpoint, so a fresh subject costs one HTTP call.
    Verified before the fix: 30 turns served from 30 fresh anonymous subjects under a 2-turn cap.
    Anonymous learners are therefore metered per device address, not per subject."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("ANON_DAILY_TURNS", "2")
    client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
    body = {"payload": {"input": "hi"}}
    statuses = [
        client.post(
            "/v1/capability/wobo.turn",
            json=body,
            headers=auth(f"fresh-anon-{i}", anonymous=True),
        ).status_code
        for i in range(5)
    ]
    assert statuses == [200, 200, 429, 429, 429]


def test_a_signed_in_learner_still_has_their_own_meter(
    monkeypatch: pytest.MonkeyPatch, auth
) -> None:
    """The anonymous fix must not put two real learners behind one school router in one bucket."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("FREE_DAILY_TURNS", "1")
    client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
    body = {"payload": {"input": "hi"}}
    assert client.post("/v1/capability/wobo.turn", json=body, headers=auth("a")).status_code == 200
    assert client.post("/v1/capability/wobo.turn", json=body, headers=auth("a")).status_code == 429
    assert client.post("/v1/capability/wobo.turn", json=body, headers=auth("b")).status_code == 200


def test_an_anonymous_learner_may_not_build_a_lesson(auth) -> None:
    """A generation is the expensive half and an anonymous subject is free to mint."""
    from fastapi.testclient import TestClient

    client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
    r = client.post(
        "/v1/capability/engine.compose",
        json={"payload": {"concept": "fractions"}},
        headers=auth("anon-1", anonymous=True),
    )
    assert r.status_code == 403
    assert r.json()["code"] == "sign_in_required"


# --- voice is a paid API, so voice is metered --------------------------------------------


@pytest.mark.parametrize(
    "capability", ["voice.tts", "voice.session", "voice.relay", "voice.narration"]
)
def test_voice_draws_on_the_voice_counter_and_never_on_the_questions(capability: str) -> None:
    """Hearing an answer is not asking one.

    The client synthesises ONE CALL PER SENTENCE (``speech.tsx`` ``startUtterance`` → POST
    /v1/voice/tts), so while voice was classified as a TURN a five-sentence answer read aloud
    cost five of the day's questions on top of the question that earned it."""
    assert budget.classify(capability) == budget.VOICE


def test_a_spent_learner_cannot_mint_a_relay_token(
    monkeypatch: pytest.MonkeyPatch, auth
) -> None:
    """budget.charge used to be called in exactly one place — the capability route. A fully
    spent learner still minted relay tokens and still reached the paid TTS API."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("FREE_DAILY_VOICE_LINES", "0")
    monkeypatch.setenv("GEMINI_API_KEY", "not-a-real-key")
    client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
    assert client.get("/v1/voice/session", headers=auth()).status_code == 429
    spoken = client.post("/v1/voice/tts", json={"text": "hello"}, headers=auth())
    assert spoken.status_code == 429
    assert spoken.json()["code"] == "budget_exhausted"


def test_minting_a_token_spends_a_spoken_line_and_not_a_question(
    monkeypatch: pytest.MonkeyPatch, auth
) -> None:
    from fastapi.testclient import TestClient

    monkeypatch.setenv("FREE_DAILY_TURNS", "3")
    monkeypatch.setenv("GEMINI_API_KEY", "not-a-real-key")
    client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
    headers = auth("voice-learner")
    before = client.get("/v1/me", headers=headers).json()["budget"]
    assert client.get("/v1/voice/session", headers=headers).status_code == 200
    after = client.get("/v1/me", headers=headers).json()["budget"]
    assert after["voice_remaining"] == before["voice_remaining"] - 1
    assert after["turns_remaining"] == before["turns_remaining"]


def test_a_spoken_answer_costs_the_learner_no_questions_at_all(
    monkeypatch: pytest.MonkeyPatch, auth
) -> None:
    """The whole of finding gateway-1, end to end, on the anonymous dial.

    An anonymous learner has six questions a day. The app reads an answer out one SENTENCE at a
    time, so a five-sentence reply was five POSTs to /v1/voice/tts — and every one of them used
    to take a question. A crisis answer, which ``app.py`` refunds on purpose because NOTHING IS
    CHARGED FOR A DISCLOSURE, was charged five times over on the way back out through the
    speaker.
    """
    from fastapi.testclient import TestClient

    from wobo_gateway.plexus import media

    monkeypatch.setenv("ANON_DAILY_TURNS", "6")
    monkeypatch.setenv("OPENAI_API_KEY", "not-a-real-key")
    monkeypatch.setattr(media, "speakers_configured", lambda: True)
    monkeypatch.setattr(
        media, "synthesize_narration", lambda *a, **k: {"mime": "audio/pcm;rate=24000", "b64": ""}
    )
    client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
    headers = auth("anon-voice", anonymous=True)
    before = client.get("/v1/me", headers=headers).json()["budget"]
    for sentence in ("one.", "two.", "three.", "four.", "five."):
        spoken = client.post("/v1/voice/tts", json={"text": sentence}, headers=headers)
        assert spoken.status_code == 200, spoken.text
    after = client.get("/v1/me", headers=headers).json()["budget"]
    assert after["turns_remaining"] == before["turns_remaining"] == 6
    assert after["voice_remaining"] == before["voice_remaining"] - 5


def test_a_learner_out_of_spoken_lines_can_still_ask(monkeypatch: pytest.MonkeyPatch, auth) -> None:
    """The voice counter caps the paid API without ever closing the tutor: the words are on
    screen already, and the client reads a refusal as silence."""
    from fastapi.testclient import TestClient

    from wobo_gateway.plexus import media

    monkeypatch.setenv("FREE_DAILY_VOICE_LINES", "0")
    monkeypatch.setenv("OPENAI_API_KEY", "not-a-real-key")
    monkeypatch.setattr(media, "speakers_configured", lambda: True)
    client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
    headers = auth("quiet-learner")
    spoken = client.post("/v1/voice/tts", json={"text": "hello"}, headers=headers)
    assert spoken.status_code == 429
    assert spoken.json()["code"] == "budget_exhausted"
    assert client.get("/v1/me", headers=headers).json()["budget"]["turns_remaining"] == 40
    asked = client.post(
        "/v1/capability/wobo.turn", json=BODY, headers={**headers, "accept": "application/json"}
    )
    assert asked.status_code == 200, asked.text


def test_an_unavailable_voice_session_is_refused_for_free(
    monkeypatch: pytest.MonkeyPatch, auth
) -> None:
    """GET /v1/voice/session charged BEFORE it looked for a key, so a learner paid a call for a
    200 that said "unavailable" — and the client mints one token per line, so one silent answer
    cost five. A learner never pays for a call we did not serve."""
    from fastapi.testclient import TestClient

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_AI_API_KEY", raising=False)
    client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
    headers = auth("keyless-learner")
    before = client.get("/v1/me", headers=headers).json()["budget"]
    for _ in range(5):
        answer = client.get("/v1/voice/session", headers=headers)
        assert answer.status_code == 200
        assert answer.json() == {"mode": "unavailable"}
    after = client.get("/v1/me", headers=headers).json()["budget"]
    assert after == before


# --- check-and-increment is one operation ------------------------------------------------


def test_charge_is_atomic_under_threads(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every route here is a plain ``def``, so FastAPI runs them on a threadpool and two calls
    genuinely interleave between the read and the write."""
    import threading

    monkeypatch.setenv("FREE_DAILY_TURNS", "5")
    granted = []
    barrier = threading.Barrier(40)

    def attempt() -> None:
        barrier.wait()
        try:
            budget.charge("racer", "wobo.turn")
            granted.append(1)
        except budget.BudgetExhausted:
            pass

    threads = [threading.Thread(target=attempt) for _ in range(40)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sum(granted) == 5


# --- the day these counters count, which has to be the LEARNER's ----------------------
#
# THE HALF THE MIDNIGHT WORK MISSED. ``allowance.py`` was given the learner's own zone and its own
# local day, and was tested at Asia/Kolkata and west of UTC. These counters are the SECOND bound on
# the very same request (``budget.charge`` asks the money meter first and then counts the act), and
# they were left keyed on ``now.strftime("%Y-%m-%d")`` in UTC. So for a learner in Los Angeles the
# turn, generation and voice counters handed out a fresh full day at four or five in the afternoon,
# their time — and for a learner in Kolkata a counter refusal named 05:30 in the morning as the hour
# the day comes back, because whichever bound fires puts its own ``reset_at`` on the wire
# (``app.py``, the two 429 handlers).
#
# One day boundary in this product, computed in one place: ``allowance._next_local_midnight``,
# through ``allowance.local_day`` and ``allowance.resets_at``. Anything that is not a learner — the
# platform's own jobs, the public Ask box, the spend ceiling — keeps the UTC day it always had,
# which is the right day for a thing that belongs to the server rather than to a child.
@pytest.fixture
def _clean_zones():
    from wobo_gateway import allowance

    budget.reset()
    allowance.reset()
    yield
    budget.reset()
    allowance.reset()


def _at(moment: datetime):
    return lambda: moment


def test_the_counters_turn_over_at_the_learners_midnight_and_not_the_servers(
    monkeypatch: pytest.MonkeyPatch, _clean_zones
) -> None:
    """Los Angeles, across the server's midnight. 23:00Z and 01:00Z are four and five o'clock on
    the SAME afternoon in California: a learner who has spent their day has still spent it."""
    from wobo_gateway import allowance

    allowance.set_zone_resolver(lambda key: "America/Los_Angeles")
    key = "sub:la-learner"
    before_utc_midnight = datetime(2026, 9, 16, 23, 0, tzinfo=UTC)
    after_utc_midnight = datetime(2026, 9, 17, 1, 0, tzinfo=UTC)

    monkeypatch.setattr(budget, "_now", _at(before_utc_midnight))
    monkeypatch.setenv("FREE_DAILY_TURNS", "2")
    budget.charge(key, "wobo.turn")
    budget.charge(key, "wobo.turn")
    assert allowance.local_day(key, before_utc_midnight) == date(2026, 9, 16)

    monkeypatch.setattr(budget, "_now", _at(after_utc_midnight))
    # Still the same local day, so still spent — not a second full day two hours later.
    assert allowance.local_day(key, after_utc_midnight) == date(2026, 9, 16)
    assert budget.snapshot(key).turns_remaining == 0
    with pytest.raises(budget.BudgetExhausted):
        budget.charge(key, "wobo.turn")


def test_the_new_day_arrives_at_the_learners_own_midnight(
    monkeypatch: pytest.MonkeyPatch, _clean_zones
) -> None:
    """And it does arrive: the counters are not frozen, they are on the child's clock."""
    from wobo_gateway import allowance

    allowance.set_zone_resolver(lambda key: "America/Los_Angeles")
    key = "sub:la-learner-2"
    monkeypatch.setenv("FREE_DAILY_TURNS", "1")
    monkeypatch.setattr(budget, "_now", _at(datetime(2026, 9, 16, 23, 0, tzinfo=UTC)))
    budget.charge(key, "wobo.turn")
    # 08:00Z on the 17th is one in the morning in California: their midnight has passed.
    monkeypatch.setattr(budget, "_now", _at(datetime(2026, 9, 17, 8, 0, tzinfo=UTC)))
    assert budget.snapshot(key).turns_remaining == 1


def test_a_spent_counter_names_the_learners_own_midnight_and_not_the_servers(
    monkeypatch: pytest.MonkeyPatch, _clean_zones
) -> None:
    """``exc.reset_at`` goes on the wire as ``X-Wobo-Budget-Reset``. An IST learner told their day
    comes back at 05:30 was being told the server's midnight in their own morning."""
    from wobo_gateway import allowance

    allowance.set_zone_resolver(lambda key: "Asia/Kolkata")
    key = "sub:ist-learner"
    monkeypatch.setenv("FREE_DAILY_TURNS", "1")
    now = datetime(2026, 9, 16, 12, 0, tzinfo=UTC)
    monkeypatch.setattr(budget, "_now", _at(now))
    budget.charge(key, "wobo.turn")
    with pytest.raises(budget.BudgetExhausted) as raised:
        budget.charge(key, "wobo.turn")
    assert raised.value.reset_at == allowance.resets_at(key, now)
    assert raised.value.reset_at.utcoffset() == timedelta(hours=5, minutes=30)
    assert (raised.value.reset_at.hour, raised.value.reset_at.minute) == (0, 0)


def test_the_snapshot_carries_the_same_midnight_the_refusal_would(
    monkeypatch: pytest.MonkeyPatch, _clean_zones
) -> None:
    """``/v1/me`` shows one and the 429 shows the other; two answers to one question is a bug."""
    from wobo_gateway import allowance

    allowance.set_zone_resolver(lambda key: "Asia/Kolkata")
    key = "sub:ist-learner-2"
    now = datetime(2026, 9, 16, 12, 0, tzinfo=UTC)
    monkeypatch.setattr(budget, "_now", _at(now))
    assert budget.snapshot(key).reset_at == allowance.resets_at(key, now)


def test_what_is_not_a_learner_keeps_the_servers_own_day(
    monkeypatch: pytest.MonkeyPatch, _clean_zones
) -> None:
    """The platform's own jobs have no zone and no child: UTC is the right day for them, and
    ``spend.py`` and the public Ask box read this same function with no subject at all."""
    from wobo_gateway import allowance

    allowance.set_zone_resolver(lambda key: "Asia/Kolkata")
    now = datetime(2026, 9, 16, 12, 0, tzinfo=UTC)
    assert budget.reset_at(now) == datetime(2026, 9, 17, 0, 0, tzinfo=UTC)
    assert budget.reset_at(now, subject="system:curriculum") == datetime(
        2026, 9, 17, 0, 0, tzinfo=UTC
    )


def test_a_zone_that_cannot_be_read_falls_to_the_servers_day_rather_than_failing(
    monkeypatch: pytest.MonkeyPatch, _clean_zones
) -> None:
    """A resolver that throws must never take a learner's turn down with it: the counters keep
    counting, on UTC, which is exactly what they did before they knew about zones."""
    from wobo_gateway import allowance

    def _boom(key: str) -> str:
        raise RuntimeError("the zone store is down")

    allowance.set_zone_resolver(_boom)
    monkeypatch.setenv("FREE_DAILY_TURNS", "2")
    assert budget.charge("sub:zoneless", "wobo.turn").turns_remaining == 1
