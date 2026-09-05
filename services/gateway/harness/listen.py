"""The listening pass for the spoken voice (docs/copy/voice.md 10b).

The beat is wired: the tutor names what a line is and the voice is told (``wobo_gateway.voice``).
What no test can settle is whether the five leans are audible, held apart, and small. That is a
person's ear, and this is the script that puts the clips in front of one.

It reads ONE short line under every beat plus a control, twice for two of the beats, and writes the
WAVs and a measurement sheet to ``harness/reports/listen-<stamp>/``. Then a person listens, in this
order, and answers 10b's questions:

* control, then step: is the step the same calm voice, or did the instruction change it?
* win against miss: are they apart? Brighter and quicker against softer and slower, by a degree.
* ask: is there a lift at the end, and is it a question rather than a performance?
* crisis: the softest of all, and no urgency. If it sounds like a presenter, it is wrong.
* step against step-again, win against win-again: the same line read twice sounds the same twice.

The numbers beside each clip (speech length, level, median pitch, pitch at the start against the
end) are a sanity check, not a verdict: a win that is longer AND lower than the miss is worth a
second listen, but only the ear decides. Nothing here is a pytest: it calls the paid voice API
and the owner pays, so it runs when somebody asks for it.

    cd services/gateway
    GEMINI_API_KEY=... uv run python -m harness.listen
    uv run python -m harness.listen --line "Not quite. Look at the sign on the second term."

The key is read from the environment only and is never written anywhere. Eight calls of one short
line is a few seconds of audio. The usage ledger is switched OFF for the run, before anything is
imported: a developer's ``.env.local`` carries the production Supabase service role, and the
ledger's flush thread would otherwise post eight listening-pass rows into the production bill
within five seconds. The clips cost what they cost on the key; they are not a learner's spoken
seconds and they do not pretend to be.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import pathlib
import sys
import time
import wave

# Before the ledger is imported anywhere down the chain (media -> ledger): never a production row
# from a listening pass. Set, not overridden, so an operator who wants the rows can say so.
os.environ.setdefault("USAGE_LEDGER", "off")

from wobo_gateway import voice  # noqa: E402
from wobo_gateway.plexus import media  # noqa: E402

from harness.runner import REPO_ENV, load_dotenv  # noqa: E402

DEFAULT_LINE = "Look at the second term. The sign is the part that matters here."
REPORTS = pathlib.Path(__file__).parent / "reports"


def runs(accent: str) -> list[tuple[str, str]]:
    """What is read, and under which instruction. The control is the accent alone: what the
    one-shot path sent before the beat existed."""
    out: list[tuple[str, str]] = [("control", voice.accent_instruction(accent))]
    out += [(beat, voice.spoken_instruction(accent, beat)) for beat in voice.BEATS]
    out += [("step-again", voice.spoken_instruction(accent, "step"))]
    out += [("win-again", voice.spoken_instruction(accent, "win"))]
    return out


def _pcm(path: pathlib.Path) -> tuple[list[float], int]:
    with wave.open(str(path), "rb") as w:
        rate = w.getframerate()
        frames = w.readframes(w.getnframes())
    samples = [
        int.from_bytes(frames[i : i + 2], "little", signed=True) / 32768.0
        for i in range(0, len(frames) - 1, 2)
    ]
    return samples, rate


def _trim(samples: list[float], thresh: float = 0.01) -> list[float]:
    """Drop leading and trailing silence, so pace is measured on speech and not on padding."""
    start = next((i for i, s in enumerate(samples) if abs(s) > thresh), 0)
    end = next((i for i in range(len(samples) - 1, -1, -1) if abs(samples[i]) > thresh), -1)
    return samples[start : end + 1]


def _f0_track(samples: list[float], rate: int) -> list[float]:
    """Pitch per 30 ms frame by autocorrelation, 70 to 400 Hz, voiced frames only. Pure Python on
    8 kHz audio: slow but dependency-free, and a few seconds of speech is all it ever sees."""
    win, hop = int(rate * 0.03), int(rate * 0.02)
    lo, hi = int(rate / 400), int(rate / 70)
    out: list[float] = []
    for start in range(0, len(samples) - win, hop):
        frame = samples[start : start + win]
        energy = sum(s * s for s in frame)
        if energy < win * 0.0004:
            continue
        best_lag, best = 0, 0.0
        for lag in range(lo, hi):
            acc = 0.0
            for i in range(win - lag):
                acc += frame[i] * frame[i + lag]
            if acc > best:
                best, best_lag = acc, lag
        if best_lag and best / energy > 0.5:
            out.append(rate / best_lag)
    return out


def _median(xs: list[float]) -> float:
    if not xs:
        return 0.0
    ordered = sorted(xs)
    return ordered[len(ordered) // 2]


def measure(path: pathlib.Path) -> dict[str, float | int]:
    """The sanity numbers beside one clip. Pitch is read off a 3x decimated copy."""
    samples, rate = _pcm(path)
    speech = _trim(samples)
    f0 = _f0_track(speech[::3], rate // 3)
    n = len(f0)
    quarter = max(1, n // 4)
    rms = math.sqrt(sum(s * s for s in speech) / max(1, len(speech)))
    ordered = sorted(f0)
    return {
        "total_s": round(len(samples) / rate, 2),
        "speech_s": round(len(speech) / rate, 2),
        "rms_db": round(20 * math.log10(max(rms, 1e-9)), 1),
        "f0_median_hz": round(_median(f0)),
        "f0_start_hz": round(_median(f0[:quarter])),
        "f0_end_hz": round(_median(f0[-quarter:])),
        "f0_spread_hz": round(ordered[int(n * 0.9)] - ordered[int(n * 0.1)]) if n > 10 else 0,
        "voiced_frames": n,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--line", default=DEFAULT_LINE, help="the one line read under every beat")
    parser.add_argument("--accent", default="en-IN", choices=sorted(voice.ACCENTS))
    args = parser.parse_args(argv)

    # The same gitignored secrets the live harness reads, names set and values never printed.
    load_dotenv(REPO_ENV)
    if not (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")):
        print("no GEMINI_API_KEY or GOOGLE_AI_API_KEY in the environment; nothing to listen to")
        return 2

    out = REPORTS / f"listen-{time.strftime('%Y%m%d-%H%M%S')}"
    out.mkdir(parents=True, exist_ok=True)
    sheet: list[dict[str, object]] = []
    for name, instruction in runs(args.accent):
        started = time.monotonic()
        audio = media.synthesize_narration(args.line, instruction=instruction)
        took = round(time.monotonic() - started, 1)
        row: dict[str, object]
        if audio is None:
            row = {"beat": name, "error": "no audio came back", "round_trip_s": took}
        else:
            path = out / f"{name}.wav"
            path.write_bytes(base64.b64decode(audio["b64"]))
            row = {"beat": name, "file": path.name, "round_trip_s": took, **measure(path)}
        sheet.append(row)
        print(json.dumps(row), flush=True)

    (out / "measurements.json").write_text(
        json.dumps({"line": args.line, "accent": args.accent, "clips": sheet}, indent=2)
    )
    print(f"\nclips and measurements in {out}")
    print("now listen, in the order the module docstring gives, and write down what you hear")
    return 0 if all("file" in row for row in sheet) else 1


if __name__ == "__main__":
    sys.exit(main())
