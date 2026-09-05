"""The report. Where the teaching is weak, not a green tick.

A pass/fail number tells the owner nothing he can act on. This writes a score per dimension per
question, rolls it up by subject and by board so a weak subject is visible at a glance, then lists
every single thing that was wrong with the evidence beside it, so a finding can be checked in
seconds rather than reproduced in an hour.

It also reports what the run COST, in the gateway's own accounting rather than an estimate, and
which mode produced it. A report that does not say whether it came from real models or recorded
fixtures is a report that can be misread as proof.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from harness.checks import NOTE, WEAK, WRONG, Finding

#: The rubric rows, in the order they matter.
DIMENSIONS = (
    "reached",
    "correct",
    "verified",
    "drew",
    "in place",
    "draws what it says",
    "legible",
    "teaches",
    "changes approach",
    "their world",
    "kind",
    "voice",
)

_BAR = {0: "····", 1: "▓···", 2: "▓▓··", 3: "▓▓▓·", 4: "▓▓▓▓"}


@dataclass
class CaseReport:
    case_id: str
    board: str
    grade: str
    subject: str
    ask: str
    scores: dict[str, int | None] = field(default_factory=dict)
    findings: list[Finding] = field(default_factory=list)
    say: str = ""
    objects_drawn: int = 0
    verified_checks: list[str] = field(default_factory=list)
    cost_usd: float = 0.0
    elapsed_ms: float = 0.0
    judge_model: str = ""

    @property
    def wrong(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == WRONG]


@dataclass
class Run:
    mode: str
    started_at: str = ""
    cases: list[CaseReport] = field(default_factory=list)
    #: Provider reachability, as observed rather than assumed.
    providers: dict[str, bool] = field(default_factory=dict)
    judge_model: str = ""
    judge_shares_provider_with_tutor: bool = False
    cost_usd: float = 0.0
    judge_cost_usd: float = 0.0
    model_calls: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def failed(self) -> bool:
        return any(c.wrong for c in self.cases)

    def averages(self) -> dict[str, float | None]:
        out: dict[str, float | None] = {}
        for dimension in DIMENSIONS:
            marks = [
                c.scores[dimension]
                for c in self.cases
                if isinstance(c.scores.get(dimension), int)
            ]
            out[dimension] = round(sum(marks) / len(marks), 2) if marks else None
        return out

    def rollup(self, key: str) -> dict[str, float | None]:
        groups: dict[str, list[int]] = {}
        for case in self.cases:
            marks = [v for v in case.scores.values() if isinstance(v, int)]
            if marks:
                groups.setdefault(getattr(case, key), []).extend(marks)
        return {k: round(sum(v) / len(v), 2) for k, v in sorted(groups.items())}


def _mark(value: int | None) -> str:
    if value is None:
        return "  -  "
    return f"{_BAR.get(value, '?')} "


def render(run: Run) -> str:
    lines: list[str] = []
    add = lines.append

    add("# The teaching harness")
    add("")
    add(
        f"Run in **{run.mode}** mode at {run.started_at}. "
        + (
            "Real models answered every question below."
            if run.mode == "live"
            else "Recorded transcripts; no model was called for the answers."
        )
    )
    add("")
    add(f"- questions: **{len(run.cases)}**")
    if run.mode == "live":
        add(f"- model calls: **{run.model_calls}**")
        add(
            f"- cost: **${run.cost_usd:.4f}** for the answers"
            + (
                f" plus **${run.judge_cost_usd:.4f}** for the second opinion"
                if run.judge_cost_usd
                else ""
            )
        )
    else:
        # A replay costs nothing. Printing the recorded figure as though this run had spent it
        # would be a claim that cannot be shown, which is the one thing this repository does not do.
        add(
            f"- cost: **$0.0000** — nothing was called. The recorded answers cost "
            f"${run.cost_usd:.4f} on the day they were produced."
        )
    add(f"- verdict: **{'FAILED' if run.failed else 'nothing false reached a learner'}**")
    if run.judge_model:
        add(f"- second opinion: `{run.judge_model}`")
        if run.judge_shares_provider_with_tutor:
            add(
                "  - **it shares a provider with the tutor**, so it is a weaker cross-check than "
                "the routing doctrine asks for"
            )
    else:
        add(
            "- second opinion: **none ran**, so only the arithmetic checks stand behind "
            "this report"
        )
    unreachable = [name for name, present in run.providers.items() if not present]
    if unreachable:
        add(f"- providers with no key on this machine: {', '.join(unreachable)}")
    for note in run.notes:
        add(f"- {note}")
    add("")

    add("## The score sheet")
    add("")
    header = "| question | " + " | ".join(DIMENSIONS) + " |"
    add(header)
    add("|" + "---|" * (len(DIMENSIONS) + 1))
    for case in run.cases:
        row = " | ".join(_mark(case.scores.get(d)) for d in DIMENSIONS)
        add(f"| `{case.case_id}` | {row} |")
    averages = run.averages()
    add(
        "| **mean of 4** | "
        + " | ".join("  -  " if averages[d] is None else f"{averages[d]:.2f}" for d in DIMENSIONS)
        + " |"
    )
    add("")

    weakest = sorted(
        ((d, v) for d, v in averages.items() if v is not None), key=lambda kv: kv[1]
    )[:3]
    if weakest:
        add("**Weakest dimensions:** " + ", ".join(f"{d} ({v:.2f}/4)" for d, v in weakest))
        add("")

    for key, title in (("subject", "By subject"), ("board", "By board")):
        rollup = run.rollup(key)
        if rollup:
            add(f"### {title}")
            add("")
            for name, value in sorted(rollup.items(), key=lambda kv: kv[1]):
                add(f"- {name}: {value:.2f} / 4")
            add("")

    wrong = [(c, f) for c in run.cases for f in c.findings if f.severity == WRONG]
    add(f"## What was wrong ({len(wrong)})")
    add("")
    if not wrong:
        add("Nothing false, unverified or forbidden reached a learner in this run.")
        add("")
    for case, finding in wrong:
        add(f"- **`{case.case_id}` / {finding.dimension}** — {finding.detail}")
        if finding.evidence:
            add(f"  > {finding.evidence.strip()[:300]}")
    add("")

    weak = [(c, f) for c in run.cases for f in c.findings if f.severity == WEAK]
    add(f"## Where the teaching is weak ({len(weak)})")
    add("")
    if not weak:
        add("Nothing.")
        add("")
    for case, finding in weak:
        add(f"- **`{case.case_id}` / {finding.dimension}** — {finding.detail}")
    add("")

    notes = [(c, f) for c in run.cases for f in c.findings if f.severity == NOTE]
    add(f"## On the record ({len(notes)})")
    add("")
    for case, finding in notes:
        add(f"- `{case.case_id}` / {finding.dimension} — {finding.detail}")
    add("")

    add("## Every answer, in full")
    add("")
    for case in run.cases:
        add(f"### `{case.case_id}` — {case.board}, {case.grade}, {case.subject}")
        add("")
        add(f"> {case.ask}")
        add("")
        add(f"Wobo said: {case.say.strip() or '(nothing)'}")
        add("")
        add(
            f"Drew {case.objects_drawn} object(s); checks that ran: "
            f"{', '.join(case.verified_checks) or 'none'}; "
            f"{case.elapsed_ms:.0f} ms; ${case.cost_usd:.4f}"
        )
        add("")
    return "\n".join(lines)


def write(run: Run, directory: Path) -> tuple[Path, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    markdown = directory / f"teaching-{run.mode}-{stamp}.md"
    data = directory / f"teaching-{run.mode}-{stamp}.json"
    markdown.write_text(render(run), encoding="utf-8")
    payload: dict[str, Any] = asdict(run)
    data.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str), encoding="utf-8")
    return markdown, data
