"""Run the discovery pipeline for real, offline, and keep every artefact.

The pipeline in this package was built in September 2026 and never run:
``WOBO_DISCOVERY_WORKER`` has never been set on Railway, so no board has ever been discovered in
production. This module is how it is run by hand, against a **local in-memory job store**, so a
run can be watched stage by stage before the switch is thrown on the real registry.

**It cannot touch production.** The store is :class:`~.job.InMemoryJobStore`; nothing here
imports :mod:`wobo_gateway.curriculum.persist` or the Supabase store, and every artefact is
written to ``harness/reports/``. The only network it touches is the web-search provider and the
board's own document host.

Run it::

    cd services/gateway
    DAILY_SPEND_CEILING_USD=3 uv run python -m wobo_gateway.curriculum.discovery.lab \\
        --board msbshse --board upmsp --board tn-dge --level "Class 10" --subject Mathematics

Every model call goes through the router. The READING tiers are pinned to the cheapest rung
(:data:`LUNA`) and the SECOND READER to another provider's floor (:data:`SECOND_READER`), so a run
is cheap and is still two minds; the run stops the moment the platform's spend ceiling would be
crossed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

#: The cheapest rung. The owner's cost rule (docs/CONSOLE-MODELS.md) and this brief both pin
#: a discovery run here: a syllabus read is a long document and a cheap model reading it twice
#: is the affordable shape.
LUNA = "openai/gpt-5.6-luna"

#: What a pinned tier falls back to when Luna's own provider is down. A fallback on one account
#: is not a fallback (``routing._read_table`` says so), so the chain crosses providers — but it
#: stays on the floor of each one, so a run pinned to the cheap rung can never climb to a
#: frontier model by losing one call.
FLOOR_CHAIN = "anthropic/claude-haiku-4-5,gemini/gemini-2.5-flash"

#: The SECOND reader, and it may not be :data:`LUNA`. In production the generate tier is Luna and
#: the verify tier is Sol, which is two minds; the first live run pinned every tier to the cheap
#: rung and its provenance said ``extractor_model: gpt-5.6-luna, verifier_model: gpt-5.6-luna``.
#: One model agreeing with itself is not the second reader the law asks for, so the lab's second
#: reader is another provider's floor: cheap, and genuinely somebody else.
SECOND_READER = "gemini/gemini-2.5-flash"

REPO = Path(__file__).resolve().parents[6]
REPORTS = REPO / "services" / "gateway" / "harness" / "reports"
SEED = REPO / "content" / "curriculum" / "frameworks.seed.json"


# --- the environment a run needs ------------------------------------------------------------
def load_env(path: Path | None = None) -> list[str]:
    """``.env.local`` into the environment, names returned, values never printed or logged."""
    path = path or (REPO / ".env.local")
    names: list[str] = []
    if not path.is_file():
        return names
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name, value = name.strip(), value.strip().strip('"').strip("'")
        if not name or not value or name in os.environ:
            continue
        os.environ[name] = value
        names.append(name)
    if os.environ.get("GOOGLE_AI_API_KEY") and not os.environ.get("GEMINI_API_KEY"):
        os.environ["GEMINI_API_KEY"] = os.environ["GOOGLE_AI_API_KEY"]
        names.append("GEMINI_API_KEY")
    return names


def isolate_dials() -> None:
    """Read no dial from production. The lab runs on the documented defaults, always.

    ``ceiling.py`` reads ``ops.settings`` through :mod:`wobo_gateway.dials`, and with
    ``.env.local`` loaded that store is the real project's. A lab run must not depend on, or
    quietly reflect, whatever the console happens to be set to — and the point of this harness is
    that it touches nothing of production's. So every dial reads as unset here, which is exactly
    the state the owner's gateway is in before they turn any of them.
    """
    from wobo_gateway import dials

    dials.values = lambda: {}  # type: ignore[assignment]


def pinned_environment(model: str = LUNA, second_reader: str = SECOND_READER) -> dict[str, str]:
    """What pinning a discovery run to one rung means, as environment, computed and not applied.

    A discovery touches four tiers: search picks a provider model off ``generate``/``verify``,
    the extraction runs on ``generate`` (or ``reason`` for a first extraction), and the second
    reader runs on ``verify``. Pinning the chain as well as the primary stops a rejection from
    climbing to a model the run did not budget for.

    The generation LADDER is the one thing that cannot be pinned to a single id: the router
    refuses a one-rung ladder in its own words ("a ladder of one is not a ladder"), and it is
    right to — a ladder with no second rung is a tier, and saying it twice would hide that. So
    the ladder is the floor of two providers, which is a real ladder that still cannot climb.
    """
    floor = [rung for rung in FLOOR_CHAIN.split(",") if rung and rung != model]
    verify_chain = [rung for rung in (model, *floor) if rung != second_reader]
    return {
        "WOBO_GENERATION_LADDER": ",".join([model, *floor[:1]]),
        "WOBO_TIER_GENERATE": model,
        "WOBO_TIER_GENERATE_CHAIN": FLOOR_CHAIN,
        # Another provider's floor, never the reading model: two minds, both cheap.
        "WOBO_TIER_VERIFY": second_reader,
        "WOBO_TIER_VERIFY_CHAIN": ",".join(verify_chain),
        "WOBO_TIER_REASON": model,
        "WOBO_TIER_REASON_CHAIN": FLOOR_CHAIN,
    }


def pin_ladder(model: str = LUNA, second_reader: str = SECOND_READER) -> dict[str, str]:
    """Apply :func:`pinned_environment` and rebuild the router from it."""
    pinned = pinned_environment(model, second_reader)
    os.environ.update(pinned)
    from wobo_gateway import routing

    routing.configure()
    return pinned


# --- the boards -------------------------------------------------------------------------------
def framework(board_id: str) -> dict[str, Any]:
    """One framework out of the registry seed, by id. The board's own name, site and aliases."""
    seed = json.loads(SEED.read_text(encoding="utf-8"))
    for entry in seed.get("frameworks", ()):
        if entry.get("id") == board_id:
            return entry
    raise SystemExit(f"no framework {board_id!r} in {SEED}")


def request_for(board_id: str, level: str, subject: str) -> Any:
    """A :class:`SyllabusRequest` carrying everything the registry knows about this board."""
    from wobo_gateway.curriculum.discovery.extract import SyllabusRequest

    entry = framework(board_id)
    return SyllabusRequest(
        framework_id=entry["id"],
        framework_name=entry["name"],
        level=level,
        subject=subject,
        framework_kind=entry.get("kind") or "state",
        country=entry.get("country"),
        official_site=entry.get("official_site"),
        aliases=tuple(entry.get("aliases") or ()),
    )


# --- what one run records ----------------------------------------------------------------------
@dataclass
class StageLog:
    """Everything the run saw, stage by stage, so a refusal can be read rather than guessed."""

    queries: list[str] = field(default_factory=list)
    search_results: list[dict[str, Any]] = field(default_factory=list)
    searches_run: int = 0
    fetches: list[dict[str, Any]] = field(default_factory=list)
    extractions: list[dict[str, Any]] = field(default_factory=list)
    verifications: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "queries": self.queries,
            "search_results": self.search_results,
            "searches_run": self.searches_run,
            "fetched": self.fetches,
            "extracted": self.extractions,
            "verified": self.verifications,
            "errors": self.errors,
        }


class _WatchedSearch:
    """The real provider, with every query and every result written down."""

    def __init__(self, inner: Any, log: StageLog) -> None:
        self.inner = inner
        self.name = getattr(inner, "name", "search")
        self.log = log

    def search(self, query: str, *, limit: int = 5) -> list[Any]:
        self.log.queries.append(query)
        try:
            results = self.inner.search(query, limit=limit)
        except Exception as exc:  # noqa: BLE001 — the log is the point of this run
            self.log.errors.append(f"search {query!r}: {type(exc).__name__}: {exc}")
            raise
        self.log.searches_run = getattr(self.inner, "searches_run", self.log.searches_run)
        for result in results:
            self.log.search_results.append(
                {
                    "query": query,
                    "url": result.url,
                    "title": result.title,
                    "why": result.snippet,
                    "host": result.host,
                    "is_pdf": result.is_pdf,
                }
            )
        return results

    @property
    def searches_run(self) -> int:
        return getattr(self.inner, "searches_run", 0)


def _watched_fetch(log: StageLog) -> Any:
    from wobo_gateway.curriculum.discovery.fetch import fetch_document

    def fetch(url: str, **kwargs: Any) -> Any:
        started = time.monotonic()
        try:
            document = fetch_document(url, **kwargs)
        except Exception as exc:  # noqa: BLE001
            log.fetches.append(
                {
                    "url": url,
                    "ok": False,
                    "reason": getattr(exc, "reason", type(exc).__name__),
                    "detail": str(exc)[:300],
                    "elapsed_s": round(time.monotonic() - started, 2),
                }
            )
            raise
        log.fetches.append(
            {
                "url": url,
                "ok": True,
                "media_type": document.media_type,
                "title": document.title,
                "bytes": document.bytes,
                "pages": len(document.pages),
                "document_pages": document.source_pages,
                "pages_dropped": document.pages_dropped,
                "truncated": document.truncated,
                "chars": sum(len(page.text) for page in document.pages),
                "document_sha256": document.document_sha256,
                "extraction": document.extraction,
                # When the FILE says it was made. The 2026-09-15 run had no line for this and so
                # could not say that Maharashtra's pdf was produced in 2013 (``dating.py``).
                "created_at": document.created_at,
                "modified_at": document.modified_at,
                "elapsed_s": round(time.monotonic() - started, 2),
            }
        )
        return document

    return fetch


def _watched_completion(log: StageLog, bucket: list[dict[str, Any]], tier_name: str) -> Any:
    """A ``Completion`` that runs the real tier call and writes down what came back."""
    from wobo_gateway.curriculum.discovery.extract import tier_complete
    from wobo_gateway.routing import Tier

    tier = Tier(tier_name)

    def complete(system: str, user: str) -> tuple[str, str]:
        started = time.monotonic()
        try:
            text, model = tier_complete(tier, system=system, user=user)
        except Exception as exc:  # noqa: BLE001
            bucket.append(
                {
                    "tier": tier_name,
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}"[:400],
                    "elapsed_s": round(time.monotonic() - started, 2),
                }
            )
            log.errors.append(f"{tier_name}: {type(exc).__name__}: {exc}"[:400])
            raise
        bucket.append(
            {
                "tier": tier_name,
                "ok": True,
                "model": model,
                "prompt_chars": len(system) + len(user),
                "reply_chars": len(text),
                # The whole reply, not a head. The first run refused at the checks and the only
                # way to find out what the reader had actually said would have been to pay for
                # the run again; an artefact that cannot be read twice is not an artefact.
                "reply": text,
                "elapsed_s": round(time.monotonic() - started, 2),
            }
        )
        return text, model

    return complete


# --- one board ----------------------------------------------------------------------------------
def run_one(
    board_id: str,
    *,
    level: str,
    subject: str,
    out_dir: Path,
    second_reader: bool = True,
    wall_clock_s: float = 300.0,
) -> dict[str, Any]:
    """One discovery, end to end, against a local store. Returns the row for the report."""
    from wobo_gateway import spend
    from wobo_gateway.curriculum.discovery import search as search_stage
    from wobo_gateway.curriculum.discovery.job import (
        DiscoveryBudget,
        InMemoryJobStore,
        discovery_key,
        run_discovery,
    )

    request = request_for(board_id, level, subject)
    log = StageLog()
    store = InMemoryJobStore()
    budget = DiscoveryBudget(wall_clock_s=wall_clock_s)
    spent_before = spend.spent_usd()
    started = time.monotonic()

    provider: Any
    try:
        provider = _WatchedSearch(search_stage.build_search_provider(), log)
    except Exception as exc:  # noqa: BLE001
        log.errors.append(f"search provider: {type(exc).__name__}: {exc}")
        provider = None

    record = None
    failure: str | None = None
    try:
        record = run_discovery(
            request,
            store=store,
            meter_subject=None,
            search_provider=provider,
            fetch_fn=_watched_fetch(log),
            complete_generate=_watched_completion(log, log.extractions, "generate"),
            complete_verify=_watched_completion(log, log.verifications, "verify"),
            budget=budget,
            second_reader=second_reader,
        )
    except Exception:  # noqa: BLE001 — a crash in a never-run pipeline is the finding
        failure = traceback.format_exc()
        log.errors.append(failure.strip().splitlines()[-1])

    elapsed = round(time.monotonic() - started, 1)
    spent = round(spend.spent_usd() - spent_before, 6)
    from wobo_gateway.curriculum.discovery import ceiling

    row: dict[str, Any] = {
        "board": board_id,
        "board_spent_today_usd": round(ceiling.state().by_board.get(board_id, 0.0), 6),
        "board_ceiling_usd": ceiling.board_ceiling_usd(),
        "framework_name": request.framework_name,
        "official_site": request.official_site,
        "aliases": list(request.aliases),
        "level": level,
        "subject": subject,
        "key": discovery_key(request),
        "elapsed_s": elapsed,
        "spent_usd": spent,
        "crash": failure,
        "stages": log.as_dict(),
    }
    if record is not None:
        row.update(
            {
                "state": record.state.value,
                "status": record.status,
                "reason": record.reason,
                "detail": record.detail,
                # Every candidate the run opened, not only the last one that failed. The first
                # runs recorded the last failure alone, which is how Tamil Nadu's row came to
                # read as a TLS fault worth retrying when what actually happened is that its one
                # candidate was a scheme of examination from the exam directorate.
                "tried": list(record.tried),
                "message": record.message,
                "history": [list(step) for step in record.history],
                "units": len(((record.syllabus or {}).get("units")) or ()),
                "would_publish": record.state.value == "provisional",
                "document_year": _document_year(record),
                "provenance": record.provenance,
                "report": record.report,
                "syllabus": record.syllabus,
            }
        )
    (out_dir / f"{board_id}.json").write_text(
        json.dumps(row, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return row


def _document_year(record: Any) -> dict[str, Any] | None:
    """What year the run decided the document was, and who said so (``dating.py``).

    On the report the fault was found in, the answer existed nowhere: the reading said 2013 in a
    field nothing compared to anything, and the file's own 2013 was never read at all.
    """
    from wobo_gateway.curriculum.discovery import verify

    for check in (record.report or {}).get("checks") or []:
        if check.get("name") == verify.CHECK_DOCUMENT_YEAR:
            return {"passed": check.get("passed"), "detail": check.get("detail")}
    if record.reason == "document_out_of_date":
        return {"passed": False, "detail": record.detail}
    return None


def _year_line(row: dict[str, Any]) -> str:
    """One line a person can act on. "not asked" is the answer this run used to give silently."""
    year = row.get("document_year")
    if not year:
        return "not asked"
    verdict = {True: "current", False: "OUT OF DATE", None: "the document does not say"}[
        year.get("passed")
    ]
    return f"{verdict} — {year.get('detail') or ''}".strip(" —")


# --- the report ---------------------------------------------------------------------------------
def _markdown(rows: list[dict[str, Any]], meta: dict[str, Any]) -> str:
    lines = [
        "# Discovery, run for the first time",
        "",
        f"Run {meta['run_id']}, {meta['started_at']}. Local in-memory job store; production was",
        "not touched. Reading pinned to "
        + meta["ladder"]
        + ", second reader "
        + meta["second_reader"]
        + f", spend ceiling {meta['ceiling']}.",
        "",
        "| board | level, subject | ended | reason | units | seconds | USD |",
        "|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        lines.append(
            "| {board} | {level}, {subject} | {state} | {reason} | {units} | {elapsed_s} | "
            "{spent_usd} |".format(
                board=row["board"],
                level=row["level"],
                subject=row["subject"],
                state=row.get("state") or ("CRASH" if row.get("crash") else "?"),
                reason=row.get("reason") or "-",
                units=row.get("units", 0),
                elapsed_s=row["elapsed_s"],
                spent_usd=row["spent_usd"],
            )
        )
    lines += ["", f"**Total spend: USD {meta['total_spent_usd']}.**", ""]
    for row in rows:
        stages = row["stages"]
        lines += [
            f"## {row['framework_name']} ({row['board']})",
            "",
            f"- queries planned: {len(stages['queries'])}",
            f"- web searches actually run: {stages['searches_run']}",
            f"- candidates found: {len(stages['search_results'])}",
            f"- documents fetched: {sum(1 for f in stages['fetched'] if f['ok'])}"
            f" of {len(stages['fetched'])} tried",
            f"- extraction calls: {len(stages['extracted'])}",
            f"- second-reader calls: {len(stages['verified'])}",
            f"- ended: {row.get('state')} ({row.get('reason') or 'no refusal'})",
            f"- would have published: {row.get('would_publish', False)}",
            f"- the document's year: {_year_line(row)}",
            "",
        ]
        for result in stages["search_results"][:8]:
            lines.append(f"  - candidate `{result['url']}` — {result['title']}")
        for fetched in stages["fetched"]:
            if fetched["ok"]:
                # "200 pages" about a 349-page file is a true count written as a false claim.
                # When anything was dropped the line says so, of how many, in the same breath.
                read = fetched["pages"]
                whole = fetched.get("document_pages") or read
                dropped = fetched.get("pages_dropped")
                count = f"{read} pages read of {whole}" if dropped else f"{read} pages"
                lines.append(
                    f"  - fetched `{fetched['url']}`: {count}, "
                    f"{fetched['bytes']} bytes, {fetched['elapsed_s']}s"
                    + (", truncated" if fetched.get("truncated") else "")
                )
            else:
                lines.append(f"  - refused `{fetched['url']}`: {fetched['reason']}")
        for error in stages["errors"]:
            lines.append(f"  - error: {error}")
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--board", action="append", default=[], help="framework id from the seed")
    parser.add_argument("--level", default="Class 10")
    parser.add_argument("--subject", default="Mathematics")
    parser.add_argument("--ladder", default=LUNA, help="the model the reading tiers are pinned to")
    parser.add_argument(
        "--second-reader", default=SECOND_READER, help="the verify tier; never the reading model"
    )
    parser.add_argument("--wall-clock-s", type=float, default=300.0)
    parser.add_argument("--no-second-reader", action="store_true")
    parser.add_argument("--label", default="")
    args = parser.parse_args(argv)

    boards = args.board or ["msbshse", "upmsp", "tn-dge"]
    load_env()
    os.environ["LLM_MODE"] = "live"
    os.environ.setdefault("DAILY_SPEND_CEILING_USD", "3")
    if args.second_reader == args.ladder:
        raise SystemExit("the second reader may not be the model that did the reading")
    pin_ladder(args.ladder, args.second_reader)
    isolate_dials()

    from wobo_gateway import spend

    run_id = datetime.now(UTC).strftime("%Y%m%d-%H%M%S") + (f"-{args.label}" if args.label else "")
    out_dir = REPORTS / f"discovery-{run_id}"
    out_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict[str, Any]] = []
    for board_id in boards:
        print(f"=== {board_id}: {args.level} {args.subject}", file=sys.stderr, flush=True)
        rows.append(
            run_one(
                board_id,
                level=args.level,
                subject=args.subject,
                out_dir=out_dir,
                second_reader=not args.no_second_reader,
                wall_clock_s=args.wall_clock_s,
            )
        )
        print(
            f"    -> {rows[-1].get('state')} {rows[-1].get('reason') or ''} "
            f"({rows[-1]['spent_usd']} USD)",
            file=sys.stderr,
            flush=True,
        )

    meta = {
        "run_id": run_id,
        "started_at": datetime.now(UTC).isoformat(),
        "ladder": args.ladder,
        "second_reader": args.second_reader,
        "ceiling": os.environ.get("DAILY_SPEND_CEILING_USD"),
        "boards": boards,
        "level": args.level,
        "subject": args.subject,
        "total_spent_usd": round(sum(row["spent_usd"] for row in rows), 6),
        "discovery_day": __import__(
            "wobo_gateway.curriculum.discovery.ceiling", fromlist=["ceiling"]
        )
        .state()
        .as_dict(),
        "platform_spent_usd_today": round(spend.spent_usd(), 6),
        "store": "InMemoryJobStore (production untouched)",
    }
    (out_dir / "run.json").write_text(
        json.dumps({"meta": meta, "boards": rows}, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "report.md").write_text(_markdown(rows, meta), encoding="utf-8")
    print(f"\nwrote {out_dir}", file=sys.stderr)
    print(_markdown(rows, meta))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
