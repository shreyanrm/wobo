"""Grounded grading of free linear-equation working.

Correctness is not the model's call. The verifier decides it deterministically (SymPy): is the final
answer a real solution, and which step first breaks the solution set. Claude is GIVEN that verdict and
adds only what a language model is good at — naming the misconception and writing a graduated hint that
guides without handing the answer. This is "reason grounded in correctness": Wobo never free-styles math.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any

import sympy as sp
from wobo_gateway.routing import Tier, tier_chain
from wobo_verifier.cas import (
    CasError,
    parse_equation,
    solution_satisfies,
    step_preserves_solutions,
)

#: Grading one attempt is a TURN on the router's table (docs/OPERATIONS.md 11.1), so the grader
#: asks for the turn tier's primary and carries its chain behind it. It used to name the older
#: Sonnet 4.6 directly: fifty percent dearer than Sonnet 5 on the Anthropic pricing page, no
#: fallback, no health mark, no ledger row.
GRADER_MODEL = tier_chain(Tier.TURN)[0]
GRADER_CAPABILITY = "atom.grade"

GRADER_SYSTEM = """You are Wobo, a warm, precise maths tutor looking at a learner's working on a \
linear equation in one variable. A deterministic verifier has ALREADY decided whether the answer is \
correct and where the first mistake is. Trust it completely and never contradict it.

Do two things:
1. Name the single misconception, choosing exactly one label from:
   none, transposition_sign, division_error, distribution_error, arithmetic_slip,
   incomplete_division, combine_like_terms_error.
2. Write ONE short, graduated hint that nudges the learner toward finding their own mistake. The hint \
MUST NOT state the final value of x or otherwise give the answer away. Ask, do not tell.

Reply with strict JSON only, no prose outside it:
{"misconception": "<label>", "diagnosis": "<one plain, kind sentence>", "hint": "<one sentence, no final answer>"}"""


@dataclass
class VerifierFindings:
    final_correct: bool | None
    first_bad_step: int | None
    detail: str


@dataclass
class Grade:
    correct: bool | None
    error_step: int | None
    misconception: str
    diagnosis: str
    hint: str
    hint_reveals_answer: bool


def verifier_ground(equation: str, working: list[str]) -> VerifierFindings:
    """Deterministic grounding: final correctness + the first step that breaks the solution set."""
    final = working[-1]
    try:
        final_correct: bool | None = solution_satisfies(equation, final).passed
    except CasError:
        final_correct = None

    first_bad: int | None = None
    detail = "all steps preserve the solution set"
    for i in range(len(working) - 1):
        try:
            ok: bool | None = step_preserves_solutions(working[i], working[i + 1]).passed
        except CasError:
            ok = None
        if ok is False:
            first_bad = i + 1
            detail = f"step {working[i]!r} -> {working[i + 1]!r} changes the solution set"
            break
    return VerifierFindings(final_correct, first_bad, detail)


def _true_value(equation: str) -> sp.Expr | None:
    try:
        eq = parse_equation(equation)
        symbols = list(eq.free_symbols)
        if len(symbols) != 1:
            return None
        solutions = sp.solve(sp.Eq(eq.lhs, eq.rhs), symbols[0])
        return solutions[0] if len(solutions) == 1 else None
    except (CasError, ValueError, TypeError):
        return None


def hint_reveals_answer(hint: str, value: sp.Expr | None) -> bool:
    """Heuristic guard: did the hint hand over the final answer? (Wobo must never.)"""
    if value is None:
        return False
    v = str(value)
    h = hint.lower().replace(" ", "")
    return any(
        pattern in h for pattern in (f"x={v}", f"xis{v}", f"answeris{v}", f"itis{v}", f"={v}")
    )


def _extract_json(text: str) -> dict[str, Any]:
    t = text.strip()
    if t.startswith("```"):
        parts = t.split("```")
        t = parts[1] if len(parts) > 1 else t
        if t.lstrip().startswith("json"):
            t = t.lstrip()[4:]
    start, end = t.find("{"), t.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(t[start : end + 1])
        except json.JSONDecodeError:
            return {}
    return {}


def grounded_grade(
    equation: str,
    working: list[str],
    findings: VerifierFindings,
    *,
    model: str = GRADER_MODEL,
) -> Grade:
    """Combine the verifier's authoritative correctness with the model's grounded diagnosis + hint.

    The call goes through the gateway's one funnel, ``wobo_gateway.model_call.complete``: the
    turn tier's chain behind the model asked for, a knob a rung refuses dropped for that rung,
    a credit refusal marked so the next call skips it, and the row in the usage ledger naming who
    actually answered (``telemetry.record_cost``).
    """
    from wobo_gateway.model_call import complete
    from wobo_gateway.telemetry import record_cost

    fallbacks = [m for m in tier_chain(Tier.TURN) if m != model]
    lines = "\n".join(f"{i}: {form}" for i, form in enumerate(working))
    user = (
        f"Equation: {equation}\n"
        f"Learner working (index: form):\n{lines}\n\n"
        f"Verifier result: final_correct={findings.final_correct}, "
        f"first_bad_step={findings.first_bad_step} ({findings.detail}).\n"
        "Grade this working now."
    )
    response = complete(
        model=model,
        fallbacks=fallbacks or None,
        messages=[
            {"role": "system", "content": GRADER_SYSTEM},
            {"role": "user", "content": user},
        ],
        max_tokens=300,
        temperature=0,
        timeout=60.0,
    )
    record_cost(capability=GRADER_CAPABILITY, model=model, response=response)
    text = response.choices[0].message.content or ""
    data = _extract_json(text)
    hint = str(data.get("hint", ""))
    return Grade(
        correct=findings.final_correct,
        error_step=findings.first_bad_step,
        misconception=str(data.get("misconception", "other")),
        diagnosis=str(data.get("diagnosis", "")),
        hint=hint,
        hint_reveals_answer=hint_reveals_answer(hint, _true_value(equation)),
    )


def grade_dict(grade: Grade) -> dict[str, Any]:
    return asdict(grade)
