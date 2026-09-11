"""The architect's lab: make ONE real blueprint and write it where anybody can read it.

    uv run python -m harness.blueprint_lab            # Luna on both rungs, judged on verify
    uv run python -m harness.blueprint_lab --dry-run  # the brief and the prompt, no model call

**Why Luna and not Astra.** The wave's rule: in tests and labs the create tier is the mock or Luna
under the three-dollar local ceiling, and Astra is not called. ``create.blueprint`` is registered on
Tier.CREATE and stays there (``registry.py``); this lab only PINS the two rungs it hands
:func:`blueprint.build`, which is the seam that exists so a lab never has to move a capability off
its tier to be affordable.

**What it costs, and where that number comes from.** Every call is priced from
``routing.CATALOGUE``, which carries the vendor's own per-million rates, and the total is printed
and written into the report. Nothing here estimates.

The output lands in ``harness/reports/``:

  blueprint-<node>.run.json               the run: the models, the tokens, the money per call, the
                                          judge's verdict, and the refusals if it was held
  blueprint-<node>.json                   the blueprint, when one was served
  blueprint-<node>.held.json              every attempt ever refused for this cell, with reasons
  blueprint-<node>.best-held-attempt.json the fullest refused attempt on its own, labelled, so the
                                          superadmin the hold is FOR can read it without digging
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from wobo_gateway.plexus import blueprint as bp

REPORTS = Path(__file__).resolve().parent / "reports"

#: Class 8 CBSE Science, "Force and Pressure". The topics are the NCERT chapter's own sections, in
#: the book's order; nothing here is invented, which is the first thing the gate checks.
FORCE_AND_PRESSURE: dict[str, Any] = {
    "node": "cbse-8-science-force-and-pressure",
    "chapter": "Force and Pressure",
    "board": "CBSE",
    "grade": "8",
    "subject": "Science",
    "contentVersion": "2026-27",
    "topics": [
        {"id": "t1", "name": "Force: a push or a pull"},
        {"id": "t2", "name": "Forces are due to an interaction"},
        {"id": "t3", "name": "Exploring forces"},
        {"id": "t4", "name": "A force can change the state of motion"},
        {"id": "t5", "name": "Force can change the shape of an object"},
        {"id": "t6", "name": "Contact forces"},
        {"id": "t7", "name": "Non-contact forces"},
        {"id": "t8", "name": "Pressure"},
        {"id": "t9", "name": "Pressure exerted by liquids and gases"},
        {"id": "t10", "name": "Atmospheric pressure"},
    ],
    "minutesBudget": 420,
    "archetypes": [
        "the one who draws it before they trust it",
        "the one who checks the numbers",
        "the one who has to break it to believe it",
    ],
}


def _price(model: str) -> tuple[float, float]:
    from wobo_gateway.routing import CATALOGUE

    row = CATALOGUE.get(model)
    if row is None or row.per_million_in is None or row.per_million_out is None:
        return (0.0, 0.0)
    return (row.per_million_in, row.per_million_out)


class MeteredCaller:
    """The real caller, with the vendor's own price applied to the vendor's own token counts."""

    def __init__(self, label: str) -> None:
        self.label = label
        self.calls: list[dict[str, Any]] = []

    def __call__(self, *, model: str, system: str, user: str, max_tokens: int) -> str:
        from wobo_gateway.model_call import complete as model_complete

        started = datetime.now(UTC)
        response = model_complete(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            max_tokens=max_tokens,
            temperature=0.4,
            timeout=300,
        )
        usage = getattr(response, "usage", None)
        tin = int(getattr(usage, "prompt_tokens", 0) or 0)
        tout = int(getattr(usage, "completion_tokens", 0) or 0)
        per_in, per_out = _price(model)
        usd = (tin / 1_000_000) * per_in + (tout / 1_000_000) * per_out
        self.calls.append(
            {
                "what": self.label,
                "model": model,
                "tokensIn": tin,
                "tokensOut": tout,
                "usd": round(usd, 6),
                "seconds": round((datetime.now(UTC) - started).total_seconds(), 1),
            }
        )
        text = response.choices[0].message.content or ""
        print(
            f"  {self.label:<10} {model:<24} in {tin:>6}  out {tout:>6}  "
            f"USD {usd:.4f}  {self.calls[-1]['seconds']}s",
            flush=True,
        )
        return text

    @property
    def usd(self) -> float:
        return sum(c["usd"] for c in self.calls)


def _luna() -> str:
    from wobo_gateway.routing import Tier, tier_chain

    return tier_chain(Tier.GENERATE)[0]


def _verify_model() -> str:
    from wobo_gateway.routing import Tier, tier_chain

    return tier_chain(Tier.VERIFY)[0]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="make one real blueprint")
    parser.add_argument("--dry-run", action="store_true", help="print the brief and stop")
    parser.add_argument("--ceiling", type=float, default=3.0, help="local USD ceiling")
    args = parser.parse_args(argv)

    brief = bp.NodeBrief.from_dict(FORCE_AND_PRESSURE)
    if args.dry_run:
        print(json.dumps(bp.brief_payload(brief), indent=2, ensure_ascii=False))
        print("\n--- system prompt ---\n")
        print(bp.SYSTEM)
        return 0

    architect = MeteredCaller("architect")
    judge = MeteredCaller("judge")
    luna, verifier = _luna(), _verify_model()
    print(f"architect: {luna} (both rungs; Astra is not called in this wave)")
    print(f"judge:     {verifier}\n")

    result = bp.build(
        brief,
        caller=architect,
        judge_caller=judge,
        judge_model=verifier,
        models=(luna, luna),
    )

    total = architect.usd + judge.usd
    print(f"\nstatus: {result.status}   attempts: {result.attempts}   USD {total:.4f}")
    if total > args.ceiling:
        print(f"WARNING: the run cost USD {total:.4f}, over the local ceiling of {args.ceiling}")

    REPORTS.mkdir(parents=True, exist_ok=True)
    stem = f"blueprint-{brief.node}"
    run = {
        "node": brief.node,
        "chapter": brief.chapter,
        "board": brief.board,
        "grade": brief.grade,
        "subject": brief.subject,
        "contentVersion": brief.content_version,
        "ranAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "status": result.status,
        "attempts": result.attempts,
        "calls": [*architect.calls, *judge.calls],
        "usdTotal": round(total, 6),
        "verdict": result.verdict,
        "reasons": list(result.reasons),
    }
    (REPORTS / f"{stem}.run.json").write_text(
        json.dumps(run, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    if result.blueprint is not None:
        payload = result.blueprint.model_dump(mode="json")
        (REPORTS / f"{stem}.json").write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"wrote {REPORTS / f'{stem}.json'}")
    else:
        held = bp.held(brief)
        (REPORTS / f"{stem}.held.json").write_text(
            json.dumps(held, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"HELD. every attempt is in {REPORTS / f'{stem}.held.json'}")
        # A held run still produced something a person can read, and the point of the hold is that
        # a PERSON reads it. The best attempt of this run is written out on its own, labelled with
        # what it was refused for, so nobody has to dig it out of the ledger — and labelled loudly
        # enough that nobody mistakes it for a blueprint that was served.
        best = max(
            (row for row in held if row.get("artifact")),
            key=lambda row: len((row["artifact"] or {}).get("modules", [])),
            default=None,
        )
        if best is not None:
            (REPORTS / f"{stem}.best-held-attempt.json").write_text(
                json.dumps(
                    {
                        "WARNING": (
                            "HELD, never served. This attempt was refused and no learner has ever "
                            "seen it. It is here so a person can read what the architect produced."
                        ),
                        "refusedFor": best["reasons"],
                        "model": best["provenance"]["model"],
                        "blueprint": best["artifact"],
                    },
                    indent=2,
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            print(f"wrote {REPORTS / f'{stem}.best-held-attempt.json'}")
    print(f"wrote {REPORTS / f'{stem}.run.json'}")
    return 0 if result.status == bp.CANONICAL else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
