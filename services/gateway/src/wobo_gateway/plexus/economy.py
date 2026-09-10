"""What each layer of the content economy actually cost — per core, per level, per interaction.

**The owner, 2026-09-08:** *"top quality at the lowest cost possible; better models only where
needed."* docs/CONTENT-INTERACTION.md §5.6 asks for the consequence of that in a number: "the
ledger records cost per concept core, per level rendering, per interaction, so the saving is a
number on the console and not a claim."

:mod:`wobo_gateway.ledger` is the durable, learner-attributed record and it already receives every
model call through :func:`wobo_gateway.telemetry.record_cost`. It answers "what did this learner
cost us". It cannot answer "what did the core cost and what did each level rendering cost", because
a level rendering and the core that fed it are both ``engine.compose`` rows to it.

So this module keeps the LAYER ledger beside the cache it is a ledger of: one JSON line per layer
event, in the cache directory, carrying the concept, the coordinate, the model, the tokens and the
cost. It is small, local, append-only and never in the way of a learner: every function here
swallows its own errors, because an accounting line is worth less than a child's answer.

Nothing here is a claim. :func:`summary` reports what was recorded and, where a baseline exists,
what the old one-generation-per-level path would have cost at the SAME measured price. When no
baseline row exists it says so rather than inventing one.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("wobo.gateway.plexus.economy")

#: The three layers of docs/CONTENT-INTERACTION.md §1, plus the baseline the saving is measured
#: against: one full generation of a whole level from nothing, which is what wave 31 paid per
#: board x grade. A FULL row is only ever written by a caller that really made one.
CORE = "core"
LEVEL = "level"
INTERACTION = "interaction"
FULL = "full"

LAYERS = (CORE, LEVEL, INTERACTION, FULL)

_lock = threading.Lock()


def path() -> Path:
    """The layer ledger's file. Beside the cache, because it is a ledger of the cache."""
    from wobo_gateway.plexus.store import cache_dir

    override = os.getenv("PLEXUS_ECONOMY_PATH")
    if override:
        return Path(override)
    return cache_dir() / "_economy" / "layers.jsonl"


def record(
    layer: str,
    *,
    concept: str,
    capability: str,
    model: str | None = None,
    scope: dict[str, str] | None = None,
    cost_usd: float | None = None,
    tokens: int = 0,
    cached: bool = False,
    note: str = "",
) -> dict[str, Any] | None:
    """Append one layer event. Returns the row written, or ``None`` when it could not be.

    ``cached`` is the row that costs nothing and is the whole point of the design: a level served
    from a stored core, or a core read instead of made. A cached row carries ``costUsd: 0.0``
    because a read genuinely cost no model money, which is different from ``null`` (a call whose
    price nobody has)."""
    if layer not in LAYERS:
        return None
    s = scope or {}
    row: dict[str, Any] = {
        "at": datetime.now(UTC).isoformat(timespec="seconds"),
        "layer": layer,
        "concept": str(concept)[:200],
        "board": str(s.get("board") or ""),
        "grade": str(s.get("grade") or ""),
        "contentVersion": str(s.get("contentVersion") or ""),
        "capability": capability,
        "model": model or "",
        "tokens": int(tokens or 0),
        "costUsd": 0.0 if cached else (None if cost_usd is None else round(float(cost_usd), 6)),
        "cached": bool(cached),
    }
    if note:
        row["note"] = note[:200]
    try:
        target = path()
        with _lock:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError as exc:
        logger.debug("economy: layer row not recorded (%s)", exc)
        return None
    return row


def rows() -> list[dict[str, Any]]:
    """Every layer event recorded, oldest first. Empty when nothing has been recorded."""
    out: list[dict[str, Any]] = []
    target = path()
    if not target.is_file():
        return out
    try:
        text = target.read_text(encoding="utf-8")
    except OSError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def _totals(subset: list[dict[str, Any]]) -> dict[str, Any]:
    priced = [r for r in subset if isinstance(r.get("costUsd"), (int, float))]
    made = [r for r in subset if not r.get("cached")]
    spend = round(sum(float(r["costUsd"]) for r in priced), 6)
    return {
        "events": len(subset),
        "made": len(made),
        "cacheHits": len(subset) - len(made),
        "costUsd": spend,
        "unpriced": len([r for r in subset if r.get("costUsd") is None]),
        "meanMadeUsd": round(spend / len(made), 6) if made else None,
    }


def summary(rows_in: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Per-layer totals, and the saving where it can honestly be computed.

    The baseline is the price of ONE full generation of a level from nothing. It is taken from
    recorded ``FULL`` rows when there are any (measured, not assumed); with none, ``baselineUsd``
    is ``None`` and ``savedUsd`` is ``None`` — the console then shows the layer costs and says the
    baseline has not been measured, which is the honest answer and not a flattering one."""
    data = rows() if rows_in is None else list(rows_in)
    by_layer = {layer: _totals([r for r in data if r.get("layer") == layer]) for layer in LAYERS}
    total = round(
        sum(
            float(r["costUsd"])
            for r in data
            if r.get("layer") in (CORE, LEVEL, INTERACTION)
            and isinstance(r.get("costUsd"), (int, float))
        ),
        6,
    )
    baseline_unit = by_layer[FULL]["meanMadeUsd"]
    levels_made = by_layer[LEVEL]["made"]
    baseline = None if baseline_unit is None else round(baseline_unit * levels_made, 6)
    return {
        "layers": by_layer,
        "totalUsd": total,
        "levelsMade": levels_made,
        "coresMade": by_layer[CORE]["made"],
        "baselineUnitUsd": baseline_unit,
        "baselineUsd": baseline,
        "savedUsd": None if baseline is None else round(baseline - total, 6),
    }


def reset() -> None:
    """Drop the layer ledger. The lab's setup, never a production path."""
    try:
        path().unlink(missing_ok=True)
    except OSError:
        pass
