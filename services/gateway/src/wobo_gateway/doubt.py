"""Wobo's eyes, the doubt solver: a photo of a page of work, read back, corrected, then taught over.

The owner, 2026-09-05: "when the students are using their phones or computers or tabs, they can
upload or take a photo of their book or whatever they have a doubt about and wobo can annotate on
that and explain as well." A learner with a textbook open does not want to type the question; they
want to point at it. This is the one place the product needs vision, and it is built as TWO steps
over ONE existing tutor, not as a scanner beside it.

**Step one, the reading** (``POST /v1/doubt``). The photo is bounded, downscaled, stripped of its
metadata and SCREENED before it is read or kept (law 2). Then a vision call on the generate tier
returns what is on the page as lines, each with a box in page fractions, plus the subject, the
topic and the question. The reading is sent back FIRST, as its own answer, with Wobo's line "I read
this as ..., is that right?" and no answer at all (law 1): vision misreads, a 3 becomes an 8, a
minus vanishes, and the verified-number law downstream depends on what was read, so the learner
corrects the reading before a single number is computed.

**Step two, the answer** (``POST /v1/doubt/{id}/answer``, ``Accept: text/event-stream``). The
corrected reading becomes the learner's working, the photo becomes a registered surface whose
targets are the lines that were read, and the whole thing is handed to the EXISTING streaming board
turn (``app.stream_board_turn``): the planner, the verifier, the spoken-number law, both safety
screens, the meter, the money ceiling and the ledger are the ones already there. Nothing here is a
second tutor. Two things are added on the way through, by :class:`DoubtShaper`:

* **Law 3 — nothing is placed by pixels from the model's guess.** A mark the model authors may
  anchor only to a line of the page (a target this module registered) or to another mark. A
  board-space anchor, an offset, or a target that is not a line of the page is not drawn; it is
  counted as *off the page* in the turn's refusals (the ``done`` frame, which is what the teaching
  harness reads: ``harness/checks.py`` ``check_on_the_page``) and on :data:`OFF_PAGE` for this
  process. Geometry the pipelines compute for an intent is placed by code and verified, so
  it is allowed, and it opens the plane over the photo rather than guessing at a pixel on it.
* **Law 5 — it explains while it draws.** Every ink object lands on a beat: the model's own beat is
  honoured, an object with none is given ``meta.beat.with`` the sentence it belongs to, and the
  first stroke is always on the first sentence. ``board.stream`` then puts each ``ink`` frame at
  exactly the timestamp of the ``say`` frame it was beaten to, so on a doubt turn no ink frame lands
  without a say frame in the same beat.

**Law 4 — a doubt joins the climb.** When the client says which board the learner follows, the
reading's topic is matched to a node of their pinned syllabus and the doubt is filed under that
node's id — the same ``topicNodeUuid`` the app's practice pools and mastery reads derive from a
topic id, ported here as :func:`topic_node_uuid` and held to the TypeScript value by a test. With
no board named it is filed under a doubt node of its own. On the answer, a slip is written into
Wobo's mind (``learner.wobo_mind``) under that node with the doubt as its item and the day's
``asked`` counter goes up one, which is what the re-teach ladder weighs and what brings a slipped
topic back.

WHAT IS KEPT, AND WHY (law 2, the memory law). One row in ``learner.doubts`` and one object in the
private ``doubt-photos`` bucket, both keyed to the account:

* the photo, as re-encoded here — JPEG, long edge at most :data:`LONG_EDGE_PX`, orientation
  applied, and NO metadata (a phone writes GPS into a photo; the page does not need it, so it never
  reaches the bucket). Kept so the memory page can show the learner what Wobo read on any device,
  and so a doubt that comes back can be shown again. Cropped to the work when the screen said the
  rest of the frame carried something a page does not need.
* the reading: the lines and their boxes, corrected by the learner, the subject, topic and
  question. Kept because it IS the doubt: the targets ink anchored to, and the working the answer
  was computed from.
* the learner's own words, bounded, and where the doubt was filed in their syllabus.
* nothing about the answer itself: the turn is in the board store for its resume window and no
  longer, exactly as every other turn.

Every one of these is listed on ``GET /v1/doubt``, removable one at a time on ``DELETE
/v1/doubt/{id}``, and ``POST /v1/me/erase`` reaches the table AND the bucket (``memory.erase``
calls :func:`DoubtStore.forget_all`), reporting the rows and the objects that actually left. A
photo that fails the screen is never written anywhere. A screen that cannot run is a refusal
(``safety.screen_image`` fails closed), and the learner is told the checker did not run.

COST. One doubt is two vision calls and one board plan: the screen on the tiny tier
(``doubt.screen``, one image in, about 30 tokens out), the reading on the generate tier
(``doubt.read``, one image and a short instruction in, up to 1500 tokens out), and then the
ordinary board plan the answer already costs. All three go through ``telemetry.record_cost`` into
the spend accumulator and the durable ledger; the two vision rows carry ``unit_kind = "doubt"``
(``ledger.DOUBT``) and the answer writes a ``doubt`` delivery row, so "what does one doubt cost" is
one GROUP BY. The money ceiling is asked BEFORE the first vision call with the caller's lane, and
a refused day costs the learner nothing.
"""

from __future__ import annotations

import base64
import binascii
import contextlib
import io
import json
import logging
import os
import re
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, Protocol

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from wobo_gateway import billing, budget, consent, ledger, spend
from wobo_gateway.auth import Principal
from wobo_gateway.safety import ImageScreen, ImageVerdict, screen_image

logger = logging.getLogger("wobo.gateway.doubt")

# --- bounds --------------------------------------------------------------------------------------

#: Decoded image bytes past this are refused before a pixel is decoded. A phone photo is 2 to 4 MB;
#: this is a page, not a scan.
MAX_IMAGE_BYTES = int(os.getenv("DOUBT_MAX_IMAGE_BYTES", str(6 * 1024 * 1024)))
#: A side longer than this is not a photo of a page. The dimensions are read from the header
#: before the pixels are allocated.
MAX_SIDE_PX = 8000
#: The decompression guard, in PIXELS. Bytes and side length were not it: a 200 KB 8000x8000 white
#: PNG passed both and grew the process by about 265 MB before it was downscaled. Forty megapixels
#: is more than any phone writes and a fraction of that.
MAX_PIXELS = 40_000_000
#: What reaches a model and the bucket. A page reads perfectly well at this size, and a smaller
#: image is a cheaper vision call: the token cost of an image scales with its area.
LONG_EDGE_PX = 1600
JPEG_QUALITY = 85
MEDIA_TYPES: tuple[str, ...] = ("image/jpeg", "image/png", "image/webp")
#: The learner's own words beside the photo. A sentence, not an essay.
MAX_WORDS_CHARS = 500
#: Lines of the page that become targets. Mirrors the prompt builder's own cap on targets
#: (``wobo._MAX_TARGETS``), so every line read is a line the model is told about.
MAX_LINES = 24
MAX_LINE_CHARS = 200
MAX_TOPIC_CHARS = 80
#: What a learner says when they only tapped "explain" and typed nothing. It is the tap's meaning,
#: in words the keyless planner reads as a question about what is on the screen.
DEFAULT_WORDS = "Explain this to me. Where do I start?"

SCREEN_CAPABILITY = "doubt.screen"
READ_CAPABILITY = "doubt.read"
ANSWER_CAPABILITY = "doubt.answer"

#: The bucket and the table (migration 0021). Named here and nowhere else.
BUCKET = "doubt-photos"
TABLE = "doubts"
_SCHEMA = "learner"
_HTTP_TIMEOUT_S = 8.0
#: Storage lists and deletes a page at a time.
_BUCKET_PAGE = 1000
_BUCKET_MAX_PAGES = 100
_SUBJECT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,32}$")


class DoubtRefused(Exception):
    """One honest refusal with a line the learner can act on."""

    def __init__(self, code: str, message: str, *, status: int = 400) -> None:
        self.code = code
        self.message = message
        self.status = status
        super().__init__(message)

    def body(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


# --- the image, bounded and cleaned -----------------------------------------------------------


@dataclass(frozen=True)
class Prepared:
    """The photo as it may reach a model and the bucket: JPEG, downscaled, no metadata."""

    data: bytes
    width: int
    height: int
    media_type: str = "image/jpeg"


def decode_image_field(value: Any) -> bytes:
    """The base64 field the client sends (the same shape ``curriculum/OwnSyllabus.tsx`` builds)."""
    if not isinstance(value, str) or not value.strip():
        raise DoubtRefused("needs_photo", "Send me a photo of the page and I will read it.")
    if len(value) > MAX_IMAGE_BYTES * 4 // 3 + 4:
        raise DoubtRefused(
            "image_too_large",
            "That photo is very large. A smaller one reads just as well.",
            status=413,
        )
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise DoubtRefused(
            "bad_photo", "I could not open that photo. Try sending it again."
        ) from exc


def prepare_image(
    raw: bytes,
    *,
    media_type: str,
    crop: tuple[float, float, float, float] | None = None,
) -> Prepared:
    """Bound, decode, orient, crop, downscale, re-encode. Everything the page did not need is gone.

    Re-encoding with an emptied ``info`` is the metadata strip: EXIF (the GPS fix, the device
    model, the timestamp), XMP, the ICC profile and the JPEG comment marker all stop here.
    Orientation is applied BEFORE that, so a page photographed sideways is still the right way up
    afterwards.
    """
    if media_type not in MEDIA_TYPES:
        raise DoubtRefused(
            "unsupported_image", "I can read a JPEG, PNG or WebP photo of the page.", status=415
        )
    if not raw:
        raise DoubtRefused("needs_photo", "That photo did not arrive. Try taking it again.")
    if len(raw) > MAX_IMAGE_BYTES:
        raise DoubtRefused(
            "image_too_large",
            "That photo is very large. A smaller one reads just as well.",
            status=413,
        )
    from PIL import Image, ImageOps

    try:
        image = Image.open(io.BytesIO(raw))
        width, height = image.size
        if (
            max(width, height) > MAX_SIDE_PX
            or min(width, height) < 1
            or width * height > MAX_PIXELS
        ):
            raise DoubtRefused(
                "image_too_large",
                "That photo is very large. A smaller one reads just as well.",
                status=413,
            )
        if image.format == "JPEG" and max(width, height) > LONG_EDGE_PX:
            # Decode at a reduced DCT scale: a 4000x3000 phone photo is decoded at 2000x1500
            # rather than in full and then thrown away. Never below the long edge we keep.
            scale = max(width, height) / LONG_EDGE_PX
            image.draft("RGB", (int(width / scale) + 1, int(height / scale) + 1))
        image.load()
        image = ImageOps.exif_transpose(image) or image
    except DoubtRefused:
        raise
    except Exception as exc:  # noqa: BLE001 - a bad file is one refusal, whatever Pillow called it
        raise DoubtRefused(
            "bad_photo", "I could not open that photo. Try taking it again."
        ) from exc

    if crop is not None:
        x0, y0, x1, y1 = crop
        w, h = image.size
        box = (
            int(x0 * w),
            int(y0 * h),
            max(int(x0 * w) + 1, int(x1 * w)),
            max(int(y0 * h) + 1, int(y1 * h)),
        )
        image = image.crop(box)
    image = image.convert("RGB")
    w, h = image.size
    scale = LONG_EDGE_PX / max(w, h)
    if scale < 1:
        image = image.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    # THE STRIP, made explicit. Pillow copies ``info`` through convert, crop and resize and writes
    # ``comment``, ``xmp`` and ``icc_profile`` back into a JPEG unless told otherwise; only EXIF is
    # dropped by default. Measured 2026-09-05: a COM marker "home: 12 Jubilee Hills Rd" and an XMP
    # creator both survived re-encoding. Nothing the page did not need leaves this function.
    image.info = {}
    out = io.BytesIO()
    image.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True, exif=b"", comment=b"", xmp=b"")
    return Prepared(data=out.getvalue(), width=image.size[0], height=image.size[1])


# --- the two vision calls ------------------------------------------------------------------------


def _chain(capability: str) -> tuple[str, list[str]]:
    """The provider ids for one capability, from the registry and nowhere else."""
    from wobo_gateway.registry import policy
    from wobo_gateway.routing import resolve, resolve_any

    pol = policy(capability)
    return resolve(pol.primary, pol.track).provider_model, [
        resolve_any(name).provider_model for name in pol.fallback
    ]


def _degraded_chain(capability: str) -> tuple[str, list[str]]:
    """One rung down the cost ladder, same capability: the money ceiling's DEGRADE answer, the
    same way ``Gateway.invoke`` degrades a text call."""
    from wobo_gateway.registry import policy
    from wobo_gateway.routing import resolve_any, tier_fallbacks, tier_model

    cheaper = spend.cheaper_tier(policy(capability).tier)
    if cheaper is None:
        return _chain(capability)
    return tier_model(cheaper).provider_model, [
        resolve_any(name).provider_model for name in tier_fallbacks(cheaper)
    ]


def _image_part(image: bytes, media_type: str) -> dict[str, Any]:
    data_url = f"data:{media_type};base64,{base64.b64encode(image).decode('ascii')}"
    return {"type": "image_url", "image_url": {"url": data_url}}


def _json_in(text: str) -> dict[str, Any]:
    from wobo_gateway.wobo import _extract_json

    data = _extract_json(text or "")
    return data if isinstance(data, dict) else {}


def _fraction_box(value: Any) -> tuple[float, float, float, float] | None:
    """A ``[x0, y0, x1, y1]`` in page fractions, or None when it is not one on the page."""
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        x0, y0, x1, y1 = (float(v) for v in value)
    except (TypeError, ValueError):
        return None
    if any(v != v for v in (x0, y0, x1, y1)):
        return None
    if not (0.0 <= x0 < x1 <= 1.0 and 0.0 <= y0 < y1 <= 1.0):
        return None
    return (round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4))


SCREEN_SYSTEM = (
    "You are a safety screen for a children's tutoring app. You are shown one photograph a student "
    "uploaded to ask about their schoolwork. Answer with strict JSON only, no prose: "
    '{"page_of_work": true|false, "face": true|false, "personal_details": true|false, '
    '"work_box": [x0, y0, x1, y1] | null}. '
    "page_of_work is true when the photo is mainly study material or a student's own written work: "
    "a textbook, a notebook, a worksheet, a board, a screen. face is true when any human face is "
    "visible, even partly. personal_details is true when a full name, a home address, a phone "
    "number, a roll number, or a signature is readable anywhere. work_box is the region that is "
    "the work alone, as fractions of width and height (left, top, right, bottom), when the work is "
    "only "
    "part of the frame or when the personal details sit in a header or margin away from it; null "
    "when the whole frame is the work. Never describe a person. Never transcribe the details."
)


@dataclass(frozen=True)
class LiveImageScreen:
    """The tiny-tier vision verdict. Through ``model_call`` like every other call in the service."""

    timeout_s: float = 12.0
    degraded: bool = False

    def screen(self, *, image: bytes, media_type: str) -> ImageVerdict:
        from wobo_gateway.model_call import complete
        from wobo_gateway.providers import max_tokens_for
        from wobo_gateway.telemetry import record_cost

        primary, fallbacks = (
            _degraded_chain(SCREEN_CAPABILITY) if self.degraded else _chain(SCREEN_CAPABILITY)
        )
        response = complete(
            model=primary,
            messages=[
                {"role": "system", "content": SCREEN_SYSTEM},
                {"role": "user", "content": [_image_part(image, media_type)]},
            ],
            fallbacks=fallbacks or None,
            max_tokens=max_tokens_for(SCREEN_CAPABILITY, 200),
            temperature=0.0,
            timeout=self.timeout_s,
        )
        record_cost(
            capability=SCREEN_CAPABILITY, model=primary, response=response, unit_kind=ledger.DOUBT
        )
        data = _json_in(response.choices[0].message.content or "")
        if not data:
            raise ValueError("the screen answered nothing readable")
        return verdict_from(data)


def verdict_from(data: dict[str, Any]) -> ImageVerdict:
    """The screen's JSON into a verdict. A face is a refusal whatever else is true; details are a
    refusal unless the screen found the work apart from them, in which case the crop is kept."""
    if data.get("face") is True:
        return ImageVerdict(allowed=False, reason="face")
    if data.get("page_of_work") is not True:
        return ImageVerdict(allowed=False, reason="not_a_page")
    crop = _fraction_box(data.get("work_box"))
    if data.get("personal_details") is True:
        if crop is None:
            return ImageVerdict(allowed=False, reason="personal")
        # Allowed ONLY because the screen found the work apart from the details: ``details`` says
        # so, and a re-screen that answers this way again is a refusal, not a second crop.
        return ImageVerdict(allowed=True, crop=crop, details=True)
    return ImageVerdict(allowed=True, crop=crop)


READ_SYSTEM = (
    "You read a photograph of a page of schoolwork for a tutor. Answer with strict JSON only, no "
    'prose: {"subject": "<the school subject, one or two words>", "topic": "<the topic, a few '
    'words>", "question": "<the question or task on the page in one sentence, or empty>", '
    '"lines": [{"text": "<one line of the page, exactly as written>", "box": [x0, y0, x1, y1]}]}. '
    "Read every line of printed or handwritten work in reading order, exactly as it appears: do "
    "not "
    "correct, complete, solve or translate anything. A digit or a sign you cannot make out is "
    "written as ?. box is the region the line occupies, as fractions of width and height (left, "
    f"top, right, bottom). At most {MAX_LINES} lines; when the page has more, read the ones that "
    "carry the question and the student's own working. A figure is a line too: a diagram, a "
    "graph, a table or a labelled drawing is one line whose text is [figure: what it shows, in a "
    "few words] and whose box is the figure, so a page that is only a diagram still reads as one "
    "line. Never read a name, an address or a number that identifies a person: write [details] "
    "in its place."
)

#: When the reader found no line and no figure. Honest about both halves: it may be the photo, and
#: it may be that the learner has to say what the page shows.
NOTHING_READ_SAY = (
    "I could not make out any writing or figure on that page. Try a straighter, brighter photo, "
    "or type what the page shows and I will start from there."
)


@dataclass(frozen=True)
class Line:
    """One line of the page as it was read. ``box`` is None when the reader gave it no place on
    the page, and such a line is text the learner can correct but never a target ink may anchor
    to: an anchor needs a rect."""

    id: str
    text: str
    box: tuple[float, float, float, float] | None

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.id, "text": self.text, "box": list(self.box) if self.box else None}


@dataclass(frozen=True)
class Reading:
    subject: str
    topic: str
    question: str
    lines: tuple[Line, ...]
    #: Lines the reader placed off the page or nowhere. Counted, never silently dropped.
    unplaced: int = 0

    @property
    def targets(self) -> tuple[Line, ...]:
        return tuple(line for line in self.lines if line.box is not None)

    def say(self) -> str:
        """Law 1, in Wobo's voice: what was read, and the question that hands it back."""
        if not self.lines:
            return NOTHING_READ_SAY
        shown = "; ".join(line.text for line in self.lines[:6])
        more = f" and {len(self.lines) - 6} more lines" if len(self.lines) > 6 else ""
        return f"I read this as: {shown}{more}. Is that right? Fix anything I got wrong first."


def _clean_line(text: Any) -> str:
    return " ".join(str(text or "").split())[:MAX_LINE_CHARS]


def reading_from(data: dict[str, Any]) -> Reading:
    """The reader's JSON into a reading: bounded, boxed, and honest about what had no place."""
    lines: list[Line] = []
    unplaced = 0
    raw_lines = data.get("lines")
    for item in (raw_lines if isinstance(raw_lines, list) else [])[: MAX_LINES * 2]:
        if not isinstance(item, dict):
            continue
        text = _clean_line(item.get("text"))
        if not text:
            continue
        box = _fraction_box(item.get("box"))
        if box is None:
            unplaced += 1
        lines.append(Line(id=f"r{len(lines) + 1}", text=text, box=box))
        if len(lines) >= MAX_LINES:
            break
    return Reading(
        subject=_clean_line(data.get("subject"))[:MAX_TOPIC_CHARS],
        topic=_clean_line(data.get("topic"))[:MAX_TOPIC_CHARS],
        question=_clean_line(data.get("question")),
        lines=tuple(lines),
        unplaced=unplaced,
    )


class Reader(Protocol):
    def read(self, *, image: bytes, media_type: str, words: str) -> Reading: ...


@dataclass(frozen=True)
class LiveReader:
    """The generate-tier vision read, on the same rung the own-syllabus photo already goes to."""

    timeout_s: float = 45.0
    degraded: bool = False

    def read(self, *, image: bytes, media_type: str, words: str) -> Reading:
        from wobo_gateway.model_call import complete
        from wobo_gateway.providers import max_tokens_for
        from wobo_gateway.telemetry import record_cost

        primary, fallbacks = (
            _degraded_chain(READ_CAPABILITY) if self.degraded else _chain(READ_CAPABILITY)
        )
        note = (
            f"The student wrote beside the photo: {words}"
            if words
            else "The student added no words."
        )
        response = complete(
            model=primary,
            messages=[
                {"role": "system", "content": READ_SYSTEM},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"<student_note>{note}</student_note>"},
                        _image_part(image, media_type),
                    ],
                },
            ],
            fallbacks=fallbacks or None,
            max_tokens=max_tokens_for(READ_CAPABILITY, 1500),
            temperature=0.0,
            timeout=self.timeout_s,
        )
        record_cost(
            capability=READ_CAPABILITY, model=primary, response=response, unit_kind=ledger.DOUBT
        )
        return reading_from(_json_in(response.choices[0].message.content or ""))


class MockEyes:
    """Keyless eyes for ``LLM_MODE=mock``: a page is a page, and the reading says so honestly.

    Nothing here looks at a pixel. The reading is one line that says what it is, so a local run
    walks the whole two-step path — the reading shown, corrected, and taught over — without a key
    and without pretending it read the page.
    """

    def screen(self, *, image: bytes, media_type: str) -> ImageVerdict:
        return ImageVerdict(allowed=True)

    def read(self, *, image: bytes, media_type: str, words: str) -> Reading:
        return Reading(
            subject="",
            topic="",
            question="",
            lines=(
                Line(
                    "r1",
                    "(the page, as far as I could read it without my eyes)",
                    (0.1, 0.1, 0.9, 0.9),
                ),
            ),
        )


@dataclass(frozen=True)
class Eyes:
    """The screen and the reader together, so a route asks for one thing."""

    screen: ImageScreen
    reader: Reader


def eyes_for(*, live: bool, degraded: bool = False) -> Eyes:
    if not live:
        mock = MockEyes()
        return Eyes(screen=mock, reader=mock)
    return Eyes(screen=LiveImageScreen(degraded=degraded), reader=LiveReader(degraded=degraded))


_EYES_OVERRIDE: Eyes | None = None


def set_eyes(eyes: Eyes | None) -> None:
    """Test seam: the eyes every route uses, whatever the mode."""
    global _EYES_OVERRIDE
    _EYES_OVERRIDE = eyes


def get_eyes(*, degraded: bool = False) -> Eyes:
    if _EYES_OVERRIDE is not None:
        return _EYES_OVERRIDE
    return eyes_for(live=os.getenv("LLM_MODE", "mock").lower() == "live", degraded=degraded)


# --- the record ----------------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class Doubt:
    """One photographed doubt, as the record holds it."""

    id: str
    subject_id: str
    created_at: str
    words: str
    school_subject: str
    topic: str
    question: str
    lines: tuple[Line, ...]
    width: int
    height: int
    node_id: str | None = None
    node_name: str | None = None
    framework_id: str | None = None
    status: str = "read"
    answered_at: str | None = None

    @property
    def photo_path(self) -> str:
        return f"{self.subject_id}/{self.id}.jpg"

    @property
    def targets(self) -> tuple[Line, ...]:
        return tuple(line for line in self.lines if line.box is not None)

    def as_dict(self) -> dict[str, Any]:
        """The client shape. No subject id, no bucket path: the door already knows who asked."""
        return {
            "doubt": self.id,
            "created_at": self.created_at,
            "status": self.status,
            "words": self.words,
            "reading": {
                "subject": self.school_subject,
                "topic": self.topic,
                "question": self.question,
                "lines": [line.as_dict() for line in self.lines],
                "width": self.width,
                "height": self.height,
            },
            "climb": {
                "node_id": self.node_id,
                "node_name": self.node_name,
                "framework_id": self.framework_id,
            },
            **({"answered_at": self.answered_at} if self.answered_at else {}),
        }

    def to_row(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "subject_id": self.subject_id,
            "created_at": self.created_at,
            "status": self.status,
            "words": self.words,
            "school_subject": self.school_subject,
            "topic": self.topic,
            "question": self.question,
            "lines": [line.as_dict() for line in self.lines],
            "width": self.width,
            "height": self.height,
            "node_id": self.node_id,
            "node_name": self.node_name,
            "framework_id": self.framework_id,
            "answered_at": self.answered_at,
        }

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Doubt:
        lines: list[Line] = []
        for item in row.get("lines") or []:
            if isinstance(item, dict) and str(item.get("id") or "").strip():
                lines.append(
                    Line(
                        id=str(item["id"])[:8],
                        text=_clean_line(item.get("text")),
                        box=_fraction_box(item.get("box")),
                    )
                )
        return cls(
            id=str(row["id"]),
            subject_id=str(row["subject_id"]),
            created_at=str(row.get("created_at") or ""),
            words=str(row.get("words") or "")[:MAX_WORDS_CHARS],
            school_subject=str(row.get("school_subject") or ""),
            topic=str(row.get("topic") or ""),
            question=str(row.get("question") or ""),
            lines=tuple(lines),
            width=int(row.get("width") or 0),
            height=int(row.get("height") or 0),
            node_id=row.get("node_id") or None,
            node_name=row.get("node_name") or None,
            framework_id=row.get("framework_id") or None,
            status=str(row.get("status") or "read"),
            answered_at=row.get("answered_at") or None,
        )


class StoreUnavailable(RuntimeError):
    """The record could not be reached. Nothing was kept, and the learner is told so."""


class StoreMissing(StoreUnavailable):
    """The table or the bucket is not there: migration 0021 has not been applied to this project.

    On the READ and ERASE paths this is not a refusal, it is an empty answer. A table that does
    not exist holds no rows, so ``forget_all`` reporting zero is the truth and not a claim; and
    the alternative was the outage docs/OPERATIONS.md records for 0020, where one missing table on
    the erase path answered 502 to every learner who asked to be forgotten. On the WRITE path it
    stays a refusal: a photo that cannot be kept is not kept, and the learner is told.
    """


class DoubtStore(Protocol):
    def put(self, doubt: Doubt, photo: bytes) -> Doubt: ...

    def get(self, subject: str, doubt_id: str) -> Doubt | None: ...

    def photo(self, subject: str, doubt_id: str) -> bytes | None: ...

    def list(self, subject: str) -> list[Doubt]: ...

    def update(self, doubt: Doubt) -> Doubt: ...

    def forget(self, subject: str, doubt_id: str) -> tuple[int, int]: ...

    def forget_all(self, subject: str) -> tuple[int, int]: ...


class InMemoryDoubtStore:
    """The record held in this process — a local run and the suite. Same rules, no project."""

    def __init__(self) -> None:
        self._rows: dict[tuple[str, str], Doubt] = {}
        self._photos: dict[str, bytes] = {}
        self._lock = threading.Lock()

    def put(self, doubt: Doubt, photo: bytes) -> Doubt:
        with self._lock:
            self._rows[(doubt.subject_id, doubt.id)] = doubt
            self._photos[doubt.photo_path] = photo
        return doubt

    def get(self, subject: str, doubt_id: str) -> Doubt | None:
        with self._lock:
            return self._rows.get((subject, doubt_id))

    def photo(self, subject: str, doubt_id: str) -> bytes | None:
        with self._lock:
            return self._photos.get(f"{subject}/{doubt_id}.jpg")

    def list(self, subject: str) -> list[Doubt]:
        with self._lock:
            mine = [d for (s, _), d in self._rows.items() if s == subject]
        return sorted(mine, key=lambda d: d.created_at, reverse=True)

    def update(self, doubt: Doubt) -> Doubt:
        with self._lock:
            if (doubt.subject_id, doubt.id) not in self._rows:
                raise StoreUnavailable("no such doubt")
            self._rows[(doubt.subject_id, doubt.id)] = doubt
        return doubt

    def forget(self, subject: str, doubt_id: str) -> tuple[int, int]:
        with self._lock:
            rows = 1 if self._rows.pop((subject, doubt_id), None) is not None else 0
            photos = 1 if self._photos.pop(f"{subject}/{doubt_id}.jpg", None) is not None else 0
        return rows, photos

    def forget_all(self, subject: str) -> tuple[int, int]:
        with self._lock:
            keys = [k for k in self._rows if k[0] == subject]
            for key in keys:
                del self._rows[key]
            paths = [p for p in self._photos if p.startswith(f"{subject}/")]
            for path in paths:
                del self._photos[path]
        return len(keys), len(paths)


def _request(
    url: str,
    key: str,
    method: str,
    *,
    body: bytes | None = None,
    content_type: str | None = None,
    want_rows: bool,
    profile: bool = True,
) -> Any:
    """One PostgREST or Storage call. Split out so tests can substitute it without a project."""
    headers: dict[str, str] = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    if profile:
        headers["Accept-Profile"] = _SCHEMA
        headers["Content-Profile"] = _SCHEMA
        headers["Prefer"] = "return=representation" if want_rows else "return=minimal"
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read()
    if not want_rows:
        return []
    if content_type is None and raw and not raw.lstrip().startswith((b"[", b"{")):
        return raw
    if not raw.strip():
        return []
    return json.loads(raw.decode())


class PostgrestDoubtStore:
    """The project's table and bucket, over the service-role key. Server-side only."""

    def __init__(self, base_url: str, service_key: str, *, request: Any = None) -> None:
        self._base = base_url.rstrip("/")
        self._key = service_key
        self._request = request or _request

    def _table(self, params: dict[str, str]) -> str:
        return f"{self._base}/rest/v1/{TABLE}?" + urllib.parse.urlencode(
            params, quote_via=urllib.parse.quote
        )

    def _object(self, path: str) -> str:
        return f"{self._base}/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}"

    def _call(self, *args: Any, **kwargs: Any) -> Any:
        try:
            return self._request(*args, **kwargs)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise StoreMissing(str(exc)) from exc
            raise StoreUnavailable(str(exc)) from exc
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            raise StoreUnavailable(str(exc)) from exc

    @staticmethod
    def _not_applied(what: str) -> None:
        logger.warning(
            "doubt: the record is not there (migration 0021 not applied?)",
            extra={"fields": {"missing": what}},
        )

    def put(self, doubt: Doubt, photo: bytes) -> Doubt:
        # The photo first: a row that points at an object that is not there would be a doubt the
        # memory page cannot show. If the row then fails, the object is taken back.
        self._call(
            self._object(doubt.photo_path),
            self._key,
            "POST",
            body=photo,
            content_type="image/jpeg",
            want_rows=False,
            profile=False,
        )
        try:
            self._call(
                self._table({}),
                self._key,
                "POST",
                body=json.dumps(doubt.to_row()).encode(),
                content_type="application/json",
                want_rows=False,
            )
        except StoreUnavailable:
            self._delete_objects([doubt.photo_path])
            raise
        return doubt

    def get(self, subject: str, doubt_id: str) -> Doubt | None:
        try:
            rows = self._call(
                self._table({"subject_id": f"eq.{subject}", "id": f"eq.{doubt_id}", "limit": "1"}),
                self._key,
                "GET",
                want_rows=True,
            )
        except StoreMissing:
            self._not_applied(TABLE)
            return None
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            return Doubt.from_row(rows[0])
        return None

    def photo(self, subject: str, doubt_id: str) -> bytes | None:
        try:
            raw = self._call(
                self._object(f"{subject}/{doubt_id}.jpg"),
                self._key,
                "GET",
                want_rows=True,
                profile=False,
            )
        except StoreUnavailable:
            return None
        return raw if isinstance(raw, bytes) and raw else None

    def list(self, subject: str) -> list[Doubt]:
        try:
            rows = self._call(
                self._table(
                    {"subject_id": f"eq.{subject}", "order": "created_at.desc", "limit": "50"}
                ),
                self._key,
                "GET",
                want_rows=True,
            )
        except StoreMissing:
            self._not_applied(TABLE)
            return []
        return (
            [Doubt.from_row(r) for r in rows if isinstance(r, dict)]
            if isinstance(rows, list)
            else []
        )

    def update(self, doubt: Doubt) -> Doubt:
        self._call(
            self._table({"subject_id": f"eq.{doubt.subject_id}", "id": f"eq.{doubt.id}"}),
            self._key,
            "PATCH",
            body=json.dumps(doubt.to_row()).encode(),
            content_type="application/json",
            want_rows=False,
        )
        return doubt

    def _delete_objects(self, paths: list[str]) -> int:
        """How many objects the bucket CONFIRMED gone. Storage answers a DELETE with the objects it
        removed; until 2026-09-05 that reply was discarded and the count was the number asked."""
        if not paths:
            return 0
        gone = 0
        for start in range(0, len(paths), _BUCKET_PAGE):
            try:
                reply = self._call(
                    f"{self._base}/storage/v1/object/{BUCKET}",
                    self._key,
                    "DELETE",
                    body=json.dumps({"prefixes": paths[start : start + _BUCKET_PAGE]}).encode(),
                    content_type="application/json",
                    want_rows=True,
                    profile=False,
                )
            except StoreMissing:
                self._not_applied(BUCKET)
                return gone
            gone += len(reply) if isinstance(reply, list) else 0
        return gone

    def _list_objects(self, subject: str) -> list[str]:
        """Every object under the learner's prefix, page by page: Storage lists at most a page,
        and nothing caps how many photos a learner keeps."""
        paths: list[str] = []
        offset = 0
        for _ in range(_BUCKET_MAX_PAGES):
            try:
                listed = self._call(
                    f"{self._base}/storage/v1/object/list/{BUCKET}",
                    self._key,
                    "POST",
                    body=json.dumps(
                        {"prefix": f"{subject}/", "limit": _BUCKET_PAGE, "offset": offset}
                    ).encode(),
                    content_type="application/json",
                    want_rows=True,
                    profile=False,
                )
            except StoreMissing:
                self._not_applied(BUCKET)
                return paths
            page = [
                f"{subject}/{item['name']}"
                for item in (listed if isinstance(listed, list) else [])
                if isinstance(item, dict) and item.get("name")
            ]
            paths.extend(page)
            if len(page) < _BUCKET_PAGE:
                break
            offset += _BUCKET_PAGE
        return paths

    def forget(self, subject: str, doubt_id: str) -> tuple[int, int]:
        try:
            rows = self._call(
                self._table({"subject_id": f"eq.{subject}", "id": f"eq.{doubt_id}"}),
                self._key,
                "DELETE",
                want_rows=True,
            )
        except StoreMissing:
            self._not_applied(TABLE)
            return 0, 0
        count = len(rows) if isinstance(rows, list) else 0
        return count, self._delete_objects([f"{subject}/{doubt_id}.jpg"]) if count else 0

    def forget_all(self, subject: str) -> tuple[int, int]:
        """The rows, then every object under the learner's prefix — read from the bucket, not
        from the rows, so an object whose row was already gone still leaves."""
        try:
            rows = self._call(
                self._table({"subject_id": f"eq.{subject}"}), self._key, "DELETE", want_rows=True
            )
        except StoreMissing:
            self._not_applied(TABLE)
            rows = []
        count = len(rows) if isinstance(rows, list) else 0
        return count, self._delete_objects(self._list_objects(subject))


_store: DoubtStore | None = None
_store_lock = threading.Lock()


def build_store() -> DoubtStore:
    """``DOUBT_STORE=memory`` forces the in-process store; else the project, when there is one."""
    if (os.getenv("DOUBT_STORE") or "").strip().lower() == "memory":
        return InMemoryDoubtStore()
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if base and key:
        return PostgrestDoubtStore(base, key)
    return InMemoryDoubtStore()


def get_store() -> DoubtStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: DoubtStore | None) -> None:
    global _store
    with _store_lock:
        _store = store


# --- law 4: where a doubt sits in the climb -------------------------------------------------------


def topic_node_uuid(topic_id: str) -> str:
    """``topicNodeUuid`` from ``apps/web-pwa/src/screens/learn/mastery.ts``, character for
    character: the id the app files a topic's evidence and slips under. Over UTF-16 code units,
    as ``charCodeAt`` is."""
    units = [
        int.from_bytes(topic_id.encode("utf-16-le")[i : i + 2], "little")
        for i in range(0, len(topic_id.encode("utf-16-le")), 2)
    ]
    h = 0x811C9DC5
    for unit in units:
        h ^= unit
        h = (h * 0x01000193) & 0xFFFFFFFF
    h2 = 0x1000193 ^ len(units)
    for unit in reversed(units):
        h2 = ((h2 ^ unit) * 0x85EBCA6B) & 0xFFFFFFFF
    tail = f"{h2:08x}"[:4]
    return f"00000000-0000-7000-8000-{h:08x}{tail}"


#: Where one word ends and the next begins, in any script: whitespace, ASCII punctuation, and the
#: general and CJK punctuation blocks. NOT ``\W``: a Devanagari vowel sign is a mark, not a letter,
#: and splitting on it would cut "समीकरण" into pieces. Until 2026-09-05 the matcher read ``[a-z]``
#: and the slug dropped every non-ASCII letter, so a Hindi maths doubt and a Hindi science doubt
#: were filed under ONE node.
_TOKEN_SPLIT = re.compile(
    r"[\s\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007f\u2000-\u206f\u3000-\u303f]+"
)


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN_SPLIT.split((text or "").casefold()) if t]


def _slug(text: str) -> str:
    return "-".join(_tokens(text))[:MAX_TOPIC_CHARS].strip("-") or "page"


_MATCH_STOP = frozenset(
    (
        "the",
        "a",
        "an",
        "of",
        "and",
        "or",
        "in",
        "on",
        "to",
        "for",
        "with",
        "class",
        "grade",
        "chapter",
        "unit",
        "topic",
        "maths",
        "math",
        "science",
    )
)


def _match_words(text: str) -> set[str]:
    """The words a topic can be matched on: any script, at least a letter in each, and long
    enough to mean something (three characters in Latin, two elsewhere)."""
    return {
        t
        for t in _tokens(text)
        if t not in _MATCH_STOP
        and any(c.isalpha() for c in t)
        and len(t) >= (3 if t.isascii() else 2)
    }


@dataclass(frozen=True)
class Placement:
    node_id: str
    node_name: str
    framework_id: str | None
    matched: bool


def place(subject: str, reading: Reading, framework_id: str | None) -> Placement:
    """The node of the learner's syllabus this doubt belongs to, or a doubt node of its own.

    Never raises: a registry that cannot be read files the doubt under its own node, and the
    answer goes ahead. The climb is joined either way; only the ADDRESS is less specific.
    """
    asked = _match_words(f"{reading.topic} {reading.question}")
    if framework_id and asked:
        try:
            from wobo_gateway.curriculum import store as curriculum_store
            from wobo_gateway.curriculum.models import NodeKind

            registry = curriculum_store.get_store()
            version_id = registry.get_pin(subject, framework_id)
            if version_id is None:
                latest = registry.latest_version(framework_id)
                version_id = latest.id if latest is not None else None
            best: tuple[int, Any] | None = None
            for node in registry.all_nodes(version_id) if version_id else []:
                if node.kind not in (NodeKind.TOPIC, NodeKind.UNIT):
                    continue
                named = _match_words(" ".join((node.name, *node.aliases)))
                shared = len(asked & named)
                if shared and (best is None or shared > best[0]):
                    best = (shared, node)
            if best is not None:
                node = best[1]
                return Placement(topic_node_uuid(node.id), node.name, framework_id, True)
        except Exception as exc:  # noqa: BLE001 - the registry is never allowed to cost a doubt
            logger.warning(
                "doubt: not placed in the syllabus", extra={"fields": {"error": str(exc)}}
            )
    name = reading.topic or reading.subject or "a page of work"
    own = f"doubt:{_slug(reading.subject)}:{_slug(reading.topic or reading.question)}"
    return Placement(topic_node_uuid(own), name, framework_id or None, False)


def join_the_climb(doubt: Doubt, *, now: datetime | None = None) -> bool:
    """A slip under the doubt's node, and one more question asked today, in Wobo's mind.

    The mind is what the re-teach ladder and the practice mix read (``pools.ts`` weighs the mix
    toward ``mind.slips``), so this is the line that makes a photographed doubt count: it is
    filed where a wrong answer on the same topic would be, with the doubt as its item, so it comes
    back if it slipped. Never raises; a mind that cannot be written is logged and reported False.
    """
    from wobo_gateway import mind

    moment = (now or datetime.now(UTC)).astimezone(UTC)
    stamp = moment.isoformat(timespec="seconds").replace("+00:00", "Z")
    write = mind.Write(
        mind=mind.Mind(
            slips=({"nodeId": doubt.node_id or "", "itemId": f"doubt:{doubt.id}", "at": stamp},)
        ),
        bump_days={moment.date().isoformat(): {"asked": 1}},
        write_id=f"doubt:{doubt.id}",
    )
    try:
        result = mind.get_store().put(doubt.subject_id, write)
    except Exception as exc:  # noqa: BLE001
        logger.warning("doubt: the climb was not joined", extra={"fields": {"error": str(exc)}})
        return False
    return bool(result.applied)


# --- the answer: the existing board turn, over the photo -----------------------------------------


def turn_payload(doubt: Doubt, words: str) -> dict[str, Any]:
    """The context packet for the board turn: the photo as the surface, its lines as the only
    targets, the reading as the learner's working, the learner's words as the question.

    ``canvas.steps`` is where a learner's working already goes, so the reading takes the same
    seat: the CAS grounding reads it, and ``spoken.given_numbers`` treats its numbers as the
    learner's own to repeat — which is what a corrected reading is. ONLY the corrected lines are
    in here. The reader's own ``question`` is never shown to the learner and cannot be corrected,
    so it went into ``canvas.equation`` until 2026-09-05 and licensed the UNCORRECTED numbers: a
    learner who fixed 8x to 3x still heard "start with 8x". The equation seat is now the first
    corrected line, and the learner's words are theirs or the tap's meaning, never the reader's.
    """
    targets = [{"id": line.id, "kind": "line", "label": line.text} for line in doubt.targets]
    surface = {
        "id": f"doubt:{doubt.id}",
        "title": "the photo of the page",
        "description": "a photograph of the learner's own page of work",
        "targets": targets,
    }
    return {
        "context": {
            "turn": {"lastUserInput": (words or DEFAULT_WORDS)[:MAX_WORDS_CHARS]},
            "page": {
                "route": "doubt",
                "state": {"surface": "photo", "doubt": doubt.id, "lines": len(doubt.lines)},
            },
            "curriculum": {"nodeName": doubt.node_name or doubt.topic or doubt.school_subject},
            "canvas": {
                "equation": doubt.lines[0].text if doubt.lines else "",
                "steps": [f"{line.id}: {line.text}" for line in doubt.lines],
            },
            "targets": targets,
            "packet": {"screen": {"surfaces": [surface]}},
        },
        "board": {"presentation": "screen"},
    }


#: How many marks were refused for landing off the page, in this process. The harness reads it.
OFF_PAGE = {"count": 0}


@dataclass
class DoubtShaper:
    """Laws 3 and 5 on a board turn over a photo. ``app.stream_board_turn`` calls both halves."""

    region_ids: frozenset[str]
    off_page: int = 0
    shaped: bool = False
    kept: list[str] = field(default_factory=list)

    def _anchor_on_the_page(self, anchor: Any, known: set[str]) -> dict[str, Any] | None:
        """The anchor as it may be drawn, or None when it is a pixel guess."""
        if not isinstance(anchor, dict):
            return None
        if "target" in anchor:
            if anchor["target"] not in self.region_ids:
                return None
        elif "object" in anchor:
            if anchor["object"] not in known:
                return None
        else:
            return None  # board space, a focus that does not exist here, or nothing at all
        # An offset is a pixel guess on top of a real anchor. The word ``at`` (a side of the
        # line) and a fraction pair inside the line's own rect both stay on the page.
        return {k: v for k, v in anchor.items() if k != "offset"}

    def shape_model_plan(self, plan: dict[str, Any]) -> dict[str, Any]:
        """Law 3: a model-authored mark is drawn on a line of the page or not at all."""
        raw = plan.get("objects")
        objects = [o for o in raw if isinstance(o, dict)] if isinstance(raw, list) else []
        known = {str(o.get("id")) for o in objects if o.get("id")}
        kept: list[dict[str, Any]] = []
        for obj in objects:
            shaped = dict(obj)
            on_page = True
            for name in ("anchor", "to", "from"):
                if name not in obj:
                    continue
                anchor = self._anchor_on_the_page(obj.get(name), known)
                if anchor is None:
                    on_page = False
                    break
                shaped[name] = anchor
            if "anchor" not in obj and obj.get("kind") != "wipe":
                on_page = False
            if not on_page:
                self.off_page += 1
                continue
            kept.append(shaped)
        plan["objects"] = kept
        self.kept = [str(o.get("id")) for o in kept]
        return plan

    def shape_plan(self, plan: Any) -> Any:
        """Law 5: every ink object is on a beat, and the first stroke is on the first sentence."""
        from wobo_gateway.board import stream as board_stream

        self.shaped = True
        parts = board_stream.sentences(plan.say)
        count = len(parts)
        objects = [o for o in plan.objects if isinstance(o, dict)]
        if objects and not count:
            # A drawing with no sentence to land on is the owner's "just draw on the image". It is
            # not drawn: a learner with nothing said to them is owed words, not a silent ring.
            plan.refusals.append(
                f"no words: {len(objects)} mark(s) had no sentence to be drawn with and were not "
                "drawn"
            )
            logger.warning(
                "doubt: marks refused for a wordless plan",
                extra={"fields": {"marks": len(objects)}},
            )
            plan.objects = []
            objects = []
        if objects and count:
            first_beat = False
            for index, obj in enumerate(objects):
                meta = obj.get("meta") if isinstance(obj.get("meta"), dict) else {}
                beat = meta.get("beat") if isinstance(meta.get("beat"), dict) else None
                chosen = None
                if beat is not None:
                    for key in ("with", "after"):
                        if isinstance(beat.get(key), int) and not isinstance(beat.get(key), bool):
                            chosen = max(0, min(count - 1, beat[key]))
                            beat = {key: chosen}
                            break
                if chosen is None:
                    chosen = min(count - 1, (index * count) // len(objects))
                    beat = {"with": chosen}
                first_beat = first_beat or chosen == 0
                obj["meta"] = {**meta, "beat": beat}
            if not first_beat:
                first = objects[0]
                first["meta"] = {**first.get("meta", {}), "beat": {"with": 0}}
        if self.off_page:
            OFF_PAGE["count"] += self.off_page
            plan.refusals.append(
                f"off the page: {self.off_page} mark(s) placed by pixels rather than on a line of "
                "the page were not drawn"
            )
            logger.warning(
                "doubt: marks refused for landing off the page",
                extra={"fields": {"off_page": self.off_page}},
            )
        return plan


# --- the routes ----------------------------------------------------------------------------------


class ImageField(BaseModel):
    data: str = Field(min_length=1)
    mediaType: str = Field(default="image/jpeg", max_length=40)


class DoubtRequest(BaseModel):
    image: ImageField
    words: str = Field(default="", max_length=MAX_WORDS_CHARS)
    framework_id: str | None = Field(default=None, max_length=128)


class LineCorrection(BaseModel):
    id: str = Field(min_length=1, max_length=8)
    #: Twice the ceiling at the door, clipped to the ceiling by ``_clean_line`` (the client caps at
    #: the ceiling too). Past this it is one refusal in Wobo's voice, never FastAPI's own detail.
    text: str = Field(max_length=MAX_LINE_CHARS * 2)


class AnswerRequest(BaseModel):
    lines: list[LineCorrection] = Field(default_factory=list, max_length=MAX_LINES)
    words: str | None = Field(default=None, max_length=MAX_WORDS_CHARS)


def _refusal(exc: DoubtRefused, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content=exc.body(), headers=headers or {})


def _sign_in_required() -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={
            "code": "sign_in_required",
            "message": "Sign in first and I will read your page.",
        },
    )


def _not_found() -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"code": "doubt_not_found", "message": "I do not have that page any more."},
    )


def _learner(request: Request) -> Principal | None:
    principal: Principal | None = getattr(request.state, "principal", None)
    if principal is None or principal.anonymous or not _SUBJECT_RE.match(principal.subject or ""):
        return None
    return principal


def _words(text: str | None) -> str:
    return " ".join((text or "").split())[:MAX_WORDS_CHARS]


def read_doubt(
    *,
    subject: str,
    raw: bytes,
    media_type: str,
    words: str,
    framework_id: str | None,
    eyes: Eyes,
    store: DoubtStore,
) -> Doubt:
    """The reading step, end to end: bound, screen, crop, read, place, keep. Raises DoubtRefused."""
    prepared = prepare_image(raw, media_type=media_type)
    verdict = screen_image(prepared.data, media_type=prepared.media_type, screen=eyes.screen)
    if verdict.allowed and verdict.crop is not None:
        # The screen found the work apart from something the page does not need. Keep the work,
        # and ask once more about what is left: a crop is the screen's suggestion, not its verdict.
        prepared = prepare_image(raw, media_type=media_type, crop=verdict.crop)
        verdict = screen_image(prepared.data, media_type=prepared.media_type, screen=eyes.screen)
        if verdict.allowed and verdict.details:
            # The crop still carries someone's details. Until 2026-09-05 this second "details,
            # but here is a crop" was read as a pass and the photo was kept and read.
            verdict = ImageVerdict(allowed=False, reason="personal")
        elif verdict.allowed and verdict.crop is not None:
            verdict = replace(verdict, crop=None)
    if not verdict.allowed:
        status = 503 if verdict.reason == "outage" else 422
        raise DoubtRefused(f"photo_{verdict.reason or 'refused'}", verdict.say, status=status)

    try:
        reading = eyes.reader.read(image=prepared.data, media_type=prepared.media_type, words=words)
    except Exception as exc:  # noqa: BLE001 - one honest refusal, nothing kept
        raise DoubtRefused(
            "reader_failed",
            "I could not read that page just now. Try again in a moment.",
            status=503,
        ) from exc
    if not reading.lines:
        raise DoubtRefused("nothing_read", NOTHING_READ_SAY, status=422)
    placement = place(subject, reading, framework_id)
    doubt = Doubt(
        id=secrets.token_urlsafe(12),
        subject_id=subject,
        created_at=_now(),
        words=words,
        school_subject=reading.subject,
        topic=reading.topic,
        question=reading.question,
        lines=reading.lines,
        width=prepared.width,
        height=prepared.height,
        node_id=placement.node_id,
        node_name=placement.node_name,
        framework_id=placement.framework_id,
    )
    try:
        return store.put(doubt, prepared.data)
    except StoreUnavailable as exc:
        raise DoubtRefused(
            "not_kept",
            "I read it, but I could not keep it just now. Try again in a moment.",
            status=503,
        ) from exc


def corrected(doubt: Doubt, lines: list[LineCorrection]) -> Doubt:
    """The learner's corrections, by line id. A line they emptied is a line that was not there."""
    if not lines:
        return doubt
    fixes = {c.id: _clean_line(c.text) for c in lines}
    kept = tuple(
        replace(line, text=fixes.get(line.id, line.text))
        for line in doubt.lines
        if fixes.get(line.id, line.text)
    )
    return replace(doubt, lines=kept)


def refusal_for_validation(request: Request, exc: Exception) -> JSONResponse | None:
    """A body the doubt routes cannot read, as ``{code, message}`` in Wobo's voice. None on any
    other route, whose shape is its own business. The SDK's ``refusal()`` unwraps ``{code,
    message}`` and nothing else, so FastAPI's ``detail: [...]`` reached the learner as 'trouble'."""
    if not request.url.path.startswith("/v1/doubt"):
        return None
    return JSONResponse(
        status_code=422,
        content={
            "code": "bad_request",
            "message": "I could not read that. A line can be 200 characters; try a shorter one.",
        },
    )


def register_doubt(app: FastAPI, gateway: Any) -> None:
    """``POST /v1/doubt``, ``POST /v1/doubt/{id}/answer``, ``GET /v1/doubt``,
    ``GET /v1/doubt/{id}/photo``, ``DELETE /v1/doubt/{id}``. Signed-in learners only."""
    from fastapi.exception_handlers import request_validation_exception_handler
    from fastapi.exceptions import RequestValidationError

    @app.exception_handler(RequestValidationError)
    async def _unreadable_body(request: Request, exc: RequestValidationError) -> Response:
        return refusal_for_validation(request, exc) or await request_validation_exception_handler(
            request, exc
        )

    @app.post("/v1/doubt")
    def read(body: DoubtRequest, request: Request) -> Response:
        principal = _learner(request)
        if principal is None:
            return _sign_in_required()
        profile = consent.get_profile(principal.subject, anonymous=False)
        plan = billing.metered_plan(principal, profile)
        priority = spend.priority_for(anonymous=False, signed_in=True, plan=plan)
        meter = request.state.meter_key
        ledger.mark(plan=plan, anonymous=False, meter_key=meter)
        try:
            raw = decode_image_field(body.image.data)
        except DoubtRefused as exc:
            return _refusal(exc)
        # The money ceiling BEFORE the meter and before the first vision call: a learner refused
        # because the platform is out of money must not lose one of their own generations for it.
        verdict = spend.verdict(priority)
        if verdict is spend.Verdict.REFUSE:
            raise spend.SpendCeilingReached(priority, capability=READ_CAPABILITY)
        snap = budget.charge(meter, READ_CAPABILITY, plan, anonymous=False)
        headers = budget.headers(snap, budget.classify(READ_CAPABILITY))
        try:
            doubt = read_doubt(
                subject=principal.subject,
                raw=raw,
                media_type=body.image.mediaType.strip().lower(),
                words=_words(body.words),
                framework_id=(body.framework_id or "").strip() or None,
                eyes=get_eyes(degraded=verdict is spend.Verdict.DEGRADE),
                store=get_store(),
            )
        except DoubtRefused as exc:
            budget.refund(meter, READ_CAPABILITY)
            return _refusal(exc, headers)
        except Exception:
            budget.refund(meter, READ_CAPABILITY)
            raise
        reading = Reading(doubt.school_subject, doubt.topic, doubt.question, doubt.lines)
        return JSONResponse(
            status_code=200,
            content={**doubt.as_dict(), "say": reading.say(), "step": "reading"},
            headers=headers,
        )

    @app.post("/v1/doubt/{doubt_id}/answer")
    def answer(doubt_id: str, body: AnswerRequest, request: Request) -> Response:
        from wobo_gateway import mind
        from wobo_gateway.app import CapabilityRequest, stream_board_turn, wants_event_stream

        principal = _learner(request)
        if principal is None:
            return _sign_in_required()
        if not _ID_RE.match(doubt_id):
            return _not_found()
        if not wants_event_stream(request):
            return JSONResponse(
                status_code=406,
                content={
                    "code": "stream_required",
                    "message": (
                        "The answer is drawn and spoken as it goes: ask for text/event-stream."
                    ),
                },
            )
        store = get_store()
        try:
            doubt = store.get(principal.subject, doubt_id)
        except StoreUnavailable:
            doubt = None
        if doubt is None:
            return _not_found()
        doubt = corrected(doubt, body.lines)
        if body.words is not None:
            doubt = replace(doubt, words=_words(body.words))
        if not doubt.lines:
            return JSONResponse(
                status_code=422,
                content={
                    "code": "nothing_to_read",
                    "message": "Every line is empty now. Take the photo again and I will read it.",
                },
            )
        profile = consent.get_profile(principal.subject, anonymous=False)
        plan = billing.metered_plan(principal, profile)
        payload = turn_payload(doubt, doubt.words)
        # THE RECORD REACHES THE PROMPT, exactly as the capability route does for wobo.turn.
        mind.ground_lifetime(payload, subject=principal.subject, anonymous=False)
        shaper = DoubtShaper(region_ids=frozenset(line.id for line in doubt.targets))
        response = stream_board_turn(
            gateway,
            "wobo.turn",
            CapabilityRequest(payload=payload),
            request,
            profile,
            plan,
            shaper=shaper,
        )
        if shaper.shaped:
            # A real answer was planned: the doubt joins the climb and is counted as one doubt.
            # The corrected lines reach the record HERE and not before: a correction the inbound
            # screen refused (the turn above is then a one-shot line and the shaper never ran)
            # is not written into learner.doubts. If the record is away the answer went ahead
            # on the corrected reading in hand all the same.
            answered = replace(doubt, status="answered", answered_at=_now())
            join_the_climb(answered)
            with contextlib.suppress(StoreUnavailable):
                store.update(answered)
            ledger.record_delivery(
                capability=ANSWER_CAPABILITY, unit_kind=ledger.DOUBT, unit_count=1
            )
        return response

    @app.get("/v1/doubt")
    def mine(request: Request) -> Response:
        principal = _learner(request)
        if principal is None:
            return _sign_in_required()
        try:
            doubts = get_store().list(principal.subject)
        except StoreUnavailable:
            return JSONResponse(
                status_code=503,
                content={
                    "code": "store_unavailable",
                    "message": "I cannot reach my memory just now.",
                },
            )
        return JSONResponse(status_code=200, content={"doubts": [d.as_dict() for d in doubts]})

    @app.get("/v1/doubt/{doubt_id}/photo")
    def photo(doubt_id: str, request: Request) -> Response:
        principal = _learner(request)
        if principal is None:
            return _sign_in_required()
        if not _ID_RE.match(doubt_id):
            return _not_found()
        data = get_store().photo(principal.subject, doubt_id)
        if not data:
            return _not_found()
        return Response(
            content=data, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"}
        )

    @app.delete("/v1/doubt/{doubt_id}")
    def forget(doubt_id: str, request: Request) -> Response:
        principal = _learner(request)
        if principal is None:
            return _sign_in_required()
        if not _ID_RE.match(doubt_id):
            return _not_found()
        try:
            rows, photos = get_store().forget(principal.subject, doubt_id)
        except StoreUnavailable:
            return JSONResponse(
                status_code=502,
                content={
                    "code": "erase_incomplete",
                    "message": "I could not let that go just now. Try again in a moment.",
                },
            )
        if not rows:
            return _not_found()
        return JSONResponse(status_code=200, content={"erased": {"doubts": rows, "photos": photos}})


__all__ = [
    "ANSWER_CAPABILITY",
    "BUCKET",
    "DEFAULT_WORDS",
    "Doubt",
    "DoubtRefused",
    "DoubtShaper",
    "DoubtStore",
    "Eyes",
    "InMemoryDoubtStore",
    "Line",
    "LiveImageScreen",
    "LiveReader",
    "MAX_LINE_CHARS",
    "MAX_PIXELS",
    "MockEyes",
    "NOTHING_READ_SAY",
    "OFF_PAGE",
    "PostgrestDoubtStore",
    "Prepared",
    "READ_CAPABILITY",
    "Reading",
    "SCREEN_CAPABILITY",
    "StoreMissing",
    "StoreUnavailable",
    "TABLE",
    "corrected",
    "decode_image_field",
    "get_eyes",
    "get_store",
    "join_the_climb",
    "place",
    "prepare_image",
    "read_doubt",
    "reading_from",
    "refusal_for_validation",
    "register_doubt",
    "set_eyes",
    "set_store",
    "topic_node_uuid",
    "turn_payload",
    "verdict_from",
]
