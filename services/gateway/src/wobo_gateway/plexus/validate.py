"""Post-serve validation gate + GPT-5.5 (openai.frontier) quality-backup escalation.

CONTENT ORDER (owner verdict 2026-07-07): the content primary is OPUS (frontier.reason); GPT-5.5
is the quality-backup. Owner's evidence — in the Opus-vs-GPT-5.5 storyboard comparison Opus was
slightly better, and GPT-5.5 made subtle React/SVG errors — so Opus leads and GPT-5.5 competes on
every quality failure. An artifact serves immediately as ``status="provisional"`` — the first
learner never waits on a judge. A background thread (spawned after serve, in :mod:`engines`) then
scores the provisional Opus artifact with an LLM judge (Opus) against the quality bars:
correctness, interactivity, visual-heaviness, guided-discovery register, and
grammar/sentence-case. On a quality-fail (score below the bar, or a critical/factual error) the
SAME spec is regenerated on the escalation model (GPT-5.5); both artifacts are re-scored and the
BEST-OF is promoted to ``status="canonical"``.

Validation ALWAYS terminates in a canonical record, so a provisional is validated exactly
once and every later learner reuses the canonical core. When the judge is unreachable the
already structurally-verified artifact is promoted as-is (score ``None``) — the gate never
blocks a serve on a flaky judge.

Provenance on the promoted artifact records ``{model, prompt_version, validation:{model,
validatedAt, score}}`` — ``model`` is the model that actually produced the canonical
artifact (the escalation model when best-of chose it), so telemetry reports the real model.

Owner law — every version is kept FOREVER: the winner is saved canonical, and the losing
candidate (the Opus provisional a GPT-5.5 rebuild supersedes, or a GPT-5.5 rebuild that lost
best-of) is appended to the immutable version ledger as SUPERSEDED / REJECTED — never deleted.

A video artifact promoted to canonical also appends a render job to the out-of-band MP4 queue
(:func:`_enqueue_video_render`) — best-effort, never blocking the promotion.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from wobo_gateway.plexus import store
from wobo_gateway.providers import timeout_for
from wobo_gateway.telemetry import record_cost

logger = logging.getLogger("wobo.gateway.plexus.validate")

PASS_THRESHOLD = 70.0  # overall score 0..100; below this (or a critical error) → escalate

_JUDGE_SYSTEM = (
    "You are a strict quality judge for Wobo, an Indian K-12 guided-discovery learning app in "
    "the spirit of Brilliant. Score ONE generated learning artifact against these bars:\n"
    "  • correctness — every fact, formula, and label is right for an Indian middle-school learner "
    "(NCERT framing where it fits). A wrong fact or a wrong-subject law is a CRITICAL error.\n"
    "  • interactivity — the learner ACTS before any prose; each card/scene carries a real "
    "tap/drag/slide/type or moving visual. A dead, read-only artifact is critical.\n"
    "  • visual-heaviness — the visual does the teaching; prose is minimal (~40 words per card).\n"
    "  • guided-discovery register — one idea per beat, act-to-reveal, zero lecturing.\n"
    "  • grammar and sentence-case — calm copy, sentence case, no emoji, no exclamation marks.\n\n"
    "Reply with STRICT JSON only, no prose outside it:\n"
    '{"score": <0-100 overall quality>, "critical": <true if ANY factual error or broken '
    'interaction>, "weak": ["<names of bars that scored low>"], "notes": "<one sentence>"}'
)


def _judge(
    judge_model: str,
    modality: str,
    concept: str,
    artifact: Any,
    facts: list[str] | None = None,
    contradictions: list[str] | None = None,
) -> dict[str, Any] | None:
    """Score the artifact via the LLM judge. Returns the parsed verdict, or ``None`` when the
    judge is unreachable or unparseable (the caller then keeps the artifact, never blocks).

    ``facts`` (verified NCERT ground truth for the concept) and ``contradictions``
    (deterministic fact-base conflicts) are appended for bio/social subjects so the judge
    scores correctness against the fact base — SUBJECTS.md §2.

    The judge carries the verify tier's cross-provider chain behind ``judge_model`` (minus the
    judge itself): until this wave it called ONE model with nothing behind it, so a verify-tier
    outage promoted every artifact unscored."""
    from wobo_gateway.model_call import complete as model_complete
    from wobo_gateway.wobo import _extract_json

    user = (
        f"Modality: {modality}\nConcept: {concept}\n\nArtifact JSON:\n"
        # cap the payload so a huge video/compose spec cannot blow the judge's context
        + json.dumps(artifact, ensure_ascii=False)[:12000]
    )
    if facts:
        user += (
            "\n\nNCERT GROUND TRUTH (verified fact base) — the artifact MUST NOT contradict"
            " these:\n"
        )
        user += "\n".join(f"- {c}" for c in facts[:40])
    if contradictions:
        user += (
            "\n\nDETECTED CONTRADICTIONS (deterministic, high-confidence) — each is a CRITICAL "
            "correctness error:\n" + "\n".join(f"- {c}" for c in contradictions)
        )
    try:
        response = model_complete(
            model=judge_model,
            messages=[
                {"role": "system", "content": _JUDGE_SYSTEM},
                {"role": "user", "content": user},
            ],
            fallbacks=_judge_chain(judge_model) or None,
            max_tokens=800,
            temperature=0.0,
            # The judge runs on a background thread after the serve. Without a deadline a hung
            # judge leaks that thread for the life of the process.
            timeout=timeout_for("engine.compose"),
        )
        record_cost(capability=f"engine.{modality}", model=judge_model, response=response)
        text = response.choices[0].message.content or ""
    except Exception:  # a flaky judge must never block a serve — promote as-is
        logger.warning("validate: judge call raised — promoting artifact unscored", exc_info=True)
        return None
    verdict = _extract_json(text)
    if not isinstance(verdict.get("score"), (int, float)) or isinstance(verdict.get("score"), bool):
        return None
    return {
        "score": float(verdict["score"]),
        "critical": bool(verdict.get("critical")),
        "weak": verdict["weak"] if isinstance(verdict.get("weak"), list) else [],
        "notes": str(verdict.get("notes") or ""),
    }


def _judge_chain(judge_model: str) -> list[str]:
    """The verify tier's whole chain, from the router, with the judge itself left out."""
    from wobo_gateway.routing import Tier, tier_chain

    return [m for m in tier_chain(Tier.VERIFY) if m != judge_model]


def _passes(verdict: dict[str, Any] | None) -> bool:
    """A None verdict means the judge was unreachable — never block on it; keep the artifact."""
    if verdict is None:
        return True
    return verdict["score"] >= PASS_THRESHOLD and not verdict["critical"]


def _score_of(verdict: dict[str, Any] | None) -> float:
    """The raw judge score (for logs and provenance). -1 when the judge was unreachable."""
    return -1.0 if verdict is None else verdict["score"]


def _rank(verdict: dict[str, Any] | None) -> float:
    """Best-of comparison key: a CRITICAL (factually wrong / broken) artifact ranks below any
    clean one whatever its raw score, so best-of never keeps a wrong artifact over a sound one."""
    if verdict is None:
        return -1.0
    return verdict["score"] - 1000.0 if verdict["critical"] else verdict["score"]


def _factcheck(artifact: Any, concept: str, scope: dict[str, str]) -> tuple[list[str], list[str]]:
    """(contradictions, verified-facts) from the NCERT fact base — empty unless this is a
    bio/social subject. bio/social have no CAS: the fact base is the correctness solver
    (SUBJECTS.md §2)."""
    from wobo_gateway.plexus import store
    from wobo_gateway.plexus.factcheck import FACTBASE_SUBJECTS, facts_for, validate_claims

    if (scope or {}).get("subject") not in FACTBASE_SUBJECTS:
        return [], []
    cid = store.concept_id(concept, scope)
    return validate_claims(artifact, cid), facts_for(cid)


def _with_factbase(
    verdict: dict[str, Any] | None, contradictions: list[str]
) -> dict[str, Any] | None:
    """A deterministic contradiction against a VERIFIED NCERT fact is a CRITICAL correctness
    failure — force it onto the verdict so a fact-contradicting artifact never promotes
    unchecked (even if the judge was lenient or unreachable)."""
    if not contradictions:
        return verdict
    base = verdict or {"score": 0.0, "weak": [], "notes": ""}
    return {
        **base,
        "critical": True,
        "weak": sorted(set(base.get("weak", []) + ["correctness"])),
        "notes": (base.get("notes", "") + " | fact-base: " + "; ".join(contradictions))[:500],
    }


def _promote_after_lint_failure(
    *,
    concept: str,
    modality: str,
    difficulty: str,
    scope: dict[str, str],
    record: dict[str, Any],
    artifact: Any,
    base_model: str,
    base_reasons: list[str],
    judge_model: str,
    escalation_model: str,
    fallbacks: tuple[str, ...],
    now: str,
    provenance: Any,
    generate_live: Any,
    lint_artifact: Any,
) -> dict[str, Any]:
    """The technical-lint-failure route (owner law): the served provisional is technically broken,
    so rebuild the SAME spec on the quality-backup (GPT-5.5) WITHOUT a judge call. If the rebuild
    lints clean it is promoted (unscored — the quality-backup model's clean rebuild is trusted); if
    it is ALSO broken or fell to a seed, refuse to the honest seed, loudly. Every version is kept
    forever: the failed provisional (and any failed rebuild) persists as REJECTED with lint reasons
    in provenance."""
    logger.warning(
        "validate: technical lint FAILED for %s/%r (%d issue(s)) — GPT-5.5 rebuild, no judge: %s",
        modality,
        concept,
        len(base_reasons),
        "; ".join(base_reasons[:6]),
    )

    alt: Any = None
    alt_model = escalation_model
    alt_seeded = True
    alt_reasons: list[str] = []
    if escalation_model:
        try:
            alt, alt_model, _tokens, alt_seeded = generate_live(
                modality, concept, difficulty, escalation_model, fallbacks, {}
            )
        except Exception:
            logger.warning("validate: lint-failure GPT-5.5 rebuild raised", exc_info=True)
            alt, alt_seeded = None, True

    alt_ok = False
    if alt is not None and not alt_seeded:
        alt_lint = lint_artifact(modality, alt)
        alt_ok, alt_reasons = alt_lint.ok, alt_lint.reasons

    if alt_ok:
        canonical = {
            **record,
            "status": store.CANONICAL,
            "artifact": alt,
            "provenance": provenance(alt_model, None),
        }
        logger.info(
            "validate: lint-clean GPT-5.5 rebuild promoted to canonical for %s/%r",
            modality,
            concept,
        )
    else:
        # GPT-5.5's rebuild is ALSO broken (or unavailable/seeded) — the loud refuse/seed path.
        logger.error(
            "validate: GPT-5.5 rebuild ALSO failed technical lint for %s/%r — serving the seed: %s",
            modality,
            concept,
            "; ".join(alt_reasons[:6]) or "rebuild seeded or unavailable",
        )
        seed_artifact = _seed_for(modality, concept, difficulty)
        canonical = {
            **record,
            "status": store.CANONICAL,
            "artifact": seed_artifact,
            "seeded": True,  # an honest floor, not a ceiling
            # A seed is normally retried on the next live serve. This one must NOT be: TWO
            # frontier models have already failed the technical lint on this exact concept at
            # this prompt version, so an unrecorded refusal meant every single request paid for
            # a fresh Opus draft plus a fresh GPT-5.5 rebuild and landed on the same seed. The
            # refusal is recorded here and engines.py reads it (the prompt_version staleness
            # rule still forces a retry once the doctrine that produced the failure changes).
            "refusedAt": now,
            "lintFailures": {
                "base": {"model": base_model, "reasons": base_reasons[:12]},
                "rebuild": {"model": alt_model, "reasons": alt_reasons[:12]},
            },
            "provenance": {
                **record.get("provenance", {}),
                "model": "seed",
                "validation": {"model": judge_model, "validatedAt": now, "score": None},
            },
        }

    store.save(concept, modality, difficulty, canonical, scope)
    store.save_version(concept, modality, difficulty, canonical, scope)
    # Keep the failed Opus provisional forever — REJECTED, lint reasons recorded (never deleted).
    store.save_version(
        concept,
        modality,
        difficulty,
        {
            **record,
            "status": store.REJECTED,
            "artifact": artifact,
            "provenance": provenance(base_model, None, lint_reasons=base_reasons),
        },
        scope,
    )
    # A rebuild that itself failed lint is kept too — every generated version persists.
    if alt is not None and not alt_seeded and not alt_ok:
        store.save_version(
            concept,
            modality,
            difficulty,
            {
                **record,
                "status": store.REJECTED,
                "artifact": alt,
                "provenance": provenance(alt_model, None, lint_reasons=alt_reasons),
            },
            scope,
        )
    return canonical


def _seed_for(modality: str, concept: str, difficulty: str) -> Any:
    """The honest floor for a modality (imported lazily — engines pulls in sympy/litellm seams)."""
    from wobo_gateway.plexus.engines import _seed

    return _seed(modality, concept, difficulty)


# --- render-queue seam (INTEGRATION.md): promote-to-canonical -> enqueue an out-of-band render -
# The render worker (services/render-worker) drains this queue and renders each video artifact to an
# MP4 with Remotion — Node-only deps that must never touch the gateway. The queue FILE + JSONL line
# is the whole contract, so the gateway appends the line itself (stdlib) rather than importing the
# worker's queue.py (which is not on the gateway path). See services/render-worker/INTEGRATION.md.


def _render_queue_path() -> Path:
    """The shared render queue. RENDER_QUEUE_PATH (the worker's env override) wins; otherwise it
    lives beside the cached artifacts (and honours PLEXUS_CACHE_DIR, so tests stay isolated)."""
    override = os.getenv("RENDER_QUEUE_PATH")
    return Path(override) if override else store.cache_dir() / "_render-queue.jsonl"


def _video_spec_fingerprint(artifact: Any) -> str:
    """A gateway-side content hash of the video scene spec, used ONLY to dedupe the queue (no two
    pending jobs for the same film). It hashes the same inputs the worker's authoritative
    sceneSpecHash does — scene id + SVG payload + narration audio — but need not match it byte for
    byte: the worker computes its own hash for the MP4 filename + reuse economy."""
    scenes = artifact.get("scenes") if isinstance(artifact, dict) else None
    spec = [
        {
            "id": s.get("id"),
            "svg": (s.get("visual") or {}).get("payload"),
            "audio": (s.get("audio") or {}).get("b64"),
        }
        for s in (scenes or [])
        if isinstance(s, dict)
    ]
    bed = (artifact.get("narrationAudio") or {}) if isinstance(artifact, dict) else {}
    blob = json.dumps({"scenes": spec, "bed": bed.get("b64")}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _enqueue_video_render(artifact_path: Path, artifact: Any) -> None:
    """Append one render job for a canonical video artifact — best-effort, NEVER blocking promotion.
    Idempotent per scene-spec fingerprint among pending (un-drained) jobs: a re-promote of the same
    film does not stack duplicate jobs. ``drain`` clears the queue, so a later re-promote after a
    drain re-enqueues (the worker then reuses the existing MP4 by hash — reuse economy)."""
    try:
        queue = _render_queue_path()
        spec_hash = _video_spec_fingerprint(artifact)
        if queue.exists():
            for line in queue.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    if json.loads(line).get("sceneSpecHash") == spec_hash:
                        return  # already pending for this exact spec — idempotent, skip
                except json.JSONDecodeError:
                    continue
        job = {
            "artifact": str(artifact_path),
            "out": None,
            "sceneSpecHash": spec_hash,
            "enqueuedAt": datetime.now(UTC).isoformat(),
        }
        queue.parent.mkdir(parents=True, exist_ok=True)
        with queue.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(job, separators=(",", ":")) + "\n")
    except Exception:  # a queue write must never break a promotion — log and move on
        logger.warning("validate: render enqueue failed — promotion unaffected", exc_info=True)


def _maybe_enqueue_manim(
    artifact_path: Path, artifact: Any, concept: str, difficulty: str
) -> None:
    """Flag and enqueue the films SVG cannot carry (owner's Manim escalation law).

    ``needs_manim`` and the manim queue were real and tested but had NO caller, so the escalation
    rung the README describes never fired. It fires here, next to the MP4 enqueue, on exactly the
    same trigger: a real video promoted to canonical. The queue is drained by future container
    infra — enqueueing now means the backlog is real the day it lands, and the flag stops being a
    claim nothing exercises. Best-effort: a queue write may never break a promotion.
    """
    try:
        from wobo_gateway.plexus.manim_rung import enqueue_manim, needs_manim

        if not needs_manim(artifact):
            return
        enqueue_manim(
            {
                "artifact": str(artifact_path),
                "concept": concept,
                "difficulty": difficulty,
                "reason": "scene plan needs a real animation engine (manim_rung.needs_manim)",
            }
        )
    except Exception:  # a queue write must never break a promotion — log and move on
        logger.warning("validate: manim enqueue failed — promotion unaffected", exc_info=True)


def _maybe_enqueue_render(
    concept: str, modality: str, difficulty: str, scope: dict[str, str], canonical: dict[str, Any]
) -> None:
    """Enqueue an MP4 render iff a real (non-seed) VIDEO artifact was promoted to canonical, and
    the Manim escalation rung alongside it when the scene plan is too intricate for SVG."""
    if modality != "video" or canonical.get("seeded"):
        return
    artifact_path = store.artifact_path(concept, modality, difficulty, scope)
    _enqueue_video_render(artifact_path, canonical.get("artifact"))
    _maybe_enqueue_manim(artifact_path, canonical.get("artifact"), concept, difficulty)


def validate_and_promote(
    *,
    concept: str,
    modality: str,
    difficulty: str,
    scope: dict[str, str],
    record: dict[str, Any],
    judge_model: str,
    escalation_model: str,
    fallbacks: tuple[str, ...] = (),
) -> dict[str, Any]:
    """Score the provisional artifact, escalate + best-of on a quality-fail, and promote the
    winner to canonical. ALWAYS writes a canonical record (validation is once-and-done).

    A DETERMINISTIC technical lint runs FIRST, before the LLM judge: a broken SVG attribute, a
    dead expression, or an out-of-vocabulary enum is a certain reject, so it routes an Opus rebuild
    WITHOUT spending a judge call (:func:`_promote_after_lint_failure`)."""
    from wobo_gateway.plexus.engines import _generate_live
    from wobo_gateway.plexus.lint import lint_artifact

    artifact = record["artifact"]
    base_model = record.get("provenance", {}).get("model", "unknown")
    now = datetime.now(UTC).isoformat(timespec="seconds")

    def _provenance(
        model: str, ver: dict[str, Any] | None, lint_reasons: list[str] | None = None
    ) -> dict[str, Any]:
        prov: dict[str, Any] = {
            **record.get("provenance", {}),
            "model": model,
            "validation": {
                "model": judge_model,
                "validatedAt": now,
                "score": None if ver is None else ver["score"],
            },
        }
        if lint_reasons is not None:  # the deterministic lint's verdict, on a rejected version
            prov["lint"] = lint_reasons
        return prov

    lint = lint_artifact(modality, artifact)
    if not lint.ok:
        canonical = _promote_after_lint_failure(
            concept=concept,
            modality=modality,
            difficulty=difficulty,
            scope=scope,
            record=record,
            artifact=artifact,
            base_model=base_model,
            base_reasons=lint.reasons,
            judge_model=judge_model,
            escalation_model=escalation_model,
            fallbacks=fallbacks,
            now=now,
            provenance=_provenance,
            generate_live=_generate_live,
            lint_artifact=lint_artifact,
        )
        _maybe_enqueue_render(concept, modality, difficulty, scope, canonical)
        return canonical

    contradictions, fact_context = _factcheck(artifact, concept, scope)
    verdict = _with_factbase(
        _judge(
            judge_model, modality, concept, artifact,
            facts=fact_context, contradictions=contradictions,
        ),
        contradictions,
    )
    best_artifact, best_model, best_verdict = artifact, base_model, verdict

    # Escalation candidate (the GPT-5.5 rebuild), if the gate fires. Kept in scope so its version —
    # win or lose — is persisted to the immutable ledger below. Owner verdict (2026-07-07): Opus is
    # the proven-stronger content model (slightly better storyboards; GPT-5.5 made subtle React/SVG
    # errors) so Opus leads; GPT-5.5 is the proven-strong cross-family backup that competes here on
    # every quality failure, and best-of promotes whichever actually scores higher.
    alt: Any = None
    alt_model = escalation_model
    alt_verdict: dict[str, Any] | None = None
    alt_seeded = False

    if not _passes(verdict) and escalation_model:
        logger.info(
            "validate: quality-fail (score=%s critical=%s) — escalating %s to %s",
            _score_of(verdict),
            None if verdict is None else verdict["critical"],
            modality,
            escalation_model,
        )
        try:
            # regenerate the SAME spec (concept x difficulty) on the quality-backup (GPT-5.5); empty
            # payload (no raster)
            alt, alt_model, _tokens, alt_seeded = _generate_live(
                modality, concept, difficulty, escalation_model, fallbacks, {}
            )
        except Exception:
            logger.warning("validate: escalation regeneration raised", exc_info=True)
            alt, alt_seeded = None, True
        # a seeded escalation is the honest floor, not a real regeneration — never best-of a seed
        if alt is not None and not alt_seeded:
            alt_contra, _ = _factcheck(alt, concept, scope)
            alt_verdict = _with_factbase(
                _judge(
                    judge_model, modality, concept, alt,
                    facts=fact_context, contradictions=alt_contra,
                ),
                alt_contra,
            )
            if _rank(alt_verdict) > _rank(verdict):
                best_artifact, best_model, best_verdict = alt, alt_model, alt_verdict
                logger.info(
                    "validate: best-of chose the escalated artifact (score=%s)",
                    _score_of(alt_verdict),
                )

    canonical = {
        **record,
        "status": store.CANONICAL,
        "artifact": best_artifact,
        "provenance": _provenance(best_model, best_verdict),
    }
    store.save(concept, modality, difficulty, canonical, scope)
    # Owner law: keep every version forever. The canonical winner is a ledger record; and if a
    # GPT-5.5 rebuild actually ran, the LOSER of best-of is kept too — SUPERSEDED when the rebuild
    # replaced the served provisional, REJECTED when the rebuild itself lost. Never deleted.
    store.save_version(concept, modality, difficulty, canonical, scope)
    if alt is not None and not alt_seeded:
        if best_artifact is alt:  # the GPT-5.5 rebuild won → the Opus provisional is superseded
            loser = {
                **record,
                "status": store.SUPERSEDED,
                "artifact": artifact,
                "provenance": _provenance(base_model, verdict),
            }
        else:  # the GPT-5.5 rebuild lost best-of → rejected, but still kept as a record
            loser = {
                **record,
                "status": store.REJECTED,
                "artifact": alt,
                "provenance": _provenance(alt_model, alt_verdict),
            }
        store.save_version(concept, modality, difficulty, loser, scope)

    _maybe_enqueue_render(concept, modality, difficulty, scope, canonical)
    logger.info(
        "validate: promoted %s/%r to canonical (model=%s score=%s)",
        modality,
        concept,
        best_model,
        _score_of(best_verdict),
    )
    return canonical


# ponytail: best-of regenerates the WHOLE artifact rather than patching only the judge's `weak`
# sections. Whole-artifact best-of is the smaller, sound version; add section-level optimization
# when a diff shows it measurably beats a full regeneration.


if __name__ == "__main__":  # runnable self-check — no framework, no network
    _rec = {
        "artifact": {"cards": ["base"]},
        # the base was judged on the verify tier's second rung; the rebuild lands on its primary
        "provenance": {
            "engine": "engine.compose",
            "model": "anthropic/claude-opus-5",
            "prompt_version": "v",
        },  # noqa: E501
    }
    _saved: list[dict] = []
    store.save = lambda c, m, d, r, s: None  # type: ignore[assignment]
    store.save_version = lambda c, m, d, r, s: (_saved.append(r), store.artifact_path(c, m, d, s))[
        1
    ]  # type: ignore[assignment] # noqa: E501

    # fail-then-escalate: the Opus base scores low, the Sol rebuild scores high → best-of
    # promotes the GPT-5.5 rebuild, and the superseded Opus base survives in the version ledger. Run
    # as `python -m ...validate`: this module IS __main__, so rebinding the global `_judge` here is
    # what validate_and_promote (also in __main__) resolves. _generate_live and lint_artifact are
    # imported fresh from their real modules, so patch them there.
    _judge = lambda jm, mo, co, art, **_k: {  # type: ignore[assignment] # noqa: E731
        "score": 90.0 if art == {"cards": ["alt"]} else 40.0,
        "critical": False,
        "weak": [],
        "notes": "",
    }
    import wobo_gateway.plexus.engines as _eng
    import wobo_gateway.plexus.lint as _lint

    _lint.lint_artifact = lambda modality, artifact: _lint.LintResult(True, [])  # type: ignore[assignment]
    _eng._generate_live = lambda *a: ({"cards": ["alt"]}, "openai/gpt-5.6-sol", 1, False)  # type: ignore[assignment]
    out = validate_and_promote(
        concept="c",
        modality="compose",
        difficulty="core",
        scope={},
        record=_rec,
        judge_model="anthropic/claude-opus-5",
        escalation_model="openai/gpt-5.6-sol",
    )
    assert out["status"] == "canonical", out
    assert out["artifact"] == {"cards": ["alt"]}, out
    assert out["provenance"]["model"] == "openai/gpt-5.6-sol", out
    assert out["provenance"]["validation"]["score"] == 90.0, out
    # every version kept forever: the canonical winner AND the superseded Opus base both persist
    _statuses = {r["status"]: r["artifact"] for r in _saved}
    assert _statuses.get("canonical") == {"cards": ["alt"]}, _saved
    assert _statuses.get("superseded") == {"cards": ["base"]}, _saved
    print("validate self-check ok")
