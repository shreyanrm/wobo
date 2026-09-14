"""The deep link a mail's button carries (docs/EMAILS-AND-ANIMATIONS.md §4).

Every clock is handed in; no network, no provider, no wall clock.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from wobo_gateway.hospitality import links

NOW = datetime(2026, 9, 11, 9, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "test-mail-secret")
    monkeypatch.delenv("MAIL_CARD_LINK_DAYS", raising=False)
    links.reset_redemptions()


def test_the_link_lands_on_the_exact_card() -> None:
    url = links.card_link("L-1", "fractions-2", "card-7", issued=NOW)
    assert url is not None
    parsed = urlparse(url)
    assert parsed.path == "/course/fractions-2/card/card-7"
    assert list(parse_qs(parsed.query)) == [links.QUERY_KEY]


def test_the_token_names_the_learner_the_course_and_the_card() -> None:
    url = links.card_link("L-1", "fractions-2", "card-7", issued=NOW)
    assert url is not None
    claim = links.parse_card_link(links.token_of(url), now=NOW + timedelta(hours=2))
    assert claim is not None
    assert (claim.learner_id, claim.course_id, claim.card_id) == ("L-1", "fractions-2", "card-7")


def test_a_token_we_did_not_sign_is_nothing() -> None:
    url = links.card_link("L-1", "c", "card", issued=NOW)
    assert url is not None
    token = links.token_of(url)
    payload, _, signature = token.partition(".")
    assert links.parse_card_link(f"{payload}.{signature[:-2]}xx", now=NOW) is None
    assert links.parse_card_link("nonsense", now=NOW) is None
    assert links.parse_card_link(None, now=NOW) is None


def test_it_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAIL_CARD_LINK_DAYS", "30")
    url = links.card_link("L-1", "c", "card", issued=NOW)
    assert url is not None
    token = links.token_of(url)
    assert links.parse_card_link(token, now=NOW + timedelta(days=29)) is not None
    assert links.parse_card_link(token, now=NOW + timedelta(days=31)) is None


def test_the_sign_in_is_single_use_and_the_destination_is_not() -> None:
    url = links.card_link("L-1", "c", "card", issued=NOW)
    assert url is not None
    token = links.token_of(url)
    claim = links.parse_card_link(token, now=NOW)
    assert claim is not None
    assert links.redeem_sign_in(claim, now=NOW) is True
    assert links.redeem_sign_in(claim, now=NOW) is False
    # The destination still reads: the card is reachable for as long as the link lives, it is
    # only the "sign me in on this device" half that is spent.
    again = links.parse_card_link(token, now=NOW + timedelta(days=1))
    assert again is not None and again.card_id == "card"


def test_two_links_differ_even_for_the_same_card() -> None:
    first = links.card_link("L-1", "c", "card", issued=NOW)
    second = links.card_link("L-1", "c", "card", issued=NOW)
    assert first != second  # the nonce, so one spent sign-in never spends another mail's


def test_without_a_signing_key_there_is_no_link(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MAIL_TOKEN_SECRET", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    assert links.card_link("L-1", "c", "card", issued=NOW) is None


def test_an_id_that_is_not_an_id_is_refused() -> None:
    assert links.card_link("L-1", "", "card", issued=NOW) is None
    assert links.card_link("L-1", "c", "../../etc/passwd", issued=NOW) is None
    assert links.card_link("L-1", "c", "a" * 200, issued=NOW) is None


def test_the_link_is_on_our_own_host_so_a_template_will_sign_its_name_to_it() -> None:
    from wobo_gateway.email_templates import APP_URL, _safe_url

    url = links.card_link("L-1", "c", "card", issued=NOW)
    assert url is not None and url.startswith(APP_URL)
    assert _safe_url(url, "fallback") == url
