"""Google Postmaster Tools, read once a day: Gmail's own view of our mail.

WHY IT MATTERS MORE THAN IT LOOKS. Gmail sends no complaint to the mail provider, so a Gmail reader
pressing "Report spam" never reaches :mod:`.events`. Gmail is most of the addresses we write to
(docs/MAIL-PRIMARY.md: roughly 87 percent in India), so for most families this reader IS the
complaint rate.

THE API IS V2. Google retired Postmaster Tools API v1 on 2025-10-31, and the domain reputation
grade (HIGH, MEDIUM, LOW, BAD) went with it; v2 has no grade at all. What v2 gives, and what is
read here for the previous day:

* ``POST /v2/domains/{domain}/domainStats:query`` with the standard metrics ``SPAM_RATE``,
  ``FEEDBACK_LOOP_ID`` (the Feedback-ID identifiers Google saw), ``FEEDBACK_LOOP_SPAM_RATE`` per
  identifier (``feedback_loop_id = "<id>"``), and ``AUTH_SUCCESS_RATE`` per mechanism
  (``auth_type = "spf" | "dkim" | "dmarc"``);
* ``GET /v2/domains/{domain}:getComplianceStatus``: each sender requirement (SPF, DKIM, DMARC,
  one-click unsubscribe, the spam rate) as COMPLIANT or NEEDS_WORK, and the deliverability verdict
  with its reason. "Reputation below medium" is read from this: a verdict whose reason names a
  problem, or a requirement that needs work (:mod:`.respond`).

INERT UNTIL CONFIGURED. Three environment variables, all required: ``POSTMASTER_CLIENT_ID``,
``POSTMASTER_CLIENT_SECRET`` and ``POSTMASTER_REFRESH_TOKEN`` (an OAuth refresh token for the
Google account that verified the domain, granted
``https://www.googleapis.com/auth/postmaster.traffic.readonly``). ``POSTMASTER_DOMAIN`` names the
domain as registered in Postmaster Tools, and defaults to the sending domain (the one in
``EMAIL_FROM``). Without the three, no call is made and the desk says "not configured". No
credential and no token ever reaches a report, a log line or the desk.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

from wobo_gateway import email as email_mod
from wobo_gateway.email_templates import KINDS
from wobo_gateway.mailwatch import respond, store

logger = logging.getLogger("wobo.gateway.mailwatch")

TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://gmailpostmastertools.googleapis.com/v2"
SCOPE = "https://www.googleapis.com/auth/postmaster.traffic.readonly"
CLIENT_ID_ENV = "POSTMASTER_CLIENT_ID"
CLIENT_SECRET_ENV = "POSTMASTER_CLIENT_SECRET"
REFRESH_TOKEN_ENV = "POSTMASTER_REFRESH_TOKEN"
DOMAIN_ENV = "POSTMASTER_DOMAIN"
MECHANISMS: tuple[str, ...] = ("spf", "dkim", "dmarc")
#: How many Feedback-ID identifiers one day's second query asks about.
MAX_FEEDBACK_IDS = 50
_HTTP_TIMEOUT_S = 15.0
NOTE = (
    "Google retired Postmaster Tools API v1, and the domain reputation grade with it, on "
    "2025-10-31. This reads v2: Gmail's spam rate overall and per Feedback-ID, the SPF, DKIM and "
    "DMARC pass rates, and the compliance verdict that replaced the grade."
)

Http = Callable[..., tuple[int, Any]]


class Unavailable(Exception):
    """Google did not answer, or answered with an error. A reason, never a secret."""


def configured() -> bool:
    return all(
        (os.getenv(name) or "").strip()
        for name in (CLIENT_ID_ENV, CLIENT_SECRET_ENV, REFRESH_TOKEN_ENV)
    )


def domain() -> str:
    return (os.getenv(DOMAIN_ENV) or "").strip().lower() or email_mod._list_domain()


def _http(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: Any = None,
    form: dict[str, str] | None = None,
) -> tuple[int, Any]:
    """One call to Google over stdlib. Returns the status and the parsed body."""
    sent_headers = {"Accept": "application/json", **(headers or {})}
    data: bytes | None = None
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        sent_headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode()
        sent_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=sent_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
            raw = response.read().decode()
            status = response.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode(errors="replace")
        status = exc.code
    try:
        parsed = json.loads(raw) if raw.strip() else {}
    except ValueError:
        parsed = {}
    return status, parsed


def _call(http: Http, method: str, url: str, **kw: Any) -> Any:
    try:
        status, answer = http(method, url, **kw)
    except Exception as exc:  # noqa: BLE001 — the network is a reason, never a crash
        raise Unavailable(type(exc).__name__) from exc
    if status != 200 or not isinstance(answer, dict):
        raise Unavailable(f"status {status}")
    return answer


def _token(http: Http) -> str:
    answer = _call(
        http,
        "POST",
        TOKEN_URL,
        form={
            "client_id": os.getenv(CLIENT_ID_ENV, "").strip(),
            "client_secret": os.getenv(CLIENT_SECRET_ENV, "").strip(),
            "refresh_token": os.getenv(REFRESH_TOKEN_ENV, "").strip(),
            "grant_type": "refresh_token",
        },
    )
    token = answer.get("access_token")
    if not isinstance(token, str) or not token:
        raise Unavailable("no access token")
    return token


def _value(stat: dict[str, Any]) -> Any:
    value = stat.get("value")
    if not isinstance(value, dict):
        return None
    for field in ("doubleValue", "floatValue"):
        if isinstance(value.get(field), int | float):
            return float(value[field])
    if value.get("intValue") is not None:
        try:
            return float(value["intValue"])
        except (TypeError, ValueError):
            return None
    listed = value.get("stringList")
    if isinstance(listed, dict) and isinstance(listed.get("values"), list):
        return [str(v) for v in listed["values"]]
    if isinstance(value.get("stringValue"), str):
        return value["stringValue"]
    return None


def _values(answer: dict[str, Any], names: set[str]) -> dict[str, Any]:
    """Each requested metric's value, by the name it was requested under."""
    out: dict[str, Any] = {}
    for stat in answer.get("domainStats") or []:
        if not isinstance(stat, dict):
            continue
        label = next(
            (
                str(candidate).rsplit("/", 1)[-1]
                for candidate in (stat.get("metric"), stat.get("name"))
                if candidate and str(candidate).rsplit("/", 1)[-1] in names
            ),
            None,
        )
        if label is not None:
            out[label] = _value(stat)
    return out


def _query(day: date, definitions: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "metricDefinitions": definitions,
        "timeQuery": {
            "dateList": {"dates": [{"year": day.year, "month": day.month, "day": day.day}]}
        },
        "pageSize": 200,
    }


def kind_of_feedback_id(identifier: str) -> str | None:
    """Which of our kinds a Feedback-ID identifier names: the kind is its first field."""
    for part in str(identifier).split(":"):
        name = part.strip().replace("-", "_")
        if name in KINDS:
            return name
    return None


def read_day(day: date, *, http: Http) -> dict[str, Any] | None:
    """Google's reading of ``day``, or ``None`` when Google has not published it yet."""
    token = _token(http)
    auth = {"Authorization": f"Bearer {token}"}
    name = domain()
    stats_url = f"{API}/domains/{name}/domainStats:query"
    first = [
        {"name": "spam_rate", "baseMetric": {"standardMetric": "SPAM_RATE"}},
        {"name": "fbl_ids", "baseMetric": {"standardMetric": "FEEDBACK_LOOP_ID"}},
        *(
            {
                "name": f"auth_{m}",
                "baseMetric": {"standardMetric": "AUTH_SUCCESS_RATE"},
                "filter": f'auth_type = "{m}"',
            }
            for m in MECHANISMS
        ),
    ]
    found = _values(
        _call(http, "POST", stats_url, headers=auth, body=_query(day, first)),
        {d["name"] for d in first},
    )
    if not found:
        return None
    ids = [i for i in (found.get("fbl_ids") or []) if isinstance(i, str) and '"' not in i]
    ids = ids[:MAX_FEEDBACK_IDS]
    kinds: dict[str, float] = {}
    if ids:
        second = [
            {
                "name": f"fbl_{n}",
                "baseMetric": {"standardMetric": "FEEDBACK_LOOP_SPAM_RATE"},
                "filter": f'feedback_loop_id = "{identifier}"',
            }
            for n, identifier in enumerate(ids)
        ]
        rates = _values(
            _call(http, "POST", stats_url, headers=auth, body=_query(day, second)),
            {d["name"] for d in second},
        )
        for n, identifier in enumerate(ids):
            rate = rates.get(f"fbl_{n}")
            kind = kind_of_feedback_id(identifier)
            if kind is not None and isinstance(rate, float):
                kinds[kind] = max(kinds.get(kind, 0.0), rate)
    compliance = _call(http, "GET", f"{API}/domains/{name}:getComplianceStatus", headers=auth)
    needs: list[str] = []
    verdict: dict[str, str] = {"state": "", "reason": ""}
    for block_name in ("complianceData", "subdomainComplianceData"):
        block = compliance.get(block_name)
        if not isinstance(block, dict):
            continue
        for row in block.get("rowData") or []:
            if not isinstance(row, dict):
                continue
            status = (row.get("status") or {}).get("status")
            requirement = str(row.get("requirement") or "")
            if status == "NEEDS_WORK" and requirement and requirement not in needs:
                needs.append(requirement)
        told = block.get("deliverabilityStatusVerdict")
        if isinstance(told, dict) and not verdict["reason"]:
            state = told.get("state") or told.get("status") or {}
            verdict = {
                "state": str(state.get("status") if isinstance(state, dict) else state or ""),
                "reason": str(told.get("reason") or ""),
            }
    spam_rate = found.get("spam_rate")
    return {
        "day": day.isoformat(),
        "domain": name,
        "spam_rate": spam_rate if isinstance(spam_rate, float) else None,
        "kinds": kinds,
        "feedback_ids": ids,
        "auth": {
            m: found[f"auth_{m}"] for m in MECHANISMS if isinstance(found.get(f"auth_{m}"), float)
        },
        "verdict": verdict,
        "needs_work": needs,
    }


def _key(day: date, name: str) -> str:
    return f"{store.POSTMASTER}:{day.isoformat()}:{name}"


def run_postmaster(now: datetime, *, http: Http | None = None) -> dict[str, Any]:
    """Read yesterday once, and answer it. Inert, and says so, until configured."""
    if not configured():
        return {"configured": False}
    moment = now.astimezone(UTC)
    day = moment.date() - timedelta(days=1)
    name = domain()
    watch = store.get_store()
    if watch.has(_key(day, name)):
        return {"configured": True, "read": None, "day": day.isoformat(), "already": True}
    try:
        reading = read_day(day, http=http or _http)
    except Unavailable as exc:
        logger.warning(
            "mail watch: Postmaster Tools unavailable", extra={"fields": {"why": str(exc)}}
        )
        return {"configured": True, "read": None, "day": day.isoformat(), "error": "unavailable"}
    if reading is None:
        return {"configured": True, "read": None, "day": day.isoformat()}
    watch.add(
        store.WatchRow(
            what=store.POSTMASTER, key=_key(day, name), at=moment, event="read", detail=reading
        )
    )
    answered = respond.evaluate_postmaster(reading, moment)
    return {"configured": True, "read": day.isoformat(), **answered}


def desk_view() -> dict[str, Any]:
    """The latest day Google published, or nothing, with the note on what v2 can and cannot say."""
    if not configured():
        return {"configured": False, "reading": None, "note": NOTE}
    rows = store.get_store().rows(store.POSTMASTER)
    reading = None
    if rows:
        latest = max(rows, key=lambda r: (str(r.detail.get("day")), r.at))
        reading = {**latest.detail, "read_at": latest.at.isoformat()}
    return {"configured": True, "reading": reading, "note": NOTE}


__all__ = [
    "API",
    "CLIENT_ID_ENV",
    "CLIENT_SECRET_ENV",
    "DOMAIN_ENV",
    "MECHANISMS",
    "NOTE",
    "REFRESH_TOKEN_ENV",
    "SCOPE",
    "TOKEN_URL",
    "Unavailable",
    "configured",
    "desk_view",
    "domain",
    "kind_of_feedback_id",
    "read_day",
    "run_postmaster",
]
