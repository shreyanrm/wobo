"""Does the re-teach ladder actually fire, end to end?

Wave 10 built the ladder (``apps/web-pwa/src/wobo/reteach.ts``) and the prerequisite bridge
(``apps/web-pwa/src/wobo/bridge.ts``). Both have unit tests. Neither had a test that the rung the
ladder chooses then reaches the tutor and comes back as a genuinely DIFFERENT lesson, which is the
only form of the claim a learner would notice.

This is that test, in two halves that have to meet in the middle:

1. ``ladder_probe.ts`` drives the real module with its real durable record and reports what it
   decided — the rung, the axis it moves, and the sentence Wobo is asked with.
2. That sentence goes through the real gateway turn, exactly as the app would send it, and the
   answer is marked: the ``draw`` rung has to actually produce ink, the ``their_world`` rung has to
   actually reach for the learner's world, and the second explanation has to differ from the first
   rather than being the same words again.

A ladder that changes a variable and produces the same lesson has changed nothing.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from harness import cases as case_bank
from harness import checks, runner
from harness.checks import NOTE, WEAK, WRONG, Scored

PROBE = Path(__file__).resolve().parent / "ladder_probe.ts"
REPO = Path(__file__).resolve().parents[3]

TOPIC = "equivalent fractions"
WORLD = "cricket"

#: Two answers this similar are the same answer with the words shuffled. The ladder's whole claim
#: is that it does not repeat the explanation louder, so this is the number that claim lives on.
SAME_ANSWER = 0.82


@dataclass
class LadderResult:
    fired: bool = False
    threshold: int = 0
    rungs: list[dict[str, Any]] = field(default_factory=list)
    transcripts: list[Any] = field(default_factory=list)
    scored: Scored = field(default_factory=Scored)
    cost_usd: float = 0.0


def run_probe(topic: str = TOPIC, world: str = WORLD, misses: int = 4) -> dict[str, Any]:
    bun = shutil.which("bun")
    if not bun:
        raise RuntimeError("bun is not on this machine, so the ladder was not driven")
    payload = json.dumps({"topic": topic, "world": world, "misses": misses})
    result = subprocess.run(  # noqa: S603 — a fixed script path and a JSON argument we built
        [bun, str(PROBE), payload],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=120,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"the ladder probe failed: {result.stderr.strip()[:300]}")
    return json.loads(result.stdout)


def _case_for(ask: str, *, mode: str, case_id: str) -> case_bank.Case:
    """One turn shaped exactly as the app would send it when the ladder asks for a rung."""
    return case_bank.Case(
        id=case_id,
        board="CBSE",
        grade="Class 7",
        subject="mathematics",
        ask=ask,
        mode=mode,
        context={
            "curriculum": {"nodeName": TOPIC},
            "lifetime": {
                "learner": {"age": 12, "grade": "Class 7", "board": "CBSE"},
                "facts": [f"plays {WORLD} every evening"],
                "twinSummary": f"into {WORLD}",
            },
        },
        needs_drawing=mode == "board",
        expect_question=False,
        world=WORLD,
        world_words=case_bank.by_id("teach.their-world.cricket").world_words,
    )


#: The dimensions every rung is held to, exactly as a turn is. The ladder used to measure only
#: "changes approach", so a rung could be a wrong number, a yes-or-no check and a lecture and
#: still score 4.00, and the report cut each rung to 160 characters so nobody could read the rest.
RUNG_DIMENSIONS = ("verified", "teaches", "voice", "their world")


def score_rung(case: case_bank.Case, transcript: Any, out: Scored, *, rung: str) -> None:
    """Hold one rung to the turn laws and fold the result into the ladder's score.

    Each dimension keeps the WORST rung: a ladder that teaches well twice and lectures once has
    lectured. Findings carry the rung's name so the report says which one."""
    scored = Scored()
    checks.check_say_numbers(case, transcript, scored)
    checks.check_teaching(case, transcript, scored)
    checks.check_their_world(case, transcript, scored)
    checks.check_voice(transcript, scored)
    for finding in scored.findings:
        out.add(finding.severity, finding.dimension, f"{rung} rung: {finding.detail}", finding.evidence)
    for dimension in RUNG_DIMENSIONS:
        value = scored.scores.get(dimension)
        if value is None:
            continue
        current = out.scores.get(dimension)
        out.scores[dimension] = value if current is None else min(current, value)


def run(client: Any, token: str) -> LadderResult:
    out = LadderResult()
    try:
        probe = run_probe()
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        out.scored.add(NOTE, "changes approach", str(exc))
        out.scored.scores["changes approach"] = None
        return out

    out.threshold = int(probe.get("threshold") or 0)
    switches = [t for t in probe.get("turns") or [] if t.get("switched")]
    out.rungs = switches

    # Half one: did it fire at all, and did it move an axis each time?
    if not switches:
        out.scored.add(
            WRONG,
            "changes approach",
            f"{len(probe.get('turns') or [])} misses on one concept and the ladder never switched",
        )
        out.scored.scores["changes approach"] = 0
        return out

    first = probe["turns"][0]
    if first.get("switched"):
        out.scored.add(
            WEAK,
            "changes approach",
            "the ladder switched on the FIRST miss; one wrong answer is as often a slipped thumb "
            "as a misunderstanding, and the module's own threshold is two",
        )
    axes = [s.get("axis") for s in switches]
    if len(set(axes)) < len(axes):
        out.scored.add(
            WEAK,
            "changes approach",
            f"the ladder moved the same axis twice: {axes}",
        )
    out.fired = True

    # Half two: does the rung it chose actually produce a different lesson on the real path?
    baseline_case = _case_for(f"explain {TOPIC}", mode="prose", case_id="ladder.0.explain")
    baseline = runner.run_case(client, baseline_case, token)
    out.transcripts.append(baseline)
    out.cost_usd += baseline.cost_usd
    if not baseline.error:
        score_rung(baseline_case, baseline, out.scored, rung="explain")

    for index, switch in enumerate(switches, start=1):
        rung = str(switch.get("approach") or "?")
        # The `draw` rung asks for the board, so it streams; every other rung is prose.
        mode = "board" if rung == "draw" else "prose"
        case = _case_for(str(switch.get("ask") or ""), mode=mode, case_id=f"ladder.{index}.{rung}")
        transcript = runner.run_case(client, case, token)
        out.transcripts.append(transcript)
        out.cost_usd += transcript.cost_usd

        if transcript.error:
            out.scored.add(
                WRONG,
                "changes approach",
                f"the {rung} rung never produced an answer: {transcript.error}",
            )
            continue

        if rung == "draw" and not transcript.objects:
            out.scored.add(
                WRONG,
                "changes approach",
                "the ladder moved to the DRAWING rung and the board came back empty, so the "
                "learner was told it would be drawn and it was not",
                transcript.say[:300],
            )
        score_rung(case, transcript, out.scored, rung=rung)
        if rung == "their_world":
            lowered = transcript.everything_said().lower()
            if WORLD not in lowered:
                out.scored.add(
                    WRONG,
                    "changes approach",
                    f"the ladder moved to the ANALOGY rung, whose whole point is the learner's "
                    f"own world, and the answer never mentions {WORLD}",
                    transcript.say[:300],
                )

        similarity = SequenceMatcher(None, baseline.say.lower(), transcript.say.lower()).ratio()
        if similarity >= SAME_ANSWER:
            out.scored.add(
                WRONG,
                "changes approach",
                f"the {rung} rung came back {similarity:.0%} identical to the first explanation: "
                f"the axis moved and the teaching did not",
                transcript.say[:300],
            )
        else:
            out.scored.add(
                NOTE,
                "changes approach",
                f"the {rung} rung ({switch.get('axis')}) came back "
                f"{similarity:.0%} similar to the first explanation",
            )

    failures = [f for f in out.scored.findings if f.severity == WRONG]
    weaknesses = [f for f in out.scored.findings if f.severity == WEAK]
    out.scored.scores["changes approach"] = 0 if failures else (2 if weaknesses else 4)
    return out
