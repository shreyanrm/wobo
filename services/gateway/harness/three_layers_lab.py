"""THE PROOF OF THE THREE LAYERS on live models: one core, twelve levels, and the money.

docs/CONTENT-INTERACTION.md §1 and §5.1-5.3. Three concepts, two boards, two classes:

  * the concept core is made ONCE per concept, at the verify tier's model, and judged hard;
  * twelve level renderings are made FROM those cores by the cheapest model;
  * every call's cost comes out of the layer ledger (``plexus/economy.py``), priced from the
    vendors' own per-million rates in ``routing.CATALOGUE`` where litellm has no table;
  * one level is judged AGAINST its core, live, to show the rubric the core changes;
  * the same concept's CBSE class 6 and ISC class 11 renderings are printed side by side.

Run:  uv run python harness/three_layers_lab.py [--dry]

``--dry`` uses no network and no money: it exercises the whole path with the deterministic
core-render floor, which is what a level rendering falls back to when a model misses. Without it
the lab spends real money on real models and prints what each call cost.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]

CONCEPTS = (
    "the parts of a plant cell",
    "the water cycle",
    "electric current in a simple circuit",
)
BOARDS = ("CBSE", "ISC")
GRADES = ("6", "11")
SUBJECT = {
    "the parts of a plant cell": "Science",
    "the water cycle": "Science",
    "electric current in a simple circuit": "Science",
}
CHAPTER = {
    ("the parts of a plant cell", "6"): "Getting to know plants",
    ("the parts of a plant cell", "11"): "Cell: the unit of life",
    ("the water cycle", "6"): "Water",
    ("the water cycle", "11"): "Water in the atmosphere",
    ("electric current in a simple circuit", "6"): "Electricity and circuits",
    ("electric current in a simple circuit", "11"): "Current electricity",
}


def _load_env() -> None:
    """The keys live in .env.local, the way every other lab in this repo reads them."""
    path = REPO / ".env.local"
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="no network, no money")
    ap.add_argument("--cache", default="", help="cache directory (default: a fresh temp one)")
    args = ap.parse_args()

    cache = args.cache or tempfile.mkdtemp(prefix="three-layers-")
    os.environ["PLEXUS_CACHE_DIR"] = cache
    os.environ.setdefault("USAGE_LEDGER", "off")  # the durable ledger is not this lab's subject
    # The five content stores are OFF here. Migration 0026 is written and not yet applied, so a
    # configured PostgREST answers every read with 406 "Invalid schema: content" — which the store
    # degrades correctly through (a miss), but which puts a network round trip in front of every
    # read and a wall of noise in the log. The database path for cores is proved without a network
    # in tests/test_plexus_cores.py against store_fakes.FakePostgrest.
    os.environ.setdefault("PLEXUS_STORES", "off")
    if not args.dry:
        _load_env()

    sys.path.insert(0, str(HERE.parent / "src"))
    from wobo_gateway.plexus import economy, engines, store, validate

    economy.reset()
    if args.dry:  # the floor: every model call refuses, so every level renders off its core
        seeded_core = {
            "shape": "classification",
            "idea": "a cell is a compartment whose parts each do one job for the whole",
            "why": "everything alive is built from these compartments",
            "misconceptions": [
                {"belief": "a cell is a solid lump", "counter": "it is mostly water held in a bag"},
                {
                    "belief": "plant and animal cells are the same",
                    "counter": "only a plant cell has a wall and chloroplasts",
                },
            ],
            "check": {
                "question": "which part holds the shape of a plant cell?",
                "answer": "the cell wall",
            },
            "vocabulary": [
                {"term": "membrane", "meaning": "the skin that decides what enters"},
                {"term": "nucleus", "meaning": "the part that carries the instructions"},
            ],
        }

        def _no_model(*a, **k):
            raise RuntimeError("dry run: no model")

        engines._complete = _no_model  # type: ignore[assignment]
        for concept in CONCEPTS:
            store.save_core(
                concept,
                {
                    "concept": concept,
                    "layer": store.CORE_MODALITY,
                    "promptVersion": store.CORE_PROMPT_VERSION,
                    "status": store.CANONICAL,
                    "judged": True,
                    "core": engines._verify_core(seeded_core, concept),
                    "interactions": validate.choose_interactions(
                        concept, core=seeded_core, ask_model=False
                    ),
                    "provenance": {
                        "engine": engines.CORE_CAPABILITY,
                        "model": "dry-run",
                    },
                },
                None,
            )

    from wobo_gateway.routing import Tier, tier_fallbacks, tier_model

    level_model = tier_model(Tier.GENERATE).provider_model
    level_chain = tuple(tier_fallbacks(Tier.GENERATE))
    rendered: dict[tuple[str, str, str], dict] = {}
    started = datetime.now(UTC)

    for concept in CONCEPTS:
        for board in BOARDS:
            for grade in GRADES:
                scope = {
                    "board": board,
                    "grade": grade,
                    "subject": SUBJECT[concept],
                    "chapter": CHAPTER[(concept, grade)],
                    "contentVersion": "2026-27",
                }
                artifact, model, tokens, seeded = engines._generate_live(
                    "compose", concept, "core", level_model, level_chain, dict(scope)
                )
                rendered[(concept, board, grade)] = {
                    "model": model,
                    "seeded": seeded,
                    "cards": len(artifact.get("cards", [])) if isinstance(artifact, dict) else 0,
                    "words": len(json.dumps(artifact).split()),
                    "artifact": artifact,
                }
                how = "seed" if seeded else "ok"
                print(f"  {concept} / {board} class {grade}: {model} ({how})")

    # Two levels of ONE concept judged against the ONE core they were both rendered from, live,
    # because that is the half of the design a schema cannot check: did each rendering keep the
    # idea and both misconceptions, and is each one written for ITS reader?
    verdicts: dict[str, Any] = {}
    if not args.dry:
        concept = CONCEPTS[0]
        for board, grade in (("CBSE", "6"), ("ISC", "11")):
            scope = {"board": board, "grade": grade, "subject": "Science",
                     "chapter": CHAPTER[(concept, grade)], "contentVersion": "2026-27"}
            verdicts[f"{board} {grade}"] = validate._judge(
                tier_model(Tier.VERIFY).provider_model,
                "compose",
                concept,
                rendered[(concept, board, grade)]["artifact"],
                scope=scope,
                core=validate.core_for_judging(concept, scope),
            )
            said = verdicts[f"{board} {grade}"]
            print(f"  judged {board} class {grade} against its core: {said}")

    summary = economy.summary()
    rows = economy.rows()
    report = {
        "at": started.isoformat(timespec="seconds"),
        "dry": args.dry,
        "cache": cache,
        "concepts": list(CONCEPTS),
        "boards": list(BOARDS),
        "grades": list(GRADES),
        "levelModel": level_model,
        "coreModel": tier_model(Tier.VERIFY).provider_model,
        "summary": summary,
        "rows": rows,
        "levelsJudgedAgainstOneCore": verdicts,
        "rendered": {
            f"{c} | {b} | {g}": {k: v for k, v in meta.items() if k != "artifact"}
            for (c, b, g), meta in rendered.items()
        },
        "twoReaders": {
            f"{CONCEPTS[0]} | CBSE 6": rendered[(CONCEPTS[0], "CBSE", "6")]["artifact"],
            f"{CONCEPTS[0]} | ISC 11": rendered[(CONCEPTS[0], "ISC", "11")]["artifact"],
        },
    }
    stamp = started.strftime("%Y%m%d-%H%M%S")
    out = HERE / "reports" / f"three-layers-{stamp}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1))

    print("\n--- the layer ledger -------------------------------------------------")
    for layer, totals in summary["layers"].items():
        print(f"  {layer:12} made {totals['made']:3}  hits {totals['cacheHits']:3}  "
              f"USD {totals['costUsd']:.6f}  mean/made {totals['meanMadeUsd']}")
    print(f"  total USD {summary['totalUsd']:.6f} for "
          f"{summary['coresMade']} core(s) and {summary['levelsMade']} level(s)")
    if summary["baselineUsd"] is None:
        print("  baseline: not measured in this run (no full generation was needed)")
    else:
        print(f"  baseline USD {summary['baselineUsd']:.6f}, saved USD {summary['savedUsd']:.6f}")
    # THE BREAK-EVEN, OR WHY THERE IS NOT ONE. A run that prints a total and stays silent about
    # the figure everybody quotes is a run whose silence gets quoted as a number: "break-even is
    # ~38 levels" was published beside a report whose own summary said null.
    if summary["breakEvenLevels"] is not None:
        print(
            f"  break-even {summary['breakEvenLevels']} level(s) of one concept "
            f"({summary['baselineSamples']} baseline sample(s), "
            f"{summary['levelSamples']} level sample(s))"
        )
    else:
        print(f"  break-even: not determinable — {summary['breakEvenReason']}")
    lines = [
        f"# The three layers, measured ({'dry' if args.dry else 'live'})",
        "",
        f"Run {started.isoformat(timespec='seconds')}. Core model `{report['coreModel']}` "
        f"(the verify tier), level model `{report['levelModel']}` (the generate tier's cheapest "
        "rung). Three concepts x two boards x two classes.",
        "",
        "| layer | made | cache hits | USD | mean per made |",
        "|---|---:|---:|---:|---:|",
    ]
    for layer, totals in summary["layers"].items():
        lines.append(
            f"| {layer} | {totals['made']} | {totals['cacheHits']} | "
            f"{totals['costUsd']:.6f} | {totals['meanMadeUsd']} |"
        )
    lines += [
        "",
        f"**Total USD {summary['totalUsd']:.6f}** for {summary['coresMade']} core(s) and "
        f"{summary['levelsMade']} level rendering(s).",
        "",
        (
            f"**Break-even:** {summary['breakEvenLevels']} level(s) of one concept, from "
            f"{summary['baselineSamples']} baseline and {summary['levelSamples']} level "
            "measurements."
            if summary["breakEvenLevels"] is not None
            else f"**Break-even: not determinable from this run.** {summary['breakEvenReason']}."
        ),
        "",
        "| concept | board | class | model | cards | words |",
        "|---|---|---:|---|---:|---:|",
    ]
    for (c, b, g), meta in rendered.items():
        lines.append(f"| {c} | {b} | {g} | `{meta['model']}` | {meta['cards']} | {meta['words']} |")
    if verdicts:
        lines += ["", "## Two readers, one core, judged against it", ""]
        for who, v in verdicts.items():
            lines.append(f"- **{who}**: {v}")
    lines += [
        "",
        "| layer | concept | board | class | model | tokens | USD |",
        "|---|---|---|---:|---|---:|---:|",
    ]
    for row in rows:
        lines.append(
            f"| {row['layer']} | {row['concept']} | {row['board']} | {row['grade']} | "
            f"`{row['model']}` | {row['tokens']} | {row['costUsd']} |"
        )
    md = out.with_suffix(".md")
    md.write_text("\n".join(lines) + "\n")
    print(f"\n  report: {out}\n          {md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
