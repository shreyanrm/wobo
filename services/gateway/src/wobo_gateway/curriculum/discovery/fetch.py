"""Stage 2 — the document, on a budget (``docs/CURRICULUM.md`` §4.2).

HTML or PDF in, text with page anchors out. Four rules, all of them enforced here rather than
trusted to the caller:

1. **Budgets.** A byte ceiling, a wall clock, a redirect ceiling and a character ceiling. A
   syllabus is a few hundred kilobytes; anything past the ceiling is not the document we want,
   and a stream with no end is a worker held open forever.
2. **Robots.** ``robots.txt`` is fetched once per host and honoured. A disallowed URL is a
   refusal, not a slower fetch.
3. **No JavaScript.** We read what the server sends. A syllabus that only exists after a script
   runs is not a document we can cite, so it is a refusal and the own-syllabus path.
4. **No inside voice.** Loopback, private and link-local addresses are refused before a socket
   opens: this fetcher takes a URL chosen by a model, and a model that has been talked into
   naming ``http://169.254.169.254`` must reach nothing. That door is :func:`check_target`, and
   it is the door for the first URL **and every redirect target** — a public-looking name that
   resolves inward is an inside address wearing an outside name.

**Page anchors** are what make ``source_ref`` honest. A PDF page is a page. An HTML document has
no pages, so its headings become the anchors and a node's ``source_ref`` carries a section rather
than a page number. Either way every extracted node points at a place a person can open and check.

``fetch_document`` takes an ``opener`` so the whole module is testable without a network: the
default opener is the only code here that touches ``urllib``.
"""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import os
import re
import socket
import time
import urllib.robotparser
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse

logger = logging.getLogger("wobo.gateway.curriculum.discovery.fetch")

USER_AGENT = os.getenv(
    "CURRICULUM_USER_AGENT", "wobo-curriculum-discovery/1.0 (+https://heywobo.com)"
)
ACCEPT = "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8"

_HTML_TYPES = ("text/html", "application/xhtml")
_PDF_TYPES = ("application/pdf", "application/x-pdf")
_PRIVATE_HOSTS = ("localhost", "localhost.localdomain")
_PRIVATE_SUFFIXES = (".local", ".internal", ".localhost")


class FetchRefused(Exception):
    """The document could not be fetched honestly. ``reason`` is a stable machine code."""

    def __init__(self, reason: str, detail: str = "") -> None:
        self.reason = reason
        self.detail = detail
        super().__init__(f"{reason}: {detail}" if detail else reason)


@dataclass(frozen=True)
class FetchBudget:
    """What one document may cost us. Generous for a syllabus, closed for anything else."""

    max_bytes: int = 8 * 1024 * 1024
    timeout_s: float = 20.0
    max_redirects: int = 3
    max_pages: int = 200
    max_chars: int = 400_000


@dataclass(frozen=True)
class Page:
    """One anchor in the document: a PDF page, or an HTML section under its heading."""

    number: int
    text: str
    section: str | None = None


@dataclass(frozen=True)
class RawResponse:
    """What an opener returns. Deliberately dumb — bytes, a type, and where we ended up."""

    url: str
    status: int
    media_type: str
    body: bytes
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Document:
    """A fetched document and everything provenance needs to cite it (``CURRICULUM.md`` §5)."""

    id: str
    url: str
    media_type: str
    title: str
    bytes: int
    document_sha256: str
    extracted_text_sha256: str
    fetched_at: str
    pages: tuple[Page, ...]
    extraction: str
    truncated: bool = False

    @property
    def text(self) -> str:
        return "\n\n".join(page.text for page in self.pages)

    @property
    def page_numbers(self) -> tuple[int, ...]:
        return tuple(page.number for page in self.pages)

    def sections(self) -> tuple[str, ...]:
        return tuple(page.section for page in self.pages if page.section)

    def anchored_text(self, max_chars: int | None = None) -> str:
        """The text a model reads, every page marked so it can cite one.

        The marker is the contract with :mod:`extract`: the model is told to put the number after
        ``[[page`` into every ``source_ref``, which is what makes a citation checkable in code.
        """
        chunks: list[str] = []
        used = 0
        for page in self.pages:
            head = f"[[page {page.number}"
            if page.section:
                head += f" | {page.section}"
            head += "]]\n"
            chunk = head + page.text.strip()
            if max_chars is not None and used + len(chunk) > max_chars:
                remaining = max_chars - used
                if remaining > len(head) + 40:
                    chunks.append(chunk[:remaining])
                break
            chunks.append(chunk)
            used += len(chunk)
        return "\n\n".join(chunks)

    def as_provenance(self) -> dict[str, Any]:
        """The ``documents[]`` entry stored beside the syllabus."""
        return {
            "id": self.id,
            "title": self.title,
            "url": self.url,
            "media_type": self.media_type,
            "pages": len(self.pages),
            "bytes": self.bytes,
            "fetched_at": self.fetched_at,
            "document_sha256": self.document_sha256,
            "extracted_text_sha256": self.extracted_text_sha256,
            "extraction": self.extraction,
            "truncated": self.truncated,
        }


# --- url safety ------------------------------------------------------------------------
def _host_is_private(host: str) -> bool:
    lowered = host.lower().rstrip(".")
    if lowered in _PRIVATE_HOSTS or lowered.endswith(_PRIVATE_SUFFIXES):
        return True
    try:
        address = ipaddress.ip_address(lowered.strip("[]"))
    except ValueError:
        return False
    return not address.is_global


def check_url(url: str) -> str:
    """Refuse anything that is not a public http(s) document, before a socket opens."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise FetchRefused("unsupported_scheme", parsed.scheme or url[:40])
    host = parsed.hostname or ""
    if not host:
        raise FetchRefused("no_host", url[:80])
    if _host_is_private(host):
        raise FetchRefused("private_address", host)
    return url


def check_target(url: str) -> str:
    """The whole door for a URL we are about to OPEN: what it says, then where it points.

    :func:`check_url` reads the URL itself. This also resolves it, because a public-looking
    hostname that answers with ``10.0.0.5`` or ``169.254.169.254`` is an inside address wearing
    an outside name. Every socket this module opens goes through here — the first request and
    **every redirect target**. The redirect half used to call ``check_url`` alone, so a redirect
    to a public-looking name that resolved inward was followed; the URL the model chose was
    checked and the URL we actually fetched was not.

    What this does not close is DNS rebinding. Between this resolution and the connection the
    name may answer differently, and urllib resolves again when it connects, so a server that
    returns a public address here and a private one a moment later is still followed. Closing
    that needs a connector that dials the literal address resolved here while keeping the ``Host``
    header — which urllib does not offer and which would need its own HTTPS verification path.
    Until then the window stands, bounded by the fact that this fetcher is reachable only from
    the discovery job, reads at most :attr:`FetchBudget.max_bytes`, and never echoes the body to
    a learner: the extractor must recognise it as a syllabus first.
    """
    check_url(url)
    host = urlparse(url).hostname or ""
    if not _resolves_public(host):
        raise FetchRefused("private_address", host)
    return url


def _resolves_public(host: str) -> bool:
    """DNS guard for the real opener: a public name that resolves inward is still inward."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        address = info[4][0]
        try:
            if not ipaddress.ip_address(address).is_global:
                return False
        except ValueError:  # pragma: no cover — getaddrinfo returned something unparseable
            return False
    return bool(infos)


# --- the default opener (the only urllib in this module) --------------------------------
def redirect_handler(budget: FetchBudget) -> Any:
    """The redirect policy for one fetch: a ceiling on hops, and the full door on every hop.

    Module level and returned rather than nested inside the opener so the policy can be tested
    without a socket — the check that was missing here is not a check anyone can see from the
    outside.
    """
    import urllib.request

    class _LimitedRedirects(urllib.request.HTTPRedirectHandler):
        max_redirections = budget.max_redirects

        def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
            check_target(newurl)
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    return _LimitedRedirects



def default_opener(url: str, *, budget: FetchBudget) -> RawResponse:
    """One GET, redirect-limited, size-capped, with no JavaScript anywhere near it."""
    import urllib.error
    import urllib.request

    check_target(url)

    opener = urllib.request.build_opener(redirect_handler(budget))
    request = urllib.request.Request(  # noqa: S310 — scheme is checked above
        url, headers={"User-Agent": USER_AGENT, "Accept": ACCEPT}
    )
    try:
        with opener.open(request, timeout=budget.timeout_s) as response:
            body = response.read(budget.max_bytes + 1)
            media_type = (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            final_url = response.geturl()
            status = int(getattr(response, "status", 200) or 200)
    except urllib.error.HTTPError as exc:
        raise FetchRefused("http_error", f"{exc.code}") from exc
    except FetchRefused:
        raise
    except Exception as exc:
        raise FetchRefused("unreachable", type(exc).__name__) from exc
    if len(body) > budget.max_bytes:
        raise FetchRefused("too_large", f">{budget.max_bytes} bytes")
    return RawResponse(url=final_url, status=status, media_type=media_type, body=body)


Opener = Callable[..., RawResponse]

_robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def reset_robots_cache() -> None:
    """Test seam, and the freshness job's way of not trusting a month-old robots file."""
    _robots_cache.clear()


def robots_allows(url: str, *, opener: Opener, budget: FetchBudget | None = None) -> bool:
    """Honour ``robots.txt``. A missing or unreadable file allows, a disallow rule refuses.

    Absent robots means no rule, which is the convention every crawler follows; a rule we can
    read and that says no is final, whatever the document is worth to us.
    """
    budget = budget or FetchBudget()
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in _robots_cache:
        parser: urllib.robotparser.RobotFileParser | None
        try:
            response = opener(urljoin(origin, "/robots.txt"), budget=budget)
            text = response.body.decode("utf-8", "replace")
            parser = urllib.robotparser.RobotFileParser()
            parser.parse(text.splitlines())
        except Exception:
            parser = None  # no readable robots file is no rule
        _robots_cache[origin] = parser
    parser = _robots_cache[origin]
    if parser is None:
        return True
    return parser.can_fetch(USER_AGENT, url)


# --- HTML -> sections -------------------------------------------------------------------
_DROP_TAGS = {"script", "style", "noscript", "template", "svg", "head", "nav", "footer", "form"}
_BREAK_TAGS = {"p", "br", "li", "tr", "div", "section", "article", "td", "th", "dd", "dt"}
_HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
_WS = re.compile(r"[ \t ]+")
_BLANKS = re.compile(r"\n{3,}")


class _SectionExtractor(HTMLParser):
    """Text under headings. No JS, no CSS, no chrome — the words a person would read."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.sections: list[tuple[str | None, list[str]]] = [(None, [])]
        self._depth_dropped = 0
        self._in_title = False
        self._in_heading = False
        self._heading: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _DROP_TAGS:
            # <head> holds <title>, which we do want; drop its other children only.
            if tag != "head":
                self._depth_dropped += 1
            return
        if tag == "title":
            self._in_title = True
            return
        if self._depth_dropped:
            return
        if tag in _HEADING_TAGS:
            self._in_heading = True
            self._heading = []
        elif tag in _BREAK_TAGS:
            self.sections[-1][1].append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _DROP_TAGS:
            if tag != "head":
                self._depth_dropped = max(0, self._depth_dropped - 1)
            return
        if tag == "title":
            self._in_title = False
            return
        if tag in _HEADING_TAGS and self._in_heading:
            self._in_heading = False
            heading = _WS.sub(" ", "".join(self._heading)).strip()[:200]
            if heading:
                self.sections.append((heading, []))

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title = (self.title + data).strip()[:300]
            return
        if self._depth_dropped:
            return
        if self._in_heading:
            self._heading.append(data)
            return
        self.sections[-1][1].append(data)


def html_to_pages(html: str, *, budget: FetchBudget) -> tuple[str, tuple[Page, ...]]:
    """(title, sections). Each heading opens an anchor a ``source_ref`` can name."""
    parser = _SectionExtractor()
    parser.feed(html)
    parser.close()
    pages: list[Page] = []
    for heading, chunks in parser.sections:
        text = _BLANKS.sub("\n\n", _WS.sub(" ", "".join(chunks))).strip()
        if not text and not heading:
            continue
        body = f"{heading}\n{text}".strip() if heading else text
        if not body:
            continue
        pages.append(Page(number=len(pages) + 1, text=body[: budget.max_chars], section=heading))
        if len(pages) >= budget.max_pages:
            break
    title = parser.title or (pages[0].section or "") if pages else parser.title
    return title.strip(), tuple(pages)


# --- PDF -> pages ------------------------------------------------------------------------
def pdf_to_pages(data: bytes, *, budget: FetchBudget) -> tuple[str, tuple[Page, ...]]:
    """(title, pages). Pure-Python (pypdf), so no binary is needed in the image."""
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover — declared in pyproject
        raise FetchRefused("pdf_reader_unavailable", "pypdf is not installed") from exc
    import io

    try:
        reader = PdfReader(io.BytesIO(data))
        raw_pages = list(reader.pages)[: budget.max_pages]
        title = ""
        meta = getattr(reader, "metadata", None)
        if meta is not None:
            title = str(getattr(meta, "title", "") or "").strip()[:300]
        pages: list[Page] = []
        for index, page in enumerate(raw_pages, start=1):
            text = (page.extract_text() or "").strip()
            if not text:
                continue
            pages.append(Page(number=index, text=text[: budget.max_chars]))
    except FetchRefused:
        raise
    except Exception as exc:
        raise FetchRefused("pdf_unreadable", type(exc).__name__) from exc
    if not pages:
        # A PDF of page images has no text we can cite, and OCR is not a source we would trust
        # for a syllabus. Refuse, and let the learner show us their own.
        raise FetchRefused("pdf_has_no_text", "scanned or image-only document")
    if not title and pages[0].text:
        title = pages[0].text.splitlines()[0].strip()[:300]
    return title, tuple(pages)


def _document_id(url: str) -> str:
    """Short, stable, readable: the file stem plus a hash of the whole URL."""
    stem = re.sub(r"[^a-z0-9]+", "-", urlparse(url).path.rsplit("/", 1)[-1].lower()).strip("-")
    stem = re.sub(r"-(pdf|html?|aspx?)$", "", stem)[:40] or "document"
    return f"{stem}-{hashlib.sha256(url.encode()).hexdigest()[:8]}"


def fetch_document(
    url: str,
    *,
    budget: FetchBudget | None = None,
    opener: Opener | None = None,
    respect_robots: bool = True,
    clock: Callable[[], float] = time.monotonic,
    now: Callable[[], datetime] | None = None,
) -> Document:
    """Fetch one URL into a :class:`Document`, or raise :class:`FetchRefused`.

    Every refusal carries a machine-readable ``reason`` so the job can tell the learner the
    honest thing (nothing found, could not read it) instead of a stack trace or a guess.
    """
    budget = budget or FetchBudget()
    opener = opener or default_opener
    check_url(url)
    started = clock()
    if respect_robots and not robots_allows(url, opener=opener, budget=budget):
        raise FetchRefused("robots_disallowed", urlparse(url).hostname or "")
    response = opener(url, budget=budget)
    if response.status >= 400:
        raise FetchRefused("http_error", str(response.status))
    if len(response.body) > budget.max_bytes:
        raise FetchRefused("too_large", f">{budget.max_bytes} bytes")
    if clock() - started > budget.timeout_s:
        raise FetchRefused("timeout", f">{budget.timeout_s}s")

    media_type = (response.media_type or "").lower()
    body = response.body
    if any(media_type.startswith(t) for t in _PDF_TYPES) or body[:5] == b"%PDF-":
        media_type = "application/pdf"
        title, pages = pdf_to_pages(body, budget=budget)
        extraction = "pypdf text extraction, page-anchored"
    elif any(media_type.startswith(t) for t in _HTML_TYPES) or not media_type:
        media_type = "text/html"
        title, pages = html_to_pages(body.decode("utf-8", "replace"), budget=budget)
        extraction = "stdlib HTML parser, heading-anchored, no scripts executed"
    else:
        raise FetchRefused("unsupported_media_type", media_type)

    if not pages:
        raise FetchRefused("no_text", media_type)

    text = "\n\n".join(page.text for page in pages)
    truncated = len(text) > budget.max_chars
    stamp = (now() if now else datetime.now(UTC)).replace(microsecond=0)
    return Document(
        id=_document_id(response.url or url),
        url=response.url or url,
        media_type=media_type,
        title=title or (urlparse(url).path.rsplit("/", 1)[-1] or url),
        bytes=len(body),
        document_sha256=hashlib.sha256(body).hexdigest(),
        extracted_text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        fetched_at=stamp.isoformat().replace("+00:00", "Z"),
        pages=pages,
        extraction=extraction,
        truncated=truncated,
    )
