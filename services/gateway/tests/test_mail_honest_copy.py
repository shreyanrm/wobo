"""Every sentence a family reads about the mail is true of the mail (docs/copy/voice.md §6:
"If a message promises something, the product does it. Copy is a contract.").

What the adversaries found (2026-09-16), each now held here:

1. A parent was told "once a week, one page" and "nothing else comes" before and after linking,
   then received three or four notes a week.
2. Every note to a parent said the child "is under thirteen", though the product holds no age.
3. The welcome promised notes "a few times a week" to a learner who, with no parent linked, is
   written nothing at all.
4. A learner away for weeks was sent the same sentence again and again, on back-to-back days.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from mail_world import Plan, drive, install
from wobo_gateway import email as email_mod
from wobo_gateway import parents
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.email_templates import NUDGE_KINDS, render
from wobo_gateway.hospitality import festivals, jobs, tokens
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

WEEKLY_ONLY = re.compile(
    r"once a week|one page a week|nothing else comes|the sunday note, and nothing else|"
    r"whole of what goes out|at most three times",
    re.IGNORECASE,
)
AN_AGE = re.compile(r"under thirteen|under 13|aged? \d+", re.IGNORECASE)


# === 1. what a parent is promised ================================================================
def test_the_invite_says_notes_come_in_the_week_as_well_as_on_sunday() -> None:
    mail = render("parent_invite", {"learner_name": "Learner"})
    for part in ("subject", "preheader", "text", "html"):
        assert not WEEKLY_ONLY.search(mail[part]), (part, mail[part][:400])
    assert "in the week" in mail["text"]


def test_the_consent_page_says_what_will_come(monkeypatch: pytest.MonkeyPatch, auth: Any) -> None:
    monkeypatch.setenv("PARENT_LINKS_STORE", "memory")
    monkeypatch.setenv("MAIL_PREFERENCES_STORE", "memory")
    store = parents.InMemoryParentLinkStore()
    parents.set_store(store)
    try:
        client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
        res = client.post(
            "/v1/me/parent-invite",
            json={"email": "parent@example.test", "learner_name": "Learner"},
            headers=auth(),
        )
        assert res.status_code == 200, res.text
        [link] = store.rows.values()
        token = parents.invite_token(link.id, link.learner_id, issued=link.invited_at)
        page = client.get("/v1/parent/accept", params={"token": token}).text
        assert not WEEKLY_ONLY.search(page), page
        assert "in the week" in page
        done = client.post("/v1/parent/accept", data={"token": token}).text
        assert not WEEKLY_ONLY.search(done), done
        assert "in the week" in done
    finally:
        parents.set_store(None)


def _sunday(data: dict[str, Any]) -> dict[str, Any]:
    base = {"learner_name": "Learner", "lessons": 3, "days_active": 3, "days_of": 7}
    return render("sunday_note", {**base, **data})


def test_the_sunday_note_footer_is_true_for_a_parent_who_gets_the_weekday_notes() -> None:
    mail = _sunday({"parent_gets_notes": True, "stop_all_url": ""})
    assert not WEEKLY_ONLY.search(mail["text"]), mail["text"]
    assert not WEEKLY_ONLY.search(mail["html"])
    assert "Learner’s learning" in mail["text"]


def test_the_sunday_note_footer_is_true_for_a_parent_who_gets_only_the_sunday_note() -> None:
    mail = _sunday({"parent_gets_notes": False})
    assert "Nothing else comes" not in mail["text"]
    assert "on Sunday" in mail["text"]


def test_the_sunday_note_carries_the_link_that_stops_everything(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prefs = install(monkeypatch)
    family = jobs.Family(
        learner_id="L-1",
        learner_name="Learner",
        parent_email="parent@example.test",
        timezone="Asia/Kolkata",
    )
    prefs.put("L-1", jobs.MailPreferences(country="IN", timezone="Asia/Kolkata"))
    sent: list[dict[str, Any]] = []
    jobs.run_sunday(
        datetime(2026, 9, 27, 12, 45, tzinfo=UTC),  # 18:15 on a Sunday in Kolkata
        families=jobs.InMemoryFamilies([family]),
        week_source=type(
            "W", (), {"week": lambda self, *a, **k: {"lessons": 2, "days_active": 2}}
        )(),
        digest=None,
        send=lambda kind, to, data, **kw: sent.append(data) or {"ok": True},
    )
    (data,) = sent
    claim = tokens.parse_stop_token(data["stop_all_url"].split("token=")[1])
    assert claim is not None and claim.audience == "parent"
    assert data["parent_gets_notes"] is True
    mail = render("sunday_note", data)
    assert "Stop all of these" in mail["text"] and "Stop all of these" in mail["html"]
    assert not WEEKLY_ONLY.search(mail["text"])


def test_the_web_invite_card_and_the_help_centre_say_the_same() -> None:
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    card = (root / "apps/web-pwa/src/screens/You.tsx").read_text(encoding="utf-8")
    assert "They get the Sunday note, and nothing else" not in card
    article = (root / "docs/copy/help-centre/product-features/11-the-parent-link.md").read_text(
        encoding="utf-8"
    )
    assert not WEEKLY_ONLY.search(article), article
    compiled = (root / "apps/web-pwa/src/screens/site/content/help.json").read_text(
        encoding="utf-8"
    )
    assert "the weekly note is the whole of what goes out" not in compiled


# === 2. no age is claimed ========================================================================
@pytest.mark.parametrize("kind", NUDGE_KINDS)
@pytest.mark.parametrize("under_13", [None, False, True])
def test_a_note_to_a_parent_never_states_the_childs_age(kind: str, under_13: Any) -> None:
    facts = {
        "audience": "parent",
        "learner_name": "Learner",
        "angle": "waiting",
        "days": 4,
        "chapter": "Fractions",
        "cards_left": 2,
        "under_13": under_13,
    }
    mail = render(kind, facts)
    assert not AN_AGE.search(mail["text"]), mail["text"]
    assert "linked you" in mail["text"]


# === 3. the welcome promises nothing that does not come ==========================================
def test_the_welcome_promises_no_cadence() -> None:
    mail = render("welcome", {"name": "Learner"})
    for part in ("text", "html"):
        assert "a few times a week" not in mail[part]
        assert "Notes about your learning come" not in mail[part]


# === 4. never the same sentence back to back =====================================================
@pytest.mark.parametrize("under_13", [True, False], ids=["under-13", "aged-15"])
def test_a_learner_who_is_away_is_not_sent_the_same_sentence_again_and_again(
    monkeypatch: pytest.MonkeyPatch, under_13: bool
) -> None:
    prefs = install(monkeypatch)
    said: list[str] = []
    real = email_mod.render

    def spy(kind: str, data: dict[str, Any]) -> dict[str, Any]:
        mail = real(kind, data)
        if kind == "learning_note":
            said.append(mail["line"])
        return mail

    monkeypatch.setattr(email_mod, "render", spy)
    try:
        drive(
            Plan(start=date(2026, 9, 21), days=28, came=lambda d: d == 0, under_13=under_13),
            prefs,
            monkeypatch,
        )
    finally:
        festivals.set_calendar(None)
    assert len(said) >= 8, said
    assert all(a != b for a, b in zip(said, said[1:], strict=False)), said
    assert max(said.count(line) for line in said) <= 2, said


@pytest.mark.parametrize("audience", ["learner", "parent"])
@pytest.mark.parametrize("variant", range(8))
@pytest.mark.parametrize(
    "title", ["Fractions, part two", ""], ids=["a-chapter", "nothing-recorded"]
)
def test_every_way_of_saying_what_is_waiting_keeps_the_mail_law(
    audience: str, variant: int, title: str
) -> None:
    from test_mail_law import _CAPS_RUN, BODY_WORDS, SUBJECT_LIMIT, body_of

    facts: dict[str, Any] = {
        "audience": audience,
        "name": "Learner",
        "learner_name": "Learner",
        "angle": "waiting",
        "variant": variant,
    }
    if title:
        facts |= {"title": title, "done": 3, "cards_left": 7}
    mail = render("learning_note", facts)
    subject, preheader = mail["subject"], mail["preheader"]
    assert len(subject) <= SUBJECT_LIMIT, subject
    assert 0 < len(preheader) <= 90 and preheader != subject, preheader
    assert not _CAPS_RUN.search(subject + preheader)
    for blob in (subject, preheader, mail["text"]):
        assert "!" not in blob and "%" not in blob and "—" not in blob
    assert len(body_of(mail).split()) <= BODY_WORDS
    lowered = mail["text"].lower()
    for never in ("we noticed", "we miss", "come back", "days away", "streak will"):
        assert never not in lowered, never
    if audience == "parent":
        assert "Learner," not in subject
