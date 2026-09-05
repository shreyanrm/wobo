"""The half a regex cannot decide: is this good teaching, and does the drawing match the words.

The deterministic checks own everything that can be decided by arithmetic, and they own the
question that matters most — a false number — precisely so that no model's opinion stands between
a child and a wrong fact. That ownership runs both ways: what the judge finds is reported and
never fatal, because a run that fails on a model's opinion is a run whose verdict is a model's
opinion. What is left over is genuinely a judgement: whether an explanation
explains or merely asserts, whether the picture on the board is the picture the sentence promised,
whether the tone would make a child feel stupid.

**The judge is the other mind.** The gateway's own doctrine (``routing``: "a generated artifact is
always judged by the other provider") applies here for the same reason: a model marking its own
homework agrees with itself. The judge model is chosen from a chain, the report names which one
actually answered, and when the judge and the tutor turn out to share a provider the report says
that too rather than quietly claiming a cross-check it did not get.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from harness.checks import NOTE, WEAK, Scored

#: Tried in order. The first that answers judges. Override with ``WOBO_HARNESS_JUDGE_MODEL``
#: (comma separated) when a key is missing or a provider is down.
DEFAULT_JUDGE_CHAIN = (
    "anthropic/claude-opus-5",
    "openai/gpt-5.6-sol",
    "gemini/gemini-2.5-flash",
)

RUBRIC = """You are marking one turn of an AI tutor that teaches school students. You are not the
tutor and you never answer the student's question yourself. You mark, strictly, and you justify.

Score each dimension 0 to 4, where 4 is what an excellent human tutor would have done, 2 is
adequate, and 0 is a failure. Use null when the dimension genuinely does not apply to this turn.

  factual        Is everything asserted TRUE for this subject and this class? A single false
                 statement scores 0, however good the rest is. Judge only what is actually
                 claimed; a simplification appropriate to the class is not an error. A figure that
                 differs only because a different value of a physical constant was used is NOT an
                 error and must not be reported as one — standard gravity in this product is
                 9.81 m/s^2 throughout. Neither is rounding. Report an error only when the claim is
                 wrong, and quote the claim.
  explains       Does it EXPLAIN rather than assert? A good answer gives a reason, a mechanism or
                 an intuition. A list of steps with no "because" anywhere is a 1.
  drawing        Does the board show what the words say it shows? You are given every object that
                 was drawn. An answer whose words describe a diagram that was never drawn, or
                 whose board shows something else entirely, scores 0. null if nothing was drawn
                 and nothing needed to be.
  hands_back     Does it stop and check understanding, or hand the next move to the student,
                 rather than closing the problem out for them?
  kind           Would this make a child feel capable? It must never make them feel stupid, never
                 punish a miss, never be sarcastic, never be saccharine or gushing.
  their_world    If the student's own interests are given below, does the teaching reach for THEM
                 for its example or analogy? null when no interests are given.

Reply with STRICT JSON and nothing else:

{"factual": 0-4|null, "explains": 0-4|null, "drawing": 0-4|null, "hands_back": 0-4|null,
 "kind": 0-4|null, "their_world": 0-4|null,
 "errors": ["each factual error you found, quoted, one per entry"],
 "notes": "two sentences at most on where the teaching is weakest"}"""


def judge_chain() -> tuple[str, ...]:
    raw = os.getenv("WOBO_HARNESS_JUDGE_MODEL", "")
    if raw.strip():
        return tuple(m.strip() for m in raw.split(",") if m.strip())
    return DEFAULT_JUDGE_CHAIN


def _board_description(objects: list[dict[str, Any]]) -> str:
    from wobo_gateway.board import schema

    if not objects:
        return "(nothing was drawn)"
    lines = []
    for obj in objects[:60]:
        text = schema.visible_text(obj)
        anchor = obj.get("anchor") if isinstance(obj.get("anchor"), dict) else {}
        if "board" in anchor:
            where = f"at {anchor['board']}"
        else:
            on = anchor.get("object") or anchor.get("target") or anchor.get("focus") or "?"
            # WHERE on it, not just what it hangs off. Without the ``at`` a Punnett square's four
            # cells all read as "on square" and a judge reasonably concluded they were stacked in
            # one box — a finding about the harness's own description rather than about the board.
            spot = anchor.get("at")
            where = f"on {on}" + (f" ({spot})" if spot is not None else "")
        extra = ""
        if obj.get("kind") in {"table", "grid"}:
            rows = obj.get("rows")
            down = rows if isinstance(rows, int) else len(rows or [])
            extra = f" {obj.get('cols') or ''}x{down}"
        lines.append(f"  - {obj.get('kind')}{extra} {where}" + (f': "{text}"' if text else ""))
    if len(objects) > 60:
        lines.append(f"  - ... and {len(objects) - 60} more")
    return "\n".join(lines)


def build_prompt(case: Any, transcript: Any) -> str:
    interests = ""
    lifetime = (case.context or {}).get("lifetime") or {}
    facts = (lifetime.get("learner") or {}) and lifetime.get("facts") or []
    if case.world or facts:
        interests = (
            "The student's own interests, as the tutor was given them: "
            f"{case.world or ''} {json.dumps(facts, ensure_ascii=False) if facts else ''}\n"
        )
    return (
        f"{RUBRIC}\n\n"
        f"--- the turn being marked ---\n"
        f"Board and class: {case.board}, {case.grade}. Subject: {case.subject}.\n"
        f"{interests}"
        f"The student asked: {case.ask}\n"
        f"What the words on the board were meant to show: "
        f"{case.drawing_brief or '(the question did not ask for a drawing)'}\n\n"
        f"The tutor SAID:\n{transcript.say or '(nothing)'}\n\n"
        f"The tutor DREW:\n{_board_description(transcript.objects)}\n\n"
        f"The question the tutor handed back: "
        f"{json.dumps(transcript.ask) if transcript.ask else '(none)'}\n"
    )


def _extract_json(text: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def ask_judge(case: Any, transcript: Any) -> dict[str, Any]:
    """Run the rubric.

    Returns ``{"model", "verdict", "cost_usd", "error"}``; an empty model means no judge answered.
    """
    import litellm

    litellm.drop_params = True
    prompt = build_prompt(case, transcript)
    last_error = ""
    for model in judge_chain():
        try:
            response = litellm.completion(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=900,
                timeout=90.0,
            )
        except Exception as exc:  # noqa: BLE001 — a dead provider is a finding, not a crash
            last_error = f"{model}: {type(exc).__name__}: {str(exc)[:180]}"
            continue
        try:
            cost = float(litellm.completion_cost(completion_response=response))
        except Exception:  # noqa: BLE001 — an unpriced judge is still a judge
            cost = 0.0
        verdict = _extract_json(response.choices[0].message.content or "")
        if not verdict:
            last_error = f"{model}: the judge did not answer in JSON"
            continue
        return {"model": model, "verdict": verdict, "cost_usd": round(cost, 6), "error": ""}
    return {"model": "", "verdict": {}, "cost_usd": 0.0, "error": last_error or "no judge ran"}


#: Which judged dimension lands on which rubric row of the report.
_DIMENSIONS = {
    "factual": "correct",
    "explains": "teaches",
    "drawing": "draws what it says",
    "hands_back": "teaches",
    "kind": "kind",
    "their_world": "their world",
}


def apply_verdict(result: dict[str, Any], out: Scored) -> None:
    """Fold the judge's marks into the score sheet, WITHOUT letting it overrule the arithmetic.

    A dimension the deterministic pass already failed stays failed: the judge may lower a score and
    may fill one in, and it may never raise one the arithmetic put on the floor.

    **And it may never fail the run on its own.** Every entry in the judge's ``errors`` array used
    to be recorded at WRONG, which is the fatal severity: ``Run.failed`` is any wrong finding, so a
    model's free-text opinion could set the report to FAILED and the exit code to 1 by itself —
    exactly the authority the doctrine at the top of this file says it must never have. It already
    did once: the judge marked with g = 9.8, called this product's correct 9.81-derived apex height
    wrong, and the run failed on it. Narrowing the rubric fixed that instance and left the
    mechanism, so the mechanism is fixed here. A judged error is a WEAKNESS: it is reported in
    full, in its own section of the report, and a human decides. What fails a run is arithmetic
    against ground truth, and nothing else.
    """
    if result.get("error"):
        out.add(NOTE, "judged", f"no second opinion on this turn: {result['error']}")
        return
    verdict = result.get("verdict") or {}

    for error in (verdict.get("errors") or [])[:6]:
        if isinstance(error, str) and error.strip():
            out.add(WEAK, "correct", f"the second opinion found a factual error: {error.strip()}")

    for key, dimension in _DIMENSIONS.items():
        value = verdict.get(key)
        if value is None or not isinstance(value, (int, float)):
            continue
        mark = max(0, min(4, int(value)))
        existing = out.scores.get(dimension)
        out.scores[dimension] = mark if existing is None else min(int(existing), mark)
        if mark <= 1:
            out.add(WEAK, dimension, f"the second opinion scored {key} at {mark} out of 4")

    notes = verdict.get("notes")
    if isinstance(notes, str) and notes.strip():
        out.add(NOTE, "judged", notes.strip()[:400])
