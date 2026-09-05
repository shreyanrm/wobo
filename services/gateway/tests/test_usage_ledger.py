"""The durable usage ledger — the write side, read as a contract.

Nothing in this file touches a network or a database. The ledger's HTTP hop is one injectable
callable, so every row, header and query string this module builds is asserted against a fake,
which is the same seam ``test_curriculum_store.py`` uses for the same reason.

Four properties are worth more than the rest, and each has a test that fails without the change
that put it there:

1. **A row is never a transcript.** ``FIELDS`` is asserted exactly, and a recorded call whose
   response carries a child's question is asserted not to carry one character of it.
2. **Writing the ledger cannot break a lesson.** A transport that raises, a store that answers
   500, a buffer that fills — none of them reaches the caller, and all of them are counted.
3. **An unpriced call is still recorded.** The old ``record_cost`` returned the moment litellm
   could not price a response, which left the calls an operator most needs to see with no trace
   at all.
4. **The learner is a pseudonym, not an identity.** Stable, salted, and not the subject.
"""

from __future__ import annotations

import base64
import io
import json
import struct
import wave
from typing import Any

import pytest
from wobo_gateway import ledger, telemetry


# --- the fake store ------------------------------------------------------------------------------
class FakeStore:
    """Captures every hop the ledger makes. ``status`` drives what it answers."""

    def __init__(self, status: int = 201, *, raises: bool = False) -> None:
        self.status = status
        self.raises = raises
        self.calls: list[tuple[str, str, dict[str, str], Any]] = []

    def __call__(
        self, method: str, url: str, headers: dict[str, str], body: bytes | None
    ) -> tuple[int, Any]:
        if self.raises:
            raise ConnectionResetError("the database went away mid-write")
        parsed = json.loads(body.decode()) if body else None
        self.calls.append((method, url, headers, parsed))
        return self.status, None

    @property
    def rows(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for _method, _url, _headers, parsed in self.calls:
            if isinstance(parsed, list):
                out.extend(parsed)
        return out


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    """A configured ledger with no autoflush: the test decides when a batch goes."""
    monkeypatch.setenv("USAGE_LEDGER_PEPPER", "a-pepper-for-the-suite")
    fake = FakeStore()
    ledger.configure(
        base_url="https://project.example", service_key="svc", transport=fake, autoflush=False
    )
    return fake


# --- 1. a row is never a transcript ---------------------------------------------------------------
def test_fields_is_the_whole_allowlist_and_names_nothing_a_child_said() -> None:
    """The privacy promise, in executable form.

    A ledger row is an accounting record. This list is asserted exactly rather than loosely so
    that widening it is a deliberate act with a failing test attached, which is the only kind of
    guard that survives a busy afternoon.
    """
    assert ledger.FIELDS == (
        "occurred_at",
        "day",
        "kind",
        "capability",
        "track",
        "provider",
        "model_requested",
        "model_served",
        "fallback_used",
        "tokens_in",
        "tokens_out",
        "cost_usd",
        "cost_source",
        "latency_ms",
        "cache_hit",
        "anonymous",
        "plan",
        "learner_ref",
        "unit_kind",
        "unit_count",
    )
    forbidden = (
        "question",
        "answer",
        "prompt",
        "completion",
        "message",
        "text",
        "content",
        "concept",
        "title",
        "topic",
        "transcript",
        "body",
        "subject",
        "email",
    )
    for field in ledger.FIELDS:
        assert not any(word in field for word in forbidden), field


def test_a_recorded_call_carries_no_word_of_what_the_learner_asked(store: FakeStore) -> None:
    secret = "why does my mum cry at night"

    class Response:
        model = "anthropic/claude-x"
        usage = {"prompt_tokens": 40, "completion_tokens": 9}
        choices = [{"message": {"content": f"You asked: {secret}"}}]

    telemetry.record_cost(capability="wobo.turn", model="anthropic/claude-x", response=Response())
    ledger.flush_now()

    serialised = json.dumps(store.rows)
    assert secret not in serialised
    for word in secret.split():
        if len(word) > 3:
            assert word not in serialised
    assert store.rows and set(store.rows[0]) == set(ledger.FIELDS)


# --- 2. writing the ledger cannot break a lesson --------------------------------------------------
def test_a_transport_that_raises_never_reaches_the_caller(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("USAGE_LEDGER_PEPPER", "p")
    ledger.configure(
        base_url="https://x", service_key="k", transport=FakeStore(raises=True), autoflush=False
    )
    ledger.record(capability="wobo.turn", model_served="m", cost_usd=0.01)
    assert ledger.flush_now() == 0  # no exception escaped
    state = ledger.state()
    assert state["dropped_write_failed"] == 1
    assert state["last_error"]


def test_a_store_that_refuses_drops_the_batch_and_counts_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("USAGE_LEDGER_PEPPER", "p")
    fake = FakeStore(status=500)
    ledger.configure(base_url="https://x", service_key="k", transport=fake, autoflush=False)
    for _ in range(3):
        ledger.record(capability="wobo.turn", model_served="m", cost_usd=0.01)
    assert ledger.flush_now() == 0
    assert ledger.state()["dropped_write_failed"] == 3
    assert ledger.state()["buffered"] == 0  # dropped, not queued forever


def test_a_full_buffer_drops_the_oldest_row_and_counts_it(
    store: FakeStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LEDGER_BUFFER_MAX", "10")
    for i in range(15):
        ledger.record(capability=f"cap.{i}", model_served="m", cost_usd=0.01)
    assert ledger.state()["dropped_buffer_full"] == 5
    ledger.flush_now()
    # The five OLDEST fell off; the most recent ten — the window an operator is actually
    # looking at while the database is unreachable — survived.
    assert [row["capability"] for row in store.rows] == [f"cap.{i}" for i in range(5, 15)]


def test_an_unconfigured_ledger_touches_nothing_and_says_so() -> None:
    ledger.reset()  # no transport, no project (which is what conftest leaves behind)
    ledger.record(capability="wobo.turn", model_served="m", cost_usd=0.5)
    state = ledger.state()
    assert state["configured"] is False
    assert state["dropped_unconfigured"] == 1
    assert state["written"] == 0


def test_the_off_switch_is_honoured(store: FakeStore, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("USAGE_LEDGER", "off")
    ledger.record(capability="wobo.turn", model_served="m", cost_usd=0.5)
    assert ledger.state()["configured"] is False
    assert store.rows == []


# --- 3. an unpriced call is still recorded --------------------------------------------------------
def test_a_call_litellm_cannot_price_is_recorded_as_unpriced_not_dropped(
    store: FakeStore,
) -> None:
    """litellm is never importable in the suite, so ``completion_cost`` always fails here — which
    is exactly the production case of a model with no price table. The row must still exist."""

    class Response:
        model = "some-vendor/brand-new-model"
        usage = {"prompt_tokens": 11, "completion_tokens": 3}

    assert (
        telemetry.record_cost(
            capability="engine.video", model="some-vendor/brand-new-model", response=Response()
        )
        is None
    )
    ledger.flush_now()

    assert len(store.rows) == 1
    row = store.rows[0]
    assert row["cost_usd"] is None
    assert row["cost_source"] == ledger.UNPRICED
    assert row["tokens_in"] == 11 and row["tokens_out"] == 3


def test_the_model_that_actually_answered_is_the_one_recorded(store: FakeStore) -> None:
    """A fallback took over. A chart drawn on the requested model would be a chart of our
    intentions rather than of our bill."""

    class Response:
        model = "openai/gpt-fallback"

    telemetry.record_cost(capability="wobo.turn", model="anthropic/primary", response=Response())
    ledger.flush_now()
    row = store.rows[0]
    assert row["model_requested"] == "anthropic/primary"
    assert row["model_served"] == "openai/gpt-fallback"
    assert row["fallback_used"] is True
    assert row["provider"] == "openai"


def test_a_provider_that_reports_no_usage_records_null_tokens_not_zero(
    store: FakeStore,
) -> None:
    class Response:
        model = "m"

    telemetry.record_cost(capability="wobo.turn", model="m", response=Response())
    ledger.flush_now()
    assert store.rows[0]["tokens_in"] is None
    assert store.rows[0]["tokens_out"] is None


# --- 4. the learner is a pseudonym ----------------------------------------------------------------
def test_the_pseudonym_is_stable_salted_and_not_the_subject(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("USAGE_LEDGER_PEPPER", "pepper-one")
    subject = "8f14e45f-ea20-4f7b-9a3c-1c2d3e4f5a6b"
    first = ledger.pseudonym(f"sub:{subject}")
    assert first == ledger.pseudonym(f"sub:{subject}")  # stable across calls
    assert first is not None
    assert subject not in first
    assert len(first) == 32

    monkeypatch.setenv("USAGE_LEDGER_PEPPER", "pepper-two")
    assert ledger.pseudonym(f"sub:{subject}") != first  # salted, so a leak is not a rainbow table


def test_no_pepper_means_no_pseudonym_rather_than_a_bare_digest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unsalted digest of a uuid is one lookup table away from being the uuid."""
    monkeypatch.delenv("USAGE_LEDGER_PEPPER", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    assert ledger.pseudonym("sub:anybody") is None


def test_the_door_names_the_caller_and_the_row_carries_it(store: FakeStore) -> None:
    with ledger.calling(plan="Pro", anonymous=False, meter_key="sub:learner-1"):
        ledger.record(capability="wobo.turn", model_served="m", cost_usd=0.02)
    ledger.record(capability="wobo.turn", model_served="m", cost_usd=0.02)  # outside any request
    ledger.flush_now()

    inside, outside = store.rows
    assert inside["plan"] == "pro"  # normalised, never echoed as typed
    assert inside["anonymous"] is False
    assert inside["learner_ref"] == ledger.pseudonym("sub:learner-1")
    # A call made outside a request is honestly unattributed, never guessed at.
    assert outside["plan"] == "unknown"
    assert outside["learner_ref"] is None


def test_mark_names_the_caller_for_the_rest_of_the_request(store: FakeStore) -> None:
    ledger.mark(plan="max", anonymous=True, meter_key="anon:203.0.113.9")
    ledger.record(capability="wobo.turn", model_served="m", cost_usd=0.02)
    ledger.flush_now()
    assert store.rows[0]["plan"] == "max"
    assert store.rows[0]["anonymous"] is True


# --- the transport itself -------------------------------------------------------------------------
def test_the_batch_goes_to_the_ops_schema_with_the_service_key(store: FakeStore) -> None:
    ledger.record(capability="wobo.turn", model_served="m", cost_usd=0.02)
    assert ledger.flush_now() == 1
    method, url, headers, rows = store.calls[0]
    assert method == "POST"
    assert url == "https://project.example/rest/v1/model_calls"
    # Without the profile header the insert lands in `public`, where the table does not exist.
    assert headers["Content-Profile"] == "ops"
    assert headers["Authorization"] == "Bearer svc"
    assert headers["Prefer"] == "return=minimal"
    assert isinstance(rows, list) and len(rows) == 1


def test_a_batch_is_capped_so_one_flush_cannot_post_a_megabyte(
    store: FakeStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LEDGER_BATCH_MAX", "2")
    for i in range(5):
        ledger.record(capability=f"cap.{i}", model_served="m", cost_usd=0.01)
    assert ledger.flush_now() == 5
    assert [len(call[3]) for call in store.calls] == [2, 2, 1]


def test_the_day_on_a_row_is_the_utc_day_of_the_call(store: FakeStore) -> None:
    from datetime import UTC, datetime

    ledger.record(
        capability="wobo.turn",
        model_served="m",
        cost_usd=0.01,
        occurred_at=datetime(2026, 9, 4, 23, 59, 58, tzinfo=UTC),
    )
    ledger.flush_now()
    assert store.rows[0]["day"] == "2026-09-04"


# --- units ----------------------------------------------------------------------------------------
def test_a_capability_is_classified_into_the_unit_it_is_measured_in() -> None:
    assert ledger.unit_for("wobo.turn") == ledger.TURN
    assert ledger.unit_for("engine.explain") == ledger.GENERATION
    assert ledger.unit_for("engine.image") == ledger.IMAGE
    assert ledger.unit_for("voice.tts") == ledger.SPOKEN_SECOND
    assert ledger.unit_for("curriculum.discovery") == ledger.GENERATION
    # Shipped tomorrow, counted tomorrow — never silently free, exactly like budget.classify.
    assert ledger.unit_for("something.invented.next.week") == ledger.TURN


def test_a_delivery_row_carries_the_unit_and_no_money(store: FakeStore) -> None:
    ledger.record_delivery(
        capability="engine.video",
        unit_kind=ledger.VIDEO_SECOND,
        unit_count=93.5,
        model_served="anthropic/claude-x",
    )
    ledger.flush_now()
    row = store.rows[0]
    assert row["kind"] == "delivery"
    assert row["unit_kind"] == "video_second"
    assert row["unit_count"] == 93.5
    assert row["cost_usd"] is None
    assert row["cost_source"] == ledger.NO_PROVIDER_CHARGE


def test_the_video_engine_records_the_seconds_it_delivered(store: FakeStore) -> None:
    from wobo_gateway.plexus.engines import _record_video_delivered

    _record_video_delivered(93_500, "anthropic/claude-x")
    ledger.flush_now()
    assert store.rows[0]["unit_kind"] == "video_second"
    assert store.rows[0]["unit_count"] == 93.5

    store.calls.clear()
    _record_video_delivered(0, "anthropic/claude-x")  # a muted piece is not a delivery
    ledger.flush_now()
    assert store.rows == []


def _wav(seconds: float, rate: int = 24000) -> str:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<h", 0) * int(rate * seconds))
    return base64.b64encode(buf.getvalue()).decode()


class _GoogleSaid:
    """Stands in for Google's TTS endpoint: one WAV back, no network."""

    def __init__(self, seconds: float) -> None:
        self.payload = {
            "candidates": [
                {
                    "content": {
                        "parts": [{"inlineData": {"mimeType": "audio/wav", "data": _wav(seconds)}}]
                    }
                }
            ]
        }

    def __enter__(self) -> _GoogleSaid:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode()


def _speak(monkeypatch: pytest.MonkeyPatch, seconds: float, **kwargs: Any) -> Any:
    """Drive ``synthesize_narration`` — the REAL call site — with a fake upstream.

    ``media`` imports urllib inside the function, so the patch goes on the stdlib module itself.
    """
    import urllib.request

    from wobo_gateway.plexus import media

    monkeypatch.setenv("GEMINI_API_KEY", "not-a-real-key")
    monkeypatch.setattr(urllib.request, "urlopen", lambda *_a, **_k: _GoogleSaid(seconds))
    return media.synthesize_narration("two plus two is four", **kwargs)


def test_a_spoken_line_is_recorded_in_measured_seconds(
    store: FakeStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The one paid call in the product that never passed through ``record_cost``: Gemini TTS is a
    raw HTTPS POST, so until the ledger existed it cost money and left no trace at all.

    Driven through ``synthesize_narration`` itself rather than through the recording helper, so a
    future edit that keeps the helper and drops the call site fails here."""
    assert _speak(monkeypatch, 2.5) is not None
    ledger.flush_now()
    row = store.rows[0]
    assert row["capability"] == "voice.tts"
    assert row["unit_kind"] == "spoken_second"
    assert row["unit_count"] == pytest.approx(2.5, abs=0.01)
    assert row["cost_usd"] is None
    assert row["cost_source"] == ledger.UNPRICED  # litellm has no price for this model


def test_the_video_engines_narration_is_told_apart_from_a_read_aloud(
    store: FakeStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A learner asking to be read to and an explainer's narration cost the same per second and
    mean different things on a bill."""
    _speak(monkeypatch, 1.0, capability="voice.narration")
    ledger.flush_now()
    assert store.rows[0]["capability"] == "voice.narration"


def test_an_operator_entered_price_is_labelled_as_one(
    store: FakeStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A price a person typed is money, but it is not a vendor's quote and the row says which."""
    monkeypatch.setenv("LEDGER_PRICE_SPOKEN_SECOND_USD", "0.0004")
    _speak(monkeypatch, 10)
    ledger.flush_now()
    row = store.rows[0]
    assert row["cost_source"] == ledger.FROM_CONFIGURED
    assert row["cost_usd"] == pytest.approx(0.004, abs=1e-5)


def test_a_price_that_is_not_a_number_leaves_the_unit_unpriced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LEDGER_PRICE_SPOKEN_SECOND_USD", "about four hundredths of a cent")
    assert ledger.configured_price(ledger.SPOKEN_SECOND) is None


# --- latency --------------------------------------------------------------------------------------
def test_the_provider_round_trip_is_noted_once_and_consumed(store: FakeStore) -> None:
    ledger.note_latency(412.5)
    assert ledger.take_latency() == pytest.approx(412.5)
    # Consumed: a second, unmeasured call must never inherit the first one's latency.
    assert ledger.take_latency() is None


def test_an_unmeasured_call_records_no_latency_rather_than_zero(store: FakeStore) -> None:
    class Response:
        model = "m"

    telemetry.record_cost(capability="wobo.turn", model="m", response=Response())
    ledger.flush_now()
    assert store.rows[0]["latency_ms"] is None


def test_a_measured_call_carries_the_round_trip_onto_the_row(store: FakeStore) -> None:
    class Response:
        model = "m"

    ledger.note_latency(88.2)
    telemetry.record_cost(capability="wobo.turn", model="m", response=Response())
    ledger.flush_now()
    assert store.rows[0]["latency_ms"] == 88


# --- the cache ------------------------------------------------------------------------------------
def test_a_cache_hit_is_recorded_as_a_served_turn_that_cost_zero(store: FakeStore) -> None:
    """Without this the ledger would only ever see the expensive half of the traffic, and every
    per-turn cost derived from it would be too high."""
    from wobo_gateway.app import CapabilityRequest, Gateway
    from wobo_gateway.cache import InMemoryCache
    from wobo_gateway.providers import MockProvider
    from wobo_gateway.telemetry import MetricsSink

    gw = Gateway(MockProvider(), InMemoryCache(), MetricsSink())
    request = CapabilityRequest(payload={"topic": "fractions"})
    gw.invoke("generate.course", request)  # fills the cache
    store.calls.clear()
    result = gw.invoke("generate.course", request)  # served from it
    assert result.cache_hit is True

    ledger.flush_now()
    row = next(r for r in store.rows if r["cache_hit"] is True)
    assert row["cost_usd"] == 0.0
    assert row["cost_source"] == ledger.NO_PROVIDER_CHARGE
    assert row["latency_ms"] == 0


# --- the rollup and the sweep ---------------------------------------------------------------------
def test_the_rollup_and_the_sweep_are_rpcs_on_the_ops_schema(store: FakeStore) -> None:
    from datetime import date

    ledger.roll_up(date(2026, 9, 4))
    ledger.expire(45)
    urls = [call[1] for call in store.calls]
    assert urls == [
        "https://project.example/rest/v1/rpc/roll_up_usage",
        "https://project.example/rest/v1/rpc/expire_model_calls",
    ]
    assert store.calls[0][3] == {"p_day": "2026-09-04"}
    assert store.calls[1][3] == {"p_keep_days": 45}


def test_reading_the_rollup_asks_for_a_day_range_in_the_ops_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from datetime import date

    class Reader(FakeStore):
        def __call__(self, method, url, headers, body):  # type: ignore[override]
            self.calls.append((method, url, headers, None))
            return 200, [{"day": "2026-09-01", "capability": "wobo.turn"}]

    reader = Reader()
    ledger.configure(
        base_url="https://p.example", service_key="svc", transport=reader, autoflush=False
    )
    rows = ledger.read_daily(since=date(2026, 9, 1), until=date(2026, 9, 4))
    assert rows == [{"day": "2026-09-01", "capability": "wobo.turn"}]
    _method, url, headers, _ = reader.calls[0]
    assert "usage_daily" in url
    assert "gte.2026-09-01" in url and "lte.2026-09-04" in url
    assert headers["Accept-Profile"] == "ops"


def test_a_ledger_that_cannot_be_read_answers_none_and_not_an_empty_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """None ("we could not ask") and [] ("nothing happened") are different answers, and a console
    that renders them the same way is lying about one of them."""
    from datetime import date

    ledger.configure(
        base_url="https://p", service_key="k", transport=FakeStore(status=503), autoflush=False
    )
    assert ledger.read_daily(since=date(2026, 9, 1), until=date(2026, 9, 2)) is None


def test_a_read_that_throws_shows_as_could_not_ask_and_not_as_a_500() -> None:
    """The console calls this on an operator's request. A transport that dies in an unexpected
    shape belongs on the screen as "we could not ask", never as a stack trace on a page about
    money."""
    from datetime import date

    ledger.configure(
        base_url="https://p", service_key="k", transport=FakeStore(raises=True), autoflush=False
    )
    assert ledger.read_daily(since=date(2026, 9, 1), until=date(2026, 9, 2)) is None


def test_a_beat_changes_the_lean_and_not_the_ledger(
    store: FakeStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The style instruction (voice.md 10b) does not change what a line costs: the unit is still
    the measured second of audio, whatever the beat, and the beat leaves no unit of its own."""
    from wobo_gateway import voice

    softer = voice.spoken_instruction("en-IN", "miss")
    assert _speak(monkeypatch, 1.5, instruction=softer) is not None
    ledger.flush_now()
    row = store.rows[0]
    assert row["capability"] == "voice.tts"
    assert row["unit_kind"] == ledger.SPOKEN_SECOND
    assert row["unit_count"] == pytest.approx(1.5, abs=0.01)
    assert len(store.rows) == 1
