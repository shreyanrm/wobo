"""The board, measured rather than described.

The brain is Python and the hand is TypeScript, and the hand is where a drawing is actually a
drawing: ``packages/wobo/src/board/geometry.ts`` turns an object into strokes, glyphs and a
bounding box, and the renderer paints exactly that. So the only honest way to ask "is this board
legible" is to run that function. This module shells out to :mod:`geometry_probe` (bun), hands it
the objects that reached the wire, and turns what comes back into findings.

If bun is not on the machine, the drawing check is SKIPPED and says so. It is never quietly
passed: a board nobody measured is a board nobody measured.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from harness.checks import NOTE, WEAK, WRONG, Scored

PROBE = Path(__file__).resolve().parent / "geometry_probe.ts"
REPO = Path(__file__).resolve().parents[3]

#: An issue kind and how seriously to take it.
#:
#: A label off the board or written over another label is ink a child cannot read, on a product
#: whose premise is that it draws the explanation, so both are ``wrong``. Needing the camera is
#: legal and only worth knowing about.
_SEVERITY = {
    "off-canvas": WRONG,
    "clipped": WRONG,
    "overlapping": WRONG,
    "needs-camera": NOTE,
}


class ProbeUnavailable(RuntimeError):
    pass


def measure(objects: list[dict[str, Any]], *, timeout_s: float = 60.0) -> dict[str, Any]:
    """Run the real geometry over these objects. Raises :class:`ProbeUnavailable` without bun."""
    bun = shutil.which("bun")
    if not bun:
        raise ProbeUnavailable("bun is not on this machine, so the drawing was not measured")
    payload = json.dumps({"objects": objects})
    try:
        result = subprocess.run(  # noqa: S603 — a fixed script path, input on stdin
            [bun, str(PROBE)],
            input=payload,
            capture_output=True,
            text=True,
            cwd=REPO,
            timeout=timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ProbeUnavailable(f"the geometry probe did not finish in {timeout_s:g}s") from exc
    if result.returncode != 0:
        raise ProbeUnavailable(f"the geometry probe failed: {result.stderr.strip()[:300]}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ProbeUnavailable(f"the geometry probe wrote something unreadable: {exc}") from exc


def check_drawing(case: Any, transcript: Any, out: Scored) -> dict[str, Any] | None:
    """Score the legibility of what was drawn. Returns the raw probe result for the report."""
    if not transcript.objects:
        out.scores["legible"] = None
        return None
    try:
        probe = measure(transcript.objects)
    except ProbeUnavailable as exc:
        out.add(NOTE, "legible", str(exc))
        out.scores["legible"] = None
        return None

    if not probe.get("font"):
        out.add(
            NOTE,
            "legible",
            "the handwriting font did not load, so glyph widths are estimated rather than measured",
        )

    worst = 4
    for issue in probe.get("issues") or []:
        kind = str(issue.get("kind"))
        severity = _SEVERITY.get(kind, WEAK)
        detail = str(issue.get("detail") or "")
        out.add(severity, "legible", f"{kind}: {detail}", str(issue.get("object") or ""))
        if severity == WRONG:
            worst = 0
        elif severity == WEAK:
            worst = min(worst, 2)
    out.scores["legible"] = worst
    return probe
