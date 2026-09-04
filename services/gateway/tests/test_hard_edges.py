"""The gateway's hard edges — the four things a stranger reaches before any of our code runs.

Each test here pins one demonstrated hole closed, and each of them failed before the change it
guards:

* the body ceiling was read off ``Content-Length``, a header the client writes, so a chunked POST
  of any size sailed past it;
* the parent-facing HTML pages went out with no CSP, no framing refusal and no ``nosniff``;
* board ownership was the meter key, which is one string per ADDRESS for anonymous learners, so
  two children on one school NAT could resume and interrupt each other's turn;
* the token issuer was never checked, so any token minted with our secret for any purpose passed.

Mock mode only — no network, no keys.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.board import stream
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

SSE = {"Accept": "text/event-stream"}


@pytest.fixture(autouse=True)
def _clean(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    stream.reset()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def ask(text: str) -> dict[str, Any]:
    return {"payload": {"context": {"turn": {"lastUserInput": text}}}}


# --- 1. the body ceiling is counted, not declared ---------------------------------------------


def _chunked(body: bytes, chunk: int = 64 * 1024) -> Iterator[bytes]:
    """An iterator body: httpx sends ``Transfer-Encoding: chunked`` and NO ``Content-Length``."""
    for start in range(0, len(body), chunk):
        yield body[start : start + chunk]


def test_a_chunked_body_past_the_ceiling_is_refused(client: TestClient, auth) -> None:
    """The ceiling has to hold when the client declines to declare a length.

    Before this, ``_too_large`` read ``Content-Length`` and answered "no" when the header was
    absent, so a chunked POST of ~400 KB — well past the 256 KB ceiling — was read, parsed and
    served with a 200. The cap now counts the bytes off the wire."""
    payload = json.dumps(ask("x" * 400_000)).encode()
    assert len(payload) > 256 * 1024
    res = client.post(
        "/v1/capability/wobo.turn",
        content=_chunked(payload),
        headers={**auth(), "Content-Type": "application/json"},
    )
    assert res.status_code == 413, "a chunked body past the ceiling must be refused"
    assert res.json()["code"] == "too_much_at_once"


def test_a_chunked_body_under_the_ceiling_is_still_served(client: TestClient, auth) -> None:
    """The counter must not break the ordinary streamed request it now measures."""
    payload = json.dumps(ask("what is a prime number")).encode()
    res = client.post(
        "/v1/capability/wobo.turn",
        content=_chunked(payload),
        headers={**auth(), "Content-Type": "application/json"},
    )
    assert res.status_code == 200


def test_a_declared_length_past_the_ceiling_is_still_refused_before_a_byte_is_read(
    client: TestClient, auth
) -> None:
    """The cheap path stays: an honest ``Content-Length`` is refused without reading a body."""
    res = client.post(
        "/v1/capability/wobo.turn",
        content=b"{}",
        headers={**auth(), "Content-Length": str(9_000_000), "Content-Type": "application/json"},
    )
    assert res.status_code == 413


# --- 2. every response carries the security headers -------------------------------------------

EXPECTED_HEADERS = {
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
}


def test_the_parent_facing_html_pages_are_not_frameable_or_sniffable(client: TestClient) -> None:
    """The mail stop page is reached from a mail footer with no session and is real HTML.

    It went out with no CSP, no ``X-Frame-Options`` and no ``nosniff``, so it could be framed
    into somebody else's page and clicked through by a parent who thought they were elsewhere."""
    res = client.get("/v1/mail/stop?token=not-a-real-token")
    assert res.headers["content-type"].startswith("text/html")
    for header, value in EXPECTED_HEADERS.items():
        assert res.headers.get(header) == value, f"{header} missing on the mail stop page"
    csp = res.headers.get("content-security-policy", "")
    assert "frame-ancestors 'none'" in csp
    assert "default-src 'none'" in csp
    assert "form-action 'self'" in csp


def test_the_json_api_carries_the_same_headers(client: TestClient, auth) -> None:
    """One middleware, one origin: the headers are not a per-route decoration."""
    res = client.get("/healthz")
    for header, value in EXPECTED_HEADERS.items():
        assert res.headers.get(header) == value
    signed_in = client.get("/v1/me", headers=auth())
    for header, value in EXPECTED_HEADERS.items():
        assert signed_in.headers.get(header) == value


def test_hsts_rides_only_on_https(client: TestClient) -> None:
    """HSTS over plain http is meaningless and a browser ignores it; it is sent on TLS only."""
    plain = client.get("/healthz")
    assert "strict-transport-security" not in plain.headers
    secure = TestClient(
        create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())),
        base_url="https://api.test",
    ).get("/healthz")
    hsts = secure.headers.get("strict-transport-security", "")
    assert "max-age=" in hsts and "includeSubDomains" in hsts


def test_hsts_rides_on_the_forwarded_proto_too(client: TestClient) -> None:
    """Our container runs uvicorn with ``--forwarded-allow-ips ''`` so it never rewrites the
    scheme from a header — behind the platform's TLS terminator the socket is plain http, and
    reading the forwarded proto here is the only way the live origin ever sends HSTS."""
    res = client.get("/healthz", headers={"X-Forwarded-Proto": "https"})
    assert "max-age=" in res.headers.get("strict-transport-security", "")


def test_a_streamed_turn_is_hardened_like_everything_else(client: TestClient, auth) -> None:
    """The board is a long-lived SSE response; headers set after the route returns must still
    reach the wire."""
    res = client.post(
        "/v1/capability/wobo.turn", json=ask("what is a prime"), headers={**auth(), **SSE}
    )
    assert res.status_code == 200
    assert res.headers.get("x-content-type-options") == "nosniff"
    assert res.headers.get("x-frame-options") == "DENY"


# --- 3. two anonymous learners on one address are two learners --------------------------------


def _anon(subject: str, token) -> dict[str, str]:
    return {"Authorization": f"Bearer {token(subject, anonymous=True)}"}


def _one_turn(client: TestClient, headers: dict[str, str]) -> str:
    res = client.post(
        "/v1/capability/wobo.turn", json=ask("what is a prime number"), headers={**headers, **SSE}
    )
    assert res.status_code == 200, res.text
    first = res.text.split("\n\n")[1]
    line = next(x for x in first.splitlines() if x.startswith("id: "))
    return line[len("id: ") :].rsplit(":", 1)[0]


def test_one_anonymous_child_cannot_interrupt_another_on_the_same_address(
    client: TestClient, token
) -> None:
    """Two children behind one home or school NAT share an address and nothing else.

    Ownership used to be the meter key, and the meter key for an anonymous learner is
    ``anon:<address>`` — one string for the whole building. Demonstrated: the second child's
    interrupt landed on the first child's turn. The meter stays per address (that is the
    anti-abuse trade); ownership does not."""
    mine = _one_turn(client, _anon("anon-child-one", token))
    stranger = client.post(
        "/v1/board/interrupt", json={"turn": mine}, headers=_anon("anon-child-two", token)
    )
    assert stranger.status_code == 404, "another child's turn must simply not be found"
    assert not stream.recall(mine, "anon:testclient"), "the bare address must not own a turn"


def test_an_anonymous_learner_can_still_resume_and_interrupt_their_own_turn(
    client: TestClient, token
) -> None:
    """The fix must not cost an anonymous learner their own stop button."""
    headers = _anon("anon-child-one", token)
    mine = _one_turn(client, headers)
    own = client.post("/v1/board/interrupt", json={"turn": mine}, headers=headers)
    assert own.status_code == 200
    assert own.json()["interrupted"] is True


def test_the_meter_still_counts_anonymous_learners_per_address(client: TestClient, token) -> None:
    """The abuse property the meter key exists for survives: a fresh anonymous subject is one
    HTTP call away, so it must not buy a fresh allowance."""
    from wobo_gateway.app import meter_key
    from wobo_gateway.auth import Principal

    class _Req:
        headers: dict[str, str] = {}

        class client:  # noqa: N801 — a stand-in for Starlette's request.client
            host = "203.0.113.9"

    one = meter_key(Principal(subject="a", anonymous=True), _Req())  # type: ignore[arg-type]
    two = meter_key(Principal(subject="b", anonymous=True), _Req())  # type: ignore[arg-type]
    assert one == two == "anon:203.0.113.9"
