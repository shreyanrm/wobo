"""The alarm: one greppable line for every event worth waking someone, and one webhook sink.

Every test here fails without ``wobo_gateway/alerts.py`` and its wiring in ``app.py``. Before
them the only automated response to a crash was Railway restarting the container silently ten
times and then stopping, and nothing at all was said about a safety gate, a spend threshold or
a burst of refused tokens.
"""

from __future__ import annotations

import json
import logging

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import alerts, spend
from wobo_gateway.app import Gateway, _JsonFormatter, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink


class BrokenProvider:
    """A provider that is down, the way a provider is actually down."""

    def complete(self, **kwargs):
        raise TimeoutError("the provider did not answer")


def client(provider: object | None = None, **kwargs) -> TestClient:
    gw = Gateway(provider or MockProvider(), InMemoryCache(), MetricsSink())
    return TestClient(create_app(gw), **kwargs)


@pytest.fixture
def sink(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """A webhook sink that records instead of posting, and runs inline instead of on a thread."""
    sent: list[dict] = []
    monkeypatch.setenv("ALERT_WEBHOOK_URL", "https://hooks.example/wobo")
    monkeypatch.setenv("ALERT_COOLDOWN_SECONDS", "0")
    alerts.set_sender(lambda url, payload: sent.append({"url": url, **payload}))
    alerts.set_runner(lambda go: go())
    return sent


def events(sent: list[dict]) -> list[str]:
    return [item["event"] for item in sent]


# --- the line -----------------------------------------------------------------------------------
def test_every_alert_writes_one_greppable_line(caplog: pytest.LogCaptureFixture) -> None:
    """Two ways to find it in a log drain with no query language: the message and the field."""
    with caplog.at_level(logging.INFO, logger="wobo.gateway.alert"):
        alerts.alert(alerts.SERVER_ERROR, "something broke", severity=alerts.CRITICAL, path="/v1/x")
    record = caplog.records[-1]
    assert record.getMessage() == "ALERT server_error"
    assert record.fields["alert"] == alerts.SERVER_ERROR
    assert record.fields["severity"] == alerts.CRITICAL
    assert record.fields["path"] == "/v1/x"
    assert record.levelno == logging.ERROR
    # and it survives the gateway's own JSON formatter as one machine-readable object
    line = json.loads(_JsonFormatter().format(record))
    assert line["alert"] == alerts.SERVER_ERROR
    assert line["msg"] == "ALERT server_error"


def test_with_no_webhook_configured_the_alarm_is_a_logger_and_nothing_else(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.delenv("ALERT_WEBHOOK_URL", raising=False)

    def explode(url, payload):  # pragma: no cover — the point is that it never runs
        raise AssertionError("nothing may be posted when no sink is configured")

    alerts.set_sender(explode)
    alerts.set_runner(lambda go: go())
    with caplog.at_level(logging.INFO, logger="wobo.gateway.alert"):
        alerts.alert(alerts.STARTUP, "hello", severity=alerts.INFO)
    assert caplog.records[-1].fields["alert"] == alerts.STARTUP


def test_the_page_carries_a_shape_slack_and_discord_both_read(sink: list[dict]) -> None:
    alerts.alert(alerts.SPEND_THRESHOLD, "half the day is gone", threshold=0.5)
    (page,) = sink
    assert page["url"] == "https://hooks.example/wobo"
    assert "half the day is gone" in page["text"]  # Slack
    assert page["text"] == page["content"]  # Discord
    assert page["fields"]["threshold"] == 0.5


def test_a_burst_pages_once_per_cooldown_and_logs_every_time(
    monkeypatch: pytest.MonkeyPatch, sink: list[dict], caplog: pytest.LogCaptureFixture
) -> None:
    """A thousand 5xx in a minute is one page and a thousand log lines. A rate-limited LOG lies;
    a rate-limited page is the difference between an alarm and a nuisance."""
    monkeypatch.setenv("ALERT_COOLDOWN_SECONDS", "300")
    with caplog.at_level(logging.INFO, logger="wobo.gateway.alert"):
        for _ in range(5):
            alerts.alert(alerts.SERVER_ERROR, "boom", severity=alerts.CRITICAL)
    assert len(sink) == 1
    assert len(caplog.records) == 5
    assert [r.fields.get("suppressed") for r in caplog.records] == [None, True, True, True, True]


def test_a_sink_that_is_down_never_becomes_an_outage(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("ALERT_WEBHOOK_URL", "https://hooks.example/wobo")
    alerts.set_runner(lambda go: go())
    alerts.set_sender(lambda url, payload: (_ for _ in ()).throw(OSError("connection refused")))
    with caplog.at_level(logging.INFO, logger="wobo.gateway.alert"):
        result = alerts.alert(alerts.PROVIDER_OUTAGE, "a provider is down")
    assert result["alert"] == alerts.PROVIDER_OUTAGE  # the caller got its answer regardless
    assert any("alert webhook failed" in r.getMessage() for r in caplog.records)


# --- the six events, where they actually fire ----------------------------------------------------
def test_a_start_up_is_announced(sink: list[dict]) -> None:
    """Ten of these inside five minutes IS Railway's restart policy giving up in slow motion."""
    client()
    assert alerts.STARTUP in events(sink)


def test_a_5xx_and_a_provider_outage_both_raise_the_alarm(sink: list[dict], auth) -> None:
    api = client(BrokenProvider(), raise_server_exceptions=False)
    answer = api.post("/v1/capability/tutor.turn", json={"payload": {"q": "hi"}}, headers=auth())
    assert answer.status_code == 500
    assert alerts.PROVIDER_OUTAGE in events(sink)
    assert alerts.SERVER_ERROR in events(sink)
    server = next(item for item in sink if item["event"] == alerts.SERVER_ERROR)
    assert server["severity"] == alerts.CRITICAL
    assert server["fields"]["path"] == "/v1/capability/tutor.turn"
    # A child's words can ride an exception's text. Only the type ever leaves the process.
    assert "did not answer" not in json.dumps(sink)


def test_the_safety_gate_raises_the_alarm_and_never_carries_the_childs_words(
    sink: list[dict], auth
) -> None:
    """A crisis category is a child in trouble, and it is the one thing in this service worth a
    person's attention within minutes."""
    words = "my dad hits me"
    answer = client().post(
        "/v1/capability/tutor.turn", json={"payload": {"question": words}}, headers=auth()
    )
    assert answer.status_code == 200
    gate = next(item for item in sink if item["event"] == alerts.SAFETY_GATE)
    assert gate["severity"] == alerts.CRITICAL
    assert gate["fields"]["category"] == "crisis"
    assert gate["fields"]["capability"] == "tutor.turn"
    assert words not in json.dumps(sink)


def test_a_burst_of_refused_tokens_raises_the_alarm_once(
    monkeypatch: pytest.MonkeyPatch, sink: list[dict]
) -> None:
    monkeypatch.setenv("ALERT_AUTH_FAILURE_BURST", "3")
    api = client()
    for _ in range(5):
        answer = api.get("/v1/me", headers={"Authorization": "Bearer not-a-token"})
        assert answer.status_code == 401
    bursts = [item for item in sink if item["event"] == alerts.AUTH_FAILURE_BURST]
    assert len(bursts) == 1
    assert bursts[0]["fields"]["failures"] == 3


def test_a_spend_threshold_crossing_reaches_the_sink(
    monkeypatch: pytest.MonkeyPatch, sink: list[dict]
) -> None:
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "10")
    spend.record(6.0, capability="engine.compose", model="test")
    crossing = next(item for item in sink if item["event"] == alerts.SPEND_THRESHOLD)
    assert crossing["fields"]["threshold"] == 0.5
    assert crossing["fields"]["spent_usd"] == 6.0


def test_every_event_name_the_operations_page_promises_exists() -> None:
    """docs/OPERATIONS.md names these seven. A rename breaking a runbook grep fails here.

    ``pool_threshold`` joined them when the two pools the platform pays for itself were given
    the caps their dials had always implied (``pools.py``, docs/ALLOWANCE.md "Best of both
    worlds" point 4): the creative pool, and the day's spend on every free learner together.
    """
    assert {
        "startup",
        "server_error",
        "safety_gate",
        "spend_threshold",
        "auth_failure_burst",
        "provider_outage",
        "pool_threshold",
    } == alerts.EVENTS


def test_the_runbook_counts_the_events_it_actually_lists() -> None:
    """docs/OPERATIONS.md §3 opens with a COUNT, and a runbook that miscounts its own table is
    a runbook an operator stops trusting at three in the morning.

    The test above pins the NAMES, which is why ``pool_threshold`` could be added to the module,
    to the table and to that assertion while the sentence directly above the table went on saying
    "Six events". Prose is not checked by a set comparison, so it is checked here: the number the
    page says, the number of rows in its table, and the number of events the module exports are
    one number or this fails.
    """
    import re
    from pathlib import Path

    words = {
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
        "seven": 7,
        "eight": 8,
        "nine": 9,
        "ten": 10,
    }
    page = (Path(__file__).resolve().parents[3] / "docs" / "OPERATIONS.md").read_text()
    said = re.search(r"([A-Za-z]+) events, one JSON log line each", page)
    assert said is not None, "docs/OPERATIONS.md §3 no longer says how many events there are"
    counted = words.get(said.group(1).lower())
    assert counted is not None, said.group(1)
    assert counted == len(alerts.EVENTS)
    # And every event has a row of its own in that table, so the count is not right by luck.
    for event in alerts.EVENTS:
        assert f"`{event}`" in page, event
