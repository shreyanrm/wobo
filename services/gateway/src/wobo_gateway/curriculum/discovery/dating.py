"""What year is this document, and is it still the year the learner is in?

**The fault this exists for.** On 2026-09-15 the pipeline read Maharashtra's Std X Mathematics off
``mahahsscboard.in/sscsyllabus.pdf``, passed all nine structural checks, got a second reader's
agreement, and would have published it. The transcription was faithful — every name is on pages
158 and 159 of that file. The file is the syllabus sanctioned by the Government of Maharashtra
letter of 12/03/2012; its ``/CreationDate`` is 2013-05-24 and the extractor itself answered
``"version": "2013"``. Maharashtra revised Std X Mathematics for 2018-19. So the reading was a
correct transcription of a withdrawn document, and **not one stage — search, fetch, extract,
verify, persist — asked what year it was**. A faithful reading of the wrong year is still the
wrong chapters in a child's hands, and it arrives wearing "Found on the board's site, still
checking", which is the one label that says we have looked.

## The witnesses, and the one that is not asked

Two things are evidence about a document's EDITION, and they answer different halves:

1. **The date the file itself was made** (``/CreationDate``, ``/ModDate``) is a CEILING. A pdf
   produced in 2013 cannot hold the 2026-27 syllabus. It is a fact off the file rather than a
   judgement, and it is free: it is read at fetch, before any model is paid.
2. **The year the reading states.** ``extract`` asks the model in terms for "the academic year or
   edition the document states" and stores the answer as the syllabus's ``version``. It is a
   direct answer to exactly this question, so it settles the edition — but only downward. Ranking
   it above the file was the first cut of this module and it was wrong: it hands the one model in
   the loop the power to talk the gate out of a verdict by stating the year we want to hear. The
   file caps it (plus :data:`FILE_FORWARD_GRACE_YEARS`, because a board typesets the coming year's
   syllabus the year before it takes effect); the reading may lower it, which is the common case —
   a 2012 syllabus re-exported as a pdf in 2024 is still the 2012 syllabus.

**Years printed in the text are NOT a witness, and that is a measurement, not a preference.**
Maharashtra's pdf names 1954, 1964, 1986, 2005, 2010, 2012, 2013, 2014 and 2020 across two
hundred pages of nineteen subjects, and the pages the reader was handed for Mathematics are mostly
other subjects' (``extract.select_pages`` fills a 120,000-character budget outward from the
subject's own run, about seventy pages of that compilation). A witness that can be any year in the
document is not evidence about this subject's edition; believing the newest year in the text would
have let this exact document through on the strength of a 2020 printed on another subject's page.
The HTTP ``Last-Modified`` header is left alone for the same reason in the other direction: a 2013
pdf re-uploaded in 2024 has a 2024 header, and believing it would hide the fault.

## What the verdict is, and what it is not

A verdict of "out of date" is **never a claim that the board has revised**. It is the honest end of
"the only document we can find for this subject is much older than the year this learner is in,
and we cannot tell from here whether that is because the board is steady or because we found the
wrong file." A board that has genuinely not changed its syllabus since 2015 is refused by this and
that is the cost, paid on purpose: the learner is not blocked (``docs/BOARD-COLD-START.md`` §2
teaches them on the shared concept plan either way), the refusal is remembered, and it lands in the
console queue where a person can look at the document and say. The opposite trade — publishing it —
puts a board's name on chapters nobody checked the year of, which is the thing ``CURRICULUM.md``
§12 says kills this.

The window is a dial (``discovery.document.max_age_years``), so the owner moves it from the
console without a deploy.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime

logger = logging.getLogger("wobo.gateway.curriculum.discovery.dating")

#: The dial. Named in ``dials.DISCOVERY_KEYS`` so it is read on the same interval as every other
#: dial and audited by the same trigger.
MAX_AGE_KEY = "discovery.document.max_age_years"

#: How many academic years older than the learner's a document may be and still be believed.
#: Six, for two reasons said plainly rather than implied: a state board's revision cycle runs
#: about five years (the NCF cycles, and NEP 2020's state rollouts), so six is one full cycle
#: plus a year of grace; and the oldest syllabus the product actually publishes today is NIOS
#: 2023, which is three years inside it. It is a judgement about likelihood, not a fact about
#: boards, which is why it is a dial.
DEFAULT_MAX_AGE_YEARS = 6

#: How far AHEAD of the file's own date a stated edition may be and still be believed. A board
#: typesets the coming year's syllabus in the year before it takes effect, so one. Past that the
#: reading is claiming a document holds a syllabus written after the file was made.
FILE_FORWARD_GRACE_YEARS = 1

#: The month a school year turns over, per country. India's is April, which is why a document
#: found in March 2026 belongs to 2025-26 and not to 2026-27. Only the countries the registry
#: actually holds boards for are listed; everywhere else gets :data:`DEFAULT_START_MONTH`.
YEAR_START_MONTH: dict[str, int] = {
    "IN": 4,
    "GB": 9,
    "IE": 9,
    "US": 8,
    "CA": 9,
    "AU": 1,
    "NZ": 1,
    "SG": 1,
    "ZA": 1,
    "AE": 9,
    "PK": 4,
    "BD": 1,
    "LK": 1,
    "NP": 4,
    "MY": 1,
    "NG": 9,
    "KE": 1,
}
#: The northern-hemisphere default. A country we do not know is given September rather than
#: January because more school systems start in autumn than at new year, and being wrong by one
#: turn of the year costs at most one year of slack against a six-year window.
DEFAULT_START_MONTH = 9

#: A four-digit year we would believe off a label or a file. Nothing before schooling as we know
#: it and nothing a typo could put in the next century.
MIN_YEAR = 1950
MAX_YEAR = 2100

#: "2026-27", "2026-2027", "AY 2018-19", "2013", "2026-27 rev 2". The FIRST four-digit year in
#: the label is the one that names the edition; the second half of a span is the same year told
#: twice.
_YEAR_IN_LABEL = re.compile(r"(?<!\d)(\d{4})(?!\d)")
#: A pdf date stamp: ``D:YYYYMMDDHHmmSSOHH'mm'``, and the ISO form some producers write instead.
_PDF_DATE = re.compile(r"^\s*(?:D:)?(\d{4})(\d{2})?(\d{2})?")
_ISO_DATE = re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})")


@dataclass(frozen=True)
class Evidence:
    """One witness's answer about the document's edition, and who said it."""

    year: int
    witness: str
    detail: str = ""


@dataclass(frozen=True)
class Staleness:
    """The verdict. ``stale`` is ``None`` when no witness answered at all."""

    stale: bool | None
    year: int | None
    academic_year: int
    max_age_years: int
    detail: str = ""


# --- the dial -----------------------------------------------------------------------------------
def _dial(key: str):
    from wobo_gateway import dials

    return dials.values().get(key)


def max_age_years() -> int:
    """The window, live off ``ops.settings``. A store that will not answer never stops a run."""
    try:
        held = _dial(MAX_AGE_KEY)
    except Exception as exc:  # noqa: BLE001 — a dial is never allowed to be the reason we fail
        logger.warning("discovery dating: could not read %s (%s)", MAX_AGE_KEY, exc)
        return DEFAULT_MAX_AGE_YEARS
    if isinstance(held, int | float) and not isinstance(held, bool) and held > 0:
        return int(held)
    return DEFAULT_MAX_AGE_YEARS


# --- the academic year ----------------------------------------------------------------------------
def start_month(country: str | None) -> int:
    return YEAR_START_MONTH.get((country or "").upper(), DEFAULT_START_MONTH)


def academic_year(now: datetime | None = None, country: str | None = None) -> int:
    """The START year of the academic year running at ``now``. India in September 2026 is 2026."""
    moment = now or datetime.now(UTC)
    return moment.year if moment.month >= start_month(country) else moment.year - 1


def academic_year_label(start: int, country: str | None = None) -> str:
    """ "2026-27" where a school year straddles the calendar, "2026" where it does not."""
    if start_month(country) == 1:
        return str(start)
    return f"{start}-{(start + 1) % 100:02d}"


# --- reading a year off a witness -----------------------------------------------------------------
def _believable(year: int | None) -> int | None:
    return year if year is not None and MIN_YEAR <= year <= MAX_YEAR else None


def year_of_label(label: str | None) -> int | None:
    """The year a version label states, or ``None``. "undated" and "rev 2" state none."""
    match = _YEAR_IN_LABEL.search(str(label or ""))
    return _believable(int(match.group(1))) if match else None


def year_of_pdf_date(stamp: str | None) -> int | None:
    """The year of a pdf ``/CreationDate``. ``D:20130524160248+05'30'`` is 2013."""
    text = str(stamp or "").strip()
    if not text:
        return None
    match = _ISO_DATE.match(text) or _PDF_DATE.match(text)
    return _believable(int(match.group(1))) if match else None


def iso_date_of_pdf_date(stamp: str | None) -> str | None:
    """A pdf date stamp as ``YYYY-MM-DD``, for provenance a person reads.

    A stamp that carries only a year answers with the year alone rather than inventing a day.
    """
    text = str(stamp or "").strip()
    if not text:
        return None
    iso = _ISO_DATE.match(text)
    if iso:
        return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}"
    match = _PDF_DATE.match(text)
    if not match or _believable(int(match.group(1))) is None:
        return None
    year, month, day = match.group(1), match.group(2), match.group(3)
    if month and day:
        return f"{year}-{month}-{day}"
    return f"{year}-{month}" if month else year


def edition_evidence(document, reading_version: str | None = None) -> Evidence | None:
    """The document's edition year, and which witness settled it.

    **The reading says which edition it is; the file says how new that edition could possibly
    be.** A pdf produced in 2013 cannot hold the 2026-27 syllabus, so the file's own date is a
    CEILING and a model's claim cannot lift it — otherwise one hallucinated ``"version":
    "2026-27"`` would talk the whole gate out of a verdict, which is the failure mode this module
    exists to stop. The reading can still lower it, and that is the common case: a 2012 syllabus
    re-exported as a pdf in 2024 is the 2012 syllabus whatever the file says.

    :data:`FILE_FORWARD_GRACE_YEARS` is the one year of slack a real board needs — a syllabus
    published in March for the coming year is typeset the year before it takes effect.

    The file's date is the LATER of ``/CreationDate`` and ``/ModDate``, because a pdf edited
    incrementally keeps the creation date it was first made under: a 2009 template whose content
    was rewritten in 2026 would otherwise be refused for being what it is not. Both are the
    producer's own stamps inside the file, which is what separates them from the HTTP
    ``Last-Modified`` a re-upload writes without touching the document. When a trivial re-save
    lifts the ceiling on a document that is still old, the reading's stated year is the witness
    that still catches it — the two cover each other, which is why there are two.
    """
    stated = year_of_label(reading_version)
    stamps = [
        (year_of_pdf_date(stamp), stamp)
        for stamp in (
            getattr(document, "created_at", None),
            getattr(document, "modified_at", None),
        )
        if year_of_pdf_date(stamp) is not None
    ]
    file_year, made = max(stamps, default=(None, None))
    if stated is None and file_year is None:
        return None
    if file_year is None:
        return Evidence(
            year=stated,  # type: ignore[arg-type]
            witness="the reading says the document states it",
            detail=str(reading_version).strip(),
        )
    ceiling = file_year + FILE_FORWARD_GRACE_YEARS
    if stated is None or stated > ceiling:
        return Evidence(
            year=min(stated, ceiling) if stated is not None else file_year,
            witness="the document file was made then",
            detail=(
                f"{made}"
                if stated is None
                else f"{made}; the reading claimed {str(reading_version).strip()}, "
                "which the file cannot hold"
            ),
        )
    return Evidence(
        year=stated,
        witness="the reading says the document states it",
        detail=str(reading_version).strip(),
    )


def edition_year(document, reading_version: str | None = None) -> int | None:
    witness = edition_evidence(document, reading_version)
    return witness.year if witness else None


# --- the verdict ----------------------------------------------------------------------------------
def staleness(
    year: int | None,
    *,
    now: datetime | None = None,
    country: str | None = None,
    max_age: int | None = None,
) -> Staleness:
    """Is a document of ``year`` too old for the academic year running at ``now``?"""
    window = max_age if max_age is not None else max_age_years()
    current = academic_year(now, country)
    label = academic_year_label(current, country)
    if year is None:
        return Staleness(
            stale=None,
            year=None,
            academic_year=current,
            max_age_years=window,
            detail="the document does not say which year it is",
        )
    age = current - year
    if age > window:
        return Staleness(
            stale=True,
            year=year,
            academic_year=current,
            max_age_years=window,
            detail=(
                f"the document is the {year} edition and the academic year is {label}, "
                f"{age} years on — more than the {window} this is allowed to be"
            ),
        )
    return Staleness(
        stale=False,
        year=year,
        academic_year=current,
        max_age_years=window,
        detail=f"the document is the {year} edition, inside {label} by {window} years",
    )


def verdict(
    document,
    *,
    reading_version: str | None = None,
    now: datetime | None = None,
    country: str | None = None,
    max_age: int | None = None,
) -> tuple[Staleness, Evidence | None]:
    """The whole question in one call: who answered, and whether it is still this year's."""
    witness = edition_evidence(document, reading_version)
    return (
        staleness(witness.year if witness else None, now=now, country=country, max_age=max_age),
        witness,
    )
