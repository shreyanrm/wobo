"""Correct a recorded transcript's spoken line by hand, and have the product sign it.

    cd services/gateway
    uv run python -m harness.rerecord math.icse.9.pythagoras --say "..." --ask "..." \\
        --intents '[{"pipeline": "math", ...}]' --note "why"

Some recordings in ``fixtures/`` were made by a model on a bad day: correct numbers over flat
teaching, a right ratio under the wrong name, a promised method the board never did. The checks
were tightened to fail them, and a fixture that fails the checks is no use as the recorded example
the harness replays. Re-running a model is the honest fix and it is not free, so this is the other
honest fix: a person writes the line the product SHOULD have said, and nothing about it is taken on
trust. The board is built by the product's own pipelines from the intents given (or kept exactly as
recorded); the spoken line goes through ``spoken.enforce_board`` so every number in it is one the
learner gave, the verifier drew, or a written-out sum the CAS confirmed, and a line that breaks
that law is refused here rather than written down. The events are rebuilt by the same
``build_events`` the wire uses. The fixture carries a ``note`` saying it was corrected, and the
replay report says so too.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from wobo_verifier.gate import CheckResult

from harness import cases as case_bank
from harness import runner


def _events_to_frames(events: list[Any]) -> list[dict[str, Any]]:
    return [{"id": "", "type": e.type, "data": e.payload()} for e in events]


def rerecord(
    case_id: str,
    *,
    say: str,
    ask: str | None = None,
    ask_targets: list[str] | None = None,
    intents: list[dict[str, Any]] | None = None,
    objects: list[dict[str, Any]] | None = None,
    note: str = "",
) -> runner.Transcript:
    from wobo_gateway import spoken
    from wobo_gateway.board import stream
    from wobo_gateway.board.planner import Plan, plan_board

    case = case_bank.by_id(case_id)
    recorded = runner.load(case_id)
    if recorded is None:
        raise SystemExit(f"no recorded transcript for {case_id}")
    context = runner.payload_for(case)["payload"]["context"]

    if case.mode != "board":
        decided = spoken.audit(say, given=spoken.given_numbers(context), verified=set())
        if decided.unsaid:
            raise SystemExit(f"the line breaks the spoken-number law: {decided.unsaid}")
        output = {
            "say": say,
            "actions": recorded.actions,
            "verified": [c.name for c in decided.checks],
        }
        recorded.say = say
        recorded.verified = list(output["verified"])
        recorded.events = [{"id": "", "type": "output", "data": output}]
        recorded.note = note
        runner.save(recorded)
        return recorded

    ask_block = (
        {"prompt": ask, "targets": list(ask_targets or [])}
        if ask
        else (recorded.ask and {"prompt": recorded.ask.get("prompt"), "targets": recorded.ask.get("targets") or []})
    )
    if intents is not None or objects is not None:
        plan = plan_board(
            {"say": say, "intents": intents or [], "objects": objects or [], "ask": ask_block},
            context=context,
            board_context={},
        )
        if plan.refusals:
            raise SystemExit(f"the product refused part of the board: {plan.refusals}")
    else:
        # The recorded board, exactly as it was drawn, with its recorded ledger.
        plan = Plan(say=say, presentation=recorded.presentation or "plane")
        plan.objects = [dict(o) for o in recorded.objects]
        for name in recorded.verified:
            if not name.startswith(spoken.CHECK_PREFIX):
                plan.ledger.note(CheckResult(name=name, passed=True, detail="as recorded"))
        if ask_block:
            plan.ask = ask_block
    decided = spoken.enforce_board(plan, context)
    if decided.unsaid:
        raise SystemExit(f"the line breaks the spoken-number law: {decided.unsaid}")

    events = stream.build_events(plan)
    frames = _events_to_frames(events)
    recorded.say = " ".join(str(f["data"].get("text") or "") for f in frames if f["type"] == "say").strip()
    recorded.objects = [f["data"]["object"] for f in frames if f["type"] == "ink"]
    done = next(f["data"] for f in frames if f["type"] == "done")
    recorded.verified = [str(v) for v in done.get("verified") or []]
    recorded.refused = [str(r) for r in done.get("refused") or []]
    recorded.presentation = str(done.get("presentation") or plan.presentation)
    ask_frame = next((f["data"] for f in frames if f["type"] == "ask"), None)
    recorded.ask = ask_frame
    recorded.events = frames
    recorded.note = note
    runner.save(recorded)
    return recorded


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="harness.rerecord", description=__doc__)
    parser.add_argument("case_id")
    parser.add_argument("--say", required=True)
    parser.add_argument("--ask", default=None)
    parser.add_argument("--ask-target", action="append", default=[])
    parser.add_argument("--intents", default=None, help="JSON list of pipeline intents")
    parser.add_argument("--objects", default=None, help="JSON list of the model's own marks")
    parser.add_argument("--note", default="")
    args = parser.parse_args(argv)
    runner.prepare_env(live=False)
    transcript = rerecord(
        args.case_id,
        say=args.say,
        ask=args.ask,
        ask_targets=args.ask_target,
        intents=json.loads(args.intents) if args.intents else None,
        objects=json.loads(args.objects) if args.objects else None,
        note=args.note,
    )
    print(f"{transcript.case_id}: {len(transcript.objects)} object(s); verified {transcript.verified}")
    print(f"say: {transcript.say}")
    if transcript.ask:
        print(f"ask: {transcript.ask.get('prompt')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
