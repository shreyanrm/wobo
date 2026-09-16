"""The hands: one poster per channel a script may post to, and nothing for any other channel.

``docs/GROWTH-DESK.md`` section 2, tier 1: *"our own blog, Telegram, Threads, Instagram, the
Facebook page, the LinkedIn page, YouTube, and X."* Section 5 orders the wiring: Telegram first,
then the blog and Threads, then the rest. This file follows that order and says plainly where it
stops.

=============  ==============================================================================
blog           writes the post as a file in the blog's source folder (``GROWTH_BLOG_DIR``),
               where the site's build publishes it. Wired.
telegram       the Bot API's ``sendMessage``, one message, the link at its foot. Wired.
threads        the Threads API: a container, then publish, each reply chained to the last. Wired.
x              the posts endpoint, each reply chained to the last, the link only in the last.
               Wired.
linkedin       a document post needs the pages rendered to a PDF and uploaded first; nothing
               renders one yet. Not wired, and says so.
instagram      Reels and carousels need a film or rendered images at a public address; the film
facebook       pipeline has not made one for any piece. Not wired, and says so.
youtube
=============  ==============================================================================

A poster that is not configured raises :class:`NotConfigured` with the variable it is missing, and
the outbox leaves the post approved with that sentence on it. Nothing here is called by a test
against a real network: every poster takes a ``transport`` and the suite hands it a recording.

**There is no poster for a tier 2 or tier 3 channel, and :func:`poster_for` refuses to build one.**
Tier 2 is a person pressing send. Tier 3 is Reddit and Quora, and there is no code for them at all.
"""

from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from wobo_gateway.growth import campaigns, channels
from wobo_gateway.growth.shapes import Post, blog_file_name

_HTTP_TIMEOUT_S = 15.0
#: The blog compiler's file name: a number, a separator, the address (``post.ts`` postSlug).
_BLOG_FILE = re.compile(r"^(\d+)[-_](.+)\.md$")

Transport = Callable[[str, str, dict[str, str], Any], tuple[int, Any]]


class NotConfigured(Exception):
    """This channel has no credentials here. Not a failure: a post waits with this reason."""


class NotWired(Exception):
    """No code posts to this channel yet, and the reason is the sentence in this exception."""


class PostFailed(Exception):
    """The channel refused or broke. The post is marked failed with this sentence."""


def _urllib(url: str, method: str, headers: dict[str, str], body: Any) -> tuple[int, Any]:
    data: bytes | None = None
    if body is not None:
        if headers.get("Content-Type") == "application/x-www-form-urlencoded":
            data = urllib.parse.urlencode(body).encode()
        else:
            data = json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode()
        return response.status, (json.loads(raw) if raw.strip() else {})


class Poster(Protocol):
    channel: str

    def post(self, post: Post) -> str:
        """Send it, and return the channel's own reference to what was sent."""
        ...


def _need(*names: str) -> tuple[str, ...]:
    values = tuple((os.getenv(name) or "").strip() for name in names)
    missing = [name for name, value in zip(names, values, strict=True) if not value]
    if missing:
        raise NotConfigured(f"not configured: {', '.join(missing)} is not set")
    return values


def _call(transport: Transport, url: str, method: str, headers: dict[str, str], body: Any) -> Any:
    try:
        status, answer = transport(url, method, headers, body)
    except Exception as exc:  # noqa: BLE001 — every network failure is one failure to the desk
        raise PostFailed(f"the channel could not be reached: {type(exc).__name__}") from exc
    if status >= 400:
        raise PostFailed(f"the channel refused the post with {status}")
    return answer


@dataclass
class BlogPoster:
    """The origin. A file in the blog's own folder, named the way the compiler expects."""

    channel: str = channels.ORIGIN
    folder: Path | None = None

    def post(self, post: Post) -> str:
        folder = self.folder
        if folder is None:
            (raw,) = _need("GROWTH_BLOG_DIR")
            folder = Path(raw)
        if not folder.is_dir():
            raise NotConfigured(f"not configured: the blog folder {folder} does not exist")
        slug = campaigns.parse(post.campaign_id).slug
        # Any number of digits: the compiler strips ``^\d+[-_]``, so post 100 is as much a post
        # as post 07, and a two-digit glob would miss it and number every later post 100 again.
        taken: list[tuple[int, str]] = []
        for existing in folder.glob("*.md"):
            found = _BLOG_FILE.match(existing.name)
            if found:
                taken.append((int(found.group(1)), found.group(2)))
        if any(name == slug for _, name in taken):
            raise PostFailed(f"the blog already has a post at {slug}")
        number = max((n for n, _ in taken), default=0) + 1
        target = folder / blog_file_name(slug, number)
        target.write_text(post.units[0], encoding="utf-8")
        return target.name


@dataclass
class TelegramPoster:
    channel: str = "telegram"
    transport: Transport = _urllib

    def post(self, post: Post) -> str:
        token, chat = _need("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID")
        answer = _call(
            self.transport,
            f"https://api.telegram.org/bot{token}/sendMessage",
            "POST",
            {"Content-Type": "application/json"},
            {"chat_id": chat, "text": post.text(), "disable_web_page_preview": False},
        )
        message = (answer or {}).get("result") or {}
        if not (answer or {}).get("ok") or "message_id" not in message:
            raise PostFailed("the channel did not confirm the message")
        return f"telegram:{message['message_id']}"


@dataclass
class ThreadsPoster:
    channel: str = "threads"
    transport: Transport = _urllib

    def post(self, post: Post) -> str:
        user, token = _need("THREADS_USER_ID", "THREADS_ACCESS_TOKEN")
        base = f"https://graph.threads.net/v1.0/{user}"
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        first: str | None = None
        previous: str | None = None
        for unit in post.units:
            body: dict[str, Any] = {"media_type": "TEXT", "text": unit, "access_token": token}
            if previous:
                body["reply_to_id"] = previous
            made = _call(self.transport, f"{base}/threads", "POST", headers, body)
            container = (made or {}).get("id")
            if not container:
                raise PostFailed("the channel did not return a container")
            sent = _call(
                self.transport,
                f"{base}/threads_publish",
                "POST",
                headers,
                {"creation_id": container, "access_token": token},
            )
            previous = (sent or {}).get("id")
            if not previous:
                raise PostFailed("the channel did not publish the container")
            first = first or previous
        return f"threads:{first}"


@dataclass
class XPoster:
    channel: str = "x"
    transport: Transport = _urllib

    def post(self, post: Post) -> str:
        (token,) = _need("X_USER_ACCESS_TOKEN")
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
        first: str | None = None
        previous: str | None = None
        for index, unit in enumerate(post.units):
            if index < len(post.units) - 1 and ("http://" in unit or "https://" in unit):
                raise PostFailed("an address appears before the last reply")
            body: dict[str, Any] = {"text": unit}
            if previous:
                body["reply"] = {"in_reply_to_tweet_id": previous}
            sent = _call(self.transport, "https://api.x.com/2/tweets", "POST", headers, body)
            previous = ((sent or {}).get("data") or {}).get("id")
            if not previous:
                raise PostFailed("the channel did not return the post")
            first = first or previous
        return f"x:{first}"


@dataclass
class UnwiredPoster:
    channel: str
    because: str

    def post(self, post: Post) -> str:
        raise NotWired(self.because)


UNWIRED: dict[str, str] = {
    "linkedin": (
        "not wired: a document post needs its pages rendered to a PDF and uploaded before it is "
        "posted, and nothing renders the pages yet"
    ),
    "instagram": (
        "not wired: a Reel needs a film at a public address, and the film pipeline has not made "
        "one for any piece"
    ),
    "facebook": (
        "not wired: the page's video post needs a film at a public address, and the film "
        "pipeline has not made one for any piece"
    ),
    "youtube": (
        "not wired: a Short needs a film to upload, and the film pipeline has not made one for "
        "any piece"
    ),
}

_BUILDERS: dict[str, Callable[[], Poster]] = {
    channels.ORIGIN: BlogPoster,
    "telegram": TelegramPoster,
    "threads": ThreadsPoster,
    "x": XPoster,
}

_overrides: dict[str, Poster] = {}


def poster_for(channel_key: str) -> Poster:
    """The poster for a tier 1 channel. Refuses tier 3 loudly and tier 2 plainly."""
    channels.refuse(channel_key)
    if not channels.may_a_script_post(channel_key):
        raise NotWired(f"{channel_key} is sent by a person, never by a script")
    if channel_key in _overrides:
        return _overrides[channel_key]
    if channel_key in _BUILDERS:
        return _BUILDERS[channel_key]()
    return UnwiredPoster(channel=channel_key, because=UNWIRED[channel_key])


def wiring() -> list[dict[str, Any]]:
    """What the desk prints about each tier 1 channel: wired or not, and why."""
    out: list[dict[str, Any]] = []
    for channel in channels.script_channels():
        entry: dict[str, Any] = {"channel": channel.key, "wired": channel.key in _BUILDERS}
        if channel.key in UNWIRED:
            entry["because"] = UNWIRED[channel.key]
        out.append(entry)
    return out


def set_poster(channel_key: str, poster: Poster | None) -> None:
    """Test seam. Refuses tier 3 like everything else here."""
    channels.refuse(channel_key)
    if poster is None:
        _overrides.pop(channel_key, None)
    else:
        _overrides[channel_key] = poster


def reset() -> None:
    _overrides.clear()


__all__ = [
    "UNWIRED",
    "BlogPoster",
    "NotConfigured",
    "NotWired",
    "PostFailed",
    "Poster",
    "TelegramPoster",
    "ThreadsPoster",
    "UnwiredPoster",
    "XPoster",
    "poster_for",
    "reset",
    "set_poster",
    "wiring",
]
