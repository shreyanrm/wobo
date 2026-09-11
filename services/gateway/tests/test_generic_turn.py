"""The generic-turn door: what may be written once, and what must never be.

THE TWO FAILURES THIS FILE EXISTS TO MAKE IMPOSSIBLE, in the order they matter:

1. **One child's life reaching another child's screen.** A turn whose packet carries a mind item,
   an interest, a parent-offered fact, this learner's own working or the region they circled is
   never written and never read. Every one of those is a test below, and each of them asserts on
   the ROW that was or was not written rather than on a boolean, because a door that returns False
   and writes anyway is the bug.
2. **A cached plan pointing at nothing.** A stored ink plan names semantic targets. On a screen
   that does not carry one of them the whole plan is declined and the turn goes live, because a
   plan that half lands is a pointer at nothing wearing a plan's clothes (BOARD.md §11).

And the reason to take that risk at all, also asserted: the money. A generic turn served from the
store is a `wobo.turn` model call that did not happen, and `content.turns` remembers what the one
that did happen cost.
"""

from __future__ import annotations

from typing import Any

import pytest
from store_fakes import FakePostgrest
from wobo_gateway import generic_turn
from wobo_gateway.plexus import db


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakePostgrest:
    monkeypatch.delenv("PLEXUS_STORES", raising=False)
    transport = FakePostgrest()
    db.reset()
    db.configure(base_url="https://db.test", service_key="service-role", transport=transport)
    yield transport
    db.reset()


def packet(**context: Any) -> dict[str, Any]:
    """A plain, impersonal turn: a question asked at a level, and nothing about who asked it."""
    base: dict[str, Any] = {
        "turn": {"lastUserInput": "What is a prime number?"},
        "curriculum": {
            "board": "CBSE",
            "grade": "Class 6",
            "subject": "Mathematics",
            "nodeName": "Prime numbers",
        },
        "page": {"route": "course"},
    }
    base.update(context)
    return {"context": base}


ANSWER = {
    "say": "A prime number has exactly two factors: one and itself.",
    "actions": [],
    "path": "explain",
    "grounded": False,
    "verified": [],
}


# --- 1. the personal-context exclusion --------------------------------------------------------


def test_a_plain_question_at_a_level_is_generic() -> None:
    assert generic_turn.why_not_generic(packet()) == []
    assert generic_turn.is_generic(packet()) is True


@pytest.mark.parametrize(
    ("block", "value"),
    [
        ("mind", [{"item": "struggles with fractions"}]),
        ("machine", {"progress": {"level": 4, "streakDays": 9}}),
        ("canvas", {"equation": "2*x + 3 = 7", "steps": ["2*x = 4"]}),
        ("focuses", [{"id": "fig-1-effect"}]),
        ("session", {"id": "s-1", "startedAt": "2026-09-10T09:00:00Z"}),
        ("history", [{"role": "user", "text": "and before that?"}]),
        ("learner", {"id": "abc"}),
    ],
)
def test_a_packet_carrying_a_person_is_never_stored(
    fake: FakePostgrest, block: str, value: Any
) -> None:
    """A MIND ITEM IN THE PACKET MEANS NO STORE. The assertion is on the table, not on the return
    value: a door that says no and writes anyway is the whole failure."""
    payload = packet(**{block: value})
    assert generic_turn.why_not_generic(payload), f"{block} was judged impersonal"
    assert generic_turn.save(payload, ANSWER) is False
    assert fake.all_rows("turns") == [], f"a turn carrying {block!r} was written"


@pytest.mark.parametrize(
    "field",
    ["interests", "facts", "parentFacts", "twinSummary", "masteryHighlights", "language"],
)
def test_a_dossier_that_says_who_this_child_is_is_never_stored(
    fake: FakePostgrest, field: str
) -> None:
    """These are exactly the fields `wobo._dossier` renders into the prompt, so a turn carrying
    one was answered FOR that child. `language` is here too: an answer taught in Kannada is not
    the answer to serve a learner reading English."""
    payload = packet(lifetime={"learner": {"name": "Learner-A"}, field: ["cricket"]})
    assert generic_turn.save(payload, ANSWER) is False
    assert fake.all_rows("turns") == []


def test_a_dossier_of_only_a_name_and_a_level_is_still_generic(fake: FakePostgrest) -> None:
    """Otherwise nothing would ever cache: every signed-in learner has a name and a class. The
    name is handled by being stitched rather than stored — see the section below."""
    payload = packet(lifetime={"learner": {"name": "Learner-A", "age": 11, "grade": "Class 6"}})
    assert generic_turn.why_not_generic(payload) == []


def test_a_first_meeting_is_never_stored(fake: FakePostgrest) -> None:
    """A welcome is by definition about one person arriving."""
    payload = packet()
    payload["first_meeting"] = True
    assert generic_turn.save(payload, ANSWER) is False
    payload = packet(turn={"lastUserInput": "hello", "firstMeeting": True})
    assert generic_turn.save(payload, ANSWER) is False
    assert fake.all_rows("turns") == []


def test_a_block_nobody_has_classified_is_personal_until_somebody_says_otherwise(
    fake: FakePostgrest,
) -> None:
    """The allow-list is the design. The failure mode of forgetting to classify a new field here
    is a cache miss; the failure mode of a deny-list forgetting one is a leak."""
    payload = packet(companion={"parentNotes": "she is anxious about tests"})
    reasons = generic_turn.why_not_generic(payload)
    assert reasons == ["the packet carries 'companion', which nothing has declared impersonal"]
    assert generic_turn.save(payload, ANSWER) is False


def test_the_same_exclusion_gates_the_READ_and_not_only_the_write(fake: FakePostgrest) -> None:
    """A learner with their own working on the page must get an answer about THEIR working, not
    the stock one — even though the stock one is sitting right there in the store."""
    assert generic_turn.save(packet(), ANSWER) is True
    with_working = packet(canvas={"equation": "2*x + 3 = 7", "steps": ["2*x = 5"]})
    assert generic_turn.load(with_working) is None
    assert generic_turn.load(packet()) is not None


def test_the_key_carries_no_personal_context_at_all() -> None:
    """The key is the normalised question x board x grade x subject x concept x age.

    The NAME is not in it, and that is the whole of ``NAME_SLOT``: a name is stitched at serve
    time, so two children with different names share one row. The AGE is in it as of 2026-09-10,
    and that is a correction: it was allowed through the door on the claim that it was part of the
    level and therefore already in the key, and it was not. Nothing strips an age out of a
    sentence the way a name is stripped, so the row is keyed on it instead
    (``test_generic_turn_gate.py``)."""
    bare = generic_turn.key_for(packet())
    named = generic_turn.key_for(packet(lifetime={"learner": {"name": "Learner-A"}}))
    renamed = generic_turn.key_for(packet(lifetime={"learner": {"name": "Learner-B"}}))
    assert bare == named == renamed
    aged = generic_turn.key_for(packet(lifetime={"learner": {"name": "Learner-A", "age": 11}}))
    assert aged != bare


def test_a_different_class_is_a_different_answer() -> None:
    """Wave 30's whole finding, kept: a class 6 child and a class 11 student asking the same words
    are not asking the same question."""
    six = generic_turn.key_for(packet())
    eleven = packet()
    eleven["context"]["curriculum"]["grade"] = "Class 11"
    assert six != generic_turn.key_for(eleven)


def test_one_question_spelled_three_ways_is_one_row(fake: FakePostgrest) -> None:
    """Keying "What is a prime number?" apart from "what is a prime number" would pay three times
    for one answer."""
    keys = set()
    for asked in (
        "What is a prime number?",
        "what is a prime number",
        "  What   is a Prime Number ?? ",
    ):
        keys.add(generic_turn.key_for(packet(turn={"lastUserInput": asked})))
    assert len(keys) == 1


def test_a_question_too_long_to_be_asked_by_many_is_not_stored(fake: FakePostgrest) -> None:
    """Keying on a paragraph fills the table with rows of one."""
    payload = packet(turn={"lastUserInput": "why " * 200})
    assert generic_turn.key_for(payload) is None
    assert generic_turn.save(payload, ANSWER) is False


# --- 2. the name: stitched at serve, never stored ---------------------------------------------


def test_the_learners_name_never_enters_the_row(fake: FakePostgrest) -> None:
    """docs/CACHES.md §2: 'A learner's name is stitched in at serve time by the cheapest model or
    by a template, never stored.' A template is what this is: no model call, and no way for one
    child's name to reach another child's answer, because it never enters the row."""
    said = {**ANSWER, "say": "Good question, Learner-A. A prime number has exactly two factors."}
    payload = packet(lifetime={"learner": {"name": "Learner-A"}})
    assert generic_turn.save(payload, said) is True

    row = fake.all_rows("turns")[0]
    assert "Learner-A" not in str(row), row
    assert row["body"]["say"].startswith("Good question, {learner}.")


def test_the_name_that_comes_back_is_the_name_of_whoever_is_reading(fake: FakePostgrest) -> None:
    said = {**ANSWER, "say": "Good question, Learner-A. A prime number has exactly two factors."}
    generic_turn.save(packet(lifetime={"learner": {"name": "Learner-A"}}), said)

    reader = generic_turn.load(packet(lifetime={"learner": {"name": "Learner-B"}}))
    assert reader["say"].startswith("Good question, Learner-B.")
    assert "Learner-A" not in reader["say"]


def test_a_reader_with_no_name_gets_a_sentence_and_not_a_stray_comma(
    fake: FakePostgrest,
) -> None:
    """"Good question, ." is the tell that would make a cached line feel machine-made."""
    said = {**ANSWER, "say": "Good question, Learner-A. A prime number has exactly two factors."}
    generic_turn.save(packet(lifetime={"learner": {"name": "Learner-A"}}), said)
    anonymous = generic_turn.load(packet())
    assert anonymous["say"].startswith("Good question. A prime number")


def test_a_name_too_short_to_replace_safely_is_not_stored_at_all(fake: FakePostgrest) -> None:
    """A two-letter name is a substring of ordinary words, and replacing it mangles the sentence.
    A turn for a learner with one is answered live, every time. (The names in this file are
    placeholders and not people: docs/copy voice.md 8.1, and `test_copy_law` enforces it.)"""
    said = {**ANSWER, "say": "Good question, Le. A prime number has exactly two factors."}
    assert generic_turn.save(packet(lifetime={"learner": {"name": "Le"}}), said) is False
    assert fake.all_rows("turns") == []


# --- 3. a cached plan re-anchors, or it is declined -------------------------------------------


PLAN = {
    "sentences": [
        {
            "say": "Look at this one.",
            "marks": [{"kind": "ring", "target": "step-2", "words": "step 2"}],
        },
        {"say": "What is different about it?", "marks": []},
    ],
    "ask": {"prompt": "What is different about it?", "targets": ["step-2"]},
}


def _screen(*ids: str) -> dict[str, Any]:
    """A learner's own screen, as the surface registry publishes it."""
    return {
        "targets": [
            {"id": i, "role": "text", "meaning": f"step:{i}", "text": f"the line {i}"} for i in ids
        ]
    }


def test_a_cached_plan_lands_on_a_screen_that_carries_its_targets(fake: FakePostgrest) -> None:
    assert generic_turn.save(packet(**_screen("step-1", "step-2")), ANSWER, plan=PLAN) is True
    served = generic_turn.load(packet(**_screen("step-1", "step-2", "step-3")))
    assert served is not None
    assert served["plan"] == PLAN
    assert served["cached"] is True


def test_a_cached_plan_is_declined_when_a_target_is_not_on_this_screen(
    fake: FakePostgrest,
) -> None:
    """The whole plan, not the missing mark. The sentences were written to be said WITH those
    marks, and dropping one leaves "look at this one" over nothing."""
    generic_turn.save(packet(**_screen("step-1", "step-2")), ANSWER, plan=PLAN)
    assert generic_turn.load(packet(**_screen("step-1"))) is None
    assert generic_turn.load(packet()) is None


def test_a_declined_plan_is_a_miss_and_the_turn_goes_live(fake: FakePostgrest) -> None:
    """None from `load` means 'ask a model', for every reason, so the caller has one branch."""
    generic_turn.save(packet(**_screen("step-2")), ANSWER, plan=PLAN)
    assert generic_turn.load(packet(**_screen("nothing-like-it"))) is None
    assert db.state()["stores"]["turns"]["misses"] >= 1


def test_a_turn_with_no_plan_always_lands(fake: FakePostgrest) -> None:
    """Most generic questions are answered in words, and words anchor to nothing."""
    generic_turn.save(packet(), ANSWER)
    assert generic_turn.load(packet(**_screen("a-page-nobody-saw-before"))) is not None


def test_reanchoring_reads_the_screen_and_never_the_stored_pixels() -> None:
    """A plan names semantic targets from the registry. There is no coordinate in a stored plan
    and no way for one to get there — the planner refuses a model-written coordinate upstream, and
    this is the read-side half of the same rule."""
    assert generic_turn.reanchor(PLAN, packet(**_screen("step-2"))) == PLAN
    assert generic_turn.reanchor(PLAN, packet(**_screen("step-9"))) is None
    assert generic_turn.reanchor({"sentences": []}, packet()) == {"sentences": []}


# --- 4. what a stored turn holds, and what it saves --------------------------------------------


def test_only_the_answer_is_stored_and_never_the_asking(fake: FakePostgrest) -> None:
    """`body_for` is an allow-list for the same reason `ledger.FIELDS` is one: the turn output
    grows fields, and a body built by copying would store whichever of them was personal."""
    output = {**ANSWER, "learner_ref": "9f3c", "meter_key": "sub:abc", "twinSummary": "anxious"}
    generic_turn.save(packet(), output)
    body = fake.all_rows("turns")[0]["body"]
    assert set(body) == {"say", "actions", "path", "grounded", "verified"}


def test_a_stored_turn_carries_what_it_cost_and_which_model_made_it(fake: FakePostgrest) -> None:
    """Which is what makes 'spend saved' arithmetic and not a guess."""
    generic_turn.save(packet(), ANSWER, model="anthropic/claude-x", cost_usd=0.0013)
    row = fake.all_rows("turns")[0]
    assert row["model"] == "anthropic/claude-x"
    assert row["cost_usd"] == 0.0013
    assert row["question_norm"] == "what is a prime number"
    assert row["board"] == "cbse"


def test_every_serve_after_the_first_is_a_model_call_that_did_not_happen(
    fake: FakePostgrest,
) -> None:
    """docs/CACHES.md §3: the turn cache is the biggest saving because turns are the most frequent
    model call and the generic ones repeat across every learner at a level."""
    generic_turn.save(packet(), ANSWER, model="anthropic/claude-x", cost_usd=0.002)
    for _ in range(4):
        assert generic_turn.load(packet()) is not None

    turns = db.state()["stores"]["turns"]
    assert turns["database_hits"] == 4
    assert turns["saved_usd"] == pytest.approx(0.008)

    db.flush_serves()
    assert fake.all_rows("turns")[0]["served_count"] == 4


def test_nothing_is_stored_or_read_without_a_database(monkeypatch: pytest.MonkeyPatch) -> None:
    """The gateway runs perfectly well without the stores; it just pays for everything."""
    db.reset()
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    assert generic_turn.save(packet(), ANSWER) is False
    assert generic_turn.load(packet()) is None


def test_a_turn_that_said_nothing_is_never_stored(fake: FakePostgrest) -> None:
    assert generic_turn.save(packet(), {"say": "   "}) is False
    assert fake.all_rows("turns") == []


# --- 5. the door, through the real route ------------------------------------------------------
#
# Everything above tests the door's own logic. These two go through `POST /v1/capability/wobo.turn`
# — the meter, the grounding, the safety screen and all — because the door is a decision made in
# `app.invoke`, and a module that behaves perfectly while nothing calls it is not a feature.


def _client():
    from fastapi.testclient import TestClient
    from wobo_gateway.app import Gateway, create_app
    from wobo_gateway.cache import InMemoryCache
    from wobo_gateway.providers import MockProvider
    from wobo_gateway.telemetry import MetricsSink

    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def test_a_live_turn_is_written_and_the_next_learner_is_served_it(
    fake: FakePostgrest, auth
) -> None:
    """The saving, end to end. The first learner pays for the model call; the second gets the same
    answer with no provider reached at all, and the response says so."""
    client = _client()
    body = {"consent_tier": "un_elevated", "payload": packet()}

    first = client.post("/v1/capability/wobo.turn", json=body, headers=auth())
    assert first.status_code == 200, first.text
    assert first.json()["cache_hit"] is False
    assert len(fake.all_rows("turns")) == 1, "a generic turn was answered and never stored"

    second = client.post("/v1/capability/wobo.turn", json=body, headers=auth("another-learner"))
    assert second.status_code == 200
    assert second.json()["cache_hit"] is True
    assert second.json()["output"]["say"] == first.json()["output"]["say"]
    # The white-label rule holds on this path too: no model id, ours or the store's, leaves.
    assert "model" not in second.json()


def test_a_personal_turn_reaches_the_model_every_time(fake: FakePostgrest, auth) -> None:
    """The learner's own working is on the page. Every one of these is a model call, and none of
    them touches the store — which is the correct price for an answer about THEIR work."""
    client = _client()
    body = {
        "consent_tier": "un_elevated",
        "payload": packet(canvas={"equation": "2*x + 3 = 7", "steps": ["2*x = 5"]}),
    }
    for _ in range(3):
        answered = client.post("/v1/capability/wobo.turn", json=body, headers=auth())
        assert answered.status_code == 200
        assert answered.json()["cache_hit"] is False
    assert fake.all_rows("turns") == []


def test_a_cache_that_goes_wrong_is_a_miss_and_never_a_five_hundred(
    fake: FakePostgrest, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The last rule of every cache in this gateway: a learner's answer outranks an optimisation.
    A store that raises on the read path must produce a live turn, not an error page."""

    def explodes(payload):
        raise RuntimeError("the store is having a bad day")

    monkeypatch.setattr(generic_turn, "load", explodes)
    answered = _client().post(
        "/v1/capability/wobo.turn",
        json={"consent_tier": "un_elevated", "payload": packet()},
        headers=auth(),
    )
    assert answered.status_code == 200
    assert answered.json()["output"]["say"]
