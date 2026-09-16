"""Is the origin indexed? The fact that releases every other copy of a piece.

``docs/GROWTH-DESK.md`` section 3: *"the blog post goes to heywobo.com first, waits until the URL
is actually indexed, and only then releases the Medium repost with a canonical back, the LinkedIn
document and the X thread."*

Two ways the fact can arrive, and nothing else counts:

1. **Search Console's URL Inspection**, read with a token (``GROWTH_SEARCH_CONSOLE_TOKEN``) for the
   verified property (``GROWTH_SEARCH_CONSOLE_PROPERTY``). The verdict must be ``PASS`` and the
   coverage must say the page is indexed. :func:`read_inspection` is the parser, and the suite
   runs it on recorded answers only.
2. **A person who checked**, from the desk, with a note saying how. That is an owner's act, it
   lands in the console trail, and the note is kept as the evidence.

A page the inspection calls "Crawled, currently not indexed" or "Discovered" is NOT indexed, and a
page with no answer is not either. The default is always "wait".
"""

from __future__ import annotations

import json
import os
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
TOKEN_ENV = "GROWTH_SEARCH_CONSOLE_TOKEN"
PROPERTY_ENV = "GROWTH_SEARCH_CONSOLE_PROPERTY"
_HTTP_TIMEOUT_S = 15.0

Transport = Callable[[str, dict[str, str], dict[str, Any]], tuple[int, Any]]


class NotConfigured(Exception):
    pass


@dataclass(frozen=True)
class Inspection:
    indexed: bool
    verdict: str
    coverage: str
    last_crawl: str

    def evidence(self) -> dict[str, Any]:
        return {
            "source": "search-console",
            "verdict": self.verdict,
            "coverage": self.coverage,
            "last_crawl": self.last_crawl,
        }


def read_inspection(answer: Any) -> Inspection:
    """Search Console's answer, read strictly. Anything unexpected is "not indexed"."""
    result = ((answer or {}).get("inspectionResult") or {}).get("indexStatusResult") or {}
    verdict = str(result.get("verdict") or "")
    coverage = str(result.get("coverageState") or "")
    indexed = (
        verdict == "PASS"
        and "indexed" in coverage.lower()
        and "not indexed" not in coverage.lower()
    )
    return Inspection(
        indexed=indexed,
        verdict=verdict,
        coverage=coverage,
        last_crawl=str(result.get("lastCrawlTime") or ""),
    )


def _urllib(url: str, headers: dict[str, str], body: dict[str, Any]) -> tuple[int, Any]:
    request = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers=headers, method="POST"
    )
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        return response.status, json.loads(response.read().decode() or "{}")


def configured() -> bool:
    return bool((os.getenv(TOKEN_ENV) or "").strip() and (os.getenv(PROPERTY_ENV) or "").strip())


def inspect(url: str, *, transport: Transport | None = None) -> Inspection:
    token = (os.getenv(TOKEN_ENV) or "").strip()
    prop = (os.getenv(PROPERTY_ENV) or "").strip()
    if not token or not prop:
        raise NotConfigured(f"not configured: {TOKEN_ENV} and {PROPERTY_ENV} are needed")
    status, answer = (transport or _urllib)(
        INSPECT_URL,
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        {"inspectionUrl": url, "siteUrl": prop},
    )
    if status >= 400:
        return Inspection(indexed=False, verdict=f"http {status}", coverage="", last_crawl="")
    return read_inspection(answer)


__all__ = ["INSPECT_URL", "Inspection", "NotConfigured", "configured", "inspect", "read_inspection"]
