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
    assert len(say_at) == 3 and ink
    assert all(e["t"] in say_at for e in ink), [(e["object"]["id"], e["t"]) for e in ink]
    beats = {e["object"]["id"]: e["object"]["meta"]["beat"] for e in ink}
    assert beats["note"] == {"after": 1}  # the model's own beat, untouched
    assert beats["ring"] == {"with": 0}  # the first stroke is on the first sentence
    assert all(set(b) & {"with", "after"} for b in beats.values())
    # and the first stroke starts with the first sentence, not after it
    first_say = next(e[2] for e in events if e[1] == "say")
    assert min(e["t"] for e in ink) == first_say["t"]


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
    assert sent[0]["model"] == "openai/gpt-5.6-terra"
    assert sent[0]["fallbacks"] == ["anthropic/claude-opus-5", "gemini/gemini-2.5-flash"]
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
