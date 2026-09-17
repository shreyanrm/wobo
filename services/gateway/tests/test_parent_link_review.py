"""The Sunday note must not send a parent to a page that cannot work for them.

``ParentView`` renders from ``loadProfile()`` and ``useProgress()`` — both localStorage on the
VIEWER's own device. The Sunday note is real (``hospitality/jobs.py``, ``POST
/v1/internal/mail/sunday``) and its call to action linked to ``/parent``. So a parent who opened
the link on their own phone reached a page that rendered their own empty device storage: the
product emailed a parent a link to a blank page about their child.

Nothing here builds a server-backed parent view — what a parent may see is a product and legal
decision, and it is written down as one in the report. What it does enforce is that the email does
not promise the thing that does not work. The week IS the email today, and the email says so.
"""

from __future__ import annotations

from wobo_gateway.email_templates import render

DATA = {
    "learner_name": "Learner",
    "name": "Learner",
    "strengths": [("fractions", "8", 80)],
    "focus": ["angles"],
    "trajectory": "steady",
}


def test_the_sunday_note_does_not_link_a_parent_to_the_learners_own_device() -> None:
    out = render("parent_report", DATA)
    for part in ("html", "text"):
        body = str(out[part])
        assert "/parent" not in body, (
            "the Sunday note links a parent at /parent, which renders the viewer's own "
            "localStorage — a blank page about their child"
        )


def test_the_sunday_note_still_carries_the_week_itself() -> None:
    """The link is gone, so the email has to be the report rather than a pointer to one."""
    out = render("parent_report", DATA)
    assert "Fractions" in out["html"]  # sentence case where a line opens (voice.md)
    assert "Angles" in out["html"]
    assert "steady" in out["html"]
