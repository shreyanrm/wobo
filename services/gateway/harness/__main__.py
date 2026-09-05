"""Run the teaching harness.

    cd services/gateway

    uv run python -m harness --live              every question, real models, real money
    uv run python -m harness --live --case math  only the questions whose id contains "math"
    uv run python -m harness --replay            the recorded transcripts, free, for CI
    uv run python -m harness --live --no-judge   arithmetic checks only, cheaper

It is deliberately NOT a pytest file. It calls real models and the owner pays, so it runs when
somebody asks for it and never as a side effect of ``bun test`` or ``uv run pytest``.

Exit code 0 when nothing false, unverified or forbidden reached a learner; 1 when something did.
The report is the point, though: read it rather than the exit code.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from harness import cases as case_bank
from harness import checks, drawing, judge, ladder, report, runner

REPORTS = Path(__file__).resolve().parent / "reports"


def _parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="harness", description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--live", action="store_true", help="call real models (this spends the owner's money)"
    )
    mode.add_argument(
        "--replay",
        action="store_true",
        help="score the recorded transcripts in fixtures/ (free, no network)",
    )
    parser.add_argument("--case", default="", help="only questions whose id contains this")
    parser.add_argument(
        "--no-judge", action="store_true", help="skip the second opinion (cheaper, blinder)"
    )
    parser.add_argument(
        "--no-ladder", action="store_true", help="skip the re-teach ladder end-to-end check"
    )
    parser.add_argument("--out", default=str(REPORTS), help="where to write the report")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    from datetime import UTC, datetime

    args = _parse(list(sys.argv[1:] if argv is None else argv))
    live = bool(args.live) or not args.replay
    if not args.live and not args.replay:
        print("Pick one: --live (spends money) or --replay (free).", file=sys.stderr)
        return 2

    if live:
        runner.load_dotenv(runner.REPO_ENV)
    runner.prepare_env(live=live)

    selected = [c for c in case_bank.CASES if args.case in c.id]
    if not selected:
        print(f"no question matches {args.case!r}", file=sys.stderr)
        return 2

    run = report.Run(
        mode="live" if live else "replay",
        started_at=datetime.now(UTC).isoformat(timespec="seconds"),
        providers=runner.providers_present() if live else {},
    )
    if not live:
        run.notes.append(
            "recorded transcripts: this run proves the CHECKS work, never that the tutor is "
            "answering well today"
        )

    client = runner.build_client() if live else None
    token = runner.mint_token() if live else ""

    for case in selected:
        if live:
            transcript = runner.run_case(client, case, token)
            runner.save(transcript)
        else:
            transcript = runner.load(case.id)
            if transcript is None:
                run.notes.append(f"no recorded transcript for {case.id}; it was skipped")
                continue

        if transcript.note:
            # A corrected recording is not evidence about the tutor: say so where it is read.
            run.notes.append(f"{case.id}: {transcript.note}")
        scored = checks.score_transcript(case, transcript)
        if not transcript.error:
            drawing.check_drawing(case, transcript, scored)

        judge_model = ""
        if live and not args.no_judge and not transcript.error:
            verdict = judge.ask_judge(case, transcript)
            judge.apply_verdict(verdict, scored)
            judge_model = str(verdict.get("model") or "")
            run.judge_cost_usd += float(verdict.get("cost_usd") or 0.0)
            if judge_model and not run.judge_model:
                run.judge_model = judge_model

        run.cases.append(
            report.CaseReport(
                case_id=case.id,
                board=case.board,
                grade=case.grade,
                subject=case.subject,
                ask=case.ask,
                scores=scored.scores,
                findings=scored.findings,
                say=transcript.say,
                objects_drawn=len(transcript.objects),
                verified_checks=transcript.verified,
                cost_usd=transcript.cost_usd,
                elapsed_ms=transcript.elapsed_ms,
                judge_model=judge_model,
            )
        )
        run.cost_usd += transcript.cost_usd
        run.model_calls += transcript.model_calls

    if live and not args.no_ladder:
        result = ladder.run(client, token)
        run.cost_usd += result.cost_usd
        run.cases.append(
            report.CaseReport(
                case_id="teach.reteach.ladder",
                board="CBSE",
                grade="Class 7",
                subject="mathematics",
                ask=(
                    "two misses on one concept, then two more: does Wobo change approach by "
                    "itself, and does the new approach actually teach differently"
                ),
                scores=result.scored.scores,
                findings=result.scored.findings,
                # Every rung in full: the owner reads what Wobo said, not the first 160 characters.
                say=" | ".join(t.say for t in result.transcripts),
                objects_drawn=sum(len(t.objects) for t in result.transcripts),
                cost_usd=result.cost_usd,
            )
        )

    # The judge is meant to be the OTHER mind. Say plainly when it was not.
    if run.judge_model:
        from wobo_gateway.routing import Tier, tier_primary

        tutor = tier_primary(Tier.TURN)
        run.judge_shares_provider_with_tutor = run.judge_model.split("/")[0] == tutor.split("/")[0]

    markdown, data = report.write(run, Path(args.out))
    print(report.render(run))
    print(f"\nwritten to {markdown}\n           {data}", file=sys.stderr)
    return 1 if run.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
