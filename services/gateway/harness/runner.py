"""Driving the REAL path, and writing down exactly what the learner would have received.

There is no shortcut here and that is the whole point. Every case goes through
``POST /v1/capability/wobo.turn`` on the real FastAPI app: the same door (a real HS256 token, a
real issuer check), the same consent tier, the same inbound and outbound safety screens, the same
meter, the same spend ceiling, the same board planner, the same verifier, the same wire. A harness
that called ``run_wobo_turn`` directly would be testing a function; this tests the product.

Two modes, and the report always says which one produced it:

* ``live``   — ``LLM_MODE=live``, real models, real money. The transcript is written to
  ``fixtures/`` as it is produced, so the next replay run is free.
* ``replay`` — the recorded transcripts, no network, no key, no cost. This is the mode CI can run.

**Cost.** ``spend.state()`` is the gateway's own per-process USD accumulator, fed by the same
``telemetry.record_cost`` funnel every live model call already passes through. The harness reads it
before and after each case, so the figure it reports is the gateway's own accounting rather than a
second estimate that could disagree with it.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(__file__).resolve().parent
FIXTURES = HARNESS_DIR / "fixtures"
#: The repository's gitignored local secrets. Read into the environment for a live run and never
#: printed: see :func:`load_dotenv`.
REPO_ENV = HARNESS_DIR.parents[2] / ".env.local"

#: The harness's own learner. A pseudonym, never a real subject id.
SUBJECT = "harness-learner"
#: The door needs a secret to verify against. This one is the harness's, it is not a deploy secret,
#: and nothing signed with it can reach a real project (the issuer is checked too).
JWT_SECRET = "teaching-harness-secret-not-a-real-one-and-long-enough-for-sha256"
ISSUER = "https://harness.invalid/auth/v1"


@dataclass
class Transcript:
    """Everything the learner would have received on one turn, plus what it cost to produce."""

    case_id: str
    mode: str
    status: int
    #: Wobo's spoken line, joined from the ``say`` frames in order.
    say: str = ""
    #: The board objects that reached the wire, in draw order.
    objects: list[dict[str, Any]] = field(default_factory=list)
    #: The checks that actually ran on this turn (the ``done`` frame's ``verified``).
    verified: list[str] = field(default_factory=list)
    #: What the planner refused to draw, and why.
    refused: list[str] = field(default_factory=list)
    presentation: str = ""
    ask: dict[str, Any] | None = None
    actions: list[dict[str, Any]] = field(default_factory=list)
    #: The raw frames, so a later question about the wire can be answered without re-running.
    events: list[dict[str, Any]] = field(default_factory=list)
    cost_usd: float = 0.0
    model_calls: int = 0
    elapsed_ms: float = 0.0
    #: Set when the turn itself failed — a provider outage, a refusal, a 5xx.
    error: str = ""

    def board_text(self) -> str:
        """Every glyph the hand would write, joined. One of the three halves — see below."""
        from wobo_gateway.board import schema

        return "\n".join(t for t in (schema.visible_text(o) for o in self.objects) if t)

    def ask_text(self) -> str:
        """The question in the ``ask`` frame, which is a full sentence Wobo puts to the child.

        This used to be read for one boolean ("was anything handed back?") and for nothing else,
        so every content check was blind to it. It is not a lesser surface than the spoken line:
        the only WRONG finding in the live run of 2026-09-05 lived here — a Class 10 biology
        learner was asked "which two boxes show the dominant phenotype?" when an Aa x Aa cross
        gives three — and no arithmetic could have caught it, because no check ever read it.
        """
        if not isinstance(self.ask, dict):
            return ""
        return str(self.ask.get("prompt") or "")

    def everything_said(self) -> str:
        """Everything the learner receives: what Wobo says, what it asks, and what it writes."""
        return "\n".join(p for p in (self.say, self.ask_text(), self.board_text()) if p)


# --- the environment the real app runs in inside the harness -----------------------------------


def prepare_env(*, live: bool) -> None:
    """Configure the process the way a real deploy would, minus anything that reaches a network
    the harness has no business touching.

    Supabase is unset on purpose: consent lookups, the usage ledger and the JWKS fetch all check
    for a project and all correctly do nothing without one. The door still verifies the token.
    """
    os.environ["SUPABASE_JWT_SECRET"] = JWT_SECRET
    # ``auth.expected_issuer`` reads this name; pinning it means the door checks the issuer on
    # every harness request exactly as it does in production.
    os.environ["SUPABASE_JWT_ISS"] = ISSUER
    for unset in (
        "SUPABASE_URL",
        "SUPABASE_JWKS_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_KEY",
        "ALERT_WEBHOOK_URL",
    ):
        os.environ.pop(unset, None)
    os.environ["SUBSCRIPTIONS_STORE"] = "memory"
    os.environ["EMAIL_MODE"] = "console"
    os.environ["LLM_MODE"] = "live" if live else "mock"
    # The harness spends more turns in a run than a learner spends in a day, and the meter is the
    # gateway's own per-process counter. Raising it here keeps the meter REAL (it still charges,
    # still refunds, still writes headers) without a run failing on 429 halfway through.
    os.environ.setdefault("FREE_DAILY_TURNS", "500")


def load_dotenv(path: Path) -> list[str]:
    """Read a ``.env``-shaped file into the environment without overwriting what is already set.

    Returns the names it set, never the values: a harness that printed a key would be the worst
    bug in this repository.
    """
    if not path.is_file():
        return []
    set_names: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name, value = name.strip(), value.strip().strip('"').strip("'")
        if not name or not value or name in os.environ:
            continue
        os.environ[name] = value
        set_names.append(name)
    # LiteLLM reads GEMINI_API_KEY; the deploy writes GOOGLE_AI_API_KEY. One is the other.
    if os.environ.get("GOOGLE_AI_API_KEY") and not os.environ.get("GEMINI_API_KEY"):
        os.environ["GEMINI_API_KEY"] = os.environ["GOOGLE_AI_API_KEY"]
        set_names.append("GEMINI_API_KEY")
    return set_names


def providers_present() -> dict[str, bool]:
    """Which model providers this machine can actually reach. Reported, never assumed."""
    return {
        "primary text provider": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "second text provider": bool(os.environ.get("OPENAI_API_KEY")),
        "last text provider": bool(os.environ.get("GEMINI_API_KEY")),
    }


def mint_token() -> str:
    import jwt

    now = int(time.time())
    return jwt.encode(
        {
            "sub": SUBJECT,
            "aud": "authenticated",
            "iss": ISSUER,
            "iat": now,
            "exp": now + 7200,
            "role": "authenticated",
        },
        JWT_SECRET,
        algorithm="HS256",
    )


def build_client() -> Any:
    """The real app, behind the real door."""
    from fastapi.testclient import TestClient
    from wobo_gateway.app import build_gateway, create_app

    return TestClient(create_app(build_gateway()))


# --- one turn -----------------------------------------------------------------------------------

_SSE = {"Accept": "text/event-stream"}


def payload_for(case: Any, *, ask: str | None = None) -> dict[str, Any]:
    """The context packet the web client would have sent for this question."""
    context: dict[str, Any] = {
        "page": {"route": "course", "state": {}},
        "turn": {"lastUserInput": ask if ask is not None else case.ask},
        "curriculum": {"nodeName": case.subject},
        "lifetime": {
            "learner": {"grade": case.grade, "board": case.board},
        },
    }
    for key, value in (case.context or {}).items():
        if isinstance(value, dict) and isinstance(context.get(key), dict):
            merged = {**context[key], **value}
            context[key] = merged
        else:
            context[key] = value
    return {"payload": {"context": context}}


def _frames(body: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for block in body.split("\n\n"):
        if not block.strip() or block.lstrip().startswith(":"):
            continue
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        if "event" not in fields or "data" not in fields:
            continue
        try:
            data = json.loads(fields["data"])
        except json.JSONDecodeError:
            continue
        out.append({"id": fields.get("id", ""), "type": fields["event"], "data": data})
    return out


def run_case(client: Any, case: Any, token: str, *, ask: str | None = None) -> Transcript:
    """One question, all the way through, and everything that came back."""
    from wobo_gateway import spend

    before = spend.state()
    started = time.perf_counter()
    headers = {"Authorization": f"Bearer {token}"}
    if case.mode == "board":
        headers.update(_SSE)

    transcript = Transcript(case_id=case.id, mode=case.mode, status=0)
    try:
        response = client.post(
            "/v1/capability/wobo.turn", json=payload_for(case, ask=ask), headers=headers
        )
    except Exception as exc:  # noqa: BLE001 — a provider outage is a finding, not a crash
        transcript.error = f"{type(exc).__name__}: {exc}"
        transcript.elapsed_ms = (time.perf_counter() - started) * 1000
        return transcript

    transcript.status = response.status_code
    transcript.elapsed_ms = (time.perf_counter() - started) * 1000
    after = spend.state()
    transcript.cost_usd = round(max(0.0, after.spent_usd - before.spent_usd), 6)
    transcript.model_calls = max(0, after.calls - before.calls)

    if response.status_code != 200:
        transcript.error = f"HTTP {response.status_code}: {response.text[:300]}"
        return transcript

    if case.mode == "board":
        frames = _frames(response.text)
        transcript.events = frames
        transcript.say = " ".join(
            str(f["data"].get("text") or "") for f in frames if f["type"] == "say"
        ).strip()
        transcript.objects = [
            f["data"]["object"]
            for f in frames
            if f["type"] == "ink" and isinstance(f["data"].get("object"), dict)
        ]
        transcript.actions = [
            f["data"]["action"]
            for f in frames
            if f["type"] == "action" and isinstance(f["data"].get("action"), dict)
        ]
        done = next((f["data"] for f in frames if f["type"] == "done"), {})
        transcript.verified = [str(v) for v in (done.get("verified") or [])]
        transcript.refused = [str(r) for r in (done.get("refused") or [])]
        transcript.presentation = str(done.get("presentation") or "")
        ask_frame = next((f["data"] for f in frames if f["type"] == "ask"), None)
        transcript.ask = ask_frame if isinstance(ask_frame, dict) else None
    else:
        body = response.json()
        output = body.get("output") if isinstance(body.get("output"), dict) else body
        transcript.say = str(output.get("say") or "")
        transcript.actions = [a for a in (output.get("actions") or []) if isinstance(a, dict)]
        transcript.events = [{"id": "", "type": "output", "data": output}]
    return transcript


# --- fixtures -----------------------------------------------------------------------------------


def fixture_path(case_id: str, suffix: str = "") -> Path:
    return FIXTURES / f"{case_id}{suffix}.json"


def save(transcript: Transcript, suffix: str = "") -> Path:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    path = fixture_path(transcript.case_id, suffix)
    path.write_text(json.dumps(asdict(transcript), indent=2, sort_keys=True), encoding="utf-8")
    return path


def load(case_id: str, suffix: str = "") -> Transcript | None:
    path = fixture_path(case_id, suffix)
    if not path.is_file():
        return None
    return Transcript(**json.loads(path.read_text(encoding="utf-8")))
