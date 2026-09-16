"""THE MONEY'S VOICE IN THE MAIL, held to ``docs/copy/money.md``.

The owner, 2026-09-15 (``docs/SELL.md``, "The money's voice"): every surface where money is
mentioned says, once and in the product's own words, where the money goes. The lines live in
``docs/copy/money.md`` and are used VERBATIM, so that the page, the app and the inbox say the same
sentence rather than three versions of it.

Two rules, both mechanical:

1. Each money surface carries EXACTLY ONE line from money.md. Never two in one mail.
2. None of the forbidden words appears on a money surface.

WHAT THIS WAVE OWNS IN THE MAIL. money.md names four money mails: the receipt, the plan-opened
mail, the renewal and the failed payment. ``email_templates.py`` has exactly ONE of them today,
``plan_opened``; the other three have specs in ``docs/copy/emails/`` and no template function, so
there is nothing to put a line on. This file gives ``plan_opened`` its line and holds the other
three with :func:`test_the_money_mails_another_wave_owns_do_not_exist_yet`, which goes red the day
one of them is written — which is the day somebody has to come back here and add it to
:data:`OWNED_MAILS`.

The document is READ OFF DISK. Nobody may improve a line in the template: money.md is the source,
and a drift is a second voice for the same moment.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from wobo_gateway.email_templates import KINDS, render, text_of

REPO = Path(__file__).resolve().parents[3]
MONEY_DOC = REPO / "docs/copy/money.md"


def _document() -> dict[str, str]:
    """money.md's table, as {surface: line}."""
    out: dict[str, str] = {}
    for raw in MONEY_DOC.read_text(encoding="utf-8").splitlines():
        row = raw.strip()
        if not row.startswith("|") or row.startswith("|---"):
            continue
        cells = [c.strip() for c in row.strip("|").split("|")]
        if len(cells) != 2:
            continue
        surface, line = cells
        if surface == "Surface" or not line:
            continue
        out[surface] = line
    return out


def _forbidden() -> list[str]:
    """The forbidden list, read from the document rather than retyped here."""
    text = MONEY_DOC.read_text(encoding="utf-8")
    after = text[text.index("Forbidden on any money surface:") :]
    listed = after[after.index(":") + 1 : after.index(".")].replace("\n", " ")
    words = [w.strip() for w in listed.split(",") if w.strip()]
    # 'The word "business" never appears.' is its own sentence after the list.
    return [*words, "business"]


LINES = _document()
FORBIDDEN = _forbidden()

#: The money mails that EXIST in email_templates.py, and the money.md surface each one carries.
OWNED_MAILS = {"plan_opened": "plan opened mail"}

#: The money mails money.md names that have no template function yet. Specs only
#: (``docs/copy/emails/receipt.md``, ``renewal-reminder-*.md``, ``payment-failed.md``).
THEIR_MAILS = {
    "receipt mail, first line after the amount",
    "renewal mail",
    "failed payment mail",
}


def _says(word: str, blob: str) -> bool:
    """A forbidden word, found as a whole word. Whitespace in a phrase may wrap across lines."""
    pattern = re.escape(word).replace(r"\ ", r"\s+")
    return re.search(rf"(?<![a-z]){pattern}(?![a-z])", blob.lower()) is not None


# --- the document ------------------------------------------------------------------------------


def test_the_document_holds_ten_surfaces_and_a_forbidden_list() -> None:
    assert len(LINES) == 10, LINES
    assert "plan opened mail" in LINES
    for word in ("subscription", "tier", "upgrade", "premium", "unlock", "mission", "business"):
        assert word in FORBIDDEN, word


def test_no_line_in_the_document_breaks_the_document_s_own_rule() -> None:
    """The lines are the remedy, so none of them may carry the disease."""
    for surface, line in LINES.items():
        said = [w for w in FORBIDDEN if _says(w, line)]
        assert said == [], f"{surface}: {said}"


# --- rule 1: the mail this wave owns carries its line, exactly once -----------------------------


@pytest.mark.parametrize("kind,surface", sorted(OWNED_MAILS.items()))
def test_the_money_mail_carries_its_line_word_for_word(kind: str, surface: str) -> None:
    line = LINES[surface]
    out = render(kind, {"until": "4 October"})
    assert line in text_of(out), f"{kind}: the text part does not carry money.md's line"
    assert line in out["html"], f"{kind}: the html does not carry money.md's line"


@pytest.mark.parametrize("kind,surface", sorted(OWNED_MAILS.items()))
def test_the_money_mail_carries_exactly_one_line_and_not_two(kind: str, surface: str) -> None:
    text = text_of(render(kind, {"until": "4 October"}))
    carried = sorted(s for s, line in LINES.items() if line in text)
    assert carried == [surface], carried
    # and the line itself appears once, not twice in one mail
    assert text.count(LINES[surface]) == 1


@pytest.mark.parametrize("kind", sorted(OWNED_MAILS))
def test_the_money_mail_says_none_of_the_forbidden_words(kind: str) -> None:
    out = render(kind, {"until": "4 October"})
    blob = f"{out['subject']}\n{out.get('preheader') or ''}\n{text_of(out)}"
    said = [w for w in FORBIDDEN if _says(w, blob)]
    assert said == [], f"{kind}: {said}"


def test_no_other_mail_quietly_grows_a_money_line() -> None:
    """One line per surface, and a surface that is not a money mail carries none of them.

    A thank-you pasted into the streak mail is exactly the drift money.md exists to stop.
    """
    for kind in KINDS:
        if kind in OWNED_MAILS:
            continue
        text = text_of(render(kind))
        carried = [s for s, line in LINES.items() if line in text]
        assert carried == [], f"{kind} carries {carried}"


# --- the mails another wave owns ----------------------------------------------------------------


def test_the_money_mails_another_wave_owns_do_not_exist_yet() -> None:
    """The gate that stops a receipt, a renewal or a failed payment shipping without its line.

    It asserts the templates are ABSENT rather than asserting they carry the line, because a test
    that demands a sentence from a template nobody has written is a red suite in a shared tree from
    the moment it lands, and a permanently red test is one everybody learns to ignore. This is
    green today and goes red the moment one of these kinds is added, which is exactly when somebody
    has to come back and move it into ``OWNED_MAILS``.
    """
    for surface in THEIR_MAILS:
        assert surface in LINES, surface
    unwritten = {"receipt", "renewal", "payment_failed", "renewal_reminder"}
    present = unwritten & set(KINDS)
    assert present == set(), (
        f"{present} now exists: give each one its line from docs/copy/money.md and move the "
        "surface into OWNED_MAILS."
    )
