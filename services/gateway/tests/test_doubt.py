"""Wobo's eyes — the doubt solver (doubt.py), held to its laws on the wire.

Each test is one clause of the brief. The reading is shown before any answer (law 1); the photo is
screened, bounded, stripped and erasable, and the erase reaches the bucket (law 2); a mark lands on
a line of the page or is counted as off the page (law 3); a doubt is filed in the climb (law 4);
and on a doubt turn no ink frame lands without a say frame in the same beat (law 5).

The eyes are faked: nothing here looks at a pixel or reaches a network, and the fakes record what
they were asked so a test can prove a refused photo was never read.
"""

from __future__ import annotations

import base64
import contextlib
import io
import json
import os
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import doubt, ledger, safety, spend
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.board import stream
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.safety import ImageVerdict
from wobo_gateway.telemetry import MetricsSink

SSE = {"Accept": "text/event-stream"}
ME = "learner-under-test"
OTHER = "someone-else"


# --- fakes and helpers ---------------------------------------------------------------------------


def photo_bytes(
    width: int = 800, height: int = 600, *, fmt: str = "JPEG", exif: bool = False
) -> bytes:
    """A real encoded image, optionally carrying the metadata a phone writes."""
    from PIL import Image

    image = Image.new("RGB", (width, height), (250, 248, 240))
    # a few dark strokes so the JPEG is not a flat block
    for x in range(0, width, 37):
        for y in range(0, height, 53):
            image.putpixel((x, y), (20, 20, 20))
    out = io.BytesIO()
    if exif:
        meta = Image.Exif()
        meta[0x010F] = "TestPhone"  # Make
        meta[0x0112] = 6  # Orientation: rotate 90 degrees clockwise
        image.save(out, fmt, exif=meta.tobytes())
    else:
        image.save(out, fmt)
    return out.getvalue()


def body(
    raw: bytes | None = None,
    *,
    words: str = "why is the perimeter wrong?",
    media_type: str = "image/jpeg",
    framework_id: str | None = None,
) -> dict[str, Any]:
    data = base64.b64encode(raw if raw is not None else photo_bytes()).decode("ascii")
    out: dict[str, Any] = {"image": {"data": data, "mediaType": media_type}, "words": words}
    if framework_id:
        out["framework_id"] = framework_id
    return out


@dataclass
class FakeScreen:
    verdicts: list[ImageVerdict] = field(default_factory=lambda: [ImageVerdict(allowed=True)])
    calls: list[tuple[int, str]] = field(default_factory=list)
    raises: bool = False

    def screen(self, *, image: bytes, media_type: str) -> ImageVerdict:
        self.calls.append((len(image), media_type))
        if self.raises:
            raise TimeoutError("the screen did not answer")
        return self.verdicts[min(len(self.calls) - 1, len(self.verdicts) - 1)]


LINES = (
    doubt.Line("r1", "Find the perimeter of the rectangle", (0.1, 0.1, 0.9, 0.2)),
    doubt.Line("r2", "length 8 cm and breadth 3 cm", (0.1, 0.25, 0.9, 0.35)),
    doubt.Line("r3", "P = 8 + 3 = 11 cm", (0.1, 0.4, 0.6, 0.5)),
)


@dataclass
class FakeReader:
    reading: doubt.Reading = field(
        default_factory=lambda: doubt.Reading(
            "maths", "perimeter of a rectangle", "Find the perimeter of the rectangle", LINES
        )
    )
    calls: list[tuple[int, str]] = field(default_factory=list)
    raises: bool = False

    def read(self, *, image: bytes, media_type: str, words: str) -> doubt.Reading:
        self.calls.append((len(image), words))
        if self.raises:
            raise RuntimeError("the reader fell over")
        return self.reading


@pytest.fixture
def eyes() -> tuple[FakeScreen, FakeReader]:
    screen, reader = FakeScreen(), FakeReader()
    doubt.set_eyes(doubt.Eyes(screen=screen, reader=reader))
    return screen, reader


@pytest.fixture(autouse=True)
def _clean(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    stream.reset()
    yield
    doubt.set_eyes(None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def frames(text: str) -> list[tuple[str, str, dict[str, Any]]]:
    out = []
    for block in text.split("\n\n"):
        if not block.strip() or block.startswith(":"):
            continue
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append((fields["id"], fields["event"], json.loads(fields["data"])))
    return out


def read(client: TestClient, auth: Any, subject: str = ME, **kwargs: Any) -> Any:
    return client.post("/v1/doubt", json=body(**kwargs), headers=auth(subject))


def answer(client: TestClient, auth: Any, doubt_id: str, subject: str = ME, **payload: Any) -> Any:
    return client.post(
        f"/v1/doubt/{doubt_id}/answer", json=payload, headers={**auth(subject), **SSE}
    )


# --- law 1: the reading is shown before the answer ------------------------------------------------


def test_the_reading_comes_back_first_and_nothing_is_answered(
    client: TestClient, auth, eyes
) -> None:
    res = read(client, auth)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["step"] == "reading"
    assert out["say"].startswith("I read this as: Find the perimeter of the rectangle;")
    assert out["say"].endswith("Is that right? Fix anything I got wrong first.")
    lines = out["reading"]["lines"]
    assert [line["id"] for line in lines] == ["r1", "r2", "r3"]
    assert lines[0]["box"] == [0.1, 0.1, 0.9, 0.2]
    assert out["reading"]["topic"] == "perimeter of a rectangle"
    # no answer of any kind rode along: no events, no ink, no say beyond the reading
    assert "events" not in out and "ink" not in res.text
    # the photo route is metered as a generation, and says how much is left
    assert "x-wobo-budget-remaining" in res.headers
    kept = doubt.get_store().get(ME, out["doubt"])
    assert kept is not None and kept.status == "read"
    assert doubt.get_store().photo(ME, out["doubt"])


def test_the_learner_corrects_the_reading_before_a_number_is_computed(
    client: TestClient, auth, eyes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A 3 read as an 8 is fixed by the learner, and the fix is what the tutor is handed."""
    seen: list[dict[str, Any]] = []

    def plan_for(payload: dict[str, Any], *, live: bool) -> dict[str, Any] | None:
        seen.append(payload)
        return None  # nothing to draw: the turn falls to the spoken answer

    monkeypatch.setattr("wobo_gateway.wobo.board_plan_for", plan_for)
    doubt_id = read(client, auth).json()["doubt"]
    res = answer(
        client,
        auth,
        doubt_id,
        lines=[{"id": "r2", "text": "length 8 cm and breadth 5 cm"}, {"id": "r3", "text": ""}],
    )
    assert res.status_code == 200, res.text
    context = seen[0]["context"]
    # the corrected line replaced the misread one, and the emptied line is gone
    assert context["canvas"]["steps"] == [
        "r1: Find the perimeter of the rectangle",
        "r2: length 8 cm and breadth 5 cm",
    ]
    assert [t["label"] for t in context["targets"]][1] == "length 8 cm and breadth 5 cm"
    assert context["page"]["route"] == "doubt"
    # and the record now holds the corrected reading
    kept = doubt.get_store().get(ME, doubt_id)
    assert [line.text for line in kept.lines][1] == "length 8 cm and breadth 5 cm"
    assert len(kept.lines) == 2


def test_an_unreadable_body_is_told_what_it_actually_got_wrong(
    client: TestClient, auth, eyes
) -> None:
    """Every validation failure on every /v1/doubt route used to get ONE sentence, and it
    described the wrong thing: "I could not read that. A line can be 200 characters; try a
    shorter one." Lines are the correction editor on POST /v1/doubt/{id}/answer. There are none
    on the photo intake, so a learner whose camera handed back an empty capture was told to
    shorten a line they had never typed."""
    empty_capture = client.post(
        "/v1/doubt",
        json={"image": {"data": "", "mediaType": "image/jpeg"}, "words": ""},
        headers=auth(),
    )
    assert empty_capture.status_code == 422
    said = empty_capture.json()
    assert said["code"] == "bad_request"
    assert "photo" in said["message"]
    assert "line" not in said["message"].lower()

    long_syllabus = client.post("/v1/doubt", json=body(framework_id="x" * 200), headers=auth())
    assert long_syllabus.status_code == 422
    assert "syllabus" in long_syllabus.json()["message"]
    assert "line" not in long_syllabus.json()["message"].lower()

    # …and a line that really is too long is still told about the line, on the route that has one.
    doubt_id = read(client, auth).json()["doubt"]
    too_long = answer(client, auth, doubt_id, lines=[{"id": "r1", "text": "x" * 5000}])
    assert too_long.status_code == 422
    assert f"{doubt.MAX_LINE_CHARS} characters" in too_long.json()["message"]


# --- the door -------------------------------------------------------------------------------------


def test_the_door_is_the_same_door(client: TestClient) -> None:
    assert client.post("/v1/doubt", json=body()).status_code == 401


def test_a_stranger_is_asked_to_sign_in(client: TestClient, auth, eyes) -> None:
    """The free tier is the demo, not anonymous access: an anonymous token is refused kindly."""
    res = client.post("/v1/doubt", json=body(), headers=auth(anonymous=True))
    assert res.status_code == 403
    assert res.json()["code"] == "sign_in_required"
    assert eyes[0].calls == [] and eyes[1].calls == []


def test_the_capability_route_takes_no_photo_prompt(client: TestClient, auth) -> None:
    """The two vision capabilities exist for the registry and the ledger, not as a text door."""
    res = client.post(
        "/v1/capability/doubt.read", json={"payload": {"prompt": "read this"}}, headers=auth()
    )
    assert res.status_code == 404
    assert res.json()["code"] == "use_doubt_route"


def test_the_answer_is_a_stream_or_nothing(client: TestClient, auth, eyes) -> None:
    doubt_id = read(client, auth).json()["doubt"]
    res = client.post(f"/v1/doubt/{doubt_id}/answer", json={}, headers=auth())
    assert res.status_code == 406
    assert res.json()["code"] == "stream_required"


# --- law 2: the photo is screened, bounded, stripped, account-keyed and erasable ------------------


def test_a_face_is_refused_and_nothing_is_kept(client: TestClient, auth) -> None:
    screen = FakeScreen(verdicts=[ImageVerdict(allowed=False, reason="face")])
    reader = FakeReader()
    doubt.set_eyes(doubt.Eyes(screen=screen, reader=reader))
    before = client.get("/v1/me", headers=auth()).json()["budget"]
    res = read(client, auth)
    assert res.status_code == 422
    assert res.json() == {"code": "photo_face", "message": safety.IMAGE_FACE_SAY}
    assert reader.calls == [], "a refused photo was READ"
    assert doubt.get_store().list(ME) == []
    # and the learner was not charged a generation for a photo that was not kept
    assert client.get("/v1/me", headers=auth()).json()["budget"] == before


def test_a_screen_that_cannot_run_keeps_nothing(client: TestClient, auth) -> None:
    """Fail closed: the checker did not run, so the photo is not kept, and the learner is told."""
    screen = FakeScreen(raises=True)
    reader = FakeReader()
    doubt.set_eyes(doubt.Eyes(screen=screen, reader=reader))
    res = read(client, auth)
    assert res.status_code == 503
    assert res.json() == {"code": "photo_outage", "message": safety.IMAGE_SCREEN_OUTAGE_SAY}
    assert reader.calls == []
    assert doubt.get_store().list(ME) == []


def test_screen_image_fails_closed_on_any_failure() -> None:
    class Broken:
        def screen(self, *, image: bytes, media_type: str) -> Any:
            raise RuntimeError("no")

    class Wrong:
        def screen(self, *, image: bytes, media_type: str) -> Any:
            return {"allowed": True}

    assert safety.screen_image(b"x", media_type="image/jpeg", screen=Broken()).reason == "outage"
    assert safety.screen_image(b"x", media_type="image/jpeg", screen=Wrong()).reason == "outage"
    assert safety.screen_image(b"", media_type="image/jpeg", screen=Wrong()).reason == "not_a_page"


def test_personal_details_keep_only_the_work(client: TestClient, auth) -> None:
    """A worksheet with a name in the header: the screen names the work, the crop is kept, and
    what is left is screened once more before it is read."""
    screen = FakeScreen(
        verdicts=[
            doubt.verdict_from(
                {
                    "page_of_work": True,
                    "face": False,
                    "personal_details": True,
                    "work_box": [0.0, 0.25, 1.0, 1.0],
                }
            ),
            ImageVerdict(allowed=True),
        ]
    )
    reader = FakeReader()
    doubt.set_eyes(doubt.Eyes(screen=screen, reader=reader))
    res = read(client, auth, raw=photo_bytes(1000, 1000))
    assert res.status_code == 200, res.text
    out = res.json()["reading"]
    assert (out["width"], out["height"]) == (1000, 750)
    assert len(screen.calls) == 2, "the crop was trusted without a second look"
    assert len(reader.calls) == 1


def test_personal_details_with_no_work_apart_are_refused() -> None:
    verdict = doubt.verdict_from({"page_of_work": True, "face": False, "personal_details": True})
    assert not verdict.allowed and verdict.reason == "personal"
    assert verdict.say == safety.IMAGE_PERSONAL_SAY
    # a face is refused whatever else the screen found
    assert (
        doubt.verdict_from({"page_of_work": True, "face": True, "work_box": [0, 0, 1, 1]}).reason
        == "face"
    )
    assert doubt.verdict_from({"page_of_work": False}).reason == "not_a_page"


def test_the_photo_is_downscaled_oriented_and_stripped(client: TestClient, auth, eyes) -> None:
    """A 3200x2400 phone photo, rotated by its EXIF tag, with the phone's name in it."""
    from PIL import Image

    res = read(client, auth, raw=photo_bytes(3200, 2400, exif=True))
    assert res.status_code == 200, res.text
    out = res.json()
    kept = doubt.get_store().photo(ME, out["doubt"])
    image = Image.open(io.BytesIO(kept))
    # orientation applied (portrait now), long edge at the ceiling, and not a byte of EXIF
    assert image.size == (1200, 1600)
    assert (out["reading"]["width"], out["reading"]["height"]) == (1200, 1600)
    assert dict(image.getexif()) == {}
    assert b"TestPhone" not in kept
    # what the model saw is what was kept: the same downscaled bytes, never the original
    assert eyes[0].calls[0][0] == len(kept) and eyes[1].calls[0][0] == len(kept)


def test_bounds_at_the_door(
    client: TestClient, auth, eyes, monkeypatch: pytest.MonkeyPatch
) -> None:
    # a declared body over the photo ceiling is refused before a byte is read
    res = client.post(
        "/v1/doubt",
        content=b"{}",
        headers={
            **auth(),
            "Content-Type": "application/json",
            "Content-Length": str(9 * 1024 * 1024),
        },
    )
    assert res.status_code == 413
    # a photo bigger than the context-packet ceiling still comes in on THIS path
    from PIL import Image

    noisy = io.BytesIO()
    Image.frombytes("RGB", (400, 400), os.urandom(400 * 400 * 3)).save(noisy, "PNG")
    big = noisy.getvalue()
    assert len(big) > 256 * 1024
    assert read(client, auth, raw=big, media_type="image/png").status_code == 200
    # …and does not on the capability route, whose ceiling is unchanged
    res = client.post(
        "/v1/capability/wobo.turn", json={"payload": {"blob": "x" * 300_000}}, headers=auth()
    )
    assert res.status_code == 413
    # decoded bytes past the image bound, an unsupported type, and a file that is not an image
    monkeypatch.setattr(doubt, "MAX_IMAGE_BYTES", 1000)
    assert read(client, auth).json()["code"] == "image_too_large"
    monkeypatch.setattr(doubt, "MAX_IMAGE_BYTES", 6 * 1024 * 1024)
    assert read(client, auth, media_type="image/gif").status_code == 415
    assert read(client, auth, raw=b"not an image at all").json()["code"] == "bad_photo"
    assert eyes[0].calls == [] or len(eyes[0].calls) == 1  # only the one good photo was screened


def test_my_doubts_are_mine(client: TestClient, auth, eyes) -> None:
    mine = read(client, auth).json()["doubt"]
    theirs = read(client, auth, subject=OTHER).json()["doubt"]
    listed = client.get("/v1/doubt", headers=auth()).json()["doubts"]
    assert [d["doubt"] for d in listed] == [mine]
    # another learner cannot see, answer or erase it
    assert client.get(f"/v1/doubt/{mine}/photo", headers=auth(OTHER)).status_code == 404
    assert answer(client, auth, mine, subject=OTHER).status_code == 404
    assert client.delete(f"/v1/doubt/{mine}", headers=auth(OTHER)).status_code == 404
    # the memory page: the photo comes back to its owner, and one tap lets it go
    shown = client.get(f"/v1/doubt/{mine}/photo", headers=auth())
    assert shown.status_code == 200 and shown.headers["content-type"] == "image/jpeg"
    assert shown.headers["cache-control"] == "private, no-store"
    gone = client.delete(f"/v1/doubt/{mine}", headers=auth())
    assert gone.json() == {"erased": {"doubts": 1, "photos": 1}}
    assert client.get(f"/v1/doubt/{mine}/photo", headers=auth()).status_code == 404
    assert doubt.get_store().get(OTHER, theirs) is not None


def test_forget_me_reaches_the_bucket(client: TestClient, auth, eyes) -> None:
    read(client, auth)
    read(client, auth)
    theirs = read(client, auth, subject=OTHER).json()["doubt"]
    res = client.post("/v1/me/erase", headers=auth())
    assert res.status_code == 200, res.text
    erased = res.json()["erased"]
    assert erased["doubts"] == 2 and erased["photos"] == 2
    assert doubt.get_store().list(ME) == []
    assert doubt.get_store().photo(OTHER, theirs) is not None


def test_a_store_that_refuses_is_named_by_the_erase(client: TestClient, auth, monkeypatch) -> None:
    class Refusing(doubt.InMemoryDoubtStore):
        def forget_all(self, subject: str) -> tuple[int, int]:
            raise doubt.StoreUnavailable("bucket unreachable")

    doubt.set_store(Refusing())
    res = client.post("/v1/me/erase", headers=auth())
    assert res.status_code == 502
    assert "doubts" in res.json()["failed"]


def test_the_project_store_writes_the_object_then_the_row_and_erases_by_prefix() -> None:
    calls: list[tuple[str, str, Any]] = []

    def request(
        url: str,
        key: str,
        method: str,
        *,
        body: bytes | None = None,
        content_type=None,
        want_rows: bool,
        profile: bool = True,
    ) -> Any:
        calls.append((method, url, body if content_type != "image/jpeg" else b"<jpeg>"))
        if method == "DELETE" and "/rest/v1/" in url:
            return [{"id": "a"}, {"id": "b"}]
        if method == "DELETE" and "/storage/v1/object/doubt-photos" in url:
            return [{"name": p} for p in json.loads(body)["prefixes"]]
        if url.endswith("/storage/v1/object/list/doubt-photos"):
            return [{"name": "a.jpg"}, {"name": "b.jpg"}, {"name": "orphan.jpg"}]
        if method == "GET" and "/rest/v1/" in url:
            return [
                {
                    "id": "abcdefgh1234",
                    "subject_id": ME,
                    "lines": [line.as_dict() for line in LINES],
                    "width": 10,
                    "height": 10,
                }
            ]
        return []

    store = doubt.PostgrestDoubtStore("https://project.example", "svc", request=request)
    record = doubt.Doubt(
        id="abcdefgh1234",
        subject_id=ME,
        created_at="2026-09-05T00:00:00Z",
        words="",
        school_subject="maths",
        topic="t",
        question="q",
        lines=LINES,
        width=10,
        height=10,
    )
    store.put(record, b"jpeg")
    assert [c[0] for c in calls] == ["POST", "POST"]
    assert (
        calls[0][1]
        == f"https://project.example/storage/v1/object/doubt-photos/{ME}/abcdefgh1234.jpg"
    )
    assert "/rest/v1/doubts" in calls[1][1]
    row = json.loads(calls[1][2])
    assert row["subject_id"] == ME and len(row["lines"]) == 3
    got = store.get(ME, "abcdefgh1234")
    assert got is not None and got.targets[0].id == "r1"
    calls.clear()
    assert store.forget_all(ME) == (2, 3)
    assert [c[0] for c in calls] == ["DELETE", "POST", "DELETE"]
    assert json.loads(calls[2][2]) == {
        "prefixes": [f"{ME}/a.jpg", f"{ME}/b.jpg", f"{ME}/orphan.jpg"]
    }
    assert f"subject_id=eq.{ME}" in calls[0][1]


# --- laws 3 and 5: ink anchors to a line of the page, and lands with the sentence about it --------


def planned(payload: dict[str, Any], *, live: bool) -> dict[str, Any] | None:
    """A model plan with every kind of anchor a model might write over a photo."""
    return {
        "say": (
            "Look at the first line. The perimeter adds all four sides. Which two sides are equal?"
        ),
        "intents": [],
        "objects": [
            {"id": "ring", "kind": "circle", "anchor": {"target": "r1"}, "pad": 8},
            {
                "id": "note",
                "kind": "write",
                "anchor": {"target": "r2", "at": "bottom"},
                "text": "two of each",
                "meta": {"beat": {"after": 1}},
            },
            {"id": "guess", "kind": "circle", "anchor": {"board": [500, 500]}, "pad": 8},
            {"id": "nudge", "kind": "underline", "anchor": {"target": "r3", "offset": [40, -30]}},
            {"id": "ghost", "kind": "point", "anchor": {"target": "not-on-the-page"}},
            {
                "id": "arrow",
                "kind": "arrow",
                "anchor": {"object": "ring"},
                "from": {"object": "note"},
            },
        ],
        "ask": {"prompt": "Which side did you forget?", "targets": ["r2"]},
    }


def test_ink_anchors_to_a_line_of_the_page_or_is_counted_off_the_page(
    client: TestClient, auth, eyes, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("wobo_gateway.wobo.board_plan_for", planned)
    doubt_id = read(client, auth).json()["doubt"]
    res = answer(client, auth, doubt_id)
    assert res.status_code == 200, res.text
    events = frames(res.text)
    ink = {e[2]["object"]["id"]: e[2]["object"] for e in events if e[1] == "ink"}
    # the marks on a line of the page were drawn; the pixel guesses were not
    assert set(ink) == {"ring", "note", "nudge", "arrow"}
    assert ink["ring"]["anchor"] == {"target": "r1"}
    assert ink["nudge"]["anchor"] == {"target": "r3"}, "an offset is a pixel guess and was kept"
    assert ink["arrow"]["anchor"] == {"object": "ring"}
    done = events[-1][2]
    assert done["objects"] == 4
    assert any(r.startswith("off the page: 2 mark(s)") for r in done["refused"]), done["refused"]
    assert doubt.OFF_PAGE["count"] == 2
    assert events[-2][1] == "ask" and events[-2][2]["targets"] == ["r2"]


def test_no_ink_frame_lands_without_a_say_frame_in_the_same_beat(
    client: TestClient, auth, eyes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Law 5: a teacher at a board talks AS they write. Every ink frame shares its timestamp with
    the say frame it was beaten to; the model's own beat is honoured and the rest are given one."""
    monkeypatch.setattr("wobo_gateway.wobo.board_plan_for", planned)
    doubt_id = read(client, auth).json()["doubt"]
    events = frames(answer(client, auth, doubt_id).text)
    say_at = {e[2]["t"] for e in events if e[1] == "say"}
    ink = [e[2] for e in events if e[1] == "ink"]
    # Three sentences the model wrote, and one pointing sentence for each of the two page marks
    # its sentences never named (the adversary, wave 58, finding 1): "This line, find the
    # perimeter of the rectangle." after the first, "This line, P = 8 + 3 = 11 cm." after the
    # sentence the underline keeps time with.
    said = [e[2]["text"] for e in events if e[1] == "say"]
    assert len(say_at) == 5 and ink, said
    assert said[1] == "This line, find the perimeter of the rectangle."
    assert said[3] == "This line, P = 8 + 3 = 11 cm."
    assert all(e["t"] in say_at for e in ink), [(e["object"]["id"], e["t"]) for e in ink]
    beats = {e["object"]["id"]: e["object"]["meta"]["beat"] for e in ink}
    # the model's own beat, untouched in meaning: after "The perimeter adds all four sides.",
    # which the pointing sentence moved from index 1 to index 2
    assert beats["note"] == {"after": 2}
    assert beats["ring"] == {"with": 0}  # the first stroke is on the first sentence
    assert all(set(b) & {"with", "after"} for b in beats.values())
    # and the first stroke starts with the first sentence, not after it
    first_say = next(e[2] for e in events if e[1] == "say")
    assert min(e["t"] for e in ink) == first_say["t"]


def tagged(payload: dict[str, Any], *, live: bool) -> dict[str, Any] | None:
    """The wave-57 plan, as Luna wrote it live at 390 on 2026-09-10: a teaching line, and marks
    carrying TAGS rather than sentences."""
    return {
        "say": (
            "Start with the perimeter, because it is the way round the whole shape. The first "
            "step is P = 8 + 3 = 11 cm, and it counts only two sides, because a perimeter adds "
            "all four."
        ),
        "intents": [],
        "objects": [
            {
                "id": "m0",
                "kind": "underline",
                "anchor": {"target": "r1"},
                "words": "Starting equation",
            },
            {"id": "m1", "kind": "cross", "anchor": {"target": "r3"}, "words": "Wrong sign"},
            {
                "id": "m2",
                "kind": "ring",
                "anchor": {"target": "r2"},
                "words": "Correct first step",
            },
        ],
    }


def test_a_label_is_never_a_sentence_in_the_speech(
    client: TestClient, auth, eyes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The adversary, wave 57: the caption spliced three mark labels into the teaching line —
    "... removing the extra 5. Starting equation. The first step is ... Wrong sign. Correct first
    step." A label is what a mark says on the glass, never a sentence in the speech."""
    monkeypatch.setattr("wobo_gateway.wobo.board_plan_for", tagged)
    doubt_id = read(client, auth).json()["doubt"]
    events = frames(answer(client, auth, doubt_id).text)
    said = " ".join(e[2]["text"] for e in events if e[1] == "say")
    for tag in ("Starting equation", "Wrong sign", "Correct first step"):
        assert tag not in said, said
    # the teaching the model wrote is untouched
    assert said.startswith("Start with the perimeter, because it is the way round"), said
    # and every mark is called by the line it sits on, which is what it is about
    ink = {e[2]["object"]["id"]: e[2]["object"] for e in events if e[1] == "ink"}
    assert ink["m0"]["words"] == "Find the perimeter of the rectangle"
    assert ink["m1"]["words"] == "P = 8 + 3 = 11 cm"
    assert ink["m2"]["words"] == "length 8 cm and breadth 3 cm"
    # ... and a line the teaching never names is POINTED AT, never read back as a claim and never
    # left unsaid (the adversary, wave 58, finding 1: "Not quite. What is 20 - 5?" over a ring on
    # one of six lines, and nothing said which). The teaching names "P = 8 + 3 = 11 cm" itself.
    assert "This line, find the perimeter of the rectangle." in said, said
    assert "This line, length 8 cm and breadth 3 cm." in said, said
    assert "This line, P = 8 + 3 = 11 cm." not in said, said
    assert "length 8 cm and breadth 3 cm." not in said.replace(
        "This line, length 8 cm and breadth 3 cm.", ""
    )


def test_the_brain_is_told_about_the_mark_the_pen_already_laid(
    client: TestClient, auth, eyes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """THE INSTANT MARK (docs/INK-FOUR.md). The learner's confirmed lines are registered targets
    the moment they press Explain, so the client's pen starts on one of them with no model call —
    and the brain has to be told, or it plans against a photo it believes is unmarked."""
    seen: dict[str, Any] = {}

    def spy(payload: dict[str, Any], *, live: bool) -> dict[str, Any] | None:
        seen.update(payload)
        return tagged(payload, live=live)

    monkeypatch.setattr("wobo_gateway.wobo.board_plan_for", spy)
    doubt_id = read(client, auth).json()["doubt"]
    res = answer(
        client,
        auth,
        doubt_id,
        standing=[{"id": "instant-1", "kind": "underline", "target": "r1"}],
    )
    assert res.status_code == 200, res.text
    standing = (seen.get("board") or {}).get("standing")
    assert standing == [
        {
            "id": "instant-1",
            "kind": "underline",
            "anchor": {"target": "r1"},
            # ... called by the line it sits on, and pointed at when nothing names it
            "words": "Find the perimeter of the rectangle",
            "meta": {"page": True},
        }
    ]
    said = " ".join(e[2]["text"] for e in frames(res.text) if e[1] == "say")
    # The plan's own underline is on the same line, so the standing copy stands down and the
    # line is pointed at once, by the plan's mark: never read back raw, never said twice.
    assert said.count("find the perimeter of the rectangle") == 1, said
    assert "Find the perimeter of the rectangle." not in said, said


def test_a_standing_mark_on_a_line_the_reading_does_not_have_is_dropped(
    client: TestClient, auth, eyes
) -> None:
    """A client may not name a target the page never had: the standing list is the page's own
    lines or it is nothing."""
    doubt_id = read(client, auth).json()["doubt"]
    res = answer(
        client, auth, doubt_id, standing=[{"id": "x", "kind": "ring", "target": "r9"}]
    )
    assert res.status_code == 200, res.text


def test_the_keyless_answer_rings_the_line_the_learner_named(
    client: TestClient, auth, eyes
) -> None:
    """No key, no network: the keyless planner marks the line whose words the learner used, and the
    two laws hold on that path too."""
    doubt_id = read(client, auth, words="why is the perimeter wrong?").json()["doubt"]
    events = frames(answer(client, auth, doubt_id).text)
    kinds = [e[1] for e in events]
    assert kinds[0] == "say" and kinds[-1] == "done" and "ink" in kinds
    ink = [e[2] for e in events if e[1] == "ink"]
    assert all(e["object"]["anchor"]["target"] == "r1" for e in ink)
    say_at = {e[2]["t"] for e in events if e[1] == "say"}
    assert all(e["t"] in say_at for e in ink)


# --- law 4: a doubt joins the climb ---------------------------------------------------------------


def test_topic_node_uuid_is_the_apps_own() -> None:
    """Held to ``topicNodeUuid`` in apps/web-pwa/src/screens/learn/mastery.ts, computed with bun."""
    assert (
        doubt.topic_node_uuid("cbse-9-maths:linear-equations")
        == "00000000-0000-7000-8000-54910b5d3e19"
    )
    assert doubt.topic_node_uuid("doubt:maths:perimeter") == "00000000-0000-7000-8000-d1326ad9a69c"
    assert doubt.topic_node_uuid("x") == "00000000-0000-7000-8000-fd0c5087c051"
    assert doubt.topic_node_uuid("é") == "00000000-0000-7000-8000-6c0b6c44af14"


def test_a_doubt_is_filed_in_the_pinned_syllabus(
    client: TestClient, auth, eyes, monkeypatch
) -> None:
    from wobo_gateway.curriculum import store as curriculum_store
    from wobo_gateway.curriculum.models import Framework, Node, NodeKind, Version

    registry = curriculum_store.InMemoryStore()
    registry.put_framework(Framework(id="cbse-9-maths", name="CBSE class 9 maths"))
    registry.put_version(Version(id="v1", framework_id="cbse-9-maths", label="2026"))
    registry.put_nodes(
        [
            Node(
                id="cbse-9-maths:mensuration",
                version_id="v1",
                kind=NodeKind.UNIT,
                name="Mensuration",
            ),
            Node(
                id="cbse-9-maths:perimeter-and-area",
                version_id="v1",
                kind=NodeKind.TOPIC,
                name="Perimeter and area of rectangles",
                parent_id="cbse-9-maths:mensuration",
            ),
            Node(
                id="cbse-9-maths:linear-equations",
                version_id="v1",
                kind=NodeKind.TOPIC,
                name="Linear equations",
            ),
        ]
    )
    registry.put_pin(ME, "cbse-9-maths", "v1")
    monkeypatch.setattr(curriculum_store, "get_store", lambda: registry)

    out = read(client, auth, framework_id="cbse-9-maths").json()
    assert out["climb"] == {
        "node_id": doubt.topic_node_uuid("cbse-9-maths:perimeter-and-area"),
        "node_name": "Perimeter and area of rectangles",
        "framework_id": "cbse-9-maths",
    }
    # without a board named, the doubt has a node of its own — and still joins the climb
    own = read(client, auth).json()["climb"]
    assert own["node_id"] == doubt.topic_node_uuid("doubt:maths:perimeter-of-a-rectangle")
    assert own["framework_id"] is None


def test_the_answer_writes_a_slip_into_wobos_mind(client: TestClient, auth, eyes) -> None:
    from wobo_gateway import mind

    out = read(client, auth).json()
    assert mind.get_store().get(ME) is None
    res = answer(client, auth, out["doubt"])
    assert res.status_code == 200
    held = mind.get_store().get(ME)
    assert held is not None
    assert [dict(s) for s in held.slips] == [
        {
            "nodeId": out["climb"]["node_id"],
            "itemId": f"doubt:{out['doubt']}",
            "at": held.slips[0]["at"],
        }
    ]
    today = datetime.now(UTC).date().isoformat()
    assert held.days[today]["asked"] == 1
    kept = doubt.get_store().get(ME, out["doubt"])
    assert kept.status == "answered" and kept.answered_at
    # asked again, the same doubt is one slip, not two
    answer(client, auth, out["doubt"])
    assert len(mind.get_store().get(ME).slips) == 1


# --- cost: its own unit, and the money ceiling before the first vision call -----------------------


def test_a_doubt_is_counted_in_its_own_unit(client: TestClient, auth, eyes, monkeypatch) -> None:
    assert ledger.unit_for("doubt.read") == ledger.DOUBT == "doubt"
    assert ledger.unit_for("doubt.screen") == "doubt"
    rows: list[dict[str, Any]] = []
    monkeypatch.setattr(ledger, "record_delivery", lambda **kw: rows.append(kw))
    doubt_id = read(client, auth).json()["doubt"]
    answer(client, auth, doubt_id)
    assert rows == [{"capability": "doubt.answer", "unit_kind": "doubt", "unit_count": 1}]


def test_the_money_ceiling_refuses_before_the_first_vision_call(
    client: TestClient, auth, eyes, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "1")
    spend.record(1.0, capability="engine.compose", model="x")  # the day is spent, for a member
    res = read(client, auth)
    assert res.status_code == 429
    assert res.json()["code"] == "spend_ceiling"
    assert eyes[0].calls == [] and eyes[1].calls == []
    assert doubt.get_store().list(ME) == []


def test_a_reader_that_falls_over_keeps_nothing_and_refunds(client: TestClient, auth) -> None:
    screen = FakeScreen()
    doubt.set_eyes(doubt.Eyes(screen=screen, reader=FakeReader(raises=True)))
    before = client.get("/v1/me", headers=auth()).json()["budget"]
    res = read(client, auth)
    assert res.status_code == 503 and res.json()["code"] == "reader_failed"
    assert doubt.get_store().list(ME) == []
    assert client.get("/v1/me", headers=auth()).json()["budget"] == before


def test_the_live_eyes_send_the_image_as_data_through_the_registry_chain(monkeypatch) -> None:
    """The one live seam, without a network: the message shape, the chain, and the ledger row."""
    sent: list[dict[str, Any]] = []

    class Message:
        content = json.dumps(
            {
                "subject": "maths",
                "topic": "fractions",
                "question": "",
                "lines": [
                    {"text": "1/2 + 1/4", "box": [0, 0, 1, 0.5]},
                    {"text": "lost", "box": [2, 0, 1, 1]},
                ],
            }
        )

    class Choice:
        message = Message()

    class Response:
        choices = [Choice()]
        usage = None

    def complete(**kwargs: Any) -> Any:
        sent.append(kwargs)
        return Response()

    costed: list[dict[str, Any]] = []
    monkeypatch.setattr("wobo_gateway.model_call.complete", complete)
    monkeypatch.setattr("wobo_gateway.telemetry.record_cost", lambda **kw: costed.append(kw))
    reading = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="help")
    # The vision tier: Gemini Flash reads first, Terra behind it (routing.Tier.VISION).
    assert sent[0]["model"] == "gemini/gemini-2.5-flash"
    assert sent[0]["fallbacks"] == ["openai/gpt-5.6-terra"]
    parts = sent[0]["messages"][1]["content"]
    assert parts[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert "<student_note>" in parts[0]["text"]
    assert costed[0]["capability"] == "doubt.read" and costed[0]["unit_kind"] == "doubt"
    assert [line.id for line in reading.lines] == ["r1", "r2"]
    assert reading.targets[0].text == "1/2 + 1/4" and reading.unplaced == 1
    verdict = doubt.LiveImageScreen().screen(image=b"\xff\xd8jpeg", media_type="image/jpeg")
    assert sent[1]["model"] == "openai/gpt-5.6-luna" and sent[1]["temperature"] == 0.0
    assert costed[1]["capability"] == "doubt.screen"
    assert verdict.reason == "not_a_page"  # the reader's JSON is not a screen verdict: refused


def test_a_project_without_the_migration_holds_nothing_and_keeps_nothing() -> None:
    """Until 0021 is applied the table and the bucket answer 404. On the read and erase paths that
    is an empty answer, never a 502 on forget-me for every learner; on the write path it is still
    a refusal, because a photo that cannot be kept is not kept."""
    import urllib.error

    def missing(url: str, key: str, method: str, **kwargs: Any) -> Any:
        raise urllib.error.HTTPError(url, 404, "relation does not exist", {}, None)  # type: ignore[arg-type]

    store = doubt.PostgrestDoubtStore("https://project.example", "svc", request=missing)
    assert store.forget_all(ME) == (0, 0)
    assert store.forget(ME, "abcdefgh1234") == (0, 0)
    assert store.list(ME) == []
    assert store.get(ME, "abcdefgh1234") is None
    record = doubt.Doubt(
        id="abcdefgh1234",
        subject_id=ME,
        created_at="2026-09-05T00:00:00Z",
        words="",
        school_subject="maths",
        topic="t",
        question="q",
        lines=LINES,
        width=10,
        height=10,
    )
    with pytest.raises(doubt.StoreUnavailable):
        store.put(record, b"jpeg")

    def down(url: str, key: str, method: str, **kwargs: Any) -> Any:
        raise urllib.error.HTTPError(url, 503, "service unavailable", {}, None)  # type: ignore[arg-type]

    # a store that is THERE and refusing is still named, not counted as empty
    with pytest.raises(doubt.StoreUnavailable):
        doubt.PostgrestDoubtStore("https://project.example", "svc", request=down).forget_all(ME)


# --- the fixer's pass, 2026-09-05: leaks first, then misreads, then broken, then sloppy ----------


def photo_with_everything_a_phone_writes() -> bytes:
    """EXIF, XMP and a JPEG COM marker, each carrying a child's name or address."""
    from PIL import Image

    image = Image.new("RGB", (800, 600), (250, 248, 240))
    meta = Image.Exif()
    meta[0x013B] = "a child name, Class 7B"  # Artist
    out = io.BytesIO()
    image.save(
        out,
        "JPEG",
        exif=meta.tobytes(),
        xmp=b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>a child name</dc:creator>'
        b"</x:xmpmeta>",
        comment=b"home: 12 Jubilee Hills Rd",
    )
    return out.getvalue()


def test_the_comment_and_xmp_markers_leave_with_the_exif() -> None:
    """[leak] Pillow copies ``info['comment']`` and ``info['xmp']`` into a re-encoded JPEG unless
    told not to, so 'no metadata' was EXIF only. Measured before the fix: the kept bytes carried
    a name and an address on both the plain and the crop path."""
    raw = photo_with_everything_a_phone_writes()
    assert b"Jubilee" in raw and b"child name" in raw
    for crop in (None, (0.0, 0.25, 1.0, 1.0)):
        kept = doubt.prepare_image(raw, media_type="image/jpeg", crop=crop).data
        assert b"child name" not in kept, f"a name survived re-encoding (crop={crop})"
        assert b"Jubilee" not in kept, f"an address survived re-encoding (crop={crop})"
        assert b"xmpmeta" not in kept
        from PIL import Image

        info = Image.open(io.BytesIO(kept)).info
        assert not set(info) & {"comment", "xmp", "exif", "icc_profile"}, sorted(info)


def test_a_re_screen_that_still_finds_details_refuses(client: TestClient, auth) -> None:
    """[leak] The second screen used to be trusted only when it said 'clean'; a second 'details,
    but here is a crop' was read as a pass and the cropped photo was kept and read."""
    screen = FakeScreen(
        verdicts=[
            doubt.verdict_from(
                {"page_of_work": True, "personal_details": True, "work_box": [0, 0.25, 1, 1]}
            ),
            doubt.verdict_from(
                {"page_of_work": True, "personal_details": True, "work_box": [0, 0.5, 1, 1]}
            ),
        ]
    )
    reader = FakeReader()
    doubt.set_eyes(doubt.Eyes(screen=screen, reader=reader))
    res = read(client, auth, raw=photo_bytes(1000, 1000))
    assert res.status_code == 422, res.text
    assert res.json() == {"code": "photo_personal", "message": safety.IMAGE_PERSONAL_SAY}
    assert len(screen.calls) == 2
    assert reader.calls == [], "a photo the screen said still carried details was READ"
    assert doubt.get_store().list(ME) == []


def test_the_uncorrected_question_never_reaches_the_turn(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """[leak] Only the lines were correctable, but the vision-read ``question`` went into
    ``canvas.equation`` and licensed its numbers as learner-given. An 8 the learner corrected to
    a 3 was still spoken. Now the packet is built from the corrected lines alone."""
    from wobo_gateway import spoken

    reader = FakeReader(
        reading=doubt.Reading(
            "maths",
            "linear equations",
            "Solve 8x + 5 = 20 for x",
            (doubt.Line("r1", "8x + 5 = 20", (0.1, 0.1, 0.9, 0.2)),),
        )
    )
    doubt.set_eyes(doubt.Eyes(screen=FakeScreen(), reader=reader))
    seen: list[dict[str, Any]] = []
    monkeypatch.setattr(
        "wobo_gateway.wobo.board_plan_for", lambda payload, *, live: seen.append(payload)
    )
    out = read(client, auth, words="").json()
    # the reading shown to the learner is the lines, and the question is not a second reading
    assert "8x + 5 = 20" in out["say"] and "Solve" not in out["say"]
    res = answer(client, auth, out["doubt"], lines=[{"id": "r1", "text": "3x + 5 = 20"}])
    assert res.status_code == 200, res.text
    context = seen[0]["context"]
    assert "8x" not in json.dumps(context), context
    assert 8.0 not in spoken.given_numbers(context)
    assert {3.0, 5.0, 20.0} <= spoken.given_numbers(context)
    assert context["canvas"]["equation"] == "3x + 5 = 20"
    assert context["turn"]["lastUserInput"] == doubt.DEFAULT_WORDS


def test_a_page_in_another_script_matches_and_has_its_own_node(
    client: TestClient, auth, monkeypatch
) -> None:
    """[broken] The matcher read only [a-z] and the slug dropped every non-ASCII letter, so a
    Hindi page never matched a syllabus node and every Hindi doubt collapsed into ONE node."""
    from wobo_gateway.curriculum import store as curriculum_store
    from wobo_gateway.curriculum.models import Framework, Node, NodeKind, Version

    assert doubt._match_words("द्विघात समीकरण") == {"द्विघात", "समीकरण"}
    maths = doubt.Reading("गणित", "द्विघात समीकरण", "", LINES)
    science = doubt.Reading("विज्ञान", "प्रकाश का परावर्तन", "", LINES)
    own_maths = doubt.place(ME, maths, None)
    own_science = doubt.place(ME, science, None)
    assert own_maths.node_id != own_science.node_id
    assert own_maths.node_name == "द्विघात समीकरण"

    registry = curriculum_store.InMemoryStore()
    registry.put_framework(Framework(id="cbse-10-hi", name="CBSE कक्षा 10"))
    registry.put_version(Version(id="v1", framework_id="cbse-10-hi", label="2026"))
    registry.put_nodes(
        [
            Node(id="cbse-10-hi:quad", version_id="v1", kind=NodeKind.TOPIC, name="द्विघात समीकरण"),
            Node(id="cbse-10-hi:light", version_id="v1", kind=NodeKind.TOPIC, name="प्रकाश"),
        ]
    )
    registry.put_pin(ME, "cbse-10-hi", "v1")
    monkeypatch.setattr(curriculum_store, "get_store", lambda: registry)
    placed = doubt.place(ME, maths, "cbse-10-hi")
    assert placed.matched and placed.node_id == doubt.topic_node_uuid("cbse-10-hi:quad")


def test_a_figure_is_a_line_of_the_page_and_a_cat_is_not_a_person() -> None:
    """[sloppy] A diagram-only page read as zero lines and was blamed on the photo; a photo that
    is not schoolwork was refused with a line about a person who was not there."""
    assert "figure" in doubt.READ_SYSTEM.lower()
    assert "[figure:" in doubt.READ_SYSTEM
    reading = doubt.reading_from(
        {
            "subject": "science",
            "lines": [{"text": "[figure: a labelled plant cell]", "box": [0, 0, 1, 1]}],
        }
    )
    assert reading.targets[0].text == "[figure: a labelled plant cell]"
    not_a_page = doubt.verdict_from({"page_of_work": False})
    assert "person" not in not_a_page.say
    assert "page of work" in not_a_page.say
    face = doubt.verdict_from({"page_of_work": True, "face": True})
    assert "not a person" in face.say
    assert "figure" in doubt.NOTHING_READ_SAY and "writing" in doubt.NOTHING_READ_SAY


def test_an_answer_with_no_words_draws_nothing(
    client: TestClient, auth, eyes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """[sloppy] Law 5 with an empty say: the shaper skipped the beats and two ink frames landed
    with no say frame at all. Now a mark with no sentence to land on is refused, and counted."""

    def wordless(payload: dict[str, Any], *, live: bool) -> dict[str, Any] | None:
        return {
            "say": "",
            "intents": [],
            "objects": [
                {"id": "ring", "kind": "circle", "anchor": {"target": "r1"}, "pad": 8},
                {"id": "ring2", "kind": "circle", "anchor": {"target": "r2"}, "pad": 8},
            ],
        }

    monkeypatch.setattr("wobo_gateway.wobo.board_plan_for", wordless)
    doubt_id = read(client, auth).json()["doubt"]
    events = frames(answer(client, auth, doubt_id).text)
    assert [e[1] for e in events if e[1] == "ink"] == []
    done = events[-1][2]
    assert any("no words" in r for r in done.get("refused", [])), done


def test_a_correction_the_screen_refuses_is_not_kept(client: TestClient, auth, eyes) -> None:
    """[sloppy] The answer route wrote the learner's corrected lines into the record BEFORE the
    inbound screen ran, so a correction the turn then refused was already in learner.doubts."""
    doubt_id = read(client, auth).json()["doubt"]
    res = answer(client, auth, doubt_id, lines=[{"id": "r2", "text": "my dad hits me"}])
    assert res.status_code == 200
    assert "ink" not in [e[1] for e in frames(res.text)]
    kept = doubt.get_store().get(ME, doubt_id)
    assert [line.text for line in kept.lines][1] == "length 8 cm and breadth 3 cm"
    assert kept.status == "read"


def test_a_long_correction_is_clipped_not_refused(client: TestClient, auth, eyes) -> None:
    """[broken] The client allowed 400 characters a line and the gateway 200, and the gap was a
    raw FastAPI 422 the learner saw as 'trouble'."""
    doubt_id = read(client, auth).json()["doubt"]
    long = "x" * 300
    res = answer(client, auth, doubt_id, lines=[{"id": "r1", "text": long}])
    assert res.status_code == 200, res.text
    kept = doubt.get_store().get(ME, doubt_id)
    assert len(kept.lines[0].text) == doubt.MAX_LINE_CHARS
    # past twice the ceiling it is still one honest refusal in Wobo's voice, never a stack of detail
    res = answer(client, auth, doubt_id, lines=[{"id": "r1", "text": "x" * 900}])
    assert res.status_code == 422
    assert set(res.json()) == {"code", "message"}


def test_a_huge_but_small_file_is_refused_before_its_pixels_exist(
    client: TestClient, auth, eyes
) -> None:
    """[sloppy] The guard was bytes and side length, not pixels: a 200 KB 8000x8000 PNG grew the
    process by about 265 MB before it was downscaled."""
    from PIL import Image

    out = io.BytesIO()
    Image.new("1", (8000, 8000), 1).save(out, "PNG")
    assert len(out.getvalue()) < 300 * 1024
    res = read(client, auth, raw=out.getvalue(), media_type="image/png")
    assert res.status_code == 413 and res.json()["code"] == "image_too_large"
    assert eyes[0].calls == []
    assert 8000 * 5000 <= doubt.MAX_PIXELS < 8000 * 8000


def test_the_bucket_count_is_what_the_bucket_confirmed() -> None:
    """[misread] ``photos`` was the number of paths asked for, never what Storage replied; and
    the sweep listed one page of 1000 while nothing capped a learner's photos."""
    calls: list[tuple[str, str, Any]] = []
    confirmed: list[list[dict[str, str]]] = []

    def request(
        url: str, key: str, method: str, *, body=None, content_type=None, want_rows, profile=True
    ):
        calls.append((method, url, body))
        if method == "DELETE" and "/rest/v1/" in url:
            return [{"id": "a"}]
        if method == "DELETE" and "/storage/v1/object/doubt-photos" in url:
            return confirmed.pop(0) if confirmed else []
        if url.endswith("/storage/v1/object/list/doubt-photos"):
            offset = int(json.loads(body).get("offset") or 0)
            if offset == 0:
                return [{"name": f"p{i}.jpg"} for i in range(1000)]
            if offset == 1000:
                return [{"name": f"p{i}.jpg"} for i in range(1000, 1005)]
            return []
        return []

    store = doubt.PostgrestDoubtStore("https://project.example", "svc", request=request)
    confirmed.append([])
    assert store.forget(ME, "abcdefgh1234") == (1, 0), (
        "an object the bucket did not confirm was counted"
    )
    confirmed.append([{"name": f"{ME}/abcdefgh1234.jpg"}])
    assert store.forget(ME, "abcdefgh1234") == (1, 1)
    calls.clear()
    confirmed.extend([[{"name": "x"}] * 1000, [{"name": "x"}] * 5])
    assert store.forget_all(ME) == (1, 1005)
    listed = [json.loads(c[2]) for c in calls if c[1].endswith("/object/list/doubt-photos")]
    assert [call.get("offset", 0) for call in listed] == [0, 1000]


# --- wave 45, finding 8: keyless eyes never speak a stage direction ------------------------------


def test_keyless_eyes_read_the_learners_own_words_and_never_a_stage_direction() -> None:
    """Keyless, the doubt read spoke a placeholder to the learner: "I read this as: (the page, as
    far as I could read it without my eyes). Is that right? Fix anything I got wrong first." — a
    parenthetical stage direction, read aloud, at both widths (the adversary, 2026-09-09, finding
    8). With no eyes there is nothing on the page Wobo may claim to have read. What it DOES have
    is what the learner typed beside the photo, and that is what it reads back.
    """
    eyes = doubt.MockEyes()
    reading = eyes.read(image=b"", media_type="image/jpeg", words="solve 2x + 5 = 15")
    said = reading.say()
    assert "without my eyes" not in said
    assert "(" not in said and ")" not in said
    assert "solve 2x + 5 = 15" in said
    # A LINE WITH NO BOX IS NEVER AN ANCHOR. The one region it used to return covered 80% of the
    # photo, so the single ring Wobo drew went round the whole page.
    assert reading.lines and all(line.box is None for line in reading.lines)
    assert reading.targets == ()


def test_keyless_eyes_with_no_words_say_they_cannot_see_rather_than_blame_the_photo() -> None:
    eyes = doubt.MockEyes()
    reading = eyes.read(image=b"", media_type="image/jpeg", words="")
    assert reading.lines == ()
    assert reading.say() == doubt.NO_EYES_SAY
    assert "brighter photo" not in reading.say()


# --- wave 46, finding 4: a learner never waits ninety seconds for a refusal ----------------------


def test_the_whole_read_has_a_wall_clock_and_says_so_when_it_runs_out() -> None:
    """Finding 4, 2026-09-09. Live, the doubt door was one photo in three: the maths page read
    correctly in 15 949 ms, the diagram photo refused with a 503 after 5 849 ms, and the history
    photo returned 422 after the learner had waited 90 021 ms.

    Every model call on this path carries its own deadline. THE DOOR CARRIES NONE, so the screen,
    the re-screen and the read each spend their own and the learner pays the sum. INK-FOUR does not
    have a clause for a minute and a half; nothing in this product does.
    """

    class Passes:
        def screen(self, *, image: bytes, media_type: str) -> doubt.ImageVerdict:
            return doubt.ImageVerdict(allowed=True)

    class NeverReached:
        def read(self, *, image: bytes, media_type: str, words: str):  # noqa: ANN202
            raise AssertionError("the read must not be started with no time left")

    with pytest.raises(doubt.DoubtRefused) as caught:
        doubt.read_doubt(
            subject="learner-1",
            raw=photo_bytes(),
            media_type="image/jpeg",
            words="",
            framework_id=None,
            eyes=doubt.Eyes(screen=Passes(), reader=NeverReached()),
            store=doubt.InMemoryDoubtStore(),
            budget_s=0.0,
        )
    assert caught.value.code == "photo_slow"
    assert caught.value.status == 503
    # a line a learner can act on, in the register: no machinery, no blame on the photograph
    assert "?" in caught.value.message or caught.value.message.endswith(".")
    for machinery in ("timeout", "deadline", "budget", "503"):
        assert machinery not in caught.value.message.lower()


def test_each_call_is_given_only_the_time_that_is_left() -> None:
    """The budget is not a stopwatch the door reads after the fact: what is left is handed to the
    next call, so a chain of fallbacks cannot spend more than the door has."""
    reader = doubt.LiveReader()
    assert reader.timeout_s > 5.0
    assert reader.with_seconds(5.0).timeout_s == 5.0
    # and it only ever narrows: a door with time to spare does not lengthen a call's own deadline
    assert reader.with_seconds(10_000.0).timeout_s == reader.timeout_s
    screen = doubt.LiveImageScreen()
    assert screen.with_seconds(3.0).timeout_s == 3.0

    # the whole door fits inside its own wall clock, worst case
    worst = doubt.LiveImageScreen().timeout_s * 2 + doubt.LiveReader().timeout_s
    assert worst >= doubt.DOUBT_BUDGET_S


# --- the door is not a coin toss: neither vision call may think its answer away -------------------
#
# THE MEASUREMENT THIS SECTION WAS WRITTEN FROM (live on Luna/Flash, 2026-09-10, the lab's own
# three photographs through POST /v1/doubt on a pinned ladder):
#
#   history.jpg  422 nothing_read after 15 265 ms
#     doubt.read  finish='length'  completion=1496 of 1500  REASONING=1304  text=192
#     the content was a correct read of the page — "subject": "History", "topic": "The Revolt of
#     1857", the question, and three whole lines with their boxes — cut off mid-object. json.loads
#     refused it, _extract_json returned {}, and the learner was told their PHOTOGRAPH was bad.
#   math.jpg and diagram.jpg  503 photo_outage after 4014 ms and 4432 ms
#     doubt.screen  finish='length'  completion=200 of 200  REASONING=200  body=''
#     not one character of the four booleans came out; screen_image fails closed, correctly, and
#     refused two photographs that were perfectly good pages of work.
#   the one screen that passed that day spent 65 of its 200 tokens thinking. That is the whole
#   difference between a door that opens and a door that does not: how long the model felt like
#   thinking about a photograph of a textbook.
#
# Neither call is a puzzle. One reads four booleans off a picture; the other transcribes a page.
# ``plexus/engines.py`` already carries this exact lesson above ``_MAX_TOKENS`` — "reasoning tokens
# count against max_tokens, so a tight budget gets exhausted mid-thought and returns EMPTY content
# — which parses to {}". The doubt door was the one place it had not been applied.


def _reader_response(content: str) -> Any:
    class Message:
        pass

    message = Message()
    message.content = content

    class Choice:
        pass

    choice = Choice()
    choice.message = message

    class Response:
        pass

    response = Response()
    response.choices = [choice]
    response.usage = None
    return response


def _capture(monkeypatch: pytest.MonkeyPatch, content: str) -> list[dict[str, Any]]:
    sent: list[dict[str, Any]] = []

    def complete(**kwargs: Any) -> Any:
        sent.append(kwargs)
        return _reader_response(content)

    monkeypatch.setattr("wobo_gateway.model_call.complete", complete)
    monkeypatch.setattr("wobo_gateway.telemetry.record_cost", lambda **kw: None)
    return sent


#: The history page as it actually came back on 2026-09-10, cut off by the output cap mid-object.
TRUNCATED = """```json
{
  "subject": "History",
  "topic": "The Revolt of 1857",
  "question": "Answer the questions regarding the sepoy march to Delhi.",
  "lines": [
    {
      "text": "3.2 The Revolt Begins",
      "box": [0.11, 0.10, 0.48, 0.13]
    },
    {
      "text": "The revolt of 1857 began at Meerut on 10 May 1857, when",
      "box": [0.12, 0.16, 0.81, 0.18]
    },
    {
      "text": "sepoys of the Bengal Army rose against their British",
"""


def test_a_read_that_ran_out_of_room_is_read_as_far_as_it_got(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """[wrong] Wave 42 finding 11. The reader read the page correctly and was cut off by the output
    cap; every word of it was dropped and the learner was told to take a straighter, brighter
    photograph. An answer is never thrown away: the lines that ARE closed are the reading."""
    _capture(monkeypatch, TRUNCATED)
    reading = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    assert reading.how == "repaired"
    assert reading.subject == "History" and reading.topic == "The Revolt of 1857"
    assert [line.text for line in reading.lines] == [
        "3.2 The Revolt Begins",
        "The revolt of 1857 began at Meerut on 10 May 1857, when",
    ]
    # and they are TARGETS: a repaired line keeps the box the reader gave it, so ink may anchor
    assert reading.targets[0].box == (0.11, 0.1, 0.48, 0.13)
    assert "straighter" not in reading.say() and reading.say().startswith("I read this as")


def test_a_page_written_out_in_prose_is_a_reading_with_nothing_to_anchor_to(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A vision model asked for JSON sometimes writes the page out instead. That is the page, and
    it is kept as text the learner can correct — with NO box, so law 3 still forbids a mark on it
    (an anchor needs a rect), and nothing is ringed on a page nobody placed."""
    _capture(monkeypatch, "Ex 2.3 Q4\nSolve: 3x + 5 = 20\n3x = 20 + 5")
    reading = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    assert reading.how == "prose"
    assert [line.text for line in reading.lines] == [
        "Ex 2.3 Q4",
        "Solve: 3x + 5 = 20",
        "3x = 20 + 5",
    ]
    assert reading.targets == () and reading.unplaced == 3


def test_the_reader_saying_nothing_is_not_the_photograph_saying_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """[wrong] The split builder 2 named and did not build. Three different things arrived at ONE
    sentence about the photograph. Only one of them is about the photograph."""
    _capture(monkeypatch, "")
    mute = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    assert mute.how == "mute" and mute.lines == ()
    assert mute.say() == doubt.NO_ANSWER_SAY
    for blame in ("photo", "brighter", "straighter", "figure"):
        assert blame not in doubt.NO_ANSWER_SAY.lower()

    # the reader that WILL not read is not the page that has nothing on it either
    _capture(monkeypatch, "I'm sorry, I can't identify people in this image.")
    declined = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    assert declined.how == "mute" and declined.lines == ()

    # and the one case the old sentence was always true of keeps it
    looked = doubt.reading_from({"subject": "maths", "lines": []})
    assert looked.how == "read" and looked.say() == doubt.NOTHING_READ_SAY


def test_a_mute_reader_is_refused_as_a_reader_and_never_as_a_bad_page(
    client: TestClient, auth
) -> None:
    """On the wire: the code an operator greps and the app switches on says which of the two it
    was. A page that was looked at and had nothing on it is still 422 nothing_read."""
    doubt.set_eyes(
        doubt.Eyes(
            screen=FakeScreen(),
            reader=FakeReader(reading=doubt.Reading("", "", "", (), how="mute")),
        )
    )
    res = read(client, auth)
    assert res.status_code == 503 and res.json()["code"] == "reader_mute"
    assert res.json()["message"] == doubt.NO_ANSWER_SAY
    assert doubt.get_store().list(ME) == []

    doubt.set_eyes(
        doubt.Eyes(screen=FakeScreen(), reader=FakeReader(reading=doubt.Reading("", "", "", ())))
    )
    res = read(client, auth)
    assert res.status_code == 422 and res.json()["code"] == "nothing_read"
    assert res.json()["message"] == doubt.NOTHING_READ_SAY


def test_a_clean_crop_is_not_screened_a_second_time(client: TestClient, auth) -> None:
    """[slow] Wave 42 finding 4. The door screened EVERY crop twice. The second look is what
    catches a crop that failed to leave someone's details behind, and that is the only thing it
    can catch: when the screen found no details at all, the crop is a subregion of a frame it has
    just certified — no face, no details, a page of work — and a crop can only take things away.
    The call bought nothing and cost the learner about two seconds and one more chance to fail
    closed. The details path still gets its second look (test_personal_details_keep_only_the_work,
    test_a_re_screen_that_still_finds_details_refuses)."""
    screen = FakeScreen(
        verdicts=[
            # the work is only part of the frame, and there is nothing on it that should not be
            doubt.verdict_from(
                {"page_of_work": True, "personal_details": False, "work_box": [0, 0.2, 1, 1]}
            )
        ]
    )
    reader = FakeReader()
    doubt.set_eyes(doubt.Eyes(screen=screen, reader=reader))
    res = read(client, auth)
    assert res.status_code == 200
    assert len(screen.calls) == 1, "a crop with nothing to hide was screened twice"
    # and the CROP is what was read and kept, not the whole frame the screen was shown
    whole = doubt.prepare_image(photo_bytes(), media_type="image/jpeg")
    assert reader.calls and reader.calls[0][0] < len(whole.data)
    assert doubt.get_store().photo(ME, res.json()["doubt"]) is not None


def test_half_a_json_object_is_never_read_out_as_the_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The second live history read on 2026-09-10 was cut off BEFORE its first line object: a
    subject, a topic, a question and the word "lines". There is nothing to repair there, and the
    prose reader must not take the braces and the field names for the page — a learner asked "is
    that right?" about {, "subject": "History", is being shown the machine, not their book."""
    _capture(
        monkeypatch,
        '```json\n{\n  "subject": "History",\n  "topic": "The Revolt of 1857",\n'
        '  "question": "Why did the sepoys march to Delhi?",\n  "lines":',
    )
    reading = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    assert reading.how == "mute" and reading.lines == ()
    assert reading.say() == doubt.NO_ANSWER_SAY


# --- the read is RIGHT, not merely 200 (wave 42's judge, finding 1) -------------------------------

#: The maths page as it actually came back on 2026-09-10 with the reader forbidden to think, on
#: all THREE of the five live runs that read at all (the other two refused).
#: turns/doubt/w54-live-math-390{,-r3,-r5}. The page has SIX lines; four came back. Gone are
#: "Solve: 3x + 5 = 20" — filed under ``question`` as a paraphrase and left out of the working —
#: and "3x = 20 + 5 ?", the learner's own step 1, which is the one line the sign error is on.
#: With thinking ON the same photo read all six, twice (w44, w47).
THINNED = json.dumps(
    {
        "subject": "Math",
        "topic": "Algebra",
        "question": "Solve the equation 3x + 5 = 20.",
        "lines": [
            {"text": "Ex 2.3 Q4", "box": [0.16, 0.10, 0.36, 0.12]},
            {"text": "3x = 25", "box": [0.16, 0.37, 0.36, 0.40]},
            {"text": "x = 25/3", "box": [0.16, 0.45, 0.36, 0.48]},
            {"text": "x = 8.33", "box": None},
        ],
    }
)
#: What the learner typed beside that photograph.
ASKED = "Is my step 2 right? I am not sure about the +5"


def test_the_screen_may_not_think_and_the_reader_must(monkeypatch: pytest.MonkeyPatch) -> None:
    """[broken] Wave 42's judge, finding 1. Forbidding BOTH vision calls to think fixed the wrong
    half. Four booleans off a picture is not a puzzle and the screen keeps :data:`NO_THINKING`;
    transcribing a page IS one, and a reader told to spend nothing on looking skims it. Five live
    runs of the same maths photo, ladder pinned: three read, and all three returned four of six
    lines and then told the learner the wrong step was right. The truncation that was used to
    justify the ban is already repaired in this file (:func:`_repaired`), and a read that is short
    and says so is a smaller defect than a read that is short and signed."""
    sent = _capture(monkeypatch, '{"page_of_work": true}')
    doubt.LiveImageScreen().screen(image=b"\xff\xd8jpeg", media_type="image/jpeg")
    doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    assert [call.get("reasoning_effort") for call in sent] == [doubt.NO_THINKING, doubt.READ_EFFORT]
    assert doubt.READ_EFFORT != doubt.NO_THINKING
    # both values are ones EVERY rung of every doubt chain accepts: litellm maps them onto
    # Gemini's thinkingConfig and OpenAI takes them by name. A value only one vendor knows would
    # 400 the fallback the moment the primary went out.
    assert {doubt.NO_THINKING, doubt.READ_EFFORT} <= {"minimal", "low", "medium", "high"}


def test_the_page_s_own_equation_is_never_lost_to_the_question_field(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """[broken] The equation a page asks about is a LINE of that page. ``question`` is a summary
    of it, not a replacement for it, and a reader that files it there and nowhere else hands the
    tutor a working that begins "3x = 25" with nothing for the 25 to have come from. All three
    live reads then affirmed it. It comes back with NO box (nobody placed it, so law 3 still
    forbids a mark on it) and in reading order, before the working it sets up."""
    _capture(monkeypatch, THINNED)
    reading = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words=ASKED)
    assert [line.text for line in reading.lines] == [
        "Ex 2.3 Q4",
        "Solve the equation 3x + 5 = 20.",
        "3x = 25",
        "x = 25/3",
        "x = 8.33",
    ]
    restored = reading.lines[1]
    assert restored.box is None and restored not in reading.targets


def test_a_question_that_is_about_the_page_is_not_written_onto_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other half of the same law. A history page's "Why did the sepoys march to Delhi?" is a
    question ABOUT the page; putting it back would write a line nobody wrote, and law 1 would then
    read it out and ask a child "is that right?" about Wobo's own sentence."""
    _capture(
        monkeypatch,
        json.dumps(
            {
                "subject": "History",
                "topic": "The Revolt of 1857",
                "question": "Why did the sepoys march to Delhi?",
                "lines": [{"text": "3.2 The Revolt Begins", "box": [0.1, 0.1, 0.5, 0.13]}],
            }
        ),
    )
    reading = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    assert [line.text for line in reading.lines] == ["3.2 The Revolt Begins"]
    # nor is a question whose numbers are all on the page already: it is the same line, said twice
    _capture(
        monkeypatch,
        json.dumps(
            {
                "question": "Solve: 3x + 5 = 20",
                "lines": [{"text": "Solve: 3x + 5 = 20", "box": [0.1, 0.1, 0.5, 0.13]}],
            }
        ),
    )
    again = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words="")
    assert [line.text for line in again.lines] == ["Solve: 3x + 5 = 20"]


def test_a_reading_that_misses_what_the_learner_pointed_at_says_so(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """[broken] "I am not sure about the +5" and not one line read carries a +5. Three live runs
    answered "Step 2 is right" over exactly that. A reading that does not contain the thing the
    learner is asking about is KNOWN to be short, and law 1 is the place to say so: the learner
    sees the gap before a single number is computed."""
    # The same four lines with no question to put back: nothing on them carries a +5.
    thinner = json.loads(THINNED)
    thinner.pop("question")
    reading = doubt.reading_from(thinner, words=ASKED)
    assert reading.missing == ("+5",) and reading.short
    say = reading.say()
    assert "+5" in say and say.endswith("Is that right? Fix anything I got wrong first.")
    assert "I could not find the +5 in what I read" in say

    # "step 2" is a place in the working, not a term of it. A bare integer is never flagged, or
    # every reading ever made would be short: "Q4", "part 3", "in 1857".
    plain = doubt.reading_from(thinner, words="Is my step 2 right? Q4 part 3 in 1857")
    assert plain.missing == () and not plain.short

    # nor is a hyphen that joins two things a minus sign; a sign has to stand on its own
    assert doubt.unaccounted(["3x = 25"], "is step-2 right, and lines 1-3?") == ()
    assert doubt.unaccounted(["3x = 25"], "I am not sure about the -5") == ("-5",)

    # and when the page's own equation IS put back, the +5 is accounted for: the learner is not
    # told a line is missing when Wobo has it. That is the whole point of the restore.
    _capture(monkeypatch, THINNED)
    whole = doubt.LiveReader().read(image=b"\xff\xd8jpeg", media_type="image/jpeg", words=ASKED)
    assert whole.missing == () and not whole.short
    assert "3x + 5 = 20" in " ".join(line.text for line in whole.lines)


def test_wobo_counts_the_lines_it_did_not_read_out_in_english() -> None:
    """[ugly] Live on 2026-09-10, three reads in five split the page's stray "?" onto a line of
    its own and law 1's sentence ended "and 1 more lines". Seven lines is the first page that
    reaches it, and a page of working reaches it often."""
    seven = tuple(doubt.Line(f"r{i}", f"line {i}", None) for i in range(1, 8))
    assert doubt.Reading("", "", "", seven).say().count("and 1 more line.") == 1
    eight = (*seven, doubt.Line("r8", "line 8", None))
    assert "and 2 more lines." in doubt.Reading("", "", "", eight).say()


def test_the_working_handed_to_the_answer_starts_at_the_equation(client: TestClient, auth) -> None:
    """[broken] ``canvas.equation`` is what the CAS grounding is given, and it was the FIRST line
    of the page — "Ex 2.3 Q4", an exercise number. The relation is the equation; a heading is not.
    And when the reading is known short, the packet says which words are not in it, so the answer
    cannot sign off on working it never saw."""
    lines = (
        doubt.Line("r1", "Ex 2.3 Q4", (0.16, 0.10, 0.36, 0.12)),
        doubt.Line("r2", "3x = 25", (0.16, 0.37, 0.36, 0.40)),
        doubt.Line("r3", "x = 25/3", (0.16, 0.45, 0.36, 0.48)),
    )
    doubt.set_eyes(
        doubt.Eyes(
            screen=FakeScreen(),
            reader=FakeReader(reading=doubt.Reading("Math", "Algebra", "", lines)),
        )
    )
    res = read(client, auth, words=ASKED)
    assert res.status_code == 200, res.text
    kept = doubt.get_store().get(ME, res.json()["doubt"])
    assert kept is not None
    payload = doubt.turn_payload(kept, ASKED)
    assert payload["context"]["canvas"]["equation"] == "3x = 25"
    assert "+5" in str(payload["context"]["page"]["state"].get("couldNotRead"))


def test_the_learner_is_told_when_the_reading_was_cut_off(client: TestClient, auth) -> None:
    """[wrong] The route rebuilt a fresh ``Reading`` from the stored record to write law 1's
    sentence, so ``how`` was "read" every time and the repaired reading's own clause — "I may not
    have got to the end of the page" — could never reach the wire. The honesty was written and
    never said."""
    doubt.set_eyes(
        doubt.Eyes(
            screen=FakeScreen(),
            reader=FakeReader(reading=doubt.Reading("maths", "", "", LINES, how="repaired")),
        )
    )
    res = read(client, auth)
    assert res.status_code == 200, res.text
    assert "I may not have got to the end of the page." in res.json()["say"]


def test_a_screen_that_answers_nothing_is_asked_once_more_before_the_door_shuts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """[broken] Two of five live runs of a perfectly good maths page refused ``photo_outage``
    after 2828 ms and 3334 ms, with a ``doubt.screen`` row charged and no ``doubt.read`` row: the
    screen answered with an EMPTY body and :func:`safety.screen_image` failed closed, correctly.
    An empty body is not a verdict — it is the checker not running — and the door spends a
    learner's whole turn on it. It is asked once more, on the rung behind, before it shuts."""
    bodies = ["", '{"page_of_work": true}']
    sent: list[dict[str, Any]] = []

    def complete(**kwargs: Any) -> Any:
        sent.append(kwargs)
        return _reader_response(bodies[min(len(sent) - 1, len(bodies) - 1)])

    monkeypatch.setattr("wobo_gateway.model_call.complete", complete)
    monkeypatch.setattr("wobo_gateway.telemetry.record_cost", lambda **kw: None)
    verdict = doubt.LiveImageScreen().screen(image=b"\xff\xd8jpeg", media_type="image/jpeg")
    assert verdict.allowed and len(sent) == 2
    assert sent[1]["model"] != sent[0]["model"], "the second look went to the same rung"

    # and two non-answers is still an outage: the photo is never kept on a screen that never ran
    sent.clear()
    bodies[:] = ["", ""]
    with pytest.raises(ValueError):
        doubt.LiveImageScreen().screen(image=b"\xff\xd8jpeg", media_type="image/jpeg")
    assert len(sent) == 2


# --- the wall clock: nothing a learner waits on waits for what it does not need -------------------


def test_the_photo_goes_up_while_the_reader_is_still_reading(client: TestClient, auth) -> None:
    """[slow] The door's wall clock was the SUM of three waits, and one of them was needless.

    Live on 2026-09-15, the same maths page three times (``w60j/logs/gateway-live60.log``):
    ``POST /v1/doubt`` took 12 249.8, 10 511.9 and 10 958.1 ms, and the gateway's own timestamps
    split each one into the screen (1.77 to 2.22 s), the read (8.19 to 9.18 s) and a tail after
    the read of 763, 370 and 449 ms that is almost all :meth:`DoubtStore.put` — an object upload
    and a row insert, two round trips to the project, with the learner watching a spinner.

    The ROW needs the reading. The OBJECT does not: the bytes are final and screened the moment
    the verdict allows, and the bucket path is the learner's id and the doubt's id, neither of
    which the reader has any say in. So the photo goes up WHILE the reader reads, and the door
    pays ``max(read, upload)`` instead of ``read + upload``.

    Order, not a stopwatch, is the proof: the reader is asked, and it does not come back until
    the bucket has the photo. Which of the two starts first is a race and is not asserted; that
    the photo is up BEFORE the reader finishes is the law, and it was false before this.
    """
    import threading

    order: list[str] = []
    up = threading.Event()

    class Watching(doubt.InMemoryDoubtStore):
        def put(self, d: doubt.Doubt, photo: bytes) -> doubt.Doubt:
            order.append("photo")
            up.set()
            return super().put(d, photo)

        def keep_photo(self, subject_id: str, doubt_id: str, photo: bytes) -> None:
            order.append("photo")
            up.set()
            super().keep_photo(subject_id, doubt_id, photo)

    class Waiting(FakeReader):
        def read(self, *, image: bytes, media_type: str, words: str) -> doubt.Reading:
            order.append("read-start")
            up.wait(2.0)
            order.append("read-end")
            return super().read(image=image, media_type=media_type, words=words)

    doubt.set_store(Watching())
    doubt.set_eyes(doubt.Eyes(screen=FakeScreen(), reader=Waiting()))
    try:
        res = read(client, auth)
        assert res.status_code == 200, res.text
        assert "photo" in order, "the photo never went up while the reader was reading"
        assert order.index("photo") < order.index("read-end"), order
        assert order[-1] == "read-end", order
        out = res.json()
        assert doubt.get_store().photo(ME, out["doubt"])
        assert doubt.get_store().get(ME, out["doubt"]) is not None
    finally:
        doubt.set_store(None)


def test_a_read_that_fails_after_the_photo_went_up_leaves_nothing_in_the_bucket(
    client: TestClient, auth
) -> None:
    """[slow] The other half of the same law: a photo kept early is a photo that must be taken
    back. A reader that falls over, and a page nothing could be read off, both refuse — and
    neither leaves an object behind with no row pointing at it."""
    store = doubt.InMemoryDoubtStore()
    doubt.set_store(store)
    try:
        doubt.set_eyes(doubt.Eyes(screen=FakeScreen(), reader=FakeReader(raises=True)))
        assert read(client, auth).status_code == 503
        assert store.list(ME) == [] and store.photos_held() == 0

        doubt.set_eyes(
            doubt.Eyes(
                screen=FakeScreen(),
                reader=FakeReader(reading=doubt.Reading("maths", "", "", ())),
            )
        )
        assert read(client, auth).status_code == 422
        assert store.list(ME) == [] and store.photos_held() == 0
    finally:
        doubt.set_store(None)


def test_the_answer_reaches_the_learner_before_the_bookkeeping_is_written(
    auth, eyes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """[slow] The learner's first word waited on two writes that are nothing to do with it.

    Live on 2026-09-15, all three doubts: the board call finished and the last voice line was
    dispatched at 26.515, 06.886 and 57.215, and the request handler did not return until
    26.831, 07.200 and 57.540 — 316, 314 and 325 ms in which nothing was logged because nothing
    was happening but :func:`join_the_climb` (a write to the mind) and ``store.update`` (a write
    to the row), one after the other, over the wire. A streamed turn's first frame cannot leave
    until the handler returns, so that is 316 ms added to a first word that was already 5.6 to
    7.8 s late (``w60j/turns/doubt/w60-live-doubt-*/turn.json``, ``firstSaidAtMs``).

    Neither write is the answer. They say the answer HAPPENED. So they go behind it, as the
    response's background, which Starlette runs after the last byte is sent and runs even when
    the learner has walked away mid-stream — nothing is lost, and nothing waits.
    """
    from wobo_gateway import mind
    from wobo_gateway.app import Gateway, create_app
    from wobo_gateway.cache import InMemoryCache
    from wobo_gateway.providers import MockProvider
    from wobo_gateway.telemetry import MetricsSink

    order: list[str] = []

    class Filing(doubt.InMemoryDoubtStore):
        def update(self, d: doubt.Doubt) -> doubt.Doubt:
            order.append("filed")
            return super().update(d)

    doubt.set_store(Filing())
    inner = create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink()))

    async def watched(scope: Any, receive: Any, send: Any) -> None:
        async def _send(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.body" and not message.get("more_body"):
                order.append("delivered")
            await send(message)

        await inner(scope, receive, _send)

    client = TestClient(watched)
    try:
        doubt_id = read(client, auth).json()["doubt"]
        order.clear()
        res = answer(client, auth, doubt_id)
        assert res.status_code == 200, res.text
        assert order == ["delivered", "filed"], order
        # and the bookkeeping still happened: the climb, the status, both
        assert mind.get_store().get(ME) is not None
        kept = doubt.get_store().get(ME, doubt_id)
        assert kept is not None and kept.status == "answered" and kept.answered_at
    finally:
        doubt.set_store(None)


def test_the_bookkeeping_still_lands_when_the_learner_walks_away_mid_answer(auth, eyes) -> None:
    """[slow] The other half of putting the writes behind the answer: behind must not mean lost.

    The app is driven directly, with a receive channel that hangs up the moment the request is
    read and a send channel that refuses the first body chunk the way a closed socket does. The
    turn ends in an exception, as it would on a real hang-up — and the record still holds the
    climb and the answered row, exactly as it did when the two writes stood in front of the
    learner. Behind is not lost.
    """
    import asyncio

    from wobo_gateway import mind
    from wobo_gateway.app import Gateway, create_app
    from wobo_gateway.cache import InMemoryCache
    from wobo_gateway.providers import MockProvider
    from wobo_gateway.telemetry import MetricsSink

    client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
    doubt_id = read(client, auth).json()["doubt"]
    app = create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink()))
    token = auth(ME)["Authorization"]

    async def hang_up() -> list[str]:
        sent: list[str] = []
        gone = asyncio.Event()

        async def receive() -> dict[str, Any]:
            if not gone.is_set():
                gone.set()
                return {"type": "http.request", "body": b"{}", "more_body": False}
            return {"type": "http.disconnect"}

        async def send(message: dict[str, Any]) -> None:
            sent.append(message["type"])
            if message["type"] == "http.response.body":
                raise OSError("the learner is gone; nothing more can be written")

        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": f"/v1/doubt/{doubt_id}/answer",
            "raw_path": f"/v1/doubt/{doubt_id}/answer".encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [
                (b"host", b"testserver"),
                (b"authorization", token.encode()),
                (b"accept", b"text/event-stream"),
                (b"content-type", b"application/json"),
                (b"content-length", b"2"),
            ],
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
        }
        with contextlib.suppress(BaseException):
            await app(scope, receive, send)
        return sent

    wrote = asyncio.run(hang_up())
    # the hang-up really bit: the stream started and its first chunk was refused
    assert wrote == ["http.response.start", "http.response.body"], wrote
    assert mind.get_store().get(ME) is not None, "the climb was never joined"
    kept = doubt.get_store().get(ME, doubt_id)
    assert kept is not None and kept.status == "answered" and kept.answered_at
