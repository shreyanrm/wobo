"""Fakes that behave like the seams they stand in for, so a fallback can be PROVED and not assumed.

Two kinds of stand-in live here, and both record who actually answered:

* :class:`ChainFake` is a ``litellm`` module that runs a fallback chain the way litellm runs one:
  the primary first, then each fallback in order, until a model answers. A model that is "down"
  raises; the response of the one that answered carries its id on ``response.model``, which is how
  the usage ledger learns who served. Installed over ``sys.modules["litellm"]`` because every
  seam imports litellm lazily, inside the call.
* :class:`HttpFake` stands in for ``urllib.request.urlopen`` for the seams that speak raw HTTPS to
  a vendor (Gemini text-to-speech, Gemini imagery, and their OpenAI fallbacks). It routes by host,
  so one test can kill Google and let OpenAI answer.

Neither touches a network. Neither reads a key beyond the header a seam put on the request.
"""

from __future__ import annotations

import base64
import io
import json
import struct
import sys
import types
import urllib.error
import wave
from collections.abc import Callable
from typing import Any

import pytest


class Down(Exception):
    """A provider that is not answering."""


class _Message:
    def __init__(self, content: str) -> None:
        self.content = content


class _Choice:
    def __init__(self, content: str) -> None:
        self.message = _Message(content)


class _Usage:
    total_tokens = 30
    prompt_tokens = 20
    completion_tokens = 10


class Response:
    """The slice of a litellm ModelResponse the gateway reads."""

    def __init__(self, content: str, model: str) -> None:
        self.choices = [_Choice(content)]
        self.usage = _Usage()
        self.model = model


class ChainFake:
    """A litellm whose models are up or down by name, running the chain as litellm does."""

    def __init__(self, answers: dict[str, str | Exception], *, bare: bool = False) -> None:
        self.answers = answers
        self.calls: list[dict[str, Any]] = []
        self.tried: list[str] = []
        self.drop_params = False
        #: litellm reports the BARE model name on a response ("gpt-5.6-terra"); ``bare`` makes the
        #: fake do the same, so a test can prove the ledger still learns the provider.
        self.bare = bare

    def completion(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        chain = [str(kwargs.get("model") or "")]
        for fb in kwargs.get("fallbacks") or []:
            chain.append(fb["model"] if isinstance(fb, dict) else str(fb))
        last: Exception = Down(f"no model in {chain} is known to this fake")
        for model in chain:
            self.tried.append(model)
            step = self.answers.get(model, Down(f"{model} is down"))
            if isinstance(step, Exception):
                last = step
                continue
            return Response(step, model.split("/", 1)[1] if self.bare and "/" in model else model)
        raise last

    @staticmethod
    def completion_cost(**_: Any) -> float:
        return 0.001

    def install(self, monkeypatch: pytest.MonkeyPatch) -> ChainFake:
        module = types.ModuleType("litellm")
        module.completion = self.completion  # type: ignore[attr-defined]
        module.completion_cost = self.completion_cost  # type: ignore[attr-defined]
        module.drop_params = False  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "litellm", module)
        return self

    @property
    def served(self) -> str | None:
        """Who answered the LAST chain that was run, or None when nobody did."""
        return self.tried[-1] if self.tried else None


def chain(
    monkeypatch: pytest.MonkeyPatch, answers: dict[str, str | Exception], *, bare: bool = False
) -> ChainFake:
    return ChainFake(answers, bare=bare).install(monkeypatch)


# --- the raw HTTPS seams -------------------------------------------------------------------------


class _Body:
    def __init__(self, raw: bytes, status: int = 200) -> None:
        self._raw = raw
        self.status = status

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> _Body:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None


def http_error(url: str, code: int, detail: str = "") -> urllib.error.HTTPError:
    body = io.BytesIO(detail.encode())
    return urllib.error.HTTPError(url, code, detail, {}, body)  # type: ignore[arg-type]


Handler = Callable[[Any], Any]


class HttpFake:
    """``urlopen`` routed by host. A handler gets the Request and returns bytes, a dict (sent as
    JSON), or raises. Every request is kept so a test can read what was SENT, header names
    included, without ever printing a value."""

    def __init__(self) -> None:
        self.handlers: dict[str, Handler] = {}
        self.requests: list[Any] = []
        #: The ``timeout`` each request was opened with, in order: a seam's deadline is a fact
        #: a test can hold it to (a primary with a fallback behind it must not wait a minute).
        self.timeouts: list[float] = []

    def on(self, host: str, handler: Handler) -> HttpFake:
        self.handlers[host] = handler
        return self

    def __call__(self, req: Any, timeout: float = 0) -> _Body:
        self.requests.append(req)
        self.timeouts.append(timeout)
        url = req.full_url if hasattr(req, "full_url") else str(req)
        host = url.split("/")[2]
        handler = self.handlers.get(host)
        if handler is None:
            raise urllib.error.URLError(f"no route to {host} in this test")
        out = handler(req)
        if isinstance(out, dict):
            return _Body(json.dumps(out).encode())
        return _Body(out)

    def install(self, monkeypatch: pytest.MonkeyPatch) -> HttpFake:
        import urllib.request

        monkeypatch.setattr(urllib.request, "urlopen", self)
        return self

    def sent_to(self, host: str) -> list[dict[str, Any]]:
        out = []
        for req in self.requests:
            if req.full_url.split("/")[2] == host and req.data:
                out.append(json.loads(req.data.decode()))
        return out


def wav_bytes(seconds: float, rate: int = 24000, *, streamed: bool = False) -> bytes:
    """A silent WAV of the given length: what a text-to-speech vendor would send back.

    ``streamed`` writes the header the way OpenAI streams it, with the RIFF and data sizes left
    as 0xFFFFFFFF placeholders (seen live, 2026-09-05): a reader that trusts them measures a
    two-second line at a day."""
    frames = int(seconds * rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * frames)
    raw = buf.getvalue()
    if not streamed:
        return raw
    data_at = raw.index(b"data")
    return (
        raw[:4]
        + b"\xff\xff\xff\xff"
        + raw[8:data_at]
        + b"data"
        + b"\xff\xff\xff\xff"
        + raw[data_at + 8 :]
    )


def gemini_audio(seconds: float) -> dict[str, Any]:
    """Gemini's generateContent answer for a spoken line: raw PCM in an inline part."""
    pcm = b"\x00\x00" * int(seconds * 24000)
    return {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": "audio/L16;codec=pcm;rate=24000",
                                "data": base64.b64encode(pcm).decode(),
                            }
                        }
                    ]
                },
                "finishReason": "STOP",
            }
        ]
    }


def png_bytes() -> bytes:
    """A real, non-trivial PNG payload (image.py verifies size, not pixels)."""
    header = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0)
    return header + b"\x00\x00\x00\rIHDR" + ihdr + b"\x00" * 400 + b"IEND"


def gemini_image(data: bytes) -> dict[str, Any]:
    return {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": "image/png",
                                "data": base64.b64encode(data).decode(),
                            }
                        }
                    ]
                }
            }
        ]
    }


# --- the ledger ----------------------------------------------------------------------------------


class LedgerSink:
    """A configured usage ledger that keeps its rows in memory, flushed by the test."""

    def __init__(self) -> None:
        self.calls: list[Any] = []

    def __call__(
        self, method: str, url: str, headers: dict[str, str], body: bytes | None
    ) -> tuple[int, Any]:
        self.calls.append(json.loads(body.decode()) if body else None)
        return 201, None

    @property
    def rows(self) -> list[dict[str, Any]]:
        from wobo_gateway import ledger

        ledger.flush_now()
        out: list[dict[str, Any]] = []
        for parsed in self.calls:
            if isinstance(parsed, list):
                out.extend(parsed)
        return out


def ledger_sink(monkeypatch: pytest.MonkeyPatch) -> LedgerSink:
    from wobo_gateway import ledger

    monkeypatch.setenv("USAGE_LEDGER_PEPPER", "a-pepper-for-the-suite")
    sink = LedgerSink()
    ledger.configure(
        base_url="https://project.example", service_key="svc", transport=sink, autoflush=False
    )
    return sink
