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
corrects the reading before a single number is computed. The screen is not allowed to spend its
200-token budget thinking (:data:`NO_THINKING`) and the reader is required to (:data:`READ_EFFORT`,
because a reader told to spend nothing on looking skims a page of working and drops the middle);
an answer that comes back in some other shape is read as far as it got rather than thrown away
(:func:`read_payload`) — a learner is told their photograph was bad only when the reader looked at
it and found nothing on it. What the reading is KNOWN to be short of is said out loud in law 1's
own sentence and carried into the answer, never swallowed (:func:`question_line`,
:func:`unaccounted`).

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
import time
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

#: THE WHOLE DOUBT READ, ON THE WALL CLOCK (the adversary, 2026-09-09, finding 4).
#:
#: Live on that day the door was one photo in three. The maths page read correctly in 15 949 ms;
#: the diagram photo refused with a 503 after 5 849 ms; and the history photo came back 422 after
#: the learner had waited 90 021 MILLISECONDS. Every model call on this path already carries a
#: deadline — ``model_call.complete`` treats ``timeout`` as the whole chain's budget — but THE DOOR
#: CARRIED NONE, so the screen, the re-screen after a crop and the read each spent their own and a
#: child paid the sum with a phone in their hand. Nothing in this product has a clause for a minute
#: and a half.
#:
#: So the door has a wall clock, and what is left of it is handed DOWN: each call is started with
#: the smaller of its own deadline and the time the door has left (:meth:`LiveReader.with_seconds`),
#: and a step with no time left is not started at all. A learner is told, honestly, that it took
#: too long — which is a thing they can act on, unlike silence.
DOUBT_BUDGET_S = 45.0
#: No model call is worth starting with less than this left: it would fail on the clock anyway,
#: and the learner would pay for the failing.
_MIN_CALL_S = 4.0
#: What the learner reads when the door runs out. It blames the wait, never the photograph.
TOO_SLOW_SAY = "That one took longer than it should have. Send it again and I will have another go."

#: THE SCREEN MAY NOT THINK ITS ANSWER AWAY (the adversary, wave 42, finding 11).
#:
#: The door was one photo in two, four waves running, and the photographs were never the problem.
#: Live on Luna and Flash, 2026-09-10, with the ladder pinned and the lab's own three pages:
#:
#: * ``doubt.screen``, capped at 200 output tokens, came back ``finish='length'`` with
#:   ``reasoning_tokens=200`` and an EMPTY body. Not one character of the four booleans was
#:   written. :func:`safety.screen_image` fails closed, correctly, so a perfectly good maths page
#:   and a perfectly good diagram were both refused "I could not check that photo just now".
#:   The one screen that passed that day had spent 65 of its 200 tokens thinking.
#: * ``doubt.read``, capped at 1500, came back ``finish='length'`` with ``reasoning_tokens=1304``
#:   and 192 tokens of actual reading — a CORRECT read of the history page, subject, topic,
#:   question and three whole lines with their boxes, cut off mid-object. ``json.loads`` refused
#:   it, so the learner was told to take a straighter, brighter photograph of a page Wobo had
#:   just read.
#:
#: Reading four booleans off a picture is not a puzzle. ``plexus/engines.py`` already carries this
#: lesson above its own ``_MAX_TOKENS`` — "reasoning tokens count against max_tokens, so a tight
#: budget gets exhausted mid-thought and returns EMPTY content — which parses to {}". The screen is
#: the place in this service where the budget is smallest, so it is the place that breaks first.
#:
#: "minimal" is a value EVERY rung of every doubt chain takes: litellm maps it onto Gemini's
#: ``thinkingConfig`` and OpenAI accepts it by name, so a fallback cannot 400 on the word.
NO_THINKING = "minimal"

#: BUT THE READER MUST LOOK (the adversary, wave 42's judge, finding 1).
#:
#: Wave 42 applied :data:`NO_THINKING` to BOTH vision calls and measured the outcome — 200 instead
#: of 503 — without measuring whether the reading was RIGHT. It was not. Five live runs of the
#: lab's maths page on 2026-09-10, Luna and Flash, ladder pinned, muted, at 390:
#:
#: * two refused ``photo_outage`` at 2828 ms and 3334 ms (the screen; see :class:`LiveImageScreen`)
#: * the three that read all returned FOUR of the page's six lines — ``Ex 2.3 Q4``, ``3x = 25``,
#:   ``x = 25/3``, ``x = 8.33`` — losing ``Solve: 3x + 5 = 20`` (paraphrased into ``question`` and
#:   left out of ``lines``) and ``3x = 20 + 5 ?``, the learner's own step 1. Those are the two
#:   lines the sign error is on, and the learner had typed "I am not sure about the +5".
#: * all three then told the child the wrong step was right: "Step 2 is right: x = 25/3, because
#:   dividing both sides of 3x = 25 by 3 leaves x alone." Zero of five found the error.
#:
#: The same photograph read all six lines, twice, with thinking on (waves 40 and 42's live runs,
#: ``turns/doubt/w44-live-math-390`` and ``w47-live-math-390``). Transcribing a page of a child's
#: handwriting IS a puzzle: a reader told to spend nothing on looking skims it, and a skim of a
#: page of working drops the middle.
#:
#: The truncation that was used to justify the ban is ALREADY REPAIRED, in this file and on the
#: same day: :func:`_repaired` reads a cut-off answer as far as it got, with the boxes it gave,
#: and :meth:`Reading.say` tells the learner it may not have reached the end of the page. A read
#: that is short and SAYS SO is a smaller defect than a read that is short and signed. So the room
#: goes back to the looking, and the two guards below catch what a short read costs:
#: :func:`question_line` and :func:`unaccounted`.
READ_EFFORT = "low"
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


def _second_look(primary: str, fallbacks: list[str]) -> tuple[tuple[str, list[str]], ...]:
    """The two chains a screen gets: the registry's, then the same one rotated one rung.

    With no fallback there is nothing to rotate to and the same model is asked again — still worth
    it, because what failed was one sampling of a 200-token budget, not the model.
    """
    if not fallbacks:
        return ((primary, []), (primary, []))
    return ((primary, list(fallbacks)), (fallbacks[0], [primary, *fallbacks[1:]]))


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

    def with_seconds(self, seconds: float) -> LiveImageScreen:
        """The same screen, given no more than ``seconds``. It only ever NARROWS: a door with time
        to spare does not lengthen a call's own deadline (:data:`DOUBT_BUDGET_S`)."""
        return replace(self, timeout_s=min(self.timeout_s, max(0.0, float(seconds))))

    def screen(self, *, image: bytes, media_type: str) -> ImageVerdict:
        """The verdict, or a raise. AN EMPTY BODY IS NOT A VERDICT, so it is asked once more.

        Wave 42's judge, finding 1: two of five live runs of a perfectly good maths page refused
        ``photo_outage`` at 2828 ms and 3334 ms, each with ONE ``doubt.screen`` row charged and no
        ``doubt.read`` row. The screen returned, was paid for, and wrote nothing: 200 output
        tokens is a tight fit for four booleans even at :data:`NO_THINKING`, and it fits about
        three times in five. :func:`safety.screen_image` then failed closed, correctly — but
        failing closed on a checker that never ANSWERED costs a child their whole turn, and the
        module already draws this distinction for the reader (:data:`NO_ANSWER_SAY`).

        So the non-answer gets a second look, on the rung BEHIND the primary where there is one:
        the same model that just wrote nothing is the least likely to write something now, and a
        different provider fails independently. Two non-answers is an outage and the photo is not
        kept. Nothing here can turn a refusal into a pass — only an explicit verdict is read, and
        it is read by :func:`verdict_from` exactly as before.

        The empty body did not come back in seventeen live openings of this door on the afternoon
        of 2026-09-10, so this second look is held by the suite and by the shape of the thing, not
        by a live reproduction. It costs nothing on a screen that answers, which is every one.
        """
        from wobo_gateway.model_call import complete
        from wobo_gateway.providers import max_tokens_for
        from wobo_gateway.telemetry import record_cost

        primary, fallbacks = (
            _degraded_chain(SCREEN_CAPABILITY) if self.degraded else _chain(SCREEN_CAPABILITY)
        )
        started = time.monotonic()
        for look, (model, behind) in enumerate(_second_look(primary, fallbacks)):
            # The second look comes out of the FIRST one's deadline, never on top of it: the door
            # narrowed this screen to what it had left (:meth:`with_seconds`) and a retry that
            # ignored that would spend a learner's whole wall clock on the checker.
            left = self.timeout_s - (time.monotonic() - started)
            if look and left < _MIN_CALL_S:
                break
            response = complete(
                model=model,
                messages=[
                    {"role": "system", "content": SCREEN_SYSTEM},
                    {"role": "user", "content": [_image_part(image, media_type)]},
                ],
                fallbacks=behind or None,
                max_tokens=max_tokens_for(SCREEN_CAPABILITY, 200),
                temperature=0.0,
                reasoning_effort=NO_THINKING,  # 200 tokens, four booleans (:data:`NO_THINKING`)
                timeout=left if look else self.timeout_s,
            )
            record_cost(
                capability=SCREEN_CAPABILITY, model=model, response=response, unit_kind=ledger.DOUBT
            )
            data = _json_in(response.choices[0].message.content or "")
            if data:
                return verdict_from(data)
            logger.warning(
                "doubt: the screen answered nothing readable",
                extra={"fields": {"model": model, "again": bool(look)}},
            )
        raise ValueError("the screen answered nothing readable")


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
    "correct, complete, solve or translate anything. The question is a SUMMARY of the task and "
    "never a replacement for a line: a question printed on the page is still one of lines, "
    "verbatim and in its place, and so is every step of the student's own working, including a "
    "step they crossed out or put a question mark beside. A digit or a sign you cannot make out is "
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
#: With no key there are no eyes, and that is a different thing from a photo Wobo could not read.
#: Blaming the picture ("try a straighter, brighter photo") for a missing model is a lie a learner
#: would act on, so the keyless path says what is actually true and hands the move back.
NO_EYES_SAY = (
    "I cannot see the page on this device. Type what it says, line by line, and I will start "
    "from there."
)

NOTHING_READ_SAY = (
    "I could not make out any writing or figure on that page. Try a straighter, brighter photo, "
    "or type what the page shows and I will start from there."
)

#: When the reader RAN and said nothing usable at all. Until 2026-09-10 this arrived at
#: :data:`NOTHING_READ_SAY` with the other two, so a learner whose page Wobo never got a word out
#: about was told their photograph was bad and sent to take another one — advice that cannot work,
#: about a thing that was not wrong. This blames the reading, which is what actually failed, and
#: hands back a move that does.
NO_ANSWER_SAY = (
    "My reading of that page did not come back. Send it to me again and I will have another go."
)

#: A prose answer that is ABOUT the read rather than OF the page. A vision model that will not
#: answer writes a sentence in the first person, and putting "I cannot identify people in this
#: image" into the learner's own reading and then asking "is that right?" is a worse lie than the
#: one this whole change is here to end.
_ABOUT_ITSELF_RE = re.compile(
    r"^(i\b|i'm|sorry|as an|unfortunately|apolog|there (is|are) no)", re.I
)
#: One ``{...}`` with no brace inside it: a line of the reader's ``lines`` array, closed.
_CLOSED_OBJECT_RE = re.compile(r"\{[^{}]*\}")


def _repaired(text: str) -> dict[str, Any] | None:
    """A reading that ran out of room, read as far as it got.

    The reader writes ``lines`` last and one object at a time, so an answer cut off by the output
    cap is a whole subject, a whole topic, a whole question and N whole lines followed by half of
    one. Every closed object is a line the reader actually read, WITH the box it gave it, so a
    repaired line is a target ink may anchor to exactly like any other. The half is dropped.
    """
    start = text.find("{")
    if start < 0:
        return None
    body = text[start:]
    out: dict[str, Any] = {}
    for name in ("subject", "topic", "question"):
        match = re.search(rf'"{name}"\s*:\s*("(?:[^"\\]|\\.)*")', body)
        if match:
            with contextlib.suppress(ValueError):
                out[name] = json.loads(match.group(1))
    at = body.find('"lines"')
    lines: list[dict[str, Any]] = []
    if at >= 0:
        for chunk in _CLOSED_OBJECT_RE.finditer(body[at:]):
            with contextlib.suppress(ValueError):
                item = json.loads(chunk.group(0))
                if isinstance(item, dict) and item.get("text"):
                    lines.append(item)
    if not lines:
        return None
    out["lines"] = lines
    return out


def _prose(text: str) -> dict[str, Any] | None:
    """The reader wrote the page out instead of shaping it.

    Those are lines of the page and they are kept, with NO BOX: text the learner can correct,
    which is the whole of law 1, and never a rect ink may anchor to, which is law 3 already. A
    page nobody placed gets no ring.

    An answer that STARTED the shape it was asked for is never prose, however it ended. A read cut
    off before its first whole line has nothing left to repair, and reading its braces and field
    names out as the page — "is that right?" over ``{``, ``"subject": "History",`` — would show a
    child the machine instead of their book.
    """
    stripped = re.sub(r"^\s*```[a-zA-Z]*\s*|\s*```\s*$", "", text.strip())
    if stripped.startswith(("{", "[")):
        return None
    rows = [row for row in (_clean_line(part) for part in stripped.splitlines()) if row]
    if not rows or all(_ABOUT_ITSELF_RE.match(row) for row in rows):
        return None
    return {"lines": [{"text": row} for row in rows[:MAX_LINES]]}


def read_payload(text: str) -> tuple[dict[str, Any], str]:
    """The reader's answer and HOW it came: ``read``, ``repaired``, ``prose`` or ``mute``.

    Until 2026-09-10 this was one line — ``_extract_json`` — and every answer that was not exactly
    one whole JSON object was discarded, whole, and reported to the learner as a bad photograph.
    Three different things arrived at that one sentence and only one of them is about the
    photograph (:data:`NO_ANSWER_SAY`, :data:`NOTHING_READ_SAY`).
    """
    data = _json_in(text)
    if data:
        return data, "read"
    repaired = _repaired(text)
    if repaired:
        return repaired, "repaired"
    prose = _prose(text)
    if prose:
        return prose, "prose"
    return {}, "mute"


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
    #: True when nothing looked at the photo at all — the keyless path. Not the same as a page
    #: that was looked at and could not be read, and it is not said the same way.
    blind: bool = False
    #: HOW the reader's answer came back (:func:`read_payload`): ``read`` when it was the shape
    #: asked for, ``repaired`` when it ran out of room and was read as far as it got, ``prose``
    #: when the page was written out instead, ``mute`` when nothing usable came at all. It decides
    #: which sentence an empty reading gets, and no two of them blame the same thing.
    how: str = "read"
    #: What the learner's own words point at that is nowhere in the lines (:func:`unaccounted`).
    #: A reading with any of these is KNOWN to be short of the thing it was asked about.
    missing: tuple[str, ...] = ()

    @property
    def targets(self) -> tuple[Line, ...]:
        return tuple(line for line in self.lines if line.box is not None)

    @property
    def short(self) -> bool:
        """True when this reading is KNOWN not to be the whole page: it was cut off, or it does
        not contain the thing the learner asked about."""
        return self.how == "repaired" or bool(self.missing)

    def say(self) -> str:
        """Law 1, in Wobo's voice: what was read, and the question that hands it back."""
        if not self.lines:
            if self.blind:
                return NO_EYES_SAY
            return NOTHING_READ_SAY if self.how == "read" else NO_ANSWER_SAY
        shown = "; ".join(line.text for line in self.lines[:6])
        rest = len(self.lines) - 6
        # "and 1 more lines" was on the wire live on 2026-09-10, three times in five, whenever the
        # page's stray "?" was read as a line of its own. Wobo counts in English.
        more = f" and {rest} more line{'' if rest == 1 else 's'}" if rest > 0 else ""
        # A repaired reading is a reading that is KNOWN to be short: the reader was cut off, so
        # saying "I read this as ..." with no more would claim a whole page had been read.
        end = " I may not have got to the end of the page." if self.how == "repaired" else ""
        if self.missing:
            # And so is a reading that has not got the thing the learner is pointing at. Three
            # live runs answered "Step 2 is right" over a working with no +5 anywhere in it while
            # the learner's own words said "I am not sure about the +5". Law 1 is where that is
            # caught: the learner sees the gap before a single number is computed.
            end += f" I could not find {_named(self.missing)} in what I read, and that is what you"
            end += " asked about."
        return f"I read this as: {shown}{more}.{end} Is that right? Fix anything I got wrong first."


def _clean_line(text: Any) -> str:
    return " ".join(str(text or "").split())[:MAX_LINE_CHARS]


def _named(things: tuple[str, ...]) -> str:
    """One or two of them, in Wobo's voice: the +5, or the +5 or the 8.33. Never a list."""
    shown = [f"the {thing}" for thing in things[:2]]
    return " or ".join(shown)


def _squashed(text: str) -> str:
    return re.sub(r"\s+", "", text or "").lower()


#: A relation. A page that states one states the thing its working is about.
_RELATION_RE = re.compile(r"[=<>≤≥≠]")
#: A number as a whole number, never a run of digits inside a longer one: the 5 of "+5" is not the
#: 5 of "25", and reading it as one is how "3x = 25" came to look like it had the +5 in it.
_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")
#: WHAT A LEARNER CAN POINT AT, in their own words. Exactly two shapes count.
#:
#: * a SIGNED number — "the +5", "that -3", "the minus" — which is a term of the working; the sign
#:   is the whole reason they are asking.
#: * a number written with a point or a slash — 8.33, 25/3 — which nothing but the page says.
#:
#: A bare integer is never one. "Is my step 2 right?", "Q4", "part 3", "in 1857" name a place, a
#: label or a date, not a term of the working, and counting those would make every reading ever
#: made short. Nor is a hyphen that joins two things a minus sign: the lookbehind keeps "step-2"
#: and "lines 1-3" out, because the sign has to stand on its own to be a sign.
_POINTED_AT_RE = re.compile(r"(?<![\w])[+\-]\s*\d+(?:\.\d+)?|(?<![\w])\d+(?:[./]\d+)+")


def unaccounted(lines: Any, words: str) -> tuple[str, ...]:
    """The things the learner's own words point at that are nowhere in what was read.

    Wave 42's judge, finding 1: the learner typed "Is my step 2 right? I am not sure about the +5"
    and the reading that came back — ``Ex 2.3 Q4``, ``3x = 25``, ``x = 25/3``, ``x = 8.33`` — had
    no ``+5`` on it anywhere, because the two lines that carry it were dropped. All three live
    reads then told the child the wrong step was right, and one of them said the quiet part out
    loud: "The +5 isn't in the visible working." That sentence is the refusal it should have been.
    """
    page = "|".join(_squashed(str(text)) for text in lines)
    out: list[str] = []
    for found in _POINTED_AT_RE.findall(words or ""):
        token = _squashed(found)
        if token not in page and token not in out:
            out.append(token)
    return tuple(out[:2])


def question_line(question: str, lines: Any) -> str:
    """The page's own question, when it states a relation the working needs and no line has it.

    Live on 2026-09-10 the reader put ``Solve the equation 3x + 5 = 20.`` in ``question`` and left
    it out of ``lines`` on all three runs that read at all, so the working handed to the tutor
    began ``3x = 25`` with nothing for the 25 to have come from. The equation a page asks about is
    a LINE of that page; ``question`` is a summary of it, not a replacement for it. READ_SYSTEM
    now says so, and this is the deterministic half, because a prompt is a request and this is a
    law.

    It comes back with NO box — nobody placed it, so law 3 still forbids a mark on it — and the
    learner is shown it for correction like every other line, which is the whole of law 1.

    Only a question that states a RELATION whose numbers are missing from every line is restored.
    A history page's "Why did the sepoys march to Delhi?" is a question ABOUT the page: putting it
    back would write a line nobody wrote, and law 1 would then read Wobo's own sentence out to a
    child and ask "is that right?". And a question that is the same line said twice adds nothing.
    """
    text = _clean_line(question)
    if not text or not _RELATION_RE.search(text):
        return ""
    written = [str(line) for line in lines]
    if _squashed(text) in "|".join(_squashed(line) for line in written):
        return ""
    page = " ".join(written)
    numbers = _NUMBER_RE.findall(text)
    if not numbers:
        return ""
    if all(re.search(rf"(?<!\d){re.escape(n)}(?!\d)", page) for n in numbers):
        return ""
    return text


def reading_from(data: dict[str, Any], how: str = "read", *, words: str = "") -> Reading:
    """The reader's JSON into a reading: bounded, boxed, and honest about what had no place.

    ``words`` are the learner's own, beside the photo. They are never read back as the page; they
    are what :func:`unaccounted` measures the reading against.
    """
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
    question = _clean_line(data.get("question"))
    # Only with room for it: a page already at MAX_LINES is a page whose last line matters as
    # much as its first, and buying one back by dropping one is not a repair.
    lost = (
        question_line(question, [line.text for line in lines]) if 0 < len(lines) < MAX_LINES else ""
    )
    if lost:
        # In reading order: the question sets up the working, so it goes before the first line
        # that states a relation — a heading ("Ex 2.3 Q4") comes first on the page and still does.
        at = next((i for i, line in enumerate(lines) if _RELATION_RE.search(line.text)), 0)
        lines.insert(at, Line(id="", text=lost, box=None))
        lines = [replace(line, id=f"r{i + 1}") for i, line in enumerate(lines)]
        unplaced += 1
    return Reading(
        subject=_clean_line(data.get("subject"))[:MAX_TOPIC_CHARS],
        topic=_clean_line(data.get("topic"))[:MAX_TOPIC_CHARS],
        question=question,
        lines=tuple(lines),
        unplaced=unplaced,
        how=how,
        missing=unaccounted([line.text for line in lines], words),
    )


class Reader(Protocol):
    def read(self, *, image: bytes, media_type: str, words: str) -> Reading: ...


@dataclass(frozen=True)
class LiveReader:
    """The generate-tier vision read, on the same rung the own-syllabus photo already goes to."""

    timeout_s: float = 30.0
    degraded: bool = False

    def with_seconds(self, seconds: float) -> LiveReader:
        """The same reader, given no more than ``seconds`` (:data:`DOUBT_BUDGET_S`)."""
        return replace(self, timeout_s=min(self.timeout_s, max(0.0, float(seconds))))

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
            reasoning_effort=READ_EFFORT,  # the reader must look (:data:`READ_EFFORT`)
            timeout=self.timeout_s,
        )
        record_cost(
            capability=READ_CAPABILITY, model=primary, response=response, unit_kind=ledger.DOUBT
        )
        data, how = read_payload(response.choices[0].message.content or "")
        if how != "read":
            # An operator can tell the three apart WITHOUT a probe, which is how this took four
            # waves to find: the wire said 422 and the log said nothing at all.
            logger.warning(
                "doubt: the reader did not answer in the shape asked",
                extra={
                    "fields": {
                        "how": how,
                        "model": primary,
                        "chars": len(response.choices[0].message.content or ""),
                        "finish": str(
                            getattr(response.choices[0], "finish_reason", "") or "unknown"
                        ),
                        "lines": len(data.get("lines") or []),
                    }
                },
            )
        return reading_from(data, how, words=words)


class MockEyes:
    """Keyless eyes for ``LLM_MODE=mock``: nothing here looks at a pixel, and nothing pretends to.

    IT USED TO SPEAK A STAGE DIRECTION. The reading was one line reading "(the page, as far as I
    could read it without my eyes)", boxed over 80% of the photo — so the learner heard "I read
    this as: (the page, as far as I could read it without my eyes). Is that right?" and the one
    ring Wobo drew went round the whole page (the adversary, 2026-09-09, finding 8). A parenthesis
    is a note to a developer; a child heard it read out at both widths.

    What this has instead is the one thing it honestly holds: the words the learner typed beside
    the photo. Those are read back for correction, which is the whole of law 1, and they carry NO
    BOX — a line with no box is text a learner can correct and never a rect ink may anchor to, so
    nothing is ringed on a page nobody looked at. With no words there is nothing at all, and the
    say is :data:`NO_EYES_SAY`, which blames the missing model rather than the photograph.
    """

    def screen(self, *, image: bytes, media_type: str) -> ImageVerdict:
        return ImageVerdict(allowed=True)

    def read(self, *, image: bytes, media_type: str, words: str) -> Reading:
        typed = [_clean_line(part) for part in re.split(r"[\n;]+", words or "")]
        lines = tuple(
            Line(f"r{i + 1}", text, None) for i, text in enumerate(t for t in typed if t)
        )[:MAX_LINES]
        return Reading(subject="", topic="", question="", lines=lines, blind=True)


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
    #: HOW this turn's reading came back (:class:`Reading`). It is about the CALL, not the record,
    #: so it is not in :meth:`to_row` and a doubt read back from the store has the default — but
    #: it must survive as far as the route, because law 1's sentence is written there and a
    #: reading that was cut off has to say so. Until 2026-09-10 the route rebuilt a bare
    #: ``Reading`` from the row, so ``how`` was always "read" and the repaired reading's own
    #: clause could never reach the wire: honesty that was written and never said.
    how: str = "read"

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
    learner who fixed 8x to 3x still heard "start with 8x". The equation seat is a corrected line,
    and the learner's words are theirs or the tap's meaning, never the reader's.

    WHICH corrected line, though. It was the FIRST, and the first line of a page of exercise work
    is "Ex 2.3 Q4" — an exercise number, handed to ``_ground_working`` as the equation to ground
    against. The relation is the equation; a heading is not. So the seat goes to the first
    corrected line that states one, and falls back to the first line when no line does (a history
    page has no equation and never did).
    """
    targets = [{"id": line.id, "kind": "line", "label": line.text} for line in doubt.targets]
    # The photo's lines ARE the glass map (docs/INK-FREEZE-PLAN-TRACE.md section 3, Freeze): the
    # same plan grammar marks a line of the page by id, with the box the vision read gave it.
    glass = [
        {"id": line.id, "role": "photo-line", "text": line.text, "box": list(line.box or ())}
        for line in doubt.targets
    ]
    written = [line.text for line in doubt.lines]
    equation = next((text for text in written if _RELATION_RE.search(text)), "")
    # What the learner pointed at and this reading has not got. It rides in the page's own state,
    # which is where the turn prompt reads a screen from, so an answer built on a working with a
    # hole in it cannot be written as though the working were whole. Three live runs on
    # 2026-09-10 said "Step 2 is right" about a page whose step 2 was never read.
    gap = unaccounted(written, words)
    state: dict[str, Any] = {"surface": "photo", "doubt": doubt.id, "lines": len(doubt.lines)}
    if gap:
        state["couldNotRead"] = (
            f"{', '.join(gap)} — the learner asked about this and it is NOT in the working below, "
            "so the working is incomplete: say that, and never call a step right or wrong on it"
        )
    return {
        "context": {
            "turn": {"lastUserInput": (words or DEFAULT_WORDS)[:MAX_WORDS_CHARS]},
            "page": {"route": "doubt", "state": state},
            "curriculum": {"nodeName": doubt.node_name or doubt.topic or doubt.school_subject},
            "canvas": {
                "equation": equation or (written[0] if written else ""),
                "steps": [f"{line.id}: {line.text}" for line in doubt.lines],
            },
            "targets": targets,
            "packet": {"v": 1, "glass": glass},
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


def _given(part: Any, seconds: float) -> Any:
    """The screen or the reader, holding no more of the clock than the door has left.

    A part that does not know how to be narrowed is handed back untouched: the keyless eyes and
    every fake in the suite have no deadline to narrow, and a door that insisted would be a door
    that could only be built one way.
    """
    narrow = getattr(part, "with_seconds", None)
    return narrow(seconds) if callable(narrow) else part


def read_doubt(
    *,
    subject: str,
    raw: bytes,
    media_type: str,
    words: str,
    framework_id: str | None,
    eyes: Eyes,
    store: DoubtStore,
    budget_s: float = DOUBT_BUDGET_S,
) -> Doubt:
    """The reading step, end to end: bound, screen, crop, read, place, keep. Raises DoubtRefused.

    ``budget_s`` is the whole door's wall clock (:data:`DOUBT_BUDGET_S`). Each step is started with
    what is left of it, and a step with nothing left is not started.
    """
    deadline = time.monotonic() + max(0.0, float(budget_s))

    def left() -> float:
        return deadline - time.monotonic()

    def in_time() -> float:
        seconds = left()
        if seconds < _MIN_CALL_S:
            raise DoubtRefused("photo_slow", TOO_SLOW_SAY, status=503)
        return seconds

    prepared = prepare_image(raw, media_type=media_type)
    verdict = screen_image(
        prepared.data, media_type=prepared.media_type, screen=_given(eyes.screen, left())
    )
    if verdict.allowed and verdict.crop is not None:
        # The screen found the work apart from something the page does not need. Keep the work.
        prepared = prepare_image(raw, media_type=media_type, crop=verdict.crop)
        if verdict.details:
            # THE SECOND LOOK, AND THE ONLY CASE THAT NEEDS ONE. This crop was allowed only
            # because the screen said someone's details are on the page but the work is APART
            # from them, so the one thing nobody has checked is whether the crop actually left
            # them behind: a crop is the screen's suggestion, not its verdict. Until 2026-09-05
            # a second "details, but here is a crop" was read as a pass and the photo was kept.
            #
            # A crop with NO details is a different thing and gets no second call. It is a
            # SUBREGION of a frame this screen has just certified in the same breath — no face
            # anywhere in it, no personal detail anywhere in it, a page of work — and every one
            # of those three survives cropping, because a crop can only take things away. The
            # call bought nothing and cost the learner about two seconds of the wait finding 4
            # is about, plus one more chance to fail closed: live on 2026-09-10 a screen that
            # spent its whole 200-token budget thinking refused two perfectly good pages of work
            # with "I could not check that photo just now" (:data:`NO_THINKING`).
            verdict = screen_image(
                prepared.data,
                media_type=prepared.media_type,
                screen=_given(eyes.screen, in_time()),
            )
            if verdict.allowed and verdict.details:
                verdict = ImageVerdict(allowed=False, reason="personal")
            elif verdict.allowed and verdict.crop is not None:
                verdict = replace(verdict, crop=None)
    if not verdict.allowed:
        status = 503 if verdict.reason == "outage" else 422
        raise DoubtRefused(f"photo_{verdict.reason or 'refused'}", verdict.say, status=status)

    try:
        reading = _given(eyes.reader, in_time()).read(
            image=prepared.data, media_type=prepared.media_type, words=words
        )
    except DoubtRefused:
        raise
    except Exception as exc:  # noqa: BLE001 - one honest refusal, nothing kept
        raise DoubtRefused(
            "reader_failed",
            "I could not read that page just now. Try again in a moment.",
            status=503,
        ) from exc
    if not reading.lines:
        # The reader that said nothing is not the page that had nothing on it. 422 nothing_read
        # is a verdict about the PHOTOGRAPH and the learner is asked to take another; a reader
        # that ran and produced nothing usable is a 503 about the reading, and the same photo is
        # worth sending again. Until 2026-09-10 both were the first sentence.
        if reading.how == "mute":
            raise DoubtRefused("reader_mute", reading.say(), status=503)
        raise DoubtRefused("nothing_read", reading.say(), status=422)
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
        how=reading.how,
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


#: What each field on these routes is called when Wobo says it out loud. The FIRST match against
#: the failing field's path wins, so a correction line is answered as a line and a capture as a
#: capture. Every sentence names the thing the learner actually did.
_FIELD_REFUSALS: tuple[tuple[str, str], ...] = (
    (
        "image",
        "That photo did not come through. Take it again and send it to me.",
    ),
    (
        "lines",
        f"That line is longer than I can take. A line can be {MAX_LINE_CHARS} characters; "
        "try a shorter one.",
    ),
    (
        "words",
        f"That note is longer than I can read. Say it in under {MAX_WORDS_CHARS} characters "
        "and I will have it.",
    ),
    (
        "framework_id",
        "I could not tell which syllabus that was. Pick it again and send the page once more.",
    ),
)

#: When the body is unreadable in a way none of the fields explains.
_LAST_RESORT = "I could not read that. Send it to me again."


def _validation_message(exc: Exception) -> str:
    """Say what actually failed.

    Until 2026-09-07 every validation failure on every /v1/doubt route got ONE sentence: "A line
    can be 200 characters; try a shorter one." Lines belong to the correction editor on
    ``POST /v1/doubt/{id}/answer``; there are none on the photo intake, so a learner whose camera
    handed back an empty capture was told to shorten a line they never typed.
    """
    errors = getattr(exc, "errors", None)
    fields: list[str] = []
    if callable(errors):
        for error in errors():
            fields += [str(part) for part in error.get("loc", ()) if isinstance(part, str)]
    for name, message in _FIELD_REFUSALS:
        if name in fields:
            return message
    return _LAST_RESORT


def refusal_for_validation(request: Request, exc: Exception) -> JSONResponse | None:
    """A body the doubt routes cannot read, as ``{code, message}`` in Wobo's voice. None on any
    other route, whose shape is its own business. The SDK's ``refusal()`` unwraps ``{code,
    message}`` and nothing else, so FastAPI's ``detail: [...]`` reached the learner as 'trouble'."""
    if not request.url.path.startswith("/v1/doubt"):
        return None
    return JSONResponse(
        status_code=422,
        content={"code": "bad_request", "message": _validation_message(exc)},
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
        # The reading AS IT CAME, not a fresh one built from the row: ``how`` says whether it was
        # cut off and ``missing`` what the learner pointed at and Wobo did not find, and law 1's
        # sentence is the only place either of them is said out loud.
        reading = Reading(
            doubt.school_subject,
            doubt.topic,
            doubt.question,
            doubt.lines,
            how=doubt.how,
            missing=unaccounted([line.text for line in doubt.lines], _words(body.words)),
        )
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
    "NO_ANSWER_SAY",
    "NO_EYES_SAY",
    "NO_THINKING",
    "OFF_PAGE",
    "PostgrestDoubtStore",
    "Prepared",
    "READ_CAPABILITY",
    "READ_EFFORT",
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
    "question_line",
    "read_doubt",
    "read_payload",
    "reading_from",
    "refusal_for_validation",
    "register_doubt",
    "set_eyes",
    "set_store",
    "topic_node_uuid",
    "turn_payload",
    "unaccounted",
    "verdict_from",
]
